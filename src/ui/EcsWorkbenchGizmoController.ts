import type { EcsCoreWorld } from '../core/ecs/EcsCoreWorld.ts';
import { resolveEntityComponents, type EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import {
  computeCamera3D,
  DEFAULT_HD2D_3D_FOV_DEG,
  DEFAULT_HD2D_3D_PITCH_DEG,
  projectWorld3DToScreen,
  type Camera3DProjectionMode,
  type ComputedCamera3D,
  type ScreenPoint3D,
} from '../core/math/Perspective3DMath.ts';
import type { MapGizmoMode } from './EcsMapDesignerPanelTypes.ts';

export type QuadQuadrantId = 'tl' | 'tr' | 'bl' | 'br';
export type QuadViewProjection = 'perspective' | 'ortho_top' | 'ortho_front' | 'ortho_side';
export type GizmoHandleId = 'x' | 'y' | 'z' | 'xy' | 'yaw' | 'scale_u' | 'scale_x' | 'scale_y' | 'scale_z';

export interface QuadQuadrantSpec {
  readonly id: QuadQuadrantId; readonly projection: QuadViewProjection;
  readonly label: string; readonly col: 0 | 1; readonly row: 0 | 1;
}

export const QUAD_QUADRANTS: readonly QuadQuadrantSpec[] = [
  { id: 'tl', projection: 'perspective', label: '3D PERSP', col: 0, row: 0 },
  { id: 'tr', projection: 'ortho_top', label: 'TOP [XY]', col: 1, row: 0 },
  { id: 'bl', projection: 'ortho_front', label: 'FRONT [XZ]', col: 0, row: 1 },
  { id: 'br', projection: 'ortho_side', label: 'SIDE [YZ]', col: 1, row: 1 },
] as const;

export interface ResolvedQuadQuadrant {
  id: QuadQuadrantId; projection: QuadViewProjection;
  localRelX: number; localRelY: number;
  offsetX: number; offsetY: number; halfW: number; halfH: number;
}

export interface WorkbenchEntityPose {
  entityId: string; x: number; y: number; w: number; h: number; z: number; height: number; yaw: number;
  scaleX: number; scaleY: number;
  meshScaleX: number; meshScaleY: number; meshScaleZ: number; hasMesh3d: boolean;
  centerX: number; centerY: number; centerZ: number;
}

export interface ViewportProjArgs {
  camX: number; camY: number; zoom: number; viewW: number; viewH: number;
  cam3d?: ComputedCamera3D | null; offsetX?: number; offsetY?: number;
}

export interface EntityPickContext extends ViewportProjArgs {
  project: EcsProjectV2; roomId?: string; poses?: readonly WorkbenchEntityPose[];
}

export interface GizmoRenderFeedback {
  activeHandle: GizmoHandleId | null;
  deltaYawDeg?: number; startAngleRad?: number; scaleMult?: number; readoutLabel?: string;
}

export interface MarqueeRect { x0: number; y0: number; x1: number; y1: number; }

const DEG_TO_RAD = Math.PI / 180;
const RING_SEGMENTS = 32;
const makePt = (): ScreenPoint3D => ({ x: 0, y: 0, scale: 1, depth: 1, visible: false });
const _pA = makePt();
const _pB = makePt();
const _pC = makePt();
const _pD = makePt();
const _pE = makePt();
const _ringPts: ScreenPoint3D[] = Array.from({ length: RING_SEGMENTS }, makePt);

const MOVE_AXES = [
  { id: 'x' as GizmoHandleId, label: 'X', color: '#ef4444', dx: 1, dy: 0, dz: 0, need3d: false },
  { id: 'y' as GizmoHandleId, label: 'Y', color: '#22c55e', dx: 0, dy: 1, dz: 0, need3d: false },
  { id: 'z' as GizmoHandleId, label: 'Z', color: '#38bdf8', dx: 0, dy: 0, dz: 1, need3d: true },
] as const;

const SCALE_AXES = [
  { id: 'scale_x' as GizmoHandleId, label: 'SX', color: '#ef4444', dx: 1, dy: 0, dz: 0, need3d: false },
  { id: 'scale_y' as GizmoHandleId, label: 'SY', color: '#22c55e', dx: 0, dy: 1, dz: 0, need3d: false },
  { id: 'scale_z' as GizmoHandleId, label: 'SZ', color: '#38bdf8', dx: 0, dy: 0, dz: 1, need3d: true },
] as const;

/**
 * Converts screen drag delta `(dx, dy)` (screen +X right, +Y down) into world XY pan delta
 * aligned with camera basis (`R = (cosY, sinY)`, `Down = (-sinY, cosY)`), scaled by `1 / Math.max(0.35, zoom)`.
 */
export function rotatePanDeltaByYaw(dx: number, dy: number, yawDeg: number, zoom: number): { wx: number; wy: number } {
  const invZ = 1 / Math.max(0.35, Number.isFinite(zoom) ? zoom : 1);
  const rad = (Number.isFinite(yawDeg) ? yawDeg : 0) * DEG_TO_RAD;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const wx = (dx * c - dy * s) * invZ;
  const wy = (dx * s + dy * c) * invZ;
  return { wx: Object.is(wx, -0) ? 0 : wx, wy: Object.is(wy, -0) ? 0 : wy };
}

/** Snaps `val` to the nearest multiple of `step` when `step > 0`. */
export function snapCoord(val: number, step: number): number {
  if (!Number.isFinite(val)) return 0;
  if (!Number.isFinite(step) || step <= 0) return val;
  const snapped = Math.round(val / step) * step;
  return Object.is(snapped, -0) ? 0 : snapped;
}

/** Resolves normalized `[0..1]` viewport coords into one of the 4 Quad-View quadrants and local normalized coords. */
export function resolveQuadQuadrant(relX: number, relY: number, viewW = 1, viewH = 1): ResolvedQuadQuadrant {
  const cx = Math.max(0, Math.min(1, Number.isFinite(relX) ? relX : 0));
  const cy = Math.max(0, Math.min(1, Number.isFinite(relY) ? relY : 0));
  const isRight = cx >= 0.5;
  const isBottom = cy >= 0.5;
  const spec = QUAD_QUADRANTS[(isBottom ? 2 : 0) + (isRight ? 1 : 0)];
  const halfW = viewW * 0.5;
  const halfH = viewH * 0.5;
  return {
    id: spec.id,
    projection: spec.projection,
    localRelX: Math.max(0, Math.min(1, (cx - (isRight ? 0.5 : 0)) * 2)),
    localRelY: Math.max(0, Math.min(1, (cy - (isBottom ? 0.5 : 0)) * 2)),
    offsetX: isRight ? halfW : 0,
    offsetY: isBottom ? halfH : 0,
    halfW,
    halfH,
  };
}

/** Detects clicks/double-clicks inside any of the 4 Quad-View header badges (`x: qx+8..qx+98, y: qy+8..qy+28`). */
export function hitTestQuadHeaderBadge(
  ptrViewX: number,
  ptrViewY: number,
  viewW: number,
  viewH: number,
): QuadViewProjection | null {
  const halfW = viewW * 0.5;
  const halfH = viewH * 0.5;
  for (let i = 0; i < QUAD_QUADRANTS.length; i++) {
    const q = QUAD_QUADRANTS[i];
    const qx = q.col * halfW;
    const qy = q.row * halfH;
    if (ptrViewX >= qx + 8 && ptrViewX <= qx + 98 && ptrViewY >= qy + 8 && ptrViewY <= qy + 28) return q.projection;
  }
  return null;
}

/** Computes the exact `ComputedCamera3D` for a single 3D view or half-size quadrant matching GPU rendering. */
export function computeQuadrantCamera3D(
  proj: EcsProjectV2,
  cam: { x: number; y: number },
  zoom: number,
  projection: Camera3DProjectionMode,
  viewW: number,
  viewH: number,
  out: ComputedCamera3D,
): ComputedCamera3D {
  const p = proj.projection;
  const rawPitch = p?.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG;
  const pitchDeg = projection === 'perspective' && rawPitch === 90 ? DEFAULT_HD2D_3D_PITCH_DEG : rawPitch;
  return computeCamera3D(
    {
      camCenterX: Math.round(cam.x) + proj.viewport.width * 0.5,
      camCenterY: Math.round(cam.y) + proj.viewport.height * 0.5,
      camCenterZ: p?.camCenterZ ?? 0,
      zoom: Math.max(0.35, Math.min(3.0, Number.isFinite(zoom) && zoom > 0 ? zoom : 1)),
      yawDeg: p?.yawDeg ?? 0,
      pitchDeg,
      rollDeg: p?.rollDeg ?? 0,
      fovDeg: p?.fovDeg ?? DEFAULT_HD2D_3D_FOV_DEG,
      projection,
      viewW,
      viewH,
    },
    out,
  );
}

/** Collects active-room entity poses, optionally overlaying live `EcsCoreWorld` transforms. */
export function collectRoomEntityPoses(
  project: EcsProjectV2,
  roomId?: string,
  core?: EcsCoreWorld | null,
): WorkbenchEntityPose[] {
  const liveById = new Map<string, number>();
  if (core) {
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      liveById.set(tagStore.getDenseDataAt(i).entityId, tagStore.getDenseEntityAt(i));
    }
  }
  const out: WorkbenchEntityPose[] = [];
  for (let i = 0; i < project.entities.length; i++) {
    const ent = project.entities[i];
    if (roomId && ent.roomId && ent.roomId !== roomId) continue;
    const res = resolveEntityComponents(ent, project.prefabs);
    const eh = core ? liveById.get(ent.id) : undefined;
    const tr = core && eh !== undefined ? core.getComponent(eh, core.components.Transform2D) : undefined;
    const sp = core && eh !== undefined ? core.getComponent(eh, core.components.Spatial3D) : undefined;
    const m3 = core && eh !== undefined ? core.getComponent(eh, core.components.MeshRenderer3D) : undefined;

    const x = tr ? tr.x : res.transform.x;
    const y = tr ? tr.y : res.transform.y;
    const w = tr ? tr.w : (res.transform.w ?? 16);
    const h = tr ? tr.h : (res.transform.h ?? 16);
    const scaleX = tr ? tr.scaleX : (res.transform.scaleX ?? 1);
    const scaleY = tr ? tr.scaleY : (res.transform.scaleY ?? 1);
    const z = sp ? sp.z : (res.spatial3d?.z ?? 0);
    const baseH = sp && sp.height > 0 ? sp.height : (res.spatial3d?.height ?? Math.max(12, h));
    const yaw = sp ? sp.yaw : (res.spatial3d?.yaw ?? 0);
    const hasMesh3d = Boolean(m3 || res.mesh3d);
    const meshScaleX = m3 ? m3.scaleX : (res.mesh3d?.scaleX ?? 1);
    const meshScaleY = m3 ? m3.scaleY : (res.mesh3d?.scaleY ?? 1);
    const meshScaleZ = m3 ? m3.scaleZ : (res.mesh3d?.scaleZ ?? 1);
    const effH = Math.max(8, baseH * (hasMesh3d ? meshScaleZ : Math.abs(scaleY)));
    out.push({
      entityId: ent.id, x, y, w, h, z, height: effH, yaw, scaleX, scaleY,
      meshScaleX, meshScaleY, meshScaleZ, hasMesh3d,
      centerX: x + w * 0.5, centerY: y + h * 0.5, centerZ: z + effH * 0.5,
    });
  }
  return out;
}

