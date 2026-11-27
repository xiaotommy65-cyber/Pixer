# Pixer — 工程交接書（Engineering Handoff · Wave 6 Architecture Diet `warn=0` Complete）

> **給下一位接手對話／工程師的零搜索起點**：請先閱讀 [`AGENTS.md`](../AGENTS.md)、[`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md)、[`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 與本交接書，並於開工前執行 **`bun run audit -- --strict`**（~1.0s 唯讀體檢），即可零盲點掌握全倉狀態。

---

## 1. 目前 Git 分支與交付進度

- **`main` 基線**：PR #1 → #15（`ef82213`，Wave 1–5.5 Complete：Phase 0–7、Pixel Forge、多管線烘焙、真 Z-Up 3D 空間引擎、多層高塔探索／自動剖面／Z 跟隨）。
- **最新推進分支：`refactor/arch-god-file-diet`**（基於 `main@ef82213`，透過 5 軌 Swarm `workspace: "share"` 並行完成全倉 17 支 `ARCH-GOD-FILE` 清零、舊分支清理、全門檻與瀏覽器實機驗收後合入 `main`）：
  - **舊分支清理**：清除已合入 PR #14 / #15 之本機與遠端殘留分支（`feat/swarm-p0-p1-hardening`、`origin/feat/multi-story-tower-cutaway`），保留尚在審核中的 PR #13（`chore/env-setup-bun-1-4-5`）。
  - **樣式表模組化（CSS Cascade Preservation）**：將 `switch.css`（→ `+switch-joycon.css`、`switch-overlays.css`）、`lobby.css`（→ `+lobby-desk.css`、`lobby-drawers.css`）與 `studio7.css`（→ `+studio7-panels.css`、`studio7-spatial3d.css`）拆分至全數 `< 970` 行並按原始級聯順序於 `src/main.ts` 匯入。
  - **核心 ECS／AI 與模擬／匯入模組拆分（DOM-free + `circularDepsCount=0`）**：
    - [`EcsSpatialOracle.ts`](../src/core/ai/EcsSpatialOracle.ts)（→ `+EcsSpatialOracle3D.ts`、`EcsSpatialOracleWorld.ts`）、[`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts)（→ `+EcsWorldMapPhysics.ts`、`EcsWorldMapSystems.ts`）、[`EcsStudioSession.ts`](../src/core/ecs/EcsStudioSession.ts)（→ `+EcsStudioCommandHandlers.ts`，完整保留 `48/48` `EcsStudioCommand` 與 `ECS_COMMAND_CATALOG`）。
    - [`GenreControllers.ts`](../src/core/sim/GenreControllers.ts)（→ `+GenreControllersExtra.ts`）、[`DataCartridgeRuntime.ts`](../src/core/sim/DataCartridgeRuntime.ts)（→ `+DataRuntimeHelpers.ts`，皆維持 `legacy-v1-sim` chunk 歸屬）、[`PixelForgeProcessor.ts`](../src/core/interop/PixelForgeProcessor.ts)（→ `+PixelForgeQuantizer.ts`、`PixelForgeBakeProfiles.ts`）。
  - **GPU 後端與著色器拆分（WGSL/GLSL 位元等價）**：將 [`WebGpuBackend.ts`](../src/core/gpu/WebGpuBackend.ts)（→ `+WebGpuPipelines.ts`、`WebGpuResources.ts`）、[`WebGl2Backend.ts`](../src/core/gpu/WebGl2Backend.ts)（→ `+WebGl2Programs.ts`）、[`WebGpuShaders.ts`](../src/core/gpu/WebGpuShaders.ts)（→ `+WebGpuMesh3DShaders.ts`、`WebGpuPostShaders.ts`）、[`WebGl2Shaders.ts`](../src/core/gpu/WebGl2Shaders.ts)（→ `+WebGl2Mesh3DShaders.ts`、`WebGl2PostShaders.ts`）與 [`GpuEngine.ts`](../src/core/gpu/GpuEngine.ts)（→ `+GpuEngine3DHelpers.ts`）拆分至全數 `< 930` 行並守住全數著色器與 GPU 資源釋放契約。
  - **工作站與工坊 UI 拆分（保留全懶載入邊界）**：將 [`ModelAtelierModalView.ts`](../src/ui/ModelAtelierModalView.ts)（→ `+ModelAtelierViewport.ts`、`ModelAtelierInspector.ts`）、[`SpriteAtelierView.ts`](../src/ui/SpriteAtelierView.ts)（→ `+SpriteAtelierDomBuilder.ts`）與 [`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts)（→ `+EcsWorkbenchPreviewRuntime.ts`）拆分至全數 `< 970` 行，`dynamicImportCount` 維持 `6`、Zero `.runner` 違規。
- **最近主線里程碑：`feat/multi-story-tower-cutaway`（PR #15，`ef82213`）**：
  - **Wave 5.5｜多層立體建築與高塔探索體驗（Multi-Story Building & Explorable Tower）**：
    - **自動相機 Z 高度跟隨（Auto Camera Z Follow）**：於 [`EcsProjectSchema.ts`](../src/core/ecs/EcsProjectSchema.ts) 與 [`SceneTypes.ts`](../src/core/types/SceneTypes.ts) 擴充 `autoFollowHeroZ`；於 [`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts) 新增平滑指數阻尼 `cameraZ` 追蹤（切房即時鎖定至主角 `Spatial3D.z`），並由 [`EcsSnapshotProjector.ts`](../src/core/ecs/EcsSnapshotProjector.ts) 寫入 `hd2dDepth.camCenterZ`（尊重 `autoFollowHeroZ === false`、`quadView` 及 `editorCamOverride`）。
    - **室內屋頂／上層自動剖面（Interior Roof / Upper-Floor Cutaway）**：於 [`EcsVoxelVolume.ts`](../src/core/ecs/EcsVoxelVolume.ts) 新增零分配 `hasUpperVoxelAtFootprint()` / `hasAnyVoxelAtOrAboveStory()`，搭配 `roofCutawayMode`（`'auto' | 'always' | 'off'`）與 `roofCutawayAlpha`（預設 `0.18`）；於 [`SceneTrue3DPass.ts`](../src/core/runtime/SceneTrue3DPass.ts) 將剖面上方體素、3D 模型（[`EcsModel3D.ts`](../src/core/ecs/EcsModel3D.ts) `alphaScale`）、Billboard 與樓層光源光暈自動隱藏或送入硬體半透明 `meshAlpha`（`depthWrite: false`），同時對緊貼 `cutawayPlaneZ` 下方的邊界牆體解除 `FACE_CULL_TOP` 封頂，並將高層角色接觸陰影精準投影至 `groundZ + 0.25`。
    - **Z 樓層印章貼齊與真實 3D 樓層光源**：擴充 [`EcsStudioSession.ts`](../src/core/ecs/EcsStudioSession.ts) `instantiate_prefab` 支援選配 `z`（寫入 `overrides.spatial3d.z`）與 `set_camera_3d_pose` 剖面欄位（維持 `48/48` 指令目錄對齊）；[`EcsWorkbenchMapCanvasController.ts`](../src/ui/EcsWorkbenchMapCanvasController.ts) 與 [`EcsMapDesignerPanel.ts`](../src/ui/EcsMapDesignerPanel.ts) 統一 `storyH = room.storyHeight ?? room.wallExtrudeH ?? 24`，印章工具自動貼齊 `activeZLevel * storyH`；[`EcsWorkbenchSceneInspector.ts`](../src/ui/EcsWorkbenchSceneInspector.ts) 新增「跟隨主角 Z」與「上層剖面（自動/恆開/關閉）」控制鈕；修正 [`EcsSnapshotProjector.ts`](../src/core/ecs/EcsSnapshotProjector.ts) `hd2d_3d` 點光源 Y 軸重複扣減與 [`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts) 環境體素光源 Z 高度快取，並將地板光暈投影至各樓層地板高度。
    - **旗艦示範三層守望塔（PA-14 Dogfooding）**：於 [`ObsidianCitadelProject.ts`](../src/game/obsidianCitadel/ObsidianCitadelProject.ts) `courtyard`（`storyHeight: 28`）東南側建置可完整登頂的 L0→L1→L2 哥德守望塔（雙拱門封閉地窖自動觸發剖面、L 型轉角階梯、頂樓雕塑級 3D `models3d.citadel_beacon` 含 4 零件動畫與 24-index 八面體 `rawMesh`、L0/L2 雙層獨立火把），並補齊 [`WorldMap3D.test.ts`](../scripts/sim/WorldMap3D.test.ts) 與 [`DualPerspective3D.test.ts`](../scripts/sim/DualPerspective3D.test.ts) 端到端測試。
- **歷史里程碑（已合入 `main@3802295`）**：
  - **唯讀審計底座與主計畫（`83d3cd7`）**：新增 [`scripts/pixer-audit.ts`](../scripts/pixer-audit.ts) 與 [`scripts/audit/`](../scripts/audit)（狀態/數學/Shader/Zero-GC/死 CSS/指令目錄 100% 唯讀掃描），並建立 [`docs/MASTER_PLAN.md`](MASTER_PLAN.md) 四大史詩藍圖與防停滯四鐵律。
  - **Wave 1｜P0–P1 引擎加固（`21e43a4`、`940b84b`、`864f1b5`、`1e42791`）**：
    - **核心數學與 Zero-Box**：`NoiseMath` 32-bit Murmur3 混洗與 `fbm2D` 正交旋轉；`ColorMath` 嚴格 hex 驗證、超色域防塌陷與單態 `writeVec3`；`SpringDynamics` 60Hz 歸一化 Verlet 阻尼與等長 IK 防護；`Visibility2D` 單位化 DDA 角落法線與對角穿縫保護；`SpatialHash` 半開區間 `ceil - 1`。
    - **WebGPU / WebGL2 雙端一致性與真實 PBR/DDA**：WebGPU Pass 1B 改用獨立零光源 `pass1OverlayBindGroup`；WebGL2 `uploadAtlas` 改 `texSubImage3D` 原地更新並補齊 DoF `linearSampler`；雙端統一 `F0=0.04` + Schlick 菲涅耳與 32 步 **2D Amanatides-Woo DDA 陰影步進**。
    - **Phase 4/5 端到端串接與 60Hz Zero-GC**：修復 `EcsCartridgeRuntime` `transitionedToPlay === 'intro_complete'`；停止 `EcsWorldMapController` 覆寫運鏡並接通 `timeScale`/`pitchDeltaDeg`/`tiltShift*`；消除快照陣列 `.push()` 抖動、快取靜態瓦片光源、無配置輸入輪詢環形緩衝區。
    - **架構與 CSS 瘦身**：抽離 [`EcsCutsceneSchema.ts`](../src/core/ecs/EcsCutsceneSchema.ts) 與 [`CartridgeId.ts`](../src/core/types/CartridgeId.ts)（循環依賴 `2 → 0`）；補齊 `ECS_COMMAND_CATALOG`（`42 / 42`）；清除死 CSS（`82 → 8`）。
  - **Wave 2｜`workspace: "share"` 獨立工作樹三軌並行交付（`ade9716`、`0e86c83`、`05def47`）**：
    - **動態 `import()` 真分包與 60Hz UI/Save 節流**：`SpriteAtelierView`、`CapacitorNativeBridge`、`ExternalImportModalView` 動態懶載入；`StudioSession` 移至 `AgentBridge` 延遲實例化；`ConsoleHudPresenter`、`ShmupOverlayView`、`SaveService` 完成 dirty-check 與 `>=1s` 節流。
    - **3D/SCC 預言機升級與旗艦過場**：`EcsCinematicOracle` 升級 3 點多幀採樣與 `hd2d_3d` / `actorB` 遮擋；`EcsSpatialOracle` 新增單向死胡同與實心出生點檢查；為 `PA-14` 與 `PA-15` 編排 4 支旗艦過場（`98–100/S`）。
    - **Phase 6 工作站 UI**：開放「電影級過場導演與審美預言機」面板、Zero-GC `FOV Fog` 切換與靜止編輯 0-draw 節能。
  - **Wave 3｜Phase 6B 建置瘦身、CJK 字幕/標題 Pass 1B、V1 定案與雲端發佈 UI**：
    - **Chunk 瘦身 & `PwaBridge` 解耦**：移除 [`PwaBridge.ts`](../src/ui/PwaBridge.ts) 對 `@capacitor/core` 靜態匯入（改用執行期全域偵測並由 `ArchitectureTests.ts` 守門）；於 `EcsWorkbenchView.ts` 改為動態懶載入 `EventGraphEditorView` 與 `CloudPublishModalView`（`dynamicImportCount: 3 → 5`）；細分 `vite.config.ts` 將 `ecs-workbench` 由 `510.77 kB` 壓至 **`339.23 kB`**，全建置 **0 chunk warning**。
    - **V1 遺留子引擎定案（凍結相容層）**：將 `CardDeckEngine`、`FighterFrameEngine`、`GenreControllers`、`DataCartridgeRuntime` 與 `src/core/editor/*`（`StudioSession` 於 `AgentBridge` 懶載入）鎖定為凍結相容層並隔離至獨立 Vite chunk `legacy-v1-sim`（`24.38 kB`），避免反覆增刪。
    - **過場字幕/標題 Pass 1B 修復與實機驗證**：新增 [`GpuDynamicGlyphCache.ts`](../src/core/gpu/GpuDynamicGlyphCache.ts)（256 字上限 Zero-GC 動態 Unicode/CJK 點陣字型快取）與 `GpuEngine.drawPixelText()` CJK/全形支援，補齊 `Canvas2DBackend` `paletteRow < -1.5` 全不透明著色與 `EcsCinematicDirector` 字幕深色襯底，並為 `PA-14`/`PA-15` Shot 0 補上開場台詞；本機 Chrome `http://localhost:3000/` 實測 Shot 0 字幕橫幅、Shot 1 `黑曜魔王城` / `OBSIDIAN CITADEL` 標題卡、雲端發佈彈窗與事件圖均正常顯示且 **0 console / shader 錯誤**。
    - **工作站雲端發佈 UI**：新增懶載入 [`CloudPublishModalView.ts`](../src/ui/CloudPublishModalView.ts) 接入 `CloudSyncClient`，提供 `?play=<slug>` 驗證發佈、ETag `If-Match` 衝突覆寫、剪貼簿複製及離線 `.pixer.json` 匯出。
  - **Wave 4A｜跨題材通用資產底座：萬用像素煉金爐 (Universal Pixel Forge) + `PixerAssetPack` v1 + `256×256` 立繪上限**：
    - **`256×256` 精靈/立繪上限升級**：將 [`EcsProjectSchema.ts`](../src/core/ecs/EcsProjectSchema.ts) 與 [`EcsCustomSpriteCompiler.ts`](../src/core/ecs/EcsCustomSpriteCompiler.ts) 自訂精靈邊界由 `8..128` 提升至 `8..256`（`MAX_CUSTOM_SPRITE_RGBA_BYTES = 256×256×4`、`MAX_CUSTOM_SPRITE_B64_CHARS = 512 KB`），直接支援 `160×192` 文字冒險立繪與 `256×256` 恐怖／地牢大 Boss；[`Engine10Core.test.ts`](../scripts/sim/Engine10Core.test.ts) 壓縮炸彈守衛同步擴充驗證。
    - **純核心萬用像素煉金爐（[`PixelForgeProcessor.ts`](../src/core/interop/PixelForgeProcessor.ts)）**：100% DOM-free 提供四角 Flood-fill 去背與 Anti-fringe 清理、緊緻裁切、整數倍網格週期偵測（`detectPixelBlockSize`）、`grid_majority` 抗糊邊降採樣、Oklab `adaptive_kmeans` / `palette_lock` + Bayer 4×4 + 1px 外框勾邊（內建 `asylum_horror` / `obsidian_dungeon` / `cozy_vn` / `cyber_neon` / `endesga_32` 五組題材色盤）、`cols×rows` Sprite Sheet 切片自動產生 `AnimationStateMachineDef`，以及單步 Undo 原子寫入指令。
    - **可攜式跨題材資產包標準（[`PixerAssetPack.ts`](../src/core/interop/PixerAssetPack.ts) + [`PixerMcpProtocol.ts`](../src/core/ai/PixerMcpProtocol.ts)）**：定義 `PixerAssetPackManifest` (`schemaVersion: 1`) 驗證與防 ID 碰撞安裝／匯出，內建 `horror`（陰森古宅恐怖包 + `160×192` 偵探立繪）、`visual_novel`（暖色手帳物語包 + `160×192` 主角立繪）與 `dungeon`（黑曜古墓包）三大起始包，並新增 MCP 工具 `install_asset_pack` 與 `export_asset_pack`。
    - **工作站整合與實機驗收（[`PixelForgeImportTab.ts`](../src/ui/PixelForgeImportTab.ts) + [`ExternalImportModalView.ts`](../src/ui/ExternalImportModalView.ts)）**：於 `external-import` 懶載入分包擴充「Pixel Forge 任意圖洗圖」與「題材資產包」分頁（受 `ArchitectureTests.ts` 守門，不跨分包匯入 `SpriteAtelierPixelOps`）；Chrome `http://localhost:3000/` 實測示範洗圖、恐怖資產包一鍵套用（含氛圍光影切換）與一鍵 `復原` 皆 **0 console / shader 錯誤**。
  - **Wave 4B｜多管線烘焙、HD-2D 瓦片 PBR 頂側分離、Pass 1B 立繪通道與首幀出畫修復**：
    - **`hd2d_3d` 瓦片 PBR 與牆頂／牆側貼圖分離**：擴充 [`EcsTilemapTypes.ts`](../src/core/ecs/EcsTilemapTypes.ts) (`EcsTileDef.sideSprite`)、[`SceneTypes.ts`](../src/core/types/SceneTypes.ts) (`TileDesc.sideSprite` / `roughness` / `metallic` / `emissive`)、[`EcsWorldMapController.ts`](../src/core/ecs/EcsWorldMapController.ts) (`rebuildTiles` 池化零分配轉發與 `patchLiveTileDef`)、[`GpuQuad3DBatch.ts`](../src/core/gpu/GpuQuad3DBatch.ts) / [`GpuEngine.ts`](../src/core/gpu/GpuEngine.ts) (`drawBox3DWall` 支援 `emissive`)、[`SceneTrue3DPass.ts`](../src/core/runtime/SceneTrue3DPass.ts) 與 [`SceneGpuBridge.ts`](../src/core/runtime/SceneGpuBridge.ts)；於 [`EcsMapDesignerPanel.ts`](../src/ui/EcsMapDesignerPanel.ts) 開放牆頂／牆側貼圖、牆體材質、`ExtrudeH`、`Roughness`、`Metallic`、`Emissive` 調整（含即時預覽與單步 Undo 提交）並同步暴露至 [`PixerMcpProtocol.ts`](../src/core/ai/PixerMcpProtocol.ts)。
    - **Pixel Forge 多管線烘焙預設（Baking Profiles）**：於 [`PixelForgeProcessor.ts`](../src/core/interop/PixelForgeProcessor.ts) 與 [`PixelForgeImportTab.ts`](../src/ui/PixelForgeImportTab.ts) 新增 `wall_top_side`（單圖自動合成斜角牆頂 + 牆側雙貼圖）、`billboard_actor`、`emissive_light_prop`（`detectEmissiveLightFromRgba` 自動萃取高光主色並掛載 `LightSource` + 自發光）與 `portrait_160x192` 四組專用烘焙預設。
    - **Pass 1B `160×192` 對話立繪通道**：擴充 `EcsCutsceneShotDef`（`portraitSpriteId` / `portraitSide`）、`HudPrimitiveDesc`（`kind: 'sprite'`）、[`SceneHudOverlayPass.ts`](../src/core/runtime/SceneHudOverlayPass.ts)（`paletteRow = -2` 繞過世界光影呈現原色像素立繪）、[`EcsCinematicDirector.ts`](../src/core/ecs/EcsCinematicDirector.ts) 與 [`PixerAssetPack.ts`](../src/core/interop/PixerAssetPack.ts)（`horror`/`visual_novel` 起始包內建含 `160×192` 立繪之敘事過場）。
    - **首幀出畫與後端 Canvas 同步修復**：修正 [`EcsWorkbenchView.ts`](../src/ui/EcsWorkbenchView.ts) 在 `GpuEngine` 非同步初始化與 `replaceCanvasNode()` 降級 WebGL2 時的 `previewCanvas` 參照同步、`hasBackend()` 檢查及 `rAF` 二次刷新，實機開啟即完整呈現 `hd2d_3d` 城塞場景，無須手動切換視角。
  - **Wave 5｜真 Z-Up 3D 空間架構升級（Phase A / A Polish / B / C）**：
    - **Phase A + Phase A Polish（`4955384`、`bac6de4`）**：統一 Z-Up 6DoF／五種正交透視數學與精確螢幕反投影（[`Perspective3DMath.ts`](../src/core/math/Perspective3DMath.ts) + [`CameraRigDirector.ts`](../src/core/runtime/CameraRigDirector.ts)）；實作 `Indexed Mesh3D` 批次與 `1024×1024` 方向光陰影貼圖（[`GpuMesh3DBatch.ts`](../src/core/gpu/GpuMesh3DBatch.ts)、WebGPU/WebGL2 雙端著色器）、360° 相機朝向 Billboard/Particle，以及硬體 4 視圖分割（`quadViews`）。
    - **Phase B（`fc49ff0`、`ea48d55`）**：交付多層 3D 體素引擎（[`EcsVoxelVolume.ts`](../src/core/ecs/EcsVoxelVolume.ts)：11 種體素形狀、8 層樓高、`6-bit` 鄰接面剔除、台階/斜坡高度與天花板衝突）、Zero-GC `Model3D` 積木／`rawMesh` 資產與 GPU 發射（[`EcsModel3D.ts`](../src/core/ecs/EcsModel3D.ts)）、3D $A^*$（[`GridPathfinder.ts`](../src/core/sim/GridPathfinder.ts)）、ECS `MeshRenderer3D` 元件、`EcsSpatialOracle` 3D BFS（`analyzeWorldMap3DReachability` + `renderRoomSliceAscii`），以及 **`48/48` `EcsStudioCommand`** 與 3 組 MCP 3D 工具。
    - **Phase C（`5c71fab`、`a093478`、`6e07c0f`、`6bea800` + 工作站串接）**：交付 Y-Up→Z-Up 嚴格防轟炸 [`GlbImporter.ts`](../src/core/interop/GlbImporter.ts) 與 [`BbmodelImporter.ts`](../src/core/interop/BbmodelImporter.ts)；新增懶載入 Blockbench 風格 [`ModelAtelierModalView.ts`](../src/ui/ModelAtelierModalView.ts)（`model-atelier` 分包）；於工作站補齊 `.p7-spatial3d-bar` 四視圖/正交切換、Alt+Drag 360° 環繞、RGB XYZ 互動 Gizmo、Z 樓層切片筆刷、6DoF 相機滑桿，以及 `vite.config.ts` `cartridges-hd2d` 分包優化。

---

## 2. 本機工具鏈與健康指標（已全數驗收）

- **本機環境**：Windows 已安裝並寫入 User PATH：`Node v26.13.0`、`Bun 1.4.5`、`Git 2.56.1`、`uv`/`uvx`，PowerShell `CurrentUser` `RemoteSigned` + `Unblock-File` 已生效；Swarm `workspace: "share"` 獨立工作樹可直接運作。
- **驗證門檻與最新基線**：
  - `bun run audit -- --strict`：**PASS**（exit 0，**`critical=0`, `warn=0`**，`godFilesCount: 36 → 26`、`ARCH-GOD-FILE [WARN]: 17 → 0`，Math/Shader `0` warn，Perf/Arch `0` warn，`circularDepsCount=0`，`snapshotArrayResets=0`，`dynamicImportCount=6`，`ecsCommandTypes=48/48`，`agentsLines=43/120`）
  - `bun run lint`（`tsc --noEmit`）：**0 errors**
  - `bun run sim`：**`[SIM ALL PASSED]`**（`ColorMath 50k: 2.33ms / heapDelta=0KB`、`EcsCartridgeRuntime=0.78ms`、`PA-14 extrudedWalls=100, shadows=18`）
  - `npm run test`：**93 pass / 0 fail**
  - `bun run build && bun run clean`：**PASS**（249 modules，`390ms`，**0 chunk warnings**：`cartridges 459.84 kB`、`model-atelier 256.05 kB`、`index 226.08 kB`、`ecs-workbench 206.00 kB`、`external-import 115.42 kB`、`sprite-atelier 72.94 kB`、`core-ecs-interop 56.31 kB`、`cartridges-hd2d 52.15 kB`、`event-graph 32.95 kB`、`legacy-v1-sim 24.38 kB`、`cloud-publish 14.82 kB`；`dist/` 已清理）
  - **本機瀏覽器實機驗收（`1280×800`）**：`http://localhost:3000/` WebGL2 實測 ECS 工作站 `PA-14` `hd2d_3d` 城塞、場景檢查器（`相機跟隨高度 Z`／`室內剖面` 切換）、Spatial3D 四視圖分割、`ModelAtelierModalView`（載入 `citadel_beacon` 4 零件／120 頂點）與 `掌機展示`／`HomeLobbyView` 遊戲輪播（完整驗證拆分後之 `studio7-*.css`、`switch-*.css`、`lobby-*.css`），全程 **0 console / page / network errors**（附註：Model Atelier 彈窗開啟時頂部 `.p7-topbar` `52px` 固定導覽列仍微遮蓋彈窗頂欄，列入後續 UI z-index 微調項目）。
- **不可動搖鐵則**：
  1. 任何開工與收尾先跑 `bun run audit -- --strict`；新修結構問題必補規則與端到端持久性測試。
  2. 不得將測試檔放回 `src/`，不得在純核心使用 DOM 或遊戲專屬硬編碼，不得產生 `package-lock.json`，不得直推 `main`。
  3. 保持 `AGENTS.md <= 120` 行（目前 `43/120`）、單一工作站與唯一 UI Facade `EngineHost`。

---

## 3. 下一階段推進路線

1. **Phase 8｜正式環境雲端佈建 / BYOK AI 生圖接橋**：
   - 依 [`docs/CLOUD_SETUP.md`](CLOUD_SETUP.md) 佈建 Supabase PostgreSQL migration、Cloudflare R2 (`pixer-assets`) 與 `workers/api`，設定 `VITE_CLOUD_API_BASE` / `VITE_CDN_BASE_URL` 並實測工作站「雲端發佈」與 `?play=<slug>` 遠端載入／SRAM 同步，或選配接橋外部生圖 API 至 Pixel Forge。
2. **選配 UI 拋光**：
   - 調整 `.p7-topbar` 與全螢幕彈窗（`ModelAtelierModalView` 等）之 `z-index` 層級，避免工作站頂欄遮擋彈窗標題列。
