import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { GpuEngine } from '../gpu/GpuEngine.ts';
import type { SpriteRect } from '../gpu/GpuTypes.ts';

export interface EcsCuboidFacesDef {
  top?: SpriteId | null;
  side?: SpriteId | null;
  bottom?: SpriteId | null;
  north?: SpriteId | null;
  east?: SpriteId | null;
  south?: SpriteId | null;
  west?: SpriteId | null;
}

export interface EcsCuboidPartDef {
  id: string;
  parentId?: string;
  origin: readonly [number, number, number];
  size: readonly [number, number, number];
  pivot?: readonly [number, number, number];
  rotDeg?: readonly [number, number, number];
  faces: EcsCuboidFacesDef;
  tint?: string;
  alpha?: number;
  paletteRow?: number;
  roughness?: number;
  metallic?: number;
  emissive?: number;
}

export interface EcsModel3DAnimKeyframe {
  timeSec: number;
  posOffset?: readonly [number, number, number];
  rotDeg?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

export interface EcsModel3DAnimTrack {
  partId: string;
  keyframes: readonly EcsModel3DAnimKeyframe[];
}

export interface EcsModel3DAnimClip {
  name: string;
  durationSec: number;
  loop?: boolean;
  tracks: readonly EcsModel3DAnimTrack[];
}

export interface EcsRawMesh3DData {
  positions: Float32Array | readonly number[];
  normals: Float32Array | readonly number[];
  uvs?: Float32Array | readonly number[] | null;
  indices: Uint32Array | Uint16Array | readonly number[];
  spriteId?: SpriteId | null;
  tint?: string;
  alpha?: number;
  paletteRow?: number;
  roughness?: number;
  metallic?: number;
  emissive?: number;
}

export interface EcsModel3DDef {
  id: string;
  name: string;
  parts: readonly EcsCuboidPartDef[];
  rawMesh?: EcsRawMesh3DData;
  clips?: readonly EcsModel3DAnimClip[];
  boundsSize?: readonly [number, number, number];
}

function isVec3(v: unknown): v is readonly [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' && Number.isFinite(v[0]) &&
    typeof v[1] === 'number' && Number.isFinite(v[1]) &&
    typeof v[2] === 'number' && Number.isFinite(v[2])
  );
}

function isNumericBuffer(v: unknown): v is { readonly length: number } {
  return (
    Array.isArray(v) ||
    v instanceof Float32Array ||
    v instanceof Uint32Array ||
    v instanceof Uint16Array
  );
}

