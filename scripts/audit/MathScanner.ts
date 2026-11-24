/// <reference types="node" />
import path from 'node:path';
import { hexToRgb01Into, mixOklabRgb01 } from '../../src/core/math/ColorMath.ts';
import { simplex2D } from '../../src/core/math/NoiseMath.ts';
import { raycastGrid2DInto } from '../../src/core/math/Visibility2D.ts';
import { GameFlowController } from '../../src/core/runtime/GameFlowController.ts';
import {
  findAllMatchingLines,
  findFirstLine,
  readTextSafe,
  relPosix,
  walkFiles,
  type AuditFinding,
  type AuditOptions,
  type AuditSectionReport,
} from './AuditTypes.ts';

function runLiveMathProbes(findings: AuditFinding[]): Record<string, string | number | boolean> {
  let probesRun = 0;
  let probesFailed = 0;

  // 1. NoiseMath high-16-bit seed sensitivity
  probesRun++;
  const n0 = simplex2D(1.37, 2.91, 0);
  const nHi = simplex2D(1.37, 2.91, 0x00010000);
  if (Math.abs(n0 - nHi) < 1e-12) {
    probesFailed++;
    findings.push({
      id: 'MATH-NOISE-SEED16',
      severity: 'critical',
      category: 'math',
      file: 'src/core/math/NoiseMath.ts',
      line: 85,
      message: 'NoiseMath ignores upper 16 bits of 32-bit seed (seed=0x00010000 equals seed=0).',
    });
  }

  // 2. ColorMath malformed hex check & extreme chroma check
  probesRun++;
  const badHexOut = new Float32Array(3);
  hexToRgb01Into('#ff00zz', badHexOut);
  if (badHexOut[0] !== 1 || badHexOut[1] !== 1 || badHexOut[2] !== 1) {
    probesFailed++;
    findings.push({
      id: 'MATH-COLOR-HEX',
      severity: 'warn',
      category: 'math',
      file: 'src/core/math/ColorMath.ts',
      line: 52,
      message: `hexToRgb01Into("#ff00zz") silently parsed partial hex (${badHexOut[0].toFixed(2)},${badHexOut[1].toFixed(2)},${badHexOut[2].toFixed(2)}) instead of fallback white.`,
    });
  }

  probesRun++;
  const extremeOut = new Float32Array(3);
  mixOklabRgb01(0, 1, 0, 1, 0, 1, 0.5, extremeOut);
  if (!Number.isFinite(extremeOut[0])) {
    probesFailed++;
  }

  // 3. Visibility2D DDA corner hit normal unit length
  probesRun++;
  const ddaHit = new Float64Array(8);
  const isCornerOpaque = (cx: number, cy: number): boolean => cx === 2 && cy === 2;
  const didHit = raycastGrid2DInto(8, 8, 0.5, 0.5, Math.SQRT1_2, Math.SQRT1_2, 10, isCornerOpaque, ddaHit);
  const normLen = Math.hypot(ddaHit[4], ddaHit[5]);
  if (didHit && Math.abs(normLen - 1.0) > 1e-4) {
    probesFailed++;
    findings.push({
      id: 'MATH-DDA-CORNER-NORM',
      severity: 'warn',
      category: 'math',
      file: 'src/core/math/Visibility2D.ts',
      line: 386,
      message: `DDA corner hit normal is non-unit length (${normLen.toFixed(4)} != 1.0).`,
    });
  }

  // 4. GameFlowController return contract sanity (expected 'none' | 'intro_complete')
  probesRun++;
  const gfc = new GameFlowController();
  const stepRet = gfc.step(1 / 60);
  if (stepRet !== 'none' && stepRet !== 'intro_complete') {
    probesFailed++;
    findings.push({
      id: 'WIRING-GAMEFLOW-CONTRACT',
      severity: 'critical',
      category: 'arch',
      file: 'src/core/runtime/GameFlowController.ts',
      line: 187,
      message: `Unexpected GameFlowController.step() return value: "${String(stepRet)}".`,
    });
  }

  return { probesRun, probesFailed };
}

