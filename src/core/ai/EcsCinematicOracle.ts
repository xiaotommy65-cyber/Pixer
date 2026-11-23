import { EcsCartridgeRuntime } from '../ecs/EcsCartridgeRuntime.ts';
import {
  resolveScreenAnchorNorm,
  type EcsCutsceneShotDef,
  type EcsScreenAnchor,
  type EcsShotSize,
} from '../ecs/EcsCinematicDirector.ts';
import type { EcsProjectV2 } from '../ecs/EcsProjectSchema.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../types/WorldTypes.ts';

export interface EcsShotAestheticAudit {
  shotId: string;
  shotIndex: number;
  shotSize: EcsShotSize;
  anchor: EcsScreenAnchor;
  durationSec: number;
  subjectScreenU: number;
  subjectScreenV: number;
  secondaryScreenU?: number;
  secondaryScreenV?: number;
  cameraZoom: number;
  tiltShiftBlur: number;
  occlusionScore: number;
  compositionScore: number;
  axisContinuityScore: number;
  dramaturgyScore: number;
  shotScore: number;
  issues: string[];
  asciiViewfinder: string;
}

export interface EcsCutsceneAestheticReport {
  ok: boolean;
  cutsceneId: string;
  cutsceneName: string;
  roomId: string;
  totalDurationSec: number;
  framesSimulated: number;
  overallScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  pass: boolean;
  handbackContinuityScore: number;
  handbackResidualPx: number;
  handbackResidualZoom: number;
  shots: EcsShotAestheticAudit[];
  asciiStoryboard: string[];
  suggestions: string[];
}

/**
 * FilmFlow-Inspired Headless Scout + Mathematical Cinematography Critic Oracle (100% DOM-free, Zero-VLM).
 *
 * Simulates a cutscene at 60Hz in `EcsCartridgeRuntime`, captures real-time camera & entity screen-space
 * projections at every shot, and evaluates:
 * 1. HD-2D Extruded Wall Occlusion (`occlusionScore`)
 * 2. Rule-of-Thirds / Lead-Room / Toric Two-Shot & Letterbox Headroom Framing (`compositionScore`)
 * 3. 180-Degree Line-of-Action Axis Preservation (`axisContinuityScore`)
 * 4. Walter Murch Dramaturgy & Subtitle Pacing (`dramaturgyScore`)
 * 5. 3-Phase Critically Damped Spring Handback Convergence (`handbackContinuityScore`)
 */
