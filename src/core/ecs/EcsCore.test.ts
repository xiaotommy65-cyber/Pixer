import test from 'node:test';
import assert from 'node:assert/strict';
import { TextureAtlas } from '../../assets/TextureAtlas.ts';
import { buildHdMaterialSprites } from '../../assets/sprites/HdMaterialSprites.ts';
import { EcsCartridgeRuntime } from './EcsCartridgeRuntime.ts';
import {
  countEntityOverrides,
  getEntityPrefabId,
  resolveEntityComponents,
  type EcsProjectV2,
} from './EcsProjectSchema.ts';
import { runScriptedPlaytest } from '../ai/EcsPlaytestVerifier.ts';
import { analyzeActionReachability, observeSceneSemantics } from '../ai/EcsSpatialOracle.ts';
import { PixerMcpSession } from '../ai/PixerMcpProtocol.ts';
import { EcsStudioSession } from './EcsStudioSession.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../types/WorldTypes.ts';
import {
  addEventGraphNode,
  compileEventGraphToScript,
  compileScriptToEventGraph,
  connectEventGraphNodes,
  disconnectEventGraphEdge,
  moveEventGraphNode,
  EcsCoreWorld,
  EntityManager,
  INVALID_ENTITY,
  unpackEntityGeneration,
  unpackEntityIndex,
} from './index.ts';

function makeActionFixture(
  entities: EcsProjectV2['entities'],
  scripts: EcsProjectV2['scripts'] = {},
  globals: Record<string, number> = {},
): EcsProjectV2 {
  return {
    schemaVersion: 2,
    meta: {
      id: 'rhythm-bastion',
      code: 'PA-99',
      title: 'ECS Action Physics Fixture',
      subtitle: 'Batch 9.1 Oracle',
      genre: 'ECS',
      accentHex: '#60a5fa',
      controlsHint: 'Test',
      goalHint: 'Test',
    },
    viewport: { width: 640, height: 360, preset: 'hd_plus' },
    atmosphere: {
      skyTop: '#0f172a',
      skyBottom: '#1e293b',
      ambientDarkness: 0.2,
      gridLines: false,
    },
    paths: {},
    animations: [],
    prefabs: {},
    scripts,
    globals,
    hud: [],
    entities,
  };
}

test('EntityManager generational handles prevent ABA stale handle bugs', () => {
  const em = new EntityManager(64);
  const a = em.create('hero');
  const b = em.create('turret');
  assert.equal(em.isAlive(a), true);
  assert.equal(em.isAlive(b), true);
  assert.equal(em.getAliveCount(), 2);

  const idxA = unpackEntityIndex(a);
  const genA = unpackEntityGeneration(a);
  assert.equal(em.destroy(a), true);
  assert.equal(em.isAlive(a), false);
  assert.equal(em.destroy(a), false);
  assert.equal(em.isAlive(INVALID_ENTITY), false);

  // Reallocating freed slot MUST increment generation so old handle `a` remains invalid
  const a2 = em.create('hero_respawn');
  assert.equal(unpackEntityIndex(a2), idxA);
  assert.equal(unpackEntityGeneration(a2), genA + 1);
  assert.equal(em.isAlive(a2), true);
  assert.equal(em.isAlive(a), false);
  assert.equal(em.getName(a2), 'hero_respawn');
});

test('EcsCoreWorld manages sparse-set components, archetype queries, and phase-ordered systems', () => {
  const world = new EcsCoreWorld(128);
  const { Transform2D, Velocity2D, Material, Health } = world.components;

  const moving = world.createEntity('projectile');
  world.addComponent(moving, Transform2D, { x: 10, y: 20, w: 16, h: 16 });
  world.addComponent(moving, Velocity2D, { vx: 100, vy: -50 });
  world.addComponent(moving, Material, { spriteId: 'hd_star_bolt', metallic: 0.85, roughness: 0.15 });

  const staticTower = world.createEntity('tower');
  world.addComponent(staticTower, Transform2D, { x: 100, y: 100, w: 34, h: 34 });
  world.addComponent(staticTower, Material, { spriteId: 'hd_turret_solar', metallic: 0.7 });
  world.addComponent(staticTower, Health, { hp: 50, maxHp: 50 });

  const order: string[] = [];
  world.registerSystem({
    id: 'render_sync',
    phase: 'render',
    execute: () => order.push('render'),
  });
  world.registerSystem({
    id: 'physics_integrate',
    phase: 'physics',
    execute: (w, dt) => {
      order.push('physics');
      const mask = w.buildMask(Transform2D, Velocity2D);
      w.queryMask(mask, (h) => {
        const tr = w.getComponent(h, Transform2D)!;
        const vel = w.getComponent(h, Velocity2D)!;
        tr.x += vel.vx * dt;
        tr.y += vel.vy * dt;
      });
    },
  });
  world.registerSystem({
    id: 'input_poll',
    phase: 'input',
    execute: () => order.push('input'),
  });

  world.stepSystems(0.5);
  assert.deepEqual(order, ['input', 'physics', 'render']);

  const trMoving = world.getComponent(moving, Transform2D)!;
  assert.equal(trMoving.x, 60);
  assert.equal(trMoving.y, -5);

  // Exclude-mask query finds only entities with Material but WITHOUT Health
  const matNoHealth: number[] = [];
  world.queryMask(Material.mask, (h) => matNoHealth.push(h), Health.mask);
  assert.deepEqual(matNoHealth, [moving]);

  // Destroying entity cleanly reclaims all attached component stores
  assert.equal(world.destroyEntity(moving), true);
  assert.equal(world.getStore(Velocity2D).size(), 0);
  assert.equal(world.getStore(Material).size(), 1);
});

test('HD 64x64 procedural material sprites register cleanly into TextureAtlas RGBA slots and spill to extra pages', () => {
  const assets = buildHdMaterialSprites();
  assert.ok(assets.length >= 9);
  const atlas = new TextureAtlas();
  for (const a of assets) {
    assert.equal(atlas.hasSprite(a.id), true, `Missing HD sprite ${a.id} in TextureAtlas`);
    const rect = atlas.getRect(a.id);
    assert.equal(rect.w, a.width);
    assert.equal(rect.h, a.height);
  }
  const big = new Uint8Array(256 * 256 * 4);
  big.fill(255);
  for (let i = 0; i < 16; i++) {
    atlas.registerDynamicRgbaSprite(`unit_spill_${i}`, 256, 256, big);
  }
  const extra = atlas.getExtraPages();
  assert.ok(extra.length >= 1, 'TextureAtlas should export extra pages for Texture2DArray upload');
  assert.equal(extra[0].pixels.length, 1024 * 1024 * 4);
  assert.equal(extra[0].indexPixels.length, 1024 * 1024);
});

