import { resolveLogicalViewport } from '../gpu/GpuTypes.ts';
import {
  JuiceSystem,
  stepSquashSpring,
  triggerSquash,
  type SquashSpring,
} from '../sim/JuiceSystem.ts';
import {
  createEmptyInputState,
  type CartridgeInstance,
  type DebuggableCartridge,
  type InputState,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type SimEvent,
  type TileDesc,
} from '../types/WorldTypes.ts';
import { EcsActionPhysicsSystems, ecsEntitiesInteractInSpace } from './EcsActionPhysicsSystems.ts';
import type { EcsCoreWorld } from './EcsCoreWorld.ts';
import { unpackEntityIndex } from './EntityManager.ts';
import type { EcsProjectV2 } from './EcsProjectSchema.ts';
import {
  EcsSnapshotProjector,
  type EcsPopupSlot,
  type EcsSnapshotFrameState,
} from './EcsSnapshotProjector.ts';
import { EcsWorld, MAX_ECS_ENTITIES } from './EcsWorld.ts';
import { EcsWorldMapController, type WorldMapStepCallbacks } from './EcsWorldMapController.ts';
import { SandboxScriptVm, type VmExecutionContext } from './SandboxScriptVm.ts';

const MAX_POPUPS = 16;

// Pre-allocated static particle palettes (Zero-GC per frame)
const EMBER_COLORS: readonly string[] = ['#ff9233', '#ffd166', '#fb7185'];
const FIREFLY_COLORS: readonly string[] = ['#a7f3d0', '#fef08a', '#34d399'];
const DUST_COLORS: readonly string[] = ['#cbd5e1', '#94a3b8', '#e2e8f0'];
const SNOW_COLORS: readonly string[] = ['#f8fafc', '#bae6fd', '#e0f2fe'];
const HIT_SPARK_COLORS: readonly string[] = ['#fffbeb', '#fde047', '#fb923c'];
const KILL_BURST_COLORS: readonly string[] = ['#fef08a', '#fb7185', '#f97316', '#ffffff'];
const HURT_COLORS: readonly string[] = ['#fb7185', '#f43f5e', '#fecdd3'];
const DASH_DUST_COLORS: readonly string[] = ['#e2e8f0', '#94a3b8', '#cbd5e1'];
const FOOTSTEP_COLORS: readonly string[] = ['#94a3b8', '#64748b'];
const INTERACT_COLORS: readonly string[] = ['#fef08a', '#38bdf8', '#ffffff'];
const BOSS_PHASE_COLORS: readonly string[] = ['#fb7185', '#c084fc', '#fde047', '#ffffff'];

/**
 * Pure DOM-free, Zero-GC CartridgeInstance running any Pixer Project V2 natively on
 * `EcsCoreWorld` + 5-phase modular `EcsSystem` pipeline (`input -> script -> physics -> fixed -> render`)
 * + Sandboxed Script VM + GPU PBR Material / Multi-Page Atlas pipeline.
 */
export class EcsCartridgeRuntime implements CartridgeInstance, DebuggableCartridge {
  public readonly world = new EcsWorld();
  public readonly vm = new SandboxScriptVm();
  public readonly juice = new JuiceSystem();
  private readonly actionPhysics = new EcsActionPhysicsSystems(MAX_ECS_ENTITIES);
  private readonly worldMapCtrl: EcsWorldMapController;
  private readonly projector: EcsSnapshotProjector;
  private readonly projFrameState: EcsSnapshotFrameState;
  private project: EcsProjectV2;

  private status: 'playing' | 'won' | 'lost' = 'playing';
  private score = 0;
  private elapsedSec = 0;
  private debugOverlay = false;
  private activeDimensionMask = 3;
  private prevShoulderR = false;
  private fpYawRad = 0;
  private fpViewerX = 96;
  private fpViewerY = 144;
  private ambientSpawnAccum = 0;
  private lightSparkAccum = 0;
  private ambientSeed = 0x51a7f31;

  // Pre-allocated Zero-GC per-entity squash-and-stretch springs
  private readonly squashPool: SquashSpring[] = Array.from({ length: MAX_ECS_ENTITIES }, () => ({
    scaleX: 1,
    scaleY: 1,
    vx: 0,
    vy: 0,
  }));
  private readonly squashActive = new Uint8Array(MAX_ECS_ENTITIES);

  private readonly eventsOut: SimEvent[] = [];
  private readonly prevButtons = {
    action: false,
    jump: false,
    menu: false,
    skill: false,
    left: false,
    right: false,
    up: false,
    down: false,
  };
  private readonly vmCtx: VmExecutionContext;
  private readonly wmCallbacks: WorldMapStepCallbacks;

  private readonly popups: EcsPopupSlot[] = Array.from({ length: MAX_POPUPS }, () => ({
    active: false,
    text: '',
    x: 0,
    y: 0,
    timer: 0,
    color: '#ffd447',
  }));
  private readonly snap: RenderSceneSnapshot;

