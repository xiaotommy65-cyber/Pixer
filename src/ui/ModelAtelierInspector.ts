import type { SpriteId } from '../assets/TextureAtlas.ts';
import type {
  EcsCuboidFacesDef,
  EcsCuboidPartDef,
  EcsModel3DAnimClip,
  EcsModel3DDef,
  EcsRawMesh3DData,
} from '../core/ecs/EcsModel3D.ts';
import type { ImportedModel3DDef } from '../core/interop/GlbImporter.ts';
import { sanitizeInteropId } from '../core/interop/InteropTypes.ts';

export interface MutableCuboidPart {
  id: string;
  parentId?: string;
  origin: [number, number, number];
  size: [number, number, number];
  pivot: [number, number, number];
  rotDeg: [number, number, number];
  faces: EcsCuboidFacesDef;
  tint: string;
  alpha: number;
  paletteRow: number;
  roughness: number;
  metallic: number;
  emissive: number;
}

export interface MutableModel3D {
  id: string;
  name: string;
  parts: MutableCuboidPart[];
  rawMesh?: EcsRawMesh3DData;
  clips?: readonly EcsModel3DAnimClip[];
  boundsSize?: [number, number, number];
}

const FACE_SLOTS: readonly { key: keyof EcsCuboidFacesDef; label: string }[] = [
  { key: 'top', label: '頂面 (Top +Z)' },
  { key: 'bottom', label: '底面 (Bottom -Z)' },
  { key: 'north', label: '北面 (North -Y)' },
  { key: 'south', label: '南面 (South +Y)' },
  { key: 'east', label: '東面 (East +X)' },
  { key: 'west', label: '西面 (West -X)' },
  { key: 'side', label: '側面通用 (Side)' },
];

export function makeButton(cls: string, text: string, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  if (title) b.title = title;
  return b;
}

export function cloneRawMesh(
  raw: EcsRawMesh3DData | ImportedModel3DDef['rawMesh'],
): EcsRawMesh3DData | undefined {
  if (!raw) return undefined;
  return {
    positions:
      raw.positions instanceof Float32Array ? new Float32Array(raw.positions) : [...raw.positions],
    normals: raw.normals instanceof Float32Array ? new Float32Array(raw.normals) : [...raw.normals],
    uvs:
      raw.uvs == null
        ? undefined
        : raw.uvs instanceof Float32Array
          ? new Float32Array(raw.uvs)
          : [...raw.uvs],
    indices:
      raw.indices instanceof Uint32Array
        ? new Uint32Array(raw.indices)
        : raw.indices instanceof Uint16Array
          ? new Uint16Array(raw.indices)
          : [...raw.indices],
    spriteId: raw.spriteId ?? undefined,
    tint: raw.tint,
    alpha: raw.alpha,
    paletteRow: 'paletteRow' in raw ? raw.paletteRow : -1,
    roughness: raw.roughness,
    metallic: raw.metallic,
    emissive: raw.emissive,
  };
}

