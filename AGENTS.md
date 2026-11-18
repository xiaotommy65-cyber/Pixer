# Pixer (Pixel Atelier) — Agent Engineering Rules & File Map

## 1. Architecture & File Guide Map (Read this first instead of broad grep)

### Root & Configuration
- `src/main.ts` — App bootstrap (`createAppSafe()`), RAF loop, `DisplayThermalGovernor`, `EngineHost`, `GpuEngine`, `ConsoleView`, `StudioWorkbenchView`, and `window.__PIXEL_ATELIER_AGENT__`.
- `src/AppShellHelpers.ts` — OS utility bar, landscape orientation controller, PNG card capture/share, global error handlers, 3-step `recoverFromFrameError` ladder.
- `vite.config.ts` — Vite + `VitePWA` config (`base: './'`).
- `capacitor.config.ts` — Native iOS/Android Capacitor shell (`com.pixelatelier.console`).
- `tsconfig.json` — Strict TypeScript (`ES2023`, `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`).

### `src/core/` — Pure Engine Core (MUST stay DOM-free except `gpu/`, never import `ui/` or `game/`)
- `src/core/gpu/` — Multi-backend instanced 2D/2.5D renderer:
  - `GpuEngine.ts` (facade, 16-float instance packing, `alphaItems`/`addItems` Float32Array batches, auto fallback)
  - `WebGpuBackend.ts` & `WebGpuShaders.ts` (WGSL)
  - `WebGl2Backend.ts` & `WebGl2Shaders.ts` (GLSL ES 3.00)
  - `Canvas2DBackend.ts` (software fallback)
  - `GpuTypes.ts` (`GAME_W=320`, `GAME_H=180`, `FLOATS_PER_INSTANCE=16`, `MAX_INSTANCES_PER_PASS`, `RenderPerformanceProfile`)
- `src/core/runtime/` — Engine orchestration, lifecycle & persistence:
  - `EngineHost.ts` — **Sole facade** for UI views (never access `host.runner` directly from `src/ui/`).
  - `CartridgeRunner.ts` — Fixed-timestep (`STEP_DT = 1/60`) simulation loop, cartridge switching, SRAM serialize/hydrate, 1,150+ sprite benchmark.
  - `CartridgeRegistry.ts` — Cartridge plugin registry (`registerCartridgePlugin`, `getCartridgeMeta`, `listCartridgeIds`).
  - `SceneGpuBridge.ts` — Projects `RenderSceneSnapshot` (incl. HD-2D Y-depth sorting, mode 1/3/4/5 shader primitives) into `GpuEngine`.
  - `DisplayThermalGovernor.ts` — Integer resolution scaling (`1x–3x`) & idle frame pacing (30fps/20fps).
  - `SaveService.ts` — `localStorage` + in-memory fallback for records, SRAM, hero sprites, shell/input/perf settings.
  - `AppLogger.ts` & `LogPersistence.ts` — Circular-safe JSONL structured logging (`IndexedDB` + `localStorage` mirror).
  - `EventBus.ts` & `SeededRng.ts` — Typed `EngineEventBus` and deterministic RNG.
- `src/core/sim/` — Shared 2D/2.5D simulation primitives:
  - `WorldKernel.ts`, `WorldEntitiesStep.ts`, `WorldHeroPhysics.ts`, `WorldSnapshot.ts`, `WorldInternalTypes.ts`
  - `CameraDirector.ts`, `CutsceneSequencer.ts`, `JuiceSystem.ts` (`FEEDBACK_RECIPES`), `BehaviorTree.ts`, `GridPathfinder.ts`, `RuleMatrix.ts`, `Archetypes.ts`
- `src/core/audio/` — Zero-dependency Web Audio synthesizer (`ToySynth.ts`, `AudioBus.ts`, `BgmSequencer.ts`, `SynthPresets.ts`).
- `src/core/input/` — Input DSP & hardware gamepad (`InputPipeline.ts`, `DpadClusterMath.ts`, `StickShaper.ts`, `InputMap.ts`, `WebGamepadSampler.ts`).
- `src/core/hal/` — Hardware Abstraction Layer (`SystemHal.ts`, `HapticEngine.ts` stereo dual-rumble & acoustic fallback).
- `src/core/ai/` — AI & Agent Bridge:
  - `AgentBridge.ts` (`window.__PIXEL_ATELIER_AGENT__`, observation/action/autoplay API)
  - `HybridAiDirector.ts`, `LocalAiProvider.ts`, `RemoteAiProvider.ts`, `ObservationSerializer.ts`, `AiTypes.ts`
- `src/core/types/` — Shared contracts (`WorldTypes.ts`, `CartridgeTypes.ts`, `HudTypes.ts`, `InputTypes.ts`, `SceneTypes.ts`).

