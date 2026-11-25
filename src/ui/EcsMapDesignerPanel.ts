import { ATLAS_SIZE, type SpriteId, type TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import {
  CASTLE_TILE_IDS,
  CASTLE_TILE_REGISTRY,
  createEmptyRoom,
  type EcsMapLayerName,
  type EcsMapPortalDef,
  type EcsMapRoomDef,
  type EcsTileDef,
} from '../core/ecs/EcsTilemapTypes.ts';
import {
  projectWorld3DToScreen,
  type ComputedCamera3D,
  type ScreenPoint3D,
} from '../core/math/Perspective3DMath.ts';
import { collectProjectSpriteOptions, createWorkbenchSliderRow } from './EcsWorkbenchCatalog.ts';

export type MapToolMode = 'brush' | 'rect' | 'fill' | 'erase' | 'eyedropper' | 'stamp' | 'pan';

export interface MapDesignerState {
  tool: MapToolMode;
  layer: EcsMapLayerName;
  selectedTileId: number;
  selectedStampPrefabId: string | null;
  showGrid: boolean;
  showPortals: boolean;
  showFovPreview: boolean;
}

export interface MapDesignerPanelCallbacks {
  onStateChange: () => void;
  onSwitchRoom: (roomId: string) => void;
  onSelectEntity: (entityId: string) => void;
  onEnterEditMode: () => void;
  onLiveTileDef?: (tileDef: EcsTileDef) => void;
  onOpenSpriteAtelierForTile?: () => void;
  onOpenExternalImport?: () => void;
}

export interface MapOverlayContext {
  room: EcsMapRoomDef;
  portals: readonly EcsMapPortalDef[];
  tileSize: number;
  camX: number;
  camY: number;
  viewW: number;
  viewH: number;
  state: MapDesignerState;
  hoverCol: number;
  hoverRow: number;
  rectDrag: { c0: number; r0: number; c1: number; r1: number } | null;
  camera3D?: ComputedCamera3D | null;
  fovMask?: Uint8Array | null;
  showEditingAffordances?: boolean;
}

const TOOL_BUTTONS: readonly { id: MapToolMode; label: string; title: string }[] = [
  { id: 'brush', label: '筆刷', title: '拖曳繪製瓦片 (B)' },
  { id: 'rect', label: '矩形', title: '拖曳框選填滿區域 (R)' },
  { id: 'fill', label: '油漆桶', title: '連通區域填色 (G)' },
  { id: 'erase', label: '橡皮擦', title: '清除目前圖層瓦片 (E)' },
  { id: 'eyedropper', label: '吸管', title: '吸取游標下瓦片 (I)' },
  { id: 'pan', label: '平移', title: '拖曳平移地圖鏡頭 (Space / 右鍵)' },
];

const LAYER_BUTTONS: readonly { id: EcsMapLayerName; label: string }[] = [
  { id: 'ground', label: '地板' },
  { id: 'wall', label: '城牆立面' },
  { id: 'decor', label: '裝飾' },
];

export function createDefaultMapDesignerState(): MapDesignerState {
  return {
    tool: 'brush',
    layer: 'ground',
    selectedTileId: CASTLE_TILE_IDS.CARPET_V,
    selectedStampPrefabId: null,
    showGrid: true,
    showPortals: true,
    showFovPreview: false,
  };
}

/**
 * Renders a crisp nearest-neighbor pixel thumbnail directly from Pixer's TextureAtlas RGBA page.
 */
export function createAtlasThumbCanvas(atlas: TextureAtlas, spriteId: SpriteId, boxSize = 32): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'p7-tile-thumb';
  canvas.width = boxSize;
  canvas.height = boxSize;

  const rect = atlas.getRect(spriteId);
  const pagePixels = atlas.getPagePixels(rect.page ?? 0);
  const ctx = canvas.getContext('2d');
  if (!ctx || !pagePixels) return canvas;

  const sx = Math.max(0, Math.floor(rect.u0 * ATLAS_SIZE));
  const sy = Math.max(0, Math.floor(rect.v0 * ATLAS_SIZE));
  const sw = Math.max(1, Math.min(ATLAS_SIZE - sx, rect.w));
  const sh = Math.max(1, Math.min(ATLAS_SIZE - sy, rect.h));

  const tmp = document.createElement('canvas');
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext('2d');
  if (!tctx) return canvas;

  const imgData = tctx.createImageData(sw, sh);
  const dst = imgData.data;
  for (let y = 0; y < sh; y++) {
    const srcRow = ((sy + y) * ATLAS_SIZE + sx) * 4;
    const dstRow = y * sw * 4;
    dst.set(pagePixels.subarray(srcRow, srcRow + sw * 4), dstRow);
  }
  tctx.putImageData(imgData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  const scale = Math.min(boxSize / sw, boxSize / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const dx = Math.floor((boxSize - dw) * 0.5);
  const dy = Math.floor((boxSize - dh) * 0.5);
  ctx.drawImage(tmp, 0, 0, sw, sh, dx, dy, dw, dh);
  return canvas;
}

/**
 * Renders the left sidebar Map Designer pane (rooms, layers, tools, 32px pixel tile palette,
 * prefab stamps, and room portals).
 */
export function renderMapDesignerPane(
  container: HTMLElement,
  proj: EcsProjectV2,
  session: EcsStudioSession,
  atlas: TextureAtlas,
  activeRoomId: string | null,
  state: MapDesignerState,
  cb: MapDesignerPanelCallbacks,
): void {
  const worldMap = proj.worldMap;
  if (!worldMap || worldMap.rooms.length === 0) {
    const emptySec = document.createElement('div');
    emptySec.className = 'p7-section';
    const title = document.createElement('h3');
    title.className = 'p7-section-title';
    title.textContent = '尚未啟用多房間像素地圖';
    const desc = document.createElement('div');
    desc.className = 'p7-meta-line';
    desc.textContent = '建立 32×32 HD-2D 瓦片地圖後，可直接在畫布繪製城牆、地磚、熔岩與跨房傳送門。';
    const initBtn = document.createElement('button');
    initBtn.type = 'button';
    initBtn.className = 'p7-btn p7-btn-accent';
    initBtn.textContent = '建立 32px 多層地圖';
    initBtn.addEventListener('click', () => {
      session.dispatch({ type: 'ensure_world_map', cols: 26, rows: 16, roomName: '黑曜主殿' });
      cb.onEnterEditMode();
    });
    emptySec.append(title, desc, initBtn);
    container.appendChild(emptySec);
    return;
  }

  const activeRoom =
    worldMap.rooms.find((r) => r.id === activeRoomId) ??
    worldMap.rooms.find((r) => r.id === worldMap.startRoomId) ??
    worldMap.rooms[0];

  const customTileIdSet = new Set<number>();
  const mergedTiles = new Map(CASTLE_TILE_REGISTRY.map((t) => [t.id, t]));
  if (worldMap.tileDefs) {
    for (const customDef of worldMap.tileDefs) {
      mergedTiles.set(customDef.id, customDef);
      customTileIdSet.add(customDef.id);
    }
  }
  const allMergedTiles = Array.from(mergedTiles.values());

  // 1. Room Switcher & Creator
  const roomSec = document.createElement('div');
  roomSec.className = 'p7-section';
  const roomHead = document.createElement('div');
  roomHead.className = 'p7-section-head';
  const roomTitle = document.createElement('h3');
  roomTitle.className = 'p7-section-title';
  roomTitle.textContent = '多房間像素地圖';

  const addRoomBtn = document.createElement('button');
  addRoomBtn.type = 'button';
  addRoomBtn.className = 'p7-btn p7-btn-xs';
  addRoomBtn.textContent = '+ 新房間';
  addRoomBtn.title = '新增一張可捲動像素房間';
  addRoomBtn.addEventListener('click', () => {
    const nextIdx = worldMap.rooms.length + 1;
    const newId = `hall_${nextIdx}`;
    const defaultGround =
      allMergedTiles.find((t) => t.layer === 'ground' && customTileIdSet.has(t.id))?.id ??
      CASTLE_TILE_IDS.STONE_FLOOR;
    const res = session.dispatch({
      type: 'upsert_room',
      room: createEmptyRoom(newId, `新殿堂 #${nextIdx}`, 24, 16, defaultGround),
    });
    if (res.ok) {
      cb.onSwitchRoom(newId);
    }
  });
  roomHead.append(roomTitle, addRoomBtn);

  const roomSelect = document.createElement('select');
  roomSelect.className = 'p7-select p7-select-full';
  roomSelect.setAttribute('aria-label', '切換地圖房間');
  for (const r of worldMap.rooms) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.name} (${r.cols}×${r.rows})`;
    roomSelect.appendChild(opt);
  }
  roomSelect.value = activeRoom.id;
  roomSelect.addEventListener('change', () => {
    cb.onSwitchRoom(roomSelect.value);
  });

  const roomMeta = document.createElement('div');
  roomMeta.className = 'p7-room-meta p7-mono';
  roomMeta.textContent =
    `${activeRoom.cols}×${activeRoom.rows} 格 · ${worldMap.tileSize}px · ` +
    `${activeRoom.cols * worldMap.tileSize}×${activeRoom.rows * worldMap.tileSize}px`;

  roomSec.append(roomHead, roomSelect, roomMeta);

  // 2. Active Map Layer & Drawing Tools
  const toolSec = document.createElement('div');
  toolSec.className = 'p7-section';
  const toolHead = document.createElement('div');
  toolHead.className = 'p7-section-head';
  const toolTitle = document.createElement('h3');
  toolTitle.className = 'p7-section-title';
  toolTitle.textContent = '圖層與地圖工具';

  const gridToggle = document.createElement('button');
  gridToggle.type = 'button';
  gridToggle.className = state.showGrid ? 'p7-btn p7-btn-xs p7-btn-accent' : 'p7-btn p7-btn-xs';
  gridToggle.textContent = state.showGrid ? '格線：開' : '格線：關';
  gridToggle.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    cb.onStateChange();
  });
  toolHead.append(toolTitle, gridToggle);

  const layerSeg = document.createElement('div');
  layerSeg.className = 'p7-segmented p7-segmented-full';
  for (const lb of LAYER_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.layer === lb.id ? 'p7-seg-btn is-active' : 'p7-seg-btn';
    btn.textContent = lb.label;
    btn.addEventListener('click', () => {
      state.layer = lb.id;
      const firstCustomForLayer = allMergedTiles.find((t) => t.layer === lb.id && customTileIdSet.has(t.id));
      const firstForLayer = firstCustomForLayer ?? allMergedTiles.find((t) => t.layer === lb.id);
      if (firstForLayer) {
        state.selectedTileId = firstForLayer.id;
      }
      if (state.tool === 'stamp') {
        state.tool = 'brush';
        state.selectedStampPrefabId = null;
      }
      cb.onEnterEditMode();
      cb.onStateChange();
    });
    layerSeg.appendChild(btn);
  }

  const toolGrid = document.createElement('div');
  toolGrid.className = 'p7-map-tools';
  for (const tb of TOOL_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.tool === tb.id ? 'p7-btn p7-btn-xs p7-btn-accent' : 'p7-btn p7-btn-xs';
    btn.textContent = tb.label;
    btn.title = tb.title;
    btn.addEventListener('click', () => {
      state.tool = tb.id;
      if (tb.id !== 'stamp') state.selectedStampPrefabId = null;
      cb.onEnterEditMode();
      cb.onStateChange();
    });
    toolGrid.appendChild(btn);
  }
  toolSec.append(toolHead, layerSeg, toolGrid);

  // 3. 32x32 Pixel Tile Palette (filtered by layer, custom project tiles sorted first)
  const palSec = document.createElement('div');
  palSec.className = 'p7-section';
  const palHead = document.createElement('div');
  palHead.className = 'p7-section-head';
  const palTitle = document.createElement('h3');
  palTitle.className = 'p7-section-title';
  palTitle.textContent =
    state.layer === 'ground'
      ? '32px 地板瓦片盤'
      : state.layer === 'wall'
        ? '32px 立體城牆與閘門盤'
        : '32px 裝飾圖層盤';
  palHead.appendChild(palTitle);

  if (cb.onOpenSpriteAtelierForTile) {
    const newTileBtn = document.createElement('button');
    newTileBtn.type = 'button';
    newTileBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
    newTileBtn.textContent = '+ 畫室新增';
    newTileBtn.title = '開啟像素精靈畫室繪製並一鍵發佈為自訂地圖瓦片或物件印章';
    newTileBtn.addEventListener('click', () => cb.onOpenSpriteAtelierForTile?.());
    palHead.appendChild(newTileBtn);
  }

  const tileGrid = document.createElement('div');
  tileGrid.className = 'p7-tile-grid';
  const tilesForLayer = allMergedTiles
    .filter((t) => t.layer === state.layer)
    .sort((a, b) => Number(customTileIdSet.has(b.id)) - Number(customTileIdSet.has(a.id)));

  for (const tdef of tilesForLayer) {
    const card = document.createElement('button');
    card.type = 'button';
    const isCustom = customTileIdSet.has(tdef.id);
    const isSelected = state.tool !== 'stamp' && state.tool !== 'erase' && state.selectedTileId === tdef.id;
    card.className = isSelected ? 'p7-tile-card is-selected' : 'p7-tile-card';
    card.dataset.tileId = String(tdef.id);
    card.title = `${tdef.name}${isCustom ? ' [專案自訂]' : ''}${tdef.solid ? ' · 實體碰撞' : ''}${tdef.extrudeH ? ` · 立體高度 ${tdef.extrudeH}px` : ''}`;

    const thumb = createAtlasThumbCanvas(atlas, tdef.sprite, 32);
    const lbl = document.createElement('span');
    lbl.className = 'p7-tile-label';
    lbl.textContent = tdef.name;

    if (isCustom) {
      const badge = document.createElement('span');
      badge.className = 'p7-tile-badge';
      badge.textContent = '自訂';
      card.append(badge);
    }
    card.append(thumb, lbl);
    card.addEventListener('click', () => {
      state.selectedTileId = tdef.id;
      state.selectedStampPrefabId = null;
      if (state.tool === 'erase' || state.tool === 'stamp' || state.tool === 'pan' || state.tool === 'eyedropper') {
        state.tool = 'brush';
      }
      cb.onEnterEditMode();
      cb.onStateChange();
    });
    tileGrid.appendChild(card);
  }
  palSec.append(palHead, tileGrid);

  // 3b. Selected Tile PBR Material & Top/Side Texture Inspector
  const selectedTile = mergedTiles.get(state.selectedTileId);
  if (state.tool !== 'stamp' && selectedTile && selectedTile.layer === state.layer) {
    const pbrCard = document.createElement('div');
    pbrCard.className = 'p7-rule-card';
    pbrCard.setAttribute('data-testid', 'tile-pbr-inspector');

    const pbrHead = document.createElement('div');
    pbrHead.className = 'p7-rule-card-head';
    const pbrTitle = document.createElement('strong');
    pbrTitle.textContent = `瓦片材質：${selectedTile.name}`;
    const pbrIdTag = document.createElement('span');
    pbrIdTag.className = 'p7-meta-line p7-mono';
    pbrIdTag.textContent = `#${selectedTile.id}`;
    pbrHead.append(pbrTitle, pbrIdTag);
    pbrCard.appendChild(pbrHead);

    const spriteOpts = collectProjectSpriteOptions(proj, atlas);
    const liveTile = (patch: Partial<EcsTileDef>) => {
      cb.onLiveTileDef?.({ ...selectedTile, ...patch });
    };
    const commitTile = (patch: Partial<EcsTileDef>) => {
      session.dispatch({ type: 'upsert_tile_def', tileDef: { ...selectedTile, ...patch } });
    };

    const makeSpriteSelect = (
      label: string,
      value: string,
      allowEmptyLabel: string | null,
      onChange: (val: string) => void,
      testId: string,
    ) => {
      const row = document.createElement('label');
      row.className = 'p7-rule-field';
      const sp = document.createElement('span');
      sp.textContent = label;
      const sel = document.createElement('select');
      sel.className = 'p7-select p7-mono';
      sel.setAttribute('data-testid', testId);
      if (allowEmptyLabel) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = allowEmptyLabel;
        sel.appendChild(emptyOpt);
      }
      for (const opt of spriteOpts) {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      if (value && !spriteOpts.some((o) => o.id === value)) {
        const cur = document.createElement('option');
        cur.value = value;
        cur.textContent = value;
        sel.appendChild(cur);
      }
      sel.value = value;
      sel.addEventListener('change', () => onChange(sel.value));
      row.append(sp, sel);
      return row;
    };

    pbrCard.appendChild(
      makeSpriteSelect(
        selectedTile.layer === 'wall' ? '牆頂貼圖 (Top)' : '瓦片貼圖 (Sprite)',
        selectedTile.sprite,
        null,
        (v) => commitTile({ sprite: (v || selectedTile.sprite) as SpriteId }),
        'tile-pbr-sprite',
      ),
    );

    if (selectedTile.layer === 'wall') {
      pbrCard.appendChild(
        makeSpriteSelect(
          '牆側貼圖 (Side)',
          selectedTile.sideSprite ?? '',
          '(同牆頂貼圖)',
          (v) => commitTile({ sideSprite: (v || undefined) as SpriteId | undefined }),
          'tile-pbr-side-sprite',
        ),
      );
      const matRow = document.createElement('label');
      matRow.className = 'p7-rule-field';
      const matLbl = document.createElement('span');
      matLbl.textContent = '牆體材質 (Material)';
      const matSel = document.createElement('select');
      matSel.className = 'p7-select p7-mono';
      for (const [mId, mTxt] of [
        ['stone', '石砌 (stone)'],
        ['earth', '岩土 (earth)'],
        ['timber', '木構 (timber)'],
        ['astral', '星晶 (astral)'],
      ] as const) {
        const o = document.createElement('option');
        o.value = mId;
        o.textContent = mTxt;
        matSel.appendChild(o);
      }
      matSel.value = selectedTile.wallMaterial ?? 'stone';
      matSel.addEventListener('change', () => {
        commitTile({ wallMaterial: matSel.value as EcsTileDef['wallMaterial'] });
      });
      matRow.append(matLbl, matSel);
      pbrCard.appendChild(matRow);

      pbrCard.appendChild(
        createWorkbenchSliderRow(
          '牆高 ExtrudeH',
          4,
          48,
          1,
          selectedTile.extrudeH ?? 26,
          (v) => `${Math.round(v)}px`,
          (v) => liveTile({ extrudeH: Math.round(v) }),
          (v) => commitTile({ extrudeH: Math.round(v) }),
        ),
      );
    }

    pbrCard.append(
      createWorkbenchSliderRow(
        '粗糙度 Roughness',
        0.05,
        1.0,
        0.02,
        selectedTile.roughness ?? 0.62,
        (v) => v.toFixed(2),
        (v) => liveTile({ roughness: Number(v.toFixed(2)) }),
        (v) => commitTile({ roughness: Number(v.toFixed(2)) }),
      ),
      createWorkbenchSliderRow(
        '金屬度 Metallic',
        0.0,
        1.0,
        0.02,
        selectedTile.metallic ?? 0.1,
        (v) => v.toFixed(2),
        (v) => liveTile({ metallic: Number(v.toFixed(2)) }),
        (v) => commitTile({ metallic: Number(v.toFixed(2)) }),
      ),
      createWorkbenchSliderRow(
        '自發光 Emissive',
        0.0,
        2.0,
        0.05,
        selectedTile.emissive ?? 0,
        (v) => v.toFixed(2),
        (v) => liveTile({ emissive: Number(v.toFixed(2)) }),
        (v) => commitTile({ emissive: Number(v.toFixed(2)) }),
      ),
    );
    palSec.appendChild(pbrCard);
  }

  // 4. Castle Object / Prop / Enemy Prefab Stamp Palette
  const stampSec = document.createElement('div');
  stampSec.className = 'p7-section';
  const stampTitle = document.createElement('h3');
  stampTitle.className = 'p7-section-title';
  stampTitle.textContent = '物件與角色印章 (點擊畫布放置)';

  const stampGrid = document.createElement('div');
  stampGrid.className = 'p7-tile-grid';
  const prefabs = Object.values(proj.prefabs);
  for (const pref of prefabs) {
    const sp = pref.components.sprite?.sprite;
    if (!sp) continue;
    const card = document.createElement('button');
    card.type = 'button';
    const isSelected = state.tool === 'stamp' && state.selectedStampPrefabId === pref.id;
    card.className = isSelected ? 'p7-tile-card is-selected' : 'p7-tile-card';
    card.title = `放置 ${pref.name} 至目前房間`;

    const thumb = createAtlasThumbCanvas(atlas, sp, 32);
    const lbl = document.createElement('span');
    lbl.className = 'p7-tile-label';
    lbl.textContent = pref.name;

    card.append(thumb, lbl);
    card.addEventListener('click', () => {
      state.tool = 'stamp';
      state.selectedStampPrefabId = pref.id;
      cb.onEnterEditMode();
      cb.onStateChange();
    });
    stampGrid.appendChild(card);
  }
  stampSec.append(stampTitle, stampGrid);

  // 5. Room Portals Overview
  const roomPortals = worldMap.portals.filter((p) => p.fromRoomId === activeRoom.id);
  const portalSec = document.createElement('div');
  portalSec.className = 'p7-section';
  const portalHead = document.createElement('div');
  portalHead.className = 'p7-section-head';
  const portalTitle = document.createElement('h3');
  portalTitle.className = 'p7-section-title';
  portalTitle.textContent = `傳送門串聯 (${roomPortals.length})`;

  const portalVisBtn = document.createElement('button');
  portalVisBtn.type = 'button';
  portalVisBtn.className = state.showPortals ? 'p7-btn p7-btn-xs p7-btn-accent' : 'p7-btn p7-btn-xs';
  portalVisBtn.textContent = state.showPortals ? '標記：開' : '標記：關';
  portalVisBtn.addEventListener('click', () => {
    state.showPortals = !state.showPortals;
    cb.onStateChange();
  });
  portalHead.append(portalTitle, portalVisBtn);
  portalSec.appendChild(portalHead);

  if (roomPortals.length === 0) {
    const none = document.createElement('div');
    none.className = 'p7-meta-line';
    none.textContent = '此房間尚未設定傳送門。';
    portalSec.appendChild(none);
  } else {
    for (const p of roomPortals) {
      const targetRoom = worldMap.rooms.find((r) => r.id === p.toRoomId);
      const row = document.createElement('div');
      row.className = 'p7-portal-row';
      const info = document.createElement('div');
      info.className = 'p7-portal-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'p7-item-title';
      nameEl.textContent = p.name || `前往 ${targetRoom?.name ?? p.toRoomId}`;
      const subEl = document.createElement('span');
      subEl.className = 'p7-meta-line p7-mono';
      subEl.textContent = `格 (${p.col},${p.row}) → ${targetRoom?.name ?? p.toRoomId}`;
      info.append(nameEl, subEl);

      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'p7-btn p7-btn-xs';
      jumpBtn.textContent = '跳往';
      jumpBtn.addEventListener('click', () => cb.onSwitchRoom(p.toRoomId));

      row.append(info, jumpBtn);
      portalSec.appendChild(row);
    }
  }

  container.append(roomSec, toolSec, palSec, stampSec, portalSec);
}