function projectPt(wx: number, wy: number, wz: number, vp: ViewportProjArgs, out: ScreenPoint3D): ScreenPoint3D {
  const ox = vp.offsetX ?? 0;
  const oy = vp.offsetY ?? 0;
  if (vp.cam3d) {
    projectWorld3DToScreen(wx, wy, wz, vp.cam3d, out);
    out.x += ox;
    out.y += oy;
    return out;
  }
  const safeZoom = Math.max(0.35, vp.zoom);
  out.x = ox + vp.viewW * 0.5 + (wx - (vp.camX + vp.viewW * 0.5)) * safeZoom;
  out.y = oy + vp.viewH * 0.5 + (wy - (vp.camY + vp.viewH * 0.5)) * safeZoom;
  out.scale = safeZoom;
  out.depth = -wy;
  out.visible = true;
  return out;
}

function computeEntityBounds(
  pose: WorkbenchEntityPose,
  vp: ViewportProjArgs,
): { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; depth: number } | null {
  projectPt(pose.centerX, pose.centerY, pose.centerZ, vp, _pA);
  if (!_pA.visible) return null;
  const { x: cx, y: cy, depth } = _pA;
  const hw = Math.max(4, pose.w * 0.5 * Math.abs(pose.scaleX));
  const hh = Math.max(4, pose.h * 0.5 * Math.abs(pose.scaleY));
  const x0 = pose.centerX - hw;
  const x1 = pose.centerX + hw;
  const y0 = pose.centerY - hh;
  const y1 = pose.centerY + hh;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let vis = 0;

  if (!vp.cam3d) {
    projectPt(x0, y0, 0, vp, _pB);
    projectPt(x1, y1, 0, vp, _pC);
    minX = Math.min(_pB.x, _pC.x); maxX = Math.max(_pB.x, _pC.x);
    minY = Math.min(_pB.y, _pC.y); maxY = Math.max(_pB.y, _pC.y);
    vis = 2;
  } else {
    const ox = vp.offsetX ?? 0;
    const oy = vp.offsetY ?? 0;
    for (let iz = 0; iz < 2; iz++) {
      const wz = iz === 0 ? pose.z : pose.z + pose.height;
      for (let iy = 0; iy < 2; iy++) {
        const wy = iy === 0 ? y0 : y1;
        for (let ix = 0; ix < 2; ix++) {
          projectWorld3DToScreen(ix === 0 ? x0 : x1, wy, wz, vp.cam3d, _pB);
          if (!_pB.visible) continue;
          const sx = _pB.x + ox;
          const sy = _pB.y + oy;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
          vis++;
        }
      }
    }
  }
  if (vis === 0) return null;
  if (maxX - minX < 14) { minX = cx - 7; maxX = cx + 7; }
  if (maxY - minY < 14) { minY = cy - 7; maxY = cy + 7; }
  return { minX, minY, maxX, maxY, cx, cy, depth };
}

