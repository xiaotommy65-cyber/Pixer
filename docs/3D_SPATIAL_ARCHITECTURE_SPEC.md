# Pixer 3D Spatial, Orthographic & Modeling Architecture Specification

> **Status**: Approved via `/grill-me` Architecture Interview (Q1–Q8)
> **Scope**: Engine-wide upgrade from 2.5D/Fixed-Yaw HD-2D to **Pixel-Sculpted 3D** (Unified Z-Up XYZ Space, Exact Tri-View Orthographic Cameras, Dual-Track WebGPU/WebGL2 `Mesh3D` + Directional Shadow Map, Multi-Story 3D World Grid & Physics, and Blockbench-style Model Atelier).
> **Constitutional Compliance**: Strictly honors `AGENTS.md` (Zero-GC, Native GPU WebGPU+WebGL2+Canvas2D fallback, Pure DOM-free `src/core/`, Single Workstation + Lazy Modals, Transactional `EcsStudioCommand` + `PixerMcpProtocol` parity).

---

## 1. Settled Architectural Decisions (Q1–Q8)

| # | Domain | Settled Decision |
|---|---|---|
| **Q1** | Core 3D Representation & Aesthetic | **Pixel-Sculpted 3D** (Blockbench / Cuboid Polyhedra + Multi-Story XYZ Space). Coexists cleanly with existing HD-2D billboards (`PA-14`, `PA-15`) and classic 2D (`PA-01`, `PA-02`, `PA-11`, `PA-12`). |
| **Q2** | XYZ Coordinate Basis & Camera | **Unified Z-Up** (`+X` East, `+Y` South, `+Z` Up) with full 360° Yaw/Pitch/Roll free orbit and exact **Tri-View Orthographic** projections (`Top XY`, `Front XZ`, `Side YZ`, `Isometric Ortho`, `Free Ortho`). Automatic `Y-Up → Z-Up` conversion at `.glb` import boundary. |
| **Q3** | 3D World Space Data Model | **Sparse Multi-Story 3D Grid** (backward-compatible `Z=0` legacy rooms) + **Geometric Primitives** (`cube`, `half_slab`, `slope_n/e/s/w`, `stair_n/e/s/w`, `arch`) + **Continuous Free 3D Entities**. Compiled to flat typed arrays at runtime for O(1) 3D AABB collision & raypicking. |
| **Q4** | GPU 3D Mesh & Lighting Pipeline | **Dual-Track Hybrid Pipeline**: preserve Zero-GC `GpuQuad3DBatch` for billboards/particles/effects + add **Indexed Triangle `Mesh3D` Pipeline** on both WebGPU WGSL & WebGL2 GLSL ES 3.00 + true 3D `(x, y, z)` point lights + **1 Directional Shadow Map** (`1024×1024` PCF) + per-vertex baked AO. |
| **Q5** | Modeling Workflow & Workstation UI | Single workstation (`EcsWorkbenchView`): add toggleable **Single 3D / 4-View Orthographic Split** (`[Persp | Top XY | Front XZ | Side YZ]`), interactive **X/Y/Z Transform Gizmo**, and **Z-Slice Floor Slider**. Add separate lazy-chunk **Model Atelier Modal** (Blockbench-style Cuboid/Pivot/Atlas-UV editor + `.glb`/`.bbmodel` import). |
| **Q6** | 3D ECS Components, Physics & AI | Extend existing `Spatial3D` (`yaw, pitch, roll, depth, stepHeight, ceilingZ, slopeNormal`) + add `MeshRenderer3D` (18th of 31 component bits) for 100% 2D/HD-2D backward compatibility. Upgrade to **3D AABB solid collision** (auto stair/slope step-up + ceiling clearance) + **Multi-Story 3D A*** (`(col, row, zLevel)`) + 3D `EcsSpatialOracle`. |
| **Q7** | Character Presentation & 360° Animation | *(Default)* **Dual-Mode Actors**: (a) Hierarchical Rigid Cuboid Pivot Rig (`EcsModel3DDef` keyframe clips, zero GPU skinning cost) and (b) Camera-Relative 4/8-Direction Billboards selecting facing sprite via `entityYaw - cameraYaw`. |
| **Q8** | Delivery Rhythm | Formalize this spec first, then execute incrementally in **4 verifiable phases (Phase A → B → C → D)** keeping all audit/lint/sim/test/build gates green at every phase. |

