const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { verifyModule } = require("./verifier");
const { lowerToWat, watToWasm } = require("./lower_wasm");
const { checkPackageDir } = require("./sdk");
const { createConformanceReplayReport } = require("./conformance_replay");
const { createPackageVerificationEvidence } = require("./verification_evidence");
const { createMockHostInteractionEvidence } = require("./mock_host_policy");
const { normalizePackageMetadata, validatePackageManifest, HOST_ABI_VERSION } = require("./package_manifest");
const { AIR_ABI_VERSION } = require("./version");

const E2E_PROOF_SCHEMA_VERSION = "0.38";
const E2E_PROOF_KIND = "air.e2eProofReport";
const PRIVATE_KEY_RE = /(^|[_-])(raw_packet|packet_dump|packet_payload|raw_hostname|hostname|raw_mac|mac_address|raw_ip|ip_address|raw_url|secret|token|credential|private_text)([_-]|$)/i;
const OUTPUT_ARG_EXPORTS = ["diagnosis_code", "severity", "recommended_action_id", "confidence_x1000"];
const REQUIRED_FACTS = [
  "link_status",
  "latency_ms",
  "packet_loss_x1000",
  "gateway_reachable",
  "dns_reachable",
  "recent_change_flag",
  "interface_kind",
  "confidence_source",
  "observation_age_ms"
];

async function createE2eProofReport(packageDir, options = {}) {
  const base = path.resolve(packageDir || "");
  const profile = options.profile || "cli";
  const fixturePath = options.fixture ? path.resolve(options.fixture) : null;
  const policyPath = options.policy ? path.resolve(options.policy) : null;
  const diagnostics = [];
  const limitations = [
    "first slice executes one sanitized structured rowset row",
    "first slice captures one bounded scalar output intent"
  ];

  const manifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const packageName = metadata.name || path.basename(base);
  const fixture = readJsonFile(fixturePath, "fixture");
  const policy = readJsonFile(policyPath, "policy");

  if (!fixturePath) {
    diagnostics.push(diagnostic("air.e2e_proof.fixture_missing", "fail", "missing --fixture <fixture.json>", {}));
  }
  if (!policyPath) {
    diagnostics.push(diagnostic("air.e2e_proof.policy_missing", "fail", "missing --policy <policy.json>", {}));
  }
  if (fixture) scanForPrivateKeys(fixture, "$", diagnostics);
  if (policy) scanForPrivateKeys(policy, "$", diagnostics);

  const packageCheck = runStep(() => checkPackageDir(base, { profile, built: false }), "package policy validation");
  const evidence = runStep(() => createPackageVerificationEvidence(base, { profile }), "static validation");
  const conformance = fixturePath
    ? await runStepAsync(() => createConformanceReplayReport(base, { profile, trace: fixturePath }), "conformance replay")
    : { value: null, error: new Error("missing fixture") };
  const execution = await executePackage(base, metadata, fixture);
  if (execution.error) {
    diagnostics.push(diagnostic("air.e2e_proof.execution_failed", "fail", execution.error.message, {}));
  }

  const outputIntent = execution.value ? buildOutputIntent(base, fixture, execution.value, diagnostics) : null;
  const mismatchDiagnostics = compareExpected(fixture, outputIntent);
  diagnostics.push(...mismatchDiagnostics);

  let hostEvidence = null;
  if (policyPath) {
    const host = runStep(() => createMockHostInteractionEvidence(base, { policy: policyPath, profile, trace: fixturePath }), "host policy simulation");
    if (host.error) {
      diagnostics.push(diagnostic("air.e2e_proof.host_policy_failed", "fail", host.error.message, {}));
    } else {
      hostEvidence = host.value;
    }
  }

  for (const result of [packageCheck, evidence, conformance]) {
    if (result.error) diagnostics.push(diagnostic("air.e2e_proof.step_failed", "fail", result.error.message, { step: result.label }));
  }
  if (packageCheck.value && packageCheck.value.status === "fail") {
    diagnostics.push(diagnostic("air.e2e_proof.package_policy_failed", "fail", "package policy validation failed", {}));
  }
  if (evidence.value && evidence.value.status === "failed") {
    diagnostics.push(diagnostic("air.e2e_proof.static_validation_failed", "fail", "static validation failed", {}));
  }
  if (conformance.value && conformance.value.status === "fail") {
    diagnostics.push(diagnostic("air.e2e_proof.conformance_failed", "fail", "conformance replay failed", {}));
  }

  const failDiagnostics = diagnostics.filter((item) => item.severity === "fail");
  const report = stableObject({
    schemaVersion: E2E_PROOF_SCHEMA_VERSION,
    kind: E2E_PROOF_KIND,
    status: failDiagnostics.length ? "failed" : "passed",
    packageId: packageName,
    packageName,
    packageHash: evidence.value && evidence.value.packageHash ? evidence.value.packageHash : hashStable({ manifest, fixture: fixture && fixture.id }),
    airAbi: AIR_ABI_VERSION,
    requiredHostAbi: metadata.hostAbi || HOST_ABI_VERSION,
    fixtureId: fixture && fixture.id || null,
    staticValidation: stepSummary(evidence.value, evidence.error, "status"),
    packagePolicyValidation: stepSummary(packageCheck.value, packageCheck.error, "status"),
    executionProof: executionSummary(execution.value, execution.error, outputIntent, mismatchDiagnostics),
    outputIntent: sanitizeOutputIntent(outputIntent),
    mockHostPolicy: hostEvidence ? stableObject({
      status: hostEvidence.status,
      policyId: hostEvidence.policyId,
      decisions: hostEvidence.decisions.length
    }) : stableObject({
      status: policyPath ? "failed" : "not_run",
      policyId: null,
      decisions: 0
    }),
    hostDecision: hostDecisionSummary(hostEvidence),
    evidenceReport: stableObject({
      sections: [
        { name: "static validation", status: summaryStatus(evidence.value, evidence.error, "status") },
        { name: "package policy validation", status: summaryStatus(packageCheck.value, packageCheck.error, "status") },
        { name: "conformance replay", status: summaryStatus(conformance.value, conformance.error, "status") },
        { name: "runtime execution proof", status: execution.error || mismatchDiagnostics.length ? "failed" : "passed" },
        { name: "host policy simulation", status: hostEvidence ? hostEvidence.status : "not_run" }
      ]
    }),
    replayChecksum: hashStable({
      fixtureId: fixture && fixture.id || null,
      packageHash: evidence.value && evidence.value.packageHash || null,
      outputIntent: sanitizeOutputIntent(outputIntent),
      hostDecision: hostDecisionSummary(hostEvidence)
    }),
    diagnostics: diagnostics.map(stableDiagnostic).sort(compareDiagnostic),
    limitations
  });
  return report;
}