export function validateModel3DDef(def: unknown, keyHint = 'model3d'): string[] {
  const errors: string[] = [];
  if (!def || typeof def !== 'object') {
    return [`${keyHint} must be an object`];
  }
  const m = def as Partial<EcsModel3DDef>;
  if (!m.id || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{2,64}$/.test(m.id)) {
    errors.push(`${keyHint}.id must match /^[a-zA-Z0-9_-]{2,64}$/`);
  }
  if (!m.name || typeof m.name !== 'string') {
    errors.push(`${keyHint}.name must be a non-empty string`);
  }
  if (!Array.isArray(m.parts)) {
    errors.push(`${keyHint}.parts must be an array`);
  } else {
    if (m.parts.length > MAX_MODEL_PARTS) {
      errors.push(`${keyHint}.parts exceeds max limit (${MAX_MODEL_PARTS})`);
    }
    for (let i = 0; i < m.parts.length; i++) {
      const p = m.parts[i] as Partial<EcsCuboidPartDef> | null | undefined;
      const pLabel = `${keyHint}.parts[${i}]`;
      if (!p || typeof p !== 'object') {
        errors.push(`${pLabel} must be an object`);
        continue;
      }
      if (!p.id || typeof p.id !== 'string') {
        errors.push(`${pLabel}.id must be a non-empty string`);
      }
      if (p.parentId !== undefined && p.parentId === p.id) {
        errors.push(`${pLabel}.parentId cannot reference itself`);
      }
      if (!isVec3(p.origin)) {
        errors.push(`${pLabel}.origin must be a finite [x, y, z] tuple`);
      }
      if (!isVec3(p.size) || p.size[0] < 0 || p.size[1] < 0 || p.size[2] < 0) {
        errors.push(`${pLabel}.size must be a non-negative [sx, sy, sz] tuple`);
      }
      if (p.pivot !== undefined && !isVec3(p.pivot)) {
        errors.push(`${pLabel}.pivot must be a finite [px, py, pz] tuple`);
      }
      if (p.rotDeg !== undefined && !isVec3(p.rotDeg)) {
        errors.push(`${pLabel}.rotDeg must be a finite [rx, ry, rz] tuple`);
      }
      if (!p.faces || typeof p.faces !== 'object') {
        errors.push(`${pLabel}.faces must be an object`);
      }
    }
  }

  if (m.rawMesh !== undefined) {
    const r = m.rawMesh as Partial<EcsRawMesh3DData> | null;
    if (!r || typeof r !== 'object') {
      errors.push(`${keyHint}.rawMesh must be an object`);
    } else {
      if (!isNumericBuffer(r.positions) || r.positions.length % 3 !== 0) {
        errors.push(`${keyHint}.rawMesh.positions length must be a multiple of 3`);
      }
      if (!isNumericBuffer(r.normals) || r.normals.length % 3 !== 0) {
        errors.push(`${keyHint}.rawMesh.normals length must be a multiple of 3`);
      }
      if (!isNumericBuffer(r.indices) || r.indices.length % 3 !== 0) {
        errors.push(`${keyHint}.rawMesh.indices length must be a multiple of 3`);
      }
      if (r.uvs !== undefined && r.uvs !== null && (!isNumericBuffer(r.uvs) || r.uvs.length % 2 !== 0)) {
        errors.push(`${keyHint}.rawMesh.uvs length must be a multiple of 2`);
      }
    }
  }

  if (m.clips !== undefined) {
    if (!Array.isArray(m.clips)) {
      errors.push(`${keyHint}.clips must be an array`);
    } else {
      for (let i = 0; i < m.clips.length; i++) {
        const c = m.clips[i] as Partial<EcsModel3DAnimClip> | null;
        const cLabel = `${keyHint}.clips[${i}]`;
        if (!c || typeof c !== 'object') {
          errors.push(`${cLabel} must be an object`);
          continue;
        }
        if (!c.name || typeof c.name !== 'string') {
          errors.push(`${cLabel}.name must be a non-empty string`);
        }
        if (typeof c.durationSec !== 'number' || !Number.isFinite(c.durationSec) || c.durationSec < 0) {
          errors.push(`${cLabel}.durationSec must be a non-negative finite number`);
        }
        if (!Array.isArray(c.tracks)) {
          errors.push(`${cLabel}.tracks must be an array`);
        }
      }
    }
  }

  if (m.boundsSize !== undefined && !isVec3(m.boundsSize)) {
    errors.push(`${keyHint}.boundsSize must be a finite [w, d, h] tuple`);
  }

  return errors;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const MAX_MODEL_PARTS = 512;

// Module-level pre-allocated scratch buffers (Zero-GC per frame)
const SCRATCH_ROOT_MAT = new Float32Array(16);
const SCRATCH_LOCAL_MAT = new Float32Array(16);
const SCRATCH_PART_MATS = new Float32Array(MAX_MODEL_PARTS * 16);
const SCRATCH_PART_STATE = new Uint8Array(MAX_MODEL_PARTS);
const SCRATCH_PARENT_IDX = new Int16Array(MAX_MODEL_PARTS);
const SCRATCH_ANIM_HAS = new Uint8Array(MAX_MODEL_PARTS);
const SCRATCH_ANIM_POS = new Float32Array(MAX_MODEL_PARTS * 3);
const SCRATCH_ANIM_ROT = new Float32Array(MAX_MODEL_PARTS * 3);
const SCRATCH_ANIM_SCALE = new Float32Array(MAX_MODEL_PARTS * 3);

const SCRATCH_QUAD_POS = new Float32Array(12);
const SCRATCH_QUAD_NORM = new Float32Array(12);
const SCRATCH_QUAD_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const SCRATCH_QUAD_IDX = new Uint16Array([0, 1, 2, 0, 2, 3]);
const SCRATCH_FACE_MAT = new Float32Array(16);

const SCRATCH_MESH_OPTS: {
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
  modelMatrix?: Float32Array | null;
} = {};

function writeTransformMatrix(
  out: Float32Array,
  outOff: number,
  tx: number,
  ty: number,
  tz: number,
  rxDeg: number,
  ryDeg: number,
  rzDeg: number,
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
): void {
  const rx = rxDeg * DEG_TO_RAD;
  const ry = ryDeg * DEG_TO_RAD;
  const rz = rzDeg * DEG_TO_RAD;
  const cx = Math.cos(rx);
  const sxi = Math.sin(rx);
  const cy = Math.cos(ry);
  const syi = Math.sin(ry);
  const cz = Math.cos(rz);
  const szi = Math.sin(rz);

  // R = Rz * Ry * Rx
  const r00 = cz * cy;
  const r01 = cz * syi * sxi - szi * cx;
  const r02 = cz * syi * cx + szi * sxi;

  const r10 = szi * cy;
  const r11 = szi * syi * sxi + cz * cx;
  const r12 = szi * syi * cx - cz * sxi;

  const r20 = -syi;
  const r21 = cy * sxi;
  const r22 = cy * cx;

  // M = T(tx, ty, tz) * T(px, py, pz) * R * S * T(-px, -py, -pz)
  const m00 = r00 * sx;
  const m01 = r01 * sy;
  const m02 = r02 * sz;
  const m10 = r10 * sx;
  const m11 = r11 * sy;
  const m12 = r12 * sz;
  const m20 = r20 * sx;
  const m21 = r21 * sy;
  const m22 = r22 * sz;

  out[outOff] = m00;
  out[outOff + 1] = m10;
  out[outOff + 2] = m20;
  out[outOff + 3] = 0;

  out[outOff + 4] = m01;
  out[outOff + 5] = m11;
  out[outOff + 6] = m21;
  out[outOff + 7] = 0;

  out[outOff + 8] = m02;
  out[outOff + 9] = m12;
  out[outOff + 10] = m22;
  out[outOff + 11] = 0;

  out[outOff + 12] = tx + px - (m00 * px + m01 * py + m02 * pz);
  out[outOff + 13] = ty + py - (m10 * px + m11 * py + m12 * pz);
  out[outOff + 14] = tz + pz - (m20 * px + m21 * py + m22 * pz);
  out[outOff + 15] = 1;
}

function mulMat4(
  a: Float32Array,
  aOff: number,
  b: Float32Array,
  bOff: number,
  out: Float32Array,
  outOff: number,
): void {
  const a00 = a[aOff], a01 = a[aOff + 4], a02 = a[aOff + 8], a03 = a[aOff + 12];
  const a10 = a[aOff + 1], a11 = a[aOff + 5], a12 = a[aOff + 9], a13 = a[aOff + 13];
  const a20 = a[aOff + 2], a21 = a[aOff + 6], a22 = a[aOff + 10], a23 = a[aOff + 14];
  const a30 = a[aOff + 3], a31 = a[aOff + 7], a32 = a[aOff + 11], a33 = a[aOff + 15];

  for (let c = 0; c < 4; c++) {
    const b0 = b[bOff + c * 4];
    const b1 = b[bOff + c * 4 + 1];
    const b2 = b[bOff + c * 4 + 2];
    const b3 = b[bOff + c * 4 + 3];
    const dst = outOff + c * 4;
    out[dst] = a00 * b0 + a01 * b1 + a02 * b2 + a03 * b3;
    out[dst + 1] = a10 * b0 + a11 * b1 + a12 * b2 + a13 * b3;
    out[dst + 2] = a20 * b0 + a21 * b1 + a22 * b2 + a23 * b3;
    out[dst + 3] = a30 * b0 + a31 * b1 + a32 * b2 + a33 * b3;
  }
}

function sampleClipIntoScratch(
  clip: EcsModel3DAnimClip,
  parts: readonly EcsCuboidPartDef[],
  partCount: number,
  animTimeSec: number,
): void {
  const dur = clip.durationSec;
  let t = 0;
  if (dur > 0) {
    if (clip.loop !== false) {
      t = ((animTimeSec % dur) + dur) % dur;
    } else {
      t = animTimeSec < 0 ? 0 : animTimeSec > dur ? dur : animTimeSec;
    }
  }

  for (let ti = 0; ti < clip.tracks.length; ti++) {
    const track = clip.tracks[ti];
    if (track.keyframes.length === 0) continue;

    let pIdx = -1;
    for (let i = 0; i < partCount; i++) {
      if (parts[i].id === track.partId) {
        pIdx = i;
        break;
      }
    }
    if (pIdx < 0) continue;

    const kfs = track.keyframes;
    let k0 = kfs[0];
    let k1 = k0;
    for (let k = 0; k < kfs.length; k++) {
      const kf = kfs[k];
      if (kf.timeSec <= t) {
        k0 = kf;
        k1 = k + 1 < kfs.length ? kfs[k + 1] : kf;
      } else {
        if (k === 0) {
          k0 = kf;
          k1 = kf;
        }
        break;
      }
    }

    const span = k1.timeSec - k0.timeSec;
    const alpha = span > 1e-6 ? Math.max(0, Math.min(1, (t - k0.timeSec) / span)) : 0;

    const p0 = k0.posOffset;
    const p1 = k1.posOffset;
    const r0 = k0.rotDeg;
    const r1 = k1.rotDeg;
    const s0 = k0.scale;
    const s1 = k1.scale;

    const base = pIdx * 3;
    SCRATCH_ANIM_HAS[pIdx] = 1;
    SCRATCH_ANIM_POS[base] = (p0 ? p0[0] : 0) + ((p1 ? p1[0] : 0) - (p0 ? p0[0] : 0)) * alpha;
    SCRATCH_ANIM_POS[base + 1] = (p0 ? p0[1] : 0) + ((p1 ? p1[1] : 0) - (p0 ? p0[1] : 0)) * alpha;
    SCRATCH_ANIM_POS[base + 2] = (p0 ? p0[2] : 0) + ((p1 ? p1[2] : 0) - (p0 ? p0[2] : 0)) * alpha;

    SCRATCH_ANIM_ROT[base] = (r0 ? r0[0] : 0) + ((r1 ? r1[0] : 0) - (r0 ? r0[0] : 0)) * alpha;
    SCRATCH_ANIM_ROT[base + 1] = (r0 ? r0[1] : 0) + ((r1 ? r1[1] : 0) - (r0 ? r0[1] : 0)) * alpha;
    SCRATCH_ANIM_ROT[base + 2] = (r0 ? r0[2] : 0) + ((r1 ? r1[2] : 0) - (r0 ? r0[2] : 0)) * alpha;

    const sx0 = s0 ? s0[0] : 1;
    const sy0 = s0 ? s0[1] : 1;
    const sz0 = s0 ? s0[2] : 1;
    SCRATCH_ANIM_SCALE[base] = sx0 + ((s1 ? s1[0] : 1) - sx0) * alpha;
    SCRATCH_ANIM_SCALE[base + 1] = sy0 + ((s1 ? s1[1] : 1) - sy0) * alpha;
    SCRATCH_ANIM_SCALE[base + 2] = sz0 + ((s1 ? s1[2] : 1) - sz0) * alpha;
  }
}

function resolvePartWorldMatrix(parts: readonly EcsCuboidPartDef[], idx: number): void {
  if (SCRATCH_PART_STATE[idx] === 2) return;
  if (SCRATCH_PART_STATE[idx] === 1) {
    // Break cycle gracefully by falling back to root
    SCRATCH_PART_MATS.set(SCRATCH_ROOT_MAT, idx * 16);
    SCRATCH_PART_STATE[idx] = 2;
    return;
  }
  SCRATCH_PART_STATE[idx] = 1;

  const part = parts[idx];
  const animBase = idx * 3;
  const hasAnim = SCRATCH_ANIM_HAS[idx] === 1;
  const tx = hasAnim ? SCRATCH_ANIM_POS[animBase] : 0;
  const ty = hasAnim ? SCRATCH_ANIM_POS[animBase + 1] : 0;
  const tz = hasAnim ? SCRATCH_ANIM_POS[animBase + 2] : 0;
  const rx = (part.rotDeg ? part.rotDeg[0] : 0) + (hasAnim ? SCRATCH_ANIM_ROT[animBase] : 0);
  const ry = (part.rotDeg ? part.rotDeg[1] : 0) + (hasAnim ? SCRATCH_ANIM_ROT[animBase + 1] : 0);
  const rz = (part.rotDeg ? part.rotDeg[2] : 0) + (hasAnim ? SCRATCH_ANIM_ROT[animBase + 2] : 0);
  const asx = hasAnim ? SCRATCH_ANIM_SCALE[animBase] : 1;
  const asy = hasAnim ? SCRATCH_ANIM_SCALE[animBase + 1] : 1;
  const asz = hasAnim ? SCRATCH_ANIM_SCALE[animBase + 2] : 1;

  const px = part.pivot ? part.pivot[0] : part.origin[0] + part.size[0] * 0.5;
  const py = part.pivot ? part.pivot[1] : part.origin[1] + part.size[1] * 0.5;
  const pz = part.pivot ? part.pivot[2] : part.origin[2] + part.size[2] * 0.5;

  writeTransformMatrix(SCRATCH_LOCAL_MAT, 0, tx, ty, tz, rx, ry, rz, asx, asy, asz, px, py, pz);

  const pIdx = SCRATCH_PARENT_IDX[idx];
  if (pIdx >= 0) {
    resolvePartWorldMatrix(parts, pIdx);
    mulMat4(SCRATCH_PART_MATS, pIdx * 16, SCRATCH_LOCAL_MAT, 0, SCRATCH_PART_MATS, idx * 16);
  } else {
    mulMat4(SCRATCH_ROOT_MAT, 0, SCRATCH_LOCAL_MAT, 0, SCRATCH_PART_MATS, idx * 16);
  }
  SCRATCH_PART_STATE[idx] = 2;
}

function pushCuboidFaceTransformed(
  gpu: GpuEngine,
  spriteId: SpriteId | null | undefined,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  nx: number, ny: number, nz: number,
  ao: number,
  tint: string | undefined,
  alpha: number,
  paletteRow: number,
  roughness: number,
  metallic: number,
  emissive: number,
  flash: number,
): void {
  SCRATCH_QUAD_POS[0] = x0; SCRATCH_QUAD_POS[1] = y0; SCRATCH_QUAD_POS[2] = z0;
  SCRATCH_QUAD_POS[3] = x1; SCRATCH_QUAD_POS[4] = y1; SCRATCH_QUAD_POS[5] = z1;
  SCRATCH_QUAD_POS[6] = x2; SCRATCH_QUAD_POS[7] = y2; SCRATCH_QUAD_POS[8] = z2;
  SCRATCH_QUAD_POS[9] = x3; SCRATCH_QUAD_POS[10] = y3; SCRATCH_QUAD_POS[11] = z3;

  SCRATCH_QUAD_NORM[0] = nx; SCRATCH_QUAD_NORM[1] = ny; SCRATCH_QUAD_NORM[2] = nz;
  SCRATCH_QUAD_NORM[3] = nx; SCRATCH_QUAD_NORM[4] = ny; SCRATCH_QUAD_NORM[5] = nz;
  SCRATCH_QUAD_NORM[6] = nx; SCRATCH_QUAD_NORM[7] = ny; SCRATCH_QUAD_NORM[8] = nz;
  SCRATCH_QUAD_NORM[9] = nx; SCRATCH_QUAD_NORM[10] = ny; SCRATCH_QUAD_NORM[11] = nz;

  const rect = spriteId ? gpu.atlas.getRect(spriteId) : null;
  SCRATCH_MESH_OPTS.atlasRect = rect;
  SCRATCH_MESH_OPTS.tint = tint;
  SCRATCH_MESH_OPTS.alpha = alpha;
  SCRATCH_MESH_OPTS.paletteRow = paletteRow;
  SCRATCH_MESH_OPTS.roughness = roughness;
  SCRATCH_MESH_OPTS.metallic = metallic;
  SCRATCH_MESH_OPTS.emissive = emissive;
  SCRATCH_MESH_OPTS.flash = flash;
  SCRATCH_MESH_OPTS.ao = ao;
  SCRATCH_MESH_OPTS.mode = rect ? 0 : 1;
  SCRATCH_MESH_OPTS.modelMatrix = SCRATCH_FACE_MAT;

  gpu.pushMesh3DIndexed(SCRATCH_QUAD_POS, SCRATCH_QUAD_NORM, SCRATCH_QUAD_UV, SCRATCH_QUAD_IDX, SCRATCH_MESH_OPTS);
}

/**
 * Zero-GC emitter for articulated multi-part cuboid models, keyframe animations, and raw meshes.
 */
export function emitModel3DToGpu(
  gpu: GpuEngine,
  model: EcsModel3DDef,
  worldX: number,
  worldY: number,
  worldZ: number,
  yawDeg = 0,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
  clipName?: string,
  animTimeSec = 0,
  tint?: string,
  flash = 0,
  alphaScale = 1,
): void {
  if (!(alphaScale > 0.001)) return;
  writeTransformMatrix(SCRATCH_ROOT_MAT, 0, worldX, worldY, worldZ, 0, 0, yawDeg, scaleX, scaleY, scaleZ, 0, 0, 0);

  const partCount = Math.min(MAX_MODEL_PARTS, model.parts.length);
  if (partCount > 0) {
    SCRATCH_PART_STATE.fill(0, 0, partCount);
    SCRATCH_ANIM_HAS.fill(0, 0, partCount);

    for (let i = 0; i < partCount; i++) {
      const pid = model.parts[i].parentId;
      let parentIdx = -1;
      if (pid) {
        for (let j = 0; j < partCount; j++) {
          if (j !== i && model.parts[j].id === pid) {
            parentIdx = j;
            break;
          }
        }
      }
      SCRATCH_PARENT_IDX[i] = parentIdx;
    }

    if (clipName && model.clips) {
      for (let c = 0; c < model.clips.length; c++) {
        if (model.clips[c].name === clipName) {
          sampleClipIntoScratch(model.clips[c], model.parts, partCount, animTimeSec);
          break;
        }
      }
    }

    for (let i = 0; i < partCount; i++) {
      resolvePartWorldMatrix(model.parts, i);

      const part = model.parts[i];
      const sx = part.size[0];
      const sy = part.size[1];
      const sz = part.size[2];
      if (!(sx > 0) || !(sy > 0) || !(sz > 0)) continue;

      const ox = part.origin[0];
      const oy = part.origin[1];
      const oz = part.origin[2];

      const mOff = i * 16;
      const m00 = SCRATCH_PART_MATS[mOff];
      const m10 = SCRATCH_PART_MATS[mOff + 1];
      const m20 = SCRATCH_PART_MATS[mOff + 2];
      const m01 = SCRATCH_PART_MATS[mOff + 4];
      const m11 = SCRATCH_PART_MATS[mOff + 5];
      const m21 = SCRATCH_PART_MATS[mOff + 6];
      const m02 = SCRATCH_PART_MATS[mOff + 8];
      const m12 = SCRATCH_PART_MATS[mOff + 9];
      const m22 = SCRATCH_PART_MATS[mOff + 10];
      const m03 = SCRATCH_PART_MATS[mOff + 12];
      const m13 = SCRATCH_PART_MATS[mOff + 13];
      const m23 = SCRATCH_PART_MATS[mOff + 14];

      const effTint = tint ?? part.tint;
      const alpha = (part.alpha ?? 1) * alphaScale;
      if (!(alpha > 0.001)) continue;
      const paletteRow = part.paletteRow ?? -1;
      const roughness = part.roughness ?? 0.58;
      const metallic = part.metallic ?? 0.08;
      const emissive = part.emissive ?? 0;

      const faces = part.faces;
      const hasPerFaceSide =
        faces.north !== undefined ||
        faces.east !== undefined ||
        faces.south !== undefined ||
        faces.west !== undefined;

      const det2D = m00 * m11 - m10 * m01;
      const dotXY = m00 * m01 + m10 * m11;
      const isYawOnly =
        Math.abs(m20) < 1e-5 &&
        Math.abs(m21) < 1e-5 &&
        Math.abs(m02) < 1e-5 &&
        Math.abs(m12) < 1e-5 &&
        Math.abs(dotXY) < 1e-4 &&
        m22 > 0 &&
        det2D > 0 &&
        flash === 0 &&
        !hasPerFaceSide;

      if (isYawOnly) {
        const lcx = ox + sx * 0.5;
        const lcy = oy + sy * 0.5;
        const wcx = m00 * lcx + m01 * lcy + m02 * oz + m03;
        const wcy = m10 * lcx + m11 * lcy + m12 * oz + m13;
        const wz = m20 * lcx + m21 * lcy + m22 * oz + m23;
        const wsx = Math.hypot(m00, m10) * sx;
        const wsy = Math.hypot(m01, m11) * sy;
        const wsz = m22 * sz;
        const totalYawDeg = Math.atan2(m10, m00) * RAD_TO_DEG;

        gpu.drawCuboid3D(
          faces.top ?? null,
          faces.side ?? faces.top ?? null,
          faces.bottom ?? faces.top ?? null,
          wcx - wsx * 0.5,
          wcy - wsy * 0.5,
          wz,
          wsx,
          wsy,
          wsz,
          0,
          effTint,
          alpha,
          paletteRow,
          roughness,
          metallic,
          emissive,
          totalYawDeg,
        );
      } else {
        SCRATCH_FACE_MAT.set(SCRATCH_PART_MATS.subarray(mOff, mOff + 16));
        const x0 = ox;
        const x1 = ox + sx;
        const y0 = oy;
        const y1 = oy + sy;
        const z0 = oz;
        const z1 = oz + sz;

        const topId = faces.top ?? null;
        const sideFallback = faces.side ?? topId;
        const botId = faces.bottom ?? topId;
        const northId = faces.north ?? sideFallback;
        const eastId = faces.east ?? sideFallback;
        const southId = faces.south ?? sideFallback;
        const westId = faces.west ?? sideFallback;

        // +Z Top
        pushCuboidFaceTransformed(
          gpu, topId,
          x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
          0, 0, 1, 1.0, effTint, alpha, paletteRow, roughness, metallic, emissive, flash,
        );
        // -Z Bottom
        pushCuboidFaceTransformed(
          gpu, botId,
          x0, y1, z0, x1, y1, z0, x1, y0, z0, x0, y0, z0,
          0, 0, -1, 0.78, effTint, alpha, paletteRow, roughness, metallic, emissive, flash,
        );
        // +Y South
        pushCuboidFaceTransformed(
          gpu, southId,
          x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0,
          0, 1, 0, 0.9, effTint, alpha, paletteRow, roughness, metallic, emissive, flash,
        );
        // -Y North
        pushCuboidFaceTransformed(
          gpu, northId,
          x1, y0, z1, x0, y0, z1, x0, y0, z0, x1, y0, z0,
          0, -1, 0, 0.9, effTint, alpha, paletteRow, roughness, metallic, emissive, flash,
        );
        // +X East
        pushCuboidFaceTransformed(
          gpu, eastId,
          x1, y1, z1, x1, y0, z1, x1, y0, z0, x1, y1, z0,
          1, 0, 0, 0.9, effTint, alpha, paletteRow, roughness, metallic, emissive, flash,
        );
        // -X West
        pushCuboidFaceTransformed(
          gpu, westId,
          x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0,
          -1, 0, 0, 0.9, effTint, alpha, paletteRow, roughness, metallic, emissive, flash,
        );
      }
    }
  }

  if (model.rawMesh) {
    const raw = model.rawMesh;
    const rawAlpha = (raw.alpha ?? 1) * alphaScale;
    if (rawAlpha > 0.001) {
      const rect = raw.spriteId ? gpu.atlas.getRect(raw.spriteId) : null;
      SCRATCH_MESH_OPTS.atlasRect = rect;
      SCRATCH_MESH_OPTS.tint = tint ?? raw.tint;
      SCRATCH_MESH_OPTS.alpha = rawAlpha;
      SCRATCH_MESH_OPTS.paletteRow = raw.paletteRow ?? -1;
      SCRATCH_MESH_OPTS.roughness = raw.roughness ?? 0.58;
      SCRATCH_MESH_OPTS.metallic = raw.metallic ?? 0.08;
      SCRATCH_MESH_OPTS.emissive = raw.emissive ?? 0;
      SCRATCH_MESH_OPTS.flash = flash;
      SCRATCH_MESH_OPTS.ao = 1.0;
      SCRATCH_MESH_OPTS.mode = rect ? 0 : 1;
      SCRATCH_MESH_OPTS.modelMatrix = SCRATCH_ROOT_MAT;

      gpu.pushMesh3DIndexed(raw.positions, raw.normals, raw.uvs ?? null, raw.indices, SCRATCH_MESH_OPTS);
    }
  }
}
