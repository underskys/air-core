const fs = require("fs");
const path = require("path");
const { KNOWN_CAPABILITIES } = require("./capabilities");
const {
  BORROWED_SLICES_AIR_ABI_VERSION,
  SUPPORTED_AIR_ABI_VERSIONS
} = require("./version");
const { listHostProfileIds } = require("./host_profiles");
const {
  ABI_012,
  isCandidateAbi012,
  validateTypedPackageBinding
} = require("./typed_interface");

const PACKAGE_MANIFEST_FILE = "air.package.json";
const HOST_ABI_VERSION = "0.10";
const SUPPORTED_HOST_ABI_VERSIONS = new Set([
  HOST_ABI_VERSION,
  "0.11"
]);
const RESOURCE_CERTIFICATE_MODES = new Set(["optional", "required"]);
const RESOURCE_CERTIFICATE_BOUNDS = new Set(["borrowedMemory", "loops", "memory", "hostCalls", "effects"]);
const PROVENANCE_FLOW_LABELS = new Set(["public", "internal", "sensitive", "restricted"]);
const EXECUTION_PROFILE_MODES = new Set(["realtime_safe"]);
const EXECUTION_PROFILE_KEYS = new Set([
  "airAbi",
  "entrypoint",
  "feature",
  "maximumFuel",
  "mode",
  "stateParameters"
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
    resourceCertificate: null,
    provenanceFlow: null,
    executionProfile: null,
    typedInterface: null,
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

  if (result.airAbi && !SUPPORTED_AIR_ABI_VERSIONS.includes(result.airAbi) && !isCandidateAbi012(result.airAbi)) {
    errors.push(`unsupported airAbi ${JSON.stringify(result.airAbi)}; expected one of ${SUPPORTED_AIR_ABI_VERSIONS.join(", ")}`);
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
  if (manifest.resourceCertificate !== undefined) {
    result.resourceCertificate = validateResourceCertificatePolicy(manifest.resourceCertificate, errors);
  }
  if (manifest.provenanceFlow !== undefined) {
    result.provenanceFlow = validateProvenanceFlowPolicy(manifest.provenanceFlow, errors);
  }
  if (manifest.executionProfile !== undefined) {
    result.executionProfile = validateExecutionProfile(manifest.executionProfile, errors);
  }

  if (manifest.typedInterface !== undefined && result.airAbi !== ABI_012) {
    errors.push("typedInterface is forbidden unless airAbi is 0.12 candidate");
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

  if (result.airAbi === ABI_012) {
    if (!options.allowCandidateAbi012) {
      errors.push("air.v051.abi_candidate_disabled: AIR ABI 0.12 is candidate-only and disabled");
    } else if (!errors.length) {
      try {
        const binding = validateTypedPackageBinding(manifest, base, {
          allowCandidateAbi012: true
        });
        result.typedInterface = {
          descriptorDigest: binding.descriptorDigest,
          entryExport: manifest.typedInterface.entryExport,
          manifestDigest: binding.manifestDigest
        };
      } catch (err) {
        errors.push(err && err.message ? err.message : String(err));
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
    resourceCertificate: normalizeResourceCertificatePolicy(metadata.resourceCertificate),
    provenanceFlow: normalizeProvenanceFlowPolicy(metadata.provenanceFlow),
    executionProfile: normalizeExecutionProfile(metadata.executionProfile),
    typedInterface: metadata.typedInterface || null,
    manifests,
    manifest: metadata.manifest || (manifests.gfx && manifests.gfx.path) || null,
    imports: Array.isArray(metadata.imports) ? metadata.imports.slice() : [],
    exports: Array.isArray(metadata.exports) ? metadata.exports.slice() : [],
    raw: metadata
  };
}

function validateResourceCertificatePolicy(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("resourceCertificate must be an object when present");
    return null;
  }
  const policy = normalizeResourceCertificatePolicy(value);
  if (!RESOURCE_CERTIFICATE_MODES.has(policy.mode)) {
    errors.push("resourceCertificate.mode must be optional or required");
  }
  if (value.requiredBounds !== undefined) {
    if (!Array.isArray(value.requiredBounds) || value.requiredBounds.length === 0) {
      errors.push("resourceCertificate.requiredBounds must be a non-empty array when present");
    } else {
      for (const item of value.requiredBounds) {
        if (!RESOURCE_CERTIFICATE_BOUNDS.has(item)) {
          errors.push(`resourceCertificate.requiredBounds contains unsupported category: ${item}`);
        }
      }
    }
  }
  for (const field of ["verifierDigest", "packageDigest", "certificateDigest"]) {
    if (value[field] !== undefined && !validSha256(value[field])) {
      errors.push(`resourceCertificate.${field} must be sha256:<64 lowercase hex>`);
    }
  }
  return policy;
}

function normalizeResourceCertificatePolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      mode: "optional",
      requiredBounds: Array.from(RESOURCE_CERTIFICATE_BOUNDS).sort(),
      verifierDigest: null,
      packageDigest: null,
      certificateDigest: null
    };
  }
  return {
    mode: typeof value.mode === "string" ? value.mode : "optional",
    requiredBounds: Array.isArray(value.requiredBounds) && value.requiredBounds.length
      ? Array.from(new Set(value.requiredBounds)).sort()
      : Array.from(RESOURCE_CERTIFICATE_BOUNDS).sort(),
    verifierDigest: typeof value.verifierDigest === "string" ? value.verifierDigest : null,
    packageDigest: typeof value.packageDigest === "string" ? value.packageDigest : null,
    certificateDigest: typeof value.certificateDigest === "string" ? value.certificateDigest : null
  };
}

function validateExecutionProfile(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("executionProfile must be an object when present");
    return null;
  }
  const unknown = Object.keys(value).filter((key) => !EXECUTION_PROFILE_KEYS.has(key)).sort();
  for (const key of unknown) errors.push(`executionProfile.${key} is not supported`);
  const profile = normalizeExecutionProfile(value);
  if (!EXECUTION_PROFILE_MODES.has(profile.mode)) {
    errors.push("executionProfile.mode must be realtime_safe");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.entrypoint || "")) {
    errors.push("executionProfile.entrypoint must be a stable AIR function identifier");
  }
  if (!Number.isSafeInteger(profile.maximumFuel) || profile.maximumFuel <= 0) {
    errors.push("executionProfile.maximumFuel must be a positive safe integer");
  }
  if (profile.airAbi !== BORROWED_SLICES_AIR_ABI_VERSION) {
    errors.push(`executionProfile.airAbi must be ${BORROWED_SLICES_AIR_ABI_VERSION}`);
  }
  if (profile.feature !== "borrowed-slice-v1") {
    errors.push("executionProfile.feature must be borrowed-slice-v1");
  }
  if (!Array.isArray(value.stateParameters)) {
    errors.push("executionProfile.stateParameters must be an array");
  } else {
    const seen = new Set();
    for (let index = 0; index < value.stateParameters.length; index += 1) {
      const name = value.stateParameters[index];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ""))) {
        errors.push(`executionProfile.stateParameters[${index}] must be a stable AIR parameter name`);
      } else if (seen.has(name)) {
        errors.push(`executionProfile.stateParameters contains duplicate '${name}'`);
      }
      seen.add(name);
    }
  }
  return profile;
}

function normalizeExecutionProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    mode: typeof value.mode === "string" ? value.mode : null,
    entrypoint: typeof value.entrypoint === "string" ? value.entrypoint : null,
    maximumFuel: Number.isSafeInteger(value.maximumFuel) ? value.maximumFuel : null,
    airAbi: typeof value.airAbi === "string" ? value.airAbi : null,
    feature: typeof value.feature === "string" ? value.feature : null,
    stateParameters: Array.isArray(value.stateParameters)
      ? Array.from(new Set(value.stateParameters.filter((item) => typeof item === "string"))).sort()
      : []
  };
}

function validateProvenanceFlowPolicy(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("provenanceFlow must be an object when present");
    return null;
  }
  const policy = normalizeProvenanceFlowPolicy(value);
  if (value.mode !== "required") errors.push("provenanceFlow.mode must be required");
  if (value.sourceBindings !== undefined && !Array.isArray(value.sourceBindings)) {
    errors.push("provenanceFlow.sourceBindings must be an array when present");
  }
  if (value.declassifiers !== undefined && !Array.isArray(value.declassifiers)) {
    errors.push("provenanceFlow.declassifiers must be an array when present");
  }
  const bindingKeys = new Set();
  for (let index = 0; index < policy.sourceBindings.length; index += 1) {
    const item = policy.sourceBindings[index];
    const label = `provenanceFlow.sourceBindings[${index}]`;
    if (!/^(?:fact|structured):[A-Za-z_][A-Za-z0-9_.]*$/.test(item.from)) {
      errors.push(`${label}.from must be fact:<schema.field> or structured:<schema.field>`);
    }
    if (!/^param:[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(item.to)) {
      errors.push(`${label}.to must be param:<module.function.param>`);
    }
    if (!PROVENANCE_FLOW_LABELS.has(item.label)) {
      errors.push(`${label}.label must be one of: ${Array.from(PROVENANCE_FLOW_LABELS).join(", ")}`);
    }
    const key = `${item.from}\0${item.to}`;
    if (bindingKeys.has(key)) errors.push(`duplicate provenanceFlow source binding: ${item.from} -> ${item.to}`);
    bindingKeys.add(key);
  }
  const declassifierIds = new Set();
  for (let index = 0; index < policy.declassifiers.length; index += 1) {
    const item = policy.declassifiers[index];
    const label = `provenanceFlow.declassifiers[${index}]`;
    for (const field of ["id", "module", "function", "reasonCode"]) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(item[field])) {
        errors.push(`${label}.${field} must be a stable identifier`);
      }
    }
    if (!PROVENANCE_FLOW_LABELS.has(item.from) || !PROVENANCE_FLOW_LABELS.has(item.to)) {
      errors.push(`${label}.from and .to must use the fixed provenance labels`);
    } else if (Array.from(PROVENANCE_FLOW_LABELS).indexOf(item.to) >= Array.from(PROVENANCE_FLOW_LABELS).indexOf(item.from)) {
      errors.push(`${label}.to must be lower than .from`);
    }
    if (declassifierIds.has(item.id)) errors.push(`duplicate provenanceFlow declassifier id: ${item.id}`);
    declassifierIds.add(item.id);
  }
  return policy;
}

function normalizeProvenanceFlowPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    mode: typeof value.mode === "string" ? value.mode : null,
    sourceBindings: Array.isArray(value.sourceBindings)
      ? value.sourceBindings.map((item) => ({
        from: item && typeof item.from === "string" ? item.from : "",
        to: item && typeof item.to === "string" ? item.to : "",
        label: item && typeof item.label === "string" ? item.label : ""
      })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.label.localeCompare(b.label))
      : [],
    declassifiers: Array.isArray(value.declassifiers)
      ? value.declassifiers.map((item) => ({
        id: item && typeof item.id === "string" ? item.id : "",
        module: item && typeof item.module === "string" ? item.module : "",
        function: item && typeof item.function === "string" ? item.function : "",
        from: item && typeof item.from === "string" ? item.from : "",
        to: item && typeof item.to === "string" ? item.to : "",
        reasonCode: item && typeof item.reasonCode === "string" ? item.reasonCode : ""
      })).sort((a, b) => a.id.localeCompare(b.id) || a.module.localeCompare(b.module) || a.function.localeCompare(b.function))
      : []
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

function validSha256(value) {
  return /^sha256:[a-f0-9]{64}$/.test(String(value || ""));
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
  BORROWED_SLICES_AIR_ABI_VERSION,
  HOST_ABI_VERSION,
  PACKAGE_MANIFEST_FILE,
  PackageManifestError,
  SUPPORTED_AIR_ABI_VERSIONS,
  SUPPORTED_HOST_ABI_VERSIONS,
  loadKnownHostProfiles,
  normalizePackageMetadata,
  normalizeExecutionProfile,
  normalizeProvenanceFlowPolicy,
  normalizeResourceCertificatePolicy,
  validatePackageManifest
};
