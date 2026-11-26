import type { EcsProjectV2 } from '../../core/ecs/EcsProjectSchema.ts';
import {
  CASTLE_TILE_IDS as T,
  createEmptyRoom,
  fillRoomRect,
  setRoomTile,
  type EcsMapRoomDef,
} from '../../core/ecs/EcsTilemapTypes.ts';

function buildCourtyardRoom(): EcsMapRoomDef {
  const room = createEmptyRoom('courtyard', '城門外庭 Outer Bailey', 28, 18, T.STONE_FLOOR);
  room.ambientDarkness = 0.44;
  room.skyTop = '#060914';
  room.skyBottom = '#12182b';
  room.wallExtrudeH = 28;

  // Weathered moss patches around courtyard corners
  fillRoomRect(room, 'ground', 1, 1, 5, 4, T.MOSS_FLOOR);
  fillRoomRect(room, 'ground', 22, 1, 26, 4, T.MOSS_FLOOR);
  fillRoomRect(room, 'ground', 1, 13, 6, 16, T.MOSS_FLOOR);
  fillRoomRect(room, 'ground', 21, 13, 26, 16, T.MOSS_FLOOR);

  // Dramatic molten moat cutting across southern half with central ceremonial bridge
  fillRoomRect(room, 'ground', 2, 10, 10, 11, T.LAVA_MOAT);
  fillRoomRect(room, 'ground', 17, 10, 25, 11, T.LAVA_MOAT);
  // Side bridges on far west & east to access treasure/chalice wings
  fillRoomRect(room, 'ground', 3, 10, 4, 11, T.STONE_STAIRS);
  fillRoomRect(room, 'ground', 23, 10, 24, 11, T.STONE_STAIRS);

  // Central grand crimson carpet runner leading from entry straight to Castle Gate
  fillRoomRect(room, 'ground', 13, 2, 14, 15, T.CARPET_V);
  fillRoomRect(room, 'ground', 12, 7, 15, 8, T.MAGIC_SEAL);
  fillRoomRect(room, 'ground', 13, 12, 14, 12, T.STONE_STAIRS);

  // Low stone parapets flanking the bridge over lava
  fillRoomRect(room, 'wall', 11, 10, 11, 11, T.WALL_LOW_PARAPET);
  fillRoomRect(room, 'wall', 16, 10, 16, 11, T.WALL_LOW_PARAPET);

  // Inner courtyard sanctuary walls framing west chest alcove & east chalice alcove
  fillRoomRect(room, 'wall', 6, 3, 6, 6, T.WALL_BRICK);
  fillRoomRect(room, 'wall', 21, 3, 21, 6, T.WALL_BRICK);

  // Stained glass windows along northern castle facade
  for (const col of [4, 9, 18, 23]) {
    setRoomTile(room, 'wall', col, 0, T.WALL_STAINED_GLASS);
  }

  // Northern Locked Castle Gate (2 tiles wide at cols 13..14, row 0)
  setRoomTile(room, 'wall', 13, 0, T.GATE_CASTLE_KEY);
  setRoomTile(room, 'wall', 14, 0, T.GATE_CASTLE_KEY);
  setRoomTile(room, 'decor', 13, 1, T.DECOR_PORTAL_ARCH);
  setRoomTile(room, 'decor', 14, 1, T.DECOR_PORTAL_ARCH);

  // Crimson heraldic banners flanking the gate
  setRoomTile(room, 'decor', 11, 1, T.DECOR_BANNER);
  setRoomTile(room, 'decor', 16, 1, T.DECOR_BANNER);

  return room;
}