/**
 * Draws the crisp map-editing affordances (32px tile grid, portal markers, rect marquee,
 * hover tile highlight) onto the transparent overlay canvas stacked over GpuEngine.
 */
const _p0: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: true };
const _p1: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: true };
const _p2: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: true };
const _p3: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: true };

function appendProjectedQuadSubpath(
  ctx: CanvasRenderingContext2D,
  wx0: number,
  wy0: number,
  wx1: number,
  wy1: number,
  cam3d: ComputedCamera3D,
  sx: number,
  sy: number,
): boolean {
  projectWorld3DToScreen(wx0, wy0, 0, cam3d, _p0);
  projectWorld3DToScreen(wx1, wy0, 0, cam3d, _p1);
  projectWorld3DToScreen(wx1, wy1, 0, cam3d, _p2);
  projectWorld3DToScreen(wx0, wy1, 0, cam3d, _p3);
  if (!_p0.visible || !_p1.visible || !_p2.visible || !_p3.visible) return false;
  ctx.moveTo(_p0.x * sx, _p0.y * sy);
  ctx.lineTo(_p1.x * sx, _p1.y * sy);
  ctx.lineTo(_p2.x * sx, _p2.y * sy);
  ctx.lineTo(_p3.x * sx, _p3.y * sy);
  ctx.closePath();
  return true;
}

