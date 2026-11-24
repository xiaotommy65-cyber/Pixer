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
