import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  MAX_INSTANCES_PER_PASS,
  type IGpuBackend,
  type SkyGradient,
} from './GpuTypes.ts';
import { SKY_FS, SKY_VS, SPRITE_FS, SPRITE_VS } from './WebGl2Shaders.ts';

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

export class WebGl2Backend implements IGpuBackend {
  public readonly kind = 'webgl2' as const;

  private gl: WebGL2RenderingContext;
  private skyProg: WebGLProgram;
  private spriteProg: WebGLProgram;
  private skyVao: WebGLVertexArrayObject;
  private spriteVao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private atlasTexture: WebGLTexture;
  private uTopLoc: WebGLUniformLocation | null;
  private uBottomLoc: WebGLUniformLocation | null;
  private uCozyLoc: WebGLUniformLocation | null;
  private uTimeLoc: WebGLUniformLocation | null;
  private onLostListener?: (e: Event) => void;
  private canvasEl: HTMLCanvasElement;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    atlasWidth: number,
    atlasHeight: number,
    initialPixels: Uint8Array,
    onLost?: () => void,
  ) {
    this.canvasEl = canvas;
    this.gl = gl;
    this.skyProg = linkProgram(gl, SKY_VS, SKY_FS);
    this.spriteProg = linkProgram(gl, SPRITE_VS, SPRITE_FS);

    this.uTopLoc = gl.getUniformLocation(this.skyProg, 'uTopColor');
    this.uBottomLoc = gl.getUniformLocation(this.skyProg, 'uBottomColor');
    this.uCozyLoc = gl.getUniformLocation(this.skyProg, 'uCozyFilter');
    this.uTimeLoc = gl.getUniformLocation(this.skyProg, 'uTimeSec');

    gl.useProgram(this.spriteProg);
    const uAtlasLoc = gl.getUniformLocation(this.spriteProg, 'uAtlas');
    if (uAtlasLoc) gl.uniform1i(uAtlasLoc, 0);

    this.skyVao = gl.createVertexArray()!;
    this.spriteVao = gl.createVertexArray()!;
    this.instanceBuffer = gl.createBuffer()!;
    this.atlasTexture = gl.createTexture()!;

    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_INSTANCE * 4;
    for (let loc = 0; loc < 4; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, loc * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadAtlas(atlasWidth, atlasHeight, initialPixels);

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
  ): WebGl2Backend | null {
    try {
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl || gl.isContextLost()) {
        appLogger.warn('gpu', 'webgl2.tryCreate', 'WebGL2 Context 不可用或已遺失，改用 Canvas 2D');
        return null;
      }
      return new WebGl2Backend(canvas, gl, atlasWidth, atlasHeight, initialPixels, onLost);
    } catch (err) {
      appLogger.warn('gpu', 'webgl2.tryCreate', 'WebGL2 初始化發生例外，退回 Canvas 2D', err);
      return null;
    }
  }

  public uploadAtlas(width: number, height: number, pixels: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }

  public resize(_pixelWidth: number, _pixelHeight: number): void {
    // Viewport updated cleanly each frame via canvas dimensions
  }

  public renderFrame(
    sky: SkyGradient,
    alphaItems: Float32Array,
    alphaCount: number,
    additiveItems: Float32Array,
    additiveCount: number,
    timeSec: number,
  ): number {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    let drawCalls = 1;
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg);
    gl.bindVertexArray(this.skyVao);
    gl.uniform3f(this.uTopLoc, sky.top[0], sky.top[1], sky.top[2]);
    gl.uniform3f(this.uBottomLoc, sky.bottom[0], sky.bottom[1], sky.bottom[2]);
    gl.uniform1f(this.uCozyLoc, sky.cozyFilter ? 1 : 0);
    gl.uniform1f(this.uTimeLoc, timeSec);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.useProgram(this.spriteProg);
    gl.bindVertexArray(this.spriteVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);

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

    return drawCalls;
  }

  public dispose(): void {
    if (this.onLostListener) {
      this.canvasEl.removeEventListener('webglcontextlost', this.onLostListener);
      this.onLostListener = undefined;
    }
    const gl = this.gl;
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteTexture(this.atlasTexture);
    gl.deleteVertexArray(this.skyVao);
    gl.deleteVertexArray(this.spriteVao);
    gl.deleteProgram(this.skyProg);
    gl.deleteProgram(this.spriteProg);
  }
}
