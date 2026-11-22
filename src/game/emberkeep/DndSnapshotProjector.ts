import type { SpriteId } from '../../assets/AtlasSpritesData.ts';
import type {
  DebugRectDesc,
  EntityDesc,
  LightDesc,
  RenderSceneSnapshot,
  RpgHudSnapshot,
  RpgMenuOption,
  RuntimeParams,
  TileDesc,
} from '../../core/types/WorldTypes.ts';
import {
  EXPLORE_ACTIONS,
  TILE_PX,
  getActiveFloor,
  isWalkableAt,
  type AgentObservation,
  type DndWorldState,
} from './DndTypes.ts';

export function getExploreMenu(state: DndWorldState): RpgMenuOption[] {
  return EXPLORE_ACTIONS.map((a) => ({
    ...a,
    enabled: a.id === 'potion' ? state.hero.potions > 0 && state.hero.hp < state.hero.maxHp : true,
  }));
}

export function buildCombatMenu(state: DndWorldState): RpgMenuOption[] {
  return [
    { id: 'attack', label: '⚔️ 斬擊', enabled: true },
    { id: 'firebolt', label: '🔥 火焰箭 (3MP)', enabled: state.hero.mp >= 3 },
    { id: 'guard', label: '🛡️ 防禦 (+2MP)', enabled: true },
    { id: 'heal', label: '💚 治癒 (4MP)', enabled: state.hero.mp >= 4 && state.hero.hp < state.hero.maxHp },
    { id: 'potion', label: `🧪 藥水 (×${state.hero.potions})`, enabled: state.hero.potions > 0 },
  ];
}

export function getLegalActions(state: DndWorldState): RpgMenuOption[] {
  if (state.phase.kind === 'won' || state.phase.kind === 'lost') return [];
  if (state.phase.kind === 'dialog') {
    const dlg = state.moduleDef.dialogs[state.phase.dialogId];
    if (!dlg) return [];
    return dlg.choices.map((c, i) => ({
      id: `dialog_${i}`,
      label: c.costGold ? `${c.label} (${c.costGold}🪙)` : c.label,
      enabled: !c.costGold || state.hero.gold >= c.costGold,
    }));
  }
  if (state.phase.kind === 'combat') {
    if (state.phase.turnOwner !== 'player') return [];
    return buildCombatMenu(state);
  }
  const f = getActiveFloor(state);
  const opts: RpgMenuOption[] = [];
  const dirs: { id: string; label: string; dx: number; dy: number }[] = [
    { id: 'move_n', label: '▲ 北移', dx: 0, dy: -1 },
    { id: 'move_s', label: '▼ 南移', dx: 0, dy: 1 },
    { id: 'move_w', label: '◀ 西移', dx: -1, dy: 0 },
    { id: 'move_e', label: '▶ 東移', dx: 1, dy: 0 },
  ];
  for (const d of dirs) {
    const nx = state.hero.x + d.dx;
    const ny = state.hero.y + d.dy;
    if (isWalkableAt(f, nx, ny, true)) {
      opts.push({ id: d.id, label: d.label, enabled: true });
    }
  }
  if (state.hero.potions > 0 && state.hero.hp < state.hero.maxHp) {
    opts.push({ id: 'potion', label: '🧪 喝藥水', enabled: true });
  }
  opts.push({ id: 'wait', label: '⌛ 待命', enabled: true });
  return opts;
}

