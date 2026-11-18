import { GAME_W } from '../../core/gpu/GpuTypes.ts';
import { InputMap } from '../../core/input/InputMap.ts';
import { CameraDirector } from '../../core/sim/CameraDirector.ts';
import { CutsceneSequencer } from '../../core/sim/CutsceneSequencer.ts';
import { JuiceSystem, stepSquashSpring } from '../../core/sim/JuiceSystem.ts';
import {
  clamp,
  type ChronicleUiMode,
  type ComboTrackingCartridge,
  type DebuggableCartridge,
  type InputState,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type SimEvent,
} from '../../core/types/WorldTypes.ts';
import { CHAPTER_SPECS, getGearById } from './AstralChroniclesData.ts';
import {
  castRelicSkill,
  collidesWall,
  getHeroAtk,
  getHeroDef,
  initStarfield,
  loadChapterWorld,
  performAttack,
  performDash,
  startNewCampaign,
  stepCombatActors,
  type ChronicleState,
} from './ChronicleCombat.ts';
import {
  dispatchChronicleCommand,
  handleDialogChoice,
  interactNearby,
  tryUsePotion,
  updateMenuNavigation,
} from './ChronicleMenus.ts';
import { buildChronicleSceneSnapshot } from './ChronicleSnapshot.ts';

/**
 * PA-05 Flagship Action-Adventure RPG: 《星穹餘燼編年史》 (Astral Chronicles)
 * Orchestrates 5 Multi-area Story Chapters, CameraDirector, CutsceneSequencer,
 * Combat & Boss encounters, and SRAM persistence.
 */
export class AstralChroniclesGame implements DebuggableCartridge, ComboTrackingCartridge {
  public readonly camera = new CameraDirector();
  public readonly cutscene = new CutsceneSequencer();
  private readonly state: ChronicleState;

  constructor(startDirectInChapter?: number) {
    this.state = {
      input: new InputMap(),
      juice: new JuiceSystem(),
      camera: this.camera,
      cutscene: this.cutscene,
      uiMode: 'TITLE_MENU',
      pauseTab: 'status',
      titleCursorIdx: 0,
      mapCursorIdx: 0,
      bagCursorIdx: 0,
      menuCooldown: 0,
      debugHitboxes: false,
      chapterIdx: 0,
      unlockedChapters: 1,
      clearedChapters: new Set(),
      bossDefeatedChapters: new Set(),
      openedChestIds: new Set(),
      ownedGearIds: new Set(['w_oak', 'a_cloak', 'r_burst']),
      equippedWeaponId: 'w_oak',
      equippedArmorId: 'a_cloak',
      equippedRelicId: 'r_burst',
      hasSavedState: false,
      heroLevel: 1,
      heroXp: 0,
      heroNextXp: 60,
      heroHp: 100,
      heroMaxHp: 100,
      heroMp: 45,
      heroMaxMp: 45,
      heroStamina: 100,
      heroMaxStamina: 100,
      heroGold: 60,
      heroPotions: 2,
      totalKills: 0,
      score: 0,
      elapsedSec: 0,
      hx: 46,
      hy: 150,
      hvx: 0,
      hvy: 0,
      facingX: 1,
      facingY: 0,
      squash: { scaleX: 1, scaleY: 1 },
      heroFlash: 0,
      invulnTimer: 0,
      dashTimer: 0,
      dashVx: 0,
      dashVy: 0,
      attackCooldown: 0,
      comboStep: 0,
      comboResetTimer: 0,
      staminaRegenDelay: 0,
      hasSlashed: false,
      hasDashed: false,
      hasUsedRelic: false,
      activePrompt: null,
      noticeText: '',
      noticeTimer: 0,
      gateOpen: false,
      activatedSwitches: new Set(),
      bossTriggered: false,
      boss: null,
      enemies: [],
      projectiles: [],
      slashes: [],
      bgStars: initStarfield(),
    };

    this.cutscene.setCallbacks({
      onChoice: (choiceId) => handleDialogChoice(this.state, choiceId),
    });

    if (typeof startDirectInChapter === 'number') {
      this.state.unlockedChapters = Math.max(this.state.unlockedChapters, startDirectInChapter + 1);
      this.startNewCampaign(startDirectInChapter, true);
    } else {
      loadChapterWorld(this.state, 0, false);
      this.state.uiMode = 'TITLE_MENU';
      this.camera.reset(260, 150, 0.86, { minX: 0, minY: 0, maxX: 540, maxY: 300 });
    }
  }

