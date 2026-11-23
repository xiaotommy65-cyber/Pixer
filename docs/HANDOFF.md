# Pixer — 工程交接書（Engineering Handoff · Phase 0 → Phase 3e Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md) 與本交接書，即可直接定位所有檔案與分支狀態，無須進行全倉 grep。

---

## 1. 目前 Git 分支與交付進度

- **PR #1 → #8 已全數合入 `main`**（`3a6152e`）：
  - 完成音訊/舊卡匣瘦身（`ExternalAudioBank`、聚焦 6 卡匣 `PA-14/15/01/02/11/12`）、M2 世界規則檢視器、Web Worker 外部匯入、Cloudflare R2 + Supabase 雲端疏導層、零搜索 `CODEBASE_MAP.md`、掌機殼與 `EcsWorkbenchView`（3,234L → 868L）模組化、`EcsSnapshotProjector` / `SpriteAtelierPixelOps` 抽離、`SceneGpuBridge` / `GpuEngine` 3D Pass 拆分，以及退役 9 支 `WorldKernel*` 死碼（-2,678 LOC）。
- **Phase 3e 分支 `refactor/phase3e-data-runtime-diet-and-toolchain`**（從最新 `main` 開出）：
  - **`DataCartridgeRuntime.ts` 黃金標準拆解（3,164L → 1,283L，-59.4%）**：
    - 抽離 [`DataRuntimePlatformer.ts`](../src/core/sim/DataRuntimePlatformer.ts)（1,026L）：平台跳躍、跑酷波浪衝刺、360° 飛鉤擺盪／拉扯物理、實體行為步進、SpatialHash 碰撞互動與 1P/3P 雙視角步進。
    - 抽離 [`DataRuntimeSnapshot.ts`](../src/core/sim/DataRuntimeSnapshot.ts)（918L）：Zero-GC 雙緩衝 `RuntimeSnapshotBank` 投射器、視錐剔除、Auto-Tile 遮罩、骨架殘影與 HUD 原語組裝。
  - **砍除已退役卡匣遺留的卡牌／格鬥死分支（全倉淨減 ~3,000 LOC，降至 89,377 LOC）**：
    - 移除未被任何卡匣或測試使用的 `CardDeckEngine.ts`（-975L）與 `FighterFrameEngine.ts`（-790L），並加入 [`ArchitectureTests.ts`](../scripts/sim/ArchitectureTests.ts) 禁令守門。
    - 精簡 [`GenreControllers.ts`](../src/core/sim/GenreControllers.ts)（**1,488L → 516L，-65.3%**）與 [`StudioCommands.ts`](../src/core/editor/StudioCommands.ts)（**1,012L → 712L**）。
  - **工具鏈可重現性對齊**：於 [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) 釘選 `bun-version: '1.4.5'`（對應 `bun.lock` `lockfileVersion: 2`），並於 [`package.json`](../package.json) 宣告 `"engines": { "node": ">=22.0.0", "bun": ">=1.4.0" }`。

---

## 2. 專案健康指標與驗證基準（截至 Phase 3e）

- **驗證指令**：`npm run lint && npm run sim && npm run test && npm run build`
  - `npm run lint`（`tsc --noEmit`）：0 errors
  - `npm run sim`：PASS（含純核心無 DOM、`EngineHost` Facade、Zero-GC 物件池、禁 AI 合成、`src/` 零測試檔、禁 `CardDeckEngine`/`FighterFrameEngine` 回引守門）
  - `npm run test`：**55/55 PASS**
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

### 路線 B｜繼續核心模組細化
1. **其餘 ~1,200L 檔案檢視**：[`WebGpuBackend.ts`](../src/core/gpu/WebGpuBackend.ts)（1,357L）、[`SpriteAtelierView.ts`](../src/ui/SpriteAtelierView.ts)（1,313L）、[`EcsSpatialOracle.ts`](../src/core/ai/EcsSpatialOracle.ts)（1,291L）、[`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts)（1,235L）、[`EcsStudioSession.ts`](../src/core/ecs/EcsStudioSession.ts)（1,205L）。
