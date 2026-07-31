"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { formatModule } = require("./format");
const { reportPackageDir } = require("./sdk");
const { normalizePackageMetadata, validatePackageManifest } = require("./package_manifest");
const { AIR_VERSION } = require("./version");

const SEMANTIC_PATCH_SCHEMA_VERSION = "1.0";
const SEMANTIC_PATCH_KIND = "air.semanticPatch";
const SEMANTIC_PATCH_EVIDENCE_KIND = "air.semanticPatchEvidence";
const PATCH_DOMAIN = "AIR_SEMANTIC_PATCH_V1\0";
const ANALYZER_DOMAIN = "AIR_SEMANTIC_PATCH_ANALYZER_V1\0";
const CLASSIFICATIONS = Object.freeze([
  "semantic_noop",
  "narrowing",
  "compatible_change",
  "capability_expansion",
  "effect_expansion",
  "resource_expansion",
  "export_expansion",
  "contract_weakening",
  "provenance_policy_expansion",
  "declassification_authority_expansion",
  "mixed_expansion",
  "unknown_unproven"
]);
const STRICT_ACCEPTED = new Set(["semantic_noop", "narrowing", "compatible_change"]);
const FLOW_LABELS = Object.freeze(["public", "internal", "sensitive", "restricted"]);
const LIMITS = Object.freeze({
  maxModules: 64,
  maxFunctions: 512,
  maxOperations: 256,
  maxEvidenceEntries: 2048,
  maxDependencyDepth: 32,
  maxFindings: 1024
});

class SemanticPatchError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "SemanticPatchError";
    this.code = code;
    this.details = stableObject(details);
  }
}

function createSemanticPatch(basePackageDir, resultPackageDir, options = {}) {
  const base = snapshotPackage(basePackageDir);
  const result = snapshotPackage(resultPackageDir);
  const operations = createOperations(base, result);
  const analysis = compareSnapshots(base, result);
  enforceGenerationLimits(base, result, operations, analysis);
  const patch = {
    schemaVersion: SEMANTIC_PATCH_SCHEMA_VERSION,
    kind: SEMANTIC_PATCH_KIND,
    analyzer: analyzerIdentity(),
    policyMode: options.policyMode === "review" ? "review" : "strict",
    creationAuthority: stableObject({
      authoritySource: stringOrNull(options.authoritySource) || "unspecified",
      actor: stringOrNull(options.actor),
      humanForced: Boolean(options.humanForced),
      humanReasonCode: stringOrNull(options.humanReasonCode)
    }),
    base: publicIdentity(base),
    expectedResult: publicIdentity(result),
    operations,
    analysis,
    analysisDigest: hashStable(analysis, ANALYZER_DOMAIN),
    limits: { ...LIMITS }
  };
  patch.patchDigest = patchDigest(patch);
  return stableObject(patch);
}

function inspectSemanticPatch(input, options = {}) {
  const patch = loadPatch(input);
  const validation = validatePatch(patch);
  const strict = options.strict === undefined ? patch.policyMode === "strict" : Boolean(options.strict);
  const classification = patch.analysis && patch.analysis.classification || "unknown_unproven";
  const rejectedReasons = validation.diagnostics.slice();
  if (strict && !STRICT_ACCEPTED.has(classification)) {
    rejectedReasons.push(`strict mode rejects ${classification}`);
  }
  if (strict && classification === "compatible_change" && !(patch.analysis && patch.analysis.compatibility && patch.analysis.compatibility.proven)) {
    rejectedReasons.push("strict mode requires every compatibility invariant to be proven");
  }
  const status = rejectedReasons.length ? "rejected" : "accepted";
  const evidence = {
    schemaVersion: SEMANTIC_PATCH_SCHEMA_VERSION,
    kind: SEMANTIC_PATCH_EVIDENCE_KIND,
    mode: strict ? "strict" : "review",
    status,
    baseDigest: patch.base && patch.base.packageDigest || null,
    resultDigest: patch.expectedResult && patch.expectedResult.packageDigest || null,
    patchDigest: patch.patchDigest || null,
    operationCount: Array.isArray(patch.operations) ? patch.operations.length : 0,
    classifications: [classification],
    expansions: cloneList(patch.analysis && patch.analysis.expansions),
    narrowings: cloneList(patch.analysis && patch.analysis.narrowings),
    compatibilityFindings: cloneList(patch.analysis && patch.analysis.compatibility && patch.analysis.compatibility.findings),
    provenanceFindings: cloneList(patch.analysis && patch.analysis.provenanceFindings),
    resourceFindings: cloneList(patch.analysis && patch.analysis.resourceFindings),
    rejectedReasons: sortedStrings(rejectedReasons),
    analyzerDigest: patch.analyzer && patch.analyzer.digest || null
  };
  evidence.summaryDigest = hashStable(evidence, ANALYZER_DOMAIN);
  return stableObject(evidence);
}

function applySemanticPatch(basePackageDir, input, outputPackageDir, options = {}) {
  const patch = loadPatch(input);
  const validation = validatePatch(patch);
  if (validation.diagnostics.length) {
    throw new SemanticPatchError("air.semantic_patch.invalid", validation.diagnostics.join("; "));
  }
  const inspection = inspectSemanticPatch(patch, options);
  if (inspection.status !== "accepted") {
    throw new SemanticPatchError("air.semantic_patch.strict_rejected", inspection.rejectedReasons.join("; "), {
      classification: inspection.classifications[0]
    });
  }
  const base = snapshotPackage(basePackageDir);
  assertIdentity("base", patch.base, base);
  const output = path.resolve(outputPackageDir || "");
  if (!output || output === path.parse(output).root) {
    throw new SemanticPatchError("air.semantic_patch.output_invalid", "output directory must be a bounded non-root path");
  }
  if (fs.existsSync(output) && fs.readdirSync(output).length) {
    throw new SemanticPatchError("air.semantic_patch.output_not_empty", "output directory must be absent or empty");
  }
  fs.mkdirSync(output, { recursive: true });
  copyDirectory(path.resolve(basePackageDir), output);
  for (const operation of patch.operations) applyOperation(output, operation);
  const result = snapshotPackage(output);
  assertIdentity("result", patch.expectedResult, result);
  const recomputed = compareSnapshots(base, result);
  const recomputedDigest = hashStable(recomputed, ANALYZER_DOMAIN);
  if (recomputedDigest !== patch.analysisDigest || !sameJson(recomputed, patch.analysis)) {
    throw new SemanticPatchError("air.semantic_patch.analysis_mismatch", "recomputed semantic classification differs from the patch");
  }
  return stableObject({
    status: "applied",
    outputPackageDigest: result.packageDigest,
    outputModuleDigests: result.moduleDigests,
    evidence: inspection
  });
}

