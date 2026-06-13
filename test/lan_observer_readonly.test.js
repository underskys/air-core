#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const pkg = path.join(root, "examples", "lan_observer_readonly_package");
const unsafePkg = path.join(root, "test", "fixtures", "lan_observer_readonly", "unsafe_raw_authority");
const tmp = path.join(root, "build", "lan-observer-readonly-tests");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

function run(args, options = {}) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function runJson(args, options = {}) {
  return JSON.parse(run(args.concat("--json"), options));
}

function runStatus(args) {
  return cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

function walk(value, fn) {
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, fn);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) walk(value[key], fn);
  }
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  walk(value, (item) => {
    if (typeof item === "string" && (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item))) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function assertNoPrivatePayloads(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const forbidden = [
    "raw_url",
    "private_text",
    "token",
    "secret",
    "credential",
    "packet payload",
    "hostname",
    "MAC address",
    "IP address"
  ];
  for (const marker of forbidden) {
    assert(!text.includes(marker), `must not expose ${marker}`);
  }
}

function diagnosticCodes(report) {
  return new Set((report.diagnostics || []).map((item) => item.code));
}

function sortedDiagnosticCodes(report) {
  return Array.from(diagnosticCodes(report)).sort();
}

function structuredSummary(data) {
  return {
    schemas: data.structuredIO.schemas.map((schema) => ({
      name: schema.name,
      kind: schema.kind,
      maxRows: schema.maxRows ?? null,
      fieldCount: schema.fieldCount,
      fields: schema.fields.map((field) => ({
        name: field.name,
        type: field.type,
        privacy: field.privacy,
        semantic: field.semantic
      }))
    })),
    handleSets: data.structuredIO.handleSets.map((set) => ({
      path: set.path,
      metadataPath: set.metadataPath,
      status: set.status,
      handleCount: set.handles.length
    }))
  };
}

function packageCheckSummary(data) {
  return {
    package: data.package,
    profile: data.profile,
    mode: data.mode,
    airAbi: data.airAbi,
    hostAbi: data.hostAbi,
    status: data.status,
    structuredIO: structuredSummary(data),
    outputContracts: data.outputContracts.schemas.map((contract) => ({
      path: contract.path,
      ok: contract.ok,
      outputsCount: contract.outputsCount,
      outputIds: contract.outputs.map((output) => output.id)
    })),
    commandBuffers: data.commandBuffers.schemas.map((buffer) => ({
      path: buffer.path,
      ok: buffer.ok,
      maxCommands: buffer.maxCommands,
      recordCount: buffer.recordCount,
      usedOutputIds: buffer.usedOutputIds
    }))
  };
}

function packageReportSummary(data) {
  return {
    package: data.package,
    status: data.status,
    linkedWasm: data.linkedWasm,
    structuredIO: structuredSummary(data),
    outputContracts: data.outputContracts.schemas.map((contract) => ({
      path: contract.path,
      ok: contract.ok,
      outputsCount: contract.outputsCount,
      outputIds: contract.outputs.map((output) => output.id)
    })),
    commandBuffers: data.commandBuffers.schemas.map((buffer) => ({
      path: buffer.path,
      ok: buffer.ok,
      maxCommands: buffer.maxCommands,
      recordCount: buffer.recordCount,
      usedOutputIds: buffer.usedOutputIds
    }))
  };
}

function packageDiffSummary(data) {
  return {
    kind: data.kind,
    status: data.status,
    airAbiDelta: data.airAbiDelta,
    hostAbiDelta: data.hostAbiDelta,
    capabilityDelta: data.capabilityDelta,
    effectChanged: data.effectDelta.changed,
    outputContractDelta: {
      changed: data.outputContractDelta.changed,
      changedItems: data.outputContractDelta.changedItems.map((item) => ({
        oldOutputIds: (item.old.outputs || []).map((output) => output.id),
        newOutputIds: (item.new.outputs || []).map((output) => output.id)
      }))
    },
    structuredIODelta: {
      changed: data.structuredIODelta.changed,
      changedItems: data.structuredIODelta.changedItems
    },
    generatedArtifactDelta: {
      changed: data.generatedArtifactDelta.changed,
      added: data.generatedArtifactDelta.added,
      removed: data.generatedArtifactDelta.removed,
      changedItems: data.generatedArtifactDelta.changedItems.map((item) => ({
        path: item.path,
        oldStatus: item.old.status,
        newStatus: item.new.status
      }))
    }
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(pkg, relativePath), "utf8"));
}

