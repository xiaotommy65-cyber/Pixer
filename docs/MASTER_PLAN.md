# Pixer Autonomous Master Plan & Swarm Roadmap

> **Baseline Commit**: `main@12269ae` → Topic Branch: `feat/swarm-p0-p1-hardening`  
> **Audit Command**: `bun run audit` (read-only) / `bun run audit -- --strict` (KPI gate)

---

## 1. Baseline Scorecard (Before Wave 1)

| Metric | Baseline Value | Target (After Wave 1) |
|---|---|---|
| `bun run audit` | `critical=6`, `warn=24`, `info=26` | `critical=0`, sharp `warn` reduction |
| `240f Snapshot Zero-GC` | `EcsCartridgeRuntime ~2314.6 KB`, `ChunkedRuntime ~2385.4 KB` | `< 400 KB` (asserted `< 768 KB` in `ArchitectureTests.ts`) |
| `circularDepsCount` | `2` (`EcsProjectSchema↔EcsCinematicDirector↔EcsWorld`, `CartridgeTypes↔SceneTypes`) | `0` |
| `ECS_COMMAND_CATALOG` Parity | `ecsCommandTypes=42` vs `catalogEntries=33` (9 missing) | `42 / 42` (100% parity + test guard) |
| Dead CSS Classes | `82` total (`66` in `src/styles/atelier.css`) | Dead Studio 6.0 / removed-view blocks pruned |
| Verification Gate | `lint` 0 err · `sim` PASS · `test` 58/58 PASS · `build` PASS | All green + new E2E persistence & math oracle tests |

---

## 2. Four Retrospective Guardrails (Anti-Stall Constitution)

1. **Audit-First & Anti-Regression**: Run `bun run audit` at session start and before PR; encode structural/math/GC checks into `scripts/audit/` and `bun run audit -- --strict` rather than trusting stale status prose.
2. **End-to-End Persistence & Output Tests**: Every wiring fix MUST verify downstream output and multi-frame persistence (e.g., `PLAY_OVERDRIVE` survives 15 `step()` ticks; `EcsCinematicDirector` `timeScale`/`pitchDeltaDeg`/`tiltShift*` propagate into `snapshot()`; `240f` `heapDelta` is bounded by assertion).
3. **Lock V1 Retirement / Isolation Decisions**: No flip-flopping between deleting and restoring V1 sub-engines (`CardDeckEngine`, `FighterFrameEngine`, `GenreControllers`, `src/core/editor/*`). Isolate behind explicit lazy boundaries before deciding permanent removal.
4. **Real GPU Verification**: Verify WebGPU WGSL & WebGL2 GLSL ES 3.00 parity both statically (`DualPerspective3D.test.ts`) and live via local Chrome / `chrome-devtools` MCP.

---

## 3. Four-Epic Engineering Roadmap

### Epic 1 — P0 Math, Dual-GPU Shader Parity & Phase 4/5 Wiring Fixes *(Wave 1)*
- **Math Core (`math-core`)**: 32-bit avalanche seed mixing + orthonormal 2×2 octave rotation in `NoiseMath`; strict hex validation + out-of-gamut preservation in `ColorMath`; dt-normalized Verlet damping + zero-reach 2-Bone IK guard in `SpringDynamics`; unit corner hit normals + epsilon tie-break in `Visibility2D`; half-open `[lo, hi)` `ceil - 1` cell bounds + hash finalizer in `SpatialHash`.
- **Dual-GPU Parity (`gpu-parity`)**: Dedicated zero-light `pass1OverlayBindGroup` for WebGPU Pass 1B HUD overlays; `texSubImage3D` reuse in `WebGl2Backend.uploadAtlas()`; WebGL2 `LINEAR` sampler for Tilt-Shift DoF bokeh; physically grounded `f0 = mix(0.04, texRgb, metal)` + Schlick Fresnel; remove duplicate center texel `sC` fetch; zero-dist `normalize(toL)` NaN guard; bounded 2D DDA grid shadow traversal replacing 14-step uniform march; CRT/Bayer Y-orientation parity.
- **Director Wiring (`ecs-perf`)**: Fix truthy `'none'` bug (`transitionedToPlay === 'intro_complete'`) in `EcsCartridgeRuntime`; stop clobbering `EcsCinematicDirector` live lead-room/Toric framing in `EcsWorldMapController`; wire `timeScale`, `pitchDeltaDeg`, `tiltShiftBlur`, `tiltShiftFocusY`; zoom-aware `clampAxis` + monotonic `handback` + zoom-aware `tiltShiftFocusY`.

