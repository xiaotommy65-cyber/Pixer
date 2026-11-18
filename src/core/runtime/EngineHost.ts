import type { TextureAtlas } from '../../assets/TextureAtlas.ts';
import { HybridAiDirector, type AiProvider } from '../ai/AiProvider.ts';
import { serializeCartridgeObservation, type UnifiedGameObservation } from '../ai/ObservationSerializer.ts';
import type { SoundPreset, TactilePhase, TactileSwitchProfile, ToySynth } from '../audio/ToySynth.ts';
import type { HapticProfile, HapticSide } from '../hal/HapticEngine.ts';
import { SystemHal } from '../hal/SystemHal.ts';
import { validateCartridgeJson, type CartridgeJsonV1 } from '../sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../sim/DataCartridgeRuntime.ts';
import { FEEDBACK_RECIPES } from '../sim/JuiceSystem.ts';
import {
  DEFAULT_RUNTIME_PARAMS,
  type CartridgeId,
  type CartridgeMeta,
  type FeedbackPreset,
  type InputState,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type ScreenFilterMode,
  type SimEvent,
} from '../types/WorldTypes.ts';
import { appLogger } from './AppLogger.ts';
import {
  CARTRIDGES,
  getCartridgeJson,
  registerCartridgePlugin,
  unregisterCartridgePlugin,
  type CartridgePluginDefinition,
} from './CartridgeRegistry.ts';
import type { CartridgeRunner } from './CartridgeRunner.ts';
import type { EngineEventBus, EngineEventMap } from './EventBus.ts';
import { MAX_CUSTOM_CARTRIDGES, type CardRecord, type CustomCartridgeEntry, type SaveService } from './SaveService.ts';

export interface LoadCartridgeOptions {
  save?: boolean;
  mount?: boolean;
  customId?: string;
  overwrite?: boolean;
  accentHex?: string;
}

export type LoadCartridgeResult =
  | { ok: true; id: CartridgeId; title: string; cartridge: CartridgeJsonV1 }
  | { ok: false; errors: string[] };

/**
 * Clean facade bridging simulation, typed EventBus, Hybrid AI Director, System HAL haptics,
 * persistence, and mascot feedback, keeping views decoupled from internals.
 */
export class EngineHost {
  private readonly runner: CartridgeRunner;
  public readonly hal: SystemHal;
  public readonly events: EngineEventBus;
  public readonly ai: HybridAiDirector;
  private readonly synth: ToySynth;
  private readonly save: SaveService;
  private atlas: TextureAtlas | null = null;
  private onMomoReact?: () => void;
  private lastSavedStageIdx = -1;
  private sramAutoSaveTimer = 0;
  private prevChargeRatio = 0;
  private paused = false;
  private activeCartridgeId: CartridgeId | null = null;
  private readonly busUnsubs: (() => void)[] = [];

  constructor(
    runner: CartridgeRunner,
    synth: ToySynth,
    save: SaveService,
    onMomoReact?: () => void,
    hal?: SystemHal,
  ) {
    this.runner = runner;
    this.events = runner.events;
    this.ai = new HybridAiDirector(this.events);
    this.synth = synth;
    this.save = save;
    this.onMomoReact = onMomoReact;
    this.hal = hal ?? new SystemHal();

    this.hal.setHapticLevel(this.save.getHapticLevel('full'));
    this.hal.setGripMode(this.save.getErgonomicGrip('both'));
    this.hal.haptic.setCallbacks({
      onAcousticFallback: (profile, _level, side) => {
        const switchProfile: TactileSwitchProfile =
          profile === 'impact' || profile === 'celebrate'
            ? 'bumper'
            : profile === 'thump'
              ? 'dpad'
              : profile === 'click'
                ? 'face'
                : 'ui';
        this.synth.playTactile(switchProfile, 'down', side);
      },
    });

    this.runner.setEventListener((ev: SimEvent, detail) => {
      this.synth.queueEvent(ev, detail.combo ?? 0);
      this.dispatchEventHaptic(ev);
      if (ev === 'star' || ev === 'key' || ev === 'win' || ev === 'explode') {
        this.onMomoReact?.();
      }
      if (ev === 'key') {
        this.saveActiveSram();
      }
    });

    this.busUnsubs.push(
      this.events.on('sim:feedback', (payload) => {
        const recipe = FEEDBACK_RECIPES[payload.preset];
        const sound = payload.sound ?? recipe.sound;
        const haptic = payload.haptic ?? recipe.haptic;
        if (sound) {
          this.synth.queueEvent(sound, payload.combo, payload.side ?? 'both');
        }
        if (haptic) {
          this.hal.haptic.trigger(haptic, { side: payload.side ?? 'both', skipAcoustic: true });
        }
      }),
    );
  }

