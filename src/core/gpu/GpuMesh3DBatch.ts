import type { SpriteId, TextureAtlas } from '../../assets/TextureAtlas.ts';
import { INV_255, packHexRgb } from './GpuColorCache.ts';
import {
  FLOATS_PER_MESH3D_VERTEX,
  MAX_DYNAMIC_LIGHTS,
  MAX_LINE3D_VERTICES,
  MAX_MESH3D_ALPHA_INDICES,
  MAX_MESH3D_ALPHA_VERTICES,
  MAX_MESH3D_INDICES,
  MAX_MESH3D_VERTICES,
  type Mesh3DPassData,
  type SpriteRect,
} from './GpuTypes.ts';

export type CardinalFacing3D = 'n' | 'e' | 's' | 'w';

/** 6-bit neighbor face-culling bitmask matching Pixer canonical Z-Up axes. */
export const FACE_CULL_NORTH = 1; // -Y
export const FACE_CULL_EAST = 2;  // +X
export const FACE_CULL_SOUTH = 4; // +Y
export const FACE_CULL_WEST = 8;  // -X
export const FACE_CULL_TOP = 16;  // +Z
export const FACE_CULL_BOT = 32;  // -Z

const DEG_TO_RAD = Math.PI / 180;

/**
 * Pure DOM-free, Zero-GC Indexed Triangle Mesh3D + 3D Line Batcher for Pixer's
 * Pixel-Sculpted 3D pipeline (shared across WebGPU WGSL & WebGL2 GLSL ES 3.00).
 *
 * Vertex layout (`FLOATS_PER_MESH3D_VERTEX = 20`, 80 bytes):
 * - loc 0: posX, posY, posZ, ao
 * - loc 1: normX, normY, normZ, atlasPage
 * - loc 2: u, v, paletteRow, mode (0=atlas PBR, 1=solid PBR, 2=unlit gizmo/line)
 * - loc 3: r, g, b, a
 * - loc 4: roughness, metallic, emissive, flash
 */
export class GpuMesh3DBatch {
  private readonly opaqueVerts = new Float32Array(MAX_MESH3D_VERTICES * FLOATS_PER_MESH3D_VERTEX);
  private readonly opaqueIdx = new Uint32Array(MAX_MESH3D_INDICES);
  private readonly alphaVerts = new Float32Array(MAX_MESH3D_ALPHA_VERTICES * FLOATS_PER_MESH3D_VERTEX);
  private readonly alphaIdx = new Uint32Array(MAX_MESH3D_ALPHA_INDICES);
  private readonly lineVerts = new Float32Array(MAX_LINE3D_VERTICES * FLOATS_PER_MESH3D_VERTEX);
  public readonly lightPosZ = new Float32Array(MAX_DYNAMIC_LIGHTS);

  private opaqueVCount = 0;
  private opaqueICount = 0;
  private alphaVCount = 0;
  private alphaICount = 0;
  private lineVCount = 0;

  private readonly passData: Mesh3DPassData = {
    opaqueVertices: this.opaqueVerts,
    opaqueVertexCount: 0,
    opaqueIndices: this.opaqueIdx,
    opaqueIndexCount: 0,
    alphaVertices: this.alphaVerts,
    alphaVertexCount: 0,
    alphaIndices: this.alphaIdx,
    alphaIndexCount: 0,
    lineVertices: this.lineVerts,
    lineVertexCount: 0,
    lightPosZ: this.lightPosZ,
  };

  constructor() {
    this.lightPosZ.fill(24);
  }

  public resetFrame(): void {
    this.opaqueVCount = 0;
    this.opaqueICount = 0;
    this.alphaVCount = 0;
    this.alphaICount = 0;
    this.lineVCount = 0;
    this.lightPosZ.fill(24);
  }

  public getStats(): {
    opaqueVertices: number;
    opaqueTriangles: number;
    alphaVertices: number;
    alphaTriangles: number;
    lineSegments: number;
  } {
    return {
      opaqueVertices: this.opaqueVCount,
      opaqueTriangles: Math.floor(this.opaqueICount / 3),
      alphaVertices: this.alphaVCount,
      alphaTriangles: Math.floor(this.alphaICount / 3),
      lineSegments: Math.floor(this.lineVCount / 2),
    };
  }

