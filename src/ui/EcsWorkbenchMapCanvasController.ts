import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { getRoomTile } from '../core/ecs/EcsTilemapTypes.ts';
import type { GpuEngine } from '../core/gpu/GpuEngine.ts';
import {
  computeCamera3D,
  createComputedCamera3D,
  DEFAULT_HD2D_3D_FOV_DEG,
  DEFAULT_HD2D_3D_PITCH_DEG,
  projectWorld3DToScreen,
  screenToWorldPlaneZ,
  type ComputedCamera3D,
  type ScreenPoint3D,
} from '../core/math/Perspective3DMath.ts';
import { drawMapEditorOverlay, type MapDesignerState } from './EcsMapDesignerPanel.ts';

export interface MapCanvasControllerDeps {
  canvas: HTMLCanvasElement;
  session: EcsStudioSession;
  runtime: EcsCartridgeRuntime;
  previewGpu: GpuEngine;
  mapState: MapDesignerState;
  isEditingActive: () => boolean;
  onToolStateMutated: () => void;
  onEntityStamped: (entityId: string) => void;
}

/**
 * Self-contained interactive 2D/3D Tilemap Viewport Overlay Controller:
 * handles 3D plane-raycast tile picking, brush/erase/rect/fill/eyedropper/stamp/pan tools,
 * transactional commit on pointerup, and zero-allocation live brush overlay rendering.
 */
export class EcsWorkbenchMapCanvasController {
  private readonly ac = new AbortController();
  private readonly deps: MapCanvasControllerDeps;
  private readonly ctx: CanvasRenderingContext2D | null;

  private hoverTileCol = -1;
  private hoverTileRow = -1;
  private pointerMode: 'none' | 'brush' | 'rect' | 'pan' = 'none';
  private pendingBrushMap = new Map<string, { col: number; row: number; tileId: number }>();
  private rectDrag: { c0: number; r0: number; c1: number; r1: number } | null = null;
  private panOrigin = { clientX: 0, clientY: 0, camX: 0, camY: 0 };

  private readonly editCam3D: ComputedCamera3D = createComputedCamera3D();
  private readonly pickWorldScratch: [number, number] = [0, 0];
  private readonly overlayPtsScratch: readonly [ScreenPoint3D, ScreenPoint3D, ScreenPoint3D, ScreenPoint3D] = [
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
  ];

  constructor(deps: MapCanvasControllerDeps) {
    this.deps = deps;
    this.ctx = deps.canvas.getContext('2d');
    this.bindEvents();
  }

  public clearPendingStroke(): void {
    this.pointerMode = 'none';
    this.rectDrag = null;
    this.pendingBrushMap.clear();
  }

  public syncInteractivity(): void {
    const active = this.deps.isEditingActive();
    this.deps.canvas.classList.toggle('is-interactive', active);
    this.deps.canvas.classList.toggle('is-pan', active && this.deps.mapState.tool === 'pan');
    if (!active && this.ctx) {
      this.ctx.clearRect(0, 0, this.deps.canvas.width, this.deps.canvas.height);
    }
  }

  private computeActiveEditorCamera3D(proj: EcsProjectV2): ComputedCamera3D | null {
    if (proj.projection?.mode !== 'hd2d_3d' || !this.deps.previewGpu.supports3D()) {
      return null;
    }
    const cam = this.deps.runtime.getCamera();
    const viewW = proj.viewport.width;
    const viewH = proj.viewport.height;
    return computeCamera3D(
      {
        camCenterX: Math.round(cam.x) + viewW * 0.5,
        camCenterY: Math.round(cam.y) + viewH * 0.5,
        zoom: 1,
        viewW,
        viewH,
        pitchDeg: proj.projection.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG,
        fovDeg: proj.projection.fovDeg ?? DEFAULT_HD2D_3D_FOV_DEG,
      },
      this.editCam3D,
    );
  }

  private screenToTile(
    clientX: number,
    clientY: number,
  ): { col: number; row: number; worldX: number; worldY: number } | null {
    const proj = this.deps.session.getProject();
    if (!proj.worldMap) return null;
    const rect = this.deps.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    const ts = Math.max(8, proj.worldMap.tileSize);

    const cam3d = this.computeActiveEditorCamera3D(proj);
    let worldX: number;
    let worldY: number;
    if (cam3d) {
      const screenX = relX * proj.viewport.width;
      const screenY = relY * proj.viewport.height;
      if (!screenToWorldPlaneZ(screenX, screenY, cam3d, this.pickWorldScratch, 0)) {
        return null;
      }
      worldX = this.pickWorldScratch[0];
      worldY = this.pickWorldScratch[1];
    } else {
      const cam = this.deps.runtime.getCamera();
      worldX = cam.x + relX * proj.viewport.width;
      worldY = cam.y + relY * proj.viewport.height;
    }
    return {
      col: Math.floor(worldX / ts),
      row: Math.floor(worldY / ts),
      worldX,
      worldY,
    };
  }

