import { clamp, type RuntimeParams, type SimEvent } from '../../core/types/WorldTypes.ts';
import { CHAPTER_SPECS, getGearById } from './AstralChroniclesData.ts';
import {
  collidesWall,
  damageBoss,
  damageEnemy,
  damageHero,
  getHeroAtk,
  getHeroDef,
  grantXpAndGold,
  initStarfield,
  loadChapterWorld,
  startNewCampaign,
  type ChronicleState,
} from './ChronicleWorldState.ts';

export {
  collidesWall,
  damageBoss,
  damageEnemy,
  damageHero,
  getHeroAtk,
  getHeroDef,
  grantXpAndGold,
  initStarfield,
  loadChapterWorld,
  startNewCampaign,
};
export type { ChronicleState };

export function performAttack(s: ChronicleState, events: SimEvent[], density: number): void {
  s.hasSlashed = true;
  const weapon = getGearById(s.equippedWeaponId);
  const dmg = getHeroAtk(s) + (s.comboStep === 2 ? 4 : 0);
  const range = 30 + weapon.rangeBonus + (s.comboStep === 2 ? 6 : 0);
  s.attackCooldown = s.comboStep === 2 ? 0.34 : 0.22;
  s.comboResetTimer = 0.72;
  s.comboStep = (s.comboStep + 1) % 3;
  s.squash = { scaleX: 1.28, scaleY: 0.78 };
  events.push('laser');

  const aimAng = Math.atan2(s.facingY, s.facingX);
  const cx = s.hx + 8 + Math.cos(aimAng) * 14;
  const cy = s.hy + 8 + Math.sin(aimAng) * 14;
  s.slashes.push({
    x: cx,
    y: cy,
    angle: aimAng,
    life: 0,
    maxLife: 0.16,
    color: weapon.id === 'w_astral' ? '#ffd447' : weapon.id === 'w_starsteel' ? '#5ec2f7' : '#fffaf0',
    size: range * 0.78,
  });

  if (weapon.id !== 'w_oak' && s.comboStep === 0) {
    s.projectiles.push({
      x: cx,
      y: cy,
      vx: Math.cos(aimAng) * 195,
      vy: Math.sin(aimAng) * 195,
      fromEnemy: false,
      damage: Math.max(4, Math.round(dmg * 0.7)),
      life: 0.45,
      color: weapon.id === 'w_astral' ? '#ffd447' : '#5ec2f7',
      sprite: 'bolt',
      size: 11,
    });
  }

  let landed = false;
  for (let i = s.enemies.length - 1; i >= 0; i--) {
    const e = s.enemies[i];
    const dist = Math.hypot(e.x + 8 - cx, e.y + 8 - cy);
    if (dist <= range * 0.78) {
      landed = true;
      damageEnemy(s, i, dmg, Math.cos(aimAng) * 95, Math.sin(aimAng) * 95, events, density);
    }
  }

  if (s.boss) {
    const dist = Math.hypot(s.boss.x + 14 - cx, s.boss.y + 10 - cy);
    if (dist <= range * 0.92) {
      landed = true;
      damageBoss(s, dmg, events, density);
    }
  }

  if (landed) {
    s.juice.triggerHitstop(0.032);
    s.juice.addTrauma(0.22);
    s.juice.addKick(-Math.cos(aimAng) * 2.4, -Math.sin(aimAng) * 2.4);
    s.juice.registerCombo();
    s.heroMp = Math.min(s.heroMaxMp, s.heroMp + 3);
  } else {
    s.juice.addKick(Math.cos(aimAng) * 0.7, Math.sin(aimAng) * 0.7);
  }
}

export function performDash(s: ChronicleState, events: SimEvent[], density: number): void {
  if (s.heroStamina < 25 || s.dashTimer > 0) return;
  s.hasDashed = true;
  s.heroStamina -= 25;
  s.staminaRegenDelay = 0.45;
  s.dashTimer = 0.18;
  s.invulnTimer = Math.max(s.invulnTimer, 0.3);

  let dx = s.input.axisX();
  let dy = s.input.axisY();
  if (dx === 0 && dy === 0) {
    dx = s.facingX;
    dy = s.facingY;
  }
  const len = Math.max(1, Math.hypot(dx, dy));
  s.dashVx = (dx / len) * 235;
  s.dashVy = (dy / len) * 235;
  s.squash = { scaleX: 1.35, scaleY: 0.72 };
  s.juice.addKick(-(dx / len) * 2.0, -(dy / len) * 2.0);
  events.push('jump');
  s.juice.spawnBurst(s.hx + 8, s.hy + 8, ['#8ce8ff', '#fffaf0'], 7, density, { gravity: 0, liftY: 0 });
}