---

## 2. Unified Coordinate System & Camera Math Contract (Phase A1)

### 2.1 World Basis (Pixer Canonical Z-Up)
- **Origin**: Room top-left floor corner `(0, 0, 0)`, 1 world unit = 1 pixel (`TILE_SIZE = 32` px per tile, default `1 story = 32` px along `+Z`).
- **Axes**:
  - `+X`: East (Screen Right when `yawDeg = 0°`)
  - `+Y`: South (Screen Down on ground plane when `yawDeg = 0°`)
  - `+Z`: Up (Elevation / wall height / multi-story floors)
- **External glTF 2.0 (`Y-Up`) Import Conversion**:
  - Position & Normal: `(gx, gy, gz) → (gx, gz, gy)`
  - Winding Swap: because swapping `Y ↔ Z` has determinant `-1`, every imported triangle `(i0, i1, i2)` MUST be wound as `(i0, i2, i1)` so front-face normals remain outward.

### 2.2 Orthonormal 6DoF Basis (Zero Gimbal Singularity)
For camera target `(camCenterX, camCenterY, camCenterZ)`, angles `(yawDeg, pitchDeg, rollDeg)`, and orbit distance `D`:
- Let `sy = sin(yaw)`, `cy = cos(yaw)`, `sp = sin(pitch)`, `cp = cos(pitch)`, `sr = sin(roll)`, `cr = cos(roll)`.
- Eye position:
  - `eye = target + D * (-sy * cp, cy * cp, sp)`
- Unrolled orthonormal camera axes (valid even at exact `pitch = ±90°` for Top XY plan view):
  - `R0 = (cy, sy, 0)` (Camera Right)
  - `U0 = (sy * sp, -cy * sp, cp)` (Camera Up)
  - `F  = (sy * cp, -cy * cp, -sp)` (Camera Forward toward target)
- Rolled axes around `F`:
  - `R = R0 * cr + U0 * sr`
  - `U = -R0 * sr + U0 * cr`
- **Backward Compatibility Guarantee**: At `yawDeg = 0, rollDeg = 0, camCenterZ = 0, projection = 'perspective'`, the resulting eye, basis, projection, ViewProj matrix, and analytical unprojection are bit-for-bit identical to the pre-existing `Perspective3DMath.ts`.

### 2.3 Camera Projection Modes
```ts
export type Camera3DProjectionMode =
  | 'perspective'
  | 'ortho_top'   // Yaw 0°, Pitch 90°  (+X Right, +Y Down, looking -Z)
  | 'ortho_front' // Yaw 0°, Pitch 0°   (+X Right, +Z Up,   looking -Y)
  | 'ortho_side'  // Yaw 90°, Pitch 0°  (+Y Right, +Z Up,   looking +X)
  | 'ortho_iso'   // Yaw 45°, Pitch 35.2643897° (True Axonometric Isometric)
  | 'ortho_free'; // Orthographic at arbitrary (yawDeg, pitchDeg, rollDeg)
```
- **Perspective Clip Space**: `clipX = dot(P-eye, R) * (focal / aspect)`, `clipY = dot(P-eye, U) * focal`, `clipW = dot(P-eye, F)`, `clipZ = clipW * zA + zB` (`[0, 1]` for WebGPU, `[-1, 1]` for WebGL2).
- **Orthographic Clip Space**: `halfW = viewW / (2 * zoom)`, `halfH = viewH / (2 * zoom)`, `clipX = dot(P-eye, R) / halfW`, `clipY = dot(P-eye, U) / halfH`, `clipW = 1`, linear `clipZ` mapped to `[0, 1]` (WebGPU) or `[-1, 1]` (WebGL2).
- **Unified Analytical Ray Picking**:
  - `screenToWorldRay3D(screenX, screenY, cam, outRay)` returns exact `(originX/Y/Z, dirX/Y/Z)` for both perspective and orthographic modes.
  - `screenToWorldPlaneAxis(screenX, screenY, cam, axis: 'x' | 'y' | 'z', planeCoord, out3)` supports exact mouse picking & gizmo dragging on XY (`Z=const`), XZ (`Y=const`), and YZ (`X=const`) planes.