function validatePatch(input) {
  const patch = input && typeof input === "object" ? input : {};
  const diagnostics = [];
  if (patch.schemaVersion !== SEMANTIC_PATCH_SCHEMA_VERSION || patch.kind !== SEMANTIC_PATCH_KIND) {
    diagnostics.push("unsupported semantic patch schema or kind");
  }
  if (!patch.base || !validDigest(patch.base.packageDigest)) diagnostics.push("base package digest is missing or invalid");
  if (!patch.expectedResult || !validDigest(patch.expectedResult.packageDigest)) diagnostics.push("result package digest is missing or invalid");
  if (!patch.analyzer || !validDigest(patch.analyzer.digest)) diagnostics.push("analyzer identity is missing or invalid");
  if (!CLASSIFICATIONS.includes(patch.analysis && patch.analysis.classification)) diagnostics.push("classification is missing or invalid");
  if (!Array.isArray(patch.operations)) diagnostics.push("operations must be an array");
  const operations = Array.isArray(patch.operations) ? patch.operations : [];
  if (operations.length > LIMITS.maxOperations) diagnostics.push(`operation count exceeds ${LIMITS.maxOperations}`);
  const keys = operations.map(operationKey);
  if (new Set(keys).size !== keys.length) diagnostics.push("duplicate operation target");
  if (!sameJson(keys, keys.slice().sort())) diagnostics.push("operations are not in canonical order");
  for (const operation of operations) {
    if (!["add_semantic_object", "remove_semantic_object", "replace_semantic_object"].includes(operation.op)) {
      diagnostics.push(`unsupported operation ${JSON.stringify(operation.op)}`);
    }
    if (!operation.target || !["package_manifest", "module", "schema"].includes(operation.target.kind)) {
      diagnostics.push("operation target kind is invalid");
    }
    if (!safeRelativePath(operation.target && operation.target.path)) diagnostics.push("operation target path is invalid");
    if (!validDigest(operation.operationDigest) || operation.operationDigest !== operationDigest(operation)) {
      diagnostics.push(`operation digest mismatch for ${operationKey(operation)}`);
    }
  }
  if (!validDigest(patch.analysisDigest) || patch.analysisDigest !== hashStable(patch.analysis || {}, ANALYZER_DOMAIN)) {
    diagnostics.push("analysis digest mismatch");
  }
  if (!validDigest(patch.patchDigest) || patch.patchDigest !== patchDigest(patch)) diagnostics.push("patch digest mismatch");
  return stableObject({ ok: diagnostics.length === 0, diagnostics: sortedStrings(diagnostics) });
}

function snapshotPackage(packageDir) {
  const base = path.resolve(packageDir || "");
  if (!base || !fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new SemanticPatchError("air.semantic_patch.package_missing", "package directory does not exist");
  }
  let validated;
  try {
    validated = validatePackageManifest(base, { built: false });
  } catch (err) {
    throw new SemanticPatchError("air.semantic_patch.package_invalid", err && err.message ? err.message : String(err));
  }
  const rawManifest = JSON.parse(fs.readFileSync(path.join(base, "air.package.json"), "utf8"));
  const metadata = normalizePackageMetadata(rawManifest);
  let report;
  try {
    report = reportPackageDir(base);
  } catch (err) {
    throw new SemanticPatchError("air.semantic_patch.package_report_failed", err && err.message ? err.message : String(err));
  }
  const modulePaths = sortedStrings([
    metadata.entry,
    ...metadata.generatedModules,
    ...(report.modules || []).map((item) => item.path)
  ]);
  if (modulePaths.length > LIMITS.maxModules) {
    throw new SemanticPatchError("air.semantic_patch.analysis_budget_exceeded", `package has ${modulePaths.length} modules; maximum is ${LIMITS.maxModules}`);
  }
  const documentPaths = sortedStrings([
    "air.package.json",
    ...modulePaths,
    ...metadata.factSchemas,
    ...metadata.structuredIO,
    ...metadata.outputContracts,
    ...metadata.commandBuffers,
    ...Object.values(metadata.manifests || {}).map((item) => item && item.path)
  ]);
  const documents = {};
  const modules = {};
  for (const relative of documentPaths) {
    if (!safeRelativePath(relative)) throw new SemanticPatchError("air.semantic_patch.path_invalid", `unsafe package path ${JSON.stringify(relative)}`);
    const absolute = path.join(base, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new SemanticPatchError("air.semantic_patch.document_missing", `semantic document does not exist: ${relative}`);
    }
    const document = snapshotDocument(relative, absolute);
    documents[relative] = document;
    if (document.kind === "module") modules[relative] = document.semantic;
  }
  const functionCount = Object.values(modules).reduce((sum, item) => sum + Object.keys(item.functions || {}).length, 0);
  if (functionCount > LIMITS.maxFunctions) {
    throw new SemanticPatchError("air.semantic_patch.analysis_budget_exceeded", `package has ${functionCount} functions; maximum is ${LIMITS.maxFunctions}`);
  }
  const dependencyDepth = graphDependencyDepth(report.graph);
  if (dependencyDepth > LIMITS.maxDependencyDepth) {
    throw new SemanticPatchError("air.semantic_patch.analysis_budget_exceeded", `package dependency depth is ${dependencyDepth}; maximum is ${LIMITS.maxDependencyDepth}`);
  }
  const moduleDigests = stableObject(Object.fromEntries(Object.entries(documents)
    .filter(([, item]) => item.kind === "module")
    .map(([relative, item]) => [relative, item.digest])));
  const documentDigests = stableObject(Object.fromEntries(Object.entries(documents)
    .map(([relative, item]) => [relative, item.digest])));
  const summary = createPackageSummary(rawManifest, report, modules, dependencyDepth);
  const packageDigest = hashStable({
    manifestDigest: documents["air.package.json"].digest,
    moduleDigests,
    documentDigests,
    summary
  }, PATCH_DOMAIN);
  return {
    base,
    packageName: metadata.name,
    packageDigest,
    manifestDigest: documents["air.package.json"].digest,
    moduleDigests,
    documentDigests,
    documents,
    summary
  };
}

function snapshotDocument(relative, absolute) {
  const extension = path.extname(relative).toLowerCase();
  if (extension === ".air") {
    const source = fs.readFileSync(absolute, "utf8");
    const mod = parseAir(source, relative, { resolveSourceImports: false });
    const content = formatModule(mod);
    const canonicalModule = parseAir(content, relative, { resolveSourceImports: false });
    return {
      kind: "module",
      content,
      digest: hashText(content, PATCH_DOMAIN),
      semantic: summarizeModule(canonicalModule, content)
    };
  }
  if (extension === ".json") {
    const value = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const content = stableStringify(value);
    return {
      kind: relative === "air.package.json" ? "package_manifest" : "schema",
      content,
      digest: hashText(content, PATCH_DOMAIN),
      semantic: stableObject(value)
    };
  }
  const content = fs.readFileSync(absolute, "utf8");
  return { kind: "unknown", content, digest: hashText(content, PATCH_DOMAIN), semantic: null };
}

function summarizeModule(mod, canonicalSource) {
  const functions = {};
  for (const fn of mod.functions || []) {
    functions[fn.name] = stableObject({
      name: fn.name,
      exported: Boolean(fn.exported),
      params: (fn.params || []).map((param) => ({
        name: param.name,
        type: param.type,
        declaredType: param.declaredType || param.type,
        refinement: param.refinement || null
      })),
      returnType: fn.returnType,
      returnDeclaredType: fn.returnDeclaredType || fn.returnType,
      returnRefinement: fn.returnRefinement || null,
      requires: normalizeContracts(fn.requires),
      ensures: normalizeContracts(fn.ensures),
      effects: normalizeEffects(fn.effects),
      bodyDigest: hashStable(stripLocations(fn.blocks || []), PATCH_DOMAIN)
    });
  }
  const externs = {};
  for (const item of mod.externs || []) {
    externs[item.name] = stableObject(stripLocations(item));
  }
  return stableObject({
    name: mod.name,
    digest: hashText(canonicalSource, PATCH_DOMAIN),
    capabilities: sortedStrings(Array.from(mod.capabilities || [])),
    explicitCapabilities: sortedStrings(Array.from(mod.explicitCapabilities || [])),
    uses: stripLocations(mod.uses || []),
    requires: normalizeContracts(mod.requires),
    ensures: normalizeContracts(mod.ensures),
    effects: normalizeEffects(mod.effects),
    flowDeclarations: (mod.flowDeclarations || []).map(normalizeFlowDeclaration).sort(compareStable),
    functions,
    externs,
    globals: stripLocations(mod.globals || []),
    states: stripLocations(mod.states || []),
    pools: stripLocations(mod.pools || [])
  });
}

