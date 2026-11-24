import {
  getEntityPrefabId,
  resolveEntityComponents,
  type EcsCharacterMotor2DComponent,
  type EcsComponentBundle,
  type EcsProjectV2,
} from '../ecs/EcsProjectSchema.ts';
import {
  CASTLE_TILE_IDS,
  getCastleTileDef,
  isRoomCellHazard,
  isRoomCellSolid,
} from '../ecs/EcsTilemapTypes.ts';

export interface SemanticEntitySummary {
  id: string;
  name: string;
  tag: string;
  roomId?: string;
  prefabId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  z: number;
  height: number;
  dimensionMask: number;
  components: string[];
  isSolid: boolean;
  isHero: boolean;
  isAnchor: boolean;
  isTrigger: boolean;
}

export interface SemanticPlatformSummary {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  topY: number;
  rightX: number;
  z: number;
  height: number;
  dimensionMask: number;
}

export interface SemanticAnchorSummary {
  id: string;
  name: string;
  cx: number;
  cy: number;
  anchorRadius: number;
  minLength: number;
  enabled: boolean;
  z: number;
  dimensionMask: number;
}

export interface SemanticTriggerSummary {
  id: string;
  name: string;
  cx: number;
  cy: number;
  shape: 'rect' | 'circle';
  width: number;
  height: number;
  radius: number;
  filterTag: string;
  onEnterEvent: string;
  onExitEvent: string;
  oneShot: boolean;
  z: number;
  dimensionMask: number;
}

export interface EcsSemanticSceneReport {
  projectId: string;
  title: string;
  viewport: { width: number; height: number };
  projection: {
    mode: 'ortho_2d' | 'hd2d_iso' | 'hd2d_3d' | 'first_person_25d';
    pitchDeg?: number;
    fovDeg?: number;
    wallHeightScale?: number;
    activeDimensionMask: number;
    allowDimensionShift: boolean;
  };
  entityCount: number;
  prefabCount: number;
  scriptCount: number;
  globals: Record<string, number>;
  entities: SemanticEntitySummary[];
  solidPlatforms: SemanticPlatformSummary[];
  grappleAnchors: SemanticAnchorSummary[];
  triggerZones: SemanticTriggerSummary[];
  prefabs: Array<{ id: string; name: string; category: string; instanceCount: number }>;
  worldMap?: {
    tileSize: number;
    startRoomId: string;
    rooms: Array<{ id: string; name: string; cols: number; rows: number; entityCount: number }>;
    portals: Array<{
      id: string;
      fromRoomId: string;
      toRoomId: string;
      col: number;
      row: number;
      requiresGlobal?: string;
    }>;
    interactionTags: string[];
    aiProfileTags: string[];
    customTileIds: number[];
  };
  warnings: string[];
}

export type ReachEdgeMethod = 'walk_drop' | 'jump' | 'jump_dash' | 'grapple_swing' | 'dimension_shift';

export interface ReachabilityNode {
  id: string;
  kind: 'platform' | 'floor' | 'goal';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  topY: number;
  z: number;
  dimensionMask: number;
}

export interface ReachabilityEdge {
  from: string;
  to: string;
  method: ReachEdgeMethod;
  gapX: number;
  deltaY: number;
  viaAnchorId?: string;
}

export interface GoalReachStatus {
  entityId: string;
  name: string;
  reachable: boolean;
  pathNodes: string[];
  viaMethods: ReachEdgeMethod[];
  reason: string;
}

export interface ReachabilityOptions {
  heroEntityId?: string;
  goalEntityIds?: string[];
}

export interface EcsReachabilityReport {
  pass: boolean;
  hasActionMotor: boolean;
  heroEntityId: string | null;
  startNodeId: string | null;
  kinematics: {
    moveSpeed: number;
    jumpVelocity: number;
    gravity: number;
    maxJumpHeight: number;
    jumpAirTimeSec: number;
    maxJumpReachX: number;
    maxDashReachX: number;
    maxTotalReachX: number;
    floorY: number;
  } | null;
  nodes: ReachabilityNode[];
  edges: ReachabilityEdge[];
  reachableNodeIds: string[];
  unreachableNodeIds: string[];
  goalStatuses: GoalReachStatus[];
  unreachableAnchorIds: string[];
  softLockRisks: string[];
  diagnostics: string[];
}

