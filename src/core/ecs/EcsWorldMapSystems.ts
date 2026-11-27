import { hasGridLineOfSight } from '../math/Visibility2D.ts';
import { findAStarNextCell, type PathfinderWorkspace } from '../sim/GridPathfinder.ts';
import type { SimEvent } from '../types/WorldTypes.ts';
import type { EcsCinematicDirector } from './EcsCinematicDirector.ts';
import type { EcsProjectV2 } from './EcsProjectSchema.ts';
import {
  isRoomCellSolid,
  type EcsMapInteractionRule,
  type EcsMapRoomDef,
  type EcsTopDownAiProfile,
} from './EcsTilemapTypes.ts';
import type { RoomVoxelVolume } from './EcsVoxelVolume.ts';
import type { EcsWorld } from './EcsWorld.ts';
import {
  moveWithTileCollisionPure,
  updateActorVoxelElevationPure,
  type WorldMapStepCallbacks,
} from './EcsWorldMapPhysics.ts';

export interface WorldMapCombatState {
  cameraX: number;
  cameraY: number;
  facingX: number;
  facingY: number;
  dashTimer: number;
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
  slashCooldown: number;
  slashActiveTimer: number;
  slashX: number;
  slashY: number;
  heroInvulnTimer: number;
  portalCooldown: number;
  walkAnimAccum: number;
  footstepTimer: number;
  bossName: string;
  bossMaxHp: number;
  bossHp: number;
  bossPhase: number;
  heroHpCarry: number;
  heroMaxHpCarry: number;
  roomBannerText: string;
  roomBannerTimer: number;
  prevAction: boolean;
  prevJump: boolean;
  toDestroyCount: number;
  readonly toDestroyScratch: number[];
  readonly scratchPos: [number, number];
  readonly aiTimers: Map<string, number>;
  readonly clearedEntityIds: Set<string>;
}

export function createWorldMapCombatState(): WorldMapCombatState {
  return {
    cameraX: 0,
    cameraY: 0,
    facingX: 0,
    facingY: -1,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirX: 0,
    dashDirY: -1,
    slashCooldown: 0,
    slashActiveTimer: 0,
    slashX: 0,
    slashY: 0,
    heroInvulnTimer: 0,
    portalCooldown: 0,
    walkAnimAccum: 0,
    footstepTimer: 0,
    bossName: '',
    bossMaxHp: 0,
    bossHp: 0,
    bossPhase: 1,
    heroHpCarry: -1,
    heroMaxHpCarry: 10,
    roomBannerText: '',
    roomBannerTimer: 0,
    prevAction: false,
    prevJump: false,
    toDestroyCount: 0,
    toDestroyScratch: [],
    scratchPos: [0, 0],
    aiTimers: new Map<string, number>(),
    clearedEntityIds: new Set<string>(),
  };
}

export function findWorldInteractionRule(
  project: EcsProjectV2,
  tag: string,
): EcsMapInteractionRule | undefined {
  const rules = project.worldMap?.interactions;
  if (!rules) return undefined;
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].tag === tag) return rules[i];
  }
  return undefined;
}

export function findWorldAiProfile(
  project: EcsProjectV2,
  tag: string,
): EcsTopDownAiProfile | undefined {
  return project.worldMap?.aiProfiles?.[tag];
}

export function damageHeroInWorld(
  state: WorldMapCombatState,
  hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
  dmg: number,
  hx: number,
  hy: number,
  heroHandle: number,
  eventsOut: SimEvent[],
  cb: WorldMapStepCallbacks,
): void {
  if (!hHp || state.heroInvulnTimer > 0) return;
  hHp.hp = Math.max(0, hHp.hp - dmg);
  hHp.hitFlash = 0.25;
  state.heroHpCarry = hHp.hp;
  state.heroInvulnTimer = 0.85;
  eventsOut.push('hurt');
  cb.onPopup(`-${dmg}`, hx, hy - 14, '#fb7185');
  cb.onHeroHurt?.(hx, hy, heroHandle);
  if (hHp.hp <= 0) {
    cb.onStatusChange('lost');
  }
}

