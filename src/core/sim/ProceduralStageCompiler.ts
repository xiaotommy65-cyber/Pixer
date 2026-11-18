import type { SpriteId } from '../../assets/TextureAtlas.ts';
import {
  buildHueShiftedRamp,
  hexToRgb01Into,
  mixOklabRgb01,
  rgb01ToHex,
} from '../math/ColorMath.ts';
import { fbm2D, hash2i, simplex2D } from '../math/NoiseMath.ts';
import { clamp, type BgParallaxLayerDesc, type TileDesc } from '../types/WorldTypes.ts';
import type { CartridgeStageDef } from './CartridgeSchema.ts';
import {
  COLLISION_CLOUD,
  COLLISION_SOLID,
  TILE_SIZE,
  type TilemapGrid,
} from './TilemapGrid.ts';

export interface ResolvedStageArtMood {
  skyTop: string;
  skyBottom: string;
  ambientColor: string;
  rampHex: readonly string[] | null;
  parallaxFog: number;
}

const RAMP_RGBA_SCRATCH = new Uint8Array(5 * 4);
const FOG_SRC_RGB = new Float32Array(3);
const FOG_DST_RGB = new Float32Array(3);
const FOG_OUT_RGB = new Float32Array(3);

function rgbaByteAtToHex(rgba: Uint8Array, idx: number): string {
  const o = idx * 4;
  return rgb01ToHex(rgba[o] / 255, rgba[o + 1] / 255, rgba[o + 2] / 255);
}

/**
 * Resolves Oklab perceptual palette harmony for a stage at stage-entry time (Zero runtime GC).
 */
export function resolveStageArtMood(st: CartridgeStageDef): ResolvedStageArtMood {
  const mood = st.artMood;
  if (!mood) {
    return {
      skyTop: st.skyTop ?? '#76c7ff',
      skyBottom: st.skyBottom ?? '#fff3df',
      ambientColor: st.ambientColor ?? '#120e24',
      rampHex: null,
      parallaxFog: 0,
    };
  }

  const warmth = clamp(mood.warmth ?? 0, -1, 1);
  const darkHueDeg = 265 - warmth * 35;
  const lightHueDeg = 88 - warmth * 26;
  buildHueShiftedRamp(mood.baseHex, 5, RAMP_RGBA_SCRATCH, {
    darkHueTargetRad: (darkHueDeg * Math.PI) / 180,
    lightHueTargetRad: (lightHueDeg * Math.PI) / 180,
    hueShiftStrength: 0.6,
    lightnessSpan: clamp(mood.contrast ?? 0.66, 0.22, 0.86),
  });

  const rampHex: string[] = [
    rgbaByteAtToHex(RAMP_RGBA_SCRATCH, 0),
    rgbaByteAtToHex(RAMP_RGBA_SCRATCH, 1),
    rgbaByteAtToHex(RAMP_RGBA_SCRATCH, 2),
    rgbaByteAtToHex(RAMP_RGBA_SCRATCH, 3),
    rgbaByteAtToHex(RAMP_RGBA_SCRATCH, 4),
  ];

  const autoSky = mood.autoSky !== false;
  const derivedSkyTop = rampHex[1];
  let derivedSkyBottom = rampHex[4];
  if (mood.accentHex) {
    hexToRgb01Into(rampHex[4], FOG_SRC_RGB, 0);
    hexToRgb01Into(mood.accentHex, FOG_DST_RGB, 0);
    mixOklabRgb01(
      FOG_SRC_RGB[0], FOG_SRC_RGB[1], FOG_SRC_RGB[2],
      FOG_DST_RGB[0], FOG_DST_RGB[1], FOG_DST_RGB[2],
      0.28,
      FOG_OUT_RGB,
      0,
    );
    derivedSkyBottom = rgb01ToHex(FOG_OUT_RGB[0], FOG_OUT_RGB[1], FOG_OUT_RGB[2]);
  }

  return {
    skyTop: st.skyTop ?? (autoSky ? derivedSkyTop : '#76c7ff'),
    skyBottom: st.skyBottom ?? (autoSky ? derivedSkyBottom : '#fff3df'),
    ambientColor: st.ambientColor ?? rampHex[0],
    rampHex,
    parallaxFog: clamp(mood.parallaxFog ?? 0.45, 0, 1),
  };
}

/**
 * Applies Oklab atmospheric perspective haze to parallax layers proportional to depth (1 - scrollX).
 */