  constructor(project: EcsProjectV2) {
    this.project = project;
    this.worldMapCtrl = new EcsWorldMapController(project);
    const vp = resolveLogicalViewport(project.viewport);
    this.projector = new EcsSnapshotProjector(project, vp.width, vp.height);
    const waterY =
      project.atmosphere.waterLevelNorm && project.atmosphere.waterLevelNorm > 0
        ? Math.round(vp.height * project.atmosphere.waterLevelNorm)
        : undefined;

    this.vmCtx = {
      world: this.world,
      input: createEmptyInputState(),
      prevButtons: this.prevButtons,
      dt: 1 / 60,
      eventsOut: this.eventsOut,
      onScoreDelta: (delta) => {
        this.score = Math.max(0, this.score + delta);
      },
      onStatusChange: (st) => {
        this.status = st;
        this.eventsOut.push(st === 'won' ? 'win' : 'hurt');
      },
      onJudgePopup: (text, x, y, color) => {
        this.spawnPopup(text, x, y, color);
      },
    };

    this.wmCallbacks = {
      onScoreDelta: (delta) => {
        this.score = Math.max(0, this.score + delta);
      },
      onStatusChange: (st) => {
        this.status = st;
      },
      onPopup: (text, x, y, color) => {
        this.spawnPopup(text, x, y, color);
      },
      onRoomBanner: (banner) => {
        this.snap.statusBanner = banner;
      },
      onMeleeSwing: (x, y, dirX, dirY, _color, heroHandle) => {
        const jScale = this.project.atmosphere.juiceScale ?? 1.0;
        this.triggerEntitySquash(heroHandle, 1.24, 0.80);
        if (jScale > 0.01) {
          this.juice.addKick(dirX * 1.4 * jScale, dirY * 1.4 * jScale);
          this.juice.spawnCurlStream(x, y, HIT_SPARK_COLORS, 3, {
            vx: dirX * 42,
            vy: dirY * 42,
            spread: 14,
            curlStrength: 80,
            maxLife: 0.24,
            size: 2.6,
            additive: true,
          });
        }
      },
      onHitImpact: (x, y, dirX, dirY, killed, isBoss, targetHandle) => {
        const jScale = this.project.atmosphere.juiceScale ?? 1.0;
        this.triggerEntitySquash(targetHandle, 1.32, 0.72);
        if (jScale > 0.01) {
          const preset = killed ? (isBoss ? 'explosion' : 'heavy_kill') : 'light_hit';
          this.juice.applyPreset(preset, { dirX, dirY, intensity: jScale });
          this.juice.spawnBurst(x, y, killed ? KILL_BURST_COLORS : HIT_SPARK_COLORS, killed ? (isBoss ? 22 : 13) : 7, jScale, {
            speedMin: killed ? 42 : 34,
            speedMax: killed ? 135 : 96,
            gravity: killed ? 130 : 95,
            liftY: -24,
            additive: true,
          });
        }
      },
      onHeroHurt: (x, y, heroHandle) => {
        const jScale = this.project.atmosphere.juiceScale ?? 1.0;
        this.triggerEntitySquash(heroHandle, 1.30, 0.74);
        if (jScale > 0.01) {
          this.juice.applyPreset('player_hurt', { intensity: jScale });
          this.juice.spawnBurst(x, y, HURT_COLORS, 10, jScale, {
            speedMin: 30,
            speedMax: 86,
            gravity: 120,
            liftY: -18,
            additive: true,
          });
        }
      },
      onDash: (x, y, dirX, dirY, heroHandle) => {
        const jScale = this.project.atmosphere.juiceScale ?? 1.0;
        this.triggerEntitySquash(heroHandle, 1.28, 0.76);
        if (jScale > 0.01) {
          this.juice.applyPreset('dash_kick', { dirX: -dirX, dirY: -dirY, intensity: jScale });
          this.juice.spawnCurlStream(x, y, DASH_DUST_COLORS, 6, {
            vx: -dirX * 36,
            vy: -dirY * 36,
            spread: 12,
            curlStrength: 55,
            maxLife: 0.34,
            size: 3.4,
            additive: false,
          });
        }
      },
      onFootstep: (x, y) => {
        const jScale = this.project.atmosphere.juiceScale ?? 1.0;
        if (jScale > 0.05) {
          this.juice.spawnCurlStream(x, y, FOOTSTEP_COLORS, 1, {
            vx: 0,
            vy: -8,
            spread: 8,
            curlStrength: 28,
            maxLife: 0.28,
            size: 2.4,
            additive: false,
          });
        }
      },
      onInteract: (x, y, _color) => {
        const jScale = this.project.atmosphere.juiceScale ?? 1.0;
        if (jScale > 0.01) {
          this.juice.applyPreset('relic_burst', { intensity: jScale * 0.65 });
          this.juice.spawnBurst(x, y, INTERACT_COLORS, 10, jScale, {
            speedMin: 26,
            speedMax: 78,
            gravity: 65,
            liftY: -30,
            additive: true,
          });
        }
      },
      onBossPhase: (x, y) => {
        const jScale = this.project.atmosphere.juiceScale ?? 1.0;
        if (jScale > 0.01) {
          this.juice.applyPreset('boss_phase', { intensity: jScale });
          this.juice.spawnBurst(x, y, BOSS_PHASE_COLORS, 24, jScale, {
            speedMin: 55,
            speedMax: 160,
            gravity: 80,
            liftY: -28,
            additive: true,
          });
        }
      },
    };

    this.activeDimensionMask = project.projection?.activeDimensionMask ?? 3;
    this.projFrameState = {
      project: this.project,
      world: this.world,
      worldMapCtrl: this.worldMapCtrl,
      juice: this.juice,
      squashPool: this.squashPool,
      squashActive: this.squashActive,
      popups: this.popups,
      activeDimensionMask: this.activeDimensionMask,
      debugOverlay: this.debugOverlay,
      elapsedSec: 0,
      fpYawRad: 0,
      fpViewerX: 96,
      fpViewerY: 144,
      alpha: 1,
      onSyncWorldMapRoom: () => this.syncWorldMapRoomSnap(),
      onSyncStats: () => this.sysRenderSyncStats(),
    };

    this.snap = {
      cartridgeId: project.meta.id,
      skyTop: project.atmosphere.skyTop,
      skyBottom: project.atmosphere.skyBottom,
      cozyFilter: true,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 0,
      starsCollected: 0,
      starsTotal: 0,
      hasKey: false,
      hearts: 10,
      maxHearts: 10,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      viewport: { width: vp.width, height: vp.height },
      ambientDarkness: project.atmosphere.ambientDarkness ?? 0.25,
      hd2dDepth: {
        enabled:
          (project.projection?.mode ?? 'hd2d_iso') === 'hd2d_iso' ||
          project.projection?.mode === 'hd2d_3d',
        mode3d: project.projection?.mode === 'hd2d_3d',
        sortByDepthY:
          (project.projection?.mode ?? 'hd2d_iso') === 'hd2d_iso' ||
          project.projection?.mode === 'hd2d_3d',
        perspectiveSkew:
          (project.projection?.mode ?? 'hd2d_iso') === 'hd2d_iso'
            ? (project.projection?.perspectiveSkew ?? 0.055)
            : 0,
        pitchDeg: project.projection?.pitchDeg ?? 42,
        fovDeg: project.projection?.fovDeg ?? 38,
        wallHeightScale: project.projection?.wallHeightScale ?? 1.25,
        billboardTiltDeg: project.projection?.billboardTiltDeg ?? 12,
        obliqueShadowAlpha: project.projection?.obliqueShadowAlpha ?? 0.42,
        waterLevelY: waterY,
        waterTint: project.atmosphere.waterTint ?? '#1e3a5f',
        tiltShiftBlur: project.atmosphere.tiltShiftBlur ?? 0,
        tiltShiftFocusY: project.atmosphere.tiltShiftFocusY ?? 0.52,
      },
      bgStars: [],
      bgClouds: [],
      tiles: [],
      entities: this.projector.outEntities,
      particles: this.juice.particles,
      lights: this.projector.outLights,
      hudPrimitives: this.projector.outHud,
      hideClassicHud: true,
      statusBanner: project.meta.controlsHint,
      bgmTheme: 'starlight',
    };

    this.registerCoreSystems();
    this.reset();
  }

