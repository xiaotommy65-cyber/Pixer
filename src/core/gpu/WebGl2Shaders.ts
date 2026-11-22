import { OVERSCAN_PAD } from './GpuTypes.ts';

const GLSL_COLOR_TRANSFER = `
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

const GLSL_BAYER4X4 = `
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

export const SKY_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corners[6] = vec2[6](
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0)
  );
  vec2 p = corners[gl_VertexID];
  vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform vec3 uTopColor;
uniform vec3 uMidColor;
uniform vec3 uBottomColor;
uniform float uCozyFilter;
uniform float uTimeSec;
uniform vec2 uViewSize;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragEmissive;
${GLSL_COLOR_TRANSFER}
${GLSL_BAYER4X4}
void main() {
  float y = clamp(vUv.y, 0.0, 1.0);
  vec2 viewSize = max(vec2(1.0), uViewSize);
  float horizonGlow = pow(max(y, 1e-4), 2.4) * 0.045 * (0.85 + 0.15 * sin(uTimeSec * 0.7 + vUv.x * 3.14159));
  vec3 topLin = srgbToLin(uTopColor);
  vec3 midLin = srgbToLin(uMidColor);
  vec3 botLin = srgbToLin(uBottomColor);
  vec3 upper = mix(topLin, midLin, clamp(y * 2.0, 0.0, 1.0));
  vec3 lower = mix(midLin, botLin, clamp((y - 0.5) * 2.0, 0.0, 1.0));
  vec3 skyLin = mix(upper, lower, step(0.5, y)) + botLin * horizonGlow;
  if (uCozyFilter > 0.5) {
    float rayPhase = sin((vUv.x * 1.35 + vUv.y * 0.55) * 6.28318 - uTimeSec * 0.32) * 0.5 + 0.5;
    float godRay = pow(max(1e-4, rayPhase), 3.0) * (1.0 - y * 0.72) * 0.055;
    skyLin += topLin * godRay;
  }
  vec3 col = linToSrgb(skyLin);
  col += vec3(bayer4x4(vUv * viewSize) * (1.75 / 255.0));
  if (uCozyFilter > 0.5) {
    col *= 0.985 + 0.015 * sin(vUv.y * viewSize.y * 6.28318);
  }
  fragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);
  fragEmissive = vec4(0.0, 0.0, 0.0, 1.0);
}`;

export const SPRITE_VS = `#version 300 es
layout(location = 0) in vec4 aRectPosSize;
layout(location = 1) in vec4 aUvBounds;
layout(location = 2) in vec4 aTint;
layout(location = 3) in vec4 aExtra;
layout(location = 4) in vec4 aDeform;   // x: pivotX, y: pivotY, z: skewX, w: paletteRow
layout(location = 5) in vec4 aMaterial; // x: atlasPage, y: roughness, z: metallic, w: emissive

uniform vec2 uViewSize;

out vec2 vTexUv;
out vec2 vLocalUv;
out vec4 vTint;
out float vMode;
out float vFlash;
out float vParam;
out vec4 vUvBounds;
out float vPaletteRow;
out vec2 vScreenPos;
out vec4 vMaterial;
out vec2 vQuadCenter;