function scanMathAndShaderSources(rootDir: string, findings: AuditFinding[]): number {
  let checks = 0;

  const springSrc = readTextSafe(path.join(rootDir, 'src/core/math/SpringDynamics.ts'));
  checks++;
  if (/\*\s*damp\b/.test(springSrc) && !/Math\.pow\s*\(\s*damp/.test(springSrc)) {
    findings.push({
      id: 'MATH-VERLET-DT',
      severity: 'warn',
      category: 'math',
      file: 'src/core/math/SpringDynamics.ts',
      line: findFirstLine(springSrc, /\*\s*damp\b/),
      message: 'Verlet damping multiplies raw `damp` without dt-normalization (`Math.pow(damp, dt * 60)`).',
    });
  }

  const spatialSrc = readTextSafe(path.join(rootDir, 'src/core/math/SpatialHash.ts'));
  checks++;
  if (/const\s+cx1\s*=\s*Math\.floor\s*\(\s*hiX\s*\*\s*inv\s*\)/.test(spatialSrc)) {
    findings.push({
      id: 'MATH-SPATIAL-4X',
      severity: 'warn',
      category: 'math',
      file: 'src/core/math/SpatialHash.ts',
      line: findFirstLine(spatialSrc, /const\s+cx1\s*=\s*Math\.floor\s*\(\s*hiX\s*\*\s*inv\s*\)/),
      message: 'Half-open [0, cellSize) AABB uses floor(hiX * inv) instead of ceil(hiX * inv) - 1 (4x bucket bloat).',
    });
  }

  const orthoSrc = readTextSafe(path.join(rootDir, 'src/core/sim/OrthogonalArt.ts'));
  checks++;
  if (/while\s*\([^)]*Math\.PI/.test(orthoSrc)) {
    findings.push({
      id: 'MATH-UNBOUNDED-WRAP',
      severity: 'info',
      category: 'math',
      file: 'src/core/sim/OrthogonalArt.ts',
      line: findFirstLine(orthoSrc, /while\s*\([^)]*Math\.PI/),
      message: 'Angle wrap uses unbounded `while` loop instead of O(1) modulo.',
    });
  }

  const runtimeSrc = readTextSafe(path.join(rootDir, 'src/core/ecs/EcsCartridgeRuntime.ts'));
  checks++;
  if (/const\s+transitionedToPlay\s*=\s*this\.gameFlow\.step/.test(runtimeSrc) && /if\s*\(\s*transitionedToPlay\s*\)/.test(runtimeSrc)) {
    findings.push({
      id: 'WIRING-CAMERARIG-CLOBBER',
      severity: 'critical',
      category: 'arch',
      file: 'src/core/ecs/EcsCartridgeRuntime.ts',
      line: findFirstLine(runtimeSrc, /if\s*\(\s*transitionedToPlay\s*\)/),
      message: '`if (transitionedToPlay)` is always truthy (`"none"`/`"intro_complete"`), resetting cameraRig every frame.',
    });
  }

  // Scan all src/*.ts callers of gameFlow.step(...) for unguarded bare boolean checks `if (var)`
  checks++;
  for (const abs of walkFiles(rootDir, 'src', ['.ts'])) {
    const srcText = readTextSafe(abs);
    const assignRe = /const\s+(\w+)\s*=\s*[\w.]*gameFlow\.step\s*\(/g;
    let m: RegExpExecArray | null = assignRe.exec(srcText);
    while (m !== null) {
      const varName = m[1];
      const bareIfRe = new RegExp(`if\\s*\\(\\s*${varName}\\s*\\)`);
      if (bareIfRe.test(srcText)) {
        findings.push({
          id: 'WIRING-GAMEFLOW-TRUTHY',
          severity: 'critical',
          category: 'arch',
          file: relPosix(rootDir, abs),
          line: findFirstLine(srcText, bareIfRe),
          message: `Caller checks \`if (${varName})\` on \`gameFlow.step()\` which returns truthy \`"none"\`; compare \`=== 'intro_complete'\`.`,
        });
      }
      m = assignRe.exec(srcText);
    }
  }

  const worldMapSrc = readTextSafe(path.join(rootDir, 'src/core/ecs/EcsWorldMapController.ts'));
  checks++;
  const clobberMatch = worldMapSrc.match(/targetCamX\s*=\s*heroCx[\s\S]{0,450}this\.director\.cameraX\s*=\s*this\.cameraX/);
  if (clobberMatch && clobberMatch.index !== undefined) {
    const lineNum = worldMapSrc.slice(0, clobberMatch.index).split(/\r?\n/).length;
    findings.push({
      id: 'WIRING-DIRECTOR-CLOBBER',
      severity: 'critical',
      category: 'arch',
      file: 'src/core/ecs/EcsWorldMapController.ts',
      line: lineNum,
      message: 'EcsWorldMapController overwrites EcsCinematicDirector live lead-room/Toric cameraX/Y every idle frame.',
    });
  }

  const directorSrc = readTextSafe(path.join(rootDir, 'src/core/ecs/EcsCinematicDirector.ts'));
  checks++;
  if (/this\.pitchDeltaDeg\s*\*=\s*1\s*-\s*t/.test(directorSrc)) {
    findings.push({
      id: 'MATH-HANDBACK-MULT',
      severity: 'warn',
      category: 'math',
      file: 'src/core/ecs/EcsCinematicDirector.ts',
      line: findFirstLine(directorSrc, /this\.pitchDeltaDeg\s*\*=\s*1\s*-\s*t/),
      message: 'Handback applies multiplicative `*= (1 - t)` per frame, collapsing pitchDeltaDeg in ~10 frames.',
    });
  }

  // GPU Shader parity & PBR checks
  const wgslSrc = readTextSafe(path.join(rootDir, 'src/core/gpu/WebGpuShaders.ts'));
  const glslSrc = readTextSafe(path.join(rootDir, 'src/core/gpu/WebGl2Shaders.ts'));
  const wgpuBackendSrc = readTextSafe(path.join(rootDir, 'src/core/gpu/WebGpuBackend.ts'));
  const gl2BackendSrc = readTextSafe(path.join(rootDir, 'src/core/gpu/WebGl2Backend.ts'));

  checks++;
  if (/mix\s*\(\s*vec3f?\s*\(\s*0\.95\s*\)/.test(wgslSrc)) {
    findings.push({
      id: 'SHADER-FAKE-PBR-F0',
      severity: 'warn',
      category: 'shader',
      file: 'src/core/gpu/WebGpuShaders.ts',
      line: findFirstLine(wgslSrc, /mix\s*\(\s*vec3f?\s*\(\s*0\.95\s*\)/),
      message: 'Non-physical dielectric F0=0.95 & metallic >1.0 in PBR-Lite shader (true dielectric F0 is 0.04).',
    });
  }

  checks++;
  const fixedRayMatches = findAllMatchingLines(wgslSrc, /for\s*\(\s*var\s+s\s*:\s*i32\s*=\s*1;\s*s\s*<=\s*14/);
  if (fixedRayMatches.length > 0) {
    findings.push({
      id: 'SHADER-SHADOW-TUNNEL',
      severity: 'warn',
      category: 'shader',
      file: 'src/core/gpu/WebGpuShaders.ts',
      line: fixedRayMatches[0],
      message: `Fixed 14-step uniform shadow march (${fixedRayMatches.length} loops) can tunnel through 1-tile walls at dist>15.`,
    });
  }

  checks++;
  if (/pass1b\.setBindGroup\s*\(\s*0\s*,\s*this\.pass1BindGroup\s*\)/.test(wgpuBackendSrc)) {
    findings.push({
      id: 'SHADER-PARITY-PASS1B',
      severity: 'critical',
      category: 'shader',
      file: 'src/core/gpu/WebGpuBackend.ts',
      line: findFirstLine(wgpuBackendSrc, /pass1b\.setBindGroup/),
      message: 'WGSL/GLSL parity bug: WebGPU Pass 1B rebinds 3D world-space lights onto 2D HUD overlays.',
    });
  }

  checks++;
  if (/TEXTURE_MAG_FILTER\s*,\s*gl\.NEAREST/.test(gl2BackendSrc) && glslSrc.includes('tiltShift')) {
    findings.push({
      id: 'SHADER-PARITY-DOF-SAMPLER',
      severity: 'warn',
      category: 'shader',
      file: 'src/core/gpu/WebGl2Backend.ts',
      line: findFirstLine(gl2BackendSrc, /TEXTURE_MAG_FILTER\s*,\s*gl\.NEAREST/),
      message: 'WGSL/GLSL parity bug: WebGL2 sceneTex uses NEAREST (blocky tilt-shift bokeh vs WebGPU LINEAR).',
    });
  }

  return checks;
}

export function runMathScanner(opts: AuditOptions): AuditSectionReport {
  const findings: AuditFinding[] = [];
  const staticChecks = scanMathAndShaderSources(opts.rootDir, findings);
  const liveSummary = runLiveMathProbes(findings);

  return {
    name: 'Math, Physics, Director & Shader Audit',
    summary: {
      staticChecks,
      ...liveSummary,
      findingsCount: findings.length,
    },
    findings,
  };
}
