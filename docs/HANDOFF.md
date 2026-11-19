# Pixer Engine 4.0 — 交接書（Handoff）

**交接日期**：2026-11-19  
**接手情境**：已完成 Engine 4.0 三線並進升級（像素美術＋24 動態點光源／水面倒影＋多類型元件引擎），待連接／推送 GitHub 並視需求推進下階段開發或上線測試。

---

## 1. 專案現況與參考文件（避免重複描述）

- **主開發目錄**：`C:\Users\TCSH\.gemini\antigravity\scratch\Pixer`
  - **鏡像同步目錄**：`C:\Users\TCSH\Desktop\Pixer`、`C:\Users\TCSH\Downloads\Pixer`（針對 `src/`、`public/`、`scripts/`、`AGENTS.md` 皆已做 SHA256 比對 `0` 差異；本次新增 `docs/HANDOFF.md` 亦同步寫入）。
- **核心規格書與導覽（請直接閱讀下列檔案，勿重複重寫）**：
  - 專案架構地圖與工程鐵律：`AGENTS.md`（83 行，上限 `<= 120` 行）
  - 里程碑規劃與 Core／Arcade／Edu 分層策略：`docs/ROADMAP.md`
  - Engine 4.0 實機三場景截圖報告：`C:\Users\TCSH\.gemini\antigravity\brain\88aa1360-3940-437f-aa57-5beb24d82eda\engine4_three_track_walkthrough.md`（含 `engine4_pa06.png`、`engine4_fighter.png`、`engine4_card.png`）
  - GitHub Pages CI/CD 流程：`.github/workflows/deploy.yml`（觸發條件為 `main` 分支 push，使用 Bun 建置 `./dist`）

---

## 2. 本階段已完成項目（Engine 3.0 → Engine 4.0 三線並進）

### Track A：真・像素美術與點陣字型管線
- `src/assets/sprites/AutoTileSprites.ts`：34 張 `16×16` 自動拼接與裝飾圖塊（`cliff_m0..cliff_m15`、`grass_m0..grass_m15` 支援 N=1/E=2/S=4/W=8 四鄰位遮罩、外掛邊緣苔草、底部削角，含 `vine_hang` 與 `pebble_decal`）。
- `src/assets/sprites/PixelFontData.ts`：ASCII `32..95`（64 字元）`5×7` 點陣字型模板（`FONT_GLYPH_W = 6`、`FONT_GLYPH_H = 8`）。
- `src/assets/TextureAtlas.ts`：`1024×1024` 圖集保留 `0..106` 既有精靈槽與 `DYNAMIC_START_Y = 128`，於靜態區 `col 16..63` 排入 34 張自動拼接塊與 `8×8` 字型槽（`getGlyphRect(charCode)`），並將 `registerDynamicRgbaSprite()` 上限提升至 `512×256` 及內建 `parallax_twilight_bg` 漸層備援背景。
- `src/ui/BrowserAssetLoader.ts` + `scripts/normalize-sprites.py --engine4-pack`：產出並驗證 `public/assets/engine4/hero_32x32_sheet.png`（8 幀 `32×32` 主角條圖：`hero32_idle_a/b`、`hero32_run_0..3`、`hero32_jump`、`hero32_dash`）與 `public/assets/engine4/parallax_twilight_mountains.png`（`480×180` 暮色遠山斷垣無接縫視差圖），由 `src/main.ts` 非同步載入熱更新。
- `src/game/celestialParkour/ParkourLevels.ts` & `CelestialParkourGame.ts`：`PA-06` 地形雙階段自動拼接、`vine_hang`／`tree_canopy` `windSway` 微風擺動、Stage 1／3 `waterLevelY` 暮色水面、`pixelPerfect = true` 與 8 槽飄字物件池。

