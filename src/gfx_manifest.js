const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { emitWit } = require("./wit");
const { lowerToWat, watToWasm } = require("./lower_wasm");
const { AIR_ABI_VERSION, AIR_VERSION } = require("./version");
const { GPU_SIGNATURES, INPUT_SIGNATURES } = require("./host_abi");

function loadGfxManifest(file) {
  const text = fs.readFileSync(file, "utf8");
  const manifest = JSON.parse(text);
  manifest.__file = file;
  manifest.__dir = path.dirname(path.resolve(file));
  return manifest;
}

function validateGfxManifest(mod, manifest) {
  const errors = [];
  const warnings = [];
  if (!manifest || !["0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10"].includes(manifest.version)) {
    errors.push("manifest.version must be \"0.3\", \"0.4\", \"0.5\", \"0.6\", \"0.7\", \"0.8\", \"0.9\", or \"0.10\"");
  }
  if (!manifest.module) errors.push("manifest.module is required");
  if (manifest.module && manifest.module !== mod.name) errors.push(`manifest.module '${manifest.module}' does not match AIR module '${mod.name}'`);
  if (!mod.capabilities.has("gpu")) errors.push("AIR module must declare capability 'gpu'");

  validateAssetPaths(manifest, errors);
  validateAssetMetadata(manifest, errors);
  validateShaders(manifest, errors);
  validatePipelines(manifest, errors);
  validateRenderTargets(manifest, errors);
  validatePostPipelines(manifest, errors);
  validatePostEffects(manifest, errors);
  validateMaterials(manifest, errors, warnings);
  validateInputs(manifest, errors);
  validateUi(manifest, errors);
  validateScene(manifest, errors, warnings);
  validateRenderGraph(manifest, errors);
  validateQualityProfiles(manifest, warnings);
  validateHandles(manifest, errors);
  validateGpuExterns(mod, manifest, errors);
  validateInputExterns(mod, manifest, errors);
  validateInteractiveExports(mod, manifest, warnings);
  validateGpuLifecycle(mod, manifest, errors, warnings);
  validateGfxBudgets(mod, manifest, errors);

  return { ok: errors.length === 0, errors, warnings, summary: summarizeManifest(manifest) };
}

function emitGfxWit(mod, manifest) {
  const lines = [];
  lines.push(emitWit(mod).trimEnd());
  lines.push("");
  lines.push("// AIR GFX manifest metadata");
  lines.push(`// module: ${manifest.module}`);
  lines.push(`// shaders: ${Object.keys(manifest.shaders || {}).join(", ") || "none"}`);
  lines.push(`// pipelines: ${Object.keys(manifest.pipelines || {}).join(", ") || "none"}`);
  lines.push(`// renderTargets: ${Object.keys(manifest.renderTargets || {}).join(", ") || "none"}`);
  lines.push(`// renderGraphs: ${Object.keys(manifest.renderGraphs || {}).join(", ") || "none"}`);
  lines.push(`// scene cameras: ${Object.keys((manifest.scene || {}).cameras || {}).join(", ") || "none"}`);
  lines.push(`// scene nodes: ${Object.keys((manifest.scene || {}).nodes || {}).join(", ") || "none"}`);
  lines.push(`// scene instances: ${Object.keys((manifest.scene || {}).instances || {}).join(", ") || "none"}`);
  lines.push(`// scene meshInstances: ${Object.keys((manifest.scene || {}).meshInstances || {}).join(", ") || "none"}`);
  lines.push(`// scene voxels: ${Object.keys((manifest.scene || {}).voxels || {}).join(", ") || "none"}`);
  lines.push(`// scene particles: ${Object.keys((manifest.scene || {}).particles || {}).join(", ") || "none"}`);
  lines.push(`// scene animators: ${Object.keys((manifest.scene || {}).animators || {}).join(", ") || "none"}`);
  lines.push(`// scene vectorDecals: ${Object.keys((manifest.scene || {}).vectorDecals || {}).join(", ") || "none"}`);
  lines.push(`// models: ${Object.keys((manifest.assets || {}).models || {}).join(", ") || "none"}`);
  lines.push(`// textures: ${Object.keys((manifest.assets || {}).textures || {}).join(", ") || "none"}`);
  lines.push(`// skeletons: ${Object.keys((manifest.assets || {}).skeletons || {}).join(", ") || "none"}`);
  lines.push(`// animations: ${Object.keys((manifest.assets || {}).animations || {}).join(", ") || "none"}`);
  lines.push(`// vectors: ${Object.keys((manifest.assets || {}).vectors || {}).join(", ") || "none"}`);
  lines.push(`// sprites: ${Object.keys((manifest.assets || {}).sprites || {}).join(", ") || "none"}`);
  lines.push(`// inputs: ${Object.keys(manifest.inputs || {}).join(", ") || "none"}`);
  lines.push(`// ui panels: ${Object.keys((manifest.ui || {}).panels || {}).join(", ") || "none"}`);
  return `${lines.join("\n")}\n`;
}

