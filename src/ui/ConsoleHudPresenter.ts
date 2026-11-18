import {
  getCartridgeControlProfile,
  shouldBypassTouchActionAutofire,
} from '../core/runtime/CartridgeRegistry.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { GpuFrameStats } from '../core/gpu/GpuTypes.ts';
import type { CartridgeId, CartridgeMeta, RenderSceneSnapshot } from '../core/types/WorldTypes.ts';
import type { ChronicleOverlayView } from './ChronicleOverlayView.ts';
import type { RpgOverlayView } from './RpgOverlayView.ts';
import type { ShmupOverlayView } from './ShmupOverlayView.ts';

export interface ConsoleHudRefs {
  stageTag: HTMLElement;
  scoreTag: HTMLElement;
  starTag: HTMLElement;
  spriteStatTag: HTMLElement;
  fpsTag: HTMLElement;
  statusHintEl: HTMLElement;
  insertPrompt?: HTMLElement;
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
  rpgOverlay: RpgOverlayView;
  shmupOverlay: ShmupOverlayView;
  chronicleOverlay: ChronicleOverlayView;
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
  private lastProfileKey = '';
  private lastStageHidden: boolean | null = null;
  private lastStageText = '';
  private lastScoreText = '';
  private lastStarText = '';
  private lastSpriteStatText = '';
  private lastFpsText = '';
  private lastStatusHint = '';
  private lastClearSaveHidden: boolean | null = null;

  constructor(host: EngineHost, refs: ConsoleHudRefs, callbacks: ConsoleHudCallbacks) {
    this.host = host;
    this.refs = refs;
    this.cb = callbacks;
  }

  public resetOverlays(): void {
    this.refs.rpgOverlay.reset();
    this.refs.shmupOverlay.reset();
    this.refs.chronicleOverlay.reset();
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

  public showBeforeBoot(id: CartridgeId, resumedSram: boolean, meta: CartridgeMeta): void {
    this.lastBannerState = 'playing';
    this.resetOverlays();
    this.refs.resultOverlay.classList.add('panel-hidden');
    this.refs.insertPrompt?.classList.add('panel-hidden');
    this.setStatusHint(
      resumedSram ? `💾 已讀取 SRAM 續關進度｜${meta.controlsHint}` : meta.controlsHint,
    );
    this.updateControlLabels(id);
  }

  public showEmpty(): void {
    this.resetOverlays();
    this.setStageDisplay(false);
    this.refs.insertPrompt?.classList.remove('panel-hidden');
    this.refs.resultOverlay.classList.add('panel-hidden');
    if (this.lastScoreText !== '分數 0') {
      this.lastScoreText = '分數 0';
      this.refs.scoreTag.textContent = '分數 0';
    }
    if (this.lastStarText !== '★ 0/0') {
      this.lastStarText = '★ 0/0';
      this.refs.starTag.textContent = '★ 0/0';
    }
    this.setStatusHint('從大廳挑選遊戲卡匣即可開始冒險！');
    this.updateControlLabels(null);
  }

  public updateStats(stats: GpuFrameStats, fps: number): void {
    const statText = `精靈 ${stats.spriteCount} · ${stats.drawCalls} draws`;
    if (this.lastSpriteStatText !== statText) {
      this.lastSpriteStatText = statText;
      this.refs.spriteStatTag.textContent = statText;
    }
    const fpsRounded = Math.round(fps);
    const fpsText = `${fpsRounded} FPS`;
    if (this.lastFpsText !== fpsText) {
      this.lastFpsText = fpsText;
      this.refs.fpsTag.textContent = fpsText;
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
      this.setStageDisplay(true, `${snap.stage.index}/${snap.stage.total} · ${snap.stage.name}`);
    } else {
      this.setStageDisplay(false);
    }
    const comboStr = snap.comboCount && snap.comboCount > 1 ? ` · ×${snap.comboCount}` : '';
    const scoreText = `分數 ${snap.score}${comboStr}`;
    if (this.lastScoreText !== scoreText) {
      this.lastScoreText = scoreText;
      this.refs.scoreTag.textContent = scoreText;
    }
    const starText = `★ ${snap.starsCollected}/${snap.starsTotal}`;
    if (this.lastStarText !== starText) {
      this.lastStarText = starText;
      this.refs.starTag.textContent = starText;
    }
    this.updateStats(stats, fps);
    this.setStatusHint(snap.statusBanner);

    this.refs.rpgOverlay.render(snap.rpgHud, isRunning);
    this.refs.shmupOverlay.render(snap.shmupHud, isRunning);
    this.refs.chronicleOverlay.render(snap.chronicleHud, isRunning);

    this.updateControlLabels(insertedId, snap);
    if (insertedId) {
      const clearHidden = !this.host.hasSram(insertedId);
      if (this.lastClearSaveHidden !== clearHidden) {
        this.lastClearSaveHidden = clearHidden;
        this.refs.clearSaveBtn.classList.toggle('panel-hidden', clearHidden);
      }
      if (this.host.saveRecord(insertedId, snap)) {
        this.cb.onRecordSaved(insertedId);
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
    const key = `${id ?? 'empty'}|${snap?.shmupHud?.phase ?? ''}|${snap?.rpgHud?.mode ?? ''}|${snap?.chronicleHud?.uiMode ?? ''}`;
    if (key === this.lastProfileKey) return;
    this.lastProfileKey = key;

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