export function buildHudSnapshot(state: DndWorldState): RpgHudSnapshot {
  const f = getActiveFloor(state);
  const mode = state.phase.kind;
  let combat: RpgHudSnapshot['combat'];
  let dialog: RpgHudSnapshot['dialog'];
  let actions: RpgMenuOption[] = getExploreMenu(state);
  let selectedActionIdx = state.phase.kind === 'explore' ? state.phase.menuIdx : 0;

  if (state.phase.kind === 'combat') {
    const combatEnemyId = state.phase.entityId;
    const enemy = f.entities.find((e) => e.id === combatEnemyId);
    if (enemy) {
      combat = {
        enemyName: enemy.name,
        enemyHp: Math.max(0, enemy.hp),
        enemyMaxHp: enemy.maxHp,
        enemyAc: enemy.ac,
        round: state.phase.round,
        turnOwner: state.phase.turnOwner,
      };
    }
    actions = buildCombatMenu(state);
    selectedActionIdx = state.phase.selectedIdx;
  } else if (state.phase.kind === 'dialog') {
    const dlg = state.moduleDef.dialogs[state.phase.dialogId];
    if (dlg) {
      dialog = {
        speaker: dlg.speaker,
        text: dlg.text,
        choices: dlg.choices.map((c, i) => ({
          id: `dialog_${i}`,
          label: c.costGold
            ? `${c.label} (${c.costGold}🪙)`
            : c.checkStat && c.checkDc
              ? `${c.label} [${c.checkStat.toUpperCase()} DC${c.checkDc}]`
              : c.label,
          enabled: !c.costGold || state.hero.gold >= c.costGold,
        })),
        selectedIdx: state.phase.selectedIdx,
      };
    }
    actions = [];
  }

  const statusTags: string[] = [];
  if (state.hero.statuses.shield) statusTags.push(`盾${state.hero.statuses.shield}`);
  if (state.hero.statuses.poison) statusTags.push(`毒${state.hero.statuses.poison}`);
  if (state.hero.statuses.burn) statusTags.push(`灼${state.hero.statuses.burn}`);
  if (state.hero.statuses.stun) statusTags.push(`暈${state.hero.statuses.stun}`);

  return {
    mode,
    floorName: f.def.name,
    turnCount: state.turnCount,
    heroName: state.hero.name,
    level: state.hero.level,
    xp: state.hero.xp,
    nextXp: state.hero.nextXp,
    hp: Math.max(0, state.hero.hp),
    maxHp: state.hero.maxHp,
    mp: state.hero.mp,
    maxMp: state.hero.maxMp,
    ac: state.hero.ac,
    potions: state.hero.potions,
    keys: state.hero.keys,
    gold: state.hero.gold,
    weaponName: state.hero.weapon?.name,
    armorName: state.hero.armor?.name,
    relicName: state.hero.relic?.name,
    statuses: statusTags,
    agentAuto: state.agentAuto,
    combat,
    dialog,
    actions,
    selectedActionIdx,
    combatLog: [...state.combatLog],
  };
}

export function getObservation(state: DndWorldState): AgentObservation {
  const f = getActiveFloor(state);
  const visibleEntities: AgentObservation['visibleEntities'] = [];
  for (const e of f.entities) {
    if (!e.alive) continue;
    if (f.visible.has(e.y * f.width + e.x)) {
      visibleEntities.push({
        id: e.id,
        kind: e.kind,
        name: e.name,
        x: e.x,
        y: e.y,
        hp: e.kind === 'monster' ? e.hp : undefined,
      });
    }
  }
  const hud = buildHudSnapshot(state);
  return {
    moduleTitle: state.moduleDef.title,
    phase: state.phase.kind,
    floorId: f.def.id,
    floorName: f.def.name,
    turnCount: state.turnCount,
    hero: { ...state.hero },
    blackboard: { ...state.blackboard },
    visibleEntities,
    combat: hud.combat,
    dialog: hud.dialog,
    combatLog: [...state.combatLog],
  };
}

interface DndSnapshotBank {
  tiles: TileDesc[];
  tilePool: TileDesc[];
  entities: EntityDesc[];
  entityPool: EntityDesc[];
  lights: LightDesc[];
  lightPool: LightDesc[];
  debugRects: DebugRectDesc[];
  debugPool: DebugRectDesc[];
  bgStars: RenderSceneSnapshot['bgStars'];
  bgClouds: RenderSceneSnapshot['bgClouds'];
  hd2dDepth: NonNullable<RenderSceneSnapshot['hd2dDepth']>;
  stage: NonNullable<RenderSceneSnapshot['stage']>;
  snapshot: RenderSceneSnapshot;
}

const DND_BANKS = new WeakMap<DndWorldState, DndSnapshotBank>();