export function critiqueCutsceneAesthetics(
  project: EcsProjectV2,
  cutsceneId: string,
): EcsCutsceneAestheticReport {
  const cutscene = project.cutscenes?.find((c) => c.id === cutsceneId);
  if (!cutscene) {
    return {
      ok: false,
      cutsceneId,
      cutsceneName: '',
      roomId: '',
      totalDurationSec: 0,
      framesSimulated: 0,
      overallScore: 0,
      grade: 'D',
      pass: false,
      handbackContinuityScore: 0,
      handbackResidualPx: 999,
      handbackResidualZoom: 1,
      shots: [],
      asciiStoryboard: [],
      suggestions: [`Cutscene '${cutsceneId}' not found in project.cutscenes`],
    };
  }

  const runtime = new EcsCartridgeRuntime(project);
  const wm = runtime.getWorldMapController();
  const dir = runtime.getCinematicDirector();
  const snap0 = runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const vpW = snap0.viewport?.width ?? project.viewport.width;
  const vpH = snap0.viewport?.height ?? project.viewport.height;

  const targetRoomId = cutscene.roomId ?? wm.getActiveRoomId();
  if (targetRoomId && wm.hasWorldMap() && wm.getActiveRoomId() !== targetRoomId) {
    wm.switchRoomForEditor(runtime.world, targetRoomId, vpW, vpH);
  }

  // Start the target cutscene from the live gameplay camera pose
  runtime.playCutscene(cutscene.id);

  const dt = 1 / 60;
  const emptyIn = createEmptyInputState();
  const shotAudits: EcsShotAestheticAudit[] = [];
  const asciiStoryboard: string[] = [];
  const suggestions: string[] = [];

  const actorA: [number, number, number, number] = [0, 0, 0, 1];
  const actorB: [number, number, number, number] = [0, 0, 0, 1];
  const expectedUv: [number, number] = [0.5, 0.52];

  let framesSimulated = 0;
  let prevTwoShotAxisSign: -1 | 0 | 1 = 0;

  for (let sIdx = 0; sIdx < cutscene.shots.length; sIdx++) {
    const shot = cutscene.shots[sIdx];
    const shotFrames = Math.max(6, Math.round(shot.durationSec * 60));
    const sampleFrame = Math.max(2, Math.floor(shotFrames * 0.65));

    let sampled = false;
    for (let f = 0; f < shotFrames; f++) {
      if (dir.getPhase() === 'playing_shots' && dir.getActiveShotIndex() > sIdx) {
        break;
      }
      runtime.step(dt, emptyIn, DEFAULT_RUNTIME_PARAMS);
      framesSimulated++;

      if (!sampled && (f === sampleFrame || f === shotFrames - 1)) {
        sampled = true;
        const audit = evaluateShotAtFrame(
          shot,
          sIdx,
          sIdx > 0 ? cutscene.shots[sIdx - 1] : null,
          runtime,
          vpW,
          vpH,
          prevTwoShotAxisSign,
          actorA,
          actorB,
          expectedUv,
        );
        if (audit.secondaryScreenU !== undefined) {
          prevTwoShotAxisSign = audit.secondaryScreenU >= audit.subjectScreenU ? 1 : -1;
        }
        shotAudits.push(audit);
        asciiStoryboard.push(audit.asciiViewfinder);
        for (let k = 0; k < audit.issues.length; k++) {
          suggestions.push(`[Shot #${sIdx + 1} '${shot.id}'] ${audit.issues[k]}`);
        }
      }
    }
  }

  // Step through Phase-3 Seamless Spring Handback and measure convergence back to gameplay camera
  const handbackSec = Math.max(0.15, cutscene.handbackDurationSec ?? 0.45);
  const handbackFrames = Math.ceil((handbackSec + 0.25) * 60);
  for (let f = 0; f < handbackFrames; f++) {
    runtime.step(dt, emptyIn, DEFAULT_RUNTIME_PARAMS);
    framesSimulated++;
    if (dir.getPhase() === 'idle') break;
  }

  // Measure handback residual vs canonical hero camera
  dir.resolveSubjectInWorld('hero', runtime.world, vpW * 0.5, vpH * 0.5, actorA);
  const room = wm.getActiveRoom();
  const ts = project.worldMap?.tileSize ?? 32;
  const worldW = room ? room.cols * ts : vpW;
  const worldH = room ? room.rows * ts : vpH;
  const idealHeroCamX = Math.max(0, Math.min(Math.max(0, worldW - vpW), actorA[0] - vpW * 0.5));
  const idealHeroCamY = Math.max(0, Math.min(Math.max(0, worldH - vpH), actorA[1] - vpH * 0.5));

  const handbackResidualPx = Math.hypot(dir.cameraX - idealHeroCamX, dir.cameraY - idealHeroCamY);
  const handbackResidualZoom = Math.abs(dir.cameraZoom - 1.0);
  const handbackContinuityScore = Math.round(
    Math.max(0, Math.min(100, 100 - handbackResidualPx * 0.8 - handbackResidualZoom * 120)),
  );

  if (handbackContinuityScore < 80) {
    suggestions.push(
      `Handback residual is ${handbackResidualPx.toFixed(1)}px (increase handbackDurationSec >= 0.45s for smoother spring return).`,
    );
  }

  let sumShotScore = 0;
  let totalDurationSec = 0;
  for (let i = 0; i < shotAudits.length; i++) {
    sumShotScore += shotAudits[i].shotScore;
    totalDurationSec += shotAudits[i].durationSec;
  }
  const avgShotScore = shotAudits.length > 0 ? sumShotScore / shotAudits.length : 0;
  const overallScore = Math.round(avgShotScore * 0.82 + handbackContinuityScore * 0.18);
  const grade: 'S' | 'A' | 'B' | 'C' | 'D' =
    overallScore >= 90
      ? 'S'
      : overallScore >= 80
        ? 'A'
        : overallScore >= 70
          ? 'B'
          : overallScore >= 60
            ? 'C'
            : 'D';

  return {
    ok: true,
    cutsceneId: cutscene.id,
    cutsceneName: cutscene.name,
    roomId: wm.getActiveRoomId(),
    totalDurationSec: Number(totalDurationSec.toFixed(2)),
    framesSimulated,
    overallScore,
    grade,
    pass: overallScore >= 75 && shotAudits.every((s) => s.occlusionScore >= 65),
    handbackContinuityScore,
    handbackResidualPx: Number(handbackResidualPx.toFixed(2)),
    handbackResidualZoom: Number(handbackResidualZoom.toFixed(4)),
    shots: shotAudits,
    asciiStoryboard,
    suggestions,
  };
}

