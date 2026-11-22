import type { LoadedTrackAudio, RhythmAudioEngine } from '../core/audio/RhythmAudioEngine.ts';
import {
  analyzeMonoPcm,
  buildProjectFromAudioPcm,
  generateCameraCuesFromEnergy,
  generateFourChartsFromAnalysis,
} from '../core/rhythm/RhythmAutoCharter.ts';
import { RhythmChartSession } from '../core/rhythm/RhythmChartSession.ts';
import {
  RHYTHM_DIFFICULTIES,
  type RhythmCameraStyle,
  type RhythmDifficulty,
  type RhythmLane,
  type RhythmSongProject,
} from '../core/rhythm/RhythmTypes.ts';
import type { RhythmStorage } from './RhythmStorage.ts';

export interface RhythmChartStudioCallbacks {
  onBackToSelect: () => void;
  onPlaytestFromCursor: (project: RhythmSongProject, difficulty: RhythmDifficulty, startMs: number) => void;
  onProjectSaved: (project: RhythmSongProject) => void;
  onLoadProjectAudio: (project: RhythmSongProject) => Promise<LoadedTrackAudio | null>;
}

const CAMERA_STYLES: readonly { id: RhythmCameraStyle; label: string; color: string }[] = [
  { id: 'CALM', label: '平穩 CALM', color: '#94a3b8' },
  { id: 'BUILD', label: '推進 BUILD', color: '#38bdf8' },
  { id: 'PULSE', label: '脈動 PULSE', color: '#22d3ee' },
  { id: 'DROP', label: '高潮 DROP', color: '#f59e0b' },
  { id: 'TILT_LEFT', label: '左傾 TILT-L', color: '#a78bfa' },
  { id: 'TILT_RIGHT', label: '右傾 TILT-R', color: '#fb7185' },
];

/**
 * DAW-Grade Waveform-Synced Rhythm Chart Editor & Local Audio Auto-Chart Studio.
 * Supports:
 * - Drag & drop / File picker local MP3/WAV/OGG decoding & pure-TS FFT auto-charting
 * - Interactive beat-grid canvas with real waveform underlay, click-to-toggle Tap & drag-to-stretch Hold
 * - 1-4 Live Record Mode while listening at 0.5x / 0.75x / 1.0x speed with metronome & hitsounds
 * - Section Camera Cue stamps, Tap Tempo BPM detector, Chart Health Inspector, Undo/Redo, JSON export/import
 */
export class RhythmChartStudioView {
  public readonly element: HTMLElement;
  private readonly ac = new AbortController();
  private readonly audio: RhythmAudioEngine;
  private readonly storage: RhythmStorage;
  private readonly callbacks: RhythmChartStudioCallbacks;

  private session: RhythmChartSession;
  private loadedAudio: LoadedTrackAudio | null = null;
  private visible = false;

  // Timeline view state
  private playheadMs = 0;
  private pxPerSec = 240;
  private playbackRate = 1.0;
  private metronomeOn = false;
  private hitsoundPreviewOn = true;
  private lastMetronomeBeat = -1;
  private lastHitsoundNoteIdx = -1;
  private lastRenderSig = '';

  // Auto-chart wizard settings
  private autoSensitivity = 1.0;
  private autoChordFactor = 1.0;
  private tapTempoStamps: number[] = [];

  // Pointer drag state for Hold note stretching
  private draggingNote: { lane: RhythmLane; startMs: number; currentMs: number; moved: boolean } | null = null;

  // DOM references
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly diffBtns = new Map<RhythmDifficulty, HTMLButtonElement>();
  private readonly playBtn: HTMLButtonElement;
  private readonly timeReadout: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly statusBanner: HTMLElement;
  private readonly titleInput: HTMLInputElement;
  private readonly bpmInput: HTMLInputElement;
  private readonly offsetInput: HTMLInputElement;
  private readonly levelInput: HTMLInputElement;
  private readonly healthBox: HTMLElement;
  private readonly cameraListBox: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly jsonImportInput: HTMLInputElement;
  private readonly scrubRange: HTMLInputElement;

