import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { GAME_H, GAME_W, type LogicalViewport } from '../gpu/GpuTypes.ts';
import type { InputMap } from '../input/InputMap.ts';
import { SpatialHash } from '../math/SpatialHash.ts';
import { stepSpringInto } from '../math/SpringDynamics.ts';
import type {
  BgCloudDesc,
  BgParallaxLayerDesc,
  BgStarDesc,
  Hd2dDepthConfig,
  SimEvent,
  TileDesc,
} from '../types/WorldTypes.ts';
import { clamp } from '../types/WorldTypes.ts';
import type { ShmupFighterSummary } from '../types/HudTypes.ts';
import type {
  CartridgeArchetypeDef,
  CartridgeJsonV1,
  CartridgeStageDef,
  CartridgeTag,
  CartridgeTileChunkDef,
} from './CartridgeSchema.ts';
import {
  EF_CRUMBLE_TILE,
  EF_CRYSTAL_RESET,
  EF_GRAPPLE_TARGET,
  EF_ZIP_BLOCK,
} from './DataRuntimePlatformer.ts';
import {
  applyShmupLoadout,
  type RuntimeShmupState,
  type ShmupRuntimeContext,
} from './DataRuntimeShmup.ts';
import { MAX_FLOATING_TEXTS, type FloatingTextSlot } from './DataRuntimeSnapshot.ts';
import type { EventActionVm, VmButtonEdge, VmButtonId, VmHostBridge } from './EventActionVm.ts';
import {
  EF_FIGHTER_P2,
  EF_LOGIC_SWITCH,
  EF_PUSHABLE_CRATE,
  type RuntimeGenreState,
} from './GenreControllers.ts';
import type { JuiceSystem } from './JuiceSystem.ts';
import {
  applyOklabParallaxFog,
  compileProceduralStage,
  type ResolvedStageArtMood,
} from './ProceduralStageCompiler.ts';
import type { ProceduralVisualRigRuntime } from './ProceduralVisualRig.ts';
import {
  BM_CHASE,
  BM_MOVING_PLATFORM,
  BM_ORBIT,
  BM_PATROL,
  BM_SIN_FLOAT,
  EF_ALIVE,
  EF_BOSS,
  EF_BOUNCY,
  EF_BULLET,
  EF_COLLECTIBLE,
  EF_EMISSIVE,
  EF_ENEMY,
  EF_GRAVITY,
  EF_HAZARD,
  EF_ONE_WAY,
  EF_PICKUP,
  EF_PLAYER,
  EF_SOLID,
  EF_STOMPABLE,
  EF_WEAK_POINT,
  MAX_ENTITIES,
  SoaEntityPool,
} from './SoaEntityPool.ts';
import {
  CHUNK_SIZE,
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
} from './TilemapGrid.ts';
import type { TweenSystem } from './TweenSystem.ts';

export interface RuntimeArchetype {
  id: string;
  def: CartridgeArchetypeDef;
  flags: number;
  behaviorMask: number;
  scoreValue: number;
  dropKind?: string;
}

export const STARFIELD_PALETTE = ['#fffaf0', '#ffd447', '#5ec2f7', '#ff8ec6', '#e0aaff'] as const;

export function compileTagsToFlags(tags: readonly CartridgeTag[]): number {
  let f = EF_ALIVE;
  for (let i = 0; i < tags.length; i++) {
    switch (tags[i]) {
      case 'player': f |= EF_PLAYER; break;
      case 'solid': f |= EF_SOLID; break;
      case 'oneway': f |= EF_ONE_WAY; break;
      case 'hazard': f |= EF_HAZARD; break;
      case 'collectible': f |= EF_COLLECTIBLE; break;
      case 'stompable': f |= EF_STOMPABLE; break;
      case 'bouncy': f |= EF_BOUNCY; break;
      case 'gravity': f |= EF_GRAVITY; break;
      case 'enemy': f |= EF_ENEMY; break;
      case 'boss': f |= EF_BOSS; break;
      case 'weak_point': f |= EF_WEAK_POINT; break;
      case 'bullet': f |= EF_BULLET; break;
      case 'enemy_bullet': f |= EF_BULLET | EF_ENEMY; break;
      case 'pickup': f |= EF_PICKUP; break;
      case 'funnel': f |= EF_ALIVE; break;
      case 'grapple_ring': f |= EF_GRAPPLE_TARGET | EF_EMISSIVE; break;
      case 'zip_block': f |= EF_GRAPPLE_TARGET | EF_SOLID | EF_EMISSIVE | EF_ZIP_BLOCK; break;
      case 'crystal_reset': f |= EF_CRYSTAL_RESET | EF_EMISSIVE; break;
      case 'crumble_tile': f |= EF_SOLID | EF_CRUMBLE_TILE; break;
      case 'updraft': f |= EF_EMISSIVE; break;
      case 'fighter_p2': f |= EF_ENEMY | EF_STOMPABLE | EF_FIGHTER_P2; break;
      case 'card_slot': f |= EF_EMISSIVE; break;
      case 'logic_switch': f |= EF_EMISSIVE | EF_LOGIC_SWITCH; break;
    }
  }
  return f;
}

