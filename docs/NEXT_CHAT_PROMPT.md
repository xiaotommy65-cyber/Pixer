# Pixer — 新對話開局速讀詞（Wave 1–5.5 Complete · `main`）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由）、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，接著第一時間執行 `bun run audit -- --strict`（<1s 唯讀體檢），切勿重新全倉搜尋消耗額度。

## 當前已驗收基線（Wave 1–5.5 完成並合入 `main`）
- **審計與驗證全綠**：`bun run audit -- --strict`（`critical=0`、Math/Shader `0` warn、Perf/Arch `0` warn、`circularDepsCount=0`、`48/48` 指令目錄一致、`dynamicImportCount=6`、`agentsLines=43/120`）、`bun run lint`（0 err）、`bun run sim`（`[SIM ALL PASSED]`）、`npm run test`（**93/93 PASS**）、`bun run build`（222 modules，**0 chunk warnings**，`cartridges 460.56 kB`、`model-atelier 260.60 kB`、`index 226.08 kB`、`ecs-workbench 204.04 kB`、`cartridges-hd2d 52.15 kB`）。
- **Wave 5（真 Z-Up 3D 空間引擎）**：統一 Z-Up 6DoF／五視角正交與硬體 4 視圖分割、`Indexed Mesh3D` + `1024×1024` 陰影貼圖、8 層體素體積 (`RoomVoxelVolume`)、3D $A^*$ 與 3D BFS (`analyzeWorldMap3DReachability`)、`.glb`/`.bbmodel` 匯入與懶載入 `ModelAtelierModalView`。
- **Wave 5.5（多層立體建築與高塔探索體驗）**：
  - **自動相機 Z 跟隨**：`EcsWorldMapController.cameraZ` + `EcsSnapshotProjector` 平滑追蹤主角 `Spatial3D.z`（尊重 `autoFollowHeroZ` / `quadView` / `editorCamOverride`）。
  - **室內上層自動剖面 Cutaway**：`RoomVoxelVolume.hasUpperVoxelAtFootprint` + `SceneTrue3DPass` 自動隱藏／半透明虛化上層體素、3D 模型 (`alphaScale`)、Billboard 與樓層光源，解除下層邊界牆 `FACE_CULL_TOP` 封頂，並將接觸陰影精準投影至 `groundZ + 0.25`。
  - **Z-Aware 印章與 3D 樓層光源**：`instantiate_prefab.z` 支援樓層高度、地圖畫布印章貼齊 `activeZLevel * storyH`、修正 `hd2d_3d` 點光源 Y 座標與各樓層地板光暈高度；`PA-14` `courtyard` 新增三層可登頂哥德守望塔與 3D `citadel_beacon` 示範資產。
- **本機環境就緒**：Windows 本機已備齊 `Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1` 與已授權 `gh` CLI（PowerShell 5.1 串接指令請用 `; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };`，切勿使用 `&&`）。

## 建議下一階段任務
1. **技術債瘦身（`ARCH-GOD-FILE` 拆分 & 舊分支清理）**：拆分 `EcsSpatialOracle.ts`、`WebGpuBackend.ts`、`EcsWorldMapController.ts` 等大型檔案，維持 `0` 循環依賴與全測試綠燈。
2. **Phase 8｜正式環境雲端佈建 / BYOK AI 生圖**：依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Cloudflare R2 + Supabase 與實測 `?play=<slug>` 遠端同步，或選配接橋外部生圖 API 至 Pixel Forge。
