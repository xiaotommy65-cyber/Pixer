import {
  FLOATS_PER_INSTANCE,
  FLOATS_PER_MESH3D_VERTEX,
  FLOATS_PER_QUAD3D,
  GAME_H,
  GAME_W,
  MAX_INSTANCES_PER_PASS,
  MAX_LINE3D_VERTICES,
  MAX_MESH3D_ALPHA_INDICES,
  MAX_MESH3D_ALPHA_VERTICES,
  MAX_MESH3D_INDICES,
  MAX_MESH3D_VERTICES,
  MAX_QUAD3D_INSTANCES,
  OVERSCAN_PAD,
} from './GpuTypes.ts';
import {
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
  SKY_FS,
  SKY_VS,
  SPRITE_FS,
  SPRITE_VS,
} from './WebGl2Shaders.ts';

export interface GlRenderTargets {
  w: number;
  h: number;
  viewW: number;
  viewH: number;
  osW: number;
  osH: number;
  bloomW: number;
  bloomH: number;
  mrtFbo: WebGLFramebuffer;
  depthRb: WebGLRenderbuffer;
  sceneTex: WebGLTexture;
  emissiveTex: WebGLTexture;
  bloomFboA: WebGLFramebuffer;
  bloomFboB: WebGLFramebuffer;
  bloomTexA: WebGLTexture;
  bloomTexB: WebGLTexture;
}

export interface WebGl2ProgramBundle {
  skyProg: WebGLProgram;
  spriteProg: WebGLProgram;
  quad3dProg: WebGLProgram;
  shadowMeshProg: WebGLProgram;
  shadowQuadProg: WebGLProgram;
  mesh3dProg: WebGLProgram;
  bloomDownProg: WebGLProgram;
  bloomBlurProg: WebGLProgram;
  compositeProg: WebGLProgram;
  uTopLoc: WebGLUniformLocation | null;
  uMidLoc: WebGLUniformLocation | null;
  uBottomLoc: WebGLUniformLocation | null;
  uCozyLoc: WebGLUniformLocation | null;
  uTimeLoc: WebGLUniformLocation | null;
  uSkyViewSizeLoc: WebGLUniformLocation | null;
  uSpriteViewSizeLoc: WebGLUniformLocation | null;
  uPaletteRowsLoc: WebGLUniformLocation | null;
  uLightCountLoc: WebGLUniformLocation | null;
  uLightPosRadLoc: WebGLUniformLocation | null;
  uLightColIntLoc: WebGLUniformLocation | null;
  uOccParamsLoc: WebGLUniformLocation | null;
  uOccDimsLoc: WebGLUniformLocation | null;
  u3dViewProjLoc: WebGLUniformLocation | null;
  u3dViewSizeLoc: WebGLUniformLocation | null;
  u3dPaletteRowsLoc: WebGLUniformLocation | null;
  u3dLightCountLoc: WebGLUniformLocation | null;
  u3dLightPosRadLoc: WebGLUniformLocation | null;
  u3dLightColIntLoc: WebGLUniformLocation | null;
  u3dOccWorldLoc: WebGLUniformLocation | null;
  u3dOccDimsLoc: WebGLUniformLocation | null;
  u3dLightViewProjLoc: WebGLUniformLocation | null;
  u3dEyePosLoc: WebGLUniformLocation | null;
  u3dSunDirInfoLoc: WebGLUniformLocation | null;
  u3dLightPosZLoc: WebGLUniformLocation | null;
  uShadowMeshLvpLoc: WebGLUniformLocation | null;
  uShadowQuadLvpLoc: WebGLUniformLocation | null;
  uMeshViewProjLoc: WebGLUniformLocation | null;
  uMeshViewSizeLoc: WebGLUniformLocation | null;
  uMeshLightViewProjLoc: WebGLUniformLocation | null;
  uMeshEyePosLoc: WebGLUniformLocation | null;
  uMeshSunDirInfoLoc: WebGLUniformLocation | null;
  uMeshLightPosZLoc: WebGLUniformLocation | null;
  uMeshPaletteRowsLoc: WebGLUniformLocation | null;
  uMeshOpaquePassLoc: WebGLUniformLocation | null;
  uMeshLightCountLoc: WebGLUniformLocation | null;
  uMeshLightPosRadLoc: WebGLUniformLocation | null;
  uMeshLightColIntLoc: WebGLUniformLocation | null;
  uDownOffsetLoc: WebGLUniformLocation | null;
  uBlurStepLoc: WebGLUniformLocation | null;
  uCompGlowLoc: WebGLUniformLocation | null;
  uCompFilterLoc: WebGLUniformLocation | null;
  uCompCozyLoc: WebGLUniformLocation | null;
  uCompCamFracLoc: WebGLUniformLocation | null;
  uCompViewSizeLoc: WebGLUniformLocation | null;
  uCompWaterLevelLoc: WebGLUniformLocation | null;
  uCompWaterTintLoc: WebGLUniformLocation | null;
  uCompTimeLoc: WebGLUniformLocation | null;
  uCompTiltShiftLoc: WebGLUniformLocation | null;
  uCompOutputSizeLoc: WebGLUniformLocation | null;
}

