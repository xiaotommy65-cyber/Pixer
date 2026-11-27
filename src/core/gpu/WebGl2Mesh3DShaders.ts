import { OVERSCAN_PAD, SHADOW_MAP_SIZE } from './GpuTypes.ts';

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
precision highp sampler2DShadow;

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
uniform sampler2DShadow uShadowMap;
uniform mat4 uLightViewProj;
uniform vec4 uEyePos;     // xyz: world eye pos, w: shadowMapEnabled
uniform vec4 uSunDirInfo; // xyz: unit sun dir, w: directional shadow strength
uniform vec4 uLightPosZ[6];
uniform float uPaletteRows;
uniform int uLightCount;
uniform vec4 uLightPosRad[24];
uniform vec4 uLightColInt[24];
uniform vec4 uOccWorld; // x: originWorldX, y: originWorldY, z: tileSizeWorld, w: occSoftness
uniform vec4 uOccDims;  // x: cols, y: rows, z: occStrength, w: opaquePass (1=cutout, 0=blend)

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragEmissive;

float getLightZ3D(int idx) {
  vec4 v = uLightPosZ[idx >> 2];
  int rem = idx & 3;
  if (rem == 0) return v.x;
  if (rem == 1) return v.y;
  if (rem == 2) return v.z;
  return v.w;
}