function listBundleComponentNames(c: EcsComponentBundle): string[] {
  const keys: string[] = ['transform'];
  if (c.body2d) keys.push('body2d');
  if (c.sprite) keys.push('sprite');
  if (c.animatorId) keys.push('animator');
  if (c.health) keys.push('health');
  if (c.pathFollower) keys.push('pathFollower');
  if (c.light) keys.push('light');
  if (c.collider) keys.push('collider');
  if (c.rhythmLane) keys.push('rhythmLane');
  if (c.characterMotor2d) keys.push('characterMotor2d');
  if (c.grappleAnchor) keys.push('grappleAnchor');
  if (c.triggerZone) keys.push('triggerZone');
  if (c.verletChain) keys.push('verletChain');
  if (c.spatial3d) keys.push('spatial3d');
  if (c.lifetime !== undefined) keys.push('lifetime');
  if (c.scripts && c.scripts.length > 0) keys.push('scripts');
  return keys;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Produces a compact, token-efficient semantic spatial summary of an EcsProjectV2
 * so AI agents can reason over topology, anchors, triggers, and structural defects
 * without ingesting verbose raw scene JSON.
 */
export function observeSceneSemantics(project: EcsProjectV2): EcsSemanticSceneReport {
  const entities: SemanticEntitySummary[] = [];
  const solidPlatforms: SemanticPlatformSummary[] = [];
  const grappleAnchors: SemanticAnchorSummary[] = [];
  const triggerZones: SemanticTriggerSummary[] = [];
  const warnings: string[] = [];
  const prefabCounts = new Map<string, number>();

  const vw = project.viewport.width;
  const vh = project.viewport.height;

  for (const ent of project.entities) {
    const pid = getEntityPrefabId(ent);
    if (pid) {
      prefabCounts.set(pid, (prefabCounts.get(pid) ?? 0) + 1);
      if (!project.prefabs[pid]) {
        warnings.push(`Entity "${ent.id}" references missing Prefab "${pid}"`);
      }
    }
    const c = resolveEntityComponents(ent, project.prefabs);
    const x = c.transform.x;
    const y = c.transform.y;
    const w = c.transform.w ?? 16;
    const h = c.transform.h ?? 16;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const z = c.spatial3d?.z ?? 0;
    const height = c.spatial3d?.height ?? 16;
    const dimensionMask = c.spatial3d?.dimensionMask ?? 3;
    const tag = c.tag ?? 'prop';
    const isSolid = Boolean(c.collider?.isSolid);
    const isHero = Boolean(c.characterMotor2d) || tag === 'hero' || tag === 'player';
    const isAnchor = Boolean(c.grappleAnchor);
    const isTrigger = Boolean(c.triggerZone);

    const wm = project.worldMap;
    if (wm && wm.rooms.length > 0) {
      const targetRoom =
        (ent.roomId ? wm.rooms.find((r) => r.id === ent.roomId) : undefined) ??
        wm.rooms.find((r) => r.id === wm.startRoomId) ??
        wm.rooms[0];
      const rw = targetRoom ? targetRoom.cols * wm.tileSize : vw;
      const rh = targetRoom ? targetRoom.rows * wm.tileSize : vh;
      if (x + w < -64 || x > rw + 64 || y + h < -64 || y > rh + 64) {
        warnings.push(
          `Entity "${ent.id}" (${round1(x)}, ${round1(y)}) lies outside room "${targetRoom?.id ?? 'unknown'}" bounds ${rw}x${rh}`,
        );
      }
    } else if (x + w < -64 || x > vw + 64 || y + h < -64 || y > vh + 64) {
      warnings.push(`Entity "${ent.id}" (${round1(x)}, ${round1(y)}) lies outside viewport ${vw}x${vh}`);
    }

    entities.push({
      id: ent.id,
      name: ent.name,
      tag,
      ...(ent.roomId ? { roomId: ent.roomId } : {}),
      ...(pid ? { prefabId: pid } : {}),
      x: round1(x),
      y: round1(y),
      w: round1(w),
      h: round1(h),
      cx: round1(cx),
      cy: round1(cy),
      z: round1(z),
      height: round1(height),
      dimensionMask,
      components: listBundleComponentNames(c),
      isSolid,
      isHero,
      isAnchor,
      isTrigger,
    });

    if (isSolid) {
      solidPlatforms.push({
        id: ent.id,
        name: ent.name,
        x: round1(x),
        y: round1(y),
        w: round1(w),
        h: round1(h),
        topY: round1(y),
        rightX: round1(x + w),
        z: round1(z),
        height: round1(height),
        dimensionMask,
      });
    }

    if (c.grappleAnchor) {
      grappleAnchors.push({
        id: ent.id,
        name: ent.name,
        cx: round1(cx),
        cy: round1(cy),
        anchorRadius: c.grappleAnchor.anchorRadius ?? 128,
        minLength: c.grappleAnchor.minLength ?? 20,
        enabled: c.grappleAnchor.enabled ?? true,
        z: round1(z),
        dimensionMask,
      });
    }

    if (c.triggerZone) {
      triggerZones.push({
        id: ent.id,
        name: ent.name,
        cx: round1(cx),
        cy: round1(cy),
        shape: c.triggerZone.shape ?? 'rect',
        width: c.triggerZone.width ?? w,
        height: c.triggerZone.height ?? h,
        radius: c.triggerZone.radius ?? Math.max(w, h) * 0.5,
        filterTag: c.triggerZone.filterTag ?? '',
        onEnterEvent: c.triggerZone.onEnterEvent ?? '',
        onExitEvent: c.triggerZone.onExitEvent ?? '',
        oneShot: Boolean(c.triggerZone.oneShot),
        z: round1(z),
        dimensionMask,
      });
    }
  }

  const prefabs = Object.values(project.prefabs).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category ?? 'general',
    instanceCount: prefabCounts.get(p.id) ?? 0,
  }));

  if (solidPlatforms.length > 0 && !entities.some((e) => e.components.includes('characterMotor2d'))) {
    warnings.push('Scene defines solid platforms but no entity has a CharacterMotor2D component');
  }

  const worldMapSummary = project.worldMap
    ? {
        tileSize: project.worldMap.tileSize,
        startRoomId: project.worldMap.startRoomId,
        rooms: project.worldMap.rooms.map((r) => ({
          id: r.id,
          name: r.name,
          cols: r.cols,
          rows: r.rows,
          entityCount: project.entities.filter((e) => e.roomId === r.id).length,
        })),
        portals: project.worldMap.portals.map((p) => ({
          id: p.id,
          fromRoomId: p.fromRoomId,
          toRoomId: p.toRoomId,
          col: p.col,
          row: p.row,
          ...(p.requiresGlobal ? { requiresGlobal: p.requiresGlobal } : {}),
        })),
        interactionTags: (project.worldMap.interactions ?? []).map((r) => r.tag),
        aiProfileTags: Object.keys(project.worldMap.aiProfiles ?? {}),
        customTileIds: (project.worldMap.tileDefs ?? []).map((t) => t.id),
      }
    : undefined;

  return {
    projectId: project.meta.id,
    title: project.meta.title,
    viewport: { width: vw, height: vh },
    projection: {
      mode: project.projection?.mode ?? 'hd2d_iso',
      ...(project.projection?.pitchDeg !== undefined ? { pitchDeg: project.projection.pitchDeg } : {}),
      ...(project.projection?.fovDeg !== undefined ? { fovDeg: project.projection.fovDeg } : {}),
      ...(project.projection?.wallHeightScale !== undefined ? { wallHeightScale: project.projection.wallHeightScale } : {}),
      activeDimensionMask: project.projection?.activeDimensionMask ?? 3,
      allowDimensionShift: Boolean(project.projection?.allowDimensionShift),
    },
    entityCount: entities.length,
    prefabCount: prefabs.length,
    scriptCount: Object.keys(project.scripts).length,
    globals: { ...project.globals },
    entities,
    solidPlatforms,
    grappleAnchors,
    triggerZones,
    prefabs,
    ...(worldMapSummary ? { worldMap: worldMapSummary } : {}),
    warnings,
  };
}

function horizontalSpanGap(ax0: number, ax1: number, bx0: number, bx1: number): number {
  if (ax1 < bx0) return bx0 - ax1;
  if (bx1 < ax0) return ax0 - bx1;
  return 0;
}

