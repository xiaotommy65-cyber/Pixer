import { RhythmAudioEngine, type LoadedTrackAudio } from '../core/audio/RhythmAudioEngine.ts';
import { getBuiltinRhythmSongs } from '../core/rhythm/RhythmBuiltinSongs.ts';
import { RhythmJudgeEngine } from '../core/rhythm/RhythmJudgeEngine.ts';
import {
  evaluateCourseOutcome,
  evaluatePlayerProfile,
  type RhythmCourseClearRecord,
  type RhythmCourseDefinition,
} from '../core/rhythm/RhythmProgression.ts';
import {
  formatGradeLabel,
  RHYTHM_DIFFICULTIES,
  type RhythmDifficulty,
  type RhythmHitsoundPreset,
  type RhythmLane,
  type RhythmPlayRecord,
  type RhythmPlayerConfig,
  type RhythmSongProject,
} from '../core/rhythm/RhythmTypes.ts';
import { CameraRigDirector } from '../core/runtime/CameraRigDirector.ts';
import {
  GameFlowController,
  resolveSceneCameraShot,
  type GameSceneId,
} from '../core/runtime/GameFlowController.ts';
import { RhythmChartStudioView } from './RhythmChartStudioView.ts';
import {
  createAstralCrestSvg,
  createHudIconSvg,
  renderCourseCards,
  renderDensitySparkline,
  renderProfileContent,
  renderTimingHistogram,
  syncJacketFrame,
} from './RhythmOverlays.ts';
import { RhythmStageRenderer } from './RhythmStageRenderer.ts';
import {
  makeRecordKey,
  RhythmStorage,
  type RhythmCourseRecordMap,
  type RhythmRecordMap,
} from './RhythmStorage.ts';

export interface RhythmWorkspaceOptions {
  onExitToWorkstation?: () => void;
}

interface ActiveCourseRun {
  course: RhythmCourseDefinition;
  stageIndex: number;
  carryHp: number;
  stageRecords: RhythmPlayRecord[];
}

/**
 * PA-13 «星脈共鳴 Pulse Resonance» — Engine 10.0 Standalone-App-Grade 6-Act Rhythm Game.
 *
 * A single continuous 3D celestial concert stage (`Stage3DPipeline` + `CameraRigDirector`)
 * runs across EVERY screen (`title -> lobby -> select / course / profile -> intro -> playing -> paused -> result`).
 * Screen navigation triggers real 6DoF camera choreography and live audio-reactive lighting —
 * zero black-screen hard cuts and zero developer IDE chrome inside the game.
 */
export class RhythmWorkspaceView {
  public readonly element: HTMLElement;
  private readonly ac = new AbortController();
  private readonly audio = new RhythmAudioEngine();
  private readonly storage = new RhythmStorage();
  private readonly camera = new CameraRigDirector('TITLE_ORBIT');
  private readonly flow = new GameFlowController('title');
  private readonly onExitToWorkstation?: () => void;

  private visible = false;
  private songs: RhythmSongProject[] = [];
  private selectedSongId = '';
  private selectedDifficulty: RhythmDifficulty = 'NORMAL';
  private config: RhythmPlayerConfig;
  private records: RhythmRecordMap;
  private courseRecords: RhythmCourseRecordMap;

  // Live Play & Course Run State
  private readonly stageCanvas: HTMLCanvasElement;
  private readonly stageRenderer: RhythmStageRenderer;
  private judgeEngine: RhythmJudgeEngine | null = null;
  private activeTrack: LoadedTrackAudio | null = null;
  private activePlayProject: RhythmSongProject | null = null;
  private activeCourseRun: ActiveCourseRun | null = null;
  private playStartCursorMs = 0;
  private resumeCountdownSec = 0;
  private finishHoldTimer = 0;
  private resultShown = false;
  private lastFeverTier = 0;
  private pointerLaneMap = new Map<number, RhythmLane>();

  // Calibration Modal State
  private calibOpen = false;
  private calibSamples: number[] = [];

  // Persistent Scene Overlays (layered over the single live 3D stage canvas)
  private readonly titleOverlay: HTMLElement;
  private readonly lobbyOverlay: HTMLElement;
  private readonly selectOverlay: HTMLElement;
  private readonly courseOverlay: HTMLElement;
  private readonly profileOverlay: HTMLElement;
  private readonly introOverlay: HTMLElement;
  private readonly playHudOverlay: HTMLElement;
  private readonly resultOverlay: HTMLElement;
  private readonly studioView: RhythmChartStudioView;
  private readonly pauseModal: HTMLElement;
  private readonly calibModal: HTMLElement;

  // Lobby Refs
  private readonly lobbyRatingVal: HTMLElement;
  private readonly lobbyRankLabel: HTMLElement;
  private readonly lobbyStatsLine: HTMLElement;
  private readonly lobbyMuteBtn: HTMLButtonElement;

  // Select View Refs
  private readonly songListEl: HTMLElement;
  private readonly spotlightTitle: HTMLElement;
  private readonly spotlightSub: HTMLElement;
  private readonly spotlightMeta: HTMLElement;
  private readonly jacketFrameEl: HTMLElement;
  private readonly jacketImgEl: HTMLImageElement;
  private readonly densityCanvas: HTMLCanvasElement;
  private readonly diffRowEl: HTMLElement;
  private readonly bestSummaryEl: HTMLElement;
  private readonly speedValEl: HTMLElement;
  private readonly offsetValEl: HTMLElement;
  private readonly camModeBtn: HTMLButtonElement;
  private readonly hitsoundBtn: HTMLButtonElement;
  private readonly deleteCustomBtn: HTMLButtonElement;

  // Course & Profile Refs
  private readonly courseGridEl: HTMLElement;
  private readonly profileSummaryEl: HTMLElement;
  private readonly profileAchGridEl: HTMLElement;

  // Intro Slate Refs
  private readonly introTitleEl: HTMLElement;
  private readonly introMetaEl: HTMLElement;
  private readonly introCourseBadgeEl: HTMLElement;

  // Play HUD Refs
  private readonly hudSongTitle: HTMLElement;
  private readonly hudDiffLabel: HTMLElement;
  private readonly hudCourseLabel: HTMLElement;
  private readonly hudProgressFill: HTMLElement;
  private readonly hudScoreEl: HTMLElement;
  private readonly hudAccEl: HTMLElement;
  private readonly hudHpFill: HTMLElement;
  private readonly hudMuteBtn: HTMLButtonElement;
  private readonly countdownBanner: HTMLElement;
  private readonly stageTouchZones: HTMLElement;

  // Result Showcase Refs
  private readonly resGradeEl: HTMLElement;
  private readonly resBadgeEl: HTMLElement;
  private readonly resSongTitle: HTMLElement;
  private readonly resCourseSummaryEl: HTMLElement;
  private readonly resScoreEl: HTMLElement;
  private readonly resAccEl: HTMLElement;
  private readonly resComboEl: HTMLElement;
  private readonly resRatingEl: HTMLElement;
  private readonly resCountsEl: HTMLElement;
  private readonly resHistCanvas: HTMLCanvasElement;
  private readonly resMeanOffsetEl: HTMLElement;
  private readonly resApplyOffsetBtn: HTMLButtonElement;
  private lastResultRecord: RhythmPlayRecord | null = null;
  private menuRenderAccum = 1;

  // Calib Modal Refs
  private readonly calibPulseRing: HTMLButtonElement;
  private readonly calibReadoutEl: HTMLElement;
  private readonly calibApplyBtn: HTMLButtonElement;
  private readonly calibCamBtn: HTMLButtonElement;

