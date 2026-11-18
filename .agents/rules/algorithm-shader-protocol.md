---
trigger: glob
globs: src/core/**, src/assets/**, src/game/**, scripts/sim/**
description: Rigorous math invariants, anti-cheat differential testing, and zero-GC hardware algorithm rules.
---
# Core Algorithm & Shader Engineering Protocol

1. **Plan Before Coding (Structural First)**:
   - For non-trivial math, physics, spatial, or shader algorithms, propose 2 candidate structural approaches (Big-O time/space, cache locality, branchlessness) BEFORE writing implementation code.
2. **Brute-Force Reference Oracle + Differential Testing**:
   - Never rely solely on hand-picked unit tests. First write a simple, obviously-correct reference oracle (e.g., O(N^2) collision or exact analytical baseline) and verify the optimized implementation matches it across randomized multi-scale inputs (small, medium, 2000+ stress scale).
3. **Anti-Degeneracy & Numerical Invariants**:
   - Explicitly assert non-degenerate outputs (non-zero active movements/collisions, no skipped work), zero `NaN`/`Infinity`, bounded energy/amplitude, and deterministic results under fixed `dt = 1/60s` + seeded PRNG.
4. **Hardware & Mobile Compatibility Constraints**:
   - Zero per-frame heap allocations (TypedArray/SoA pools only).
   - Keep GPU instancing in Vertex Buffers (`stepMode: 'instance'`, NO vertex-stage storage buffers for Android Compatibility Mode safety); eliminate hot-loop branch divergence (`select()` / bitmasks).
5. **Bottleneck-Driven Optimization**:
   - Report measured micro-benchmark timings (`ms`) and allocation delta in `npm run sim`; diagnose the exact bottleneck (GC churn, complexity, or cache/branch stall) before iterating.