  private registerCoreSystems(): void {
    const core = this.world.core;

    // Phase 1 (input): Capture previous positions for render interpolation & decay hitFlash
    core.registerSystem({
      id: 'capture_prev_transform',
      phase: 'input',
      priority: 0,
      execute: (cw, dt) => this.sysCapturePrevTransform(cw, dt),
    });

    // Phase 2 (script): Execute deterministic Sandboxed Script VM rules
    core.registerSystem({
      id: 'sandbox_script_vm',
      phase: 'script',
      priority: 0,
      execute: (_cw, dt) => {
        this.vm.beginFrame(dt);
        this.vmCtx.dt = dt;
        this.vm.stepEntities(this.vmCtx);
      },
    });

    // Phase 3 (physics): Waypoint path-following, Action Motor, Grapple Pendulum, Body2D, Collisions, Trigger Zones
    core.registerSystem({
      id: 'path_follower',
      phase: 'physics',
      priority: 10,
      execute: (cw, dt) => this.sysPathFollower(cw, dt),
    });
    core.registerSystem({
      id: 'character_motor_2d',
      phase: 'physics',
      priority: 15,
      execute: (cw, dt) => {
        if (this.worldMapCtrl.hasWorldMap()) return;
        const vp = this.snap.viewport!;
        this.actionPhysics.stepCharacterMotor2D(
          cw,
          dt,
          this.vmCtx.input,
          this.prevButtons,
          vp.width,
          vp.height,
          this.world.tilemap,
          this.eventsOut,
          this.activeDimensionMask,
        );
      },
    });
    core.registerSystem({
      id: 'spatial_3d_elevation',
      phase: 'physics',
      priority: 16,
      execute: (cw, dt) => {
        this.actionPhysics.stepSpatial3D(
          cw,
          dt,
          this.vmCtx.input,
          this.prevButtons,
          this.eventsOut,
          this.activeDimensionMask,
        );
      },
    });
    core.registerSystem({
      id: 'grapple_pendulum',
      phase: 'physics',
      priority: 18,
      execute: (cw, dt) => {
        this.actionPhysics.stepGrapplePendulum(
          cw,
          dt,
          this.vmCtx.input,
          this.prevButtons,
          this.eventsOut,
          this.activeDimensionMask,
        );
      },
    });
    core.registerSystem({
      id: 'body2d_physics',
      phase: 'physics',
      priority: 20,
      execute: (cw, dt) => this.sysBody2dPhysics(cw, dt),
    });
    core.registerSystem({
      id: 'projectile_collision',
      phase: 'physics',
      priority: 30,
      execute: (cw) => this.sysProjectileCollision(cw),
    });
    core.registerSystem({
      id: 'trigger_zone_sensor',
      phase: 'physics',
      priority: 40,
      execute: (cw, dt) => this.actionPhysics.stepTriggerZones(cw, dt, this.vm, this.activeDimensionMask),
    });

    // Phase 4 (fixed): Verlet Chains, Data-driven Animator state machines, Lifetime GC, Popup timers
    core.registerSystem({
      id: 'verlet_chain_solver',
      phase: 'fixed',
      priority: 5,
      execute: (cw, dt) => this.actionPhysics.stepVerletChains(cw, dt),
    });
    core.registerSystem({
      id: 'animator_state_machine',
      phase: 'fixed',
      priority: 10,
      execute: (cw, dt) => this.sysAnimatorStateMachine(cw, dt),
    });
    core.registerSystem({
      id: 'lifetime_gc',
      phase: 'fixed',
      priority: 20,
      execute: (cw, dt) => this.sysLifetimeGc(cw, dt),
    });
    core.registerSystem({
      id: 'popup_timers',
      phase: 'fixed',
      priority: 30,
      execute: (_cw, dt) => this.sysPopupTimers(dt),
    });

    // Phase 5 (render): Synchronize top-level snapshot HUD/status metadata
    core.registerSystem({
      id: 'render_sync_stats',
      phase: 'render',
      priority: 0,
      execute: () => this.sysRenderSyncStats(),
    });
  }

