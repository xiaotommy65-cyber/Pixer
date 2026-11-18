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

export function buildSceneSnapshot(
  state: DndWorldState,
  cameraX: number,
  cameraY: number,
  params: RuntimeParams,
): RenderSceneSnapshot {
  const f = getActiveFloor(state);
  const t = state.juice.visualTime;
  const glow = params.glowIntensity;
  const tiles: TileDesc[] = [];
  const entities: EntityDesc[] = [];
  const lights: LightDesc[] = [];

  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const key = y * f.width + x;
      if (!f.explored.has(key)) continue;
      const isVis = f.visible.has(key);
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
        tiles.push({ sprite: 'dungeon_floor', x: px, y: py, w: TILE_PX, h: TILE_PX, tint: dimTint });
        entities.push({
          id: `${kind}-${x}-${y}`,
          sprite: kind === 'campfire' ? 'campfire' : 'torch',
          x: px,
          y: py,
          w: 16,
          h: 16,
          tint: dimTint,
        });
        if (isVis && glow > 0.05) {
          lights.push({
            x: px + 8,
            y: py + 8,
            radius: (kind === 'campfire' ? 68 : 54) * (1 + Math.sin(t * 10 + x) * 0.08),
            color: kind === 'campfire' ? '#ff9642' : '#ffae42',
            intensity: (kind === 'campfire' ? 0.85 : 0.72) * glow,
            falloffPower: 1.7,
          });
        }
        continue;
      }

      const isWallBlock = kind === 'wall' || kind === 'door' || kind === 'locked_door';
      const southIsWall =
        y + 1 < f.height &&
        f.grid[y + 1][x] === 'wall' &&
        f.explored.has((y + 1) * f.width + x);

      tiles.push({
        sprite,
        x: px,
        y: py,
        w: TILE_PX,
        h: TILE_PX,
        tint: kind === 'locked_door' ? '#ffd447' : dimTint,
        elevationZ: isWallBlock ? 6 : 0,
        extrudeH: isWallBlock && !southIsWall ? 6 : 0,
        wallColor: kind === 'locked_door' ? '#705824' : isVis ? '#363b57' : '#26293d',
        wallMaterial: kind === 'locked_door' ? 'astral' : 'stone',
        castShadow: isWallBlock && !southIsWall,
        sortY: py + TILE_PX,
      });
    }
  }

  for (const e of f.entities) {
    if (!e.alive) continue;
    if (!f.visible.has(e.y * f.width + e.x)) continue;
    entities.push({
      id: e.id,
      sprite: e.sprite,
      x: e.x * TILE_PX,
      y: e.y * TILE_PX,
      w: 16,
      h: 16,
      tint: e.tint,
      scaleX: e.squash.scaleX,
      scaleY: e.squash.scaleY,
      flash: Math.min(1, e.flash * 2.5),
      elevationZ: e.isBoss ? 2.5 + Math.sin(t * 2.8) * 1.2 : 0.5,
      castShadow: true,
      shadowRadius: e.isBoss ? 7.4 : 6.2,
      sortY: e.y * TILE_PX + 16,
    });
    if ((e.isBoss || e.isMiniBoss) && glow > 0.05) {
      lights.push({ x: e.x * TILE_PX + 8, y: e.y * TILE_PX + 8, radius: 48, color: '#ff708d', intensity: 0.65 * glow });
    }
  }

  entities.push({
    id: 'hero',
    sprite: Math.floor(state.turnCount) % 2 === 1 ? 'hero_b' : 'hero_a',
    x: state.hero.visualX,
    y: state.hero.visualY,
    w: 16,
    h: 16,
    scaleX: state.hero.squash.scaleX,
    scaleY: state.hero.squash.scaleY,
    flash: Math.min(1, state.hero.flash * 2.5),
    flipX: state.hero.facingLeft,
    elevationZ: 0.6,
    castShadow: true,
    shadowRadius: 6.4,
    sortY: state.hero.visualY + 16,
  });
  if (glow > 0.05) {
    lights.push({
      x: state.hero.visualX + 8,
      y: state.hero.visualY + 8,
      radius: 52 + (state.blackboard.sage_blessing ? 18 : 0) + (state.hero.relic?.visionBonus ?? 0) * 10,
      color: '#ffe4a1',
      intensity: 0.66 * glow,
      falloffPower: 1.65,
    });
  }

  let debugRects: DebugRectDesc[] | undefined;
  if (state.debugHitboxes) {
    debugRects = [];
    for (const k of f.visible) {
      const vx = k % f.width;
      const vy = Math.floor(k / f.width);
      debugRects.push({ x: vx * TILE_PX, y: vy * TILE_PX, w: TILE_PX, h: TILE_PX, color: '#56d39c' });
    }
  }

  const hud = buildHudSnapshot(state);
  const inBossFight =
    state.phase.kind === 'combat' &&
    Boolean(
      f.entities.find((e) => state.phase.kind === 'combat' && e.id === state.phase.entityId && (e.isBoss || e.isMiniBoss)),
    );

  const status: 'playing' | 'won' | 'lost' =
    state.phase.kind === 'won' ? 'won' : state.phase.kind === 'lost' ? 'lost' : 'playing';

  return {
    cartridgeId: 'emberkeep-dnd',
    skyTop: '#0d0918',
    skyBottom: '#1a122e',
    cozyFilter: params.cozyFilter > 0.5,
    glowIntensity: params.glowIntensity,
    timeSec: t,
    elapsedSec: t,
    status,
    score: state.score,
    starsCollected: state.chestsCollected,
    starsTotal: Math.max(1, state.totalChests),
    hasKey: state.hero.keys > 0,
    hearts: Math.max(0, Math.ceil((state.hero.hp / state.hero.maxHp) * 3)),
    maxHearts: 3,
    bossHp: hud.combat?.enemyHp ?? 0,
    bossMaxHp: hud.combat?.enemyMaxHp ?? 0,
    cameraX: cameraX + state.juice.shakeX,
    cameraY: cameraY + state.juice.shakeY,
    ambientDarkness: state.moduleDef.ambientDarkness ?? 0.72,
    ambientColor: '#0c0818',
    screenFlashAlpha: state.juice.flashAlpha,
    screenFlashColor: state.juice.flashColor,
    hd2dDepth: {
      enabled: true,
      sortByDepthY: true,
      perspectiveSkew: 0.045,
      horizonHazeColor: '#0d0918',
      horizonHazeAlpha: 0.1,
      tiltShiftAlpha: 0.14,
    },
    bgStars: [],
    bgClouds: [],
    tiles,
    entities,
    particles: state.juice.particles,
    lights,
    debugRects,
    statusBanner: state.combatLog[0] ?? '方向鍵探索迷宮・A 執行選單・可開啟 AI 代理自動探索',
    stage: {
      index: state.floorIdx + 1,
      total: state.floors.length,
      name: f.def.name,
    },
    bgmTheme: inBossFight || state.floorIdx === state.floors.length - 1 ? 'boss' : 'dungeon',
    rpgHud: hud,
  };
}