function normalizeMotor(raw: EcsCharacterMotor2DComponent, viewH: number): {
  moveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  coyoteTimeSec: number;
  dashSpeed: number;
  dashDurationSec: number;
  floorY: number;
} {
  return {
    moveSpeed: Math.max(20, raw.moveSpeed ?? 160),
    jumpVelocity: Math.max(40, raw.jumpVelocity ?? 260),
    gravity: Math.max(60, raw.gravity ?? 720),
    coyoteTimeSec: Math.max(0, raw.coyoteTimeSec ?? 0.1),
    dashSpeed: Math.max(0, raw.dashSpeed ?? 320),
    dashDurationSec: Math.max(0, raw.dashDurationSec ?? 0.12),
    floorY: raw.floorY ?? viewH,
  };
}

/**
 * Pure kinematic spatial reachability & soft-lock oracle for ECS Action / Platformer / Grapple scenes.
 * Evaluates platform-to-platform traversal via walk/drop, jump arc, jump+dash, and grapple pendulum swing.
 */
export function analyzeActionReachability(
  project: EcsProjectV2,
  opts: ReachabilityOptions = {},
): EcsReachabilityReport {
  const resolvedList = project.entities.map((ent) => ({
    ent,
    comp: resolveEntityComponents(ent, project.prefabs),
  }));

  const heroEntry = opts.heroEntityId
    ? resolvedList.find((r) => r.ent.id === opts.heroEntityId)
    : resolvedList.find((r) => Boolean(r.comp.characterMotor2d));

  if (!heroEntry || !heroEntry.comp.characterMotor2d) {
    return {
      pass: true,
      hasActionMotor: false,
      heroEntityId: heroEntry?.ent.id ?? null,
      startNodeId: null,
      kinematics: null,
      nodes: [],
      edges: [],
      reachableNodeIds: [],
      unreachableNodeIds: [],
      goalStatuses: [],
      unreachableAnchorIds: [],
      softLockRisks: [],
      diagnostics: ['No CharacterMotor2D entity found; action platform reachability check skipped.'],
    };
  }

  const heroTr = heroEntry.comp.transform;
  const heroW = heroTr.w ?? 16;
  const heroH = heroTr.h ?? 16;
  const heroSp = heroEntry.comp.spatial3d;
  const heroDimMask = heroSp?.dimensionMask ?? 3;
  const allowDimShift = Boolean(project.projection?.allowDimensionShift);
  const heroMaxJumpZ =
    heroSp && (heroSp.gravityZ ?? 0) > 0
      ? ((heroSp.jumpZVelocity ?? 190) * (heroSp.jumpZVelocity ?? 190)) / (2 * (heroSp.gravityZ ?? 540))
      : Infinity;
  const motor = normalizeMotor(heroEntry.comp.characterMotor2d, project.viewport.height);

  // Exact ballistic jump kinematics
  const maxJumpHeight = (motor.jumpVelocity * motor.jumpVelocity) / (2 * motor.gravity);
  const jumpAirTimeSec = (2 * motor.jumpVelocity) / motor.gravity;
  const maxJumpReachX = motor.moveSpeed * (jumpAirTimeSec + motor.coyoteTimeSec) + heroW * 0.5;
  const maxDashReachX = motor.dashSpeed * motor.dashDurationSec;
  const maxTotalReachX = maxJumpReachX + maxDashReachX * 0.9;

  const nodes: ReachabilityNode[] = [];
  const anchors: SemanticAnchorSummary[] = [];

  for (const { ent, comp } of resolvedList) {
    const x = comp.transform.x;
    const y = comp.transform.y;
    const w = comp.transform.w ?? 16;
    const h = comp.transform.h ?? 16;
    const z = comp.spatial3d?.z ?? 0;
    const dimMask = comp.spatial3d?.dimensionMask ?? 3;

    if (comp.collider?.isSolid) {
      nodes.push({
        id: ent.id,
        kind: 'platform',
        label: ent.name,
        x,
        y,
        w,
        h,
        topY: y,
        z,
        dimensionMask: dimMask,
      });
    }
    if (comp.grappleAnchor && (comp.grappleAnchor.enabled ?? true)) {
      anchors.push({
        id: ent.id,
        name: ent.name,
        cx: x + w * 0.5,
        cy: y + h * 0.5,
        anchorRadius: comp.grappleAnchor.anchorRadius ?? 128,
        minLength: comp.grappleAnchor.minLength ?? 20,
        enabled: true,
        z,
        dimensionMask: dimMask,
      });
    }
  }

  // Add virtual floor node if floorY is within or near viewport and no solid covers entire floor
  const floorActive = Number.isFinite(motor.floorY) && motor.floorY > 0 && motor.floorY <= project.viewport.height + 64;
  if (floorActive) {
    nodes.push({
      id: '__floor__',
      kind: 'floor',
      label: `Floor (y=${Math.round(motor.floorY)})`,
      x: 0,
      y: motor.floorY,
      w: project.viewport.width,
      h: 16,
      topY: motor.floorY,
      z: 0,
      dimensionMask: 3,
    });
  }

  // Determine goal entities (explicitly requested OR trigger zones / entities tagged 'goal' or 'exit')
  const goalSet = new Set<string>(opts.goalEntityIds ?? []);
  if (goalSet.size === 0) {
    for (const { ent, comp } of resolvedList) {
      if (ent.id === heroEntry.ent.id) continue;
      if (comp.triggerZone || comp.tag === 'goal' || comp.tag === 'exit' || comp.tag === 'checkpoint') {
        goalSet.add(ent.id);
      }
    }
  }

  for (const goalId of goalSet) {
    const found = resolvedList.find((r) => r.ent.id === goalId);
    if (!found) continue;
    if (nodes.some((n) => n.id === goalId)) continue;
    const tr = found.comp.transform;
    const w = found.comp.triggerZone?.width ?? tr.w ?? 20;
    const h = found.comp.triggerZone?.height ?? tr.h ?? 20;
    nodes.push({
      id: found.ent.id,
      kind: 'goal',
      label: found.ent.name,
      x: tr.x,
      y: tr.y,
      w,
      h,
      topY: tr.y + h,
      z: found.comp.spatial3d?.z ?? 0,
      dimensionMask: found.comp.spatial3d?.dimensionMask ?? 3,
    });
  }

  // Find hero's starting surface node (platform directly beneath hero, or __floor__)
  const heroCenterX = heroTr.x + heroW * 0.5;
  const heroFeetY = heroTr.y + heroH;
  let startNode: ReachabilityNode | null = null;
  let bestStartDist = Infinity;
  for (const n of nodes) {
    if (n.kind === 'goal') continue;
    const withinX = heroCenterX >= n.x - heroW * 0.5 && heroCenterX <= n.x + n.w + heroW * 0.5;
    if (withinX && n.topY >= heroFeetY - 8) {
      const d = n.topY - heroFeetY;
      if (d < bestStartDist) {
        bestStartDist = d;
        startNode = n;
      }
    }
  }
  if (!startNode && nodes.length > 0) {
    startNode = nodes.find((n) => n.id === '__floor__') ?? nodes[0];
  }

  // Helper: evaluate kinematic & multi-dimensional reach from surface A -> target B
  const evalDirectReach = (a: ReachabilityNode, b: ReachabilityNode): ReachabilityEdge | null => {
    const directDimCompatible = (a.dimensionMask & b.dimensionMask) !== 0 && (heroDimMask & b.dimensionMask) !== 0;
    const requiresDimShift = !directDimCompatible;
    if (requiresDimShift && !allowDimShift) {
      return null;
    }

    // 3D Z-elevation climb constraint when Spatial3D gravity is enabled on hero
    const climbZ = b.z - a.z;
    if (climbZ > 0 && climbZ > heroMaxJumpZ * 0.94) {
      return null;
    }

    const gapX = horizontalSpanGap(a.x, a.x + a.w, b.x, b.x + b.w);
    // For goals, the hero body height gives vertical overlap grace
    const targetTopY = b.kind === 'goal' ? Math.max(b.y, b.y + b.h - heroH) : b.topY;
    // Positive climb = going upward (lower Y in 2D screen coordinates)
    const climbNeeded = a.topY - targetTopY;
    const dropGain = Math.max(0, -climbNeeded);

    // 1. Walk / Drop without jumping
    if (climbNeeded <= 2 && gapX <= heroW * 0.6) {
      return {
        from: a.id,
        to: b.id,
        method: requiresDimShift ? 'dimension_shift' : 'walk_drop',
        gapX: round1(gapX),
        deltaY: round1(-climbNeeded),
      };
    }

    // 2. Ballistic jump (accounting for extra/reduced airtime from height difference)
    if (climbNeeded <= maxJumpHeight * 0.94) {
      const disc = Math.max(0, motor.jumpVelocity * motor.jumpVelocity - 2 * motor.gravity * Math.max(0, climbNeeded));
      const tFlight =
        climbNeeded >= 0
          ? (motor.jumpVelocity + Math.sqrt(disc)) / motor.gravity
          : (motor.jumpVelocity + Math.sqrt(motor.jumpVelocity * motor.jumpVelocity + 2 * motor.gravity * dropGain)) /
            motor.gravity;
      const jumpReachAtDeltaY = motor.moveSpeed * (tFlight + motor.coyoteTimeSec) + heroW * 0.5;

      if (gapX <= jumpReachAtDeltaY * 0.95) {
        return {
          from: a.id,
          to: b.id,
          method: requiresDimShift ? 'dimension_shift' : 'jump',
          gapX: round1(gapX),
          deltaY: round1(-climbNeeded),
        };
      }
      if (maxDashReachX > 1 && gapX <= (jumpReachAtDeltaY + maxDashReachX * 0.9) * 0.95) {
        return {
          from: a.id,
          to: b.id,
          method: requiresDimShift ? 'dimension_shift' : 'jump_dash',
          gapX: round1(gapX),
          deltaY: round1(-climbNeeded),
        };
      }
    }

    // 3. Grapple pendulum bridge between A and B via an overhead/nearby anchor
    for (const anc of anchors) {
      if (!allowDimShift && (anc.dimensionMask & a.dimensionMask) === 0) continue;
      // Can hero jump from A into anc's capture circle?
      const clampedAx = Math.max(a.x, Math.min(a.x + a.w, anc.cx));
      const launchY = Math.max(anc.cy, a.topY - maxJumpHeight * 0.85);
      const distFromA = Math.hypot(clampedAx - anc.cx, launchY - anc.cy);
      if (distFromA > anc.anchorRadius + maxDashReachX * 0.4) continue;

      // Can pendulum swing / release reach B?
      const clampedBx = Math.max(b.x, Math.min(b.x + b.w, anc.cx));
      const targetY = b.kind === 'goal' ? b.y + b.h * 0.5 : b.topY - heroH * 0.5;
      const distToB = Math.hypot(clampedBx - anc.cx, targetY - anc.cy);
      // Swing arc + release momentum covers anchorRadius + modest horizontal throw
      const maxSwingReach = anc.anchorRadius + motor.moveSpeed * 0.45 + maxDashReachX * 0.6;
      if (distToB <= maxSwingReach && anc.cy <= targetY + maxJumpHeight * 0.6) {
        return {
          from: a.id,
          to: b.id,
          method: requiresDimShift ? 'dimension_shift' : 'grapple_swing',
          gapX: round1(gapX),
          deltaY: round1(-climbNeeded),
          viaAnchorId: anc.id,
        };
      }
    }

    return null;
  };

  const edges: ReachabilityEdge[] = [];
  const adj = new Map<string, ReachabilityEdge[]>();
  for (const n of nodes) adj.set(n.id, []);

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a.kind === 'goal') continue; // Goals are terminal targets, not solid takeoff ledges
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const edge = evalDirectReach(a, nodes[j]);
      if (edge) {
        edges.push(edge);
        adj.get(a.id)!.push(edge);
      }
    }
  }

  // Deterministic BFS from startNode tracking parent edge for path reconstruction
  const parentEdge = new Map<string, ReachabilityEdge | null>();
  if (startNode) {
    parentEdge.set(startNode.id, null);
    const queue: string[] = [startNode.id];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const outEdges = adj.get(cur) ?? [];
      for (const e of outEdges) {
        if (!parentEdge.has(e.to)) {
          parentEdge.set(e.to, e);
          queue.push(e.to);
        }
      }
    }
  }

  const reachableNodeIds = nodes.filter((n) => parentEdge.has(n.id)).map((n) => n.id);
  const unreachableNodeIds = nodes.filter((n) => !parentEdge.has(n.id)).map((n) => n.id);

  // Reconstruct paths to goals
  const goalStatuses: GoalReachStatus[] = [];
  for (const goalId of goalSet) {
    const node = nodes.find((n) => n.id === goalId);
    if (!node) continue;
    if (parentEdge.has(goalId)) {
      const pathNodes: string[] = [];
      const viaMethods: ReachEdgeMethod[] = [];
      let cur: string | null = goalId;
      while (cur) {
        pathNodes.push(cur);
        const pe = parentEdge.get(cur);
        if (pe) {
          viaMethods.push(pe.method);
          cur = pe.from;
        } else {
          cur = null;
        }
      }
      pathNodes.reverse();
      viaMethods.reverse();
      goalStatuses.push({
        entityId: goalId,
        name: node.label,
        reachable: true,
        pathNodes,
        viaMethods,
        reason: `Reachable in ${viaMethods.length} hop(s) via [${viaMethods.join(' -> ')}]`,
      });
    } else {
      // Find closest reachable surface to explain WHY it failed
      let nearestDist = Infinity;
      let nearestId = startNode?.id ?? 'none';
      for (const rid of reachableNodeIds) {
        const rn = nodes.find((n) => n.id === rid);
        if (!rn || rn.kind === 'goal') continue;
        const gx = horizontalSpanGap(rn.x, rn.x + rn.w, node.x, node.x + node.w);
        const dy = rn.topY - node.topY;
        const d = Math.hypot(gx, Math.max(0, dy));
        if (d < nearestDist) {
          nearestDist = d;
          nearestId = rn.id;
        }
      }
      goalStatuses.push({
        entityId: goalId,
        name: node.label,
        reachable: false,
        pathNodes: [],
        viaMethods: [],
        reason: `Unreachable from "${nearestId}" (gap ~${round1(nearestDist)}px exceeds maxJumpHeight=${round1(maxJumpHeight)}px / maxTotalReachX=${round1(maxTotalReachX)}px)`,
      });
    }
  }

  // Check for unreachable grapple anchors
  const unreachableAnchorIds: string[] = [];
  for (const anc of anchors) {
    let canLatch = false;
    for (const rid of reachableNodeIds) {
      const rn = nodes.find((n) => n.id === rid);
      if (!rn || rn.kind === 'goal') continue;
      const clampedX = Math.max(rn.x, Math.min(rn.x + rn.w, anc.cx));
      const jumpApexY = Math.max(anc.cy, rn.topY - maxJumpHeight * 0.85);
      if (Math.hypot(clampedX - anc.cx, jumpApexY - anc.cy) <= anc.anchorRadius) {
        canLatch = true;
        break;
      }
    }
    if (!canLatch) unreachableAnchorIds.push(anc.id);
  }

  // Detect soft-lock risks: a reachable non-goal surface that has NO path to any goal (when goals exist)
  const softLockRisks: string[] = [];
  if (goalStatuses.length > 0 && goalStatuses.some((g) => g.reachable)) {
    const revAdj = new Map<string, string[]>();
    for (const n of nodes) revAdj.set(n.id, []);
    for (const e of edges) revAdj.get(e.to)?.push(e.from);

    const canReachGoal = new Set<string>();
    const q: string[] = goalStatuses.filter((g) => g.reachable).map((g) => g.entityId);
    for (const gid of q) canReachGoal.add(gid);
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      for (const prev of revAdj.get(cur) ?? []) {
        if (!canReachGoal.has(prev)) {
          canReachGoal.add(prev);
          q.push(prev);
        }
      }
    }

    for (const rid of reachableNodeIds) {
      const rn = nodes.find((n) => n.id === rid);
      if (!rn || rn.kind === 'goal') continue;
      if (!canReachGoal.has(rid)) {
        softLockRisks.push(`Soft-lock pit detected: reachable surface "${rn.label}" (${rn.id}) has no escape path to any goal`);
      }
    }
  }

  const diagnostics: string[] = [];
  for (const gs of goalStatuses) {
    if (!gs.reachable) diagnostics.push(`Goal "${gs.entityId}": ${gs.reason}`);
  }
  for (const ancId of unreachableAnchorIds) {
    diagnostics.push(`GrappleAnchor "${ancId}" is outside latch radius from all reachable surfaces`);
  }
  for (const risk of softLockRisks) {
    diagnostics.push(risk);
  }

  const allGoalsReachable = goalStatuses.every((g) => g.reachable);
  const pass = allGoalsReachable && softLockRisks.length === 0;

  return {
    pass,
    hasActionMotor: true,
    heroEntityId: heroEntry.ent.id,
    startNodeId: startNode?.id ?? null,
    kinematics: {
      moveSpeed: round1(motor.moveSpeed),
      jumpVelocity: round1(motor.jumpVelocity),
      gravity: round1(motor.gravity),
      maxJumpHeight: round1(maxJumpHeight),
      jumpAirTimeSec: Math.round(jumpAirTimeSec * 1000) / 1000,
      maxJumpReachX: round1(maxJumpReachX),
      maxDashReachX: round1(maxDashReachX),
      maxTotalReachX: round1(maxTotalReachX),
      floorY: round1(motor.floorY),
    },
    nodes,
    edges,
    reachableNodeIds,
    unreachableNodeIds,
    goalStatuses,
    unreachableAnchorIds,
    softLockRisks,
    diagnostics,
  };
}

