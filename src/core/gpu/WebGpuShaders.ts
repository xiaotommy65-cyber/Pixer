import { GAME_H, GAME_W } from './GpuTypes.ts';

export const WGSL_CODE = /* wgsl */ `
struct SkyUniforms {
  topColor: vec4f,
  bottomColor: vec4f,
  params: vec4f, // x: timeSec, y: cozyFilter (1 or 0), z: viewW, w: viewH
  extra: vec4f,  // x: paletteRows
};

@group(0) @binding(0) var<uniform> uSky: SkyUniforms;
@group(0) @binding(1) var uAtlas: texture_2d<f32>;
@group(0) @binding(2) var uSamp: sampler;
@group(0) @binding(3) var uIndexAtlas: texture_2d<f32>;
@group(0) @binding(4) var uPaletteLut: texture_2d<f32>;

struct SkyOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

struct SceneOut {
  @location(0) color: vec4f,
  @location(1) emissive: vec4f,
};

@vertex
fn vsSky(@builtin(vertex_index) vid: u32) -> SkyOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var p = corners[vid];
  var out: SkyOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@fragment
fn fsSky(in: SkyOut) -> SceneOut {
  let y = clamp(in.uv.y, 0.0, 1.0);
  let horizonGlow = pow(y, 2.4) * 0.045 * (0.85 + 0.15 * sin(uSky.params.x * 0.7 + in.uv.x * 3.14159));
  var col = mix(uSky.topColor.rgb, uSky.bottomColor.rgb, y) + uSky.bottomColor.rgb * horizonGlow;
  if (uSky.params.y > 0.5) {
    let gridY = 0.985 + 0.015 * sin(in.uv.y * 180.0 * 6.28318);
    col *= gridY;
  }
  var out: SceneOut;
  out.color = vec4f(col, 1.0);
  out.emissive = vec4f(0.0, 0.0, 0.0, 1.0);
  return out;
}

struct InstanceIn {
  @location(0) rectPosSize: vec4f, // x, y, w, h
  @location(1) uvBounds: vec4f,    // u0, v0, u1, v1
  @location(2) tint: vec4f,        // r, g, b, a
  @location(3) extra: vec4f,       // x: rot, y: mode (0..5), z: flash, w: param
  @location(4) deform: vec4f,      // x: pivotX, y: pivotY, z: skewX, w: paletteRow
};

struct SpriteOut {
  @builtin(position) pos: vec4f,
  @location(0) texUv: vec2f,
  @location(1) localUv: vec2f,
  @location(2) tint: vec4f,
  @location(3) mode: f32,
  @location(4) flash: f32,
  @location(5) param: f32,
  @location(6) uvBounds: vec4f,
  @location(7) paletteRow: f32,
};

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

@vertex
fn vsSprite(@builtin(vertex_index) vid: u32, inst: InstanceIn) -> SpriteOut {
  var uvUnit = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );

  let u01 = uvUnit[vid];
  let pivot = inst.deform.xy;
  let skewX = inst.deform.z;
  let local = (u01 - pivot) * inst.rectPosSize.zw;
  let sheared = vec2f(local.x - local.y * skewX, local.y);

  let c = cos(inst.extra.x);
  let s = sin(inst.extra.x);
  let rotated = vec2f(
    sheared.x * c - sheared.y * s,
    sheared.x * s + sheared.y * c
  );
  let world = inst.rectPosSize.xy + rotated;

  let ndcX = (world.x / ${GAME_W}.0) * 2.0 - 1.0;
  let ndcY = 1.0 - (world.y / ${GAME_H}.0) * 2.0;

  var out: SpriteOut;
  out.pos = vec4f(ndcX, ndcY, 0.0, 1.0);
  out.texUv = mix(inst.uvBounds.xy, inst.uvBounds.zw, u01);
  out.localUv = u01;
  out.tint = inst.tint;
  out.mode = inst.extra.y;
  out.flash = inst.extra.z;
  out.param = inst.extra.w;
  out.uvBounds = inst.uvBounds;
  out.paletteRow = inst.deform.w;
  return out;
}

@fragment
fn fsSprite(in: SpriteOut) -> SceneOut {
  var out: SceneOut;

  // Mode 5: Smooth atmospheric gradient & tilt-shift vignette
  if (in.mode > 4.5) {
    let dir = in.uvBounds.x;
    let pwr = max(0.35, in.param);
    var fade = 0.0;
    if (dir < 0.5) {
      fade = pow(clamp(1.0 - in.localUv.y, 0.0, 1.0), pwr);
    } else if (dir < 1.5) {
      fade = pow(clamp(in.localUv.y, 0.0, 1.0), pwr);
    } else {
      let d = length((in.localUv - vec2f(0.5)) * vec2f(1.5, 1.9));
      fade = smoothstep(0.45, 1.25, d);
    }
    let a = in.tint.a * fade;
    out.color = vec4f(in.tint.rgb, a);
    out.emissive = vec4f(0.0, 0.0, 0.0, a);
    return out;
  }

  // Mode 4: Procedural normal-lit beveled masonry / earth / timber / astral facade
  if (in.mode > 3.5) {
    let tx = max(0.5, in.uvBounds.x);
    let ty = max(0.25, in.uvBounds.y);
    let seed = in.uvBounds.z;
    let mat = in.param;
    let coord = vec2f(in.localUv.x * tx, in.localUv.y * ty);

    var nx = 0.0;
    var ny = 0.0;
    var mortarMask = 1.0;
    var cellTint = 0.0;
    var runeAccent = 0.0;

    if (mat > 0.5 && mat < 1.5) {
      let wave = sin(coord.x * 4.4 + seed) * 0.14;
      let strata = fract(coord.y * 2.2 + wave);
      ny = (strata - 0.5) * 0.75;
      nx = cos(coord.x * 4.4 + seed) * 0.25;
      mortarMask = smoothstep(0.0, 0.14, strata) * smoothstep(1.0, 0.86, strata);
      cellTint = (hash21(floor(coord * 3.5) + seed) - 0.5) * 0.14;
    } else if (mat >= 1.5 && mat < 2.5) {
      let panel = fract(coord.x * 1.5);
      let rivetDist = length(vec2f(panel - 0.5, in.localUv.y - 0.52) * vec2f(2.4, 2.0));
      nx = (0.5 - panel) * 0.35;
      ny = (in.localUv.y - 0.5) * 0.5;
      mortarMask = 0.82 + 0.18 * smoothstep(0.0, 0.12, min(panel, 1.0 - panel));
      if (rivetDist < 0.28) {
        runeAccent = (1.0 - rivetDist / 0.28) * 0.24;
      }
    } else {
      let row = floor(coord.y * 2.0);
      let stagger = fract(row * 0.5) * 0.5;
      let brickUv = vec2f(fract(coord.x * 1.45 + stagger), fract(coord.y * 2.0));
      let brickId = vec2f(floor(coord.x * 1.45 + stagger), row);
      cellTint = (hash21(brickId + seed) - 0.5) * 0.15;

      let bevel = 0.16;
      if (brickUv.x < bevel) { nx = -0.65; }
      else if (brickUv.x > 1.0 - bevel) { nx = 0.65; }
      if (brickUv.y < bevel) { ny = -0.75; }
      else if (brickUv.y > 1.0 - bevel) { ny = 0.75; }

      let edgeDist = min(min(brickUv.x, 1.0 - brickUv.x), min(brickUv.y, 1.0 - brickUv.y));
      mortarMask = mix(0.56, 1.0, smoothstep(0.02, 0.13, edgeDist));
      if (mat > 2.5 && edgeDist < 0.08) {
        runeAccent = 0.18;
      }
    }

    if (in.localUv.y < 0.16) { ny -= 0.7; }
    if (in.localUv.y > 0.88) { ny += 0.65; }
    if (in.localUv.x < 0.06) { nx -= 0.45; }
    if (in.localUv.x > 0.94) { nx += 0.45; }

    let n = normalize(vec3f(nx, ny, 1.0));
    let lightDir = normalize(vec3f(-0.42, -0.78, 0.46));
    let ndl = clamp(dot(n, lightDir), 0.2, 1.28);
    let aoBottom = mix(1.04, 0.58, smoothstep(0.22, 1.0, in.localUv.y));
    let topRim = smoothstep(0.14, 0.0, in.localUv.y) * 0.24;
    let grain = (hash21(floor(coord * 8.0) + seed) - 0.5) * 0.06;

    var baseCol = in.tint.rgb * (1.0 + cellTint + grain) * mortarMask * ndl * aoBottom;
    baseCol += vec3f(topRim + runeAccent * 0.6, topRim + runeAccent * 0.45, topRim * 1.1 + runeAccent);
    let sideSoft = smoothstep(0.0, 0.04, in.localUv.x) * smoothstep(1.0, 0.96, in.localUv.x);
    let finalAlpha = in.tint.a * mix(0.75, 1.0, sideSoft);
    out.color = vec4f(clamp(baseCol, vec3f(0.0), vec3f(1.0)), finalAlpha);
    out.emissive = vec4f(0.0, 0.0, 0.0, finalAlpha);
    return out;
  }

  // Mode 3: Smooth analytical SDF elliptical soft contact shadow
  if (in.mode > 2.5) {
    let p = in.localUv * 2.0 - vec2f(1.0);
    let d2 = dot(p, p);
    if (d2 >= 1.0) {
      discard;
    }
    let d = sqrt(d2);
    let soft = clamp(in.param, 0.15, 0.98);
    let outer = smoothstep(1.0, 1.0 - soft, d);
    let umbra = smoothstep(0.68, 0.0, d) * 0.36;
    let shadowAlpha = in.tint.a * clamp(outer * 0.78 + umbra, 0.0, 1.0);
    out.color = vec4f(in.tint.rgb, shadowAlpha);
    out.emissive = vec4f(0.0, 0.0, 0.0, shadowAlpha);
    return out;
  }

  // Mode 2: Solid crisp quad or sculpted beveled UI frame (param > 0.01)
  if (in.mode > 1.5) {
    var col = in.tint.rgb;
    var alpha = in.tint.a;
    if (in.param > 0.01) {
      let edgeY = min(in.localUv.y, 1.0 - in.localUv.y);
      let edgeX = min(in.localUv.x, 1.0 - in.localUv.x);
      let topHighlight = smoothstep(0.32, 0.0, in.localUv.y) * 0.22;
      let botShade = smoothstep(0.68, 1.0, in.localUv.y) * 0.26;
      col = col * (1.0 - botShade) + vec3f(topHighlight);
      let cornerMask = smoothstep(0.0, 0.06, edgeX) * smoothstep(0.0, 0.14, edgeY);
      alpha *= mix(0.65, 1.0, cornerMask);
    }
    let flashAmt = clamp(in.flash, 0.0, 1.0);
    let solidRgb = mix(col, vec3f(1.0), flashAmt);
    out.color = vec4f(solidRgb, alpha);
    out.emissive = vec4f(solidRgb * flashAmt * 0.45, alpha);
    return out;
  }

  // Mode 1: Smooth radial GPU light orb OR 4-point cross star glint (param >= 9.5)
  if (in.mode > 0.5) {
    let p = in.localUv * 2.0 - vec2f(1.0);
    let d2 = dot(p, p);
    if (d2 >= 1.0) {
      discard;
    }
    let d = sqrt(d2);
    if (in.param >= 9.5) {
      let sharp = max(1.2, in.param - 10.0);
      let core = exp(-d * 4.2);
      let arms = exp(-abs(p.x) * (4.5 * sharp)) * exp(-abs(p.y) * 1.9)
               + exp(-abs(p.y) * (4.5 * sharp)) * exp(-abs(p.x) * 1.9);
      let glint = clamp(core + arms * 0.8, 0.0, 1.0) * smoothstep(1.0, 0.25, d);
      let a = in.tint.a * glint;
      out.color = vec4f(in.tint.rgb, a);
      out.emissive = vec4f(in.tint.rgb * 0.85, a);
      return out;
    }
    let falloff = clamp(1.0 - d, 0.0, 1.0);
    let power = select(2.0, in.param, in.param > 0.1);
    let glow = select(0.0, pow(max(falloff, 0.0001), power), falloff > 0.001);
    let a = in.tint.a * glow;
    out.color = vec4f(in.tint.rgb, a);
    out.emissive = vec4f(in.tint.rgb * 0.68, a);
    return out;
  }

  // Mode 0: Crisp Palette-Indexed LUT sprite OR 32-bit RGBA passthrough (idx == 255)
  let idxVal = round(textureSampleLevel(uIndexAtlas, uSamp, in.texUv, 0.0).r * 255.0);
  if (idxVal < 0.5) {
    discard;
  }

  var texRgb = vec3f(1.0);
  var texAlpha = 1.0;
  var lutEmissive = 0.0;

  if (idxVal <= 15.5 && in.paletteRow >= -0.5) {
    let rows = max(1.0, uSky.extra.x);
    let rowIdx = clamp(floor(in.paletteRow + 0.5), 0.0, rows - 1.0);
    let lutUv = vec2f((idxVal + 0.5) / 16.0, (rowIdx + 0.5) / rows);
    let lutSample = textureSampleLevel(uPaletteLut, uSamp, lutUv, 0.0);
    texRgb = lutSample.rgb;
    lutEmissive = lutSample.a;
  } else {
    let sampled = textureSampleLevel(uAtlas, uSamp, in.texUv, 0.0);
    if (sampled.a < 0.05) {
      discard;
    }
    texRgb = sampled.rgb;
    texAlpha = sampled.a;
  }

  let flashAmt = clamp(in.flash, 0.0, 1.0);
  let baseRgb = texRgb * in.tint.rgb;
  let finalRgb = mix(baseRgb, vec3f(1.0), flashAmt);
  let finalAlpha = texAlpha * in.tint.a;
  let emissiveAmt = max(lutEmissive, clamp(in.param, 0.0, 1.5)) + flashAmt * 0.5;

  out.color = vec4f(finalRgb, finalAlpha);
  out.emissive = vec4f(finalRgb * emissiveAmt, finalAlpha);
  return out;
}
`;

