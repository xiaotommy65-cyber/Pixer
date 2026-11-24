import {
  buildCamera3DViewProjMatrix,
  computeCamera3D,
  createComputedCamera3D,
} from '../math/Perspective3DMath.ts';
import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  FLOATS_PER_QUAD3D,
  GAME_H,
  GAME_W,
  MAX_ATLAS_PAGES,
  MAX_DYNAMIC_LIGHTS,
  MAX_INSTANCES_PER_PASS,
  MAX_QUAD3D_INSTANCES,
  OCCLUSION_GRID_MAX,
  OVERSCAN_PAD,
  type AtlasPageData,
  type GpuOcclusionState,
  type IGpuBackend,
  type Quad3DPassData,
  type SkyGradient,
} from './GpuTypes.ts';
import { WGSL_CODE, WGSL_POST_CODE } from './WebGpuShaders.ts';

const MAX_QUAD3D_BLEND_INSTANCES = 4096;

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
  depthTexture: GPUTexture;
  bloomTexA: GPUTexture;
  bloomTexB: GPUTexture;
  sceneView: GPUTextureView;
  emissiveView: GPUTextureView;
  depthView: GPUTextureView;
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
  private sky3dPipeline: GPURenderPipeline;
  private alphaPipeline: GPURenderPipeline;
  private addPipeline: GPURenderPipeline;
  private quad3dOpaquePipeline: GPURenderPipeline;
  private quad3dAlphaPipeline: GPURenderPipeline;
  private quad3dAddPipeline: GPURenderPipeline;
  private bloomDownPipeline: GPURenderPipeline;
  private bloomBlurPipeline: GPURenderPipeline;
  private compositePipeline: GPURenderPipeline;
  private skyUniformBuffer: GPUBuffer;
  private skyUniformData = new Float32Array(16);
  private lightUniformBuffer: GPUBuffer;
  private overlayLightUniformBuffer: GPUBuffer;
  private lightUniformData = new Float32Array(200);
  private quad3dOpaqueUniBuf: GPUBuffer;
  private quad3dBlendUniBuf: GPUBuffer;
  private quad3dOpaqueBindGroup: GPUBindGroup;
  private quad3dBlendBindGroup: GPUBindGroup;
  private quad3dUniformData = new Float32Array(24);
  private readonly cam3dScratch = createComputedCamera3D();
  private readonly viewProj3d = new Float32Array(16);
  private alphaBuffer: GPUBuffer;
  private addBuffer: GPUBuffer;
  private quad3dOpaqueBuffer: GPUBuffer;
  private quad3dAlphaBuffer: GPUBuffer;
  private quad3dAddBuffer: GPUBuffer;
  private atlasTexture: GPUTexture;
  private indexAtlasTexture: GPUTexture;
  private paletteLutTexture: GPUTexture;
  private occlusionTexture: GPUTexture;
  private atlasSampler: GPUSampler;
  private linearSampler: GPUSampler;
  private nearestSampler: GPUSampler;
  private pass1BindGroupLayout: GPUBindGroupLayout;
  private pass1BindGroup: GPUBindGroup;
  private pass1OverlayBindGroup: GPUBindGroup;
  private postBindGroupLayout: GPUBindGroupLayout;
  private postDownBuf: GPUBuffer;
  private postBlurHBuf: GPUBuffer;
  private postBlurVBuf: GPUBuffer;
  private postCompBuf: GPUBuffer;
  private postUniformData = new Float32Array(20);
  private renderTargets: PostRenderTargets | null = null;
  private paletteRows = DEFAULT_PALETTE_ROWS;
  private atlasLayerCount = 1;
  private atlasW = 1024;
  private atlasH = 1024;
  private onLostCallback?: () => void;
  private uncapturedErrorListener?: (ev: GPUUncapturedErrorEvent) => void;
  private recovered = false;
  private atlasStaging: Uint8Array<ArrayBuffer> | null = null;
  private indexStaging: Uint8Array<ArrayBuffer> | null = null;
  private lutStaging: Uint8Array<ArrayBuffer> | null = null;
  private readonly occStaging = new Uint8Array(256 * OCCLUSION_GRID_MAX);
  private lastOcclusionVersion = -1;
  private configuredW = 0;
  private configuredH = 0;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    skyPipeline: GPURenderPipeline,
    sky3dPipeline: GPURenderPipeline,
    alphaPipeline: GPURenderPipeline,
    addPipeline: GPURenderPipeline,
    quad3dOpaquePipeline: GPURenderPipeline,
    quad3dAlphaPipeline: GPURenderPipeline,
    quad3dAddPipeline: GPURenderPipeline,
    bloomDownPipeline: GPURenderPipeline,
    bloomBlurPipeline: GPURenderPipeline,
    compositePipeline: GPURenderPipeline,
    skyUniformBuffer: GPUBuffer,
    lightUniformBuffer: GPUBuffer,
    overlayLightUniformBuffer: GPUBuffer,
    quad3dOpaqueUniBuf: GPUBuffer,
    quad3dBlendUniBuf: GPUBuffer,
    quad3dOpaqueBindGroup: GPUBindGroup,
    quad3dBlendBindGroup: GPUBindGroup,
    alphaBuffer: GPUBuffer,
    addBuffer: GPUBuffer,
    quad3dOpaqueBuffer: GPUBuffer,
    quad3dAlphaBuffer: GPUBuffer,
    quad3dAddBuffer: GPUBuffer,
    atlasTexture: GPUTexture,
    indexAtlasTexture: GPUTexture,
    paletteLutTexture: GPUTexture,
    occlusionTexture: GPUTexture,
    atlasSampler: GPUSampler,
    linearSampler: GPUSampler,
    nearestSampler: GPUSampler,
    pass1BindGroupLayout: GPUBindGroupLayout,
    pass1BindGroup: GPUBindGroup,
    pass1OverlayBindGroup: GPUBindGroup,
    postBindGroupLayout: GPUBindGroupLayout,
    postDownBuf: GPUBuffer,
    postBlurHBuf: GPUBuffer,
    postBlurVBuf: GPUBuffer,
    postCompBuf: GPUBuffer,
    paletteRows: number,
    atlasLayerCount: number,
    atlasW: number,
    atlasH: number,
    onLost?: () => void,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.skyPipeline = skyPipeline;
    this.sky3dPipeline = sky3dPipeline;
    this.alphaPipeline = alphaPipeline;
    this.addPipeline = addPipeline;
    this.quad3dOpaquePipeline = quad3dOpaquePipeline;
    this.quad3dAlphaPipeline = quad3dAlphaPipeline;
    this.quad3dAddPipeline = quad3dAddPipeline;
    this.bloomDownPipeline = bloomDownPipeline;
    this.bloomBlurPipeline = bloomBlurPipeline;
    this.compositePipeline = compositePipeline;
    this.skyUniformBuffer = skyUniformBuffer;
    this.lightUniformBuffer = lightUniformBuffer;
    this.overlayLightUniformBuffer = overlayLightUniformBuffer;
    this.quad3dOpaqueUniBuf = quad3dOpaqueUniBuf;
    this.quad3dBlendUniBuf = quad3dBlendUniBuf;
    this.quad3dOpaqueBindGroup = quad3dOpaqueBindGroup;
    this.quad3dBlendBindGroup = quad3dBlendBindGroup;
    this.alphaBuffer = alphaBuffer;
    this.addBuffer = addBuffer;
    this.quad3dOpaqueBuffer = quad3dOpaqueBuffer;
    this.quad3dAlphaBuffer = quad3dAlphaBuffer;
    this.quad3dAddBuffer = quad3dAddBuffer;
    this.atlasTexture = atlasTexture;
    this.indexAtlasTexture = indexAtlasTexture;
    this.paletteLutTexture = paletteLutTexture;
    this.occlusionTexture = occlusionTexture;
    this.atlasSampler = atlasSampler;
    this.linearSampler = linearSampler;
    this.nearestSampler = nearestSampler;
    this.pass1BindGroupLayout = pass1BindGroupLayout;
    this.pass1BindGroup = pass1BindGroup;
    this.pass1OverlayBindGroup = pass1OverlayBindGroup;
    this.postBindGroupLayout = postBindGroupLayout;
    this.postDownBuf = postDownBuf;
    this.postBlurHBuf = postBlurHBuf;
    this.postBlurVBuf = postBlurVBuf;
    this.postCompBuf = postCompBuf;
    this.paletteRows = paletteRows;
    this.atlasLayerCount = atlasLayerCount;
    this.atlasW = atlasW;
    this.atlasH = atlasH;
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
    layer = 0,
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
      { texture, origin: { x: 0, y: 0, z: layer } },
      buf,
      { bytesPerRow: alignedRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    return buf;
  }

  private static buildPass1BindGroup(
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    skyUniformBuffer: GPUBuffer,
    atlasTexture: GPUTexture,
    atlasSampler: GPUSampler,
    indexAtlasTexture: GPUTexture,
    paletteLutTexture: GPUTexture,
    lightBuffer: GPUBuffer,
    occlusionTexture: GPUTexture,
    layerCount: number,
  ): GPUBindGroup {
    return device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: skyUniformBuffer } },
        { binding: 1, resource: atlasTexture.createView({ dimension: '2d-array', arrayLayerCount: layerCount }) },
        { binding: 2, resource: atlasSampler },
        { binding: 3, resource: indexAtlasTexture.createView({ dimension: '2d-array', arrayLayerCount: layerCount }) },
        { binding: 4, resource: paletteLutTexture.createView() },
        { binding: 5, resource: { buffer: lightBuffer } },
        { binding: 6, resource: occlusionTexture.createView() },
      ],
    });
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
    initialExtraPages?: readonly AtlasPageData[],
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

      const extraCount = initialExtraPages ? Math.min(MAX_ATLAS_PAGES - 1, initialExtraPages.length) : 0;
      const layerCount = 1 + extraCount;

      const atlasTexture = device.createTexture({
        size: [atlasWidth, atlasHeight, layerCount],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const rgbaCopy = new Uint8Array(initialPixels);
      device.queue.writeTexture(
        { texture: atlasTexture, origin: { x: 0, y: 0, z: 0 } },
        rgbaCopy,
        { bytesPerRow: atlasWidth * 4, rowsPerImage: atlasHeight },
        { width: atlasWidth, height: atlasHeight, depthOrArrayLayers: 1 },
      );
      if (initialExtraPages) {
        for (let i = 0; i < extraCount; i++) {
          const extraCopy = new Uint8Array(initialExtraPages[i].pixels);
          device.queue.writeTexture(
            { texture: atlasTexture, origin: { x: 0, y: 0, z: i + 1 } },
            extraCopy,
            { bytesPerRow: atlasWidth * 4, rowsPerImage: atlasHeight },
            { width: atlasWidth, height: atlasHeight, depthOrArrayLayers: 1 },
          );
        }
      }

      const indexAtlasTexture = device.createTexture({
        size: [atlasWidth, atlasHeight, layerCount],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const idxInit = initialIndexPixels ?? new Uint8Array(atlasWidth * atlasHeight).fill(255);
      let idxStaging = WebGpuBackend.writePaddedIndexTexture(device, indexAtlasTexture, atlasWidth, atlasHeight, idxInit, null, 0);
      if (initialExtraPages) {
        for (let i = 0; i < extraCount; i++) {
          idxStaging = WebGpuBackend.writePaddedIndexTexture(
            device,
            indexAtlasTexture,
            atlasWidth,
            atlasHeight,
            initialExtraPages[i].indexPixels,
            idxStaging,
            i + 1,
          );
        }
      }

      const safeRows = Math.max(1, initialPaletteRows);
      const paletteLutTexture = device.createTexture({
        size: [16, safeRows, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const lutInit = initialPaletteLut ?? new Uint8Array(16 * safeRows * 4).fill(255);
      WebGpuBackend.writePaddedLutTexture(device, paletteLutTexture, safeRows, lutInit);

      const occlusionTexture = device.createTexture({
        size: [OCCLUSION_GRID_MAX, OCCLUSION_GRID_MAX, 1],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const zeroOcc = new Uint8Array(256 * OCCLUSION_GRID_MAX);
      device.queue.writeTexture(
        { texture: occlusionTexture },
        zeroOcc,
        { bytesPerRow: 256, rowsPerImage: OCCLUSION_GRID_MAX },
        { width: OCCLUSION_GRID_MAX, height: OCCLUSION_GRID_MAX, depthOrArrayLayers: 1 },
      );

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
      const lightUniformBuffer = device.createBuffer({
        size: 800,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const overlayLightUniformBuffer = device.createBuffer({
        size: 800,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const zeroOverlayLights = new Float32Array(200);
      zeroOverlayLights[6] = 32;
      zeroOverlayLights[7] = 0.35;
      device.queue.writeBuffer(overlayLightUniformBuffer, 0, zeroOverlayLights);
      const makePostBuf = () =>
        device.createBuffer({
          size: 80,
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

      const quad3dOpaqueUniBuf = device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const quad3dBlendUniBuf = device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const quad3dOpaqueBuffer = device.createBuffer({
        size: MAX_QUAD3D_INSTANCES * FLOATS_PER_QUAD3D * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      const quad3dAlphaBuffer = device.createBuffer({
        size: MAX_QUAD3D_BLEND_INSTANCES * FLOATS_PER_QUAD3D * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      const quad3dAddBuffer = device.createBuffer({
        size: MAX_QUAD3D_BLEND_INSTANCES * FLOATS_PER_QUAD3D * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });

      const pass1BindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      });
      const pass1BindGroup = WebGpuBackend.buildPass1BindGroup(
        device,
        pass1BindGroupLayout,
        skyUniformBuffer,
        atlasTexture,
        atlasSampler,
        indexAtlasTexture,
        paletteLutTexture,
        lightUniformBuffer,
        occlusionTexture,
        layerCount,
      );
      const pass1OverlayBindGroup = WebGpuBackend.buildPass1BindGroup(
        device,
        pass1BindGroupLayout,
        skyUniformBuffer,
        atlasTexture,
        atlasSampler,
        indexAtlasTexture,
        paletteLutTexture,
        overlayLightUniformBuffer,
        occlusionTexture,
        layerCount,
      );

      const quad3dBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        ],
      });
      const quad3dOpaqueBindGroup = device.createBindGroup({
        layout: quad3dBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: quad3dOpaqueUniBuf } }],
      });
      const quad3dBlendBindGroup = device.createBindGroup({
        layout: quad3dBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: quad3dBlendUniBuf } }],
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
      const quad3dPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [pass1BindGroupLayout, quad3dBindGroupLayout],
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
          { shaderLocation: 5, offset: 80, format: 'float32x4' },
        ],
      };

      const quad3dLayout: GPUVertexBufferLayout = {
        arrayStride: FLOATS_PER_QUAD3D * 4,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' },
          { shaderLocation: 1, offset: 16, format: 'float32x4' },
          { shaderLocation: 2, offset: 32, format: 'float32x4' },
          { shaderLocation: 3, offset: 48, format: 'float32x4' },
          { shaderLocation: 4, offset: 64, format: 'float32x4' },
          { shaderLocation: 5, offset: 80, format: 'float32x4' },
          { shaderLocation: 6, offset: 96, format: 'float32x4' },
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
        sky3dPipeline,
        alphaPipeline,
        addPipeline,
        quad3dOpaquePipeline,
        quad3dAlphaPipeline,
        quad3dAddPipeline,
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
          vertex: { module: sceneModule, entryPoint: 'vsSky' },
          fragment: { module: sceneModule, entryPoint: 'fsSky', targets: [{ format: mrtFormat }, { format: mrtFormat }] },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
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
          layout: quad3dPipelineLayout,
          vertex: { module: sceneModule, entryPoint: 'vsQuad3D', buffers: [quad3dLayout] },
          fragment: {
            module: sceneModule,
            entryPoint: 'fsQuad3D',
            targets: [{ format: mrtFormat }, { format: mrtFormat }],
          },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        }),
        device.createRenderPipelineAsync({
          layout: quad3dPipelineLayout,
          vertex: { module: sceneModule, entryPoint: 'vsQuad3D', buffers: [quad3dLayout] },
          fragment: {
            module: sceneModule,
            entryPoint: 'fsQuad3D',
            targets: [
              { format: mrtFormat, blend: alphaBlend },
              { format: mrtFormat, blend: alphaBlend },
            ],
          },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
        }),
        device.createRenderPipelineAsync({
          layout: quad3dPipelineLayout,
          vertex: { module: sceneModule, entryPoint: 'vsQuad3D', buffers: [quad3dLayout] },
          fragment: {
            module: sceneModule,
            entryPoint: 'fsQuad3D',
            targets: [
              { format: mrtFormat, blend: addBlend },
              { format: mrtFormat, blend: addBlend },
            ],
          },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
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
        sky3dPipeline,
        alphaPipeline,
        addPipeline,
        quad3dOpaquePipeline,
        quad3dAlphaPipeline,
        quad3dAddPipeline,
        bloomDownPipeline,
        bloomBlurPipeline,
        compositePipeline,
        skyUniformBuffer,
        lightUniformBuffer,
        overlayLightUniformBuffer,
        quad3dOpaqueUniBuf,
        quad3dBlendUniBuf,
        quad3dOpaqueBindGroup,
        quad3dBlendBindGroup,
        alphaBuffer,
        addBuffer,
        quad3dOpaqueBuffer,
        quad3dAlphaBuffer,
        quad3dAddBuffer,
        atlasTexture,
        indexAtlasTexture,
        paletteLutTexture,
        occlusionTexture,
        atlasSampler,
        linearSampler,
        nearestSampler,
        pass1BindGroupLayout,
        pass1BindGroup,
        pass1OverlayBindGroup,
        postBindGroupLayout,
        postDownBuf,
        postBlurHBuf,
        postBlurVBuf,
        postCompBuf,
        safeRows,
        layerCount,
        atlasWidth,
        atlasHeight,
        onLost,
      );
      const onUncaptured = (ev: GPUUncapturedErrorEvent) => {
        if (!backend.recovered) {
          backend.recovered = true;
          appLogger.error('gpu', 'webgpu.uncapturedError', 'WebGPU 發生未攔截的驅動錯誤，自動切換後端', ev.error);
          backend.onLostCallback?.();
        }
      };
      backend.uncapturedErrorListener = onUncaptured;
      device.addEventListener('uncapturederror', onUncaptured);
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
    this.renderTargets.depthTexture.destroy();
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
    const depthTexture = this.device.createTexture({
      size: [osW, osH, 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const bloomTexA = this.device.createTexture({ size: [bloomW, bloomH, 1], format: 'rgba8unorm', usage });
    const bloomTexB = this.device.createTexture({ size: [bloomW, bloomH, 1], format: 'rgba8unorm', usage });

    const sceneView = sceneTexture.createView();
    const emissiveView = emissiveTexture.createView();
    const depthView = depthTexture.createView();
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
      depthTexture,
      bloomTexA,
      bloomTexB,
      sceneView,
      emissiveView,
      depthView,
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
    extraPages?: readonly AtlasPageData[],
  ): void {
    const extraCount = extraPages ? Math.min(MAX_ATLAS_PAGES - 1, extraPages.length) : 0;
    const layerCount = 1 + extraCount;
    let rebuildBindGroup = false;

    if (layerCount !== this.atlasLayerCount || width !== this.atlasW || height !== this.atlasH) {
      this.atlasLayerCount = layerCount;
      this.atlasW = width;
      this.atlasH = height;
      this.atlasTexture.destroy();
      this.indexAtlasTexture.destroy();
      this.atlasTexture = this.device.createTexture({
        size: [width, height, layerCount],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.indexAtlasTexture = this.device.createTexture({
        size: [width, height, layerCount],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      rebuildBindGroup = true;
    }

    if (!this.atlasStaging || this.atlasStaging.byteLength !== pixels.byteLength) {
      this.atlasStaging = new Uint8Array(pixels.byteLength);
    }
    this.atlasStaging.set(pixels);
    this.device.queue.writeTexture(
      { texture: this.atlasTexture, origin: { x: 0, y: 0, z: 0 } },
      this.atlasStaging,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    if (extraPages) {
      for (let i = 0; i < extraCount; i++) {
        this.atlasStaging.set(extraPages[i].pixels);
        this.device.queue.writeTexture(
          { texture: this.atlasTexture, origin: { x: 0, y: 0, z: i + 1 } },
          this.atlasStaging,
          { bytesPerRow: width * 4, rowsPerImage: height },
          { width, height, depthOrArrayLayers: 1 },
        );
      }
    }

    if (indexPixels) {
      this.indexStaging = WebGpuBackend.writePaddedIndexTexture(
        this.device,
        this.indexAtlasTexture,
        width,
        height,
        indexPixels,
        this.indexStaging,
        0,
      );
      if (extraPages) {
        for (let i = 0; i < extraCount; i++) {
          this.indexStaging = WebGpuBackend.writePaddedIndexTexture(
            this.device,
            this.indexAtlasTexture,
            width,
            height,
            extraPages[i].indexPixels,
            this.indexStaging,
            i + 1,
          );
        }
      }
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
        rebuildBindGroup = true;
      }
      this.lutStaging = WebGpuBackend.writePaddedLutTexture(
        this.device,
        this.paletteLutTexture,
        paletteRows,
        paletteLut,
        this.lutStaging,
      );
    }

    if (rebuildBindGroup) {
      this.pass1BindGroup = WebGpuBackend.buildPass1BindGroup(
        this.device,
        this.pass1BindGroupLayout,
        this.skyUniformBuffer,
        this.atlasTexture,
        this.atlasSampler,
        this.indexAtlasTexture,
        this.paletteLutTexture,
        this.lightUniformBuffer,
        this.occlusionTexture,
        this.atlasLayerCount,
      );
      this.pass1OverlayBindGroup = WebGpuBackend.buildPass1BindGroup(
        this.device,
        this.pass1BindGroupLayout,
        this.skyUniformBuffer,
        this.atlasTexture,
        this.atlasSampler,
        this.indexAtlasTexture,
        this.paletteLutTexture,
        this.overlayLightUniformBuffer,
        this.occlusionTexture,
        this.atlasLayerCount,
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
    lightsData?: Float32Array,
    lightCount = 0,
    occlusion?: GpuOcclusionState,
    quad3d?: Quad3DPassData,
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
    const mid = sky.mid;
    this.skyUniformData[12] = this.paletteRows;
    this.skyUniformData[13] = mid ? mid[0] : (sky.top[0] + sky.bottom[0]) * 0.5;
    this.skyUniformData[14] = mid ? mid[1] : (sky.top[1] + sky.bottom[1]) * 0.5;
    this.skyUniformData[15] = mid ? mid[2] : (sky.top[2] + sky.bottom[2]) * 0.5;
    this.device.queue.writeBuffer(this.skyUniformBuffer, 0, this.skyUniformData);

    const occOn = Boolean(
      occlusion?.enabled &&
        occlusion.data &&
        occlusion.cols > 0 &&
        occlusion.rows > 0 &&
        occlusion.shadowStrength > 0.001,
    );
    if (occOn && occlusion && occlusion.data && occlusion.version !== this.lastOcclusionVersion) {
      this.occStaging.fill(0);
      const copyRows = Math.min(OCCLUSION_GRID_MAX, occlusion.rows);
      const copyCols = Math.min(OCCLUSION_GRID_MAX, occlusion.cols);
      for (let r = 0; r < copyRows; r++) {
        const srcRow = r * OCCLUSION_GRID_MAX;
        const dstRow = r * 256;
        for (let c = 0; c < copyCols; c++) {
          this.occStaging[dstRow + c] = occlusion.data[srcRow + c];
        }
      }
      this.device.queue.writeTexture(
        { texture: this.occlusionTexture },
        this.occStaging,
        { bytesPerRow: 256, rowsPerImage: OCCLUSION_GRID_MAX },
        { width: OCCLUSION_GRID_MAX, height: OCCLUSION_GRID_MAX, depthOrArrayLayers: 1 },
      );
      this.lastOcclusionVersion = occlusion.version;
    }

    const safeLights = lightsData ? Math.max(0, Math.min(MAX_DYNAMIC_LIGHTS, lightCount | 0)) : 0;
    this.lightUniformData[0] = safeLights;
    this.lightUniformData[1] = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.cols) : 0;
    this.lightUniformData[2] = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.rows) : 0;
    this.lightUniformData[3] = occOn && occlusion ? occlusion.shadowStrength : 0;
    this.lightUniformData[4] = occOn && occlusion ? occlusion.originScreenX : 0;
    this.lightUniformData[5] = occOn && occlusion ? occlusion.originScreenY : 0;
    this.lightUniformData[6] = occOn && occlusion ? Math.max(1, occlusion.tileSizePx) : 32;
    this.lightUniformData[7] = occOn && occlusion ? occlusion.shadowSoftness : 0.35;
    for (let i = 0; i < safeLights; i++) {
      const src = i * 8;
      const posDst = 8 + i * 4;
      const colDst = 8 + MAX_DYNAMIC_LIGHTS * 4 + i * 4;
      this.lightUniformData[posDst] = lightsData![src];
      this.lightUniformData[posDst + 1] = lightsData![src + 1];
      this.lightUniformData[posDst + 2] = lightsData![src + 2];
      this.lightUniformData[posDst + 3] = lightsData![src + 7];
      this.lightUniformData[colDst] = lightsData![src + 4];
      this.lightUniformData[colDst + 1] = lightsData![src + 5];
      this.lightUniformData[colDst + 2] = lightsData![src + 6];
      this.lightUniformData[colDst + 3] = lightsData![src + 3];
    }
    this.device.queue.writeBuffer(this.lightUniformBuffer, 0, this.lightUniformData);

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
    const wt = sky.waterTint;
    this.postUniformData[12] = sky.waterLevelNorm ?? 0;
    this.postUniformData[13] = wt ? wt[0] : 0.227;
    this.postUniformData[14] = wt ? wt[1] : 0.431;
    this.postUniformData[15] = wt ? wt[2] : 0.612;
    this.postUniformData[16] = sky.tiltShiftBlur ?? 0;
    this.postUniformData[17] = sky.tiltShiftFocusY ?? 0.52;
    this.postUniformData[18] = 0;
    this.postUniformData[19] = 0;
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

    const use3D = Boolean(quad3d && quad3d.camera.enabled);
    const safe3dOpaque = use3D && quad3d ? Math.min(quad3d.opaqueCount, MAX_QUAD3D_INSTANCES) : 0;
    const safe3dAlpha = use3D && quad3d ? Math.min(quad3d.alphaCount, MAX_QUAD3D_BLEND_INSTANCES) : 0;
    const safe3dAdd = use3D && quad3d ? Math.min(quad3d.additiveCount, MAX_QUAD3D_BLEND_INSTANCES) : 0;

    if (use3D && quad3d) {
      const cam = quad3d.camera;
      computeCamera3D(
        {
          camCenterX: cam.camCenterX,
          camCenterY: cam.camCenterY,
          zoom: cam.zoom,
          pitchDeg: cam.pitchDeg,
          fovDeg: cam.fovDeg,
          viewW,
          viewH,
        },
        this.cam3dScratch,
      );
      buildCamera3DViewProjMatrix(this.cam3dScratch, true, this.viewProj3d);
      this.quad3dUniformData.set(this.viewProj3d, 0);
      this.quad3dUniformData[16] = cam.occOriginWorldX;
      this.quad3dUniformData[17] = cam.occOriginWorldY;
      this.quad3dUniformData[18] = Math.max(1, cam.occTileSizeWorld);
      this.quad3dUniformData[19] = 1.0; // opaque cutout pass
      this.quad3dUniformData[20] = viewW;
      this.quad3dUniformData[21] = viewH;
      this.quad3dUniformData[22] = cam.camCenterX;
      this.quad3dUniformData[23] = cam.camCenterY;
      this.device.queue.writeBuffer(this.quad3dOpaqueUniBuf, 0, this.quad3dUniformData);
      this.quad3dUniformData[19] = 0.0; // alpha/additive blend pass
      this.device.queue.writeBuffer(this.quad3dBlendUniBuf, 0, this.quad3dUniformData);

      if (safe3dOpaque > 0) {
        this.device.queue.writeBuffer(
          this.quad3dOpaqueBuffer,
          0,
          quad3d.opaqueData.buffer,
          quad3d.opaqueData.byteOffset,
          safe3dOpaque * FLOATS_PER_QUAD3D * 4,
        );
      }
      if (safe3dAlpha > 0) {
        this.device.queue.writeBuffer(
          this.quad3dAlphaBuffer,
          0,
          quad3d.alphaData.buffer,
          quad3d.alphaData.byteOffset,
          safe3dAlpha * FLOATS_PER_QUAD3D * 4,
        );
      }
      if (safe3dAdd > 0) {
        this.device.queue.writeBuffer(
          this.quad3dAddBuffer,
          0,
          quad3d.additiveData.buffer,
          quad3d.additiveData.byteOffset,
          safe3dAdd * FLOATS_PER_QUAD3D * 4,
        );
      }
    }

    const encoder = this.device.createCommandEncoder();
    let drawCalls = 1;

    if (use3D) {
      // Pass 1A: Hardware Depth-Buffered True 3D Perspective HD-2D Scene
      const pass1a = encoder.beginRenderPass({
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
        depthStencilAttachment: {
          view: rt.depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass1a.setBindGroup(0, this.pass1BindGroup);
      pass1a.setPipeline(this.sky3dPipeline);
      pass1a.draw(6);

      if (safe3dOpaque > 0) {
        pass1a.setPipeline(this.quad3dOpaquePipeline);
        pass1a.setBindGroup(1, this.quad3dOpaqueBindGroup);
        pass1a.setVertexBuffer(0, this.quad3dOpaqueBuffer);
        pass1a.draw(6, safe3dOpaque);
        drawCalls++;
      }
      if (safe3dAlpha > 0) {
        pass1a.setPipeline(this.quad3dAlphaPipeline);
        pass1a.setBindGroup(1, this.quad3dBlendBindGroup);
        pass1a.setVertexBuffer(0, this.quad3dAlphaBuffer);
        pass1a.draw(6, safe3dAlpha);
        drawCalls++;
      }
      if (safe3dAdd > 0) {
        pass1a.setPipeline(this.quad3dAddPipeline);
        pass1a.setBindGroup(1, this.quad3dBlendBindGroup);
        pass1a.setVertexBuffer(0, this.quad3dAddBuffer);
        pass1a.draw(6, safe3dAdd);
        drawCalls++;
      }
      pass1a.end();

      // Pass 1B: Crisp 2D HUD & Projected Overlay Pass over 3D Scene
      if (safeAlpha > 0 || safeAdd > 0) {
        const pass1b = encoder.beginRenderPass({
          colorAttachments: [
            { view: rt.sceneView, loadOp: 'load', storeOp: 'store' },
            { view: rt.emissiveView, loadOp: 'load', storeOp: 'store' },
          ],
        });
        pass1b.setBindGroup(0, this.pass1OverlayBindGroup);
        if (safeAlpha > 0) {
          pass1b.setPipeline(this.alphaPipeline);
          pass1b.setVertexBuffer(0, this.alphaBuffer);
          pass1b.draw(6, safeAlpha);
          drawCalls++;
        }
        if (safeAdd > 0) {
          pass1b.setPipeline(this.addPipeline);
          pass1b.setVertexBuffer(0, this.addBuffer);
          pass1b.draw(6, safeAdd);
          drawCalls++;
        }
        pass1b.end();
      }
    } else {
      // Pass 1: Standard 2D / 2.5D MRT Scene Color + Emissive Mask
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
    }

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
    if (this.uncapturedErrorListener) {
      this.device.removeEventListener('uncapturederror', this.uncapturedErrorListener);
      this.uncapturedErrorListener = undefined;
    }
    this.destroyRenderTargets();
    this.alphaBuffer.destroy();
    this.addBuffer.destroy();
    this.quad3dOpaqueBuffer.destroy();
    this.quad3dAlphaBuffer.destroy();
    this.quad3dAddBuffer.destroy();
    this.quad3dOpaqueUniBuf.destroy();
    this.quad3dBlendUniBuf.destroy();
    this.skyUniformBuffer.destroy();
    this.lightUniformBuffer.destroy();
    this.overlayLightUniformBuffer.destroy();
    this.postDownBuf.destroy();
    this.postBlurHBuf.destroy();
    this.postBlurVBuf.destroy();
    this.postCompBuf.destroy();
    this.atlasTexture.destroy();
    this.indexAtlasTexture.destroy();
    this.paletteLutTexture.destroy();
    this.occlusionTexture.destroy();
    this.device.destroy();
  }
}