export interface EcsRoomAsciiReport {
  ok: boolean;
  roomId: string;
  roomName: string;
  cols: number;
  rows: number;
  tileSize: number;
  lines: string[];
  legend: Record<string, string>;
  portals: Array<{
    id: string;
    name: string;
    col: number;
    row: number;
    cols: number;
    rows: number;
    toRoomId: string;
    requiresGlobal?: string;
  }>;
  entities: Array<{
    id: string;
    name: string;
    tag: string;
    col: number;
    row: number;
    glyph: string;
  }>;
}

/**
 * Renders a compact, token-efficient 2D ASCII blueprint of a WorldMap room so AI agents
 * can inspect exact walls, floors, hazards, portals, and entity placements in ~150 tokens.
 */
export function renderRoomAscii(project: EcsProjectV2, roomId?: string): EcsRoomAsciiReport {
  const wm = project.worldMap;
  if (!wm || wm.rooms.length === 0) {
    return {
      ok: false,
      roomId: '',
      roomName: '',
      cols: 0,
      rows: 0,
      tileSize: 32,
      lines: [],
      legend: {},
      portals: [],
      entities: [],
    };
  }
  const room = (roomId ? wm.rooms.find((r) => r.id === roomId) : undefined) ?? wm.rooms.find((r) => r.id === wm.startRoomId) ?? wm.rooms[0];
  const ts = wm.tileSize;
  const grid: string[][] = [];
  for (let r = 0; r < room.rows; r++) {
    const rowChars: string[] = [];
    for (let c = 0; c < room.cols; c++) {
      const idx = r * room.cols + c;
      const wId = room.wall[idx] ?? 0;
      const dId = room.decor[idx] ?? 0;
      const gId = room.ground[idx] ?? 0;
      let ch = '.';
      if (wId > 0) {
        const wDef = getCastleTileDef(wId, wm.tileDefs);
        if (wDef?.unlockGlobal) ch = 'G';
        else if (wId === CASTLE_TILE_IDS.WALL_STAINED_GLASS) ch = 'W';
        else if (wId === CASTLE_TILE_IDS.WALL_BRICK) ch = 'B';
        else if (wId === CASTLE_TILE_IDS.WALL_LOW_PARAPET) ch = 'h';
        else ch = '#';
      } else if (dId > 0) {
        const dDef = getCastleTileDef(dId, wm.tileDefs);
        if (dDef?.hazard) ch = '^';
        else if (dId === CASTLE_TILE_IDS.DECOR_PORTAL_ARCH) ch = 'A';
        else ch = 'd';
      } else if (gId > 0) {
        const gDef = getCastleTileDef(gId, wm.tileDefs);
        if (gDef?.hazard) ch = '~';
        else if (gId === CASTLE_TILE_IDS.CARPET_V || gId === CASTLE_TILE_IDS.CARPET_H) ch = '=';
        else if (gId === CASTLE_TILE_IDS.STONE_STAIRS) ch = 'S';
        else if (gId === CASTLE_TILE_IDS.MAGIC_SEAL) ch = '*';
        else if (gId === CASTLE_TILE_IDS.IRON_GRATE) ch = '+';
        else ch = '.';
      }
      rowChars.push(ch);
    }
    grid.push(rowChars);
  }

  const roomPortals = wm.portals.filter((p) => p.fromRoomId === room.id);
  for (const p of roomPortals) {
    for (let rr = p.row; rr < p.row + p.rows; rr++) {
      for (let cc = p.col; cc < p.col + p.cols; cc++) {
        if (rr >= 0 && rr < room.rows && cc >= 0 && cc < room.cols) {
          if (grid[rr][cc] !== 'G') grid[rr][cc] = 'P';
        }
      }
    }
  }

  const interactionTags = new Set((wm.interactions ?? []).map((r) => r.tag));
  const aiProfiles = wm.aiProfiles ?? {};
  const entityList: EcsRoomAsciiReport['entities'] = [];

  for (const ent of project.entities) {
    const c = resolveEntityComponents(ent, project.prefabs);
    const tag = c.tag ?? 'prop';
    const isHero = tag === 'hero' || tag === 'player';
    const entRoom = ent.roomId ?? wm.startRoomId;
    if (entRoom !== room.id && !(isHero && room.id === wm.startRoomId)) continue;
    const cx = c.transform.x + (c.transform.w ?? ts) * 0.5;
    const cy = c.transform.y + (c.transform.h ?? ts) * 0.5;
    const col = Math.max(0, Math.min(room.cols - 1, Math.floor(cx / ts)));
    const row = Math.max(0, Math.min(room.rows - 1, Math.floor(cy / ts)));
    let glyph = 'o';
    if (isHero) glyph = '@';
    else if (aiProfiles[tag]?.isBoss) glyph = '!';
    else if (aiProfiles[tag]) glyph = 'E';
    else if (interactionTags.has(tag)) glyph = '?';
    else if (tag === 'torch' || tag === 'brazier') glyph = 't';
    grid[row][col] = glyph;
    entityList.push({ id: ent.id, name: ent.name, tag, col, row, glyph });
  }

  return {
    ok: true,
    roomId: room.id,
    roomName: room.name,
    cols: room.cols,
    rows: room.rows,
    tileSize: ts,
    lines: grid.map((r) => r.join('')),
    legend: {
      '.': 'walkable floor',
      '=': 'carpet',
      'S': 'stairs/bridge',
      '*': 'magic seal',
      '+': 'iron grate',
      '~': 'lava/hazard',
      '#': 'gothic wall',
      'B': 'brick wall',
      'W': 'stained glass',
      'h': 'low parapet',
      'G': 'locked gate (unlockGlobal)',
      '^': 'spike hazard',
      'P': 'portal zone',
      '@': 'hero',
      '!': 'boss',
      'E': 'enemy',
      '?': 'interactive prop',
      't': 'torch/light',
      'o': 'prop/pillar',
    },
    portals: roomPortals.map((p) => ({
      id: p.id,
      name: p.name,
      col: p.col,
      row: p.row,
      cols: p.cols,
      rows: p.rows,
      toRoomId: p.toRoomId,
      ...(p.requiresGlobal ? { requiresGlobal: p.requiresGlobal } : {}),
    })),
    entities: entityList,
  };
}

