import { encodeRgbaToZlibB64 } from '../ecs/EcsCustomSpriteCompiler.ts';
import type { EcsCustomSpriteDef } from '../ecs/EcsProjectSchema.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import { sanitizeInteropId } from './InteropTypes.ts';
import {
  detectEmissiveLightFromRgba,
  synthesizeWallTopCapRgba,
  type PixelForgeOptions,
  type PixelForgeOutput,
  type PixelForgePreviewFrame,
} from './PixelForgeBakeProfiles.ts';
import {
  applyRgbaOutline,
  clampPixelForgeDim,
  cropOpaqueBoundsRgba,
  detectPixelBlockSize,
  downscaleToPixelGridRgba,
  quantizeRgbaOklab,
  stripEdgeBackgroundRgba,
} from './PixelForgeQuantizer.ts';

export {
  buildPixelForgeCommitCommands,
  detectEmissiveLightFromRgba,
  PIXEL_FORGE_BAKING_PROFILES,
  synthesizeWallTopCapRgba,
  type PixelForgeBakingProfileDef,
  type PixelForgeBakingProfileId,
  type PixelForgeCommitOptions,
  type PixelForgeDetectedLight,
  type PixelForgeOptions,
  type PixelForgeOutput,
  type PixelForgePreviewFrame,
} from './PixelForgeBakeProfiles.ts';
export {
  applyRgbaOutline,
  cropOpaqueBoundsRgba,
  detectPixelBlockSize,
  downscaleToPixelGridRgba,
  PIXEL_FORGE_PALETTES,
  quantizeRgbaOklab,
  stripEdgeBackgroundRgba,
  type PixelForgeColorMode,
  type PixelForgeDownscaleMode,
  type PixelForgePaletteDef,
  type PixelForgePaletteId,
} from './PixelForgeQuantizer.ts';

