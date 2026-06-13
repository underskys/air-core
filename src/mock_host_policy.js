const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { checkPackageDir } = require("./sdk");
const { normalizePackageMetadata, validatePackageManifest, HOST_ABI_VERSION } = require("./package_manifest");
const { createPackageVerificationEvidence } = require("./verification_evidence");
const { AIR_ABI_VERSION } = require("./version");

const MOCK_HOST_POLICY_SCHEMA_VERSION = "0.25";
const MOCK_HOST_POLICY_KIND = "air.mockHostPolicy";
const HOST_INTERACTION_EVIDENCE_SCHEMA_VERSION = "0.25";
const HOST_INTERACTION_EVIDENCE_KIND = "air.hostInteractionEvidence";
const RAW_AUTHORITY_RE = /\b(?:chrome\.|document\.|window\.|indexedDB|localStorage|sessionStorage|fetch|XMLHttpRequest|React|DOM|AWS|Postgres|Kubernetes|kubectl|docker|jira|secret|token|credential|hostObject|host_handle)\b/i;
const NONDETERMINISTIC_KEY_RE = /timestamp|createdAt|updatedAt|generatedAt|wallClock|random|nonce|uuid/i;
const FORBIDDEN_PAYLOAD_KEY_RE = /^(payload|data|object|objects|map|maps|json|properties|fields|items|raw_text|raw_url|private_text)$/i;
const MOCK_HOST_POLICY_KEYS = new Set(["schemaVersion", "kind", "id", "hostProfile", "allowOutputs", "denyOutputs", "capabilities"]);
const STABLE_POLICY_STRING_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;

