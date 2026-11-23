---
name: pixer-verify-and-pr
description: Sets up the local Bun 1.4.5 environment, runs Pixer's full verification gate (lint, sim, test, build), and enforces PR and repo hygiene before committing or pushing.
---

# Pixer Local Verification & PR Hygiene

Follow this checklist whenever verifying changes or preparing a pull request in Pixer.

## 1. Local Toolchain & Dependency Setup
- Pixer pins `bun.lock` (`lockfileVersion: 2`), which requires **Bun >= 1.4.0** (CI pins `1.4.5`) and **Node.js >= 22**.
- Install dependencies cleanly without generating `package-lock.json`:
  ```bash
  bun install --frozen-lockfile
  ```
- Never commit `package-lock.json` (`ArchitectureTests.ts` enforces single lockfile on `bun.lock`).

## 2. Full Verification Gate
Run in order from the repository root:
```bash
bun run lint
bun run sim
npm run test
bun run build
bun run clean
```
- `lint`: TypeScript strict check (`tsc --noEmit`) across `src/`, `scripts/`, and `workers/`.
- `sim`: Headless simulation + `ArchitectureTests.ts` boundary, Zero-GC, DOM-free core, and security checks.
- `test`: Full `node --experimental-strip-types --test` suite in `scripts/sim/`.
- `build` & `clean`: Verifies Vite production bundle + chunking and removes `dist/` before commit.

## 3. Git & Documentation Hygiene
- Always work on a topic branch and open a PR; never push directly to `main`.
- Keep `AGENTS.md` <= 120 lines.
- If a phase or milestone ships, update `docs/HANDOFF.md`, `docs/ROADMAP.md`, and `docs/NEXT_CHAT_PROMPT.md` (plus `docs/CODEBASE_MAP.md` if modules moved).
