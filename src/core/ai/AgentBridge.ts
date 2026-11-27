import type { AtlasPoolStats } from '../gpu/GpuTypes.ts';
import { EcsCartridgeRuntime } from '../ecs/EcsCartridgeRuntime.ts';
import {
  compileEventGraphToScript,
  compileScriptToEventGraph,
  type EcsEventGraphIR,
} from '../ecs/EcsEventGraph.ts';
import {
  ECS_PROCEDURAL_SPRITE_PATTERNS,
  type EcsProceduralSpritePattern,
  type EcsProjectV2,
} from '../ecs/EcsProjectSchema.ts';
import {
  ECS_ATTACHABLE_COMPONENTS,
  ECS_COMMAND_CATALOG,
  EcsStudioSession,
  type EcsAttachableComponent,
  type EcsCommandGrammarEntry,
  type EcsCommandResult,
  type EcsCustomSpriteSummary,
  type EcsHistoryItem,
  type EcsModel3DSummary,
  type EcsPlaytestReport,
  type EcsPrefabSummary,
  type EcsStudioCommand,
} from '../ecs/EcsStudioSession.ts';
import { CASTLE_TILE_REGISTRY, type EcsTileDef } from '../ecs/EcsTilemapTypes.ts';
import { ECS_VOXEL_SHAPES, type EcsVoxelShape } from '../ecs/EcsVoxelVolume.ts';
import {
  getCartridgeJson,
  listCartridgeIds,
  registerCartridgePlugin,
  type CartridgePluginDefinition,
} from '../runtime/CartridgeRegistry.ts';
import type { CartridgeRunner } from '../runtime/CartridgeRunner.ts';
import type { LoadCartridgeOptions, LoadCartridgeResult } from '../runtime/EngineHost.ts';
import type {
  StudioCommand,
  StudioCommandResult,
  StudioHistoryEntry,
} from '../editor/StudioCommands.ts';
import type { PlaytestOptions, PlaytestReport, SceneVisualReport } from '../editor/StudioPlaytestDiag.ts';
import { StudioSession } from '../editor/StudioSession.ts';
import { validateCartridgeJson, type CartridgeJsonV1 } from '../sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../sim/DataCartridgeRuntime.ts';
import {
  createEmptyInputState,
  isTurnCapableCartridge,
  type CartridgeId,
  type RenderSceneSnapshot,
  type RpgMenuOption,
  type TurnKernelContract,
} from '../types/WorldTypes.ts';
import { HybridAiDirector, type TacticalAdviceResult } from './AiProvider.ts';
import {
  critiqueCutsceneAesthetics,
  type EcsCutsceneAestheticReport,
} from './EcsCinematicOracle.ts';
import {
  runScriptedPlaytest,
  type EcsKeypointPlaytestPlan,
  type EcsScriptedPlaytestReport,
} from './EcsPlaytestVerifier.ts';
import {
  analyzeActionReachability,
  analyzeWorldMap3DReachability,
  analyzeWorldMapReachability,
  observeSceneSemantics,
  renderRoomAscii,
  renderRoomSliceAscii,
  type EcsReachabilityReport,
  type EcsRoomAsciiReport,
  type EcsRoomSliceAsciiReport,
  type EcsSemanticSceneReport,
  type EcsWorldMap3DReachabilityReport,
  type EcsWorldMapReachabilityReport,
  type ReachabilityOptions,
} from './EcsSpatialOracle.ts';
import { serializeCartridgeObservation, type UnifiedGameObservation } from './ObservationSerializer.ts';
import {
  queryEntitiesInBox,
  type EcsEntityBoxMatch,
  type EcsEntityBoxQuery,
} from './PixerMcpProtocol.ts';
import {
  buildAssetPackInstallCommands,
  buildBuiltinStarterPack,
  buildInteropStudioCommands,
  detectJsonInteropFormat,
  exportProjectAsAssetPack,
  parseLdtkProject,
  parseTiledMap,
  validateAssetPackManifest,
  type BuiltinStarterPackGenre,
  type DecodedPngImage,
  type PixerAssetPackGenre,
  type PixerAssetPackManifest,
} from '../interop/index.ts';

