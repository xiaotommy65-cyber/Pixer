# Pixer (Pixel Atelier) — Engine-First Constitution & File Map

## 1. Engine-First Identity (Pixel-Craft PBR GPU Engine)
- **Core Mandate**: Pixer is a Zero-GC, vanilla TypeScript **HD-2D Pixel PBR-Lite Engine** (`WebGPU` WGSL / `WebGL2` GLSL ES 3.00 / `Canvas2DBackend` fallback, `1280×720` viewport ceiling, 24-float PBR instancing, 8-page `1024×1024` `Texture2DArray` Atlas Pool, True Generational `EcsCoreWorld` + 5-phase 14-system pipeline + Sandboxed Script VM, pure data-driven Multi-Room HD-2D Tilemap & Top-Down Adventure runtime, External Standard Format Importers for Aseprite/LDtk/Tiled, 6DoF `CameraRigDirector`, `GameFlowController`, and external-asset-only `ExternalAudioBank`).
- **Unified Shells**: Single primary **True ECS Workstation** (`EcsWorkbenchView` + `EcsMapDesignerPanel` + `EventGraphEditorView` + `ExternalImportModalView` + `SpriteAtelierView` modal) + tactile Switch **Arcade Showcase** (`ConsoleView`: `PA-14`, `PA-15`, `PA-01`, `PA-02`, `PA-11`, `PA-12`).
- Read `docs/CODEBASE_MAP.md` (zero-grep task-to-file routing & dependency graph), `docs/ROADMAP.md`, and `docs/HANDOFF.md` before searching the codebase.

## 2. Repository & File Guide Map (Read this first instead of broad grep)

### Root & Configuration
- `src/main.ts` — App bootstrap (`createAppSafe()`), single RAF loop, lazy on-demand `GpuEngine` lifecycle (`ensureArcadeGpuInit`), `DisplayThermalGovernor`, `EngineHost`, `PixerPlatformShell`, `EcsWorkbenchView` (defaults to `PA-14`), `SpriteAtelierView` modal, `ConsoleView`, and `window.__PIXEL_ATELIER_AGENT__`.
- `src/AppShellHelpers.ts` — OS utility bar, landscape orientation controller, PNG card capture/share, global error handlers, 3-step `recoverFromFrameError` ladder.
- `vite.config.ts` / `capacitor.config.ts` / `tsconfig.json` — Vite + `VitePWA` (`base: './'`, chunked `ecs-workbench`/`core-ecs-interop`/`cartridges`), Capacitor shell, strict TS (`strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`), locked via `bun.lock`.

### `src/core/` — Pure Engine Core (100% DOM-free except `gpu/` & `audio/`, never import `ui/` or `game/`)
- `src/core/gpu/` — Multi-backend instanced 2D/HD-2D PBR-Lite renderer (`GpuEngine.ts`, `WebGpuBackend.ts`, `WebGpuShaders.ts`, `WebGl2Backend.ts`, `WebGl2Shaders.ts`, `Canvas2DBackend.ts`, `GpuTypes.ts`).
- `src/core/ecs/` — True Zero-GC Generational ECS + Multi-Room HD-2D WorldMap + Auteur/Toric `EcsCinematicDirector` + Custom Sprites + Sandboxed Script VM (`EntityManager.ts`, `ComponentStore.ts`, `EcsCoreWorld.ts`, `EcsCinematicDirector.ts`, `EcsProjectSchema.ts`, `EcsCustomSpriteCompiler.ts`, `EcsWorld.ts`, `SandboxScriptVm.ts`, `EcsEventGraph.ts`, `EcsActionPhysicsSystems.ts`, `EcsTilemapTypes.ts`, `EcsWorldMapController.ts`, `EcsCartridgeRuntime.ts`, `EcsSnapshotProjector.ts`, `EcsStudioSession.ts`).
- `src/core/interop/` — DOM-free External Standard Format Importers w/ zip/zlib bomb & path-traversal guards (`AsepriteParser.ts`, `LdtkImporter.ts`, `TiledImporter.ts`, `InteropBundleLoader.ts`, `InteropTypes.ts`).
- `src/core/runtime/` — Orchestration, 6DoF camera, flow & persistence (`EngineHost.ts` **sole UI facade**, `CameraRigDirector.ts`, `GameFlowController.ts`, `CartridgeRunner.ts`, `CartridgeRegistry.ts`, `CartridgePngCodec.ts`, `SceneGpuBridge.ts`, `DisplayThermalGovernor.ts`, `SaveService.ts`, `AppLogger.ts`, `LogPersistence.ts`, `EventBus.ts`, `SeededRng.ts`).
- `src/core/sim/` & `src/core/editor/` — Shared 2D primitives & genre arsenal (`DataCartridgeRuntime`, `DataRuntimePlatformer`, `DataRuntimeSnapshot`, `CardDeckEngine`, `FighterFrameEngine`, `GenreControllers`, `TilemapGrid`, `SoaEntityPool`, `EventActionVm`, `JuiceSystem`, `GridPathfinder`) & DOM-free `StudioSession`/`StudioCommands`.
- `src/core/audio/` — `ExternalAudioBank.ts` (CDN/external `.opus`/`.mp3` manifest playback + bounded LRU `AudioBuffer` cache + silent fallback; zero procedural AI synth) & compatibility alias `ToySynth.ts`.
- `src/core/cloud/` — `CloudSyncClient.ts` (100% DOM-free Cloudflare R2/Workers + Supabase client: `?play=<slug>` fetch, ETag `If-Match` publishing, R2 asset upload, SRAM timestamp merge).
- `src/core/input/`, `src/core/hal/`, `src/core/ai/`, `src/core/math/`, `src/core/types/` — Input DSP, HAL, AI-Native Stack (`AgentBridge`, `PixerMcpProtocol`, `EcsSpatialOracle`, `EcsCinematicOracle`, `EcsPlaytestVerifier`, `RemoteAiProvider`), Oklab/Bayer `ColorMath`, `NoiseMath`, `Perspective3DMath`, `SpringDynamics`, `SpatialHash`, `Visibility2D`, and shared types.