function createPackageSummary(rawManifest, report, modules, dependencyDepth) {
  const effects = {};
  for (const [modulePath, usage] of Object.entries(report.effectUsageOrigins || {})) {
    for (const [key, value] of Object.entries(usage || {})) {
      if (typeof value === "number" && Number.isFinite(value) && isSemanticEffectKey(key)) {
        effects[`observed:${modulePath}:${key}`] = value;
      }
    }
  }
  for (const [modulePath, mod] of Object.entries(modules)) {
    for (const item of mod.effects || []) {
      if (isSemanticEffectKey(item.key)) effects[`declared:${modulePath}:module:${item.key}`] = item.limit;
    }
    for (const fn of Object.values(mod.functions || {})) {
      for (const item of fn.effects || []) {
        if (isSemanticEffectKey(item.key)) effects[`declared:${modulePath}:${fn.name}:${item.key}`] = item.limit;
      }
    }
  }
  const exports = {};
  const imports = {};
  const functions = {};
  const flow = {};
  const moduleContracts = {};
  for (const [modulePath, mod] of Object.entries(modules)) {
    moduleContracts[modulePath] = stableObject({
      requires: normalizeContracts(mod.requires),
      ensures: normalizeContracts(mod.ensures)
    });
    for (const fn of Object.values(mod.functions || {})) {
      const id = `${modulePath}::${fn.name}`;
      functions[id] = fn;
      if (fn.exported) exports[id] = exportAbiSignature(fn);
    }
    for (const [name, item] of Object.entries(mod.externs || {})) imports[`${modulePath}::extern:${name}`] = item;
    for (const item of mod.uses || []) imports[`${modulePath}::use:${stableStringify(item).trim()}`] = item;
    for (const declaration of mod.flowDeclarations || []) flow[`${modulePath}::${flowIdentity(declaration)}`] = declaration;
  }
  const rawFlow = rawManifest.provenanceFlow && typeof rawManifest.provenanceFlow === "object"
    ? stableObject(rawManifest.provenanceFlow)
    : null;
  const capabilities = sortedStrings([
    ...(report.declaredCapabilities || []),
    ...(report.computedCapabilities || []),
    ...((rawManifest && rawManifest.capabilities) || [])
  ]);
  const hostImports = sortedStrings((report.hostImports && report.hostImports.used) || []);
  return stableObject({
    capabilities,
    hostImports,
    effects,
    exports,
    imports,
    functions,
    moduleContracts,
    flow,
    provenancePolicy: rawFlow,
    resourceCertificate: normalizeResourceCertificate(report.resourceCertificate),
    schemaRoles: stableObject({
      facts: sortedStrings(rawManifest.factSchemas || []),
      structured: sortedStrings(rawManifest.structuredIO || []),
      outputs: sortedStrings(rawManifest.outputContracts || [])
    }),
    packageExports: Array.isArray(rawManifest.packageExports) ? rawManifest.packageExports : [],
    packageName: rawManifest.name || null,
    reportStatus: report.status || null,
    reportErrors: sortedStrings(report.errors || []),
    dependencyDepth
  });
}

function normalizeResourceCertificate(certificate) {
  if (!certificate || typeof certificate !== "object") return null;
  return stableObject({
    schemaVersion: certificate.schemaVersion || null,
    kind: certificate.kind || null,
    mode: certificate.mode || null,
    status: certificate.status || null,
    requiredBounds: certificate.requiredBounds || [],
    requiredBoundsSatisfied: certificate.requiredBoundsSatisfied !== false,
    verifier: certificate.verifier ? {
      version: certificate.verifier.version || null,
      digest: certificate.verifier.digest || null
    } : null,
    bounds: certificate.bounds || null,
    classifications: certificate.classifications || null,
    hostEnforcement: certificate.hostEnforcement || null
  });
}

function createOperations(base, result) {
  const keys = sortedStrings([...Object.keys(base.documents), ...Object.keys(result.documents)]);
  const operations = [];
  for (const relative of keys) {
    const oldDocument = base.documents[relative] || null;
    const newDocument = result.documents[relative] || null;
    if (oldDocument && newDocument && oldDocument.digest === newDocument.digest) continue;
    const target = {
      kind: newDocument && newDocument.kind || oldDocument && oldDocument.kind || "schema",
      path: relative
    };
    const operation = {
      op: !oldDocument ? "add_semantic_object" : !newDocument ? "remove_semantic_object" : "replace_semantic_object",
      target,
      expectedOldDigest: oldDocument ? oldDocument.digest : null,
      resultDigest: newDocument ? newDocument.digest : null,
      content: newDocument ? newDocument.content : null
    };
    operation.operationDigest = operationDigest(operation);
    operations.push(stableObject(operation));
  }
  return operations.sort((a, b) => operationKey(a).localeCompare(operationKey(b)));
}

function compareSnapshots(base, result) {
  const state = {
    expansions: [],
    narrowings: [],
    compatibilityFindings: [],
    provenanceFindings: [],
    resourceFindings: [],
    unknowns: [],
    changedBodies: 0
  };
  compareSets(base.summary.capabilities, result.summary.capabilities, "capability", state, "capability_expansion");
  compareSets(base.summary.hostImports, result.summary.hostImports, "host_import", state, "capability_expansion");
  compareNumericMap(base.summary.effects, result.summary.effects, "effect", state, "effect_expansion");
  compareResources(base.summary.resourceCertificate, result.summary.resourceCertificate, state);
  compareExports(base.summary.exports, result.summary.exports, state);
  compareImports(base.summary.imports, result.summary.imports, state);
  compareModuleContracts(base.summary.moduleContracts, result.summary.moduleContracts, state);
  compareFunctions(base.summary.functions, result.summary.functions, state);
  compareProvenance(base.summary, result.summary, state);
  compareSchemaDocuments(base, result, state);
  if ((base.summary.reportErrors || []).length || (result.summary.reportErrors || []).length) {
    addUnknown(state, "package_verification_incomplete", "package", base.summary.reportErrors || [], result.summary.reportErrors || []);
  }
  for (const [relative, document] of Object.entries(result.documents)) {
    if (document.kind === "unknown" && (!base.documents[relative] || base.documents[relative].digest !== document.digest)) {
      addUnknown(state, "unknown_semantic_document", relative, null, document.digest);
    }
  }
  enforceFindingLimit(state);
  const expansionClasses = sortedStrings(state.expansions.map((item) => item.classification));
  let classification;
  if (expansionClasses.length > 1) classification = "mixed_expansion";
  else if (expansionClasses.length === 1) classification = expansionClasses[0];
  else if (state.unknowns.length) classification = "unknown_unproven";
  else if (base.packageDigest === result.packageDigest) classification = "semantic_noop";
  else if (state.narrowings.length && state.changedBodies === 0) classification = "narrowing";
  else classification = "compatible_change";
  const compatibilityProven = state.unknowns.length === 0 &&
    !state.compatibilityFindings.some((item) => item.compatible === false) &&
    state.resourceFindings.every((item) => item.status !== "unknown");
  return stableObject({
    classification,
    classifications: [classification],
    expansions: state.expansions.sort(compareFinding),
    narrowings: state.narrowings.sort(compareFinding),
    compatibility: {
      proven: compatibilityProven,
      findings: state.compatibilityFindings.sort(compareFinding)
    },
    provenanceFindings: state.provenanceFindings.sort(compareFinding),
    resourceFindings: state.resourceFindings.sort(compareFinding),
    unknowns: state.unknowns.sort(compareFinding)
  });
}

