import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import { InputMap } from '../../core/input/InputMap.ts';
import { JuiceSystem, stepSquashSpring } from '../../core/sim/JuiceSystem.ts';
import {
  clamp,
  type BgStarDesc,
  type ComboTrackingCartridge,
  type DebuggableCartridge,
  type InputState,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type SimEvent,
} from '../../core/types/WorldTypes.ts';
import {
  damageShmupBossCore,
  onShmupWeakPointDestroyed,
  stepShmupBullets,
  updateShmupBoss,
} from './SugarStarlightBoss.ts';
import {
  CHARGE_TIER1_SEC,
  CHARGE_TIER2_SEC,
  FIGHTER_CATALOG,
  SECTORS,
  SHIP_MAX_X,
  SHIP_MAX_Y,
  SHIP_MIN_X,
  SHIP_MIN_Y,
  STARFIELD_PALETTE,
  WEAPON_CATALOG,
  getFighterProfile,
  type BossState,
  type Bullet,
  type ChargeTier,
  type EnemyShip,
  type FighterId,
  type FunnelUnit,
  type PowerPickup,
  type ShipState,
  type ShmupPhase,
  type WeaponKind,
  type WeaponLevel,
} from './SugarStarlightData.ts';
import { destroyShmupEnemy, spawnShmupWave, stepShmupEnemies, stepShmupPickups } from './SugarStarlightEnemies.ts';
import {
  hydrateShmupSave,
  serializeShmupSave,
  stepShmupChargeAndFire,
  stepShmupHangarSelection,
} from './SugarStarlightHangarAndSave.ts';
import { buildShmupSnapshot } from './SugarStarlightSnapshot.ts';
import { syncFunnelPool, triggerStarlightBomb, type ShmupArenaState } from './SugarStarlightWeapons.ts';

export { type ChargeTier, type FighterId, type WeaponKind };

const WEAPON_ORDER: readonly WeaponKind[] = ['crimson', 'azure', 'violet'];

/**
 * PA-02 Sugar Starlight: Raiden × R-Type Inspired Horizontal Arcade Shmup.
 */
export class SugarStarlightGame implements DebuggableCartridge, ComboTrackingCartridge, ShmupArenaState {
  public readonly input = new InputMap();
  public readonly juice = new JuiceSystem();

  public phase: ShmupPhase = 'hangar';
  private selectedFighterIdx = 0;

  public ship: ShipState = this.makeFreshShip(FIGHTER_CATALOG[0].id);
  public funnels: FunnelUnit[] = [];
  public sectorIdx = 0;
  public boss: BossState | null = null;
  public score = 0;
  public starsCollected = 0;
  public elapsedSec = 0;
  private waveTimer = 0;
  public waveIndex = 0;
  private thrusterTimer = 0;
  private chargeParticleTimer = 0;
  private hangarNavCooldown = 0;

  public enemies: EnemyShip[] = [];
  public bullets: Bullet[] = [];
  public pickups: PowerPickup[] = [];
  public bgStars: BgStarDesc[] = [];
  public debugHitboxes = false;
  public noticeText = '';
  public noticeTimer = 0;

  constructor(initialFighter: FighterId = 'starfalcon', skipHangar = false) {
    const fIdx = FIGHTER_CATALOG.findIndex((f) => f.id === initialFighter);
    this.selectedFighterIdx = fIdx >= 0 ? fIdx : 0;
    this.initStarfield();
    this.applyFighterLoadout(FIGHTER_CATALOG[this.selectedFighterIdx].id);
    if (skipHangar) {
      this.enterSector(0);
    } else {
      this.phase = 'hangar';
      this.noticeText = '🛫 選擇出擊戰機：方向鍵切換 · 按 A 或點擊「出擊」升空！';
      this.noticeTimer = 4.0;
    }
  }