export function castRelicSkill(s: ChronicleState, events: SimEvent[]): boolean {
  const relic = getGearById(s.equippedRelicId);
  const cost = Math.max(10, relic.mpCost);
  if (s.heroMp < cost) {
    s.noticeText = `⚡ 星能不足（需要 ${cost} MP）！普攻敵人可快速回魔`;
    s.noticeTimer = 1.8;
    return false;
  }
  s.hasUsedRelic = true;
  s.heroMp -= cost;
  s.invulnTimer = Math.max(s.invulnTimer, 0.35);
  events.push('ignite');
  s.juice.applyPreset('relic_burst', { dirX: -s.facingX, dirY: -s.facingY });

  if (relic.id === 'r_aegis') {
    const heal = 28;
    s.heroHp = Math.min(s.heroMaxHp, s.heroHp + heal);
    s.juice.triggerFlash('#56d39c', 0.22);
    s.noticeText = `🛡️ 極光聖盾發動！回復 ${heal} HP 並震飛敵群`;
  } else {
    s.juice.triggerFlash(relic.id === 'r_flame' ? '#ff708d' : '#5ec2f7', 0.2);
    s.noticeText = `✨ 解放遺物技：【${relic.name}】！`;
  }
  s.noticeTimer = 2.0;

  const pCount = relic.id === 'r_flame' ? 10 : 8;
  const pDmg = relic.id === 'r_flame' ? getHeroAtk(s) + 10 : getHeroAtk(s) + 5;
  const color = relic.id === 'r_flame' ? '#ff708d' : relic.id === 'r_aegis' ? '#56d39c' : '#5ec2f7';
  for (let k = 0; k < pCount; k++) {
    const ang = (Math.PI * 2 * k) / pCount;
    s.projectiles.push({
      x: s.hx + 8,
      y: s.hy + 8,
      vx: Math.cos(ang) * 170,
      vy: Math.sin(ang) * 170,
      fromEnemy: false,
      damage: Math.round(pDmg * 0.8),
      life: 0.72,
      color,
      sprite: relic.id === 'r_flame' ? 'sparkle' : 'bolt',
      size: 12,
    });
  }
  for (let i = s.enemies.length - 1; i >= 0; i--) {
    const e = s.enemies[i];
    const dx = e.x - s.hx;
    const dy = e.y - s.hy;
    const dist = Math.hypot(dx, dy);
    if (dist < 62) {
      const len = Math.max(1, dist);
      damageEnemy(s, i, pDmg, (dx / len) * 140, (dy / len) * 140, events, 1.0);
    }
  }
  if (s.boss && Math.hypot(s.boss.x - s.hx, s.boss.y - s.hy) < 72) {
    damageBoss(s, pDmg, events, 1.0);
  }
  return true;
}

