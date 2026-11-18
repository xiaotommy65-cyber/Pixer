import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  GAME_H,
  GAME_W,
  MAX_INSTANCES_PER_PASS,
  type IGpuBackend,
  type SkyGradient,
} from './GpuTypes.ts';
import { WGSL_CODE } from './WebGpuShaders.ts';

export class WebGpuBackend implements IGpuBackend {
  public readonly kind = 'webgpu' as const;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private skyPipeline: GPURenderPipeline;
  private alphaPipeline: GPURenderPipeline;
  private addPipeline: GPURenderPipeline;
  private skyUniformBuffer: GPUBuffer;
  private skyUniformData = new Float32Array(12);
  private alphaBuffer: GPUBuffer;
  private addBuffer: GPUBuffer;
  private atlasTexture: GPUTexture;
  private bindGroup: GPUBindGroup;
  private onLostCallback?: () => void;
  private recovered = false;
  private atlasStaging: Uint8Array<ArrayBuffer> | null = null;
  private configuredW = 0;
  private configuredH = 0;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    skyPipeline: GPURenderPipeline,
    alphaPipeline: GPURenderPipeline,
    addPipeline: GPURenderPipeline,
    skyUniformBuffer: GPUBuffer,
    alphaBuffer: GPUBuffer,
    addBuffer: GPUBuffer,
    atlasTexture: GPUTexture,
    bindGroup: GPUBindGroup,
    onLost?: () => void,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.skyPipeline = skyPipeline;
    this.alphaPipeline = alphaPipeline;
    this.addPipeline = addPipeline;
    this.skyUniformBuffer = skyUniformBuffer;
    this.alphaBuffer = alphaBuffer;
    this.addBuffer = addBuffer;
    this.atlasTexture = atlasTexture;
    this.bindGroup = bindGroup;
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

  public static async tryCreate(
    canvas: HTMLCanvasElement,
    atlasWidth: number,
    atlasHeight: number,
    initialPixels: Uint8Array,
    onLost?: () => void,
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
      const module = device.createShaderModule({ code: WGSL_CODE });
      const info = await module.getCompilationInfo();
      if (info.messages.some((m) => m.type === 'error')) {
        const firstErr = info.messages.find((m) => m.type === 'error');
        appLogger.error('gpu', 'webgpu.compileShader', 'WGSL 著色器編譯失敗，已退回 WebGL2', new Error(firstErr?.message ?? 'WGSL error'));
        await device.popErrorScope();
        device.destroy();
        return null;
      }

      const atlasTexture = device.createTexture({
        size: [atlasWidth, atlasHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const copy = new Uint8Array(initialPixels);
      device.queue.writeTexture(
        { texture: atlasTexture },
        copy,
        { bytesPerRow: atlasWidth * 4, rowsPerImage: atlasHeight },
        { width: atlasWidth, height: atlasHeight },
      );

      const sampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      const skyUniformBuffer = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const instanceBytes = MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE * 4;
      const alphaBuffer = device.createBuffer({
        size: instanceBytes,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      const addBuffer = device.createBuffer({
        size: instanceBytes,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
      });

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: skyUniformBuffer } },
          { binding: 1, resource: atlasTexture.createView() },
          { binding: 2, resource: sampler },
        ],
      });

      const instanceLayout: GPUVertexBufferLayout = {
        arrayStride: FLOATS_PER_INSTANCE * 4,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' },
          { shaderLocation: 1, offset: 16, format: 'float32x4' },
          { shaderLocation: 2, offset: 32, format: 'float32x4' },
          { shaderLocation: 3, offset: 48, format: 'float32x4' },
        ],
      };

      const [skyPipeline, alphaPipeline, addPipeline] = await Promise.all([
        device.createRenderPipelineAsync({
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vsSky' },
          fragment: { module, entryPoint: 'fsSky', targets: [{ format }] },
        }),
        device.createRenderPipelineAsync({
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vsSprite', buffers: [instanceLayout] },
          fragment: {
            module,
            entryPoint: 'fsSprite',
            targets: [
              {
                format,
                blend: {
                  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                },
              },
            ],
          },
        }),
        device.createRenderPipelineAsync({
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vsSprite', buffers: [instanceLayout] },
          fragment: {
            module,
            entryPoint: 'fsSprite',
            targets: [
              {
                format,
                blend: {
                  color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                },
              },
            ],
          },
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
        skyUniformBuffer,
        alphaBuffer,
        addBuffer,
        atlasTexture,
        bindGroup,
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

  public uploadAtlas(width: number, height: number, pixels: Uint8Array): void {
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
    this.skyUniformData[10] = GAME_W;
    this.skyUniformData[11] = GAME_H;
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

    let view: GPUTextureView;
    try {
      view = this.context.getCurrentTexture().createView();
    } catch {
      if (!this.recovered) {
        this.recovered = true;
        this.onLostCallback?.();
      }
      return 0;
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: sky.top[0], g: sky.top[1], b: sky.top[2], a: 1 },
        },
      ],
    });

    let drawCalls = 1;
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.skyPipeline);
    pass.draw(6);

    if (safeAlpha > 0) {
      pass.setPipeline(this.alphaPipeline);
      pass.setVertexBuffer(0, this.alphaBuffer);
      pass.draw(6, safeAlpha);
      drawCalls++;
    }

    if (safeAdd > 0) {
      pass.setPipeline(this.addPipeline);
      pass.setVertexBuffer(0, this.addBuffer);
      pass.draw(6, safeAdd);
      drawCalls++;
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return drawCalls;
  }

  public dispose(): void {
    this.alphaBuffer.destroy();
    this.addBuffer.destroy();
    this.skyUniformBuffer.destroy();
    this.atlasTexture.destroy();
    this.device.destroy();
  }
}
