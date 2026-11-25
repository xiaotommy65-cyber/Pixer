import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { SeededRng } from '../runtime/SeededRng.ts';
import {
  AnimationStateMachineRuntime,
  type AnimationStateMachineDef,
  type AnimationStepResult,
} from '../sim/AnimationStateMachine.ts';
import type { TilemapGrid } from '../sim/TilemapGrid.ts';
import { ECS_VAR_SLOTS, MAX_VERLET_NODES } from './ComponentStore.ts';
import { EcsCoreWorld } from './EcsCoreWorld.ts';
import { INVALID_ENTITY, type EntityHandle } from './EntityManager.ts';
import {
  resolveEntityComponents,
  type EcsComponentBundle,
  type EcsEntityInitDef,
  type EcsPrefabDef,
  type EcsProjectV2,
  type EcsWaypoint,
} from './EcsProjectSchema.ts';
import type { EcsModel3DDef } from './EcsModel3D.ts';

export const MAX_ECS_ENTITIES = 2048;
export { ECS_VAR_SLOTS };

export interface EcsEntityInspection {
  handle: EntityHandle;
  entityId: string;
  name: string;
  tag: string;
  mask: number;
  components: string[];
  x: number;
  y: number;
  z: number;
  dimensionMask: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  sprite: SpriteId;
  roughness: number;
  metallic: number;
  emissive: number;
  scripts: string[];
}

/**
 * High-level Pixer 8.0 ECS World facade backed 100% by `EcsCoreWorld`
 * (generational ABA-safe `EntityHandle`s + `SparseSetComponentStore<T>` + archetype bitmasks).
 * 100% DOM-free and Zero-GC during 60Hz system execution.
 */
export class EcsWorld {
  public readonly core: EcsCoreWorld;
  public readonly globals = new Map<string, number>();
  public readonly paths = new Map<string, EcsWaypoint[]>();
  public readonly animDefs = new Map<string, AnimationStateMachineDef>();
  public readonly prefabs = new Map<string, EcsPrefabDef>();
  public readonly models3d = new Map<string, EcsModel3DDef>();
  public readonly rng = new SeededRng(7001);
  public tilemap: TilemapGrid | null = null;
  public readonly animStepOut: AnimationStepResult = {
    spriteId: 'solid',
    stateName: '',
    frameIndex: 0,
    emittedEvent: null,
    finished: false,
  };

  private nextAutoId = 1;

  constructor(maxEntities = MAX_ECS_ENTITIES) {
    this.core = new EcsCoreWorld(maxEntities);
    this.clear();
  }

  public get activeCount(): number {
    return this.core.entities.getAliveCount();
  }

  public clear(): void {
    this.core.clear();
    this.globals.clear();
    this.paths.clear();
    this.animDefs.clear();
    this.prefabs.clear();
    this.models3d.clear();
    this.tilemap = null;
    this.nextAutoId = 1;
    this.rng.reset(7001);
  }

  public loadProject(project: EcsProjectV2): void {
    this.clear();
    for (const [k, v] of Object.entries(project.globals)) {
      this.globals.set(k, v);
    }
    for (const [k, pts] of Object.entries(project.paths)) {
      this.paths.set(k, pts);
    }
    for (let i = 0; i < project.animations.length; i++) {
      this.animDefs.set(project.animations[i].id, project.animations[i]);
    }
    for (const [k, pref] of Object.entries(project.prefabs)) {
      this.prefabs.set(k, pref);
    }
    if (project.models3d) {
      for (const [k, m3d] of Object.entries(project.models3d)) {
        this.models3d.set(k, m3d);
      }
    }
    for (let i = 0; i < project.entities.length; i++) {
      this.spawnEntityInit(project.entities[i]);
    }
  }

  public spawnEntityInit(init: EcsEntityInitDef): EntityHandle {
    const merged = resolveEntityComponents(init, this.prefabs);
    return this.spawnBundle(init.id, init.name, merged);
  }

  public spawnFromPrefab(
    prefabId: string,
    x: number,
    y: number,
    overrideLane?: number,
  ): EntityHandle {
    const prefab = this.prefabs.get(prefabId);
    if (!prefab) return INVALID_ENTITY;
    const handle = this.spawnBundle(`ent_${this.nextAutoId++}`, prefab.name, prefab.components);
    if (handle === INVALID_ENTITY) return INVALID_ENTITY;
    const tr = this.core.getComponent(handle, this.core.components.Transform2D);
    if (tr) {
      tr.x = x;
      tr.y = y;
      tr.prevX = x;
      tr.prevY = y;
    }
    if (overrideLane !== undefined) {
      const rl = this.core.getComponent(handle, this.core.components.RhythmLane);
      if (rl) rl.laneIndex = overrideLane;
    }
    return handle;
  }

