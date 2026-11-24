# Pixer — 新對話開局速讀詞（Wave 1 & 2 Complete · `feat/swarm-p0-p1-hardening`）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由）、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，接著第一時間執行 `bun run audit -- --strict`（<1s 唯讀體檢），切勿重新全倉搜尋消耗額度。

## 當前已驗收基線（`feat/swarm-p0-p1-hardening` 本機已提交待推遠端）
- **審計與驗證全綠**：`bun run audit -- --strict`（`critical=0`、Math/Shader `0` warn、Perf/Arch `0` warn、`circularDepsCount=0`、`42/42` 指令目錄一致、`dynamicImportCount=3`）、`bun run lint`（0 err）、`bun run sim`（`[SIM ALL PASSED]`，`ColorMath 50k: 2.46ms / 13KB`，`240f Zero-GC: ECS 37.3KB / Chunked 26.7KB`）、`npm run test`（**64/64 PASS**）。
- **Wave 1 + Wave 2 交付完成**：
  - 核心數學庫（`NoiseMath`/`ColorMath`/`SpringDynamics`/`Visibility2D`/`SpatialHash`）、WGSL/GLSL 雙端一致性（Pass 1B 零光源、WebGL2 `texSubImage3D` + DoF 線性取樣器、`F0=0.04` + Schlick、32 步 2D DDA 陰影）、Phase 4/5 導演端到端串接與 60Hz Zero-GC 全部完成。
  - 動態 `import()` 真分包（`SpriteAtelierView`、`CapacitorNativeBridge`、`ExternalImportModalView`）、60Hz HUD/Save 節流、3D/SCC 預言機升級、`PA-14`/`PA-15` 4 支旗艦過場（審美評分 98–100/S）、Phase 6 工作站過場/審美/FOV 迷霧 UI，以及本機 Chrome `http://localhost:3000/` 實機 GPU 零報錯驗收皆已完成。
- **本機環境就緒**：Windows 本機已備齊 `Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1`，可直接啟用 Swarm `workspace: "share"` 獨立工作樹（工作樹內用 `cmd /c mklink /J node_modules "c:\Users\TCSH\Downloads\Pixer-main\node_modules"` 毫秒級掛載依賴）。

## 建議下一階段任務（Wave 3 / Phase 6B）
1. **收斂建置與過場字幕 HUD 實機驗證**：
   - 解耦 `src/ui/PwaBridge.ts` 的 `@capacitor/core` 靜態匯入並細分 `vite.config.ts` 的 `ecs-workbench` chunk（目前 `510.77 kB`，壓至 `< 500 kB` 達 0 build warning）。
   - 驗證並補實 `EcsCinematicDirector` 的 `splashTitle` / `subtitle` 字幕橫幅於 `hd2d_3d` 模式 Pass 1B 上層正確顯示（實機截圖確認 21:9 letterbox 正常，但標題字幕橫幅尚未出現於畫布），並重跑本機瀏覽器驗證。
2. **架構定案與雲端發佈（可選）**：
   - 處理 V1 遺留子引擎（`GenreControllers` / `CardDeckEngine` / `FighterFrameEngine` / `src/core/editor/*`）去留；或在工作站頂欄接入 `CloudSyncClient` 提供登入與「一鍵發佈複製 `?play=<slug>`」並依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建雲端資源。