export function compileArchetypes(
  archetypeDefs: Record<string, CartridgeArchetypeDef>,
): {
  archetypes: RuntimeArchetype[];
  archetypeIdxById: Map<string, number>;
  archetypeMetaByIdx: { id: string; scoreValue: number; dropKind?: string }[];
} {
  const archetypes: RuntimeArchetype[] = [];
  const archetypeIdxById = new Map<string, number>();
  const archetypeMetaByIdx: { id: string; scoreValue: number; dropKind?: string }[] = [];

  for (const [id, def] of Object.entries(archetypeDefs)) {
    const idx = archetypes.length;
    let bm = 0;
    if (def.behavior?.kind === 'patrol') bm |= BM_PATROL;
    else if (def.behavior?.kind === 'sine') bm |= BM_SIN_FLOAT;
    else if (def.behavior?.kind === 'chase_los') bm |= BM_CHASE;
    else if (def.behavior?.kind === 'orbit') bm |= BM_ORBIT;
    archetypes.push({
      id,
      def,
      flags: compileTagsToFlags(def.tags),
      behaviorMask: bm,
      scoreValue: def.scoreValue ?? 75,
      dropKind: def.dropTable?.onDestroyKind,
    });
    archetypeIdxById.set(id, idx);
    archetypeMetaByIdx.push({ id, scoreValue: def.scoreValue ?? 75, dropKind: def.dropTable?.onDestroyKind });
  }

  return { archetypes, archetypeIdxById, archetypeMetaByIdx };
}

export function countCampaignStars(
  stages: readonly CartridgeStageDef[],
  hasStarArchetype: boolean,
): { bestStarsByStage: number[]; totalCampaignStars: number } {
  let totalCampaignStars = 0;
  const bestStarsByStage = stages.map((st) => {
    let c = 0;
    for (const sp of st.spawns ?? []) if (sp.archetype === 'star') c++;
    if (st.procedural?.autoSpawns?.stars && hasStarArchetype) {
      c += Math.min(32, Math.round(st.procedural.autoSpawns.stars));
    }
    totalCampaignStars += c;
    return 0;
  });
  return { bestStarsByStage, totalCampaignStars };
}

export function createInitialShmupState(def: CartridgeJsonV1, skipHangar?: boolean): RuntimeShmupState {
  const cachedFighters: ShmupFighterSummary[] = (def.player.loadouts ?? []).map((f) => ({
    id: f.id, name: f.name, code: f.code, tagline: f.tagline,
    speedStat: f.speedStat, armorStat: f.armorStat, fireStat: f.fireStat,
    ultLabel: f.ultLabel, accentHex: f.accentHex,
  }));

  const firstLoadout = def.player.loadouts?.[0];
  return {
    phase: def.player.bootInHangar && !skipHangar ? 'hangar' : 'sortie',
    selectedLoadoutIdx: 0,
    fighterId: firstLoadout?.id ?? 'starfalcon',
    weaponKind: firstLoadout?.defaultWeapon ?? 'crimson',
    weaponLevel: 1,
    bombs: firstLoadout?.initialBombs ?? 2,
    maxBombs: def.player.bomb?.maxBombs ?? 4,
    funnelCount: firstLoadout?.initialFunnels ?? 0,
    chargeSec: 0,
    funnelOverdriveTimer: 0,
    overdriveShieldTimer: 0,
    grazeCount: 0,
    grazeMeter: 0,
    shootCooldown: 0,
    invulnTimer: 0,
    waveIndex: 0,
    waveTimer: 0,
    thrusterTimer: 0,
    chargeParticleTimer: 0,
    hangarNavCooldown: 0,
    nextPierceGroup: 1,
    squash: { scaleX: 1, scaleY: 1 },
    funnelSlots: new Int16Array(4).fill(-1),
    cachedFighters,
    targetHash: new SpatialHash(MAX_ENTITIES, 24, 4096, MAX_ENTITIES * 4, 36),
    targetEnemySlots: new Uint16Array(MAX_ENTITIES),
    playerBulletSlots: new Uint16Array(MAX_ENTITIES),
    querySlots: new Int32Array(MAX_ENTITIES),
  };
}

export function createInitialBgStars(starCount: number): BgStarDesc[] {
  const stars: BgStarDesc[] = [];
  for (let i = 0; i < starCount; i++) {
    stars.push({
      x: (i * 59 + 17) % GAME_W,
      y: (i * 37 + 11) % GAME_H,
      size: i % 4 === 0 ? 2 : 1,
      phase: i * 0.7,
      color: STARFIELD_PALETTE[i % STARFIELD_PALETTE.length],
    });
  }
  return stars;
}

