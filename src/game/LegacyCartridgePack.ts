import { SANDBOX_DEFAULT_SCRIPT } from '../assets/WorkshopRecipes.ts';
import { registerDndCampaignGenerator } from '../core/ai/LocalAiProvider.ts';
import {
  registerCartridgePlugin,
  type CartridgePluginDefinition,
} from '../core/runtime/CartridgeRegistry.ts';
import type { CartridgeJsonV1 } from '../core/sim/CartridgeSchema.ts';
import { AstralChroniclesGame } from './astralChronicles/AstralChroniclesGame.ts';
import { CelestialParkourGame } from './celestialParkour/CelestialParkourGame.ts';
import celestialParkourJson from './celestialParkour/celestialParkour.cartridge.json' with { type: 'json' };
import { generateEmberkeepCampaign, verifyModuleSolvability } from './emberkeep/DungeonGenerator.ts';
import { DEFAULT_DND_MODULE_JSON, EmberkeepDndGame } from './emberkeep/EmberkeepDndGame.ts';
import { LabyrinthDualviewGame } from './labyrinthDualview/LabyrinthDualviewGame.ts';
import { SandboxToyboxGame } from './sandbox/SandboxToyboxGame.ts';

export const LEGACY_DND_DEFAULT_MODULE_JSON = DEFAULT_DND_MODULE_JSON;

/**
 * Isolated Legacy Classic Cartridge Pack (PA-03, PA-04, PA-05, PA-06, PA-09).
 * Code-split into its own lazy-loaded Vite chunk so Pixer 7.0 Core + Studio boots lean
 * without downloading ~10k lines of hand-written legacy cartridge TypeScript.
 */
