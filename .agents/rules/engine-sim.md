---
trigger: glob
globs: src/core/sim/**, src/core/audio/**, src/core/runtime/**, src/game/**
description: Fixed-timestep simulation, SoA entity pools, audio/haptic primitives, and verification rules.
---
# Engine & Simulation Rules
- **Fixed Timestep**: Keep gameplay/physics simulation deterministic at `dt = 1/60s` with render interpolation for 60Hz/120Hz displays.
- **SoA Entity Pools**: Prefer fixed-size TypedArray pools (`MAX_ENTITIES`) over OOP class instantiation per entity in hot paths.
- **Sensory Primitives**: Keep Web Audio synthesizer strictly zero-dependency and scale-locked (pentatonic-safe by default) so user/AI edits stay melodic.
- **Verification**: Always run `npm run lint && npm run sim` after touching simulation, runtime, audio, or cartridge files.
