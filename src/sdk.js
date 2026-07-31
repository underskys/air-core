const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const {
  assertRealtimeSafeProfile,
  createVerifiedResourceCertificate,
  validateVerifiedResourceCertificate,
  verifyModule
} = require("./verifier");
const { lowerToWat, watToWasm } = require("./lower_wasm");
const { loadGfxManifest, validateGfxManifest, buildGfxPackage } = require("./gfx_manifest");
const { AIR_ABI_VERSION, AIR_VERSION } = require("./version");
const { hostFunctionNamesForCapability } = require("./host_abi");
const { createAudioAuthorityReport, loadAudioManifest, packageMetadataToModule } = require("./audio_authority");
const { PACKAGE_MANIFEST_FILE, normalizePackageMetadata, validatePackageManifest } = require("./package_manifest");
const { createHostProfileReport, listHostProfileIds, loadHostProfile } = require("./host_profiles");
const { HOST_ASSET_KIND, validateAssetManifest } = require("./asset_manifest");
const { checkGeneratedArtifacts, checkGeneratedHandleModules } = require("./handle_generator");
const { checkGeneratedOutputHandles } = require("./output_handle_generator");
const { checkGeneratedStateHandles } = require("./state_handle_generator");
const { checkStateAccessorPolicies } = require("./state_accessor_policy");
const { analyzePackageModuleGraph } = require("./module_graph");
const { createPackageGraphOwnership, packageGraphDiagnostics } = require("./package_graph_ownership");
const { createAiReviewReport } = require("./ai_review");
const { diagnosticCodeForLegacyId, diagnosticHintsFromMessage, normalizeDiagnostic, sortDiagnostics } = require("./diagnostics");
const { compareReviewBaseline } = require("./review_trends");
const { validateFactsSchemaFile } = require("./facts_schema");
const { validateOutputContractSchemaFile } = require("./output_contract_schema");
const { validateCommandBufferSchemaFile } = require("./command_buffer_schema");
const {
  checkGeneratedStructuredIoHandles,
  validateStructuredIoSchemaFile
} = require("./structured_io_schema");
const {
  invokeBorrowedMemory,
  prepareBorrowedMemoryInvocation,
  registerBorrowedMemoryInstanceIdentity
} = require("./borrowed_memory_binding");
const { borrowedSliceInterfaceDescriptor } = require("./borrowed_slices");