### `src/assets/` — Procedural Sprites, Atlas & Audio Data (DOM-free, never import `ui/` or `game/`)
- `TextureAtlas.ts` — `512×512` RGBA atlas with `>=128px` dynamic sprite region & hot-reload dirty tracking.
- `AtlasSpritesData.ts`, `src/assets/sprites/*` (`PaletteData.ts`, `CoreSprites.ts`, `MomoSprites.ts`, `ShmupSprites.ts`, `DungeonSprites.ts`, `BossSprites.ts`, `ChronicleSprites.ts`).
- `AudioPatterns.ts`, `WorkshopRecipes.ts`.

### `src/game/` — Playable Cartridges (DOM-free, never import `ui/`)
- `BuiltinCartridges.ts` — Registers all 5 cartridges (`PA-01`..`PA-05`) and D&D campaign generator via `registerBuiltinCartridges()`.
- `src/game/cloudberry/` — `PA-01` **Cloudberry Hop** (`CloudberryHopGame.ts`, 8 stages, 24 stars, boss).
- `src/game/sugarStarlight/` — `PA-02` **Sugar Starlight** (`SugarStarlightGame.ts`, 3 fighters, 3 weapons, funnels, boss).
- `src/game/sandbox/` — `PA-03` **Sandbox Toybox** (`SandboxToyboxGame.ts`, `SandboxPuzzles.ts`, 10 puzzles + live script).
- `src/game/emberkeep/` — `PA-04` **Emberkeep D&D** (`EmberkeepDndGame.ts`, `TurnGridKernel.ts`, `DungeonGenerator.ts`, 8-floor BSP+SetPiece CRPG).
- `src/game/astralChronicles/` — `PA-05` **Astral Chronicles** (`AstralChroniclesGame.ts`, 5 chapters, HD-2D 2.5D depth & camera).

### `src/ui/` & `src/styles/` — Handheld OS Shell & Editors
- Shell & Routing: `ConsoleView.ts`, `ConsoleShellRouter.ts`, `ConsoleBodyBuilder.ts`, `ConsoleJoyconBuilder.ts`, `ConsoleHudPresenter.ts`, `CartridgeSlotController.ts`.
- Lobby & Overlays: `BootBlinkOverlay.ts`, `HomeLobbyView.ts`, `AngledSystemMenuView.ts`, `CartridgeDrawerView.ts`, `IrisWipeTransition.ts`, `TransitionMascot.ts`, `MomoMascot.ts`, `CardArt.ts`.
- Cartridge HUD Overlays: `ShmupOverlayView.ts`, `RpgOverlayView.ts`, `ChronicleOverlayView.ts`, `ChronicleModalViews.ts`.
- Creation Studios: `StudioWorkbenchView.ts`, `SpriteAtelierView.ts`, `WorkshopView.ts`.
- System, Input & Native: `SystemSettingsDrawerView.ts`, `SettingsDrawerTypes.ts`, `SystemLogPanelView.ts`, `VirtualGamepadInput.ts`, `TouchControlsBuilder.ts`, `TouchStateMerger.ts`, `GamepadHardwareBridge.ts`, `CapacitorNativeBridge.ts`, `PwaBridge.ts`, `dom.ts`.
- Styles: `src/styles/atelier.css`, `src/styles/switch.css`, `src/styles/lobby.css`.

### `scripts/` — Headless Simulation & Architecture Verification
- `scripts/headless-sim.ts` — Entry point for `npm run sim`.
- `scripts/sim/` — `SimTestHarness.ts`, `CoreSubsystemTests.ts`, `CartridgeActionTests.ts`, `CartridgeRpgTests.ts`, `HalAndInputTests.ts`, `ExtensibilityAiTests.ts`, `ArchitectureTests.ts` (enforces layer boundaries, DOM-free core/game, `EngineHost` facade, and `destroy()` lifecycles).

---

## 2. Strict Engineering Discipline (Ponytail + Zero-GC)
- **Ponytail minimalism**: Reuse existing engine utilities (`EngineHost`, `WorldKernel`, `JuiceSystem`, `ToySynth`, `dom.ts`) and native Web APIs first; NO external rendering, state, or audio libraries.
- **Zero-GC in hot loops**: Zero per-frame heap allocations inside `src/core/gpu/`, `src/core/sim/`, `src/core/runtime/SceneGpuBridge.ts`, and `src/game/` `step()`/`snapshot()` hot loops.
- **Layer boundaries** (enforced by `ArchitectureTests.ts`):
  - `src/core/` & `src/assets/` MUST NOT import `src/ui/`, `src/game/`, or `virtual:pwa-register`.
  - `src/core/{ai,hal,input,runtime,sim,types}/`, `src/assets/`, and `src/game/` MUST remain 100% DOM-free (`no document.` / `window.addEventListener`).
  - `src/ui/` MUST communicate via `EngineHost` and NEVER access `.runner` directly; new UI views MUST manage listeners with `AbortController` and expose `public destroy()`.
- **Navigation**: If `codegraph_explore` MCP is available locally, use it before reading multiple files; in cloud sandboxes, jump straight to the mapped module above.

## 3. Verification
- After TypeScript, engine, or UI edits, run:
  ```bash
  npm run lint && npm run sim
  ```
- Before deployment or build-related changes, also run `npm run build`.
