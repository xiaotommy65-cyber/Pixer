import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createAgentBridge } from '../../src/core/ai/AgentBridge.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { resolveEntityComponents } from '../../src/core/ecs/EcsProjectSchema.ts';
import { ECS_COMMAND_CATALOG, EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import { createComputedCamera3D, projectWorld3DToScreen } from '../../src/core/math/Perspective3DMath.ts';
import { CartridgeRunner } from '../../src/core/runtime/CartridgeRunner.ts';
import { DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { registerBuiltinCartridges } from '../../src/game/BuiltinCartridges.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';
import { createDefaultMapDesignerState } from '../../src/ui/EcsMapDesignerPanel.ts';
import { rotateVoxelShape } from '../../src/ui/EcsMapDesignerPanelTools.ts';
import { createWorkbenchAgentApi } from '../../src/ui/EcsWorkbenchAgentAdapter.ts';
import {
  clampWorkbenchPaneWidth,
  DEFAULT_WORKBENCH_PREFERENCES,
  loadWorkbenchPreferences,
  normalizeWorkbenchPreferences,
  saveWorkbenchPreferences,
} from '../../src/ui/EcsWorkbenchPreferences.ts';
import {
  collectEntitiesInMarquee,
  collectRoomEntityPoses,
  computeQuadrantCamera3D,
  hitTestQuadHeaderBadge,
  pickEntityAtScreen,
  resolveQuadQuadrant,
  rotatePanDeltaByYaw,
  snapCoord,
} from '../../src/ui/EcsWorkbenchGizmoController.ts';

test('Workstation 2.0 batch commands (duplicate_entities, transform_entities, align_entities) support atomic Undo/Redo & voxel snap_floor', () => {
  assert.equal(ECS_COMMAND_CATALOG.length, 51, 'ECS_COMMAND_CATALOG must have exact 51 entries');
  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const initialCount = session.getProject().entities.length;

  // 1. duplicate_entities creates unique copies in 1 Undo step
  const dupRes = session.dispatch({
    type: 'duplicate_entities',
    entityIds: ['cy_tower_torch_top', 'cy_vault_torch_in'],
    offsetX: 16,
    offsetY: 24,
    offsetZ: 28,
  });
  assert.equal(dupRes.ok, true, dupRes.errors?.join('; '));
  assert.equal(dupRes.createdEntityIds?.length, 2);
  assert.equal(session.getProject().entities.length, initialCount + 2);
  const [copyAId, copyBId] = dupRes.createdEntityIds!;
  const projAfterDup = session.getProject();
  const origA = resolveEntityComponents(projAfterDup.entities.find((e) => e.id === 'cy_tower_torch_top')!, projAfterDup.prefabs);
  const copyA = resolveEntityComponents(projAfterDup.entities.find((e) => e.id === copyAId)!, projAfterDup.prefabs);
  assert.equal(copyA.transform?.x, (origA.transform?.x ?? 0) + 16);
  assert.equal(copyA.transform?.y, (origA.transform?.y ?? 0) + 24);
  assert.equal(copyA.spatial3d?.z, (origA.spatial3d?.z ?? 0) + 28);

  // 2. transform_entities moves, rotates yaw, scales & snaps atomically
  const tfRes = session.dispatch({
    type: 'transform_entities',
    entityIds: [copyAId, copyBId],
    deltaX: 10,
    deltaY: -10,
    deltaZ: 5,
    deltaYaw: 90,
    scaleMult: 1.5,
    snapGrid: 16,
    snapStoryZ: true,
  });
  assert.equal(tfRes.ok, true, tfRes.errors?.join('; '));
  const projAfterTf = session.getProject();
  const copyAAfterTf = resolveEntityComponents(projAfterTf.entities.find((e) => e.id === copyAId)!, projAfterTf.prefabs);
  assert.equal((copyAAfterTf.transform?.x ?? 0) % 16, 0);
  assert.equal((copyAAfterTf.transform?.y ?? 0) % 16, 0);
  assert.equal((copyAAfterTf.spatial3d?.z ?? 0) % 28, 0);
  assert.equal(copyAAfterTf.spatial3d?.yaw, 90);
  assert.ok(Math.abs((copyAAfterTf.transform?.scaleX ?? 1) - 1.5) < 1e-4);

  // 3. align_entities: align_x, distribute_x, and snap_floor onto L2 watchtower rooftop (z=56)
  // Place copyA directly above PA-14 watchtower L2 deck (20, 13) at z=120, then snap_floor!
  session.dispatch({
    type: 'patch_entity',
    entityId: copyAId,
    patch: {
      transform: { ...(copyAAfterTf.transform ?? { x: 0, y: 0 }), x: 20 * 32 + 4, y: 13 * 32 + 4 },
      spatial3d: { ...(copyAAfterTf.spatial3d ?? {}), z: 120 },
    },
  });
  const snapRes = session.dispatch({
    type: 'align_entities',
    entityIds: [copyAId],
    mode: 'snap_floor',
  });
  assert.equal(snapRes.ok, true, snapRes.errors?.join('; '));
  const projAfterSnap = session.getProject();
  const snappedA = resolveEntityComponents(projAfterSnap.entities.find((e) => e.id === copyAId)!, projAfterSnap.prefabs);
  assert.equal(snappedA.spatial3d?.z, 56, 'snap_floor must land entity squarely on L2 watchtower voxel deck z=56');

  const alignRes = session.dispatch({
    type: 'align_entities',
    entityIds: [copyAId, copyBId],
    mode: 'align_x',
  });
  assert.equal(alignRes.ok, true);
  const projAfterAlign = session.getProject();
  const alignedB = resolveEntityComponents(projAfterAlign.entities.find((e) => e.id === copyBId)!, projAfterAlign.prefabs);
  assert.equal(alignedB.transform?.x, snappedA.transform?.x);

  // Undo back to clean pre-duplicate state (4 commands: align_x, snap_floor, patch_entity, transform_entities, duplicate_entities = 5 undos)
  for (let i = 0; i < 5; i++) assert.equal(session.undo().ok, true);
  assert.equal(session.getProject().entities.length, initialCount);
  assert.equal(session.redo().ok, true);
  assert.equal(session.getProject().entities.length, initialCount + 2);
});

test('MCP query_entities_in_box & AgentBridge Wave 5/7 + mounted workbench Co-Editing API work end-to-end', () => {
  registerBuiltinCartridges();
  const mcp = new PixerMcpSession(OBSIDIAN_CITADEL_PROJECT);
  const qRes = mcp.invokeTool('query_entities_in_box', { roomId: 'courtyard', minZ: 40 });
  assert.equal(qRes.isError, false);
  const qData = qRes.structuredContent as { count: number; entities: Array<{ id: string; z: number }> };
  assert.ok(qData.count >= 2, `Expected >=2 elevated L2 tower entities, got ${qData.count}`);
  assert.ok(qData.entities.some((e) => e.id === 'cy_tower_beacon' && e.z >= 56));
  assert.ok(qData.entities.some((e) => e.id === 'cy_tower_torch_top' && e.z >= 56));
  assert.ok(!qData.entities.some((e) => e.id === 'cy_vault_torch_in'));

  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const runner = new CartridgeRunner('obsidian-citadel');

  // Headless unmounted bridge parity
  const headlessAgent = createAgentBridge(runner, undefined, { ecsSession: session });
  assert.equal(headlessAgent.workbench.isMounted(), false);
  assert.equal(headlessAgent.workbench.getState(), null);
  assert.equal(headlessAgent.ecs.getRoomSliceAscii('courtyard', 1)?.zLevel, 1);
  assert.equal(headlessAgent.ecs.analyzeWorldMap3D()?.pass, true);
  assert.ok(headlessAgent.ecs.listModels3D().some((m) => m.id === 'citadel_beacon'));
  const firstCutsceneId = OBSIDIAN_CITADEL_PROJECT.cutscenes?.[0]?.id ?? '';
  assert.ok(firstCutsceneId.length > 0);
  assert.equal(headlessAgent.ecs.critiqueCutscene(firstCutsceneId)?.pass, true);
  assert.ok(headlessAgent.ecs.queryEntitiesInBox({ roomId: 'courtyard', minZ: 40 }).length >= 2);
  const exportedPack = headlessAgent.ecs.exportAssetPack({ id: 'pa14_pack', name: 'PA14 Pack', genre: 'dungeon' });
  assert.ok(exportedPack && exportedPack.schemaVersion === 1);

  // Mounted Workbench adapter contract
  const runtime = new EcsCartridgeRuntime(session.getProject());
  const mapState = createDefaultMapDesignerState();
  let selectedIds: string[] = ['hero'];
  let simRunning = false;
  let refreshed = 0;

  const wbApi = createWorkbenchAgentApi({
    session,
    runtime,
    mapState,
    previewRuntime: {
      isSimRunning: () => simRunning,
      setSimRunning: (r: boolean) => {
        simRunning = r;
        if (r) runtime.getWorldMapController().setEditorSliceCutaway('all', 0);
      },
      focusEntities: (ids: readonly string[]) => ids.length > 0,
      resetEditorCamera: () => {
        runtime.clearEditorCamera();
      },
      switchActiveRoom: (roomId: string) => {
        runtime.switchRoomForEditor(roomId);
      },
      selectCamera3DView: (view: string) => {
        if (view === 'quad') {
          session.dispatch({ type: 'set_camera_3d_pose', quadView: true });
        } else {
          session.dispatch({ type: 'set_camera_3d_pose', cameraProjection3d: view as 'perspective', quadView: false });
        }
      },
      syncEditorSliceCutaway: () => {
        runtime.getWorldMapController().setEditorSliceCutaway(mapState.sliceCutawayMode, mapState.activeZLevel);
      },
      markDirty: () => {},
      renderPreviewNow: () => {},
    } as never,
    mapCanvasCtrl: {
      syncInteractivity: () => {},
      renderOverlay: () => {},
    } as never,
    getPreviewCanvas: () => ({ toDataURL: () => 'data:image/png;base64,MOCK' } as unknown as HTMLCanvasElement),
    isDestroyed: () => false,
    getSelectedEntityIds: () => selectedIds,
    setSelectedEntityIds: (ids) => {
      selectedIds = [...ids];
    },
    onRefreshUi: () => {
      refreshed++;
    },
  });

  const mountedAgent = createAgentBridge(runner, undefined, {
    ecsSession: session,
    workbenchApi: () => wbApi,
  });
  assert.equal(mountedAgent.workbench.isMounted(), true);
  assert.deepEqual(mountedAgent.workbench.setSelection(['cy_tower_beacon', 'cy_tower_torch_top', 'nonexistent']), [
    'cy_tower_beacon',
    'cy_tower_torch_top',
  ]);
  assert.equal(mountedAgent.workbench.setTool('select'), 'select');
  assert.equal(mountedAgent.workbench.setGizmoMode('rotate'), 'rotate');
  assert.equal(mountedAgent.workbench.setLayer('voxel3d'), 'voxel3d');
  assert.equal(mountedAgent.workbench.setActiveZLevel(2), 2);
  assert.equal(mountedAgent.workbench.setSliceCutaway('ghost_above'), 'ghost_above');
  assert.equal(mountedAgent.workbench.setSnapStep(8), 8);
  assert.equal(mountedAgent.workbench.setEditorCamera(40, 60, 1.75), true);
  assert.equal(mountedAgent.workbench.setViewMode('quad'), true);
  assert.equal(mountedAgent.workbench.captureViewportPng(), 'data:image/png;base64,MOCK');

  const st = mountedAgent.workbench.getState()!;
  assert.deepEqual(st.selectedEntityIds, ['cy_tower_beacon', 'cy_tower_torch_top']);
  assert.equal(st.activeTool, 'select');
  assert.equal(st.gizmoMode, 'rotate');
  assert.equal(st.editLayer, 'voxel3d');
  assert.equal(st.activeZLevel, 2);
  assert.equal(st.sliceCutawayMode, 'ghost_above');
  assert.equal(st.snapStep, 8);
  assert.equal(st.editorZoom, 1.75);
  assert.equal(st.quadView, true);
  assert.ok(refreshed > 0);

  mountedAgent.workbench.resetEditorCamera();
  assert.equal(mountedAgent.workbench.getState()?.editorZoom, 1);
});

test('Ephemeral editorZoom & editorSliceCutaway project cleanly without mutating saved project.projection', () => {
  const proj = structuredClone(OBSIDIAN_CITADEL_PROJECT);
  const origCutawayMode = proj.projection?.roofCutawayMode;
  const rt = new EcsCartridgeRuntime(proj);
  const wmCtrl = rt.getWorldMapController();

  wmCtrl.setEditorZoom(2.0);
  const zoomedSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(zoomedSnap.cameraZoom, 2.0);

  wmCtrl.setEditorSliceCutaway('ghost_above', 0);
  const ghostSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(ghostSnap.hd2dDepth?.cutawayActive, true);
  assert.equal(ghostSnap.hd2dDepth?.cutawayPlaneZ, 28);
  assert.equal(ghostSnap.hd2dDepth?.cutawayAlpha, 0.16);

  wmCtrl.setEditorSliceCutaway('solo_floor', 1);
  const soloSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(soloSnap.hd2dDepth?.cutawayActive, true);
  assert.equal(soloSnap.hd2dDepth?.cutawayPlaneZ, 56);
  assert.equal(soloSnap.hd2dDepth?.cutawayAlpha, 0);

  // Saved projection remains untouched
  assert.equal(proj.projection?.roofCutawayMode, origCutawayMode);

  // Clearing editor camera restores 1.0x gameplay zoom
  wmCtrl.clearEditorCamera();
  wmCtrl.setEditorSliceCutaway('all', 0);
  const resetSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(resetSnap.cameraZoom, 1);
});

test('Pure viewport helpers: yaw-aware pan, grid snapping, quad-view quadrant/header picking, entity pick/marquee, and voxel rotation', () => {
  // 1. Yaw-aware pan
  const p0 = rotatePanDeltaByYaw(20, 0, 0, 2);
  assert.ok(Math.abs(p0.wx - 10) < 1e-6 && Math.abs(p0.wy) < 1e-6);
  const p90 = rotatePanDeltaByYaw(20, 0, 90, 2);
  assert.ok(Math.abs(p90.wx) < 1e-6 && Math.abs(p90.wy - 10) < 1e-6);

  // 2. Grid snapping
  assert.equal(snapCoord(23, 16), 16);
  assert.equal(snapCoord(25, 16), 32);
  assert.equal(snapCoord(23, 0), 23);

  // 3. Quad-View quadrant resolution & header badge hit-testing
  assert.equal(resolveQuadQuadrant(0.25, 0.25, 640, 360).projection, 'perspective');
  assert.equal(resolveQuadQuadrant(0.75, 0.25, 640, 360).projection, 'ortho_top');
  assert.equal(resolveQuadQuadrant(0.25, 0.75, 640, 360).projection, 'ortho_front');
  assert.equal(resolveQuadQuadrant(0.75, 0.75, 640, 360).projection, 'ortho_side');
  assert.equal(hitTestQuadHeaderBadge(340, 16, 640, 360), 'ortho_top');
  assert.equal(hitTestQuadHeaderBadge(20, 196, 640, 360), 'ortho_front');
  assert.equal(hitTestQuadHeaderBadge(300, 120, 640, 360), null);

  // 4. Entity picking & marquee selection on PA-14 courtyard
  const proj = OBSIDIAN_CITADEL_PROJECT;
  const cam3d = computeQuadrantCamera3D(
    proj,
    { x: 0, y: 0 },
    1,
    'ortho_top',
    proj.viewport.width,
    proj.viewport.height,
    createComputedCamera3D(),
  );
  const poses = collectRoomEntityPoses(proj, 'courtyard');
  const heroPose = poses.find((p) => p.entityId === 'hero')!;
  assert.ok(heroPose);
  const heroScreen = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  projectWorld3DToScreen(heroPose.centerX, heroPose.centerY, heroPose.centerZ, cam3d, heroScreen);
  assert.equal(heroScreen.visible, true);
  const pickCtx = {
    project: proj,
    roomId: 'courtyard',
    poses,
    camX: 0,
    camY: 0,
    zoom: 1,
    viewW: proj.viewport.width,
    viewH: proj.viewport.height,
    cam3d,
  };
  const picked = pickEntityAtScreen(heroScreen.x, heroScreen.y, pickCtx);
  assert.equal(picked, 'hero');
  const zoomedOutCam = computeQuadrantCamera3D(
    proj,
    { x: 180, y: 120 },
    0.5,
    'ortho_top',
    proj.viewport.width,
    proj.viewport.height,
    createComputedCamera3D(),
  );
  const boxed = collectEntitiesInMarquee(0, 0, proj.viewport.width, proj.viewport.height, {
    ...pickCtx,
    camX: 180,
    camY: 120,
    zoom: 0.5,
    cam3d: zoomedOutCam,
  });
  assert.ok(boxed.includes('hero') && boxed.includes('cy_tower_beacon'));

  // 5. Directional voxel shape rotation
  assert.equal(rotateVoxelShape('stair_n', 1), 'stair_e');
  assert.equal(rotateVoxelShape('stair_w', 1), 'stair_n');
  assert.equal(rotateVoxelShape('stair_n', -1), 'stair_w');
  assert.equal(rotateVoxelShape('slope_e', 1), 'slope_s');
  assert.equal(rotateVoxelShape('cube', 1), 'cube');
  assert.equal(rotateVoxelShape('arch', 1), 'arch');
});

test('Wave 7B preferences normalization, modal portal stacking, Scale/Yaw inspector & cross-atelier gesture contracts', () => {
  // 1. Safe clamping & invalid fallback in EcsWorkbenchPreferences
  const norm = normalizeWorkbenchPreferences({
    leftWidth: 999,
    rightWidth: 50,
    leftCollapsed: true,
    rightCollapsed: false,
    snapStep: 12 as unknown as 16,
    sliceCutawayMode: 'bogus' as unknown as 'all',
  });
  assert.equal(norm.leftWidth, 380);
  assert.equal(norm.rightWidth, 220);
  assert.equal(norm.leftCollapsed, true);
  assert.equal(norm.snapStep, DEFAULT_WORKBENCH_PREFERENCES.snapStep);
  assert.equal(norm.sliceCutawayMode, DEFAULT_WORKBENCH_PREFERENCES.sliceCutawayMode);
  assert.equal(clampWorkbenchPaneWidth('left', 100), 196);
  assert.equal(clampWorkbenchPaneWidth('right', 600), 420);

  // Headless Node safety (no throw when localStorage unavailable)
  const loaded = loadWorkbenchPreferences();
  assert.equal(loaded.leftWidth, DEFAULT_WORKBENCH_PREFERENCES.leftWidth);
  const saved = saveWorkbenchPreferences({ snapStep: 8, sliceCutawayMode: 'ghost_above' });
  assert.equal(saved.snapStep, 8);
  assert.equal(saved.sliceCutawayMode, 'ghost_above');

  // 2. Source contracts for Wave 7B P0-P2 fixes & cross-atelier gestures
  const wbViewSrc = readFileSync(resolve(process.cwd(), 'src/ui/EcsWorkbenchView.ts'), 'utf8');
  assert.ok(
    wbViewSrc.includes('p7-modal-portal') && wbViewSrc.includes('document.body.appendChild(this.modalPortalEl)'),
    'EcsWorkbenchView must mount full-screen modals in a document.body portal above .p7-topbar',
  );
  assert.ok(wbViewSrc.includes('this.modalPortalEl.remove()'), 'EcsWorkbenchView.destroy() must clean up modalPortalEl');

  const inspectorSrc = readFileSync(resolve(process.cwd(), 'src/ui/EcsWorkbenchEntityInspector.ts'), 'utf8');
  assert.ok(
    inspectorSrc.includes('scaleX') && inspectorSrc.includes('mutateMesh3DScale') && inspectorSrc.includes('yaw'),
    'Entity inspector must expose Scale X/Y, Mesh3D Scale, and Spatial3D Yaw parity for Gizmo editing',
  );

  const previewSrc = readFileSync(resolve(process.cwd(), 'src/ui/EcsWorkbenchPreviewRuntime.ts'), 'utf8');
  assert.ok(previewSrc.includes('savedEditZoom'), 'Play/Edit toggle must preserve and restore savedEditZoom');

  const canvasSrc = readFileSync(resolve(process.cwd(), 'src/ui/EcsWorkbenchMapCanvasController.ts'), 'utf8');
  assert.ok(canvasSrc.includes('activeEl.blur()'), 'Canvas pointerdown must blur active input instead of painting stray tile');

  const modelVpSrc = readFileSync(resolve(process.cwd(), 'src/ui/ModelAtelierViewport.ts'), 'utf8');
  assert.ok(
    modelVpSrc.includes('contextmenu') && modelVpSrc.includes('getCameraState'),
    'ModelAtelierViewport must support Right-drag orbit without contextmenu & expose getCameraState()',
  );

  const graphSrc = readFileSync(resolve(process.cwd(), 'src/ui/EventGraphEditorView.ts'), 'utf8');
  assert.ok(
    graphSrc.includes('contextmenu') && graphSrc.includes('wheel'),
    'EventGraphEditorView must align contextmenu/pan/wheel zoom navigation',
  );
});
