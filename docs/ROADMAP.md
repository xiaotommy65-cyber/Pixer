# Pixer — Engine, Art & Product Roadmap (Agent Reference)

## Strategic Principle
Build `@pixer/core` aesthetics, game-feel, and data-driven cartridge architecture FIRST inside the Arcade workspace. Do NOT build backend AI APIs, billing, or embed SDKs until Milestones 1–3 are rock-solid.

## Edition Separation Strategy (Core vs. Arcade vs. Edu)
Keep a clean boundary during M1–M3 so future splitting requires zero core rewrites:
- **Core (`src/core/` + `src/assets/` + `src/game/`)**: Pure Canvas/WebGPU surface + Cartridge Runtime + Audio/Sim. Zero DOM/UI/`@capacitor` imports; communicates outward only via typed state snapshots & events.
- **Arcade Shell (`src/ui/` — Current Default)**: Full Switch Joy-Con shell, Momo mascot, geek telemetry (FPS/draw calls), uncapped CRT/shader toggles, Capacitor mobile hooks.
- **Edu Shell (Future Wrapper / Build Target)**: Minimal embeddable viewport + curated/throttled editor tabs controlled by `EditionConfig` flags (e.g., `hideTelemetry`, `lockPalette`, `buggyChallengeMode`, `postMessage` bridge).

---

## Milestone 1 — Visual & Game-Feel Leap (DONE)
**Goal**: Elevate rendering polish and tactile feel on existing cartridges (`PA-01`, `PA-02`) before refactoring into generic JSON.

### Specs
1. **Indexed Palette LUT Shader**:
   - Represent 16x16 sprites as palette index textures (`0` transparent, `1..15` colors; `14..15` emissive).
   - Sample from a `16 x N` Palette LUT texture in WGSL & GLSL for instant theme swaps, hit-flash white override, and color-harmonized presets.
2. **3-Pass 2D HD-Pixel Pipeline**:
   - **Pass 1 (Depth & Grounding)**: 2–3 parallax sky/backdrop layers -> world/tiles -> elliptical drop shadows -> entities.
   - **Pass 2 (Emissive & Glow)**: Extract emissive palette indices (`14..15`) + `Radial GPU Light` to a 1/4-res offscreen buffer -> lightweight bloom composite.
   - **Pass 3 (Crisp Upscale & Console Post)**: Sharp pixel-grid upscaling + optional subtle LCD/CRT & vignette toggles.
3. **Procedural Motion & Juice Primitives**:
   - Add per-instance `pivot` (bottom-center), `sx, sy` (squash & stretch), `skewX`, and `flash`.
   - Zero-GC primitives: Hitstop (2–4 frame freeze), trauma-based Screen Shake, and fixed-size Particle Ring Buffer.

### Out of Scope (M1)
- Do NOT rewrite `PA-01/02/03` gameplay into generic JSON yet.
- Do NOT build backend APIs or embed wrappers.

### Done Criteria (M1)
- [x] `PA-01` & `PA-02` run smoothly at 60fps on WebGL2 (SwiftShader verified; WGSL WebGPU shader parity implemented, hardware WebGPU untested in headless VM) with Palette LUT swapping, shadows, emissive bloom, hitstop, and squash-and-stretch.
- [x] Zero per-frame GC allocations; `npm run lint && npm run sim && npm run build` pass.

---

## Milestone 2 — Unified Data-Driven Cartridge Engine (DONE)
**Goal**: Replace hardcoded cartridge TypeScript logic with a single Cartridge JSON Schema + deterministic VM.

### Specs
1. **Fixed 60Hz Accumulator** with render interpolation.
2. **Zero-GC SoA Entity Pool** (`MAX_ENTITIES = 2048`) + composable behaviors (`PlatformerPhysics` w/ Coyote Time & Jump Buffer, `TopDownMove`, `Patrol/Chase/Orbit`, `BulletEmitter`, `Solid/Hazard/Collectible`).
3. **Tilemap + 4-bit Auto-Tiling** with `O(1)` bitmask collision.
4. **Deterministic Event-Action VM**: `When` (`OnStart`, `OnEvery`, `OnCollide`, `OnButton`, `OnVar`) -> `Do` (`Spawn`, `Destroy`, `Impulse`, `SetVar`, `PlaySfx`, `Juice`, `EndGame`).

### Done Criteria (M2)
- [x] Both `PA-01` and `PA-02` run as pure Cartridge JSON files on the exact same runtime with zero cartridge-specific TS hacks.
- [x] `npm run sim` deterministically validates and dry-runs any Cartridge JSON.

---

## Milestone 3 — Creative Loop & Polaroid PNG Cartridges (CURRENT PRIORITY)
**Goal**: Connect visual editors and social/classroom cartridge sharing to the M2 schema.

### Specs
1. **Sprite Studio**: Mirror symmetry brush, 2–4 frame onion-skinning, palette theme presets, modular stamps.
2. **Scale-Locked Audio & Haptics**: Pentatonic-safe note triggers + combo pitch escalation + Capacitor haptic events.
3. **Polaroid PNG Cartridge Card**: Render a stylized cartridge card image (pixel cover + title + QR/tag) carrying full embedded Cartridge JSON for instant drag-and-drop sharing and remixing.

### Done Criteria (M3)
- [ ] A new playable cartridge (`PA-04`) can be built purely in-app, exported as a PNG card, and reloaded identically.

---

## Future Phase (Do NOT implement until M1–M3 complete)
- **Edu Edition (`Pixer Edu`) & Managed AI Backend**:
  - Server-side low-cost Structured Output AI compiler -> schema validation + headless `sim` check -> sandboxed `iframe` + `postMessage` embed (`Pixer.embed()` / YouTube-style copy-paste for teachers).
  - Targeted JSON diff co-pilot, teacher "Buggy Cartridge" debugging challenges, and anonymous class-code workflows parallel to Scratch.
