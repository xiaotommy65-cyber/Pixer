import { OVERSCAN_PAD, SHADOW_MAP_SIZE } from './GpuTypes.ts';

export const WGSL_MESH3D_CODE = /* wgsl */ `
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