export function applyOklabParallaxFog(
  layers: BgParallaxLayerDesc[],
  fogHex: string,
  fogStrength: number,
): void {
  if (fogStrength <= 0 || layers.length === 0) return;
  hexToRgb01Into(fogHex, FOG_DST_RGB, 0);
  for (let i = 0; i < layers.length; i++) {
    const ly = layers[i];
    const depth = clamp(1 - (ly.scrollX ?? 0.35), 0.1, 0.95);
    const blendT = clamp(fogStrength * depth, 0, 0.85);
    hexToRgb01Into(ly.tint ?? '#ffffff', FOG_SRC_RGB, 0);
    mixOklabRgb01(
      FOG_SRC_RGB[0], FOG_SRC_RGB[1], FOG_SRC_RGB[2],
      FOG_DST_RGB[0], FOG_DST_RGB[1], FOG_DST_RGB[2],
      blendT,
      FOG_OUT_RGB,
      0,
    );
    ly.tint = rgb01ToHex(FOG_OUT_RGB[0], FOG_OUT_RGB[1], FOG_OUT_RGB[2]);
  }
}

export interface ProceduralCompileParams {
  stage: CartridgeStageDef;
  worldW: number;
  worldH: number;
  tilemap: TilemapGrid;
  fgExtraTiles: TileDesc[];
  bgParallaxLayers: BgParallaxLayerDesc[];
  mood: ResolvedStageArtMood;
  hasArchetype: (id: string) => boolean;
  pickEnemyArchetype: () => string | null;
  spawnArchetype: (id: string, x: number, y: number) => number;
  onStarSpawned: () => void;
}

/**
 * Compiles a declarative CartridgeProceduralStageDef (FBM/Simplex + Oklab depth layers)
 * directly into TilemapGrid, parallax layers, foreground canopy, and optional deterministic spawns.
 */
