/// <reference types="node" />
import { registerAllBuiltinCartridges } from '../src/game/BuiltinCartridges.ts';
import {
  testArchitectureBoundariesAndLifecycle,
  testHd2dDepthPipeline,
  testM3LoadCartridgeAndPngCodec,
  testM41DynamicViewportAndCamera,
  testM42M43ChunkedWorldsAndMultiLayerDepth,
  testProceduralDeclarativeCompiler,
  testStructuredLoggingAndErrorRecovery,
  testUpgradedGpuPipelineAndAtlas,
} from './sim/ArchitectureTests.ts';
import {
  testCloudberryHop,
  testCoreSramSaveHydrateRoundtrips,
  testSugarStarlight,
} from './sim/CartridgeActionTests.ts';
import {
  testCoreSubsystems,
  testEngine2CameraAndCutscene,
  testM2EnginePrimitives,
  testModule1ColorMathAndShaderParity,
  testModule2SpringsAndNoiseOracle,
  testModule3SpatialVisibilityAndPathfindingOracle,
} from './sim/CoreSubsystemTests.ts';
import { testExtensibilityAndAiSpis } from './sim/ExtensibilityAiTests.ts';
import { testHalAndInputPipeline } from './sim/HalAndInputTests.ts';
import { testPixer7EcsMultiPageAtlasAndSlimCore } from './sim/Pixer7Tests.ts';

async function runAll() {
  await registerAllBuiltinCartridges();

  testCoreSubsystems();
  testModule1ColorMathAndShaderParity();
  testModule2SpringsAndNoiseOracle();
  testModule3SpatialVisibilityAndPathfindingOracle();
  testM2EnginePrimitives();
  testEngine2CameraAndCutscene();
  testCoreSramSaveHydrateRoundtrips();
  testCloudberryHop();
  testSugarStarlight();
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
  testPixer7EcsMultiPageAtlasAndSlimCore();
  console.log('[SIM ALL PASSED] Pixer Core PBR/ECS Engine & Focused Flagship Cartridges (PA-01, PA-02, PA-11, PA-12, PA-14, PA-15) Passed!');
}

void runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
