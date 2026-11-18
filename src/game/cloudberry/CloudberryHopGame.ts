import { WorldKernel } from '../../core/sim/WorldKernel.ts';
import type {
  ComboTrackingCartridge,
  DebuggableCartridge,
  InputState,
  RenderSceneSnapshot,
  RuntimeParams,
  SimEvent,
} from '../../core/types/WorldTypes.ts';
import { CLOUDBERRY_STAGES, type CloudberryStageSpec } from './CloudberryStages.ts';

export { CLOUDBERRY_STAGES, type CloudberryStageSpec };

const WORLD_H = 180;

/**
 * PA-01 Cloudberry Hop: 4 Worlds x 2 Stages = 8-Stage Platformer Campaign (24 Stars Total).
 * Clean data-driven StageSpec[] powering WorldKernel with Double-Jump & Air-Dash Relics, Checkpoints & Boss Battle.
 */
export class CloudberryHopGame implements DebuggableCartridge, ComboTrackingCartridge {
  private readonly world: WorldKernel;
  private stageIdx = 0;
  private bestStarsByStage: number[] = CLOUDBERRY_STAGES.map(() => 0);

  constructor(initialStage = 0) {
    this.world = new WorldKernel({
      cartridgeId: 'cloudberry-hop',
      worldWidth: 736,
      worldHeight: WORLD_H,
    });
    this.loadStage(initialStage);
  }

  public getStageCount(): number {
    return CLOUDBERRY_STAGES.length;
  }

  public getStageIndex(): number {
    return this.stageIdx;
  }

  public loadStage(idx: number): void {
    this.stageIdx = Math.max(0, Math.min(CLOUDBERRY_STAGES.length - 1, idx));
    const spec = CLOUDBERRY_STAGES[this.stageIdx];
    this.world.resetStage({
      worldWidth: spec.worldWidth,
      worldHeight: WORLD_H,
      skyTop: spec.skyTop,
      skyBottom: spec.skyBottom,
      ambientDarkness: spec.ambientDarkness,
      statusBanner: spec.hint,
      spawnX: spec.spawn.x,
      spawnY: spec.spawn.y,
      stage: {
        index: this.stageIdx + 1,
        total: CLOUDBERRY_STAGES.length,
        name: spec.name,
      },
      bgmTheme: spec.bgmTheme,
    });

    for (const isl of spec.islands) {
      const startX = isl.startTile * 16;
      const width = isl.countTiles * 16;
      this.world.solids.push({ x: startX, y: isl.topY, w: width, h: WORLD_H - isl.topY, kind: 'solid' });
      for (let i = 0; i < isl.countTiles; i++) {
        const x = startX + i * 16;
        this.world.tiles.push({ sprite: spec.groundTop, x, y: isl.topY, w: 16, h: 16 });
        for (let y = isl.topY + 16; y < WORLD_H; y += 16) {
          this.world.tiles.push({ sprite: spec.groundFill, x, y, w: 16, h: 16 });
        }
      }
    }

    for (const c of spec.clouds) {
      this.world.addCloudPlatform(c.x, c.y, c.tilesWide);
    }
    for (const mp of spec.movingPlats ?? []) {
      this.world.addMovingPlatform(mp.x, mp.y, mp.tilesWide, mp);
    }
    for (const sp of spec.springs ?? []) {
      this.world.spawn('spring', sp.x, sp.y);
    }
    for (const tr of spec.torches ?? []) {
      this.world.spawn('torch', tr.x, tr.y);
    }
    for (const cp of spec.checkpoints ?? []) {
      this.world.spawn('checkpoint_flag', cp.x, cp.y);
    }
    for (const s of spec.slimes) {
      this.world.spawn('slime', s.x, s.y, { minX: s.minX, maxX: s.maxX, vx: s.vx });
    }
    for (const st of spec.stars) {
      this.world.spawn('star', st.x, st.y);
    }
    for (const cn of spec.coins ?? []) {
      this.world.spawn('coin', cn.x, cn.y);
    }
    if (spec.relic) {
      this.world.spawn(spec.relic.id, spec.relic.x, spec.relic.y);
    }
    if (spec.keyPos) {
      this.world.spawn('key', spec.keyPos.x, spec.keyPos.y);
    }
    if (spec.bossPos) {
      this.world.spawn('slime_king', spec.bossPos.x, spec.bossPos.y, {
        minX: spec.bossPos.minX,
        maxX: spec.bossPos.maxX,
        vx: 44,
        hp: 5,
      });
    }
    this.world.spawn('gate', spec.gatePos.x, spec.gatePos.y);

    this.world.bgClouds = spec.ambientDarkness > 0.3
      ? []
      : [
          { x: 40, y: 34, scale: 1.1, speed: 6, tint: '#ffffff', alpha: 0.78 },
          { x: 190, y: 24, scale: 0.9, speed: 4, tint: '#fffaf0', alpha: 0.68 },
          { x: 350, y: 46, scale: 1.25, speed: 7, tint: '#ffffff', alpha: 0.72 },
          { x: 540, y: 28, scale: 1.0, speed: 5, tint: '#fffaf0', alpha: 0.76 },
        ];
  }