  private sysCapturePrevTransform(core: EcsCoreWorld, dt: number): void {
    const c = core.components;
    const trStore = core.getStore(c.Transform2D);
    const trCount = trStore.size();
    for (let i = 0; i < trCount; i++) {
      const tr = trStore.getDenseDataAt(i);
      tr.prevX = tr.x;
      tr.prevY = tr.y;
    }
    const hpStore = core.getStore(c.Health);
    const hpCount = hpStore.size();
    for (let i = 0; i < hpCount; i++) {
      const hp = hpStore.getDenseDataAt(i);
      if (hp.hitFlash > 0) {
        hp.hitFlash = Math.max(0, hp.hitFlash - dt * 5);
      }
    }
  }

  private sysPathFollower(core: EcsCoreWorld, dt: number): void {
    const c = core.components;
    const pathStore = core.getStore(c.PathFollower);
    for (let i = pathStore.size() - 1; i >= 0; i--) {
      if (i >= pathStore.size()) continue;
      const h = pathStore.getDenseEntityAt(i);
      const pf = pathStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;
      const pts = this.world.paths.get(pf.pathKey);
      if (!pts || pts.length === 0 || pf.waypointIdx >= pts.length) continue;

      const wp = pts[pf.waypointIdx];
      const dx = wp.x - tr.x;
      const dy = wp.y - tr.y;
      const dist = Math.hypot(dx, dy);
      const stepDist = pf.speed * dt;

      if (dist <= stepDist + 0.5) {
        tr.x = wp.x;
        tr.y = wp.y;
        const nextIdx = pf.waypointIdx + 1;
        if (nextIdx >= pts.length) {
          if (pf.loop) {
            pf.waypointIdx = 0;
          } else {
            pf.waypointIdx = nextIdx;
            this.vm.triggerPathEnd(h, this.vmCtx);
          }
        } else {
          pf.waypointIdx = nextIdx;
        }
      } else {
        tr.x += (dx / dist) * stepDist;
        tr.y += (dy / dist) * stepDist;
        const mat = core.getComponent(h, c.Material);
        if (mat) {
          if (dx < -0.5) mat.flipX = true;
          else if (dx > 0.5) mat.flipX = false;
        }
      }
    }
  }

  private sysBody2dPhysics(core: EcsCoreWorld, dt: number): void {
    const c = core.components;
    const velStore = core.getStore(c.Velocity2D);
    for (let i = velStore.size() - 1; i >= 0; i--) {
      if (i >= velStore.size()) continue;
      const h = velStore.getDenseEntityAt(i);
      if (core.hasComponent(h, c.CharacterMotor2D)) continue;
      const vel = velStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;

      if (vel.gravityScale !== 0) {
        vel.vy += 520 * vel.gravityScale * dt;
      }
      if (vel.drag > 0) {
        const damp = Math.max(0, 1 - vel.drag * dt);
        vel.vx *= damp;
        vel.vy *= damp;
      }
      tr.x += vel.vx * dt;
      tr.y += vel.vy * dt;

      // Clean up missed rhythm notes past left edge
      const rl = core.getComponent(h, c.RhythmLane);
      if (rl && tr.x < rl.judgeX - 42) {
        this.world.setGlobal('combo', 0);
        this.world.destroy(h);
      }
    }
  }

