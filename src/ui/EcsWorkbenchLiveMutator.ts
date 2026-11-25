import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import type { EcsCoreWorld } from '../core/ecs/EcsCoreWorld.ts';
import { getEntityPrefabId, type EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EntityHandle } from '../core/ecs/EntityManager.ts';

function findEntityHandle(core: EcsCoreWorld, entityId: string): EntityHandle | null {
  const tagStore = core.getStore(core.components.Tag);
  for (let i = 0; i < tagStore.size(); i++) {
    if (tagStore.getDenseDataAt(i).entityId === entityId) {
      return tagStore.getDenseEntityAt(i);
    }
  }
  return null;
}

/**
 * Real-time zero-transaction preview mutator for ECS Workbench sliders.
 * Applies live visual/physics tweaks directly to the running `EcsCartridgeRuntime`
 * while users drag sliders; permanent Undo/Redo commits occur on `change` via `EcsStudioSession`.
 */
export class EcsWorkbenchLiveMutator {
  private readonly runtime: EcsCartridgeRuntime;
  private readonly onPreviewDirty: () => void;

  constructor(runtime: EcsCartridgeRuntime, onPreviewDirty: () => void) {
    this.runtime = runtime;
    this.onPreviewDirty = onPreviewDirty;
  }

  public mutateMaterial(
    entityId: string,
    patch: { metallic?: number; roughness?: number; emissive?: number },
  ): void {
    const core = this.runtime.world.core;
    const h = findEntityHandle(core, entityId);
    if (h !== null) {
      const mat = core.getComponent(h, core.components.Material);
      if (mat) {
        if (patch.metallic !== undefined) mat.metallic = patch.metallic;
        if (patch.roughness !== undefined) mat.roughness = patch.roughness;
        if (patch.emissive !== undefined) mat.emissive = patch.emissive;
      }
    }
    this.onPreviewDirty();
  }

  public mutateLight(
    entityId: string,
    patch: { radius?: number; intensity?: number; color?: string },
  ): void {
    const core = this.runtime.world.core;
    const h = findEntityHandle(core, entityId);
    if (h !== null) {
      const ls = core.getComponent(h, core.components.LightSource);
      if (ls) {
        if (patch.radius !== undefined) ls.radius = patch.radius;
        if (patch.intensity !== undefined) ls.intensity = patch.intensity;
        if (patch.color !== undefined) ls.color = patch.color;
      }
    }
    this.onPreviewDirty();
  }

  public mutateMotor(
    entityId: string,
    patch: { gravity?: number; jumpVelocity?: number; moveSpeed?: number; coyoteTimeSec?: number; floorY?: number },
  ): void {
    const core = this.runtime.world.core;
    const h = findEntityHandle(core, entityId);
    if (h !== null) {
      const m = core.getComponent(h, core.components.CharacterMotor2D);
      if (m) {
        if (patch.gravity !== undefined) m.gravity = patch.gravity;
        if (patch.jumpVelocity !== undefined) m.jumpVelocity = patch.jumpVelocity;
        if (patch.moveSpeed !== undefined) m.moveSpeed = patch.moveSpeed;
        if (patch.coyoteTimeSec !== undefined) m.coyoteTimeSec = patch.coyoteTimeSec;
        if (patch.floorY !== undefined) m.floorY = patch.floorY;
      }
    }
    this.onPreviewDirty();
  }

  public mutateGrapple(
    entityId: string,
    patch: { anchorRadius?: number; swingTension?: number; reelSpeed?: number },
  ): void {
    const core = this.runtime.world.core;
    const h = findEntityHandle(core, entityId);
    if (h !== null) {
      const g = core.getComponent(h, core.components.GrappleAnchor);
      if (g) {
        if (patch.anchorRadius !== undefined) g.anchorRadius = patch.anchorRadius;
        if (patch.swingTension !== undefined) g.swingTension = patch.swingTension;
        if (patch.reelSpeed !== undefined) g.reelSpeed = patch.reelSpeed;
      }
    }
    this.onPreviewDirty();
  }