  public bindAtlas(atlas: TextureAtlas): void {
    this.atlas = atlas;
    this.ai.setSpriteSink((sprite) => {
      atlas.registerDynamicRgbaSprite(sprite.id, sprite.width, sprite.height, sprite.rgba);
      this.events.emit('sprite:registered', { spriteId: sprite.id, w: sprite.width, h: sprite.height });
    });
  }

  public emitFeedback(
    preset: FeedbackPreset,
    opts?: {
      intensity?: number;
      combo?: number;
      sound?: SimEvent;
      haptic?: EngineEventMap['sim:feedback']['haptic'];
      side?: HapticSide;
    },
  ): void {
    this.runner.emitFeedback(preset, opts);
  }

  private dispatchEventHaptic(ev: SimEvent): void {
    switch (ev) {
      case 'jump':
        this.hal.haptic.tap('right', { skipAcoustic: true, skipVisual: true });
        break;
      case 'stomp':
        this.hal.haptic.click('right', { skipAcoustic: true });
        break;
      case 'bounce':
      case 'snap':
      case 'charge':
        this.hal.haptic.thump('both', { skipAcoustic: true });
        break;
      case 'hurt':
      case 'explode':
      case 'rail':
        this.hal.haptic.impact('both', { skipAcoustic: true });
        break;
      case 'key':
      case 'win':
        this.hal.haptic.celebrate({ skipAcoustic: true });
        break;
      case 'star':
        this.hal.haptic.tap('both', { skipAcoustic: true, skipVisual: true });
        break;
      default:
        break;
    }
  }

  public unlockAudio(): void {
    this.synth.unlock();
  }

  public playUiSound(preset: SoundPreset): void {
    this.synth.unlock();
    this.synth.playPreset(preset);
  }

  public playTactile(
    profile: TactileSwitchProfile,
    phase: TactilePhase = 'down',
    side: HapticSide = 'both',
  ): void {
    this.synth.unlock();
    this.synth.playTactile(profile, phase, side);
  }

  public triggerHaptic(profile: HapticProfile, side: HapticSide = 'both', skipAcoustic = true): void {
    this.hal.haptic.trigger(profile, { side, skipAcoustic });
  }

  public listCartridges(): readonly CartridgeMeta[] {
    return CARTRIDGES;
  }