### Track B：24 動態點光源 × 即時水面倒影著色器
- `src/core/gpu/GpuTypes.ts` & `GpuEngine.ts`：新增 Zero-GC 動態點光源池（`MAX_DYNAMIC_LIGHTS = 24`、`Float32Array(24 * 8)`）、`pushDynamicLight()`、`setWaterPlane()` 與 `drawPixelText()`（強制 `paletteRow = -2` 以跳過法線與點光源陰影，維持銳利字元＋1px 陰影）。
- `src/core/gpu/WebGpuShaders.ts` / `WebGpuBackend.ts`（WGSL）與 `WebGl2Shaders.ts` / `WebGl2Backend.ts`（GLSL ES 3.00）同步鎖步升級：Mode 0 精靈於現有 Auto-Sobel 法線基礎上疊加 24 盞點光源漫反射與高光溢出，Pass 3 `fsComposite` / `COMPOSITE_FS` 新增平面水面倒影、波形位移與波峰微光；`Canvas2DBackend.ts` 同步更新簽章並提供半透明漸層水面降級。
- `src/core/runtime/SceneGpuBridge.ts`：接線 `windSway` 搖曳、`hero32_*` 腳底對齊置換、`lights -> pushDynamicLight`、`hd2d.waterLevelY -> setWaterPlane`，以及 `hudPrimitives` 的 `kind === 'text'` GPU 文字投影。

### Track C：通用多類型遊戲核心與 Studio 3.0
- `src/core/sim/TweenSystem.ts`：64 槽 Zero-GC 數值補間系統（`linear`、`quadOut`、`backOut`、`cubicInOut`）。
- `src/core/sim/EventActionVm.ts`：升級為 **`When → If → Do`** 規則機，新增 `VmCondition`、環狀事件訊號佇列（`MAX_VM_SIGNALS_PER_TICK = 32`）、`OnSignal` / `EmitSignal` / `FloatText` / `TweenVar` 並維持 `MAX_VM_OPS_PER_TICK = 512` 上限。
- `src/core/sim/CartridgeSchema.ts`、`GenreControllers.ts`、`DataCartridgeRuntime.ts`：支援 `controller: 'fighter' | 'card' | 'topdown' | 'platformer' | 'shmup'`、`cardDeck` 架構與三大實戰控制器（格鬥輕拳／昇龍取消連段／格擋與 Rival AI、卡牌畫布直接點擊出牌／法力護盾／敵人回合意圖、俯視 8 向推箱開關解鎖大門）及圖塊自動拼接。
- `src/ui/WorkshopTemplates.ts` & `WorkshopView.ts`：提供 `parkour`、`fighter`、`card`（4 張預設手牌 `OFFICIAL_CARD_DECK`）、`grid` 四大可試玩範本，以及工坊 3.0 控制器切換、`IF` 條件與 `FloatText` 規則編譯 UI。

### 瀏覽器實機除錯修復（附迴歸驗證）
1. **編輯器試玩轉場永久暫停修復**（`src/main.ts`、`scripts/sim/ArchitectureTests.ts`）：`enterEditorWithIris` / `exitEditorToHandheld` 的 Iris Wipe 結束回呼 `onDone` 補上 `consoleView.syncPauseState()`，解決 `onSwapCovered` 期間 `launchCartridge()` 因轉場遮罩未退而被鎖定為暫停的問題。
2. **亞幀（Sub-frame）按鍵／點擊鎖存保護**（`src/core/runtime/CartridgeRunner.ts`）：在固定步長 `STEP_DT` 累積不足、當幀執行 0 次模擬步時，以 Zero-GC `pendingLatchInput` 暫存並於下一物理步合併 `action` / `jump` / `skillX` / `skillY` / `pointerPrimary` / `pointerSecondary`，避免短點擊流失。
3. **類型專屬 HUD 去重疊**（`src/core/types/SceneTypes.ts`、`DataCartridgeRuntime.ts`、`SceneGpuBridge.ts`）：新增 `hideClassicHud` 標記，於 `fighter`/`card`/`grid` 模式隱藏左上舊愛心與右上星數，保持 `P1 HP / COMBO / P2 HP` 與 `HP / MANA / TURN / FOE` 清爽不重疊。

---

## 3. 最新實測驗證基線與本地環境備註

- **已驗證指令與結果（最終編輯後實測）**：
  - `npm.cmd run lint`（`tsc --noEmit`）→ Exit 0
  - `npm.cmd run sim` → Exit 0（`[SIM ALL PASSED]`，涵蓋 Engine 4.0 Track A/B/C 整合測試、PA-01..PA-06 與 WGSL/GLSL Parity 檢查；於 `scratch\Pixer` 與 `Desktop\Pixer` 雙重驗證通過）
  - `npm.cmd run build` → Exit 0（`✓ 180 modules transformed.`、`PWA v2.0.0` precache `19 entries / 1387.31 KiB`）
  - **瀏覽器實機（`http://localhost:3000/`）**：三場景 0 console error、0 network error：
    - `PA-06`：兩張 Engine 4.0 PNG HTTP 200 載入、16 遮罩地形／暮色視差／水面倒影與 32×32 主角顯示正常。
    - `🥊 星街格鬥擂台`：實戰打出 `P1 HP 90 | COMBO 2 | P2 HP 72` 與 `-10`/`-18` 飄字。
    - `🃏 餘燼魔導牌局`：畫布點擊 `1 : STRIKE` 扣魔為 `MANA 2`、對敵傷害至 `FOE 15` 並浮現 `ARCANE FLOW!` 與 `-5`。