export interface DataVmHostContext {
  readonly def: CartridgeJsonV1;
  readonly pool: SoaEntityPool;
  readonly input: InputMap;
  readonly juice: JuiceSystem;
  readonly vm: EventActionVm;
  readonly tweens: TweenSystem;
  readonly genre: RuntimeGenreState;
  readonly archetypeMetaByIdx: readonly { id: string; scoreValue: number; dropKind?: string }[];
  readonly heroSquash: { scaleX: number; scaleY: number };
  readonly eventsOut: SimEvent[];
  playerSlot: number;
  stageIdx: number;
  status: 'playing' | 'won' | 'lost';
  spawnArchetype(archetypeId: string, x: number, y: number, vx?: number, vy?: number, parentSlot?: number): number;
  spawnFloatingText(text: string, wx: number, wy: number, color?: string): void;
  enterStage(idx: number): void;
}

export function createDataVmHostBridge(ctx: DataVmHostContext): VmHostBridge {
  return {
    isButton: (b: VmButtonId, edge: VmButtonEdge) =>
      edge === 'held' ? ctx.input.held(b) : edge === 'released' ? ctx.input.justReleased(b) : ctx.input.justPressed(b),
    spawn: (aid, anchor, x, y, vx, vy, selfSlot, otherSlot) => {
      let bx = 0;
      let by = 0;
      if (anchor === 'player' && ctx.playerSlot >= 0) {
        bx = ctx.pool.x[ctx.playerSlot];
        by = ctx.pool.y[ctx.playerSlot];
      } else if (anchor === 'self' && selfSlot >= 0) {
        bx = ctx.pool.x[selfSlot];
        by = ctx.pool.y[selfSlot];
      } else if (anchor === 'other' && otherSlot >= 0) {
        bx = ctx.pool.x[otherSlot];
        by = ctx.pool.y[otherSlot];
      }
      ctx.spawnArchetype(aid, bx + x, by + y, vx, vy);
    },
    destroy: (target, tag, selfSlot, otherSlot) => {
      if (target === 'self' && selfSlot >= 0) {
        ctx.pool.free(selfSlot);
        ctx.vm.clearEntityVars(selfSlot);
      } else if (target === 'other' && otherSlot >= 0) {
        ctx.pool.free(otherSlot);
        ctx.vm.clearEntityVars(otherSlot);
      } else if (target === 'byTag' && tag) {
        for (let i = ctx.pool.activeCount - 1; i >= 0; i--) {
          const s = ctx.pool.activeIndices[i];
          const aid = ctx.pool.archetypeIdx[s] >= 0 ? ctx.archetypeMetaByIdx[ctx.pool.archetypeIdx[s]].id : '';
          if (aid === tag) {
            ctx.pool.free(s);
            ctx.vm.clearEntityVars(s);
          }
        }
      }
    },
    impulse: (target, vx, vy, setVel, selfSlot, otherSlot) => {
      const slot = target === 'player' ? ctx.playerSlot : target === 'other' ? otherSlot : selfSlot;
      if (slot < 0) return;
      if (setVel) {
        ctx.pool.vx[slot] = vx;
        ctx.pool.vy[slot] = vy;
      } else {
        ctx.pool.vx[slot] += vx;
        ctx.pool.vy[slot] += vy;
      }
    },
    playSfx: (preset) => {
      ctx.eventsOut.push(preset);
    },
    triggerJuice: (act) => {
      if (act.preset) ctx.juice.applyPreset(act.preset);
      if (act.hitstopFrames) ctx.juice.triggerHitstop(act.hitstopFrames / 60);
      if (act.trauma) ctx.juice.addTrauma(act.trauma);
      if (act.flashColor) ctx.juice.triggerFlash(act.flashColor, act.flashAlpha ?? 0.25);
      if (act.squashX && act.squashY) {
        ctx.heroSquash.scaleX = act.squashX;
        ctx.heroSquash.scaleY = act.squashY;
      }
    },
    endGame: (outcome, targetStage) => {
      if (outcome === 'nextStage') {
        const next = targetStage ?? ctx.stageIdx + 1;
        if (next < ctx.def.stages.length) ctx.enterStage(next);
        else ctx.status = 'won';
      } else {
        ctx.status = outcome;
      }
    },
    emitSignal: () => {
      // Queue already populated by EventActionVm.emitSignal(); hook kept for bridge completeness
    },
    floatText: (text, color, anchor, x, y, selfSlot, otherSlot) => {
      let wx = x;
      let wy = y;
      if (anchor === 'player' && ctx.playerSlot >= 0) {
        wx += ctx.pool.x[ctx.playerSlot] + ctx.pool.w[ctx.playerSlot] * 0.5;
        wy += ctx.pool.y[ctx.playerSlot] - 6;
      } else if (anchor === 'self' && selfSlot >= 0) {
        wx += ctx.pool.x[selfSlot] + ctx.pool.w[selfSlot] * 0.5;
        wy += ctx.pool.y[selfSlot] - 6;
      } else if (anchor === 'other' && otherSlot >= 0) {
        wx += ctx.pool.x[otherSlot] + ctx.pool.w[otherSlot] * 0.5;
        wy += ctx.pool.y[otherSlot] - 6;
      } else if (anchor === 'other' && ctx.genre.p2Slot >= 0) {
        const p2 = ctx.genre.p2Slot;
        wx += ctx.pool.x[p2] + ctx.pool.w[p2] * 0.5;
        wy += ctx.pool.y[p2] - 6;
      }
      ctx.spawnFloatingText(text, wx, wy, color ?? '#fffaf0');
    },
    tweenVar: (name, to, duration, ease) => {
      ctx.tweens.start(name, ctx.vm.getVar(name, 0), to, duration, ease);
    },
  };
}