async function buildPackage(options) {
  const airFile = options.air;
  const manifestFile = options.manifest;
  const outDir = path.resolve(options.out);
  const source = fs.readFileSync(airFile, "utf8");
  const mod = parseAir(source, airFile);
  verifyModule(mod);

  if (manifestFile) {
    const manifest = loadGfxManifest(manifestFile);
    const result = validateGfxManifest(mod, manifest);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return buildGfxPackage(mod, manifest, { outDir, sourceName: airFile, packageMetadata: true });
  }

  fs.mkdirSync(outDir, { recursive: true });
  const wasm = await watToWasm(lowerToWat(mod), airFile);
  const wasmPath = path.join(outDir, `${mod.name}.wasm`);
  fs.writeFileSync(wasmPath, wasm);
  const metadata = createPackageMetadata(mod, {
    wasmName: path.basename(wasmPath),
    manifestName: null,
    manifestBytes: null
  });
  const metadataPath = path.join(outDir, "air-package.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  return { wasm: wasmPath, manifest: null, metadata: metadataPath };
}

function createPackageMetadata(mod, options) {
  const manifestHash = options.manifestBytes ? sha256(options.manifestBytes) : null;
  return {
    abi: AIR_ABI_VERSION,
    compiler: `airc ${AIR_VERSION}`,
    module: mod.name,
    wasm: options.wasmName,
    manifest: options.manifestName,
    manifestHash,
    capabilities: Array.from(mod.capabilities || []).sort(),
    exports: mod.functions.filter((fn) => fn.exported).map((fn) => ({ name: fn.name, params: fn.params, returnType: fn.returnType })),
    imports: (mod.externs || []).map((ex) => ({ name: ex.name, params: ex.params, returnType: ex.returnType }))
  };
}

function loadPackage(packageDir) {
  const base = path.resolve(packageDir);
  const metadataPath = path.join(base, "air-package.json");
  if (!fs.existsSync(metadataPath)) throw new Error(`missing air-package.json in ${base}`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const wasmPath = path.join(base, metadata.wasm || `${metadata.module}.wasm`);
  if (!fs.existsSync(wasmPath)) throw new Error(`missing wasm: ${metadata.wasm}`);
  let manifest = null;
  let manifestPath = null;
  if (metadata.manifest) {
    manifestPath = path.join(base, metadata.manifest);
    if (!fs.existsSync(manifestPath)) throw new Error(`missing manifest: ${metadata.manifest}`);
    const manifestBytes = fs.readFileSync(manifestPath);
    if (metadata.manifestHash && sha256(manifestBytes) !== metadata.manifestHash) {
      throw new Error(`manifest hash mismatch for ${metadata.manifest}`);
    }
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  }
  return {
    base,
    metadata,
    wasmPath,
    wasmBytes: fs.readFileSync(wasmPath),
    manifestPath,
    manifest
  };
}

async function instantiateAirModule(options) {
  const source = options.wasmBytes || fs.readFileSync(options.wasmPath);
  const instance = await WebAssembly.instantiate(source, options.imports || {});
  const resolved = instance.instance || instance;
  registerBorrowedMemoryInstanceIdentity(resolved, {
    moduleDigest: `sha256:${sha256(source)}`,
    packageDigest: options.packageDigest || null
  });
  return resolved;
}

function createGpuImports(host) {
  return createNamedImports("gpu", host, hostFunctionNamesForCapability("gpu"));
}

function createInputImports(host) {
  return createNamedImports("input", host, hostFunctionNamesForCapability("input"));
}

function createFsImports(host) {
  return createNamedImports("fs", host, hostFunctionNamesForCapability("fs"));
}

function createNetImports(host) {
  return createNamedImports("net", host, hostFunctionNamesForCapability("net"));
}

function createTimeImports(host) {
  return createNamedImports("time", host, hostFunctionNamesForCapability("time"));
}

function createRandomImports(host) {
  return createNamedImports("random", host, hostFunctionNamesForCapability("random"));
}

function createAudioImports(host) {
  return createNamedImports("audio", host, hostFunctionNamesForCapability("audio"));
}

function createIoImports(host) {
  return createNamedImports("io", host, hostFunctionNamesForCapability("io"));
}

function createOutputImports(host) {
  return createNamedImports("output", host, hostFunctionNamesForCapability("output"));
}

function createUtilityImports(hosts) {
  return {
    ...createFsImports(hosts.fs || {}),
    ...createNetImports(hosts.net || {}),
    ...createIoImports(hosts.io || {}),
    ...createTimeImports(hosts.time || {}),
    ...createRandomImports(hosts.random || {}),
    ...createAudioImports(hosts.audio || {})
  };
}

function createNamedImports(moduleName, host, names) {
  const imports = {};
  for (const name of names) {
    imports[name] = (...args) => {
      if (typeof host[name] !== "function") throw new Error(`host missing ${moduleName}.${name}`);
      return host[name](...args);
    };
  }
  return { [moduleName]: imports };
}

function validatePackageDir(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  if (fs.existsSync(path.join(base, PACKAGE_MANIFEST_FILE))) {
    const packageManifest = validatePackageManifest(base, { built: options.built !== false });
    const metadata = normalizePackageMetadata(packageManifest);
    const result = {
      ok: true,
      format: metadata.format,
      name: metadata.name,
      version: metadata.version,
      airAbi: metadata.airAbi,
      hostAbi: metadata.hostAbi,
      entry: metadata.entry,
      wasm: metadata.wasm,
      capabilities: metadata.capabilities,
      targetProfiles: metadata.targetProfiles,
      executionProfile: metadata.executionProfile,
      factSchemas: packageManifest.factSchemas,
      manifests: packageManifest.manifests,
      warnings: packageManifest.warnings
    };
    attachHostProfileReport(result, {
      profileId: options.profile,
      hostAbi: metadata.hostAbi,
      capabilities: metadata.capabilities,
      hostImports: hostImportsFromEntry(base, packageManifest.entry),
      manifestKinds: Object.keys(packageManifest.manifests || {}),
      targetProfiles: metadata.targetProfiles
    });
    return result;
  }

  const pkg = loadPackage(packageDir);
  const metadata = normalizePackageMetadata(pkg.metadata);
  const result = {
    ok: true,
    format: metadata.format,
    module: metadata.module,
    abi: metadata.abi,
    capabilities: metadata.capabilities,
    wasm: metadata.wasm,
    manifest: metadata.manifest
  };
  const audioManifestName = audioManifestNameFromMetadata(pkg.metadata);
  if (audioManifestName) {
    const audioManifest = loadAudioManifest(path.join(pkg.base, audioManifestName));
    const audio = createAudioAuthorityReport(packageMetadataToModule(pkg.metadata), { manifest: audioManifest });
    if (audio.status !== "pass") throw new Error(`audio authority check failed: ${audio.errors.join("; ")}`);
    result.audio = audio;
  }
  attachHostProfileReport(result, {
    profileId: options.profile,
    hostAbi: metadata.hostAbi,
    capabilities: metadata.capabilities,
    hostImports: metadata.imports.map((item) => item.name),
    manifestKinds: Object.keys(metadata.manifests || {}),
    targetProfiles: metadata.targetProfiles
  });
  return result;
}

function checkPackageDir(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const profileId = options.profile || null;
  const builtMode = options.built !== false;
  const report = {
    reportVersion: "0.15",
    package: path.basename(base),
    profile: profileId,
    mode: builtMode ? "built" : "source",
    airAbi: null,
    hostAbi: null,
    status: "pass",
    checks: [],
    declaredCapabilities: [],
    computedCapabilities: [],
    capabilities: {
      required: [],
      supported: [],
      unsupported: []
    },
    hostImports: {
      used: [],
      unsupported: []
    },
    manifests: {},
    facts: {
      schemas: []
    },
    structuredIO: {
      schemas: [],
      handleSets: []
    },
    tableGroups: [],
    pools: [],
    outputContracts: {
      schemas: []
    },
    commandBuffers: {
      schemas: [],
      outputIntentUsage: []
    },
    outputEmit: {
      used: [],
      diagnostics: []
    },
    outputHandleSets: [],
    stateSegments: [],
    assets: {},
    assetKinds: {
      required: [],
      supported: [],
      unsupported: []
    },
    audio: null,
    generatedArtifacts: null,
    generatedHandles: null,
    stateHandleSets: [],
    stateAccessorPolicies: [],
    diagnostics: [],
    reviewPolicy: null,
    modules: [],
    graph: { order: [], edges: [] },
    importClassifications: [],
    moduleDiagnostics: [],
    authoredGraph: null,
    executableGraph: null,
    authoredToExecutable: [],
    ownershipMap: null,
    linkDiagnostics: [],
    generatedExecutableFreshness: null,
    capabilityOrigins: {},
    hostImportOrigins: {},
    authorityChains: [],
    linkedWasm: null,
    profileSupport: null,
    hiddenAuthority: [],
    unsupportedHostFeatures: [],
    repairHints: [],
    warnings: [],
    errors: [],
    aiReviewPolicy: null,
    reviewPolicyReport: null,
    moduleReviews: [],
    packageReview: null,
    resourceCertificate: null,
    provenanceFlow: null,
    executionProfile: null
  };

  if (!fs.existsSync(path.join(base, PACKAGE_MANIFEST_FILE)) && fs.existsSync(path.join(base, "air-package.json"))) {
    return checkLegacyPackageDir(base, { ...options, profile: profileId, built: builtMode }, report);
  }

  let packageManifest = null;
  let metadata = null;
  let profile = null;
  let profileLoadFailed = false;
  let mod = null;
  let source = null;
  let moduleGraphReport = null;

  try {
    packageManifest = validatePackageManifest(base, { built: builtMode });
    metadata = normalizePackageMetadata(packageManifest);
    report.package = metadata.name || path.basename(base);
    report.airAbi = metadata.airAbi;
    report.hostAbi = metadata.hostAbi;
    report.aiReviewPolicy = metadata.aiReview;
    report.reviewPolicy = metadata.reviewPolicy;
    report.executionProfile = metadata.executionProfile;
    report.declaredCapabilities = sortedStrings(metadata.capabilities);
    report.computedCapabilities = [];
    report.capabilities.required = report.declaredCapabilities.slice();
    addCheck(report, "package-manifest", "pass", `${PACKAGE_MANIFEST_FILE} is valid`);
    if (builtMode) {
      addCheck(report, "wasm", "pass", `wasm exists: ${metadata.wasm || "-"}`);
    } else if (metadata.wasm && fs.existsSync(path.join(base, metadata.wasm))) {
      addCheck(report, "wasm", "pass", `wasm exists: ${metadata.wasm}`);
    } else {
      addCheck(report, "wasm", "skip", metadata.wasm ? `source/audit mode: wasm not required (${metadata.wasm})` : "source/audit mode: wasm not required");
    }
    for (const [kind, manifestRef] of Object.entries(packageManifest.manifests || {}).sort(([a], [b]) => a.localeCompare(b))) {
      report.manifests[kind] = {
        path: manifestRef.path,
        exists: manifestRef.exists
      };
      if (!manifestRef.exists) {
        addCheck(report, `manifest:${kind}`, "fail", `missing ${kind} manifest: ${manifestRef.path}`, manifestRepairHint(kind));
      } else {
        addCheck(report, `manifest:${kind}`, "pass", `${kind} manifest exists: ${manifestRef.path}`);
      }
    }
    if (report.manifests.assets) report.assets.manifest = report.manifests.assets;
    const artifactReport = checkGeneratedArtifacts(base, metadata.generatedModules);
    report.generatedArtifacts = artifactReport;
    if (metadata.generatedModules.length) {
      addCheck(report, "generated-artifacts", artifactReport.errors.length ? "fail" : "pass", artifactReport.errors.length ? "generated artifacts are missing or reference omitted generators" : "generated artifacts are present", artifactReport.errors.length ? "restore generated modules or run the package generator before package-check" : null);
      for (const warning of artifactReport.warnings || []) addCheck(report, "generated-artifacts", "warn", warning, "add # Source: <package-local-manifest> headers to generated modules so package-check can trace derived artifacts");
      for (const error of artifactReport.errors) addCheck(report, "generated-artifacts", "fail", error, "restore generated modules or include the referenced generator in the review bundle/package");
    } else {
      addCheck(report, "generated-artifacts", "skip", "no package-declared generated modules");
    }
    attachFactsSchemas(report, base, packageManifest.factSchemas || [], { checks: true });
    attachStructuredIO(report, base, packageManifest.structuredIO || [], { checks: true });
    attachOutputContracts(report, base, packageManifest.outputContracts || [], { checks: true });
    attachOutputHandleSets(report, base, metadata.generatedModules);
    attachStructuredIoHandleSets(report, base, metadata.generatedModules);
    attachCommandBuffers(report, base, packageManifest.commandBuffers || [], { checks: true });
  } catch (err) {
    for (const message of errorList(err)) addCheck(report, checkIdForError(message, "package-manifest"), "fail", message, repairHintForError(message));
    return finalizePackageCheckReport(report);
  }

  try {
    const moduleGraph = analyzePackageModuleGraph(base, metadata.entry, {
      provenancePolicy: metadata.provenanceFlow,
      provenanceContext: provenanceContextForReport(report)
    });
    moduleGraphReport = moduleGraph;
    attachModuleGraph(report, moduleGraph);
    addCheck(report, "module-graph", "pass", `module graph resolved: ${moduleGraph.modules.length} module(s)`);
  } catch (err) {
    if (err.partial) attachModuleGraph(report, err.partial);
    for (const message of errorList(err)) addCheck(report, checkIdForError(message, "module-graph"), "fail", message, repairHintForError(message));
  }
  attachProvenanceFlow(report, { checks: true });
  attachPackageGraphDiagnosticChecks(report, metadata);
  assignPackageGraphOwnership(report, metadata);
  attachResourceCertificate(report, base, metadata, packageManifest, {
    checks: true,
    required: Boolean(options.certificateRequired)
  });

  attachStateHandleSets(report, base, metadata.generatedModules);
  attachStateAccessorPolicies(report, base);

  if (profileId) {
    try {
      profile = loadHostProfile(profileId);
      addCheck(report, "host-profile", "pass", `host profile ${profileId} loaded`);
    } catch (err) {
      profileLoadFailed = true;
      for (const message of errorList(err)) addCheck(report, "host-profile", "fail", message, unknownProfileRepairHint());
    }
  } else {
    addCheck(report, "host-profile", "skip", "no host profile selected; skipping package-vs-host compatibility checks");
  }

  try {
    source = fs.readFileSync(path.join(base, metadata.entry), "utf8");
    mod = parseAir(source, metadata.entry, { resolveSourceImports: false });
    if (report.hostImports.used.length === 0) report.hostImports.used = sortedStrings((mod.externs || []).map((ex) => ex.name));
    if (moduleGraphReport && !moduleGraphReport.errors.length) {
      addCheck(report, "entry-verify", "pass", `entry verifies in package module graph: ${metadata.entry}`);
    } else {
      addCheck(report, "entry-verify", "skip", "entry standalone verification skipped because module graph failed or is unavailable");
    }
    attachRealtimeExecutionProfile(report, mod, metadata, { checks: true });
  } catch (err) {
    const message = errorMessage(err);
    addCheck(report, "entry-verify", "fail", message, repairHintForError(message));
  }

  attachOutputEmitValidation(report, base, metadata, profile);

  if (metadata.manifests.assets && packageManifest.manifests.assets && packageManifest.manifests.assets.exists) {
    const assetReport = validateAssetManifest(base, packageManifest.manifests.assets.path, { profile });
    report.assets = {
      ...assetReport,
      authority: assetReport.authority
    };
    report.assetKinds.required = assetKindsFromAssetReport(assetReport);
    const assetStatus = assetReport.errors.length ? "fail" : (assetReport.warnings.length ? "warn" : "pass");
    const assetCheckId = assetStatus === "warn" && assetReport.warnings.every((warning) => /uses placeholder file/.test(warning))
      ? "asset-placeholder"
      : "assets";
    addCheck(report, assetCheckId, assetStatus, assetReport.errors.length ? "asset manifest has errors" : (assetReport.warnings.length ? "asset manifest has warnings" : "asset manifest is valid"), assetReport.errors.length ? "fix missing/invalid assets or declare explicit fallbacks in the asset manifest" : null);
    for (const warning of assetReport.warnings) {
      addCheck(report, checkIdForAssetWarning(warning), "warn", warning);
    }
    for (const error of assetReport.errors) addCheck(report, checkIdForError(error, "asset"), "fail", error, repairHintForError(error));
    try {
      const handleReport = checkGeneratedHandleModules(base);
      report.generatedHandles = handleReport;
      addCheck(report, "generated-handles", handleReport.errors.length ? "fail" : "pass", handleReport.errors.length ? "generated handle modules are stale or missing" : "generated handle modules are current", handleReport.errors.length ? "run: node bin/airc.js generate-handles <package-dir>" : null);
      for (const error of handleReport.errors) addCheck(report, "generated-handles", "fail", error, "run: node bin/airc.js generate-handles <package-dir>");
    } catch (err) {
      const message = errorMessage(err);
      report.generatedHandles = { ok: false, files: [], errors: [message] };
      addCheck(report, "generated-handles", "fail", message, "fix asset manifest validation errors, then run: node bin/airc.js generate-handles <package-dir>");
    }
  }

  if (metadata.manifests.audio && packageManifest.manifests.audio && packageManifest.manifests.audio.exists) {
    try {
      const audioManifest = loadAudioManifest(path.join(base, packageManifest.manifests.audio.path));
      const audio = createAudioAuthorityReport(moduleLikeForPackageCheck(report), { manifest: audioManifest });
      report.audio = audio;
      for (const warning of audio.warnings || []) addCheck(report, "audio-authority", "warn", warning);
      for (const error of audio.errors || []) addCheck(report, "audio-authority", "fail", error, "declare capability audio or remove module-driven audio authority");
      if (audioRequiresPackageCapability(audio)) {
        addCapabilityOrigin(report, "audio", packageManifest.manifests.audio.path);
      }
    } catch (err) {
      for (const message of errorList(err)) addCheck(report, "audio-authority", "fail", message, "fix or remove manifests.audio");
    }
  }

  reconcilePackageCapabilities(report);

  if (profileId) {
    try {
      if (!profile && profileLoadFailed) throw new Error(`unknown host profile: ${profileId}`);
      if (!profile) profile = loadHostProfile(profileId);
      const profileReport = createHostProfileReport({
        profileId,
        hostAbi: metadata.hostAbi,
        capabilities: report.computedCapabilities,
        hostImports: report.hostImports.used,
        manifestKinds: Object.keys(metadata.manifests || {}),
        assetKinds: report.assetKinds.required,
        targetProfiles: metadata.targetProfiles
      }, profile);
      attachProfileSupport(report, profileReport, profile);
      report.capabilities.supported = report.computedCapabilities.filter((item) => profile.supports.capabilities.includes(item)).sort();
      report.capabilities.unsupported = profileReport.unsupportedCapabilities;
      report.hostImports.unsupported = profileReport.unsupportedHostImports;
      report.assetKinds.supported = report.assetKinds.required.filter((item) => profile.supports.assetKinds.includes(item)).sort();
      report.assetKinds.unsupported = profileReport.unsupportedAssetKinds;
      if (profileReport.unsupportedCapabilities.length) {
        for (const capability of profileReport.unsupportedCapabilities) {
          addCheck(report, `capability:${capability}`, "fail", `profile ${profile.id} does not support capability ${capability}`, capabilityRepairHint(capability));
        }
      } else {
        addCheck(report, "capabilities", "pass", "all required capabilities are supported");
      }
      if (profileReport.unsupportedHostImports.length) {
        for (const hostImport of profileReport.unsupportedHostImports) {
          addCheck(report, `host-import:${hostImport}`, "fail", `profile ${profile.id} does not support host import ${hostImport}`, hostImportRepairHint(hostImport));
        }
      } else {
        addCheck(report, "host-imports", "pass", "all used host imports are supported");
      }
      if (profileReport.unsupportedManifestKinds.length) {
        for (const manifestKind of profileReport.unsupportedManifestKinds) {
          addCheck(report, `manifest-kind:${manifestKind}`, "fail", `profile ${profile.id} does not support manifest kind ${manifestKind}`, "remove unsupported manifest references or use a host profile that supports them");
        }
      } else {
        addCheck(report, "manifest-kinds", "pass", "all manifest kinds are supported");
      }
      if (profileReport.unsupportedAssetKinds.length) {
        for (const assetKind of profileReport.unsupportedAssetKinds) {
          addCheck(report, `asset-kind:${assetKind}`, "fail", `profile ${profile.id} does not support asset kind ${assetKind}`, "remove unsupported assets or use a host profile that supports them");
        }
      } else {
        addCheck(report, "asset-kinds", "pass", "all asset kinds are supported");
      }
      if (!profileReport.targetProfileDeclared) addCheck(report, "target-profile-declared", "fail", `package does not declare target profile ${profile.id}`, `add ${profile.id} to targetProfiles or choose a declared profile`);
      else addCheck(report, "target-profile-declared", "pass", `package declares target profile ${profile.id}`);
      if (profileReport.required.hostAbi && profileReport.required.hostAbi !== profile.hostAbi) {
        addCheck(report, "host-abi", "fail", `hostAbi ${profileReport.required.hostAbi} is not supported by profile ${profile.id} (${profile.hostAbi})`, "use a host profile with matching hostAbi or update the package hostAbi after migration");
      } else {
        addCheck(report, "host-abi", "pass", `hostAbi ${profile.hostAbi} is supported`);
      }
    } catch (err) {
      for (const message of errorList(err)) addCheck(report, checkIdForError(message, "host-profile"), "fail", message, message.includes("unknown host profile") ? unknownProfileRepairHint() : repairHintForError(message));
    }
  }

  if (!profileId) {
    report.warnings.push("no host profile selected; skipping package-vs-host compatibility checks");
  }

  if (metadata && metadata.entry) {
    attachPackageAiReview(report, base, metadata, { packageReport: report, releaseCandidate: options.releaseCandidate });
    applyAiReviewPolicy(report, metadata.reviewPolicy, { releaseCandidate: options.releaseCandidate });
  }

  return finalizePackageCheckReport(report);
}

function checkLegacyPackageDir(base, options, report) {
  let metadata = null;
  try {
    const validated = validatePackageDir(base, { built: options.built });
    const pkg = loadPackage(base);
    metadata = normalizePackageMetadata(pkg.metadata);
    report.format = metadata.format;
    report.package = metadata.module || path.basename(base);
    report.airAbi = metadata.airAbi;
    report.hostAbi = metadata.hostAbi;
    report.declaredCapabilities = sortedStrings(metadata.capabilities);
    report.computedCapabilities = report.declaredCapabilities.slice();
    report.capabilities.required = report.computedCapabilities.slice();
    report.hostImports.used = sortedStrings(metadata.imports.map((item) => item.name));
    report.audio = validated.audio || null;
    addCheck(report, "package-manifest", "pass", "air-package.json is valid through the legacy compatibility path");
    addCheck(report, "wasm", "pass", `wasm exists: ${metadata.wasm || "-"}`);
    addCheck(report, "module-graph", "skip", "legacy package metadata has no canonical source entry");
    for (const [kind, manifestRef] of Object.entries(metadata.manifests || {}).sort(([a], [b]) => a.localeCompare(b))) {
      const manifestPath = manifestRef && manifestRef.path;
      const exists = Boolean(manifestPath && fs.existsSync(path.join(base, manifestPath)));
      report.manifests[kind] = { path: manifestPath, exists };
      addCheck(
        report,
        `manifest:${kind}`,
        exists ? "pass" : "fail",
        exists ? `${kind} manifest exists: ${manifestPath}` : `missing ${kind} manifest: ${manifestPath || "-"}`,
        exists ? null : manifestRepairHint(kind)
      );
    }
  } catch (err) {
    for (const message of errorList(err)) {
      addCheck(report, checkIdForError(message, "package-manifest"), "fail", message, repairHintForError(message));
    }
    return finalizePackageCheckReport(report);
  }

  if (!options.profile) {
    report.warnings.push("no host profile selected; skipping package-vs-host compatibility checks");
    return finalizePackageCheckReport(report);
  }

  try {
    const profile = loadHostProfile(options.profile);
    const profileReport = createHostProfileReport({
      profileId: options.profile,
      hostAbi: metadata.hostAbi,
      capabilities: report.computedCapabilities,
      hostImports: report.hostImports.used,
      manifestKinds: Object.keys(metadata.manifests || {}),
      assetKinds: [],
      targetProfiles: metadata.targetProfiles
    }, profile);
    attachProfileSupport(report, profileReport, profile);
    report.capabilities.supported = report.computedCapabilities.filter((item) => profile.supports.capabilities.includes(item)).sort();
    report.capabilities.unsupported = profileReport.unsupportedCapabilities;
    report.hostImports.unsupported = profileReport.unsupportedHostImports;
    for (const capability of profileReport.unsupportedCapabilities) {
      addCheck(report, `capability:${capability}`, "fail", `profile ${profile.id} does not support capability ${capability}`, capabilityRepairHint(capability));
    }
    for (const hostImport of profileReport.unsupportedHostImports) {
      addCheck(report, `host-import:${hostImport}`, "fail", `profile ${profile.id} does not support host import ${hostImport}`, hostImportRepairHint(hostImport));
    }
    for (const manifestKind of profileReport.unsupportedManifestKinds) {
      addCheck(report, `manifest-kind:${manifestKind}`, "fail", `profile ${profile.id} does not support manifest kind ${manifestKind}`, "remove unsupported manifest references or use a host profile that supports them");
    }
    if (!profileReport.unsupportedCapabilities.length) addCheck(report, "capabilities", "pass", "all required capabilities are supported");
    if (!profileReport.unsupportedHostImports.length) addCheck(report, "host-imports", "pass", "all used host imports are supported");
    if (!profileReport.unsupportedManifestKinds.length) addCheck(report, "manifest-kinds", "pass", "all manifest kinds are supported");
    addCheck(report, "target-profile-declared", "pass", `legacy package permits selected profile ${profile.id}`);
    if (profileReport.required.hostAbi && profileReport.required.hostAbi !== profile.hostAbi) {
      addCheck(report, "host-abi", "fail", `hostAbi ${profileReport.required.hostAbi} is not supported by profile ${profile.id} (${profile.hostAbi})`, "use a host profile with matching hostAbi or rebuild the legacy package after migration");
    } else {
      addCheck(report, "host-abi", "pass", `hostAbi ${profile.hostAbi} is supported`);
    }
  } catch (err) {
    for (const message of errorList(err)) {
      addCheck(report, checkIdForError(message, "host-profile"), "fail", message, message.includes("unknown host profile") ? unknownProfileRepairHint() : repairHintForError(message));
    }
  }

  return finalizePackageCheckReport(report);
}

function verifyPackageDir(packageDir, options = {}) {
  const report = reportPackageDir(packageDir, options);
  if (report.status === "fail") {
    const err = new Error(report.errors.join("\n") || `package verify failed: ${packageDir}`);
    err.report = report;
    throw err;
  }
  return report;
}

function reportPackageDir(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const report = {
    reportVersion: "0.15",
    package: path.basename(base),
    entry: null,
    status: "pass",
    linkedWasm: false,
    modules: [],
    graph: { order: [], edges: [] },
    moduleDiagnostics: [],
    authoredGraph: null,
    executableGraph: null,
    authoredToExecutable: [],
    ownershipMap: null,
    linkDiagnostics: [],
    generatedExecutableFreshness: null,
    importClassifications: [],
    declaredCapabilities: [],
    computedCapabilities: [],
    capabilityOrigins: {},
    hostImports: {
      used: []
    },
    hostImportOrigins: {},
    authorityChains: [],
    generatedArtifacts: null,
    generatedHandles: null,
    stateHandleSets: [],
    stateAccessorPolicies: [],
    outputHandleSets: [],
    reviewPolicy: null,
    aiReviewPolicy: null,
    aiReview: null,
    reviewPolicyReport: null,
    moduleReviews: [],
    packageReview: null,
    reviewTrend: null,
    diagnostics: [],
    facts: {
      schemas: []
    },
    structuredIO: {
      schemas: [],
      handleSets: []
    },
    tableGroups: [],
    outputContracts: {
      schemas: []
    },
    commandBuffers: {
      schemas: [],
      outputIntentUsage: []
    },
    stateSegments: [],
    pools: [],
    effectUsageOrigins: {},
    effectComposition: null,
    linking: null,
    resourceCertificate: null,
    provenanceFlow: null,
    executionProfile: null,
    warnings: [],
    errors: []
  };

  let metadata = null;
  let packageManifest = null;
  try {
    packageManifest = validatePackageManifest(base, { built: false });
    metadata = normalizePackageMetadata(packageManifest);
    report.package = metadata.name || path.basename(base);
    report.entry = metadata.entry;
    report.aiReviewPolicy = metadata.aiReview;
    report.reviewPolicy = metadata.reviewPolicy;
    report.executionProfile = metadata.executionProfile;
    report.declaredCapabilities = sortedStrings(metadata.capabilities);
    report.generatedArtifacts = checkGeneratedArtifacts(base, metadata.generatedModules);
    if (report.generatedArtifacts.errors.length) report.errors.push(...report.generatedArtifacts.errors);
    if (report.generatedArtifacts.warnings.length) report.warnings.push(...report.generatedArtifacts.warnings);
    attachStateHandleSetsToGraphReport(report, base, metadata.generatedModules);
    attachStateAccessorPoliciesToGraphReport(report, base);
    attachFactsSchemas(report, base, packageManifest.factSchemas || [], { checks: false });
    attachStructuredIO(report, base, packageManifest.structuredIO || [], { checks: false });
    attachOutputContracts(report, base, packageManifest.outputContracts || [], { checks: false });
    attachOutputHandleSetsToGraphReport(report, base, metadata.generatedModules);
    attachStructuredIoHandleSetsToGraphReport(report, base, metadata.generatedModules);
    attachCommandBuffers(report, base, packageManifest.commandBuffers || [], { checks: false });
    if (metadata.manifests.assets && packageManifest.manifests.assets && packageManifest.manifests.assets.exists) {
      try {
        report.generatedHandles = checkGeneratedHandleModules(base);
        if (report.generatedHandles.errors.length) report.errors.push(...report.generatedHandles.errors);
      } catch (err) {
        const message = errorMessage(err);
        report.generatedHandles = { ok: false, files: [], errors: [message] };
        report.errors.push(message);
      }
    }
  } catch (err) {
    report.errors.push(...errorList(err));
    return finalizePackageGraphReport(report);
  }

  try {
    const moduleGraph = analyzePackageModuleGraph(base, metadata.entry, {
      provenancePolicy: metadata.provenanceFlow,
      provenanceContext: provenanceContextForReport(report)
    });
    assignModuleGraphFields(report, moduleGraph);
  } catch (err) {
    if (err.partial) assignModuleGraphFields(report, err.partial);
    report.errors.push(...errorList(err));
  }
  attachProvenanceFlow(report, { checks: false });
  assignPackageGraphOwnership(report, metadata);
  attachResourceCertificate(report, base, metadata, packageManifest, {
    checks: false,
    required: Boolean(options.certificateRequired)
  });
  if (metadata.executionProfile && metadata.entry) {
    try {
      const source = fs.readFileSync(path.join(base, metadata.entry), "utf8");
      const mod = parseAir(source, metadata.entry);
      verifyModule(mod);
      attachRealtimeExecutionProfile(report, mod, metadata, { checks: false });
    } catch (err) {
      report.errors.push(errorMessage(err));
    }
  }

  if ((report.graph.edges || []).length) {
    report.linking = {
      ...(report.linking || {}),
      status: "available",
      output: "linked-wasm-first-slice",
      message: "multi-module authored graphs can produce deterministic linked output through airc build package --linked-wasm"
    };
  }
  if (metadata && metadata.entry) attachPackageAiReview(report, base, metadata, { packageReport: report, emitWarnings: true, releaseCandidate: options.releaseCandidate });
  if (metadata && options.compareBaseline) {
    report.reviewTrend = compareReviewBaseline(report, options.compareBaseline, { policy: metadata.reviewPolicy });
    for (const diagnostic of report.reviewTrend.diagnostics || []) {
      report.diagnostics.push(diagnostic);
      const message = `trend:${diagnostic.code}: ${diagnostic.message}`;
      if (diagnostic.packageStatusImpact === "fail") report.errors.push(message);
      else report.warnings.push(message);
    }
  }
  if (options.profile) report.profile = options.profile;
  return finalizePackageGraphReport(report);
}

function attachFactsSchemas(report, base, factSchemas, options = {}) {
  const refs = (factSchemas || []).slice().sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
  if (!report.facts) report.facts = { schemas: [] };
  for (const ref of refs) {
    const schemaPath = ref && ref.path ? ref.path : null;
    if (!schemaPath) continue;
    let schemaReport;
    if (!ref.exists) {
      const rowsetLike = /\.rowset(?:\.schema)?\.json$/i.test(schemaPath);
      schemaReport = {
        ok: false,
        path: schemaPath,
        exists: false,
        fingerprint: null,
        schemaVersion: null,
        kind: rowsetLike ? "air.boundedRowsetSchema" : "air.factsSchema",
        facts: [],
        rowset: null,
        diagnostics: [{
          code: rowsetLike ? "air.rowset.missing_schema" : "air.facts.schema_missing",
          severity: "fail",
          message: `${rowsetLike ? "rowset" : "facts"} schema file not found: ${schemaPath}`,
          fields: { path: schemaPath }
        }],
        warnings: [],
        errors: [`${rowsetLike ? "rowset" : "facts"} schema file not found: ${schemaPath}`]
      };
    } else {
      schemaReport = validateFactsSchemaFile(path.join(base, schemaPath), { relativePath: schemaPath });
    }
    const summary = factsSchemaSummary(schemaReport);
    report.facts.schemas.push(summary);

    if (options.checks) {
      const checkId = `facts-schema:${schemaPath}`;
      if (!summary.exists) {
        addCheck(report, checkId, "fail", `missing facts schema: ${schemaPath}`, "create the referenced facts schema file or remove factSchemas entry", {
          code: summary.kind === "air.boundedRowsetSchema" ? "air.rowset.missing_schema" : "air.facts.schema_missing",
          fields: { path: schemaPath }
        });
      } else if (summary.errors.length) {
        const rowset = summary.kind === "air.boundedRowsetSchema";
        addCheck(report, checkId, "fail", `${rowset ? "rowset" : "facts"} schema invalid: ${schemaPath}`, rowset ? "fix bounded rowset schema metadata; only fixed-size scalar columns are supported" : "fix bounded facts schema metadata; only fixed-size scalar fact columns are supported", {
          code: rowset ? "air.rowset.schema_invalid" : "air.facts.schema_invalid",
          fields: { path: schemaPath }
        });
        for (const diagnostic of summary.diagnostics.filter((item) => item.severity === "fail")) {
          addCheck(report, checkId, "fail", `${schemaPath}: ${diagnostic.message}`, rowset ? "fix bounded rowset schema metadata; only fixed-size scalar columns are supported" : "fix bounded facts schema metadata; only fixed-size scalar fact columns are supported", {
            code: diagnostic.code,
            fields: { path: schemaPath, ...(diagnostic.fields || {}) }
          });
        }
      } else {
        addCheck(report, checkId, "pass", `facts schema valid: ${schemaPath}`);
      }
      for (const diagnostic of summary.diagnostics.filter((item) => item.severity === "warn")) {
        addCheck(report, checkId, "warn", `${schemaPath}: ${diagnostic.message}`, null, {
          code: diagnostic.code,
          fields: { path: schemaPath, ...(diagnostic.fields || {}) }
        });
      }
    } else {
      report.errors.push(...summary.errors.map((error) => `${schemaPath}: ${error}`));
      report.warnings.push(...summary.warnings.map((warning) => `${schemaPath}: ${warning}`));
      if (Array.isArray(report.diagnostics)) {
        for (const diagnostic of summary.diagnostics) {
          report.diagnostics.push(normalizeDiagnostic({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: `${schemaPath}: ${diagnostic.message}`,
            source: "package-report",
            gateAction: diagnostic.severity === "fail" ? "fail" : (diagnostic.severity === "warn" ? "warn" : null),
            fields: { path: schemaPath, ...(diagnostic.fields || {}) }
          }));
        }
      }
    }
  }
  report.facts.schemas.sort((a, b) => a.path.localeCompare(b.path));
}

function factsSchemaSummary(schemaReport) {
  return {
    path: schemaReport.path,
    exists: schemaReport.exists !== false,
    ok: Boolean(schemaReport.ok),
    kind: schemaReport.kind || "air.factsSchema",
    schemaVersion: schemaReport.schemaVersion || null,
    privacyPolicy: schemaReport.privacyPolicy ? {
      defaultClassification: schemaReport.privacyPolicy.defaultClassification || null,
      forbiddenByDefault: sortedStrings(schemaReport.privacyPolicy.forbiddenByDefault || [])
    } : null,
    fingerprint: schemaReport.fingerprint || null,
    rowset: schemaReport.rowset ? {
      name: schemaReport.rowset.name,
      kind: schemaReport.rowset.kind,
      layout: schemaReport.rowset.layout,
      maxRows: schemaReport.rowset.maxRows,
      columnCount: schemaReport.rowset.columnCount,
      storage: schemaReport.rowset.storage || null,
      columns: (schemaReport.rowset.columns || []).map((column) => ({
        name: column.name,
        type: column.type,
        enum: column.enum || null,
        range: column.range || null,
        storageHint: column.storageHint || null,
        privacy: column.privacy || null,
        flowLabel: column.flowLabel || null
      })).sort((a, b) => a.name.localeCompare(b.name))
    } : null,
    facts: (schemaReport.facts || []).map((fact) => ({
      id: fact.id,
      name: fact.name,
      maxRows: fact.maxRows,
      columnCount: fact.columnCount,
      columns: (fact.columns || []).map((column) => ({
        name: column.name,
        type: column.type,
        enum: column.enum || null,
        semantic: column.semantic || null,
        storageHint: column.storageHint || null,
        range: column.range || null,
        privacy: column.privacy || null,
        flowLabel: column.flowLabel || null
      })).sort((a, b) => a.name.localeCompare(b.name)),
      capability: fact.capability || null,
      privacy: fact.privacy || null
    })).sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics: (schemaReport.diagnostics || []).map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      fields: diagnostic.fields || {}
    })).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message))),
    warnings: sortedStrings(schemaReport.warnings || []),
    errors: sortedStrings(schemaReport.errors || [])
  };
}

