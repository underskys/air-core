const fs = require("fs");
const { readBoundedJsonFile } = require("./bounded_file");
const path = require("path");
const { reportPackageDir } = require("./sdk");
const { createPackageVerificationEvidence } = require("./verification_evidence");

const OUTPUT_EMIT_LABEL = ["output", "emit"].join(".");

function createEvidenceMarkdownReport(packageDir, options = {}) {
  const base = path.resolve(packageDir || "");
  const hostEvidence = readJsonOptional(options.hostEvidence, base);
  const conformance = readJsonOptional(options.conformance, base);
  const e2eProof = readJsonOptional(options.e2eProof, base);
  const benchmark = readJsonOptional(options.benchmark, base);
  const semanticPatch = options.semanticPatch || null;
  const evidence = createPackageVerificationEvidence(base, {
    profile: options.profile || null,
    hostEvidence: hostEvidence || null,
    certificateRequired: Boolean(options.certificateRequired),
    semanticPatch,
    semanticPatchStrict: Boolean(options.semanticPatchStrict)
  });
  const packageReport = loadPackageReport(base);
  const lines = [];

  heading(lines, 1, "AIR Evidence Report");
  table(lines, [
    ["Package", evidence.packageName || evidence.package || "-"],
    ["Package ID", evidence.packageId || evidence.packageName || evidence.package || "-"],
    ["Verification status", statusWord(evidence.status)],
    ["AIR ABI", evidence.airAbi || "-"],
    ["Required Host ABI", evidence.hostAbi || "-"],
    ["Package hash", evidence.packageHash || "-"]
  ]);

  heading(lines, 2, "Review Summary");
  table(lines, [
    ["Outcome", statusWord(evidence.status)],
    ["Next action", statusWord(evidence.status) === "passed" ? "Review claims and host-boundary evidence." : "Resolve failing diagnostics before approval."],
    ["Authority boundary", "AIR evidence only; the host retains side-effect authority."],
    ["Determinism", "No timestamps or absolute paths."]
  ]);

  heading(lines, 2, "Capabilities");
  const capabilities = evidence.capabilitySummary || {};
  table(lines, [
    ["Declared", joinList(capabilities.declared || [])],
    ["Computed", joinList(capabilities.computed || [])],
    ["Required", joinList(capabilities.required || [])],
    ["Host imports", joinList((capabilities.hostImports && capabilities.hostImports.used) || [])],
    ["Unsupported", joinList([...(capabilities.unsupported || []), ...((capabilities.hostImports && capabilities.hostImports.unsupported) || [])])]
  ]);

  heading(lines, 2, "Effects");
  const effectRows = effectSummaryRows(packageReport);
  if (effectRows.length) table(lines, effectRows);
  else lines.push("No effect usage summary was reported.", "");

  if (evidence.resourceCertificate && (evidence.resourceCertificate.mode === "required" || options.certificateRequired)) {
    heading(lines, 2, "Verified Resource Certificate");
    table(lines, resourceCertificateRows(evidence.resourceCertificate));
  }

  if (evidence.provenanceFlow && evidence.provenanceFlow.mode === "required") {
    heading(lines, 2, "Provenance Flow");
    table(lines, provenanceFlowRows(evidence.provenanceFlow));
  }

  if (evidence.semanticPatch) {
    heading(lines, 2, "Semantic Patch");
    table(lines, semanticPatchRows(evidence.semanticPatch));
  }

  heading(lines, 2, "Output Intents");
  const outputRows = outputIntentRows(evidence);
  if (outputRows.length) table(lines, outputRows);
  else lines.push(`No output intents or ${OUTPUT_EMIT_LABEL} usage were reported.`, "");

  heading(lines, 2, "Structured IO");
  const structuredRows = structuredIoRows(evidence);
  if (structuredRows.length) table(lines, structuredRows);
  else lines.push("No structured IO metadata was reported.", "");

  const poolRows = poolRowsForEvidence(evidence);
  if (poolRows.length) {
    heading(lines, 2, "Declared Pools");
    table(lines, poolRows);
  }

  heading(lines, 2, "Host Policy Result");
  const host = hostEvidence || evidence.hostInteractionEvidence || null;
  if (host) {
    table(lines, hostPolicyRows(host));
  } else {
    lines.push("Not run.", "");
  }

  heading(lines, 2, "Replay / Conformance");
  if (conformance) table(lines, replaySummaryRows(createReplaySummary(conformance, host)));
  else lines.push("Not run.", "");

  if (e2eProof) {
    heading(lines, 2, "End-to-End Proof");
    table(lines, e2eProofRows(e2eProof));
  }

  heading(lines, 2, "Diagnostics");
  diagnosticSections(lines, [
    ...(evidence.diagnostics || []),
    ...hostDiagnostics(host),
    ...((conformance && conformance.diagnostics) || []),
    ...((e2eProof && e2eProof.diagnostics) || []),
    ...((benchmark && benchmark.diagnostics) || [])
  ]);

  heading(lines, 2, "Generated Artifacts");
  const generatedRows = generatedArtifactRows(evidence.generatedArtifacts || []);
  if (generatedRows.length) table(lines, generatedRows);
  else lines.push("No generated artifacts were reported.", "");

  heading(lines, 2, "Benchmark Summary");
  if (benchmark) table(lines, benchmarkRows(benchmark));
  else lines.push("Not provided.", "");

  heading(lines, 2, "Privacy Boundary");
  lines.push("This report is derived from AIR evidence surfaces and omits sensitive payload classes and direct state/helper dumps by default.", "");

  return `${lines.join("\n").trim()}\n`;
}

