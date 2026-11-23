import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { JuiceSystem, SquashSpring } from '../sim/JuiceSystem.ts';
import type {
  EntityDesc,
  HudPrimitiveDesc,
  LightDesc,
  PerspectiveProjectionDesc,
  RenderSceneSnapshot,
} from '../types/WorldTypes.ts';
import { MAX_VERLET_NODES } from './ComponentStore.ts';
import type { EcsProjectV2 } from './EcsProjectSchema.ts';
import { MAX_ECS_ENTITIES, type EcsWorld } from './EcsWorld.ts';
import type { EcsWorldMapController } from './EcsWorldMapController.ts';
import { INVALID_ENTITY, unpackEntityIndex } from './EntityManager.ts';

export interface EcsPopupSlot {
  active: boolean;
  text: string;
  x: number;
  y: number;
  timer: number;
  color: string;
}

export interface EcsSnapshotFrameState {
  project: EcsProjectV2;
  world: EcsWorld;
  worldMapCtrl: EcsWorldMapController;
  juice: JuiceSystem;
  squashPool: readonly SquashSpring[];
  squashActive: Uint8Array;
  popups: readonly EcsPopupSlot[];
  activeDimensionMask: number;
  debugOverlay: boolean;
  elapsedSec: number;
  fpYawRad: number;
  fpViewerX: number;
  fpViewerY: number;
  alpha: number;
  onSyncWorldMapRoom: () => void;
  onSyncStats: () => void;
}

/**
 * Pure DOM-free, Zero-GC RenderSceneSnapshot Projector for `EcsCartridgeRuntime`.
 * Owns all pre-allocated render entity / light / HUD pools and 2.5D DDA wall buffers,
 * decoupling 60Hz ECS simulation logic from GPU snapshot projection.
 */
export class EcsSnapshotProjector {
  private readonly fpWallGrid = new Uint8Array(64 * 64);
  private readonly fpWallSpriteIds: readonly SpriteId[] = ['hd_arena_tile', 'hd_arena_tile', 'hd_turret_prism'];
  private readonly fpPerspDesc: PerspectiveProjectionDesc;

  private readonly entityPool: EntityDesc[] = [];
  public readonly outEntities: EntityDesc[] = [];
  private readonly lightPool: LightDesc[] = [];
  public readonly outLights: LightDesc[] = [];
  private readonly hudPool: HudPrimitiveDesc[] = [];
  public readonly outHud: HudPrimitiveDesc[] = [];

  constructor(project: EcsProjectV2, viewW: number, viewH: number) {
    this.fpPerspDesc = {
      mode: 'first_person',
      blend01: 1,
      viewerX: 56,
      viewerY: 140,
      viewerYawRad: 0.04,
      fovRad: ((project.projection?.fovDeg ?? 68) * Math.PI) / 180,
      maxDist: Math.max(viewW, viewH) * 1.45,
      tileSize: 32,
      wallCols: 20,
      wallRows: 12,
      wallGrid: this.fpWallGrid,
      wallSpriteIds: this.fpWallSpriteIds,
      ceilTopColor: project.atmosphere.skyTop,
      ceilHorizonColor: '#24344f',
      floorHorizonColor: '#283852',
      floorBottomColor: '#111827',
      fogColor: '#18243b',
      wallHeightScale: project.projection?.wallHeightScale ?? 1.0,
      columnStepPx: 2,
      showMinimap: true,
    };
  }

  private acquireEntity(idx: number): EntityDesc {
    let slot = this.entityPool[idx];
    if (!slot) {
      slot = { id: '', sprite: 'solid', x: 0, y: 0, w: 16, h: 16 };
      this.entityPool[idx] = slot;
    }
    return slot;
  }

  private acquireLight(idx: number): LightDesc {
    let slot = this.lightPool[idx];
    if (!slot) {
      slot = { x: 0, y: 0, radius: 32, color: '#ffffff', intensity: 1 };
      this.lightPool[idx] = slot;
    }
    return slot;
  }

  private acquireHud(idx: number): HudPrimitiveDesc {
    let slot = this.hudPool[idx];
    if (!slot) {
      slot = { kind: 'box', x: 0, y: 0, w: 0, h: 0, color: '#ffffff' };
      this.hudPool[idx] = slot;
    }
    return slot;
  }

