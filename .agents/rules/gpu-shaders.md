---
trigger: glob
globs: src/core/gpu/**, src/core/runtime/SceneGpuBridge.ts, **/*.wgsl, **/*.glsl
description: WebGPU and WebGL2 dual-backend rendering, palette LUT, and zero-GC GPU rules.
---
# GPU & Shader Rules
- **Strict Parity**: Maintain identical output across `WGSL` (WebGPU) and `GLSL ES 3.00` (WebGL2), with graceful `Canvas2DBackend` fallback.
- **Zero-GC Buffers**: Pre-allocate and reuse vertex/instance `Float32Array` buffers; never allocate typed arrays per frame.
- **Crisp Pixel Art**: Enforce nearest/sharp pixel scaling without unintended bilinear blur.
- **Palette & Emissive Convention (M1+)**: Index `0` = transparent, `1..13` = standard palette colors, `14..15` = emissive candidates for bloom/glow pass.