export function toMutableModel(src: EcsModel3DDef | ImportedModel3DDef): MutableModel3D {
  const parts: MutableCuboidPart[] = src.parts.map((p, idx) => {
    const ox = p.origin[0];
    const oy = p.origin[1];
    const oz = p.origin[2];
    const sx = p.size[0];
    const sy = p.size[1];
    const sz = p.size[2];
    const rawFaces = p.faces as EcsCuboidFacesDef & { all?: SpriteId | null };
    const allFallback = rawFaces.all ?? null;
    const faces: EcsCuboidFacesDef = {
      top: rawFaces.top ?? allFallback,
      bottom: rawFaces.bottom ?? allFallback,
      side: rawFaces.side ?? allFallback,
      ...(rawFaces.north !== undefined ? { north: rawFaces.north } : {}),
      ...(rawFaces.south !== undefined ? { south: rawFaces.south } : {}),
      ...(rawFaces.east !== undefined ? { east: rawFaces.east } : {}),
      ...(rawFaces.west !== undefined ? { west: rawFaces.west } : {}),
    };
    return {
      id: p.id || `part_${idx + 1}`,
      ...(p.parentId ? { parentId: p.parentId } : {}),
      origin: [ox, oy, oz],
      size: [sx, sy, sz],
      pivot: p.pivot
        ? [p.pivot[0], p.pivot[1], p.pivot[2]]
        : [ox + sx * 0.5, oy + sy * 0.5, oz + sz * 0.5],
      rotDeg: p.rotDeg ? [p.rotDeg[0], p.rotDeg[1], p.rotDeg[2]] : [0, 0, 0],
      faces,
      tint: p.tint ?? '#ffffff',
      alpha: p.alpha ?? 1,
      paletteRow: 'paletteRow' in p && typeof p.paletteRow === 'number' ? p.paletteRow : -1,
      roughness: p.roughness ?? 0.58,
      metallic: p.metallic ?? 0.08,
      emissive: p.emissive ?? 0,
    };
  });

  return {
    id: sanitizeInteropId(src.id, 'model_3d'),
    name: src.name || src.id || '3D 積木模型',
    parts,
    ...(src.rawMesh ? { rawMesh: cloneRawMesh(src.rawMesh) } : {}),
    ...(src.clips ? { clips: JSON.parse(JSON.stringify(src.clips)) as EcsModel3DAnimClip[] } : {}),
    ...(src.boundsSize
      ? { boundsSize: [src.boundsSize[0], src.boundsSize[1], src.boundsSize[2]] }
      : {}),
  };
}

export function toImmutableModel(src: MutableModel3D): EcsModel3DDef {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const parts: EcsCuboidPartDef[] = src.parts.map((p) => {
    const x0 = p.origin[0];
    const y0 = p.origin[1];
    const z0 = p.origin[2];
    const x1 = x0 + p.size[0];
    const y1 = y0 + p.size[1];
    const z1 = z0 + p.size[2];
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (z0 < minZ) minZ = z0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
    if (z1 > maxZ) maxZ = z1;

    const faces: EcsCuboidFacesDef = {};
    if (p.faces.top) faces.top = p.faces.top;
    if (p.faces.bottom) faces.bottom = p.faces.bottom;
    if (p.faces.side) faces.side = p.faces.side;
    if (p.faces.north) faces.north = p.faces.north;
    if (p.faces.south) faces.south = p.faces.south;
    if (p.faces.east) faces.east = p.faces.east;
    if (p.faces.west) faces.west = p.faces.west;

    return {
      id: p.id,
      ...(p.parentId ? { parentId: p.parentId } : {}),
      origin: [p.origin[0], p.origin[1], p.origin[2]],
      size: [p.size[0], p.size[1], p.size[2]],
      pivot: [p.pivot[0], p.pivot[1], p.pivot[2]],
      rotDeg: [p.rotDeg[0], p.rotDeg[1], p.rotDeg[2]],
      faces,
      tint: p.tint,
      alpha: p.alpha,
      paletteRow: p.paletteRow,
      roughness: p.roughness,
      metallic: p.metallic,
      emissive: p.emissive,
    };
  });

  const boundsSize: [number, number, number] =
    parts.length > 0
      ? [
          Math.max(1, maxX - minX),
          Math.max(1, maxY - minY),
          Math.max(1, maxZ - minZ),
        ]
      : src.boundsSize
        ? [src.boundsSize[0], src.boundsSize[1], src.boundsSize[2]]
        : [16, 16, 16];

  return {
    id: sanitizeInteropId(src.id, 'model_3d'),
    name: src.name.trim() || src.id || '3D 積木模型',
    parts,
    ...(src.rawMesh ? { rawMesh: cloneRawMesh(src.rawMesh) } : {}),
    ...(src.clips ? { clips: JSON.parse(JSON.stringify(src.clips)) as EcsModel3DAnimClip[] } : {}),
    boundsSize,
  };
}