  public project(snap: RenderSceneSnapshot, st: EcsSnapshotFrameState): RenderSceneSnapshot {
    const core = st.world.core;
    const c = core.components;
    const vp = snap.viewport!;
    const alpha = st.alpha;

    this.outEntities.length = 0;
    this.outLights.length = 0;
    this.outHud.length = 0;

    let eCount = 0;
    let lCount = 0;
    let hCount = 0;

    const projCfg = st.project.projection;
    const projMode = projCfg?.mode ?? 'hd2d_iso';
    const elevScale = projCfg?.elevationScale ?? 1.0;
    const dimGhostAlpha = projCfg?.inactiveDimAlpha ?? 0.16;

    if (snap.hd2dDepth) {
      const isHd2d = projMode === 'hd2d_iso' || projMode === 'hd2d_3d';
      snap.hd2dDepth.enabled = isHd2d;
      snap.hd2dDepth.mode3d = projMode === 'hd2d_3d';
      snap.hd2dDepth.sortByDepthY = isHd2d;
      snap.hd2dDepth.perspectiveSkew = projMode === 'hd2d_iso' ? (projCfg?.perspectiveSkew ?? 0.055) : 0;
      snap.hd2dDepth.pitchDeg = projCfg?.pitchDeg ?? 42;
      snap.hd2dDepth.fovDeg = projCfg?.fovDeg ?? 38;
      snap.hd2dDepth.wallHeightScale = projCfg?.wallHeightScale ?? 1.25;
      snap.hd2dDepth.billboardTiltDeg = projCfg?.billboardTiltDeg ?? 12;
      snap.hd2dDepth.obliqueShadowAlpha = projCfg?.obliqueShadowAlpha ?? 0.42;
      snap.hd2dDepth.tiltShiftBlur = st.project.atmosphere.tiltShiftBlur ?? 0;
      snap.hd2dDepth.tiltShiftFocusY = st.project.atmosphere.tiltShiftFocusY ?? 0.52;
    }

    // 1a. Project Material (PBR-Lite Sprite) entities from sparse-set store with Spatial3D elevation & realm masking
    const matStore = core.getStore(c.Material);
    const matCount = matStore.size();
    let heroViewerX = st.fpViewerX;
    let heroViewerY = st.fpViewerY;
    let foundHero = false;

    for (let i = 0; i < matCount; i++) {
      const h = matStore.getDenseEntityAt(i);
      const mat = matStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;
      const tag = core.getComponent(h, c.Tag);
      const hp = core.getComponent(h, c.Health);
      const sp = core.getComponent(h, c.Spatial3D);
      const motor = core.getComponent(h, c.CharacterMotor2D);
      const anim = core.getComponent(h, c.Animator);

      const entMask = sp ? sp.dimensionMask : 3;
      const inActiveRealm = (entMask & st.activeDimensionMask) !== 0;
      if (!inActiveRealm && dimGhostAlpha <= 0.01) continue;

      const rx = tr.prevX + (tr.x - tr.prevX) * alpha;
      const ry = tr.prevY + (tr.y - tr.prevY) * alpha;
      const rz = sp ? sp.prevZ + (sp.z - sp.prevZ) * alpha : 0;
      const isHeroTag = tag?.tag === 'hero' || tag?.tag === 'player';
      if (isHeroTag && !foundHero) {
        heroViewerX = rx + tr.w * 0.5;
        heroViewerY = ry + tr.h * 0.5;
        foundHero = true;
      }

      // Procedural living breathing, subtle stride lean & spring squash-and-stretch (Zero-GC)
      const entIdx = unpackEntityIndex(h);
      const isLiving = Boolean(hp || motor || anim);
      let sxMult = 1;
      let syMult = 1;
      let skewX = 0;
      if (entIdx >= 0 && entIdx < MAX_ECS_ENTITIES && st.squashActive[entIdx] !== 0) {
        const sq = st.squashPool[entIdx];
        sxMult *= sq.scaleX;
        syMult *= sq.scaleY;
      }
      if (isLiving && inActiveRealm) {
        const moveDx = tr.x - tr.prevX;
        const moveDy = tr.y - tr.prevY;
        const moveMag = Math.hypot(moveDx, moveDy);
        const phase = st.elapsedSec * (moveMag > 0.15 ? 11.5 : 3.2) + entIdx * 1.73;
        const amp = moveMag > 0.15 ? 0.042 : 0.024;
        const breath = Math.sin(phase) * amp;
        sxMult *= 1 - breath * 0.65;
        syMult *= 1 + breath;
        if (moveMag > 0.15) {
          skewX = Math.max(-0.12, Math.min(0.12, moveDx * 0.025));
        }
      }

      const dst = this.acquireEntity(eCount++);
      dst.id = tag?.entityId ?? '';
      dst.sprite = mat.spriteId;
      dst.x = rx;
      dst.y = ry;
      dst.w = tr.w;
      dst.h = tr.h;
      dst.rot = tr.rot;
      dst.scaleX = tr.scaleX * sxMult;
      dst.scaleY = tr.scaleY * syMult;
      dst.skewX = skewX;
      dst.anchorY = isLiving ? 0.88 : 0.5;
      dst.flipX = mat.flipX;
      dst.tint = inActiveRealm ? mat.tint : '#64748b';
      dst.alpha = inActiveRealm ? mat.alpha : mat.alpha * dimGhostAlpha;
      dst.additive = false;
      dst.paletteRow = mat.paletteRow;
      dst.flash = hp ? hp.hitFlash : 0;
      dst.castShadow = mat.castShadow && inActiveRealm;
      dst.shadowRadius = sp ? tr.w * 0.42 * sp.shadowScale : undefined;
      dst.elevationZ = projMode === 'ortho_2d' ? 0 : rz * elevScale;
      dst.roughness = mat.roughness;
      dst.metallic = mat.metallic;
      dst.emissive = inActiveRealm ? mat.emissive : 0;
      dst.hideInFirstPerson = isHeroTag || !inActiveRealm || core.hasComponent(h, c.RhythmLane);
      dst.sortY = ry + tr.h + tr.zOrder * 1000 + rz * 0.05;
      this.outEntities.push(dst);
    }

    // 1a2. Active top-down melee slash arc VFX (100% data-driven from worldMap.heroConfig)
    if (st.worldMapCtrl.hasWorldMap()) {
      const slash = st.worldMapCtrl.getSlashVisual();
      if (slash.active && slash.sprite) {
        const sEnt = this.acquireEntity(eCount++);
        sEnt.id = '__melee_slash__';
        sEnt.sprite = slash.sprite;
        sEnt.x = slash.x - 22;
        sEnt.y = slash.y - 22;
        sEnt.w = 44;
        sEnt.h = 44;
        sEnt.rot = slash.rot;
        sEnt.scaleX = 1.25;
        sEnt.scaleY = 1.25;
        sEnt.flipX = false;
        sEnt.tint = slash.color;
        sEnt.alpha = Math.min(1, slash.alpha * 1.15);
        sEnt.additive = true;
        sEnt.paletteRow = 0;
        sEnt.flash = 0.25;
        sEnt.castShadow = false;
        sEnt.elevationZ = 10;
        sEnt.roughness = 0.12;
        sEnt.metallic = 0.9;
        sEnt.emissive = 1.35;
        sEnt.sortY = slash.y + 44;
        this.outEntities.push(sEnt);
      }
      st.onSyncWorldMapRoom();
    }

    // 1b. Project Dynamic LightSource entities (respecting active realm & Z lift)
    const lightStore = core.getStore(c.LightSource);
    const lightCount = Math.min(24, lightStore.size());
    for (let i = 0; i < lightCount; i++) {
      const h = lightStore.getDenseEntityAt(i);
      const ls = lightStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;
      const sp = core.getComponent(h, c.Spatial3D);
      const entMask = sp ? sp.dimensionMask : 3;
      const inActiveRealm = (entMask & st.activeDimensionMask) !== 0;
      if (!inActiveRealm && dimGhostAlpha <= 0.01) continue;

      const rx = tr.prevX + (tr.x - tr.prevX) * alpha;
      const ry = tr.prevY + (tr.y - tr.prevY) * alpha;
      const rz = sp ? sp.prevZ + (sp.z - sp.prevZ) * alpha : 0;

      const l = this.acquireLight(lCount++);
      l.x = rx + tr.w * 0.5;
      l.y = ry + tr.h * 0.5 - (projMode === 'ortho_2d' ? 0 : rz * elevScale);
      l.radius = ls.radius;
      l.color = ls.color;
      l.intensity = inActiveRealm ? ls.intensity : ls.intensity * 0.15;
      l.falloffPower = ls.falloffPower;
      this.outLights.push(l);
    }

    // 1b2. First-Person 2.5D DDA Raycast & Billboard Projection (Zero-GC pre-allocated wallGrid)
    if (projMode === 'first_person_25d') {
      const tileSize = 32;
      const cols = Math.max(8, Math.min(64, Math.ceil(vp.width / tileSize)));
      const rows = Math.max(8, Math.min(64, Math.ceil(vp.height / tileSize)));
      const totalCells = cols * rows;
      for (let i = 0; i < totalCells; i++) this.fpWallGrid[i] = 0;
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        this.fpWallGrid[cIdx] = 1;
        this.fpWallGrid[(rows - 1) * cols + cIdx] = 1;
      }
      for (let rIdx = 0; rIdx < rows; rIdx++) {
        this.fpWallGrid[rIdx * cols] = 1;
        this.fpWallGrid[rIdx * cols + (cols - 1)] = 1;
      }
      const colStore = core.getStore(c.Collider);
      const colCount = colStore.size();
      for (let i = 0; i < colCount; i++) {
        const col = colStore.getDenseDataAt(i);
        if (!col.isSolid) continue;
        const sh = colStore.getDenseEntityAt(i);
        const sSp = core.getComponent(sh, c.Spatial3D);
        const sMask = sSp ? sSp.dimensionMask : 3;
        if ((sMask & st.activeDimensionMask) === 0) continue;
        const str = core.getComponent(sh, c.Transform2D);
        if (!str) continue;
        const c0 = Math.max(1, Math.min(cols - 2, Math.floor(str.x / tileSize)));
        const c1 = Math.max(1, Math.min(cols - 2, Math.floor((str.x + str.w - 1) / tileSize)));
        const r0 = Math.max(1, Math.min(rows - 2, Math.floor(str.y / tileSize)));
        const r1 = Math.max(1, Math.min(rows - 2, Math.floor((str.y + str.h - 1) / tileSize)));
        for (let rr = r0; rr <= r1; rr++) {
          for (let cc = c0; cc <= c1; cc++) {
            this.fpWallGrid[rr * cols + cc] = 2;
          }
        }
      }
      const vc = Math.max(1, Math.min(cols - 2, Math.floor(heroViewerX / tileSize)));
      const vr = Math.max(1, Math.min(rows - 2, Math.floor(heroViewerY / tileSize)));
      this.fpWallGrid[vr * cols + vc] = 0;

      this.fpPerspDesc.viewerX = Math.max(tileSize * 1.25, Math.min((cols - 1.25) * tileSize, heroViewerX));
      this.fpPerspDesc.viewerY = Math.max(tileSize * 1.25, Math.min((rows - 1.25) * tileSize, heroViewerY));
      this.fpPerspDesc.viewerYawRad = st.fpYawRad;
      this.fpPerspDesc.fovRad = ((projCfg?.fovDeg ?? 68) * Math.PI) / 180;
      this.fpPerspDesc.maxDist = Math.max(vp.width, vp.height) * 1.45;
      this.fpPerspDesc.wallHeightScale = projCfg?.wallHeightScale ?? 1.0;
      this.fpPerspDesc.tileSize = tileSize;
      this.fpPerspDesc.wallCols = cols;
      this.fpPerspDesc.wallRows = rows;
      this.fpPerspDesc.ceilTopColor = st.project.atmosphere.skyTop;
      this.fpPerspDesc.ceilHorizonColor = '#24344f';
      this.fpPerspDesc.fogColor = '#18243b';
      snap.perspective = this.fpPerspDesc;
    } else {
      snap.perspective = undefined;
    }