function attachStructuredIO(report, base, structuredIO, options = {}) {
  const refs = (structuredIO || []).slice().sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
  if (!report.structuredIO) report.structuredIO = { schemas: [], handleSets: [] };
  for (const ref of refs) {
    const schemaPath = ref && ref.path ? ref.path : null;
    if (!schemaPath) continue;
    let schemaReport;
    if (!ref.exists) {
      schemaReport = {
        ok: false,
        path: schemaPath,
        exists: false,
        fingerprint: null,
        schemaVersion: null,
        kind: null,
        name: null,
        maxRows: null,
        fields: [],
        privacyPolicy: null,
        diagnostics: [{
          code: "air.structured_io.schema_invalid",
          severity: "fail",
          message: `structured IO schema file not found: ${schemaPath}`,
          fields: { path: schemaPath }
        }],
        warnings: [],
        errors: [`structured IO schema file not found: ${schemaPath}`]
      };
    } else {
      schemaReport = validateStructuredIoSchemaFile(path.join(base, schemaPath), { relativePath: schemaPath });
    }
    const summary = structuredIoSummary(schemaReport);
    report.structuredIO.schemas.push(summary);

    if (options.checks) {
      const checkId = `structured-io:${schemaPath}`;
      if (!summary.exists) {
        addCheck(report, checkId, "fail", `missing structured IO schema: ${schemaPath}`, "create the referenced structured IO schema file or remove structuredIO entry", {
          code: "air.structured_io.schema_invalid",
          fields: { path: schemaPath }
        });
      } else if (summary.errors.length) {
        addCheck(report, checkId, "fail", `structured IO schema invalid: ${schemaPath}`, "fix structured IO metadata; only fixed bounded scalar fields are supported", {
          code: "air.structured_io.schema_invalid",
          fields: { path: schemaPath }
        });
        for (const diagnostic of summary.diagnostics.filter((item) => item.severity === "fail")) {
          addCheck(report, checkId, "fail", `${schemaPath}: ${diagnostic.message}`, "fix structured IO metadata; reject runtime JSON, objects, strings, and unbounded rowsets", {
            code: diagnostic.code,
            fields: { path: schemaPath, ...(diagnostic.fields || {}) }
          });
        }
      } else {
        addCheck(report, checkId, "pass", `structured IO schema valid: ${schemaPath}`);
      }
      for (const diagnostic of summary.diagnostics.filter((item) => item.severity === "warn")) {
        addCheck(report, checkId, "warn", `${schemaPath}: ${diagnostic.message}`, null, {
          code: diagnostic.code,
          fields: { path: schemaPath, ...(diagnostic.fields || {}) }
        });
      }
    } else {
      report.errors.push(...summary.errors.map((error) => `${schemaPath}: ${error}`));
      report.warnings.push(...summary.warnings.map((warning) => `${schemaPath}: ${warning}`));
      if (Array.isArray(report.diagnostics)) {
        for (const diagnostic of summary.diagnostics) {
          report.diagnostics.push(normalizeDiagnostic({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: `${schemaPath}: ${diagnostic.message}`,
            source: "package-report",
            gateAction: diagnostic.severity === "fail" ? "fail" : (diagnostic.severity === "warn" ? "warn" : null),
            fields: { path: schemaPath, ...(diagnostic.fields || {}) }
          }));
        }
      }
    }
  }
  report.structuredIO.schemas.sort((a, b) => a.path.localeCompare(b.path));
}

function structuredIoSummary(schemaReport) {
  return {
    path: schemaReport.path,
    exists: schemaReport.exists !== false,
    ok: Boolean(schemaReport.ok),
    kind: schemaReport.kind || null,
    schemaVersion: schemaReport.schemaVersion || null,
    name: schemaReport.name || null,
    maxRows: schemaReport.maxRows || null,
    fieldCount: (schemaReport.fields || []).length,
    fields: (schemaReport.fields || []).map((field) => ({
      name: field.name,
      type: field.type,
      privacy: field.privacy || null,
      classification: field.classification || null,
      semantic: field.semantic || null,
      flowLabel: field.flowLabel || null
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    privacyPolicy: schemaReport.privacyPolicy || null,
    fingerprint: schemaReport.fingerprint || null,
    diagnostics: (schemaReport.diagnostics || []).map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      fields: diagnostic.fields || {}
    })).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message))),
    warnings: sortedStrings(schemaReport.warnings || []),
    errors: sortedStrings(schemaReport.errors || [])
  };
}

function attachOutputContracts(report, base, outputContracts, options = {}) {
  const refs = (outputContracts || []).slice().sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
  if (!report.outputContracts) report.outputContracts = { schemas: [] };
  for (const ref of refs) {
    const contractPath = ref && ref.path ? ref.path : null;
    if (!contractPath) continue;
    let contractReport;
    if (!ref.exists) {
      contractReport = {
        ok: false,
        path: contractPath,
        exists: false,
        fingerprint: null,
        schemaVersion: null,
        kind: null,
        outputs: [],
        diagnostics: [{
          code: "air.output_contract.schema_invalid",
          severity: "fail",
          message: `output contract file not found: ${contractPath}`
        }],
        warnings: [],
        errors: [`output contract file not found: ${contractPath}`]
      };
    } else {
      contractReport = validateOutputContractSchemaFile(path.join(base, contractPath), { relativePath: contractPath });
    }
    const summary = outputContractSummary(contractReport);
    report.outputContracts.schemas.push(summary);

    if (options.checks) {
      const checkId = `output-contract:${contractPath}`;
      if (!summary.exists) {
        addCheck(report, checkId, "fail", `missing output contract: ${contractPath}`, "create the referenced output contract file or remove outputContracts entry", {
          code: "air.output_contract.schema_invalid",
          fields: { path: contractPath }
        });
      } else if (summary.errors.length) {
        addCheck(report, checkId, "fail", `output contract invalid: ${contractPath}`, "fix output contract metadata; v0.18 supports tooling-only scalar output intents", {
          code: "air.output_contract.schema_invalid",
          fields: { path: contractPath }
        });
        for (const diagnostic of summary.diagnostics.filter((item) => item.severity === "fail")) {
          addCheck(report, checkId, "fail", `${contractPath}: ${diagnostic.message}`, "fix output contract metadata; v0.18 supports tooling-only scalar output intents", {
            code: diagnostic.code,
            fields: { path: contractPath }
          });
        }
      } else {
        addCheck(report, checkId, "pass", `output contract valid: ${contractPath}`);
      }
      for (const diagnostic of summary.diagnostics.filter((item) => item.severity === "warn")) {
        addCheck(report, checkId, "warn", `${contractPath}: ${diagnostic.message}`, null, {
          code: diagnostic.code,
          fields: { path: contractPath }
        });
      }
    } else {
      report.errors.push(...summary.errors.map((error) => `${contractPath}: ${error}`));
      report.warnings.push(...summary.warnings.map((warning) => `${contractPath}: ${warning}`));
      if (Array.isArray(report.diagnostics)) {
        for (const diagnostic of summary.diagnostics) {
          report.diagnostics.push(normalizeDiagnostic({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: `${contractPath}: ${diagnostic.message}`,
            source: "package-report",
            gateAction: diagnostic.severity === "fail" ? "fail" : (diagnostic.severity === "warn" ? "warn" : null),
            fields: { path: contractPath }
          }));
        }
      }
    }
  }
  report.outputContracts.schemas.sort((a, b) => a.path.localeCompare(b.path));
}

