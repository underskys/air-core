const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { AIR_ABI_VERSION } = require("./version");
const { isCandidateAbi012 } = require("./typed_interface");
const { checkPackageDir, reportPackageDir } = require("./sdk");
const { createPackageLinkPlan } = require("./link_plan");
const { createHostProfileReport, loadHostProfile } = require("./host_profiles");
const { normalizeDiagnostic, sortDiagnostics } = require("./diagnostics");
const { normalizePackageMetadata, PACKAGE_MANIFEST_FILE, validatePackageManifest } = require("./package_manifest");

const AIRPKG_SCHEMA_VERSION = "0.16";
const AIRPKG_KIND = "airpkg";
const AIRPKG_VALIDATION_SCHEMA_VERSION = "0.17";
const LINKED_OUTPUT_STATUS = new Set(["available", "deferred", "planned"]);
const LINKED_OUTPUT_KIND = new Set(["link-plan", "none", "wasm", "wat"]);
const FORBIDDEN_RUNTIME_REQUIREMENTS = [
  "build scripts",
  "codex",
  "node",
  "npm install",
  "python",
  "source air repo"
];

function createAirpkgArtifact(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const manifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const packageReport = reportPackageDir(base, {
    profile: options.profile,
    releaseCandidate: options.releaseCandidate
  });
  const checkReport = checkPackageDir(base, {
    profile: options.profile,
    built: false,
    releaseCandidate: options.releaseCandidate
  });
  const linkPlan = createPackageLinkPlan(base, {
    profile: options.profile,
    releaseCandidate: options.releaseCandidate
  });
  const artifact = stableObject({
    schemaVersion: AIRPKG_SCHEMA_VERSION,
    kind: AIRPKG_KIND,
    package: packageIdentity(base, manifest, metadata),
    sourceGraph: sourceGraphSummary(packageReport),
    abi: abiSummary(metadata),
    hostProfiles: hostProfileSummary(metadata, checkReport, options),
    authority: authoritySummary(checkReport, packageReport),
    generatedArtifacts: generatedArtifactSummary(packageReport),
    manifests: manifestSummary(manifest, checkReport),
    report: reportSummary(packageReport, checkReport),
    linkedWasm: linkedWasmSummary(packageReport, checkReport),
    linkedOutput: linkedOutputSummary(base, metadata, linkPlan),
    boundary: boundarySummary(metadata, packageReport)
  });
  assertNoAbsolutePaths(artifact);
  return artifact;
}

function writeAirpkgArtifact(packageDir, output, options = {}) {
  const artifact = createAirpkgArtifact(packageDir, options);
  const out = path.resolve(output);
  const target = out.endsWith(".json") ? out : path.join(out, "airpkg.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${stableStringify(artifact)}\n`);
  return { artifact, path: target };
}

function inspectAirpkg(input) {
  const target = resolveAirpkgInput(input);
  const artifact = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!artifact || artifact.kind !== AIRPKG_KIND) {
    throw new Error(`not an airpkg artifact: ${input}`);
  }
  if (artifact.schemaVersion !== AIRPKG_SCHEMA_VERSION) {
    throw new Error(`unsupported airpkg schemaVersion ${JSON.stringify(artifact.schemaVersion)}; expected ${AIRPKG_SCHEMA_VERSION}`);
  }
  return stableObject(artifact);
}