test('EcsCartridgeRuntime runs 5-phase EcsCoreWorld pipeline and projects PBR materials', () => {
  const fixture = makeActionFixture([
    {
      id: 'pbr_turret',
      name: 'PBR Turret',
      components: {
        transform: { x: 120, y: 140, w: 32, h: 32 },
        sprite: { sprite: 'hd_turret_solar', metallic: 0.88, roughness: 0.16, emissive: 0.6 },
        light: { color: '#38bdf8', radius: 96, intensity: 0.9 },
        tag: 'turret',
      },
    },
  ]);

  const rt = new EcsCartridgeRuntime(fixture);
  const pipeline = rt.world.getSystemPipeline();
  assert.ok(pipeline.length >= 13, `Expected >= 13 ECS systems, got ${pipeline.length}`);
  assert.equal(pipeline[0], 'input:capture_prev_transform');
  assert.equal(pipeline[1], 'script:sandbox_script_vm');
  assert.ok(pipeline.includes('physics:character_motor_2d'));
  assert.ok(pipeline.includes('physics:grapple_pendulum'));
  assert.ok(pipeline.includes('physics:trigger_zone_sensor'));
  assert.ok(pipeline.includes('fixed:verlet_chain_solver'));
  assert.equal(pipeline[pipeline.length - 1], 'render:render_sync_stats');

  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const metallicTurret = snap.entities.find((e) => e.sprite === 'hd_turret_solar');
  assert.ok(metallicTurret, 'Expected hd_turret_solar entity in snapshot');
  assert.equal(metallicTurret.metallic, 0.88);
  assert.equal(metallicTurret.roughness, 0.16);
  assert.equal(metallicTurret.emissive, 0.6);
  assert.equal(snap.lights?.length, 1);
});

test('CharacterMotor2D physics oracle verifies coyote jump, jump buffer, air control, and dash cooldown', () => {
  const fixture = makeActionFixture([
    {
      id: 'ledge',
      name: 'Solid Ledge',
      components: {
        transform: { x: 40, y: 160, w: 80, h: 16 },
        collider: { radius: 8, isSolid: true },
        tag: 'solid',
      },
    },
    {
      id: 'hero',
      name: 'Action Hero',
      components: {
        transform: { x: 100, y: 140, w: 16, h: 16 },
        characterMotor2d: {
          moveSpeed: 180,
          accel: 1800,
          airControl: 0.6,
          gravity: 720,
          maxFallSpeed: 420,
          jumpVelocity: 280,
          coyoteTimeSec: 0.12,
          jumpBufferSec: 0.12,
          dashSpeed: 360,
          dashDurationSec: 0.12,
          dashCooldownSec: 0.5,
          floorY: 300,
        },
        tag: 'hero',
      },
    },
  ]);

  const rt = new EcsCartridgeRuntime(fixture);
  const core = rt.world.core;
  const c = core.components;
  const heroH = core.getStore(c.CharacterMotor2D).getDenseEntityAt(0);
  const tr = core.getComponent(heroH, c.Transform2D)!;
  const vel = core.getComponent(heroH, c.Velocity2D)!;
  const motor = core.getComponent(heroH, c.CharacterMotor2D)!;

  // Settle onto solid ledge
  const idle = createEmptyInputState();
  for (let i = 0; i < 15; i++) rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);
  assert.equal(motor.grounded, true);
  assert.equal(tr.y + tr.h, 160);

  // Walk right off ledge until airborne
  const runRight = { ...createEmptyInputState(), right: true };
  let airFrames = 0;
  for (let i = 0; i < 30; i++) {
    rt.step(1 / 60, runRight, DEFAULT_RUNTIME_PARAMS);
    if (!motor.grounded) {
      airFrames++;
      if (airFrames === 3) break; // 3 frames (~0.05s) < coyoteTimeSec (0.12s)
    }
  }
  assert.equal(motor.grounded, false);
  assert.ok(motor.coyoteTimer > 0, 'Coyote timer must remain positive right after walking off ledge');

  // Coyote jump must fire even though hero is airborne
  const coyoteEvents = rt.step(1 / 60, { ...createEmptyInputState(), jump: true }, DEFAULT_RUNTIME_PARAMS);
  assert.ok(coyoteEvents.includes('jump'), 'Coyote jump should emit jump event');
  assert.ok(vel.vy < -200, `Coyote jump should launch upward (got vy=${vel.vy})`);

  // Let hero fall toward floorY=300 and press jump 3 frames BEFORE touchdown (jump buffer test)
  rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);
  for (let i = 0; i < 80; i++) {
    rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);
    if (vel.vy > 0 && 300 - (tr.y + tr.h) < 16) break;
  }
  assert.equal(motor.grounded, false);
  const preLandEvents = rt.step(1 / 60, { ...createEmptyInputState(), jump: true }, DEFAULT_RUNTIME_PARAMS);
  let bufferedFired = preLandEvents.includes('jump');
  for (let i = 0; i < 8 && !bufferedFired; i++) {
    const evs = rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);
    if (evs.includes('jump')) bufferedFired = true;
  }
  assert.equal(bufferedFired, true, 'Jump buffer must trigger automatically upon touchdown');

  // Dash with cooldown
  const dashEvents = rt.step(1 / 60, { ...createEmptyInputState(), right: true, skillX: true }, DEFAULT_RUNTIME_PARAMS);
  assert.ok(dashEvents.includes('ignite'), 'Dash input should emit ignite event');
  assert.ok(vel.vx >= 350, `Dash should accelerate hero to dashSpeed (got vx=${vel.vx})`);
  assert.ok(motor.dashCooldownTimer > 0.4);
  // Immediate second dash must be blocked by cooldown
  rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);
  const blockedDash = rt.step(1 / 60, { ...createEmptyInputState(), skillX: true }, DEFAULT_RUNTIME_PARAMS);
  assert.equal(blockedDash.includes('ignite'), false, 'Dash must respect dashCooldownSec');
});

