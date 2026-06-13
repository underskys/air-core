const fs = require("fs");
const path = require("path");
const { KNOWN_CAPABILITIES } = require("./capabilities");
const { AIR_ABI_VERSION } = require("./version");
const { listHostProfileIds } = require("./host_profiles");

const PACKAGE_MANIFEST_FILE = "air.package.json";
const HOST_ABI_VERSION = "0.10";
const SUPPORTED_HOST_ABI_VERSIONS = new Set([
  HOST_ABI_VERSION,
  "0.11"
]);

class PackageManifestError extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.name = "PackageManifestError";
    this.errors = errors;
  }
}

function validatePackageManifest(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const manifestPath = path.join(base, PACKAGE_MANIFEST_FILE);
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(manifestPath)) {
    throw new PackageManifestError([`missing ${PACKAGE_MANIFEST_FILE} in ${base}`]);
  }

  const manifest = readJson(manifestPath, errors);
  const knownProfiles = options.knownProfiles || loadKnownHostProfiles(options.rootDir);
  const result = {
    ok: false,
    file: manifestPath,
    name: null,
    version: null,
    airAbi: null,
    hostAbi: null,
    entry: null,
    wasm: null,
    capabilities: [],
    targetProfiles: [],
    generatedModules: [],
    factSchemas: [],
    structuredIO: [],
    outputContracts: [],
    commandBuffers: [],
    packageExports: [],
    aiReview: null,
    reviewPolicy: null,
    manifests: {},
    warnings,
    errors
  };

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push(`${PACKAGE_MANIFEST_FILE} must contain a JSON object`);
    throwIfInvalid(result);
    return result;
  }

  result.name = validateStableName(manifest.name, "name", errors);
  result.version = validateRequiredString(manifest.version, "version", errors);
  result.airAbi = validateRequiredString(manifest.airAbi, "airAbi", errors);
  result.hostAbi = validateRequiredString(manifest.hostAbi, "hostAbi", errors);

  if (result.airAbi && result.airAbi !== AIR_ABI_VERSION) {
    errors.push(`unsupported airAbi ${JSON.stringify(result.airAbi)}; expected ${AIR_ABI_VERSION}`);
  }
  if (result.hostAbi && !SUPPORTED_HOST_ABI_VERSIONS.has(result.hostAbi)) {
    errors.push(`unsupported hostAbi ${JSON.stringify(result.hostAbi)}; expected one of ${Array.from(SUPPORTED_HOST_ABI_VERSIONS).sort().join(", ")}`);
  }

  const entry = validatePackageLocalPath(base, manifest.entry, "entry", errors);
  if (entry) {
    result.entry = entry.relative;
    if (!fs.existsSync(entry.absolute)) errors.push(`entry does not exist: ${entry.relative}`);
    else if (!fs.statSync(entry.absolute).isFile()) errors.push(`entry is not a file: ${entry.relative}`);
  }

  if (manifest.wasm !== undefined) {
    const wasm = validatePackageLocalPath(base, manifest.wasm, "wasm", errors);
    if (wasm) {
      result.wasm = wasm.relative;
      if (options.built && !fs.existsSync(wasm.absolute)) errors.push(`wasm does not exist: ${wasm.relative}`);
      else if (options.built && !fs.statSync(wasm.absolute).isFile()) errors.push(`wasm is not a file: ${wasm.relative}`);
    }
  } else if (options.built) {
    errors.push("wasm is required in built package-check mode");
  }

  result.capabilities = validateStringArray(manifest.capabilities, "capabilities", errors);
  for (const capability of result.capabilities) {
    if (!KNOWN_CAPABILITIES.has(capability)) errors.push(`unknown capability: ${capability}`);
  }

  result.targetProfiles = validateStringArray(manifest.targetProfiles, "targetProfiles", errors);
  for (const profile of result.targetProfiles) {
    if (!knownProfiles.has(profile)) errors.push(`unknown target profile: ${profile}`);
  }

  if (manifest.generatedModules !== undefined) {
    if (!Array.isArray(manifest.generatedModules)) {
      errors.push("generatedModules must be an array when present");
    } else {
      for (let i = 0; i < manifest.generatedModules.length; i++) {
        const generatedRef = validatePackageLocalPath(base, manifest.generatedModules[i], `generatedModules[${i}]`, errors);
        if (generatedRef) {
          result.generatedModules.push({
            path: generatedRef.relative,
            exists: fs.existsSync(generatedRef.absolute)
          });
        }
      }
    }
  }

  if (manifest.factSchemas !== undefined) {
    if (!Array.isArray(manifest.factSchemas)) {
      errors.push("factSchemas must be an array when present");
    } else {
      for (let i = 0; i < manifest.factSchemas.length; i++) {
        const schemaRef = validatePackageLocalPath(base, manifest.factSchemas[i], `factSchemas[${i}]`, errors);
        if (schemaRef) {
          result.factSchemas.push({
            path: schemaRef.relative,
            exists: fs.existsSync(schemaRef.absolute)
          });
        }
      }
    }
  }

  if (manifest.structuredIO !== undefined) {
    if (!Array.isArray(manifest.structuredIO)) {
      errors.push("structuredIO must be an array when present");
    } else {
      for (let i = 0; i < manifest.structuredIO.length; i++) {
        const schemaRef = validatePackageLocalPath(base, manifest.structuredIO[i], `structuredIO[${i}]`, errors);
        if (schemaRef) {
          result.structuredIO.push({
            path: schemaRef.relative,
            exists: fs.existsSync(schemaRef.absolute)
          });
        }
      }
    }
  }

  if (manifest.outputContracts !== undefined) {
    if (!Array.isArray(manifest.outputContracts)) {
      errors.push("outputContracts must be an array when present");
    } else {
      for (let i = 0; i < manifest.outputContracts.length; i++) {
        const contractRef = validatePackageLocalPath(base, manifest.outputContracts[i], `outputContracts[${i}]`, errors);
        if (contractRef) {
          result.outputContracts.push({
            path: contractRef.relative,
            exists: fs.existsSync(contractRef.absolute)
          });
        }
      }
    }
  }

  if (manifest.commandBuffers !== undefined) {
    if (!Array.isArray(manifest.commandBuffers)) {
      errors.push("commandBuffers must be an array when present");
    } else {
      for (let i = 0; i < manifest.commandBuffers.length; i++) {
        const bufferRef = validatePackageLocalPath(base, manifest.commandBuffers[i], `commandBuffers[${i}]`, errors);
        if (bufferRef) {
          result.commandBuffers.push({
            path: bufferRef.relative,
            exists: fs.existsSync(bufferRef.absolute)
          });
        }
      }
    }
  }

  if (manifest.packageExports !== undefined) {
    result.packageExports = validatePackageExports(base, manifest.packageExports, errors);
  }

  if (manifest.aiReview !== undefined) {
    result.aiReview = validateAiReviewPolicy(manifest.aiReview, errors);
  }
  if (manifest.reviewPolicy !== undefined) {
    result.reviewPolicy = validateReviewPolicy(manifest.reviewPolicy, errors);
  }

  if (manifest.manifests !== undefined) {
    if (!manifest.manifests || typeof manifest.manifests !== "object" || Array.isArray(manifest.manifests)) {
      errors.push("manifests must be an object when present");
    } else {
      for (const key of Object.keys(manifest.manifests).sort()) {
        const value = manifest.manifests[key];
        if (!/^[a-z][a-z0-9._-]*$/i.test(key)) {
          errors.push(`manifest key ${JSON.stringify(key)} must be a stable identifier`);
          continue;
        }
        const manifestRef = validatePackageLocalPath(base, value, `manifests.${key}`, errors);
        if (manifestRef) {
          result.manifests[key] = {
            path: manifestRef.relative,
            exists: fs.existsSync(manifestRef.absolute)
          };
          if (!result.manifests[key].exists) warnings.push(`manifest path does not exist yet: ${manifestRef.relative}`);
        }
      }
    }
  }

  throwIfInvalid(result);
  result.ok = true;
  return result;
}

