import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type {
  ImportedCuboidFacesDef,
  ImportedCuboidPartDef,
  ImportedModel3DAnimClip,
  ImportedModel3DAnimKeyframe,
  ImportedModel3DAnimTrack,
  ImportedModel3DDef,
  ImportedRawMesh3DData,
} from './GlbImporter.ts';
import { sanitizeInteropId } from './InteropTypes.ts';

export type {
  ImportedCuboidFacesDef,
  ImportedCuboidPartDef,
  ImportedModel3DAnimClip,
  ImportedModel3DAnimKeyframe,
  ImportedModel3DAnimTrack,
  ImportedModel3DDef,
  ImportedRawMesh3DData,
};

export const MAX_BBMODEL_BYTES = 8 * 1024 * 1024;
export const MAX_BBMODEL_ELEMENTS = 512;

export interface BbmodelImportOptions {
  modelId?: string;
  name?: string;
  defaultSpriteId?: SpriteId;
}

export interface BbmodelImportResult {
  model: ImportedModel3DDef;
  partCount: number;
  warnings: string[];
}

interface BbmodelElementRaw {
  name?: unknown;
  type?: unknown;
  from?: unknown;
  to?: unknown;
  origin?: unknown;
  rotation?: unknown;
  inflate?: unknown;
  visibility?: unknown;
  export?: unknown;
  tint?: unknown;
  roughness?: unknown;
}

interface BbmodelRootRaw {
  name?: unknown;
  model_identifier?: unknown;
  elements?: unknown;
}

function measureUtf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length * 3;
}

function readVec3(val: unknown): [number, number, number] | null {
  if (!Array.isArray(val) || val.length < 3) return null;
  const x = val[0];
  const y = val[1];
  const z = val[2];
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof z !== 'number' || !Number.isFinite(z)
  ) {
    return null;
  }
  return [x, y, z];
}

function isHexColor(val: unknown): val is string {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val);
}

/**
 * Pure, DOM-free Blockbench (`.bbmodel` JSON) importer.
 * Converts Blockbench Y-Up cuboid elements into Pixer Z-Up `ImportedCuboidPartDef[]`
 * (`pixerX = bbX`, `pixerY = bbZ`, `pixerZ = bbY`), grounds `minZ = 0`, and centers X/Y at `0`.
 */