test('GrappleAnchor pendulum solver constrains rope radius, preserves swing momentum, and supports reeling', () => {
  const fixture = makeActionFixture([
    {
      id: 'anchor',
      name: 'Grapple Anchor',
      components: {
        transform: { x: 200, y: 60, w: 12, h: 12 },
        grappleAnchor: {
          anchorRadius: 140,
          swingTension: 1.0,
          reelSpeed: 96,
          minLength: 24,
          enabled: true,
        },
        tag: 'anchor',
      },
    },
    {
      id: 'hero',
      name: 'Swinger',
      components: {
        transform: { x: 280, y: 60, w: 12, h: 12 },
        characterMotor2d: {
          gravity: 640,
          maxFallSpeed: 500,
          floorY: 340,
        },
        tag: 'hero',
      },
    },
  ]);

  const rt = new EcsCartridgeRuntime(fixture);
  const core = rt.world.core;
  const c = core.components;
  const heroH = core.getStore(c.CharacterMotor2D).getDenseEntityAt(0);
  const anchorH = core.getStore(c.GrappleAnchor).getDenseEntityAt(0);
  const heroTr = core.getComponent(heroH, c.Transform2D)!;
  const anchorTr = core.getComponent(anchorH, c.Transform2D)!;
  const heroVel = core.getComponent(heroH, c.Velocity2D)!;
  const motor = core.getComponent(heroH, c.CharacterMotor2D)!;
  const anchor = core.getComponent(anchorH, c.GrappleAnchor)!;

  // Latch on frame 0 by holding action
  const holdGrapple = { ...createEmptyInputState(), action: true };
  const latchEvents = rt.step(1 / 60, holdGrapple, DEFAULT_RUNTIME_PARAMS);
  assert.ok(latchEvents.includes('snap'));
  assert.equal(motor.grappleHandle, anchorH);
  assert.equal(anchor.activeTargetHandle, heroH);

  const initialLen = motor.grappleLength;
  assert.ok(initialLen >= 75 && initialLen <= 85, `Expected initial rope length ~80px (got ${initialLen})`);

  let crossedLeftOfAnchor = false;
  let maxRadiusErr = 0;
  let maxSpeed = 0;
  for (let i = 0; i < 65; i++) {
    rt.step(1 / 60, holdGrapple, DEFAULT_RUNTIME_PARAMS);
    const hx = heroTr.x + heroTr.w * 0.5;
    const hy = heroTr.y + heroTr.h * 0.5;
    const ax = anchorTr.x + anchorTr.w * 0.5;
    const ay = anchorTr.y + anchorTr.h * 0.5;
    const dist = Math.hypot(hx - ax, hy - ay);
    maxRadiusErr = Math.max(maxRadiusErr, dist - initialLen);
    const spd = Math.hypot(heroVel.vx, heroVel.vy);
    assert.ok(Number.isFinite(spd), 'Pendulum velocity must stay finite');
    maxSpeed = Math.max(maxSpeed, spd);
    if (hx < ax - 15) crossedLeftOfAnchor = true;
  }
  assert.ok(maxRadiusErr <= 0.5, `Pendulum must clamp rope distance <= L (max overshoot ${maxRadiusErr})`);
  assert.equal(crossedLeftOfAnchor, true, 'Pendulum must swing through bottom to opposite side of anchor');
  // Theoretical max speed at bottom sqrt(2 * g * L) ~ sqrt(2 * 640 * 80) = 320 px/s
  assert.ok(maxSpeed > 180 && maxSpeed < 360, `Pendulum speed must stay physically conserved (maxSpeed=${maxSpeed})`);

  // Reel in while holding up + action
  const reelIn = { ...createEmptyInputState(), action: true, up: true };
  for (let i = 0; i < 20; i++) rt.step(1 / 60, reelIn, DEFAULT_RUNTIME_PARAMS);
  assert.ok(motor.grappleLength < initialLen - 20, 'Holding up while grappling must reel rope shorter');

  // Releasing action must cleanly detach both motor and anchor
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  assert.equal(motor.grappleHandle, INVALID_ENTITY);
  assert.equal(anchor.activeTargetHandle, INVALID_ENTITY);
});

test('TriggerZone uses SpatialHash broad-phase to emit enter/exit VM events with filterTag and oneShot', () => {
  const fixture = makeActionFixture(
    [
      {
        id: 'runner',
        name: 'Runner',
        components: {
          transform: { x: 40, y: 100, w: 16, h: 16 },
          body2d: { vx: 120, vy: 0 },
          tag: 'hero',
        },
      },
      {
        id: 'zone_repeat',
        name: 'Checkpoint Zone',
        components: {
          transform: { x: 100, y: 100, w: 24, h: 24 },
          triggerZone: {
            shape: 'rect',
            width: 32,
            height: 32,
            filterTag: 'hero',
            onEnterEvent: 'cp_enter',
            onExitEvent: 'cp_exit',
            oneShot: false,
          },
          scripts: ['zone_listener'],
          tag: 'sensor',
        },
      },
      {
        id: 'zone_once',
        name: 'OneShot Zone',
        components: {
          transform: { x: 100, y: 100, w: 24, h: 24 },
          triggerZone: {
            shape: 'circle',
            radius: 22,
            filterTag: 'hero',
            onEnterEvent: 'once_enter',
            oneShot: true,
          },
          scripts: ['zone_listener'],
          tag: 'sensor',
        },
      },
    ],
    {
      zone_listener: {
        id: 'zone_listener',
        name: 'Zone Listener',
        rules: [
          { trigger: { on: 'event', name: 'cp_enter' }, ops: [{ op: 'add_global', key: 'entered', delta: 1 }] },
          { trigger: { on: 'event', name: 'cp_exit' }, ops: [{ op: 'add_global', key: 'exited', delta: 1 }] },
          { trigger: { on: 'event', name: 'once_enter' }, ops: [{ op: 'add_global', key: 'onceHits', delta: 1 }] },
        ],
      },
    },
    { entered: 0, exited: 0, onceHits: 0 },
  );

  const rt = new EcsCartridgeRuntime(fixture);
  const idle = createEmptyInputState();
  // Pass through zone left -> right
  for (let i = 0; i < 90; i++) rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);
  assert.equal(rt.world.getGlobal('entered'), 2, 'Two script listeners receive cp_enter once each (total 2)');
  assert.equal(rt.world.getGlobal('exited'), 2, 'Two script listeners receive cp_exit once each (total 2)');
  assert.equal(rt.world.getGlobal('onceHits'), 2, 'OneShot event fires on first entry');

  // Reverse runner back through both zones
  const core = rt.world.core;
  const tagStore = core.getStore(core.components.Tag);
  for (let i = 0; i < tagStore.size(); i++) {
    if (tagStore.getDenseDataAt(i).entityId === 'runner') {
      const h = tagStore.getDenseEntityAt(i);
      core.getComponent(h, core.components.Velocity2D)!.vx = -120;
    }
  }
  for (let i = 0; i < 90; i++) rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);
  assert.equal(rt.world.getGlobal('entered'), 4, 'Repeatable TriggerZone fires again on second entry');
  assert.equal(rt.world.getGlobal('onceHits'), 2, 'OneShot TriggerZone must NOT re-fire on second entry');
});

test('VerletChain solves Zero-GC Float32Array node pools with accurate segment distance convergence', () => {
  const fixture = makeActionFixture([
    {
      id: 'lantern',
      name: 'Lantern Carrier',
      components: {
        transform: { x: 100, y: 80, w: 16, h: 16 },
        body2d: { vx: 90, vy: 0 },
        verletChain: {
          nodeCount: 7,
          segmentLength: 10,
          gravity: 420,
          damping: 0.96,
          iterations: 6,
          pinStart: true,
          color: '#f59e0b',
        },
        tag: 'prop',
      },
    },
  ]);

  const rt = new EcsCartridgeRuntime(fixture);
  const core = rt.world.core;
  const c = core.components;
  const h = core.getStore(c.VerletChain).getDenseEntityAt(0);
  const chain = core.getComponent(h, c.VerletChain)!;
  const tr = core.getComponent(h, c.Transform2D)!;

  // Capture pre-allocated TypedArray references to assert Zero-GC buffer identity
  const refPosX = chain.posX;
  const refPosY = chain.posY;
  const refPrevX = chain.prevX;
  const refPrevY = chain.prevY;

  const idle = createEmptyInputState();
  for (let i = 0; i < 60; i++) rt.step(1 / 60, idle, DEFAULT_RUNTIME_PARAMS);

  assert.equal(chain.posX, refPosX);
  assert.equal(chain.posY, refPosY);
  assert.equal(chain.prevX, refPrevX);
  assert.equal(chain.prevY, refPrevY);

  const expectedRootX = tr.x + tr.w * 0.5 + chain.attachOffsetX;
  const expectedRootY = tr.y + tr.h * 0.5 + chain.attachOffsetY;
  assert.ok(Math.abs(chain.posX[0] - expectedRootX) < 0.01, 'Pinned root X must match entity anchor');
  assert.ok(Math.abs(chain.posY[0] - expectedRootY) < 0.01, 'Pinned root Y must match entity anchor');

  // Verify every segment converged cleanly to rest segmentLength (10px) and chain trails behind motion
  for (let k = 0; k < chain.nodeCount - 1; k++) {
    const segDist = Math.hypot(chain.posX[k + 1] - chain.posX[k], chain.posY[k + 1] - chain.posY[k]);
    assert.ok(Math.abs(segDist - 10) < 1.5, `Segment ${k} distance should converge near 10px (got ${segDist})`);
  }
  assert.ok(chain.posX[chain.nodeCount - 1] < chain.posX[0], 'Tail node should trail behind rightward carrier');
  assert.ok(chain.posY[chain.nodeCount - 1] > chain.posY[0] + 25, 'Chain should sag downward under gravity');

  // Snapshot must project Verlet segments as worldSpace aim_line primitives
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const chainLines = (snap.hudPrimitives ?? []).filter((p) => p.kind === 'aim_line' && p.worldSpace);
  assert.equal(chainLines.length, chain.nodeCount - 1);
});

