/**
 * High-Definition (32x32..64x64) 32-bit RGBA Procedural Material Sprite Pack.
 *
 * Synthesizes crisp, anti-aliased, multi-layered metallic/crystalline/architectural sprites
 * directly into Pixer's Multi-Page 1024x1024 TextureAtlas (indexPixels = 255 for full RGBA +
 * Sobel PBR-Lite specular/rim shading in WebGPU WGSL & WebGL2 GLSL).
 *
 * 100% DOM-free, deterministic, zero external assets required.
 */

export interface HdMaterialSpriteAsset {
  readonly id: HdMaterialSpriteId;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export type HdMaterialSpriteId =
  | 'hd_turret_solar'
  | 'hd_turret_prism'
  | 'hd_turret_jade'
  | 'hd_sanctum_core'
  | 'hd_void_slime'
  | 'hd_star_bolt'
  | 'hd_beat_orb_a'
  | 'hd_beat_orb_b'
  | 'hd_arena_tile';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash2d(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function writePixel(
  buf: Uint8Array,
  w: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const i = (y * w + x) * 4;
  buf[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
  buf[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
  buf[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
  buf[i + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
}

/**
 * Renders a 64x64 ornate metallic-framed crystal turret with beveled octagon pedestal,
 * machined metallic arms, faceted gemstone core, and specular sheen.
 */
function buildHdTurretSprite(
  coreHex: [number, number, number],
  rimHex: [number, number, number],
  metalHex: [number, number, number],
  armsCount: number,
): Uint8Array {
  const S = 64;
  const rgba = new Uint8Array(S * S * 4);
  const cx = S * 0.5;
  const cy = S * 0.5;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - cx) / (S * 0.5);
      const dy = (y + 0.5 - cy) / (S * 0.5);
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);

      // Octagonal metallic base SDF
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const octDist = Math.max(Math.max(ax, ay), (ax + ay) * 0.7071);

      // Rotating mechanical stabilizer fins
      const finWave = Math.cos(ang * armsCount);
      const finDist = r - (0.78 + 0.14 * Math.max(0, finWave));

      const bodySdf = Math.min(octDist - 0.74, finDist);
      if (bodySdf > 0.04) continue;

      const edgeAlpha = 1 - smoothstep(-0.02, 0.04, bodySdf);
      // Top-left studio directional key light (-0.55, -0.7, 0.45)
      const lightDot = clamp01(0.58 - dx * 0.48 - dy * 0.62);
      const microGrain = (hash2d(x, y) - 0.5) * 0.04;

      // Dark machined rim outline
      const isOuterRim = bodySdf > -0.07;
      const isBevelRing = r > 0.52 && r < 0.68;
      const isInnerWell = r <= 0.52;
      const isCrystal = r <= 0.36;

      let cr = metalHex[0] * (0.45 + 0.75 * lightDot + microGrain);
      let cg = metalHex[1] * (0.45 + 0.75 * lightDot + microGrain);
      let cb = metalHex[2] * (0.45 + 0.75 * lightDot + microGrain);

      if (isOuterRim) {
        cr *= 0.38;
        cg *= 0.38;
        cb *= 0.42;
      } else if (isBevelRing) {
        // Anodized gold/steel bevel ring with crisp top highlight
        const bevelSpec = Math.pow(clamp01(0.7 - dx * 0.55 - dy * 0.75), 3) * 0.48;
        cr = cr * 0.85 + rimHex[0] * 0.35 + bevelSpec;
        cg = cg * 0.85 + rimHex[1] * 0.35 + bevelSpec;
        cb = cb * 0.85 + rimHex[2] * 0.35 + bevelSpec;
      } else if (isInnerWell && !isCrystal) {
        // Recessed dark energy well
        const wellGlow = smoothstep(0.52, 0.34, r) * 0.45;
        cr = 0.08 + coreHex[0] * wellGlow;
        cg = 0.11 + coreHex[1] * wellGlow;
        cb = 0.18 + coreHex[2] * wellGlow;
      } else if (isCrystal) {
        // Faceted glowing gemstone core (diamond facets)
        const facet = ((dx > 0 ? 1 : -1) * 0.12 + (dy > 0 ? -1 : 1) * 0.16);
        const coreHot = Math.pow(clamp01(1 - r / 0.36), 1.45);
        const specSpot = smoothstep(0.14, 0.02, Math.hypot(dx + 0.11, dy + 0.12)) * 0.92;
        cr = coreHex[0] * (0.72 + facet + coreHot * 0.65) + specSpot;
        cg = coreHex[1] * (0.72 + facet + coreHot * 0.65) + specSpot;
        cb = coreHex[2] * (0.72 + facet + coreHot * 0.65) + specSpot;
      }

      writePixel(rgba, S, x, y, cr, cg, cb, edgeAlpha);
    }
  }
  return rgba;
}

/**
 * 64x64 ornate Sanctum Astrolabe Core with nested golden rings and luminous heart.
 */
function buildHdSanctumCore(): Uint8Array {
  const S = 64;
  const rgba = new Uint8Array(S * S * 4);
  const cx = S * 0.5;
  const cy = S * 0.5;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - cx) / (S * 0.5);
      const dy = (y + 0.5 - cy) / (S * 0.5);
      const r = Math.hypot(dx, dy);
      if (r > 0.94) continue;

      const ang = Math.atan2(dy, dx);
      const ringOuter = Math.abs(r - 0.80) < 0.085;
      const ringInner = Math.abs(r - 0.54) < 0.065;
      const spoke = (Math.abs(Math.sin(ang * 2)) < 0.11 && r < 0.82 && r > 0.34);
      const core = r <= 0.38;

      if (!ringOuter && !ringInner && !spoke && !core) {
        // Subtle inner radiant halo
        if (r < 0.78) {
          const halo = Math.pow(clamp01(1 - r / 0.78), 2.2) * 0.42;
          writePixel(rgba, S, x, y, 1.0, 0.84, 0.38, halo);
        }
        continue;
      }

      const light = clamp01(0.62 - dx * 0.45 - dy * 0.58);
      if (core) {
        const hot = Math.pow(clamp01(1 - r / 0.38), 1.3);
        const spec = smoothstep(0.14, 0.02, Math.hypot(dx + 0.1, dy + 0.11));
        const a = 1 - smoothstep(0.34, 0.38, r);
        writePixel(
          rgba,
          S,
          x,
          y,
          0.98 * (0.65 + 0.45 * hot) + spec * 0.5,
          0.74 * (0.65 + 0.5 * hot) + spec * 0.5,
          0.24 + hot * 0.55 + spec * 0.5,
          a,
        );
      } else {
        // Brushed gold astrolabe rings
        const spec = Math.pow(light, 3) * 0.55;
        writePixel(
          rgba,
          S,
          x,
          y,
          0.86 * (0.45 + 0.65 * light) + spec,
          0.66 * (0.45 + 0.65 * light) + spec * 0.85,
          0.26 * (0.45 + 0.65 * light) + spec * 0.55,
          0.98,
        );
      }
    }
  }
  return rgba;
}

