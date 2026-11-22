# Pixer M1 Complete → M2 新對話開局速讀詞

請先閱讀 `AGENTS.md`（引擎原教旨憲法與檔案地圖）、`docs/ROADMAP.md` 與 `docs/HANDOFF.md`。

## 當前已驗收基線（M1 Complete）
- **純資料多房間 HD-2D 引擎與自訂像素瓦片管線就緒**：`EcsProjectV2.customSprites` + DOM-free `EcsCustomSpriteCompiler.ts` 支援調色盤像素格與 13 種 Oklab + Bayer 4×4 程序化 PBR 像素配方（`16×16`/`32×32`/`32×48`/`48×64`），動態熱編譯至 `TextureAtlas` 並零重建同步 WebGPU/WebGL2。
- **人機雙軌創作就緒**：`EcsStudioSession` 具備 **28 條**交易式 Undo/Redo 指令（含 `upsert_custom_sprite` / `remove_custom_sprite` / `stamp_room_ascii` / `upsert_tile_def` / `upsert_interaction_rule` / `upsert_ai_profile` / `upsert_portal` / `upsert_hud_gauge`）；`SpriteAtelierView` 支援 `16×16 → 32×32 → 48×64` 畫布與「一鍵發佈為地圖瓦片 / 物件印章」直通 `EcsMapDesignerPanel`。
- **跨主題雙實證與全線綠燈**：內建 `PA-14`《黑曜魔王城》與 100% 自訂貼圖跨主題專案 `PA-15`《翠律遺跡：星露聖域》（20 組專案自訂精靈、0 組魔王城素材），並通過純 MCP 建構 2 廳科幻星艦甲板與 60Hz 試玩；`npm run lint`、`npm run build`、`npm run sim` 與 **39/39 單元測試**全通。

## 本次任務：M2 — 工作站「規則、機關與傳送門」可視化檢視器（Visual Inspector for Rules, AI, Portals & HUD）
1. **整合可視化規則面板（`EcsWorkbenchView` + 子檢視器）**：在工作站內建立可即時編輯 `portals`（跨房間傳送門與鎖門旗標）、`interactions`（互動機關、替換貼圖、計數解鎖、回血得分）、`aiProfiles`（敵人／魔王多階段 AI 與彈幕）、`heroConfig`（主角行走／揮擊貼圖與衝刺倍率）與 `hud[]`（自訂 HUD 血條／數值條）的視覺表單。
2. **全交易式 Undo/Redo 與即時軟鎖驗證**：所有表單修改皆走既有 `EcsStudioSession` 指令（支援復原／重做與即時 GPU 預覽），並整合 `analyzeWorldMapReachability` 顯示即時可達性與軟鎖警告，達成「人類可視化操作 ↔ AI MCP 指令」100% 能力對等。
3. **跨主題實機驗證**：在 `PA-14` 與 `PA-15` 實測新增／修改傳送門、機關與 AI 參數並驗證 Undo/Redo 與試玩行為；遵守 Engine Core Purity Gate 與 `AbortController`/`destroy()` 規範，以 `npm run lint && npm run sim && npm run build`、全套單元測試與實機瀏覽器截圖驗收（結束後清理暫存檔）。
