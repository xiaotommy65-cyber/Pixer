# Pixer (Pixel Atelier) — Agent Engineering Rules & File Map

## 1. Project Identity (One Core, Two Future Editions)
- **Core (`src/core/`, `src/assets/`)**: Lightweight, zero-GC, multi-backend (WebGPU / WebGL2 / Canvas 2D) 2D/2.5D fantasy console engine with deterministic simulation, `512×512` TextureAtlas, and Web Audio synthesizer.
- **Arcade Edition (Current Focus)**: Tactile Switch-inspired creative handheld (`PA-01`–`PA-05`), shaders/HD-2D effects, Studio editors, PWA, and Capacitor native iOS/Android app.
- **Edu Edition (Future Phase)**: Scratch-parallel white-box AI cartridge player & embeddable widget (transparent editable blocks/sprites, buggy-cartridge debugging, PNG homework).
- Read [`docs/ROADMAP.md`](docs/ROADMAP.md) **ONLY** when planning or executing a milestone.

## 2. Repository & File Guide Map (Read this first instead of broad grep)

### Root & Configuration
- `src/main.ts` — App bootstrap (`createAppSafe()`), RAF loop, `DisplayThermalGovernor`, `EngineHost`, `GpuEngine`, `ConsoleView`, `StudioWorkbenchView`, and `window.__PIXEL_ATELIER_AGENT__`.
- `src/AppShellHelpers.ts` — OS utility bar, landscape orientation controller, PNG card capture/share, global error handlers, 3-step `recoverFromFrameError` ladder.
- `vite.config.ts` — Vite + `VitePWA` (`base: './'`, relative PWA manifest paths, Rolldown `codeSplitting`).
- `capacitor.config.ts` — Native iOS/Android Capacitor shell (`com.pixelatelier.console`).
- `tsconfig.json` — Strict TypeScript (`ES2023`, `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`).

### `src/core/` — Pure Engine Core (MUST stay DOM-free except `gpu/`, never import `ui/` or `game/`)
- `src/core/gpu/` — Multi-backend instanced 2D/2.5D renderer:
  - `GpuEngine.ts` (16-float instance packing, `alphaItems`/`addItems` Float32Array batches, auto fallback)
  - `WebGpuBackend.ts` & `WebGpuShaders.ts` (WGSL)
  - `WebGl2Backend.ts` & `WebGl2Shaders.ts` (GLSL ES 3.00)
  - `Canvas2DBackend.ts` (software fallback)
  - `GpuTypes.ts` (`GAME_W=320`, `GAME_H=180`, `FLOATS_PER_INSTANCE=16`, `MAX_INSTANCES_PER_PASS`, `RenderPerformanceProfile`)
- `src/core/runtime/` — Engine orchestration, lifecycle & persistence:
  - `EngineHost.ts` — **Sole facade** for UI views (never access `.runner` directly from `src/ui/`).
  - `CartridgeRunner.ts` — Fixed-timestep (`STEP_DT = 1/60`) simulation loop, cartridge switching, SRAM serialize/hydrate, 1,150+ sprite benchmark.
  - `CartridgeRegistry.ts` — Cartridge plugin registry (`registerCartridgePlugin`, `getCartridgeMeta`, `listCartridgeIds`).
  - `SceneGpuBridge.ts` — Projects `RenderSceneSnapshot` (HD-2D Y-depth sorting, mode 1/3/4/5 shader primitives) into `GpuEngine`.
  - `DisplayThermalGovernor.ts` — Integer resolution scaling (`1x–3x`) & idle frame pacing (30fps/20fps).
  - `SaveService.ts` — `localStorage` + in-memory fallback for records, SRAM, hero sprites, shell/input/perf settings.
  - `AppLogger.ts` & `LogPersistence.ts` — Circular-safe JSONL structured logging (`IndexedDB` + `localStorage` mirror).
  - `EventBus.ts` & `SeededRng.ts` — Typed `EngineEventBus` and deterministic RNG.
- `src/core/sim/` — Shared 2D/2.5D simulation primitives:
  - `WorldKernel.ts`, `WorldEntitiesStep.ts`, `WorldHeroPhysics.ts`, `WorldSnapshot.ts`, `WorldInternalTypes.ts`
  - `CameraDirector.ts`, `CutsceneSequencer.ts`, `JuiceSystem.ts` (`FEEDBACK_RECIPES`), `BehaviorTree.ts`, `GridPathfinder.ts`, `RuleMatrix.ts`, `Archetypes.ts`
- `src/core/audio/` — Zero-dependency scale-locked Web Audio synthesizer (`ToySynth.ts`, `AudioBus.ts`, `BgmSequencer.ts`, `SynthPresets.ts`).
- `src/core/input/` — Input DSP & hardware gamepad (`InputPipeline.ts`, `DpadClusterMath.ts`, `StickShaper.ts`, `InputMap.ts`, `WebGamepadSampler.ts`).
- `src/core/hal/` — Hardware Abstraction Layer (`SystemHal.ts`, `HapticEngine.ts` stereo dual-rumble & acoustic fallback).
- `src/core/ai/` — AI & Agent Bridge (`AgentBridge.ts`, `HybridAiDirector.ts`, `LocalAiProvider.ts`, `RemoteAiProvider.ts`, `ObservationSerializer.ts`, `AiTypes.ts`).
- `src/core/types/` — Shared contracts (`WorldTypes.ts`, `CartridgeTypes.ts`, `HudTypes.ts`, `InputTypes.ts`, `SceneTypes.ts`).

