# Pixer — 工程交接書（Engineering Handoff · M1 Complete → M2）

**交接基線**：M1 完成（專案內嵌自訂像素精靈 Schema ＋ Oklab/Bayer 動態圖集熱編譯 ＋ 28 條 AI-Native 指令 ＋ 像素畫室一鍵發佈地圖瓦片／物件印章 ＋ `PA-15` 翠律遺跡實機驗收，全線綠燈）  
**下階段主線**：**M2｜工作站「規則、機關與傳送門」可視化檢視器（Visual Inspector for Rules, AI, Portals & HUD）**  
**必讀檔案**：`AGENTS.md`（憲法與模組地圖）、`docs/ROADMAP.md`（M1..M4 路線圖）、`docs/NEXT_CHAT_PROMPT.md`（新對話開局速讀詞）。

---

## 1. Engine 10.5 ＋ M1 已驗收基線摘要

| 模組與能力 | 實作成果與驗證狀態 | 狀態 |
|---|---|---|
| **32×32 / 48×64 HD-2D 多房間引擎** | `EcsTilemapTypes.ts` + `EcsWorldMapController.ts`：三層瓦片（`ground/wall/decor`）、立體擠出牆（`extrudeH`）、高物件（`renderH`）、瓦片環境補光（`ambientLight`）、傳送門（`requiresGlobal`）、8 向移動與 AABB 貼牆滑動、跟隨鏡頭裁切 | **DONE** |
| **專案自訂精靈 Schema 與動態圖集熱編譯（M1）** | `EcsProjectSchema.ts` 新增 `customSprites`（支援調色盤像素陣列 `grid` 與 13 種 Oklab + Bayer 4×4 程序化 PBR 配方 `procedural`，支援 `16×16`/`32×32`/`32×48`/`48×64`）；`EcsCustomSpriteCompiler.ts`（100% DOM-free）熱編譯並同步寫入/回收 `TextureAtlas` 動態頁，不重建 GPU Context | **DONE** |
| **AI-Native 28 條交易式指令與預言機（M1）** | `EcsStudioSession.ts` 新增 `upsert_custom_sprite` / `remove_custom_sprite`（共 28 條 Undo/Redo 指令）；`PixerMcpProtocol.ts` & `AgentBridge.ts` 開放 `list_custom_sprites` 與 `proceduralSpritePatterns` 語法自述，並與 `stamp_room_ascii` / `analyze_world_map` / `run_scripted_playtest` 串聯 | **DONE** |
| **像素畫室 ↔ 地圖編輯器一鍵貫通（M1）** | `SpriteAtelierView.ts` 支援 `16×16 → 32×32 → 48×64` 非正方形畫布與「🚀 一鍵發佈至工作站地圖」（發佈為地圖瓦片 / 物件印章）；`EcsMapDesignerPanel.ts` 支援 `+ 畫室新增` 與 `自訂` 瓦片徽章；`EcsWorkbenchView.ts` 圖集分頁顯示專案自訂精靈縮圖與 PBR 下拉清單 | **DONE** |
| **跨主題非魔王城實證與全線驗證（M1）** | 新增純資料跨主題專案 `PA-15`《翠律遺跡：星露聖域》（`src/game/emeraldRuins/EmeraldRuinsProject.ts`，20 組自訂像素貼圖、0 組魔王城貼圖、2 廳含 48×64 守護巨像 Boss）＋ 純 MCP 從零生成 2 廳科幻星艦甲板並通過 60Hz 試玩；`npm run lint`、`npm run build`、`npm run sim`、**39/39 單元測試**與實機瀏覽器截圖全數通過 | **DONE** |

---

## 2. 現有核心介面（供 M2 直接銜接）

1. **所有 M2 目標指令已在後端資料層完備（`EcsStudioSession.ts`）**：
   - `upsert_portal` / `remove_portal`
   - `upsert_interaction_rule` / `remove_interaction_rule`
   - `upsert_ai_profile` / `remove_ai_profile`
   - `set_world_map_config`（含 `heroConfig`、`hostileProjectileTag`、`startRoomId`）
   - `upsert_hud_gauge` / `remove_hud_gauge`
   - 意味著 M2 **無需修改底層模擬器**，只需在 `EcsWorkbenchView` 建立乾淨、可 Undo/Redo 且具即時預言機驗證回饋的可視化表單檢視器，即可達成「人類創作 ↔ AI MCP 指令」100% 能力對等！

---

## 3. 下一階段 M2 設計切入點與驗收標準

1. **工作站「世界規則與傳送門」可視化分頁（`EcsWorkbenchView.ts` + 專屬子面板）**：
   - 傳送門編輯器（`portals`）：來源/目標房間、座標與門寬、鎖定旗標（`requiresGlobal`）、鎖定提示文字、點擊直接跳轉定位。
   - 互動機關編輯器（`interactions`）：對象 `tag`、觸發方式（`touch` / `slash_or_touch`）、替換貼圖（可選專案自訂精靈）、全域變數設定／累加／解鎖門檻、回血與得分。
   - 敵人與魔王 AI 編輯器（`aiProfiles`）：追擊距離、移動速度、接觸傷害、二階段血量比率與速度、彈幕發射 Prefab 與散射參數。
   - 主角與 HUD 編輯器（`heroConfig` + `hud[]`）：行走／揮擊貼圖、衝刺倍率、自訂 HUD 血條／數值條即時預覽。
2. **即時驗證與雙軌對等**：
   - 編輯任一規則時即時派發 `EcsStudioSession` 交易式指令（支援 Undo/Redo），並整合「空間診斷（`analyzeWorldMapReachability`）」即時顯示是否存在軟鎖風險。
3. **驗證要求**：
   - 嚴守 Engine Core Purity Gate（零遊戲硬編碼）、`AbortController` + `public destroy()`、以及完整 `npm run lint && npm run sim && npm run build` + 單元測試 + 實機瀏覽器互動驗收。

---

## 4. 不可違反的引擎原教旨紅線（詳見 `AGENTS.md`）

1. **禁止寫實 AI 貼圖與平行 Canvas 2D 舞台**：所有貼圖與瓦片必走 Pixer 像素工藝（Oklab + Bayer 4×4 + `TextureAtlas` + `GpuEngine`）。
2. **核心零遊戲硬編碼**：`src/core/ecs/`、`src/ui/EcsWorkbenchView.ts`、`src/ui/EcsMapDesignerPanel.ts` 嚴禁混入任何單一遊戲專屬邏輯（受 `WorldMap.test.ts` 純淨度守門員保護）。
3. **零 GC 熱路徑 & DOM-free 核心**：`src/core/{ai,ecs,editor,hal,input,math,rhythm,runtime,sim,types}/`、`src/assets/`、`src/game/` 維持 100% DOM-free。
4. **完整驗證閘門**：每次實作收尾必跑 `npm run lint && npm run sim && npm run build` + 全套單元測試 + 實機瀏覽器截圖檢驗（結束後清除 `.playwright-cli/`）。
