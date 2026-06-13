import "./style.css";
import { loadGraphicsAssets, type LoadedModelAsset } from "./assetLoader";
import type { AirExports, AirGfxManifest, AirPackageMetadata, PipelineRef, RenderGraphRef } from "./types";

const canvasEl = document.querySelector<HTMLCanvasElement>("#gpu-canvas");
const statusNode = document.querySelector<HTMLSpanElement>("#status");
const diagnostics = {
  package: document.querySelector<HTMLElement>("#diag-package"),
  manifest: document.querySelector<HTMLElement>("#diag-manifest"),
  backend: document.querySelector<HTMLElement>("#diag-backend"),
  drawCalls: document.querySelector<HTMLElement>("#diag-draw-calls"),
  capabilities: document.querySelector<HTMLElement>("#diag-capabilities"),
  assets: document.querySelector<HTMLElement>("#diag-assets"),
  unsupported: document.querySelector<HTMLElement>("#diag-unsupported")
};

if (!canvasEl || !statusNode) throw new Error("missing canvas or status element");
const canvas = canvasEl;
const statusEl = statusNode;

const packageUrl = "/air-package.json";
const CURRENT_ABI = "0.10";
const SUPPORTED_MANIFEST_VERSIONS = new Set(["0.9", "0.10"]);

const HOST_IMPORTS: Record<string, Set<string>> = {
  gpu: new Set([
    "begin_frame",
    "begin_pass",
    "set_scene_time",
    "set_camera",
    "set_camera_matrix",
    "set_pipeline",
    "set_bind_group",
    "set_vertex_buffer",
    "set_index_buffer",
    "draw",
    "draw_indexed",
    "draw_instanced",
    "draw_mesh_instanced",
    "draw_sprite_batch",
    "draw_scene_node",
    "draw_voxel_chunk",
    "draw_particles",
    "execute_render_graph",
    "end_pass",
    "submit",
    "destroy"
  ]),
  input: new Set(["axis", "button", "pointer_delta_x", "pointer_delta_y", "pointer_down", "touch_axis"])
};

type GpuState = {
  metadata: AirPackageMetadata;
  manifest: AirGfxManifest;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  pipelines: Map<number, GPURenderPipeline>;
  pipelineKeys: Map<string, GPURenderPipeline>;
  renderTargets: Map<string, GPUTexture>;
  depthTexture: GPUTexture | null;
  encoder: GPUCommandEncoder | null;
  pass: GPURenderPassEncoder | null;
  activePipeline: GPURenderPipeline | null;
  clearColor: GPUColor;
  sceneTimeMs: number;
  activeCamera: number | null;
  cameraMatrices: Map<number, Float32Array>;
  wasmMemory: WebAssembly.Memory | null;
  frameCount: number;
  drawCalls: number;
  passStats: Record<string, number>;
  input: InputState;
  warnings: string[];
  loadedAssets: string[];
  missingAssets: string[];
  loadedModelAssets: string[];
  unsupportedGltfFeatures: string[];
  materialFallbacks: string[];
  modelAssets: Map<string, LoadedModelAsset>;
};

type InputState = {
  axes: Map<number, number>;
  buttons: Map<number, boolean>;
  pointerDeltaX: number;
  pointerDeltaY: number;
  pointerDown: boolean;
  keyState: Set<string>;
};

const state: Partial<GpuState> = {
  encoder: null,
  pass: null,
  activePipeline: null,
  clearColor: { r: 0.02, g: 0.027, b: 0.07, a: 1 },
  sceneTimeMs: 0,
  activeCamera: null,
  cameraMatrices: new Map(),
  wasmMemory: null,
  frameCount: 0,
  drawCalls: 0,
  passStats: {},
  warnings: [],
  loadedAssets: [],
  missingAssets: [],
  loadedModelAssets: [],
  unsupportedGltfFeatures: [],
  materialFallbacks: [],
  modelAssets: new Map(),
  input: {
    axes: new Map(),
    buttons: new Map(),
    pointerDeltaX: 0,
    pointerDeltaY: 0,
    pointerDown: false,
    keyState: new Set()
  }
};

bootstrap().catch((error: unknown) => {
  publishRuntimeError(error);
});