function createBorrowedMemoryEvidenceReport(evidence) {
  if (!evidence || evidence.kind !== "air.borrowedMemoryInvocationEvidence") {
    throw new Error("borrowed-memory evidence is required");
  }
  const lines = [];
  heading(lines, 1, "AIR Borrowed Memory Invocation");
  table(lines, [
    ["Status", evidence.status || "-"],
    ["Entrypoint", evidence.entrypoint || "-"],
    ["AIR ABI", evidence.airAbi || "-"],
    ["Feature", evidence.feature || "-"],
    ["Memory domain", evidence.memoryDomain || "-"],
    ["Transfer modes", joinList(evidence.transferModes || [])],
    ["Validation", evidence.validationOutcome || "-"],
    ["Interface digest", evidence.interfaceDigest || "-"],
    ["Module digest", evidence.moduleDigest || "-"],
    ["Package digest", evidence.packageDigest || "-"],
    ["Certificate digest", evidence.resourceCertificateDigest || "-"],
    ["Failure reason", evidence.failureReason || "none"],
    ["Invocation identity / binding digest", evidence.bindingDigest || "-"],
    ["Evidence digest", evidence.evidenceDigest || "-"]
  ]);
  heading(lines, 2, "Bindings");
  const rows = (evidence.parameters || []).map((parameter) => [
    parameter.name,
    [
      parameter.access,
      parameter.transferMode,
      `${parameter.actualLength}/${parameter.maximumLength} bytes`,
      `align=${parameter.alignment && parameter.alignment.required}`,
      `copy-in=${parameter.bytesCopiedIn}`,
      `copy-out=${parameter.bytesCopiedOut}`
    ].join(", ")
  ]);
  if (rows.length) table(lines, rows);
  else lines.push("No borrowed-memory bindings were reported.", "");
  heading(lines, 2, "Boundary");
  lines.push(
    "`wasm_memory_view` reports selected-instance backing identity only. It is not a universal native-memory zero-copy claim.",
    ""
  );
  return `${lines.join("\n").trim()}\n`;
}

function heading(lines, level, title) {
  lines.push(`${"#".repeat(level)} ${title}`, "");
}

function table(lines, rows) {
  lines.push("| Field | Value |", "| --- | --- |");
  for (const [field, value] of rows) lines.push(`| ${escapeCell(field)} | ${escapeCell(value)} |`);
  lines.push("");
}

function diagnosticSections(lines, diagnostics) {
  const groups = {
    fail: [],
    warn: [],
    info: [],
    hint: []
  };
  for (const diagnostic of diagnostics || []) {
    const severity = diagnostic.severity || diagnostic.status || "info";
    if (!groups[severity]) groups[severity] = [];
    groups[severity].push(diagnostic);
  }
  const rows = [];
  for (const severity of Object.keys(groups).sort()) {
    const items = groups[severity].slice().sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)));
    rows.push([severity, items.length ? items.map((item) => `${item.code}: ${item.message}`).join("<br>") : "none"]);
  }
  table(lines, rows);
}

