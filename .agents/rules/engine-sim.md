---
trigger: glob
globs: src/core/sim/**, src/core/audio/**, src/core/runtime/**, src/game/**
description: Fixed-timestep simulation, SoA entity pools, audio/haptic primitives, and verification rules.
---
# Engine & Simulation Rules
- **Fixed Timestep**: Keep gameplay/physics simulation deterministic at `dt = 1/60s` with render interpolation for 60Hz/120Hz displays.
- **SoA Entity Pools**: Prefer fixed-size TypedArray pools (`MAX_ENTITIES`) over OOP class instantiation per entity in hot paths.
- **External-Asset Audio Only**: Use `ExternalAudioBank` (CDN `.opus`/`.mp3` manifest playback + bounded LRU `AudioBuffer` cache + silent fallback). NEVER introduce procedural Web Audio oscillators or synths (`createOscillator`).
- **Verification**: Always run `npm run lint && npm run sim && npm run test` after touching simulation, runtime, audio, or cartridge files.