export function stepCombatActors(
  s: ChronicleState,
  simDt: number,
  events: SimEvent[],
  params: RuntimeParams,
): void {
  const ch = CHAPTER_SPECS[s.chapterIdx];

  for (const e of s.enemies) {
    if (e.flash > 0) e.flash = Math.max(0, e.flash - simDt * 6);
    const dx = s.hx - e.x;
    const dy = s.hy - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 190) {
      const moveRate = e.kind === 'slime' ? 42 : e.kind === 'gargoyle' ? 54 : 46;
      const keepDist = e.kind === 'shaman' || e.kind === 'frost_mage' ? 76 : 12;
      if (dist > keepDist) {
        e.vx += ((dx / Math.max(1, dist)) * moveRate - e.vx) * Math.min(1, simDt * 5);
        e.vy += ((dy / Math.max(1, dist)) * moveRate - e.vy) * Math.min(1, simDt * 5);
      }
      e.facingX = dx >= 0 ? 1 : -1;

      if (e.kind === 'shaman' || e.kind === 'frost_mage' || e.kind === 'dragon_guard') {
        e.aiTimer -= simDt;
        if (e.aiTimer <= 0) {
          e.aiTimer = 1.9;
          const len = Math.max(1, dist);
          s.projectiles.push({
            x: e.x + 8,
            y: e.y + 8,
            vx: (dx / len) * 112,
            vy: (dy / len) * 112,
            fromEnemy: true,
            damage: e.atk,
            life: 2.2,
            color: e.kind === 'frost_mage' ? '#8ce8ff' : '#ff708d',
            sprite: 'sparkle',
            size: 9,
          });
        }
      }
    }
    e.vx *= Math.exp(-5 * simDt);
    e.vy *= Math.exp(-5 * simDt);
    const enx = e.x + e.vx * simDt;
    if (!collidesWall(s, enx, e.y)) e.x = enx;
    const eny = e.y + e.vy * simDt;
    if (!collidesWall(s, e.x, eny)) e.y = eny;

    if (Math.hypot(s.hx + 8 - (e.x + 8), s.hy + 8 - (e.y + 8)) < 14) {
      damageHero(s, e.atk, events, params.sparkleDensity);
    }
  }

  if (s.boss) {
    const b = s.boss;
    if (b.flash > 0) b.flash = Math.max(0, b.flash - simDt * 6);
    const dx = s.hx - b.x;
    const dy = s.hy - b.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const chase = b.phase === 2 ? 52 : 34;
    b.vx += ((dx / dist) * chase - b.vx) * Math.min(1, simDt * 3.5);
    b.vy += ((dy / dist) * chase - b.vy) * Math.min(1, simDt * 3.5);

    b.x = clamp(b.x + b.vx * simDt, ch.gateWall.x + 20, ch.worldW - 36);
    b.y = clamp(b.y + b.vy * simDt, 22, ch.worldH - 36);

    b.aiTimer -= simDt;
    if (b.aiTimer <= 0) {
      b.aiTimer = b.phase === 2 ? 1.05 : 1.55;
      const shots = b.phase === 2 ? 5 : 3;
      const baseAng = Math.atan2(dy, dx);
      for (let k = 0; k < shots; k++) {
        const offset = (k - (shots - 1) * 0.5) * (b.phase === 2 ? 0.34 : 0.28);
        s.projectiles.push({
          x: b.x + 12,
          y: b.y + 10,
          vx: Math.cos(baseAng + offset) * (118 + s.chapterIdx * 8),
          vy: Math.sin(baseAng + offset) * (118 + s.chapterIdx * 8),
          fromEnemy: true,
          damage: b.atk,
          life: 2.5,
          color: b.phase === 2 ? '#e0aaff' : '#ff708d',
          sprite: 'sparkle',
          size: 10,
        });
      }
    }

    if (Math.hypot(s.hx + 8 - (b.x + 14), s.hy + 8 - (b.y + 10)) < 19) {
      damageHero(s, b.atk, events, params.sparkleDensity);
    }
  }

  for (let i = s.projectiles.length - 1; i >= 0; i--) {
    const p = s.projectiles[i];
    p.life -= simDt;
    p.x += p.vx * simDt;
    p.y += p.vy * simDt;
    if (p.life <= 0 || collidesWall(s, p.x, p.y, 4, 4)) {
      s.projectiles.splice(i, 1);
      continue;
    }
    if (p.fromEnemy) {
      if (Math.hypot(s.hx + 8 - p.x, s.hy + 8 - p.y) < 10) {
        s.projectiles.splice(i, 1);
        damageHero(s, p.damage, events, params.sparkleDensity);
      }
    } else {
      let hit = false;
      for (let j = s.enemies.length - 1; j >= 0; j--) {
        const e = s.enemies[j];
        if (Math.hypot(p.x - (e.x + 8), p.y - (e.y + 8)) < 14) {
          damageEnemy(s, j, p.damage, p.vx * 0.25, p.vy * 0.25, events, params.sparkleDensity);
          hit = true;
          break;
        }
      }
      if (!hit && s.boss && Math.hypot(p.x - (s.boss.x + 14), p.y - (s.boss.y + 10)) < 18) {
        damageBoss(s, p.damage, events, params.sparkleDensity);
        hit = true;
      }
      if (hit) s.projectiles.splice(i, 1);
    }
  }

  for (let i = s.slashes.length - 1; i >= 0; i--) {
    s.slashes[i].life += simDt;
    if (s.slashes[i].life >= s.slashes[i].maxLife) s.slashes.splice(i, 1);
  }
}
