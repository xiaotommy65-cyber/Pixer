# Pixer — Engine-First Roadmap (Pixer 1.0 → 10.5+)

## Strategic Principle (Engine-First Pixel PBR & AI-Native Architecture)
Every game and workstation built on Pixer MUST showcase Pixer's own **WebGPU / WebGL2 24-float PBR-Lite Pixel Engine**, **8-Page `1024×1024` Texture Atlas**, **True Generational ECS**, **Pure Data-Driven WorldMap Runtime**, **Oklab + Bayer 4×4 Pixel Craft**, and **AI-Native Authoring Protocol**—never photorealistic AI wallpapers, game-specific engine hacks, or parallel disconnected renderers.

- **Core (`src/core/` + `src/assets/` + `src/game/`)**: Pure multi-backend GPU surface + Generational ECS + Multi-Room HD-2D Tilemap/Top-Down Runtime + 6DoF Camera Rig + Multi-Scene Flow + Sandboxed Script VM + Web Audio. Zero UI / `@capacitor` imports.
- **Single Authoring Workstation (`EcsWorkbenchView` + `EcsMapDesignerPanel` + `SpriteAtelierView`)**: One unified creation toolset for both humans and AI agents (`EcsStudioSession` + `PixerMcpProtocol` + `AgentBridge`).
- **Arcade Showcase (`ConsoleView`) & Standalone Game Host**: Tactile Switch handheld showcase (`PA-01..PA-14`) + fullscreen standalone host (`PA-13`), with strict lazy GPU lifecycle.

---

## Completed Baselines `[DONE]`

### Pixer 1.0 → 9.0 (Core GPU PBR, True ECS, Physics, Spatial3D, EventGraph) `[DONE]`
- `1280×720` viewport ceiling, 8-page `Texture2DArray` Atlas Pool + PNG Slicer, 24-float PBR-Lite across WGSL/GLSL/Canvas2D, 24 dynamic point lights, realtime planar water reflections, 3-Pass Bloom, Polaroid PNG iTXt cartridge codec.
- True Generational `EcsCoreWorld` (17 sparse-set components, 5-phase 14-system pipeline), Prefabs with sparse overrides, `Spatial3D` multi-dimension masks (`ortho_2d` / `hd2d_iso` / `first_person_25d`), lossless `EventGraphEditorView`, local stdio MCP server (`npm run mcp`).

### Engine 10.0 Phase A — Engine-First Consolidation & Hygiene `[DONE]`
- Purged 5 photorealistic AI JPEG wallpapers (~4.55 MB), 2 orphan PNGs, 35 unused skill packs (~9,283 LOC), and 3 duplicate Studio 6.0 UI shells; unified onto lazy-init `GpuEngine` and automated `ArchitectureTests.ts` guards.

### Engine 10.5 — Pure Data-Driven Multi-Room HD-2D Tilemap Engine & AI-Native Editor `[DONE]`
- **32×32 / 48×64 HD-2D Multi-Room Engine**: 3-layer tilemaps (`ground/wall/decor`), extruded PBR walls, tall `renderH` decor, declarative `ambientLight` tile light pools, cross-room portals with `requiresGlobal`, AABB tile/prop wall sliding, and clamped follow camera.
- **100% Pure Data-Driven Core (Zero Game Hardcoding)**: All top-down hero combat (`heroConfig`), interactive props (`interactions`), multi-phase enemy/boss AI (`aiProfiles`), custom tile sets (`tileDefs`), room framing (`editorFocusY`), and `hud[]` are strictly data-driven. Enforced by **Engine Core Purity Gate** + **Non-Castle Sci-Fi Space Station Proof** in `WorldMap.test.ts`.
- **Flagship Showcase `PA-14`《黑曜魔王城：赤月王座》**: 31 procedural PBR pixel sprites (`CastleSprites.ts`), 3 interconnected scrolling halls (Outer Bailey → Stained Nave → Crimson Throne), key/switch gates, and 2-phase Boss battle running 100% as pure project data.
- **AI-Native Authoring Protocol (26 Commands + Oracles)**: `stamp_room_ascii` compact 2D blueprint stamping (tiles + prefabs in 1 atomic command), rule/tile/AI/HUD commands, self-describing `describe_editor_grammar`, token-efficient `get_room_ascii`, deterministic Multi-Room BFS + Key/Switch Dependency Oracle (`analyze_world_map`), and `in_room` / `boss_hp_lte` scripted playtest assertions.

### M1 — 自訂像素瓦片與跨主題創作能力 (Custom Pixel Tiles & Cross-Theme Authoring) `[DONE]`
- **Project-Embedded Custom Sprites & Hot Atlas Compiler**: Added serializable `EcsProjectV2.customSprites` (`kind: 'grid'` palette-indexed pixel arrays & `kind: 'procedural'` 13 Oklab + Bayer 4×4 PBR pixel patterns across `16×16`/`32×32`/`32×48`/`48×64`) + DOM-free `EcsCustomSpriteCompiler.ts` hot-compiling into `TextureAtlas` dynamic pages without recreating GPU contexts (Undo/Redo + JSON safe).
- **AI-Native Custom Asset Commands (28 Total Commands)**: Added transactional `upsert_custom_sprite` & `remove_custom_sprite` to `EcsStudioSession` + `ECS_COMMAND_CATALOG`, `list_custom_sprites` + `proceduralSpritePatterns` to `PixerMcpProtocol` & `AgentBridge`.
- **SpriteAtelier ↔ Map Designer One-Click Bridge**: Upgraded `SpriteAtelierView` to non-square `16×16 → 32×32 → 48×64` canvas support and added one-click **「發佈為地圖瓦片」** (`ground`/`wall`/`decor`, solid/hazard/light) & **「發佈為物件印章」** directly wired into `EcsMapDesignerPanel` (`+ 畫室新增`, `自訂` badges) & `EcsWorkbenchView` (Atlas thumbnails & PBR dropdown).
- **Cross-Theme Proof (`PA-15`《翠律遺跡：星露聖域》 + Pure MCP Orbital Deck)**: 100% custom-sprite 2-room forest ruins showcase (`20` project custom sprites, `0` castle sprites) + pure MCP-authored 2-room Sci-Fi Orbital Deck verified via BFS Oracle (0 soft-locks), 60Hz scripted playtest, and live browser visual inspection.

---

## Next Engine Core Milestones (Active Roadmap)

### M2 — 工作站「規則、機關與傳送門」可視化檢視器 `[NEXT]`
- Visual inspector tabs inside `EcsWorkbenchView` for editing `interactions`, `aiProfiles`, `portals`, `heroConfig`, and `hud[]` with live validation and Undo/Redo—achieving full human ↔ AI co-authoring parity.

### M3 — 原生 GPU PBR 像素光影、動態水流與動作打擊感升級 `[PLANNED]`
- Animated UV lava/water shaders, 2D Visibility soft shadow occlusion, hit-stop freeze frames, knockback/dust GPU pixel particle emitters, and normal-map depth channels across WGSL/GLSL.

### M4 — 原生 `GpuEngine` HD-2D 像素 PBR 重製《星脈共鳴 PA-13》 `[PLANNED]`
- Retire `Stage3DPipeline.ts` and rebuild the 4K rhythm concert hall, 128×128 engine-compiled pixel album jackets, and brass-trimmed crystal note highway directly on `GpuEngine`'s 24-float PBR + 3-Pass Bloom pipeline.
