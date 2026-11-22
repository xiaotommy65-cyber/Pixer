import { getBuiltinRhythmSongs } from '../../core/rhythm/RhythmBuiltinSongs.ts';
import {
  NOTE_HIT,
  NOTE_HOLDING,
  NOTE_MISSED,
  NOTE_PENDING,
  RhythmJudgeEngine,
} from '../../core/rhythm/RhythmJudgeEngine.ts';
import type { RhythmDifficulty, RhythmLane, RhythmSongProject } from '../../core/rhythm/RhythmTypes.ts';
import type {
  CartridgeInstance,
  ComboTrackingCartridge,
  HudPrimitiveDesc,
  InputState,
  RenderSceneSnapshot,
  RuntimeParams,
  SimEvent,
} from '../../core/types/WorldTypes.ts';

const VIEW_W = 640;
const VIEW_H = 360;
const HIGHWAY_W = 240;
const LANE_W = HIGHWAY_W / 4;
const HIGHWAY_X = (VIEW_W - HIGHWAY_W) * 0.5;
const JUDGE_Y = 304;
const NOTE_TRAVEL_MS = 1150;

/**
 * PA-13 Flagship Arcade Cartridge Runtime («星脈共鳴：4K 舞台»)
 * 100% DOM-free & Zero-GC compatible so it runs smoothly inside both Pixer's Handheld Switch Shell
 * (ConsoleView via GPU pipeline) and headless simulation tests (`npm run sim`).
 * Lane Controls on Handheld Joy-Con / Keyboard:
 * - Lane 0: Left / D
 * - Lane 1: Down / F
 * - Lane 2: B / J
 * - Lane 3: A / K
 */
export class PulseResonanceCartridge implements CartridgeInstance, ComboTrackingCartridge {
  private readonly songs: readonly RhythmSongProject[];
  private songIndex = 0;
  private difficulty: RhythmDifficulty = 'NORMAL';
  private engine!: RhythmJudgeEngine;
  private elapsedMs = 0;
  private prevLaneDown: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private prevShoulderR = false;
  private prevShoulderL = false;

  // Ping-pong snapshot buffers (Zero-GC invariant)
  private readonly eventsBuf: SimEvent[] = [];
  private readonly hudPrimitives: HudPrimitiveDesc[] = [];
  private readonly bgStars: { x: number; y: number; size: number; phase: number; color: string }[] = [];

  constructor(songIndex = 0, difficulty: RhythmDifficulty = 'NORMAL') {
    this.songs = getBuiltinRhythmSongs();
    this.songIndex = Math.max(0, Math.min(this.songs.length - 1, songIndex));
    this.difficulty = difficulty;
    for (let i = 0; i < 36; i++) {
      this.bgStars.push({
        x: ((i * 97 + 23) % VIEW_W),
        y: ((i * 53 + 17) % (VIEW_H - 40)),
        size: i % 5 === 0 ? 3 : 2,
        phase: i * 0.41,
        color: i % 3 === 0 ? '#38bdf8' : i % 3 === 1 ? '#f59e0b' : '#e2e8f0',
      });
    }
    this.resetStage();
  }

  public getComboCount(): number {
    return this.engine.getLiveState().combo;
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    const st = this.engine.getLiveState();
    if (st.failed) return 'lost';
    if (st.finished) return 'won';
    return 'playing';
  }

  public retryStage(): void {
    this.resetStage();
  }

  public dispatchCommand(commandId: string): SimEvent[] {
    if (commandId === 'next_song') {
      this.songIndex = (this.songIndex + 1) % this.songs.length;
      this.resetStage();
    } else if (commandId === 'cycle_difficulty') {
      const order: RhythmDifficulty[] = ['EASY', 'NORMAL', 'HARD', 'MASTER'];
      this.difficulty = order[(order.indexOf(this.difficulty) + 1) % order.length];
      this.resetStage();
    }
    return [];
  }

