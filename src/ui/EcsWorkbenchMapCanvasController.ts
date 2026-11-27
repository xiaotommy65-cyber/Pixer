import type { WorkbenchCameraViewChoice } from '../core/ai/AgentBridge.ts';
import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand, EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { getRoomTile, type EcsMapRoomDef } from '../core/ecs/EcsTilemapTypes.ts';
import type { GpuEngine } from '../core/gpu/GpuEngine.ts';
import {
  createComputedCamera3D,
  DEFAULT_HD2D_3D_PITCH_DEG,
  projectWorld3DToScreen,
  screenToWorldPlaneAxis,
  screenToWorldPlaneZ,
  type ComputedCamera3D,
  type ScreenPoint3D,
} from '../core/math/Perspective3DMath.ts';
import { renderMapOverlay, type MapDesignerState } from './EcsMapDesignerPanel.ts';
import {
  collectEntitiesInMarquee, collectRoomEntityPoses, computeQuadrantCamera3D, computeSelectionCentroid,
  drawGizmoOverlay, drawMarqueeOverlay, drawSelectionOverlay, hitTestGizmoHandle, hitTestQuadHeaderBadge,
  pickEntityAtScreen, QUAD_QUADRANTS, resolveQuadQuadrant, rotatePanDeltaByYaw, snapCoord,
  type GizmoHandleId, type GizmoRenderFeedback, type MarqueeRect, type QuadViewProjection,
  type ResolvedQuadQuadrant, type WorkbenchEntityPose,
} from './EcsWorkbenchGizmoController.ts';
import type { EcsWorkbenchLiveMutator } from './EcsWorkbenchLiveMutator.ts';

export interface MapCanvasControllerDeps {
  canvas: HTMLCanvasElement;
  session: EcsStudioSession;
  runtime: EcsCartridgeRuntime;
  previewGpu: GpuEngine;
  mapState: MapDesignerState;
  liveMutator?: EcsWorkbenchLiveMutator;
  getSelectedEntityId?: () => string | null;
  getSelectedEntityIds?: () => readonly string[];
  onSelectionChange?: (entityIds: string[]) => void;
  onToggleQuadSingleView?: (view: WorkbenchCameraViewChoice) => void;
  onSliceCutawaySync?: () => void;
  isEditingActive: () => boolean;
  onToolStateMutated: () => void;
  onEntityStamped: (entityId: string) => void;
  onPreviewDirty?: () => void;
}

interface GizmoDragItem {
  entityId: string;
  startX: number; startY: number; startZ: number; startYaw: number;
  startScaleX: number; startScaleY: number;
  startMeshScaleX: number; startMeshScaleY: number; startMeshScaleZ: number;
  hasMesh3d: boolean;
}

interface GizmoDragState {
  handle: GizmoHandleId;
  quadProj: QuadViewProjection | null;
  offsetX: number; offsetY: number; subW: number; subH: number;
  cx: number; cy: number; cz: number;
  originViewX: number; originViewY: number;
  startClientX: number; startClientY: number;
  startValX: number; startValY: number; startValZ: number;
  startAngleRad: number;
  zPlaneAxis: 'x' | 'y'; zPlaneVal: number; storyHeight: number;
  items: GizmoDragItem[];
  deltaX: number; deltaY: number; deltaZ: number; deltaYaw: number;
  scaleMult: number; snapGrid: number; snapStory: boolean;
  readoutLabel: string;
}

interface PointerViewContext {
  isQuad: boolean;
  quad: ResolvedQuadQuadrant | null;
  cam3d: ComputedCamera3D | null;
  viewX: number; viewY: number; localX: number; localY: number;
  offsetX: number; offsetY: number; subW: number; subH: number;
  yawDeg: number;
}

type MarqueeDragState = MarqueeRect & {
  shiftKey: boolean;
  quadProj: QuadViewProjection | null;
  offsetX: number; offsetY: number; subW: number; subH: number;
};

/**
 * Interactive 2D/3D Viewport Canvas Controller:
 * Select + Marquee/Shift Multi-Select, 3-Mode 3D Gizmo (Move/Rotate/Scale) with Grid/Story Snapping,
 * Godot/2D+3D Navigation (Orbit, Yaw-Aware Pan, Wheel Zoom, Shift+Wheel Z-Slice),
 * Interactive 4-Quadrant Quad-View, and explicit `voxel3d` layer editing.
 */
export class EcsWorkbenchMapCanvasController {
  private readonly ac = new AbortController();
  private readonly deps: MapCanvasControllerDeps;
  private readonly ctx: CanvasRenderingContext2D | null;

  private hoverTileCol = -1;
  private hoverTileRow = -1;
  private pointerMode: 'none' | 'brush' | 'rect' | 'pan' | 'orbit' | 'gizmo' | 'marquee' = 'none';
  private pendingBrushMap = new Map<string, { col: number; row: number; tileId: number }>();
  private rectDrag: { c0: number; r0: number; c1: number; r1: number } | null = null;
  private panOrigin = { clientX: 0, clientY: 0, camX: 0, camY: 0, yawDeg: 0, zoom: 1 };
  private orbitOrigin = { clientX: 0, clientY: 0, yawDeg: 0, pitchDeg: 42, curYawDeg: 0, curPitchDeg: 42 };
  private gizmoDrag: GizmoDragState | null = null;
  private marqueeDrag: MarqueeDragState | null = null;