  constructor(
    initialProject: RhythmSongProject,
    audio: RhythmAudioEngine,
    storage: RhythmStorage,
    callbacks: RhythmChartStudioCallbacks,
  ) {
    this.audio = audio;
    this.storage = storage;
    this.callbacks = callbacks;
    this.session = new RhythmChartSession(initialProject);

    const { signal } = this.ac;
    this.element = document.createElement('section');
    this.element.className = 'rhy-studio panel-hidden';
    this.element.setAttribute('aria-label', '譜面編輯與自動識譜工作站');

    // --- 1. Top Toolbar ---
    const topbar = document.createElement('div');
    topbar.className = 'rhy-studio-toolbar';

    const leftGrp = document.createElement('div');
    leftGrp.className = 'rhy-studio-group';
    const backBtn = this.makeBtn('← 返回選曲', 'rhy-btn', () => {
      this.audio.stop();
      this.callbacks.onBackToSelect();
    });
    this.playBtn = this.makeBtn('▶ 播放 (Space)', 'rhy-btn rhy-btn-accent', () => this.togglePlay());
    this.timeReadout = document.createElement('span');
    this.timeReadout.className = 'rhy-mono rhy-time-readout';
    this.timeReadout.textContent = '00:00.000';

    const rateSelect = document.createElement('select');
    rateSelect.className = 'rhy-select';
    rateSelect.setAttribute('aria-label', '播放倍速');
    for (const r of [0.5, 0.75, 1.0]) {
      const opt = document.createElement('option');
      opt.value = String(r);
      opt.textContent = `${r}x`;
      if (r === 1.0) opt.selected = true;
      rateSelect.appendChild(opt);
    }
    rateSelect.addEventListener(
      'change',
      () => {
        this.playbackRate = Number(rateSelect.value) || 1.0;
        if (this.audio.isPlaying() && this.loadedAudio) {
          this.audio.playTrack(this.loadedAudio, this.playheadMs, this.playbackRate, 0.02);
        }
      },
      { signal },
    );

    const snapSelect = document.createElement('select');
    snapSelect.className = 'rhy-select';
    snapSelect.setAttribute('aria-label', '節拍吸附');
    for (const [div, label] of [
      [1, '1/4 拍'],
      [2, '1/8 拍'],
      [3, '1/12 拍'],
      [4, '1/16 拍'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = String(div);
      opt.textContent = `吸附 ${label}`;
      if (div === 4) opt.selected = true;
      snapSelect.appendChild(opt);
    }
    snapSelect.addEventListener(
      'change',
      () => {
        this.session.setSnapPerBeat(Number(snapSelect.value) || 4);
      },
      { signal },
    );

    const metroBtn = this.makeBtn('節拍器: 關', 'rhy-btn', () => {
      this.metronomeOn = !this.metronomeOn;
      metroBtn.textContent = this.metronomeOn ? '節拍器: 開' : '節拍器: 關';
      metroBtn.classList.toggle('is-active', this.metronomeOn);
    });

    leftGrp.append(backBtn, this.playBtn, this.timeReadout, rateSelect, snapSelect, metroBtn);

    const centerGrp = document.createElement('div');
    centerGrp.className = 'rhy-studio-group';
    for (const diff of RHYTHM_DIFFICULTIES) {
      const btn = this.makeBtn(diff, 'rhy-btn rhy-diff-tab', () => {
        this.session.setActiveDifficulty(diff);
        this.syncUiFromSession();
      });
      this.diffBtns.set(diff, btn);
      centerGrp.appendChild(btn);
    }

    const rightGrp = document.createElement('div');
    rightGrp.className = 'rhy-studio-group';
    this.undoBtn = this.makeBtn('撤銷', 'rhy-btn', () => {
      if (this.session.undo()) this.syncUiFromSession();
    });
    this.redoBtn = this.makeBtn('重做', 'rhy-btn', () => {
      if (this.session.redo()) this.syncUiFromSession();
    });
    const saveBtn = this.makeBtn('儲存譜面', 'rhy-btn', () => this.saveCurrentProject());
    const playtestBtn = this.makeBtn('從游標處試打 (T)', 'rhy-btn rhy-btn-primary', () => {
      this.audio.stop();
      const proj = this.saveCurrentProject(true);
      this.callbacks.onPlaytestFromCursor(proj, this.session.getActiveDifficulty(), Math.max(0, this.playheadMs - 1000));
    });
    rightGrp.append(this.undoBtn, this.redoBtn, saveBtn, playtestBtn);

    topbar.append(leftGrp, centerGrp, rightGrp);

    // --- 2. Main Split Body (Timeline Canvas + Right Inspector) ---
    const body = document.createElement('div');
    body.className = 'rhy-studio-body';

    const timelineWrap = document.createElement('div');
    timelineWrap.className = 'rhy-timeline-wrap';

    const timelineHint = document.createElement('div');
    timelineHint.className = 'rhy-timeline-hint';
    timelineHint.textContent =
      '左鍵點擊增刪單點 · 按住向上拖曳拉出長壓條 · 滾輪捲動時間軸 · 播放時按 1/2/3/4 即時錄譜';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rhy-timeline-canvas';
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Timeline Canvas 2D unavailable');
    this.ctx = ctx;

    const scrubBar = document.createElement('div');
    scrubBar.className = 'rhy-scrub-bar';
    this.scrubRange = document.createElement('input');
    this.scrubRange.type = 'range';
    this.scrubRange.min = '0';
    this.scrubRange.max = String(initialProject.durationMs);
    this.scrubRange.value = '0';
    this.scrubRange.className = 'rhy-scrub-range';
    this.scrubRange.addEventListener(
      'input',
      () => {
        this.seekTo(Number(this.scrubRange.value) || 0);
      },
      { signal },
    );
    scrubBar.appendChild(this.scrubRange);

    timelineWrap.append(timelineHint, this.canvas, scrubBar);

    // --- Right Inspector Pane ---
    const inspector = document.createElement('aside');
    inspector.className = 'rhy-studio-inspector';

    this.statusBanner = document.createElement('div');
    this.statusBanner.className = 'rhy-status-line';
    this.statusBanner.textContent = '準備就緒 · 可直接編輯或匯入本機 MP3/WAV/OGG 自動識譜';

    // Card 1: Audio Upload & Auto-Chart DSP
    const autoSec = this.makeSection('本機音檔匯入與自動識譜 (DSP)');
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.flac';
    this.fileInput.className = 'panel-hidden';
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.handleAudioFileImport(f);
      this.fileInput.value = '';
    }, { signal });

    const uploadBtn = this.makeBtn('匯入本機音檔 (MP3/WAV/OGG) 並自動打譜', 'rhy-btn rhy-btn-primary rhy-full', () => {
      this.fileInput.click();
    });

    const sensRow = this.makeSliderRow('識譜靈敏度', 0.5, 1.5, 0.05, this.autoSensitivity, (v) => {
      this.autoSensitivity = v;
    });
    const chordRow = this.makeSliderRow('雙押密度倍率', 0.5, 1.5, 0.1, this.autoChordFactor, (v) => {
      this.autoChordFactor = v;
    });
    const regenBtn = this.makeBtn('依目前音訊重新生成四段難度譜面', 'rhy-btn rhy-full', () => {
      this.regenerateFromLoadedAudio();
    });
    autoSec.append(this.fileInput, uploadBtn, sensRow, chordRow, regenBtn);

    // Card 2: Track Metadata & Tap Tempo
    const metaSec = this.makeSection('曲目參數與拍點對齊');
    this.titleInput = this.makeField(metaSec, '曲目標題', 'text', initialProject.title, (val) => {
      this.session.updateMetadata({ title: val });
    });
    const bpmRow = document.createElement('div');
    bpmRow.className = 'rhy-inline-row';
    this.bpmInput = this.makeField(bpmRow, 'BPM', 'number', String(initialProject.bpm), (val) => {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 40 && n <= 300) this.session.updateMetadata({ bpm: n });
    });
    this.bpmInput.step = '0.5';
    const tapBtn = this.makeBtn('Tap 測速', 'rhy-btn', () => this.handleTapTempo());
    bpmRow.appendChild(tapBtn);
    metaSec.appendChild(bpmRow);

