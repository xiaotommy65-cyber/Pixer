import type { GpuEngine } from '../gpu/GpuEngine.ts';
import {
  computeCamera3D,
  createComputedCamera3D,
  projectWorld3DToScreen,
} from '../math/Perspective3DMath.ts';
import {
  composeOrthogonalBlueprintInto,
  getOrthogonalBlueprint,
  type OrthogonalArtBlueprint,
  type ResolvedLayerInstance,
} from '../sim/OrthogonalArt.ts';
import type { Hd2dDepthConfig, RenderSceneSnapshot } from '../types/WorldTypes.ts';

/**
 * Octopath Traveler-style True 3D Perspective HD-2D Scene Pass.
 * Extrudes 2D wall tiles into neighbor-culled 3D pixel boxes and stands actors/props as upright pixel billboards
 * with hardware depth buffering, unified 3D N·L point lighting, and world-space 2D wall shadow occlusion.
 */
export class SceneTrue3DPass {
  private readonly cam3dScratch = createComputedCamera3D();
  private readonly proj3dOut = { x: 0, y: 0, scale: 1, depth: 0, visible: true };

  public projectScreenX(wx: number, wy: number): number {
    projectWorld3DToScreen(wx, wy, 0, this.cam3dScratch, this.proj3dOut);
    return this.proj3dOut.x;
  }

  public projectScreenY(wx: number, wy: number, wz = 0): number {
    projectWorld3DToScreen(wx, wy, wz, this.cam3dScratch, this.proj3dOut);
    return this.proj3dOut.y;
  }

  public render(
    gpu: GpuEngine,
    snap: RenderSceneSnapshot,
    hd2d: Hd2dDepthConfig,
    camCenterX: number,
    camCenterY: number,
    zoom: number,
    viewW: number,
    viewH: number,
    defaultPaletteRow: number,
    frameTimeSec: number,
    activeCustomBlueprints: Readonly<Record<string, OrthogonalArtBlueprint>> | undefined,
    composedPool: ResolvedLayerInstance[],
  ): void {
    const pitchDeg = hd2d.pitchDeg ?? 42;
    const fovDeg = hd2d.fovDeg ?? 38;
    const wallHeightScale = hd2d.wallHeightScale ?? 1.25;
    const tiltDeg = hd2d.billboardTiltDeg ?? 12;
    const obliqueShadowAlpha = hd2d.obliqueShadowAlpha ?? 0.42;

    computeCamera3D(
      {
        camCenterX,
        camCenterY,
        zoom,
        pitchDeg,
        fovDeg,
        viewW,
        viewH,
      },
      this.cam3dScratch,
    );

    const occ = snap.occlusion;
    const occStrength = occ?.shadowStrength ?? 0.86;
    gpu.setCamera3D(
      camCenterX,
      camCenterY,
      zoom,
      pitchDeg,
      fovDeg,
      occ?.originX ?? 0,
      occ?.originY ?? 0,
      occ?.tileSize ?? 32,
    );
    if (occ && occ.cols > 0 && occ.rows > 0 && occStrength > 0.001) {
      gpu.setOcclusionGrid(
        occ.cols,
        occ.rows,
        0,
        0,
        occ.tileSize,
        occ.data,
        occ.version,
        occStrength,
        occ.shadowSoftness ?? 0.36,
      );
    }

    // Subtle ambient dimming baked into floor/wall shadeMult so torches glow richly out of shadow
    const ambDim = 1 - Math.min(0.42, (snap.ambientDarkness ?? 0) * 0.58);
    const cullHalfW = (viewW / Math.max(0.25, zoom)) * 1.25 + 160;
    const cullHalfH = (viewH / Math.max(0.25, zoom)) * 1.65 + 220;

    // 1. Dynamic point lights in world space (shared by 3D walls, floors, and billboards)
    for (let i = 0; i < snap.lights.length; i++) {
      const l = snap.lights[i];
      if (
        Math.abs(l.x - camCenterX) > cullHalfW + l.radius ||
        Math.abs(l.y - camCenterY) > cullHalfH + l.radius
      ) {
        continue;
      }
      const falloff = l.falloffPower ?? 2.0;
      gpu.pushDynamicLight(l.x, l.y, l.radius, l.color, l.intensity * 1.12, falloff);
      gpu.drawLight3D(l.x, l.y, 0.45, l.radius, l.color, l.intensity * 0.34, falloff);
    }

    // 2. 3D Floor Tiles, Flat/Tall Decor & Neighbor-Culled Extruded 3D Wall Boxes
    for (let i = 0; i < snap.tiles.length; i++) {
      const t = snap.tiles[i];
      const cx = t.x + t.w * 0.5;
      const cy = t.y + t.h * 0.5;
      if (Math.abs(cx - camCenterX) > cullHalfW || Math.abs(cy - camCenterY) > cullHalfH) {
        continue;
      }
      const extrudeH = t.extrudeH ?? 0;
      const elevZ = t.elevationZ ?? 0;

      if (extrudeH > 0) {
        const wallH = extrudeH * wallHeightScale;
        const rawSide = t.sideSprite ?? t.sprite;
        const sideId = rawSide === 'solid' ? null : rawSide;
        gpu.drawBox3DWall(
          t.sprite,
          sideId,
          t.x,
          t.y,
          t.w,
          t.h,
          elevZ,
          wallH,
          t.autoMask ?? 0,
          t.tint,
          t.wallColor,
          t.alpha ?? 1,
          defaultPaletteRow,
          t.roughness ?? 0.56,
          t.metallic ?? 0.1,
          t.castShadow === false ? 0 : obliqueShadowAlpha,
          t.emissive ?? 0,
        );
      } else if (elevZ > 0 || t.h > t.w) {
        // Tall decorative prop (columns, torches, trees, banners) stands upright in 3D space
        const footX = t.x + t.w * 0.5;
        const footY = t.y + t.h;
        if (t.castShadow !== false) {
          gpu.drawGroundShadow3D(footX, footY - 3, 0.25, t.w * 0.92, t.w * 0.46, '#0c0816', 0.42, 0.66);
        }
        const sway =
          (t.windSway ?? 0) > 0
            ? Math.sin(frameTimeSec * 2.3 + t.x * 0.08) * 3.5 * (t.windSway ?? 0.8)
            : 0;
        gpu.drawBillboard3D(
          t.sprite,
          footX,
          footY,
          0,
          t.w,
          t.h,
          tiltDeg,
          t.flipX ?? false,
          t.tint,
          t.alpha ?? 1,
          0,
          false,
          defaultPaletteRow,
          t.emissive ?? 0,
          t.roughness ?? 0.55,
          t.metallic ?? 0.1,
          sway,
          true,
        );
      } else {
        const zFloor = (t.sortY ?? -1000) > -950 ? 0.16 : 0;
        gpu.drawFloorTile3D(
          t.sprite,
          t.x,
          t.y,
          t.w,
          t.h,
          zFloor,
          t.tint,
          t.alpha ?? 1,
          defaultPaletteRow,
          0.98 * ambDim,
          t.roughness ?? 0.66,
          t.metallic ?? 0.06,
          t.emissive ?? 0,
        );
      }
    }

    // 3. 3D Actors, Bosses, Props & Melee Slash Billboards + Grounded Contact Shadows
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i];
      const footX = e.x + e.w * 0.5;
      const footY = e.y + e.h;
      if (Math.abs(footX - camCenterX) > cullHalfW || Math.abs(footY - camCenterY) > cullHalfH) {
        continue;
      }
      const footZ = e.elevationZ ?? 0;
      const drawW = e.w * (e.scaleX ?? 1);
      const drawH = e.h * (e.scaleY ?? 1);