function evaluateShotAtFrame(
  shot: EcsCutsceneShotDef,
  shotIndex: number,
  prevShot: EcsCutsceneShotDef | null,
  runtime: EcsCartridgeRuntime,
  vpW: number,
  vpH: number,
  prevTwoShotAxisSign: -1 | 0 | 1,
  actorA: [number, number, number, number],
  actorB: [number, number, number, number],
  expectedUv: [number, number],
): EcsShotAestheticAudit {
  const wm = runtime.getWorldMapController();
  const dir = runtime.getCinematicDirector();
  const issues: string[] = [];

  const shotSize: EcsShotSize = shot.shotSize ?? 'MS';
  const anchor: EcsScreenAnchor = shot.anchor ?? 'center';
  const zoom = Math.max(0.5, dir.cameraZoom);

  const hasPrimary = dir.resolveSubjectInWorld(
    shot.subject,
    runtime.world,
    shot.focusX ?? vpW * 0.5,
    shot.focusY ?? vpH * 0.5,
    actorA,
  );
  const subAx = hasPrimary ? actorA[0] + (shot.focusX ?? 0) : (shot.focusX ?? actorA[0]);
  const subAy = hasPrimary ? actorA[1] + (shot.focusY ?? 0) : (shot.focusY ?? actorA[1]);

  // Convert world position (subAx, subAy) to normalized zoomed screen UV [0, 1]^2
  const camCenterX = dir.cameraX + vpW * 0.5;
  const camCenterY = dir.cameraY + vpH * 0.5;
  const effW = vpW / zoom;
  const effH = vpH / zoom;
  const uA = 0.5 + (subAx - camCenterX) / effW;
  const vA = 0.5 + (subAy - camCenterY) / effH;

  let uB: number | undefined;
  let vB: number | undefined;
  if (anchor === 'two_shot' && shot.secondarySubject) {
    dir.resolveSubjectInWorld(shot.secondarySubject, runtime.world, subAx + 96, subAy, actorB);
    uB = 0.5 + (actorB[0] - camCenterX) / effW;
    vB = 0.5 + (actorB[1] - camCenterY) / effH;
  }

  // 1. HD-2D Wall Extrusion Occlusion Audit
  let occlusionScore = 100;
  for (let i = 0; i < wm.outTiles.length; i++) {
    const t = wm.outTiles[i];
    const ext = t.extrudeH ?? 0;
    if (ext <= 8) continue;
    // South-wall occlusion: a wall tile immediately south of the actor (t.y > subAy) whose extruded top reaches above subAy
    const horizOverlap = subAx >= t.x - 6 && subAx <= t.x + t.w + 6;
    const vertOccludes = t.y > subAy - 4 && t.y - ext < subAy + 6;
    if (horizOverlap && vertOccludes) {
      occlusionScore -= 45;
      issues.push(
        `Primary subject is partially occluded by extruded south wall at (${t.x}, ${t.y}, extrudeH=${ext}).`,
      );
      break;
    }
  }
  if (uA < 0.06 || uA > 0.94 || vA < 0.08 || vA > 0.92) {
    occlusionScore -= 50;
    issues.push(`Primary subject is near/outside screen edge (u=${uA.toFixed(2)}, v=${vA.toFixed(2)}).`);
  }
  occlusionScore = Math.max(0, Math.min(100, occlusionScore));

  // 2. Rule-of-Thirds / Lead-Room / Toric Two-Shot & Letterbox Headroom Composition Score
  let compositionScore = 100;
  const lbMargin = 0.115 * (shot.letterbox ?? 1.0);
  if (vA < lbMargin + 0.05 || vA > 1 - lbMargin - 0.05) {
    compositionScore -= 28;
    issues.push(
      `Subject vertical framing (v=${vA.toFixed(2)}) encroaches on 21:9 letterbox headroom bars.`,
    );
  }

  if (anchor === 'two_shot' && uB !== undefined && vB !== undefined) {
    const spanU = Math.abs(uB - uA);
    if (spanU < 0.14) {
      compositionScore -= 20;
      issues.push(`Two-shot subjects are too cramped horizontally (spanU=${spanU.toFixed(2)}).`);
    } else if (spanU > 0.82) {
      compositionScore -= 25;
      issues.push(`Two-shot subjects are too wide apart and risk edge clipping (spanU=${spanU.toFixed(2)}).`);
    }
  } else {
    resolveScreenAnchorNorm(anchor, actorA[2], actorA[3], expectedUv);
    const anchorErr = Math.hypot(uA - expectedUv[0], vA - expectedUv[1]);
    if (anchorErr > 0.24) {
      const penalty = Math.min(35, Math.round((anchorErr - 0.15) * 90));
      compositionScore -= penalty;
      issues.push(
        `Subject (u=${uA.toFixed(2)}, v=${vA.toFixed(2)}) deviates from target '${anchor}' anchor (${expectedUv[0].toFixed(2)}, ${expectedUv[1].toFixed(2)}) due to room boundary clamp.`,
      );
    }
  }
  compositionScore = Math.max(0, Math.min(100, compositionScore));

  // 3. 180-Degree Axis Continuity Score
  let axisContinuityScore = 100;
  if (anchor === 'two_shot' && uB !== undefined) {
    const currentSign: -1 | 1 = uB >= uA ? 1 : -1;
    if (prevTwoShotAxisSign !== 0 && prevTwoShotAxisSign !== currentSign) {
      axisContinuityScore = 40;
      issues.push('180-Degree Rule violation: primary and secondary subjects flipped left/right screen sides.');
    }
  }

  // 4. Walter Murch Dramaturgy & Pacing Score
  let dramaturgyScore = 100;
  const motion = shot.motion ?? 'spring';
  if ((motion === 'push_in' || motion === 'pull_out' || motion === 'impact_zoom') && !shot.motivation) {
    dramaturgyScore -= 20;
    issues.push(`Unmotivated camera movement '${motion}': specify shot.motivation for Murch dramaturgy clarity.`);
  }
  if (shot.subtitle && shot.subtitle.length > 0) {
    const charsPerSec = shot.subtitle.length / Math.max(0.1, shot.durationSec);
    if (charsPerSec > 32) {
      dramaturgyScore -= 25;
      issues.push(
        `Subtitle pacing too fast (${charsPerSec.toFixed(1)} chars/s); increase durationSec >= ${(shot.subtitle.length / 22).toFixed(1)}s.`,
      );
    }
  }
  if (
    prevShot &&
    (prevShot.shotSize ?? 'MS') === shotSize &&
    (prevShot.anchor ?? 'center') === anchor &&
    prevShot.subject === shot.subject &&
    motion === 'cut'
  ) {
    dramaturgyScore -= 25;
    issues.push('Flat jump-cut detected: consecutive shots share identical subject, shotSize, and anchor.');
  }
  dramaturgyScore = Math.max(0, Math.min(100, dramaturgyScore));

  const shotScore = Math.round(
    occlusionScore * 0.32 +
      compositionScore * 0.30 +
      axisContinuityScore * 0.18 +
      dramaturgyScore * 0.20,
  );

  const asciiViewfinder = renderAsciiViewfinderCard(
    shotIndex,
    shot,
    shotSize,
    anchor,
    uA,
    vA,
    uB,
    vB,
    zoom,
    shotScore,
  );

  return {
    shotId: shot.id,
    shotIndex,
    shotSize,
    anchor,
    durationSec: shot.durationSec,
    subjectScreenU: Number(uA.toFixed(3)),
    subjectScreenV: Number(vA.toFixed(3)),
    secondaryScreenU: uB !== undefined ? Number(uB.toFixed(3)) : undefined,
    secondaryScreenV: vB !== undefined ? Number(vB.toFixed(3)) : undefined,
    cameraZoom: Number(zoom.toFixed(3)),
    tiltShiftBlur: Number(dir.tiltShiftBlur.toFixed(3)),
    occlusionScore,
    compositionScore,
    axisContinuityScore,
    dramaturgyScore,
    shotScore,
    issues,
    asciiViewfinder,
  };
}

