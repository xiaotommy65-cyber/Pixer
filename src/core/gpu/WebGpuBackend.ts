import {
  buildDirectionalLightViewProjMatrix,
  createComputedCamera3D,
} from '../math/Perspective3DMath.ts';
import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  GAME_H,
  GAME_W,
  MAX_ATLAS_PAGES,
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
  type GpuOcclusionState,
  type IGpuBackend,
  type Mesh3DPassData,
  type Quad3DPassData,
  type SkyGradient,
} from './GpuTypes.ts';
import { createWebGpuPipelines, type WebGpuPipelineBundle } from './WebGpuPipelines.ts';
import {
  buildPass1BindGroup,
  createInitialAtlasTextures,
  createPostRenderTargets,
  createWebGpuCoreBuffers,
  DEFAULT_PALETTE_ROWS,
  destroyPostRenderTargets,
  MAX_QUAD3D_BLEND_INSTANCES,
  uploadWebGpu3dPassBuffers,
  uploadWebGpuFrameUniforms,
  writePaddedIndexTexture,
  writePaddedLutTexture,
  type Mesh3dGpuResources,
  type PostRenderTargets,
  type WebGpuCoreBuffers,
} from './WebGpuResources.ts';
import { WGSL_CODE, WGSL_POST_CODE } from './WebGpuShaders.ts';

export class WebGpuBackend implements IGpuBackend {
  public readonly kind = 'webgpu' as const;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private readonly pipes: WebGpuPipelineBundle;
  private readonly bufs: WebGpuCoreBuffers;
  private readonly mesh3dRes: Mesh3dGpuResources;
  private overlayLightUniformBuffer: GPUBuffer;
  private pass1BindGroup: GPUBindGroup;
  private pass1OverlayBindGroup: GPUBindGroup;
  private atlasTexture: GPUTexture;
  private indexAtlasTexture: GPUTexture;
  private paletteLutTexture: GPUTexture;
  private occlusionTexture: GPUTexture;

  private skyUniformData = new Float32Array(16);
  private lightUniformData = new Float32Array(200);
  private quad3dUniformData = new Float32Array(72);
  private postUniformData = new Float32Array(20);
  private readonly cam3dScratch = createComputedCamera3D();
  private readonly viewProj3d = new Float32Array(16);
  private readonly lightViewProj3d = new Float32Array(16);
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
    pipes: WebGpuPipelineBundle,
    bufs: WebGpuCoreBuffers,
    overlayLightUniformBuffer: GPUBuffer,
    pass1BindGroup: GPUBindGroup,
    pass1OverlayBindGroup: GPUBindGroup,
    atlasTexture: GPUTexture,
    indexAtlasTexture: GPUTexture,
    paletteLutTexture: GPUTexture,
    occlusionTexture: GPUTexture,
    paletteRows: number,
    atlasLayerCount: number,
    atlasW: number,
    atlasH: number,
    onLost?: () => void,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.pipes = pipes;
    this.bufs = bufs;
    this.mesh3dRes = pipes.mesh3dRes;
    this.overlayLightUniformBuffer = overlayLightUniformBuffer;
    this.pass1BindGroup = pass1BindGroup;
    this.pass1OverlayBindGroup = pass1OverlayBindGroup;
    this.atlasTexture = atlasTexture;
    this.indexAtlasTexture = indexAtlasTexture;
    this.paletteLutTexture = paletteLutTexture;
    this.occlusionTexture = occlusionTexture;
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