  public setDebugHitboxes(enabled: boolean): void {
    this.state.debugHitboxes = enabled;
  }

  public getComboCount(): number {
    return this.state.juice.comboCount;
  }

  public getUiMode(): ChronicleUiMode {
    return this.state.uiMode;
  }

  public getHeroAtk(): number {
    return getHeroAtk(this.state);
  }

  public getHeroDef(): number {
    return getHeroDef(this.state);
  }

  public startNewCampaign(startChapter = 0, skipIntro = false): void {
    startNewCampaign(this.state, startChapter, skipIntro);
  }

  public dispatchCommand(commandId: string): SimEvent[] {
    return dispatchChronicleCommand(this.state, commandId, () => this.retryStage());
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    const s = this.state;
    const events: SimEvent[] = [];
    s.input.update(rawInput, dt);
    const simDt = s.juice.advanceRealTime(dt, params.shakeScale);
    if (s.noticeTimer > 0) s.noticeTimer = Math.max(0, s.noticeTimer - dt);

    const ch = CHAPTER_SPECS[s.chapterIdx];
    for (const star of s.bgStars) {
      star.x -= 6 * dt;
      if (star.x < 0) star.x += GAME_W;
    }

    if (s.uiMode === 'TITLE_MENU') {
      const orbitX = 270 + Math.sin(s.juice.visualTime * 0.4) * 140;
      const orbitY = 150 + Math.cos(s.juice.visualTime * 0.3) * 40;
      this.camera.setTargetZoom(0.88);
      this.camera.step(dt, orbitX, orbitY, 0, 0);
      updateMenuNavigation(s, dt, events, () => this.retryStage());
      return events;
    }

    if (s.uiMode === 'CUTSCENE') {
      this.cutscene.step(dt, this.camera);
      this.camera.step(dt, s.hx + 8, s.hy + 8, 0, 0);
      updateMenuNavigation(s, dt, events, () => this.retryStage());
      if (!this.cutscene.isActive() && s.uiMode === 'CUTSCENE') {
        s.uiMode = 'PLAYING';
      }
      return events;
    }

    if (s.uiMode !== 'PLAYING') {
      this.camera.step(dt, s.hx + 8, s.hy + 8, 0, 0);
      updateMenuNavigation(s, dt, events, () => this.retryStage());
      return events;
    }

    if (s.input.justPressed('skillX')) {
      this.dispatchCommand('toggle_pause');
      return events;
    }
    if (s.input.justPressed('shoulderL')) {
      this.dispatchCommand('open_world_map');
      return events;
    }

    if (simDt <= 0) return events;
    s.elapsedSec += simDt;

    if (s.invulnTimer > 0) s.invulnTimer = Math.max(0, s.invulnTimer - simDt);
    if (s.heroFlash > 0) s.heroFlash = Math.max(0, s.heroFlash - simDt * 5);
    if (s.attackCooldown > 0) s.attackCooldown = Math.max(0, s.attackCooldown - simDt);
    if (s.comboResetTimer > 0) {
      s.comboResetTimer -= simDt;
      if (s.comboResetTimer <= 0) s.comboStep = 0;
    }
    if (s.staminaRegenDelay > 0) {
      s.staminaRegenDelay = Math.max(0, s.staminaRegenDelay - simDt);
    } else {
      s.heroStamina = Math.min(s.heroMaxStamina, s.heroStamina + 34 * simDt);
    }
    s.heroMp = Math.min(s.heroMaxMp, s.heroMp + 1.8 * simDt);
    stepSquashSpring(s.squash, simDt, 15);

    const armor = getGearById(s.equippedArmorId);
    const moveSpd = params.moveSpeed * 1.1 * armor.speedScale;
    let mx = s.input.axisX();
    let my = s.input.axisY();
    if (mx !== 0 || my !== 0) {
      const len = Math.max(1, Math.hypot(mx, my));
      mx /= len;
      my /= len;
      s.facingX = mx;
      s.facingY = my;
    }

    if (s.dashTimer > 0) {
      s.dashTimer = Math.max(0, s.dashTimer - simDt);
      s.hvx = s.dashVx;
      s.hvy = s.dashVy;
    } else {
      const blend = Math.min(1, simDt * 18);
      s.hvx += (mx * moveSpd - s.hvx) * blend;
      s.hvy += (my * moveSpd - s.hvy) * blend;
    }

    const nextX = s.hx + s.hvx * simDt;
    if (!collidesWall(s, nextX, s.hy)) s.hx = nextX;
    const nextY = s.hy + s.hvy * simDt;
    if (!collidesWall(s, s.hx, nextY)) s.hy = nextY;

    s.activePrompt = null;
    for (const chest of ch.chests) {
      if (!s.openedChestIds.has(chest.id) && Math.hypot(s.hx - chest.x, s.hy - chest.y) < 28) {
        s.activePrompt = { label: '按 A 開啟寶箱', targetType: 'chest', id: chest.id };
        break;
      }
    }
    if (!s.activePrompt) {
      for (const npc of ch.npcs) {
        if (Math.hypot(s.hx - npc.x, s.hy - npc.y) < 30) {
          s.activePrompt = { label: `按 A 與「${npc.name}」互動`, targetType: 'npc', id: npc.id };
          break;
        }
      }
    }

    if (s.input.justPressed('skillY')) castRelicSkill(s, events);
    if (s.input.justPressed('shoulderR')) tryUsePotion(s, events);
    if (s.input.justPressed('action')) {
      if (!interactNearby(s, events) && s.attackCooldown <= 0) {
        performAttack(s, events, params.sparkleDensity);
      }
    }
    if (s.input.justPressed('jump')) performDash(s, events, params.sparkleDensity);

    if (!s.gateOpen) {
      for (const sw of ch.switches) {
        if (!s.activatedSwitches.has(sw.id) && Math.hypot(s.hx - sw.x, s.hy - sw.y) < 18) {
          s.activatedSwitches.add(sw.id);
          events.push('bounce');
          s.juice.spawnBurst(sw.x + 8, sw.y + 8, ['#56d39c', '#ffd447'], 10, params.sparkleDensity, {
            gravity: 0,
            liftY: 0,
          });
          if (s.activatedSwitches.size >= ch.switchesRequired) {
            s.gateOpen = true;
            events.push('key');
            s.noticeText = '🔓 星界封印解除！通往守關 Boss 殿堂的大門已開啟！';
            s.noticeTimer = 2.8;
          } else {
            s.noticeText = `✨ 已啟動機關 (${s.activatedSwitches.size}/${ch.switchesRequired})`;
            s.noticeTimer = 2.2;
          }
        }
      }
    }

    if (!s.bossTriggered && s.hx >= ch.boss.triggerX) {
      s.bossTriggered = true;
      s.boss = {
        ...ch.boss,
        vx: 0,
        vy: 0,
        maxHp: ch.boss.hp,
        phase: 1,
        aiTimer: 0.8,
        flash: 0,
      };
      this.camera.setBounds({ minX: ch.gateWall.x + 12, minY: 0, maxX: ch.worldW, maxY: ch.worldH });
      s.uiMode = 'CUTSCENE';
      this.cutscene.play(ch.bossCutscene);
      return events;
    }

    const desiredZoom = s.boss ? 1.05 : Math.hypot(s.hvx, s.hvy) > 40 ? 1.15 : 1.24;
    this.camera.setTargetZoom(desiredZoom);
    const lookX = s.input.rightAxisX() * 56;
    const lookY = s.input.rightAxisY() * 42;
    this.camera.step(simDt, s.hx + 8 + lookX, s.hy + 8 + lookY, s.hvx, s.hvy);

    stepCombatActors(s, simDt, events, params);
    return events;
  }