export function triggerCutscenesForGlobalInWorld(
  project: EcsProjectV2,
  director: EcsCinematicDirector,
  cameraX: number,
  cameraY: number,
  globalKey: string,
): void {
  if (!project.cutscenes) return;
  for (let i = 0; i < project.cutscenes.length; i++) {
    const cs = project.cutscenes[i];
    if (
      cs.trigger === 'on_global_set' &&
      cs.triggerGlobal === globalKey &&
      !director.hasCompletedCutscene(cs.id)
    ) {
      director.startCutscene(cs, cameraX, cameraY, director.cameraZoom);
      return;
    }
  }
}

export function executeWorldInteractionRule(
  project: EcsProjectV2,
  state: WorldMapCombatState,
  director: EcsCinematicDirector,
  rule: EcsMapInteractionRule,
  world: EcsWorld,
  eh: number,
  entityId: string,
  ex: number,
  ey: number,
  hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
  eventsOut: SimEvent[],
  cb: WorldMapStepCallbacks,
  onRebuildTiles: () => void,
): void {
  if (rule.oneShot) {
    state.clearedEntityIds.add(entityId);
  }
  if (rule.swapSprite) {
    const mat = world.core.getComponent(eh, world.core.components.Material);
    if (mat) mat.spriteId = rule.swapSprite;
  }
  if (rule.destroyOnUse) {
    state.toDestroyScratch[state.toDestroyCount++] = eh;
  }
  if (rule.healAmount && hHp) {
    hHp.hp = Math.min(hHp.maxHp, hHp.hp + rule.healAmount);
    state.heroHpCarry = hHp.hp;
  }
  let tilesNeedRebuild = false;
  if (rule.setGlobal) {
    world.setGlobal(rule.setGlobal, rule.setGlobalValue ?? 1);
    tilesNeedRebuild = true;
    triggerCutscenesForGlobalInWorld(project, director, state.cameraX, state.cameraY, rule.setGlobal);
  }
  let thresholdReached = false;
  let addedValue = 0;
  let targetValue = 0;
  if (rule.addGlobal) {
    addedValue = (world.getGlobal(rule.addGlobal) ?? 0) + (rule.addGlobalDelta ?? 1);
    world.setGlobal(rule.addGlobal, addedValue);
    targetValue = rule.thresholdTargetGlobal
      ? (world.getGlobal(rule.thresholdTargetGlobal) || rule.thresholdCount || 1)
      : (rule.thresholdCount ?? 0);
    if (rule.thresholdUnlockGlobal && targetValue > 0 && addedValue >= targetValue) {
      world.setGlobal(rule.thresholdUnlockGlobal, 1);
      tilesNeedRebuild = true;
      thresholdReached = true;
      triggerCutscenesForGlobalInWorld(project, director, state.cameraX, state.cameraY, rule.thresholdUnlockGlobal);
    }
  }
  if (tilesNeedRebuild) {
    onRebuildTiles();
  }
  if (rule.scoreDelta) {
    cb.onScoreDelta(rule.scoreDelta);
  }
  if (rule.soundEvent) {
    eventsOut.push(rule.soundEvent);
  }
  cb.onInteract?.(ex, ey, thresholdReached ? (rule.thresholdPopupColor ?? '#38bdf8') : (rule.popupColor ?? '#fde047'));
  if (thresholdReached && rule.thresholdPopup) {
    cb.onPopup(rule.thresholdPopup, ex, ey - 20, rule.thresholdPopupColor ?? '#38bdf8');
    eventsOut.push('win');
  } else if (rule.popupText) {
    const formatted = rule.popupText
      .replace('{val}', String(addedValue))
      .replace('{max}', String(targetValue));
    cb.onPopup(formatted, ex, ey - 18, rule.popupColor ?? '#fde047');
  }
}