  public hasGeometry(): boolean {
    return this.opaqueICount > 0 || this.alphaICount > 0 || this.lineVCount > 0;
  }

  public getPassData(): Mesh3DPassData {
    this.passData.opaqueVertexCount = this.opaqueVCount;
    this.passData.opaqueIndexCount = this.opaqueICount;
    this.passData.alphaVertexCount = this.alphaVCount;
    this.passData.alphaIndexCount = this.alphaICount;
    this.passData.lineVertexCount = this.lineVCount;
    return this.passData;
  }

  public pushVertex(
    pass: 0 | 1,
    x: number,
    y: number,
    z: number,
    ao: number,
    nx: number,
    ny: number,
    nz: number,
    atlasPage: number,
    u: number,
    v: number,
    paletteRow: number,
    mode: number,
    r: number,
    g: number,
    b: number,
    a: number,
    roughness = 0.55,
    metallic = 0.08,
    emissive = 0,
    flash = 0,
  ): number {
    const isOpaque = pass === 0;
    const count = isOpaque ? this.opaqueVCount : this.alphaVCount;
    const cap = isOpaque ? MAX_MESH3D_VERTICES : MAX_MESH3D_ALPHA_VERTICES;
    if (count >= cap) return -1;

    const arr = isOpaque ? this.opaqueVerts : this.alphaVerts;
    const base = count * FLOATS_PER_MESH3D_VERTEX;
    arr[base] = x;
    arr[base + 1] = y;
    arr[base + 2] = z;
    arr[base + 3] = ao;
    arr[base + 4] = nx;
    arr[base + 5] = ny;
    arr[base + 6] = nz;
    arr[base + 7] = atlasPage;
    arr[base + 8] = u;
    arr[base + 9] = v;
    arr[base + 10] = paletteRow;
    arr[base + 11] = mode;
    arr[base + 12] = r;
    arr[base + 13] = g;
    arr[base + 14] = b;
    arr[base + 15] = a;
    arr[base + 16] = roughness;
    arr[base + 17] = metallic;
    arr[base + 18] = emissive;
    arr[base + 19] = flash;

    if (isOpaque) this.opaqueVCount++;
    else this.alphaVCount++;
    return count;
  }

  public pushTriangle(pass: 0 | 1, i0: number, i1: number, i2: number): void {
    if (i0 < 0 || i1 < 0 || i2 < 0) return;
    if (pass === 0) {
      if (this.opaqueICount + 3 > MAX_MESH3D_INDICES) return;
      this.opaqueIdx[this.opaqueICount++] = i0;
      this.opaqueIdx[this.opaqueICount++] = i1;
      this.opaqueIdx[this.opaqueICount++] = i2;
    } else {
      if (this.alphaICount + 3 > MAX_MESH3D_ALPHA_INDICES) return;
      this.alphaIdx[this.alphaICount++] = i0;
      this.alphaIdx[this.alphaICount++] = i1;
      this.alphaIdx[this.alphaICount++] = i2;
    }
  }

  /**
   * Emits an oriented quad (2 triangles) from 4 corner positions `(p0..p3)` with per-corner AO.
   */
  public pushQuadVertices(
    pass: 0 | 1,
    x0: number, y0: number, z0: number, ao0: number, u0: number, v0: number,
    x1: number, y1: number, z1: number, ao1: number, u1: number, v1: number,
    x2: number, y2: number, z2: number, ao2: number, u2: number, v2: number,
    x3: number, y3: number, z3: number, ao3: number, u3: number, v3: number,
    nx: number, ny: number, nz: number,
    atlasPage: number, paletteRow: number, mode: number,
    r: number, g: number, b: number, a: number,
    roughness: number, metallic: number, emissive: number, flash = 0,
  ): void {
    const i0 = this.pushVertex(pass, x0, y0, z0, ao0, nx, ny, nz, atlasPage, u0, v0, paletteRow, mode, r, g, b, a, roughness, metallic, emissive, flash);
    const i1 = this.pushVertex(pass, x1, y1, z1, ao1, nx, ny, nz, atlasPage, u1, v1, paletteRow, mode, r, g, b, a, roughness, metallic, emissive, flash);
    const i2 = this.pushVertex(pass, x2, y2, z2, ao2, nx, ny, nz, atlasPage, u2, v2, paletteRow, mode, r, g, b, a, roughness, metallic, emissive, flash);
    const i3 = this.pushVertex(pass, x3, y3, z3, ao3, nx, ny, nz, atlasPage, u3, v3, paletteRow, mode, r, g, b, a, roughness, metallic, emissive, flash);
    if (i0 < 0 || i1 < 0 || i2 < 0 || i3 < 0) return;
    this.pushTriangle(pass, i0, i1, i2);
    this.pushTriangle(pass, i0, i2, i3);
  }

