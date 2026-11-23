# Pixer Codebase Navigation Map (Zero-Grep Routing Guide)

> **Purpose**: Read this file FIRST (together with `AGENTS.md`) to locate exact files, symbols, and cross-module call chains in **1 lookup** instead of broad directory scans.
> **Snapshot**: 194 code files · ~94,450 LOC · Primary Entry: `src/main.ts` · Worker Entry: `src/workers/interop.worker.ts` · Edge API Entry: `workers/api/src/index.ts`.

---

## 1. End-to-End Runtime Architecture & Call Chains

```mermaid
flowchart LR
  Main[src/main.ts<br/>RAF + Shell + ?play=slug] --> Host[EngineHost.ts<br/>Sole UI Facade]
  Main --> Workbench[EcsWorkbenchView.ts<br/>Single Authoring Shell]
  Main --> Console[ConsoleView.ts<br/>Switch Arcade Shell]
  Main --> Cloud[CloudSyncClient.ts]

  Host --> Runner[CartridgeRunner.ts<br/>60Hz Fixed Step]
  Host --> Audio[ExternalAudioBank.ts<br/>CDN Opus/MP3 + LRU]
  Host --> Save[SaveService.ts<br/>LocalStorage SRAM]
  Host --> HAL[SystemHal + HapticEngine]
  Host --> AI[HybridAiDirector<br/>Local / RemoteHttpAiProvider]

  Runner --> EcsRT[EcsCartridgeRuntime.ts<br/>PA-14/15/11/12 True ECS]
  Runner --> DataRT[DataCartridgeRuntime.ts<br/>PA-01/02 Legacy Data RT]

  EcsRT --> EcsWorld[EcsCoreWorld + WorldMapController<br/>+ ActionPhysics + SandboxScriptVm]
  EcsRT --> Bridge[SceneGpuBridge.ts]
  DataRT --> Bridge
  Bridge --> GPU[GpuEngine.ts<br/>WebGPU / WebGL2 / Canvas2D]
  GPU --> Atlas[TextureAtlas.ts<br/>8x 1024x1024 Pool]

  Workbench --> Session[EcsStudioSession.ts<br/>Transactional Undo/Redo]
  Workbench --> Panels[MapDesigner / WorldRules<br/>Atlas / Prefab / EventGraph]
  Workbench --> WorkerClient[InteropWorkerClient.ts]
  WorkerClient --> Worker[src/workers/interop.worker.ts<br/>Aseprite / LDtk / Tiled / ZIP]

  Cloud -->|HTTP| EdgeAPI[workers/api/src/index.ts<br/>Cloudflare Workers]
  EdgeAPI --> R2[(Cloudflare R2<br/>Assets & Bundles)]
  EdgeAPI --> Supa[(Supabase Postgres<br/>+ Auth + RLS)]
  EdgeAPI --> MCP[PixerMcpProtocol.ts]
```

---

## 2. Task-to-File Quick Routing Table (Jump Straight Here)