  private sysProjectileCollision(core: EcsCoreWorld): void {
    const c = core.components;
    const colStore = core.getStore(c.Collider);
    const hpStore = core.getStore(c.Health);

    for (let i = colStore.size() - 1; i >= 0; i--) {
      if (i >= colStore.size()) continue;
      const a = colStore.getDenseEntityAt(i);
      const colA = colStore.getDenseDataAt(i);
      if (!colA.isProjectile) continue;
      const trA = core.getComponent(a, c.Transform2D);
      if (!trA) continue;
      const ax = trA.x + trA.w * 0.5;
      const ay = trA.y + trA.h * 0.5;
      const ar = colA.radius;
      const wantTag = colA.hitTag;
      const tagA = core.getComponent(a, c.Tag)?.tag ?? '';

      for (let j = hpStore.size() - 1; j >= 0; j--) {
        if (j >= hpStore.size()) continue;
        const b = hpStore.getDenseEntityAt(j);
        if (a === b) continue;
        if (!ecsEntitiesInteractInSpace(core, a, b, this.activeDimensionMask)) continue;
        const tagB = core.getComponent(b, c.Tag)?.tag ?? '';
        if (wantTag && tagB !== wantTag) continue;
        const trB = core.getComponent(b, c.Transform2D);
        if (!trB) continue;

        const bx = trB.x + trB.w * 0.5;
        const by = trB.y + trB.h * 0.5;
        const colB = core.getComponent(b, c.Collider);
        const br = colB ? colB.radius : trB.w * 0.45;
        const dx = bx - ax;
        const dy = by - ay;
        const rSum = ar + br;

        if (dx * dx + dy * dy <= rSum * rSum) {
          const hpB = hpStore.getDenseDataAt(j);
          hpB.hp -= colA.damage;
          hpB.hitFlash = 1;
          const jScale = this.project.atmosphere.juiceScale ?? 1.0;
          this.triggerEntitySquash(b, 1.24, 0.78);
          this.vm.triggerCollision(a, tagB, this.vmCtx);
          this.vm.triggerCollision(b, tagA, this.vmCtx);
          this.world.destroy(a);
          if (hpB.hp <= 0) {
            const kills = this.world.getGlobal('kills') + 1;
            this.world.setGlobal('kills', kills);
            this.score += 120;
            this.eventsOut.push('stomp');
            this.spawnPopup('+120', bx, by - 8, '#56d39c');
            if (jScale > 0.01) {
              this.juice.applyPreset('heavy_kill', { dirX: dx, dirY: dy, intensity: jScale * 0.75 });
              this.juice.spawnBurst(bx, by, KILL_BURST_COLORS, 10, jScale, {
                speedMin: 35,
                speedMax: 110,
                gravity: 110,
                liftY: -18,
                additive: true,
              });
            }
            this.world.destroy(b);
            const targetKills = this.world.getGlobal('targetKills');
            if (targetKills > 0 && kills >= targetKills) {
              this.status = 'won';
              this.eventsOut.push('win');
            }
          } else {
            this.eventsOut.push('snap');
            if (jScale > 0.01) {
              this.juice.applyPreset('light_hit', { dirX: dx, dirY: dy, intensity: jScale * 0.55 });
              this.juice.spawnBurst(bx, by, HIT_SPARK_COLORS, 5, jScale, {
                speedMin: 26,
                speedMax: 78,
                gravity: 90,
                liftY: -14,
                additive: true,
              });
            }
          }
          break;
        }
      }
    }
  }

  private sysAnimatorStateMachine(core: EcsCoreWorld, dt: number): void {
    const c = core.components;
    const animStore = core.getStore(c.Animator);
    const count = animStore.size();
    const isWorldMap = this.worldMapCtrl.hasWorldMap();
    for (let i = 0; i < count; i++) {
      const h = animStore.getDenseEntityAt(i);
      const animComp = animStore.getDenseDataAt(i);
      const anim = animComp.runtime;
      if (!anim) continue;
      const vel = core.getComponent(h, c.Velocity2D);
      const hp = core.getComponent(h, c.Health);
      const motor = core.getComponent(h, c.CharacterMotor2D);
      if (!isWorldMap) {
        const spd = vel ? Math.hypot(vel.vx, vel.vy) : 0;
        anim.setParam('speed', spd);
      }
      anim.setParam('hp', hp ? hp.hp : 0);
      if (motor) {
        anim.setParam('grounded', motor.grounded ? 1 : 0);
      }
      const res = anim.step(dt, this.world.animStepOut);
      const mat = core.getComponent(h, c.Material);
      if (mat) {
        mat.spriteId = res.spriteId;
      }
      if (res.emittedEvent) {
        this.vm.emitCustomEvent(res.emittedEvent);
      }
    }
  }

  private sysLifetimeGc(core: EcsCoreWorld, dt: number): void {
    const lifeStore = core.getStore(core.components.Lifetime);
    for (let i = lifeStore.size() - 1; i >= 0; i--) {
      if (i >= lifeStore.size()) continue;
      const h = lifeStore.getDenseEntityAt(i);
      const life = lifeStore.getDenseDataAt(i);
      life.remainingSec -= dt;
      if (life.remainingSec <= 0) {
        this.world.destroy(h);
      }
    }
  }

  private sysPopupTimers(dt: number): void {
    for (let i = 0; i < MAX_POPUPS; i++) {
      const p = this.popups[i];
      if (!p.active) continue;
      p.timer -= dt;
      p.y -= 18 * dt;
      if (p.timer <= 0) p.active = false;
    }
  }

  private sysRenderSyncStats(): void {
    const coreHp = Math.round(this.world.getGlobal('coreHp') || 10);
    const coreMaxHp = Math.round(this.world.getGlobal('coreMaxHp') || 10);
    const kills = Math.round(this.world.getGlobal('kills') || 0);
    const targetKills = Math.round(this.world.getGlobal('targetKills') || 0);
    this.snap.score = this.score;
    this.snap.hearts = coreHp;
    this.snap.maxHearts = coreMaxHp;
    this.snap.starsCollected = kills;
    this.snap.starsTotal = targetKills;
    this.snap.timeSec = this.elapsedSec;
    this.snap.elapsedSec = this.elapsedSec;
    this.snap.status = this.status;
  }

  public patchLiveAtmosphere(patch: Partial<EcsProjectV2['atmosphere']>): void {
    Object.assign(this.project.atmosphere, patch);
  }

  public getProject(): EcsProjectV2 {
    return this.project;
  }

  public setActiveDimensionMask(mask: number): void {
    this.activeDimensionMask = Math.max(1, Math.round(mask));
    this.world.setGlobal('activeDimension', this.activeDimensionMask);
  }

  public getActiveDimensionMask(): number {
    return this.activeDimensionMask;
  }

  public getActiveRoomId(): string {
    return this.worldMapCtrl.getActiveRoomId();
  }

