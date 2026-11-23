# Pixer 雲端疏導部署指南（方案 A：Cloudflare Workers + R2 CDN + Supabase）

Pixer 採用 **Local-First 引擎 + 邊緣雲端疏導**架構：不設定任何雲端變數時可 100% 離線執行；啟用下列免費／低成本雲端層後，即獲得外部音訊包 CDN 分流（\$0 出流費）、`?play=<slug>` 卡匣分享短網址、跨裝置雲端存檔與安全 AI / Remote MCP 代理。

## 1. 初始化 Supabase（PostgreSQL + Auth + RLS）
1. 建立 Supabase 專案並於 SQL Editor 或 CLI 執行 [`supabase/migrations/20261122000000_pixer_cloud_schema.sql`](../supabase/migrations/20261122000000_pixer_cloud_schema.sql)。
2. 啟用 GitHub / Google OAuth（或 Anonymous Auth 供試玩升級）。
3. 取得 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 與 `SUPABASE_SERVICE_ROLE_KEY`（**Service Role Key 僅可存於 Worker Secrets，絕不可寫入前端**）。

## 2. 建立 Cloudflare R2 與部署 Edge API Worker
```bash
# 1. 建立 R2 Bucket（零出口流量費）
npx wrangler r2 bucket create pixer-assets

# 2. 更新 workers/api/wrangler.toml 中的 SUPABASE_URL 與 ALLOWED_ORIGINS

# 3. 寫入安全機密（不入 Git）
cd workers/api
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# 選配：啟用雲端 AI 代理與 Remote HTTP MCP
npx wrangler secret put AI_PROVIDER_BASE_URL
npx wrangler secret put AI_PROVIDER_API_KEY
npx wrangler secret put MCP_ACCESS_TOKEN

# 4. 部署 Edge API
npx wrangler deploy
```

## 3. 前端接通
於前端環境變數設定（例如 Cloudflare Pages / GitHub Pages build env）：
```env
VITE_CLOUD_API_BASE=https://pixer-edge-api.<your-subdomain>.workers.dev
VITE_CDN_BASE_URL=https://cdn.pixer.app
```
開啟 `https://<your-site>/?play=<slug>` 即可直接串流載入雲端分享卡匣與對應外部音訊包。