async function buildGfxPackage(mod, manifest, options) {
  const outDir = path.resolve(options.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const wasmName = `${mod.name}.wasm`;
  const manifestName = `${mod.name}.airgfx.json`;
  const wasm = await watToWasm(lowerToWat(mod), options.sourceName || mod.name);
  const manifestBytes = Buffer.from(JSON.stringify(stripPrivateManifestFields(manifest), null, 2));
  fs.writeFileSync(path.join(outDir, wasmName), wasm);
  fs.writeFileSync(path.join(outDir, manifestName), manifestBytes);
  const metadataName = "air-package.json";
  fs.writeFileSync(
    path.join(outDir, metadataName),
    JSON.stringify(createGfxPackageMetadata(mod, { wasmName, manifestName, manifestBytes }), null, 2)
  );
  copyManifestAssets(manifest, outDir);
  return { wasm: path.join(outDir, wasmName), manifest: path.join(outDir, manifestName), metadata: path.join(outDir, metadataName) };
}

function createGfxPackageMetadata(mod, options) {
  return {
    abi: AIR_ABI_VERSION,
    compiler: `airc ${AIR_VERSION}`,
    module: mod.name,
    wasm: options.wasmName,
    manifest: options.manifestName,
    manifestHash: crypto.createHash("sha256").update(options.manifestBytes).digest("hex"),
    capabilities: Array.from(mod.capabilities || []).sort(),
    exports: mod.functions.filter((fn) => fn.exported).map((fn) => ({ name: fn.name, params: fn.params, returnType: fn.returnType })),
    imports: (mod.externs || []).map((ex) => ({ name: ex.name, params: ex.params, returnType: ex.returnType }))
  };
}

function validateAssetPaths(manifest, errors) {
  const assets = manifest.assets || {};
  const groups = ["models", "textures", "spriteAtlases", "cubemaps", "fonts", "vectors", "skeletons", "animations"];
  for (const group of groups) {
    for (const [key, value] of Object.entries(assets[group] || {})) {
      const assetPath = typeof value === "string" ? value : value.path;
      if (!assetPath) {
        if (group === "skeletons" || group === "animations") continue;
        errors.push(`assets.${group}.${key} must define a path`);
        continue;
      }
      if (!fs.existsSync(resolveManifestPath(manifest, assetPath))) {
        errors.push(`assets.${group}.${key} path not found: ${assetPath}`);
      }
    }
  }
}

function validateAssetMetadata(manifest, errors) {
  const assets = manifest.assets || {};
  const models = assets.models || {};
  const skeletons = assets.skeletons || {};
  const animations = assets.animations || {};
  const vectors = assets.vectors || {};
  for (const [key, model] of Object.entries(models)) {
    if (model.format && !["gltf", "glb", "obj", "fbx", "usd", "usda", "usdc"].includes(model.format)) {
      errors.push(`assets.models.${key}.format '${model.format}' is unsupported`);
    }
    if (model.attributes !== undefined) {
      if (!Array.isArray(model.attributes) || !model.attributes.every((item) => typeof item === "string")) {
        errors.push(`assets.models.${key}.attributes must be an array of strings`);
      }
    }
    if (model.skinned === true && !model.skeleton) {
      errors.push(`assets.models.${key}.skeleton is required when skinned is true`);
    }
    if (model.skeleton && !skeletons[model.skeleton]) {
      errors.push(`assets.models.${key} references unknown skeleton '${model.skeleton}'`);
    }
    for (const clip of model.animations || []) {
      if (!animations[clip]) errors.push(`assets.models.${key} references unknown animation '${clip}'`);
    }
  }
  for (const [key, skeleton] of Object.entries(skeletons)) {
    if (skeleton.model && !models[skeleton.model]) errors.push(`assets.skeletons.${key} references unknown model '${skeleton.model}'`);
    if (skeleton.joints !== undefined && (!Array.isArray(skeleton.joints) || !skeleton.joints.every((item) => typeof item === "string"))) {
      errors.push(`assets.skeletons.${key}.joints must be an array of strings`);
    }
    if (skeleton.root && Array.isArray(skeleton.joints) && !skeleton.joints.includes(skeleton.root)) {
      errors.push(`assets.skeletons.${key}.root must be listed in joints`);
    }
  }
  for (const [key, animation] of Object.entries(animations)) {
    if (animation.model && !models[animation.model]) errors.push(`assets.animations.${key} references unknown model '${animation.model}'`);
    if (animation.skeleton && !skeletons[animation.skeleton]) errors.push(`assets.animations.${key} references unknown skeleton '${animation.skeleton}'`);
    validateOptionalNumber(`assets.animations.${key}.durationMs`, animation.durationMs, errors, { min: 0 });
    if (animation.channels !== undefined) {
      const allowed = new Set(["translation", "rotation", "scale", "weights"]);
      if (!Array.isArray(animation.channels) || !animation.channels.every((item) => typeof item === "string")) {
        errors.push(`assets.animations.${key}.channels must be an array of strings`);
      } else {
        for (const channel of animation.channels) {
          if (!allowed.has(channel) && !channel.includes(".")) errors.push(`assets.animations.${key}.channels contains unsupported channel '${channel}'`);
        }
      }
    }
  }
  for (const [key, vector] of Object.entries(vectors)) {
    if (vector.format && !["svg", "path2d", "msdf"].includes(vector.format)) {
      errors.push(`assets.vectors.${key}.format '${vector.format}' is unsupported`);
    }
    if (vector.tessellation && !["host", "build", "none"].includes(vector.tessellation)) {
      errors.push(`assets.vectors.${key}.tessellation must be host, build, or none`);
    }
  }
}

function validateShaders(manifest, errors) {
  for (const [key, shader] of Object.entries(manifest.shaders || {})) {
    if (!shader.path) {
      errors.push(`shaders.${key}.path is required`);
      continue;
    }
    const shaderPath = resolveManifestPath(manifest, shader.path);
    if (!fs.existsSync(shaderPath)) {
      errors.push(`shaders.${key}.path not found: ${shader.path}`);
      continue;
    }
    const text = fs.readFileSync(shaderPath, "utf8");
    const vertex = shader.vertex || shader.vertexEntry || "vs_main";
    const fragment = shader.fragment || shader.fragmentEntry || "fs_main";
    if (!text.includes(`fn ${vertex}`)) errors.push(`shaders.${key} missing vertex entry '${vertex}'`);
    if (!text.includes(`fn ${fragment}`)) errors.push(`shaders.${key} missing fragment entry '${fragment}'`);
  }
}

function validatePipelines(manifest, errors) {
  for (const [key, pipeline] of Object.entries(manifest.pipelines || {})) {
    if (!pipeline.shader) errors.push(`pipelines.${key}.shader is required`);
    if (pipeline.shader && !(manifest.shaders || {})[pipeline.shader]) {
      errors.push(`pipelines.${key} references unknown shader '${pipeline.shader}'`);
    }
  }
}

function validateRenderTargets(manifest, errors) {
  for (const [key, target] of Object.entries(manifest.renderTargets || {})) {
    if (!target.format) errors.push(`renderTargets.${key}.format is required`);
    if (target.scale !== undefined && (!Number.isFinite(target.scale) || target.scale <= 0 || target.scale > 1)) {
      errors.push(`renderTargets.${key}.scale must be > 0 and <= 1`);
    }
    if (target.size !== undefined && target.size !== "canvas") errors.push(`renderTargets.${key}.size must be canvas in AIR GFX v0.10`);
  }
  if (manifest.depth) {
    if (!manifest.depth.target) errors.push("depth.target is required");
    if (!manifest.depth.format) errors.push("depth.format is required");
    if (manifest.depth.size !== undefined && manifest.depth.size !== "canvas") errors.push("depth.size must be canvas in AIR GFX v0.10");
  }
}

function validatePostPipelines(manifest, errors) {
  const shaders = manifest.shaders || {};
  const post = manifest.post || {};
  for (const [key, pipeline] of Object.entries(manifest.postPipelines || {})) {
    if (!pipeline.shader) errors.push(`postPipelines.${key}.shader is required`);
    if (pipeline.shader && !shaders[pipeline.shader]) errors.push(`postPipelines.${key} references unknown shader '${pipeline.shader}'`);
    for (const effect of pipeline.effects || []) {
      if (!post[effect]) errors.push(`postPipelines.${key} references unknown effect '${effect}'`);
    }
  }
}

function validatePostEffects(manifest, errors) {
  for (const [key, effect] of Object.entries(manifest.post || {})) {
    const prefix = `post.${key}`;
    const kind = effect.kind;
    if (!kind) {
      errors.push(`${prefix}.kind is required`);
      continue;
    }
    if (!["tone-map", "bloom", "motion-blur", "blur", "depth-of-field", "outline", "selection-highlight", "screen-flash", "lightning-flash", "color-grade"].includes(kind)) {
      errors.push(`${prefix}.kind '${kind}' is unsupported`);
    }
    if (kind === "tone-map") {
      if (effect.operator && !["aces", "reinhard", "linear"].includes(effect.operator)) errors.push(`${prefix}.operator is unsupported`);
      validateOptionalNumber(`${prefix}.exposure`, effect.exposure, errors, { min: 0 });
    }
    if (kind === "bloom") {
      validateOptionalNumber(`${prefix}.threshold`, effect.threshold, errors, { min: 0, max: 1 });
      validateOptionalNumber(`${prefix}.radius`, effect.radius, errors, { min: 0 });
      validateOptionalNumber(`${prefix}.intensity`, effect.intensity, errors, { min: 0 });
    }
    if (kind === "motion-blur") {
      validateOptionalNumber(`${prefix}.shutter`, effect.shutter, errors, { min: 0, max: 1 });
      validateOptionalInteger(`${prefix}.samples`, effect.samples, errors, { min: 1, max: 64 });
    }
    if (kind === "blur") {
      validateOptionalNumber(`${prefix}.radius`, effect.radius, errors, { min: 0 });
      validateOptionalInteger(`${prefix}.iterations`, effect.iterations, errors, { min: 1, max: 16 });
    }
    if (kind === "depth-of-field") {
      validateOptionalNumber(`${prefix}.focusDistance`, effect.focusDistance, errors, { min: 0 });
      validateOptionalNumber(`${prefix}.aperture`, effect.aperture, errors, { min: 0 });
    }
    if (kind === "outline") {
      validateOptionalNumber(`${prefix}.width`, effect.width, errors, { min: 0 });
      validateVec(`${prefix}.color`, effect.color, 3, errors, { optional: true });
    }
    if (kind === "selection-highlight" || kind === "screen-flash" || kind === "lightning-flash") {
      validateOptionalNumber(`${prefix}.intensity`, effect.intensity, errors, { min: 0 });
      validateVec(`${prefix}.color`, effect.color, 3, errors, { optional: true });
    }
    if (kind === "screen-flash") validateOptionalNumber(`${prefix}.decay`, effect.decay, errors, { min: 0 });
    if (kind === "lightning-flash") validateOptionalInteger(`${prefix}.branches`, effect.branches, errors, { min: 1, max: 128 });
    if (kind === "color-grade") {
      validateOptionalNumber(`${prefix}.contrast`, effect.contrast, errors, { min: 0 });
      validateOptionalNumber(`${prefix}.saturation`, effect.saturation, errors, { min: 0 });
      validateOptionalNumber(`${prefix}.exposure`, effect.exposure, errors);
    }
  }
}

function validateMaterials(manifest, errors, warnings) {
  const textures = (manifest.assets || {}).textures || {};
  const pipelines = manifest.pipelines || {};
  const allowedModels = new Set(["pbr", "unlit", "sprite-unlit", "voxel-unlit", "post"]);
  const allowedSlots = new Set(["base", "baseColor", "albedo", "normal", "metallic", "roughness", "metallicRoughness", "occlusion", "emissive"]);
  for (const [key, material] of Object.entries(manifest.materials || {})) {
    if (!material.pipeline) errors.push(`materials.${key}.pipeline is required`);
    if (material.pipeline && !pipelines[material.pipeline]) {
      errors.push(`materials.${key} references unknown pipeline '${material.pipeline}'`);
    }
    if (material.model && !allowedModels.has(material.model)) errors.push(`materials.${key}.model '${material.model}' is unsupported`);
    validateVec(`materials.${key}.baseColor`, material.baseColor, 4, errors, { optional: true });
    validateVec(`materials.${key}.emissive`, material.emissive, 3, errors, { optional: true });
    validateOptionalNumber(`materials.${key}.metallic`, material.metallic, errors, { min: 0, max: 1 });
    validateOptionalNumber(`materials.${key}.roughness`, material.roughness, errors, { min: 0, max: 1 });
    for (const [slot, textureKey] of Object.entries(material.textures || {})) {
      if (!allowedSlots.has(slot)) errors.push(`materials.${key}.textures.${slot} is not a standard texture slot`);
      if (textureKey && !textures[textureKey]) {
        errors.push(`materials.${key} references unknown texture '${textureKey}'`);
      }
    }
    if (material.model === "pbr") {
      if (material.metallic === undefined) warnings.push(`materials.${key}.metallic defaults to 0 for pbr`);
      if (material.roughness === undefined) warnings.push(`materials.${key}.roughness defaults to 1 for pbr`);
    }
  }
}

function validateInputs(manifest, errors) {
  const inputs = manifest.inputs || {};
  const handles = (manifest.handles || {}).inputs || {};
  for (const [key, input] of Object.entries(inputs)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push(`inputs.${key} must use an identifier key`);
    if (!["axis", "button", "pointer", "touch"].includes(input.kind || "")) {
      errors.push(`inputs.${key}.kind must be axis, button, pointer, or touch`);
    }
    if (!Number.isInteger(input.handle) || input.handle <= 0) errors.push(`inputs.${key}.handle must be a positive integer`);
    if (handles[key] !== undefined && handles[key] !== input.handle) {
      errors.push(`handles.inputs.${key} must match inputs.${key}.handle`);
    }
    const bindings = input.bindings || {};
    for (const target of ["browser", "native"]) {
      if (bindings[target] !== undefined && typeof bindings[target] !== "string") {
        errors.push(`inputs.${key}.bindings.${target} must be a string`);
      } else if (bindings[target]) {
        validateInputBinding(`inputs.${key}.bindings.${target}`, bindings[target], errors);
      }
    }
  }
}

function validateInputBinding(name, binding, errors) {
  const tokens = String(binding).split("|").map((item) => item.trim()).filter(Boolean);
  const ok = /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Mouse(Left|Right|Middle)|mouse\.(dx|dy)|wheel\.y|touch\.(x|y)|Space)$/;
  for (const token of tokens) {
    if (!ok.test(token)) errors.push(`${name} contains unknown input binding '${token}'`);
  }
}

