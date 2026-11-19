import { SANDBOX_DEFAULT_SCRIPT } from '../../assets/WorkshopRecipes.ts';
import { GAME_H, GAME_W } from '../gpu/GpuTypes.ts';
import {
  createEmptyInputState,
  DEFAULT_RUNTIME_PARAMS,
  isComboTrackingCartridge,
  isDebuggableCartridge,
  type CartridgeId,
  type CartridgeInstance,
  type FeedbackPreset,
  type InputState,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type SimEvent,
  type SimEventDetail,
} from '../types/WorldTypes.ts';
import { appLogger } from './AppLogger.ts';
import { createCartridgeInstance, getCartridgeMeta } from './CartridgeRegistry.ts';
import { EngineEventBus, type EngineEventMap } from './EventBus.ts';

export const STEP_DT = 1 / 60;
const BENCHMARK_COLORS = ['#ffd447', '#ff708d', '#56d39c', '#5ec2f7', '#e0aaff', '#fffaf0'];

export interface BenchmarkSprite {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  sprite: 'star_a' | 'sparkle' | 'heart_full';
  tint: string;
  size: number;
}

export class CartridgeRunner {
  public readonly events = new EngineEventBus();
  private cartridgeId: CartridgeId = 'cloudberry-hop';
  private instance: CartridgeInstance;
  private params: RuntimeParams = { ...DEFAULT_RUNTIME_PARAMS };
  private sandboxScript = SANDBOX_DEFAULT_SCRIPT;
  private dndModuleJson?: string;
  private accumulator = 0;
  private interpolating = false;
  private eventListener?: (ev: SimEvent, detail: SimEventDetail) => void;
  private prevRestart = false;
  private debugHitboxes = false;
  private lastEmittedStageIdx = -1;
  private cachedSnapshot: RenderSceneSnapshot | null = null;
  private cachedSnapAlpha = -1;
  private snapshotDirty = true;
  private readonly pendingLatchInput: InputState = createEmptyInputState();
  private hasPendingLatch = false;

  public sparkleBenchmark = false;
  public benchmarkSprites: BenchmarkSprite[] = [];

  constructor(initialId: CartridgeId = 'cloudberry-hop') {
    this.cartridgeId = initialId;
    this.instance = this.createInstance(initialId);
  }

  public invalidateSnapshot(): void {
    this.snapshotDirty = true;
    this.cachedSnapshot = null;
  }

  private createInstance(id: CartridgeId): CartridgeInstance {
    const inst = createCartridgeInstance(id, {
      sandboxScript: this.sandboxScript,
      dndModuleJson: this.dndModuleJson,
      params: this.params,
    });
    if (isDebuggableCartridge(inst)) {
      inst.setDebugHitboxes(this.debugHitboxes);
    }
    return inst;
  }

  public getInstance(): CartridgeInstance {
    return this.instance;
  }

  public setEventListener(listener: (ev: SimEvent, detail: SimEventDetail) => void): void {
    this.eventListener = listener;
  }

  public getCartridgeId(): CartridgeId {
    return this.cartridgeId;
  }

  public toggleDebugHitboxes(force?: boolean): boolean {
    this.debugHitboxes = force ?? !this.debugHitboxes;
    if (isDebuggableCartridge(this.instance)) {
      this.instance.setDebugHitboxes(this.debugHitboxes);
    }
    this.invalidateSnapshot();
    return this.debugHitboxes;
  }

  public switchCartridge(id: CartridgeId, savedSram?: unknown): boolean {
    this.cartridgeId = id;
    this.accumulator = 0;
    this.lastEmittedStageIdx = -1;
    this.hasPendingLatch = false;
    this.invalidateSnapshot();
    this.instance = this.createInstance(id);
    let resumed = false;
    if (savedSram !== undefined && savedSram !== null && this.instance.hydrateSave) {
      // Guard SRAM hydration: corrupted or schema-mismatched saved data must never crash
      // cartridge boot; catch and fall back cleanly to a fresh stage start.
      try {
        resumed = this.instance.hydrateSave(savedSram);
      } catch (err) {
        appLogger.warn(
          'parsing',
          'cartridge.hydrateSram',
          `卡匣 SRAM 還原失敗 (${id})，已自動從頭開始`,
          err,
          { cartridgeId: id },
        );
        this.instance = this.createInstance(id);
        resumed = false;
      }
    }
    this.events.emit('cartridge:mounted', { id, resumedSram: resumed });
    appLogger.success('lifecycle', 'cartridge.mount', `已載入卡匣「${id}」`, {
      cartridgeId: id,
      resumedSram: resumed,
    });
    return resumed;
  }

