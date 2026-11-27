import {
  FLOATS_PER_INSTANCE,
  FLOATS_PER_MESH3D_VERTEX,
  FLOATS_PER_QUAD3D,
} from './GpuTypes.ts';
import type { Mesh3dGpuResources, WebGpuCoreBuffers } from './WebGpuResources.ts';

export interface WebGpuPipelineBundle {
  skyPipeline: GPURenderPipeline;
  sky3dPipeline: GPURenderPipeline;
  alphaPipeline: GPURenderPipeline;
  addPipeline: GPURenderPipeline;
  quad3dOpaquePipeline: GPURenderPipeline;
  quad3dAlphaPipeline: GPURenderPipeline;
  quad3dAddPipeline: GPURenderPipeline;
  bloomDownPipeline: GPURenderPipeline;
  bloomBlurPipeline: GPURenderPipeline;
  compositePipeline: GPURenderPipeline;
  pass1BindGroupLayout: GPUBindGroupLayout;
  postBindGroupLayout: GPUBindGroupLayout;
  quad3dOpaqueBindGroup: GPUBindGroup;
  quad3dBlendBindGroup: GPUBindGroup;
  mesh3dRes: Mesh3dGpuResources;
}

export async function createWebGpuPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  sceneModule: GPUShaderModule,
  postModule: GPUShaderModule,
  buffers: WebGpuCoreBuffers,
): Promise<WebGpuPipelineBundle> {
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

  const shadowBindGroupLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
  });
  const shadowBindGroup = device.createBindGroup({
    layout: shadowBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: buffers.quad3dOpaqueUniBuf } }],
  });

  const quad3dBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    ],
  });
  const mkQuad3dUniBuf = () =>
    device.createBuffer({
      size: 288,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  const mkQuad3dBindGroup = (buf: GPUBuffer) =>
    device.createBindGroup({
      layout: quad3dBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buf } },
        { binding: 1, resource: buffers.shadowDepthView },
        { binding: 2, resource: buffers.shadowSampler },
      ],
    });
  const quad3dOpaqueBindGroup = mkQuad3dBindGroup(buffers.quad3dOpaqueUniBuf);
  const quad3dBlendBindGroup = mkQuad3dBindGroup(buffers.quad3dBlendUniBuf);
  const quadViewOpaqueUniBufs: readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer] = [
    mkQuad3dUniBuf(),
    mkQuad3dUniBuf(),
    mkQuad3dUniBuf(),
    mkQuad3dUniBuf(),
  ];
  const quadViewBlendUniBufs: readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer] = [
    mkQuad3dUniBuf(),
    mkQuad3dUniBuf(),
    mkQuad3dUniBuf(),
    mkQuad3dUniBuf(),
  ];
  const quadViewOpaqueBindGroups: readonly [GPUBindGroup, GPUBindGroup, GPUBindGroup, GPUBindGroup] = [
    mkQuad3dBindGroup(quadViewOpaqueUniBufs[0]),
    mkQuad3dBindGroup(quadViewOpaqueUniBufs[1]),
    mkQuad3dBindGroup(quadViewOpaqueUniBufs[2]),
    mkQuad3dBindGroup(quadViewOpaqueUniBufs[3]),
  ];
  const quadViewBlendBindGroups: readonly [GPUBindGroup, GPUBindGroup, GPUBindGroup, GPUBindGroup] = [
    mkQuad3dBindGroup(quadViewBlendUniBufs[0]),
    mkQuad3dBindGroup(quadViewBlendUniBufs[1]),
    mkQuad3dBindGroup(quadViewBlendUniBufs[2]),
    mkQuad3dBindGroup(quadViewBlendUniBufs[3]),
  ];

  const postBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });

  const pass1PipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [pass1BindGroupLayout] });
  const shadowPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [pass1BindGroupLayout, shadowBindGroupLayout],
  });
  const quad3dPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [pass1BindGroupLayout, quad3dBindGroupLayout],
  });
  const postPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [postBindGroupLayout] });

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

  const mesh3dLayout: GPUVertexBufferLayout = {
    arrayStride: FLOATS_PER_MESH3D_VERTEX * 4,
    stepMode: 'vertex',
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
    sky3dPipeline,
    alphaPipeline,
    addPipeline,
    quad3dOpaquePipeline,
    quad3dAlphaPipeline,
    quad3dAddPipeline,
    shadowMeshPipeline,
    shadowQuadPipeline,
    meshOpaquePipeline,
    meshAlphaPipeline,
    line3dPipeline,
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
      layout: shadowPipelineLayout,
      vertex: { module: sceneModule, entryPoint: 'vsShadowMesh3D', buffers: [mesh3dLayout] },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
        depthBias: 2,
        depthBiasSlopeScale: 2.0,
      },
    }),
    device.createRenderPipelineAsync({
      layout: shadowPipelineLayout,
      vertex: { module: sceneModule, entryPoint: 'vsShadowQuad3D', buffers: [quad3dLayout] },
      fragment: { module: sceneModule, entryPoint: 'fsShadowQuad3D', targets: [] },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
        depthBias: 2,
        depthBiasSlopeScale: 2.0,
      },
    }),
    device.createRenderPipelineAsync({
      layout: quad3dPipelineLayout,
      vertex: { module: sceneModule, entryPoint: 'vsMesh3D', buffers: [mesh3dLayout] },
      fragment: {
        module: sceneModule,
        entryPoint: 'fsMesh3D',
        targets: [{ format: mrtFormat }, { format: mrtFormat }],
      },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
    }),
    device.createRenderPipelineAsync({
      layout: quad3dPipelineLayout,
      vertex: { module: sceneModule, entryPoint: 'vsMesh3D', buffers: [mesh3dLayout] },
      fragment: {
        module: sceneModule,
        entryPoint: 'fsMesh3D',
        targets: [
          { format: mrtFormat, blend: alphaBlend },
          { format: mrtFormat, blend: alphaBlend },
        ],
      },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    }),
    device.createRenderPipelineAsync({
      layout: quad3dPipelineLayout,
      primitive: { topology: 'line-list' },
      vertex: { module: sceneModule, entryPoint: 'vsMesh3D', buffers: [mesh3dLayout] },
      fragment: {
        module: sceneModule,
        entryPoint: 'fsMesh3D',
        targets: [
          { format: mrtFormat, blend: alphaBlend },
          { format: mrtFormat, blend: alphaBlend },
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

  const mesh3dRes: Mesh3dGpuResources = {
    shadowDepthTexture: buffers.shadowDepthTexture,
    shadowDepthView: buffers.shadowDepthView,
    shadowSampler: buffers.shadowSampler,
    shadowBindGroup,
    shadowMeshPipeline,
    shadowQuadPipeline,
    meshOpaquePipeline,
    meshAlphaPipeline,
    line3dPipeline,
    opaqueVertBuf: buffers.meshOpaqueVertBuf,
    opaqueIdxBuf: buffers.meshOpaqueIdxBuf,
    alphaVertBuf: buffers.meshAlphaVertBuf,
    alphaIdxBuf: buffers.meshAlphaIdxBuf,
    lineVertBuf: buffers.line3dVertBuf,
    quadViewOpaqueUniBufs,
    quadViewBlendUniBufs,
    quadViewOpaqueBindGroups,
    quadViewBlendBindGroups,
  };

  return {
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
    pass1BindGroupLayout,
    postBindGroupLayout,
    quad3dOpaqueBindGroup,
    quad3dBlendBindGroup,
    mesh3dRes,
  };
}
