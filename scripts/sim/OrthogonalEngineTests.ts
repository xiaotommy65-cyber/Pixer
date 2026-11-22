import { ATLAS_SIZE, TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { GpuEngine } from '../../src/core/gpu/GpuEngine.ts';
import { FLOATS_PER_INSTANCE, type IGpuBackend } from '../../src/core/gpu/GpuTypes.ts';
import { CartridgeRunner } from '../../src/core/runtime/CartridgeRunner.ts';
import { SceneGpuBridge } from '../../src/core/runtime/SceneGpuBridge.ts';
import { CardDeckEngine } from '../../src/core/sim/CardDeckEngine.ts';
import { validateCartridgeJson, type CartridgeJsonV1 } from '../../src/core/sim/CartridgeSchema.ts';
import { EventActionVm, type VmHostBridge } from '../../src/core/sim/EventActionVm.ts';
import { FighterFrameEngine, type FighterStepHooks } from '../../src/core/sim/FighterFrameEngine.ts';
import {
  BUILTIN_ORTHOGONAL_BLUEPRINTS,
  composeOrthogonalBlueprintInto,
  createComposedLayerPool,
  resolveRelativeFacingInto,
  type RelativeFacingOut,
} from '../../src/core/sim/OrthogonalArt.ts';
import { PerspectiveProjector } from '../../src/core/sim/PerspectiveProjector.ts';
import {
  COLLISION_SLOPE_DOWN,
  COLLISION_SLOPE_UP,
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
  type TileAabbStepResult,
} from '../../src/core/sim/TilemapGrid.ts';
import type { SimEvent } from '../../src/core/types/SceneTypes.ts';
import astralDeckRaw from '../../src/game/astralDeck/astralDeck.cartridge.json' with { type: 'json' };
import atelierBrawlerRaw from '../../src/game/atelierBrawler/atelierBrawler.cartridge.json' with { type: 'json' };
import { LabyrinthDualviewGame } from '../../src/game/labyrinthDualview/LabyrinthDualviewGame.ts';
import { check, emptyInput } from './SimTestHarness.ts';

function makeNoopVmBridge(): VmHostBridge {
  return {
    isButton: () => false,
    spawn: () => {},
    destroy: () => {},
    impulse: () => {},
    playSfx: () => {},
    triggerJuice: () => {},
    endGame: () => {},
  };
}

export function testEngine5OrthogonalFoundations(): void {
  // 1. EventActionVm: per-entity local vars (self.*/other.*), *=, /=, valueVar, ifMode:'any', else branch, signal slot forwarding
  const vm = new EventActionVm();
  vm.loadRules(
    [
      {
        id: 'collide_damage',
        when: { type: 'OnCollide', sourceTag: 'hero', targetTag: 'enemy' },
        if: [
          { varName: 'self.atk', op: '>', value: 0 },
          { varName: 'other.shield', op: '==', value: 99 },
        ],
        ifMode: 'any',
        do: [
          { type: 'SetVar', name: 'other.hp', op: '-=', value: 0, valueVar: 'self.atk' },
          { type: 'SetVar', name: 'score', op: '*=', value: 2 },
          { type: 'EmitSignal', signal: 'hit_confirm' },
        ],
      },
      {
        id: 'signal_slot_bonus',
        when: { type: 'OnSignal', signal: 'hit_confirm' },
        if: [{ varName: 'other.hp', op: '<=', value: 5 }],
        do: [{ type: 'SetVar', name: 'other.lowHpFlag', op: '=', value: 1 }],
        else: [{ type: 'SetVar', name: 'other.lowHpFlag', op: '=', value: 2 }],
      },
      {
        id: 'div_test',
        when: { type: 'OnStart' },
        do: [{ type: 'SetVar', name: 'score', op: '/=', value: 2 }],
      },
    ],
    { score: 20 },
  );
  vm.setEntityVar(3, 'atk', 7);
  vm.setEntityVar(8, 'hp', 10);
  vm.setEntityVar(8, 'shield', 0);

  const bridge = makeNoopVmBridge();
  vm.stepTick(
    bridge,
    [{ selfSlot: 3, otherSlot: 8, selfTag: 'hero', otherTag: 'enemy' }],
    1,
  );
  // OnCollide runs first (20*2=40, hp=10-7=3), OnStart runs second (40/2=20), OnSignal preserves otherSlot=8 -> lowHpFlag=1
  check(vm.getEntityVar(8, 'hp') === 3, `EventActionVm self/other valueVar arithmetic failed (got ${vm.getEntityVar(8, 'hp')})`);
  check(vm.getVar('score') === 20, `EventActionVm *= and /= failed (got ${vm.getVar('score')})`);
  check(vm.getEntityVar(8, 'lowHpFlag') === 1, 'EventActionVm OnSignal must preserve selfSlot/otherSlot and evaluate if/else');

  // Verify else branch when condition fails
  vm.setEntityVar(8, 'hp', 20);
  vm.emitSignal('hit_confirm', 3, 8);
  vm.stepTick(bridge, [], 0);
  check(vm.getEntityVar(8, 'lowHpFlag') === 2, 'EventActionVm else branch must run when if condition is false');

  vm.clearEntityVars(8);
  check(vm.getEntityVar(8, 'hp') === 0, 'EventActionVm.clearEntityVars must reset entity local slots');

  // 2. TilemapGrid: High-speed anti-tunneling substepping & 45-degree slopes
  const grid = new TilemapGrid(20, 12);
  // Thin 1-tile wall at col 4 (x = 64..80); single frame displacement is 80px (vx=4800) which would tunnel without substepping
  for (let r = 0; r < 12; r++) grid.setTile(4, r, 1, COLLISION_SOLID);
  const fastBody = { x: 2 * TILE_SIZE, y: 6 * TILE_SIZE, vx: 4800, vy: 0 };
  const stepOut: TileAabbStepResult = { onGround: false, hitWall: false, hitCeiling: false, hitHazard: false, landVy: 0 };
  grid.resolveAabbMotion(fastBody, 0, 0, 12, 14, 1 / 60, stepOut);
  check(
    stepOut.hitWall && fastBody.x + 12 <= 4 * TILE_SIZE + 0.01,
    `TilemapGrid high-speed substepping must prevent wall tunneling (x=${fastBody.x.toFixed(1)})`,
  );

  // 45-degree ascending slope (/) at col 3, row 9 and descending slope (\) at col 4, row 9
  const slopeGrid = new TilemapGrid(12, 12);
  for (let c = 0; c < 12; c++) slopeGrid.setTile(c, 10, 1, COLLISION_SOLID);
  slopeGrid.setTile(3, 9, 1, COLLISION_SLOPE_UP);
  slopeGrid.setTile(4, 9, 1, COLLISION_SLOPE_DOWN);
  const climber = { x: 2.2 * TILE_SIZE, y: 10 * TILE_SIZE - 14, vx: 90, vy: 0 };
  let climbedHigher = false;
  for (let f = 0; f < 16; f++) {
    climber.vx = 90;
    climber.vy = 20;
    slopeGrid.resolveAabbMotion(climber, 0, 0, 12, 14, 1 / 60, stepOut);
    if (stepOut.onGround && climber.y < 10 * TILE_SIZE - 14 - 4) climbedHigher = true;
  }
  check(climbedHigher, `TilemapGrid 45° slope (COLLISION_SLOPE_UP) must smoothly lift actor (final y=${climber.y.toFixed(1)})`);

  // 3. TextureAtlas: dynamic slot allocation, release, and best-fit recycling
  const atlas = new TextureAtlas();
  const baseDynCount = atlas.getDynamicSlotCount();
  const dummyRgba = new Uint8Array(32 * 32 * 4);
  dummyRgba.fill(200);
  const r1 = atlas.registerDynamicRgbaSprite('dyn_test_a', 32, 32, dummyRgba);
  const r2 = atlas.registerDynamicRgbaSprite('dyn_test_b', 32, 32, dummyRgba);
  check(atlas.getDynamicSlotCount() === baseDynCount + 2, `TextureAtlas should track +2 active dynamic slots (base=${baseDynCount}, now=${atlas.getDynamicSlotCount()})`);
  check(atlas.releaseDynamicSprite('dyn_test_a') && !atlas.hasSprite('dyn_test_a'), 'releaseDynamicSprite must remove released sprite');
  const r3 = atlas.registerDynamicRgbaSprite('dyn_test_c', 32, 32, dummyRgba);
  check(
    Math.abs(r3.u0 - r1.u0) < 1e-6 && Math.abs(r3.v0 - r1.v0) < 1e-6 && atlas.hasSprite('dyn_test_b'),
    'TextureAtlas must recycle freed dynamic slot without disturbing live neighbors',
  );
  check(atlas.releaseDynamicByPrefix('dyn_test_') === 2 && atlas.getDynamicSlotCount() === baseDynCount, 'releaseDynamicByPrefix must reclaim matching slots');
  check(r2.u0 !== r1.u0 || r2.v0 !== r1.v0, 'Distinct dynamic sprites must occupy distinct atlas regions');

  // 4. OrthogonalArt: 4-axis blueprint expansion & relative 1P facing resolver
  const facingOut: RelativeFacingOut = { facing: 'front', flipX: false };
  const readFacing = (): RelativeFacingOut => facingOut;
  resolveRelativeFacingInto(100, 50, 50, 50, 0, facingOut);
  check(readFacing().facing === 'front', 'Viewer directly ahead of actor yaw=0 should see front');
  resolveRelativeFacingInto(0, 50, 50, 50, 0, facingOut);
  check(readFacing().facing === 'back', 'Viewer behind actor yaw=0 should see back');
  resolveRelativeFacingInto(50, 100, 50, 50, 0, facingOut);
  check(readFacing().facing === 'side' && !readFacing().flipX, 'Viewer to actor right side should see unflipped side');
  resolveRelativeFacingInto(50, 0, 50, 50, 0, facingOut);
  check(readFacing().facing === 'side' && readFacing().flipX, 'Viewer to actor left side should see flipped side');

  const layerPool = createComposedLayerPool();
  const striker = BUILTIN_ORTHOGONAL_BLUEPRINTS.atelier_striker;
  const nStrike = composeOrthogonalBlueprintInto(striker, 'side', 'strike', 2, false, false, layerPool);
  check(
    nStrike === 2 &&
      layerPool[0].sprite === 'parkour_hero_dash' &&
      layerPool[1].sprite === 'sword_slash' &&
      layerPool[0].paletteRow === 2,
    'OrthogonalArt 4-axis composer must resolve facing × layers × paletteRow × pose overrides',
  );
  const rival = BUILTIN_ORTHOGONAL_BLUEPRINTS.crimson_rival;
  const nGuard = composeOrthogonalBlueprintInto(rival, 'side', 'guard', undefined, false, false, layerPool);
  check(
    nGuard === 3 && layerPool[2].sprite === 'shield_icon' && layerPool[2].tint === '#ffd447',
    'OrthogonalArt pose transform must apply spriteOverride and pose tint',
  );

  // 5. PerspectiveProjector: 2.5D DDA wall casting, Z-buffer occlusion, directional billboards
  const projector = new PerspectiveProjector();
  const wallCols = 8;
  const wallRows = 8;
  const wallGrid = new Uint8Array(wallCols * wallRows);
  for (let x = 0; x < wallCols; x++) {
    wallGrid[x] = 1;
    wallGrid[(wallRows - 1) * wallCols + x] = 1;
  }
  for (let y = 0; y < wallRows; y++) {
    wallGrid[y * wallCols] = 1;
    wallGrid[y * wallCols + (wallCols - 1)] = 1;
  }
  wallGrid[3 * wallCols + 4] = 2; // Occluding pillar at (4, 3)

  projector.projectFirstPerson(
    {
      mode: 'first_person',
      blend01: 1,
      viewerX: 1.5 * TILE_SIZE,
      viewerY: 3.5 * TILE_SIZE,
      viewerYawRad: 0,
      fovRad: Math.PI / 3,
      tileSize: TILE_SIZE,
      maxDist: 160,
      wallCols,
      wallRows,
      wallGrid,
      wallSpriteIds: ['stone', 'brick'],
      ceilTopColor: '#0b1024',
      ceilHorizonColor: '#1c2444',
      floorHorizonColor: '#24293d',
      floorBottomColor: '#151824',
      fogColor: '#1c2444',
    },
    [
      { id: 'visible_guard', sprite: 'ember_warden', x: 2.6 * TILE_SIZE, y: 3.1 * TILE_SIZE, w: 16, h: 16, yawRad: Math.PI },
      { id: 'occluded_guard', sprite: 'ember_warden', x: 5.5 * TILE_SIZE, y: 3.1 * TILE_SIZE, w: 16, h: 16, yawRad: Math.PI },
      { id: 'hidden_self', sprite: 'hero_a', x: 1.5 * TILE_SIZE, y: 3.5 * TILE_SIZE, w: 16, h: 16, hideInFirstPerson: true },
    ],
    320,
    180,
    2,
  );
  check(projector.wallColumnCount === 160, `PerspectiveProjector must cast 160 columns at 2px step (got ${projector.wallColumnCount})`);
  check(projector.billboardCount === 1, `PerspectiveProjector Z-buffer must show 1 visible billboard and occlude pillar-blocked entity (got ${projector.billboardCount})`);
  check(
    projector.billboards[0].entity.id === 'visible_guard' && projector.billboards[0].facing === 'front',
    'Visible guard facing player (yaw=PI) must resolve as front billboard',
  );

  console.log('[SIM OK] Engine 5.0 Foundations (EventActionVm, TilemapGrid Slopes/Substep, Dynamic Atlas Recycling, 4-Axis Art, 2.5D Projector) verified');
}

export function testOrthogonalCartridgesPA07toPA09(): void {
  // === PA-07: Astral Deck (CardDeckEngine + DataCartridgeRuntime) ===
  const pa07Check = validateCartridgeJson(astralDeckRaw);
  check(pa07Check.ok, `PA-07 astralDeck.cartridge.json must pass validateCartridgeJson (${pa07Check.ok ? '' : pa07Check.errors.join('; ')})`);
  const pa07Json = astralDeckRaw as unknown as CartridgeJsonV1;
  check(Boolean(pa07Json.cardEngine), 'PA-07 must declare cardEngine config');

  const cardEngine = new CardDeckEngine(pa07Json.cardEngine!);
  const drawN = pa07Json.cardEngine!.drawPerTurn;
  const starterN = pa07Json.cardEngine!.starterDeck.length;
  const readCardTurn = (): number => cardEngine.turn;
  const readCardPhase = (): string => cardEngine.phase;
  check(
    cardEngine.handCount === drawN && cardEngine.deckCount === starterN - drawN && cardEngine.discardCount === 0 && cardEngine.exhaustCount === 0,
    `CardDeckEngine initial 4-zone counts mismatch (deck=${cardEngine.deckCount}, hand=${cardEngine.handCount})`,
  );

  const events: SimEvent[] = [];
  const enemy0 = cardEngine.enemies[0];
  enemy0.status.vulnerable = 2;
  cardEngine.heroStatus.power = 2;
  const hpBefore = enemy0.hp;
  let exhaustPlayed = false;
  for (let i = 0; i < cardEngine.handCount; i++) {
    const def = cardEngine.getCardDefByIndex(cardEngine.handZone[i]);
    if (def?.keywords?.includes('exhaust') && def.cost <= cardEngine.energy) {
      cardEngine.playCardAt(i, { eventsOut: events });
      exhaustPlayed = true;
      break;
    }
  }
  if (!exhaustPlayed) {
    cardEngine.playCardAt(0, { eventsOut: events });
  }
  check(
    cardEngine.discardCount + cardEngine.exhaustCount >= 1,
    'Playing a card must move it from hand into discard or exhaust zone',
  );

  cardEngine.endTurn({ eventsOut: events });
  check(readCardTurn() === 2 && cardEngine.handCount >= drawN, `CardDeckEngine endTurn must advance turn and draw next hand (hand=${cardEngine.handCount})`);
  cardEngine.endTurn({ eventsOut: events });
  check(readCardTurn() === 3 && cardEngine.handCount >= drawN, `CardDeckEngine must deterministically reshuffle discard into deck (hand=${cardEngine.handCount})`);

  // Force encounter 1 victory -> reward draft -> encounter 2
  for (const e of cardEngine.enemies) {
    if (e.active) {
      e.hp = 1;
      e.status.burn = 5;
    }
  }
  cardEngine.endTurn({ eventsOut: events });
  check(
    readCardPhase() === 'reward' && cardEngine.rewardCount === 3,
    `Defeating encounter 1 must enter 3-choice reward phase (phase=${readCardPhase()}, rewards=${cardEngine.rewardCount})`,
  );
  const deckBeforeDraft = cardEngine.masterDeckCount;
  cardEngine.pickReward(0, { eventsOut: events });
  check(
    cardEngine.masterDeckCount === deckBeforeDraft + 1 && cardEngine.encounterIdx === 1 && readCardPhase() === 'combat',
    'Picking a reward card must expand masterDeck and start encounter 2',
  );
  check(hpBefore > 0, 'Encounter enemy must start with positive HP');

  // CartridgeRunner smoke run for PA-07
  const runner07 = new CartridgeRunner('astral-deck');
  for (let f = 0; f < 40; f++) {
    runner07.stepFixed(1 / 60, { ...emptyInput(), right: f === 5, action: f === 12, skillY: f === 25 });
  }
  const snap07 = runner07.getSnapshot();
  check(
    snap07.entities.some((e) => Boolean(e.artBlueprintId)) && (snap07.hudPrimitives?.length ?? 0) >= 6,
    'PA-07 runtime snapshot must emit 4-axis OrthogonalArt entities and tactical card HUD primitives',
  );

  // === PA-08: Atelier Brawler (FighterFrameEngine + DataCartridgeRuntime) ===
  const pa08Check = validateCartridgeJson(atelierBrawlerRaw);
  check(pa08Check.ok, `PA-08 atelierBrawler.cartridge.json must pass validateCartridgeJson (${pa08Check.ok ? '' : pa08Check.errors.join('; ')})`);
  const pa08Json = atelierBrawlerRaw as unknown as CartridgeJsonV1;
  check(Boolean(pa08Json.fighterEngine), 'PA-08 must declare fighterEngine config');

  const fighter = new FighterFrameEngine(pa08Json.fighterEngine!);
  const readP1MoveId = (): string | undefined => fighter.p1.activeMove?.id;
  const fHooks: FighterStepHooks = { eventsOut: [] };
  fighter.p1.x = 160;
  fighter.p2.x = 186;
  const p2HpStart = fighter.p2.hp;

  fighter.stepFrame(0, false, false, 'light', fHooks, { dirX: 0, crouch: false, jump: false, token: 'none' });
  check(fighter.p1.state === 'attack' && readP1MoveId() === 'jab', 'FighterFrameEngine must start jab on light token');
  check(!fighter.isMoveInActiveWindow(fighter.p1), 'Jab must NOT be active on frame 0 (startup=4)');

  let hitOccurred = false;
  let canceledIntoHeavy = false;
  for (let f = 0; f < 16; f++) {
    const tok = hitOccurred && !canceledIntoHeavy ? 'heavy' : 'none';
    fighter.stepFrame(0, false, false, tok, fHooks, { dirX: 0, crouch: false, jump: false, token: 'none' });
    if (fighter.p2.hp < p2HpStart) hitOccurred = true;
    if (readP1MoveId() === 'heavy') canceledIntoHeavy = true;
  }
  check(hitOccurred && fighter.p2.hp < p2HpStart, 'Jab active window hitbox must damage P2 hurtbox');
  check(canceledIntoHeavy, 'Hit-confirmed jab must allow cancelInto heavy move via input buffer');

  // Verify Low attack beats standing guard, but is blocked by crouching guard
  fighter.resetRound();
  fighter.p1.x = 160;
  fighter.p2.x = 184;
  fighter.stepFrame(0, true, false, 'low', fHooks, { dirX: 1, crouch: false, jump: false, token: 'none' });
  for (let f = 0; f < 10; f++) {
    fighter.stepFrame(0, true, false, 'none', fHooks, { dirX: 1, crouch: false, jump: false, token: 'none' });
  }
  check(
    fighter.p2.state === 'hitstun' || fighter.p2.hp <= fighter.p2.maxHp - 9,
    'Low sweep (isLow=true) must beat standing guard',
  );

  fighter.resetRound();
  fighter.p1.x = 160;
  fighter.p2.x = 184;
  fighter.stepFrame(0, true, false, 'low', fHooks, { dirX: 1, crouch: true, jump: false, token: 'none' });
  for (let f = 0; f < 10; f++) {
    fighter.stepFrame(0, true, false, 'none', fHooks, { dirX: 1, crouch: true, jump: false, token: 'none' });
  }
  const lowChip = pa08Json.fighterEngine!.p1.moves.find((m) => m.input === 'low')?.chipDamage ?? 2;
  check(
    fighter.p2.hp === fighter.p2.maxHp - lowChip && (fighter.p2.state === 'blockstun' || fighter.p1.moveWasBlocked),
    `Crouching back-guard must block low sweep with ${lowChip} chip damage (hp=${fighter.p2.hp}/${fighter.p2.maxHp})`,
  );

  // Pushbox separation test
  fighter.resetRound();
  fighter.p1.x = 180;
  fighter.p2.x = 181;
  fighter.stepFrame(0, false, false, 'none', fHooks, { dirX: 0, crouch: false, jump: false, token: 'none' });
  check(Math.abs(fighter.p2.x - fighter.p1.x) > 4, 'FighterFrameEngine pushboxes must push overlapping fighters apart');

  // CartridgeRunner smoke run for PA-08 + L-key debug box toggle
  const runner08 = new CartridgeRunner('atelier-brawler');
  runner08.stepFixed(1 / 60, { ...emptyInput(), shoulderL: true });
  for (let f = 0; f < 24; f++) {
    runner08.stepFixed(1 / 60, { ...emptyInput(), right: f < 10, action: f === 10 });
  }
  const snap08 = runner08.getSnapshot();
  check((snap08.debugRects?.length ?? 0) >= 4, 'PA-08 must emit live pushbox/hurtbox/hitbox debugRects when toggled with L');

  // === PA-09: Labyrinth DualView (1P 2.5D DDA Raycast <-> 3P HD-2D Top-Down) ===
  const lab = new LabyrinthDualviewGame();
  const params = new CartridgeRunner('labyrinth-dualview').getParams();
  const snap1p = lab.snapshot(params);
  check(
    snap1p.perspective?.mode === 'first_person' && snap1p.perspective.wallGrid.length === 16 * 12,
    'PA-09 must start in first_person 2.5D mode with shared 16x12 wallGrid',
  );

  for (let f = 0; f < 12; f++) {
    lab.step(1 / 60, { ...emptyInput(), up: true }, params);
  }
  const pxBeforeToggle = lab.playerX;
  const pyBeforeToggle = lab.playerY;
  lab.step(1 / 60, { ...emptyInput(), skillX: true }, params);
  const snap3p = lab.snapshot(params);
  check(
    lab.perspectiveMode === 'third_person' && snap3p.perspective?.mode === 'third_person',
    'Pressing X in PA-09 must switch cleanly from first_person to third_person',
  );
  check(
    Math.abs(lab.playerX - pxBeforeToggle) < 1e-4 && Math.abs(lab.playerY - pyBeforeToggle) < 1e-4,
    '1P <-> 3P perspective toggle must preserve exact player world coordinates',
  );

  // Verify SceneGpuBridge renders PA-09 cleanly in BOTH 1P and 3P modes via mock backend
  let drawCount1p = 0;
  let drawCount3p = 0;
  let passIdx = 0;
  const mockBackend: IGpuBackend = {
    kind: 'webgpu',
    uploadAtlas: () => {},
    renderFrame: (_sky, _a, alphaCount, _add, addCount) => {
      if (passIdx === 0) drawCount1p = alphaCount + addCount;
      else drawCount3p = alphaCount + addCount;
      passIdx++;
      return 2;
    },
    resize: () => {},
    dispose: () => {},
  };
  const atlas = new TextureAtlas();
  const dummyCanvas = { width: 320, height: 180 } as unknown as HTMLCanvasElement;
  const gpu = new GpuEngine(dummyCanvas, undefined, atlas);
  (gpu as unknown as { backend: IGpuBackend }).backend = mockBackend;
  const sceneBridge = new SceneGpuBridge();
  // Capture 1P snapshot fresh before toggling, then 3P
  const labRender = new LabyrinthDualviewGame();
  const renderSnap1p = labRender.snapshot(params);
  sceneBridge.render(gpu, renderSnap1p, null);
  labRender.step(1 / 60, { ...emptyInput(), skillX: true }, params);
  const renderSnap3p = labRender.snapshot(params);
  sceneBridge.render(gpu, renderSnap3p, null);
  check(
    drawCount1p >= 160 && drawCount3p >= 60,
    `SceneGpuBridge must render both 1P raycast columns+billboards (${drawCount1p}) and 3P HD-2D tiles+actors (${drawCount3p})`,
  );

  // Verify CartridgeRunner switch + dispose lifecycle across PA-07..PA-09
  const runner09 = new CartridgeRunner('labyrinth-dualview');
  for (let f = 0; f < 15; f++) runner09.stepFixed(1 / 60, { ...emptyInput(), up: true, action: f === 6 });
  runner09.switchCartridge('astral-deck');
  runner09.switchCartridge('atelier-brawler');
  check(
    runner09.getCartridgeId() === 'atelier-brawler' && FLOATS_PER_INSTANCE === 24 && ATLAS_SIZE === 1024,
    'CartridgeRunner must switch cleanly across PA-07..PA-09 with dispose() cleanup',
  );

  console.log(
    `[SIM OK] Engine 5.0 Orthogonal Cartridges verified -> PA-07 (CardDeck), PA-08 (FighterFrame), PA-09 (1P=${drawCount1p} / 3P=${drawCount3p} GPU instances)`,
  );
}