/**
 * 64x64 glossy translucent amethyst Void Entity with crystalline inner core & specular dome.
 */
function buildHdVoidSlime(): Uint8Array {
  const S = 64;
  const rgba = new Uint8Array(S * S * 4);
  const cx = S * 0.5;
  const cy = S * 0.54;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - cx) / (S * 0.44);
      const dy = (y + 0.5 - cy) / (S * 0.38);
      // Slight dome shape: flatter bottom, rounded crown
      const shapeY = dy > 0 ? dy * 1.18 : dy * 0.92;
      const d = Math.hypot(dx, shapeY);
      if (d > 1.04) continue;

      const edgeA = 1 - smoothstep(0.94, 1.04, d);
      const fresnel = Math.pow(clamp01(d), 2.1);
      const domeLight = clamp01(0.55 - dx * 0.45 - dy * 0.55);
      const glossySpec = smoothstep(0.28, 0.05, Math.hypot(dx + 0.32, dy + 0.38)) * 0.85;
      const innerCore = Math.pow(clamp01(1 - Math.hypot(dx, dy - 0.05) * 1.9), 2.0);

      // Glowing eyes
      const eyeL = smoothstep(0.14, 0.05, Math.hypot(dx + 0.24, dy - 0.02));
      const eyeR = smoothstep(0.14, 0.05, Math.hypot(dx - 0.24, dy - 0.02));
      const eyes = Math.max(eyeL, eyeR);

      let r = 0.46 * (0.45 + 0.65 * domeLight) + fresnel * 0.38 + innerCore * 0.42 + glossySpec;
      let g = 0.22 * (0.45 + 0.65 * domeLight) + fresnel * 0.16 + innerCore * 0.18 + glossySpec;
      let b = 0.78 * (0.45 + 0.65 * domeLight) + fresnel * 0.34 + innerCore * 0.35 + glossySpec;

      if (d > 0.86) {
        r *= 0.45;
        g *= 0.35;
        b *= 0.55;
      }
      if (eyes > 0.05) {
        r = r * (1 - eyes) + 1.0 * eyes;
        g = g * (1 - eyes) + 0.92 * eyes;
        b = b * (1 - eyes) + 0.58 * eyes;
      }

      writePixel(rgba, S, x, y, r, g, b, edgeA * (0.86 + 0.14 * fresnel));
    }
  }
  return rgba;
}