async function executePackage(base, metadata, fixture) {
  return runStepAsync(async () => {
    if (!fixture) throw new Error("missing fixture");
    const row = firstFixtureRow(fixture);
    validateFacts(row);
    const entryPath = path.join(base, metadata.entry);
    const source = fs.readFileSync(entryPath, "utf8");
    const mod = parseAir(source, metadata.entry);
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), entryPath);
    const loaded = await WebAssembly.instantiate(wasm, {});
    const instance = loaded.instance || loaded;
    const args6 = [
      row.link_status,
      row.latency_ms,
      row.packet_loss_x1000,
      row.gateway_reachable,
      row.dns_reachable,
      row.recent_change_flag
    ];
    const args9 = [
      ...args6,
      row.interface_kind,
      row.confidence_source,
      row.observation_age_ms
    ];
    const diagnosis = callExport(instance, "diagnosis_code", args6);
    const severity = callExport(instance, "severity", args6);
    const recommendedAction = callExport(instance, "recommended_action_id", [diagnosis]);
    const confidence = callExport(instance, "confidence_x1000", args9);
    return stableObject({
      exportedFunctions: OUTPUT_ARG_EXPORTS,
      rowsetCount: Array.isArray(fixture.rowsets) ? fixture.rowsets.length : 0,
      rowCount: 1,
      outputArgs: [diagnosis, severity, recommendedAction, confidence]
    });
  }, "runtime execution proof");
}

function firstFixtureRow(fixture) {
  const rowset = Array.isArray(fixture.rowsets) ? fixture.rowsets[0] : null;
  const row = rowset && Array.isArray(rowset.rows) ? rowset.rows[0] : null;
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("fixture must contain one structured rowset row");
  return row;
}

function validateFacts(row) {
  for (const key of REQUIRED_FACTS) {
    if (!Number.isInteger(row[key])) throw new Error(`fixture fact ${key} must be an i32`);
  }
}

function callExport(instance, name, args) {
  const fn = instance.exports[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  const result = fn(...args);
  if (!Number.isInteger(result)) throw new Error(`export ${name} did not return i32`);
  return result;
}

function buildOutputIntent(base, fixture, execution, diagnostics) {
  const expected = Array.isArray(fixture && fixture.expectedOutputs) ? fixture.expectedOutputs[0] : null;
  const contracts = collectOutputContracts(base);
  const contract = expected ? contracts.byId.get(expected.id) : contracts.list[0] || null;
  if (!contract) {
    diagnostics.push(diagnostic("air.e2e_proof.output_contract_missing", "fail", "expected output contract was not found", {}));
    return null;
  }
  const args = execution.outputArgs;
  return stableObject({
    id: contract.id,
    name: contract.name,
    channel: contract.channel || "policy",
    args,
    flags: 0,
    commandRecord: {
      output_id: contract.id,
      arg0: args[0],
      arg1: args[1],
      arg2: args[2],
      arg3: args[3]
    }
  });
}

function collectOutputContracts(base) {
  const manifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const list = [];
  for (const rel of metadata.outputContracts || []) {
    const file = path.join(base, rel);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const output of parsed.outputs || []) {
      list.push(stableObject({
        id: output.id,
        name: output.name,
        channel: output.channel,
        capability: output.capability,
        argCount: Array.isArray(output.args) ? output.args.length : 0,
        contract: rel
      }));
    }
  }
  list.sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
  return { list, byId: new Map(list.map((item) => [item.id, item])) };
}