function validateUi(manifest, errors) {
  const ui = manifest.ui || {};
  const textures = (manifest.assets || {}).textures || {};
  const sprites = (manifest.assets || {}).sprites || {};
  const fonts = (manifest.assets || {}).fonts || {};
  for (const [key, panel] of Object.entries(ui.panels || {})) {
    if (!Array.isArray(panel.rect) || panel.rect.length !== 4 || !panel.rect.every(Number.isFinite)) {
      errors.push(`ui.panels.${key}.rect must be an array of 4 numbers`);
    }
  }
  for (const [key, label] of Object.entries(ui.textLabels || {})) {
    if (label.font && !fonts[label.font]) errors.push(`ui.textLabels.${key} references unknown font '${label.font}'`);
    if (typeof label.text !== "string") errors.push(`ui.textLabels.${key}.text must be a string`);
  }
  for (const [key, quad] of Object.entries(ui.imageQuads || {})) {
    if (!quad.texture && !quad.sprite) errors.push(`ui.imageQuads.${key} must reference texture or sprite`);
    if (quad.texture && !textures[quad.texture]) errors.push(`ui.imageQuads.${key} references unknown texture '${quad.texture}'`);
    if (quad.sprite && !sprites[quad.sprite]) errors.push(`ui.imageQuads.${key} references unknown sprite '${quad.sprite}'`);
  }
  for (const [key, gizmo] of Object.entries(ui.gizmos || {})) {
    if (gizmo.node && !((manifest.scene || {}).nodes || {})[gizmo.node]) errors.push(`ui.gizmos.${key} references unknown node '${gizmo.node}'`);
  }
}