      if (e.castShadow !== false && !e.additive) {
        const zFactor = 1 / (1 + Math.max(0, footZ) * 0.04);
        const r = (e.shadowRadius ?? e.w * 0.44) * zFactor;
        gpu.drawGroundShadow3D(
          footX,
          footY + (e.shadowOffsetY ?? 0) - 2,
          0.25,
          Math.max(8, r * 2.25),
          Math.max(5, r * 1.15),
          '#0c0816',
          Math.max(0.16, 0.46 * zFactor),
          0.66,
        );
      }

      if (e.artBlueprintId) {
        const bp = getOrthogonalBlueprint(e.artBlueprintId, activeCustomBlueprints);
        if (bp) {
          const animToggle = (Math.floor(frameTimeSec * 4) & 1) === 1;
          const layerCount = composeOrthogonalBlueprintInto(
            bp,
            e.artFacing ?? 'front',
            e.artPose ?? 'idle',
            e.paletteRow,
            e.flipX ?? false,
            animToggle,
            composedPool,
          );
          for (let li = 0; li < layerCount; li++) {
            const ly = composedPool[li];
            gpu.drawBillboard3D(
              ly.sprite,
              footX + ly.ox * drawW,
              footY + li * 0.15,
              footZ - ly.oy * drawH,
              drawW * ly.scaleX,
              drawH * ly.scaleY,
              tiltDeg,
              ly.flipX,
              e.tint ?? ly.tint,
              (e.alpha ?? 1) * ly.alpha,
              e.flash ?? 0,
              ly.additive,
              ly.paletteRow,
              ly.emissive,
              e.roughness ?? 0.48,
              e.metallic ?? 0.12,
              (e.skewX ?? 0) * drawH * 0.45,
              !ly.additive,
            );
          }
          continue;
        }
      }

      const swayX = (e.skewX ?? 0) * drawH * 0.45;
      gpu.drawBillboard3D(
        e.sprite,
        footX,
        footY,
        footZ,
        drawW,
        drawH,
        e.additive ? 34 : tiltDeg,
        e.flipX ?? false,
        e.tint,
        e.alpha ?? 1,
        e.flash ?? 0,
        e.additive ?? false,
        e.paletteRow ?? defaultPaletteRow,
        e.emissive ?? (e.additive ? 0.9 : 0),
        e.roughness ?? 0.48,
        e.metallic ?? 0.12,
        swayX,
        !e.additive,
      );
    }

    // 4. 3D Floating Particles (sparks, dust, embers, magic bursts)
    for (let i = 0; i < snap.particles.length; i++) {
      const p = snap.particles[i];
      if (Math.abs(p.x - camCenterX) > cullHalfW || Math.abs(p.y - camCenterY) > cullHalfH) {
        continue;
      }
      const lifeRatio = Math.max(0, Math.min(1, p.life / Math.max(0.01, p.maxLife)));
      const alpha = 1 - lifeRatio;
      const pz = 8 + lifeRatio * 14;
      if (p.sprite) {
        gpu.drawBillboard3D(
          p.sprite,
          p.x,
          p.y,
          pz,
          p.size,
          p.size,
          24,
          false,
          p.color,
          alpha,
          0,
          p.additive ?? true,
          0,
          (p.additive ?? true) ? 0.9 : 0,
          0.5,
          0,
          0,
          false,
        );
      } else {
        gpu.drawParticle3D(p.x, p.y, pz, Math.max(2, p.size * 1.15), p.color, alpha, p.additive ?? false, p.additive ? 0.95 : 0.15);
      }
    }
  }
}