  private bindEvents(): void {
    const { signal } = this.ac;
    const { canvas, session, runtime, mapState } = this.deps;

    canvas.addEventListener(
      'contextmenu',
      (e) => {
        if (this.deps.isEditingActive()) e.preventDefault();
      },
      { signal },
    );

    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.deps.isEditingActive()) return;
        const proj = session.getProject();
        const wm = proj.worldMap;
        const roomId = runtime.getActiveRoomId();
        if (!wm || !roomId) return;
        const room = wm.rooms.find((r) => r.id === roomId);
        if (!room) return;

        canvas.setPointerCapture(e.pointerId);

        if (e.button === 2 || e.button === 1 || mapState.tool === 'pan') {
          const cam = runtime.getCamera();
          this.pointerMode = 'pan';
          this.panOrigin = { clientX: e.clientX, clientY: e.clientY, camX: cam.x, camY: cam.y };
          return;
        }

        const hit = this.screenToTile(e.clientX, e.clientY);
        if (!hit || hit.col < 0 || hit.col >= room.cols || hit.row < 0 || hit.row >= room.rows) return;
        this.hoverTileCol = hit.col;
        this.hoverTileRow = hit.row;

        if (mapState.tool === 'eyedropper') {
          const tid = getRoomTile(room, mapState.layer, hit.col, hit.row);
          if (tid > 0) {
            mapState.selectedTileId = tid;
            mapState.tool = 'brush';
            this.deps.onToolStateMutated();
          }
          return;
        }

        if (mapState.tool === 'fill') {
          session.dispatch({
            type: 'flood_fill',
            roomId: room.id,
            layer: mapState.layer,
            col: hit.col,
            row: hit.row,
            tileId: mapState.selectedTileId,
          });
          return;
        }

        if (mapState.tool === 'stamp' && mapState.selectedStampPrefabId) {
          const ts = wm.tileSize;
          const res = session.dispatch({
            type: 'instantiate_prefab',
            prefabId: mapState.selectedStampPrefabId,
            x: hit.col * ts + ts * 0.5,
            y: hit.row * ts + ts * 0.5,
            roomId: room.id,
          });
          if (res.ok && res.createdEntityId) {
            this.deps.onEntityStamped(res.createdEntityId);
          }
          return;
        }

        if (mapState.tool === 'rect') {
          this.pointerMode = 'rect';
          this.rectDrag = { c0: hit.col, r0: hit.row, c1: hit.col, r1: hit.row };
          return;
        }