function validateScene(manifest, errors, warnings) {
  const scene = manifest.scene || {};
  const models = (manifest.assets || {}).models || {};
  const spriteAssets = (manifest.assets || {}).sprites || {};
  const skeletons = (manifest.assets || {}).skeletons || {};
  const animations = (manifest.assets || {}).animations || {};
  const vectors = (manifest.assets || {}).vectors || {};
  const materials = manifest.materials || {};
  for (const [key, camera] of Object.entries(scene.cameras || {})) {
    if (camera.kind && !["perspective", "orthographic"].includes(camera.kind)) {
      errors.push(`scene.cameras.${key}.kind must be perspective or orthographic`);
    }
    if (camera.fovY !== undefined && (!Number.isFinite(camera.fovY) || camera.fovY <= 0 || camera.fovY >= 180)) {
      errors.push(`scene.cameras.${key}.fovY must be between 0 and 180`);
    }
    validateOptionalNumber(`scene.cameras.${key}.near`, camera.near, errors, { min: 0 });
    validateOptionalNumber(`scene.cameras.${key}.far`, camera.far, errors, { min: 0 });
    if (camera.near !== undefined && camera.far !== undefined && camera.near >= camera.far) {
      errors.push(`scene.cameras.${key}.near must be smaller than far`);
    }
    validateVec(`scene.cameras.${key}.position`, camera.position, 3, errors, { optional: true });
    validateVec(`scene.cameras.${key}.target`, camera.target, 3, errors, { optional: true });
  }
  for (const [key, light] of Object.entries(scene.lights || {})) {
    if (light.kind && !["directional", "point", "spot", "ambient"].includes(light.kind)) {
      errors.push(`scene.lights.${key}.kind is unsupported`);
    }
    if (light.color !== undefined && (!Array.isArray(light.color) || light.color.length !== 3 || !light.color.every(Number.isFinite))) {
      errors.push(`scene.lights.${key}.color must be an array of 3 numbers`);
    }
    if (light.intensity !== undefined && (!Number.isFinite(light.intensity) || light.intensity < 0)) {
      errors.push(`scene.lights.${key}.intensity must be a non-negative number`);
    }
    validateVec(`scene.lights.${key}.direction`, light.direction, 3, errors, { optional: true });
    validateVec(`scene.lights.${key}.position`, light.position, 3, errors, { optional: true });
    if (light.kind === "directional" && !light.direction) errors.push(`scene.lights.${key}.direction is required for directional lights`);
    if ((light.kind === "point" || light.kind === "spot") && !light.position) errors.push(`scene.lights.${key}.position is required for ${light.kind} lights`);
  }
  for (const [key, node] of Object.entries(scene.nodes || {})) {
    if (!node.mesh) errors.push(`scene.nodes.${key}.mesh is required`);
    if (node.mesh && !models[node.mesh]) errors.push(`scene.nodes.${key} references unknown mesh '${node.mesh}'`);
    if (!node.material) errors.push(`scene.nodes.${key}.material is required`);
    if (node.material && !materials[node.material]) errors.push(`scene.nodes.${key} references unknown material '${node.material}'`);
    validateTransform(`scene.nodes.${key}.transform`, node.transform, errors);
  }
  for (const [key, instance] of Object.entries(scene.meshInstances || {})) {
    if (!instance.mesh) errors.push(`scene.meshInstances.${key}.mesh is required`);
    if (instance.mesh && !models[instance.mesh]) errors.push(`scene.meshInstances.${key} references unknown mesh '${instance.mesh}'`);
    if (!instance.material) errors.push(`scene.meshInstances.${key}.material is required`);
    if (instance.material && !materials[instance.material]) errors.push(`scene.meshInstances.${key} references unknown material '${instance.material}'`);
    if (instance.count !== undefined && (!Number.isInteger(instance.count) || instance.count <= 0)) {
      errors.push(`scene.meshInstances.${key}.count must be a positive integer`);
    }
    validateTransform(`scene.meshInstances.${key}.transform`, instance.transform, errors);
  }
  for (const [key, instance] of Object.entries(scene.instances || {})) {
    if (!instance.model) errors.push(`scene.instances.${key}.model is required`);
    if (instance.model && !models[instance.model]) errors.push(`scene.instances.${key} references unknown model '${instance.model}'`);
    if (!instance.material) errors.push(`scene.instances.${key}.material is required`);
    if (instance.material && !materials[instance.material]) errors.push(`scene.instances.${key} references unknown material '${instance.material}'`);
    if (!Number.isInteger(instance.count) || instance.count <= 0) {
      errors.push(`scene.instances.${key}.count must be a positive integer`);
    }
    if (!Array.isArray(instance.transforms)) {
      errors.push(`scene.instances.${key}.transforms must be an array`);
    } else {
      if (Number.isInteger(instance.count) && instance.transforms.length !== instance.count) {
        errors.push(`scene.instances.${key}.transforms length must match count`);
      }
      instance.transforms.forEach((transform, index) => {
        validateVec(`scene.instances.${key}.transforms[${index}].position`, transform.position, 3, errors);
        validateVec(`scene.instances.${key}.transforms[${index}].rotation`, transform.rotation, 3, errors);
        validateVec(`scene.instances.${key}.transforms[${index}].scale`, transform.scale, 3, errors);
      });
    }
  }
  for (const [key, sprite] of Object.entries(scene.sprites || {})) {
    if (!sprite.sprite) errors.push(`scene.sprites.${key}.sprite is required`);
    if (sprite.sprite && !spriteAssets[sprite.sprite]) errors.push(`scene.sprites.${key} references unknown sprite '${sprite.sprite}'`);
    if (sprite.material && !materials[sprite.material]) errors.push(`scene.sprites.${key} references unknown material '${sprite.material}'`);
  }
  for (const [key, voxel] of Object.entries(scene.voxels || {})) {
    if (voxel.material && !materials[voxel.material]) errors.push(`scene.voxels.${key} references unknown material '${voxel.material}'`);
    if (voxel.chunkSize !== undefined && (!Number.isInteger(voxel.chunkSize) || voxel.chunkSize <= 0)) {
      errors.push(`scene.voxels.${key}.chunkSize must be a positive integer`);
    }
    if (voxel.budget !== undefined && (!Number.isInteger(voxel.budget) || voxel.budget <= 0)) {
      errors.push(`scene.voxels.${key}.budget must be a positive integer`);
    }
  }
  for (const [key, particles] of Object.entries(scene.particles || {})) {
    if (particles.material && !materials[particles.material]) errors.push(`scene.particles.${key} references unknown material '${particles.material}'`);
    if (particles.count !== undefined && (!Number.isInteger(particles.count) || particles.count <= 0)) {
      errors.push(`scene.particles.${key}.count must be a positive integer`);
    }
    if (particles.budget !== undefined && (!Number.isInteger(particles.budget) || particles.budget <= 0)) {
      errors.push(`scene.particles.${key}.budget must be a positive integer`);
    }
    if (particles.count !== undefined && particles.budget !== undefined && particles.count > particles.budget) {
      errors.push(`scene.particles.${key}.count exceeds budget`);
    }
    if (particles.emitter !== undefined && !["point", "box", "sphere"].includes(particles.emitter)) {
      errors.push(`scene.particles.${key}.emitter must be point, box, or sphere`);
    }
    if (particles.bounds !== undefined && (!Array.isArray(particles.bounds) || particles.bounds.length !== 3 || !particles.bounds.every(Number.isFinite))) {
      errors.push(`scene.particles.${key}.bounds must be an array of 3 numbers`);
    }
  }
  for (const [key, animator] of Object.entries(scene.animators || {})) {
    if (!animator.node) errors.push(`scene.animators.${key}.node is required`);
    if (animator.node && !(scene.nodes || {})[animator.node]) errors.push(`scene.animators.${key} references unknown node '${animator.node}'`);
    if (animator.skeleton && !skeletons[animator.skeleton]) errors.push(`scene.animators.${key} references unknown skeleton '${animator.skeleton}'`);
    if (!animator.clip) errors.push(`scene.animators.${key}.clip is required`);
    if (animator.clip && !animations[animator.clip]) errors.push(`scene.animators.${key} references unknown animation '${animator.clip}'`);
    if (animator.playback && !["once", "loop", "pingpong"].includes(animator.playback)) errors.push(`scene.animators.${key}.playback must be once, loop, or pingpong`);
    validateOptionalNumber(`scene.animators.${key}.speed`, animator.speed, errors, { min: 0 });
    validateOptionalNumber(`scene.animators.${key}.weight`, animator.weight, errors, { min: 0 });
  }
  for (const [key, decal] of Object.entries(scene.vectorDecals || {})) {
    if (!decal.vector) errors.push(`scene.vectorDecals.${key}.vector is required`);
    if (decal.vector && !vectors[decal.vector]) errors.push(`scene.vectorDecals.${key} references unknown vector '${decal.vector}'`);
    if (decal.material && !materials[decal.material]) errors.push(`scene.vectorDecals.${key} references unknown material '${decal.material}'`);
    if (decal.space && !["world", "screen", "ui"].includes(decal.space)) errors.push(`scene.vectorDecals.${key}.space must be world, screen, or ui`);
    validateTransform(`scene.vectorDecals.${key}.transform`, decal.transform, errors);
    validateOptionalNumber(`scene.vectorDecals.${key}.alpha`, decal.alpha, errors, { min: 0, max: 1 });
  }
  const visibleGroups = ["nodes", "instances", "meshInstances", "voxels", "sprites", "particles", "vectorDecals"];
  if (visibleGroups.every((group) => Object.keys(scene[group] || {}).length === 0)) {
    warnings.push("scene has no nodes, meshInstances, voxels, sprites, particles, or vectorDecals");
  }
}

