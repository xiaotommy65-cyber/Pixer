import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import { appLogger } from '../../core/runtime/AppLogger.ts';
import { primeExplosive, type RuleWorldActions } from '../../core/sim/RuleMatrix.ts';
import { WorldKernel } from '../../core/sim/WorldKernel.ts';
import type {
  ComboTrackingCartridge,
  DebuggableCartridge,
  InputState,
  RenderSceneSnapshot,
  RuntimeParams,
  SimEvent,
} from '../../core/types/WorldTypes.ts';
import {
  DEFAULT_SANDBOX_SCRIPT,
  SANDBOX_PUZZLES,
  type PuzzleSpec,
  type SandboxScriptApi,
} from './SandboxPuzzles.ts';

export { DEFAULT_SANDBOX_SCRIPT, SANDBOX_PUZZLES, type PuzzleSpec, type SandboxScriptApi };

/**
 * PA-03 Sandbox Toybox: Supports BOTH 10-Stage Zelda-Style Puzzle Campaign
 * AND Free Live-Scriptable Workshop Mode powered by WorldKernel + RuleMatrix!
 */
export class SandboxToyboxGame implements DebuggableCartridge, ComboTrackingCartridge {
  private readonly world: WorldKernel;
  private readonly campaignMode: boolean;
  private readonly customScriptSource: string;
  private lastParams?: RuntimeParams;
  private puzzleIdx = 0;
  private bestStarsByStage: number[] = SANDBOX_PUZZLES.map(() => 0);
  public scriptError: string | null = null;

  constructor(scriptSource?: string, params?: RuntimeParams) {
    this.world = new WorldKernel({
      cartridgeId: 'sandbox-toybox',
      worldWidth: GAME_W,
      worldHeight: GAME_H,
      skyTop: '#8fd8ff',
      skyBottom: '#fff4df',
    });
    this.customScriptSource = scriptSource ?? DEFAULT_SANDBOX_SCRIPT;
    this.lastParams = params;
    const isCustomScript = Boolean(scriptSource && scriptSource.trim() !== DEFAULT_SANDBOX_SCRIPT.trim());
    this.campaignMode = !isCustomScript;
    this.world.onSkillYOverride = (actions) => this.tryRemoteDetonate(actions);
    if (this.campaignMode) {
      this.loadPuzzle(0, params);
    } else {
      this.buildFromScript(this.customScriptSource, params);
    }
  }

  private tryRemoteDetonate(actions: RuleWorldActions): boolean {
    const hx = this.world.hero.x + 8;
    const hy = this.world.hero.y + 8;
    let bestBomb = null as (typeof this.world.entities)[number] | null;
    let bestDist = Infinity;
    for (const e of this.world.entities) {
      if (!e.alive || !e.tags.has('explosive')) continue;
      const d = Math.hypot(e.x + 8 - hx, e.y + 8 - hy);
      if (d < bestDist) {
        bestDist = d;
        bestBomb = e;
      }
    }
    if (!bestBomb) return false;
    primeExplosive(bestBomb, actions, 0.08);
    actions.spawnBurst(bestBomb.x + 8, bestBomb.y + 8, ['#ffd447', '#ff708d', '#fffaf0'], 10);
    this.world.noticeBanner = '💣 遙控點燃最近炸彈！';
    this.world.noticeTimer = 1.6;
    return true;
  }

  public isCampaignMode(): boolean {
    return this.campaignMode;
  }

  public getPuzzleIndex(): number {
    return this.puzzleIdx;
  }

  public getPuzzleCount(): number {
    return SANDBOX_PUZZLES.length;
  }

  public setDebugHitboxes(enabled: boolean): void {
    this.world.debugHitboxes = enabled;
  }

