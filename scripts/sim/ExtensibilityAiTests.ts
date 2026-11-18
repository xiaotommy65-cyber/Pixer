import { TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { createAgentBridge } from '../../src/core/ai/AgentBridge.ts';
import { HybridAiDirector, type AiProvider } from '../../src/core/ai/AiProvider.ts';
import { RemoteHttpAiProvider } from '../../src/core/ai/RemoteAiProvider.ts';
import { ToySynth } from '../../src/core/audio/ToySynth.ts';
import { getCartridgeControlProfile, listCartridgeIds } from '../../src/core/runtime/CartridgeRegistry.ts';
import { CartridgeRunner, STEP_DT } from '../../src/core/runtime/CartridgeRunner.ts';
import { EngineHost } from '../../src/core/runtime/EngineHost.ts';
import { EngineEventBus } from '../../src/core/runtime/EventBus.ts';
import { SaveService } from '../../src/core/runtime/SaveService.ts';
import {
  btAction,
  btCondition,
  btCooldown,
  btSelector,
  btSequence,
  btUtilitySelector,
} from '../../src/core/sim/BehaviorTree.ts';
import { RuleRegistry, type RuleEntityLike, type RuleWorldActions } from '../../src/core/sim/RuleMatrix.ts';
import type { CartridgeInstance } from '../../src/core/types/WorldTypes.ts';
import { SandboxToyboxGame } from '../../src/game/sandbox/SandboxToyboxGame.ts';
import { check } from './SimTestHarness.ts';

export async function testExtensibilityAndAiSpis(): Promise<void> {
  // 1. EngineEventBus: pub/sub, once, disposers & fault isolation
  const bus = new EngineEventBus();
  let seen = 0;
  let onceCount = 0;
  const offThrow = bus.on('cartridge:restarted', () => {
    throw new Error('simulated subscriber error');
  });
  const offCount = bus.on('cartridge:restarted', () => {
    seen++;
  });
  bus.once('cartridge:restarted', () => {
    onceCount++;
  });
  bus.emit('cartridge:restarted', { id: 'cloudberry-hop' });
  bus.emit('cartridge:restarted', { id: 'cloudberry-hop' });
  check(seen === 2 && onceCount === 1, 'EngineEventBus must isolate errors and honor once/repeat listeners');
  offThrow();
  offCount();
  check(bus.listenerCount('cartridge:restarted') === 0, 'EngineEventBus disposers must remove all listeners cleanly');

  // 2. Composable BehaviorTree & UtilitySelector
  interface BtTestBb {
    hp: number;
    time: number;
    picked: string;
  }
  const tree = btUtilitySelector<BtTestBb>([
    {
      id: 'heal',
      score: (bb) => (bb.hp < 30 ? 100 : 0),
      node: btCooldown(
        5,
        (bb) => bb.time,
        btSequence([
          btCondition((bb) => bb.hp < 30),
          btAction((bb) => {
            bb.picked = 'heal';
          }),
        ]),
      ),
    },
    {
      id: 'attack',
      score: () => 50,
      node: btSelector([
        btAction((bb) => {
          bb.picked = 'attack';
        }),
      ]),
    },
  ]);
  const bb: BtTestBb = { hp: 20, time: 0, picked: '' };
  const readPicked = (): string => bb.picked;
  tree.tick(bb);
  check(readPicked() === 'heal', 'UtilitySelector should choose highest utility branch (heal)');
  bb.time = 2;
  tree.tick(bb);
  check(readPicked() === 'attack', 'Cooldown should fall through to second utility branch (attack)');

  // 3. Dynamic RuleRegistry priority & unregister
  const rules = new RuleRegistry([]);
  const calls: string[] = [];
  const offLow = rules.register({
    id: 'low-prio',
    sourceTag: 'burning',
    targetTag: 'flammable',
    priority: 1,
    onOverlap: () => calls.push('low'),
  });
  rules.register({
    id: 'high-prio',
    sourceTag: 'burning',
    targetTag: 'flammable',
    priority: 10,
    onOverlap: () => calls.push('high'),
  });
  const dummyEnt = (tags: ('burning' | 'flammable')[]): RuleEntityLike => ({
    id: 'e',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    w: 16,
    h: 16,
    alive: true,
    tags: new Set(tags),
    flashTimer: 0,
    scaleX: 1,
    scaleY: 1,
    sprite: 'crate',
  });
  const dummyActions: RuleWorldActions = {
    emit: () => {},
    addScore: () => {},
    unlockGates: () => {},
    spawnBurst: () => {},
    triggerJuice: () => {},
    detonateAt: () => {},
  };
  rules.evaluatePair(dummyEnt(['burning']), dummyEnt(['flammable']), dummyActions, STEP_DT);
  check(calls[0] === 'high' && calls[1] === 'low', 'RuleRegistry should evaluate rules in descending priority');
  offLow();
  check(rules.listRules().length === 1, 'RuleRegistry disposer should remove unregistered rule');

  // 4. Plugin Cartridge Registry + Unified Observation
  const runner = new CartridgeRunner('cloudberry-hop');
  const host = new EngineHost(runner, new ToySynth(), new SaveService());
  const pluginStub: CartridgeInstance = {
    step: () => [],
    getStatus: () => 'playing',
    snapshot: () => ({
      cartridgeId: 'plugin-demo',
      skyTop: '#123456',
      skyBottom: '#abcdef',
      cozyFilter: false,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 777,
      starsCollected: 2,
      starsTotal: 5,
      hasKey: false,
      hearts: 3,
      maxHearts: 3,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      bgStars: [],
      bgClouds: [],
      tiles: [],
      entities: [],
      particles: [],
      lights: [],
      statusBanner: 'Plugin Ready',
    }),
  };
  const disposePlugin = host.registerCartridgePlugin({
    meta: {
      id: 'plugin-demo',
      code: 'PL-01',
      title: '外掛測試卡帶',
      subtitle: 'Runtime Plugin',
      genre: '外掛測試',
      accentHex: '#56d39c',
      badgeText: 'Plugin',
      controlsHint: 'A/B Test',
      goalHint: 'Test plugin lifecycle',
      defaultScript: '',
    },
    aiCapabilities: ['stage-gen'],
    factory: () => pluginStub,
    resolveControlProfile: () => ({
      a: '外掛A',
      b: '外掛B',
      x: '外掛X',
      y: '外掛Y',
      l: 'L',
      r: 'R',
      rightStick: '視角',
      legend: 'Plugin controls active',
    }),
  });
  check(listCartridgeIds().includes('plugin-demo'), 'registerCartridgePlugin should register plugin ID dynamically');
  check(getCartridgeControlProfile('plugin-demo').a === '外掛A', 'Plugin should resolve custom control profile');
  host.insertWithSram('plugin-demo');
  const uniObs = host.getUnifiedObservation();
  check(uniObs.cartridgeId === 'plugin-demo' && uniObs.score === 777, 'UnifiedGameObservation should inspect plugin cartridges');
  disposePlugin();
  check(!listCartridgeIds().includes('plugin-demo'), 'disposePlugin should unregister plugin cleanly');

  // 5. HybridAiDirector (LocalProceduralAiProvider + failing Remote proxy fallback)
  let aiCompletedEvents = 0;
  const offAi = bus.on('ai:task_completed', () => {
    aiCompletedEvents++;
  });
  const failingRemote: AiProvider = {
    id: 'failing-proxy',
    mode: 'remote-http',
    generateStageRecipe: async () => {
      throw new Error('network offline');
    },
  };
  const director = new HybridAiDirector(bus, failingRemote);
  check(director.getProviderInfo().hasRemotePrimary === true, 'HybridAiDirector should report remote primary in hybrid mode');

  const stageRes = await director.generateStageRecipe({ cartridgeId: 'sandbox-toybox', theme: '暗影水晶' });
  const sbVerify = new SandboxToyboxGame(stageRes.payload);
  check(sbVerify.scriptError === null, `AI-generated sandbox recipe must run cleanly (err=${sbVerify.scriptError})`);

  const dialogRes = await director.generateDynamicDialog({
    cartridgeId: 'astral-chronicles',
    speaker: '長老',
    contextHint: '星穹神殿',
    heroLevel: 4,
  });
  check(dialogRes.lines.length >= 1 && dialogRes.choices.length >= 1, 'HybridAiDirector should generate dialog & choices');

  const spriteRes = await director.generatePixelSprite({ id: 'ai_gem_test', theme: 'azure', width: 16, height: 16 });
  check(spriteRes.rgba.length === 16 * 16 * 4, 'LocalProceduralAiProvider should synthesize 16x16 RGBA sprite buffer');

  // 6. Verify CartridgeRunner EventBus parity & host.bindAtlas() sprite sync
  const boundAtlas = new TextureAtlas();
  host.bindAtlas(boundAtlas);
  let restartEvents = 0;
  let spriteRegisteredEvents = 0;
  const offRestart = host.events.on('cartridge:restarted', () => restartEvents++);
  const offSprReg = host.events.on('sprite:registered', (p) => {
    if (p.spriteId === 'ai_bound_test') spriteRegisteredEvents++;
  });
  host.insertWithSram('cloudberry-hop');
  host.retryStage();
  check(restartEvents === 1, 'CartridgeRunner.retryStage() must emit cartridge:restarted event');
  await host.ai.generatePixelSprite({ id: 'ai_bound_test', theme: 'emerald', width: 16, height: 16 });
  check(
    boundAtlas.hasSprite('ai_bound_test') && spriteRegisteredEvents === 1,
    'host.bindAtlas() must auto-register generated AI sprites and emit sprite:registered',
  );
  offRestart();
  offSprReg();

  const agent = createAgentBridge(runner, director);
  agent.switchCartridge('sugar-starlight');
  const advice = await agent.adviseAction();
  check(advice.recommendedActionId === 'launch_sortie', `AI tactical advice should recommend launch_sortie in hangar (got ${advice.recommendedActionId})`);
  check(aiCompletedEvents >= 2, 'HybridAiDirector should emit ai:task_completed events including fallback runs');
  offAi();
  host.destroy();

  // 7. Verify RemoteHttpAiProvider transient 503 single retry
  const origFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    if (fetchCalls === 1) {
      return new Response('busy', { status: 503, statusText: 'Service Unavailable' });
    }
    return new Response(JSON.stringify({ recommendedActionId: 'fire', rationale: 'retry ok', confidence: 0.9 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const remote = new RemoteHttpAiProvider({ baseUrl: 'https://example.invalid/api/ai', timeoutMs: 2000 });
    const retried = await remote.adviseTacticalAction({
      observation: agent.getUnifiedObservation(),
    });
    check(fetchCalls === 2 && retried.recommendedActionId === 'fire', 'RemoteHttpAiProvider must retry once on transient 503');
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('[SIM OK] Extensibility SPIs (EventBus / BehaviorTree / RuleRegistry / PluginRegistry / HybridAiDirector) verified');
}