export interface EcsWorldMapReachabilityReport {
  pass: boolean;
  hasWorldMap: boolean;
  startRoomId: string;
  reachableRoomIds: string[];
  unreachableRoomIds: string[];
  unlockedGlobals: Record<string, number>;
  reachableInteractionIds: string[];
  unreachableInteractionIds: string[];
  reachableBossIds: string[];
  unreachableBossIds: string[];
  lockedPortals: Array<{ portalId: string; fromRoomId: string; toRoomId: string; requiresGlobal: string }>;
  softLockRisks: string[];
  diagnostics: string[];
}

/**
 * Deterministic Multi-Room BFS + Key/Switch Dependency Fixed-Point Solver.
 * Proves whether the Hero can physically walk across rooms, collect keys/triggers,
 * unlock gates & portals, and reach every room and Boss without soft-locks.
 */
export function analyzeWorldMapReachability(project: EcsProjectV2): EcsWorldMapReachabilityReport {
  const wm = project.worldMap;
  if (!wm || wm.rooms.length === 0) {
    return {
      pass: false,
      hasWorldMap: false,
      startRoomId: '',
      reachableRoomIds: [],
      unreachableRoomIds: [],
      unlockedGlobals: {},
      reachableInteractionIds: [],
      unreachableInteractionIds: [],
      reachableBossIds: [],
      unreachableBossIds: [],
      lockedPortals: [],
      softLockRisks: ['Project does not define a multi-room worldMap'],
      diagnostics: ['Call ensure_world_map or stamp_room_ascii first'],
    };
  }

  const ts = wm.tileSize;
  const roomMap = new Map(wm.rooms.map((r) => [r.id, r]));
  const startRoom = roomMap.get(wm.startRoomId) ?? wm.rooms[0];

  // Locate hero spawn
  const heroEnt = project.entities.find((e) => {
    const c = resolveEntityComponents(e, project.prefabs);
    return c.tag === 'hero' || c.tag === 'player' || Boolean(c.characterMotor2d);
  });
  const heroComp = heroEnt ? resolveEntityComponents(heroEnt, project.prefabs) : null;
  const startCol = heroComp
    ? Math.max(0, Math.min(startRoom.cols - 1, Math.floor((heroComp.transform.x + (heroComp.transform.w ?? ts) * 0.5) / ts)))
    : Math.floor(startRoom.cols * 0.5);
  const startRow = heroComp
    ? Math.max(0, Math.min(startRoom.rows - 1, Math.floor((heroComp.transform.y + (heroComp.transform.h ?? ts) * 0.5) / ts)))
    : Math.floor(startRoom.rows * 0.5);

  // Simulated globals starting from project.globals
  const globals: Record<string, number> = { ...project.globals };
  const roomSeeds = new Map<string, Array<[number, number]>>();
  roomSeeds.set(startRoom.id, [[startCol, startRow]]);

  const visitedByRoom = new Map<string, Uint8Array>();
  const triggeredInteractions = new Set<string>();
  const rulesByTag = new Map((wm.interactions ?? []).map((r) => [r.tag, r]));
  const aiProfiles = wm.aiProfiles ?? {};

  const floodRoom = (roomId: string): Uint8Array => {
    const room = roomMap.get(roomId)!;
    const vis = new Uint8Array(room.cols * room.rows);
    const seeds = roomSeeds.get(roomId) ?? [];
    const queue: number[] = [];
    for (const [sc, sr] of seeds) {
      if (sc < 0 || sr < 0 || sc >= room.cols || sr >= room.rows) continue;
      if (isRoomCellSolid(room, sc, sr, globals, wm.tileDefs)) continue;
      if (isRoomCellHazard(room, sc, sr, wm.tileDefs)) continue;
      const idx = sr * room.cols + sc;
      if (!vis[idx]) {
        vis[idx] = 1;
        queue.push(idx);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const c = idx % room.cols;
      const r = (idx / room.cols) | 0;
      const neighbors: Array<[number, number]> = [
        [c + 1, r],
        [c - 1, r],
        [c, r + 1],
        [c, r - 1],
      ];
      for (const [nc, nr] of neighbors) {
        if (nc < 0 || nr < 0 || nc >= room.cols || nr >= room.rows) continue;
        const nIdx = nr * room.cols + nc;
        if (vis[nIdx]) continue;
        if (isRoomCellSolid(room, nc, nr, globals, wm.tileDefs)) continue;
        if (isRoomCellHazard(room, nc, nr, wm.tileDefs)) continue;
        vis[nIdx] = 1;
        queue.push(nIdx);
      }
    }
    return vis;
  };

  const isCellVisited = (roomId: string, col: number, row: number): boolean => {
    const room = roomMap.get(roomId);
    const vis = visitedByRoom.get(roomId);
    if (!room || !vis || col < 0 || row < 0 || col >= room.cols || row >= room.rows) return false;
    return vis[row * room.cols + col] === 1;
  };

  const hasVisitedCells = (roomId: string): boolean => {
    const vis = visitedByRoom.get(roomId);
    if (!vis) return false;
    for (let i = 0; i < vis.length; i++) {
      if (vis[i] === 1) return true;
    }
    return false;
  };

  const isCellOrNeighborVisited = (roomId: string, col: number, row: number): boolean => {
    const room = roomMap.get(roomId);
    const vis = visitedByRoom.get(roomId);
    if (!room || !vis) return false;
    const offsets: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dc, dr] of offsets) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc >= 0 && nr >= 0 && nc < room.cols && nr < room.rows && vis[nr * room.cols + nc]) {
        return true;
      }
    }
    return false;
  };

  const canInteractAtCell = (room: (typeof wm.rooms)[number], col: number, row: number): boolean => {
    if (isCellVisited(room.id, col, row)) return true;
    if (isRoomCellSolid(room, col, row, globals, wm.tileDefs)) return false;
    return isCellOrNeighborVisited(room.id, col, row);
  };

  const canEnterPortal = (p: (typeof wm.portals)[number], fromRoom: (typeof wm.rooms)[number]): boolean => {
    for (let rr = p.row; rr < p.row + p.rows; rr++) {
      for (let cc = p.col; cc < p.col + p.cols; cc++) {
        if (isCellVisited(p.fromRoomId, cc, rr)) return true;
        if (
          !isRoomCellSolid(fromRoom, cc, rr, globals, wm.tileDefs) &&
          !isRoomCellHazard(fromRoom, cc, rr, wm.tileDefs) &&
          isCellOrNeighborVisited(p.fromRoomId, cc, rr)
        ) {
          return true;
        }
      }
    }
    return false;
  };

  // Fixed-point progression loop (handles chained keys -> portals -> switches -> sealed gates)
  const maxPasses = Math.max(32, wm.rooms.length * 4 + wm.portals.length * 2 + 16);
  for (let passIdx = 0; passIdx < maxPasses; passIdx++) {
    let progressed = false;

    for (const roomId of roomSeeds.keys()) {
      visitedByRoom.set(roomId, floodRoom(roomId));
    }

    // 1. Trigger any newly reachable interactive props
    for (const ent of project.entities) {
      if (triggeredInteractions.has(ent.id)) continue;
      const c = resolveEntityComponents(ent, project.prefabs);
      const rule = c.tag ? rulesByTag.get(c.tag) : undefined;
      if (!rule) continue;
      const rId = ent.roomId ?? wm.startRoomId;
      const room = roomMap.get(rId);
      if (!room) continue;
      const col = Math.max(0, Math.min(room.cols - 1, Math.floor((c.transform.x + (c.transform.w ?? ts) * 0.5) / ts)));
      const row = Math.max(0, Math.min(room.rows - 1, Math.floor((c.transform.y + (c.transform.h ?? ts) * 0.5) / ts)));
      if (!canInteractAtCell(room, col, row)) continue;

      triggeredInteractions.add(ent.id);
      progressed = true;
      if (rule.setGlobal) {
        globals[rule.setGlobal] = rule.setGlobalValue ?? 1;
      }
      if (rule.addGlobal) {
        const nextVal = (globals[rule.addGlobal] ?? 0) + (rule.addGlobalDelta ?? 1);
        globals[rule.addGlobal] = nextVal;
        const target = rule.thresholdTargetGlobal
          ? (globals[rule.thresholdTargetGlobal] || rule.thresholdCount || 1)
          : (rule.thresholdCount ?? 0);
        if (rule.thresholdUnlockGlobal && target > 0 && nextVal >= target) {
          globals[rule.thresholdUnlockGlobal] = 1;
        }
      }
    }

    // 2. Traverse any newly reachable unlocked portals
    for (const p of wm.portals) {
      const fromRoom = roomMap.get(p.fromRoomId);
      const toRoom = roomMap.get(p.toRoomId);
      if (!fromRoom || !toRoom) continue;
      const unlocked = !p.requiresGlobal || (globals[p.requiresGlobal] ?? 0) >= 1;
      if (!unlocked) continue;
      if (!canEnterPortal(p, fromRoom)) continue;
      const tc = Math.max(0, Math.min(toRoom.cols - 1, Math.floor(p.targetX / ts)));
      const tr = Math.max(0, Math.min(toRoom.rows - 1, Math.floor(p.targetY / ts)));
      const existing = roomSeeds.get(p.toRoomId) ?? [];
      if (!existing.some(([ec, er]) => ec === tc && er === tr)) {
        existing.push([tc, tr]);
        roomSeeds.set(p.toRoomId, existing);
        progressed = true;
      }
    }

    if (!progressed) break;
  }

  // Final flood with all unlocked globals
  for (const roomId of roomSeeds.keys()) {
    visitedByRoom.set(roomId, floodRoom(roomId));
  }

  const reachableRoomIds = wm.rooms.filter((r) => hasVisitedCells(r.id)).map((r) => r.id);
  const unreachableRoomIds = wm.rooms.filter((r) => !hasVisitedCells(r.id)).map((r) => r.id);
  const reachableInteractionIds: string[] = [];
  const unreachableInteractionIds: string[] = [];
  const reachableBossIds: string[] = [];
  const unreachableBossIds: string[] = [];
  const softLockRisks: string[] = [];
  const diagnostics: string[] = [];

  if (
    isRoomCellSolid(startRoom, startCol, startRow, globals, wm.tileDefs) ||
    isRoomCellHazard(startRoom, startCol, startRow, wm.tileDefs)
  ) {
    softLockRisks.push(
      `Hero spawn cell (${startCol},${startRow}) in start room "${startRoom.id}" is solid or hazardous`,
    );
  }

  const hasWinScript = (scriptRefs: readonly string[] | undefined): boolean => {
    if (!scriptRefs || scriptRefs.length === 0) return false;
    for (const sid of scriptRefs) {
      const s = project.scripts[sid];
      if (!s) continue;
      for (const rule of s.rules) {
        for (const op of rule.ops) {
          if (op.op === 'set_status' && op.status === 'won') return true;
        }
      }
    }
    return false;
  };

  const bossOrVictoryRoomIds = new Set<string>();

  for (const ent of project.entities) {
    const c = resolveEntityComponents(ent, project.prefabs);
    const tag = c.tag ?? '';
    const rId = ent.roomId ?? wm.startRoomId;
    const room = roomMap.get(rId);
    if (!room) continue;
    const col = Math.max(0, Math.min(room.cols - 1, Math.floor((c.transform.x + (c.transform.w ?? ts) * 0.5) / ts)));
    const row = Math.max(0, Math.min(room.rows - 1, Math.floor((c.transform.y + (c.transform.h ?? ts) * 0.5) / ts)));
    const reached = canInteractAtCell(room, col, row);

    if (rulesByTag.has(tag)) {
      if (reached) reachableInteractionIds.push(ent.id);
      else {
        unreachableInteractionIds.push(ent.id);
        softLockRisks.push(`Interactive entity "${ent.id}" (tag="${tag}") in room "${rId}" (${col},${row}) is unreachable`);
      }
    }
    if (aiProfiles[tag]?.isBoss) {
      if (reached) {
        reachableBossIds.push(ent.id);
        bossOrVictoryRoomIds.add(rId);
      } else {
        unreachableBossIds.push(ent.id);
        softLockRisks.push(`Boss "${ent.id}" in room "${rId}" (${col},${row}) is unreachable`);
      }
    } else if (
      reached &&
      (aiProfiles[tag]?.winOnDefeat ||
        tag === 'goal' ||
        tag === 'victory' ||
        hasWinScript(c.scripts))
    ) {
      bossOrVictoryRoomIds.add(rId);
    }
  }

  const lockedPortals: EcsWorldMapReachabilityReport['lockedPortals'] = [];
  const roomsWithOutgoingUnlockedPortal = new Set<string>();
  for (const p of wm.portals) {
    if (p.requiresGlobal && (globals[p.requiresGlobal] ?? 0) < 1) {
      lockedPortals.push({
        portalId: p.id,
        fromRoomId: p.fromRoomId,
        toRoomId: p.toRoomId,
        requiresGlobal: p.requiresGlobal,
      });
      softLockRisks.push(`Portal "${p.id}" requires global "${p.requiresGlobal}" which can never be unlocked`);
      continue;
    }
    const fromRoom = roomMap.get(p.fromRoomId);
    if (fromRoom && hasVisitedCells(p.fromRoomId)) {
      if (!canEnterPortal(p, fromRoom)) {
        softLockRisks.push(
          `Portal "${p.id}" in room "${p.fromRoomId}" (${p.col},${p.row}) is solid-walled or unreachable`,
        );
      } else if (p.toRoomId !== p.fromRoomId && roomMap.has(p.toRoomId)) {
        roomsWithOutgoingUnlockedPortal.add(p.fromRoomId);
      }
    }
  }

  for (const ur of unreachableRoomIds) {
    softLockRisks.push(`Room "${ur}" is unreachable from startRoom "${startRoom.id}"`);
  }

  // One-way dead-end room detection: reachable non-start room with no outgoing unlocked portal back to another room and no boss/victory trigger
  for (const rId of reachableRoomIds) {
    if (rId === startRoom.id) continue;
    if (!roomsWithOutgoingUnlockedPortal.has(rId) && !bossOrVictoryRoomIds.has(rId)) {
      softLockRisks.push(
        `One-way dead-end room "${rId}": reachable room has no outgoing unlocked portal to another room and no boss/victory trigger`,
      );
    }
  }

  for (const risk of softLockRisks) diagnostics.push(risk);

  return {
    pass: unreachableRoomIds.length === 0 && unreachableBossIds.length === 0 && lockedPortals.length === 0 && softLockRisks.length === 0,
    hasWorldMap: true,
    startRoomId: startRoom.id,
    reachableRoomIds,
    unreachableRoomIds,
    unlockedGlobals: globals,
    reachableInteractionIds,
    unreachableInteractionIds,
    reachableBossIds,
    unreachableBossIds,
    lockedPortals,
    softLockRisks,
    diagnostics,
  };
}