test('Prefab sparse inheritance merges per-field overrides cleanly and respects detachedComponents', () => {
  const prefabs: EcsProjectV2['prefabs'] = {
    solar_tower: {
      id: 'solar_tower',
      name: 'Solar Tower',
      category: 'turret',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32 },
        sprite: { sprite: 'hd_turret_solar', metallic: 0.75, roughness: 0.25, emissive: 0.3 },
        light: { color: '#38bdf8', radius: 90, intensity: 0.8 },
        health: { hp: 50, maxHp: 50, team: 1 },
        tag: 'turret',
      },
    },
  };

  const inst: EcsProjectV2['entities'][number] = {
    id: 'tower_a',
    name: 'Tower A',
    prefabId: 'solar_tower',
    components: {},
    overrides: {
      transform: { x: 240, y: 120 },
      sprite: { emissive: 1.4 },
    },
    detachedComponents: ['health'],
  };

  assert.equal(getEntityPrefabId(inst), 'solar_tower');
  assert.equal(countEntityOverrides(inst), 2, 'countEntityOverrides excludes default x/y placement (sprite + detached health = 2)');

  const resolved = resolveEntityComponents(inst, prefabs);
  assert.equal(resolved.transform?.x, 240);
  assert.equal(resolved.transform?.y, 120);
  assert.equal(resolved.transform?.w, 32, 'Unoverridden width must inherit from Prefab');
  assert.equal(resolved.sprite?.sprite, 'hd_turret_solar');
  assert.equal(resolved.sprite?.metallic, 0.75, 'Unoverridden metallic must inherit from Prefab');
  assert.equal(resolved.sprite?.emissive, 1.4, 'Per-field emissive override must take precedence');
  assert.equal(resolved.light?.color, '#38bdf8');
  assert.equal(resolved.health, undefined, 'Detached component must stay omitted even when present on Prefab');
  assert.equal(resolved.tag, 'turret');
});