function compareSets(oldValues, newValues, category, state, expansionClassification) {
  const oldSet = new Set(oldValues || []);
  const newSet = new Set(newValues || []);
  for (const value of Array.from(newSet).sort()) {
    if (!oldSet.has(value)) addExpansion(state, expansionClassification, category, value, null, value);
  }
  for (const value of Array.from(oldSet).sort()) {
    if (!newSet.has(value)) addNarrowing(state, category, value, value, null);
  }
}

function compareNumericMap(oldMap, newMap, category, state, expansionClassification) {
  for (const key of sortedStrings([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})])) {
    const oldValue = oldMap && oldMap[key];
    const newValue = newMap && newMap[key];
    if (oldValue === newValue) continue;
    if (oldValue == null || (newValue != null && newValue > oldValue)) {
      addExpansion(state, expansionClassification, category, key, oldValue, newValue);
    } else {
      addNarrowing(state, category, key, oldValue, newValue);
    }
  }
}

function compareResources(oldCertificate, newCertificate, state) {
  compareBorrowedMemoryCertificateSections(
    oldCertificate && oldCertificate.bounds && oldCertificate.bounds.borrowedMemory,
    newCertificate && newCertificate.bounds && newCertificate.bounds.borrowedMemory,
    state
  );
  const oldBounds = flattenResourceBounds(oldCertificate);
  const newBounds = flattenResourceBounds(newCertificate);
  if (!oldBounds || !newBounds) {
    state.resourceFindings.push(finding("resource", "certificate", oldBounds ? "available" : "missing", newBounds ? "available" : "missing", { status: "unknown" }));
    addUnknown(state, "resource_certificate_missing", "certificate", oldBounds, newBounds);
    return;
  }
  for (const key of sortedStrings([...Object.keys(oldBounds), ...Object.keys(newBounds)])) {
    const oldValue = oldBounds[key];
    const newValue = newBounds[key];
    if (oldValue === newValue) continue;
    const item = finding("resource", key, oldValue, newValue, { status: newValue > oldValue ? "expanded" : "narrowed" });
    state.resourceFindings.push(item);
    if (oldValue == null || (newValue != null && newValue > oldValue)) {
      addExpansion(state, "resource_expansion", "resource", key, oldValue, newValue);
    } else {
      addNarrowing(state, "resource", key, oldValue, newValue);
    }
  }
}

function flattenResourceBounds(certificate) {
  if (!certificate || !certificate.bounds || certificate.status !== "verified" ||
      (certificate.classifications && certificate.classifications.unknown || []).length) return null;
  const bounds = certificate.bounds;
  const out = {
    "loops.maximumStatic": numberOrNull(bounds.loops && bounds.loops.maximumStaticallyBoundedIterations),
    "loops.totalStatic": numberOrNull(bounds.loops && bounds.loops.totalStaticallyBoundedIterations),
    "loops.dynamicFuel": numberOrNull(bounds.loops && bounds.loops.totalDynamicLoopFuelUpperBound),
    "memory.staticBytes": numberOrNull(bounds.memory && bounds.memory.totalStaticBytesUpperBound),
    "memory.dynamicBytes": numberOrNull(bounds.memory && bounds.memory.dynamicAllocationBytesUpperBound),
    "hostCalls.total": numberOrNull(bounds.hostCalls && bounds.hostCalls.totalUpperBound),
    "outputs.total": numberOrNull(bounds.outputs && bounds.outputs.totalHostCallUpperBound),
    "borrowed.parameterCount": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.borrowedParameterCount),
    "borrowed.maximumTotalBytes": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumTotalBorrowedBytes),
    "borrowed.maximumReadableBytes": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumReadableBytes),
    "borrowed.maximumWritableBytes": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumWritableBytes),
    "borrowed.maximumCopyInBytes": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumCopyInBytes),
    "borrowed.maximumCopyOutBytes": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumCopyOutBytes),
    "borrowed.maximumTypedReads": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumTypedReads),
    "borrowed.maximumTypedWrites": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumTypedWrites),
    "borrowed.maximumReadBytes": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumReadBytes),
    "borrowed.maximumWriteBytes": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumWriteBytes),
    "borrowed.maximumDynamicBoundsChecks": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumDynamicBoundsChecks),
    "borrowed.maximumRelationChecks": numberOrNull(bounds.borrowedMemory && bounds.borrowedMemory.maximumRelationChecks),
    "borrowed.maximumHostBindingValidations": numberOrNull(
      bounds.borrowedMemory && bounds.borrowedMemory.maximumHostBindingValidationOperations
    )
  };
  for (const item of bounds.effects && bounds.effects.upperBounds || []) {
    if (item.key !== "exports") out[`effects.${item.key}`] = numberOrNull(item.upperBound);
  }
  for (const item of certificate.classifications && certificate.classifications.declared || []) {
    if (typeof item.limit === "number" && Number.isFinite(item.limit)) {
      out[`declared.${item.category || "unknown"}.${item.key || "unknown"}`] = item.limit;
    }
  }
  return stableObject(out);
}

function compareBorrowedMemoryCertificateSections(oldSection, newSection, state) {
  if (!oldSection || !newSection) {
    addUnknown(
      state,
      "borrowed_certificate_missing",
      "borrowedMemory",
      oldSection ? "available" : "missing",
      newSection ? "available" : "missing"
    );
    return;
  }
  const oldParams = mapByStableId(oldSection.parameters, "identity");
  const newParams = mapByStableId(newSection.parameters, "identity");
  for (const identity of sortedStrings([...Object.keys(oldParams), ...Object.keys(newParams)])) {
    const oldParam = oldParams[identity];
    const newParam = newParams[identity];
    if (!oldParam && newParam) {
      addExpansion(state, "resource_expansion", "borrowed_parameter_added", identity, null, newParam);
      continue;
    }
    if (oldParam && !newParam) {
      addNarrowing(state, "borrowed_parameter_removed", identity, oldParam, null);
      continue;
    }
    compareBorrowedAccess(identity, oldParam, newParam, state);
    compareBorrowedNumeric(identity, "maximumByteLength", oldParam, newParam, state, "resource_expansion");
    compareBorrowedMinimum(identity, oldParam, newParam, state);
    compareBorrowedAlignment(identity, oldParam, newParam, state);
    if (oldParam.aliasPolicy !== newParam.aliasPolicy) {
      addExpansion(state, "effect_expansion", "borrowed_alias_policy_weakened", identity, oldParam.aliasPolicy, newParam.aliasPolicy);
    }
    if (oldParam.inPlaceAllowed !== true && newParam.inPlaceAllowed === true) {
      addExpansion(state, "effect_expansion", "borrowed_partial_overlap_enabled", identity, false, true);
    } else if (oldParam.inPlaceAllowed === true && newParam.inPlaceAllowed !== true) {
      addNarrowing(state, "borrowed_in_place_disabled", identity, true, false);
    }
    if (oldParam.noescape === true && newParam.noescape !== true) {
      addExpansion(state, "contract_weakening", "borrowed_noescape_removed", identity, true, newParam.noescape);
    } else if (oldParam.noescape !== true && newParam.noescape === true) {
      addNarrowing(state, "borrowed_noescape_added", identity, oldParam.noescape, true);
    }
    if (oldParam.copyOutAllowed !== true && newParam.copyOutAllowed === true) {
      addExpansion(state, "effect_expansion", "borrowed_copy_out_enabled", identity, false, true);
    } else if (oldParam.copyOutAllowed === true && newParam.copyOutAllowed !== true) {
      addNarrowing(state, "borrowed_copy_out_disabled", identity, true, false);
    }
    if (oldParam.memoryDomain !== newParam.memoryDomain) {
      addExpansion(state, "capability_expansion", "borrowed_memory_domain_changed", identity, oldParam.memoryDomain, newParam.memoryDomain);
    }
  }
  compareBorrowedRelations(oldSection.entryRelations, newSection.entryRelations, state);
  compareBorrowedStringSet(
    oldSection.supportedTransferModes,
    newSection.supportedTransferModes,
    "borrowed_transfer_mode",
    state
  );
  compareBorrowedStringSet(
    oldSection.memoryDomains,
    newSection.memoryDomains,
    "borrowed_memory_domain",
    state
  );
}