function normalizePackageMetadata(raw) {
  const metadata = raw && typeof raw === "object" ? raw : {};
  const isV12 = metadata.airAbi !== undefined || metadata.name !== undefined || metadata.entry !== undefined || metadata.targetProfiles !== undefined || metadata.manifests !== undefined;
  const manifests = normalizeManifests(metadata);
  const name = isV12 ? metadata.name : metadata.module;
  const airAbi = isV12 ? metadata.airAbi : metadata.abi;
  return {
    format: isV12 ? PACKAGE_MANIFEST_FILE : "air-package.json",
    name: name || null,
    module: metadata.module || name || null,
    version: metadata.version || null,
    airAbi: airAbi || null,
    abi: airAbi || null,
    hostAbi: metadata.hostAbi || airAbi || null,
    entry: metadata.entry || null,
    wasm: metadata.wasm || null,
    capabilities: Array.isArray(metadata.capabilities) ? metadata.capabilities.slice().sort() : [],
    targetProfiles: Array.isArray(metadata.targetProfiles) ? metadata.targetProfiles.slice().sort() : [],
    generatedModules: normalizeGeneratedModules(metadata.generatedModules),
    factSchemas: normalizePathList(metadata.factSchemas),
    structuredIO: normalizePathList(metadata.structuredIO),
    outputContracts: normalizePathList(metadata.outputContracts),
    commandBuffers: normalizePathList(metadata.commandBuffers),
    packageExports: normalizePackageExports(metadata.packageExports),
    aiReview: normalizeReviewPolicy(metadata.reviewPolicy || metadata.aiReview),
    reviewPolicy: normalizeReviewPolicy(metadata.reviewPolicy || metadata.aiReview),
    manifests,
    manifest: metadata.manifest || (manifests.gfx && manifests.gfx.path) || null,
    imports: Array.isArray(metadata.imports) ? metadata.imports.slice() : [],
    exports: Array.isArray(metadata.exports) ? metadata.exports.slice() : [],
    raw: metadata
  };
}

