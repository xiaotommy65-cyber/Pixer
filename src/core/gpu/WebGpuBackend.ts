import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  GAME_H,
  GAME_W,
  MAX_INSTANCES_PER_PASS,
  OVERSCAN_PAD,
  type IGpuBackend,
  type SkyGradient,
} from './GpuTypes.ts';
import { WGSL_CODE, WGSL_POST_CODE } from './WebGpuShaders.ts';

const DEFAULT_PALETTE_ROWS = 8;
const LUT_ALIGNED_ROW_BYTES = 256;

interface PostRenderTargets {
  w: number;
  h: number;
  viewW: number;
  viewH: number;
  osW: number;
  osH: number;
  bloomW: number;
  bloomH: number;
  sceneTexture: GPUTexture;
  emissiveTexture: GPUTexture;
  bloomTexA: GPUTexture;
  bloomTexB: GPUTexture;
  sceneView: GPUTextureView;
  emissiveView: GPUTextureView;
  bloomViewA: GPUTextureView;
  bloomViewB: GPUTextureView;
  bloomDownBindGroup: GPUBindGroup;
  bloomBlurHBindGroup: GPUBindGroup;
  bloomBlurVBindGroup: GPUBindGroup;
  compositeBindGroup: GPUBindGroup;
}

export class WebGpuBackend implements IGpuBackend {
  public readonly kind = 'webgpu' as const;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private skyPipeline: GPURenderPipeline;
  private alphaPipeline: GPURenderPipeline;
  private addPipeline: GPURenderPipeline;
  private bloomDownPipeline: GPURenderPipeline;
  private bloomBlurPipeline: GPURenderPipeline;
  private compositePipeline: GPURenderPipeline;
  private skyUniformBuffer: GPUBuffer;
  private skyUniformData = new Float32Array(16);
  private alphaBuffer: GPUBuffer;
  private addBuffer: GPUBuffer;
  private atlasTexture: GPUTexture;
  private indexAtlasTexture: GPUTexture;
  private paletteLutTexture: GPUTexture;
  private atlasSampler: GPUSampler;
  private linearSampler: GPUSampler;
  private nearestSampler: GPUSampler;
  private pass1BindGroupLayout: GPUBindGroupLayout;
  private pass1BindGroup: GPUBindGroup;
  private postBindGroupLayout: GPUBindGroupLayout;
  private postDownBuf: GPUBuffer;
  private postBlurHBuf: GPUBuffer;
  private postBlurVBuf: GPUBuffer;
  private postCompBuf: GPUBuffer;
  private postUniformData = new Float32Array(12);
  private renderTargets: PostRenderTargets | null = null;
  private paletteRows = DEFAULT_PALETTE_ROWS;
  private onLostCallback?: () => void;
  private recovered = false;
  private atlasStaging: Uint8Array<ArrayBuffer> | null = null;
  private indexStaging: Uint8Array<ArrayBuffer> | null = null;
  private lutStaging: Uint8Array<ArrayBuffer> | null = null;
  private configuredW = 0;
  private configuredH = 0;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    skyPipeline: GPURenderPipeline,
    alphaPipeline: GPURenderPipeline,
    addPipeline: GPURenderPipeline,
    bloomDownPipeline: GPURenderPipeline,
    bloomBlurPipeline: GPURenderPipeline,
    compositePipeline: GPURenderPipeline,
    skyUniformBuffer: GPUBuffer,
    alphaBuffer: GPUBuffer,
    addBuffer: GPUBuffer,
    atlasTexture: GPUTexture,
    indexAtlasTexture: GPUTexture,
    paletteLutTexture: GPUTexture,
    atlasSampler: GPUSampler,
    linearSampler: GPUSampler,
    nearestSampler: GPUSampler,
    pass1BindGroupLayout: GPUBindGroupLayout,
    pass1BindGroup: GPUBindGroup,
    postBindGroupLayout: GPUBindGroupLayout,
    postDownBuf: GPUBuffer,
    postBlurHBuf: GPUBuffer,
    postBlurVBuf: GPUBuffer,
    postCompBuf: GPUBuffer,
    paletteRows: number,
    onLost?: () => void,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.skyPipeline = skyPipeline;
    this.alphaPipeline = alphaPipeline;
    this.addPipeline = addPipeline;
    this.bloomDownPipeline = bloomDownPipeline;
    this.bloomBlurPipeline = bloomBlurPipeline;
    this.compositePipeline = compositePipeline;
    this.skyUniformBuffer = skyUniformBuffer;
    this.alphaBuffer = alphaBuffer;
    this.addBuffer = addBuffer;
    this.atlasTexture = atlasTexture;
    this.indexAtlasTexture = indexAtlasTexture;
    this.paletteLutTexture = paletteLutTexture;
    this.atlasSampler = atlasSampler;
    this.linearSampler = linearSampler;
    this.nearestSampler = nearestSampler;
    this.pass1BindGroupLayout = pass1BindGroupLayout;
    this.pass1BindGroup = pass1BindGroup;
    this.postBindGroupLayout = postBindGroupLayout;
    this.postDownBuf = postDownBuf;
    this.postBlurHBuf = postBlurHBuf;
    this.postBlurVBuf = postBlurVBuf;
    this.postCompBuf = postCompBuf;
    this.paletteRows = paletteRows;
    this.onLostCallback = onLost;

