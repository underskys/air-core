#!/usr/bin/env node
"use strict";

const assert = require("assert");
const cp = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  SemanticPatchError,
  applySemanticPatch,
  createSemanticPatch,
  inspectSemanticPatch,
  stableStringify,
  validatePatch
} = require("../src/semantic_patch");
const { createPackageVerificationEvidence } = require("../src/verification_evidence");
const { createEvidenceMarkdownReport } = require("../src/evidence_report");

const root = path.resolve(__dirname, "..");
const tmp = path.join(root, "build", "semantic-patch-tests");
const airc = path.join(root, "bin", "airc.js");
const DOMAIN = "AIR_SEMANTIC_PATCH_V1\0";

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const baseSource = `module semantic_case
capabilities { }
effects { cpu.instructions <= 32 }
requires export run

func helper(value: i32<0..10>) -> i32<0..10> {
  requires param value >= 0
  ensures return >= 0
entry:
  return %value
}

export func run(value: i32<0..10>) -> i32<0..10> {
  requires param value >= 0
  ensures return >= 0
entry:
  %out:i32<0..10> = call @helper(%value)
  return %out
}
`;

function manifest(name = "semantic-case", extra = {}) {
  return {
    name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "module.air",
    capabilities: [],
    targetProfiles: ["cli"],
    generatedModules: [],
    factSchemas: [],
    structuredIO: [],
    outputContracts: [],
    commandBuffers: [],
    ...extra
  };
}

