# Pixer — 新對話開局速讀詞（Phase 5 Complete · 本機 Antigravity IDE / App 接手版）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎原教旨憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由與依賴圖）、[`docs/ROADMAP.md`](ROADMAP.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，避免耗費大量探索時間。

## 當前已驗收基線（Phase 0 → Phase 5 Complete）
- **HD-2D Pixel PBR-Lite 引擎與外部音訊層**：`WebGPU` / `WebGL2` / `Canvas2DBackend`、`1280×720`、8 頁 `1024×1024` 圖集池、完全移除 AI 程序合成器並以 [`ExternalAudioBank.ts`](../src/core/audio/ExternalAudioBank.ts) 外部 `.opus`/`.mp3` 資源層取代；保留旗艦卡匣 `PA-14`、`PA-15`、`PA-01`、`PA-02`、`PA-11`、`PA-12`。
- **真 ECS 運行時與全品類軍火庫**：[`EcsCartridgeRuntime.ts`](../src/core/ecs/EcsCartridgeRuntime.ts) + [`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts) 已接通 Zero-GC `GridPathfinder` A*、`Visibility2D` LOS/FOV、`CameraRigDirector`、`GameFlowController` 與 [`EcsCinematicDirector.ts`](../src/core/ecs/EcsCinematicDirector.ts)（Auteur DSL + Toric Two-Shot + 3 階段彈簧切回），並附無頭審美預言機 [`EcsCinematicOracle.ts`](../src/core/ai/EcsCinematicOracle.ts) 與完整 MCP（`critique_cutscene_aesthetics`）。
- **單一模組化工作站與雲端疏導層**：[`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts)（868L 協調層）+ M2 規則檢視器 + [`src/workers/interop.worker.ts`](../src/workers/interop.worker.ts) + Cloudflare Workers/R2 + Supabase RLS（[`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts)）。
- **本機 Antigravity 整備**：已配置 `.agents/mcp_config.json`（`pixer-ecs` 預設啟用，另附 `context7` / `chrome-devtools` 範本）、`.agents/rules/`（5 份）與 `.agents/skills/`（`pixer-verify-and-pr`、`pixer-ecs-authoring`）。

## 本機開工快速檢查
1. 確認本機工具鏈：`bun --version` >= `1.4.5`、`node -v` >= `22`；執行 `bun install --frozen-lockfile`。
2. 驗證基線：`bun run lint && bun run sim && npm run test && bun run build && bun run clean`。
3. 如需從手機／網頁遠端操控本機完整環境（含 GPU 與 MCP），可使用 Antigravity **Remote Control**（`agy remote-control start`）。

## 下階段建議任務（Phase 6）
1. **工作站 UI 開放 Phase 4/5 能力 & 實機 GPU 驗收**：在 `EcsWorkbenchView` 檢視器開放分鏡編輯／試映（`critiqueCutsceneAesthetics`）、`CameraRigDirector` 鏡頭預設與 `computeRoomFovMask` 視野預覽；為 `PA-14` / `PA-15` 編排首支過場演出並以本機瀏覽器 / `chrome-devtools` MCP 實測 WebGPU/WebGL2。
2. **工作站雲端發佈 UI 與正式環境佈建**：在 `EcsWorkbenchView` 串接 `CloudSyncClient` 提供「登入與一鍵發佈複製 `?play=<slug>`」，並依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Supabase、Cloudflare R2 (`pixer-assets`) 與 Workers。