  private makeFreshShip(fighterId: FighterId): ShipState {
    const profile = getFighterProfile(fighterId);
    return {
      fighterId: profile.id,
      x: 34,
      y: 84,
      vx: 0,
      vy: 0,
      rot: 0,
      flash: 0,
      squash: { scaleX: 1, scaleY: 1 },
      hearts: profile.maxHearts,
      maxHearts: profile.maxHearts,
      weaponKind: profile.defaultWeapon,
      weaponLevel: 1,
      bombs: profile.initialBombs,
      funnelCount: profile.initialFunnels,
      chargeSec: 0,
      funnelOverdriveTimer: 0,
      overdriveShieldTimer: 0,
      grazeCount: 0,
      grazeMeter: 0,
      shootCooldown: 0,
      invulnTimer: 0,
    };
  }

  private applyFighterLoadout(fighterId: FighterId): void {
    const idx = FIGHTER_CATALOG.findIndex((f) => f.id === fighterId);
    if (idx >= 0) this.selectedFighterIdx = idx;
    this.ship = this.makeFreshShip(FIGHTER_CATALOG[this.selectedFighterIdx].id);
    this.funnels = [];
    syncFunnelPool(this, 0);
  }

  public setDebugHitboxes(enabled: boolean): void {
    this.debugHitboxes = enabled;
  }

  public getSectorIndex(): number {
    return this.sectorIdx;
  }

  public getSectorCount(): number {
    return SECTORS.length;
  }

  public getFighterId(): FighterId {
    return this.ship.fighterId;
  }

  public getWeaponKind(): WeaponKind {
    return this.ship.weaponKind;
  }

  public getWeaponLevel(): WeaponLevel {
    return this.ship.weaponLevel;
  }

  public getBombCount(): number {
    return this.ship.bombs;
  }

  public getChargeTier(): ChargeTier {
    if (this.ship.chargeSec >= CHARGE_TIER2_SEC) return 2;
    if (this.ship.chargeSec >= CHARGE_TIER1_SEC) return 1;
    return 0;
  }

  public getActiveFunnelCount(): number {
    return this.funnels.length;
  }

  public launchSortie(fighterId?: FighterId): void {
    if (fighterId) this.applyFighterLoadout(fighterId);
    this.score = 0;
    this.starsCollected = 0;
    this.elapsedSec = 0;
    this.enterSector(0);
  }

  public enterSector(idx: number): void {
    this.sectorIdx = clamp(idx, 0, SECTORS.length - 1);
    this.waveIndex = 0;
    this.waveTimer = 0;
    this.boss = null;
    this.enemies = [];
    this.bullets = [];
    this.pickups = [];
    this.juice.reset();
    this.phase = 'sortie';
    this.noticeText = `🚀 [${getFighterProfile(this.ship.fighterId).name}] 進入 ${SECTORS[this.sectorIdx].name}！`;
    this.noticeTimer = 2.6;
    syncFunnelPool(this, 0);
    spawnShmupWave(this);
  }

  public dispatchCommand(commandId: string): SimEvent[] {
    const events: SimEvent[] = [];
    if (commandId.startsWith('select_fighter:')) {
      const id = commandId.slice('select_fighter:'.length) as FighterId;
      if (FIGHTER_CATALOG.some((f) => f.id === id)) {
        this.applyFighterLoadout(id);
        events.push('snap');
        if (this.phase === 'sortie') {
          this.noticeText = `🔄 換裝機體：${getFighterProfile(id).name}`;
          this.noticeTimer = 2.0;
        }
      }
      return events;
    }
    if (commandId === 'launch_sortie') {
      if (this.phase === 'hangar') {
        this.launchSortie(FIGHTER_CATALOG[this.selectedFighterIdx].id);
        events.push('key');
      }
      return events;
    }
    if (commandId === 'cycle_weapon') {
      const nextIdx = (WEAPON_ORDER.indexOf(this.ship.weaponKind) + 1) % WEAPON_ORDER.length;
      this.ship.weaponKind = WEAPON_ORDER[nextIdx];
      this.ship.squash = { scaleX: 1.2, scaleY: 0.85 };
      this.noticeText = `🔫 切換武裝：${WEAPON_CATALOG[this.ship.weaponKind].name} Lv.${this.ship.weaponLevel}`;
      this.noticeTimer = 1.8;
      events.push('snap');
      return events;
    }
    if (commandId.startsWith('weapon:')) {
      const w = commandId.slice('weapon:'.length) as WeaponKind;
      if (WEAPON_CATALOG[w]) {
        this.ship.weaponKind = w;
        this.ship.squash = { scaleX: 1.2, scaleY: 0.85 };
        this.noticeText = `🔫 切換武裝：${WEAPON_CATALOG[w].name} Lv.${this.ship.weaponLevel}`;
        this.noticeTimer = 1.8;
        events.push('snap');
      }
      return events;
    }
    if (commandId === 'bomb') {
      triggerStarlightBomb(this, events);
      return events;
    }
    return events;
  }

