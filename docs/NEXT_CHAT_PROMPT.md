# Pixer — 新對話開局速讀詞（Wave 1–4B Complete · `feat/swarm-p0-p1-hardening`）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由）、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，接著第一時間執行 `bun run audit -- --strict`（<1s 唯讀體檢），切勿重新全倉搜尋消耗額度。

## 當前已驗收基線（Wave 1–4B 完成，待推送開 PR 合入 `main`）
- **審計與驗證全綠**：`bun run audit -- --strict`（`critical=0`、Math/Shader `0` warn、Perf/Arch `0` warn、`circularDepsCount=0`、`42/42` 指令目錄一致、`dynamicImportCount=5`）、`bun run lint`（0 err）、`bun run sim`（`[SIM ALL PASSED]`）、`npm run test`（**72/72 PASS**）、`bun run build`（216 modules，**0 chunk warnings**，`external-import 121.35 kB`、`ecs-workbench 344.10 kB`、`cartridges 483.85 kB`）。
- **Wave 4B（多管線烘焙、瓦片 PBR 頂側分離、Pass 1B 立繪與首幀修復）**：
  - `EcsTileDef.sideSprite` + `roughness`/`metallic`/`emissive` 貫穿 `EcsWorldMapController` → `SceneTrue3DPass` / `SceneGpuBridge` / `GpuQuad3DBatch` 及 `EcsMapDesignerPanel` 瓦片材質檢查器。
  - `PixelForgeProcessor` / `PixelForgeImportTab` 新增 `wall_top_side`、`billboard_actor`、`emissive_light_prop`、`portrait_160x192` 烘焙預設；`EcsCinematicDirector` + `SceneHudOverlayPass` 完成 Pass 1B `160×192` 立繪 (`portraitSpriteId`) 渲染與初始視口自動出畫修復。
- **本機環境就緒**：Windows 本機已備齊 `Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1`。

## 建議下一階段任務（PR 合入 & Cloud 聯調）
1. **合入 PR（`feat/swarm-p0-p1-hardening` → `main`）**：推送分支並確認 GitHub Actions CI 全綠後合入 `main`。
2. **正式環境雲端佈建 / BYOK AI 生圖**：依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Cloudflare R2 + Supabase 與實測 `?play=<slug>` 遠端同步，或選配接橋外部生圖 API 至 Pixel Forge。