void main() {
  vec2 uvUnit[6] = vec2[6](
    vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0)
  );
  vec2 u01 = uvUnit[gl_VertexID];
  vec2 pivot = aDeform.xy;
  float skewX = aDeform.z;
  vec2 local = (u01 - pivot) * aRectPosSize.zw;
  vec2 sheared = vec2(local.x - local.y * skewX, local.y);

  float c = cos(aExtra.x);
  float s = sin(aExtra.x);
  vec2 rotated = vec2(sheared.x * c - sheared.y * s, sheared.x * s + sheared.y * c);
  vec2 world = aRectPosSize.xy + rotated;

  vec2 osSize = max(vec2(1.0), uViewSize) + vec2(${OVERSCAN_PAD}.0 * 2.0);
  float ndcX = ((world.x + ${OVERSCAN_PAD}.0) / osSize.x) * 2.0 - 1.0;
  float ndcY = 1.0 - ((world.y + ${OVERSCAN_PAD}.0) / osSize.y) * 2.0;

  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
  vTexUv = mix(aUvBounds.xy, aUvBounds.zw, u01);
  vLocalUv = u01;
  vTint = aTint;
  vMode = aExtra.y;
  vFlash = aExtra.z;
  vParam = aExtra.w;
  vUvBounds = aUvBounds;
  vPaletteRow = aDeform.w;
  vScreenPos = world;
  vMaterial = aMaterial;
  vQuadCenter = aRectPosSize.xy;
}`;

export const SPRITE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
in vec2 vTexUv;
in vec2 vLocalUv;
in vec4 vTint;
in float vMode;
in float vFlash;
in float vParam;
in vec4 vUvBounds;
in float vPaletteRow;
in vec2 vScreenPos;
in vec4 vMaterial;
in vec2 vQuadCenter;

uniform sampler2DArray uAtlas;
uniform sampler2DArray uIndexAtlas;
uniform sampler2D uPaletteLut;
uniform sampler2D uOcclusionTex;
uniform float uPaletteRows;
uniform int uLightCount;
uniform vec4 uLightPosRad[24];
uniform vec4 uLightColInt[24];
uniform vec4 uOccParams; // x: originScreenX, y: originScreenY, z: tileSizePx, w: occSoftness
uniform vec4 uOccDims;   // x: cols, y: rows, z: occStrength, w: 0

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragEmissive;

// Branchless 32-bit unsigned integer xxHash32-style mix (eliminates mobile FP16 sin() banding)
float hash21(vec2 p) {
  ivec2 ip = ivec2(floor(p * 8.0 + 0.5));
  uint h = uint(ip.x) * 374761393u + uint(ip.y) * 668265263u + 1442695041u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h = h ^ (h >> 16u);
  return float(h & 0x00ffffffu) * (1.0 / 16777216.0);
}

float sampleOccCell(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uOccDims.x || cell.y >= uOccDims.y) {
    return 0.0;
  }
  vec2 uv = (cell + vec2(0.5)) / 64.0;
  return textureLod(uOcclusionTex, uv, 0.0).r;
}

float sampleShadowOcclusion(vec2 fragPos, vec2 lightPos) {
  float strength = uOccDims.z;
  float tilePx = uOccParams.z;
  if (strength <= 0.01 || tilePx <= 1.0) return 1.0;
  vec2 origin = uOccParams.xy;
  vec2 fragCell = (fragPos - origin) / tilePx;
  vec2 lightCell = (lightPos - origin) / tilePx;
  vec2 delta = lightCell - fragCell;
  if (length(delta) < 0.25) return 1.0;
  vec2 fragTile = floor(fragCell);
  vec2 lightTile = floor(lightCell);
  float hits = 0.0;
  for (int s = 1; s <= 14; s++) {
    float t = float(s) / 15.0;
    vec2 pTile = floor(fragCell + delta * t);
    bool isSelf = abs(pTile.x - fragTile.x) < 0.5 && abs(pTile.y - fragTile.y) < 0.5;
    bool isLightCell = abs(pTile.x - lightTile.x) < 0.5 && abs(pTile.y - lightTile.y) < 0.5;
    if (!isSelf && !isLightCell) {
      if (sampleOccCell(pTile) > 0.5) {
        hits += 1.0;
      }
    }
  }
  float softSteps = max(0.35, uOccParams.w * 2.4);
  float shadowAmt = clamp(hits / softSteps, 0.0, 1.0) * strength;
  return 1.0 - shadowAmt;
}

float sampleWallBaseAo(vec2 fragPos) {
  float strength = uOccDims.z;
  float tilePx = uOccParams.z;
  if (strength <= 0.01 || tilePx <= 1.0) return 1.0;
  vec2 cellPos = (fragPos - uOccParams.xy) / tilePx;
  vec2 tile = floor(cellPos);
  if (sampleOccCell(tile) > 0.5) return 1.0;
  vec2 frac = fract(cellPos);
  float ao = 1.0;
  if (sampleOccCell(tile + vec2(0.0, -1.0)) > 0.5) {
    ao *= mix(0.68, 1.0, smoothstep(0.0, 0.44, frac.y));
  }
  if (sampleOccCell(tile + vec2(-1.0, 0.0)) > 0.5) {
    ao *= mix(0.84, 1.0, smoothstep(0.0, 0.22, frac.x));
  }
  if (sampleOccCell(tile + vec2(1.0, 0.0)) > 0.5) {
    ao *= mix(0.84, 1.0, smoothstep(0.0, 0.22, 1.0 - frac.x));
  }
  return mix(1.0, ao, clamp(strength, 0.0, 1.0));
}

void main() {
  // Mode 5: Smooth atmospheric gradient & tilt-shift vignette
  if (vMode > 4.5) {
    float dir = vUvBounds.x;
    float pwr = max(0.35, vParam);
    float fade = 0.0;
    if (dir < 0.5) {
      fade = pow(clamp(1.0 - vLocalUv.y, 1e-4, 1.0), pwr);
    } else if (dir < 1.5) {
      fade = pow(clamp(vLocalUv.y, 1e-4, 1.0), pwr);
    } else {
      float d = length((vLocalUv - vec2(0.5)) * vec2(1.5, 1.9));
      fade = smoothstep(0.45, 1.25, d);
    }
    float a = vTint.a * fade;
    fragColor = vec4(vTint.rgb, a);
    fragEmissive = vec4(0.0, 0.0, 0.0, a);
    return;
  }

  // Mode 4: Procedural normal-lit beveled masonry / earth / timber / astral facade
  if (vMode > 3.5) {
    float tx = max(0.5, vUvBounds.x);
    float ty = max(0.25, vUvBounds.y);
    float seed = vUvBounds.z;
    float mat = vParam;
    vec2 coord = vec2(vLocalUv.x * tx, vLocalUv.y * ty);

    float nx = 0.0;
    float ny = 0.0;
    float mortarMask = 1.0;
    float cellTint = 0.0;
    float runeAccent = 0.0;

    if (mat > 0.5 && mat < 1.5) {
      float wave = sin(coord.x * 4.4 + seed) * 0.14;
      float strata = fract(coord.y * 2.2 + wave);
      ny = (strata - 0.5) * 0.75;
      nx = cos(coord.x * 4.4 + seed) * 0.25;
      mortarMask = smoothstep(0.0, 0.14, strata) * smoothstep(1.0, 0.86, strata);
      cellTint = (hash21(floor(coord * 3.5) + seed) - 0.5) * 0.14;
    } else if (mat >= 1.5 && mat < 2.5) {
      float panel = fract(coord.x * 1.5);
      float rivetDist = length(vec2(panel - 0.5, vLocalUv.y - 0.52) * vec2(2.4, 2.0));
      nx = (0.5 - panel) * 0.35;
      ny = (vLocalUv.y - 0.5) * 0.5;
      mortarMask = 0.82 + 0.18 * smoothstep(0.0, 0.12, min(panel, 1.0 - panel));
      if (rivetDist < 0.28) {
        runeAccent = (1.0 - rivetDist / 0.28) * 0.24;
      }
    } else {
      float row = floor(coord.y * 2.0);
      float stagger = fract(row * 0.5) * 0.5;
      vec2 brickUv = vec2(fract(coord.x * 1.45 + stagger), fract(coord.y * 2.0));
      vec2 brickId = vec2(floor(coord.x * 1.45 + stagger), row);
      cellTint = (hash21(brickId + seed) - 0.5) * 0.15;

      float bevel = 0.16;
      if (brickUv.x < bevel) nx = -0.65;
      else if (brickUv.x > 1.0 - bevel) nx = 0.65;
      if (brickUv.y < bevel) ny = -0.75;
      else if (brickUv.y > 1.0 - bevel) ny = 0.75;

      float edgeDist = min(min(brickUv.x, 1.0 - brickUv.x), min(brickUv.y, 1.0 - brickUv.y));
      mortarMask = mix(0.56, 1.0, smoothstep(0.02, 0.13, edgeDist));
      if (mat > 2.5 && edgeDist < 0.08) {
        runeAccent = 0.18;
      }
    }

    if (vLocalUv.y < 0.16) ny -= 0.7;
    if (vLocalUv.y > 0.88) ny += 0.65;
    if (vLocalUv.x < 0.06) nx -= 0.45;
    if (vLocalUv.x > 0.94) nx += 0.45;

    vec3 n = normalize(vec3(nx, ny, 1.0));
    vec3 lightDir = normalize(vec3(-0.42, -0.78, 0.46));
    float ndl = clamp(dot(n, lightDir), 0.2, 1.28);
    float aoBottom = mix(1.04, 0.58, smoothstep(0.22, 1.0, vLocalUv.y));
    float topRim = smoothstep(0.14, 0.0, vLocalUv.y) * 0.24;
    float grain = (hash21(floor(coord * 8.0) + seed) - 0.5) * 0.06;

    vec3 baseCol = vTint.rgb * (1.0 + cellTint + grain) * mortarMask * ndl * aoBottom;
    baseCol += vec3(topRim + runeAccent * 0.6, topRim + runeAccent * 0.45, topRim * 1.1 + runeAccent);
    int wCnt = min(24, max(0, uLightCount));
    vec3 wallLit = vec3(0.0);
    for (int wli = 0; wli < 24; wli++) {
      if (wli >= wCnt) break;
      vec4 lp = uLightPosRad[wli];
      vec4 lc = uLightColInt[wli];
      vec3 toL = vec3(lp.xy - vScreenPos, 24.0);
      float dist = length(toL.xy);
      if (dist < lp.z) {
        float vis = sampleShadowOcclusion(vScreenPos, lp.xy);
        if (vis > 0.01) {
          float att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w));
          float diff = max(0.15, dot(n, normalize(toL)));
          wallLit += lc.rgb * (lc.a * att * diff * vis * 0.85);
        }
      }
    }
    baseCol *= (1.0 + wallLit);
    float sideSoft = smoothstep(0.0, 0.04, vLocalUv.x) * smoothstep(1.0, 0.96, vLocalUv.x);
    float finalAlpha = vTint.a * mix(0.75, 1.0, sideSoft);
    fragColor = vec4(clamp(baseCol, vec3(0.0), vec3(1.0)), finalAlpha);
    fragEmissive = vec4(0.0, 0.0, 0.0, finalAlpha);
    return;
  }

  // Mode 3: Smooth analytical SDF elliptical soft contact shadow
  if (vMode > 2.5) {
    vec2 p = vLocalUv * 2.0 - vec2(1.0);
    float d2 = dot(p, p);
    if (d2 >= 1.0) discard;
    float d = sqrt(d2);
    float soft = clamp(vParam, 0.15, 0.98);
    float outer = smoothstep(1.0, 1.0 - soft, d);
    float umbra = smoothstep(0.68, 0.0, d) * 0.36;
    float shadowAlpha = vTint.a * clamp(outer * 0.78 + umbra, 0.0, 1.0);
    fragColor = vec4(vTint.rgb, shadowAlpha);
    fragEmissive = vec4(0.0, 0.0, 0.0, shadowAlpha);
    return;
  }

  // Mode 2: Solid crisp quad or sculpted beveled UI frame (param > 0.01)
  if (vMode > 1.5) {
    vec3 col = vTint.rgb;
    float alpha = vTint.a;
    if (vParam > 0.01) {
      float edgeY = min(vLocalUv.y, 1.0 - vLocalUv.y);
      float edgeX = min(vLocalUv.x, 1.0 - vLocalUv.x);
      float topHighlight = smoothstep(0.32, 0.0, vLocalUv.y) * 0.22;
      float botShade = smoothstep(0.68, 1.0, vLocalUv.y) * 0.26;
      col = col * (1.0 - botShade) + vec3(topHighlight);
      float cornerMask = smoothstep(0.0, 0.06, edgeX) * smoothstep(0.0, 0.14, edgeY);
      alpha *= mix(0.65, 1.0, cornerMask);
    }
    float flashAmt = clamp(vFlash, 0.0, 1.0);
    vec3 solidRgb = mix(col, vec3(1.0), flashAmt);
    fragColor = vec4(solidRgb, alpha);
    fragEmissive = vec4(solidRgb * flashAmt * 0.45, alpha);
    return;
  }

  // Mode 1: Smooth radial GPU light orb OR 4-point cross star glint (param >= 9.5)
  if (vMode > 0.5) {
    vec2 p = vLocalUv * 2.0 - vec2(1.0);
    float d2 = dot(p, p);
    if (d2 >= 1.0) discard;
    float d = sqrt(d2);
    if (vParam >= 9.5) {
      float sharp = max(1.2, vParam - 10.0);
      float core = exp(-d * 4.2);
      float arms = exp(-abs(p.x) * (4.5 * sharp)) * exp(-abs(p.y) * 1.9)
                 + exp(-abs(p.y) * (4.5 * sharp)) * exp(-abs(p.x) * 1.9);
      float glint = clamp(core + arms * 0.8, 0.0, 1.0) * smoothstep(1.0, 0.25, d);
      float a = vTint.a * glint;
      fragColor = vec4(vTint.rgb, a);
      fragEmissive = vec4(vTint.rgb * 0.85, a);
      return;
    }
    float f = clamp(1.0 - d, 0.0, 1.0);
    float power = vParam > 0.1 ? vParam : 2.0;
    float occVis = sampleShadowOcclusion(vScreenPos, vQuadCenter);
    float glow = (f > 0.001 ? pow(f, power) : 0.0) * occVis;
    float a = vTint.a * glow;
    fragColor = vec4(vTint.rgb, a);
    fragEmissive = vec4(vTint.rgb * 0.68, a);
    return;
  }

  // Mode 0: Multi-Page Texture2DArray Sprite + Per-Instance PBR-Lite Material Shading
  float atlasLayer = max(0.0, floor(vMaterial.x + 0.5));
  float idxVal = floor(texture(uIndexAtlas, vec3(vTexUv, atlasLayer)).r * 255.0 + 0.5);
  if (idxVal < 0.5) discard;

  vec3 texRgb = vec3(1.0);
  float texAlpha = 1.0;
  float lutEmissive = 0.0;

  if (idxVal <= 15.5 && vPaletteRow >= -0.5) {
    float rows = max(1.0, uPaletteRows);
    float rowIdx = clamp(floor(vPaletteRow + 0.5), 0.0, rows - 1.0);
    vec2 lutUv = vec2((idxVal + 0.5) / 16.0, (rowIdx + 0.5) / rows);
    vec4 lutSample = texture(uPaletteLut, lutUv);
    texRgb = lutSample.rgb;
    lutEmissive = lutSample.a;
  } else {
    vec4 sampled = texture(uAtlas, vec3(vTexUv, atlasLayer));
    if (sampled.a < 0.05) discard;
    texRgb = sampled.rgb;
    texAlpha = sampled.a;
  }

  float rough = clamp(vMaterial.y, 0.05, 1.0);
  float metal = clamp(vMaterial.z, 0.0, 1.0);
  float matEmissive = clamp(vMaterial.w, 0.0, 2.0);
  float specExp = mix(56.0, 6.0, rough);
  float specScale = mix(1.0, 0.22, rough) * (0.26 + 0.74 * metal + (idxVal > 250.0 ? 0.14 : 0.0));
  vec3 f0 = mix(vec3(0.95), texRgb * 1.15, metal);
  float diffConserv = mix(1.0, 0.58, metal);

  float reliefShade = 1.0;
  vec3 keySpecRgb = vec3(0.0);
  vec3 litDiff = vec3(0.0);
  vec3 litSpec = vec3(0.0);

  if (vPaletteRow > -1.5) {
    vec2 texel = 1.0 / vec2(textureSize(uIndexAtlas, 0).xy);
    vec2 uvMin = min(vUvBounds.xy, vUvBounds.zw) + texel * 0.5;
    vec2 uvMax = max(vUvBounds.xy, vUvBounds.zw) - texel * 0.5;
    vec2 safeMin = min(uvMin, uvMax);
    vec2 safeMax = max(uvMin, uvMax);
    float flipSign = vUvBounds.x > vUvBounds.z ? -1.0 : 1.0;
    vec3 lumaW = vec3(0.299, 0.587, 0.114);
    vec4 sC = textureLod(uAtlas, vec3(clamp(vTexUv, safeMin, safeMax), atlasLayer), 0.0);
    vec4 sL = textureLod(uAtlas, vec3(clamp(vTexUv - vec2(texel.x * flipSign, 0.0), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sR = textureLod(uAtlas, vec3(clamp(vTexUv + vec2(texel.x * flipSign, 0.0), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sU = textureLod(uAtlas, vec3(clamp(vTexUv - vec2(0.0, texel.y), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sD = textureLod(uAtlas, vec3(clamp(vTexUv + vec2(0.0, texel.y), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sBR = textureLod(uAtlas, vec3(clamp(vTexUv + vec2(texel.x * flipSign, texel.y), safeMin, safeMax), atlasLayer), 0.0);

    float hC = sC.a * (0.65 + 0.35 * dot(sC.rgb, lumaW));
    float hL = sL.a * (0.65 + 0.35 * dot(sL.rgb, lumaW));
    float hR = sR.a * (0.65 + 0.35 * dot(sR.rgb, lumaW));
    float hU = sU.a * (0.65 + 0.35 * dot(sU.rgb, lumaW));
    float hD = sD.a * (0.65 + 0.35 * dot(sD.rgb, lumaW));
    float hBR = sBR.a * (0.65 + 0.35 * dot(sBR.rgb, lumaW));

    float gx = hR - hL;
    float gy = hD - hU;
    vec3 sobelN = normalize(vec3(-gx * 1.45, -gy * 1.45, 1.0));
    vec3 sobelLight = normalize(vec3(-0.55, -0.75, 0.42));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfKey = normalize(sobelLight + viewDir);
    float keySpecAmt = pow(max(0.0, dot(sobelN, halfKey)), specExp) * specScale * 0.42;
    float ndl = dot(sobelN, sobelLight) - sobelLight.z;
    float rimBoost = (hC - hBR) > 0.45 ? (0.07 + 0.14 * metal) : 0.0;
    reliefShade = clamp(1.0 + ndl * 0.28, 0.84, 1.18) * diffConserv + rimBoost;
    keySpecRgb = f0 * keySpecAmt;

    int cnt = min(24, max(0, uLightCount));
    for (int li = 0; li < 24; li++) {
      if (li >= cnt) break;
      vec4 lp = uLightPosRad[li];
      vec4 lc = uLightColInt[li];
      vec3 toL = vec3(lp.xy - vScreenPos, 22.0);
      float dist = length(toL.xy);
      if (dist < lp.z) {
        float vis = sampleShadowOcclusion(vScreenPos, lp.xy);
        if (vis > 0.01) {
          float falloff = max(0.2, lp.w);
          float att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), falloff) * vis;
          vec3 lDir = normalize(toL);
          float diff = max(0.0, dot(sobelN, lDir));
          vec3 hVec = normalize(lDir + viewDir);
          float spec = pow(max(0.0, dot(sobelN, hVec)), specExp) * specScale * 0.92;
          litDiff += lc.rgb * (lc.a * att * (0.34 + 0.90 * diff) * diffConserv);
          litSpec += lc.rgb * f0 * (lc.a * att * spec);
        }
      }
    }
    reliefShade *= sampleWallBaseAo(vScreenPos);
  }

  float flashAmt = clamp(vFlash, 0.0, 1.0);
  vec3 baseRgb = clamp(texRgb * vTint.rgb * reliefShade + keySpecRgb, vec3(0.0), vec3(1.15));
  if (vPaletteRow > -1.5) {
    baseRgb = clamp(baseRgb * (1.0 + litDiff) + litSpec, vec3(0.0), vec3(1.45));
  }
  vec3 finalRgb = mix(baseRgb, vec3(1.0), flashAmt);
  float finalAlpha = texAlpha * vTint.a;
  float emissiveAmt = max(lutEmissive, max(clamp(vParam, 0.0, 2.0), matEmissive)) + flashAmt * 0.5;
  vec3 hdrExcess = max(finalRgb - vec3(1.0), vec3(0.0));

  fragColor = vec4(clamp(finalRgb, vec3(0.0), vec3(1.0)), finalAlpha);
  fragEmissive = vec4(finalRgb * emissiveAmt + hdrExcess, finalAlpha);
}`;