  /**
   * Pushes an arbitrary indexed triangle mesh (positions `[x,y,z,...]`, normals `[nx,ny,nz,...]`,
   * UVs `[u,v,...]`, indices) transformed by a column-major 4×4 matrix or world offset/scale.
   */
  public pushMesh3DIndexed(
    positions: Float32Array | readonly number[],
    normals: Float32Array | readonly number[],
    uvs: Float32Array | readonly number[] | null,
    indices: Uint32Array | Uint16Array | readonly number[],
    options: {
      atlasRect?: SpriteRect | null;
      tint?: string;
      alpha?: number;
      paletteRow?: number;
      roughness?: number;
      metallic?: number;
      emissive?: number;
      flash?: number;
      ao?: number;
      mode?: 0 | 1 | 2;
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      yawDeg?: number;
      modelMatrix?: Float32Array | null;
    } = {},
  ): void {
    const vCount = Math.floor(positions.length / 3);
    if (vCount <= 0 || indices.length < 3) return;
    const alpha = options.alpha ?? 1;
    if (!(alpha > 0.001)) return;
    const pass: 0 | 1 = alpha >= 0.99 ? 0 : 1;

    let r = 1;
    let g = 1;
    let b = 1;
    if (options.tint) {
      const n = packHexRgb(options.tint);
      r = ((n >> 16) & 255) * INV_255;
      g = ((n >> 8) & 255) * INV_255;
      b = (n & 255) * INV_255;
    }

    const rect = options.atlasRect ?? null;
    const mode = options.mode ?? (rect ? 0 : 1);
    const atlasPage = rect?.page ?? 0;
    const u0 = rect ? rect.u0 : 0;
    const v0 = rect ? rect.v0 : 0;
    const uSpan = rect ? rect.u1 - rect.u0 : 1;
    const vSpan = rect ? rect.v1 - rect.v0 : 1;
    const paletteRow = options.paletteRow ?? -1;
    const roughness = options.roughness ?? 0.55;
    const metallic = options.metallic ?? 0.08;
    const emissive = options.emissive ?? 0;
    const flash = options.flash ?? 0;
    const ao = options.ao ?? 1.0;

    const m = options.modelMatrix ?? null;
    const ox = options.offsetX ?? 0;
    const oy = options.offsetY ?? 0;
    const oz = options.offsetZ ?? 0;
    const sx = options.scaleX ?? 1;
    const sy = options.scaleY ?? 1;
    const sz = options.scaleZ ?? 1;
    const yawRad = (options.yawDeg ?? 0) * DEG_TO_RAD;
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);

    const baseVertex = pass === 0 ? this.opaqueVCount : this.alphaVCount;
    const maxCap = pass === 0 ? MAX_MESH3D_VERTICES : MAX_MESH3D_ALPHA_VERTICES;
    if (baseVertex + vCount > maxCap) return;