function traceProjectedQuad(
  ctx: CanvasRenderingContext2D,
  wx0: number,
  wy0: number,
  wx1: number,
  wy1: number,
  cam3d: ComputedCamera3D,
  sx: number,
  sy: number,
): boolean {
  ctx.beginPath();
  return appendProjectedQuadSubpath(ctx, wx0, wy0, wx1, wy1, cam3d, sx, sy);
}

function drawFovFogOverlay(
  ctx: CanvasRenderingContext2D,
  room: EcsMapRoomDef,
  fovMask: Uint8Array,
  ts: number,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
  sx: number,
  sy: number,
  cam3d: ComputedCamera3D | null,
): void {
  const cols = room.cols;
  const rows = room.rows;
  if (fovMask.length < cols * rows) return;

  ctx.beginPath();
  if (cam3d) {
    const margin = ts * 4;
    const minCol = Math.max(0, Math.floor((camX - margin) / ts));
    const maxCol = Math.min(cols - 1, Math.ceil((camX + viewW + margin) / ts));
    const minRow = Math.max(0, Math.floor((camY - margin) / ts));
    const maxRow = Math.min(rows - 1, Math.ceil((camY + viewH + margin) / ts));
    for (let r = minRow; r <= maxRow; r++) {
      const rowOff = r * cols;
      const wy0 = r * ts;
      for (let c = minCol; c <= maxCol; c++) {
        if (fovMask[rowOff + c] !== 0) continue;
        appendProjectedQuadSubpath(ctx, c * ts, wy0, (c + 1) * ts, wy0 + ts, cam3d, sx, sy);
      }
    }
  } else {
    const minCol = Math.max(0, Math.floor(camX / ts));
    const maxCol = Math.min(cols - 1, Math.ceil((camX + viewW) / ts));
    const minRow = Math.max(0, Math.floor(camY / ts));
    const maxRow = Math.min(rows - 1, Math.ceil((camY + viewH) / ts));
    const tw = ts * sx;
    const th = ts * sy;
    for (let r = minRow; r <= maxRow; r++) {
      const rowOff = r * cols;
      const py = (r * ts - camY) * sy;
      for (let c = minCol; c <= maxCol; c++) {
        if (fovMask[rowOff + c] !== 0) continue;
        ctx.rect((c * ts - camX) * sx, py, tw, th);
      }
    }
  }
  ctx.fillStyle = 'rgba(10, 22, 52, 0.56)';
  ctx.fill();
}

