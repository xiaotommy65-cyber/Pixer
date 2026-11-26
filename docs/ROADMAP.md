# Pixer — Engine-First & Cloud-Offload Roadmap

## Strategic Principle (Local-First Pixel PBR Engine + Edge Cloud Offload)
Every game and workstation built on Pixer runs **60Hz simulation & rendering locally** on Pixer's **WebGPU / WebGL2 24-float PBR-Lite Pixel Engine**, **8-Page `1024×1024` Texture Atlas**, **True Generational ECS**, **Pure Data-Driven WorldMap Runtime**, and **External Standard Format Importers (Aseprite / LDtk / Tiled)**—while offloading heavy static assets, external audio packs, project sharing, and LLM/MCP proxying to **Cloudflare (Pages + Workers + R2 CDN) + Supabase (PostgreSQL + Auth)**.

- **Core (`src/core/` + `src/assets/` + `src/game/`)**: Pure multi-backend GPU surface + Generational ECS + Multi-Room HD-2D Tilemap Runtime + External Audio Asset Bank (zero AI synth noise) + Sandboxed Script VM. Zero UI / `@capacitor` imports.
- **Single Authoring Workstation (`EcsWorkbenchView` + `EcsMapDesignerPanel` + `EventGraphEditorView` + `ExternalImportModalView` + `SpriteAtelierView`)**: Unified human ↔ AI creation toolset (`EcsStudioSession` + `PixerMcpProtocol` + `AgentBridge`).
- **Focused Handheld Showcase (`ConsoleView`)**: `PA-14`《黑曜魔王城》, `PA-15`《翠律遺跡》, `PA-01`《草莓雲海跳跳》, `PA-02`《糖霜流星號》, plus True ECS templates `PA-11` & `PA-12`.

---

## Completed Baselines `[DONE]`

### Pixer 1.0 → 10.5 + M1 (GPU PBR, True ECS, WorldMap, Custom Sprites, Interop) `[DONE]`
- `1280×720` viewport ceiling, 8-page `Texture2DArray` Atlas Pool + MaxRectsBin + PNG Slicer, 24-float PBR-Lite across WGSL/GLSL/Canvas2D, 24 dynamic point lights, 2D wall shadow occlusion grid, realtime planar water reflections, 3-Pass Karis Bloom, Polaroid PNG iTXt codec.
- True Generational `EcsCoreWorld`, Prefabs with sparse overrides, `Spatial3D` + dual-mode `hd2d_3d`/`hd2d_iso`, lossless `EventGraphEditorView`, pure data-driven Multi-Room HD-2D WorldMap, `EcsCustomSpriteCompiler` (grid / `rgba_b64` / 13 Oklab+Bayer PBR recipes), and Aseprite / LDtk / Tiled importers.

### Phase 0 — Audio Diet, Legacy Cartridge Pruning & Security/CI Hardening `[DONE]`
- **Audio & Rhythm Diet**: Retired `PA-13` 4K Rhythm subsystem & `Stage3DPipeline.ts` parallel Canvas 2D renderer (~10,815 LOC) and all AI procedural oscillator synths/sequencers (~2,493 LOC). Replaced with lean external-asset-only `ExternalAudioBank.ts` (CDN `.opus`/`.mp3` BGM streaming + bounded LRU `AudioBuffer` SFX cache + silent fallback).
- **Focused Cartridge Lineup**: Pruned legacy hand-written cartridges (`PA-03..PA-10`, `LegacyCartridgePack`, `RpgOverlayView`, `ChronicleOverlayView`, `WorkshopTemplates`). Retained user favorites `PA-01` & `PA-02` alongside True ECS flagships `PA-14`, `PA-15`, `PA-11`, `PA-12`.
- **Security & Protocol Hardening**: Fixed UTF-8 multi-byte `Content-Length` framing in `scripts/pixer-mcp.ts`; added zip-bomb/path-traversal & bounded streaming `Unzlib`/`Gunzip` guards across `InteropBundleLoader`, `AsepriteParser`, `TiledImporter`, and `EcsCustomSpriteCompiler`.
- **CI & Hygiene**: Removed out-of-sync `package-lock.json` (unified on `bun.lock`), added `npm run test` to GitHub Actions `deploy.yml`, stabilized `Module 3` benchmark, and synced `README.md` / `AGENTS.md` / `metadata.json`.

---

## Active Roadmap (Next Phases)

### Phase 1 — Workstation Modularization (M2 Rules Inspector) & Web Worker Offload `[DONE]`
- Extracted `EcsWorkbenchAtlasPanel.ts` & `EcsWorkbenchPrefabInspector.ts` out of `EcsWorkbenchView.ts` (3,712 → 3,230 LOC).
- Delivered pure data-driven **M2 Visual World Rules Inspector** (`EcsWorldRulesInspectorPanel.ts`): visual editing for `portals`, `interactions`, `aiProfiles`, `heroConfig`, and `hud[]` with full `EcsStudioSession` Undo/Redo parity and live BFS soft-lock oracle banner.
- Offloaded `.zip` / `.aseprite` / `.ldtk` / `.tmj` archive decompression & parsing into `src/workers/interop.worker.ts` via `InteropWorkerClient.ts` (with automatic main-thread fallback).