  public spawnBundle(id: string, name: string, bundle: EcsComponentBundle): EntityHandle {
    if (this.core.entities.getAliveCount() >= this.core.entities.capacity) {
      return INVALID_ENTITY;
    }
    const c = this.core.components;
    const handle = this.core.createEntity(name);

    this.core.addComponent(handle, c.Tag, {
      entityId: id,
      tag: bundle.tag ?? '',
      label: name,
    });

    const tr = bundle.transform;
    this.core.addComponent(handle, c.Transform2D, {
      x: tr.x,
      y: tr.y,
      prevX: tr.x,
      prevY: tr.y,
      w: tr.w ?? 16,
      h: tr.h ?? 16,
      rot: tr.rot ?? 0,
      scaleX: tr.scaleX ?? 1,
      scaleY: tr.scaleY ?? 1,
      zOrder: tr.zOrder ?? 0,
    });

    if (bundle.body2d) {
      this.core.addComponent(handle, c.Velocity2D, {
        vx: bundle.body2d.vx ?? 0,
        vy: bundle.body2d.vy ?? 0,
        gravityScale: bundle.body2d.gravityScale ?? 0,
        drag: bundle.body2d.drag ?? 0,
      });
    }

    if (bundle.sprite) {
      this.core.addComponent(handle, c.Material, {
        spriteId: bundle.sprite.sprite,
        tint: bundle.sprite.tint ?? '#ffffff',
        alpha: bundle.sprite.alpha ?? 1,
        paletteRow: bundle.sprite.paletteRow ?? 0,
        flipX: Boolean(bundle.sprite.flipX),
        castShadow: Boolean(bundle.sprite.castShadow),
        roughness: bundle.sprite.roughness ?? 0.45,
        metallic: bundle.sprite.metallic ?? 0.15,
        emissive: bundle.sprite.emissive ?? 0,
        normalStrength: 1.0,
      });
    }

    if (bundle.animatorId) {
      const animDef = this.animDefs.get(bundle.animatorId);
      if (animDef) {
        this.core.addComponent(handle, c.Animator, {
          animatorId: bundle.animatorId,
          runtime: new AnimationStateMachineRuntime(animDef),
        });
      }
    }

    if (bundle.health) {
      this.core.addComponent(handle, c.Health, {
        hp: bundle.health.hp,
        maxHp: bundle.health.maxHp ?? bundle.health.hp,
        team: bundle.health.team,
        hitFlash: 0,
      });
    }

    if (bundle.pathFollower) {
      this.core.addComponent(handle, c.PathFollower, {
        pathKey: bundle.pathFollower.pathId,
        waypointIdx: 0,
        speed: bundle.pathFollower.speed,
        loop: Boolean(bundle.pathFollower.loop),
      });
    }

    if (bundle.light) {
      this.core.addComponent(handle, c.LightSource, {
        radius: bundle.light.radius,
        color: bundle.light.color,
        intensity: bundle.light.intensity ?? 0.9,
        falloffPower: bundle.light.falloffPower ?? 1.8,
      });
    }

    if (bundle.collider) {
      this.core.addComponent(handle, c.Collider, {
        radius: bundle.collider.radius,
        isProjectile: Boolean(bundle.collider.isProjectile),
        isSolid: Boolean(bundle.collider.isSolid),
        damage: bundle.collider.damage ?? 1,
        hitTag: bundle.collider.hitTag ?? '',
      });
    }

    if (bundle.rhythmLane) {
      this.core.addComponent(handle, c.RhythmLane, {
        laneIndex: bundle.rhythmLane.lane,
        judgeX: bundle.rhythmLane.judgeX,
        judgeWindow: bundle.rhythmLane.windowPx ?? 28,
      });
    }

    if (bundle.characterMotor2d) {
      if (!bundle.body2d) {
        this.core.addComponent(handle, c.Velocity2D, {
          vx: 0,
          vy: 0,
          gravityScale: 0,
          drag: 0,
        });
      }
      const m = bundle.characterMotor2d;
      this.core.addComponent(handle, c.CharacterMotor2D, {
        moveSpeed: m.moveSpeed ?? 150,
        accel: m.accel ?? 1200,
        airControl: m.airControl ?? 0.65,
        gravity: m.gravity ?? 720,
        maxFallSpeed: m.maxFallSpeed ?? 420,
        jumpVelocity: m.jumpVelocity ?? 290,
        coyoteTimeSec: m.coyoteTimeSec ?? 0.12,
        jumpBufferSec: m.jumpBufferSec ?? 0.12,
        dashSpeed: m.dashSpeed ?? 340,
        dashDurationSec: m.dashDurationSec ?? 0.14,
        dashCooldownSec: m.dashCooldownSec ?? 0.55,
        floorY: m.floorY ?? 0,
      });
    }

    if (bundle.grappleAnchor) {
      const g = bundle.grappleAnchor;
      this.core.addComponent(handle, c.GrappleAnchor, {
        anchorRadius: g.anchorRadius ?? 150,
        swingTension: g.swingTension ?? 0.98,
        reelSpeed: g.reelSpeed ?? 96,
        minLength: g.minLength ?? 24,
        enabled: g.enabled !== false,
      });
    }

    if (bundle.triggerZone) {
      const tz = bundle.triggerZone;
      this.core.addComponent(handle, c.TriggerZone, {
        shape: tz.shape ?? 'circle',
        radius: tz.radius ?? 36,
        width: tz.width ?? 48,
        height: tz.height ?? 48,
        filterTag: tz.filterTag ?? '',
        onEnterEvent: tz.onEnterEvent ?? 'zone_enter',
        onStayEvent: tz.onStayEvent ?? '',
        onExitEvent: tz.onExitEvent ?? 'zone_exit',
        oneShot: Boolean(tz.oneShot),
        cooldownSec: tz.cooldownSec ?? 0,
      });
    }

    if (bundle.verletChain) {
      const vc = bundle.verletChain;
      this.core.addComponent(handle, c.VerletChain, {
        nodeCount: Math.max(2, Math.min(MAX_VERLET_NODES, Math.round(vc.nodeCount ?? 6))),
        segmentLength: vc.segmentLength ?? 10,
        gravity: vc.gravity ?? 420,
        damping: vc.damping ?? 0.96,
        iterations: vc.iterations ?? 4,
        pinStart: vc.pinStart !== false,
        attachOffsetX: vc.attachOffsetX ?? 0,
        attachOffsetY: vc.attachOffsetY ?? 6,
        color: vc.color ?? '#f59e0b',
        thickness: vc.thickness ?? 2,
      });
    }

    if (bundle.spatial3d) {
      const sp = bundle.spatial3d;
      const initZ = sp.z ?? 0;
      this.core.addComponent(handle, c.Spatial3D, {
        z: initZ,
        prevZ: initZ,
        vz: sp.vz ?? 0,
        height: Math.max(1, sp.height ?? 16),
        groundZ: sp.groundZ ?? 0,
        gravityZ: Math.max(0, sp.gravityZ ?? 0),
        jumpZVelocity: Math.max(0, sp.jumpZVelocity ?? 190),
        dimensionMask: sp.dimensionMask !== undefined ? Math.max(1, Math.round(sp.dimensionMask)) : 1,
        shadowScale: Math.max(0.2, sp.shadowScale ?? 1),
        yaw: typeof sp.yaw === 'number' && Number.isFinite(sp.yaw) ? sp.yaw : 0,
        pitch: typeof sp.pitch === 'number' && Number.isFinite(sp.pitch) ? sp.pitch : 0,
        roll: typeof sp.roll === 'number' && Number.isFinite(sp.roll) ? sp.roll : 0,
        depth: Math.max(1, typeof sp.depth === 'number' && Number.isFinite(sp.depth) ? sp.depth : (tr.h ?? 16)),
        stepHeight: Math.max(0, typeof sp.stepHeight === 'number' && Number.isFinite(sp.stepHeight) ? sp.stepHeight : 10),
        ceilingZ: typeof sp.ceilingZ === 'number' && Number.isFinite(sp.ceilingZ) ? sp.ceilingZ : 9999,
        slopeNormalX: 0,
        slopeNormalY: 0,
        slopeNormalZ: 1,
      });
    }

    if (bundle.mesh3d) {
      const m3 = bundle.mesh3d;
      this.core.addComponent(handle, c.MeshRenderer3D, {
        modelId: m3.modelId ?? '',
        scaleX: m3.scaleX ?? 1,
        scaleY: m3.scaleY ?? 1,
        scaleZ: m3.scaleZ ?? 1,
        animClip: m3.animClip ?? '',
        animTime: 0,
        castShadow: m3.castShadow !== false,
        billboardYawMode: m3.billboardYawMode ?? 'fixed',
      });
    }

    if (bundle.lifetime !== undefined && bundle.lifetime > 0) {
      this.core.addComponent(handle, c.Lifetime, {
        remainingSec: bundle.lifetime,
      });
    }

    if ((bundle.scripts && bundle.scripts.length > 0) || (bundle.vars && bundle.vars.length > 0)) {
      const vars = new Float32Array(ECS_VAR_SLOTS);
      if (bundle.vars) {
        const len = Math.min(ECS_VAR_SLOTS, bundle.vars.length);
        for (let i = 0; i < len; i++) vars[i] = bundle.vars[i];
      }
      this.core.addComponent(handle, c.ScriptAgent, {
        scriptRefs: bundle.scripts ? [...bundle.scripts] : [],
        vars,
        targetHandle: INVALID_ENTITY,
        cooldown: 0,
        timerAccum: 0,
        started: false,
      });
    }

    return handle;
  }