  constructor(options: RhythmWorkspaceOptions = {}) {
    const { signal } = this.ac;
    this.onExitToWorkstation = options.onExitToWorkstation;
    this.config = this.storage.loadConfig();
    this.records = this.storage.loadRecords();
    this.courseRecords = this.storage.loadCourseRecords();
    this.refreshSongLibrary();
    this.selectedSongId = this.songs[0]?.id ?? '';

    this.element = document.createElement('section');
    this.element.className = 'rhy-root panel-hidden';
    this.element.setAttribute('aria-label', '星脈共鳴 Pulse Resonance 獨立音樂遊戲');

    // =========================================================================
    // PERSISTENT FULL-VIEWPORT 3D CONCERT STAGE CANVAS
    // =========================================================================
    this.stageCanvas = document.createElement('canvas');
    this.stageCanvas.className = 'rhy-stage-canvas';
    this.stageRenderer = new RhythmStageRenderer(this.stageCanvas, this.camera);
    if (this.songs[0]) {
      this.stageRenderer.syncSongVisuals(this.songs[0]);
    }

    // Subtle touch receptor overlay active only during gameplay
    this.stageTouchZones = document.createElement('div');
    this.stageTouchZones.className = 'rhy-touch-zones panel-hidden';
    this.stageTouchZones.setAttribute('aria-hidden', 'true');

    // =========================================================================
    // ACT 1: TITLE SCREEN (Live World Orbital Camera + Left-Third Crest Lockup)
    // =========================================================================
    this.titleOverlay = document.createElement('div');
    this.titleOverlay.className = 'rhy-overlay rhy-title-overlay';

    const titleTopEscape = document.createElement('div');
    titleTopEscape.className = 'rhy-corner-utility';
    titleTopEscape.append(
      this.makeUtilityBtn('exit', '回到 Pixer 工作站', () => this.exitToWorkstation(), true),
    );

    const titleLockup = document.createElement('div');
    titleLockup.className = 'rhy-title-lockup';
    const crest = createAstralCrestSvg();
    const titleEn = document.createElement('div');
    titleEn.className = 'rhy-title-en';
    titleEn.textContent = 'PULSE RESONANCE';
    const titleZh = document.createElement('h1');
    titleZh.className = 'rhy-title-zh';
    titleZh.textContent = '星脈共鳴';
    const titleSub = document.createElement('p');
    titleSub.className = 'rhy-title-sub';
    titleSub.textContent = '4K 節奏演奏廳 · 即時頻譜 3D 舞台與原創譜面工坊';

    const titleActions = document.createElement('div');
    titleActions.className = 'rhy-title-actions';
    const enterLobbyBtn = this.makeBtn('進入音樂大廳', 'rhy-btn rhy-btn-start', () => {
      this.enterFromTitle();
    });
    enterLobbyBtn.dataset.start = 'true';

    const quickPlayBtn = this.makeBtn('直接選曲演奏', 'rhy-btn rhy-btn-ghost', () => {
      this.audio.unlock();
      this.audio.playUiSfx('confirm');
      this.transitionTo('select');
    });
    titleActions.append(enterLobbyBtn, quickPlayBtn);
    titleLockup.append(crest, titleEn, titleZh, titleSub, titleActions);

    const titleHint = document.createElement('div');
    titleHint.className = 'rhy-title-hint';
    titleHint.textContent = 'D F J K 音軌 · Enter 開始 · Esc 暫停';

    this.titleOverlay.append(titleTopEscape, titleLockup, titleHint);

    // =========================================================================
    // ACT 2: STANDALONE HOME LOBBY (Asymmetric Game Shell + Player Rating)
    // =========================================================================
    this.lobbyOverlay = document.createElement('div');
    this.lobbyOverlay.className = 'rhy-overlay rhy-lobby-overlay panel-hidden';

    const lobbyHeader = document.createElement('div');
    lobbyHeader.className = 'rhy-lobby-topbar';

    const lobbyBrand = document.createElement('div');
    lobbyBrand.className = 'rhy-lobby-brand';
    const lbTitle = document.createElement('span');
    lbTitle.className = 'rhy-lobby-wordmark';
    lbTitle.textContent = '星脈共鳴';
    const lbMeta = document.createElement('span');
    lbMeta.className = 'rhy-lobby-submark';
    lbMeta.textContent = 'PULSE RESONANCE · CONCERT HALL';
    lobbyBrand.append(lbTitle, lbMeta);

    const lobbyTools = document.createElement('div');
    lobbyTools.className = 'rhy-corner-tools';
    this.lobbyMuteBtn = this.makeUtilityBtn('volume', '靜音切換', () => this.toggleAudioMute(), false);
    const exitWorkBtn = this.makeUtilityBtn('exit', '回到 Pixer 工作站', () => this.exitToWorkstation(), true);
    lobbyTools.append(this.lobbyMuteBtn, exitWorkBtn);
    lobbyHeader.append(lobbyBrand, lobbyTools);

    const lobbyBody = document.createElement('div');
    lobbyBody.className = 'rhy-lobby-body';

    const lobbyNav = document.createElement('nav');
    lobbyNav.className = 'rhy-lobby-menu';
    lobbyNav.setAttribute('aria-label', '星脈共鳴遊戲主選單');

    const menuItems: {
      actionId: string;
      code: string;
      title: string;
      desc: string;
      primary?: boolean;
      parallaxX: number;
      onClick: () => void;
    }[] = [
      {
        actionId: 'play',
        code: '01',
        title: '自由演奏',
        desc: '4 首原創曲庫 · 四階難度 · 自訂音檔即刻上場',
        primary: true,
        parallaxX: -0.35,
        onClick: () => this.transitionTo('select'),
      },
      {
        actionId: 'course',
        code: '02',
        title: '段位巡演',
        desc: '三連曲體力延續試煉 · 衝擊金銀銅段位徽章',
        parallaxX: 0.0,
        onClick: () => this.transitionTo('course'),
      },
      {
        actionId: 'studio',
        code: '03',
        title: '譜面工坊',
        desc: '匯入 MP3/WAV 自動識譜 · 波形時間軸精細編譜',
        parallaxX: 0.25,
        onClick: () => void this.openChartStudio(false),
      },
      {
        actionId: 'profile',
        code: '04',
        title: '演奏檔案與成就',
        desc: '檢視 Player Rating、段位稱號與 8 項星脈成就',
        parallaxX: 0.45,
        onClick: () => this.transitionTo('profile'),
      },
      {
        actionId: 'settings',
        code: '05',
        title: '系統與延遲校準',
        desc: '音畫同步節拍器 · 動態運鏡 / 靜態競技切換',
        parallaxX: 0.15,
        onClick: () => this.openCalibrationModal(),
      },
    ];

    for (const item of menuItems) {
      const mBtn = document.createElement('button');
      mBtn.type = 'button';
      mBtn.dataset.lobbyAction = item.actionId;
      mBtn.className = item.primary ? 'rhy-lobby-item is-primary' : 'rhy-lobby-item';
      const code = document.createElement('span');
      code.className = 'rhy-lobby-item-code';
      code.textContent = item.code;
      const textWrap = document.createElement('span');
      textWrap.className = 'rhy-lobby-item-copy';
      const t = document.createElement('strong');
      t.textContent = item.title;
      const d = document.createElement('span');
      d.textContent = item.desc;
      textWrap.append(t, d);
      mBtn.append(code, textWrap);

      mBtn.addEventListener(
        'mouseenter',
        () => {
          this.camera.setPointerParallax(item.parallaxX, -0.15);
          this.audio.playUiSfx('hover');
        },
        { signal },
      );
      mBtn.addEventListener(
        'click',
        () => {
          this.audio.unlock();
          this.audio.playUiSfx('confirm');
          item.onClick();
        },
        { signal },
      );
      lobbyNav.appendChild(mBtn);
    }

    // Compact bottom-right Player Rating Monument Card (leaves center 3D stage unobstructed)
    const lobbyProfileCard = document.createElement('button');
    lobbyProfileCard.type = 'button';
    lobbyProfileCard.className = 'rhy-lobby-profile-card';
    lobbyProfileCard.addEventListener(
      'click',
      () => {
        this.audio.unlock();
        this.audio.playUiSfx('confirm');
        this.transitionTo('profile');
      },
      { signal },
    );

    const profKicker = document.createElement('span');
    profKicker.className = 'rhy-meta-kicker';
    profKicker.textContent = 'PLAYER RATING';
    this.lobbyRatingVal = document.createElement('div');
    this.lobbyRatingVal.className = 'rhy-lobby-rating-num';
    this.lobbyRatingVal.textContent = '0.00';
    this.lobbyRankLabel = document.createElement('div');
    this.lobbyRankLabel.className = 'rhy-lobby-rank-label';
    this.lobbyRankLabel.textContent = '初階星詠';
    this.lobbyStatsLine = document.createElement('div');
    this.lobbyStatsLine.className = 'rhy-lobby-stats-line';
    this.lobbyStatsLine.textContent = '通關 0 · FC 0 · 段位 0/3';
    lobbyProfileCard.append(profKicker, this.lobbyRatingVal, this.lobbyRankLabel, this.lobbyStatsLine);

    lobbyBody.append(lobbyNav, lobbyProfileCard);
    this.lobbyOverlay.append(lobbyHeader, lobbyBody);

    // =========================================================================
    // ACT 3: SONG SELECT CAROUSEL (Real HD Album Art + Live 3D Stage Lighting)
    // =========================================================================
    this.selectOverlay = document.createElement('div');
    this.selectOverlay.className = 'rhy-overlay rhy-select-overlay panel-hidden';

    const selectHeader = document.createElement('div');
    selectHeader.className = 'rhy-subpage-header';
    const selLeft = document.createElement('div');
    selLeft.className = 'rhy-subpage-title-group';
    const selBackBtn = this.makeBtn('← 返回大廳', 'rhy-btn rhy-btn-ghost', () => {
      this.audio.playUiSfx('back');
      this.transitionTo('lobby');
    });
    const selH2 = document.createElement('h2');
    selH2.className = 'rhy-subpage-h2';
    selH2.textContent = '自由演奏 · 曲目選擇';
    selLeft.append(selBackBtn, selH2);

    const selActions = document.createElement('div');
    selActions.className = 'rhy-header-actions';
    selActions.append(
      this.makeBtn('匯入音檔自動識譜', 'rhy-btn rhy-btn-accent', () => void this.openChartStudio(true)),
      this.makeBtn('譜面工坊', 'rhy-btn', () => void this.openChartStudio(false)),
      this.makeBtn('延遲校準', 'rhy-btn', () => this.openCalibrationModal()),
    );
    selectHeader.append(selLeft, selActions);

    const selectGrid = document.createElement('div');
    selectGrid.className = 'rhy-select-grid';

    // Left Rail: Song Carousel List
    const railPane = document.createElement('div');
    railPane.className = 'rhy-song-rail';
    this.songListEl = document.createElement('div');
    this.songListEl.className = 'rhy-song-list';
    railPane.appendChild(this.songListEl);

    // Right Spotlight: High-Res Album Art + Difficulty + Density + Modifiers + Start CTA
    const spotlight = document.createElement('div');
    spotlight.className = 'rhy-spotlight';

    const spotTop = document.createElement('div');
    spotTop.className = 'rhy-spotlight-hero';

    this.jacketFrameEl = document.createElement('div');
    this.jacketFrameEl.className = 'rhy-jacket-frame';
    this.jacketImgEl = document.createElement('img');
    this.jacketImgEl.className = 'rhy-jacket-img';
    this.jacketImgEl.alt = '曲目專輯封面';
    this.jacketFrameEl.appendChild(this.jacketImgEl);

    const spotInfo = document.createElement('div');
    spotInfo.className = 'rhy-spotlight-info';
    this.spotlightTitle = document.createElement('h3');
    this.spotlightTitle.className = 'rhy-spot-title';
    this.spotlightSub = document.createElement('p');
    this.spotlightSub.className = 'rhy-spot-sub';
    this.spotlightMeta = document.createElement('div');
    this.spotlightMeta.className = 'rhy-spot-meta';
    this.bestSummaryEl = document.createElement('div');
    this.bestSummaryEl.className = 'rhy-best-summary';
    spotInfo.append(this.spotlightTitle, this.spotlightSub, this.spotlightMeta, this.bestSummaryEl);
    spotTop.append(this.jacketFrameEl, spotInfo);

    // Difficulty Row
    this.diffRowEl = document.createElement('div');
    this.diffRowEl.className = 'rhy-diff-row';

    // Density Sparkline
    const densityWrap = document.createElement('div');
    densityWrap.className = 'rhy-density-wrap';
    const densityLbl = document.createElement('span');
    densityLbl.className = 'rhy-mini-label';
    densityLbl.textContent = '譜面音符密度曲線';
    this.densityCanvas = document.createElement('canvas');
    this.densityCanvas.className = 'rhy-density-canvas';
    this.densityCanvas.width = 480;
    this.densityCanvas.height = 56;
    densityWrap.append(densityLbl, this.densityCanvas);

    // Performance Settings Strip
    const modStrip = document.createElement('div');
    modStrip.className = 'rhy-mod-strip';

    const speedMod = document.createElement('div');
    speedMod.className = 'rhy-mod-item';
    const spdLbl = document.createElement('span');
    spdLbl.className = 'rhy-mini-label';
    spdLbl.textContent = '流速 SPEED';
    const spdControls = document.createElement('div');
    spdControls.className = 'rhy-stepper';
    this.speedValEl = document.createElement('span');
    this.speedValEl.className = 'rhy-stepper-val';
    spdControls.append(
      this.makeBtn('−', 'rhy-step-btn', () => this.adjustSpeed(-0.2)),
      this.speedValEl,
      this.makeBtn('+', 'rhy-step-btn', () => this.adjustSpeed(0.2)),
    );
    speedMod.append(spdLbl, spdControls);

    const offsetMod = document.createElement('div');
    offsetMod.className = 'rhy-mod-item';
    const offLbl = document.createElement('span');
    offLbl.className = 'rhy-mini-label';
    offLbl.textContent = '延遲 OFFSET';
    const offControls = document.createElement('div');
    offControls.className = 'rhy-stepper';
    this.offsetValEl = document.createElement('span');
    this.offsetValEl.className = 'rhy-stepper-val';
    offControls.append(
      this.makeBtn('−5', 'rhy-step-btn', () => this.adjustOffset(-5)),
      this.offsetValEl,
      this.makeBtn('+5', 'rhy-step-btn', () => this.adjustOffset(5)),
    );
    offsetMod.append(offLbl, offControls);

    this.camModeBtn = this.makeBtn('', 'rhy-btn rhy-mod-toggle', () => {
      this.config.cameraDynamic = !this.config.cameraDynamic;
      this.storage.saveConfig(this.config);
      this.audio.playUiSfx('switch');
      this.syncConfigReadouts();
    });

    this.hitsoundBtn = this.makeBtn('', 'rhy-btn rhy-mod-toggle', () => {
      const order: RhythmHitsoundPreset[] = ['clap', 'tick', 'crystal', 'off'];
      const next = order[(order.indexOf(this.config.hitsoundPreset) + 1) % order.length];
      this.config.hitsoundPreset = next;
      this.storage.saveConfig(this.config);
      this.audio.playHitsound(next, true);
      this.syncConfigReadouts();
    });

    modStrip.append(speedMod, offsetMod, this.camModeBtn, this.hitsoundBtn);

    // Primary Launch Row
    const launchRow = document.createElement('div');
    launchRow.className = 'rhy-launch-row';
    const playNowBtn = this.makeBtn('開始演奏 · PLAY', 'rhy-btn rhy-btn-primary rhy-play-cta', () => {
      const song = this.getSelectedSong();
      if (song) {
        this.activeCourseRun = null;
        void this.startPerformance(song, this.selectedDifficulty, 0);
      }
    });
    this.deleteCustomBtn = this.makeBtn('刪除此自訂曲', 'rhy-btn rhy-btn-danger panel-hidden', () => {
      const song = this.getSelectedSong();
      if (!song?.isCustom) return;
      this.storage.deleteCustomProject(song.id);
      this.refreshSongLibrary();
      this.selectedSongId = this.songs[0]?.id ?? '';
      this.renderSongList();
      this.renderSpotlight();
    });
    launchRow.append(playNowBtn, this.deleteCustomBtn);

    spotlight.append(spotTop, this.diffRowEl, densityWrap, modStrip, launchRow);
    selectGrid.append(railPane, spotlight);
    this.selectOverlay.append(selectHeader, selectGrid);

    // =========================================================================
    // ACT 3B: COURSE MODE HALL (段位巡演)
    // =========================================================================
    this.courseOverlay = document.createElement('div');
    this.courseOverlay.className = 'rhy-overlay rhy-course-overlay panel-hidden';

    const courseHeader = document.createElement('div');
    courseHeader.className = 'rhy-subpage-header';
    const courseLeft = document.createElement('div');
    courseLeft.className = 'rhy-subpage-title-group';
    courseLeft.append(
      this.makeBtn('← 返回大廳', 'rhy-btn rhy-btn-ghost', () => {
        this.audio.playUiSfx('back');
        this.transitionTo('lobby');
      }),
    );
    const courseH2 = document.createElement('h2');
    courseH2.className = 'rhy-subpage-h2';
    courseH2.textContent = '段位巡演 · 連續三曲耐力賽';
    courseLeft.append(courseH2);
    courseHeader.append(courseLeft);

    this.courseGridEl = document.createElement('div');
    this.courseGridEl.className = 'rhy-course-grid';
    this.courseOverlay.append(courseHeader, this.courseGridEl);

    // =========================================================================
    // ACT 3C: PROFILE & ACHIEVEMENTS SANCTUM (演奏檔案與成就)
    // =========================================================================
    this.profileOverlay = document.createElement('div');
    this.profileOverlay.className = 'rhy-overlay rhy-profile-overlay panel-hidden';

    const profileHeader = document.createElement('div');
    profileHeader.className = 'rhy-subpage-header';
    const profLeft = document.createElement('div');
    profLeft.className = 'rhy-subpage-title-group';
    profLeft.append(
      this.makeBtn('← 返回大廳', 'rhy-btn rhy-btn-ghost', () => {
        this.audio.playUiSfx('back');
        this.transitionTo('lobby');
      }),
    );
    const profH2 = document.createElement('h2');
    profH2.className = 'rhy-subpage-h2';
    profH2.textContent = '演奏檔案與星脈成就';
    profLeft.append(profH2);
    profileHeader.append(profLeft);

    this.profileSummaryEl = document.createElement('div');
    this.profileSummaryEl.className = 'rhy-profile-summary';
    this.profileAchGridEl = document.createElement('div');
    this.profileAchGridEl.className = 'rhy-ach-grid';
    this.profileOverlay.append(profileHeader, this.profileSummaryEl, this.profileAchGridEl);

    // =========================================================================
    // ACT 4: STAGE FLY-IN INTRO SLATE (Smooth 3D Camera Swoop onto Highway)
    // =========================================================================
    this.introOverlay = document.createElement('div');
    this.introOverlay.className = 'rhy-overlay rhy-intro-overlay panel-hidden';
    const introCard = document.createElement('div');
    introCard.className = 'rhy-intro-slate';
    this.introCourseBadgeEl = document.createElement('div');
    this.introCourseBadgeEl.className = 'rhy-intro-course-tag panel-hidden';
    this.introTitleEl = document.createElement('h2');
    this.introTitleEl.className = 'rhy-intro-title';
    this.introMetaEl = document.createElement('div');
    this.introMetaEl.className = 'rhy-intro-meta';
    const introSkipHint = document.createElement('div');
    introSkipHint.className = 'rhy-intro-skip';
    introSkipHint.textContent = '3D 舞台鏡頭切入中 · 按空白鍵可立即開拍';
    introCard.append(this.introCourseBadgeEl, this.introTitleEl, this.introMetaEl, introSkipHint);
    this.introOverlay.appendChild(introCard);

    // =========================================================================
    // ACT 5: LIVE 4K PERFORMANCE HUD (Perimeter Clusters, >=88% Clear Viewport)
    // =========================================================================
    this.playHudOverlay = document.createElement('div');
    this.playHudOverlay.className = 'rhy-overlay rhy-play-hud panel-hidden';

    const hudLeft = document.createElement('div');
    hudLeft.className = 'rhy-hud-left';
    this.hudCourseLabel = document.createElement('div');
    this.hudCourseLabel.className = 'rhy-hud-course panel-hidden';
    this.hudSongTitle = document.createElement('div');
    this.hudSongTitle.className = 'rhy-hud-song';
    this.hudDiffLabel = document.createElement('div');
    this.hudDiffLabel.className = 'rhy-hud-diff';
    const progBar = document.createElement('div');
    progBar.className = 'rhy-hud-progress';
    this.hudProgressFill = document.createElement('div');
    this.hudProgressFill.className = 'rhy-hud-progress-fill';
    progBar.appendChild(this.hudProgressFill);
    hudLeft.append(this.hudCourseLabel, this.hudSongTitle, this.hudDiffLabel, progBar);

    const hudRight = document.createElement('div');
    hudRight.className = 'rhy-hud-right';
    const scoreWrap = document.createElement('div');
    scoreWrap.className = 'rhy-hud-score-wrap';
    this.hudScoreEl = document.createElement('div');
    this.hudScoreEl.className = 'rhy-hud-score';
    this.hudScoreEl.textContent = '0000000';
    this.hudAccEl = document.createElement('div');
    this.hudAccEl.className = 'rhy-hud-acc';
    this.hudAccEl.textContent = '100.00%';
    scoreWrap.append(this.hudScoreEl, this.hudAccEl);

    const hpWrap = document.createElement('div');
    hpWrap.className = 'rhy-hud-hp';
    const hpLbl = document.createElement('span');
    hpLbl.className = 'rhy-hud-hp-lbl';
    hpLbl.textContent = 'HP';
    const hpTrack = document.createElement('div');
    hpTrack.className = 'rhy-hud-hp-track';
    this.hudHpFill = document.createElement('div');
    this.hudHpFill.className = 'rhy-hud-hp-fill';
    hpTrack.appendChild(this.hudHpFill);
    hpWrap.append(hpLbl, hpTrack);

    const hudBtns = document.createElement('div');
    hudBtns.className = 'rhy-hud-icon-btns';
    this.hudMuteBtn = this.makeUtilityBtn('volume', '靜音 [M]', () => this.toggleAudioMute(), false);
    this.hudMuteBtn.tabIndex = -1;
    const pauseBtn = this.makeUtilityBtn('pause', '暫停 [Esc]', () => this.togglePause(), false);
    pauseBtn.tabIndex = -1;
    hudBtns.append(this.hudMuteBtn, pauseBtn);

    hudRight.append(scoreWrap, hpWrap, hudBtns);

    this.countdownBanner = document.createElement('div');
    this.countdownBanner.className = 'rhy-countdown panel-hidden';

    this.playHudOverlay.append(hudLeft, hudRight, this.countdownBanner);

    // =========================================================================
    // ACT 6: RESULT SHOWCASE (Highway Dissolves -> Wide Spotlight Pull-Back)
    // =========================================================================
    this.resultOverlay = document.createElement('div');
    this.resultOverlay.className = 'rhy-overlay rhy-result-overlay panel-hidden';

    const resCard = document.createElement('div');
    resCard.className = 'rhy-result-card';

    const resTop = document.createElement('div');
    resTop.className = 'rhy-result-top';
    const resRankBlock = document.createElement('div');
    resRankBlock.className = 'rhy-result-rank-block';
    this.resGradeEl = document.createElement('div');
    this.resGradeEl.className = 'rhy-result-grade';
    this.resBadgeEl = document.createElement('div');
    this.resBadgeEl.className = 'rhy-result-badge';
    resRankBlock.append(this.resGradeEl, this.resBadgeEl);

    const resMetaBlock = document.createElement('div');
    resMetaBlock.className = 'rhy-result-meta-block';
    this.resCourseSummaryEl = document.createElement('div');
    this.resCourseSummaryEl.className = 'rhy-result-course-summary panel-hidden';
    this.resSongTitle = document.createElement('h2');
    this.resSongTitle.className = 'rhy-result-title';
    const resBigNums = document.createElement('div');
    resBigNums.className = 'rhy-result-nums';
    this.resScoreEl = document.createElement('div');
    this.resScoreEl.className = 'rhy-res-num';
    this.resAccEl = document.createElement('div');
    this.resAccEl.className = 'rhy-res-num';
    this.resComboEl = document.createElement('div');
    this.resComboEl.className = 'rhy-res-num';
    this.resRatingEl = document.createElement('div');
    this.resRatingEl.className = 'rhy-res-num';
    resBigNums.append(this.resScoreEl, this.resAccEl, this.resComboEl, this.resRatingEl);
    resMetaBlock.append(this.resCourseSummaryEl, this.resSongTitle, resBigNums);
    resTop.append(resRankBlock, resMetaBlock);

    const resMid = document.createElement('div');
    resMid.className = 'rhy-result-mid';
    this.resCountsEl = document.createElement('div');
    this.resCountsEl.className = 'rhy-result-counts';

    const histBox = document.createElement('div');
    histBox.className = 'rhy-hist-box';
    const histHead = document.createElement('div');
    histHead.className = 'rhy-hist-head';
    const histTitle = document.createElement('span');
    histTitle.className = 'rhy-mini-label';
    histTitle.textContent = '擊打時機誤差分佈 (FAST / SLOW)';
    this.resMeanOffsetEl = document.createElement('span');
    this.resMeanOffsetEl.className = 'rhy-hist-mean';
    histHead.append(histTitle, this.resMeanOffsetEl);

    this.resHistCanvas = document.createElement('canvas');
    this.resHistCanvas.className = 'rhy-hist-canvas';
    this.resHistCanvas.width = 400;
    this.resHistCanvas.height = 104;

    this.resApplyOffsetBtn = this.makeBtn('套用建議延遲校準', 'rhy-btn rhy-btn-sm', () => {
      if (!this.lastResultRecord) return;
      const delta = Math.round(this.lastResultRecord.meanOffsetMs);
      this.config.audioOffsetMs = Math.max(-250, Math.min(250, this.config.audioOffsetMs + delta));
      this.storage.saveConfig(this.config);
      this.syncConfigReadouts();
      this.resApplyOffsetBtn.textContent = `已更新延遲 (${this.config.audioOffsetMs >= 0 ? '+' : ''}${this.config.audioOffsetMs}ms)`;
      this.resApplyOffsetBtn.disabled = true;
    });
    histBox.append(histHead, this.resHistCanvas, this.resApplyOffsetBtn);
    resMid.append(this.resCountsEl, histBox);

    const resActions = document.createElement('div');
    resActions.className = 'rhy-result-actions';
    const retryBtn = this.makeBtn('再演奏一次', 'rhy-btn rhy-btn-primary', () => {
      if (this.activeCourseRun) {
        void this.startCourse(this.activeCourseRun.course);
      } else if (this.activePlayProject) {
        void this.startPerformance(this.activePlayProject, this.selectedDifficulty, 0);
      }
    });
    retryBtn.dataset.start = 'true';
    resActions.append(
      retryBtn,
      this.makeBtn('進入譜面工坊微調', 'rhy-btn', () => void this.openChartStudio(false)),
      this.makeBtn('返回選曲大廳', 'rhy-btn', () => this.transitionTo('select')),
      this.makeBtn('回到主大廳', 'rhy-btn rhy-btn-ghost', () => this.transitionTo('lobby')),
    );

    resCard.append(resTop, resMid, resActions);
    this.resultOverlay.appendChild(resCard);

    // =========================================================================
    // CHART STUDIO (DAW Timeline & Local Audio Auto-Charter)
    // =========================================================================
    const initialSong = this.songs[0] ?? getBuiltinRhythmSongs()[0];
    this.studioView = new RhythmChartStudioView(initialSong, this.audio, this.storage, {
      onBackToSelect: () => {
        this.studioView.hide();
        this.refreshSongLibrary();
        this.renderSongList();
        this.renderSpotlight();
        this.transitionTo('select');
      },
      onPlaytestFromCursor: (project, difficulty, startMs) => {
        this.studioView.hide();
        this.selectedSongId = project.id;
        this.selectedDifficulty = difficulty;
        this.activeCourseRun = null;
        void this.startPerformance(project, difficulty, startMs);
      },
      onProjectSaved: (project) => {
        this.refreshSongLibrary();
        this.selectedSongId = project.id;
        this.renderSongList();
        this.renderSpotlight();
        this.syncProfileUI();
      },
      onLoadProjectAudio: (project) =>
        this.audio.loadProjectAudio(project, (key) => this.storage.loadAudioBlob(key)),
    });

    // =========================================================================
    // MODALS: PAUSE & SETTINGS/OFFSET CALIBRATION
    // =========================================================================
    this.pauseModal = document.createElement('div');
    this.pauseModal.className = 'rhy-modal-backdrop panel-hidden';
    const pauseCard = document.createElement('div');
    pauseCard.className = 'rhy-modal-card';
    const pauseH = document.createElement('h3');
    pauseH.textContent = '演奏暫停';
    const pauseSub = document.createElement('p');
    pauseSub.className = 'rhy-modal-sub';
    pauseSub.textContent = '恢復後將倒數 3 秒無縫續拍，不中斷當前判定與連擊。';
    const pauseBtns = document.createElement('div');
    pauseBtns.className = 'rhy-modal-actions';
    pauseBtns.append(
      this.makeBtn('繼續演奏 (3s 倒數)', 'rhy-btn rhy-btn-primary', () => this.resumeFromPause()),
      this.makeBtn('重新開始本曲', 'rhy-btn', () => {
        if (this.activePlayProject) {
          this.pauseModal.classList.add('panel-hidden');
          void this.startPerformance(this.activePlayProject, this.selectedDifficulty, this.playStartCursorMs);
        }
      }),
      this.makeBtn('延遲與運鏡設定', 'rhy-btn', () => this.openCalibrationModal()),
      this.makeBtn('返回選曲大廳', 'rhy-btn', () => {
        this.stopActivePerformance();
        this.activeCourseRun = null;
        this.transitionTo('select');
      }),
      this.makeBtn('回到遊戲主大廳', 'rhy-btn rhy-btn-ghost', () => {
        this.stopActivePerformance();
        this.activeCourseRun = null;
        this.transitionTo('lobby');
      }),
      this.makeBtn('回到 Pixer 工作站', 'rhy-btn rhy-btn-ghost', () => this.exitToWorkstation()),
    );
    pauseCard.append(pauseH, pauseSub, pauseBtns);
    this.pauseModal.appendChild(pauseCard);

    this.calibModal = document.createElement('div');
    this.calibModal.className = 'rhy-modal-backdrop panel-hidden';
    const calibCard = document.createElement('div');
    calibCard.className = 'rhy-modal-card rhy-calib-card';
    const calibH = document.createElement('h3');
    calibH.textContent = '系統設定與延遲校準';
    const calibSub = document.createElement('p');
    calibSub.className = 'rhy-modal-sub';
    calibSub.textContent = '聆聽 120 BPM 節拍聲，配合拍點按空白鍵或點擊下方圓環 8 次計算硬體音畫延遲。';

    this.calibPulseRing = document.createElement('button');
    this.calibPulseRing.type = 'button';
    this.calibPulseRing.className = 'rhy-calib-ring';
    this.calibPulseRing.textContent = '對準節拍點擊 / SPACE';
    this.calibPulseRing.addEventListener('click', () => this.recordCalibrationTap(), { signal });

    this.calibReadoutEl = document.createElement('div');
    this.calibReadoutEl.className = 'rhy-calib-readout';
    this.calibReadoutEl.textContent = '等待敲擊節拍 (0 / 8)';

    this.calibCamBtn = this.makeBtn('', 'rhy-btn', () => {
      this.config.cameraDynamic = !this.config.cameraDynamic;
      this.storage.saveConfig(this.config);
      this.camera.setStaticGameplayLock(!this.config.cameraDynamic);
      this.judgeEngine?.setDynamicCamera(this.config.cameraDynamic);
      this.audio.playUiSfx('switch');
      this.syncConfigReadouts();
    });

    const calibBtns = document.createElement('div');
    calibBtns.className = 'rhy-modal-actions';
    this.calibApplyBtn = this.makeBtn('套用延遲並關閉', 'rhy-btn rhy-btn-primary', () => {
      if (this.calibSamples.length > 0) {
        const avg = Math.round(
          this.calibSamples.reduce((a, b) => a + b, 0) / this.calibSamples.length,
        );
        this.config.audioOffsetMs = Math.max(-250, Math.min(250, avg));
        this.storage.saveConfig(this.config);
        this.syncConfigReadouts();
      }
      this.closeCalibrationModal();
    });
    calibBtns.append(
      this.calibCamBtn,
      this.calibApplyBtn,
      this.makeBtn('歸零 0ms', 'rhy-btn', () => {
        this.config.audioOffsetMs = 0;
        this.storage.saveConfig(this.config);
        this.syncConfigReadouts();
        this.calibReadoutEl.textContent = '已重置音訊延遲為 0ms';
      }),
      this.makeBtn('關閉', 'rhy-btn rhy-btn-ghost', () => this.closeCalibrationModal()),
    );
    calibCard.append(calibH, calibSub, this.calibPulseRing, this.calibReadoutEl, calibBtns);
    this.calibModal.appendChild(calibCard);

    // Assemble root cleanly: single 3D stage canvas underneath all translucent acts
    this.element.append(
      this.stageCanvas,
      this.stageTouchZones,
      this.titleOverlay,
      this.lobbyOverlay,
      this.selectOverlay,
      this.courseOverlay,
      this.profileOverlay,
      this.introOverlay,
      this.playHudOverlay,
      this.resultOverlay,
      this.studioView.element,
      this.pauseModal,
      this.calibModal,
    );

    this.bindInputs();
    this.syncConfigReadouts();
    this.renderSongList();
    this.renderSpotlight();
    this.syncProfileUI();
    this.syncSceneDom();
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public getCurrentScene(): GameSceneId {
    return this.flow.getScene();
  }

  public setVisible(visible: boolean, initialScene?: GameSceneId): void {
    if (this.visible === visible && !initialScene) return;
    this.visible = visible;
    this.element.classList.toggle('panel-hidden', !visible);

    if (visible) {
      this.refreshSongLibrary();
      this.records = this.storage.loadRecords();
      this.courseRecords = this.storage.loadCourseRecords();
      this.renderSongList();
      this.renderSpotlight();
      this.syncProfileUI();
      this.resizeStageToContainer();

      const targetScene = initialScene ?? this.flow.getScene();
      if (targetScene !== this.flow.getScene()) {
        this.flow.goTo(targetScene, 0.35);
      }
      this.camera.snapToShot(resolveSceneCameraShot(this.flow.getScene()));
      this.syncSceneDom();
      document.body.dataset.state = this.flow.getSnapshot().bodyStateAttr;
    } else {
      this.audio.stop();
      this.closeCalibrationModal();
      this.studioView.hide();
      this.stopActivePerformance();
      delete document.body.dataset.state;
    }
  }

  /**
   * Main 60Hz tick invoked by `main.ts` RAF loop when standalone Rhythm App is active.
   */
  public tick(dtSec: number): void {
    if (!this.visible) return;
    const dt = Math.max(0.001, Math.min(0.05, dtSec));
    const scene = this.flow.getScene();

    if (scene === 'studio') {
      this.studioView.tick();
      return;
    }

    this.resizeStageToContainer();
    const spectrum = this.audio.sampleSpectrum(dt);
    const flowEvent = this.flow.step(dt);

    if (flowEvent === 'intro_complete') {
      this.beginLivePlaybackAfterIntro();
    }

    const activeScene = this.flow.getScene();

    // Handle 3-second resume countdown
    if (activeScene === 'playing' && this.resumeCountdownSec > 0) {
      this.resumeCountdownSec -= dt;
      if (this.resumeCountdownSec <= 0) {
        this.resumeCountdownSec = 0;
        this.countdownBanner.classList.add('panel-hidden');
        this.audio.resume(1.0);
      } else {
        this.countdownBanner.textContent = String(Math.ceil(this.resumeCountdownSec));
      }
    }

    let liveState = this.judgeEngine ? this.judgeEngine.getLiveState() : null;

    if (
      activeScene === 'playing' &&
      this.judgeEngine &&
      this.activePlayProject &&
      this.resumeCountdownSec <= 0
    ) {
      const songMs = this.audio.getCurrentSongTimeMs(this.config.audioOffsetMs);
      liveState = this.judgeEngine.update(songMs);

      if (liveState.feverTier > this.lastFeverTier) {
        this.audio.playUiSfx('fever');
      }
      this.lastFeverTier = liveState.feverTier;

      this.updatePlayHudDom(liveState, this.activePlayProject.durationMs);

      if ((liveState.finished || liveState.failed) && !this.resultShown) {
        this.finishHoldTimer += dt;
        if (this.finishHoldTimer >= (liveState.failed ? 0.55 : 0.7)) {
          this.resultShown = true;
          this.handleStageCompleted(liveState.failed);
        }
      }
    }

    const snap = this.flow.getSnapshot();
    const introProgress =
      activeScene === 'intro'
        ? Math.max(0, Math.min(1, 1 - snap.introRemainingSec / 1.15))
        : undefined;

    const isHighRateScene = activeScene === 'playing' || activeScene === 'intro';
    if (!isHighRateScene) {
      this.menuRenderAccum += dt;
      if (this.menuRenderAccum < 0.033) return;
      const renderDt = this.menuRenderAccum;
      this.menuRenderAccum = 0;
      this.stageRenderer.renderFrame({
        dtSec: renderDt,
        scene: activeScene,
        spectrum,
        project: this.activePlayProject ?? this.getSelectedSong(),
        config: this.config,
        judgeEngine: this.judgeEngine,
        liveState,
        introProgress,
      });
      return;
    }

    this.menuRenderAccum = 1;
    this.stageRenderer.renderFrame({
      dtSec: dt,
      scene: activeScene,
      spectrum,
      project: this.activePlayProject ?? this.getSelectedSong(),
      config: this.config,
      judgeEngine: this.judgeEngine,
      liveState,
      introProgress,
    });
  }

  public destroy(): void {
    this.ac.abort();
    this.audio.destroy();
    this.studioView.destroy();
    this.element.remove();
  }

  // ===========================================================================
  // SCENE FLOW & CAMERA TRANSITIONS (Zero Black-Screen Hard Cuts)
  // ===========================================================================

  private enterFromTitle(): void {
    this.audio.unlock();
    this.audio.playUiSfx('confirm');
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.transitionTo('lobby');
  }

  private transitionTo(next: GameSceneId): void {
    if (next !== 'select' && this.audio.isPreviewLooping()) {
      this.audio.stop();
    }
    this.pauseModal.classList.add('panel-hidden');
    if (next !== 'studio') {
      this.studioView.hide();
    }

    this.flow.goTo(next, 0.45);
    this.camera.setShot(resolveSceneCameraShot(next), 5.6);
    this.menuRenderAccum = 1;

    if (next === 'select') {
      this.renderSongList();
      this.renderSpotlight();
      this.startPreviewForSelectedSong();
    } else if (next === 'course') {
      this.courseRecords = this.storage.loadCourseRecords();
      renderCourseCards({
        container: this.courseGridEl,
        songs: this.songs,
        courseRecords: this.courseRecords,
        signal: this.ac.signal,
        onStartCourse: (c) => void this.startCourse(c),
        onHover: () => this.audio.playUiSfx('hover'),
      });
    } else if (next === 'profile' || next === 'lobby') {
      this.syncProfileUI();
    }

    this.syncSceneDom();
    document.body.dataset.state = this.flow.getSnapshot().bodyStateAttr;
  }

  private syncSceneDom(): void {
    const s = this.flow.getScene();
    this.titleOverlay.classList.toggle('panel-hidden', s !== 'title');
    this.lobbyOverlay.classList.toggle('panel-hidden', s !== 'lobby');
    this.selectOverlay.classList.toggle('panel-hidden', s !== 'select');
    this.courseOverlay.classList.toggle('panel-hidden', s !== 'course');
    this.profileOverlay.classList.toggle('panel-hidden', s !== 'profile');
    this.introOverlay.classList.toggle('panel-hidden', s !== 'intro');
    this.playHudOverlay.classList.toggle('panel-hidden', s !== 'playing' && s !== 'paused');
    this.stageTouchZones.classList.toggle('panel-hidden', s !== 'playing');
    this.resultOverlay.classList.toggle('panel-hidden', s !== 'result');
    this.pauseModal.classList.toggle('panel-hidden', s !== 'paused');
    this.stageCanvas.classList.toggle('panel-hidden', s === 'studio');
  }

  private exitToWorkstation(): void {
    this.audio.stop();
    this.stopActivePerformance();
    this.onExitToWorkstation?.();
  }

  // ===========================================================================
  // SONG LIBRARY, SPOTLIGHT & PROFILE SYNC
  // ===========================================================================

  private refreshSongLibrary(): void {
    const builtins = getBuiltinRhythmSongs();
    const customs = this.storage.loadCustomProjects();
    this.songs = [...builtins, ...customs];
  }

  private getSelectedSong(): RhythmSongProject | null {
    return this.songs.find((s) => s.id === this.selectedSongId) ?? this.songs[0] ?? null;
  }

  private syncProfileUI(): void {
    this.records = this.storage.loadRecords();
    this.courseRecords = this.storage.loadCourseRecords();
    const meta = this.storage.loadProfileMeta();
    const customCount = this.songs.filter((s) => s.isCustom).length;
    const summary = evaluatePlayerProfile({
      songs: this.songs,
      records: this.records,
      courseRecords: this.courseRecords,
      totalPlays: meta.totalPlays,
      customChartCount: customCount,
    });

    this.lobbyRatingVal.textContent = summary.rating.toFixed(2);
    this.lobbyRankLabel.textContent = `${summary.rankTitle} · ${summary.rankCode}`;
    this.lobbyStatsLine.textContent = `通關 ${summary.clearedCharts} · FC ${summary.fcCount} · 段位 ${summary.coursesCleared}/3`;
    renderProfileContent(this.profileSummaryEl, this.profileAchGridEl, summary);
  }

  private renderSongList(): void {
    this.songListEl.innerHTML = '';
    const { signal } = this.ac;

    for (const song of this.songs) {
      const selected = song.id === this.selectedSongId;
      const chart = song.charts[this.selectedDifficulty];
      const rec = this.records[makeRecordKey(song.id, this.selectedDifficulty)];

      const row = document.createElement('button');
      row.type = 'button';
      row.className = selected ? 'rhy-song-row is-selected' : 'rhy-song-row';
      row.style.setProperty('--row-accent', song.accentPrimary);

      const thumbFrame = document.createElement('div');
      thumbFrame.className = 'rhy-song-thumb';
      const thumbImg = document.createElement('img');
      thumbImg.className = 'rhy-song-thumb-img';
      syncJacketFrame(thumbFrame, thumbImg, song);
      thumbFrame.appendChild(thumbImg);

      const copy = document.createElement('div');
      copy.className = 'rhy-song-row-copy';
      const t = document.createElement('strong');
      t.textContent = song.title;
      const sub = document.createElement('span');
      sub.textContent = `${song.artist} · ${song.bpm} BPM`;
      copy.append(t, sub);

      const right = document.createElement('div');
      right.className = 'rhy-song-row-right';
      const lv = document.createElement('span');
      lv.className = 'rhy-song-lv';
      lv.textContent = `Lv.${chart.level}`;
      const gr = document.createElement('span');
      gr.className = 'rhy-song-grade';
      gr.textContent = rec ? formatGradeLabel(rec.grade) : '—';
      right.append(lv, gr);

      row.append(thumbFrame, copy, right);
      row.addEventListener(
        'click',
        () => {
          this.selectedSongId = song.id;
          this.audio.playUiSfx('switch');
          this.renderSongList();
          this.renderSpotlight();
          this.startPreviewForSelectedSong();
        },
        { signal },
      );
      this.songListEl.appendChild(row);
    }
  }

  private renderSpotlight(): void {
    const song = this.getSelectedSong();
    if (!song) return;

    this.stageRenderer.syncSongVisuals(song);
    syncJacketFrame(this.jacketFrameEl, this.jacketImgEl, song);

    this.spotlightTitle.textContent = song.title;
    this.spotlightSub.textContent = `${song.subtitle} — ${song.artist}`;
    const durSec = Math.round(song.durationMs / 1000);
    const minStr = `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}`;
    const chart = song.charts[this.selectedDifficulty];
    this.spotlightMeta.textContent = `${song.genre} · ${song.bpm} BPM · ${minStr} · ${chart.notes.length} 音符 · 峰值 ${chart.peakNps} NPS`;

    const rec = this.records[makeRecordKey(song.id, this.selectedDifficulty)];
    this.bestSummaryEl.textContent = rec
      ? `最佳紀錄  ${formatGradeLabel(rec.grade)}  ${rec.score.toLocaleString()}  (${rec.accuracy.toFixed(2)}% · ${rec.clearBadge})`
      : '尚未有此難度演奏紀錄 — 準備登場';

    this.diffRowEl.innerHTML = '';
    for (const diff of RHYTHM_DIFFICULTIES) {
      const ch = song.charts[diff];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `rhy-diff-btn is-${diff.toLowerCase()} ${diff === this.selectedDifficulty ? 'is-active' : ''}`;
      b.textContent = `${diff}  Lv.${ch.level}`;
      b.addEventListener(
        'click',
        () => {
          this.selectedDifficulty = diff;
          this.audio.playUiSfx('switch');
          this.renderSongList();
          this.renderSpotlight();
        },
        { signal: this.ac.signal },
      );
      this.diffRowEl.appendChild(b);
    }

    renderDensitySparkline(this.densityCanvas, chart.densityBins, song.accentPrimary, song.accentSecondary);
    this.deleteCustomBtn.classList.toggle('panel-hidden', !song.isCustom);
  }

  private startPreviewForSelectedSong(): void {
    const song = this.getSelectedSong();
    if (!song || !this.visible || this.flow.getScene() !== 'select') return;
    void this.audio
      .loadProjectAudio(song, (k) => this.storage.loadAudioBlob(k))
      .then((track) => {
        if (!track || !this.visible || this.flow.getScene() !== 'select') return;
        if (this.selectedSongId !== song.id) return;
        this.audio.playPreviewLoop(track, song.previewStartMs, song.previewEndMs);
      })
      .catch(() => {});
  }

  // ===========================================================================
  // PERFORMANCE LAUNCH, FLY-IN INTRO, COURSE CONTINUATION & RESULT
  // ===========================================================================

  private async startCourse(course: RhythmCourseDefinition): Promise<void> {
    const first = course.stages[0];
    const song = this.songs.find((s) => s.id === first.songId) ?? this.songs[0];
    if (!song) return;

    this.activeCourseRun = {
      course,
      stageIndex: 0,
      carryHp: 100,
      stageRecords: [],
    };
    this.selectedSongId = song.id;
    this.selectedDifficulty = first.difficulty;
    await this.startPerformance(song, first.difficulty, 0, 100);
  }

  private async startPerformance(
    project: RhythmSongProject,
    difficulty: RhythmDifficulty,
    startFromMs: number,
    initialHp = 100,
  ): Promise<void> {
    this.audio.unlock();
    this.audio.stop();
    (document.activeElement as HTMLElement | null)?.blur?.();

    const track = await this.audio.loadProjectAudio(project, (k) => this.storage.loadAudioBlob(k));
    if (!track) return;

    this.activeTrack = track;
    this.activePlayProject = project;
    this.selectedSongId = project.id;
    this.selectedDifficulty = difficulty;
    this.playStartCursorMs = startFromMs;
    this.resumeCountdownSec = 0;
    this.finishHoldTimer = 0;
    this.resultShown = false;
    this.lastFeverTier = 0;
    this.pointerLaneMap.clear();
    this.countdownBanner.classList.add('panel-hidden');

    const chart = project.charts[difficulty];
    this.judgeEngine = new RhythmJudgeEngine({
      songId: project.id,
      chart,
      bpm: project.bpm,
      offsetMs: project.offsetMs,
      durationMs: project.durationMs,
      cameraCues: project.cameraCues,
      startFromMs,
      dynamicCamera: this.config.cameraDynamic,
      initialHp,
    });
    this.camera.setStaticGameplayLock(!this.config.cameraDynamic);
    this.stageRenderer.resetEffects();
    this.stageRenderer.syncSongVisuals(project);

    // Populate Intro Slate & Live HUD metadata
    this.introTitleEl.textContent = project.title;
    this.introMetaEl.textContent = `${project.artist} · ${difficulty} Lv.${chart.level} · ${project.bpm} BPM`;
    if (this.activeCourseRun) {
      const idx = this.activeCourseRun.stageIndex + 1;
      const tot = this.activeCourseRun.course.stages.length;
      const label = `${this.activeCourseRun.course.tierCode} ${this.activeCourseRun.course.title} · STAGE ${idx}/${tot}`;
      this.introCourseBadgeEl.textContent = label;
      this.introCourseBadgeEl.classList.remove('panel-hidden');
      this.hudCourseLabel.textContent = `STAGE ${idx}/${tot} · ${this.activeCourseRun.course.tierCode}`;
      this.hudCourseLabel.classList.remove('panel-hidden');
    } else {
      this.introCourseBadgeEl.classList.add('panel-hidden');
      this.hudCourseLabel.classList.add('panel-hidden');
    }

    this.hudSongTitle.textContent = project.title;
    this.hudDiffLabel.textContent = `${difficulty} Lv.${chart.level} · ${project.bpm} BPM`;
    this.hudScoreEl.textContent = '0000000';
    this.hudAccEl.textContent = '100.00%';
    this.hudHpFill.style.width = `${Math.round(initialHp)}%`;
    this.hudProgressFill.style.width = '0%';

    // Start 3D Stage Fly-In Swoop (high dome -> down onto unfolding 4K highway)
    this.camera.snapToShot('STAGE_FLYIN');
    this.camera.setShot(this.config.cameraDynamic ? 'PLAY_ESTABLISHING' : 'PLAY_STANDARD', 2.8);
    this.audio.playUiSfx('flyin');
    this.flow.startStageIntro(startFromMs > 0 ? 0.55 : 1.15);
    this.syncSceneDom();
    document.body.dataset.state = 'playing';
  }

  private beginLivePlaybackAfterIntro(): void {
    if (!this.activeTrack) return;
    this.camera.setShot(this.config.cameraDynamic ? 'PLAY_ESTABLISHING' : 'PLAY_STANDARD', 5.5);
    this.audio.playTrack(this.activeTrack, this.playStartCursorMs, 1.0, 0.05);
    this.syncSceneDom();
    document.body.dataset.state = 'playing';
  }

  private handleStageCompleted(failed: boolean): void {
    if (!this.judgeEngine || !this.activePlayProject) return;
    const record = this.judgeEngine.getPlayRecord();
    this.audio.stop();
    this.storage.incrementPlayCount();

    if (this.playStartCursorMs === 0) {
      this.storage.saveRecordIfBest(record);
      this.records = this.storage.loadRecords();
    }

    // Check Course Mode continuation
    if (this.activeCourseRun) {
      const run = this.activeCourseRun;
      run.stageRecords.push(record);
      run.carryHp = Math.max(0, this.judgeEngine.getLiveState().hp);

      if (!failed && run.stageIndex + 1 < run.course.stages.length) {
        run.stageIndex += 1;
        const nextStage = run.course.stages[run.stageIndex];
        const nextSong = this.songs.find((s) => s.id === nextStage.songId) ?? this.songs[0];
        if (nextSong) {
          void this.startPerformance(nextSong, nextStage.difficulty, 0, Math.max(15, run.carryHp));
          return;
        }
      }

      // Course finished (cleared or failed)
      const courseResult = evaluateCourseOutcome(run.course, run.stageRecords, run.carryHp, failed);
      this.storage.saveCourseRecordIfBest(courseResult);
      this.courseRecords = this.storage.loadCourseRecords();
      this.showResultShowcase(record, courseResult);
      return;
    }

    this.showResultShowcase(record, null);
  }

  private showResultShowcase(
    record: RhythmPlayRecord,
    courseResult: RhythmCourseClearRecord | null,
  ): void {
    this.lastResultRecord = record;
    this.audio.playUiSfx('result');
    this.syncProfileUI();

    const meta = this.storage.loadProfileMeta();
    const profile = evaluatePlayerProfile({
      songs: this.songs,
      records: this.records,
      courseRecords: this.courseRecords,
      totalPlays: meta.totalPlays,
      customChartCount: this.songs.filter((s) => s.isCustom).length,
    });

    this.resGradeEl.textContent = formatGradeLabel(record.grade);
    this.resGradeEl.dataset.grade = record.grade;

    if (courseResult) {
      this.resBadgeEl.textContent = courseResult.cleared
        ? `${courseResult.medal} MEDAL · 段位合格`
        : 'COURSE FAILED';
      this.resCourseSummaryEl.textContent = `${this.activeCourseRun?.course.tierCode ?? ''} ${this.activeCourseRun?.course.title ?? ''} · 總分 ${courseResult.totalScore.toLocaleString()} · 平均準度 ${courseResult.avgAccuracy.toFixed(2)}%`;
      this.resCourseSummaryEl.classList.remove('panel-hidden');
    } else {
      this.resBadgeEl.textContent =
        record.clearBadge === 'AP'
          ? 'ALL PERFECT'
          : record.clearBadge === 'FC'
            ? 'FULL COMBO'
            : record.clearBadge === 'FAIL'
              ? 'STAGE FAILED'
              : 'STAGE CLEAR';
      this.resCourseSummaryEl.classList.add('panel-hidden');
    }

    this.resSongTitle.textContent = `${this.activePlayProject?.title ?? record.songId} · ${record.difficulty}`;
    this.resScoreEl.innerHTML = `<span>SCORE</span><strong>${record.score.toLocaleString()}</strong>`;
    this.resAccEl.innerHTML = `<span>ACCURACY</span><strong>${record.accuracy.toFixed(2)}%</strong>`;
    this.resComboEl.innerHTML = `<span>MAX COMBO</span><strong>${record.maxCombo} / ${record.totalNotes}</strong>`;
    this.resRatingEl.innerHTML = `<span>RATING</span><strong>${profile.rating.toFixed(2)}</strong>`;

    this.resCountsEl.innerHTML = '';
    const tiers: [string, number, string][] = [
      ['MARVELOUS', record.counts.MARVELOUS, '#f8fafc'],
      ['PERFECT', record.counts.PERFECT, '#f59e0b'],
      ['GREAT', record.counts.GREAT, '#38bdf8'],
      ['GOOD', record.counts.GOOD, '#a78bfa'],
      ['MISS', record.counts.MISS, '#f43f5e'],
    ];
    for (const [name, cnt, col] of tiers) {
      const row = document.createElement('div');
      row.className = 'rhy-count-row';
      const lbl = document.createElement('span');
      lbl.textContent = name;
      lbl.style.color = col;
      const val = document.createElement('strong');
      val.textContent = String(cnt);
      row.append(lbl, val);
      this.resCountsEl.appendChild(row);
    }

    renderTimingHistogram(this.resHistCanvas, record.timingHistogram);
    const sign = record.meanOffsetMs > 0 ? '+' : '';
    this.resMeanOffsetEl.textContent = `平均誤差 ${sign}${record.meanOffsetMs.toFixed(1)} ms`;
    this.resApplyOffsetBtn.disabled = Math.abs(record.meanOffsetMs) < 3;
    this.resApplyOffsetBtn.textContent =
      Math.abs(record.meanOffsetMs) >= 3
        ? `一鍵套用 ${sign}${Math.round(record.meanOffsetMs)}ms 延遲建議`
        : '目前節拍同步極佳（無需微調）';

    this.transitionTo('result');
  }

  private stopActivePerformance(): void {
    this.audio.stop();
    this.judgeEngine = null;
    this.resumeCountdownSec = 0;
    this.pointerLaneMap.clear();
    this.countdownBanner.classList.add('panel-hidden');
    this.pauseModal.classList.add('panel-hidden');
  }

  private togglePause(): void {
    const s = this.flow.getScene();
    if (s === 'playing') {
      this.audio.pause();
      this.resumeCountdownSec = 0;
      this.countdownBanner.classList.add('panel-hidden');
      this.flow.pause();
      this.syncSceneDom();
      document.body.dataset.state = 'paused';
    } else if (s === 'paused') {
      this.resumeFromPause();
    }
  }

  private resumeFromPause(): void {
    if (this.flow.getScene() !== 'paused') return;
    this.flow.resume();
    this.resumeCountdownSec = 2.99;
    this.countdownBanner.textContent = '3';
    this.countdownBanner.classList.remove('panel-hidden');
    this.syncSceneDom();
    document.body.dataset.state = 'playing';
  }

  private async openChartStudio(triggerFilePicker: boolean): Promise<void> {
    this.audio.stop();
    this.stopActivePerformance();
    const song = this.getSelectedSong() ?? this.songs[0];
    this.transitionTo('studio');
    if (song) {
      await this.studioView.openWithProject(song, this.selectedDifficulty);
    }
    if (triggerFilePicker) {
      this.studioView.promptAudioImport();
    }
  }

  // ===========================================================================
  // HUD UPDATES, SETTINGS & CALIBRATION WIZARD
  // ===========================================================================

  private updatePlayHudDom(live: ReturnType<RhythmJudgeEngine['getLiveState']>, durationMs: number): void {
    this.hudScoreEl.textContent = String(live.score).padStart(7, '0');
    this.hudAccEl.textContent = `${live.accuracy.toFixed(2)}%`;
    this.hudHpFill.style.width = `${Math.max(0, Math.min(100, live.hp))}%`;
    this.hudHpFill.classList.toggle('is-low', live.hp < 28);
    const pct = Math.max(0, Math.min(100, (live.songTimeMs / Math.max(1000, durationMs)) * 100));
    this.hudProgressFill.style.width = `${pct.toFixed(1)}%`;
  }

  private adjustSpeed(delta: number): void {
    this.config.scrollSpeed = Math.round(Math.max(1.0, Math.min(6.0, this.config.scrollSpeed + delta)) * 10) / 10;
    this.storage.saveConfig(this.config);
    this.audio.playUiSfx('switch');
    this.syncConfigReadouts();
  }

  private adjustOffset(deltaMs: number): void {
    this.config.audioOffsetMs = Math.max(-250, Math.min(250, this.config.audioOffsetMs + deltaMs));
    this.storage.saveConfig(this.config);
    this.audio.playUiSfx('switch');
    this.syncConfigReadouts();
  }

  private syncConfigReadouts(): void {
    this.speedValEl.textContent = `${this.config.scrollSpeed.toFixed(1)}×`;
    const sign = this.config.audioOffsetMs > 0 ? '+' : '';
    this.offsetValEl.textContent = `${sign}${this.config.audioOffsetMs}ms`;
    const camLabel = this.config.cameraDynamic ? '運鏡：動態 3D 運鏡' : '運鏡：靜態競技鎖定';
    this.camModeBtn.textContent = camLabel;
    this.calibCamBtn.textContent = camLabel;
    const hitLabels: Record<RhythmHitsoundPreset, string> = {
      clap: '打擊音：清脆拍點',
      tick: '打擊音：機械木魚',
      crystal: '打擊音：星晶風鈴',
      off: '打擊音：關閉',
    };
    this.hitsoundBtn.textContent = hitLabels[this.config.hitsoundPreset];
  }

  private toggleAudioMute(): void {
    const nextMuted = !this.audio.isMuted();
    this.audio.setMuted(nextMuted);
    this.updateMuteButtonIcon(this.lobbyMuteBtn, nextMuted);
    this.updateMuteButtonIcon(this.hudMuteBtn, nextMuted);
    if (!nextMuted) this.audio.playUiSfx('switch');
  }

  private updateMuteButtonIcon(btn: HTMLButtonElement, muted: boolean): void {
    btn.innerHTML = '';
    btn.appendChild(createHudIconSvg(muted ? 'muted' : 'volume'));
    btn.title = muted ? '解除靜音 [M]' : '靜音 [M]';
  }

  private openCalibrationModal(): void {
    this.calibOpen = true;
    this.calibSamples = [];
    this.calibReadoutEl.textContent = '聆聽節拍，按下空白鍵或點擊圓環 (0 / 8)';
    this.calibModal.classList.remove('panel-hidden');
    this.syncConfigReadouts();
    this.audio.startCalibrationLoop(() => {
      this.calibPulseRing.classList.add('is-beat');
      window.setTimeout(() => this.calibPulseRing.classList.remove('is-beat'), 110);
    });
  }

  private recordCalibrationTap(): void {
    if (!this.calibOpen) return;
    const sample = this.audio.measureCalibrationTapOffsetMs();
    if (sample === null) return;
    this.calibSamples.push(sample);
    if (this.calibSamples.length > 8) this.calibSamples.shift();
    const avg = Math.round(
      this.calibSamples.reduce((a, b) => a + b, 0) / this.calibSamples.length,
    );
    const sign = avg > 0 ? '+' : '';
    this.calibReadoutEl.textContent = `已取樣 ${this.calibSamples.length} / 8 · 建議延遲 ${sign}${avg} ms`;
  }

  private closeCalibrationModal(): void {
    if (!this.calibOpen) return;
    this.calibOpen = false;
    this.audio.stopCalibrationLoop();
    this.calibModal.classList.add('panel-hidden');
  }

  // ===========================================================================
  // INPUT HYGIENE (Keyboard + Multi-Touch Lanes + Subtle Mouse Parallax)
  // ===========================================================================

  private bindInputs(): void {
    const { signal } = this.ac;

    // Gentle 3D camera parallax in menu acts (disabled during gameplay)
    this.element.addEventListener(
      'pointermove',
      (e) => {
        if (!this.visible) return;
        const s = this.flow.getScene();
        if (s === 'playing' || s === 'intro' || s === 'studio') return;
        const rect = this.element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
        this.camera.setPointerParallax(nx * 0.6, ny * 0.5);
      },
      { signal },
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.visible) return;
        const scene = this.flow.getScene();
        if (scene === 'studio') return;

        // Ignore typing inside input fields
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if (this.calibOpen) {
          if (e.code === 'Space') {
            e.preventDefault();
            this.recordCalibrationTap();
          } else if (e.code === 'Escape') {
            e.preventDefault();
            this.closeCalibrationModal();
          }
          return;
        }

        if (e.code === 'KeyM' && !e.repeat) {
          this.toggleAudioMute();
          return;
        }

        if (scene === 'title') {
          if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            this.enterFromTitle();
          }
          return;
        }

        if (scene === 'intro') {
          if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            if (this.flow.skipIntro()) {
              this.beginLivePlaybackAfterIntro();
            }
          }
          return;
        }

