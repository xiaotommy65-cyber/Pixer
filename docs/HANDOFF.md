# Pixer — 工程交接書（Engineering Handoff · Wave 1 & Wave 2 Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與本交接書，並於開工前執行 **`bun run audit`**（~0.7s 唯讀體檢），即可零盲點掌握全倉狀態。

---

## 1. 目前 Git 分支與交付進度

- **`main` 基線**：PR #1 → #12（`12269ae`，Phase 0 → Phase 5 Complete + `.agents/` 本機工作流整備）。
- **目前推進分支：`feat/swarm-p0-p1-hardening`**（本機已全數提交驗收，待本機互動登入 GitHub 後執行 `git push -u origin feat/swarm-p0-p1-hardening` 並開 PR 合入 `main`）：
  - **唯讀審計底座與主計畫（`83d3cd7`）**：新增 [`scripts/pixer-audit.ts`](../scripts/pixer-audit.ts) 與 [`scripts/audit/`](../scripts/audit)（狀態/數學/Shader/Zero-GC/死 CSS/指令目錄 100% 唯讀掃描），並建立 [`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 四大史詩藍圖與防停滯四鐵律。
  - **Wave 1｜P0–P1 引擎加固（`21e43a4`、`940b84b`、`864f1b5`、`1e42791`）**：
    - **核心數學與 Zero-Box**：`NoiseMath` 32-bit Murmur3 混洗與 `fbm2D` 正交旋轉；`ColorMath` 嚴格 hex 驗證、超色域防塌陷與單態 `writeVec3` 消除 V8 `HeapNumber` 裝箱（50k Oklab mix `13.68ms / 1391–5412KB` → **`2.23–2.46ms / 0–13KB`**）；`SpringDynamics` 60Hz 歸一化 Verlet 阻尼與等長 IK 防護；`Visibility2D` 單位化 DDA 角落法線與對角穿縫保護；`SpatialHash` 半開區間 `ceil - 1` 消除 4× 桶膨脹。
    - **WebGPU / WebGL2 雙端一致性與真實 PBR/DDA**：WebGPU Pass 1B 改用獨立零光源 `pass1OverlayBindGroup`；WebGL2 `uploadAtlas` 改 `texSubImage3D` 原地更新並為移軸景深補齊 `linearSampler`；雙端統一物理基準 `F0=0.04` + Schlick 菲涅耳、移除冗餘 `sC` 重取樣、Quad3D 零距 `NaN` 防護、32 步有界 **2D Amanatides-Woo DDA 陰影步進**，對齊 CRT/Bayer Y 方向。
    - **Phase 4/5 端到端串接與 60Hz Zero-GC**：修復 `EcsCartridgeRuntime` `transitionedToPlay === 'intro_complete'`；停止 `EcsWorldMapController` 覆寫 `EcsCinematicDirector` 運鏡並接通 `timeScale`、`pitchDeltaDeg`、`tiltShiftBlur`、`tiltShiftFocusY`；全面消除快照陣列 `length = 0` + `.push()` 抖動、快取房間靜態瓦片光源、無配置輸入輪詢環形緩衝區（`240f Zero-GC`：`~2315KB / ~2385KB` → **`37.3KB / 26.7KB`**）。
    - **架構與 CSS 瘦身**：抽離 [`EcsCutsceneSchema.ts`](../src/core/ecs/EcsCutsceneSchema.ts) 與 [`CartridgeId.ts`](../src/core/types/CartridgeId.ts) 使循環依賴 `2 → 0`；補齊 `ECS_COMMAND_CATALOG`（`42 / 42`）並加自動化測試守門；清除 `atelier.css` / `lobby.css` / `studio7.css` 遺留死規則（死類 `82 → 8` 動態類）。
  - **Wave 2｜`workspace: "share"` 獨立工作樹三軌並行交付（`ade9716`、`0e86c83`、`05def47`）**：
    - **動態 `import()` 真分包與 60Hz UI/Save 節流**：`SpriteAtelierView`、`CapacitorNativeBridge`（僅原生環境載入）、`ExternalImportModalView` 均已改動態懶載入（`dynamicImportCount = 3`），`StudioSession` 移至 `AgentBridge` 延遲實例化；`ConsoleHudPresenter`、`ShmupOverlayView`、`SaveService` 完成數值/欄位 dirty-check 與 `>=1s` 存檔節流。
    - **3D/SCC 預言機升級與旗艦過場**：`EcsCinematicOracle` 升級 3 點多幀採樣（`25%/55%/85%`）、`hd2d_3d` 投影牆體遮擋與 `actorB` 遮擋；`EcsSpatialOracle` 新增單向死胡同房間偵測、封死傳送門/Boss 防誤判與實心出生點檢查；為 `PA-14` 與 `PA-15` 編排 4 支旗艦過場（`citadel_gate_intro` 100/S、`malakor_awakening` 98/S、`grove_arrival` 100/S、`warden_awakening` 98/S）。
    - **Phase 6 工作站 UI & 實機 GPU 驗收**：工作站檢視器開放「電影級過場導演與審美預言機」面板（`試映` / `審美評分` / `刪除` / `+ 新增範例過場`）、Zero-GC `視野遮蔽預覽 (FOV Fog)` 切換與靜止編輯 `previewDirty` 0-draw 節能；已於本機 Chrome `http://localhost:3000/` 實測 `PA-14` 真 3D 渲染與過場 21:9 letterbox 播放（0 console / shader 錯誤）。

---

## 2. 本機工具鏈與健康指標（已全數驗收）

- **本機環境**：Windows 已安裝並寫入 User PATH：`Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1`、`uv`/`uvx`，PowerShell `CurrentUser` `RemoteSigned` + `Unblock-File` 已生效；Swarm `workspace: "share"` 獨立工作樹可直接運作。
- **驗證門檻與最新基線**：
  - `bun run audit -- --strict`：**PASS**（exit 0，`critical=0`，Math/Shader `0` warn，Perf/Arch `0` warn，`circularDepsCount=0`，`snapshotArrayResets=0`，`dynamicImportCount=3`，`ecsCommandTypes=42/42`）
  - `bun run lint`（`tsc --noEmit`）：**0 errors**
  - `bun run sim`：**`[SIM ALL PASSED]`**（`ColorMath 50k: 2.46ms / 13KB`；`240f Zero-GC: ECS 0.53ms / 37.3KB, Chunked 2.00ms / 26.7KB`）
  - `npm run test`：**64 pass / 0 fail**
  - `bun run build && bun run clean`：**PASS**（211 modules，`570ms`，`dist/` 已清理；註：`ecs-workbench` chunk 為 `510.77 kB`，略高於 500 kB 建議值）
- **不可動搖鐵則**：
  1. 任何開工與收尾先跑 `bun run audit -- --strict`；新修結構問題必補規則與端到端持久性測試。
  2. 不得將測試檔放回 `src/`，不得在純核心使用 DOM 或遊戲專屬硬編碼，不得產生 `package-lock.json`，不得直推 `main`。
  3. 保持 `AGENTS.md <= 120` 行（目前 `43/120`）、單一工作站與唯一 UI Facade `EngineHost`。

---

## 3. 下一階段推進路線（Wave 3 / Phase 6B）

1. **合入 PR（`feat/swarm-p0-p1-hardening` → `main`）**：
   - 於 GitHub 開 PR 並確認 Actions CI（Bun `1.4.5`）全綠後合入 `main`。
2. **Wave 3A｜Chunk 瘦身、過場字幕/標題 HUD 實機驗證與 V1 遺留拍板**：
   - 解耦 `src/ui/PwaBridge.ts` 對 `@capacitor/core` 的靜態匯入，並在 `vite.config.ts` 將 `SpriteAtelierView` / `EventGraphEditorView` 拆出 `ecs-workbench`（壓低 `510.77 kB` 至 `< 500 kB` 達 0 build warning）。
   - 排查並補實 Wave 2 實機測試觀察到的細節：過場播放時 21:9 暗幕與運鏡均正常，確認 `EcsCinematicDirector.appendCinemaOverlayHud()` 的 `splashTitle` / `subtitle` 文字橫幅於 `SceneGpuBridge` / `GpuEngine` 3D 模式下是否正確繪製於最上層 Pass 1B。
   - 拍板 V1 遺留子引擎（`GenreControllers`、`CardDeckEngine`、`FighterFrameEngine`、`src/core/editor/*`）要轉為動態懶載入外掛或徹底退役，避免反覆增刪。
3. **Wave 3B｜雲端一鍵發佈 UI 與正式環境佈建**：
   - 於 `EcsWorkbenchView` / `EcsWorkbenchShellBuilder` 頂欄接入 `CloudSyncClient`，提供可選登入與「一鍵發佈複製 `?play=<slug>`」，並依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Supabase、Cloudflare R2 (`pixer-assets`) 與 `workers/api`。