### Phase 2 — Cloudflare R2 CDN + Supabase Cloud Storage & Edge API `[DONE]`
- Delivered **Supabase PostgreSQL + Auth + RLS** migration (`supabase/migrations/20261122000000_pixer_cloud_schema.sql`: `profiles`, `projects`, `project_revisions`, `user_saves` + strict RLS policies & triggers).
- Delivered **Cloudflare Workers Edge API + R2 Asset Layer** (`workers/api/`: `/api/health`, `/api/assets/:key+` immutable 1-year cache + path-traversal guard, `PUT /api/assets/upload` SHA-256 content-addressed R2 upload, `GET/PUT /api/projects/:slug` with ETag `If-Match` 412 optimistic locking & `304 Not Modified`, `GET/PUT /api/saves/:slug` timestamp SRAM merge, `POST /api/ai/*` LLM proxy, and `POST /api/mcp` Remote Streamable HTTP MCP).
- Delivered DOM-free **`src/core/cloud/CloudSyncClient.ts`**, `?play=<slug>` direct-launch bootstrap in `src/main.ts`, `docs/CLOUD_SETUP.md`, and full end-to-end tests in `scripts/sim/CloudOffload.test.ts`.

### Phase 3a–3e — Architecture Modularization & Toolchain Alignment `[DONE]`
- Fine-grained decomposition of `ConsoleView`, `WindowDioramaView`, `EcsWorkbenchView` (3,234 → 868 LOC), `EcsSnapshotProjector`, `SpriteAtelierPixelOps`, `SceneGpuBridge` 3D passes, and `DataCartridgeRuntime` (`DataRuntimePlatformer` + `DataRuntimeSnapshot`); retired 9 dead `WorldKernel*` files (-2,678 LOC) and pinned Bun `1.4.5`.

### Phase 4 — Genre Arsenal Restoration & True ECS Runtime Wiring `[DONE]`
- Restored `CardDeckEngine` & `FighterFrameEngine` multi-genre sub-engines and wired Zero-GC `GridPathfinder` A*, `Visibility2D` LOS/FOV, 6DoF `CameraRigDirector`, and `GameFlowController` directly into `EcsWorldMapController` & `EcsCartridgeRuntime`.

### Phase 5 — Cinematic Director, Aesthetic Critic Oracle & Local IDE Readiness `[DONE]`
- Delivered `EcsCinematicDirector` (Auteur 14-field DSL, Toric Two-Shot solver, 3-phase critically damped spring handback, 21:9 letterbox/subtitle HUD) + `EcsCinematicOracle` (60Hz FilmFlow headless scout, 5-axis mathematical critic, ASCII storyboard) exposed via `critique_cutscene_aesthetics` MCP tool.
- Configured `.agents/` workspace rules (`engine-sim`, `gpu-shaders`, `algorithm-shader-protocol`, `ui-workstation`, `cloud-edge`), workspace `.agents/mcp_config.json`, and workspace skills for full local Antigravity App / IDE / CLI workflows.

### Phase 6A — P0–P1 Engine Hardening, Lazy Split, Phase 6 Workstation UI & Live GPU Verification `[DONE]`
- **Wave 1 (Math, Dual-GPU Parity, Director Wiring, Zero-GC & Cycles)**: Fixed 5 core math bugs + zero-box `ColorMath` (`2.46ms / 13KB`); aligned WGSL/GLSL Pass 1B overlay bind group, WebGL2 `texSubImage3D` + linear DoF sampler, `F0=0.04` Schlick PBR, and bounded 32-step 2D DDA shadows; wired `GameFlowController` + `EcsCinematicDirector` end-to-end (`timeScale`, `pitchDeltaDeg`, `tiltShift*`, zoom-aware `clampAxis`/handback); cut `240f Snapshot Zero-GC` from `~2.3 MB` to `37.3 KB / 26.7 KB`; broke all circular imports (`0` cycles), synced `42/42` `ECS_COMMAND_CATALOG`, pruned dead CSS (`82 -> 8`), and added read-only `bun run audit` toolchain (`scripts/pixer-audit.ts`, `scripts/audit/*`).
- **Wave 2 (Code-Splitting, 3D/SCC Oracles, Flagship Cutscenes, Phase 6 UI & Live Browser GPU Check)**: Added dynamic `import()` lazy loading (`SpriteAtelierView`, `CapacitorNativeBridge`, `ExternalImportModalView`) + 60Hz HUD/Save dirty checks + idle Studio 0-draw GPU cap; upgraded `EcsCinematicOracle` (3-point multi-frame + `hd2d_3d` & `actorB` occlusion) and `EcsSpatialOracle` (dead-end room / walled-portal / solid-spawn checks); authored 4 S-grade flagship cutscenes in `PA-14` & `PA-15` (98–100/100); exposed Cutscene Critic/Play UI & Zero-GC `FOV Fog` toggle in `EcsWorkbenchView`; verified live at `http://localhost:3000/` with 0 console/shader errors.

