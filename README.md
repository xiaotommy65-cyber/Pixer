# Pixel Atelier 🌸🎮

從零打造、手機＆桌機雙端適配的 **可愛工房風 WebGPU / WebGL2 幻想主機與 2D/2.5D 遊戲引擎**。

## ✨ 核心架構與特色

- **GPU 優先渲染管線 ([`src/core/gpu/`](src/core/gpu/))**
  - **WebGPU (`WGSL`)**、**WebGL2 (`GLSL ES 3.00`)** 與 **Canvas 2D** 三層自動降級渲染管線，單幀僅用 2～3 個 Draw Calls 即可驅動 `1,150+` 顆旋轉／漸層光暈／精靈物件。
  - 支援 HD-2D 2.5D Y 軸深度排序、柔和橢圓接觸陰影（Mode 3）、法線浮雕牆體（Mode 4）、景深霧化（Mode 5）與徑向動態加色光源（Mode 1）。
  - **512×512 即時紋理圖集熱重載 (`TextureAtlas`)**：在精靈畫室塗改主角像素後立刻同步寫入 GPU Texture，並重繪遊戲卡匣封面。
- **Switch 風格雙握把掌機與實體插拔卡匣 ([`ConsoleView.ts`](src/ui/ConsoleView.ts), [`switch.css`](src/styles/switch.css))**
  - 開機眨眼動畫（`BootBlinkOverlay`）、HOME 大廳卡片列（`HomeLobbyView`）、斜角系統選單（`AngledSystemMenuView`）、底部換片抽屜與三拍虹膜轉場（`IrisWipeTransition`）。
  - 雙色 Joy-Con 握把、單手／雙手人體工學切換、觸控 DSP 濾波與實體 USB／藍牙手把對應、Stereo DualRumble 震動回饋、一鍵匯出 **PICO-8 風紀念卡匣 PNG**。
- **五大原創可玩卡匣 ([`src/game/`](src/game/))**
  1. `PA-01` **《草莓雲海跳跳》**（`cloudberry/`）：4 大空島 8 關卡收集 24 顆星，支援二段跳、空中衝刺與史萊姆王 Boss 戰。
  2. `PA-02` **《糖霜流星號》**（`sugarStarlight/`）：3 款戰機 × 三色武裝 × 感應砲與 Bomb 系統，挑戰四大星區 Boss。
  3. `PA-03` **《積木秘密基地》**（`sandbox/`）：10 關傳送門／浮橋／爆破謎題，搭配安全 DSL 積木腳本即時編輯器。
  4. `PA-04` **《龍與地城：餘燼》**（`emberkeep/`）：8 層 BSP+SetPiece 程序化生成地城 CRPG，支援 d20 戰鬥、JSON 劇本匯入與 AI 託管。
  5. `PA-05` **《星穹餘燼編年史》**（`astralChronicles/`）：5 大章節 HD-2D 動作 RPG、鏡頭運鏡、大地圖與完整裝備鍛造選單。
- **雙創作工作站 ([`StudioWorkbenchView.ts`](src/ui/StudioWorkbenchView.ts))**
  - **精靈畫室 (`SpriteAtelierView`)**：16×16 雙影格（A 站立 / B 跑跳）像素編輯器，支援鏡像對稱、油漆桶與即時 GPU 圖集熱重載。
  - **積木工房 (`WorkshopView`)**：物理手感／粒子／GPU 光暈滑桿、2D 積木 DSL 編輯器與 D&D 地牢 JSON 劇本編輯器。
  - **晶片音效琴 (`ToySynth`)**：零外部相依 Web Audio 合成器與 BGM 編曲器。

## 🚀 本地開發與驗證

專案使用 `bun.lock` 鎖定套件版本（亦可搭配 Node.js 22+ 執行模擬測試）：

```bash
bun install      # 或 npm install
bun run dev      # 啟動開發伺服器 (port 3000)
bun run lint     # TypeScript 嚴格型別檢查 (tsc --noEmit)
bun run sim      # 執行無頭模擬、1,150+ 精靈壓力與架構邊界驗證
bun run build    # 型別檢查並建置網頁／PWA 靜態檔案至 dist/
```

AI Agent 與進階工程規範請參閱 [`AGENTS.md`](AGENTS.md)。

## 📱 Capacitor 雙平台原生 App 打包（iOS & Android）

本專案已整合 Capacitor 原生橋接層（`com.pixelatelier.console`），支援 WebGPU/WebGL2 零 GC 批次渲染、動態解析度溫控器（`省電 / 平衡 / 畫質`）、原生 CoreHaptics / VibrationEffect 震動回饋、橫屏鎖定、遊戲期間螢幕恆亮、退背景自動存檔省電凍結，以及 PNG 紀念圖卡系統分享。

```bash
# 1. 初始化原生平台工程（首次建置執行）
npx cap add ios
npx cap add android

# 2. 編譯網頁資產並同步至 iOS / Android 原生殼
npm run cap:sync

# 3. 開啟 Xcode 或 Android Studio 建置／上架雙商店
npm run cap:ios
npm run cap:android
```