test('EcsStudioSession Prefab commands support live propagation, sparse overrides, unlink baking, and Undo/Redo', () => {
  const fixture = makeActionFixture([
    {
      id: 'base_turret',
      name: 'Base Turret',
      components: {
        transform: { x: 100, y: 120, w: 32, h: 32 },
        sprite: { sprite: 'hd_turret_solar', metallic: 0.5, roughness: 0.4, emissive: 0.2 },
        light: { color: '#60a5fa', radius: 80, intensity: 0.7 },
        tag: 'turret',
      },
    },
  ]);

  const session = new EcsStudioSession(fixture);
  // 1. Save existing entity as a reusable Prefab and link source entity
  const saved = session.dispatch({
    type: 'save_entity_as_prefab',
    entityId: 'base_turret',
    prefabId: 'pf_turret',
    name: 'Solar Turret Template',
    category: 'turret',
    linkSourceEntity: true,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.createdPrefabId, 'pf_turret');
  assert.equal(session.listPrefabs().length, 1);
  assert.equal(session.getPrefabInstanceCount('pf_turret'), 1);

  // 2. Instantiate two linked clones at distinct positions
  const c1 = session.dispatch({
    type: 'instantiate_prefab',
    prefabId: 'pf_turret',
    x: 220,
    y: 140,
    name: 'Clone One',
  });
  const c2 = session.dispatch({
    type: 'instantiate_prefab',
    prefabId: 'pf_turret',
    x: 340,
    y: 160,
    name: 'Clone Two',
  });
  assert.equal(c1.ok && Boolean(c1.createdEntityId), true);
  assert.equal(c2.ok && Boolean(c2.createdEntityId), true);
  assert.equal(session.getPrefabInstanceCount('pf_turret'), 3);

  const id1 = c1.createdEntityId!;
  const id2 = c2.createdEntityId!;

  // 3. Apply a sparse per-field override on Clone One (only emissive)
  const overrideRes = session.dispatch({
    type: 'patch_entity',
    entityId: id1,
    patch: { sprite: { emissive: 1.5 } },
  });
  assert.equal(overrideRes.ok, true);

  // 4. Update Prefab PBR metallic & light color -> must propagate to all clones while Clone One preserves emissive=1.5
  const updRes = session.dispatch({
    type: 'update_prefab',
    prefabId: 'pf_turret',
    patch: {
      sprite: { metallic: 0.95, emissive: 0.6 },
      light: { color: '#f59e0b', intensity: 1.1 },
    },
  });
  assert.equal(updRes.ok, true);

  const proj = session.getProject();
  const ent1 = proj.entities.find((e) => e.id === id1)!;
  const ent2 = proj.entities.find((e) => e.id === id2)!;
  const res1 = resolveEntityComponents(ent1, proj.prefabs);
  const res2 = resolveEntityComponents(ent2, proj.prefabs);

  assert.equal(res1.sprite?.metallic, 0.95, 'Clone One must inherit updated Prefab metallic');
  assert.equal(res1.sprite?.emissive, 1.5, 'Clone One must preserve its sparse emissive override');
  assert.equal(res1.light?.color, '#f59e0b', 'Clone One must inherit updated Prefab light color');
  assert.equal(res2.sprite?.metallic, 0.95, 'Clone Two must inherit updated Prefab metallic');
  assert.equal(res2.sprite?.emissive, 0.6, 'Clone Two must inherit updated Prefab emissive');

  // Verify EcsCartridgeRuntime snapshot reflects propagated Prefab + sparse override
  const rt = new EcsCartridgeRuntime(proj);
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const snapEntities = snap.entities.filter((e) => e.sprite === 'hd_turret_solar');
  assert.equal(snapEntities.length, 3);
  assert.equal(snapEntities.filter((e) => e.metallic === 0.95).length, 3);
  assert.equal(snapEntities.filter((e) => e.emissive === 1.5).length, 1);
  assert.equal(snapEntities.filter((e) => e.emissive === 0.6).length, 2);

  // 5. Revert overrides on Clone One (keeping its placed x/y position)
  const revOverride = session.dispatch({
    type: 'revert_prefab_overrides',
    entityId: id1,
    keepPosition: true,
  });
  assert.equal(revOverride.ok, true);
  const ent1AfterRevert = session.getProject().entities.find((e) => e.id === id1)!;
  const res1AfterRevert = resolveEntityComponents(ent1AfterRevert, session.getProject().prefabs);
  assert.equal(res1AfterRevert.transform?.x, 220, 'revert_prefab_overrides(keepPosition=true) must keep X');
  assert.equal(res1AfterRevert.sprite?.emissive, 0.6, 'Reverted Clone One must inherit Prefab emissive again');

  // 6. Delete Prefab in unlink mode -> bakes resolved components so instances stay intact
  const delRes = session.dispatch({
    type: 'delete_prefab',
    prefabId: 'pf_turret',
    mode: 'unlink',
  });
  assert.equal(delRes.ok, true);
  assert.equal(session.listPrefabs().length, 0);
  const bakedClone2 = session.getProject().entities.find((e) => e.id === id2)!;
  assert.equal(getEntityPrefabId(bakedClone2), undefined);
  assert.equal(bakedClone2.components.sprite?.metallic, 0.95);
  assert.equal(bakedClone2.components.light?.color, '#f59e0b');

  // 7. Undo restores Prefab + live link deterministically, Redo re-applies delete
  const undoDel = session.undo();
  assert.equal(undoDel.ok, true);
  assert.equal(session.getPrefabInstanceCount('pf_turret'), 3);
  const redoDel = session.redo();
  assert.equal(redoDel.ok, true);
  assert.equal(session.listPrefabs().length, 0);
});

test('EcsSpatialOracle detects reachable jump/grapple routes and flags impossible gaps & unreachable anchors', () => {
  const solvableFixture = makeActionFixture([
    {
      id: 'plat_start',
      name: 'Start Ledge',
      components: {
        transform: { x: 20, y: 200, w: 80, h: 16 },
        collider: { radius: 8, isSolid: true },
        tag: 'solid',
      },
    },
    {
      id: 'plat_mid',
      name: 'Mid Platform',
      components: {
        transform: { x: 150, y: 175, w: 72, h: 16 },
        collider: { radius: 8, isSolid: true },
        tag: 'solid',
      },
    },
    {
      id: 'anchor_chasm',
      name: 'Chasm Anchor',
      components: {
        transform: { x: 350, y: 92, w: 12, h: 12 },
        grappleAnchor: { anchorRadius: 165, swingTension: 0.99, reelSpeed: 96, minLength: 24, enabled: true },
        tag: 'anchor',
      },
    },
    {
      id: 'plat_goal',
      name: 'Goal Ledge',
      components: {
        transform: { x: 480, y: 170, w: 80, h: 16 },
        collider: { radius: 8, isSolid: true },
        tag: 'solid',
      },
    },
    {
      id: 'goal_portal',
      name: 'Exit Portal',
      components: {
        transform: { x: 506, y: 146, w: 24, h: 24 },
        triggerZone: { shape: 'rect', width: 28, height: 28, filterTag: 'hero', onEnterEvent: 'win_level' },
        tag: 'goal',
      },
    },
    {
      id: 'hero',
      name: 'Hero',
      components: {
        transform: { x: 48, y: 184, w: 16, h: 16 },
        characterMotor2d: {
          moveSpeed: 180,
          jumpVelocity: 300,
          gravity: 720,
          coyoteTimeSec: 0.12,
          dashSpeed: 320,
          dashDurationSec: 0.12,
          floorY: 999,
        },
        tag: 'hero',
      },
    },
  ]);

  const sem = observeSceneSemantics(solvableFixture);
  assert.equal(sem.solidPlatforms.length, 3);
  assert.equal(sem.grappleAnchors.length, 1);
  assert.equal(sem.triggerZones.length, 1);
  assert.equal(sem.warnings.length, 0);

  const reachOk = analyzeActionReachability(solvableFixture);
  assert.equal(reachOk.hasActionMotor, true);
  assert.equal(reachOk.pass, true, `Expected solvable jump+grapple level to pass (diag: ${reachOk.diagnostics.join('; ')})`);
  assert.equal(reachOk.goalStatuses.length, 1);
  assert.equal(reachOk.goalStatuses[0].reachable, true);
  assert.ok(reachOk.goalStatuses[0].viaMethods.includes('grapple_swing'), 'Path across 258px chasm must utilize grapple_swing');

  // Remove the grapple anchor -> 258px chasm exceeds jump+dash envelope (218px) and oracle MUST fail cleanly
  const impossibleFixture = makeActionFixture(solvableFixture.entities.filter((e) => e.id !== 'anchor_chasm'));
  const reachFail = analyzeActionReachability(impossibleFixture);
  assert.equal(reachFail.pass, false, 'Oracle must flag impossible 258px chasm when grapple anchor is removed');
  assert.equal(reachFail.goalStatuses[0].reachable, false);
  assert.ok(reachFail.diagnostics.some((d) => d.includes('goal_portal')));
});

test('EcsPlaytestVerifier proves scripted action keypoint solvability and emits actionable failure hints', () => {
  const fixture = makeActionFixture(
    [
      {
        id: 'ledge_a',
        name: 'Start Ledge',
        components: {
          transform: { x: 20, y: 180, w: 80, h: 16 },
          collider: { radius: 8, isSolid: true },
          tag: 'solid',
        },
      },
      {
        id: 'ledge_b',
        name: 'Landing Ledge',
        components: {
          transform: { x: 148, y: 152, w: 80, h: 16 },
          collider: { radius: 8, isSolid: true },
          tag: 'solid',
        },
      },
      {
        id: 'goal_zone',
        name: 'Goal Sensor',
        components: {
          transform: { x: 170, y: 124, w: 28, h: 28 },
          triggerZone: { shape: 'rect', width: 32, height: 32, filterTag: 'hero', onEnterEvent: 'goal_hit', oneShot: true },
          scripts: ['goal_counter'],
          tag: 'goal',
        },
      },
      {
        id: 'hero',
        name: 'Hero',
        components: {
          transform: { x: 44, y: 164, w: 16, h: 16 },
          characterMotor2d: {
            moveSpeed: 180,
            accel: 1800,
            gravity: 720,
            jumpVelocity: 290,
            coyoteTimeSec: 0.12,
            floorY: 240,
          },
          tag: 'hero',
        },
      },
    ],
    {
      goal_counter: {
        id: 'goal_counter',
        name: 'Goal Counter',
        rules: [{ trigger: { on: 'event', name: 'goal_hit' }, ops: [{ op: 'add_global', key: 'cleared', delta: 1 }] }],
      },
    },
    { cleared: 0 },
  );

  // Scripted input: walk right, jump onto higher ledge_b, enter goal_zone and trigger cleared=1
  const passReport = runScriptedPlaytest(fixture, {
    maxFrames: 90,
    keypoints: [
      { fromFrame: 0, toFrame: 75, input: { right: true }, label: 'run_right' },
      { fromFrame: 18, toFrame: 24, input: { jump: true }, label: 'edge_jump' },
    ],
    assertions: [
      { kind: 'reach_entity', actorId: 'hero', targetId: 'goal_zone', maxDistance: 28 },
      { kind: 'global_gte', key: 'cleared', value: 1 },
      { kind: 'event_fired', event: 'jump', minCount: 1 },
      { kind: 'no_nan_positions' },
    ],
  });
  assert.equal(passReport.ok, true, `Expected scripted playtest to pass: ${passReport.failureHints.join('; ')}`);
  assert.ok(passReport.actorTraces.hero.length >= 4);

  // Idle input must fail and produce diagnostic failure hints
  const failReport = runScriptedPlaytest(fixture, {
    maxFrames: 45,
    keypoints: [],
    assertions: [{ kind: 'reach_entity', actorId: 'hero', targetId: 'goal_zone', maxDistance: 24 }],
  });
  assert.equal(failReport.ok, false);
  assert.ok(failReport.failureHints.length === 1 && failReport.failureHints[0].includes('never reached'));
});

test('PixerMcpSession executes MCP JSON-RPC 2.0 tools, atomic dispatch_ecs_batch rollback, and Undo/Redo', () => {
  const fixture = makeActionFixture([
    {
      id: 'hero',
      name: 'Hero',
      components: {
        transform: { x: 40, y: 160, w: 16, h: 16 },
        characterMotor2d: { moveSpeed: 180, jumpVelocity: 290, gravity: 720, floorY: 220 },
        tag: 'hero',
      },
    },
  ]);
  const mcp = new PixerMcpSession(fixture);

  const initResp = mcp.handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.ok(initResp && !initResp.error);
  const toolsResp = mcp.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = (toolsResp?.result as { tools: Array<{ name: string }> }).tools;
  assert.ok(tools.some((t) => t.name === 'dispatch_ecs_batch'));
  assert.ok(tools.some((t) => t.name === 'analyze_reachability'));
  assert.ok(tools.some((t) => t.name === 'run_scripted_playtest'));

  // Atomic batch rollback: step 2 targets missing entity -> step 1 spawn MUST be rolled back
  const revBefore = mcp.session.getRevision();
  const badBatch = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'dispatch_ecs_batch',
      arguments: {
        commands: [
          {
            type: 'spawn_entity',
            entity: { id: 'temp_plat', name: 'Temp', components: { transform: { x: 20, y: 180, w: 80, h: 16 }, tag: 'solid' } },
          },
          { type: 'remove_entity', entityId: 'non_existent_id' },
        ],
      },
    },
  });
  assert.equal((badBatch?.result as { isError: boolean }).isError, true);
  assert.equal(mcp.session.getRevision(), revBefore, 'Failed atomic batch must not increment revision');
  assert.equal(mcp.session.getProject().entities.some((e) => e.id === 'temp_plat'), false);

  // Valid atomic batch creates platform + goal in 1 single undoable transaction, then verify via analyze_reachability
  const goodBatch = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'dispatch_ecs_batch',
      arguments: {
        label: 'Build starter goal',
        commands: [
          {
            type: 'spawn_entity',
            entity: {
              id: 'plat_1',
              name: 'Platform 1',
              components: { transform: { x: 20, y: 180, w: 96, h: 16 }, collider: { radius: 8, isSolid: true }, tag: 'solid' },
            },
          },
          {
            type: 'spawn_entity',
            entity: {
              id: 'goal_1',
              name: 'Goal 1',
              components: {
                transform: { x: 140, y: 160, w: 24, h: 24 },
                triggerZone: { shape: 'rect', width: 24, height: 24, filterTag: 'hero', onEnterEvent: 'win' },
                tag: 'goal',
              },
            },
          },
        ],
      },
    },
  });
  assert.equal((goodBatch?.result as { isError: boolean }).isError, false);
  assert.equal(mcp.session.getRevision(), revBefore + 1);

  const reachResp = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'analyze_reachability', arguments: {} },
  });
  const reachData = (reachResp?.result as { structuredContent: { pass: boolean } }).structuredContent;
  assert.equal(reachData.pass, true);

  // Single undo rolls back BOTH entities from the atomic batch
  const undoResp = mcp.handleRequest({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'undo', arguments: {} } });
  assert.equal((undoResp?.result as { isError: boolean }).isError, false);
  assert.equal(mcp.session.getProject().entities.length, 1);
});

