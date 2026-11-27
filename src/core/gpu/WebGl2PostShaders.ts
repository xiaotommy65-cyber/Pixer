import { OVERSCAN_PAD } from './GpuTypes.ts';

export const GLSL_COLOR_TRANSFER = `
vec3 srgbToLin(vec3 c) {
  vec3 sc = max(c, vec3(0.0));
  vec3 lo = sc * (1.0 / 12.92);
  vec3 hi = pow(max(sc + vec3(0.055), vec3(0.09545)) * (1.0 / 1.055), vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), sc));
}

vec3 linToSrgb(vec3 c) {
  vec3 lc = max(c, vec3(0.0));
  vec3 lo = lc * 12.92;
  vec3 hi = 1.055 * pow(max(lc, vec3(0.0031308)), vec3(1.0 / 2.4)) - vec3(0.055);
  return mix(lo, hi, step(vec3(0.0031308), lc));
}
`;

export const GLSL_BAYER4X4 = `
float bayer4x4(vec2 coord) {
  uint x = uint(floor(max(0.0, coord.x)));
  uint y = uint(floor(max(0.0, coord.y)));
  uint x0 = x & 1u;
  uint y0 = y & 1u;
  uint x1 = (x >> 1u) & 1u;
  uint y1 = (y >> 1u) & 1u;
  uint fine = (((x0 ^ y0) << 1u) | y0) << 2u;
  uint coarse = ((x1 ^ y1) << 1u) | y1;
  return (float(fine | coarse) + 0.5) * 0.0625 - 0.5;
}
`;