export function performWorldMeleeHitCheck(
  project: EcsProjectV2,
  activeRoom: EcsMapRoomDef | null,
  state: WorldMapCombatState,
  director: EcsCinematicDirector,
  voxelVolume: RoomVoxelVolume,
  activeDimMask: number,
  world: EcsWorld,
  hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
  eventsOut: SimEvent[],
  cb: WorldMapStepCallbacks,
  onRebuildTiles: () => void,
): void {
  const core = world.core;
  const c = core.components;
  const tagStore = core.getStore(c.Tag);
  state.toDestroyCount = 0;
  const baseReach = project.worldMap?.heroConfig?.slashReach ?? 34;

  for (let i = 0; i < tagStore.size(); i++) {
    const eh = tagStore.getDenseEntityAt(i);
    const td = tagStore.getDenseDataAt(i);
    const etr = core.getComponent(eh, c.Transform2D);
    if (!etr) continue;
    const ex = etr.x + etr.w * 0.5;
    const ey = etr.y + etr.h * 0.5;

    const aiProfile = findWorldAiProfile(project, td.tag);
    if (aiProfile) {
      const reach = baseReach + (aiProfile.hitReachBonus ?? 0);
      if (Math.hypot(ex - state.slashX, ey - state.slashY) > reach) continue;
      const hp = core.getComponent(eh, c.Health);
      if (!hp) continue;

      hp.hp -= 1;
      hp.hitFlash = 0.22;
      eventsOut.push('stomp');
      cb.onPopup(aiProfile.hitPopup ?? '-1', ex, ey - 16, '#fde047');

      const kDist = Math.max(1, Math.hypot(ex - state.slashX, ey - state.slashY));
      const dirX = (ex - state.slashX) / kDist;
      const dirY = (ey - state.slashY) / kDist;
      const kb = aiProfile.knockback ?? 14;
      moveWithTileCollisionPure(
        etr.x,
        etr.y,
        etr.w,
        etr.h,
        dirX * kb,
        dirY * kb,
        activeRoom,
        project.worldMap,
        world,
        voxelVolume,
        activeDimMask,
        state.scratchPos,
        eh,
      );
      etr.x = state.scratchPos[0];
      etr.y = state.scratchPos[1];
      if (activeRoom?.voxels && activeRoom.voxels.length > 0) {
        updateActorVoxelElevationPure(world, voxelVolume, eh, 1 / 60);
      }

      const killed = hp.hp <= 0;
      director.triggerCombatImpact(
        killed ? (aiProfile.isBoss ? 'finisher' : 'heavy') : 'light',
        ex,
        ey,
      );
      cb.onHitImpact?.(ex, ey, dirX, dirY, killed, Boolean(aiProfile.isBoss), eh);

      if (aiProfile.isBoss) {
        state.bossHp = Math.max(0, hp.hp);
        if (
          aiProfile.phase2HpRatio !== undefined &&
          hp.hp <= hp.maxHp * aiProfile.phase2HpRatio &&
          state.bossPhase === 1
        ) {
          state.bossPhase = 2;
          director.triggerCombatImpact('boss_phase', ex, ey);
          if (aiProfile.phase2Popup) {
            cb.onPopup(aiProfile.phase2Popup, ex, ey - 28, '#fb7185');
          }
          cb.onBossPhase?.(ex, ey);
          eventsOut.push('explode');
          if (project.cutscenes) {
            for (let cIdx = 0; cIdx < project.cutscenes.length; cIdx++) {
              const cs = project.cutscenes[cIdx];
              if (cs.trigger === 'on_boss_phase' && !director.hasCompletedCutscene(cs.id)) {
                director.startCutscene(cs, state.cameraX, state.cameraY, director.cameraZoom);
                break;
              }
            }
          }
        }
      }

      if (killed) {
        state.clearedEntityIds.add(td.entityId);
        state.toDestroyScratch[state.toDestroyCount++] = eh;
        if (aiProfile.scoreOnDefeat) cb.onScoreDelta(aiProfile.scoreOnDefeat);
        if (aiProfile.defeatPopup) cb.onPopup(aiProfile.defeatPopup, ex, ey - 24, '#fef08a');
        if (aiProfile.winOnDefeat) {
          eventsOut.push('win');
          cb.onStatusChange('won');
        } else {
          eventsOut.push('explode');
        }
      }
      continue;
    }

    const rule = findWorldInteractionRule(project, td.tag);
    if (
      rule &&
      rule.trigger === 'slash_or_touch' &&
      !state.clearedEntityIds.has(td.entityId) &&
      Math.hypot(ex - state.slashX, ey - state.slashY) <= baseReach
    ) {
      executeWorldInteractionRule(
        project,
        state,
        director,
        rule,
        world,
        eh,
        td.entityId,
        ex,
        ey,
        hHp,
        eventsOut,
        cb,
        onRebuildTiles,
      );
    }
  }

  for (let i = 0; i < state.toDestroyCount; i++) {
    core.destroyEntity(state.toDestroyScratch[i]);
  }
  state.toDestroyCount = 0;
}