### Epic 2 — Zero-GC 60Hz Hot Paths & Lazy Code-Splitting *(Wave 1 GC + Wave 2 Lazy Split)*
- **Wave 1 (`ecs-perf`)**: Replace `length = 0` + `.push()` backing-store thrashing in `EcsSnapshotProjector` and `DataRuntimeSnapshot`; reuse scratch objects & pre-bound acquire callbacks; hoist `collides` & `toDestroy` scratch arrays in `EcsWorldMapController`; cache static room tile lights in `rebuildTiles()`; remove idle 60Hz allocations in `WebGamepadSampler` and `InputPipeline`.
- **Wave 2**: Introduce real dynamic `import()` code-splitting across `src/main.ts` (`EcsWorkbenchView`, `SpriteAtelierView`, `ExternalImportModalView`, `ConsoleView`, native `@capacitor/*`, non-active cartridges), throttle `SaveService` autosave/record persistence out of 60Hz HUD loops, cap idle Studio GPU draws, and isolate V1 `src/core/editor/*` & unused V1 sim modules.

### Epic 3 — Dependency Cycle Breaking, Catalog Sync & CSS Pruning *(Wave 1)*
- **Architecture Hygiene (`arch-hygiene`)**: Extract `EcsCutsceneSchema.ts` to break `EcsProjectSchema ↔ EcsCinematicDirector ↔ EcsWorld`; extract `CartridgeId.ts` to break `CartridgeTypes ↔ SceneTypes`; bring `ECS_COMMAND_CATALOG` to `42/42` parity; prune unreferenced dead CSS classes in `atelier.css`, `lobby.css`, and `studio7.css`.

### Epic 4 — Unified 6DoF Camera, 3D Cinematic Oracle & Phase 6 UI/Content *(Wave 2+)*
- Unify `Perspective3DMath` + `CameraRigDirector` (SE(3) + Reverse-Z + 6-plane frustum culling), upgrade `EcsCinematicOracle` to multi-frame 3D occlusion sweeps, upgrade `EcsSpatialOracle` with trajectory obstacle checks + Tarjan SCC, expose Cutscene/Oracle/Camera/FOV UI in `EcsWorkbenchView`, author flagship `PA-14`/`PA-15` cutscenes, and verify live in Chrome WebGPU/WebGL2.

---

## 4. Wave 1 Swarm Roster & Ownership Matrix

| Worker | Ownership | Key Outcomes |
|---|---|---|
| `math-core` | `src/core/math/{NoiseMath,ColorMath,SpringDynamics,Visibility2D,SpatialHash}.ts`, `scripts/sim/CoreSubsystemTests.ts` | Fix 5 core math bugs + add differential/regression oracle tests |
| `gpu-parity` | `src/core/gpu/{WebGpuBackend,WebGpuShaders,WebGl2Backend,WebGl2Shaders}.ts`, `scripts/sim/DualPerspective3D.test.ts` | Fix Pass 1B leak, DoF sampler, F0/Schlick, 2D DDA shadows, `texSubImage3D` |
| `ecs-perf` | `src/core/ecs/{EcsCartridgeRuntime,EcsWorldMapController,EcsCinematicDirector,EcsSnapshotProjector}.ts`, `DataRuntimeSnapshot.ts`, `WebGamepadSampler.ts`, `InputPipeline.ts`, `Engine10Core.test.ts`, `ArchitectureTests.ts` | Wire Phase 4/5 runtime end-to-end, kill snapshot & input GC thrash, assert `heapDelta < 768KB` |
| `arch-hygiene` | `src/core/ecs/EcsCutsceneSchema.ts` (new), `EcsProjectSchema.ts`, `EcsStudioSession.ts`, `src/core/types/CartridgeId.ts` (new), `CartridgeTypes.ts`, `SceneTypes.ts`, `src/styles/{atelier,lobby,studio7}.css`, `WorldMap.test.ts` | Break 2 circular deps (`0` cycles), sync `42/42` catalog, prune dead CSS |

---

