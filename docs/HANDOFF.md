# Pixer — 工程交接書（Engineering Handoff · Phase 2 Complete → Production Provisioning）

**交接基線**：Phase 0 + Phase 1 + Phase 2 全面完成並通過靜態檢查、無頭模擬、單元測試與 Production Build 綠燈。  
**雲端部署指引**：見 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md)（方案 A：Cloudflare Pages + Workers + R2 CDN + Supabase PostgreSQL/Auth/RLS）。

---

## 1. Phase 0 → Phase 2 已驗收成果

| 階段 | 核心成果與驗證 | 狀態 |
|---|---|---|
| **Phase 0｜音訊與架構瘦身** | 退役 `PA-13` 4K 與 `Stage3DPipeline`、移除所有 AI 合成器並以外部資產型 [`ExternalAudioBank.ts`](../src/core/audio/ExternalAudioBank.ts) 取代；精簡卡匣至 `PA-14/15/01/02/11/12`；修補 MCP UTF-8 封包與 zip/zlib 防爆 | **DONE** |
| **Phase 1｜工作站模組化與 Worker 疏導** | 完成 M2 規則檢視器 [`EcsWorldRulesInspectorPanel.ts`](../src/ui/EcsWorldRulesInspectorPanel.ts)、抽離圖集與預製體子面板、建立 [`src/workers/interop.worker.ts`](../src/workers/interop.worker.ts) 背景解析匯入 | **DONE** |
| **Phase 2｜雲端疏導層（R2 + Supabase + Edge API）** | 建立 [`supabase/migrations/20261122000000_pixer_cloud_schema.sql`](../supabase/migrations/20261122000000_pixer_cloud_schema.sql)（4 表 + 嚴格 RLS）、[`workers/api/`](../workers/api/src/index.ts)（R2 內容尋址資產上傳/CDN 快取、ETag 412/304 作品分享、SRAM 時間戳合併、`/api/ai/*` 代理與 `/api/mcp` 遠端 MCP）、純核心 [`CloudSyncClient.ts`](../src/core/cloud/CloudSyncClient.ts)、`?play=<slug>` 網址直開啟動與 [`CloudOffload.test.ts`](../scripts/sim/CloudOffload.test.ts) 全套端到端測試 | **DONE** |

---

## 2. 上線啟用步驟（參考 `docs/CLOUD_SETUP.md`）

1. **Supabase**：建立專案後執行 `supabase/migrations/20261122000000_pixer_cloud_schema.sql`，取得 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。
2. **Cloudflare R2 + Workers**：執行 `wrangler r2 bucket create pixer-assets`，設定 secrets 後於 `workers/api/` 執行 `wrangler deploy`。
3. **前端環境變數**：於部署平台設定 `VITE_CLOUD_API_BASE`（與可選 `VITE_CDN_BASE_URL`），即可啟用 `?play=<slug>` 分享遊玩、外部 `.opus` 音訊包載入與雲端 SRAM 同步。