export const POST_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corners[6] = vec2[6](
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0)
  );
  vec2 p = corners[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const BLOOM_DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexA;
uniform vec2 uTexelOffset;
out vec4 fragColor;
float karisWeight(vec3 col) {
  float luma = dot(max(col, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
  return 1.0 / (1.0 + luma);
}
void main() {
  vec2 off = uTexelOffset;
  vec2 off2 = off * 2.0;
  vec3 a = texture(uTexA, vUv + vec2(-off2.x, -off2.y)).rgb;
  vec3 b = texture(uTexA, vUv + vec2(0.0, -off2.y)).rgb;
  vec3 c = texture(uTexA, vUv + vec2(off2.x, -off2.y)).rgb;
  vec3 d = texture(uTexA, vUv + vec2(-off2.x, 0.0)).rgb;
  vec3 e = texture(uTexA, vUv).rgb;
  vec3 f = texture(uTexA, vUv + vec2(off2.x, 0.0)).rgb;
  vec3 g = texture(uTexA, vUv + vec2(-off2.x, off2.y)).rgb;
  vec3 h = texture(uTexA, vUv + vec2(0.0, off2.y)).rgb;
  vec3 i = texture(uTexA, vUv + vec2(off2.x, off2.y)).rgb;
  vec3 j = texture(uTexA, vUv + vec2(-off.x, -off.y)).rgb;
  vec3 k = texture(uTexA, vUv + vec2(off.x, -off.y)).rgb;
  vec3 l = texture(uTexA, vUv + vec2(-off.x, off.y)).rgb;
  vec3 m = texture(uTexA, vUv + vec2(off.x, off.y)).rgb;

  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25;
  vec3 g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25;
  vec3 g4 = (e + f + h + i) * 0.25;

  float kw0 = 0.5 * karisWeight(g0);
  float kw1 = 0.125 * karisWeight(g1);
  float kw2 = 0.125 * karisWeight(g2);
  float kw3 = 0.125 * karisWeight(g3);
  float kw4 = 0.125 * karisWeight(g4);
  vec3 avg = (g0 * kw0 + g1 * kw1 + g2 * kw2 + g3 * kw3 + g4 * kw4) / max(kw0 + kw1 + kw2 + kw3 + kw4, 1e-5);

  float br = max(avg.r, max(avg.g, avg.b));
  float soft = clamp(br - 0.02, 0.0, 0.08);
  float contrib = max(br - 0.06, (soft * soft) / 0.16) / max(br, 1e-4);
  fragColor = vec4(max(avg * contrib, vec3(0.0)), 1.0);
}`;

export const BLOOM_BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexA;
uniform vec2 uBlurStep;
out vec4 fragColor;
void main() {
  vec2 o1 = uBlurStep * 1.38461538;
  vec2 o2 = uBlurStep * 3.23076923;
  vec3 acc = texture(uTexA, vUv).rgb * 0.22702703;
  acc += (texture(uTexA, vUv + o1).rgb + texture(uTexA, vUv - o1).rgb) * 0.31621622;
  acc += (texture(uTexA, vUv + o2).rgb + texture(uTexA, vUv - o2).rgb) * 0.07027027;
  fragColor = vec4(acc, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uSceneTex;
uniform sampler2D uSceneLinearTex;
uniform sampler2D uBloomTex;
uniform float uGlowIntensity;
uniform float uFilterMode;
uniform float uCozyFilter;
uniform vec2 uCamFrac;
uniform vec2 uViewSize;
uniform float uWaterLevel;
uniform vec3 uWaterTint;
uniform float uTimeSec;
uniform vec2 uTiltShift; // x: blurIntensity 0..1, y: focusY 0.1..0.9
uniform vec2 uOutputSize;
out vec4 fragColor;
${GLSL_COLOR_TRANSFER}
${GLSL_BAYER4X4}
vec3 acesFilmic(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3(0.0), vec3(1.0));
}
void main() {
  vec2 viewSize = max(vec2(1.0), uViewSize);
  vec2 osSize = viewSize + vec2(${OVERSCAN_PAD}.0 * 2.0);
  vec2 sceneUv = vec2(
    (${OVERSCAN_PAD}.0 + vUv.x * viewSize.x + uCamFrac.x) / osSize.x,
    (${OVERSCAN_PAD}.0 + vUv.y * viewSize.y - uCamFrac.y) / osSize.y
  );
  float screenY = 1.0 - vUv.y;
  bool inWater = uWaterLevel > 0.01 && screenY > uWaterLevel;
  float waterDepth = inWater ? (screenY - uWaterLevel) : 0.0;
  vec2 sampleUv = sceneUv;
  if (inWater) {
    float reflNormY = max(0.0, uWaterLevel - waterDepth * 0.92);
    float reflV = 1.0 - reflNormY;
    float ripplePx = floor(sin(waterDepth * 95.0 + uTimeSec * 4.5) * 2.5);
    float rx = (${OVERSCAN_PAD}.0 + vUv.x * viewSize.x + uCamFrac.x + ripplePx) / osSize.x;
    float ry = (${OVERSCAN_PAD}.0 + reflV * viewSize.y - uCamFrac.y) / osSize.y;
    vec2 minUv = vec2(${OVERSCAN_PAD}.0) / osSize;
    vec2 maxUv = (vec2(${OVERSCAN_PAD}.0) + viewSize) / osSize;
    sampleUv = clamp(vec2(rx, ry), minUv, maxUv);
  }
  vec3 sceneCol = texture(uSceneTex, sampleUv).rgb;
  float tiltBlur = clamp(uTiltShift.x, 0.0, 1.0);
  if (tiltBlur > 0.01 && !inWater) {
    float focusY = clamp(uTiltShift.y, 0.1, 0.9);
    float dofBand = smoothstep(0.20, 0.49, abs(screenY - focusY));
    if (dofBand > 0.005) {
      vec2 minUv = vec2(${OVERSCAN_PAD}.0) / osSize;
      vec2 maxUv = (vec2(${OVERSCAN_PAD}.0) + viewSize) / osSize;
      vec2 rad = (vec2(0.9, 1.15) + vec2(2.1, 2.5) * dofBand * tiltBlur) / osSize;
      vec3 b0 = texture(uSceneLinearTex, clamp(sampleUv + vec2(-rad.x, -rad.y), minUv, maxUv)).rgb;
      vec3 b1 = texture(uSceneLinearTex, clamp(sampleUv + vec2(rad.x, -rad.y), minUv, maxUv)).rgb;
      vec3 b2 = texture(uSceneLinearTex, clamp(sampleUv + vec2(-rad.x, rad.y), minUv, maxUv)).rgb;
      vec3 b3 = texture(uSceneLinearTex, clamp(sampleUv + vec2(rad.x, rad.y), minUv, maxUv)).rgb;
      vec3 bokeh = sceneCol * 0.2 + (b0 + b1 + b2 + b3) * 0.2;
      sceneCol = mix(sceneCol, bokeh, dofBand * tiltBlur * 0.85);
    }
  }
  vec3 col = sceneCol;

  if (uGlowIntensity > 0.01) {
    vec3 bloom = texture(uBloomTex, sampleUv).rgb;
    vec3 sceneLin = srgbToLin(sceneCol);
    vec3 bloomLin = srgbToLin(bloom) * uGlowIntensity * 1.15;
    vec3 hdrLin = sceneLin + bloomLin;
    float bloomEnergy = max(bloomLin.r, max(bloomLin.g, bloomLin.b));
    vec3 toneMapped = acesFilmic(hdrLin * 1.2) / acesFilmic(vec3(3.6));
    float toneBlend = smoothstep(0.0, 0.45, bloomEnergy);
    vec3 outLin = mix(clamp(hdrLin, vec3(0.0), vec3(1.0)), toneMapped, toneBlend);
    col = linToSrgb(outLin);
  }

  if (inWater) {
    float depthNorm = clamp(waterDepth / max(0.05, 1.0 - uWaterLevel), 0.0, 1.0);
    float tintBlend = clamp(0.38 + depthNorm * 0.36, 0.0, 0.85);
    float depthDarken = 1.0 - depthNorm * 0.34;
    col = mix(col * 0.88, uWaterTint, tintBlend) * depthDarken;
    if (waterDepth < 1.5 / viewSize.y) {
      float shimmer = 0.65 + 0.35 * sin(vUv.x * viewSize.x * 0.35 + uTimeSec * 5.0);
      col = mix(col, min(vec3(1.0), uWaterTint * 1.45 + vec3(0.35)), 0.65 * shimmer);
    }
  }

  vec2 centered = vUv - vec2(0.5);
  float r2 = dot(centered, centered);

  if (uFilterMode > 1.5) {
    float scan = 0.94 + 0.06 * sin(screenY * viewSize.y * 6.28318);
    float maskPhase = vUv.x * viewSize.x * 3.14159;
    vec3 triad = vec3(
      0.98 + 0.025 * sin(maskPhase),
      0.98 + 0.025 * sin(maskPhase + 2.094),
      0.98 + 0.025 * sin(maskPhase + 4.188)
    );
    float vig = clamp(1.0 - r2 * 0.24, 0.76, 1.0);
    col = col * scan * triad * vig;
  } else if (uFilterMode > 0.5) {
    float gx = 0.97 + 0.03 * cos(vUv.x * viewSize.x * 6.28318);
    float gy = 0.97 + 0.03 * cos(screenY * viewSize.y * 6.28318);
    float vig = clamp(1.0 - r2 * 0.12, 0.88, 1.0);
    col = col * (gx * gy * vig) * vec3(1.01, 1.005, 0.985);
  } else if (uCozyFilter > 0.5) {
    float vig = clamp(1.0 - r2 * 0.06, 0.94, 1.0);
    col *= vig;
  }

  float bayerY = uOutputSize.y > 0.5 ? max(0.0, uOutputSize.y - gl_FragCoord.y) : (screenY * viewSize.y);
  col += vec3(bayer4x4(vec2(gl_FragCoord.x, bayerY)) * (1.0 / 255.0));
  fragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);
}`;
