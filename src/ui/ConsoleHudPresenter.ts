import {
  getCartridgeControlProfile,
  shouldBypassTouchActionAutofire,
} from '../core/runtime/CartridgeRegistry.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { GpuFrameStats } from '../core/gpu/GpuTypes.ts';
import type { CartridgeId, CartridgeMeta, RenderSceneSnapshot } from '../core/types/WorldTypes.ts';
import type { ShmupOverlayView } from './ShmupOverlayView.ts';

export interface ConsoleHudRefs {
  stageTag: HTMLElement;
  scoreTag: HTMLElement;
  starTag: HTMLElement;
  spriteStatTag: HTMLElement;
  fpsTag: HTMLElement;
  statusHintEl: HTMLElement;
  resultOverlay: HTMLElement;
  resultTitle: HTMLElement;
  resultDesc: HTMLElement;
  clearSaveBtn: HTMLButtonElement;
  bodyLegendEl: HTMLElement;
  aSubEl: HTMLElement;
  bSubEl: HTMLElement;
  xSubEl: HTMLElement;
  ySubEl: HTMLElement;
  lSubEl: HTMLElement;
  rSubEl: HTMLElement;
  auxLSubEl: HTMLElement;
  auxRSubEl: HTMLElement;
  shmupOverlay: ShmupOverlayView;
}

export interface ConsoleHudCallbacks {
  setAutofireBlocked: (blocked: boolean) => void;
  onRecordSaved: (id: CartridgeId) => void;
}

/**
 * Coordinates the handheld top bar metrics, overlay banners, cartridge SRAM
 * clear-button visibility, and context-sensitive Joy-Con label updates.
 */
export class ConsoleHudPresenter {
  private readonly host: EngineHost;
  private readonly refs: ConsoleHudRefs;
  private readonly cb: ConsoleHudCallbacks;
  private lastBannerState: 'playing' | 'won' | 'lost' = 'playing';
  private lastProfileId: CartridgeId | null | undefined = undefined;
  private lastShmupPhase = '';
  private lastRpgMode = '';
  private lastChronicleMode = '';
  private lastStageHidden: boolean | null = null;
  private lastStageIndex = -1;
  private lastStageTotal = -1;
  private lastStageName = '';
  private lastStageText = '';
  private lastScore = -1;
  private lastCombo = -1;
  private lastScoreText = '';
  private lastStarsCollected = -1;
  private lastStarsTotal = -1;
  private lastStarText = '';
  private lastSpriteCount = -1;
  private lastDrawCalls = -1;
  private lastSpriteStatText = '';
  private lastFpsRounded = -1;
  private lastFpsText = '';
  private lastStatusHint = '';
  private lastClearSaveHidden: boolean | null = null;
  private lastRecordCartridgeId: CartridgeId | null = null;
  private lastRecordScore = -1;
  private lastRecordStars = -1;
  private lastRecordStatus: 'playing' | 'won' | 'lost' | '' = '';
  private lastRecordSaveMs = -1000;

  constructor(host: EngineHost, refs: ConsoleHudRefs, callbacks: ConsoleHudCallbacks) {
    this.host = host;
    this.refs = refs;
    this.cb = callbacks;
  }

  public resetOverlays(): void {
    this.refs.shmupOverlay.reset();
  }

  public destroy(): void {
    this.refs.shmupOverlay.destroy();
  }

  private setStageDisplay(visible: boolean, text = ''): void {
    if (this.lastStageHidden !== !visible) {
      this.lastStageHidden = !visible;
      this.refs.stageTag.classList.toggle('panel-hidden', !visible);
    }
    if (visible && this.lastStageText !== text) {
      this.lastStageText = text;
      this.refs.stageTag.textContent = text;
    }
  }

  private setStatusHint(text: string): void {
    if (this.lastStatusHint !== text) {
      this.lastStatusHint = text;
      this.refs.statusHintEl.textContent = text;
    }
  }

  private resetRecordThrottle(): void {
    this.lastRecordCartridgeId = null;
    this.lastRecordScore = -1;
    this.lastRecordStars = -1;
    this.lastRecordStatus = '';
    this.lastRecordSaveMs = -1000;
  }