/** Projects active-room entities and returns the closest-depth entity ID hit by `(ptrViewX, ptrViewY)`. */
export function pickEntityAtScreen(ptrViewX: number, ptrViewY: number, ctx: EntityPickContext): string | null {
  const poses = ctx.poses ?? collectRoomEntityPoses(ctx.project, ctx.roomId);
  let bestId: string | null = null;
  let bestDepth = Infinity;
  let bestDistSq = Infinity;
  for (let i = 0; i < poses.length; i++) {
    const b = computeEntityBounds(poses[i], ctx);
    if (!b || ptrViewX < b.minX - 2 || ptrViewX > b.maxX + 2 || ptrViewY < b.minY - 2 || ptrViewY > b.maxY + 2) continue;
    const dSq = (b.cx - ptrViewX) * (b.cx - ptrViewX) + (b.cy - ptrViewY) * (b.cy - ptrViewY);
    if (b.depth < bestDepth - 0.5 || (Math.abs(b.depth - bestDepth) <= 0.5 && dSq < bestDistSq)) {
      bestDepth = b.depth;
      bestDistSq = dSq;
      bestId = poses[i].entityId;
    }
  }
  return bestId;
}

/** Returns all active-room entity IDs whose projected screen center falls inside `(x0, y0, x1, y1)`. */
export function collectEntitiesInMarquee(x0: number, y0: number, x1: number, y1: number, ctx: EntityPickContext): string[] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const poses = ctx.poses ?? collectRoomEntityPoses(ctx.project, ctx.roomId);
  const hits: string[] = [];
  for (let i = 0; i < poses.length; i++) {
    projectPt(poses[i].centerX, poses[i].centerY, poses[i].centerZ, ctx, _pA);
    if (_pA.visible && _pA.x >= minX && _pA.x <= maxX && _pA.y >= minY && _pA.y <= maxY) hits.push(poses[i].entityId);
  }
  return hits;
}

