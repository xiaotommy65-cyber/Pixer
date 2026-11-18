import type { RuntimeParams } from '../types/WorldTypes.ts';
import {
  activateSwitchPad,
  destroyFragile,
  igniteFlammable,
  primeExplosive,
  rectsOverlap,
  type RuleWorldActions,
} from './RuleMatrix.ts';
import { HERO_HB } from './WorldInternalTypes.ts';
import type { WorldKernel } from './WorldKernel.ts';

export function stepHeroControls(
  world: WorldKernel,
  dt: number,
  params: RuntimeParams,
  actions: RuleWorldActions,
): void {
  const h = world.hero;
  const dir = world.input.axisX();

  if (h.dashTimer > 0) {
    h.dashTimer = Math.max(0, h.dashTimer - dt);
    h.vy = 0;
    if (Math.random() < 0.65) {
      actions.spawnBurst(h.x + 8, h.y + 8, ['#ff708d', '#5ec2f7', '#fffaf0'], 2);
    }
  } else {
    if (dir !== 0) {
      h.facingLeft = dir < 0;
      const targetVx = dir * params.moveSpeed;
      const accel = h.onGround ? 960 : 640;
      h.vx =
        h.vx < targetVx
          ? Math.min(targetVx, h.vx + accel * dt)
          : Math.max(targetVx, h.vx - accel * dt);
      h.walkAnim += dt * 9;
    } else {
      const decel = h.onGround ? 880 : 300;
      h.vx =
        h.vx > 0
          ? Math.max(0, h.vx - decel * dt)
          : Math.min(0, h.vx + decel * dt);
    }
  }

  if (h.onGround) {
    h.airJumpsLeft = world.relics.doubleJump ? 1 : 0;
  }

  if (world.input.justPressed('jump') || world.input.justPressed('up')) {
    world.input.primeBuffer('jump', 0.13);
  }
  h.coyote = h.onGround ? 0.11 : Math.max(0, h.coyote - dt);

  if (world.input.hasBuffered('jump') && h.coyote > 0) {
    world.input.consumeBuffer('jump');
    h.vy = -params.jumpPower;
    h.onGround = false;
    h.coyote = 0;
    h.squash = { scaleX: 0.78, scaleY: 1.24 };
    actions.emit('jump');
    actions.spawnBurst(h.x + 8, h.y + 15, ['#fffaf0', '#56d39c'], 4);
  } else if (
    world.input.hasBuffered('jump') &&
    world.relics.doubleJump &&
    h.airJumpsLeft > 0 &&
    !h.onGround
  ) {
    world.input.consumeBuffer('jump');
    h.airJumpsLeft--;
    h.vy = -params.jumpPower * 0.94;
    h.dashTimer = 0;
    h.squash = { scaleX: 0.74, scaleY: 1.28 };
    actions.emit('jump');
    actions.spawnBurst(h.x + 8, h.y + 15, ['#5ec2f7', '#fffaf0', '#ffd447'], 8);
  }

  if (h.dashTimer <= 0 && !world.input.held('jump') && !world.input.held('up') && h.vy < -60) {
    h.vy *= 0.86;
  }

  if (h.dashTimer <= 0) {
    const apexBoost = !h.onGround && Math.abs(h.vy) < 38 ? 0.56 : 1.0;
    h.vy = Math.min(340, h.vy + 590 * params.gravityScale * apexBoost * dt);
  }

  if (world.input.justPressed('action') || world.input.justPressed('shoulderR')) {
    const sign = h.facingLeft ? -1 : 1;
    if (world.relics.airDash && !h.onGround && h.dashCooldown <= 0) {
      h.dashTimer = 0.14;
      h.dashCooldown = 0.55;
      h.vx = sign * 235;
      h.vy = 0;
      h.squash = { scaleX: 1.32, scaleY: 0.72 };
      world.juice.addKick(-sign * 2.4, 0);
      actions.emit('snap');
      actions.spawnBurst(h.x + 8, h.y + 8, ['#ff708d', '#5ec2f7', '#fffaf0'], 10);
    } else {
      world.sparks.push({
        x: h.x + 8 + sign * 7,
        y: h.y + 7,
        vx: sign * 155,
        vy: -22,
        life: 0.42,
      });
      h.squash = { scaleX: 1.15, scaleY: 0.88 };
      world.juice.addKick(-sign * 1.1, 0);
      actions.emit('ignite');
      actions.spawnBurst(h.x + 8 + sign * 8, h.y + 7, ['#ffd447', '#fffaf0'], 4);
    }
  }

  if (world.input.justPressed('skillY') && world.consumeSkillYCooldown(actions)) {
    const sign = h.facingLeft ? -1 : 1;
    world.sparks.push(
      { x: h.x + 8 + sign * 7, y: h.y + 5, vx: sign * 172, vy: -46, life: 0.48 },
      { x: h.x + 8 + sign * 7, y: h.y + 9, vx: sign * 164, vy: 8, life: 0.48 },
    );
    h.squash = { scaleX: 1.2, scaleY: 0.84 };
    world.juice.addKick(-sign * 1.6, 0);
    actions.emit('ignite');
    actions.spawnBurst(h.x + 8 + sign * 8, h.y + 7, ['#56d39c', '#ffd447', '#fffaf0'], 8);
  }
}

