const fs = require("fs");
const path = require("path");

const ASSET_MANIFEST_VERSION = "0.12";

const ASSET_KINDS = new Set([
  "sprites",
  "spriteAtlases",
  "textures",
  "audioSfx",
  "audioMusic",
  "models",
  "shaders",
  "materials",
  "rigs",
  "backgrounds",
  "binaries"
]);

const HOST_ASSET_KIND = {
  sprites: "sprite",
  spriteAtlases: "spriteAtlas",
  textures: "texture",
  audioSfx: "audioSfx",
  audioMusic: "audioMusic",
  models: "model",
  shaders: "shader",
  materials: "material",
  rigs: "rig",
  backgrounds: "background",
  binaries: "binary"
};

const EXTENSIONS = {
  sprites: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]),
  spriteAtlases: new Set([".json"]),
  textures: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]),
  audioSfx: new Set([".wav", ".mp3", ".ogg"]),
  audioMusic: new Set([".wav", ".mp3", ".ogg"]),
  models: new Set([".glb", ".gltf"]),
  shaders: new Set([".wgsl"]),
  rigs: new Set([".json"]),
  backgrounds: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]),
  binaries: null
};

const FORBIDDEN_RUNTIME_PATH_FRAGMENTS = [
  "assets_candidate",
  "assets_tmp_unused_previous",
  "graphics_bundles",
  "old_bundles",
  "quarantine",
  "references/full_pose",
  "tmp_unused"
];

class AssetManifestError extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.name = "AssetManifestError";
    this.errors = errors;
  }
}

function validateAssetManifest(packageDir, manifestPath, options = {}) {
  const base = path.resolve(packageDir);
  const manifestRef = validatePackageLocalPath(base, manifestPath, "asset manifest", []);
  const manifestAbs = manifestRef ? manifestRef.absolute : path.resolve(base, manifestPath || "");
  const errors = [];
  const warnings = [];
  const report = {
    ok: false,
    version: null,
    path: manifestRef ? manifestRef.relative : String(manifestPath || ""),
    assets: {},
    fallbacks: {},
    placeholders: [],
    resourceConsistency: {
      forbiddenRuntimeReferences: [],
      idReferences: [],
      unusedManifestEntries: []
    },
    authority: {
      audioGranted: false,
      note: "Asset existence does not grant AIR audio, graphics, filesystem, or network authority."
    },
    warnings,
    errors
  };

  if (!manifestRef) errors.push("asset manifest path must be relative and package-local");
  if (!fs.existsSync(manifestAbs)) {
    errors.push(`asset manifest does not exist: ${report.path}`);
    return finalize(report);
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestAbs, "utf8"));
  } catch (err) {
    errors.push(`invalid JSON in asset manifest ${report.path}: ${err.message}`);
    return finalize(report);
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("asset manifest must be a JSON object");
    return finalize(report);
  }

  report.version = requiredString(manifest.version, "version", errors);
  if (report.version && report.version !== ASSET_MANIFEST_VERSION) {
    warnings.push(`asset manifest version ${report.version} differs from expected ${ASSET_MANIFEST_VERSION}`);
  }

  validateFallbacks(base, manifest.fallbacks || {}, report);
  validateAssets(base, manifest.assets, report, options.profile || null);
  return finalize(report);
}

function validateAssets(base, assets, report, profile) {
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) {
    report.errors.push("assets must be an object");
    return;
  }

  for (const kind of Object.keys(assets).sort()) {
    if (!ASSET_KINDS.has(kind)) {
      report.errors.push(`unknown asset kind: ${kind}`);
      continue;
    }
    if (profile && !profile.supports.assetKinds.includes(HOST_ASSET_KIND[kind])) {
      report.errors.push(`profile ${profile.id} does not support asset kind ${HOST_ASSET_KIND[kind]}`);
    }
    const group = assets[kind];
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      report.errors.push(`assets.${kind} must be an object`);
      continue;
    }
    report.assets[kind] = {};
    for (const id of Object.keys(group).sort()) {
      report.assets[kind][id] = validateAssetEntry(base, kind, id, group[id], report);
    }
  }

  validateMaterialReferences(assets, report);
}