  public step(dt: number, input: InputState, _params: RuntimeParams): SimEvent[] {
    this.eventsBuf.length = 0;

    // L switches song, R cycles difficulty inside Handheld Arcade Shell
    if (input.shoulderL && !this.prevShoulderL) {
      this.songIndex = (this.songIndex + 1) % this.songs.length;
      this.resetStage();
      this.eventsBuf.push('snap');
    }
    if (input.shoulderR && !this.prevShoulderR) {
      const order: RhythmDifficulty[] = ['EASY', 'NORMAL', 'HARD', 'MASTER'];
      this.difficulty = order[(order.indexOf(this.difficulty) + 1) % order.length];
      this.resetStage();
      this.eventsBuf.push('snap');
    }
    this.prevShoulderL = input.shoulderL;
    this.prevShoulderR = input.shoulderR;

    const live = this.engine.getLiveState();
    if (!live.failed && !live.finished) {
      this.elapsedMs += dt * 1000;
    }

    const laneNow0 = input.left;
    const laneNow1 = input.down || input.up;
    const laneNow2 = input.jump || input.skillY;
    const laneNow3 = input.action || input.right;

    this.processLaneEdge(0, laneNow0);
    this.processLaneEdge(1, laneNow1);
    this.processLaneEdge(2, laneNow2);
    this.processLaneEdge(3, laneNow3);

    this.engine.update(this.elapsedMs);
    return this.eventsBuf;
  }

  private processLaneEdge(lane: RhythmLane, pressed: boolean): void {
    const was = this.prevLaneDown[lane];
    this.prevLaneDown[lane] = pressed;
    if (pressed && !was) {
      const ev = this.engine.pressLane(lane, this.elapsedMs);
      if (ev) {
        if (ev.tier === 'MISS') this.eventsBuf.push('hurt');
        else if (ev.tier === 'MARVELOUS' || ev.tier === 'PERFECT') this.eventsBuf.push('star');
        else this.eventsBuf.push('bounce');
      }
    } else if (!pressed && was) {
      this.engine.releaseLane(lane, this.elapsedMs);
    }
  }

  private resetStage(): void {
    const song = this.songs[this.songIndex];
    const chart = song.charts[this.difficulty];
    this.elapsedMs = 0;
    this.prevLaneDown = [false, false, false, false];
    this.engine = new RhythmJudgeEngine({
      songId: song.id,
      chart,
      bpm: song.bpm,
      offsetMs: song.offsetMs,
      durationMs: song.durationMs,
      cameraCues: song.cameraCues,
      dynamicCamera: true,
    });
  }