function renderAsciiViewfinderCard(
  idx: number,
  shot: EcsCutsceneShotDef,
  shotSize: EcsShotSize,
  anchor: EcsScreenAnchor,
  uA: number,
  vA: number,
  uB: number | undefined,
  vB: number | undefined,
  zoom: number,
  score: number,
): string {
  const W = 21;
  const H = 9;
  const grid: string[][] = [];
  for (let r = 0; r < H; r++) {
    const row: string[] = [];
    for (let c = 0; c < W; c++) {
      if (r === 0 || r === H - 1) {
        row.push('='); // 21:9 Cinema Letterbox Bars
      } else if (r === 3 || r === 5) {
        row.push(c === 7 || c === 13 ? '+' : '-'); // Rule-of-Thirds intersections
      } else if (c === 7 || c === 13) {
        row.push('|');
      } else {
        row.push('.');
      }
    }
    grid.push(row);
  }

  const plotMarker = (u: number, v: number, ch: string) => {
    const c = Math.max(0, Math.min(W - 1, Math.round(u * (W - 1))));
    const r = Math.max(1, Math.min(H - 2, Math.round(v * (H - 1))));
    grid[r][c] = ch;
  };

  if (uB !== undefined && vB !== undefined) {
    plotMarker(uB, vB, 'B');
  }
  plotMarker(uA, vA, 'A');

  const header = `Shot #${idx + 1} [${shot.id}] ${shotSize} · ${anchor} · zoom=${zoom.toFixed(2)}x · ${shot.durationSec}s · Score=${score}`;
  const lines = [header];
  for (let r = 0; r < H; r++) {
    lines.push(`  |${grid[r].join('')}|`);
  }
  if (shot.splashTitle) {
    lines.push(`  [SPLASH] ${shot.splashTitle}${shot.splashSubtitle ? ` — ${shot.splashSubtitle}` : ''}`);
  }
  if (shot.subtitle) {
    lines.push(`  [SUB] ${shot.speaker ? `${shot.speaker}: ` : ''}"${shot.subtitle}"`);
  }
  return lines.join('\n');
}
