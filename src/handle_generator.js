const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseAir } = require("./parser");
const { verifyModule } = require("./verifier");
const { validatePackageManifest } = require("./package_manifest");
const { validateAssetManifest } = require("./asset_manifest");

const GENERATED_HANDLE_FILES = [
  "generated/material_handles.air",
  "generated/sprite_handles.air",
  "generated/audio_handles.air",
  "generated/asset_handles.air",
  "generated/assets.air"
];

function generateHandleModules(packageDir) {
  const base = path.resolve(packageDir);
  const pkg = validatePackageManifest(base, { built: false });
  const assetManifestRef = pkg.manifests.assets;
  let assets = {};
  if (assetManifestRef && assetManifestRef.exists) {
    const assetReport = validateAssetManifest(base, assetManifestRef.path);
    if (assetReport.errors.length) {
      throw new Error(`asset manifest invalid; cannot generate handles:\n${assetReport.errors.join("\n")}`);
    }
    assets = readJson(path.join(base, assetManifestRef.path)).assets || {};
  }
  const fingerprint = manifestFingerprint(assets);
  const sources = ["air.package.json"];
  if (assetManifestRef && assetManifestRef.path) sources.push(assetManifestRef.path);
  return {
    "generated/material_handles.air": renderModule("material_handles", handlesForMaterials(assets), { fingerprint, sources }),
    "generated/sprite_handles.air": renderModule("sprite_handles", handlesForSprites(assets), { fingerprint, sources }),
    "generated/audio_handles.air": renderModule("audio_handles", handlesForAudio(assets), { fingerprint, sources }),
    "generated/asset_handles.air": renderModule("asset_handles", handlesForAssets(assets), { fingerprint, sources }),
    "generated/assets.air": renderAssetDataModule(handlesForAssets(assets), { fingerprint, sources })
  };
}

function writeGeneratedHandleModules(packageDir) {
  const base = path.resolve(packageDir);
  const modules = generateHandleModules(base);
  const written = [];
  for (const rel of Object.keys(modules).sort()) {
    const file = path.join(base, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, modules[rel]);
    written.push(rel);
  }
  return written;
}

function checkGeneratedHandleModules(packageDir) {
  const base = path.resolve(packageDir);
  const expected = generateHandleModules(base);
  const files = [];
  const errors = [];
  for (const rel of GENERATED_HANDLE_FILES) {
    const file = path.join(base, rel);
    if (!fs.existsSync(file)) {
      files.push({
        path: rel,
        status: "missing",
        fingerprint: null,
        expectedFingerprint: sourceFingerprint(expected[rel]),
        manifestFingerprint: null,
        expectedManifestFingerprint: manifestFingerprintForSource(expected[rel]),
        sources: [],
        generators: []
      });
      errors.push(`generated handle file missing: ${rel}`);
      continue;
    }
    const actual = fs.readFileSync(file, "utf8");
    const status = actual === expected[rel] ? "current" : "stale";
    const generatorReport = generatorRefsForSource(actual).map((ref) => checkGeneratorRef(base, ref));
    const sourceReport = sourceRefsForSource(actual).map((ref) => checkSourceRef(base, ref));
    files.push({
      path: rel,
      status,
      fingerprint: sourceFingerprint(actual),
      expectedFingerprint: sourceFingerprint(expected[rel]),
      manifestFingerprint: manifestFingerprintForSource(actual),
      expectedManifestFingerprint: manifestFingerprintForSource(expected[rel]),
      sources: sourceReport,
      generators: generatorReport
    });
    if (status === "stale") errors.push(`generated handle file stale: ${rel}`);
    if (sourceReport.length === 0) errors.push(`generated handle file ${rel} has no source manifest trace`);
    for (const source of sourceReport) {
      if (!source.exists) errors.push(`generated handle file ${rel} references missing source: ${source.ref}`);
    }
    for (const generator of generatorReport) {
      if (!generator.exists) errors.push(`generated handle file ${rel} references missing generator: ${generator.ref}`);
    }
  }
  return {
    ok: errors.length === 0,
    files,
    errors
  };
}

function checkGeneratedArtifacts(packageDir, generatedModules = []) {
  const base = path.resolve(packageDir);
  const files = [];
  const errors = [];
  const warnings = [];
  const unique = Array.from(new Set((generatedModules || []).filter(Boolean))).sort();
  for (const rel of unique) {
    const file = path.join(base, rel);
    if (!fs.existsSync(file)) {
      files.push({ path: rel, status: "missing", fingerprint: null, manifestFingerprint: null, sources: [], generators: [] });
      errors.push(`generated module missing: ${rel}`);
      continue;
    }
    const actual = fs.readFileSync(file, "utf8");
    const generatorReport = generatorRefsForSource(actual).map((ref) => checkGeneratorRef(base, ref));
    const sourceReport = sourceRefsForSource(actual).map((ref) => checkSourceRef(base, ref));
    files.push({
      path: rel,
      status: "present",
      fingerprint: sourceFingerprint(actual),
      manifestFingerprint: manifestFingerprintForSource(actual),
      sources: sourceReport,
      generators: generatorReport
    });
    if (sourceReport.length === 0) warnings.push(`generated module ${rel} has no source manifest trace`);
    for (const source of sourceReport) {
      if (!source.exists) errors.push(`generated module ${rel} references missing source: ${source.ref}`);
    }
    for (const generator of generatorReport) {
      if (!generator.exists) errors.push(`generated module ${rel} references missing generator: ${generator.ref}`);
    }
  }
  return {
    ok: errors.length === 0,
    files,
    warnings,
    errors
  };
}

