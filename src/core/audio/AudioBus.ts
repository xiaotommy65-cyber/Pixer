import { appLogger } from '../runtime/AppLogger.ts';

/**
 * Procedural Web Audio DSP Master Bus:
 * - Pre-baked reusable white & pink-weighted stereo noise buffers (zero runtime GC allocation)
 * - Per-voice stereo panning + dry/spatial-delay send routing
 * - Warm stereo ping-pong feedback delay with damped LPF loop
 * - Soft-clipper saturation curve + master DynamicsCompressorNode -> masterGain -> destination
 */
export class AudioBus {
  public ctx: AudioContext | null = null;
  public dryBus: GainNode | null = null;
  public fxSend: GainNode | null = null;
  public masterGain: GainNode | null = null;
  public whiteNoiseBuffer: AudioBuffer | null = null;
  public pinkNoiseBuffer: AudioBuffer | null = null;

  private compressor: DynamicsCompressorNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private delayL: DelayNode | null = null;
  private delayR: DelayNode | null = null;
  private delayFbL: GainNode | null = null;
  private delayFbR: GainNode | null = null;
  private delayFilter: BiquadFilterNode | null = null;
  private delayReturn: GainNode | null = null;
  private delayMerger: ChannelMergerNode | null = null;
  private bgmBus: GainNode | null = null;
  private bgmFilter: BiquadFilterNode | null = null;
  private bgmMuffled = false;
  private audioUnavailableLogged = false;

  public ensureUnlocked(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) {
        if (!this.audioUnavailableLogged) {
          this.audioUnavailableLogged = true;
          appLogger.warn('audio', 'audio.initContext', '瀏覽器不支援 Web Audio API，將以靜音模式運行');
        }
        return null;
      }

      // Wrap AudioContext instantiation and DSP graph construction: autoplay policies,
      // device restrictions, or hardware driver errors can throw synchronously here.
      try {
        const ctx = new AudioCtor({ latencyHint: 'interactive' });

        const dryBus = ctx.createGain();
        dryBus.gain.value = 1.0;

        const fxSend = ctx.createGain();
        fxSend.gain.value = 1.0;

        // Warm analog-style soft-clipper curve
        const shaper = ctx.createWaveShaper();
        const curveLen = 2048;
        const curve = new Float32Array(curveLen);
        const drive = 1.55;
        for (let i = 0; i < curveLen; i++) {
          const x = (i * 2) / curveLen - 1;
          curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
        }
        shaper.curve = curve;
        shaper.oversample = '2x';

        // Master compressor to glue percussive transients & multi-voice chords
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-15, ctx.currentTime);
        comp.knee.setValueAtTime(10, ctx.currentTime);
        comp.ratio.setValueAtTime(5, ctx.currentTime);
        comp.attack.setValueAtTime(0.003, ctx.currentTime);
        comp.release.setValueAtTime(0.14, ctx.currentTime);

        const masterGain = ctx.createGain();
        masterGain.gain.value = 1.0;

        // Spatial stereo ping-pong delay send with warm LPF feedback loop
        const delayL = ctx.createDelay(1.0);
        const delayR = ctx.createDelay(1.0);
        delayL.delayTime.setValueAtTime(0.145, ctx.currentTime);
        delayR.delayTime.setValueAtTime(0.215, ctx.currentTime);

        const delayFilter = ctx.createBiquadFilter();
        delayFilter.type = 'lowpass';
        delayFilter.frequency.setValueAtTime(2600, ctx.currentTime);
        delayFilter.Q.setValueAtTime(0.7, ctx.currentTime);

        const delayFbL = ctx.createGain();
        const delayFbR = ctx.createGain();
        delayFbL.gain.value = 0.24;
        delayFbR.gain.value = 0.22;

        const delayMerger = ctx.createChannelMerger(2);
        const delayReturn = ctx.createGain();
        delayReturn.gain.value = 0.34;

        fxSend.connect(delayFilter);
        delayFilter.connect(delayL);
        delayFilter.connect(delayR);
        delayL.connect(delayFbL);
        delayFbL.connect(delayR);
        delayR.connect(delayFbR);
        delayFbR.connect(delayL);

        delayL.connect(delayMerger, 0, 0);
        delayR.connect(delayMerger, 0, 1);
        delayMerger.connect(delayReturn);
        delayReturn.connect(dryBus);

        const bgmBus = ctx.createGain();
        bgmBus.gain.value = 1.0;

        const bgmFilter = ctx.createBiquadFilter();
        bgmFilter.type = 'lowpass';
        bgmFilter.frequency.setValueAtTime(this.bgmMuffled ? 450 : 20000, ctx.currentTime);
        bgmFilter.Q.setValueAtTime(0.75, ctx.currentTime);

        bgmBus.connect(bgmFilter);
        bgmFilter.connect(dryBus);

        dryBus.connect(shaper);
        shaper.connect(comp);
        comp.connect(masterGain);
        masterGain.connect(ctx.destination);