export interface StageTilePopulateParams {
  stage: CartridgeStageDef;
  cols: number;
  rows: number;
  worldH: number;
  mood: ResolvedStageArtMood;
  tilemap: TilemapGrid;
  fgTilemap: TilemapGrid;
  tileSpriteLut: (SpriteId | undefined)[];
  fgSpriteLut: (SpriteId | undefined)[];
  fgAlphaLut: Float32Array;
  fgExtraTiles: TileDesc[];
  bgParallaxLayers: BgParallaxLayerDesc[];
  stageSkyBottom: string;
  archetypeIdxById: ReadonlyMap<string, number>;
  archetypes: readonly RuntimeArchetype[];
  spawnArchetype: (aid: string, x: number, y: number) => number;
  onStarSpawned: () => void;
}

export function populateStageTileLayers(p: StageTilePopulateParams): boolean {
  const { stage: st, cols, rows, worldH, mood, tilemap, fgTilemap } = p;
  let hasFgTilemapTiles = false;

  p.tileSpriteLut.length = 0;
  p.fgSpriteLut.length = 0;
  p.fgAlphaLut.fill(1);
  p.tileSpriteLut[1] = st.groundTop ?? 'grass';
  p.tileSpriteLut[2] = st.groundFill ?? 'dirt';
  p.tileSpriteLut[3] = 'cloud_l';
  p.tileSpriteLut[4] = 'cloud_m';
  p.tileSpriteLut[5] = 'cloud_r';
  p.tileSpriteLut[6] = 'stone';
  p.fgSpriteLut[1] = 'tree_canopy';
  p.fgSpriteLut[2] = 'stone';
  p.fgSpriteLut[3] = 'cloud_m';

  if (st.tileGrid?.spriteMap) {
    for (const [k, sp] of Object.entries(st.tileGrid.spriteMap)) {
      const id = Number(k);
      if (Number.isInteger(id) && id > 0) {
        p.tileSpriteLut[id] = sp;
        p.fgSpriteLut[id] = sp;
      }
    }
  }

  if (st.tileChunks) {
    for (let ci = 0; ci < st.tileChunks.length; ci++) {
      const ch: CartridgeTileChunkDef = st.tileChunks[ci];
      const sm = ch.spriteMap;
      if (sm) {
        for (const k of Object.keys(sm)) {
          const sp = sm[k];
          const id = Number(k);
          if (Number.isInteger(id) && id > 0) {
            p.tileSpriteLut[id] = sp;
            p.fgSpriteLut[id] = sp;
          }
        }
      }
      const baseCol = ch.cx * CHUNK_SIZE;
      const baseRow = ch.cy * CHUNK_SIZE;
      for (let lr = 0; lr < CHUNK_SIZE; lr++) {
        const r = baseRow + lr;
        if (r >= rows) break;
        const rowOff = lr * CHUNK_SIZE;
        for (let lc = 0; lc < CHUNK_SIZE; lc++) {
          const c = baseCol + lc;
          if (c >= cols) break;
          const i = rowOff + lc;
          const tid = ch.tiles[i];
          const colKind = ch.collision[i];
          if (tid !== 0 || colKind !== 0) {
            tilemap.setTile(c, r, tid, colKind, false);
          }
          if (ch.fgTiles) {
            const ftid = ch.fgTiles[i];
            if (ftid !== 0) {
              fgTilemap.setTile(c, r, ftid, COLLISION_EMPTY, false);
              hasFgTilemapTiles = true;
            }
          }
        }
      }
    }
  }

  if (st.tileGrid) {
    for (let r = 0; r < st.tileGrid.rows && r < rows; r++) {
      for (let c = 0; c < st.tileGrid.cols && c < cols; c++) {
        const i = r * st.tileGrid.cols + c;
        const tid = st.tileGrid.tiles[i];
        const colKind = st.tileGrid.collision[i];
        if (tid !== 0 || colKind !== 0) {
          tilemap.setTile(c, r, tid, colKind, false);
        }
        if (st.tileGrid.fgTiles) {
          const ftid = st.tileGrid.fgTiles[i];
          if (ftid !== 0) {
            fgTilemap.setTile(c, r, ftid, COLLISION_EMPTY, false);
            hasFgTilemapTiles = true;
          }
        }
      }
    }
  } else if (st.procedural) {
    compileProceduralStage({
      stage: st,
      worldW: st.worldWidth,
      worldH,
      tilemap,
      fgExtraTiles: p.fgExtraTiles,
      bgParallaxLayers: p.bgParallaxLayers,
      mood,
      hasArchetype: (id) => p.archetypeIdxById.has(id),
      pickEnemyArchetype: () => {
        for (let i = 0; i < p.archetypes.length; i++) {
          if ((p.archetypes[i].flags & EF_ENEMY) !== 0) return p.archetypes[i].id;
        }
        return null;
      },
      spawnArchetype: p.spawnArchetype,
      onStarSpawned: p.onStarSpawned,
    });
  } else if (!st.tileChunks) {
    for (const isl of st.islands ?? []) {
      const topRow = clamp(Math.round(isl.topY / TILE_SIZE), 0, rows - 1);
      const endC = Math.min(cols, isl.startTile + isl.countTiles);
      for (let c = Math.max(0, isl.startTile); c < endC; c++) {
        tilemap.setTile(c, topRow, 1, COLLISION_SOLID, false);
        for (let row = topRow + 1; row < rows; row++) {
          if (row * TILE_SIZE >= worldH) break;
          tilemap.setTile(c, row, 2, COLLISION_SOLID, false);
        }
      }
    }
    for (const cl of st.clouds ?? []) {
      const row = clamp(Math.round(cl.y / TILE_SIZE), 0, rows - 1);
      const startC = Math.round(cl.x / TILE_SIZE);
      for (let i = 0; i < cl.tilesWide; i++) {
        const tid = i === 0 ? 3 : i === cl.tilesWide - 1 ? 5 : 4;
        tilemap.setTile(startC + i, row, tid, COLLISION_CLOUD, false);
      }
    }
  }

  for (const fg of st.fgIslands ?? []) {
    const sprite: SpriteId = fg.sprite ?? 'tree_canopy';
    const alpha = fg.alpha ?? 1;
    let fgId = -1;
    for (let id = 1; id < 256; id++) {
      if (p.fgSpriteLut[id] === sprite && Math.abs(p.fgAlphaLut[id] - alpha) < 1e-4) {
        fgId = id;
        break;
      }
    }
    if (fgId < 0) {
      for (let id = 4; id < 256; id++) {
        if (p.fgSpriteLut[id] === undefined) {
          p.fgSpriteLut[id] = sprite;
          p.fgAlphaLut[id] = alpha;
          fgId = id;
          break;
        }
      }
    }
    const topRow = clamp(Math.round(fg.topY / TILE_SIZE), 0, rows - 1);
    const spanRows = clamp(Math.round(fg.rows ?? 1), 1, rows - topRow);
    const c0 = Math.max(0, fg.startTile);
    const c1 = Math.min(cols - 1, fg.startTile + fg.countTiles - 1);
    if (fgId > 0) {
      for (let r = topRow; r < topRow + spanRows; r++) {
        for (let c = c0; c <= c1; c++) {
          fgTilemap.setTile(c, r, fgId, COLLISION_EMPTY, false);
          hasFgTilemapTiles = true;
        }
      }
    } else {
      for (let r = topRow; r < topRow + spanRows; r++) {
        for (let c = c0; c <= c1; c++) {
          p.fgExtraTiles.push({
            sprite,
            x: c * TILE_SIZE,
            y: r * TILE_SIZE,
            w: TILE_SIZE,
            h: TILE_SIZE,
            alpha,
          });
        }
      }
    }
  }

  for (const ft of st.fgTiles ?? []) {
    p.fgExtraTiles.push({
      sprite: ft.sprite,
      x: ft.x,
      y: ft.y,
      w: ft.w ?? TILE_SIZE,
      h: ft.h ?? TILE_SIZE,
      tint: ft.tint,
      alpha: ft.alpha,
      flipX: ft.flipX,
      elevationZ: ft.elevationZ,
      sortY: ft.sortY,
    });
  }

  for (const ly of st.bgParallaxLayers ?? []) {
    p.bgParallaxLayers.push({ ...ly });
  }
  if (mood.parallaxFog > 0 && p.bgParallaxLayers.length > 0) {
    applyOklabParallaxFog(p.bgParallaxLayers, p.stageSkyBottom, mood.parallaxFog);
  }

  tilemap.recomputeAutoMask();
  if (hasFgTilemapTiles) {
    fgTilemap.recomputeAutoMask();
  }
  return hasFgTilemapTiles;
}

