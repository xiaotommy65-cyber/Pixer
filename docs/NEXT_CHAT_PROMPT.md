# Pixer — 新對話開局速讀詞（Wave 7B Workstation 2.0 Complete · `main`）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由）、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，接著第一時間執行 `bun run audit -- --strict`（~1s 唯讀體檢），切勿重新全倉搜尋消耗額度。

## 當前已驗收基線（Wave 1–7B 完成並合入 `main`）
- **審計與驗證全綠**：`bun run audit -- --strict`（**`critical=0`, `warn=0`**、`circularDepsCount=0`、**`51/51` 指令目錄一致**、`dynamicImportCount=6`、`agentsLines=43/120`）、`bun run lint`（0 err）、`bun run sim`（`[SIM ALL PASSED]`、`EcsCartridgeRuntime heapDelta=-4.0KB`）、`npm run test`（**98/98 PASS**）、`bun run build`（257 modules，`1.11s`，**0 chunk warnings**，`cartridges 460.95 kB`、`ecs-workbench 271.49 kB`、`model-atelier 257.92 kB`、`index 226.13 kB`）。
- **Wave 7A + 7B（Workstation 2.0 完整體 + Human/Agent 協作編輯）**：
  - **人機共用交易指令 & AgentBridge**：`51/51` 指令含 `duplicate_entities` / `transform_entities` / `align_entities`（含多層體素 `snap_floor`）、MCP `query_entities_in_box`、以及 17 方法即時協作介面 `window.__PIXEL_ATELIER_AGENT__.workbench`。
  - **視口操控與體素流**：`V` 3D 深度點選／框選／`Shift/Ctrl+Click` 多選（含 `階層` 多選與右側批次面板）、移動/旋轉/縮放三模式 Gizmo ＋ 磁吸、`Scale X/Y`＋`Mesh3D Scale`＋`Yaw 0°` 檢查器同步、四視圖全象限互動與雙擊單視圖切換、顯式 `voxel3d` 第 4 圖層＋編輯剖面＋`Q` 旋轉＋多層拉高、`P` 試玩自動還原編輯縮放倍率。
  - **工作區拋光與跨工坊手勢**：全螢幕彈窗移至 `document.body` `.p7-modal-portal` 脫離 `.p7-topbar` 遮擋、畫布浮動快捷條（`viewport-hud`）、可拖曳調寬與 `Tab` 收合側欄（`localStorage` 記憶）、`?` 快捷鍵表、`Ctrl+K` 快速指令面板、1280×800 工具列零裁切換行、以及 `ModelAtelierViewport` / `EventGraphEditorView` 一致化滑鼠導覽。
- **本機環境就緒**：Windows 本機已備齊 `Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1` 與已授權 `gh` CLI（PowerShell 5.1 串接指令請用 `; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };`，切勿使用 `&&`）。

## 建議下一階段任務
1. **Phase 8｜正式環境雲端佈建 / BYOK AI 生圖**：依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Cloudflare R2 + Supabase 與實測 `?play=<slug>` 遠端同步，或選配接橋外部生圖 API 至 Pixel Forge。
2. **選配微拋光**：為 `<main>` 底部狀態列補上 `text-overflow: ellipsis` 省略與浮動視口條一鍵收合鈕。
