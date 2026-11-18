export const DEFAULT_SANDBOX_SCRIPT = `// 積木秘密基地：支援彈簧、木箱、連鎖炸彈、傳送門、移動平台與感應閘門！
api.setSky('#8fd8ff', '#fff4df');
api.setHeroSpawn(24, 120);

// 擺放漂浮雲朵跳台
api.addCloud(78, 124, 3);
api.addCloud(190, 96, 3);

// 互動積木玩具（木箱可推動/點燃，炸彈按 A 引爆連鎖！）
api.addSpring(60, 134);
api.addCrate(116, 134);
api.addBomb(136, 134);

// 灑滿黃金星星
api.addStar(94, 102);
api.addStar(132, 102);
api.addStar(206, 74);
api.addStar(238, 74);
api.addStar(276, 120);

// 放入守護果凍史萊姆
api.addSlime(182, 134);
api.addSlime(246, 134);
`;

export const SANDBOX_DEFAULT_SCRIPT = DEFAULT_SANDBOX_SCRIPT;

export interface WorkshopRecipe {
  label: string;
  code: string;
}

export const WORKSHOP_RECIPES: readonly WorkshopRecipe[] = [
  {
    label: '⭐ 黃金星雨配方',
    code: `// 滿滿黃金星星與粉紫晚霞！
api.setSky('#5979d6', '#ffd9e8');
api.setHeroSpawn(30, 118);
api.addCloud(70, 122, 3);
api.addCloud(176, 94, 4);
api.addSpring(56, 134);
api.addStar(84, 98);
api.addStar(118, 98);
api.addStar(190, 70);
api.addStar(224, 70);
api.addStar(258, 70);
api.addStar(284, 124);
api.addSlime(152, 134);`,
  },
  {
    label: '🍮 史萊姆派對',
    code: `// 果凍史萊姆大遊行！踩扁牠們或用彈簧跳躍！
api.setSky('#8ce0c4', '#fff5dc');
api.setHeroSpawn(24, 120);
api.addCloud(112, 114, 4);
api.addSpring(86, 134);
api.addStar(132, 90);
api.addStar(166, 90);
api.addSlime(96, 134);
api.addSlime(156, 134);
api.addSlime(216, 134);
api.addSlime(276, 134);`,
  },
  {
    label: '💣 連鎖爆破樂園',
    code: `// 推木箱或按 A 噴出火花，觸發炸彈連鎖爆破！
api.setSky('#5673b8', '#ffcf9f');
api.setHeroSpawn(24, 120);
api.addSpring(58, 134);
api.addCrate(96, 134);
api.addBomb(114, 134);
api.addBomb(132, 134);
api.addCrate(150, 134);
api.addCloud(172, 108, 4);
api.addStar(188, 86);
api.addStar(218, 86);
api.addStar(270, 122);
api.addSlime(182, 134);
api.addSlime(236, 134);`,
  },
  {
    label: '🕯️ 暗影地牢機關',
    code: `// 暗影地牢探險：推箱踩亮開關，靠火炬 GPU 光影尋找大門！
api.setSky('#141026', '#2a1d42');
api.setDarkness(0.76, '#0d091c');
api.setHeroSpawn(24, 120);
api.addWall(144, 102, 16, 48, 'stone');
api.addTorch(54, 134);
api.addTorch(196, 134);
api.addTorch(264, 134);
api.addCrate(88, 134);
api.addBomb(118, 134);
api.addSwitch(218, 134);
api.addCloud(112, 96, 3);
api.addStar(124, 74);
api.addStar(242, 118);
api.addSlime(174, 134);
api.addGate(286, 134);`,
  },
];
