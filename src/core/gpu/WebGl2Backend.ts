import {
  buildCamera3DViewProjMatrix,
  buildDirectionalLightViewProjMatrix,
  computeCamera3D,
  createComputedCamera3D,
} from '../math/Perspective3DMath.ts';
import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  FLOATS_PER_MESH3D_VERTEX,
  FLOATS_PER_QUAD3D,
  GAME_H,
  GAME_W,
  MAX_ATLAS_PAGES,
  MAX_DYNAMIC_LIGHTS,
  MAX_INSTANCES_PER_PASS,
  MAX_LINE3D_VERTICES,
  MAX_MESH3D_ALPHA_INDICES,
  MAX_MESH3D_ALPHA_VERTICES,
  MAX_MESH3D_INDICES,
  MAX_MESH3D_VERTICES,
  MAX_QUAD3D_INSTANCES,
  OCCLUSION_GRID_MAX,
  OVERSCAN_PAD,
  SHADOW_MAP_SIZE,
  type AtlasPageData,
  type GpuOcclusionState,
  type IGpuBackend,
  type Mesh3DPassData,
  type Quad3DPassData,
  type SkyGradient,
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

const DEFAULT_PALETTE_ROWS = 8;
const MAX_QUAD3D_BLEND_INSTANCES = 4096;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
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

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
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