## 5. Wave 1 Verification Log
- **Status**: `PASSED` on `feat/swarm-p0-p1-hardening`
- **`bun run audit -- --strict`**: `critical=0` (down from `6`), `warn=11` (down from `24`, 10 file-size + 1 Wave 2 `PERF-NO-CODE-SPLIT`), `circularDepsCount=0` (down from `2`), `probesFailed=0` (down from `4`), `snapshotArrayResets=0` (down from `11`), `ecsCommandTypes=42 / catalogEntries=42`, `totalDeadClasses=8` (down from `82`), `srcCssLoc=6816` (down from `7577`).
- **`bun run lint`**: `0` TypeScript errors (`tsc --noEmit`).
- **`bun run sim`**: `[SIM ALL PASSED]` — `ColorMath 50k Oklab mix: 2.23ms (heapDelta=0KB)`, `240f Snapshot Zero-GC: EcsCartridgeRuntime=0.58ms (heapDelta=48.5KB), ChunkedRuntime=2.10ms (heapDelta=26.7KB)`.
- **`npm run test`**: `62 pass / 0 fail` (up from `58`).
- **`bun run build` + `bun run clean`**: `210` modules built in `264ms` (`index.css` `123.60 kB -> 111.46 kB`, 0 chunk warnings), `dist/` cleaned.

---

## 6. Wave 2 Verification Log (`workspace: "share"` Git Worktrees)
- **Status**: `PASSED` on `feat/swarm-p0-p1-hardening` (merged `lazy-perf` `93f40bd`, `oracle-cutscenes` `5628e27`, `workstation-ui` `7a6aba9`)
- **Code-Splitting & 60Hz UI Trim (`lazy-perf`)**:
  - `dynamicImportCount`: `0 -> 3` (`SpriteAtelierView`, `CapacitorNativeBridge`, `ExternalImportModalView` lazy-loaded; `StudioSession` lazy in `AgentBridge`); `PERF-NO-CODE-SPLIT` & `ARCH-LEGACY-STUDIO-BOOT` eliminated.
  - `ConsoleHudPresenter`, `ShmupOverlayView`, and `SaveService` updated with numeric/field dirty checks and `>=1s` playing-mode save throttling.
- **Oracles & Flagship Cutscenes (`oracle-cutscenes`)**:
  - `EcsCinematicOracle`: 3-point (`25%/55%/85%`) multi-frame sampling, `hd2d_3d` projected wall occlusion, `actorB` `two_shot` occlusion checks, live gameplay handback target parity.
  - `EcsSpatialOracle`: solid hero spawn guard, walled-in portal/boss rejection, one-way dead-end room detection, dynamic pass limit.
  - Authored 4 flagship cutscenes (`PA-14`: `citadel_gate_intro` 100/S, `malakor_awakening` 98/S; `PA-15`: `grove_arrival` 100/S, `warden_awakening` 98/S).
- **Phase 6 Workstation UI & Live Browser GPU Verification (`workstation-ui` + `browser`)**:
  - Exposed Cutscene Director / 5-Axis Critic Oracle UI, `視野遮蔽預覽 (FOV Fog)` Zero-GC overlay, and idle Studio 0-draw GPU cap.
  - Live `http://localhost:3000/` Chromium check: **0** uncaught JS/console/shader errors; verified `PA-14` `真 3D 透視 (HD-2D)` rendering, `100/100 [S]` diagnostic banner, FOV fog toggle, and 21:9 letterbox cutscene playback.
- **Full Gate**: `bun run lint` (0 err) · `bun run sim` (`[SIM ALL PASSED]`: `ColorMath 2.46ms / 13KB`, `240f Zero-GC: ECS 0.53ms / 37.3KB, Chunked 2.00ms / 26.7KB`) · `npm run test` (**64 pass / 0 fail**) · `bun run audit -- --strict` (**exit 0**, `critical=0`, `Math/Shader` 0 warn, `Perf/Arch` 0 warn) · `bun run build` (`211 modules`, `570ms`, `CapacitorNativeBridge` async chunk `2.86 kB`, note `ecs-workbench` chunk `510.77 kB > 500 kB`) · `bun run clean`.

---

## 7. Wave 3 Verification Log (Phase 6B · Chunk Polish, CJK Pass 1B Overlay & Cloud Publish UI)
- **Status**: `PASSED` on `feat/swarm-p0-p1-hardening`
- **Vite Chunking & `PwaBridge` Decoupling**:
  - Removed static `@capacitor/core` import from `src/ui/PwaBridge.ts` (replaced with runtime `window.Capacitor?.isNativePlatform?.()` check, guarded by `ArchitectureTests.ts`).
  - Lazy-loaded `EventGraphEditorView` and `CloudPublishModalView` in `EcsWorkbenchView.ts` (`dynamicImportCount`: `3 -> 5`).
  - Split `vite.config.ts` groups into `ecs-workbench` (`339.23 kB`), `sprite-atelier` (`73.08 kB`), `external-import` (`70.15 kB`), `event-graph` (`32.95 kB`), `cloud-publish` (`14.82 kB`), `legacy-v1-sim` (`24.38 kB`), `cartridges` (`481.93 kB`), `index` (`225.98 kB`) — **0 Vite chunk size warnings** (all chunks `< 500 kB`).
