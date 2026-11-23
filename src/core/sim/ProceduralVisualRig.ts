import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { curlNoise2DInto, hash2i } from '../math/NoiseMath.ts';
import { solveTwoBoneIkInto, VerletChain } from '../math/SpringDynamics.ts';
import type { EntityDesc, ParticleDesc } from '../types/SceneTypes.ts';

export interface CartridgeVerletChainDef {
  enabled: boolean;
  nodes?: number;
  segmentLength?: number;
  anchorOffsetX?: number;
  anchorOffsetY?: number;
  gravityY?: number;
  windX?: number;
  damping?: number;
  colorReady?: string;
  colorSpent?: string;
  sprite?: SpriteId;
  nodeSize?: number;
}

export interface CartridgeTwoBoneIkDef {
  enabled: boolean;
  len1?: number;
  len2?: number;
  shoulderOffsetX?: number;
  shoulderOffsetY?: number;
  targetMode?: 'grapple_or_aim' | 'forward';
  jointSprite?: SpriteId;
  tipSprite?: SpriteId;
  tint?: string;
}

export interface CartridgeAfterimageDef {
  enabled: boolean;
  intervalSec?: number;
  maxLifeSec?: number;
  tint?: string;
  minSpeed?: number;
  additive?: boolean;
}

export interface CartridgeStateSpritesDef {
  idle?: SpriteId;
  runA?: SpriteId;
  runB?: SpriteId;
  jump?: SpriteId;
  fall?: SpriteId;
  dash?: SpriteId;
  wallSlide?: SpriteId;
  swing?: SpriteId;
}

export interface CartridgeVisualRigDef {
  verletChain?: CartridgeVerletChainDef;
  twoBoneIk?: CartridgeTwoBoneIkDef;
  afterimage?: CartridgeAfterimageDef;
  stateSprites?: CartridgeStateSpritesDef;
}

export interface CartridgeCurlParticlesDef {
  enabled: boolean;
  count?: number;
  style?: 'embers' | 'stardust' | 'snow';
  colors?: readonly string[];
  curlStrength?: number;
  curlScale?: number;
  driftX?: number;
  driftY?: number;
  additive?: boolean;
}

export interface CartridgeAtmosphereDef {
  curlParticles?: CartridgeCurlParticlesDef;
  waterLevelY?: number;
  waterTint?: string;
  horizonHazeColor?: string;
  horizonHazeAlpha?: number;
  tiltShiftAlpha?: number;
  splitToneWarmth?: number;
}

interface AfterimageSlot {
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  sprite: SpriteId;
  flipX: boolean;
  life: number;
  maxLife: number;
  tint: string;
  additive: boolean;
}

const MAX_AFTERIMAGES = 8;
const MAX_AMBIENT_PARTICLES = 48;
const DEFAULT_EMBER_COLORS = ['#ffd447', '#ff708d', '#ff9f43', '#fff4d2'] as const;
const DEFAULT_STARDUST_COLORS = ['#5ec2f7', '#e0aaff', '#fffaf0', '#ffd447'] as const;
const DEFAULT_SNOW_COLORS = ['#ffffff', '#dbeeff', '#c4e4ff', '#eef8ff'] as const;

function acquireRigEntitySlot(pool: EntityDesc[], idx: number): EntityDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { id: '', sprite: 'solid', x: 0, y: 0, w: 8, h: 8 };
    pool[idx] = slot;
  }
  return slot;
}

/**
 * Pure, DOM-free, Zero-GC procedural visual rig & ambient particle system
 * integrated into the unified DataCartridgeRuntime.
 * Drives Verlet scarf/cape chains, 2-Bone IK limbs/claws, afterimage motion trails,
 * 6-state animation selection, and divergence-free Curl-Noise ambient particles.
 */
export class ProceduralVisualRigRuntime {
  private rig: CartridgeVisualRigDef | undefined;
  private atmosphere: CartridgeAtmosphereDef | undefined;

  private scarfChain = new VerletChain(7, 3.2);
  private scarfNodeCount = 7;
  private scarfReady = true;
  private readonly scarfIds: string[] = [];

  private readonly ikOut = new Float64Array(4);
  private ikActive = false;
  private ikShoulderX = 0;
  private ikShoulderY = 0;
  private ikAngle = 0;

  private readonly afterimages: AfterimageSlot[] = [];
  private readonly afterimageIds: string[] = [];
  private afterimageCursor = 0;
  private afterimageCooldown = 0;