export function computeSelectionCentroid(selectedPoses: readonly WorkbenchEntityPose[]): { cx: number; cy: number; cz: number } | null {
  if (selectedPoses.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < selectedPoses.length; i++) {
    sx += selectedPoses[i].centerX;
    sy += selectedPoses[i].centerY;
    sz += selectedPoses[i].z;
  }
  const inv = 1 / selectedPoses.length;
  return { cx: sx * inv, cy: sy * inv, cz: sz * inv };
}

function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-4) return (px - ax) * (px - ax) + (py - ay) * (py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
}

function pointInQuad(px: number, py: number, a: ScreenPoint3D, b: ScreenPoint3D, c: ScreenPoint3D, d: ScreenPoint3D): boolean {
  const c1 = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
  const c2 = (c.x - b.x) * (py - b.y) - (c.y - b.y) * (px - b.x);
  const c3 = (d.x - c.x) * (py - c.y) - (d.y - c.y) * (px - c.x);
  const c4 = (a.x - d.x) * (py - d.y) - (a.y - d.y) * (px - d.x);
  return (c1 >= 0 && c2 >= 0 && c3 >= 0 && c4 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0 && c4 <= 0);
}

function gizmoAxisLen(zoom: number): number {
  return 30 / Math.max(0.55, Math.min(2.2, zoom));
}