function checkAirpkgArtifact(input, options = {}) {
  let target = null;
  let artifact = null;
  const diagnostics = [];
  const checks = [];
  const context = { artifactDir: null, profile: options.profile || null };

  try {
    target = resolveAirpkgInput(input);
    context.artifactDir = path.dirname(target);
  } catch (err) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", err.message, {
      field: "input",
      repairHint: "provide an existing airpkg JSON file or directory containing airpkg.json"
    });
    return finalizeAirpkgValidation(input, artifact, diagnostics, checks, context);
  }

  try {
    artifact = JSON.parse(fs.readFileSync(target, "utf8"));
    addCheck(checks, "json-parse", "pass", "artifact JSON parses");
  } catch (err) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", `artifact JSON does not parse: ${err.message}`, {
      field: "json",
      repairHint: "regenerate the airpkg artifact or fix invalid JSON"
    });
    return finalizeAirpkgValidation(target, artifact, diagnostics, checks, context);
  }

  validateAirpkgSchema(artifact, diagnostics, checks);
  validateAirpkgAbi(artifact, diagnostics, checks, options);
  validateNoAbsolutePaths(artifact, diagnostics, checks);
  validateNoTimestampFields(artifact, diagnostics, checks);
  validateLinkedOutput(artifact, diagnostics, checks, context);
  validateRuntimeBoundary(artifact, diagnostics, checks);
  validateProfileCompatibility(artifact, diagnostics, checks, options);

  return finalizeAirpkgValidation(target, artifact, diagnostics, checks, context);
}

function resolveAirpkgInput(input) {
  const target = path.resolve(input);
  if (!fs.existsSync(target)) throw new Error(`airpkg does not exist: ${input}`);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const file = path.join(target, "airpkg.json");
    if (!fs.existsSync(file)) throw new Error(`airpkg directory missing airpkg.json: ${input}`);
    return file;
  }
  if (!stat.isFile()) throw new Error(`airpkg is not a file or directory: ${input}`);
  return target;
}

function validateAirpkgSchema(artifact, diagnostics, checks) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "airpkg artifact must be a JSON object", {
      field: "$",
      repairHint: "regenerate the airpkg artifact"
    });
    return;
  }
  if (!artifact.schemaVersion) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "airpkg schemaVersion is required", {
      field: "schemaVersion",
      repairHint: "regenerate the artifact with current airc package tooling"
    });
  } else if (artifact.schemaVersion !== AIRPKG_SCHEMA_VERSION) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", `unsupported airpkg schemaVersion ${JSON.stringify(artifact.schemaVersion)}; expected ${AIRPKG_SCHEMA_VERSION}`, {
      field: "schemaVersion",
      expected: AIRPKG_SCHEMA_VERSION,
      actual: artifact.schemaVersion,
      repairHint: "inspect or regenerate the artifact with compatible tooling"
    });
  } else {
    addCheck(checks, "schema-version", "pass", `schemaVersion ${AIRPKG_SCHEMA_VERSION} is supported`);
  }
  if (artifact.kind !== AIRPKG_KIND) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "airpkg kind must be airpkg", {
      field: "kind",
      expected: AIRPKG_KIND,
      actual: artifact.kind,
      repairHint: "provide an airpkg artifact"
    });
  } else {
    addCheck(checks, "kind", "pass", "artifact kind is airpkg");
  }
  const pkg = artifact.package;
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "package identity is required", {
      field: "package",
      repairHint: "regenerate the airpkg artifact from a package with air.package.json"
    });
  } else {
    if (!stableName(pkg.name)) {
      addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "package.name must be a stable identifier", {
        field: "package.name",
        actual: pkg.name,
        repairHint: "use a stable package name in air.package.json and regenerate the artifact"
      });
    }
    if (!validSha256(pkg.manifestFingerprint)) {
      addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "package.manifestFingerprint must be a sha256 fingerprint", {
        field: "package.manifestFingerprint",
        repairHint: "regenerate the artifact with package manifest fingerprint metadata"
      });
    }
  }
  if (!validSha256(artifact.sourceGraph?.fingerprint)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "sourceGraph.fingerprint must be a sha256 fingerprint", {
      field: "sourceGraph.fingerprint",
      repairHint: "regenerate the artifact with source graph fingerprint metadata"
    });
  }
}

