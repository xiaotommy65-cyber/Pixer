import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import type { EcsCutsceneDef } from '../core/ecs/EcsCutsceneSchema.ts';
import type {
  EcsAmbientParticleTheme,
  EcsProjectionMode,
  EcsProjectV2,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { DEFAULT_HD2D_3D_FOV_DEG, DEFAULT_HD2D_3D_PITCH_DEG } from '../core/math/Perspective3DMath.ts';
import { createWorkbenchSliderRow, type WorkbenchDiagReport } from './EcsWorkbenchCatalog.ts';

export interface SceneInspectorOptions {
  onPlayCutscene?: (cutsceneId: string) => void;
  onCritiqueCutscene?: (cutsceneId: string) => void;
  fovPreviewEnabled?: boolean;
  onToggleFovPreview?: () => void;
}

/** Renders the diagnostic banner produced by Spatial Oracle / External Import into the right inspector. */
export function buildDiagReportBox(report: WorkbenchDiagReport): HTMLElement {
  const diagBox = document.createElement('div');
  diagBox.className = 'p7-diag-box p7-mono';
  const head = document.createElement('div');
  head.className = report.ok ? 'p7-diag-ok' : 'p7-diag-warn';
  head.textContent = report.headline;
  diagBox.appendChild(head);
  for (const line of report.lines) {
    const row = document.createElement('div');
    row.className = 'p7-meta-line';
    row.textContent = line;
    diagBox.appendChild(row);
  }
  return diagBox;
}

function buildSampleCutscene(proj: EcsProjectV2, runtime: EcsCartridgeRuntime): EcsCutsceneDef {
  const existing = new Set((proj.cutscenes ?? []).map((c) => c.id));
  let seq = 1;
  let csId = 'sample_preview_pv';
  while (existing.has(csId)) {
    seq++;
    csId = `sample_preview_pv_${seq}`;
  }
  const activeRoomId = runtime.getActiveRoomId() || proj.worldMap?.startRoomId || '';
  const hasHero = proj.entities.some((e) => e.id === 'hero' || e.components.tag === 'hero');
  const roomEntity = proj.entities.find((e) => !activeRoomId || !e.roomId || e.roomId === activeRoomId);
  const primarySubject = hasHero ? 'hero' : (roomEntity?.id ?? proj.entities[0]?.id ?? 'point');

  return {
    id: csId,
    name: seq === 1 ? '引擎運鏡範例 PV' : `引擎運鏡範例 PV #${seq}`,
    trigger: 'manual',
    ...(activeRoomId ? { roomId: activeRoomId } : {}),
    handbackDurationSec: 0.45,
    skippable: true,
    shots: [
      {
        id: 'shot_establishing',
        durationSec: 1.0,
        subject: primarySubject,
        shotSize: 'WS',
        anchor: 'lead_room',
        motion: 'spring',
        motivation: 'scene_establishing',
        splashTitle: proj.meta.title.slice(0, 24) || 'SCENE PREVIEW',
        splashSubtitle: 'HD-2D DIRECTOR PREVIEW',
        letterbox: 1.0,
      },
      {
        id: 'shot_focus_push',
        durationSec: 1.1,
        subject: primarySubject,
        shotSize: 'MS',
        anchor: 'center',
        motion: 'push_in',
        motivation: 'character_focus',
        subtitle: '鏡頭推進預覽中...',
        letterbox: 1.0,
      },
    ],
  };
}

/**
 * Builds the Right-Pane Scene-Level Inspector sections:
 * Phase 6 Cutscene Director & 5-Axis Critic, HD-2D 3D/Iso/Ortho projection controls,
 * FOV Fog-of-War & atmosphere toggles, GPU ambient particles, DoF/Juice sliders, and revision history.
 */
export function buildSceneAndHistorySections(
  proj: EcsProjectV2,
  session: EcsStudioSession,
  runtime: EcsCartridgeRuntime,
  onPreviewDirty: () => void,
  options: SceneInspectorOptions = {},
): HTMLElement[] {
  // 0. Phase 6 Cutscene Director & 5-Axis Aesthetic Critic Panel
  const cutsceneSec = document.createElement('div');
  cutsceneSec.className = 'p7-section';
  const cutsceneHead = document.createElement('div');
  cutsceneHead.className = 'p7-section-head';
  const cutsceneTitle = document.createElement('h3');
  cutsceneTitle.className = 'p7-section-title';
  cutsceneTitle.textContent = '電影級過場導演與審美預言機';

  const addSampleBtn = document.createElement('button');
  addSampleBtn.type = 'button';
  addSampleBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
  addSampleBtn.setAttribute('data-testid', 'cutscene-add-sample');
  addSampleBtn.textContent = '+ 新增範例過場';
  addSampleBtn.addEventListener('click', () => {
    const sample = buildSampleCutscene(session.getProject(), runtime);
    session.dispatch({ type: 'upsert_cutscene', cutscene: sample });
  });
  cutsceneHead.append(cutsceneTitle, addSampleBtn);
  cutsceneSec.appendChild(cutsceneHead);

  const cutscenes = proj.cutscenes ?? [];
  if (cutscenes.length === 0) {
    const emptyCs = document.createElement('p');
    emptyCs.className = 'p7-empty-note';
    emptyCs.textContent = '尚未建立過場腳本，可點擊「+ 新增範例過場」或透過 MCP 寫入分鏡。';
    cutsceneSec.appendChild(emptyCs);
  } else {
    for (const cs of cutscenes) {
      const row = document.createElement('div');
      row.className = 'p7-cutscene-row';

      const meta = document.createElement('div');
      meta.className = 'p7-cutscene-meta';
      const nameEl = document.createElement('strong');
      nameEl.className = 'p7-item-title';
      nameEl.textContent = cs.name;
      const subEl = document.createElement('span');
      subEl.className = 'p7-meta-line p7-mono';
      subEl.textContent = `${cs.shots.length} 鏡頭 · ${cs.trigger ?? 'manual'}${cs.roomId ? ` · ${cs.roomId}` : ''}`;
      meta.append(nameEl, subEl);

      const acts = document.createElement('div');
      acts.className = 'p7-prefab-actions';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
      playBtn.setAttribute('data-testid', `cutscene-play-${cs.id}`);
      playBtn.textContent = '試映';
      playBtn.addEventListener('click', () => options.onPlayCutscene?.(cs.id));

      const criticBtn = document.createElement('button');
      criticBtn.type = 'button';
      criticBtn.className = 'p7-btn p7-btn-xs';
      criticBtn.setAttribute('data-testid', `cutscene-critic-${cs.id}`);
      criticBtn.textContent = '審美評分';
      criticBtn.addEventListener('click', () => options.onCritiqueCutscene?.(cs.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'p7-btn p7-btn-xs p7-btn-danger';
      delBtn.textContent = '刪除';
      delBtn.addEventListener('click', () => {
        session.dispatch({ type: 'remove_cutscene', cutsceneId: cs.id });
      });

      acts.append(playBtn, criticBtn, delBtn);
      row.append(meta, acts);
      cutsceneSec.appendChild(row);
    }
  }

  const atmSec = document.createElement('div');
  atmSec.className = 'p7-section';
  const atmTitle = document.createElement('h3');
  atmTitle.className = 'p7-section-title';
  atmTitle.textContent = 'HD-2D 立體視角、光影與景深';

  const curProjMode: EcsProjectionMode = proj.projection?.mode ?? 'hd2d_3d';
  const projModeRow = document.createElement('div');
  projModeRow.className = 'p7-prefab-actions';

  const makeModeBtn = (mode: EcsProjectionMode, testId: string, label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = curProjMode === mode ? 'p7-btn p7-btn-accent' : 'p7-btn';
    b.setAttribute('data-testid', testId);
    b.textContent = label;
    b.addEventListener('click', () => {
      session.dispatch({ type: 'set_projection', patch: { mode } });
    });
    return b;
  };
  projModeRow.append(
    makeModeBtn('hd2d_3d', 'proj-mode-hd2d-3d', '真 3D 透視'),
    makeModeBtn('hd2d_iso', 'proj-mode-hd2d-iso', '3/4 強立體'),
    makeModeBtn('ortho_2d', 'proj-mode-ortho-2d', '2D 正交'),
  );

  const commitProj = (patch: Partial<NonNullable<EcsProjectV2['projection']>>) => {
    session.dispatch({ type: 'set_projection', patch });
  };
  const projSliders = document.createElement('div');
  projSliders.className = 'p7-slider-group';
  projSliders.append(
    createWorkbenchSliderRow(
      '相機俯角 Pitch',
      22,
      70,
      1,
      proj.projection?.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG,
      (v) => `${Math.round(v)}°`,
      (v) => {
        runtime.patchLiveProjection({ pitchDeg: v });
        onPreviewDirty();
      },
      (v) => commitProj({ pitchDeg: v }),
    ),
    createWorkbenchSliderRow(
      '透視視野 FOV',
      24,
      60,
      1,
      proj.projection?.fovDeg ?? DEFAULT_HD2D_3D_FOV_DEG,
      (v) => `${Math.round(v)}°`,
      (v) => {
        runtime.patchLiveProjection({ fovDeg: v });
        onPreviewDirty();
      },
      (v) => commitProj({ fovDeg: v }),
    ),
    createWorkbenchSliderRow(
      '牆體高度倍率 Wall Height',
      0.6,
      2.2,
      0.05,
      proj.projection?.wallHeightScale ?? 1.25,
      (v) => `${v.toFixed(2)}×`,
      (v) => {
        runtime.patchLiveProjection({ wallHeightScale: v });
        onPreviewDirty();
      },
      (v) => commitProj({ wallHeightScale: v }),
    ),
    createWorkbenchSliderRow(
      '紙片人仰角 Billboard Tilt',
      0,
      32,
      1,
      proj.projection?.billboardTiltDeg ?? 12,
      (v) => `${Math.round(v)}°`,
      (v) => {
        runtime.patchLiveProjection({ billboardTiltDeg: v });
        onPreviewDirty();
      },
      (v) => commitProj({ billboardTiltDeg: v }),
    ),
  );

  const waterRow = document.createElement('div');
  waterRow.className = 'p7-prefab-actions';

  const shadowOn = proj.atmosphere.shadowOcclusion !== false;
  const toggleShadowBtn = document.createElement('button');
  toggleShadowBtn.type = 'button';
  toggleShadowBtn.className = shadowOn ? 'p7-btn p7-btn-accent' : 'p7-btn';
  toggleShadowBtn.textContent = shadowOn ? '2D 陰影遮蔽：開' : '2D 陰影遮蔽：關';
  toggleShadowBtn.addEventListener('click', () => {
    session.dispatch({ type: 'set_atmosphere', patch: { shadowOcclusion: !shadowOn } });
  });

  const waterOn = (proj.atmosphere.waterLevelNorm ?? 0) > 0;
  const toggleWaterBtn = document.createElement('button');
  toggleWaterBtn.type = 'button';
  toggleWaterBtn.className = waterOn ? 'p7-btn p7-btn-accent' : 'p7-btn';
  toggleWaterBtn.textContent = waterOn ? '水面反射：開' : '水面反射：關';
  toggleWaterBtn.addEventListener('click', () => {
    session.dispatch({ type: 'set_atmosphere', patch: { waterLevelNorm: waterOn ? 0 : 0.81 } });
  });

  const shiftOn = Boolean(proj.projection?.allowDimensionShift);
  const toggleShiftBtn = document.createElement('button');
  toggleShiftBtn.type = 'button';
  toggleShiftBtn.className = shiftOn ? 'p7-btn p7-btn-accent' : 'p7-btn';
  toggleShiftBtn.textContent = shiftOn ? 'R 鍵切界：開' : 'R 鍵切界：關';
  toggleShiftBtn.addEventListener('click', () => {
    session.dispatch({ type: 'set_projection', patch: { allowDimensionShift: !shiftOn } });
  });

  const fovOn = Boolean(options.fovPreviewEnabled);
  const toggleFovBtn = document.createElement('button');
  toggleFovBtn.type = 'button';
  toggleFovBtn.className = fovOn ? 'p7-btn p7-btn-accent' : 'p7-btn';
  toggleFovBtn.setAttribute('data-testid', 'toggle-fov-preview');
  toggleFovBtn.textContent = fovOn ? '視野遮蔽預覽 (FOV Fog)：開' : '視野遮蔽預覽 (FOV Fog)：關';
  toggleFovBtn.addEventListener('click', () => {
    options.onToggleFovPreview?.();
  });
  waterRow.append(toggleShadowBtn, toggleWaterBtn, toggleShiftBtn, toggleFovBtn);

  const particleField = document.createElement('div');
  particleField.className = 'p7-field';
  const particleLbl = document.createElement('label');
  particleLbl.textContent = '環境微粒主題 (GPU Particles)';
  const particleSel = document.createElement('select');
  particleSel.className = 'p7-select p7-mono';
  particleSel.setAttribute('aria-label', '環境微粒主題');
  const particleOptions: readonly { v: EcsAmbientParticleTheme; t: string }[] = [
    { v: 'none', t: '關閉 (None)' },
    { v: 'embers', t: '熾熱火星 (Embers)' },
    { v: 'fireflies', t: '螢火微光 (Fireflies)' },
    { v: 'dust', t: '浮塵光屑 (Dust)' },
    { v: 'snow', t: '飄雪冰晶 (Snow)' },
  ];
  for (const opt of particleOptions) {
    const o = document.createElement('option');
    o.value = opt.v;
    o.textContent = opt.t;
    particleSel.appendChild(o);
  }
  particleSel.value = proj.atmosphere.ambientParticles ?? 'none';
  particleSel.addEventListener('change', () => {
    session.dispatch({
      type: 'set_atmosphere',
      patch: { ambientParticles: particleSel.value as EcsAmbientParticleTheme },
    });
  });
  particleField.append(particleLbl, particleSel);

  const commitAtm = (patch: Partial<EcsProjectV2['atmosphere']>) => {
    session.dispatch({ type: 'set_atmosphere', patch });
  };
  const atmSliders = document.createElement('div');
  atmSliders.className = 'p7-slider-group';
  atmSliders.append(
    createWorkbenchSliderRow(
      '陰影遮蔽深度 Shadow',
      0,
      1,
      0.05,
      proj.atmosphere.shadowStrength ?? 0.88,
      (v) => `${Math.round(v * 100)}%`,
      (v) => {
        runtime.patchLiveAtmosphere({ shadowStrength: v });
        onPreviewDirty();
      },
      (v) => commitAtm({ shadowStrength: v }),
    ),
    createWorkbenchSliderRow(
      '移軸景深 Tilt-Shift DoF',
      0,
      1,
      0.05,
      proj.atmosphere.tiltShiftBlur ?? 0.32,
      (v) => `${Math.round(v * 100)}%`,
      (v) => {
        runtime.patchLiveAtmosphere({ tiltShiftBlur: v });
        onPreviewDirty();
      },
      (v) => commitAtm({ tiltShiftBlur: v }),
    ),
    createWorkbenchSliderRow(
      '打擊頓幀震屏 Juice Scale',
      0,
      2,
      0.1,
      proj.atmosphere.juiceScale ?? 1.0,
      (v) => `${v.toFixed(1)}×`,
      (v) => {
        runtime.patchLiveAtmosphere({ juiceScale: v });
        onPreviewDirty();
      },
      (v) => commitAtm({ juiceScale: v }),
    ),
  );
  atmSec.append(atmTitle, projModeRow, projSliders, waterRow, particleField, atmSliders);

  // Transaction History
  const histSec = document.createElement('div');
  histSec.className = 'p7-section';
  const histTitle = document.createElement('h3');
  histTitle.className = 'p7-section-title';
  histTitle.textContent = '交易式修訂歷程';
  histSec.appendChild(histTitle);

  const recent = session.getHistory().slice(-5).reverse();
  for (const h of recent) {
    const row = document.createElement('div');
    row.className = 'p7-meta-line p7-mono';
    row.textContent = `#${h.revision} · ${h.summary}`;
    histSec.appendChild(row);
  }

  return [cutsceneSec, atmSec, histSec];
}
