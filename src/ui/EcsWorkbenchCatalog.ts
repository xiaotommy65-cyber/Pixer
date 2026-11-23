import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import { analyzeActionReachability, observeSceneSemantics } from '../core/ai/EcsSpatialOracle.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsAttachableComponent, EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import type { ViewportPreset } from '../core/gpu/GpuTypes.ts';
import { ASTRAL_RIFT_PROJECT } from '../game/astralRift/AstralRiftProject.ts';
import { EMERALD_RUINS_PROJECT } from '../game/emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../game/obsidianCitadel/ObsidianCitadelProject.ts';
import { RHYTHM_BASTION_PROJECT } from '../game/rhythmBastion/RhythmBastionProject.ts';

export interface WorkbenchDiagReport {
  ok: boolean;
  headline: string;
  lines: string[];
}

export interface ComponentCatalogItem {
  key: EcsAttachableComponent;
  label: string;
  createDefault: () => unknown;
}

export interface SpritePickerOption {
  id: SpriteId;
  label: string;
}

export const BUILTIN_ECS_PROJECTS: readonly { id: string; label: string; project: EcsProjectV2 }[] = [
  { id: OBSIDIAN_CITADEL_PROJECT.meta.id, label: 'PA-14 黑曜魔王城：赤月王座 (HD-2D)', project: OBSIDIAN_CITADEL_PROJECT },
  { id: EMERALD_RUINS_PROJECT.meta.id, label: 'PA-15 翠律遺跡：星露聖域 (自訂瓦片 M1)', project: EMERALD_RUINS_PROJECT },
  { id: RHYTHM_BASTION_PROJECT.meta.id, label: 'PA-11 星軌節奏塔防', project: RHYTHM_BASTION_PROJECT },
  { id: ASTRAL_RIFT_PROJECT.meta.id, label: 'PA-12 時空裂隙 (9.0 旗艦)', project: ASTRAL_RIFT_PROJECT },
];

export const VIEWPORT_OPTIONS: readonly { id: ViewportPreset; label: string }[] = [
  { id: 'classic', label: '320×180 經典像素' },
  { id: 'hd', label: '480×270 寬像素' },
  { id: 'hd_plus', label: '640×360 HD-2D' },
  { id: 'qhd', label: '960×540 高解析' },
  { id: 'hd720', label: '1280×720 720p' },
];

export const HD_SPRITE_OPTIONS: readonly SpritePickerOption[] = [
  { id: 'castle_hero_a', label: '魔王城騎士 (32px)' },
  { id: 'castle_demon_lord', label: '魔王馬拉科爾 (48×64)' },
  { id: 'castle_throne', label: '黑曜魔王王座 (48×64)' },
  { id: 'castle_sentinel', label: '黑曜赤戟守衛 (32px)' },
  { id: 'castle_torch_brazier', label: '黑曜火焰火盆 (32px)' },
  { id: 'castle_pillar_tall', label: '哥德石柱 (32×48)' },
  { id: 'castle_banner_crimson', label: '赤月長旗幟 (32×48)' },
  { id: 'castle_chest_closed', label: '魔王城寶箱 (32px)' },
  { id: 'castle_switch_off', label: '符文踏板 (32px)' },
  { id: 'castle_chalice', label: '治癒聖杯 (32px)' },
  { id: 'castle_portal_arch', label: '赤月傳送拱門 (32×48)' },
  { id: 'hd_turret_solar', label: '日輪星塔 (64px)' },
  { id: 'hd_turret_prism', label: '稜鏡星塔 (64px)' },
  { id: 'hd_turret_jade', label: '翠輝星塔 (64px)' },
  { id: 'hd_sanctum_core', label: '星軌聖核 (64px)' },
  { id: 'hd_void_slime', label: '虛空史萊姆 (48px)' },
  { id: 'hd_star_bolt', label: '星軌光彈 (32px)' },
  { id: 'hd_beat_orb_a', label: 'A 軌星拍 (32px)' },
  { id: 'hd_beat_orb_b', label: 'B 軌蒼拍 (32px)' },
  { id: 'hd_arena_tile', label: '星台地磚 (64px)' },
];