export interface WebGl2VaoBundle {
  skyVao: WebGLVertexArrayObject;
  alphaVao: WebGLVertexArrayObject;
  addVao: WebGLVertexArrayObject;
  quad3dOpaqueVao: WebGLVertexArrayObject;
  quad3dAlphaVao: WebGLVertexArrayObject;
  quad3dAddVao: WebGLVertexArrayObject;
  meshOpaqueVao: WebGLVertexArrayObject;
  meshAlphaVao: WebGLVertexArrayObject;
  line3dVao: WebGLVertexArrayObject;
  alphaBuffer: WebGLBuffer;
  addBuffer: WebGLBuffer;
  quad3dOpaqueBuffer: WebGLBuffer;
  quad3dAlphaBuffer: WebGLBuffer;
  quad3dAddBuffer: WebGLBuffer;
  meshOpaqueVbo: WebGLBuffer;
  meshOpaqueIbo: WebGLBuffer;
  meshAlphaVbo: WebGLBuffer;
  meshAlphaIbo: WebGLBuffer;
  line3dVbo: WebGLBuffer;
}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Unable to create WebGL shader');
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'Shader compile error';
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

export function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error('Unable to create WebGL program');
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'Program link error';
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

export function createRenderTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  filter: number,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return tex;
}

export function destroyGlRenderTargets(gl: WebGL2RenderingContext, targets: GlRenderTargets | null): null {
  if (!targets) return null;
  gl.deleteFramebuffer(targets.mrtFbo);
  gl.deleteRenderbuffer(targets.depthRb);
  gl.deleteFramebuffer(targets.bloomFboA);
  gl.deleteFramebuffer(targets.bloomFboB);
  gl.deleteTexture(targets.sceneTex);
  gl.deleteTexture(targets.emissiveTex);
  gl.deleteTexture(targets.bloomTexA);
  gl.deleteTexture(targets.bloomTexB);
  return null;
}

export function createGlRenderTargets(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  viewW = GAME_W,
  viewH = GAME_H,
): GlRenderTargets {
  const osViewW = viewW + OVERSCAN_PAD * 2;
  const osViewH = viewH + OVERSCAN_PAD * 2;
  const osW = Math.max(1, Math.round((w * osViewW) / viewW));
  const osH = Math.max(1, Math.round((h * osViewH) / viewH));
  const bloomW = Math.max(1, Math.floor(osW / 4));
  const bloomH = Math.max(1, Math.floor(osH / 4));

  const sceneTex = createRenderTexture(gl, osW, osH, gl.LINEAR);
  const emissiveTex = createRenderTexture(gl, osW, osH, gl.LINEAR);
  const depthRb = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, osW, osH);
  const mrtFbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, mrtFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emissiveTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('WebGL2 MRT framebuffer incomplete');
  }

  const bloomTexA = createRenderTexture(gl, bloomW, bloomH, gl.LINEAR);
  const bloomFboA = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFboA);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTexA, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  const bloomTexB = createRenderTexture(gl, bloomW, bloomH, gl.LINEAR);
  const bloomFboB = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFboB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTexB, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    w,
    h,
    viewW,
    viewH,
    osW,
    osH,
    bloomW,
    bloomH,
    mrtFbo,
    depthRb,
    sceneTex,
    emissiveTex,
    bloomFboA,
    bloomFboB,
    bloomTexA,
    bloomTexB,
  };
}

function bindSamplers(gl: WebGL2RenderingContext, prog: WebGLProgram, bindings: readonly [string, number][]): void {
  for (const [name, unit] of bindings) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc) gl.uniform1i(loc, unit);
  }
}

