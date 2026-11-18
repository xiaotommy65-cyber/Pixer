import {
  listCartridgeIds,
  registerCartridgePlugin,
  type CartridgePluginDefinition,
} from '../runtime/CartridgeRegistry.ts';
import type { CartridgeRunner } from '../runtime/CartridgeRunner.ts';
import type { LoadCartridgeOptions, LoadCartridgeResult } from '../runtime/EngineHost.ts';
import { validateCartridgeJson } from '../sim/CartridgeSchema.ts';
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
import { serializeCartridgeObservation, type UnifiedGameObservation } from './ObservationSerializer.ts';

export interface PixelAtelierAgentApi {
  readonly backendMode: 'static-client-no-server';
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
 * Exposes structured Observation + Legal-Action + Auto-Play + AI Tactical Advice + Plugin Registration
 * to both browser DevTools / external AI Agents (`window.__PIXEL_ATELIER_AGENT__`) and Node headless tests.
 */
export function createAgentBridge(
  runner: CartridgeRunner,
  aiDirector: HybridAiDirector = new HybridAiDirector(runner.events),
  onLoadCartridge?: (rawJson: unknown, opts?: LoadCartridgeOptions) => LoadCartridgeResult,
): PixelAtelierAgentApi {
  const getTurnKernel = (): TurnKernelContract | null => {
    const inst = runner.getInstance();
    return isTurnCapableCartridge(inst) ? inst.getKernel() : null;
  };

  return {
    backendMode: 'static-client-no-server',
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
    loadCartridge: (rawJson, opts) => {
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
    },
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
