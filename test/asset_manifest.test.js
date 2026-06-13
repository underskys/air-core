#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { validateAssetManifest } = require("../src/asset_manifest");
const { loadHostProfile } = require("../src/host_profiles");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmpRoot = path.join(root, "build", "asset-manifest-tests");
const assetFixture = path.join(root, "test", "fixtures", "assets_minimal");
const packageFixture = path.join(root, "test", "fixtures", "package_minimal");
const browserProfile = loadHostProfile("browser-webgpu");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runFails(args) {
  try {
    run(args);
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      message: err.message
    };
  }
  throw new Error(`expected command to fail: ${args.join(" ")}`);
}

function writeFile(file, content = "AIR_ASSET_PLACEHOLDER test asset\n") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeManifest(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

const example = validateAssetManifest(assetFixture, "manifest.json", { profile: browserProfile });
assert.strictEqual(example.ok, true);
assert.deepStrictEqual(example.placeholders, []);
assert.strictEqual(example.authority.audioGranted, false);
assert.match(example.authority.note, /does not grant/);
assert.deepStrictEqual(example.resourceConsistency.forbiddenRuntimeReferences, []);
assert(example.resourceConsistency.idReferences.some((ref) =>
  ref.from === "assets.materials.basic_unlit.shader" &&
  ref.toKind === "shaders" &&
  ref.toId === "unlit_mesh" &&
  ref.status === "ok"
));
assert(example.resourceConsistency.idReferences.some((ref) =>
  ref.from === "assets.sprites.player_idle.atlas" &&
  ref.toKind === "spriteAtlases" &&
  ref.toId === "main_atlas" &&
  ref.status === "ok"
));

const traversal = path.join(tmpRoot, "traversal");
writeManifest(traversal, {
  version: "0.12",
  assets: {
    sprites: {
      bad: { path: "../bad.png" }
    }
  },
  fallbacks: {}
});
const traversalReport = validateAssetManifest(traversal, "manifest.json", { profile: browserProfile });
assert.strictEqual(traversalReport.ok, false);
assert.match(traversalReport.errors.join("\n"), /parent traversal/);

const missing = path.join(tmpRoot, "missing");
writeManifest(missing, {
  version: "0.12",
  assets: {
    models: {
      crate: { path: "models/missing.glb" }
    }
  },
  fallbacks: {}
});
const missingReport = validateAssetManifest(missing, "manifest.json", { profile: browserProfile });
assert.strictEqual(missingReport.ok, false);
assert.match(missingReport.errors.join("\n"), /missing file: models\/missing\.glb/);

const fallback = path.join(tmpRoot, "fallback");
writeFile(path.join(fallback, "textures", "fallback.png"));
writeManifest(fallback, {
  version: "0.12",
  assets: {
    sprites: {
      ghost: { path: "sprites/ghost.png" }
    }
  },
  fallbacks: {
    missingTexture: "textures/fallback.png"
  }
});
const fallbackReport = validateAssetManifest(fallback, "manifest.json", { profile: browserProfile });
assert.strictEqual(fallbackReport.ok, true);
assert.match(fallbackReport.warnings.join("\n"), /fallback textures\/fallback\.png declared/);

const forbiddenRuntime = path.join(tmpRoot, "forbidden-runtime");
writeFile(path.join(forbiddenRuntime, "tmp_unused", "tiny.png"));
writeManifest(forbiddenRuntime, {
  version: "0.12",
  assets: {
    textures: {
      stray: { path: "tmp_unused/tiny.png" }
    }
  },
  fallbacks: {}
});
const forbiddenRuntimeReport = validateAssetManifest(forbiddenRuntime, "manifest.json", { profile: browserProfile });
assert.strictEqual(forbiddenRuntimeReport.ok, false);
assert.match(forbiddenRuntimeReport.errors.join("\n"), /assets\.textures\.stray\.path references non-runtime path segment: tmp_unused/);
assert.deepStrictEqual(forbiddenRuntimeReport.resourceConsistency.forbiddenRuntimeReferences, [{
  field: "assets.textures.stray.path",
  path: "tmp_unused/tiny.png",
  fragment: "tmp_unused"
}]);

const forbiddenFallback = path.join(tmpRoot, "forbidden-fallback");
writeFile(path.join(forbiddenFallback, "quarantine", "fallback.png"));
writeManifest(forbiddenFallback, {
  version: "0.12",
  assets: {
    textures: {
      visible: { path: "textures/visible.png" }
    }
  },
  fallbacks: {
    missingTexture: "quarantine/fallback.png"
  }
});
const forbiddenFallbackReport = validateAssetManifest(forbiddenFallback, "manifest.json", { profile: browserProfile });
assert.strictEqual(forbiddenFallbackReport.ok, false);
assert.match(forbiddenFallbackReport.errors.join("\n"), /fallbacks\.missingTexture references non-runtime path segment: quarantine/);

const missingAtlas = path.join(tmpRoot, "missing-atlas");
writeFile(path.join(missingAtlas, "sprites", "actor.png"));
writeManifest(missingAtlas, {
  version: "0.12",
  assets: {
    sprites: {
      actor: { path: "sprites/actor.png", atlas: "missing_atlas" }
    }
  },
  fallbacks: {}
});
const missingAtlasReport = validateAssetManifest(missingAtlas, "manifest.json", { profile: browserProfile });
assert.strictEqual(missingAtlasReport.ok, false);
assert.match(missingAtlasReport.errors.join("\n"), /assets\.sprites\.actor\.atlas references unknown sprite atlas missing_atlas/);
assert.deepStrictEqual(missingAtlasReport.resourceConsistency.idReferences, [{
  from: "assets.sprites.actor.atlas",
  toKind: "spriteAtlases",
  toId: "missing_atlas",
  status: "missing"
}]);

const materialTexture = path.join(tmpRoot, "material-texture");
writeFile(path.join(materialTexture, "textures", "checker.png"));
writeFile(path.join(materialTexture, "shaders", "unlit.wgsl"));
writeManifest(materialTexture, {
  version: "0.12",
  assets: {
    textures: {
      checker: { path: "textures/checker.png" }
    },
    shaders: {
      unlit: { path: "shaders/unlit.wgsl" }
    },
    materials: {
      basic: { kind: "unlit", shader: "unlit", texture: "checker" }
    }
  },
  fallbacks: {}
});
const materialTextureReport = validateAssetManifest(materialTexture, "manifest.json", { profile: browserProfile });
assert.strictEqual(materialTextureReport.ok, true);
assert(materialTextureReport.resourceConsistency.idReferences.some((ref) =>
  ref.from === "assets.materials.basic.texture" &&
  ref.toKind === "textures" &&
  ref.toId === "checker" &&
  ref.status === "ok"
));

const missingTextureRef = path.join(tmpRoot, "missing-texture-ref");
writeFile(path.join(missingTextureRef, "shaders", "unlit.wgsl"));
writeManifest(missingTextureRef, {
  version: "0.12",
  assets: {
    shaders: {
      unlit: { path: "shaders/unlit.wgsl" }
    },
    materials: {
      basic: { kind: "unlit", shader: "unlit", texture: "missing_texture" }
    }
  },
  fallbacks: {}
});
const missingTextureRefReport = validateAssetManifest(missingTextureRef, "manifest.json", { profile: browserProfile });
assert.strictEqual(missingTextureRefReport.ok, false);
assert.match(missingTextureRefReport.errors.join("\n"), /assets\.materials\.basic\.texture references unknown texture missing_texture/);
assert(missingTextureRefReport.resourceConsistency.idReferences.some((ref) =>
  ref.from === "assets.materials.basic.texture" &&
  ref.toKind === "textures" &&
  ref.toId === "missing_texture" &&
  ref.status === "missing"
));

const unusedShader = path.join(tmpRoot, "unused-shader");
writeFile(path.join(unusedShader, "shaders", "orphan.wgsl"));
writeManifest(unusedShader, {
  version: "0.12",
  assets: {
    shaders: {
      orphan: { path: "shaders/orphan.wgsl" }
    }
  },
  fallbacks: {}
});
const unusedShaderReport = validateAssetManifest(unusedShader, "manifest.json", { profile: browserProfile });
assert.strictEqual(unusedShaderReport.ok, true);
assert.match(unusedShaderReport.warnings.join("\n"), /assets\.shaders\.orphan is declared but not referenced by any material/);
assert.deepStrictEqual(unusedShaderReport.resourceConsistency.unusedManifestEntries, [{
  kind: "shaders",
  id: "orphan",
  reason: "declared but not referenced by any material"
}]);

const unusedAtlas = path.join(tmpRoot, "unused-atlas");
writeFile(path.join(unusedAtlas, "sprites", "unused.json"), "{}");
writeManifest(unusedAtlas, {
  version: "0.12",
  assets: {
    spriteAtlases: {
      unused: { path: "sprites/unused.json" }
    }
  },
  fallbacks: {}
});
const unusedAtlasReport = validateAssetManifest(unusedAtlas, "manifest.json", { profile: browserProfile });
assert.strictEqual(unusedAtlasReport.ok, true);
assert.match(unusedAtlasReport.warnings.join("\n"), /assets\.spriteAtlases\.unused is declared but not referenced by any sprite/);
assert.deepStrictEqual(unusedAtlasReport.resourceConsistency.unusedManifestEntries, [{
  kind: "spriteAtlases",
  id: "unused",
  reason: "declared but not referenced by any sprite"
}]);

const unsupportedProfile = validateAssetManifest(assetFixture, "manifest.json", { profile: loadHostProfile("cli") });
assert.strictEqual(unsupportedProfile.ok, false);
assert.match(unsupportedProfile.errors.join("\n"), /profile cli does not support asset kind/);

const packageDir = path.join(tmpRoot, "package");
fs.cpSync(packageFixture, packageDir, { recursive: true });
fs.writeFileSync(path.join(packageDir, "module.wasm"), "placeholder wasm for asset package-check\n");
const packageReport = JSON.parse(run(["package-check", packageDir, "--profile", "browser-webgpu", "--json"]));
assert.strictEqual(packageReport.status, "pass");
assert.strictEqual(packageReport.assets.ok, true);
assert.strictEqual(packageReport.assets.authority.audioGranted, false);
assert.deepStrictEqual(packageReport.assets.placeholders, []);
assert(packageReport.assets.resourceConsistency.idReferences.some((ref) =>
  ref.from === "assets.materials.package_basic.shader" &&
  ref.toKind === "shaders" &&
  ref.toId === "package_unlit" &&
  ref.status === "ok"
));

const packageManifestExampleReport = JSON.parse(run(["package-check", path.join(root, "examples", "package_manifest"), "--profile", "browser-webgpu", "--source-only", "--json"]));
assert.strictEqual(packageManifestExampleReport.status, "warn");
assert(packageManifestExampleReport.checks.some((check) =>
  check.id === "asset-placeholder" &&
  check.code === "air.manifest.placeholder_resource" &&
  /uses placeholder file/.test(check.message)
));
assert(packageManifestExampleReport.diagnostics.some((item) =>
  item.code === "air.manifest.placeholder_resource" &&
  /uses placeholder file/.test(item.message)
));
assert(!packageManifestExampleReport.diagnostics.some((item) =>
  item.code === "air.manifest.missing_runtime_resource" &&
  /uses placeholder file/.test(item.message)
));

const packageMissing = path.join(tmpRoot, "package-missing");
fs.cpSync(packageFixture, packageMissing, { recursive: true });
fs.writeFileSync(path.join(packageMissing, "module.wasm"), "placeholder wasm for missing asset package-check\n");
fs.rmSync(path.join(packageMissing, "assets", "shaders", "package_unlit.wgsl"));
const packageMissingReport = JSON.parse(runFails(["package-check", packageMissing, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(packageMissingReport.status, "fail");
assert.match(packageMissingReport.errors.join("\n"), /assets\.shaders\.package_unlit missing file/);
assert(packageMissingReport.diagnostics.some((item) =>
  item.code === "air.manifest.missing_runtime_resource" &&
  /missing file/.test(item.message)
));

const packageForbidden = path.join(tmpRoot, "package-forbidden-runtime");
fs.cpSync(packageFixture, packageForbidden, { recursive: true });
fs.writeFileSync(path.join(packageForbidden, "module.wasm"), "placeholder wasm for forbidden asset package-check\n");
const packageForbiddenManifestPath = path.join(packageForbidden, "assets", "manifest.json");
const packageForbiddenManifest = JSON.parse(fs.readFileSync(packageForbiddenManifestPath, "utf8"));
packageForbiddenManifest.assets.textures.package_checker.path = "assets_candidate/package_checker.png";
fs.writeFileSync(packageForbiddenManifestPath, JSON.stringify(packageForbiddenManifest, null, 2));
const packageForbiddenReport = JSON.parse(runFails(["package-check", packageForbidden, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(packageForbiddenReport.status, "fail");
assert.match(packageForbiddenReport.errors.join("\n"), /assets\.textures\.package_checker\.path references non-runtime path segment: assets_candidate/);
assert(packageForbiddenReport.diagnostics.some((item) =>
  item.code === "air.manifest.forbidden_runtime_path" &&
  /non-runtime path segment/.test(item.message)
));
assert.deepStrictEqual(packageForbiddenReport.assets.resourceConsistency.forbiddenRuntimeReferences, [{
  field: "assets.textures.package_checker.path",
  path: "assets_candidate/package_checker.png",
  fragment: "assets_candidate"
}]);

console.log("ok: asset manifest tests");