function getDndBank(state: DndWorldState): DndSnapshotBank {
  let bank = DND_BANKS.get(state);
  if (bank) return bank;
  const tiles: TileDesc[] = [];
  const entities: EntityDesc[] = [];
  const lights: LightDesc[] = [];
  const debugRects: DebugRectDesc[] = [];
  const bgStars: RenderSceneSnapshot['bgStars'] = [];
  const bgClouds: RenderSceneSnapshot['bgClouds'] = [];
  const hd2dDepth: NonNullable<RenderSceneSnapshot['hd2dDepth']> = {
    enabled: true,
    sortByDepthY: true,
    perspectiveSkew: 0.045,
    horizonHazeColor: '#0d0918',
    horizonHazeAlpha: 0.1,
    tiltShiftAlpha: 0.14,
  };
  const stage: NonNullable<RenderSceneSnapshot['stage']> = { index: 1, total: 1, name: '' };
  bank = {
    tiles,
    tilePool: [],
    entities,
    entityPool: [],
    lights,
    lightPool: [],
    debugRects,
    debugPool: [],
    bgStars,
    bgClouds,
    hd2dDepth,
    stage,
    snapshot: {
      cartridgeId: 'emberkeep-dnd',
      skyTop: '#161129',
      skyBottom: '#261d42',
      cozyFilter: true,
      glowIntensity: 1,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 0,
      starsCollected: 0,
      starsTotal: 1,
      hasKey: false,
      hearts: 3,
      maxHearts: 3,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      cameraZoom: 1.15,
      ambientDarkness: 0.45,
      ambientColor: '#0e0a1c',
      screenFlashAlpha: 0,
      screenFlashColor: '#fffaf0',
      hd2dDepth,
      bgStars,
      bgClouds,
      tiles,
      entities,
      particles: state.juice.particles,
      lights,
      debugRects: undefined,
      statusBanner: '',
      stage,
      bgmTheme: 'dungeon',
      rpgHud: undefined,
    },
  };
  DND_BANKS.set(state, bank);
  return bank;
}

function acquireDndTile(pool: TileDesc[], idx: number): TileDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { sprite: 'dungeon_floor', x: 0, y: 0, w: TILE_PX, h: TILE_PX };
    pool[idx] = slot;
  }
  return slot;
}

function acquireDndEntity(pool: EntityDesc[], idx: number): EntityDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { id: '', sprite: 'hero_a', x: 0, y: 0, w: 16, h: 16 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireDndLight(pool: LightDesc[], idx: number): LightDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, radius: 32, color: '#ffd447', intensity: 0.35 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireDndDebug(pool: DebugRectDesc[], idx: number): DebugRectDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, w: TILE_PX, h: TILE_PX, color: '#56d39c' };
    pool[idx] = slot;
  }
  return slot;
}

