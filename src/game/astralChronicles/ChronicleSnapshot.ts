import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type {
  ChronicleChapterSummary,
  ChronicleHudSnapshot,
  DebugRectDesc,
  EntityDesc,
  LightDesc,
  RenderSceneSnapshot,
  RuntimeParams,
  TileDesc,
} from '../../core/types/WorldTypes.ts';
import { CHAPTER_SPECS, buildGearSummaries, getGearById } from './AstralChroniclesData.ts';
import { getHeroAtk, getHeroDef, type ChronicleState } from './ChronicleCombat.ts';

const TOTAL_CHESTS = CHAPTER_SPECS.reduce((acc, c) => acc + c.chests.length, 0);
const WALL_FACE_COLORS = ['#3b4d3f', '#3c4c7a', '#5b2b33', '#436b94', '#452866'] as const;
const STATIC_CHAPTER_TILES = new Map<number, TileDesc[]>();

interface ChronicleHudCache {
  chaptersKey: string;
  chapters: ChronicleChapterSummary[];
  gearKey: string;
  gear: ReturnType<typeof buildGearSummaries>;
}
const HUD_CACHE = new WeakMap<ChronicleState, ChronicleHudCache>();

function getStaticChapterTiles(chapterIdx: number, gateOpen: boolean): TileDesc[] {
  const key = chapterIdx * 2 + (gateOpen ? 1 : 0);
  const cached = STATIC_CHAPTER_TILES.get(key);
  if (cached) return cached;

  const ch = CHAPTER_SPECS[chapterIdx];
  const wallFaceHex = WALL_FACE_COLORS[chapterIdx] ?? '#3b3854';
  const tiles: TileDesc[] = [];
  const tileStep = 24;
  for (let x = 0; x < ch.worldW; x += tileStep) {
    for (let y = 12; y < ch.worldH; y += tileStep) {
      tiles.push({
        sprite: ch.floorSprite,
        x,
        y,
        w: tileStep,
        h: tileStep,
        tint: ch.floorTint,
      });
    }
  }
  for (const wall of ch.walls) {
    const columnSortY = wall.y + wall.h;
    const isTree = wall.sprite === 'tree_canopy';
    let segIdx = 0;
    for (let wy = wall.y; wy < wall.y + wall.h; wy += 20) {
      const segH = Math.min(20, wall.y + wall.h - wy);
      const isBottomSeg = wy + segH >= wall.y + wall.h;
      const jitterX = isTree ? (segIdx % 2 === 1 ? 3 : -2) : 0;
      segIdx++;
      tiles.push({
        sprite: wall.sprite,
        x: wall.x + jitterX,
        y: wy,
        w: isTree ? Math.max(wall.w, 22) : wall.w,
        h: isTree ? Math.max(segH, 22) : segH,
        tint: wall.tint,
        elevationZ: isTree ? 2 : 9,
        extrudeH: isBottomSeg ? (isTree ? 3 : 10) : 0,
        wallColor: isTree ? '#4f3524' : wallFaceHex,
        wallMaterial:
          isTree
            ? 'timber'
            : ch.id === 'ch4-frostspire' || ch.id === 'ch5-core'
              ? 'astral'
              : 'stone',
        castShadow: isBottomSeg,
        sortY: columnSortY,
      });
    }
  }
  if (!gateOpen) {
    const g = ch.gateWall;
    const gateSortY = g.y + g.h;
    for (let gy = g.y; gy < g.y + g.h; gy += 16) {
      const segH = Math.min(16, g.y + g.h - gy);
      const isBottomSeg = gy + segH >= g.y + g.h;
      tiles.push({
        sprite: 'gate_closed',
        x: g.x,
        y: gy,
        w: g.w,
        h: segH,
        tint: ch.accentHex,
        elevationZ: 9,
        extrudeH: isBottomSeg ? 10 : 0,
        wallColor: '#312645',
        wallMaterial: 'astral',
        castShadow: isBottomSeg,
        sortY: gateSortY,
      });
    }
  }
  STATIC_CHAPTER_TILES.set(key, tiles);
  return tiles;
}