  public destroy(handle: EntityHandle): boolean {
    return this.core.destroyEntity(handle);
  }

  public isAlive(handle: EntityHandle): boolean {
    return this.core.entities.isAlive(handle);
  }

  public findNearestByTag(fromHandle: EntityHandle, tag: string, maxRange: number): EntityHandle {
    const c = this.core.components;
    const fromTr = this.core.getComponent(fromHandle, c.Transform2D);
    if (!fromTr) return INVALID_ENTITY;

    const fx = fromTr.x;
    const fy = fromTr.y;
    const maxSq = maxRange * maxRange;
    let bestHandle: EntityHandle = INVALID_ENTITY;
    let bestSq = maxSq;

    const tagStore = this.core.getStore(c.Tag);
    const count = tagStore.size();
    for (let i = 0; i < count; i++) {
      const h = tagStore.getDenseEntityAt(i);
      if (h === fromHandle) continue;
      const tagData = tagStore.getDenseDataAt(i);
      if (tagData.tag !== tag) continue;
      const tr = this.core.getComponent(h, c.Transform2D);
      if (!tr) continue;
      const dx = tr.x - fx;
      const dy = tr.y - fy;
      const sq = dx * dx + dy * dy;
      if (sq <= bestSq) {
        bestSq = sq;
        bestHandle = h;
      }
    }
    return bestHandle;
  }

