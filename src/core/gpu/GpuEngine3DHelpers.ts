import type { SpriteId, TextureAtlas } from '../../assets/TextureAtlas.ts';
import type { Camera3DProjectionMode } from '../math/Perspective3DMath.ts';
import { type CardinalFacing3D, GpuMesh3DBatch } from './GpuMesh3DBatch.ts';
import { GpuQuad3DBatch } from './GpuQuad3DBatch.ts';
import type { Mesh3DPassData, Quad3DPassData } from './GpuTypes.ts';

export type Mesh3DIndexedOptions = Parameters<GpuMesh3DBatch['pushMesh3DIndexed']>[4];

/**
 * Coordinates 3D quad, indexed mesh, gizmo, grid, and quad-view batching on behalf of GpuEngine.
 */
export class GpuEngine3DHelpers {
  public readonly quad3d = new GpuQuad3DBatch();
  public readonly mesh3d = new GpuMesh3DBatch();

  public resetFrame(): void {
    this.quad3d.resetFrame();
    this.mesh3d.resetFrame();
  }

  public getQuad3DStats(): { opaqueCount: number; alphaCount: number; additiveCount: number; enabled: boolean } {
    return this.quad3d.getStats();
  }

  public getMesh3DStats(): {
    opaqueVertices: number;
    opaqueTriangles: number;
    alphaVertices: number;
    alphaTriangles: number;
    lineSegments: number;
  } {
    return this.mesh3d.getStats();
  }

  public getQuadPassData(): Quad3DPassData | undefined {
    return this.quad3d.getPassData();
  }

  public getMeshPassData(): Mesh3DPassData | undefined {
    return this.mesh3d.getPassData();
  }

  public setLightPosZ(idx: number, z: number): void {
    this.mesh3d.lightPosZ[idx] = Number.isFinite(z) ? z : 24.0;
  }

  public setCamera3D(
    camCenterX: number,
    camCenterY: number,
    zoom: number,
    pitchDeg: number,
    fovDeg: number,
    viewW: number,
    viewH: number,
    occOriginWorldX: number,
    occOriginWorldY: number,
    occTileSizeWorld: number,
    yawDeg: number,
    rollDeg: number,
    camCenterZ: number,
    projection: Camera3DProjectionMode,
  ): void {
    this.quad3d.setCamera3D(
      camCenterX,
      camCenterY,
      zoom,
      pitchDeg,
      fovDeg,
      viewW,
      viewH,
      occOriginWorldX,
      occOriginWorldY,
      occTileSizeWorld,
      yawDeg,
      rollDeg,
      camCenterZ,
      projection,
    );
  }

  public setSunLight3D(
    dirX: number,
    dirY: number,
    dirZ: number,
    shadowMapEnabled: boolean,
    shadowStrength: number,
  ): void {
    this.quad3d.setSunLight3D(dirX, dirY, dirZ, shadowMapEnabled, shadowStrength);
  }

  public setQuadViewEnabled(enabled: boolean): void {
    this.quad3d.setQuadViewEnabled(enabled);
  }

  public pushQuad3D(
    pass: 0 | 1 | 2,
    ox: number,
    oy: number,
    oz: number,
    ux: number,
    uy: number,
    uz: number,
    vx: number,
    vy: number,
    vz: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    nx: number,
    ny: number,
    nz: number,
    mode: number,
    flash: number,
    shadeMult: number,
    paletteRow: number,
    atlasPage: number,
    roughness: number,
    metallic: number,
    emissive: number,
  ): void {
    this.quad3d.pushQuad3D(
      pass,
      ox,
      oy,
      oz,
      ux,
      uy,
      uz,
      vx,
      vy,
      vz,
      u0,
      v0,
      u1,
      v1,
      r,
      g,
      b,
      a,
      nx,
      ny,
      nz,
      mode,
      flash,
      shadeMult,
      paletteRow,
      atlasPage,
      roughness,
      metallic,
      emissive,
    );
  }

  public drawFloorTile3D(
    atlas: TextureAtlas,
    id: SpriteId,
    x: number,
    y: number,
    w: number,
    h: number,
    z: number,
    tint: string | undefined,
    alpha: number,
    paletteRow: number,
    shadeMult: number,
    roughness: number,
    metallic: number,
    emissive: number,
  ): void {
    this.quad3d.drawFloorTile3D(atlas, id, x, y, w, h, z, tint, alpha, paletteRow, shadeMult, roughness, metallic, emissive);
  }

  public drawBox3DWall(
    atlas: TextureAtlas,
    topId: SpriteId,
    sideId: SpriteId | null,
    x: number,
    y: number,
    w: number,
    h: number,
    zBase: number,
    wallH: number,
    neighborMask: number,
    tint: string | undefined,
    wallTint: string | undefined,
    alpha: number,
    paletteRow: number,
    roughness: number,
    metallic: number,
    obliqueShadowAlpha: number,
    emissive: number,
  ): void {
    this.quad3d.drawBox3DWall(
      atlas,
      topId,
      sideId,
      x,
      y,
      w,
      h,
      zBase,
      wallH,
      neighborMask,
      tint,
      wallTint,
      alpha,
      paletteRow,
      roughness,
      metallic,
      obliqueShadowAlpha,
      emissive,
    );
  }