async function bootstrap() {
  const { metadata, manifest, wasmUrl } = await loadPackageFromMetadata(packageUrl);
  state.metadata = metadata;
  state.manifest = manifest;
  validatePackageContract(metadata, manifest);

  if (!("gpu" in navigator)) {
    markUnsupported("WebGPU unsupported");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    markUnsupported("WebGPU adapter unavailable");
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) {
    markUnsupported("WebGPU context unavailable");
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  resizeCanvas();
  context.configure({ device, format, alphaMode: "opaque" });

  state.device = device;
  state.context = context;
  state.format = format;
  const pipelines = await createPipelines(device, format, manifest);
  state.pipelines = pipelines.byHandle;
  state.pipelineKeys = pipelines.byKey;
  state.clearColor = colorFromBytes(manifest.canvas?.clearColor || [5, 7, 18, 255]);
  installInputHandlers(manifest);
  rebuildFrameResources();

  await preflightAssets(device, manifest);
  if (state.missingAssets?.length) {
    throw new Error(`missing package assets: ${state.missingAssets.join(", ")}`);
  }
  const exports = await loadAir(wasmUrl, createImports());
  statusEl.textContent = `AIR wasm linked: ${metadata.module}`;
  publishConformanceReport("ready");
  window.dispatchEvent(new CustomEvent("airgfx-ready"));

  function frame(time: number) {
    try {
      resizeCanvas();
      exports.frame(Math.floor(time));
      requestAnimationFrame(frame);
    } catch (error) {
      publishRuntimeError(error);
    }
  }
  requestAnimationFrame(frame);
}

async function loadPackageFromMetadata(url: string) {
  const metadata = await fetchJson<AirPackageMetadata>(url);
  validatePackageMetadata(metadata);
  const manifestUrl = `/${metadata.manifest}`;
  const manifestBytes = await fetchArrayBuffer(manifestUrl);
  await validateManifestHash(metadata, manifestBytes);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as AirGfxManifest;
  return { metadata, manifest, wasmUrl: `/${metadata.wasm}` };
}

function validatePackageMetadata(metadata: AirPackageMetadata) {
  if (!metadata || typeof metadata !== "object") throw new Error("air-package.json must be an object");
  if (!metadata.module) throw new Error("air-package.json is missing module");
  if (!metadata.wasm) throw new Error("air-package.json is missing wasm");
  if (!metadata.manifest) throw new Error("air-package.json is missing manifest");
  if (!metadata.abi) throw new Error("air-package.json is missing abi");
  if (metadata.abi !== CURRENT_ABI) {
    state.warnings?.push(`package abi ${metadata.abi} loaded by AIR GFX ${CURRENT_ABI} reference host`);
  }
  const capabilities = new Set(metadata.capabilities || []);
  if (!capabilities.has("gpu")) throw new Error("AIR GFX package metadata must include capability gpu");
  for (const item of metadata.imports || []) {
    const [moduleName, fieldName] = item.name.split(".");
    if (!moduleName || !fieldName) throw new Error(`invalid import name '${item.name}' in package metadata`);
    if (!HOST_IMPORTS[moduleName]?.has(fieldName)) throw new Error(`host missing ${item.name}`);
    if (!capabilities.has(moduleName)) {
      throw new Error(`import ${item.name} requires capability ${moduleName} in package metadata`);
    }
  }
}

function validatePackageContract(metadata: AirPackageMetadata, manifest: AirGfxManifest) {
  if (!SUPPORTED_MANIFEST_VERSIONS.has(manifest.version)) {
    throw new Error(`manifest.version '${manifest.version}' is unsupported by this AIR GFX host; expected ${Array.from(SUPPORTED_MANIFEST_VERSIONS).join(", ")}`);
  }
  if (manifest.module !== metadata.module) {
    throw new Error(`manifest.module '${manifest.module}' does not match package module '${metadata.module}'`);
  }
  if (manifest.package?.abi && manifest.package.abi !== metadata.abi) {
    throw new Error(`manifest package abi '${manifest.package.abi}' does not match package abi '${metadata.abi}'`);
  }
  if (manifest.version !== CURRENT_ABI) {
    state.warnings?.push(`manifest version ${manifest.version} loaded through compatibility path; current host ABI is ${CURRENT_ABI}`);
  }
  if (manifest.inputs && !(metadata.capabilities || []).includes("input")) {
    throw new Error("manifest declares inputs but package metadata does not include capability input");
  }
}

async function validateManifestHash(metadata: AirPackageMetadata, bytes: ArrayBuffer) {
  if (!metadata.manifestHash || !crypto.subtle) return;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== metadata.manifestHash) throw new Error(`manifest hash mismatch for ${metadata.manifest}`);
}

async function createPipelines(device: GPUDevice, format: GPUTextureFormat, manifest: AirGfxManifest) {
  const byHandle = new Map<number, GPURenderPipeline>();
  const byKey = new Map<string, GPURenderPipeline>();
  for (const [key, pipeline] of Object.entries(manifest.pipelines || {})) {
    const handle = manifest.handles?.pipelines?.[key];
    if (!handle) continue;
    const shader = manifest.shaders?.[pipeline.shader];
    if (!shader) throw new Error(`missing shader '${pipeline.shader}' referenced by pipeline '${key}'`);
    const code = await fetchText(shader.path, `shader '${pipeline.shader}'`);
    const module = await createShaderModuleChecked(device, key, pipeline.shader, shader.path, code);
    const gpuPipeline = createPipeline(device, format, module, pipeline);
    byHandle.set(handle, gpuPipeline);
    byKey.set(key, gpuPipeline);
  }
  return { byHandle, byKey };
}