      const initTex = createInitialAtlasTextures(
        device,
        atlasWidth,
        atlasHeight,
        initialPixels,
        initialIndexPixels,
        initialPaletteLut,
        initialPaletteRows,
        initialExtraPages,
      );
      const bufs = createWebGpuCoreBuffers(device);
      const overlayLightUniformBuffer = device.createBuffer({
        size: 800,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const zeroOverlayLights = new Float32Array(200);
      zeroOverlayLights[6] = 32;
      zeroOverlayLights[7] = 0.35;
      device.queue.writeBuffer(overlayLightUniformBuffer, 0, zeroOverlayLights);

      const pipes = await createWebGpuPipelines(device, format, sceneModule, postModule, bufs);
      const pass1BindGroup = buildPass1BindGroup(
        device,
        pipes.pass1BindGroupLayout,
        bufs.skyUniformBuffer,
        initTex.atlasTexture,
        bufs.atlasSampler,
        initTex.indexAtlasTexture,
        initTex.paletteLutTexture,
        bufs.lightUniformBuffer,
        initTex.occlusionTexture,
        initTex.layerCount,
      );
      const pass1OverlayBindGroup = buildPass1BindGroup(
        device,
        pipes.pass1BindGroupLayout,
        bufs.skyUniformBuffer,
        initTex.atlasTexture,
        bufs.atlasSampler,
        initTex.indexAtlasTexture,
        initTex.paletteLutTexture,
        overlayLightUniformBuffer,
        initTex.occlusionTexture,
        initTex.layerCount,
      );

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
        pipes,
        bufs,
        overlayLightUniformBuffer,
        pass1BindGroup,
        pass1OverlayBindGroup,
        initTex.atlasTexture,
        initTex.indexAtlasTexture,
        initTex.paletteLutTexture,
        initTex.occlusionTexture,
        initTex.safeRows,
        initTex.layerCount,
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
    this.renderTargets = destroyPostRenderTargets(this.renderTargets);
    this.renderTargets = createPostRenderTargets(
      this.device,
      this.pipes.postBindGroupLayout,
      this.bufs.linearSampler,
      this.bufs.nearestSampler,
      this.bufs.postDownBuf,
      this.bufs.postBlurHBuf,
      this.bufs.postBlurVBuf,
      this.bufs.postCompBuf,
      w,
      h,
      viewW,
      viewH,
    );
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
      this.indexStaging = writePaddedIndexTexture(
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
          this.indexStaging = writePaddedIndexTexture(
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
      this.lutStaging = writePaddedLutTexture(
        this.device,
        this.paletteLutTexture,
        paletteRows,
        paletteLut,
        this.lutStaging,
      );
    }

    if (rebuildBindGroup) {
      this.pass1BindGroup = buildPass1BindGroup(
        this.device,
        this.pipes.pass1BindGroupLayout,
        this.bufs.skyUniformBuffer,
        this.atlasTexture,
        this.bufs.atlasSampler,
        this.indexAtlasTexture,
        this.paletteLutTexture,
        this.bufs.lightUniformBuffer,
        this.occlusionTexture,
        this.atlasLayerCount,
      );
      this.pass1OverlayBindGroup = buildPass1BindGroup(
        this.device,
        this.pipes.pass1BindGroupLayout,
        this.bufs.skyUniformBuffer,
        this.atlasTexture,
        this.bufs.atlasSampler,
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
    mesh3d?: Mesh3DPassData,
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
    const rt = this.ensureRenderTargets(Math.max(1, swapTex.width), Math.max(1, swapTex.height), viewW, viewH);
    const view = swapTex.createView();

    this.lastOcclusionVersion = uploadWebGpuFrameUniforms(
      this.device,
      this.bufs,
      this.skyUniformData,
      this.lightUniformData,
      this.postUniformData,
      this.occStaging,
      this.occlusionTexture,
      this.lastOcclusionVersion,
      this.paletteRows,
      sky,
      timeSec,
      viewW,
      viewH,
      rt,
      lightsData,
      lightCount,
      occlusion,
    );

    const safeAlpha = Math.min(alphaCount, MAX_INSTANCES_PER_PASS);
    const safeAdd = Math.min(additiveCount, MAX_INSTANCES_PER_PASS);
    if (safeAlpha > 0) {
      this.device.queue.writeBuffer(
        this.bufs.alphaBuffer,
        0,
        alphaItems.buffer,
        alphaItems.byteOffset,
        safeAlpha * FLOATS_PER_INSTANCE * 4,
      );
    }
    if (safeAdd > 0) {
      this.device.queue.writeBuffer(
        this.bufs.addBuffer,
        0,
        additiveItems.buffer,
        additiveItems.byteOffset,
        safeAdd * FLOATS_PER_INSTANCE * 4,
      );
    }

    const use3D = Boolean(quad3d && quad3d.camera.enabled);
    const safe3dOpaque = use3D && quad3d ? Math.min(quad3d.opaqueCount, MAX_QUAD3D_INSTANCES) : 0;
    const safe3dAlpha = use3D && quad3d ? Math.min(quad3d.alphaCount, MAX_QUAD3D_BLEND_INSTANCES) : 0;
    const safe3dAdd = use3D && quad3d ? Math.min(quad3d.additiveCount, MAX_QUAD3D_BLEND_INSTANCES) : 0;
    const safeMeshOpaqueV = use3D && mesh3d ? Math.min(mesh3d.opaqueVertexCount, MAX_MESH3D_VERTICES) : 0;
    const safeMeshOpaqueI = use3D && mesh3d ? Math.min(mesh3d.opaqueIndexCount, MAX_MESH3D_INDICES) : 0;
    const safeMeshAlphaV = use3D && mesh3d ? Math.min(mesh3d.alphaVertexCount, MAX_MESH3D_ALPHA_VERTICES) : 0;
    const safeMeshAlphaI = use3D && mesh3d ? Math.min(mesh3d.alphaIndexCount, MAX_MESH3D_ALPHA_INDICES) : 0;
    const safeLine3dV = use3D && mesh3d ? Math.min(mesh3d.lineVertexCount, MAX_LINE3D_VERTICES) : 0;
    let runShadowPass = false;

    if (use3D && quad3d) {
      const cam = quad3d.camera;
      const shadowHalfExtent = (Math.max(viewW, viewH) / Math.max(0.25, cam.zoom)) * 0.85 + 160;
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
        true,
        this.lightViewProj3d,
      );
      runShadowPass = Boolean(
        cam.shadowMapEnabled && cam.shadowStrength > 0.005 && (safeMeshOpaqueI > 0 || safe3dOpaque > 0),
      );
      uploadWebGpu3dPassBuffers(
        this.device,
        this.bufs,
        this.mesh3dRes,
        this.cam3dScratch,
        this.viewProj3d,
        this.lightViewProj3d,
        this.quad3dUniformData,
        viewW,
        viewH,
        quad3d,
        mesh3d,
        runShadowPass,
        safe3dOpaque,
        safe3dAlpha,
        safe3dAdd,
        safeMeshOpaqueV,
        safeMeshOpaqueI,
        safeMeshAlphaV,
        safeMeshAlphaI,
        safeLine3dV,
      );
    }

    const encoder = this.device.createCommandEncoder();
    let drawCalls = 1;

    if (use3D) {
      if (runShadowPass) {
        const shadowPass = encoder.beginRenderPass({
          colorAttachments: [],
          depthStencilAttachment: {
            view: this.mesh3dRes.shadowDepthView,
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        });
        shadowPass.setBindGroup(0, this.pass1BindGroup);
        shadowPass.setBindGroup(1, this.mesh3dRes.shadowBindGroup);
        if (safeMeshOpaqueI > 0) {
          shadowPass.setPipeline(this.mesh3dRes.shadowMeshPipeline);
          shadowPass.setVertexBuffer(0, this.mesh3dRes.opaqueVertBuf);
          shadowPass.setIndexBuffer(this.mesh3dRes.opaqueIdxBuf, 'uint32');
          shadowPass.drawIndexed(safeMeshOpaqueI);
          drawCalls++;
        }
        if (safe3dOpaque > 0) {
          shadowPass.setPipeline(this.mesh3dRes.shadowQuadPipeline);
          shadowPass.setVertexBuffer(0, this.bufs.quad3dOpaqueBuffer);
          shadowPass.draw(6, safe3dOpaque);
          drawCalls++;
        }
        shadowPass.end();
      }

      const pass1a = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: rt.sceneView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: sky.top[0], g: sky.top[1], b: sky.top[2], a: 1 },
          },
          { view: rt.emissiveView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
        depthStencilAttachment: {
          view: rt.depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      if (quad3d?.quadViews) {
        const halfW = Math.floor(rt.osW * 0.5);
        const halfH = Math.floor(rt.osH * 0.5);
        for (let q = 0; q < 4; q++) {
          const vx = (q & 1) === 0 ? 0 : halfW;
          const vy = q < 2 ? 0 : halfH;
          const vwQ = (q & 1) === 0 ? halfW : rt.osW - halfW;
          const vhQ = q < 2 ? halfH : rt.osH - halfH;
          if (vwQ <= 0 || vhQ <= 0) continue;
          pass1a.setViewport(vx, vy, vwQ, vhQ, 0, 1);
          pass1a.setScissorRect(vx, vy, vwQ, vhQ);
          drawCalls += this.drawPass1a3DScene(
            pass1a,
            this.mesh3dRes.quadViewOpaqueBindGroups[q],
            this.mesh3dRes.quadViewBlendBindGroups[q],
            safeMeshOpaqueI,
            safe3dOpaque,
            safeMeshAlphaI,
            safe3dAlpha,
            safe3dAdd,
            safeLine3dV,
          );
        }
      } else {
        drawCalls += this.drawPass1a3DScene(
          pass1a,
          this.pipes.quad3dOpaqueBindGroup,
          this.pipes.quad3dBlendBindGroup,
          safeMeshOpaqueI,
          safe3dOpaque,
          safeMeshAlphaI,
          safe3dAlpha,
          safe3dAdd,
          safeLine3dV,
        );
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
          pass1b.setPipeline(this.pipes.alphaPipeline);
          pass1b.setVertexBuffer(0, this.bufs.alphaBuffer);
          pass1b.draw(6, safeAlpha);
          drawCalls++;
        }
        if (safeAdd > 0) {
          pass1b.setPipeline(this.pipes.addPipeline);
          pass1b.setVertexBuffer(0, this.bufs.addBuffer);
          pass1b.draw(6, safeAdd);
          drawCalls++;
        }
        pass1b.end();
      }
    } else {
      const pass1 = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: rt.sceneView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: sky.top[0], g: sky.top[1], b: sky.top[2], a: 1 },
          },
          { view: rt.emissiveView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      pass1.setBindGroup(0, this.pass1BindGroup);
      pass1.setPipeline(this.pipes.skyPipeline);
      pass1.draw(6);
      if (safeAlpha > 0) {
        pass1.setPipeline(this.pipes.alphaPipeline);
        pass1.setVertexBuffer(0, this.bufs.alphaBuffer);
        pass1.draw(6, safeAlpha);
        drawCalls++;
      }
      if (safeAdd > 0) {
        pass1.setPipeline(this.pipes.addPipeline);
        pass1.setVertexBuffer(0, this.bufs.addBuffer);
        pass1.draw(6, safeAdd);
        drawCalls++;
      }
      pass1.end();
    }

    if (sky.glowIntensity > 0.01) {
      this.encodePostFullscreenPass(encoder, rt.bloomViewA, rt.bloomDownBindGroup, this.pipes.bloomDownPipeline);
      this.encodePostFullscreenPass(encoder, rt.bloomViewB, rt.bloomBlurHBindGroup, this.pipes.bloomBlurPipeline);
      this.encodePostFullscreenPass(encoder, rt.bloomViewA, rt.bloomBlurVBindGroup, this.pipes.bloomBlurPipeline);
      drawCalls += 3;
    }

    this.encodePostFullscreenPass(encoder, view, rt.compositeBindGroup, this.pipes.compositePipeline);
    drawCalls++;

    this.device.queue.submit([encoder.finish()]);
    return drawCalls;
  }

  private encodePostFullscreenPass(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    bindGroup: GPUBindGroup,
    pipeline: GPURenderPipeline,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pipeline);
    pass.draw(6);
    pass.end();
  }

  private drawPass1a3DScene(
    pass1a: GPURenderPassEncoder,
    opaqueBindGroup: GPUBindGroup,
    blendBindGroup: GPUBindGroup,
    safeMeshOpaqueI: number,
    safe3dOpaque: number,
    safeMeshAlphaI: number,
    safe3dAlpha: number,
    safe3dAdd: number,
    safeLine3dV: number,
  ): number {
    let drawCalls = 0;
    pass1a.setBindGroup(0, this.pass1BindGroup);
    pass1a.setPipeline(this.pipes.sky3dPipeline);
    pass1a.draw(6);

    if (safeMeshOpaqueI > 0) {
      pass1a.setPipeline(this.mesh3dRes.meshOpaquePipeline);
      pass1a.setBindGroup(1, opaqueBindGroup);
      pass1a.setVertexBuffer(0, this.mesh3dRes.opaqueVertBuf);
      pass1a.setIndexBuffer(this.mesh3dRes.opaqueIdxBuf, 'uint32');
      pass1a.drawIndexed(safeMeshOpaqueI);
      drawCalls++;
    }
    if (safe3dOpaque > 0) {
      pass1a.setPipeline(this.pipes.quad3dOpaquePipeline);
      pass1a.setBindGroup(1, opaqueBindGroup);
      pass1a.setVertexBuffer(0, this.bufs.quad3dOpaqueBuffer);
      pass1a.draw(6, safe3dOpaque);
      drawCalls++;
    }
    if (safeMeshAlphaI > 0) {
      pass1a.setPipeline(this.mesh3dRes.meshAlphaPipeline);
      pass1a.setBindGroup(1, blendBindGroup);
      pass1a.setVertexBuffer(0, this.mesh3dRes.alphaVertBuf);
      pass1a.setIndexBuffer(this.mesh3dRes.alphaIdxBuf, 'uint32');
      pass1a.drawIndexed(safeMeshAlphaI);
      drawCalls++;
    }
    if (safe3dAlpha > 0) {
      pass1a.setPipeline(this.pipes.quad3dAlphaPipeline);
      pass1a.setBindGroup(1, blendBindGroup);
      pass1a.setVertexBuffer(0, this.bufs.quad3dAlphaBuffer);
      pass1a.draw(6, safe3dAlpha);
      drawCalls++;
    }
    if (safe3dAdd > 0) {
      pass1a.setPipeline(this.pipes.quad3dAddPipeline);
      pass1a.setBindGroup(1, blendBindGroup);
      pass1a.setVertexBuffer(0, this.bufs.quad3dAddBuffer);
      pass1a.draw(6, safe3dAdd);
      drawCalls++;
    }
    if (safeLine3dV > 1) {
      pass1a.setPipeline(this.mesh3dRes.line3dPipeline);
      pass1a.setBindGroup(1, blendBindGroup);
      pass1a.setVertexBuffer(0, this.mesh3dRes.lineVertBuf);
      pass1a.draw(safeLine3dV);
      drawCalls++;
    }
    return drawCalls;
  }

  public dispose(): void {
    if (this.uncapturedErrorListener) {
      this.device.removeEventListener('uncapturederror', this.uncapturedErrorListener);
      this.uncapturedErrorListener = undefined;
    }
    this.renderTargets = destroyPostRenderTargets(this.renderTargets);
    this.bufs.alphaBuffer.destroy();
    this.bufs.addBuffer.destroy();
    this.bufs.quad3dOpaqueBuffer.destroy();
    this.bufs.quad3dAlphaBuffer.destroy();
    this.bufs.quad3dAddBuffer.destroy();
    this.bufs.quad3dOpaqueUniBuf.destroy();
    this.bufs.quad3dBlendUniBuf.destroy();
    for (let q = 0; q < 4; q++) {
      this.mesh3dRes.quadViewOpaqueUniBufs[q].destroy();
      this.mesh3dRes.quadViewBlendUniBufs[q].destroy();
    }
    this.mesh3dRes.opaqueVertBuf.destroy();
    this.mesh3dRes.opaqueIdxBuf.destroy();
    this.mesh3dRes.alphaVertBuf.destroy();
    this.mesh3dRes.alphaIdxBuf.destroy();
    this.mesh3dRes.lineVertBuf.destroy();
    this.mesh3dRes.shadowDepthTexture.destroy();
    this.bufs.skyUniformBuffer.destroy();
    this.bufs.lightUniformBuffer.destroy();
    this.overlayLightUniformBuffer.destroy();
    this.bufs.postDownBuf.destroy();
    this.bufs.postBlurHBuf.destroy();
    this.bufs.postBlurVBuf.destroy();
    this.bufs.postCompBuf.destroy();
    this.atlasTexture.destroy();
    this.indexAtlasTexture.destroy();
    this.paletteLutTexture.destroy();
    this.occlusionTexture.destroy();
    this.device.destroy();
  }
}
