import type { InputMap } from '../input/InputMap.ts';
import type { DebugRectDesc, EntityDesc, HudPrimitiveDesc, SimEvent } from '../types/SceneTypes.ts';
import { clamp } from '../types/SceneTypes.ts';
import type { EventActionVm } from './EventActionVm.ts';
import type { JuiceSystem } from './JuiceSystem.ts';
import type { OrthogonalPose } from './OrthogonalArt.ts';

export type FighterInputToken = 'none' | 'light' | 'heavy' | 'low' | 'air' | 'special' | 'super';
export type FighterStance = 'ground' | 'crouch' | 'air';
export type FighterMachineState =
  | 'idle'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
  | 'knockdown'
  | 'ko';

export interface FighterBoxDef {
  /** Offset from fighter center X (mirrored automatically when facing left). */
  x: number;
  /** Offset from fighter foot Y upward (negative = higher up). */
  y: number;
  w: number;
  h: number;
}

export interface FighterMoveDef {
  id: string;
  name: string;
  input: Exclude<FighterInputToken, 'none'>;
  stance: FighterStance;
  /** Exact 60Hz integer frames. */
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  chipDamage: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockbackX: number;
  knockbackY: number;
  lungeVx?: number;
  lungeVy?: number;
  meterGain: number;
  meterCost: number;
  hitbox: FighterBoxDef;
  cancelInto?: readonly string[];
  pose: OrthogonalPose;
  isLow?: boolean;
  isOverhead?: boolean;
}

export interface FighterProfileDef {
  id: string;
  name: string;
  artBlueprintId: string;
  paletteRow?: number;
  maxHp: number;
  walkSpeed: number;
  jumpVy: number;
  pushbox: FighterBoxDef;
  hurtbox: FighterBoxDef;
  crouchHurtbox?: FighterBoxDef;
  moves: readonly FighterMoveDef[];
}

export interface FighterEngineConfig {
  stageWidth: number;
  floorY: number;
  roundTimeSec?: number;
  showDebugBoxesByDefault?: boolean;
  p1: FighterProfileDef;
  p2: FighterProfileDef;
}

const INPUT_BUFFER_LEN = 8;
const TOKEN_TO_CODE: Readonly<Record<FighterInputToken, number>> = {
  none: 0,
  light: 1,
  heavy: 2,
  low: 3,
  air: 4,
  special: 5,
  super: 6,
};
const CODE_TO_TOKEN: readonly FighterInputToken[] = ['none', 'light', 'heavy', 'low', 'air', 'special', 'super'];

export interface FighterRuntimeUnit {
  readonly profile: FighterProfileDef;
  readonly isP1: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  meter: number;
  state: FighterMachineState;
  stateFrame: number;
  stunFrames: number;
  activeMove: FighterMoveDef | null;
  moveHitConnected: boolean;
  moveWasBlocked: boolean;
  comboCount: number;
  flash: number;
  /** 8-frame circular input buffer (stores TOKEN_TO_CODE). */
  readonly inputBuf: Int8Array;
  inputBufHead: number;
  aiThinkFrames: number;
  aiPhase: number;
}

export interface FighterStepHooks {
  vm?: EventActionVm;
  juice?: JuiceSystem;
  spawnFloatingText?: (text: string, wx: number, wy: number, color?: string) => void;
  eventsOut: SimEvent[];
}

interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function resolveBoxWorld(u: FighterRuntimeUnit, box: FighterBoxDef, out: WorldRect): void {
  const rx = u.facing > 0 ? u.x + box.x : u.x - box.x - box.w;
  out.x = rx;
  out.y = u.y + box.y;
  out.w = box.w;
  out.h = box.h;
}