  public retryStage(): void {
    this.state.heroHp = this.state.heroMaxHp;
    this.state.heroMp = this.state.heroMaxMp;
    this.state.heroStamina = this.state.heroMaxStamina;
    loadChapterWorld(this.state, this.state.chapterIdx, false);
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    if (this.state.uiMode === 'ENDING') return 'won';
    if (this.state.uiMode === 'GAME_OVER') return 'lost';
    return 'playing';
  }

  public serializeSave(): unknown {
    const s = this.state;
    return {
      v: 1,
      chapterIdx: s.chapterIdx,
      unlockedChapters: s.unlockedChapters,
      clearedChapters: Array.from(s.clearedChapters),
      bossDefeatedChapters: Array.from(s.bossDefeatedChapters),
      openedChestIds: Array.from(s.openedChestIds),
      ownedGearIds: Array.from(s.ownedGearIds),
      equippedWeaponId: s.equippedWeaponId,
      equippedArmorId: s.equippedArmorId,
      equippedRelicId: s.equippedRelicId,
      heroLevel: s.heroLevel,
      heroXp: s.heroXp,
      heroNextXp: s.heroNextXp,
      heroHp: Math.max(1, s.heroHp),
      heroMaxHp: s.heroMaxHp,
      heroMp: s.heroMp,
      heroMaxMp: s.heroMaxMp,
      heroGold: s.heroGold,
      heroPotions: s.heroPotions,
      totalKills: s.totalKills,
      score: s.score,
    };
  }

