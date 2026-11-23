import type { InputMap } from '../input/InputMap.ts';
import { SeededRng } from '../runtime/SeededRng.ts';
import type { EntityDesc, HudPrimitiveDesc, SimEvent } from '../types/SceneTypes.ts';
import type { EventActionVm } from './EventActionVm.ts';
import type { JuiceSystem } from './JuiceSystem.ts';
import type { OrthogonalPose } from './OrthogonalArt.ts';

export type CardStatusKind = 'vulnerable' | 'weak' | 'burn' | 'power';
export type CardKeyword = 'exhaust' | 'retain' | 'innate';
export type CardTargetKind = 'single_enemy' | 'all_enemies' | 'self';

export interface CardEffectDef {
  kind: 'damage' | 'block' | 'heal' | 'draw' | 'energy' | 'applyStatus' | 'emitSignal';
  value?: number;
  hits?: number;
  status?: CardStatusKind;
  target?: 'target' | 'all_enemies' | 'self';
  signal?: string;
}

export interface CardEngineCardDef {
  id: string;
  name: string;
  shortDesc: string;
  cost: number;
  target: CardTargetKind;
  artBlueprintId: string;
  paletteRow?: number;
  accentHex?: string;
  keywords?: readonly CardKeyword[];
  effects: readonly CardEffectDef[];
}

export interface CardEnemyIntentDef {
  kind: 'attack' | 'multi_attack' | 'defend' | 'buff' | 'debuff';
  value: number;
  hits?: number;
  status?: CardStatusKind;
  statusStacks?: number;
  label?: string;
}

export interface CardEnemyDef {
  id: string;
  name: string;
  maxHp: number;
  artBlueprintId: string;
  paletteRow?: number;
  intents: readonly CardEnemyIntentDef[];
}

export interface CardEncounterDef {
  id: string;
  name: string;
  enemies: readonly CardEnemyDef[];
}

export interface CardDeckEngineConfig {
  heroName: string;
  heroBlueprintId: string;
  heroPaletteRow?: number;
  heroMaxHp: number;
  maxEnergy: number;
  drawPerTurn: number;
  seed?: number;
  cards: Readonly<Record<string, CardEngineCardDef>>;
  starterDeck: readonly string[];
  rewardPool: readonly string[];
  encounters: readonly CardEncounterDef[];
}

export interface CardCombatStatusBlock {
  vulnerable: number;
  weak: number;
  burn: number;
  power: number;
}

export interface CardEnemyRuntime {
  active: boolean;
  def: CardEnemyDef | null;
  hp: number;
  maxHp: number;
  block: number;
  intentIdx: number;
  flash: number;
  pose: OrthogonalPose;
  poseTimer: number;
  status: CardCombatStatusBlock;
}

export interface CardEngineStepHooks {
  vm?: EventActionVm;
  juice?: JuiceSystem;
  spawnFloatingText?: (text: string, wx: number, wy: number, color?: string) => void;
  eventsOut: SimEvent[];
}

const MAX_ZONE_CARDS = 64;
const MAX_HAND_SIZE = 8;
const MAX_ENEMIES = 4;
const MAX_REWARDS = 3;

function clearStatus(s: CardCombatStatusBlock): void {
  s.vulnerable = 0;
  s.weak = 0;
  s.burn = 0;
  s.power = 0;
}

function addStatus(s: CardCombatStatusBlock, kind: CardStatusKind, amount: number): void {
  if (kind === 'vulnerable') s.vulnerable = Math.max(0, s.vulnerable + amount);
  else if (kind === 'weak') s.weak = Math.max(0, s.weak + amount);
  else if (kind === 'burn') s.burn = Math.max(0, s.burn + amount);
  else s.power += amount;
}

function decayStatuses(s: CardCombatStatusBlock): void {
  if (s.vulnerable > 0) s.vulnerable--;
  if (s.weak > 0) s.weak--;
  if (s.burn > 0) s.burn--;
}

function calcAttackDamage(
  base: number,
  attacker: CardCombatStatusBlock,
  defender: CardCombatStatusBlock,
): number {
  let dmg = Math.max(0, base + attacker.power);
  if (attacker.weak > 0) dmg = Math.floor(dmg * 0.75);
  if (defender.vulnerable > 0) dmg = Math.floor(dmg * 1.5);
  return Math.max(0, dmg);
}

/**
 * Pure, DOM-free, Zero-GC Orthogonal Data-Driven Card Deck Engine.
 * Supports 4 explicit zones (deck / hand / discard / exhaust), deterministic SeededRng shuffling,
 * multi-enemy targeting, Vulnerable/Weak/Burn/Power status stacks, enemy intent cycles,
 * and post-battle 3-choice card reward drafting.
 */
export class CardDeckEngine {
  private readonly config: CardDeckEngineConfig;
  private readonly rng: SeededRng;
  private readonly cardCatalog: CardEngineCardDef[] = [];
  private readonly cardIdToIdx = new Map<string, number>();

