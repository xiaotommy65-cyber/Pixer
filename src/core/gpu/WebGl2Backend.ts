import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  GAME_H,
  GAME_W,
  MAX_DYNAMIC_LIGHTS,
  MAX_INSTANCES_PER_PASS,
  OVERSCAN_PAD,
  type IGpuBackend,
  type SkyGradient,
} from './GpuTypes.ts';
import {
  BLOOM_BLUR_FS,
  BLOOM_DOWN_FS,
  COMPOSITE_FS,
  POST_VS,
  SKY_FS,
  SKY_VS,
  SPRITE_FS,
  SPRITE_VS,
} from './WebGl2Shaders.ts';

const DEFAULT_PALETTE_ROWS = 8;

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
  private bloomDownProg: WebGLProgram;
  private bloomBlurProg: WebGLProgram;
  private compositeProg: WebGLProgram;
  private skyVao: WebGLVertexArrayObject;
  private spriteVao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private atlasTexture: WebGLTexture;
  private indexAtlasTexture: WebGLTexture;
  private paletteLutTexture: WebGLTexture;
  private paletteRows = DEFAULT_PALETTE_ROWS;
  private targets: GlRenderTargets | null = null;

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
  private readonly lightPosRadData = new Float32Array(MAX_DYNAMIC_LIGHTS * 4);
  private readonly lightColIntData = new Float32Array(MAX_DYNAMIC_LIGHTS * 4);

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
  ) {
    this.canvasEl = canvas;
    this.gl = gl;
    this.paletteRows = Math.max(1, initialPaletteRows);
    this.skyProg = linkProgram(gl, SKY_VS, SKY_FS);
    this.spriteProg = linkProgram(gl, SPRITE_VS, SPRITE_FS);
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
    this.uSpriteViewSizeLoc = gl.getUniformLocation(this.spriteProg, 'uViewSize');
    this.uPaletteRowsLoc = gl.getUniformLocation(this.spriteProg, 'uPaletteRows');
    this.uLightCountLoc = gl.getUniformLocation(this.spriteProg, 'uLightCount');
    this.uLightPosRadLoc = gl.getUniformLocation(this.spriteProg, 'uLightPosRad');
    this.uLightColIntLoc = gl.getUniformLocation(this.spriteProg, 'uLightColInt');
    if (uAtlasLoc) gl.uniform1i(uAtlasLoc, 0);
    if (uIdxLoc) gl.uniform1i(uIdxLoc, 1);
    if (uLutLoc) gl.uniform1i(uLutLoc, 2);

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
    const uBloomTexLoc = gl.getUniformLocation(this.compositeProg, 'uBloomTex');
    this.uCompGlowLoc = gl.getUniformLocation(this.compositeProg, 'uGlowIntensity');
    this.uCompFilterLoc = gl.getUniformLocation(this.compositeProg, 'uFilterMode');
    this.uCompCozyLoc = gl.getUniformLocation(this.compositeProg, 'uCozyFilter');
    this.uCompCamFracLoc = gl.getUniformLocation(this.compositeProg, 'uCamFrac');
    this.uCompViewSizeLoc = gl.getUniformLocation(this.compositeProg, 'uViewSize');
    this.uCompWaterLevelLoc = gl.getUniformLocation(this.compositeProg, 'uWaterLevel');
    this.uCompWaterTintLoc = gl.getUniformLocation(this.compositeProg, 'uWaterTint');
    this.uCompTimeLoc = gl.getUniformLocation(this.compositeProg, 'uTimeSec');
    if (uSceneTexLoc) gl.uniform1i(uSceneTexLoc, 0);
    if (uBloomTexLoc) gl.uniform1i(uBloomTexLoc, 1);

    this.skyVao = gl.createVertexArray()!;
    this.spriteVao = gl.createVertexArray()!;
    this.instanceBuffer = gl.createBuffer()!;
    this.atlasTexture = gl.createTexture()!;
    this.indexAtlasTexture = gl.createTexture()!;
    this.paletteLutTexture = gl.createTexture()!;

    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_INSTANCE * 4;
    for (let loc = 0; loc < 5; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, loc * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    const initNearestTex = (tex: WebGLTexture) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    initNearestTex(this.atlasTexture);
    initNearestTex(this.indexAtlasTexture);
    initNearestTex(this.paletteLutTexture);

    this.uploadAtlas(
      atlasWidth,
      atlasHeight,
      initialPixels,
      initialIndexPixels ?? new Uint8Array(atlasWidth * atlasHeight).fill(255),
      initialPaletteLut ?? new Uint8Array(16 * this.paletteRows * 4).fill(255),
      this.paletteRows,
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

    const sceneTex = createRenderTexture(gl, osW, osH, gl.NEAREST);
    const emissiveTex = createRenderTexture(gl, osW, osH, gl.LINEAR);
    const mrtFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, mrtFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emissiveTex, 0);
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
      sceneTex,
      emissiveTex,
      bloomFboA,
      bloomFboB,
      bloomTexA,
      bloomTexB,
    };
    return this.targets;
  }

  public uploadAtlas(
    width: number,
    height: number,
    pixels: Uint8Array,
    indexPixels?: Uint8Array,
    paletteLut?: Uint8Array,
    paletteRows?: number,
  ): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    if (indexPixels) {
      gl.bindTexture(gl.TEXTURE_2D, this.indexAtlasTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, indexPixels);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }

    if (paletteLut && paletteRows) {
      this.paletteRows = Math.max(1, paletteRows);
      gl.bindTexture(gl.TEXTURE_2D, this.paletteLutTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, this.paletteRows, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteLut);
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

    gl.useProgram(this.spriteProg);
    gl.bindVertexArray(this.spriteVao);
    gl.uniform2f(this.uSpriteViewSizeLoc, vw, vh);
    gl.uniform1f(this.uPaletteRowsLoc, this.paletteRows);
    const safeLights = lightsData ? Math.max(0, Math.min(MAX_DYNAMIC_LIGHTS, lightCount | 0)) : 0;
    gl.uniform1i(this.uLightCountLoc, safeLights);
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
      gl.uniform4fv(this.uLightPosRadLoc, this.lightPosRadData, 0, safeLights * 4);
      gl.uniform4fv(this.uLightColIntLoc, this.lightColIntData, 0, safeLights * 4);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.indexAtlasTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteLutTexture);

    const safeAlpha = Math.min(alphaCount, MAX_INSTANCES_PER_PASS);
    const safeAdd = Math.min(additiveCount, MAX_INSTANCES_PER_PASS);

    if (safeAlpha > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphaItems.subarray(0, safeAlpha * FLOATS_PER_INSTANCE));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, safeAlpha);
      drawCalls++;
    }

    if (safeAdd > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
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
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rt.bloomTexA);
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
    gl.drawArrays(gl.TRIANGLES, 0, 6);
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
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteTexture(this.atlasTexture);
    gl.deleteTexture(this.indexAtlasTexture);
    gl.deleteTexture(this.paletteLutTexture);
    gl.deleteVertexArray(this.skyVao);
    gl.deleteVertexArray(this.spriteVao);
    gl.deleteProgram(this.skyProg);
    gl.deleteProgram(this.spriteProg);
    gl.deleteProgram(this.bloomDownProg);
    gl.deleteProgram(this.bloomBlurProg);
    gl.deleteProgram(this.compositeProg);
  }
}