test('Spatial3D enforces Z-elevation jump, overpass landing, underpass clearance, and dimensionMask isolation', () => {
  const fixture = makeActionFixture(
    [
      // Elevated overpass bridge at z=24..32 (shared across realms)
      {
        id: 'overpass',
        name: 'Sky Bridge',
        components: {
          transform: { x: 100, y: 120, w: 60, h: 40 },
          collider: { radius: 20, isSolid: true },
          spatial3d: { z: 24, height: 8, groundZ: 24, gravityZ: 0, dimensionMask: 3 },
          sprite: { sprite: 'hd_arena_tile' },
          tag: 'solid',
        },
      },
      // Realm 2 (Shadow world) trigger zone directly overlapping hero start at z=0
      {
        id: 'shadow_trigger',
        name: 'Shadow Shrine',
        components: {
          transform: { x: 112, y: 132, w: 32, h: 32 },
          triggerZone: { shape: 'rect', width: 32, height: 32, filterTag: 'hero', onEnterEvent: 'shadow_entered' },
          spatial3d: { z: 0, height: 18, groundZ: 0, gravityZ: 0, dimensionMask: 2 },
          sprite: { sprite: 'star_a' },
          scripts: ['shadow_counter'],
          tag: 'trigger',
        },
      },
      // Hero on ground under the overpass in Realm 1 (height=16 -> top=16 <= bridge z=24)
      {
        id: 'hero',
        name: 'Underpass Hero',
        components: {
          transform: { x: 116, y: 136, w: 16, h: 16 },
          spatial3d: { z: 0, height: 16, groundZ: 0, gravityZ: 680, jumpZVelocity: 240, dimensionMask: 1 },
          sprite: { sprite: 'hero_a', emissive: 0.4 },
          tag: 'hero',
        },
      },
      // Sky runner starting above the overpass (z=48 -> should land cleanly on overpass top z=32)
      {
        id: 'sky_runner',
        name: 'Overpass Runner',
        components: {
          transform: { x: 120, y: 132, w: 16, h: 16 },
          spatial3d: { z: 48, height: 16, groundZ: 0, gravityZ: 680, dimensionMask: 3 },
          sprite: { sprite: 'hero_b' },
          tag: 'ally',
        },
      },
    ],
    {
      shadow_counter: {
        id: 'shadow_counter',
        name: 'Shadow Counter',
        rules: [{ trigger: { on: 'event', name: 'shadow_entered' }, ops: [{ op: 'add_global', key: 'shadowHits', delta: 1 }] }],
      },
    },
    { shadowHits: 0 },
  );
  fixture.projection = {
    mode: 'hd2d_iso',
    elevationScale: 0.9,
    activeDimensionMask: 1,
    inactiveDimAlpha: 0.16,
    allowDimensionShift: true,
  };

  const rt = new EcsCartridgeRuntime(fixture);
  const core = rt.world.core;
  const inspected = rt.world.inspectEntities();
  const heroH = inspected.find((e) => e.entityId === 'hero')!.handle;
  const runnerH = inspected.find((e) => e.entityId === 'sky_runner')!.handle;
  const heroSp = core.getComponent(heroH, core.components.Spatial3D)!;
  const runnerSp = core.getComponent(runnerH, core.components.Spatial3D)!;

  // Step 30 frames in Realm 1:
  // 1) sky_runner falls from z=48 and lands on overpass top (z=24+8=32)
  // 2) hero stays cleanly under the overpass at z=0 (underpass clearance) and does NOT trigger Realm 2 shrine
  for (let f = 0; f < 30; f++) {
    rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  assert.equal(runnerSp.z, 32, `Sky runner above overpass must land on bridge top z=32 (got ${runnerSp.z})`);
  assert.equal(heroSp.z, 0, `Hero below overpass must remain unobstructed at z=0 (got ${heroSp.z})`);
  assert.equal(rt.world.getGlobal('shadowHits'), 0, 'Realm 1 hero must NOT trigger Realm 2 TriggerZone');

  // Verify HD-2D snapshot applies elevationZ and ghosts inactive Realm 2 entity
  const snapRealm1 = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(snapRealm1.hd2dDepth?.enabled, true);
  const runnerRender = snapRealm1.entities.find((e) => e.sprite === 'hero_b');
  const shrineRender = snapRealm1.entities.find((e) => e.sprite === 'star_a');
  assert.ok(runnerRender && (runnerRender.elevationZ ?? 0) > 25, 'Elevated overpass runner must lift visually via elevationZ');
  assert.ok(shrineRender && (shrineRender.alpha ?? 1) <= 0.2, 'Inactive Realm 2 entity must ghost cleanly in Realm 1');

  // Test Z-axis jump for hero (without CharacterMotor2D)
  const jumpEvs = rt.step(1 / 60, { ...createEmptyInputState(), jump: true }, DEFAULT_RUNTIME_PARAMS);
  assert.ok(jumpEvs.includes('jump') && heroSp.vz > 150 && heroSp.z > 0, 'Spatial3D hero must execute Z-axis jump');

  // Trigger live Realm shift via shoulderR (activeDimensionMask 1 -> 2)
  const shiftEvs = rt.step(1 / 60, { ...createEmptyInputState(), shoulderR: true }, DEFAULT_RUNTIME_PARAMS);
  assert.ok(shiftEvs.includes('snap'), 'Dimension shift must emit tactile snap feedback');
  assert.equal(rt.getActiveDimensionMask(), 2, 'shoulderR must toggle activeDimensionMask from 1 to 2');

  // When hero also exists in Realm 2 (or shifts mask to 2), Realm 2 TriggerZone activates
  heroSp.dimensionMask = 2;
  heroSp.z = 0;
  heroSp.vz = 0;
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  assert.equal(rt.world.getGlobal('shadowHits'), 1, 'After entering Realm 2, hero must activate Realm 2 TriggerZone');
});

test('Multi-dimensional EcsSpatialOracle, set_projection (ortho_2d / hd2d_iso / first_person_25d), and MCP work end-to-end', () => {
  const fixture = makeActionFixture([
    {
      id: 'start_ledge',
      name: 'Light Ledge',
      components: {
        transform: { x: 20, y: 180, w: 96, h: 16 },
        collider: { radius: 8, isSolid: true },
        spatial3d: { z: 0, height: 16, dimensionMask: 1 },
        sprite: { sprite: 'hd_arena_tile' },
        tag: 'solid',
      },
    },
    {
      id: 'shadow_bridge',
      name: 'Shadow Bridge',
      components: {
        transform: { x: 144, y: 168, w: 96, h: 16 },
        collider: { radius: 8, isSolid: true },
        spatial3d: { z: 0, height: 16, dimensionMask: 2 },
        sprite: { sprite: 'hd_arena_tile' },
        tag: 'solid',
      },
    },
    {
      id: 'shadow_goal',
      name: 'Shadow Goal',
      components: {
        transform: { x: 184, y: 140, w: 24, h: 24 },
        triggerZone: { shape: 'rect', width: 24, height: 24, filterTag: 'hero', onEnterEvent: 'win' },
        spatial3d: { z: 0, height: 18, dimensionMask: 2 },
        sprite: { sprite: 'star_a' },
        tag: 'goal',
      },
    },
    {
      id: 'hero',
      name: 'Hero',
      components: {
        transform: { x: 48, y: 164, w: 16, h: 16 },
        characterMotor2d: { moveSpeed: 180, jumpVelocity: 290, gravity: 720, floorY: 220 },
        spatial3d: { z: 0, height: 16, dimensionMask: 1 },
        sprite: { sprite: 'hero_a' },
        tag: 'hero',
      },
    },
  ]);
  fixture.projection = {
    mode: 'hd2d_iso',
    activeDimensionMask: 1,
    allowDimensionShift: false,
  };

  // Semantics must report real z, height, dimensionMask, and projection config
  const sem = observeSceneSemantics(fixture);
  assert.equal(sem.projection.mode, 'hd2d_iso');
  assert.equal(sem.projection.activeDimensionMask, 1);
  assert.equal(sem.projection.allowDimensionShift, false);
  const bridgeSem = sem.entities.find((e) => e.id === 'shadow_bridge');
  assert.equal(bridgeSem?.dimensionMask, 2);

  // With allowDimensionShift=false, Realm 2 goal MUST be unreachable
  const blockedReach = analyzeActionReachability(fixture);
  assert.equal(blockedReach.pass, false, 'Realm 2 goal must be flagged unreachable when allowDimensionShift is false');

  // Enable allowDimensionShift via MCP set_projection command -> oracle MUST now prove solvability via dimension_shift
  const mcp = new PixerMcpSession(fixture);
  const projResp = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/call',
    params: {
      name: 'dispatch_ecs_command',
      arguments: {
        command: { type: 'set_projection', patch: { allowDimensionShift: true } },
      },
    },
  });
  assert.equal((projResp?.result as { isError: boolean }).isError, false);

  const openReach = analyzeActionReachability(mcp.session.getProject());
  assert.equal(openReach.pass, true, `Goal in Realm 2 must be reachable once allowDimensionShift=true (diag: ${openReach.diagnostics.join('; ')})`);
  assert.ok(
    openReach.goalStatuses[0].viaMethods.includes('dimension_shift'),
    `Reachability path should record dimension_shift (got ${openReach.goalStatuses[0].viaMethods.join(',')})`,
  );

  // Switch projection to first_person_25d -> snapshot must populate PerspectiveProjectionDesc & hide hero in 1P
  const fpRes = mcp.session.dispatch({ type: 'set_projection', patch: { mode: 'first_person_25d', fovDeg: 72 } });
  assert.equal(fpRes.ok, true);
  const fpRt = new EcsCartridgeRuntime(mcp.session.getProject());
  fpRt.step(1 / 60, { ...createEmptyInputState(), up: true }, DEFAULT_RUNTIME_PARAMS);
  const fpSnap = fpRt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(fpSnap.perspective, 'first_person_25d mode must populate snapshot.perspective');
  assert.equal(fpSnap.perspective?.mode, 'first_person');
  assert.ok(Math.abs((fpSnap.perspective?.fovRad ?? 0) - (72 * Math.PI) / 180) < 0.001, '1P fovRad must match 72 deg');
  assert.ok(fpSnap.perspective && fpSnap.perspective.wallGrid.some((c) => c > 0), '1P wallGrid must contain perimeter/solid walls');
  const heroFp = fpSnap.entities.find((e) => e.sprite === 'hero_a');
  assert.equal(heroFp?.hideInFirstPerson, true, 'Player actor must set hideInFirstPerson in first_person_25d mode');

  // Switch projection to ortho_2d -> elevationZ flattens to 0 and hd2dDepth disables
  const orthoRes = mcp.session.dispatch({ type: 'set_projection', patch: { mode: 'ortho_2d' } });
  assert.equal(orthoRes.ok, true);
  const orthoRt = new EcsCartridgeRuntime(mcp.session.getProject());
  const orthoSnap = orthoRt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(orthoSnap.perspective, undefined);
  assert.equal(orthoSnap.hd2dDepth?.enabled, false);
  assert.ok(orthoSnap.entities.every((e) => (e.elevationZ ?? 0) === 0), 'ortho_2d must flatten all entity elevationZ to 0');
});