function rectsOverlap(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Pure, DOM-free, Zero-GC Orthogonal 2D Fighting Frame-Data Engine.
 * Driven 100% by JSON move tables (Startup / Active / Recovery frames, Hitbox / Hurtbox / Pushbox,
 * hitstop, hitstun/blockstun, high/low guard, cancelRoutes, 8-frame input buffer, combo scaling,
 * super meter, dynamic camera zoom, and live Hitbox/Hurtbox/Pushbox debug rendering).
 */
export class FighterFrameEngine {
  public readonly config: FighterEngineConfig;
  public readonly p1: FighterRuntimeUnit;
  public readonly p2: FighterRuntimeUnit;
  public debugBoxesVisible: boolean;
  public roundTimerSec: number;
  public hitstopFrames = 0;
  public status: 'playing' | 'won' | 'lost' = 'playing';
  public score = 0;
  public cameraX = 0;
  public cameraY = 0;
  public cameraZoom = 1;
  public lastBanner = '';

  private frameAccum = 0;
  private readonly rectA: WorldRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly rectB: WorldRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly aiScratch: { dirX: number; crouch: boolean; jump: boolean; token: FighterInputToken } = {
    dirX: 0,
    crouch: false,
    jump: false,
    token: 'none',
  };
  private readonly entityPool: EntityDesc[] = [];
  private readonly hudPool: HudPrimitiveDesc[] = [];
  private readonly debugPool: DebugRectDesc[] = [];

  constructor(config: FighterEngineConfig) {
    this.config = config;
    this.debugBoxesVisible = config.showDebugBoxesByDefault ?? false;
    this.roundTimerSec = config.roundTimeSec ?? 99;
    this.p1 = this.createUnit(config.p1, true);
    this.p2 = this.createUnit(config.p2, false);
    for (let i = 0; i < 6; i++) {
      this.entityPool.push({ id: `f_${i}`, sprite: 'hero_a', x: 0, y: 0, w: 24, h: 24 });
    }
    for (let i = 0; i < 32; i++) {
      this.hudPool.push({ kind: 'box', x: 0, y: 0, w: 0, h: 0, color: '#ffffff' });
    }
    for (let i = 0; i < 12; i++) {
      this.debugPool.push({ x: 0, y: 0, w: 0, h: 0, color: '#ffffff' });
    }
    this.resetRound();
  }

  private createUnit(profile: FighterProfileDef, isP1: boolean): FighterRuntimeUnit {
    return {
      profile,
      isP1,
      x: 0,
      y: this.config.floorY,
      vx: 0,
      vy: 0,
      facing: isP1 ? 1 : -1,
      hp: profile.maxHp,
      maxHp: profile.maxHp,
      meter: 0,
      state: 'idle',
      stateFrame: 0,
      stunFrames: 0,
      activeMove: null,
      moveHitConnected: false,
      moveWasBlocked: false,
      comboCount: 0,
      flash: 0,
      inputBuf: new Int8Array(INPUT_BUFFER_LEN),
      inputBufHead: 0,
      aiThinkFrames: 18,
      aiPhase: 0,
    };
  }

  public resetRound(): void {
    const mid = this.config.stageWidth * 0.5;
    this.resetUnit(this.p1, mid - 44, 1);
    this.resetUnit(this.p2, mid + 44, -1);
    this.roundTimerSec = this.config.roundTimeSec ?? 99;
    this.hitstopFrames = 0;
    this.status = 'playing';
    this.score = 0;
    this.frameAccum = 0;
    this.cameraX = mid - 160;
    this.cameraY = 0;
    this.cameraZoom = 1.08;
    this.lastBanner = 'ROUND 1 · FIGHT! (L 切換判定盒)';
  }

  private resetUnit(u: FighterRuntimeUnit, x: number, facing: 1 | -1): void {
    u.x = x;
    u.y = this.config.floorY;
    u.vx = 0;
    u.vy = 0;
    u.facing = facing;
    u.hp = u.profile.maxHp;
    u.maxHp = u.profile.maxHp;
    u.meter = 25;
    u.state = 'idle';
    u.stateFrame = 0;
    u.stunFrames = 0;
    u.activeMove = null;
    u.moveHitConnected = false;
    u.moveWasBlocked = false;
    u.comboCount = 0;
    u.flash = 0;
    u.inputBuf.fill(0);
    u.inputBufHead = 0;
    u.aiThinkFrames = 24;
    u.aiPhase = 0;
  }

  public pushInputToken(u: FighterRuntimeUnit, token: FighterInputToken): void {
    u.inputBufHead = (u.inputBufHead + 1) % INPUT_BUFFER_LEN;
    u.inputBuf[u.inputBufHead] = TOKEN_TO_CODE[token];
  }

  private consumeBufferedMove(u: FighterRuntimeUnit, allowedIds?: readonly string[]): FighterMoveDef | null {
    const stance: FighterStance = u.y < this.config.floorY - 1 ? 'air' : u.state === 'crouch' ? 'crouch' : 'ground';
    for (let offset = 0; offset < INPUT_BUFFER_LEN; offset++) {
      const idx = (u.inputBufHead - offset + INPUT_BUFFER_LEN) % INPUT_BUFFER_LEN;
      const code = u.inputBuf[idx];
      if (code === 0) continue;
      const tok = CODE_TO_TOKEN[code];
      const move = this.findMoveForToken(u, tok, stance, allowedIds);
      if (move) {
        u.inputBuf[idx] = 0;
        return move;
      }
    }
    return null;
  }

  private findMoveForToken(
    u: FighterRuntimeUnit,
    tok: FighterInputToken,
    stance: FighterStance,
    allowedIds?: readonly string[],
  ): FighterMoveDef | null {
    const moves = u.profile.moves;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m.input !== tok) continue;
      if (m.stance !== stance && !(tok === 'special' || tok === 'super')) continue;
      if (m.meterCost > u.meter) continue;
      if (allowedIds && !allowedIds.includes(m.id)) continue;
      return m;
    }
    // Fallback if crouch/air specific move absent
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m.input !== tok || m.meterCost > u.meter) continue;
      if (allowedIds && !allowedIds.includes(m.id)) continue;
      if (stance === 'crouch' && m.stance === 'ground') return m;
    }
    return null;
  }

  public startMove(u: FighterRuntimeUnit, move: FighterMoveDef, hooks?: FighterStepHooks): void {
    u.state = 'attack';
    u.activeMove = move;
    u.stateFrame = 0;
    u.moveHitConnected = false;
    u.moveWasBlocked = false;
    u.meter = Math.max(0, u.meter - move.meterCost);
    if (move.lungeVx) u.vx = u.facing * move.lungeVx;
    if (move.lungeVy) u.vy = move.lungeVy;
    hooks?.eventsOut.push(move.input === 'super' ? 'charge' : move.input === 'special' ? 'laser' : 'snap');
  }

  public isMoveInActiveWindow(u: FighterRuntimeUnit): boolean {
    if (u.state !== 'attack' || !u.activeMove) return false;
    const m = u.activeMove;
    return u.stateFrame >= m.startup && u.stateFrame < m.startup + m.active;
  }

  /** Executes a single deterministic 60Hz fighting frame. Callable directly from headless tests. */
  public stepFrame(
    p1DirX: number,
    p1Crouch: boolean,
    p1Jump: boolean,
    p1Token: FighterInputToken,
    hooks: FighterStepHooks,
    overrideP2?: { dirX: number; crouch: boolean; jump: boolean; token: FighterInputToken },
  ): void {
    if (this.status !== 'playing') return;

    this.pushInputToken(this.p1, p1Token);

    if (this.p1.flash > 0) this.p1.flash = Math.max(0, this.p1.flash - 0.04);
    if (this.p2.flash > 0) this.p2.flash = Math.max(0, this.p2.flash - 0.04);

    if (this.hitstopFrames > 0) {
      this.hitstopFrames--;
      return;
    }

    this.roundTimerSec = Math.max(0, this.roundTimerSec - 1 / 60);
    if (this.roundTimerSec <= 0) {
      this.status = this.p1.hp >= this.p2.hp ? 'won' : 'lost';
      this.lastBanner = this.status === 'won' ? 'TIME OVER · P1 WIN!' : 'TIME OVER · P2 WIN';
      return;
    }

    // Decide P2 AI or test override
    let p2DirX = 0;
    let p2Crouch = false;
    let p2Jump = false;
    let p2Token: FighterInputToken = 'none';
    if (overrideP2) {
      p2DirX = overrideP2.dirX;
      p2Crouch = overrideP2.crouch;
      p2Jump = overrideP2.jump;
      p2Token = overrideP2.token;
    } else {
      const ai = this.decideP2Ai();
      p2DirX = ai.dirX;
      p2Crouch = ai.crouch;
      p2Jump = ai.jump;
      p2Token = ai.token;
    }
    this.pushInputToken(this.p2, p2Token);

    // Step both fighter state machines & physics
    this.stepFighterUnit(this.p1, this.p2, p1DirX, p1Crouch, p1Jump, hooks);
    this.stepFighterUnit(this.p2, this.p1, p2DirX, p2Crouch, p2Jump, hooks);

    // Pushbox separation (prevents fighters overlapping)
    this.resolvePushboxes();

    // Hitbox vs Hurtbox collision checks (both directions)
    this.checkAttackHit(this.p1, this.p2, p2DirX, p2Crouch, hooks);
    this.checkAttackHit(this.p2, this.p1, p1DirX, p1Crouch, hooks);

    // Update dynamic 2-fighter midpoint & zoom camera
    const midX = (this.p1.x + this.p2.x) * 0.5;
    const dist = Math.abs(this.p1.x - this.p2.x);
    const targetZoom = clamp(1.26 - (dist - 52) * 0.0024, 0.96, 1.26);
    this.cameraZoom += (targetZoom - this.cameraZoom) * 0.12;
    this.cameraX = clamp(midX - 160, 0, Math.max(0, this.config.stageWidth - 320));
    this.cameraY = 0;

    if (hooks.vm) {
      hooks.vm.setVar('p1Hp', this.p1.hp);
      hooks.vm.setVar('p1MaxHp', this.p1.maxHp);
      hooks.vm.setVar('p2Hp', this.p2.hp);
      hooks.vm.setVar('p2MaxHp', this.p2.maxHp);
      hooks.vm.setVar('combo', this.p1.comboCount);
      hooks.vm.setVar('meter', this.p1.meter);
    }
  }

  private setAiScratch(dirX: number, crouch: boolean, jump: boolean, token: FighterInputToken): {
    dirX: number;
    crouch: boolean;
    jump: boolean;
    token: FighterInputToken;
  } {
    this.aiScratch.dirX = dirX;
    this.aiScratch.crouch = crouch;
    this.aiScratch.jump = jump;
    this.aiScratch.token = token;
    return this.aiScratch;
  }

  private decideP2Ai(): { dirX: number; crouch: boolean; jump: boolean; token: FighterInputToken } {
    const p2 = this.p2;
    const p1 = this.p1;
    const dx = p1.x - p2.x;
    const absDx = Math.abs(dx);
    const toward = dx >= 0 ? 1 : -1;
    const away = -toward;

    if (p2.aiThinkFrames > 0) p2.aiThinkFrames--;

    // Guard reactively when P1 is attacking close
    if (p1.state === 'attack' && absDx < 46 && (p2.aiPhase % 3 === 0)) {
      return this.setAiScratch(away, p1.activeMove?.isLow ?? false, false, 'none');
    }

    if (p2.aiThinkFrames <= 0 && (p2.state === 'idle' || p2.state === 'walk' || p2.state === 'crouch')) {
      p2.aiPhase++;
      if (absDx <= 34) {
        p2.aiThinkFrames = 26;
        if (p2.meter >= 50 && p2.aiPhase % 5 === 0) {
          return this.setAiScratch(0, false, false, 'super');
        }
        const mod = p2.aiPhase % 4;
        if (mod === 0) return this.setAiScratch(0, false, false, 'light');
        if (mod === 1) return this.setAiScratch(0, true, false, 'low');
        if (mod === 2) return this.setAiScratch(0, false, false, 'heavy');
        return this.setAiScratch(0, false, false, 'special');
      }
      if (absDx > 80 && p2.aiPhase % 4 === 0) {
        p2.aiThinkFrames = 22;
        return this.setAiScratch(toward, false, true, 'none');
      }
      p2.aiThinkFrames = 14;
    }

    if (absDx > 30) return this.setAiScratch(toward, false, false, 'none');
    if (absDx < 16) return this.setAiScratch(away, false, false, 'none');
    return this.setAiScratch(0, false, false, 'none');
  }

  private stepFighterUnit(
    u: FighterRuntimeUnit,
    other: FighterRuntimeUnit,
    dirX: number,
    crouch: boolean,
    jump: boolean,
    hooks: FighterStepHooks,
  ): void {
    const onGround = u.y >= this.config.floorY - 0.5;
    if (u.state === 'idle' || u.state === 'walk' || u.state === 'crouch') {
      u.facing = other.x >= u.x ? 1 : -1;
    }

    if (u.state === 'ko') {
      u.vx *= 0.88;
    } else if (u.state === 'hitstun' || u.state === 'blockstun' || u.state === 'knockdown') {
      u.stunFrames--;
      u.vx *= onGround ? 0.84 : 0.96;
      if (u.stunFrames <= 0 && onGround) {
        u.state = 'idle';
        u.stateFrame = 0;
        if (u.isP1) this.p2.comboCount = 0;
        else this.p1.comboCount = 0;
      }
    } else if (u.state === 'attack' && u.activeMove) {
      u.stateFrame++;
      if (onGround) u.vx *= 0.84;
      // Check hit-confirm cancel route!
      if (u.moveHitConnected && u.activeMove.cancelInto && u.activeMove.cancelInto.length > 0) {
        const cancelMove = this.consumeBufferedMove(u, u.activeMove.cancelInto);
        if (cancelMove) {
          this.startMove(u, cancelMove, hooks);
          hooks.spawnFloatingText?.('CANCEL!', u.x, u.y - 30, '#e0aaff');
          return;
        }
      }
      const total = u.activeMove.startup + u.activeMove.active + u.activeMove.recovery;
      if (u.stateFrame >= total) {
        u.activeMove = null;
        u.state = onGround ? 'idle' : 'jump';
        u.stateFrame = 0;
      }
    } else {
      // Actionable neutral / walk / crouch / air
      const nextMove = this.consumeBufferedMove(u);
      if (nextMove) {
        this.startMove(u, nextMove, hooks);
      } else if (!onGround) {
        u.state = 'jump';
        u.stateFrame++;
      } else if (jump) {
        u.vy = -u.profile.jumpVy;
        u.vx = dirX * u.profile.walkSpeed * 0.9;
        u.state = 'jump';
        u.stateFrame = 0;
        hooks.eventsOut.push('jump');
      } else if (crouch) {
        u.state = 'crouch';
        u.vx *= 0.6;
        u.stateFrame++;
      } else if (dirX !== 0) {
        const backing = (dirX > 0 && u.facing < 0) || (dirX < 0 && u.facing > 0);
        u.vx = dirX * u.profile.walkSpeed * (backing ? 0.78 : 1.0);
        u.state = 'walk';
        u.stateFrame++;
      } else {
        u.vx *= 0.65;
        u.state = 'idle';
        u.stateFrame++;
      }
    }

    // Integrate physics @ 1/60s
    const dt = 1 / 60;
    u.x += u.vx * dt;
    u.y += u.vy * dt;
    if (u.y < this.config.floorY) {
      u.vy = Math.min(420, u.vy + 760 * dt);
    } else {
      u.y = this.config.floorY;
      if (u.vy > 0) u.vy = 0;
      if (u.state === 'jump') u.state = 'idle';
      if (u.state === 'attack' && u.activeMove?.stance === 'air') {
        u.activeMove = null;
        u.state = 'idle';
        u.stateFrame = 0;
      }
    }
    u.x = clamp(u.x, 18, this.config.stageWidth - 18);
  }

  private resolvePushboxes(): void {
    resolveBoxWorld(this.p1, this.p1.profile.pushbox, this.rectA);
    resolveBoxWorld(this.p2, this.p2.profile.pushbox, this.rectB);
    if (!rectsOverlap(this.rectA, this.rectB)) return;

    const overlapLeft = this.rectA.x + this.rectA.w - this.rectB.x;
    const overlapRight = this.rectB.x + this.rectB.w - this.rectA.x;
    const push = Math.min(overlapLeft, overlapRight) * 0.52;
    const sign = this.p1.x <= this.p2.x ? -1 : 1;
    this.p1.x = clamp(this.p1.x + sign * push, 18, this.config.stageWidth - 18);
    this.p2.x = clamp(this.p2.x - sign * push, 18, this.config.stageWidth - 18);
  }

  private checkAttackHit(
    atk: FighterRuntimeUnit,
    def: FighterRuntimeUnit,
    defDirX: number,
    defCrouch: boolean,
    hooks: FighterStepHooks,
  ): void {
    if (!this.isMoveInActiveWindow(atk) || atk.moveHitConnected || def.state === 'ko' || !atk.activeMove) return;
    const move = atk.activeMove;
    const defHurt = def.state === 'crouch' && def.profile.crouchHurtbox ? def.profile.crouchHurtbox : def.profile.hurtbox;
    resolveBoxWorld(atk, move.hitbox, this.rectA);
    resolveBoxWorld(def, defHurt, this.rectB);
    if (!rectsOverlap(this.rectA, this.rectB)) return;

    atk.moveHitConnected = true;
    this.hitstopFrames = Math.max(this.hitstopFrames, move.hitstop);

    const defHoldingBack = (def.facing > 0 && defDirX < 0) || (def.facing < 0 && defDirX > 0);
    const defCanGuard =
      (def.state === 'idle' || def.state === 'walk' || def.state === 'crouch' || def.state === 'blockstun') &&
      defHoldingBack &&
      def.y >= this.config.floorY - 0.5;
    const guardHeightValid =
      (!move.isLow || defCrouch) &&
      (!move.isOverhead || !defCrouch);

    if (defCanGuard && guardHeightValid) {
      atk.moveWasBlocked = true;
      def.state = 'blockstun';
      def.stunFrames = move.blockstun;
      def.activeMove = null;
      def.vx = atk.facing * move.knockbackX * 0.65;
      def.hp = Math.max(1, def.hp - move.chipDamage);
      atk.meter = Math.min(100, atk.meter + Math.ceil(move.meterGain * 0.5));
      def.meter = Math.min(100, def.meter + 4);
      hooks.juice?.addTrauma(0.08);
      hooks.spawnFloatingText?.('GUARD', def.x, def.y - 28, '#5ec2f7');
      hooks.eventsOut.push('snap');
      return;
    }

    // Clean hit! Apply combo scaling
    atk.comboCount++;
    const scale = Math.max(0.4, 1 - (atk.comboCount - 1) * 0.12);
    const finalDmg = Math.max(1, Math.round(move.damage * scale));
    def.hp = Math.max(0, def.hp - finalDmg);
    def.flash = 0.55;
    def.activeMove = null;
    def.vx = atk.facing * move.knockbackX;
    def.vy = move.knockbackY;
    def.state = move.knockbackY < -140 ? 'knockdown' : 'hitstun';
    def.stunFrames = move.hitstun;
    atk.meter = Math.min(100, atk.meter + move.meterGain);
    def.meter = Math.min(100, def.meter + Math.ceil(move.meterGain * 0.6));

    if (atk.isP1) {
      this.score += finalDmg * 15 * atk.comboCount;
      hooks.vm?.emitSignal('fighter_hit');
    }

    hooks.juice?.applyPreset(move.input === 'super' || move.input === 'special' ? 'heavy_kill' : 'light_hit');
    hooks.spawnFloatingText?.(
      atk.comboCount >= 2 ? `-${finalDmg} (${atk.comboCount} HIT!)` : `-${finalDmg}`,
      def.x,
      def.y - 30,
      move.input === 'super' ? '#ffd447' : '#ff5d8f',
    );
    hooks.eventsOut.push(move.input === 'super' || move.input === 'special' ? 'explode' : 'stomp');

    if (def.hp <= 0) {
      def.state = 'ko';
      def.vy = -170;
      this.status = def.isP1 ? 'lost' : 'won';
      this.lastBanner = def.isP1 ? 'K.O.! RIVAL WINS' : 'K.O.! ATELIER STRIKER WINS!';
      hooks.vm?.emitSignal('fighter_ko');
      hooks.eventsOut.push(def.isP1 ? 'hurt' : 'win');
    }
  }

  public step(input: InputMap, dt: number, hooks: FighterStepHooks): void {
    if (input.justPressed('shoulderL')) {
      this.debugBoxesVisible = !this.debugBoxesVisible;
      this.lastBanner = this.debugBoxesVisible ? '判定盒顯示：開（紅攻/綠受/藍推）' : '判定盒顯示：關';
      hooks.eventsOut.push('snap');
    }

    const dirX = input.axisX();
    const crouch = input.held('down');
    const jump = input.justPressed('jump') || input.justPressed('up');

    let token: FighterInputToken = 'none';
    if (input.justPressed('shoulderR') && this.p1.meter >= 50) token = 'super';
    else if (input.justPressed('skillX')) token = 'special';
    else if (input.justPressed('skillY')) token = crouch ? 'low' : 'heavy';
    else if (input.justPressed('action')) {
      token = this.p1.y < this.config.floorY - 1 ? 'air' : crouch ? 'low' : 'light';
    }

    this.frameAccum += Math.min(0.05, dt);
    let consumed = false;
    while (this.frameAccum >= 1 / 60 - 1e-6) {
      this.frameAccum -= 1 / 60;
      this.stepFrame(dirX, crouch, !consumed && jump, consumed ? 'none' : token, hooks);
      consumed = true;
    }
  }

  private resolvePose(u: FighterRuntimeUnit): OrthogonalPose {
    if (u.state === 'hitstun' || u.state === 'knockdown' || u.state === 'ko') return 'hurt';
    if (u.state === 'blockstun') return 'guard';
    if (u.state === 'attack' && u.activeMove) {
      if (u.stateFrame < u.activeMove.startup) return 'windup';
      if (u.stateFrame < u.activeMove.startup + u.activeMove.active) return u.activeMove.pose;
      return 'idle';
    }
    if (u.state === 'walk') return 'walk';
    return 'idle';
  }

  public emitSceneAndHud(
    entitiesOut: EntityDesc[],
    hudOut: HudPrimitiveDesc[],
    debugOut: DebugRectDesc[],
    viewW: number,
  ): void {
    let eIdx = 0;
    let hIdx = 0;
    let dIdx = 0;

    const pushFighter = (u: FighterRuntimeUnit): void => {
      const dst = this.entityPool[eIdx++];
      dst.id = u.isP1 ? 'fighter_p1' : 'fighter_p2';
      dst.sprite = 'hero_a';
      dst.artBlueprintId = u.profile.artBlueprintId;
      dst.artFacing = 'side';
      dst.artPose = this.resolvePose(u);
      dst.paletteRow = u.profile.paletteRow;
      dst.w = 24;
      dst.h = u.state === 'crouch' ? 18 : 24;
      dst.x = u.x - dst.w * 0.5;
      dst.y = u.y - dst.h;
      dst.flipX = u.facing < 0;
      dst.flash = u.flash;
      dst.rot = u.state === 'ko' ? -u.facing * 1.35 : 0;
      dst.castShadow = true;
      dst.shadowOffsetY = Math.max(0, this.config.floorY - u.y);
      dst.scaleX = 1;
      dst.scaleY = 1;
      entitiesOut.push(dst);

      if (this.debugBoxesVisible) {
        // Pushbox (Blue)
        resolveBoxWorld(u, u.profile.pushbox, this.rectA);
        const pb = this.debugPool[dIdx++];
        pb.x = this.rectA.x; pb.y = this.rectA.y; pb.w = this.rectA.w; pb.h = this.rectA.h; pb.color = '#3b82f6';
        debugOut.push(pb);

        // Hurtbox (Green)
        const hurt = u.state === 'crouch' && u.profile.crouchHurtbox ? u.profile.crouchHurtbox : u.profile.hurtbox;
        resolveBoxWorld(u, hurt, this.rectA);
        const hb = this.debugPool[dIdx++];
        hb.x = this.rectA.x; hb.y = this.rectA.y; hb.w = this.rectA.w; hb.h = this.rectA.h; hb.color = '#22c55e';
        debugOut.push(hb);

        // Active Hitbox (Red)
        if (this.isMoveInActiveWindow(u) && u.activeMove) {
          resolveBoxWorld(u, u.activeMove.hitbox, this.rectA);
          const atkBox = this.debugPool[dIdx++];
          atkBox.x = this.rectA.x; atkBox.y = this.rectA.y; atkBox.w = this.rectA.w; atkBox.h = this.rectA.h; atkBox.color = '#ef4444';
          debugOut.push(atkBox);
        }
      }
    };

    pushFighter(this.p1);
    pushFighter(this.p2);

    const pushHud = (
      kind: HudPrimitiveDesc['kind'],
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
      opts?: { ratio?: number; text?: string; align?: 'left' | 'center' | 'right'; bgColor?: string; alpha?: number },
    ): void => {
      if (hIdx >= this.hudPool.length) return;
      const dst = this.hudPool[hIdx++];
      dst.kind = kind;
      dst.x = x;
      dst.y = y;
      dst.w = w;
      dst.h = h;
      dst.color = color;
      dst.ratio = opts?.ratio;
      dst.text = opts?.text;
      dst.scale = 1;
      dst.align = opts?.align;
      dst.bgColor = opts?.bgColor;
      dst.alpha = opts?.alpha;
      dst.worldSpace = false;
      hudOut.push(dst);
    };

    // Fighting Arcade Top HUD: P1 HP | Timer | P2 HP + Super Meters
    const barW = Math.floor((viewW - 56) * 0.5);
    pushHud('box', 6, 4, viewW - 12, 26, '#140e24', { alpha: 0.78 });
    pushHud('bar', 10, 12, barW, 6, '#56d39c', { ratio: this.p1.hp / Math.max(1, this.p1.maxHp), bgColor: '#291a38' });
    pushHud('bar', viewW - 10 - barW, 12, barW, 6, '#ff5d8f', { ratio: this.p2.hp / Math.max(1, this.p2.maxHp), bgColor: '#291a38' });
    pushHud('bar', 10, 21, Math.floor(barW * 0.75), 3, '#ffd447', { ratio: this.p1.meter / 100, bgColor: '#1b1426' });
    pushHud('bar', viewW - 10 - Math.floor(barW * 0.75), 21, Math.floor(barW * 0.75), 3, '#e0aaff', { ratio: this.p2.meter / 100, bgColor: '#1b1426' });

    pushHud('text', 10, 5, 0, 0, '#fffaf0', { text: `${this.p1.profile.name.slice(0, 10)} ${this.p1.hp}`, align: 'left' });
    pushHud('text', viewW - 10, 5, 0, 0, '#ffd0dc', { text: `${this.p2.hp} ${this.p2.profile.name.slice(0, 10)}`, align: 'right' });
    pushHud('text', viewW * 0.5, 9, 0, 0, '#ffd447', { text: `${Math.ceil(this.roundTimerSec)}`, align: 'center' });

    if (this.p1.comboCount >= 2) {
      pushHud('text', 14, 36, 0, 0, '#ffd447', { text: `${this.p1.comboCount} HIT COMBO!`, align: 'left' });
    }
    if (this.p1.activeMove) {
      const m = this.p1.activeMove;
      const phaseTag =
        this.p1.stateFrame < m.startup ? 'START' : this.p1.stateFrame < m.startup + m.active ? 'ACTIVE' : 'RECOV';
      pushHud('text', 10, 166, 0, 0, '#9bd3ff', {
        text: `${m.name} F${this.p1.stateFrame}/${m.startup + m.active + m.recovery} ${phaseTag}`,
        align: 'left',
      });
    }
    pushHud('text', viewW - 10, 166, 0, 0, '#c8d4f0', {
      text: `A:JAB Y:HVY X:SPEC R:SUPER L:BOX(${this.debugBoxesVisible ? 'ON' : 'OFF'})`,
      align: 'right',
    });
  }
}