export function buildChaptersSummary(s: ChronicleState): ChronicleChapterSummary[] {
  return CHAPTER_SPECS.map((ch) => ({
    index: ch.index,
    id: ch.id,
    title: ch.title,
    subtitle: ch.subtitle,
    levelReq: ch.levelReq,
    unlocked: ch.index < s.unlockedChapters,
    cleared: s.clearedChapters.has(ch.index),
    chestsFound: ch.chests.filter((c) => s.openedChestIds.has(c.id)).length,
    chestsTotal: ch.chests.length,
    bossDefeated: s.bossDefeatedChapters.has(ch.index),
    accentHex: ch.accentHex,
  }));
}

export function buildHudSnapshot(s: ChronicleState): ChronicleHudSnapshot {
  const ch = CHAPTER_SPECS[s.chapterIdx];
  const weapon = getGearById(s.equippedWeaponId);
  const armor = getGearById(s.equippedArmorId);
  const relic = getGearById(s.equippedRelicId);

  let tutorialHint: string | null = null;
  if (s.uiMode === 'PLAYING' && s.chapterIdx === 0) {
    if (!s.hasSlashed) tutorialHint = '操作教學：移動靠近敵人，按 A 鍵（或 X 鍵）施展三段劍舞連擊';
    else if (!s.hasDashed) tutorialHint = '操作教學：按 B 鍵（或空白鍵）翻滾閃避，擁有瞬間無敵幀';
    else if (!s.hasUsedRelic) tutorialHint = '操作教學：按 Q 鍵或點擊右上「遺物技」消耗 MP 施放全向星爆';
  }

  let cache = HUD_CACHE.get(s);
  if (!cache) {
    cache = { chaptersKey: '', chapters: [], gearKey: '', gear: [] };
    HUD_CACHE.set(s, cache);
  }
  const chaptersKey = `${s.unlockedChapters}|${s.clearedChapters.size}|${s.bossDefeatedChapters.size}|${s.openedChestIds.size}`;
  if (cache.chaptersKey !== chaptersKey) {
    cache.chaptersKey = chaptersKey;
    cache.chapters = buildChaptersSummary(s);
  }
  const gearKey = `${s.ownedGearIds.size}|${s.equippedWeaponId}|${s.equippedArmorId}|${s.equippedRelicId}`;
  if (cache.gearKey !== gearKey) {
    cache.gearKey = gearKey;
    cache.gear = buildGearSummaries(
      s.ownedGearIds,
      s.equippedWeaponId,
      s.equippedArmorId,
      s.equippedRelicId,
    );
  }

  return {
    uiMode: s.uiMode,
    hasSavedRun: s.hasSavedState,
    chapterIndex: s.chapterIdx,
    chapterTotal: CHAPTER_SPECS.length,
    chapterTitle: ch.title,
    areaTitle: ch.areaTitle,
    hero: {
      name: '星穹守望者',
      level: s.heroLevel,
      xp: s.heroXp,
      nextXp: s.heroNextXp,
      hp: Math.round(s.heroHp),
      maxHp: s.heroMaxHp,
      mp: Math.round(s.heroMp),
      maxMp: s.heroMaxMp,
      stamina: Math.round(s.heroStamina),
      maxStamina: s.heroMaxStamina,
      gold: s.heroGold,
      atk: getHeroAtk(s),
      def: getHeroDef(s),
      potions: s.heroPotions,
      kills: s.totalKills,
      chestsFound: s.openedChestIds.size,
      chestsTotal: TOTAL_CHESTS,
      equippedWeaponName: weapon.name,
      equippedArmorName: armor.name,
      equippedRelicName: relic.name,
      relicMpCost: Math.max(10, relic.mpCost),
    },
    questObjective: ch.questObjective,
    interactPrompt: s.activePrompt?.label ?? null,
    tutorialHint,
    pauseTab: s.pauseTab,
    titleCursorIdx: s.titleCursorIdx,
    mapCursorIdx: s.mapCursorIdx,
    bagCursorIdx: s.bagCursorIdx,
    gear: cache.gear,
    chapters: cache.chapters,
    cutscene: s.cutscene.getViewSnapshot(),
    boss: s.boss
      ? {
          name: s.boss.name,
          subtitle: s.boss.subtitle,
          hp: Math.max(0, s.boss.hp),
          maxHp: s.boss.maxHp,
          phase: s.boss.phase,
        }
      : undefined,
    camera: {
      zoom: Number(s.camera.zoom.toFixed(2)),
      letterbox: Number(s.camera.letterbox.toFixed(2)),
      mode: s.camera.mode,
    },
  };
}