    for (let i = 0; i < vCount; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const rawNx = i * 3 + 2 < normals.length ? normals[i * 3] : 0;
      const rawNy = i * 3 + 2 < normals.length ? normals[i * 3 + 1] : 0;
      const rawNz = i * 3 + 2 < normals.length ? normals[i * 3 + 2] : 1;

      let wx: number;
      let wy: number;
      let wz: number;
      let nx: number;
      let ny: number;
      let nz: number;

      if (m) {
        wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
        wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
        wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
        nx = m[0] * rawNx + m[4] * rawNy + m[8] * rawNz;
        ny = m[1] * rawNx + m[5] * rawNy + m[9] * rawNz;
        nz = m[2] * rawNx + m[6] * rawNy + m[10] * rawNz;
      } else {
        const spx = px * sx;
        const spy = py * sy;
        const spz = pz * sz;
        wx = ox + spx * cosY - spy * sinY;
        wy = oy + spx * sinY + spy * cosY;
        wz = oz + spz;
        nx = rawNx * cosY - rawNy * sinY;
        ny = rawNx * sinY + rawNy * cosY;
        nz = rawNz;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const lu = uvs && i * 2 + 1 < uvs.length ? uvs[i * 2] : 0.5;
      const lv = uvs && i * 2 + 1 < uvs.length ? uvs[i * 2 + 1] : 0.5;

      this.pushVertex(
        pass,
        wx, wy, wz, ao,
        nx / nLen, ny / nLen, nz / nLen, atlasPage,
        u0 + lu * uSpan, v0 + lv * vSpan, paletteRow, mode,
        r, g, b, alpha,
        roughness, metallic, emissive, flash,
      );
    }

    const triIndices = Math.floor(indices.length / 3) * 3;
    for (let i = 0; i < triIndices; i += 3) {
      this.pushTriangle(pass, baseVertex + indices[i], baseVertex + indices[i + 1], baseVertex + indices[i + 2]);
    }
  }

  /**
   * Emits a true 3D pixel cuboid `[x..x+sx, y..y+sy, z..z+sz]` with 6-face neighbor culling,
   * baked vertical AO gradient, and optional Z-axis yaw rotation around its footprint center.
   */
  public pushCuboid3D(
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
    cullMask = 0,
    tint?: string,
    alpha = 1,
    paletteRow = -1,
    roughness = 0.58,
    metallic = 0.08,
    emissive = 0,
    yawDeg = 0,
  ): void {
    if (!(sx > 0) || !(sy > 0) || !(sz > 0) || !(alpha > 0.001)) return;
    const pass: 0 | 1 = alpha >= 0.99 ? 0 : 1;
    let r = 1;
    let g = 1;
    let b = 1;
    if (tint) {
      const n = packHexRgb(tint);
      r = ((n >> 16) & 255) * INV_255;
      g = ((n >> 8) & 255) * INV_255;
      b = (n & 255) * INV_255;
    }

    const topRect = topId ? atlas.getRect(topId) : null;
    const sideRect = sideId ? atlas.getRect(sideId) : topRect;
    const botRect = bottomId ? atlas.getRect(bottomId) : topRect;

    const cx = x + sx * 0.5;
    const cy = y + sy * 0.5;
    const hx = sx * 0.5;
    const hy = sy * 0.5;
    const z0 = z;
    const z1 = z + sz;

    const rad = yawDeg * DEG_TO_RAD;
    const c = Math.cos(rad);
    const s = Math.sin(rad);

    // Local corners rotated around (cx, cy)
    // NW=(-hx,-hy), NE=(+hx,-hy), SE=(+hx,+hy), SW=(-hx,+hy)
    const nwX = cx + (-hx * c - -hy * s);
    const nwY = cy + (-hx * s + -hy * c);
    const neX = cx + (hx * c - -hy * s);
    const neY = cy + (hx * s + -hy * c);
    const seX = cx + (hx * c - hy * s);
    const seY = cy + (hx * s + hy * c);
    const swX = cx + (-hx * c - hy * s);
    const swY = cy + (-hx * s + hy * c);

    const aoTop = 1.0;
    const aoBot = 0.78;

    const emitFace = (
      rect: SpriteRect | null,
      ax: number, ay: number, az: number, aao: number,
      bx: number, by: number, bz: number, bao: number,
      cxp: number, cyp: number, czp: number, cao: number,
      dx: number, dy: number, dz: number, dao: number,
      nx: number, ny: number, nz: number,
    ) => {
      const mode = rect ? 0 : 1;
      const page = rect?.page ?? 0;
      const u0 = rect ? rect.u0 : 0;
      const v0 = rect ? rect.v0 : 0;
      const u1 = rect ? rect.u1 : 1;
      const v1 = rect ? rect.v1 : 1;
      this.pushQuadVertices(
        pass,
        ax, ay, az, aao, u0, v0,
        bx, by, bz, bao, u1, v0,
        cxp, cyp, czp, cao, u1, v1,
        dx, dy, dz, dao, u0, v1,
        nx, ny, nz, page, paletteRow, mode, r, g, b, alpha, roughness, metallic, emissive,
      );
    };

    // +Z Top
    if ((cullMask & FACE_CULL_TOP) === 0) {
      emitFace(topRect, nwX, nwY, z1, aoTop, neX, neY, z1, aoTop, seX, seY, z1, aoTop, swX, swY, z1, aoTop, 0, 0, 1);
    }
    // -Z Bottom
    if ((cullMask & FACE_CULL_BOT) === 0) {
      emitFace(botRect, swX, swY, z0, aoBot, seX, seY, z0, aoBot, neX, neY, z0, aoBot, nwX, nwY, z0, aoBot, 0, 0, -1);
    }
    // +Y South
    if ((cullMask & FACE_CULL_SOUTH) === 0) {
      emitFace(sideRect, swX, swY, z1, aoTop, seX, seY, z1, aoTop, seX, seY, z0, aoBot, swX, swY, z0, aoBot, -s, c, 0);
    }
    // -Y North
    if ((cullMask & FACE_CULL_NORTH) === 0) {
      emitFace(sideRect, neX, neY, z1, aoTop, nwX, nwY, z1, aoTop, nwX, nwY, z0, aoBot, neX, neY, z0, aoBot, s, -c, 0);
    }
    // +X East
    if ((cullMask & FACE_CULL_EAST) === 0) {
      emitFace(sideRect, seX, seY, z1, aoTop, neX, neY, z1, aoTop, neX, neY, z0, aoBot, seX, seY, z0, aoBot, c, s, 0);
    }
    // -X West
    if ((cullMask & FACE_CULL_WEST) === 0) {
      emitFace(sideRect, nwX, nwY, z1, aoTop, swX, swY, z1, aoTop, swX, swY, z0, aoBot, nwX, nwY, z0, aoBot, -c, -s, 0);
    }
  }