export type { EcsEntityBoxMatch, EcsEntityBoxQuery };

export type PixerPlatformMode = 'studio' | 'arcade';
export type WorkbenchSliceCutawayMode = 'all' | 'ghost_above' | 'solo_floor';
export type WorkbenchGizmoMode = 'move' | 'rotate' | 'scale';
export type WorkbenchEditLayer = 'ground' | 'wall' | 'decor' | 'voxel3d';
export type WorkbenchToolId = 'select' | 'brush' | 'rect' | 'fill' | 'erase' | 'eyedropper' | 'stamp' | 'pan';
export type WorkbenchCameraViewChoice =
  | 'perspective'
  | 'ortho_top'
  | 'ortho_front'
  | 'ortho_side'
  | 'ortho_iso'
  | 'quad';

export interface PixelAtelierWorkbenchState {
  activeRoomId: string;
  selectedEntityIds: string[];
  activeTool: WorkbenchToolId;
  gizmoMode: WorkbenchGizmoMode;
  editLayer: WorkbenchEditLayer;
  activeZLevel: number;
  sliceCutawayMode: WorkbenchSliceCutawayMode;
  snapStep: number;
  extrudeStories: number;
  cameraX: number;
  cameraY: number;
  editorZoom: number;
  simRunning: boolean;
  viewMode: WorkbenchCameraViewChoice;
  quadView: boolean;
}

export interface PixelAtelierWorkbenchAgentApi {
  isMounted(): boolean;
  getState(): PixelAtelierWorkbenchState | null;
  setSelection(entityIds: string[]): string[];
  focusSelection(): boolean;
  focusEntity(entityId: string): boolean;
  setActiveRoom(roomId: string): boolean;
  setActiveZLevel(zLevel: number): number;
  setSliceCutaway(mode: WorkbenchSliceCutawayMode): WorkbenchSliceCutawayMode;
  setTool(tool: WorkbenchToolId): WorkbenchToolId;
  setGizmoMode(mode: WorkbenchGizmoMode): WorkbenchGizmoMode;
  setLayer(layer: WorkbenchEditLayer): WorkbenchEditLayer;
  setSnapStep(stepPx: number): number;
  setEditorCamera(x: number, y: number, zoom?: number): boolean;
  resetEditorCamera(): boolean;
  setViewMode(view: WorkbenchCameraViewChoice): boolean;
  setSimRunning(running: boolean): boolean;
  captureViewportPng(): string | null;
}

export interface PixelAtelierStudioAgentApi {
  dispatch(cmd: StudioCommand): StudioCommandResult;
  batch(cmds: readonly StudioCommand[], label?: string): StudioCommandResult;
  undo(): StudioCommandResult;
  redo(): StudioCommandResult;
  canUndo(): boolean;
  canRedo(): boolean;
  getRevision(): number;
  getDocument(): CartridgeJsonV1;
  getHistory(): StudioHistoryEntry[];
  playtest(opts?: PlaytestOptions): PlaytestReport;
  inspectVisual(frames?: number): SceneVisualReport;
  capturePreviewPng(): string | null;
  mountToConsole(opts?: LoadCartridgeOptions): LoadCartridgeResult;
  loadFromActiveCartridge(): StudioCommandResult;
}