  public getGlobal(key: string): number {
    return this.globals.get(key) ?? 0;
  }

  public setGlobal(key: string, value: number): void {
    this.globals.set(key, value);
  }

  public getSystemPipeline(): string[] {
    return this.core.listSystemIds();
  }

  public inspectEntities(): EcsEntityInspection[] {
    const out: EcsEntityInspection[] = [];
    const c = this.core.components;
    const alive = this.core.entities.getAliveCount();
    for (let i = 0; i < alive; i++) {
      const h = this.core.entities.getAliveHandleAt(i);
      const tr = this.core.getComponent(h, c.Transform2D);
      if (!tr) continue;
      const tag = this.core.getComponent(h, c.Tag);
      const vel = this.core.getComponent(h, c.Velocity2D);
      const mat = this.core.getComponent(h, c.Material);
      const hp = this.core.getComponent(h, c.Health);
      const sp = this.core.getComponent(h, c.Spatial3D);
      const agent = this.core.getComponent(h, c.ScriptAgent);
      const m = this.core.getEntityMask(h);

      const comps: string[] = ['Transform2D'];
      if (vel) comps.push('Velocity2D');
      if (mat) comps.push('Material');
      if (this.core.hasComponent(h, c.Animator)) comps.push('Animator');
      if (hp) comps.push('Health');
      if (this.core.hasComponent(h, c.PathFollower)) comps.push('PathFollower');
      if (this.core.hasComponent(h, c.LightSource)) comps.push('LightSource');
      if (this.core.hasComponent(h, c.Collider)) comps.push('Collider');
      if (this.core.hasComponent(h, c.RhythmLane)) comps.push('RhythmLane');
      if (this.core.hasComponent(h, c.CharacterMotor2D)) comps.push('CharacterMotor2D');
      if (this.core.hasComponent(h, c.GrappleAnchor)) comps.push('GrappleAnchor');
      if (this.core.hasComponent(h, c.TriggerZone)) comps.push('TriggerZone');
      if (this.core.hasComponent(h, c.VerletChain)) comps.push('VerletChain');
      if (sp) comps.push('Spatial3D');
      if (this.core.hasComponent(h, c.MeshRenderer3D)) comps.push('MeshRenderer3D');
      if (agent) comps.push('ScriptAgent');
      if (this.core.hasComponent(h, c.Lifetime)) comps.push('Lifetime');

      out.push({
        handle: h,
        entityId: tag?.entityId ?? '',
        name: tag?.label || this.core.entities.getName(h),
        tag: tag?.tag ?? '',
        mask: m,
        components: comps,
        x: Math.round(tr.x * 10) / 10,
        y: Math.round(tr.y * 10) / 10,
        z: sp ? Math.round(sp.z * 10) / 10 : 0,
        dimensionMask: sp ? sp.dimensionMask : 3,
        w: tr.w,
        h: tr.h,
        vx: vel ? Math.round(vel.vx * 10) / 10 : 0,
        vy: vel ? Math.round(vel.vy * 10) / 10 : 0,
        hp: hp?.hp ?? 0,
        maxHp: hp?.maxHp ?? 0,
        sprite: mat?.spriteId ?? 'solid',
        roughness: mat?.roughness ?? 0.45,
        metallic: mat?.metallic ?? 0.15,
        emissive: mat?.emissive ?? 0,
        scripts: agent ? [...agent.scriptRefs] : [],
      });
    }
    return out;
  }
}
