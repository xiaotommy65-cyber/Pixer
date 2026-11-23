---
name: pixer-ecs-authoring
description: Authors data-driven ECS levels, prefabs, custom sprites, world rules, and Phase 5 cutscenes via transactional EcsStudioSession commands and Pixer MCP tools without violating pure-core boundaries.
---

# Pixer Data-Driven ECS & Cinematic Authoring

Use this workflow when adding engine capabilities, authoring rooms/entities, or composing cutscenes.

## 1. Read Routing Docs First
- Check `AGENTS.md` and `docs/CODEBASE_MAP.md` (Section 2 task-to-file table) before grepping.

## 2. Author via Transactional Commands & MCP
- Every new ECS capability MUST be expressible via `EcsStudioCommand` (`src/core/ecs/EcsStudioSession.ts`) with full Undo/Redo parity and exposed through `PixerMcpProtocol.ts` / `AgentBridge.ts`.
- Keep `src/core/ecs/` and `src/ui/` 100% free of game-specific hardcoding (`PA-14`, `PA-15`, etc.).
- When the `pixer-ecs` MCP server (`.agents/mcp_config.json`) is connected locally:
  1. Inspect scene/world state with `get_scene_semantics`, `get_room_ascii`, and `describe_editor_grammar`.
  2. Mutate via `dispatch_ecs_command` or atomic `dispatch_ecs_batch`.
  3. Validate layout and gameplay with `analyze_world_map`, `analyze_reachability`, and `run_scripted_playtest`.
  4. For cutscenes (`upsert_cutscene`), audit framing, wall occlusion, 180-deg axis, and 3-phase spring return with `critique_cutscene_aesthetics`.

## 3. Respect Layer Boundaries
- Keep `src/core/{ai,cloud,ecs,editor,hal,input,interop,math,runtime,sim,types}/`, `src/assets/`, and `src/game/` 100% DOM-free.
- Place unit tests in `scripts/sim/*.test.ts` (never inside `src/`).