  // Pre-allocated 4-zone integer card index stores + persistent master deck
  public readonly masterDeck = new Int16Array(MAX_ZONE_CARDS);
  public masterDeckCount = 0;
  public readonly deckZone = new Int16Array(MAX_ZONE_CARDS);
  public deckCount = 0;
  public readonly handZone = new Int16Array(MAX_HAND_SIZE);
  public handCount = 0;
  public readonly discardZone = new Int16Array(MAX_ZONE_CARDS);
  public discardCount = 0;
  public readonly exhaustZone = new Int16Array(MAX_ZONE_CARDS);
  public exhaustCount = 0;

  public readonly rewardChoices = new Int16Array(MAX_REWARDS);
  public rewardCount = 0;

  public phase: 'combat' | 'reward' | 'won' | 'lost' = 'combat';
  public encounterIdx = 0;
  public turn = 1;
  public score = 0;
  public heroHp = 40;
  public heroMaxHp = 40;
  public heroBlock = 0;
  public energy = 3;
  public maxEnergy = 3;
  public heroFlash = 0;
  public heroPose: OrthogonalPose = 'idle';
  public heroPoseTimer = 0;
  public readonly heroStatus: CardCombatStatusBlock = { vulnerable: 0, weak: 0, burn: 0, power: 0 };

  public handCursor = 0;
  public targetIdx = 0;
  public rewardCursor = 0;
  public lastActionBanner = '';
  public animClock = 0;

  public readonly enemies: CardEnemyRuntime[] = [];
  private readonly entityPool: EntityDesc[] = [];
  private readonly hudPool: HudPrimitiveDesc[] = [];

  constructor(config: CardDeckEngineConfig) {
    this.config = config;
    this.rng = new SeededRng(config.seed ?? 50719);

    for (const def of Object.values(config.cards)) {
      const idx = this.cardCatalog.length;
      this.cardCatalog.push(def);
      this.cardIdToIdx.set(def.id, idx);
    }

    for (let i = 0; i < MAX_ENEMIES; i++) {
      this.enemies.push({
        active: false,
        def: null,
        hp: 0,
        maxHp: 1,
        block: 0,
        intentIdx: 0,
        flash: 0,
        pose: 'idle',
        poseTimer: 0,
        status: { vulnerable: 0, weak: 0, burn: 0, power: 0 },
      });
    }

    for (let i = 0; i < 24; i++) {
      this.entityPool.push({ id: `ce_${i}`, sprite: 'solid', x: 0, y: 0, w: 16, h: 16 });
    }
    for (let i = 0; i < 80; i++) {
      this.hudPool.push({ kind: 'box', x: 0, y: 0, w: 0, h: 0, color: '#ffffff' });
    }

    this.resetRun();
  }

  public resetRun(): void {
    this.rng.reset(this.config.seed ?? 50719);
    this.heroMaxHp = Math.max(1, this.config.heroMaxHp);
    this.heroHp = this.heroMaxHp;
    this.heroBlock = 0;
    this.maxEnergy = Math.max(1, this.config.maxEnergy);
    this.energy = this.maxEnergy;
    this.score = 0;
    this.encounterIdx = 0;
    this.phase = 'combat';
    this.masterDeckCount = 0;
    for (let i = 0; i < this.config.starterDeck.length && this.masterDeckCount < MAX_ZONE_CARDS; i++) {
      const idx = this.cardIdToIdx.get(this.config.starterDeck[i]);
      if (idx !== undefined) this.masterDeck[this.masterDeckCount++] = idx;
    }
    this.startEncounter(0);
  }

  public getCardDefByIndex(idx: number): CardEngineCardDef | undefined {
    return idx >= 0 && idx < this.cardCatalog.length ? this.cardCatalog[idx] : undefined;
  }

  private shuffleZone(zone: Int16Array, count: number): void {
    for (let i = count - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      const tmp = zone[i];
      zone[i] = zone[j];
      zone[j] = tmp;
    }
  }

  public startEncounter(idx: number): void {
    const enc = this.config.encounters[idx];
    if (!enc) {
      this.phase = 'won';
      this.lastActionBanner = '星紋牌陣全制霸！';
      return;
    }
    this.encounterIdx = idx;
    this.phase = 'combat';
    this.turn = 1;
    this.heroBlock = 0;
    this.heroFlash = 0;
    this.heroPose = 'idle';
    this.heroPoseTimer = 0;
    clearStatus(this.heroStatus);

    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      const def = enc.enemies[i] ?? null;
      e.active = def !== null;
      e.def = def;
      e.hp = def ? def.maxHp : 0;
      e.maxHp = def ? def.maxHp : 1;
      e.block = 0;
      e.intentIdx = 0;
      e.flash = 0;
      e.pose = 'idle';
      e.poseTimer = 0;
      clearStatus(e.status);
    }

