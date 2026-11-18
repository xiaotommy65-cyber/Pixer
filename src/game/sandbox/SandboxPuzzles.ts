import { DEFAULT_SANDBOX_SCRIPT } from '../../assets/WorkshopRecipes.ts';
import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { BgmTheme } from '../../core/types/WorldTypes.ts';

export { DEFAULT_SANDBOX_SCRIPT };

export interface SandboxScriptApi {
  setSky(topHex: string, bottomHex: string): void;
  setDarkness(alpha: number, tintHex?: string): void;
  setHeroSpawn(x: number, y: number): void;
  addCloud(x: number, y: number, tilesWide?: number): void;
  addWall(x: number, y: number, w: number, h: number, sprite?: SpriteId): void;
  addSwitchWall(x: number, y: number, w: number, h: number, sprite?: SpriteId): void;
  addMovingPlatform(
    x: number,
    y: number,
    tilesWide: number,
    opts?: { minX?: number; maxX?: number; minY?: number; maxY?: number; vx?: number; vy?: number },
  ): void;
  addStar(x: number, y: number): void;
  addSlime(x: number, y: number): void;
  addSpring(x: number, y: number): void;
  addCrate(x: number, y: number): void;
  addBomb(x: number, y: number): void;
  addTorch(x: number, y: number): void;
  addSwitch(x: number, y: number): void;
  addPortal(x: number, y: number, group?: string): void;
  addKey(x: number, y: number): void;
  addGate(x: number, y: number): void;
}

export interface PuzzleSpec {
  id: string;
  name: string;
  bgmTheme: BgmTheme;
  hint: string;
  build: (api: SandboxScriptApi) => void;
}

