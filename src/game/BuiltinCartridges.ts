import { SANDBOX_DEFAULT_SCRIPT } from '../assets/WorkshopRecipes.ts';
import { registerDndCampaignGenerator } from '../core/ai/LocalAiProvider.ts';
import {
  registerCartridgePlugin,
  type CartridgePluginDefinition,
} from '../core/runtime/CartridgeRegistry.ts';
import { DataCartridgeRuntime } from '../core/sim/DataCartridgeRuntime.ts';
import { AstralChroniclesGame } from './astralChronicles/AstralChroniclesGame.ts';
import cloudberryJson from './cloudberry/cloudberry.cartridge.json' with { type: 'json' };
import { generateEmberkeepCampaign, verifyModuleSolvability } from './emberkeep/DungeonGenerator.ts';
import { DEFAULT_DND_MODULE_JSON, EmberkeepDndGame } from './emberkeep/EmberkeepDndGame.ts';
import { SandboxToyboxGame } from './sandbox/SandboxToyboxGame.ts';
import sugarStarlightJson from './sugarStarlight/sugarStarlight.cartridge.json' with { type: 'json' };

export const DND_DEFAULT_MODULE_JSON = DEFAULT_DND_MODULE_JSON;

export const BUILTIN_PLUGINS: readonly CartridgePluginDefinition[] = [
  {
    meta: {
      id: 'cloudberry-hop',
      code: 'PA-01',
      title: '草莓雲海跳跳',
      subtitle: '4 大世界 8 關卡冒險',
      genre: '平台冒險',
      accentHex: '#ff708d',
      badgeText: '8 關 × 二段跳／空中衝刺',
      controlsHint: '方向移動・B 跳躍・A 衝刺火花・Y 聚能脈衝・X 遠眺・L 重試',
      goalHint: '跨越 4 大空島 8 關卡收集 24 顆星，擊敗巨大史萊姆王！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    aiCapabilities: ['tactical-advisor'],
    factory: () => new DataCartridgeRuntime(cloudberryJson),
    resolveControlProfile: () => ({
      a: '火花/衝',
      b: '跳躍',
      x: '遠眺',
      y: '脈衝',
      l: '重試',
      r: '衝刺',
      rightStick: '窺探',
      legend: 'L 重試 · X 遠眺 · Y 火花脈衝 · B 跳躍 · A/R 衝刺 · 右搖桿窺探',
    }),
  },
  {
    meta: {
      id: 'sugar-starlight',
      code: 'PA-02',
      title: '糖霜流星號',
      subtitle: '雙模選機 × 三色彈幕戰役',
      genre: '橫向射擊',
      accentHex: '#5ec2f7',
      badgeText: '3 戰機 × 三色武裝 × Bomb',
      controlsHint: '方向移動・B/R 連射・長按 A 蓄力必殺・X 換武裝・Y 放 Bomb・L 重試',
      goalHint: '機庫選機出擊！切換紅散／藍貫／紫追蹤武裝，善用擦彈護盾反擊與弱點破防擊敗四大星區 Boss！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
      preserveActionHold: true,
    },
    aiCapabilities: ['tactical-advisor'],
    factory: () => new DataCartridgeRuntime(sugarStarlightJson),
    resolveControlProfile: (snap) => {
      if (snap?.shmupHud?.phase === 'hangar') {
        return {
          a: '出擊',
          b: '昇空',
          x: '切戰機',
          y: '機體詳',
          l: '上機',
          r: '下機',
          rightStick: '選機',
          legend: '方向/L/R/X 切換戰機 · A/B 確認出擊昇空',
        };
      }
      return {
        a: '蓄力束',
        b: '連射',
        x: '切武裝',
        y: '核爆',
        l: '重試',
        r: '連發',
        rightStick: '集火角',
        legend: 'L 重試 · X 切紅藍紫武裝 · Y 放 Bomb · B/R 連射 · 長按 A 蓄力 · 右搖桿集火',
      };
    },
  },
  {
    meta: {
      id: 'sandbox-toybox',
      code: 'PA-03',
      title: '積木秘密基地',
      subtitle: '10 關解謎 × 創作沙盒',
      genre: '解謎／創作',
      accentHex: '#56d39c',
      badgeText: '10 關機關 × 傳送門 × 腳本',
      controlsHint: '← → 推箱・B 跳躍・A/R 火花・Y 遙控引爆・X 線索／配方・L 重置',
      goalHint: '挑戰 10 關傳送門／移動浮橋／爆破謎題，或在積木工房自製關卡！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
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
      genre: 'CRPG 迷宮',
      accentHex: '#e0aaff',
      badgeText: '8 層地下城 × d20 × AI',
      controlsHint: '方向移動・A 執行・B 切指令・Y 喝藥水・X 開關 AI 託管・L/R 上下指令',
      goalHint: '深入 B1～B8 餘燼深淵，裝備神兵戰勝商人與典獄長，斬殺餘燼龍王！',
      defaultScript: DEFAULT_DND_MODULE_JSON,
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
      genre: '動作冒險 RPG',
      accentHex: '#ffd447',
      badgeText: '5 大章節 × 鏡頭運鏡 × 全 UI 選單',
      controlsHint: '方向移動・A 斬擊互動・B 閃避・Y 遺物技・X 暫停選單・L 地圖・R 藥水',
      goalHint: '橫跨五大星穹領域，升級鍛造神兵、解鎖星界封印與大地圖，討伐星穹蝕龍皇！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
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
];

let builtinsRegistered = false;

/**
 * Registers all 5 first-party cartridges and the Emberkeep procedural campaign generator
 * into src/core/ registries, preserving strict one-way game -> core dependency inversion.
 */
export function registerBuiltinCartridges(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;

  for (const plugin of BUILTIN_PLUGINS) {
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
}
