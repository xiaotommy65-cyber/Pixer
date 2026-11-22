---
trigger: glob
globs: src/core/gpu/**, src/core/runtime/SceneGpuBridge.ts, **/*.wgsl, **/*.glsl
description: Engine-First WebGPU/WebGL2 PBR-Lite pixel pipeline, zero-GC buffers, and anti-AI-slop art discipline.
---
# GPU, Shader & Engine-First Art Constitution
- **Single Native GPU Pipeline**: All primary game stages MUST render through Pixer's `GpuEngine` (`WGSL` WebGPU + `GLSL ES 3.00` WebGL2 24-float PBR-Lite + 8-page `Texture2DArray` + 3-Pass Bloom), with `Canvas2DBackend` strictly as hardware fallback. Never build an isolated Canvas 2D shadow renderer to bypass `GpuEngine` for flagship titles.
- **Strict Parity**: Maintain visually identical output across `WGSL` (WebGPU) and `GLSL ES 3.00` (WebGL2), degrading cleanly to `Canvas2DBackend`.
- **Zero-GC Buffers**: Pre-allocate and reuse vertex/instance `Float32Array` buffers; never allocate typed arrays or gradients per frame.
- **Crisp Pixel Craft Only (Zero Photorealistic AI Wallpapers)**: Enforce nearest/sharp pixel scaling (`image-rendering: pixelated`), Oklab-harmonized palettes, and Bayer 4×4 dithering. Never drop generic photorealistic AI-generated `.jpg`/`.png` wallpapers or stock illustrations into `src/assets/` or `public/assets/`.
- **Palette & Emissive Convention**: Index `0` = transparent, `1..13` = standard palette colors, `14..15` = emissive candidates for bloom/glow pass; 24-float instance attributes carry `(atlasPage, roughness, metallic, emissive)`.
- **Lazy GPU Lifecycle**: Never eagerly initialize hidden WebGPU/WebGL2 contexts on startup; initialize on demand when a workspace or shell becomes visible and pause inactive shells.
