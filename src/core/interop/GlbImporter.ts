import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { convertGlbYUpToPixerZUp } from '../math/Perspective3DMath.ts';
import { sanitizeInteropId } from './InteropTypes.ts';

export const MAX_GLB_BYTES = 16 * 1024 * 1024;
export const MAX_GLB_VERTICES = 65536;
export const MAX_GLB_INDICES = 196608;

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const GLTF_MODE_TRIANGLES = 4;
const COMP_UNSIGNED_BYTE = 5121;
const COMP_UNSIGNED_SHORT = 5123;
const COMP_UNSIGNED_INT = 5125;
const COMP_FLOAT = 5126;

const MAX_GLTF_NODES = 4096;
const MAX_GLTF_NODE_DEPTH = 64;

export interface ImportedCuboidFacesDef {
  top?: SpriteId;
  bottom?: SpriteId;
  side?: SpriteId;
  north?: SpriteId;
  south?: SpriteId;
  east?: SpriteId;
  west?: SpriteId;
  all?: SpriteId;
}

export interface ImportedCuboidPartDef {
  id: string;
  name?: string;
  parentId?: string;
  origin: [number, number, number];
  size: [number, number, number];
  pivot?: [number, number, number];
  rotDeg?: [number, number, number];
  faces: ImportedCuboidFacesDef;
  tint?: string;
  alpha?: number;
  roughness?: number;
  metallic?: number;
  emissive?: number;
}

export interface ImportedRawMesh3DData {
  positions: Float32Array | number[];
  normals: Float32Array | number[];
  uvs?: Float32Array | number[] | null;
  indices: Uint32Array | Uint16Array | number[];
  spriteId?: SpriteId;
  tint?: string;
  alpha?: number;
  roughness?: number;
  metallic?: number;
  emissive?: number;
}

export interface ImportedModel3DAnimKeyframe {
  timeSec: number;
  value: [number, number, number];
}

export interface ImportedModel3DAnimTrack {
  partId: string;
  property: 'pos' | 'rotDeg' | 'scale';
  keyframes: ImportedModel3DAnimKeyframe[];
}

export interface ImportedModel3DAnimClip {
  name: string;
  durationSec: number;
  loop?: boolean;
  tracks: ImportedModel3DAnimTrack[];
}

export interface ImportedModel3DDef {
  id: string;
  name: string;
  parts: ImportedCuboidPartDef[];
  rawMesh?: ImportedRawMesh3DData;
  clips?: ImportedModel3DAnimClip[];
  boundsSize?: [number, number, number];
}

export interface GlbImportOptions {
  modelId?: string;
  name?: string;
  targetHeightPx?: number;
  spriteId?: SpriteId;
}

export interface GlbImportStats {
  vertexCount: number;
  triangleCount: number;
  hasUvs: boolean;
  hasNormals: boolean;
}

export interface GlbImportResult {
  model: ImportedModel3DDef;
  stats: GlbImportStats;
  warnings: string[];
}

interface GltfBufferDef {
  byteLength?: number;
  uri?: string;
}