const packageCheck = runJson(["package-check", pkg, "--profile", "cli", "--source-only"]);
assert.strictEqual(packageCheck.status, "pass");
assert.strictEqual(packageCheck.airAbi, "0.10");
assert.strictEqual(packageCheck.hostAbi, "0.10");
assert.strictEqual(packageCheck.structuredIO.schemas.length, 2);
assert(packageCheck.structuredIO.schemas.some((schema) => schema.name === "device_observation" && schema.maxRows === 8));
assert(packageCheck.structuredIO.schemas.some((schema) => schema.name === "diagnosis_summary"));
assert.strictEqual(packageCheck.structuredIO.handleSets[0].status, "fresh");
assert.deepStrictEqual(
  packageCheckSummary(packageCheck),
  readJson("expected/package_check.summary.json")
);
assertNoAbsolutePaths(packageCheck);

const evidence = runJson(["verify", "package", pkg, "--profile", "cli"]);
assert.strictEqual(evidence.status, "passed");
assert.strictEqual(evidence.airAbi, "0.10");
assert.strictEqual(evidence.hostAbi, "0.10");
assert.strictEqual(evidence.structuredIO.schemas.length, 2);
assert.strictEqual(evidence.structuredIO.handleSets[0].status, "fresh");
assertNoAbsolutePaths(evidence);

const report = runJson(["report", "package", pkg]);
assert.strictEqual(report.structuredIO.schemas.length, 2);
assert.strictEqual(report.structuredIO.handleSets[0].status, "fresh");
assert.deepStrictEqual(
  packageReportSummary(report),
  readJson("expected/package_report.summary.json")
);
assertNoAbsolutePaths(report);

const trace = path.join(pkg, "traces", "pass.json");
const conformance = runJson(["conformance", pkg, "--profile", "cli", "--trace", trace]);
assert.strictEqual(conformance.status, "pass");
assert.strictEqual(conformance.package, "lan-observer-readonly-canonical-example");
assert.strictEqual(conformance.rowsets[0].source, "structuredIO");
assert.strictEqual(conformance.outputs.observed[0].id, 3501);
assert.strictEqual(conformance.commands.observed[0].arg0, 303);
assert.strictEqual(conformance.commands.observed[0].arg1, 3);
assert.strictEqual(conformance.commands.observed[0].arg2, 712);
assert.strictEqual(conformance.commands.observed[0].arg3, 480);
assert.deepStrictEqual(conformance.mismatches, []);
assertNoAbsolutePaths(conformance);

const hostEvidencePath = path.join(tmp, "host-evidence.json");
run([
  "mock-host", pkg,
  "--policy", path.join(pkg, "host_policies", "lan_observer_readonly.policy.json"),
  "--profile", "cli",
  "--trace", trace,
  "--json"
], { stdio: ["ignore", fs.openSync(hostEvidencePath, "w"), "pipe"] });
const hostEvidence = JSON.parse(fs.readFileSync(hostEvidencePath, "utf8"));
assert.strictEqual(hostEvidence.status, "passed");
assert.strictEqual(hostEvidence.decisions[0].decision, "allow");
assertNoAbsolutePaths(hostEvidence);

const conformancePath = path.join(tmp, "conformance.json");
fs.writeFileSync(conformancePath, `${JSON.stringify(conformance, null, 2)}\n`);
const evidenceReportPath = path.join(tmp, "evidence.md");
run([
  "evidence", "report", pkg,
  "--format", "markdown",
  "--host-evidence", hostEvidencePath,
  "--conformance", conformancePath,
  "-o", evidenceReportPath
]);
const evidenceMarkdown = fs.readFileSync(evidenceReportPath, "utf8");
assert(evidenceMarkdown.includes("| Package | lan-observer-readonly-canonical-example |"));
assert(evidenceMarkdown.includes("| Verification status | passed |"));
assert(evidenceMarkdown.includes("| Required Host ABI | 0.10 |"));
assert(evidenceMarkdown.includes("## Structured IO"));
assert(evidenceMarkdown.includes("| schema device_observation | air.structuredRowsetSchema; fields=10; maxRows=8; status=passed |"));
assert(evidenceMarkdown.includes("| schema diagnosis_summary | air.structuredOutputSummarySchema; fields=5; maxRows=n/a; status=passed |"));
assert(evidenceMarkdown.includes("| Fixture | lan-observer-readonly-pass |"));
assert(evidenceMarkdown.includes("| Host interaction evidence | passed |"));
assert(!evidenceMarkdown.includes(root));
assertNoPrivatePayloads(evidenceMarkdown);