  private initStarfield(): void {
    for (let i = 0; i < 48; i++) {
      this.bgStars.push({
        x: (i * 59 + 17) % GAME_W,
        y: (i * 37 + 11) % GAME_H,
        size: i % 4 === 0 ? 2 : 1,
        phase: i * 0.7,
        color: STARFIELD_PALETTE[i % STARFIELD_PALETTE.length],
      });
    }
  }

  public damageShip(
    events: SimEvent[],
    trauma: number,
    flashAlpha: number,
    burstColors: readonly string[],
    burstCount: number,
    density = 1.0,
  ): void {
    this.ship.hearts--;
    this.ship.invulnTimer = 1.35;
    this.ship.flash = 0.38;
    events.push('hurt');
    this.juice.applyPreset('player_hurt', { dirX: -1, dirY: 0, intensity: Math.max(0.85, trauma / 0.48) });
    this.juice.triggerFlash('#ff708d', flashAlpha);
    this.juice.spawnBurst(this.ship.x + 8, this.ship.y + 8, burstColors, burstCount, density, { gravity: 0, liftY: 0 });
    if (this.ship.hearts <= 0) this.phase = 'lost';
  }

  public destroyEnemy(idx: number, events: SimEvent[], density: number, allowDrop = true): void {
    destroyShmupEnemy(this, idx, events, density, allowDrop);
  }

  public onWeakPointDestroyed(wp: { offsetX: number; offsetY: number }, events: SimEvent[]): void {
    onShmupWeakPointDestroyed(this, wp, events);
  }

  public damageBossCore(amount: number, events: SimEvent[], density: number): boolean {
    return damageShmupBossCore(
      this,
      amount,
      events,
      density,
      () => this.enterSector(this.sectorIdx + 1),
      () => {
        this.phase = 'won';
      },
    );
  }

  public triggerStarlightBomb(events: SimEvent[]): boolean {
    return triggerStarlightBomb(this, events);
  }