interface GltfBufferViewDef {
  buffer?: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfAccessorDef {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  sparse?: unknown;
}

interface GltfPrimitiveDef {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
}

interface GltfMeshDef {
  name?: string;
  primitives?: GltfPrimitiveDef[];
}

interface GltfNodeDef {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfSceneDef {
  nodes?: number[];
}

interface GltfRoot {
  asset?: { version?: string };
  scene?: number;
  scenes?: GltfSceneDef[];
  nodes?: GltfNodeDef[];
  meshes?: GltfMeshDef[];
  accessors?: GltfAccessorDef[];
  bufferViews?: GltfBufferViewDef[];
  buffers?: GltfBufferDef[];
}

interface ValidatedAccessor {
  view: DataView;
  byteOffset: number;
  stride: number;
  count: number;
  componentType: number;
  componentCount: number;
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function encodeUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function componentByteSize(componentType: number): number {
  switch (componentType) {
    case COMP_UNSIGNED_BYTE:
      return 1;
    case COMP_UNSIGNED_SHORT:
      return 2;
    case COMP_UNSIGNED_INT:
    case COMP_FLOAT:
      return 4;
    default:
      return 0;
  }
}

function accessorComponentCount(type: string): number {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
      return 4;
    default:
      return 0;
  }
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function decodeBase64DataUri(uri: string, maxBytes: number): Uint8Array | null {
  const commaIdx = uri.indexOf(',');
  if (commaIdx < 0) return null;
  const header = uri.slice(0, commaIdx).toLowerCase();
  if (!header.startsWith('data:') || !header.includes(';base64')) return null;
  const b64 = uri.slice(commaIdx + 1).trim();
  const estBytes = Math.floor((b64.length * 3) / 4);
  if (estBytes > maxBytes) {
    throw new Error(`GLB embedded data URI exceeds MAX_GLB_BYTES (${maxBytes} bytes)`);
  }
  if (typeof atob !== 'function') return null;
  const bin = atob(b64);
  if (bin.length > maxBytes) {
    throw new Error(`GLB embedded data URI exceeds MAX_GLB_BYTES (${maxBytes} bytes)`);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i) & 0xff;
  }
  return out;
}

function buildBufferDataList(
  gltf: GltfRoot,
  binChunk: Uint8Array | null,
  warnings: string[],
): (Uint8Array | null)[] {
  const buffers = Array.isArray(gltf.buffers) ? gltf.buffers : [];
  const resolved: (Uint8Array | null)[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    if (!buf || typeof buf !== 'object') {
      resolved.push(null);
      continue;
    }
    if (typeof buf.uri === 'string' && buf.uri.length > 0) {
      if (buf.uri.startsWith('data:')) {
        resolved.push(decodeBase64DataUri(buf.uri, MAX_GLB_BYTES));
      } else {
        warnings.push(`Skipped external glTF buffer URI at buffers[${i}]`);
        resolved.push(null);
      }
      continue;
    }
    if (i === 0 && binChunk) {
      resolved.push(binChunk);
    } else {
      warnings.push(`Missing BIN chunk for buffers[${i}]`);
      resolved.push(null);
    }
  }
  return resolved;
}

function validateAccessor(
  gltf: GltfRoot,
  buffers: readonly (Uint8Array | null)[],
  accessorIndex: number,
  expectedType: string,
  allowedComponents: readonly number[],
  label: string,
): ValidatedAccessor {
  const accessors = gltf.accessors;
  const bufferViews = gltf.bufferViews;
  if (!Array.isArray(accessors) || !isNonNegativeInt(accessorIndex) || accessorIndex >= accessors.length) {
    throw new Error(`Invalid GLB ${label} accessor index: ${String(accessorIndex)}`);
  }
  const acc = accessors[accessorIndex];
  if (!acc || typeof acc !== 'object') {
    throw new Error(`Invalid GLB ${label} accessor object`);
  }
  if (acc.sparse !== undefined) {
    throw new Error(`Unsupported sparse accessor for ${label}`);
  }
  if (acc.type !== expectedType) {
    throw new Error(`GLB ${label} accessor must have type ${expectedType} (got ${String(acc.type)})`);
  }
  if (!allowedComponents.includes(acc.componentType)) {
    throw new Error(`GLB ${label} accessor has unsupported componentType ${String(acc.componentType)}`);
  }
  if (!isNonNegativeInt(acc.count)) {
    throw new Error(`GLB ${label} accessor has invalid count`);
  }

  const bvIdx = acc.bufferView;
  if (!Array.isArray(bufferViews) || !isNonNegativeInt(bvIdx) || bvIdx >= bufferViews.length) {
    throw new Error(`GLB ${label} accessor references invalid bufferView`);
  }
  const bv = bufferViews[bvIdx];
  if (!bv || typeof bv !== 'object' || !isNonNegativeInt(bv.byteLength)) {
    throw new Error(`GLB ${label} bufferView has invalid byteLength`);
  }
  const bufIdx = bv.buffer ?? 0;
  if (!isNonNegativeInt(bufIdx) || bufIdx >= buffers.length || !buffers[bufIdx]) {
    throw new Error(`GLB ${label} bufferView references unavailable buffer[${String(bufIdx)}]`);
  }
  const bufBytes = buffers[bufIdx]!;
  const bvOffset = bv.byteOffset ?? 0;
  if (!isNonNegativeInt(bvOffset) || bvOffset > bufBytes.byteLength || bv.byteLength > bufBytes.byteLength - bvOffset) {
    throw new Error(`GLB ${label} bufferView exceeds buffer bounds`);
  }

  const compCount = accessorComponentCount(acc.type);
  const compSize = componentByteSize(acc.componentType);
  const elemSize = compCount * compSize;
  const bvStride = bv.byteStride ?? 0;
  if (!isNonNegativeInt(bvStride) || (bvStride !== 0 && bvStride < elemSize)) {
    throw new Error(`GLB ${label} bufferView has invalid byteStride (${String(bvStride)})`);
  }
  const stride = bvStride > 0 ? bvStride : elemSize;

  const accOffset = acc.byteOffset ?? 0;
  if (!isNonNegativeInt(accOffset)) {
    throw new Error(`GLB ${label} accessor has invalid byteOffset`);
  }
  if (acc.count > 0) {
    const lastOffset = accOffset + (acc.count - 1) * stride;
    if (lastOffset > bv.byteLength || elemSize > bv.byteLength - lastOffset) {
      throw new Error(`GLB ${label} accessor range exceeds bufferView bounds`);
    }
  }

  return {
    view: new DataView(bufBytes.buffer, bufBytes.byteOffset + bvOffset, bv.byteLength),
    byteOffset: accOffset,
    stride,
    count: acc.count,
    componentType: acc.componentType,
    componentCount: compCount,
  };
}

function setIdentityMatrix(out: Float64Array): void {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
}

function multiplyMat4(a: Float64Array, b: Float64Array, out: Float64Array): void {
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
}

function buildNodeLocalMatrix(node: GltfNodeDef, out: Float64Array): void {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    let valid = true;
    for (let i = 0; i < 16; i++) {
      if (typeof node.matrix[i] !== 'number' || !Number.isFinite(node.matrix[i])) {
        valid = false;
        break;
      }
      out[i] = node.matrix[i];
    }
    if (valid) return;
  }