export interface PixelAtelierEcsAgentApi {
  dispatch(cmd: EcsStudioCommand): EcsCommandResult;
  batch(cmds: readonly EcsStudioCommand[], label?: string): EcsCommandResult;
  undo(): EcsCommandResult;
  redo(): EcsCommandResult;
  getRevision(): number;
  getProject(): EcsProjectV2 | null;
  getHistory(): EcsHistoryItem[];
  listAttachableComponents(): readonly EcsAttachableComponent[];
  listPrefabs(): EcsPrefabSummary[];
  listCustomSprites(): EcsCustomSpriteSummary[];
  listModels3D(): EcsModel3DSummary[];
  describeGrammar(): {
    commands: readonly EcsCommandGrammarEntry[];
    attachableComponents: readonly EcsAttachableComponent[];
    proceduralSpritePatterns: readonly EcsProceduralSpritePattern[];
    voxelShapes: readonly EcsVoxelShape[];
    customSprites: readonly EcsCustomSpriteSummary[];
    models3d: readonly EcsModel3DSummary[];
    tiles: readonly EcsTileDef[];
  };
  getRoomAscii(roomId?: string): EcsRoomAsciiReport | null;
  getRoomSliceAscii(roomId?: string, zLevel?: number): EcsRoomSliceAsciiReport | null;
  analyzeWorldMap(): EcsWorldMapReachabilityReport | null;
  analyzeWorldMap3D(): EcsWorldMap3DReachabilityReport | null;
  observeSemantics(): EcsSemanticSceneReport | null;
  queryEntitiesInBox(filter?: EcsEntityBoxQuery): EcsEntityBoxMatch[];
  analyzeReachability(opts?: ReachabilityOptions): EcsReachabilityReport | null;
  critiqueCutscene(cutsceneId: string): EcsCutsceneAestheticReport | null;
  playtest(frames?: number): EcsPlaytestReport | null;
  runScriptedPlaytest(plan: EcsKeypointPlaytestPlan): EcsScriptedPlaytestReport | null;
  getEventGraph(scriptId: string): EcsEventGraphIR | null;
  applyEventGraph(graph: EcsEventGraphIR): EcsCommandResult;
  importExternalMap(opts: {
    jsonText: string;
    format?: 'auto' | 'ldtk' | 'tiled';
    sourceName?: string;
    replaceWorldMap?: boolean;
    wallExtrudeH?: number;
  }): EcsCommandResult & { reachability?: EcsWorldMapReachabilityReport; warnings?: string[] };
  installAssetPack(
    input: BuiltinStarterPackGenre | PixerAssetPackManifest,
    opts?: { applyAtmosphere?: boolean },
  ): EcsCommandResult & { packId?: string; sprites?: number; tileDefs?: number; prefabs?: number };
  exportAssetPack(meta?: {
    id?: string;
    name?: string;
    genre?: PixerAssetPackGenre;
    author?: string;
    description?: string;
  }): PixerAssetPackManifest | null;
  mountToConsole(): { ok: boolean; id?: CartridgeId };
}

export interface PixelAtelierPlatformApi {
  getMode(): PixerPlatformMode;
  setMode(mode: PixerPlatformMode): void;
  loadLegacyPack(): Promise<number>;
  isLegacyPackLoaded(): boolean;
  getAtlasStats(): AtlasPoolStats | null;
}

export interface AgentBridgeOptions {
  onLoadCartridge?: (rawJson: unknown, opts?: LoadCartridgeOptions) => LoadCartridgeResult;
  studioSession?: StudioSession;
  ecsSession?: EcsStudioSession;
  workbenchApi?: () => PixelAtelierWorkbenchAgentApi | null;
  onCapturePreviewPng?: () => string | null;
  onGetPlatformMode?: () => PixerPlatformMode;
  onSetPlatformMode?: (mode: PixerPlatformMode) => void;
  onLoadLegacyPack?: () => Promise<number>;
  onIsLegacyPackLoaded?: () => boolean;
  onGetAtlasStats?: () => AtlasPoolStats;
  onSyncProjectSprites?: (proj: EcsProjectV2) => void;
}

