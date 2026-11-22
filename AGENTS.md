# Pixer (Pixel Atelier) — Engine-First Constitution & File Map

## 1. Engine-First Identity (Pixel-Craft PBR GPU Engine)
- **Core Mandate**: Pixer is a Zero-GC, vanilla TypeScript **HD-2D Pixel PBR-Lite Engine** (`WebGPU` WGSL / `WebGL2` GLSL ES 3.00 / `Canvas2DBackend` fallback, `1280×720` viewport ceiling, 24-float PBR instancing, 8-page `1024×1024` `Texture2DArray` Atlas Pool, True Generational `EcsCoreWorld` + 5-phase 14-system pipeline + Sandboxed Script VM, pure data-driven Multi-Room HD-2D Tilemap & Top-Down Adventure runtime, 6DoF `CameraRigDirector`, `GameFlowController`, and Web Audio synth).
- **Unified Shells**: Single primary **True ECS Workstation** (`EcsWorkbenchView` + `EcsMapDesignerPanel` + `EventGraphEditorView` + `SpriteAtelierView` modal) + tactile Switch **Arcade Showcase** (`ConsoleView`, `PA-01..PA-14`) + **Standalone Immersive Game Host** (`PA-13`).
- Read `docs/ROADMAP.md` for Engine 10.5 → M1..M4 milestones and `docs/HANDOFF.md` + `docs/NEXT_CHAT_PROMPT.md` for session handoff.

## 2. Repository & File Guide Map (Read this first instead of broad grep)

### Root & Configuration
- `src/main.ts` — App bootstrap (`createAppSafe()`), single RAF loop, lazy on-demand `GpuEngine` lifecycle (`ensureArcadeGpuInit`), `DisplayThermalGovernor`, `EngineHost`, `PixerPlatformShell`, `EcsWorkbenchView` (defaults to `PA-14`), `SpriteAtelierView` modal, `ConsoleView`, `RhythmWorkspaceView`, and `window.__PIXEL_ATELIER_AGENT__`.
- `src/AppShellHelpers.ts` — OS utility bar, landscape orientation controller, PNG card capture/share, global error handlers, 3-step `recoverFromFrameError` ladder.
- `vite.config.ts` / `capacitor.config.ts` / `tsconfig.json` — Vite + `VitePWA` (`base: './'`, lazy `legacy-cartridges`), Capacitor shell, strict TS (`strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`).

### `src/core/` — Pure Engine Core (100% DOM-free except `gpu/` & `audio/`, never import `ui/` or `game/`)
- `src/core/gpu/` — Multi-backend instanced 2D/HD-2D PBR-Lite renderer:
  - `GpuEngine.ts`, `WebGpuBackend.ts` & `WebGpuShaders.ts` (WGSL), `WebGl2Backend.ts` & `WebGl2Shaders.ts` (GLSL ES 3.00), `Canvas2DBackend.ts`, `GpuTypes.ts` (`MAX_ATLAS_PAGES=8`, `FLOATS_PER_INSTANCE=24`), `Stage3DPipeline.ts` (slated for M4 `GpuEngine` migration).
- `src/core/ecs/` — True Zero-GC Generational ECS + Multi-Room HD-2D WorldMap + Sandboxed Script VM:
  - `EntityManager.ts`, `ComponentStore.ts` (17 sparse-set stores), `EcsCoreWorld.ts`, `EcsProjectSchema.ts`, `EcsWorld.ts`, `SandboxScriptVm.ts`, `EcsEventGraph.ts`, `EcsActionPhysicsSystems.ts`, `EcsTilemapTypes.ts` (3-layer tilemaps, `tileDefs`, `heroConfig`, `interactions`, `aiProfiles`), `EcsWorldMapController.ts` (100% data-driven top-down/portal/AI runtime), `EcsCartridgeRuntime.ts` (14 systems + 2D/HD-2D/1P 2.5D), `EcsStudioSession.ts` (26 transactional Undo/Redo commands including `stamp_room_ascii`, `ECS_COMMAND_CATALOG`).