- **本機開發環境備註**：
  - 系統預設 `PATH` 無 `git` 或 `rg`，需改用 GitHub Desktop 附帶之 `C:\Users\TCSH\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe` 與 PowerShell `Select-String`（或 `npm.cmd`）。
  - 像素條圖正規化腳本透過 `uv run --with pillow python scripts/normalize-sprites.py ...` 執行。
  - 若需本地啟動開發伺服器，使用 `npm.cmd run dev -- --port 3000 --force`。

---

## 4. 待辦與下階段優先事項

1. **Git / GitHub 遠端對齊與維護備註**：
   - GitHub 遠端 `https://github.com/xiaotommy65-cyber/Pixer.git`（`main` 分支，父節點 `1bebf50ad6427ac590576ca5ddf88909204f62ed`）已完成關聯；根目錄同時保留 `bun.lock` 與 `package-lock.json`，可與 `.github/workflows/deploy.yml`（`bun install --frozen-lockfile`、`bun run sim`、`bun run build`）相容運行。
   - 若未來新增 npm 相依套件，記得同步更新 `bun.lock`，並維持 `C:\Users\TCSH\Desktop\Pixer` 與 `C:\Users\TCSH\Downloads\Pixer` 鏡像一致性。
2. **後續功能與品質推進建議**：
   - 在瀏覽器實機補測並豐富 Studio 3.0 `grid`（`topdown` 俯視推箱／機關開關）範本玩法與關卡。
   - 更新過時的根目錄 `README.md`（補上 `PA-06`、`1024×1024` Atlas、24 光源／水面倒影及 Studio 3.0 三類型範本說明）。
   - 針對 `vite build` 產物中超過 500 kB 的 `dist/assets/cartridges-*.js`（`630.64 kB`）規劃按卡匣動態載入分塊（dynamic import）以縮減首次載入體積。
   - 依 `docs/ROADMAP.md` 規劃推進 Edu Edition 精簡外殼旗標或新增更多 `32×32` 高解析角色／背景像素資產包。

---

## 5. 不可違反的開發紅線

- **零 GC 熱路徑**：嚴禁於 `src/core/gpu/`、`src/core/sim/`、`src/core/runtime/SceneGpuBridge.ts`、`src/game/` 的 `step()` / `snapshot()` 內動態配置陣列或物件。
- **架構與 DOM 隔離**：`src/core/{ai,hal,input,math,runtime,sim,types}/`、`src/assets/`、`src/game/` 必須維持零 DOM 與零 `@capacitor/*`；`src/ui/` 不得存取 `.runner`（一律經由 `EngineHost`）；禁用 `eval` / `new Function`。
- **渲染與檔案衛生**：WGSL 與 GLSL 必須同步維持 `ArchitectureTests.ts` Parity 標記；不動 `MomoSprites.ts` 與 `SceneGpuBridge.renderIdle()`；`AGENTS.md` 須壓在 `<= 120` 行；`public/` 內嚴禁存放任何 `.md`。

---

## 6. Suggested Skills（建議下次接手 Agent 載入）

- `codebase-design` — 模組介面分層與 Core／Shell 隔離設計
- `create-game-assets` — `32×32` 角色條圖、視差背景與圖塊規範化製作
- `shader-programming` — WebGPU WGSL 與 WebGL2 GLSL ES 3.00 光照、水面與後處理同調維護
- `game-feel`、`input-systems` — 格鬥／飛鉤／卡牌輸入鎖存、手把 DSP 與打擊回饋調校
- `game-ui-ux` — Studio 3.0 工坊編輯器與掌機 HUD 佈局體驗
- `diagnosing-bugs`、`tdd`、`code-review` — 回歸定位、模擬測試防護與變更審查
- `handoff` — 階段工作結束時產出精簡交接摘要