function createMockHostInteractionEvidence(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const policyPath = options.policy ? path.resolve(options.policy) : null;
  if (!policyPath) throw new Error("missing --policy <policy.json>");

  const policyRead = readPolicy(policyPath);
  const policy = policyRead.policy || {};
  const manifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const hostProfile = options.profile || policy.hostProfile || metadata.targetProfiles[0] || null;
  const diagnostics = [];
  diagnostics.push(...policyRead.diagnostics);

  const packageReport = safePackageCheck(base, hostProfile);
  if (packageReport.status === "fail" && isUnsupportedProfileReport(packageReport)) {
    diagnostics.push(diagnostic("air.host_policy.unsupported_profile", `host profile ${hostProfile || "<none>"} is unsupported for package ${metadata.name || path.basename(base)}`, "fail", {
      hostProfile,
      package: metadata.name || path.basename(base)
    }));
  }

  const evidence = createPackageVerificationEvidence(base, { profile: hostProfile });
  const outputs = collectOutputs(packageReport.report || packageReport);
  const commands = collectCommandRecords(base, packageReport.report || packageReport, options.trace, diagnostics);
  const decisions = [];
  const deniedCapabilities = new Set();
  const allowSet = new Set(Array.isArray(policy.allowOutputs) ? policy.allowOutputs.map(String) : []);
  const denySet = new Set(Array.isArray(policy.denyOutputs) ? policy.denyOutputs.map(String) : []);
  const capabilityPolicy = normalizeCapabilityPolicy(policy.capabilities);

  validatePolicyShape(policy, diagnostics);
  scanForForbidden(policy, "$", diagnostics, { policy: relativeToCwd(policyPath) });
  scanOutputsForRawAuthority(outputs, diagnostics);

  for (const command of commands) {
    const output = outputs.byId.get(command.output_id);
    const decisionDiagnostics = [];
    if (!output) {
      const item = diagnostic("air.host_policy.unknown_output", `output_id ${command.output_id} is not declared by outputContracts`, "fail", {
        output_id: command.output_id,
        source: command.source,
        index: command.index
      });
      diagnostics.push(item);
      decisionDiagnostics.push(item);
      decisions.push(decisionFor(command, null, "deny", "unknown_output", decisionDiagnostics));
      continue;
    }

    const capabilityDecision = capabilityPolicyDecision(output.capability, capabilityPolicy);
    const explicitlyDenied = outputSelectorMatches(denySet, output);
    const explicitlyAllowed = outputSelectorMatches(allowSet, output);
    let decision = "allow";
    let reasonCode = "allowed";
    if (explicitlyDenied || capabilityDecision === "deny") {
      decision = "deny";
      reasonCode = explicitlyDenied ? "denied_output" : "denied_capability";
    } else if (!explicitlyAllowed) {
      decision = "deny";
      reasonCode = "not_allowed";
    }
    if (decision === "deny") {
      deniedCapabilities.add(output.capability);
      const item = diagnostic("air.host_policy.denied_output", `host policy denied output ${output.name} (${output.id})`, "warn", {
        output_id: output.id,
        output: output.name,
        capability: output.capability,
        reason: reasonCode
      });
      diagnostics.push(item);
      decisionDiagnostics.push(item);
    }
    decisions.push(decisionFor(command, output, decision, reasonCode, decisionDiagnostics));
  }

  const failDiagnostics = diagnostics.filter((item) => item.severity === "fail");
  const report = stableObject({
    schemaVersion: HOST_INTERACTION_EVIDENCE_SCHEMA_VERSION,
    kind: HOST_INTERACTION_EVIDENCE_KIND,
    status: failDiagnostics.length ? "failed" : "passed",
    package: metadata.name || path.basename(base),
    packageHash: evidence.packageHash || hashStable({ package: metadata.name || path.basename(base), outputs: outputs.list, commands }),
    abiHash: evidence.abiHash || hashStable({ airAbi: AIR_ABI_VERSION, hostAbi: metadata.hostAbi || HOST_ABI_VERSION }),
    airAbi: AIR_ABI_VERSION,
    hostAbi: metadata.hostAbi || HOST_ABI_VERSION,
    hostProfile,
    policyId: policy.id || `sha256:${sha256(stableStringify(policy))}`,
    outputContracts: outputs.list.map((output) => stableObject({
      id: output.id,
      name: output.name,
      channel: output.channel,
      capability: output.capability,
      argCount: output.argCount,
      contract: output.contract
    })),
    commandRecords: commands.map(commandEvidence),
    decisions: decisions.sort(compareDecision),
    deniedCapabilities: Array.from(deniedCapabilities).sort(),
    diagnostics: diagnostics.map(stableDiagnostic).sort(compareDiagnostic),
    replayChecksum: null
  });
  report.replayChecksum = hashStable({
    schemaVersion: report.schemaVersion,
    kind: report.kind,
    package: report.package,
    packageHash: report.packageHash,
    abiHash: report.abiHash,
    hostProfile: report.hostProfile,
    policyId: report.policyId,
    commandRecords: report.commandRecords,
    decisions: report.decisions,
    deniedCapabilities: report.deniedCapabilities,
    diagnostics: report.diagnostics
  });
  return stableObject(report);
}

function safePackageCheck(base, profile) {
  const report = checkPackageDir(base, { profile, built: false });
  return { status: report.status || "pass", report };
}

function readPolicy(policyPath) {
  const diagnostics = [];
  let policy = null;
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch (err) {
    diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `failed to read mock host policy: ${err.message}`, "fail", {
      policy: relativeToCwd(policyPath)
    }));
  }
  return { policy, diagnostics };
}