export function stepWorldInteractions(
  project: EcsProjectV2,
  state: WorldMapCombatState,
  director: EcsCinematicDirector,
  world: EcsWorld,
  heroCx: number,
  heroCy: number,
  hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
  eventsOut: SimEvent[],
  cb: WorldMapStepCallbacks,
  onRebuildTiles: () => void,
): void {
  const rules = project.worldMap?.interactions;
  if (!rules || rules.length === 0) return;

  const core = world.core;
  const c = core.components;
  const tagStore = core.getStore(c.Tag);
  state.toDestroyCount = 0;

  for (let i = 0; i < tagStore.size(); i++) {
    const eh = tagStore.getDenseEntityAt(i);
    const td = tagStore.getDenseDataAt(i);
    if (state.clearedEntityIds.has(td.entityId)) continue;
    const rule = findWorldInteractionRule(project, td.tag);
    if (!rule) continue;
    const etr = core.getComponent(eh, c.Transform2D);
    if (!etr) continue;
    const ex = etr.x + etr.w * 0.5;
    const ey = etr.y + etr.h * 0.5;
    if (Math.hypot(heroCx - ex, heroCy - ey) < rule.radius) {
      executeWorldInteractionRule(
        project,
        state,
        director,
        rule,
        world,
        eh,
        td.entityId,
        ex,
        ey,
        hHp,
        eventsOut,
        cb,
        onRebuildTiles,
      );
    }
  }

  for (let i = 0; i < state.toDestroyCount; i++) {
    core.destroyEntity(state.toDestroyScratch[i]);
  }
  state.toDestroyCount = 0;
}

