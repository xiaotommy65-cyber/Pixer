---
trigger: glob
globs: "src/ui/**, src/main.ts, src/AppShellHelpers.ts, src/styles/**"
description: Single workstation, EngineHost facade, AbortController lifecycle, and lazy GPU UI rules.
---
# UI Workstation & Handheld Shell Rules
- **Sole Engine Facade**: `src/ui/` modules MUST interact with gameplay runtimes ONLY through `EngineHost` — NEVER access `.runner` directly (enforced by `ArchitectureTests.ts`).
- **Lifecycle & Teardown**: Every UI view/panel/overlay must manage DOM listeners via `AbortController` (`this.ac.abort()`) and expose `public destroy(): void`.
- **Single Authoring Shell**: Keep ONE workstation (`EcsWorkbenchView` + `SpriteAtelierView` modal). Never reintroduce duplicate legacy editors (`WorkshopView`, `StudioWorkbenchView`).
- **Lazy GPU Lifecycle**: Initialize `GpuEngine` contexts strictly on demand (`ensureArcadeGpuInit` / `ensurePreviewGpuInit`) and pause inactive shells.
- **Security**: Never use `eval()` or `new Function()`.