export const COMPONENT_CATALOG: readonly ComponentCatalogItem[] = [
  {
    key: 'sprite',
    label: 'Material 精靈材質',
    createDefault: () => ({
      sprite: 'hd_turret_solar',
      tint: '#ffffff',
      castShadow: true,
      metallic: 0.75,
      roughness: 0.22,
      emissive: 0.2,
    }),
  },
  {
    key: 'light',
    label: 'LightSource 動態光源',
    createDefault: () => ({ radius: 80, color: '#f59e0b', intensity: 0.92, falloffPower: 1.8 }),
  },
  {
    key: 'body2d',
    label: 'Velocity2D 物理剛體',
    createDefault: () => ({ vx: 0, vy: 0, gravityScale: 0, drag: 0.2 }),
  },
  {
    key: 'health',
    label: 'Health 生命與陣營',
    createDefault: () => ({ hp: 5, maxHp: 5, team: 1 }),
  },
  {
    key: 'collider',
    label: 'Collider 圓形碰撞體',
    createDefault: () => ({ radius: 14, isProjectile: false, damage: 1, hitTag: 'enemy' }),
  },
  {
    key: 'pathFollower',
    label: 'PathFollower 路徑巡航',
    createDefault: () => ({ pathId: 'void_march', speed: 48, loop: true }),
  },
  {
    key: 'rhythmLane',
    label: 'RhythmLane 節拍軌道',
    createDefault: () => ({ lane: 0, judgeX: 112, windowPx: 32 }),
  },
  {
    key: 'characterMotor2d',
    label: 'CharacterMotor2D 動作馬達',
    createDefault: () => ({
      moveSpeed: 150,
      accel: 1200,
      airControl: 0.65,
      gravity: 720,
      maxFallSpeed: 420,
      jumpVelocity: 290,
      coyoteTimeSec: 0.12,
      jumpBufferSec: 0.12,
      dashSpeed: 340,
      dashDurationSec: 0.14,
      dashCooldownSec: 0.55,
      floorY: 224,
    }),
  },
  {
    key: 'grappleAnchor',
    label: 'GrappleAnchor 鉤索錨點',
    createDefault: () => ({
      anchorRadius: 150,
      swingTension: 0.98,
      reelSpeed: 96,
      minLength: 24,
      enabled: true,
    }),
  },
  {
    key: 'triggerZone',
    label: 'TriggerZone 互動感測區',
    createDefault: () => ({
      shape: 'circle',
      radius: 36,
      width: 48,
      height: 48,
      filterTag: '',
      onEnterEvent: 'zone_enter',
      onStayEvent: '',
      onExitEvent: 'zone_exit',
      oneShot: false,
      cooldownSec: 0.25,
    }),
  },
  {
    key: 'verletChain',
    label: 'VerletChain 柔體鍊條',
    createDefault: () => ({
      nodeCount: 6,
      segmentLength: 10,
      gravity: 420,
      damping: 0.96,
      iterations: 4,
      pinStart: true,
      attachOffsetX: 0,
      attachOffsetY: 6,
      color: '#f59e0b',
      thickness: 2,
    }),
  },
  {
    key: 'spatial3d',
    label: 'Spatial3D 立體高度與維度',
    createDefault: () => ({
      z: 24,
      height: 16,
      groundZ: 0,
      gravityZ: 0,
      jumpZVelocity: 190,
      dimensionMask: 1,
      shadowScale: 1.0,
    }),
  },
  {
    key: 'lifetime',
    label: 'Lifetime 存活計時',
    createDefault: () => 4.0,
  },
];

export type SliderRowFactory = (
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  fmt: (v: number) => string,
  onLive: (v: number) => void,
  onCommit: (v: number) => void,
) => HTMLElement;