  public drawBillboard3D(
    atlas: TextureAtlas,
    id: SpriteId,
    footX: number,
    footY: number,
    footZ: number,
    w: number | undefined,
    h: number | undefined,
    tiltDeg: number,
    flipX: boolean,
    tint: string | undefined,
    alpha: number,
    flash: number,
    additive: boolean,
    paletteRow: number,
    emissive: number,
    roughness: number,
    metallic: number,
    swayX: number,
    opaqueCutout: boolean,
  ): void {
    this.quad3d.drawBillboard3D(
      atlas,
      id,
      footX,
      footY,
      footZ,
      w,
      h,
      tiltDeg,
      flipX,
      tint,
      alpha,
      flash,
      additive,
      paletteRow,
      emissive,
      roughness,
      metallic,
      swayX,
      opaqueCutout,
    );
  }

  public drawGroundShadow3D(
    cx: number,
    cy: number,
    z: number,
    w: number,
    h: number,
    colorHex: string,
    alpha: number,
    softness: number,
  ): void {
    this.quad3d.drawGroundShadow3D(cx, cy, z, w, h, colorHex, alpha, softness);
  }

  public drawLight3D(
    cx: number,
    cy: number,
    z: number,
    radius: number,
    colorHex: string,
    intensity: number,
    falloffPower: number,
  ): void {
    this.quad3d.drawLight3D(cx, cy, z, radius, colorHex, intensity, falloffPower);
  }

  public drawParticle3D(
    cx: number,
    cy: number,
    cz: number,
    size: number,
    colorHex: string,
    alpha: number,
    additive: boolean,
    emissive: number,
  ): void {
    this.quad3d.drawParticle3D(cx, cy, cz, size, colorHex, alpha, additive, emissive);
  }

  public pushMesh3DIndexed(
    positions: Float32Array | readonly number[],
    normals: Float32Array | readonly number[],
    uvs: Float32Array | readonly number[] | null,
    indices: Uint32Array | Uint16Array | readonly number[],
    options?: Mesh3DIndexedOptions,
  ): void {
    this.mesh3d.pushMesh3DIndexed(positions, normals, uvs, indices, options);
  }

  public drawCuboid3D(
    atlas: TextureAtlas,
    topId: SpriteId | null,
    sideId: SpriteId | null,
    bottomId: SpriteId | null,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    cullMask: number,
    tint: string | undefined,
    alpha: number,
    paletteRow: number,
    roughness: number,
    metallic: number,
    emissive: number,
    yawDeg: number,
  ): void {
    this.mesh3d.pushCuboid3D(
      atlas,
      topId,
      sideId,
      bottomId,
      x,
      y,
      z,
      sx,
      sy,
      sz,
      cullMask,
      tint,
      alpha,
      paletteRow,
      roughness,
      metallic,
      emissive,
      yawDeg,
    );
  }

  public drawRamp3D(
    atlas: TextureAtlas,
    topId: SpriteId | null,
    sideId: SpriteId | null,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    facing: CardinalFacing3D,
    tint: string | undefined,
    alpha: number,
    paletteRow: number,
    roughness: number,
    metallic: number,
    emissive: number,
  ): void {
    this.mesh3d.pushRamp3D(
      atlas,
      topId,
      sideId,
      x,
      y,
      z,
      sx,
      sy,
      sz,
      facing,
      tint,
      alpha,
      paletteRow,
      roughness,
      metallic,
      emissive,
    );
  }

  public drawStairs3D(
    atlas: TextureAtlas,
    topId: SpriteId | null,
    sideId: SpriteId | null,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    facing: CardinalFacing3D,
    steps: number,
    tint: string | undefined,
    alpha: number,
    paletteRow: number,
    roughness: number,
    metallic: number,
    emissive: number,
  ): void {
    this.mesh3d.pushStairs3D(
      atlas,
      topId,
      sideId,
      x,
      y,
      z,
      sx,
      sy,
      sz,
      facing,
      steps,
      tint,
      alpha,
      paletteRow,
      roughness,
      metallic,
      emissive,
    );
  }

  public drawLine3D(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colorHex: string,
    alpha: number,
  ): void {
    this.mesh3d.pushLine3D(x0, y0, z0, x1, y1, z1, colorHex, alpha);
  }

  public drawAxisGizmo3D(ox: number, oy: number, oz: number, axisLen: number): void {
    this.mesh3d.pushAxisGizmo3D(ox, oy, oz, axisLen);
  }

  public drawOrthoGrid3D(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    zPlane: number,
    step: number,
    majorEvery: number,
    minorColor: string,
    majorColor: string,
    alpha: number,
  ): void {
    this.mesh3d.pushOrthoGrid3D(minX, minY, maxX, maxY, zPlane, step, majorEvery, minorColor, majorColor, alpha);
  }
}
