# Pixer — 新對話開局速讀詞（Wave 7A Workstation 2.0 & Agent Co-Editing Complete · `main`）

請先閱讀 [`AGENTS.md`](../AGENTS.md)（引擎憲法）、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)（零 Grep 檔案路由）、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與 [`docs/HANDOFF.md`](HANDOFF.md)，接著第一時間執行 `bun run audit -- --strict`（~1s 唯讀體檢），切勿重新全倉搜尋消耗額度。

## 當前已驗收基線（Wave 1–7A 完成並合入 `main`）
- **審計與驗證全綠**：`bun run audit -- --strict`（**`critical=0`, `warn=0`**、`circularDepsCount=0`、**`51/51` 指令目錄一致**、`dynamicImportCount=6`、`agentsLines=43/120`）、`bun run lint`（0 err）、`bun run sim`（`[SIM ALL PASSED]`、`EcsCartridgeRuntime heapDelta=-13.0KB`）、`npm run test`（**97/97 PASS**）、`bun run build`（254 modules，`852ms`，**0 chunk warnings**，`cartridges 460.95 kB`、`model-atelier 256.05 kB`、`ecs-workbench 246.36 kB`、`index 226.13 kB`）。
- **Wave 7A（Workstation 2.0 核心操控 + Human/Agent 協作編輯）**：
  - **人機共用批次指令 & MCP / `AgentBridge`**：新增 `duplicate_entities`、`transform_entities`、`align_entities`（含多層體素 `snap_floor`）與 MCP `query_entities_in_box`；補齊 `AgentBridge.ecs` Wave 5/7 3D/過場/資產包方法並新增 17 方法即時協作介面 `window.__PIXEL_ATELIER_AGENT__.workbench`（多選、Z 樓層/剖面、四視圖、聚焦鏡頭、即時 GPU PNG 擷取）。
  - **視口多選、三模式 Gizmo、四視圖互動與 4 圖層體素流**：`V` 3D 深度點選／框選／`Shift+Click` 多選（含 `階層` 多選與右側批次面板）、移動/旋轉/縮放 Gizmo ＋ 磁吸、Godot/2D+3D 混合手勢（右鍵環繞、中鍵/`Space` Yaw 感知平移、滾輪暫態 `editorZoom`、`Shift+滾輪` 切樓層）、四視圖全象限互動與雙擊標籤單/四視圖切換、顯式 `voxel3d` 第 4 圖層＋編輯剖面（`全部顯示 / 上層虛化 / 僅當前樓層`）＋`Q`/`Shift+Q` 旋轉階梯斜坡＋多層矩形拉高。
- **本機環境就緒**：Windows 本機已備齊 `Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1` 與已授權 `gh` CLI（PowerShell 5.1 串接指令請用 `; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };`，切勿使用 `&&`）。

## 建議下一階段任務
1. **Wave 7B｜Workstation 2.0 版面、彈窗層級修正、指令面板與跨工坊手勢對齊**：將全螢幕彈窗脫離 `.p7-workbench` stacking context 避免 `.p7-topbar` 遮擋、補上視口浮動工具條、可收合 (`Tab`) 與可調寬左右面板（`localStorage` 偏好記憶）、`?` 快捷鍵表、`Ctrl+K` 快速跳轉，並對齊 `ModelAtelier` / `EventGraph` 滑鼠導覽。
2. **Phase 8｜正式環境雲端佈建 / BYOK AI 生圖**：依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Cloudflare R2 + Supabase 與實測 `?play=<slug>` 遠端同步，或選配接橋外部生圖 API 至 Pixel Forge。
