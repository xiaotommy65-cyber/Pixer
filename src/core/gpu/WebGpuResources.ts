import {
  buildCamera3DViewProjMatrix,
  computeCamera3D,
  type ComputedCamera3D,
} from '../math/Perspective3DMath.ts';
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
  type GpuCamera3DState,
  type GpuOcclusionState,
  type Mesh3DPassData,
  type Quad3DPassData,
  type SkyGradient,
} from './GpuTypes.ts';

export const MAX_QUAD3D_BLEND_INSTANCES = 4096;
export const DEFAULT_PALETTE_ROWS = 8;
export const LUT_ALIGNED_ROW_BYTES = 256;

export interface Mesh3dGpuResources {
  shadowDepthTexture: GPUTexture;
  shadowDepthView: GPUTextureView;
  shadowSampler: GPUSampler;
  shadowBindGroup: GPUBindGroup;
  shadowMeshPipeline: GPURenderPipeline;
  shadowQuadPipeline: GPURenderPipeline;
  meshOpaquePipeline: GPURenderPipeline;
  meshAlphaPipeline: GPURenderPipeline;
  line3dPipeline: GPURenderPipeline;
  opaqueVertBuf: GPUBuffer;
  opaqueIdxBuf: GPUBuffer;
  alphaVertBuf: GPUBuffer;
  alphaIdxBuf: GPUBuffer;
  lineVertBuf: GPUBuffer;
  quadViewOpaqueUniBufs: readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer];
  quadViewBlendUniBufs: readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer];
  quadViewOpaqueBindGroups: readonly [GPUBindGroup, GPUBindGroup, GPUBindGroup, GPUBindGroup];
  quadViewBlendBindGroups: readonly [GPUBindGroup, GPUBindGroup, GPUBindGroup, GPUBindGroup];
}

