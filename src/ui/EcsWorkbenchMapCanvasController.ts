import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand, EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { getRoomTile } from '../core/ecs/EcsTilemapTypes.ts';
import type { GpuEngine } from '../core/gpu/GpuEngine.ts';
import {
  computeCamera3D,
  createComputedCamera3D,
  DEFAULT_HD2D_3D_FOV_DEG,
  DEFAULT_HD2D_3D_PITCH_DEG,
  projectWorld3DToScreen,
  screenToWorldPlaneAxis,
  screenToWorldPlaneZ,
  type ComputedCamera3D,
  type ScreenPoint3D,
} from '../core/math/Perspective3DMath.ts';
import { renderMapOverlay, type MapDesignerState } from './EcsMapDesignerPanel.ts';
import type { EcsWorkbenchLiveMutator } from './EcsWorkbenchLiveMutator.ts';

export interface MapCanvasControllerDeps {
  canvas: HTMLCanvasElement;
  session: EcsStudioSession;
  runtime: EcsCartridgeRuntime;
  previewGpu: GpuEngine;
  mapState: MapDesignerState;
  liveMutator?: EcsWorkbenchLiveMutator;
  getSelectedEntityId?: () => string | null;
  isEditingActive: () => boolean;
  onToolStateMutated: () => void;
  onEntityStamped: (entityId: string) => void;
  onPreviewDirty?: () => void;
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
  private pointerMode: 'none' | 'brush' | 'rect' | 'pan' | 'orbit' | 'gizmo' = 'none';
  private pendingBrushMap = new Map<string, { col: number; row: number; tileId: number }>();
  private rectDrag: { c0: number; r0: number; c1: number; r1: number } | null = null;
  private panOrigin = { clientX: 0, clientY: 0, camX: 0, camY: 0 };
  private orbitOrigin = { clientX: 0, clientY: 0, yawDeg: 0, pitchDeg: 42, curYawDeg: 0, curPitchDeg: 42 };
  private gizmoDrag: {
    entityId: string;
    axis: 'x' | 'y' | 'z';
    startX: number;
    startY: number;
    startZ: number;
    centerX: number;
    centerY: number;
    dragStartVal: number;
    startClientY: number;
    zPlaneAxis: 'x' | 'y';
    zPlaneVal: number;
    curX: number;
    curY: number;
    curZ: number;
  } | null = null;

