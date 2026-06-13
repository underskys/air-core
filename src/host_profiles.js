const fs = require("fs");
const path = require("path");
const { KNOWN_CAPABILITIES } = require("./capabilities");
const { HOST_SIGNATURES } = require("./host_abi");

const HOST_PROFILES_DIR = path.resolve(__dirname, "..", "data", "host_profiles");
const HOST_PROFILE_TOP_FIELDS = new Set(["id", "name", "hostAbi", "supports", "limits", "diagnostics"]);
const SUPPORTS_FIELDS = new Set(["capabilities", "hostImports", "assetKinds", "manifestKinds"]);
const LIMIT_FIELDS = new Set(["maxAssets", "maxTextureSize", "maxAudioFiles"]);
const DIAGNOSTIC_FIELDS = new Set(["ciSafe", "manualOnly", "requiredReports", "unsupportedFeatureBehavior"]);
const UNSUPPORTED_FEATURE_BEHAVIORS = new Set(["fail-with-diagnostic", "warn-with-fallback", "skip-with-reason"]);
const ASSET_KINDS = new Set(["texture", "shader", "model", "material", "audioSfx", "audioMusic", "sprite", "spriteAtlas", "background", "rig", "binary"]);
const MANIFEST_KINDS = new Set(["gfx", "assets", "audio", "ui"]);
const SUPPORTED_HOST_ABI_VERSIONS = new Set(["0.10", "0.11"]);

class HostProfileError extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.name = "HostProfileError";
    this.errors = errors;
  }
}

function loadHostProfile(id, options = {}) {
  if (typeof id !== "string" || id.trim() === "") throw new HostProfileError(["host profile id is required"]);
  const dir = options.dir || HOST_PROFILES_DIR;
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) throw new HostProfileError([`unknown host profile: ${id}`]);
  const profile = readJson(file);
  return validateHostProfile(profile, { file, expectedId: id });
}

function listHostProfileIds(options = {}) {
  const dir = options.dir || HOST_PROFILES_DIR;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.basename(file, ".json"))
    .sort();
}

function validateHostProfile(profile, options = {}) {
  const errors = [];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new HostProfileError(["host profile must be a JSON object"]);
  }

  rejectUnknownFields(profile, HOST_PROFILE_TOP_FIELDS, "profile", errors);
  const id = requiredStableString(profile.id, "id", errors);
  const name = requiredString(profile.name, "name", errors);
  const hostAbi = requiredString(profile.hostAbi, "hostAbi", errors);
  if (hostAbi && !SUPPORTED_HOST_ABI_VERSIONS.has(hostAbi)) {
    errors.push(`unsupported hostAbi ${JSON.stringify(hostAbi)}; expected one of ${Array.from(SUPPORTED_HOST_ABI_VERSIONS).sort().join(", ")}`);
  }
  if (options.expectedId && id && id !== options.expectedId) {
    errors.push(`host profile id mismatch: expected ${options.expectedId}, found ${id}`);
  }

  const supports = profile.supports;
  if (!supports || typeof supports !== "object" || Array.isArray(supports)) {
    errors.push("supports must be an object");
  } else {
    rejectUnknownFields(supports, SUPPORTS_FIELDS, "supports", errors);
  }

  const limits = profile.limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    errors.push("limits must be an object");
  } else {
    rejectUnknownFields(limits, LIMIT_FIELDS, "limits", errors);
  }
  const diagnostics = profile.diagnostics || {};
  if (diagnostics && (typeof diagnostics !== "object" || Array.isArray(diagnostics))) {
    errors.push("diagnostics must be an object");
  } else {
    rejectUnknownFields(diagnostics, DIAGNOSTIC_FIELDS, "diagnostics", errors);
  }

  const capabilities = validateKnownStrings(arrayField(supports, "capabilities", errors), KNOWN_CAPABILITIES, "supports.capabilities", errors);
  const hostImports = validateKnownStrings(arrayField(supports, "hostImports", errors), new Set(HOST_SIGNATURES.keys()), "supports.hostImports", errors);
  const assetKinds = validateKnownStrings(arrayField(supports, "assetKinds", errors), ASSET_KINDS, "supports.assetKinds", errors);
  const manifestKinds = validateKnownStrings(arrayField(supports, "manifestKinds", errors), MANIFEST_KINDS, "supports.manifestKinds", errors);

  const normalizedLimits = {};
  if (limits && typeof limits === "object" && !Array.isArray(limits)) {
    for (const key of Array.from(LIMIT_FIELDS).sort()) {
      if (limits[key] === undefined) {
        errors.push(`limits.${key} is required`);
      } else if (!Number.isInteger(limits[key]) || limits[key] < 0) {
        errors.push(`limits.${key} must be a non-negative integer`);
      } else {
        normalizedLimits[key] = limits[key];
      }
    }
  }
  const normalizedDiagnostics = validateDiagnostics(diagnostics, errors);

  if (errors.length) throw new HostProfileError(errors);

  return {
    id,
    name,
    hostAbi,
    supports: {
      capabilities: capabilities.sort(),
      hostImports: hostImports.sort(),
      assetKinds: assetKinds.sort(),
      manifestKinds: manifestKinds.sort()
    },
    limits: normalizedLimits,
    diagnostics: normalizedDiagnostics
  };
}