export interface PostRenderTargets {
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

export interface WebGpuCoreBuffers {
  atlasSampler: GPUSampler;
  linearSampler: GPUSampler;
  nearestSampler: GPUSampler;
  skyUniformBuffer: GPUBuffer;
  lightUniformBuffer: GPUBuffer;
  postDownBuf: GPUBuffer;
  postBlurHBuf: GPUBuffer;
  postBlurVBuf: GPUBuffer;
  postCompBuf: GPUBuffer;
  alphaBuffer: GPUBuffer;
  addBuffer: GPUBuffer;
  quad3dOpaqueUniBuf: GPUBuffer;
  quad3dBlendUniBuf: GPUBuffer;
  quad3dOpaqueBuffer: GPUBuffer;
  quad3dAlphaBuffer: GPUBuffer;
  quad3dAddBuffer: GPUBuffer;
  shadowDepthTexture: GPUTexture;
  shadowDepthView: GPUTextureView;
  shadowSampler: GPUSampler;
  meshOpaqueVertBuf: GPUBuffer;
  meshOpaqueIdxBuf: GPUBuffer;
  meshAlphaVertBuf: GPUBuffer;
  meshAlphaIdxBuf: GPUBuffer;
  line3dVertBuf: GPUBuffer;
}

export interface WebGpuInitialAtlasTextures {
  atlasTexture: GPUTexture;
  indexAtlasTexture: GPUTexture;
  paletteLutTexture: GPUTexture;
  occlusionTexture: GPUTexture;
  safeRows: number;
  layerCount: number;
}

export function writePaddedIndexTexture(
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

export function writePaddedLutTexture(
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

export function buildPass1BindGroup(
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

export function createInitialAtlasTextures(
  device: GPUDevice,
  atlasWidth: number,
  atlasHeight: number,
  initialPixels: Uint8Array,
  initialIndexPixels?: Uint8Array,
  initialPaletteLut?: Uint8Array,
  initialPaletteRows = DEFAULT_PALETTE_ROWS,
  initialExtraPages?: readonly AtlasPageData[],
): WebGpuInitialAtlasTextures {
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
  let idxStaging = writePaddedIndexTexture(device, indexAtlasTexture, atlasWidth, atlasHeight, idxInit, null, 0);
  if (initialExtraPages) {
    for (let i = 0; i < extraCount; i++) {
      idxStaging = writePaddedIndexTexture(
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
  writePaddedLutTexture(device, paletteLutTexture, safeRows, lutInit);

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

  return { atlasTexture, indexAtlasTexture, paletteLutTexture, occlusionTexture, safeRows, layerCount };
}

export function createWebGpuCoreBuffers(device: GPUDevice): WebGpuCoreBuffers {
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
    size: 288,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const quad3dBlendUniBuf = device.createBuffer({
    size: 288,
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

  const shadowDepthTexture = device.createTexture({
    size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, 1],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadowDepthView = shadowDepthTexture.createView();
  const shadowSampler = device.createSampler({
    compare: 'less-equal',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const meshOpaqueVertBuf = device.createBuffer({
    size: MAX_MESH3D_VERTICES * FLOATS_PER_MESH3D_VERTEX * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const meshOpaqueIdxBuf = device.createBuffer({
    size: MAX_MESH3D_INDICES * 4,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  const meshAlphaVertBuf = device.createBuffer({
    size: MAX_MESH3D_ALPHA_VERTICES * FLOATS_PER_MESH3D_VERTEX * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const meshAlphaIdxBuf = device.createBuffer({
    size: MAX_MESH3D_ALPHA_INDICES * 4,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  const line3dVertBuf = device.createBuffer({
    size: MAX_LINE3D_VERTICES * FLOATS_PER_MESH3D_VERTEX * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  return {
    atlasSampler,
    linearSampler,
    nearestSampler,
    skyUniformBuffer,
    lightUniformBuffer,
    postDownBuf,
    postBlurHBuf,
    postBlurVBuf,
    postCompBuf,
    alphaBuffer,
    addBuffer,
    quad3dOpaqueUniBuf,
    quad3dBlendUniBuf,
    quad3dOpaqueBuffer,
    quad3dAlphaBuffer,
    quad3dAddBuffer,
    shadowDepthTexture,
    shadowDepthView,
    shadowSampler,
    meshOpaqueVertBuf,
    meshOpaqueIdxBuf,
    meshAlphaVertBuf,
    meshAlphaIdxBuf,
    line3dVertBuf,
  };
}

export function destroyPostRenderTargets(rt: PostRenderTargets | null): null {
  if (!rt) return null;
  rt.sceneTexture.destroy();
  rt.emissiveTexture.destroy();
  rt.depthTexture.destroy();
  rt.bloomTexA.destroy();
  rt.bloomTexB.destroy();
  return null;
}

export function createPostRenderTargets(
  device: GPUDevice,
  postBindGroupLayout: GPUBindGroupLayout,
  linearSampler: GPUSampler,
  nearestSampler: GPUSampler,
  postDownBuf: GPUBuffer,
  postBlurHBuf: GPUBuffer,
  postBlurVBuf: GPUBuffer,
  postCompBuf: GPUBuffer,
  w: number,
  h: number,
  viewW = GAME_W,
  viewH = GAME_H,
): PostRenderTargets {
  const osViewW = viewW + OVERSCAN_PAD * 2;
  const osViewH = viewH + OVERSCAN_PAD * 2;
  const osW = Math.max(1, Math.round((w * osViewW) / viewW));
  const osH = Math.max(1, Math.round((h * osViewH) / viewH));
  const bloomW = Math.max(1, Math.floor(osW / 4));
  const bloomH = Math.max(1, Math.floor(osH / 4));
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

  const sceneTexture = device.createTexture({ size: [osW, osH, 1], format: 'rgba8unorm', usage });
  const emissiveTexture = device.createTexture({ size: [osW, osH, 1], format: 'rgba8unorm', usage });
  const depthTexture = device.createTexture({
    size: [osW, osH, 1],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const bloomTexA = device.createTexture({ size: [bloomW, bloomH, 1], format: 'rgba8unorm', usage });
  const bloomTexB = device.createTexture({ size: [bloomW, bloomH, 1], format: 'rgba8unorm', usage });

  const sceneView = sceneTexture.createView();
  const emissiveView = emissiveTexture.createView();
  const depthView = depthTexture.createView();
  const bloomViewA = bloomTexA.createView();
  const bloomViewB = bloomTexB.createView();

  const mkPostBind = (buf: GPUBuffer, viewA: GPUTextureView, viewB: GPUTextureView) =>
    device.createBindGroup({
      layout: postBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buf } },
        { binding: 1, resource: viewA },
        { binding: 2, resource: viewB },
        { binding: 3, resource: linearSampler },
        { binding: 4, resource: nearestSampler },
      ],
    });

  return {
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
    bloomDownBindGroup: mkPostBind(postDownBuf, emissiveView, bloomViewB),
    bloomBlurHBindGroup: mkPostBind(postBlurHBuf, bloomViewA, bloomViewB),
    bloomBlurVBindGroup: mkPostBind(postBlurVBuf, bloomViewB, bloomViewA),
    compositeBindGroup: mkPostBind(postCompBuf, sceneView, bloomViewA),
  };
}

export function uploadWebGpuFrameUniforms(
  device: GPUDevice,
  bufs: WebGpuCoreBuffers,
  skyUniformData: Float32Array<ArrayBuffer>,
  lightUniformData: Float32Array<ArrayBuffer>,
  postUniformData: Float32Array<ArrayBuffer>,
  occStaging: Uint8Array<ArrayBuffer>,
  occlusionTexture: GPUTexture,
  lastOcclusionVersion: number,
  paletteRows: number,
  sky: SkyGradient,
  timeSec: number,
  viewW: number,
  viewH: number,
  rt: PostRenderTargets,
  lightsData: Float32Array | undefined,
  lightCount: number,
  occlusion: GpuOcclusionState | undefined,
): number {
  skyUniformData[0] = sky.top[0];
  skyUniformData[1] = sky.top[1];
  skyUniformData[2] = sky.top[2];
  skyUniformData[3] = 1;
  skyUniformData[4] = sky.bottom[0];
  skyUniformData[5] = sky.bottom[1];
  skyUniformData[6] = sky.bottom[2];
  skyUniformData[7] = 1;
  skyUniformData[8] = timeSec;
  skyUniformData[9] = sky.cozyFilter ? 1 : 0;
  skyUniformData[10] = viewW;
  skyUniformData[11] = viewH;
  const mid = sky.mid;
  skyUniformData[12] = paletteRows;
  skyUniformData[13] = mid ? mid[0] : (sky.top[0] + sky.bottom[0]) * 0.5;
  skyUniformData[14] = mid ? mid[1] : (sky.top[1] + sky.bottom[1]) * 0.5;
  skyUniformData[15] = mid ? mid[2] : (sky.top[2] + sky.bottom[2]) * 0.5;
  device.queue.writeBuffer(bufs.skyUniformBuffer, 0, skyUniformData);

  let nextOccVersion = lastOcclusionVersion;
  const occOn = Boolean(
    occlusion?.enabled && occlusion.data && occlusion.cols > 0 && occlusion.rows > 0 && occlusion.shadowStrength > 0.001,
  );
  if (occOn && occlusion && occlusion.data && occlusion.version !== lastOcclusionVersion) {
    occStaging.fill(0);
    const copyRows = Math.min(OCCLUSION_GRID_MAX, occlusion.rows);
    const copyCols = Math.min(OCCLUSION_GRID_MAX, occlusion.cols);
    for (let r = 0; r < copyRows; r++) {
      const srcRow = r * OCCLUSION_GRID_MAX;
      const dstRow = r * 256;
      for (let c = 0; c < copyCols; c++) {
        occStaging[dstRow + c] = occlusion.data[srcRow + c];
      }
    }
    device.queue.writeTexture(
      { texture: occlusionTexture },
      occStaging,
      { bytesPerRow: 256, rowsPerImage: OCCLUSION_GRID_MAX },
      { width: OCCLUSION_GRID_MAX, height: OCCLUSION_GRID_MAX, depthOrArrayLayers: 1 },
    );
    nextOccVersion = occlusion.version;
  }

  const safeLights = lightsData ? Math.max(0, Math.min(MAX_DYNAMIC_LIGHTS, lightCount | 0)) : 0;
  lightUniformData[0] = safeLights;
  lightUniformData[1] = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.cols) : 0;
  lightUniformData[2] = occOn && occlusion ? Math.min(OCCLUSION_GRID_MAX, occlusion.rows) : 0;
  lightUniformData[3] = occOn && occlusion ? occlusion.shadowStrength : 0;
  lightUniformData[4] = occOn && occlusion ? occlusion.originScreenX : 0;
  lightUniformData[5] = occOn && occlusion ? occlusion.originScreenY : 0;
  lightUniformData[6] = occOn && occlusion ? Math.max(1, occlusion.tileSizePx) : 32;
  lightUniformData[7] = occOn && occlusion ? occlusion.shadowSoftness : 0.35;
  for (let i = 0; i < safeLights; i++) {
    const src = i * 8;
    const posDst = 8 + i * 4;
    const colDst = 8 + MAX_DYNAMIC_LIGHTS * 4 + i * 4;
    lightUniformData[posDst] = lightsData![src];
    lightUniformData[posDst + 1] = lightsData![src + 1];
    lightUniformData[posDst + 2] = lightsData![src + 2];
    lightUniformData[posDst + 3] = lightsData![src + 7];
    lightUniformData[colDst] = lightsData![src + 4];
    lightUniformData[colDst + 1] = lightsData![src + 5];
    lightUniformData[colDst + 2] = lightsData![src + 6];
    lightUniformData[colDst + 3] = lightsData![src + 3];
  }
  device.queue.writeBuffer(bufs.lightUniformBuffer, 0, lightUniformData);

  postUniformData[8] = viewW;
  postUniformData[9] = viewH;
  postUniformData[10] = viewW + OVERSCAN_PAD * 2;
  postUniformData[11] = viewH + OVERSCAN_PAD * 2;
  const wt = sky.waterTint;
  postUniformData[12] = sky.waterLevelNorm ?? 0;
  postUniformData[13] = wt ? wt[0] : 0.227;
  postUniformData[14] = wt ? wt[1] : 0.431;
  postUniformData[15] = wt ? wt[2] : 0.612;
  postUniformData[16] = sky.tiltShiftBlur ?? 0;
  postUniformData[17] = sky.tiltShiftFocusY ?? 0.52;
  postUniformData[18] = 0;
  postUniformData[19] = 0;
  postUniformData[2] = sky.glowIntensity;
  postUniformData[3] = sky.filterMode;
  postUniformData[4] = timeSec;
  postUniformData[5] = sky.cozyFilter ? 1 : 0;

  if (sky.glowIntensity > 0.01) {
    postUniformData[0] = 1 / rt.osW;
    postUniformData[1] = 1 / rt.osH;
    postUniformData[6] = 0;
    postUniformData[7] = 0;
    device.queue.writeBuffer(bufs.postDownBuf, 0, postUniformData);

    postUniformData[0] = 1.25 / rt.bloomW;
    postUniformData[1] = 0;
    device.queue.writeBuffer(bufs.postBlurHBuf, 0, postUniformData);

    postUniformData[0] = 0;
    postUniformData[1] = 1.25 / rt.bloomH;
    device.queue.writeBuffer(bufs.postBlurVBuf, 0, postUniformData);
  }

  postUniformData[0] = 1 / rt.osW;
  postUniformData[1] = 1 / rt.osH;
  postUniformData[6] = sky.camFracX ?? 0;
  postUniformData[7] = sky.camFracY ?? 0;
  device.queue.writeBuffer(bufs.postCompBuf, 0, postUniformData);
  return nextOccVersion;
}

export function writeWebGpuQuad3dCameraUniforms(
  device: GPUDevice,
  cam3dScratch: ComputedCamera3D,
  viewProj3d: Float32Array,
  lightViewProj3d: Float32Array,
  quad3dUniformData: Float32Array<ArrayBuffer>,
  subViewW: number,
  subViewH: number,
  cam: GpuCamera3DState,
  runShadowPass: boolean,
  mesh3d: Mesh3DPassData | undefined,
  opaqueBuf: GPUBuffer,
  blendBuf: GPUBuffer,
): void {
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
    cam3dScratch,
  );
  buildCamera3DViewProjMatrix(cam3dScratch, true, viewProj3d);

  quad3dUniformData.set(viewProj3d, 0);
  quad3dUniformData.set(lightViewProj3d, 16);
  quad3dUniformData[32] = cam.occOriginWorldX;
  quad3dUniformData[33] = cam.occOriginWorldY;
  quad3dUniformData[34] = Math.max(1, cam.occTileSizeWorld);
  quad3dUniformData[35] = 1.0;
  quad3dUniformData[36] = subViewW;
  quad3dUniformData[37] = subViewH;
  quad3dUniformData[38] = cam.camCenterX;
  quad3dUniformData[39] = cam.camCenterY;
  quad3dUniformData[40] = cam3dScratch.eyeX;
  quad3dUniformData[41] = cam3dScratch.eyeY;
  quad3dUniformData[42] = cam3dScratch.eyeZ;
  quad3dUniformData[43] = runShadowPass ? 1.0 : 0.0;
  quad3dUniformData[44] = cam.sunDirX;
  quad3dUniformData[45] = cam.sunDirY;
  quad3dUniformData[46] = cam.sunDirZ;
  quad3dUniformData[47] = cam.shadowStrength;
  const lz = mesh3d?.lightPosZ;
  for (let i = 0; i < MAX_DYNAMIC_LIGHTS; i++) {
    quad3dUniformData[48 + i] = lz && i < lz.length ? lz[i] : 24.0;
  }
  device.queue.writeBuffer(opaqueBuf, 0, quad3dUniformData);
  quad3dUniformData[35] = 0.0;
  device.queue.writeBuffer(blendBuf, 0, quad3dUniformData);
}

export function uploadWebGpu3dPassBuffers(
  device: GPUDevice,
  bufs: WebGpuCoreBuffers,
  mesh3dRes: Mesh3dGpuResources,
  cam3dScratch: ComputedCamera3D,
  viewProj3d: Float32Array,
  lightViewProj3d: Float32Array,
  quad3dUniformData: Float32Array<ArrayBuffer>,
  viewW: number,
  viewH: number,
  quad3d: Quad3DPassData,
  mesh3d: Mesh3DPassData | undefined,
  runShadowPass: boolean,
  safe3dOpaque: number,
  safe3dAlpha: number,
  safe3dAdd: number,
  safeMeshOpaqueV: number,
  safeMeshOpaqueI: number,
  safeMeshAlphaV: number,
  safeMeshAlphaI: number,
  safeLine3dV: number,
): void {
  writeWebGpuQuad3dCameraUniforms(
    device, cam3dScratch, viewProj3d, lightViewProj3d, quad3dUniformData,
    viewW, viewH, quad3d.camera, runShadowPass, mesh3d, bufs.quad3dOpaqueUniBuf, bufs.quad3dBlendUniBuf,
  );
  if (quad3d.quadViews) {
    const subW = viewW * 0.5;
    const subH = viewH * 0.5;
    for (let q = 0; q < 4; q++) {
      writeWebGpuQuad3dCameraUniforms(
        device, cam3dScratch, viewProj3d, lightViewProj3d, quad3dUniformData,
        subW, subH, quad3d.quadViews[q], runShadowPass, mesh3d,
        mesh3dRes.quadViewOpaqueUniBufs[q], mesh3dRes.quadViewBlendUniBufs[q],
      );
    }
  }
  if (safe3dOpaque > 0) {
    device.queue.writeBuffer(
      bufs.quad3dOpaqueBuffer, 0, quad3d.opaqueData.buffer, quad3d.opaqueData.byteOffset, safe3dOpaque * FLOATS_PER_QUAD3D * 4,
    );
  }
  if (safe3dAlpha > 0) {
    device.queue.writeBuffer(
      bufs.quad3dAlphaBuffer, 0, quad3d.alphaData.buffer, quad3d.alphaData.byteOffset, safe3dAlpha * FLOATS_PER_QUAD3D * 4,
    );
  }
  if (safe3dAdd > 0) {
    device.queue.writeBuffer(
      bufs.quad3dAddBuffer, 0, quad3d.additiveData.buffer, quad3d.additiveData.byteOffset, safe3dAdd * FLOATS_PER_QUAD3D * 4,
    );
  }
  if (mesh3d && safeMeshOpaqueV > 0 && safeMeshOpaqueI > 0) {
    device.queue.writeBuffer(
      mesh3dRes.opaqueVertBuf, 0, mesh3d.opaqueVertices.buffer, mesh3d.opaqueVertices.byteOffset, safeMeshOpaqueV * FLOATS_PER_MESH3D_VERTEX * 4,
    );
    device.queue.writeBuffer(
      mesh3dRes.opaqueIdxBuf, 0, mesh3d.opaqueIndices.buffer, mesh3d.opaqueIndices.byteOffset, safeMeshOpaqueI * 4,
    );
  }
  if (mesh3d && safeMeshAlphaV > 0 && safeMeshAlphaI > 0) {
    device.queue.writeBuffer(
      mesh3dRes.alphaVertBuf, 0, mesh3d.alphaVertices.buffer, mesh3d.alphaVertices.byteOffset, safeMeshAlphaV * FLOATS_PER_MESH3D_VERTEX * 4,
    );
    device.queue.writeBuffer(
      mesh3dRes.alphaIdxBuf, 0, mesh3d.alphaIndices.buffer, mesh3d.alphaIndices.byteOffset, safeMeshAlphaI * 4,
    );
  }
  if (mesh3d && safeLine3dV > 0) {
    device.queue.writeBuffer(
      mesh3dRes.lineVertBuf, 0, mesh3d.lineVertices.buffer, mesh3d.lineVertices.byteOffset, safeLine3dV * FLOATS_PER_MESH3D_VERTEX * 4,
    );
  }
}