function validateRenderGraph(manifest, errors) {
  const pipelines = manifest.pipelines || {};
  const materials = manifest.materials || {};
  const scene = manifest.scene || {};
  const post = manifest.post || {};
  const targets = manifest.renderTargets || {};
  for (const [key, graph] of Object.entries(manifest.renderGraphs || {})) {
    if (!Array.isArray(graph.passes) || graph.passes.length === 0) {
      errors.push(`renderGraphs.${key}.passes must contain at least one pass`);
      continue;
    }
    const seenOutputs = new Set(["surface"]);
    let hasPresent = false;
    for (const [index, pass] of graph.passes.entries()) {
      const prefix = `renderGraphs.${key}.passes[${index}]`;
      if (!pass.key) errors.push(`${prefix}.key is required`);
      if (!pass.kind || !["clear", "geometry", "sprite", "vector", "voxel", "particles", "ui", "post", "present", "skybox", "environment"].includes(pass.kind)) {
        errors.push(`${prefix}.kind is unsupported`);
      }
      if (pass.pipeline && !pipelines[pass.pipeline]) errors.push(`${prefix} references unknown pipeline '${pass.pipeline}'`);
      if (pass.material && !materials[pass.material]) errors.push(`${prefix} references unknown material '${pass.material}'`);
      if (pass.camera && !(scene.cameras || {})[pass.camera]) errors.push(`${prefix} references unknown camera '${pass.camera}'`);
      if (pass.effect && !post[pass.effect]) errors.push(`${prefix} references unknown post effect '${pass.effect}'`);
      if (pass.output && !targets[pass.output] && pass.output !== "surface") errors.push(`${prefix} output '${pass.output}' is not declared in renderTargets`);
      if (pass.kind === "skybox" || pass.kind === "environment") {
        validateSkyboxPass(prefix, pass, manifest, errors);
      }
      for (const input of pass.inputs || []) {
        if (!seenOutputs.has(input)) errors.push(`${prefix} input '${input}' is not produced by an earlier pass`);
        if (input !== "surface" && !targets[input]) errors.push(`${prefix} input '${input}' is not declared in renderTargets`);
      }
      if (pass.output) seenOutputs.add(pass.output);
      if (pass.kind === "present") hasPresent = true;
    }
    if (!hasPresent) errors.push(`renderGraphs.${key} must end in or include a present pass`);
  }
}

