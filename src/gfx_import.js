const path = require("path");

const MODEL_EXTENSIONS = new Set([".gltf", ".glb", ".obj", ".fbx", ".usd", ".usda", ".usdc"]);
const TEXTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ktx2"]);
const VECTOR_EXTENSIONS = new Set([".svg"]);

function createGfxImportManifest(assetPath, options = {}) {
  const name = sanitizeKey(options.name || path.basename(assetPath, path.extname(assetPath)));
  const ext = path.extname(assetPath).toLowerCase();
  if (MODEL_EXTENSIONS.has(ext)) return createModelFragment(name, assetPath, ext, options);
  if (VECTOR_EXTENSIONS.has(ext) && (options.kind === "vector" || options.vector === true)) return createVectorFragment(name, assetPath, ext, options);
  if (TEXTURE_EXTENSIONS.has(ext)) return createTextureFragment(name, assetPath, ext, options);
  throw new Error(`unsupported asset extension '${ext || "<none>"}'; expected model or texture asset`);
}

function createModelFragment(name, assetPath, ext, options) {
  const runtimeReady = ext === ".gltf" || ext === ".glb";
  const modelKey = name;
  const materialKey = `${name}_material`;
  const nodeKey = `${name}_node`;
  return {
    assets: {
      models: {
        [modelKey]: {
          path: assetPath,
          format: ext.slice(1),
          sourceFormat: ext.slice(1),
          runtimeReady,
          attributes: options.attributes,
          skinned: options.skinned === true,
          skeleton: options.skeleton,
          animations: options.animations,
          conversion: runtimeReady
            ? undefined
            : {
                required: true,
                targetFormat: "glb",
                toolHint: conversionToolHint(ext)
              }
        }
      }
    },
    materials: {
      [materialKey]: {
        pipeline: options.pipeline || "stdlib_unlit_mesh",
        model: "pbr",
        baseColor: [1, 1, 1, 1],
        metallic: 0,
        roughness: 1,
        textures: {}
      }
    },
    scene: {
      nodes: {
        [nodeKey]: {
          mesh: modelKey,
          material: materialKey,
          transform: { translation: [0, 0, 0], scale: [1, 1, 1] }
        }
      }
    },
    handles: {
      models: { [modelKey]: options.handle || 1 },
      nodes: { [nodeKey]: options.nodeHandle || 1 }
    }
  };
}

function createVectorFragment(name, assetPath, ext, options) {
  const vectorKey = name;
  const materialKey = `${name}_vector_material`;
  return {
    assets: {
      vectors: {
        [vectorKey]: {
          path: assetPath,
          format: ext.slice(1),
          usage: options.usage || "decal",
          tessellation: options.tessellation || "host",
          colorSpace: options.colorSpace || "srgb"
        }
      }
    },
    materials: {
      [materialKey]: {
        pipeline: options.pipeline || "stdlib_sprite_atlas",
        model: "sprite-unlit",
        baseColor: [1, 1, 1, 1],
        textures: {}
      }
    },
    scene: {
      vectorDecals: {
        [`${name}_decal`]: {
          vector: vectorKey,
          material: materialKey,
          space: options.space || "world",
          transform: { translation: [0, 0, 0], scale: [1, 1, 1] },
          alpha: options.alpha === undefined ? 1 : options.alpha
        }
      }
    },
    handles: {
      vectors: { [vectorKey]: options.handle || 1 }
    }
  };
}

function createTextureFragment(name, assetPath, ext, options) {
  const textureKey = name;
  const materialKey = `${name}_material`;
  return {
    assets: {
      textures: {
        [textureKey]: {
          path: assetPath,
          format: ext.slice(1),
          colorSpace: options.colorSpace || "srgb"
        }
      }
    },
    materials: {
      [materialKey]: {
        pipeline: options.pipeline || "stdlib_sprite_atlas",
        model: "sprite-unlit",
        baseColor: [1, 1, 1, 1],
        textures: { base: textureKey }
      }
    }
  };
}

function conversionToolHint(ext) {
  if (ext === ".obj") return "obj2gltf or Blender CLI export to GLB";
  if (ext === ".fbx") return "FBX2glTF or Blender CLI export to GLB";
  if (ext === ".usd" || ext === ".usda" || ext === ".usdc") return "usdcat/usdchecker plus usd-to-gltf pipeline";
  return "convert to GLB/glTF before runtime packaging";
}

function sanitizeKey(value) {
  const key = String(value).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return key || "asset";
}

module.exports = { createGfxImportManifest };