function validateAssetEntry(base, kind, id, entry, report) {
  const out = {
    path: null,
    exists: false,
    placeholder: false,
    status: "declared",
    warnings: [],
    errors: []
  };
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(id)) {
    pushEntryError(report, out, `assets.${kind}.${id} id must be stable`);
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    pushEntryError(report, out, `assets.${kind}.${id} must be an object`);
    return out;
  }

  if (kind === "materials") {
    validateMaterialEntry(kind, id, entry, report, out);
    return out;
  }

  const ref = validatePackageLocalPath(base, entry.path, `assets.${kind}.${id}.path`, out.errors);
  for (const error of out.errors) report.errors.push(error);
  if (!ref) {
    out.status = "invalid";
    return out;
  }
  out.path = ref.relative;
  if (checkForbiddenRuntimePath(report, `assets.${kind}.${id}.path`, out.path, out)) {
    return out;
  }
  validateExtension(kind, id, out.path, report, out);
  out.exists = fs.existsSync(ref.absolute);
  if (!out.exists) {
    const fallback = fallbackForKind(kind, report.fallbacks);
    if (fallback) {
      out.status = "fallback";
      pushEntryWarning(report, out, `assets.${kind}.${id} missing ${out.path}; fallback ${fallback} declared`);
    } else {
      out.status = "missing";
      pushEntryError(report, out, `assets.${kind}.${id} missing file: ${out.path}`);
    }
    return out;
  }

  out.placeholder = isPlaceholderFile(ref.absolute, base);
  if (out.placeholder) {
    report.placeholders.push(out.path);
    pushEntryWarning(report, out, `assets.${kind}.${id} uses placeholder file: ${out.path}`);
  }
  return out;
}

function validateMaterialEntry(kind, id, entry, report, out) {
  if (typeof entry.kind !== "string" || entry.kind === "") {
    pushEntryError(report, out, `assets.${kind}.${id}.kind is required`);
  }
  if (entry.shader !== undefined && (typeof entry.shader !== "string" || entry.shader === "")) {
    pushEntryError(report, out, `assets.${kind}.${id}.shader must be a non-empty string`);
  }
  if (entry.texture !== undefined && (typeof entry.texture !== "string" || entry.texture === "")) {
    pushEntryError(report, out, `assets.${kind}.${id}.texture must be a non-empty string`);
  }
  out.status = out.errors.length ? "invalid" : "declared";
}

function validateMaterialReferences(assets, report) {
  const shaders = new Set(Object.keys(assets.shaders || {}));
  const textures = new Set(Object.keys(assets.textures || {}));
  const usedShaders = new Set();
  for (const [id, material] of Object.entries(assets.materials || {})) {
    if (!material || typeof material !== "object") continue;
    if (typeof material.shader === "string") {
      usedShaders.add(material.shader);
      validateIdReference({
        report,
        from: `assets.materials.${id}.shader`,
        toKind: "shaders",
        toId: material.shader,
        knownIds: shaders,
        entry: report.assets.materials && report.assets.materials[id],
        entryError: `unknown shader ${material.shader}`
      });
    }
    if (typeof material.texture === "string") {
      validateIdReference({
        report,
        from: `assets.materials.${id}.texture`,
        toKind: "textures",
        toId: material.texture,
        knownIds: textures,
        entry: report.assets.materials && report.assets.materials[id],
        entryError: `unknown texture ${material.texture}`
      });
    }
  }
  for (const id of Array.from(shaders).sort()) {
    if (usedShaders.has(id)) continue;
    const item = {
      kind: "shaders",
      id,
      reason: "declared but not referenced by any material"
    };
    report.resourceConsistency.unusedManifestEntries.push(item);
    report.warnings.push(`assets.shaders.${id} is declared but not referenced by any material`);
  }
  validateSpriteAtlasReferences(assets, report);
}