function validatePolicyShape(policy, diagnostics) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", "mock host policy must be a JSON object", "fail"));
    return;
  }
  for (const key of Object.keys(policy).sort()) {
    if (!MOCK_HOST_POLICY_KEYS.has(key)) {
      diagnostics.push(diagnostic("air.host_policy.schema_invalid", `mock host policy field ${key} is not allowed`, "fail", { field: key }));
    }
  }
  if (policy.schemaVersion !== MOCK_HOST_POLICY_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", `mock host policy schemaVersion must be ${MOCK_HOST_POLICY_SCHEMA_VERSION}`, "fail", {
      field: "schemaVersion",
      value: policy.schemaVersion
    }));
  }
  if (policy.kind !== MOCK_HOST_POLICY_KIND) {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", `mock host policy kind must be ${MOCK_HOST_POLICY_KIND}`, "fail", {
      field: "kind",
      value: policy.kind
    }));
  }
  if (policy.id !== undefined) validateStablePolicyString(policy.id, "id", diagnostics);
  if (policy.hostProfile !== undefined) validateStablePolicyString(policy.hostProfile, "hostProfile", diagnostics);
  if (!Array.isArray(policy.allowOutputs)) {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", "mock host policy allowOutputs must be an array", "fail", { field: "allowOutputs" }));
  } else {
    validateStableStringArray(policy.allowOutputs, "allowOutputs", diagnostics);
  }
  if (!Array.isArray(policy.denyOutputs)) {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", "mock host policy denyOutputs must be an array", "fail", { field: "denyOutputs" }));
  } else {
    validateStableStringArray(policy.denyOutputs, "denyOutputs", diagnostics);
  }
  if (policy.capabilities !== undefined && (!policy.capabilities || typeof policy.capabilities !== "object" || Array.isArray(policy.capabilities))) {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", "mock host policy capabilities must be an object when present", "fail", { field: "capabilities" }));
  } else if (policy.capabilities !== undefined) {
    for (const [key, value] of Object.entries(policy.capabilities)) {
      validateStablePolicyString(key, `capabilities.${key}`, diagnostics);
      if (typeof value !== "string") {
        diagnostics.push(diagnostic("air.host_policy.schema_invalid", `mock host policy capabilities.${key} must map to a stable string policy`, "fail", { field: `capabilities.${key}` }));
      } else {
        validateStablePolicyString(value, `capabilities.${key}`, diagnostics);
      }
    }
  }
}

function validateStableStringArray(value, field, diagnostics) {
  value.forEach((item, index) => {
    validateStablePolicyString(item, `${field}[${index}]`, diagnostics);
  });
}

function validateStablePolicyString(value, field, diagnostics) {
  if (typeof value !== "string" || value.trim() === "") {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", `mock host policy ${field} must be a stable string`, "fail", { field }));
    return false;
  }
  if (!STABLE_POLICY_STRING_RE.test(value)) {
    diagnostics.push(diagnostic("air.host_policy.schema_invalid", `mock host policy ${field} must be a stable string`, "fail", { field, value }));
    return false;
  }
  return true;
}

function collectOutputs(packageReport) {
  const list = [];
  for (const schema of (((packageReport.outputContracts || {}).schemas) || [])) {
    for (const output of schema.outputs || []) {
      list.push(stableObject({
        id: output.id,
        name: output.name,
        channel: output.channel,
        capability: output.capability,
        argCount: output.argCount || 0,
        contract: schema.path
      }));
    }
  }
  list.sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
  return {
    list,
    byId: new Map(list.map((output) => [output.id, output]))
  };
}

function collectCommandRecords(base, packageReport, tracePath, diagnostics) {
  if (tracePath) return collectTraceCommandRecords(base, tracePath, diagnostics);
  const out = [];
  for (const schema of (((packageReport.commandBuffers || {}).schemas) || [])) {
    for (const record of schema.records || []) {
      out.push(normalizeCommandRecord(record, {
        source: schema.path,
        index: record.index,
        diagnostics
      }));
    }
  }
  return out.filter(Boolean).sort(compareCommandRecord);
}

function collectTraceCommandRecords(base, tracePath, diagnostics) {
  const absolute = path.resolve(tracePath);
  let trace = null;
  try {
    trace = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (err) {
    diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `failed to read trace command records: ${err.message}`, "fail", {
      trace: sanitizePath(absolute, base)
    }));
    return [];
  }
  scanForForbidden(trace, "$", diagnostics, { trace: sanitizePath(absolute, base), allowStableMetadataStrings: true });
  const commandRecords = Array.isArray(trace.observedCommands) ? trace.observedCommands : [];
  const outputEmitRecords = Array.isArray(trace.observedOutputEmits) ? trace.observedOutputEmits : [];
  const records = commandRecords.concat(outputEmitRecords);
  return records.map((record, index) => normalizeCommandRecord(record, {
    source: outputEmitRecords.length && index >= commandRecords.length
      ? `${sanitizePath(absolute, base)}#observedOutputEmits`
      : sanitizePath(absolute, base),
    kind: outputEmitRecords.length && index >= commandRecords.length ? "output.emit" : "commandBuffer",
    index,
    diagnostics
  })).filter(Boolean).sort(compareCommandRecord);
}

