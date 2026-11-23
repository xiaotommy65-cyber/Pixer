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

### Phase 3 — Production Provisioning, Auth UI & Multiplayer Observability `[NEXT]`
- Provision Cloudflare R2 bucket (`pixer-assets`), deploy `workers/api` via `wrangler deploy`, apply Supabase SQL migration, and configure `VITE_CLOUD_API_BASE` + `VITE_CDN_BASE_URL` in CI.
- Add optional sign-in / one-click "Publish & Copy `?play=<slug>`" UI button in `EcsWorkbenchView` and bind curated external `.opus` audio packs to R2 CDN.
