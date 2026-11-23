# Pixer — 工程交接書（Engineering Handoff · Phase 0 → Phase 3d Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md) 與本交接書，即可直接定位所有檔案與分支狀態，無須進行全倉 grep。

---

## 1. 目前 Git 分支與交付進度

- **PR #1 → #7 已全數合入 `main`**（`9d6d9d6`）。
- **Phase 3d 分支 `refactor/phase3d-scene-bridge-and-gpu-cleanup`**（從最新 `main` 開出，已建立 PR #8）：
  - [`SceneGpuBridge.ts`](../src/core/runtime/SceneGpuBridge.ts)（**1,492L → 887L**）：抽離 Zero-GC [`SceneFirstPersonPass.ts`](../src/core/runtime/SceneFirstPersonPass.ts)（243L）、[`SceneTrue3DPass.ts`](../src/core/runtime/SceneTrue3DPass.ts)（320L）、[`SceneOrthogonalHelper.ts`](../src/core/runtime/SceneOrthogonalHelper.ts)（64L）與 [`SceneHudOverlayPass.ts`](../src/core/runtime/SceneHudOverlayPass.ts)（113L）。
  - [`GpuEngine.ts`](../src/core/gpu/GpuEngine.ts)（**1,639L → 1,117L**）：抽離 Zero-GC [`GpuQuad3DBatch.ts`](../src/core/gpu/GpuQuad3DBatch.ts)（737L）與 [`GpuColorCache.ts`](../src/core/gpu/GpuColorCache.ts)（49L），並強化 Hex 解析、NaN 光源/相機/粒子防護與 Edge API/雲端同步邊界（UTF-8 位元組上限、弱 ETag、SRAM 未來時鐘偏移夾緊、非 JSON 502 容錯）。
  - **退役 9 支 `WorldKernel` 遺產死碼（-2,678 LOC，保留 `GridPathfinder.ts`）**：移除 `WorldKernel.ts`、`WorldEntitiesStep.ts`、`WorldHeroPhysics.ts`、`WorldInternalTypes.ts`、`WorldSnapshot.ts`、`Archetypes.ts`、`RuleMatrix.ts`、`CameraDirector.ts`、`CutsceneSequencer.ts`，並將 240 幀 Zero-GC 基準測試升級為 `EcsCartridgeRuntime`（PA-14）+ `DataCartridgeRuntime`。

---

## 2. 專案健康指標與驗證基準（截至 Phase 3d）

- **驗證指令**：`npm run lint && npm run sim && npm run test && npm run build`
  - `npm run lint`（`tsc --noEmit`）：0 errors
  - `npm run sim`：PASS（含純核心無 DOM、`EngineHost` Facade、Zero-GC 物件池、禁 AI 合成、`src/` 零測試檔守門）
  - `npm run test`：**55/55 PASS**（含 [`WorldMap.test.ts`](../scripts/sim/WorldMap.test.ts) Purity Gate、[`DualPerspective3D.test.ts`](../scripts/sim/DualPerspective3D.test.ts) 與 [`CloudOffload.test.ts`](../scripts/sim/CloudOffload.test.ts) 邊界測試）
  - `npm run build`：PASS（0 chunk warnings）
- **不可動搖鐵則**：
  1. 不得將測試檔放回 `src/`，不得在 `src/core/{ecs,ai,interop,cloud,math,runtime}/` 使用 DOM 或遊戲專屬硬編碼。
  2. 保持單一工作站（`EcsWorkbenchView` + `SpriteAtelierView`）與唯一 UI Facade（`EngineHost`，禁止直連 `.runner`）。
  3. 不可回引 AI 合成振盪器或並行 Canvas2D Shadow Renderer。
  4. 提交前務必 `npm run clean`（清除 `dist/`），且禁止直接推 `main`。

---

## 3. 剩餘可優先推進的工程標的（供新對話選擇起手式）

### 路線 A｜繼續基層整理（建議優先序）
1. **其餘 >1,000L 檔案檢視**：[`DataCartridgeRuntime.ts`](../src/core/sim/DataCartridgeRuntime.ts)（3,165L）、[`EcsSpatialOracle.ts`](../src/core/ai/EcsSpatialOracle.ts)（1,291L）、[`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts)（1,235L）、[`EcsStudioSession.ts`](../src/core/ecs/EcsStudioSession.ts)（1,205L）、[`EventGraphEditorView.ts`](../src/ui/EventGraphEditorView.ts)（1,147L）。

### 路線 B｜切入雲端上線與發佈功能（Phase 3 Production Provisioning）
1. **工作站一鍵發佈 UI**：於 [`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts)／[`EcsWorkbenchShellBuilder.ts`](../src/ui/EcsWorkbenchShellBuilder.ts) 頂欄對接 [`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts)，提供可選登入與「發佈並複製 `?play=<slug>` 分享連結」。
2. **實際基礎設施部署**（步驟詳見 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md)）：
   - Supabase：執行 `supabase/migrations/20261122000000_pixer_cloud_schema.sql` 並取得 URL / Anon Key / Service Role Key。
   - Cloudflare R2 + Workers：`wrangler r2 bucket create pixer-assets` → 設定 secrets → 於 `workers/api/` 執行 `wrangler deploy`。
   - 前端環境變數：設定 `VITE_CLOUD_API_BASE`（與可選 `VITE_CDN_BASE_URL`）。