function validateSkyboxPass(prefix, pass, manifest, errors) {
  const cubemaps = (manifest.assets || {}).cubemaps || {};
  const pipeline = pass.pipeline ? (manifest.pipelines || {})[pass.pipeline] : null;
  if (!pass.environment) errors.push(`${prefix}.environment is required for skybox/environment passes`);
  if (pass.environment && !cubemaps[pass.environment]) {
    errors.push(`${prefix} references unknown environment cubemap '${pass.environment}'`);
  }
  for (const field of [
    "node",
    "mesh",
    "meshInstance",
    "transform",
    "translation",
    "position",
    "parent",
    "attachToCamera",
    "followCamera",
    "cameraSpace",
    "playerSpace",
    "inheritCameraTransform",
    "inheritPlayerTransform"
  ]) {
    if (pass[field] !== undefined) errors.push(`${prefix}.${field} is not allowed on skybox/environment passes`);
  }
  if (pipeline && (pipeline.depthWrite === true || pipeline.depth === true)) {
    errors.push(`${prefix} skybox/environment pipeline must disable depth writes`);
  }
}

function validateQualityProfiles(manifest, warnings) {
  for (const [key, profile] of Object.entries(manifest.qualityProfiles || {})) {
    if (profile.maxTextureSize && key.includes("mobile") && profile.maxTextureSize > 4096) {
      warnings.push(`qualityProfiles.${key}.maxTextureSize is high for mobile`);
    }
    if (profile.maxInstances && key.includes("mobile") && profile.maxInstances > 10000) {
      warnings.push(`qualityProfiles.${key}.maxInstances is high for mobile`);
    }
  }
}

function validateTransform(name, transform, errors) {
  if (!transform) return;
  for (const key of ["translation", "rotation", "scale"]) {
    validateVec(`${name}.${key}`, transform[key], 3, errors, { optional: true });
  }
  validateVec(`${name}.rotationQuat`, transform.rotationQuat, 4, errors, { optional: true });
}

function validateVec(name, value, length, errors, options = {}) {
  if (value === undefined || value === null) {
    if (!options.optional) errors.push(`${name} is required`);
    return;
  }
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    errors.push(`${name} must be an array of ${length} numbers`);
  }
}

function validateOptionalNumber(name, value, errors, options = {}) {
  if (value === undefined) return;
  if (!Number.isFinite(value)) {
    errors.push(`${name} must be a number`);
    return;
  }
  if (options.min !== undefined && value < options.min) errors.push(`${name} must be >= ${options.min}`);
  if (options.max !== undefined && value > options.max) errors.push(`${name} must be <= ${options.max}`);
}

function validateOptionalInteger(name, value, errors, options = {}) {
  if (value === undefined) return;
  if (!Number.isInteger(value)) {
    errors.push(`${name} must be an integer`);
    return;
  }
  if (options.min !== undefined && value < options.min) errors.push(`${name} must be >= ${options.min}`);
  if (options.max !== undefined && value > options.max) errors.push(`${name} must be <= ${options.max}`);
}

function validateHandles(manifest, errors) {
  const handles = manifest.handles || {};
  for (const [kind, values] of Object.entries(handles)) {
    const seen = new Set();
    for (const [key, raw] of Object.entries(values || {})) {
      if (!Number.isInteger(raw) || raw <= 0) errors.push(`handles.${kind}.${key} must be a positive integer`);
      if (seen.has(raw)) errors.push(`handles.${kind}.${key} duplicates handle ${raw}`);
      seen.add(raw);
    }
  }
}