- **V1 Legacy Compatibility Tier Decision (Locked)**:
  - `CardDeckEngine`, `FighterFrameEngine`, `GenreControllers`, `DataCartridgeRuntime`/`DataRuntime*`, and `src/core/editor/*` (`StudioSession` lazy in `AgentBridge`) are **frozen as a compatibility tier** isolated in Vite chunk `legacy-v1-sim` (still powering `PA-01`/`PA-02` and covered by `Engine10Core.test.ts`). No further feature expansion or deletion churn without an explicit architectural RFC.
- **Cutscene `splashTitle` / `splashSubtitle` / `subtitle` Pass 1B Fix**:
  - Root cause: `TextureAtlas` pre-packed ASCII 32..95 only (`GpuEngine.drawPixelText()` skipped non-ASCII/CJK glyphs with `totalW <= 0`), `EcsCinematicDirector` subtitle lacked a dark contrast backdrop, and `PA-14`/`PA-15` Shot 0 lacked an opening subtitle.
  - Added `src/core/gpu/GpuDynamicGlyphCache.ts` (bounded 256-glyph LRU cache rasterizing crisp 16×16 CJK/Unicode glyphs onto dynamic `TextureAtlas` slots with headless fallback), updated `GpuEngine.drawPixelText()` (Zero-GC scratch glyph metrics) and `Canvas2DBackend.ts` (`paletteRow < -1.5` full tint opacity), added dark subtitle backdrop in `EcsCinematicDirector.appendCinemaOverlayHud()`, and added Shot 0 subtitles to `PA-14` (`citadel_gate_intro`) & `PA-15` (`grove_arrival`).
- **Workstation Cloud Publish UI (`CloudPublishModalView`)**:
  - Added lazy-loaded `src/ui/CloudPublishModalView.ts` wired from toolbar button `[data-testid="open-cloud-publish"]` (`雲端發佈`) via `CloudSyncClient`: supports Edge API URL, session-only Bearer token, validated slug (`?play=<slug>`), visibility, ETag `If-Match` conflict recovery, clipboard share URL copy, and offline `.pixer.json` export fallback.
- **Live Browser & Full Gate**:
  - Live Chromium check at `http://localhost:3000/`: **0** console/page/shader errors; visually verified Shot 0 (`CHRONICLE: 赤月籠罩黑曜城塞...` + 21:9 letterbox), Shot 1 (`黑曜魔王城` + `OBSIDIAN CITADEL` + accent rule over 3D scene), `CloudPublishModalView`, and lazy-loaded `EventGraphEditorView`.
  - Full Gate: `bun run lint` (0 err) · `bun run sim` (`[SIM ALL PASSED]`) · `npm run test` (**66 pass / 0 fail**) · `bun run build` (213 modules, `319ms`, **0 chunk warnings**) · `bun run audit -- --strict` (exit 0, `critical=0`, `dynamicImportCount=5`, `circularDepsCount=0`).

---

## 8. Wave 4A Verification Log (Universal Pixel Forge & Cross-Genre `PixerAssetPack` Foundation)
- **Status**: `PASSED` on `feat/swarm-p0-p1-hardening`
- **`256×256` Custom Sprite & Portrait Ceiling**:
  - Raised `EcsProjectSchema.validateCustomSpriteDef` & `EcsCustomSpriteCompiler` bounds from `8..128` to `8..256` (`MAX_CUSTOM_SPRITE_RGBA_BYTES = 256 * 256 * 4`, `MAX_CUSTOM_SPRITE_B64_CHARS = 512 * 1024`), enabling crisp `160×192` visual-novel portraits and `256×256` horror/dungeon bosses while preserving strict zip-bomb bounds (`Engine10Core.test.ts` updated to `300 KB` payload).
