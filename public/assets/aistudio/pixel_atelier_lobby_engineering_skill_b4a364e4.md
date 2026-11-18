---
name: pixel-atelier-lobby-engineering
description: Complete feature inventory and engineering specification for the Pixel Atelier Lobby & System Shell, integrating Boot Eye-Blink, dynamic cartridge carousel, single-button Iris Wipe Editor transition, Playdate angled menu, and CartridgeHost bindings.
target: Pixel Atelier Engine AI — Lobby & System Shell (src/ui/lobby.js, src/ui/system_menu.js)
---

# Pixel Atelier — 大廳功能總整理與工程實作 Skill

本文件將 **Pixel Atelier** 所有已定案的「大廳（HOME Lobby）與系統外殼」功能收斂為單一工程規格，供引擎開發 AI 直接實作並對接 `CartridgeHost` 與 `FeedbackEngine`。

---

## 1. 大廳核心功能清單（Feature Inventory）

| 功能模組 | 具體行為與視覺呈現 | 對接的底層 API |
| :--- | :--- | :--- |
| **1. 100vh 掌機外殼鎖定** | 雙色 Joy-Con + 中央螢幕完整垂直置中於視口；移除外殼上方分頁與底部外露收納盒。 | CSS `100dvh` + `env(safe-area-inset-*)` |
| **2. 開機像素眨眼動畫** | 初次載入或喚醒時，中央雙眼依序睜開（`220ms / 380ms`）→ 眨眼（`740ms`）→ 淡入大廳。 | `FeedbackEngine.playTick()` 左右聲道平移 |
| **3. 橫向卡匣列 ＋ 動態背景** | 自動列出所有已註冊卡匣；選中卡片 `scale(1.06)` ＋ 青藍 Focus Ring；頂部卡匣槽同步彈跳換名；背景徑向光暈平滑漸變成 `meta.themeColor`。 | `host.listCartridges()` / `host.mount(id)` |
| **4. 掛起狀態標籤** | 背景執行中的卡匣左下角顯示 `遊玩中` 膠囊標籤；按 `A` 無縫續玩，按 `X` 執行卸載重開。 | `host.activeCartridge` / `host.setPaused()` |
| **5. 單一「進入編輯器」按鈕** | 下層 Dock 收斂為主打按鈕 **`進入編輯器`** ＋ `相簿` ＋ `設定`（不塞未完成的假分頁）。 | 觸發全螢幕三拍虹膜轉場（Iris Wipe） |
| **6. 全螢幕可愛虹膜轉場** | 點擊「進入編輯器」→ 按鈕果凍彈跳 → `clip-path: circle()` 從按鈕座標擴散蓋幕 → 幕後隱藏 Joy-Con 切入全螢幕編輯器 → 拉開遮罩並讓工具列 `35ms` 錯開彈入。 | 純 CSS `clip-path` + Web Audio 上／下行和弦 |
| **7. Playdate 斜角側邊選單** | 按 Home 鍵（或長按）從右側以 `skewX(-5deg)` 滑入系統選單，背景加暗遮罩並暫停遊戲。 | `host.setPaused(true)` + BGM 低通濾波 |
| **8. 螢幕濾鏡與拍立得相簿** | 側邊選單提供濾鏡切換（`Clean / LCD / CRT`）；左 Joy-Con 拍照鍵擷取 `<canvas>` 存入相簿。 | `screen-filters.css` + `canvas.toDataURL()` |

---

## 2. 狀態機與頁面切換邏輯（State Machine）

大廳系統外殼僅維護 4 個互斥主狀態（搭配 2 個覆蓋層），禁止多狀態重疊：

```text
[BOOT_BLINK] ──(1.3s 完成)──▶ [HOME_LOBBY]
                                 │  ▲
         ┌───(選卡匣 / 按 A)─────┘  └─────(短按 Home / Esc)───┐
         ▼                                                   │
   [IN_GAME (Play)]                                    [IN_EDITOR (Atelier)]
         ▲                                                   ▲
         └─────(點擊「進入編輯器」觸發三拍虹膜遮罩轉場)──────────┘

覆蓋層（可疊加於 HOME_LOBBY 或 IN_GAME 之上，開啟時自動 host.setPaused(true)）：
  • [ANGLED_MENU]：右側 Playdate 斜角系統選單
  • [CARTRIDGE_DRAWER]：點擊頂部 PA-01 滑出的底部 42% 換片抽屜
```

---

## 3. 工程實作細節與接線規範

### 3.1 大廳與 `CartridgeHost` 對接
* **動態讀取卡匣**：大廳初始化時呼叫 `host.listCartridges()` 產生卡片，不得將卡匣列表寫死在 HTML 裡。
* **聲音層級區隔**：游標在「中層卡匣列」左右移動時使用 `560–740Hz` Tick 並依卡片 X 座標做 Stereo Panning；游標移至「下層 Dock」時提高音高至 `920Hz`，讓玩家只聽聲音就知道目前所在層級。
* **BGM 悶音過渡（選配建議）**：開啟 `ANGLED_MENU` 或退回 `HOME_LOBBY` 時，若存在 BGM `BiquadFilterNode`，於 `180ms` 內將低通截止頻率降至 `450Hz`；回到 `IN_GAME` 時拉回 `20000Hz`。

### 3.2 三拍虹膜轉場（Iris Wipe）實作要點
1. **計算按鈕中心座標**：取得觸發按鈕相對於主視口（`.stage-viewport`）的百分比座標 `(x%, y%)`。
2. **第 1 拍（`0–260ms`）**：設定 `clip-path: circle(0% at x% y%)` 強制 Reflow 後，轉場至 `circle(150% at x% y%)`（曲線 `cubic-bezier(0.22, 1, 0.36, 1)`）。
3. **第 2 拍（`270ms`）**：於完全遮蔽狀態切換 `lobbyShell` 與 `editorView` 的顯示狀態，並隱藏左右 Joy-Con。
4. **第 3 拍（`380–640ms`）**：將遮罩縮回 `circle(0% at 50% 50%)`，同時為編輯器內工具列加上 `.is-revealed` 觸發 `transition-delay: idx * 35ms` 錯開彈入。

### 3.3 斜角側邊選單（Playdate Style）
* 外框套用 `transform: translateX(0) skewX(-5deg)`，內部項目容器套用反向 `transform: skewX(5deg)` 確保文字不歪斜。
* 選單項目固定為：
  1. `繼續遊玩`（關閉選單並 `host.setPaused(false)`）
  2. `重新開始本關`（重新 `host.mount(currentId)`）
  3. `切換卡匣`（關閉側邊欄並滑出 `CARTRIDGE_DRAWER`）
  4. `螢幕濾鏡：純淨 / LCD / CRT`（切換 `.screen-filter` class）
  5. `音效靜音` / `GPU 除錯顯示`

---

## 4. 工程驗收標準（Lobby Checklist）

- [ ] 開機自動播放 1.3s 像素眨眼動畫後進入大廳，且不阻斷後續鍵盤／觸控操作。
- [ ] 大廳卡片列自動同步 `CartridgeHost` 註冊清單，切換焦點時頂部卡匣標籤與背景光暈顏色同步變化。
- [ ] 點擊 Dock 唯一創作入口「進入編輯器」，完整播放三拍圓形虹膜遮罩轉場並錯開彈出工具列；按返回可反向順暢收合回掌機。
- [ ] 按 Home 鍵可叫出 `skewX(-5deg)` 斜角側邊選單並凍結背景遊戲物理；支援純鍵盤方向鍵＋Enter 操作。