  public hydrateSave(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const d = raw as {
      v?: number;
      chapterIdx?: number;
      unlockedChapters?: number;
      clearedChapters?: number[];
      bossDefeatedChapters?: number[];
      openedChestIds?: string[];
      ownedGearIds?: string[];
      equippedWeaponId?: string;
      equippedArmorId?: string;
      equippedRelicId?: string;
      heroLevel?: number;
      heroXp?: number;
      heroNextXp?: number;
      heroHp?: number;
      heroMaxHp?: number;
      heroMp?: number;
      heroMaxMp?: number;
      heroGold?: number;
      heroPotions?: number;
      totalKills?: number;
      score?: number;
    };
    if (d.v !== 1 || typeof d.chapterIdx !== 'number') return false;

    const s = this.state;
    s.unlockedChapters = clamp(Number(d.unlockedChapters ?? 1), 1, CHAPTER_SPECS.length);
    s.clearedChapters = new Set(Array.isArray(d.clearedChapters) ? d.clearedChapters : []);
    s.bossDefeatedChapters = new Set(Array.isArray(d.bossDefeatedChapters) ? d.bossDefeatedChapters : []);
    s.openedChestIds = new Set(Array.isArray(d.openedChestIds) ? d.openedChestIds : []);
    s.ownedGearIds = new Set(
      Array.isArray(d.ownedGearIds) && d.ownedGearIds.length > 0 ? d.ownedGearIds : ['w_oak', 'a_cloak', 'r_burst'],
    );
    s.equippedWeaponId = d.equippedWeaponId ?? 'w_oak';
    s.equippedArmorId = d.equippedArmorId ?? 'a_cloak';
    s.equippedRelicId = d.equippedRelicId ?? 'r_burst';
    s.heroLevel = Math.max(1, Number(d.heroLevel ?? 1));
    s.heroXp = Math.max(0, Number(d.heroXp ?? 0));
    s.heroNextXp = Math.max(30, Number(d.heroNextXp ?? 60));
    s.heroMaxHp = Math.max(80, Number(d.heroMaxHp ?? 100));
    s.heroHp = clamp(Number(d.heroHp ?? s.heroMaxHp), 1, s.heroMaxHp);
    s.heroMaxMp = Math.max(30, Number(d.heroMaxMp ?? 45));
    s.heroMp = clamp(Number(d.heroMp ?? s.heroMaxMp), 0, s.heroMaxMp);
    s.heroGold = Math.max(0, Number(d.heroGold ?? 60));
    s.heroPotions = Math.max(0, Number(d.heroPotions ?? 2));
    s.totalKills = Math.max(0, Number(d.totalKills ?? 0));
    s.score = Math.max(0, Number(d.score ?? 0));
    s.hasSavedState = true;
    loadChapterWorld(s, clamp(d.chapterIdx, 0, CHAPTER_SPECS.length - 1), false);
    s.uiMode = 'TITLE_MENU';
    return true;
  }

  public snapshot(params: RuntimeParams): RenderSceneSnapshot {
    return buildChronicleSceneSnapshot(this.state, params, this.getStatus());
  }
}
