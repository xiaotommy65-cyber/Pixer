import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import { InputMap } from '../../core/input/InputMap.ts';
import { SeededRng } from '../../core/runtime/SeededRng.ts';
import { JuiceSystem, stepSquashSpring } from '../../core/sim/JuiceSystem.ts';
import type {
  InputState,
  RenderSceneSnapshot,
  RpgMenuOption,
  RuntimeParams,
  SimEvent,
  TurnKernelContract,
} from '../../core/types/WorldTypes.ts';
import { suggestAgentAction as suggestDndAgentAction } from './DndBotPolicy.ts';
import {
  enterFloor,
  executeTurnAction,
  pushCombatLog,
  runEnemyCombatTurn,
} from './DndCombatResolver.ts';
import {
  buildCombatMenu,
  buildSceneSnapshot,
  getExploreMenu,
  getLegalActions as projectLegalActions,
  getObservation as projectObservation,
} from './DndSnapshotProjector.ts';
import {
  TILE_PX,
  getActiveFloor,
  type AgentObservation,
  type DialogChoiceDef,
  type DialogDef,
  type DndWorldState,
  type DungeonEntityDef,
  type DungeonFloorDef,
  type DungeonModuleDef,
  type GridTileKind,
} from './DndTypes.ts';
import {
  buildFloorsFromModule,
  hydrateTurnGridSave,
  parseDungeonModuleJson,
  serializeTurnGridSave,
} from './TurnGridSave.ts';

export { parseDungeonModuleJson };
export type {
  AgentObservation,
  DialogChoiceDef,
  DialogDef,
  DungeonEntityDef,
  DungeonFloorDef,
  DungeonModuleDef,
  GridTileKind,
};

/**
 * Turn-Based Grid CRPG / D&D Engine Kernel.
 * Coordinates state initialization, SRAM persistence, frame input/camera loop,
 * and delegates projection, combat rules, and AI policy to `./Dnd*` layers.
 */
export class TurnGridKernel implements TurnKernelContract {
  public readonly input = new InputMap();
  public readonly juice = new JuiceSystem();
  public readonly rng = new SeededRng(0x2026d200);
  public readonly moduleDef: DungeonModuleDef;

  private readonly state: DndWorldState;
  private holdRepeatTimer = 0;
  private cameraX = 0;
  private cameraY = 0;

  constructor(moduleDef: DungeonModuleDef) {
    this.moduleDef = moduleDef;
    const { floors, totalChests } = buildFloorsFromModule(moduleDef);

    this.state = {
      moduleDef,
      rng: this.rng,
      juice: this.juice,
      hero: {
        name: '小豆芽騎士',
        level: 1,
        xp: 0,
        nextXp: 80,
        hp: 28,
        maxHp: 28,
        mp: 12,
        maxMp: 12,
        ac: 14,
        str: 15,
        dex: 14,
        int: 13,
        potions: 2,
        keys: 0,
        gold: 25,
        statuses: {},
        x: 1,
        y: 1,
        visualX: 1 * TILE_PX,
        visualY: 1 * TILE_PX,
        facingLeft: false,
        flash: 0,
        squash: { scaleX: 1, scaleY: 1 },
      },
      blackboard: {},
      turnCount: 0,
      score: 0,
      chestsCollected: 0,
      totalChests,
      agentAuto: false,
      debugHitboxes: false,
      floors,
      floorIdx: 0,
      phase: { kind: 'explore', menuIdx: 0 },
      combatLog: [],
      autoCooldown: 0,
    };

    enterFloor(this.state, 0, () => this.snapCameraImmediate());
    pushCombatLog(this.state, `📜 進入「${moduleDef.title}」— 方向鍵移動，遇敵進入 d20 回合戰！`);
  }

  public get debugHitboxes(): boolean {
    return this.state.debugHitboxes;
  }

  public set debugHitboxes(value: boolean) {
    this.state.debugHitboxes = value;
  }

  public get agentAuto(): boolean {
    return this.state.agentAuto;
  }

  public set agentAuto(value: boolean) {
    this.state.agentAuto = value;
  }

