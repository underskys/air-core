import type { AirGfxManifest, AirPackageMetadata } from "./types";

export type AirPackage = {
  basePath: string;
  metadata: AirPackageMetadata;
  manifest: AirGfxManifest;
  wasmBytes: ArrayBuffer;
};

export type ConformanceReport = {
  host: string;
  backend: string;
  available: boolean;
  passed: number;
  failed: number;
  unsupportedReason?: string;
  supportedFeatures?: string[];
  unsupportedFeatures?: string[];
  warnings?: string[];
  loadedAssets?: string[];
  missingAssets?: string[];
  render?: {
    frames: number;
    drawCalls?: number;
  };
};

export async function loadAirPackage(basePath: string): Promise<AirPackage> {
  const normalized = basePath.replace(/\/$/, "");
  const metadata = await fetchJson<AirPackageMetadata>(`${normalized}/air-package.json`);
  if (!metadata.manifest) throw new Error("air-package.json is missing manifest");
  const manifest = await fetchJson<AirGfxManifest>(`${normalized}/${metadata.manifest}`);
  const wasmBytes = await fetchArrayBuffer(`${normalized}/${metadata.wasm}`);
  return { basePath: normalized, metadata, manifest, wasmBytes };
}

export async function instantiateAirModule(wasmBytes: ArrayBuffer, imports: WebAssembly.Imports): Promise<WebAssembly.Instance> {
  const module = await WebAssembly.instantiate(wasmBytes, imports);
  return module.instance;
}

export function createGpuImports(host: Record<string, (...args: number[]) => void>): WebAssembly.Imports {
  const gpu: Record<string, (...args: number[]) => void> = {};
  for (const name of [
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
  ]) {
    gpu[name] = (...args: number[]) => {
      const fn = host[name];
      if (!fn) throw new Error(`host missing gpu.${name}`);
      fn(...args);
    };
  }
  return { gpu };
}

export function createInputImports(host: Record<string, (...args: number[]) => number | boolean>): WebAssembly.Imports {
  const input: Record<string, (...args: number[]) => number> = {};
  for (const name of ["axis", "button", "pointer_delta_x", "pointer_delta_y", "pointer_down", "touch_axis"]) {
    input[name] = (...args: number[]) => {
      const fn = host[name];
      if (!fn) throw new Error(`host missing input.${name}`);
      const value = fn(...args);
      return typeof value === "boolean" ? (value ? 1 : 0) : value;
    };
  }
  return { input };
}

export async function createWebGpuHost(canvas: HTMLCanvasElement, airPackage: AirPackage) {
  const report: ConformanceReport = {
    host: "browser",
    backend: "webgpu",
    available: false,
    passed: 0,
    failed: 0
  };
  if (!("gpu" in navigator)) {
    report.unsupportedReason = "WebGPU unsupported";
    return {
      runFrame: () => {},
      getConformanceReport: () => report
    };
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    report.unsupportedReason = "WebGPU adapter unavailable";
    return {
      runFrame: () => {},
      getConformanceReport: () => report
    };
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) {
    report.unsupportedReason = "WebGPU context unavailable";
    return {
      runFrame: () => {},
      getConformanceReport: () => report
    };
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  report.available = true;
  report.passed = 1;
  report.render = { frames: 0 };
  return {
    runFrame: () => {
      report.render!.frames += 1;
    },
    getConformanceReport: () => ({ ...report, module: airPackage.metadata.module })
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}