  public restart(): void {
    this.accumulator = 0;
    this.lastEmittedStageIdx = -1;
    this.hasPendingLatch = false;
    this.invalidateSnapshot();
    this.instance = this.createInstance(this.cartridgeId);
    this.events.emit('cartridge:restarted', { id: this.cartridgeId });
    appLogger.info('lifecycle', 'cartridge.restart', `已重新啟動卡匣「${this.cartridgeId}」`, {
      cartridgeId: this.cartridgeId,
    });
  }

  public retryStage(): void {
    this.accumulator = 0;
    this.lastEmittedStageIdx = -1;
    this.hasPendingLatch = false;
    this.invalidateSnapshot();
    if (this.instance.retryStage) {
      this.instance.retryStage();
    } else {
      this.instance = this.createInstance(this.cartridgeId);
    }
    this.events.emit('cartridge:restarted', { id: this.cartridgeId });
    appLogger.info('lifecycle', 'cartridge.retryStage', `已重試當前關卡 (${this.cartridgeId})`, {
      cartridgeId: this.cartridgeId,
    });
  }

  public serializeSave(): unknown {
    try {
      return this.instance.serializeSave?.() ?? null;
    } catch (err) {
      appLogger.error('storage', 'cartridge.serializeSave', `卡匣 SRAM 序列化異常 (${this.cartridgeId})`, err, {
        cartridgeId: this.cartridgeId,
      });
      return null;
    }
  }

  public hydrateSave(raw: unknown): boolean {
    try {
      const ok = this.instance.hydrateSave?.(raw) ?? false;
      if (ok) this.invalidateSnapshot();
      return ok;
    } catch (err) {
      appLogger.warn('parsing', 'cartridge.hydrateSave', `手動還原卡匣存檔失敗 (${this.cartridgeId})`, err, {
        cartridgeId: this.cartridgeId,
      });
      return false;
    }
  }

  public getParams(): RuntimeParams {
    return this.params;
  }

  public setParam<K extends keyof RuntimeParams>(key: K, value: RuntimeParams[K]): void {
    this.params[key] = value;
    this.invalidateSnapshot();
    if (key === 'enemyCount' && this.cartridgeId === 'sandbox-toybox') {
      this.instance = this.createInstance('sandbox-toybox');
    }
  }

  public getSandboxScript(): string {
    return this.sandboxScript;
  }

  public getDndModuleJson(): string {
    return this.dndModuleJson ?? getCartridgeMeta('emberkeep-dnd').defaultScript;
  }

  public getSandboxError(): string | null {
    return this.cartridgeId === 'sandbox-toybox' ? (this.instance.scriptError ?? null) : null;
  }

  public applySandboxScript(code: string): string | null {
    this.sandboxScript = code;
    this.cartridgeId = 'sandbox-toybox';
    this.lastEmittedStageIdx = -1;
    this.invalidateSnapshot();
    const sb = this.createInstance('sandbox-toybox');
    this.instance = sb;
    this.accumulator = 0;
    this.interpolating = false;
    this.events.emit('cartridge:mounted', { id: 'sandbox-toybox', resumedSram: false });
    return sb.scriptError ?? null;
  }

  public applyDndModuleJson(jsonSource: string): string | null {
    const prev = this.dndModuleJson;
    this.dndModuleJson = jsonSource;
    try {
      const inst = createCartridgeInstance('emberkeep-dnd', {
        sandboxScript: this.sandboxScript,
        dndModuleJson: jsonSource,
        params: this.params,
      });
      if (inst.scriptError) {
        this.dndModuleJson = prev;
        return inst.scriptError;
      }
      if (isDebuggableCartridge(inst)) {
        inst.setDebugHitboxes(this.debugHitboxes);
      }
      this.cartridgeId = 'emberkeep-dnd';
      this.lastEmittedStageIdx = -1;
      this.invalidateSnapshot();
      this.instance = inst;
      this.accumulator = 0;
      this.interpolating = false;
      this.hasPendingLatch = false;
      this.events.emit('cartridge:mounted', { id: 'emberkeep-dnd', resumedSram: false });
      appLogger.success('parsing', 'cartridge.applyDndModule', '已套用自訂 D&D 地牢模組 JSON 並啟動卡匣', {
        rawBytes: jsonSource.length,
      });
      return null;
    } catch (err) {
      // Restore previous valid module if runtime world construction threw unexpectedly
      this.dndModuleJson = prev;
      appLogger.error('parsing', 'cartridge.applyDndModule', '建構自訂 D&D 地牢實例失敗，已恢復先前劇本', err);
      return err instanceof Error ? err.message : String(err);
    }
  }