function buildGrandHallRoom(): EcsMapRoomDef {
  const room = createEmptyRoom('grand_hall', '彩窗長廊 Stained Nave', 32, 20, T.STONE_FLOOR);
  room.ambientDarkness = 0.48;
  room.skyTop = '#080716';
  room.skyBottom = '#191430';
  room.wallExtrudeH = 30;

  // Grand royal crimson nave carpet + horizontal cross-transept carpet to left/right switches
  fillRoomRect(room, 'ground', 15, 2, 16, 17, T.CARPET_V);
  fillRoomRect(room, 'ground', 4, 9, 27, 10, T.CARPET_H);
  fillRoomRect(room, 'ground', 14, 8, 17, 11, T.MAGIC_SEAL);

  // Dungeon iron grates & side lava fissures
  fillRoomRect(room, 'ground', 3, 3, 7, 5, T.IRON_GRATE);
  fillRoomRect(room, 'ground', 24, 3, 28, 5, T.IRON_GRATE);
  fillRoomRect(room, 'ground', 2, 14, 6, 17, T.LAVA_MOAT);
  fillRoomRect(room, 'ground', 25, 14, 29, 17, T.LAVA_MOAT);

  // Interior masonry partition walls creating tactical wings
  fillRoomRect(room, 'wall', 10, 3, 10, 6, T.WALL_BRICK);
  fillRoomRect(room, 'wall', 21, 3, 21, 6, T.WALL_BRICK);
  fillRoomRect(room, 'wall', 10, 13, 10, 16, T.WALL_BRICK);
  fillRoomRect(room, 'wall', 21, 13, 21, 16, T.WALL_BRICK);

  // Glowing Gothic stained-glass windows along north & side walls
  for (const col of [5, 12, 19, 26]) {
    setRoomTile(room, 'wall', col, 0, T.WALL_STAINED_GLASS);
  }
  setRoomTile(room, 'wall', 0, 9, T.WALL_STAINED_GLASS);
  setRoomTile(room, 'wall', 0, 10, T.WALL_STAINED_GLASS);
  setRoomTile(room, 'wall', 31, 9, T.WALL_STAINED_GLASS);
  setRoomTile(room, 'wall', 31, 10, T.WALL_STAINED_GLASS);

  // Northern Sealed Throne Portcullis (opens when both rune switches are pressed!)
  setRoomTile(room, 'wall', 15, 0, T.GATE_THRONE_SEAL);
  setRoomTile(room, 'wall', 16, 0, T.GATE_THRONE_SEAL);
  setRoomTile(room, 'decor', 15, 1, T.DECOR_PORTAL_ARCH);
  setRoomTile(room, 'decor', 16, 1, T.DECOR_PORTAL_ARCH);

  // South open return archway back to Courtyard
  setRoomTile(room, 'wall', 15, 19, 0);
  setRoomTile(room, 'wall', 16, 19, 0);
  setRoomTile(room, 'ground', 15, 19, T.STONE_STAIRS);
  setRoomTile(room, 'ground', 16, 19, T.STONE_STAIRS);

  // Floor spike hazards guarding the switch wings
  setRoomTile(room, 'decor', 8, 8, T.DECOR_SPIKES);
  setRoomTile(room, 'decor', 8, 11, T.DECOR_SPIKES);
  setRoomTile(room, 'decor', 23, 8, T.DECOR_SPIKES);
  setRoomTile(room, 'decor', 23, 11, T.DECOR_SPIKES);

  // Crimson banners along upper nave
  for (const col of [13, 18, 7, 24]) {
    setRoomTile(room, 'decor', col, 1, T.DECOR_BANNER);
  }

  return room;
}