function validateAirpkgAbi(artifact, diagnostics, checks) {
  const airAbi = artifact?.abi?.airAbiRequired;
  if (!airAbi) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "abi.airAbiRequired is required", {
      field: "abi.airAbiRequired",
      repairHint: "regenerate the artifact with AIR ABI metadata"
    });
  } else if (isCandidateAbi012(airAbi)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.candidate_unsupported", "AIR ABI 0.12 candidate artifacts are not admitted by .airpkg transport", {
      field: "abi.airAbiRequired",
      expected: AIR_ABI_VERSION,
      actual: airAbi,
      repairHint: "use the unpacked candidate package/interface checker"
    });
  } else if (airAbi !== AIR_ABI_VERSION) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.profile_mismatch", `AIR ABI ${airAbi} is not supported by this tool (${AIR_ABI_VERSION})`, {
      field: "abi.airAbiRequired",
      expected: AIR_ABI_VERSION,
      actual: airAbi,
      repairHint: "use compatible tooling or regenerate the artifact after an accepted AIR ABI migration"
    });
  } else {
    addCheck(checks, "air-abi", "pass", `AIR ABI ${AIR_ABI_VERSION} is supported`);
  }
  const hostAbi = artifact?.abi?.hostAbiRequired;
  if (!hostAbi) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "abi.hostAbiRequired is required", {
      field: "abi.hostAbiRequired",
      repairHint: "regenerate the artifact with Host ABI metadata"
    });
  }
}

function validateNoAbsolutePaths(artifact, diagnostics, checks) {
  const offenders = [];
  visitWithPath(artifact, (value, pointer) => {
    if (typeof value === "string" && looksAbsolutePath(value)) offenders.push({ pointer, value });
  });
  for (const offender of offenders) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.absolute_path", `artifact metadata contains absolute path at ${offender.pointer}`, {
      field: offender.pointer,
      repairHint: "regenerate the artifact with package-relative or artifact-relative paths"
    });
  }
  if (!offenders.length) addCheck(checks, "absolute-paths", "pass", "artifact metadata contains no absolute paths");
}

function validateNoTimestampFields(artifact, diagnostics, checks) {
  const offenders = [];
  visitWithPath(artifact, (_value, pointer, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt|date/i.test(key)) offenders.push(pointer);
  });
  for (const pointer of offenders) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", `timestamp-like deterministic metadata field is not allowed: ${pointer}`, {
      field: pointer,
      repairHint: "remove timestamp-like fields from deterministic artifact metadata"
    });
  }
  if (!offenders.length) addCheck(checks, "timestamps", "pass", "artifact metadata contains no timestamp-like fields");
}

