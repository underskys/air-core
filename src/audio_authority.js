const fs = require("fs");
const path = require("path");

const AUDIO_SOURCES = new Set(["host-owned", "module-driven", "direct-import"]);

function loadAudioManifest(file) {
  const resolved = path.resolve(file);
  const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"));
  manifest.__file = resolved;
  manifest.__dir = path.dirname(resolved);
  return manifest;
}

function createAudioAuthorityReport(mod, options = {}) {
  const manifest = options.manifest || null;
  const errors = [];
  const warnings = [];
  const capabilities = new Set(mod.capabilities || []);
  const directImports = (mod.externs || []).filter((ex) => ex.name.startsWith("audio.")).map((ex) => ex.name).sort();
  const authority = manifest ? normalizeAuthority(manifest.authority || manifest.audioAuthority || authorityFromHostAuthorities(manifest.hostAuthorities)) : null;
  const manifestUsesAudio = manifestHasAudio(manifest);
  const used = directImports.length > 0 || manifestUsesAudio;
  const source = directImports.length > 0 ? "direct-import" : normalizeSource(authority ? authority.source : null, manifestUsesAudio);
  const triggers = directImports.length > 0 ? directImports : normalizeTriggers(authority ? authority.triggers : null);
  const hasModuleAuthority = capabilities.has("audio");
  const hasManifestAuthority = Boolean(authority && authority.kind === "host-owned");
  let authoritySource = "missing";

  if (hasModuleAuthority) authoritySource = "module capability";
  else if (hasManifestAuthority) authoritySource = "package manifest";

  if (used && !AUDIO_SOURCES.has(source)) {
    errors.push(`audio.source must be one of ${Array.from(AUDIO_SOURCES).sort().join(", ")}`);
  }
  if (used && !hasModuleAuthority && !hasManifestAuthority) {
    errors.push("audio authority missing: declare capability 'audio' or manifest authority.kind 'host-owned'");
  }
  if (directImports.length > 0 && !hasModuleAuthority) {
    errors.push("direct AIR audio imports require capability 'audio'");
  }
  if (used && source === "module-driven") {
    errors.push("module-driven audio authority is not active; use direct AIR audio imports with capability 'audio' or host-owned ambience independent of AIR");
  }
  if (used && source === "module-driven" && triggers.length === 0) {
    errors.push("module-driven audio authority must list trigger sources");
  }
  if (used && source === "module-driven" && triggers.some((trigger) => trigger.startsWith("debug.metric"))) {
    errors.push("debug.metric must not authorize audio; use direct AIR audio imports with capability 'audio' or a future accepted explicit audio event ABI");
  }
  if (manifestUsesAudio && authority && authority.kind !== "host-owned") {
    errors.push("audio manifest authority.kind must be 'host-owned'");
  }
  if (used && source === "host-owned" && !hasManifestAuthority && !hasModuleAuthority) {
    errors.push("host-owned audio must be declared by manifest authority or module capability");
  }
  if (!used && hasModuleAuthority) {
    warnings.push("module declares audio capability but no audio manifest or audio imports were found");
  }

  const status = errors.length === 0 ? "pass" : "fail";
  return {
    used,
    source,
    triggers,
    authority: authoritySource,
    status,
    directImports,
    errors: errors.sort(),
    warnings: warnings.sort()
  };
}

function packageMetadataToModule(metadata) {
  return {
    name: metadata.module || "package",
    capabilities: new Set(metadata.capabilities || []),
    externs: metadata.imports || []
  };
}

function manifestHasAudio(manifest) {
  if (!manifest) return false;
  return Boolean(
    manifest.authority ||
      manifest.audioAuthority ||
      authorityFromHostAuthorities(manifest.hostAuthorities) ||
      hasEntries(manifest.sfx) ||
      hasEntries(manifest.music) ||
      hasEntries(manifest.assets) ||
      hasEntries(manifest.tracks)
  );
}

function authorityFromHostAuthorities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const audio = value.audio;
  if (!audio || typeof audio !== "object" || Array.isArray(audio)) return null;
  return {
    kind: typeof audio.kind === "string" ? audio.kind : (typeof audio.mode === "string" ? audio.mode : null),
    source: typeof audio.source === "string" ? audio.source : (audio.mode === "host-owned" ? "host-owned" : null),
    triggers: audio.triggers
  };
}

function normalizeAuthority(value) {
  if (!value || typeof value !== "object") return null;
  return {
    kind: typeof value.kind === "string" ? value.kind : null,
    source: typeof value.source === "string" ? value.source : null,
    triggers: value.triggers
  };
}

function normalizeSource(value, manifestUsesAudio) {
  if (typeof value === "string" && AUDIO_SOURCES.has(value)) return value;
  return manifestUsesAudio ? "module-driven" : "host-owned";
}

function normalizeTriggers(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()).sort();
}

function hasEntries(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

module.exports = {
  createAudioAuthorityReport,
  loadAudioManifest,
  packageMetadataToModule
};
