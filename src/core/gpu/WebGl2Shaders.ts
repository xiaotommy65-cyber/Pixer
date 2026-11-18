import { GAME_H, GAME_W } from './GpuTypes.ts';

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
in vec2 vUv;
uniform vec3 uTopColor;
uniform vec3 uBottomColor;
uniform float uCozyFilter;
uniform float uTimeSec;
out vec4 fragColor;
void main() {
  float y = clamp(vUv.y, 0.0, 1.0);
  float horizonGlow = pow(y, 2.4) * 0.045 * (0.85 + 0.15 * sin(uTimeSec * 0.7 + vUv.x * 3.14159));
  vec3 col = mix(uTopColor, uBottomColor, y) + uBottomColor * horizonGlow;
  if (uCozyFilter > 0.5) {
    col *= 0.985 + 0.015 * sin(vUv.y * 180.0 * 6.28318);
  }
  fragColor = vec4(col, 1.0);
}`;

export const SPRITE_VS = `#version 300 es
layout(location = 0) in vec4 aRectPosSize;
layout(location = 1) in vec4 aUvBounds;
layout(location = 2) in vec4 aTint;
layout(location = 3) in vec4 aExtra;

out vec2 vTexUv;
out vec2 vLocalUv;
out vec4 vTint;
out float vMode;
out float vFlash;
out float vParam;
out vec4 vUvBounds;

void main() {
  vec2 quad[6] = vec2[6](
    vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5),
    vec2(-0.5, 0.5), vec2(0.5, -0.5), vec2(0.5, 0.5)
  );
  vec2 uvUnit[6] = vec2[6](
    vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0)
  );
  vec2 q = quad[gl_VertexID];
  vec2 u01 = uvUnit[gl_VertexID];
  float c = cos(aExtra.x);
  float s = sin(aExtra.x);
  vec2 scaled = q * aRectPosSize.zw;
  vec2 rotated = vec2(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);
  vec2 world = aRectPosSize.xy + rotated;

  float ndcX = (world.x / ${GAME_W}.0) * 2.0 - 1.0;
  float ndcY = 1.0 - (world.y / ${GAME_H}.0) * 2.0;

  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
  vTexUv = mix(aUvBounds.xy, aUvBounds.zw, u01);
  vLocalUv = u01;
  vTint = aTint;
  vMode = aExtra.y;
  vFlash = aExtra.z;
  vParam = aExtra.w;
  vUvBounds = aUvBounds;
}`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vTexUv;
in vec2 vLocalUv;
in vec4 vTint;
in float vMode;
in float vFlash;
in float vParam;
in vec4 vUvBounds;
uniform sampler2D uAtlas;
out vec4 fragColor;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  // Mode 5: Smooth atmospheric gradient & tilt-shift vignette
  if (vMode > 4.5) {
    float dir = vUvBounds.x;
    float pwr = max(0.35, vParam);
    float fade = 0.0;
    if (dir < 0.5) {
      fade = pow(clamp(1.0 - vLocalUv.y, 0.0, 1.0), pwr);
    } else if (dir < 1.5) {
      fade = pow(clamp(vLocalUv.y, 0.0, 1.0), pwr);
    } else {
      float d = length((vLocalUv - vec2(0.5)) * vec2(1.5, 1.9));
      fade = smoothstep(0.45, 1.25, d);
    }
    fragColor = vec4(vTint.rgb, vTint.a * fade);
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
    float sideSoft = smoothstep(0.0, 0.04, vLocalUv.x) * smoothstep(1.0, 0.96, vLocalUv.x);
    fragColor = vec4(clamp(baseCol, vec3(0.0), vec3(1.0)), vTint.a * mix(0.75, 1.0, sideSoft));
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
    vec3 solidRgb = mix(col, vec3(1.0), clamp(vFlash, 0.0, 1.0));
    fragColor = vec4(solidRgb, alpha);
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
      fragColor = vec4(vTint.rgb, vTint.a * glint);
      return;
    }
    float f = clamp(1.0 - d, 0.0, 1.0);
    float power = vParam > 0.1 ? vParam : 2.0;
    float glow = f > 0.001 ? pow(f, power) : 0.0;
    fragColor = vec4(vTint.rgb, vTint.a * glow);
    return;
  }

  vec4 sampled = texture(uAtlas, vTexUv);
  if (sampled.a < 0.05) discard;
  vec3 baseRgb = sampled.rgb * vTint.rgb;
  vec3 finalRgb = mix(baseRgb, vec3(1.0), clamp(vFlash, 0.0, 1.0));
  fragColor = vec4(finalRgb, sampled.a * vTint.a);
}`;