export function parseBbmodelToModel3D(
  jsonText: string,
  options?: BbmodelImportOptions,
): BbmodelImportResult {
  if (typeof jsonText !== 'string' || jsonText.length === 0) {
    throw new Error('Invalid .bbmodel input: empty JSON text');
  }
  if (jsonText.length > MAX_BBMODEL_BYTES || measureUtf8Bytes(jsonText) > MAX_BBMODEL_BYTES) {
    throw new Error(`BBModel JSON exceeds MAX_BBMODEL_BYTES (${MAX_BBMODEL_BYTES} bytes)`);
  }

  const parsed: unknown = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid .bbmodel root: expected JSON object');
  }
  const root = parsed as BbmodelRootRaw;

  if (!Array.isArray(root.elements)) {
    throw new Error('Invalid .bbmodel: missing elements array');
  }
  if (root.elements.length > MAX_BBMODEL_ELEMENTS) {
    throw new Error(
      `BBModel element count (${root.elements.length}) exceeds MAX_BBMODEL_ELEMENTS (${MAX_BBMODEL_ELEMENTS})`,
    );
  }

  const defaultSpriteId: SpriteId = options?.defaultSpriteId ?? 'brick';
  const warnings: string[] = [];
  const parts: ImportedCuboidPartDef[] = [];
  const usedIds = new Set<string>();

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < root.elements.length; i++) {
    const rawEl = root.elements[i];
    if (!rawEl || typeof rawEl !== 'object' || Array.isArray(rawEl)) {
      warnings.push(`Skipped malformed element[${i}]`);
      continue;
    }
    const el = rawEl as BbmodelElementRaw;
    if (el.visibility === false || el.export === false) {
      continue;
    }
    if (typeof el.type === 'string' && el.type !== 'cube') {
      warnings.push(`Skipped non-cuboid element[${i}] of type "${el.type}"`);
      continue;
    }

    const from = readVec3(el.from);
    const to = readVec3(el.to);
    if (!from || !to) {
      warnings.push(`Skipped element[${i}] missing valid from/to coordinates`);
      continue;
    }

    const inflate = typeof el.inflate === 'number' && Number.isFinite(el.inflate) ? el.inflate : 0;

    // Blockbench Y-Up -> Pixer Z-Up: (pixerX = bbX, pixerY = bbZ, pixerZ = bbY)
    const x0 = Math.min(from[0], to[0]) - inflate;
    const x1 = Math.max(from[0], to[0]) + inflate;
    const y0 = Math.min(from[2], to[2]) - inflate;
    const y1 = Math.max(from[2], to[2]) + inflate;
    const z0 = Math.min(from[1], to[1]) - inflate;
    const z1 = Math.max(from[1], to[1]) + inflate;

    let dx = x1 - x0;
    let dy = y1 - y0;
    let dz = z1 - z0;
    if (dx <= 0 || dy <= 0 || dz <= 0) {
      warnings.push(`Clamped zero-thickness axis on element[${i}]`);
      if (dx <= 0) dx = 0.1;
      if (dy <= 0) dy = 0.1;
      if (dz <= 0) dz = 0.1;
    }

    if (x0 < minX) minX = x0;
    if (x0 + dx > maxX) maxX = x0 + dx;
    if (y0 < minY) minY = y0;
    if (y0 + dy > maxY) maxY = y0 + dy;
    if (z0 < minZ) minZ = z0;
    if (z0 + dz > maxZ) maxZ = z0 + dz;

    const bbOrigin = readVec3(el.origin);
    const pivot: [number, number, number] | undefined = bbOrigin
      ? [bbOrigin[0], bbOrigin[2], bbOrigin[1]]
      : undefined;

    const bbRot = readVec3(el.rotation);
    const rotDeg: [number, number, number] | undefined = bbRot
      ? [bbRot[0], bbRot[2], bbRot[1]]
      : undefined;

    const baseId = sanitizeInteropId(
      typeof el.name === 'string' && el.name.trim().length > 0 ? el.name : `cube_${i}`,
      `cube_${i}`,
    );
    let partId = baseId;
    let suffix = 2;
    while (usedIds.has(partId)) {
      partId = `${baseId}_${suffix++}`;
    }
    usedIds.add(partId);

    const part: ImportedCuboidPartDef = {
      id: partId,
      name: typeof el.name === 'string' && el.name.trim().length > 0 ? el.name : partId,
      origin: [x0, y0, z0],
      size: [dx, dy, dz],
      faces: {
        all: defaultSpriteId,
        top: defaultSpriteId,
        bottom: defaultSpriteId,
        side: defaultSpriteId,
        north: defaultSpriteId,
        south: defaultSpriteId,
        east: defaultSpriteId,
        west: defaultSpriteId,
      },
      roughness:
        typeof el.roughness === 'number' && Number.isFinite(el.roughness)
          ? Math.max(0, Math.min(1, el.roughness))
          : 0.6,
    };
    if (pivot) part.pivot = pivot;
    if (rotDeg) part.rotDeg = rotDeg;
    if (isHexColor(el.tint)) part.tint = el.tint;

    parts.push(part);
  }

  let boundsSize: [number, number, number] = [0, 0, 0];
  if (parts.length > 0) {
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const groundZ = minZ;

    for (const part of parts) {
      part.origin[0] -= centerX;
      part.origin[1] -= centerY;
      part.origin[2] -= groundZ;
      if (part.pivot) {
        part.pivot[0] -= centerX;
        part.pivot[1] -= centerY;
        part.pivot[2] -= groundZ;
      }
    }

    boundsSize = [maxX - minX, maxY - minY, maxZ - minZ];
  } else {
    warnings.push('No visible cuboid elements found in .bbmodel');
  }

  const rawName =
    options?.name ??
    (typeof root.name === 'string' && root.name.trim().length > 0 ? root.name.trim() : null) ??
    (typeof root.model_identifier === 'string' && root.model_identifier.trim().length > 0
      ? root.model_identifier.trim()
      : null) ??
    'Imported BBModel';

  const id = sanitizeInteropId(options?.modelId ?? rawName, 'bbmodel_prop');

  return {
    model: {
      id,
      name: rawName,
      parts,
      boundsSize,
    },
    partCount: parts.length,
    warnings,
  };
}

/**
 * Builds a multi-part Blockbench (`.bbmodel`) voxel Knight Relic Chest JSON sample
 * for unit tests and one-click demo import.
 */
export function buildSampleBbmodelJson(): string {
  return JSON.stringify(
    {
      meta: {
        format_version: '4.10',
        model_format: 'free',
        box_uv: false,
      },
      name: 'Knight_Relic_Chest',
      model_identifier: 'knight_relic_chest',
      resolution: { width: 32, height: 32 },
      elements: [
        {
          name: 'stone_plinth',
          from: [-10, 0, -7],
          to: [10, 3, 7],
          origin: [0, 0, 0],
          rotation: [0, 0, 0],
          tint: '#475569',
          roughness: 0.78,
        },
        {
          name: 'chest_body',
          from: [-8, 3, -5],
          to: [8, 13, 5],
          origin: [0, 3, 0],
          rotation: [0, 0, 0],
          tint: '#92400e',
          roughness: 0.62,
        },
        {
          name: 'left_iron_band',
          from: [-7, 3, -5.5],
          to: [-5, 13, 5.5],
          origin: [-6, 8, 0],
          rotation: [0, 0, 0],
          tint: '#cbd5e1',
          roughness: 0.35,
        },
        {
          name: 'right_iron_band',
          from: [5, 3, -5.5],
          to: [7, 13, 5.5],
          origin: [6, 8, 0],
          rotation: [0, 0, 0],
          tint: '#cbd5e1',
          roughness: 0.35,
        },
        {
          name: 'hinged_chest_lid',
          from: [-8, 13, -5],
          to: [8, 18, 5],
          origin: [0, 13, -5],
          rotation: [-18, 0, 0],
          tint: '#b45309',
          roughness: 0.55,
        },
        {
          name: 'gold_lock_clasp',
          from: [-2, 11, 5],
          to: [2, 15, 6.5],
          origin: [0, 13, 5],
          rotation: [0, 0, 0],
          tint: '#fbbf24',
          roughness: 0.28,
        },
      ],
    },
    null,
    2,
  );
}