function validateGpuExterns(mod, manifest, errors) {
  for (const ex of mod.externs || []) {
    if (!ex.name.startsWith("gpu.")) continue;
    const expected = GPU_SIGNATURES.get(ex.name);
    if (!expected) {
      errors.push(`unsupported GPU extern '${ex.name}'`);
      continue;
    }
    const actual = ex.params.map((param) => param.type);
    if (actual.join(",") !== expected.params.join(",") || ex.returnType !== expected.returnType) {
      errors.push(`extern ${ex.name} signature must be (${expected.params.join(", ")}) -> ${expected.returnType}`);
    }
  }
  if (!Object.keys(manifest.pipelines || {}).length) errors.push("manifest must define at least one pipeline");
}

function validateInputExterns(mod, manifest, errors) {
  const hasInputExtern = (mod.externs || []).some((ex) => ex.name.startsWith("input."));
  if (hasInputExtern && !mod.capabilities.has("input")) errors.push("AIR module must declare capability 'input'");
  for (const ex of mod.externs || []) {
    if (!ex.name.startsWith("input.")) continue;
    const expected = INPUT_SIGNATURES.get(ex.name);
    if (!expected) {
      errors.push(`unsupported input extern '${ex.name}'`);
      continue;
    }
    const actual = ex.params.map((param) => param.type);
    if (actual.join(",") !== expected.params.join(",") || ex.returnType !== expected.returnType) {
      errors.push(`extern ${ex.name} signature must be (${expected.params.join(", ")}) -> ${expected.returnType}`);
    }
  }
}

function validateInteractiveExports(mod, manifest, warnings) {
  const isInteractive = mod.capabilities.has("gpu") || mod.capabilities.has("input") || manifest.inputs || manifest.ui;
  if (!isInteractive) return;
  const frame = (mod.functions || []).find((fn) => fn.exported && fn.name === "frame");
  if (!frame) {
    warnings.push("interactive AIR package should export frame(time_ms: i32) -> void");
    return;
  }
  if (frame.returnType !== "void" || frame.params.length !== 1 || frame.params[0].type !== "i32") {
    warnings.push("interactive frame export should have signature frame(time_ms: i32) -> void");
  }
}

function validateGpuLifecycle(mod, manifest, errors, warnings) {
  for (const fn of mod.functions.filter((item) => item.exported)) {
    let inPass = false;
    let hasPipeline = false;
    let hasRenderGraphSubmit = false;
    let hasManualLifecycle = false;
    for (const block of fn.blocks) {
      const consts = new Map();
      for (const ins of block.instructions) {
        if (ins.result && ins.op === "const.i32" && ins.args[0] && ins.args[0].kind === "number") {
          consts.set(ins.result, ins.args[0].value);
        }
        if (ins.op !== "call" || !ins.callee.startsWith("gpu.")) continue;
        if (ins.callee === "gpu.execute_render_graph") hasRenderGraphSubmit = true;
        if (isManualGpuLifecycleCall(ins.callee)) hasManualLifecycle = true;
        if (ins.callee === "gpu.begin_pass") {
          if (inPass) errors.push(`${fn.name}: gpu.begin_pass called while pass is already active`);
          inPass = true;
          hasPipeline = false;
        } else if (ins.callee === "gpu.set_pipeline") {
          if (!inPass) errors.push(`${fn.name}: gpu.set_pipeline before gpu.begin_pass`);
          hasPipeline = true;
        } else if (ins.callee.startsWith("gpu.draw")) {
          if (!inPass) errors.push(`${fn.name}: ${ins.callee} before gpu.begin_pass`);
          if (!hasPipeline) errors.push(`${fn.name}: ${ins.callee} before gpu.set_pipeline`);
        } else if (ins.callee === "gpu.end_pass") {
          if (!inPass) errors.push(`${fn.name}: gpu.end_pass without active pass`);
          inPass = false;
          hasPipeline = false;
        } else if (ins.callee === "gpu.submit") {
          if (inPass) errors.push(`${fn.name}: gpu.submit before gpu.end_pass`);
        }
        validateStaticGpuHandle(ins, consts, manifest, errors, fn.name);
      }
    }
    if (hasRenderGraphSubmit && hasManualLifecycle) {
      errors.push(`${fn.name}: do not mix gpu.execute_render_graph with manual begin/pass/draw/submit lifecycle in the same exported function`);
    }
    if (inPass) errors.push(`${fn.name}: render pass is not closed`);
    if (!hasRenderGraphSubmit && !fn.blocks.some((block) => block.instructions.some((ins) => ins.op === "call" && ins.callee === "gpu.submit"))) {
      warnings.push(`${fn.name}: exported GPU function does not call gpu.submit`);
    }
  }
}

function isManualGpuLifecycleCall(callee) {
  return callee === "gpu.begin_frame"
    || callee === "gpu.begin_pass"
    || callee === "gpu.set_pipeline"
    || callee.startsWith("gpu.draw")
    || callee === "gpu.end_pass"
    || callee === "gpu.submit";
}

function validateGfxBudgets(mod, manifest, errors) {
  const usage = manifestGpuUsage(manifest);
  for (const budget of mod.effects || []) {
    if (!budget.key.startsWith("gpu.")) continue;
    const actual = usage.get(budget.key);
    if (actual === undefined) continue;
    if (!compareBudget(actual, budget.op || "<=", budget.limit)) {
      errors.push(`gfx budget '${budget.key} ${budget.op || "<="} ${budget.limit}' is not satisfied by manifest: ${actual}`);
    }
  }
}