  const t = Array.isArray(node.translation) && node.translation.length >= 3 ? node.translation : null;
  const r = Array.isArray(node.rotation) && node.rotation.length >= 4 ? node.rotation : null;
  const s = Array.isArray(node.scale) && node.scale.length >= 3 ? node.scale : null;

  const tx = t && Number.isFinite(t[0]) ? t[0] : 0;
  const ty = t && Number.isFinite(t[1]) ? t[1] : 0;
  const tz = t && Number.isFinite(t[2]) ? t[2] : 0;

  let qx = r && Number.isFinite(r[0]) ? r[0] : 0;
  let qy = r && Number.isFinite(r[1]) ? r[1] : 0;
  let qz = r && Number.isFinite(r[2]) ? r[2] : 0;
  let qw = r && Number.isFinite(r[3]) ? r[3] : 1;
  const qLen = Math.hypot(qx, qy, qz, qw);
  if (qLen > 1e-8) {
    qx /= qLen;
    qy /= qLen;
    qz /= qLen;
    qw /= qLen;
  } else {
    qx = 0;
    qy = 0;
    qz = 0;
    qw = 1;
  }

  const sx = s && Number.isFinite(s[0]) ? s[0] : 1;
  const sy = s && Number.isFinite(s[1]) ? s[1] : 1;
  const sz = s && Number.isFinite(s[2]) ? s[2] : 1;

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;

  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;

  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;

  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
}

function computeUpper3x3DetAndNormalMat(m: Float64Array, outNormalMat: Float64Array): number {
  const a00 = m[0], a01 = m[4], a02 = m[8];
  const a10 = m[1], a11 = m[5], a12 = m[9];
  const a20 = m[2], a21 = m[6], a22 = m[10];

  const c00 = a11 * a22 - a12 * a21;
  const c01 = -(a10 * a22 - a12 * a20);
  const c02 = a10 * a21 - a11 * a20;

  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) > 1e-12) {
    const invDet = 1 / det;
    // Column-major inverse-transpose = cofactor matrix / det (columns of cofactor are rows of adjugate)
    outNormalMat[0] = c00 * invDet;
    outNormalMat[1] = c01 * invDet;
    outNormalMat[2] = c02 * invDet;

    outNormalMat[3] = -(a01 * a22 - a02 * a21) * invDet;
    outNormalMat[4] = (a00 * a22 - a02 * a20) * invDet;
    outNormalMat[5] = -(a00 * a21 - a01 * a20) * invDet;

    outNormalMat[6] = (a01 * a12 - a02 * a11) * invDet;
    outNormalMat[7] = -(a00 * a12 - a02 * a10) * invDet;
    outNormalMat[8] = (a00 * a11 - a01 * a10) * invDet;
  } else {
    outNormalMat[0] = a00; outNormalMat[1] = a10; outNormalMat[2] = a20;
    outNormalMat[3] = a01; outNormalMat[4] = a11; outNormalMat[5] = a21;
    outNormalMat[6] = a02; outNormalMat[7] = a12; outNormalMat[8] = a22;
  }
  return det;
}

