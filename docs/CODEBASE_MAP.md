# Pixer Codebase Navigation Map (Zero-Grep Routing Guide)

> **Purpose**: Read this file FIRST (together with `AGENTS.md`) to locate exact files, symbols, and cross-module call chains in **1 lookup** instead of broad directory scans.
> **Snapshot**: 201 code files · ~92,650 LOC · Primary Entry: `src/main.ts` · Worker Entry: `src/workers/interop.worker.ts` · Edge API Entry: `workers/api/src/index.ts`.

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
  Runner --> DataRT[DataCartridgeRuntime.ts<br/>PA-01/02 + Genre Arsenal]

  EcsRT --> EcsWorld[EcsCoreWorld + WorldMapController<br/>+ GridPathfinder A* + Visibility2D FOV/LOS<br/>+ CameraRigDirector + GameFlowController]
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
| **真 ECS 世界、多房間地圖、3D 體素與模型、A* 尋路 AI** | `src/core/ecs/EcsCartridgeRuntime.ts` → `EcsSnapshotProjector.ts` / `EcsWorldMapController.ts` / `EcsVoxelVolume.ts` / `EcsModel3D.ts` → `GridPathfinder.ts` / `Visibility2D.ts` → `EcsActionPhysicsSystems.ts` | `scripts/sim/EcsCore.test.ts`, `WorldMap.test.ts`, `WorldMap3D.test.ts` |
| **ECS 編輯器交易指令（Undo/Redo）與 MCP 工具** | `src/core/ecs/EcsStudioSession.ts` → `src/core/ai/PixerMcpProtocol.ts` → `src/core/ai/AgentBridge.ts` → `scripts/pixer-mcp.ts` | `scripts/sim/EcsCore.test.ts`, `WorldMap.test.ts`, `Model3DInterop.test.ts` |
| **無損事件圖 ↔ 腳本 VM** | `src/core/ecs/EcsEventGraph.ts` → `src/core/ecs/SandboxScriptVm.ts` → `src/ui/EventGraphEditorView.ts` | `scripts/sim/EcsCore.test.ts` |
| **工作站 UI（4 視圖/3D 模型/地圖/規則/檢視器）** | `src/ui/EcsWorkbenchView.ts` → `EcsWorkbenchShellBuilder.ts` / `EcsWorkbenchMapCanvasController.ts` / `ModelAtelierModalView.ts` (lazy) / `EcsWorkbenchSceneInspector.ts` / `EcsWorldRulesInspectorPanel.ts` / `EcsMapDesignerPanel.ts` | `scripts/sim/WorldMap.test.ts`, `ArchitectureTests.ts` |
| **像素畫室（繪製精靈與一鍵發佈瓦片/印章）** | `src/ui/SpriteAtelierView.ts` → `src/ui/SpriteAtelierPixelOps.ts` → `src/main.ts` (`onPublishMapTile` / `onPublishPrefabStamp`) | `npm run build` |
| **外部匯入（glTF `.glb` / `.bbmodel` / Aseprite / LDtk / Tiled / Pixel Forge）** | `src/ui/ExternalImportModalView.ts` + `PixelForgeImportTab.ts` + `ModelAtelierModalView.ts` → `src/core/interop/{GlbImporter,BbmodelImporter,PixelForgeProcessor,PixerAssetPack,InteropBundleLoader,AsepriteParser,LdtkImporter,TiledImporter}.ts` | `scripts/sim/Interop.test.ts`, `Model3DInterop.test.ts` |
| **掌機殼、輸入、震動、實體手把** | `src/ui/ConsoleView.ts` → `ConsoleSpatialController.ts` / `ConsoleShellRouter.ts` / `VirtualGamepadInput.ts` / `GamepadHardwareBridge.ts` → `src/core/input/*` & `src/core/hal/*` | `scripts/sim/HalAndInputTests.ts` |
| **內建卡匣內容（PA-14/15/01/02/11/12）** | `src/game/BuiltinCartridges.ts` → `src/game/{obsidianCitadel,emeraldRuins,rhythmBastion,astralRift}/*` | `scripts/sim/CartridgeActionTests.ts`, `WorldMap.test.ts` |
| **PA-01 / PA-02 資料卡匣與全品類子引擎（格鬥/卡牌/推箱）** | `src/core/sim/DataCartridgeRuntime.ts` → `DataRuntimePlatformer.ts` / `DataRuntimeSnapshot.ts` / `DataRuntimeShmup.ts` / `CardDeckEngine.ts` / `FighterFrameEngine.ts` / `GenreControllers.ts` / `CartridgeSchema.ts` | `scripts/sim/CartridgeActionTests.ts`, `Engine10Core.test.ts` |
| **外部音訊層（無 AI 合成）** | `src/core/audio/ExternalAudioBank.ts`（相容別名 `ToySynth.ts`）→ `src/core/runtime/EngineHost.ts` | `scripts/sim/CloudOffload.test.ts`, `ArchitectureTests.ts` |
| **雲端疏導（R2 CDN + Supabase + Edge API）** | `src/core/cloud/CloudSyncClient.ts` → `workers/api/src/{index,supabaseStore,types}.ts` → `supabase/migrations/20261122000000_pixer_cloud_schema.sql` | `scripts/sim/CloudOffload.test.ts` |
| **空間可達性預言機、AI 分鏡審美預言機 & 腳本化試玩** | `src/core/ai/EcsSpatialOracle.ts` → `src/core/ai/EcsCinematicOracle.ts` → `src/core/ai/EcsPlaytestVerifier.ts` | `scripts/sim/EcsCore.test.ts`, `Engine10Core.test.ts` |
| **電影級導演系統（Auteur 分鏡 DSL / Toric 雙人構圖 / 3 階段彈簧實切回）** | `src/core/ecs/EcsCinematicDirector.ts` → `src/core/ai/EcsCinematicOracle.ts` → `EcsWorldMapController.ts` → `EcsSnapshotProjector.ts` | `scripts/sim/Engine10Core.test.ts`, `WorldMap.test.ts` |

