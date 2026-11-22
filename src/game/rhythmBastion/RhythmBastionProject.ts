import type { EcsProjectV2 } from '../../core/ecs/EcsProjectSchema.ts';

/**
 * PA-11: 《星軌節奏塔防 · Rhythm Bastion》
 * Built 100% declaratively with Pixer 7.0 True ECS + Sandboxed Script VM + 640x360 HD-2D Viewport.
 * Zero custom gameplay TypeScript classes: proves a brand-new hybrid genre (Rhythm + Tower Defense)
 * impossible under the old fixed-controller monolithic runtime.
 */
export const RHYTHM_BASTION_PROJECT: EcsProjectV2 = {
  schemaVersion: 2,
  meta: {
    id: 'rhythm-bastion',
    code: 'PA-11',
    title: '星軌節奏塔防',
    subtitle: '640×360 HD-2D · 真 ECS 節奏×塔防混合',
    genre: 'ECS 節奏塔防',
    accentHex: '#f59e0b',
    controlsHint: 'A 鍵打擊上軌星拍 · B 鍵打擊下軌蒼拍 · 充能驅動三座星軌砲塔攔截虛空魔潮！',
    goalHint: '抓準金線節拍按下 A / B 充能，讓三座自律星塔攔截 12 隻虛空入侵者守衛聖核！',
  },
  viewport: {
    preset: 'hd_plus',
    width: 640,
    height: 360,
  },
  atmosphere: {
    skyTop: '#0b1120',
    skyBottom: '#1e293b',
    ambientDarkness: 0.22,
    waterLevelNorm: 0.81,
    waterTint: '#162844',
    gridLines: true,
  },
  paths: {
    void_march: [
      { x: 24, y: 68 },
      { x: 170, y: 68 },
      { x: 170, y: 154 },
      { x: 356, y: 154 },
      { x: 356, y: 76 },
      { x: 548, y: 76 },
    ],
  },
  animations: [
    {
      id: 'void_slime_walk',
      initialState: 'march',
      clips: [
        { name: 'march', frames: ['hd_void_slime'], fps: 4, loop: true },
      ],
      transitions: [],
    },
  ],
  globals: {
    energy: 65,
    combo: 0,
    coreHp: 10,
    coreMaxHp: 10,
    kills: 0,
    targetKills: 12,
    wave: 1,
  },
  prefabs: {
    void_enemy: {
      id: 'void_enemy',
      name: '虛空晶核史萊姆',
      components: {
        transform: { x: 24, y: 64, w: 28, h: 28, zOrder: 2 },
        sprite: { sprite: 'hd_void_slime', tint: '#ffffff', castShadow: true, metallic: 0.32, roughness: 0.24, emissive: 0.22 },
        animatorId: 'void_slime_walk',
        health: { hp: 3, maxHp: 3, team: 2 },
        pathFollower: { pathId: 'void_march', speed: 48, loop: false },
        collider: { radius: 13 },
        light: { radius: 42, color: '#c084fc', intensity: 0.65 },
        scripts: ['enemy_core_breach'],
        tag: 'enemy',
      },
    },
    star_bolt: {
      id: 'star_bolt',
      name: '星軌光彈',
      components: {
        transform: { x: 0, y: 0, w: 16, h: 16, zOrder: 4 },
        body2d: { vx: 0, vy: 0 },
        sprite: { sprite: 'hd_star_bolt', tint: '#ffffff', metallic: 0.4, roughness: 0.14, emissive: 0.9 },
        collider: { radius: 9, isProjectile: true, damage: 1, hitTag: 'enemy' },
        light: { radius: 34, color: '#fbbf24', intensity: 0.9 },
        lifetime: 1.8,
        tag: 'projectile',
      },
    },
    beat_orb_a: {
      id: 'beat_orb_a',
      name: 'A 軌星拍',
      components: {
        transform: { x: 604, y: 218, w: 20, h: 20, zOrder: 8 },
        body2d: { vx: -132, vy: 0 },
        sprite: { sprite: 'hd_beat_orb_a', tint: '#ffffff', metallic: 0.55, roughness: 0.15, emissive: 0.48 },
        rhythmLane: { lane: 0, judgeX: 112, windowPx: 32 },
        light: { radius: 30, color: '#f59e0b', intensity: 0.72 },
        tag: 'beat_note',
      },
    },
    beat_orb_b: {
      id: 'beat_orb_b',
      name: 'B 軌蒼拍',
      category: 'rhythm',
      components: {
        transform: { x: 604, y: 244, w: 20, h: 20, zOrder: 8 },
        body2d: { vx: -132, vy: 0 },
        sprite: { sprite: 'hd_beat_orb_b', tint: '#ffffff', metallic: 0.55, roughness: 0.15, emissive: 0.48 },
        rhythmLane: { lane: 1, judgeX: 112, windowPx: 32 },
        light: { radius: 30, color: '#38bdf8', intensity: 0.72 },
        tag: 'beat_note',
      },
    },
    solar_turret: {
      id: 'solar_turret',
      name: '日輪星軌砲塔',
      category: 'turret',
      components: {
        transform: { x: 200, y: 120, w: 34, h: 34, zOrder: 3 },
        sprite: { sprite: 'hd_turret_solar', tint: '#ffffff', castShadow: true, metallic: 0.85, roughness: 0.18, emissive: 0.25 },
        light: { radius: 78, color: '#f59e0b', intensity: 0.92 },
        scripts: ['turret_ai'],
        tag: 'turret',
      },
    },
  },
  scripts: {
    turret_ai: {
      id: 'turret_ai',
      name: '自律星塔鎖敵腳本',
      description: '每幀搜尋範圍 230px 內最近敵人，消耗星能發射星軌光彈。',
      rules: [
        {
          trigger: { on: 'tick' },
          ops: [
            { op: 'find_nearest', tag: 'enemy', range: 230 },
            {
              op: 'fire_at_target',
              prefab: 'star_bolt',
              speed: 285,
              cooldownSec: 0.42,
              energyGlobal: 'energy',
              energyCost: 4,
            },
          ],
        },
      ],
    },
    enemy_core_breach: {
      id: 'enemy_core_breach',
      name: '聖核突破判定',
      description: '敵人抵達路徑終點時扣除聖核耐久並銷毀自身。',
      rules: [
        {
          trigger: { on: 'path_end' },
          ops: [
            { op: 'damage_global', key: 'coreHp', delta: 1 },
            { op: 'destroy_self' },
          ],
        },
      ],
    },
    wave_director: {
      id: 'wave_director',
      name: '虛空波次導演',
      description: '定時於起點生成沿路徑行進的虛空入侵者。',
      rules: [
        {
          trigger: { on: 'start' },
          ops: [{ op: 'spawn_prefab', prefab: 'void_enemy', atX: 24, atY: 68 }],
        },
        {
          trigger: { on: 'timer', intervalSec: 2.15 },
          ops: [{ op: 'spawn_prefab', prefab: 'void_enemy', atX: 24, atY: 68 }],
        },
      ],
    },
    beat_spawner_a: {
      id: 'beat_spawner_a',
      name: '上軌節拍生成器 (A)',
      description: '按節拍於上軌生成星芒音符流向金線。',
      rules: [
        {
          trigger: { on: 'start' },
          ops: [{ op: 'spawn_prefab', prefab: 'beat_orb_a', atX: 460, atY: 220, lane: 0 }],
        },
        {
          trigger: { on: 'timer', intervalSec: 1.2 },
          ops: [{ op: 'spawn_prefab', prefab: 'beat_orb_a', atX: 604, atY: 220, lane: 0 }],
        },
      ],
    },
    beat_spawner_b: {
      id: 'beat_spawner_b',
      name: '下軌節拍生成器 (B)',
      description: '以交錯拍點於下軌生成蒼穹音符流向金線。',
      rules: [
        {
          trigger: { on: 'start' },
          ops: [{ op: 'spawn_prefab', prefab: 'beat_orb_b', atX: 540, atY: 246, lane: 1 }],
        },
        {
          trigger: { on: 'timer', intervalSec: 1.8 },
          ops: [{ op: 'spawn_prefab', prefab: 'beat_orb_b', atX: 604, atY: 246, lane: 1 }],
        },
      ],
    },
    rhythm_conductor: {
      id: 'rhythm_conductor',
      name: '節拍判定與充能系統',
      description: '監聽 A / B 鍵輸入，判定音符與金線距離並轉化為砲塔星能與連擊。',
      rules: [
        {
          trigger: { on: 'input', button: 'action' },
          ops: [
            {
              op: 'judge_lane_hit',
              lane: 0,
              perfectPx: 20,
              goodPx: 40,
              energyGlobal: 'energy',
              comboGlobal: 'combo',
              perfectEnergy: 24,
            },
          ],
        },
        {
          trigger: { on: 'input', button: 'jump' },
          ops: [
            {
              op: 'judge_lane_hit',
              lane: 1,
              perfectPx: 20,
              goodPx: 40,
              energyGlobal: 'energy',
              comboGlobal: 'combo',
              perfectEnergy: 26,
            },
          ],
        },
      ],
    },
  },
  entities: [
    {
      id: 'turret_west',
      name: '西翼星軌砲塔',
      components: {
        transform: { x: 108, y: 102, w: 34, h: 34, zOrder: 3 },
        sprite: { sprite: 'hd_turret_solar', tint: '#ffffff', castShadow: true, metallic: 0.85, roughness: 0.18, emissive: 0.25 },
        light: { radius: 76, color: '#f59e0b', intensity: 0.92 },
        scripts: ['turret_ai'],
        tag: 'turret',
      },
    },
    {
      id: 'turret_center',
      name: '中樞稜鏡砲塔',
      components: {
        transform: { x: 258, y: 98, w: 36, h: 36, zOrder: 3 },
        sprite: { sprite: 'hd_turret_prism', tint: '#ffffff', castShadow: true, metallic: 0.82, roughness: 0.16, emissive: 0.28 },
        light: { radius: 84, color: '#38bdf8', intensity: 0.96 },
        scripts: ['turret_ai'],
        tag: 'turret',
      },
    },
    {
      id: 'turret_east',
      name: '東塔星輝砲台',
      components: {
        transform: { x: 442, y: 112, w: 34, h: 34, zOrder: 3 },
        sprite: { sprite: 'hd_turret_jade', tint: '#ffffff', castShadow: true, metallic: 0.84, roughness: 0.18, emissive: 0.25 },
        light: { radius: 76, color: '#34d399', intensity: 0.92 },
        scripts: ['turret_ai'],
        tag: 'turret',
      },
    },
    {
      id: 'sanctum_core',
      name: '星軌聖核',
      components: {
        transform: { x: 544, y: 58, w: 46, h: 46, zOrder: 3 },
        sprite: { sprite: 'hd_sanctum_core', tint: '#ffffff', castShadow: true, metallic: 0.78, roughness: 0.14, emissive: 0.52 },
        light: { radius: 110, color: '#fcd34d', intensity: 1.0 },
        tag: 'core',
      },
    },
    {
      id: 'director_waves',
      name: '波次與節拍中樞',
      components: {
        transform: { x: 0, y: 0, w: 1, h: 1 },
        scripts: ['wave_director', 'beat_spawner_a', 'rhythm_conductor'],
        tag: 'director',
      },
    },
    {
      id: 'director_beat_b',
      name: '副軌節拍時鐘',
      components: {
        transform: { x: 0, y: 0, w: 1, h: 1 },
        scripts: ['beat_spawner_b'],
        tag: 'director',
      },
    },
  ],
  rhythmTrack: {
    enabled: true,
    yTop: 222,
    laneSpacing: 26,
    judgeX: 112,
    laneCount: 2,
    laneColors: ['#f59e0b', '#38bdf8'],
    laneLabels: ['[A] STAR', '[B] SKY'],
  },
  hud: [
    {
      kind: 'bar',
      x: 16,
      y: 22,
      w: 136,
      h: 8,
      label: 'ENERGY',
      globalKey: 'energy',
      maxVal: 100,
      color: '#f59e0b',
      bgColor: '#0f172a',
    },
    {
      kind: 'bar',
      x: 174,
      y: 22,
      w: 112,
      h: 8,
      label: 'CORE HP',
      globalKey: 'coreHp',
      maxVal: 10,
      color: '#34d399',
      bgColor: '#0f172a',
    },
    {
      kind: 'text',
      x: 312,
      y: 16,
      label: 'COMBO',
      globalKey: 'combo',
      color: '#38bdf8',
    },
    {
      kind: 'text',
      x: 432,
      y: 16,
      label: 'INTERCEPTED',
      globalKey: 'kills',
      color: '#fbbf24',
    },
  ],
};
