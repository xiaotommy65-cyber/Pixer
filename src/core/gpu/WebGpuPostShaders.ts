import { OVERSCAN_PAD } from './GpuTypes.ts';

export const WGSL_COLOR_TRANSFER = /* wgsl */ `
fn srgbToLin(c: vec3f) -> vec3f {
  let sc = max(c, vec3f(0.0));
  let lo = sc * (1.0 / 12.92);
  let hi = pow(max(sc + vec3f(0.055), vec3f(0.09545)) * (1.0 / 1.055), vec3f(2.4));
  return select(hi, lo, sc <= vec3f(0.04045));
}

fn linToSrgb(c: vec3f) -> vec3f {
  let lc = max(c, vec3f(0.0));
  let lo = lc * 12.92;
  let hi = 1.055 * pow(max(lc, vec3f(0.0031308)), vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, lc <= vec3f(0.0031308));
}
`;

export const WGSL_BAYER4X4 = /* wgsl */ `
fn bayer4x4(coord: vec2f) -> f32 {
  let x = u32(floor(max(0.0, coord.x)));
  let y = u32(floor(max(0.0, coord.y)));
  let x0 = x & 1u;
  let y0 = y & 1u;
  let x1 = (x >> 1u) & 1u;
  let y1 = (y >> 1u) & 1u;
  let fine = (((x0 ^ y0) << 1u) | y0) << 2u;
  let coarse = ((x1 ^ y1) << 1u) | y1;
  return (f32(fine | coarse) + 0.5) * 0.0625 - 0.5;
}
`;

