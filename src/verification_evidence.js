const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeDiagnostic, sortDiagnostics } = require("./diagnostics");
const { HOST_ABI_VERSION } = require("./package_manifest");
const { checkPackageDir } = require("./sdk");
const { inspectSemanticPatch } = require("./semantic_patch");
const { AIR_ABI_VERSION, AIR_VERSION } = require("./version");

const VERIFICATION_EVIDENCE_SCHEMA_VERSION = "0.20";
const VERIFICATION_EVIDENCE_KIND = "air.verificationEvidence";
const BORROWED_MEMORY_EVIDENCE_KIND = "air.borrowedMemoryInvocationEvidence";
const BORROWED_MEMORY_EVIDENCE_SCHEMA_VERSION = "0.50";
const BORROWED_MEMORY_HASH_DOMAIN = "AIR_BORROWED_MEMORY_INVOCATION_V1";

function createPackageVerificationEvidence(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const profile = options.profile || null;
  const hostInteractionEvidence = loadHostInteractionEvidence(options.hostEvidence || options.hostInteractionEvidence, base);
  const semanticPatchEvidence = loadSemanticPatchEvidence(options.semanticPatch, Boolean(options.semanticPatchStrict), base);
  const command = `airc verify package ${normalizeSlash(path.relative(process.cwd(), base) || ".")} --json${profile ? ` --profile ${profile}` : ""}${options.hostEvidence ? " --host-evidence <hostInteractionEvidence.json>" : ""}${options.semanticPatch ? " --semantic-patch <semanticPatch.json>" : ""}${options.semanticPatchStrict ? " --semantic-patch-strict" : ""}`;
  let report = null;
  try {
    report = checkPackageDir(base, {
      profile,
      built: false,
      releaseCandidate: Boolean(options.releaseCandidate),
      certificateRequired: Boolean(options.certificateRequired)
    });
  } catch (err) {
    return finalizeEvidence({
      base,
      status: "failed",
      command,
      report: null,
      errors: errorList(err),
      diagnostics: errorList(err).map((message) => normalizeDiagnostic({
        code: "air.package.check_failed",
        severity: "fail",
        source: "verification-evidence",
        message,
        fields: { command }
      })),
      hostInteractionEvidence,
      semanticPatchEvidence
    });
  }

  const hostDiagnostics = hostInteractionDiagnostics(hostInteractionEvidence);
  const semanticPatchDiagnostics = semanticPatchEvidence && semanticPatchEvidence.status === "rejected"
    ? (semanticPatchEvidence.rejectedReasons || ["semantic patch rejected"]).map((reason) => normalizeDiagnostic({
      code: "air.semantic_patch.rejected",
      severity: "fail",
      source: "verification-evidence",
      message: String(reason),
      fields: {
        classification: semanticPatchEvidence.classifications && semanticPatchEvidence.classifications[0] || "unknown_unproven",
        patchDigest: semanticPatchEvidence.patchDigest || null
      }
    }))
    : [];
  const allDiagnostics = (report.diagnostics || []).concat(hostDiagnostics, semanticPatchDiagnostics);
  const allErrors = (report.errors || [])
    .concat(hostDiagnostics.filter((item) => item.severity === "fail").map((item) => item.message))
    .concat(semanticPatchDiagnostics.map((item) => item.message));
  const status = report.status === "fail" ||
    hostDiagnostics.some((item) => item.severity === "fail") ||
    semanticPatchDiagnostics.length ? "failed" : "passed";
  return finalizeEvidence({
    base,
    status,
    command,
    report,
    errors: allErrors,
    diagnostics: allDiagnostics,
    hostInteractionEvidence,
    semanticPatchEvidence
  });
}

function loadSemanticPatchEvidence(input, strict, base) {
  if (!input) return null;
  try {
    return sanitizeValue(inspectSemanticPatch(input, { strict }), base);
  } catch (err) {
    return stableObject({
      schemaVersion: "1.0",
      kind: "air.semanticPatchEvidence",
      mode: strict ? "strict" : "review",
      status: "rejected",
      baseDigest: null,
      resultDigest: null,
      patchDigest: null,
      operationCount: 0,
      classifications: ["unknown_unproven"],
      expansions: [],
      narrowings: [],
      compatibilityFindings: [],
      provenanceFindings: [],
      resourceFindings: [],
      rejectedReasons: [sanitizeString(err && err.message ? err.message : String(err), base)],
      analyzerDigest: null,
      summaryDigest: null
    });
  }
}