export const LEGACY_CLASSIC_PLUGINS: readonly CartridgePluginDefinition[] = [
  {
    meta: {
      id: 'sandbox-toybox',
      code: 'PA-03',
      title: '積木秘密基地',
      subtitle: '10 關解謎 × 創作沙盒',
      genre: '經典典藏 · 解謎',
      accentHex: '#56d39c',
      badgeText: '經典包 · 10 關機關 × 傳送門',
      controlsHint: '← → 推箱・B 跳躍・A/R 火花・Y 遙控引爆・X 線索／配方・L 重置',
      goalHint: '挑戰 10 關傳送門／移動浮橋／爆破謎題，或在積木工房自製關卡！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
      isLegacyPack: true,
    },
    aiCapabilities: ['stage-gen', 'sprite-gen', 'tactical-advisor'],
    factory: (ctx) => new SandboxToyboxGame(ctx.sandboxScript, ctx.params),
    resolveControlProfile: () => ({
      a: '火花',
      b: '跳躍',
      x: '線索/方',
      y: '遙控爆',
      l: '重置',
      r: '火花',
      rightStick: '視野',
      legend: 'L 重置本關 · X 機關提示/配方 · Y 遙控引爆 · B 跳躍 · A/R 火花 · 右搖桿預覽',
    }),
  },
  {
    meta: {
      id: 'emberkeep-dnd',
      code: 'PA-04',
      title: '龍與地城：餘燼',
      subtitle: '8 層混合生成 CRPG',
      genre: '經典典藏 · CRPG',
      accentHex: '#e0aaff',
      badgeText: '經典包 · 8 層地下城 × d20',
      controlsHint: '方向移動・A 執行・B 切指令・Y 喝藥水・X 開關 AI 託管・L/R 上下指令',
      goalHint: '深入 B1～B8 餘燼深淵，裝備神兵戰勝商人與典獄長，斬殺餘燼龍王！',
      defaultScript: DEFAULT_DND_MODULE_JSON,
      isLegacyPack: true,
    },
    aiCapabilities: ['stage-gen', 'dialog', 'tactical-advisor'],
    factory: (ctx) => new EmberkeepDndGame(ctx.dndModuleJson),
    resolveControlProfile: (snap) => {
      const mode = snap?.rpgHud?.mode;
      if (mode === 'combat' || mode === 'dialog') {
        return {
          a: '確認',
          b: '確定',
          x: 'AI託管',
          y: '喝藥水',
          l: '上選項',
          r: '下選項',
          rightStick: '滾動',
          legend: '方向/L/R 選指令 · A/B 確認 · Y 喝藥水 · X 開關 AI 託管',
        };
      }
      return {
        a: '執行',
        b: '換指令',
        x: 'AI託管',
        y: '喝藥水',
        l: '上指令',
        r: '下指令',
        rightStick: '選指令',
        legend: '方向移動 · A 執行指令 · B/L/R 切動作 · Y 喝藥水 · X 開關 AI 託管',
      };
    },
  },
  {
    meta: {
      id: 'astral-chronicles',
      code: 'PA-05',
      title: '星穹餘燼編年史',
      subtitle: '五章節運鏡 × 動作 RPG 大作',
      genre: '經典典藏 · 動作 RPG',
      accentHex: '#ffd447',
      badgeText: '經典包 · 5 大章節 × 鏡頭運鏡',
      controlsHint: '方向移動・A 斬擊互動・B 閃避・Y 遺物技・X 暫停選單・L 地圖・R 藥水',
      goalHint: '橫跨五大星穹領域，升級鍛造神兵、解鎖星界封印與大地圖，討伐星穹蝕龍皇！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
      isLegacyPack: true,
    },
    aiCapabilities: ['dialog', 'tactical-advisor'],
    factory: () => new AstralChroniclesGame(),
    resolveControlProfile: (snap) => {
      const uiMode = snap?.chronicleHud?.uiMode;
      if (uiMode === 'PAUSED') {
        return {
          a: '裝備/買',
          b: '返回',
          x: '繼續',
          y: '喝藥水',
          l: '上分頁',
          r: '下分頁',
          rightStick: '選單',
          legend: 'L/R 切換 4 大分頁 · ↑↓ 選裝備 · A 鍛造/換裝 · B/X 返回冒險',
        };
      }
      if (uiMode === 'WORLD_MAP' || uiMode === 'TITLE_MENU' || uiMode === 'CUTSCENE') {
        return {
          a: '確認',
          b: '返回',
          x: '切換頁',
          y: '大地圖',
          l: '上章',
          r: '下章',
          rightStick: '選擇',
          legend: '方向/L/R 選擇 · A 確認/對話 · B 返回標題 · Y 大地圖',
        };
      }
      return {
        a: '斬/互動',
        b: '閃避',
        x: '選單',
        y: '遺物技',
        l: '大地圖',
        r: '喝藥水',
        rightStick: '環顧',
        legend: 'L 大地圖 · X 暫停選單 · Y 遺物奧義 · R 喝藥水 · B 閃避 · A 斬擊 · 右搖桿環顧',
      };
    },
  },
  {
    meta: {
      id: 'celestial-parkour',
      code: 'PA-06',
      title: '緋空殘響：飛鉤跑酷',
      subtitle: '360° 飛鉤擺盪 × 極限跑酷',
      genre: '經典典藏 · 飛鉤跑酷',
      accentHex: '#ff5d8f',
      badgeText: '經典包 · 5 大試煉 × 雙模飛鉤',
      controlsHint: '方向移動／滑鼠右搖桿360°瞄準・左鍵/Y 擺盪・右鍵/R 牽引・B 跳躍/甩射・A 八向衝刺・L 重試',
      goalHint: '駕馭 360° 雙模式飛鉤、波動衝刺與蹬牆連跳，穿越亂流風暴與雙骨 IK 巨爪追擊突破 5 大試煉！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
      preserveActionHold: true,
      isLegacyPack: true,
    },
    cartridgeJson: celestialParkourJson as unknown as CartridgeJsonV1,
    factory: () => new CelestialParkourGame(),
    resolveControlProfile: () => ({
      a: '8向衝刺',
      b: '跳躍/甩',
      x: '遠眺',
      y: '擺盪/左鍵',
      l: '重試',
      r: '牽引/右鍵',
      rightStick: '滑鼠/360°瞄',
      legend: 'L 重試 · X 遠眺 · Y/左鍵 飛鉤擺盪 · R/右鍵 飛鉤牽引 · B 跳躍/甩射 · A 8向衝刺 · 滑鼠/右搖桿360°瞄準',
    }),
  },
  {
    meta: {
      id: 'labyrinth-dualview',
      code: 'PA-09',
      title: '迴廊雙界',
      subtitle: '1P 2.5D 透視 ↔ 3P HD-2D 瞬間切換',
      genre: '經典典藏 · 雙視角迷宮',
      accentHex: '#38bdf8',
      badgeText: '經典包 · 2.5D DDA 射線 × 看板',
      controlsHint: '方向移動/轉向・X 瞬間切換 1P↔3P・A 聖燈斬擊・L/R 第一人稱側移',
      goalHint: '在單一迷宮中隨時按 X 無縫切換第一人稱 2.5D 與第三人稱 HD-2D，觸發 2 座星紋機關開啟出口！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
      isLegacyPack: true,
    },
    factory: () => new LabyrinthDualviewGame(),
    resolveControlProfile: () => ({
      a: '聖燈斬',
      b: '互動',
      x: '1P↔3P',
      y: '重試',
      l: '左平移',
      r: '右平移',
      rightStick: '轉向',
      legend: 'X 隨時切換 1P 2.5D ↔ 3P HD-2D · A 聖燈斬 · ↑↓前進/後退 · ←→轉向 · L/R 側移',
    }),
  },
];

let legacyRegistered = false;

export function registerLegacyCartridgePack(): readonly CartridgePluginDefinition[] {
  if (legacyRegistered) return LEGACY_CLASSIC_PLUGINS;
  legacyRegistered = true;

  for (const plugin of LEGACY_CLASSIC_PLUGINS) {
    registerCartridgePlugin(plugin);
  }

  registerDndCampaignGenerator((seed) => {
    const mod = generateEmberkeepCampaign(seed);
    const valid = verifyModuleSolvability(mod);
    return {
      payload: JSON.stringify(mod, null, 2),
      summary: `8 層地下城生成器（可解性驗證：${valid ? '通過' : '待定'}）`,
    };
  });

  return LEGACY_CLASSIC_PLUGINS;
}