  public switchRoomForEditor(roomId: string): boolean {
    const vp = this.snap.viewport!;
    const ok = this.worldMapCtrl.switchRoomForEditor(this.world, roomId, vp.width, vp.height);
    if (ok) this.syncWorldMapRoomSnap();
    return ok;
  }

  public setEditorCamera(x: number, y: number): void {
    this.worldMapCtrl.setEditorCamera(x, y);
    this.snap.cameraX = this.worldMapCtrl.cameraX;
    this.snap.cameraY = this.worldMapCtrl.cameraY;
  }

  public clearEditorCamera(): void {
    this.worldMapCtrl.clearEditorCamera();
  }

  public getCamera(): { x: number; y: number } {
    return { x: this.snap.cameraX, y: this.snap.cameraY };
  }

  private syncWorldMapRoomSnap(): void {
    const room = this.worldMapCtrl.getActiveRoom();
    if (!room) return;
    this.snap.tiles = this.worldMapCtrl.outTiles;
    this.snap.ambientDarkness = room.ambientDarkness ?? this.project.atmosphere.ambientDarkness ?? 0.35;
    if (room.skyTop) this.snap.skyTop = room.skyTop;
    if (room.skyBottom) this.snap.skyBottom = room.skyBottom;
    this.snap.cameraX = this.worldMapCtrl.cameraX;
    this.snap.cameraY = this.worldMapCtrl.cameraY;
  }

  public reloadProject(next: EcsProjectV2, preserveRoom = false): void {
    this.project = next;
    const vp = resolveLogicalViewport(next.viewport);
    const projMode = next.projection?.mode ?? 'hd2d_iso';
    this.activeDimensionMask = next.projection?.activeDimensionMask ?? 3;
    this.snap.cartridgeId = next.meta.id;
    this.snap.skyTop = next.atmosphere.skyTop;
    this.snap.skyBottom = next.atmosphere.skyBottom;
    this.snap.ambientDarkness = next.atmosphere.ambientDarkness ?? 0.25;
    this.snap.viewport = { width: vp.width, height: vp.height };
    this.snap.statusBanner = next.meta.controlsHint;
    if (this.snap.hd2dDepth) {
      const isHd2d = projMode === 'hd2d_iso' || projMode === 'hd2d_3d';
      this.snap.hd2dDepth.enabled = isHd2d;
      this.snap.hd2dDepth.mode3d = projMode === 'hd2d_3d';
      this.snap.hd2dDepth.sortByDepthY = isHd2d;
      this.snap.hd2dDepth.perspectiveSkew =
        projMode === 'hd2d_iso' ? (next.projection?.perspectiveSkew ?? 0.055) : 0;
      this.snap.hd2dDepth.pitchDeg = next.projection?.pitchDeg ?? 42;
      this.snap.hd2dDepth.fovDeg = next.projection?.fovDeg ?? 38;
      this.snap.hd2dDepth.wallHeightScale = next.projection?.wallHeightScale ?? 1.25;
      this.snap.hd2dDepth.billboardTiltDeg = next.projection?.billboardTiltDeg ?? 12;
      this.snap.hd2dDepth.obliqueShadowAlpha = next.projection?.obliqueShadowAlpha ?? 0.42;
      this.snap.hd2dDepth.waterLevelY =
        next.atmosphere.waterLevelNorm && next.atmosphere.waterLevelNorm > 0
          ? Math.round(vp.height * next.atmosphere.waterLevelNorm)
          : undefined;
      this.snap.hd2dDepth.waterTint = next.atmosphere.waterTint ?? '#1e3a5f';
      this.snap.hd2dDepth.tiltShiftBlur = next.atmosphere.tiltShiftBlur ?? 0;
      this.snap.hd2dDepth.tiltShiftFocusY = next.atmosphere.tiltShiftFocusY ?? 0.52;
    }
    this.reset(preserveRoom);
  }

  public patchLiveProjection(patch: Partial<NonNullable<EcsProjectV2['projection']>>): void {
    const prev = this.project.projection ?? {
      mode: 'hd2d_iso' as const,
      elevationScale: 1.0,
      perspectiveSkew: 0.055,
      activeDimensionMask: 3,
      inactiveDimAlpha: 0.16,
      allowDimensionShift: false,
    };
    this.project = {
      ...this.project,
      projection: { ...prev, ...patch },
    };
    if (patch.activeDimensionMask !== undefined) {
      this.activeDimensionMask = patch.activeDimensionMask;
    }
  }

  private rebuildArenaTiles(): void {
    const tiles: TileDesc[] = [];
    if (this.project.atmosphere.gridLines) {
      const vp = this.snap.viewport!;
      const tileSize = 48;
      const maxY = this.project.rhythmTrack?.enabled
        ? Math.max(tileSize, this.project.rhythmTrack.yTop - 10)
        : vp.height;
      for (let y = 32; y < maxY; y += tileSize) {
        const h = Math.min(tileSize, maxY - y);
        for (let x = 0; x < vp.width; x += tileSize) {
          const w = Math.min(tileSize, vp.width - x);
          tiles.push({
            sprite: 'hd_arena_tile',
            x,
            y,
            w,
            h,
            alpha: 0.72,
            sortY: -100,
          });
        }
      }
    }
    this.snap.tiles = tiles;
  }