function sliceSubRgba(
  rgba: Uint8Array,
  srcW: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Uint8Array {
  const out = new Uint8Array(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const start = ((sy + y) * srcW + sx) * 4;
    out.set(rgba.subarray(start, start + sw * 4), y * sw * 4);
  }
  return out;
}

/**
 * Full DOM-free Pixel Forge pipeline: converts any external/AI RGBA buffer into crisp `8..256`
 * lossless zlib `EcsCustomSpriteDef` assets (single sprites, portraits, wall top/side pairs, or sliced animated sheets).
 */
export function forgeImageToCustomSprites(
  input: { id: string; name?: string; rgba: Uint8Array; width: number; height: number },
  opts: PixelForgeOptions,
): PixelForgeOutput {
  const baseId = sanitizeInteropId(opts.id || input.id, 'forged_sprite', 48);
  const displayName = (opts.name || input.name || baseId).trim();
  const targetW = clampPixelForgeDim(opts.targetWidth);
  const targetH = clampPixelForgeDim(opts.targetHeight);
  const downMode = opts.downscaleMode ?? 'grid_majority';
  const colorMode = opts.colorMode ?? 'adaptive_kmeans';
  const preserveAspect = opts.preserveAspect !== false;
  const cols = Math.max(1, Math.min(16, Math.round(opts.sheetCols ?? 1)));
  const rows = Math.max(1, Math.min(16, Math.round(opts.sheetRows ?? 1)));

  let workRgba: Uint8Array = new Uint8Array(Math.max(1, input.width) * Math.max(1, input.height) * 4);
  workRgba.set(input.rgba.subarray(0, workRgba.length));
  let workW = Math.max(1, Math.floor(input.width));
  let workH = Math.max(1, Math.floor(input.height));

  if (opts.stripBackground !== false) {
    workRgba = stripEdgeBackgroundRgba(workRgba, workW, workH, opts.bgTolerance ?? 48);
  }

  const isSheet = cols > 1 || rows > 1;
  if (!isSheet && opts.cropOpaque !== false) {
    const cropped = cropOpaqueBoundsRgba(workRgba, workW, workH, 0);
    workRgba = cropped.rgba;
    workW = cropped.width;
    workH = cropped.height;
  }

  const detectedBlockSize = detectPixelBlockSize(workRgba, workW, workH);
  const sprites: EcsCustomSpriteDef[] = [];
  const previewFrames: PixelForgePreviewFrame[] = [];

  const pushEncoded = (frameId: string, frameName: string, forged: Uint8Array): void => {
    sprites.push({
      id: frameId,
      name: frameName,
      width: targetW,
      height: targetH,
      kind: 'rgba_b64',
      rgbaB64: encodeRgbaToZlibB64(forged),
    });
    previewFrames.push({ id: frameId, width: targetW, height: targetH, rgba: forged });
  };

  const processCell = (cellRgba: Uint8Array, cw: number, ch: number, frameId: string, frameName: string): Uint8Array => {
    let forged = downscaleToPixelGridRgba(cellRgba, cw, ch, targetW, targetH, downMode, preserveAspect);
    forged = quantizeRgbaOklab(forged, targetW, targetH, {
      colorMode,
      maxColors: opts.maxColors,
      paletteId: opts.paletteId,
      customPalette: opts.customPalette,
      dither: opts.dither,
    });
    if (opts.outlineHex) {
      forged = applyRgbaOutline(forged, targetW, targetH, opts.outlineHex);
    }
    pushEncoded(frameId, frameName, forged);
    return forged;
  };

  if (!isSheet) {
    if (opts.bakingProfile === 'wall_top_side') {
      const sideRgba = downscaleToPixelGridRgba(workRgba, workW, workH, targetW, targetH, downMode, preserveAspect);
      const qSide = quantizeRgbaOklab(sideRgba, targetW, targetH, {
        colorMode,
        maxColors: opts.maxColors,
        paletteId: opts.paletteId,
        customPalette: opts.customPalette,
        dither: opts.dither,
      });
      const topRgba = synthesizeWallTopCapRgba(qSide, targetW, targetH);
      const topId = sanitizeInteropId(`${baseId}_top`, 'wall_top', 48);
      const sideId = sanitizeInteropId(`${baseId}_side`, 'wall_side', 48);
      pushEncoded(topId, `${displayName} (牆頂)`, topRgba);
      pushEncoded(sideId, `${displayName} (牆側)`, qSide);
      return {
        sprites,
        animations: [],
        detectedBlockSize,
        previewFrames,
        bakingProfile: opts.bakingProfile,
        wallSideSpriteId: sideId,
      };
    }

    const forged = processCell(workRgba, workW, workH, baseId, displayName);
    const detectedLight = detectEmissiveLightFromRgba(forged, targetW, targetH);
    return {
      sprites,
      animations: [],
      detectedBlockSize,
      previewFrames,
      bakingProfile: opts.bakingProfile,
      detectedLight,
    };
  }

  const cellW = Math.max(1, Math.floor(workW / cols));
  const cellH = Math.max(1, Math.floor(workH / rows));
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = sliceSubRgba(workRgba, workW, c * cellW, r * cellH, cellW, cellH);
      processCell(cell, cellW, cellH, `${baseId}_f${idx}`, `${displayName} #${idx + 1}`);
      idx++;
    }
  }

  if (opts.bakingProfile === 'wall_top_side' && sprites.length >= 2) {
    return {
      sprites,
      animations: [],
      detectedBlockSize,
      previewFrames,
      bakingProfile: opts.bakingProfile,
      wallSideSpriteId: sprites[1].id,
    };
  }

  const animations: AnimationStateMachineDef[] = [];
  if (sprites.length >= 2) {
    const frameIds = sprites.map((s) => s.id);
    animations.push({
      id: sanitizeInteropId(`anim_${baseId}`, 'anim_forged', 56),
      initialState: 'idle',
      clips: [
        { name: 'idle', frames: frameIds.slice(0, Math.min(2, frameIds.length)), fps: 4, loop: true },
        { name: 'walk', frames: frameIds, fps: 8, loop: true },
      ],
      transitions: [
        { from: 'idle', to: 'walk', param: 'speed', op: 'gt', value: 10, priority: 1 },
        { from: 'walk', to: 'idle', param: 'speed', op: 'lte', value: 10, priority: 1 },
      ],
    });
  }

  const detectedLight = previewFrames[0]
    ? detectEmissiveLightFromRgba(previewFrames[0].rgba, previewFrames[0].width, previewFrames[0].height)
    : undefined;

  return {
    sprites,
    animations,
    detectedBlockSize,
    previewFrames,
    bakingProfile: opts.bakingProfile,
    detectedLight,
  };
}