export const QUAD3D_VS = `#version 300 es
layout(location = 0) in vec4 aOriginPage;   // originX, originY, originZ, atlasPage
layout(location = 1) in vec4 aUAxisRough;   // uAxisX, uAxisY, uAxisZ, roughness
layout(location = 2) in vec4 aVAxisMetal;   // vAxisX, vAxisY, vAxisZ, metallic
layout(location = 3) in vec4 aUvBounds;     // u0, v0, u1, v1
layout(location = 4) in vec4 aTint;         // r, g, b, a
layout(location = 5) in vec4 aNormEmissive; // normalX, normalY, normalZ, emissive
layout(location = 6) in vec4 aStyle;        // mode, flash, shadeMult, paletteRow

uniform mat4 uViewProj;
uniform vec2 uViewSize;

out vec2 vTexUv;
out vec2 vLocalUv;
out vec4 vTint;
out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vMaterial;
out vec4 vStyle;
out vec4 vUvBounds;
out vec2 vQuadCenterXy;

void main() {
  vec2 uvUnit[6] = vec2[6](
    vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0)
  );
  vec2 u01 = uvUnit[gl_VertexID];
  vec3 worldPos = aOriginPage.xyz + aUAxisRough.xyz * u01.x + aVAxisMetal.xyz * u01.y;
  vec4 clip = uViewProj * vec4(worldPos, 1.0);
  vec2 viewSize = max(vec2(1.0), uViewSize);
  vec2 osScale = viewSize / (viewSize + vec2(${OVERSCAN_PAD}.0 * 2.0));
  clip.x *= osScale.x;
  clip.y *= osScale.y;

  vec3 centerPos = aOriginPage.xyz + (aUAxisRough.xyz + aVAxisMetal.xyz) * 0.5;
  gl_Position = clip;
  vTexUv = mix(aUvBounds.xy, aUvBounds.zw, u01);
  vLocalUv = u01;
  vTint = aTint;
  vWorldPos = worldPos;
  vNormal = aNormEmissive.xyz;
  vMaterial = vec4(aOriginPage.w, aUAxisRough.w, aVAxisMetal.w, aNormEmissive.w);
  vStyle = aStyle;
  vUvBounds = aUvBounds;
  vQuadCenterXy = centerPos.xy;
}`;