| 要修改／排查的功能 | 必看入口檔（按順序） | 對應驗證測試 |
|---|---|---|
| **啟動流程、`?play=<slug>`、雙模式切換** | `src/main.ts` → `src/AppShellHelpers.ts` → `src/ui/PixerPlatformShell.ts` | `npm run build` |
| **WebGPU / WebGL2 / Canvas2D PBR 著色器與打光** | `src/core/gpu/GpuEngine.ts` → `WebGpuBackend.ts` / `WebGpuShaders.ts` / `WebGl2Backend.ts` / `WebGl2Shaders.ts` → `SceneGpuBridge.ts` | `scripts/sim/ArchitectureTests.ts`, `CoreSubsystemTests.ts` |
| **8 頁圖集、自訂精靈編譯、調色盤** | `src/assets/TextureAtlas.ts` → `src/core/ecs/EcsCustomSpriteCompiler.ts` → `src/assets/sprites/PaletteData.ts` | `scripts/sim/WorldMap.test.ts`, `Pixer7Tests.ts` |
| **真 ECS 世界、多房間地圖、傳送門、機關、AI** | `src/core/ecs/EcsCartridgeRuntime.ts` → `EcsWorldMapController.ts` → `EcsActionPhysicsSystems.ts` → `EcsProjectSchema.ts` / `EcsTilemapTypes.ts` | `src/core/ecs/EcsCore.test.ts`, `scripts/sim/WorldMap.test.ts` |
| **ECS 編輯器交易指令（Undo/Redo）與 MCP 工具** | `src/core/ecs/EcsStudioSession.ts` → `src/core/ai/PixerMcpProtocol.ts` → `src/core/ai/AgentBridge.ts` → `scripts/pixer-mcp.ts` | `src/core/ecs/EcsCore.test.ts`, `WorldMap.test.ts` |
| **無損事件圖 ↔ 腳本 VM** | `src/core/ecs/EcsEventGraph.ts` → `src/core/ecs/SandboxScriptVm.ts` → `src/ui/EventGraphEditorView.ts` | `src/core/ecs/EcsCore.test.ts` |
| **工作站 UI（階層/地圖/規則/圖集/預製體）** | `src/ui/EcsWorkbenchView.ts` → `EcsMapDesignerPanel.ts` / `EcsWorldRulesInspectorPanel.ts` / `EcsWorkbenchAtlasPanel.ts` / `EcsWorkbenchPrefabInspector.ts` | `scripts/sim/WorldMap.test.ts`, `ArchitectureTests.ts` |
| **像素畫室（繪製精靈與一鍵發佈瓦片/印章）** | `src/ui/SpriteAtelierView.ts` → `src/main.ts` (`onPublishMapTile` / `onPublishPrefabStamp`) | `npm run build` |
| **外部匯入（Aseprite / LDtk / Tiled / ZIP）** | `src/ui/ExternalImportModalView.ts` → `InteropWorkerClient.ts` → `src/workers/interop.worker.ts` → `src/core/interop/{InteropBundleLoader,AsepriteParser,LdtkImporter,TiledImporter}.ts` | `scripts/sim/Interop.test.ts` |
| **掌機殼、輸入、震動、實體手把** | `src/ui/ConsoleView.ts` → `ConsoleShellRouter.ts` / `VirtualGamepadInput.ts` / `GamepadHardwareBridge.ts` → `src/core/input/*` & `src/core/hal/*` | `scripts/sim/HalAndInputTests.ts` |
| **內建卡匣內容（PA-14/15/01/02/11/12）** | `src/game/BuiltinCartridges.ts` → `src/game/{obsidianCitadel,emeraldRuins,rhythmBastion,astralRift}/*` | `scripts/sim/CartridgeActionTests.ts`, `WorldMap.test.ts` |
| **PA-01 / PA-02 傳統資料卡匣運行時** | `src/core/sim/DataCartridgeRuntime.ts` → `DataRuntimeShmup.ts` / `GenreControllers.ts` / `CartridgeSchema.ts` | `scripts/sim/CartridgeActionTests.ts` |
| **外部音訊層（無 AI 合成）** | `src/core/audio/ExternalAudioBank.ts`（相容別名 `ToySynth.ts`）→ `src/core/runtime/EngineHost.ts` | `scripts/sim/CloudOffload.test.ts`, `ArchitectureTests.ts` |
| **雲端疏導（R2 CDN + Supabase + Edge API）** | `src/core/cloud/CloudSyncClient.ts` → `workers/api/src/{index,supabaseStore,types}.ts` → `supabase/migrations/20261122000000_pixer_cloud_schema.sql` | `scripts/sim/CloudOffload.test.ts` |
| **空間可達性預言機 & 腳本化試玩驗證** | `src/core/ai/EcsSpatialOracle.ts` → `src/core/ai/EcsPlaytestVerifier.ts` | `src/core/ecs/EcsCore.test.ts`, `DualPerspective3D.test.ts` |

---

## 3. Layer-by-Layer Module Inventory

### A. Pure Engine Core (`src/core/` — Zero UI / Zero `src/game/` / Zero Capacitor)
- **`src/core/gpu/` (7 files, 6,689L)** *(Canvas/WebGPU/WebGL2 DOM allowed)*
  - `GpuEngine.ts` (1,639L) — Multi-backend coordinator, 24-float PBR instancing, shadow grid, atlas sync.
  - `WebGpuBackend.ts` (1,358L) + `WebGpuShaders.ts` (1,061L) — Primary WGSL pipeline + 3-Pass Karis Bloom.
  - `WebGl2Backend.ts` (882L) + `WebGl2Shaders.ts` (1,036L) — GLSL ES 3.00 parity backend.
  - `Canvas2DBackend.ts` (518L) — Guaranteed software fallback.
  - `GpuTypes.ts` (195L) — Viewport presets (`1280×720`), `AtlasPoolStats`, PBR structs.
- **`src/core/ecs/` (15 files, 10,532L)** *(100% DOM-free)*
  - Core primitives: `EntityManager.ts` (164L), `ComponentStore.ts` (557L), `EcsCoreWorld.ts` (209L), `EcsWorld.ts` (466L).
  - Schema & authoring: `EcsProjectSchema.ts` (643L), `EcsTilemapTypes.ts` (580L), `EcsStudioSession.ts` (1,206L), `EcsCustomSpriteCompiler.ts` (568L).
  - Runtime & scripting: `EcsCartridgeRuntime.ts` (1,812L), `EcsWorldMapController.ts` (1,236L), `EcsActionPhysicsSystems.ts` (800L), `SandboxScriptVm.ts` (479L), `EcsEventGraph.ts` (472L).
  - Test/barrel: `EcsCore.test.ts` (1,328L — *note: test file placed inside `src/`*), `index.ts` (12L).