function validatePackageExports(base, value, errors) {
  if (!Array.isArray(value)) {
    errors.push("packageExports must be an array when present");
    return [];
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const label = `packageExports[${i}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const name = validatePackageExportName(item.name, `${label}.name`, errors);
    const fn = validateFunctionIdentifier(item.function, `${label}.function`, errors);
    let modulePath = null;
    if (item.module !== undefined) {
      const moduleRef = validatePackageLocalPath(base, item.module, `${label}.module`, errors);
      if (moduleRef) modulePath = moduleRef.relative;
    }
    if (name) {
      if (seen.has(name)) errors.push(`duplicate package export name: ${name}`);
      seen.add(name);
    }
    if (name && fn) {
      out.push({
        name,
        module: modulePath,
        function: fn
      });
    }
  }
  return out;
}

function validateAiReviewPolicy(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("aiReview must be an object when present");
    return null;
  }
  const out = normalizeAiReviewPolicy(value);
  if (value.thresholds !== undefined) {
    if (!value.thresholds || typeof value.thresholds !== "object" || Array.isArray(value.thresholds)) {
      errors.push("aiReview.thresholds must be an object when present");
    } else {
      for (const [key, threshold] of Object.entries(value.thresholds)) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) errors.push(`aiReview.thresholds.${key} must be a stable identifier`);
        if (!Number.isFinite(threshold) || threshold < 0) errors.push(`aiReview.thresholds.${key} must be a non-negative number`);
      }
    }
  }
  if (value.failOn !== undefined) {
    const failOn = validateStringArray(value.failOn, "aiReview.failOn", errors);
    for (const item of failOn) {
      if (!/^[a-z0-9_.:-]+$/i.test(item)) errors.push(`aiReview.failOn item ${JSON.stringify(item)} must be a stable warning id or prefix`);
    }
  }
  return out;
}

function normalizeAiReviewPolicy(value) {
  return normalizeReviewPolicy(value);
}

function validateReviewPolicy(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("reviewPolicy must be an object when present");
    return null;
  }
  const out = normalizeReviewPolicy(value);
  if (value.schemaVersion !== undefined && typeof value.schemaVersion !== "string") {
    errors.push("reviewPolicy.schemaVersion must be a string when present");
  }
  if (value.profile !== undefined && typeof value.profile !== "string") {
    errors.push("reviewPolicy.profile must be a string when present");
  }
  validatePathClasses(value.pathClasses, "reviewPolicy.pathClasses", errors);
  if (value.pathClassOrder !== undefined) {
    const pathClassOrder = validateStringArray(value.pathClassOrder, "reviewPolicy.pathClassOrder", errors);
    for (const item of pathClassOrder) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(item)) errors.push(`reviewPolicy.pathClassOrder item ${JSON.stringify(item)} must be a stable identifier`);
    }
  }
  validateThresholdMap(value.thresholds, "reviewPolicy.thresholds", errors);
  validateThresholdMap(value.pathClassThresholds, "reviewPolicy.pathClassThresholds", errors, { nested: true });
  validateTrendPolicy(value.trend, "reviewPolicy.trend", errors);
  if (value.gates !== undefined) {
    if (!value.gates || typeof value.gates !== "object" || Array.isArray(value.gates)) {
      errors.push("reviewPolicy.gates must be an object when present");
    } else {
      for (const [key, action] of Object.entries(value.gates)) {
        if (!isReviewGateKey(key)) errors.push(`reviewPolicy.gates.${key} must be a stable diagnostic code or legacy gate alias`);
        if (!["off", "warn", "fail"].includes(action)) errors.push(`reviewPolicy.gates.${key} must be off, warn, or fail`);
      }
    }
  }
  if (value.waivers !== undefined) validateReviewWaivers(value.waivers, errors);
  return out;
}

function validateTrendPolicy(value, label, errors) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object when present`);
    return;
  }
  if (value.baseline !== undefined && typeof value.baseline !== "string") errors.push(`${label}.baseline must be a string when present`);
  validateThresholdMap(value.thresholds, `${label}.thresholds`, errors);
  if (value.gates !== undefined) {
    if (!value.gates || typeof value.gates !== "object" || Array.isArray(value.gates)) {
      errors.push(`${label}.gates must be an object when present`);
    } else {
      for (const [key, action] of Object.entries(value.gates)) {
        if (!/^[A-Za-z0-9_.-]+$/.test(key)) errors.push(`${label}.gates.${key} must be a stable diagnostic code or metric`);
        if (!["off", "warn", "fail"].includes(action)) errors.push(`${label}.gates.${key} must be off, warn, or fail`);
      }
    }
  }
  for (const key of ["ignorePathClasses", "ignoredPathClasses"]) {
    if (value[key] !== undefined) validateStringArray(value[key], `${label}.${key}`, errors);
  }
}