    // 1c. Health bars above damaged enemies
    const hpStore = core.getStore(c.Health);
    const hpCount = hpStore.size();
    for (let i = 0; i < hpCount; i++) {
      const h = hpStore.getDenseEntityAt(i);
      const hp = hpStore.getDenseDataAt(i);
      if (hp.team !== 2 || hp.hp >= hp.maxHp) continue;
      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;
      const rx = tr.prevX + (tr.x - tr.prevX) * alpha;
      const ry = tr.prevY + (tr.y - tr.prevY) * alpha;

      const bar = this.acquireHud(hCount++);
      bar.kind = 'bar';
      bar.x = rx;
      bar.y = ry - 6;
      bar.w = Math.max(14, tr.w);
      bar.h = 3;
      bar.ratio = Math.max(0, Math.min(1, hp.hp / Math.max(1, hp.maxHp)));
      bar.color = '#ff5d8f';
      bar.bgColor = '#141026';
      bar.alpha = 0.92;
      bar.worldSpace = true;
      this.outHud.push(bar);
    }

    // 1d. Project VerletChain ropes/capes, GrappleAnchor tethers & TriggerZone overlays
    const chainStore = core.getStore(c.VerletChain);
    const chainCount = chainStore.size();
    for (let i = 0; i < chainCount; i++) {
      const chain = chainStore.getDenseDataAt(i);
      if (!chain.initialized) continue;
      const nodes = Math.max(2, Math.min(MAX_VERLET_NODES, Math.round(chain.nodeCount)));
      for (let k = 0; k < nodes - 1; k++) {
        const seg = this.acquireHud(hCount++);
        seg.kind = 'aim_line';
        seg.x = chain.posX[k];
        seg.y = chain.posY[k];
        seg.x2 = chain.posX[k + 1];
        seg.y2 = chain.posY[k + 1];
        seg.w = chain.thickness;
        seg.h = chain.thickness;
        seg.color = chain.color;
        seg.alpha = 0.92;
        seg.worldSpace = true;
        this.outHud.push(seg);
      }
    }