/** Reusable workbench parameter slider with live preview callback & transactional commit callback. */
export function createWorkbenchSliderRow(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  fmt: (v: number) => string,
  onLive: (v: number) => void,
  onCommit: (v: number) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'p7-slider-row';

  const head = document.createElement('div');
  head.className = 'p7-slider-head';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  const valEl = document.createElement('span');
  valEl.className = 'p7-slider-val p7-mono';
  valEl.textContent = fmt(value);
  head.append(lbl, valEl);

  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'p7-range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  range.setAttribute('aria-label', label);
  range.addEventListener('input', () => {
    const n = Number(range.value);
    valEl.textContent = fmt(n);
    onLive(n);
  });
  range.addEventListener('change', () => {
    const n = Number(range.value);
    valEl.textContent = fmt(n);
    onCommit(n);
  });

  row.append(head, range);
  return row;
}

/** Collects deduplicated sprite options from project custom sprites, built-in HD sprites, and sliced atlas sheets. */
export function collectProjectSpriteOptions(
  proj: EcsProjectV2,
  atlas?: TextureAtlas,
): SpritePickerOption[] {
  const seen = new Set<string>();
  const opts: SpritePickerOption[] = [];
  for (const cs of Object.values(proj.customSprites ?? {})) {
    seen.add(cs.id);
    opts.push({
      id: cs.id as SpriteId,
      label: atlas ? `[自訂] ${cs.name || cs.id} (${cs.width}×${cs.height})` : `[自訂] ${cs.name || cs.id}`,
    });
  }
  for (const hd of HD_SPRITE_OPTIONS) {
    if (seen.has(hd.id)) continue;
    seen.add(hd.id);
    opts.push(hd);
  }
  if (atlas) {
    for (const sheet of atlas.listSpriteSheets()) {
      for (const fid of sheet.frameIds.slice(0, 8)) {
        if (seen.has(fid)) continue;
        seen.add(fid);
        opts.push({ id: fid as SpriteId, label: `${fid} (P${sheet.pageIndex + 1})` });
      }
    }
  }
  return opts;
}

/** Runs 180-frame headless ECS playtest + spatial reachability oracle for the toolbar Diagnostics button. */
export function runWorkbenchSpatialDiagnostics(session: EcsStudioSession): WorkbenchDiagReport {
  const proj = session.getProject();
  const rep = session.runHeadlessPlaytest(180);
  const sem = observeSceneSemantics(proj);
  const reach = analyzeActionReachability(proj);
  const lines: string[] = [
    `狀態 ${rep.status} · 分數 ${rep.score} · 實體 ${rep.activeEntities} · ${rep.systems.length} 系統 · VM ${rep.vmOpsLastFrame} ops/f`,
    `多維空間：${sem.projection.mode} · 啟用位面 [${sem.projection.activeDimensionMask}] · ${sem.entityCount} 實體 · ${sem.solidPlatforms.length} 平台 · ${sem.grappleAnchors.length} 鉤索 · ${sem.triggerZones.length} 感測區`,
  ];
  if (reach.hasActionMotor && reach.kinematics) {
    lines.push(
      `可達性神諭：${reach.pass ? '全部可通關' : '偵測到不可達/軟鎖'} · 節點 ${reach.reachableNodeIds.length}/${reach.nodes.length} · 跳高 ${reach.kinematics.maxJumpHeight}px`,
    );
    if (reach.diagnostics.length > 0) {
      lines.push(`風險：${reach.diagnostics[0]}`);
    }
  } else if (sem.warnings.length > 0) {
    lines.push(`結構提醒：${sem.warnings[0]}`);
  } else {
    lines.push('結構神諭：0 結構異常（未啟用 CharacterMotor2D 平台跳躍）');
  }
  return {
    ok: reach.pass && sem.warnings.length === 0,
    headline: reach.pass ? '180 幀真 ECS 與 AI 空間神諭通過' : 'AI 空間可達性偵測到關卡異常',
    lines,
  };
}