function validateLinkedOutput(artifact, diagnostics, checks, context) {
  const linked = artifact?.linkedOutput;
  if (!linked || typeof linked !== "object" || Array.isArray(linked)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "linkedOutput metadata is required", {
      field: "linkedOutput",
      repairHint: "regenerate the artifact with linked output metadata"
    });
    return;
  }
  if (!LINKED_OUTPUT_STATUS.has(linked.status)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "linkedOutput.status is invalid", {
      field: "linkedOutput.status",
      actual: linked.status,
      repairHint: "use one of: available, deferred, planned"
    });
  }
  if (!LINKED_OUTPUT_KIND.has(linked.kind)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "linkedOutput.kind is invalid", {
      field: "linkedOutput.kind",
      actual: linked.kind,
      repairHint: "use one of: link-plan, none, wasm, wat"
    });
  }
  if (linked.linkPlanHash !== null && linked.linkPlanHash !== undefined && !validSha256(linked.linkPlanHash)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "linkedOutput.linkPlanHash must be a sha256 fingerprint when present", {
      field: "linkedOutput.linkPlanHash",
      repairHint: "regenerate the artifact with a stable link-plan hash"
    });
  }
  if (linked.sourceGraphHash !== null && linked.sourceGraphHash !== undefined && !validSha256(linked.sourceGraphHash)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "linkedOutput.sourceGraphHash must be a sha256 fingerprint when present", {
      field: "linkedOutput.sourceGraphHash",
      repairHint: "regenerate the artifact with a stable source graph hash"
    });
  }
  if (linked.path) {
    const rel = normalizeRelative(linked.path);
    if (looksUnsafeRelativePath(rel)) {
      addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "linkedOutput.path must be artifact-relative", {
        field: "linkedOutput.path",
        actual: linked.path,
        repairHint: "store linked output paths relative to the artifact directory"
      });
      return;
    }
    const linkedFile = path.join(context.artifactDir, rel);
    if (!fs.existsSync(linkedFile) || !fs.statSync(linkedFile).isFile()) {
      addArtifactDiagnostic(diagnostics, checks, "air.artifact.missing_linked_output", `linked output does not exist: ${rel}`, {
        field: "linkedOutput.path",
        path: rel,
        repairHint: "place the linked output beside the artifact or regenerate the artifact without available linked output metadata"
      });
      return;
    }
    const expected = linked.hash || (linked.kind === "wasm" ? linked.wasmHash : linked.kind === "wat" ? linked.watHash : null);
    if (expected) {
      const actual = fileFingerprint(linkedFile);
      if (actual !== expected) {
        addArtifactDiagnostic(diagnostics, checks, "air.artifact.hash_mismatch", `linked output hash mismatch for ${rel}`, {
          field: "linkedOutput.hash",
          path: rel,
          expected,
          actual,
          repairHint: "regenerate the linked output or regenerate the airpkg artifact"
        });
      } else {
        addCheck(checks, "linked-output-hash", "pass", `linked output hash matches ${rel}`);
      }
    }
  } else if (linked.status === "available") {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.missing_linked_output", "linkedOutput.status is available but linkedOutput.path is missing", {
      field: "linkedOutput.path",
      repairHint: "record an artifact-relative linked output path or mark linked output as planned/deferred"
    });
  } else {
    addCheck(checks, "linked-output", "pass", `linked output status is ${linked.status || "unknown"}`);
  }
}

function validateRuntimeBoundary(artifact, diagnostics, checks) {
  const runtimeRequires = artifact?.boundary?.runtimeRequires;
  if (!Array.isArray(runtimeRequires)) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.schema_invalid", "boundary.runtimeRequires must be an array", {
      field: "boundary.runtimeRequires",
      repairHint: "regenerate the artifact with runtime boundary metadata"
    });
    return;
  }
  const violations = runtimeRequires.filter((item) => {
    const lower = String(item || "").toLowerCase();
    return FORBIDDEN_RUNTIME_REQUIREMENTS.some((forbidden) => lower.includes(forbidden));
  });
  for (const item of violations) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.runtime_boundary_violation", `runtime artifact must not require ${item}`, {
      field: "boundary.runtimeRequires",
      requirement: item,
      repairHint: "move build-time tools out of runtime requirements"
    });
  }
  if (!violations.length) addCheck(checks, "runtime-boundary", "pass", "runtime requirements do not include build-time tools");
}

function validateProfileCompatibility(artifact, diagnostics, checks, options) {
  if (!options.profile) return;
  let profile = null;
  try {
    profile = loadHostProfile(options.profile);
  } catch (err) {
    addArtifactDiagnostic(diagnostics, checks, "air.artifact.profile_mismatch", err.message, {
      field: "profile",
      profile: options.profile,
      repairHint: "choose a known host profile"
    });
    return;
  }
  const profileReport = createHostProfileReport({
    profileId: options.profile,
    hostAbi: artifact?.abi?.hostAbiRequired,
    capabilities: artifactCapabilities(artifact),
    hostImports: artifactHostImports(artifact),
    manifestKinds: artifactManifestKinds(artifact),
    assetKinds: artifactAssetKinds(artifact),
    targetProfiles: artifact?.hostProfiles?.requested || []
  }, profile);
  if (profileReport.status === "fail") {
    for (const message of profileReport.errors) {
      addArtifactDiagnostic(diagnostics, checks, "air.artifact.profile_mismatch", message, {
        field: "profile",
        profile: options.profile,
        repairHint: "select a compatible profile or regenerate the artifact for this profile"
      });
    }
  } else {
    addCheck(checks, "profile", "pass", `profile ${options.profile} is compatible`);
  }
}