export function createWebGl2Programs(gl: WebGL2RenderingContext): WebGl2ProgramBundle {
  const skyProg = linkProgram(gl, SKY_VS, SKY_FS);
  const spriteProg = linkProgram(gl, SPRITE_VS, SPRITE_FS);
  const quad3dProg = linkProgram(gl, QUAD3D_VS, QUAD3D_FS);
  const shadowMeshProg = linkProgram(gl, SHADOW_MESH3D_VS, SHADOW_DEPTH_FS);
  const shadowQuadProg = linkProgram(gl, SHADOW_QUAD3D_VS, SHADOW_QUAD3D_FS);
  const mesh3dProg = linkProgram(gl, MESH3D_VS, MESH3D_FS);
  const bloomDownProg = linkProgram(gl, POST_VS, BLOOM_DOWN_FS);
  const bloomBlurProg = linkProgram(gl, POST_VS, BLOOM_BLUR_FS);
  const compositeProg = linkProgram(gl, POST_VS, COMPOSITE_FS);

  gl.useProgram(spriteProg);
  bindSamplers(gl, spriteProg, [
    ['uAtlas', 0],
    ['uIndexAtlas', 1],
    ['uPaletteLut', 2],
    ['uOcclusionTex', 3],
  ]);

  gl.useProgram(quad3dProg);
  bindSamplers(gl, quad3dProg, [
    ['uAtlas', 0],
    ['uIndexAtlas', 1],
    ['uPaletteLut', 2],
    ['uOcclusionTex', 3],
    ['uShadowMap', 4],
  ]);

  gl.useProgram(shadowQuadProg);
  bindSamplers(gl, shadowQuadProg, [
    ['uAtlas', 0],
    ['uIndexAtlas', 1],
  ]);

  gl.useProgram(mesh3dProg);
  bindSamplers(gl, mesh3dProg, [
    ['uAtlas', 0],
    ['uIndexAtlas', 1],
    ['uPaletteLut', 2],
    ['uShadowMap', 4],
  ]);

  gl.useProgram(bloomDownProg);
  bindSamplers(gl, bloomDownProg, [['uTexA', 0]]);

  gl.useProgram(bloomBlurProg);
  bindSamplers(gl, bloomBlurProg, [['uTexA', 0]]);

  gl.useProgram(compositeProg);
  bindSamplers(gl, compositeProg, [
    ['uSceneTex', 0],
    ['uBloomTex', 1],
    ['uSceneLinearTex', 2],
  ]);

  return {
    skyProg,
    spriteProg,
    quad3dProg,
    shadowMeshProg,
    shadowQuadProg,
    mesh3dProg,
    bloomDownProg,
    bloomBlurProg,
    compositeProg,
    uTopLoc: gl.getUniformLocation(skyProg, 'uTopColor'),
    uMidLoc: gl.getUniformLocation(skyProg, 'uMidColor'),
    uBottomLoc: gl.getUniformLocation(skyProg, 'uBottomColor'),
    uCozyLoc: gl.getUniformLocation(skyProg, 'uCozyFilter'),
    uTimeLoc: gl.getUniformLocation(skyProg, 'uTimeSec'),
    uSkyViewSizeLoc: gl.getUniformLocation(skyProg, 'uViewSize'),
    uSpriteViewSizeLoc: gl.getUniformLocation(spriteProg, 'uViewSize'),
    uPaletteRowsLoc: gl.getUniformLocation(spriteProg, 'uPaletteRows'),
    uLightCountLoc: gl.getUniformLocation(spriteProg, 'uLightCount'),
    uLightPosRadLoc: gl.getUniformLocation(spriteProg, 'uLightPosRad'),
    uLightColIntLoc: gl.getUniformLocation(spriteProg, 'uLightColInt'),
    uOccParamsLoc: gl.getUniformLocation(spriteProg, 'uOccParams'),
    uOccDimsLoc: gl.getUniformLocation(spriteProg, 'uOccDims'),
    u3dViewProjLoc: gl.getUniformLocation(quad3dProg, 'uViewProj'),
    u3dViewSizeLoc: gl.getUniformLocation(quad3dProg, 'uViewSize'),
    u3dPaletteRowsLoc: gl.getUniformLocation(quad3dProg, 'uPaletteRows'),
    u3dLightCountLoc: gl.getUniformLocation(quad3dProg, 'uLightCount'),
    u3dLightPosRadLoc: gl.getUniformLocation(quad3dProg, 'uLightPosRad'),
    u3dLightColIntLoc: gl.getUniformLocation(quad3dProg, 'uLightColInt'),
    u3dOccWorldLoc: gl.getUniformLocation(quad3dProg, 'uOccWorld'),
    u3dOccDimsLoc: gl.getUniformLocation(quad3dProg, 'uOccDims'),
    u3dLightViewProjLoc: gl.getUniformLocation(quad3dProg, 'uLightViewProj'),
    u3dEyePosLoc: gl.getUniformLocation(quad3dProg, 'uEyePos'),
    u3dSunDirInfoLoc: gl.getUniformLocation(quad3dProg, 'uSunDirInfo'),
    u3dLightPosZLoc: gl.getUniformLocation(quad3dProg, 'uLightPosZ'),
    uShadowMeshLvpLoc: gl.getUniformLocation(shadowMeshProg, 'uLightViewProj'),
    uShadowQuadLvpLoc: gl.getUniformLocation(shadowQuadProg, 'uLightViewProj'),
    uMeshViewProjLoc: gl.getUniformLocation(mesh3dProg, 'uViewProj'),
    uMeshViewSizeLoc: gl.getUniformLocation(mesh3dProg, 'uViewSize'),
    uMeshLightViewProjLoc: gl.getUniformLocation(mesh3dProg, 'uLightViewProj'),
    uMeshEyePosLoc: gl.getUniformLocation(mesh3dProg, 'uEyePos'),
    uMeshSunDirInfoLoc: gl.getUniformLocation(mesh3dProg, 'uSunDirInfo'),
    uMeshLightPosZLoc: gl.getUniformLocation(mesh3dProg, 'uLightPosZ'),
    uMeshPaletteRowsLoc: gl.getUniformLocation(mesh3dProg, 'uPaletteRows'),
    uMeshOpaquePassLoc: gl.getUniformLocation(mesh3dProg, 'uOpaquePass'),
    uMeshLightCountLoc: gl.getUniformLocation(mesh3dProg, 'uLightCount'),
    uMeshLightPosRadLoc: gl.getUniformLocation(mesh3dProg, 'uLightPosRad'),
    uMeshLightColIntLoc: gl.getUniformLocation(mesh3dProg, 'uLightColInt'),
    uDownOffsetLoc: gl.getUniformLocation(bloomDownProg, 'uTexelOffset'),
    uBlurStepLoc: gl.getUniformLocation(bloomBlurProg, 'uBlurStep'),
    uCompGlowLoc: gl.getUniformLocation(compositeProg, 'uGlowIntensity'),
    uCompFilterLoc: gl.getUniformLocation(compositeProg, 'uFilterMode'),
    uCompCozyLoc: gl.getUniformLocation(compositeProg, 'uCozyFilter'),
    uCompCamFracLoc: gl.getUniformLocation(compositeProg, 'uCamFrac'),
    uCompViewSizeLoc: gl.getUniformLocation(compositeProg, 'uViewSize'),
    uCompWaterLevelLoc: gl.getUniformLocation(compositeProg, 'uWaterLevel'),
    uCompWaterTintLoc: gl.getUniformLocation(compositeProg, 'uWaterTint'),
    uCompTimeLoc: gl.getUniformLocation(compositeProg, 'uTimeSec'),
    uCompTiltShiftLoc: gl.getUniformLocation(compositeProg, 'uTiltShift'),
    uCompOutputSizeLoc: gl.getUniformLocation(compositeProg, 'uOutputSize'),
  };
}