  public reset(preserveRoom = false): void {
    this.status = 'playing';
    this.score = 0;
    this.elapsedSec = 0;
    this.activeDimensionMask = this.project.projection?.activeDimensionMask ?? 3;
    this.prevShoulderR = false;
    this.fpYawRad = 0.04;
    this.fpViewerX = 56;
    this.fpViewerY = Math.round((this.snap.viewport?.height ?? 360) * 0.39);
    this.ambientSpawnAccum = 0;
    this.lightSparkAccum = 0;
    this.juice.reset();
    for (let i = 0; i < MAX_ECS_ENTITIES; i++) {
      this.squashActive[i] = 0;
      const sq = this.squashPool[i];
      sq.scaleX = 1;
      sq.scaleY = 1;
      sq.vx = 0;
      sq.vy = 0;
    }
    this.eventsOut.length = 0;
    for (let i = 0; i < MAX_POPUPS; i++) {
      this.popups[i].active = false;
    }
    const vp = this.snap.viewport!;
    if (this.project.worldMap && this.project.worldMap.rooms.length > 0) {
      this.worldMapCtrl.reloadProject(this.project, this.world, vp.width, vp.height, preserveRoom);
      this.syncWorldMapRoomSnap();
    } else {
      this.worldMapCtrl.reloadProject(this.project, this.world, vp.width, vp.height, false);
      this.snap.cameraX = 0;
      this.snap.cameraY = 0;
      this.rebuildArenaTiles();
      this.world.loadProject(this.project);
    }
    this.world.setGlobal('activeDimension', this.activeDimensionMask);
    this.vm.loadScripts(this.project.scripts);
    this.sysRenderSyncStats();
  }

  public retryStage(): void {
    this.reset();
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    return this.status;
  }

  public setDebugHitboxes(enabled: boolean): void {
    this.debugOverlay = enabled;
  }

  private spawnPopup(text: string, x: number, y: number, color: string): void {
    for (let i = 0; i < MAX_POPUPS; i++) {
      if (!this.popups[i].active) {
        const p = this.popups[i];
        p.active = true;
        p.text = text;
        p.x = x;
        p.y = y;
        p.timer = 0.75;
        p.color = color;
        return;
      }
    }
  }

  private triggerEntitySquash(handle: number, sx: number, sy: number): void {
    if (!handle) return;
    const idx = unpackEntityIndex(handle);
    if (idx < 0 || idx >= MAX_ECS_ENTITIES) return;
    triggerSquash(this.squashPool[idx], sx, sy);
    this.squashActive[idx] = 1;
  }

  private stepEntitySquashes(dt: number): void {
    for (let i = 0; i < MAX_ECS_ENTITIES; i++) {
      if (this.squashActive[i] === 0) continue;
      const sq = this.squashPool[i];
      stepSquashSpring(sq, dt, 14);
      if (
        Math.abs(sq.scaleX - 1) < 0.002 &&
        Math.abs(sq.scaleY - 1) < 0.002 &&
        Math.abs(sq.vx ?? 0) < 0.01 &&
        Math.abs(sq.vy ?? 0) < 0.01
      ) {
        sq.scaleX = 1;
        sq.scaleY = 1;
        sq.vx = 0;
        sq.vy = 0;
        this.squashActive[i] = 0;
      }
    }
  }

  private nextAmbientRand01(): number {
    // Fast deterministic xorshift32 (Zero-GC)
    let x = this.ambientSeed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.ambientSeed = x;
    return ((x >>> 0) & 0xffff) / 65536;
  }

  private stepAmbientParticles(dt: number): void {
    const theme = this.project.atmosphere.ambientParticles ?? 'none';
    const density = Math.max(0, Math.min(1, this.project.atmosphere.ambientParticleDensity ?? 0.55));
    const vp = this.snap.viewport!;
    const camX = this.worldMapCtrl.hasWorldMap() ? this.worldMapCtrl.cameraX : 0;
    const camY = this.worldMapCtrl.hasWorldMap() ? this.worldMapCtrl.cameraY : 0;

    if (theme !== 'none' && density > 0.01) {
      const rate = 2.5 + density * 9.5;
      this.ambientSpawnAccum += dt * rate;
      while (this.ambientSpawnAccum >= 1) {
        this.ambientSpawnAccum -= 1;
        const rx = camX + this.nextAmbientRand01() * vp.width;
        const ry = camY + this.nextAmbientRand01() * vp.height;
        if (theme === 'embers') {
          this.juice.spawnCurlStream(rx, ry, EMBER_COLORS, 1, {
            vx: (this.nextAmbientRand01() - 0.5) * 14,
            vy: -18 - this.nextAmbientRand01() * 20,
            spread: 6,
            curlStrength: 42,
            maxLife: 1.35 + this.nextAmbientRand01() * 0.9,
            size: 2.0 + this.nextAmbientRand01() * 1.4,
            additive: true,
          });
        } else if (theme === 'fireflies') {
          this.juice.spawnCurlStream(rx, ry, FIREFLY_COLORS, 1, {
            vx: (this.nextAmbientRand01() - 0.5) * 16,
            vy: (this.nextAmbientRand01() - 0.5) * 12,
            spread: 8,
            curlStrength: 68,
            maxLife: 1.8 + this.nextAmbientRand01() * 1.1,
            size: 2.2 + this.nextAmbientRand01() * 1.6,
            additive: true,
          });
        } else if (theme === 'snow') {
          this.juice.spawnCurlStream(rx, camY - 4, SNOW_COLORS, 1, {
            vx: -10 + this.nextAmbientRand01() * 20,
            vy: 26 + this.nextAmbientRand01() * 18,
            spread: 8,
            curlStrength: 34,
            maxLife: 3.4,
            size: 2.0 + this.nextAmbientRand01() * 1.2,
            additive: false,
          });
        } else {
          this.juice.spawnCurlStream(rx, ry, DUST_COLORS, 1, {
            vx: (this.nextAmbientRand01() - 0.5) * 8,
            vy: -4 + (this.nextAmbientRand01() - 0.5) * 6,
            spread: 6,
            curlStrength: 24,
            maxLife: 2.1,
            size: 1.8 + this.nextAmbientRand01() * 1.1,
            additive: false,
          });
        }
      }
    }

    // Subtle rising sparks from active LightSource entities (torches, braziers, glowing runes)
    if (theme === 'embers' || theme === 'fireflies') {
      this.lightSparkAccum += dt * (2.2 + density * 3.0);
      if (this.lightSparkAccum >= 1) {
        this.lightSparkAccum -= 1;
        const core = this.world.core;
        const c = core.components;
        const lightStore = core.getStore(c.LightSource);
        const lSize = lightStore.size();
        if (lSize > 0) {
          const pick = Math.floor(this.nextAmbientRand01() * lSize);
          const lh = lightStore.getDenseEntityAt(pick);
          const ltr = core.getComponent(lh, c.Transform2D);
          if (ltr) {
            const lx = ltr.x + ltr.w * 0.5;
            const ly = ltr.y + ltr.h * 0.3;
            this.juice.spawnCurlStream(lx, ly, theme === 'embers' ? EMBER_COLORS : FIREFLY_COLORS, 1, {
              vx: (this.nextAmbientRand01() - 0.5) * 10,
              vy: -16 - this.nextAmbientRand01() * 14,
              spread: 6,
              curlStrength: 38,
              maxLife: 0.75 + this.nextAmbientRand01() * 0.55,
              size: 1.8 + this.nextAmbientRand01() * 1.1,
              additive: true,
            });
          }
        }
      }
    }
  }