export const QUAD3D_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

in vec2 vTexUv;
in vec2 vLocalUv;
in vec4 vTint;
in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vMaterial;
in vec4 vStyle;
in vec4 vUvBounds;
in vec2 vQuadCenterXy;

uniform sampler2DArray uAtlas;
uniform sampler2DArray uIndexAtlas;
uniform sampler2D uPaletteLut;
uniform sampler2D uOcclusionTex;
uniform float uPaletteRows;
uniform int uLightCount;
uniform vec4 uLightPosRad[24];
uniform vec4 uLightColInt[24];
uniform vec4 uOccWorld; // x: originWorldX, y: originWorldY, z: tileSizeWorld, w: occSoftness
uniform vec4 uOccDims;  // x: cols, y: rows, z: occStrength, w: opaquePass (1=cutout, 0=blend)

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragEmissive;

float hash21(vec2 p) {
  ivec2 ip = ivec2(floor(p * 8.0 + 0.5));
  uint h = uint(ip.x) * 374761393u + uint(ip.y) * 668265263u + 1442695041u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h = h ^ (h >> 16u);
  return float(h & 0x00ffffffu) * (1.0 / 16777216.0);
}

float sampleOccCell(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uOccDims.x || cell.y >= uOccDims.y) {
    return 0.0;
  }
  vec2 uv = (cell + vec2(0.5)) / 64.0;
  return textureLod(uOcclusionTex, uv, 0.0).r;
}