export const SANDBOX_PUZZLES: readonly PuzzleSpec[] = [
  {
    id: 'p1',
    name: 'P1 · 彈簧炸藥初試',
    bgmTheme: 'meadow',
    hint: 'P1：推木箱、按 A 發射火花引爆炸彈，拾取鑰匙開啟傳送門！',
    build: (api) => {
      api.setSky('#8fd8ff', '#fff4df');
      api.setHeroSpawn(20, 124);
      api.addCloud(78, 122, 3);
      api.addCloud(182, 94, 3);
      api.addSpring(56, 134);
      api.addCrate(116, 134);
      api.addBomb(136, 134);
      api.addStar(94, 98);
      api.addStar(202, 70);
      api.addSlime(172, 134);
      api.addKey(224, 70);
      api.addGate(286, 134);
    },
  },
  {
    id: 'p2',
    name: 'P2 · 感應開關牆',
    bgmTheme: 'meadow',
    hint: 'P2：將木箱推上紫色水晶踏板，解除封印石牆！',
    build: (api) => {
      api.setSky('#7ac8f5', '#ffe8cf');
      api.setHeroSpawn(20, 124);
      api.addCrate(70, 134);
      api.addSwitch(144, 134);
      api.addSwitchWall(212, 86, 16, 64, 'stone');
      api.addCloud(114, 108, 3);
      api.addStar(132, 84);
      api.addStar(254, 118);
      api.addGate(284, 134);
    },
  },
  {
    id: 'p3',
    name: 'P3 · 雙向傳送門',
    bgmTheme: 'meadow',
    hint: 'P3：踏入紫色傳送陣瞬間穿越石壁，別忘了右方鑰匙！',
    build: (api) => {
      api.setSky('#90c7ff', '#ffdff2');
      api.setHeroSpawn(20, 124);
      api.addWall(148, 32, 16, 118, 'stone');
      api.addPortal(94, 134, 'a');
      api.addPortal(190, 134, 'a');
      api.addCloud(52, 108, 3);
      api.addStar(68, 84);
      api.addStar(234, 114);
      api.addKey(234, 134);
      api.addGate(284, 134);
    },
  },
  {
    id: 'p4',
    name: 'P4 · 火炬暗影地牢',
    bgmTheme: 'dungeon',
    hint: 'P4：靠火炬光影照明，用火花 A 點燃炸彈炸開箱子並踩踏板！',
    build: (api) => {
      api.setSky('#141026', '#2a1d42');
      api.setDarkness(0.72, '#0d091c');
      api.setHeroSpawn(20, 124);
      api.addTorch(54, 134);
      api.addTorch(194, 134);
      api.addTorch(266, 134);
      api.addCrate(86, 134);
      api.addBomb(114, 134);
      api.addSwitch(210, 134);
      api.addSwitchWall(242, 84, 16, 66, 'stone');
      api.addStar(146, 114);
      api.addStar(256, 108);
      api.addSlime(166, 134);
      api.addGate(286, 134);
    },
  },
  {
    id: 'p5',
    name: 'P5 · 空中移動浮橋',
    bgmTheme: 'meadow',
    hint: 'P5：搭乘移動浮橋橫越空中獲取鑰匙與高空星徽！',
    build: (api) => {
      api.setSky('#66b5f5', '#fff2d8');
      api.setHeroSpawn(20, 124);
      api.addWall(112, 92, 32, 58, 'crate');
      api.addMovingPlatform(152, 96, 3, { minX: 150, maxX: 214, vx: 38 });
      api.addCloud(260, 86, 3);
      api.addSpring(84, 134);
      api.addStar(120, 68);
      api.addStar(274, 62);
      api.addKey(280, 66);
      api.addGate(286, 134);
    },
  },
  {
    id: 'p6',
    name: 'P6 · 連鎖爆破迷庫',
    bgmTheme: 'dungeon',
    hint: 'P6：點燃一顆炸彈引爆整排火藥桶，清空守護史萊姆！',
    build: (api) => {
      api.setSky('#282147', '#593b6b');
      api.setDarkness(0.35, '#120e24');
      api.setHeroSpawn(20, 124);
      api.addTorch(46, 134);
      api.addBomb(92, 134);
      api.addCrate(112, 134);
      api.addBomb(132, 134);
      api.addCrate(152, 134);
      api.addBomb(172, 134);
      api.addSlime(198, 134);
      api.addSlime(232, 134);
      api.addSwitch(248, 134);
      api.addStar(118, 96);
      api.addStar(202, 96);
      api.addGate(288, 134);
    },
  },
  {
    id: 'p7',
    name: 'P7 · 雙傳送升降陣',
    bgmTheme: 'meadow',
    hint: 'P7：善用雙組傳送陣與垂直電梯抵達藏寶密室！',
    build: (api) => {
      api.setSky('#6ec4db', '#ffe8f0');
      api.setHeroSpawn(20, 124);
      api.addWall(128, 36, 16, 114, 'stone');
      api.addWall(224, 36, 16, 114, 'stone');
      api.addPortal(82, 134, 'a');
      api.addPortal(162, 134, 'a');
      api.addMovingPlatform(178, 120, 2, { minY: 64, maxY: 126, vy: -32 });
      api.addPortal(176, 48, 'b');
      api.addPortal(254, 134, 'b');
      api.addStar(182, 94);
      api.addStar(268, 110);
      api.addKey(196, 48);
      api.addGate(288, 134);
    },
  },
  {
    id: 'p8',
    name: 'P8 · 幽影壓板迷室',
    bgmTheme: 'dungeon',
    hint: 'P8：幽暗地宮內兩道石牆！尋找隱藏踏板並小心史萊姆！',
    build: (api) => {
      api.setSky('#100c20', '#23173b');
      api.setDarkness(0.76, '#0a0714');
      api.setHeroSpawn(20, 124);
      api.addTorch(44, 134);
      api.addTorch(138, 134);
      api.addTorch(238, 134);
      api.addCrate(76, 134);
      api.addSwitch(104, 134);
      api.addSwitchWall(164, 68, 16, 82, 'stone');
      api.addSlime(198, 134);
      api.addBomb(188, 134);
      api.addCloud(190, 96, 3);
      api.addStar(202, 72);
      api.addStar(258, 110);
      api.addGate(288, 134);
    },
  },
  {
    id: 'p9',
    name: 'P9 · 浮空彈簧迴廊',
    bgmTheme: 'meadow',
    hint: 'P9：彈簧、雲橋與傳送門的節奏跳躍挑戰！',
    build: (api) => {
      api.setSky('#7eb0f7', '#fff2df');
      api.setHeroSpawn(20, 124);
      api.addSpring(56, 134);
      api.addCloud(82, 96, 3);
      api.addMovingPlatform(142, 86, 3, { minX: 138, maxX: 204, vx: 44 });
      api.addWall(236, 44, 16, 106, 'crate');
      api.addPortal(214, 66, 'a');
      api.addPortal(260, 134, 'a');
      api.addStar(96, 72);
      api.addStar(188, 56);
      api.addKey(148, 134);
      api.addSlime(174, 134);
      api.addGate(288, 134);
    },
  },
  {
    id: 'p10',
    name: 'P10 · 積木大師終極試煉',
    bgmTheme: 'boss',
    hint: 'P10 最終關：結合連鎖火藥、傳送陣、移動平台與開關牆征服密室！',
    build: (api) => {
      api.setSky('#1b1236', '#4a2159');
      api.setDarkness(0.58, '#0f0921');
      api.setHeroSpawn(18, 124);
      api.addTorch(44, 134);
      api.addTorch(178, 134);
      api.addTorch(264, 134);
      api.addSpring(58, 134);
      api.addCloud(82, 96, 3);
      api.addPortal(94, 78, 'z');
      api.addPortal(150, 134, 'z');
      api.addWall(126, 40, 16, 110, 'stone');
      api.addBomb(170, 134);
      api.addCrate(190, 134);
      api.addSwitch(212, 134);
      api.addSwitchWall(246, 72, 16, 78, 'stone');
      api.addMovingPlatform(188, 86, 3, { minX: 184, maxX: 230, vx: 42 });
      api.addStar(98, 54);
      api.addStar(208, 60);
      api.addStar(268, 108);
      api.addSlime(208, 134);
      api.addGate(288, 134);
    },
  },
];