function buildThroneSanctumRoom(): EcsMapRoomDef {
  const room = createEmptyRoom('throne_sanctum', '赤月王座殿 Crimson Throne', 26, 18, T.STONE_FLOOR);
  room.ambientDarkness = 0.52;
  room.skyTop = '#120612';
  room.skyBottom = '#240b1c';
  room.wallExtrudeH = 32;
  room.editorFocusY = 0;

  // Molten lava chasms framing the western & eastern edges of the Throne Sanctum
  fillRoomRect(room, 'ground', 1, 2, 2, 15, T.LAVA_MOAT);
  fillRoomRect(room, 'ground', 23, 2, 24, 15, T.LAVA_MOAT);

  // Grand crimson carpet leading up ceremonial steps to the Demon Throne dais
  fillRoomRect(room, 'ground', 12, 4, 13, 16, T.CARPET_V);
  fillRoomRect(room, 'ground', 8, 5, 17, 5, T.STONE_STAIRS);
  fillRoomRect(room, 'ground', 8, 2, 17, 4, T.IRON_GRATE);
  fillRoomRect(room, 'ground', 10, 2, 15, 4, T.CARPET_V);

  // Ceremonial Crimson Moon summoning circle (4 corner seals flanking obsidian battle floor)
  fillRoomRect(room, 'ground', 10, 8, 15, 12, T.STONE_FLOOR);
  fillRoomRect(room, 'ground', 12, 6, 13, 16, T.CARPET_V);
  fillRoomRect(room, 'ground', 9, 10, 16, 10, T.CARPET_H);
  setRoomTile(room, 'ground', 10, 8, T.MAGIC_SEAL);
  setRoomTile(room, 'ground', 15, 8, T.MAGIC_SEAL);
  setRoomTile(room, 'ground', 10, 12, T.MAGIC_SEAL);
  setRoomTile(room, 'ground', 15, 12, T.MAGIC_SEAL);

  // Towering stained-glass windows behind the Demon Throne
  for (const col of [7, 10, 15, 18]) {
    setRoomTile(room, 'wall', col, 0, T.WALL_STAINED_GLASS);
  }
  setRoomTile(room, 'decor', 8, 1, T.DECOR_BANNER);
  setRoomTile(room, 'decor', 17, 1, T.DECOR_BANNER);

  // South exit threshold back to Grand Hall
  setRoomTile(room, 'wall', 12, 17, 0);
  setRoomTile(room, 'wall', 13, 17, 0);
  setRoomTile(room, 'ground', 12, 17, T.STONE_STAIRS);
  setRoomTile(room, 'ground', 13, 17, T.STONE_STAIRS);

  return room;
}

const TS = 32;

