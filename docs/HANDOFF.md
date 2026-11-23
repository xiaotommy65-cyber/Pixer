# Pixer — 工程交接書（Engineering Handoff · Phase 0 → Phase 3c Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md) 與本交接書，即可直接定位所有檔案與堆疊分支狀態，無須進行全倉 grep。

---

## 1. 目前 Git 分支與 Stacked PR 狀態（全部已通過 CI 級驗證並推上遠端）

目前 **PR #1 → #7 採 Stacked PR 鏈**（均為 `OPEN`，尚未合入 `main`；待依序 Review & Merge #1 → #7 後再切回 `main`，或繼續從 `refactor/phase3c-core-foundation-cleanup` 往下堆疊）：

| PR | 分支 | Base | 核心交付內容 |
|---|---|---|---|
| **PR #1** | `refactor/phase0-audio-diet-and-hardening` | `main` | 退役 `PA-13` 4K 與 `Stage3DPipeline`、砍除 AI 合成音訊改用外部資產 [`ExternalAudioBank.ts`](../src/core/audio/ExternalAudioBank.ts)、精簡卡匣至 `PA-14/15/01/02/11/12`、MCP UTF-8 與 zip/zlib 防爆 |
| **PR #2** | `feat/phase1-modular-workbench-m2-and-worker` | PR #1 | 完成 M2 世界規則檢視器 [`EcsWorldRulesInspectorPanel.ts`](../src/ui/EcsWorldRulesInspectorPanel.ts)、圖集/預製體子面板、背景 [`interop.worker.ts`](../src/workers/interop.worker.ts) |
| **PR #3** | `feat/phase2-cloud-offload-r2-supabase` | PR #2 | 雲端疏導層：[`supabase/migrations/20261122000000_pixer_cloud_schema.sql`](../supabase/migrations/20261122000000_pixer_cloud_schema.sql)、[`workers/api/`](../workers/api/src/index.ts)、[`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts)、`?play=<slug>` 啟動與 [`CloudOffload.test.ts`](../scripts/sim/CloudOffload.test.ts) |
| **PR #4** | `chore/phase2b-nav-map-and-hardening` | PR #3 | 建立零搜索 [`CODEBASE_MAP.md`](CODEBASE_MAP.md)、Edge API Auth/ETag 安全強化、開啟 PR CI、修補靜態 `.innerHTML`、刪除 989L 死 CSS |
| **PR #5** | `refactor/phase3a-handheld-console-refinement` | PR #4 | 掌機殼無視覺回歸重構：抽離 [`ConsoleSpatialController.ts`](../src/ui/ConsoleSpatialController.ts)（修補 Router 初始化順序與 RAF 洩漏）並拆解 [`WindowDioramaView.ts`](../src/ui/WindowDioramaView.ts) → `DioramaPalette` + `DioramaSceneRenderer` |
| **PR #6** | `refactor/phase3b-ecs-workbench-modularization` | PR #5 | 工作站黃金標準拆分：[`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts) **3,234L → 868L（-73.2%）**，拆為 7 個單一職責模組並修復階層搜尋重複 DOM/焦點丟失 Bug |
| **PR #7** | `refactor/phase3c-core-foundation-cleanup` *(目前 checkout 分支)* | PR #6 | 測試檔 [`EcsCore.test.ts`](../scripts/sim/EcsCore.test.ts) 移出 `src/` 並於 [`ArchitectureTests.ts`](../scripts/sim/ArchitectureTests.ts) 加入禁令守門；抽離 Zero-GC [`EcsSnapshotProjector.ts`](../src/core/ecs/EcsSnapshotProjector.ts)（`EcsCartridgeRuntime` **1,812L → 1,122L**）；抽離 [`SpriteAtelierPixelOps.ts`](../src/ui/SpriteAtelierPixelOps.ts)（`SpriteAtelierView` **1,729L → 1,313L**） |

---

## 2. 專案健康指標與驗證基準（截至 Phase 3c）

- **驗證指令**：`npm run lint && npm run sim && npm run test && npm run build`
  - `npm run lint`（`tsc --noEmit`）：0 errors
  - `npm run sim`：PASS（含純核心無 DOM、`EngineHost` Facade、Zero-GC 物件池、禁 AI 合成、`src/` 零測試檔守門）
  - `npm run test`：**53/53 PASS**（含 [`WorldMap.test.ts`](../scripts/sim/WorldMap.test.ts) Purity Gate 覆蓋 `EcsSnapshotProjector.ts`）
  - `npm run build`：PASS（~1.59s，0 chunk warnings，`ecs-workbench` gzip 140.68 kB）
- **不可動搖鐵則**：
  1. 不得將測試檔放回 `src/`，不得在 `src/core/{ecs,ai,interop,cloud,math,runtime}/` 使用 DOM 或遊戲專屬硬編碼。
  2. 保持單一工作站（`EcsWorkbenchView` + `SpriteAtelierView`）與唯一 UI Facade（`EngineHost`，禁止直連 `.runner`）。
  3. 不可回引 AI 合成振盪器或並行 Canvas2D Shadow Renderer。
  4. 提交前務必 `npm run clean`（清除 `dist/`），且禁止直接推 `main`。

---

## 3. 剩餘可優先推進的工程標的（供新對話選擇起手式）

### 路線 A｜繼續基層整理（建議優先序）
1. **Phase 3d — 渲染橋接拆分**：[`SceneGpuBridge.ts`](../src/core/runtime/SceneGpuBridge.ts)（1,491L）可將 `renderFirstPersonPerspective` 與 `renderTrue3DScene` 抽離成純 2.5D/3D 投影 Pass 模組，與 2D/HD-2D 深度排序主循環解耦；後續可再檢視 [`GpuEngine.ts`](../src/core/gpu/GpuEngine.ts)（1,638L）。
2. **舊 `WorldKernel` 遺產群組清理（約 -3,240 LOC）**：`src/core/sim/` 內尚有 10 支僅由舊測試（`ArchitectureTests` 基準測試、`CoreSubsystemTests`、`ExtensibilityAiTests`）引用的 `WorldKernel*` 檔案；可評估保留 `GridPathfinder.ts` 並退役其餘死碼，或一併整併 [`DataCartridgeRuntime.ts`](../src/core/sim/DataCartridgeRuntime.ts)（3,164L）。
3. **其餘 >1,000L 檔案檢視**：[`EcsSpatialOracle.ts`](../src/core/ai/EcsSpatialOracle.ts)（1,291L）、[`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts)（1,235L）、[`EcsStudioSession.ts`](../src/core/ecs/EcsStudioSession.ts)（1,205L）、[`EventGraphEditorView.ts`](../src/ui/EventGraphEditorView.ts)（1,147L）。

### 路線 B｜切入雲端上線與發佈功能（Phase 3 Production Provisioning）
1. **工作站一鍵發佈 UI**：於 [`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts)／[`EcsWorkbenchShellBuilder.ts`](../src/ui/EcsWorkbenchShellBuilder.ts) 頂欄對接 [`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts)，提供可選登入與「發佈並複製 `?play=<slug>` 分享連結」。
2. **實際基礎設施部署**（步驟詳見 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md)）：
   - Supabase：執行 `supabase/migrations/20261122000000_pixer_cloud_schema.sql` 並取得 URL / Anon Key / Service Role Key。
   - Cloudflare R2 + Workers：`wrangler r2 bucket create pixer-assets` → 設定 secrets → 於 `workers/api/` 執行 `wrangler deploy`。
   - 前端環境變數：設定 `VITE_CLOUD_API_BASE`（與可選 `VITE_CDN_BASE_URL`）。