    const numRow = document.createElement('div');
    numRow.className = 'rhy-inline-row';
    this.offsetInput = this.makeField(numRow, '首拍偏移 (ms)', 'number', String(initialProject.offsetMs), (val) => {
      const n = Number(val);
      if (Number.isFinite(n)) this.session.updateMetadata({ offsetMs: n });
    });
    this.levelInput = this.makeField(numRow, '等級 (1-16)', 'number', '5', (val) => {
      const n = Number(val);
      if (Number.isFinite(n)) this.session.updateMetadata({ level: n });
    });
    metaSec.appendChild(numRow);

    // Card 3: Camera Choreography Cues
    const camSec = this.makeSection('鏡頭運鏡關鍵幀（於目前游標插入）');
    const camGrid = document.createElement('div');
    camGrid.className = 'rhy-cam-btn-grid';
    for (const c of CAMERA_STYLES) {
      const b = this.makeBtn(c.label, 'rhy-btn rhy-btn-sm', () => {
        this.session.addCameraCue(this.playheadMs, c.id, c.id === 'DROP' ? 1.15 : 0.9, c.label);
        this.setStatus(`已在 ${(this.playheadMs / 1000).toFixed(2)}s 插入鏡頭：${c.label}`);
        this.syncUiFromSession();
      });
      camGrid.appendChild(b);
    }
    this.cameraListBox = document.createElement('div');
    this.cameraListBox.className = 'rhy-cam-list';
    camSec.append(camGrid, this.cameraListBox);

    // Card 4: Chart Health & Transforms
    const toolSec = this.makeSection('譜面健檢與批次處理');
    this.healthBox = document.createElement('div');
    this.healthBox.className = 'rhy-health-grid';
    const tfRow = document.createElement('div');
    tfRow.className = 'rhy-inline-row';
    tfRow.append(
      this.makeBtn('鏡像翻轉', 'rhy-btn rhy-btn-sm', () => {
        this.session.mirrorActiveChart();
        this.syncUiFromSession();
      }),
      this.makeBtn('-10ms', 'rhy-btn rhy-btn-sm', () => {
        this.session.shiftActiveChart(-10);
        this.syncUiFromSession();
      }),
      this.makeBtn('+10ms', 'rhy-btn rhy-btn-sm', () => {
        this.session.shiftActiveChart(10);
        this.syncUiFromSession();
      }),
      this.makeBtn('清空本難度', 'rhy-btn rhy-btn-sm rhy-btn-danger', () => {
        this.session.clearActiveChart();
        this.syncUiFromSession();
      }),
    );

    this.jsonImportInput = document.createElement('input');
    this.jsonImportInput.type = 'file';
    this.jsonImportInput.accept = '.json,application/json';
    this.jsonImportInput.className = 'panel-hidden';
    this.jsonImportInput.addEventListener('change', () => {
      const f = this.jsonImportInput.files?.[0];
      if (f) void this.handleJsonImport(f);
      this.jsonImportInput.value = '';
    }, { signal });