---

## 3. Layer-by-Layer Module Inventory

### A. Pure Engine Core (`src/core/` — Zero UI / Zero `src/game/` / Zero Capacitor)
- **`src/core/gpu/` (10 files)** *(Canvas/WebGPU/WebGL2 DOM allowed)*
  - `GpuEngine.ts` — Multi-backend coordinator, 24-float PBR 2D instancing, shadow grid, atlas sync, Unicode pixel text.
  - `GpuDynamicGlyphCache.ts` — Bounded 256-entry Zero-GC CJK/Unicode dynamic atlas bitmap glyph cache for Pass 1B `drawPixelText()`.
  - `GpuQuad3DBatch.ts` + `GpuMesh3DBatch.ts` + `GpuColorCache.ts` — Zero-GC 3D Quad/Indexed Mesh3D batching (4-view quad split, 1024×1024 directional shadow map, 360° yaw billboards).
  - `WebGpuBackend.ts` (1,357L) + `WebGpuShaders.ts` (1,060L) — Primary WGSL pipeline + 3-Pass Karis Bloom.
  - `WebGl2Backend.ts` (881L) + `WebGl2Shaders.ts` (1,035L) — GLSL ES 3.00 parity backend.
  - `Canvas2DBackend.ts` (517L) — Guaranteed software fallback.
  - `GpuTypes.ts` (194L) — Viewport presets (`1280×720`), `AtlasPoolStats`, PBR structs.