function manifestGpuUsage(manifest) {
  const usage = new Map();
  const add = (key, amount = 1) => usage.set(key, (usage.get(key) || 0) + amount);
  for (const graph of Object.values(manifest.renderGraphs || {})) {
    for (const pass of graph.passes || []) {
      add("gpu.render_passes");
      if (pass.kind === "post") add("gpu.post_passes");
      if (pass.kind === "skybox" || pass.kind === "environment") add("gpu.skybox_passes");
      if (pass.kind === "geometry" || pass.kind === "sprite" || pass.kind === "vector" || pass.kind === "voxel" || pass.kind === "particles" || pass.kind === "ui") {
        add("gpu.draw_passes");
      }
    }
  }
  add("gpu.post_effects", Object.keys(manifest.post || {}).length);
  const scene = manifest.scene || {};
  const nodeUnits = Object.values(scene.nodes || {}).reduce((sum, node) => sum + Math.max(1, node.instances || 1), 0);
  const meshUnits = Object.values(scene.meshInstances || {}).reduce((sum, node) => sum + Math.max(1, node.count || 1), 0);
  const instanceUnits = Object.values(scene.instances || {}).reduce((sum, node) => sum + Math.max(1, node.count || 1), 0);
  const spriteUnits = Object.values(scene.sprites || {}).reduce((sum, sprite) => sum + Math.max(1, sprite.batch || 1), 0);
  const vectorUnits = Object.values(scene.vectorDecals || {}).reduce((sum, decal) => sum + Math.max(1, decal.count || 1), 0);
  const voxelUnits = Object.values(scene.voxels || {}).reduce((sum, voxel) => sum + Math.max(1, Math.floor((voxel.budget || 64) / 64)), 0);
  const particleUnits = Object.values(scene.particles || {}).reduce((sum, particles) => sum + Math.max(1, particles.count || particles.budget || 1), 0);
  add("gpu.scene_draw_units", nodeUnits + meshUnits + instanceUnits + spriteUnits + vectorUnits + voxelUnits + particleUnits);
  add("gpu.lights", Object.keys(scene.lights || {}).length);
  add("gpu.materials", Object.keys(manifest.materials || {}).length);
  add("gpu.textures", Object.keys((manifest.assets || {}).textures || {}).length);
  add("gpu.vectors", Object.keys((manifest.assets || {}).vectors || {}).length);
  add("gpu.animators", Object.keys(scene.animators || {}).length);
  return usage;
}

function compareBudget(actual, op, limit) {
  if (op === "<=") return actual <= limit;
  if (op === "==") return actual === limit;
  if (op === ">=") return actual >= limit;
  return false;
}

function validateStaticGpuHandle(ins, consts, manifest, errors, fnName) {
  const expected = GPU_SIGNATURES.get(ins.callee);
  if (!expected || !expected.handleArg) return;
  const arg = ins.args[expected.handleArg.index];
  const handle = staticNumber(arg, consts);
  if (handle === undefined) return;
  const map = handlesForKind(manifest, expected.handleArg.kind);
  if (!Object.values(map).includes(handle)) {
    errors.push(`${fnName}: ${ins.callee} references unknown ${expected.handleArg.kind} handle ${handle}`);
  }
}

function handlesForKind(manifest, kind) {
  const handles = manifest.handles || {};
  if (kind === "pipeline") return handles.pipelines || {};
  if (kind === "renderGraph") return handles.renderGraphs || {};
  if (kind === "camera") return handles.cameras || {};
  if (kind === "node") return handles.nodes || {};
  if (kind === "voxel") return handles.voxels || {};
  if (kind === "particle") return handles.particles || {};
  if (kind === "mesh") return handles.models || handles.meshes || {};
  if (kind === "sprite") return handles.sprites || {};
  if (kind === "buffer") return handles.buffers || {};
  if (kind === "bindGroup") return handles.bindGroups || {};
  if (kind === "input") return handles.inputs || {};
  return {};
}

function staticNumber(arg, consts) {
  if (!arg) return undefined;
  if (arg.kind === "number") return arg.value;
  if (arg.kind === "value") return consts.get(arg.name);
  return undefined;
}

function summarizeManifest(manifest) {
  return {
    module: manifest.module,
    shaders: Object.keys(manifest.shaders || {}).length,
    pipelines: Object.keys(manifest.pipelines || {}).length,
    renderTargets: Object.keys(manifest.renderTargets || {}).length,
    renderGraphs: Object.keys(manifest.renderGraphs || {}).length,
    cameras: Object.keys((manifest.scene || {}).cameras || {}).length,
    lights: Object.keys((manifest.scene || {}).lights || {}).length,
    nodes: Object.keys((manifest.scene || {}).nodes || {}).length,
    instances: Object.keys((manifest.scene || {}).instances || {}).length,
    meshInstances: Object.keys((manifest.scene || {}).meshInstances || {}).length,
    voxels: Object.keys((manifest.scene || {}).voxels || {}).length,
    particles: Object.keys((manifest.scene || {}).particles || {}).length,
    animators: Object.keys((manifest.scene || {}).animators || {}).length,
    vectorDecals: Object.keys((manifest.scene || {}).vectorDecals || {}).length,
    postEffects: Object.keys(manifest.post || {}).length,
    models: Object.keys((manifest.assets || {}).models || {}).length,
    textures: Object.keys((manifest.assets || {}).textures || {}).length,
    skeletons: Object.keys((manifest.assets || {}).skeletons || {}).length,
    animations: Object.keys((manifest.assets || {}).animations || {}).length,
    vectors: Object.keys((manifest.assets || {}).vectors || {}).length,
    skyboxes: Object.keys((manifest.assets || {}).cubemaps || {}).length,
    sprites: Object.keys((manifest.assets || {}).sprites || {}).length,
    inputs: Object.keys(manifest.inputs || {}).length,
    uiPanels: Object.keys((manifest.ui || {}).panels || {}).length
  };
}

function copyManifestAssets(manifest, outDir) {
  const copied = new Set();
  const refs = [];
  for (const shader of Object.values(manifest.shaders || {})) refs.push(shader.path);
  const assets = manifest.assets || {};
  for (const group of ["models", "textures", "spriteAtlases", "cubemaps", "fonts", "vectors", "skeletons", "animations"]) {
    for (const value of Object.values(assets[group] || {})) refs.push(typeof value === "string" ? value : value.path);
  }
  for (const ref of refs.filter(Boolean)) {
    if (copied.has(ref)) continue;
    copied.add(ref);
    const src = resolveManifestPath(manifest, ref);
    const dest = path.join(outDir, ref);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function resolveManifestPath(manifest, ref) {
  const packageRelative = path.resolve(manifest.__dir || process.cwd(), ref);
  if (fs.existsSync(packageRelative)) return packageRelative;
  const repoRelative = path.resolve(__dirname, "..", ref);
  if (fs.existsSync(repoRelative)) return repoRelative;
  return packageRelative;
}

function stripPrivateManifestFields(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  delete copy.__file;
  delete copy.__dir;
  return copy;
}

module.exports = {
  GPU_SIGNATURES,
  INPUT_SIGNATURES,
  loadGfxManifest,
  validateGfxManifest,
  emitGfxWit,
  buildGfxPackage
};
