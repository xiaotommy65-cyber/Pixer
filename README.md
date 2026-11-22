# Pixel Atelier 🌸🎮

從零打造、手機＆桌機雙端適配的 **可愛工房風 WebGPU / WebGL2 幻想主機與 2D/2.5D 遊戲引擎**。

## ✨ 核心架構與特色

- **GPU 優先渲染管線與正交引擎 5.0 ([`src/core/gpu/`](src/core/gpu/), [`src/core/sim/`](src/core/sim/))**
  - **WebGPU (`WGSL`)**、**WebGL2 (`GLSL ES 3.00`)** 與 **Canvas 2D** 三層自動降級渲染管線，20-float 零 GC 實例批次，支援 `16,384` 實例上限、Karis Bloom、ACES 色調映射與動態光照。
  - **四軸正交美術系統 (`OrthogonalArt`)**：以 `視角方向 × 組件圖層 × 調色盤 LUT × 材質／動作姿態` 組合角色、武器、1P 手持視角與卡牌卡圖。
  - **1P ↔ 3P 雙視角無縫投射 (`PerspectiveProjector`)**：共用同一份 `TilemapGrid` 與世界實體狀態，支援 2.5D DDA 光線投射牆體、1D Z-Buffer 遮蔽與四方向看板精靈即時切換。
  - **資料驅動卡牌與格鬥核心 (`CardDeckEngine`, `FighterFrameEngine`)**：原生四區牌組（牌庫／手牌／棄牌／消耗）＋多敵狀態系統，以及 60Hz 幀資料（前搖／判定／收招）、Hitbox／Hurtbox／Pushbox 與取消派生系統。
  - **1024×1024 即時紋理圖集熱重載與動態槽回收 (`TextureAtlas`)**：支援精靈畫室熱重載與動態貼圖槽位回收再利用。
- **Switch 風格雙握把掌機與實體插拔卡匣 ([`ConsoleView.ts`](src/ui/ConsoleView.ts), [`switch.css`](src/styles/switch.css))**
  - 開機眨眼動畫（`BootBlinkOverlay`）、HOME 大廳卡片列（`HomeLobbyView`）、斜角系統選單（`AngledSystemMenuView`）、底部換片抽屜與三拍虹膜轉場（`IrisWipeTransition`）。
  - 雙色 Joy-Con 握把、單手／雙手人體工學切換、觸控 DSP 濾波與實體 USB／藍牙手把對應、Stereo DualRumble 震動回饋、一鍵匯出 **PICO-8 風紀念卡匣 PNG**。
- **九大原創可玩卡匣 ([`src/game/`](src/game/))**
  1. `PA-01` **《草莓雲海跳跳》**（`cloudberry/`）：4 大空島 8 關卡收集 24 顆星，支援二段跳、空中衝刺與史萊姆王 Boss 戰。
  2. `PA-02` **《糖霜流星號》**（`sugarStarlight/`）：3 款戰機 × 三色武裝 × 感應砲與 Bomb 系統，挑戰四大星區 Boss。
  3. `PA-03` **《積木秘密基地》**（`sandbox/`）：10 關傳送門／浮橋／爆破謎題，搭配安全 DSL 積木腳本即時編輯器。
  4. `PA-04` **《龍與地城：餘燼》**（`emberkeep/`）：8 層 BSP+SetPiece 程序化生成地城 CRPG，支援 d20 戰鬥、JSON 劇本匯入與 AI 託管。
  5. `PA-05` **《星穹餘燼編年史》**（`astralChronicles/`）：5 大章節 HD-2D 動作 RPG、鏡頭運鏡、大地圖與完整裝備鍛造選單。
  6. `PA-06` **《星穹鉤索跑酷》**（`celestialParkour/`）：繩擺鉤索、動量跑酷與高空特技挑戰。
  7. `PA-07` **《星紋牌陣》**（`astralDeck/`）：純 JSON 資料驅動 Roguelike 牌組構築，四區循環、多敵鎖定、易傷／虛弱／灼燒／力量與戰後三選一選牌。
  8. `PA-08` **《工房武鬥會》**（`atelierBrawler/`）：純 JSON 資料驅動 60Hz 幀資料 2D 格鬥，高低段防禦、命中確認取消連段、氣條超必殺與即時判定盒除錯（`L`）。
  9. `PA-09` **《迴廊雙界》**（`labyrinthDualview/`）：同世界即時 `X` 鍵切換第一人稱 2.5D DDA 光線投射與第三人稱 HD-2D 俯視探索地城。
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
