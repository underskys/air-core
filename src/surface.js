const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { HOST_SIGNATURES } = require("./host_abi");
const { listHostProfileIds, loadHostProfile } = require("./host_profiles");

const ROOT = path.resolve(__dirname, "..");

const ACTIVE_CORE_FEATURES = Object.freeze([
  "packageLocalImports",
  "moduleGraph",
  "crossModuleVerification",
  "capabilityPropagation",
  "effectOriginReporting",
  "moduleConstants",
  "staticScalarTables",
  "generatedHandles",
  "generatedDataModules",
  "packageCheckSourceOnly",
  "aiReviewDiagnostics"
]);

const REJECTED_OR_DEFERRED_FEATURES = Object.freeze([
  { name: "audio.event", status: "RFC/deferred", layer: "Host ABI", repairHint: "use audio.beep direct import with capability audio until audio.event is promoted" },
  { name: "effect.event", status: "RFC/deferred", layer: "Host ABI", repairHint: "keep effects as verifier-visible budgets; do not use hidden event buses" },
  { name: "gfx.draw_sprite_transform", status: "RFC/deferred", layer: "GFX ABI / kit", repairHint: "use sprite kit or manifest-rig work until public ABI is accepted" },
  { name: "draw_actor", status: "rejected", layer: "AIR Core / Host ABI", repairHint: "keep actor/gameplay vocabulary project-local" },
  { name: "std.gfx3d", status: "rejected", layer: "stdlib", repairHint: "use a vendored/project-local kit path, not stdlib" },
  { name: "std.scene", status: "rejected", layer: "stdlib", repairHint: "use kits/gfx-basic or a project-local kit path, not stdlib" },
  { name: "std.voxel", status: "rejected", layer: "stdlib", repairHint: "use kits/voxel-basic or project-local vendoring, not stdlib" },
  { name: "remote imports", status: "rejected", layer: "package/module resolver", repairHint: "use package-local relative imports only" },
  { name: "dynamic imports", status: "rejected", layer: "AIR Core", repairHint: "use static package-local imports only" },
  { name: "runtime module loading", status: "rejected", layer: "AIR Core / host", repairHint: "verify package-local module graphs before runtime" },
  { name: "host object handles", status: "rejected", layer: "AIR Core / Host ABI", repairHint: "AIR may use scalar handles only; hosts own platform objects" },
  { name: "registry imports", status: "rejected", layer: "package/tooling", repairHint: "no package registry imports" }
]);

const REPAIR_HINTS = Object.freeze({
  "std.gfx3d": "use vendored/project-local kit path from kits/gfx-basic/air/gfx3d.air, not stdlib",
  "std.scene": "use vendored/project-local kit path from kits/gfx-basic/air/scene.air, not stdlib",
  "std.voxel": "use kits/voxel-basic/project-local vendoring path, not stdlib",
  "audio.event": "rejected/deferred; use audio.beep direct import with capability audio",
  "effect.event": "RFC/deferred; keep effects in verifier-visible budgets for now",
  "gfx.draw_sprite_transform": "RFC/deferred; use sprite kit or manifest-rig direction until public ABI is accepted",
  draw_actor: "rejected demo/game vocabulary; keep actor semantics project-local"
});

function createSurfaceReport(options = {}) {
  const profileId = options.profile || "browser-webgpu";
  const profile = loadHostProfile(profileId);
  const selectedImports = new Set(profile.supports.hostImports);
  return {
    reportVersion: "0.15",
    kind: "surface",
    profile: profile.id,
    activeCoreFeatures: ACTIVE_CORE_FEATURES.slice(),
    rejectedOrDeferredFeatures: REJECTED_OR_DEFERRED_FEATURES.map((item) => ({ ...item })),
    stdlib: loadStdlibSurface(),
    kits: loadKitSurface(),
    hostProfiles: {
      selected: {
        id: profile.id,
        name: profile.name,
        hostAbi: profile.hostAbi,
        supportedCapabilities: profile.supports.capabilities.slice(),
        supportedHostImports: profile.supports.hostImports.slice(),
        supportedManifestKinds: profile.supports.manifestKinds.slice(),
        supportedAssetKinds: profile.supports.assetKinds.slice(),
        limits: profile.limits,
        diagnostics: profile.diagnostics
      },
      unsupportedHostImports: Array.from(HOST_SIGNATURES.keys())
        .filter((name) => !selectedImports.has(name))
        .sort()
        .map((name) => ({
          name,
          alternatives: profilesSupportingHostImport(name)
        }))
    },
    repairHints: Object.fromEntries(Object.entries(REPAIR_HINTS).sort(([a], [b]) => a.localeCompare(b)))
  };
}

function loadStdlibSurface() {
  const dir = path.join(ROOT, "stdlib");
  const modules = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".air"))
    .sort()
    .map((file) => {
      const full = path.join(dir, file);
      const mod = parseAir(fs.readFileSync(full, "utf8"), full, { resolveSourceImports: false });
      return {
        name: mod.name,
        path: path.relative(ROOT, full).replace(/\\/g, "/"),
        capabilities: Array.from(mod.capabilities || []).sort(),
        hostAuthorityFree: (mod.externs || []).length === 0 && Array.from(mod.capabilities || []).length === 0,
        exportedHelpers: (mod.functions || []).map((fn) => `${mod.name}.${fn.name}`).sort()
      };
    });
  return {
    rule: "stdlib modules must stay pure, deterministic, backend-neutral, resource-free, and host-authority-free",
    modules
  };
}

function loadKitSurface() {
  const dir = path.join(ROOT, "kits");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const kitRoot = path.join(dir, entry.name);
      const airModules = findFiles(path.join(kitRoot, "air"), ".air")
        .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"))
        .sort();
      return {
        name: `kits/${entry.name}`,
        path: path.relative(ROOT, kitRoot).replace(/\\/g, "/"),
        status: entry.name === "voxel-basic" ? "experimental kit" : "kit",
        importRule: "kits are not importable as std.*; vendor or reference them as package/project-local modules",
        airModules
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function profilesSupportingHostImport(hostImport) {
  const out = [];
  for (const id of listHostProfileIds()) {
    try {
      const profile = loadHostProfile(id);
      if (profile.supports.hostImports.includes(hostImport)) out.push(id);
    } catch (_) {
      // Profile validation tests report malformed profiles.
    }
  }
  return out.sort();
}

function findFiles(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(full, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

module.exports = {
  createSurfaceReport
};