  /**
   * Emits a true 3D sloped ramp/wedge whose high edge sits along `facing` (`'n' | 'e' | 's' | 'w'`),
   * with exact analytical slope normal and closed triangular side walls.
   */
  public pushRamp3D(
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
    tint?: string,
    alpha = 1,
    paletteRow = -1,
    roughness = 0.6,
    metallic = 0.06,
    emissive = 0,
  ): void {
    if (!(sx > 0) || !(sy > 0) || !(sz > 0) || !(alpha > 0.001)) return;
    const pass: 0 | 1 = alpha >= 0.99 ? 0 : 1;
    let r = 1;
    let g = 1;
    let b = 1;
    if (tint) {
      const n = packHexRgb(tint);
      r = ((n >> 16) & 255) * INV_255;
      g = ((n >> 8) & 255) * INV_255;
      b = (n & 255) * INV_255;
    }

    const topRect = topId ? atlas.getRect(topId) : null;
    const sideRect = sideId ? atlas.getRect(sideId) : topRect;
    const topMode = topRect ? 0 : 1;
    const sideMode = sideRect ? 0 : 1;
    const tPage = topRect?.page ?? 0;
    const sPage = sideRect?.page ?? 0;
    const tu0 = topRect ? topRect.u0 : 0;
    const tv0 = topRect ? topRect.v0 : 0;
    const tu1 = topRect ? topRect.u1 : 1;
    const tv1 = topRect ? topRect.v1 : 1;
    const su0 = sideRect ? sideRect.u0 : 0;
    const sv0 = sideRect ? sideRect.v0 : 0;
    const su1 = sideRect ? sideRect.u1 : 1;
    const sv1 = sideRect ? sideRect.v1 : 1;

    const x0 = x;
    const x1 = x + sx;
    const y0 = y;
    const y1 = y + sy;
    const z0 = z;
    const z1 = z + sz;

    // 4 heights for NW, NE, SE, SW corners based on which side is the high end
    const hNW = facing === 'n' || facing === 'w' ? z1 : z0;
    const hNE = facing === 'n' || facing === 'e' ? z1 : z0;
    const hSE = facing === 's' || facing === 'e' ? z1 : z0;
    const hSW = facing === 's' || facing === 'w' ? z1 : z0;

    // Exact analytical slope normal
    let snx = 0;
    let sny = 0;
    let snz = 1;
    if (facing === 'n') {
      const len = Math.hypot(sz, sy);
      sny = sz / len;
      snz = sy / len;
    } else if (facing === 's') {
      const len = Math.hypot(sz, sy);
      sny = -sz / len;
      snz = sy / len;
    } else if (facing === 'e') {
      const len = Math.hypot(sz, sx);
      snx = -sz / len;
      snz = sx / len;
    } else {
      const len = Math.hypot(sz, sx);
      snx = sz / len;
      snz = sx / len;
    }

    // 1. Sloped Top Ramp Surface
    this.pushQuadVertices(
      pass,
      x0, y0, hNW, hNW > z0 ? 1.0 : 0.84, tu0, tv0,
      x1, y0, hNE, hNE > z0 ? 1.0 : 0.84, tu1, tv0,
      x1, y1, hSE, hSE > z0 ? 1.0 : 0.84, tu1, tv1,
      x0, y1, hSW, hSW > z0 ? 1.0 : 0.84, tu0, tv1,
      snx, sny, snz, tPage, paletteRow, topMode, r, g, b, alpha, roughness, metallic, emissive,
    );

    // 2. High Back Vertical Wall + 2 Triangular Side Cheek Walls
    const pushTri = (
      ax: number, ay: number, az: number, aao: number, au: number, av: number,
      bx: number, by: number, bz: number, bao: number, bu: number, bv: number,
      cxp: number, cyp: number, czp: number, cao: number, cu: number, cv: number,
      nx: number, ny: number, nz: number,
    ) => {
      const i0 = this.pushVertex(pass, ax, ay, az, aao, nx, ny, nz, sPage, au, av, paletteRow, sideMode, r, g, b, alpha, roughness, metallic, emissive);
      const i1 = this.pushVertex(pass, bx, by, bz, bao, nx, ny, nz, sPage, bu, bv, paletteRow, sideMode, r, g, b, alpha, roughness, metallic, emissive);
      const i2 = this.pushVertex(pass, cxp, cyp, czp, cao, nx, ny, nz, sPage, cu, cv, paletteRow, sideMode, r, g, b, alpha, roughness, metallic, emissive);
      this.pushTriangle(pass, i0, i1, i2);
    };

    if (facing === 'n') {
      // Back North face (-Y)
      this.pushQuadVertices(pass, x1, y0, z1, 1, su0, sv0, x0, y0, z1, 1, su1, sv0, x0, y0, z0, 0.78, su1, sv1, x1, y0, z0, 0.78, su0, sv1, 0, -1, 0, sPage, paletteRow, sideMode, r, g, b, alpha, roughness, metallic, emissive);
      // East triangle (+X)
      pushTri(x1, y0, z1, 1, su1, sv0, x1, y1, z0, 0.78, su0, sv1, x1, y0, z0, 0.78, su1, sv1, 1, 0, 0);
      // West triangle (-X)
      pushTri(x0, y0, z1, 1, su0, sv0, x0, y0, z0, 0.78, su0, sv1, x0, y1, z0, 0.78, su1, sv1, -1, 0, 0);
    } else if (facing === 's') {
      // Back South face (+Y)
      this.pushQuadVertices(pass, x0, y1, z1, 1, su0, sv0, x1, y1, z1, 1, su1, sv0, x1, y1, z0, 0.78, su1, sv1, x0, y1, z0, 0.78, su0, sv1, 0, 1, 0, sPage, paletteRow, sideMode, r, g, b, alpha, roughness, metallic, emissive);
      // East triangle (+X)
      pushTri(x1, y1, z1, 1, su0, sv0, x1, y1, z0, 0.78, su0, sv1, x1, y0, z0, 0.78, su1, sv1, 1, 0, 0);
      // West triangle (-X)
      pushTri(x0, y1, z1, 1, su1, sv0, x0, y0, z0, 0.78, su0, sv1, x0, y1, z0, 0.78, su1, sv1, -1, 0, 0);
    } else if (facing === 'e') {
      // Back East face (+X)
      this.pushQuadVertices(pass, x1, y1, z1, 1, su0, sv0, x1, y0, z1, 1, su1, sv0, x1, y0, z0, 0.78, su1, sv1, x1, y1, z0, 0.78, su0, sv1, 1, 0, 0, sPage, paletteRow, sideMode, r, g, b, alpha, roughness, metallic, emissive);
      // South triangle (+Y)
      pushTri(x1, y1, z1, 1, su1, sv0, x1, y1, z0, 0.78, su1, sv1, x0, y1, z0, 0.78, su0, sv1, 0, 1, 0);
      // North triangle (-Y)
      pushTri(x1, y0, z1, 1, su0, sv0, x0, y0, z0, 0.78, su1, sv1, x1, y0, z0, 0.78, su0, sv1, 0, -1, 0);
    } else {
      // Back West face (-X)
      this.pushQuadVertices(pass, x0, y0, z1, 1, su0, sv0, x0, y1, z1, 1, su1, sv0, x0, y1, z0, 0.78, su1, sv1, x0, y0, z0, 0.78, su0, sv1, -1, 0, 0, sPage, paletteRow, sideMode, r, g, b, alpha, roughness, metallic, emissive);
      // South triangle (+Y)
      pushTri(x0, y1, z1, 1, su0, sv0, x1, y1, z0, 0.78, su1, sv1, x0, y1, z0, 0.78, su0, sv1, 0, 1, 0);
      // North triangle (-Y)
      pushTri(x0, y0, z1, 1, su1, sv0, x0, y0, z0, 0.78, su1, sv1, x1, y0, z0, 0.78, su0, sv1, 0, -1, 0);
    }
  }

