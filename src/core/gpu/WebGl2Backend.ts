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
  SHADOW_MAP_SIZE,
  type AtlasPageData,
  type GpuCamera3DState,
  type GpuOcclusionState,
  type IGpuBackend,
  type Mesh3DPassData,
  type Quad3DPassData,
  type SkyGradient,
} from './GpuTypes.ts';
import {
  createGlRenderTargets,
  createWebGl2Programs,
  createWebGl2Vaos,
  destroyGlRenderTargets,
  disposeWebGl2Programs,
  disposeWebGl2Vaos,
  type GlRenderTargets,
  type WebGl2ProgramBundle,
  type WebGl2VaoBundle,
} from './WebGl2Programs.ts';

const DEFAULT_PALETTE_ROWS = 8;
const MAX_QUAD3D_BLEND_INSTANCES = 4096;

export class WebGl2Backend implements IGpuBackend {
  public readonly kind = 'webgl2' as const;

  private gl: WebGL2RenderingContext;
  private readonly progs: WebGl2ProgramBundle;
  private readonly vaos: WebGl2VaoBundle;
  private uLightCountLoc: WebGLUniformLocation | null;
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
    this.progs = createWebGl2Programs(gl);
    this.uLightCountLoc = this.progs.uLightCountLoc;
    this.vaos = createWebGl2Vaos(gl, MAX_QUAD3D_BLEND_INSTANCES);