function verifyGeneratedHandleModules(packageDir) {
  const base = path.resolve(packageDir);
  const modules = generateHandleModules(base);
  for (const [rel, source] of Object.entries(modules)) {
    const mod = parseAir(source, path.join(base, rel));
    verifyModule(mod, { library: true });
  }
  return true;
}

function handlesForMaterials(assets) {
  return Object.keys(assets.materials || {})
    .sort()
    .map((id) => ({ name: `mat_${safeIdent(id)}` }));
}

function handlesForSprites(assets) {
  return [
    ...Object.keys(assets.sprites || {}).sort().map((id) => ({ name: `sprite_${safeIdent(id)}` })),
    ...Object.keys(assets.spriteAtlases || {}).sort().map((id) => ({ name: `atlas_${safeIdent(id)}` }))
  ];
}

function handlesForAudio(assets) {
  return [
    ...Object.keys(assets.audioSfx || {}).sort().map((id) => ({ name: `sfx_${safeIdent(id)}` })),
    ...Object.keys(assets.audioMusic || {}).sort().map((id) => ({ name: `music_${safeIdent(id)}` }))
  ];
}

function handlesForAssets(assets) {
  const out = [];
  for (const kind of Object.keys(assets || {}).sort()) {
    for (const id of Object.keys(assets[kind] || {}).sort()) {
      out.push({ name: `${singularKind(kind)}_${safeIdent(id)}` });
    }
  }
  return out;
}

function renderModule(moduleName, handles, metadata) {
  const out = generatedHeader(metadata).concat([
    `module ${moduleName}`,
    "capabilities { }",
    ""
  ]);
  const seen = new Set();
  handles.forEach((handle, index) => {
    if (seen.has(handle.name)) throw new Error(`generated handle name collision: ${handle.name}`);
    seen.add(handle.name);
    out.push(`export func ${handle.name}() -> i32 {`);
    out.push("entry:");
    out.push(`  %id:i32 = const.i32 ${index + 1}`);
    out.push("  return %id");
    out.push("}");
    out.push("");
  });
  return out.join("\n");
}

function renderAssetDataModule(handles, metadata) {
  const out = generatedHeader(metadata).concat([
    "module assets",
    `const ASSET_COUNT:i32 = ${handles.length}`,
    "capabilities { }",
    ""
  ]);
  out.push("export func asset_count() -> i32 {");
  out.push("entry:");
  out.push("  return ASSET_COUNT");
  out.push("}");
  out.push("");
  if (handles.length) {
    out.push(`table asset_ids:i32[${handles.length}] = [${handles.map((_handle, idx) => String(idx + 1)).join(", ")}]`);
    out.push("");
    out.push("export func asset_id(index: i32) -> i32 {");
    out.push("entry:");
    out.push("  %id:i32 = table.get asset_ids, %index");
    out.push("  return %id");
    out.push("}");
    out.push("");
  }
  return out.join("\n");
}

function generatedHeader(metadata = {}) {
  const sources = Array.from(new Set(metadata.sources || ["air.package.json"])).sort();
  return [
    "# Generated file. Do not edit manually.",
    "# Generator: repo:bin/airc.js",
    ...sources.map((source) => `# Source: ${source}`),
    `# Manifest fingerprint: ${metadata.fingerprint || "none"}`
  ];
}

function manifestFingerprint(assets) {
  return crypto.createHash("sha256").update(JSON.stringify(sortJson(assets))).digest("hex").slice(0, 16);
}

function sourceFingerprint(source) {
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function generatorRefsForSource(source) {
  const refs = [];
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^#\s*Generator:\s*(.+?)\s*$/);
    if (match) refs.push(match[1]);
  }
  return refs.sort();
}

function sourceRefsForSource(source) {
  const refs = [];
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^#\s*Source:\s*(.+?)\s*$/);
    if (match) refs.push(match[1]);
  }
  return refs.sort();
}

function manifestFingerprintForSource(source) {
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^#\s*Manifest fingerprint:\s*([A-Za-z0-9_.:-]+)\s*$/);
    if (match) return match[1];
  }
  return null;
}

function checkSourceRef(packageDir, ref) {
  const normalized = String(ref || "").trim();
  const target = path.resolve(packageDir, normalized);
  return {
    ref: normalized,
    path: normalized,
    exists: fs.existsSync(target)
  };
}

function checkGeneratorRef(packageDir, ref) {
  const repoRoot = path.resolve(__dirname, "..");
  const normalized = String(ref || "").trim();
  const target = normalized.startsWith("repo:")
    ? path.resolve(repoRoot, normalized.slice("repo:".length))
    : path.resolve(packageDir, normalized);
  return {
    ref: normalized,
    path: normalized.startsWith("repo:") ? normalized.slice("repo:".length) : normalized,
    exists: fs.existsSync(target)
  };
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortJson(value[key]);
    return out;
  }
  return value;
}

function singularKind(kind) {
  const map = {
    audioMusic: "audio_music",
    audioSfx: "audio_sfx",
    backgrounds: "background",
    binaries: "binary",
    materials: "material",
    models: "model",
    rigs: "rig",
    shaders: "shader",
    spriteAtlases: "sprite_atlas",
    sprites: "sprite",
    textures: "texture"
  };
  return map[kind] || safeIdent(kind);
}

function safeIdent(value) {
  const out = String(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!out) return "unnamed";
  return /^[a-z_]/.test(out) ? out : `h_${out}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = {
  GENERATED_HANDLE_FILES,
  checkGeneratedArtifacts,
  checkGeneratedHandleModules,
  generateHandleModules,
  verifyGeneratedHandleModules,
  writeGeneratedHandleModules
};