test('EcsEventGraph lossless Script <-> Graph roundtrip, cycle guard, and transactional upsert_script Undo/Redo', () => {
  const fixture = makeActionFixture(
    [
      {
        id: 'beacon',
        name: 'Beacon',
        components: {
          transform: { x: 120, y: 120, w: 20, h: 20 },
          scripts: ['combo_script'],
          tag: 'beacon',
        },
      },
    ],
    {
      combo_script: {
        id: 'combo_script',
        name: 'Combo Rule Script',
        description: 'Multi-rule trigger -> condition -> actions',
        rules: [
          {
            trigger: { on: 'event', name: 'collect_gem' },
            when: [{ kind: 'global', key: 'energy', op: 'gte', value: 5 }],
            ops: [
              { op: 'add_score', delta: 150 },
              { op: 'play_sfx', sfx: 'star' },
            ],
          },
          {
            trigger: { on: 'timer', intervalSec: 0.8 },
            ops: [{ op: 'add_global', key: 'ticks', delta: 1 }],
          },
        ],
      },
    },
    { energy: 10, ticks: 0 },
  );

  // 1. Lossless forward -> reverse roundtrip
  const origScript = fixture.scripts.combo_script;
  const graph = compileScriptToEventGraph(origScript);
  assert.equal(graph.nodes.length, 6, '2 rules should expand to 6 nodes (2 trig + 1 cond + 3 ops)');
  assert.equal(graph.edges.length, 4, '2 rules should produce 4 sequential edges');

  const moved = moveEventGraphNode(graph, 'r0_op_1', 812, 92);
  const recompiled = compileEventGraphToScript(moved);
  assert.deepEqual(recompiled.script, origScript, 'EventGraph roundtrip must be 100% lossless');
  assert.deepEqual(recompiled.layout.r0_op_1, { x: 812, y: 92 }, 'Custom dragged coordinates must persist in layout');
  assert.equal(recompiled.warnings.length, 0);

  // 2. Topology & cycle guard: reject trigger as target, reject action -> condition, reject cycle
  const badTrigTarget = connectEventGraphNodes(moved, 'r0_op_0', 'r0_trig');
  assert.equal(badTrigTarget.ok, false);
  const badActToCond = connectEventGraphNodes(moved, 'r0_op_0', 'r0_cond_0');
  assert.equal(badActToCond.ok, false);
  const badCycle = connectEventGraphNodes(moved, 'r0_op_1', 'r0_op_0');
  assert.equal(badCycle.ok, false);

  // 3. Add a new timer Trigger + add_score Action, wire them, and commit transactionally via EcsStudioSession
  const addedT = addEventGraphNode(moved, 'trigger');
  const addedA = addEventGraphNode(addedT.graph, 'action');
  const wired = connectEventGraphNodes(addedA.graph, addedT.createdNodeId, addedA.createdNodeId);
  assert.equal(wired.ok, true);
  const nextCompiled = compileEventGraphToScript(wired.graph);
  assert.equal(nextCompiled.script.rules.length, 3);

  const session = new EcsStudioSession(fixture);
  const res = session.dispatch({
    type: 'upsert_script',
    script: nextCompiled.script,
    graphLayout: nextCompiled.layout,
  });
  assert.equal(res.ok, true);
  assert.equal(session.getProject().scripts.combo_script.rules.length, 3);
  assert.deepEqual(session.getProject().graphLayouts?.combo_script?.r0_op_1, { x: 812, y: 92 });

  // Disconnect edge and confirm undo restores previous revision cleanly
  const discGraph = disconnectEventGraphEdge(wired.graph, wired.graph.edges[wired.graph.edges.length - 1].id);
  const discOut = compileEventGraphToScript(discGraph);
  assert.ok(discOut.warnings.length >= 1, 'Orphaned action node must emit a compiler warning');

  const undoRes = session.undo();
  assert.equal(undoRes.ok, true);
  assert.equal(session.getProject().scripts.combo_script.rules.length, 2);
});