- **`src/core/ecs/` (17 prod files)** *(100% DOM-free; zero `*.test.ts` inside `src/`; 0 circular deps)*
  - Core primitives: `EntityManager.ts`, `ComponentStore.ts`, `EcsCoreWorld.ts`, `EcsWorld.ts`.
  - Schema & authoring: `EcsCutsceneSchema.ts` (pure cutscene DSL + `validateCutsceneDef`), `EcsVoxelVolume.ts` (11 shapes, 8 stories, 6-bit culling), `EcsModel3D.ts` (cuboid + `rawMesh` Zero-GC GPU emitters), `EcsProjectSchema.ts`, `EcsTilemapTypes.ts`, `EcsStudioSession.ts` (`48/48` catalog parity), `EcsCustomSpriteCompiler.ts`.
  - Runtime, projection, director & scripting: `EcsCinematicDirector.ts` (1,003L, Auteur Actor-Relative DSL + Toric Two-Shot Solver + 3-Phase Spring Handback + 21:9 Cinema HUD), `EcsCartridgeRuntime.ts` (1,177L, integrates `CameraRigDirector` & `GameFlowController`), `EcsSnapshotProjector.ts` (787L, Zero-GC snapshot/light/HUD/FP-wall projector), `EcsWorldMapController.ts` (1,511L, integrates Zero-GC `GridPathfinder` A* + `Visibility2D` LOS/FOV + `EcsCinematicDirector`), `EcsActionPhysicsSystems.ts` (799L), `SandboxScriptVm.ts` (478L), `EcsEventGraph.ts` (471L), `index.ts` (13L).
  - Unit tests live in `scripts/sim/EcsCore.test.ts` (1,328L), enforced by `ArchitectureTests.ts`.
- **`src/core/runtime/` (17 files, 5,243L)** *(100% DOM-free, 100% Wired)*
  - `EngineHost.ts` (589L, **sole UI facade**), `CartridgeRunner.ts` (480L), `CartridgeRegistry.ts` (153L), `CameraRigDirector.ts` (566L, 6DoF camera director wired into `EcsCartridgeRuntime`), `GameFlowController.ts` (222L, 6-act flow controller wired into `EcsCartridgeRuntime`), `SceneGpuBridge.ts` (889L), `SceneFirstPersonPass.ts` (243L, 2.5D DDA pass), `SceneTrue3DPass.ts` (320L, True 3D HD-2D pass), `SceneOrthogonalHelper.ts` (64L), `SceneHudOverlayPass.ts` (113L), `DisplayThermalGovernor.ts` (196L), `SaveService.ts` (348L), `CartridgePngCodec.ts` (268L), `AppLogger.ts` (339L), `LogPersistence.ts` (325L), `EventBus.ts` (86L), `SeededRng.ts` (37L).
- **`src/core/ai/` (11 files, 3,907L)** *(100% DOM-free)*
  - Authoring, Oracles & MCP: `AgentBridge.ts` (460L), `PixerMcpProtocol.ts` (507L), `EcsSpatialOracle.ts` (1,292L), `EcsCinematicOracle.ts` (390L, FilmFlow Headless Scout + 5-Axis Cinematography Critic & ASCII Viewfinder Storyboard), `EcsPlaytestVerifier.ts` (376L), `ObservationSerializer.ts` (153L).
  - Providers: `HybridAiDirector.ts` (182L), `LocalAiProvider.ts` (260L), `RemoteAiProvider.ts` (191L), `AiTypes.ts` (76L), `AiProvider.ts` (20L).
- **`src/core/interop/` (10 files)** *(100% DOM-free; Worker + Main-thread 3D/2D Importers, Pixel Forge & Asset Packs)*
  - `GlbImporter.ts` + `BbmodelImporter.ts` — Strict bounds-checked binary glTF 2.0 `.glb` & Blockbench `.bbmodel` importers w/ canonical Y-Up → Z-Up basis & winding conversion.
  - `PixelForgeProcessor.ts` (1,034L, edge bg strip, opaque crop, integer block detect, Oklab `adaptive_kmeans`/`palette_lock` + Bayer4 + outline, sprite-sheet `AnimationStateMachineDef`), `PixerAssetPack.ts` (658L, `schemaVersion: 1`, `horror`/`visual_novel`/`dungeon` starter packs w/ `160×192` portraits, atomic install & export), `InteropBundleLoader.ts` (573L), `AsepriteParser.ts` (669L), `LdtkImporter.ts` (766L), `TiledImporter.ts` (641L), `InteropTypes.ts` (495L), `index.ts`.
- **`src/core/cloud/` (2 files, 306L)** *(100% DOM-free)*
  - `CloudSyncClient.ts` (295L) + `index.ts` (11L) — Shared project fetch/publish (ETag), R2 upload, SRAM merge.
- **`src/core/audio/` (2 files, 458L)** *(Web Audio/HTMLAudio only; zero procedural oscillators)*
  - `ExternalAudioBank.ts` (447L), `ToySynth.ts` (11L legacy alias).