  private snapCameraImmediate(): void {
    const f = getActiveFloor(this.state);
    const worldW = f.width * TILE_PX;
    const worldH = f.height * TILE_PX;
    const minCamX = -56;
    const maxCamX = Math.max(minCamX, worldW - GAME_W + 56);
    const minCamY = -28;
    const maxCamY = Math.max(minCamY, worldH - GAME_H + 32);
    this.cameraX = Math.max(minCamX, Math.min(maxCamX, this.state.hero.x * TILE_PX + 8 - GAME_W * 0.5));
    this.cameraY = Math.max(minCamY, Math.min(maxCamY, this.state.hero.y * TILE_PX + 8 - GAME_H * 0.46));
  }

  public retryStage(): void {
    this.state.phase = { kind: 'explore', menuIdx: 0 };
    this.state.hero.hp = this.state.hero.maxHp;
    this.state.hero.mp = this.state.hero.maxMp;
    this.state.hero.statuses = {};
    enterFloor(this.state, this.state.floorIdx, () => this.snapCameraImmediate());
    pushCombatLog(this.state, `🔥 從「${getActiveFloor(this.state).def.name}」起點營火重新挑戰！`);
  }

  public serializeSave(): unknown {
    return serializeTurnGridSave(this.state);
  }

  public hydrateSave(raw: unknown): boolean {
    return hydrateTurnGridSave(this.state, raw, () => this.snapCameraImmediate());
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    if (this.state.phase.kind === 'won') return 'won';
    if (this.state.phase.kind === 'lost') return 'lost';
    return 'playing';
  }

  public getObservation(): AgentObservation {
    return projectObservation(this.state);
  }

  public getLegalActions(): RpgMenuOption[] {
    return projectLegalActions(this.state);
  }

  public suggestAgentAction(): string | null {
    return suggestDndAgentAction(this.state);
  }

  public dispatchCommand(commandId: string): SimEvent[] {
    const events: SimEvent[] = [];
    if (commandId === 'toggle_agent') {
      this.state.agentAuto = !this.state.agentAuto;
      this.state.autoCooldown = 0.08;
      events.push('snap');
      return events;
    }
    if (commandId === 'agent_step') {
      const next = this.suggestAgentAction();
      if (next) return this.dispatchCommand(next);
      return events;
    }
    executeTurnAction(this.state, commandId, events, () => this.snapCameraImmediate());
    return events;
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    const events: SimEvent[] = [];
    this.input.update(rawInput, dt);
    const simDt = this.juice.advanceRealTime(dt, params.shakeScale);
    const s = this.state;
    const f = getActiveFloor(s);

    const followRate = Math.min(1, dt * 18);
    s.hero.visualX += (s.hero.x * TILE_PX - s.hero.visualX) * followRate;
    s.hero.visualY += (s.hero.y * TILE_PX - s.hero.visualY) * followRate;
    if (s.hero.flash > 0) s.hero.flash = Math.max(0, s.hero.flash - dt * 5);
    stepSquashSpring(s.hero.squash, dt, 15);
    for (const e of f.entities) {
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 5);
      stepSquashSpring(e.squash, dt, 14);
    }

    const worldW = f.width * TILE_PX;
    const worldH = f.height * TILE_PX;
    const minCamX = -56;
    const maxCamX = Math.max(minCamX, worldW - GAME_W + 56);
    const minCamY = -28;
    const maxCamY = Math.max(minCamY, worldH - GAME_H + 32);
    const targetCamX = Math.max(minCamX, Math.min(maxCamX, s.hero.visualX + 8 - GAME_W * 0.5));
    const targetCamY = Math.max(minCamY, Math.min(maxCamY, s.hero.visualY + 8 - GAME_H * 0.46));
    this.cameraX += (targetCamX - this.cameraX) * Math.min(1, dt * 10);
    this.cameraY += (targetCamY - this.cameraY) * Math.min(1, dt * 10);

    if (simDt <= 0 || s.phase.kind === 'won' || s.phase.kind === 'lost') return events;

    if (this.input.justPressed('skillX')) {
      this.state.agentAuto = !this.state.agentAuto;
      this.state.autoCooldown = 0.08;
      events.push('snap');
      return events;
    }

    if (s.phase.kind === 'combat' && s.phase.turnOwner === 'enemy') {
      s.phase.enemyTimer -= simDt;
      if (s.phase.enemyTimer <= 0) {
        runEnemyCombatTurn(s, events);
      }
      return events;
    }

    if (s.agentAuto) {
      s.autoCooldown -= simDt;
      if (s.autoCooldown <= 0) {
        s.autoCooldown = 0.24;
        const act = this.suggestAgentAction();
        if (act) executeTurnAction(s, act, events, () => this.snapCameraImmediate());
      }
      return events;
    }