- `src/core/runtime/` — Orchestration, 6DoF camera, multi-scene flow & persistence:
  - `EngineHost.ts` (**Sole facade** for `src/ui/`; never access `.runner`), `CameraRigDirector.ts`, `GameFlowController.ts`, `CartridgeRunner.ts`, `CartridgeRegistry.ts`, `CartridgePngCodec.ts`, `SceneGpuBridge.ts`, `DisplayThermalGovernor.ts`, `SaveService.ts`, `AppLogger.ts`, `LogPersistence.ts`, `EventBus.ts`, `SeededRng.ts`.
- `src/core/sim/` & `src/core/editor/` — Shared 2D/2.5D primitives (`WorldKernel`, `DataCartridgeRuntime`, `TilemapGrid`, `SoaEntityPool`, `EventActionVm`, `OrthogonalArt`, `DualPerspectiveRuntime`, `JuiceSystem`, `CameraDirector`, `CutsceneSequencer`) & DOM-free `StudioSession`/`StudioCommands` (powers `PA-10`).
- `src/core/rhythm/` & `src/core/audio/` — DOM-free 4K rhythm engine (`RhythmTypes`, `RhythmAutoCharter`, `RhythmBuiltinSongs`, `RhythmJudgeEngine`, `RhythmProgression`, `RhythmChartSession`) + Web Audio (`ToySynth`, `AudioBus`, `BgmSequencer`, `RhythmAudioEngine` w/ 32-band `AnalyserNode`).
- `src/core/input/`, `src/core/hal/`, `src/core/ai/`, `src/core/math/`, `src/core/types/` — Input DSP, HAL, AI-Native Editor Stack (`AgentBridge`, `PixerMcpProtocol`, `EcsSpatialOracle` w/ `renderRoomAscii` + `analyzeWorldMapReachability` BFS solver, `EcsPlaytestVerifier` w/ `in_room` & `boss_hp_lte`), Oklab/Bayer `ColorMath`, `NoiseMath`, `SpringDynamics`, `SpatialHash`, `Visibility2D`, and shared types.

### `src/assets/` & `src/game/` — Procedural Pixel Atlas & Cartridges (100% DOM-free)
- `src/assets/` — `TextureAtlas.ts` (8-page `1024×1024` Atlas Pool + PNG Slicer), `AtlasSpritesData.ts`, `src/assets/sprites/*` (`CastleSprites` 31 PBR 32px/48×64 sprites, `HdMaterialSprites`, `ParkourSprites`, `AutoTileSprites`, `PixelFontData`), `AudioPatterns.ts`, `WorkshopRecipes.ts`.
- `src/game/` — `BuiltinCartridges.ts` (`PA-01`, `PA-02`, `PA-07`, `PA-08`, `PA-10`, `PA-11`, `PA-12`, `PA-13`, `PA-14`), `obsidianCitadel/ObsidianCitadelProject.ts` (pure data-driven `PA-14`), + lazy `LegacyCartridgePack.ts` (`PA-03..PA-06`, `PA-09`).

### `src/ui/` & `src/styles/` — Single Workstation, Handheld Showcase & Standalone Game Host
- Workstation & Rhythm: `PixerPlatformShell.ts`, `EcsWorkbenchView.ts` (lazy `previewGpu`), `EcsMapDesignerPanel.ts` (multi-room 32px tile painter, custom `tileDefs` palette, prefab stamps & portals), `EventGraphEditorView.ts`, `SpriteAtelierView.ts`, `RhythmWorkspaceView.ts`, `RhythmOverlays.ts`, `RhythmArtRegistry.ts`, `RhythmStageRenderer.ts`, `RhythmChartStudioView.ts`, `RhythmStorage.ts`.
- Arcade Shell: `ConsoleView.ts`, `ConsoleShellRouter.ts`, `ConsoleBodyBuilder.ts`, `ConsoleJoyconBuilder.ts`, `ConsoleHudPresenter.ts`, `CartridgeSlotController.ts`, `BootBlinkOverlay.ts`, `DeskWorldView.ts`, `WindowDioramaView.ts`, `HomeLobbyView.ts`, `AngledSystemMenuView.ts`, `CartridgeDrawerView.ts`, `IrisWipeTransition.ts`, `MomoMascot.ts`, `CardArt.ts`, `BrowserAssetLoader.ts`.
- HUDs/Native/Styles: `ShmupOverlayView.ts`, `RpgOverlayView.ts`, `ChronicleOverlayView.ts`, `SystemSettingsDrawerView.ts`, `VirtualGamepadInput.ts`, `CapacitorNativeBridge.ts`, `PwaBridge.ts`, `PixelIcons.ts`, `dom.ts`; `src/styles/{studio7,rhythm,atelier,switch,lobby}.css`.