  public setDebugHitboxes(enabled: boolean): void {
    this.world.debugHitboxes = enabled;
  }

  public step(dt: number, input: InputState, params: RuntimeParams): SimEvent[] {
    const events = this.world.step(dt, input, params);
    if (this.world.input.justPressed('shoulderL')) {
      this.retryStage();
      events.push('snap');
      return events;
    }
    const curStars = this.world.getStageStars().collected;
    if (curStars > this.bestStarsByStage[this.stageIdx]) {
      this.bestStarsByStage[this.stageIdx] = curStars;
    }

    const spec = CLOUDBERRY_STAGES[this.stageIdx];
    const boss = this.world.entities.find((e) => e.alive && e.tags.has('boss'));
    if (boss) {
      this.world.statusBanner = `👑 巨大史萊姆王 HP ${boss.hp}/${boss.maxHp}｜踩踏 5 次擊敗！`;
    } else if (this.world.gateUnlocked) {
      this.world.statusBanner = `${spec.name}｜門已開啟！踏入傳送門前往下一關！`;
    } else {
      this.world.statusBanner = spec.hint;
    }

    if (this.world.status === 'won' && this.stageIdx + 1 < CLOUDBERRY_STAGES.length) {
      this.world.hearts = Math.min(this.world.maxHearts, this.world.hearts + 1);
      this.loadStage(this.stageIdx + 1);
      this.world.juice.triggerFlash('#fffaf0', 0.25);
      events.push('key');
    }
    return events;
  }

  public retryStage(): void {
    this.world.hearts = this.world.maxHearts;
    this.loadStage(this.stageIdx);
  }

  public serializeSave(): unknown {
    return {
      v: 1,
      stageIdx: this.stageIdx,
      score: this.world.score,
      hearts: this.world.hearts,
      relics: { ...this.world.relics },
      bestStarsByStage: [...this.bestStarsByStage],
    };
  }

  public hydrateSave(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as {
      v?: number;
      stageIdx?: number;
      score?: number;
      hearts?: number;
      relics?: { doubleJump?: boolean; airDash?: boolean };
      bestStarsByStage?: number[];
    };
    if (s.v !== 1 || typeof s.stageIdx !== 'number') return false;
    this.world.score = Number(s.score ?? 0);
    this.world.hearts = Math.max(1, Math.min(this.world.maxHearts, Number(s.hearts ?? 3)));
    this.world.relics = {
      doubleJump: Boolean(s.relics?.doubleJump),
      airDash: Boolean(s.relics?.airDash),
    };
    if (Array.isArray(s.bestStarsByStage)) {
      this.bestStarsByStage = CLOUDBERRY_STAGES.map((_, i) => Number(s.bestStarsByStage?.[i] ?? 0));
    }
    this.loadStage(s.stageIdx);
    this.world.noticeBanner = `💾 已從 ${CLOUDBERRY_STAGES[this.stageIdx].name} 續關！`;
    this.world.noticeTimer = 3.0;
    return true;
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    return this.world.status;
  }

  public getComboCount(): number {
    return this.world.juice.comboCount;
  }

  public snapshot(params: RuntimeParams): RenderSceneSnapshot {
    const snap = this.world.snapshot(params);
    const totalStars = CLOUDBERRY_STAGES.length * 3;
    const curCollected = this.world.getStageStars().collected;
    let totalCollected = 0;
    for (let i = 0; i < CLOUDBERRY_STAGES.length; i++) {
      totalCollected += i === this.stageIdx ? Math.max(this.bestStarsByStage[i], curCollected) : this.bestStarsByStage[i];
    }
    snap.starsCollected = totalCollected;
    snap.starsTotal = totalStars;
    return snap;
  }
}