function createHostProfileReport(requirements, profile) {
  const requiredCapabilities = sortedStrings(requirements.capabilities);
  const requiredImports = sortedStrings(requirements.hostImports);
  const requiredManifestKinds = sortedStrings(requirements.manifestKinds);
  const requiredAssetKinds = sortedStrings(requirements.assetKinds);
  const targetProfiles = sortedStrings(requirements.targetProfiles);
  const supportedCapabilities = new Set(profile.supports.capabilities);
  const supportedImports = new Set(profile.supports.hostImports);
  const supportedManifestKinds = new Set(profile.supports.manifestKinds);
  const supportedAssetKinds = new Set(profile.supports.assetKinds);
  const unsupportedCapabilities = requiredCapabilities.filter((item) => !supportedCapabilities.has(item));
  const unsupportedHostImports = requiredImports.filter((item) => !supportedImports.has(item));
  const unsupportedManifestKinds = requiredManifestKinds.filter((item) => !supportedManifestKinds.has(item));
  const unsupportedAssetKinds = requiredAssetKinds.filter((item) => !supportedAssetKinds.has(item));
  const targetProfileDeclared = targetProfiles.length === 0 || targetProfiles.includes(profile.id);
  const hostAbiStatus = requirements.hostAbi && requirements.hostAbi !== profile.hostAbi ? "fail" : "pass";
  const errors = [];

  if (!targetProfileDeclared) {
    errors.push(`package does not declare target profile ${profile.id}`);
  }
  if (hostAbiStatus === "fail") {
    errors.push(`hostAbi ${requirements.hostAbi} is not supported by profile ${profile.id} (${profile.hostAbi})`);
  }
  for (const capability of unsupportedCapabilities) errors.push(`profile ${profile.id} does not support capability ${capability}`);
  for (const hostImport of unsupportedHostImports) errors.push(`profile ${profile.id} does not support host import ${hostImport}`);
  for (const manifestKind of unsupportedManifestKinds) errors.push(`profile ${profile.id} does not support manifest kind ${manifestKind}`);
  for (const assetKind of unsupportedAssetKinds) errors.push(`profile ${profile.id} does not support asset kind ${assetKind}`);

  return {
    id: profile.id,
    name: profile.name,
    hostAbi: profile.hostAbi,
    status: errors.length ? "fail" : "pass",
    required: {
      hostAbi: requirements.hostAbi || null,
      capabilities: requiredCapabilities,
      hostImports: requiredImports,
      manifestKinds: requiredManifestKinds,
      assetKinds: requiredAssetKinds,
      targetProfiles
    },
    targetProfileDeclared,
    unsupportedCapabilities,
    unsupportedHostImports,
    unsupportedManifestKinds,
    unsupportedAssetKinds,
    limits: profile.limits,
    diagnostics: profile.diagnostics,
    errors
  };
}

function validateDiagnostics(diagnostics, errors) {
  const source = diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics) ? diagnostics : {};
  const ciSafe = source.ciSafe === undefined ? false : source.ciSafe;
  const manualOnly = source.manualOnly === undefined ? false : source.manualOnly;
  const requiredReports = source.requiredReports === undefined ? [] : source.requiredReports;
  const unsupportedFeatureBehavior = source.unsupportedFeatureBehavior || "fail-with-diagnostic";
  if (typeof ciSafe !== "boolean") errors.push("diagnostics.ciSafe must be boolean");
  if (typeof manualOnly !== "boolean") errors.push("diagnostics.manualOnly must be boolean");
  if (!Array.isArray(requiredReports)) {
    errors.push("diagnostics.requiredReports must be an array");
  } else {
    for (let i = 0; i < requiredReports.length; i++) {
      if (typeof requiredReports[i] !== "string" || requiredReports[i].trim() === "") {
        errors.push(`diagnostics.requiredReports[${i}] must be a non-empty string`);
      }
    }
  }
  if (!UNSUPPORTED_FEATURE_BEHAVIORS.has(unsupportedFeatureBehavior)) {
    errors.push(`diagnostics.unsupportedFeatureBehavior must be one of ${Array.from(UNSUPPORTED_FEATURE_BEHAVIORS).sort().join(", ")}`);
  }
  return {
    ciSafe: typeof ciSafe === "boolean" ? ciSafe : false,
    manualOnly: typeof manualOnly === "boolean" ? manualOnly : false,
    requiredReports: Array.isArray(requiredReports) ? Array.from(new Set(requiredReports)).sort() : [],
    unsupportedFeatureBehavior: UNSUPPORTED_FEATURE_BEHAVIORS.has(unsupportedFeatureBehavior) ? unsupportedFeatureBehavior : "fail-with-diagnostic"
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new HostProfileError([`invalid JSON in ${file}: ${err.message}`]);
  }
}

function rejectUnknownFields(obj, allowed, label, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function requiredStableString(value, field, errors) {
  const out = requiredString(value, field, errors);
  if (out && !/^[a-z][a-z0-9._-]{0,127}$/.test(out)) errors.push(`${field} must be a stable identifier`);
  return out;
}

function requiredString(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} is required`);
    return null;
  }
  return value;
}

function arrayField(obj, field, errors) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  if (!Array.isArray(obj[field])) {
    errors.push(`supports.${field} must be an array`);
    return [];
  }
  const out = [];
  for (let i = 0; i < obj[field].length; i++) {
    const value = obj[field][i];
    if (typeof value !== "string" || value === "") errors.push(`supports.${field}[${i}] must be a non-empty string`);
    else out.push(value);
  }
  return out;
}

function validateKnownStrings(values, known, field, errors) {
  const out = [];
  for (const value of values) {
    if (!known.has(value)) errors.push(`unknown ${field} value: ${value}`);
    else out.push(value);
  }
  return Array.from(new Set(out));
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

module.exports = {
  ASSET_KINDS,
  HOST_PROFILES_DIR,
  HostProfileError,
  MANIFEST_KINDS,
  createHostProfileReport,
  listHostProfileIds,
  loadHostProfile,
  validateHostProfile
};