export function spawnStagePlatformsAndEntities(
  st: CartridgeStageDef,
  pool: SoaEntityPool,
  spawnArchetype: (aid: string, x: number, y: number, vx?: number, vy?: number) => number,
): { bossSlot: number; stageHasKey: boolean; starsCounted: number } {
  for (const mp of st.movingPlatforms ?? []) {
    const slot = spawnArchetype('moving_plat', mp.x, mp.y, mp.vx ?? 0, mp.vy ?? 0);
    if (slot >= 0) {
      pool.w[slot] = clamp(Math.round(mp.tilesWide), 2, 6) * TILE_SIZE;
      pool.h[slot] = 10;
      pool.behaviorMask[slot] |= BM_MOVING_PLATFORM;
      pool.paramA[slot] = mp.minX ?? mp.x;
      pool.paramB[slot] = mp.maxX ?? mp.x;
      pool.paramC[slot] = mp.minY ?? mp.y;
      pool.paramD[slot] = mp.maxY ?? mp.y;
    }
  }

  let bossSlot = -1;
  let stageHasKey = false;
  let starsCounted = 0;
  for (const sp of st.spawns ?? []) {
    const s = spawnArchetype(sp.archetype, sp.x, sp.y, sp.vx ?? 0, sp.vy ?? 0);
    if (s >= 0) {
      if (sp.hp !== undefined) {
        pool.hp[s] = sp.hp;
        pool.maxHp[s] = sp.hp;
      }
      if (sp.minX !== undefined) pool.paramA[s] = sp.minX;
      if (sp.maxX !== undefined) pool.paramB[s] = sp.maxX;
      if (sp.archetype === 'star') starsCounted++;
      if (sp.archetype === 'key') stageHasKey = true;
      if ((pool.flags[s] & EF_BOSS) !== 0) bossSlot = s;
    }
  }
  return { bossSlot, stageHasKey, starsCounted };
}