export interface PixelAtelierAgentApi {
  readonly backendMode: 'static-client-no-server';
  readonly studio: PixelAtelierStudioAgentApi;
  readonly ecs: PixelAtelierEcsAgentApi;
  readonly platform: PixelAtelierPlatformApi;
  readonly workbench: PixelAtelierWorkbenchAgentApi;
  listCartridges(): CartridgeId[];
  getActiveCartridge(): CartridgeId;
  switchCartridge(id: CartridgeId): void;
  getObservation(): unknown;
  getUnifiedObservation(): UnifiedGameObservation;
  getLegalActions(): RpgMenuOption[];
  stepAction(actionId: string): RenderSceneSnapshot;
  autoPlaySteps(steps: number): { stepsExecuted: number; snapshot: RenderSceneSnapshot };
  loadDndModuleJson(jsonSource: string): string | null;
  loadCartridge(rawJson: unknown, opts?: LoadCartridgeOptions): LoadCartridgeResult;
  adviseAction(): Promise<TacticalAdviceResult>;
  registerPlugin(def: CartridgePluginDefinition): () => void;
}

/**
 * Exposes structured Observation + Legal-Action + Auto-Play + AI Tactical Advice +
 * Plugin Registration + Studio 6.0 API + Pixer 7.0 True ECS & Dual-Mode Platform API
 * to both browser DevTools / external AI Agents (`window.__PIXEL_ATELIER_AGENT__`) and Node headless tests.
 */