function normalizeCommandRecord(record, context) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    context.diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `command record ${context.index} must be an object`, "fail", {
      source: context.source,
      index: context.index
    }));
    return null;
  }
  for (const key of Object.keys(record).sort()) {
    if (!["index", "output_id", "arg0", "arg1", "arg2", "arg3"].includes(key)) {
      context.diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `command record ${context.index}.${key} is not allowed; mock host accepts scalar command intents only`, "fail", {
        source: context.source,
        index: context.index,
        field: key
      }));
    }
  }
  const out = {
    kind: context.kind || "commandBuffer",
    source: context.source,
    index: Number.isInteger(record.index) ? record.index : context.index,
    output_id: readI32(record.output_id, "output_id", context),
    arg0: readI32(record.arg0, "arg0", context),
    arg1: readI32(record.arg1, "arg1", context),
    arg2: readI32(record.arg2, "arg2", context),
    arg3: readI32(record.arg3, "arg3", context)
  };
  if ([out.output_id, out.arg0, out.arg1, out.arg2, out.arg3].some((value) => value === null)) return null;
  return out;
}

function readI32(recordValue, field, context) {
  if (!Number.isInteger(recordValue) || recordValue < -2147483648 || recordValue > 2147483647) {
    context.diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `command record ${context.index}.${field} must be an i32 integer`, "fail", {
      source: context.source,
      index: context.index,
      field
    }));
    return null;
  }
  return recordValue;
}

function decisionFor(command, output, decision, reasonCode, diagnostics) {
  const args = { arg0: command.arg0, arg1: command.arg1, arg2: command.arg2, arg3: command.arg3 };
  const item = {
    index: command.index,
    source: command.source,
    output_id: command.output_id,
    output: output ? output.name : null,
    capability: output ? output.capability : null,
    decision,
    reasonCode,
    argsHash: hashStable(args),
    diagnostics: diagnostics.map(stableDiagnostic).sort(compareDiagnostic)
  };
  if (command.kind === "output.emit") item.statusCode = outputEmitStatusCode(reasonCode, decision);
  return stableObject(item);
}

function commandEvidence(command) {
  const args = { arg0: command.arg0, arg1: command.arg1, arg2: command.arg2, arg3: command.arg3 };
  const item = {
    source: command.source,
    index: command.index,
    output_id: command.output_id,
    args,
    argsHash: hashStable(args)
  };
  if (command.kind === "output.emit") {
    item.kind = "output.emit";
  }
  return stableObject(item);
}

function outputEmitStatusCode(reasonCode, decision) {
  if (reasonCode === "unknown_output") return 3;
  if (decision === "deny") return 1;
  return 0;
}

function normalizeCapabilityPolicy(capabilities) {
  const out = new Map();
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return out;
  for (const key of Object.keys(capabilities).sort()) {
    const value = String(capabilities[key] || "").toLowerCase();
    if (["forbidden", "deny", "denied"].includes(value)) out.set(key, "deny");
    else out.set(key, "allow");
  }
  return out;
}

function capabilityPolicyDecision(capability, policy) {
  for (const [key, value] of policy.entries()) {
    if (capability === key || String(capability).startsWith(`${key}.`)) return value;
  }
  return "allow";
}

function outputSelectorMatches(selectors, output) {
  return selectors.has(String(output.id)) || selectors.has(String(output.name));
}

function scanOutputsForRawAuthority(outputs, diagnostics) {
  for (const output of outputs.list || []) {
    for (const field of ["name", "channel", "capability"]) {
      const value = output[field];
      if (typeof value === "string" && RAW_AUTHORITY_RE.test(value)) {
        diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `output ${output.name} ${field} requests raw host authority`, "fail", {
          output_id: output.id,
          output: output.name,
          field,
          value
        }));
      }
    }
  }
}