function compareBorrowedAccess(identity, oldParam, newParam, state) {
  if (oldParam.access === newParam.access) return;
  const capabilities = {
    readonly: new Set(["read"]),
    writeonly: new Set(["write"]),
    readwrite: new Set(["read", "write"])
  };
  const oldCapabilities = capabilities[oldParam.access];
  const newCapabilities = capabilities[newParam.access];
  if (!oldCapabilities || !newCapabilities) {
    addUnknown(state, "borrowed_access_incomparable", identity, oldParam.access, newParam.access);
    return;
  }
  const gained = Array.from(newCapabilities).some((item) => !oldCapabilities.has(item));
  if (gained) {
    addExpansion(state, "effect_expansion", "borrowed_access_expanded", identity, oldParam.access, newParam.access);
  } else {
    addNarrowing(state, "borrowed_access_narrowed", identity, oldParam.access, newParam.access);
  }
}

function compareBorrowedNumeric(identity, key, oldParam, newParam, state, expansionClassification) {
  const oldValue = numberOrNull(oldParam[key]);
  const newValue = numberOrNull(newParam[key]);
  if (oldValue === newValue) return;
  if (oldValue == null || newValue == null) {
    addUnknown(state, `borrowed_${key}_incomparable`, identity, oldValue, newValue);
  } else if (newValue > oldValue) {
    addExpansion(state, expansionClassification, `borrowed_${key}_increased`, identity, oldValue, newValue);
  } else {
    addNarrowing(state, `borrowed_${key}_decreased`, identity, oldValue, newValue);
  }
}

function compareBorrowedMinimum(identity, oldParam, newParam, state) {
  const oldValue = numberOrNull(oldParam.minimumByteLength);
  const newValue = numberOrNull(newParam.minimumByteLength);
  if (oldValue === newValue) return;
  if (oldValue == null || newValue == null) {
    addUnknown(state, "borrowed_minimum_incomparable", identity, oldValue, newValue);
  } else if (newValue < oldValue) {
    addExpansion(state, "contract_weakening", "borrowed_minimum_lowered", identity, oldValue, newValue);
  } else {
    addNarrowing(state, "borrowed_minimum_raised", identity, oldValue, newValue);
  }
}

function compareBorrowedAlignment(identity, oldParam, newParam, state) {
  const oldValue = numberOrNull(oldParam.requiredAlignment);
  const newValue = numberOrNull(newParam.requiredAlignment);
  if (oldValue === newValue) return;
  if (oldValue == null || newValue == null) {
    addUnknown(state, "borrowed_alignment_incomparable", identity, oldValue, newValue);
  } else if (newValue < oldValue) {
    addExpansion(state, "resource_expansion", "borrowed_alignment_weakened", identity, oldValue, newValue);
  } else {
    addNarrowing(state, "borrowed_alignment_strengthened", identity, oldValue, newValue);
  }
}

function compareBorrowedRelations(oldRelations, newRelations, state) {
  const oldItems = mapByStableId(oldRelations, "identity");
  const newItems = mapByStableId(newRelations, "identity");
  for (const identity of sortedStrings([...Object.keys(oldItems), ...Object.keys(newItems)])) {
    const oldItem = oldItems[identity];
    const newItem = newItems[identity];
    if (oldItem && !newItem) {
      addExpansion(state, "contract_weakening", "borrowed_entry_relation_removed", identity, oldItem, null);
    } else if (!oldItem && newItem) {
      addNarrowing(state, "borrowed_entry_relation_added", identity, null, newItem);
    } else if (!sameJson(oldItem, newItem)) {
      addExpansion(state, "contract_weakening", "borrowed_entry_relation_changed", identity, oldItem, newItem);
    }
  }
}

function compareBorrowedStringSet(oldValues, newValues, category, state) {
  const oldSet = new Set(oldValues || []);
  const newSet = new Set(newValues || []);
  for (const value of Array.from(newSet).sort()) {
    if (!oldSet.has(value)) addExpansion(state, "capability_expansion", `${category}_added`, value, null, value);
  }
  for (const value of Array.from(oldSet).sort()) {
    if (!newSet.has(value)) addNarrowing(state, `${category}_removed`, value, value, null);
  }
}

function inspectBorrowedMemoryCertificateChange(oldSection, newSection) {
  const state = {
    expansions: [],
    narrowings: [],
    compatibilityFindings: [],
    provenanceFindings: [],
    resourceFindings: [],
    unknowns: [],
    changedBodies: 0
  };
  compareBorrowedMemoryCertificateSections(oldSection, newSection, state);
  return stableObject({
    expansions: state.expansions.sort(compareFinding),
    narrowings: state.narrowings.sort(compareFinding),
    unknowns: state.unknowns.sort(compareFinding)
  });
}

function compareExports(oldExports, newExports, state) {
  for (const key of sortedStrings([...Object.keys(oldExports || {}), ...Object.keys(newExports || {})])) {
    const oldItem = oldExports && oldExports[key];
    const newItem = newExports && newExports[key];
    if (!oldItem && newItem) addExpansion(state, "export_expansion", "export", key, null, newItem);
    else if (oldItem && !newItem) {
      addNarrowing(state, "export", key, oldItem, null);
      state.compatibilityFindings.push(finding("export_removed", key, oldItem, null, { compatible: false }));
    } else if (!sameJson(oldItem, newItem)) {
      addExpansion(state, "export_expansion", "export_signature", key, oldItem, newItem);
      state.compatibilityFindings.push(finding("export_signature_changed", key, oldItem, newItem, { compatible: false }));
    }
  }
}

function compareImports(oldImports, newImports, state) {
  for (const key of sortedStrings([...Object.keys(oldImports || {}), ...Object.keys(newImports || {})])) {
    const oldItem = oldImports && oldImports[key];
    const newItem = newImports && newImports[key];
    if (!oldItem && newItem) {
      if (key.includes("::extern:")) addExpansion(state, "capability_expansion", "external_import", key, null, newItem);
      else addUnknown(state, "package_dependency_added", key, null, newItem);
    } else if (oldItem && !newItem) {
      addNarrowing(state, "import", key, oldItem, null);
    } else if (!sameJson(oldItem, newItem)) {
      addUnknown(state, "import_identity_changed", key, oldItem, newItem);
    }
  }
}