function outputContractSummary(contractReport) {
  return {
    path: contractReport.path,
    exists: contractReport.exists !== false,
    ok: Boolean(contractReport.ok),
    schemaVersion: contractReport.schemaVersion || null,
    kind: contractReport.kind || null,
    fingerprint: contractReport.fingerprint || null,
    outputsCount: (contractReport.outputs || []).length,
    channels: sortedStrings((contractReport.outputs || []).map((output) => output.channel).filter(Boolean)),
    capabilities: sortedStrings((contractReport.outputs || []).map((output) => output.capability).filter(Boolean)),
    outputs: (contractReport.outputs || []).map((output) => ({
      id: output.id,
      name: output.name,
      channel: output.channel,
      capability: output.capability,
      argCount: output.argCount,
      args: (output.args || []).map((arg) => ({
        name: arg.name,
        type: arg.type,
        flowLabel: arg.flowLabel || null
      })).sort((a, b) => a.name.localeCompare(b.name)),
      resources: (output.resources || []).slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      profileConstraints: (output.profileConstraints || []).slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      experimental: Boolean(output.experimental)
    })).sort((a, b) => a.id - b.id || a.name.localeCompare(b.name)),
    diagnostics: (contractReport.diagnostics || []).map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message
    })).sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message)),
    warnings: sortedStrings(contractReport.warnings || []),
    errors: sortedStrings(contractReport.errors || [])
  };
}

function attachOutputEmitValidation(report, base, metadata, profile) {
  const modules = readPackageModulesForOutputEmit(base, metadata, report);
  const outputContracts = outputEmitContractMap(report.outputContracts && report.outputContracts.schemas);
  const outputHandlePolicyActive = hasOutputHandleGeneratedModule(metadata.generatedModules);
  const outputHandleById = outputHandleMapById(report.outputHandleSets || []);
  const diagnostics = [];
  const used = [];
  let emitCount = 0;

  for (const moduleInfo of modules) {
    const mod = moduleInfo.mod;
    const hasExtern = (mod.externs || []).some((ex) => ex.name === "output.emit");
    const calls = outputEmitCalls(mod, moduleInfo.path);
    if (!hasExtern && calls.length === 0) continue;

    if (!report.hostImports.used.includes("output.emit")) report.hostImports.used.push("output.emit");
    addCapabilityOrigin(report, "output", moduleInfo.path);

    emitCount += calls.length;

    if (metadata.hostAbi !== "0.11") {
      addOutputEmitDiagnostic(diagnostics, "air.output_emit.host_abi_unsupported", `output.emit requires package hostAbi 0.11; found ${metadata.hostAbi || "none"}`, { module: moduleInfo.path, hostAbi: metadata.hostAbi || null });
    }

    if (profile) {
      const supportsOutputEmit = profile.hostAbi === "0.11"
        && (profile.supports.hostImports.includes("output.emit") || profile.supports.capabilities.includes("output"));
      if (!supportsOutputEmit) {
        addOutputEmitDiagnostic(diagnostics, "air.output_emit.profile_unsupported", `host profile ${profile.id} does not support output.emit`, { module: moduleInfo.path, profile: profile.id, profileHostAbi: profile.hostAbi });
      }
    }

    if (!mod.capabilities.has("output") || !(metadata.capabilities || []).includes("output")) {
      addOutputEmitDiagnostic(diagnostics, "air.output_emit.capability_missing", `output.emit requires capability output in AIR source and air.package.json`, { module: moduleInfo.path });
    }

    for (const ex of mod.externs || []) {
      if (ex.name !== "output.emit") continue;
      const params = (ex.params || []).map((param) => param.type);
      if (params.join(",") !== "i32,i32,i32,i32,i32" || ex.returnType !== "i32") {
        addOutputEmitDiagnostic(diagnostics, "air.output_emit.args_invalid", `extern output.emit must be (i32, i32, i32, i32, i32) -> i32`, { module: moduleInfo.path });
      }
    }

    const budgetStatus = outputEmitBudgetStatus(mod, calls.length);
    if (!budgetStatus.ok) {
      addOutputEmitDiagnostic(diagnostics, "air.output_emit.budget_exceeded", budgetStatus.message, { module: moduleInfo.path, calls: calls.length });
    }

    for (const call of calls) {
      if (call.outputId === undefined) {
        addOutputEmitDiagnostic(diagnostics, "air.output_emit.output_id_dynamic", `output.emit output_id must be a literal or module constant in v0.26`, { module: moduleInfo.path, function: call.function, line: call.loc && call.loc.line || null });
        continue;
      }
      const contract = outputContracts.get(call.outputId);
      if (!contract) {
        addOutputEmitDiagnostic(diagnostics, "air.output_emit.output_id_invalid", `output.emit output_id ${call.outputId} is not declared by outputContracts`, { module: moduleInfo.path, function: call.function, outputId: call.outputId, line: call.loc && call.loc.line || null });
        continue;
      }
      if (outputHandlePolicyActive && !callUsesCanonicalOutputHandle(call, outputHandleById)) {
        const expectedHandle = outputHandleById.get(call.outputId) || null;
        const actual = call.outputIdArgName || String(call.outputId);
        addOutputEmitDiagnostic(diagnostics, "air.output_emit.output_handle_required", `output.emit output_id should use generated OUTPUT_* handle${expectedHandle ? ` ${expectedHandle}` : ""} instead of ${call.outputIdArgKind === "literal" ? "a raw numeric literal" : "a non-canonical constant"}`, {
          module: moduleInfo.path,
          function: call.function,
          outputId: call.outputId,
          outputName: contract.name,
          expectedHandle,
          actual,
          line: call.loc && call.loc.line || null
        });
      }
      call.outputName = contract.name;
      call.outputCapability = contract.capability || null;
      call.outputArgCount = Number.isInteger(contract.argCount) ? contract.argCount : null;
      if (!outputEmitContractShapeIsI32(contract) || !outputEmitCallArgsMatchContract(call, contract)) {
        addOutputEmitDiagnostic(diagnostics, "air.output_emit.args_invalid", `output.emit args must match output contract ${contract.name} with up to four i32 scalar args`, { module: moduleInfo.path, function: call.function, outputId: call.outputId, outputName: contract.name, line: call.loc && call.loc.line || null });
      }
    }

    used.push({
      module: moduleInfo.path,
      calls: calls.map((call) => ({
        function: call.function,
        line: call.loc && call.loc.line || null,
        outputId: call.outputId === undefined ? null : call.outputId,
        outputName: call.outputName || null,
        outputCapability: call.outputCapability || null,
        outputArgCount: Number.isInteger(call.outputArgCount) ? call.outputArgCount : null,
        status: call.status
      }))
    });
  }

  if (!used.length) return;
  const sortedDiagnostics = diagnostics.slice().sort(compareOutputEmitDiagnostics);
  report.outputEmit = {
    used: used.sort((a, b) => a.module.localeCompare(b.module)),
    diagnostics: sortedDiagnostics.map(({ key: _key, ...diagnostic }) => diagnostic)
  };

  if (diagnostics.length) {
    for (const diagnostic of sortedDiagnostics) {
      addCheck(report, `output-emit:${diagnostic.code}:${diagnostic.fields.module || "package"}:${diagnostic.fields.line || 0}`, "fail", diagnostic.message, outputEmitRepairHint(diagnostic), {
        code: diagnostic.code,
        module: diagnostic.fields.module || null,
        line: diagnostic.fields.line || null,
        fields: diagnostic.fields
      });
    }
  } else {
    addCheck(report, "output-emit", "pass", `output.emit validation passed for ${emitCount} call(s)`);
  }
}

function readPackageModulesForOutputEmit(base, metadata, report) {
  const relPaths = new Set();
  for (const item of report.modules || []) {
    if (item && item.path) relPaths.add(item.path);
  }
  if (metadata && metadata.entry) relPaths.add(metadata.entry);
  const modules = [];
  for (const rel of Array.from(relPaths).sort()) {
    const absolute = path.join(base, rel);
    if (!fs.existsSync(absolute)) continue;
    let source;
    try {
      source = fs.readFileSync(absolute, "utf8");
    } catch (_err) {
      continue;
    }
    if (!source.includes("output.emit")) continue;
    try {
      modules.push({ path: rel, mod: parseAir(source, rel, { resolveSourceImports: false }) });
    } catch (_err) {
      continue;
    }
  }
  return modules;
}

function outputEmitContractMap(schemas) {
  const out = new Map();
  for (const schema of schemas || []) {
    if (!schema || !schema.ok) continue;
    for (const output of schema.outputs || []) {
      if (!out.has(output.id)) out.set(output.id, output);
    }
  }
  return out;
}

function outputEmitCalls(mod, modulePath) {
  const constants = outputEmitModuleConstants(mod);
  const calls = [];
  for (const fn of mod.functions || []) {
    const valueTypes = new Map((fn.params || []).map((param) => [param.name, param.type]));
    const constValues = new Map();
    for (const block of fn.blocks || []) {
      for (const ins of block.instructions || []) {
        if (ins.result) {
          valueTypes.set(ins.result, ins.resultType);
          if (ins.op && ins.op.startsWith("const.")) {
            constValues.set(ins.result, numericArgValue(ins.args && ins.args[0], constants, constValues));
          }
        }
        if (ins.op !== "call" || ins.callee !== "output.emit") continue;
        const outputIdRef = outputEmitOutputIdRef(ins.args && ins.args[0], constants);
        const outputId = outputIdRef ? outputIdRef.value : undefined;
        const argTypes = (ins.args || []).map((arg) => inferOutputEmitArgType(arg, valueTypes, constants));
        const argValues = (ins.args || []).map((arg) => numericArgValue(arg, constants, constValues));
        calls.push({
          module: modulePath,
          function: fn.name,
          loc: ins.loc || null,
          args: ins.args || [],
          argTypes,
          argValues,
          outputId,
          outputIdArgKind: outputIdRef ? outputIdRef.kind : "dynamic",
          outputIdArgName: outputIdRef ? outputIdRef.name : null,
          outputName: null,
          status: outputId === undefined ? "dynamic" : "static"
        });
      }
    }
  }
  return calls;
}

function outputEmitModuleConstants(mod) {
  const constants = new Map();
  for (const constant of mod.constants || []) {
    if (constant.type === "i32" && constant.value && constant.value.kind === "number") {
      constants.set(constant.name, { type: constant.type, value: constant.value.value });
    }
  }
  return constants;
}

function outputEmitOutputIdRef(arg, constants) {
  if (!arg) return undefined;
  if (arg.kind === "number" && Number.isInteger(arg.value)) return { kind: "literal", name: null, value: arg.value };
  if (arg.kind === "symbol" && constants.has(arg.name)) return { kind: "symbol", name: arg.name, value: constants.get(arg.name).value };
  return undefined;
}

function outputHandleMapById(outputHandleSets) {
  const out = new Map();
  for (const set of outputHandleSets || []) {
    for (const output of set.outputs || []) {
      if (Number.isInteger(output.id) && typeof output.handle === "string" && output.handle.startsWith("OUTPUT_")) {
        out.set(output.id, output.handle);
      }
    }
  }
  return out;
}

function callUsesCanonicalOutputHandle(call, outputHandleById) {
  if (call.outputIdArgKind !== "symbol") return false;
  if (!call.outputIdArgName || !call.outputIdArgName.startsWith("OUTPUT_")) return false;
  const expected = outputHandleById.get(call.outputId);
  return !expected || expected === call.outputIdArgName;
}

function inferOutputEmitArgType(arg, valueTypes, constants) {
  if (!arg) return null;
  if (arg.kind === "number") return Number.isInteger(arg.value) ? "i32" : "f32";
  if (arg.kind === "value") return valueTypes.get(arg.name) || null;
  if (arg.kind === "symbol") {
    if (constants.has(arg.name)) return constants.get(arg.name).type;
    return valueTypes.get(arg.name) || null;
  }
  return null;
}

function numericArgValue(arg, constants, constValues) {
  if (!arg) return undefined;
  if (arg.kind === "number") return arg.value;
  if (arg.kind === "symbol" && constants.has(arg.name)) return constants.get(arg.name).value;
  if (arg.kind === "value" && constValues && constValues.has(arg.name)) return constValues.get(arg.name);
  return undefined;
}

function outputEmitBudgetStatus(mod, calls) {
  if (calls === 0) return { ok: true, message: "" };
  const budgets = mod.effects || [];
  const direct = budgets.find((budget) => budget.key === "output.emit");
  const wildcard = budgets.find((budget) => budget.key === "output.*");
  const budget = direct || wildcard;
  if (!budget) {
    return { ok: false, message: "output.emit requires an explicit effect budget such as effects { output.emit <= N }" };
  }
  if (!outputEmitBudgetSatisfies(calls, budget.op || "<=", budget.limit)) {
    return { ok: false, message: `output.emit budget ${budget.key} ${budget.op || "<="} ${budget.limit} is not satisfied by actual calls ${calls}` };
  }
  return { ok: true, message: "" };
}

function outputEmitBudgetSatisfies(actual, op, limit) {
  if (op === "<=") return actual <= limit;
  if (op === "<") return actual < limit;
  if (op === ">=") return actual >= limit;
  if (op === ">") return actual > limit;
  if (op === "==") return actual === limit;
  return actual <= limit;
}

function outputEmitContractShapeIsI32(contract) {
  if (!contract || !Number.isInteger(contract.argCount) || contract.argCount > 4) return false;
  return (contract.args || []).every((arg) => arg.type === "i32");
}

function outputEmitCallArgsMatchContract(call, contract) {
  if ((call.args || []).length !== 5) return false;
  for (let idx = 1; idx <= contract.argCount; idx += 1) {
    if (call.argTypes[idx] !== "i32") return false;
  }
  for (let idx = contract.argCount + 1; idx <= 4; idx += 1) {
    if (call.argValues[idx] !== 0) return false;
  }
  return true;
}

function addOutputEmitDiagnostic(diagnostics, code, message, fields = {}) {
  const key = `${code}:${message}:${JSON.stringify(fields)}`;
  if (diagnostics.some((item) => item.key === key)) return;
  diagnostics.push({
    key,
    code,
    severity: "fail",
    message,
    fields
  });
}