function readIndexValue(acc: ValidatedAccessor, idx: number): number {
  const off = acc.byteOffset + idx * acc.stride;
  switch (acc.componentType) {
    case COMP_UNSIGNED_BYTE:
      return acc.view.getUint8(off);
    case COMP_UNSIGNED_SHORT:
      return acc.view.getUint16(off, true);
    case COMP_UNSIGNED_INT:
      return acc.view.getUint32(off, true);
    default:
      return 0;
  }
}

function resolveSceneRootNodes(gltf: GltfRoot): number[] {
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  if (nodes.length === 0) return [];
  const scenes = Array.isArray(gltf.scenes) ? gltf.scenes : [];
  if (scenes.length > 0) {
    const sceneIdx = isNonNegativeInt(gltf.scene) && gltf.scene < scenes.length ? gltf.scene : 0;
    const sceneNodes = scenes[sceneIdx]?.nodes;
    if (Array.isArray(sceneNodes)) {
      return sceneNodes.filter((n) => isNonNegativeInt(n) && n < nodes.length);
    }
  }
  const hasParent = new Uint8Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const children = nodes[i]?.children;
    if (!Array.isArray(children)) continue;
    for (const c of children) {
      if (isNonNegativeInt(c) && c < nodes.length) {
        hasParent[c] = 1;
      }
    }
  }
  const roots: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (hasParent[i] === 0) roots.push(i);
  }
  return roots.length > 0 ? roots : [0];
}

/**
 * Pure, DOM-free glTF 2.0 Binary (`.glb`) importer with strict byte/vertex/index bounds checks,
 * multi-node scene graph transform flattening, Y-Up -> Pixer Z-Up conversion, winding flip,
 * and automatic centering/grounding/scaling.
 */
