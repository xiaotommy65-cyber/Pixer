import type { DialogDef, DungeonEntityDef } from './DndTypes.ts';
import { EQUIPMENT_CATALOG } from './RpgRules.ts';

export interface FloorRecipe {
  id: string;
  name: string;
  westSanctum: boolean;
  monsters: string[];
  npc?: { id: string; name: string; dialogId: string };
  extraLoot: { loot: DungeonEntityDef['loot']; itemId?: string; name: string };
  hasCampfire: boolean;
  hasBoss?: boolean;
  hasMiniBoss?: boolean;
}

export const FLOOR_RECIPES: readonly FloorRecipe[] = [
  {
    id: 'floor-1',
    name: 'B1 · 守望前廳',
    westSanctum: false,
    monsters: ['goblin', 'goblin', 'treasure_goblin'],
    npc: { id: 'sage-1', name: '旅法師艾琳', dialogId: 'sage_intro' },
    extraLoot: { loot: 'weapon', itemId: 'iron_blade', name: '鍛造武器箱' },
    hasCampfire: true,
  },
  {
    id: 'floor-2',
    name: 'B2 · 迷霧石廊',
    westSanctum: true,
    monsters: ['goblin', 'skeleton', 'shaman'],
    extraLoot: { loot: 'armor', itemId: 'leather_vest', name: '護甲軍備箱' },
    hasCampfire: true,
  },
  {
    id: 'floor-3',
    name: 'B3 · 黑市營地',
    westSanctum: false,
    monsters: ['skeleton', 'skeleton', 'treasure_goblin'],
    npc: { id: 'merchant-3', name: '地底行商波波', dialogId: 'merchant_shop' },
    extraLoot: { loot: 'relic', itemId: 'sun_lantern', name: '古代遺物箱' },
    hasCampfire: false,
  },
  {
    id: 'floor-4',
    name: 'B4 · 熔岩密庫',
    westSanctum: true,
    monsters: ['skeleton', 'shaman'],
    extraLoot: { loot: 'elixir', name: '熔岩秘藥箱' },
    hasCampfire: true,
    hasMiniBoss: true,
  },
  {
    id: 'floor-5',
    name: 'B5 · 寒霜迴廊',
    westSanctum: false,
    monsters: ['shaman', 'gargoyle', 'treasure_goblin'],
    extraLoot: { loot: 'weapon', itemId: 'ember_sword', name: '熾焰神兵箱' },
    hasCampfire: true,
  },
  {
    id: 'floor-6',
    name: 'B6 · 星辰祭壇',
    westSanctum: true,
    monsters: ['gargoyle', 'shaman', 'skeleton'],
    npc: { id: 'merchant-6', name: '星辰鐵匠索爾', dialogId: 'forge_master' },
    extraLoot: { loot: 'gold', name: '沉重金幣箱' },
    hasCampfire: false,
  },
  {
    id: 'floor-7',
    name: 'B7 · 龍裔前哨',
    westSanctum: false,
    monsters: ['gargoyle', 'gargoyle', 'treasure_goblin'],
    extraLoot: { loot: 'relic', itemId: 'sage_charm', name: '賢者密匣' },
    hasCampfire: true,
  },
  {
    id: 'floor-8',
    name: 'B8 · 終焉餘燼龍殿',
    westSanctum: true,
    monsters: ['gargoyle', 'shaman'],
    extraLoot: { loot: 'elixir', name: '龍騎士秘箱' },
    hasCampfire: true,
    hasBoss: true,
  },
];

export const EMBERKEEP_DIALOGS: Record<string, DialogDef> = {
  sage_intro: {
    speaker: '🧙 旅法師艾琳',
    text: '「餘燼深淵共有八層！每層先尋得鐵鑰匙開啟聖所大門，善用營火與裝備提升戰力！」',
    choices: [
      {
        id: 'rune_lore',
        label: '解讀古代火紋章',
        checkStat: 'int',
        checkDc: 10,
        successText: '看破光源符文！火把視野永久擴大，並獲得治療藥水×1！',
        failText: '符文微光閃爍，獲得基礎補給藥水×1。',
        rewardFlag: 'sage_blessing',
        rewardPotion: 1,
        rewardXp: 35,
      },
      {
        id: 'ask_supply',
        label: '領取冒險補給包',
        successText: '艾琳贈與藥水×1 與 25 枚旅費金幣！',
        rewardPotion: 1,
        rewardGold: 25,
        rewardXp: 20,
      },
    ],
  },
  merchant_shop: {
    speaker: '🎒 地底行商波波',
    text: '「深淵裡什麼都缺，就是金幣最好使！挑一件趁手的兵器或補品吧！」',
    choices: [
      {
        id: 'buy_ember',
        label: `購買 ${EQUIPMENT_CATALOG.ember_sword.name} (+2攻/+3傷·灼燒)`,
        costGold: EQUIPMENT_CATALOG.ember_sword.price,
        rewardItem: 'ember_sword',
        successText: '「好眼光！烈焰長劍會灼燒你的敵人！」',
      },
      {
        id: 'buy_lantern',
        label: `購買 ${EQUIPMENT_CATALOG.sun_lantern.name} (視野+2/+1攻)`,
        costGold: EQUIPMENT_CATALOG.sun_lantern.price,
        rewardItem: 'sun_lantern',
        successText: '「太陽火紋徽會照亮迷宮的每個角落！」',
      },
      {
        id: 'buy_potion',
        label: '購買 治療藥水 ×2',
        costGold: 24,
        rewardPotion: 2,
        successText: '獲得 2 瓶治療藥水！',
      },
      {
        id: 'leave_shop',
        label: '整理行囊繼續前進',
        successText: '「小心深處的熔岩典獄長！」',
      },
    ],
  },
  forge_master: {
    speaker: '⚒️ 星辰鐵匠索爾',
    text: '「前面就是龍裔重兵把守的深淵！需要我替你淬鍊屠龍神兵或修復護甲嗎？」',
    choices: [
      {
        id: 'buy_dragonbane',
        label: `鍛造 ${EQUIPMENT_CATALOG.dragonbane.name} (+3攻/+5傷·灼燒)`,
        costGold: EQUIPMENT_CATALOG.dragonbane.price,
        rewardItem: 'dragonbane',
        successText: '「屠龍聖劍完成！這把劍專門對付餘燼龍王！」',
      },
      {
        id: 'buy_sage_charm',
        label: `購買 ${EQUIPMENT_CATALOG.sage_charm.name} (AC+1/+1傷/視野+1)`,
        costGold: EQUIPMENT_CATALOG.sage_charm.price,
        rewardItem: 'sage_charm',
        successText: '「賢者護符已發動守護之力！」',
      },
      {
        id: 'rest_forge',
        label: '在星辰熔爐旁徹底休整 (全恢復)',
        costGold: 25,
        rewardHpFull: true,
        successText: '體力、魔力完全恢復，並解除所有異常狀態！',
      },
      {
        id: 'leave_forge',
        label: '帶著信心直接挑戰',
        successText: '「祝你屠龍凱旋！」',
      },
    ],
  },
};
