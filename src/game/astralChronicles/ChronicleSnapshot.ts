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

export function buildChronicleSceneSnapshot(
  s: ChronicleState,
  params: RuntimeParams,
  status: 'playing' | 'won' | 'lost',
): RenderSceneSnapshot {
  const ch = CHAPTER_SPECS[s.chapterIdx];
  const t = s.juice.visualTime;
  const glow = params.glowIntensity;
  const camFields = s.camera.toSnapshotFields(s.juice.shakeX, s.juice.shakeY);
  const tiles = getStaticChapterTiles(s.chapterIdx, s.gateOpen);

  const entities: EntityDesc[] = [];
  const lights: LightDesc[] = [];

  for (const l of ch.lights) {
    if (glow > 0.05) {
      lights.push({ x: l.x, y: l.y, radius: l.radius, color: l.color, intensity: l.intensity * glow });
    }
  }

  for (const sw of ch.switches) {
    const on = s.activatedSwitches.has(sw.id);
    entities.push({
      id: sw.id,
      sprite: on ? 'switch_on' : 'switch_off',
      x: sw.x,
      y: sw.y,
      w: 16,
      h: 16,
      tint: on ? '#56d39c' : '#ffd447',
      castShadow: false,
      sortY: sw.y + 4,
    });
  }

  for (const chest of ch.chests) {
    const opened = s.openedChestIds.has(chest.id);
    entities.push({
      id: chest.id,
      sprite: opened ? 'chest_open' : 'chest_closed',
      x: chest.x,
      y: chest.y,
      w: 16,
      h: 16,
      castShadow: true,
      shadowRadius: 7,
      sortY: chest.y + 15,
    });
    if (!opened && glow > 0.05) {
      lights.push({ x: chest.x + 8, y: chest.y + 8, radius: 22, color: '#ffd447', intensity: 0.4 * glow });
    }
  }

  for (const npc of ch.npcs) {
    const elev =
      npc.kind === 'shrine'
        ? 4.2 + Math.sin(t * 2.8 + npc.x) * 1.8
        : 1.0 + Math.max(0, Math.sin(t * 2.8 + npc.x) * 1.1);
    entities.push({
      id: npc.id,
      sprite: npc.sprite,
      x: npc.x,
      y: npc.y,
      w: 16,
      h: 16,
      elevationZ: elev,
      castShadow: true,
      shadowRadius: 7.2,
      sortY: npc.y + 16,
    });
    if (glow > 0.05) {
      lights.push({
        x: npc.x + 8,
        y: npc.y + 8,
        radius: 34,
        color: npc.kind === 'shrine' ? '#5ec2f7' : '#ffd447',
        intensity: 0.42 * glow,
      });
    }
  }

  for (const e of s.enemies) {
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
    entities.push({
      id: e.id,
      sprite: sp,
      x: e.x,
      y: e.y,
      w: 16,
      h: 16,
      flipX: e.facingX < 0,
      flash: Math.min(1, e.flash * 4),
      elevationZ: elev,
      castShadow: true,
      shadowRadius: isHovering ? 6.8 : 6.4,
      sortY: e.y + 16,
    });
  }

  if (s.boss) {
    const b = s.boss;
    const bw = b.sprite === 'slime_king' || b.sprite === 'boss_ufo' ? 32 : 24;
    const bossHover =
      b.sprite === 'boss_ufo' || b.sprite === 'dragon' || b.sprite === 'frost_mage'
        ? 5.2 + Math.sin(t * 3.0) * 2.0
        : 1.5 + Math.abs(Math.sin(t * 3.6)) * 2.4;
    entities.push({
      id: 'chapter-boss',
      sprite: b.sprite,
      x: b.x,
      y: b.y,
      w: bw,
      h: 22,
      tint: b.phase === 2 ? '#ff708d' : b.tint,
      flash: Math.min(1, b.flash * 5),
      elevationZ: bossHover,
      castShadow: true,
      shadowRadius: bw * 0.44,
      sortY: b.y + 22,
    });
    if (glow > 0.05) {
      lights.push({
        x: b.x + bw * 0.5,
        y: b.y + 11,
        radius: b.phase === 2 ? 64 : 46,
        color: b.phase === 2 ? '#ff708d' : ch.accentHex,
        intensity: 0.65 * glow,
      });
    }
  }

  const moving = Math.hypot(s.hvx, s.hvy) > 12;
  const blink = s.invulnTimer > 0 && Math.floor(s.invulnTimer * 18) % 2 === 1;
  const heroElev = s.dashTimer > 0 ? 4.8 : moving ? Math.abs(Math.sin(t * 14)) * 1.8 : 0.4;
  if (!blink || s.heroFlash > 0) {
    entities.push({
      id: 'hero',
      sprite: moving && Math.floor(t * 10) % 2 === 1 ? 'hero_b' : 'hero_a',
      x: s.hx,
      y: s.hy,
      w: 16,
      h: 16,
      flipX: s.facingX < 0,
      scaleX: s.squash.scaleX,
      scaleY: s.squash.scaleY,
      flash: Math.min(1, s.heroFlash * 3),
      alpha: s.dashTimer > 0 ? 0.72 : 1,
      elevationZ: heroElev,
      castShadow: true,
      shadowRadius: 6.5,
      sortY: s.hy + 16,
    });
  }
  if (glow > 0.05) {
    const heroLightAlpha = ch.ambientDarkness > 0.25 ? 0.36 : 0.16;
    lights.push({ x: s.hx + 8, y: s.hy + 8, radius: 44, color: '#fff3cc', intensity: heroLightAlpha * glow });
  }

  for (let i = 0; i < s.slashes.length; i++) {
    const sv = s.slashes[i];
    const alpha = Math.max(0, 1 - sv.life / sv.maxLife);
    entities.push({
      id: `slash-${i}`,
      sprite: 'sword_slash',
      x: sv.x - sv.size * 0.5,
      y: sv.y - sv.size * 0.5,
      w: sv.size,
      h: sv.size,
      rot: sv.angle + Math.PI * 0.25,
      tint: sv.color,
      alpha,
      additive: true,
      elevationZ: 4,
      castShadow: false,
      sortY: sv.y + 18,
    });
  }

  for (let i = 0; i < s.projectiles.length; i++) {
    const p = s.projectiles[i];
    entities.push({
      id: `proj-${i}`,
      sprite: p.sprite,
      x: p.x - p.size * 0.5,
      y: p.y - p.size * 0.5,
      w: p.size,
      h: p.size,
      tint: p.color,
      additive: true,
      emissive: 0.9,
      elevationZ: 6,
      castShadow: true,
      shadowRadius: 2.8,
      sortY: p.y + 16,
    });
  }

  let debugRects: DebugRectDesc[] | undefined;
  if (s.debugHitboxes) {
    debugRects = [{ x: s.hx, y: s.hy, w: 14, h: 14, color: '#56d39c' }];
    for (const e of s.enemies) debugRects.push({ x: e.x, y: e.y, w: 16, h: 16, color: '#ff708d' });
    if (s.boss) debugRects.push({ x: s.boss.x, y: s.boss.y, w: 28, h: 20, color: '#ffd447' });
  }

  return {
    cartridgeId: 'astral-chronicles',
    skyTop: ch.skyTop,
    skyBottom: ch.skyBottom,
    cozyFilter: params.cozyFilter > 0.5,
    glowIntensity: params.glowIntensity,
    timeSec: t,
    elapsedSec: s.elapsedSec,
    status,
    score: s.score,
    comboCount: s.juice.comboCount,
    starsCollected: s.openedChestIds.size,
    starsTotal: CHAPTER_SPECS.reduce((acc, c) => acc + c.chests.length, 0),
    hasKey: s.gateOpen,
    hearts: Math.max(0, Math.ceil((s.heroHp / s.heroMaxHp) * 5)),
    maxHearts: 5,
    bossHp: s.boss?.hp ?? 0,
    bossMaxHp: s.boss?.maxHp ?? 0,
    cameraX: camFields.cameraX,
    cameraY: camFields.cameraY,
    cameraZoom: camFields.cameraZoom,
    cameraLetterbox: camFields.cameraLetterbox,
    ambientDarkness: ch.ambientDarkness,
    ambientColor: ch.ambientColor,
    screenFlashAlpha: s.juice.flashAlpha,
    screenFlashColor: s.juice.flashColor,
    hd2dDepth: {
      enabled: true,
      sortByDepthY: true,
      perspectiveSkew: 0.055,
      horizonHazeColor: ch.skyTop,
      horizonHazeAlpha: 0.16,
      tiltShiftAlpha: 0.14,
    },
    bgStars: s.bgStars,
    bgClouds: [],
    tiles,
    entities,
    particles: s.juice.particles,
    lights,
    debugRects,
    statusBanner:
      s.noticeTimer > 0
        ? s.noticeText
        : `${ch.title} · Lv.${s.heroLevel} · ${getGearById(s.equippedWeaponId).name} · 金幣 ${s.heroGold}G`,
    stage: {
      index: s.chapterIdx + 1,
      total: CHAPTER_SPECS.length,
      name: ch.title,
    },
    bgmTheme: s.boss ? 'boss' : ch.bgmTheme,
    chronicleHud: buildHudSnapshot(s),
  };
}