async function createShaderModuleChecked(device: GPUDevice, pipelineKey: string, shaderKey: string, shaderPath: string, code: string) {
  const module = device.createShaderModule({ label: pipelineKey, code });
  if (typeof module.getCompilationInfo !== "function") return module;
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  const warnings = info.messages.filter((message) => message.type === "warning");
  for (const warning of warnings) {
    state.warnings?.push(`shader warning '${shaderKey}' (${shaderPath}): ${formatShaderMessage(warning)}`);
  }
  if (errors.length) {
    throw new Error(`shader compile failure '${shaderKey}' (${shaderPath}) for pipeline '${pipelineKey}': ${errors.map(formatShaderMessage).join("; ")}`);
  }
  return module;
}

function formatShaderMessage(message: GPUCompilationMessage) {
  const location = message.lineNum > 0 ? `${message.lineNum}:${message.linePos}` : `offset ${message.offset}`;
  return `${location} ${message.message}`;
}

function createPipeline(device: GPUDevice, format: GPUTextureFormat, module: GPUShaderModule, pipeline: PipelineRef) {
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: pipeline.vertexEntry || "vs_main"
    },
    fragment: {
      module,
      entryPoint: pipeline.fragmentEntry || "fs_main",
      targets: [
        {
          format,
          blend:
            pipeline.blend === "alpha"
              ? {
                  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
                }
              : undefined
        }
      ]
    },
    primitive: {
      topology: pipeline.primitive || "triangle-list",
      cullMode: pipeline.cull === "none" ? "none" : pipeline.cull || "none"
    },
    depthStencil:
      pipeline.depth === true
        ? {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less"
          }
        : undefined
  });
}