export function configureStageAtmosphereAndRig(
  st: CartridgeStageDef,
  def: CartridgeJsonV1,
  stageSkyBottom: string,
  stageViewport: LogicalViewport,
  visualRig: ProceduralVisualRigRuntime,
  hd2dConfig: Hd2dDepthConfig,
): BgCloudDesc[] {
  const bgClouds = st.bgClouds
    ? [...st.bgClouds]
    : (st.ambientDarkness ?? 0) > 0.3 || def.player.controller === 'shmup'
      ? []
      : [
          { x: 40, y: 34, scale: 1.1, speed: 6, tint: '#ffffff', alpha: 0.78 },
          { x: 190, y: 24, scale: 0.9, speed: 4, tint: '#fffaf0', alpha: 0.68 },
          { x: 350, y: 46, scale: 1.25, speed: 7, tint: '#ffffff', alpha: 0.72 },
        ];

  visualRig.configure(
    def.player.visualRig,
    st.atmosphere,
    st.spawn.x,
    st.spawn.y,
    stageViewport.width,
    stageViewport.height,
  );

  const atm = st.atmosphere;
  if (
    atm &&
    (atm.waterLevelY !== undefined ||
      atm.horizonHazeAlpha !== undefined ||
      atm.tiltShiftAlpha !== undefined ||
      atm.splitToneWarmth !== undefined)
  ) {
    hd2dConfig.enabled = true;
    hd2dConfig.sortByDepthY = false;
    hd2dConfig.waterLevelY = atm.waterLevelY;
    hd2dConfig.waterTint = atm.waterTint ?? '#2e5d8a';
    hd2dConfig.horizonHazeColor = atm.horizonHazeColor ?? stageSkyBottom;
    hd2dConfig.horizonHazeAlpha = atm.horizonHazeAlpha ?? 0.22;
    hd2dConfig.tiltShiftAlpha = atm.tiltShiftAlpha ?? 0.14;
    hd2dConfig.splitToneWarmth = atm.splitToneWarmth;
  } else {
    hd2dConfig.enabled = false;
    hd2dConfig.waterLevelY = undefined;
  }

  return bgClouds;
}

