import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import type {
  EcsAmbientParticleTheme,
  EcsProjectionMode,
  EcsProjectV2,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { DEFAULT_HD2D_3D_FOV_DEG, DEFAULT_HD2D_3D_PITCH_DEG } from '../core/math/Perspective3DMath.ts';
import { createWorkbenchSliderRow, type WorkbenchDiagReport } from './EcsWorkbenchCatalog.ts';

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

/**
 * Builds the Right-Pane Scene-Level Inspector sections:
 * HD-2D 3D/Iso/Ortho projection controls, shadow/water/dimension toggles,
 * GPU ambient particles, DoF/Juice sliders, and transactional revision history.
 */
export function buildSceneAndHistorySections(
  proj: EcsProjectV2,
  session: EcsStudioSession,
  runtime: EcsCartridgeRuntime,
  onPreviewDirty: () => void,
): HTMLElement[] {
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
  waterRow.append(toggleShadowBtn, toggleWaterBtn, toggleShiftBtn);

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

  return [atmSec, histSec];
}
