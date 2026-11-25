# Pixer — 工程交接書（Engineering Handoff · Wave 1–4A Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與本交接書，並於開工前執行 **`bun run audit`**（~0.7s 唯讀體檢），即可零盲點掌握全倉狀態。

---

## 1. 目前 Git 分支與交付進度

- **`main` 基線**：PR #1 → #12（`12269ae`，Phase 0 → Phase 5 Complete + `.agents/` 本機工作流整備）。
- **目前推進分支：`feat/swarm-p0-p1-hardening`**（已合入 `origin/main@49b069c` 並通過全門檻與實機 GPU 驗收；請推送後開 PR 合入 `main`）：
  - **唯讀審計底座與主計畫（`83d3cd7`）**：新增 [`scripts/pixer-audit.ts`](../scripts/pixer-audit.ts) 與 [`scripts/audit/`](../scripts/audit)（狀態/數學/Shader/Zero-GC/死 CSS/指令目錄 100% 唯讀掃描），並建立 [`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 四大史詩藍圖與防停滯四鐵律。
  - **Wave 1｜P0–P1 引擎加固（`21e43a4`、`940b84b`、`864f1b5`、`1e42791`）**：
    - **核心數學與 Zero-Box**：`NoiseMath` 32-bit Murmur3 混洗與 `fbm2D` 正交旋轉；`ColorMath` 嚴格 hex 驗證、超色域防塌陷與單態 `writeVec3`；`SpringDynamics` 60Hz 歸一化 Verlet 阻尼與等長 IK 防護；`Visibility2D` 單位化 DDA 角落法線與對角穿縫保護；`SpatialHash` 半開區間 `ceil - 1`。
    - **WebGPU / WebGL2 雙端一致性與真實 PBR/DDA**：WebGPU Pass 1B 改用獨立零光源 `pass1OverlayBindGroup`；WebGL2 `uploadAtlas` 改 `texSubImage3D` 原地更新並補齊 DoF `linearSampler`；雙端統一 `F0=0.04` + Schlick 菲涅耳與 32 步 **2D Amanatides-Woo DDA 陰影步進**。
    - **Phase 4/5 端到端串接與 60Hz Zero-GC**：修復 `EcsCartridgeRuntime` `transitionedToPlay === 'intro_complete'`；停止 `EcsWorldMapController` 覆寫運鏡並接通 `timeScale`/`pitchDeltaDeg`/`tiltShift*`；消除快照陣列 `.push()` 抖動、快取靜態瓦片光源、無配置輸入輪詢環形緩衝區。
    - **架構與 CSS 瘦身**：抽離 [`EcsCutsceneSchema.ts`](../src/core/ecs/EcsCutsceneSchema.ts) 與 [`CartridgeId.ts`](../src/core/types/CartridgeId.ts)（循環依賴 `2 → 0`）；補齊 `ECS_COMMAND_CATALOG`（`42 / 42`）；清除死 CSS（`82 → 8`）。
  - **Wave 2｜`workspace: "share"` 獨立工作樹三軌並行交付（`ade9716`、`0e86c83`、`05def47`）**：
    - **動態 `import()` 真分包與 60Hz UI/Save 節流**：`SpriteAtelierView`、`CapacitorNativeBridge`、`ExternalImportModalView` 動態懶載入；`StudioSession` 移至 `AgentBridge` 延遲實例化；`ConsoleHudPresenter`、`ShmupOverlayView`、`SaveService` 完成 dirty-check 與 `>=1s` 節流。
    - **3D/SCC 預言機升級與旗艦過場**：`EcsCinematicOracle` 升級 3 點多幀採樣與 `hd2d_3d` / `actorB` 遮擋；`EcsSpatialOracle` 新增單向死胡同與實心出生點檢查；為 `PA-14` 與 `PA-15` 編排 4 支旗艦過場（`98–100/S`）。
    - **Phase 6 工作站 UI**：開放「電影級過場導演與審美預言機」面板、Zero-GC `FOV Fog` 切換與靜止編輯 0-draw 節能。
  - **Wave 3｜Phase 6B 建置瘦身、CJK 字幕/標題 Pass 1B、V1 定案與雲端發佈 UI**：
    - **Chunk 瘦身 & `PwaBridge` 解耦**：移除 [`PwaBridge.ts`](../src/ui/PwaBridge.ts) 對 `@capacitor/core` 靜態匯入（改用執行期全域偵測並由 `ArchitectureTests.ts` 守門）；於 `EcsWorkbenchView.ts` 改為動態懶載入 `EventGraphEditorView` 與 `CloudPublishModalView`（`dynamicImportCount: 3 → 5`）；細分 `vite.config.ts` 將 `ecs-workbench` 由 `510.77 kB` 壓至 **`339.23 kB`**，全建置 **0 chunk warning**。
    - **V1 遺留子引擎定案（凍結相容層）**：將 `CardDeckEngine`、`FighterFrameEngine`、`GenreControllers`、`DataCartridgeRuntime` 與 `src/core/editor/*`（`StudioSession` 於 `AgentBridge` 懶載入）鎖定為凍結相容層並隔離至獨立 Vite chunk `legacy-v1-sim`（`24.38 kB`），避免反覆增刪。
    - **過場字幕/標題 Pass 1B 修復與實機驗證**：新增 [`GpuDynamicGlyphCache.ts`](../src/core/gpu/GpuDynamicGlyphCache.ts)（256 字上限 Zero-GC 動態 Unicode/CJK 點陣字型快取）與 `GpuEngine.drawPixelText()` CJK/全形支援，補齊 `Canvas2DBackend` `paletteRow < -1.5` 全不透明著色與 `EcsCinematicDirector` 字幕深色襯底，並為 `PA-14`/`PA-15` Shot 0 補上開場台詞；本機 Chrome `http://localhost:3000/` 實測 Shot 0 字幕橫幅、Shot 1 `黑曜魔王城` / `OBSIDIAN CITADEL` 標題卡、雲端發佈彈窗與事件圖均正常顯示且 **0 console / shader 錯誤**。
    - **工作站雲端發佈 UI**：新增懶載入 [`CloudPublishModalView.ts`](../src/ui/CloudPublishModalView.ts) 接入 `CloudSyncClient`，提供 `?play=<slug>` 驗證發佈、ETag `If-Match` 衝突覆寫、剪貼簿複製及離線 `.pixer.json` 匯出。
  - **Wave 4A｜跨題材通用資產底座：萬用像素煉金爐 (Universal Pixel Forge) + `PixerAssetPack` v1 + `256×256` 立繪上限**：
    - **`256×256` 精靈/立繪上限升級**：將 [`EcsProjectSchema.ts`](../src/core/ecs/EcsProjectSchema.ts) 與 [`EcsCustomSpriteCompiler.ts`](../src/core/ecs/EcsCustomSpriteCompiler.ts) 自訂精靈邊界由 `8..128` 提升至 `8..256`（`MAX_CUSTOM_SPRITE_RGBA_BYTES = 256×256×4`、`MAX_CUSTOM_SPRITE_B64_CHARS = 512 KB`），直接支援 `160×192` 文字冒險立繪與 `256×256` 恐怖／地牢大 Boss；[`Engine10Core.test.ts`](../scripts/sim/Engine10Core.test.ts) 壓縮炸彈守衛同步擴充驗證。
    - **純核心萬用像素煉金爐（[`PixelForgeProcessor.ts`](../src/core/interop/PixelForgeProcessor.ts)）**：100% DOM-free 提供四角 Flood-fill 去背與 Anti-fringe 清理、緊緻裁切、整數倍網格週期偵測（`detectPixelBlockSize`）、`grid_majority` 抗糊邊降採樣、Oklab `adaptive_kmeans` / `palette_lock` + Bayer 4×4 + 1px 外框勾邊（內建 `asylum_horror` / `obsidian_dungeon` / `cozy_vn` / `cyber_neon` / `endesga_32` 五組題材色盤）、`cols×rows` Sprite Sheet 切片自動產生 `AnimationStateMachineDef`，以及單步 Undo 原子寫入指令。
    - **可攜式跨題材資產包標準（[`PixerAssetPack.ts`](../src/core/interop/PixerAssetPack.ts) + [`PixerMcpProtocol.ts`](../src/core/ai/PixerMcpProtocol.ts)）**：定義 `PixerAssetPackManifest` (`schemaVersion: 1`) 驗證與防 ID 碰撞安裝／匯出，內建 `horror`（陰森古宅恐怖包 + `160×192` 偵探立繪）、`visual_novel`（暖色手帳物語包 + `160×192` 主角立繪）與 `dungeon`（黑曜古墓包）三大起始包，並新增 MCP 工具 `install_asset_pack` 與 `export_asset_pack`。
    - **工作站整合與實機驗收（[`PixelForgeImportTab.ts`](../src/ui/PixelForgeImportTab.ts) + [`ExternalImportModalView.ts`](../src/ui/ExternalImportModalView.ts)）**：於 `external-import` 懶載入分包擴充「Pixel Forge 任意圖洗圖」與「題材資產包」分頁（受 `ArchitectureTests.ts` 守門，不跨分包匯入 `SpriteAtelierPixelOps`）；Chrome `http://localhost:3000/` 實測示範洗圖、恐怖資產包一鍵套用（含氛圍光影切換）與一鍵 `復原` 皆 **0 console / shader 錯誤**。

---

## 2. 本機工具鏈與健康指標（已全數驗收）

- **本機環境**：Windows 已安裝並寫入 User PATH：`Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1`、`uv`/`uvx`，PowerShell `CurrentUser` `RemoteSigned` + `Unblock-File` 已生效；Swarm `workspace: "share"` 獨立工作樹可直接運作。
- **驗證門檻與最新基線**：
  - `bun run audit -- --strict`：**PASS**（exit 0，`critical=0`，Math/Shader `0` warn，Perf/Arch `0` warn，`circularDepsCount=0`，`snapshotArrayResets=0`，`dynamicImportCount=5`，`ecsCommandTypes=42/42`）
  - `bun run lint`（`tsc --noEmit`）：**0 errors**
  - `bun run sim`：**`[SIM ALL PASSED]`**（`ColorMath 50k: 2.67ms / 0KB`；`240f Zero-GC: ECS 0.58ms / 40.7KB, Chunked 2.25ms / 26.7KB`）
  - `npm run test`：**69 pass / 0 fail**
  - `bun run build && bun run clean`：**PASS**（216 modules，`1.26s`，**0 chunk warnings**：`ecs-workbench 339.93 kB`、`external-import 113.62 kB`、`cartridges 481.93 kB`、`index 225.98 kB`、`cloud-publish 14.82 kB`、`event-graph 32.95 kB`、`legacy-v1-sim 24.38 kB`；`dist/` 已清理）
- **不可動搖鐵則**：
  1. 任何開工與收尾先跑 `bun run audit -- --strict`；新修結構問題必補規則與端到端持久性測試。
  2. 不得將測試檔放回 `src/`，不得在純核心使用 DOM 或遊戲專屬硬編碼，不得產生 `package-lock.json`，不得直推 `main`。
  3. 保持 `AGENTS.md <= 120` 行（目前 `43/120`）、單一工作站與唯一 UI Facade `EngineHost`。

---

## 3. 下一階段推進路線（PR 合入與 Wave 4B / 雲端環境佈建）

1. **推送並合入 PR（`feat/swarm-p0-p1-hardening` → `main`）**：
   - 推送分支至 GitHub 開 PR，確認 Actions CI（Bun `1.4.5`）全綠後合入 `main`。
2. **Wave 4B｜跨題材對話立繪面板／BYOK AI 接橋／正式環境雲端佈建**：
   - 可擴充工作站對話立繪 UI（搭配 Wave 4A `160×192` 立繪）或 BYOK 外部生圖 API 接橋至 Pixel Forge；雲端部分依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Supabase PostgreSQL migration、Cloudflare R2 (`pixer-assets`) 與 `workers/api`。
   - 設定 `VITE_CLOUD_API_BASE` / `VITE_CDN_BASE_URL` 並實測工作站「雲端發佈」與 `?play=<slug>` 遠端載入／SRAM 同步。
