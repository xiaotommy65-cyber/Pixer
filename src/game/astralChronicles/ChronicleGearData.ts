import type { ChronicleGearSummary, ChroniclePauseTab, ChronicleUiMode } from '../../core/types/WorldTypes.ts';
import type { GearCatalogEntry } from './ChronicleTypes.ts';

export const GEAR_CATALOG: readonly GearCatalogEntry[] = [
  {
    id: 'w_oak',
    slot: 'weapon',
    name: '木靈短劍',
    desc: '風語聚落守護者佩戴的輕便刃具，攻速平衡且易於連擊。',
    statText: 'ATK +4 · 斬距 30px',
    costGold: 0,
    atkBonus: 4,
    defBonus: 0,
    rangeBonus: 0,
    mpCost: 0,
    speedScale: 1,
  },
  {
    id: 'w_starsteel',
    slot: 'weapon',
    name: '星鋼長劍',
    desc: '鍛造於星隕鐵砧的長刃，擴大揮砍扇區並射出星光劍氣。',
    statText: 'ATK +9 · 斬距 +8px',
    costGold: 95,
    atkBonus: 9,
    defBonus: 0,
    rangeBonus: 8,
    mpCost: 0,
    speedScale: 1,
  },
  {
    id: 'w_astral',
    slot: 'weapon',
    name: '餘燼星穹聖劍',
    desc: '融合雙星核能的傳說大劍，每段斬擊皆夾帶熾烈光束。',
    statText: 'ATK +15 · 斬距 +14px',
    costGold: 185,
    atkBonus: 15,
    defBonus: 1,
    rangeBonus: 14,
    mpCost: 0,
    speedScale: 1.04,
  },
  {
    id: 'a_cloak',
    slot: 'armor',
    name: '旅人披風',
    desc: '靈活輕盈的風行斗篷，最適合穿梭林間與翻滾閃避。',
    statText: 'DEF +2 · 靈巧標準',
    costGold: 0,
    atkBonus: 0,
    defBonus: 2,
    rangeBonus: 0,
    mpCost: 0,
    speedScale: 1.0,
  },
  {
    id: 'a_embermail',
    slot: 'armor',
    name: '熔岩鎖甲',
    desc: '熔燼鍛場淬鍊的耐熱鎖子甲，大幅吸收重擊傷害。',
    statText: 'DEF +5 · 減傷顯著',
    costGold: 90,
    atkBonus: 0,
    defBonus: 5,
    rangeBonus: 0,
    mpCost: 0,
    speedScale: 0.98,
  },
  {
    id: 'a_starplate',
    slot: 'armor',
    name: '星界光紋鎧',
    desc: '織入霜晶與星光纖維的聖鎧，兼具高防禦與疾風機動性。',
    statText: 'DEF +9 · 跑速 +8%',
    costGold: 175,
    atkBonus: 1,
    defBonus: 9,
    rangeBonus: 0,
    mpCost: 0,
    speedScale: 1.08,
  },
  {
    id: 'r_burst',
    slot: 'relic',
    name: '星穹衝擊印',
    desc: '消耗 14 MP 釋放 8 向星芒光彈環，擊退周圍敵群並清散彈幕。',
    statText: '遺物技：14 MP · 全向星爆',
    costGold: 0,
    atkBonus: 0,
    defBonus: 0,
    rangeBonus: 0,
    mpCost: 14,
    speedScale: 1,
  },
  {
    id: 'r_flame',
    slot: 'relic',
    name: '餘燼烈焰環',
    desc: '消耗 18 MP 引爆熾熱迴旋火海，對周遭敵人與 Boss 造成灼燒重創。',
    statText: '遺物技：18 MP · 高傷火環',
    costGold: 110,
    atkBonus: 2,
    defBonus: 0,
    rangeBonus: 0,
    mpCost: 18,
    speedScale: 1,
  },
  {
    id: 'r_aegis',
    slot: 'relic',
    name: '極光聖盾印',
    desc: '消耗 20 MP 即刻回復 28 HP 並展開無敵極光震盪波擊飛敵人。',
    statText: '遺物技：20 MP · 治療＋震波',
    costGold: 150,
    atkBonus: 0,
    defBonus: 2,
    rangeBonus: 0,
    mpCost: 20,
    speedScale: 1,
  },
];

export function getGearById(id: string): GearCatalogEntry {
  return GEAR_CATALOG.find((g) => g.id === id) ?? GEAR_CATALOG[0];
}

export const CHRONICLE_PAUSE_TABS: readonly { id: ChroniclePauseTab; label: string }[] = [
  { id: 'status', label: '狀態裝備' },
  { id: 'bag', label: '武器／道具庫' },
  { id: 'quests', label: '章節與收藏' },
  { id: 'guide', label: '操作與系統教學' },
];

export const INITIAL_UI_MODE: ChronicleUiMode = 'TITLE_MENU';

export function buildGearSummaries(
  ownedIds: ReadonlySet<string>,
  equippedWeaponId: string,
  equippedArmorId: string,
  equippedRelicId: string,
): ChronicleGearSummary[] {
  return GEAR_CATALOG.map((g) => ({
    id: g.id,
    slot: g.slot,
    name: g.name,
    desc: g.desc,
    statText: g.statText,
    owned: ownedIds.has(g.id),
    equipped:
      (g.slot === 'weapon' && g.id === equippedWeaponId) ||
      (g.slot === 'armor' && g.id === equippedArmorId) ||
      (g.slot === 'relic' && g.id === equippedRelicId),
    costGold: g.costGold,
  }));
}