    this.shadowFbo = gl.createFramebuffer()!;
    this.shadowDepthTex = gl.createTexture()!;
    this.atlasTexture = gl.createTexture()!;
    this.indexAtlasTexture = gl.createTexture()!;
    this.paletteLutTexture = gl.createTexture()!;
    this.occlusionTexture = gl.createTexture()!;
    this.nearestSampler = this.createClampedSampler(gl.NEAREST);
    this.linearSampler = this.createClampedSampler(gl.LINEAR);

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
    this.targets = destroyGlRenderTargets(this.gl, this.targets);
    this.targets = createGlRenderTargets(this.gl, w, h, viewW, viewH);
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

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.mrtFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, rt.osW, rt.osH);

    const isQuadView = Boolean(quad3d && quad3d.camera.enabled && quad3d.quadViews);
    let drawCalls = 0;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.progs.skyProg);
    gl.bindVertexArray(this.vaos.skyVao);
    const mid = sky.mid;
    gl.uniform3f(this.progs.uTopLoc, sky.top[0], sky.top[1], sky.top[2]);
    gl.uniform3f(
      this.progs.uMidLoc,
      mid ? mid[0] : (sky.top[0] + sky.bottom[0]) * 0.5,
      mid ? mid[1] : (sky.top[1] + sky.bottom[1]) * 0.5,
      mid ? mid[2] : (sky.top[2] + sky.bottom[2]) * 0.5,
    );
    gl.uniform3f(this.progs.uBottomLoc, sky.bottom[0], sky.bottom[1], sky.bottom[2]);
    gl.uniform1f(this.progs.uCozyLoc, sky.cozyFilter ? 1 : 0);
    gl.uniform1f(this.progs.uTimeLoc, timeSec);
    gl.uniform2f(this.progs.uSkyViewSizeLoc, vw, vh);
    if (!isQuadView) {
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCalls++;
    }

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

    const use3D = Boolean(quad3d && quad3d.camera.enabled);
    if (use3D && quad3d) {
      drawCalls += this.render3DPasses(rt, vw, vh, safeLights, occOn, occlusion, quad3d, mesh3d);
    }

    const safeAlpha = Math.min(alphaCount, MAX_INSTANCES_PER_PASS);
    const safeAdd = Math.min(additiveCount, MAX_INSTANCES_PER_PASS);

    if (safeAlpha > 0 || safeAdd > 0) {
      gl.useProgram(this.progs.spriteProg);
      gl.uniform2f(this.progs.uSpriteViewSizeLoc, vw, vh);
      gl.uniform1f(this.progs.uPaletteRowsLoc, this.paletteRows);
      gl.uniform1i(this.uLightCountLoc, use3D ? 0 : safeLights);
      if (!use3D && safeLights > 0) {
        gl.uniform4fv(this.progs.uLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
        gl.uniform4fv(this.progs.uLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
      }
      if (!use3D && occOn && occlusion) {
        gl.uniform4f(
          this.progs.uOccParamsLoc,
          occlusion.originScreenX,
          occlusion.originScreenY,
          Math.max(1, occlusion.tileSizePx),
          occlusion.shadowSoftness,
        );
        gl.uniform4f(
          this.progs.uOccDimsLoc,
          Math.min(OCCLUSION_GRID_MAX, occlusion.cols),
          Math.min(OCCLUSION_GRID_MAX, occlusion.rows),
          occlusion.shadowStrength,
          0,
        );
      } else {
        gl.uniform4f(this.progs.uOccParamsLoc, 0, 0, 32, 0.35);
        gl.uniform4f(this.progs.uOccDimsLoc, 0, 0, 0, 0);
      }
    }

    if (safeAlpha > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.vaos.alphaVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.alphaBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphaItems.subarray(0, safeAlpha * FLOATS_PER_INSTANCE));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safeAlpha);
      drawCalls++;
    }

    if (safeAdd > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(this.vaos.addVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.addBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, additiveItems.subarray(0, safeAdd * FLOATS_PER_INSTANCE));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safeAdd);
      drawCalls++;
    }

    // Pass 2: 1/4-res Emissive Downsample + Separable H/V Gaussian Blur
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaos.skyVao);
    if (sky.glowIntensity > 0.01) {
      gl.viewport(0, 0, rt.bloomW, rt.bloomH);

      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.bloomFboA);
      gl.useProgram(this.progs.bloomDownProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rt.emissiveTex);
      gl.uniform2f(this.progs.uDownOffsetLoc, 1 / rt.osW, 1 / rt.osH);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.bloomFboB);
      gl.useProgram(this.progs.bloomBlurProg);
      gl.bindTexture(gl.TEXTURE_2D, rt.bloomTexA);
      gl.uniform2f(this.progs.uBlurStepLoc, 1.25 / rt.bloomW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.bloomFboA);
      gl.bindTexture(gl.TEXTURE_2D, rt.bloomTexB);
      gl.uniform2f(this.progs.uBlurStepLoc, 0, 1.25 / rt.bloomH);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCalls += 3;
    }

    // Pass 3: Crisp Pixel Upscale + Overscan Sub-Pixel Crop + Bloom Composite + Clean/LCD/CRT Post
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progs.compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rt.sceneTex);
    gl.bindSampler(0, this.nearestSampler);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rt.bloomTexA);
    gl.bindSampler(1, this.linearSampler);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, rt.sceneTex);
    gl.bindSampler(2, this.linearSampler);
    gl.uniform1f(this.progs.uCompGlowLoc, sky.glowIntensity);
    gl.uniform1f(this.progs.uCompFilterLoc, sky.filterMode);
    gl.uniform1f(this.progs.uCompCozyLoc, sky.cozyFilter ? 1 : 0);
    gl.uniform2f(this.progs.uCompCamFracLoc, sky.camFracX ?? 0, sky.camFracY ?? 0);
    gl.uniform2f(this.progs.uCompViewSizeLoc, vw, vh);
    gl.uniform1f(this.progs.uCompWaterLevelLoc, sky.waterLevelNorm ?? 0);
    const wt = sky.waterTint;
    gl.uniform3f(
      this.progs.uCompWaterTintLoc,
      wt ? wt[0] : 0.227,
      wt ? wt[1] : 0.431,
      wt ? wt[2] : 0.612,
    );
    gl.uniform1f(this.progs.uCompTimeLoc, timeSec);
    gl.uniform2f(this.progs.uCompTiltShiftLoc, sky.tiltShiftBlur ?? 0, sky.tiltShiftFocusY ?? 0.52);
    gl.uniform2f(this.progs.uCompOutputSizeLoc, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindSampler(0, null);
    gl.bindSampler(1, null);
    gl.bindSampler(2, null);
    drawCalls++;

    return drawCalls;
  }

  private render3DPasses(
    rt: GlRenderTargets,
    vw: number,
    vh: number,
    safeLights: number,
    occOn: boolean,
    occlusion: GpuOcclusionState | undefined,
    quad3d: Quad3DPassData,
    mesh3d: Mesh3DPassData | undefined,
  ): number {
    const gl = this.gl;
    let drawCalls = 0;
    const cam = quad3d.camera;
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

    if (safe3dOpaque > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.quad3dOpaqueBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad3d.opaqueData.subarray(0, safe3dOpaque * FLOATS_PER_QUAD3D));
    }
    if (safe3dAlpha > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.quad3dAlphaBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad3d.alphaData.subarray(0, safe3dAlpha * FLOATS_PER_QUAD3D));
    }
    if (safe3dAdd > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.quad3dAddBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad3d.additiveData.subarray(0, safe3dAdd * FLOATS_PER_QUAD3D));
    }
    if (mesh3d && safeMeshOpaqueV > 0 && safeMeshOpaqueI > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.meshOpaqueVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh3d.opaqueVertices.subarray(0, safeMeshOpaqueV * FLOATS_PER_MESH3D_VERTEX));
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.vaos.meshOpaqueIbo);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh3d.opaqueIndices.subarray(0, safeMeshOpaqueI));
    }
    if (mesh3d && safeMeshAlphaV > 0 && safeMeshAlphaI > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.meshAlphaVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh3d.alphaVertices.subarray(0, safeMeshAlphaV * FLOATS_PER_MESH3D_VERTEX));
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.vaos.meshAlphaIbo);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh3d.alphaIndices.subarray(0, safeMeshAlphaI));
    }
    if (mesh3d && safeLine3dV > 1) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vaos.line3dVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh3d.lineVertices.subarray(0, safeLine3dV * FLOATS_PER_MESH3D_VERTEX));
    }

    const runShadowPass = Boolean(
      cam.shadowMapEnabled && cam.shadowStrength > 0.005 && (safeMeshOpaqueI > 0 || safe3dOpaque > 0),
    );
    if (runShadowPass) {
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
        gl.useProgram(this.progs.shadowMeshProg);
        gl.uniformMatrix4fv(this.progs.uShadowMeshLvpLoc, false, this.lightViewProj3d);
        gl.bindVertexArray(this.vaos.meshOpaqueVao);
        gl.drawElements(gl.TRIANGLES, safeMeshOpaqueI, gl.UNSIGNED_INT, 0);
        drawCalls++;
      }
      if (safe3dOpaque > 0) {
        gl.useProgram(this.progs.shadowQuadProg);
        gl.uniformMatrix4fv(this.progs.uShadowQuadLvpLoc, false, this.lightViewProj3d);
        gl.bindVertexArray(this.vaos.quad3dOpaqueVao);
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

    const shadowFlag = runShadowPass ? 1.0 : 0.0;
    const quadViews = quad3d.quadViews;
    if (quadViews) {
      const halfW = Math.floor(rt.osW * 0.5);
      const halfH = Math.floor(rt.osH * 0.5);
      const subW = vw * 0.5;
      const subH = vh * 0.5;
      gl.enable(gl.SCISSOR_TEST);
      for (let q = 0; q < 4; q++) {
        const vx = (q & 1) === 0 ? 0 : halfW;
        const vy = q < 2 ? halfH : 0;
        const vwQ = (q & 1) === 0 ? halfW : rt.osW - halfW;
        const vhQ = q < 2 ? rt.osH - halfH : halfH;
        if (vwQ <= 0 || vhQ <= 0) continue;
        gl.viewport(vx, vy, vwQ, vhQ);
        gl.scissor(vx, vy, vwQ, vhQ);
        gl.useProgram(this.progs.skyProg);
        gl.bindVertexArray(this.vaos.skyVao);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        drawCalls++;
        drawCalls += this.bindAndDraw3DScene(
          subW,
          subH,
          quadViews[q],
          shadowFlag,
          safeLights,
          occOn,
          occlusion,
          safe3dOpaque,
          safe3dAlpha,
          safe3dAdd,
          safeMeshOpaqueI,
          safeMeshAlphaI,
          safeLine3dV,
        );
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, rt.osW, rt.osH);
    } else {
      drawCalls += this.bindAndDraw3DScene(
        vw,
        vh,
        cam,
        shadowFlag,
        safeLights,
        occOn,
        occlusion,
        safe3dOpaque,
        safe3dAlpha,
        safe3dAdd,
        safeMeshOpaqueI,
        safeMeshAlphaI,
        safeLine3dV,
      );
    }
    return drawCalls;
  }

  private uploadMesh3dUniforms(
    subViewW: number,
    subViewH: number,
    cam: GpuCamera3DState,
    shadowFlag: number,
    safeLights: number,
    opaquePass: number,
  ): void {
    const gl = this.gl;
    const p = this.progs;
    gl.useProgram(p.mesh3dProg);
    gl.uniformMatrix4fv(p.uMeshViewProjLoc, false, this.viewProj3d);
    gl.uniform2f(p.uMeshViewSizeLoc, subViewW, subViewH);
    gl.uniformMatrix4fv(p.uMeshLightViewProjLoc, false, this.lightViewProj3d);
    gl.uniform4f(p.uMeshEyePosLoc, this.cam3dScratch.eyeX, this.cam3dScratch.eyeY, this.cam3dScratch.eyeZ, shadowFlag);
    gl.uniform4f(p.uMeshSunDirInfoLoc, cam.sunDirX, cam.sunDirY, cam.sunDirZ, cam.shadowStrength);
    gl.uniform4fv(p.uMeshLightPosZLoc, this.lightPosZData);
    gl.uniform1f(p.uMeshPaletteRowsLoc, this.paletteRows);
    gl.uniform1f(p.uMeshOpaquePassLoc, opaquePass);
    gl.uniform1i(p.uMeshLightCountLoc, safeLights);
    if (safeLights > 0) {
      gl.uniform4fv(p.uMeshLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
      gl.uniform4fv(p.uMeshLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
    }
  }

  private bindAndDraw3DScene(
    subViewW: number,
    subViewH: number,
    cam: GpuCamera3DState,
    shadowFlag: number,
    safeLights: number,
    occOn: boolean,
    occlusion: GpuOcclusionState | undefined,
    safe3dOpaque: number,
    safe3dAlpha: number,
    safe3dAdd: number,
    safeMeshOpaqueI: number,
    safeMeshAlphaI: number,
    safeLine3dV: number,
  ): number {
    const gl = this.gl;
    const p = this.progs;
    let drawCalls = 0;
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
        viewW: subViewW,
        viewH: subViewH,
      },
      this.cam3dScratch,
    );
    buildCamera3DViewProjMatrix(this.cam3dScratch, false, this.viewProj3d);

    gl.depthMask(true);
    gl.clearDepth(1.0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    if (safeMeshOpaqueI > 0) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      this.uploadMesh3dUniforms(subViewW, subViewH, cam, shadowFlag, safeLights, 1.0);
      gl.bindVertexArray(this.vaos.meshOpaqueVao);
      gl.drawElements(gl.TRIANGLES, safeMeshOpaqueI, gl.UNSIGNED_INT, 0);
      drawCalls++;
    }

    if (safe3dOpaque > 0 || safe3dAlpha > 0 || safe3dAdd > 0) {
      gl.useProgram(p.quad3dProg);
      gl.uniformMatrix4fv(p.u3dViewProjLoc, false, this.viewProj3d);
      gl.uniform2f(p.u3dViewSizeLoc, subViewW, subViewH);
      gl.uniformMatrix4fv(p.u3dLightViewProjLoc, false, this.lightViewProj3d);
      gl.uniform4f(p.u3dEyePosLoc, this.cam3dScratch.eyeX, this.cam3dScratch.eyeY, this.cam3dScratch.eyeZ, shadowFlag);
      gl.uniform4f(p.u3dSunDirInfoLoc, cam.sunDirX, cam.sunDirY, cam.sunDirZ, cam.shadowStrength);
      gl.uniform4fv(p.u3dLightPosZLoc, this.lightPosZData);
      gl.uniform1f(p.u3dPaletteRowsLoc, this.paletteRows);
      gl.uniform1i(p.u3dLightCountLoc, safeLights);
      if (safeLights > 0) {
        gl.uniform4fv(p.u3dLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
        gl.uniform4fv(p.u3dLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
      }
      const occCols = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.cols) : 0;
      const occRows = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.rows) : 0;
      const occStr = occOn && occlusion ? occlusion.shadowStrength : 0;
      const occSoft = occOn && occlusion ? occlusion.shadowSoftness : 0.35;
      gl.uniform4f(
        p.u3dOccWorldLoc,
        cam.occOriginWorldX,
        cam.occOriginWorldY,
        Math.max(1, cam.occTileSizeWorld),
        occSoft,
      );

      if (safe3dOpaque > 0) {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.uniform4f(p.u3dOccDimsLoc, occCols, occRows, occStr, 1.0);
        gl.bindVertexArray(this.vaos.quad3dOpaqueVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safe3dOpaque);
        drawCalls++;
      }

      if (safe3dAlpha > 0) {
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniform4f(p.u3dOccDimsLoc, occCols, occRows, occStr, 0.0);
        gl.bindVertexArray(this.vaos.quad3dAlphaVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safe3dAlpha);
        drawCalls++;
      }

      if (safe3dAdd > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
        gl.uniform4f(p.u3dOccDimsLoc, occCols, occRows, occStr, 0.0);
        gl.bindVertexArray(this.vaos.quad3dAddVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safe3dAdd);
        drawCalls++;
      }
    }

    if (safeMeshAlphaI > 0 || safeLine3dV > 1) {
      this.uploadMesh3dUniforms(subViewW, subViewH, cam, shadowFlag, safeLights, 0.0);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);

      if (safeMeshAlphaI > 0) {
        gl.bindVertexArray(this.vaos.meshAlphaVao);
        gl.drawElements(gl.TRIANGLES, safeMeshAlphaI, gl.UNSIGNED_INT, 0);
        drawCalls++;
      }

      if (safeLine3dV > 1) {
        gl.bindVertexArray(this.vaos.line3dVao);
        gl.drawArrays(gl.LINES, 0, safeLine3dV);
        drawCalls++;
      }
    }

    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    return drawCalls;
  }

  public dispose(): void {
    if (this.onLostListener) {
      this.canvasEl.removeEventListener('webglcontextlost', this.onLostListener);
      this.onLostListener = undefined;
    }
    this.targets = destroyGlRenderTargets(this.gl, this.targets);
    const gl = this.gl;
    disposeWebGl2Vaos(gl, this.vaos);
    gl.deleteFramebuffer(this.shadowFbo);
    gl.deleteTexture(this.shadowDepthTex);
    gl.deleteSampler(this.nearestSampler);
    gl.deleteSampler(this.linearSampler);
    gl.deleteTexture(this.atlasTexture);
    gl.deleteTexture(this.indexAtlasTexture);
    gl.deleteTexture(this.paletteLutTexture);
    gl.deleteTexture(this.occlusionTexture);
    disposeWebGl2Programs(gl, this.progs);
  }
}