float sampleShadowOcclusion3D(vec2 fragWorldXy, vec2 lightWorldXy) {
  float strength = uOccDims.z;
  float tileSize = uOccWorld.z;
  if (strength <= 0.01 || tileSize <= 1.0) return 1.0;
  vec2 origin = uOccWorld.xy;
  vec2 fragCell = (fragWorldXy - origin) / tileSize;
  vec2 lightCell = (lightWorldXy - origin) / tileSize;
  vec2 delta = lightCell - fragCell;
  if (length(delta) < 0.25) return 1.0;
  vec2 fragTile = floor(fragCell);
  vec2 lightTile = floor(lightCell);
  float hits = 0.0;
  for (int s = 1; s <= 14; s++) {
    float t = float(s) / 15.0;
    vec2 pTile = floor(fragCell + delta * t);
    bool isSelf = abs(pTile.x - fragTile.x) < 0.5 && abs(pTile.y - fragTile.y) < 0.5;
    bool isLightCell = abs(pTile.x - lightTile.x) < 0.5 && abs(pTile.y - lightTile.y) < 0.5;
    if (!isSelf && !isLightCell) {
      if (sampleOccCell(pTile) > 0.5) {
        hits += 1.0;
      }
    }
  }
  float softSteps = max(0.35, uOccWorld.w * 2.4);
  float shadowAmt = clamp(hits / softSteps, 0.0, 1.0) * strength;
  return 1.0 - shadowAmt;
}