  public emitFeedback(
    preset: FeedbackPreset,
    opts?: {
      intensity?: number;
      combo?: number;
      sound?: SimEvent;
      haptic?: EngineEventMap['sim:feedback']['haptic'];
      side?: 'left' | 'right' | 'both';
    },
  ): void {
    this.events.emit('sim:feedback', {
      cartridgeId: this.cartridgeId,
      preset,
      intensity: opts?.intensity ?? 1.0,
      combo: opts?.combo ?? 0,
      sound: opts?.sound,
      haptic: opts?.haptic,
      side: opts?.side,
    });
  }

  public dispatchCommand(commandId: string): void {
    const events = this.instance.dispatchCommand?.(commandId) ?? [];
    this.invalidateSnapshot();
    for (const ev of events) {
      this.events.emit('sim:event', { cartridgeId: this.cartridgeId, event: ev, combo: 0 });
      this.eventListener?.(ev, { kind: ev, combo: 0 });
    }
  }

  public toggleBenchmark(force?: boolean): boolean {
    const next = force ?? !this.sparkleBenchmark;
    this.sparkleBenchmark = next;
    if (next && this.benchmarkSprites.length === 0) {
      const kinds: ('star_a' | 'sparkle' | 'heart_full')[] = ['sparkle', 'star_a', 'heart_full'];
      for (let i = 0; i < 1150; i++) {
        const ang = (i * 2.39996) % (Math.PI * 2);
        const speed = 28 + ((i * 13) % 75);
        this.benchmarkSprites.push({
          x: (i * 47) % GAME_W,
          y: (i * 29) % GAME_H,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          rot: (i * 0.4) % (Math.PI * 2),
          vRot: (i % 2 === 0 ? 1 : -1) * (2 + (i % 4)),
          sprite: kinds[i % 11 === 0 ? 2 : i % 3 === 0 ? 1 : 0],
          tint: BENCHMARK_COLORS[i % BENCHMARK_COLORS.length],
          size: 5 + (i % 5),
        });
      }
    }
    return this.sparkleBenchmark;
  }

  public getRenderAlpha(): number {
    return this.interpolating ? Math.max(0, Math.min(1, this.accumulator / STEP_DT)) : 1;
  }