function effectSummaryRows(packageReport) {
  const origins = packageReport && packageReport.effectUsageOrigins ? packageReport.effectUsageOrigins : {};
  const rows = [];
  for (const modulePath of Object.keys(origins).sort()) {
    const usage = origins[modulePath] || {};
    const parts = Object.keys(usage)
      .sort()
      .filter((key) => typeof usage[key] === "number" && usage[key] !== 0)
      .map((key) => `${key}=${usage[key]}`);
    rows.push([modulePath, parts.length ? parts.join(", ") : "reported"]);
  }
  return rows;
}

function resourceCertificateRows(certificate) {
  if (!certificate) return [];
  const bounds = certificate.bounds || {};
  const loops = bounds.loops || {};
  const memory = bounds.memory || {};
  const hostCalls = bounds.hostCalls || {};
  const outputs = bounds.outputs || {};
  const borrowed = bounds.borrowedMemory || {};
  const unknown = certificate.classifications && certificate.classifications.unknown || [];
  const unsupported = certificate.classifications && certificate.classifications.unsupported || [];
  return [
    ["Status", certificate.status || "-"],
    ["Mode", certificate.mode || "-"],
    ["Certificate digest", certificate.certificateDigest || "-"],
    ["Package digest", certificate.package && certificate.package.digest || "-"],
    ["Verifier digest", certificate.verifier && certificate.verifier.digest || "-"],
    ["Maximum static loop iterations", formatNumber(loops.maximumStaticallyBoundedIterations)],
    ["Dynamic-loop fuel upper bound", formatNumber(loops.totalDynamicLoopFuelUpperBound)],
    ["Static memory upper bound", `${formatNumber(memory.totalStaticBytesUpperBound)} bytes`],
    ["Dynamic allocation bytes", memory.dynamicAllocationBytesUpperBound == null ? "unknown" : `${formatNumber(memory.dynamicAllocationBytesUpperBound)} bytes`],
    ["Host-call upper bound", formatNumber(hostCalls.totalUpperBound)],
    ["Output host-call upper bound", formatNumber(outputs.totalHostCallUpperBound)],
    ["Borrowed parameters", formatNumber(borrowed.borrowedParameterCount)],
    ["Maximum borrowed bytes", `${formatNumber(borrowed.maximumTotalBorrowedBytes)} bytes`],
    ["Maximum readable borrowed bytes", `${formatNumber(borrowed.maximumReadableBytes)} bytes`],
    ["Maximum writable borrowed bytes", `${formatNumber(borrowed.maximumWritableBytes)} bytes`],
    ["Maximum copy-in bytes", `${formatNumber(borrowed.maximumCopyInBytes)} bytes`],
    ["Maximum copy-out bytes", `${formatNumber(borrowed.maximumCopyOutBytes)} bytes`],
    ["Maximum typed reads", formatNumber(borrowed.maximumTypedReads)],
    ["Maximum typed writes", formatNumber(borrowed.maximumTypedWrites)],
    ["Maximum dynamic borrow checks", formatNumber(borrowed.maximumDynamicBoundsChecks)],
    ["Maximum relation checks", formatNumber(borrowed.maximumRelationChecks)],
    ["Borrowed AIR ABI", borrowed.airAbi || "-"],
    ["Borrowed feature", borrowed.feature || "-"],
    ["Borrowed transfer modes", joinList(borrowed.supportedTransferModes || [])],
    ["Borrowed alias policy", borrowed.aliasPolicy || "-"],
    ["Borrowed-memory digest", borrowed.digest || "-"],
    ["Unknown bounds", unknown.length ? unknown.map((item) => `${item.code}: ${item.reason}`).join("<br>") : "none"],
    ["Unsupported claims", unsupported.length ? unsupported.map((item) => item.code).join(", ") : "none"],
    ["Host enforcement", "Separate host responsibility; this report does not claim runtime enforcement."]
  ];
}

function provenanceFlowRows(flow) {
  return [
    ["Status", flow.status || "-"],
    ["Mode", flow.mode || "-"],
    ["Lattice", joinList(flow.fixedLattice || [])],
    ["Policy digest", flow.policyDigest || "-"],
    ["Analyzer digest", flow.analyzerDigest || "-"],
    ["Summary digest", flow.summaryDigest || "-"],
    ["Sources", String((flow.sources || []).length)],
    ["Sinks", String((flow.sinks || []).length)],
    ["Accepted flows", String((flow.acceptedFlows || []).length)],
    ["Rejected flows", String((flow.rejectedFlows || []).length)],
    ["Declassifications", String((flow.declassifications || []).length)],
    ["Unsupported channels", joinList(flow.unsupportedChannels || [])],
    ["Security boundary", "Bounded explicit data/control dependencies only; no timing, termination, covert-channel, microarchitectural, or universal noninterference claim."]
  ];
}