export function compileProceduralStage(p: ProceduralCompileParams): void {
  const proc = p.stage.procedural;
  if (!proc) return;

  const cols = Math.ceil(p.worldW / TILE_SIZE);
  const rows = Math.ceil(p.worldH / TILE_SIZE);
  const seed = proc.seed | 0;
  const biome = proc.biome ?? 'meadow';

  const defaultAmp = biome === 'alpine' ? 5 : biome === 'sky_islands' ? 4 : 3;
  const defaultFreq = biome === 'alpine' ? 0.065 : biome === 'cyber_ruins' ? 0.08 : 0.055;
  const defaultGap = biome === 'sky_islands' ? 0.36 : biome === 'cyber_ruins' ? 0.2 : 0.12;
  const defaultPlat = biome === 'sky_islands' ? 0.58 : biome === 'cavern' ? 0.45 : 0.35;
  const defaultCave = biome === 'cavern' ? 0.44 : biome === 'alpine' ? 0.16 : biome === 'cyber_ruins' ? 0.2 : 0;

  const hillAmp = clamp(proc.hillAmplitude ?? defaultAmp, 0, Math.max(1, rows - 4));
  const freq = clamp(proc.frequency ?? defaultFreq, 0.005, 0.8);
  const octaves = Math.round(clamp(proc.octaves ?? 3, 1, 6));
  const gapChance = clamp(proc.gapChance ?? defaultGap, 0, 0.55);
  const platformDensity = clamp(proc.platformDensity ?? defaultPlat, 0, 1);
  const caveCarve = clamp(proc.caveCarve ?? defaultCave, 0, 1);
  const safeMargin = Math.round(clamp(proc.safeMarginCols ?? 4, 1, 20));
  const parallaxBands = Math.round(clamp(proc.parallaxBands ?? 2, 0, 4));
  const wantCanopy = proc.foregroundCanopy ?? (biome === 'meadow' || biome === 'alpine' || biome === 'sky_islands');

  const spawnCol = clamp(Math.floor((p.stage.spawn.x + 8) / TILE_SIZE), 0, cols - 1);
  const spawnGroundRow = clamp(Math.ceil((p.stage.spawn.y + 16) / TILE_SIZE), 3, rows - 1);
  const baseSurface = clamp(Math.round(proc.surfaceRow ?? spawnGroundRow), 3, rows - 2);

  // Preserve safe solid footing around explicit key/gate spawns
  const protectedCols = new Uint8Array(cols);
  for (let c = Math.max(0, spawnCol - safeMargin); c <= Math.min(cols - 1, spawnCol + safeMargin); c++) {
    protectedCols[c] = 1;
  }
  for (const sp of p.stage.spawns ?? []) {
    const sc = clamp(Math.floor((sp.x + 8) / TILE_SIZE), 0, cols - 1);
    for (let c = Math.max(0, sc - 1); c <= Math.min(cols - 1, sc + 1); c++) {
      protectedCols[c] = 2;
    }
  }

  const surfaceRows = new Int16Array(cols).fill(-1);
  for (let c = 0; c < cols; c++) {
    const n = fbm2D(c * freq, 0.37, octaves, 2.02, 0.5, seed);
    let r = clamp(Math.round(baseSurface + n * hillAmp), 3, rows - 2);

    const distSpawn = Math.abs(c - spawnCol);
    if (distSpawn <= safeMargin) {
      const blend = distSpawn / Math.max(1, safeMargin);
      r = Math.round(spawnGroundRow * (1 - blend * 0.45) + r * (blend * 0.45));
      surfaceRows[c] = clamp(r, 3, rows - 2);
      continue;
    }

    const chasmRoll = hash2i(c >> 1, 7, seed);
    if (protectedCols[c] === 0 && chasmRoll < gapChance) {
      surfaceRows[c] = -1;
    } else {
      surfaceRows[c] = r;
    }
  }

  const topTid = biome === 'cyber_ruins' || biome === 'cavern' ? 6 : 1;
  const fillTid = biome === 'cyber_ruins' || biome === 'alpine' ? 6 : 2;
  const rockThreshold = 1 - caveCarve * 1.15;

  for (let c = 0; c < cols; c++) {
    const topR = surfaceRows[c];
    if (topR < 0) continue;

    p.tilemap.setTile(c, topR, topTid, COLLISION_SOLID, false);
    const maxFillRow = biome === 'sky_islands' ? Math.min(rows - 1, topR + 2 + ((hash2i(c, 19, seed) * 3) | 0)) : rows - 1;
    for (let r = topR + 1; r <= maxFillRow; r++) {
      if (caveCarve > 0 && r > topR + 1 && r < rows - 1 && protectedCols[c] === 0) {
        const caveVal = fbm2D(c * freq * 1.45, r * freq * 1.45, 2, 2.0, 0.5, seed + 513);
        if (caveVal > rockThreshold) continue;
      }
      const tid = r >= topR + 3 ? 6 : fillTid;
      p.tilemap.setTile(c, r, tid, COLLISION_SOLID, false);
    }

    if (biome === 'cavern' && protectedCols[c] === 0) {
      const roofDepth = 1 + Math.max(0, Math.round(fbm2D(c * freq * 1.2, 4.1, 2, 2, 0.5, seed + 77) * 1.8));
      const safeRoofMax = Math.max(0, topR - 4);
      for (let r = 0; r < Math.min(roofDepth, safeRoofMax); r++) {
        p.tilemap.setTile(c, r, 6, COLLISION_SOLID, false);
      }
    }
  }

  // Bridge chasms & place floating FBM stepping platforms
  let gapRun = 0;
  for (let c = 0; c < cols; c++) {
    if (surfaceRows[c] < 0) {
      gapRun++;
      if (gapRun === 3 || (gapRun > 3 && gapRun % 4 === 2)) {
        const bridgeRow = clamp(baseSurface - 1, 2, rows - 3);
        const startBridge = Math.max(0, c - 1);
        for (let bc = startBridge; bc <= Math.min(cols - 1, startBridge + 2); bc++) {
          const tid = bc === startBridge ? 3 : bc === startBridge + 2 ? 5 : 4;
          p.tilemap.setTile(bc, bridgeRow, tid, COLLISION_CLOUD, false);
        }
      }
    } else {
      gapRun = 0;
      if (platformDensity > 0 && c > 2 && c < cols - 3 && c % 7 === 0) {
        const pVal = simplex2D(c * 0.19, 3.1, seed + 99);
        if (pVal > 1 - platformDensity * 1.45) {
          const platRow = clamp(surfaceRows[c] - 3 - ((hash2i(c, 31, seed) * 2) | 0), 2, rows - 4);
          if (p.tilemap.getCollision(c, platRow) === 0 && p.tilemap.getCollision(c + 1, platRow) === 0) {
            p.tilemap.setTile(c, platRow, 3, COLLISION_CLOUD, false);
            p.tilemap.setTile(c + 1, platRow, 4, COLLISION_CLOUD, false);
            p.tilemap.setTile(c + 2, platRow, 5, COLLISION_CLOUD, false);
          }
        }
      }
    }
  }

  // Generate multi-depth Oklab-tinted parallax silhouettes
  if (parallaxBands > 0) {
    const bandConfigs: readonly { sprite: SpriteId; yFrac: number; w: number; h: number; scrollX: number; scrollY: number; stepX: number; alpha: number; rampIdx: number }[] = [
      {
        sprite: biome === 'cavern' || biome === 'cyber_ruins' ? 'stone' : 'cloud_m',
        yFrac: 0.22,
        w: 64,
        h: 32,
        scrollX: 0.14,
        scrollY: 0.1,
        stepX: 96,
        alpha: 0.56,
        rampIdx: 3,
      },
      {
        sprite: biome === 'sky_islands' ? 'cloud_l' : 'stone',
        yFrac: 0.48,
        w: 56,
        h: 48,
        scrollX: 0.28,
        scrollY: 0.18,
        stepX: 72,
        alpha: 0.68,
        rampIdx: 1,
      },
      {
        sprite: biome === 'meadow' || biome === 'alpine' ? 'tree_canopy' : 'dirt',
        yFrac: 0.64,
        w: 44,
        h: 38,
        scrollX: 0.44,
        scrollY: 0.24,
        stepX: 60,
        alpha: 0.78,
        rampIdx: 2,
      },
      {
        sprite: 'cloud_m',
        yFrac: 0.12,
        w: 48,
        h: 22,
        scrollX: 0.54,
        scrollY: 0.28,
        stepX: 112,
        alpha: 0.44,
        rampIdx: 4,
      },
    ];

    for (let b = 0; b < parallaxBands; b++) {
      const cfg = bandConfigs[b];
      const tint = p.mood.rampHex ? p.mood.rampHex[cfg.rampIdx] : undefined;
      p.bgParallaxLayers.push({
        sprite: cfg.sprite,
        x: (b * 23) % 48,
        y: Math.round(p.worldH * cfg.yFrac),
        w: cfg.w,
        h: cfg.h,
        scrollX: cfg.scrollX,
        scrollY: cfg.scrollY,
        repeatW: p.worldW,
        repeatStepX: cfg.stepX,
        tint,
        alpha: cfg.alpha,
      });
    }
  }

  // Foreground canopy / framing props
  if (wantCanopy) {
    const fgSprite: SpriteId = biome === 'cyber_ruins' ? 'stone' : 'tree_canopy';
    const fgTint = p.mood.rampHex ? p.mood.rampHex[1] : undefined;
    for (let c = 2; c < cols - 2; c += 6) {
      if (Math.abs(c - spawnCol) <= 2) continue;
      if (hash2i(c, 53, seed) < 0.58 && surfaceRows[c] >= 4) {
        const fgY = Math.max(0, (surfaceRows[c] - 3) * TILE_SIZE);
        p.fgExtraTiles.push({
          sprite: fgSprite,
          x: c * TILE_SIZE,
          y: fgY,
          w: 24,
          h: 24,
          tint: fgTint,
          alpha: 0.88,
          elevationZ: 4,
        });
      }
    }
  }

  // Optional deterministic entity spawns from procedural rule
  const autoSpawns = proc.autoSpawns;
  if (autoSpawns) {
    if (autoSpawns.stars && autoSpawns.stars > 0 && p.hasArchetype('star')) {
      const targetStars = Math.min(32, Math.round(autoSpawns.stars));
      const stride = Math.max(2, Math.floor((cols - 4) / targetStars));
      let placed = 0;
      for (let c = 3; c < cols - 2 && placed < targetStars; c += stride) {
        if (Math.abs(c - spawnCol) <= 1) continue;
        const sr = surfaceRows[c];
        const y = sr >= 2 ? (sr - 2) * TILE_SIZE : clamp(baseSurface - 3, 2, rows - 4) * TILE_SIZE;
        if (p.spawnArchetype('star', c * TILE_SIZE + 2, y) >= 0) {
          p.onStarSpawned();
          placed++;
        }
      }
    }

    if (autoSpawns.enemies && autoSpawns.enemies > 0) {
      const enemyId = p.pickEnemyArchetype();
      if (enemyId) {
        const targetEnemies = Math.min(24, Math.round(autoSpawns.enemies));
        const stride = Math.max(3, Math.floor((cols - safeMargin * 2) / Math.max(1, targetEnemies)));
        let placed = 0;
        for (let c = safeMargin + 3; c < cols - 3 && placed < targetEnemies; c += stride) {
          if (Math.abs(c - spawnCol) <= safeMargin) continue;
          const sr = surfaceRows[c];
          if (sr >= 3) {
            p.spawnArchetype(enemyId, c * TILE_SIZE, (sr - 1) * TILE_SIZE);
            placed++;
          }
        }
      }
    }

    if (autoSpawns.torches && autoSpawns.torches > 0 && p.hasArchetype('torch')) {
      const targetTorches = Math.min(24, Math.round(autoSpawns.torches));
      const stride = Math.max(3, Math.floor((cols - 4) / targetTorches));
      let placed = 0;
      for (let c = 2; c < cols - 2 && placed < targetTorches; c += stride) {
        const sr = surfaceRows[c];
        if (sr >= 2) {
          p.spawnArchetype('torch', c * TILE_SIZE, (sr - 1) * TILE_SIZE);
          placed++;
        }
      }
    }
  }
}