function compareExpected(fixture, outputIntent) {
  const diagnostics = [];
  if (!fixture || !outputIntent) return diagnostics;
  const expectedOutput = Array.isArray(fixture.expectedOutputs) ? fixture.expectedOutputs[0] : null;
  if (expectedOutput && !sameJson({
    id: outputIntent.id,
    name: outputIntent.name,
    channel: outputIntent.channel,
    args: outputIntent.args,
    flags: outputIntent.flags
  }, {
    id: expectedOutput.id,
    name: expectedOutput.name,
    channel: expectedOutput.channel,
    args: expectedOutput.args,
    flags: expectedOutput.flags
  })) {
    diagnostics.push(diagnostic("air.e2e_proof.output_mismatch", "fail", "runtime output intent does not match expected output", {
      output_id: outputIntent.id
    }));
  }
  const expectedCommand = Array.isArray(fixture.expectedCommands) ? fixture.expectedCommands[0] : null;
  if (expectedCommand && !sameJson(outputIntent.commandRecord, expectedCommand)) {
    diagnostics.push(diagnostic("air.e2e_proof.command_mismatch", "fail", "runtime output command does not match expected command", {
      output_id: outputIntent.id
    }));
  }
  return diagnostics;
}

function sameJson(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function stepSummary(value, error, statusField) {
  return stableObject({
    status: summaryStatus(value, error, statusField),
    diagnostics: value && Array.isArray(value.diagnostics) ? value.diagnostics.length : 0
  });
}

function summaryStatus(value, error, statusField) {
  if (error) return "failed";
  if (!value) return "not_run";
  const status = value[statusField] || value.status || "passed";
  if (status === "pass") return "passed";
  if (status === "fail") return "failed";
  return String(status || "not_run");
}

function executionSummary(value, error, outputIntent, mismatchDiagnostics) {
  return stableObject({
    status: error || mismatchDiagnostics.length ? "failed" : "passed",
    exportedFunctions: value ? value.exportedFunctions : [],
    rowsetCount: value ? value.rowsetCount : 0,
    rowCount: value ? value.rowCount : 0,
    outputIntentCount: outputIntent ? 1 : 0
  });
}

function sanitizeOutputIntent(outputIntent) {
  if (!outputIntent) return null;
  return stableObject({
    id: outputIntent.id,
    name: outputIntent.name,
    channel: outputIntent.channel,
    argCount: Array.isArray(outputIntent.args) ? outputIntent.args.length : 0,
    commandRecordCount: outputIntent.commandRecord ? 1 : 0
  });
}

function hostDecisionSummary(hostEvidence) {
  if (!hostEvidence || !Array.isArray(hostEvidence.decisions) || !hostEvidence.decisions.length) {
    return stableObject({ decision: "not_run", reasonCode: null, outputId: null });
  }
  const first = hostEvidence.decisions.slice().sort((a, b) => (a.outputId || 0) - (b.outputId || 0))[0];
  return stableObject({
    decision: first.decision || "unknown",
    reasonCode: first.reasonCode || null,
    outputId: first.outputId || null
  });
}

function readJsonFile(file, label) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`failed to read ${label}: ${err.message}`);
  }
}

function scanForPrivateKeys(value, pointer, diagnostics) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForPrivateKeys(item, `${pointer}[${index}]`, diagnostics));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value).sort()) {
    if (PRIVATE_KEY_RE.test(key)) {
      diagnostics.push(diagnostic("air.e2e_proof.private_fact_rejected", "fail", "fixture or policy contains a raw private field", {
        field: key
      }));
    }
    scanForPrivateKeys(value[key], `${pointer}.${key}`, diagnostics);
  }
}

function runStep(fn, label) {
  try {
    return { label, value: fn(), error: null };
  } catch (error) {
    return { label, value: null, error };
  }
}

async function runStepAsync(fn, label) {
  try {
    return { label, value: await fn(), error: null };
  } catch (error) {
    return { label, value: null, error };
  }
}

function diagnostic(code, severity, message, fields) {
  return stableObject({
    code,
    severity,
    source: "e2e-proof",
    message,
    fields: fields || {}
  });
}

function stableDiagnostic(value) {
  return stableObject({
    code: value.code || "air.e2e_proof.unknown",
    severity: value.severity || "info",
    source: value.source || "e2e-proof",
    message: value.message || "",
    fields: value.fields || {}
  });
}

function compareDiagnostic(a, b) {
  return String(a.code).localeCompare(String(b.code)) ||
    String(a.message).localeCompare(String(b.message));
}

function hashStable(value) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function stableStringify(value) {
  return `${JSON.stringify(stableObject(value), null, 2)}\n`;
}

module.exports = {
  E2E_PROOF_KIND,
  E2E_PROOF_SCHEMA_VERSION,
  createE2eProofReport,
  stableStringify
};