function compareOutputEmitDiagnostics(a, b) {
  return a.code.localeCompare(b.code)
    || String(a.fields.module || "").localeCompare(String(b.fields.module || ""))
    || Number(a.fields.line || 0) - Number(b.fields.line || 0)
    || a.message.localeCompare(b.message);
}

function outputEmitRepairHint(diagnostic) {
  switch (diagnostic.code) {
    case "air.output_emit.host_abi_unsupported":
      return "set package hostAbi to 0.11 only for packages that intentionally use bounded output.emit";
    case "air.output_emit.profile_unsupported":
      return "use a Host ABI 0.11 profile that supports output.emit, or remove output.emit";
    case "air.output_emit.capability_missing":
      return "declare capability output in AIR source and air.package.json";
    case "air.output_emit.budget_exceeded":
      return "add or raise effects { output.emit <= N } for the bounded emit count";
    case "air.output_emit.output_id_dynamic":
      return "use a literal output id or i32 module constant generated from output contracts";
    case "air.output_emit.output_handle_required":
      return "run: node bin/airc.js generate output-handles <package-dir>, then call output.emit with the generated OUTPUT_* handle constant";
    case "air.output_emit.output_id_invalid":
      return "declare the output id in outputContracts or use a generated output handle";
    case "air.output_emit.args_invalid":
      return "use the exact output.emit i32 scalar signature and match the output contract args";
    default:
      return "fix output.emit package/profile validation errors";
  }
}

function attachStateHandleSets(report, base, generatedModules) {
  const stateHandlesReferenced = hasStateHandleGeneratedModule(generatedModules);
  if (!stateHandlesReferenced) {
    report.stateHandleSets = [];
    addCheck(report, "state-handles", "skip", "no package-declared generated state handle module");
    return;
  }
  const handleReport = checkGeneratedStateHandles(base, { generatedModules });
  report.stateHandleSets = handleReport.sets || [];
  if (handleReport.ok) {
    addCheck(report, "state-handles", "pass", "generated state handles are fresh");
    return;
  }
  for (const diagnostic of handleReport.diagnostics || []) {
    addCheck(report, "state-handles", "fail", diagnostic.message, stateHandleRepairHint(diagnostic), {
      code: diagnostic.code,
      fields: diagnostic.fields || {}
    });
  }
}

function attachOutputHandleSets(report, base, generatedModules) {
  const outputHandlesReferenced = hasOutputHandleGeneratedModule(generatedModules);
  if (!outputHandlesReferenced) {
    report.outputHandleSets = [];
    addCheck(report, "output-handles", "skip", "no package-declared generated output handle module");
    return;
  }
  const handleReport = checkGeneratedOutputHandles(base, { generatedModules });
  report.outputHandleSets = handleReport.sets || [];
  if (handleReport.ok) {
    addCheck(report, "output-handles", "pass", "generated output handles are fresh");
    return;
  }
  for (const diagnostic of handleReport.diagnostics || []) {
    addCheck(report, "output-handles", "fail", diagnostic.message, outputHandleRepairHint(diagnostic), {
      code: diagnostic.code,
      fields: diagnostic.fields || {}
    });
  }
}

function attachStructuredIoHandleSets(report, base, generatedModules) {
  const structuredIoHandlesReferenced = hasStructuredIoHandleGeneratedModule(generatedModules);
  if (!report.structuredIO) report.structuredIO = { schemas: [], handleSets: [] };
  if (!structuredIoHandlesReferenced) {
    report.structuredIO.handleSets = [];
    addCheck(report, "structured-io-handles", "skip", "no package-declared generated structured IO handle module");
    return;
  }
  const handleReport = checkGeneratedStructuredIoHandles(base, { generatedModules });
  report.structuredIO.handleSets = handleReport.sets || [];
  if (handleReport.ok) {
    addCheck(report, "structured-io-handles", "pass", "generated structured IO handles are fresh");
    return;
  }
  for (const diagnostic of handleReport.diagnostics || []) {
    addCheck(report, "structured-io-handles", "fail", diagnostic.message, structuredIoRepairHint(diagnostic), {
      code: diagnostic.code,
      fields: diagnostic.fields || {}
    });
  }
}

function attachOutputHandleSetsToGraphReport(report, base, generatedModules) {
  if (!hasOutputHandleGeneratedModule(generatedModules)) {
    report.outputHandleSets = [];
    return;
  }
  const handleReport = checkGeneratedOutputHandles(base, { generatedModules });
  report.outputHandleSets = handleReport.sets || [];
  if (!handleReport.ok) {
    report.errors.push(...(handleReport.errors || []));
    for (const diagnostic of handleReport.diagnostics || []) {
      report.diagnostics.push(normalizeDiagnostic({
        ...diagnostic,
        source: diagnostic.source || "package-report",
        gateAction: "fail"
      }));
    }
  }
}

function attachStructuredIoHandleSetsToGraphReport(report, base, generatedModules) {
  if (!report.structuredIO) report.structuredIO = { schemas: [], handleSets: [] };
  if (!hasStructuredIoHandleGeneratedModule(generatedModules)) {
    report.structuredIO.handleSets = [];
    return;
  }
  const handleReport = checkGeneratedStructuredIoHandles(base, { generatedModules });
  report.structuredIO.handleSets = handleReport.sets || [];
  if (!handleReport.ok) {
    report.errors.push(...(handleReport.errors || []));
    for (const diagnostic of handleReport.diagnostics || []) {
      report.diagnostics.push(normalizeDiagnostic({
        ...diagnostic,
        source: diagnostic.source || "package-report",
        gateAction: "fail"
      }));
    }
  }
}

function attachStateHandleSetsToGraphReport(report, base, generatedModules) {
  if (!hasStateHandleGeneratedModule(generatedModules)) {
    report.stateHandleSets = [];
    return;
  }
  const handleReport = checkGeneratedStateHandles(base, { generatedModules });
  report.stateHandleSets = handleReport.sets || [];
  if (!handleReport.ok) {
    report.errors.push(...(handleReport.errors || []));
    for (const diagnostic of handleReport.diagnostics || []) {
      report.diagnostics.push(normalizeDiagnostic({
        ...diagnostic,
        source: diagnostic.source || "package-report",
        gateAction: "fail"
      }));
    }
  }
}

function attachStateAccessorPolicies(report, base) {
  const policyReport = checkStateAccessorPolicies(base);
  report.stateAccessorPolicies = policyReport.policies || [];
  if (!policyReport.policies.length) {
    addCheck(report, "state-accessor-policy", "skip", "no state accessor policy file");
    return;
  }
  if (policyReport.ok) {
    addCheck(report, "state-accessor-policy", "pass", "state accessor policy is valid");
    return;
  }
  for (const diagnostic of policyReport.diagnostics || []) {
    addCheck(report, "state-accessor-policy", "fail", diagnostic.message, stateAccessorPolicyRepairHint(diagnostic), {
      code: diagnostic.code,
      fields: diagnostic.fields || {}
    });
  }
}

function attachStateAccessorPoliciesToGraphReport(report, base) {
  const policyReport = checkStateAccessorPolicies(base);
  report.stateAccessorPolicies = policyReport.policies || [];
  if (!policyReport.ok) {
    report.errors.push(...(policyReport.errors || []));
    for (const diagnostic of policyReport.diagnostics || []) {
      report.diagnostics.push(normalizeDiagnostic({
        ...diagnostic,
        source: diagnostic.source || "package-report",
        gateAction: "fail"
      }));
    }
  }
}

function hasStateHandleGeneratedModule(generatedModules) {
  return (generatedModules || []).some((item) => String(item.path || item || "").replace(/\\/g, "/") === "generated/state_handles.air");
}

function hasOutputHandleGeneratedModule(generatedModules) {
  return (generatedModules || []).some((item) => String(item.path || item || "").replace(/\\/g, "/") === "generated/output_handles.air");
}

function hasStructuredIoHandleGeneratedModule(generatedModules) {
  return (generatedModules || []).some((item) => String(item.path || item || "").replace(/\\/g, "/") === "generated/structured_io_handles.air");
}

function outputHandleRepairHint(diagnostic) {
  if (diagnostic && diagnostic.code === "air.generated.output_handles_missing") {
    return "run: node bin/airc.js generate output-handles <package-dir>, then declare generated/output_handles.air in generatedModules";
  }
  if (diagnostic && diagnostic.code === "air.generated.output_metadata_invalid") {
    return "regenerate generated/output_handles.air and generated/output_handles.meta.json from current outputContracts";
  }
  return "run: node bin/airc.js generate output-handles <package-dir>";
}

function structuredIoRepairHint(_diagnostic) {
  return "run: node bin/airc.js generate structured-io <package-dir>, then declare generated/structured_io_handles.air in generatedModules";
}

function stateAccessorPolicyRepairHint(diagnostic) {
  if (!diagnostic) return "fix state_accessors.policy.json";
  if (diagnostic.code === "air.state.accessor_missing") return "add the package-authored helper function or remove it from state_accessors.policy.json";
  if (diagnostic.code === "air.state.accessor_unknown_state") return "reference an existing fixed state segment declared in AIR source";
  if (diagnostic.code === "air.state.accessor_export_mismatch") return "mark the helper export func or set exported:false in state_accessors.policy.json";
  if (diagnostic.code === "air.state.accessor_not_observation_safe") return "keep state accessor helpers observation-only: no state.set, memory/global writes, host imports, command/output calls, or unknown calls";
  if (diagnostic.code === "air.state.accessor_return_invalid") return "return i32/i64/f32/f64/bool only and do not expose ptr/slice/reference parameters";
  return "fix state_accessors.policy.json schema and helper metadata";
}

function stateHandleRepairHint(diagnostic) {
  if (diagnostic && diagnostic.code === "air.generated.state_handles_missing") {
    return "run: node bin/airc.js generate state-handles <package-dir>, then declare generated/state_handles.air in generatedModules";
  }
  if (diagnostic && diagnostic.code === "air.generated.state_metadata_invalid") {
    return "regenerate generated/state_handles.air and generated/state_handles.meta.json from current state declarations";
  }
  return "run: node bin/airc.js generate state-handles <package-dir>";
}

function attachCommandBuffers(report, base, commandBuffers, options = {}) {
  const refs = (commandBuffers || []).slice().sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
  if (!report.commandBuffers) report.commandBuffers = { schemas: [], outputIntentUsage: [] };
  const outputContracts = (((report.outputContracts || {}).schemas) || []).filter((schema) => schema.ok);
  for (const ref of refs) {
    const bufferPath = ref && ref.path ? ref.path : null;
    if (!bufferPath) continue;
    let bufferReport;
    if (!ref.exists) {
      bufferReport = {
        ok: false,
        path: bufferPath,
        exists: false,
        fingerprint: null,
        schemaVersion: null,
        kind: null,
        name: null,
        maxCommands: null,
        records: [],
        usedOutputIds: [],
        diagnostics: [{
          code: "air.command_buffer.schema_invalid",
          severity: "fail",
          message: `command buffer file not found: ${bufferPath}`,
          fields: { path: bufferPath }
        }],
        warnings: [],
        errors: [`command buffer file not found: ${bufferPath}`]
      };
    } else {
      bufferReport = validateCommandBufferSchemaFile(path.join(base, bufferPath), {
        relativePath: bufferPath,
        outputContracts,
        outputContractsDeclared: outputContracts.length > 0
      });
    }
    const summary = commandBufferSummary(bufferReport);
    report.commandBuffers.schemas.push(summary);

    if (options.checks) {
      const checkId = `command-buffer:${bufferPath}`;
      if (!summary.exists) {
        addCheck(report, checkId, "fail", `missing command buffer: ${bufferPath}`, "create the referenced command buffer file or remove commandBuffers entry", {
          code: "air.command_buffer.schema_invalid",
          fields: { path: bufferPath }
        });
      } else if (summary.errors.length) {
        addCheck(report, checkId, "fail", `command buffer invalid: ${bufferPath}`, "fix command buffer metadata; records must be bounded scalar output intents declared by outputContracts", {
          code: "air.command_buffer.schema_invalid",
          fields: { path: bufferPath }
        });
        for (const diagnostic of summary.diagnostics.filter((item) => item.severity === "fail")) {
          addCheck(report, checkId, "fail", `${bufferPath}: ${diagnostic.message}`, "fix command buffer metadata; records must be bounded scalar output intents declared by outputContracts", {
            code: diagnostic.code,
            fields: { path: bufferPath, ...(diagnostic.fields || {}) }
          });
        }
      } else {
        addCheck(report, checkId, "pass", `command buffer valid: ${bufferPath}`);
      }
    } else {
      report.errors.push(...summary.errors.map((error) => `${bufferPath}: ${error}`));
      report.warnings.push(...summary.warnings.map((warning) => `${bufferPath}: ${warning}`));
      if (Array.isArray(report.diagnostics)) {
        for (const diagnostic of summary.diagnostics) {
          report.diagnostics.push(normalizeDiagnostic({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: `${bufferPath}: ${diagnostic.message}`,
            source: "package-report",
            gateAction: diagnostic.severity === "fail" ? "fail" : (diagnostic.severity === "warn" ? "warn" : null),
            fields: { path: bufferPath, ...(diagnostic.fields || {}) }
          }));
        }
      }
    }
  }
  report.commandBuffers.schemas.sort((a, b) => a.path.localeCompare(b.path));
  report.commandBuffers.outputIntentUsage = commandBufferUsage(report.commandBuffers.schemas);
}

function commandBufferSummary(bufferReport) {
  return {
    path: bufferReport.path,
    exists: bufferReport.exists !== false,
    ok: Boolean(bufferReport.ok),
    schemaVersion: bufferReport.schemaVersion || null,
    kind: bufferReport.kind || null,
    name: bufferReport.name || null,
    fingerprint: bufferReport.fingerprint || null,
    maxCommands: bufferReport.maxCommands || null,
    recordCount: (bufferReport.records || []).length,
    usedOutputIds: (bufferReport.usedOutputIds || []).slice().sort((a, b) => a - b),
    records: (bufferReport.records || []).map((record) => ({
      index: record.index,
      output_id: record.output_id,
      arg0: record.arg0,
      arg1: record.arg1,
      arg2: record.arg2,
      arg3: record.arg3
    })).sort((a, b) => a.index - b.index),
    diagnostics: (bufferReport.diagnostics || []).map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      fields: diagnostic.fields || {}
    })).sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message)),
    warnings: sortedStrings(bufferReport.warnings || []),
    errors: sortedStrings(bufferReport.errors || [])
  };
}

function commandBufferUsage(schemas) {
  const byId = new Map();
  for (const schema of schemas || []) {
    for (const id of schema.usedOutputIds || []) {
      const current = byId.get(id) || { output_id: id, buffers: [], recordCount: 0 };
      current.buffers.push(schema.path);
      current.recordCount += (schema.records || []).filter((record) => record.output_id === id).length;
      byId.set(id, current);
    }
  }
  return Array.from(byId.values()).map((usage) => ({
    output_id: usage.output_id,
    buffers: sortedStrings(Array.from(new Set(usage.buffers))),
    recordCount: usage.recordCount
  })).sort((a, b) => a.output_id - b.output_id);
}