interface ChronicleSnapshotBank {
  entities: EntityDesc[];
  entityPool: EntityDesc[];
  lights: LightDesc[];
  lightPool: LightDesc[];
  debugRects: DebugRectDesc[];
  debugPool: DebugRectDesc[];
  bgClouds: RenderSceneSnapshot['bgClouds'];
  hd2dDepth: NonNullable<RenderSceneSnapshot['hd2dDepth']>;
  stage: NonNullable<RenderSceneSnapshot['stage']>;
  snapshot: RenderSceneSnapshot;
}

const CHRONICLE_BANKS = new WeakMap<ChronicleState, ChronicleSnapshotBank>();

function getChronicleBank(s: ChronicleState): ChronicleSnapshotBank {
  let bank = CHRONICLE_BANKS.get(s);
  if (bank) return bank;
  const entities: EntityDesc[] = [];
  const lights: LightDesc[] = [];
  const debugRects: DebugRectDesc[] = [];
  const bgClouds: RenderSceneSnapshot['bgClouds'] = [];
  const hd2dDepth: NonNullable<RenderSceneSnapshot['hd2dDepth']> = {
    enabled: true,
    sortByDepthY: true,
    perspectiveSkew: 0.055,
    horizonHazeColor: '#1a1230',
    horizonHazeAlpha: 0.16,
    tiltShiftAlpha: 0.14,
  };
  const stage: NonNullable<RenderSceneSnapshot['stage']> = { index: 1, total: CHAPTER_SPECS.length, name: '' };
  bank = {
    entities,
    entityPool: [],
    lights,
    lightPool: [],
    debugRects,
    debugPool: [],
    bgClouds,
    hd2dDepth,
    stage,
    snapshot: {
      cartridgeId: 'astral-chronicles',
      skyTop: '#1a1230',
      skyBottom: '#2b1e48',
      cozyFilter: true,
      glowIntensity: 1,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 0,
      comboCount: 0,
      starsCollected: 0,
      starsTotal: TOTAL_CHESTS,
      hasKey: false,
      hearts: 5,
      maxHearts: 5,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      cameraZoom: 1,
      cameraLetterbox: 0,
      ambientDarkness: 0,
      ambientColor: '#120e24',
      screenFlashAlpha: 0,
      screenFlashColor: '#fffaf0',
      hd2dDepth,
      bgStars: s.bgStars,
      bgClouds,
      tiles: [],
      entities,
      particles: s.juice.particles,
      lights,
      debugRects: undefined,
      statusBanner: '',
      stage,
      bgmTheme: 'meadow',
      chronicleHud: undefined,
    },
  };
  CHRONICLE_BANKS.set(s, bank);
  return bank;
}

function acquireChrEntity(pool: EntityDesc[], idx: number): EntityDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { id: '', sprite: 'hero_a', x: 0, y: 0, w: 16, h: 16 };
    pool[idx] = slot;
  }
  slot.tint = undefined;
  slot.flipX = false;
  slot.rot = 0;
  slot.alpha = 1;
  slot.flash = 0;
  slot.scaleX = 1;
  slot.scaleY = 1;
  slot.additive = false;
  slot.emissive = 0;
  slot.elevationZ = 0;
  slot.castShadow = false;
  slot.shadowRadius = undefined;
  return slot;
}

function acquireChrLight(pool: LightDesc[], idx: number): LightDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, radius: 32, color: '#ffd447', intensity: 0.4 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireChrDebug(pool: DebugRectDesc[], idx: number): DebugRectDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, w: 16, h: 16, color: '#56d39c' };
    pool[idx] = slot;
  }
  return slot;
}