export function resolveHeroMotion(world: WorldKernel, dt: number, actions: RuleWorldActions): void {
  const h = world.hero;
  const { x: hbX, y: hbY, w: hbW, h: hbH } = HERO_HB;
  const wasOnGround = h.onGround;

  h.x = Math.max(0, Math.min(world.worldW - 16, h.x + h.vx * dt));
  for (const e of world.entities) {
    if (!e.alive || !e.tags.has('pushable')) continue;
    if (!rectsOverlap(h.x + hbX, h.y + hbY, hbW, hbH, e.x, e.y + 3, e.w, e.h - 5)) continue;
    if (h.vx > 0 && h.x < e.x) {
      e.vx = Math.max(e.vx, Math.min(82, h.vx * 0.92));
      h.x = e.x - hbX - hbW;
    } else if (h.vx < 0 && h.x > e.x) {
      e.vx = Math.min(e.vx, Math.max(-82, h.vx * 0.92));
      h.x = e.x + e.w - hbX;
    }
  }

  for (const s of world.solids) {
    if (s.kind === 'cloud') continue;
    if (!rectsOverlap(h.x + hbX, h.y + hbY, hbW, hbH, s.x, s.y, s.w, s.h)) continue;
    if (h.vx > 0) h.x = s.x - hbX - hbW;
    else if (h.vx < 0) h.x = s.x + s.w - hbX;
    h.vx = 0;
  }

  const prevBottom = h.y + hbY + hbH;
  const preLandVy = h.vy;
  h.y += h.vy * dt;
  h.onGround = false;

  for (const s of world.getSolidBoxes(true)) {
    if (h.x + hbX + hbW <= s.x || h.x + hbX >= s.x + s.w) continue;
    if (s.kind === 'cloud') {
      if (h.vy >= 0 && prevBottom <= s.y + 6 && h.y + hbY + hbH >= s.y) {
        h.y = s.y - hbY - hbH;
        h.vy = 0;
        h.onGround = true;
      }
      continue;
    }
    if (h.y + hbY + hbH > s.y && h.y + hbY < s.y + s.h) {
      if (h.vy >= 0 && prevBottom <= s.y + 8) {
        h.y = s.y - hbY - hbH;
        h.vy = 0;
        h.onGround = true;
      } else if (h.vy < 0) {
        // 4px ceiling corner correction
        const leftClip = h.x + hbX + hbW - s.x;
        const rightClip = s.x + s.w - (h.x + hbX);
        if (leftClip > 0 && leftClip <= 4) h.x -= leftClip;
        else if (rightClip > 0 && rightClip <= 4) h.x += rightClip;
        else {
          h.y = s.y + s.h - hbY;
          h.vy = 0;
        }
      }
    }
  }

  if (!wasOnGround && h.onGround && preLandVy > 95) {
    const amt = Math.min(0.28, (preLandVy / 320) * 0.28);
    h.squash = { scaleX: 1 + amt, scaleY: 1 - amt * 0.9 };
    actions.spawnBurst(h.x + 8, h.y + 15, ['#fffaf0', '#c7d4e6'], 3);
  }
}

