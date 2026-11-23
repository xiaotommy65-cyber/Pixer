# Pixer — 工程交接書（Engineering Handoff · Phase 0 Complete → Phase 1）

**交接基線**：Phase 0 完成（砍除 PA-13 音遊／`Stage3DPipeline.ts` 與全部 AI 合成音訊改採 `ExternalAudioBank`、精簡卡匣聚焦 `PA-14`/`PA-15`/`PA-01`/`PA-02`/`PA-11`/`PA-12`、補齊 MCP UTF-8 與 Interop 解壓炸彈防護、CI 補跑全套 48 項單測與主包瘦身至 217 kB，全線綠燈）  
**下階段主線**：**Phase 1｜`EcsWorkbenchView` 模組拆分（含 M2 規則/傳送門/AI 可視化檢視器）＋ Web Worker 解包疏導**  
**雲端目標架構**：Cloudflare（Pages + Workers + R2 CDN）＋ Supabase（PostgreSQL + Auth + RLS）

---

## 1. Phase 0 已驗收成果摘要

| 項目 | 具體成果 | 狀態 |
|---|---|---|
| **音訊減法與外部化** | 移除 `PA-13` 4K 音遊（`src/core/rhythm/`、`Stage3DPipeline.ts`、`Rhythm*View`、`rhythm.css`）與所有 AI 程式合成器（`ToySynth` 振盪器、`BgmSequencer`、`SynthPresets`、`AudioPatterns`）；替換為純外部資產 `ExternalAudioBank.ts`（CDN 串流 BGM + LRU `AudioBuffer` SFX + 靜默安全降級，並受 `ArchitectureTests.ts` 零振盪器守門員保護） | **DONE** |
| **卡匣收斂大瘦身** | 移除 `PA-03..PA-10`、`LegacyCartridgePack`、`RpgOverlayView`、`ChronicleOverlayView`、`WorkshopTemplates`；保留使用者指定之 `PA-01`《草莓雲海跳跳》、`PA-02`《糖霜流星號》與 True ECS 旗艦 `PA-14`、`PA-15`（及 ECS 範例 `PA-11`/`PA-12`），全庫減少 **~28,068 LOC**，首屏主包由 **946.95 kB → 217.47 kB（-77%）**，零 Vite 500 kB 警告 | **DONE** |
| **安全與協定硬化** | 修復 `scripts/pixer-mcp.ts` 多位元組 UTF-8 `Content-Length` 切幀 Bug；於 `InteropBundleLoader`、`AsepriteParser`、`TiledImporter`、`EcsCustomSpriteCompiler` 導入嚴格 ZIP/Zlib/Gzip 炸彈上限與路徑穿越阻擋 | **DONE** |
| **CI 與衛生閘門** | 移除過期 `package-lock.json`（統一 `bun.lock`）、新增 `npm run test` 並納入 `.github/workflows/deploy.yml`、穩定化 `Module 3` 記憶體基準測試、同步 `README.md` / `AGENTS.md` / `metadata.json` / `docs/ROADMAP.md` | **DONE** |

---

## 2. 下一階段 Phase 1 切入點

1. **拆分 `src/ui/EcsWorkbenchView.ts`（3,712 行）**並導入 M2「世界規則、傳送門、AI 與 HUD」可視化子檢視器（走既有 `EcsStudioSession` 交易式指令與 `analyzeWorldMapReachability` 軟鎖診斷）。
2. **建立 `interop.worker.ts`**：將 `.zip`/`.aseprite`/`.ldtk`/`.tmj` 解析移出 60fps 主執行緒。
3. **動態切包**：將工作站與掌機殼以 `import()` 延遲載入，為 Phase 2（Cloudflare R2 + Supabase 雲端資產／存檔／短網址分享）鋪路。
