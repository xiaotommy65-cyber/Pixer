import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import type { InputMap } from '../../core/input/InputMap.ts';
import type { CameraDirector } from '../../core/sim/CameraDirector.ts';
import type { CutsceneSequencer } from '../../core/sim/CutsceneSequencer.ts';
import type { JuiceSystem, SquashSpring } from '../../core/sim/JuiceSystem.ts';
import {
  clamp,
  type BgStarDesc,
  type ChroniclePauseTab,
  type ChronicleUiMode,
  type SimEvent,
} from '../../core/types/WorldTypes.ts';
import { CHAPTER_SPECS, getGearById } from './AstralChroniclesData.ts';
import type { ActiveBoss, ActiveEnemy, SlashVfx, WorldProjectile } from './ChronicleTypes.ts';

export interface ChronicleState {
  readonly input: InputMap;
  readonly juice: JuiceSystem;
  readonly camera: CameraDirector;
  readonly cutscene: CutsceneSequencer;

  uiMode: ChronicleUiMode;
  pauseTab: ChroniclePauseTab;
  titleCursorIdx: number;
  mapCursorIdx: number;
  bagCursorIdx: number;
  menuCooldown: number;
  debugHitboxes: boolean;

  chapterIdx: number;
  unlockedChapters: number;
  clearedChapters: Set<number>;
  bossDefeatedChapters: Set<number>;
  openedChestIds: Set<string>;
  ownedGearIds: Set<string>;
  equippedWeaponId: string;
  equippedArmorId: string;
  equippedRelicId: string;
  hasSavedState: boolean;

  heroLevel: number;
  heroXp: number;
  heroNextXp: number;
  heroHp: number;
  heroMaxHp: number;
  heroMp: number;
  heroMaxMp: number;
  heroStamina: number;
  heroMaxStamina: number;
  heroGold: number;
  heroPotions: number;
  totalKills: number;
  score: number;
  elapsedSec: number;

  hx: number;
  hy: number;
  hvx: number;
  hvy: number;
  facingX: number;
  facingY: number;
  squash: SquashSpring;
  heroFlash: number;
  invulnTimer: number;
  dashTimer: number;
  dashVx: number;
  dashVy: number;
  attackCooldown: number;
  comboStep: number;
  comboResetTimer: number;
  staminaRegenDelay: number;

  hasSlashed: boolean;
  hasDashed: boolean;
  hasUsedRelic: boolean;
  activePrompt: { label: string; targetType: 'npc' | 'chest'; id: string } | null;
  noticeText: string;
  noticeTimer: number;

  gateOpen: boolean;
  activatedSwitches: Set<string>;
  bossTriggered: boolean;
  boss: ActiveBoss | null;
  enemies: ActiveEnemy[];
  projectiles: WorldProjectile[];
  slashes: SlashVfx[];
  bgStars: BgStarDesc[];
}

export function initStarfield(): BgStarDesc[] {
  const stars: BgStarDesc[] = [];
  for (let i = 0; i < 42; i++) {
    stars.push({
      x: (i * 53 + 11) % GAME_W,
      y: (i * 31 + 7) % GAME_H,
      size: i % 5 === 0 ? 2 : 1,
      phase: i * 0.65,
      color: i % 3 === 0 ? '#ffd447' : i % 2 === 0 ? '#8ce8ff' : '#fffaf0',
    });
  }
  return stars;
}

export function getHeroAtk(s: ChronicleState): number {
  const w = getGearById(s.equippedWeaponId);
  const a = getGearById(s.equippedArmorId);
  const r = getGearById(s.equippedRelicId);
  return 8 + (s.heroLevel - 1) * 3 + w.atkBonus + a.atkBonus + r.atkBonus;
}

export function getHeroDef(s: ChronicleState): number {
  const w = getGearById(s.equippedWeaponId);
  const a = getGearById(s.equippedArmorId);
  const r = getGearById(s.equippedRelicId);
  return 1 + (s.heroLevel - 1) + w.defBonus + a.defBonus + r.defBonus;
}