function loadHostInteractionEvidence(input, base) {
  if (!input) return null;
  if (typeof input === "string") {
    const absolute = path.resolve(input);
    try {
      return JSON.parse(fs.readFileSync(absolute, "utf8"));
    } catch (err) {
      return {
        schemaVersion: null,
        kind: null,
        status: "failed",
        policyId: null,
        hostProfile: null,
        decisions: [],
        deniedCapabilities: [],
        diagnostics: [{
          code: "air.host_interaction.evidence_invalid",
          severity: "fail",
          source: "verification-evidence",
          message: `failed to read host interaction evidence: ${err.message}`,
          fields: { path: sanitizeString(absolute, base) }
        }],
        replayChecksum: null
      };
    }
  }
  if (input && typeof input === "object" && !Array.isArray(input)) return input;
  return {
    schemaVersion: null,
    kind: null,
    status: "failed",
    policyId: null,
    hostProfile: null,
    decisions: [],
    deniedCapabilities: [],
    diagnostics: [{
      code: "air.host_interaction.evidence_invalid",
      severity: "fail",
      source: "verification-evidence",
      message: "host interaction evidence must be a JSON object",
      fields: {}
    }],
    replayChecksum: null
  };
}

function createNotRunVerificationEvidence(options = {}) {
  const packageName = options.package || null;
  const reason = options.reason || "verification was not run";
  return finalizeEvidence({
    base: options.packageDir ? path.resolve(options.packageDir) : process.cwd(),
    status: "not_run",
    command: options.command || null,
    report: {
      package: packageName,
      profile: options.profile || null,
      modules: [],
      facts: { schemas: [] },
      structuredIO: { schemas: [], handleSets: [] },
      outputContracts: { schemas: [] },
      commandBuffers: { schemas: [], outputIntentUsage: [] },
      outputHandleSets: [],
      generatedArtifacts: null,
      generatedHandles: null,
      stateHandleSets: [],
      stateAccessorPolicies: [],
      capabilities: { required: [], supported: [], unsupported: [] },
      computedCapabilities: [],
      declaredCapabilities: [],
      hostImports: { used: [], unsupported: [] },
      profileSupport: null,
      errors: [],
      diagnostics: []
    },
    errors: [],
    diagnostics: [normalizeDiagnostic({
      code: "air.package.verification_not_run",
      severity: "info",
      source: "verification-evidence",
      message: reason,
      fields: { reason }
    })]
  });
}

function validateBorrowedMemoryInvocationEvidence(evidence, options = {}) {
  const diagnostics = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return borrowedMemoryEvidenceValidation([{
      code: "air.borrow.evidence_invalid",
      message: "borrowed-memory evidence must be an object"
    }]);
  }
  if (evidence.schemaVersion !== BORROWED_MEMORY_EVIDENCE_SCHEMA_VERSION ||
      evidence.kind !== BORROWED_MEMORY_EVIDENCE_KIND) {
    diagnostics.push({
      code: "air.borrow.evidence_invalid",
      message: "borrowed-memory evidence schema or kind is invalid"
    });
  }
  const payload = stableObject(evidence);
  delete payload.bindingDigest;
  delete payload.evidenceDigest;
  if (evidence.evidenceDigest !== hashBorrowedMemoryEvidence(payload)) {
    diagnostics.push({
      code: "air.borrow.evidence_digest_mismatch",
      message: "borrowed-memory evidence payload does not match evidenceDigest"
    });
  }
  const bindingPayload = (evidence.parameters || []).length
    ? {
        interfaceDigest: evidence.interfaceDigest,
        moduleDigest: evidence.moduleDigest,
        parameters: evidence.parameters,
        packageDigest: evidence.packageDigest,
        resourceCertificateDigest: evidence.resourceCertificateDigest,
        resultDigest: evidence.result && evidence.result.digest
      }
    : {
        failureReason: evidence.failureReason,
        interfaceDigest: evidence.interfaceDigest,
        moduleDigest: evidence.moduleDigest,
        packageDigest: evidence.packageDigest
      };
  if (evidence.bindingDigest !== hashBorrowedMemoryEvidence(bindingPayload)) {
    diagnostics.push({
      code: "air.borrow.binding_digest_mismatch",
      message: "borrowed-memory invocation identity does not match bindingDigest"
    });
  }
  for (const [field, expected] of [
    ["moduleDigest", options.moduleDigest],
    ["packageDigest", options.packageDigest],
    ["resourceCertificateDigest", options.resourceCertificateDigest]
  ]) {
    if (expected !== undefined && evidence[field] !== expected) {
      diagnostics.push({
        code: "air.borrow.evidence_identity_mismatch",
        message: `${field} does not match expected invocation identity`
      });
    }
  }
  return borrowedMemoryEvidenceValidation(diagnostics);
}

function hashBorrowedMemoryEvidence(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${BORROWED_MEMORY_HASH_DOMAIN}:json\0`, "utf8")
    .update(JSON.stringify(stableObject(value)), "utf8")
    .digest("hex")}`;
}

function borrowedMemoryEvidenceValidation(diagnostics) {
  const normalized = diagnostics.map((item) => stableObject({
    code: item.code,
    severity: "fail",
    source: "verification-evidence",
    message: item.message
  })).sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  return stableObject({
    ok: normalized.length === 0,
    status: normalized.length === 0 ? "pass" : "fail",
    diagnostics: normalized
  });
}