        if (mapState.tool === 'brush' || mapState.tool === 'erase') {
          this.pointerMode = 'brush';
          this.pendingBrushMap.clear();
          const tileId = mapState.tool === 'erase' ? 0 : mapState.selectedTileId;
          this.pendingBrushMap.set(`${hit.col},${hit.row}`, { col: hit.col, row: hit.row, tileId });
        }
      },
      { signal },
    );

    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.deps.isEditingActive()) return;
        const proj = session.getProject();
        const wm = proj.worldMap;
        const roomId = runtime.getActiveRoomId();
        if (!wm || !roomId) return;
        const room = wm.rooms.find((r) => r.id === roomId);
        if (!room) return;

        if (this.pointerMode === 'pan') {
          const rect = canvas.getBoundingClientRect();
          const scaleX = proj.viewport.width / Math.max(1, rect.width);
          const scaleY = proj.viewport.height / Math.max(1, rect.height);
          const dx = (e.clientX - this.panOrigin.clientX) * scaleX;
          const dy = (e.clientY - this.panOrigin.clientY) * scaleY;
          runtime.setEditorCamera(this.panOrigin.camX - dx, this.panOrigin.camY - dy);
          return;
        }

        const hit = this.screenToTile(e.clientX, e.clientY);
        if (!hit) return;
        this.hoverTileCol = hit.col;
        this.hoverTileRow = hit.row;

        if (this.pointerMode === 'rect' && this.rectDrag) {
          this.rectDrag.c1 = Math.max(0, Math.min(room.cols - 1, hit.col));
          this.rectDrag.r1 = Math.max(0, Math.min(room.rows - 1, hit.row));
        } else if (this.pointerMode === 'brush') {
          if (hit.col >= 0 && hit.col < room.cols && hit.row >= 0 && hit.row < room.rows) {
            const tileId = mapState.tool === 'erase' ? 0 : mapState.selectedTileId;
            this.pendingBrushMap.set(`${hit.col},${hit.row}`, { col: hit.col, row: hit.row, tileId });
          }
        }
      },
      { signal },
    );

    const finishPointer = () => {
      if (this.pointerMode === 'none') return;
      const roomId = runtime.getActiveRoomId();
      if (this.pointerMode === 'brush' && roomId && this.pendingBrushMap.size > 0) {
        session.dispatch({
          type: 'paint_tiles',
          roomId,
          layer: mapState.layer,
          changes: Array.from(this.pendingBrushMap.values()),
        });
      } else if (this.pointerMode === 'rect' && roomId && this.rectDrag) {
        session.dispatch({
          type: 'fill_rect',
          roomId,
          layer: mapState.layer,
          c0: this.rectDrag.c0,
          r0: this.rectDrag.r0,
          c1: this.rectDrag.c1,
          r1: this.rectDrag.r1,
          tileId: mapState.selectedTileId,
        });
      }
      this.clearPendingStroke();
    };

    canvas.addEventListener('pointerup', finishPointer, { signal });
    canvas.addEventListener('pointercancel', finishPointer, { signal });
    canvas.addEventListener(
      'pointerleave',
      () => {
        if (this.pointerMode === 'none') {
          this.hoverTileCol = -1;
          this.hoverTileRow = -1;
        }
      },
      { signal },
    );
  }

  public renderOverlay(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { canvas, session, runtime, mapState } = this.deps;
    if (!this.deps.isEditingActive()) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const proj = session.getProject();
    const wm = proj.worldMap;
    const activeRoomId = runtime.getActiveRoomId();
    const room = wm?.rooms.find((r) => r.id === activeRoomId);
    if (!wm || !room) return;
    const cam = runtime.getCamera();
    const cam3d = this.computeActiveEditorCamera3D(proj);
    drawMapEditorOverlay(canvas, ctx, {
      room,
      portals: wm.portals.filter((p) => p.fromRoomId === room.id),
      tileSize: wm.tileSize,
      camX: cam.x,
      camY: cam.y,
      viewW: proj.viewport.width,
      viewH: proj.viewport.height,
      state: mapState,
      hoverCol: this.hoverTileCol,
      hoverRow: this.hoverTileRow,
      rectDrag: this.rectDrag,
      camera3D: cam3d,
    });

    if (this.pendingBrushMap.size > 0) {
      const sx = canvas.width / Math.max(1, proj.viewport.width);
      const sy = canvas.height / Math.max(1, proj.viewport.height);
      const ts = wm.tileSize;
      ctx.fillStyle = mapState.tool === 'erase' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.38)';
      if (cam3d) {
        const [p0, p1, p2, p3] = this.overlayPtsScratch;
        for (const edit of this.pendingBrushMap.values()) {
          const x0 = edit.col * ts;
          const y0 = edit.row * ts;
          projectWorld3DToScreen(x0, y0, 0, cam3d, p0);
          projectWorld3DToScreen(x0 + ts, y0, 0, cam3d, p1);
          projectWorld3DToScreen(x0 + ts, y0 + ts, 0, cam3d, p2);
          projectWorld3DToScreen(x0, y0 + ts, 0, cam3d, p3);
          if (!p0.visible || !p1.visible || !p2.visible || !p3.visible) continue;
          ctx.beginPath();
          ctx.moveTo(p0.x * sx, p0.y * sy);
          ctx.lineTo(p1.x * sx, p1.y * sy);
          ctx.lineTo(p2.x * sx, p2.y * sy);
          ctx.lineTo(p3.x * sx, p3.y * sy);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        for (const edit of this.pendingBrushMap.values()) {
          ctx.fillRect((edit.col * ts - cam.x) * sx, (edit.row * ts - cam.y) * sy, ts * sx, ts * sy);
        }
      }
    }
  }

  public destroy(): void {
    this.clearPendingStroke();
    this.ac.abort();
  }
}