  /**
   * Emits a crisp multi-step 3D staircase climbing toward `facing` (`'n' | 'e' | 's' | 'w'`).
   */
  public pushStairs3D(
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
    steps = 4,
    tint?: string,
    alpha = 1,
    paletteRow = -1,
    roughness = 0.62,
    metallic = 0.06,
    emissive = 0,
  ): void {
    const safeSteps = Math.max(2, Math.min(8, Math.round(steps)));
    const stepH = sz / safeSteps;
    for (let s = 0; s < safeSteps; s++) {
      const h = stepH * (s + 1);
      if (facing === 'n') {
        const stepD = sy / safeSteps;
        const stepY = y + sy - stepD * (s + 1);
        this.pushCuboid3D(atlas, topId, sideId, null, x, stepY, z, sx, stepD, h, FACE_CULL_BOT, tint, alpha, paletteRow, roughness, metallic, emissive);
      } else if (facing === 's') {
        const stepD = sy / safeSteps;
        const stepY = y + stepD * s;
        this.pushCuboid3D(atlas, topId, sideId, null, x, stepY, z, sx, stepD, h, FACE_CULL_BOT, tint, alpha, paletteRow, roughness, metallic, emissive);
      } else if (facing === 'e') {
        const stepW = sx / safeSteps;
        const stepX = x + stepW * s;
        this.pushCuboid3D(atlas, topId, sideId, null, stepX, y, z, stepW, sy, h, FACE_CULL_BOT, tint, alpha, paletteRow, roughness, metallic, emissive);
      } else {
        const stepW = sx / safeSteps;
        const stepX = x + sx - stepW * (s + 1);
        this.pushCuboid3D(atlas, topId, sideId, null, stepX, y, z, stepW, sy, h, FACE_CULL_BOT, tint, alpha, paletteRow, roughness, metallic, emissive);
      }
    }
  }

