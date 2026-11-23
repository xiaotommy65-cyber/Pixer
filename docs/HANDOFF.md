# Pixer — 工程交接書（Engineering Handoff · Phase 0 → Phase 4 Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md) 與本交接書，即可直接定位所有檔案與分支狀態，無須進行全倉 grep。

---

## 1. 目前 Git 分支與交付進度

- **PR #1 → #9 已全數合入 `main`**（`09fbbe3`）：
  - 完成音訊/舊卡匣瘦身（`ExternalAudioBank`、聚焦 6 卡匣 `PA-14/15/01/02/11/12`）、M2 世界規則檢視器、Web Worker 外部匯入、Cloudflare R2 + Supabase 雲端疏導層、零搜索 `CODEBASE_MAP.md`、掌機殼與 `EcsWorkbenchView`（3,234L → 868L）模組化、`EcsSnapshotProjector` / `SpriteAtelierPixelOps` 抽離、`SceneGpuBridge` / `GpuEngine` 3D Pass 拆分、退役 9 支 `WorldKernel*` 死碼（-2,678 LOC）、`DataCartridgeRuntime.ts` 拆解為 `DataCartridgeRuntime.ts` + `DataRuntimePlatformer.ts` + `DataRuntimeSnapshot.ts`，以及工具鏈 `bun-version: '1.4.5'` 對齊。
- **Phase 4 分支 `feat/phase4-arsenal-restoration-and-ecs-wiring`（PR #10）**：
  1. **全品類子引擎軍火庫恢復（保留 `DataCartridgeRuntime` 三檔清晰模組化架構）**：
     - 完整恢復 [`CardDeckEngine.ts`](../src/core/sim/CardDeckEngine.ts)（975L，Roguelike 卡牌構建子引擎）與 [`FighterFrameEngine.ts`](../src/core/sim/FighterFrameEngine.ts)（790L，60fps 幀數表 2D 格鬥子引擎），並恢復 [`GenreControllers.ts`](../src/core/sim/GenreControllers.ts)、[`CartridgeSchema.ts`](../src/core/sim/CartridgeSchema.ts)、[`StudioCommands.ts`](../src/core/editor/StudioCommands.ts) 與 [`StudioPlaytestDiag.ts`](../src/core/editor/StudioPlaytestDiag.ts) 中的 `fighter_arena` / `card_roguelike` / `puzzle_grid` 支援。
     - 對接已模組化的 [`DataCartridgeRuntime.ts`](../src/core/sim/DataCartridgeRuntime.ts)（1,452L）與 [`DataRuntimeSnapshot.ts`](../src/core/sim/DataRuntimeSnapshot.ts)（998L），兼顧單檔可維護性與全品類開發武器庫。
  2. **真 ECS 運行時軍火庫 100% 接線（消滅備用閒置代碼）**：
     - 將 [`GridPathfinder.ts`](../src/core/sim/GridPathfinder.ts)（Zero-GC Binary Min-Heap A* `findAStarNextCell` / `findAStarPathInto`）與 [`Visibility2D.ts`](../src/core/math/Visibility2D.ts)（精確有理數對稱視線 `hasGridLineOfSight` & 對稱陰影投射 `computeSymmetricFovInto`）正式接入 [`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts)：當怪物直視英雄被牆壁遮擋或直線移動受阻時，自動以 Zero-GC A* 繞牆追蹤，並公開 `hasRoomLineOfSight`、`findRoomPathCells`、`computeRoomFovMask`。
     - 將 [`CameraRigDirector.ts`](../src/core/runtime/CameraRigDirector.ts)（6DoF 3D 運鏡導演）與 [`GameFlowController.ts`](../src/core/runtime/GameFlowController.ts)（6 幕狀態機）正式接入 [`EcsCartridgeRuntime.ts`](../src/core/ecs/EcsCartridgeRuntime.ts)（`runtime.cameraRig` & `runtime.gameFlow`），於每幀步進並在 Boss 二階段、受擊、擊殺與勝負結算時自動觸發鏡頭運鏡與狀態切換。

---

## 2. 專案健康指標與驗證基準（截至 Phase 4）

- **驗證指令**：`npm run lint && npm run sim && npm run test && npm run build`
  - `npm run lint`（`tsc --noEmit`）：0 errors
  - `npm run sim`：PASS（含純核心無 DOM、`EngineHost` Facade、Zero-GC 物件池、禁 AI 合成、`src/` 零測試檔守門）
  - `npm run test`：**57/57 PASS**（含 `CardDeckEngine`/`FighterFrameEngine` 確定性測試與真 ECS A* 繞牆尋路 + `CameraRigDirector`/`GameFlowController` 整合測試）
  - `npm run build`：PASS（0 chunk warnings）
- **不可動搖鐵則**：
  1. 不得將測試檔放回 `src/`，不得在 `src/core/{ecs,ai,interop,cloud,math,runtime}/` 使用 DOM 或遊戲專屬硬編碼。
  2. 保持單一工作站（`EcsWorkbenchView` + `SpriteAtelierView`）與唯一 UI Facade（`EngineHost`，禁止直連 `.runner`）。
  3. 不可回引 AI 合成振盪器或並行 Canvas2D Shadow Renderer。
  4. 提交前務必 `npm run clean`（清除 `dist/`），且禁止直接推 `main`。

---

## 3. 剩餘可優先推進的工程標的（供新對話選擇起手式）

### 路線 A｜切入雲端上線與發佈功能（Phase 3 Production Provisioning）
1. **工作站一鍵發佈 UI**：於 [`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts)／[`EcsWorkbenchShellBuilder.ts`](../src/ui/EcsWorkbenchShellBuilder.ts) 頂欄對接 [`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts)，提供可選登入與「發佈並複製 `?play=<slug>` 分享連結」。
2. **實際基礎設施部署**（步驟詳見 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md)）：
   - Supabase：執行 `supabase/migrations/20261122000000_pixer_cloud_schema.sql` 並取得 URL / Anon Key / Service Role Key。
   - Cloudflare R2 + Workers：`wrangler r2 bucket create pixer-assets` → 設定 secrets → 於 `workers/api/` 執行 `wrangler deploy`。
   - 前端環境變數：設定 `VITE_CLOUD_API_BASE`（與可選 `VITE_CDN_BASE_URL`）。

### 路線 B｜在真 ECS 工作站開放更多軍火庫能力
1. 於 [`EcsWorldRulesInspectorPanel.ts`](../src/ui/EcsWorldRulesInspectorPanel.ts) 或 [`EcsWorkbenchSceneInspector.ts`](../src/ui/EcsWorkbenchSceneInspector.ts) 開放 `CameraRigDirector` 鏡頭預設（Shot Presets）與 `computeRoomFovMask` 戰爭迷霧／視野預覽開關。