export function buildSceneSnapshot(
  state: DndWorldState,
  cameraX: number,
  cameraY: number,
  params: RuntimeParams,
): RenderSceneSnapshot {
  const bank = getDndBank(state);
  const f = getActiveFloor(state);
  const t = state.juice.visualTime;
  const glow = params.glowIntensity;
  const tiles = bank.tiles;
  const entities = bank.entities;
  const lights = bank.lights;
  let tileCount = 0;
  let entityCount = 0;
  let lightCount = 0;

  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const key = y * f.width + x;
      if (!f.explored.has(key)) continue;
      const isVis = f.visible.has(key);
      const floorTint = isVis ? '#d6cce8' : '#585e7a';
      const dimTint = isVis ? undefined : '#646e88';
      const kind = f.grid[y][x];
      const px = x * TILE_PX;
      const py = y * TILE_PX;

      let sprite: SpriteId = 'dungeon_floor';
      if (kind === 'wall') sprite = 'stone';
      else if (kind === 'door' || kind === 'locked_door') sprite = 'door_closed';
      else if (kind === 'stairs_down') sprite = 'stairs_down';
      else if (kind === 'trap') sprite = 'trap';
      else if (kind === 'torch' || kind === 'campfire') {
        const td = acquireDndTile(bank.tilePool, tileCount);
        td.sprite = 'dungeon_floor';
        td.x = px;
        td.y = py;
        td.w = TILE_PX;
        td.h = TILE_PX;
        td.tint = floorTint;
        td.elevationZ = 0;
        td.extrudeH = 0;
        td.wallColor = undefined;
        td.wallMaterial = undefined;
        td.castShadow = false;
        td.sortY = undefined;
        tiles[tileCount++] = td;

        const ed = acquireDndEntity(bank.entityPool, entityCount);
        ed.id = kind;
        ed.sprite = kind === 'campfire' ? 'campfire' : 'torch';
        ed.x = px;
        ed.y = py;
        ed.w = 16;
        ed.h = 16;
        ed.tint = dimTint;
        ed.scaleX = 1;
        ed.scaleY = 1;
        ed.flash = 0;
        ed.flipX = false;
        ed.elevationZ = 0;
        ed.castShadow = false;
        ed.shadowRadius = undefined;
        ed.sortY = py + 16;
        entities[entityCount++] = ed;

        if (isVis && glow > 0.05) {
          const ld = acquireDndLight(bank.lightPool, lightCount);
          ld.x = px + 8;
          ld.y = py + 8;
          ld.radius = (kind === 'campfire' ? 58 : 44) * (1 + Math.sin(t * 10 + x) * 0.08);
          ld.color = kind === 'campfire' ? '#ff9642' : '#ffb85c';
          ld.intensity = (kind === 'campfire' ? 0.48 : 0.36) * glow;
          ld.falloffPower = 1.85;
          lights[lightCount++] = ld;
        }
        continue;
      }

      const isWallBlock = kind === 'wall' || kind === 'door' || kind === 'locked_door';
      const southIsWall =
        y + 1 < f.height &&
        f.grid[y + 1][x] === 'wall' &&
        f.explored.has((y + 1) * f.width + x);

      const tileTint =
        kind === 'locked_door'
          ? '#ffd447'
          : kind === 'wall'
            ? isVis
              ? '#6478ad'
              : '#3b4363'
            : kind === 'floor'
              ? floorTint
              : dimTint;

      const td = acquireDndTile(bank.tilePool, tileCount);
      td.sprite = sprite;
      td.x = px;
      td.y = py;
      td.w = TILE_PX;
      td.h = TILE_PX;
      td.tint = tileTint;
      td.elevationZ = isWallBlock ? 6 : 0;
      td.extrudeH = isWallBlock && !southIsWall ? 6 : 0;
      td.wallColor = kind === 'locked_door' ? '#705824' : isVis ? '#2d3759' : '#1e243b';
      td.wallMaterial = kind === 'locked_door' ? 'astral' : 'stone';
      td.castShadow = isWallBlock && !southIsWall;
      td.sortY = py + TILE_PX;
      tiles[tileCount++] = td;
    }
  }

  for (let i = 0; i < f.entities.length; i++) {
    const e = f.entities[i];
    if (!e.alive) continue;
    if (!f.visible.has(e.y * f.width + e.x)) continue;
    const ed = acquireDndEntity(bank.entityPool, entityCount);
    ed.id = e.id;
    ed.sprite = e.sprite;
    ed.x = e.x * TILE_PX;
    ed.y = e.y * TILE_PX;
    ed.w = 16;
    ed.h = 16;
    ed.tint = e.tint;
    ed.scaleX = e.squash.scaleX;
    ed.scaleY = e.squash.scaleY;
    ed.flash = Math.min(1, e.flash * 2.5);
    ed.flipX = false;
    ed.elevationZ = e.isBoss ? 2.5 + Math.sin(t * 2.8) * 1.2 : 0.5;
    ed.castShadow = true;
    ed.shadowRadius = e.isBoss ? 7.4 : 6.2;
    ed.sortY = e.y * TILE_PX + 16;
    entities[entityCount++] = ed;

    if ((e.isBoss || e.isMiniBoss) && glow > 0.05) {
      const ld = acquireDndLight(bank.lightPool, lightCount);
      ld.x = e.x * TILE_PX + 8;
      ld.y = e.y * TILE_PX + 8;
      ld.radius = 48;
      ld.color = '#ff708d';
      ld.intensity = 0.65 * glow;
      ld.falloffPower = 2.0;
      lights[lightCount++] = ld;
    }
  }

  const heroEd = acquireDndEntity(bank.entityPool, entityCount);
  heroEd.id = 'hero';
  heroEd.sprite = Math.floor(state.turnCount) % 2 === 1 ? 'hero_b' : 'hero_a';
  heroEd.x = state.hero.visualX;
  heroEd.y = state.hero.visualY;
  heroEd.w = 16;
  heroEd.h = 16;
  heroEd.tint = undefined;
  heroEd.scaleX = state.hero.squash.scaleX;
  heroEd.scaleY = state.hero.squash.scaleY;
  heroEd.flash = Math.min(1, state.hero.flash * 2.5);
  heroEd.flipX = state.hero.facingLeft;
  heroEd.elevationZ = 0.6;
  heroEd.castShadow = true;
  heroEd.shadowRadius = 6.4;
  heroEd.sortY = state.hero.visualY + 16;
  entities[entityCount++] = heroEd;

  if (glow > 0.05) {
    const ld = acquireDndLight(bank.lightPool, lightCount);
    ld.x = state.hero.visualX + 8;
    ld.y = state.hero.visualY + 8;
    ld.radius = 48 + (state.blackboard.sage_blessing ? 16 : 0) + (state.hero.relic?.visionBonus ?? 0) * 10;
    ld.color = '#ffe4a1';
    ld.intensity = 0.36 * glow;
    ld.falloffPower = 1.8;
    lights[lightCount++] = ld;
  }

  tiles.length = tileCount;
  entities.length = entityCount;
  lights.length = lightCount;

  let debugRects: DebugRectDesc[] | undefined;
  if (state.debugHitboxes) {
    let dbgCount = 0;
    for (const k of f.visible) {
      const vx = k % f.width;
      const vy = Math.floor(k / f.width);
      const dr = acquireDndDebug(bank.debugPool, dbgCount);
      dr.x = vx * TILE_PX;
      dr.y = vy * TILE_PX;
      dr.w = TILE_PX;
      dr.h = TILE_PX;
      dr.color = '#56d39c';
      bank.debugRects[dbgCount++] = dr;
    }
    bank.debugRects.length = dbgCount;
    debugRects = bank.debugRects;
  }

  const hud = buildHudSnapshot(state);
  let inBossFight = false;
  if (state.phase.kind === 'combat') {
    const combatId = state.phase.entityId;
    for (let i = 0; i < f.entities.length; i++) {
      const e = f.entities[i];
      if (e.id === combatId && (e.isBoss || e.isMiniBoss)) {
        inBossFight = true;
        break;
      }
    }
  }

  const status: 'playing' | 'won' | 'lost' =
    state.phase.kind === 'won' ? 'won' : state.phase.kind === 'lost' ? 'lost' : 'playing';

  const snap = bank.snapshot;
  snap.cozyFilter = params.cozyFilter > 0.5;
  snap.glowIntensity = params.glowIntensity;
  snap.timeSec = t;
  snap.elapsedSec = t;
  snap.status = status;
  snap.score = state.score;
  snap.starsCollected = state.chestsCollected;
  snap.starsTotal = Math.max(1, state.totalChests);
  snap.hasKey = state.hero.keys > 0;
  snap.hearts = Math.max(0, Math.ceil((state.hero.hp / state.hero.maxHp) * 3));
  snap.bossHp = hud.combat?.enemyHp ?? 0;
  snap.bossMaxHp = hud.combat?.enemyMaxHp ?? 0;
  snap.cameraX = cameraX + state.juice.shakeX;
  snap.cameraY = cameraY + state.juice.shakeY;
  snap.ambientDarkness = Math.min(0.48, state.moduleDef.ambientDarkness ?? 0.45);
  snap.screenFlashAlpha = state.juice.flashAlpha;
  snap.screenFlashColor = state.juice.flashColor;
  snap.particles = state.juice.particles;
  snap.debugRects = debugRects;
  snap.statusBanner = state.combatLog[0] ?? '方向鍵探索迷宮・A 執行選單・可開啟 AI 代理自動探索';
  bank.stage.index = state.floorIdx + 1;
  bank.stage.total = state.floors.length;
  bank.stage.name = f.def.name;
  snap.bgmTheme = inBossFight || state.floorIdx === state.floors.length - 1 ? 'boss' : 'dungeon';
  snap.rpgHud = hud;
  return snap;
}