export function loadChapterWorld(s: ChronicleState, idx: number, playIntro: boolean): void {
  s.chapterIdx = clamp(idx, 0, CHAPTER_SPECS.length - 1);
  const ch = CHAPTER_SPECS[s.chapterIdx];
  s.hx = ch.heroSpawn.x;
  s.hy = ch.heroSpawn.y;
  s.hvx = 0;
  s.hvy = 0;
  s.facingX = 1;
  s.facingY = 0;
  s.invulnTimer = 0.6;
  s.dashTimer = 0;
  s.attackCooldown = 0;
  s.juice.reset();
  s.gateOpen = false;
  s.activatedSwitches.clear();
  s.bossTriggered = false;
  s.boss = null;
  s.projectiles = [];
  s.slashes = [];
  s.enemies = ch.enemies.map((e) => ({
    ...e,
    vx: 0,
    vy: 0,
    maxHp: e.hp,
    aiTimer: 0.6,
    flash: 0,
    facingX: -1,
  }));

  s.camera.reset(s.hx, s.hy, 1.15, { minX: 0, minY: 0, maxX: ch.worldW, maxY: ch.worldH });
  if (playIntro) {
    s.uiMode = 'CUTSCENE';
    s.cutscene.play(ch.introCutscene);
  } else {
    s.uiMode = 'PLAYING';
    s.cutscene.clear(s.camera);
  }
  s.noticeText = `📍 ${ch.title} — ${ch.areaTitle}`;
  s.noticeTimer = 2.6;
}

export function startNewCampaign(s: ChronicleState, startChapter = 0, skipIntro = false): void {
  s.unlockedChapters = Math.max(1, startChapter + 1);
  s.clearedChapters.clear();
  s.bossDefeatedChapters.clear();
  s.openedChestIds.clear();
  s.ownedGearIds = new Set(['w_oak', 'a_cloak', 'r_burst']);
  s.equippedWeaponId = 'w_oak';
  s.equippedArmorId = 'a_cloak';
  s.equippedRelicId = 'r_burst';
  s.heroLevel = 1 + startChapter;
  s.heroXp = 0;
  s.heroNextXp = 60 + startChapter * 30;
  s.heroMaxHp = 100 + startChapter * 16;
  s.heroHp = s.heroMaxHp;
  s.heroMaxMp = 45 + startChapter * 6;
  s.heroMp = s.heroMaxMp;
  s.heroStamina = 100;
  s.heroGold = 60 + startChapter * 40;
  s.heroPotions = 2;
  s.totalKills = 0;
  s.score = 0;
  s.elapsedSec = 0;
  s.hasSavedState = true;
  loadChapterWorld(s, startChapter, !skipIntro);
}

export function collidesWall(s: ChronicleState, nx: number, ny: number, w = 13, h = 13): boolean {
  const ch = CHAPTER_SPECS[s.chapterIdx];
  if (nx < 8 || ny < 16 || nx + w > ch.worldW - 8 || ny + h > ch.worldH - 8) return true;
  for (const wall of ch.walls) {
    if (nx < wall.x + wall.w && nx + w > wall.x && ny < wall.y + wall.h && ny + h > wall.y) {
      return true;
    }
  }
  if (!s.gateOpen) {
    const g = ch.gateWall;
    if (nx < g.x + g.w && nx + w > g.x && ny < g.y + g.h && ny + h > g.y) {
      return true;
    }
  }
  return false;
}

export function grantXpAndGold(s: ChronicleState, xp: number, gold: number, events: SimEvent[]): void {
  s.heroXp += xp;
  s.heroGold += gold;
  s.score += xp * 4 + gold * 2;
  while (s.heroXp >= s.heroNextXp) {
    s.heroXp -= s.heroNextXp;
    s.heroLevel++;
    s.heroNextXp = Math.round(s.heroNextXp * 1.38);
    s.heroMaxHp += 18;
    s.heroMaxMp += 7;
    s.heroHp = s.heroMaxHp;
    s.heroMp = s.heroMaxMp;
    events.push('key');
    s.juice.triggerFlash('#ffd447', 0.28);
    s.juice.spawnBurst(s.hx + 8, s.hy + 8, ['#ffd447', '#56d39c', '#fffaf0'], 18, 1.0, {
      gravity: 0,
      liftY: -25,
    });
    s.noticeText = `🎉 升級 Lv.${s.heroLevel}！最大 HP/MP 與基礎攻防全面提升！`;
    s.noticeTimer = 3.0;
  }
}

