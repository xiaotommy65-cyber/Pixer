# Pixer — 新對話開局速讀詞（Wave 1–4A Complete · `feat/swarm-p0-p1-hardening`）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由）、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，接著第一時間執行 `bun run audit -- --strict`（<1s 唯讀體檢），切勿重新全倉搜尋消耗額度。

## 當前已驗收基線（Wave 1–4A 完成，待推送開 PR 合入 `main`）
- **審計與驗證全綠**：`bun run audit -- --strict`（`critical=0`、Math/Shader `0` warn、Perf/Arch `0` warn、`circularDepsCount=0`、`42/42` 指令目錄一致、`dynamicImportCount=5`）、`bun run lint`（0 err）、`bun run sim`（`[SIM ALL PASSED]`，`ColorMath 50k: 2.67ms / 0KB`，`240f Zero-GC: ECS 0.58ms / 40.7KB, Chunked 2.25ms / 26.7KB`）、`npm run test`（**69/69 PASS**）、`bun run build`（216 modules，`1.26s`，**0 chunk warnings**，`external-import 113.62 kB`、`ecs-workbench 339.93 kB`）。
- **Wave 4A（跨題材資產底座完成並實機驗收）**：
  - `EcsProjectSchema` / `EcsCustomSpriteCompiler` 支援最高 `256×256` 無損像素精靈與 `160×192` 立繪；新增 DOM-free `PixelForgeProcessor.ts`（自動偵測放大像素塊、四角去背、`grid_majority` + Oklab 色盤鎖定／K-Means + Bayer4 + 描邊 + Sprite Sheet 切幀動畫）與 `PixerAssetPack.ts`（`schemaVersion: 1` + `horror` / `visual_novel` / `dungeon` 三大起始包 + MCP `install_asset_pack` / `export_asset_pack`）。
  - 工作站 `ExternalImportModalView` 新增「Pixel Forge 任意圖洗圖」與「題材資產包」分頁（`PixelForgeImportTab.ts`），Chrome `http://localhost:3000/` 實測洗圖寫入、恐怖包安裝與單步 `復原` 全數正常且 **0 console / shader 錯誤**。
- **本機環境就緒**：Windows 本機已備齊 `Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1`，可直接啟用 Swarm `workspace: "share"` 獨立工作樹（工作樹內用 `cmd /c mklink /J node_modules "c:\Users\TCSH\Downloads\Pixer-main\node_modules"` 毫秒級掛載依賴）。

## 建議下一階段任務（PR 合入 & Wave 4B / Cloud 聯調）
1. **合入 PR（`feat/swarm-p0-p1-hardening` → `main`）**：推送分支並確認 GitHub Actions CI 全綠後合入 `main`。
2. **Wave 4B｜跨題材延伸或正式環境雲端佈建**：可擴充工作站對話立繪面板（搭配 `160×192` Visual Novel 立繪）／BYOK 外部 AI 生圖橋接至 Pixel Forge，或依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Cloudflare R2 + Supabase 與實測 `?play=<slug>` 遠端同步。