function createImports(): WebAssembly.Imports {
  return {
    gpu: {
      begin_frame: (r: number, g: number, b: number, a: number) => {
        state.clearColor = { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
      },
      begin_pass: () => {
        beginGpuPass("clear");
      },
      set_scene_time: (timeMs: number) => {
        state.sceneTimeMs = timeMs;
      },
      set_camera: (cameraHandle: number) => {
        if (!handleExists(state.manifest?.handles?.cameras, cameraHandle)) throw new Error(`unknown camera handle ${cameraHandle}`);
        state.activeCamera = cameraHandle;
      },
      set_camera_matrix: (cameraHandle: number, ptr: number, len: number) => {
        if (!handleExists(state.manifest?.handles?.cameras, cameraHandle)) throw new Error(`unknown camera handle ${cameraHandle}`);
        if (len !== 64) throw new Error(`gpu.set_camera_matrix expects 64 bytes, got ${len}`);
        const memory = requireState(state.wasmMemory, "wasm memory");
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        state.cameraMatrices?.set(cameraHandle, new Float32Array(bytes.slice().buffer));
      },
      set_pipeline: (pipelineHandle: number) => {
        const pipeline = state.pipelines?.get(pipelineHandle);
        if (!pipeline) throw new Error(`unknown pipeline handle ${pipelineHandle}`);
        requireState(state.pass, "pass").setPipeline(pipeline);
        state.activePipeline = pipeline;
      },
      set_bind_group: () => {},
      set_vertex_buffer: () => {},
      set_index_buffer: () => {},
      draw: (vertexCount: number, instanceCount: number) => {
        recordDraw("raw", instanceCount);
        requireDrawReady().draw(vertexCount, instanceCount);
      },
      draw_indexed: (indexCount: number, instanceCount: number) => {
        recordDraw("indexed", instanceCount);
        requireDrawReady().draw(indexCount, instanceCount);
      },
      draw_instanced: (vertexCount: number, instanceCount: number) => {
        recordDraw("instanced", instanceCount);
        requireDrawReady().draw(vertexCount, instanceCount);
      },
      draw_mesh_instanced: (meshHandle: number, instances: number) => {
        bindModelBuffers(keyForHandle(state.manifest?.handles?.models, meshHandle));
        recordDraw("mesh", instances);
        requireDrawReady().draw(3, Math.max(1, instances));
      },
      draw_sprite_batch: (_spriteHandle: number, count: number) => {
        recordDraw("sprite", count);
        requireDrawReady().draw(3, Math.max(1, count));
      },
      draw_scene_node: (nodeHandle: number, instances: number) => {
        const nodeKey = keyForHandle(state.manifest?.handles?.nodes, nodeHandle);
        const meshKey = nodeKey ? state.manifest?.scene?.nodes?.[nodeKey]?.mesh : undefined;
        bindModelBuffers(meshKey);
        recordDraw("node", instances);
        requireDrawReady().draw(3, Math.max(1, instances));
      },
      draw_voxel_chunk: (_voxelHandle: number, instances: number) => {
        recordDraw("voxel", instances);
        requireDrawReady().draw(3, Math.max(1, instances));
      },
      draw_particles: (_particleHandle: number, instances: number) => {
        recordDraw("particles", instances);
        requireDrawReady().draw(3, Math.max(1, instances));
      },
      execute_render_graph: (graphHandle: number) => {
        executeRenderGraph(graphHandle);
      },
      end_pass: () => {
        requireState(state.pass, "pass").end();
        state.pass = null;
        state.activePipeline = null;
      },
      submit: () => {
        const device = requireState(state.device, "device");
        const encoder = requireState(state.encoder, "encoder");
        device.queue.submit([encoder.finish()]);
        state.encoder = null;
      },
      destroy: () => {}
    },
    input: {
      axis: (id: number) => state.input?.axes.get(id) || 0,
      button: (id: number) => (state.input?.buttons.get(id) ? 1 : 0),
      pointer_delta_x: () => state.input?.pointerDeltaX || 0,
      pointer_delta_y: () => state.input?.pointerDeltaY || 0,
      pointer_down: () => (state.input?.pointerDown ? 1 : 0),
      touch_axis: (id: number) => state.input?.axes.get(id) || 0
    }
  };
}

function executeRenderGraph(graphHandle: number) {
  const manifest = requireState(state.manifest, "manifest");
  const graphKey = keyForHandle(manifest.handles?.renderGraphs, graphHandle);
  if (!graphKey) throw new Error(`unknown render graph handle ${graphHandle}`);
  const graph = manifest.renderGraphs?.[graphKey];
  if (!graph) throw new Error(`missing render graph ${graphKey}`);

  state.passStats = {};
  state.drawCalls = 0;
  beginGraphPass();
  runGraphPasses(graph);
  finishGpuPass();
  beginSurfacePass("clear");
  drawPostProbe("present");
  finishGpuPass();
  submitGpuWork();
  state.frameCount = (state.frameCount || 0) + 1;
  publishConformanceReport("ready");
}

function runGraphPasses(graph: RenderGraphRef) {
  for (const pass of graph.passes) {
    if (pass.kind === "skybox" || pass.kind === "environment") {
      const pipelineKey = pass.pipeline || materialPipeline(pass.material);
      setPipelineByKey(pipelineKey);
      recordDraw("skybox", 1);
      requireDrawReady().draw(3, 1);
    } else if (pass.kind === "geometry") {
      const pipelineKey = pass.pipeline || materialPipeline(pass.material);
      setPipelineByKey(pipelineKey);
      const nodes = Object.values(state.manifest?.scene?.nodes || {});
      const sceneInstances = Object.values(state.manifest?.scene?.instances || {});
      const meshInstances = Object.values(state.manifest?.scene?.meshInstances || {});
      const instances =
        nodes.reduce((sum, node) => sum + Math.max(1, node.instances || 1), 0) +
        sceneInstances.reduce((sum, item) => sum + Math.max(1, item.count || 1), 0) +
        meshInstances.reduce((sum, item) => sum + Math.max(1, item.count || 1), 0);
      bindModelBuffers(firstGeometryModelKey());
      recordDraw("geometry", instances);
      requireDrawReady().draw(vertexCountForPipeline(pipelineKey), Math.max(1, instances));
    } else if (pass.kind === "voxel") {
      const pipelineKey = pass.pipeline || materialPipeline(pass.material);
      setPipelineByKey(pipelineKey);
      const voxels = Object.values(state.manifest?.scene?.voxels || {});
      const instances = voxels.reduce((sum, voxel) => sum + Math.min(Math.max(1, Math.floor((voxel.budget || 64) / 64)), 64), 0);
      recordDraw("voxel", instances);
      requireDrawReady().draw(vertexCountForPipeline(pipelineKey), Math.max(1, instances));
    } else if (pass.kind === "particles") {
      const pipelineKey = pass.pipeline || materialPipeline(pass.material);
      setPipelineByKey(pipelineKey);
      const particles = Object.values(state.manifest?.scene?.particles || {});
      const instances = particles.reduce((sum, item) => sum + Math.max(1, Math.min(item.count || item.budget || 1, item.budget || item.count || 1)), 0);
      recordDraw("particles", instances);
      requireDrawReady().draw(vertexCountForPipeline(pipelineKey), Math.max(1, instances));
    } else if (pass.kind === "sprite" || pass.kind === "ui") {
      const pipelineKey = pass.pipeline || materialPipeline(pass.material);
      setPipelineByKey(pipelineKey);
      const sprites = Object.values(state.manifest?.scene?.sprites || {});
      const uiPanels = Object.keys(state.manifest?.ui?.panels || {}).length;
      const instances = sprites.reduce((sum, sprite) => sum + Math.max(1, sprite.batch || 1), 0) + (pass.kind === "ui" ? Math.max(1, uiPanels) : 0);
      recordDraw(pass.kind, instances);
      requireDrawReady().draw(vertexCountForPipeline(pipelineKey), Math.max(1, instances));
    } else if (pass.kind === "post") {
      recordDraw("post", 1);
      drawPostProbe(pass.effect);
    } else if (pass.kind === "clear" || pass.kind === "present") {
      state.passStats = {
        ...(state.passStats || {}),
        [pass.kind]: (state.passStats?.[pass.kind] || 0) + 1
      };
    } else {
      throw new Error(`unsupported render graph pass '${pass.key || "(unnamed)"}' kind '${pass.kind}'`);
    }
  }
}

function beginGpuPass(loadOp: GPULoadOp) {
  beginSurfacePass(loadOp);
}

function beginSurfacePass(loadOp: GPULoadOp) {
  const device = requireState(state.device, "device");
  const context = requireState(state.context, "context");
  if (state.pass) throw new Error("render pass already active");
  const encoder = device.createCommandEncoder();
  const view = context.getCurrentTexture().createView();
  state.encoder = encoder;
  state.pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view,
        clearValue: state.clearColor || { r: 0, g: 0, b: 0, a: 1 },
        loadOp,
        storeOp: "store"
      }
    ]
  });
}