---

## 3. Dual-Track GPU `Mesh3D` & Shadow Map Contract (Phase A2)

### 3.1 Indexed `Mesh3D` Vertex Layout (`FLOATS_PER_MESH3D_VERTEX = 20`, 80 bytes)
| Shader Location | Format | Components | Meaning |
|---|---|---|---|
| `location(0)` | `vec4f` | `posX, posY, posZ, ao` | World-space position + per-vertex baked AO (`0..1`) |
| `location(1)` | `vec4f` | `normX, normY, normZ, atlasPage` | World-space normal + `Texture2DArray` layer index |
| `location(2)` | `vec4f` | `u, v, paletteRow, mode` | Atlas UV, LUT row (`< -0.5` = full RGBA), `mode` (`0=atlas PBR`, `1=solid PBR`, `2=unlit gizmo/wire`) |
| `location(3)` | `vec4f` | `r, g, b, a` | Tint/albedo color & alpha |
| `location(4)` | `vec4f` | `roughness, metallic, emissive, flash` | PBR-Lite material params + white hit-flash |

- **Zero-GC Buffers** (`GpuMesh3DBatch.ts`):
  - `MAX_MESH3D_VERTICES = 65536` (`Float32Array`, opaque + alpha pools)
  - `MAX_MESH3D_INDICES = 196608` (`Uint32Array`)
  - `MAX_LINE3D_VERTICES = 16384` (dedicated crisp 3D axis / orthographic grid / gizmo line batch)
- **Built-In Procedural Geometry Emitters**:
  - `pushMesh3DIndexed`, `pushCuboid3D` (with 6-bit face culling `N=1, E=2, S=4, W=8, +Z=16, -Z=32`), `pushRamp3D` (`n|e|s|w`), `pushStairs3D` (`n|e|s|w`, configurable steps), `pushLine3D` / `pushAxisGizmo3D`.

### 3.2 True 3D Dynamic Point Lights & Directional Shadow Map
- **3D Point Lights**: `GpuEngine.pushDynamicLight3D(x, y, z, radius, colorHex, intensity, falloff)` populates `lightPosZ[24]` (default `z = 24` for legacy 2D `pushDynamicLight` callers). Both `Quad3D` and `Mesh3D` shaders compute true 3D Euclidean distance `length(lightPos3D - worldPos3D)` and 3D attenuation.
- **Directional Shadow Map (`1024×1024`)**:
  - **Pass 0 (Shadow Depth Pass)**: Orthographic `lightViewProj` matrix centered on `(camCenterX, camCenterY, camCenterZ)` aligned with `sunDir = normalize(dirX, dirY, dirZ)` (default `(-0.38, 0.48, 0.79)`). Renders opaque `Mesh3D` triangles + opaque `Quad3D` casters into a `1024×1024` depth texture (`depth24plus` / `depth32float` on WebGPU, `DEPTH_COMPONENT24` with hardware `COMPARE_REF_TO_TEXTURE` on WebGL2).
  - **Pass 1A (Main 3D Scene Pass)**: Renders Sky → Opaque `Mesh3D` → Opaque `Quad3D` → Alpha `Mesh3D` → Alpha/Additive `Quad3D` → Unlit 3D Gizmo/Axis Lines. Both `Mesh3D` and `Quad3D` sample the shadow map with a 3×3 PCF kernel + normal-offset bias (`worldPos + n3d * bias`) to eliminate shadow acne and Peter-Panning.
  - **Pass 1B / Pass 2 / Pass 3**: Unchanged 2D HUD overlay, 1/4-res Karis Emissive Bloom, and ACES/LCD/CRT Composite.