export function parseGlbToModel3D(bytes: Uint8Array, options?: GlbImportOptions): GlbImportResult {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) {
    throw new Error('Invalid GLB file: input shorter than 12-byte header');
  }
  if (bytes.byteLength > MAX_GLB_BYTES) {
    throw new Error(`GLB file exceeds MAX_GLB_BYTES (${bytes.byteLength} > ${MAX_GLB_BYTES})`);
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    throw new Error(`Invalid GLB magic header: 0x${magic.toString(16)}`);
  }
  const version = dv.getUint32(4, true);
  if (version !== GLB_VERSION) {
    throw new Error(`Unsupported GLB version: ${version} (expected 2)`);
  }
  const totalLength = dv.getUint32(8, true);
  if (totalLength < 12 || totalLength > bytes.byteLength || totalLength > MAX_GLB_BYTES) {
    throw new Error(`Invalid GLB length header: ${totalLength} (buffer ${bytes.byteLength})`);
  }

  let offset = 12;
  let gltf: GltfRoot | null = null;
  let binChunk: Uint8Array | null = null;
  const warnings: string[] = [];

  while (offset < totalLength) {
    if (offset + 8 > totalLength) {
      throw new Error('Truncated GLB chunk header');
    }
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    offset += 8;
    if (chunkLen <= 0 || chunkLen > totalLength - offset) {
      throw new Error(`Invalid GLB chunk bounds: length=${chunkLen}, remaining=${totalLength - offset}`);
    }
    const chunkSlice = bytes.subarray(offset, offset + chunkLen);
    if (chunkType === CHUNK_JSON) {
      if (gltf !== null) {
        warnings.push('Duplicate JSON chunk ignored');
      } else {
        const jsonText = decodeUtf8(chunkSlice).replace(/\0+$/, '').trim();
        const parsed: unknown = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('GLB JSON chunk did not decode to a root object');
        }
        gltf = parsed as GltfRoot;
      }
    } else if (chunkType === CHUNK_BIN) {
      if (binChunk !== null) {
        warnings.push('Duplicate BIN chunk ignored');
      } else {
        binChunk = chunkSlice;
      }
    }
    offset += chunkLen;
  }

  if (!gltf) {
    throw new Error('GLB file is missing required JSON chunk');
  }

  const buffers = buildBufferDataList(gltf, binChunk, warnings);
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  if (nodes.length > MAX_GLTF_NODES) {
    throw new Error(`GLB node count (${nodes.length}) exceeds limit (${MAX_GLTF_NODES})`);
  }
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];

  const posOut: number[] = [];
  const normOut: number[] = [];
  const uvOut: number[] = [];
  const idxOut: number[] = [];

  let totalVertices = 0;
  let totalIndices = 0;
  let totalPrims = 0;
  let primsWithNormals = 0;
  let primsWithUvs = 0;

  const pixerScratch: [number, number, number] = [0, 0, 0];
  const normalMat = new Float64Array(9);
  const visited = new Uint8Array(nodes.length);

  const appendPrimitive = (prim: GltfPrimitiveDef, worldMat: Float64Array, worldDet: number): void => {
    const mode = prim.mode ?? GLTF_MODE_TRIANGLES;
    if (mode !== GLTF_MODE_TRIANGLES) {
      warnings.push(`Skipped non-triangle primitive mode=${mode}`);
      return;
    }
    const attrs = prim.attributes;
    if (!attrs || typeof attrs.POSITION !== 'number') {
      warnings.push('Skipped primitive missing POSITION attribute');
      return;
    }

    const posAcc = validateAccessor(gltf!, buffers, attrs.POSITION, 'VEC3', [COMP_FLOAT], 'POSITION');
    const primVertCount = posAcc.count;
    if (primVertCount === 0) return;

    if (totalVertices + primVertCount > MAX_GLB_VERTICES) {
      throw new Error(`GLB vertex count exceeds MAX_GLB_VERTICES (${MAX_GLB_VERTICES})`);
    }

    const normAcc =
      typeof attrs.NORMAL === 'number'
        ? validateAccessor(gltf!, buffers, attrs.NORMAL, 'VEC3', [COMP_FLOAT], 'NORMAL')
        : null;
    if (normAcc && normAcc.count < primVertCount) {
      throw new Error('GLB NORMAL accessor has fewer elements than POSITION');
    }

    const uvAcc =
      typeof attrs.TEXCOORD_0 === 'number'
        ? validateAccessor(gltf!, buffers, attrs.TEXCOORD_0, 'VEC2', [COMP_FLOAT], 'TEXCOORD_0')
        : null;
    if (uvAcc && uvAcc.count < primVertCount) {
      throw new Error('GLB TEXCOORD_0 accessor has fewer elements than POSITION');
    }

    const idxAcc =
      typeof prim.indices === 'number'
        ? validateAccessor(
            gltf!,
            buffers,
            prim.indices,
            'SCALAR',
            [COMP_UNSIGNED_BYTE, COMP_UNSIGNED_SHORT, COMP_UNSIGNED_INT],
            'indices',
          )
        : null;

    const rawIndexCount = idxAcc ? idxAcc.count : primVertCount;
    const triIndexCount = Math.floor(rawIndexCount / 3) * 3;
    if (triIndexCount === 0) return;
    if (totalIndices + triIndexCount > MAX_GLB_INDICES) {
      throw new Error(`GLB index count exceeds MAX_GLB_INDICES (${MAX_GLB_INDICES})`);
    }

    const baseVertex = totalVertices;
    for (let v = 0; v < primVertCount; v++) {
      const pOff = posAcc.byteOffset + v * posAcc.stride;
      const lx = posAcc.view.getFloat32(pOff, true);
      const ly = posAcc.view.getFloat32(pOff + 4, true);
      const lz = posAcc.view.getFloat32(pOff + 8, true);

      const gx = worldMat[0] * lx + worldMat[4] * ly + worldMat[8] * lz + worldMat[12];
      const gy = worldMat[1] * lx + worldMat[5] * ly + worldMat[9] * lz + worldMat[13];
      const gz = worldMat[2] * lx + worldMat[6] * ly + worldMat[10] * lz + worldMat[14];

      convertGlbYUpToPixerZUp(
        Number.isFinite(gx) ? gx : 0,
        Number.isFinite(gy) ? gy : 0,
        Number.isFinite(gz) ? gz : 0,
        pixerScratch,
      );
      posOut.push(pixerScratch[0], pixerScratch[1], pixerScratch[2]);

      if (normAcc) {
        const nOff = normAcc.byteOffset + v * normAcc.stride;
        const lnx = normAcc.view.getFloat32(nOff, true);
        const lny = normAcc.view.getFloat32(nOff + 4, true);
        const lnz = normAcc.view.getFloat32(nOff + 8, true);
        const gnx = normalMat[0] * lnx + normalMat[3] * lny + normalMat[6] * lnz;
        const gny = normalMat[1] * lnx + normalMat[4] * lny + normalMat[7] * lnz;
        const gnz = normalMat[2] * lnx + normalMat[5] * lny + normalMat[8] * lnz;
        convertGlbYUpToPixerZUp(gnx, gny, gnz, pixerScratch);
        const nLen = Math.hypot(pixerScratch[0], pixerScratch[1], pixerScratch[2]) || 1;
        normOut.push(pixerScratch[0] / nLen, pixerScratch[1] / nLen, pixerScratch[2] / nLen);
      } else {
        normOut.push(0, 0, 0);
      }

      if (uvAcc) {
        const uOff = uvAcc.byteOffset + v * uvAcc.stride;
        const u = uvAcc.view.getFloat32(uOff, true);
        const tv = uvAcc.view.getFloat32(uOff + 4, true);
        uvOut.push(Number.isFinite(u) ? u : 0, Number.isFinite(tv) ? tv : 0);
      } else {
        uvOut.push(0.5, 0.5);
      }
    }

    // Converting glTF Y-Up -> Pixer Z-Up flips handedness (det = -1); swap (i0, i1, i2) -> (i0, i2, i1)
    // unless the node's own world transform already had a negative determinant.
    const flipWinding = worldDet >= 0;
    for (let i = 0; i < triIndexCount; i += 3) {
      const r0 = idxAcc ? readIndexValue(idxAcc, i) : i;
      const r1 = idxAcc ? readIndexValue(idxAcc, i + 1) : i + 1;
      const r2 = idxAcc ? readIndexValue(idxAcc, i + 2) : i + 2;
      if (r0 >= primVertCount || r1 >= primVertCount || r2 >= primVertCount) {
        throw new Error(`GLB triangle index out of vertex bounds (${r0},${r1},${r2} >= ${primVertCount})`);
      }
      const i0 = baseVertex + r0;
      const i1 = baseVertex + (flipWinding ? r2 : r1);
      const i2 = baseVertex + (flipWinding ? r1 : r2);
      idxOut.push(i0, i1, i2);

      if (!normAcc) {
        const ax = posOut[i0 * 3], ay = posOut[i0 * 3 + 1], az = posOut[i0 * 3 + 2];
        const bx = posOut[i1 * 3], by = posOut[i1 * 3 + 1], bz = posOut[i1 * 3 + 2];
        const cx = posOut[i2 * 3], cy = posOut[i2 * 3 + 1], cz = posOut[i2 * 3 + 2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const fnx = e1y * e2z - e1z * e2y;
        const fny = e1z * e2x - e1x * e2z;
        const fnz = e1x * e2y - e1y * e2x;
        normOut[i0 * 3] += fnx; normOut[i0 * 3 + 1] += fny; normOut[i0 * 3 + 2] += fnz;
        normOut[i1 * 3] += fnx; normOut[i1 * 3 + 1] += fny; normOut[i1 * 3 + 2] += fnz;
        normOut[i2 * 3] += fnx; normOut[i2 * 3 + 1] += fny; normOut[i2 * 3 + 2] += fnz;
      }
    }

    if (!normAcc) {
      for (let v = 0; v < primVertCount; v++) {
        const b = (baseVertex + v) * 3;
        const len = Math.hypot(normOut[b], normOut[b + 1], normOut[b + 2]);
        if (len > 1e-8) {
          normOut[b] /= len;
          normOut[b + 1] /= len;
          normOut[b + 2] /= len;
        } else {
          normOut[b] = 0;
          normOut[b + 1] = 0;
          normOut[b + 2] = 1;
        }
      }
    }

    totalVertices += primVertCount;
    totalIndices += triIndexCount;
    totalPrims++;
    if (normAcc) primsWithNormals++;
    if (uvAcc) primsWithUvs++;
  };

  const traverseNode = (nodeIdx: number, parentWorld: Float64Array, depth: number): void => {
    if (depth > MAX_GLTF_NODE_DEPTH) {
      warnings.push(`GLB node hierarchy exceeded max depth ${MAX_GLTF_NODE_DEPTH}`);
      return;
    }
    if (!isNonNegativeInt(nodeIdx) || nodeIdx >= nodes.length) return;
    if (visited[nodeIdx] !== 0) {
      warnings.push(`Cycle detected in GLB node hierarchy at node ${nodeIdx}`);
      return;
    }
    visited[nodeIdx] = 1;

    const node = nodes[nodeIdx];
    if (node && typeof node === 'object') {
      const localMat = new Float64Array(16);
      const worldMat = new Float64Array(16);
      buildNodeLocalMatrix(node, localMat);
      multiplyMat4(parentWorld, localMat, worldMat);

      if (isNonNegativeInt(node.mesh) && node.mesh < meshes.length) {
        const mesh = meshes[node.mesh];
        const det = computeUpper3x3DetAndNormalMat(worldMat, normalMat);
        if (mesh && Array.isArray(mesh.primitives)) {
          for (const prim of mesh.primitives) {
            if (prim && typeof prim === 'object') {
              appendPrimitive(prim, worldMat, det);
            }
          }
        }
      }

      if (Array.isArray(node.children)) {
        for (const childIdx of node.children) {
          traverseNode(childIdx, worldMat, depth + 1);
        }
      }
    }

    visited[nodeIdx] = 0;
  };

  const rootWorld = new Float64Array(16);
  setIdentityMatrix(rootWorld);
  const rootNodes = resolveSceneRootNodes(gltf);

  if (rootNodes.length > 0) {
    for (const rootIdx of rootNodes) {
      traverseNode(rootIdx, rootWorld, 0);
    }
  } else if (meshes.length > 0) {
    // Fallback: some minimal GLBs omit scenes/nodes and list meshes directly
    computeUpper3x3DetAndNormalMat(rootWorld, normalMat);
    for (const mesh of meshes) {
      if (mesh && Array.isArray(mesh.primitives)) {
        for (const prim of mesh.primitives) {
          if (prim && typeof prim === 'object') {
            appendPrimitive(prim, rootWorld, 1);
          }
        }
      }
    }
  }

  const positions = new Float32Array(posOut.length);
  const normals = new Float32Array(normOut.length);
  const uvs = new Float32Array(uvOut.length);
  const indices = new Uint32Array(idxOut.length);

  if (totalVertices > 0) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < totalVertices; i++) {
      const x = posOut[i * 3];
      const y = posOut[i * 3 + 1];
      const z = posOut[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const rawDz = maxZ - minZ;
    const rawTargetH = options?.targetHeightPx ?? 32;
    const targetH = Number.isFinite(rawTargetH) && rawTargetH > 0 ? rawTargetH : 32;
    const scale = rawDz > 1e-6 ? targetH / rawDz : 1;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;

    for (let i = 0; i < totalVertices; i++) {
      positions[i * 3] = (posOut[i * 3] - cx) * scale;
      positions[i * 3 + 1] = (posOut[i * 3 + 1] - cy) * scale;
      positions[i * 3 + 2] = (posOut[i * 3 + 2] - minZ) * scale;
      normals[i * 3] = normOut[i * 3];
      normals[i * 3 + 1] = normOut[i * 3 + 1];
      normals[i * 3 + 2] = normOut[i * 3 + 2];
      uvs[i * 2] = uvOut[i * 2];
      uvs[i * 2 + 1] = uvOut[i * 2 + 1];
    }
    for (let i = 0; i < idxOut.length; i++) {
      indices[i] = idxOut[i];
    }

    const boundsW = (maxX - minX) * scale;
    const boundsD = (maxY - minY) * scale;
    const boundsH = rawDz * scale;

    const rawName = options?.name ?? meshes[0]?.name ?? 'Imported GLB Model';
    const id = sanitizeInteropId(options?.modelId ?? rawName, 'glb_model');

    return {
      model: {
        id,
        name: rawName,
        parts: [],
        rawMesh: {
          positions,
          normals,
          uvs,
          indices,
          spriteId: options?.spriteId,
          roughness: 0.58,
          metallic: 0.1,
        },
        boundsSize: [boundsW, boundsD, boundsH],
      },
      stats: {
        vertexCount: totalVertices,
        triangleCount: Math.floor(totalIndices / 3),
        hasUvs: totalPrims > 0 && primsWithUvs === totalPrims,
        hasNormals: totalPrims > 0 && primsWithNormals === totalPrims,
      },
      warnings,
    };
  }

  const rawName = options?.name ?? meshes[0]?.name ?? 'Empty GLB Model';
  const id = sanitizeInteropId(options?.modelId ?? rawName, 'glb_model');
  warnings.push('No triangle geometry decoded from GLB');
  return {
    model: {
      id,
      name: rawName,
      parts: [],
      rawMesh: {
        positions,
        normals,
        uvs,
        indices,
        spriteId: options?.spriteId,
        roughness: 0.58,
        metallic: 0.1,
      },
      boundsSize: [0, 0, 0],
    },
    stats: {
      vertexCount: 0,
      triangleCount: 0,
      hasUvs: false,
      hasNormals: false,
    },
    warnings,
  };
}