  /**
   * Emits a crisp unlit 3D line segment (for orthographic reference grids, bounding boxes, and XYZ gizmos).
   */
  public pushLine3D(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colorHex: string,
    alpha = 1,
  ): void {
    if (this.lineVCount + 2 > MAX_LINE3D_VERTICES || !(alpha > 0.001)) return;
    const n = packHexRgb(colorHex);
    const r = ((n >> 16) & 255) * INV_255;
    const g = ((n >> 8) & 255) * INV_255;
    const b = (n & 255) * INV_255;

    const writePt = (px: number, py: number, pz: number) => {
      const base = this.lineVCount * FLOATS_PER_MESH3D_VERTEX;
      const arr = this.lineVerts;
      arr[base] = px;
      arr[base + 1] = py;
      arr[base + 2] = pz;
      arr[base + 3] = 1;
      arr[base + 4] = 0;
      arr[base + 5] = 0;
      arr[base + 6] = 1;
      arr[base + 7] = 0;
      arr[base + 8] = 0;
      arr[base + 9] = 0;
      arr[base + 10] = -1;
      arr[base + 11] = 2; // mode 2 = unlit crisp line/gizmo
      arr[base + 12] = r;
      arr[base + 13] = g;
      arr[base + 14] = b;
      arr[base + 15] = alpha;
      arr[base + 16] = 1;
      arr[base + 17] = 0;
      arr[base + 18] = 0.2;
      arr[base + 19] = 0;
      this.lineVCount++;
    };
    writePt(x0, y0, z0);
    writePt(x1, y1, z1);
  }