export function createAgentBridge(
  runner: CartridgeRunner,
  aiDirector: HybridAiDirector = new HybridAiDirector(runner.events),
  onLoadCartridgeOrOpts?:
    | ((rawJson: unknown, opts?: LoadCartridgeOptions) => LoadCartridgeResult)
    | AgentBridgeOptions,
): PixelAtelierAgentApi {
  const bridgeOpts: AgentBridgeOptions =
    typeof onLoadCartridgeOrOpts === 'function'
      ? { onLoadCartridge: onLoadCartridgeOrOpts }
      : (onLoadCartridgeOrOpts ?? {});
  const onLoadCartridge = bridgeOpts.onLoadCartridge;
  let studioSession: StudioSession | null = bridgeOpts.studioSession ?? null;
  const getStudioSession = (): StudioSession => {
    if (!studioSession) {
      studioSession = new StudioSession('parkour_flagship');
    }
    return studioSession;
  };
  const ecsSession = bridgeOpts.ecsSession ?? null;

  const getTurnKernel = (): TurnKernelContract | null => {
    const inst = runner.getInstance();
    return isTurnCapableCartridge(inst) ? inst.getKernel() : null;
  };

  const loadCartridgeFn = (rawJson: unknown, opts?: LoadCartridgeOptions): LoadCartridgeResult => {
    if (onLoadCartridge) return onLoadCartridge(rawJson, opts);
    let parsed: unknown = rawJson;
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        return { ok: false, errors: ['JSON 語法解析失敗'] };
      }
    }
    const valid = validateCartridgeJson(parsed);
    if (!valid.ok) return { ok: false, errors: valid.errors };
    const id = opts?.customId ?? (valid.data.meta.id.startsWith('custom-') ? valid.data.meta.id : `custom-${valid.data.meta.id}`);
    const cartridge = JSON.parse(JSON.stringify(valid.data));
    cartridge.meta.id = id;
    registerCartridgePlugin({
      meta: {
        id,
        code: cartridge.meta.code || 'CUS',
        title: cartridge.meta.title,
        subtitle: cartridge.meta.subtitle ?? '自訂平台冒險',
        genre: cartridge.meta.genre === 'shmup' ? '自製射擊' : '自製平台',
        accentHex: opts?.accentHex ?? '#ff708d',
        badgeText: '自製 / Polaroid 卡匣',
        controlsHint: '方向移動 · B 跳躍 · A 動作 · L 重試',
        goalHint: cartridge.meta.title,
        defaultScript: '',
      },
      cartridgeJson: cartridge,
      factory: () => new DataCartridgeRuntime(cartridge),
    });
    if (opts?.mount !== false) runner.switchCartridge(id);
    return { ok: true, id, title: cartridge.meta.title, cartridge };
  };

  const studioApi: PixelAtelierStudioAgentApi = {
    dispatch: (cmd) => getStudioSession().dispatch(cmd),
    batch: (cmds, label) => getStudioSession().batch(cmds, label),
    undo: () => getStudioSession().undo(),
    redo: () => getStudioSession().redo(),
    canUndo: () => getStudioSession().canUndo(),
    canRedo: () => getStudioSession().canRedo(),
    getRevision: () => getStudioSession().getRevision(),
    getDocument: () => getStudioSession().getDocument(),
    getHistory: () => getStudioSession().getHistory(),
    playtest: (opts) => getStudioSession().playtest(opts),
    inspectVisual: (frames) => getStudioSession().inspectVisual(frames),
    capturePreviewPng: () => (bridgeOpts.onCapturePreviewPng ? bridgeOpts.onCapturePreviewPng() : null),
    mountToConsole: (opts) => loadCartridgeFn(getStudioSession().getDocument(), { mount: true, ...opts }),
    loadFromActiveCartridge: () => {
      const session = getStudioSession();
      const activeId = runner.getCartridgeId();
      const activeJson = getCartridgeJson(activeId);
      if (!activeJson) {
        return {
          ok: false,
          revision: session.getRevision(),
          summary: `目前卡匣「${activeId}」非資料驅動 JSON 卡匣`,
          errors: [`Cartridge '${activeId}' does not expose CartridgeJsonV1`],
        };
      }
      return session.loadDocument(activeJson);
    },
  };

  const ecsApi: PixelAtelierEcsAgentApi = {
    dispatch: (cmd) =>
      ecsSession
        ? ecsSession.dispatch(cmd)
        : { ok: false, revision: 0, summary: 'ECS Session 未初始化', errors: ['No EcsStudioSession bound'] },
    batch: (cmds, label) =>
      ecsSession
        ? ecsSession.dispatchBatch(cmds, label)
        : { ok: false, revision: 0, summary: 'ECS Session 未初始化', errors: ['No EcsStudioSession bound'] },
    undo: () =>
      ecsSession
        ? ecsSession.undo()
        : { ok: false, revision: 0, summary: 'ECS Session 未初始化', errors: ['No EcsStudioSession bound'] },
    redo: () =>
      ecsSession
        ? ecsSession.redo()
        : { ok: false, revision: 0, summary: 'ECS Session 未初始化', errors: ['No EcsStudioSession bound'] },
    getRevision: () => ecsSession?.getRevision() ?? 0,
    getProject: () => ecsSession?.getProject() ?? null,
    getHistory: () => ecsSession?.getHistory() ?? [],
    listAttachableComponents: () => ECS_ATTACHABLE_COMPONENTS,
    listPrefabs: () => ecsSession?.listPrefabs() ?? [],
    listCustomSprites: () => ecsSession?.listCustomSprites() ?? [],
    listModels3D: () => ecsSession?.listModels3D() ?? [],
    describeGrammar: () => {
      const proj = ecsSession?.getProject();
      const merged = new Map(CASTLE_TILE_REGISTRY.map((t) => [t.id, t]));
      if (proj?.worldMap?.tileDefs) {
        for (const td of proj.worldMap.tileDefs) merged.set(td.id, td);
      }
      return {
        commands: ECS_COMMAND_CATALOG,
        attachableComponents: ECS_ATTACHABLE_COMPONENTS,
        proceduralSpritePatterns: ECS_PROCEDURAL_SPRITE_PATTERNS,
        voxelShapes: ECS_VOXEL_SHAPES,
        customSprites: ecsSession?.listCustomSprites() ?? [],
        models3d: ecsSession?.listModels3D() ?? [],
        tiles: Array.from(merged.values()),
      };
    },
    getRoomAscii: (roomId) => (ecsSession ? renderRoomAscii(ecsSession.getProject(), roomId) : null),
    getRoomSliceAscii: (roomId, zLevel) =>
      ecsSession ? renderRoomSliceAscii(ecsSession.getProject(), roomId, zLevel) : null,
    analyzeWorldMap: () => (ecsSession ? analyzeWorldMapReachability(ecsSession.getProject()) : null),
    analyzeWorldMap3D: () => (ecsSession ? analyzeWorldMap3DReachability(ecsSession.getProject()) : null),
    observeSemantics: () => (ecsSession ? observeSceneSemantics(ecsSession.getProject()) : null),
    queryEntitiesInBox: (filter) => (ecsSession ? queryEntitiesInBox(ecsSession.getProject(), filter) : []),
    analyzeReachability: (opts) => (ecsSession ? analyzeActionReachability(ecsSession.getProject(), opts) : null),
    critiqueCutscene: (cutsceneId) =>
      ecsSession ? critiqueCutsceneAesthetics(ecsSession.getProject(), cutsceneId) : null,
    playtest: (frames) => ecsSession?.runHeadlessPlaytest(frames) ?? null,
    runScriptedPlaytest: (plan) => (ecsSession ? runScriptedPlaytest(ecsSession.getProject(), plan) : null),
    getEventGraph: (scriptId) => {
      if (!ecsSession) return null;
      const proj = ecsSession.getProject();
      const sc = proj.scripts[scriptId];
      if (!sc) return null;
      return compileScriptToEventGraph(sc, proj.graphLayouts?.[scriptId]);
    },
    applyEventGraph: (graph) => {
      if (!ecsSession) {
        return { ok: false, revision: 0, summary: 'ECS Session 未初始化', errors: ['No EcsStudioSession bound'] };
      }
      const compiled = compileEventGraphToScript(graph);
      return ecsSession.dispatch({
        type: 'upsert_script',
        script: compiled.script,
        graphLayout: compiled.layout,
      });
    },
    importExternalMap: (opts) => {
      if (!ecsSession) {
        return { ok: false, revision: 0, summary: 'ECS Session 未初始化', errors: ['No EcsStudioSession bound'] };
      }
      const detected = opts.format && opts.format !== 'auto' ? opts.format : detectJsonInteropFormat(opts.jsonText);
      if (detected !== 'ldtk' && detected !== 'tiled') {
        return {
          ok: false,
          revision: ecsSession.getRevision(),
          summary: '無法辨識外部地圖格式',
          errors: [`Unsupported format: ${String(detected)}`],
        };
      }
      try {
        const emptyAssets = new Map<string, DecodedPngImage>();
        const parsed =
          detected === 'ldtk'
            ? parseLdtkProject(opts.jsonText, emptyAssets, opts.sourceName ?? `import.${detected}`, {
                wallExtrudeH: opts.wallExtrudeH,
              })
            : parseTiledMap(opts.jsonText, emptyAssets, opts.sourceName ?? 'import.tmj', {
                wallExtrudeH: opts.wallExtrudeH,
              });
        const cmds = buildInteropStudioCommands(parsed, ecsSession.getProject(), {
          replaceWorldMap: opts.replaceWorldMap !== false,
          wallExtrudeH: opts.wallExtrudeH,
        });
        const res = ecsSession.dispatchBatch(cmds, `外部匯入 ${parsed.sourceName}`);
        if (res.ok) {
          bridgeOpts.onSyncProjectSprites?.(ecsSession.getProject());
          return {
            ...res,
            reachability: analyzeWorldMapReachability(ecsSession.getProject()),
            warnings: parsed.warnings,
          };
        }
        return res;
      } catch (err) {
        return {
          ok: false,
          revision: ecsSession.getRevision(),
          summary: '外部地圖解析失敗',
          errors: [err instanceof Error ? err.message : String(err)],
        };
      }
    },
    installAssetPack: (input, opts) => {
      if (!ecsSession) {
        return { ok: false, revision: 0, summary: 'ECS Session 未初始化', errors: ['No EcsStudioSession bound'] };
      }
      let pack: PixerAssetPackManifest;
      if (typeof input === 'string') {
        if (input !== 'horror' && input !== 'visual_novel' && input !== 'dungeon') {
          return {
            ok: false,
            revision: ecsSession.getRevision(),
            summary: '未知內建資產包類型',
            errors: [`Unknown builtin starter pack genre: ${String(input)}`],
          };
        }
        pack = buildBuiltinStarterPack(input);
      } else {
        const valid = validateAssetPackManifest(input);
        if (!valid.ok) {
          return {
            ok: false,
            revision: ecsSession.getRevision(),
            summary: '資產包驗證失敗',
            errors: valid.errors,
          };
        }
        pack = valid.pack;
      }
      const cmds = buildAssetPackInstallCommands(pack, ecsSession.getProject(), {
        applyAtmosphere: opts?.applyAtmosphere === true,
      });
      const res = ecsSession.dispatchBatch(cmds, `安裝資產包：${pack.name}`);
      if (res.ok) {
        bridgeOpts.onSyncProjectSprites?.(ecsSession.getProject());
        return {
          ...res,
          packId: pack.id,
          sprites: pack.sprites.length,
          tileDefs: pack.tileDefs?.length ?? 0,
          prefabs: pack.prefabs ? Object.keys(pack.prefabs).length : 0,
        };
      }
      return res;
    },
    exportAssetPack: (meta) => {
      if (!ecsSession) return null;
      return exportProjectAsAssetPack(ecsSession.getProject(), {
        id: meta?.id,
        name: meta?.name,
        genre: meta?.genre,
        description: meta?.description ?? (meta?.author ? `Author: ${meta.author}` : undefined),
      });
    },
    mountToConsole: () => {
      if (!ecsSession) return { ok: false };
      const proj = ecsSession.getProject();
      bridgeOpts.onSyncProjectSprites?.(proj);
      registerCartridgePlugin({
        meta: {
          id: proj.meta.id,
          code: proj.meta.code,
          title: proj.meta.title,
          subtitle: proj.meta.subtitle,
          genre: proj.meta.genre,
          accentHex: proj.meta.accentHex,
          badgeText: `${proj.viewport.width}×${proj.viewport.height} · 真 ECS 運行時`,
          controlsHint: proj.meta.controlsHint,
          goalHint: proj.meta.goalHint,
          defaultScript: '',
        },
        factory: () => new EcsCartridgeRuntime(proj),
      });
      runner.switchCartridge(proj.meta.id);
      return { ok: true, id: proj.meta.id };
    },
  };

  const platformApi: PixelAtelierPlatformApi = {
    getMode: () => (bridgeOpts.onGetPlatformMode ? bridgeOpts.onGetPlatformMode() : 'arcade'),
    setMode: (mode) => bridgeOpts.onSetPlatformMode?.(mode),
    loadLegacyPack: () => (bridgeOpts.onLoadLegacyPack ? bridgeOpts.onLoadLegacyPack() : Promise.resolve(0)),
    isLegacyPackLoaded: () => (bridgeOpts.onIsLegacyPackLoaded ? bridgeOpts.onIsLegacyPackLoaded() : false),
    getAtlasStats: () => (bridgeOpts.onGetAtlasStats ? bridgeOpts.onGetAtlasStats() : null),
  };

  const getWorkbench = (): PixelAtelierWorkbenchAgentApi | null =>
    bridgeOpts.workbenchApi ? bridgeOpts.workbenchApi() : null;

  const workbenchApi: PixelAtelierWorkbenchAgentApi = {
    isMounted: () => getWorkbench()?.isMounted() ?? false,
    getState: () => getWorkbench()?.getState() ?? null,
    setSelection: (entityIds) => getWorkbench()?.setSelection(entityIds) ?? [],
    focusSelection: () => getWorkbench()?.focusSelection() ?? false,
    focusEntity: (entityId) => getWorkbench()?.focusEntity(entityId) ?? false,
    setActiveRoom: (roomId) => getWorkbench()?.setActiveRoom(roomId) ?? false,
    setActiveZLevel: (zLevel) => getWorkbench()?.setActiveZLevel(zLevel) ?? 0,
    setSliceCutaway: (mode) => getWorkbench()?.setSliceCutaway(mode) ?? 'all',
    setTool: (tool) => getWorkbench()?.setTool(tool) ?? 'select',
    setGizmoMode: (mode) => getWorkbench()?.setGizmoMode(mode) ?? 'move',
    setLayer: (layer) => getWorkbench()?.setLayer(layer) ?? 'ground',
    setSnapStep: (stepPx) => getWorkbench()?.setSnapStep(stepPx) ?? 0,
    setEditorCamera: (x, y, zoom) => getWorkbench()?.setEditorCamera(x, y, zoom) ?? false,
    resetEditorCamera: () => getWorkbench()?.resetEditorCamera() ?? false,
    setViewMode: (view) => getWorkbench()?.setViewMode(view) ?? false,
    setSimRunning: (running) => getWorkbench()?.setSimRunning(running) ?? false,
    captureViewportPng: () => getWorkbench()?.captureViewportPng() ?? null,
  };

  return {
    backendMode: 'static-client-no-server',
    studio: studioApi,
    ecs: ecsApi,
    platform: platformApi,
    workbench: workbenchApi,
    listCartridges: () => listCartridgeIds(),
    getActiveCartridge: () => runner.getCartridgeId(),
    switchCartridge: (id) => runner.switchCartridge(id),
    getObservation: () => {
      const k = getTurnKernel();
      if (k) return k.getObservation();
      return serializeCartridgeObservation(runner);
    },
    getUnifiedObservation: () => serializeCartridgeObservation(runner),
    getLegalActions: () => {
      const k = getTurnKernel();
      if (k) return k.getLegalActions();
      return serializeCartridgeObservation(runner).legalActions;
    },
    stepAction: (actionId) => {
      runner.dispatchCommand(actionId);
      return runner.getSnapshot();
    },
    autoPlaySteps: (steps) => {
      const k = getTurnKernel();
      if (!k) return { stepsExecuted: 0, snapshot: runner.getSnapshot() };
      let executed = 0;
      const limit = Math.max(1, Math.min(2500, Math.round(steps)));
      for (let i = 0; i < limit; i++) {
        if (k.getStatus() !== 'playing') break;
        const obs = k.getObservation();
        if (obs.combat?.turnOwner === 'enemy') {
          const blank = createEmptyInputState();
          for (let sub = 0; sub < 6 && k.getObservation().combat?.turnOwner === 'enemy'; sub++) {
            runner.stepFixed(0.15, blank);
          }
          executed++;
          continue;
        }
        const next = k.suggestAgentAction();
        if (!next) break;
        runner.dispatchCommand(next);
        executed++;
      }
      return { stepsExecuted: executed, snapshot: runner.getSnapshot() };
    },
    loadDndModuleJson: (jsonSource) => runner.applyDndModuleJson(jsonSource),
    loadCartridge: loadCartridgeFn,
    adviseAction: () =>
      aiDirector.adviseTacticalAction({
        observation: serializeCartridgeObservation(runner),
      }),
    registerPlugin: (def) => {
      const dispose = registerCartridgePlugin(def);
      runner.events.emit('plugin:registered', { cartridgeId: def.meta.id, title: def.meta.title });
      return dispose;
    },
  };
}