function applyAiReviewPolicy(report, policy, options = {}) {
  const failOn = (policy && Array.isArray(policy.failOn)) ? policy.failOn.slice().sort() : [];
  const aiWarnings = aiReviewWarningsForPolicy(report);
  const releaseCandidate = isReviewPolicyReleaseCandidate(policy, options);
  for (const waiver of (report.reviewPolicyReport && report.reviewPolicyReport.waivers) || []) {
    if (waiver.status === "ignored") {
      addCheck(
        report,
        `review-policy-waiver:${waiver.index}`,
        "warn",
        `reviewPolicy waiver ignored for ${waiver.code || waiver.legacyId}: ${waiver.note}`,
        "only air.review.* diagnostics can be waived; fix the underlying hard error instead"
      );
    } else if (waiver.status === "expired" && releaseCandidate) {
      addCheck(
        report,
        `review-policy-waiver:${waiver.index}`,
        "fail",
        `reviewPolicy waiver expired for ${waiver.code || waiver.legacyId}: ${waiver.expires}`,
        "remove the waiver or extend it with an explicit review reason before release-candidate checks"
      );
    }
  }
  for (const diagnostic of (report.reviewPolicyReport && report.reviewPolicyReport.pathClassDiagnostics) || []) {
    addCheck(
      report,
      `review-policy-path-class:${diagnostic.file}`,
      "warn",
      diagnostic.message,
      diagnostic.repairHint
    );
  }
  const gateFailures = failingWarningsForGates(aiWarnings, policy && policy.gates);
  const failingWarnings = aiWarnings.filter((warning) => matchesAiReviewFailOn(warning.id, failOn));
  const gateWarnings = warningWarningsForGates(aiWarnings, policy && policy.gates);
  const unique = uniqueWarnings(gateFailures.concat(failingWarnings));
  for (const warning of gateWarnings) {
    setReviewPolicyImpact(warning, "warn");
    addCheck(
      report,
      `ai-review:${warning.id}`,
      "warn",
      `reviewPolicy warned on ${warning.id}: ${warning.message}`,
      warning.repairHint || "adjust package reviewPolicy thresholds/gates or repair the AIR module"
    );
  }
  if (!unique.length) {
    addCheck(report, "ai-review-policy", failOn.length || hasConfiguredGates(policy && policy.gates) ? "pass" : "skip", failOn.length || hasConfiguredGates(policy && policy.gates) ? "reviewPolicy gates matched no failure warnings" : "no reviewPolicy gates configured; AI review warnings are advisory");
    return;
  }
  for (const warning of unique) {
    setReviewPolicyImpact(warning, "fail");
    addCheck(
      report,
      `ai-review:${warning.id}`,
      "fail",
      `reviewPolicy failed on ${warning.id}: ${warning.message}`,
      warning.repairHint || "adjust package reviewPolicy thresholds/gates or repair the AIR module"
    );
  }
}

function setReviewPolicyImpact(warning, action) {
  if (!warning || !warning.diagnostic) return;
  warning.diagnostic.gateAction = action;
  warning.diagnostic.packageStatusImpact = action;
  warning.diagnostic.fields = {
    ...(warning.diagnostic.fields || {}),
    reviewPolicyGateAction: action
  };
}

function attachPackageAiReview(report, base, metadata, options = {}) {
  const modules = (report.modules && report.modules.length)
    ? report.modules
    : [{ path: metadata.entry, name: path.basename(metadata.entry || "", ".air") }];
  const moduleReviews = [];
  const policyReport = createReviewPolicyRuntimeReport(metadata.reviewPolicy, { releaseCandidate: options.releaseCandidate });
  for (const moduleInfo of modules.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    const modulePath = moduleInfo.path;
    try {
      const source = fs.readFileSync(path.join(base, modulePath), "utf8");
      const mod = parseAir(source, modulePath, { resolveSourceImports: false });
      const policyContext = reviewPolicyContext(metadata.reviewPolicy, modulePath, policyReport);
      const isEntry = modulePath === metadata.entry;
      const review = createAiReviewReport(mod, {
        source,
        packageReport: isEntry ? options.packageReport : null,
        thresholds: policyContext.thresholds,
        reviewPolicy: {
          profile: metadata.reviewPolicy && metadata.reviewPolicy.profile,
          pathClass: policyContext.pathClass,
          gates: (metadata.reviewPolicy && metadata.reviewPolicy.gates) || {}
        }
      });
      const warnings = (review.warnings || []).map((warning) => annotateAiReviewWarning(warning, {
        modulePath,
        moduleName: mod.name,
        pathClass: policyContext.pathClass
      }));
      const moduleReview = {
        module: mod.name,
        path: modulePath,
        pathClass: policyContext.pathClass,
        status: warnings.length ? "warn" : review.status,
        warnings,
        diagnostics: sortDiagnostics(warnings.map((warning) => warning.diagnostic).filter(Boolean)),
        metrics: review.metrics,
        topLargeFunctions: (review.topLargeFunctions || []).map((fn) => ({
          ...fn,
          module: modulePath,
          pathClass: policyContext.pathClass
        })),
        topLargeModules: (review.topLargeModules || []).map((item) => ({
          ...item,
          module: modulePath,
          pathClass: policyContext.pathClass
        }))
      };
      moduleReviews.push(moduleReview);
      if (isEntry) report.aiReview = { ...review, warnings };
    } catch (err) {
      report.errors.push(errorMessage(err));
    }
  }
  const packageReview = aggregatePackageReview(moduleReviews, metadata.reviewPolicy, policyReport);
  applyReviewPolicyWaivers(packageReview, policyReport);
  report.moduleReviews = moduleReviews;
  report.packageReview = packageReview;
  report.reviewPolicyReport = policyReport;
  for (const diagnostic of packageReview.diagnostics) report.diagnostics.push(diagnostic);
  for (const diagnostic of policyReport.pathClassDiagnostics) report.diagnostics.push(diagnostic);
  if (options.emitWarnings) {
    for (const warning of packageReview.warnings) {
      report.warnings.push(`ai-review:${warning.module}:${warning.id}: ${warning.message}`);
    }
    for (const diagnostic of policyReport.pathClassDiagnostics) {
      report.warnings.push(`reviewPolicy:${diagnostic.legacyId}:${diagnostic.file}: ${diagnostic.message}`);
    }
  }
}

function annotateAiReviewWarning(warning, context) {
  const diagnostic = normalizeDiagnostic({
    ...(warning.diagnostic || {}),
    code: warning.code,
    legacyId: warning.id,
    severity: warning.severity,
    source: "ai-review",
    message: warning.message,
    repairHint: warning.repairHint,
    file: context.modulePath,
    module: context.modulePath,
    pathClass: context.pathClass,
    fields: {
      ...((warning.diagnostic && warning.diagnostic.fields) || {}),
      moduleName: context.moduleName,
      pathClass: context.pathClass
    }
  });
  return {
    ...warning,
    module: context.modulePath,
    pathClass: context.pathClass,
    code: diagnostic.code,
    category: diagnostic.category,
    diagnostic
  };
}

const DEFAULT_TOP_REVIEW_ITEMS = 10;

function aggregatePackageReview(moduleReviews, policy, policyReport = null) {
  const warnings = [];
  const diagnostics = [];
  const topLargeFunctions = [];
  const topLargeModules = [];
  for (const moduleReview of moduleReviews) {
    warnings.push(...(moduleReview.warnings || []));
    diagnostics.push(...(moduleReview.diagnostics || []));
    topLargeFunctions.push(...(moduleReview.topLargeFunctions || []));
    topLargeModules.push(...(moduleReview.topLargeModules || []));
  }
  return {
    version: "0.15",
    status: warnings.length ? "warn" : "pass",
    reviewPolicy: {
      schemaVersion: (policy && policy.schemaVersion) || null,
      profile: (policy && policy.profile) || null,
      gates: (policy && policy.gates) || {},
      pathClassOrder: reviewPathClassOrder(policy),
      waiverCount: policyReport ? policyReport.waivers.length : 0
    },
    modules: moduleReviews.map((item) => ({
      module: item.module,
      path: item.path,
      pathClass: item.pathClass,
      status: item.status,
      warningCount: (item.warnings || []).length
    })).sort((a, b) => a.path.localeCompare(b.path)),
    warnings: warnings.slice().sort(compareAiReviewWarning),
    diagnostics: sortDiagnostics(diagnostics),
    topLargeFunctions: topLargeFunctions
      .slice()
      .sort((a, b) => b.statements - a.statements || b.blocks - a.blocks || a.module.localeCompare(b.module) || a.name.localeCompare(b.name))
      .slice(0, DEFAULT_TOP_REVIEW_ITEMS),
    topLargeModules: topLargeModules
      .slice()
      .sort((a, b) => b.statements - a.statements || b.lines - a.lines || a.module.localeCompare(b.module))
      .slice(0, DEFAULT_TOP_REVIEW_ITEMS)
  };
}

function compareAiReviewWarning(a, b) {
  return String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.id || "").localeCompare(String(b.id || "")) ||
    String(a.message || "").localeCompare(String(b.message || ""));
}

function createReviewPolicyRuntimeReport(policy, options = {}) {
  const releaseCandidate = isReviewPolicyReleaseCandidate(policy, options);
  return {
    schemaVersion: (policy && policy.schemaVersion) || null,
    releaseCandidate,
    pathClassOrder: reviewPathClassOrder(policy || {}),
    pathClassDiagnostics: [],
    waivers: normalizeReviewWaiversForRuntime((policy && policy.waivers) || [], { releaseCandidate })
  };
}

function normalizeReviewWaiversForRuntime(waivers, options = {}) {
  const today = todayIso();
  return (waivers || []).map((waiver, index) => {
    const code = waiver.code || (waiver.legacyId ? diagnosticCodeForLegacyId(waiver.legacyId) : null);
    const expired = Boolean(waiver.expires && waiver.expires < today);
    const status = !code || !code.startsWith("air.review.")
      ? "ignored"
      : (expired ? "expired" : "active");
    return {
      index,
      status,
      code,
      legacyId: waiver.legacyId || null,
      file: waiver.file || null,
      module: waiver.module || null,
      symbol: waiver.symbol || null,
      pathClass: waiver.pathClass || null,
      expires: waiver.expires || null,
      reason: waiver.reason || null,
      releaseCandidate: Boolean(options.releaseCandidate),
      note: status === "ignored"
        ? "reviewPolicy waivers only apply to air.review.* diagnostics"
        : (status === "expired" ? "waiver is expired" : "waiver is active")
    };
  }).sort((a, b) =>
    String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.legacyId || "").localeCompare(String(b.legacyId || "")) ||
    String(a.file || "").localeCompare(String(b.file || "")) ||
    a.index - b.index);
}

function applyReviewPolicyWaivers(packageReview, policyReport) {
  if (!packageReview || !policyReport || !policyReport.waivers.length) return;
  const releaseCandidate = Boolean(policyReport.releaseCandidate);
  for (const warning of packageReview.warnings || []) {
    const waiver = policyReport.waivers.find((item) => reviewWaiverMatchesWarning(item, warning, { releaseCandidate }));
    if (!waiver) continue;
    warning.waived = true;
    warning.waiver = {
      code: waiver.code,
      legacyId: waiver.legacyId,
      reason: waiver.reason,
      expires: waiver.expires,
      status: waiver.status
    };
    if (warning.diagnostic) {
      warning.diagnostic.fields = {
        ...(warning.diagnostic.fields || {}),
        waived: true,
        waiverReason: waiver.reason,
        waiverExpires: waiver.expires,
        waiverStatus: waiver.status
      };
    }
  }
  for (const diagnostic of packageReview.diagnostics || []) {
    const warning = (packageReview.warnings || []).find((item) => item.diagnostic === diagnostic || (
      item.diagnostic &&
      item.diagnostic.code === diagnostic.code &&
      item.diagnostic.file === diagnostic.file &&
      item.diagnostic.legacyId === diagnostic.legacyId
    ));
    if (warning && warning.waived) diagnostic.fields = { ...(diagnostic.fields || {}), waived: true, waiverReason: warning.waiver.reason, waiverExpires: warning.waiver.expires, waiverStatus: warning.waiver.status };
  }
}

function reviewWaiverMatchesWarning(waiver, warning, options = {}) {
  if (!waiver || waiver.status === "ignored") return false;
  if (waiver.status === "expired" && options.releaseCandidate) return false;
  const diagnostic = warning.diagnostic || {};
  const code = warning.code || diagnostic.code || diagnosticCodeForLegacyId(warning.id);
  if (waiver.code && waiver.code !== code) return false;
  if (waiver.legacyId && waiver.legacyId !== warning.id) return false;
  const file = warning.module || diagnostic.file || "";
  if (waiver.file && !matchesPackageGlob(file, waiver.file)) return false;
  if (waiver.module && waiver.module !== file && waiver.module !== diagnostic.module) return false;
  if (waiver.pathClass && waiver.pathClass !== warning.pathClass && waiver.pathClass !== diagnostic.pathClass) return false;
  const symbol = diagnostic.symbol || diagnostic.fields?.function || warning.symbol || null;
  if (waiver.symbol && waiver.symbol !== symbol) return false;
  return true;
}