export function rescueHeroFromAbyss(world: WorldKernel, actions: RuleWorldActions): void {
  const h = world.hero;
  if (h.y <= world.worldH + 18) return;
  world.hearts--;
  actions.emit('hurt');
  actions.triggerJuice(0.06, 0.5, '#ff708d', 0.28);
  if (world.hearts <= 0) {
    world.status = 'lost';
    return;
  }
  if (h.checkpoint) {
    h.x = h.checkpoint.x;
    h.y = h.checkpoint.y;
  } else {
    h.x = Math.max(24, Math.min(h.x - 36, world.worldW - 40));
    h.y = 48;
  }
  h.vx = 0;
  h.vy = 0;
  h.invuln = 1.25;
}

export function handleHeroEntityInteractions(
  world: WorldKernel,
  params: RuntimeParams,
  actions: RuleWorldActions,
): void {
  const h = world.hero;
  const hcx = h.x + 8;
  const hcy = h.y + 8;

  for (const e of world.entities) {
    if (!e.alive) continue;
    const ecx = e.x + e.w * 0.5;
    const ecy = e.y + e.h * 0.5;
    const dist = Math.hypot(hcx - ecx, hcy - ecy);

    if (e.tags.has('collectible') && dist < 13) {
      e.alive = false;
      if (e.archetype === 'star') {
        world.recordStarCollected();
        actions.addScore(100);
      } else {
        actions.addScore(50);
      }
      world.juice.registerCombo();
      actions.emit('star');
      actions.spawnBurst(ecx, ecy, ['#ffd447', '#fffaf0', '#ff708d'], 9);
    } else if (e.tags.has('relic') && dist < 14) {
      e.alive = false;
      if (e.archetype === 'feather') {
        world.relics.doubleJump = true;
        h.airJumpsLeft = 1;
        world.noticeBanner = '🪶 獲得「雲海羽毛」！解鎖【二段跳】！';
      } else if (e.archetype === 'dash_badge') {
        world.relics.airDash = true;
        world.noticeBanner = '⚡ 獲得「流星徽章」！空中按 A 施展【空中衝刺】！';
      }
      world.noticeTimer = 4.0;
      actions.addScore(250);
      actions.emit('key');
      actions.triggerJuice(0.05, 0.25, '#5ec2f7', 0.22);
      actions.spawnBurst(ecx, ecy, ['#5ec2f7', '#ffd447', '#fffaf0'], 16);
    } else if (e.tags.has('checkpoint') && !e.active && dist < 15) {
      e.active = true;
      e.sprite = 'flag_on';
      e.lightColor = '#ffd447';
      e.lightIntensity = 0.52;
      h.checkpoint = { x: e.x, y: e.y - 2 };
      world.hearts = Math.min(world.maxHearts, world.hearts + 1);
      world.noticeBanner = '🚩 已啟用中繼檢查點！愛心恢復 +1';
      world.noticeTimer = 2.6;
      actions.addScore(80);
      actions.emit('star');
      actions.spawnBurst(ecx, ecy, ['#56d39c', '#ffd447', '#fffaf0'], 12);
    } else if (e.tags.has('portal') && h.portalCooldown <= 0 && dist < 12) {
      const partner = world.entities.find(
        (o) => o.alive && o.id !== e.id && o.tags.has('portal') && o.portalGroup === e.portalGroup,
      );
      if (partner) {
        h.x = partner.x;
        h.y = partner.y;
        h.vx = 0;
        h.vy = 0;
        h.portalCooldown = 0.7;
        actions.emit('snap');
        actions.triggerJuice(0.02, 0.18, '#e0aaff', 0.18);
        actions.spawnBurst(ecx, ecy, ['#e0aaff', '#5ec2f7'], 10);
        actions.spawnBurst(partner.x + 8, partner.y + 8, ['#e0aaff', '#fffaf0'], 12);
        break;
      }
    } else if (e.tags.has('key') && dist < 14) {
      e.alive = false;
      actions.unlockGates();
      actions.addScore(200);
      actions.emit('key');
      actions.triggerJuice(0.04, 0.22, '#ffd447', 0.22);
      actions.spawnBurst(ecx, ecy, ['#ffd447', '#56d39c', '#fffaf0'], 14);
    } else if (e.tags.has('bouncy') && Math.abs(hcx - ecx) < 12 && Math.abs(hcy - ecy) < 12) {
      h.vy = -params.jumpPower * 1.42;
      h.onGround = false;
      h.airJumpsLeft = world.relics.doubleJump ? 1 : 0;
      h.squash = { scaleX: 0.72, scaleY: 1.32 };
      e.scaleX = 1.38;
      e.scaleY = 0.62;
      e.flashTimer = 0.1;
      actions.emit('bounce');
      actions.triggerJuice(0.02, 0.22);
      actions.spawnBurst(ecx, e.y + 4, ['#ff708d', '#ffd447', '#fffaf0'], 8);
    } else if (e.tags.has('switch') && dist < 13) {
      if (activateSwitchPad(e, actions, 10)) {
        actions.triggerJuice(0.03, 0.25);
      }
    } else if (e.tags.has('gate') && world.gateUnlocked && dist < 15) {
      world.status = 'won';
      actions.addScore(300);
      actions.emit('win');
      actions.triggerJuice(0.06, 0.4, '#fffaf0', 0.28);
      actions.spawnBurst(ecx, ecy, ['#ffd447', '#56d39c', '#ff708d', '#5ec2f7'], 24);
    } else if (
      e.tags.has('stompable') &&
      Math.abs(hcx - ecx) < e.w * 0.5 + 5 &&
      Math.abs(hcy - ecy) < e.h * 0.5 + 5
    ) {
      if (h.vy > 8 && hcy - ecy < 7) {
        h.vy = -params.jumpPower * (e.tags.has('boss') ? 1.08 : 0.85);
        h.airJumpsLeft = world.relics.doubleJump ? 1 : 0;
        h.squash = { scaleX: 1.24, scaleY: 0.76 };
        world.juice.addKick(0, 2.2);
        world.juice.registerCombo();
        if (e.tags.has('boss')) {
          e.hp--;
          e.flashTimer = 0.22;
          e.scaleX = 1.35;
          e.scaleY = 0.68;
          if (e.hp <= 0) {
            destroyFragile(e, actions, 24);
            actions.addScore(500);
            actions.unlockGates();
            actions.emit('explode');
            actions.triggerJuice(0.08, 0.6, '#fffaf0', 0.28);
          } else {
            e.vx = (e.vx >= 0 ? 1 : -1) * Math.min(86, Math.abs(e.vx) + 8);
            actions.emit('stomp');
            actions.triggerJuice(0.045, 0.34, '#ffd447', 0.14);
            actions.spawnBurst(ecx, ecy, ['#ffd447', '#ff708d', '#fffaf0'], 10);
          }
        } else {
          destroyFragile(e, actions, 12);
          actions.emit('stomp');
          actions.triggerJuice(0.04, 0.3, '#fffaf0', 0.14);
        }
      } else if (h.invuln <= 0 && h.dashTimer <= 0) {
        world.hearts--;
        h.invuln = 1.25;
        h.flash = 0.26;
        h.vy = -145;
        h.vx = hcx < ecx ? -95 : 95;
        h.squash = { scaleX: 1.3, scaleY: 0.74 };
        world.juice.addKick(hcx < ecx ? -3.5 : 3.5, -1.8);
        actions.emit('hurt');
        actions.triggerJuice(0.065, 0.58, '#ff708d', 0.3);
        actions.spawnBurst(hcx, hcy, ['#ff708d', '#fffaf0'], 9);
        if (world.hearts <= 0) world.status = 'lost';
      }
    }
  }
}

export function stepSparks(world: WorldKernel, dt: number, actions: RuleWorldActions): void {
  for (let i = world.sparks.length - 1; i >= 0; i--) {
    const sp = world.sparks[i];
    sp.life -= dt;
    sp.vy += 120 * dt;
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
    if (sp.life <= 0) {
      world.sparks.splice(i, 1);
      continue;
    }

    let hit = false;
    for (const e of world.entities) {
      if (!e.alive || Math.hypot(sp.x - (e.x + e.w * 0.5), sp.y - (e.y + e.h * 0.5)) >= 12) continue;
      if (e.tags.has('explosive') && primeExplosive(e, actions, 0.45)) {
        hit = true;
        break;
      }
      if (e.tags.has('flammable') && igniteFlammable(e, actions, 1.35)) {
        hit = true;
        break;
      }
      if (e.tags.has('stompable') && !e.tags.has('boss')) {
        e.flashTimer = 0.16;
        e.vx = sp.vx > 0 ? 75 : -75;
        e.vy = -120;
        actions.emit('bounce');
        actions.spawnBurst(e.x + 8, e.y + 8, ['#ffd447', '#fffaf0'], 6);
        hit = true;
        break;
      }
    }
    if (hit) world.sparks.splice(i, 1);
  }
}
