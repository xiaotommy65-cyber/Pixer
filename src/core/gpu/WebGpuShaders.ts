import { OVERSCAN_PAD, SHADOW_MAP_SIZE } from './GpuTypes.ts';

const WGSL_COLOR_TRANSFER = /* wgsl */ `
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

const WGSL_BAYER4X4 = /* wgsl */ `
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

export const WGSL_CODE = /* wgsl */ `
struct SkyUniforms {
  topColor: vec4f,
  bottomColor: vec4f,
  params: vec4f, // x: timeSec, y: cozyFilter (1 or 0), z: viewW, w: viewH
  extra: vec4f,  // x: paletteRows, yzw: precomputed Oklab midColor RGB
};

struct LightUniforms {
  info: vec4f,      // x: lightCount, y: occCols, z: occRows, w: occStrength
  occParams: vec4f, // x: originScreenX, y: originScreenY, z: tileSizePx, w: occSoftness
  posRad: array<vec4f, 24>,
  colInt: array<vec4f, 24>,
};

@group(0) @binding(0) var<uniform> uSky: SkyUniforms;
@group(0) @binding(1) var uAtlas: texture_2d_array<f32>;
@group(0) @binding(2) var uSamp: sampler;
@group(0) @binding(3) var uIndexAtlas: texture_2d_array<f32>;
@group(0) @binding(4) var uPaletteLut: texture_2d<f32>;
@group(0) @binding(5) var<uniform> uLights: LightUniforms;
@group(0) @binding(6) var uOcclusionTex: texture_2d<f32>;

struct SkyOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

struct SceneOut {
  @location(0) color: vec4f,
  @location(1) emissive: vec4f,
};

${WGSL_COLOR_TRANSFER}
${WGSL_BAYER4X4}

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
  let viewSize = max(vec2f(1.0), uSky.params.zw);
  let horizonGlow = pow(max(y, 1e-4), 2.4) * 0.045 * (0.85 + 0.15 * sin(uSky.params.x * 0.7 + in.uv.x * 3.14159));
  let topLin = srgbToLin(uSky.topColor.rgb);
  let midLin = srgbToLin(uSky.extra.yzw);
  let botLin = srgbToLin(uSky.bottomColor.rgb);
  let upper = mix(topLin, midLin, clamp(y * 2.0, 0.0, 1.0));
  let lower = mix(midLin, botLin, clamp((y - 0.5) * 2.0, 0.0, 1.0));
  var skyLin = select(upper, lower, y >= 0.5) + botLin * horizonGlow;
  if (uSky.params.y > 0.5) {
    let rayPhase = sin((in.uv.x * 1.35 + in.uv.y * 0.55) * 6.28318 - uSky.params.x * 0.32) * 0.5 + 0.5;
    let godRay = pow(max(1e-4, rayPhase), 3.0) * (1.0 - y * 0.72) * 0.055;
    skyLin += topLin * godRay;
  }
  var col = linToSrgb(skyLin);
  col += vec3f(bayer4x4(in.uv * viewSize) * (1.75 / 255.0));
  if (uSky.params.y > 0.5) {
    let gridY = 0.985 + 0.015 * sin(in.uv.y * viewSize.y * 6.28318);
    col *= gridY;
  }
  var out: SceneOut;
  out.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
  out.emissive = vec4f(0.0, 0.0, 0.0, 1.0);
  return out;
}

struct InstanceIn {
  @location(0) rectPosSize: vec4f, // x, y, w, h
  @location(1) uvBounds: vec4f,    // u0, v0, u1, v1
  @location(2) tint: vec4f,        // r, g, b, a
  @location(3) extra: vec4f,       // x: rot, y: mode (0..5), z: flash, w: param
  @location(4) deform: vec4f,      // x: pivotX, y: pivotY, z: skewX, w: paletteRow
  @location(5) material: vec4f,    // x: atlasPage, y: roughness, z: metallic, w: emissive
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
  @location(8) screenPos: vec2f,
  @location(9) material: vec4f,
  @location(10) quadCenter: vec2f,
};

// Branchless 32-bit unsigned integer xxHash32-style mix (eliminates mobile FP16 sin() banding)
fn hash21(p: vec2f) -> f32 {
  let ip = vec2<i32>(floor(p * 8.0 + 0.5));
  var h = bitcast<u32>(ip.x) * 374761393u + bitcast<u32>(ip.y) * 668265263u + 1442695041u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h = h ^ (h >> 16u);
  return f32(h & 0x00ffffffu) * (1.0 / 16777216.0);
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

  let viewSize = max(vec2f(1.0), uSky.params.zw);
  let osSize = viewSize + vec2f(${OVERSCAN_PAD}.0 * 2.0);
  let ndcX = ((world.x + ${OVERSCAN_PAD}.0) / osSize.x) * 2.0 - 1.0;
  let ndcY = 1.0 - ((world.y + ${OVERSCAN_PAD}.0) / osSize.y) * 2.0;

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
  out.screenPos = world;
  out.material = inst.material;
  out.quadCenter = inst.rectPosSize.xy;
  return out;
}

fn sampleOccCell(cell: vec2f) -> f32 {
  let cols = uLights.info.y;
  let rows = uLights.info.z;
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= cols || cell.y >= rows) {
    return 0.0;
  }
  let uv = (cell + vec2f(0.5)) / 64.0;
  return textureSampleLevel(uOcclusionTex, uSamp, uv, 0.0).r;
}

fn sampleShadowOcclusion(fragPos: vec2f, lightPos: vec2f) -> f32 {
  let strength = uLights.info.w;
  let tilePx = uLights.occParams.z;
  if (strength <= 0.01 || tilePx <= 1.0) {
    return 1.0;
  }
  let origin = uLights.occParams.xy;
  let fragCell = (fragPos - origin) / tilePx;
  let lightCell = (lightPos - origin) / tilePx;
  let delta = lightCell - fragCell;
  if (dot(delta, delta) < 0.0625) {
    return 1.0;
  }
  let fragTile = floor(fragCell);
  let lightTile = floor(lightCell);
  if (abs(fragTile.x - lightTile.x) < 0.5 && abs(fragTile.y - lightTile.y) < 0.5) {
    return 1.0;
  }
  let hasX = abs(delta.x) > 1e-6;
  let hasY = abs(delta.y) > 1e-6;
  let stepX = select(-1.0, 1.0, delta.x >= 0.0);
  let stepY = select(-1.0, 1.0, delta.y >= 0.0);
  let tDeltaX = select(1e9, 1.0 / max(abs(delta.x), 1e-6), hasX);
  let tDeltaY = select(1e9, 1.0 / max(abs(delta.y), 1e-6), hasY);
  var tMaxX = select(
    1e9,
    select((fragCell.x - fragTile.x) * tDeltaX, (fragTile.x + 1.0 - fragCell.x) * tDeltaX, delta.x >= 0.0),
    hasX
  );
  var tMaxY = select(
    1e9,
    select((fragCell.y - fragTile.y) * tDeltaY, (fragTile.y + 1.0 - fragCell.y) * tDeltaY, delta.y >= 0.0),
    hasY
  );
  let softSteps = max(0.35, uLights.occParams.w * 2.4);
  var curTile = fragTile;
  var hits = 0.0;
  for (var s: i32 = 0; s < 32; s += 1) {
    var tHit = 0.0;
    if (tMaxX < tMaxY) {
      tHit = tMaxX;
      curTile.x += stepX;
      tMaxX += tDeltaX;
    } else {
      tHit = tMaxY;
      curTile.y += stepY;
      tMaxY += tDeltaY;
    }
    if (tHit >= 1.0) {
      break;
    }
    if (abs(curTile.x - lightTile.x) < 0.5 && abs(curTile.y - lightTile.y) < 0.5) {
      break;
    }
    if (sampleOccCell(curTile) > 0.5) {
      hits += 1.0;
      if (hits >= softSteps) {
        break;
      }
    }
  }
  let shadowAmt = clamp(hits / softSteps, 0.0, 1.0) * strength;
  return 1.0 - shadowAmt;
}

fn sampleWallBaseAo(fragPos: vec2f) -> f32 {
  let strength = uLights.info.w;
  let tilePx = uLights.occParams.z;
  if (strength <= 0.01 || tilePx <= 1.0) {
    return 1.0;
  }
  let cellPos = (fragPos - uLights.occParams.xy) / tilePx;
  let tile = floor(cellPos);
  if (sampleOccCell(tile) > 0.5) {
    return 1.0;
  }
  let frac = fract(cellPos);
  var ao = 1.0;
  if (sampleOccCell(tile + vec2f(0.0, -1.0)) > 0.5) {
    ao *= mix(0.68, 1.0, smoothstep(0.0, 0.44, frac.y));
  }
  if (sampleOccCell(tile + vec2f(-1.0, 0.0)) > 0.5) {
    ao *= mix(0.84, 1.0, smoothstep(0.0, 0.22, frac.x));
  }
  if (sampleOccCell(tile + vec2f(1.0, 0.0)) > 0.5) {
    ao *= mix(0.84, 1.0, smoothstep(0.0, 0.22, 1.0 - frac.x));
  }
  return mix(1.0, ao, clamp(strength, 0.0, 1.0));
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
      fade = pow(clamp(1.0 - in.localUv.y, 1e-4, 1.0), pwr);
    } else if (dir < 1.5) {
      fade = pow(clamp(in.localUv.y, 1e-4, 1.0), pwr);
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
    // Apply shadow-occluded dynamic point lights onto extruded beveled walls too
    let wallLightCnt = min(24u, u32(max(0.0, uLights.info.x + 0.5)));
    var wallLit = vec3f(0.0);
    var wli = 0u;
    loop {
      if (wli >= wallLightCnt) { break; }
      let lp = uLights.posRad[wli];
      let lc = uLights.colInt[wli];
      let toL = vec3f(lp.xy - in.screenPos, 24.0);
      let dist = length(toL.xy);
      if (dist < lp.z) {
        let vis = sampleShadowOcclusion(in.screenPos, lp.xy);
        if (vis > 0.01) {
          let att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w));
          let diff = max(0.15, dot(n, normalize(toL)));
          wallLit += lc.rgb * (lc.a * att * diff * vis * 0.85);
        }
      }
      wli += 1u;
    }
    baseCol *= (1.0 + wallLit);
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
    let occVis = sampleShadowOcclusion(in.screenPos, in.quadCenter);
    let glow = select(0.0, pow(max(falloff, 0.0001), power), falloff > 0.001) * occVis;
    let a = in.tint.a * glow;
    out.color = vec4f(in.tint.rgb, a);
    out.emissive = vec4f(in.tint.rgb * 0.68, a);
    return out;
  }

  // Mode 0: Multi-Page Texture2DArray Sprite + Per-Instance PBR-Lite Material Shading
  let atlasLayer = max(0, i32(floor(in.material.x + 0.5)));
  let idxVal = round(textureSampleLevel(uIndexAtlas, uSamp, in.texUv, atlasLayer, 0.0).r * 255.0);
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
    let sampled = textureSampleLevel(uAtlas, uSamp, in.texUv, atlasLayer, 0.0);
    if (sampled.a < 0.05) {
      discard;
    }
    texRgb = sampled.rgb;
    texAlpha = sampled.a;
  }

  let rough = clamp(in.material.y, 0.05, 1.0);
  let metal = clamp(in.material.z, 0.0, 1.0);
  let matEmissive = clamp(in.material.w, 0.0, 2.0);
  let specExp = mix(56.0, 6.0, rough);
  let specNorm = (specExp + 8.0) / 25.132741;
  let isHdRgba = idxVal > 250.0;
  let specScale = mix(1.0, 0.28, rough) * (0.45 + 0.55 * metal + select(0.0, 0.18, isHdRgba)) * specNorm;
  let f0 = mix(vec3f(0.04), clamp(texRgb, vec3f(0.0), vec3f(1.0)), metal);
  let diffConserv = mix(1.0, 0.58, metal);

  var reliefShade = 1.0;
  var keySpecRgb = vec3f(0.0);
  var litDiff = vec3f(0.0);
  var litSpec = vec3f(0.0);

  if (in.paletteRow > -1.5) {
    let texel = vec2f(1.0) / vec2f(textureDimensions(uIndexAtlas));
    let uvMin = min(in.uvBounds.xy, in.uvBounds.zw) + texel * 0.5;
    let uvMax = max(in.uvBounds.xy, in.uvBounds.zw) - texel * 0.5;
    let safeMin = min(uvMin, uvMax);
    let safeMax = max(uvMin, uvMax);
    let flipSign = select(1.0, -1.0, in.uvBounds.x > in.uvBounds.z);
    let lumaW = vec3f(0.299, 0.587, 0.114);
    let sL = textureSampleLevel(uAtlas, uSamp, clamp(in.texUv - vec2f(texel.x * flipSign, 0.0), safeMin, safeMax), atlasLayer, 0.0);
    let sR = textureSampleLevel(uAtlas, uSamp, clamp(in.texUv + vec2f(texel.x * flipSign, 0.0), safeMin, safeMax), atlasLayer, 0.0);
    let sU = textureSampleLevel(uAtlas, uSamp, clamp(in.texUv - vec2f(0.0, texel.y), safeMin, safeMax), atlasLayer, 0.0);
    let sD = textureSampleLevel(uAtlas, uSamp, clamp(in.texUv + vec2f(0.0, texel.y), safeMin, safeMax), atlasLayer, 0.0);
    let sBR = textureSampleLevel(uAtlas, uSamp, clamp(in.texUv + vec2f(texel.x * flipSign, texel.y), safeMin, safeMax), atlasLayer, 0.0);

    let hC = texAlpha * (0.65 + 0.35 * dot(texRgb, lumaW));
    let hL = sL.a * (0.65 + 0.35 * dot(sL.rgb, lumaW));
    let hR = sR.a * (0.65 + 0.35 * dot(sR.rgb, lumaW));
    let hU = sU.a * (0.65 + 0.35 * dot(sU.rgb, lumaW));
    let hD = sD.a * (0.65 + 0.35 * dot(sD.rgb, lumaW));
    let hBR = sBR.a * (0.65 + 0.35 * dot(sBR.rgb, lumaW));

    let gx = hR - hL;
    let gy = hD - hU;
    let sobelN = normalize(vec3f(-gx * 1.45, -gy * 1.45, 1.0));
    let sobelLight = normalize(vec3f(-0.55, -0.75, 0.42));
    let viewDir = vec3f(0.0, 0.0, 1.0);
    let ndv = clamp(dot(sobelN, viewDir), 0.0, 1.0);
    let fresnel = f0 + (vec3f(1.0) - f0) * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
    let halfKey = normalize(sobelLight + viewDir);
    let keySpecAmt = pow(max(0.0, dot(sobelN, halfKey)), specExp) * specScale * 0.42;
    let ndl = dot(sobelN, sobelLight) - sobelLight.z;
    let rimBoost = select(0.0, 0.07 + 0.14 * metal, (hC - hBR) > 0.45);
    reliefShade = clamp(1.0 + ndl * 0.28, 0.84, 1.18) * diffConserv + rimBoost;
    keySpecRgb = fresnel * keySpecAmt;

    let lightCnt = min(24u, u32(max(0.0, uLights.info.x + 0.5)));
    var li = 0u;
    loop {
      if (li >= lightCnt) { break; }
      let lp = uLights.posRad[li];
      let lc = uLights.colInt[li];
      let toL = vec3f(lp.xy - in.screenPos, 22.0);
      let dist = length(vec2f(toL.x, toL.y));
      if (dist < lp.z) {
        let vis = sampleShadowOcclusion(in.screenPos, lp.xy);
        if (vis > 0.01) {
          let falloff = max(0.2, lp.w);
          let att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), falloff) * vis;
          let lDir = normalize(toL);
          let diff = max(0.0, dot(sobelN, lDir));
          let hVec = normalize(lDir + viewDir);
          let spec = pow(max(0.0, dot(sobelN, hVec)), specExp) * specScale * 0.92;
          litDiff += lc.rgb * (lc.a * att * (0.34 + 0.90 * diff) * diffConserv);
          litSpec += lc.rgb * fresnel * (lc.a * att * spec);
        }
      }
      li += 1u;
    }
    reliefShade *= sampleWallBaseAo(in.screenPos);
  }

  let flashAmt = clamp(in.flash, 0.0, 1.0);
  var baseRgb = clamp(texRgb * in.tint.rgb * reliefShade + keySpecRgb, vec3f(0.0), vec3f(1.15));
  if (in.paletteRow > -1.5) {
    baseRgb = clamp(baseRgb * (1.0 + litDiff) + litSpec, vec3f(0.0), vec3f(1.45));
  }
  let finalRgb = mix(baseRgb, vec3f(1.0), flashAmt);
  let finalAlpha = texAlpha * in.tint.a;
  let emissiveAmt = max(lutEmissive, max(clamp(in.param, 0.0, 2.0), matEmissive)) + flashAmt * 0.5;
  let hdrExcess = max(finalRgb - vec3f(1.0), vec3f(0.0));

  out.color = vec4f(clamp(finalRgb, vec3f(0.0), vec3f(1.0)), finalAlpha);
  out.emissive = vec4f(finalRgb * emissiveAmt + hdrExcess, finalAlpha);
  return out;
}

// ============================================================================
// HD-2D True 3D Perspective Quad + Indexed Mesh3D + Shadow Map Pipelines
// ============================================================================
struct Quad3DUniforms {
  viewProj: mat4x4<f32>,
  lightViewProj: mat4x4<f32>,
  occWorld: vec4f,   // x: originWorldX, y: originWorldY, z: tileSizeWorld, w: opaquePass (1=cutout, 0=blend)
  viewParams: vec4f, // x: viewW, y: viewH, z: camWorldX, w: camWorldY
  eyePos: vec4f,     // xyz: world camera eye pos, w: shadowMapEnabled (1 or 0)
  sunDirInfo: vec4f, // xyz: unit vector toward sun, w: directional shadow strength (0..0.95)
  lightPosZ: array<vec4f, 6>, // 24 dynamic point light world Z coordinates
};

@group(1) @binding(0) var<uniform> uQuad3D: Quad3DUniforms;
@group(1) @binding(1) var uShadowMap: texture_depth_2d;
@group(1) @binding(2) var uShadowSamp: sampler_comparison;

fn getLightZ3D(idx: u32) -> f32 {
  let v = uQuad3D.lightPosZ[idx >> 2u];
  let rem = idx & 3u;
  if (rem == 0u) { return v.x; }
  if (rem == 1u) { return v.y; }
  if (rem == 2u) { return v.z; }
  return v.w;
}

fn sampleDirectionalShadow3D(worldPos: vec3f, n3d: vec3f) -> f32 {
  let shadowOn = uQuad3D.eyePos.w;
  let strength = clamp(uQuad3D.sunDirInfo.w, 0.0, 0.95);
  let biased = worldPos + n3d * 1.4;
  let lClip = uQuad3D.lightViewProj * vec4f(biased, 1.0);
  let ndc = lClip.xyz / max(abs(lClip.w), 1e-5);
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  let refDepth = ndc.z - 0.0018;
  let inBounds = shadowOn > 0.5 && strength > 0.005 && uv.x > 0.004 && uv.x < 0.996 && uv.y > 0.004 && uv.y < 0.996 && refDepth > 0.0 && refDepth < 1.0;
  let texel = 1.0 / ${SHADOW_MAP_SIZE}.0;
  var vis = 0.0;
  for (var oy: i32 = -1; oy <= 1; oy += 1) {
    for (var ox: i32 = -1; ox <= 1; ox += 1) {
      let sUv = clamp(uv + vec2f(f32(ox), f32(oy)) * texel, vec2f(0.0), vec2f(1.0));
      vis += textureSampleCompareLevel(uShadowMap, uShadowSamp, sUv, clamp(refDepth, 0.0, 1.0));
    }
  }
  let pcf = vis * (1.0 / 9.0);
  return select(1.0, mix(1.0 - strength, 1.0, pcf), inBounds);
}

struct Quad3DIn {
  @location(0) originPage: vec4f,   // originX, originY, originZ, atlasPage
  @location(1) uAxisRough: vec4f,   // uAxisX, uAxisY, uAxisZ, roughness
  @location(2) vAxisMetal: vec4f,   // vAxisX, vAxisY, vAxisZ, metallic
  @location(3) uvBounds: vec4f,     // u0, v0, u1, v1
  @location(4) tint: vec4f,         // r, g, b, a
  @location(5) normEmissive: vec4f, // normalX, normalY, normalZ, emissive
  @location(6) style: vec4f,        // mode, flash, shadeMult, paletteRow
};

struct Quad3DOut {
  @builtin(position) pos: vec4f,
  @location(0) texUv: vec2f,
  @location(1) localUv: vec2f,
  @location(2) tint: vec4f,
  @location(3) worldPos: vec3f,
  @location(4) normal: vec3f,
  @location(5) material: vec4f,     // atlasPage, roughness, metallic, emissive
  @location(6) style: vec4f,        // mode, flash, shadeMult, paletteRow
  @location(7) uvBounds: vec4f,
  @location(8) quadCenterXy: vec2f,
};

@vertex
fn vsQuad3D(@builtin(vertex_index) vid: u32, inst: Quad3DIn) -> Quad3DOut {
  var uvUnit = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let u01 = uvUnit[vid];
  let worldPos = inst.originPage.xyz + inst.uAxisRough.xyz * u01.x + inst.vAxisMetal.xyz * u01.y;
  var clip = uQuad3D.viewProj * vec4f(worldPos, 1.0);
  let viewSize = max(vec2f(1.0), uQuad3D.viewParams.xy);
  let osScale = viewSize / (viewSize + vec2f(${OVERSCAN_PAD}.0 * 2.0));
  clip.x *= osScale.x;
  clip.y *= osScale.y;

  let centerPos = inst.originPage.xyz + (inst.uAxisRough.xyz + inst.vAxisMetal.xyz) * 0.5;
  var out: Quad3DOut;
  out.pos = clip;
  out.texUv = mix(inst.uvBounds.xy, inst.uvBounds.zw, u01);
  out.localUv = u01;
  out.tint = inst.tint;
  out.worldPos = worldPos;
  out.normal = inst.normEmissive.xyz;
  out.material = vec4f(inst.originPage.w, inst.uAxisRough.w, inst.vAxisMetal.w, inst.normEmissive.w);
  out.style = inst.style;
  out.uvBounds = inst.uvBounds;
  out.quadCenterXy = centerPos.xy;
  return out;
}

fn sampleShadowOcclusion3D(fragWorldXy: vec2f, lightWorldXy: vec2f) -> f32 {
  let strength = uLights.info.w;
  let tileSize = uQuad3D.occWorld.z;
  if (strength <= 0.01 || tileSize <= 1.0) {
    return 1.0;
  }
  let origin = uQuad3D.occWorld.xy;
  let fragCell = (fragWorldXy - origin) / tileSize;
  let lightCell = (lightWorldXy - origin) / tileSize;
  let delta = lightCell - fragCell;
  if (dot(delta, delta) < 0.0625) {
    return 1.0;
  }
  let fragTile = floor(fragCell);
  let lightTile = floor(lightCell);
  if (abs(fragTile.x - lightTile.x) < 0.5 && abs(fragTile.y - lightTile.y) < 0.5) {
    return 1.0;
  }
  let hasX = abs(delta.x) > 1e-6;
  let hasY = abs(delta.y) > 1e-6;
  let stepX = select(-1.0, 1.0, delta.x >= 0.0);
  let stepY = select(-1.0, 1.0, delta.y >= 0.0);
  let tDeltaX = select(1e9, 1.0 / max(abs(delta.x), 1e-6), hasX);
  let tDeltaY = select(1e9, 1.0 / max(abs(delta.y), 1e-6), hasY);
  var tMaxX = select(
    1e9,
    select((fragCell.x - fragTile.x) * tDeltaX, (fragTile.x + 1.0 - fragCell.x) * tDeltaX, delta.x >= 0.0),
    hasX
  );
  var tMaxY = select(
    1e9,
    select((fragCell.y - fragTile.y) * tDeltaY, (fragTile.y + 1.0 - fragCell.y) * tDeltaY, delta.y >= 0.0),
    hasY
  );
  let softSteps = max(0.35, uLights.occParams.w * 2.4);
  var curTile = fragTile;
  var hits = 0.0;
  for (var s: i32 = 0; s < 32; s += 1) {
    var tHit = 0.0;
    if (tMaxX < tMaxY) {
      tHit = tMaxX;
      curTile.x += stepX;
      tMaxX += tDeltaX;
    } else {
      tHit = tMaxY;
      curTile.y += stepY;
      tMaxY += tDeltaY;
    }
    if (tHit >= 1.0) {
      break;
    }
    if (abs(curTile.x - lightTile.x) < 0.5 && abs(curTile.y - lightTile.y) < 0.5) {
      break;
    }
    if (sampleOccCell(curTile) > 0.5) {
      hits += 1.0;
      if (hits >= softSteps) {
        break;
      }
    }
  }
  let shadowAmt = clamp(hits / softSteps, 0.0, 1.0) * strength;
  return 1.0 - shadowAmt;
}

fn sampleWallBaseAo3D(fragWorldXy: vec2f) -> f32 {
  let strength = uLights.info.w;
  let tileSize = uQuad3D.occWorld.z;
  if (strength <= 0.01 || tileSize <= 1.0) {
    return 1.0;
  }
  let cellPos = (fragWorldXy - uQuad3D.occWorld.xy) / tileSize;
  let tile = floor(cellPos);
  if (sampleOccCell(tile) > 0.5) {
    return 1.0;
  }
  let frac = fract(cellPos);
  var ao = 1.0;
  if (sampleOccCell(tile + vec2f(0.0, -1.0)) > 0.5) {
    ao *= mix(0.62, 1.0, smoothstep(0.0, 0.48, frac.y));
  }
  if (sampleOccCell(tile + vec2f(0.0, 1.0)) > 0.5) {
    ao *= mix(0.80, 1.0, smoothstep(0.0, 0.24, 1.0 - frac.y));
  }
  if (sampleOccCell(tile + vec2f(-1.0, 0.0)) > 0.5) {
    ao *= mix(0.76, 1.0, smoothstep(0.0, 0.28, frac.x));
  }
  if (sampleOccCell(tile + vec2f(1.0, 0.0)) > 0.5) {
    ao *= mix(0.76, 1.0, smoothstep(0.0, 0.28, 1.0 - frac.x));
  }
  return mix(1.0, ao, clamp(strength, 0.0, 1.0));
}

@fragment
fn fsQuad3D(in: Quad3DOut) -> SceneOut {
  var out: SceneOut;
  let mode = in.style.x;
  let flashAmt = clamp(in.style.y, 0.0, 1.0);
  let shadeMult = in.style.z;
  let paletteRow = in.style.w;
  let opaquePass = uQuad3D.occWorld.w > 0.5;

  // Mode 3: Grounded analytical SDF elliptical soft contact shadow on floor
  if (mode > 2.5 && mode < 3.5) {
    let p = in.localUv * 2.0 - vec2f(1.0);
    let d2 = dot(p, p);
    if (d2 >= 1.0) { discard; }
    let d = sqrt(d2);
    let soft = clamp(select(0.62, shadeMult, shadeMult > 0.05), 0.15, 0.98);
    let outer = smoothstep(1.0, 1.0 - soft, d);
    let umbra = smoothstep(0.68, 0.0, d) * 0.36;
    let shadowAlpha = in.tint.a * clamp(outer * 0.78 + umbra, 0.0, 1.0);
    if (opaquePass && shadowAlpha < 0.5) { discard; }
    out.color = vec4f(in.tint.rgb, shadowAlpha);
    out.emissive = vec4f(0.0, 0.0, 0.0, shadowAlpha);
    return out;
  }

  // Mode 1: Radial GPU light orb in 3D space
  if (mode > 0.5 && mode < 1.5) {
    let p = in.localUv * 2.0 - vec2f(1.0);
    let d2 = dot(p, p);
    if (d2 >= 1.0) { discard; }
    let d = sqrt(d2);
    let falloff = clamp(1.0 - d, 0.0, 1.0);
    let power = select(2.0, shadeMult, shadeMult > 0.1);
    let occVis = sampleShadowOcclusion3D(in.worldPos.xy, in.quadCenterXy);
    let glow = select(0.0, pow(max(falloff, 0.0001), power), falloff > 0.001) * occVis;
    let a = in.tint.a * glow;
    if (opaquePass && a < 0.5) { discard; }
    out.color = vec4f(in.tint.rgb, a);
    out.emissive = vec4f(in.tint.rgb * 0.72, a);
    return out;
  }

  // Mode 2: Solid 3D quad / particle / oblique shadow / accent slab
  if (mode > 1.5 && mode < 2.5) {
    let col = mix(in.tint.rgb * max(0.05, shadeMult), vec3f(1.0), flashAmt);
    let a = in.tint.a;
    if (opaquePass && a < 0.5) { discard; }
    let em = max(in.material.w, flashAmt * 0.5);
    out.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), a);
    out.emissive = vec4f(col * em, a);
    return out;
  }

  let normLen2 = dot(in.normal, in.normal);
  let n3d = select(vec3f(0.0, 0.0, 1.0), in.normal * inverseSqrt(max(normLen2, 1e-6)), normLen2 >= 1e-6);
  let isVertical = abs(n3d.z) < 0.5;
  let shadowSamplePos = in.worldPos.xy + select(vec2f(0.0), n3d.xy * 2.5, isVertical);

  // Mode 4: Procedural normal-lit beveled masonry 3D vertical wall face
  if (mode > 3.5) {
    let tx = max(0.5, in.uvBounds.x);
    let ty = max(0.25, in.uvBounds.y);
    let seed = in.uvBounds.z;
    let coord = vec2f(in.localUv.x * tx, in.localUv.y * ty);
    let row = floor(coord.y * 2.0);
    let stagger = fract(row * 0.5) * 0.5;
    let brickUv = vec2f(fract(coord.x * 1.45 + stagger), fract(coord.y * 2.0));
    let brickId = vec2f(floor(coord.x * 1.45 + stagger), row);
    let cellTint = (hash21(brickId + seed) - 0.5) * 0.14;
    let edgeDist = min(min(brickUv.x, 1.0 - brickUv.x), min(brickUv.y, 1.0 - brickUv.y));
    let mortarMask = mix(0.56, 1.0, smoothstep(0.02, 0.13, edgeDist));
    let aoBottom = mix(1.04, 0.62, smoothstep(0.26, 1.0, in.localUv.y));
    let topRim = smoothstep(0.12, 0.0, in.localUv.y) * 0.22;
    let grain = (hash21(floor(coord * 8.0) + seed) - 0.5) * 0.06;

    let sunDir = normalize(uQuad3D.sunDirInfo.xyz);
    let sunShadow = sampleDirectionalShadow3D(in.worldPos, n3d);
    let hemi = mix(0.70, 1.12, dot(n3d, sunDir) * 0.5 + 0.5) * sunShadow;
    var baseCol = in.tint.rgb * max(0.2, shadeMult) * hemi * (1.0 + cellTint + grain) * mortarMask * aoBottom + vec3f(topRim);

    let lightCnt = min(24u, u32(max(0.0, uLights.info.x + 0.5)));
    var litDiff = vec3f(0.0);
    var li = 0u;
    loop {
      if (li >= lightCnt) { break; }
      let lp = uLights.posRad[li];
      let lc = uLights.colInt[li];
      let toL = vec3f(lp.xy - in.worldPos.xy, getLightZ3D(li) - in.worldPos.z);
      let dist = length(toL);
      if (dist < lp.z) {
        let vis = sampleShadowOcclusion3D(shadowSamplePos, lp.xy);
        if (vis > 0.01) {
          let att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w)) * vis;
          let toL2 = dot(toL, toL);
          let lDir = select(toL * inverseSqrt(max(toL2, 1e-6)), vec3f(0.0, 0.0, 1.0), toL2 < 1e-6);
          let diff = max(0.12, dot(n3d, lDir));
          litDiff += lc.rgb * (lc.a * att * diff * 0.92);
        }
      }
      li += 1u;
    }
    baseCol = clamp(baseCol * (1.0 + litDiff), vec3f(0.0), vec3f(1.2));
    let a = in.tint.a;
    if (opaquePass && a < 0.5) { discard; }
    out.color = vec4f(clamp(baseCol, vec3f(0.0), vec3f(1.0)), a);
    out.emissive = vec4f(max(baseCol - vec3f(1.0), vec3f(0.0)), a);
    return out;
  }

  // Mode 0: Crisp Nearest-Neighbor Multi-Page Atlas Pixel Quad (Floor / Wall Face / Billboard)
  let atlasLayer = max(0, i32(floor(in.material.x + 0.5)));
  let idxVal = round(textureSampleLevel(uIndexAtlas, uSamp, in.texUv, atlasLayer, 0.0).r * 255.0);
  if (idxVal < 0.5) { discard; }

  var texRgb = vec3f(1.0);
  var texAlpha = 1.0;
  var lutEmissive = 0.0;
  if (idxVal <= 15.5 && paletteRow >= -0.5) {
    let rows = max(1.0, uSky.extra.x);
    let rowIdx = clamp(floor(paletteRow + 0.5), 0.0, rows - 1.0);
    let lutUv = vec2f((idxVal + 0.5) / 16.0, (rowIdx + 0.5) / rows);
    let lutSample = textureSampleLevel(uPaletteLut, uSamp, lutUv, 0.0);
    texRgb = lutSample.rgb;
    lutEmissive = lutSample.a;
  } else {
    let sampled = textureSampleLevel(uAtlas, uSamp, in.texUv, atlasLayer, 0.0);
    if (sampled.a < 0.05) { discard; }
    texRgb = sampled.rgb;
    texAlpha = sampled.a;
  }

  let finalAlpha = texAlpha * in.tint.a;
  if (opaquePass && finalAlpha < 0.5) { discard; }

  let rough = clamp(in.material.y, 0.05, 1.0);
  let metal = clamp(in.material.z, 0.0, 1.0);
  let matEmissive = clamp(in.material.w, 0.0, 2.0);
  let specExp = mix(48.0, 6.0, rough);
  let specNorm = (specExp + 8.0) / 25.132741;
  let specScale = mix(0.95, 0.24, rough) * (0.42 + 0.58 * metal) * specNorm;
  let f0 = mix(vec3f(0.04), clamp(texRgb, vec3f(0.0), vec3f(1.0)), metal);
  let diffConserv = mix(1.0, 0.62, metal);

  let sunDir = normalize(uQuad3D.sunDirInfo.xyz);
  let toEye = uQuad3D.eyePos.xyz - in.worldPos;
  let toEye2 = dot(toEye, toEye);
  let viewDir = select(toEye * inverseSqrt(max(toEye2, 1e-6)), vec3f(0.0, 0.65, 0.76), toEye2 < 1e-6);
  let ndv = clamp(dot(n3d, viewDir), 0.0, 1.0);
  let fresnel = f0 + (vec3f(1.0) - f0) * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  let sunShadow = sampleDirectionalShadow3D(in.worldPos, n3d);
  let hemi = mix(0.74, 1.12, dot(n3d, sunDir) * 0.5 + 0.5) * sunShadow;

  var reliefShade = max(0.15, shadeMult) * hemi * diffConserv;
  var topRimAdd = vec3f(0.0);
  if (isVertical && paletteRow > -1.5) {
    let baseCrease = mix(1.0, 0.70, smoothstep(0.70, 1.0, in.localUv.y));
    reliefShade *= baseCrease;
    topRimAdd = vec3f(smoothstep(0.09, 0.0, in.localUv.y) * 0.11);
  }
  if (n3d.z > 0.7 && in.worldPos.z < 2.0 && paletteRow > -1.5) {
    reliefShade *= sampleWallBaseAo3D(in.worldPos.xy);
  }

  var litDiff = vec3f(0.0);
  var litSpec = vec3f(0.0);
  if (paletteRow > -1.5) {
    let lightCnt = min(24u, u32(max(0.0, uLights.info.x + 0.5)));
    var li = 0u;
    loop {
      if (li >= lightCnt) { break; }
      let lp = uLights.posRad[li];
      let lc = uLights.colInt[li];
      let toL = vec3f(lp.xy - in.worldPos.xy, getLightZ3D(li) - in.worldPos.z);
      let dist = length(toL);
      if (dist < lp.z) {
        let vis = sampleShadowOcclusion3D(shadowSamplePos, lp.xy);
        if (vis > 0.01) {
          let att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w)) * vis;
          let toL2 = dot(toL, toL);
          let lDir = select(toL * inverseSqrt(max(toL2, 1e-6)), vec3f(0.0, 0.0, 1.0), toL2 < 1e-6);
          let ndl = max(0.0, dot(n3d, lDir));
          let wrapDiff = select(0.32 + 0.85 * ndl, 0.42 + 0.72 * ndl, isVertical);
          let halfSum = lDir + viewDir;
          let halfSum2 = dot(halfSum, halfSum);
          let hVec = select(halfSum * inverseSqrt(max(halfSum2, 1e-6)), n3d, halfSum2 < 1e-6);
          let spec = pow(max(0.0, dot(n3d, hVec)), specExp) * specScale * 0.78;
          litDiff += lc.rgb * (lc.a * att * wrapDiff * diffConserv);
          litSpec += lc.rgb * fresnel * (lc.a * att * spec);
        }
      }
      li += 1u;
    }
  }

  var baseRgb = clamp(texRgb * in.tint.rgb * reliefShade + topRimAdd, vec3f(0.0), vec3f(1.2));
  if (paletteRow > -1.5) {
    baseRgb = clamp(baseRgb * (1.0 + litDiff) + litSpec, vec3f(0.0), vec3f(1.48));
  }
  let finalRgb = mix(baseRgb, vec3f(1.0), flashAmt);
  let emissiveAmt = max(lutEmissive, matEmissive) + flashAmt * 0.5;
  let hdrExcess = max(finalRgb - vec3f(1.0), vec3f(0.0));

  out.color = vec4f(clamp(finalRgb, vec3f(0.0), vec3f(1.0)), finalAlpha);
  out.emissive = vec4f(finalRgb * emissiveAmt + hdrExcess, finalAlpha);
  return out;
}

// ============================================================================
// Pixel-Sculpted Indexed Mesh3D + 3D Line Gizmo + Directional Shadow Map Pass
// ============================================================================
struct Mesh3DIn {
  @location(0) posAo: vec4f,        // posX, posY, posZ, ao
  @location(1) normPage: vec4f,     // normX, normY, normZ, atlasPage
  @location(2) uvPalMode: vec4f,    // u, v, paletteRow, mode (0=atlas, 1=solid, 2=unlit line)
  @location(3) tint: vec4f,         // r, g, b, a
  @location(4) matFlash: vec4f,     // roughness, metallic, emissive, flash
};

struct Mesh3DOut {
  @builtin(position) pos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) normal: vec3f,
  @location(2) texUv: vec2f,
  @location(3) tint: vec4f,
  @location(4) matFlash: vec4f,
  @location(5) meta: vec4f,         // ao, atlasPage, paletteRow, mode
};

struct ShadowQuadOut {
  @builtin(position) pos: vec4f,
  @location(0) texUv: vec2f,
  @location(1) meta: vec4f,         // mode, atlasPage, tintAlpha, 0
};

@vertex
fn vsShadowMesh3D(v: Mesh3DIn) -> @builtin(position) vec4f {
  return uQuad3D.lightViewProj * vec4f(v.posAo.xyz, 1.0);
}

@vertex
fn vsShadowQuad3D(@builtin(vertex_index) vid: u32, inst: Quad3DIn) -> ShadowQuadOut {
  var uvUnit = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let u01 = uvUnit[vid];
  let worldPos = inst.originPage.xyz + inst.uAxisRough.xyz * u01.x + inst.vAxisMetal.xyz * u01.y;
  var out: ShadowQuadOut;
  out.pos = uQuad3D.lightViewProj * vec4f(worldPos, 1.0);
  out.texUv = mix(inst.uvBounds.xy, inst.uvBounds.zw, u01);
  out.meta = vec4f(inst.style.x, inst.originPage.w, inst.tint.a, 0.0);
  return out;
}

@fragment
fn fsShadowQuad3D(in: ShadowQuadOut) {
  let mode = in.meta.x;
  if (mode > 0.5 && mode < 3.5 && mode != 2.0) {
    discard;
  }
  if (mode < 0.5) {
    let atlasLayer = max(0, i32(floor(in.meta.y + 0.5)));
    let idxVal = round(textureSampleLevel(uIndexAtlas, uSamp, in.texUv, atlasLayer, 0.0).r * 255.0);
    if (idxVal < 0.5) { discard; }
    if (idxVal > 15.5) {
      let a = textureSampleLevel(uAtlas, uSamp, in.texUv, atlasLayer, 0.0).a * in.meta.z;
      if (a < 0.5) { discard; }
    }
  } else if (in.meta.z < 0.5) {
    discard;
  }
}

@vertex
fn vsMesh3D(v: Mesh3DIn) -> Mesh3DOut {
  var clip = uQuad3D.viewProj * vec4f(v.posAo.xyz, 1.0);
  let viewSize = max(vec2f(1.0), uQuad3D.viewParams.xy);
  let osScale = viewSize / (viewSize + vec2f(${OVERSCAN_PAD}.0 * 2.0));
  clip.x *= osScale.x;
  clip.y *= osScale.y;

  var out: Mesh3DOut;
  out.pos = clip;
  out.worldPos = v.posAo.xyz;
  out.normal = v.normPage.xyz;
  out.texUv = v.uvPalMode.xy;
  out.tint = v.tint;
  out.matFlash = v.matFlash;
  out.meta = vec4f(v.posAo.w, v.normPage.w, v.uvPalMode.z, v.uvPalMode.w);
  return out;
}

@fragment
fn fsMesh3D(in: Mesh3DOut) -> SceneOut {
  var out: SceneOut;
  let ao = clamp(in.meta.x, 0.1, 1.2);
  let atlasLayer = max(0, i32(floor(in.meta.y + 0.5)));
  let paletteRow = in.meta.z;
  let mode = in.meta.w;
  let opaquePass = uQuad3D.occWorld.w > 0.5;
  let flashAmt = clamp(in.matFlash.w, 0.0, 1.0);

  // Mode 2: Unlit crisp 3D gizmo / wireframe / ortho grid line
  if (mode > 1.5) {
    let col = mix(in.tint.rgb, vec3f(1.0), flashAmt);
    out.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), in.tint.a);
    out.emissive = vec4f(col * max(0.0, in.matFlash.z), in.tint.a);
    return out;
  }

  var texRgb = vec3f(1.0);
  var texAlpha = 1.0;
  var lutEmissive = 0.0;
  if (mode < 0.5) {
    let idxVal = round(textureSampleLevel(uIndexAtlas, uSamp, in.texUv, atlasLayer, 0.0).r * 255.0);
    if (idxVal < 0.5) { discard; }
    if (idxVal <= 15.5 && paletteRow >= -0.5) {
      let rows = max(1.0, uSky.extra.x);
      let rowIdx = clamp(floor(paletteRow + 0.5), 0.0, rows - 1.0);
      let lutUv = vec2f((idxVal + 0.5) / 16.0, (rowIdx + 0.5) / rows);
      let lutSample = textureSampleLevel(uPaletteLut, uSamp, lutUv, 0.0);
      texRgb = lutSample.rgb;
      lutEmissive = lutSample.a;
    } else {
      let sampled = textureSampleLevel(uAtlas, uSamp, in.texUv, atlasLayer, 0.0);
      if (sampled.a < 0.05) { discard; }
      texRgb = sampled.rgb;
      texAlpha = sampled.a;
    }
  }

  let finalAlpha = texAlpha * in.tint.a;
  if (opaquePass && finalAlpha < 0.5) { discard; }

  let nLen2 = dot(in.normal, in.normal);
  let n3d = select(vec3f(0.0, 0.0, 1.0), in.normal * inverseSqrt(max(nLen2, 1e-6)), nLen2 >= 1e-6);
  let rough = clamp(in.matFlash.x, 0.05, 1.0);
  let metal = clamp(in.matFlash.y, 0.0, 1.0);
  let matEmissive = clamp(in.matFlash.z, 0.0, 2.0);

  let specExp = mix(48.0, 6.0, rough);
  let specNorm = (specExp + 8.0) / 25.132741;
  let specScale = mix(0.95, 0.24, rough) * (0.42 + 0.58 * metal) * specNorm;
  let f0 = mix(vec3f(0.04), clamp(texRgb * in.tint.rgb, vec3f(0.0), vec3f(1.0)), metal);
  let diffConserv = mix(1.0, 0.62, metal);

  let sunDir = normalize(uQuad3D.sunDirInfo.xyz);
  let toEye = uQuad3D.eyePos.xyz - in.worldPos;
  let toEye2 = dot(toEye, toEye);
  let viewDir = select(toEye * inverseSqrt(max(toEye2, 1e-6)), vec3f(0.0, 0.65, 0.76), toEye2 < 1e-6);
  let ndv = clamp(dot(n3d, viewDir), 0.0, 1.0);
  let fresnel = f0 + (vec3f(1.0) - f0) * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  let sunShadow = sampleDirectionalShadow3D(in.worldPos, n3d);
  let hemi = mix(0.68, 1.14, dot(n3d, sunDir) * 0.5 + 0.5) * sunShadow;

  var litDiff = vec3f(0.0);
  var litSpec = vec3f(0.0);
  let lightCnt = min(24u, u32(max(0.0, uLights.info.x + 0.5)));
  var li = 0u;
  loop {
    if (li >= lightCnt) { break; }
    let lp = uLights.posRad[li];
    let lc = uLights.colInt[li];
    let toL = vec3f(lp.xy - in.worldPos.xy, getLightZ3D(li) - in.worldPos.z);
    let dist = length(toL);
    if (dist < lp.z) {
      let att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w));
      let toL2 = dot(toL, toL);
      let lDir = select(toL * inverseSqrt(max(toL2, 1e-6)), vec3f(0.0, 0.0, 1.0), toL2 < 1e-6);
      let ndl = max(0.0, dot(n3d, lDir));
      let halfSum = lDir + viewDir;
      let halfSum2 = dot(halfSum, halfSum);
      let hVec = select(halfSum * inverseSqrt(max(halfSum2, 1e-6)), n3d, halfSum2 < 1e-6);
      let spec = pow(max(0.0, dot(n3d, hVec)), specExp) * specScale * 0.78;
      litDiff += lc.rgb * (lc.a * att * (0.28 + 0.88 * ndl) * diffConserv);
      litSpec += lc.rgb * fresnel * (lc.a * att * spec);
    }
    li += 1u;
  }

  let baseLit = clamp(texRgb * in.tint.rgb * (hemi * ao * diffConserv), vec3f(0.0), vec3f(1.2));
  let shaded = clamp(baseLit * (1.0 + litDiff) + litSpec, vec3f(0.0), vec3f(1.48));
  let finalRgb = mix(shaded, vec3f(1.0), flashAmt);
  let emissiveAmt = max(lutEmissive, matEmissive) + flashAmt * 0.5;
  let hdrExcess = max(finalRgb - vec3f(1.0), vec3f(0.0));

  out.color = vec4f(clamp(finalRgb, vec3f(0.0), vec3f(1.0)), finalAlpha);
  out.emissive = vec4f(finalRgb * emissiveAmt + hdrExcess, finalAlpha);
  return out;
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