### `src/assets/` & `src/game/` — Procedural Pixel Atlas & Focused Cartridges (100% DOM-free)
- `src/assets/` — `TextureAtlas.ts` (8-page `1024×1024` Atlas Pool + MaxRectsBin + PNG Slicer), `AtlasSpritesData.ts`, `src/assets/sprites/*` (`CastleSprites`, `HdMaterialSprites`, `AutoTileSprites`, `PixelFontData`), `WorkshopRecipes.ts`.
- `src/game/` — `BuiltinCartridges.ts` (inline `PA-01` & `PA-02` + ECS registry): `PA-14` (`obsidianCitadel/`), `PA-15` (`emeraldRuins/`), `PA-11` (`rhythmBastion/`), `PA-12` (`astralRift/`).

### `src/ui/`, `src/workers/`, `workers/api/`, `supabase/` & `src/styles/` — Workstation, Edge Cloud & Handheld Showcase
- Workstation: `PixerPlatformShell.ts`, `EcsWorkbenchView.ts` (lazy `previewGpu`), `EcsMapDesignerPanel.ts`, `EcsWorldRulesInspectorPanel.ts` (M2 rules/portals/AI/HUD + BFS oracle), `EcsWorkbenchAtlasPanel.ts`, `EcsWorkbenchPrefabInspector.ts`, `EventGraphEditorView.ts`, `ExternalImportModalView.ts`, `InteropWorkerClient.ts`, `src/workers/interop.worker.ts`, `SpriteAtelierView.ts` + `SpriteAtelierPixelOps.ts`.
- Edge Cloud (Option A): `workers/api/` (Cloudflare Workers R2 immutable CDN, ETag projects, SRAM sync, `/api/ai/*`, `/api/mcp`), `supabase/migrations/` (PostgreSQL 4-table schema + strict RLS), `docs/CLOUD_SETUP.md`.
- Arcade Shell: `ConsoleView.ts`, `ConsoleShellRouter.ts`, `ConsoleBodyBuilder.ts`, `ConsoleJoyconBuilder.ts`, `ConsoleHudPresenter.ts`, `CartridgeSlotController.ts`, `BootBlinkOverlay.ts`, `DeskWorldView.ts`, `WindowDioramaView.ts`, `HomeLobbyView.ts`, `AngledSystemMenuView.ts`, `CartridgeDrawerView.ts`, `IrisWipeTransition.ts`, `MomoMascot.ts`, `CardArt.ts`, `BrowserAssetLoader.ts`.
- HUDs/Native/Styles: `ShmupOverlayView.ts`, `SystemSettingsDrawerView.ts`, `VirtualGamepadInput.ts`, `CapacitorNativeBridge.ts`, `PwaBridge.ts`, `PixelIcons.ts`, `dom.ts`; `src/styles/{studio7,atelier,switch,lobby}.css`.

### `scripts/` — Verification & MCP Server
- `scripts/headless-sim.ts` (`npm run sim`), `scripts/pixer-mcp.ts` (`npm run mcp`, UTF-8 byte-accurate framing), `scripts/sim/*` (`EcsCore.test.ts`, `ArchitectureTests.ts`, `WorldMap.test.ts`, `Engine10Core.test.ts`, `Interop.test.ts`, `DualPerspective3D.test.ts`, `Hd2dFeel.test.ts`, `CloudOffload.test.ts`, `Pixer7Tests.ts`, `CoreSubsystemTests.ts`, `CartridgeActionTests.ts`, `HalAndInputTests.ts`, `ExtensibilityAiTests.ts`).

## 3. Non-Negotiable Engine-First Constraints (Enforced by `ArchitectureTests.ts` & `WorldMap.test.ts`)
- **Native GPU Pixel PBR & Zero AI Synth Audio Mandate**: All stages MUST render via `GpuEngine` (WebGPU/WebGL2/Canvas2D fallback); **NEVER** reintroduce parallel Canvas 2D shadow renderers (`Stage3DPipeline.ts`), photorealistic wallpapers, or procedural AI oscillator synths (`ExternalAudioBank` external-asset-only).
- **Pure Data-Driven Core & AI-Native Authoring**: `src/core/ecs/` and `src/ui/` MUST contain ZERO game-specific hardcoding. Every new engine capability MUST be authorable via transactional `EcsStudioCommand`s + exposed through `PixerMcpProtocol` / `AgentBridge`.
- **Single Workstation & Lazy GPU Lifecycle**: Keep ONE authoring workstation (`EcsWorkbenchView` + `SpriteAtelierView` modal). Lazy-initialize GPU contexts on demand.
- **Zero-GC, Security & Layer Boundaries**: `src/core/` & `src/assets/` MUST NOT import `src/ui/`, `src/game/`, `@capacitor`, or `virtual:pwa-register`. Pure core dirs, `src/assets/`, `src/game/` stay 100% DOM-free. `src/ui/` uses `EngineHost` (never `.runner`), `AbortController`, and `public destroy()`. Zero `eval()`/`new Function()`. All archive/zlib/gzip decompression MUST enforce strict size bounds & path-traversal checks.
- **Verification Gate**: After edits, run `npm run lint && npm run sim && npm run test` (+ `npm run build` for shader/UI/build changes). Keep `AGENTS.md <= 120` lines.