    const anchorStore = core.getStore(c.GrappleAnchor);
    const anchorCount = anchorStore.size();
    for (let i = 0; i < anchorCount; i++) {
      const ah = anchorStore.getDenseEntityAt(i);
      const anchor = anchorStore.getDenseDataAt(i);
      const atr = core.getComponent(ah, c.Transform2D);
      if (!atr) continue;
      const ax = atr.x + atr.w * 0.5;
      const ay = atr.y + atr.h * 0.5;

      const marker = this.acquireHud(hCount++);
      marker.kind = 'box';
      marker.x = ax - 4;
      marker.y = ay - 4;
      marker.w = 8;
      marker.h = 8;
      marker.color = anchor.activeTargetHandle !== INVALID_ENTITY ? '#fbbf24' : '#38bdf8';
      marker.alpha = anchor.enabled ? 0.72 : 0.25;
      marker.worldSpace = true;
      this.outHud.push(marker);

      if (anchor.activeTargetHandle !== INVALID_ENTITY && core.entities.isAlive(anchor.activeTargetHandle)) {
        const ttr = core.getComponent(anchor.activeTargetHandle, c.Transform2D);
        if (ttr) {
          const rope = this.acquireHud(hCount++);
          rope.kind = 'aim_line';
          rope.x = ax;
          rope.y = ay;
          rope.x2 = ttr.x + ttr.w * 0.5;
          rope.y2 = ttr.y + ttr.h * 0.5;
          rope.w = 2;
          rope.h = 2;
          rope.color = '#fbbf24';
          rope.alpha = 0.95;
          rope.worldSpace = true;
          this.outHud.push(rope);
        }
      }
    }