/**
 * 32x32 crisp plasma starlight bolt with hot white core and tapered 4-point flare.
 */
function buildHdStarBolt(): Uint8Array {
  const S = 32;
  const rgba = new Uint8Array(S * S * 4);
  const c = S * 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - c) / (S * 0.5);
      const dy = (y + 0.5 - c) / (S * 0.5);
      const r = Math.hypot(dx, dy);
      if (r > 0.98) continue;
      const core = Math.exp(-r * 3.8);
      const star =
        Math.exp(-Math.abs(dx) * 8.5) * Math.exp(-Math.abs(dy) * 2.1) +
        Math.exp(-Math.abs(dy) * 8.5) * Math.exp(-Math.abs(dx) * 2.1);
      const energy = clamp01(core * 1.15 + star * 0.72) * smoothstep(0.98, 0.18, r);
      if (energy < 0.03) continue;
      writePixel(rgba, S, x, y, 1.0, 0.82 + core * 0.18, 0.32 + core * 0.65, energy);
    }
  }
  return rgba;
}

/**
 * 48x48 faceted gemstone rhythm orb framed in machined brushed metal.
 */
function buildHdBeatOrb(core: [number, number, number]): Uint8Array {
  const S = 48;
  const rgba = new Uint8Array(S * S * 4);
  const c = S * 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - c) / (S * 0.5);
      const dy = (y + 0.5 - c) / (S * 0.5);
      const diamond = Math.abs(dx) + Math.abs(dy);
      const r = Math.hypot(dx, dy);
      if (r > 0.92) continue;

      const isRing = r > 0.64 && r <= 0.86;
      const isGem = diamond <= 0.68;
      if (!isRing && !isGem) continue;

      if (isGem) {
        const shade = 0.65 + (dx < 0 ? 0.18 : -0.1) + (dy < 0 ? 0.22 : -0.12);
        const spec = smoothstep(0.18, 0.03, Math.hypot(dx + 0.16, dy + 0.18)) * 0.88;
        const a = 1 - smoothstep(0.62, 0.68, diamond);
        writePixel(
          rgba,
          S,
          x,
          y,
          core[0] * shade + spec,
          core[1] * shade + spec,
          core[2] * shade + spec,
          a,
        );
      } else {
        const l = clamp01(0.6 - dx * 0.45 - dy * 0.55);
        const a = smoothstep(0.88, 0.82, r) * smoothstep(0.62, 0.68, r);
        writePixel(
          rgba,
          S,
          x,
          y,
          (0.32 + 0.52 * l) * (0.7 + core[0] * 0.3),
          (0.36 + 0.52 * l) * (0.7 + core[1] * 0.3),
          (0.45 + 0.52 * l) * (0.7 + core[2] * 0.3),
          a,
        );
      }
    }
  }
  return rgba;
}