export function damageEnemy(
  s: ChronicleState,
  idx: number,
  dmg: number,
  kbX: number,
  kbY: number,
  events: SimEvent[],
  density: number,
): void {
  const e = s.enemies[idx];
  if (!e) return;
  e.hp -= dmg;
  e.flash = 0.25;
  e.vx += kbX;
  e.vy += kbY;
  s.juice.spawnBurst(e.x + 8, e.y + 8, ['#ffd447', '#ff708d', '#fffaf0'], 6, density, { gravity: 0, liftY: 0 });
  if (e.hp <= 0) {
    s.enemies.splice(idx, 1);
    s.totalKills++;
    events.push('stomp');
    s.juice.spawnBurst(e.x + 8, e.y + 8, ['#56d39c', '#ffd447', '#fffaf0'], 11, density, { gravity: 0, liftY: 0 });
    grantXpAndGold(s, e.xp, e.gold, events);
  }
}

export function damageBoss(s: ChronicleState, dmg: number, events: SimEvent[], density: number): void {
  const boss = s.boss;
  if (!boss) return;
  boss.hp -= dmg;
  boss.flash = 0.2;
  s.juice.spawnBurst(boss.x + 14, boss.y + 10, ['#ff708d', '#ffd447', '#fffaf0'], 7, density, {
    gravity: 0,
    liftY: 0,
  });

  if (boss.phase === 1 && boss.hp > 0 && boss.hp <= boss.maxHp * 0.5) {
    boss.phase = 2;
    boss.aiTimer = 0.55;
    s.juice.applyPreset('boss_phase');
    events.push('ignite');
    s.noticeText = `🔥 ${boss.name} 狂暴化！發動第 2 階段星幕連擊！`;
    s.noticeTimer = 2.8;
  }

  if (boss.hp <= 0) {
    const ch = CHAPTER_SPECS[s.chapterIdx];
    s.boss = null;
    s.projectiles = [];
    s.clearedChapters.add(s.chapterIdx);
    s.bossDefeatedChapters.add(s.chapterIdx);
    s.unlockedChapters = Math.min(CHAPTER_SPECS.length, Math.max(s.unlockedChapters, s.chapterIdx + 2));
    s.camera.setLetterbox(0);
    s.camera.setBounds({ minX: 0, minY: 0, maxX: ch.worldW, maxY: ch.worldH });
    s.camera.resumeFollow(1.2);
    grantXpAndGold(s, ch.boss.xp, ch.boss.gold, events);
    s.juice.applyPreset('explosion', { intensity: 1.35 });

    if (s.chapterIdx + 1 >= CHAPTER_SPECS.length) {
      s.uiMode = 'ENDING';
      events.push('win');
    } else {
      s.uiMode = 'CHAPTER_CLEAR';
      events.push('key');
    }
  }
}

export function damageHero(s: ChronicleState, rawAtk: number, events: SimEvent[], density: number): void {
  if (s.invulnTimer > 0 || s.uiMode !== 'PLAYING') return;
  const dmg = Math.max(2, rawAtk - getHeroDef(s));
  s.heroHp = Math.max(0, s.heroHp - dmg);
  s.invulnTimer = 0.85;
  s.heroFlash = 0.32;
  s.juice.applyPreset('player_hurt', { dirX: -s.facingX, dirY: -s.facingY });
  events.push('hurt');
  s.juice.spawnBurst(s.hx + 8, s.hy + 8, ['#ff708d', '#fffaf0'], 9, density, { gravity: 0, liftY: 0 });
  if (s.heroHp <= 0) {
    s.uiMode = 'GAME_OVER';
  }
}