export function createWebGl2Vaos(gl: WebGL2RenderingContext, maxQuad3dBlendInstances: number): WebGl2VaoBundle {
  const skyVao = gl.createVertexArray()!;
  const alphaVao = gl.createVertexArray()!;
  const addVao = gl.createVertexArray()!;
  const quad3dOpaqueVao = gl.createVertexArray()!;
  const quad3dAlphaVao = gl.createVertexArray()!;
  const quad3dAddVao = gl.createVertexArray()!;
  const meshOpaqueVao = gl.createVertexArray()!;
  const meshAlphaVao = gl.createVertexArray()!;
  const line3dVao = gl.createVertexArray()!;
  const alphaBuffer = gl.createBuffer()!;
  const addBuffer = gl.createBuffer()!;
  const quad3dOpaqueBuffer = gl.createBuffer()!;
  const quad3dAlphaBuffer = gl.createBuffer()!;
  const quad3dAddBuffer = gl.createBuffer()!;
  const meshOpaqueVbo = gl.createBuffer()!;
  const meshOpaqueIbo = gl.createBuffer()!;
  const meshAlphaVbo = gl.createBuffer()!;
  const meshAlphaIbo = gl.createBuffer()!;
  const line3dVbo = gl.createBuffer()!;

  const stride = FLOATS_PER_INSTANCE * 4;
  const setupInstanceVao = (vao: WebGLVertexArrayObject, buf: WebGLBuffer) => {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES_PER_PASS * stride, gl.DYNAMIC_DRAW);
    for (let loc = 0; loc < 6; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, loc * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
  };
  setupInstanceVao(alphaVao, alphaBuffer);
  setupInstanceVao(addVao, addBuffer);

  const stride3d = FLOATS_PER_QUAD3D * 4;
  const setupQuad3dVao = (vao: WebGLVertexArrayObject, buf: WebGLBuffer, maxInstances: number) => {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, maxInstances * stride3d, gl.DYNAMIC_DRAW);
    for (let loc = 0; loc < 7; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride3d, loc * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
  };
  setupQuad3dVao(quad3dOpaqueVao, quad3dOpaqueBuffer, MAX_QUAD3D_INSTANCES);
  setupQuad3dVao(quad3dAlphaVao, quad3dAlphaBuffer, maxQuad3dBlendInstances);
  setupQuad3dVao(quad3dAddVao, quad3dAddBuffer, maxQuad3dBlendInstances);

  const meshStride = FLOATS_PER_MESH3D_VERTEX * 4;
  const setupMeshVao = (
    vao: WebGLVertexArrayObject,
    vbo: WebGLBuffer,
    maxVerts: number,
    ibo: WebGLBuffer | null,
    maxIdx: number,
  ) => {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, maxVerts * meshStride, gl.DYNAMIC_DRAW);
    for (let loc = 0; loc < 5; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, meshStride, loc * 16);
    }
    if (ibo) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, maxIdx * 4, gl.DYNAMIC_DRAW);
    }
  };
  setupMeshVao(meshOpaqueVao, meshOpaqueVbo, MAX_MESH3D_VERTICES, meshOpaqueIbo, MAX_MESH3D_INDICES);
  setupMeshVao(meshAlphaVao, meshAlphaVbo, MAX_MESH3D_ALPHA_VERTICES, meshAlphaIbo, MAX_MESH3D_ALPHA_INDICES);
  setupMeshVao(line3dVao, line3dVbo, MAX_LINE3D_VERTICES, null, 0);
  gl.bindVertexArray(null);

  return {
    skyVao,
    alphaVao,
    addVao,
    quad3dOpaqueVao,
    quad3dAlphaVao,
    quad3dAddVao,
    meshOpaqueVao,
    meshAlphaVao,
    line3dVao,
    alphaBuffer,
    addBuffer,
    quad3dOpaqueBuffer,
    quad3dAlphaBuffer,
    quad3dAddBuffer,
    meshOpaqueVbo,
    meshOpaqueIbo,
    meshAlphaVbo,
    meshAlphaIbo,
    line3dVbo,
  };
}