function beginGraphPass() {
  const device = requireState(state.device, "device");
  if (state.pass) throw new Error("render pass already active");
  const encoder = device.createCommandEncoder();
  const target = state.renderTargets?.get("scene_color");
  if (!target) {
    state.encoder = encoder;
    beginSurfacePass("clear");
    return;
  }
  state.encoder = encoder;
  const depth = state.depthTexture?.createView();
  state.pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        clearValue: state.clearColor || { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }
    ],
    depthStencilAttachment: depth
      ? {
          view: depth,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store"
        }
      : undefined
  });
}

function finishGpuPass() {
  requireState(state.pass, "pass").end();
  state.pass = null;
  state.activePipeline = null;
}

function submitGpuWork() {
  const device = requireState(state.device, "device");
  const encoder = requireState(state.encoder, "encoder");
  device.queue.submit([encoder.finish()]);
  state.encoder = null;
}

function setPipelineByKey(key?: string) {
  if (!key) return;
  const pipeline = state.pipelineKeys?.get(key);
  if (!pipeline) throw new Error(`unknown pipeline key ${key}`);
  requireState(state.pass, "pass").setPipeline(pipeline);
  state.activePipeline = pipeline;
}

function materialPipeline(materialKey?: string) {
  if (!materialKey) return undefined;
  const material = state.manifest?.materials?.[materialKey];
  if (!material) throw new Error(`missing material '${materialKey}'`);
  if (!material.pipeline) throw new Error(`missing material pipeline for '${materialKey}'`);
  return material.pipeline;
}

function vertexCountForPipeline(pipelineKey?: string) {
  if (!pipelineKey) return 3;
  const pipeline = state.manifest?.pipelines?.[pipelineKey];
  return Math.max(1, Math.floor(pipeline?.vertexCount || 3));
}

function drawPostProbe(effectKey?: string) {
  const firstPipeline = [...(state.pipelineKeys || new Map()).values()][0];
  if (!firstPipeline) return;
  requireState(state.pass, "pass").setPipeline(firstPipeline);
  state.activePipeline = firstPipeline;
  const multiplier = effectKey === "bloom" ? 2 : 1;
  recordDraw(`post:${effectKey || "present"}`, multiplier);
  requireDrawReady().draw(3, multiplier);
}

function firstGeometryModelKey() {
  const manifest = state.manifest;
  const node = Object.values(manifest?.scene?.nodes || {}).find((item) => item.mesh);
  if (node?.mesh) return node.mesh;
  const sceneInstance = Object.values(manifest?.scene?.instances || {}).find((item) => item.model);
  if (sceneInstance?.model) return sceneInstance.model;
  const meshInstance = Object.values(manifest?.scene?.meshInstances || {}).find((item) => item.mesh);
  return meshInstance?.mesh;
}

function bindModelBuffers(modelKey?: string) {
  if (!modelKey) return;
  const model = state.modelAssets?.get(modelKey);
  if (!model) return;
  const pass = requireState(state.pass, "pass");
  pass.setVertexBuffer(0, model.positionBuffer);
  if (model.normalBuffer) pass.setVertexBuffer(1, model.normalBuffer);
  if (model.uvBuffer) pass.setVertexBuffer(2, model.uvBuffer);
  if (model.indexBuffer && model.indexFormat) pass.setIndexBuffer(model.indexBuffer, model.indexFormat);
}

function recordDraw(kind: string, count: number) {
  const safeCount = Math.max(1, Math.floor(count || 1));
  state.drawCalls = (state.drawCalls || 0) + 1;
  state.passStats = {
    ...(state.passStats || {}),
    [kind]: (state.passStats?.[kind] || 0) + safeCount
  };
}

