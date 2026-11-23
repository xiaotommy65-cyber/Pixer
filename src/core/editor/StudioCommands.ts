import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type {
  CartridgeArchetypeDef,
  CartridgeArtMoodDef,
  CartridgeJsonV1,
  CartridgeStageDef,
  CartridgeStageSpawn,
} from '../sim/CartridgeSchema.ts';
import type { CartridgeDualPerspectiveConfig } from '../sim/DualPerspectiveRuntime.ts';
import type { VmRule } from '../sim/EventActionVm.ts';
import type { OrthogonalArtBlueprint } from '../sim/OrthogonalArt.ts';
import type { CartridgeAtmosphereDef, CartridgeVisualRigDef } from '../sim/ProceduralVisualRig.ts';
import {
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_SLOPE_DOWN,
  COLLISION_SLOPE_UP,
  COLLISION_SOLID,
  TILE_SIZE,
} from '../sim/TilemapGrid.ts';

export type StudioTemplateId =
  | 'parkour_flagship'
  | 'dual_perspective'
  | 'platformer';

export type TileCollisionBrush = 'empty' | 'solid' | 'cloud' | 'slope_l' | 'slope_r';

export type StudioCommand =
  | { type: 'new_project'; template: StudioTemplateId; title?: string; id?: string; code?: string }
  | { type: 'set_meta'; patch: Partial<CartridgeJsonV1['meta']> }
  | { type: 'set_player'; patch: Partial<CartridgeJsonV1['player']> }
  | { type: 'set_visual_rig'; visualRig: CartridgeVisualRigDef }
  | { type: 'upsert_stage'; stageIndex?: number; stage: CartridgeStageDef }
  | { type: 'delete_stage'; stageIndex: number }
  | {
      type: 'set_stage_atmosphere';
      stageIndex?: number;
      atmosphere?: CartridgeAtmosphereDef;
      artMood?: CartridgeArtMoodDef;
      skyTop?: string;
      skyBottom?: string;
      ambientDarkness?: number;
      ambientColor?: string;
    }
  | {
      type: 'paint_tiles_rect';
      stageIndex?: number;
      col: number;
      row: number;
      width: number;
      height: number;
      tileId: number;
      collision?: TileCollisionBrush;
      spriteMap?: Record<string, SpriteId>;
      layer?: 'mid' | 'fg';
    }
  | { type: 'upsert_archetype'; id: string; def: CartridgeArchetypeDef }
  | { type: 'add_spawn'; stageIndex?: number; spawn: CartridgeStageSpawn }
  | { type: 'clear_spawns'; stageIndex?: number; archetype?: string }
  | { type: 'upsert_art_blueprint'; id: string; blueprint: OrthogonalArtBlueprint }
  | { type: 'set_dual_perspective'; perspective: CartridgeDualPerspectiveConfig | undefined }
  | { type: 'upsert_rule'; stageIndex?: number; ruleIndex?: number; rule: VmRule }
  | { type: 'remove_rule'; stageIndex?: number; ruleIndex: number }
  | { type: 'upsert_sprite'; spriteId: string; grid: readonly string[] }
  | { type: 'batch'; label?: string; commands: readonly StudioCommand[] };

export interface StudioHistoryEntry {
  revision: number;
  commandType: StudioCommand['type'];
  summary: string;
  timestamp: number;
}

export interface StudioCommandResult {
  ok: boolean;
  revision: number;
  summary: string;
  errors: string[];
}

function collisionBrushToCode(brush: TileCollisionBrush | undefined, tileId: number): number {
  if (brush === 'empty') return COLLISION_EMPTY;
  if (brush === 'solid') return COLLISION_SOLID;
  if (brush === 'cloud') return COLLISION_CLOUD;
  if (brush === 'slope_l') return COLLISION_SLOPE_DOWN;
  if (brush === 'slope_r') return COLLISION_SLOPE_UP;
  return tileId > 0 ? COLLISION_SOLID : COLLISION_EMPTY;
}

