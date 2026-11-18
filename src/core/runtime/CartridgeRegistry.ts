import { SANDBOX_DEFAULT_SCRIPT } from '../../assets/WorkshopRecipes.ts';
import type {
  AiCapabilityFlag,
  CartridgeControlProfile,
  CartridgeId,
  CartridgeInstance,
  CartridgeMeta,
  RenderSceneSnapshot,
  RuntimeParams,
} from '../types/WorldTypes.ts';

export interface CartridgeLaunchContext {
  sandboxScript: string;
  dndModuleJson?: string;
  params: RuntimeParams;
}

export type CartridgeFactory = (ctx: CartridgeLaunchContext) => CartridgeInstance;

export interface CartridgePluginDefinition {
  meta: CartridgeMeta;
  factory: CartridgeFactory;
  aiCapabilities?: readonly AiCapabilityFlag[];
  resolveControlProfile?: (snap?: RenderSceneSnapshot) => CartridgeControlProfile;
}

export const HOME_CONTROL_PROFILE: CartridgeControlProfile = {
  a: '確認',
  b: '返回',
  x: '選單',
  y: '機能',
  l: '上頁',
  r: '下頁',
  rightStick: '預覽',
  legend: '點選或拖曳下方遊戲卡匣插入主機 · 可用實體手把 / 觸控滑按 / 鍵盤操作',
};

export const DEFAULT_PLUGIN_CONTROL_PROFILE: CartridgeControlProfile = {
  a: '動作',
  b: '跳/返',
  x: '選單',
  y: '技能',
  l: '重試',
  r: '副攻',
  rightStick: '視野',
  legend: '外掛卡帶通用配置 · A 動作 · B 跳躍 · X 選單 · Y 技能',
};

const PLUGIN_REGISTRY = new Map<CartridgeId, CartridgePluginDefinition>();

export const CARTRIDGES: CartridgeMeta[] = [];

function syncCartridgeMetaList(): void {
  CARTRIDGES.length = 0;
  for (const plugin of PLUGIN_REGISTRY.values()) {
    CARTRIDGES.push(plugin.meta);
  }
}

export function registerCartridgePlugin(def: CartridgePluginDefinition): () => void {
  PLUGIN_REGISTRY.set(def.meta.id, def);
  syncCartridgeMetaList();
  return () => unregisterCartridgePlugin(def.meta.id);
}

export function unregisterCartridgePlugin(id: CartridgeId): boolean {
  const removed = PLUGIN_REGISTRY.delete(id);
  if (removed) syncCartridgeMetaList();
  return removed;
}

export function registerCartridgeFactory(id: CartridgeId, factory: CartridgeFactory): void {
  const existing = PLUGIN_REGISTRY.get(id);
  if (existing) {
    PLUGIN_REGISTRY.set(id, { ...existing, factory });
    return;
  }
  registerCartridgePlugin({
    meta: {
      id,
      code: 'EXT',
      title: String(id),
      subtitle: '自訂擴充卡帶',
      genre: '擴充模組',
      accentHex: '#5ec2f7',
      badgeText: 'Plugin Cartridge',
      controlsHint: DEFAULT_PLUGIN_CONTROL_PROFILE.legend,
      goalHint: '自訂外掛卡帶模組',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    factory,
  });
}

export function getCartridgePlugin(id: CartridgeId): CartridgePluginDefinition | undefined {
  return PLUGIN_REGISTRY.get(id);
}

export function listCartridgeIds(): CartridgeId[] {
  return Array.from(PLUGIN_REGISTRY.keys());
}

export function listCartridgeMetas(): readonly CartridgeMeta[] {
  return CARTRIDGES;
}

export function createCartridgeInstance(id: CartridgeId, ctx: CartridgeLaunchContext): CartridgeInstance {
  const plugin =
    PLUGIN_REGISTRY.get(id) ?? PLUGIN_REGISTRY.get('cloudberry-hop') ?? PLUGIN_REGISTRY.values().next().value;
  if (!plugin) {
    throw new Error(`No cartridge plugins registered when launching "${String(id)}"`);
  }
  return plugin.factory(ctx);
}

export function getCartridgeMeta(id: CartridgeId): CartridgeMeta {
  const fallback: CartridgeMeta = CARTRIDGES[0] ?? {
    id,
    code: 'EXT',
    title: String(id),
    subtitle: '未註冊卡匣',
    genre: '擴充模組',
    accentHex: '#5ec2f7',
    badgeText: 'Unregistered',
    controlsHint: DEFAULT_PLUGIN_CONTROL_PROFILE.legend,
    goalHint: '',
    defaultScript: SANDBOX_DEFAULT_SCRIPT,
  };
  return PLUGIN_REGISTRY.get(id)?.meta ?? fallback;
}

export function shouldBypassTouchActionAutofire(id: CartridgeId | null): boolean {
  if (!id) return false;
  return Boolean(PLUGIN_REGISTRY.get(id)?.meta.preserveActionHold);
}

export function getCartridgeControlProfile(
  id: CartridgeId | null,
  snap?: RenderSceneSnapshot,
): CartridgeControlProfile {
  if (!id) return HOME_CONTROL_PROFILE;
  const plugin = PLUGIN_REGISTRY.get(id);
  if (plugin?.resolveControlProfile) {
    return plugin.resolveControlProfile(snap);
  }
  return DEFAULT_PLUGIN_CONTROL_PROFILE;
}
