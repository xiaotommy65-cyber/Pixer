import type { EcsProjectV2 } from '../../core/ecs/EcsProjectSchema.ts';

/**
 * PA-12「時空裂隙：星界迴廊」— Pixer 9.0 Flagship Pure-ECS Showcase.
 * 100% declarative `EcsProjectV2` combining:
 * - Batch 9.1: CharacterMotor2D (coyote/buffer/dash) + GrappleAnchor + TriggerZone + VerletChain scarf
 * - Batch 9.2: Reusable Prefab library with sparse overrides
 * - Batch 9.3: Provably solvable by EcsSpatialOracle & EcsPlaytestVerifier
 * - Batch 9.4: Spatial3D Z-elevation + Light/Shadow Parallel Realms (R key shift) + HD-2D / 1P 2.5D projection
 * - Batch 9.5: Declarative Event Graph scripts with live VM execution trace layouts
 */
export const ASTRAL_RIFT_PROJECT: EcsProjectV2 = {
  schemaVersion: 2,
  meta: {
    id: 'astral-rift',
    code: 'PA-12',
    title: '時空裂隙：星界迴廊',
    subtitle: '純 ECS 多維位面 × 飛鉤動作 × 事件圖旗艦',
    genre: 'ECS 9.0 旗艦',
    accentHex: '#38bdf8',
    controlsHint: '← → 移動・B 跳躍・A 鉤索擺盪・R 切換表裡世界・抵達右側星界傳送門！',
    goalHint: '收集表世界與裡世界的星晶，按 R 切換維度顯現幽靈星橋，飛鉤跨越裂隙抵達星門！',
  },
  viewport: {
    preset: 'hd_plus',
    width: 640,
    height: 360,
  },
  atmosphere: {
    skyTop: '#0b1026',
    skyBottom: '#1c2541',
    ambientDarkness: 0.24,
    waterLevelNorm: 0.89,
    waterTint: '#162c4a',
    gridLines: true,
  },
  projection: {
    mode: 'hd2d_iso',
    elevationScale: 0.9,
    perspectiveSkew: 0.055,
    activeDimensionMask: 1,
    inactiveDimAlpha: 0.2,
    allowDimensionShift: true,
    fovDeg: 68,
    wallHeightScale: 1.0,
  },
  paths: {},
  animations: [],
  prefabs: {
    rift_crystal: {
      id: 'rift_crystal',
      name: '星界裂隙結晶',
      category: '互動感測',
      components: {
        transform: { x: 0, y: 0, w: 22, h: 22, zOrder: 4 },
        sprite: { sprite: 'star_a', roughness: 0.14, metallic: 0.82, emissive: 0.72, castShadow: true },
        light: { radius: 46, color: '#ffd447', intensity: 0.85, falloffPower: 1.8 },
        triggerZone: {
          shape: 'circle',
          radius: 18,
          filterTag: 'hero',
          onEnterEvent: 'collect_shard',
          oneShot: true,
        },
        spatial3d: { z: 12, height: 18, groundZ: 12, gravityZ: 0, dimensionMask: 1, shadowScale: 0.9 },
        tag: 'pickup',
      },
    },
    grapple_beacon: {
      id: 'grapple_beacon',
      name: '星軌鉤索錨點',
      category: '動作機關',
      components: {
        transform: { x: 0, y: 0, w: 26, h: 26, zOrder: 5 },
        sprite: { sprite: 'hd_turret_prism', roughness: 0.16, metallic: 0.9, emissive: 0.65, castShadow: true },
        light: { radius: 74, color: '#38bdf8', intensity: 0.92, falloffPower: 1.8 },
        grappleAnchor: { anchorRadius: 156, swingTension: 0.96, reelSpeed: 124, minLength: 32, enabled: true },
        spatial3d: { z: 24, height: 22, groundZ: 24, gravityZ: 0, dimensionMask: 3, shadowScale: 1.1 },
        tag: 'anchor',
      },
    },
    light_platform: {
      id: 'light_platform',
      name: '表世界浮空星台',
      category: '多維地形',
      components: {
        transform: { x: 0, y: 0, w: 96, h: 18, zOrder: 1 },
        sprite: { sprite: 'hd_arena_tile', tint: '#fbbf24', roughness: 0.35, metallic: 0.55, emissive: 0.14, castShadow: true },
        collider: { radius: 12, isSolid: true },
        spatial3d: { z: 8, height: 16, groundZ: 8, gravityZ: 0, dimensionMask: 1, shadowScale: 1.0 },
        tag: 'solid',
      },
    },
    shadow_platform: {
      id: 'shadow_platform',
      name: '裡世界幽影星橋',
      category: '多維地形',
      components: {
        transform: { x: 0, y: 0, w: 96, h: 18, zOrder: 1 },
        sprite: { sprite: 'hd_arena_tile', tint: '#a78bfa', roughness: 0.28, metallic: 0.72, emissive: 0.28, castShadow: true },
        collider: { radius: 12, isSolid: true },
        spatial3d: { z: 14, height: 16, groundZ: 14, gravityZ: 0, dimensionMask: 2, shadowScale: 1.0 },
        tag: 'solid',
      },
    },
  },
  entities: [
    {
      id: 'start_sanctuary',
      name: '起始觀星台',
      components: {
        transform: { x: 16, y: 262, w: 108, h: 20, zOrder: 1 },
        sprite: { sprite: 'hd_arena_tile', tint: '#94a3b8', roughness: 0.42, metallic: 0.4, emissive: 0.08, castShadow: true },
        collider: { radius: 12, isSolid: true },
        spatial3d: { z: 0, height: 18, groundZ: 0, gravityZ: 0, dimensionMask: 1, shadowScale: 1.0 },
        tag: 'solid',
      },
    },
    {
      id: 'light_step',
      name: '表世界躍階',
      prefabId: 'light_platform',
      components: {
        transform: { x: 158, y: 232, w: 88, h: 18 },
      },
    },
    {
      id: 'shadow_bridge',
      name: '裡世界幽影橋',
      prefabId: 'shadow_platform',
      components: {
        transform: { x: 280, y: 208, w: 92, h: 18 },
      },
    },
    {
      id: 'rift_anchor',
      name: '裂隙星軌錨點',
      prefabId: 'grapple_beacon',
      components: {
        transform: { x: 438, y: 120, w: 26, h: 26 },
        scripts: ['rift_pulse_beacon'],
      },
    },
    {
      id: 'exit_spire',
      name: '終點星門高台',
      components: {
        transform: { x: 504, y: 200, w: 120, h: 20, zOrder: 1 },
        sprite: { sprite: 'hd_arena_tile', tint: '#34d399', roughness: 0.3, metallic: 0.65, emissive: 0.2, castShadow: true },
        collider: { radius: 12, isSolid: true },
        spatial3d: { z: 18, height: 18, groundZ: 18, gravityZ: 0, dimensionMask: 2, shadowScale: 1.0 },
        tag: 'solid',
      },
    },
    {
      id: 'shard_light',
      name: '表界星晶',
      prefabId: 'rift_crystal',
      components: {
        transform: { x: 192, y: 198 },
      },
    },
    {
      id: 'shard_shadow',
      name: '裡界星晶',
      prefabId: 'rift_crystal',
      components: {
        transform: { x: 314, y: 174 },
      },
      overrides: {
        sprite: { tint: '#c084fc' },
        light: { color: '#c084fc' },
        spatial3d: { z: 18, dimensionMask: 2 },
      },
    },
    {
      id: 'rift_portal',
      name: '星界傳送門',
      components: {
        transform: { x: 552, y: 160, w: 38, h: 38, zOrder: 5 },
        sprite: { sprite: 'hd_astral_core', roughness: 0.12, metallic: 0.92, emissive: 0.9, castShadow: true },
        light: { radius: 92, color: '#34d399', intensity: 1.05, falloffPower: 1.7 },
        triggerZone: {
          shape: 'rect',
          width: 38,
          height: 38,
          filterTag: 'hero',
          onEnterEvent: 'reach_rift_portal',
          oneShot: true,
        },
        spatial3d: { z: 18, height: 32, groundZ: 18, gravityZ: 0, dimensionMask: 2, shadowScale: 1.15 },
        scripts: ['rift_portal_win'],
        tag: 'goal',
      },
    },
    {
      id: 'rift_hero',
      name: '星界旅者',
      components: {
        transform: { x: 48, y: 238, w: 20, h: 20, zOrder: 6 },
        sprite: { sprite: 'hero_a', roughness: 0.25, metallic: 0.45, emissive: 0.3, castShadow: true },
        light: { radius: 66, color: '#38bdf8', intensity: 0.85, falloffPower: 1.8 },
        characterMotor2d: {
          moveSpeed: 185,
          accel: 1900,
          airControl: 0.75,
          gravity: 720,
          maxFallSpeed: 420,
          jumpVelocity: 308,
          coyoteTimeSec: 0.14,
          jumpBufferSec: 0.14,
          dashSpeed: 310,
          dashDurationSec: 0.14,
          dashCooldownSec: 0.42,
          floorY: 344,
        },
        verletChain: {
          nodeCount: 6,
          segmentLength: 6,
          gravity: 300,
          damping: 0.92,
          iterations: 4,
          pinStart: true,
          attachOffsetX: 6,
          attachOffsetY: 10,
          color: '#38bdf8',
          thickness: 2.5,
        },
        spatial3d: { z: 0, height: 20, groundZ: 0, gravityZ: 0, jumpZVelocity: 220, dimensionMask: 3, shadowScale: 1.0 },
        scripts: ['rift_collector', 'realm_shift_reactor'],
        tag: 'hero',
      },
    },
  ],
  scripts: {
    rift_collector: {
      id: 'rift_collector',
      name: '星晶收集事件圖',
      description: '當玩家進入星晶感測區時累加星晶數、加分並播放星光音效。',
      rules: [
        {
          trigger: { on: 'event', name: 'collect_shard' },
          ops: [
            { op: 'add_global', key: 'shards', delta: 1, max: 10 },
            { op: 'add_score', delta: 250 },
            { op: 'play_sfx', sfx: 'star' },
          ],
        },
      ],
    },
    realm_shift_reactor: {
      id: 'realm_shift_reactor',
      name: '表裡世界切界反應圖',
      description: '監聽 R 鍵切界事件，記錄切界次數並回饋清脆音效。',
      rules: [
        {
          trigger: { on: 'event', name: 'dimension_shadow' },
          ops: [
            { op: 'add_global', key: 'shifts', delta: 1 },
            { op: 'play_sfx', sfx: 'snap' },
          ],
        },
        {
          trigger: { on: 'event', name: 'dimension_light' },
          ops: [
            { op: 'add_global', key: 'shifts', delta: 1 },
            { op: 'play_sfx', sfx: 'snap' },
          ],
        },
      ],
    },
    rift_portal_win: {
      id: 'rift_portal_win',
      name: '星門通關事件圖',
      description: '抵達右側星界傳送門時加分並宣告通關勝利。',
      rules: [
        {
          trigger: { on: 'event', name: 'reach_rift_portal' },
          ops: [
            { op: 'add_score', delta: 500 },
            { op: 'play_sfx', sfx: 'win' },
            { op: 'set_status', status: 'won' },
          ],
        },
      ],
    },
    rift_pulse_beacon: {
      id: 'rift_pulse_beacon',
      name: '裂隙信標脈衝圖',
      description: '每 1.2 秒釋放星軌脈衝，於事件圖編輯器中即時展示 VM 執行追蹤亮點。',
      rules: [
        {
          trigger: { on: 'timer', intervalSec: 1.2 },
          ops: [{ op: 'add_global', key: 'riftPulse', delta: 1 }],
        },
      ],
    },
  },
  graphLayouts: {
    rift_collector: {
      r0_trig: { x: 36, y: 40 },
      r0_op_0: { x: 288, y: 40 },
      r0_op_1: { x: 540, y: 40 },
      r0_op_2: { x: 792, y: 40 },
    },
    rift_pulse_beacon: {
      r0_trig: { x: 36, y: 40 },
      r0_op_0: { x: 292, y: 40 },
    },
  },
  globals: {
    shards: 0,
    shifts: 0,
    riftPulse: 0,
    activeDimension: 1,
    coreHp: 10,
    coreMaxHp: 10,
  },
  hud: [
    { kind: 'text', x: 18, y: 14, label: 'SHARDS', globalKey: 'shards', color: '#ffd447' },
    { kind: 'text', x: 132, y: 14, label: 'REALM', globalKey: 'activeDimension', color: '#38bdf8' },
    { kind: 'text', x: 236, y: 14, label: 'SHIFTS', globalKey: 'shifts', color: '#c084fc' },
    { kind: 'text', x: 344, y: 14, label: 'PULSE', globalKey: 'riftPulse', color: '#34d399' },
  ],
};