float sampleWallBaseAo3D(vec2 fragWorldXy) {
  float strength = uOccDims.z;
  float tileSize = uOccWorld.z;
  if (strength <= 0.01 || tileSize <= 1.0) return 1.0;
  vec2 cellPos = (fragWorldXy - uOccWorld.xy) / tileSize;
  vec2 tile = floor(cellPos);
  if (sampleOccCell(tile) > 0.5) return 1.0;
  vec2 frac = fract(cellPos);
  float ao = 1.0;
  if (sampleOccCell(tile + vec2(0.0, -1.0)) > 0.5) {
    ao *= mix(0.62, 1.0, smoothstep(0.0, 0.48, frac.y));
  }
  if (sampleOccCell(tile + vec2(0.0, 1.0)) > 0.5) {
    ao *= mix(0.80, 1.0, smoothstep(0.0, 0.24, 1.0 - frac.y));
  }
  if (sampleOccCell(tile + vec2(-1.0, 0.0)) > 0.5) {
    ao *= mix(0.76, 1.0, smoothstep(0.0, 0.28, frac.x));
  }
  if (sampleOccCell(tile + vec2(1.0, 0.0)) > 0.5) {
    ao *= mix(0.76, 1.0, smoothstep(0.0, 0.28, 1.0 - frac.x));
  }
  return mix(1.0, ao, clamp(strength, 0.0, 1.0));
}