function validateIdReference({ report, from, toKind, toId, knownIds, entry, entryError }) {
  const status = knownIds.has(toId) ? "ok" : "missing";
  report.resourceConsistency.idReferences.push({ from, toKind, toId, status });
  if (status === "ok") return;
  report.errors.push(`${from} references unknown ${singularKindForMessage(toKind)} ${toId}`);
  if (entry) {
    entry.errors.push(entryError);
    entry.status = "invalid";
  }
}

function singularKindForMessage(kind) {
  if (kind === "shaders") return "shader";
  if (kind === "textures") return "texture";
  if (kind === "spriteAtlases") return "sprite atlas";
  return kind.replace(/s$/, "");
}

function validateSpriteAtlasReferences(assets, report) {
  const atlases = new Set(Object.keys(assets.spriteAtlases || {}));
  const usedAtlases = new Set();
  for (const [id, sprite] of Object.entries(assets.sprites || {})) {
    if (!sprite || typeof sprite !== "object" || typeof sprite.atlas !== "string") continue;
    usedAtlases.add(sprite.atlas);
    const ref = {
      from: `assets.sprites.${id}.atlas`,
      toKind: "spriteAtlases",
      toId: sprite.atlas,
      status: atlases.has(sprite.atlas) ? "ok" : "missing"
    };
    report.resourceConsistency.idReferences.push(ref);
    if (!atlases.has(sprite.atlas)) {
      report.errors.push(`assets.sprites.${id}.atlas references unknown sprite atlas ${sprite.atlas}`);
      if (report.assets.sprites && report.assets.sprites[id]) {
        report.assets.sprites[id].errors.push(`unknown sprite atlas ${sprite.atlas}`);
        report.assets.sprites[id].status = "invalid";
      }
    }
  }
  for (const id of Array.from(atlases).sort()) {
    if (usedAtlases.has(id)) continue;
    const item = {
      kind: "spriteAtlases",
      id,
      reason: "declared but not referenced by any sprite"
    };
    report.resourceConsistency.unusedManifestEntries.push(item);
    report.warnings.push(`assets.spriteAtlases.${id} is declared but not referenced by any sprite`);
  }
}

function validateFallbacks(base, fallbacks, report) {
  if (!fallbacks || typeof fallbacks !== "object" || Array.isArray(fallbacks)) {
    report.errors.push("fallbacks must be an object when present");
    return;
  }
  for (const key of Object.keys(fallbacks).sort()) {
    if (!["missingTexture", "missingAudio"].includes(key)) {
      report.errors.push(`unknown fallback key: ${key}`);
      continue;
    }
    const ref = validatePackageLocalPath(base, fallbacks[key], `fallbacks.${key}`, report.errors);
    if (!ref) continue;
    if (checkForbiddenRuntimePath(report, `fallbacks.${key}`, ref.relative, null)) continue;
    report.fallbacks[key] = {
      path: ref.relative,
      exists: fs.existsSync(ref.absolute),
      placeholder: fs.existsSync(ref.absolute) ? isPlaceholderFile(ref.absolute, base) : false
    };
    const expected = key === "missingAudio" ? new Set([".wav", ".mp3", ".ogg"]) : EXTENSIONS.textures;
    const ext = path.extname(ref.relative).toLowerCase();
    if (!expected.has(ext)) report.errors.push(`fallbacks.${key} has unsupported extension ${ext || "(none)"}`);
    if (!report.fallbacks[key].exists) report.errors.push(`fallbacks.${key} does not exist: ${ref.relative}`);
    if (report.fallbacks[key].placeholder) {
      report.placeholders.push(ref.relative);
      report.warnings.push(`fallbacks.${key} uses placeholder file: ${ref.relative}`);
    }
  }
}

function validateExtension(kind, id, value, report, out) {
  const allowed = EXTENSIONS[kind];
  if (!allowed) return;
  const ext = path.extname(value).toLowerCase();
  if (!allowed.has(ext)) {
    pushEntryError(report, out, `assets.${kind}.${id} has unsupported extension ${ext || "(none)"}`);
  }
}