export function disposeWebGl2Programs(gl: WebGL2RenderingContext, p: WebGl2ProgramBundle): void {
  gl.deleteProgram(p.skyProg);
  gl.deleteProgram(p.spriteProg);
  gl.deleteProgram(p.quad3dProg);
  gl.deleteProgram(p.shadowMeshProg);
  gl.deleteProgram(p.shadowQuadProg);
  gl.deleteProgram(p.mesh3dProg);
  gl.deleteProgram(p.bloomDownProg);
  gl.deleteProgram(p.bloomBlurProg);
  gl.deleteProgram(p.compositeProg);
}

export function disposeWebGl2Vaos(gl: WebGL2RenderingContext, v: WebGl2VaoBundle): void {
  gl.deleteBuffer(v.alphaBuffer);
  gl.deleteBuffer(v.addBuffer);
  gl.deleteBuffer(v.quad3dOpaqueBuffer);
  gl.deleteBuffer(v.quad3dAlphaBuffer);
  gl.deleteBuffer(v.quad3dAddBuffer);
  gl.deleteBuffer(v.meshOpaqueVbo);
  gl.deleteBuffer(v.meshOpaqueIbo);
  gl.deleteBuffer(v.meshAlphaVbo);
  gl.deleteBuffer(v.meshAlphaIbo);
  gl.deleteBuffer(v.line3dVbo);
  gl.deleteVertexArray(v.skyVao);
  gl.deleteVertexArray(v.alphaVao);
  gl.deleteVertexArray(v.addVao);
  gl.deleteVertexArray(v.quad3dOpaqueVao);
  gl.deleteVertexArray(v.quad3dAlphaVao);
  gl.deleteVertexArray(v.quad3dAddVao);
  gl.deleteVertexArray(v.meshOpaqueVao);
  gl.deleteVertexArray(v.meshAlphaVao);
  gl.deleteVertexArray(v.line3dVao);
}
