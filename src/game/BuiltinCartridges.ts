import { SANDBOX_DEFAULT_SCRIPT } from '../assets/WorkshopRecipes.ts';
import { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import {
  registerCartridgePlugin,
  type CartridgePluginDefinition,
} from '../core/runtime/CartridgeRegistry.ts';
import type { CartridgeJsonV1 } from '../core/sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../core/sim/DataCartridgeRuntime.ts';
import astralDeckJson from './astralDeck/astralDeck.cartridge.json' with { type: 'json' };
import { ASTRAL_RIFT_PROJECT } from './astralRift/AstralRiftProject.ts';
import atelierBrawlerJson from './atelierBrawler/atelierBrawler.cartridge.json' with { type: 'json' };
import cloudberryJson from './cloudberry/cloudberry.cartridge.json' with { type: 'json' };
import { OBSIDIAN_CITADEL_PROJECT } from './obsidianCitadel/ObsidianCitadelProject.ts';
import { PulseResonanceCartridge } from './pulseResonance/PulseResonanceCartridge.ts';
import { RHYTHM_BASTION_PROJECT } from './rhythmBastion/RhythmBastionProject.ts';
import { SKYWARD_FORGE_CARTRIDGE } from './skywardForge/SkywardForgeBuilder.ts';
import sugarStarlightJson from './sugarStarlight/sugarStarlight.cartridge.json' with { type: 'json' };

export const DND_DEFAULT_MODULE_JSON = JSON.stringify(
  {
    title: '餘燼深淵自訂模組',
    seed: 2026,
    floors: 8,
    heroName: '星火見習生',
  },
  null,
  2,
);

/**
 * Lean Core Cartridges (Zero hand-written legacy gameplay TS):
 * - PA-11: Pixer 7.0 True ECS + Sandboxed Script VM 640x360 HD-2D Flagship
 * - PA-10: Studio 6.0 Command-Built Parkour Flagship
 * - PA-01, PA-02, PA-07, PA-08: Pure JSON Data-Driven Cartridges
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
      id: 'pulse-resonance',
      code: 'PA-13',
      title: '星脈共鳴：4K 舞台',
      subtitle: '4K 垂直下落 × 自動識譜 DSP × 動態鏡頭運鏡',
      genre: '音樂節奏旗艦',
      accentHex: '#38bdf8',
      badgeText: '4K Tap/Hold/雙押 · 4 首原創曲 + MP3 自動識譜',
      controlsHint: '←/↓/B/A 對應 4K 音軌・L 切歌・R 切難度・點擊頂部「音遊譜面」開啟完整曲庫與自動識譜工作站！',
      goalHint: '抓準判定線擊打 4K 單點、長壓與白金雙押，衝擊 1,000,000 分與 φ 全完美評級！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
      preserveActionHold: true,
    },
    factory: () => new PulseResonanceCartridge(),
    resolveControlProfile: () => ({
      a: '第4軌 (K)',
      b: '第3軌 (J)',
      x: '檢視',
      y: '第3軌',
      l: '切曲目',
      r: '切難度',
      rightStick: '軌道',
      legend: '←/↓/B/A 對應 4K 音軌 · L 切換曲目 · R 切換難度 · 頂部「音遊譜面」開啟完整工作站',
    }),
  },
  {
    meta: {
      id: 'rhythm-bastion',
      code: 'PA-11',
      title: '星軌節奏塔防',
      subtitle: '640×360 HD-2D · 真 ECS 節奏×塔防混合',
      genre: 'ECS 7.0 旗艦',
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
      subtitle: '640×360 HD-2D · 純 ECS 多維位面 × 飛鉤 × 事件圖旗艦',
      genre: 'ECS 9.0 旗艦',
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
  {
    meta: {
      id: 'skyward-forge',
      code: 'PA-10',
      title: '蒼穹鍛爐：正交試煉',
      subtitle: '100% 編輯器指令建構 × PA-06 級視效',
      genre: 'AI 工坊旗艦',
      accentHex: '#ff9f43',
      badgeText: '零手寫遊戲碼 × Verlet/IK × 飛鉤跑酷',
      controlsHint: '方向移動・B 跳躍/蹬牆・A 衝刺/波浪跳・Y 飛鉤擺盪・R 高速牽引・X 遠眺・L 重試',
      goalHint: '完全由編輯器指令生成的旗艦雙幕飛鉤試煉：駕馭波浪衝刺、碎裂瓦片與星塵流場衝向蒼穹之巔！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
      preserveActionHold: true,
    },
    cartridgeJson: SKYWARD_FORGE_CARTRIDGE,
    factory: () => new DataCartridgeRuntime(SKYWARD_FORGE_CARTRIDGE),
    resolveControlProfile: () => ({
      a: '波浪衝刺',
      b: '跳躍/甩',
      x: '遠眺',
      y: '擺盪/左鍵',
      l: '重試',
      r: '牽引/右鍵',
      rightStick: '360°瞄準',
      legend: 'L 重試 · X 遠眺 · Y/左鍵 飛鉤擺盪 · R/右鍵 牽引 · B 跳躍/蹬牆 · A 波浪衝刺',
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
      id: 'astral-deck',
      code: 'PA-07',
      title: '星紋牌陣',
      subtitle: '四區牌庫 × 狀態連攜 × 正交卡圖',
      genre: '策略卡牌',
      accentHex: '#a78bfa',
      badgeText: '牌庫/手牌/棄牌/消耗 × 3 連戰選牌',
      controlsHint: '← → 選牌・↑↓/L/R 切敵人目標・A/左鍵 打出・Y/右鍵 結束回合',
      goalHint: '運用四區牌組循環、易傷/灼燒/力量疊層與戰利品選牌，擊敗三波星紋守衛與餘燼龍王！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    cartridgeJson: astralDeckJson as unknown as CartridgeJsonV1,
    aiCapabilities: ['tactical-advisor'],
    factory: () => new DataCartridgeRuntime(astralDeckJson),
    resolveControlProfile: () => ({
      a: '打出/選牌',
      b: '確認',
      x: '檢視',
      y: '結束回合',
      l: '切目標',
      r: '切目標',
      rightStick: '指標',
      legend: '←→ 選牌 · L/R/↑↓ 切換敵人目標 · A/左鍵 打出卡牌 · Y/右鍵 結束回合',
    }),
  },
  {
    meta: {
      id: 'atelier-brawler',
      code: 'PA-08',
      title: '工房武鬥會',
      subtitle: '60Hz 幀資料 × 判定盒 × 連段取消',
      genre: '2D 格鬥',
      accentHex: '#ff9642',
      badgeText: '前搖/判定/後搖 × Hitbox 檢視 × 取消連段',
      controlsHint: '← → 移動/後拉防禦・↓ 蹲下・B 跳躍・A 輕・Y 重・X 昇龍必殺・R 超必殺・L 判定盒開關',
      goalHint: '善用輕→重→必殺→超必殺取消連段與高低段防禦，可按 L 即時開啟紅/綠/藍判定盒！',
      defaultScript: SANDBOX_DEFAULT_SCRIPT,
    },
    cartridgeJson: atelierBrawlerJson as unknown as CartridgeJsonV1,
    factory: () => new DataCartridgeRuntime(atelierBrawlerJson),
    resolveControlProfile: () => ({
      a: '輕攻/空',
      b: '跳躍',
      x: '必殺技',
      y: '重攻/下',
      l: '判定盒',
      r: '超必殺',
      rightStick: '移動',
      legend: '←→ 移動/拉後防禦 · ↓ 蹲 · B 跳 · A 輕 · Y 重 · X 必殺 · R 超必殺 · L 切換判定盒',
    }),
  },
];

let coreRegistered = false;
let legacyPackLoaded = false;
let legacyPackPromise: Promise<number> | null = null;

/**
 * Registers only the lean data-driven & ECS V2 core cartridges synchronously at boot
 * (zero static dependency on the ~10k-line legacy hand-written cartridge pack).
 */
export function registerCoreCartridges(): void {
  if (coreRegistered) return;
  coreRegistered = true;
  for (const plugin of CORE_DATA_PLUGINS) {
    registerCartridgePlugin(plugin);
  }
}

export function isLegacyCartridgePackLoaded(): boolean {
  return legacyPackLoaded;
}

/**
 * Dynamically code-splits and mounts the 5 legacy hand-written cartridges (PA-03, PA-04, PA-05, PA-06, PA-09)
 * strictly on demand when requested in the Arcade Showcase Shell or verification suite.
 */
export async function loadLegacyCartridgePack(): Promise<number> {
  if (legacyPackLoaded) return 5;
  if (!legacyPackPromise) {
    legacyPackPromise = import('./LegacyCartridgePack.ts')
      .then((mod) => {
        const list = mod.registerLegacyCartridgePack();
        legacyPackLoaded = true;
        return list.length;
      })
      .catch((err) => {
        legacyPackPromise = null;
        throw err;
      });
  }
  return legacyPackPromise;
}

/**
 * Registers both core and legacy cartridges (async, used by full simulation verification suites).
 */
export async function registerAllBuiltinCartridges(): Promise<void> {
  registerCoreCartridges();
  await loadLegacyCartridgePack();
}

export const registerBuiltinCartridges = registerCoreCartridges;