export function drawMapEditorOverlay(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, info: MapOverlayContext): void {
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const sx = cw / Math.max(1, info.viewW);
  const sy = ch / Math.max(1, info.viewH);
  const ts = info.tileSize;
  const { room, portals, camX, camY, state } = info;
  const cam3d = info.camera3D ?? null;
  const editing = info.showEditingAffordances !== false;

  // 0. Phase 4 Symmetric Shadowcasting FOV Fog-of-War Preview
  if (state.showFovPreview && info.fovMask) {
    drawFovFogOverlay(ctx, room, info.fovMask, ts, camX, camY, info.viewW, info.viewH, sx, sy, cam3d);
  }

  if (!editing) return;

  // 1. Subtle 32px Tile Grid
  if (state.showGrid) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (cam3d) {
      const margin = ts * 4;
      const minCol = Math.max(0, Math.floor((camX - margin) / ts));
      const maxCol = Math.min(room.cols, Math.ceil((camX + info.viewW + margin) / ts));
      const minRow = Math.max(0, Math.floor((camY - margin) / ts));
      const maxRow = Math.min(room.rows, Math.ceil((camY + info.viewH + margin) / ts));
      const yMin = minRow * ts;
      const yMax = maxRow * ts;
      const xMin = minCol * ts;
      const xMax = maxCol * ts;
      for (let c = minCol; c <= maxCol; c++) {
        const wx = c * ts;
        projectWorld3DToScreen(wx, yMin, 0, cam3d, _p0);
        projectWorld3DToScreen(wx, yMax, 0, cam3d, _p1);
        if (_p0.visible && _p1.visible) {
          ctx.moveTo(_p0.x * sx, _p0.y * sy);
          ctx.lineTo(_p1.x * sx, _p1.y * sy);
        }
      }
      for (let r = minRow; r <= maxRow; r++) {
        const wy = r * ts;
        projectWorld3DToScreen(xMin, wy, 0, cam3d, _p0);
        projectWorld3DToScreen(xMax, wy, 0, cam3d, _p1);
        if (_p0.visible && _p1.visible) {
          ctx.moveTo(_p0.x * sx, _p0.y * sy);
          ctx.lineTo(_p1.x * sx, _p1.y * sy);
        }
      }
    } else {
      const minCol = Math.max(0, Math.floor(camX / ts));
      const maxCol = Math.min(room.cols, Math.ceil((camX + info.viewW) / ts));
      const minRow = Math.max(0, Math.floor(camY / ts));
      const maxRow = Math.min(room.rows, Math.ceil((camY + info.viewH) / ts));

      for (let c = minCol; c <= maxCol; c++) {
        const px = Math.round((c * ts - camX) * sx) + 0.5;
        ctx.moveTo(px, Math.round((minRow * ts - camY) * sy));
        ctx.lineTo(px, Math.round((maxRow * ts - camY) * sy));
      }
      for (let r = minRow; r <= maxRow; r++) {
        const py = Math.round((r * ts - camY) * sy) + 0.5;
        ctx.moveTo(Math.round((minCol * ts - camX) * sx), py);
        ctx.lineTo(Math.round((maxCol * ts - camX) * sx), py);
      }
    }
    ctx.stroke();
  }

  // 2. Portal Trigger Zones
  if (state.showPortals) {
    for (const p of portals) {
      const wx0 = p.col * ts;
      const wy0 = p.row * ts;
      const wx1 = (p.col + p.cols) * ts;
      const wy1 = (p.row + p.rows) * ts;
      ctx.fillStyle = p.requiresGlobal ? 'rgba(245, 158, 11, 0.16)' : 'rgba(56, 189, 248, 0.16)';
      ctx.strokeStyle = p.requiresGlobal ? 'rgba(245, 158, 11, 0.85)' : 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 2;
      let labelCenterX = 0;
      let labelTopY = 0;
      let labelBottomY = 0;

      if (cam3d) {
        if (!traceProjectedQuad(ctx, wx0, wy0, wx1, wy1, cam3d, sx, sy)) continue;
        ctx.fill();
        ctx.stroke();
        labelCenterX = (_p0.x + _p1.x + _p2.x + _p3.x) * 0.25 * sx;
        labelTopY = Math.min(_p0.y, _p1.y, _p2.y, _p3.y) * sy;
        labelBottomY = Math.max(_p0.y, _p1.y, _p2.y, _p3.y) * sy;
      } else {
        const x = (wx0 - camX) * sx;
        const y = (wy0 - camY) * sy;
        const w = (wx1 - wx0) * sx;
        const h = (wy1 - wy0) * sy;
        if (x + w < 0 || x > cw || y + h < 0 || y > ch) continue;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2));
        labelCenterX = x + w * 0.5;
        labelTopY = y;
        labelBottomY = y + h;
      }

      if (p.name) {
        ctx.font = '600 11px "Plus Jakarta Sans", "Noto Sans TC", sans-serif';
        const tw = ctx.measureText(p.name).width;
        const bx = Math.max(4, Math.min(cw - tw - 14, labelCenterX - tw * 0.5 - 5));
        const preferredY = labelTopY < 44 ? labelBottomY + 4 : labelTopY - 22;
        const by = Math.max(28, Math.min(ch - 46, preferredY));
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fillRect(bx, by, tw + 10, 17);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(p.name, bx + 5, by + 12);
      }
    }
  }

  // 3. Rect-Fill Live Marquee
  if (info.rectDrag) {
    const cMin = Math.min(info.rectDrag.c0, info.rectDrag.c1);
    const cMax = Math.max(info.rectDrag.c0, info.rectDrag.c1);
    const rMin = Math.min(info.rectDrag.r0, info.rectDrag.r1);
    const rMax = Math.max(info.rectDrag.r0, info.rectDrag.r1);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    if (cam3d) {
      if (traceProjectedQuad(ctx, cMin * ts, rMin * ts, (cMax + 1) * ts, (rMax + 1) * ts, cam3d, sx, sy)) {
        ctx.fill();
        ctx.stroke();
      }
    } else {
      const x = (cMin * ts - camX) * sx;
      const y = (rMin * ts - camY) * sy;
      const w = (cMax - cMin + 1) * ts * sx;
      const h = (rMax - rMin + 1) * ts * sy;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2));
    }
    ctx.setLineDash([]);
  }

  // 4. Hover Tile Cursor
  if (
    info.hoverCol >= 0 &&
    info.hoverCol < room.cols &&
    info.hoverRow >= 0 &&
    info.hoverRow < room.rows &&
    state.tool !== 'pan'
  ) {
    ctx.strokeStyle =
      state.tool === 'erase' ? '#ef4444' : state.tool === 'stamp' ? '#38bdf8' : '#f59e0b';
    ctx.lineWidth = 2;
    let hx = 0;
    let hy = 0;
    let hh = ts * sy;

    if (cam3d) {
      if (
        traceProjectedQuad(
          ctx,
          info.hoverCol * ts,
          info.hoverRow * ts,
          (info.hoverCol + 1) * ts,
          (info.hoverRow + 1) * ts,
          cam3d,
          sx,
          sy,
        )
      ) {
        ctx.stroke();
        hx = Math.min(_p0.x, _p3.x) * sx;
        hy = Math.min(_p0.y, _p1.y) * sy;
        hh = (Math.max(_p2.y, _p3.y) - Math.min(_p0.y, _p1.y)) * sy;
      }
    } else {
      hx = (info.hoverCol * ts - camX) * sx;
      hy = (info.hoverRow * ts - camY) * sy;
      const hw = ts * sx;
      ctx.strokeRect(hx + 1, hy + 1, Math.max(2, hw - 2), Math.max(2, hh - 2));
    }

    const coordText = `(${info.hoverCol}, ${info.hoverRow})`;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    const tw = ctx.measureText(coordText).width;
    const tx = Math.max(4, Math.min(cw - tw - 10, hx + 2));
    const ty = hy > 20 ? hy - 16 : hy + hh + 3;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.fillRect(tx, ty, tw + 8, 14);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(coordText, tx + 4, ty + 10);
  }
}

export const renderMapOverlay = drawMapEditorOverlay;