export const WGSL_POST_CODE = /* wgsl */ `
struct PostUniforms {
  params0: vec4f, // x: texelX, y: texelY, z: glowIntensity, w: filterMode (0=clean, 1=lcd, 2=crt)
  params1: vec4f, // x: timeSec, y: cozyFilter, z: viewW, w: viewH
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
  let c0 = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(-off.x, -off.y), 0.0).rgb;
  let c1 = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(off.x, -off.y), 0.0).rgb;
  let c2 = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(-off.x, off.y), 0.0).rgb;
  let c3 = textureSampleLevel(uTexA, uLinearSamp, in.uv + vec2f(off.x, off.y), 0.0).rgb;
  let avg = (c0 + c1 + c2 + c3) * 0.25;
  let knee = max(avg - vec3f(0.08), vec3f(0.0));
  return vec4f(knee, 1.0);
}

@fragment
fn fsBloomBlur(in: PostOut) -> @location(0) vec4f {
  let step = uPost.params0.xy;
  let w0 = 0.38774;
  let w1 = 0.24477;
  let w2 = 0.06136;
  var acc = textureSampleLevel(uTexA, uLinearSamp, in.uv, 0.0).rgb * w0;
  acc += textureSampleLevel(uTexA, uLinearSamp, in.uv - step, 0.0).rgb * w1;
  acc += textureSampleLevel(uTexA, uLinearSamp, in.uv + step, 0.0).rgb * w1;
  acc += textureSampleLevel(uTexA, uLinearSamp, in.uv - step * 2.0, 0.0).rgb * w2;
  acc += textureSampleLevel(uTexA, uLinearSamp, in.uv + step * 2.0, 0.0).rgb * w2;
  return vec4f(acc, 1.0);
}

@fragment
fn fsComposite(in: PostOut) -> @location(0) vec4f {
  let sceneCol = textureSampleLevel(uTexA, uNearestSamp, in.uv, 0.0).rgb;
  let glow = max(0.0, uPost.params0.z);
  var col = sceneCol;

  if (glow > 0.01) {
    let bloom = textureSampleLevel(uTexB, uLinearSamp, in.uv, 0.0).rgb;
    let bloomTerm = bloom * glow * 0.72;
    col = sceneCol + bloomTerm * (vec3f(1.0) - sceneCol * 0.28);
  }

  let mode = uPost.params0.w;
  let centered = in.uv - vec2f(0.5);
  let r2 = dot(centered, centered);

  if (mode > 1.5) {
    // Console CRT post: 180-line scanline + subtle phosphor aperture + soft vignette
    let scan = 0.94 + 0.06 * sin(in.uv.y * ${GAME_H}.0 * 6.28318);
    let maskPhase = in.uv.x * ${GAME_W}.0 * 3.14159;
    let triad = vec3f(
      0.98 + 0.025 * sin(maskPhase),
      0.98 + 0.025 * sin(maskPhase + 2.094),
      0.98 + 0.025 * sin(maskPhase + 4.188)
    );
    let vig = clamp(1.0 - r2 * 0.24, 0.76, 1.0);
    col = col * scan * triad * vig;
  } else if (mode > 0.5) {
    // Handheld LCD post: crisp 320x180 pixel subgrid + warm contrast
    let gx = 0.97 + 0.03 * cos(in.uv.x * ${GAME_W}.0 * 6.28318);
    let gy = 0.97 + 0.03 * cos(in.uv.y * ${GAME_H}.0 * 6.28318);
    let vig = clamp(1.0 - r2 * 0.12, 0.88, 1.0);
    col = col * (gx * gy * vig) * vec3f(1.01, 1.005, 0.985);
  } else if (uPost.params1.y > 0.5) {
    let vig = clamp(1.0 - r2 * 0.06, 0.94, 1.0);
    col *= vig;
  }

  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