- **DOM-Free Universal Pixel Forge (`src/core/interop/PixelForgeProcessor.ts`, 1,034L)**:
  - Implemented `stripEdgeBackgroundRgba` (corner-consensus flood-fill + anti-fringe cleanup), `cropOpaqueBoundsRgba`, `detectPixelBlockSize` (X/Y transition periodicity `2..16`), `downscaleToPixelGridRgba` (`grid_majority` inset majority vote w/ hard alpha cutout + `lossless`), `quantizeRgbaOklab` (`true_color`, `adaptive_kmeans`, `palette_lock` + Bayer 4×4 across 5 curated `PIXEL_FORGE_PALETTES` — `asylum_horror`, `obsidian_dungeon`, `cozy_vn`, `cyber_neon`, `endesga_32`), `applyRgbaOutline`, `forgeImageToCustomSprites` (`cols×rows` sprite-sheet slicing + automatic `AnimationStateMachineDef`), and `buildPixelForgeCommitCommands`.
- **Portable `PixerAssetPackManifest` v1 & MCP Integration (`src/core/interop/PixerAssetPack.ts`, 658L & `PixerMcpProtocol.ts`)**:
  - Added schema validation (`validateAssetPackManifest`), collision-safe atomic install & export (`buildAssetPackInstallCommands`, `exportProjectAsAssetPack`), 3 built-in starter packs (`horror`, `visual_novel`, `dungeon` incl. `160×192` portraits & dark/warm atmospheres), and MCP tools `install_asset_pack` + `export_asset_pack`.
- **Workstation Multi-Tab Import UI (`src/ui/PixelForgeImportTab.ts`, 706L + `ExternalImportModalView.ts` + `EcsWorkbenchView.ts`)**:
  - Added **Pixel Forge 洗圖** and **題材資產包 (Asset Packs)** tabs inside lazy `external-import` Vite chunk (`113.62 kB`), guarded in `ArchitectureTests.ts` (`public destroy()` + `AbortController`) and `Interop.test.ts`.
- **Live Browser & Full Gate**:
  - Live Chromium check at `http://localhost:3000/`: **0** console/page/shader errors; verified demo forging (`已煉製 1 張精靈 (32×32) · 偵測原圖像素塊=4×` -> commit `gothic_lantern_forged`), Horror Asylum pack install (`6 張精靈 · 3 瓦片 · 2 Prefab` + dark horror atmosphere), and 1-step Undo rollback.
  - Full Gate: `bun run lint` (0 err) · `bun run sim` (`[SIM ALL PASSED]`, `240f Zero-GC: ECS 0.58ms / 40.7KB, Chunked 2.25ms / 26.7KB`) · `npm run test` (**69 pass / 0 fail**) · `bun run build` (216 modules, `1.26s`, **0 chunk warnings**, `external-import 113.62 kB`, `ecs-workbench 339.93 kB`, `cartridges 481.93 kB`) · `bun run audit -- --strict` (exit 0, `critical=0`, `circularDepsCount=0`, `dynamicImportCount=5`).

---

## 9. Wave 4B Verification Log (Multi-Pipeline Baking, Tile PBR/Side Split, Pass 1B Portraits & Boot Render Timing)
- **Status**: `PASSED` on `feat/swarm-p0-p1-hardening`
- **HD-2D Tile PBR & Top/Side Wall Split**:
  - Extended `EcsTileDef.sideSprite`, `TileDesc` (`sideSprite`, `roughness`, `metallic`, `emissive`), `EcsWorldMapController.rebuildTiles()` + `patchLiveTileDef()`, `GpuQuad3DBatch`/`GpuEngine.drawBox3DWall()` (`emissive`), `SceneTrue3DPass.ts`, and `SceneGpuBridge.ts`; exposed live + transactional Tile PBR / Top+Side sprite controls in `EcsMapDesignerPanel.ts` and `PixerMcpProtocol.ts` (`describe_editor_grammar`).
- **Pixel Forge Multi-Pipeline Baking Profiles (`PixelForgeProcessor.ts` / `PixelForgeImportTab.ts`)**:
  - Added `PIXEL_FORGE_BAKING_PROFILES` (`wall_top_side`, `billboard_actor`, `emissive_light_prop`, `portrait_160x192`, `custom`), `synthesizeWallTopCapRgba()`, `detectEmissiveLightFromRgba()`, and `buildPixelForgeCommitCommands()` wiring `sideSprite` + `LightSource` / `emissive`.
- **Pass 1B `160×192` Dialogue Portrait Overlay (`portraitSpriteId`)**:
  - Added `portraitSpriteId` / `portraitSide` to `EcsCutsceneShotDef`, `kind: 'sprite'` to `HudPrimitiveDesc` + `SceneHudOverlayPass.ts` (`paletteRow: -2`), portrait framing in `EcsCinematicDirector.ts`, and narrative starter cutscenes in `PixerAssetPack.ts`.