function finalizeAirpkgValidation(input, artifact, diagnostics, checks, context) {
  const normalizedDiagnostics = sortDiagnostics(diagnostics.map((diagnostic) => normalizeDiagnostic(diagnostic)));
  const status = normalizedDiagnostics.some((diagnostic) => diagnostic.severity === "fail") ? "fail" :
    normalizedDiagnostics.some((diagnostic) => diagnostic.severity === "warn") ? "warn" : "pass";
  return stableObject({
    schemaVersion: AIRPKG_VALIDATION_SCHEMA_VERSION,
    kind: "airpkg.validation",
    status,
    artifact: {
      path: input ? normalizeDisplayPath(input) : null,
      schemaVersion: artifact?.schemaVersion || null,
      package: artifact?.package?.name || null
    },
    profile: context.profile,
    checks: checks.sort((a, b) => String(a.id).localeCompare(String(b.id)) || String(a.message).localeCompare(String(b.message))),
    diagnostics: normalizedDiagnostics
  });
}

function addArtifactDiagnostic(diagnostics, checks, code, message, options = {}) {
  const severity = options.severity || "fail";
  const field = options.field || null;
  diagnostics.push({
    code,
    severity,
    category: "artifact",
    source: "airpkg-check",
    message,
    repairHint: options.repairHint || null,
    fields: stableObject({
      actual: options.actual === undefined ? null : options.actual,
      expected: options.expected === undefined ? null : options.expected,
      field,
      path: options.path || null,
      profile: options.profile || null,
      requirement: options.requirement || null
    })
  });
  addCheck(checks, code, severity, message, options.repairHint || null);
}

function addCheck(checks, id, status, message, repairHint = null) {
  checks.push({ id, status, message, repairHint });
}

function artifactCapabilities(artifact) {
  return sortedStrings([
    ...(artifact?.authority?.capabilities?.required || []),
    ...(artifact?.authority?.capabilities?.computed || []),
    ...(artifact?.authority?.capabilities?.declared || [])
  ]);
}

function artifactHostImports(artifact) {
  return sortedStrings(artifact?.authority?.hostImports?.used || artifact?.linkedOutput?.hostImports?.used || []);
}

function artifactManifestKinds(artifact) {
  return sortedStrings((artifact?.manifests?.refs || []).map((item) => item.kind));
}

function artifactAssetKinds(artifact) {
  return sortedStrings(artifact?.manifests?.resourceSummary?.assetKinds?.required || []);
}

function packageIdentity(base, manifest, metadata) {
  return {
    name: metadata.name,
    version: metadata.version,
    manifestPath: PACKAGE_MANIFEST_FILE,
    manifestFingerprint: fileFingerprint(path.join(base, PACKAGE_MANIFEST_FILE))
  };
}

function sourceGraphSummary(report) {
  return {
    entrypoint: report.entry || null,
    moduleCount: (report.modules || []).length,
    edgeCount: (report.graph?.edges || []).length,
    modules: (report.modules || []).map((item) => ({
      path: item.path,
      name: item.name,
      exports: item.exports || [],
      privateFunctions: item.privateFunctions || [],
      capabilities: item.capabilities || [],
      hostImports: item.hostImports || [],
      staticTables: (item.staticTables || []).map((table) => ({
        name: table.name,
        elementType: table.elementType || table.type,
        length: table.length
      }))
    })).sort((a, b) => a.path.localeCompare(b.path)),
    graph: {
      order: (report.graph?.order || []).slice(),
      edges: (report.graph?.edges || []).slice().sort((a, b) =>
        String(a.from || "").localeCompare(String(b.from || "")) ||
        String(a.to || "").localeCompare(String(b.to || "")) ||
        String(a.import || "").localeCompare(String(b.import || "")))
    },
    fingerprint: objectFingerprint({
      entrypoint: report.entry || null,
      modules: (report.modules || []).map((item) => ({
        path: item.path,
        name: item.name,
        exports: item.exports || [],
        privateFunctions: item.privateFunctions || []
      })),
      graph: report.graph || { order: [], edges: [] }
    })
  };
}

