# Pixer (Pixel Atelier) 🎮✨

Zero-GC、純 TypeScript 打造的 **HD-2D 像素 PBR 遊戲引擎（WebGPU / WebGL2 / Canvas 2D）**、**AI-Native True ECS 創作工作站** 與 **Switch 風格雙握把掌機展示殼**。

## ✨ 核心架構與特色

- **原生多後端 Pixel PBR-Lite GPU 管線 ([`src/core/gpu/`](src/core/gpu/))**
  - **WebGPU (`WGSL`)** → **WebGL2 (`GLSL ES 3.00`)** → **Canvas 2D** 三層自動降級渲染管線。
  - **24-float 零 GC 實例批次**（單 Pass 上限 `16,384` 實例）、**8 頁 `1024×1024` `Texture2DArray` 紋理圖集池**（MaxRectsBin 動態打包與回收）、24 動態點光源、2D 牆體軟陰影遮蔽網格、即時平面水波倒影、3-Pass Karis Bloom、Oklab 色域混合與 Bayer 4×4 抖動。
- **True Generational ECS ＋ 純資料多房間 HD-2D 世界引擎 ([`src/core/ecs/`](src/core/ecs/))**
  - 世代控制 `EcsCoreWorld`（17 組稀疏集元件、5 階段 14 系統管線）、稀疏覆寫 Prefab 繼承、無 `eval()` 沙盒腳本 VM、無損雙向視覺事件圖（`EventGraphEditorView`）。
  - 純資料驅動多房間 32×32 / 48×64 HD-2D 瓦片引擎（三層地圖、立體擠出牆、跨房傳送門、機關鎖門與多階段 Boss AI），以及專案內嵌自訂像素精靈（`grid` / `rgba_b64` / 13 種 Oklab+Bayer 程序化 PBR 配方）。
- **外部業界標準格式匯入 ([`src/core/interop/`](src/core/interop/))**
  - DOM-free 原生解析 **Aseprite (`.ase`/`.aseprite` + JSON)**、**LDtk (`.ldtk`)**、**Tiled (`.tmj`/`.json`)** 與 `.zip` 圖集打包，內建嚴格壓縮炸彈上限與路徑穿越防護。
- **AI-Native 協作協議與空間預言機 ([`src/core/ai/`](src/core/ai/))**
  - 28+ 條交易式 Undo/Redo 編輯指令、本地 Stdio MCP Server（`npm run mcp`，支援 UTF-8 位元組精確 `Content-Length` 與 NDJSON 雙協定）、多房間 BFS 軟鎖偵測預言機與 60Hz 腳本化試玩驗證器。
- **純外部資產音訊層 ([`src/core/audio/ExternalAudioBank.ts`](src/core/audio/ExternalAudioBank.ts))**
  - 徹底零 AI 合成噪音：透過宣告式 `ExternalAudioManifest` 載入外部 CDN 音檔（OGG Opus / MP3 串流 BGM ＋ LRU `AudioBuffer` SFX 快取），未掛載或離線時靜默安全降級。
- **精選旗艦可玩卡匣 ([`src/game/`](src/game/))**
  1. `PA-14` **《黑曜魔王城：赤月王座》**：True ECS 多房間 HD-2D 旗艦，三廳探險與 48×64 魔王雙階段 Boss 戰。
  2. `PA-15` **《翠律遺跡：星露聖域》**：100% 專案自訂像素瓦片跨主題雙廳遺跡與守護巨像戰。
  3. `PA-01` **《草莓雲海跳跳》**：4 大空島 8 關卡收集 24 顆星，支援二段跳、空中衝刺與史萊姆王 Boss 戰。
  4. `PA-02` **《糖霜流星號》**：3 款戰機 × 三色武裝 × 感應砲與 Bomb 系統，挑戰四大星區 Boss。
  5. `PA-11` **《星軌節奏塔防》** & `PA-12` **《時空裂隙：星界迴廊》**：True ECS 節拍塔防與多維位面飛鉤範例。

## 🚀 本地開發與驗證

專案使用 `bun.lock` 鎖定套件版本，並支援 Node.js 22+ 執行全部模擬與單元測試：

```bash
bun install       # 安裝依賴
bun run dev       # 啟動開發伺服器 (port 3000)
npm run lint      # TypeScript 嚴格型別檢查 (tsc --noEmit)
npm run sim       # 執行無頭模擬、效能基準與架構邊界守衛
npm run test      # 執行全部單元測試套件（ECS / WorldMap / Interop / 3D / HD-2D / Security）
npm run build     # 型別檢查並建置網頁／PWA 靜態產物至 dist/
npm run mcp       # 啟動本地 Stdio MCP Server
```

工程規範與模組地圖請參閱 [`AGENTS.md`](AGENTS.md)，路線圖請參閱 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 📱 Capacitor 雙平台原生打包（iOS & Android）

```bash
npx cap add ios && npx cap add android
npm run cap:sync
npm run cap:ios   # 或 npm run cap:android
```