export const WGSL_POST_CODE = /* wgsl */ `
struct PostUniforms {
  params0: vec4f, // x: texelX, y: texelY, z: glowIntensity, w: filterMode (0=clean, 1=lcd, 2=crt)
  params1: vec4f, // x: timeSec, y: cozyFilter, z: camFracX, w: camFracY
  params2: vec4f, // x: viewW, y: viewH, z: osW, w: osH
  params3: vec4f, // x: waterLevelNorm, yzw: waterTint
  params4: vec4f, // x: tiltShiftBlur, y: tiltShiftFocusY, z: 0, w: 0
};

@group(0) @binding(0) var<uniform> uPost: PostUniforms;
@group(0) @binding(1) var uTexA: texture_2d<f32>;
@group(0) @binding(2) var uTexB: texture_2d<f32>;
@group(0) @binding(3) var uLinearSamp: sampler;
@group(0) @binding(4) var uNearestSamp: sampler;

struct PostOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

${WGSL_COLOR_TRANSFER}
${WGSL_BAYER4X4}

fn karisWeight(col: vec3f) -> f32 {
  let luma = dot(max(col, vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722));
  return 1.0 / (1.0 + luma);
}

fn acesFilmic(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@vertex
fn vsPost(@builtin(vertex_index) vid: u32) -> PostOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var p = corners[vid];
  var out: PostOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@fragment
fn fsBloomDown(in: PostOut) -> @location(0) vec4f {
  let off = uPost.params0.xy;
  let off2 = off * 2.0;
  let a = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(-off2.x, -off2.y), 0.0).rgb;
  let b = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(0.0, -off2.y), 0.0).rgb;
  let c = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(off2.x, -off2.y), 0.0).rgb;
  let d = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(-off2.x, 0.0), 0.0).rgb;
  let e = textureSampleLevel(uTexA, uLinearSamp, in.uv, 0.0).rgb;
  let f = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(off2.x, 0.0), 0.0).rgb;
  let g = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(-off2.x, off2.y), 0.0).rgb;
  let h = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(0.0, off2.y), 0.0).rgb;
  let i = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(off2.x, off2.y), 0.0).rgb;
  let j = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(-off.x, -off.y), 0.0).rgb;
  let k = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(off.x, -off.y), 0.0).rgb;
  let l = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(-off.x, off.y), 0.0).rgb;
  let m = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(off.x, off.y), 0.0).rgb;

  let g0 = (j + k + l + m) * 0.25;
  let g1 = (a + b + d + e) * 0.25;
  let g2 = (b + c + e + f) * 0.25;
  let g3 = (d + e + g + h) * 0.25;
  let g4 = (e + f + h + i) * 0.25;

  let kw0 = 0.5 * karisWeight(g0);
  let kw1 = 0.125 * karisWeight(g1);
  let kw2 = 0.125 * karisWeight(g2);
  let kw3 = 0.125 * karisWeight(g3);
  let kw4 = 0.125 * karisWeight(g4);
  let avg = (g0 * kw0 + g1 * kw1 + g2 * kw2 + g3 * kw3 + g4 * kw4) / max(kw0 + kw1 + kw2 + kw3 + kw4, 1e-5);

  let br = max(avg.r, max(avg.g, avg.b));
  let soft = clamp(br - 0.02, 0.0, 0.08);
  let contrib = max(br - 0.06, (soft * soft) / 0.16) / max(br, 1e-4);
  return vec4f(max(avg * contrib, vec3f(0.0)), 1.0);
}

@fragment
fn fsBloomBlur(in: PostOut) -> @location(0) vec4f {
  let step = uPost.params0.xy;
  let o1 = step * 1.38461538;
  let o2 = step * 3.23076923;
  var acc = textureSampleLevel(uTexA, uLinearSamp, in.uv, 0.0).rgb * 0.22702703;
  acc += (textureSampleLevel(uTexA, uLinearSamp, in.uv + o1, 0.0).rgb
        + textureSampleLevel(uTexA, uLinearSamp, in.uv - o1, 0.0).rgb) * 0.31621622;
  acc += (textureSampleLevel(uTexA, uLinearSamp, in.uv + o2, 0.0).rgb
        + textureSampleLevel(uTexA, uLinearSamp, in.uv - o2, 0.0).rgb) * 0.07027027;
  return vec4f(acc, 1.0);
}

@fragment
fn fsComposite(in: PostOut) -> @location(0) vec4f {
  let viewSize = max(vec2f(1.0), uPost.params2.xy);
  let osSize = max(vec2f(1.0), uPost.params2.zw);
  let sceneUv = (vec2f(${OVERSCAN_PAD}.0, ${OVERSCAN_PAD}.0) + in.uv * viewSize + uPost.params1.zw) / osSize;
  let waterLevel = uPost.params3.x;
  let inWater = waterLevel > 0.01 && in.uv.y > waterLevel;
  let waterDepth = select(0.0, in.uv.y - waterLevel, inWater);
  var sampleUv = sceneUv;
  if (inWater) {
    let reflY = max(0.0, waterLevel - waterDepth * 0.92);
    let ripplePx = floor(sin(waterDepth * 95.0 + uPost.params1.x * 4.5) * 2.5);
    let rx = (${OVERSCAN_PAD}.0 + in.uv.x * viewSize.x + uPost.params1.z + ripplePx) / osSize.x;
    let ry = (${OVERSCAN_PAD}.0 + reflY * viewSize.y + uPost.params1.w) / osSize.y;
    let minUv = vec2f(${OVERSCAN_PAD}.0) / osSize;
    let maxUv = (vec2f(${OVERSCAN_PAD}.0) + viewSize) / osSize;
    sampleUv = clamp(vec2f(rx, ry), minUv, maxUv);
  }
  var sceneCol = textureSampleLevel(uTexA, uNearestSamp, sampleUv, 0.0).rgb;
  let tiltBlur = clamp(uPost.params4.x, 0.0, 1.0);
  if (tiltBlur > 0.01 && !inWater) {
    let focusY = clamp(uPost.params4.y, 0.1, 0.9);
    let dofBand = smoothstep(0.20, 0.49, abs(in.uv.y - focusY));
    if (dofBand > 0.005) {
      let minUv = vec2f(${OVERSCAN_PAD}.0) / osSize;
      let maxUv = (vec2f(${OVERSCAN_PAD}.0) + viewSize) / osSize;
      let rad = (vec2f(0.9, 1.15) + vec2f(2.1, 2.5) * dofBand * tiltBlur) / osSize;
      let b0 = textureSampleLevel(uTexA, uLinearSamp, clamp(sampleUv + vec2f(-rad.x, -rad.y), minUv, maxUv), 0.0).rgb;
      let b1 = textureSampleLevel(uTexA, uLinearSamp, clamp(sampleUv + vec2f(rad.x, -rad.y), minUv, maxUv), 0.0).rgb;
      let b2 = textureSampleLevel(uTexA, uLinearSamp, clamp(sampleUv + vec2f(-rad.x, rad.y), minUv, maxUv), 0.0).rgb;
      let b3 = textureSampleLevel(uTexA, uLinearSamp, clamp(sampleUv + vec2f(rad.x, rad.y), minUv, maxUv), 0.0).rgb;
      let bokeh = (sceneCol * 0.2 + (b0 + b1 + b2 + b3) * 0.2);
      sceneCol = mix(sceneCol, bokeh, dofBand * tiltBlur * 0.85);
    }
  }
  let glow = max(0.0, uPost.params0.z);
  var col = sceneCol;

  if (glow > 0.01) {
    let bloom = textureSampleLevel(uTexB, uLinearSamp, sampleUv, 0.0).rgb;
    let sceneLin = srgbToLin(sceneCol);
    let bloomLin = srgbToLin(bloom) * glow * 1.15;
    let hdrLin = sceneLin + bloomLin;
    let bloomEnergy = max(bloomLin.r, max(bloomLin.g, bloomLin.b));
    let toneMapped = acesFilmic(hdrLin * 1.2) / acesFilmic(vec3f(3.6));
    let toneBlend = smoothstep(0.0, 0.45, bloomEnergy);
    let outLin = mix(clamp(hdrLin, vec3f(0.0), vec3f(1.0)), toneMapped, toneBlend);
    col = linToSrgb(outLin);
  }

  if (inWater) {
    let waterTint = uPost.params3.yzw;
    let depthNorm = clamp(waterDepth / max(0.05, 1.0 - waterLevel), 0.0, 1.0);
    let tintBlend = clamp(0.38 + depthNorm * 0.36, 0.0, 0.85);
    let depthDarken = 1.0 - depthNorm * 0.34;
    col = mix(col * 0.88, waterTint, tintBlend) * depthDarken;
    if (waterDepth < 1.5 / viewSize.y) {
      let shimmer = 0.65 + 0.35 * sin(in.uv.x * viewSize.x * 0.35 + uPost.params1.x * 5.0);
      col = mix(col, min(vec3f(1.0), waterTint * 1.45 + vec3f(0.35)), 0.65 * shimmer);
    }
  }

  let mode = uPost.params0.w;
  let centered = in.uv - vec2f(0.5);
  let r2 = dot(centered, centered);

  if (mode > 1.5) {
    // Console CRT post: scanline + subtle phosphor aperture + soft vignette
    let scan = 0.94 + 0.06 * sin(in.uv.y * viewSize.y * 6.28318);
    let maskPhase = in.uv.x * viewSize.x * 3.14159;
    let triad = vec3f(
      0.98 + 0.025 * sin(maskPhase),
      0.98 + 0.025 * sin(maskPhase + 2.094),
      0.98 + 0.025 * sin(maskPhase + 4.188)
    );
    let vig = clamp(1.0 - r2 * 0.24, 0.76, 1.0);
    col = col * scan * triad * vig;
  } else if (mode > 0.5) {
    // Handheld LCD post: crisp pixel subgrid + warm contrast
    let gx = 0.97 + 0.03 * cos(in.uv.x * viewSize.x * 6.28318);
    let gy = 0.97 + 0.03 * cos(in.uv.y * viewSize.y * 6.28318);
    let vig = clamp(1.0 - r2 * 0.12, 0.88, 1.0);
    col = col * (gx * gy * vig) * vec3f(1.01, 1.005, 0.985);
  } else if (uPost.params1.y > 0.5) {
    let vig = clamp(1.0 - r2 * 0.06, 0.94, 1.0);
    col *= vig;
  }

  col += vec3f(bayer4x4(in.pos.xy) * (1.0 / 255.0));
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