function isReviewPolicyReleaseCandidate(policy, options = {}) {
  return Boolean(options.releaseCandidate || (policy && (policy.profile === "release-candidate" || policy.mode === "release-candidate")));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function aiReviewWarningsForPolicy(report) {
  if (report.packageReview && Array.isArray(report.packageReview.warnings)) return report.packageReview.warnings;
  return report.aiReview?.warnings || [];
}

function matchesAiReviewFailOn(id, failOn) {
  const code = diagnosticCodeForLegacyId(id);
  return failOn.some((item) => id === item || id.startsWith(`${item}:`) || code === item);
}

function reviewPolicyContext(policy, relativePath, policyReport = null) {
  const classification = classifyReviewPath(relativePath || "", policy || {});
  if (policyReport && classification.diagnostic) policyReport.pathClassDiagnostics.push(classification.diagnostic);
  const pathClass = classification.pathClass;
  return {
    pathClass,
    thresholds: {
      ...((policy && policy.thresholds) || {}),
      ...(((policy && policy.pathClassThresholds) || {})[pathClass] || {})
    }
  };
}

function classifyReviewPath(relativePath, policyOrPathClasses) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const pathClasses = policyOrPathClasses && policyOrPathClasses.pathClasses ? policyOrPathClasses.pathClasses : policyOrPathClasses;
  const matches = [];
  for (const [pathClass, patterns] of Object.entries(pathClasses || {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const pattern of patterns || []) {
      if (matchesPackageGlob(normalized, pattern)) {
        matches.push({ pathClass, pattern, specificity: packageGlobSpecificity(pattern) });
      }
    }
  }
  if (!matches.length) return { pathClass: "authored", diagnostic: null, matches: [] };
  const maxSpecificity = Math.max(...matches.map((item) => item.specificity));
  const candidates = matches.filter((item) => item.specificity === maxSpecificity);
  const order = reviewPathClassOrder(policyOrPathClasses);
  candidates.sort((a, b) => pathClassRank(a.pathClass, order) - pathClassRank(b.pathClass, order) || a.pathClass.localeCompare(b.pathClass) || a.pattern.localeCompare(b.pattern));
  const selected = candidates[0];
  const ambiguous = candidates.length > 1;
  const diagnostic = ambiguous ? normalizeDiagnostic({
    code: "air.review.path_class_ambiguous",
    legacyId: "path-class-ambiguous",
    severity: "warn",
    source: "reviewPolicy",
    message: `reviewPolicy path class for ${normalized} matched multiple classes with equal specificity: ${candidates.map((item) => item.pathClass).sort().join(", ")}`,
    repairHint: "make pathClasses mutually exclusive or add a more specific pattern for this module path",
    file: normalized,
    pathClass: selected.pathClass,
    fields: {
      candidates: candidates.map((item) => ({ pathClass: item.pathClass, pattern: item.pattern })).sort((a, b) => a.pathClass.localeCompare(b.pathClass) || a.pattern.localeCompare(b.pattern)),
      selected: selected.pathClass
    }
  }) : null;
  return { pathClass: selected.pathClass, diagnostic, matches };
}

function matchesPackageGlob(file, pattern) {
  const normalized = String(pattern || "").replace(/\\/g, "/");
  if (normalized === file) return true;
  if (normalized.endsWith("/**")) return file.startsWith(normalized.slice(0, -3));
  if (normalized.endsWith("/**/*.air")) {
    const prefix = normalized.slice(0, -"**/*.air".length);
    return file.startsWith(prefix) && file.endsWith(".air");
  }
  if (normalized.endsWith("/*.air")) {
    const prefix = normalized.slice(0, -"*.air".length);
    if (!file.startsWith(prefix) || !file.endsWith(".air")) return false;
    return !file.slice(prefix.length).includes("/");
  }
  return false;
}

function packageGlobSpecificity(pattern) {
  const normalized = String(pattern || "").replace(/\\/g, "/");
  if (!normalized.includes("*")) return 100000 + normalized.length;
  const literal = normalized.replace(/\*\*\/\*\.air|\*\*|\*\.air|\*/g, "");
  return literal.length;
}

function reviewPathClassOrder(policy = {}) {
  policy = policy || {};
  const custom = Array.isArray(policy.pathClassOrder) ? policy.pathClassOrder : [];
  const builtIn = ["authored", "generated", "vendor"];
  return Array.from(new Set(custom.concat(builtIn).concat(Object.keys((policy && policy.pathClasses) || {}).sort())));
}

function pathClassRank(pathClass, order) {
  const index = order.indexOf(pathClass);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function failingWarningsForGates(warnings, gates = {}) {
  const out = [];
  for (const warning of (warnings || []).filter((item) => !item.waived)) {
    for (const [gate, action] of Object.entries(gates || {})) {
      if (action !== "fail") continue;
      if (warningMatchesReviewGate(warning, gate)) out.push(warning);
    }
  }
  return out;
}

function warningWarningsForGates(warnings, gates = {}) {
  const out = [];
  for (const warning of (warnings || []).filter((item) => !item.waived)) {
    for (const [gate, action] of Object.entries(gates || {})) {
      if (action !== "warn") continue;
      if (warningMatchesReviewGate(warning, gate)) out.push(warning);
    }
  }
  return uniqueWarnings(out);
}

function warningMatchesReviewGate(warningOrId, gate) {
  const id = typeof warningOrId === "string" ? warningOrId : warningOrId.id;
  const code = typeof warningOrId === "string" ? diagnosticCodeForLegacyId(id) : (warningOrId.code || warningOrId.diagnostic?.code || diagnosticCodeForLegacyId(id));
  if (gate === code) return true;
  const prefixes = {
    debugMetricEventBus: ["debug-metric-event-bus"],
    largeEntryFunction: ["entry-frame-budget"],
    largeFunctionStatements: ["large-function"],
    magicHandleCandidate: ["magic-host-literals"],
    repeatedLiteral: ["repeated-literal"],
    selectChainAsTable: ["select-chain-as-table"],
    slotFamilyState: ["table-like-patterns"],
    mutableGlobalsPerModule: ["mutable-global-budget"]
  }[gate] || [gate];
  return prefixes.some((prefix) => id === prefix || id.startsWith(`${prefix}:`) || code === prefix);
}

function hasFailGates(gates = {}) {
  return Object.values(gates || {}).some((action) => action === "fail");
}

function hasConfiguredGates(gates = {}) {
  return Object.values(gates || {}).some((action) => action === "fail" || action === "warn");
}

function uniqueWarnings(warnings) {
  const out = [];
  const seen = new Set();
  for (const warning of warnings) {
    const key = `${warning.module || ""}:${warning.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out.sort(compareAiReviewWarning);
}

function attachModuleGraph(report, moduleGraph) {
  assignModuleGraphFields(report, moduleGraph);
  const capabilityUnion = Object.keys(report.capabilityOrigins).sort();
  report.computedCapabilities = capabilityUnion.length ? capabilityUnion : report.computedCapabilities;
  report.capabilities.required = report.computedCapabilities.length ? report.computedCapabilities : report.declaredCapabilities;
  report.hostImports.used = Object.keys(report.hostImportOrigins).sort();
  if (moduleGraph.effectComposition) {
    addCheck(report, "effect-composition", "skip", moduleGraph.effectComposition.message);
  }
  if (moduleGraph.linking) {
    addCheck(report, "linked-output", "skip", moduleGraph.linking.message);
  }
  if ((moduleGraph.graph?.edges || []).length) {
    addCheck(report, "linked-output", "pass", "multi-module authored graph can produce deterministic linked output through airc build package --linked-wasm");
  }
}

function provenanceContextForReport(report) {
  return {
    factSchemas: report.facts && report.facts.schemas || [],
    structuredIOSchemas: report.structuredIO && report.structuredIO.schemas || [],
    outputContracts: report.outputContracts && report.outputContracts.schemas || []
  };
}

function attachProvenanceFlow(report, options = {}) {
  const flow = report.provenanceFlow;
  if (!flow || flow.mode === "absent") return;
  if (options.checks) {
    if (flow.status === "passed") {
      addCheck(report, "provenance-flow", "pass", "required provenance flow verification passed");
    }
    for (const diagnostic of flow.diagnostics || []) {
      addCheck(
        report,
        `provenance-flow:${diagnostic.code}:${diagnostic.file || "package"}:${diagnostic.line || 0}`,
        diagnostic.severity === "warn" ? "warn" : "fail",
        diagnostic.message,
        diagnostic.repairHint || null,
        {
          code: diagnostic.code,
          file: diagnostic.file || null,
          line: diagnostic.line || null,
          module: diagnostic.module || null,
          fields: diagnostic.fields || {}
        }
      );
    }
    return;
  }
  for (const diagnostic of flow.diagnostics || []) {
    report.diagnostics.push(normalizeDiagnostic({
      ...diagnostic,
      gateAction: diagnostic.severity === "fail" ? "fail" : null
    }));
  }
}

function assignModuleGraphFields(report, moduleGraph) {
  report.modules = (moduleGraph.modules || []).slice();
  report.stateSegments = report.modules
    .flatMap((mod) => (mod.stateSegments || []).map((segment) => ({ ...segment, module: segment.module || mod.path })))
    .sort((a, b) => String(a.module || "").localeCompare(String(b.module || "")) || String(a.name || "").localeCompare(String(b.name || "")));
  report.tableGroups = report.modules
    .flatMap((mod) => (mod.tableGroups || []).map((group) => ({ ...group, module: group.module || mod.path })))
    .sort((a, b) => String(a.module || "").localeCompare(String(b.module || "")) || String(a.name || "").localeCompare(String(b.name || "")));
  report.pools = report.modules
    .flatMap((mod) => (mod.pools || []).map((pool) => ({ ...pool, module: pool.module || mod.path })))
    .sort((a, b) => String(a.module || "").localeCompare(String(b.module || "")) || String(a.name || "").localeCompare(String(b.name || "")));
  report.graph = moduleGraph.graph || { order: [], edges: [] };
  report.capabilityOrigins = moduleGraph.capabilityOrigins || {};
  report.hostImportOrigins = moduleGraph.hostImportOrigins || {};
  report.authorityChains = moduleGraph.authorityChains || [];
  report.importClassifications = moduleGraph.importClassifications || [];
  report.moduleDiagnostics = moduleGraph.moduleDiagnostics || [];
  report.effectUsageOrigins = moduleGraph.effectUsageOrigins || {};
  report.effectComposition = moduleGraph.effectComposition || null;
  report.provenanceFlow = moduleGraph.provenanceFlow || null;
  report.linking = moduleGraph.linking || null;
  report.linkedWasm = false;
  report.computedCapabilities = Object.keys(report.capabilityOrigins).sort();
  if (report.hostImports) report.hostImports.used = Object.keys(report.hostImportOrigins).sort();
}

function attachPackageGraphDiagnosticChecks(report, metadata = {}) {
  const diagnostics = packageGraphDiagnostics(report, report, {
    packageExports: metadata.packageExports || []
  });
  const seen = new Set((report.diagnostics || []).map((diagnostic) => `${diagnostic.code}\0${diagnostic.message}`));
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\0${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    addCheck(
      report,
      diagnostic.code,
      diagnostic.severity === "warn" ? "warn" : "fail",
      diagnostic.message,
      repairHintForPackageGraphDiagnostic(diagnostic),
      {
        code: diagnostic.code,
        file: diagnostic.file || null,
        module: diagnostic.module || null,
        fields: diagnostic.fields || {}
      }
    );
  }
}

function assignPackageGraphOwnership(report, metadata = {}) {
  const ownership = createPackageGraphOwnership(report, {
    packageExports: metadata.packageExports || []
  });
  report.authoredGraph = ownership.authoredGraph;
  report.executableGraph = ownership.executableGraph;
  report.authoredToExecutable = ownership.authoredToExecutable;
  report.ownershipMap = ownership.ownershipMap;
  report.linkDiagnostics = ownership.linkDiagnostics;
  report.generatedExecutableFreshness = ownership.generatedExecutableFreshness;
}

function repairHintForPackageGraphDiagnostic(diagnostic) {
  switch (diagnostic && diagnostic.code) {
    case "air.package_graph.unresolved_module_import":
      return "Add the package-local AIR module, fix the use path, or remove the import.";
    case "air.package_graph.unresolved_symbol_import":
      return "Call an exported symbol that exists in the directly imported authored module.";
    case "air.package_graph.private_symbol_import":
      return "Expose a public wrapper from the target module; do not import private helpers.";
    case "air.package_graph.duplicate_public_export":
      return "Give each package export a unique public name and owner.";
    case "air.package_graph.executable_stale":
      return "Regenerate derived executable graph artifacts from the authored graph.";
    case "air.package_graph.capability_drift":
      return "Regenerate executable output from authored modules; derived graphs cannot add capabilities or effects.";
    default:
      return "Repair the authored package graph; executable graph metadata is derived.";
  }
}

function addCapabilityOrigin(report, capability, origin) {
  if (!report.capabilityOrigins[capability]) report.capabilityOrigins[capability] = [];
  report.capabilityOrigins[capability] = sortedStrings(report.capabilityOrigins[capability].concat(origin));
  report.computedCapabilities = sortedStrings(report.computedCapabilities.concat(capability));
  report.capabilities.required = report.computedCapabilities.slice();
}

function reconcilePackageCapabilities(report) {
  report.computedCapabilities = sortedStrings(report.computedCapabilities.length ? report.computedCapabilities : Object.keys(report.capabilityOrigins));
  report.capabilities.required = report.computedCapabilities.slice();
  const declared = new Set(report.declaredCapabilities);
  const computed = new Set(report.computedCapabilities);
  for (const capability of report.computedCapabilities) {
    if (!declared.has(capability)) {
      addCheck(report, `package-capability:${capability}`, "fail", `package manifest missing capability ${capability} required by module graph or manifest authority`, `add ${capability} to air.package.json capabilities or remove the module/import/manifest behavior that requires it`);
      addHiddenAuthority(report, {
        id: `missing-capability:${capability}`,
        capability,
        source: (report.capabilityOrigins[capability] || []).join(", "),
        message: `package causes ${capability} behavior without declaring capability ${capability}`,
        repairHint: `add ${capability} to air.package.json capabilities or remove the behavior`
      });
    }
  }
  for (const capability of report.declaredCapabilities) {
    if (!computed.has(capability)) {
      addCheck(report, `package-capability-extra:${capability}`, "warn", `package manifest declares unused capability ${capability}`, `remove capability ${capability} or add a module/import/manifest behavior that requires it`);
    }
  }
}

function addHiddenAuthority(report, item) {
  const entry = {
    id: item.id,
    capability: item.capability,
    source: item.source || null,
    message: item.message,
    repairHint: item.repairHint
  };
  if (!report.hiddenAuthority.some((existing) => JSON.stringify(existing) === JSON.stringify(entry))) {
    report.hiddenAuthority.push(entry);
  }
}

function moduleLikeForPackageCheck(report) {
  return {
    name: report.package,
    capabilities: new Set(report.computedCapabilities),
    externs: report.hostImports.used.map((name) => ({ name }))
  };
}

function audioRequiresPackageCapability(audio) {
  return Boolean(audio && audio.used && (audio.source === "module-driven" || audio.source === "direct-import"));
}

function assetKindsFromAssetReport(assetReport) {
  const kinds = [];
  for (const kind of Object.keys((assetReport && assetReport.assets) || {})) {
    if (HOST_ASSET_KIND[kind]) kinds.push(HOST_ASSET_KIND[kind]);
  }
  return sortedStrings(kinds);
}

function attachProfileSupport(report, profileReport, profile) {
  report.profileSupport = {
    id: profileReport.id,
    hostAbi: profileReport.hostAbi || profile.hostAbi,
    requiredHostAbi: (profileReport.required && profileReport.required.hostAbi) || report.hostAbi || null,
    status: profileReport.status,
    capabilities: {
      required: profileReport.required.capabilities,
      supported: profileReport.required.capabilities.filter((item) => profile.supports.capabilities.includes(item)).sort(),
      unsupported: profileReport.unsupportedCapabilities
    },
    hostImports: {
      required: profileReport.required.hostImports,
      supported: profileReport.required.hostImports.filter((item) => profile.supports.hostImports.includes(item)).sort(),
      unsupported: profileReport.unsupportedHostImports
    },
    manifestKinds: {
      required: profileReport.required.manifestKinds,
      supported: profileReport.required.manifestKinds.filter((item) => profile.supports.manifestKinds.includes(item)).sort(),
      unsupported: profileReport.unsupportedManifestKinds
    },
    assetKinds: {
      required: profileReport.required.assetKinds,
      supported: profileReport.required.assetKinds.filter((item) => profile.supports.assetKinds.includes(item)).sort(),
      unsupported: profileReport.unsupportedAssetKinds
    },
    diagnostics: profileReport.diagnostics,
    errors: profileReport.errors
  };
}

function hostImportsFromEntry(base, entry) {
  if (!entry) return [];
  const source = fs.readFileSync(path.join(base, entry), "utf8");
  const mod = parseAir(source, entry);
  verifyModule(mod);
  return (mod.externs || []).map((ex) => ex.name);
}

function attachHostProfileReport(result, requirements) {
  if (!requirements.profileId) return;
  const profile = loadHostProfile(requirements.profileId);
  const report = createHostProfileReport(requirements, profile);
  result.hostProfile = report;
  if (report.status !== "pass") {
    throw new Error(`host profile check failed: ${report.errors.join("; ")}`);
  }
}

function audioManifestNameFromMetadata(metadata) {
  if (typeof metadata.audioManifest === "string") return metadata.audioManifest;
  if (metadata.audio && typeof metadata.audio.manifest === "string") return metadata.audio.manifest;
  return null;
}

function createPackageResourceCertificate(packageDir, options = {}) {
  const report = checkPackageDir(packageDir, {
    ...options,
    built: false
  });
  if (!report.resourceCertificate) {
    const error = new Error(`resource certificate could not be created for ${packageDir}`);
    error.report = report;
    throw error;
  }
  return report.resourceCertificate;
}

function attachResourceCertificate(report, base, metadata, packageManifest, options = {}) {
  if (!metadata || !packageManifest || !(report.modules || []).length) return;
  const declaredPolicy = packageManifest.resourceCertificate || null;
  const policy = {
    ...(declaredPolicy || {
      mode: options.required ? "required" : "optional",
      requiredBounds: ["effects", "hostCalls", "loops", "memory"],
      verifierDigest: null,
      packageDigest: null,
      certificateDigest: null
    })
  };
  if (options.required) policy.mode = "required";
  try {
    const modules = (report.modules || []).map((item) => {
      const relative = String(item.path || "").replace(/\\/g, "/");
      const absolute = path.join(base, relative);
      const source = fs.readFileSync(absolute, "utf8");
      return {
        path: relative,
        mod: parseAir(source, relative, { resolveSourceImports: false }),
        digest: `sha256:${sha256(Buffer.from(source, "utf8"))}`
      };
    }).sort((a, b) => a.path.localeCompare(b.path));
    const manifestBytes = fs.readFileSync(path.join(base, PACKAGE_MANIFEST_FILE));
    const manifestDigest = `sha256:${sha256(manifestBytes)}`;
    const packageDigest = resourcePackageDigest(manifestDigest, modules);
    const certificate = createVerifiedResourceCertificate(modules, {
      packageName: metadata.name || report.package,
      manifestDigest,
      packageDigest,
      policy,
      mode: policy.mode
    });
    const validation = validateVerifiedResourceCertificate(certificate, {
      required: policy.mode === "required",
      packageName: metadata.name || report.package,
      packageDigest: policy.packageDigest || packageDigest,
      verifierDigest: policy.verifierDigest || undefined,
      certificateDigest: policy.certificateDigest || undefined
    });
    report.resourceCertificate = certificate;
    if (!validation.ok) {
      for (const diagnostic of validation.diagnostics) {
        recordResourceCertificateDiagnostic(report, diagnostic, options.checks);
      }
    } else if (options.checks && declaredPolicy) {
      addCheck(
        report,
        "resource-certificate",
        certificate.requiredBoundsSatisfied ? "pass" : "warn",
        certificate.requiredBoundsSatisfied
          ? `resource certificate verified: ${certificate.certificateDigest}`
          : "resource certificate is advisory and contains unknown bounds",
        certificate.requiredBoundsSatisfied ? null : "bound dynamic allocations or use optional certificate mode"
      );
    }
  } catch (err) {
    const diagnostic = {
      code: "air.resource_certificate.creation_failed",
      severity: policy.mode === "required" ? "fail" : "warn",
      message: errorMessage(err),
      fields: {}
    };
    recordResourceCertificateDiagnostic(report, diagnostic, options.checks);
  }
}

function attachRealtimeExecutionProfile(report, mod, metadata, options = {}) {
  if (!metadata || !metadata.executionProfile) return;
  try {
    const validation = assertRealtimeSafeProfile(
      mod,
      metadata.executionProfile,
      report.resourceCertificate
    );
    report.executionProfile = {
      ...metadata.executionProfile,
      validation
    };
    if (options.checks) {
      addCheck(
        report,
        "execution-profile:realtime_safe",
        "pass",
        `realtime_safe profile verified for @${validation.entrypoint}`
      );
    }
  } catch (err) {
    const message = errorMessage(err);
    if (options.checks) {
      addCheck(
        report,
        "execution-profile:realtime_safe",
        "fail",
        message,
        "remove realtime_safe or make the module capability-free, allocation-free, bounded, and borrowed-memory-only"
      );
    } else {
      report.errors.push(message);
    }
  }
}

function recordResourceCertificateDiagnostic(report, diagnostic, checks) {
  const message = diagnostic.message || diagnostic.code;
  if (checks) {
    addCheck(report, "resource-certificate", diagnostic.severity || "fail", message, "regenerate the certificate from the exact package and verifier", {
      code: diagnostic.code,
      fields: diagnostic.fields || {}
    });
    return;
  }
  const rendered = `${diagnostic.code}: ${message}`;
  if ((diagnostic.severity || "fail") === "fail") report.errors.push(rendered);
  else report.warnings.push(rendered);
  report.diagnostics.push(normalizeDiagnostic({
    code: diagnostic.code,
    severity: diagnostic.severity || "fail",
    source: "resource-certificate",
    message,
    fields: diagnostic.fields || {}
  }));
}

function resourcePackageDigest(manifestDigest, modules) {
  const hash = crypto.createHash("sha256");
  hash.update("AIR_VERIFIED_RESOURCE_PACKAGE_V1\0", "utf8");
  hash.update(JSON.stringify({
    manifestDigest,
    modules: modules.map((item) => ({ path: item.path, digest: item.digest }))
  }), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function run(options) {
  return require("./run_package").run(options);
}

async function createVerifiedExecutionSession(options) {
  return require("./verified_execution_session").createVerifiedExecutionSession(options);
}

function finalizePackageCheckReport(report) {
  report.capabilities.required = sortedStrings(report.capabilities.required);
  report.capabilities.supported = sortedStrings(report.capabilities.supported);
  report.capabilities.unsupported = sortedStrings(report.capabilities.unsupported);
  report.hostImports.used = sortedStrings(report.hostImports.used);
  report.hostImports.unsupported = sortedStrings(report.hostImports.unsupported);
  report.warnings = sortedStrings(report.warnings);
  report.errors = sortedStrings(report.errors);
  report.unsupportedHostFeatures = sortedStrings(report.unsupportedHostFeatures);
  report.repairHints = sortedStrings(report.repairHints);
  report.checks = (report.checks || []).slice().sort((a, b) => a.id.localeCompare(b.id) || a.message.localeCompare(b.message));
  report.diagnostics = sortDiagnostics(report.diagnostics || []);
  report.status = report.errors.length ? "fail" : (report.warnings.length ? "warn" : "pass");
  return report;
}

function finalizePackageGraphReport(report) {
  report.declaredCapabilities = sortedStrings(report.declaredCapabilities);
  report.computedCapabilities = sortedStrings(report.computedCapabilities);
  if (report.hostImports) report.hostImports.used = sortedStrings(report.hostImports.used);
  report.warnings = sortedStrings(report.warnings);
  report.errors = sortedStrings(report.errors);
  if (report.diagnostics) report.diagnostics = sortDiagnostics(report.diagnostics);
  report.status = report.errors.length ? "fail" : (report.warnings.length ? "warn" : "pass");
  return report;
}

function addCheck(report, id, status, message, repairHint = null, diagnosticOptions = {}) {
  const messageHints = diagnosticHintsFromMessage(message);
  const diagnostic = normalizeDiagnostic({
    legacyId: id,
    code: diagnosticOptions.code || messageHints.code,
    status,
    message,
    repairHint,
    source: "package-check",
    file: diagnosticOptions.file || messageHints.file || null,
    line: diagnosticOptions.line || messageHints.line || null,
    col: diagnosticOptions.col || messageHints.col || null,
    module: diagnosticOptions.module || messageHints.module || null,
    gateAction: status === "fail" ? "fail" : (status === "warn" ? "warn" : null),
    fields: { checkId: id, ...(messageHints.fields || {}), ...(diagnosticOptions.fields || {}) }
  });
  const check = { id, status, message, code: diagnostic.code, diagnostic };
  if (repairHint) check.repairHint = repairHint;
  report.checks.push(check);
  if (Array.isArray(report.diagnostics) && (status === "fail" || status === "warn")) {
    report.diagnostics.push(diagnostic);
  }
  if (status === "fail") {
    report.errors.push(message);
    if (repairHint) report.repairHints.push(repairHint);
    if (/unsupported|does not support|unknown host profile|hostAbi .*not supported/i.test(message)) {
      report.unsupportedHostFeatures.push(message);
    }
  } else if (status === "warn") {
    report.warnings.push(message);
    if (repairHint) report.repairHints.push(repairHint);
  }
}

function checkIdForError(message, fallback) {
  if (/wasm .*does not exist|wasm is required/.test(message)) return "wasm";
  if (/cyclic AIR import/.test(message)) return "module-cycle";
  if (/duplicate AIR import name/.test(message)) return "module-duplicate-alias";
  if (/std\.[a-z0-9_]+ is not stdlib|not a valid stdlib import/.test(message)) return "stdlib-import";
  if (/AIR import .*escapes package root|resolves outside package root/.test(message)) return "module-path-escape";
  if (/AIR import missing file/.test(message)) return "module-missing";
  if (/AIR_MODULE_MISSING_DIRECT_IMPORT/.test(message)) return "module-missing-import";
  if (/AIR_MODULE_PRIVATE_OR_MISSING_EXPORT/.test(message)) return "module-private-or-missing-export";
  if (/cross-module call .*requires a direct use import/.test(message)) return "module-missing-import";
  if (/cross-module call .*must target an exported function/.test(message)) return "module-private-or-missing-export";
  if (/element type .*not supported in static scalar tables|storage type .*must be read|requires compact table storage/.test(message)) return "table-storage-type-invalid";
  if (/out of range for (u8|u16|i16) storage/.test(message)) return "table-value-out-of-range";
  if (/unsupported compact table|unsupported storage lowering/.test(message)) return "table-unsupported-storage-lowering";
  if (/unknown table|table\.get|table\.set|static tables/.test(message)) return "table-invalid";
  if (/AIR_HOST_OBJECT_HANDLE_TYPE/.test(message)) return "host-object-handle";
  if (/non-runtime path segment/.test(message)) return "manifest-forbidden-runtime-path";
  if (/missing file/.test(message)) return "manifest-missing-runtime-resource";
  if (/manifest/.test(message)) return "manifest";
  if (/asset/.test(message)) return "assets";
  if (/unknown host profile/.test(message)) return "host-profile";
  const unsupported = message.match(/unsupported host extern '([^']+)'/);
  if (unsupported) return `rejected-host-import:${unsupported[1]}`;
  if (/extern .*signature/.test(message)) return "entry-verify";
  return fallback;
}

function checkIdForAssetWarning(message) {
  if (/uses placeholder file/.test(message)) return "asset-placeholder";
  return "asset-warning";
}

function repairHintForError(message) {
  if (/wasm .*does not exist|wasm is required/.test(message)) {
    return "run: node bin/airc.js build <entry.air> --emit wasm -o <path>";
  }
  if (/cyclic AIR import/.test(message)) {
    return "remove the package-local import cycle; AIR modules must form an acyclic graph";
  }
  if (/duplicate AIR import name/.test(message)) {
    return "give one import a distinct alias with: use \"./module.air\" as alias";
  }
  if (/std\.gfx3d is not stdlib/.test(message)) {
    return "vendor/copy kits/gfx-basic/air/gfx3d.air into a package-local generated/kits path, or use an accepted kit import mechanism when introduced; do not use std.* for host-authority wrappers";
  }
  if (/std\.scene is not stdlib/.test(message)) {
    return "vendor/copy kits/gfx-basic/air/scene.air into a package-local generated/kits path, or use project-local code; do not use std.* for host-authority wrappers";
  }
  if (/std\.voxel is not stdlib/.test(message)) {
    return "vendor/copy kits/voxel-basic/air/voxel.air into a package-local generated/kits path, or use an accepted kit import mechanism when introduced; do not use std.* for host-authority wrappers";
  }
  if (/std\.ui is not stdlib/.test(message)) {
    return "vendor/copy kits/ui-basic/air/ui.air into a package-local generated/kits path, or use an accepted kit import mechanism when introduced; do not use std.* for host-authority wrappers";
  }
  if (/not a valid stdlib import/.test(message)) {
    return "use an existing stdlib module, or vendor/copy project/kit helpers into a package-local ./ path";
  }
  if (/AIR import .*escapes package root|resolves outside package root/.test(message)) {
    return "keep package-local imports under the package root and use only ./ or ../ paths";
  }
  if (/AIR import missing file/.test(message)) {
    return "create the imported .air file or fix the use path";
  }
  if (/AIR_MODULE_MISSING_DIRECT_IMPORT/.test(message)) {
    return "add a direct use import for the module alias before calling alias.exported_func";
  }
  if (/AIR_MODULE_PRIVATE_OR_MISSING_EXPORT/.test(message)) {
    return "export these functions or expose one exported wrapper and keep helpers local";
  }
  if (/cross-module call .*requires a direct use import/.test(message)) {
    return "add a direct use import for the module alias before calling alias.exported_func";
  }
  if (/cross-module call .*must target an exported function/.test(message)) {
    return "export the target function or call a public wrapper from the imported module";
  }
  if (/table\.set|static tables are read-only/.test(message)) {
    return "replace table mutation with immutable table data and computed SSA values";
  }
  if (/unknown table|table\.get/.test(message)) {
    return "declare a fixed static scalar table before using table.get, and keep indexes within bounds";
  }
  if (/AIR_HOST_OBJECT_HANDLE_TYPE/.test(message)) {
    return "replace host object handles with scalar manifest/package handles; hosts own DOM, Canvas, WebAudio, WebGPU, Metal, Vulkan, files, sockets, and platform objects";
  }
  if (/missing assets manifest|asset manifest does not exist/.test(message)) {
    return "declare manifests.assets or remove the assets reference";
  }
  if (/missing .* manifest/.test(message)) {
    return "create the referenced manifest file or remove the manifest reference";
  }
  if (/unsupported host extern '([^']+)'/.test(message)) {
    const hostImport = message.match(/unsupported host extern '([^']+)'/)[1];
    return hostImportRepairHint(hostImport);
  }
  if (/unknown host profile/.test(message)) return unknownProfileRepairHint();
  if (/unknown capability: ([a-z0-9_.-]+)/.test(message)) return "remove the unknown capability or add it through the capability spec and verifier policy";
  return "inspect the package-check diagnostic and update the package, manifest, or selected host profile";
}

function manifestRepairHint(kind) {
  if (kind === "assets") return "declare manifests.assets or remove the assets reference";
  return `create the referenced ${kind} manifest file or remove manifests.${kind}`;
}

function capabilityRepairHint(capability) {
  const profiles = profilesSupporting((profile) => profile.supports.capabilities.includes(capability));
  const suffix = profiles.length ? ` or use profile ${profiles.join("/")}` : "";
  return `remove capability ${capability}${suffix}`;
}

function hostImportRepairHint(hostImport) {
  if (hostImport === "audio.event") {
    return "audio.event is RFC/deferred; use audio.beep direct import with capability audio unless audio.event is promoted through spec, Host ABI registry, verifier, profiles, SDK, and tests";
  }
  if (hostImport === "effect.event") {
    return "no stable effect event ABI exists; keep effects in verifier-visible budgets and do not use hidden event buses";
  }
  if (hostImport === "gfx.draw_sprite_transform") {
    return "gfx.draw_sprite_transform is RFC/deferred; use a manifest/kit path or existing gfx.draw_primitive where appropriate";
  }
  const profiles = profilesSupporting((profile) => profile.supports.hostImports.includes(hostImport));
  if (profiles.length) return `this import requires ${profiles.join(" or ")}`;
  return `remove host import ${hostImport} or add it through spec, Host ABI registry, verifier, SDK, and tests`;
}

function unknownProfileRepairHint() {
  const profiles = listHostProfileIds();
  return `use one of: ${profiles.join(", ")}`;
}

function profilesSupporting(predicate) {
  const out = [];
  for (const id of listHostProfileIds()) {
    try {
      const profile = loadHostProfile(id);
      if (predicate(profile)) out.push(id);
    } catch (_) {
      // Ignore malformed profiles here; profile validation tests report them.
    }
  }
  return out.sort();
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

function errorList(err) {
  if (err && Array.isArray(err.errors)) return err.errors.map((item) => String(item));
  return [errorMessage(err)];
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

module.exports = {
  ABI_VERSION: AIR_ABI_VERSION,
  buildPackage,
  checkPackageDir,
  createPackageResourceCertificate,
  createPackageMetadata,
  createVerifiedExecutionSession,
  reportPackageDir,
  loadPackage,
  normalizePackageMetadata,
  run,
  verifyPackageDir,
  instantiateAirModule,
  borrowedSliceInterfaceDescriptor,
  invokeBorrowedMemory,
  prepareBorrowedMemoryInvocation,
  createGpuImports,
  createInputImports,
  createFsImports,
  createNetImports,
  createTimeImports,
  createRandomImports,
  createAudioImports,
  createIoImports,
  createOutputImports,
  createUtilityImports,
  validatePackageDir
};