function writePackage(id, source = baseSource, manifestValue = manifest(), files = {}) {
  const dir = path.join(tmp, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.air"), source);
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify(manifestValue, null, 2)}\n`);
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  }
  return dir;
}

function patch(base, result, options = {}) {
  return createSemanticPatch(base, result, {
    authoritySource: "human_user_direct",
    actor: "codex.impl.air-language.m5",
    humanForced: true,
    humanReasonCode: "AIRLANG-V049-P0-HUMAN-FORCED-2026-07-25-0001",
    ...options
  });
}

function classify(base, result) {
  return patch(base, result).analysis.classification;
}

function expansionKinds(value) {
  return new Set((value.analysis.expansions || []).map((item) => item.classification));
}

function expectError(fn, code) {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert(error, `expected ${code}`);
  assert(error instanceof SemanticPatchError, String(error));
  assert.strictEqual(error.code, code);
  return error;
}

function hashStable(value, domain = "") {
  return `sha256:${crypto.createHash("sha256").update(domain).update(stableStringify(value)).digest("hex")}`;
}

function resignPatch(value) {
  const copy = JSON.parse(JSON.stringify(value));
  const without = { ...copy };
  delete without.patchDigest;
  copy.patchDigest = hashStable(without, DOMAIN);
  return copy;
}

function runCli(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: path.join(root, "node_modules") }
  });
}

function runCliStatus(args) {
  return cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: path.join(root, "node_modules") }
  });
}

const base = writePackage("base");
const compatible = writePackage("compatible", baseSource.replace("  return %value", "  return 0"));
const compatiblePatch = patch(base, compatible);

assert.strictEqual(compatiblePatch.analysis.classification, "compatible_change");
assert.strictEqual(stableStringify(compatiblePatch), stableStringify(patch(base, compatible)));
assert.strictEqual(validatePatch(compatiblePatch).ok, true);
assert.strictEqual(inspectSemanticPatch(compatiblePatch, { strict: true }).status, "accepted");
assert.match(compatiblePatch.patchDigest, /^sha256:[a-f0-9]{64}$/);
assert.deepStrictEqual(compatiblePatch.operations.map((item) => item.target.path), ["module.air"]);

const applied = path.join(tmp, "applied");
const applyResult = applySemanticPatch(base, compatiblePatch, applied, { strict: true });
assert.strictEqual(applyResult.status, "applied");
assert.strictEqual(applyResult.outputPackageDigest, compatiblePatch.expectedResult.packageDigest);
assert.strictEqual(stableStringify(applyResult), stableStringify(
  applySemanticPatch(base, compatiblePatch, path.join(tmp, "applied-repeat"), { strict: true })
));

const otherBase = writePackage("other-base", baseSource, manifest("other-package"));
expectError(
  () => applySemanticPatch(otherBase, compatiblePatch, path.join(tmp, "wrong-base"), { strict: true }),
  "air.semantic_patch.base_digest_mismatch"
);

const wrongExpected = JSON.parse(JSON.stringify(compatiblePatch));
wrongExpected.expectedResult.packageDigest = `sha256:${"1".repeat(64)}`;
expectError(
  () => applySemanticPatch(base, resignPatch(wrongExpected), path.join(tmp, "wrong-result"), { strict: true }),
  "air.semantic_patch.result_digest_mismatch"
);

const substitutedDigest = JSON.parse(JSON.stringify(compatiblePatch));
substitutedDigest.patchDigest = `sha256:${"2".repeat(64)}`;
assert.strictEqual(validatePatch(substitutedDigest).ok, false);
expectError(
  () => applySemanticPatch(base, substitutedDigest, path.join(tmp, "substituted-digest"), { strict: true }),
  "air.semantic_patch.invalid"
);

const twoChanges = writePackage(
  "two-changes",
  baseSource.replace("  return %value", "  return 0"),
  manifest("semantic-case", { version: "0.1.1" })
);
const twoOperationPatch = patch(base, twoChanges);
assert.strictEqual(twoOperationPatch.operations.length, 2);
const reordered = JSON.parse(JSON.stringify(twoOperationPatch));
reordered.operations.reverse();
assert(validatePatch(resignPatch(reordered)).diagnostics.includes("operations are not in canonical order"));

const duplicate = JSON.parse(JSON.stringify(twoOperationPatch));
duplicate.operations.push(JSON.parse(JSON.stringify(duplicate.operations[0])));
duplicate.operations.sort((a, b) =>
  `${a.target.kind}:${a.target.path}:${a.op}`.localeCompare(`${b.target.kind}:${b.target.path}:${b.op}`));
assert(validatePatch(resignPatch(duplicate)).diagnostics.includes("duplicate operation target"));

const capSource = baseSource.replace("capabilities { }", "capabilities { debug }");
const capabilityAdded = writePackage("capability-added", capSource, manifest("semantic-case", { capabilities: ["debug"] }));
const capabilityPatch = patch(base, capabilityAdded);
assert.strictEqual(capabilityPatch.analysis.classification, "capability_expansion");
assert(expansionKinds(capabilityPatch).has("capability_expansion"));
assert.strictEqual(inspectSemanticPatch(capabilityPatch, { strict: true }).status, "rejected");

const effectSource = `module semantic_case
capabilities { debug }
effects { debug.metric <= 1 }
requires export run
extern debug.metric(id: i32, value: i32) -> void
export func run(value: i32<0..10>) -> i32<0..10> {
entry:
  call @debug.metric(1, %value)
  return %value
}
`;
const effectAdded = writePackage("effect-added", effectSource, manifest("semantic-case", { capabilities: ["debug"] }));
const effectPatch = patch(base, effectAdded);
assert(expansionKinds(effectPatch).has("effect_expansion"));
assert(expansionKinds(effectPatch).has("capability_expansion"));
assert.strictEqual(effectPatch.analysis.classification, "mixed_expansion");

const effectBudgetRaised = writePackage("effect-budget-raised", baseSource.replace("cpu.instructions <= 32", "cpu.instructions <= 64"));
const resourcePatch = patch(base, effectBudgetRaised);
assert(expansionKinds(resourcePatch).has("resource_expansion"));

const resourceLoop = writePackage("resource-loop", baseSource.replace(
  "%out:i32<0..10> = call @helper(%value)",
  "%zero:i32 = const.i32 0\n  %out:i32 = loop.fold.i32 @helper, %zero, 8"
));
const resourceLoopPatch = patch(base, resourceLoop);
assert(expansionKinds(resourceLoopPatch).has("resource_expansion"));

const unknownMemorySource = `module semantic_case
capabilities { }
effects { memory.alloc <= 1, memory.free <= 1, memory.dynamic_allocations <= 1 }
export func run(bytes: i32) -> i32 {
entry:
  %ptr:ptr = alloc_region %bytes
  free_region %ptr
  return %bytes
}
`;
const unknownMemoryBase = writePackage("unknown-memory-base", unknownMemorySource, manifest("unknown-memory", {
  resourceCertificate: { mode: "required", requiredBounds: ["memory"] }
}));
const unknownMemoryResult = writePackage("unknown-memory-result", unknownMemorySource.replace("return %bytes", "%same:i32 = i32.add %bytes, 0\n  return %same"), manifest("unknown-memory", {
  resourceCertificate: { mode: "required", requiredBounds: ["memory"] }
}));
const unknownResourcePatch = patch(unknownMemoryBase, unknownMemoryResult);
assert.strictEqual(unknownResourcePatch.analysis.classification, "unknown_unproven");
assert.strictEqual(inspectSemanticPatch(unknownResourcePatch, { strict: true }).status, "rejected");

const exportAddedSource = baseSource.replace(
  "export func run",
  "export func extra() -> i32 {\nentry:\n  return 1\n}\n\nexport func run"
);
const exportAdded = writePackage("export-added", exportAddedSource);
const exportPatch = patch(base, exportAdded);
assert(expansionKinds(exportPatch).has("export_expansion"));

const importAddedSource = baseSource
  .replace("capabilities { }", "capabilities { debug }")
  .replace("requires export run", "requires export run\nextern debug.metric(id: i32, value: i32) -> void");
const importAdded = writePackage("import-added", importAddedSource, manifest("semantic-case", { capabilities: ["debug"] }));
const importPatch = patch(base, importAdded);
assert(expansionKinds(importPatch).has("capability_expansion"));
assert(importPatch.analysis.expansions.some((item) => item.category === "external_import"));

const requiresRemoved = writePackage("requires-removed", baseSource.replace("  requires param value >= 0\n", ""));
const requiresPatch = patch(base, requiresRemoved);
assert(expansionKinds(requiresPatch).has("contract_weakening"));

const moduleRequiresRemoved = writePackage("module-requires-removed", baseSource.replace("requires export run\n", ""));
const moduleRequiresPatch = patch(base, moduleRequiresRemoved);
assert.strictEqual(moduleRequiresPatch.analysis.classification, "contract_weakening");
assert(moduleRequiresPatch.analysis.expansions.some((item) =>
  item.category === "requires_removed" &&
  item.identity.startsWith("module:module.air:")));
assert.strictEqual(inspectSemanticPatch(moduleRequiresPatch, { strict: true }).status, "rejected");

const moduleEnsuresSource = baseSource.replace("requires export run", "requires export run\nensures export run");
const moduleEnsuresBase = writePackage("module-ensures-base", moduleEnsuresSource);
const moduleEnsuresRemoved = writePackage("module-ensures-removed", baseSource);
const moduleEnsuresPatch = patch(moduleEnsuresBase, moduleEnsuresRemoved);
assert.strictEqual(moduleEnsuresPatch.analysis.classification, "contract_weakening");
assert(moduleEnsuresPatch.analysis.expansions.some((item) =>
  item.category === "ensures_removed" &&
  item.identity.startsWith("module:module.air:")));
assert.strictEqual(inspectSemanticPatch(moduleEnsuresPatch, { strict: true }).status, "rejected");

const moduleMetricBase = writePackage(
  "module-metric-base",
  baseSource.replace("requires export run", "requires export run\nrequires cpu.instructions <= 32")
);
const moduleMetricWeakened = writePackage(
  "module-metric-weakened",
  baseSource.replace("requires export run", "requires export run\nrequires cpu.instructions <= 64")
);
const moduleMetricPatch = patch(moduleMetricBase, moduleMetricWeakened);
assert.strictEqual(moduleMetricPatch.analysis.classification, "contract_weakening");
assert(moduleMetricPatch.analysis.expansions.some((item) =>
  item.category === "requires_weakened" &&
  item.identity.includes("module:module.air:metric:cpu.instructions:<=")));
assert.strictEqual(inspectSemanticPatch(moduleMetricPatch, { strict: true }).status, "rejected");

const moduleEnsuresMetricBase = writePackage(
  "module-ensures-metric-base",
  baseSource.replace("requires export run", "requires export run\nensures cpu.instructions <= 32")
);
const moduleEnsuresMetricWeakened = writePackage(
  "module-ensures-metric-weakened",
  baseSource.replace("requires export run", "requires export run\nensures cpu.instructions <= 64")
);
const moduleEnsuresMetricPatch = patch(moduleEnsuresMetricBase, moduleEnsuresMetricWeakened);
assert.strictEqual(moduleEnsuresMetricPatch.analysis.classification, "contract_weakening");
assert(moduleEnsuresMetricPatch.analysis.expansions.some((item) =>
  item.category === "ensures_weakened" &&
  item.identity.includes("module:module.air:metric:cpu.instructions:<=")));
assert.strictEqual(inspectSemanticPatch(moduleEnsuresMetricPatch, { strict: true }).status, "rejected");

const mixedContractWeakened = writePackage(
  "mixed-contract-weakened",
  baseSource
    .replace("requires export run\n", "")
    .replace("  requires param value >= 0\n", "")
);
const mixedContractPatch = patch(base, mixedContractWeakened);
assert.strictEqual(mixedContractPatch.analysis.classification, "contract_weakening");
assert(mixedContractPatch.analysis.expansions.some((item) =>
  item.category === "requires_removed" &&
  item.identity.startsWith("module:module.air:")));
assert(mixedContractPatch.analysis.expansions.some((item) =>
  item.category === "requires_removed" &&
  item.identity.startsWith("module.air::helper:")));

const ensuresWeakened = writePackage("ensures-weakened", baseSource.replaceAll("ensures return >= 0", "ensures return >= -1"));
const ensuresPatch = patch(base, ensuresWeakened);
assert(expansionKinds(ensuresPatch).has("contract_weakening"));

const widerRefinement = writePackage("wider-refinement", baseSource.replaceAll("i32<0..10>", "i32<-1..11>"));
const widerPatch = patch(base, widerRefinement);
assert(expansionKinds(widerPatch).has("contract_weakening"));

const nonEmptySliceSource = baseSource.replace(
  "export func run",
  `func keep_bytes(bytes: slice<nonempty>) -> i32 {
entry:
  %len:i32 = slice.len %bytes
  return %len
}

export func run`
);
const nonEmptySliceBase = writePackage("non-empty-slice-base", nonEmptySliceSource);
const emptySliceAllowed = writePackage(
  "empty-slice-allowed",
  nonEmptySliceSource.replace("bytes: slice<nonempty>", "bytes: slice")
);
const emptySlicePatch = patch(nonEmptySliceBase, emptySliceAllowed);
assert(expansionKinds(emptySlicePatch).has("contract_weakening"));

function flowSource(options = {}) {
  const sourceLabel = options.sourceLabel || "sensitive";
  const sinkLabel = options.sinkLabel || "restricted";
  const storage = options.storage === false ? "" : "global cache:i32 = const.i32 0\n";
  const storageDeclaration = options.storage === false ? "" : `flow storage global cache ${options.storageLabel || "restricted"}\n`;
  const policy = options.policy === false ? "" : "flow policy required\n";
  return `module flow_case
${storage}capabilities { }
${policy}flow source param run.secret ${sourceLabel}
flow sink return run ${sinkLabel}
${storageDeclaration}
export func run(secret: i32) -> i32 {
entry:
  return %secret
}
`;
}

function flowManifest(extra = {}) {
  return manifest("flow-case", {
    provenanceFlow: {
      mode: "required",
      sourceBindings: [],
      declassifiers: [],
      ...extra
    }
  });
}

const flowBase = writePackage("flow-base", flowSource(), flowManifest());
const sourceLowered = writePackage("source-lowered", flowSource({ sourceLabel: "internal" }), flowManifest());
const sourcePatch = patch(flowBase, sourceLowered);
assert(expansionKinds(sourcePatch).has("provenance_policy_expansion"));
assert(sourcePatch.analysis.provenanceFindings.some((item) => item.category === "source_label"));

const sinkBase = writePackage("sink-base", flowSource({ sourceLabel: "public", sinkLabel: "internal" }), flowManifest());
const sinkRaised = writePackage("sink-raised", flowSource({ sourceLabel: "public", sinkLabel: "restricted" }), flowManifest());
const sinkPatch = patch(sinkBase, sinkRaised);
assert(expansionKinds(sinkPatch).has("provenance_policy_expansion"));

const flowModeRemoved = writePackage(
  "flow-mode-removed",
  flowSource({ policy: false, storage: false }).replace("flow source param run.secret sensitive\n", "").replace("flow sink return run restricted\n", ""),
  manifest("flow-case")
);
const modePatch = patch(flowBase, flowModeRemoved);
assert(expansionKinds(modePatch).has("provenance_policy_expansion"));

const declassifierEntry = {
  id: "redact_sensitive",
  module: "flow_case",
  function: "redact",
  from: "sensitive",
  to: "public",
  reasonCode: "PII_REDACTION_V1"
};
const declassifierAdded = writePackage("declassifier-added", flowSource(), flowManifest({ declassifiers: [declassifierEntry] }));
const declassifierPatch = patch(flowBase, declassifierAdded);
assert(expansionKinds(declassifierPatch).has("declassification_authority_expansion"));

const declassifierOld = writePackage("declassifier-old", flowSource(), flowManifest({ declassifiers: [declassifierEntry] }));
const declassifierNew = writePackage("declassifier-new", flowSource(), flowManifest({
  declassifiers: [{ ...declassifierEntry, reasonCode: "BROADER_REASON" }]
}));
const declassifierChangedPatch = patch(declassifierOld, declassifierNew);
assert(expansionKinds(declassifierChangedPatch).has("declassification_authority_expansion"));

const storageRemoved = writePackage("storage-removed", flowSource({ storage: false }), flowManifest());
const storagePatch = patch(flowBase, storageRemoved);
assert(expansionKinds(storagePatch).has("provenance_policy_expansion"));

const formatted = writePackage("formatted", `module semantic_case

capabilities { }
effects { cpu.instructions <= 32 }
requires export run
func helper(value:i32< 0 .. 10 >)->i32<0..10>{
requires param value >= 0
ensures return >= 0
entry:
return %value
}
export func run(value:i32<0..10>)->i32<0..10>{
requires param value >= 0
ensures return >= 0
entry:
%out:i32<0..10>=call @helper(%value)
return %out
}
`);
const formattingPatch = patch(base, formatted);
assert.strictEqual(formattingPatch.analysis.classification, "semantic_noop");
assert.strictEqual(formattingPatch.operations.length, 0);

const renamed = writePackage("renamed", baseSource.replaceAll("helper", "renamed_helper"));
const renamePatch = patch(base, renamed);
assert(renamePatch.analysis.compatibility.findings.some((item) => item.category === "function_removed"));
assert(renamePatch.analysis.compatibility.findings.some((item) => item.category === "function_added"));
assert.strictEqual(inspectSemanticPatch(renamePatch, { strict: true }).status, "rejected");

expectError(
  () => applySemanticPatch(applied, compatiblePatch, path.join(tmp, "applied-twice"), { strict: true }),
  "air.semantic_patch.base_digest_mismatch"
);
expectError(
  () => applySemanticPatch(otherBase, compatiblePatch, path.join(tmp, "cross-package"), { strict: true }),
  "air.semantic_patch.base_digest_mismatch"
);

const authorityTamper = JSON.parse(JSON.stringify(compatiblePatch));
authorityTamper.creationAuthority.actor = "substituted.actor";
assert.strictEqual(validatePatch(authorityTamper).ok, false);

const unknownSchemaBase = writePackage("unknown-schema-base", baseSource, manifest("schema-case", {
  factSchemas: ["facts/schema.json"]
}), {
  "facts/schema.json": {
    schemaVersion: "0.18",
    kind: "air.boundedRowsetSchema",
    name: "rows",
    maxRows: 1,
    columns: [{ name: "value", type: "i32" }]
  }
});
const unknownSchemaResult = writePackage("unknown-schema-result", baseSource, manifest("schema-case", {
  factSchemas: ["facts/schema.json"]
}), {
  "facts/schema.json": {
    schemaVersion: "0.18",
    kind: "air.boundedRowsetSchema",
    name: "rows",
    maxRows: 2,
    columns: [{ name: "value", type: "i32" }]
  }
});
assert.strictEqual(classify(unknownSchemaBase, unknownSchemaResult), "unknown_unproven");

const capabilityBase = writePackage("capability-base", capSource, manifest("semantic-case", { capabilities: ["debug"] }));
assert.strictEqual(classify(capabilityBase, base), "narrowing");
assert.strictEqual(classify(effectBudgetRaised, base), "narrowing");

const refinementBase = writePackage("refinement-base", `module refinement_case
capabilities { }
export func accept(value: i32<0..10>) -> i32<0..10> {
entry:
  return %value
}
`, manifest("refinement-case"));
const narrowerRefinement = writePackage("narrower-refinement", `module refinement_case
capabilities { }
export func accept(value: i32<1..9>) -> i32<1..9> {
entry:
  return %value
}
`, manifest("refinement-case"));
assert.strictEqual(classify(refinementBase, narrowerRefinement), "narrowing");

const strongerEnsures = writePackage("stronger-ensures", baseSource.replaceAll("ensures return >= 0", "ensures return >= 1"));
assert.strictEqual(classify(base, strongerEnsures), "narrowing");

const sourceRaised = writePackage("source-raised", flowSource({ sourceLabel: "restricted" }), flowManifest());
assert.strictEqual(classify(flowBase, sourceRaised), "narrowing");

const sinkLowered = writePackage("sink-lowered", flowSource({ sourceLabel: "public", sinkLabel: "public" }), flowManifest());
assert.strictEqual(classify(sinkBase, sinkLowered), "narrowing");

const declassifierRemovedPatch = patch(declassifierOld, flowBase);
assert.strictEqual(declassifierRemovedPatch.analysis.classification, "narrowing");

const patchFile = path.join(tmp, "compatible.patch.json");
fs.writeFileSync(patchFile, stableStringify(compatiblePatch));
const evidenceA = createPackageVerificationEvidence(compatible, {
  semanticPatch: patchFile,
  semanticPatchStrict: true
});
const evidenceB = createPackageVerificationEvidence(compatible, {
  semanticPatch: patchFile,
  semanticPatchStrict: true
});
assert.strictEqual(stableStringify(evidenceA), stableStringify(evidenceB));
assert.strictEqual(evidenceA.semanticPatch.status, "accepted");
assert.strictEqual(evidenceA.semanticPatch.patchDigest, compatiblePatch.patchDigest);
assert.strictEqual(evidenceA.provenanceFlow, undefined);

const flowEvidence = createPackageVerificationEvidence(flowBase, {
  semanticPatch: patchFile,
  semanticPatchStrict: true
});
assert.strictEqual(flowEvidence.provenanceFlow.mode, "required");
assert.strictEqual(flowEvidence.semanticPatch.status, "accepted");

const markdownA = createEvidenceMarkdownReport(compatible, {
  semanticPatch: patchFile,
  semanticPatchStrict: true
});
const markdownB = createEvidenceMarkdownReport(compatible, {
  semanticPatch: patchFile,
  semanticPatchStrict: true
});
assert.strictEqual(markdownA, markdownB);
assert(markdownA.includes("## Semantic Patch"));
assert(markdownA.includes(compatiblePatch.patchDigest));

const cliPatch = path.join(tmp, "cli.patch.json");
const cliGenerated = runCli([
  "semantic-patch", "generate", base, compatible, "-o", cliPatch,
  "--authority-source", "human_user_direct", "--actor", "codex.impl.air-language.m5",
  "--human-forced", "--reason", "TEST", "--json"
]);
assert.strictEqual(cliGenerated, fs.readFileSync(cliPatch, "utf8"));
const cliInspectA = runCli(["semantic-patch", "inspect", cliPatch, "--strict", "--json"]);
const cliInspectB = runCli(["semantic-patch", "inspect", cliPatch, "--strict", "--json"]);
assert.strictEqual(cliInspectA, cliInspectB);
assert.strictEqual(JSON.parse(cliInspectA).status, "accepted");
const cliApplied = path.join(tmp, "cli-applied");
const cliApply = JSON.parse(runCli(["semantic-patch", "apply", cliPatch, base, "-o", cliApplied, "--strict", "--json"]));
assert.strictEqual(cliApply.outputPackageDigest, JSON.parse(cliGenerated).expectedResult.packageDigest);

fs.writeFileSync(path.join(tmp, "capability.patch.json"), stableStringify(capabilityPatch));
const strictRejected = runCliStatus(["semantic-patch", "verify", path.join(tmp, "capability.patch.json"), "--strict", "--json"]);
assert.strictEqual(strictRejected.status, 1);
assert.strictEqual(JSON.parse(strictRejected.stdout).status, "rejected");
const rejectedEvidence = createPackageVerificationEvidence(capabilityAdded, {
  semanticPatch: path.join(tmp, "capability.patch.json"),
  semanticPatchStrict: true
});
assert.strictEqual(rejectedEvidence.status, "failed");
assert(rejectedEvidence.diagnostics.some((item) => item.code === "air.semantic_patch.rejected"));

console.log("semantic patch non-expansion tests passed");