  public update(deltaSec: number, input: InputState): void {
    if (input.restart && !this.prevRestart) {
      this.restart();
    }
    this.prevRestart = input.restart;

    let clamped = Math.min(0.1, Math.max(0, deltaSec));
    if (Math.abs(clamped - STEP_DT) <= 0.00025) {
      clamped = STEP_DT;
    }
    this.accumulator += clamped;
    this.interpolating = true;

    let stepped = false;
    while (this.accumulator >= STEP_DT) {
      let stepInput = input;
      if (!stepped && this.hasPendingLatch) {
        const merged = this.pendingLatchInput;
        merged.left = input.left;
        merged.right = input.right;
        merged.up = input.up;
        merged.down = input.down;
        merged.rightStickX = input.rightStickX;
        merged.rightStickY = input.rightStickY;
        merged.restart = input.restart;
        merged.action = input.action || merged.action;
        merged.jump = input.jump || merged.jump;
        merged.skillX = input.skillX || merged.skillX;
        merged.skillY = input.skillY || merged.skillY;
        merged.shoulderL = input.shoulderL || merged.shoulderL;
        merged.shoulderR = input.shoulderR || merged.shoulderR;
        const hasLivePtrClick = Boolean(input.pointerPrimary || input.pointerSecondary);
        merged.pointerPrimary = Boolean(input.pointerPrimary || merged.pointerPrimary);
        merged.pointerSecondary = Boolean(input.pointerSecondary || merged.pointerSecondary);
        if (input.pointerActive && (hasLivePtrClick || (!merged.pointerPrimary && !merged.pointerSecondary))) {
          merged.pointerX = input.pointerX;
          merged.pointerY = input.pointerY;
          merged.pointerActive = true;
        }
        stepInput = merged;
        this.hasPendingLatch = false;
      }
      this.stepFixedInternal(STEP_DT, stepInput, false, false);
      this.accumulator -= STEP_DT;
      stepped = true;
    }
    if (!stepped) {
      const hasTrigger =
        input.action ||
        input.jump ||
        input.skillX ||
        input.skillY ||
        input.shoulderL ||
        input.shoulderR ||
        Boolean(input.pointerPrimary) ||
        Boolean(input.pointerSecondary);
      if (hasTrigger) {
        const buf = this.pendingLatchInput;
        if (!this.hasPendingLatch) {
          buf.action = false;
          buf.jump = false;
          buf.skillX = false;
          buf.skillY = false;
          buf.shoulderL = false;
          buf.shoulderR = false;
          buf.pointerPrimary = false;
          buf.pointerSecondary = false;
          buf.pointerActive = false;
        }
        buf.action = buf.action || input.action;
        buf.jump = buf.jump || input.jump;
        buf.skillX = buf.skillX || input.skillX;
        buf.skillY = buf.skillY || input.skillY;
        buf.shoulderL = buf.shoulderL || input.shoulderL;
        buf.shoulderR = buf.shoulderR || input.shoulderR;
        buf.pointerPrimary = Boolean(buf.pointerPrimary || input.pointerPrimary);
        buf.pointerSecondary = Boolean(buf.pointerSecondary || input.pointerSecondary);
        if (input.pointerActive || input.pointerPrimary || input.pointerSecondary) {
          buf.pointerX = input.pointerX ?? 0;
          buf.pointerY = input.pointerY ?? 0;
          buf.pointerActive = Boolean(input.pointerActive);
        }
        this.hasPendingLatch = true;
      }
    }
    if (stepped && this.events.listenerCount('stage:changed') > 0) {
      this.emitStageChangeIfNeeded();
    }
  }

  public stepFixed(dt: number, input: InputState): SimEvent[] {
    this.interpolating = false;
    return this.stepFixedInternal(dt, input, true, true);
  }

  private emitStageChangeIfNeeded(): void {
    const snap = this.getSnapshot();
    if (snap.stage && snap.stage.index !== this.lastEmittedStageIdx) {
      this.lastEmittedStageIdx = snap.stage.index;
      this.events.emit('stage:changed', {
        cartridgeId: this.cartridgeId,
        index: snap.stage.index,
        total: snap.stage.total,
        name: snap.stage.name,
      });
    }
  }

  private stepFixedInternal(dt: number, input: InputState, _directStep: boolean, emitStageCheck: boolean): SimEvent[] {
    this.instance.prepareFixedStep?.();
    const events = this.instance.step(dt, input, this.params);
    this.invalidateSnapshot();
    const combo = isComboTrackingCartridge(this.instance) ? this.instance.getComboCount() : 0;

    for (const ev of events) {
      this.events.emit('sim:event', { cartridgeId: this.cartridgeId, event: ev, combo });
      this.eventListener?.(ev, { kind: ev, combo });
    }

    if (emitStageCheck && this.events.listenerCount('stage:changed') > 0) {
      this.emitStageChangeIfNeeded();
    }

    if (this.sparkleBenchmark) {
      for (let i = 0; i < this.benchmarkSprites.length; i++) {
        const b = this.benchmarkSprites[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += b.vRot * dt;
        if (b.x < 4) {
          b.x = 4;
          b.vx = Math.abs(b.vx);
        } else if (b.x > GAME_W - 4) {
          b.x = GAME_W - 4;
          b.vx = -Math.abs(b.vx);
        }
        if (b.y < 14) {
          b.y = 14;
          b.vy = Math.abs(b.vy);
        } else if (b.y > GAME_H - 4) {
          b.y = GAME_H - 4;
          b.vy = -Math.abs(b.vy);
        }
      }
    }
    return events;
  }

  public getSnapshot(): RenderSceneSnapshot {
    const alpha = this.getRenderAlpha();
    if (!this.snapshotDirty && this.cachedSnapshot && this.cachedSnapAlpha === alpha) {
      return this.cachedSnapshot;
    }
    const snap = this.instance.snapshot(this.params, alpha);
    this.cachedSnapshot = snap;
    this.cachedSnapAlpha = alpha;
    this.snapshotDirty = false;
    return snap;
  }
}