  private readonly ambientPool: ParticleDesc[] = [];
  private ambientActiveCount = 0;
  private readonly curlScratch = new Float64Array(2);
  private elapsedSec = 0;

  constructor() {
    for (let i = 0; i < 16; i++) {
      this.scarfIds.push(`rig-scarf-${i}`);
    }
    for (let i = 0; i < MAX_AFTERIMAGES; i++) {
      this.afterimageIds.push(`rig-after-${i}`);
      this.afterimages.push({
        active: false,
        x: 0,
        y: 0,
        w: 16,
        h: 16,
        sprite: 'hero_a',
        flipX: false,
        life: 0,
        maxLife: 0.24,
        tint: '#5ec2f7',
        additive: true,
      });
    }
    for (let i = 0; i < MAX_AMBIENT_PARTICLES; i++) {
      this.ambientPool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 1,
        maxLife: 4,
        size: 1.5,
        color: '#ffd447',
        rot: 0,
        vRot: 0,
        additive: true,
      });
    }
  }

  public configure(
    rig: CartridgeVisualRigDef | undefined,
    atmosphere: CartridgeAtmosphereDef | undefined,
    startX: number,
    startY: number,
    viewW: number,
    viewH: number,
  ): void {
    this.rig = rig;
    this.atmosphere = atmosphere;
    this.elapsedSec = 0;
    this.afterimageCooldown = 0;
    this.afterimageCursor = 0;
    this.ikActive = false;

    for (let i = 0; i < MAX_AFTERIMAGES; i++) {
      this.afterimages[i].active = false;
    }

    const vc = rig?.verletChain;
    if (vc?.enabled) {
      const nodes = Math.max(3, Math.min(14, Math.round(vc.nodes ?? 7)));
      const segLen = Math.max(1.5, Math.min(8, vc.segmentLength ?? 3.2));
      if (this.scarfChain.count !== nodes || Math.abs(this.scarfChain.segmentLength - segLen) > 0.01) {
        this.scarfChain = new VerletChain(nodes, segLen);
      }
      this.scarfNodeCount = nodes;
      this.scarfChain.reset(
        startX + (vc.anchorOffsetX ?? 8),
        startY + (vc.anchorOffsetY ?? 6),
        -1,
        0.15,
      );
    }

    const cp = atmosphere?.curlParticles;
    if (cp?.enabled) {
      const count = Math.max(4, Math.min(MAX_AMBIENT_PARTICLES, Math.round(cp.count ?? 28)));
      this.ambientActiveCount = count;
      const palette = this.resolveCurlColors(cp);
      for (let i = 0; i < count; i++) {
        const p = this.ambientPool[i];
        p.x = startX - viewW * 0.4 + hash2i(i, 11, 73) * (viewW * 1.4);
        p.y = startY - viewH * 0.6 + hash2i(i, 29, 73) * (viewH * 1.3);
        p.vx = 0;
        p.vy = 0;
        p.maxLife = 2.6 + hash2i(i, 43, 73) * 3.4;
        p.life = p.maxLife * hash2i(i, 59, 73);
        p.size = cp.style === 'snow' ? 1.5 + hash2i(i, 71, 73) * 1.2 : 1.2 + hash2i(i, 71, 73) * 1.4;
        p.color = palette[i % palette.length];
        p.rot = hash2i(i, 83, 73) * Math.PI * 2;
        p.vRot = (hash2i(i, 97, 73) - 0.5) * 2.5;
        p.additive = cp.additive ?? (cp.style !== 'snow');
      }
    } else {
      this.ambientActiveCount = 0;
    }
  }

  public hasVerletRig(): boolean {
    return Boolean(this.rig?.verletChain?.enabled);
  }

  public hasIkRig(): boolean {
    return Boolean(this.rig?.twoBoneIk?.enabled);
  }

  public hasAfterimage(): boolean {
    return Boolean(this.rig?.afterimage?.enabled);
  }

  public getActiveAmbientParticleCount(): number {
    return this.ambientActiveCount;
  }

  public resolveStateSprite(
    baseA: SpriteId,
    baseB: SpriteId | undefined,
    walkAnim: number,
    speedX: number,
    vy: number,
    onGround: boolean,
    onWall: boolean,
    isDashing: boolean,
    isSwinging: boolean,
  ): SpriteId {
    const ss = this.rig?.stateSprites;
    if (ss) {
      if (isDashing && ss.dash) return ss.dash;
      if (isSwinging && ss.swing) return ss.swing;
      if (onWall && !onGround && ss.wallSlide) return ss.wallSlide;
      if (!onGround) {
        if (vy < -18 && ss.jump) return ss.jump;
        if (vy >= -18 && ss.fall) return ss.fall;
      }
      if (Math.abs(speedX) > 10) {
        const frameB = Math.floor(walkAnim) % 2 === 1;
        if (frameB && ss.runB) return ss.runB;
        if (ss.runA) return ss.runA;
      }
      if (ss.idle) return ss.idle;
    }
    if (baseB && (Math.abs(speedX) > 8 || !onGround) && Math.floor(walkAnim) % 2 === 1) {
      return baseB;
    }
    return baseA;
  }

  public step(
    dt: number,
    heroX: number,
    heroY: number,
    heroW: number,
    heroH: number,
    heroVx: number,
    heroVy: number,
    facingSign: number,
    heroSprite: SpriteId,
    dashReady: boolean,
    isDashing: boolean,
    grappleActive: boolean,
    targetX: number,
    targetY: number,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    this.elapsedSec += dt;
    this.scarfReady = dashReady;

    // 1. Step Verlet Scarf / Cape Chain
    const vc = this.rig?.verletChain;
    if (vc?.enabled) {
      const anchorX = heroX + (vc.anchorOffsetX ?? heroW * 0.5) - facingSign * 2.5;
      const anchorY = heroY + (vc.anchorOffsetY ?? heroH * 0.38);
      const breeze = Math.sin(this.elapsedSec * 4.8) * 34;
      const windX = (vc.windX ?? -facingSign * 95) - heroVx * 0.72 + breeze;
      const gravY = (vc.gravityY ?? 135) - Math.min(80, Math.abs(heroVx) * 0.35);
      this.scarfChain.step(dt, anchorX, anchorY, windX, gravY, vc.damping ?? 0.94, 6);
    }

    // 2. Solve Analytical 2-Bone IK Limb / Grapple Arm
    const ik = this.rig?.twoBoneIk;
    if (ik?.enabled) {
      const sx = heroX + (ik.shoulderOffsetX ?? heroW * 0.5) + facingSign * 2;
      const sy = heroY + (ik.shoulderOffsetY ?? heroH * 0.44);
      const len1 = Math.max(3, Math.min(20, ik.len1 ?? 6.5));
      const len2 = Math.max(3, Math.min(20, ik.len2 ?? 6.5));
      const tx = grappleActive || ik.targetMode !== 'forward' ? targetX : sx + facingSign * (len1 + len2) * 0.85;
      const ty = grappleActive || ik.targetMode !== 'forward' ? targetY : sy - 2 + Math.sin(this.elapsedSec * 6) * 1.5;
      const bendDir = tx >= sx ? -1 : 1;
      solveTwoBoneIkInto(sx, sy, tx, ty, len1, len2, bendDir, this.ikOut, 0);
      this.ikShoulderX = sx;
      this.ikShoulderY = sy;
      this.ikAngle = Math.atan2(this.ikOut[3] - this.ikOut[1], this.ikOut[2] - this.ikOut[0]);
      this.ikActive = true;
    } else {
      this.ikActive = false;
    }

    // 3. Step Afterimage Motion Trails
    const ai = this.rig?.afterimage;
    for (let i = 0; i < MAX_AFTERIMAGES; i++) {
      const slot = this.afterimages[i];
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) slot.active = false;
    }
    if (ai?.enabled) {
      this.afterimageCooldown = Math.max(0, this.afterimageCooldown - dt);
      const speed = Math.hypot(heroVx, heroVy);
      const minSpd = ai.minSpeed ?? 165;
      if ((isDashing || speed >= minSpd) && this.afterimageCooldown <= 0) {
        this.afterimageCooldown = Math.max(0.02, ai.intervalSec ?? 0.042);
        const slot = this.afterimages[this.afterimageCursor];
        this.afterimageCursor = (this.afterimageCursor + 1) % MAX_AFTERIMAGES;
        slot.active = true;
        slot.x = heroX;
        slot.y = heroY;
        slot.w = heroW;
        slot.h = heroH;
        slot.sprite = heroSprite;
        slot.flipX = facingSign < 0;
        slot.maxLife = Math.max(0.08, ai.maxLifeSec ?? 0.24);
        slot.life = slot.maxLife;
        slot.tint = ai.tint ?? (isDashing ? '#5ec2f7' : '#ff708d');
        slot.additive = ai.additive ?? true;
      }
    }

    // 4. Step Divergence-Free Curl-Noise Ambient Particles
    const cp = this.atmosphere?.curlParticles;
    if (cp?.enabled && this.ambientActiveCount > 0) {
      const curlStr = cp.curlStrength ?? (cp.style === 'snow' ? 14 : 24);
      const curlScale = cp.curlScale ?? 0.014;
      const driftX = cp.driftX ?? (cp.style === 'snow' ? -12 : cp.style === 'stardust' ? 6 : 8);
      const driftY = cp.driftY ?? (cp.style === 'snow' ? 22 : cp.style === 'stardust' ? -8 : -20);
      const minX = camX - 32;
      const maxX = camX + viewW + 32;
      const minY = camY - 28;
      const maxY = camY + viewH + 28;
      const spanW = maxX - minX;
      const spanH = maxY - minY;

      for (let i = 0; i < this.ambientActiveCount; i++) {
        const p = this.ambientPool[i];
        curlNoise2DInto(p.x + this.elapsedSec * 12, p.y - this.elapsedSec * 8, this.curlScratch, 0, curlScale, 37);
        p.vx = driftX + this.curlScratch[0] * curlStr;
        p.vy = driftY + this.curlScratch[1] * curlStr;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vRot * dt;
        p.life -= dt;

        if (p.life <= 0) {
          p.life = p.maxLife;
          p.x = minX + hash2i(i, Math.floor(this.elapsedSec * 10), 19) * spanW;
          p.y = driftY < 0 ? maxY - 4 : minY + 4;
        }
        if (p.x < minX) p.x += spanW;
        else if (p.x > maxX) p.x -= spanW;
        if (p.y < minY) p.y += spanH;
        else if (p.y > maxY) p.y -= spanH;
      }
    }
  }

  public emitPreHeroEntities(
    outEntities: EntityDesc[],
    entitySlots: EntityDesc[],
    nextIdx: number,
  ): number {
    let idx = nextIdx;

    // 1. Afterimage motion trails (rendered behind hero)
    for (let i = 0; i < MAX_AFTERIMAGES; i++) {
      const slot = this.afterimages[i];
      if (!slot.active) continue;
      const ratio = slot.life / slot.maxLife;
      const dst = acquireRigEntitySlot(entitySlots, idx++);
      dst.id = this.afterimageIds[i];
      dst.sprite = slot.sprite;
      dst.x = slot.x;
      dst.y = slot.y;
      dst.w = slot.w;
      dst.h = slot.h;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 1;
      dst.skewX = undefined;
      dst.rot = 0;
      dst.flash = 0;
      dst.flipX = slot.flipX;
      dst.additive = slot.additive;
      dst.emissive = 0.55;
      dst.tint = slot.tint;
      dst.alpha = ratio * 0.58;
      dst.paletteRow = undefined;
      dst.elevationZ = undefined;
      dst.shadowOffsetY = undefined;
      dst.castShadow = false;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      dst.artBlueprintId = undefined;
      dst.artFacing = undefined;
      dst.artPose = undefined;
      dst.yawRad = undefined;
      dst.billboardScale = undefined;
      dst.hideInFirstPerson = true;
      outEntities.push(dst);
    }

    // 2. Verlet scarf/cape ribbon nodes (rendered right behind hero)
    const vc = this.rig?.verletChain;
    if (vc?.enabled) {
      const baseSize = Math.max(2.5, Math.min(8, vc.nodeSize ?? 4.6));
      const color = this.scarfReady ? (vc.colorReady ?? '#ff5d8f') : (vc.colorSpent ?? '#5ec2f7');
      const sprite: SpriteId = vc.sprite ?? 'solid';
      for (let i = 1; i < this.scarfNodeCount; i++) {
        const t = i / Math.max(1, this.scarfNodeCount - 1);
        const sz = baseSize * (1 - t * 0.42);
        const dst = acquireRigEntitySlot(entitySlots, idx++);
        dst.id = this.scarfIds[i];
        dst.sprite = sprite;
        dst.x = this.scarfChain.posX[i] - sz * 0.5;
        dst.y = this.scarfChain.posY[i] - sz * 0.5;
        dst.w = sz;
        dst.h = sz;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 0.5;
        dst.skewX = undefined;
        dst.rot = 0;
        dst.flash = 0;
        dst.flipX = false;
        dst.additive = false;
        dst.emissive = this.scarfReady ? 0.55 : 0.35;
        dst.tint = color;
        dst.alpha = 0.96 - t * 0.18;
        dst.paletteRow = undefined;
        dst.elevationZ = undefined;
        dst.shadowOffsetY = undefined;
        dst.castShadow = false;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        dst.artBlueprintId = undefined;
        dst.artFacing = undefined;
        dst.artPose = undefined;
        dst.yawRad = undefined;
        dst.billboardScale = undefined;
        dst.hideInFirstPerson = true;
        outEntities.push(dst);
      }
    }

    return idx;
  }

  public emitPostHeroEntities(
    outEntities: EntityDesc[],
    entitySlots: EntityDesc[],
    nextIdx: number,
  ): number {
    let idx = nextIdx;
    const ik = this.rig?.twoBoneIk;
    if (!ik?.enabled || !this.ikActive) return idx;

    const jx = this.ikOut[0];
    const jy = this.ikOut[1];
    const ex = this.ikOut[2];
    const ey = this.ikOut[3];
    const upperAng = Math.atan2(jy - this.ikShoulderY, jx - this.ikShoulderX);
    const tint = ik.tint ?? '#ffd447';

    // Elbow / forearm link
    const joint = acquireRigEntitySlot(entitySlots, idx++);
    joint.id = 'rig-ik-joint';
    joint.sprite = ik.jointSprite ?? 'grapple_link';
    joint.x = (this.ikShoulderX + jx) * 0.5 - 3.5;
    joint.y = (this.ikShoulderY + jy) * 0.5 - 2.5;
    joint.w = 7;
    joint.h = 5;
    joint.scaleX = 1;
    joint.scaleY = 1;
    joint.anchorY = 0.5;
    joint.skewX = undefined;
    joint.rot = upperAng;
    joint.flash = 0;
    joint.flipX = false;
    joint.additive = false;
    joint.emissive = 0.45;
    joint.tint = tint;
    joint.alpha = 0.95;
    joint.paletteRow = undefined;
    joint.elevationZ = undefined;
    joint.shadowOffsetY = undefined;
    joint.castShadow = false;
    joint.shadowRadius = undefined;
    joint.sortY = undefined;
    joint.artBlueprintId = undefined;
    joint.artFacing = undefined;
    joint.artPose = undefined;
    joint.yawRad = undefined;
    joint.billboardScale = undefined;
    joint.hideInFirstPerson = true;
    outEntities.push(joint);

    // End effector / grapple gauntlet tip
    const tip = acquireRigEntitySlot(entitySlots, idx++);
    tip.id = 'rig-ik-tip';
    tip.sprite = ik.tipSprite ?? 'grapple_claw';
    tip.x = ex - 4.5;
    tip.y = ey - 4.5;
    tip.w = 9;
    tip.h = 9;
    tip.scaleX = 1;
    tip.scaleY = 1;
    tip.anchorY = 0.5;
    tip.skewX = undefined;
    tip.rot = this.ikAngle;
    tip.flash = 0;
    tip.flipX = false;
    tip.additive = false;
    tip.emissive = 0.65;
    tip.tint = tint;
    tip.alpha = 0.95;
    tip.paletteRow = undefined;
    tip.elevationZ = undefined;
    tip.shadowOffsetY = undefined;
    tip.castShadow = false;
    tip.shadowRadius = undefined;
    tip.sortY = undefined;
    tip.artBlueprintId = undefined;
    tip.artFacing = undefined;
    tip.artPose = undefined;
    tip.yawRad = undefined;
    tip.billboardScale = undefined;
    tip.hideInFirstPerson = true;
    outEntities.push(tip);

    return idx;
  }

  public emitAmbientParticles(outParticles: ParticleDesc[]): void {
    for (let i = 0; i < this.ambientActiveCount; i++) {
      outParticles.push(this.ambientPool[i]);
    }
  }

  private resolveCurlColors(cp: CartridgeCurlParticlesDef): readonly string[] {
    if (cp.colors && cp.colors.length > 0) return cp.colors;
    if (cp.style === 'stardust') return DEFAULT_STARDUST_COLORS;
    if (cp.style === 'snow') return DEFAULT_SNOW_COLORS;
    return DEFAULT_EMBER_COLORS;
  }
}