- **`src/core/math/` (6 files, 2,091L)** *(100% DOM-free, Zero-GC, 100% Wired)*
  - `ColorMath.ts` (391L), `NoiseMath.ts` (253L), `Perspective3DMath.ts` (254L), `SpatialHash.ts` (349L), `SpringDynamics.ts` (409L), `Visibility2D.ts` (435L, wired into `EcsWorldMapController` & `ProceduralStageCompiler`).
- **`src/core/input/` (5 files, 889L)** & **`src/core/hal/` (2 files, 513L)** *(100% DOM-free)*
  - Input DSP: `InputPipeline.ts`, `InputMap.ts`, `DpadClusterMath.ts`, `StickShaper.ts`, `WebGamepadSampler.ts`.
  - HAL: `SystemHal.ts`, `HapticEngine.ts`.
- **`src/core/types/` (6 files)**: `WorldTypes.ts` barrel → `CartridgeId.ts` (shared ID leaf breaking type cycle), `SceneTypes.ts`, `HudTypes.ts`, `InputTypes.ts`, `CartridgeTypes.ts`.
- **`src/core/sim/` (21 files, 14,501L)** & **`src/core/editor/` (3 files, 1,622L)** *(Data Runtime + Shared Primitives + Multi-Genre Arsenal)*
  - Core & Genre Sub-Engines: `DataCartridgeRuntime.ts` (1,452L coordinator), `DataRuntimePlatformer.ts` (1,026L platformer/grapple/dual-perspective), `DataRuntimeSnapshot.ts` (998L Zero-GC ping-pong snapshot & HUD projector), `DataRuntimeShmup.ts` (1,111L), `CardDeckEngine.ts` (975L roguelike deckbuilder sub-engine), `FighterFrameEngine.ts` (790L 60fps frame-data 2D fighter sub-engine), `GenreControllers.ts` (1,488L fighter/card/topdown/grid puzzle & HUD pool), `CartridgeSchema.ts` (987L), `GridPathfinder.ts` (522L, Zero-GC Binary-Heap A* & Flow-Field wired into `EcsWorldMapController`), `TilemapGrid.ts`, `SoaEntityPool.ts`, `EventActionVm.ts`, `JuiceSystem.ts`, `DualPerspectiveRuntime.ts`, `PerspectiveProjector.ts`, `ProceduralStageCompiler.ts`, `ProceduralVisualRig.ts`, `OrthogonalArt.ts`, `AnimationStateMachine.ts`, `BehaviorTree.ts`, `TweenSystem.ts`.
  - `src/core/editor/`: `StudioSession.ts` (231L), `StudioCommands.ts` (1,012L), `StudioPlaytestDiag.ts` (379L).

### B. Assets, Games & Edge Cloud
- **`src/assets/` (15 files, 4,952L)**: `TextureAtlas.ts` (740L), `AtlasSpritesData.ts`, `WorkshopRecipes.ts`, `sprites/*` (`CastleSprites`, `HdMaterialSprites`, `PaletteData`, `CoreSprites`, `ChronicleSprites`, `ParkourSprites`, `DungeonSprites`, `AutoTileSprites`, `ShmupSprites`, `MomoSprites`, `PixelFontData`, `BossSprites`).
- **`src/game/` (5 files, 2,529L)**: `BuiltinCartridges.ts` (`PA-01` Cloudberry Hop + `PA-02` Sugar Starlight + ECS registrations) + `obsidianCitadel/` (`PA-14`), `emeraldRuins/` (`PA-15`), `rhythmBastion/` (`PA-11`), `astralRift/` (`PA-12`).
- **`workers/api/` (3 TS + `wrangler.toml`, 732L)** & **`supabase/` (1 SQL, 122L)**: Edge API (`handleEdgeRequest`, `createSupabaseMetadataStore`) + PostgreSQL 4-table RLS migration.