function finalizeEvidence({ base, status, command, report, errors, diagnostics, hostInteractionEvidence, semanticPatchEvidence }) {
  const sanitizedReport = sanitizeValue(report || {}, base);
  const hostInteractionSummary = hostInteractionEvidenceSummary(hostInteractionEvidence, base);
  const normalizedDiagnostics = sortDiagnostics((diagnostics || []).map((diagnostic) => normalizeDiagnostic(sanitizeValue(diagnostic, base))));
  const sanitizedErrors = sortedStrings((errors || []).map((error) => sanitizeString(String(error), base)));
  const modules = moduleEvidence(sanitizedReport.modules || [], normalizedDiagnostics);
  const factSchemas = factSchemaEvidence(sanitizedReport.facts && sanitizedReport.facts.schemas);
  const structuredIO = structuredIoEvidence(sanitizedReport.structuredIO);
  const outputContracts = outputContractEvidence(sanitizedReport.outputContracts && sanitizedReport.outputContracts.schemas);
  const commandBuffers = commandBufferEvidence(sanitizedReport.commandBuffers && sanitizedReport.commandBuffers.schemas);
  const outputHandleSets = outputHandleSetEvidence(sanitizedReport.outputHandleSets || []);
  const outputEmit = outputEmitEvidence(sanitizedReport.outputEmit);
  const stateSegments = stateSegmentEvidence(sanitizedReport.stateSegments || collectModuleStateSegments(modules));
  const tableGroups = tableGroupEvidence(sanitizedReport.tableGroups || collectModuleTableGroups(modules));
  const pools = poolEvidence(sanitizedReport.pools || collectModulePools(modules));
  const stateHandleSets = stateHandleSetEvidence(sanitizedReport.stateHandleSets || []);
  const stateAccessorPolicies = stateAccessorPolicyEvidence(sanitizedReport.stateAccessorPolicies || []);
  const generatedArtifacts = generatedArtifactEvidence(sanitizedReport);
  const capabilitySummary = capabilityEvidence(sanitizedReport);
  const profileCompatibility = profileCompatibilityEvidence(sanitizedReport, status);
  const authoredGraph = sanitizedReport.authoredGraph || null;
  const executableGraph = sanitizedReport.executableGraph || null;
  const authoredToExecutable = sanitizedReport.authoredToExecutable || [];
  const ownershipMap = sanitizedReport.ownershipMap || null;
  const linkDiagnostics = sanitizedReport.linkDiagnostics || [];
  const generatedExecutableFreshness = sanitizedReport.generatedExecutableFreshness || null;
  const profile = sanitizedReport.profile || null;
  const packageName = sanitizedReport.package || null;
  const packageId = packageName;
  const resourceCertificate = sanitizedReport.resourceCertificate || null;
  const provenanceFlow = sanitizedReport.provenanceFlow || null;
  const packageHashSource = {
    packageName,
    modules,
    factSchemas,
    outputContracts,
    commandBuffers,
    stateSegments,
    stateHandleSets,
    stateAccessorPolicies,
    generatedArtifacts,
    capabilitySummary,
    graph: sanitizedReport.graph || null,
    authoredGraph,
    executableGraph,
    authoredToExecutable,
    ownershipMap,
    generatedExecutableFreshness
  };
  if (provenanceFlow && provenanceFlow.mode === "required") packageHashSource.provenanceFlow = provenanceFlow;
  if ((structuredIO.schemas || []).length || (structuredIO.handleSets || []).length) packageHashSource.structuredIO = structuredIO;
  if (tableGroups.length) packageHashSource.tableGroups = tableGroups;
  if (pools.length) packageHashSource.pools = pools;
  if (outputHandleSets.length) packageHashSource.outputHandleSets = outputHandleSets;
  if (outputEmit.used) packageHashSource.outputEmit = outputEmit;
  const packageHash = hashStable(packageHashSource);
  const abiHash = hashStable({
    airAbi: AIR_ABI_VERSION,
    hostAbi: sanitizedReport.hostAbi || HOST_ABI_VERSION,
    hostImports: capabilitySummary.hostImports.used,
    capabilities: capabilitySummary.required
  });

  const evidence = {
    schemaVersion: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    kind: VERIFICATION_EVIDENCE_KIND,
    status,
    compilerVersion: AIR_VERSION,
    airAbi: AIR_ABI_VERSION,
    hostAbi: sanitizedReport.hostAbi || HOST_ABI_VERSION,
    package: packageName,
    packageName,
    packageId,
    profile,
    packageHash,
    abiHash,
    command: command || null,
    failingModule: status === "failed" ? firstFailingModule(normalizedDiagnostics, sanitizedErrors, modules) : null,
    failingCommand: status === "failed" ? command || null : null,
    modules,
    authoredGraph,
    executableGraph,
    authoredToExecutable,
    ownershipMap,
    linkDiagnostics,
    generatedExecutableFreshness,
    factSchemas,
    structuredIO,
    outputContracts,
    commandBuffers,
    outputHandleSets,
    stateSegments,
    stateHandleSets,
    stateAccessorPolicies,
    hostInteractionEvidence: hostInteractionSummary,
    generatedArtifacts,
    resourceCertificate,
    capabilitySummary,
    profileCompatibility,
    diagnostics: normalizedDiagnostics,
    errors: sanitizedErrors
  };
  if (tableGroups.length) evidence.tableGroups = tableGroups;
  if (pools.length) evidence.pools = pools;
  if (outputEmit.used) evidence.outputEmit = outputEmit;
  if (provenanceFlow && provenanceFlow.mode === "required") evidence.provenanceFlow = provenanceFlow;
  if (semanticPatchEvidence) evidence.semanticPatch = stableObject(semanticPatchEvidence);
  return stableObject(evidence);
}