export const OBSIDIAN_CITADEL_PROJECT: EcsProjectV2 = {
  schemaVersion: 2,
  meta: {
    id: 'obsidian-citadel',
    code: 'PA-14',
    title: '黑曜魔王城：赤月王座',
    subtitle: 'HD-2D 32×32 像素城塞 × 48×64 魔王王座 × 多廳捲動探險',
    genre: 'HD-2D 魔王城動作',
    accentHex: '#ef4444',
    controlsHint: '方向鍵/WASD 八向移動 · J/A 揮劍斬擊 · 空白/B 翻滾衝刺 · 探索三廳討伐魔王!',
    goalHint: '在城門外庭奪取鑰匙寶箱 → 彩窗長廊啟動雙機關開啟封印門 → 踏入赤月王座殿擊敗魔王馬拉科爾！',
  },
  viewport: {
    preset: 'hd_plus',
    width: 640,
    height: 360,
  },
  atmosphere: {
    skyTop: '#060914',
    skyBottom: '#14192e',
    ambientDarkness: 0.44,
    gridLines: false,
    shadowOcclusion: true,
    shadowStrength: 0.9,
    shadowSoftness: 0.36,
    tiltShiftBlur: 0.36,
    tiltShiftFocusY: 0.52,
    ambientParticles: 'embers',
    ambientParticleDensity: 0.65,
    juiceScale: 1.0,
  },
  projection: {
    mode: 'hd2d_3d',
    pitchDeg: 42,
    fovDeg: 38,
    wallHeightScale: 1.25,
    billboardTiltDeg: 12,
    obliqueShadowAlpha: 0.42,
    elevationScale: 1.0,
    perspectiveSkew: 0.055,
    activeDimensionMask: 3,
    inactiveDimAlpha: 0.2,
    allowDimensionShift: false,
  },
  worldMap: {
    tileSize: TS,
    startRoomId: 'courtyard',
    rooms: [buildCourtyardRoom(), buildGrandHallRoom(), buildThroneSanctumRoom()],
    portals: [
      {
        id: 'portal_courtyard_to_hall',
        name: '城門主拱門 → 彩窗長廊',
        fromRoomId: 'courtyard',
        col: 13,
        row: 0,
        cols: 2,
        rows: 2,
        toRoomId: 'grand_hall',
        targetX: 15 * TS + 16,
        targetY: 17 * TS,
        requiresGlobal: 'has_gate_key',
        lockedHint: '需要【城門古鑰】開啟外庭寶箱!',
      },
      {
        id: 'portal_hall_to_courtyard',
        name: '南側拱門 → 城門外庭',
        fromRoomId: 'grand_hall',
        col: 15,
        row: 18,
        cols: 2,
        rows: 2,
        toRoomId: 'courtyard',
        targetX: 13 * TS + 16,
        targetY: 3 * TS,
      },
      {
        id: 'portal_hall_to_throne',
        name: '王座封印門 → 赤月王座殿',
        fromRoomId: 'grand_hall',
        col: 15,
        row: 0,
        cols: 2,
        rows: 2,
        toRoomId: 'throne_sanctum',
        targetX: 12 * TS + 16,
        targetY: 14 * TS + 16,
        requiresGlobal: 'throne_gate_open',
        lockedHint: '需啟動東西兩側【符文機關】(0/2)!',
      },
      {
        id: 'portal_throne_to_hall',
        name: '王座南階 → 彩窗長廊',
        fromRoomId: 'throne_sanctum',
        col: 12,
        row: 16,
        cols: 2,
        rows: 2,
        toRoomId: 'grand_hall',
        targetX: 15 * TS + 16,
        targetY: 3 * TS,
      },
    ],
    heroConfig: {
      walkSpriteA: 'castle_hero_a',
      walkSpriteB: 'castle_hero_b',
      slashSprite: 'castle_slash_arc',
      slashColor: '#fef08a',
      slashReach: 36,
      dashSpeedMultiplier: 2.55,
    },
    interactions: [
      {
        tag: 'chest',
        trigger: 'slash_or_touch',
        radius: 30,
        oneShot: true,
        swapSprite: 'castle_chest_open',
        setGlobal: 'has_gate_key',
        setGlobalValue: 1,
        scoreDelta: 400,
        popupText: '獲得【城門古鑰】! 城門已開啟',
        popupColor: '#fde047',
        soundEvent: 'key',
      },
      {
        tag: 'switch',
        trigger: 'touch',
        radius: 24,
        oneShot: true,
        swapSprite: 'castle_switch_on',
        addGlobal: 'switches_lit',
        addGlobalDelta: 1,
        thresholdTargetGlobal: 'switches_required',
        thresholdUnlockGlobal: 'throne_gate_open',
        thresholdPopup: '雙機關啟動! 王座封印門已開啟!',
        thresholdPopupColor: '#38bdf8',
        scoreDelta: 300,
        popupText: '機關已啟動 ({val}/{max})',
        popupColor: '#22d3ee',
        soundEvent: 'key',
      },
      {
        tag: 'pickup',
        trigger: 'touch',
        radius: 26,
        oneShot: true,
        destroyOnUse: true,
        healAmount: 3,
        popupText: '+3 生命聖杯',
        popupColor: '#fb7185',
        soundEvent: 'star',
      },
    ],
    aiProfiles: {
      sentinel: {
        chaseRange: 220,
        stopRange: 14,
        moveSpeed: 56,
        contactDamage: 1,
        contactRange: 22,
        scoreOnDefeat: 250,
        knockback: 16,
      },
      boss: {
        chaseRange: 420,
        stopRange: 44,
        moveSpeed: 52,
        phase2Speed: 78,
        phase2HpRatio: 0.5,
        phase2Popup: '魔王覺醒：赤月狂怒!',
        contactDamage: 1,
        contactRange: 30,
        scoreOnDefeat: 2000,
        knockback: 8,
        hitReachBonus: 10,
        isBoss: true,
        winOnDefeat: true,
        hitPopup: '-1 魔王受創!',
        defeatPopup: '魔王馬拉科爾 討伐成功!',
        projectilePrefab: 'ember_orb',
        projectileTag: 'boss_orb',
        projectileInterval: 2.15,
        projectilePhase2Interval: 1.45,
        projectileCount: 5,
        projectilePhase2Count: 7,
        projectileSpeed: 132,
        projectilePhase2Speed: 165,
        projectileSpreadRad: 0.95,
        projectilePhase2SpreadRad: Math.PI * 1.15,
      },
    },
    hostileProjectileTag: 'boss_orb',
  },
  paths: {},
  animations: [
    {
      id: 'anim_castle_hero',
      initialState: 'idle',
      clips: [
        { name: 'idle', frames: ['castle_hero_a'], fps: 3, loop: true },
        { name: 'walk', frames: ['castle_hero_a', 'castle_hero_b'], fps: 7, loop: true },
      ],
      transitions: [
        { from: 'idle', to: 'walk', param: 'speed', op: 'gt', value: 10, priority: 2 },
        { from: 'walk', to: 'idle', param: 'speed', op: 'lte', value: 10, priority: 1 },
      ],
    },
  ],
  prefabs: {
    castle_torch: {
      id: 'castle_torch',
      name: '黑曜火盆火炬',
      category: '光源與建築',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32 },
        sprite: {
          sprite: 'castle_torch_brazier',
          castShadow: true,
          roughness: 0.32,
          metallic: 0.72,
          emissive: 0.85,
        },
        light: { radius: 135, color: '#f59e0b', intensity: 0.92, falloffPower: 1.7 },
        collider: { radius: 10, isSolid: true },
        tag: 'torch',
      },
    },
    castle_pillar: {
      id: 'castle_pillar',
      name: '哥德石柱 (32×48)',
      category: '光源與建築',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 48 },
        sprite: {
          sprite: 'castle_pillar_tall',
          castShadow: true,
          roughness: 0.62,
          metallic: 0.16,
          emissive: 0,
        },
        collider: { radius: 12, isSolid: true },
        tag: 'pillar',
      },
    },
    castle_chest: {
      id: 'castle_chest',
      name: '鑰匙寶箱',
      category: '機關與道具',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32 },
        sprite: {
          sprite: 'castle_chest_closed',
          castShadow: true,
          roughness: 0.38,
          metallic: 0.68,
          emissive: 0.18,
        },
        light: { radius: 74, color: '#fbbf24', intensity: 0.52, falloffPower: 2.0 },
        tag: 'chest',
      },
    },
    castle_switch: {
      id: 'castle_switch',
      name: '符文機關踏板',
      category: '機關與道具',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32, zOrder: -1 },
        sprite: {
          sprite: 'castle_switch_off',
          castShadow: false,
          roughness: 0.35,
          metallic: 0.55,
          emissive: 0.35,
        },
        light: { radius: 72, color: '#22d3ee', intensity: 0.55, falloffPower: 1.9 },
        tag: 'switch',
      },
    },
    castle_chalice: {
      id: 'castle_chalice',
      name: '赤血回復聖杯',
      category: '機關與道具',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32 },
        sprite: {
          sprite: 'castle_chalice',
          castShadow: true,
          roughness: 0.25,
          metallic: 0.82,
          emissive: 0.45,
        },
        light: { radius: 64, color: '#fb7185', intensity: 0.52, falloffPower: 2.0 },
        tag: 'pickup',
      },
    },
    castle_sentinel: {
      id: 'castle_sentinel',
      name: '黑曜赤戟守衛',
      category: '敵人與魔王',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32 },
        sprite: {
          sprite: 'castle_sentinel',
          castShadow: true,
          roughness: 0.36,
          metallic: 0.78,
          emissive: 0.12,
        },
        health: { hp: 3, maxHp: 3, team: 2 },
        collider: { radius: 13, damage: 1, hitTag: 'hero' },
        tag: 'sentinel',
      },
    },
    castle_throne: {
      id: 'castle_throne',
      name: '黑曜魔王王座 (48×64)',
      category: '光源與建築',
      components: {
        transform: { x: 0, y: 0, w: 48, h: 64 },
        sprite: {
          sprite: 'castle_throne',
          castShadow: true,
          roughness: 0.44,
          metallic: 0.48,
          emissive: 0.22,
        },
        light: { radius: 150, color: '#dc2626', intensity: 0.65, falloffPower: 1.8 },
        collider: { radius: 18, isSolid: true },
        tag: 'throne',
      },
    },
    demon_lord: {
      id: 'demon_lord',
      name: '魔王馬拉科爾 (48×64)',
      category: '敵人與魔王',
      components: {
        transform: { x: 0, y: 0, w: 48, h: 64 },
        sprite: {
          sprite: 'castle_demon_lord',
          castShadow: true,
          roughness: 0.28,
          metallic: 0.84,
          emissive: 0.42,
        },
        health: { hp: 14, maxHp: 14, team: 2 },
        light: { radius: 140, color: '#ef4444', intensity: 0.78, falloffPower: 1.6 },
        collider: { radius: 18, damage: 1, hitTag: 'hero' },
        tag: 'boss',
      },
    },
    ember_orb: {
      id: 'ember_orb',
      name: '赤月炎彈',
      category: '敵人與魔王',
      components: {
        transform: { x: 0, y: 0, w: 20, h: 20 },
        body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
        sprite: {
          sprite: 'castle_ember_orb',
          castShadow: false,
          roughness: 0.15,
          metallic: 0.2,
          emissive: 0.95,
        },
        light: { radius: 52, color: '#f97316', intensity: 0.72, falloffPower: 2.0 },
        lifetime: 3.4,
        tag: 'boss_orb',
      },
    },
  },
  entities: [
    // ================= HERO (persists across all rooms) =================
    {
      id: 'hero',
      name: '白銀城塞騎士',
      roomId: 'courtyard',
      components: {
        transform: { x: 13 * TS + 16, y: 14 * TS + 4, w: 32, h: 32 },
        sprite: {
          sprite: 'castle_hero_a',
          castShadow: true,
          roughness: 0.28,
          metallic: 0.78,
          emissive: 0.1,
        },
        characterMotor2d: {
          moveSpeed: 144,
          dashSpeed: 340,
          topDown: true,
        },
        health: { hp: 10, maxHp: 10, team: 1 },
        light: { radius: 112, color: '#93c5fd', intensity: 0.46, falloffPower: 2.0 },
        animatorId: 'anim_castle_hero',
        tag: 'hero',
      },
    },

    // ================= ROOM 1: COURTYARD (城門外庭) =================
    { id: 'cy_torch_sw', name: '橋頭火盆左', roomId: 'courtyard', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 11 * TS, y: 13 * TS } } },
    { id: 'cy_torch_se', name: '橋頭火盆右', roomId: 'courtyard', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 16 * TS, y: 13 * TS } } },
    { id: 'cy_torch_nw', name: '城門火盆左', roomId: 'courtyard', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 11 * TS, y: 3 * TS } } },
    { id: 'cy_torch_ne', name: '城門火盆右', roomId: 'courtyard', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 16 * TS, y: 3 * TS } } },
    { id: 'cy_torch_w', name: '西側壁火', roomId: 'courtyard', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 2 * TS, y: 5 * TS } } },
    { id: 'cy_torch_e', name: '東側壁火', roomId: 'courtyard', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 25 * TS, y: 5 * TS } } },

    { id: 'cy_pillar_1', name: '外庭石柱左前', roomId: 'courtyard', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 9 * TS, y: 6 * TS - 16 } } },
    { id: 'cy_pillar_2', name: '外庭石柱右前', roomId: 'courtyard', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 18 * TS, y: 6 * TS - 16 } } },
    { id: 'cy_pillar_3', name: '外庭石柱左後', roomId: 'courtyard', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 9 * TS, y: 2 * TS - 16 } } },
    { id: 'cy_pillar_4', name: '外庭石柱右後', roomId: 'courtyard', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 18 * TS, y: 2 * TS - 16 } } },

    { id: 'cy_chest_key', name: '城門古鑰寶箱', roomId: 'courtyard', prefabId: 'castle_chest', components: {}, overrides: { transform: { x: 3 * TS, y: 3 * TS } } },
    { id: 'cy_chalice', name: '外庭回復聖杯', roomId: 'courtyard', prefabId: 'castle_chalice', components: {}, overrides: { transform: { x: 24 * TS, y: 3 * TS } } },
    { id: 'cy_guard_w', name: '西庭守衛', roomId: 'courtyard', prefabId: 'castle_sentinel', components: {}, overrides: { transform: { x: 4 * TS, y: 6 * TS } } },
    { id: 'cy_guard_e', name: '東庭守衛', roomId: 'courtyard', prefabId: 'castle_sentinel', components: {}, overrides: { transform: { x: 23 * TS, y: 6 * TS } } },

    // ================= ROOM 2: GRAND HALL (彩窗長廊) =================
    { id: 'gh_pillar_1', name: '長廊石柱一', roomId: 'grand_hall', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 13 * TS, y: 4 * TS - 16 } } },
    { id: 'gh_pillar_2', name: '長廊石柱二', roomId: 'grand_hall', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 18 * TS, y: 4 * TS - 16 } } },
    { id: 'gh_pillar_3', name: '長廊石柱三', roomId: 'grand_hall', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 13 * TS, y: 12 * TS - 16 } } },
    { id: 'gh_pillar_4', name: '長廊石柱四', roomId: 'grand_hall', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 18 * TS, y: 12 * TS - 16 } } },
    { id: 'gh_pillar_5', name: '長廊石柱五', roomId: 'grand_hall', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 13 * TS, y: 16 * TS - 16 } } },
    { id: 'gh_pillar_6', name: '長廊石柱六', roomId: 'grand_hall', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 18 * TS, y: 16 * TS - 16 } } },

    { id: 'gh_torch_1', name: '長廊火盆北左', roomId: 'grand_hall', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 13 * TS, y: 2 * TS } } },
    { id: 'gh_torch_2', name: '長廊火盆北右', roomId: 'grand_hall', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 18 * TS, y: 2 * TS } } },
    { id: 'gh_torch_3', name: '長廊火盆西', roomId: 'grand_hall', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 3 * TS, y: 8 * TS } } },
    { id: 'gh_torch_4', name: '長廊火盆東', roomId: 'grand_hall', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 28 * TS, y: 8 * TS } } },

    { id: 'gh_switch_west', name: '西翼符文機關', roomId: 'grand_hall', prefabId: 'castle_switch', components: {}, overrides: { transform: { x: 4 * TS, y: 9 * TS + 16 } } },
    { id: 'gh_switch_east', name: '東翼符文機關', roomId: 'grand_hall', prefabId: 'castle_switch', components: {}, overrides: { transform: { x: 27 * TS, y: 9 * TS + 16 } } },
    { id: 'gh_chalice', name: '長廊回復聖杯', roomId: 'grand_hall', prefabId: 'castle_chalice', components: {}, overrides: { transform: { x: 15 * TS + 16, y: 9 * TS + 16 } } },

    { id: 'gh_guard_w', name: '西翼赤衛', roomId: 'grand_hall', prefabId: 'castle_sentinel', components: {}, overrides: { transform: { x: 6 * TS, y: 9 * TS } } },
    { id: 'gh_guard_e', name: '東翼赤衛', roomId: 'grand_hall', prefabId: 'castle_sentinel', components: {}, overrides: { transform: { x: 25 * TS, y: 9 * TS } } },
    { id: 'gh_guard_n', name: '王座門前禁衛', roomId: 'grand_hall', prefabId: 'castle_sentinel', components: {}, overrides: { transform: { x: 15 * TS + 16, y: 5 * TS } } },

    // ================= ROOM 3: THRONE SANCTUM (赤月王座殿) =================
    { id: 'ts_throne', name: '黑曜魔王王座', roomId: 'throne_sanctum', prefabId: 'castle_throne', components: {}, overrides: { transform: { x: 12 * TS + 8, y: 2 * TS - 16 } } },
    { id: 'ts_boss', name: 'DEMON LORD MALAKOR', roomId: 'throne_sanctum', prefabId: 'demon_lord', components: {}, overrides: { transform: { x: 12 * TS + 8, y: 7 * TS } } },

    { id: 'ts_torch_1', name: '王座火盆左上', roomId: 'throne_sanctum', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 8 * TS, y: 3 * TS } } },
    { id: 'ts_torch_2', name: '王座火盆右上', roomId: 'throne_sanctum', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 17 * TS, y: 3 * TS } } },
    { id: 'ts_torch_3', name: '王座火盆左下', roomId: 'throne_sanctum', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 6 * TS, y: 12 * TS } } },
    { id: 'ts_torch_4', name: '王座火盆右下', roomId: 'throne_sanctum', prefabId: 'castle_torch', components: {}, overrides: { transform: { x: 19 * TS, y: 12 * TS } } },

    { id: 'ts_pillar_1', name: '王座石柱左', roomId: 'throne_sanctum', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 6 * TS, y: 6 * TS - 16 } } },
    { id: 'ts_pillar_2', name: '王座石柱右', roomId: 'throne_sanctum', prefabId: 'castle_pillar', components: {}, overrides: { transform: { x: 19 * TS, y: 6 * TS - 16 } } },
    { id: 'ts_chalice', name: '王座戰前聖杯', roomId: 'throne_sanctum', prefabId: 'castle_chalice', components: {}, overrides: { transform: { x: 5 * TS, y: 14 * TS } } },
  ],
  scripts: {},
  cutscenes: [
    {
      id: 'citadel_gate_intro',
      name: '黑曜城門外庭巡禮',
      trigger: 'manual',
      roomId: 'courtyard',
      skippable: true,
      handbackDurationSec: 0.45,
      shots: [
        {
          id: 'gate_courtyard_ws',
          durationSec: 1.4,
          subject: 'point',
          focusX: 448,
          focusY: 272,
          shotSize: 'WS',
          anchor: 'center',
          motion: 'spring',
          pitchDegOverride: 42,
          motivation: 'establish_citadel_courtyard',
          speaker: 'CHRONICLE',
          subtitle: '赤月籠罩黑曜城塞，古鑰深藏於外庭深處...',
          letterbox: 0.9,
          spotlightDarkness: 0.1,
        },
        {
          id: 'gate_hero_lead_ms',
          durationSec: 1.6,
          subject: 'hero',
          shotSize: 'MS',
          anchor: 'lead_room',
          motion: 'spring',
          motivation: 'knight_enters_outer_bailey',
          splashTitle: '黑曜魔王城',
          splashSubtitle: 'OBSIDIAN CITADEL',
          letterbox: 0.9,
          spotlightDarkness: 0.12,
        },
      ],
    },
    {
      id: 'malakor_awakening',
      name: '魔王馬拉科爾覺醒',
      trigger: 'on_room_enter',
      roomId: 'throne_sanctum',
      skippable: true,
      handbackDurationSec: 0.5,
      shots: [
        {
          id: 'sanctum_overview_ws',
          durationSec: 1.2,
          subject: 'point',
          focusX: 416,
          focusY: 288,
          shotSize: 'WS',
          anchor: 'center',
          motion: 'spring',
          motivation: 'enter_crimson_throne_sanctum',
          letterbox: 0.95,
          spotlightDarkness: 0.14,
        },
        {
          id: 'malakor_close_cu',
          durationSec: 1.5,
          subject: 'ts_boss',
          shotSize: 'CU',
          anchor: 'center',
          motion: 'push_in',
          motivation: 'demon_lord_awakening',
          splashTitle: 'DEMON LORD MALAKOR',
          splashSubtitle: '赤月魔王 · 馬拉科爾',
          shakeTrauma: 0.35,
          letterbox: 1.0,
          spotlightDarkness: 0.24,
        },
        {
          id: 'malakor_duel_two_shot',
          durationSec: 1.5,
          subject: 'hero',
          secondarySubject: 'ts_boss',
          shotSize: 'MS',
          anchor: 'two_shot',
          motion: 'spring',
          motivation: 'hero_confronts_malakor',
          letterbox: 0.9,
          spotlightDarkness: 0.12,
        },
      ],
    },
  ],
  globals: {
    has_gate_key: 0,
    switches_lit: 0,
    switches_required: 2,
    throne_gate_open: 0,
  },
  hud: [
    { label: 'KEY', kind: 'text', globalKey: 'has_gate_key', x: 188, y: 14, color: '#fde68a' },
    { label: 'SEAL', kind: 'text', globalKey: 'switches_lit', x: 242, y: 14, color: '#38bdf8' },
  ],
};