    const zoneStore = core.getStore(c.TriggerZone);
    const zoneCount = zoneStore.size();
    for (let i = 0; i < zoneCount; i++) {
      const zh = zoneStore.getDenseEntityAt(i);
      const zone = zoneStore.getDenseDataAt(i);
      const ztr = core.getComponent(zh, c.Transform2D);
      if (!ztr) continue;
      const zcx = ztr.x + ztr.w * 0.5;
      const zcy = ztr.y + ztr.h * 0.5;
      const zw = zone.shape === 'circle' ? zone.radius * 2 : zone.width > 0 ? zone.width : ztr.w;
      const zhPx = zone.shape === 'circle' ? zone.radius * 2 : zone.height > 0 ? zone.height : ztr.h;
      const box = this.acquireHud(hCount++);
      box.kind = 'box';
      box.x = zcx - zw * 0.5;
      box.y = zcy - zhPx * 0.5;
      box.w = zw;
      box.h = zhPx;
      box.color = zone.overlapCount > 0 ? '#4ade80' : '#38bdf8';
      box.alpha = zone.overlapCount > 0 ? 0.28 : st.debugOverlay ? 0.22 : 0.12;
      box.worldSpace = true;
      this.outHud.push(box);
    }

    // 1e. Optional Collider debug overlay
    if (st.debugOverlay) {
      const colStore = core.getStore(c.Collider);
      const colCount = colStore.size();
      for (let i = 0; i < colCount; i++) {
        const h = colStore.getDenseEntityAt(i);
        const tr = core.getComponent(h, c.Transform2D);
        if (!tr) continue;
        const hp = core.getComponent(h, c.Health);
        const rx = tr.prevX + (tr.x - tr.prevX) * alpha;
        const ry = tr.prevY + (tr.y - tr.prevY) * alpha;
        const dbg = this.acquireHud(hCount++);
        dbg.kind = 'box';
        dbg.x = rx;
        dbg.y = ry;
        dbg.w = tr.w;
        dbg.h = tr.h;
        dbg.color = hp?.team === 2 ? '#ff5d8f' : '#38bdf8';
        dbg.alpha = 0.25;
        dbg.worldSpace = true;
        this.outHud.push(dbg);
      }
    }

