# Pixer — 工程交接書（Engineering Handoff · Phase 1 Complete → Phase 2）

**交接基線**：Phase 0 + Phase 1 完成（外部音訊層 `ExternalAudioBank`、精簡旗艦卡匣、MCP/Interop 安全硬化、M2「規則／機關／AI／傳送門／HUD」可視化檢視器、`EcsWorkbenchView` 子面板抽離、以及 `.zip`/`.aseprite`/`.ldtk`/`.tmj` Web Worker 背景解包疏導，全線綠燈）  
**下階段主線**：**Phase 2｜Cloudflare R2 + Supabase（PostgreSQL + Auth + RLS）雲端資產、外部音訊包與作品短網址分享層**

---

## 1. Phase 1 已驗收成果

| 模組 | 成果與驗證 | 狀態 |
|---|---|---|
| **M2 世界規則可視化檢視器** | [`EcsWorldRulesInspectorPanel.ts`](src/ui/EcsWorldRulesInspectorPanel.ts) 接入工作站左側「規則」分頁：支援 `portals`、`interactions`、`aiProfiles`、`heroConfig`、`hud[]` 即時表單編輯、全交易式 Undo/Redo、以及頂部即時 BFS 軟鎖預言機警告；通過 `Engine Core Purity Gate` 與 `PA-14`/`PA-15` 雙主題單測 | **DONE** |
| **工作站巨型單檔拆解** | 抽離 [`EcsWorkbenchAtlasPanel.ts`](src/ui/EcsWorkbenchAtlasPanel.ts) 與 [`EcsWorkbenchPrefabInspector.ts`](src/ui/EcsWorkbenchPrefabInspector.ts)，`EcsWorkbenchView.ts` 由 3,712 行降至 ~3,230 行 | **DONE** |
| **Web Worker 外部解析疏導** | 新增 [`src/workers/interop.worker.ts`](src/workers/interop.worker.ts) 與 [`InteropWorkerClient.ts`](src/ui/InteropWorkerClient.ts)，於背景執行緒解壓與解碼 PNG/Aseprite/LDtk/Tiled/ZIP（含 30 秒逾時保護與無 Worker 自動降級），接入 `ExternalImportModalView` 並於 `destroy()` 乾淨終止 | **DONE** |

---

## 2. 下一階段 Phase 2 切入點（已核准方案 A）

1. **Supabase Schema + RLS (`supabase/migrations/`)**：建立 `projects`, `project_revisions`, `user_saves` 資料表與嚴格 Row Level Security 策略。
2. **Cloudflare Workers Edge API (`workers/api/` · Hono + Zod)**：
   - `GET/PUT /api/projects/:slug`（作品發布、ETag 樂觀鎖、版本紀錄）
   - `POST /api/assets/presign`（白名單副檔名 `.opus`/`.mp3`/`.png`/`.json` + 容量上限核發 R2 上傳憑證）
   - `POST /api/ai/*` 與 `POST /api/mcp`（Phase 3 接通 `RemoteAiProvider` 與 Streamable HTTP MCP）
3. **前端雲端同步客戶端 (`src/core/cloud/CloudSyncClient.ts`)**：支援 `?play=<slug>` 分享網址直開遊玩、跨裝置雲端存檔合併與 R2 外部音訊包載入。