function semanticPatchRows(patch) {
  return [
    ["Status", patch.status || "-"],
    ["Mode", patch.mode || "-"],
    ["Base digest", patch.baseDigest || "-"],
    ["Result digest", patch.resultDigest || "-"],
    ["Patch digest", patch.patchDigest || "-"],
    ["Operations", String(patch.operationCount || 0)],
    ["Classification", joinList(patch.classifications || [])],
    ["Expansions", String((patch.expansions || []).length)],
    ["Narrowings", String((patch.narrowings || []).length)],
    ["Compatibility findings", String((patch.compatibilityFindings || []).length)],
    ["Provenance findings", String((patch.provenanceFindings || []).length)],
    ["Resource findings", String((patch.resourceFindings || []).length)],
    ["Rejected reasons", joinList(patch.rejectedReasons || [])],
    ["Analyzer digest", patch.analyzerDigest || "-"],
    ["Summary digest", patch.summaryDigest || "-"],
    ["Proof boundary", "Canonical semantic-object comparison only; textual differences are never semantic proof."]
  ];
}

function outputIntentRows(evidence) {
  const rows = [];
  for (const contract of evidence.outputContracts || []) {
    rows.push([`contract ${contract.path || contract.name || "-"}`, `${contract.status || "reported"}; outputs=${contract.outputsCount || (contract.outputs || []).length || 0}; hash=${contract.fingerprint || contract.hash || "-"}`]);
  }
  for (const buffer of evidence.commandBuffers || []) {
    rows.push([`command buffer ${buffer.path || buffer.name || "-"}`, `${buffer.status || "reported"}; records=${buffer.recordCount || 0}; hash=${buffer.fingerprint || buffer.hash || "-"}`]);
  }
  if (evidence.outputEmit && evidence.outputEmit.used) {
    const count = (evidence.outputEmit.calls || evidence.outputEmit.used || []).length || evidence.outputEmit.callCount || 0;
    rows.push([OUTPUT_EMIT_LABEL, `used; calls=${count}`]);
  }
  return rows;
}