    void device.lost.then((info) => {
      if (!this.recovered) {
        this.recovered = true;
        appLogger.warn('gpu', 'webgpu.deviceLost', 'WebGPU 裝置已中斷，觸發降級機制', undefined, {
          reason: info?.reason ?? 'unknown',
          message: info?.message ?? '',
        });
        this.onLostCallback?.();
      }
    });
  }

  private static writePaddedIndexTexture(
    device: GPUDevice,
    texture: GPUTexture,
    width: number,
    height: number,
    indexPixels: Uint8Array,
    staging?: Uint8Array<ArrayBuffer> | null,
  ): Uint8Array<ArrayBuffer> {
    const alignedRow = Math.ceil(width / 256) * 256;
    const total = alignedRow * height;
    const buf = staging && staging.byteLength === total ? staging : new Uint8Array(total);
    if (alignedRow === width) {
      buf.set(indexPixels);
    } else {
      for (let y = 0; y < height; y++) {
        buf.set(indexPixels.subarray(y * width, (y + 1) * width), y * alignedRow);
      }
    }
    device.queue.writeTexture(
      { texture },
      buf,
      { bytesPerRow: alignedRow, rowsPerImage: height },
      { width, height },
    );
    return buf;
  }

  private static writePaddedLutTexture(
    device: GPUDevice,
    texture: GPUTexture,
    rows: number,
    paletteLut: Uint8Array,
    staging?: Uint8Array<ArrayBuffer> | null,
  ): Uint8Array<ArrayBuffer> {
    const total = LUT_ALIGNED_ROW_BYTES * rows;
    const buf = staging && staging.byteLength === total ? staging : new Uint8Array(total);
    buf.fill(0);
    for (let r = 0; r < rows; r++) {
      const srcOff = r * 64;
      if (srcOff + 64 <= paletteLut.byteLength) {
        buf.set(paletteLut.subarray(srcOff, srcOff + 64), r * LUT_ALIGNED_ROW_BYTES);
      }
    }
    device.queue.writeTexture(
      { texture },
      buf,
      { bytesPerRow: LUT_ALIGNED_ROW_BYTES, rowsPerImage: rows },
      { width: 16, height: rows },
    );
    return buf;
  }

  public static async tryCreate(
    canvas: HTMLCanvasElement,
    atlasWidth: number,
    atlasHeight: number,
    initialPixels: Uint8Array,
    onLost?: () => void,
    initialIndexPixels?: Uint8Array,
    initialPaletteLut?: Uint8Array,
    initialPaletteRows = DEFAULT_PALETTE_ROWS,
  ): Promise<WebGpuBackend | null> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    try {
      const adapter =
        (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
        (await navigator.gpu.requestAdapter());
      if (!adapter) {
        appLogger.info('gpu', 'webgpu.requestAdapter', '無可用 WebGPU Adapter，將降級至 WebGL2');
        return null;
      }
      const device = await adapter.requestDevice();
      const format = navigator.gpu.getPreferredCanvasFormat();

      device.pushErrorScope('validation');
      const sceneModule = device.createShaderModule({ code: WGSL_CODE });
      const postModule = device.createShaderModule({ code: WGSL_POST_CODE });
      const [sceneInfo, postInfo] = await Promise.all([
        sceneModule.getCompilationInfo(),
        postModule.getCompilationInfo(),
      ]);
      const allMsgs = [...sceneInfo.messages, ...postInfo.messages];
      if (allMsgs.some((m) => m.type === 'error')) {
        const firstErr = allMsgs.find((m) => m.type === 'error');
        appLogger.error(
          'gpu',
          'webgpu.compileShader',
          'WGSL 著色器編譯失敗，已退回 WebGL2',
          new Error(firstErr?.message ?? 'WGSL error'),
        );
        await device.popErrorScope();
        device.destroy();
        return null;
      }

      const atlasTexture = device.createTexture({
        size: [atlasWidth, atlasHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const rgbaCopy = new Uint8Array(initialPixels);
      device.queue.writeTexture(
        { texture: atlasTexture },
        rgbaCopy,
        { bytesPerRow: atlasWidth * 4, rowsPerImage: atlasHeight },
        { width: atlasWidth, height: atlasHeight },
      );

      const indexAtlasTexture = device.createTexture({
        size: [atlasWidth, atlasHeight, 1],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const idxInit = initialIndexPixels ?? new Uint8Array(atlasWidth * atlasHeight).fill(255);
      WebGpuBackend.writePaddedIndexTexture(device, indexAtlasTexture, atlasWidth, atlasHeight, idxInit);

      const safeRows = Math.max(1, initialPaletteRows);
      const paletteLutTexture = device.createTexture({
        size: [16, safeRows, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const lutInit = initialPaletteLut ?? new Uint8Array(16 * safeRows * 4).fill(255);
      WebGpuBackend.writePaddedLutTexture(device, paletteLutTexture, safeRows, lutInit);

      const atlasSampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      const linearSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      const nearestSampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      const skyUniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const makePostBuf = () =>
        device.createBuffer({
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      const postDownBuf = makePostBuf();
      const postBlurHBuf = makePostBuf();
      const postBlurVBuf = makePostBuf();
      const postCompBuf = makePostBuf();

      const instanceBytes = MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE * 4;
      const alphaBuffer = device.createBuffer({
        size: instanceBytes,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      const addBuffer = device.createBuffer({
        size: instanceBytes,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });

      const pass1BindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      });
      const pass1BindGroup = device.createBindGroup({
        layout: pass1BindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: skyUniformBuffer } },
          { binding: 1, resource: atlasTexture.createView() },
          { binding: 2, resource: atlasSampler },
          { binding: 3, resource: indexAtlasTexture.createView() },
          { binding: 4, resource: paletteLutTexture.createView() },
        ],
      });

      const postBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
      });

      const pass1PipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [pass1BindGroupLayout],
      });
      const postPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [postBindGroupLayout],
      });

      const instanceLayout: GPUVertexBufferLayout = {
        arrayStride: FLOATS_PER_INSTANCE * 4,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' },
          { shaderLocation: 1, offset: 16, format: 'float32x4' },
          { shaderLocation: 2, offset: 32, format: 'float32x4' },
          { shaderLocation: 3, offset: 48, format: 'float32x4' },
          { shaderLocation: 4, offset: 64, format: 'float32x4' },
        ],
      };

      const mrtFormat: GPUTextureFormat = 'rgba8unorm';
      const alphaBlend: GPUBlendState = {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
      const addBlend: GPUBlendState = {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      };

      const [
        skyPipeline,
        alphaPipeline,
        addPipeline,
        bloomDownPipeline,
        bloomBlurPipeline,
        compositePipeline,
      ] = await Promise.all([
        device.createRenderPipelineAsync({
          layout: pass1PipelineLayout,
          vertex: { module: sceneModule, entryPoint: 'vsSky' },
          fragment: { module: sceneModule, entryPoint: 'fsSky', targets: [{ format: mrtFormat }, { format: mrtFormat }] },
        }),
        device.createRenderPipelineAsync({
          layout: pass1PipelineLayout,
          vertex: { module: sceneModule, entryPoint: 'vsSprite', buffers: [instanceLayout] },
          fragment: {
            module: sceneModule,
            entryPoint: 'fsSprite',
            targets: [
              { format: mrtFormat, blend: alphaBlend },
              { format: mrtFormat, blend: alphaBlend },
            ],
          },
        }),
        device.createRenderPipelineAsync({
          layout: pass1PipelineLayout,
          vertex: { module: sceneModule, entryPoint: 'vsSprite', buffers: [instanceLayout] },
          fragment: {
            module: sceneModule,
            entryPoint: 'fsSprite',
            targets: [
              { format: mrtFormat, blend: addBlend },
              { format: mrtFormat, blend: addBlend },
            ],
          },
        }),
        device.createRenderPipelineAsync({
          layout: postPipelineLayout,
          vertex: { module: postModule, entryPoint: 'vsPost' },
          fragment: { module: postModule, entryPoint: 'fsBloomDown', targets: [{ format: mrtFormat }] },
        }),
        device.createRenderPipelineAsync({
          layout: postPipelineLayout,
          vertex: { module: postModule, entryPoint: 'vsPost' },
          fragment: { module: postModule, entryPoint: 'fsBloomBlur', targets: [{ format: mrtFormat }] },
        }),
        device.createRenderPipelineAsync({
          layout: postPipelineLayout,
          vertex: { module: postModule, entryPoint: 'vsPost' },
          fragment: { module: postModule, entryPoint: 'fsComposite', targets: [{ format }] },
        }),
      ]);

      const validationErr = await device.popErrorScope();
      if (validationErr) {
        appLogger.warn('gpu', 'webgpu.validationScope', 'WebGPU Pipeline 驗證失敗，退回 WebGL2', validationErr);
        device.destroy();
        return null;
      }

      const context = canvas.getContext('webgpu');
      if (!context) {
        appLogger.warn('gpu', 'webgpu.getContext', '無法取得 Canvas WebGPU Context，退回 WebGL2');
        device.destroy();
        return null;
      }
      context.configure({ device, format, alphaMode: 'opaque' });

      const backend = new WebGpuBackend(
        device,
        context,
        format,
        skyPipeline,
        alphaPipeline,
        addPipeline,
        bloomDownPipeline,
        bloomBlurPipeline,
        compositePipeline,
        skyUniformBuffer,
        alphaBuffer,
        addBuffer,
        atlasTexture,
        indexAtlasTexture,
        paletteLutTexture,
        atlasSampler,
        linearSampler,
        nearestSampler,
        pass1BindGroupLayout,
        pass1BindGroup,
        postBindGroupLayout,
        postDownBuf,
        postBlurHBuf,
        postBlurVBuf,
        postCompBuf,
        safeRows,
        onLost,
      );
      device.addEventListener('uncapturederror', (ev) => {
        if (!backend.recovered) {
          backend.recovered = true;
          appLogger.error('gpu', 'webgpu.uncapturedError', 'WebGPU 發生未攔截的驅動錯誤，自動切換後端', ev.error);
          backend.onLostCallback?.();
        }
      });
      return backend;
    } catch (err) {
      appLogger.warn('gpu', 'webgpu.tryCreate', 'WebGPU 初始化異常，自動改用 WebGL2 / Canvas 2D', err);
      return null;
    }
  }

  private destroyRenderTargets(): void {
    if (!this.renderTargets) return;
    this.renderTargets.sceneTexture.destroy();
    this.renderTargets.emissiveTexture.destroy();
    this.renderTargets.bloomTexA.destroy();
    this.renderTargets.bloomTexB.destroy();
    this.renderTargets = null;
  }

  private ensureRenderTargets(w: number, h: number, viewW = GAME_W, viewH = GAME_H): PostRenderTargets {
    if (
      this.renderTargets &&
      this.renderTargets.w === w &&
      this.renderTargets.h === h &&
      this.renderTargets.viewW === viewW &&
      this.renderTargets.viewH === viewH
    ) {
      return this.renderTargets;
    }
    this.destroyRenderTargets();

    const osViewW = viewW + OVERSCAN_PAD * 2;
    const osViewH = viewH + OVERSCAN_PAD * 2;
    const osW = Math.max(1, Math.round((w * osViewW) / viewW));
    const osH = Math.max(1, Math.round((h * osViewH) / viewH));
    const bloomW = Math.max(1, Math.floor(osW / 4));
    const bloomH = Math.max(1, Math.floor(osH / 4));
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

    const sceneTexture = this.device.createTexture({ size: [osW, osH, 1], format: 'rgba8unorm', usage });
    const emissiveTexture = this.device.createTexture({ size: [osW, osH, 1], format: 'rgba8unorm', usage });
    const bloomTexA = this.device.createTexture({ size: [bloomW, bloomH, 1], format: 'rgba8unorm', usage });
    const bloomTexB = this.device.createTexture({ size: [bloomW, bloomH, 1], format: 'rgba8unorm', usage });

    const sceneView = sceneTexture.createView();
    const emissiveView = emissiveTexture.createView();
    const bloomViewA = bloomTexA.createView();
    const bloomViewB = bloomTexB.createView();

    const mkPostBind = (buf: GPUBuffer, viewA: GPUTextureView, viewB: GPUTextureView) =>
      this.device.createBindGroup({
        layout: this.postBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: viewA },
          { binding: 2, resource: viewB },
          { binding: 3, resource: this.linearSampler },
          { binding: 4, resource: this.nearestSampler },
        ],
      });

    this.renderTargets = {
      w,
      h,
      viewW,
      viewH,
      osW,
      osH,
      bloomW,
      bloomH,
      sceneTexture,
      emissiveTexture,
      bloomTexA,
      bloomTexB,
      sceneView,
      emissiveView,
      bloomViewA,
      bloomViewB,
      bloomDownBindGroup: mkPostBind(this.postDownBuf, emissiveView, bloomViewB),
      bloomBlurHBindGroup: mkPostBind(this.postBlurHBuf, bloomViewA, bloomViewB),
      bloomBlurVBindGroup: mkPostBind(this.postBlurVBuf, bloomViewB, bloomViewA),
      compositeBindGroup: mkPostBind(this.postCompBuf, sceneView, bloomViewA),
    };
    return this.renderTargets;
  }

  public uploadAtlas(
    width: number,
    height: number,
    pixels: Uint8Array,
    indexPixels?: Uint8Array,
    paletteLut?: Uint8Array,
    paletteRows?: number,
  ): void {
    if (!this.atlasStaging || this.atlasStaging.byteLength !== pixels.byteLength) {
      this.atlasStaging = new Uint8Array(pixels.byteLength);
    }
    this.atlasStaging.set(pixels);
    this.device.queue.writeTexture(
      { texture: this.atlasTexture },
      this.atlasStaging,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height },
    );

    if (indexPixels) {
      this.indexStaging = WebGpuBackend.writePaddedIndexTexture(
        this.device,
        this.indexAtlasTexture,
        width,
        height,
        indexPixels,
        this.indexStaging,
      );
    }

    if (paletteLut && paletteRows) {
      if (paletteRows !== this.paletteRows) {
        this.paletteRows = paletteRows;
        this.paletteLutTexture.destroy();
        this.paletteLutTexture = this.device.createTexture({
          size: [16, paletteRows, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.pass1BindGroup = this.device.createBindGroup({
          layout: this.pass1BindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.skyUniformBuffer } },
            { binding: 1, resource: this.atlasTexture.createView() },
            { binding: 2, resource: this.atlasSampler },
            { binding: 3, resource: this.indexAtlasTexture.createView() },
            { binding: 4, resource: this.paletteLutTexture.createView() },
          ],
        });
      }
      this.lutStaging = WebGpuBackend.writePaddedLutTexture(
        this.device,
        this.paletteLutTexture,
        paletteRows,
        paletteLut,
        this.lutStaging,
      );
    }
  }

  public resize(pixelWidth: number, pixelHeight: number): void {
    if (this.configuredW === pixelWidth && this.configuredH === pixelHeight) return;
    this.configuredW = pixelWidth;
    this.configuredH = pixelHeight;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });
  }

  public renderFrame(
    sky: SkyGradient,
    alphaItems: Float32Array,
    alphaCount: number,
    additiveItems: Float32Array,
    additiveCount: number,
    timeSec: number,
  ): number {
    let swapTex: GPUTexture;
    try {
      swapTex = this.context.getCurrentTexture();
    } catch {
      if (!this.recovered) {
        this.recovered = true;
        this.onLostCallback?.();
      }
      return 0;
    }

    const viewW = Math.max(1, sky.viewW ?? GAME_W);
    const viewH = Math.max(1, sky.viewH ?? GAME_H);
    const rtW = Math.max(1, swapTex.width);
    const rtH = Math.max(1, swapTex.height);
    const rt = this.ensureRenderTargets(rtW, rtH, viewW, viewH);
    const view = swapTex.createView();

    this.skyUniformData[0] = sky.top[0];
    this.skyUniformData[1] = sky.top[1];
    this.skyUniformData[2] = sky.top[2];
    this.skyUniformData[3] = 1;
    this.skyUniformData[4] = sky.bottom[0];
    this.skyUniformData[5] = sky.bottom[1];
    this.skyUniformData[6] = sky.bottom[2];
    this.skyUniformData[7] = 1;
    this.skyUniformData[8] = timeSec;
    this.skyUniformData[9] = sky.cozyFilter ? 1 : 0;
    this.skyUniformData[10] = viewW;
    this.skyUniformData[11] = viewH;
    this.skyUniformData[12] = this.paletteRows;
    this.device.queue.writeBuffer(this.skyUniformBuffer, 0, this.skyUniformData);

    const safeAlpha = Math.min(alphaCount, MAX_INSTANCES_PER_PASS);
    const safeAdd = Math.min(additiveCount, MAX_INSTANCES_PER_PASS);

    if (safeAlpha > 0) {
      this.device.queue.writeBuffer(
        this.alphaBuffer,
        0,
        alphaItems.buffer,
        alphaItems.byteOffset,
        safeAlpha * FLOATS_PER_INSTANCE * 4,
      );
    }
    if (safeAdd > 0) {
      this.device.queue.writeBuffer(
        this.addBuffer,
        0,
        additiveItems.buffer,
        additiveItems.byteOffset,
        safeAdd * FLOATS_PER_INSTANCE * 4,
      );
    }

    const doBloom = sky.glowIntensity > 0.01;
    this.postUniformData[8] = viewW;
    this.postUniformData[9] = viewH;
    this.postUniformData[10] = viewW + OVERSCAN_PAD * 2;
    this.postUniformData[11] = viewH + OVERSCAN_PAD * 2;
    if (doBloom) {
      this.postUniformData[0] = 1 / rt.osW;
      this.postUniformData[1] = 1 / rt.osH;
      this.postUniformData[2] = sky.glowIntensity;
      this.postUniformData[3] = sky.filterMode;
      this.postUniformData[4] = timeSec;
      this.postUniformData[5] = sky.cozyFilter ? 1 : 0;
      this.postUniformData[6] = 0;
      this.postUniformData[7] = 0;
      this.device.queue.writeBuffer(this.postDownBuf, 0, this.postUniformData);

      this.postUniformData[0] = 1.25 / rt.bloomW;
      this.postUniformData[1] = 0;
      this.device.queue.writeBuffer(this.postBlurHBuf, 0, this.postUniformData);

      this.postUniformData[0] = 0;
      this.postUniformData[1] = 1.25 / rt.bloomH;
      this.device.queue.writeBuffer(this.postBlurVBuf, 0, this.postUniformData);
    }

    this.postUniformData[0] = 1 / rt.osW;
    this.postUniformData[1] = 1 / rt.osH;
    this.postUniformData[2] = sky.glowIntensity;
    this.postUniformData[3] = sky.filterMode;
    this.postUniformData[4] = timeSec;
    this.postUniformData[5] = sky.cozyFilter ? 1 : 0;
    this.postUniformData[6] = sky.camFracX ?? 0;
    this.postUniformData[7] = sky.camFracY ?? 0;
    this.device.queue.writeBuffer(this.postCompBuf, 0, this.postUniformData);

    const encoder = this.device.createCommandEncoder();

    // Pass 1: MRT Scene Color + Emissive Mask
    const pass1 = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: rt.sceneView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: sky.top[0], g: sky.top[1], b: sky.top[2], a: 1 },
        },
        {
          view: rt.emissiveView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });

    let drawCalls = 1;
    pass1.setBindGroup(0, this.pass1BindGroup);
    pass1.setPipeline(this.skyPipeline);
    pass1.draw(6);

    if (safeAlpha > 0) {
      pass1.setPipeline(this.alphaPipeline);
      pass1.setVertexBuffer(0, this.alphaBuffer);
      pass1.draw(6, safeAlpha);
      drawCalls++;
    }

    if (safeAdd > 0) {
      pass1.setPipeline(this.addPipeline);
      pass1.setVertexBuffer(0, this.addBuffer);
      pass1.draw(6, safeAdd);
      drawCalls++;
    }
    pass1.end();

    // Pass 2: 1/4-res Emissive Downsample + Separable H/V Gaussian Blur
    if (doBloom) {
      const pDown = encoder.beginRenderPass({
        colorAttachments: [
          { view: rt.bloomViewA, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      pDown.setBindGroup(0, rt.bloomDownBindGroup);
      pDown.setPipeline(this.bloomDownPipeline);
      pDown.draw(6);
      pDown.end();

      const pBlurH = encoder.beginRenderPass({
        colorAttachments: [
          { view: rt.bloomViewB, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      pBlurH.setBindGroup(0, rt.bloomBlurHBindGroup);
      pBlurH.setPipeline(this.bloomBlurPipeline);
      pBlurH.draw(6);
      pBlurH.end();

      const pBlurV = encoder.beginRenderPass({
        colorAttachments: [
          { view: rt.bloomViewA, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      pBlurV.setBindGroup(0, rt.bloomBlurVBindGroup);
      pBlurV.setPipeline(this.bloomBlurPipeline);
      pBlurV.draw(6);
      pBlurV.end();
      drawCalls += 3;
    }

    // Pass 3: Crisp Pixel Upscale + Bloom Composite + Clean/LCD/CRT Post
    const pComp = encoder.beginRenderPass({
      colorAttachments: [
        { view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pComp.setBindGroup(0, rt.compositeBindGroup);
    pComp.setPipeline(this.compositePipeline);
    pComp.draw(6);
    pComp.end();
    drawCalls++;

    this.device.queue.submit([encoder.finish()]);
    return drawCalls;
  }

  public dispose(): void {
    this.destroyRenderTargets();
    this.alphaBuffer.destroy();
    this.addBuffer.destroy();
    this.skyUniformBuffer.destroy();
    this.postDownBuf.destroy();
    this.postBlurHBuf.destroy();
    this.postBlurVBuf.destroy();
    this.postCompBuf.destroy();
    this.atlasTexture.destroy();
    this.indexAtlasTexture.destroy();
    this.paletteLutTexture.destroy();
    this.device.destroy();
  }
}