- **Backend Parity**: 100% parity between `WebGpuBackend` (WGSL) and `WebGl2Backend` (GLSL ES 3.00); `Canvas2DBackend` gracefully ignores optional `mesh3d` pass and falls back to 2.5D.

---

## 4. Roadmap Across Phases B, C & D

### Phase B — Multi-Story 3D World Space, Physics & AI-Native MCP
- **Schema (`EcsTilemapTypes.ts` / `EcsProjectSchema.ts`)**:
  - Extend `EcsMapRoomDef` with optional `voxels?: EcsVoxelCellDef[]` (sparse `(col, row, zLevel)` entries with `shape: 'cube' | 'half_slab' | 'slope_n' | 'slope_e' | 'slope_s' | 'slope_w' | 'stair_n' | 'stair_e' | 'stair_s' | 'stair_w' | 'arch'`, `tileId`, `rotZ`). Legacy `ground/wall/decor` map transparently to `zLevel = 0`.
  - Add `models3d?: Record<string, EcsModel3DDef>` for reusable hierarchical cuboid models (`parts[]` with `origin/size/pivot/rot/uvFaces`, `clips[]` keyframe animations).
- **ECS & Physics (`ComponentStore.ts`, `EcsActionPhysicsSystems.ts`, `GridPathfinder.ts`)**:
  - Extend `Spatial3DData` with `yaw, pitch, roll, depth, stepHeight, ceilingZ, slopeNormalX/Y/Z`.
  - Add `MeshRenderer3D` component (`modelId, scaleX/Y/Z, animClip, animTime, castShadow, billboardMode`).
  - Compiled flat `RoomVoxelVolume` typed arrays for O(1) 3D AABB sweep, automatic stair/slope step-up (`dz <= stepHeight`), ceiling head-bonk clamp, and Multi-Story 3D A* (`(col, row, zLevel)`).
- **AI-Native Parity (`EcsStudioSession.ts`, `PixerMcpProtocol.ts`, `EcsSpatialOracle.ts`)**:
  - Transactional commands: `set_room_voxel`, `fill_room_box_3d`, `upsert_model_3d`, `remove_model_3d`, `set_camera_3d_pose`.
  - MCP tools: `get_room_slice_ascii(roomId, zLevel)`, `analyze_world_map_3d`, `mutate_world_3d`.

### Phase C — Tri-View Orthographic Workstation, XYZ Gizmo & Model Atelier
- **Workstation (`EcsWorkbenchView.ts`)**:
  - Single / 4-View Quad Viewport toggle (`[3D Persp | Top XY | Front XZ | Side YZ]`) rendered cleanly through `GpuEngine` with scissor/viewport or dedicated camera projections, interactive X/Y/Z axis gizmo, and Z-Slice Floor Slider.
- **Lazy-Chunk Model Atelier Modal (`ModelAtelierModalView.ts`)**:
  - Blockbench-inspired Cuboid 3D editor (part tree, pivot/rotation sliders, 6-face `TextureAtlas` UV picker, live 3D orbit + tri-view preview).
  - DOM-free `.glb` (glTF 2.0 binary) & `.bbmodel` importers in `src/core/interop/` with strict size/buffer-bound guards and automatic `Y-Up → Z-Up` basis + winding conversion.

### Phase D — Flagship Multi-Story 3D Validation & Character Rigging
- Multi-story playable showcase room (overpass bridge, walkable 3D stairs & ramps, 3D cuboid props & dynamic torches casting real 3D shadows under 360° camera orbit, camera-relative 4/8-way billboard actors alongside rigid cuboid rigged NPCs).
- Full live browser GPU visual verification (`WebGL2` / `WebGPU`) across all 4 orthographic + perspective views.