function compareFunctions(oldFunctions, newFunctions, state) {
  for (const key of sortedStrings([...Object.keys(oldFunctions || {}), ...Object.keys(newFunctions || {})])) {
    const oldFn = oldFunctions && oldFunctions[key];
    const newFn = newFunctions && newFunctions[key];
    if (!oldFn && newFn) {
      state.compatibilityFindings.push(finding("function_added", key, null, functionSignature(newFn), { compatible: !newFn.exported }));
      if (!newFn.exported) state.changedBodies++;
      continue;
    }
    if (oldFn && !newFn) {
      addNarrowing(state, "function", key, functionSignature(oldFn), null);
      state.compatibilityFindings.push(finding("function_removed", key, functionSignature(oldFn), null, { compatible: false }));
      continue;
    }
    compareContracts(key, oldFn, newFn, state);
    if (oldFn.bodyDigest !== newFn.bodyDigest) {
      state.changedBodies++;
      state.compatibilityFindings.push(finding("function_body_changed", key, oldFn.bodyDigest, newFn.bodyDigest, { compatible: true }));
    }
  }
}

function compareModuleContracts(oldModules, newModules, state) {
  for (const modulePath of sortedStrings([...Object.keys(oldModules || {}), ...Object.keys(newModules || {})])) {
    const oldContracts = oldModules && oldModules[modulePath] || {};
    const newContracts = newModules && newModules[modulePath] || {};
    compareContractList(`module:${modulePath}`, "requires", oldContracts.requires, newContracts.requires, state);
    compareContractList(`module:${modulePath}`, "ensures", oldContracts.ensures, newContracts.ensures, state);
  }
}

function compareContracts(identity, oldFn, newFn, state) {
  compareContractList(identity, "requires", oldFn.requires, newFn.requires, state);
  compareContractList(identity, "ensures", oldFn.ensures, newFn.ensures, state);
  const maxParams = Math.max((oldFn.params || []).length, (newFn.params || []).length);
  for (let index = 0; index < maxParams; index++) {
    const oldParam = oldFn.params && oldFn.params[index];
    const newParam = newFn.params && newFn.params[index];
    if (!oldParam || !newParam || oldParam.name !== newParam.name || oldParam.type !== newParam.type) continue;
    compareRefinement(`${identity}:param:${oldParam.name}`, oldParam.refinement, newParam.refinement, "input", state);
  }
  compareRefinement(`${identity}:return`, oldFn.returnRefinement, newFn.returnRefinement, "return", state);
}

function compareContractList(identity, kind, oldList, newList, state) {
  const oldMap = mapContracts(oldList);
  const newMap = mapContracts(newList);
  for (const key of sortedStrings([...Object.keys(oldMap), ...Object.keys(newMap)])) {
    const oldItem = oldMap[key];
    const newItem = newMap[key];
    if (oldItem && !newItem) {
      addExpansion(state, "contract_weakening", `${kind}_removed`, `${identity}:${key}`, oldItem, null);
    } else if (!oldItem && newItem) {
      addNarrowing(state, `${kind}_added`, `${identity}:${key}`, null, newItem);
      if (kind === "requires") state.compatibilityFindings.push(finding("stronger_precondition", identity, null, newItem, { compatible: false }));
    } else if (!sameJson(oldItem, newItem)) {
      const weaker = contractIsWeaker(kind, oldItem, newItem);
      if (weaker) addExpansion(state, "contract_weakening", `${kind}_weakened`, `${identity}:${key}`, oldItem, newItem);
      else addNarrowing(state, `${kind}_strengthened`, `${identity}:${key}`, oldItem, newItem);
    }
  }
}

function compareRefinement(identity, oldRefinement, newRefinement, position, state) {
  const oldRange = refinementRange(oldRefinement);
  const newRange = refinementRange(newRefinement);
  if (sameJson(oldRange, newRange)) return;
  if (oldRange && !newRange) {
    addExpansion(state, "contract_weakening", "refinement_removed", identity, oldRange, null);
    return;
  }
  if (!oldRange && newRange) {
    addNarrowing(state, "refinement_added", identity, null, newRange);
    if (position === "input") state.compatibilityFindings.push(finding("input_refinement_narrowed", identity, null, newRange, { compatible: false }));
    return;
  }
  if (!oldRange || !newRange || oldRange.kind !== newRange.kind) {
    addUnknown(state, "refinement_incomparable", identity, oldRange, newRange);
    return;
  }
  const wider = newRange.min < oldRange.min || newRange.max > oldRange.max;
  const narrower = newRange.min >= oldRange.min && newRange.max <= oldRange.max;
  if (wider) addExpansion(state, "contract_weakening", "refinement_widened", identity, oldRange, newRange);
  else if (narrower) {
    addNarrowing(state, "refinement_narrowed", identity, oldRange, newRange);
    if (position === "input") state.compatibilityFindings.push(finding("input_refinement_narrowed", identity, oldRange, newRange, { compatible: false }));
  } else addUnknown(state, "refinement_incomparable", identity, oldRange, newRange);
}

function compareProvenance(oldSummary, newSummary, state) {
  const oldPolicy = oldSummary.provenancePolicy;
  const newPolicy = newSummary.provenancePolicy;
  if (oldPolicy && oldPolicy.mode === "required" && (!newPolicy || newPolicy.mode !== "required")) {
    addExpansion(state, "provenance_policy_expansion", "provenance_mode_removed", "provenanceFlow.mode", "required", newPolicy && newPolicy.mode || null);
  }
  const oldFlow = oldSummary.flow || {};
  const newFlow = newSummary.flow || {};
  for (const key of sortedStrings([...Object.keys(oldFlow), ...Object.keys(newFlow)])) {
    const oldItem = oldFlow[key];
    const newItem = newFlow[key];
    if (!oldItem && newItem) {
      if (newItem.kind === "declassifier") addExpansion(state, "declassification_authority_expansion", "declassifier_added", key, null, newItem);
      else state.provenanceFindings.push(finding("flow_declaration_added", key, null, newItem, { status: "added" }));
      continue;
    }
    if (oldItem && !newItem) {
      if (oldItem.kind === "declassifier") addNarrowing(state, "declassifier_removed", key, oldItem, null);
      else if (oldItem.kind === "source_param" || oldItem.kind === "source_extern" || oldItem.kind === "source_global" ||
        oldItem.kind === "sink_return" || oldItem.kind === "sink_extern" || oldItem.kind === "sink_print" ||
        oldItem.kind === "storage_global" || oldItem.kind === "storage_state" || oldItem.kind === "storage_pool") {
        addExpansion(state, "provenance_policy_expansion", "flow_declaration_removed", key, oldItem, null);
      }
      continue;
    }
    if (sameJson(oldItem, newItem)) continue;
    compareFlowDeclaration(key, oldItem, newItem, state);
  }
  compareManifestDeclassifiers(oldPolicy, newPolicy, state);
  if (!sameJson(oldPolicy && oldPolicy.sourceBindings || [], newPolicy && newPolicy.sourceBindings || [])) {
    addExpansion(state, "provenance_policy_expansion", "source_bindings_changed", "provenanceFlow.sourceBindings",
      oldPolicy && oldPolicy.sourceBindings || [], newPolicy && newPolicy.sourceBindings || []);
  }
}