export function stepWorldAiEntities(
  project: EcsProjectV2,
  activeRoom: EcsMapRoomDef | null,
  state: WorldMapCombatState,
  voxelVolume: RoomVoxelVolume,
  activeDimMask: number,
  pathWorkspace: PathfinderWorkspace,
  isCellOpaquePredicate: (c: number, r: number) => boolean,
  isCellWalkablePredicate: (c: number, r: number) => boolean,
  setCurrentGlobals: (globals: ReadonlyMap<string, number>) => void,
  dt: number,
  world: EcsWorld,
  heroCx: number,
  heroCy: number,
  heroHandle: number,
  hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
  eventsOut: SimEvent[],
  cb: WorldMapStepCallbacks,
): void {
  const core = world.core;
  const c = core.components;
  const tagStore = core.getStore(c.Tag);
  state.toDestroyCount = 0;
  const projTag = project.worldMap?.hostileProjectileTag ?? 'enemy_orb';

  for (let i = 0; i < tagStore.size(); i++) {
    const eh = tagStore.getDenseEntityAt(i);
    const td = tagStore.getDenseDataAt(i);
    const etr = core.getComponent(eh, c.Transform2D);
    if (!etr) continue;

    const ex = etr.x + etr.w * 0.5;
    const ey = etr.y + etr.h * 0.5;
    const dx = heroCx - ex;
    const dy = heroCy - ey;
    const dist = Math.hypot(dx, dy);

    const profile = findWorldAiProfile(project, td.tag);
    if (profile) {
      const isPhase2 = Boolean(profile.isBoss && state.bossPhase >= 2);
      if (profile.isBoss) {
        const hp = core.getComponent(eh, c.Health);
        if (hp) {
          state.bossHp = hp.hp;
          state.bossMaxHp = hp.maxHp;
        }
      }

      const spd = isPhase2 && profile.phase2Speed !== undefined ? profile.phase2Speed : profile.moveSpeed;
      const chasing = dist < profile.chaseRange && dist > profile.stopRange;
      if (chasing) {
        let moveDirX = dx / dist;
        let moveDirY = dy / dist;
        const room = activeRoom;
        const wm = project.worldMap;
        if (room && wm) {
          const ts = wm.tileSize;
          const eCol = Math.max(0, Math.min(room.cols - 1, Math.floor(ex / ts)));
          const eRow = Math.max(0, Math.min(room.rows - 1, Math.floor(ey / ts)));
          const hCol = Math.max(0, Math.min(room.cols - 1, Math.floor(heroCx / ts)));
          const hRow = Math.max(0, Math.min(room.rows - 1, Math.floor(heroCy / ts)));
          setCurrentGlobals(world.globals);
          if (!hasGridLineOfSight(eCol, eRow, hCol, hRow, isCellOpaquePredicate)) {
            const nextCell = findAStarNextCell(
              room.cols,
              room.rows,
              eCol,
              eRow,
              hCol,
              hRow,
              isCellWalkablePredicate,
              undefined,
              1,
              pathWorkspace,
            );
            if (nextCell >= 0) {
              const nextCol = nextCell % room.cols;
              const nextRow = (nextCell - nextCol) / room.cols;
              const ndx = (nextCol + 0.5) * ts - ex;
              const ndy = (nextRow + 0.5) * ts - ey;
              const ndist = Math.hypot(ndx, ndy);
              if (ndist > 0.001) {
                moveDirX = ndx / ndist;
                moveDirY = ndy / ndist;
              }
            }
          }
        }
        const origX = etr.x;
        const origY = etr.y;
        moveWithTileCollisionPure(
          origX,
          origY,
          etr.w,
          etr.h,
          moveDirX * spd * dt,
          moveDirY * spd * dt,
          room,
          wm,
          world,
          voxelVolume,
          activeDimMask,
          state.scratchPos,
          eh,
        );
        if (
          room &&
          wm &&
          Math.hypot(state.scratchPos[0] - origX, state.scratchPos[1] - origY) < spd * dt * 0.15
        ) {
          const ts = wm.tileSize;
          const eCol = Math.max(0, Math.min(room.cols - 1, Math.floor(ex / ts)));
          const eRow = Math.max(0, Math.min(room.rows - 1, Math.floor(ey / ts)));
          const hCol = Math.max(0, Math.min(room.cols - 1, Math.floor(heroCx / ts)));
          const hRow = Math.max(0, Math.min(room.rows - 1, Math.floor(heroCy / ts)));
          setCurrentGlobals(world.globals);
          const nextCell = findAStarNextCell(
            room.cols,
            room.rows,
            eCol,
            eRow,
            hCol,
            hRow,
            isCellWalkablePredicate,
            undefined,
            1,
            pathWorkspace,
          );
          if (nextCell >= 0) {
            const nextCol = nextCell % room.cols;
            const nextRow = (nextCell - nextCol) / room.cols;
            const ndx = (nextCol + 0.5) * ts - ex;
            const ndy = (nextRow + 0.5) * ts - ey;
            const ndist = Math.hypot(ndx, ndy);
            if (ndist > 0.001) {
              moveWithTileCollisionPure(
                origX,
                origY,
                etr.w,
                etr.h,
                (ndx / ndist) * spd * dt,
                (ndy / ndist) * spd * dt,
                room,
                wm,
                world,
                voxelVolume,
                activeDimMask,
                state.scratchPos,
                eh,
              );
            }
          }
        }
        etr.x = state.scratchPos[0];
        etr.y = state.scratchPos[1];
        if (room && room.voxels && room.voxels.length > 0) {
          updateActorVoxelElevationPure(world, voxelVolume, eh, dt);
        }
        const mat = core.getComponent(eh, c.Material);
        if (mat) mat.flipX = dx < 0;
      }
      const eAnim = core.getComponent(eh, c.Animator);
      if (eAnim?.runtime) {
        eAnim.runtime.setParam('speed', chasing ? spd : 0);
      }
      if (dist < profile.contactRange) {
        damageHeroInWorld(state, hHp, profile.contactDamage, heroCx, heroCy, heroHandle, eventsOut, cb);
      }

      if (profile.projectilePrefab && profile.projectileInterval) {
        const timer = (state.aiTimers.get(td.entityId) ?? profile.projectileInterval) - dt;
        if (timer <= 0 && dist < profile.chaseRange) {
          const nextInt = isPhase2
            ? (profile.projectilePhase2Interval ?? profile.projectileInterval)
            : profile.projectileInterval;
          state.aiTimers.set(td.entityId, nextInt);
          const baseAng = Math.atan2(dy, dx);
          const count = Math.max(
            1,
            isPhase2 ? (profile.projectilePhase2Count ?? profile.projectileCount ?? 5) : (profile.projectileCount ?? 3),
          );
          const spread = isPhase2
            ? (profile.projectilePhase2SpreadRad ?? profile.projectileSpreadRad ?? 1.2)
            : (profile.projectileSpreadRad ?? 0.9);
          const bSpd = isPhase2
            ? (profile.projectilePhase2Speed ?? profile.projectileSpeed ?? 150)
            : (profile.projectileSpeed ?? 125);
          for (let k = 0; k < count; k++) {
            const frac = count > 1 ? k / (count - 1) - 0.5 : 0;
            const ang = baseAng + frac * spread;
            const orb = world.spawnFromPrefab(profile.projectilePrefab, ex - 10, ey - 10);
            if (orb) {
              const b = core.getComponent(orb, c.Velocity2D);
              if (b) {
                b.vx = Math.cos(ang) * bSpd;
                b.vy = Math.sin(ang) * bSpd;
              }
            }
          }
          eventsOut.push('snap');
        } else {
          state.aiTimers.set(td.entityId, timer);
        }
      }
    } else if (td.tag === projTag) {
      if (dist < 18) {
        damageHeroInWorld(state, hHp, 1, heroCx, heroCy, heroHandle, eventsOut, cb);
        state.toDestroyScratch[state.toDestroyCount++] = eh;
      } else if (activeRoom && project.worldMap) {
        const ts = project.worldMap.tileSize;
        if (
          isRoomCellSolid(
            activeRoom,
            Math.floor(ex / ts),
            Math.floor(ey / ts),
            world.globals,
            project.worldMap.tileDefs,
          )
        ) {
          state.toDestroyScratch[state.toDestroyCount++] = eh;
        }
      }
    }
  }

  for (let i = 0; i < state.toDestroyCount; i++) {
    core.destroyEntity(state.toDestroyScratch[i]);
  }
  state.toDestroyCount = 0;
}

export function stepWorldTorchFlicker(world: EcsWorld, walkAnimAccum: number): void {
  const core = world.core;
  const c = core.components;
  const lightStore = core.getStore(c.LightSource);
  for (let i = 0; i < lightStore.size(); i++) {
    const h = lightStore.getDenseEntityAt(i);
    const td = core.getComponent(h, c.Tag);
    if (td?.tag === 'torch' || td?.tag === 'brazier') {
      const ls = lightStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      const seed = (tr ? tr.x * 0.13 + tr.y * 0.07 : i) + walkAnimAccum * 1.4;
      ls.intensity = 0.86 + Math.sin(seed * 3.1) * 0.08 + Math.cos(seed * 5.7) * 0.05;
    }
  }
}