- **`src/core/runtime/` (13 files, 5,113L)** *(100% DOM-free)*
  - Active prod: `EngineHost.ts` (590L, **sole UI facade**), `CartridgeRunner.ts` (481L), `CartridgeRegistry.ts` (154L), `SceneGpuBridge.ts` (1,492L), `DisplayThermalGovernor.ts` (197L), `SaveService.ts` (349L), `CartridgePngCodec.ts` (269L), `AppLogger.ts` (340L), `LogPersistence.ts` (326L), `EventBus.ts` (87L), `SeededRng.ts` (38L).
  - *Tested-only (unwired in `main.ts`)*: `CameraRigDirector.ts` (567L), `GameFlowController.ts` (223L).
- **`src/core/ai/` (10 files, 3,495L)** *(100% DOM-free)*
  - Authoring & MCP: `AgentBridge.ts` (460L), `PixerMcpProtocol.ts` (485L), `EcsSpatialOracle.ts` (1,292L), `EcsPlaytestVerifier.ts` (376L), `ObservationSerializer.ts` (153L).
  - Providers: `HybridAiDirector.ts` (182L), `LocalAiProvider.ts` (260L), `RemoteAiProvider.ts` (191L), `AiTypes.ts` (76L), `AiProvider.ts` (20L).
- **`src/core/interop/` (6 files, 3,150L)** *(100% DOM-free; executed in Web Worker)*
  - `InteropBundleLoader.ts` (573L), `AsepriteParser.ts` (669L), `LdtkImporter.ts` (766L), `TiledImporter.ts` (641L), `InteropTypes.ts` (495L), `index.ts` (6L).
- **`src/core/cloud/` (2 files, 288L)** *(100% DOM-free)*
  - `CloudSyncClient.ts` (277L) + `index.ts` (11L) — Shared project fetch/publish (ETag), R2 upload, SRAM merge.
- **`src/core/audio/` (2 files, 458L)** *(Web Audio/HTMLAudio only; zero procedural oscillators)*
  - `ExternalAudioBank.ts` (447L), `ToySynth.ts` (11L legacy alias).
- **`src/core/math/` (6 files, 2,091L)** *(100% DOM-free, Zero-GC)*
  - `ColorMath.ts` (391L), `NoiseMath.ts` (253L), `Perspective3DMath.ts` (254L), `SpatialHash.ts` (349L), `SpringDynamics.ts` (409L), `Visibility2D.ts` (435L).
- **`src/core/input/` (5 files, 889L)** & **`src/core/hal/` (2 files, 513L)** *(100% DOM-free)*
  - Input DSP: `InputPipeline.ts`, `InputMap.ts`, `DpadClusterMath.ts`, `StickShaper.ts`, `WebGamepadSampler.ts`.
  - HAL: `SystemHal.ts`, `HapticEngine.ts`.
- **`src/core/types/` (5 files, 754L)**: `WorldTypes.ts` barrel → `SceneTypes.ts`, `HudTypes.ts`, `InputTypes.ts`, `CartridgeTypes.ts`.
- **`src/core/sim/` (28 files, 16,089L)** & **`src/core/editor/` (3 files, 1,561L)** *(Legacy Data Runtime + Shared Primitives)*
  - Actively used by `PA-01` & `PA-02`: `DataCartridgeRuntime.ts` (3,165L), `DataRuntimeShmup.ts` (1,112L), `GenreControllers.ts` (1,489L), `CartridgeSchema.ts` (957L), `TilemapGrid.ts`, `SoaEntityPool.ts`, `EventActionVm.ts`, `JuiceSystem.ts`, `DualPerspectiveRuntime.ts`, `PerspectiveProjector.ts`, `ProceduralStageCompiler.ts`, `ProceduralVisualRig.ts`, `OrthogonalArt.ts`, `AnimationStateMachine.ts`, `BehaviorTree.ts`, `TweenSystem.ts`, `CardDeckEngine.ts` (976L), `FighterFrameEngine.ts` (791L).
  - *Legacy AgentBridge-only*: `StudioSession.ts` (231L), `StudioCommands.ts` (1,013L), `StudioPlaytestDiag.ts` (317L).
  - *Dead in prod (only imported by old tests)*: `WorldKernel.ts`, `WorldEntitiesStep.ts`, `WorldHeroPhysics.ts`, `WorldInternalTypes.ts`, `WorldSnapshot.ts`, `Archetypes.ts`, `RuleMatrix.ts`, `CameraDirector.ts`, `CutsceneSequencer.ts`, `GridPathfinder.ts` (**10 files, 3,240 LOC**).