  private updateShipMovement(simDt: number, params: RuntimeParams): void {
    const profile = getFighterProfile(this.ship.fighterId);
    let mx = this.input.axisX();
    let my = this.input.axisY();
    if (mx !== 0 && my !== 0) {
      mx *= Math.SQRT1_2;
      my *= Math.SQRT1_2;
    }

    const speed = params.moveSpeed * 1.16 * profile.speedScale;
    const blend = Math.min(1, simDt * 18);
    this.ship.vx += (mx * speed - this.ship.vx) * blend;
    this.ship.vy += (my * speed - this.ship.vy) * blend;
    this.ship.x = clamp(this.ship.x + this.ship.vx * simDt, SHIP_MIN_X, SHIP_MAX_X);
    this.ship.y = clamp(this.ship.y + this.ship.vy * simDt, SHIP_MIN_Y, SHIP_MAX_Y);
    this.ship.rot = clamp(this.ship.vy * 0.0022, -0.22, 0.22);

    this.thrusterTimer -= simDt;
    if (this.thrusterTimer <= 0) {
      this.thrusterTimer = this.ship.chargeSec >= CHARGE_TIER1_SEC ? 0.032 : 0.05;
      const tier = this.getChargeTier();
      this.juice.particles.push({
        x: this.ship.x - 1,
        y: this.ship.y + 8 + Math.sin(this.juice.visualTime * 29) * 1.5,
        vx: -74 - Math.max(0, this.ship.vx) * 0.35,
        vy: this.ship.vy * 0.1,
        life: 0,
        maxLife: 0.2,
        size: tier >= 2 ? 3.2 : 2.3,
        color: tier === 2 ? '#ffd447' : tier === 1 ? '#5ec2f7' : profile.accentHex,
        rot: 0,
        vRot: 0,
        additive: true,
        gravity: 0,
      });
    }
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    const events: SimEvent[] = [];
    this.input.update(rawInput, dt);
    const simDt = this.juice.advanceRealTime(dt, params.shakeScale);
    if (this.noticeTimer > 0) this.noticeTimer = Math.max(0, this.noticeTimer - dt);

    for (const s of this.bgStars) {
      s.x -= (s.size > 1 ? 36 : 19) * (1 + this.sectorIdx * 0.15) * dt;
      if (s.x < 0) s.x += GAME_W;
    }

    if (this.phase === 'hangar') {
      const res = stepShmupHangarSelection(this, dt, this.selectedFighterIdx, this.hangarNavCooldown, events, {
        applyFighterLoadout: (id) => this.applyFighterLoadout(id),
        launchSortie: (id) => this.launchSortie(id),
      });
      this.selectedFighterIdx = res.selectedFighterIdx;
      this.hangarNavCooldown = res.hangarNavCooldown;
      if (!res.launched) return events;
    }

    if (this.ship.flash > 0) this.ship.flash = Math.max(0, this.ship.flash - dt * 6);
    for (const e of this.enemies) {
      if (e.flashTimer > 0) e.flashTimer = Math.max(0, e.flashTimer - dt * 7);
    }
    stepSquashSpring(this.ship.squash, dt, 14);

    if (simDt <= 0 || this.phase !== 'sortie') return events;
    this.elapsedSec += simDt;

    if (this.input.justPressed('shoulderL')) {
      this.retryStage();
      events.push('snap');
      return events;
    }
    if (this.input.justPressed('skillX')) events.push(...this.dispatchCommand('cycle_weapon'));
    if (this.input.justPressed('skillY')) events.push(...this.dispatchCommand('bomb'));

    if (this.ship.invulnTimer > 0) this.ship.invulnTimer = Math.max(0, this.ship.invulnTimer - simDt);
    if (this.ship.shootCooldown > 0) this.ship.shootCooldown = Math.max(0, this.ship.shootCooldown - simDt);
    if (this.ship.funnelOverdriveTimer > 0) this.ship.funnelOverdriveTimer = Math.max(0, this.ship.funnelOverdriveTimer - simDt);
    if (this.ship.overdriveShieldTimer > 0) this.ship.overdriveShieldTimer = Math.max(0, this.ship.overdriveShieldTimer - simDt);

    this.updateShipMovement(simDt, params);
    this.chargeParticleTimer = stepShmupChargeAndFire(this, simDt, this.chargeParticleTimer, events, params);
    syncFunnelPool(this, simDt);

    if (!this.boss) {
      this.waveTimer += simDt;
      if (this.waveTimer > 4.2 || this.enemies.length === 0) {
        this.waveTimer = 0;
        spawnShmupWave(this);
      }
    } else {
      updateShmupBoss(this, simDt, events);
    }

    stepShmupEnemies(this, simDt, events, params);
    stepShmupPickups(this, simDt, events, params);
    stepShmupBullets(this, simDt, events, params);
    return events;
  }

  public retryStage(): void {
    this.ship.hearts = this.ship.maxHearts;
    this.ship.invulnTimer = 1.35;
    this.ship.chargeSec = 0;
    this.ship.funnelOverdriveTimer = 0;
    this.ship.overdriveShieldTimer = 0;
    this.enterSector(this.sectorIdx);
  }

  public serializeSave(): unknown {
    return serializeShmupSave(this);
  }

  public hydrateSave(raw: unknown): boolean {
    return hydrateShmupSave(
      this,
      raw,
      (fid) => this.applyFighterLoadout(fid),
      (idx) => this.enterSector(idx),
    );
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    if (this.phase === 'won') return 'won';
    if (this.phase === 'lost') return 'lost';
    return 'playing';
  }

  public getComboCount(): number {
    return this.juice.comboCount;
  }

  public snapshot(params: RuntimeParams): RenderSceneSnapshot {
    return buildShmupSnapshot(this, params);
  }
}