export function spawnArchetypeIntoPool(
  pool: SoaEntityPool,
  archetypes: readonly RuntimeArchetype[],
  archetypeIdxById: ReadonlyMap<string, number>,
  archetypeId: string,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
  parentSlot = -1,
): number {
  const idx = archetypeIdxById.get(archetypeId);
  if (idx === undefined) return -1;
  const arch = archetypes[idx];
  const slot = pool.alloc(x, y, arch.def.w, arch.def.h);
  if (slot < 0) return -1;
  pool.archetypeIdx[slot] = idx;
  pool.flags[slot] = arch.flags;
  if (archetypeId === 'crate' || ((arch.flags & EF_SOLID) !== 0 && !arch.def.tags.includes('zip_block'))) {
    pool.flags[slot] |= EF_PUSHABLE_CRATE;
  }
  pool.behaviorMask[slot] = arch.behaviorMask;
  pool.hp[slot] = arch.def.hp ?? 1;
  pool.maxHp[slot] = arch.def.hp ?? 1;
  pool.vx[slot] = vx !== 0 ? vx : arch.def.behavior?.speedX ?? 0;
  pool.vy[slot] = vy !== 0 ? vy : arch.def.behavior?.speedY ?? 0;
  pool.parentSlot[slot] = parentSlot;
  pool.paramA[slot] = (arch.behaviorMask & BM_CHASE) !== 0 ? 0 : x * 0.1;
  pool.paramB[slot] = (arch.behaviorMask & BM_SIN_FLOAT) !== 0 ? y : 0;
  if ((arch.flags & EF_ZIP_BLOCK) !== 0) {
    pool.paramA[slot] = x;
    pool.paramB[slot] = x + 64;
    pool.paramC[slot] = y;
    pool.aiState[slot] = 0;
  } else if ((arch.flags & EF_CRUMBLE_TILE) !== 0) {
    pool.aiState[slot] = 0;
    pool.timerA[slot] = 0;
  }
  pool.pivotX[slot] = 0.5;
  pool.pivotY[slot] = arch.def.castShadow ? 1.0 : 0.5;
  if (arch.def.paletteRow !== undefined) pool.paletteRow[slot] = arch.def.paletteRow;
  if (arch.def.emissive && arch.def.emissive > 0) pool.flags[slot] |= EF_EMISSIVE;
  return slot;
}

export function spawnFloatingTextInSlots(
  floatingTexts: FloatingTextSlot[],
  cursor: number,
  text: string,
  wx: number,
  wy: number,
  color = '#fffaf0',
): number {
  if (!text) return cursor;
  let slotIdx = -1;
  for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
    if (!floatingTexts[i].active) {
      slotIdx = i;
      break;
    }
  }
  let nextCursor = cursor;
  if (slotIdx < 0) {
    slotIdx = cursor;
    nextCursor = (cursor + 1) % MAX_FLOATING_TEXTS;
  }
  const ft = floatingTexts[slotIdx];
  ft.active = true;
  ft.text = text;
  ft.x = wx;
  ft.y = wy;
  ft.vy = -26;
  ft.life = 0;
  ft.maxLife = 0.85;
  ft.color = color;
  return nextCursor;
}

export function stepAmbientAndFloatingTexts(
  bgStars: BgStarDesc[],
  bgClouds: BgCloudDesc[],
  pool: SoaEntityPool,
  floatingTexts: FloatingTextSlot[],
  stageIdx: number,
  stageWorldW: number,
  dt: number,
): void {
  for (let i = 0; i < bgStars.length; i++) {
    const s = bgStars[i];
    s.x -= (s.size > 1 ? 36 : 19) * (1 + stageIdx * 0.15) * dt;
    if (s.x < 0) s.x += GAME_W;
  }
  for (let i = 0; i < bgClouds.length; i++) {
    const c = bgClouds[i];
    c.x -= c.speed * dt;
    if (c.x < -48) c.x += Math.max(GAME_W, stageWorldW) + 64;
  }
  for (let i = 0; i < pool.activeCount; i++) {
    const s = pool.activeIndices[i];
    if (pool.flash[s] > 0) pool.flash[s] = Math.max(0, pool.flash[s] - dt * 6);
  }
  for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
    const ft = floatingTexts[i];
    if (!ft.active) continue;
    ft.life += dt;
    if (ft.life >= ft.maxLife) {
      ft.active = false;
      continue;
    }
    ft.y += ft.vy * dt;
    ft.vy *= 0.94;
  }
}

export interface CameraTrackState {
  cameraX: number;
  cameraY: number;
  camVelX: number;
  camVelY: number;
  prevCamTargetX: number;
  prevCamTargetY: number;
  readonly cameraZoom: number;
  readonly stageViewport: LogicalViewport;
  readonly stageWorldW: number;
  readonly stageWorldH: number;
  readonly springCamFreq: number;
  readonly springCamDamping: number;
  readonly camSpringOut: Float64Array;
}