### B. Assets, Games & Edge Cloud
- **`src/assets/` (15 files, 4,952L)**: `TextureAtlas.ts` (740L), `AtlasSpritesData.ts`, `WorkshopRecipes.ts`, `sprites/*` (`CastleSprites`, `HdMaterialSprites`, `PaletteData`, `CoreSprites`, `ChronicleSprites`, `ParkourSprites`, `DungeonSprites`, `AutoTileSprites`, `ShmupSprites`, `MomoSprites`, `PixelFontData`, `BossSprites`).
- **`src/game/` (5 files, 2,529L)**: `BuiltinCartridges.ts` (`PA-01` Cloudberry Hop + `PA-02` Sugar Starlight + ECS registrations) + `obsidianCitadel/` (`PA-14`), `emeraldRuins/` (`PA-15`), `rhythmBastion/` (`PA-11`), `astralRift/` (`PA-12`).
- **`workers/api/` (3 TS + `wrangler.toml`, 732L)** & **`supabase/` (1 SQL, 122L)**: Edge API (`handleEdgeRequest`, `createSupabaseMetadataStore`) + PostgreSQL 4-table RLS migration.

### C. UI Workstation, Arcade Shell & Styles (`src/ui/` 43 files + `src/styles/` 4 CSS = 23,700L)
- **Workstation (`EcsWorkbench`)**: `PixerPlatformShell.ts`, `EcsWorkbenchView.ts` (3,234L), `EcsWorldRulesInspectorPanel.ts` (770L), `EcsMapDesignerPanel.ts` (664L), `EcsWorkbenchPrefabInspector.ts` (347L), `EcsWorkbenchAtlasPanel.ts` (260L), `EventGraphEditorView.ts` (1,148L), `ExternalImportModalView.ts` (560L), `InteropWorkerClient.ts` (149L), `SpriteAtelierView.ts` (1,729L).
- **Arcade Shell (`ConsoleView`)**: `ConsoleView.ts` (664L), `ConsoleSpatialController.ts` (150L), `ConsoleShellRouter.ts`, `ConsoleBodyBuilder.ts`, `ConsoleJoyconBuilder.ts`, `ConsoleHudPresenter.ts`, `CartridgeSlotController.ts`, `HomeLobbyView.ts`, `DeskWorldView.ts`, `WindowDioramaView.ts` (356L), `DioramaPalette.ts` (266L), `DioramaSceneRenderer.ts` (617L), `BootBlinkOverlay.ts`, `AngledSystemMenuView.ts`, `CartridgeDrawerView.ts`, `IrisWipeTransition.ts`, `ShmupOverlayView.ts`, `CardArt.ts`, `ProceduralSurfaceTextures.ts`, `MomoMascot.ts`, `TransitionMascot.ts`.
- **Input / Settings / Native**: `VirtualGamepadInput.ts`, `GamepadHardwareBridge.ts`, `TouchControlsBuilder.ts`, `TouchStateMerger.ts`, `SystemSettingsDrawerView.ts`, `SettingsDrawerTypes.ts`, `SystemLogPanelView.ts`, `CapacitorNativeBridge.ts`, `PwaBridge.ts`, `BrowserAssetLoader.ts`, `PixelIcons.ts`, `dom.ts`.
- **Styles**: `switch.css` (2,100L), `lobby.css` (1,928L), `atelier.css` (1,847L), `studio7.css` (1,702L).

---

## 4. Architecture Boundary Rules (Enforced by `scripts/sim/ArchitectureTests.ts`)

| Layer | Allowed Imports | Forbidden Imports |
|---|---|---|
| `src/core/{ai,cloud,ecs,editor,hal,input,interop,math,runtime,sim,types}/` | Own peers, `src/assets/`, pure npm (`fflate`, `maxrects-packer`) | `src/ui/`, `src/game/`, `@capacitor/*`, `virtual:pwa-register`, DOM globals (`document`/`window`/`HTMLElement`) |
| `src/core/gpu/` & `src/core/audio/` | `src/core/*`, `src/assets/` | `src/ui/`, `src/game/`, `@capacitor/*`, `createOscillator` (in `ExternalAudioBank.ts`) |
| `src/assets/` & `src/game/` | `src/core/*` | `src/ui/`, DOM globals |
| `src/ui/` | `EngineHost` (**never** `.runner`), `src/core/*`, `src/assets/`, `src/game/` | `eval()`, `new Function()`, leaking listeners without `AbortController` + `destroy()` |
| `workers/api/src/` | Web Standards (`fetch`, `crypto.subtle`), pure `src/core/*` | Node-only built-ins (`node:fs`, `node:path`), browser DOM |