  public get activeCartridge(): CartridgeId | null {
    return this.activeCartridgeId;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.synth.stopCharge(false);
      this.prevChargeRatio = 0;
    }
    this.synth.setBgmMuffled(paused);
  }

  public setBgmMuffled(muffled: boolean): void {
    this.synth.setBgmMuffled(muffled);
  }

  public suspendForBackground(): void {
    if (this.activeCartridgeId) {
      this.saveActiveSram();
    }
    this.setPaused(true);
    this.synth.suspendForBackground();
  }

  public resumeFromBackground(): void {
    this.synth.resumeFromBackground();
  }

  public playStereoTick(freqHz: number, pan = 0, gainScale = 0.24): void {
    this.synth.unlock();
    this.synth.playTick(freqHz, pan, gainScale);
  }

  public playIrisChord(direction: 'in' | 'out'): void {
    this.synth.unlock();
    this.synth.playIrisChord(direction);
  }

  public stopBgm(): void {
    this.synth.setBgmTheme(null);
    this.synth.stopCharge(false);
    this.prevChargeRatio = 0;
  }

  public mount(id: CartridgeId, forceFresh = false): boolean {
    if (forceFresh) {
      this.save.clearCartridgeSram(id);
    }
    const resumed = this.insertWithSram(id);
    this.setPaused(false);
    return resumed;
  }

  public unmount(): void {
    if (this.activeCartridgeId) {
      this.saveActiveSram();
      this.activeCartridgeId = null;
    }
    this.setPaused(false);
    this.stopBgm();
  }

  public insertWithSram(id: CartridgeId): boolean {
    this.synth.stopCharge(false);
    this.prevChargeRatio = 0;
    const sram = this.save.getCartridgeSram(id);
    const resumed = this.runner.switchCartridge(id, sram?.data);
    this.activeCartridgeId = id;
    this.lastSavedStageIdx = -1;
    this.sramAutoSaveTimer = 0;
    return resumed;
  }

  public hasSram(id: CartridgeId): boolean {
    return this.save.hasCartridgeSram(id);
  }

  public clearSram(id: CartridgeId): void {
    this.save.clearCartridgeSram(id);
    this.lastSavedStageIdx = -1;
  }

  public restartFresh(): void {
    this.synth.stopCharge(false);
    this.prevChargeRatio = 0;
    const id = this.runner.getCartridgeId();
    this.save.clearCartridgeSram(id);
    this.runner.restart();
    this.lastSavedStageIdx = -1;
    this.sramAutoSaveTimer = 0;
  }

  public retryStage(): void {
    this.synth.stopCharge(false);
    this.prevChargeRatio = 0;
    this.runner.retryStage();
  }

  public saveActiveSram(): void {
    const id = this.runner.getCartridgeId();
    const status = this.runner.getInstance().getStatus();
    if (status === 'won') {
      this.save.clearCartridgeSram(id);
      return;
    }
    const data = this.runner.serializeSave();
    if (data !== null && data !== undefined) {
      const snap = this.runner.getSnapshot();
      this.save.saveCartridgeSram(id, data, snap.stage?.name);
    }
  }

  public stepFrame(dt: number, input: InputState): void {
    if (this.paused) {
      const pausedSnap = this.runner.getSnapshot();
      this.synth.setBgmTheme(
        this.activeCartridgeId && pausedSnap.status === 'playing' ? (pausedSnap.bgmTheme ?? null) : null,
      );
      this.synth.tickBgm(dt);
      return;
    }

    this.runner.update(dt, input);
    const snap = this.runner.getSnapshot();
    const activeCharge =
      snap.status === 'playing' && snap.shmupHud?.phase === 'sortie' ? snap.shmupHud.chargeRatio : 0;
    if (activeCharge > 0) {
      this.synth.updateCharge(activeCharge);
    } else if (this.prevChargeRatio > 0) {
      this.synth.stopCharge(snap.status === 'playing' && snap.shmupHud?.phase === 'sortie');
    }
    this.prevChargeRatio = activeCharge;

    this.synth.flushQueue();
    this.synth.setBgmTheme(snap.status === 'playing' ? (snap.bgmTheme ?? null) : null);
    this.synth.tickBgm(dt);

    if (snap.status === 'won') {
      this.save.clearCartridgeSram(this.runner.getCartridgeId());
      return;
    }

    const stageIdx = snap.stage?.index ?? 1;
    this.sramAutoSaveTimer += dt;
    if (stageIdx !== this.lastSavedStageIdx || this.sramAutoSaveTimer >= 4.0) {
      this.lastSavedStageIdx = stageIdx;
      this.sramAutoSaveTimer = 0;
      this.saveActiveSram();
    }
  }

  public dispatchCommand(commandId: string): void {
    this.runner.dispatchCommand(commandId);
  }

  public toggleBenchmark(force?: boolean): boolean {
    return this.runner.toggleBenchmark(force);
  }

  public isBenchmarkOn(): boolean {
    return this.runner.sparkleBenchmark;
  }

  public toggleDebugHitboxes(force?: boolean): boolean {
    return this.runner.toggleDebugHitboxes(force);
  }

  public getCartridgeId(): CartridgeId {
    return this.runner.getCartridgeId();
  }

  public getSnapshot(): RenderSceneSnapshot {
    return this.runner.getSnapshot();
  }

  public getParams(): RuntimeParams {
    return this.runner.getParams();
  }

  public setParam<K extends keyof RuntimeParams>(key: K, value: RuntimeParams[K]): void {
    this.runner.setParam(key, value);
  }

  public resetParams(): void {
    Object.assign(this.runner.getParams(), DEFAULT_RUNTIME_PARAMS);
  }

  public getSandboxScript(): string {
    return this.runner.getSandboxScript();
  }

  public getDndModuleJson(): string {
    return this.runner.getDndModuleJson();
  }

  public applySandboxScript(code: string): string | null {
    return this.runner.applySandboxScript(code);
  }

  public applyDndModuleJson(jsonSource: string): string | null {
    return this.runner.applyDndModuleJson(jsonSource);
  }

  public getRecord(id: CartridgeId): CardRecord | undefined {
    return this.save.getRecord(id);
  }

  public saveRecord(id: CartridgeId, snap: RenderSceneSnapshot): boolean {
    return this.save.recordProgress(id, snap);
  }

  public getScreenFilter(): ScreenFilterMode {
    return this.save.getScreenFilter('clean');
  }

  public saveScreenFilter(mode: ScreenFilterMode): void {
    this.save.saveScreenFilter(mode);
  }

  public reactMomo(): void {
    this.onMomoReact?.();
  }

  public getUnifiedObservation(): UnifiedGameObservation {
    return serializeCartridgeObservation(this.runner);
  }

  public setAiProvider(provider: AiProvider | null): void {
    this.ai.setProvider(provider);
  }

  public registerCartridgePlugin(def: CartridgePluginDefinition): () => void {
    const dispose = registerCartridgePlugin(def);
    this.events.emit('plugin:registered', { cartridgeId: def.meta.id, title: def.meta.title });
    return () => {
      dispose();
      this.events.emit('plugin:registered', { cartridgeId: def.meta.id, title: def.meta.title });
    };
  }

  public getCartridgeJson(id: CartridgeId): CartridgeJsonV1 | undefined {
    return getCartridgeJson(id);
  }

  public listCustomCartridges(): CustomCartridgeEntry[] {
    return this.save.listCustomCartridges();
  }

  public hasCustomCartridge(id: string): boolean {
    return Boolean(this.save.getCustomCartridge(id));
  }

  public deleteCustomCartridge(id: CartridgeId): boolean {
    if (this.activeCartridgeId === id) {
      this.unmount();
    }
    const removedSave = this.save.deleteCustomCartridge(id);
    const removedPlugin = unregisterCartridgePlugin(id);
    if (removedSave || removedPlugin) {
      this.events.emit('plugin:registered', { cartridgeId: id, title: String(id) });
      return true;
    }
    return false;
  }

  public hydrateSavedCustomCartridges(): number {
    let loaded = 0;
    for (const entry of this.save.listCustomCartridges()) {
      const res = this.loadCartridge(entry.cartridge, {
        save: false,
        mount: false,
        customId: entry.id,
        overwrite: true,
      });
      if (res.ok) loaded++;
    }
    return loaded;
  }

  public loadCartridge(rawJson: unknown, opts?: LoadCartridgeOptions): LoadCartridgeResult {
    let parsed: unknown = rawJson;
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
      } catch (err) {
        appLogger.error('parsing', 'host.loadCartridge', '自訂卡匣 JSON 解析失敗', err);
        return { ok: false, errors: ['JSON 語法解析失敗'] };
      }
    }

    const valid = validateCartridgeJson(parsed);
    if (!valid.ok) {
      appLogger.warn('parsing', 'host.loadCartridge', '自訂卡匣 Schema 驗證失敗', undefined, {
        errors: valid.errors,
      });
      return { ok: false, errors: valid.errors };
    }

    const rawId = (opts?.customId ?? valid.data.meta.id).trim();
    const cleanId =
      rawId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
    const id = cleanId.startsWith('custom-') ? cleanId : `custom-${cleanId}`;

    if (opts?.save) {
      const exists = Boolean(this.save.getCustomCartridge(id));
      if (exists && opts.overwrite === false) {
        return { ok: false, errors: [`自訂卡匣「${id}」已存在`] };
      }
      if (!exists && this.save.listCustomCartridges().length >= MAX_CUSTOM_CARTRIDGES) {
        return {
          ok: false,
          errors: [`已達自訂卡匣上限（${MAX_CUSTOM_CARTRIDGES} 張），請先於工坊刪除舊卡匣`],
        };
      }
    }

    const cartridge = JSON.parse(JSON.stringify(valid.data)) as CartridgeJsonV1;
    cartridge.meta.id = id;

    if (this.atlas && cartridge.sprites) {
      for (const [sid, grid] of Object.entries(cartridge.sprites)) {
        this.atlas.registerDynamicGridSprite(sid, grid);
        this.events.emit('sprite:registered', {
          spriteId: sid,
          w: grid[0]?.length ?? 16,
          h: grid.length,
        });
      }
    }

    this.registerCartridgePlugin({
      meta: {
        id,
        code: cartridge.meta.code || 'CUS',
        title: cartridge.meta.title,
        subtitle: cartridge.meta.subtitle ?? '自訂平台冒險',
        genre: cartridge.meta.genre === 'shmup' ? '自製射擊' : '自製平台',
        accentHex: opts?.accentHex ?? '#ff708d',
        badgeText: '自製 / Polaroid 卡匣',
        controlsHint: '方向移動 · B 跳躍 · A 動作 · L 重試',
        goalHint: cartridge.meta.subtitle ?? cartridge.meta.title,
        defaultScript: '',
      },
      cartridgeJson: cartridge,
      factory: () => new DataCartridgeRuntime(cartridge),
    });

    if (opts?.save) {
      const saved = this.save.saveCustomCartridge(id, cartridge, opts.overwrite ?? true);
      if (!saved.ok) {
        return { ok: false, errors: [saved.error] };
      }
    }

    if (opts?.mount !== false) {
      this.mount(id, true);
    }

    appLogger.success('lifecycle', 'host.loadCartridge', `已載入自訂卡匣「${cartridge.meta.title}」(${id})`, {
      cartridgeId: id,
      saved: Boolean(opts?.save),
      mounted: opts?.mount !== false,
    });
    return { ok: true, id, title: cartridge.meta.title, cartridge };
  }

  public destroy(): void {
    this.stopBgm();
    this.synth.destroy();
    this.ai.setSpriteSink(null);
    for (const off of this.busUnsubs) off();
    this.busUnsubs.length = 0;
    this.events.clear();
    this.hal.destroy();
  }
}