function isReviewGateKey(key) {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(key) || /^air\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key);
}

function validateReviewWaivers(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("reviewPolicy.waivers must be an array when present");
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const waiver = value[i];
    const label = `reviewPolicy.waivers[${i}]`;
    if (!waiver || typeof waiver !== "object" || Array.isArray(waiver)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (waiver.code !== undefined && !/^air\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(String(waiver.code))) {
      errors.push(`${label}.code must be a stable diagnostic code`);
    }
    if (waiver.legacyId !== undefined && !/^[a-z0-9_.:-]+$/i.test(String(waiver.legacyId))) {
      errors.push(`${label}.legacyId must be a stable warning id`);
    }
    if (waiver.code === undefined && waiver.legacyId === undefined) {
      errors.push(`${label} must include code or legacyId`);
    }
    if (typeof waiver.reason !== "string" || waiver.reason.trim() === "") {
      errors.push(`${label}.reason is required`);
    }
    if (waiver.expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(waiver.expires))) {
      errors.push(`${label}.expires must use YYYY-MM-DD`);
    }
    for (const key of ["file", "module", "symbol", "pathClass"]) {
      if (waiver[key] !== undefined && typeof waiver[key] !== "string") {
        errors.push(`${label}.${key} must be a string when present`);
      }
    }
  }
}