    // 2. Render Waypoint Paths
    for (const pts of st.world.paths.values()) {
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = this.acquireHud(hCount++);
        seg.kind = 'aim_line';
        seg.x = pts[i].x + 8;
        seg.y = pts[i].y + 8;
        seg.x2 = pts[i + 1].x + 8;
        seg.y2 = pts[i + 1].y + 8;
        seg.w = 2;
        seg.h = 2;
        seg.color = st.debugOverlay ? '#f59e0b' : '#475569';
        seg.alpha = st.debugOverlay ? 0.72 : 0.35;
        seg.worldSpace = true;
        this.outHud.push(seg);
      }
    }

    // 3. Render Rhythm Track & Judgment Line when enabled
    const rt = st.project.rhythmTrack;
    if (rt?.enabled) {
      const trackH = rt.laneCount * rt.laneSpacing + 14;
      const bg = this.acquireHud(hCount++);
      bg.kind = 'box';
      bg.x = 12;
      bg.y = rt.yTop - 8;
      bg.w = vp.width - 24;
      bg.h = trackH;
      bg.color = '#0b1120';
      bg.alpha = 0.76;
      bg.worldSpace = false;
      this.outHud.push(bg);

      for (let l = 0; l < rt.laneCount; l++) {
        const ly = rt.yTop + l * rt.laneSpacing;
        const laneLine = this.acquireHud(hCount++);
        laneLine.kind = 'box';
        laneLine.x = 20;
        laneLine.y = ly + 6;
        laneLine.w = vp.width - 40;
        laneLine.h = 2;
        laneLine.color = rt.laneColors[l] ?? '#38bdf8';
        laneLine.alpha = 0.32;
        laneLine.worldSpace = false;
        this.outHud.push(laneLine);

        const ring = this.acquireHud(hCount++);
        ring.kind = 'box';
        ring.x = rt.judgeX - 7;
        ring.y = ly - 1;
        ring.w = 14;
        ring.h = 14;
        ring.color = rt.laneColors[l] ?? '#ffd447';
        ring.alpha = 0.55;
        ring.worldSpace = false;
        this.outHud.push(ring);

        const lbl = this.acquireHud(hCount++);
        lbl.kind = 'text';
        lbl.x = 26;
        lbl.y = ly + 2;
        lbl.w = 0;
        lbl.h = 0;
        lbl.text = rt.laneLabels[l] ?? `${l + 1}`;
        lbl.scale = 1;
        lbl.align = 'left';
        lbl.color = rt.laneColors[l] ?? '#ffffff';
        lbl.shadowColor = '#090d16';
        lbl.alpha = 0.95;
        lbl.worldSpace = false;
        this.outHud.push(lbl);
      }

      const jBar = this.acquireHud(hCount++);
      jBar.kind = 'box';
      jBar.x = rt.judgeX - 1;
      jBar.y = rt.yTop - 6;
      jBar.w = 2;
      jBar.h = trackH - 4;
      jBar.color = '#ffd447';
      jBar.alpha = 0.9;
      jBar.worldSpace = false;
      this.outHud.push(jBar);
    }

    // 4. Data-driven HUD Gauges bound to ECS Globals
    for (let i = 0; i < st.project.hud.length; i++) {
      const g = st.project.hud[i];
      const val = g.globalKey ? st.world.getGlobal(g.globalKey) : 0;
      if (g.kind === 'bar') {
        const bar = this.acquireHud(hCount++);
        bar.kind = 'bar';
        bar.x = g.x;
        bar.y = g.y;
        bar.w = g.w ?? 96;
        bar.h = g.h ?? 8;
        bar.ratio = Math.max(0, Math.min(1, val / Math.max(1, g.maxVal ?? 100)));
        bar.color = g.color;
        bar.bgColor = g.bgColor ?? '#0f172a';
        bar.alpha = 0.92;
        bar.worldSpace = false;
        this.outHud.push(bar);

        const lbl = this.acquireHud(hCount++);
        lbl.kind = 'text';
        lbl.x = g.x;
        lbl.y = g.y - 10;
        lbl.w = 0;
        lbl.h = 0;
        lbl.text = `${g.label} ${Math.round(val)}`;
        lbl.scale = 1;
        lbl.align = 'left';
        lbl.color = g.color;
        lbl.shadowColor = '#090d16';
        lbl.alpha = 0.95;
        lbl.worldSpace = false;
        this.outHud.push(lbl);
      } else {
        const txt = this.acquireHud(hCount++);
        txt.kind = 'text';
        txt.x = g.x;
        txt.y = g.y;
        txt.w = 0;
        txt.h = 0;
        txt.text = g.globalKey ? `${g.label} ${Math.round(val)}` : g.label;
        txt.scale = 1;
        txt.align = 'left';
        txt.color = g.color;
        txt.shadowColor = '#090d16';
        txt.alpha = 0.95;
        txt.worldSpace = false;
        this.outHud.push(txt);
      }
    }

    // 5. Floating Judgment / Combat Popups
    for (let i = 0; i < st.popups.length; i++) {
      const p = st.popups[i];
      if (!p.active) continue;
      const slot = this.acquireHud(hCount++);
      slot.kind = 'text';
      slot.x = p.x;
      slot.y = p.y;
      slot.w = 0;
      slot.h = 0;
      slot.text = p.text;
      slot.scale = 1;
      slot.align = 'center';
      slot.color = p.color;
      slot.shadowColor = '#090d16';
      slot.alpha = Math.min(1, p.timer * 2);
      slot.worldSpace = true;
      this.outHud.push(slot);
    }

    // 5b. Generic Multi-Room Top-Down Adventure HUD
    if (st.worldMapCtrl.hasWorldMap()) {
      lCount = st.worldMapCtrl.appendAmbientTileLights(
        (idx) => this.acquireLight(idx),
        this.outLights,
        lCount,
      );
      const heroHp = st.worldMapCtrl.getHeroHp();
      snap.hearts = heroHp.hp;
      snap.maxHearts = heroHp.maxHp;

      const hpBar = this.acquireHud(hCount++);
      hpBar.kind = 'bar';
      hpBar.x = 14;
      hpBar.y = 14;
      hpBar.w = 104;
      hpBar.h = 8;
      hpBar.ratio = Math.max(0, Math.min(1, heroHp.hp / Math.max(1, heroHp.maxHp)));
      hpBar.color = '#ef4444';
      hpBar.bgColor = '#1e1b2e';
      hpBar.alpha = 0.95;
      hpBar.worldSpace = false;
      this.outHud.push(hpBar);

      const hpTxt = this.acquireHud(hCount++);
      hpTxt.kind = 'text';
      hpTxt.x = 126;
      hpTxt.y = 14;
      hpTxt.w = 0;
      hpTxt.h = 0;
      const roomName = st.worldMapCtrl.getActiveRoom()?.name ?? '';
      hpTxt.text = `HP ${heroHp.hp}/${heroHp.maxHp}`;
      hpTxt.scale = 1;
      hpTxt.align = 'left';
      hpTxt.color = '#fde68a';
      hpTxt.shadowColor = '#090d16';
      hpTxt.alpha = 0.95;
      hpTxt.worldSpace = false;
      this.outHud.push(hpTxt);

      const roomLbl = this.acquireHud(hCount++);
      roomLbl.kind = 'text';
      roomLbl.x = vp.width - 14;
      roomLbl.y = 14;
      roomLbl.w = 0;
      roomLbl.h = 0;
      roomLbl.text = roomName.toUpperCase();
      roomLbl.scale = 1;
      roomLbl.align = 'right';
      roomLbl.color = '#cbd5e1';
      roomLbl.shadowColor = '#090d16';
      roomLbl.alpha = 0.9;
      roomLbl.worldSpace = false;
      this.outHud.push(roomLbl);

      const boss = st.worldMapCtrl.getBossInfo();
      snap.bossHp = boss.hp;
      snap.bossMaxHp = boss.maxHp;
      if (boss.maxHp > 0 && boss.hp > 0) {
        const bw = Math.min(280, vp.width - 80);
        const bx = Math.round((vp.width - bw) * 0.5);
        const bBar = this.acquireHud(hCount++);
        bBar.kind = 'bar';
        bBar.x = bx;
        bBar.y = vp.height - 22;
        bBar.w = bw;
        bBar.h = 9;
        bBar.ratio = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
        bBar.color = '#dc2626';
        bBar.bgColor = '#18101c';
        bBar.alpha = 0.96;
        bBar.worldSpace = false;
        this.outHud.push(bBar);

        const bLbl = this.acquireHud(hCount++);
        bLbl.kind = 'text';
        bLbl.x = Math.round(vp.width * 0.5);
        bLbl.y = vp.height - 34;
        bLbl.w = 0;
        bLbl.h = 0;
        const bossTitle = (boss.name || 'BOSS').toUpperCase();
        bLbl.text = `${bossTitle}  ${boss.hp}/${boss.maxHp}`;
        bLbl.scale = 1;
        bLbl.align = 'center';
        bLbl.color = '#fbbf24';
        bLbl.shadowColor = '#090d16';
        bLbl.alpha = 0.98;
        bLbl.worldSpace = false;
        this.outHud.push(bLbl);
      }

      const activeBanner = st.worldMapCtrl.getRoomBanner();
      if (activeBanner) {
        snap.statusBanner = activeBanner;
      }

      if (st.project.atmosphere.shadowOcclusion !== false) {
        snap.occlusion = st.worldMapCtrl.getOcclusionGrid(
          st.project.atmosphere.shadowStrength ?? 0.85,
          st.project.atmosphere.shadowSoftness ?? 0.36,
        );
      } else {
        snap.occlusion = undefined;
      }
    } else {
      snap.occlusion = undefined;
    }

    // Apply JuiceSystem camera shake/recoil & screen flash
    if (!st.worldMapCtrl.isEditorCameraOverride()) {
      const baseCamX = st.worldMapCtrl.hasWorldMap() ? st.worldMapCtrl.cameraX : 0;
      const baseCamY = st.worldMapCtrl.hasWorldMap() ? st.worldMapCtrl.cameraY : 0;
      snap.cameraX = baseCamX + st.juice.shakeX;
      snap.cameraY = baseCamY + st.juice.shakeY;
    }
    snap.screenFlashAlpha = st.juice.flashAlpha;
    snap.screenFlashColor = st.juice.flashColor;

    st.onSyncStats();
    return snap;
  }
}