function ensureTileGrid(stage: CartridgeStageDef): NonNullable<CartridgeStageDef['tileGrid']> {
  if (stage.tileGrid) return stage.tileGrid;
  const cols = Math.max(10, Math.ceil(stage.worldWidth / TILE_SIZE));
  const rows = Math.max(8, Math.ceil((stage.worldHeight ?? 270) / TILE_SIZE));
  const area = cols * rows;
  const tiles = new Array<number>(area).fill(0);
  const collision = new Array<number>(area).fill(0);
  const spriteMap: Record<string, SpriteId> = {
    '1': stage.groundTop ?? 'grass',
    '2': stage.groundFill ?? 'dirt',
    '3': 'cloud_l',
    '4': 'cloud_m',
    '5': 'cloud_r',
    '6': 'stone',
    '7': 'tree_canopy',
  };
  stage.tileGrid = { cols, rows, tiles, collision, spriteMap };
  return stage.tileGrid;
}

export function createStudioTemplate(
  template: StudioTemplateId,
  overrides?: { title?: string; id?: string; code?: string },
): CartridgeJsonV1 {
  if (template === 'dual_perspective') {
    const cols = 16;
    const rows = 12;
    const tiles = new Array<number>(cols * rows).fill(0);
    const collision = new Array<number>(cols * rows).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const border = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
        const pillar = (c === 5 && r >= 2 && r <= 6) || (c === 10 && r >= 5 && r <= 9);
        if (border || pillar) {
          tiles[r * cols + c] = pillar ? 2 : 1;
          collision[r * cols + c] = COLLISION_SOLID;
        }
      }
    }
    return {
      version: 1,
      meta: {
        id: overrides?.id ?? 'studio-dualview',
        code: overrides?.code ?? 'ST-2P',
        title: overrides?.title ?? '正交雙視角迷宮',
        subtitle: '純 JSON 驅動 1P DDA 透視 ↔ 3P 俯視即時切換',
        genre: 'platformer',
        viewport: 'classic',
        glowIntensity: 1.15,
      },
      perspective: {
        enabled: true,
        defaultMode: 'first_person',
        fovDeg: 66,
        maxDist: 176,
        wallSpriteIds: ['stone', 'cliff_m5', 'dungeon_floor', 'crate'],
        ceilTopColor: '#110d24',
        ceilHorizonColor: '#251c45',
        floorHorizonColor: '#2b2438',
        floorBottomColor: '#161221',
        fogColor: '#19142b',
        viewmodelBlueprintId: 'fp_lantern_blade',
        showMinimap: true,
        moveSpeed: 82,
        turnSpeed: 2.6,
        slashRange: 44,
      },
      player: {
        controller: 'topdown',
        sprite: 'hero_a',
        spriteB: 'hero_b',
        artBlueprintId: 'atelier_striker',
        w: 14,
        h: 14,
        maxHearts: 4,
      },
      archetypes: {
        star: {
          sprite: 'star_a',
          spriteB: 'star_b',
          w: 12,
          h: 12,
          tags: ['collectible', 'star'],
          emissive: 0.9,
          light: { radius: 34, color: '#ffd447', intensity: 0.42 },
        },
        key: {
          sprite: 'key',
          w: 12,
          h: 12,
          tags: ['collectible', 'key'],
          emissive: 0.95,
          light: { radius: 38, color: '#5ec2f7', intensity: 0.45 },
        },
        sentry: {
          sprite: 'slime_a',
          spriteB: 'slime_b',
          artBlueprintId: 'sentinel_golem',
          w: 16,
          h: 16,
          tags: ['enemy', 'stompable'],
          hp: 2,
          behavior: { kind: 'patrol', speedX: 28 },
          light: { radius: 30, color: '#ff5d8f', intensity: 0.36 },
        },
        gate: {
          sprite: 'gate_closed',
          w: 16,
          h: 16,
          tags: ['gate'],
          light: { radius: 42, color: '#56d39c', intensity: 0.48 },
        },
      },
      stages: [
        {
          id: 'vault-1',
          name: '星耀石室',
          worldWidth: cols * TILE_SIZE,
          worldHeight: rows * TILE_SIZE,
          skyTop: '#141028',
          skyBottom: '#2d244c',
          ambientDarkness: 0.24,
          ambientColor: '#120d26',
          bgmTheme: 'dungeon',
          hint: '方向鍵移動 · A 揮斬 · X 即時切換 1P/3P 視角！',
          spawn: { x: 2 * TILE_SIZE, y: 2 * TILE_SIZE },
          tileGrid: {
            cols,
            rows,
            tiles,
            collision,
            spriteMap: { '1': 'stone', '2': 'cliff_m5' },
          },
          spawns: [
            { archetype: 'star', x: 7 * TILE_SIZE, y: 3 * TILE_SIZE },
            { archetype: 'sentry', x: 8 * TILE_SIZE, y: 7 * TILE_SIZE, minX: 6 * TILE_SIZE, maxX: 9 * TILE_SIZE },
            { archetype: 'key', x: 12 * TILE_SIZE, y: 3 * TILE_SIZE },
            { archetype: 'gate', x: 13 * TILE_SIZE, y: 9 * TILE_SIZE },
          ],
        },
      ],
    };
  }

  if (template === 'platformer') {
    return {
      version: 1,
      meta: {
        id: overrides?.id ?? 'studio-platformer',
        code: overrides?.code ?? 'ST-01',
        title: overrides?.title ?? '晨光跳躍工坊',
        subtitle: '經典平台跳躍 + 收集星星與通關傳送門',
        genre: 'platformer',
        genreHud: 'platformer',
        viewport: 'classic',
        glowIntensity: 1.0,
      },
      player: {
        controller: 'platformer',
        sprite: 'hero_a',
        spriteB: 'hero_b',
        w: 16,
        h: 16,
        maxHearts: 3,
      },
      archetypes: {
        star: { sprite: 'star_a', spriteB: 'star_b', w: 12, h: 12, tags: ['collectible', 'star'], emissive: 0.8 },
        slime: {
          sprite: 'slime_a',
          spriteB: 'slime_b',
          w: 16,
          h: 14,
          tags: ['enemy', 'stompable'],
          hp: 1,
          behavior: { kind: 'patrol', speedX: 34 },
        },
        gate: { sprite: 'gate_open', w: 16, h: 16, tags: ['gate'] },
      },
      stages: [
        {
          id: 'meadow-1',
          name: '晨露草坡',
          worldWidth: 640,
          worldHeight: 180,
          skyTop: '#6ec4ff',
          skyBottom: '#fff3df',
          bgmTheme: 'meadow',
          hint: '方向鍵移動 · B 跳躍 · 收集星星並抵達傳送門！',
          spawn: { x: 32, y: 120 },
          islands: [
            { startTile: 0, countTiles: 16, topY: 144 },
            { startTile: 19, countTiles: 21, topY: 144 },
          ],
          clouds: [{ x: 240, y: 108, tilesWide: 4 }],
          spawns: [
            { archetype: 'star', x: 140, y: 112 },
            { archetype: 'star', x: 266, y: 84 },
            { archetype: 'slime', x: 380, y: 130, minX: 330, maxX: 460 },
            { archetype: 'gate', x: 580, y: 128 },
          ],
        },
      ],
    };
  }

  // Default: 'parkour_flagship' (Verlet scarf + 2-Bone IK + grapple + wave-dash + Curl embers + planar water)
  return {
    version: 1,
    meta: {
      id: overrides?.id ?? 'studio-parkour-flagship',
      code: overrides?.code ?? 'ST-06',
      title: overrides?.title ?? '緋空工坊：正交飛鉤試煉',
      subtitle: '旗艦級 Verlet 圍巾 + 2-Bone IK + 360° 飛鉤 + Curl 流場餘燼',
      genre: 'platformer',
      genreHud: 'parkour',
      viewport: 'wide',
      glowIntensity: 1.25,
    },
    player: {
      controller: 'platformer',
      sprite: 'parkour_hero_idle',
      spriteB: 'parkour_hero_run_b',
      w: 16,
      h: 16,
      maxHearts: 4,
      scoutZoom: 0.78,
      grappleConfig: {
        enabled: true,
        maxRange: 175,
        attachWalls: true,
        pullSpeed: 375,
      },
      parkourMechanics: {
        waveDash: true,
        wallSlide: true,
        crumbleRespawnSec: 2.2,
        crystalRespawnSec: 2.0,
      },
      visualRig: {
        verletChain: {
          enabled: true,
          nodes: 7,
          segmentLength: 3.4,
          colorReady: '#ff5d8f',
          colorSpent: '#5ec2f7',
          nodeSize: 4.8,
        },
        twoBoneIk: {
          enabled: true,
          len1: 6.5,
          len2: 6.5,
          targetMode: 'grapple_or_aim',
          jointSprite: 'grapple_link',
          tipSprite: 'grapple_claw',
          tint: '#ffd447',
        },
        afterimage: {
          enabled: true,
          intervalSec: 0.04,
          maxLifeSec: 0.24,
          tint: '#5ec2f7',
          minSpeed: 160,
          additive: true,
        },
        stateSprites: {
          idle: 'parkour_hero_idle',
          runA: 'parkour_hero_run_a',
          runB: 'parkour_hero_run_b',
          jump: 'parkour_hero_jump',
          fall: 'parkour_hero_jump',
          dash: 'parkour_hero_dash',
          wallSlide: 'parkour_hero_wall',
          swing: 'parkour_hero_dash',
        },
      },
    },
    archetypes: {
      grapple_ring: {
        sprite: 'grapple_ring',
        w: 16,
        h: 16,
        tags: ['grapple_ring'],
        emissive: 1.0,
        light: { radius: 42, color: '#ffd447', intensity: 0.45 },
      },
      crystal_reset: {
        sprite: 'crystal_reset',
        w: 14,
        h: 14,
        tags: ['crystal_reset'],
        emissive: 0.95,
        light: { radius: 34, color: '#5ec2f7', intensity: 0.42 },
      },
      crumble_tile: {
        sprite: 'crumble_tile',
        w: 16,
        h: 16,
        tags: ['crumble_tile'],
      },
      zip_block: {
        sprite: 'zip_block',
        w: 24,
        h: 16,
        tags: ['zip_block'],
        emissive: 0.65,
        light: { radius: 36, color: '#ff9f43', intensity: 0.36 },
      },
      star: {
        sprite: 'star_a',
        spriteB: 'star_b',
        w: 12,
        h: 12,
        tags: ['collectible', 'star'],
        emissive: 0.9,
        light: { radius: 34, color: '#ffd447', intensity: 0.42 },
      },
      torch: {
        sprite: 'torch',
        w: 14,
        h: 16,
        tags: ['torch'],
        emissive: 0.9,
        light: { radius: 56, color: '#ff9f43', intensity: 0.56, flicker: true },
      },
      gate: {
        sprite: 'gate_open',
        w: 16,
        h: 16,
        tags: ['gate'],
        emissive: 0.85,
        light: { radius: 48, color: '#56d39c', intensity: 0.52 },
      },
    },
    stages: [
      {
        id: 'forge-run-1',
        name: '暮光鍛爐棧道',
        worldWidth: 1024,
        worldHeight: 272,
        artMood: {
          baseHex: '#2c1e4a',
          accentHex: '#ff708d',
          warmth: 0.32,
          contrast: 0.85,
          autoSky: true,
          parallaxFog: 0.35,
        },
        atmosphere: {
          curlParticles: {
            enabled: true,
            count: 30,
            style: 'embers',
            curlStrength: 24,
            curlScale: 0.015,
            driftX: 10,
            driftY: -22,
            additive: true,
          },
          waterLevelY: 250,
          waterTint: '#2c4d7a',
          horizonHazeColor: '#ff9b71',
          horizonHazeAlpha: 0.22,
          tiltShiftAlpha: 0.14,
        },
        springCamera: { freqHz: 4.6, dampingRatio: 0.92 },
        ambientDarkness: 0.18,
        ambientColor: '#1b1232',
        bgmTheme: 'starlight',
        hint: 'Y 擺盪飛鉤 · R 拉扯突進 · A 衝刺/波浪跳 · 收集星輝抵達終點！',
        spawn: { x: 40, y: 176 },
        groundTop: 'stone',
        groundFill: 'stone',
        islands: [
          { startTile: 0, countTiles: 14, topY: 208 },
          { startTile: 20, countTiles: 10, topY: 192 },
          { startTile: 36, countTiles: 12, topY: 176 },
          { startTile: 52, countTiles: 12, topY: 192 },
        ],
        bgParallaxLayers: [
          { sprite: 'parallax_twilight_bg', x: 0, y: 82, w: 256, h: 128, scrollX: 0.14, scrollY: 0.06, repeatW: 1100, repeatStepX: 256, alpha: 0.82 },
          { sprite: 'cloud_m', x: 16, y: 132, w: 36, h: 22, scrollX: 0.28, scrollY: 0.12, repeatW: 1100, repeatStepX: 112, tint: '#ff9b71', alpha: 0.44 },
          { sprite: 'star_a', x: 32, y: 64, w: 10, h: 10, scrollX: 0.2, scrollY: 0.08, repeatW: 1100, repeatStepX: 128, tint: '#ffd447', alpha: 0.56, additive: true, emissive: 0.7 },
        ],
        spawns: [
          { archetype: 'torch', x: 88, y: 192 },
          { archetype: 'grapple_ring', x: 268, y: 124 },
          { archetype: 'star', x: 268, y: 150 },
          { archetype: 'crystal_reset', x: 512, y: 140 },
          { archetype: 'crumble_tile', x: 496, y: 192 },
          { archetype: 'zip_block', x: 640, y: 168, minX: 640, maxX: 740 },
          { archetype: 'grapple_ring', x: 780, y: 108 },
          { archetype: 'star', x: 780, y: 138 },
          { archetype: 'torch', x: 880, y: 176 },
          { archetype: 'gate', x: 960, y: 176 },
        ],
      },
    ],
  };
}