function abiSummary(metadata) {
  return {
    airAbiRequired: metadata.airAbi || AIR_ABI_VERSION,
    hostAbiRequired: metadata.hostAbi || metadata.airAbi || AIR_ABI_VERSION,
    airAbiBumpRequired: false,
    hostAbiBumpRequired: false
  };
}

function hostProfileSummary(metadata, checkReport, options) {
  const checked = options.profile || null;
  const support = checkReport.profileSupport || null;
  return {
    requested: metadata.targetProfiles || [],
    checked,
    compatible: support && support.status === "pass" ? [support.id] : [],
    incompatible: support && support.status === "fail" ? [support.id] : [],
    support
  };
}

function authoritySummary(checkReport, packageReport) {
  return {
    capabilities: {
      declared: checkReport.declaredCapabilities || packageReport.declaredCapabilities || [],
      computed: checkReport.computedCapabilities || packageReport.computedCapabilities || [],
      required: checkReport.capabilities?.required || []
    },
    hostImports: {
      used: checkReport.hostImports?.used || packageReport.hostImports?.used || [],
      unsupported: checkReport.hostImports?.unsupported || []
    },
    capabilityOrigins: packageReport.capabilityOrigins || checkReport.capabilityOrigins || {},
    hostImportOrigins: packageReport.hostImportOrigins || checkReport.hostImportOrigins || {},
    authorityChains: packageReport.authorityChains || checkReport.authorityChains || []
  };
}

function generatedArtifactSummary(report) {
  return {
    generatedArtifacts: normalizeGeneratedReport(report.generatedArtifacts),
    generatedHandles: normalizeGeneratedReport(report.generatedHandles)
  };
}

function normalizeGeneratedReport(report) {
  if (!report) return null;
  return {
    ok: Boolean(report.ok),
    files: (report.files || []).map((item) => ({
      path: item.path,
      status: item.status,
      fingerprint: prefixFingerprint(item.fingerprint),
      expectedFingerprint: prefixFingerprint(item.expectedFingerprint),
      manifestFingerprint: item.manifestFingerprint || null,
      expectedManifestFingerprint: item.expectedManifestFingerprint || null,
      sources: (item.sources || []).map((source) => ({
        ref: source.ref,
        path: source.path,
        exists: Boolean(source.exists)
      })).sort((a, b) => a.path.localeCompare(b.path)),
      generators: (item.generators || []).map((generator) => ({
        ref: generator.ref,
        path: generator.path,
        exists: Boolean(generator.exists)
      })).sort((a, b) => a.path.localeCompare(b.path))
    })).sort((a, b) => a.path.localeCompare(b.path)),
    warnings: report.warnings || [],
    errors: report.errors || []
  };
}