        if (scene === 'playing' || scene === 'paused') {
          if (e.code === 'Escape' || e.code === 'KeyP') {
            e.preventDefault();
            this.togglePause();
            return;
          }
          if (scene === 'paused' || this.resumeCountdownSec > 0 || !this.judgeEngine) return;
          if (e.repeat) return;

          const laneIdx = this.config.keyBindings.indexOf(e.code);
          if (laneIdx >= 0 && laneIdx <= 3) {
            e.preventDefault();
            const songMs = this.audio.getCurrentSongTimeMs(this.config.audioOffsetMs);
            const ev = this.judgeEngine.pressLane(laneIdx as RhythmLane, songMs);
            this.audio.playHitsound(
              this.config.hitsoundPreset,
              ev?.tier === 'MARVELOUS' || ev?.tier === 'PERFECT',
            );
          }
          return;
        }

        // Clean Esc back navigation across sub-pages
        if (e.code === 'Escape') {
          if (scene === 'select' || scene === 'course' || scene === 'profile') {
            e.preventDefault();
            this.audio.playUiSfx('back');
            this.transitionTo('lobby');
          } else if (scene === 'result') {
            e.preventDefault();
            this.audio.playUiSfx('back');
            this.transitionTo('select');
          }
        }
      },
      { signal },
    );

    window.addEventListener(
      'keyup',
      (e) => {
        if (!this.visible || this.flow.getScene() !== 'playing' || !this.judgeEngine) return;
        const laneIdx = this.config.keyBindings.indexOf(e.code);
        if (laneIdx >= 0 && laneIdx <= 3) {
          const songMs = this.audio.getCurrentSongTimeMs(this.config.audioOffsetMs);
          this.judgeEngine.releaseLane(laneIdx as RhythmLane, songMs);
        }
      },
      { signal },
    );

    // Clear held lanes on focus loss without auto-opening pause modal
    window.addEventListener(
      'blur',
      () => {
        if (!this.judgeEngine) return;
        const songMs = this.audio.getCurrentSongTimeMs(this.config.audioOffsetMs);
        for (let l = 0; l < 4; l++) {
          this.judgeEngine.releaseLane(l as RhythmLane, songMs);
        }
        this.pointerLaneMap.clear();
      },
      { signal },
    );

    // Multi-touch 4-lane pointer support on mobile/tablet
    this.stageTouchZones.addEventListener(
      'pointerdown',
      (e) => {
        if (this.flow.getScene() !== 'playing' || !this.judgeEngine || this.resumeCountdownSec > 0) {
          return;
        }
        const rect = this.stageTouchZones.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
        const lane = Math.max(0, Math.min(3, Math.floor(relX * 4))) as RhythmLane;
        this.pointerLaneMap.set(e.pointerId, lane);
        this.stageTouchZones.setPointerCapture?.(e.pointerId);
        const songMs = this.audio.getCurrentSongTimeMs(this.config.audioOffsetMs);
        const ev = this.judgeEngine.pressLane(lane, songMs);
        this.audio.playHitsound(
          this.config.hitsoundPreset,
          ev?.tier === 'MARVELOUS' || ev?.tier === 'PERFECT',
        );
      },
      { signal },
    );

    const releasePointer = (e: PointerEvent) => {
      const lane = this.pointerLaneMap.get(e.pointerId);
      if (lane === undefined) return;
      this.pointerLaneMap.delete(e.pointerId);
      if (this.judgeEngine && this.flow.getScene() === 'playing') {
        const songMs = this.audio.getCurrentSongTimeMs(this.config.audioOffsetMs);
        this.judgeEngine.releaseLane(lane, songMs);
      }
    };
    this.stageTouchZones.addEventListener('pointerup', releasePointer, { signal });
    this.stageTouchZones.addEventListener('pointercancel', releasePointer, { signal });
  }

  private resizeStageToContainer(): void {
    const rect = this.element.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width || window.innerWidth));
    const h = Math.max(200, Math.floor(rect.height || window.innerHeight));
    this.stageRenderer.resize(w, h, window.devicePixelRatio || 1);
  }

  private makeBtn(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener(
      'click',
      () => {
        b.blur();
        onClick();
      },
      { signal: this.ac.signal },
    );
    return b;
  }

  private makeUtilityBtn(
    icon: 'pause' | 'volume' | 'muted' | 'exit',
    label: string,
    onClick: () => void,
    showText: boolean,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = showText ? 'rhy-util-btn has-label' : 'rhy-util-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(createHudIconSvg(icon));
    if (showText) {
      const span = document.createElement('span');
      span.textContent = label;
      b.appendChild(span);
    }
    b.addEventListener(
      'click',
      () => {
        b.blur();
        onClick();
      },
      { signal: this.ac.signal },
    );
    return b;
  }
}
