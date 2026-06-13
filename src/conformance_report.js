const { AIR_ABI_VERSION } = require("./version");
const { verifyModule } = require("./verifier");
const { validateGfxManifest } = require("./gfx_manifest");
const { createAudioAuthorityReport } = require("./audio_authority");
const { createHostProfileReport, loadHostProfile } = require("./host_profiles");
const { createAiReviewReport } = require("./ai_review");
const { staticTableMetadata, staticTableSummary, tableGroupMetadata, tableGroupSummary } = require("./table_metadata");
const { stateSegmentMetadata, stateSegmentSummary } = require("./state_metadata");
const { poolMetadata, poolSummary } = require("./pool_metadata");

function createConformanceReport(mod, options = {}) {
  const errors = [];
  const warnings = [];
  let strictHostAbiStatus = "pass";
  const strictHostAbiErrors = [];
  let manifestValidation = null;
  const audio = createAudioAuthorityReport(mod, { manifest: options.audioManifest });
  let hostProfile = null;

  try {
    verifyModule(mod);
  } catch (err) {
    strictHostAbiStatus = "fail";
    const message = errorMessage(err);
    strictHostAbiErrors.push(message);
    errors.push(message);
  }

  if (options.manifest) {
    manifestValidation = validateGfxManifest(mod, options.manifest);
    warnings.push(...manifestValidation.warnings);
    errors.push(...manifestValidation.errors);
  }
  warnings.push(...audio.warnings);
  errors.push(...audio.errors);

  if (options.profile) {
    const profile = loadHostProfile(options.profile);
    hostProfile = createHostProfileReport({
      hostAbi: options.hostAbi || AIR_ABI_VERSION,
      capabilities: Array.from(mod.capabilities || []),
      hostImports: (mod.externs || []).map((ex) => ex.name),
      manifestKinds: manifestKinds(options)
    }, profile);
    errors.push(...hostProfile.errors);
  }

  const report = {
    reportVersion: "0.11",
    status: errors.length === 0 ? "pass" : "fail",
    moduleName: mod.name,
    airAbiVersion: AIR_ABI_VERSION,
    constants: constants(mod),
    staticTables: staticTableMetadata(mod),
    staticTableSummary: staticTableSummary(mod),
    tableGroups: tableGroupMetadata(mod),
    tableGroupSummary: tableGroupSummary(mod),
    stateSegments: stateSegmentMetadata(mod),
    stateSegmentSummary: stateSegmentSummary(mod),
    pools: poolMetadata(mod),
    poolSummary: poolSummary(mod),
    exports: exportedFunctions(mod),
    capabilities: Array.from(mod.capabilities || []).sort(),
    hostImports: hostImports(mod),
    strictHostAbi: {
      status: strictHostAbiStatus,
      errors: strictHostAbiErrors.sort()
    },
    manifestFeatures: options.manifest ? manifestFeatures(options.manifest, manifestValidation) : null,
    loadedAssets: options.manifest ? loadedAssets(options.manifest, manifestValidation) : [],
    resources: options.manifest ? manifestResources(options.manifest) : null,
    audio,
    unsupportedHostFeatures: unsupportedHostFeatures(errors, warnings),
    fallbackBehavior: fallbackBehavior(errors, warnings),
    warnings: warnings.sort(),
    errors: errors.sort(),
    repairHint: repairHint(errors, warnings)
  };
  if (hostProfile) report.hostProfile = hostProfile;
  if (options.aiReview) report.aiReview = createAiReviewReport(mod, { source: options.source });
  return report;
}

function manifestKinds(options) {
  const kinds = [];
  if (options.manifest) kinds.push("gfx");
  if (options.audioManifest) kinds.push("audio");
  return kinds;
}

