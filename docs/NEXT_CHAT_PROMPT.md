# Pixer — 新對話開局速讀詞（Phase 2 Complete → Phase 3）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎原教旨憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由與依賴圖）、[`docs/ROADMAP.md`](ROADMAP.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，避免耗費大量探索時間。

## 當前已驗收基線（Phase 0 + Phase 1 + Phase 2 + Hardening）
- **HD-2D Pixel PBR-Lite 引擎與外部音訊層**：`WebGPU` / `WebGL2` / `Canvas2DBackend`、`1280×720`、8 頁 `1024×1024` 圖集池、完全移除 AI 程序合成器並以 [`ExternalAudioBank.ts`](../src/core/audio/ExternalAudioBank.ts) 外部 `.opus`/`.mp3` 資源層取代；保留旗艦卡匣 `PA-14`、`PA-15`、`PA-01`、`PA-02`、`PA-11`、`PA-12`。
- **True ECS 工作站與背景 Worker**：單一工作站 [`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts) + M2 世界規則檢視器 [`EcsWorldRulesInspectorPanel.ts`](../src/ui/EcsWorldRulesInspectorPanel.ts)（全交易 Undo/Redo + 即時 BFS 軟鎖預言機）+ [`src/workers/interop.worker.ts`](../src/workers/interop.worker.ts) 背景解壓解析（防 zip/zlib 炸彈與路徑穿越）。
- **雲端疏導層（方案 A：Cloudflare Workers + R2 + Supabase）**：[`supabase/migrations/20261122000000_pixer_cloud_schema.sql`](../supabase/migrations/20261122000000_pixer_cloud_schema.sql)、[`workers/api/src/index.ts`](../workers/api/src/index.ts)（R2 不可變快取、ETag 412/304 樂觀鎖、`audioManifest` 往返、SRAM 合併、驗證保護 `/api/ai/*` 與常數時間驗證 `/api/mcp`）、純核心 [`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts) 與 `?play=<slug>` 直開啟動。
- **驗證門檻**：`npm run lint`（含 `src` + `scripts` + `workers`）、`npm run sim`、`npm run test`（54+ 測試）與 `npm run build` 全通。

## 下階段建議任務（Phase 3）
1. **工作站一鍵發佈與登入 UI**：在 `EcsWorkbenchView` 加入「登入 Supabase / 一鍵發佈作品並複製 `?play=<slug>` 分享網址」與「雲端 SRAM 同步」介面。
2. **清理歷史遺留孤島與巨型單檔**：依 `docs/CODEBASE_MAP.md` 清單逐步拆解 `EcsWorkbenchView.ts`（3,234L）與評估退場未接線的舊模擬模組（`WorldKernel` 10 檔、3,240L）。
3. **正式環境佈建**：依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Supabase、Cloudflare R2 (`pixer-assets`) 與 Workers，並配置 `VITE_CLOUD_API_BASE` 與外部 `.opus` 音訊包。