  private readonly editCam3D: ComputedCamera3D = createComputedCamera3D();
  private readonly quadCamScratch: ComputedCamera3D = createComputedCamera3D();
  private readonly pickWorldScratch: [number, number] = [0, 0];
  private readonly axisPickScratch: [number, number, number] = [0, 0, 0];
  private readonly originScratch: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: true };
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
    this.marqueeDrag = null;
    this.pendingBrushMap.clear();
  }

  public syncInteractivity(): void {
    const active = this.deps.isEditingActive();
    const proj = this.deps.session.getProject();
    const isQuad = proj.projection?.mode === 'hd2d_3d' && Boolean(proj.projection.quadView);
    const panCursor = this.deps.mapState.tool === 'pan' || this.deps.mapState.spacePanHeld;
    this.deps.canvas.classList.toggle('is-interactive', active);
    this.deps.canvas.classList.toggle('is-pan', active && panCursor);
    if (!active && !this.deps.mapState.showFovPreview && !isQuad && this.ctx) {
      this.ctx.clearRect(0, 0, this.deps.canvas.width, this.deps.canvas.height);
    }
  }

  private getSelectedIds(): string[] {
    if (this.deps.getSelectedEntityIds) return [...this.deps.getSelectedEntityIds()];
    const single = this.deps.getSelectedEntityId?.();
    return single ? [single] : [];
  }

  private getEditorZoom(): number {
    return this.deps.runtime.getWorldMapController().getEditorZoom();
  }

  private computeCam3DFor(proj: EcsProjectV2, quadProj: QuadViewProjection | null, subW: number, subH: number): ComputedCamera3D | null {
    if (proj.projection?.mode !== 'hd2d_3d' || !this.deps.previewGpu.supports3D()) return null;
    return computeQuadrantCamera3D(
      proj,
      this.deps.runtime.getCamera(),
      this.getEditorZoom(),
      quadProj ?? proj.projection.cameraProjection3d ?? 'perspective',
      subW,
      subH,
      this.editCam3D,
    );
  }

  private resolvePointerView(clientX: number, clientY: number, proj: EcsProjectV2): PointerViewContext | null {
    const rect = this.deps.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    const { width: viewW, height: viewH } = proj.viewport;
    const viewX = relX * viewW;
    const viewY = relY * viewH;
    const is3d = proj.projection?.mode === 'hd2d_3d' && this.deps.previewGpu.supports3D();
    const isQuad = Boolean(is3d && proj.projection?.quadView);
    const quad = isQuad ? resolveQuadQuadrant(relX, relY, viewW, viewH) : null;
    const offsetX = quad ? quad.offsetX : 0;
    const offsetY = quad ? quad.offsetY : 0;
    const subW = quad ? quad.halfW : viewW;
    const subH = quad ? quad.halfH : viewH;
    const cam3d = is3d ? this.computeCam3DFor(proj, quad ? quad.projection : null, subW, subH) : null;
    return { isQuad, quad, cam3d, viewX, viewY, localX: viewX - offsetX, localY: viewY - offsetY, offsetX, offsetY, subW, subH, yawDeg: cam3d?.yawDeg ?? 0 };
  }

  private screenToTile(clientX: number, clientY: number): { col: number; row: number; worldX: number; worldY: number } | null {
    const proj = this.deps.session.getProject();
    if (!proj.worldMap) return null;
    const vctx = this.resolvePointerView(clientX, clientY, proj);
    if (!vctx) return null;
    const ts = Math.max(8, proj.worldMap.tileSize);
    const activeRoom = proj.worldMap.rooms.find((r) => r.id === this.deps.runtime.getActiveRoomId());
    const planeZ = this.deps.mapState.activeZLevel * (activeRoom?.storyHeight ?? activeRoom?.wallExtrudeH ?? 24);
    let worldX: number;
    let worldY: number;
    if (vctx.cam3d) {
      if (!screenToWorldPlaneZ(vctx.localX, vctx.localY, vctx.cam3d, this.pickWorldScratch, planeZ)) return null;
      worldX = this.pickWorldScratch[0];
      worldY = this.pickWorldScratch[1];
    } else {
      const cam = this.deps.runtime.getCamera();
      const zoom = this.getEditorZoom();
      worldX = cam.x + proj.viewport.width * 0.5 + (vctx.viewX - proj.viewport.width * 0.5) / zoom;
      worldY = cam.y + proj.viewport.height * 0.5 + (vctx.viewY - proj.viewport.height * 0.5) / zoom;
    }
    return { col: Math.floor(worldX / ts), row: Math.floor(worldY / ts), worldX, worldY };
  }

  private sampleGizmoPlane(
    handle: GizmoHandleId,
    localX: number,
    localY: number,
    cam3d: ComputedCamera3D | null,
    subW: number,
    subH: number,
    zAxis: 'x' | 'y',
    zVal: number,
    cx: number,
    cy: number,
    cz: number,
  ): boolean {
    if (!cam3d) {
      const cam = this.deps.runtime.getCamera();
      const zoom = this.getEditorZoom();
      this.axisPickScratch[0] = cam.x + subW * 0.5 + (localX - subW * 0.5) / zoom;
      this.axisPickScratch[1] = cam.y + subH * 0.5 + (localY - subH * 0.5) / zoom;
      this.axisPickScratch[2] = cz;
      return true;
    }
    if (cam3d.projection === 'ortho_front') return screenToWorldPlaneAxis(localX, localY, cam3d, 'y', cy, this.axisPickScratch);
    if (cam3d.projection === 'ortho_side') return screenToWorldPlaneAxis(localX, localY, cam3d, 'x', cx, this.axisPickScratch);
    if (handle === 'z') return screenToWorldPlaneAxis(localX, localY, cam3d, zAxis, zVal, this.axisPickScratch);
    return screenToWorldPlaneAxis(localX, localY, cam3d, 'z', cz, this.axisPickScratch);
  }

  private beginGizmoDrag(
    handle: GizmoHandleId,
    selectedPoses: readonly WorkbenchEntityPose[],
    vctx: PointerViewContext,
    clientX: number,
    clientY: number,
    storyHeight: number,
  ): void {
    const centroid = computeSelectionCentroid(selectedPoses);
    if (!centroid) return;
    const yawRad = (vctx.yawDeg * Math.PI) / 180;
    const zPlaneAxis: 'x' | 'y' = Math.abs(Math.sin(yawRad)) < Math.abs(Math.cos(yawRad)) ? 'y' : 'x';
    const zPlaneVal = zPlaneAxis === 'y' ? centroid.cy : centroid.cx;

    let startValX = centroid.cx;
    let startValY = centroid.cy;
    let startValZ = centroid.cz;
    if (this.sampleGizmoPlane(handle, vctx.localX, vctx.localY, vctx.cam3d, vctx.subW, vctx.subH, zPlaneAxis, zPlaneVal, centroid.cx, centroid.cy, centroid.cz)) {
      [startValX, startValY, startValZ] = this.axisPickScratch;
    }

    let originViewX = vctx.localX;
    let originViewY = vctx.localY;
    if (vctx.cam3d) {
      projectWorld3DToScreen(centroid.cx, centroid.cy, centroid.cz, vctx.cam3d, this.originScratch);
      if (this.originScratch.visible) { originViewX = this.originScratch.x; originViewY = this.originScratch.y; }
    } else {
      const cam = this.deps.runtime.getCamera();
      const zoom = this.getEditorZoom();
      originViewX = vctx.subW * 0.5 + (centroid.cx - (cam.x + vctx.subW * 0.5)) * zoom;
      originViewY = vctx.subH * 0.5 + (centroid.cy - (cam.y + vctx.subH * 0.5)) * zoom;
    }

    const canWorldYaw =
      handle === 'yaw' && vctx.cam3d && vctx.cam3d.projection !== 'ortho_front' && vctx.cam3d.projection !== 'ortho_side' &&
      screenToWorldPlaneAxis(vctx.localX, vctx.localY, vctx.cam3d, 'z', centroid.cz, this.axisPickScratch);
    const startAngleRad = canWorldYaw
      ? Math.atan2(this.axisPickScratch[1] - centroid.cy, this.axisPickScratch[0] - centroid.cx)
      : Math.atan2(vctx.localY - originViewY, vctx.localX - originViewX);

    this.pointerMode = 'gizmo';
    this.gizmoDrag = {
      handle, quadProj: vctx.quad?.projection ?? null,
      offsetX: vctx.offsetX, offsetY: vctx.offsetY, subW: vctx.subW, subH: vctx.subH,
      cx: centroid.cx, cy: centroid.cy, cz: centroid.cz,
      originViewX, originViewY, startClientX: clientX, startClientY: clientY,
      startValX, startValY, startValZ, startAngleRad, zPlaneAxis, zPlaneVal, storyHeight,
      items: selectedPoses.map((p) => ({
        entityId: p.entityId, startX: p.x, startY: p.y, startZ: p.z, startYaw: p.yaw,
        startScaleX: p.scaleX, startScaleY: p.scaleY,
        startMeshScaleX: p.meshScaleX, startMeshScaleY: p.meshScaleY, startMeshScaleZ: p.meshScaleZ, hasMesh3d: p.hasMesh3d,
      })),
      deltaX: 0, deltaY: 0, deltaZ: 0, deltaYaw: 0, scaleMult: 1, snapGrid: 0, snapStory: false, readoutLabel: '',
    };
    this.deps.onPreviewDirty?.();
    this.renderOverlay();
  }

  private updateGizmoDrag(e: PointerEvent, proj: EcsProjectV2): void {
    const g = this.gizmoDrag;
    if (!g || g.items.length === 0) return;
    const rect = this.deps.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const localX = ((e.clientX - rect.left) / rect.width) * proj.viewport.width - g.offsetX;
    const localY = ((e.clientY - rect.top) / rect.height) * proj.viewport.height - g.offsetY;
    const cam3d = this.computeCam3DFor(proj, g.quadProj, g.subW, g.subH);
    const { mapState, liveMutator } = this.deps;
    const snapActive = (mapState.snapStep > 0) !== e.ctrlKey;
    const effStep = snapActive ? (mapState.snapStep > 0 ? mapState.snapStep : 16) : 0;
    const lead = g.items[0];
    const lastIdx = g.items.length - 1;

    if (g.handle === 'yaw') {
      const canWorldYaw =
        cam3d && cam3d.projection !== 'ortho_front' && cam3d.projection !== 'ortho_side' &&
        screenToWorldPlaneAxis(localX, localY, cam3d, 'z', g.cz, this.axisPickScratch);
      const curAngle = canWorldYaw
        ? Math.atan2(this.axisPickScratch[1] - g.cy, this.axisPickScratch[0] - g.cx)
        : Math.atan2(localY - g.originViewY, localX - g.originViewX);
      let rawDeg = ((curAngle - g.startAngleRad) * 180) / Math.PI;
      if (rawDeg > 180) rawDeg -= 360;
      if (rawDeg < -180) rawDeg += 360;
      g.deltaYaw = snapActive ? snapCoord(rawDeg, 15) : Math.round(rawDeg);
      g.readoutLabel = `YAW ${g.deltaYaw >= 0 ? '+' : ''}${g.deltaYaw}°`;
      for (let i = 0; i < g.items.length; i++) {
        liveMutator?.mutateSpatial3D(g.items[i].entityId, { yaw: g.items[i].startYaw + g.deltaYaw }, i === lastIdx);
      }
    } else if (g.handle === 'scale_u' || g.handle === 'scale_x' || g.handle === 'scale_y' || g.handle === 'scale_z') {
      const dragPx = g.handle === 'scale_z' ? g.startClientY - e.clientY : e.clientX - g.startClientX + (g.startClientY - e.clientY) * 0.5;
      const rawMult = Math.max(0.1, Math.min(8, 1 + dragPx / 64));
      g.scaleMult = snapActive ? Math.max(0.25, snapCoord(rawMult, 0.25)) : Math.round(rawMult * 100) / 100;
      g.readoutLabel = `×${g.scaleMult.toFixed(2)}`;
      for (let i = 0; i < g.items.length; i++) {
        const it = g.items[i];
        const isLast = i === lastIdx;
        if (g.handle === 'scale_u') {
          liveMutator?.mutateTransform(it.entityId, { scaleX: it.startScaleX * g.scaleMult, scaleY: it.startScaleY * g.scaleMult }, !it.hasMesh3d && isLast);
          if (it.hasMesh3d) liveMutator?.mutateMesh3DScale(it.entityId, { scaleX: it.startMeshScaleX * g.scaleMult, scaleY: it.startMeshScaleY * g.scaleMult, scaleZ: it.startMeshScaleZ * g.scaleMult }, isLast);
        } else if (g.handle === 'scale_x') {
          liveMutator?.mutateTransform(it.entityId, { scaleX: it.startScaleX * g.scaleMult }, !it.hasMesh3d && isLast);
          if (it.hasMesh3d) liveMutator?.mutateMesh3DScale(it.entityId, { scaleX: it.startMeshScaleX * g.scaleMult }, isLast);
        } else if (g.handle === 'scale_y') {
          liveMutator?.mutateTransform(it.entityId, { scaleY: it.startScaleY * g.scaleMult }, !it.hasMesh3d && isLast);
          if (it.hasMesh3d) liveMutator?.mutateMesh3DScale(it.entityId, { scaleY: it.startMeshScaleY * g.scaleMult }, isLast);
        } else if (it.hasMesh3d) {
          liveMutator?.mutateMesh3DScale(it.entityId, { scaleZ: it.startMeshScaleZ * g.scaleMult }, isLast);
        }
      }
    } else {
      const hitOk = this.sampleGizmoPlane(g.handle, localX, localY, cam3d, g.subW, g.subH, g.zPlaneAxis, g.zPlaneVal, g.cx, g.cy, g.cz);
      if (g.handle === 'z') {
        const rawDz = hitOk ? this.axisPickScratch[2] - g.startValZ : (g.startClientY - e.clientY) * 0.85;
        g.deltaZ = snapActive ? snapCoord(Math.max(0, lead.startZ + rawDz), g.storyHeight) - lead.startZ : Math.round(rawDz);
        g.snapStory = snapActive;
        g.readoutLabel = `ΔZ ${g.deltaZ >= 0 ? '+' : ''}${Math.round(g.deltaZ)}`;
        for (let i = 0; i < g.items.length; i++) {
          const it = g.items[i];
          const nz = Math.max(0, snapActive ? snapCoord(it.startZ + g.deltaZ, g.storyHeight) : Math.round(it.startZ + g.deltaZ));
          liveMutator?.mutateSpatial3D(it.entityId, { z: nz }, i === lastIdx);
        }
      } else if (hitOk) {
        const rawDx = this.axisPickScratch[0] - g.startValX;
        const rawDy = this.axisPickScratch[1] - g.startValY;
        if (g.handle === 'x') {
          g.deltaX = effStep > 0 ? snapCoord(lead.startX + rawDx, effStep) - lead.startX : Math.round(rawDx);
          g.deltaY = 0; g.snapGrid = 0;
          g.readoutLabel = `ΔX ${g.deltaX >= 0 ? '+' : ''}${Math.round(g.deltaX)}`;
        } else if (g.handle === 'y') {
          g.deltaX = 0;
          g.deltaY = effStep > 0 ? snapCoord(lead.startY + rawDy, effStep) - lead.startY : Math.round(rawDy);
          g.snapGrid = 0;
          g.readoutLabel = `ΔY ${g.deltaY >= 0 ? '+' : ''}${Math.round(g.deltaY)}`;
        } else {
          g.deltaX = Math.round(rawDx); g.deltaY = Math.round(rawDy); g.snapGrid = effStep;
          g.readoutLabel = `Δ(${g.deltaX >= 0 ? '+' : ''}${g.deltaX}, ${g.deltaY >= 0 ? '+' : ''}${g.deltaY})`;
        }
        for (let i = 0; i < g.items.length; i++) {
          const it = g.items[i];
          const nx = g.snapGrid > 0 ? snapCoord(it.startX + g.deltaX, g.snapGrid) : it.startX + g.deltaX;
          const ny = g.snapGrid > 0 ? snapCoord(it.startY + g.deltaY, g.snapGrid) : it.startY + g.deltaY;
          liveMutator?.mutateTransform(it.entityId, { x: nx, y: ny }, i === lastIdx);
        }
      }
    }
    this.deps.onPreviewDirty?.();
    this.renderOverlay();
  }

  private commitGizmoDrag(proj: EcsProjectV2): void {
    const g = this.gizmoDrag;
    if (!g || g.items.length === 0) return;
    const { session } = this.deps;
    const entityIds = g.items.map((it) => it.entityId);

    if (g.handle === 'yaw') {
      if (g.deltaYaw !== 0) session.dispatch({ type: 'transform_entities', entityIds, deltaYaw: g.deltaYaw });
      return;
    }
    if (g.handle === 'scale_u') {
      if (Math.abs(g.scaleMult - 1) > 1e-3) session.dispatch({ type: 'transform_entities', entityIds, scaleMult: g.scaleMult });
      return;
    }
    if (g.handle === 'scale_x' || g.handle === 'scale_y' || g.handle === 'scale_z') {
      if (Math.abs(g.scaleMult - 1) <= 1e-3) return;
      const clampS = (v: number) => Math.round(Math.max(0.1, Math.min(8, v)) * 1000) / 1000;
      const cmds: EcsStudioCommand[] = [];
      for (const it of g.items) {
        if (!proj.entities.some((e) => e.id === it.entityId)) continue;
        if (g.handle === 'scale_x') {
          cmds.push({
            type: 'patch_entity', entityId: it.entityId,
            patch: { transform: { scaleX: clampS(it.startScaleX * g.scaleMult) }, ...(it.hasMesh3d ? { mesh3d: { scaleX: clampS(it.startMeshScaleX * g.scaleMult) } } : {}) },
          });
        } else if (g.handle === 'scale_y') {
          cmds.push({
            type: 'patch_entity', entityId: it.entityId,
            patch: { transform: { scaleY: clampS(it.startScaleY * g.scaleMult) }, ...(it.hasMesh3d ? { mesh3d: { scaleY: clampS(it.startMeshScaleY * g.scaleMult) } } : {}) },
          });
        } else if (it.hasMesh3d) {
          cmds.push({ type: 'patch_entity', entityId: it.entityId, patch: { mesh3d: { scaleZ: clampS(it.startMeshScaleZ * g.scaleMult) } } });
        }
      }
      if (cmds.length === 1) session.dispatch(cmds[0]);
      else if (cmds.length > 1) session.dispatchBatch(cmds, `縮放 ${cmds.length} 個實體`);
      return;
    }
    if (g.handle === 'z') {
      const moved = g.items.some((it) => Math.abs(Math.max(0, g.snapStory ? snapCoord(it.startZ + g.deltaZ, g.storyHeight) : it.startZ + g.deltaZ) - it.startZ) > 1e-3);
      if (moved) session.dispatch({ type: 'transform_entities', entityIds, deltaZ: g.deltaZ, ...(g.snapStory ? { snapStoryZ: true } : {}) });
      return;
    }
    const movedXY = g.items.some((it) => {
      const nx = g.snapGrid > 0 ? snapCoord(it.startX + g.deltaX, g.snapGrid) : it.startX + g.deltaX;
      const ny = g.snapGrid > 0 ? snapCoord(it.startY + g.deltaY, g.snapGrid) : it.startY + g.deltaY;
      return Math.abs(nx - it.startX) > 1e-3 || Math.abs(ny - it.startY) > 1e-3;
    });
    if (movedXY) {
      session.dispatch({
        type: 'transform_entities', entityIds,
        ...(g.deltaX !== 0 ? { deltaX: g.deltaX } : {}),
        ...(g.deltaY !== 0 ? { deltaY: g.deltaY } : {}),
        ...(g.snapGrid > 0 ? { snapGrid: g.snapGrid } : {}),
      });
    }
  }

  private startPan(clientX: number, clientY: number, yawDeg: number): void {
    const cam = this.deps.runtime.getCamera();
    this.pointerMode = 'pan';
    this.panOrigin = { clientX, clientY, camX: cam.x, camY: cam.y, yawDeg, zoom: this.getEditorZoom() };
    this.deps.onPreviewDirty?.();
  }

  private handleSelectPointerDown(
    e: PointerEvent,
    proj: EcsProjectV2,
    roomId: string,
    vctx: PointerViewContext,
    selectedIds: string[],
    allPoses: readonly WorkbenchEntityPose[],
  ): void {
    const cam = this.deps.runtime.getCamera();
    const hitId = pickEntityAtScreen(vctx.viewX, vctx.viewY, {
      project: proj, roomId, camX: cam.x, camY: cam.y, zoom: this.getEditorZoom(),
      viewW: vctx.subW, viewH: vctx.subH, cam3d: vctx.cam3d, offsetX: vctx.offsetX, offsetY: vctx.offsetY, poses: allPoses,
    });
    if (hitId) {
      const nextIds = e.shiftKey
        ? (selectedIds.includes(hitId) ? selectedIds.filter((id) => id !== hitId) : [...selectedIds, hitId])
        : [hitId];
      this.deps.onSelectionChange?.(nextIds);
      this.deps.onPreviewDirty?.();
      this.renderOverlay();
      return;
    }
    this.pointerMode = 'marquee';
    this.marqueeDrag = {
      x0: vctx.viewX, y0: vctx.viewY, x1: vctx.viewX, y1: vctx.viewY,
      shiftKey: e.shiftKey, quadProj: vctx.quad?.projection ?? null,
      offsetX: vctx.offsetX, offsetY: vctx.offsetY, subW: vctx.subW, subH: vctx.subH,
    };
    this.renderOverlay();
  }

  private handleTileToolDown(proj: EcsProjectV2, room: EcsMapRoomDef, hit: { col: number; row: number }): void {
    const { session, runtime, mapState } = this.deps;
    const wm = proj.worldMap!;
    const isVoxel3d = proj.projection?.mode === 'hd2d_3d' && mapState.editLayer === 'voxel3d';

    if (mapState.tool === 'eyedropper') {
      if (isVoxel3d) {
        const vol = runtime.getWorldMapController().voxelVolume;
        const vTid = vol.getCellTileId(hit.col, hit.row, mapState.activeZLevel);
        const vShape = vol.getCellShape(hit.col, hit.row, mapState.activeZLevel);
        if (vTid > 0) {
          mapState.selectedTileId = vTid;
          if (vShape) mapState.voxelShape = vShape;
          mapState.tool = 'brush';
          this.deps.onToolStateMutated();
        }
      } else {
        const tid = getRoomTile(room, mapState.layer, hit.col, hit.row);
        if (tid > 0) { mapState.selectedTileId = tid; mapState.tool = 'brush'; this.deps.onToolStateMutated(); }
      }
      this.deps.onPreviewDirty?.();
      this.renderOverlay();
      return;
    }

    if (mapState.tool === 'fill') {
      if (isVoxel3d) {
        session.dispatch({
          type: 'set_room_voxel', roomId: room.id,
          cell: { col: hit.col, row: hit.row, zLevel: mapState.activeZLevel, tileId: mapState.selectedTileId, shape: mapState.voxelShape },
        });
      } else {
        session.dispatch({ type: 'flood_fill', roomId: room.id, layer: mapState.layer, col: hit.col, row: hit.row, tileId: mapState.selectedTileId });
      }
      this.deps.onPreviewDirty?.();
      return;
    }

    if (mapState.tool === 'stamp' && mapState.selectedStampPrefabId) {
      const ts = wm.tileSize;
      const storyH = room.storyHeight ?? room.wallExtrudeH ?? 24;
      const stampZ = mapState.activeZLevel * storyH;
      const res = session.dispatch({
        type: 'instantiate_prefab', prefabId: mapState.selectedStampPrefabId,
        x: hit.col * ts + ts * 0.5, y: hit.row * ts + ts * 0.5,
        ...(stampZ > 0 ? { z: stampZ } : {}), roomId: room.id,
      });
      if (res.ok && res.createdEntityId) this.deps.onEntityStamped(res.createdEntityId);
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
      this.pendingBrushMap.set(`${hit.col},${hit.row}`, { col: hit.col, row: hit.row, tileId: mapState.tool === 'erase' ? 0 : mapState.selectedTileId });
      this.deps.onPreviewDirty?.();
      this.renderOverlay();
    }
  }

  private bindEvents(): void {
    const { signal } = this.ac;
    const { canvas, session, runtime, mapState } = this.deps;

    canvas.addEventListener('contextmenu', (e) => { if (this.deps.isEditingActive()) e.preventDefault(); }, { signal });

    canvas.addEventListener('wheel', (e) => {
      if (!this.deps.isEditingActive()) return;
      if (!session.getProject().worldMap) return;
      e.preventDefault();
      if (e.shiftKey) {
        const nextZ = Math.max(0, Math.min(7, mapState.activeZLevel + (e.deltaY < 0 ? 1 : -1)));
        if (nextZ !== mapState.activeZLevel) {
          mapState.activeZLevel = nextZ;
          this.deps.onSliceCutawaySync?.();
          this.deps.onToolStateMutated();
          this.deps.onPreviewDirty?.();
          this.renderOverlay();
        }
        return;
      }
      const wmCtrl = runtime.getWorldMapController();
      wmCtrl.setEditorZoom(wmCtrl.getEditorZoom() * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      this.deps.onPreviewDirty?.();
      this.renderOverlay();
    }, { passive: false, signal });

    canvas.addEventListener('dblclick', (e) => {
      if (!this.deps.isEditingActive()) return;
      const proj = session.getProject();
      if (proj.projection?.mode !== 'hd2d_3d' || !proj.projection.quadView) return;
      const vctx = this.resolvePointerView(e.clientX, e.clientY, proj);
      if (!vctx) return;
      const hitProj = hitTestQuadHeaderBadge(vctx.viewX, vctx.viewY, proj.viewport.width, proj.viewport.height);
      if (hitProj) { e.preventDefault(); this.deps.onToggleQuadSingleView?.(hitProj); }
    }, { signal });

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.deps.isEditingActive()) return;
      const proj = session.getProject();
      const wm = proj.worldMap;
      const room = wm && runtime.getActiveRoomId() ? wm.rooms.find((r) => r.id === runtime.getActiveRoomId()) : null;
      if (!wm || !room) return;
      const vctx = this.resolvePointerView(e.clientX, e.clientY, proj);
      if (!vctx) return;
      if (vctx.isQuad && hitTestQuadHeaderBadge(vctx.viewX, vctx.viewY, proj.viewport.width, proj.viewport.height)) return;

      canvas.setPointerCapture(e.pointerId);

      // 1. 3D Orbit (Right-drag or Alt+Left-drag in hd2d_3d; pan ortho quadrants in Quad-View)
      if (proj.projection?.mode === 'hd2d_3d' && (e.button === 2 || (e.altKey && e.button === 0))) {
        if (vctx.isQuad && vctx.quad?.id !== 'tl') { this.startPan(e.clientX, e.clientY, vctx.yawDeg); return; }
        const yaw0 = proj.projection.yawDeg ?? 0;
        const pitch0 = proj.projection.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG;
        this.pointerMode = 'orbit';
        this.orbitOrigin = { clientX: e.clientX, clientY: e.clientY, yawDeg: yaw0, pitchDeg: pitch0, curYawDeg: yaw0, curPitchDeg: pitch0 };
        this.deps.onPreviewDirty?.();
        return;
      }

      // 2. Yaw-Aware Pan (Middle-drag, Space+Left, Pan tool, or 2D Right-drag)
      if (e.button === 1 || (e.button === 0 && (mapState.spacePanHeld || mapState.tool === 'pan')) || e.button === 2) {
        this.startPan(e.clientX, e.clientY, vctx.yawDeg);
        return;
      }
      if (e.button !== 0) return;

      // 3. 3-Mode Gizmo Drag (single view or any Quad-View quadrant)
      const selectedIds = this.getSelectedIds();
      const allPoses = selectedIds.length > 0 || mapState.tool === 'select' ? collectRoomEntityPoses(proj, room.id, runtime.world.core) : [];
      if (selectedIds.length > 0) {
        const selSet = new Set(selectedIds);
        const selPoses = allPoses.filter((p) => selSet.has(p.entityId));
        if (selPoses.length > 0) {
          const cam = runtime.getCamera();
          const hitHandle = hitTestGizmoHandle(vctx.localX, vctx.localY, selPoses, mapState.gizmoMode, vctx.cam3d, vctx.subW, vctx.subH, cam.x, cam.y, this.getEditorZoom());
          if (hitHandle) {
            this.beginGizmoDrag(hitHandle, selPoses, vctx, e.clientX, e.clientY, room.storyHeight ?? room.wallExtrudeH ?? 24);
            return;
          }
        }
      }

      // 4. Select Tool
      if (mapState.tool === 'select') {
        this.handleSelectPointerDown(e, proj, room.id, vctx, selectedIds, allPoses);
        return;
      }

      // 5. Tile / Voxel3D Tools
      const hit = this.screenToTile(e.clientX, e.clientY);
      if (!hit || hit.col < 0 || hit.col >= room.cols || hit.row < 0 || hit.row >= room.rows) return;
      this.hoverTileCol = hit.col;
      this.hoverTileRow = hit.row;
      this.handleTileToolDown(proj, room, hit);
    }, { signal });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.deps.isEditingActive()) return;
      const proj = session.getProject();
      const wm = proj.worldMap;
      const room = wm && runtime.getActiveRoomId() ? wm.rooms.find((r) => r.id === runtime.getActiveRoomId()) : null;
      if (!wm || !room) return;

      if (this.pointerMode === 'orbit') {
        const yawDeg = (((this.orbitOrigin.yawDeg + (e.clientX - this.orbitOrigin.clientX) * 0.45) % 360) + 360) % 360;
        const pitchDeg = Math.max(-45, Math.min(85, this.orbitOrigin.pitchDeg + (e.clientY - this.orbitOrigin.clientY) * 0.35));
        this.orbitOrigin.curYawDeg = yawDeg; this.orbitOrigin.curPitchDeg = pitchDeg;
        runtime.patchLiveProjection({ yawDeg, pitchDeg });
        this.deps.onPreviewDirty?.();
        return;
      }
      if (this.pointerMode === 'gizmo' && this.gizmoDrag) { this.updateGizmoDrag(e, proj); return; }
      if (this.pointerMode === 'pan') {
        const rect = canvas.getBoundingClientRect();
        const dx = ((e.clientX - this.panOrigin.clientX) * proj.viewport.width) / Math.max(1, rect.width);
        const dy = ((e.clientY - this.panOrigin.clientY) * proj.viewport.height) / Math.max(1, rect.height);
        const { wx, wy } = rotatePanDeltaByYaw(dx, dy, this.panOrigin.yawDeg, this.panOrigin.zoom);
        runtime.setEditorCamera(this.panOrigin.camX - wx, this.panOrigin.camY - wy);
        this.deps.onPreviewDirty?.();
        return;
      }
      if (this.pointerMode === 'marquee' && this.marqueeDrag) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const m = this.marqueeDrag;
          m.x1 = Math.max(m.offsetX, Math.min(m.offsetX + m.subW, ((e.clientX - rect.left) / rect.width) * proj.viewport.width));
          m.y1 = Math.max(m.offsetY, Math.min(m.offsetY + m.subH, ((e.clientY - rect.top) / rect.height) * proj.viewport.height));
          this.renderOverlay();
        }
        return;
      }

      const hit = this.screenToTile(e.clientX, e.clientY);
      if (!hit) return;
      const cellChanged = this.hoverTileCol !== hit.col || this.hoverTileRow !== hit.row;
      this.hoverTileCol = hit.col; this.hoverTileRow = hit.row;
      if (this.pointerMode === 'rect' && this.rectDrag) {
        this.rectDrag.c1 = Math.max(0, Math.min(room.cols - 1, hit.col));
        this.rectDrag.r1 = Math.max(0, Math.min(room.rows - 1, hit.row));
      } else if (this.pointerMode === 'brush' && hit.col >= 0 && hit.col < room.cols && hit.row >= 0 && hit.row < room.rows) {
        this.pendingBrushMap.set(`${hit.col},${hit.row}`, { col: hit.col, row: hit.row, tileId: mapState.tool === 'erase' ? 0 : mapState.selectedTileId });
      }
      if (cellChanged || this.pointerMode === 'rect' || this.pointerMode === 'brush') {
        this.deps.onPreviewDirty?.();
        this.renderOverlay();
      }
    }, { signal });

    const finishPointer = () => {
      if (this.pointerMode === 'none') return;
      const proj = session.getProject();
      const roomId = runtime.getActiveRoomId();
      const isVoxel3d = proj.projection?.mode === 'hd2d_3d' && mapState.editLayer === 'voxel3d';

      if (this.pointerMode === 'orbit') {
        session.dispatch({ type: 'set_camera_3d_pose', yawDeg: Math.round(this.orbitOrigin.curYawDeg), pitchDeg: Math.round(this.orbitOrigin.curPitchDeg) });
      } else if (this.pointerMode === 'gizmo' && this.gizmoDrag) {
        this.commitGizmoDrag(proj);
      } else if (this.pointerMode === 'marquee' && this.marqueeDrag && roomId) {
        const m = this.marqueeDrag;
        if (Math.hypot(m.x1 - m.x0, m.y1 - m.y0) < 4) {
          if (!m.shiftKey) this.deps.onSelectionChange?.([]);
        } else {
          const cam = runtime.getCamera();
          const enclosed = collectEntitiesInMarquee(m.x0, m.y0, m.x1, m.y1, {
            project: proj, roomId, camX: cam.x, camY: cam.y, zoom: this.getEditorZoom(),
            viewW: m.subW, viewH: m.subH, cam3d: this.computeCam3DFor(proj, m.quadProj, m.subW, m.subH),
            offsetX: m.offsetX, offsetY: m.offsetY, poses: collectRoomEntityPoses(proj, roomId, runtime.world.core),
          });
          if (m.shiftKey) {
            const merged = [...this.getSelectedIds()];
            for (const id of enclosed) { if (!merged.includes(id)) merged.push(id); }
            this.deps.onSelectionChange?.(merged);
          } else {
            this.deps.onSelectionChange?.(enclosed);
          }
        }
      } else if (this.pointerMode === 'brush' && roomId && this.pendingBrushMap.size > 0) {
        if (isVoxel3d) {
          const cmds: EcsStudioCommand[] = Array.from(this.pendingBrushMap.values(), (edit) => ({
            type: 'set_room_voxel', roomId,
            cell: { col: edit.col, row: edit.row, zLevel: mapState.activeZLevel, tileId: edit.tileId, shape: mapState.voxelShape },
          }));
          if (cmds.length === 1) session.dispatch(cmds[0]);
          else session.dispatchBatch(cmds, `繪製 3D 體素 (${cmds.length} 格 · Z=${mapState.activeZLevel})`);
        } else {
          session.dispatch({ type: 'paint_tiles', roomId, layer: mapState.layer, changes: Array.from(this.pendingBrushMap.values()) });
        }
      } else if (this.pointerMode === 'rect' && roomId && this.rectDrag) {
        if (isVoxel3d) {
          const z0 = mapState.activeZLevel;
          const z1 = Math.min(7, z0 + Math.max(1, Math.round(mapState.extrudeStories || 1)) - 1);
          session.dispatch({
            type: 'fill_room_box_3d', roomId, c0: this.rectDrag.c0, r0: this.rectDrag.r0, z0,
            c1: this.rectDrag.c1, r1: this.rectDrag.r1, z1,
            tileId: mapState.tool === 'erase' ? 0 : mapState.selectedTileId, shape: mapState.voxelShape,
          });
        } else {
          session.dispatch({
            type: 'fill_rect', roomId, layer: mapState.layer,
            c0: this.rectDrag.c0, r0: this.rectDrag.r0, c1: this.rectDrag.c1, r1: this.rectDrag.r1, tileId: mapState.selectedTileId,
          });
        }
      }
      this.clearPendingStroke();
      this.deps.onPreviewDirty?.();
      this.renderOverlay();
    };

    canvas.addEventListener('pointerup', finishPointer, { signal });
    canvas.addEventListener('pointercancel', finishPointer, { signal });
    canvas.addEventListener('pointerleave', () => {
      if (this.pointerMode === 'none' && (this.hoverTileCol !== -1 || this.hoverTileRow !== -1)) {
        this.hoverTileCol = -1; this.hoverTileRow = -1;
        this.deps.onPreviewDirty?.();
        this.renderOverlay();
      }
    }, { signal });
  }

  private buildGizmoFeedback(): GizmoRenderFeedback {
    const g = this.gizmoDrag;
    if (!g) return { activeHandle: null };
    return {
      activeHandle: g.handle,
      deltaYawDeg: g.handle === 'yaw' ? g.deltaYaw : undefined,
      startAngleRad: g.handle === 'yaw' ? g.startAngleRad : undefined,
      scaleMult: g.scaleMult,
      readoutLabel: g.readoutLabel || undefined,
    };
  }

  private computeFovMask(room: EcsMapRoomDef, tileSize: number): Uint8Array {
    const needed = room.cols * room.rows;
    if (this.fovMaskBuf.length < needed) this.fovMaskBuf = new Uint8Array(needed);
    const core = this.deps.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    const ts = Math.max(8, tileSize);
    let heroCol = Math.floor(room.cols * 0.5);
    let heroRow = Math.floor(room.rows * 0.5);
    for (let i = 0; i < tagStore.size(); i++) {
      const td = tagStore.getDenseDataAt(i);
      if (td.tag === 'hero' || td.tag === 'player' || td.entityId === 'hero') {
        const tr = core.getComponent(tagStore.getDenseEntityAt(i), core.components.Transform2D);
        if (tr) {
          heroCol = Math.max(0, Math.min(room.cols - 1, Math.floor((tr.x + tr.w * 0.5) / ts)));
          heroRow = Math.max(0, Math.min(room.rows - 1, Math.floor((tr.y + tr.h * 0.5) / ts)));
          break;
        }
      }
    }
    const radius = Math.max(7, Math.min(12, Math.round(Math.max(room.cols, room.rows) * 0.42)));
    this.deps.runtime.getWorldMapController().computeRoomFovMask(heroCol, heroRow, radius, this.deps.runtime.world.globals, this.fovMaskBuf);
    return this.fovMaskBuf;
  }

  private renderQuadViewOverlay(ctx: CanvasRenderingContext2D, proj: EcsProjectV2, editingActive: boolean): void {
    const { canvas, runtime, mapState } = this.deps;
    const { width: cw, height: ch } = canvas;
    const { width: viewW, height: viewH } = proj.viewport;
    const sx = cw / Math.max(1, viewW);
    const sy = ch / Math.max(1, viewH);
    const subW = viewW * 0.5;
    const subH = viewH * 0.5;
    ctx.clearRect(0, 0, cw, ch);

    const activeRoomId = runtime.getActiveRoomId();
    const selectedIds = this.getSelectedIds();
    if (editingActive && activeRoomId && selectedIds.length > 0 && this.deps.previewGpu.supports3D()) {
      const selSet = new Set(selectedIds);
      const selectedPoses = collectRoomEntityPoses(proj, activeRoomId, runtime.world.core).filter((p) => selSet.has(p.entityId));
      if (selectedPoses.length > 0) {
        const cam = runtime.getCamera();
        const zoom = this.getEditorZoom();
        const feedback = this.buildGizmoFeedback();
        for (const q of QUAD_QUADRANTS) {
          const qx = q.col * subW;
          const qy = q.row * subH;
          const qCam = computeQuadrantCamera3D(proj, cam, zoom, q.projection, subW, subH, this.quadCamScratch);
          const vp = { camX: cam.x, camY: cam.y, zoom, viewW: subW, viewH: subH, cam3d: qCam, offsetX: qx, offsetY: qy };
          ctx.save();
          ctx.beginPath();
          ctx.rect(qx * sx, qy * sy, subW * sx, subH * sy);
          ctx.clip();
          drawSelectionOverlay(ctx, selectedPoses, vp, sx, sy);
          drawGizmoOverlay(ctx, selectedPoses, mapState.gizmoMode, vp, sx, sy, feedback);
          ctx.restore();
        }
      }
    }
    if (editingActive && this.pointerMode === 'marquee' && this.marqueeDrag) drawMarqueeOverlay(ctx, this.marqueeDrag, sx, sy);

    const halfW = Math.round(cw * 0.5) + 0.5;
    const halfH = Math.round(ch * 0.5) + 0.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(halfW, 0); ctx.lineTo(halfW, ch); ctx.moveTo(0, halfH); ctx.lineTo(cw, halfH);
    ctx.stroke();

    ctx.font = '700 10px "JetBrains Mono", monospace';
    for (const q of QUAD_QUADRANTS) {
      const bx = (q.col * subW + 8) * sx;
      const by = (q.row * subH + 8) * sy;
      const bw = 90 * sx;
      const bh = 20 * sy;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
      ctx.strokeRect(bx + 0.5, by + 0.5, Math.max(2, bw - 1), Math.max(2, bh - 1));
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(q.label, bx + 6 * sx, by + 13.5 * sy);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('⤢', bx + bw - 13 * sx, by + 13.5 * sy);
    }
  }

  public renderOverlay(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { canvas, session, runtime, mapState } = this.deps;
    const editingActive = this.deps.isEditingActive();
    const proj = session.getProject();

    if (proj.projection?.mode === 'hd2d_3d' && proj.projection.quadView) {
      this.renderQuadViewOverlay(ctx, proj, editingActive);
      return;
    }

    const wm = proj.worldMap;
    const fovActive = Boolean(mapState.showFovPreview && wm);
    if (!editingActive && !fovActive) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    const room = wm?.rooms.find((r) => r.id === runtime.getActiveRoomId());
    if (!wm || !room) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }

    const cam = runtime.getCamera();
    const zoom = this.getEditorZoom();
    const cam3d = this.computeCam3DFor(proj, null, proj.viewport.width, proj.viewport.height);
    renderMapOverlay(canvas, ctx, {
      room, portals: wm.portals.filter((p) => p.fromRoomId === room.id),
      tileSize: wm.tileSize, camX: cam.x, camY: cam.y,
      viewW: proj.viewport.width, viewH: proj.viewport.height, state: mapState,
      hoverCol: this.hoverTileCol, hoverRow: this.hoverTileRow, rectDrag: this.rectDrag,
      camera3D: cam3d, fovMask: fovActive ? this.computeFovMask(room, wm.tileSize) : null, showEditingAffordances: editingActive,
    });

    const planeZ = mapState.activeZLevel * (room.storyHeight ?? room.wallExtrudeH ?? 24);
    const sx = canvas.width / Math.max(1, proj.viewport.width);
    const sy = canvas.height / Math.max(1, proj.viewport.height);

    if (editingActive && this.pendingBrushMap.size > 0) {
      const ts = wm.tileSize;
      ctx.fillStyle = mapState.tool === 'erase' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.38)';
      if (cam3d) {
        const [p0, p1, p2, p3] = this.overlayPtsScratch;
        for (const edit of this.pendingBrushMap.values()) {
          const x0 = edit.col * ts; const y0 = edit.row * ts;
          projectWorld3DToScreen(x0, y0, planeZ, cam3d, p0);
          projectWorld3DToScreen(x0 + ts, y0, planeZ, cam3d, p1);
          projectWorld3DToScreen(x0 + ts, y0 + ts, planeZ, cam3d, p2);
          projectWorld3DToScreen(x0, y0 + ts, planeZ, cam3d, p3);
          if (!p0.visible || !p1.visible || !p2.visible || !p3.visible) continue;
          ctx.beginPath();
          ctx.moveTo(p0.x * sx, p0.y * sy); ctx.lineTo(p1.x * sx, p1.y * sy);
          ctx.lineTo(p2.x * sx, p2.y * sy); ctx.lineTo(p3.x * sx, p3.y * sy);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        for (const edit of this.pendingBrushMap.values()) {
          ctx.fillRect((edit.col * ts - cam.x) * sx, (edit.row * ts - cam.y) * sy, ts * sx, ts * sy);
        }
      }
    }

    if (editingActive) {
      const selectedIds = this.getSelectedIds();
      if (selectedIds.length > 0) {
        const selSet = new Set(selectedIds);
        const selectedPoses = collectRoomEntityPoses(proj, room.id, runtime.world.core).filter((p) => selSet.has(p.entityId));
        if (selectedPoses.length > 0) {
          const vp = { camX: cam.x, camY: cam.y, zoom, viewW: proj.viewport.width, viewH: proj.viewport.height, cam3d, offsetX: 0, offsetY: 0 };
          drawSelectionOverlay(ctx, selectedPoses, vp, sx, sy);
          drawGizmoOverlay(ctx, selectedPoses, mapState.gizmoMode, vp, sx, sy, this.buildGizmoFeedback());
        }
      }
      if (this.pointerMode === 'marquee' && this.marqueeDrag) drawMarqueeOverlay(ctx, this.marqueeDrag, sx, sy);
    }
  }

  public destroy(): void {
    this.clearPendingStroke();
    this.ac.abort();
  }
}