  public mutateVerlet(
    entityId: string,
    patch: { nodeCount?: number; segmentLength?: number; gravity?: number; damping?: number; color?: string },
  ): void {
    const core = this.runtime.world.core;
    const h = findEntityHandle(core, entityId);
    if (h !== null) {
      const vc = core.getComponent(h, core.components.VerletChain);
      if (vc) {
        if (patch.nodeCount !== undefined) {
          vc.nodeCount = Math.max(2, Math.min(16, Math.round(patch.nodeCount)));
          vc.initialized = false;
        }
        if (patch.segmentLength !== undefined) vc.segmentLength = patch.segmentLength;
        if (patch.gravity !== undefined) vc.gravity = patch.gravity;
        if (patch.damping !== undefined) vc.damping = patch.damping;
        if (patch.color !== undefined) vc.color = patch.color;
      }
    }
    this.onPreviewDirty();
  }

  public mutateTransform(entityId: string, patch: { x?: number; y?: number }): void {
    const core = this.runtime.world.core;
    const h = findEntityHandle(core, entityId);
    if (h !== null) {
      const tr = core.getComponent(h, core.components.Transform2D);
      if (tr) {
        if (patch.x !== undefined) {
          tr.x = patch.x;
          tr.prevX = patch.x;
        }
        if (patch.y !== undefined) {
          tr.y = patch.y;
          tr.prevY = patch.y;
        }
      }
    }
    this.onPreviewDirty();
  }

  public mutateSpatial3D(
    entityId: string,
    patch: { z?: number; height?: number; gravityZ?: number; jumpZVelocity?: number; dimensionMask?: number },
  ): void {
    const core = this.runtime.world.core;
    const h = findEntityHandle(core, entityId);
    if (h !== null) {
      const sp = core.getComponent(h, core.components.Spatial3D);
      if (sp) {
        if (patch.z !== undefined) {
          sp.z = patch.z;
          sp.prevZ = patch.z;
        }
        if (patch.height !== undefined) sp.height = patch.height;
        if (patch.gravityZ !== undefined) sp.gravityZ = patch.gravityZ;
        if (patch.jumpZVelocity !== undefined) sp.jumpZVelocity = patch.jumpZVelocity;
        if (patch.dimensionMask !== undefined) sp.dimensionMask = patch.dimensionMask;
      }
    }
    this.onPreviewDirty();
  }

  public mutatePrefabMaterial(
    proj: EcsProjectV2,
    prefabId: string,
    patch: { metallic?: number; roughness?: number; emissive?: number },
  ): void {
    const core = this.runtime.world.core;
    for (const e of proj.entities) {
      if (getEntityPrefabId(e) !== prefabId) continue;
      if (e.detachedComponents?.includes('sprite')) continue;
      const h = findEntityHandle(core, e.id);
      if (h === null) continue;
      const mat = core.getComponent(h, core.components.Material);
      if (!mat) continue;
      if (patch.metallic !== undefined && e.overrides?.sprite?.metallic === undefined) mat.metallic = patch.metallic;
      if (patch.roughness !== undefined && e.overrides?.sprite?.roughness === undefined) mat.roughness = patch.roughness;
      if (patch.emissive !== undefined && e.overrides?.sprite?.emissive === undefined) mat.emissive = patch.emissive;
    }
    this.onPreviewDirty();
  }

  public mutatePrefabLight(
    proj: EcsProjectV2,
    prefabId: string,
    patch: { radius?: number; intensity?: number; color?: string },
  ): void {
    const core = this.runtime.world.core;
    for (const e of proj.entities) {
      if (getEntityPrefabId(e) !== prefabId) continue;
      if (e.detachedComponents?.includes('light')) continue;
      const h = findEntityHandle(core, e.id);
      if (h === null) continue;
      const ls = core.getComponent(h, core.components.LightSource);
      if (!ls) continue;
      if (patch.radius !== undefined && e.overrides?.light?.radius === undefined) ls.radius = patch.radius;
      if (patch.intensity !== undefined && e.overrides?.light?.intensity === undefined) ls.intensity = patch.intensity;
      if (patch.color !== undefined && e.overrides?.light?.color === undefined) ls.color = patch.color;
    }
    this.onPreviewDirty();
  }
}