float sampleDirectionalShadow3D(vec3 worldPos, vec3 n3d) {
  float shadowOn = uEyePos.w;
  float strength = clamp(uSunDirInfo.w, 0.0, 0.95);
  if (shadowOn <= 0.5 || strength <= 0.005) return 1.0;
  vec4 lClip = uLightViewProj * vec4(worldPos + n3d * 1.4, 1.0);
  vec3 ndc = lClip.xyz / max(abs(lClip.w), 1e-5);
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float refDepth = ndc.z * 0.5 + 0.5 - 0.0018;
  if (uv.x <= 0.004 || uv.x >= 0.996 || uv.y <= 0.004 || uv.y >= 0.996 || refDepth <= 0.0 || refDepth >= 1.0) {
    return 1.0;
  }
  float texel = 1.0 / ${SHADOW_MAP_SIZE}.0;
  float vis = 0.0;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 sUv = clamp(uv + vec2(float(ox), float(oy)) * texel, vec2(0.0), vec2(1.0));
      vis += texture(uShadowMap, vec3(sUv, refDepth));
    }
  }
  return mix(1.0 - strength, 1.0, vis * (1.0 / 9.0));
}

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
  float softSteps = max(0.35, uOccWorld.w * 2.4);
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

  float normLen2 = dot(vNormal, vNormal);
  vec3 n3d = normLen2 < 1e-6 ? vec3(0.0, 0.0, 1.0) : vNormal * inversesqrt(max(normLen2, 1e-6));
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

    vec3 sunDir = normalize(uSunDirInfo.xyz);
    float sunShadow = sampleDirectionalShadow3D(vWorldPos, n3d);
    float hemi = mix(0.70, 1.12, dot(n3d, sunDir) * 0.5 + 0.5) * sunShadow;
    vec3 baseCol = vTint.rgb * max(0.2, shadeMult) * hemi * (1.0 + cellTint + grain) * mortarMask * aoBottom + vec3(topRim);

    int wCnt = min(24, max(0, uLightCount));
    vec3 litDiff = vec3(0.0);
    for (int li = 0; li < 24; li++) {
      if (li >= wCnt) break;
      vec4 lp = uLightPosRad[li];
      vec4 lc = uLightColInt[li];
      vec3 toL = vec3(lp.xy - vWorldPos.xy, getLightZ3D(li) - vWorldPos.z);
      float dist = length(toL);
      if (dist < lp.z) {
        float vis = sampleShadowOcclusion3D(shadowSamplePos, lp.xy);
        if (vis > 0.01) {
          float att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w)) * vis;
          float toL2 = dot(toL, toL);
          vec3 lDir = toL2 < 1e-6 ? vec3(0.0, 0.0, 1.0) : toL * inversesqrt(max(toL2, 1e-6));
          float diff = max(0.12, dot(n3d, lDir));
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
  float specNorm = (specExp + 8.0) / 25.132741;
  float specScale = mix(0.95, 0.24, rough) * (0.42 + 0.58 * metal) * specNorm;
  vec3 f0 = mix(vec3(0.04), clamp(texRgb, vec3(0.0), vec3(1.0)), metal);
  float diffConserv = mix(1.0, 0.62, metal);

  vec3 sunDir = normalize(uSunDirInfo.xyz);
  vec3 toEye = uEyePos.xyz - vWorldPos;
  float toEye2 = dot(toEye, toEye);
  vec3 viewDir = toEye2 < 1e-6 ? vec3(0.0, 0.65, 0.76) : toEye * inversesqrt(max(toEye2, 1e-6));
  float ndv = clamp(dot(n3d, viewDir), 0.0, 1.0);
  vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  float sunShadow = sampleDirectionalShadow3D(vWorldPos, n3d);
  float hemi = mix(0.74, 1.12, dot(n3d, sunDir) * 0.5 + 0.5) * sunShadow;

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
      vec3 toL = vec3(lp.xy - vWorldPos.xy, getLightZ3D(li) - vWorldPos.z);
      float dist = length(toL);
      if (dist < lp.z) {
        float vis = sampleShadowOcclusion3D(shadowSamplePos, lp.xy);
        if (vis > 0.01) {
          float att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w)) * vis;
          float toL2 = dot(toL, toL);
          vec3 lDir = toL2 < 1e-6 ? vec3(0.0, 0.0, 1.0) : toL * inversesqrt(max(toL2, 1e-6));
          float ndl = max(0.0, dot(n3d, lDir));
          float wrapDiff = isVertical ? (0.42 + 0.72 * ndl) : (0.32 + 0.85 * ndl);
          vec3 halfSum = lDir + viewDir;
          float halfSum2 = dot(halfSum, halfSum);
          vec3 hVec = halfSum2 < 1e-6 ? n3d : halfSum * inversesqrt(max(halfSum2, 1e-6));
          float spec = pow(max(0.0, dot(n3d, hVec)), specExp) * specScale * 0.78;
          litDiff += lc.rgb * (lc.a * att * wrapDiff * diffConserv);
          litSpec += lc.rgb * fresnel * (lc.a * att * spec);
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

export const SHADOW_MESH3D_VS = `#version 300 es
layout(location = 0) in vec4 aPosAo;
uniform mat4 uLightViewProj;
void main() {
  gl_Position = uLightViewProj * vec4(aPosAo.xyz, 1.0);
}`;

export const SHADOW_DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

export const SHADOW_QUAD3D_VS = `#version 300 es
layout(location = 0) in vec4 aOriginPage;
layout(location = 1) in vec4 aUAxisRough;
layout(location = 2) in vec4 aVAxisMetal;
layout(location = 3) in vec4 aUvBounds;
layout(location = 4) in vec4 aTint;
layout(location = 5) in vec4 aNormEmissive;
layout(location = 6) in vec4 aStyle;

uniform mat4 uLightViewProj;
out vec2 vTexUv;
out vec4 vMeta;

void main() {
  vec2 uvUnit[6] = vec2[6](
    vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0)
  );
  vec2 u01 = uvUnit[gl_VertexID];
  vec3 worldPos = aOriginPage.xyz + aUAxisRough.xyz * u01.x + aVAxisMetal.xyz * u01.y;
  gl_Position = uLightViewProj * vec4(worldPos, 1.0);
  vTexUv = mix(aUvBounds.xy, aUvBounds.zw, u01);
  vMeta = vec4(aStyle.x, aOriginPage.w, aTint.a, 0.0);
}`;

export const SHADOW_QUAD3D_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

in vec2 vTexUv;
in vec4 vMeta;
uniform sampler2DArray uAtlas;
uniform sampler2DArray uIndexAtlas;

void main() {
  float mode = vMeta.x;
  if (mode > 0.5 && mode < 3.5 && abs(mode - 2.0) > 0.25) discard;
  if (mode < 0.5) {
    float atlasLayer = max(0.0, floor(vMeta.y + 0.5));
    float idxVal = floor(texture(uIndexAtlas, vec3(vTexUv, atlasLayer)).r * 255.0 + 0.5);
    if (idxVal < 0.5) discard;
    if (idxVal > 15.5) {
      float a = texture(uAtlas, vec3(vTexUv, atlasLayer)).a * vMeta.z;
      if (a < 0.5) discard;
    }
  } else if (vMeta.z < 0.5) {
    discard;
  }
}`;

export const MESH3D_VS = `#version 300 es
layout(location = 0) in vec4 aPosAo;     // posX, posY, posZ, ao
layout(location = 1) in vec4 aNormPage;  // normX, normY, normZ, atlasPage
layout(location = 2) in vec4 aUvPalMode; // u, v, paletteRow, mode
layout(location = 3) in vec4 aTint;      // r, g, b, a
layout(location = 4) in vec4 aMatFlash;  // roughness, metallic, emissive, flash

uniform mat4 uViewProj;
uniform vec2 uViewSize;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vTexUv;
out vec4 vTint;
out vec4 vMatFlash;
out vec4 vMeta; // ao, atlasPage, paletteRow, mode

void main() {
  vec4 clip = uViewProj * vec4(aPosAo.xyz, 1.0);
  vec2 viewSize = max(vec2(1.0), uViewSize);
  vec2 osScale = viewSize / (viewSize + vec2(${OVERSCAN_PAD}.0 * 2.0));
  clip.x *= osScale.x;
  clip.y *= osScale.y;

  gl_Position = clip;
  vWorldPos = aPosAo.xyz;
  vNormal = aNormPage.xyz;
  vTexUv = aUvPalMode.xy;
  vTint = aTint;
  vMatFlash = aMatFlash;
  vMeta = vec4(aPosAo.w, aNormPage.w, aUvPalMode.z, aUvPalMode.w);
}`;

export const MESH3D_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2DShadow;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vTexUv;
in vec4 vTint;
in vec4 vMatFlash;
in vec4 vMeta;

uniform sampler2DArray uAtlas;
uniform sampler2DArray uIndexAtlas;
uniform sampler2D uPaletteLut;
uniform sampler2DShadow uShadowMap;
uniform mat4 uLightViewProj;
uniform vec4 uEyePos;
uniform vec4 uSunDirInfo;
uniform vec4 uLightPosZ[6];
uniform float uPaletteRows;
uniform float uOpaquePass;
uniform int uLightCount;
uniform vec4 uLightPosRad[24];
uniform vec4 uLightColInt[24];

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragEmissive;

float getLightZ3D(int idx) {
  vec4 v = uLightPosZ[idx >> 2];
  int rem = idx & 3;
  if (rem == 0) return v.x;
  if (rem == 1) return v.y;
  if (rem == 2) return v.z;
  return v.w;
}

float sampleDirectionalShadow3D(vec3 worldPos, vec3 n3d) {
  float shadowOn = uEyePos.w;
  float strength = clamp(uSunDirInfo.w, 0.0, 0.95);
  if (shadowOn <= 0.5 || strength <= 0.005) return 1.0;
  vec4 lClip = uLightViewProj * vec4(worldPos + n3d * 1.4, 1.0);
  vec3 ndc = lClip.xyz / max(abs(lClip.w), 1e-5);
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float refDepth = ndc.z * 0.5 + 0.5 - 0.0018;
  if (uv.x <= 0.004 || uv.x >= 0.996 || uv.y <= 0.004 || uv.y >= 0.996 || refDepth <= 0.0 || refDepth >= 1.0) {
    return 1.0;
  }
  float texel = 1.0 / ${SHADOW_MAP_SIZE}.0;
  float vis = 0.0;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 sUv = clamp(uv + vec2(float(ox), float(oy)) * texel, vec2(0.0), vec2(1.0));
      vis += texture(uShadowMap, vec3(sUv, refDepth));
    }
  }
  return mix(1.0 - strength, 1.0, vis * (1.0 / 9.0));
}

void main() {
  float ao = clamp(vMeta.x, 0.1, 1.2);
  float atlasLayer = max(0.0, floor(vMeta.y + 0.5));
  float paletteRow = vMeta.z;
  float mode = vMeta.w;
  bool opaquePass = uOpaquePass > 0.5;
  float flashAmt = clamp(vMatFlash.w, 0.0, 1.0);

  if (mode > 1.5) {
    vec3 col = mix(vTint.rgb, vec3(1.0), flashAmt);
    fragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), vTint.a);
    fragEmissive = vec4(col * max(0.0, vMatFlash.z), vTint.a);
    return;
  }

  vec3 texRgb = vec3(1.0);
  float texAlpha = 1.0;
  float lutEmissive = 0.0;
  if (mode < 0.5) {
    float idxVal = floor(texture(uIndexAtlas, vec3(vTexUv, atlasLayer)).r * 255.0 + 0.5);
    if (idxVal < 0.5) discard;
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
  }

  float finalAlpha = texAlpha * vTint.a;
  if (opaquePass && finalAlpha < 0.5) discard;

  float nLen2 = dot(vNormal, vNormal);
  vec3 n3d = nLen2 < 1e-6 ? vec3(0.0, 0.0, 1.0) : vNormal * inversesqrt(max(nLen2, 1e-6));
  float rough = clamp(vMatFlash.x, 0.05, 1.0);
  float metal = clamp(vMatFlash.y, 0.0, 1.0);
  float matEmissive = clamp(vMatFlash.z, 0.0, 2.0);

  float specExp = mix(48.0, 6.0, rough);
  float specNorm = (specExp + 8.0) / 25.132741;
  float specScale = mix(0.95, 0.24, rough) * (0.42 + 0.58 * metal) * specNorm;
  vec3 f0 = mix(vec3(0.04), clamp(texRgb * vTint.rgb, vec3(0.0), vec3(1.0)), metal);
  float diffConserv = mix(1.0, 0.62, metal);

  vec3 sunDir = normalize(uSunDirInfo.xyz);
  vec3 toEye = uEyePos.xyz - vWorldPos;
  float toEye2 = dot(toEye, toEye);
  vec3 viewDir = toEye2 < 1e-6 ? vec3(0.0, 0.65, 0.76) : toEye * inversesqrt(max(toEye2, 1e-6));
  float ndv = clamp(dot(n3d, viewDir), 0.0, 1.0);
  vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  float sunShadow = sampleDirectionalShadow3D(vWorldPos, n3d);
  float hemi = mix(0.68, 1.14, dot(n3d, sunDir) * 0.5 + 0.5) * sunShadow;

  vec3 litDiff = vec3(0.0);
  vec3 litSpec = vec3(0.0);
  int cnt = min(24, max(0, uLightCount));
  for (int li = 0; li < 24; li++) {
    if (li >= cnt) break;
    vec4 lp = uLightPosRad[li];
    vec4 lc = uLightColInt[li];
    vec3 toL = vec3(lp.xy - vWorldPos.xy, getLightZ3D(li) - vWorldPos.z);
    float dist = length(toL);
    if (dist < lp.z) {
      float att = pow(clamp(1.0 - dist / max(1.0, lp.z), 0.0, 1.0), max(0.2, lp.w));
      float toL2 = dot(toL, toL);
      vec3 lDir = toL2 < 1e-6 ? vec3(0.0, 0.0, 1.0) : toL * inversesqrt(max(toL2, 1e-6));
      float ndl = max(0.0, dot(n3d, lDir));
      vec3 halfSum = lDir + viewDir;
      float halfSum2 = dot(halfSum, halfSum);
      vec3 hVec = halfSum2 < 1e-6 ? n3d : halfSum * inversesqrt(max(halfSum2, 1e-6));
      float spec = pow(max(0.0, dot(n3d, hVec)), specExp) * specScale * 0.78;
      litDiff += lc.rgb * (lc.a * att * (0.28 + 0.88 * ndl) * diffConserv);
      litSpec += lc.rgb * fresnel * (lc.a * att * spec);
    }
  }

  vec3 baseLit = clamp(texRgb * vTint.rgb * (hemi * ao * diffConserv), vec3(0.0), vec3(1.2));
  vec3 shaded = clamp(baseLit * (1.0 + litDiff) + litSpec, vec3(0.0), vec3(1.48));
  vec3 finalRgb = mix(shaded, vec3(1.0), flashAmt);
  float emissiveAmt = max(lutEmissive, matEmissive) + flashAmt * 0.5;
  vec3 hdrExcess = max(finalRgb - vec3(1.0), vec3(0.0));

  fragColor = vec4(clamp(finalRgb, vec3(0.0), vec3(1.0)), finalAlpha);
  fragEmissive = vec4(finalRgb * emissiveAmt + hdrExcess, finalAlpha);
}`;