### Phase 6B — Build Chunk Polish, Cutscene HUD Overlay Parity, V1 Freeze & Cloud Publish UI `[DONE]`
- Decoupled static `@capacitor/core` import from `src/ui/PwaBridge.ts`, lazy-loaded `EventGraphEditorView` & `CloudPublishModalView`, and split `vite.config.ts` chunks (`ecs-workbench` `510.77 kB -> 339.23 kB`, **0 chunk warnings**).
- Added `GpuDynamicGlyphCache.ts` (256-glyph CJK/Unicode dynamic atlas cache), subtitle dark contrast backdrop in `EcsCinematicDirector`, and Shot 0 subtitles in `PA-14` / `PA-15`; verified Shot 0 subtitle + Shot 1 `splashTitle`/`splashSubtitle` live in Chrome `hd2d_3d` Pass 1B.
- Locked V1 legacy sub-engines (`GenreControllers`, `CardDeckEngine`, `FighterFrameEngine`, `DataCartridgeRuntime`, `src/core/editor/*`) as a frozen compatibility tier isolated in Vite chunk `legacy-v1-sim`.
- Added lazy-loaded `CloudPublishModalView.ts` in the workstation toolbar (`雲端發佈`) backed by `CloudSyncClient` (`?play=<slug>` sharing, ETag `If-Match` handling, offline `.pixer.json` fallback).

### Phase 7A–7B — Universal Pixel Forge, Multi-Pipeline Baking, `160×192` Pass 1B Portraits & `PixerAssetPack` v1 `[DONE]`
- Raised `EcsCustomSpriteDef` bounds to `8..256` (supporting `160×192` visual-novel portraits and `256×256` horror/dungeon bosses) while keeping strict zlib decompression bounds.
- Delivered DOM-free `PixelForgeProcessor.ts` (corner flood-fill background strip, tight opaque crop, integer pixel block detection, `grid_majority` Oklab `adaptive_kmeans`/`palette_lock` quantization across 5 genre palettes + Bayer4 + 1px outline, sprite-sheet slicing -> `AnimationStateMachineDef`, plus multi-pipeline baking profiles `wall_top_side`, `billboard_actor`, `emissive_light_prop` w/ `detectEmissiveLightFromRgba`, and `portrait_160x192`) and `PixerAssetPack.ts` (`schemaVersion: 1`, `horror`/`visual_novel`/`dungeon` starter packs w/ portrait cutscenes + MCP `install_asset_pack`/`export_asset_pack`).
- Wired `EcsTileDef.sideSprite` + PBR (`roughness`/`metallic`/`emissive`) through `SceneTrue3DPass`/`SceneGpuBridge`/`EcsMapDesignerPanel`, Pass 1B `portraitSpriteId` portrait rendering in `EcsCinematicDirector`/`SceneHudOverlayPass`, and initial-boot `hd2d_3d` preview sync in `EcsWorkbenchView` with live browser verification (`0` errors).

### Phase 7C — True Z-Up 3D Spatial Architecture (Multi-Story Voxels, Mesh3D, Quad-View CAD & Model Atelier) `[DONE]`
- Delivered unified Z-Up 6DoF + 5 orthographic projections (`Perspective3DMath.ts`, `CameraRigDirector.ts`), indexed `Mesh3D` rendering + `1024×1024` directional shadow map (`GpuMesh3DBatch.ts`, WGSL/GLSL parity), 360° billboards/particles, and hardware 4-view `quadViews`.
- Delivered `EcsVoxelVolume.ts` (11 shapes, 8 stories, 6-bit face culling, 3D support/ceiling physics), `EcsModel3D.ts` + `MeshRenderer3D`, 3D $A^*$ pathfinding (`GridPathfinder.ts`), `EcsSpatialOracle` 3D BFS + slice ASCII, and `48/48` `EcsStudioCommand` / MCP 3D tools.
- Delivered Y-Up→Z-Up `GlbImporter.ts` & `BbmodelImporter.ts`, lazy-loaded `ModelAtelierModalView.ts` (`model-atelier` chunk), workstation `.p7-spatial3d-bar` quad-view/ortho switcher, interactive RGB XYZ gizmo, Alt+Drag 360° orbit, Z-slice floor painting, and `89/89` tests + live WebGL2 browser verification.

### Phase 8 — Production Cloud Provisioning, Live `?play=<slug>` & Optional BYOK AI Art Bridge `[NEXT]`
- Provision Cloudflare R2 (`pixer-assets`), deploy `workers/api`, apply Supabase SQL migration (`docs/CLOUD_SETUP.md`), configure `VITE_CLOUD_API_BASE` + `VITE_CDN_BASE_URL`, verify live `?play=<slug>` & SRAM sync, and optionally connect BYOK external image generation directly into Pixel Forge.