### C. UI Workstation, Arcade Shell & Styles (`src/ui/` 53 files + `src/styles/` 4 CSS)
- **Workstation (`EcsWorkbench`)**: `PixerPlatformShell.ts`, `EcsWorkbenchView.ts`, `EcsWorkbenchShellBuilder.ts` (`.p7-spatial3d-bar` + `open-model-atelier`), `EcsWorkbenchCatalog.ts`, `EcsWorkbenchLiveMutator.ts`, `EcsWorkbenchMapCanvasController.ts` (Z-slice pick, Alt+Drag orbit, RGB XYZ gizmo, quad-view labels), `EcsWorkbenchHierarchyPanels.ts`, `EcsWorkbenchEntityInspector.ts`, `EcsWorkbenchSceneInspector.ts`, `EcsWorkbenchPrefabInspector.ts`, `EcsWorkbenchAtlasPanel.ts`, `EcsWorldRulesInspectorPanel.ts`, `EcsMapDesignerPanel.ts`, `EventGraphEditorView.ts` (lazy), `ExternalImportModalView.ts` + `PixelForgeImportTab.ts` (lazy `external-import`), `ModelAtelierModalView.ts` (lazy `model-atelier`), `CloudPublishModalView.ts` (lazy), `InteropWorkerClient.ts`, `SpriteAtelierView.ts` (lazy) + `SpriteAtelierPixelOps.ts`.
- **Arcade Shell (`ConsoleView`)**: `ConsoleView.ts` (664L), `ConsoleSpatialController.ts` (150L), `ConsoleShellRouter.ts`, `ConsoleBodyBuilder.ts`, `ConsoleJoyconBuilder.ts`, `ConsoleHudPresenter.ts`, `CartridgeSlotController.ts`, `HomeLobbyView.ts`, `DeskWorldView.ts`, `WindowDioramaView.ts` (356L), `DioramaPalette.ts` (266L), `DioramaSceneRenderer.ts` (617L), `BootBlinkOverlay.ts`, `AngledSystemMenuView.ts`, `CartridgeDrawerView.ts`, `IrisWipeTransition.ts`, `ShmupOverlayView.ts`, `CardArt.ts`, `ProceduralSurfaceTextures.ts`, `MomoMascot.ts`, `TransitionMascot.ts`.
- **Input / Settings / Native**: `VirtualGamepadInput.ts`, `GamepadHardwareBridge.ts`, `TouchControlsBuilder.ts`, `TouchStateMerger.ts`, `SystemSettingsDrawerView.ts`, `SettingsDrawerTypes.ts`, `SystemLogPanelView.ts`, `CapacitorNativeBridge.ts`, `PwaBridge.ts`, `BrowserAssetLoader.ts`, `PixelIcons.ts`, `dom.ts`.
- **Styles**: `switch.css` (2,100L), `lobby.css` (1,856L), `studio7.css` (1,686L), `atelier.css` (1,192L).
- **Read-Only Audit Suite (`scripts/`)**: `scripts/pixer-audit.ts` (`bun run audit` / `audit:status` / `audit:math` / `audit:perf` / `audit:json` / `--strict`) → `scripts/audit/{AuditTypes,StatusReport,MathScanner,PerfAndArchScanner}.ts`.

---

## 4. Architecture Boundary Rules (Enforced by `scripts/sim/ArchitectureTests.ts`)

| Layer | Allowed Imports | Forbidden Imports |
|---|---|---|
| `src/core/{ai,cloud,ecs,editor,hal,input,interop,math,runtime,sim,types}/` | Own peers, `src/assets/`, pure npm (`fflate`, `maxrects-packer`) | `src/ui/`, `src/game/`, `@capacitor/*`, `virtual:pwa-register`, DOM globals (`document`/`window`/`HTMLElement`) |
| `src/core/gpu/` & `src/core/audio/` | `src/core/*`, `src/assets/` | `src/ui/`, `src/game/`, `@capacitor/*`, `createOscillator` (in `ExternalAudioBank.ts`) |
| `src/assets/` & `src/game/` | `src/core/*` | `src/ui/`, DOM globals |
| `src/ui/` | `EngineHost` (**never** `.runner`), `src/core/*`, `src/assets/`, `src/game/` | `eval()`, `new Function()`, leaking listeners without `AbortController` + `destroy()` |
| `workers/api/src/` | Web Standards (`fetch`, `crypto.subtle`), pure `src/core/*` | Node-only built-ins (`node:fs`, `node:path`), browser DOM |