function compareFlowDeclaration(key, oldItem, newItem, state) {
  if (oldItem.kind !== newItem.kind) {
    addExpansion(state, "provenance_policy_expansion", "flow_identity_changed", key, oldItem, newItem);
    return;
  }
  if (oldItem.kind === "declassifier") {
    addExpansion(state, "declassification_authority_expansion", "declassifier_changed", key, oldItem, newItem);
    return;
  }
  const oldIndex = FLOW_LABELS.indexOf(oldItem.label);
  const newIndex = FLOW_LABELS.indexOf(newItem.label);
  const source = oldItem.kind.startsWith("source_");
  const sinkOrStorage = oldItem.kind.startsWith("sink_") || oldItem.kind.startsWith("storage_");
  const expanded = (source && newIndex < oldIndex) || (sinkOrStorage && newIndex > oldIndex);
  const category = source ? "source_label" : sinkOrStorage ? "sink_or_storage_ceiling" : "flow_policy";
  if (expanded) addExpansion(state, "provenance_policy_expansion", category, key, oldItem.label, newItem.label);
  else addNarrowing(state, category, key, oldItem.label, newItem.label);
}

function compareManifestDeclassifiers(oldPolicy, newPolicy, state) {
  const oldItems = mapByStableId(oldPolicy && oldPolicy.declassifiers, "id");
  const newItems = mapByStableId(newPolicy && newPolicy.declassifiers, "id");
  for (const key of sortedStrings([...Object.keys(oldItems), ...Object.keys(newItems)])) {
    const oldItem = oldItems[key];
    const newItem = newItems[key];
    if (!oldItem && newItem) addExpansion(state, "declassification_authority_expansion", "package_declassifier_added", key, null, newItem);
    else if (oldItem && !newItem) addNarrowing(state, "package_declassifier_removed", key, oldItem, null);
    else if (!sameJson(oldItem, newItem)) addExpansion(state, "declassification_authority_expansion", "package_declassifier_changed", key, oldItem, newItem);
  }
}

function compareSchemaDocuments(base, result, state) {
  const roles = {
    source: sortedStrings([
      ...(base.summary.schemaRoles && base.summary.schemaRoles.facts || []),
      ...(base.summary.schemaRoles && base.summary.schemaRoles.structured || []),
      ...(result.summary.schemaRoles && result.summary.schemaRoles.facts || []),
      ...(result.summary.schemaRoles && result.summary.schemaRoles.structured || [])
    ]),
    sink: sortedStrings([
      ...(base.summary.schemaRoles && base.summary.schemaRoles.outputs || []),
      ...(result.summary.schemaRoles && result.summary.schemaRoles.outputs || [])
    ])
  };
  for (const relative of sortedStrings([...roles.source, ...roles.sink])) {
    const oldDocument = base.documents[relative];
    const newDocument = result.documents[relative];
    if (!oldDocument || !newDocument || oldDocument.digest === newDocument.digest) continue;
    const role = roles.sink.includes(relative) ? "sink" : "source";
    const oldLabels = collectJsonFlowLabels(oldDocument.semantic);
    const newLabels = collectJsonFlowLabels(newDocument.semantic);
    let handled = false;
    for (const key of sortedStrings([...Object.keys(oldLabels), ...Object.keys(newLabels)])) {
      const oldLabel = oldLabels[key];
      const newLabel = newLabels[key];
      if (oldLabel === newLabel) continue;
      handled = true;
      const oldIndex = FLOW_LABELS.indexOf(oldLabel);
      const newIndex = FLOW_LABELS.indexOf(newLabel);
      const expanded = !newLabel || (role === "source" ? newIndex < oldIndex : newIndex > oldIndex);
      if (expanded) {
        addExpansion(state, "provenance_policy_expansion", `${role}_schema_label`, `${relative}:${key}`, oldLabel, newLabel || null);
      } else {
        addNarrowing(state, `${role}_schema_label`, `${relative}:${key}`, oldLabel || null, newLabel);
      }
    }
    if (!handled) addUnknown(state, "schema_semantics_changed", relative, oldDocument.digest, newDocument.digest);
  }
}