function manifestSummary(manifest, checkReport) {
  const refs = Object.entries(manifest.manifests || {})
    .map(([kind, ref]) => ({
      kind,
      path: ref.path,
      exists: Boolean(ref.exists)
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
  return {
    refs,
    resourceSummary: {
      assetKinds: checkReport.assetKinds || { required: [], supported: [], unsupported: [] },
      assets: checkReport.assets ? {
        status: checkReport.assets.status || null,
        warnings: (checkReport.assets.warnings || []).length,
        errors: (checkReport.assets.errors || []).length
      } : null
    }
  };
}

function reportSummary(packageReport, checkReport) {
  const review = packageReport.packageReview || null;
  const diagnostics = (checkReport.diagnostics || []).concat(packageReport.diagnostics || []);
  return {
    schemaVersion: packageReport.reportVersion || checkReport.reportVersion || "0.15",
    packageStatus: checkReport.status,
    graphStatus: packageReport.status,
    reviewSummary: {
      status: review ? review.status : null,
      warningCount: review ? (review.warnings || []).length : 0,
      moduleCount: review ? (review.modules || []).length : 0
    },
    diagnosticsSummary: diagnosticsSummary(diagnostics, checkReport.checks || []),
    summaryFingerprint: objectFingerprint({
      packageStatus: checkReport.status,
      graphStatus: packageReport.status,
      warnings: checkReport.warnings || [],
      errors: checkReport.errors || [],
      graphWarnings: packageReport.warnings || [],
      graphErrors: packageReport.errors || [],
      diagnostics: diagnostics.map((item) => ({
        code: item.code,
        file: item.file,
        legacyId: item.legacyId,
        message: item.message,
        severity: item.severity
      }))
    })
  };
}

function diagnosticsSummary(diagnostics, checks) {
  const byCode = {};
  const bySeverity = {};
  for (const diagnostic of diagnostics || []) {
    if (diagnostic.code) byCode[diagnostic.code] = (byCode[diagnostic.code] || 0) + 1;
    if (diagnostic.severity) bySeverity[diagnostic.severity] = (bySeverity[diagnostic.severity] || 0) + 1;
  }
  return {
    total: (diagnostics || []).length,
    byCode,
    bySeverity,
    checks: {
      pass: checks.filter((item) => item.status === "pass").length,
      warn: checks.filter((item) => item.status === "warn").length,
      fail: checks.filter((item) => item.status === "fail").length,
      skip: checks.filter((item) => item.status === "skip").length
    }
  };
}

function linkedWasmSummary(packageReport, checkReport) {
  const deferred = (checkReport.checks || []).some((item) => item.id === "linked-wasm-deferred") ||
    Boolean((packageReport.graph?.edges || []).length);
  return {
    enabled: false,
    status: deferred ? "deferred" : "not-required",
    warning: deferred ? "Multi-module packages are validated as authored source graphs, but linked multi-module Wasm output is deferred." : null
  };
}

function linkedOutputSummary(base, metadata, linkPlan) {
  const built = builtLinkedOutput(base, metadata);
  const available = Boolean(built);
  return {
    status: available ? "available" : ((linkPlan.moduleOrder || []).length ? "planned" : "deferred"),
    kind: available ? built.kind : ((linkPlan.moduleOrder || []).length ? "link-plan" : "none"),
    hash: available ? built.hash : null,
    path: available ? built.path : null,
    linkPlanHash: objectFingerprint(linkPlanForHash(linkPlan)),
    sourceGraphHash: linkPlan.sourceGraphHash || null,
    moduleOrder: (linkPlan.moduleOrder || []).slice(),
    packageExports: [
      ...(linkPlan.entrypoint?.packageExports || []),
      ...(linkPlan.entrypoint?.packageExports || []).length ? [] : (linkPlan.entrypoint?.compatibilityExports || [])
    ].map((item) => ({
      name: item.name,
      module: item.module,
      function: item.function
    })).sort(comparePackageExport),
    hostImports: linkPlan.hostImports,
    capabilities: linkPlan.capabilities,
    abiImpact: linkPlan.abiImpact,
    linkedWasm: available && built.kind === "wasm"
  };
}

function builtLinkedOutput(base, metadata) {
  if (!metadata.wasm) return null;
  const rel = normalizeRelative(metadata.wasm);
  const file = path.join(base, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const ext = path.extname(rel).toLowerCase();
  return {
    kind: ext === ".wat" ? "wat" : ext === ".wasm" ? "wasm" : "none",
    path: rel,
    hash: fileFingerprint(file)
  };
}

function linkPlanForHash(linkPlan) {
  return {
    schemaVersion: linkPlan.schemaVersion,
    package: linkPlan.package,
    moduleOrder: linkPlan.moduleOrder,
    sourceGraphHash: linkPlan.sourceGraphHash,
    graph: linkPlan.graph,
    symbols: linkPlan.symbols,
    packageExports: [
      ...(linkPlan.entrypoint?.packageExports || []),
      ...(linkPlan.entrypoint?.packageExports || []).length ? [] : (linkPlan.entrypoint?.compatibilityExports || [])
    ].map((item) => ({ name: item.name, module: item.module, function: item.function })),
    hostImports: linkPlan.hostImports,
    capabilities: linkPlan.capabilities,
    generatedArtifacts: linkPlan.generatedArtifacts,
    staticTables: linkPlan.staticTables,
    abiImpact: linkPlan.abiImpact
  };
}

function boundarySummary(metadata, report) {
  const sourceModules = (report.modules || []).map((item) => item.path).sort();
  const generated = normalizeGeneratedReport(report.generatedArtifacts);
  const generatedFiles = generated ? generated.files.map((item) => item.path) : [];
  return {
    runtimeRequires: [],
    runtimeRequired: [
      PACKAGE_MANIFEST_FILE,
      ...(metadata.wasm ? [metadata.wasm] : []),
      ...Object.values(metadata.manifests || {}).map((item) => item.path),
      ...generatedFiles
    ].filter(Boolean).sort(),
    buildTimeOnly: sourceModules,
    forbiddenAtRuntime: [
      "Codex",
      "Node",
      "Python",
      "build scripts",
      "npm install",
      "source AIR repo"
    ]
  };
}

function fileFingerprint(file) {
  return prefixFingerprint(hashBytes(fs.readFileSync(file)));
}

function objectFingerprint(value) {
  return prefixFingerprint(hashBytes(stableStringify(value)));
}

function prefixFingerprint(value) {
  if (!value) return null;
  return String(value).startsWith("sha256:") ? value : `sha256:${value}`;
}

function normalizeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function comparePackageExport(a, b) {
  return String(a.name || "").localeCompare(String(b.name || "")) ||
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.function || "").localeCompare(String(b.function || ""));
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value), null, 2);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  visit(value, (item) => {
    if (typeof item === "string" && looksAbsolutePath(item)) offenders.push(item);
  });
  if (offenders.length) {
    throw new Error(`airpkg metadata contains absolute path: ${offenders.slice(0, 3).join(", ")}`);
  }
}

function visit(value, fn) {
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) visit(item, fn);
  }
}

function visitWithPath(value, fn, pointer = "$", key = null) {
  fn(value, pointer, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitWithPath(item, fn, `${pointer}[${index}]`, String(index)));
  } else if (value && typeof value === "object") {
    for (const childKey of Object.keys(value).sort()) {
      visitWithPath(value[childKey], fn, pointer === "$" ? childKey : `${pointer}.${childKey}`, childKey);
    }
  }
}

function looksAbsolutePath(value) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function looksUnsafeRelativePath(value) {
  return looksAbsolutePath(value) || String(value || "").split("/").includes("..");
}

function validSha256(value) {
  return /^sha256:[a-f0-9]{64}$/.test(String(value || ""));
}

function stableName(value) {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(String(value || ""));
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

function normalizeDisplayPath(input) {
  return normalizeRelative(path.basename(String(input || "")));
}

module.exports = {
  AIRPKG_SCHEMA_VERSION,
  AIRPKG_VALIDATION_SCHEMA_VERSION,
  checkAirpkgArtifact,
  createAirpkgArtifact,
  inspectAirpkg,
  stableStringify,
  writeAirpkgArtifact
};