        this.ctx = ctx;
        this.dryBus = dryBus;
        this.bgmBus = bgmBus;
        this.bgmFilter = bgmFilter;
        this.fxSend = fxSend;
        this.shaper = shaper;
        this.compressor = comp;
        this.masterGain = masterGain;
        this.delayL = delayL;
        this.delayR = delayR;
        this.delayFbL = delayFbL;
        this.delayFbR = delayFbR;
        this.delayFilter = delayFilter;
        this.delayReturn = delayReturn;
        this.delayMerger = delayMerger;

        this.buildNoiseBuffers(ctx);
        appLogger.success('audio', 'audio.initContext', '已建立 Web Audio DSP 音效管線', {
          sampleRate: ctx.sampleRate,
          state: ctx.state,
        });
      } catch (err) {
        if (!this.audioUnavailableLogged) {
          this.audioUnavailableLogged = true;
          appLogger.error('audio', 'audio.initContext', '建立 Web Audio DSP 管線失敗，已切換安全靜音', err);
        }
        this.ctx = null;
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx
        .resume()
        .then(() => {
          appLogger.info('audio', 'audio.unlock', '已解鎖瀏覽器音訊輸出', {
            sampleRate: this.ctx?.sampleRate,
          });
        })
        .catch((err) => {
          appLogger.warn('audio', 'audio.unlock', '音訊恢復被瀏覽器策略暫時阻擋', err);
        });
    }
    return this.ctx;
  }

  private buildNoiseBuffers(ctx: AudioContext): void {
    const durationSec = 1.5;
    const len = Math.max(1024, Math.floor(ctx.sampleRate * durationSec));

    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const wData = white.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const h = Math.sin((i + 1) * 12.9898) * 43758.5453;
      wData[i] = (h - Math.floor(h)) * 2 - 1;
    }

    // Paul Kellet pink-noise approximation for warm explosions, snares & whooshes
    const pink = ctx.createBuffer(1, len, ctx.sampleRate);
    const pData = pink.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const wn = wData[i];
      b0 = 0.99886 * b0 + wn * 0.0555179;
      b1 = 0.99332 * b1 + wn * 0.0750759;
      b2 = 0.96900 * b2 + wn * 0.1538520;
      b3 = 0.86650 * b3 + wn * 0.3104856;
      b4 = 0.55000 * b4 + wn * 0.5329522;
      b5 = -0.7616 * b5 - wn * 0.0168980;
      const sample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + wn * 0.5362) * 0.11;
      b6 = wn * 0.115926;
      pData[i] = Math.max(-1, Math.min(1, sample));
    }

    this.whiteNoiseBuffer = white;
    this.pinkNoiseBuffer = pink;
  }

  /** Smoothly sweeps the dedicated BGM low-pass filter between muffled (450Hz) and open (20kHz) over 180ms. */
  public setBgmMuffled(muffled: boolean): void {
    if (this.bgmMuffled === muffled) return;
    this.bgmMuffled = muffled;
    const ctx = this.ctx;
    const filter = this.bgmFilter;
    if (!ctx || !filter) return;
    const now = ctx.currentTime;
    const targetHz = muffled ? 450 : 20000;
    const currentHz = Math.max(40, filter.frequency.value || (muffled ? 20000 : 450));
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(currentHz, now);
    filter.frequency.exponentialRampToValueAtTime(targetHz, now + 0.18);
  }

  public isBgmMuffled(): boolean {
    return this.bgmMuffled;
  }

  /**
   * Routes a voice node into dryBus (or bgmFilter when isBgm=true) and optionally into spatial stereo delay send.
   */
  public routeVoice(source: AudioNode, pan = 0, fxAmount = 0, isBgm = false): AudioNode | null {
    const ctx = this.ctx;
    const dry = isBgm ? (this.bgmBus ?? this.dryBus) : this.dryBus;
    if (!ctx || !dry) return null;

    let outNode: AudioNode = source;
    if (Math.abs(pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime);
      source.connect(panner);
      outNode = panner;
    }

    outNode.connect(dry);
    if (fxAmount > 0.005 && this.fxSend && !isBgm) {
      const send = ctx.createGain();
      send.gain.value = Math.min(1, fxAmount);
      outNode.connect(send);
      send.connect(this.fxSend);
      return send;
    }
    return outNode;
  }

  public suspendContext(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  public resumeContext(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  public destroy(): void {
    const nodes: (AudioNode | null)[] = [
      this.bgmBus,
      this.bgmFilter,
      this.dryBus,
      this.fxSend,
      this.delayFilter,
      this.delayL,
      this.delayR,
      this.delayFbL,
      this.delayFbR,
      this.delayMerger,
      this.delayReturn,
      this.shaper,
      this.compressor,
      this.masterGain,
    ];
    for (const n of nodes) {
      try {
        n?.disconnect();
      } catch {
        // Ignore already disconnected nodes
      }
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.bgmBus = null;
    this.bgmFilter = null;
    this.dryBus = null;
    this.fxSend = null;
    this.masterGain = null;
    this.compressor = null;
    this.shaper = null;
    this.delayL = null;
    this.delayR = null;
    this.delayFbL = null;
    this.delayFbR = null;
    this.delayFilter = null;
    this.delayReturn = null;
    this.delayMerger = null;
    this.whiteNoiseBuffer = null;
    this.pinkNoiseBuffer = null;
  }
}
