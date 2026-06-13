export type AirGfxManifest = {
  version: "0.3" | "0.4" | "0.5" | "0.6" | "0.7" | "0.8" | "0.9" | "0.10";
  module: string;
  package?: {
    abi?: string;
    kind?: string;
  };
  targets?: Record<string, { backend?: string; required?: boolean }>;
  canvas?: {
    width?: number;
    height?: number;
    clearColor?: [number, number, number, number];
  };
  inputs?: Record<string, InputRef>;
  assets?: {
    models?: Record<string, AssetRef>;
    textures?: Record<string, AssetRef>;
    spriteAtlases?: Record<string, AssetRef>;
    cubemaps?: Record<string, AssetRef>;
    sprites?: Record<string, SpriteRef>;
  };
  shaders?: Record<string, ShaderRef>;
  pipelines?: Record<string, PipelineRef>;
  renderTargets?: Record<string, RenderTargetRef>;
  depth?: DepthRef;
  postPipelines?: Record<string, PostPipelineRef>;
  materials?: Record<string, MaterialRef>;
  scene?: SceneRef;
  ui?: UiRef;
  post?: Record<string, PostEffectRef>;
  renderGraphs?: Record<string, RenderGraphRef>;
  qualityProfiles?: Record<string, QualityProfileRef>;
  handles?: {
    pipelines?: Record<string, number>;
    renderGraphs?: Record<string, number>;
    cameras?: Record<string, number>;
    nodes?: Record<string, number>;
    voxels?: Record<string, number>;
    particles?: Record<string, number>;
    models?: Record<string, number>;
    sprites?: Record<string, number>;
    inputs?: Record<string, number>;
    ui?: Record<string, number>;
  };
};

export type AirPackageMetadata = {
  abi: string;
  module: string;
  wasm: string;
  manifest?: string;
  manifestHash?: string;
  capabilities?: string[];
  exports?: Array<{ name: string; params: Array<{ name: string; type: string }>; returnType: string }>;
  imports?: Array<{ name: string; params: Array<{ name: string; type: string }>; returnType: string }>;
};

export type AssetRef = {
  path: string;
  format?: string;
  handle?: number;
};

export type InputRef = {
  kind: "axis" | "button" | "pointer" | "touch";
  handle: number;
  bindings?: {
    browser?: string;
    native?: string;
  };
};

export type SpriteRef = {
  texture: string;
  frame?: [number, number, number, number];
  handle?: number;
};

export type ShaderRef = {
  path: string;
  vertex?: string;
  fragment?: string;
  vertexEntry?: string;
  fragmentEntry?: string;
};

export type PipelineRef = {
  shader: string;
  vertexEntry?: string;
  fragmentEntry?: string;
  colorFormat?: GPUTextureFormat;
  depth?: boolean;
  depthWrite?: boolean;
  blend?: "alpha" | "none";
  cull?: GPUCullMode | "none";
  primitive?: GPUPrimitiveTopology;
  vertexCount?: number;
};

export type RenderTargetRef = {
  format: GPUTextureFormat | "surface";
  size?: "canvas";
  scale?: number;
  usage?: Array<"render" | "sample" | "present">;
};

export type DepthRef = {
  target: string;
  format: GPUTextureFormat;
  size?: "canvas";
  enabled?: boolean;
};

export type PostPipelineRef = {
  shader: string;
  vertexEntry?: string;
  fragmentEntry?: string;
  effects?: string[];
};

export type MaterialRef = {
  pipeline: string;
  model?: string;
  baseColor?: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  emissive?: [number, number, number];
  textures?: Record<string, string>;
};

export type SceneRef = {
  cameras?: Record<string, CameraRef>;
  lights?: Record<string, LightRef>;
  nodes?: Record<string, SceneNodeRef>;
  instances?: Record<string, SceneInstanceRef>;
  meshInstances?: Record<string, MeshInstanceRef>;
  sprites?: Record<string, SceneSpriteRef>;
  voxels?: Record<string, VoxelChunkRef>;
  particles?: Record<string, ParticleRef>;
};

export type CameraRef = {
  kind?: "perspective" | "orthographic";
  fovY?: number;
  near?: number;
  far?: number;
  position?: [number, number, number];
  target?: [number, number, number];
};

export type LightRef = {
  kind?: "directional" | "point" | "spot" | "ambient";
  direction?: [number, number, number];
  position?: [number, number, number];
  color?: [number, number, number];
  intensity?: number;
};

export type SceneNodeRef = {
  mesh: string;
  material: string;
  transform?: TransformRef;
  instances?: number;
};

export type MeshInstanceRef = {
  mesh: string;
  material: string;
  transform?: TransformRef;
  count?: number;
};

export type SceneInstanceRef = {
  model: string;
  material: string;
  count: number;
  transforms?: Array<{
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  }>;
};

export type SceneSpriteRef = {
  sprite: string;
  material?: string;
  batch?: number;
};

export type VoxelChunkRef = {
  material?: string;
  chunkSize?: number;
  budget?: number;
  mode?: string;
};

export type ParticleRef = {
  material?: string;
  count?: number;
  budget?: number;
  emitter?: "point" | "box" | "sphere";
  bounds?: [number, number, number];
};

export type TransformRef = {
  translation?: [number, number, number];
  rotation?: [number, number, number];
  rotationQuat?: [number, number, number, number];
  scale?: [number, number, number];
};

export type RenderGraphRef = {
  passes: RenderPassRef[];
};

export type RenderPassRef = {
  key: string;
  kind: "clear" | "geometry" | "sprite" | "voxel" | "particles" | "ui" | "post" | "present" | "skybox" | "environment";
  pipeline?: string;
  material?: string;
  camera?: string;
  environment?: string;
  effect?: string;
  inputs?: string[];
  output?: string;
};

export type UiRef = {
  panels?: Record<string, { rect: [number, number, number, number]; style?: string }>;
  textLabels?: Record<string, { text: string; panel?: string; font?: string }>;
  imageQuads?: Record<string, { texture?: string; sprite?: string; panel?: string }>;
  gizmos?: Record<string, { node?: string; kind?: string }>;
};

export type PostEffectRef = {
  kind: "bloom" | "depth-of-field" | "tone-map" | string;
  threshold?: number;
  radius?: number;
  intensity?: number;
  focusDistance?: number;
  aperture?: number;
  operator?: string;
  exposure?: number;
};

export type QualityProfileRef = {
  maxTextureSize?: number;
  maxInstances?: number;
  post?: string[];
  preferredBackend?: string;
};

export type AirExports = {
  frame: (timeMs: number) => void;
};
