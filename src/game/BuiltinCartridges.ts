import { SANDBOX_DEFAULT_SCRIPT } from '../assets/WorkshopRecipes.ts';
import { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import {
  registerCartridgePlugin,
  type CartridgePluginDefinition,
} from '../core/runtime/CartridgeRegistry.ts';
import type { CartridgeJsonV1 } from '../core/sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../core/sim/DataCartridgeRuntime.ts';
import { ASTRAL_RIFT_PROJECT } from './astralRift/AstralRiftProject.ts';
import cloudberryJson from './cloudberry/cloudberry.cartridge.json' with { type: 'json' };
import { EMERALD_RUINS_PROJECT } from './emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from './obsidianCitadel/ObsidianCitadelProject.ts';
import { RHYTHM_BASTION_PROJECT } from './rhythmBastion/RhythmBastionProject.ts';
import sugarStarlightJson from './sugarStarlight/sugarStarlight.cartridge.json' with { type: 'json' };

/**
 * Focused Core Cartridges (Zero legacy hand-written gameplay TS, Zero AI-audio rhythm bloat):
 * - PA-14 & PA-15: True ECS Multi-Room HD-2D Flagships (Obsidian Citadel & Emerald Ruins)
 * - PA-01 & PA-02: Pure JSON Flagship Favorites (Cloudberry Hop & Sugar Starlight)
 * - PA-11 & PA-12: True ECS Hybrid & Multi-Dimensional Showcase Templates
 */
export const CORE_DATA_PLUGINS: readonly CartridgePluginDefinition[] = [
  {
    meta: {
      id: 'obsidian-citadel',
      code: 'PA-14',
      title: '黑曜魔王城：赤月王座',
      subtitle: 'HD-2D 32×32 像素城塞 × 48×64 魔王王座 × 三廳探險',
      genre: 'HD-2D 魔王城旗艦',
      accentHex: '#ef4444',
      badgeText: '32px 多層地圖 · 48×64 魔王戰 · 動態火炬 PBR',
      controlsHint: '方向移動・A/J 揮劍斬擊・B/Space 翻滾衝刺・探索三廳討伐魔王馬拉科爾！',
      goalHint: '奪取外庭鑰匙寶箱開啟城門 → 彩窗長廊啟動雙機關 → 踏入赤月王座殿擊敗魔王！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    factory: () => new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT),
    resolveControlProfile: () => ({
      a: '揮劍斬擊',
      b: '翻滾衝刺',
      x: '視角',
      y: '互動',
      l: '重試',
      r: '地圖',
      rightStick: '視口',
      legend: '方向鍵移動 · A 揮劍斬擊 · B 翻滾衝刺 · L 重試 · 三廳捲動 HD-2D 魔王城',
    }),
  },
  {
    meta: {
      id: 'emerald-ruins',
      code: 'PA-15',
      title: '翠律遺跡：星露聖域',
      subtitle: '100% 專案自訂像素瓦片 × 雙廳遺跡 × 守護巨像',
      genre: 'HD-2D 自訂像素旗艦',
      accentHex: '#10b981',
      badgeText: '20 組自訂 Oklab PBR 貼圖 · 雙廳傳送門 · 守護巨像戰',
      controlsHint: '方向移動・A/J 揮劍斬擊・B/Space 翻滾衝刺・啟動遺跡石碑開啟星露聖域！',
      goalHint: '於林間外庭啟動雙星露石碑解鎖聖門 → 踏入星露聖域擊敗 48×64 守護巨像！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    factory: () => new EcsCartridgeRuntime(EMERALD_RUINS_PROJECT),
    resolveControlProfile: () => ({
      a: '揮劍斬擊',
      b: '翻滾衝刺',
      x: '視角',
      y: '互動',
      l: '重試',
      r: '地圖',
      rightStick: '視口',
      legend: '方向鍵移動 · A 揮劍斬擊 · B 翻滾衝刺 · L 重試 · 100% 自訂像素瓦片跨主題旗艦',
    }),
  },
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
    cartridgeJson: cloudberryJson as unknown as CartridgeJsonV1,
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
    cartridgeJson: sugarStarlightJson as unknown as CartridgeJsonV1,
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
      id: 'rhythm-bastion',
      code: 'PA-11',
      title: '星軌節奏塔防',
      subtitle: '640×360 HD-2D · 真 ECS 節奏×塔防混合',
      genre: 'ECS 範例',
      accentHex: '#f59e0b',
      badgeText: '真 ECS + 沙盒腳本 VM · 640×360 HD-2D',
      controlsHint: 'A 鍵打擊上軌星拍・B 鍵打擊下軌蒼拍・充能驅動自律星塔攔截虛空魔潮！',
      goalHint: '抓準金線節拍按下 A / B 充能，驅動三座星軌砲塔攔截 12 隻虛空入侵者守衛聖核！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    factory: () => new EcsCartridgeRuntime(RHYTHM_BASTION_PROJECT),
    resolveControlProfile: () => ({
      a: '上軌星拍',
      b: '下軌蒼拍',
      x: '檢視',
      y: '重試',
      l: '重試',
      r: '檢視',
      rightStick: '視口',
      legend: 'A 打擊上軌星拍 · B 打擊下軌蒼拍 · L 重試 · 640×360 HD-2D 真 ECS 運行時',
    }),
  },
  {
    meta: {
      id: 'astral-rift',
      code: 'PA-12',
      title: '時空裂隙：星界迴廊',
      subtitle: '640×360 HD-2D · 純 ECS 多維位面 × 飛鉤 × 事件圖',
      genre: 'ECS 範例',
      accentHex: '#38bdf8',
      badgeText: 'Spatial3D 位面切換 + 飛鉤動作 + 事件圖',
      controlsHint: '← → 移動・B 跳躍・A 鉤索擺盪・R 切換表裡世界・抵達右側星界傳送門！',
      goalHint: '收集表世界與裡世界星晶，按 R 切換維度顯現幽影星橋，飛鉤跨越裂隙抵達星門！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    factory: () => new EcsCartridgeRuntime(ASTRAL_RIFT_PROJECT),
    resolveControlProfile: () => ({
      a: '鉤索/衝刺',
      b: '跳躍',
      x: '視角',
      y: '互動',
      l: '重試',
      r: '表裡切界',
      rightStick: '視口',
      legend: '←→ 移動 · B 跳躍 · A 鉤索擺盪 · R 切換表裡世界 · L 重試',
    }),
  },
];

let coreRegistered = false;

export function registerCoreCartridges(): void {
  if (coreRegistered) return;
  coreRegistered = true;
  for (const plugin of CORE_DATA_PLUGINS) {
    registerCartridgePlugin(plugin);
  }
}

export async function registerAllBuiltinCartridges(): Promise<void> {
  registerCoreCartridges();
}

export const registerBuiltinCartridges = registerCoreCartridges;