function exportedFunctions(mod) {
  return (mod.functions || [])
    .filter((fn) => fn.exported)
    .map((fn) => ({
      name: fn.name,
      params: fn.params,
      returnType: fn.returnType
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function constants(mod) {
  return (mod.constants || [])
    .map((constant) => ({
      name: constant.name,
      type: constant.type,
      value: constant.value && constant.value.raw ? constant.value.raw : String(constant.value && constant.value.value)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function hostImports(mod) {
  return (mod.externs || [])
    .map((ex) => ({
      name: ex.name,
      capability: ex.name.includes(".") ? ex.name.slice(0, ex.name.indexOf(".")) : null,
      params: ex.params,
      returnType: ex.returnType
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function manifestFeatures(manifest, validation) {
  const scene = manifest.scene || {};
  const assets = manifest.assets || {};
  return {
    version: manifest.version || null,
    module: manifest.module || null,
    ok: validation ? validation.ok : null,
    shaders: objectKeys(manifest.shaders),
    pipelines: objectKeys(manifest.pipelines),
    renderTargets: objectKeys(manifest.renderTargets),
    renderGraphs: objectKeys(manifest.renderGraphs),
    assets: {
      models: objectKeys(assets.models),
      textures: objectKeys(assets.textures),
      sprites: objectKeys(assets.sprites),
      spriteAtlases: objectKeys(assets.spriteAtlases),
      cubemaps: objectKeys(assets.cubemaps),
      fonts: objectKeys(assets.fonts),
      vectors: objectKeys(assets.vectors),
      skeletons: objectKeys(assets.skeletons),
      animations: objectKeys(assets.animations)
    },
    scene: {
      cameras: objectKeys(scene.cameras),
      lights: objectKeys(scene.lights),
      nodes: objectKeys(scene.nodes),
      instances: objectKeys(scene.instances),
      meshInstances: objectKeys(scene.meshInstances),
      sprites: objectKeys(scene.sprites),
      voxels: objectKeys(scene.voxels),
      particles: objectKeys(scene.particles)
    },
    inputs: objectKeys(manifest.inputs),
    uiPanels: objectKeys((manifest.ui || {}).panels)
  };
}

function unsupportedHostFeatures(errors, warnings) {
  return Array.from(new Set([...errors, ...warnings].filter((item) => /unsupported|fallback/i.test(item)))).sort();
}

function loadedAssets(manifest, validation) {
  const assets = manifest.assets || {};
  const errors = validation ? validation.errors : [];
  const groups = [
    "models",
    "textures",
    "sprites",
    "spriteAtlases",
    "cubemaps",
    "fonts",
    "vectors",
    "skeletons",
    "animations"
  ];
  const out = {};
  for (const group of groups) {
    out[group] = Object.entries(assets[group] || {})
      .map(([key, value]) => ({
        key,
        path: typeof value.path === "string" ? value.path : null,
        format: typeof value.format === "string" ? value.format : null,
        status: assetStatus(group, key, errors)
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
  return out;
}

function assetStatus(group, key, errors) {
  const prefix = `assets.${group}.${key}`;
  const matches = errors.filter((item) => item.includes(prefix));
  if (matches.some((item) => /path not found|must define a path/i.test(item))) return "missing";
  if (matches.some((item) => /unsupported/i.test(item))) return "unsupported";
  if (matches.length > 0) return "invalid";
  return "declared";
}

function manifestResources(manifest) {
  return {
    shaders: objectKeys(manifest.shaders),
    pipelines: objectKeys(manifest.pipelines),
    renderTargets: objectKeys(manifest.renderTargets),
    renderGraphs: objectKeys(manifest.renderGraphs),
    handles: manifestHandles(manifest.handles)
  };
}

function manifestHandles(handles) {
  const out = {};
  for (const key of objectKeys(handles)) {
    out[key] = objectKeys(handles[key]);
  }
  return out;
}

function fallbackBehavior(errors, warnings) {
  return Array.from(new Set([...errors, ...warnings].filter((item) => /fallback|defaults to/i.test(item)))).sort();
}

function repairHint(errors, warnings) {
  const messages = [...errors, ...warnings].join("\n");
  if (!messages) return null;
  if (/unsupported host extern|signature must be|requires capability/.test(messages)) {
    return "Use a registered Host ABI import with the canonical signature and declare the matching capability.";
  }
  if (/manifest\.module|AIR module must declare capability 'gpu'/.test(messages)) {
    return "Make the AIR module name, capabilities, and .airgfx.json module field agree.";
  }
  if (/path not found|must define a path/.test(messages)) {
    return "Fix package-relative manifest asset paths or include the missing asset in the package.";
  }
  if (/unsupported/i.test(messages)) {
    return "Route unsupported features through manifest/host support work, or remove them from this package.";
  }
  if (/audio authority|module-driven audio|direct AIR audio/.test(messages)) {
    return "Declare capability 'audio' or add explicit host-owned audio authority with trigger sources in the package/app manifest.";
  }
  if (/gpu\./.test(messages)) {
    return "Check the GPU lifecycle, handles, pipelines, and render graph references in the AIR module and manifest.";
  }
  return "Review errors and warnings, then rerun airc report.";
}

function objectKeys(value) {
  return Object.keys(value || {}).sort();
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

module.exports = { createConformanceReport };