export function buildChronicleSceneSnapshot(
  s: ChronicleState,
  params: RuntimeParams,
  status: 'playing' | 'won' | 'lost',
): RenderSceneSnapshot {
  const bank = getChronicleBank(s);
  const ch = CHAPTER_SPECS[s.chapterIdx];
  const t = s.juice.visualTime;
  const glow = params.glowIntensity;
  const camFields = s.camera.toSnapshotFields(s.juice.shakeX, s.juice.shakeY);
  const tiles = getStaticChapterTiles(s.chapterIdx, s.gateOpen);

  const entities = bank.entities;
  const lights = bank.lights;
  let entityCount = 0;
  let lightCount = 0;

  if (glow > 0.05) {
    for (let i = 0; i < ch.lights.length; i++) {
      const l = ch.lights[i];
      const ld = acquireChrLight(bank.lightPool, lightCount);
      ld.x = l.x;
      ld.y = l.y;
      ld.radius = l.radius;
      ld.color = l.color;
      ld.intensity = l.intensity * glow;
      lights[lightCount++] = ld;
    }
  }

  for (let i = 0; i < ch.switches.length; i++) {
    const sw = ch.switches[i];
    const on = s.activatedSwitches.has(sw.id);
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = sw.id;
    ed.sprite = on ? 'switch_on' : 'switch_off';
    ed.x = sw.x;
    ed.y = sw.y;
    ed.w = 16;
    ed.h = 16;
    ed.tint = on ? '#56d39c' : '#ffd447';
    ed.sortY = sw.y + 4;
    entities[entityCount++] = ed;
  }

  for (let i = 0; i < ch.chests.length; i++) {
    const chest = ch.chests[i];
    const opened = s.openedChestIds.has(chest.id);
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = chest.id;
    ed.sprite = opened ? 'chest_open' : 'chest_closed';
    ed.x = chest.x;
    ed.y = chest.y;
    ed.w = 16;
    ed.h = 16;
    ed.castShadow = true;
    ed.shadowRadius = 7;
    ed.sortY = chest.y + 15;
    entities[entityCount++] = ed;
    if (!opened && glow > 0.05) {
      const ld = acquireChrLight(bank.lightPool, lightCount);
      ld.x = chest.x + 8;
      ld.y = chest.y + 8;
      ld.radius = 22;
      ld.color = '#ffd447';
      ld.intensity = 0.4 * glow;
      lights[lightCount++] = ld;
    }
  }

  for (let i = 0; i < ch.npcs.length; i++) {
    const npc = ch.npcs[i];
    const elev =
      npc.kind === 'shrine'
        ? 4.2 + Math.sin(t * 2.8 + npc.x) * 1.8
        : 1.0 + Math.max(0, Math.sin(t * 2.8 + npc.x) * 1.1);
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = npc.id;
    ed.sprite = npc.sprite;
    ed.x = npc.x;
    ed.y = npc.y;
    ed.w = 16;
    ed.h = 16;
    ed.elevationZ = elev;
    ed.castShadow = true;
    ed.shadowRadius = 7.2;
    ed.sortY = npc.y + 16;
    entities[entityCount++] = ed;
    if (glow > 0.05) {
      const ld = acquireChrLight(bank.lightPool, lightCount);
      ld.x = npc.x + 8;
      ld.y = npc.y + 8;
      ld.radius = 34;
      ld.color = npc.kind === 'shrine' ? '#5ec2f7' : '#ffd447';
      ld.intensity = 0.42 * glow;
      lights[lightCount++] = ld;
    }
  }

  for (let i = 0; i < s.enemies.length; i++) {
    const e = s.enemies[i];
    const sp: SpriteId =
      e.kind === 'slime'
        ? Math.floor(t * 5) % 2 === 0
          ? 'slime_a'
          : 'slime_b'
        : e.kind === 'goblin'
          ? 'goblin'
          : e.kind === 'shaman'
            ? 'shaman'
            : e.kind === 'gargoyle'
              ? 'gargoyle'
              : e.kind === 'frost_mage'
                ? 'frost_mage'
                : 'slime_knight';
    const isHovering = e.kind === 'gargoyle' || e.kind === 'frost_mage';
    const elev = isHovering
      ? 4.6 + Math.sin(t * 4.2 + e.x) * 1.6
      : Math.abs(Math.sin(t * 5 + e.x * 0.2)) * 1.4;
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = e.id;
    ed.sprite = sp;
    ed.x = e.x;
    ed.y = e.y;
    ed.w = 16;
    ed.h = 16;
    ed.flipX = e.facingX < 0;
    ed.flash = Math.min(1, e.flash * 4);
    ed.elevationZ = elev;
    ed.castShadow = true;
    ed.shadowRadius = isHovering ? 6.8 : 6.4;
    ed.sortY = e.y + 16;
    entities[entityCount++] = ed;
  }

  if (s.boss) {
    const b = s.boss;
    const bw = b.sprite === 'slime_king' || b.sprite === 'boss_ufo' ? 32 : 24;
    const bossHover =
      b.sprite === 'boss_ufo' || b.sprite === 'dragon' || b.sprite === 'frost_mage'
        ? 5.2 + Math.sin(t * 3.0) * 2.0
        : 1.5 + Math.abs(Math.sin(t * 3.6)) * 2.4;
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = 'chapter-boss';
    ed.sprite = b.sprite;
    ed.x = b.x;
    ed.y = b.y;
    ed.w = bw;
    ed.h = 22;
    ed.tint = b.phase === 2 ? '#ff708d' : b.tint;
    ed.flash = Math.min(1, b.flash * 5);
    ed.elevationZ = bossHover;
    ed.castShadow = true;
    ed.shadowRadius = bw * 0.44;
    ed.sortY = b.y + 22;
    entities[entityCount++] = ed;
    if (glow > 0.05) {
      const ld = acquireChrLight(bank.lightPool, lightCount);
      ld.x = b.x + bw * 0.5;
      ld.y = b.y + 11;
      ld.radius = b.phase === 2 ? 64 : 46;
      ld.color = b.phase === 2 ? '#ff708d' : ch.accentHex;
      ld.intensity = 0.65 * glow;
      lights[lightCount++] = ld;
    }
  }

  const moving = Math.hypot(s.hvx, s.hvy) > 12;
  const blink = s.invulnTimer > 0 && Math.floor(s.invulnTimer * 18) % 2 === 1;
  const heroElev = s.dashTimer > 0 ? 4.8 : moving ? Math.abs(Math.sin(t * 14)) * 1.8 : 0.4;
  if (!blink || s.heroFlash > 0) {
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = 'hero';
    ed.sprite = moving && Math.floor(t * 10) % 2 === 1 ? 'hero_b' : 'hero_a';
    ed.x = s.hx;
    ed.y = s.hy;
    ed.w = 16;
    ed.h = 16;
    ed.flipX = s.facingX < 0;
    ed.scaleX = s.squash.scaleX;
    ed.scaleY = s.squash.scaleY;
    ed.flash = Math.min(1, s.heroFlash * 3);
    ed.alpha = s.dashTimer > 0 ? 0.72 : 1;
    ed.elevationZ = heroElev;
    ed.castShadow = true;
    ed.shadowRadius = 6.5;
    ed.sortY = s.hy + 16;
    entities[entityCount++] = ed;
  }
  if (glow > 0.05) {
    const heroLightAlpha = ch.ambientDarkness > 0.25 ? 0.36 : 0.16;
    const ld = acquireChrLight(bank.lightPool, lightCount);
    ld.x = s.hx + 8;
    ld.y = s.hy + 8;
    ld.radius = 44;
    ld.color = '#fff3cc';
    ld.intensity = heroLightAlpha * glow;
    lights[lightCount++] = ld;
  }

  for (let i = 0; i < s.slashes.length; i++) {
    const sv = s.slashes[i];
    const alpha = Math.max(0, 1 - sv.life / sv.maxLife);
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = 'slash';
    ed.sprite = 'sword_slash';
    ed.x = sv.x - sv.size * 0.5;
    ed.y = sv.y - sv.size * 0.5;
    ed.w = sv.size;
    ed.h = sv.size;
    ed.rot = sv.angle + Math.PI * 0.25;
    ed.tint = sv.color;
    ed.alpha = alpha;
    ed.additive = true;
    ed.elevationZ = 4;
    ed.sortY = sv.y + 18;
    entities[entityCount++] = ed;
  }

  for (let i = 0; i < s.projectiles.length; i++) {
    const p = s.projectiles[i];
    const ed = acquireChrEntity(bank.entityPool, entityCount);
    ed.id = 'proj';
    ed.sprite = p.sprite;
    ed.x = p.x - p.size * 0.5;
    ed.y = p.y - p.size * 0.5;
    ed.w = p.size;
    ed.h = p.size;
    ed.tint = p.color;
    ed.additive = true;
    ed.emissive = 0.9;
    ed.elevationZ = 6;
    ed.castShadow = true;
    ed.shadowRadius = 2.8;
    ed.sortY = p.y + 16;
    entities[entityCount++] = ed;
  }

  entities.length = entityCount;
  lights.length = lightCount;

  let debugRects: DebugRectDesc[] | undefined;
  if (s.debugHitboxes) {
    let dbgCount = 0;
    const hr = acquireChrDebug(bank.debugPool, dbgCount);
    hr.x = s.hx;
    hr.y = s.hy;
    hr.w = 14;
    hr.h = 14;
    hr.color = '#56d39c';
    bank.debugRects[dbgCount++] = hr;
    for (let i = 0; i < s.enemies.length; i++) {
      const e = s.enemies[i];
      const er = acquireChrDebug(bank.debugPool, dbgCount);
      er.x = e.x;
      er.y = e.y;
      er.w = 16;
      er.h = 16;
      er.color = '#ff708d';
      bank.debugRects[dbgCount++] = er;
    }
    if (s.boss) {
      const br = acquireChrDebug(bank.debugPool, dbgCount);
      br.x = s.boss.x;
      br.y = s.boss.y;
      br.w = 28;
      br.h = 20;
      br.color = '#ffd447';
      bank.debugRects[dbgCount++] = br;
    }
    bank.debugRects.length = dbgCount;
    debugRects = bank.debugRects;
  }

  const snap = bank.snapshot;
  snap.skyTop = ch.skyTop;
  snap.skyBottom = ch.skyBottom;
  snap.cozyFilter = params.cozyFilter > 0.5;
  snap.glowIntensity = params.glowIntensity;
  snap.timeSec = t;
  snap.elapsedSec = s.elapsedSec;
  snap.status = status;
  snap.score = s.score;
  snap.comboCount = s.juice.comboCount;
  snap.starsCollected = s.openedChestIds.size;
  snap.starsTotal = TOTAL_CHESTS;
  snap.hasKey = s.gateOpen;
  snap.hearts = Math.max(0, Math.ceil((s.heroHp / s.heroMaxHp) * 5));
  snap.bossHp = s.boss?.hp ?? 0;
  snap.bossMaxHp = s.boss?.maxHp ?? 0;
  snap.cameraX = camFields.cameraX;
  snap.cameraY = camFields.cameraY;
  snap.cameraZoom = camFields.cameraZoom;
  snap.cameraLetterbox = camFields.cameraLetterbox;
  snap.ambientDarkness = ch.ambientDarkness;
  snap.ambientColor = ch.ambientColor;
  snap.screenFlashAlpha = s.juice.flashAlpha;
  snap.screenFlashColor = s.juice.flashColor;
  bank.hd2dDepth.horizonHazeColor = ch.skyTop;
  snap.bgStars = s.bgStars;
  snap.tiles = tiles;
  snap.particles = s.juice.particles;
  snap.debugRects = debugRects;
  snap.statusBanner =
    s.noticeTimer > 0
      ? s.noticeText
      : `${ch.title} · Lv.${s.heroLevel} · ${getGearById(s.equippedWeaponId).name} · 金幣 ${s.heroGold}G`;
  bank.stage.index = s.chapterIdx + 1;
  bank.stage.total = CHAPTER_SPECS.length;
  bank.stage.name = ch.title;
  snap.bgmTheme = s.boss ? 'boss' : ch.bgmTheme;
  snap.chronicleHud = buildHudSnapshot(s);
  return snap;
}