function structuredIoRows(evidence) {
  const structured = evidence && evidence.structuredIO ? evidence.structuredIO : {};
  const rows = [];
  for (const schema of structured.schemas || []) {
    const fieldCount = Number.isInteger(schema.fieldCount)
      ? schema.fieldCount
      : Array.isArray(schema.fields) ? schema.fields.length : 0;
    const maxRows = schema.maxRows == null ? "n/a" : String(schema.maxRows);
    rows.push([
      `schema ${schema.name || schema.path || "-"}`,
      `${schema.kind || "reported"}; fields=${fieldCount}; maxRows=${maxRows}; status=${schema.status || (schema.ok === false ? "failed" : "passed")}`
    ]);
  }
  for (const handleSet of structured.handleSets || []) {
    const schemaCount = Array.isArray(handleSet.sourceSchemas) ? handleSet.sourceSchemas.length
      : Array.isArray(handleSet.schemas) ? handleSet.schemas.length
        : 0;
    rows.push([
      `handles ${handleSet.path || "-"}`,
      `${handleSet.status || "reported"}; schemas=${schemaCount}; hash=${handleSet.generatedFingerprint || handleSet.sourceFingerprint || "-"}`
    ]);
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

function poolRowsForEvidence(evidence) {
  const rows = [];
  for (const pool of evidence.pools || []) {
    rows.push([
      `pool ${pool.name || "-"}`,
      `capacity=${pool.capacity || 0}; fields=${pool.fieldCount || (pool.fields || []).length || 0}; active=${pool.activeField || "active"}; staticBytes=${pool.staticBytes || pool.storageFootprint || 0}; reads=${pool.moduleObservedReads || 0}; writes=${pool.moduleObservedWrites || 0}`
    ]);
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

function hostPolicyRows(host) {
  const decisions = Array.isArray(host.decisions) ? host.decisions : [];
  const counts = countBy(decisions, (item) => item.decision || item.status || "unknown");
  return [
    ["Status", statusWord(host.status || "not_run")],
    ["Policy", host.policyId || "-"],
    ["Host profile", host.hostProfile || host.profile || "-"],
    ["Replay checksum", host.replayChecksum || "-"],
    ["Allowed", String(counts.allow || counts.allowed || 0)],
    ["Denied", String(counts.deny || counts.denied || 0)],
    ["Unknown output", String(counts.unknown_output || 0)],
    ["Unsupported profile", String(counts.unsupported_profile || 0)]
  ];
}

function hostDiagnostics(host) {
  if (!host) return [];
  const out = Array.isArray(host.diagnostics) ? host.diagnostics.slice() : [];
  for (const decision of host.decisions || []) {
    for (const diagnostic of decision.diagnostics || []) out.push(diagnostic);
  }
  return out;
}

function createReplaySummary(conformance, hostEvidence = null) {
  const commands = conformance && conformance.commands ? conformance.commands : {};
  const outputs = conformance && conformance.outputs ? conformance.outputs : {};
  const mismatches = Array.isArray(conformance && conformance.mismatches) ? conformance.mismatches : [];
  const stateDigest = conformance && conformance.stateDigest ? conformance.stateDigest : null;
  return stableObject({
    fixtureId: conformance && conformance.trace && conformance.trace.id || null,
    fixtureKind: conformance && conformance.trace && conformance.trace.kind || null,
    package: conformance && conformance.package || null,
    status: statusWord(conformance && conformance.status || "not_run"),
    replayChecksum: conformance && conformance.replayChecksum || null,
    expectedOutputCount: numberOrNull(outputs.expectedCount),
    observedOutputCount: numberOrNull(outputs.observedCount),
    expectedCommandCount: numberOrNull(commands.expectedCount),
    observedCommandCount: numberOrNull(commands.observedCount),
    mismatchCount: mismatches.length,
    mismatchKinds: uniqueSorted(mismatches.map((item) => item && item.kind).filter(Boolean)),
    outputIds: replayOutputIds(conformance),
    stateDigest: stateDigest ? stableObject({
      status: stateDigest.expected && stateDigest.observed && stateDigest.expected === stateDigest.observed ? "passed" : "failed",
      expected: stateDigest.expected || null,
      observed: stateDigest.observed || null,
      helperCount: numberOrNull(stateDigest.helperCount)
    }) : null,
    hostInteractionStatus: hostEvidence ? statusWord(hostEvidence.status || "not_run") : "not_run"
  });
}

function replaySummaryRows(summary) {
  return [
    ["Fixture", summary.fixtureId || "-"],
    ["Fixture kind", summary.fixtureKind || "-"],
    ["Status", summary.status || "not_run"],
    ["Package", summary.package || "-"],
    ["Replay checksum", summary.replayChecksum || "-"],
    ["Expected outputs", formatNumber(summary.expectedOutputCount)],
    ["Observed outputs", formatNumber(summary.observedOutputCount)],
    ["Expected commands", formatNumber(summary.expectedCommandCount)],
    ["Observed commands", formatNumber(summary.observedCommandCount)],
    ["Mismatch count", formatNumber(summary.mismatchCount)],
    ["Mismatch kinds", joinList(summary.mismatchKinds || [])],
    ["Output IDs involved", joinList((summary.outputIds || []).map(String))],
    ["State digest", stateDigestSummary(summary.stateDigest)],
    ["Host interaction evidence", summary.hostInteractionStatus || "not_run"]
  ];
}

function replayOutputIds(conformance) {
  const ids = [];
  for (const record of [
    ...(((conformance && conformance.outputs && conformance.outputs.expected) || [])),
    ...(((conformance && conformance.outputs && conformance.outputs.observed) || []))
  ]) {
    if (Number.isInteger(record.id)) ids.push(record.id);
  }
  for (const record of [
    ...(((conformance && conformance.commands && conformance.commands.expected) || [])),
    ...(((conformance && conformance.commands && conformance.commands.observed) || []))
  ]) {
    if (Number.isInteger(record.output_id)) ids.push(record.output_id);
  }
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function e2eProofRows(proof) {
  const sections = proof && proof.evidenceReport && Array.isArray(proof.evidenceReport.sections)
    ? proof.evidenceReport.sections
    : [];
  const sectionStatus = new Map(sections.map((section) => [String(section.name || ""), statusWord(section.status)]));
  const outputIntent = proof.outputIntent || {};
  const hostDecision = proof.hostDecision || {};
  return [
    ["Status", statusWord(proof.status || "not_run")],
    ["Fixture", proof.fixtureId || "-"],
    ["Static validation", sectionStatus.get("static validation") || statusWord(proof.staticValidation && proof.staticValidation.status)],
    ["Package policy validation", sectionStatus.get("package policy validation") || statusWord(proof.packagePolicyValidation && proof.packagePolicyValidation.status)],
    ["Conformance replay", sectionStatus.get("conformance replay") || "not_run"],
    ["Runtime execution proof", sectionStatus.get("runtime execution proof") || statusWord(proof.executionProof && proof.executionProof.status)],
    ["Host policy simulation", sectionStatus.get("host policy simulation") || statusWord(proof.mockHostPolicy && proof.mockHostPolicy.status)],
    ["Output intent", outputIntent.id ? `${outputIntent.id}; args=${outputIntent.argCount || 0}; commands=${outputIntent.commandRecordCount || 0}` : "not available"],
    ["Host decision", hostDecision.decision ? `${hostDecision.decision}; reason=${hostDecision.reasonCode || "-"}` : "not_run"],
    ["Replay checksum", proof.replayChecksum || "-"],
    ["Limitations", joinList(proof.limitations || [])]
  ];
}

function stateDigestSummary(stateDigest) {
  if (!stateDigest) return "not available";
  const parts = [stateDigest.status || "reported"];
  if (stateDigest.expected) parts.push(`expected=${stateDigest.expected}`);
  if (stateDigest.observed) parts.push(`observed=${stateDigest.observed}`);
  if (stateDigest.helperCount != null) parts.push(`helpers=${stateDigest.helperCount}`);
  return parts.join("; ");
}

function generatedArtifactRows(artifacts) {
  return (artifacts || []).map((artifact) => [
    artifact.path || "-",
    `${artifact.status || "reported"}; hash=${artifact.fingerprint || artifact.hash || "-"}`
  ]).sort((a, b) => a[0].localeCompare(b[0]));
}

function benchmarkRows(benchmark) {
  const metrics = benchmark.metrics || {};
  return [
    ["Benchmark", benchmark.benchmarkName || benchmark.benchmarkId || "-"],
    ["Status", statusWord(benchmark.status || "not_run")],
    ["Package hash", benchmark.packageHash || "-"],
    ["Package-check ms", metrics.packageCheckMs == null ? "-" : String(metrics.packageCheckMs)],
    ["Evidence ms", metrics.evidenceMs == null ? "-" : String(metrics.evidenceMs)],
    ["Evidence report ms", metrics.evidenceReportMs == null ? "-" : String(metrics.evidenceReportMs)],
    ["E2E proof ms", metrics.e2eProofMs == null ? "-" : String(metrics.e2eProofMs)],
    ["Mock host policy ms", metrics.mockHostPolicyMs == null ? "-" : String(metrics.mockHostPolicyMs)],
    ["Runtime ms", metrics.wasmExecutionMs == null ? "-" : String(metrics.wasmExecutionMs)],
    ["Output intents", metrics.outputIntentCount == null ? "-" : String(metrics.outputIntentCount)],
    ["Host crossings", metrics.hostCrossings == null ? "-" : String(metrics.hostCrossings)],
    ["Limitations", joinList(benchmark.limitations || [])]
  ];
}

function readJsonOptional(file, base) {
  if (!file) return null;
  if (file && typeof file === "object") return sanitizeValue(file, base);
  const absolute = path.resolve(file);
  const value = readBoundedJsonFile(absolute, { label: "evidence input" });
  return sanitizeValue(value, base);
}

function loadPackageReport(base) {
  try {
    return reportPackageDir(base);
  } catch (_) {
    return null;
  }
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
  let out = normalizeSlash(value);
  const normalizedBase = normalizeSlash(path.resolve(base || ""));
  if (normalizedBase && out === normalizedBase) out = ".";
  else if (normalizedBase && out.startsWith(`${normalizedBase}/`)) out = out.slice(normalizedBase.length + 1);
  return out;
}

function statusWord(value) {
  if (value === "pass") return "passed";
  if (value === "fail") return "failed";
  return String(value || "not_run");
}

function countBy(items, fn) {
  const out = {};
  for (const item of items || []) {
    const key = fn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function numberOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function formatNumber(value) {
  return value == null ? "-" : String(value);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map(String))).sort();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function joinList(values) {
  const list = (values || []).filter((value) => value !== null && value !== undefined && String(value) !== "").map(String).sort();
  return list.length ? list.join(", ") : "none";
}

function escapeCell(value) {
  return String(value == null ? "" : value)
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>");
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

module.exports = {
  createBorrowedMemoryEvidenceReport,
  createEvidenceMarkdownReport,
  createReplaySummary
};