### `scripts/` — Verification & MCP Server
- `scripts/headless-sim.ts` (`npm run sim`), `scripts/pixer-mcp.ts` (`npm run mcp`), `scripts/sim/*` (`ArchitectureTests.ts`, `WorldMap.test.ts` w/ Engine Core Purity Gate & MCP Dogfooding, `Engine10Core.test.ts`, `RhythmCore.test.ts`, `Pixer7Tests.ts`, `StudioEditorTests.ts`, `CoreSubsystemTests.ts`, `CartridgeActionTests.ts`, `CartridgeRpgTests.ts`, `HalAndInputTests.ts`, `ExtensibilityAiTests.ts`, `OrthogonalEngineTests.ts`).

## 3. Non-Negotiable Engine-First Constraints (Enforced by `ArchitectureTests.ts` & `WorldMap.test.ts`)
- **Native GPU Pixel PBR Mandate**: All flagship stages MUST render via Pixer's WebGPU/WebGL2 PBR-Lite + Multi-Page Pixel Atlas (`GpuEngine`) with nearest/pixelated scaling, Oklab palettes, and Bayer 4×4 dithering. **NEVER** drop photorealistic AI-generated `.jpg`/`.png` wallpapers into `src/assets/` or `public/assets/`, and never ship isolated Canvas 2D shadow renderers bypassing `GpuEngine`.
- **Pure Data-Driven Core & AI-Native Authoring**: `src/core/ecs/` and `src/ui/` MUST contain ZERO game-specific hardcoding (enforced by Engine Core Purity Gate in `WorldMap.test.ts`). Every new engine capability MUST be authorable via transactional `EcsStudioCommand`s + exposed through `PixerMcpProtocol` / `AgentBridge`.
- **Single Workstation & Lazy GPU Lifecycle**: Keep ONE authoring workstation (`EcsWorkbenchView` + `SpriteAtelierView` modal). Never reintroduce deleted legacy Studio 6.0 UI shells. Lazy-initialize GPU contexts on demand.
- **Zero-GC & Zero External Bloat**: No per-frame allocations in hot loops (`gpu/`, `ecs/`, `sim/`, `SceneGpuBridge`, `game/`). Keep vanilla TypeScript + WebGPU/WebGL2 + Web Audio; do NOT install external rendering, physics, or audio frameworks.
- **Layer & Security Boundaries**: `src/core/` & `src/assets/` MUST NOT import `src/ui/`, `src/game/`, `@capacitor`, or `virtual:pwa-register`. `src/core/{ai,ecs,editor,hal,input,math,rhythm,runtime,sim,types}/`, `src/assets/`, `src/game/` stay 100% DOM-free. `src/ui/` uses `EngineHost` (never `.runner`), `AbortController`, and `public destroy()`. Zero `eval()`/`new Function()`. Zero orphan assets in `public/assets/`.
- **Verification Gate**: After edits, run `npm run lint && npm run sim` + unit tests (`npx --yes tsx --test src/core/ecs/EcsCore.test.ts scripts/sim/Engine10Core.test.ts scripts/sim/RhythmCore.test.ts scripts/sim/WorldMap.test.ts`) (+ `npm run build` for shader/UI/build changes). Keep `AGENTS.md <= 120` lines.
