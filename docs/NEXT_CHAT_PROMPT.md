# Pixer — 新對話開局速讀詞（Wave 6 `ARCH-GOD-FILE` Diet Complete · `main`）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由）、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，接著第一時間執行 `bun run audit -- --strict`（~1s 唯讀體檢），切勿重新全倉搜尋消耗額度。

## 當前已驗收基線（Wave 1–6 完成並合入 `main`）
- **審計與驗證全綠**：`bun run audit -- --strict`（**`critical=0`, `warn=0`**、`ARCH-GOD-FILE [WARN]: 17 → 0`、`circularDepsCount=0`、`48/48` 指令目錄一致、`dynamicImportCount=6`、`agentsLines=43/120`）、`bun run lint`（0 err）、`bun run sim`（`[SIM ALL PASSED]`）、`npm run test`（**93/93 PASS**）、`bun run build`（249 modules，`390ms`，**0 chunk warnings**，`cartridges 459.84 kB`、`model-atelier 256.05 kB`、`index 226.08 kB`、`ecs-workbench 206.00 kB`、`cartridges-hd2d 52.15 kB`）。
- **Wave 6（架構瘦身 & 分支整併）**：將全倉 17 支 `>=1200` 行大型模組（CSS 三巨頭、`EcsSpatialOracle`、`EcsWorldMapController`、`EcsStudioSession`、`WebGpuBackend`、`WebGl2Backend`、`WebGpuShaders`、`WebGl2Shaders`、`GpuEngine`、`GenreControllers`、`DataCartridgeRuntime`、`PixelForgeProcessor`、`ModelAtelierModalView`、`SpriteAtelierView`、`EcsWorkbenchView`）全數拆分為 `< 1050` 行模組，零循環依賴並已通過 Chrome `http://localhost:3000/` 實機視覺與 0-error 驗收。
- **Wave 5 + 5.5（真 Z-Up 3D 空間引擎 + 多層高塔探索）**：Z-Up 6DoF／五視角／四視圖分割、`Indexed Mesh3D` + 陰影貼圖、8 層體素體積、自動相機 `cameraZ` 跟隨、室內上層自動剖面 Cutaway、Z-Aware 印章與 3D 樓層光源，並於 `PA-14` `courtyard` 建置可登頂三層哥德守望塔與 3D `citadel_beacon`。
- **本機環境就緒**：Windows 本機已備齊 `Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1` 與已授權 `gh` CLI（PowerShell 5.1 串接指令請用 `; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };`，切勿使用 `&&`）。

## 建議下一階段任務
1. **Phase 8｜正式環境雲端佈建 / BYOK AI 生圖**：依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Cloudflare R2 + Supabase 與實測 `?play=<slug>` 遠端同步，或選配接橋外部生圖 API 至 Pixel Forge。
2. **選配 UI 拋光**：調整 `.p7-topbar` 與全螢幕彈窗（如 `ModelAtelierModalView`）之 `z-index` 層級，避免頂部導覽列遮擋彈窗標題列。