  private readonly editCam3D: ComputedCamera3D = createComputedCamera3D();
  private readonly pickWorldScratch: [number, number] = [0, 0];
  private readonly axisPickScratch: [number, number, number] = [0, 0, 0];
  private readonly gizmoOriginScratch: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: true };
  private readonly gizmoEndScratch: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: true };
  private fovMaskBuf = new Uint8Array(64 * 64);
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
    this.gizmoDrag = null;
    this.pendingBrushMap.clear();
  }

  public syncInteractivity(): void {
    const active = this.deps.isEditingActive();
    const proj = this.deps.session.getProject();
    const isQuad = proj.projection?.mode === 'hd2d_3d' && Boolean(proj.projection.quadView);
    this.deps.canvas.classList.toggle('is-interactive', active);
    this.deps.canvas.classList.toggle('is-pan', active && this.deps.mapState.tool === 'pan');
    if (!active && !this.deps.mapState.showFovPreview && !isQuad && this.ctx) {
      this.ctx.clearRect(0, 0, this.deps.canvas.width, this.deps.canvas.height);
    }
  }

  private computeActiveEditorCamera3D(proj: EcsProjectV2): ComputedCamera3D | null {
    if (proj.projection?.mode !== 'hd2d_3d' || proj.projection.quadView || !this.deps.previewGpu.supports3D()) {
      return null;
    }
    const cam = this.deps.runtime.getCamera();
    const viewW = proj.viewport.width;
    const viewH = proj.viewport.height;
    return computeCamera3D(
      {
        camCenterX: Math.round(cam.x) + viewW * 0.5,
        camCenterY: Math.round(cam.y) + viewH * 0.5,
        camCenterZ: proj.projection.camCenterZ ?? 0,
        zoom: 1,
        yawDeg: proj.projection.yawDeg ?? 0,
        pitchDeg: proj.projection.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG,
        rollDeg: proj.projection.rollDeg ?? 0,
        fovDeg: proj.projection.fovDeg ?? DEFAULT_HD2D_3D_FOV_DEG,
        projection: proj.projection.cameraProjection3d ?? 'perspective',
        viewW,
        viewH,
      },
      this.editCam3D,
    );
  }

  private getSelectedEntityWorldState(
    proj: EcsProjectV2,
    roomId: string | undefined,
  ): {
    entityId: string;
    x: number;
    y: number;
    z: number;
    centerX: number;
    centerY: number;
    hasTransform: boolean;
    hasSpatial3D: boolean;
  } | null {
    const selectedId = this.deps.getSelectedEntityId?.();
    if (!selectedId) return null;
    const ent = proj.entities.find((e) => e.id === selectedId);
    if (!ent) return null;
    if (roomId && ent.roomId && ent.roomId !== roomId) return null;

    let x = ent.components.transform?.x ?? 0;
    let y = ent.components.transform?.y ?? 0;
    let w = ent.components.transform?.w ?? 16;
    let h = ent.components.transform?.h ?? 16;
    let z = ent.components.spatial3d?.z ?? 0;

    const core = this.deps.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      if (tagStore.getDenseDataAt(i).entityId === ent.id) {
        const eh = tagStore.getDenseEntityAt(i);
        const tr = core.getComponent(eh, core.components.Transform2D);
        if (tr) {
          x = tr.x;
          y = tr.y;
          w = tr.w;
          h = tr.h;
        }
        const sp = core.getComponent(eh, core.components.Spatial3D);
        if (sp) {
          z = sp.z;
        }
        break;
      }
    }
    return {
      entityId: ent.id,
      x,
      y,
      z,
      centerX: x + w * 0.5,
      centerY: y + h * 0.5,
      hasTransform: Boolean(ent.components.transform),
      hasSpatial3D: Boolean(ent.components.spatial3d),
    };
  }

  private hitTestEntityGizmo(
    clientX: number,
    clientY: number,
    proj: EcsProjectV2,
    cam3d: ComputedCamera3D,
    roomId: string | undefined,
  ): 'x' | 'y' | 'z' | null {
    const info = this.getSelectedEntityWorldState(proj, roomId);
    if (!info) return null;
    const rect = this.deps.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ptrViewX = ((clientX - rect.left) / rect.width) * proj.viewport.width;
    const ptrViewY = ((clientY - rect.top) / rect.height) * proj.viewport.height;
    const axisLen = 28;
    const axes: readonly { id: 'x' | 'y' | 'z'; dx: number; dy: number; dz: number }[] = [
      { id: 'x', dx: axisLen, dy: 0, dz: 0 },
      { id: 'y', dx: 0, dy: axisLen, dz: 0 },
      { id: 'z', dx: 0, dy: 0, dz: axisLen },
    ];
    let bestAxis: 'x' | 'y' | 'z' | null = null;
    let bestDistSq = 14 * 14;
    for (const ax of axes) {
      projectWorld3DToScreen(info.centerX + ax.dx, info.centerY + ax.dy, info.z + ax.dz, cam3d, this.gizmoEndScratch);
      if (!this.gizmoEndScratch.visible) continue;
      const dx = this.gizmoEndScratch.x - ptrViewX;
      const dy = this.gizmoEndScratch.y - ptrViewY;
      const dSq = dx * dx + dy * dy;
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        bestAxis = ax.id;
      }
    }
    return bestAxis;
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
    const activeRoomId = this.deps.runtime.getActiveRoomId();
    const activeRoom = proj.worldMap.rooms.find((r) => r.id === activeRoomId);
    const planeZ = this.deps.mapState.activeZLevel * (activeRoom?.storyHeight ?? 32);

    const cam3d = this.computeActiveEditorCamera3D(proj);
    let worldX: number;
    let worldY: number;
    if (cam3d) {
      const screenX = relX * proj.viewport.width;
      const screenY = relY * proj.viewport.height;
      if (!screenToWorldPlaneZ(screenX, screenY, cam3d, this.pickWorldScratch, planeZ)) {
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

        if (proj.projection?.mode === 'hd2d_3d' && ((e.altKey && e.button === 0) || (e.shiftKey && e.button === 2))) {
          const yaw0 = proj.projection.yawDeg ?? 0;
          const pitch0 = proj.projection.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG;
          this.pointerMode = 'orbit';
          this.orbitOrigin = {
            clientX: e.clientX,
            clientY: e.clientY,
            yawDeg: yaw0,
            pitchDeg: pitch0,
            curYawDeg: yaw0,
            curPitchDeg: pitch0,
          };
          this.deps.onPreviewDirty?.();
          return;
        }

        const cam3d = this.computeActiveEditorCamera3D(proj);
        if (cam3d && e.button === 0) {
          const hitAxis = this.hitTestEntityGizmo(e.clientX, e.clientY, proj, cam3d, room.id);
          const entState = hitAxis ? this.getSelectedEntityWorldState(proj, room.id) : null;
          if (hitAxis && entState) {
            const rect = canvas.getBoundingClientRect();
            const ptrX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * proj.viewport.width;
            const ptrY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * proj.viewport.height;
            const yawRad = ((proj.projection?.yawDeg ?? 0) * Math.PI) / 180;
            const zPlaneAxis: 'x' | 'y' = Math.abs(Math.sin(yawRad)) < Math.abs(Math.cos(yawRad)) ? 'y' : 'x';
            const zPlaneVal = zPlaneAxis === 'y' ? entState.centerY : entState.centerX;
            let dragStartVal = 0;
            if (hitAxis === 'z') {
              dragStartVal = screenToWorldPlaneAxis(ptrX, ptrY, cam3d, zPlaneAxis, zPlaneVal, this.axisPickScratch)
                ? this.axisPickScratch[2]
                : entState.z;
            } else if (screenToWorldPlaneAxis(ptrX, ptrY, cam3d, 'z', entState.z, this.axisPickScratch)) {
              dragStartVal = hitAxis === 'x' ? this.axisPickScratch[0] : this.axisPickScratch[1];
            }
            this.pointerMode = 'gizmo';
            this.gizmoDrag = {
              entityId: entState.entityId,
              axis: hitAxis,
              startX: entState.x,
              startY: entState.y,
              startZ: entState.z,
              centerX: entState.centerX,
              centerY: entState.centerY,
              dragStartVal,
              startClientY: e.clientY,
              zPlaneAxis,
              zPlaneVal,
              curX: entState.x,
              curY: entState.y,
              curZ: entState.z,
            };
            this.deps.onPreviewDirty?.();
            this.renderOverlay();
            return;
          }
        }

        if (e.button === 2 || e.button === 1 || mapState.tool === 'pan') {
          const cam = runtime.getCamera();
          this.pointerMode = 'pan';
          this.panOrigin = { clientX: e.clientX, clientY: e.clientY, camX: cam.x, camY: cam.y };
          this.deps.onPreviewDirty?.();
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
          this.deps.onPreviewDirty?.();
          this.renderOverlay();
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
          this.deps.onPreviewDirty?.();
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
          this.deps.onPreviewDirty?.();
          return;
        }

        if (mapState.tool === 'rect') {
          this.pointerMode = 'rect';
          this.rectDrag = { c0: hit.col, r0: hit.row, c1: hit.col, r1: hit.row };
          this.deps.onPreviewDirty?.();
          this.renderOverlay();
          return;
        }

        if (mapState.tool === 'brush' || mapState.tool === 'erase') {
          this.pointerMode = 'brush';
          this.pendingBrushMap.clear();
          const tileId = mapState.tool === 'erase' ? 0 : mapState.selectedTileId;
          this.pendingBrushMap.set(`${hit.col},${hit.row}`, { col: hit.col, row: hit.row, tileId });
          this.deps.onPreviewDirty?.();
          this.renderOverlay();
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

        if (this.pointerMode === 'orbit') {
          const dx = e.clientX - this.orbitOrigin.clientX;
          const dy = e.clientY - this.orbitOrigin.clientY;
          const yawDeg = (((this.orbitOrigin.yawDeg + dx * 0.45) % 360) + 360) % 360;
          const pitchDeg = Math.max(-45, Math.min(85, this.orbitOrigin.pitchDeg + dy * 0.35));
          this.orbitOrigin.curYawDeg = yawDeg;
          this.orbitOrigin.curPitchDeg = pitchDeg;
          runtime.patchLiveProjection({ yawDeg, pitchDeg });
          this.deps.onPreviewDirty?.();
          return;
        }

        if (this.pointerMode === 'gizmo' && this.gizmoDrag) {
          const cam3d = this.computeActiveEditorCamera3D(proj);
          if (cam3d) {
            const rect = canvas.getBoundingClientRect();
            const ptrX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * proj.viewport.width;
            const ptrY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * proj.viewport.height;
            if (this.gizmoDrag.axis === 'z') {
              const hitOk = screenToWorldPlaneAxis(
                ptrX,
                ptrY,
                cam3d,
                this.gizmoDrag.zPlaneAxis,
                this.gizmoDrag.zPlaneVal,
                this.axisPickScratch,
              );
              const deltaZ = hitOk
                ? this.axisPickScratch[2] - this.gizmoDrag.dragStartVal
                : (this.gizmoDrag.startClientY - e.clientY) * 0.85;
              this.gizmoDrag.curZ = Math.max(0, Math.round(this.gizmoDrag.startZ + deltaZ));
              this.deps.liveMutator?.mutateSpatial3D(this.gizmoDrag.entityId, { z: this.gizmoDrag.curZ });
            } else if (screenToWorldPlaneAxis(ptrX, ptrY, cam3d, 'z', this.gizmoDrag.startZ, this.axisPickScratch)) {
              if (this.gizmoDrag.axis === 'x') {
                const deltaX = this.axisPickScratch[0] - this.gizmoDrag.dragStartVal;
                this.gizmoDrag.curX = Math.round(this.gizmoDrag.startX + deltaX);
                this.deps.liveMutator?.mutateTransform(this.gizmoDrag.entityId, { x: this.gizmoDrag.curX });
              } else {
                const deltaY = this.axisPickScratch[1] - this.gizmoDrag.dragStartVal;
                this.gizmoDrag.curY = Math.round(this.gizmoDrag.startY + deltaY);
                this.deps.liveMutator?.mutateTransform(this.gizmoDrag.entityId, { y: this.gizmoDrag.curY });
              }
            }
          }
          this.deps.onPreviewDirty?.();
          this.renderOverlay();
          return;
        }

        if (this.pointerMode === 'pan') {
          const rect = canvas.getBoundingClientRect();
          const scaleX = proj.viewport.width / Math.max(1, rect.width);
          const scaleY = proj.viewport.height / Math.max(1, rect.height);
          const dx = (e.clientX - this.panOrigin.clientX) * scaleX;
          const dy = (e.clientY - this.panOrigin.clientY) * scaleY;
          runtime.setEditorCamera(this.panOrigin.camX - dx, this.panOrigin.camY - dy);
          this.deps.onPreviewDirty?.();
          return;
        }

        const hit = this.screenToTile(e.clientX, e.clientY);
        if (!hit) return;
        const cellChanged = this.hoverTileCol !== hit.col || this.hoverTileRow !== hit.row;
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
        if (cellChanged || this.pointerMode === 'rect' || this.pointerMode === 'brush') {
          this.deps.onPreviewDirty?.();
          this.renderOverlay();
        }
      },
      { signal },
    );

    const finishPointer = () => {
      if (this.pointerMode === 'none') return;
      const proj = session.getProject();
      const roomId = runtime.getActiveRoomId();
      const isVoxel3dStroke =
        proj.projection?.mode === 'hd2d_3d' && (mapState.activeZLevel > 0 || mapState.voxelShape !== 'cube');

      if (this.pointerMode === 'orbit') {
        session.dispatch({
          type: 'set_camera_3d_pose',
          yawDeg: Math.round(this.orbitOrigin.curYawDeg),
          pitchDeg: Math.round(this.orbitOrigin.curPitchDeg),
        });
      } else if (this.pointerMode === 'gizmo' && this.gizmoDrag) {
        const g = this.gizmoDrag;
        const ent = proj.entities.find((item) => item.id === g.entityId);
        if (g.axis === 'z' && (g.curZ !== g.startZ)) {
          const prevSp = ent?.components.spatial3d ?? {};
          session.dispatch({
            type: 'patch_entity',
            entityId: g.entityId,
            patch: { spatial3d: { ...prevSp, z: g.curZ } },
          });
        } else if (g.axis !== 'z' && (g.curX !== g.startX || g.curY !== g.startY)) {
          const prevTr = ent?.components.transform ?? { x: g.startX, y: g.startY };
          session.dispatch({
            type: 'patch_entity',
            entityId: g.entityId,
            patch: { transform: { ...prevTr, x: g.curX, y: g.curY } },
          });
        }
      } else if (this.pointerMode === 'brush' && roomId && this.pendingBrushMap.size > 0) {
        if (isVoxel3dStroke) {
          const cmds: EcsStudioCommand[] = [];
          for (const edit of this.pendingBrushMap.values()) {
            cmds.push({
              type: 'set_room_voxel',
              roomId,
              cell: {
                col: edit.col,
                row: edit.row,
                zLevel: mapState.activeZLevel,
                tileId: edit.tileId,
                shape: mapState.voxelShape,
              },
            });
          }
          if (cmds.length === 1) {
            session.dispatch(cmds[0]);
          } else {
            session.dispatchBatch(cmds, `繪製 3D 體素 (${cmds.length} 格 · Z=${mapState.activeZLevel})`);
          }
        } else {
          session.dispatch({
            type: 'paint_tiles',
            roomId,
            layer: mapState.layer,
            changes: Array.from(this.pendingBrushMap.values()),
          });
        }
      } else if (this.pointerMode === 'rect' && roomId && this.rectDrag) {
        if (isVoxel3dStroke) {
          session.dispatch({
            type: 'fill_room_box_3d',
            roomId,
            c0: this.rectDrag.c0,
            r0: this.rectDrag.r0,
            z0: mapState.activeZLevel,
            c1: this.rectDrag.c1,
            r1: this.rectDrag.r1,
            z1: mapState.activeZLevel,
            tileId: mapState.tool === 'erase' ? 0 : mapState.selectedTileId,
            shape: mapState.voxelShape,
          });
        } else {
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
      }
      this.clearPendingStroke();
      this.deps.onPreviewDirty?.();
      this.renderOverlay();
    };

    canvas.addEventListener('pointerup', finishPointer, { signal });
    canvas.addEventListener('pointercancel', finishPointer, { signal });
    canvas.addEventListener(
      'pointerleave',
      () => {
        if (this.pointerMode === 'none' && (this.hoverTileCol !== -1 || this.hoverTileRow !== -1)) {
          this.hoverTileCol = -1;
          this.hoverTileRow = -1;
          this.deps.onPreviewDirty?.();
          this.renderOverlay();
        }
      },
      { signal },
    );
  }

  public renderOverlay(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { canvas, session, runtime, mapState } = this.deps;
    const editingActive = this.deps.isEditingActive();
    const proj = session.getProject();
    if (proj.projection?.mode === 'hd2d_3d' && proj.projection.quadView) {
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      const halfW = Math.round(cw * 0.5) + 0.5;
      const halfH = Math.round(ch * 0.5) + 0.5;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(halfW, 0);
      ctx.lineTo(halfW, ch);
      ctx.moveTo(0, halfH);
      ctx.lineTo(cw, halfH);
      ctx.stroke();

      const quadLabels: readonly { text: string; x: number; y: number }[] = [
        { text: '3D PERSP', x: 8, y: 10 },
        { text: 'TOP [XY]', x: halfW + 8, y: 10 },
        { text: 'FRONT [XZ]', x: 8, y: halfH + 10 },
        { text: 'SIDE [YZ]', x: halfW + 8, y: halfH + 10 },
      ];
      ctx.font = '700 11px "JetBrains Mono", monospace';
      for (const q of quadLabels) {
        const tw = ctx.measureText(q.text).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.fillRect(q.x, q.y, tw + 10, 18);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(q.text, q.x + 5, q.y + 13);
      }
      return;
    }

    const wm = proj.worldMap;
    const fovActive = Boolean(mapState.showFovPreview && wm);
    if (!editingActive && !fovActive) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const activeRoomId = runtime.getActiveRoomId();
    const room = wm?.rooms.find((r) => r.id === activeRoomId);
    if (!wm || !room) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let fovMask: Uint8Array | null = null;
    if (fovActive) {
      const needed = room.cols * room.rows;
      if (this.fovMaskBuf.length < needed) {
        this.fovMaskBuf = new Uint8Array(needed);
      }
      const core = runtime.world.core;
      const c = core.components;
      const tagStore = core.getStore(c.Tag);
      const ts = Math.max(8, wm.tileSize);
      let heroCol = Math.floor(room.cols * 0.5);
      let heroRow = Math.floor(room.rows * 0.5);
      for (let i = 0; i < tagStore.size(); i++) {
        const td = tagStore.getDenseDataAt(i);
        if (td.tag === 'hero' || td.tag === 'player' || td.entityId === 'hero') {
          const tr = core.getComponent(tagStore.getDenseEntityAt(i), c.Transform2D);
          if (tr) {
            heroCol = Math.max(0, Math.min(room.cols - 1, Math.floor((tr.x + tr.w * 0.5) / ts)));
            heroRow = Math.max(0, Math.min(room.rows - 1, Math.floor((tr.y + tr.h * 0.5) / ts)));
            break;
          }
        }
      }
      const radius = Math.max(7, Math.min(12, Math.round(Math.max(room.cols, room.rows) * 0.42)));
      runtime.getWorldMapController().computeRoomFovMask(
        heroCol,
        heroRow,
        radius,
        runtime.world.globals,
        this.fovMaskBuf,
      );
      fovMask = this.fovMaskBuf;
    }

    const cam = runtime.getCamera();
    const cam3d = this.computeActiveEditorCamera3D(proj);
    renderMapOverlay(canvas, ctx, {
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
      fovMask,
      showEditingAffordances: editingActive,
    });

    const planeZ = mapState.activeZLevel * (room.storyHeight ?? 32);
    const sx = canvas.width / Math.max(1, proj.viewport.width);
    const sy = canvas.height / Math.max(1, proj.viewport.height);

    if (editingActive && this.pendingBrushMap.size > 0) {
      const ts = wm.tileSize;
      ctx.fillStyle = mapState.tool === 'erase' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.38)';
      if (cam3d) {
        const [p0, p1, p2, p3] = this.overlayPtsScratch;
        for (const edit of this.pendingBrushMap.values()) {
          const x0 = edit.col * ts;
          const y0 = edit.row * ts;
          projectWorld3DToScreen(x0, y0, planeZ, cam3d, p0);
          projectWorld3DToScreen(x0 + ts, y0, planeZ, cam3d, p1);
          projectWorld3DToScreen(x0 + ts, y0 + ts, planeZ, cam3d, p2);
          projectWorld3DToScreen(x0, y0 + ts, planeZ, cam3d, p3);
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

    // 5. Interactive RGB XYZ Gizmo Handles around selected entity in hd2d_3d mode
    if (editingActive && cam3d) {
      const entState = this.getSelectedEntityWorldState(proj, room.id);
      if (entState) {
        projectWorld3DToScreen(entState.centerX, entState.centerY, entState.z, cam3d, this.gizmoOriginScratch);
        if (this.gizmoOriginScratch.visible) {
          const ox = this.gizmoOriginScratch.x * sx;
          const oy = this.gizmoOriginScratch.y * sy;
          const axisLen = 28;
          const axes: readonly {
            id: 'x' | 'y' | 'z';
            label: string;
            color: string;
            dx: number;
            dy: number;
            dz: number;
          }[] = [
            { id: 'x', label: 'X', color: '#ef4444', dx: axisLen, dy: 0, dz: 0 },
            { id: 'y', label: 'Y', color: '#22c55e', dx: 0, dy: axisLen, dz: 0 },
            { id: 'z', label: 'Z', color: '#38bdf8', dx: 0, dy: 0, dz: axisLen },
          ];
          ctx.font = '700 10px "JetBrains Mono", monospace';
          for (const ax of axes) {
            projectWorld3DToScreen(
              entState.centerX + ax.dx,
              entState.centerY + ax.dy,
              entState.z + ax.dz,
              cam3d,
              this.gizmoEndScratch,
            );
            if (!this.gizmoEndScratch.visible) continue;
            const ex = this.gizmoEndScratch.x * sx;
            const ey = this.gizmoEndScratch.y * sy;
            const activeAxis = this.gizmoDrag?.axis === ax.id;
            ctx.strokeStyle = ax.color;
            ctx.fillStyle = ax.color;
            ctx.lineWidth = activeAxis ? 3 : 2;
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(ex, ey, activeAxis ? 6 : 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(ax.label, ex + 6, ey + 3);
          }
        }
      }
    }
  }

  public destroy(): void {
    this.clearPendingStroke();
    this.ac.abort();
  }
}