/**
 * 64x64 HD dark slate architectural floor tile with beveled stone borders,
 * subtle micro-grain noise, and inlaid hairline brass astrolabe circuit traces.
 */
function buildHdArenaTile(): Uint8Array {
  const S = 64;
  const rgba = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const edge = Math.min(x, S - 1 - x, y, S - 1 - y);
      const grain = (hash2d(x, y) - 0.5) * 0.035;
      let r = 0.095 + grain;
      let g = 0.132 + grain;
      let b = 0.205 + grain * 1.15;

      // Subtle architectural bevel frame
      if (edge === 0) {
        r *= 0.55;
        g *= 0.55;
        b *= 0.62;
      } else if (edge === 1 && (x < S - 2 && y < S - 2)) {
        r += 0.045;
        g += 0.055;
        b += 0.075;
      } else if (edge === 2) {
        r += 0.015;
        g += 0.02;
        b += 0.03;
      }

      // Subtle inlaid brass astrolabe cross-lines at center & corners
      const nearMid = Math.abs(x - 32) === 0 || Math.abs(y - 32) === 0;
      const innerBox = Math.abs(x - 32) <= 20 && Math.abs(y - 32) <= 20;
      const boxBorder = (Math.abs(x - 32) === 20 || Math.abs(y - 32) === 20) && innerBox;
      if (boxBorder || (nearMid && !innerBox && edge > 6)) {
        r = 0.26;
        g = 0.31;
        b = 0.40;
      }

      // Corner brass rivets
      const cx = Math.abs(x - 32);
      const cy = Math.abs(y - 32);
      if (cx >= 24 && cx <= 26 && cy >= 24 && cy <= 26) {
        r = 0.48;
        g = 0.40;
        b = 0.24;
      }

      writePixel(rgba, S, x, y, r, g, b, 1.0);
    }
  }
  return rgba;
}

let cachedAssets: HdMaterialSpriteAsset[] | null = null;

export function buildHdMaterialSprites(): readonly HdMaterialSpriteAsset[] {
  if (cachedAssets) return cachedAssets;
  cachedAssets = [
    {
      id: 'hd_turret_solar',
      width: 64,
      height: 64,
      rgba: buildHdTurretSprite([1.0, 0.78, 0.22], [0.96, 0.72, 0.24], [0.46, 0.50, 0.58], 4),
    },
    {
      id: 'hd_turret_prism',
      width: 64,
      height: 64,
      rgba: buildHdTurretSprite([0.24, 0.80, 1.0], [0.38, 0.76, 0.98], [0.42, 0.48, 0.58], 6),
    },
    {
      id: 'hd_turret_jade',
      width: 64,
      height: 64,
      rgba: buildHdTurretSprite([0.22, 0.90, 0.62], [0.32, 0.84, 0.58], [0.44, 0.50, 0.54], 4),
    },
    {
      id: 'hd_sanctum_core',
      width: 64,
      height: 64,
      rgba: buildHdSanctumCore(),
    },
    {
      id: 'hd_void_slime',
      width: 64,
      height: 64,
      rgba: buildHdVoidSlime(),
    },
    {
      id: 'hd_star_bolt',
      width: 32,
      height: 32,
      rgba: buildHdStarBolt(),
    },
    {
      id: 'hd_beat_orb_a',
      width: 48,
      height: 48,
      rgba: buildHdBeatOrb([1.0, 0.72, 0.16]),
    },
    {
      id: 'hd_beat_orb_b',
      width: 48,
      height: 48,
      rgba: buildHdBeatOrb([0.24, 0.78, 1.0]),
    },
    {
      id: 'hd_arena_tile',
      width: 64,
      height: 64,
      rgba: buildHdArenaTile(),
    },
  ];
  return cachedAssets;
}
