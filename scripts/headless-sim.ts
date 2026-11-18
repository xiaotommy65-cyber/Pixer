/// <reference types="node" />
import { registerBuiltinCartridges } from '../src/game/BuiltinCartridges.ts';
import {
  testArchitectureBoundariesAndLifecycle,
  testHd2dDepthPipeline,
  testM3LoadCartridgeAndPngCodec,
  testM41DynamicViewportAndCamera,
  testStructuredLoggingAndErrorRecovery,
  testUpgradedGpuPipelineAndAtlas,
} from './sim/ArchitectureTests.ts';
import {
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
} from './sim/CoreSubsystemTests.ts';
import { testExtensibilityAndAiSpis } from './sim/ExtensibilityAiTests.ts';
import { testHalAndInputPipeline } from './sim/HalAndInputTests.ts';

async function runAll() {
  registerBuiltinCartridges();

  testCoreSubsystems();
  testModule1ColorMathAndShaderParity();
  testModule2SpringsAndNoiseOracle();
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
  testHd2dDepthPipeline();
  testHalAndInputPipeline();
  testArchitectureBoundariesAndLifecycle();
  await testExtensibilityAndAiSpis();
  testUpgradedGpuPipelineAndAtlas();
  await testStructuredLoggingAndErrorRecovery();
  await testM3LoadCartridgeAndPngCodec();
  testM41DynamicViewportAndCamera();
  console.log('[SIM ALL PASSED] Pixel Atelier Engine 2.0 & All 5 Cartridges (PA-01..PA-05) Passed!');
}

void runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
