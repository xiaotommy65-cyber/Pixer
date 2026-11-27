import { emitModel3DToGpu } from '../ecs/EcsModel3D.ts';
import type { GpuEngine } from '../gpu/GpuEngine.ts';
import { FACE_CULL_TOP, type CardinalFacing3D } from '../gpu/GpuMesh3DBatch.ts';
import {
  computeCamera3D,
  createComputedCamera3D,
  projectWorld3DToScreen,
} from '../math/Perspective3DMath.ts';
import {
  composeOrthogonalBlueprintInto,
  getOrthogonalBlueprint,
  type OrthogonalArtBlueprint,
  type OrthogonalFacing,
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
    const yawDeg = hd2d.yawDeg ?? 0;
    const rollDeg = hd2d.rollDeg ?? 0;
    const camCenterZ = hd2d.camCenterZ ?? 0;
    const projection = hd2d.cameraProjection3d ?? 'perspective';
    const fovDeg = hd2d.fovDeg ?? 38;
    const wallHeightScale = hd2d.wallHeightScale ?? 1.25;
    const tiltDeg = hd2d.billboardTiltDeg ?? 12;
    const effectiveTilt =
      projection === 'ortho_top'
        ? 74
        : projection === 'ortho_front' || projection === 'ortho_side'
          ? 0
          : tiltDeg;
    const obliqueShadowAlpha = hd2d.obliqueShadowAlpha ?? 0.42;

    computeCamera3D(
      {
        camCenterX,
        camCenterY,
        camCenterZ,
        zoom,
        yawDeg,
        pitchDeg,
        rollDeg,
        fovDeg,
        projection,
        viewW,
        viewH,
      },
      this.cam3dScratch,
    );

    const occ = snap.occlusion;
    const occStrength = occ?.shadowStrength ?? 0.86;
    gpu.setQuadViewEnabled(Boolean(hd2d.quadView));
    gpu.setCamera3D(
      camCenterX,
      camCenterY,
      zoom,
      pitchDeg,
      fovDeg,
      occ?.originX ?? 0,
      occ?.originY ?? 0,
      occ?.tileSize ?? 32,
      yawDeg,
      rollDeg,
      camCenterZ,
      projection,
    );
    const sunDir = hd2d.sunDir;
    gpu.setSunLight3D(
      sunDir ? sunDir[0] : -0.38,
      sunDir ? sunDir[1] : 0.48,
      sunDir ? sunDir[2] : 0.79,
      hd2d.shadowMapEnabled !== false,
      hd2d.shadowMapStrength ?? 0.45,
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
    const cutawayActive = Boolean(hd2d.cutawayActive) && !hd2d.quadView && hd2d.cutawayPlaneZ !== undefined;
    const cutawayPlaneZ = hd2d.cutawayPlaneZ ?? 99999;
    const cutawayAlpha = Math.max(0, Math.min(1, hd2d.cutawayAlpha ?? hd2d.roofCutawayAlpha ?? 0.18));

    // 1. Dynamic 3D point lights in world space (shared by Mesh3D, 3D walls, floors, and billboards)
    for (let i = 0; i < snap.lights.length; i++) {
      const l = snap.lights[i];
      if (
        Math.abs(l.x - camCenterX) > cullHalfW + l.radius ||
        Math.abs(l.y - camCenterY) > cullHalfH + l.radius
      ) {
        continue;
      }
      const falloff = l.falloffPower ?? 2.0;
      const lz = l.z ?? 24;
      const lightFloorZ = Math.max(0, lz - 24);
      const lightCutaway = cutawayActive && lightFloorZ >= cutawayPlaneZ - 0.5;
      gpu.pushDynamicLight3D(l.x, l.y, lz, l.radius, l.color, l.intensity * 1.12, falloff);
      if (!lightCutaway || cutawayAlpha > 0.01) {
        const glowScale = lightCutaway ? cutawayAlpha : 1;
        gpu.drawLight3D(l.x, l.y, Math.max(0.45, lightFloorZ + 0.45), l.radius, l.color, l.intensity * 0.34 * glowScale, falloff);
      }
    }

    if (hd2d.showOrthoGrid3d) {
      const spanX = Math.max(256, Math.ceil(cullHalfW / 32) * 32);
      const spanY = Math.max(256, Math.ceil(cullHalfH / 32) * 32);
      const baseX = Math.floor((camCenterX - spanX) / 32) * 32;
      const baseY = Math.floor((camCenterY - spanY) / 32) * 32;
      gpu.drawOrthoGrid3D(baseX, baseY, baseX + spanX * 2, baseY + spanY * 2, camCenterZ + 0.35, 32, 4);
    }
    if (hd2d.showAxisGizmo3d) {
      gpu.drawAxisGizmo3D(camCenterX, camCenterY, camCenterZ + 0.6, 48);
    }

    // 2. 3D Floor Tiles, Flat/Tall Decor & Neighbor-Culled Extruded 3D Wall Boxes
    const hasVoxels3d = Boolean(snap.voxels3d && snap.voxels3d.length > 0);
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
        if (hasVoxels3d && extrudeH > 4) {
          continue;
        }
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
          effectiveTilt,
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

    // 2b. Multi-Story 3D Voxels (Cubes, Half-Slabs, Arches, Ramps & Stairs) with Interior Roof Cutaway
    if (snap.voxels3d && snap.voxels3d.length > 0) {
      for (let i = 0; i < snap.voxels3d.length; i++) {
        const v = snap.voxels3d[i];
        const vcx = v.x + v.w * 0.5;
        const vcy = v.y + v.d * 0.5;
        if (Math.abs(vcx - camCenterX) > cullHalfW || Math.abs(vcy - camCenterY) > cullHalfH) {
          continue;
        }
        const isCutUpper = cutawayActive && v.z >= cutawayPlaneZ - 0.5;
        if (isCutUpper && cutawayAlpha <= 0.01) {
          continue;
        }
        const sideId = v.sideSprite && v.sideSprite !== 'solid' ? v.sideSprite : v.sprite;
        const rough = v.roughness ?? 0.62;
        const met = v.metallic ?? 0.08;
        const em = v.emissive ?? 0;
        const vAlpha = (v.alpha ?? 1) * (isCutUpper ? cutawayAlpha : 1);
        const isCutBoundaryBelow =
          cutawayActive && v.z < cutawayPlaneZ - 0.5 && v.z + v.h >= cutawayPlaneZ - 0.5;
        const effCullMask = isCutBoundaryBelow ? (v.cullMask & ~FACE_CULL_TOP) : v.cullMask;

        if (v.shape === 'cube') {
          gpu.drawCuboid3D(
            v.sprite,
            sideId,
            v.sprite,
            v.x,
            v.y,
            v.z,
            v.w,
            v.d,
            v.h,
            effCullMask,
            v.tint,
            vAlpha,
            defaultPaletteRow,
            rough,
            met,
            em,
          );
        } else if (v.shape === 'half_slab') {
          gpu.drawCuboid3D(
            v.sprite,
            sideId,
            v.sprite,
            v.x,
            v.y,
            v.z,
            v.w,
            v.d,
            v.h * 0.5,
            effCullMask,
            v.tint,
            vAlpha,
            defaultPaletteRow,
            rough,
            met,
            em,
          );
        } else if (v.shape === 'arch') {
          const pillarW = v.w * 0.22;
          const pillarH = v.h * 0.7;
          const lintelH = v.h * 0.3;
          gpu.drawCuboid3D(v.sprite, sideId, v.sprite, v.x, v.y, v.z, pillarW, v.d, pillarH, 0, v.tint, vAlpha, defaultPaletteRow, rough, met, em);
          gpu.drawCuboid3D(v.sprite, sideId, v.sprite, v.x + v.w - pillarW, v.y, v.z, pillarW, v.d, pillarH, 0, v.tint, vAlpha, defaultPaletteRow, rough, met, em);
          gpu.drawCuboid3D(v.sprite, sideId, v.sprite, v.x, v.y, v.z + pillarH, v.w, v.d, lintelH, 0, v.tint, vAlpha, defaultPaletteRow, rough, met, em);
        } else if (
          v.shape === 'slope_n' ||
          v.shape === 'slope_e' ||
          v.shape === 'slope_s' ||
          v.shape === 'slope_w'
        ) {
          const facing = v.shape.slice(6) as CardinalFacing3D;
          gpu.drawRamp3D(v.sprite, sideId, v.x, v.y, v.z, v.w, v.d, v.h, facing, v.tint, vAlpha, defaultPaletteRow, rough, met, em);
        } else if (
          v.shape === 'stair_n' ||
          v.shape === 'stair_e' ||
          v.shape === 'stair_s' ||
          v.shape === 'stair_w'
        ) {
          const facing = v.shape.slice(6) as CardinalFacing3D;
          gpu.drawStairs3D(v.sprite, sideId, v.x, v.y, v.z, v.w, v.d, v.h, facing, 4, v.tint, vAlpha, defaultPaletteRow, rough, met, em);
        }
      }
    }

    // 3. 3D Actors, Bosses, 3D Models & Melee Slash Billboards + Grounded Contact Shadows
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i];
      const footX = e.x + e.w * 0.5;
      const footY = e.y + e.h;
      if (Math.abs(footX - camCenterX) > cullHalfW || Math.abs(footY - camCenterY) > cullHalfH) {
        continue;
      }
      const footZ = e.elevationZ ?? 0;
      const isEntCutUpper = cutawayActive && footZ >= cutawayPlaneZ - 0.5;
      if (isEntCutUpper && cutawayAlpha <= 0.01) {
        continue;
      }
      const entAlphaScale = isEntCutUpper ? cutawayAlpha : 1;
      const drawW = e.w * (e.scaleX ?? 1);
      const drawH = e.h * (e.scaleY ?? 1);

      if (e.castShadow !== false && !e.additive && !isEntCutUpper) {
        const supportZ = e.groundZ ?? 0;
        const heightAboveGround = Math.max(0, footZ - supportZ);
        const zFactor = 1 / (1 + heightAboveGround * 0.04);
        const r = (e.shadowRadius ?? e.w * 0.44) * zFactor;
        gpu.drawGroundShadow3D(
          footX,
          footY + (e.shadowOffsetY ?? 0) - 2,
          supportZ + 0.25,
          Math.max(8, r * 2.25),
          Math.max(5, r * 1.15),
          '#0c0816',
          Math.max(0.16, 0.46 * zFactor),
          0.66,
        );
      }

      if (e.model3dId && snap.models3d && snap.models3d[e.model3dId]) {
        const model = snap.models3d[e.model3dId];
        const entityYawDeg = ((e.yawRad ?? 0) * 180) / Math.PI;
        emitModel3DToGpu(
          gpu,
          model,
          e.x + e.w * 0.5,
          e.y + e.h * 0.5,
          footZ,
          entityYawDeg,
          (e.modelScaleX ?? 1) * (e.scaleX ?? 1),
          (e.modelScaleY ?? 1) * (e.scaleY ?? 1),
          e.modelScaleZ ?? 1,
          e.modelAnimClip,
          e.modelAnimTime ?? frameTimeSec,
          e.tint,
          e.flash ?? 0,
          (e.alpha ?? 1) * entAlphaScale,
        );
        continue;
      }

      if (hd2d.quadView && !e.additive) {
        gpu.drawCuboid3D(
          e.sprite,
          e.sprite,
          e.sprite,
          e.x + e.w * 0.25,
          e.y + e.h * 0.25,
          footZ,
          Math.max(4, e.w * 0.5),
          Math.max(4, e.w * 0.5),
          Math.max(8, drawH * 0.75),
          0,
          e.tint,
          Math.min(0.42, e.alpha ?? 1),
          e.paletteRow ?? defaultPaletteRow,
          e.roughness ?? 0.55,
          e.metallic ?? 0.1,
          e.emissive ?? 0,
          ((e.yawRad ?? 0) * 180) / Math.PI,
        );
      }

      if (e.artBlueprintId) {
        const bp = getOrthogonalBlueprint(e.artBlueprintId, activeCustomBlueprints);
        if (bp) {
          let resolvedFacing: OrthogonalFacing = e.artFacing ?? 'front';
          let resolvedFlipX = e.flipX ?? false;
          if (e.billboardYawMode === 'camera_4way') {
            const entityYawDeg = ((e.yawRad ?? 0) * 180) / Math.PI;
            const rel = ((((entityYawDeg - yawDeg) % 360) + 540) % 360) - 180;
            const absRel = Math.abs(rel);
            if (absRel <= 45) {
              resolvedFacing = 'front';
              resolvedFlipX = false;
            } else if (absRel >= 135) {
              resolvedFacing = 'back';
              resolvedFlipX = false;
            } else {
              resolvedFacing = 'side';
              resolvedFlipX = rel < 0;
            }
          }
          const animToggle = (Math.floor(frameTimeSec * 4) & 1) === 1;
          const layerCount = composeOrthogonalBlueprintInto(
            bp,
            resolvedFacing,
            e.artPose ?? 'idle',
            e.paletteRow,
            resolvedFlipX,
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
              effectiveTilt,
              ly.flipX,
              e.tint ?? ly.tint,
              (e.alpha ?? 1) * ly.alpha * entAlphaScale,
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
        e.additive ? (projection === 'ortho_front' || projection === 'ortho_side' ? 0 : 34) : effectiveTilt,
        e.flipX ?? false,
        e.tint,
        (e.alpha ?? 1) * entAlphaScale,
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