    if (this.input.justPressed('skillY')) {
      executeTurnAction(s, 'potion', events, () => this.snapCameraImmediate());
    }

    const rAxisX = this.input.rightAxisX();
    const rAxisY = this.input.rightAxisY();
    const rightStickPrev = rAxisX < -0.55 || rAxisY < -0.55;
    const rightStickNext = rAxisX > 0.55 || rAxisY > 0.55;

    const heldMove =
      this.input.held('left') || this.input.held('right') || this.input.held('up') || this.input.held('down');
    let dirPress =
      this.input.justPressed('left') ||
      this.input.justPressed('right') ||
      this.input.justPressed('up') ||
      this.input.justPressed('down');

    if (s.phase.kind === 'explore' && heldMove) {
      if (dirPress) {
        this.holdRepeatTimer = 0.24;
      } else {
        this.holdRepeatTimer -= simDt;
        if (this.holdRepeatTimer <= 0) {
          this.holdRepeatTimer = 0.14;
          dirPress = true;
        }
      }
    } else if (rightStickPrev || rightStickNext) {
      if (this.holdRepeatTimer <= 0) {
        this.holdRepeatTimer = 0.24;
      } else {
        this.holdRepeatTimer -= simDt;
      }
    } else {
      this.holdRepeatTimer = 0;
    }

    const cyclePrev =
      this.input.justPressed('shoulderL') || (rightStickPrev && this.holdRepeatTimer === 0.24);
    const cycleNext =
      this.input.justPressed('shoulderR') || (rightStickNext && this.holdRepeatTimer === 0.24);

    if (s.phase.kind === 'explore') {
      if (dirPress) {
        if (this.input.held('up')) executeTurnAction(s, 'move_n', events, () => this.snapCameraImmediate());
        else if (this.input.held('down')) executeTurnAction(s, 'move_s', events, () => this.snapCameraImmediate());
        else if (this.input.held('left')) executeTurnAction(s, 'move_w', events, () => this.snapCameraImmediate());
        else if (this.input.held('right')) executeTurnAction(s, 'move_e', events, () => this.snapCameraImmediate());
      } else if (this.input.justPressed('action')) {
        const opts = getExploreMenu(s);
        const opt = opts[s.phase.menuIdx];
        if (opt?.enabled) executeTurnAction(s, opt.id, events, () => this.snapCameraImmediate());
      } else if (this.input.justPressed('jump') || cycleNext) {
        const opts = getExploreMenu(s);
        s.phase.menuIdx = (s.phase.menuIdx + 1) % opts.length;
      } else if (cyclePrev) {
        const opts = getExploreMenu(s);
        s.phase.menuIdx = (s.phase.menuIdx - 1 + opts.length) % opts.length;
      }
    } else if (s.phase.kind === 'combat') {
      const menu = buildCombatMenu(s);
      if (this.input.justPressed('up') || this.input.justPressed('left') || cyclePrev) {
        s.phase.selectedIdx = (s.phase.selectedIdx - 1 + menu.length) % menu.length;
      } else if (this.input.justPressed('down') || this.input.justPressed('right') || cycleNext) {
        s.phase.selectedIdx = (s.phase.selectedIdx + 1) % menu.length;
      } else if (this.input.justPressed('action') || this.input.justPressed('jump')) {
        const opt = menu[s.phase.selectedIdx];
        if (opt?.enabled) executeTurnAction(s, opt.id, events, () => this.snapCameraImmediate());
      }
    } else if (s.phase.kind === 'dialog') {
      const dlg = s.moduleDef.dialogs[s.phase.dialogId];
      const len = dlg?.choices.length ?? 1;
      if (this.input.justPressed('up') || this.input.justPressed('left') || cyclePrev) {
        s.phase.selectedIdx = (s.phase.selectedIdx - 1 + len) % len;
      } else if (this.input.justPressed('down') || this.input.justPressed('right') || cycleNext) {
        s.phase.selectedIdx = (s.phase.selectedIdx + 1) % len;
      } else if (this.input.justPressed('action') || this.input.justPressed('jump')) {
        executeTurnAction(s, `dialog_${s.phase.selectedIdx}`, events, () => this.snapCameraImmediate());
      }
    }

    return events;
  }

  public snapshot(params: RuntimeParams): RenderSceneSnapshot {
    return buildSceneSnapshot(this.state, this.cameraX, this.cameraY, params);
  }
}