function scanForForbidden(value, label, diagnostics, context = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForForbidden(item, `${label}[${index}]`, diagnostics, context));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (looksAbsolutePath(value)) {
        diagnostics.push(diagnostic("air.host_policy.nondeterministic_field", `${label} must not contain absolute paths`, "fail", { ...context, field: label }));
      }
      if (RAW_AUTHORITY_RE.test(value)) {
        diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `${label} requests raw host authority`, "fail", { ...context, field: label }));
      }
    }
    return;
  }
  for (const key of Object.keys(value).sort()) {
    const field = `${label}.${key}`;
    if (NONDETERMINISTIC_KEY_RE.test(key)) {
      diagnostics.push(diagnostic("air.host_policy.nondeterministic_field", `${field} must not encode timestamps or nondeterministic values`, "fail", { ...context, field }));
    }
    if (FORBIDDEN_PAYLOAD_KEY_RE.test(key)) {
      diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `${field} is not allowed in mock host policy or command records`, "fail", { ...context, field }));
    }
    if (RAW_AUTHORITY_RE.test(key)) {
      diagnostics.push(diagnostic("air.host_policy.raw_authority_rejected", `${field} requests raw host authority`, "fail", { ...context, field }));
    }
    scanForForbidden(value[key], field, diagnostics, context);
  }
}

function isUnsupportedProfileReport(packageCheck) {
  const checks = ((packageCheck.report || packageCheck).checks || []);
  return checks.some((check) =>
    check.id === "target-profile-declared" ||
    check.id === "host-profile" ||
    check.id === "host-abi" ||
    check.id.startsWith("capability:") ||
    check.id.startsWith("host-import:") ||
    (check.code === "air.output_emit.profile_unsupported"));
}

function diagnostic(code, message, severity = "fail", fields = {}) {
  return stableObject({
    code,
    severity,
    source: "mock-host",
    message,
    fields: stableObject(fields)
  });
}

function stableDiagnostic(item) {
  return stableObject({
    code: item.code,
    severity: item.severity || "fail",
    source: item.source || "mock-host",
    message: item.message,
    fields: stableObject(item.fields || {})
  });
}

function compareDiagnostic(a, b) {
  return String(a.severity).localeCompare(String(b.severity)) ||
    String(a.code).localeCompare(String(b.code)) ||
    String(a.message).localeCompare(String(b.message));
}

function compareDecision(a, b) {
  return String(a.source).localeCompare(String(b.source)) ||
    a.index - b.index ||
    a.output_id - b.output_id;
}

function compareCommandRecord(a, b) {
  return String(a.source).localeCompare(String(b.source)) ||
    a.index - b.index ||
    a.output_id - b.output_id;
}

function sanitizePath(value, base) {
  const normalizedBase = normalizeSlash(path.resolve(base));
  const normalized = normalizeSlash(path.resolve(value));
  if (normalized === normalizedBase) return ".";
  if (normalized.startsWith(`${normalizedBase}/`)) return normalized.slice(normalizedBase.length + 1);
  return relativeToCwd(value);
}

function relativeToCwd(value) {
  const relative = normalizeSlash(path.relative(process.cwd(), path.resolve(value)));
  return relative && !relative.startsWith("..") ? relative : normalizeSlash(path.resolve(value));
}

function looksAbsolutePath(value) {
  return typeof value === "string" && (/^\/[^/]/.test(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://"));
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function hashStable(value) {
  return `sha256:${sha256(stableStringify(value))}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
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

module.exports = {
  HOST_INTERACTION_EVIDENCE_KIND,
  HOST_INTERACTION_EVIDENCE_SCHEMA_VERSION,
  MOCK_HOST_POLICY_KIND,
  MOCK_HOST_POLICY_SCHEMA_VERSION,
  createMockHostInteractionEvidence,
  stableStringify
};