export function createDefaultCuboidModel(
  id: string,
  name: string,
  primarySprite: SpriteId,
  capSprite: SpriteId,
): MutableModel3D {
  return {
    id: sanitizeInteropId(id, 'cuboid_model_01'),
    name,
    parts: [
      {
        id: 'base_plinth',
        origin: [-8, -8, 0],
        size: [16, 16, 6],
        pivot: [0, 0, 3],
        rotDeg: [0, 0, 0],
        faces: {
          top: primarySprite,
          bottom: primarySprite,
          side: primarySprite,
        },
        tint: '#cbd5e1',
        alpha: 1,
        paletteRow: -1,
        roughness: 0.68,
        metallic: 0.12,
        emissive: 0,
      },
      {
        id: 'upper_crate',
        origin: [-6, -6, 6],
        size: [12, 12, 12],
        pivot: [0, 0, 12],
        rotDeg: [0, 0, 0],
        faces: {
          top: capSprite,
          bottom: capSprite,
          side: capSprite,
        },
        tint: '#f59e0b',
        alpha: 1,
        paletteRow: -1,
        roughness: 0.52,
        metallic: 0.18,
        emissive: 0,
      },
    ],
    boundsSize: [16, 16, 18],
  };
}

function createTextField(label: string, value: string, onCommit: (val: string) => void): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'p7-field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'p7-input';
  inp.value = value;
  inp.setAttribute('aria-label', label);
  inp.addEventListener('change', () => onCommit(inp.value));
  field.append(lbl, inp);
  return field;
}

function createNumField(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (val: number) => void,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'p7-field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'p7-input p7-mono';
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.value = String(Number(value.toFixed(2)));
  inp.setAttribute('aria-label', label);
  inp.addEventListener('input', () => {
    const n = Number(inp.value);
    if (Number.isFinite(n)) onChange(n);
  });
  field.append(lbl, inp);
  return field;
}

function createVec3Field(
  label: string,
  vec: [number, number, number],
  step: number,
  positiveOnly: boolean,
  onChange: (axis: 0 | 1 | 2, val: number) => void,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'p7-field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const row = document.createElement('div');
  row.className = 'p7-model-atelier-vec3';

  const axes: readonly [0 | 1 | 2, string][] = [
    [0, 'X'],
    [1, 'Y'],
    [2, 'Z'],
  ];
  for (const [idx, axisLabel] of axes) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'p7-input p7-mono';
    inp.step = String(step);
    if (positiveOnly) inp.min = '0.1';
    inp.value = String(Number(vec[idx].toFixed(2)));
    inp.setAttribute('aria-label', `${label} ${axisLabel}`);
    inp.addEventListener('input', () => {
      const n = Number(inp.value);
      if (Number.isFinite(n)) onChange(idx, n);
    });
    row.appendChild(inp);
  }

  field.append(lbl, row);
  return field;
}

/** Renders the cuboid parts list into the left panel container. */
export function renderModelPartsList(
  partsListEl: HTMLDivElement,
  model: MutableModel3D,
  selectedPartIdx: number,
  onSelectPart: (index: number) => void,
): void {
  partsListEl.textContent = '';
  if (model.parts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'p7-meta-line';
    empty.textContent = model.rawMesh
      ? '目前為 GLB 網格模型（可附加積木方塊）'
      : '尚無積木方塊，請點擊「+ 新增方塊」';
    partsListEl.appendChild(empty);
    return;
  }

  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'p7-model-atelier-part-row';
    if (i === selectedPartIdx) row.classList.add('is-selected');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = part.id;
    const dimSpan = document.createElement('span');
    dimSpan.className = 'p7-mono';
    dimSpan.textContent = `${Math.round(part.size[0])}×${Math.round(part.size[1])}×${Math.round(part.size[2])}`;

    row.append(nameSpan, dimSpan);
    row.addEventListener('click', () => onSelectPart(i));
    partsListEl.appendChild(row);
  }
}