function rebuildFrameResources() {
  const device = state.device;
  const manifest = state.manifest;
  if (!device || !manifest) return;
  for (const texture of state.renderTargets?.values() || []) texture.destroy();
  state.depthTexture?.destroy();
  const targets = new Map<string, GPUTexture>();
  for (const [key, target] of Object.entries(manifest.renderTargets || {})) {
    if (target.format === "surface") continue;
    const scale = target.scale || 1;
    targets.set(
      key,
      device.createTexture({
        label: key,
        size: [Math.max(1, Math.floor(canvas.width * scale)), Math.max(1, Math.floor(canvas.height * scale))],
        format: target.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
      })
    );
  }
  state.renderTargets = targets;
  state.depthTexture =
    manifest.depth?.enabled === false
      ? null
      : device.createTexture({
          label: manifest.depth?.target || "scene_depth",
          size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
          format: manifest.depth?.format || "depth24plus",
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
}

function requireDrawReady() {
  if (!state.activePipeline) throw new Error("draw before pipeline");
  return requireState(state.pass, "pass");
}

async function loadAir(url: string, imports: WebAssembly.Imports): Promise<AirExports> {
  const bytes = await fetchArrayBuffer(url);
  const module = await WebAssembly.instantiate(bytes, imports);
  const memory = module.instance.exports.memory;
  if (memory instanceof WebAssembly.Memory) state.wasmMemory = memory;
  const frame = module.instance.exports.frame;
  if (typeof frame !== "function") throw new Error("AIR module does not export frame(t)");
  return { frame: frame as AirExports["frame"] };
}

async function preflightAssets(device: GPUDevice, manifest: AirGfxManifest) {
  const report = await loadGraphicsAssets(device, manifest);
  state.modelAssets = report.models;
  state.loadedAssets = report.loadedAssets;
  state.missingAssets = report.missingAssets;
  state.loadedModelAssets = Array.from(report.models.values())
    .map((model) => `${model.key}:${model.path} vertices=${model.vertexCount} indices=${model.indexCount}`)
    .sort();
  state.unsupportedGltfFeatures = report.unsupportedFeatures;
  state.materialFallbacks = report.materialFallbacks;
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(window.innerWidth * dpr));
  const height = Math.max(1, Math.floor(window.innerHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    if (state.device) rebuildFrameResources();
  }
}

function installInputHandlers(manifest: AirGfxManifest) {
  const input = requireState(state.input, "input");
  const handles = manifest.handles?.inputs || {};
  const handle = (key: string) => handles[key] || manifest.inputs?.[key]?.handle || 0;
  window.addEventListener("keydown", (event) => {
    input.keyState.add(event.code);
    refreshKeyboardAxes(input, handle);
  });
  window.addEventListener("keyup", (event) => {
    input.keyState.delete(event.code);
    refreshKeyboardAxes(input, handle);
  });
  canvas.addEventListener("pointerdown", () => {
    input.pointerDown = true;
    const select = handle("select");
    if (select) input.buttons.set(select, true);
  });
  window.addEventListener("pointerup", () => {
    input.pointerDown = false;
    const select = handle("select");
    if (select) input.buttons.set(select, false);
  });
  canvas.addEventListener("pointermove", (event) => {
    input.pointerDeltaX += event.movementX || 0;
    input.pointerDeltaY += event.movementY || 0;
    const orbitX = handle("orbit_x");
    const orbitY = handle("orbit_y");
    if (orbitX) input.axes.set(orbitX, clampAxis((input.axes.get(orbitX) || 0) + (event.movementX || 0) / 200));
    if (orbitY) input.axes.set(orbitY, clampAxis((input.axes.get(orbitY) || 0) + (event.movementY || 0) / 200));
  });
  canvas.addEventListener("wheel", (event) => {
    const zoom = handle("zoom");
    if (zoom) input.axes.set(zoom, clampAxis((input.axes.get(zoom) || 0) + -event.deltaY / 500));
  }, { passive: true });
  canvas.addEventListener("touchmove", (event) => {
    const touch = handle("orbit_x");
    if (touch) input.axes.set(touch, clampAxis(event.touches.length ? 0.5 : 0));
  }, { passive: true });
}

function refreshKeyboardAxes(input: InputState, handle: (key: string) => number) {
  const orbitX = handle("orbit_x");
  const orbitY = handle("orbit_y");
  const zoom = handle("zoom");
  if (orbitX) input.axes.set(orbitX, (input.keyState.has("ArrowRight") ? 1 : 0) + (input.keyState.has("ArrowLeft") ? -1 : 0));
  if (orbitY) input.axes.set(orbitY, (input.keyState.has("ArrowDown") ? 1 : 0) + (input.keyState.has("ArrowUp") ? -1 : 0));
  if (zoom) input.axes.set(zoom, (input.keyState.has("KeyE") ? 1 : 0) + (input.keyState.has("KeyQ") ? -1 : 0));
}

function clampAxis(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function colorFromBytes(value: [number, number, number, number]): GPUColor {
  return { r: value[0] / 255, g: value[1] / 255, b: value[2] / 255, a: value[3] / 255 };
}

function keyForHandle(map: Record<string, number> | undefined, handle: number) {
  return Object.entries(map || {}).find(([, value]) => value === handle)?.[0];
}

function handleExists(map: Record<string, number> | undefined, handle: number) {
  return Boolean(keyForHandle(map, handle));
}

function markUnsupported(message: string) {
  statusEl.textContent = message;
  publishConformanceReport("unsupported", message);
  window.dispatchEvent(new CustomEvent("airgfx-unsupported", { detail: message }));
}

function publishRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  publishConformanceReport("error", message);
  window.dispatchEvent(new CustomEvent("airgfx-error", { detail: message }));
}

function publishConformanceReport(status: "ready" | "unsupported" | "error", reason?: string) {
  const manifest = state.manifest;
  const metadata = state.metadata;
  const unsupportedFeatures = detectUnsupportedFeatures(manifest);
  const supportedFeatures = detectSupportedFeatures(manifest);
  const report = {
    host: "browser",
    backend: "webgpu",
    available: status === "ready",
    passed: status === "ready" ? 1 : 0,
    failed: status === "error" ? 1 : 0,
    abi: metadata?.abi || manifest?.package?.abi || CURRENT_ABI,
    module: metadata?.module || manifest?.module,
    package: metadata
      ? {
          module: metadata.module,
          abi: metadata.abi,
          wasm: metadata.wasm,
          manifest: metadata.manifest,
          capabilities: metadata.capabilities || [],
          imports: (metadata.imports || []).map((item) => item.name)
        }
      : undefined,
    supportedFeatures,
    unsupportedFeatures,
    warnings: state.warnings || [],
    loadedAssets: state.loadedAssets || [],
    loadedModelAssets: state.loadedModelAssets || [],
    missingAssets: state.missingAssets || [],
    unsupportedGltfFeatures: state.unsupportedGltfFeatures || [],
    materialFallbacks: state.materialFallbacks || [],
    inputs: Object.keys(manifest?.inputs || {}),
    input: {
      axes: Object.fromEntries(state.input?.axes || new Map()),
      pointerDeltaX: state.input?.pointerDeltaX || 0,
      pointerDeltaY: state.input?.pointerDeltaY || 0,
      pointerDown: state.input?.pointerDown || false
    },
    unsupportedReason: reason,
    render: {
      frames: state.frameCount || 0,
      drawCalls: state.drawCalls || 0,
      passes: state.passStats || {},
      scene: {
        cameras: Object.keys(manifest?.scene?.cameras || {}).length,
        lights: Object.keys(manifest?.scene?.lights || {}).length,
        nodes: Object.keys(manifest?.scene?.nodes || {}).length,
        instances: Object.keys(manifest?.scene?.instances || {}).length,
        meshInstances: Object.keys(manifest?.scene?.meshInstances || {}).length,
        sprites: Object.keys(manifest?.scene?.sprites || {}).length,
        voxels: Object.keys(manifest?.scene?.voxels || {}).length,
        particles: Object.keys(manifest?.scene?.particles || {}).length
      },
      models: state.loadedModelAssets || [],
      checksum: Math.floor(
        ((state.sceneTimeMs || 0) +
          (state.frameCount || 0) * 17 +
          (state.drawCalls || 0) * 19 +
          Object.values(state.passStats || {}).reduce((sum, value) => sum + value, 0) * 23 +
          Object.keys(manifest?.ui?.panels || {}).length * 31) %
          100000
      )
    }
  };
  (window as unknown as { __airgfxReport?: unknown }).__airgfxReport = report;
  renderDiagnostics(report);
}

function renderDiagnostics(report: {
  backend: string;
  abi: string;
  module?: string;
  package?: { module: string; capabilities: string[] };
  unsupportedFeatures: string[];
  loadedAssets: string[];
  loadedModelAssets?: string[];
  unsupportedGltfFeatures?: string[];
  materialFallbacks?: string[];
  unsupportedReason?: string;
  render: { drawCalls: number };
}) {
  setText(diagnostics.package, report.package?.module || report.module || "not loaded");
  setText(diagnostics.manifest, report.abi || CURRENT_ABI);
  setText(diagnostics.backend, report.unsupportedReason ? `${report.backend} (${report.unsupportedReason})` : report.backend);
  setText(diagnostics.drawCalls, String(report.render.drawCalls || 0));
  setText(diagnostics.capabilities, report.package?.capabilities?.join(", ") || "none");
  setText(diagnostics.assets, compactList([...(report.loadedModelAssets || []), ...report.loadedAssets], 5));
  setText(
    diagnostics.unsupported,
    report.unsupportedReason ||
      compactList([...(report.unsupportedGltfFeatures || []), ...(report.materialFallbacks || []), ...report.unsupportedFeatures], 4) ||
      "none"
  );
}

function setText(node: HTMLElement | null, value: string) {
  if (node) node.textContent = value;
}

function compactList(items: string[] | undefined, limit: number) {
  if (!items || !items.length) return "";
  const shown = items.slice(0, limit);
  const hidden = items.length - shown.length;
  return hidden > 0 ? `${shown.join(", ")} +${hidden} more` : shown.join(", ");
}

function detectSupportedFeatures(manifest: AirGfxManifest | undefined) {
  if (!manifest) return [];
  const supported = new Set<string>([
    "package metadata",
    "required host import validation",
    "WebAssembly instantiation",
    "gpu.set_scene_time",
    "gpu.set_camera",
    "gpu.set_camera_matrix",
    "gpu.execute_render_graph",
    "input axis/button/pointer imports"
  ]);
  if (Object.keys(manifest.renderGraphs || {}).length) supported.add("render graph traversal");
  if (Object.keys(manifest.renderTargets || {}).length) supported.add("render target allocation");
  if (manifest.depth && manifest.depth.enabled !== false) supported.add("depth attachment allocation");
  if (Object.keys(manifest.pipelines || {}).length) supported.add("WGSL shader module and render pipeline creation");
  if (Object.keys(manifest.assets?.models || {}).length) supported.add("GLB/glTF model asset loading and GPU buffer upload");
  if (Object.keys(manifest.assets?.textures || {}).length) supported.add("asset preflight for texture references");
  if (Object.keys(manifest.assets?.cubemaps || {}).length) supported.add("asset preflight for skybox/environment references");
  if (Object.keys(manifest.materials || {}).length) supported.add("material metadata validation and pipeline lookup");
  if (Object.values(manifest.renderGraphs || {}).some((graph) => graph.passes.some((pass) => pass.kind === "skybox" || pass.kind === "environment"))) {
    supported.add("skybox/environment pass placeholder draw");
  }
  if (Object.values(manifest.renderGraphs || {}).some((graph) => graph.passes.some((pass) => pass.kind === "geometry"))) {
    supported.add("geometry/instancing placeholder draw");
  }
  if (Object.values(manifest.renderGraphs || {}).some((graph) => graph.passes.some((pass) => pass.kind === "particles"))) {
    supported.add("particle placeholder draw");
  }
  if (Object.values(manifest.renderGraphs || {}).some((graph) => graph.passes.some((pass) => pass.kind === "post"))) {
    supported.add("post pass traversal");
  }
  return Array.from(supported).sort();
}

function detectUnsupportedFeatures(manifest: AirGfxManifest | undefined) {
  if (!manifest) return [];
  const unsupported = new Set<string>();
  if (Object.keys(manifest.renderTargets || {}).length > 1) {
    unsupported.add("unsupported feature: full render target routing is simplified to scene_color plus surface present in this WebGPU host");
  }
  for (const feature of state.unsupportedGltfFeatures || []) unsupported.add(feature);
  for (const fallback of state.materialFallbacks || []) unsupported.add(`material fallback used: ${fallback}`);
  if (Object.values(manifest.scene?.instances || {}).some((item) => (item.transforms || []).length)) {
    unsupported.add("unsupported feature: per-instance transform buffers are counted but not uploaded by this WebGPU host");
  }
  if (Object.keys(manifest.assets?.cubemaps || {}).length) {
    unsupported.add("unsupported feature: skybox texture sampling uses placeholder environment draw probes in this WebGPU host");
  }
  if (Object.values(manifest.materials || {}).some((material) => material.model === "pbr")) {
    unsupported.add("unsupported feature: PBR-lite material shading uses placeholder colors in this WebGPU host");
  }
  if (Object.values(manifest.materials || {}).some((material) => material.textures && Object.keys(material.textures).length)) {
    unsupported.add("unsupported feature: material texture sampling is not implemented by this WebGPU host");
  }
  if (Object.values(manifest.post || {}).some((effect) => effect.kind === "bloom")) {
    unsupported.add("unsupported feature: bloom post effect uses a reference probe in this WebGPU host");
  }
  if (Object.values(manifest.post || {}).some((effect) => effect.kind === "tone-map")) {
    unsupported.add("unsupported feature: tone-map post effect uses a reference probe in this WebGPU host");
  }
  if (Object.keys(manifest.ui || {}).length) {
    unsupported.add("unsupported feature: ui manifest resources are counted but not laid out by this WebGPU host");
  }
  return Array.from(unsupported).sort();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchOptionalJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchText(url: string, label = "text asset"): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`missing ${label} at ${url}: ${response.status}`);
  return response.text();
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

function requireState<T>(value: T | null | undefined, name: string): T {
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
