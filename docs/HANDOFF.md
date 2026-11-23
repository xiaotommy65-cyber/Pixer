# Pixer — 工程交接書（Engineering Handoff · Phase 0 → Phase 5 Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md) 與本交接書，即可直接定位所有檔案與分支狀態，無須進行全倉 grep。

---

## 1. 目前 Git 分支與交付進度

- **PR #1 → #11 已全數合入 `main`**（最新基線 `e52342b` + 本機工作流整備）：
  - **Phase 0–3（PR #1–#9）**：音訊/舊卡匣瘦身（[`ExternalAudioBank`](../src/core/audio/ExternalAudioBank.ts)、聚焦 6 卡匣 `PA-14/15/01/02/11/12`）、M2 世界規則檢視器、Web Worker 外部匯入、Cloudflare R2 + Supabase 雲端疏導層、零搜索 `CODEBASE_MAP.md`、掌機殼與 `EcsWorkbenchView`（3,234L → 868L）模組化、`EcsSnapshotProjector` / `SpriteAtelierPixelOps` 抽離、`SceneGpuBridge` / `GpuEngine` 3D Pass 拆分、退役 9 支 `WorldKernel*` 死碼（-2,678 LOC）、`DataCartridgeRuntime.ts` 三檔拆解，以及 CI/Bun `1.4.5` 對齊。
  - **Phase 4（PR #10，`03ecac8`）**：
    - 恢復 [`CardDeckEngine.ts`](../src/core/sim/CardDeckEngine.ts)（975L）、[`FighterFrameEngine.ts`](../src/core/sim/FighterFrameEngine.ts)（790L）與 [`GenreControllers.ts`](../src/core/sim/GenreControllers.ts) 全品類子引擎。
    - 將 [`GridPathfinder.ts`](../src/core/sim/GridPathfinder.ts)（Zero-GC A*）與 [`Visibility2D.ts`](../src/core/math/Visibility2D.ts)（LOS/FOV）接入 [`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts)，並將 [`CameraRigDirector.ts`](../src/core/runtime/CameraRigDirector.ts) 與 [`GameFlowController.ts`](../src/core/runtime/GameFlowController.ts) 接入 [`EcsCartridgeRuntime.ts`](../src/core/ecs/EcsCartridgeRuntime.ts)。
  - **Phase 5（PR #11，`e52342b`）**：
    - 交付電影級導演系統 [`EcsCinematicDirector.ts`](../src/core/ecs/EcsCinematicDirector.ts)（1,001L：Auteur 14 欄 Actor-Relative 分鏡 DSL、Toric 雙人構圖求解器、3 階段臨界阻尼彈簧實切回、21:9 Letterbox 與字幕/Banner HUD）。
    - 交付零 VLM 無頭審美預言機 [`EcsCinematicOracle.ts`](../src/core/ai/EcsCinematicOracle.ts)（456L：60Hz 無頭偵察 + 5 軸攝影審美評分 + ASCII 觀景窗分鏡表），對接 `upsert_cutscene` 交易指令與 MCP `critique_cutscene_aesthetics`（已補入 [`PIXER_MCP_TOOLS`](../src/core/ai/PixerMcpProtocol.ts) 供 `tools/list` 探索）。
  - **工作流與本機 Antigravity 整備**：
    - 修正 [`.agents/rules/engine-sim.md`](../.agents/rules/engine-sim.md) 舊音訊規範，補齊 [`.agents/rules/ui-workstation.md`](../.agents/rules/ui-workstation.md) 與 [`.agents/rules/cloud-edge.md`](../.agents/rules/cloud-edge.md)。
    - 新增 [`.agents/mcp_config.json`](../.agents/mcp_config.json)（開箱連接 `pixer-ecs` stdio MCP，預配可一鍵啟用的 `context7` / `chrome-devtools`）與 [`.agents/skills/`](../.agents/skills)（`pixer-verify-and-pr`、`pixer-ecs-authoring`），並移除未安裝的幽靈 `skills-lock.json`。

---

## 2. 專案健康指標與驗證基準

- **本機驗證指令**（需 Bun >= 1.4.0，CI 鎖定 `1.4.5`；先執行 `bun install --frozen-lockfile`）：
  - `npm run lint`（`tsc --noEmit`）：0 errors
  - `npm run sim`：PASS（含純核心無 DOM、`EngineHost` Facade、Zero-GC 物件池、禁 AI 合成、`src/` 零測試檔守門）
  - `npm run test`：**58+ PASS**（含 Phase 4 A*/FOV/CameraRig/GameFlow 與 Phase 5 `EcsCinematicDirector`/`EcsCinematicOracle` + `tools/list` 測試）
  - `npm run build`：PASS（0 chunk warnings）
- **不可動搖鐵則**：
  1. 不得將測試檔放回 `src/`，不得在 `src/core/{ai,cloud,ecs,editor,hal,input,interop,math,runtime,sim,types}/` 使用 DOM 或遊戲專屬硬編碼。
  2. 保持單一工作站（`EcsWorkbenchView` + `SpriteAtelierView`）與唯一 UI Facade（`EngineHost`，禁止直連 `.runner`）。
  3. 不可回引 AI 合成振盪器或並行 Canvas2D Shadow Renderer。
  4. 提交前務必 `npm run clean`（清除 `dist/`），且禁止直接推 `main`。

---

## 3. 建議推進路線（供本機 Antigravity IDE / App 接手）

### 路線 A｜將 Phase 4 / Phase 5 能力接入工作站 UI 與旗艦卡匣
1. 於 [`EcsWorldRulesInspectorPanel.ts`](../src/ui/EcsWorldRulesInspectorPanel.ts) 或 [`EcsWorkbenchSceneInspector.ts`](../src/ui/EcsWorkbenchSceneInspector.ts) 開放 **Cutscenes 分鏡編排／一鍵試映 & `critiqueCutsceneAesthetics` 報告面板**、`CameraRigDirector` 鏡頭預設與 `computeRoomFovMask` 視野預覽開關。
2. 為 `PA-14`（[`ObsidianCitadelProject.ts`](../src/game/obsidianCitadel/ObsidianCitadelProject.ts)）與 `PA-15` 編排首支進房／Boss 覺醒電影級過場演出，並在本機啟用 `chrome-devtools` MCP 實測 WebGPU/WebGL2 畫面。

### 路線 B｜切入雲端上線與發佈功能（Cloud Production Provisioning）
1. **工作站一鍵發佈 UI**：於 [`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts)／[`EcsWorkbenchShellBuilder.ts`](../src/ui/EcsWorkbenchShellBuilder.ts) 頂欄對接 [`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts)，提供可選登入與「發佈並複製 `?play=<slug>` 分享連結」。
2. **實際基礎設施部署**（步驟詳見 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md)）：Supabase Migration + Cloudflare R2 (`pixer-assets`) + `workers/api` (`wrangler deploy`) + `VITE_CLOUD_API_BASE` 環境變數。