  public step(dt: number, input: InputState, _params: RuntimeParams): SimEvent[] {
    this.eventsOut.length = 0;
    const juiceScale = this.project.atmosphere.juiceScale ?? 1.0;
    const simDt = this.juice.advanceRealTime(dt, juiceScale);
    this.stepEntitySquashes(dt);
    this.stepAmbientParticles(dt);

    if (this.status !== 'playing') {
      if (input.action && !this.prevButtons.action) {
        this.reset();
      }
      this.syncPrevButtons(input);
      return this.eventsOut;
    }

    // True Hitstop freeze-frame: camera shake, flash, particles & squash springs stay alive while sim freezes
    if (simDt <= 0) {
      return this.eventsOut;
    }

    // Live parallel-realm dimension shift when enabled (shoulderR toggles Realm 1 <-> Realm 2)
    if (this.project.projection?.allowDimensionShift && input.shoulderR && !this.prevShoulderR) {
      this.activeDimensionMask = this.activeDimensionMask === 2 ? 1 : 2;
      this.world.setGlobal('activeDimension', this.activeDimensionMask);
      this.eventsOut.push('snap');
      this.vm.emitCustomEvent(this.activeDimensionMask === 2 ? 'dimension_shadow' : 'dimension_light');
    }

    // First-person 2.5D free-look yaw & forward/backward steering when in 1P projection mode
    if (this.project.projection?.mode === 'first_person_25d') {
      if (input.left) this.fpYawRad -= 2.1 * simDt;
      if (input.right) this.fpYawRad += 2.1 * simDt;
      const move = (input.up ? 1 : 0) - (input.down ? 1 : 0);
      if (move !== 0) {
        const vp = this.snap.viewport!;
        const nx = this.fpViewerX + Math.cos(this.fpYawRad) * move * 110 * simDt;
        const ny = this.fpViewerY + Math.sin(this.fpYawRad) * move * 110 * simDt;
        this.fpViewerX = Math.max(40, Math.min(vp.width - 40, nx));
        this.fpViewerY = Math.max(40, Math.min(vp.height - 40, ny));
      }
    }

    this.elapsedSec += simDt;
    this.vmCtx.input = input;
    this.vmCtx.dt = simDt;
    this.world.core.stepSystems(simDt);

    if (this.worldMapCtrl.hasWorldMap()) {
      const vp = this.snap.viewport!;
      this.worldMapCtrl.step(simDt, this.world, input, vp.width, vp.height, this.eventsOut, this.wmCallbacks);
      // Evaluate parameter-driven transitions immediately (dt=0 avoids double-stepping frame timers)
      this.sysAnimatorStateMachine(this.world.core, 0);
      this.syncWorldMapRoomSnap();
    }

    this.syncPrevButtons(input);
    return this.eventsOut;
  }

  private syncPrevButtons(input: InputState): void {
    this.prevButtons.action = input.action;
    this.prevButtons.jump = input.jump;
    this.prevButtons.menu = input.skillY;
    this.prevButtons.skill = input.skillX;
    this.prevButtons.left = input.left;
    this.prevButtons.right = input.right;
    this.prevButtons.up = input.up;
    this.prevButtons.down = input.down;
    this.prevShoulderR = input.shoulderR;
  }

  public snapshot(_params: RuntimeParams, alpha = 1): RenderSceneSnapshot {
    const st = this.projFrameState;
    st.project = this.project;
    st.activeDimensionMask = this.activeDimensionMask;
    st.debugOverlay = this.debugOverlay;
    st.elapsedSec = this.elapsedSec;
    st.fpYawRad = this.fpYawRad;
    st.fpViewerX = this.fpViewerX;
    st.fpViewerY = this.fpViewerY;
    st.alpha = alpha;
    return this.projector.project(this.snap, st);
  }
}
