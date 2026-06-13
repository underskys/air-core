import type { AirGfxManifest, AssetRef } from "./types";

export type LoadedModelAsset = {
  key: string;
  path: string;
  format: string;
  handle?: number;
  primitiveCount: number;
  vertexCount: number;
  indexCount: number;
  hasNormals: boolean;
  hasUvs: boolean;
  materialRef?: number | string;
  materialFallbackUsed: boolean;
  unsupportedFeatures: string[];
  positionBuffer: GPUBuffer;
  normalBuffer?: GPUBuffer;
  uvBuffer?: GPUBuffer;
  indexBuffer?: GPUBuffer;
  indexFormat?: GPUIndexFormat;
};

export type GraphicsAssetLoadReport = {
  models: Map<string, LoadedModelAsset>;
  loadedAssets: string[];
  missingAssets: string[];
  unsupportedFeatures: string[];
  materialFallbacks: string[];
};

type GltfDocument = {
  asset?: { version?: string; generator?: string };
  buffers?: Array<{ uri?: string; byteLength?: number }>;
  bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number; target?: number }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }>;
  meshes?: Array<{ name?: string; primitives?: GltfPrimitive[] }>;
  materials?: Array<Record<string, unknown>>;
  animations?: unknown[];
  skins?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
};

type GltfPrimitive = {
  attributes?: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: unknown[];
};

type ParsedGltf = {
  document: GltfDocument;
  buffers: ArrayBuffer[];
};

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const COMPONENT_SIZES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4
};

const ACCESSOR_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};