function fallbackForKind(kind, fallbacks) {
  if (["sprites", "textures", "backgrounds"].includes(kind) && fallbacks.missingTexture) return fallbacks.missingTexture.path;
  if (["audioSfx", "audioMusic"].includes(kind) && fallbacks.missingAudio) return fallbacks.missingAudio.path;
  return null;
}

function validatePackageLocalPath(base, value, field, errors) {
  if (typeof value !== "string" || value === "") {
    errors.push(`${field} is required`);
    return null;
  }
  if (value.includes("\0")) {
    errors.push(`${field} contains a null byte`);
    return null;
  }
  const normalized = value.replace(/\\/g, "/");
  if (path.isAbsolute(value) || path.posix.isAbsolute(normalized)) {
    errors.push(`${field} must be relative and package-local`);
    return null;
  }
  if (normalized.split("/").includes("..")) {
    errors.push(`${field} must not contain parent traversal`);
    return null;
  }
  const absolute = path.resolve(base, value);
  const relativeFromBase = path.relative(base, absolute);
  if (relativeFromBase === "" || relativeFromBase.startsWith("..") || path.isAbsolute(relativeFromBase)) {
    errors.push(`${field} must stay inside the package directory`);
    return null;
  }
  return {
    relative: normalized,
    absolute
  };
}

function findForbiddenRuntimePathFragment(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  for (const fragment of FORBIDDEN_RUNTIME_PATH_FRAGMENTS) {
    if (normalized === fragment) return fragment;
    if (normalized.startsWith(`${fragment}/`)) return fragment;
    if (normalized.endsWith(`/${fragment}`)) return fragment;
    if (normalized.includes(`/${fragment}/`)) return fragment;
  }
  return null;
}

function checkForbiddenRuntimePath(report, field, value, entry) {
  const fragment = findForbiddenRuntimePathFragment(value);
  if (!fragment) return false;
  report.resourceConsistency.forbiddenRuntimeReferences.push({
    field,
    path: value,
    fragment
  });
  const message = `${field} references non-runtime path segment: ${fragment}`;
  if (entry) {
    pushEntryError(report, entry, message);
  } else {
    report.errors.push(message);
  }
  return true;
}

function isPlaceholderFile(file, base) {
  const rel = path.relative(base, file).replace(/\\/g, "/");
  const bundleReport = path.join(base, "BUNDLE_PLACEHOLDER_FILES.jsonl");
  if (fs.existsSync(bundleReport)) {
    const lines = fs.readFileSync(bundleReport, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.path === rel) return true;
      } catch (_) {
        // Ignore malformed bundle reports; asset validation should remain local.
      }
    }
  }
  const sample = fs.readFileSync(file).subarray(0, 512).toString("utf8");
  return /AIR_ASSET_PLACEHOLDER|AIRLANG_ASSET_PLACEHOLDER|review-bundle placeholder|placeholder/i.test(sample);
}

function pushEntryError(report, entry, message) {
  entry.errors.push(message);
  entry.status = "invalid";
  report.errors.push(message);
}

function pushEntryWarning(report, entry, message) {
  entry.warnings.push(message);
  report.warnings.push(message);
}

function requiredString(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} is required`);
    return null;
  }
  return value;
}

function finalize(report) {
  report.placeholders = Array.from(new Set(report.placeholders)).sort();
  report.warnings = Array.from(new Set(report.warnings)).sort();
  report.errors = Array.from(new Set(report.errors)).sort();
  report.resourceConsistency.forbiddenRuntimeReferences = sortUniqueObjects(report.resourceConsistency.forbiddenRuntimeReferences);
  report.resourceConsistency.idReferences = sortUniqueObjects(report.resourceConsistency.idReferences);
  report.resourceConsistency.unusedManifestEntries = sortUniqueObjects(report.resourceConsistency.unusedManifestEntries);
  report.ok = report.errors.length === 0;
  return report;
}

function sortUniqueObjects(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return out;
}

module.exports = {
  ASSET_KINDS,
  ASSET_MANIFEST_VERSION,
  AssetManifestError,
  HOST_ASSET_KIND,
  validateAssetManifest
};