  public showBeforeBoot(id: CartridgeId, resumedSram: boolean, meta: CartridgeMeta): void {
    this.lastBannerState = 'playing';
    this.lastStageIndex = -1;
    this.lastStageTotal = -1;
    this.lastStageName = '';
    this.lastScore = -1;
    this.lastCombo = -1;
    this.lastStarsCollected = -1;
    this.lastStarsTotal = -1;
    this.resetRecordThrottle();
    this.resetOverlays();
    this.refs.resultOverlay.classList.add('panel-hidden');
    this.setStatusHint(
      resumedSram ? `💾 已讀取 SRAM 續關進度｜${meta.controlsHint}` : meta.controlsHint,
    );
    this.updateControlLabels(id);
  }

  public showEmpty(): void {
    this.resetOverlays();
    this.lastStageIndex = -1;
    this.lastStageTotal = -1;
    this.lastStageName = '';
    this.setStageDisplay(false);
    this.refs.resultOverlay.classList.add('panel-hidden');
    this.lastScore = 0;
    this.lastCombo = 0;
    if (this.lastScoreText !== '分數 0') {
      this.lastScoreText = '分數 0';
      this.refs.scoreTag.textContent = '分數 0';
    }
    this.lastStarsCollected = 0;
    this.lastStarsTotal = 0;
    if (this.lastStarText !== '★ 0/0') {
      this.lastStarText = '★ 0/0';
      this.refs.starTag.textContent = '★ 0/0';
    }
    this.resetRecordThrottle();
    this.setStatusHint('從大廳挑選遊戲卡匣即可開始冒險！');
    this.updateControlLabels(null);
  }

  public updateStats(stats: GpuFrameStats, fps: number): void {
    if (stats.spriteCount !== this.lastSpriteCount || stats.drawCalls !== this.lastDrawCalls) {
      this.lastSpriteCount = stats.spriteCount;
      this.lastDrawCalls = stats.drawCalls;
      const statText = `精靈 ${stats.spriteCount} · ${stats.drawCalls} draws`;
      if (this.lastSpriteStatText !== statText) {
        this.lastSpriteStatText = statText;
        this.refs.spriteStatTag.textContent = statText;
      }
    }
    const fpsRounded = Math.round(fps);
    if (fpsRounded !== this.lastFpsRounded) {
      this.lastFpsRounded = fpsRounded;
      const fpsText = `${fpsRounded} FPS`;
      if (this.lastFpsText !== fpsText) {
        this.lastFpsText = fpsText;
        this.refs.fpsTag.textContent = fpsText;
      }
    }
  }