- **Initial Preview Timing & Backend Canvas Sync (`EcsWorkbenchView.ts`)**:
  - Synced `dom.previewCanvas` via `GpuEngine` `onBackendChange`, guarded `renderPreviewNow()` with `hasBackend()`, and scheduled a post-init `rAF` refresh so `PA-14` renders `hd2d_3d` immediately on page load.
- **Live Browser & Full Gate**:
  - Live browser check at `http://localhost:3001/`: **0** console/page/shader errors; verified immediate `hd2d_3d` castle render on boot, Tile PBR inspector (`[data-testid="tile-pbr-inspector"]`), Pixel Forge `emissive_light_prop` & `wall_top_side` baking, and `vn_parlor_prologue` Pass 1B `160×192` portrait cutscene.
  - Full Gate: `bun run audit -- --strict` (exit 0, `critical=0`, `circularDepsCount=0`, `dynamicImportCount=5`) · `bun run lint` (0 err) · `bun run sim` (`[SIM ALL PASSED]`) · `npm run test` (**72 pass / 0 fail**) · `bun run build` (216 modules, `246ms`, **0 chunk warnings**).

---

## 10. Wave 5 Verification Log (True Z-Up 3D Spatial Architecture Phases A–C)
- **Status**: `PASSED` on `feat/swarm-p0-p1-hardening`
- **Phase A + Phase A Polish (`4955384`, `bac6de4`)**:
  - Unified Z-Up 6DoF & 5 orthographic projection views (`perspective`, `ortho_top`, `ortho_front`, `ortho_side`, `ortho_iso`, `ortho_free`) + `screenToWorldPlaneAxis` + `convertGlbYUpToPixerZUp` in `Perspective3DMath.ts` & `CameraRigDirector.ts`.
  - Delivered `GpuMesh3DBatch.ts`, indexed `Mesh3D` pipelines & `1024×1024` Directional Shadow Map in WGSL/GLSL (`WebGpuBackend`/`WebGl2Backend`), 360° camera-facing billboards/particles, and hardware 4-view `quadViews`.
- **Phase B (`fc49ff0`, `ea48d55`)**:
  - Delivered `EcsVoxelVolume.ts` (11 shapes, 8 stories, 6-bit neighbor face culling, stair/slope support & ceiling collision), `EcsModel3D.ts` (multi-part cuboids + `rawMesh` Zero-GC GPU emitter), 3D $A^*$ in `GridPathfinder.ts`, ECS `MeshRenderer3D`, `EcsSpatialOracle` (`analyzeWorldMap3DReachability`, `renderRoomSliceAscii`), and `48/48` `EcsStudioCommand` + MCP 3D tool parity (`WorldMap3D.test.ts`).
- **Phase C (`5c71fab`, `a093478`, `6e07c0f`, `6bea800` + Workstation Wiring)**:
  - Added strict bounds-checked `GlbImporter.ts` & `BbmodelImporter.ts` (Y-Up -> Z-Up + triangle winding inversion), lazy-loaded `ModelAtelierModalView.ts` (`model-atelier` Vite chunk), `.p7-spatial3d-bar` quad-view/ortho switcher, Alt+Drag 360° camera orbit, interactive RGB XYZ gizmo, Z-slice floor painting (`set_room_voxel` / `fill_room_box_3d`), 6DoF scene sliders, and `cartridges-hd2d` chunk split in `vite.config.ts`.
- **Live Browser & Full Gate**:
  - Live WebGL2 check at `http://localhost:3001/`: **0** console/page/network errors; verified 4-quadrant split (`3D PERSP | TOP [XY] | FRONT [XZ] | SIDE [YZ]`) w/ XYZ gizmo & ortho grid, and `ModelAtelierModalView` loading/previewing/saving sample `.bbmodel` (`Knight_Relic_Chest`).
  - Full Gate: `bun run audit -- --strict` (exit 0, `critical=0`, `circularDepsCount=0`, `snapshotArrayResets=0`, `dynamicImportCount=6`, `ecsCommandTypes=48/48`) · `bun run lint` (0 err) · `bun run sim` (`[SIM ALL PASSED]`) · `npm run test` (**89 pass / 0 fail**) · `bun run build` (222 modules, `355ms`, **0 chunk warnings**) · `bun run clean`.