    // Load master deck into draw pile, moving 'innate' cards to top
    this.deckCount = 0;
    this.handCount = 0;
    this.discardCount = 0;
    this.exhaustCount = 0;
    for (let i = 0; i < this.masterDeckCount; i++) {
      this.deckZone[this.deckCount++] = this.masterDeck[i];
    }
    this.shuffleZone(this.deckZone, this.deckCount);
    // Bubble innate cards to end of array (drawn first from stack top)
    let writeTop = this.deckCount - 1;
    for (let i = this.deckCount - 1; i >= 0; i--) {
      const def = this.cardCatalog[this.deckZone[i]];
      if (def?.keywords?.includes('innate')) {
        const tmp = this.deckZone[writeTop];
        this.deckZone[writeTop] = this.deckZone[i];
        this.deckZone[i] = tmp;
        writeTop--;
      }
    }

    this.targetIdx = this.findNextAliveEnemy(0);
    this.handCursor = 0;
    this.beginPlayerTurn();
    this.lastActionBanner = `遭遇 ${idx + 1}/${this.config.encounters.length} · ${enc.name}`;
  }

  private findNextAliveEnemy(start: number): number {
    for (let k = 0; k < MAX_ENEMIES; k++) {
      const idx = (start + k) % MAX_ENEMIES;
      if (this.enemies[idx].active && this.enemies[idx].hp > 0) return idx;
    }
    return 0;
  }

  private aliveEnemyCount(): number {
    let n = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (this.enemies[i].active && this.enemies[i].hp > 0) n++;
    }
    return n;
  }

  public drawCards(count: number): number {
    let drawn = 0;
    for (let k = 0; k < count; k++) {
      if (this.handCount >= MAX_HAND_SIZE) break;
      if (this.deckCount === 0) {
        if (this.discardCount === 0) break;
        for (let i = 0; i < this.discardCount; i++) {
          this.deckZone[this.deckCount++] = this.discardZone[i];
        }
        this.discardCount = 0;
        this.shuffleZone(this.deckZone, this.deckCount);
      }
      if (this.deckCount === 0) break;
      this.handZone[this.handCount++] = this.deckZone[--this.deckCount];
      drawn++;
    }
    if (this.handCursor >= this.handCount) {
      this.handCursor = Math.max(0, this.handCount - 1);
    }
    return drawn;
  }

  private beginPlayerTurn(): void {
    this.energy = this.maxEnergy;
    this.heroBlock = 0;
    this.drawCards(this.config.drawPerTurn);
  }

  public playCardAt(handIdx: number, hooks?: CardEngineStepHooks): boolean {
    if (this.phase !== 'combat' || handIdx < 0 || handIdx >= this.handCount) return false;
    const cardIdx = this.handZone[handIdx];
    const card = this.cardCatalog[cardIdx];
    if (!card) return false;

    if (this.energy < card.cost) {
      hooks?.spawnFloatingText?.('能量不足', 76, 80, '#ff708d');
      hooks?.eventsOut.push('hurt');
      return false;
    }

    this.energy -= card.cost;
    // Remove card from hand before draw effects so max hand limit behaves intuitively
    for (let i = handIdx; i < this.handCount - 1; i++) {
      this.handZone[i] = this.handZone[i + 1];
    }
    this.handCount--;
    if (this.handCursor >= this.handCount) this.handCursor = Math.max(0, this.handCount - 1);

    const isExhaust = card.keywords?.includes('exhaust') ?? false;
    if (isExhaust) {
      if (this.exhaustCount < MAX_ZONE_CARDS) this.exhaustZone[this.exhaustCount++] = cardIdx;
    } else if (this.discardCount < MAX_ZONE_CARDS) {
      this.discardZone[this.discardCount++] = cardIdx;
    }

    this.heroPose = card.target === 'self' ? 'guard' : 'strike';
    this.heroPoseTimer = 0.28;

    if (!this.enemies[this.targetIdx]?.active || this.enemies[this.targetIdx].hp <= 0) {
      this.targetIdx = this.findNextAliveEnemy(0);
    }

    for (let i = 0; i < card.effects.length; i++) {
      const fx = card.effects[i];
      const val = fx.value ?? 0;
      const hits = Math.max(1, fx.hits ?? 1);

      if (fx.kind === 'damage') {
        const hitAll = card.target === 'all_enemies' || fx.target === 'all_enemies';
        for (let h = 0; h < hits; h++) {
          if (hitAll) {
            for (let eIdx = 0; eIdx < MAX_ENEMIES; eIdx++) {
              this.damageEnemy(eIdx, val, card.accentHex ?? '#ff5d8f', hooks);
            }
          } else {
            this.damageEnemy(this.targetIdx, val, card.accentHex ?? '#ff5d8f', hooks);
          }
        }
        hooks?.juice?.applyPreset(hitAll || hits > 1 ? 'charge_shot' : 'light_hit');
        hooks?.eventsOut.push('laser');
      } else if (fx.kind === 'block') {
        this.heroBlock += val;
        hooks?.spawnFloatingText?.(`+${val} 盾`, 72, 74, '#5ec2f7');
        hooks?.eventsOut.push('key');
      } else if (fx.kind === 'heal') {
        const healed = Math.min(this.heroMaxHp - this.heroHp, val);
        this.heroHp += healed;
        hooks?.spawnFloatingText?.(`+${healed} HP`, 72, 68, '#56d39c');
        hooks?.eventsOut.push('star');
      } else if (fx.kind === 'draw') {
        this.drawCards(val);
        hooks?.eventsOut.push('snap');
      } else if (fx.kind === 'energy') {
        this.energy += val;
        hooks?.spawnFloatingText?.(`+${val} 能`, 72, 62, '#ffd447');
        hooks?.eventsOut.push('charge');
      } else if (fx.kind === 'applyStatus' && fx.status) {
        if (fx.target === 'self' || card.target === 'self') {
          addStatus(this.heroStatus, fx.status, val);
          hooks?.spawnFloatingText?.(`+${val} ${fx.status.toUpperCase()}`, 72, 62, '#e0aaff');
        } else if (fx.target === 'all_enemies' || card.target === 'all_enemies') {
          for (let eIdx = 0; eIdx < MAX_ENEMIES; eIdx++) {
            const e = this.enemies[eIdx];
            if (!e.active || e.hp <= 0) continue;
            addStatus(e.status, fx.status, val);
            hooks?.spawnFloatingText?.(`+${val} ${fx.status.slice(0, 3).toUpperCase()}`, 190 + eIdx * 42, 64, '#ffd447');
          }
        } else {
          const e = this.enemies[this.targetIdx];
          if (e?.active && e.hp > 0) {
            addStatus(e.status, fx.status, val);
            hooks?.spawnFloatingText?.(`+${val} ${fx.status.slice(0, 3).toUpperCase()}`, 190 + this.targetIdx * 42, 64, '#ffd447');
          }
        }
        hooks?.eventsOut.push('ignite');
      } else if (fx.kind === 'emitSignal' && fx.signal) {
        hooks?.vm?.emitSignal(fx.signal);
      }
    }

    hooks?.vm?.emitSignal('card_played');
    this.lastActionBanner = `打出「${card.name}」${isExhaust ? '（消耗）' : ''}`;

    if (this.aliveEnemyCount() === 0) {
      this.handleEncounterVictory(hooks);
    } else if (!this.enemies[this.targetIdx].active || this.enemies[this.targetIdx].hp <= 0) {
      this.targetIdx = this.findNextAliveEnemy(this.targetIdx);
    }
    this.syncVmVars(hooks?.vm);
    return true;
  }

  private damageEnemy(eIdx: number, baseDmg: number, color: string, hooks?: CardEngineStepHooks): void {
    const e = this.enemies[eIdx];
    if (!e || !e.active || e.hp <= 0) return;
    const finalDmg = calcAttackDamage(baseDmg, this.heroStatus, e.status);
    const blocked = Math.min(e.block, finalDmg);
    e.block -= blocked;
    const hpDmg = finalDmg - blocked;
    e.hp = Math.max(0, e.hp - hpDmg);
    e.flash = 0.42;
    e.pose = 'hurt';
    e.poseTimer = 0.28;
    this.score += finalDmg * 18;
    const ex = 188 + eIdx * 46;
    hooks?.spawnFloatingText?.(hpDmg > 0 ? `-${hpDmg}` : 'BLK', ex, 72, color);
    if (e.hp <= 0) {
      this.score += 180;
      hooks?.juice?.applyPreset('heavy_kill');
    }
  }

  private handleEncounterVictory(hooks?: CardEngineStepHooks): void {
    hooks?.eventsOut.push('win');
    hooks?.vm?.emitSignal('encounter_clear');
    if (this.encounterIdx + 1 >= this.config.encounters.length) {
      this.phase = 'won';
      this.score += 500;
      this.lastActionBanner = '星紋牌陣全制霸！';
      return;
    }

    this.phase = 'reward';
    this.rewardCount = 0;
    this.rewardCursor = 0;
    const pool = this.config.rewardPool;
    const used = new Int16Array(MAX_REWARDS);
    used.fill(-1);
    for (let k = 0; k < MAX_REWARDS && pool.length > 0; k++) {
      let chosen = -1;
      for (let attempt = 0; attempt < 8; attempt++) {
        const cid = pool[this.rng.int(0, pool.length - 1)];
        const cIdx = this.cardIdToIdx.get(cid);
        if (cIdx === undefined) continue;
        let dup = false;
        for (let u = 0; u < this.rewardCount; u++) {
          if (used[u] === cIdx) dup = true;
        }
        if (!dup || attempt === 7) {
          chosen = cIdx;
          break;
        }
      }
      if (chosen >= 0) {
        used[this.rewardCount] = chosen;
        this.rewardChoices[this.rewardCount++] = chosen;
      }
    }
    this.lastActionBanner = '戰利品選牌 · ←→選擇 · A 加入牌組 · Y 跳過';
  }

  public pickReward(choiceIdx: number, hooks?: CardEngineStepHooks): void {
    if (this.phase !== 'reward') return;
    if (choiceIdx >= 0 && choiceIdx < this.rewardCount && this.masterDeckCount < MAX_ZONE_CARDS) {
      this.masterDeck[this.masterDeckCount++] = this.rewardChoices[choiceIdx];
      hooks?.eventsOut.push('star');
    } else {
      hooks?.eventsOut.push('snap');
    }
    this.startEncounter(this.encounterIdx + 1);
    this.syncVmVars(hooks?.vm);
  }

  public endTurn(hooks?: CardEngineStepHooks): void {
    if (this.phase !== 'combat') return;

    // 1. Discard non-retained cards from hand
    let keepCount = 0;
    for (let i = 0; i < this.handCount; i++) {
      const cIdx = this.handZone[i];
      const def = this.cardCatalog[cIdx];
      if (def?.keywords?.includes('retain')) {
        this.handZone[keepCount++] = cIdx;
      } else if (this.discardCount < MAX_ZONE_CARDS) {
        this.discardZone[this.discardCount++] = cIdx;
      }
    }
    this.handCount = keepCount;

    // 2. Enemy Burn tick + Enemy intents
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      if (!e.active || e.hp <= 0 || !e.def) continue;
      e.block = 0;

      if (e.status.burn > 0) {
        const burnDmg = e.status.burn;
        e.hp = Math.max(0, e.hp - burnDmg);
        e.flash = 0.35;
        hooks?.spawnFloatingText?.(`-${burnDmg} 灼`, 188 + i * 46, 62, '#ff9642');
        if (e.hp <= 0) {
          this.score += 180;
          continue;
        }
      }

      const intent = e.def.intents[e.intentIdx % e.def.intents.length];
      e.intentIdx = (e.intentIdx + 1) % e.def.intents.length;
      if (!intent) continue;

      if (intent.kind === 'attack' || intent.kind === 'multi_attack') {
        const hits = intent.kind === 'multi_attack' ? Math.max(2, intent.hits ?? 2) : 1;
        e.pose = 'strike';
        e.poseTimer = 0.32;
        for (let h = 0; h < hits; h++) {
          const dmg = calcAttackDamage(intent.value, e.status, this.heroStatus);
          const absorbed = Math.min(this.heroBlock, dmg);
          this.heroBlock -= absorbed;
          const hpDmg = dmg - absorbed;
          if (hpDmg > 0) {
            this.heroHp = Math.max(0, this.heroHp - hpDmg);
            this.heroFlash = 0.45;
            this.heroPose = 'hurt';
            this.heroPoseTimer = 0.3;
            hooks?.juice?.applyPreset('player_hurt');
            hooks?.spawnFloatingText?.(`-${hpDmg}`, 72, 72, '#ff5d8f');
            hooks?.eventsOut.push('hurt');
          } else {
            hooks?.spawnFloatingText?.('格擋!', 72, 72, '#5ec2f7');
            hooks?.eventsOut.push('snap');
          }
        }
      } else if (intent.kind === 'defend') {
        e.block += intent.value;
        e.pose = 'guard';
        e.poseTimer = 0.28;
        hooks?.spawnFloatingText?.(`+${intent.value} 盾`, 188 + i * 46, 70, '#5ec2f7');
      } else if (intent.kind === 'buff' && intent.status) {
        addStatus(e.status, intent.status, intent.statusStacks ?? intent.value);
        e.pose = 'windup';
        e.poseTimer = 0.28;
        hooks?.spawnFloatingText?.(`+${intent.statusStacks ?? intent.value} 力`, 188 + i * 46, 70, '#ffd447');
      } else if (intent.kind === 'debuff' && intent.status) {
        addStatus(this.heroStatus, intent.status, intent.statusStacks ?? intent.value);
        e.pose = 'strike';
        e.poseTimer = 0.28;
        hooks?.spawnFloatingText?.(`${intent.status.toUpperCase()}!`, 72, 64, '#e0aaff');
      }

      decayStatuses(e.status);
    }

    // Hero burn tick + status decay
    if (this.heroStatus.burn > 0 && this.heroHp > 0) {
      this.heroHp = Math.max(0, this.heroHp - this.heroStatus.burn);
      hooks?.spawnFloatingText?.(`-${this.heroStatus.burn} 灼`, 72, 62, '#ff9642');
    }
    decayStatuses(this.heroStatus);
    hooks?.vm?.emitSignal('turn_end');

    if (this.heroHp <= 0) {
      this.phase = 'lost';
      this.lastActionBanner = '星紋碎裂 · 按 L 重新挑戰';
      this.syncVmVars(hooks?.vm);
      return;
    }

    if (this.aliveEnemyCount() === 0) {
      this.handleEncounterVictory(hooks);
      this.syncVmVars(hooks?.vm);
      return;
    }

    this.turn++;
    this.beginPlayerTurn();
    this.lastActionBanner = `第 ${this.turn} 回合 · 能量 ${this.energy}/${this.maxEnergy}`;
    this.syncVmVars(hooks?.vm);
  }

  public syncVmVars(vm?: EventActionVm): void {
    if (!vm) return;
    vm.setVar('hp', this.heroHp);
    vm.setVar('maxHp', this.heroMaxHp);
    vm.setVar('mana', this.energy);
    vm.setVar('maxMana', this.maxEnergy);
    vm.setVar('shield', this.heroBlock);
    vm.setVar('turn', this.turn);
    vm.setVar('deckCount', this.deckCount);
    vm.setVar('handCount', this.handCount);
    vm.setVar('discardCount', this.discardCount);
    vm.setVar('exhaustCount', this.exhaustCount);
    let totalEnemyHp = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (this.enemies[i].active) totalEnemyHp += this.enemies[i].hp;
    }
    vm.setVar('enemyHp', totalEnemyHp);
  }

  public step(input: InputMap, dt: number, viewW: number, viewH: number, hooks: CardEngineStepHooks): void {
    this.animClock += dt;
    if (this.heroFlash > 0) this.heroFlash = Math.max(0, this.heroFlash - dt * 1.8);
    if (this.heroPoseTimer > 0) {
      this.heroPoseTimer -= dt;
      if (this.heroPoseTimer <= 0) this.heroPose = 'idle';
    }
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 1.8);
      if (e.poseTimer > 0) {
        e.poseTimer -= dt;
        if (e.poseTimer <= 0) e.pose = 'idle';
      }
    }

    if (this.phase === 'reward') {
      if (input.justPressed('left') && this.rewardCount > 0) {
        this.rewardCursor = (this.rewardCursor - 1 + this.rewardCount) % this.rewardCount;
        hooks.eventsOut.push('snap');
      } else if (input.justPressed('right') && this.rewardCount > 0) {
        this.rewardCursor = (this.rewardCursor + 1) % this.rewardCount;
        hooks.eventsOut.push('snap');
      } else if (input.justPressed('action') || input.justPressed('jump')) {
        this.pickReward(this.rewardCursor, hooks);
      } else if (input.justPressed('skillY')) {
        this.pickReward(-1, hooks);
      }
      return;
    }

    if (this.phase !== 'combat') return;

    if (input.justPressed('left') && this.handCount > 0) {
      this.handCursor = (this.handCursor - 1 + this.handCount) % this.handCount;
      hooks.eventsOut.push('snap');
    } else if (input.justPressed('right') && this.handCount > 0) {
      this.handCursor = (this.handCursor + 1) % this.handCount;
      hooks.eventsOut.push('snap');
    }

    if (input.justPressed('up') || input.justPressed('down') || input.justPressed('shoulderL') || input.justPressed('shoulderR')) {
      this.targetIdx = this.findNextAliveEnemy(this.targetIdx + 1);
      hooks.eventsOut.push('snap');
    }

    // Pointer support for selecting & playing cards directly
    let hoveredCard = -1;
    if (input.pointerActive() && this.handCount > 0) {
      const px = input.pointerX() * viewW;
      const py = input.pointerY() * viewH;
      const cardW = Math.min(58, Math.floor((viewW - 24) / Math.max(1, this.handCount)) - 4);
      const totalW = this.handCount * (cardW + 4) - 4;
      const startX = Math.floor((viewW - totalW) * 0.5);
      const cardY = viewH - 52;
      if (py >= cardY - 6 && py <= viewH - 4) {
        for (let i = 0; i < this.handCount; i++) {
          const cx = startX + i * (cardW + 4);
          if (px >= cx && px <= cx + cardW) {
            this.handCursor = i;
            hoveredCard = i;
            break;
          }
        }
      }
    }

    if (input.justPressed('action') || (input.pointerPrimaryJustPressed() && hoveredCard >= 0)) {
      this.playCardAt(this.handCursor, hooks);
    } else if (input.justPressed('skillY') || input.pointerSecondaryJustPressed()) {
      this.endTurn(hooks);
    }
  }

  /**
   * Populates pooled EntityDesc (OrthogonalArt hero, enemies, card portrait icons)
   * and HudPrimitiveDesc into caller-owned arrays with zero heap allocations.
   */
  public emitSceneAndHud(
    entitiesOut: EntityDesc[],
    hudOut: HudPrimitiveDesc[],
    viewW: number,
    viewH: number,
  ): void {
    let eCount = 0;
    let hCount = 0;

    const pushEntity = (
      id: string,
      blueprintId: string,
      facing: 'front' | 'side' | 'portrait',
      pose: OrthogonalPose,
      x: number,
      y: number,
      w: number,
      h: number,
      flipX: boolean,
      flash: number,
      paletteRow?: number,
    ): void => {
      if (eCount >= this.entityPool.length) return;
      const dst = this.entityPool[eCount++];
      dst.id = id;
      dst.sprite = 'hero_a';
      dst.artBlueprintId = blueprintId;
      dst.artFacing = facing;
      dst.artPose = pose;
      dst.x = x;
      dst.y = y;
      dst.w = w;
      dst.h = h;
      dst.flipX = flipX;
      dst.flash = flash;
      dst.paletteRow = paletteRow;
      dst.castShadow = facing !== 'portrait';
      dst.alpha = 1;
      dst.scaleX = 1;
      dst.scaleY = 1;
      entitiesOut.push(dst);
    };

    const pushHud = (
      kind: HudPrimitiveDesc['kind'],
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
      opts?: { ratio?: number; text?: string; scale?: number; align?: 'left' | 'center' | 'right'; bgColor?: string; alpha?: number },
    ): void => {
      if (hCount >= this.hudPool.length) return;
      const dst = this.hudPool[hCount++];
      dst.kind = kind;
      dst.x = x;
      dst.y = y;
      dst.w = w;
      dst.h = h;
      dst.color = color;
      dst.ratio = opts?.ratio;
      dst.text = opts?.text;
      dst.scale = opts?.scale;
      dst.align = opts?.align;
      dst.bgColor = opts?.bgColor;
      dst.alpha = opts?.alpha;
      dst.worldSpace = false;
      hudOut.push(dst);
    };

    // 1. Hero actor (left arena)
    const bob = Math.sin(this.animClock * 3.2) * 1.5;
    pushEntity(
      'card_hero',
      this.config.heroBlueprintId,
      'side',
      this.heroPose,
      46,
      78 + bob,
      26,
      26,
      false,
      this.heroFlash,
      this.config.heroPaletteRow,
    );

    // Top status bar
    pushHud('box', 6, 4, viewW - 12, 20, '#17122a', { alpha: 0.8 });
    pushHud('text', 12, 8, 0, 0, '#ffd447', {
      text: `EN ${this.energy}/${this.maxEnergy}  HP ${this.heroHp}/${this.heroMaxHp}${this.heroBlock > 0 ? ` SHD ${this.heroBlock}` : ''}`,
      scale: 1,
      align: 'left',
    });
    pushHud('text', viewW - 12, 8, 0, 0, '#9bd3ff', {
      text: `DK ${this.deckCount}  DS ${this.discardCount}  EX ${this.exhaustCount}  T${this.turn}`,
      scale: 1,
      align: 'right',
    });

    // Hero HP bar + status tags
    pushHud('bar', 40, 108, 42, 4, '#56d39c', { ratio: this.heroHp / Math.max(1, this.heroMaxHp), bgColor: '#1a1126' });
    if (this.heroStatus.power > 0 || this.heroStatus.vulnerable > 0 || this.heroStatus.weak > 0) {
      pushHud('text', 60, 114, 0, 0, '#e0aaff', {
        text: `${this.heroStatus.power > 0 ? `P+${this.heroStatus.power} ` : ''}${this.heroStatus.vulnerable > 0 ? `V${this.heroStatus.vulnerable} ` : ''}${this.heroStatus.weak > 0 ? `W${this.heroStatus.weak}` : ''}`,
        scale: 1,
        align: 'center',
      });
    }

    // 2. Enemies (right arena)
    let slotVis = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      if (!e.active || !e.def || e.hp <= 0) continue;
      const ex = 176 + slotVis * 46;
      const ey = 74 + Math.sin(this.animClock * 2.8 + i) * 2;
      const selected = i === this.targetIdx && this.phase === 'combat';
      pushEntity(
        `card_enemy_${i}`,
        e.def.artBlueprintId,
        'front',
        e.pose,
        ex,
        ey,
        28,
        28,
        true,
        e.flash,
        e.def.paletteRow,
      );

      if (selected) {
        pushHud('text', ex + 14, ey - 16, 0, 0, '#ffd447', { text: 'V', scale: 1, align: 'center' });
      }
      const intent = e.def.intents[e.intentIdx % e.def.intents.length];
      if (intent) {
        const intentTxt =
          intent.kind === 'attack'
            ? `ATK ${calcAttackDamage(intent.value, e.status, this.heroStatus)}`
            : intent.kind === 'multi_attack'
              ? `ATK ${calcAttackDamage(intent.value, e.status, this.heroStatus)}x${intent.hits ?? 2}`
              : intent.kind === 'defend'
                ? `BLK ${intent.value}`
                : intent.kind === 'buff'
                  ? `BUF +${intent.statusStacks ?? intent.value}`
                  : `HEX ${intent.status?.slice(0, 3).toUpperCase() ?? ''}`;
        pushHud('text', ex + 14, ey - 8, 0, 0, intent.kind.includes('attack') ? '#ff708d' : '#5ec2f7', {
          text: intentTxt,
          scale: 1,
          align: 'center',
        });
      }
      pushHud('bar', ex - 4, ey + 31, 36, 4, '#ff5d8f', { ratio: e.hp / Math.max(1, e.maxHp), bgColor: '#1a1126' });
      pushHud('text', ex + 14, ey + 37, 0, 0, '#fffaf0', {
        text: `${e.hp}${e.block > 0 ? `+${e.block}` : ''}${e.status.vulnerable > 0 ? ` V${e.status.vulnerable}` : ''}${e.status.burn > 0 ? ` B${e.status.burn}` : ''}`,
        scale: 1,
        align: 'center',
      });
      slotVis++;
    }

    // 3. Hand cards or Reward Draft panel
    if (this.phase === 'reward') {
      pushHud('box', 18, 118, viewW - 36, 56, '#140f24', { alpha: 0.92 });
      pushHud('text', viewW * 0.5, 122, 0, 0, '#ffd447', {
        text: 'DRAFT 1 CARD (A PICK / Y SKIP)',
        scale: 1,
        align: 'center',
      });
      const rw = 82;
      const startX = Math.floor((viewW - (this.rewardCount * (rw + 6) - 6)) * 0.5);
      for (let i = 0; i < this.rewardCount; i++) {
        const card = this.cardCatalog[this.rewardChoices[i]];
        if (!card) continue;
        const cx = startX + i * (rw + 6);
        const sel = i === this.rewardCursor;
        pushHud('box', cx, sel ? 132 : 136, rw, 34, sel ? (card.accentHex ?? '#ffd447') : '#2c2246', { alpha: 0.95 });
        pushHud('box', cx + 2, (sel ? 132 : 136) + 2, rw - 4, 30, '#161028', { alpha: 0.92 });
        pushHud('text', cx + rw * 0.5, (sel ? 132 : 136) + 6, 0, 0, '#fffaf0', {
          text: `${card.cost} ${card.name.slice(0, 7)}`,
          scale: 1,
          align: 'center',
        });
        pushHud('text', cx + rw * 0.5, (sel ? 132 : 136) + 18, 0, 0, '#a6b7d6', {
          text: card.shortDesc.slice(0, 11),
          scale: 1,
          align: 'center',
        });
      }
    } else if (this.phase === 'combat') {
      const n = this.handCount;
      if (n > 0) {
        const cardW = Math.min(58, Math.floor((viewW - 20) / n) - 4);
        const totalW = n * (cardW + 4) - 4;
        const startX = Math.floor((viewW - totalW) * 0.5);
        for (let i = 0; i < n; i++) {
          const card = this.cardCatalog[this.handZone[i]];
          if (!card) continue;
          const sel = i === this.handCursor;
          const canAfford = this.energy >= card.cost;
          const cx = startX + i * (cardW + 4);
          const cy = sel ? viewH - 52 : viewH - 44;
          const ch = sel ? 48 : 40;
          pushHud('box', cx, cy, cardW, ch, sel ? '#ffd447' : (canAfford ? (card.accentHex ?? '#5ec2f7') : '#4a415c'), { alpha: 0.95 });
          pushHud('box', cx + 1.5, cy + 1.5, cardW - 3, ch - 3, '#171129', { alpha: 0.92 });
          pushHud('text', cx + 4, cy + 4, 0, 0, canAfford ? '#ffd447' : '#ff708d', {
            text: `${card.cost}`,
            scale: 1,
            align: 'left',
          });
          pushHud('text', cx + cardW * 0.5 + 3, cy + 4, 0, 0, '#fffaf0', {
            text: card.name.slice(0, 6),
            scale: 1,
            align: 'center',
          });
          pushHud('text', cx + cardW * 0.5, cy + ch - 11, 0, 0, '#b9c9e6', {
            text: card.shortDesc.slice(0, 8),
            scale: 1,
            align: 'center',
          });
          // Orthogonal Art Portrait icon inside the card frame
          pushEntity(
            `card_art_${i}`,
            card.artBlueprintId,
            'portrait',
            'idle',
            cx + cardW * 0.5 - 7,
            cy + 13,
            14,
            14,
            false,
            0,
            card.paletteRow,
          );
        }
      }
      pushHud('text', viewW - 8, viewH - 58, 0, 0, '#ffd447', {
        text: 'Y:END TURN  L/R:TARGET',
        scale: 1,
        align: 'right',
      });
    }
  }
}