/**
 * Constructs a clean, spec-compliant binary GLB v2 shaded unit cube
 * (24 vertices, 12 triangles, outward normals, UVs) for unit tests & one-click demo import.
 */
export function buildSampleGlbCube(): Uint8Array {
  // 6 faces x 4 vertices in glTF Y-Up right-handed coordinates: X in [-0.5, 0.5], Y in [0, 1], Z in [-0.5, 0.5]
  const positions = new Float32Array([
    // +Z Front
    -0.5, 0, 0.5,   0.5, 0, 0.5,   0.5, 1, 0.5,  -0.5, 1, 0.5,
    // -Z Back
    0.5, 0, -0.5,  -0.5, 0, -0.5, -0.5, 1, -0.5,  0.5, 1, -0.5,
    // +X Right
    0.5, 0, 0.5,   0.5, 0, -0.5,  0.5, 1, -0.5,  0.5, 1, 0.5,
    // -X Left
    -0.5, 0, -0.5, -0.5, 0, 0.5,  -0.5, 1, 0.5, -0.5, 1, -0.5,
    // +Y Top
    -0.5, 1, 0.5,   0.5, 1, 0.5,   0.5, 1, -0.5, -0.5, 1, -0.5,
    // -Y Bottom
    -0.5, 0, -0.5,  0.5, 0, -0.5,  0.5, 0, 0.5, -0.5, 0, 0.5,
  ]);

  const normals = new Float32Array([
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
    -1, 0, 0, -1, 0, 0,  -1, 0, 0,  -1, 0, 0,
    0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
    0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
  ]);

  const uvs = new Float32Array([
    0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0,
  ]);

  const indices = new Uint16Array(36);
  for (let f = 0; f < 6; f++) {
    const v = f * 4;
    const i = f * 6;
    indices[i] = v;
    indices[i + 1] = v + 1;
    indices[i + 2] = v + 2;
    indices[i + 3] = v;
    indices[i + 4] = v + 2;
    indices[i + 5] = v + 3;
  }

  const posBytes = positions.byteLength; // 288
  const normBytes = normals.byteLength; // 288
  const uvBytes = uvs.byteLength; // 192
  const idxBytes = indices.byteLength; // 72
  const binUnpaddedLen = posBytes + normBytes + uvBytes + idxBytes; // 840
  const binLen = (binUnpaddedLen + 3) & ~3;

  const gltfJson = JSON.stringify({
    asset: { version: '2.0', generator: 'Pixer-GlbImporter-Sample' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'SampleShadedCube', mesh: 0 }],
    meshes: [
      {
        name: 'SampleShadedCube',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            mode: 4,
          },
        ],
      },
    ],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes },
      { buffer: 0, byteOffset: posBytes, byteLength: normBytes },
      { buffer: 0, byteOffset: posBytes + normBytes, byteLength: uvBytes },
      { buffer: 0, byteOffset: posBytes + normBytes + uvBytes, byteLength: idxBytes },
    ],
    accessors: [
      { bufferView: 0, componentType: COMP_FLOAT, count: 24, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
      { bufferView: 1, componentType: COMP_FLOAT, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: COMP_FLOAT, count: 24, type: 'VEC2' },
      { bufferView: 3, componentType: COMP_UNSIGNED_SHORT, count: 36, type: 'SCALAR' },
    ],
  });

  const jsonRaw = encodeUtf8(gltfJson);
  const jsonPaddedLen = (jsonRaw.byteLength + 3) & ~3;
  const totalLen = 12 + 8 + jsonPaddedLen + 8 + binLen;

  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, GLB_VERSION, true);
  dv.setUint32(8, totalLen, true);

  let cursor = 12;
  dv.setUint32(cursor, jsonPaddedLen, true);
  dv.setUint32(cursor + 4, CHUNK_JSON, true);
  cursor += 8;
  out.set(jsonRaw, cursor);
  for (let p = jsonRaw.byteLength; p < jsonPaddedLen; p++) {
    out[cursor + p] = 0x20;
  }
  cursor += jsonPaddedLen;

  dv.setUint32(cursor, binLen, true);
  dv.setUint32(cursor + 4, CHUNK_BIN, true);
  cursor += 8;
  out.set(new Uint8Array(positions.buffer), cursor);
  out.set(new Uint8Array(normals.buffer), cursor + posBytes);
  out.set(new Uint8Array(uvs.buffer), cursor + posBytes + normBytes);
  out.set(new Uint8Array(indices.buffer), cursor + posBytes + normBytes + uvBytes);

  return out;
}