/** Renders model metadata, cuboid transform/PBR/6-face texture controls, and GLB RawMesh inspector. */
export function renderModelInspectorPanel(
  rightPanelEl: HTMLDivElement,
  model: MutableModel3D,
  selectedPartIdx: number,
  spriteOptions: readonly { id: SpriteId; label: string }[],
  callbacks: {
    onModelMetaChanged: () => void;
    onPartsListChanged: () => void;
  },
): void {
  rightPanelEl.textContent = '';

  const metaSec = document.createElement('div');
  metaSec.className = 'p7-section';
  const metaTitle = document.createElement('h3');
  metaTitle.className = 'p7-section-title';
  metaTitle.textContent = '模型基本資訊';

  const idField = createTextField('模型 ID', model.id, (val) => {
    model.id = sanitizeInteropId(val, 'model_3d');
    callbacks.onModelMetaChanged();
  });
  const nameField = createTextField('模型名稱', model.name, (val) => {
    model.name = val.trim() || model.id;
    callbacks.onModelMetaChanged();
  });
  metaSec.append(metaTitle, idField, nameField);
  rightPanelEl.appendChild(metaSec);

  const part = model.parts[selectedPartIdx];
  if (part) {
    const xformSec = document.createElement('div');
    xformSec.className = 'p7-section';
    const xformTitle = document.createElement('h3');
    xformTitle.className = 'p7-section-title';
    xformTitle.textContent = `方塊屬性：${part.id}`;

    const partIdField = createTextField('方塊 ID', part.id, (val) => {
      part.id = sanitizeInteropId(val, part.id);
      callbacks.onPartsListChanged();
    });
    const originRow = createVec3Field('起點 Origin [X, Y, Z]', part.origin, 0.5, false, (i, v) => {
      part.origin[i] = v;
    });
    const sizeRow = createVec3Field('尺寸 Size [W, D, H]', part.size, 0.5, true, (i, v) => {
      part.size[i] = Math.max(0.1, v);
      callbacks.onPartsListChanged();
    });
    const pivotRow = createVec3Field('軸心 Pivot [X, Y, Z]', part.pivot, 0.5, false, (i, v) => {
      part.pivot[i] = v;
    });
    const rotRow = createVec3Field('旋轉 RotDeg [X, Y, Z]', part.rotDeg, 1, false, (i, v) => {
      part.rotDeg[i] = v;
    });

    xformSec.append(xformTitle, partIdField, originRow, sizeRow, pivotRow, rotRow);
    rightPanelEl.appendChild(xformSec);

    const matSec = document.createElement('div');
    matSec.className = 'p7-section';
    const matTitle = document.createElement('h3');
    matTitle.className = 'p7-section-title';
    matTitle.textContent = 'PBR 材質與色調';

    const tintRow = document.createElement('div');
    tintRow.className = 'p7-color-row';
    const tintLbl = document.createElement('span');
    tintLbl.textContent = '色調 Tint';
    const tintInp = document.createElement('input');
    tintInp.type = 'color';
    tintInp.className = 'p7-color-input';
    tintInp.value = /^#[0-9a-fA-F]{6}$/.test(part.tint) ? part.tint : '#ffffff';
    tintInp.addEventListener('input', () => {
      part.tint = tintInp.value;
    });
    tintRow.append(tintLbl, tintInp);

    const pbrGrid = document.createElement('div');
    pbrGrid.className = 'p7-prop-grid';
    pbrGrid.append(
      createNumField('粗糙度 Roughness', part.roughness, 0, 1, 0.05, (v) => {
        part.roughness = Math.max(0, Math.min(1, v));
      }),
      createNumField('金屬度 Metallic', part.metallic, 0, 1, 0.05, (v) => {
        part.metallic = Math.max(0, Math.min(1, v));
      }),
      createNumField('自發光 Emissive', part.emissive, 0, 2, 0.05, (v) => {
        part.emissive = Math.max(0, Math.min(2, v));
      }),
    );

    matSec.append(matTitle, tintRow, pbrGrid);
    rightPanelEl.appendChild(matSec);

    const faceSec = document.createElement('div');
    faceSec.className = 'p7-section';
    const faceTitle = document.createElement('h3');
    faceTitle.className = 'p7-section-title';
    faceTitle.textContent = '6 面 TextureAtlas 貼圖';
    faceSec.appendChild(faceTitle);

    for (const slot of FACE_SLOTS) {
      const field = document.createElement('div');
      field.className = 'p7-field';
      const lbl = document.createElement('label');
      lbl.textContent = slot.label;
      const sel = document.createElement('select');
      sel.className = 'p7-select';
      sel.setAttribute('aria-label', slot.label);

      const inheritOpt = document.createElement('option');
      inheritOpt.value = '';
      inheritOpt.textContent = '(繼承 / 無貼圖)';
      sel.appendChild(inheritOpt);

      for (const optDef of spriteOptions) {
        const o = document.createElement('option');
        o.value = optDef.id;
        o.textContent = optDef.label;
        sel.appendChild(o);
      }
      sel.value = part.faces[slot.key] ?? '';
      sel.addEventListener('change', () => {
        const val = sel.value;
        if (val) {
          part.faces[slot.key] = val as SpriteId;
        } else {
          delete part.faces[slot.key];
        }
      });
      field.append(lbl, sel);
      faceSec.appendChild(field);
    }

    rightPanelEl.appendChild(faceSec);
  }

  if (model.rawMesh) {
    const raw = model.rawMesh;
    const rawSec = document.createElement('div');
    rawSec.className = 'p7-section';
    const rawTitle = document.createElement('h3');
    rawTitle.className = 'p7-section-title';
    rawTitle.textContent = 'GLB 網格 (RawMesh)';

    const rawMeta = document.createElement('div');
    rawMeta.className = 'p7-meta-line p7-mono';
    rawMeta.textContent = `頂點 ${Math.floor(raw.positions.length / 3)} · 三角面 ${Math.floor(raw.indices.length / 3)}`;

    const rawSpriteField = document.createElement('div');
    rawSpriteField.className = 'p7-field';
    const rawSpriteLbl = document.createElement('label');
    rawSpriteLbl.textContent = '網格貼圖 (Sprite)';
    const rawSpriteSel = document.createElement('select');
    rawSpriteSel.className = 'p7-select';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(純色 PBR)';
    rawSpriteSel.appendChild(noneOpt);
    for (const optDef of spriteOptions) {
      const o = document.createElement('option');
      o.value = optDef.id;
      o.textContent = optDef.label;
      rawSpriteSel.appendChild(o);
    }
    rawSpriteSel.value = raw.spriteId ?? '';
    rawSpriteSel.addEventListener('change', () => {
      raw.spriteId = rawSpriteSel.value ? (rawSpriteSel.value as SpriteId) : null;
    });
    rawSpriteField.append(rawSpriteLbl, rawSpriteSel);

    const rawTintRow = document.createElement('div');
    rawTintRow.className = 'p7-color-row';
    const rawTintLbl = document.createElement('span');
    rawTintLbl.textContent = '網格色調 Tint';
    const rawTintInp = document.createElement('input');
    rawTintInp.type = 'color';
    rawTintInp.className = 'p7-color-input';
    rawTintInp.value = raw.tint && /^#[0-9a-fA-F]{6}$/.test(raw.tint) ? raw.tint : '#ffffff';
    rawTintInp.addEventListener('input', () => {
      raw.tint = rawTintInp.value;
    });
    rawTintRow.append(rawTintLbl, rawTintInp);

    const rawGrid = document.createElement('div');
    rawGrid.className = 'p7-prop-grid';
    rawGrid.append(
      createNumField('粗糙度 Roughness', raw.roughness ?? 0.58, 0, 1, 0.05, (v) => {
        raw.roughness = Math.max(0, Math.min(1, v));
      }),
      createNumField('金屬度 Metallic', raw.metallic ?? 0.1, 0, 1, 0.05, (v) => {
        raw.metallic = Math.max(0, Math.min(1, v));
      }),
      createNumField('自發光 Emissive', raw.emissive ?? 0, 0, 2, 0.05, (v) => {
        raw.emissive = Math.max(0, Math.min(2, v));
      }),
    );

    rawSec.append(rawTitle, rawMeta, rawSpriteField, rawTintRow, rawGrid);
    rightPanelEl.appendChild(rawSec);
  }
}