function projectYawRing(cx: number, cy: number, cz: number, r: number, vp: ViewportProjArgs): boolean {
  let vis = 0;
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    projectPt(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz, vp, _ringPts[i]);
    if (_ringPts[i].visible) vis++;
  }
  return vis >= RING_SEGMENTS * 0.5;
}

/**
 * Pure hit-tester for the 3-Mode Gizmo (`move`, `rotate`, `scale`).
 * Skips depth-collapsed axes (`< 5px` on screen) so `ortho_front` / `ortho_side` Z & horizontal axes stay easy to grab.
 */
export function hitTestGizmoHandle(
  ptrLocalX: number,
  ptrLocalY: number,
  selectedPoses: readonly WorkbenchEntityPose[],
  mode: MapGizmoMode,
  cam3d: ComputedCamera3D | null,
  viewW: number,
  viewH: number,
  camX = 0,
  camY = 0,
  zoom = 1,
): GizmoHandleId | null {
  const centroid = computeSelectionCentroid(selectedPoses);
  if (!centroid) return null;
  const { cx, cy, cz } = centroid;
  const vp: ViewportProjArgs = { camX, camY, zoom, viewW, viewH, cam3d, offsetX: 0, offsetY: 0 };
  projectPt(cx, cy, cz, vp, _pA);
  if (!_pA.visible) return null;
  const { x: ox, y: oy } = _pA;
  const axisLen = gizmoAxisLen(zoom);

  if (mode === 'rotate') {
    if (!projectYawRing(cx, cy, cz, axisLen * 0.92, vp)) return null;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = _ringPts[i];
      const b = _ringPts[(i + 1) % RING_SEGMENTS];
      if (a.visible && b.visible && segDistSq(ptrLocalX, ptrLocalY, a.x, a.y, b.x, b.y) <= 144) return 'yaw';
    }
    return null;
  }

  if (mode === 'scale') {
    const cdx = ptrLocalX - ox;
    const cdy = ptrLocalY - oy;
    if (cdx * cdx + cdy * cdy <= 121) return 'scale_u';
  }

  const axes = mode === 'scale' ? SCALE_AXES : MOVE_AXES;
  let bestHandle: GizmoHandleId | null = null;
  let bestDistSq = 169;
  for (let i = 0; i < axes.length; i++) {
    const ax = axes[i];
    if (ax.need3d && !cam3d) continue;
    projectPt(cx + ax.dx * axisLen, cy + ax.dy * axisLen, cz + ax.dz * axisLen, vp, _pB);
    if (!_pB.visible) continue;
    if ((_pB.x - ox) * (_pB.x - ox) + (_pB.y - oy) * (_pB.y - oy) < 25) continue;
    const tipDistSq = (_pB.x - ptrLocalX) * (_pB.x - ptrLocalX) + (_pB.y - ptrLocalY) * (_pB.y - ptrLocalY);
    const effDistSq = Math.min(tipDistSq, segDistSq(ptrLocalX, ptrLocalY, ox, oy, _pB.x, _pB.y) + 16);
    if (effDistSq <= bestDistSq) {
      bestDistSq = effDistSq;
      bestHandle = ax.id;
    }
  }
  if (bestHandle) return bestHandle;

  if (mode === 'move') {
    const p0 = axisLen * 0.28;
    const p1 = axisLen * 0.66;
    projectPt(cx + p0, cy + p0, cz, vp, _pB);
    projectPt(cx + p1, cy + p0, cz, vp, _pC);
    projectPt(cx + p1, cy + p1, cz, vp, _pD);
    projectPt(cx + p0, cy + p1, cz, vp, _pE);
    if (_pB.visible && _pC.visible && _pD.visible && _pE.visible) {
      const area = Math.abs((_pC.x - _pB.x) * (_pE.y - _pB.y) - (_pC.y - _pB.y) * (_pE.x - _pB.x));
      if (area >= 24 && pointInQuad(ptrLocalX, ptrLocalY, _pB, _pC, _pD, _pE)) return 'xy';
    }
  }
  return null;
}

function drawReadoutBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(x, y, tw + 10, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 5, y + 11);
}

/** Draws subtle corner brackets & selection highlights around ALL selected entities. */
export function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  selectedPoses: readonly WorkbenchEntityPose[],
  vp: ViewportProjArgs,
  sx: number,
  sy: number,
): void {
  if (selectedPoses.length === 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.92)';
  ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < selectedPoses.length; i++) {
    const b = computeEntityBounds(selectedPoses[i], vp);
    if (!b) continue;
    const x0 = b.minX * sx;
    const y0 = b.minY * sy;
    const x1 = b.maxX * sx;
    const y1 = b.maxY * sy;
    const bw = Math.max(8, x1 - x0);
    const bh = Math.max(8, y1 - y0);
    const arm = Math.max(4, Math.min(10, Math.min(bw, bh) * 0.32));
    ctx.fillRect(x0, y0, bw, bh);
    ctx.beginPath();
    ctx.moveTo(x0, y0 + arm); ctx.lineTo(x0, y0); ctx.lineTo(x0 + arm, y0);
    ctx.moveTo(x1 - arm, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + arm);
    ctx.moveTo(x1, y1 - arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 - arm, y1);
    ctx.moveTo(x0 + arm, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - arm);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws the translucent dashed marquee box during box-select drag. */
export function drawMarqueeOverlay(ctx: CanvasRenderingContext2D, marquee: MarqueeRect, sx: number, sy: number): void {
  const x = Math.min(marquee.x0, marquee.x1) * sx;
  const y = Math.min(marquee.y0, marquee.y1) * sy;
  const w = Math.abs(marquee.x1 - marquee.x0) * sx;
  const h = Math.abs(marquee.y1 - marquee.y0) * sy;
  ctx.save();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
  ctx.restore();
}

/** Draws the 3-Mode Gizmo (`move`, `rotate`, `scale`) at the selection centroid. */
export function drawGizmoOverlay(
  ctx: CanvasRenderingContext2D,
  selectedPoses: readonly WorkbenchEntityPose[],
  mode: MapGizmoMode,
  vp: ViewportProjArgs,
  sx: number,
  sy: number,
  feedback: GizmoRenderFeedback,
): void {
  const centroid = computeSelectionCentroid(selectedPoses);
  if (!centroid) return;
  const { cx, cy, cz } = centroid;
  projectPt(cx, cy, cz, vp, _pA);
  if (!_pA.visible) return;
  const ox = _pA.x * sx;
  const oy = _pA.y * sy;
  const axisLen = gizmoAxisLen(vp.zoom);

  ctx.save();
  ctx.font = '700 10px "JetBrains Mono", monospace';

  if (mode === 'rotate') {
    const ringR = axisLen * 0.92;
    if (projectYawRing(cx, cy, cz, ringR, vp)) {
      const isActive = feedback.activeHandle === 'yaw';
      ctx.strokeStyle = isActive ? '#fde047' : '#f59e0b';
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= RING_SEGMENTS; i++) {
        const pt = _ringPts[i % RING_SEGMENTS];
        if (!pt.visible) { started = false; continue; }
        if (!started) { ctx.moveTo(pt.x * sx, pt.y * sy); started = true; } else { ctx.lineTo(pt.x * sx, pt.y * sy); }
      }
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      for (let k = 0; k < 4; k++) {
        const tp = _ringPts[(k * RING_SEGMENTS) >> 2];
        if (!tp.visible) continue;
        ctx.beginPath();
        ctx.arc(tp.x * sx, tp.y * sy, isActive ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isActive && feedback.deltaYawDeg !== undefined) {
        const startA = feedback.startAngleRad ?? 0;
        const endA = startA + feedback.deltaYawDeg * DEG_TO_RAD;
        const steps = Math.max(4, Math.min(24, Math.ceil(Math.abs(feedback.deltaYawDeg) / 10)));
        ctx.fillStyle = 'rgba(250, 204, 21, 0.24)';
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        for (let s = 0; s <= steps; s++) {
          const a = startA + ((endA - startA) * s) / steps;
          projectPt(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR, cz, vp, _pB);
          if (_pB.visible) ctx.lineTo(_pB.x * sx, _pB.y * sy);
        }
        ctx.closePath();
        ctx.fill();
        drawReadoutBadge(ctx, `${feedback.deltaYawDeg >= 0 ? '+' : ''}${Math.round(feedback.deltaYawDeg)}°`, ox + 10, oy - 22, '#fde047');
      }
    }
    ctx.restore();
    return;
  }

  if (mode === 'move') {
    const p0 = axisLen * 0.28;
    const p1 = axisLen * 0.66;
    projectPt(cx + p0, cy + p0, cz, vp, _pB);
    projectPt(cx + p1, cy + p0, cz, vp, _pC);
    projectPt(cx + p1, cy + p1, cz, vp, _pD);
    projectPt(cx + p0, cy + p1, cz, vp, _pE);
    if (_pB.visible && _pC.visible && _pD.visible && _pE.visible) {
      const area = Math.abs((_pC.x - _pB.x) * (_pE.y - _pB.y) - (_pC.y - _pB.y) * (_pE.x - _pB.x));
      if (area >= 24) {
        const xyOn = feedback.activeHandle === 'xy';
        ctx.fillStyle = xyOn ? 'rgba(250, 204, 21, 0.45)' : 'rgba(250, 204, 21, 0.20)';
        ctx.strokeStyle = xyOn ? '#fde047' : 'rgba(250, 204, 21, 0.85)';
        ctx.lineWidth = xyOn ? 2 : 1.25;
        ctx.beginPath();
        ctx.moveTo(_pB.x * sx, _pB.y * sy); ctx.lineTo(_pC.x * sx, _pC.y * sy);
        ctx.lineTo(_pD.x * sx, _pD.y * sy); ctx.lineTo(_pE.x * sx, _pE.y * sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  const axes = mode === 'scale' ? SCALE_AXES : MOVE_AXES;
  for (let i = 0; i < axes.length; i++) {
    const ax = axes[i];
    if (ax.need3d && !vp.cam3d) continue;
    projectPt(cx + ax.dx * axisLen, cy + ax.dy * axisLen, cz + ax.dz * axisLen, vp, _pB);
    if (!_pB.visible) continue;
    const ex = _pB.x * sx;
    const ey = _pB.y * sy;
    if (Math.hypot(ex - ox, ey - oy) < 5) continue;
    const active = feedback.activeHandle === ax.id;
    ctx.strokeStyle = active ? '#fde047' : ax.color;
    ctx.fillStyle = active ? '#fde047' : ax.color;
    ctx.lineWidth = active ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (mode === 'scale') {
      const sz = active ? 9 : 7;
      ctx.fillRect(ex - sz * 0.5, ey - sz * 0.5, sz, sz);
    } else {
      const ang = Math.atan2(ey - oy, ex - ox);
      const hd = active ? 9 : 7;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - hd * Math.cos(ang - 0.42), ey - hd * Math.sin(ang - 0.42));
      ctx.lineTo(ex - hd * Math.cos(ang + 0.42), ey - hd * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillText(ax.label, ex + 6, ey + 3);
  }

  if (mode === 'scale') {
    const sz = feedback.activeHandle === 'scale_u' ? 11 : 8;
    ctx.fillStyle = feedback.activeHandle === 'scale_u' ? '#fde047' : '#f8fafc';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.fillRect(ox - sz * 0.5, oy - sz * 0.5, sz, sz);
    ctx.strokeRect(ox - sz * 0.5, oy - sz * 0.5, sz, sz);
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(ox, oy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (feedback.readoutLabel) drawReadoutBadge(ctx, feedback.readoutLabel, ox + 10, oy - 24, '#f8fafc');
  ctx.restore();
}
