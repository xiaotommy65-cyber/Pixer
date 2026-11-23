import type { GpuEngine } from '../gpu/GpuEngine.ts';
import {
  composeOrthogonalBlueprintInto,
  type OrthogonalArtBlueprint,
  type OrthogonalFacing,
  type OrthogonalPose,
  type ResolvedLayerInstance,
} from '../sim/OrthogonalArt.ts';

/**
 * Renders a multi-layer OrthogonalArt blueprint onto the 2D GPU batch using a pre-allocated layer pool.
 */
export function drawOrthogonalBlueprintScreen(
  gpu: GpuEngine,
  composedPool: ResolvedLayerInstance[],
  frameTimeSec: number,
  bp: OrthogonalArtBlueprint,
  facing: OrthogonalFacing,
  pose: OrthogonalPose,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  flipX: boolean,
  rot: number,
  alpha: number,
  flash: number,
  skewX: number,
  anchorY: number,
  paletteRowOverride: number | undefined,
  tintOverride: string | undefined,
): void {
  const animToggle = (Math.floor(frameTimeSec * 4) & 1) === 1;
  const layerCount = composeOrthogonalBlueprintInto(
    bp,
    facing,
    pose,
    paletteRowOverride,
    flipX,
    animToggle,
    composedPool,
  );
  for (let i = 0; i < layerCount; i++) {
    const ly = composedPool[i];
    gpu.drawSpriteRaw(
      ly.sprite,
      sx + ly.ox * sw,
      sy + ly.oy * sh,
      sw * ly.scaleX,
      sh * ly.scaleY,
      ly.flipX,
      rot + ly.rot,
      tintOverride ?? ly.tint,
      alpha * ly.alpha,
      flash,
      ly.additive,
      0.5,
      anchorY,
      skewX,
      ly.paletteRow,
      ly.emissive,
    );
  }
}