  public updateHud(
    snap: RenderSceneSnapshot,
    stats: GpuFrameStats,
    fps: number,
    isRunning: boolean,
    insertedId: CartridgeId | null,
  ): void {
    if (snap.stage) {
      if (
        this.lastStageHidden !== false ||
        snap.stage.index !== this.lastStageIndex ||
        snap.stage.total !== this.lastStageTotal ||
        snap.stage.name !== this.lastStageName
      ) {
        this.lastStageIndex = snap.stage.index;
        this.lastStageTotal = snap.stage.total;
        this.lastStageName = snap.stage.name;
        this.setStageDisplay(true, `${snap.stage.index}/${snap.stage.total} · ${snap.stage.name}`);
      }
    } else if (this.lastStageHidden !== true) {
      this.lastStageIndex = -1;
      this.lastStageTotal = -1;
      this.lastStageName = '';
      this.setStageDisplay(false);
    }
    const combo = snap.comboCount && snap.comboCount > 1 ? snap.comboCount : 0;
    if (snap.score !== this.lastScore || combo !== this.lastCombo) {
      this.lastScore = snap.score;
      this.lastCombo = combo;
      const comboStr = combo > 1 ? ` · ×${combo}` : '';
      const scoreText = `分數 ${snap.score}${comboStr}`;
      if (this.lastScoreText !== scoreText) {
        this.lastScoreText = scoreText;
        this.refs.scoreTag.textContent = scoreText;
      }
    }
    if (snap.starsCollected !== this.lastStarsCollected || snap.starsTotal !== this.lastStarsTotal) {
      this.lastStarsCollected = snap.starsCollected;
      this.lastStarsTotal = snap.starsTotal;
      const starText = `★ ${snap.starsCollected}/${snap.starsTotal}`;
      if (this.lastStarText !== starText) {
        this.lastStarText = starText;
        this.refs.starTag.textContent = starText;
      }
    }
    this.updateStats(stats, fps);
    this.setStatusHint(snap.statusBanner);

    this.refs.shmupOverlay.render(snap.shmupHud, isRunning);

    this.updateControlLabels(insertedId, snap);
    if (insertedId) {
      const clearHidden = !this.host.hasSram(insertedId);
      if (this.lastClearSaveHidden !== clearHidden) {
        this.lastClearSaveHidden = clearHidden;
        this.refs.clearSaveBtn.classList.toggle('panel-hidden', clearHidden);
      }
      const recordChanged =
        insertedId !== this.lastRecordCartridgeId ||
        snap.score !== this.lastRecordScore ||
        snap.starsCollected !== this.lastRecordStars ||
        snap.status !== this.lastRecordStatus;
      if (recordChanged) {
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const isTerminal = snap.status === 'won' || snap.status === 'lost';
        if (isTerminal || nowMs - this.lastRecordSaveMs >= 1000) {
          this.lastRecordCartridgeId = insertedId;
          this.lastRecordScore = snap.score;
          this.lastRecordStars = snap.starsCollected;
          this.lastRecordStatus = snap.status;
          this.lastRecordSaveMs = nowMs;
          if (this.host.saveRecord(insertedId, snap)) {
            this.cb.onRecordSaved(insertedId);
          }
        }
      }
    }

    if (snap.status !== this.lastBannerState) {
      this.lastBannerState = snap.status;
      if (snap.chronicleHud) {
        this.refs.resultOverlay.classList.add('panel-hidden');
        if (snap.status === 'won') this.host.reactMomo();
      } else if (snap.status === 'won') {
        this.refs.resultTitle.textContent = snap.rpgHud
          ? '🐉 餘燼深淵制霸通關！'
          : snap.shmupHud
            ? '🌠 四大星區制霸！星光凱旋！'
            : '🎉 太棒了！全關卡制霸！';
        this.refs.resultDesc.textContent = `總分 ${snap.score} 分，Momo 開心到在卡槽旁邊跳舞！`;
        this.refs.resultOverlay.classList.remove('panel-hidden');
        this.host.reactMomo();
      } else if (snap.status === 'lost') {
        this.refs.resultTitle.textContent = snap.rpgHud
          ? '💀 冒險者力竭倒下…'
          : snap.shmupHud
            ? '💥 戰機護盾歸零…'
            : '💫 愛心用完囉～';
        this.refs.resultDesc.textContent = snap.rpgHud
          ? '英雄在餘燼迷宮力竭了，可重試本層營火點或從 B1 重頭攻略！'
          : '點擊「重試本關」可直接從檢查點／本關繼續，或調整積木工房參數！';
        this.refs.resultOverlay.classList.remove('panel-hidden');
      } else {
        this.refs.resultOverlay.classList.add('panel-hidden');
      }
    }
  }

  public updateControlLabels(id: CartridgeId | null, snap?: RenderSceneSnapshot): void {
    const shmupPhase = snap?.shmupHud?.phase ?? '';
    const rpgMode = snap?.rpgHud?.mode ?? '';
    const chronicleMode = snap?.chronicleHud?.uiMode ?? '';
    if (
      id === this.lastProfileId &&
      shmupPhase === this.lastShmupPhase &&
      rpgMode === this.lastRpgMode &&
      chronicleMode === this.lastChronicleMode
    ) {
      return;
    }
    this.lastProfileId = id;
    this.lastShmupPhase = shmupPhase;
    this.lastRpgMode = rpgMode;
    this.lastChronicleMode = chronicleMode;

    this.cb.setAutofireBlocked(id ? shouldBypassTouchActionAutofire(id) : false);
    const prof = getCartridgeControlProfile(id, snap);
    this.refs.aSubEl.textContent = prof.a;
    this.refs.bSubEl.textContent = prof.b;
    this.refs.xSubEl.textContent = prof.x;
    this.refs.ySubEl.textContent = prof.y;
    this.refs.lSubEl.textContent = prof.l;
    this.refs.rSubEl.textContent = prof.r;
    this.refs.auxLSubEl.textContent = prof.l;
    this.refs.auxRSubEl.textContent = prof.r;
    this.refs.bodyLegendEl.textContent = prof.legend;
  }
}