  /**
   * Emits a canonical Z-Up RGB XYZ Axis Gizmo (+X East = Red, +Y South = Green, +Z Up = Blue)
   * with crisp arrow tips for orthographic & perspective spatial orientation.
   */
  public pushAxisGizmo3D(ox: number, oy: number, oz: number, axisLen = 48): void {
    const tip = axisLen * 0.16;
    // +X East (Red)
    this.pushLine3D(ox, oy, oz, ox + axisLen, oy, oz, '#ef4444', 1);
    this.pushLine3D(ox + axisLen, oy, oz, ox + axisLen - tip, oy + tip * 0.5, oz, '#ef4444', 1);
    this.pushLine3D(ox + axisLen, oy, oz, ox + axisLen - tip, oy - tip * 0.5, oz, '#ef4444', 1);
    // +Y South (Green)
    this.pushLine3D(ox, oy, oz, ox, oy + axisLen, oz, '#22c55e', 1);
    this.pushLine3D(ox, oy + axisLen, oz, ox + tip * 0.5, oy + axisLen - tip, oz, '#22c55e', 1);
    this.pushLine3D(ox, oy + axisLen, oz, ox - tip * 0.5, oy + axisLen - tip, oz, '#22c55e', 1);
    // +Z Up (Blue)
    this.pushLine3D(ox, oy, oz, ox, oy, oz + axisLen, '#3b82f6', 1);
    this.pushLine3D(ox, oy, oz + axisLen, ox + tip * 0.5, oy, oz + axisLen - tip, '#3b82f6', 1);
    this.pushLine3D(ox, oy, oz + axisLen, ox - tip * 0.5, oy, oz + axisLen - tip, '#3b82f6', 1);
  }

  /**
   * Emits a crisp 3D orthographic reference grid on horizontal plane `Z = zPlane`.
   */
  public pushOrthoGrid3D(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    zPlane = 0,
    step = 32,
    majorEvery = 4,
    minorColor = '#334155',
    majorColor = '#64748b',
    alpha = 0.55,
  ): void {
    const safeStep = Math.max(4, step);
    const cols = Math.min(128, Math.ceil((maxX - minX) / safeStep));
    const rows = Math.min(128, Math.ceil((maxY - minY) / safeStep));
    for (let c = 0; c <= cols; c++) {
      const gx = minX + c * safeStep;
      const isMajor = majorEvery > 0 && c % majorEvery === 0;
      this.pushLine3D(gx, minY, zPlane, gx, maxY, zPlane, isMajor ? majorColor : minorColor, isMajor ? Math.min(1, alpha * 1.4) : alpha);
    }
    for (let r = 0; r <= rows; r++) {
      const gy = minY + r * safeStep;
      const isMajor = majorEvery > 0 && r % majorEvery === 0;
      this.pushLine3D(minX, gy, zPlane, maxX, gy, zPlane, isMajor ? majorColor : minorColor, isMajor ? Math.min(1, alpha * 1.4) : alpha);
    }
  }
}