const expectedEvidencePath = path.join(pkg, "expected", "evidence_report.md");
assert.strictEqual(evidenceMarkdown.trimEnd(), fs.readFileSync(expectedEvidencePath, "utf8").trimEnd());
assert(evidenceMarkdown.includes("Privacy Boundary"));
assert(evidenceMarkdown.includes("omits sensitive payload classes"));

const oldDir = path.join(tmp, "old");
const newDir = path.join(tmp, "new");
fs.cpSync(pkg, oldDir, { recursive: true });
fs.cpSync(pkg, newDir, { recursive: true });
const changedContract = JSON.parse(fs.readFileSync(path.join(newDir, "outputs", "lan_observer_diagnosis.output.json"), "utf8"));
changedContract.outputs[0].id = 3502;
fs.writeFileSync(path.join(newDir, "outputs", "lan_observer_diagnosis.output.json"), `${JSON.stringify(changedContract, null, 2)}\n`);
const changedCommands = JSON.parse(fs.readFileSync(path.join(newDir, "outputs", "lan_observer_diagnosis.commands.json"), "utf8"));
changedCommands.records[0].output_id = 3502;
fs.writeFileSync(path.join(newDir, "outputs", "lan_observer_diagnosis.commands.json"), `${JSON.stringify(changedCommands, null, 2)}\n`);
const diff = runJson(["diff", "package", oldDir, newDir]);
assert.strictEqual(diff.status, "changed");
assert.strictEqual(diff.outputContractDelta.changed, true);
assert.strictEqual(diff.outputContractDelta.changedItems[0].old.outputs[0].id, 3501);
assert.strictEqual(diff.outputContractDelta.changedItems[0].new.outputs[0].id, 3502);
assert.deepStrictEqual(
  packageDiffSummary(diff),
  readJson("expected/package_diff_output_contract.summary.json")
);
assertNoAbsolutePaths(diff);

const rawAuthorityPolicy = path.join(tmp, "raw-authority.policy.json");
fs.writeFileSync(rawAuthorityPolicy, `${JSON.stringify({
  schemaVersion: "0.25",
  kind: "air.mockHostPolicy",
  id: "lan-observer-raw-authority-rejected",
  allowOutputs: ["lan_observer_diagnosis_recorded"],
  denyOutputs: [],
  capabilities: {
    "host.fetch": "allowed"
  }
}, null, 2)}\n`);
const rawAuthority = runStatus([
  "mock-host", pkg,
  "--policy", rawAuthorityPolicy,
  "--profile", "cli",
  "--trace", trace,
  "--json"
]);
assert.notStrictEqual(rawAuthority.status, 0);
const rawAuthorityReport = JSON.parse(rawAuthority.stdout);
assert(diagnosticCodes(rawAuthorityReport).has("air.host_policy.raw_authority_rejected"));

const expectedUnsafeDiagnostics = JSON.parse(fs.readFileSync(path.join(unsafePkg, "expected_diagnostics.json"), "utf8"));
const unsafePackageCheck = runStatus(["package-check", unsafePkg, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(unsafePackageCheck.status, 0);
const unsafePackageCheckReport = JSON.parse(unsafePackageCheck.stdout);
assert.strictEqual(unsafePackageCheckReport.status, "fail");
assert.deepStrictEqual(sortedDiagnosticCodes(unsafePackageCheckReport), expectedUnsafeDiagnostics.packageCheck);
assert.strictEqual(unsafePackageCheckReport.hostAbi, "0.10");
assert(unsafePackageCheckReport.profileSupport.hostImports.unsupported.includes("host.fetch"));
assert(unsafePackageCheckReport.profileSupport.hostImports.unsupported.includes("device.mutate"));

const unsafeEvidence = runStatus(["verify", "package", unsafePkg, "--profile", "cli", "--json"]);
assert.notStrictEqual(unsafeEvidence.status, 0);
const unsafeEvidenceReport = JSON.parse(unsafeEvidence.stdout);
assert.strictEqual(unsafeEvidenceReport.status, "failed");
assert.deepStrictEqual(sortedDiagnosticCodes(unsafeEvidenceReport), expectedUnsafeDiagnostics.verificationEvidence);
assert.strictEqual(unsafeEvidenceReport.airAbi, "0.10");
assert.strictEqual(unsafeEvidenceReport.hostAbi, "0.10");
assert(unsafeEvidenceReport.capabilitySummary.hostImports.unsupported.includes("host.fetch"));
assert(unsafeEvidenceReport.capabilitySummary.hostImports.unsupported.includes("device.mutate"));

console.log("lan observer read-only proof tests passed");