    const ioRow = document.createElement('div');
    ioRow.className = 'rhy-inline-row';
    ioRow.append(
      this.makeBtn('匯出 JSON', 'rhy-btn rhy-btn-sm', () => this.exportJsonFile()),
      this.makeBtn('匯入 JSON', 'rhy-btn rhy-btn-sm', () => this.jsonImportInput.click()),
    );
    toolSec.append(this.healthBox, tfRow, ioRow, this.jsonImportInput);

    inspector.append(this.statusBanner, autoSec, metaSec, camSec, toolSec);
    body.append(timelineWrap, inspector);
    this.element.append(topbar, body);

    this.bindCanvasInteractions();
    this.bindKeyboardShortcuts();
    this.syncUiFromSession();
  }

  public async openWithProject(project: RhythmSongProject, difficulty: RhythmDifficulty): Promise<void> {
    this.visible = true;
    this.element.classList.remove('panel-hidden');
    this.session.loadProject(project, true);
    this.session.setActiveDifficulty(difficulty);
    this.playheadMs = 0;
    this.audio.stop();
    this.syncUiFromSession();
    this.setStatus('正在載入音訊波形...');
    this.loadedAudio = await this.callbacks.onLoadProjectAudio(project);
    if (this.loadedAudio) {
      this.setStatus(`已載入音訊（${(this.loadedAudio.durationMs / 1000).toFixed(1)}s · ${project.bpm} BPM）`);
    } else {
      this.setStatus('音訊未找到，可重新匯入本機音檔');
    }
  }

  public hide(): void {
    this.visible = false;
    this.audio.stop();
    this.element.classList.add('panel-hidden');
  }

  public isVisible(): boolean {
    return this.visible;
  }

  /** Trigger local audio import dialog directly from Song Select shortcut */
  public promptAudioImport(): void {
    this.fileInput.click();
  }

  public tick(): void {
    if (!this.visible) return;
    const proj = this.session.getProject();
    const isPlaying = this.audio.isPlaying();

    if (isPlaying) {
      this.playheadMs = Math.max(0, Math.min(proj.durationMs, this.audio.getCurrentSongTimeMs(0)));
      this.scrubRange.value = String(Math.round(this.playheadMs));
      this.triggerPlaybackCues(proj);
      if (this.playheadMs >= proj.durationMs - 60) {
        this.audio.stop();
        this.playBtn.textContent = '▶ 播放 (Space)';
      }
    }

    const rect = this.canvas.getBoundingClientRect();
    const sig = `${Math.round(this.playheadMs)}:${this.pxPerSec}:${this.session.getActiveDifficulty()}:${this.session.getSnapPerBeat()}:${this.session.getRevision()}:${this.loadedAudio?.key ?? ''}:${this.draggingNote ? `${this.draggingNote.lane}:${Math.round(this.draggingNote.currentMs)}` : ''}:${Math.floor(rect.width)}x${Math.floor(rect.height)}`;
    if (!isPlaying && sig === this.lastRenderSig) return;
    this.lastRenderSig = sig;

    this.timeReadout.textContent = formatMsClock(this.playheadMs);
    this.renderTimeline();
  }

  private triggerPlaybackCues(proj: RhythmSongProject): void {
    if (this.metronomeOn) {
      const beatMs = 60000 / Math.max(40, proj.bpm);
      const beatIdx = Math.floor((this.playheadMs - proj.offsetMs) / beatMs);
      if (beatIdx !== this.lastMetronomeBeat && beatIdx >= 0) {
        this.lastMetronomeBeat = beatIdx;
        this.audio.playMetronomeClick(beatIdx % 4 === 0);
      }
    }
    if (this.hitsoundPreviewOn) {
      const notes = this.session.getActiveNotes();
      let idx = this.lastHitsoundNoteIdx + 1;
      while (idx < notes.length && notes[idx].timeMs <= this.playheadMs) {
        if (this.playheadMs - notes[idx].timeMs < 65) {
          this.audio.playHitsound('clap', Boolean(notes[idx].isChord));
        }
        this.lastHitsoundNoteIdx = idx;
        idx++;
      }
    }
  }

  private togglePlay(): void {
    if (!this.loadedAudio) return;
    if (this.audio.isPlaying()) {
      this.playheadMs = this.audio.pause();
      this.playBtn.textContent = '▶ 播放 (Space)';
      return;
    }
    const proj = this.session.getProject();
    if (this.playheadMs >= proj.durationMs - 200) this.playheadMs = 0;
    this.syncCueCursors(this.playheadMs);
    this.audio.playTrack(this.loadedAudio, this.playheadMs, this.playbackRate, 0.02);
    this.playBtn.textContent = '⏸ 暫停 (Space)';
  }

  private seekTo(ms: number): void {
    const proj = this.session.getProject();
    this.playheadMs = Math.max(0, Math.min(proj.durationMs, Math.round(ms)));
    this.scrubRange.value = String(this.playheadMs);
    this.syncCueCursors(this.playheadMs);
    if (this.audio.isPlaying() && this.loadedAudio) {
      this.audio.playTrack(this.loadedAudio, this.playheadMs, this.playbackRate, 0.02);
    } else {
      this.audio.setPausedTimeMs(this.playheadMs);
    }
  }

  private syncCueCursors(ms: number): void {
    const proj = this.session.getProject();
    const beatMs = 60000 / Math.max(40, proj.bpm);
    this.lastMetronomeBeat = Math.floor((ms - proj.offsetMs) / beatMs);
    const notes = this.session.getActiveNotes();
    let idx = -1;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].timeMs < ms) idx = i;
      else break;
    }
    this.lastHitsoundNoteIdx = idx;
  }

  private async handleAudioFileImport(file: File): Promise<void> {
    this.audio.stop();
    this.playBtn.textContent = '▶ 播放 (Space)';
    this.setStatus(`正在解碼「${file.name}」並執行 FFT 自動識譜...`);
    try {
      const arrayBuf = await file.arrayBuffer();
      const storageKey = `audio_${Date.now().toString(36)}_${Math.floor(Math.random() * 9999)}`;
      await this.storage.saveAudioBlob(storageKey, arrayBuf);
      const loaded = await this.audio.decodeAudioArrayBuffer(storageKey, arrayBuf);

      const baseTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 42) || 'Imported Track';
      const { project, analysis } = buildProjectFromAudioPcm({
        id: `custom-${Date.now().toString(36)}`,
        title: baseTitle,
        artist: 'Imported Audio',
        fileName: file.name,
        storageKey,
        monoPcm: loaded.monoPcm,
        sampleRate: loaded.sampleRate,
        options: {
          sensitivity: this.autoSensitivity,
          chordFactor: this.autoChordFactor,
        },
      });

      this.loadedAudio = loaded;
      this.session.loadProject(project, true);
      this.playheadMs = 0;
      this.storage.saveCustomProject(project);
      this.callbacks.onProjectSaved(project);
      this.syncUiFromSession();
      this.setStatus(
        `自動識譜完成！偵測 ${analysis.bpm} BPM · Offset ${analysis.offsetMs}ms · 擷取 ${analysis.onsets.length} 個音訊瞬態，四段難度已就緒`,
      );
    } catch (err) {
      this.setStatus(`音檔解碼失敗：${err instanceof Error ? err.message : '不支援的格式'}`);
    }
  }

  private regenerateFromLoadedAudio(): void {
    if (!this.loadedAudio) {
      this.setStatus('尚未載入音訊，請先選擇曲目或匯入音檔');
      return;
    }
    const proj = this.session.getProject();
    const analysis = analyzeMonoPcm(this.loadedAudio.monoPcm, this.loadedAudio.sampleRate, {
      bpmOverride: proj.bpm,
      offsetOverrideMs: proj.offsetMs,
    });
    const charts = generateFourChartsFromAnalysis(analysis, {
      sensitivity: this.autoSensitivity,
      chordFactor: this.autoChordFactor,
      bpmOverride: proj.bpm,
      offsetOverrideMs: proj.offsetMs,
    });
    const cues = generateCameraCuesFromEnergy(
      analysis.energyCurve,
      analysis.energyStepMs,
      proj.bpm,
      proj.offsetMs,
    );
    this.session.replaceChartsAndCues(charts, cues, proj.bpm, proj.offsetMs);
    this.syncUiFromSession();
    this.setStatus(
      `已重新生成四段難度譜面（EASY ${charts.EASY.notes.length} / NORMAL ${charts.NORMAL.notes.length} / HARD ${charts.HARD.notes.length} / MASTER ${charts.MASTER.notes.length}）`,
    );
  }

  private handleTapTempo(): void {
    const now = performance.now();
    if (this.tapTempoStamps.length > 0 && now - this.tapTempoStamps[this.tapTempoStamps.length - 1] > 2200) {
      this.tapTempoStamps = [];
    }
    this.tapTempoStamps.push(now);
    if (this.tapTempoStamps.length > 8) this.tapTempoStamps.shift();
    if (this.tapTempoStamps.length >= 3) {
      let sum = 0;
      for (let i = 1; i < this.tapTempoStamps.length; i++) {
        sum += this.tapTempoStamps[i] - this.tapTempoStamps[i - 1];
      }
      const avgMs = sum / (this.tapTempoStamps.length - 1);
      const bpm = Math.max(60, Math.min(240, Math.round((60000 / avgMs) * 10) / 10));
      this.session.updateMetadata({ bpm });
      this.syncUiFromSession();
      this.setStatus(`Tap Tempo 測得 ${bpm} BPM（已更新）`);
    } else {
      this.setStatus('請連續敲擊 3 下以上以計算 BPM...');
    }
  }

  private saveCurrentProject(silent = false): RhythmSongProject {
    const cur = this.session.getProject();
    const saved: RhythmSongProject = {
      ...JSON.parse(JSON.stringify(cur)),
      isCustom: true,
    };
    if (!cur.isCustom) {
      saved.id = `remix-${cur.id}-${Date.now().toString(36).slice(-4)}`;
      if (!saved.title.includes('Remix')) saved.title = `${saved.title} (Edit)`;
      this.session.loadProject(saved, false);
    }
    this.storage.saveCustomProject(saved);
    this.callbacks.onProjectSaved(saved);
    if (!silent) {
      this.setStatus(`已儲存譜面「${saved.title}」至曲庫`);
    }
    return saved;
  }

  private exportJsonFile(): void {
    const proj = this.session.getProject();
    const blob = new Blob([this.session.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${proj.id}.rhythm.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.setStatus(`已匯出 ${proj.id}.rhythm.json`);
  }

  private async handleJsonImport(file: File): Promise<void> {
    const text = await file.text();
    const res = this.session.importJson(text);
    if (!res.ok) {
      this.setStatus(`匯入失敗：${res.error}`);
      return;
    }
    this.loadedAudio = await this.callbacks.onLoadProjectAudio(res.project);
    this.syncUiFromSession();
    this.setStatus(`已匯入譜面「${res.project.title}」`);
  }

  private bindCanvasInteractions(): void {
    const { signal } = this.ac;

    const pointerToLaneAndMs = (e: PointerEvent): { lane: RhythmLane | -1; timeMs: number } => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const geom = this.getTimelineGeom(rect.width, rect.height);
      const relX = x - geom.gridLeft;
      const lane =
        relX >= 0 && relX <= geom.gridW
          ? (Math.min(3, Math.max(0, Math.floor(relX / geom.laneW))) as RhythmLane)
          : -1;
      const deltaY = geom.playheadY - y;
      const timeMs = Math.max(0, this.playheadMs + (deltaY / this.pxPerSec) * 1000);
      return { lane, timeMs };
    };

    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        const { lane, timeMs } = pointerToLaneAndMs(e);
        if (lane === -1) return;
        this.canvas.setPointerCapture(e.pointerId);
        this.draggingNote = { lane, startMs: timeMs, currentMs: timeMs, moved: false };
      },
      { signal },
    );

    this.canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.draggingNote) return;
        const { timeMs } = pointerToLaneAndMs(e);
        if (Math.abs(timeMs - this.draggingNote.startMs) > 90) {
          this.draggingNote.moved = true;
        }
        this.draggingNote.currentMs = timeMs;
      },
      { signal },
    );

    this.canvas.addEventListener(
      'pointerup',
      (e) => {
        if (!this.draggingNote) return;
        const drag = this.draggingNote;
        this.draggingNote = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) {
          this.canvas.releasePointerCapture(e.pointerId);
        }
        if (drag.moved) {
          this.session.addOrUpdateHoldNote(drag.lane, drag.startMs, drag.currentMs);
        } else {
          this.session.toggleTapNote(drag.lane, drag.startMs);
        }
        this.audio.playHitsound('tick', drag.moved);
        this.syncUiFromSession();
      },
      { signal },
    );

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          this.pxPerSec = Math.max(120, Math.min(480, this.pxPerSec - e.deltaY * 0.25));
        } else {
          const deltaMs = (-e.deltaY / this.pxPerSec) * 1000 * 1.4;
          this.seekTo(this.playheadMs + deltaMs);
        }
      },
      { signal, passive: false },
    );
  }

  private bindKeyboardShortcuts(): void {
    const { signal } = this.ac;
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.visible) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if (e.code === 'Space') {
          e.preventDefault();
          this.togglePlay();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey ? this.session.redo() : this.session.undo()) this.syncUiFromSession();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
          e.preventDefault();
          if (this.session.redo()) this.syncUiFromSession();
          return;
        }
        if (e.code === 'KeyT') {
          e.preventDefault();
          this.audio.stop();
          const proj = this.saveCurrentProject(true);
          this.callbacks.onPlaytestFromCursor(proj, this.session.getActiveDifficulty(), Math.max(0, this.playheadMs - 1000));
          return;
        }
        // Live Record 1-4 keys while listening!
        const liveLaneMap: Record<string, RhythmLane> = {
          Digit1: 0,
          Digit2: 1,
          Digit3: 2,
          Digit4: 3,
        };
        if (e.code in liveLaneMap && !e.repeat) {
          e.preventDefault();
          const lane = liveLaneMap[e.code];
          this.session.toggleTapNote(lane, this.playheadMs);
          this.audio.playHitsound('clap', false);
          this.syncUiFromSession();
        }
      },
      { signal },
    );
  }

  private syncUiFromSession(): void {
    const proj = this.session.getProject();
    const diff = this.session.getActiveDifficulty();
    const chart = proj.charts[diff];

    for (const [d, btn] of this.diffBtns.entries()) {
      btn.classList.toggle('is-active', d === diff);
      btn.textContent = `${d} (${proj.charts[d].notes.length})`;
    }

    this.undoBtn.disabled = !this.session.canUndo();
    this.redoBtn.disabled = !this.session.canRedo();
    this.titleInput.value = proj.title;
    this.bpmInput.value = String(proj.bpm);
    this.offsetInput.value = String(proj.offsetMs);
    this.levelInput.value = String(chart.level);
    this.scrubRange.max = String(proj.durationMs);

    const h = this.session.getHealthReport(diff);
    this.healthBox.replaceChildren();
    const metrics: [string, string][] = [
      ['總音符', `${h.totalNotes}`],
      ['單點 / 長壓', `${h.tapCount} / ${h.holdCount}`],
      ['雙押組數', `${h.chordGroups}`],
      ['平均 / 峰值 NPS', `${h.avgNps} / ${h.peakNps}`],
      ['建議等級', `Lv.${h.suggestedLevel}`],
      [
        '健檢狀態',
        h.overlapWarnings === 0 && h.rapidJackWarnings === 0
          ? '良好'
          : `重疊 ${h.overlapWarnings} · 急連 ${h.rapidJackWarnings}`,
      ],
    ];
    for (const [k, v] of metrics) {
      const cell = document.createElement('div');
      cell.className = 'rhy-health-cell';
      const lbl = document.createElement('span');
      lbl.className = 'rhy-health-k';
      lbl.textContent = k;
      const val = document.createElement('span');
      val.className = 'rhy-health-v rhy-mono';
      val.textContent = v;
      cell.append(lbl, val);
      this.healthBox.appendChild(cell);
    }

    this.cameraListBox.replaceChildren();
    for (const cue of proj.cameraCues) {
      const row = document.createElement('div');
      row.className = 'rhy-cam-item';
      const info = document.createElement('button');
      info.type = 'button';
      info.className = 'rhy-cam-jump';
      info.textContent = `${(cue.timeMs / 1000).toFixed(1)}s · ${cue.style}`;
      info.addEventListener('click', () => this.seekTo(cue.timeMs));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rhy-cam-del';
      del.textContent = '×';
      del.disabled = proj.cameraCues.length <= 1;
      del.addEventListener('click', () => {
        if (this.session.removeCameraCue(cue.id)) this.syncUiFromSession();
      });
      row.append(info, del);
      this.cameraListBox.appendChild(row);
    }
  }

  private renderTimeline(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(260, Math.floor(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, w, h);

    const geom = this.getTimelineGeom(w, h);
    const proj = this.session.getProject();
    const msToY = (ms: number) => geom.playheadY - ((ms - this.playheadMs) / 1000) * this.pxPerSec;
    const minVisibleMs = Math.max(0, this.playheadMs - ((h - geom.playheadY) / this.pxPerSec) * 1000 - 200);
    const maxVisibleMs = Math.min(proj.durationMs, this.playheadMs + (geom.playheadY / this.pxPerSec) * 1000 + 200);

    // 1. Waveform Peak Underlay (Left & Right mirrored behind lanes)
    if (this.loadedAudio) {
      const peaks = this.loadedAudio.waveformPeaks;
      const dur = Math.max(1, this.loadedAudio.durationMs);
      const centerX = geom.gridLeft + geom.gridW * 0.5;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      for (let py = 0; py < h; py += 3) {
        const ms = this.playheadMs + ((geom.playheadY - py) / this.pxPerSec) * 1000;
        if (ms < 0 || ms > dur) continue;
        const idx = Math.min(peaks.length - 1, Math.floor((ms / dur) * peaks.length));
        const amp = peaks[idx] * (geom.gridW * 0.48);
        ctx.fillRect(centerX - amp, py, amp * 2, 2);
      }
    }

    // 2. Lane Columns
    ctx.fillStyle = 'rgba(15, 23, 42, 0.52)';
    ctx.fillRect(geom.gridLeft, 0, geom.gridW, h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    for (let l = 0; l <= 4; l++) {
      const lx = geom.gridLeft + l * geom.laneW;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, h);
      ctx.stroke();
    }

    // 3. Snap & Beat Grid Lines
    const beatMs = 60000 / Math.max(40, proj.bpm);
    const snapDiv = this.session.getSnapPerBeat();
    const stepMs = beatMs / snapDiv;
    const startSlot = Math.floor((minVisibleMs - proj.offsetMs) / stepMs);
    const endSlot = Math.ceil((maxVisibleMs - proj.offsetMs) / stepMs);

    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let s = startSlot; s <= endSlot; s++) {
      const tMs = proj.offsetMs + s * stepMs;
      if (tMs < 0) continue;
      const y = msToY(tMs);
      if (y < -4 || y > h + 4) continue;
      const isBeat = ((s % snapDiv) + snapDiv) % snapDiv === 0;
      const beatIdx = Math.round(s / snapDiv);
      const isMeasure = isBeat && ((beatIdx % 4) + 4) % 4 === 0;

      ctx.strokeStyle = isMeasure
        ? 'rgba(248, 250, 252, 0.36)'
        : isBeat
          ? 'rgba(148, 163, 184, 0.20)'
          : 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = isMeasure ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(geom.gridLeft, y);
      ctx.lineTo(geom.gridLeft + geom.gridW, y);
      ctx.stroke();

      if (isMeasure) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`M${Math.floor(beatIdx / 4) + 1}`, geom.gridLeft - 10, y);
      }
    }

    // 4. Camera Cue Flags on Right Rail
    for (const cue of proj.cameraCues) {
      if (cue.timeMs < minVisibleMs || cue.timeMs > maxVisibleMs) continue;
      const y = msToY(cue.timeMs);
      const styleMeta = CAMERA_STYLES.find((c) => c.id === cue.style);
      const col = styleMeta?.color ?? '#38bdf8';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(geom.gridLeft + geom.gridW, y);
      ctx.lineTo(geom.gridLeft + geom.gridW + 14, y);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = 'left';
      ctx.fillText(cue.style, geom.gridLeft + geom.gridW + 18, y);
    }

    // 5. Render Notes & Holds
    const notes = this.session.getActiveNotes();
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.timeMs + n.durationMs < minVisibleMs) continue;
      if (n.timeMs > maxVisibleMs) break;

      const lx = geom.gridLeft + n.lane * geom.laneW;
      const yHead = msToY(n.timeMs);
      const isOuter = n.lane === 0 || n.lane === 3;
      const col = isOuter ? '#38bdf8' : '#f59e0b';

      if (n.durationMs > 0) {
        const yTail = msToY(n.timeMs + n.durationMs);
        ctx.fillStyle = isOuter ? 'rgba(56, 189, 248, 0.42)' : 'rgba(245, 158, 11, 0.42)';
        ctx.fillRect(lx + 14, yTail, geom.laneW - 28, Math.max(4, yHead - yTail));
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(lx + 12, yTail - 2, geom.laneW - 24, 4);
      }

      ctx.fillStyle = col;
      ctx.fillRect(lx + 6, yHead - 6, geom.laneW - 12, 12);
      if (n.isChord) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(lx + 6, yHead - 6, geom.laneW - 12, 12);
      }
    }

    // 6. Active Drag Preview
    if (this.draggingNote) {
      const sMs = this.session.snapTimeMs(Math.min(this.draggingNote.startMs, this.draggingNote.currentMs));
      const eMs = this.session.snapTimeMs(Math.max(this.draggingNote.startMs, this.draggingNote.currentMs));
      const lx = geom.gridLeft + this.draggingNote.lane * geom.laneW;
      const y0 = msToY(sMs);
      const y1 = msToY(eMs);
      ctx.fillStyle = 'rgba(248, 250, 252, 0.35)';
      ctx.fillRect(lx + 10, y1, geom.laneW - 20, Math.max(10, y0 - y1));
    }

    // 7. Crisp Playhead Judgement Line & Lane Keys
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(geom.gridLeft - 14, geom.playheadY - 2, geom.gridW + 28, 3);
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const labels = ['D / 1', 'F / 2', 'J / 3', 'K / 4'];
    for (let l = 0; l < 4; l++) {
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(labels[l], geom.gridLeft + (l + 0.5) * geom.laneW, geom.playheadY + 18);
    }

    ctx.restore();
  }

  private getTimelineGeom(w: number, h: number): {
    gridLeft: number;
    gridW: number;
    laneW: number;
    playheadY: number;
  } {
    const gridW = Math.min(420, Math.max(260, w - 180));
    return {
      gridLeft: Math.round((w - gridW) * 0.45),
      gridW,
      laneW: gridW / 4,
      playheadY: Math.round(h * 0.78),
    };
  }

  private setStatus(msg: string): void {
    this.statusBanner.textContent = msg;
  }

  private makeBtn(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', onClick, { signal: this.ac.signal });
    return btn;
  }

  private makeSection(title: string): HTMLElement {
    const box = document.createElement('div');
    box.className = 'rhy-studio-card';
    const h = document.createElement('h3');
    h.className = 'rhy-studio-card-title';
    h.textContent = title;
    box.appendChild(h);
    return box;
  }

  private makeField(
    parent: HTMLElement,
    label: string,
    type: string,
    value: string,
    onChange: (val: string) => void,
  ): HTMLInputElement {
    const wrap = document.createElement('label');
    wrap.className = 'rhy-field';
    const sp = document.createElement('span');
    sp.className = 'rhy-field-label';
    sp.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    input.className = 'rhy-input';
    input.addEventListener('change', () => onChange(input.value), { signal: this.ac.signal });
    wrap.append(sp, input);
    parent.appendChild(wrap);
    return input;
  }

  private makeSliderRow(
    label: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    onInput: (v: number) => void,
  ): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'rhy-slider-row';
    const head = document.createElement('div');
    head.className = 'rhy-slider-head';
    const nameEl = document.createElement('span');
    nameEl.textContent = label;
    const valEl = document.createElement('span');
    valEl.className = 'rhy-mono';
    valEl.textContent = initial.toFixed(2);
    head.append(nameEl, valEl);

    const rng = document.createElement('input');
    rng.type = 'range';
    rng.min = String(min);
    rng.max = String(max);
    rng.step = String(step);
    rng.value = String(initial);
    rng.addEventListener(
      'input',
      () => {
        const v = Number(rng.value);
        valEl.textContent = v.toFixed(2);
        onInput(v);
      },
      { signal: this.ac.signal },
    );
    wrap.append(head, rng);
    return wrap;
  }

  public destroy(): void {
    this.audio.stop();
    this.ac.abort();
    this.element.remove();
  }
}

function formatMsClock(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const mins = Math.floor(safe / 60000);
  const secs = Math.floor((safe % 60000) / 1000);
  const rem = safe % 1000;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(rem).padStart(3, '0')}`;
}