function collectJsonFlowLabels(value, prefix = "$", out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonFlowLabels(item, `${prefix}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort()) {
      const next = `${prefix}.${key}`;
      if (key === "flowLabel" && typeof value[key] === "string") out[next] = value[key];
      else collectJsonFlowLabels(value[key], next, out);
    }
  }
  return out;
}

function applyOperation(output, operation) {
  const relative = operation.target.path;
  if (!safeRelativePath(relative)) throw new SemanticPatchError("air.semantic_patch.path_invalid", `unsafe operation path ${JSON.stringify(relative)}`);
  const absolute = path.join(output, relative);
  const exists = fs.existsSync(absolute);
  const current = exists ? snapshotDocument(relative, absolute) : null;
  if ((current && current.digest || null) !== operation.expectedOldDigest) {
    throw new SemanticPatchError("air.semantic_patch.operation_conflict", `precondition mismatch for ${relative}`);
  }
  if (operation.op === "remove_semantic_object") {
    fs.rmSync(absolute);
    return;
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, operation.content, "utf8");
  const written = snapshotDocument(relative, absolute);
  if (written.digest !== operation.resultDigest) {
    throw new SemanticPatchError("air.semantic_patch.result_mismatch", `written semantic object digest mismatch for ${relative}`);
  }
}

function assertIdentity(label, expected, actual) {
  if (!expected || expected.packageDigest !== actual.packageDigest) {
    throw new SemanticPatchError(`air.semantic_patch.${label}_digest_mismatch`, `${label} package digest mismatch`, {
      expected: expected && expected.packageDigest || null,
      actual: actual.packageDigest
    });
  }
  if (!sameJson(expected.moduleDigests || {}, actual.moduleDigests || {})) {
    throw new SemanticPatchError(`air.semantic_patch.${label}_module_mismatch`, `${label} module digests mismatch`);
  }
}

function publicIdentity(snapshot) {
  return stableObject({
    packageName: snapshot.packageName,
    packageDigest: snapshot.packageDigest,
    manifestDigest: snapshot.manifestDigest,
    moduleDigests: snapshot.moduleDigests,
    documentDigests: snapshot.documentDigests
  });
}

function analyzerIdentity() {
  const source = fs.readFileSync(__filename, "utf8");
  return stableObject({
    name: "air.semanticPatchAnalyzer",
    version: SEMANTIC_PATCH_SCHEMA_VERSION,
    compilerVersion: AIR_VERSION,
    digest: hashText(source, ANALYZER_DOMAIN)
  });
}

function patchDigest(patch) {
  const copy = { ...patch };
  delete copy.patchDigest;
  return hashStable(copy, PATCH_DOMAIN);
}

function operationDigest(operation) {
  const copy = { ...operation };
  delete copy.operationDigest;
  return hashStable(copy, PATCH_DOMAIN);
}

function operationKey(operation) {
  return `${operation && operation.target && operation.target.kind || ""}:${operation && operation.target && operation.target.path || ""}:${operation && operation.op || ""}`;
}

function enforceGenerationLimits(base, result, operations, analysis) {
  if (operations.length > LIMITS.maxOperations) {
    throw new SemanticPatchError("air.semantic_patch.analysis_budget_exceeded", `patch has ${operations.length} operations; maximum is ${LIMITS.maxOperations}`);
  }
  const evidenceEntries = Object.keys(base.documentDigests).length + Object.keys(result.documentDigests).length +
    operations.length + findingCount(analysis);
  if (evidenceEntries > LIMITS.maxEvidenceEntries) {
    throw new SemanticPatchError("air.semantic_patch.analysis_budget_exceeded", `patch evidence has ${evidenceEntries} entries; maximum is ${LIMITS.maxEvidenceEntries}`);
  }
}

function enforceFindingLimit(state) {
  const count = state.expansions.length + state.narrowings.length + state.compatibilityFindings.length +
    state.provenanceFindings.length + state.resourceFindings.length + state.unknowns.length;
  if (count > LIMITS.maxFindings) {
    throw new SemanticPatchError("air.semantic_patch.analysis_budget_exceeded", `analysis has ${count} findings; maximum is ${LIMITS.maxFindings}`);
  }
}

function findingCount(analysis) {
  return (analysis.expansions || []).length + (analysis.narrowings || []).length +
    (analysis.compatibility && analysis.compatibility.findings || []).length +
    (analysis.provenanceFindings || []).length + (analysis.resourceFindings || []).length +
    (analysis.unknowns || []).length;
}

function addExpansion(state, classification, category, identity, oldValue, newValue) {
  state.expansions.push(finding(category, identity, oldValue, newValue, { classification }));
  if (category.includes("provenance") || category.includes("flow") || category.includes("declassifier") ||
      category.includes("source_label") || category.includes("sink_or_storage")) {
    state.provenanceFindings.push(finding(category, identity, oldValue, newValue, { classification }));
  }
}

function addNarrowing(state, category, identity, oldValue, newValue) {
  state.narrowings.push(finding(category, identity, oldValue, newValue, { classification: "narrowing" }));
}

function addUnknown(state, category, identity, oldValue, newValue) {
  state.unknowns.push(finding(category, identity, oldValue, newValue, { classification: "unknown_unproven" }));
}

function finding(category, identity, oldValue, newValue, extra = {}) {
  return stableObject({ category, identity, old: oldValue === undefined ? null : oldValue, new: newValue === undefined ? null : newValue, ...extra });
}

function normalizeContracts(items) {
  return (items || []).map((item) => stableObject(stripLocations(item))).sort(compareStable);
}

function normalizeEffects(items) {
  return (items || []).map((item) => stableObject({
    key: item.key,
    op: item.op || "<=",
    limit: item.limit
  })).sort(compareStable);
}

function normalizeFlowDeclaration(item) {
  return stableObject(stripLocations(item));
}

function flowIdentity(item) {
  const fields = [
    item.kind,
    item.function,
    item.param,
    item.extern,
    item.global,
    item.state,
    item.pool,
    item.field,
    item.argIndex,
    item.id
  ].filter((value) => value !== null && value !== undefined && value !== "");
  return fields.join(":");
}

function functionSignature(fn) {
  return stableObject({
    exported: Boolean(fn.exported),
    params: fn.params || [],
    returnType: fn.returnType,
    returnDeclaredType: fn.returnDeclaredType,
    returnRefinement: fn.returnRefinement || null,
    requires: fn.requires || [],
    ensures: fn.ensures || []
  });
}

function exportAbiSignature(fn) {
  return stableObject({
    params: (fn.params || []).map((item) => ({ name: item.name, type: item.type })),
    returnType: fn.returnType
  });
}

function isSemanticEffectKey(key) {
  const value = String(key || "");
  return value !== "exports" &&
    !value.startsWith("cpu.") &&
    !value.startsWith("memory.") &&
    !value.startsWith("state.") &&
    !value.startsWith("static_") &&
    value !== "dynamic_allocations";
}

function mapContracts(items) {
  const out = {};
  for (const item of items || []) {
    const subject = item.name || item.key || item.capability || "";
    const key = `${item.kind || ""}:${subject}:${item.op || ""}`;
    out[key] = item;
  }
  return out;
}

function contractIsWeaker(kind, oldItem, newItem) {
  const oldSubject = oldItem.name || oldItem.key || oldItem.capability || "";
  const newSubject = newItem.name || newItem.key || newItem.capability || "";
  if (oldItem.op !== newItem.op || oldItem.kind !== newItem.kind || oldSubject !== newSubject) return true;
  const oldValue = oldItem.value === undefined ? oldItem.limit : oldItem.value;
  const newValue = newItem.value === undefined ? newItem.limit : newItem.value;
  if (typeof oldValue !== "number" || typeof newValue !== "number") return true;
  if (kind === "requires") {
    if (oldItem.op === ">=") return newValue < oldValue;
    if (oldItem.op === "<=") return newValue > oldValue;
  }
  if (kind === "ensures") {
    if (oldItem.op === ">=") return newValue < oldValue;
    if (oldItem.op === "<=") return newValue > oldValue;
  }
  return true;
}

function refinementRange(value) {
  if (!value || typeof value !== "object") return null;
  if (!Number.isInteger(value.min) || !Number.isInteger(value.max)) return null;
  return stableObject({ kind: value.kind, min: value.min, max: value.max });
}

function mapByStableId(items, field) {
  const out = {};
  for (const item of items || []) {
    if (item && typeof item[field] === "string") out[item[field]] = stableObject(item);
  }
  return out;
}

function stripLocations(value) {
  if (Array.isArray(value)) return value.map(stripLocations);
  if (value instanceof Set) return Array.from(value).sort();
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "loc" || key === "raw") continue;
    out[key] = stripLocations(value[key]);
  }
  return out;
}

function copyDirectory(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "build") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDirectory(from, to);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function graphDependencyDepth(graph) {
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
  const adjacency = new Map();
  for (const edge of edges) {
    const from = edge && (edge.from || edge.source || edge.caller || edge[0]);
    const to = edge && (edge.to || edge.target || edge.callee || edge[1]);
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }
  let maximum = 0;
  function visit(node, stack) {
    if (stack.has(node)) return LIMITS.maxDependencyDepth + 1;
    const next = adjacency.get(node) || [];
    if (!next.length) return 1;
    const updated = new Set(stack);
    updated.add(node);
    return 1 + Math.max(...next.map((item) => visit(item, updated)));
  }
  for (const node of adjacency.keys()) maximum = Math.max(maximum, visit(node, new Set()));
  return maximum;
}

function loadPatch(input) {
  if (typeof input === "string") return JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  if (input && typeof input === "object" && !Array.isArray(input)) return stableObject(input);
  throw new SemanticPatchError("air.semantic_patch.invalid", "patch must be a JSON object or file path");
}

function safeRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) return false;
  if (path.isAbsolute(value) || value.split("/").includes("..")) return false;
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function hashStable(value, domain = "") {
  return hashText(stableStringify(value), domain);
}

function hashText(value, domain = "") {
  return `sha256:${crypto.createHash("sha256").update(domain).update(String(value)).digest("hex")}`;
}

function stableStringify(value) {
  return `${JSON.stringify(stableObject(value), null, 2)}\n`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function sameJson(a, b) {
  return JSON.stringify(stableObject(a)) === JSON.stringify(stableObject(b));
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

function compareStable(a, b) {
  return stableStringify(a).localeCompare(stableStringify(b));
}

function compareFinding(a, b) {
  return String(a.classification || "").localeCompare(String(b.classification || "")) ||
    String(a.category || "").localeCompare(String(b.category || "")) ||
    String(a.identity || "").localeCompare(String(b.identity || ""));
}

function validDigest(value) {
  return /^sha256:[a-f0-9]{64}$/.test(String(value || ""));
}

function cloneList(value) {
  return Array.isArray(value) ? value.map((item) => stableObject(item)) : [];
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

module.exports = {
  CLASSIFICATIONS,
  LIMITS,
  SEMANTIC_PATCH_EVIDENCE_KIND,
  SEMANTIC_PATCH_KIND,
  SEMANTIC_PATCH_SCHEMA_VERSION,
  SemanticPatchError,
  applySemanticPatch,
  createSemanticPatch,
  inspectBorrowedMemoryCertificateChange,
  inspectSemanticPatch,
  snapshotPackage,
  stableStringify,
  validatePatch
};
