# Pixel Atelier 🌸🎮

從零打造、手機＆桌機雙端適配的 **可愛工房風 WebGPU / WebGL2 幻想主機與 2D 遊戲引擎**。

## ✨ 核心架構與特色

- **GPU 優先渲染管線 (`src/gpu/`)**
  - **WebGPU (`WGSL`)** 與 **WebGL2 (`GLSL ES 3.00`)** 雙後端實例化批次渲染 (`Instanced Sprite Batch`)，單幀僅用 2~3 個 Draw Calls 即可驅動 `1,150+` 顆旋轉／漸層光暈／精靈物件。
  - 內建動態 **加色混合徑向光源 (`Radial GPU Light`)** 與掌機微掃描暖光濾鏡。
  - **即時紋理圖集熱重載 (`TextureAtlas`)**：在畫室塗改主角像素後立刻同步寫入 GPU Texture，並重繪遊戲卡匣封面。
- **Switch 風格雙握把掌機與實體插拔卡匣 (`src/ui/ConsoleView.ts`, `src/styles/switch.css`)**
  - 左／右可換色 Joy-Con 握把（薄荷 × 草莓、草莓牛奶、蜂蜜 × 汽水、藍莓 × 葡萄四款雙色搭配）＋ 滑軌卡榫上電動畫＆四顆玩家指示燈 ＋ 中央主機螢幕。
  - 主機上方設有實體感卡槽、狀態指示燈與退卡鈕（`⏏` / `HOME`），下方為 **卡匣收納盒**：自動記錄每張卡匣最高分／收集星數徽章，支援點擊飛入插卡、按住拖曳進卡槽喚醒待機 Momo，以及開機啟動畫面。
  - 完整操作支援：左右類比搖桿、四向鍵、`Y/B` 跳躍、`A` 特技星光、`X` 1,150+ 精靈派對、`−` 切卡、`+` 重開、`◉` 一鍵匯出 **PICO-8 風紀念卡匣 PNG**（鍵盤另支援方向鍵 / `WASD`、`Space/Z/J`、`X/K`、`R`、`1/2/3` 插卡、`E` 退卡）。
- **三大原創可玩卡匣 (`src/engine/cartridges/`)**
  1. `PA-01` **《草莓雲海跳跳》**：橫向捲動雲端平台冒險，支援踩扁史萊姆、拾取金鑰匙開啟彩虹大門。
  2. `PA-02` **《糖霜流星號》**：糖果夜空彈幕射擊，升級散射砲並挑戰兩階段 32×16 巨大棉花糖飛碟 Boss。
  3. `PA-03` **《積木秘密基地》**：可即時在瀏覽器編寫積木腳本（設定天空漸層、雲朵台、星星與史萊姆）並一鍵套用插卡遊玩。
- **四大可愛創作工作站 (`src/ui/`)**
  - **遊玩台**：Switch 雙握把掌機與卡匣插拔系統，並與 Momo 小兔吉祥物表情即時連動。
  - **精靈畫室**：16×16 雙影格（A 站立 / B 跑跳）像素編輯器，支援鏡像對稱、油漆桶與角色範本套用。
  - **積木工房**：即時微調重力、跳躍彈力、粒子密度與 GPU 光暈滑桿，搭配即時積木腳本編輯區。
  - **晶片音效琴**：零外部相依 Web Audio 合成器與八鍵五聲音階彩虹木琴。

## 🚀 本地開發與驗證

```bash
npm install
npm run dev      # 啟動開發伺服器
npm run lint     # TypeScript 嚴格型別檢查
npm run sim      # 執行純模擬引擎與 1,150+ GPU 精靈壓力驗證
npm run build    # 建置網頁／PWA 靜態檔案至 dist/
```

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