function structuredIoEvidence(structuredIO) {
  const source = structuredIO && typeof structuredIO === "object" && !Array.isArray(structuredIO) ? structuredIO : {};
  return stableObject({
    schemas: (source.schemas || []).map((schema) => stableObject({
      path: schema.path || null,
      exists: schema.exists !== false,
      ok: Boolean(schema.ok),
      status: schema.exists === false ? "missing" : (schema.ok ? "passed" : "failed"),
      fingerprint: schema.fingerprint || null,
      hash: schema.fingerprint || null,
      schemaVersion: schema.schemaVersion || null,
      kind: schema.kind || null,
      name: schema.name || null,
      maxRows: schema.maxRows || null,
      fieldCount: schema.fieldCount || 0,
      fields: (schema.fields || []).map((field) => stableObject({
        name: field.name || null,
        type: field.type || null,
        privacy: field.privacy || null,
        classification: field.classification || null,
        semantic: field.semantic || null,
        ...(field.flowLabel ? { flowLabel: field.flowLabel } : {})
      })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
      privacyPolicy: schema.privacyPolicy || null,
      diagnostics: (schema.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
    })).sort((a, b) => String(a.path).localeCompare(String(b.path))),
    handleSets: (source.handleSets || []).map((set) => stableObject({
      path: set.path || null,
      metadataPath: set.metadataPath || null,
      status: set.status || null,
      sourceFingerprint: set.sourceFingerprint || null,
      generatedFingerprint: set.generatedFingerprint || null,
      expectedGeneratedFingerprint: set.expectedGeneratedFingerprint || null,
      sourceSchemas: (set.sourceSchemas || []).map((sourceSchema) => stableObject({
        path: sourceSchema.path || null,
        fingerprint: sourceSchema.fingerprint || null
      })).sort((a, b) => String(a.path).localeCompare(String(b.path))),
      schemas: (set.schemas || []).map((schema) => stableObject({
        path: schema.path || null,
        kind: schema.kind || null,
        name: schema.name || null,
        maxRows: schema.maxRows || null,
        fieldCount: schema.fieldCount || 0
      })).sort((a, b) => String(a.path).localeCompare(String(b.path))),
      diagnostics: (set.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
    })).sort((a, b) => String(a.path).localeCompare(String(b.path)) || String(a.status).localeCompare(String(b.status)))
  });
}

function hostInteractionEvidenceSummary(evidence, base) {
  if (!evidence) return null;
  const sanitized = sanitizeValue(evidence, base);
  return stableObject({
    status: typeof sanitized.status === "string" ? sanitized.status : "failed",
    policyId: typeof sanitized.policyId === "string" ? sanitized.policyId : null,
    hostProfile: typeof sanitized.hostProfile === "string" ? sanitized.hostProfile : null,
    decisionsCount: Array.isArray(sanitized.decisions) ? sanitized.decisions.length : 0,
    decisions: hostInteractionDecisionSummary(sanitized.decisions),
    deniedCapabilitiesCount: Array.isArray(sanitized.deniedCapabilities) ? sanitized.deniedCapabilities.length : 0,
    diagnosticsCount: Array.isArray(sanitized.diagnostics) ? sanitized.diagnostics.length : 0,
    replayChecksum: typeof sanitized.replayChecksum === "string" ? sanitized.replayChecksum : null
  });
}

function outputEmitEvidence(outputEmit) {
  const source = outputEmit && typeof outputEmit === "object" && !Array.isArray(outputEmit) ? outputEmit : {};
  const calls = [];
  for (const item of source.used || []) {
    for (const call of item.calls || []) {
      calls.push(stableObject({
        module: item.module || null,
        function: call.function || null,
        line: Number.isInteger(call.line) ? call.line : null,
        outputId: Number.isInteger(call.outputId) ? call.outputId : null,
        outputName: typeof call.outputName === "string" ? call.outputName : null,
        outputCapability: typeof call.outputCapability === "string" ? call.outputCapability : null,
        outputArgCount: Number.isInteger(call.outputArgCount) ? call.outputArgCount : null,
        status: typeof call.status === "string" ? call.status : null
      }));
    }
  }
  calls.sort((a, b) =>
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.function || "").localeCompare(String(b.function || "")) ||
    Number(a.line || 0) - Number(b.line || 0) ||
    Number(a.outputId || 0) - Number(b.outputId || 0));
  return stableObject({
    used: calls.length > 0,
    count: calls.length,
    outputs: calls,
    diagnosticsCount: Array.isArray(source.diagnostics) ? source.diagnostics.length : 0
  });
}

function hostInteractionDecisionSummary(decisions) {
  if (!Array.isArray(decisions)) return [];
  return decisions.map((item) => stableObject({
    output_id: Number.isInteger(item.output_id) ? item.output_id : null,
    output: typeof item.output === "string" ? item.output : null,
    capability: typeof item.capability === "string" ? item.capability : null,
    decision: typeof item.decision === "string" ? item.decision : null,
    reasonCode: typeof item.reasonCode === "string" ? item.reasonCode : null,
    statusCode: Number.isInteger(item.statusCode) ? item.statusCode : null
  })).sort((a, b) =>
    Number(a.output_id || 0) - Number(b.output_id || 0) ||
    String(a.output || "").localeCompare(String(b.output || "")) ||
    String(a.decision || "").localeCompare(String(b.decision || "")));
}

function hostInteractionDiagnostics(evidence) {
  if (!evidence) return [];
  const diagnostics = [];
  if (evidence.kind !== "air.hostInteractionEvidence") {
    diagnostics.push({
      code: "air.host_interaction.evidence_invalid",
      severity: "fail",
      source: "verification-evidence",
      message: "host interaction evidence kind must be air.hostInteractionEvidence",
      fields: { kind: evidence.kind || null }
    });
  }
  if (evidence.status === "failed") {
    diagnostics.push({
      code: "air.host_interaction.policy_failed",
      severity: "fail",
      source: "verification-evidence",
      message: "host interaction evidence status is failed",
      fields: {
        policyId: evidence.policyId || null,
        hostProfile: evidence.hostProfile || null,
        decisionsCount: Array.isArray(evidence.decisions) ? evidence.decisions.length : 0,
        deniedCapabilitiesCount: Array.isArray(evidence.deniedCapabilities) ? evidence.deniedCapabilities.length : 0,
        diagnosticsCount: Array.isArray(evidence.diagnostics) ? evidence.diagnostics.length : 0
      }
    });
  }
  return diagnostics;
}

function moduleEvidence(modules, diagnostics) {
  return (modules || []).map((mod) => {
    const item = {
    path: mod.path || null,
    name: mod.name || null,
    status: "checked",
    imports: sortedStrings(mod.imports || []),
    capabilities: sortedStrings(mod.capabilities || []),
    hostImports: sortedStrings(mod.hostImports || []),
    exports: sortedStrings(mod.exports || []),
    functions: sortedStrings((mod.functions || []).map((fn) => fn.name).filter(Boolean)),
    staticTables: (mod.staticTables || []).map((table) => stableObject({
      name: table.name,
      elementType: table.elementType || table.type || null,
      storageType: table.storageType || table.elementType || table.type || null,
      length: table.length || 0,
      byteSize: table.byteSize || null,
      equivalentI32Bytes: table.equivalentI32Bytes || null,
      estimatedI32SavingsBytes: table.estimatedI32SavingsBytes || null
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    stateSegments: stateSegmentEvidence(mod.stateSegments || []),
    diagnostics: diagnosticsForPath(diagnostics, mod.path)
    };
    const tableGroups = tableGroupEvidence(mod.tableGroups || []);
    if (tableGroups.length) item.tableGroups = tableGroups;
    const pools = poolEvidence(mod.pools || []);
    if (pools.length) item.pools = pools;
    return stableObject(item);
  }).sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function collectModuleTableGroups(modules) {
  return (modules || []).flatMap((mod) => (mod.tableGroups || []).map((group) => ({
    ...group,
    module: group.module || mod.path || null
  })));
}

function collectModuleStateSegments(modules) {
  return (modules || []).flatMap((mod) => (mod.stateSegments || []).map((segment) => ({
    ...segment,
    module: segment.module || mod.path || null
  })));
}

function collectModulePools(modules) {
  return (modules || []).flatMap((mod) => (mod.pools || []).map((pool) => ({
    ...pool,
    module: pool.module || mod.path || null
  })));
}

function tableGroupEvidence(groups) {
  return (groups || []).map((group) => stableObject({
    module: group.module || null,
    name: group.name || null,
    length: group.length || 0,
    fieldCount: group.fieldCount || ((group.fields || []).length),
    byteSize: group.byteSize || null,
    fields: (group.fields || []).map((field) => stableObject({
      name: field.name || null,
      type: field.type || null,
      storageType: field.storageType || field.type || null,
      length: field.length || group.length || 0,
      byteSize: field.byteSize || null,
      loweredTableName: field.loweredTableName || null
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    diagnostics: (group.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) =>
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

function poolEvidence(pools) {
  return (pools || []).map((pool) => stableObject({
    module: pool.module || pool.ownerModule || null,
    ownerModule: pool.ownerModule || pool.module || null,
    name: pool.name || null,
    capacity: pool.capacity || 0,
    fieldCount: pool.fieldCount || ((pool.fields || []).length),
    fields: (pool.fields || []).map((field) => stableObject({
      name: field.name || null,
      type: field.type || null,
      byteSize: field.byteSize || null,
      initializer: field.initializer || null
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    activeField: pool.activeField || "active",
    storageFootprint: pool.storageFootprint || pool.staticBytes || null,
    staticBytes: pool.staticBytes || pool.storageFootprint || null,
    readBudget: pool.readBudget || null,
    writeBudget: pool.writeBudget || null,
    moduleObservedReads: pool.moduleObservedReads || 0,
    moduleObservedWrites: pool.moduleObservedWrites || 0,
    generatedArtifactStatus: pool.generatedArtifactStatus || null,
    diagnostics: (pool.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) =>
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}

function stateSegmentEvidence(segments) {
  return (segments || []).map((segment) => stableObject({
    module: segment.module || null,
    name: segment.name || null,
    cellType: segment.cellType || null,
    length: segment.length || 0,
    byteSize: segment.byteSize || segment.staticBytes || null,
    staticBytes: segment.staticBytes || segment.byteSize || null,
    persistent: segment.persistent !== false,
    exported: Boolean(segment.exported),
    shared: Boolean(segment.shared),
    initializer: segment.initializer || null,
    readBudget: segment.readBudget || null,
    writeBudget: segment.writeBudget || null,
    sizeBudget: segment.sizeBudget || null,
    moduleObservedReads: segment.moduleObservedReads || 0,
    moduleObservedWrites: segment.moduleObservedWrites || 0,
    diagnostics: (segment.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) =>
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}

function stateHandleSetEvidence(sets) {
  return (sets || []).map((set) => stableObject({
    path: set.path || null,
    metadataPath: set.metadataPath || null,
    status: set.status || null,
    sourceFingerprint: set.sourceFingerprint || null,
    generatedFingerprint: set.generatedFingerprint || null,
    expectedGeneratedFingerprint: set.expectedGeneratedFingerprint || null,
    sourceModules: (set.sourceModules || []).map((source) => stableObject({
      path: source.path || null,
      fingerprint: source.fingerprint || null
    })).sort((a, b) => String(a.path).localeCompare(String(b.path))),
    states: (set.states || []).map((state) => stableObject({
      name: state.name || null,
      id: state.id || 0,
      cellType: state.cellType || null,
      length: state.length || 0,
      byteSize: state.byteSize || 0
    })).sort((a, b) => a.id - b.id || String(a.name).localeCompare(String(b.name))),
    diagnostics: (set.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)) || String(a.status).localeCompare(String(b.status)));
}

function stateAccessorPolicyEvidence(policies) {
  return (policies || []).map((policy) => stableObject({
    path: policy.path || null,
    status: policy.status || null,
    helpers: (policy.helpers || []).map((helper) => stableObject({
      name: helper.name || null,
      state: helper.state || null,
      exported: Boolean(helper.exported),
      observationOnly: Boolean(helper.observationOnly),
      status: helper.status || null,
      module: helper.module || null,
      returnType: helper.returnType || null
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    diagnostics: (policy.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)) || String(a.status).localeCompare(String(b.status)));
}

function factSchemaEvidence(schemas) {
  return (schemas || []).map((schema) => stableObject({
    path: schema.path,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    status: schema.exists === false ? "missing" : (schema.ok ? "passed" : "failed"),
    fingerprint: schema.fingerprint || null,
    hash: schema.fingerprint || null,
    schemaVersion: schema.schemaVersion || null,
    kind: schema.kind || "air.factsSchema",
    factsCount: (schema.facts || []).length,
    privacyPolicy: schema.privacyPolicy || null,
    rowset: schema.rowset ? stableObject({
      name: schema.rowset.name || null,
      kind: schema.rowset.kind || "air.boundedRowsetSchema",
      layout: schema.rowset.layout || null,
      maxRows: schema.rowset.maxRows || null,
      columnCount: schema.rowset.columnCount || 0,
      storage: schema.rowset.storage || null,
      columns: (schema.rowset.columns || []).map((column) => stableObject({
        name: column.name,
        type: column.type,
        enum: column.enum || null,
        range: column.range || null,
        storageHint: column.storageHint || null,
        privacy: column.privacy || null,
        ...(column.flowLabel ? { flowLabel: column.flowLabel } : {})
      })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
    }) : null,
    facts: (schema.facts || []).map((fact) => stableObject({
      id: fact.id,
      name: fact.name,
      maxRows: fact.maxRows,
      columnCount: fact.columnCount,
      capability: fact.capability || null,
      privacy: fact.privacy || null,
      ...((fact.columns || []).some((column) => column.flowLabel) ? {
        columns: (fact.columns || []).map((column) => stableObject({
          name: column.name || null,
          type: column.type || null,
          ...(column.flowLabel ? { flowLabel: column.flowLabel } : {})
        })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
      } : {})
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    diagnostics: (schema.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function outputContractEvidence(schemas) {
  return (schemas || []).map((schema) => stableObject({
    path: schema.path,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    status: schema.exists === false ? "missing" : (schema.ok ? "passed" : "failed"),
    fingerprint: schema.fingerprint || null,
    hash: schema.fingerprint || null,
    schemaVersion: schema.schemaVersion || null,
    kind: schema.kind || null,
    outputsCount: schema.outputsCount || 0,
    channels: sortedStrings(schema.channels || []),
    capabilities: sortedStrings(schema.capabilities || []),
    ...((schema.outputs || []).some((output) => (output.args || []).some((arg) => arg.flowLabel)) ? {
      outputs: (schema.outputs || []).map((output) => stableObject({
        id: output.id || null,
        name: output.name || null,
        args: (output.args || []).map((arg) => stableObject({
          name: arg.name || null,
          type: arg.type || null,
          ...(arg.flowLabel ? { flowLabel: arg.flowLabel } : {})
        })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
      })).sort((a, b) => Number(a.id || 0) - Number(b.id || 0) || String(a.name).localeCompare(String(b.name)))
    } : {}),
    diagnostics: (schema.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function outputHandleSetEvidence(sets) {
  return (sets || []).map((set) => stableObject({
    path: set.path || null,
    metadataPath: set.metadataPath || null,
    status: set.status || null,
    sourceFingerprint: set.sourceFingerprint || null,
    generatedFingerprint: set.generatedFingerprint || null,
    expectedGeneratedFingerprint: set.expectedGeneratedFingerprint || null,
    sourceContracts: (set.sourceContracts || []).map((source) => stableObject({
      path: source.path || null,
      fingerprint: source.fingerprint || null
    })).sort((a, b) => String(a.path).localeCompare(String(b.path))),
    outputs: (set.outputs || []).map((output) => stableObject({
      id: output.id || 0,
      name: output.name || null,
      handle: output.handle || null,
      channel: output.channel || null,
      capability: output.capability || null,
      argCount: output.argCount || 0
    })).sort((a, b) => a.id - b.id || String(a.name).localeCompare(String(b.name))),
    diagnostics: (set.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)) || String(a.status).localeCompare(String(b.status)));
}

function commandBufferEvidence(schemas) {
  return (schemas || []).map((schema) => stableObject({
    path: schema.path,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    status: schema.exists === false ? "missing" : (schema.ok ? "passed" : "failed"),
    fingerprint: schema.fingerprint || null,
    hash: schema.fingerprint || null,
    schemaVersion: schema.schemaVersion || null,
    kind: schema.kind || null,
    name: schema.name || null,
    maxCommands: schema.maxCommands || null,
    recordCount: schema.recordCount || 0,
    usedOutputIds: (schema.usedOutputIds || []).slice().sort((a, b) => a - b),
    diagnostics: (schema.diagnostics || []).map((diagnostic) => normalizeDiagnostic(diagnostic)).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function generatedArtifactEvidence(report) {
  const groups = [];
  for (const [kind, source] of [
    ["generatedArtifacts", report.generatedArtifacts],
    ["generatedHandles", report.generatedHandles]
  ]) {
    if (!source) continue;
    for (const file of source.files || []) {
      groups.push(stableObject({
        kind,
        path: file.path || null,
        status: file.status || null,
        fingerprint: file.fingerprint || null,
        hash: file.fingerprint || null,
        expectedFingerprint: file.expectedFingerprint || null,
        manifestFingerprint: file.manifestFingerprint || null,
        expectedManifestFingerprint: file.expectedManifestFingerprint || null,
        sourceManifests: sourceManifestsForGeneratedFile(file),
        diagnostics: diagnosticsForGeneratedFile(kind, file, source)
      }));
    }
    for (const error of source.errors || []) {
      groups.push(stableObject({
        kind,
        path: null,
        status: "failed",
        fingerprint: null,
        expectedFingerprint: null,
        manifestFingerprint: null,
        expectedManifestFingerprint: null,
        sourceManifests: [],
        diagnostics: [normalizeDiagnostic({
          code: "air.generated.stale",
          severity: "fail",
          source: "verification-evidence",
          message: error,
          fields: { kind }
        })],
        error
      }));
    }
  }
  return groups.sort((a, b) =>
    String(a.kind).localeCompare(String(b.kind)) ||
    String(a.path || "").localeCompare(String(b.path || "")) ||
    String(a.status || "").localeCompare(String(b.status || "")));
}

function sourceManifestsForGeneratedFile(file) {
  return (file.sources || [])
    .filter((source) => source && source.path)
    .map((source) => stableObject({
      path: source.path,
      exists: Boolean(source.exists),
      ref: source.ref || source.path
    }))
    .sort((a, b) => String(a.path).localeCompare(String(b.path)) || String(a.ref).localeCompare(String(b.ref)));
}

function diagnosticsForGeneratedFile(kind, file, source) {
  const diagnostics = [];
  if (file.status === "missing" || file.status === "stale") {
    diagnostics.push(normalizeDiagnostic({
      code: "air.generated.stale",
      severity: "fail",
      source: "verification-evidence",
      message: `generated artifact ${file.status}: ${file.path}`,
      file: file.path || null,
      fields: { kind, status: file.status, path: file.path || null }
    }));
  }
  for (const error of source.errors || []) {
    if (file.path && !String(error).includes(file.path)) continue;
    diagnostics.push(normalizeDiagnostic({
      code: "air.generated.stale",
      severity: "fail",
      source: "verification-evidence",
      message: error,
      file: file.path || null,
      fields: { kind, path: file.path || null }
    }));
  }
  return sortDiagnostics(diagnostics);
}

function diagnosticsForPath(diagnostics, filePath) {
  if (!filePath) return [];
  return sortDiagnostics((diagnostics || []).filter((diagnostic) =>
    diagnostic.file === filePath ||
    diagnostic.module === filePath ||
    diagnostic.fields?.path === filePath
  ));
}

function capabilityEvidence(report) {
  return stableObject({
    declared: sortedStrings(report.declaredCapabilities || []),
    computed: sortedStrings(report.computedCapabilities || []),
    required: sortedStrings((report.capabilities && report.capabilities.required) || []),
    supported: sortedStrings((report.capabilities && report.capabilities.supported) || []),
    unsupported: sortedStrings((report.capabilities && report.capabilities.unsupported) || []),
    hostImports: stableObject({
      used: sortedStrings((report.hostImports && report.hostImports.used) || []),
      unsupported: sortedStrings((report.hostImports && report.hostImports.unsupported) || [])
    })
  });
}

function profileCompatibilityEvidence(report, evidenceStatus) {
  const requiredHostAbi = report.hostAbi || HOST_ABI_VERSION;
  if (evidenceStatus === "not_run" || !report.profile) {
    return stableObject({
      profile: report.profile || null,
      status: "not_run",
      reason: evidenceStatus === "not_run" ? "verification was not run" : "no profile selected",
      requiredHostAbi,
      supportedHostAbi: null,
      diagnostics: []
    });
  }
  const support = report.profileSupport || {};
  const supportedHostAbi = support.hostAbi || support.profileHostAbi || null;
  return stableObject({
    profile: report.profile,
    status: support.status || "failed",
    requiredHostAbi: support.requiredHostAbi || requiredHostAbi,
    supportedHostAbi,
    capabilities: support.capabilities || { required: [], supported: [], unsupported: [] },
    hostImports: support.hostImports || { required: [], supported: [], unsupported: [] },
    manifestKinds: support.manifestKinds || { required: [], supported: [], unsupported: [] },
    assetKinds: support.assetKinds || { required: [], supported: [], unsupported: [] },
    diagnostics: support.diagnostics || [],
    errors: sortedStrings(support.errors || [])
  });
}

function firstFailingModule(diagnostics, errors, modules) {
  const diagnostic = (diagnostics || []).find((item) => item.severity === "fail" && (item.module || item.file));
  if (diagnostic) return diagnostic.module || diagnostic.file;
  for (const error of errors || []) {
    const match = String(error).match(/\b([A-Za-z0-9_./-]+\.air)\b/);
    if (match) return match[1];
  }
  return modules.length === 1 ? modules[0].path : null;
}

function hashStable(value) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
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

function sanitizeValue(value, base) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, base));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sanitizeValue(value[key], base);
    return out;
  }
  if (typeof value === "string") return sanitizeString(value, base);
  return value;
}

function sanitizeString(value, base) {
  const normalizedBase = normalizeSlash(path.resolve(base));
  const normalized = normalizeSlash(value);
  if (normalized === normalizedBase) return ".";
  if (normalized.startsWith(`${normalizedBase}/`)) return normalized.slice(normalizedBase.length + 1);
  return value;
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

function errorList(err) {
  if (err && Array.isArray(err.errors)) return err.errors.map((item) => String(item));
  return [err && err.message ? err.message : String(err)];
}

module.exports = {
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_EVIDENCE_KIND,
  createNotRunVerificationEvidence,
  createPackageVerificationEvidence,
  stableStringify,
  validateBorrowedMemoryInvocationEvidence
};