export function cloneCartridgeDoc(doc: CartridgeJsonV1): CartridgeJsonV1 {
  return JSON.parse(JSON.stringify(doc)) as CartridgeJsonV1;
}

/**
 * Pure transactional command executor that mutates a cloned CartridgeJsonV1 candidate.
 * Validation and commit/rollback are handled by StudioSession.
 */
export function applyStudioCommandToDoc(
  doc: CartridgeJsonV1,
  cmd: StudioCommand,
): { nextDoc: CartridgeJsonV1; summary: string } {
  if (cmd.type === 'new_project') {
    const fresh = createStudioTemplate(cmd.template, {
      title: cmd.title,
      id: cmd.id,
      code: cmd.code,
    });
    return { nextDoc: fresh, summary: `新建模板「${fresh.meta.title}」(${cmd.template})` };
  }

  const next = cloneCartridgeDoc(doc);

  if (cmd.type === 'batch') {
    let cur = next;
    for (let i = 0; i < cmd.commands.length; i++) {
      cur = applyStudioCommandToDoc(cur, cmd.commands[i]).nextDoc;
    }
    return {
      nextDoc: cur,
      summary: cmd.label ?? `批次套用 ${cmd.commands.length} 項編輯指令`,
    };
  }

  switch (cmd.type) {
    case 'set_meta': {
      next.meta = { ...next.meta, ...cmd.patch };
      return { nextDoc: next, summary: `更新卡匣中繼資料「${next.meta.title}」` };
    }
    case 'set_player': {
      next.player = { ...next.player, ...cmd.patch };
      return { nextDoc: next, summary: `調整主角控制器 (${next.player.controller})` };
    }
    case 'set_visual_rig': {
      next.player = {
        ...next.player,
        visualRig: {
          ...next.player.visualRig,
          ...cmd.visualRig,
        },
      };
      return { nextDoc: next, summary: '更新主角程式化視覺骨架 (Verlet / IK / 殘影)' };
    }
    case 'upsert_stage': {
      const stages = [...next.stages];
      if (cmd.stageIndex !== undefined && cmd.stageIndex >= 0 && cmd.stageIndex < stages.length) {
        stages[cmd.stageIndex] = cmd.stage;
      } else {
        stages.push(cmd.stage);
      }
      next.stages = stages;
      return { nextDoc: next, summary: `更新關卡「${cmd.stage.name}」` };
    }
    case 'delete_stage': {
      const stages = [...next.stages];
      if (stages.length > 1 && cmd.stageIndex >= 0 && cmd.stageIndex < stages.length) {
        stages.splice(cmd.stageIndex, 1);
      }
      next.stages = stages;
      return { nextDoc: next, summary: `移除關卡 #${cmd.stageIndex + 1}` };
    }
    case 'set_stage_atmosphere': {
      const idx = cmd.stageIndex ?? 0;
      const stages = [...next.stages];
      const st = stages[idx];
      if (st) {
        const updated: CartridgeStageDef = { ...st };
        if (cmd.atmosphere !== undefined) {
          updated.atmosphere = { ...st.atmosphere, ...cmd.atmosphere };
        }
        if (cmd.artMood !== undefined) updated.artMood = { ...cmd.artMood };
        if (cmd.skyTop !== undefined) updated.skyTop = cmd.skyTop;
        if (cmd.skyBottom !== undefined) updated.skyBottom = cmd.skyBottom;
        if (cmd.ambientDarkness !== undefined) updated.ambientDarkness = cmd.ambientDarkness;
        if (cmd.ambientColor !== undefined) updated.ambientColor = cmd.ambientColor;
        stages[idx] = updated;
        next.stages = stages;
      }
      return { nextDoc: next, summary: `調整關卡 #${idx + 1} 氛圍、流場與水面參數` };
    }
    case 'paint_tiles_rect': {
      const idx = cmd.stageIndex ?? 0;
      const stages = [...next.stages];
      const st = stages[idx];
      if (st) {
        const mutableSt: CartridgeStageDef = { ...st };
        const grid = ensureTileGrid(mutableSt);
        const tiles = [...grid.tiles];
        const collision = [...grid.collision];
        const fgTiles: number[] | undefined = cmd.layer === 'fg'
          ? [...(grid.fgTiles ?? new Array<number>(grid.cols * grid.rows).fill(0))]
          : grid.fgTiles
            ? [...grid.fgTiles]
            : undefined;
        const spriteMap = { ...grid.spriteMap, ...(cmd.spriteMap ?? {}) };
        const colCode = collisionBrushToCode(cmd.collision, cmd.tileId);
        const r0 = Math.max(0, Math.floor(cmd.row));
        const r1 = Math.min(grid.rows, Math.floor(cmd.row + cmd.height));
        const c0 = Math.max(0, Math.floor(cmd.col));
        const c1 = Math.min(grid.cols, Math.floor(cmd.col + cmd.width));
        for (let r = r0; r < r1; r++) {
          for (let c = c0; c < c1; c++) {
            const cell = r * grid.cols + c;
            if (cmd.layer === 'fg' && fgTiles) {
              fgTiles[cell] = cmd.tileId;
            } else {
              tiles[cell] = cmd.tileId;
              collision[cell] = colCode;
            }
          }
        }
        mutableSt.tileGrid = {
          cols: grid.cols,
          rows: grid.rows,
          tiles,
          collision,
          fgTiles,
          spriteMap,
        };
        stages[idx] = mutableSt;
        next.stages = stages;
      }
      return {
        nextDoc: next,
        summary: `繪製瓦片區域 (${cmd.col},${cmd.row}) ${cmd.width}×${cmd.height}`,
      };
    }
    case 'upsert_archetype': {
      next.archetypes = { ...next.archetypes, [cmd.id]: cmd.def };
      return { nextDoc: next, summary: `註冊/更新實體原型「${cmd.id}」` };
    }
    case 'add_spawn': {
      const idx = cmd.stageIndex ?? 0;
      const stages = [...next.stages];
      const st = stages[idx];
      if (st) {
        stages[idx] = { ...st, spawns: [...(st.spawns ?? []), cmd.spawn] };
        next.stages = stages;
      }
      return { nextDoc: next, summary: `放置實體「${cmd.spawn.archetype}」於 (${cmd.spawn.x},${cmd.spawn.y})` };
    }
    case 'clear_spawns': {
      const idx = cmd.stageIndex ?? 0;
      const stages = [...next.stages];
      const st = stages[idx];
      if (st) {
        const filtered = cmd.archetype
          ? (st.spawns ?? []).filter((s) => s.archetype !== cmd.archetype)
          : [];
        stages[idx] = { ...st, spawns: filtered };
        next.stages = stages;
      }
      return { nextDoc: next, summary: cmd.archetype ? `清除關卡中的「${cmd.archetype}」` : '清空關卡實體配置' };
    }
    case 'upsert_art_blueprint': {
      next.artBlueprints = { ...(next.artBlueprints ?? {}), [cmd.id]: cmd.blueprint };
      return { nextDoc: next, summary: `更新正交美術藍圖「${cmd.id}」` };
    }
    case 'set_dual_perspective': {
      next.perspective = cmd.perspective;
      if (cmd.perspective && cmd.perspective.enabled !== false && next.player.controller === 'platformer') {
        next.player = { ...next.player, controller: 'topdown' };
      }
      return {
        nextDoc: next,
        summary: cmd.perspective?.enabled !== false && cmd.perspective ? '啟用 1P ↔ 3P 雙視角透視引擎' : '停用雙視角透視模式',
      };
    }
    case 'upsert_rule': {
      if (cmd.stageIndex !== undefined && next.stages[cmd.stageIndex]) {
        const stages = [...next.stages];
        const st = stages[cmd.stageIndex];
        const rules = [...(st.rules ?? [])];
        if (cmd.ruleIndex !== undefined && cmd.ruleIndex >= 0 && cmd.ruleIndex < rules.length) {
          rules[cmd.ruleIndex] = cmd.rule;
        } else {
          rules.push(cmd.rule);
        }
        stages[cmd.stageIndex] = { ...st, rules };
        next.stages = stages;
      } else {
        const rules = [...(next.rules ?? [])];
        if (cmd.ruleIndex !== undefined && cmd.ruleIndex >= 0 && cmd.ruleIndex < rules.length) {
          rules[cmd.ruleIndex] = cmd.rule;
        } else {
          rules.push(cmd.rule);
        }
        next.rules = rules;
      }
      return { nextDoc: next, summary: `寫入事件規則 (${cmd.rule.when.type})` };
    }
    case 'remove_rule': {
      if (cmd.stageIndex !== undefined && next.stages[cmd.stageIndex]) {
        const stages = [...next.stages];
        const st = stages[cmd.stageIndex];
        const rules = [...(st.rules ?? [])];
        if (cmd.ruleIndex >= 0 && cmd.ruleIndex < rules.length) rules.splice(cmd.ruleIndex, 1);
        stages[cmd.stageIndex] = { ...st, rules };
        next.stages = stages;
      } else {
        const rules = [...(next.rules ?? [])];
        if (cmd.ruleIndex >= 0 && cmd.ruleIndex < rules.length) rules.splice(cmd.ruleIndex, 1);
        next.rules = rules;
      }
      return { nextDoc: next, summary: `移除事件規則 #${cmd.ruleIndex + 1}` };
    }
    case 'upsert_sprite': {
      next.sprites = { ...(next.sprites ?? {}), [cmd.spriteId]: [...cmd.grid] };
      return { nextDoc: next, summary: `寫入像素精靈「${cmd.spriteId}」` };
    }
  }
}