### `src/assets/` — Procedural Sprites, Atlas & Audio Data (DOM-free, never import `ui/` or `game/`)
- `TextureAtlas.ts` — `512×512` RGBA atlas with `>=128px` dynamic sprite region & hot-reload dirty tracking.
- `AtlasSpritesData.ts`, `src/assets/sprites/*`, `AudioPatterns.ts`, `WorkshopRecipes.ts`.

### `src/game/` — Playable Cartridges (DOM-free, never import `ui/`)
- `BuiltinCartridges.ts` — Registers all 5 cartridges (`PA-01`..`PA-05`) and D&D campaign generator via `registerBuiltinCartridges()`.
- `cloudberry/` (`PA-01` Cloudberry Hop) · `sugarStarlight/` (`PA-02` Sugar Starlight) · `sandbox/` (`PA-03` Sandbox Toybox + safe DSL) · `emberkeep/` (`PA-04` Emberkeep D&D) · `astralChronicles/` (`PA-05` Astral Chronicles).

### `src/ui/` & `src/styles/` — Handheld OS Shell & Editors
- Shell & Routing: `ConsoleView.ts`, `ConsoleShellRouter.ts`, `ConsoleBodyBuilder.ts`, `ConsoleJoyconBuilder.ts`, `ConsoleHudPresenter.ts`, `CartridgeSlotController.ts`.
- Lobby & Overlays: `BootBlinkOverlay.ts`, `HomeLobbyView.ts`, `AngledSystemMenuView.ts`, `CartridgeDrawerView.ts`, `IrisWipeTransition.ts`, `TransitionMascot.ts`, `MomoMascot.ts`, `CardArt.ts`.
- Cartridge HUDs & Studios: `ShmupOverlayView.ts`, `RpgOverlayView.ts`, `ChronicleOverlayView.ts`, `ChronicleModalViews.ts`, `StudioWorkbenchView.ts`, `SpriteAtelierView.ts`, `WorkshopView.ts`.
- System, Input & Native: `SystemSettingsDrawerView.ts`, `SettingsDrawerTypes.ts`, `SystemLogPanelView.ts`, `VirtualGamepadInput.ts`, `TouchControlsBuilder.ts`, `TouchStateMerger.ts`, `GamepadHardwareBridge.ts`, `CapacitorNativeBridge.ts`, `PwaBridge.ts`, `dom.ts`.
- Styles: `src/styles/atelier.css`, `src/styles/switch.css`, `src/styles/lobby.css`.

### `scripts/` — Headless Simulation & Architecture Verification
- `scripts/headless-sim.ts` — Entry point for `npm run sim`.
- `scripts/sim/` — `SimTestHarness.ts`, `CoreSubsystemTests.ts`, `CartridgeActionTests.ts`, `CartridgeRpgTests.ts`, `HalAndInputTests.ts`, `ExtensibilityAiTests.ts`, `ArchitectureTests.ts`.

## 3. Non-Negotiable Constraints (Ponytail + Zero-GC)
- **Zero-GC hot paths**: Never allocate per-frame objects/arrays inside `src/core/gpu/`, `src/core/sim/`, `src/core/runtime/SceneGpuBridge.ts`, or `src/game/` `step()`/`snapshot()` loops; reuse pre-allocated pools / `Float32Array` buffers.
- **Zero external bloat**: Keep vanilla TypeScript + WebGPU/WebGL2 + Web Audio (reuse `EngineHost`, `WorldKernel`, `JuiceSystem`, `ToySynth`, `dom.ts`). Do NOT install external rendering, physics, state, or audio libraries.
- **Backend parity**: Any visual or shader change MUST keep WebGPU (`WGSL`) and WebGL2 (`GLSL ES 3.00`) visually identical (and degrade cleanly to `Canvas2DBackend`).
- **Scope discipline**: Never implement backend AI servers, SaaS auth, or future milestone features unless explicitly requested.
- **Core / Edition separation (One Core, Two Shells)**: Keep `src/core/`, `src/assets/`, and `src/game/` 100% UI-agnostic and free of `@capacitor/*` imports; expose edition capabilities via clean config/feature flags (`enableCRT`, `enableAdvancedBlocks`, `showPerfTelemetry`, `allowedBlockIds`) when needed so Arcade and future Edu shells share one core.
- **Layer & security boundaries** (enforced by `ArchitectureTests.ts`):
  - `src/core/` & `src/assets/` MUST NOT import `src/ui/`, `src/game/`, `@capacitor`, or `virtual:pwa-register`.
  - `src/core/{ai,hal,input,runtime,sim,types}/`, `src/assets/`, and `src/game/` MUST remain 100% DOM-free and `@capacitor`-free.
  - `src/ui/` MUST use `EngineHost` (never `.runner`), manage listeners with `AbortController`, and expose `public destroy()`.
  - `src/` MUST NOT use `eval()` or `new Function()`.
- **Tooling**: If `codegraph_explore` MCP is available locally, use it before broad `grep`; in cloud sandboxes, jump directly via the File Guide Map above.

## 4. Verification
- After edits, run `npm run lint && npm run sim` (plus `npm run build` for shader/UI/build changes) before finishing.
