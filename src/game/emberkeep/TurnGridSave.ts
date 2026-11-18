import { appLogger } from '../../core/runtime/AppLogger.ts';
import { pushCombatLog, recalcEquipmentBonuses, updateFov } from './DndExploreActions.ts';
import {
  CHAR_TO_TILE,
  TILE_PX,
  getActiveFloor,
  type ActiveEntity,
  type DndWorldState,
  type DungeonModuleDef,
  type FloorRuntime,
  type GridTileKind,
} from './DndTypes.ts';
import { EQUIPMENT_CATALOG, MONSTER_CATALOG } from './RpgRules.ts';

/**
 * Parses and validates user-authored D&D dungeon JSON modules.
 * Wraps `JSON.parse` in a defensive try-catch and logs both schema rejections and valid parses.
 */
export function parseDungeonModuleJson(raw: string): { module?: DungeonModuleDef; error?: string } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    appLogger.error('parsing', 'dnd.parseModuleJson', 'D&D 地牢模組 JSON 語法解析失敗', err, {
      rawBytes: raw.length,
    }, dt);
    return { error: `JSON 語法錯誤：${err instanceof Error ? err.message : String(err)}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    const msg = 'D&D 模組根節點必須是 JSON 物件';
    appLogger.warn('parsing', 'dnd.parseModuleJson', msg, undefined, { rawBytes: raw.length });
    return { error: msg };
  }
  const mod = parsed as Partial<DungeonModuleDef>;
  if (!Array.isArray(mod.floors) || mod.floors.length === 0) {
    const msg = '必須包含至少一個 floors 樓層陣列';
    appLogger.warn('parsing', 'dnd.parseModuleJson', msg, undefined, { title: mod.title });
    return { error: msg };
  }
  for (let i = 0; i < mod.floors.length; i++) {
    const f = mod.floors[i];
    if (!f || !Array.isArray(f.map) || f.map.length < 3 || !f.spawn) {
      const msg = `第 ${i + 1} 層缺少有效 map 或 spawn 座標`;
      appLogger.warn('parsing', 'dnd.parseModuleJson', msg, undefined, { floorIndex: i });
      return { error: msg };
    }
  }
  const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const moduleDef: DungeonModuleDef = {
    title: typeof mod.title === 'string' ? mod.title : '自訂地牢',
    ambientDarkness: typeof mod.ambientDarkness === 'number' ? mod.ambientDarkness : 0.72,
    floors: mod.floors,
    dialogs: mod.dialogs ?? {},
  };
  appLogger.success(
    'parsing',
    'dnd.parseModuleJson',
    `已解析 D&D 地牢模組「${moduleDef.title}」`,
    { title: moduleDef.title, floorCount: moduleDef.floors.length, rawBytes: raw.length },
    dt,
  );
  return { module: moduleDef };
}

export function buildFloorsFromModule(moduleDef: DungeonModuleDef): { floors: FloorRuntime[]; totalChests: number } {
  let totalChests = 0;
  const floors: FloorRuntime[] = [];

  for (const fDef of moduleDef.floors) {
    const h = fDef.map.length;
    const w = Math.max(...fDef.map.map((r) => r.length));
    const grid: GridTileKind[][] = [];
    for (let y = 0; y < h; y++) {
      const row: GridTileKind[] = [];
      const line = fDef.map[y] ?? '';
      for (let x = 0; x < w; x++) {
        row.push(CHAR_TO_TILE[line[x] ?? '#'] ?? 'wall');
      }
      grid.push(row);
    }

    const entities: ActiveEntity[] = (fDef.entities ?? []).map((ed) => {
      if (ed.kind === 'monster') {
        const arch = MONSTER_CATALOG[ed.archetype ?? 'goblin'] ?? MONSTER_CATALOG.goblin;
        return {
          id: ed.id,
          kind: 'monster',
          name: ed.name ?? arch.name,
          sprite: ed.sprite ?? arch.sprite,
          tint: arch.tint,
          x: ed.x,
          y: ed.y,
          alive: true,
          hp: arch.maxHp,
          maxHp: arch.maxHp,
          ac: arch.ac,
          atkMod: arch.atkMod,
          damageCount: arch.damageCount,
          damageSides: arch.damageSides,
          damageBonus: arch.damageBonus,
          xpReward: arch.xpReward,
          goldReward: arch.goldReward ?? 10,
          isBoss: arch.isBoss,
          isMiniBoss: arch.isMiniBoss,
          inflictStatus: arch.inflictStatus,
          specialName: arch.specialName,
          lootDrop: arch.lootDrop,
          statuses: {},
          flash: 0,
          squash: { scaleX: 1, scaleY: 1 },
        };
      }
      if (ed.kind === 'chest') {
        totalChests++;
        return {
          id: ed.id,
          kind: 'chest',
          name: ed.name ?? '鐵鎖寶箱',
          sprite: 'chest_closed',
          x: ed.x,
          y: ed.y,
          alive: true,
          opened: false,
          loot: ed.loot ?? 'potion',
          itemId: ed.itemId,
          hp: 1,
          maxHp: 1,
          ac: 10,
          atkMod: 0,
          damageCount: 0,
          damageSides: 0,
          damageBonus: 0,
          xpReward: 0,
          goldReward: 0,
          statuses: {},
          flash: 0,
          squash: { scaleX: 1, scaleY: 1 },
        };
      }
      return {
        id: ed.id,
        kind: 'npc',
        name: ed.name ?? '旅法師艾琳',
        sprite: ed.sprite ?? (ed.dialogId === 'merchant_shop' ? 'merchant' : 'npc_sage'),
        x: ed.x,
        y: ed.y,
        alive: true,
        dialogId: ed.dialogId,
        hp: 10,
        maxHp: 10,
        ac: 10,
        atkMod: 0,
        damageCount: 0,
        damageSides: 0,
        damageBonus: 0,
        xpReward: 0,
        goldReward: 0,
        statuses: {},
        flash: 0,
        squash: { scaleX: 1, scaleY: 1 },
      };
    });

    floors.push({
      def: fDef,
      width: w,
      height: h,
      grid,
      explored: new Set(),
      visible: new Set(),
      entities,
    });
  }

  return { floors, totalChests };
}

export function serializeTurnGridSave(s: DndWorldState): unknown {
  return {
    v: 1,
    floorIdx: s.floorIdx,
    turnCount: s.turnCount,
    score: s.score,
    chestsCollected: s.chestsCollected,
    blackboard: s.blackboard,
    hero: {
      level: s.hero.level,
      xp: s.hero.xp,
      nextXp: s.hero.nextXp,
      hp: s.hero.hp,
      maxHp: s.hero.maxHp,
      mp: s.hero.mp,
      maxMp: s.hero.maxMp,
      ac: s.hero.ac,
      str: s.hero.str,
      dex: s.hero.dex,
      int: s.hero.int,
      potions: s.hero.potions,
      keys: s.hero.keys,
      gold: s.hero.gold,
      weaponId: s.hero.weapon?.id,
      armorId: s.hero.armor?.id,
      relicId: s.hero.relic?.id,
      x: s.hero.x,
      y: s.hero.y,
    },
    floors: s.floors.map((f) => ({
      explored: Array.from(f.explored),
      openedDoors: f.grid.flatMap((row, y) =>
        row.map((t, x) => (t === 'floor' && f.def.map[y]?.[x] && 'DL^C'.includes(f.def.map[y][x]) ? `${x},${y}` : '')).filter(Boolean),
      ),
      entities: f.entities.map((e) => ({
        id: e.id,
        alive: e.alive,
        opened: e.opened,
        talked: e.talked,
        x: e.x,
        y: e.y,
        hp: e.hp,
      })),
    })),
  };
}

export function hydrateTurnGridSave(s: DndWorldState, raw: unknown, onCameraSnap: () => void): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const saved = raw as {
    v?: number;
    floorIdx?: number;
    turnCount?: number;
    score?: number;
    chestsCollected?: number;
    blackboard?: Record<string, boolean | number | string>;
    hero?: Record<string, unknown>;
    floors?: {
      explored?: number[];
      openedDoors?: string[];
      entities?: { id: string; alive?: boolean; opened?: boolean; talked?: boolean; x?: number; y?: number; hp?: number }[];
    }[];
  };
  if (saved.v !== 1 || typeof saved.floorIdx !== 'number' || !saved.hero || !Array.isArray(saved.floors)) return false;

  s.floorIdx = Math.max(0, Math.min(s.floors.length - 1, saved.floorIdx));
  s.turnCount = Number(saved.turnCount ?? 0);
  s.score = Number(saved.score ?? 0);
  s.chestsCollected = Number(saved.chestsCollected ?? 0);
  s.blackboard = { ...(saved.blackboard ?? {}) };

  const h = saved.hero;
  s.hero.level = Number(h.level ?? 1);
  s.hero.xp = Number(h.xp ?? 0);
  s.hero.nextXp = Number(h.nextXp ?? 80);
  s.hero.maxHp = Number(h.maxHp ?? 28);
  s.hero.hp = Math.max(1, Math.min(s.hero.maxHp, Number(h.hp ?? s.hero.maxHp)));
  s.hero.maxMp = Number(h.maxMp ?? 12);
  s.hero.mp = Number(h.mp ?? s.hero.maxMp);
  s.hero.str = Number(h.str ?? 15);
  s.hero.dex = Number(h.dex ?? 14);
  s.hero.int = Number(h.int ?? 13);
  s.hero.potions = Number(h.potions ?? 2);
  s.hero.keys = Number(h.keys ?? 0);
  s.hero.gold = Number(h.gold ?? 25);
  s.hero.weapon = typeof h.weaponId === 'string' ? EQUIPMENT_CATALOG[h.weaponId] : undefined;
  s.hero.armor = typeof h.armorId === 'string' ? EQUIPMENT_CATALOG[h.armorId] : undefined;
  s.hero.relic = typeof h.relicId === 'string' ? EQUIPMENT_CATALOG[h.relicId] : undefined;
  recalcEquipmentBonuses(s);

  for (let i = 0; i < s.floors.length && i < saved.floors.length; i++) {
    const f = s.floors[i];
    const sf = saved.floors[i];
    f.explored = new Set(sf.explored ?? []);
    for (const coord of sf.openedDoors ?? []) {
      const [cx, cy] = coord.split(',').map(Number);
      if (Number.isFinite(cx) && Number.isFinite(cy) && f.grid[cy]?.[cx]) {
        f.grid[cy][cx] = 'floor';
      }
    }
    for (const se of sf.entities ?? []) {
      const ent = f.entities.find((e) => e.id === se.id);
      if (!ent) continue;
      if (typeof se.alive === 'boolean') ent.alive = se.alive;
      if (typeof se.opened === 'boolean') {
        ent.opened = se.opened;
        if (ent.opened) ent.sprite = 'chest_open';
      }
      if (typeof se.talked === 'boolean') ent.talked = se.talked;
      if (typeof se.x === 'number') ent.x = se.x;
      if (typeof se.y === 'number') ent.y = se.y;
      if (typeof se.hp === 'number') ent.hp = se.hp;
    }
  }

  const activeFloor = getActiveFloor(s);
  s.hero.x = Math.max(1, Math.min(activeFloor.width - 2, Number(h.x ?? activeFloor.def.spawn.x)));
  s.hero.y = Math.max(1, Math.min(activeFloor.height - 2, Number(h.y ?? activeFloor.def.spawn.y)));
  s.hero.visualX = s.hero.x * TILE_PX;
  s.hero.visualY = s.hero.y * TILE_PX;
  s.phase = { kind: 'explore', menuIdx: 0 };
  updateFov(s);
  onCameraSnap();
  pushCombatLog(s, `💾 已從「${activeFloor.def.name}」SRAM 電池存檔續玩！`);
  return true;
}