export function stepSpringOrLerpCamera(
  st: CameraTrackState,
  targetX: number,
  targetY: number,
  dt: number,
): void {
  const zoom = Math.max(0.5, st.cameraZoom);
  const viewW = st.stageViewport.width / zoom;
  const viewH = st.stageViewport.height / zoom;
  const maxCamX = Math.max(0, st.stageWorldW - viewW);
  const maxCamY = Math.max(0, st.stageWorldH - viewH);
  const desiredCamX = clamp(targetX - viewW * 0.42, 0, maxCamX);
  const desiredCamY = clamp(targetY - viewH * 0.55, 0, maxCamY);
  if (st.springCamFreq > 0) {
    stepSpringInto(
      st.cameraX,
      st.camVelX,
      desiredCamX,
      st.prevCamTargetX,
      st.springCamFreq,
      st.springCamDamping,
      0,
      dt,
      st.camSpringOut,
      0,
    );
    st.cameraX = clamp(st.camSpringOut[0], 0, maxCamX);
    st.camVelX = st.camSpringOut[1];
    stepSpringInto(
      st.cameraY,
      st.camVelY,
      desiredCamY,
      st.prevCamTargetY,
      st.springCamFreq,
      st.springCamDamping,
      0,
      dt,
      st.camSpringOut,
      0,
    );
    st.cameraY = clamp(st.camSpringOut[0], 0, maxCamY);
    st.camVelY = st.camSpringOut[1];
    st.prevCamTargetX = desiredCamX;
    st.prevCamTargetY = desiredCamY;
  } else {
    const camAlpha = Math.min(1, dt * 8);
    st.cameraX += (desiredCamX - st.cameraX) * camAlpha;
    st.cameraY += (desiredCamY - st.cameraY) * camAlpha;
  }
}

export function serializeCartridgeRuntimeSave(rt: {
  def: CartridgeJsonV1;
  stageIdx: number;
  score: number;
  starsCollected: number;
  hearts: number;
  shmup: RuntimeShmupState;
  relics: { doubleJump: boolean; airDash: boolean };
  bestStarsByStage: number[];
}): unknown {
  if (rt.def.player.controller === 'shmup') {
    return {
      v: 3,
      sectorIdx: rt.stageIdx,
      score: rt.score,
      starsCollected: rt.starsCollected,
      fighterId: rt.shmup.fighterId,
      hearts: rt.hearts,
      weaponKind: rt.shmup.weaponKind,
      weaponLevel: rt.shmup.weaponLevel,
      bombs: rt.shmup.bombs,
      funnelCount: rt.shmup.funnelCount,
      grazeCount: rt.shmup.grazeCount,
      grazeMeter: rt.shmup.grazeMeter,
    };
  }
  return {
    v: 1,
    stageIdx: rt.stageIdx,
    score: rt.score,
    hearts: rt.hearts,
    relics: { ...rt.relics },
    bestStarsByStage: [...rt.bestStarsByStage],
  };
}

export function hydrateCartridgeRuntimeSave(
  rt: ShmupRuntimeContext & {
    relics: { doubleJump: boolean; airDash: boolean };
    bestStarsByStage: number[];
  },
  raw: unknown,
): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Record<string, unknown>;
  if (rt.def.player.controller === 'shmup') {
    if ((s.v !== 1 && s.v !== 2 && s.v !== 3) || typeof s.sectorIdx !== 'number') return false;
    applyShmupLoadout(rt, typeof s.fighterId === 'string' ? s.fighterId : rt.shmup.fighterId);
    rt.score = Number(s.score ?? 0);
    rt.starsCollected = Number(s.starsCollected ?? 0);
    rt.hearts = clamp(Number(s.hearts ?? rt.maxHearts), 1, rt.maxHearts);
    if (s.weaponKind === 'crimson' || s.weaponKind === 'azure' || s.weaponKind === 'violet') {
      rt.shmup.weaponKind = s.weaponKind;
    }
    rt.shmup.weaponLevel = clamp(Number(s.weaponLevel ?? 1), 1, 3) as 1 | 2 | 3;
    rt.shmup.bombs = clamp(Number(s.bombs ?? 2), 0, rt.shmup.maxBombs);
    rt.shmup.funnelCount = clamp(Number(s.funnelCount ?? 0), 0, 4);
    rt.shmup.grazeCount = Number(s.grazeCount ?? 0);
    rt.shmup.grazeMeter = clamp(Number(s.grazeMeter ?? 0), 0, 99);
    rt.shmup.phase = 'sortie';
    rt.enterStage(s.sectorIdx);
    return true;
  }

  if (s.v !== 1 || typeof s.stageIdx !== 'number') return false;
  rt.score = Number(s.score ?? 0);
  rt.hearts = clamp(Number(s.hearts ?? rt.maxHearts), 1, rt.maxHearts);
  const rel = s.relics as { doubleJump?: boolean; airDash?: boolean } | undefined;
  rt.relics = { doubleJump: Boolean(rel?.doubleJump), airDash: Boolean(rel?.airDash) };
  const savedBest = s.bestStarsByStage;
  if (Array.isArray(savedBest)) {
    rt.bestStarsByStage = rt.def.stages.map((_, i) => Number(savedBest[i] ?? 0));
  }
  rt.enterStage(s.stageIdx);
  return true;
}