function createRenderTexture(
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

interface GlRenderTargets {
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

export class WebGl2Backend implements IGpuBackend {
  public readonly kind = 'webgl2' as const;

  private gl: WebGL2RenderingContext;
  private skyProg: WebGLProgram;
  private spriteProg: WebGLProgram;
  private quad3dProg: WebGLProgram;
  private shadowMeshProg: WebGLProgram;
  private shadowQuadProg: WebGLProgram;
  private mesh3dProg: WebGLProgram;
  private bloomDownProg: WebGLProgram;
  private bloomBlurProg: WebGLProgram;
  private compositeProg: WebGLProgram;
  private skyVao: WebGLVertexArrayObject;
  private alphaVao: WebGLVertexArrayObject;
  private addVao: WebGLVertexArrayObject;
  private quad3dOpaqueVao: WebGLVertexArrayObject;
  private quad3dAlphaVao: WebGLVertexArrayObject;
  private quad3dAddVao: WebGLVertexArrayObject;
  private meshOpaqueVao: WebGLVertexArrayObject;
  private meshAlphaVao: WebGLVertexArrayObject;
  private line3dVao: WebGLVertexArrayObject;
  private alphaBuffer: WebGLBuffer;
  private addBuffer: WebGLBuffer;
  private quad3dOpaqueBuffer: WebGLBuffer;
  private quad3dAlphaBuffer: WebGLBuffer;
  private quad3dAddBuffer: WebGLBuffer;
  private meshOpaqueVbo: WebGLBuffer;
  private meshOpaqueIbo: WebGLBuffer;
  private meshAlphaVbo: WebGLBuffer;
  private meshAlphaIbo: WebGLBuffer;
  private line3dVbo: WebGLBuffer;
  private shadowFbo: WebGLFramebuffer;
  private shadowDepthTex: WebGLTexture;
  private atlasTexture: WebGLTexture;
  private indexAtlasTexture: WebGLTexture;
  private paletteLutTexture: WebGLTexture;
  private occlusionTexture: WebGLTexture;
  private nearestSampler: WebGLSampler;
  private linearSampler: WebGLSampler;
  private atlasAllocW = 0;
  private atlasAllocH = 0;
  private atlasAllocLayers = 0;
  private paletteLutAllocated = false;
  private paletteRows = DEFAULT_PALETTE_ROWS;
  private targets: GlRenderTargets | null = null;
  private lastOcclusionVersion = -1;
  private readonly occUploadBuf = new Uint8Array(OCCLUSION_GRID_MAX * OCCLUSION_GRID_MAX);

  private uTopLoc: WebGLUniformLocation | null;
  private uMidLoc: WebGLUniformLocation | null;
  private uBottomLoc: WebGLUniformLocation | null;
  private uCozyLoc: WebGLUniformLocation | null;
  private uTimeLoc: WebGLUniformLocation | null;
  private uSkyViewSizeLoc: WebGLUniformLocation | null;
  private uSpriteViewSizeLoc: WebGLUniformLocation | null;
  private uPaletteRowsLoc: WebGLUniformLocation | null;
  private uLightCountLoc: WebGLUniformLocation | null;
  private uLightPosRadLoc: WebGLUniformLocation | null;
  private uLightColIntLoc: WebGLUniformLocation | null;
  private uOccParamsLoc: WebGLUniformLocation | null;
  private uOccDimsLoc: WebGLUniformLocation | null;
  private u3dViewProjLoc: WebGLUniformLocation | null;
  private u3dViewSizeLoc: WebGLUniformLocation | null;
  private u3dPaletteRowsLoc: WebGLUniformLocation | null;
  private u3dLightCountLoc: WebGLUniformLocation | null;
  private u3dLightPosRadLoc: WebGLUniformLocation | null;
  private u3dLightColIntLoc: WebGLUniformLocation | null;
  private u3dOccWorldLoc: WebGLUniformLocation | null;
  private u3dOccDimsLoc: WebGLUniformLocation | null;
  private u3dLightViewProjLoc: WebGLUniformLocation | null;
  private u3dEyePosLoc: WebGLUniformLocation | null;
  private u3dSunDirInfoLoc: WebGLUniformLocation | null;
  private u3dLightPosZLoc: WebGLUniformLocation | null;
  private uShadowMeshLvpLoc: WebGLUniformLocation | null;
  private uShadowQuadLvpLoc: WebGLUniformLocation | null;
  private uMeshViewProjLoc: WebGLUniformLocation | null;
  private uMeshViewSizeLoc: WebGLUniformLocation | null;
  private uMeshLightViewProjLoc: WebGLUniformLocation | null;
  private uMeshEyePosLoc: WebGLUniformLocation | null;
  private uMeshSunDirInfoLoc: WebGLUniformLocation | null;
  private uMeshLightPosZLoc: WebGLUniformLocation | null;
  private uMeshPaletteRowsLoc: WebGLUniformLocation | null;
  private uMeshOpaquePassLoc: WebGLUniformLocation | null;
  private uMeshLightCountLoc: WebGLUniformLocation | null;
  private uMeshLightPosRadLoc: WebGLUniformLocation | null;
  private uMeshLightColIntLoc: WebGLUniformLocation | null;
  private uDownOffsetLoc: WebGLUniformLocation | null;
  private uBlurStepLoc: WebGLUniformLocation | null;
  private uCompGlowLoc: WebGLUniformLocation | null;
  private uCompFilterLoc: WebGLUniformLocation | null;
  private uCompCozyLoc: WebGLUniformLocation | null;
  private uCompCamFracLoc: WebGLUniformLocation | null;
  private uCompViewSizeLoc: WebGLUniformLocation | null;
  private uCompWaterLevelLoc: WebGLUniformLocation | null;
  private uCompWaterTintLoc: WebGLUniformLocation | null;
  private uCompTimeLoc: WebGLUniformLocation | null;
  private uCompTiltShiftLoc: WebGLUniformLocation | null;
  private uCompOutputSizeLoc: WebGLUniformLocation | null;
  private readonly lightPosRadData = new Float32Array(MAX_DYNAMIC_LIGHTS * 4);
  private readonly lightColIntData = new Float32Array(MAX_DYNAMIC_LIGHTS * 4);
  private readonly lightPosZData = new Float32Array(MAX_DYNAMIC_LIGHTS);
  private readonly cam3dScratch = createComputedCamera3D();
  private readonly viewProj3d = new Float32Array(16);
  private readonly lightViewProj3d = new Float32Array(16);

  private onLostListener?: (e: Event) => void;
  private canvasEl: HTMLCanvasElement;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    atlasWidth: number,
    atlasHeight: number,
    initialPixels: Uint8Array,
    onLost?: () => void,
    initialIndexPixels?: Uint8Array,
    initialPaletteLut?: Uint8Array,
    initialPaletteRows = DEFAULT_PALETTE_ROWS,
    initialExtraPages?: readonly AtlasPageData[],
  ) {
    this.canvasEl = canvas;
    this.gl = gl;
    this.paletteRows = Math.max(1, initialPaletteRows);
    this.skyProg = linkProgram(gl, SKY_VS, SKY_FS);
    this.spriteProg = linkProgram(gl, SPRITE_VS, SPRITE_FS);
    this.quad3dProg = linkProgram(gl, QUAD3D_VS, QUAD3D_FS);
    this.shadowMeshProg = linkProgram(gl, SHADOW_MESH3D_VS, SHADOW_DEPTH_FS);
    this.shadowQuadProg = linkProgram(gl, SHADOW_QUAD3D_VS, SHADOW_QUAD3D_FS);
    this.mesh3dProg = linkProgram(gl, MESH3D_VS, MESH3D_FS);
    this.bloomDownProg = linkProgram(gl, POST_VS, BLOOM_DOWN_FS);
    this.bloomBlurProg = linkProgram(gl, POST_VS, BLOOM_BLUR_FS);
    this.compositeProg = linkProgram(gl, POST_VS, COMPOSITE_FS);

    this.uTopLoc = gl.getUniformLocation(this.skyProg, 'uTopColor');
    this.uMidLoc = gl.getUniformLocation(this.skyProg, 'uMidColor');
    this.uBottomLoc = gl.getUniformLocation(this.skyProg, 'uBottomColor');
    this.uCozyLoc = gl.getUniformLocation(this.skyProg, 'uCozyFilter');
    this.uTimeLoc = gl.getUniformLocation(this.skyProg, 'uTimeSec');
    this.uSkyViewSizeLoc = gl.getUniformLocation(this.skyProg, 'uViewSize');

    gl.useProgram(this.spriteProg);
    const uAtlasLoc = gl.getUniformLocation(this.spriteProg, 'uAtlas');
    const uIdxLoc = gl.getUniformLocation(this.spriteProg, 'uIndexAtlas');
    const uLutLoc = gl.getUniformLocation(this.spriteProg, 'uPaletteLut');
    const uOccTexLoc = gl.getUniformLocation(this.spriteProg, 'uOcclusionTex');
    this.uSpriteViewSizeLoc = gl.getUniformLocation(this.spriteProg, 'uViewSize');
    this.uPaletteRowsLoc = gl.getUniformLocation(this.spriteProg, 'uPaletteRows');
    this.uLightCountLoc = gl.getUniformLocation(this.spriteProg, 'uLightCount');
    this.uLightPosRadLoc = gl.getUniformLocation(this.spriteProg, 'uLightPosRad');
    this.uLightColIntLoc = gl.getUniformLocation(this.spriteProg, 'uLightColInt');
    this.uOccParamsLoc = gl.getUniformLocation(this.spriteProg, 'uOccParams');
    this.uOccDimsLoc = gl.getUniformLocation(this.spriteProg, 'uOccDims');
    if (uAtlasLoc) gl.uniform1i(uAtlasLoc, 0);
    if (uIdxLoc) gl.uniform1i(uIdxLoc, 1);
    if (uLutLoc) gl.uniform1i(uLutLoc, 2);
    if (uOccTexLoc) gl.uniform1i(uOccTexLoc, 3);

    gl.useProgram(this.quad3dProg);
    const u3dAtlasLoc = gl.getUniformLocation(this.quad3dProg, 'uAtlas');
    const u3dIdxLoc = gl.getUniformLocation(this.quad3dProg, 'uIndexAtlas');
    const u3dLutLoc = gl.getUniformLocation(this.quad3dProg, 'uPaletteLut');
    const u3dOccTexLoc = gl.getUniformLocation(this.quad3dProg, 'uOcclusionTex');
    const u3dShadowMapLoc = gl.getUniformLocation(this.quad3dProg, 'uShadowMap');
    this.u3dViewProjLoc = gl.getUniformLocation(this.quad3dProg, 'uViewProj');
    this.u3dViewSizeLoc = gl.getUniformLocation(this.quad3dProg, 'uViewSize');
    this.u3dPaletteRowsLoc = gl.getUniformLocation(this.quad3dProg, 'uPaletteRows');
    this.u3dLightCountLoc = gl.getUniformLocation(this.quad3dProg, 'uLightCount');
    this.u3dLightPosRadLoc = gl.getUniformLocation(this.quad3dProg, 'uLightPosRad');
    this.u3dLightColIntLoc = gl.getUniformLocation(this.quad3dProg, 'uLightColInt');
    this.u3dOccWorldLoc = gl.getUniformLocation(this.quad3dProg, 'uOccWorld');
    this.u3dOccDimsLoc = gl.getUniformLocation(this.quad3dProg, 'uOccDims');
    this.u3dLightViewProjLoc = gl.getUniformLocation(this.quad3dProg, 'uLightViewProj');
    this.u3dEyePosLoc = gl.getUniformLocation(this.quad3dProg, 'uEyePos');
    this.u3dSunDirInfoLoc = gl.getUniformLocation(this.quad3dProg, 'uSunDirInfo');
    this.u3dLightPosZLoc = gl.getUniformLocation(this.quad3dProg, 'uLightPosZ');
    if (u3dAtlasLoc) gl.uniform1i(u3dAtlasLoc, 0);
    if (u3dIdxLoc) gl.uniform1i(u3dIdxLoc, 1);
    if (u3dLutLoc) gl.uniform1i(u3dLutLoc, 2);
    if (u3dOccTexLoc) gl.uniform1i(u3dOccTexLoc, 3);
    if (u3dShadowMapLoc) gl.uniform1i(u3dShadowMapLoc, 4);

    gl.useProgram(this.shadowMeshProg);
    this.uShadowMeshLvpLoc = gl.getUniformLocation(this.shadowMeshProg, 'uLightViewProj');

    gl.useProgram(this.shadowQuadProg);
    this.uShadowQuadLvpLoc = gl.getUniformLocation(this.shadowQuadProg, 'uLightViewProj');
    const uSqAtlasLoc = gl.getUniformLocation(this.shadowQuadProg, 'uAtlas');
    const uSqIdxLoc = gl.getUniformLocation(this.shadowQuadProg, 'uIndexAtlas');
    if (uSqAtlasLoc) gl.uniform1i(uSqAtlasLoc, 0);
    if (uSqIdxLoc) gl.uniform1i(uSqIdxLoc, 1);

    gl.useProgram(this.mesh3dProg);
    const uMeshAtlasLoc = gl.getUniformLocation(this.mesh3dProg, 'uAtlas');
    const uMeshIdxLoc = gl.getUniformLocation(this.mesh3dProg, 'uIndexAtlas');
    const uMeshLutLoc = gl.getUniformLocation(this.mesh3dProg, 'uPaletteLut');
    const uMeshShadowLoc = gl.getUniformLocation(this.mesh3dProg, 'uShadowMap');
    this.uMeshViewProjLoc = gl.getUniformLocation(this.mesh3dProg, 'uViewProj');
    this.uMeshViewSizeLoc = gl.getUniformLocation(this.mesh3dProg, 'uViewSize');
    this.uMeshLightViewProjLoc = gl.getUniformLocation(this.mesh3dProg, 'uLightViewProj');
    this.uMeshEyePosLoc = gl.getUniformLocation(this.mesh3dProg, 'uEyePos');
    this.uMeshSunDirInfoLoc = gl.getUniformLocation(this.mesh3dProg, 'uSunDirInfo');
    this.uMeshLightPosZLoc = gl.getUniformLocation(this.mesh3dProg, 'uLightPosZ');
    this.uMeshPaletteRowsLoc = gl.getUniformLocation(this.mesh3dProg, 'uPaletteRows');
    this.uMeshOpaquePassLoc = gl.getUniformLocation(this.mesh3dProg, 'uOpaquePass');
    this.uMeshLightCountLoc = gl.getUniformLocation(this.mesh3dProg, 'uLightCount');
    this.uMeshLightPosRadLoc = gl.getUniformLocation(this.mesh3dProg, 'uLightPosRad');
    this.uMeshLightColIntLoc = gl.getUniformLocation(this.mesh3dProg, 'uLightColInt');
    if (uMeshAtlasLoc) gl.uniform1i(uMeshAtlasLoc, 0);
    if (uMeshIdxLoc) gl.uniform1i(uMeshIdxLoc, 1);
    if (uMeshLutLoc) gl.uniform1i(uMeshLutLoc, 2);
    if (uMeshShadowLoc) gl.uniform1i(uMeshShadowLoc, 4);

    gl.useProgram(this.bloomDownProg);
    const uDownTexLoc = gl.getUniformLocation(this.bloomDownProg, 'uTexA');
    this.uDownOffsetLoc = gl.getUniformLocation(this.bloomDownProg, 'uTexelOffset');
    if (uDownTexLoc) gl.uniform1i(uDownTexLoc, 0);

    gl.useProgram(this.bloomBlurProg);
    const uBlurTexLoc = gl.getUniformLocation(this.bloomBlurProg, 'uTexA');
    this.uBlurStepLoc = gl.getUniformLocation(this.bloomBlurProg, 'uBlurStep');
    if (uBlurTexLoc) gl.uniform1i(uBlurTexLoc, 0);

    gl.useProgram(this.compositeProg);
    const uSceneTexLoc = gl.getUniformLocation(this.compositeProg, 'uSceneTex');
    const uSceneLinearTexLoc = gl.getUniformLocation(this.compositeProg, 'uSceneLinearTex');
    const uBloomTexLoc = gl.getUniformLocation(this.compositeProg, 'uBloomTex');
    this.uCompGlowLoc = gl.getUniformLocation(this.compositeProg, 'uGlowIntensity');
    this.uCompFilterLoc = gl.getUniformLocation(this.compositeProg, 'uFilterMode');
    this.uCompCozyLoc = gl.getUniformLocation(this.compositeProg, 'uCozyFilter');
    this.uCompCamFracLoc = gl.getUniformLocation(this.compositeProg, 'uCamFrac');
    this.uCompViewSizeLoc = gl.getUniformLocation(this.compositeProg, 'uViewSize');
    this.uCompWaterLevelLoc = gl.getUniformLocation(this.compositeProg, 'uWaterLevel');
    this.uCompWaterTintLoc = gl.getUniformLocation(this.compositeProg, 'uWaterTint');
    this.uCompTimeLoc = gl.getUniformLocation(this.compositeProg, 'uTimeSec');
    this.uCompTiltShiftLoc = gl.getUniformLocation(this.compositeProg, 'uTiltShift');
    this.uCompOutputSizeLoc = gl.getUniformLocation(this.compositeProg, 'uOutputSize');
    if (uSceneTexLoc) gl.uniform1i(uSceneTexLoc, 0);
    if (uBloomTexLoc) gl.uniform1i(uBloomTexLoc, 1);
    if (uSceneLinearTexLoc) gl.uniform1i(uSceneLinearTexLoc, 2);

    this.skyVao = gl.createVertexArray()!;
    this.alphaVao = gl.createVertexArray()!;
    this.addVao = gl.createVertexArray()!;
    this.quad3dOpaqueVao = gl.createVertexArray()!;
    this.quad3dAlphaVao = gl.createVertexArray()!;
    this.quad3dAddVao = gl.createVertexArray()!;
    this.meshOpaqueVao = gl.createVertexArray()!;
    this.meshAlphaVao = gl.createVertexArray()!;
    this.line3dVao = gl.createVertexArray()!;
    this.alphaBuffer = gl.createBuffer()!;
    this.addBuffer = gl.createBuffer()!;
    this.quad3dOpaqueBuffer = gl.createBuffer()!;
    this.quad3dAlphaBuffer = gl.createBuffer()!;
    this.quad3dAddBuffer = gl.createBuffer()!;
    this.meshOpaqueVbo = gl.createBuffer()!;
    this.meshOpaqueIbo = gl.createBuffer()!;
    this.meshAlphaVbo = gl.createBuffer()!;
    this.meshAlphaIbo = gl.createBuffer()!;
    this.line3dVbo = gl.createBuffer()!;
    this.shadowFbo = gl.createFramebuffer()!;
    this.shadowDepthTex = gl.createTexture()!;
    this.atlasTexture = gl.createTexture()!;
    this.indexAtlasTexture = gl.createTexture()!;
    this.paletteLutTexture = gl.createTexture()!;
    this.occlusionTexture = gl.createTexture()!;
    this.nearestSampler = this.createClampedSampler(gl.NEAREST);
    this.linearSampler = this.createClampedSampler(gl.LINEAR);

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
    setupInstanceVao(this.alphaVao, this.alphaBuffer);
    setupInstanceVao(this.addVao, this.addBuffer);

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
    setupQuad3dVao(this.quad3dOpaqueVao, this.quad3dOpaqueBuffer, MAX_QUAD3D_INSTANCES);
    setupQuad3dVao(this.quad3dAlphaVao, this.quad3dAlphaBuffer, MAX_QUAD3D_BLEND_INSTANCES);
    setupQuad3dVao(this.quad3dAddVao, this.quad3dAddBuffer, MAX_QUAD3D_BLEND_INSTANCES);

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
    setupMeshVao(this.meshOpaqueVao, this.meshOpaqueVbo, MAX_MESH3D_VERTICES, this.meshOpaqueIbo, MAX_MESH3D_INDICES);
    setupMeshVao(this.meshAlphaVao, this.meshAlphaVbo, MAX_MESH3D_ALPHA_VERTICES, this.meshAlphaIbo, MAX_MESH3D_ALPHA_INDICES);
    setupMeshVao(this.line3dVao, this.line3dVbo, MAX_LINE3D_VERTICES, null, 0);
    gl.bindVertexArray(null);

    // 1024x1024 Hardware PCF Directional Shadow Map
    gl.bindTexture(gl.TEXTURE_2D, this.shadowDepthTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      SHADOW_MAP_SIZE,
      SHADOW_MAP_SIZE,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowDepthTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const initNearestTex2D = (tex: WebGLTexture) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    this.configureNearestTexArray(this.atlasTexture);
    this.configureNearestTexArray(this.indexAtlasTexture);
    initNearestTex2D(this.paletteLutTexture);
    initNearestTex2D(this.occlusionTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      OCCLUSION_GRID_MAX,
      OCCLUSION_GRID_MAX,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      this.occUploadBuf,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    this.uploadAtlas(
      atlasWidth,
      atlasHeight,
      initialPixels,
      initialIndexPixels ?? new Uint8Array(atlasWidth * atlasHeight).fill(255),
      initialPaletteLut ?? new Uint8Array(16 * this.paletteRows * 4).fill(255),
      this.paletteRows,
      initialExtraPages,
    );

    // Validate MRT FBO support eagerly so tryCreate can degrade cleanly if needed
    this.ensureRenderTargets(Math.max(1, gl.canvas.width), Math.max(1, gl.canvas.height));

    if (onLost) {
      let triggered = false;
      this.onLostListener = (e: Event) => {
        e.preventDefault();
        if (!triggered) {
          triggered = true;
          onLost();
        }
      };
      canvas.addEventListener('webglcontextlost', this.onLostListener);
    }
  }

  public static tryCreate(
    canvas: HTMLCanvasElement,
    atlasWidth: number,
    atlasHeight: number,
    initialPixels: Uint8Array,
    onLost?: () => void,
    initialIndexPixels?: Uint8Array,
    initialPaletteLut?: Uint8Array,
    initialPaletteRows = DEFAULT_PALETTE_ROWS,
    initialExtraPages?: readonly AtlasPageData[],
  ): WebGl2Backend | null {
    try {
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl || gl.isContextLost()) {
        appLogger.warn('gpu', 'webgl2.tryCreate', 'WebGL2 Context 不可用或已遺失，改用 Canvas 2D');
        return null;
      }
      return new WebGl2Backend(
        canvas,
        gl,
        atlasWidth,
        atlasHeight,
        initialPixels,
        onLost,
        initialIndexPixels,
        initialPaletteLut,
        initialPaletteRows,
        initialExtraPages,
      );
    } catch (err) {
      appLogger.warn('gpu', 'webgl2.tryCreate', 'WebGL2 初始化發生例外，退回 Canvas 2D', err);
      return null;
    }
  }

  private destroyRenderTargets(): void {
    if (!this.targets) return;
    const gl = this.gl;
    gl.deleteFramebuffer(this.targets.mrtFbo);
    gl.deleteRenderbuffer(this.targets.depthRb);
    gl.deleteFramebuffer(this.targets.bloomFboA);
    gl.deleteFramebuffer(this.targets.bloomFboB);
    gl.deleteTexture(this.targets.sceneTex);
    gl.deleteTexture(this.targets.emissiveTex);
    gl.deleteTexture(this.targets.bloomTexA);
    gl.deleteTexture(this.targets.bloomTexB);
    this.targets = null;
  }

  private ensureRenderTargets(w: number, h: number, viewW = GAME_W, viewH = GAME_H): GlRenderTargets {
    if (
      this.targets &&
      this.targets.w === w &&
      this.targets.h === h &&
      this.targets.viewW === viewW &&
      this.targets.viewH === viewH
    ) {
      return this.targets;
    }
    this.destroyRenderTargets();
    const gl = this.gl;
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

    this.targets = {
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
    return this.targets;
  }

  private createClampedSampler(filter: number): WebGLSampler {
    const gl = this.gl;
    const sampler = gl.createSampler()!;
    gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, filter);
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, filter);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return sampler;
  }

  private configureNearestTexArray(tex: WebGLTexture): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  public uploadAtlas(
    width: number,
    height: number,
    pixels: Uint8Array,
    indexPixels?: Uint8Array,
    paletteLut?: Uint8Array,
    paletteRows?: number,
    extraPages?: readonly AtlasPageData[],
  ): void {
    const gl = this.gl;
    const extraCount = extraPages ? Math.min(MAX_ATLAS_PAGES - 1, extraPages.length) : 0;
    const layerCount = 1 + extraCount;
    const needsAlloc =
      this.atlasAllocW !== width ||
      this.atlasAllocH !== height ||
      this.atlasAllocLayers !== layerCount;

    if (needsAlloc) {
      if (this.atlasAllocLayers > 0) {
        gl.deleteTexture(this.atlasTexture);
        this.atlasTexture = gl.createTexture()!;
        this.configureNearestTexArray(this.atlasTexture);
        gl.deleteTexture(this.indexAtlasTexture);
        this.indexAtlasTexture = gl.createTexture()!;
        this.configureNearestTexArray(this.indexAtlasTexture);
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTexture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, layerCount);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.indexAtlasTexture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, width, height, layerCount);
      this.atlasAllocW = width;
      this.atlasAllocH = height;
      this.atlasAllocLayers = layerCount;
    }

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTexture);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (extraPages) {
      for (let i = 0; i < extraCount; i++) {
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          0,
          0,
          i + 1,
          width,
          height,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          extraPages[i].pixels,
        );
      }
    }

    if (indexPixels) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.indexAtlasTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, width, height, 1, gl.RED, gl.UNSIGNED_BYTE, indexPixels);
      if (extraPages) {
        for (let i = 0; i < extraCount; i++) {
          gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY,
            0,
            0,
            0,
            i + 1,
            width,
            height,
            1,
            gl.RED,
            gl.UNSIGNED_BYTE,
            extraPages[i].indexPixels,
          );
        }
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }

    if (paletteLut && paletteRows) {
      const nextRows = Math.max(1, paletteRows);
      gl.bindTexture(gl.TEXTURE_2D, this.paletteLutTexture);
      if (!this.paletteLutAllocated || nextRows !== this.paletteRows) {
        this.paletteRows = nextRows;
        this.paletteLutAllocated = true;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, this.paletteRows, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteLut);
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, this.paletteRows, gl.RGBA, gl.UNSIGNED_BYTE, paletteLut);
      }
    }
  }

  public resize(_pixelWidth: number, _pixelHeight: number): void {
    // Framebuffers synchronize lazily with canvas dimensions in renderFrame
  }

  public renderFrame(
    sky: SkyGradient,
    alphaItems: Float32Array,
    alphaCount: number,
    additiveItems: Float32Array,
    additiveCount: number,
    timeSec: number,
    lightsData?: Float32Array,
    lightCount = 0,
    occlusion?: GpuOcclusionState,
    quad3d?: Quad3DPassData,
    mesh3d?: Mesh3DPassData,
  ): number {
    const gl = this.gl;
    const w = Math.max(1, gl.canvas.width);
    const h = Math.max(1, gl.canvas.height);
    const vw = Math.max(1, Math.round(sky.viewW ?? GAME_W));
    const vh = Math.max(1, Math.round(sky.viewH ?? GAME_H));
    const rt = this.ensureRenderTargets(w, h, vw, vh);

    // Pass 1: MRT Scene Color + Emissive Mask (Overscan (viewW+2)x(viewH+2) virtual space)
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.mrtFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, rt.osW, rt.osH);

    let drawCalls = 1;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.skyProg);
    gl.bindVertexArray(this.skyVao);
    const mid = sky.mid;
    gl.uniform3f(this.uTopLoc, sky.top[0], sky.top[1], sky.top[2]);
    gl.uniform3f(
      this.uMidLoc,
      mid ? mid[0] : (sky.top[0] + sky.bottom[0]) * 0.5,
      mid ? mid[1] : (sky.top[1] + sky.bottom[1]) * 0.5,
      mid ? mid[2] : (sky.top[2] + sky.bottom[2]) * 0.5,
    );
    gl.uniform3f(this.uBottomLoc, sky.bottom[0], sky.bottom[1], sky.bottom[2]);
    gl.uniform1f(this.uCozyLoc, sky.cozyFilter ? 1 : 0);
    gl.uniform1f(this.uTimeLoc, timeSec);
    gl.uniform2f(this.uSkyViewSizeLoc, vw, vh);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const safeLights = lightsData ? Math.max(0, Math.min(MAX_DYNAMIC_LIGHTS, lightCount | 0)) : 0;
    if (safeLights > 0) {
      for (let i = 0; i < safeLights; i++) {
        const src = i * 8;
        const dst = i * 4;
        this.lightPosRadData[dst] = lightsData![src];
        this.lightPosRadData[dst + 1] = lightsData![src + 1];
        this.lightPosRadData[dst + 2] = lightsData![src + 2];
        this.lightPosRadData[dst + 3] = lightsData![src + 7];
        this.lightColIntData[dst] = lightsData![src + 4];
        this.lightColIntData[dst + 1] = lightsData![src + 5];
        this.lightColIntData[dst + 2] = lightsData![src + 6];
        this.lightColIntData[dst + 3] = lightsData![src + 3];
      }
    }

    const occOn = Boolean(
      occlusion?.enabled &&
        occlusion.data &&
        occlusion.cols > 0 &&
        occlusion.rows > 0 &&
        occlusion.shadowStrength > 0.001,
    );
    if (occOn && occlusion && occlusion.data && occlusion.version !== this.lastOcclusionVersion) {
      const len = Math.min(this.occUploadBuf.length, occlusion.data.length);
      this.occUploadBuf.fill(0);
      this.occUploadBuf.set(occlusion.data.subarray(0, len), 0);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.occlusionTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        OCCLUSION_GRID_MAX,
        OCCLUSION_GRID_MAX,
        gl.RED,
        gl.UNSIGNED_BYTE,
        this.occUploadBuf,
      );
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      this.lastOcclusionVersion = occlusion.version;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.indexAtlasTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteLutTexture);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.occlusionTexture);

    // Optional True 3D Perspective/Ortho Scene Pass (Directional Shadow Map + Mesh3D + Quad3D + Gizmo Lines)
    const use3D = Boolean(quad3d && quad3d.camera.enabled);
    if (use3D && quad3d) {
      const cam = quad3d.camera;
      computeCamera3D(
        {
          camCenterX: cam.camCenterX,
          camCenterY: cam.camCenterY,
          camCenterZ: cam.camCenterZ,
          zoom: cam.zoom,
          yawDeg: cam.yawDeg,
          pitchDeg: cam.pitchDeg,
          rollDeg: cam.rollDeg,
          fovDeg: cam.fovDeg,
          projection: cam.projection,
          viewW: vw,
          viewH: vh,
        },
        this.cam3dScratch,
      );
      buildCamera3DViewProjMatrix(this.cam3dScratch, false, this.viewProj3d);
      const shadowHalfExtent = (Math.max(vw, vh) / Math.max(0.25, cam.zoom)) * 0.85 + 160;
      buildDirectionalLightViewProjMatrix(
        cam.camCenterX,
        cam.camCenterY,
        cam.camCenterZ,
        cam.sunDirX,
        cam.sunDirY,
        cam.sunDirZ,
        shadowHalfExtent,
        shadowHalfExtent * 3.2 + 420,
        SHADOW_MAP_SIZE,
        false,
        this.lightViewProj3d,
      );

      const safe3dOpaque = Math.min(quad3d.opaqueCount, MAX_QUAD3D_INSTANCES);
      const safe3dAlpha = Math.min(quad3d.alphaCount, MAX_QUAD3D_BLEND_INSTANCES);
      const safe3dAdd = Math.min(quad3d.additiveCount, MAX_QUAD3D_BLEND_INSTANCES);
      const safeMeshOpaqueV = mesh3d ? Math.min(mesh3d.opaqueVertexCount, MAX_MESH3D_VERTICES) : 0;
      const safeMeshOpaqueI = mesh3d ? Math.min(mesh3d.opaqueIndexCount, MAX_MESH3D_INDICES) : 0;
      const safeMeshAlphaV = mesh3d ? Math.min(mesh3d.alphaVertexCount, MAX_MESH3D_ALPHA_VERTICES) : 0;
      const safeMeshAlphaI = mesh3d ? Math.min(mesh3d.alphaIndexCount, MAX_MESH3D_ALPHA_INDICES) : 0;
      const safeLine3dV = mesh3d ? Math.min(mesh3d.lineVertexCount, MAX_LINE3D_VERTICES) : 0;

      const lz = mesh3d?.lightPosZ;
      for (let i = 0; i < MAX_DYNAMIC_LIGHTS; i++) {
        this.lightPosZData[i] = lz && i < lz.length ? lz[i] : 24.0;
      }

      // Upload 3D buffers once before Shadow + Main passes
      if (safe3dOpaque > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad3dOpaqueBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad3d.opaqueData.subarray(0, safe3dOpaque * FLOATS_PER_QUAD3D));
      }
      if (mesh3d && safeMeshOpaqueV > 0 && safeMeshOpaqueI > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshOpaqueVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh3d.opaqueVertices.subarray(0, safeMeshOpaqueV * FLOATS_PER_MESH3D_VERTEX));
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshOpaqueIbo);
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh3d.opaqueIndices.subarray(0, safeMeshOpaqueI));
      }

      const runShadowPass = Boolean(
        cam.shadowMapEnabled && cam.shadowStrength > 0.005 && (safeMeshOpaqueI > 0 || safe3dOpaque > 0),
      );
      if (runShadowPass) {
        // Unbind shadow depth texture from TEXTURE4 to guarantee zero FBO feedback loop
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
        gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
        gl.colorMask(false, false, false, false);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(2.0, 2.0);
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        if (safeMeshOpaqueI > 0) {
          gl.useProgram(this.shadowMeshProg);
          gl.uniformMatrix4fv(this.uShadowMeshLvpLoc, false, this.lightViewProj3d);
          gl.bindVertexArray(this.meshOpaqueVao);
          gl.drawElements(gl.TRIANGLES, safeMeshOpaqueI, gl.UNSIGNED_INT, 0);
          drawCalls++;
        }
        if (safe3dOpaque > 0) {
          gl.useProgram(this.shadowQuadProg);
          gl.uniformMatrix4fv(this.uShadowQuadLvpLoc, false, this.lightViewProj3d);
          gl.bindVertexArray(this.quad3dOpaqueVao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safe3dOpaque);
          drawCalls++;
        }

        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.mrtFbo);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.viewport(0, 0, rt.osW, rt.osH);
      }

      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowDepthTex);

      gl.depthMask(true);
      gl.clearDepth(1.0);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      const shadowFlag = runShadowPass ? 1.0 : 0.0;

      // Pass 1A-Mesh: Indexed Triangle Mesh3D Opaque
      if (safeMeshOpaqueI > 0) {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.useProgram(this.mesh3dProg);
        gl.uniformMatrix4fv(this.uMeshViewProjLoc, false, this.viewProj3d);
        gl.uniform2f(this.uMeshViewSizeLoc, vw, vh);
        gl.uniformMatrix4fv(this.uMeshLightViewProjLoc, false, this.lightViewProj3d);
        gl.uniform4f(this.uMeshEyePosLoc, this.cam3dScratch.eyeX, this.cam3dScratch.eyeY, this.cam3dScratch.eyeZ, shadowFlag);
        gl.uniform4f(this.uMeshSunDirInfoLoc, cam.sunDirX, cam.sunDirY, cam.sunDirZ, cam.shadowStrength);
        gl.uniform4fv(this.uMeshLightPosZLoc, this.lightPosZData);
        gl.uniform1f(this.uMeshPaletteRowsLoc, this.paletteRows);
        gl.uniform1f(this.uMeshOpaquePassLoc, 1.0);
        gl.uniform1i(this.uMeshLightCountLoc, safeLights);
        if (safeLights > 0) {
          gl.uniform4fv(this.uMeshLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
          gl.uniform4fv(this.uMeshLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
        }
        gl.bindVertexArray(this.meshOpaqueVao);
        gl.drawElements(gl.TRIANGLES, safeMeshOpaqueI, gl.UNSIGNED_INT, 0);
        drawCalls++;
      }

      // Pass 1A-Quad: Quad3D Opaque / Alpha / Additive
      if (safe3dOpaque > 0 || safe3dAlpha > 0 || safe3dAdd > 0) {
        gl.useProgram(this.quad3dProg);
        gl.uniformMatrix4fv(this.u3dViewProjLoc, false, this.viewProj3d);
        gl.uniform2f(this.u3dViewSizeLoc, vw, vh);
        gl.uniformMatrix4fv(this.u3dLightViewProjLoc, false, this.lightViewProj3d);
        gl.uniform4f(this.u3dEyePosLoc, this.cam3dScratch.eyeX, this.cam3dScratch.eyeY, this.cam3dScratch.eyeZ, shadowFlag);
        gl.uniform4f(this.u3dSunDirInfoLoc, cam.sunDirX, cam.sunDirY, cam.sunDirZ, cam.shadowStrength);
        gl.uniform4fv(this.u3dLightPosZLoc, this.lightPosZData);
        gl.uniform1f(this.u3dPaletteRowsLoc, this.paletteRows);
        gl.uniform1i(this.u3dLightCountLoc, safeLights);
        if (safeLights > 0) {
          gl.uniform4fv(this.u3dLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
          gl.uniform4fv(this.u3dLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
        }
        const occCols = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.cols) : 0;
        const occRows = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.rows) : 0;
        const occStr = occOn && occlusion ? occlusion.shadowStrength : 0;
        const occSoft = occOn && occlusion ? occlusion.shadowSoftness : 0.35;
        gl.uniform4f(
          this.u3dOccWorldLoc,
          cam.occOriginWorldX,
          cam.occOriginWorldY,
          Math.max(1, cam.occTileSizeWorld),
          occSoft,
        );

        if (safe3dOpaque > 0) {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
          gl.uniform4f(this.u3dOccDimsLoc, occCols, occRows, occStr, 1.0);
          gl.bindVertexArray(this.quad3dOpaqueVao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safe3dOpaque);
          drawCalls++;
        }

        if (safe3dAlpha > 0) {
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
          gl.uniform4f(this.u3dOccDimsLoc, occCols, occRows, occStr, 0.0);
          gl.bindVertexArray(this.quad3dAlphaVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quad3dAlphaBuffer);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad3d.alphaData.subarray(0, safe3dAlpha * FLOATS_PER_QUAD3D));
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safe3dAlpha);
          drawCalls++;
        }

        if (safe3dAdd > 0) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          gl.depthMask(false);
          gl.uniform4f(this.u3dOccDimsLoc, occCols, occRows, occStr, 0.0);
          gl.bindVertexArray(this.quad3dAddVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quad3dAddBuffer);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad3d.additiveData.subarray(0, safe3dAdd * FLOATS_PER_QUAD3D));
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safe3dAdd);
          drawCalls++;
        }
      }

      // Pass 1A-MeshAlpha & 3D Gizmo/Grid Lines
      if ((mesh3d && safeMeshAlphaV > 0 && safeMeshAlphaI > 0) || (mesh3d && safeLine3dV > 1)) {
        gl.useProgram(this.mesh3dProg);
        gl.uniformMatrix4fv(this.uMeshViewProjLoc, false, this.viewProj3d);
        gl.uniform2f(this.uMeshViewSizeLoc, vw, vh);
        gl.uniformMatrix4fv(this.uMeshLightViewProjLoc, false, this.lightViewProj3d);
        gl.uniform4f(this.uMeshEyePosLoc, this.cam3dScratch.eyeX, this.cam3dScratch.eyeY, this.cam3dScratch.eyeZ, shadowFlag);
        gl.uniform4f(this.uMeshSunDirInfoLoc, cam.sunDirX, cam.sunDirY, cam.sunDirZ, cam.shadowStrength);
        gl.uniform4fv(this.uMeshLightPosZLoc, this.lightPosZData);
        gl.uniform1f(this.uMeshPaletteRowsLoc, this.paletteRows);
        gl.uniform1f(this.uMeshOpaquePassLoc, 0.0);
        gl.uniform1i(this.uMeshLightCountLoc, safeLights);
        if (safeLights > 0) {
          gl.uniform4fv(this.uMeshLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
          gl.uniform4fv(this.uMeshLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
        }
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);

        if (mesh3d && safeMeshAlphaV > 0 && safeMeshAlphaI > 0) {
          gl.bindVertexArray(this.meshAlphaVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.meshAlphaVbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh3d.alphaVertices.subarray(0, safeMeshAlphaV * FLOATS_PER_MESH3D_VERTEX));
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshAlphaIbo);
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh3d.alphaIndices.subarray(0, safeMeshAlphaI));
          gl.drawElements(gl.TRIANGLES, safeMeshAlphaI, gl.UNSIGNED_INT, 0);
          drawCalls++;
        }

        if (mesh3d && safeLine3dV > 1) {
          gl.bindVertexArray(this.line3dVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.line3dVbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh3d.lineVertices.subarray(0, safeLine3dV * FLOATS_PER_MESH3D_VERTEX));
          gl.drawArrays(gl.LINES, 0, safeLine3dV);
          drawCalls++;
        }
      }

      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
    }

    const safeAlpha = Math.min(alphaCount, MAX_INSTANCES_PER_PASS);
    const safeAdd = Math.min(additiveCount, MAX_INSTANCES_PER_PASS);

    if (safeAlpha > 0 || safeAdd > 0) {
      gl.useProgram(this.spriteProg);
      gl.uniform2f(this.uSpriteViewSizeLoc, vw, vh);
      gl.uniform1f(this.uPaletteRowsLoc, this.paletteRows);
      gl.uniform1i(this.uLightCountLoc, use3D ? 0 : safeLights);
      if (!use3D && safeLights > 0) {
        gl.uniform4fv(this.uLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
        gl.uniform4fv(this.uLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
      }
      if (!use3D && occOn && occlusion) {
        gl.uniform4f(
          this.uOccParamsLoc,
          occlusion.originScreenX,
          occlusion.originScreenY,
          Math.max(1, occlusion.tileSizePx),
          occlusion.shadowSoftness,
        );
        gl.uniform4f(
          this.uOccDimsLoc,
          Math.min(OCCLUSION_GRID_MAX, occlusion.cols),
          Math.min(OCCLUSION_GRID_MAX, occlusion.rows),
          occlusion.shadowStrength,
          0,
        );
      } else {
        gl.uniform4f(this.uOccParamsLoc, 0, 0, 32, 0.35);
        gl.uniform4f(this.uOccDimsLoc, 0, 0, 0, 0);
      }
    }

    if (safeAlpha > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.alphaVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphaItems.subarray(0, safeAlpha * FLOATS_PER_INSTANCE));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safeAlpha);
      drawCalls++;
    }

    if (safeAdd > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(this.addVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.addBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, additiveItems.subarray(0, safeAdd * FLOATS_PER_INSTANCE));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safeAdd);
      drawCalls++;
    }

    // Pass 2: 1/4-res Emissive Downsample + Separable H/V Gaussian Blur
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.skyVao);
    if (sky.glowIntensity > 0.01) {
      gl.viewport(0, 0, rt.bloomW, rt.bloomH);

      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.bloomFboA);
      gl.useProgram(this.bloomDownProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rt.emissiveTex);
      gl.uniform2f(this.uDownOffsetLoc, 1 / rt.osW, 1 / rt.osH);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.bloomFboB);
      gl.useProgram(this.bloomBlurProg);
      gl.bindTexture(gl.TEXTURE_2D, rt.bloomTexA);
      gl.uniform2f(this.uBlurStepLoc, 1.25 / rt.bloomW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.bloomFboA);
      gl.bindTexture(gl.TEXTURE_2D, rt.bloomTexB);
      gl.uniform2f(this.uBlurStepLoc, 0, 1.25 / rt.bloomH);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCalls += 3;
    }

    // Pass 3: Crisp Pixel Upscale + Overscan Sub-Pixel Crop + Bloom Composite + Clean/LCD/CRT Post
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rt.sceneTex);
    gl.bindSampler(0, this.nearestSampler);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rt.bloomTexA);
    gl.bindSampler(1, this.linearSampler);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, rt.sceneTex);
    gl.bindSampler(2, this.linearSampler);
    gl.uniform1f(this.uCompGlowLoc, sky.glowIntensity);
    gl.uniform1f(this.uCompFilterLoc, sky.filterMode);
    gl.uniform1f(this.uCompCozyLoc, sky.cozyFilter ? 1 : 0);
    gl.uniform2f(this.uCompCamFracLoc, sky.camFracX ?? 0, sky.camFracY ?? 0);
    gl.uniform2f(this.uCompViewSizeLoc, vw, vh);
    gl.uniform1f(this.uCompWaterLevelLoc, sky.waterLevelNorm ?? 0);
    const wt = sky.waterTint;
    gl.uniform3f(
      this.uCompWaterTintLoc,
      wt ? wt[0] : 0.227,
      wt ? wt[1] : 0.431,
      wt ? wt[2] : 0.612,
    );
    gl.uniform1f(this.uCompTimeLoc, timeSec);
    gl.uniform2f(this.uCompTiltShiftLoc, sky.tiltShiftBlur ?? 0, sky.tiltShiftFocusY ?? 0.52);
    gl.uniform2f(this.uCompOutputSizeLoc, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindSampler(0, null);
    gl.bindSampler(1, null);
    gl.bindSampler(2, null);
    drawCalls++;

    return drawCalls;
  }

  public dispose(): void {
    if (this.onLostListener) {
      this.canvasEl.removeEventListener('webglcontextlost', this.onLostListener);
      this.onLostListener = undefined;
    }
    this.destroyRenderTargets();
    const gl = this.gl;
    gl.deleteBuffer(this.alphaBuffer);
    gl.deleteBuffer(this.addBuffer);
    gl.deleteBuffer(this.quad3dOpaqueBuffer);
    gl.deleteBuffer(this.quad3dAlphaBuffer);
    gl.deleteBuffer(this.quad3dAddBuffer);
    gl.deleteBuffer(this.meshOpaqueVbo);
    gl.deleteBuffer(this.meshOpaqueIbo);
    gl.deleteBuffer(this.meshAlphaVbo);
    gl.deleteBuffer(this.meshAlphaIbo);
    gl.deleteBuffer(this.line3dVbo);
    gl.deleteFramebuffer(this.shadowFbo);
    gl.deleteTexture(this.shadowDepthTex);
    gl.deleteSampler(this.nearestSampler);
    gl.deleteSampler(this.linearSampler);
    gl.deleteTexture(this.atlasTexture);
    gl.deleteTexture(this.indexAtlasTexture);
    gl.deleteTexture(this.paletteLutTexture);
    gl.deleteTexture(this.occlusionTexture);
    gl.deleteVertexArray(this.skyVao);
    gl.deleteVertexArray(this.alphaVao);
    gl.deleteVertexArray(this.addVao);
    gl.deleteVertexArray(this.quad3dOpaqueVao);
    gl.deleteVertexArray(this.quad3dAlphaVao);
    gl.deleteVertexArray(this.quad3dAddVao);
    gl.deleteVertexArray(this.meshOpaqueVao);
    gl.deleteVertexArray(this.meshAlphaVao);
    gl.deleteVertexArray(this.line3dVao);
    gl.deleteProgram(this.skyProg);
    gl.deleteProgram(this.spriteProg);
    gl.deleteProgram(this.quad3dProg);
    gl.deleteProgram(this.shadowMeshProg);
    gl.deleteProgram(this.shadowQuadProg);
    gl.deleteProgram(this.mesh3dProg);
    gl.deleteProgram(this.bloomDownProg);
    gl.deleteProgram(this.bloomBlurProg);
    gl.deleteProgram(this.compositeProg);
  }
}

