/// <reference types="node" />
import { registerBuiltinCartridges } from '../src/game/BuiltinCartridges.ts';
import {
  testArchitectureBoundariesAndLifecycle,
  testHd2dDepthPipeline,
  testM3LoadCartridgeAndPngCodec,
  testM41DynamicViewportAndCamera,
  testStructuredLoggingAndErrorRecovery,
  testUpgradedGpuPipelineAndAtlas,
  testM42M43ChunkedWorldsAndMultiLayerDepth,
  testProceduralDeclarativeCompiler,
} from './sim/ArchitectureTests.ts';
import {
  testCelestialParkourAndGrappleEngine3,
  testCloudberryHop,
  testSandboxBenchmark,
  testSugarStarlight,
  testSystemicChainReactionAndPuzzles,
} from './sim/CartridgeActionTests.ts';
import {
  testAstralChronicles,
  testEmberkeepDndAndAgentBridge,
  testSramSaveHydrateRoundtrips,
} from './sim/CartridgeRpgTests.ts';
import {
  testCoreSubsystems,
  testDungeonGeneratorSolvability,
  testEngine2CameraAndCutscene,
  testM2EnginePrimitives,
  testModule1ColorMathAndShaderParity,
  testModule2SpringsAndNoiseOracle,
  testModule3SpatialVisibilityAndPathfindingOracle,
} from './sim/CoreSubsystemTests.ts';
import { testExtensibilityAndAiSpis } from './sim/ExtensibilityAiTests.ts';
import { testHalAndInputPipeline } from './sim/HalAndInputTests.ts';

async function runAll() {
  registerBuiltinCartridges();

  testCoreSubsystems();
  testModule1ColorMathAndShaderParity();
  testModule2SpringsAndNoiseOracle();
  testModule3SpatialVisibilityAndPathfindingOracle();
  testM2EnginePrimitives();
  testEngine2CameraAndCutscene();
  testDungeonGeneratorSolvability();
  testSramSaveHydrateRoundtrips();
  testCloudberryHop();
  testSugarStarlight();
  testSystemicChainReactionAndPuzzles();
  testSandboxBenchmark();
  testEmberkeepDndAndAgentBridge();
  testAstralChronicles();
  testCelestialParkourAndGrappleEngine3();
  testHd2dDepthPipeline();
  testHalAndInputPipeline();
  testArchitectureBoundariesAndLifecycle();
  await testExtensibilityAndAiSpis();
  testUpgradedGpuPipelineAndAtlas();
  await testStructuredLoggingAndErrorRecovery();
  await testM3LoadCartridgeAndPngCodec();
  testM41DynamicViewportAndCamera();
  testM42M43ChunkedWorldsAndMultiLayerDepth();
  testProceduralDeclarativeCompiler();
  console.log('[SIM ALL PASSED] Pixel Atelier Engine 3.0 & All 6 Cartridges (PA-01..PA-06) Passed!');
}

void runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