  private createScriptApi(applyGroundSprite = true): SandboxScriptApi {
    let slimeCount = 0;
    this.world.solids.push({ x: 0, y: 150, w: GAME_W, h: 30, kind: 'solid' });
    if (applyGroundSprite) {
      for (let x = 0; x < GAME_W; x += 16) {
        this.world.tiles.push({ sprite: 'grass', x, y: 150, w: 16, h: 16 });
        this.world.tiles.push({ sprite: 'dirt', x, y: 166, w: 16, h: 16 });
      }
    }

    return {
      setSky: (topHex: string, bottomHex: string) => {
        if (/^#[0-9a-fA-F]{6}$/.test(topHex)) this.world.skyTop = topHex;
        if (/^#[0-9a-fA-F]{6}$/.test(bottomHex)) this.world.skyBottom = bottomHex;
      },
      setDarkness: (alpha: number, tintHex = '#120e24') => {
        this.world.ambientDarkness = Math.max(0, Math.min(0.88, Number(alpha) || 0));
        if (/^#[0-9a-fA-F]{6}$/.test(tintHex)) this.world.ambientColor = tintHex;
      },
      setHeroSpawn: (x: number, y: number) => {
        const sx = Math.max(8, Math.min(GAME_W - 24, Number(x) || 34));
        const sy = Math.max(16, Math.min(134, Number(y) || 120));
        this.world.hero.x = sx;
        this.world.hero.y = sy;
        this.world.hero.checkpoint = { x: sx, y: sy };
      },
      addCloud: (x: number, y: number, tilesWide = 3) => {
        this.world.addCloudPlatform(Number(x) || 80, Number(y) || 120, tilesWide);
      },
      addWall: (x: number, y: number, w: number, h: number, sprite: SpriteId = 'stone') => {
        this.world.addSolidTileRect(
          Number(x) || 0,
          Number(y) || 0,
          Math.max(8, Number(w) || 16),
          Math.max(8, Number(h) || 16),
          sprite,
        );
      },
      addSwitchWall: (x: number, y: number, w: number, h: number, sprite: SpriteId = 'stone') => {
        this.world.addSolidTileRect(
          Number(x) || 0,
          Number(y) || 0,
          Math.max(8, Number(w) || 16),
          Math.max(8, Number(h) || 16),
          sprite,
          '#e0aaff',
          true,
        );
      },
      addMovingPlatform: (x: number, y: number, tilesWide = 3, opts = {}) => {
        this.world.addMovingPlatform(Number(x) || 120, Number(y) || 110, tilesWide, opts);
      },
      addStar: (x: number, y: number) => {
        this.world.spawn(
          'star',
          Math.max(8, Math.min(GAME_W - 20, Number(x) || 100)),
          Math.max(16, Math.min(134, Number(y) || 100)),
        );
      },
      addSlime: (x: number, y: number) => {
        const sx = Math.max(16, Math.min(GAME_W - 32, Number(x) || 140));
        this.world.spawn('slime', sx, Number(y) || 134, {
          minX: Math.max(8, sx - 36),
          maxX: Math.min(GAME_W - 24, sx + 36),
          vx: slimeCount++ % 2 === 0 ? 28 : -28,
        });
      },
      addSpring: (x: number, y: number) => {
        this.world.spawn('spring', Number(x) || 80, Number(y) || 134);
      },
      addCrate: (x: number, y: number) => {
        this.world.spawn('crate', Number(x) || 110, Number(y) || 134);
      },
      addBomb: (x: number, y: number) => {
        this.world.spawn('bomb', Number(x) || 140, Number(y) || 134);
      },
      addTorch: (x: number, y: number) => {
        this.world.spawn('torch', Number(x) || 80, Number(y) || 134);
      },
      addSwitch: (x: number, y: number) => {
        this.world.spawn('switch_pad', Number(x) || 160, Number(y) || 134);
      },
      addPortal: (x: number, y: number, group = 'main') => {
        this.world.spawn('portal', Number(x) || 100, Number(y) || 134, { portalGroup: group });
      },
      addKey: (x: number, y: number) => {
        this.world.spawn('key', Number(x) || 200, Number(y) || 96);
      },
      addGate: (x: number, y: number) => {
        this.world.spawn('gate', Number(x) || 288, Number(y) || 134);
      },
    };
  }

  public loadPuzzle(idx: number, _params?: RuntimeParams): void {
    this.puzzleIdx = Math.max(0, Math.min(SANDBOX_PUZZLES.length - 1, idx));
    const spec = SANDBOX_PUZZLES[this.puzzleIdx];
    this.world.resetStage({
      worldWidth: GAME_W,
      worldHeight: GAME_H,
      skyTop: '#8fd8ff',
      skyBottom: '#fff4df',
      ambientDarkness: 0,
      statusBanner: spec.hint,
      stage: {
        index: this.puzzleIdx + 1,
        total: SANDBOX_PUZZLES.length,
        name: spec.name,
      },
      bgmTheme: spec.bgmTheme,
    });
    this.world.bgClouds = [
      { x: 32, y: 28, scale: 1.0, speed: 5, tint: '#ffffff', alpha: 0.78 },
      { x: 210, y: 38, scale: 1.15, speed: 6, tint: '#fffaf0', alpha: 0.72 },
    ];
    this.scriptError = null;
    const api = this.createScriptApi(true);
    spec.build(api);
    if (this.world.ambientDarkness > 0.25) {
      for (const t of this.world.tiles) {
        if (t.sprite === 'grass' || t.sprite === 'dirt') t.sprite = 'stone';
      }
      this.world.bgClouds = [];
    }
  }

  public buildFromScript(scriptSource: string, params?: RuntimeParams): void {
    this.world.resetStage({
      worldWidth: GAME_W,
      worldHeight: GAME_H,
      skyTop: '#8fd8ff',
      skyBottom: '#fff4df',
      ambientDarkness: 0,
      bgmTheme: 'meadow',
    });
    this.world.bgClouds = [
      { x: 32, y: 28, scale: 1.0, speed: 5, tint: '#ffffff', alpha: 0.78 },
      { x: 210, y: 38, scale: 1.15, speed: 6, tint: '#fffaf0', alpha: 0.72 },
    ];
    this.scriptError = null;

    const api = this.createScriptApi(true);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Compile and execute user-authored Workshop script inside try-catch so syntax or
    // runtime typos remain recoverable and always leave at least one collectible star on stage.
    try {
      const fn = new Function('api', scriptSource);
      fn(api);
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      appLogger.success(
        'parsing',
        'sandbox.execScript',
        '已編譯並執行積木工房 2D 腳本',
        { scriptLength: scriptSource.length, entityCount: this.world.entities.length },
        dt,
      );
    } catch (err) {
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      this.scriptError = err instanceof Error ? err.message : String(err);
      appLogger.error(
        'parsing',
        'sandbox.execScript',
        '積木工房 2D 腳本編譯或執行發生錯誤',
        err,
        { scriptLength: scriptSource.length },
        dt,
      );
      if (this.world.entities.every((e) => e.archetype !== 'star')) {
        api.addCloud(90, 120, 3);
        api.addStar(106, 98);
      }
    }

    if (params) {
      const desired = Math.max(0, Math.min(8, Math.round(params.enemyCount)));
      const currentSlimes = this.world.entities.filter((e) => e.archetype === 'slime');
      if (currentSlimes.length > desired) {
        let toRemove = currentSlimes.length - desired;
        for (let i = this.world.entities.length - 1; i >= 0 && toRemove > 0; i--) {
          if (this.world.entities[i].archetype === 'slime') {
            this.world.entities.splice(i, 1);
            toRemove--;
          }
        }
      } else {
        for (let idx = currentSlimes.length; idx < desired; idx++) {
          const sx = Math.min(GAME_W - 28, 86 + idx * 34);
          api.addSlime(sx, 134);
        }
      }
    }

    if (this.world.ambientDarkness > 0.25) {
      for (const t of this.world.tiles) {
        if (t.sprite === 'grass' || t.sprite === 'dirt') t.sprite = 'stone';
      }
      this.world.bgClouds = [];
    }
  }

  public step(dt: number, input: InputState, params: RuntimeParams): SimEvent[] {
    const events = this.world.step(dt, input, params);
    if (this.world.input.justPressed('shoulderL')) {
      this.retryStage();
      events.push('snap');
      return events;
    }
    if (this.world.input.justPressed('skillX') && this.campaignMode) {
      this.world.noticeBanner = `💡 機關線索：${SANDBOX_PUZZLES[this.puzzleIdx].hint}`;
      this.world.noticeTimer = 2.8;
    }
    if (this.campaignMode) {
      const curStars = this.world.getStageStars().collected;
      if (curStars > this.bestStarsByStage[this.puzzleIdx]) {
        this.bestStarsByStage[this.puzzleIdx] = curStars;
      }
      const spec = SANDBOX_PUZZLES[this.puzzleIdx];
      this.world.statusBanner = this.world.gateUnlocked
        ? `${spec.name}｜機關已解鎖！踏入彩虹傳送門前往下一關！`
        : spec.hint;

      if (this.world.status === 'won' && this.puzzleIdx + 1 < SANDBOX_PUZZLES.length) {
        this.world.hearts = Math.min(this.world.maxHearts, this.world.hearts + 1);
        this.loadPuzzle(this.puzzleIdx + 1);
        this.world.juice.triggerFlash('#fffaf0', 0.24);
        events.push('key');
      }
      return events;
    }

    if (this.scriptError) {
      this.world.statusBanner = `積木語法提醒：${this.scriptError}`;
    } else if (this.world.ambientDarkness > 0.25) {
      this.world.statusBanner = this.world.gateUnlocked
        ? '機關門開啟！踏入傳送門破關！'
        : '暗影地牢：推箱壓開關、用火炬或火花 A 引爆炸彈！';
    } else {
      this.world.statusBanner = '按 A 發射火花點燃木箱炸彈・F3 可切換碰撞除錯框！';
    }
    return events;
  }

  public retryStage(): void {
    this.world.hearts = this.world.maxHearts;
    if (!this.campaignMode) {
      this.buildFromScript(this.customScriptSource, this.lastParams);
      return;
    }
    this.loadPuzzle(this.puzzleIdx);
  }

  public serializeSave(): unknown {
    if (!this.campaignMode) return null;
    return {
      v: 1,
      puzzleIdx: this.puzzleIdx,
      score: this.world.score,
      hearts: this.world.hearts,
      bestStarsByStage: [...this.bestStarsByStage],
    };
  }

  public hydrateSave(raw: unknown): boolean {
    if (!this.campaignMode || !raw || typeof raw !== 'object') return false;
    const s = raw as { v?: number; puzzleIdx?: number; score?: number; hearts?: number; bestStarsByStage?: number[] };
    if (s.v !== 1 || typeof s.puzzleIdx !== 'number') return false;
    this.world.score = Number(s.score ?? 0);
    this.world.hearts = Math.max(1, Math.min(this.world.maxHearts, Number(s.hearts ?? 3)));
    if (Array.isArray(s.bestStarsByStage)) {
      this.bestStarsByStage = SANDBOX_PUZZLES.map((_, i) => Number(s.bestStarsByStage?.[i] ?? 0));
    }
    this.loadPuzzle(s.puzzleIdx);
    this.world.noticeBanner = `💾 已從 ${SANDBOX_PUZZLES[this.puzzleIdx].name} 續關！`;
    this.world.noticeTimer = 3.0;
    return true;
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    return this.world.status;
  }

  public getComboCount(): number {
    return this.world.juice.comboCount;
  }

  public snapshot(params: RuntimeParams): RenderSceneSnapshot {
    const snap = this.world.snapshot(params);
    if (this.campaignMode) {
      const curCollected = this.world.getStageStars().collected;
      let totalCollected = 0;
      for (let i = 0; i < SANDBOX_PUZZLES.length; i++) {
        totalCollected += i === this.puzzleIdx ? Math.max(this.bestStarsByStage[i], curCollected) : this.bestStarsByStage[i];
      }
      snap.starsCollected = totalCollected;
      snap.starsTotal = 21;
    }
    return snap;
  }
}