function validatePathClasses(value, label, errors) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object when present`);
    return;
  }
  for (const [key, patterns] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) errors.push(`${label}.${key} must be a stable identifier`);
    const list = validateStringArray(patterns, `${label}.${key}`, errors);
    for (const pattern of list) {
      if (pattern.includes("\0") || /:\/\//.test(pattern) || pattern.startsWith("/") || pattern.startsWith("../")) {
        errors.push(`${label}.${key} pattern ${JSON.stringify(pattern)} must be package-local glob-like text`);
      }
    }
  }
}

function validateThresholdMap(value, label, errors, options = {}) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object when present`);
    return;
  }
  if (options.nested) {
    for (const [key, thresholds] of Object.entries(value)) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) errors.push(`${label}.${key} must be a stable identifier`);
      validateThresholdMap(thresholds, `${label}.${key}`, errors);
    }
    return;
  }
  for (const [key, threshold] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) errors.push(`${label}.${key} must be a stable identifier`);
    if (!Number.isFinite(threshold) || threshold < 0) errors.push(`${label}.${key} must be a non-negative number`);
  }
}

function normalizeReviewPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const thresholds = value.thresholds && typeof value.thresholds === "object" && !Array.isArray(value.thresholds)
    ? Object.fromEntries(Object.entries(value.thresholds).sort(([a], [b]) => a.localeCompare(b)))
    : {};
  const pathClassThresholds = value.pathClassThresholds && typeof value.pathClassThresholds === "object" && !Array.isArray(value.pathClassThresholds)
    ? Object.fromEntries(Object.entries(value.pathClassThresholds).sort(([a], [b]) => a.localeCompare(b)).map(([key, thresholds]) => [
      key,
      thresholds && typeof thresholds === "object" && !Array.isArray(thresholds)
        ? Object.fromEntries(Object.entries(thresholds).sort(([a], [b]) => a.localeCompare(b)))
        : {}
    ]))
    : {};
  const pathClasses = value.pathClasses && typeof value.pathClasses === "object" && !Array.isArray(value.pathClasses)
    ? Object.fromEntries(Object.entries(value.pathClasses).sort(([a], [b]) => a.localeCompare(b)).map(([key, patterns]) => [
      key,
      Array.isArray(patterns) ? patterns.slice().sort() : []
    ]))
    : {};
  const gates = value.gates && typeof value.gates === "object" && !Array.isArray(value.gates)
    ? Object.fromEntries(Object.entries(value.gates).sort(([a], [b]) => a.localeCompare(b)))
    : {};
  const pathClassOrder = Array.isArray(value.pathClassOrder) ? Array.from(new Set(value.pathClassOrder)) : [];
  const waivers = Array.isArray(value.waivers)
    ? value.waivers
      .filter((waiver) => waiver && typeof waiver === "object" && !Array.isArray(waiver))
      .map((waiver) => ({
        code: typeof waiver.code === "string" ? waiver.code : null,
        legacyId: typeof waiver.legacyId === "string" ? waiver.legacyId : null,
        file: typeof waiver.file === "string" ? waiver.file : null,
        module: typeof waiver.module === "string" ? waiver.module : null,
        symbol: typeof waiver.symbol === "string" ? waiver.symbol : null,
        pathClass: typeof waiver.pathClass === "string" ? waiver.pathClass : null,
        expires: typeof waiver.expires === "string" ? waiver.expires : null,
        reason: typeof waiver.reason === "string" ? waiver.reason : null
      }))
      .sort((a, b) =>
        String(a.code || "").localeCompare(String(b.code || "")) ||
        String(a.legacyId || "").localeCompare(String(b.legacyId || "")) ||
        String(a.file || "").localeCompare(String(b.file || "")) ||
        String(a.reason || "").localeCompare(String(b.reason || "")))
    : [];
  return {
    schemaVersion: typeof value.schemaVersion === "string" ? value.schemaVersion : null,
    profile: typeof value.profile === "string" ? value.profile : null,
    pathClasses,
    pathClassOrder,
    thresholds,
    pathClassThresholds,
    gates,
    trend: normalizeTrendPolicy(value.trend),
    waivers,
    failOn: Array.isArray(value.failOn) ? value.failOn.slice().sort() : []
  };
}

function normalizeTrendPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    baseline: typeof value.baseline === "string" ? value.baseline : null,
    gates: value.gates && typeof value.gates === "object" && !Array.isArray(value.gates)
      ? Object.fromEntries(Object.entries(value.gates).sort(([a], [b]) => a.localeCompare(b)))
      : {},
    thresholds: value.thresholds && typeof value.thresholds === "object" && !Array.isArray(value.thresholds)
      ? Object.fromEntries(Object.entries(value.thresholds).sort(([a], [b]) => a.localeCompare(b)))
      : {},
    ignorePathClasses: Array.isArray(value.ignorePathClasses) ? value.ignorePathClasses.slice().sort() : [],
    ignoredPathClasses: Array.isArray(value.ignoredPathClasses) ? value.ignoredPathClasses.slice().sort() : []
  };
}

function normalizeGeneratedModules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.path === "string") return item.path;
      return null;
    })
    .filter(Boolean)
    .sort();
}

function normalizePathList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.path === "string") return item.path;
      return null;
    })
    .filter(Boolean)
    .map((item) => item.replace(/\\/g, "/").replace(/^\.\//, ""))
    .sort();
}

function normalizePackageExports(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : null,
      module: typeof item.module === "string" ? item.module.replace(/\\/g, "/").replace(/^\.\//, "") : null,
      function: typeof item.function === "string" ? item.function : null
    }))
    .filter((item) => item.name && item.function)
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")) ||
      String(a.module || "").localeCompare(String(b.module || "")) ||
      String(a.function || "").localeCompare(String(b.function || "")));
}

function normalizeManifests(metadata) {
  const out = {};
  if (metadata && metadata.manifests && typeof metadata.manifests === "object" && !Array.isArray(metadata.manifests)) {
    for (const key of Object.keys(metadata.manifests).sort()) {
      const value = metadata.manifests[key];
      if (typeof value === "string") out[key] = { path: value };
      else if (value && typeof value === "object" && typeof value.path === "string") out[key] = { ...value };
    }
  }
  if (metadata && typeof metadata.manifest === "string" && !out.gfx) {
    out.gfx = { path: metadata.manifest };
  }
  return out;
}

function loadKnownHostProfiles(rootDir = path.resolve(__dirname, "..")) {
  return new Set(listHostProfileIds({ dir: path.join(rootDir, "data", "host_profiles") }));
}

function readJson(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    errors.push(`invalid JSON in ${file}: ${err.message}`);
    return null;
  }
}

function validateStableName(value, field, errors) {
  const name = validateRequiredString(value, field, errors);
  if (!name) return null;
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(name)) {
    errors.push(`${field} must match /^[a-z][a-z0-9._-]{0,127}$/`);
  }
  return name;
}

function validatePackageExportName(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} is required`);
    return null;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    errors.push(`${field} must be a stable export name`);
    return null;
  }
  return value;
}

function validateFunctionIdentifier(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} is required`);
    return null;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    errors.push(`${field} must be a stable AIR function identifier`);
    return null;
  }
  return value;
}

function validateRequiredString(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} is required`);
    return null;
  }
  return value;
}

function validateStringArray(value, field, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  const out = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string" || value[i] === "") {
      errors.push(`${field}[${i}] must be a non-empty string`);
    } else {
      out.push(value[i]);
    }
  }
  return out;
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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) || /^file:\/\//i.test(normalized)) {
    errors.push(`${field} must not be a URL or remote path`);
    return null;
  }
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

function throwIfInvalid(result) {
  if (result.errors.length) throw new PackageManifestError(result.errors);
}

module.exports = {
  HOST_ABI_VERSION,
  PACKAGE_MANIFEST_FILE,
  PackageManifestError,
  SUPPORTED_HOST_ABI_VERSIONS,
  loadKnownHostProfiles,
  normalizePackageMetadata,
  validatePackageManifest
};