const COMPRESSED_EXTENSIONS = new Set(["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]);

export async function loadGraphicsAssets(device: GPUDevice, manifest: AirGfxManifest): Promise<GraphicsAssetLoadReport> {
  const report: GraphicsAssetLoadReport = {
    models: new Map(),
    loadedAssets: [],
    missingAssets: [],
    unsupportedFeatures: [],
    materialFallbacks: []
  };
  const models = manifest.assets?.models || {};
  const nonModelAssets = collectNonModelAssetRefs(manifest);

  await Promise.all(Object.entries(models).map(([key, asset]) => loadModel(device, key, asset, report)));
  await Promise.all(nonModelAssets.map((asset) => preflightAsset(asset, report)));

  report.loadedAssets.sort();
  report.missingAssets.sort();
  report.unsupportedFeatures.sort();
  report.materialFallbacks.sort();
  return report;
}

async function loadModel(device: GPUDevice, key: string, asset: AssetRef, report: GraphicsAssetLoadReport) {
  if (!asset.path) {
    report.missingAssets.push(`model ${key} (<missing path>)`);
    return;
  }
  try {
    const parsed = await fetchModel(asset);
    report.loadedAssets.push(asset.path);
    const loaded = createLoadedModel(device, key, asset, parsed, report);
    if (loaded) report.models.set(key, loaded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("missing asset:")) {
      report.missingAssets.push(`${asset.path} (${message.replace("missing asset: ", "")})`);
    } else {
      report.loadedAssets.push(asset.path);
      report.unsupportedFeatures.push(`model ${key}: ${message}`);
    }
  }
}

async function preflightAsset(path: string, report: GraphicsAssetLoadReport) {
  try {
    const response = await fetch(path);
    if (response.ok) {
      report.loadedAssets.push(path);
    } else {
      report.missingAssets.push(`${path} (${response.status})`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.missingAssets.push(`${path} (${message})`);
  }
}

async function fetchModel(asset: AssetRef): Promise<ParsedGltf> {
  const response = await fetch(asset.path);
  if (!response.ok) throw new Error(`missing asset: ${response.status}`);
  const format = (asset.format || extensionFormat(asset.path)).toLowerCase();
  if (format === "glb") return parseGlb(await response.arrayBuffer(), asset.path);
  if (format === "gltf") return parseGltfJson(await response.json(), asset.path);
  throw new Error(`unsupported model format '${asset.format || extensionFormat(asset.path)}'`);
}

function createLoadedModel(device: GPUDevice, key: string, asset: AssetRef, parsed: ParsedGltf, report: GraphicsAssetLoadReport): LoadedModelAsset | null {
  const doc = parsed.document;
  const unsupported = detectUnsupportedGltf(doc);
  const primitive = findFirstPrimitive(doc);
  if (!primitive) {
    report.unsupportedFeatures.push(`model ${key}: no mesh primitive with POSITION attribute`);
    report.unsupportedFeatures.push(...unsupported.map((item) => `model ${key}: ${item}`));
    return null;
  }

  const position = readAccessorBytes(doc, parsed.buffers, primitive.attributes!.POSITION);
  if (position.componentType !== 5126 || position.components !== 3) {
    report.unsupportedFeatures.push(`model ${key}: POSITION must be f32 VEC3`);
    return null;
  }

  const normals = primitive.attributes?.NORMAL !== undefined ? readAccessorBytes(doc, parsed.buffers, primitive.attributes.NORMAL) : null;
  const uvs = primitive.attributes?.TEXCOORD_0 !== undefined ? readAccessorBytes(doc, parsed.buffers, primitive.attributes.TEXCOORD_0) : null;
  const indices = primitive.indices !== undefined ? readAccessorBytes(doc, parsed.buffers, primitive.indices) : null;
  const materialFallbackUsed = primitive.material === undefined || !doc.materials?.[primitive.material];
  if (materialFallbackUsed) report.materialFallbacks.push(`model ${key}: default material fallback`);

  const loaded: LoadedModelAsset = {
    key,
    path: asset.path,
    format: (asset.format || extensionFormat(asset.path)).toLowerCase(),
    handle: asset.handle,
    primitiveCount: countPrimitives(doc),
    vertexCount: position.count,
    indexCount: indices?.count || 0,
    hasNormals: Boolean(normals),
    hasUvs: Boolean(uvs),
    materialRef: primitive.material,
    materialFallbackUsed,
    unsupportedFeatures: unsupported,
    positionBuffer: createGpuBuffer(device, `model:${key}:positions`, position.bytes, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
    normalBuffer: normals ? createGpuBuffer(device, `model:${key}:normals`, normals.bytes, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST) : undefined,
    uvBuffer: uvs ? createGpuBuffer(device, `model:${key}:uvs`, uvs.bytes, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST) : undefined,
    indexBuffer: indices ? createGpuBuffer(device, `model:${key}:indices`, indices.bytes, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST) : undefined,
    indexFormat: indices ? indexFormat(indices.componentType) : undefined
  };
  report.unsupportedFeatures.push(...unsupported.map((item) => `model ${key}: ${item}`));
  return loaded;
}

function findFirstPrimitive(doc: GltfDocument): GltfPrimitive | null {
  for (const mesh of doc.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if (primitive.attributes?.POSITION !== undefined) return primitive;
    }
  }
  return null;
}

function countPrimitives(doc: GltfDocument) {
  return (doc.meshes || []).reduce((sum, mesh) => sum + (mesh.primitives || []).length, 0);
}

function detectUnsupportedGltf(doc: GltfDocument) {
  const unsupported: string[] = [];
  if ((doc.animations || []).length) unsupported.push("unsupported glTF feature: animations");
  if ((doc.skins || []).length) unsupported.push("unsupported glTF feature: skinning");
  if ((doc.extensionsRequired || []).length) unsupported.push(`unsupported glTF required extensions: ${doc.extensionsRequired!.join(", ")}`);
  for (const extension of doc.extensionsUsed || []) {
    if (COMPRESSED_EXTENSIONS.has(extension)) unsupported.push(`unsupported glTF feature: ${extension}`);
  }
  for (const mesh of doc.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if ((primitive.targets || []).length) unsupported.push("unsupported glTF feature: morph targets");
      if (primitive.mode !== undefined && primitive.mode !== 4) unsupported.push(`unsupported glTF primitive mode: ${primitive.mode}`);
    }
  }
  return Array.from(new Set(unsupported));
}

function readAccessorBytes(doc: GltfDocument, buffers: ArrayBuffer[], accessorIndex: number) {
  const accessor = doc.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`missing accessor ${accessorIndex}`);
  if (accessor.bufferView === undefined) throw new Error(`accessor ${accessorIndex} has no bufferView`);
  const view = doc.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`missing bufferView ${accessor.bufferView}`);
  const source = buffers[view.buffer || 0];
  if (!source) throw new Error(`missing buffer ${view.buffer || 0}`);
  const componentSize = COMPONENT_SIZES[accessor.componentType];
  const components = ACCESSOR_COMPONENTS[accessor.type];
  if (!componentSize || !components) throw new Error(`unsupported accessor ${accessorIndex} layout ${accessor.componentType} ${accessor.type}`);
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteStride = view.byteStride || componentSize * components;
  const byteLength = byteStride === componentSize * components
    ? accessor.count * componentSize * components
    : view.byteLength || accessor.count * byteStride;
  return {
    bytes: new Uint8Array(source, byteOffset, byteLength),
    count: accessor.count,
    componentType: accessor.componentType,
    components
  };
}

function createGpuBuffer(device: GPUDevice, label: string, bytes: Uint8Array, usage: GPUBufferUsageFlags) {
  const size = Math.max(4, align4(bytes.byteLength));
  const buffer = device.createBuffer({ label, size, usage, mappedAtCreation: true });
  new Uint8Array(buffer.getMappedRange()).set(bytes);
  buffer.unmap();
  return buffer;
}

function parseGlb(bytes: ArrayBuffer, path: string): ParsedGltf {
  const view = new DataView(bytes);
  if (view.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("invalid GLB header");
  if (view.getUint32(4, true) !== 2) throw new Error("unsupported GLB version");
  const totalLength = view.getUint32(8, true);
  if (totalLength > view.byteLength) throw new Error("truncated GLB file");
  let offset = 12;
  let document: GltfDocument | null = null;
  const buffers: ArrayBuffer[] = [];
  while (offset + 8 <= totalLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > view.byteLength) throw new Error("truncated GLB chunk");
    const chunk = bytes.slice(chunkStart, chunkEnd);
    if (chunkType === JSON_CHUNK) {
      document = JSON.parse(new TextDecoder().decode(chunk).trim()) as GltfDocument;
    } else if (chunkType === BIN_CHUNK) {
      buffers.push(chunk);
    }
    offset = align4(chunkEnd);
  }
  if (!document) throw new Error("GLB is missing JSON chunk");
  if (document.buffers?.length && buffers[0] && document.buffers[0].byteLength && document.buffers[0].byteLength! > buffers[0].byteLength) {
    throw new Error(`GLB binary chunk shorter than declared buffer for ${path}`);
  }
  return { document, buffers };
}

async function parseGltfJson(document: GltfDocument, path: string): Promise<ParsedGltf> {
  const buffers = await Promise.all((document.buffers || []).map((buffer) => loadGltfBuffer(buffer.uri, path)));
  return { document, buffers };
}

async function loadGltfBuffer(uri: string | undefined, modelPath: string) {
  if (!uri) throw new Error("external .gltf buffer is missing uri");
  if (uri.startsWith("data:")) return decodeDataUri(uri);
  const url = new URL(uri, new URL(modelPath, window.location.href)).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`missing buffer ${uri}: ${response.status}`);
  return response.arrayBuffer();
}

function decodeDataUri(uri: string) {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("invalid data URI buffer");
  const metadata = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  if (!metadata.includes(";base64")) throw new Error("only base64 glTF data URI buffers are supported");
  const raw = atob(payload);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function collectNonModelAssetRefs(manifest: AirGfxManifest) {
  const urls = new Set<string>();
  for (const asset of Object.values(manifest.assets?.textures || {})) urls.add(asset.path);
  for (const asset of Object.values(manifest.assets?.spriteAtlases || {})) urls.add(asset.path);
  for (const asset of Object.values(manifest.assets?.cubemaps || {})) urls.add(asset.path);
  return Array.from(urls).filter(Boolean).sort();
}

function indexFormat(componentType: number): GPUIndexFormat | undefined {
  if (componentType === 5123) return "uint16";
  if (componentType === 5125) return "uint32";
  return undefined;
}

function extensionFormat(path: string) {
  return path.split(".").pop() || "";
}

function align4(value: number) {
  return Math.ceil(value / 4) * 4;
}