  public snapshot(_params: RuntimeParams): RenderSceneSnapshot {
    const song = this.songs[this.songIndex];
    const live = this.engine.getLiveState();
    const notes = this.engine.getNotes();
    const status = this.engine.noteStatus;

    this.hudPrimitives.length = 0;

    // 1. 4K Highway backdrop & beat dividers
    this.hudPrimitives.push({
      kind: 'box',
      x: HIGHWAY_X - 4,
      y: 22,
      w: HIGHWAY_W + 8,
      h: VIEW_H - 28,
      color: '#090c14',
      alpha: 0.9,
    });

    for (let l = 0; l < 4; l++) {
      const lx = HIGHWAY_X + l * LANE_W;
      const glow = Math.max(live.laneFlash[l], live.laneHoldGlow[l] * 0.7);
      if (glow > 0.02) {
        this.hudPrimitives.push({
          kind: 'box',
          x: lx + 1,
          y: 24,
          w: LANE_W - 2,
          h: JUDGE_Y - 24,
          color: l === 0 || l === 3 ? '#38bdf8' : '#f59e0b',
          alpha: glow * 0.28,
        });
      }
      // Receptor key cap
      this.hudPrimitives.push({
        kind: 'box',
        x: lx + 3,
        y: JUDGE_Y,
        w: LANE_W - 6,
        h: 18,
        color: live.laneHeld[l] ? '#ffffff' : l === 0 || l === 3 ? '#0c4a6e' : '#78350f',
        alpha: 0.92,
      });
    }

    // Judgement line
    this.hudPrimitives.push({
      kind: 'box',
      x: HIGHWAY_X - 2,
      y: JUDGE_Y - 2,
      w: HIGHWAY_W + 4,
      h: 4,
      color: '#f8fafc',
      alpha: 0.95,
    });

    // 2. Visible notes & holds within travel window
    const startIdx = Math.max(0, this.engine.getScanCursor() - 8);
    const maxVisible = Math.min(notes.length, startIdx + 90);
    for (let i = startIdx; i < maxVisible; i++) {
      const st = status[i];
      if (st === NOTE_HIT) continue;
      const n = notes[i];
      const dtHead = n.timeMs - this.elapsedMs;
      const dtTail = n.timeMs + n.durationMs - this.elapsedMs;
      if (dtHead > NOTE_TRAVEL_MS) break;
      if (dtTail < -180) continue;

      const lx = HIGHWAY_X + n.lane * LANE_W;
      const yHead = JUDGE_Y - (dtHead / NOTE_TRAVEL_MS) * (JUDGE_Y - 26);
      const isOuter = n.lane === 0 || n.lane === 3;
      const noteCol = st === NOTE_MISSED ? '#64748b' : isOuter ? '#38bdf8' : '#f59e0b';

      if (n.durationMs > 0) {
        const yTail = Math.max(24, JUDGE_Y - (dtTail / NOTE_TRAVEL_MS) * (JUDGE_Y - 26));
        const clampedHead = st === NOTE_HOLDING ? JUDGE_Y : Math.min(JUDGE_Y + 24, yHead);
        const h = Math.max(6, clampedHead - yTail);
        this.hudPrimitives.push({
          kind: 'box',
          x: lx + 12,
          y: yTail,
          w: LANE_W - 24,
          h,
          color: noteCol,
          alpha: st === NOTE_HOLDING ? 0.9 : 0.55,
        });
      }

      if (st === NOTE_PENDING || st === NOTE_MISSED) {
        this.hudPrimitives.push({
          kind: 'box',
          x: lx + 5,
          y: yHead - 6,
          w: LANE_W - 10,
          h: 12,
          color: n.isChord ? '#ffffff' : noteCol,
          alpha: st === NOTE_MISSED ? 0.45 : 1,
        });
      }
    }

    // 3. Top Progress & HP Bars
    this.hudPrimitives.push({
      kind: 'bar',
      x: 16,
      y: 12,
      w: 160,
      h: 8,
      ratio: Math.min(1, this.elapsedMs / Math.max(1, song.durationMs)),
      color: song.accentPrimary,
      bgColor: '#1e293b',
    });
    this.hudPrimitives.push({
      kind: 'bar',
      x: VIEW_W - 176,
      y: 12,
      w: 160,
      h: 8,
      ratio: live.hp / 100,
      color: live.hp > 35 ? '#22c55e' : '#ef4444',
      bgColor: '#1e293b',
    });

    const tierLabel = live.lastJudge
      ? `${live.lastJudge.tier} ${live.lastJudge.deltaMs >= 0 ? '+' : ''}${live.lastJudge.deltaMs}ms`
      : 'READY';
    const timeSec = this.elapsedMs / 1000;

    return {
      cartridgeId: 'pulse-resonance',
      skyTop: '#070a12',
      skyBottom: '#131d33',
      cozyFilter: false,
      timeSec,
      elapsedSec: timeSec,
      viewport: { width: VIEW_W, height: VIEW_H },
      cameraX: live.camera.offsetX,
      cameraY: live.camera.offsetY,
      cameraZoom: live.camera.zoom,
      score: live.score,
      comboCount: live.combo,
      starsCollected: live.combo,
      starsTotal: song.charts[this.difficulty].notes.length,
      hearts: Math.ceil((live.hp / 100) * 5),
      maxHearts: 5,
      bossHp: 0,
      bossMaxHp: 0,
      hasKey: false,
      status: this.getStatus(),
      statusBanner: `${song.title} [${this.difficulty}] · ${song.bpm} BPM · ${tierLabel}`,
      bgmTheme: 'starlight',
      tiles: [],
      entities: [],
      particles: [],
      lights: [],
      bgStars: this.bgStars,
      bgClouds: [],
      hudPrimitives: this.hudPrimitives,
      ambientDarkness: 0.08,
      screenFlashAlpha: live.camera.kick * 0.08,
    };
  }
}