void main() {
  float mode = vStyle.x;
  float flashAmt = clamp(vStyle.y, 0.0, 1.0);
  float shadeMult = vStyle.z;
  float paletteRow = vStyle.w;
  bool opaquePass = uOccDims.w > 0.5;

  // Mode 3: Grounded analytical SDF elliptical soft contact shadow on floor
  if (mode > 2.5 && mode < 3.5) {
    vec2 p = vLocalUv * 2.0 - vec2(1.0);
    float d2 = dot(p, p);
    if (d2 >= 1.0) discard;
    float d = sqrt(d2);
    float soft = clamp(shadeMult > 0.05 ? shadeMult : 0.62, 0.15, 0.98);
    float outer = smoothstep(1.0, 1.0 - soft, d);
    float umbra = smoothstep(0.68, 0.0, d) * 0.36;
    float shadowAlpha = vTint.a * clamp(outer * 0.78 + umbra, 0.0, 1.0);
    if (opaquePass && shadowAlpha < 0.5) discard;
    fragColor = vec4(vTint.rgb, shadowAlpha);
    fragEmissive = vec4(0.0, 0.0, 0.0, shadowAlpha);
    return;
  }

  // Mode 1: Radial GPU light orb in 3D space
  if (mode > 0.5 && mode < 1.5) {
    vec2 p = vLocalUv * 2.0 - vec2(1.0);
    float d2 = dot(p, p);
    if (d2 >= 1.0) discard;
    float d = sqrt(d2);
    float f = clamp(1.0 - d, 0.0, 1.0);
    float power = shadeMult > 0.1 ? shadeMult : 2.0;
    float occVis = sampleShadowOcclusion3D(vWorldPos.xy, vQuadCenterXy);
    float glow = (f > 0.001 ? pow(f, power) : 0.0) * occVis;
    float a = vTint.a * glow;
    if (opaquePass && a < 0.5) discard;
    fragColor = vec4(vTint.rgb, a);
    fragEmissive = vec4(vTint.rgb * 0.72, a);
    return;
  }

  // Mode 2: Solid 3D quad / particle / oblique shadow / accent slab
  if (mode > 1.5 && mode < 2.5) {
    vec3 col = mix(vTint.rgb * max(0.05, shadeMult), vec3(1.0), flashAmt);
    float a = vTint.a;
    if (opaquePass && a < 0.5) discard;
    float em = max(vMaterial.w, flashAmt * 0.5);
    fragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), a);
    fragEmissive = vec4(col * em, a);
    return;
  }

  vec3 n3d = normalize(vNormal);
  bool isVertical = abs(n3d.z) < 0.5;
  vec2 shadowSamplePos = vWorldPos.xy + (isVertical ? n3d.xy * 2.5 : vec2(0.0));

  // Mode 4: Procedural normal-lit beveled masonry 3D vertical wall face
  if (mode > 3.5) {
    float tx = max(0.5, vUvBounds.x);
    float ty = max(0.25, vUvBounds.y);
    float seed = vUvBounds.z;
    vec2 coord = vec2(vLocalUv.x * tx, vLocalUv.y * ty);
    float row = floor(coord.y * 2.0);
    float stagger = fract(row * 0.5) * 0.5;
    vec2 brickUv = vec2(fract(coord.x * 1.45 + stagger), fract(coord.y * 2.0));
    vec2 brickId = vec2(floor(coord.x * 1.45 + stagger), row);
    float cellTint = (hash21(brickId + seed) - 0.5) * 0.14;
    float edgeDist = min(min(brickUv.x, 1.0 - brickUv.x), min(brickUv.y, 1.0 - brickUv.y));
    float mortarMask = mix(0.56, 1.0, smoothstep(0.02, 0.13, edgeDist));
    float aoBottom = mix(1.04, 0.62, smoothstep(0.26, 1.0, vLocalUv.y));
    float topRim = smoothstep(0.12, 0.0, vLocalUv.y) * 0.22;
    float grain = (hash21(floor(coord * 8.0) + seed) - 0.5) * 0.06;

    vec3 sunDir = normalize(vec3(-0.38, 0.48, 0.79));
    float hemi = mix(0.70, 1.12, dot(n3d, sunDir) * 0.5 + 0.5);
    vec3 baseCol = vTint.rgb * max(0.2, shadeMult) * hemi * (1.0 + cellTint + grain) * mortarMask * aoBottom + vec3(topRim);

    int wCnt = min(24, max(0, uLightCount));
    vec3 litDiff = vec3(0.0);
    for (int li = 0; li < 24; li++) {
      if (li >= wCnt) break;
      vec4 lp = uLightPosRad[li];
      vec4 lc = uLightColInt[li];
      vec3 toL = vec3(lp.xy - vWorldPos.xy, 24.0 - vWorldPos.z);
      float dist = length(toL.xy);
      if (dist < lp.z) {
        float vis = sampleShadowOcclusion3D(shadowSamplePos, lp.xy);
        if (vis > 0.01) {
          float att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w)) * vis;
          float diff = max(0.12, dot(n3d, normalize(toL)));
          litDiff += lc.rgb * (lc.a * att * diff * 0.92);
        }
      }
    }
    baseCol = clamp(baseCol * (1.0 + litDiff), vec3(0.0), vec3(1.2));
    float a = vTint.a;
    if (opaquePass && a < 0.5) discard;
    fragColor = vec4(clamp(baseCol, vec3(0.0), vec3(1.0)), a);
    fragEmissive = vec4(max(baseCol - vec3(1.0), vec3(0.0)), a);
    return;
  }

  // Mode 0: Crisp Nearest-Neighbor Multi-Page Atlas Pixel Quad (Floor / Wall Face / Billboard)
  float atlasLayer = max(0.0, floor(vMaterial.x + 0.5));
  float idxVal = floor(texture(uIndexAtlas, vec3(vTexUv, atlasLayer)).r * 255.0 + 0.5);
  if (idxVal < 0.5) discard;

  vec3 texRgb = vec3(1.0);
  float texAlpha = 1.0;
  float lutEmissive = 0.0;
  if (idxVal <= 15.5 && paletteRow >= -0.5) {
    float rows = max(1.0, uPaletteRows);
    float rowIdx = clamp(floor(paletteRow + 0.5), 0.0, rows - 1.0);
    vec2 lutUv = vec2((idxVal + 0.5) / 16.0, (rowIdx + 0.5) / rows);
    vec4 lutSample = texture(uPaletteLut, lutUv);
    texRgb = lutSample.rgb;
    lutEmissive = lutSample.a;
  } else {
    vec4 sampled = texture(uAtlas, vec3(vTexUv, atlasLayer));
    if (sampled.a < 0.05) discard;
    texRgb = sampled.rgb;
    texAlpha = sampled.a;
  }

  float finalAlpha = texAlpha * vTint.a;
  if (opaquePass && finalAlpha < 0.5) discard;

  float rough = clamp(vMaterial.y, 0.05, 1.0);
  float metal = clamp(vMaterial.z, 0.0, 1.0);
  float matEmissive = clamp(vMaterial.w, 0.0, 2.0);
  float specExp = mix(48.0, 6.0, rough);
  float specScale = mix(0.85, 0.18, rough) * (0.24 + 0.76 * metal);
  vec3 f0 = mix(vec3(0.95), texRgb * 1.15, metal);
  float diffConserv = mix(1.0, 0.62, metal);

  vec3 sunDir = normalize(vec3(-0.38, 0.48, 0.79));
  vec3 viewDir = normalize(vec3(0.0, 0.65, 0.76));
  float hemi = mix(0.74, 1.12, dot(n3d, sunDir) * 0.5 + 0.5);

  float reliefShade = max(0.15, shadeMult) * hemi * diffConserv;
  vec3 topRimAdd = vec3(0.0);
  if (isVertical && paletteRow > -1.5) {
    float baseCrease = mix(1.0, 0.70, smoothstep(0.70, 1.0, vLocalUv.y));
    reliefShade *= baseCrease;
    topRimAdd = vec3(smoothstep(0.09, 0.0, vLocalUv.y) * 0.11);
  }
  if (n3d.z > 0.7 && vWorldPos.z < 2.0 && paletteRow > -1.5) {
    reliefShade *= sampleWallBaseAo3D(vWorldPos.xy);
  }

  vec3 litDiff = vec3(0.0);
  vec3 litSpec = vec3(0.0);
  if (paletteRow > -1.5) {
    int cnt = min(24, max(0, uLightCount));
    for (int li = 0; li < 24; li++) {
      if (li >= cnt) break;
      vec4 lp = uLightPosRad[li];
      vec4 lc = uLightColInt[li];
      vec3 toL = vec3(lp.xy - vWorldPos.xy, 24.0 - vWorldPos.z);
      float dist = length(toL.xy);
      if (dist < lp.z) {
        float vis = sampleShadowOcclusion3D(shadowSamplePos, lp.xy);
        if (vis > 0.01) {
          float att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w)) * vis;
          vec3 lDir = normalize(toL);
          float ndl = max(0.0, dot(n3d, lDir));
          float wrapDiff = isVertical ? (0.42 + 0.72 * ndl) : (0.32 + 0.85 * ndl);
          vec3 hVec = normalize(lDir + viewDir);
          float spec = pow(max(0.0, dot(n3d, hVec)), specExp) * specScale * 0.78;
          litDiff += lc.rgb * (lc.a * att * wrapDiff * diffConserv);
          litSpec += lc.rgb * f0 * (lc.a * att * spec);
        }
      }
    }
  }

  vec3 baseRgb = clamp(texRgb * vTint.rgb * reliefShade + topRimAdd, vec3(0.0), vec3(1.2));
  if (paletteRow > -1.5) {
    baseRgb = clamp(baseRgb * (1.0 + litDiff) + litSpec, vec3(0.0), vec3(1.48));
  }
  vec3 finalRgb = mix(baseRgb, vec3(1.0), flashAmt);
  float emissiveAmt = max(lutEmissive, matEmissive) + flashAmt * 0.5;
  vec3 hdrExcess = max(finalRgb - vec3(1.0), vec3(0.0));

  fragColor = vec4(clamp(finalRgb, vec3(0.0), vec3(1.0)), finalAlpha);
  fragEmissive = vec4(finalRgb * emissiveAmt + hdrExcess, finalAlpha);
}`;

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
      vec3 b0 = texture(uSceneTex, clamp(sampleUv + vec2(-rad.x, -rad.y), minUv, maxUv)).rgb;
      vec3 b1 = texture(uSceneTex, clamp(sampleUv + vec2(rad.x, -rad.y), minUv, maxUv)).rgb;
      vec3 b2 = texture(uSceneTex, clamp(sampleUv + vec2(-rad.x, rad.y), minUv, maxUv)).rgb;
      vec3 b3 = texture(uSceneTex, clamp(sampleUv + vec2(rad.x, rad.y), minUv, maxUv)).rgb;
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
    float scan = 0.94 + 0.06 * sin(vUv.y * viewSize.y * 6.28318);
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
    float gy = 0.97 + 0.03 * cos(vUv.y * viewSize.y * 6.28318);
    float vig = clamp(1.0 - r2 * 0.12, 0.88, 1.0);
    col = col * (gx * gy * vig) * vec3(1.01, 1.005, 0.985);
  } else if (uCozyFilter > 0.5) {
    float vig = clamp(1.0 - r2 * 0.06, 0.94, 1.0);
    col *= vig;
  }

  col += vec3(bayer4x4(gl_FragCoord.xy) * (1.0 / 255.0));
  fragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);
}`;
