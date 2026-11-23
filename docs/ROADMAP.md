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

### Phase 2 — Cloudflare R2 CDN + Supabase Cloud Storage & Sharing `[NEXT]`
- Host external audio packs (`.opus`/`.mp3`) and shareable cartridge bundles on **Cloudflare R2** (SHA-256 content-addressed immutable caching, \$0 egress).
- Stand up **Supabase PostgreSQL + Auth + RLS** (`projects`, `project_revisions`, `user_saves`) with short share URLs (`/play/:slug`) and cross-device SRAM cloud sync.

### Phase 3 — Edge AI Proxy & Remote Streamable HTTP MCP `[PLANNED]`
- Deploy **Cloudflare Workers (Hono + Zod)** for `/api/ai/*` (connecting `RemoteAiProvider.ts` with secret isolation, rate limiting, and caching), `/api/mcp` (Remote Streamable HTTP MCP), and presigned R2 asset uploads.
