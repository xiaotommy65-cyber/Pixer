/**
 * WebGL2 GLSL ES 3.00 shaders: defines 2D Sky/Sprite and re-exports Mesh3D/Shadow + Post passes
 * (`BLOOM_DOWN_FS` `karisWeight`, `COMPOSITE_FS` `acesFilmic`, `uCamFrac`, `uWaterLevel`, `uWaterTint`).
 */
import { OVERSCAN_PAD } from './GpuTypes.ts';
import {
  BLOOM_BLUR_FS,
  BLOOM_DOWN_FS,
  COMPOSITE_FS,
  GLSL_BAYER4X4,
  GLSL_COLOR_TRANSFER,
  POST_VS,
} from './WebGl2PostShaders.ts';
import {
  MESH3D_FS,
  MESH3D_VS,
  QUAD3D_FS,
  QUAD3D_VS,
  SHADOW_DEPTH_FS,
  SHADOW_MESH3D_VS,
  SHADOW_QUAD3D_FS,
  SHADOW_QUAD3D_VS,
} from './WebGl2Mesh3DShaders.ts';

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
  if (dot(delta, delta) < 0.0625) return 1.0;
  vec2 fragTile = floor(fragCell);
  vec2 lightTile = floor(lightCell);
  if (abs(fragTile.x - lightTile.x) < 0.5 && abs(fragTile.y - lightTile.y) < 0.5) return 1.0;
  bool hasX = abs(delta.x) > 1e-6;
  bool hasY = abs(delta.y) > 1e-6;
  float stepX = delta.x >= 0.0 ? 1.0 : -1.0;
  float stepY = delta.y >= 0.0 ? 1.0 : -1.0;
  float tDeltaX = hasX ? (1.0 / max(abs(delta.x), 1e-6)) : 1e9;
  float tDeltaY = hasY ? (1.0 / max(abs(delta.y), 1e-6)) : 1e9;
  float tMaxX = hasX ? ((delta.x >= 0.0 ? (fragTile.x + 1.0 - fragCell.x) : (fragCell.x - fragTile.x)) * tDeltaX) : 1e9;
  float tMaxY = hasY ? ((delta.y >= 0.0 ? (fragTile.y + 1.0 - fragCell.y) : (fragCell.y - fragTile.y)) * tDeltaY) : 1e9;
  float softSteps = max(0.35, uOccParams.w * 2.4);
  vec2 curTile = fragTile;
  float hits = 0.0;
  for (int s = 0; s < 32; s++) {
    float tHit = 0.0;
    if (tMaxX < tMaxY) {
      tHit = tMaxX;
      curTile.x += stepX;
      tMaxX += tDeltaX;
    } else {
      tHit = tMaxY;
      curTile.y += stepY;
      tMaxY += tDeltaY;
    }
    if (tHit >= 1.0) break;
    if (abs(curTile.x - lightTile.x) < 0.5 && abs(curTile.y - lightTile.y) < 0.5) break;
    if (sampleOccCell(curTile) > 0.5) {
      hits += 1.0;
      if (hits >= softSteps) break;
    }
  }
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
  float specNorm = (specExp + 8.0) / 25.132741;
  float specScale = mix(1.0, 0.28, rough) * (0.45 + 0.55 * metal + (idxVal > 250.0 ? 0.18 : 0.0)) * specNorm;
  vec3 f0 = mix(vec3(0.04), clamp(texRgb, vec3(0.0), vec3(1.0)), metal);
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
    vec4 sL = textureLod(uAtlas, vec3(clamp(vTexUv - vec2(texel.x * flipSign, 0.0), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sR = textureLod(uAtlas, vec3(clamp(vTexUv + vec2(texel.x * flipSign, 0.0), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sU = textureLod(uAtlas, vec3(clamp(vTexUv - vec2(0.0, texel.y), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sD = textureLod(uAtlas, vec3(clamp(vTexUv + vec2(0.0, texel.y), safeMin, safeMax), atlasLayer), 0.0);
    vec4 sBR = textureLod(uAtlas, vec3(clamp(vTexUv + vec2(texel.x * flipSign, texel.y), safeMin, safeMax), atlasLayer), 0.0);

    float hC = texAlpha * (0.65 + 0.35 * dot(texRgb, lumaW));
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
    float ndv = clamp(dot(sobelN, viewDir), 0.0, 1.0);
    vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
    vec3 halfKey = normalize(sobelLight + viewDir);
    float keySpecAmt = pow(max(0.0, dot(sobelN, halfKey)), specExp) * specScale * 0.42;
    float ndl = dot(sobelN, sobelLight) - sobelLight.z;
    float rimBoost = (hC - hBR) > 0.45 ? (0.07 + 0.14 * metal) : 0.0;
    reliefShade = clamp(1.0 + ndl * 0.28, 0.84, 1.18) * diffConserv + rimBoost;
    keySpecRgb = fresnel * keySpecAmt;

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
          litSpec += lc.rgb * fresnel * (lc.a * att * spec);
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

export {
  BLOOM_BLUR_FS,
  BLOOM_DOWN_FS,
  COMPOSITE_FS,
  MESH3D_FS,
  MESH3D_VS,
  POST_VS,
  QUAD3D_FS,
  QUAD3D_VS,
  SHADOW_DEPTH_FS,
  SHADOW_MESH3D_VS,
  SHADOW_QUAD3D_FS,
  SHADOW_QUAD3D_VS,
};