test('SandboxScriptVm Zero-GC live execution trace highlights fired rules and decays cleanly', () => {
  const fixture = makeActionFixture(
    [
      {
        id: 'pulse_node',
        name: 'Pulse Node',
        components: {
          transform: { x: 64, y: 64, w: 16, h: 16 },
          scripts: ['pulse_script'],
          tag: 'beacon',
        },
      },
    ],
    {
      pulse_script: {
        id: 'pulse_script',
        name: 'Pulse Script',
        rules: [
          {
            trigger: { on: 'timer', intervalSec: 0.2 },
            ops: [
              { op: 'add_global', key: 'pulses', delta: 1 },
              { op: 'add_score', delta: 50 },
            ],
          },
          {
            trigger: { on: 'event', name: 'never_fired_event' },
            ops: [{ op: 'add_score', delta: 999 }],
          },
        ],
      },
    },
    { pulses: 0 },
  );

  const rt = new EcsCartridgeRuntime(fixture);
  assert.equal(rt.vm.getRuleFireCount('pulse_script', 0), 0);
  assert.equal(rt.vm.getRuleHotGlow('pulse_script', 0), 0);

  // Step 15 frames (0.25s) -> rule 0 fires once at 0.2s
  for (let f = 0; f < 15; f++) {
    rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  assert.equal(rt.vm.getRuleFireCount('pulse_script', 0), 1, 'Rule 0 timer must fire once by 0.25s');
  assert.ok(rt.vm.getRuleHotGlow('pulse_script', 0) > 0.5, 'Rule 0 hot glow must illuminate right after firing');
  assert.equal(rt.vm.getRuleFireCount('pulse_script', 1), 0, 'Unfired rule 1 must remain at 0 fires');
  assert.equal(rt.vm.getRuleHotGlow('pulse_script', 1), 0, 'Unfired rule 1 must stay unlit');
  assert.equal(rt.world.getGlobal('pulses'), 1);

  // Verify hot glow decays smoothly when beginFrame advances without re-firing
  const glowBefore = rt.vm.getRuleHotGlow('pulse_script', 0);
  rt.vm.beginFrame(0.25);
  const glowAfter = rt.vm.getRuleHotGlow('pulse_script', 0);
  assert.ok(glowAfter < glowBefore && glowAfter >= 0, 'Live trace hot glow must decay smoothly over time');
});




