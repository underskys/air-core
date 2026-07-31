#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const air = require("../src");
const { borrowedSliceInterfaceDescriptor } = require("../src/borrowed_slices");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { parseAir } = require("../src/parser");
const {
  createSemanticPatch,
  inspectBorrowedMemoryCertificateChange,
  inspectSemanticPatch
} = require("../src/semantic_patch");
const {
  createVerifiedResourceCertificate,
  stableCertificateStringify,
  validateVerifiedResourceCertificate,
  verifyModule
} = require("../src/verifier");
const {
  validateBorrowedMemoryInvocationEvidence
} = require("../src/verification_evidence");

const root = path.resolve(__dirname, "..");
const tmp = path.join(root, "build", "borrowed-memory-certificate-tests");
const packageDigest = `sha256:${"8".repeat(64)}`;

function source(options = {}) {
  const srcAccess = options.srcAccess || "readonly";
  const dstAccess = options.dstAccess || "writeonly";
  const srcMax = options.srcMax || 16;
  const relation = options.relation === false
    ? ""
    : "  requires checked bytes src >= param count * 4\n";
  const extraParam = options.extraParam
    ? ", audit: borrowed_slice<readonly,len<=4,align=4>"
    : "";
  return `module borrowed_certificate
capabilities { }
requires export transform
export func transform(src: borrowed_slice<${srcAccess},len<=${srcMax},align=4>, dst: borrowed_slice<${dstAccess},len<=16,align=4>, count: i32${extraParam}) -> i32 {
  requires checked param count >= 0
  requires checked param count <= 4
${relation}  requires checked bytes dst >= param count * 4
entry:
  %value:i32 = slice.load.i32 %src, 0
  slice.store.i32 %dst, 0, %value
  return %count
}
`;
}

function moduleFor(text, name = "module.air") {
  const mod = parseAir(text, name, { resolveSourceImports: false });
  verifyModule(mod, { library: true });
  return mod;
}

function certificateFor(text, name = "module.air") {
  return createVerifiedResourceCertificate(moduleFor(text, name), {
    packageName: "borrowed-certificate",
    packageDigest,
    modulePath: name,
    mode: "required"
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasCode(validation, code) {
  return (validation.diagnostics || []).some((item) => item.code === code);
}

function writePackage(name, text) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.air"), text);
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({
    name: "borrowed-certificate",
    version: "0.0.0",
    airAbi: "0.11",
    hostAbi: "0.10",
    entry: "module.air",
    capabilities: [],
    targetProfiles: [],
    resourceCertificate: {
      mode: "required",
      requiredBounds: ["borrowedMemory", "effects", "hostCalls", "loops", "memory"]
    }
  }, null, 2)}\n`);
  return dir;
}

function strictPatch(base, result) {
  const patch = createSemanticPatch(base, result, {
    authoritySource: "test",
    actor: "test.borrowed-memory-certificate"
  });
  assert.strictEqual(inspectSemanticPatch(patch, { strict: true }).status, "rejected");
  return patch;
}

function assertExpansion(patch, classification, category) {
  assert((patch.analysis.expansions || []).some((item) =>
    item.classification === classification && item.category === category),
  `expected ${classification}/${category}`);
}

async function invocationEvidence(text) {
  const mod = moduleFor(text);
  const wasmBytes = await watToWasm(lowerToWat(mod), "<borrowed-certificate>");
  const instance = await air.instantiateAirModule({ wasmBytes, packageDigest });
  const src = new Uint8Array(16);
  const dst = new Uint8Array(16);
  new DataView(src.buffer).setInt32(0, 27, true);
  return air.invokeBorrowedMemory({
    instance,
    interfaceDescriptor: borrowedSliceInterfaceDescriptor(mod),
    packageDigest,
    entrypoint: "transform",
    bindings: {
      src: {
        buffer: src,
        access: "readonly",
        actualLength: 16,
        maxLength: 16,
        alignment: 4,
        aliasGroup: null,
        memoryDomain: "wasm-linear",
        transferMode: "copied_into_wasm"
      },
      dst: {
        buffer: dst,
        access: "writeonly",
        actualLength: 16,
        maxLength: 16,
        alignment: 4,
        aliasGroup: null,
        memoryDomain: "wasm-linear",
        transferMode: "copied_into_wasm"
      }
    },
    arguments: { count: 1 }
  }).evidence;
}

(async () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const baseCertificate = certificateFor(source());
  const repeatedCertificate = certificateFor(source());
  assert.strictEqual(
    stableCertificateStringify(repeatedCertificate),
    stableCertificateStringify(baseCertificate)
  );
  assert.strictEqual(validateVerifiedResourceCertificate(baseCertificate, {
    required: true,
    packageDigest
  }).status, "pass");

  const borrowed = baseCertificate.bounds.borrowedMemory;
  assert.strictEqual(borrowed.status, "verified");
  assert.strictEqual(borrowed.airAbi, "0.11");
  assert.strictEqual(borrowed.feature, "borrowed-slice-v1");
  assert.strictEqual(borrowed.borrowedParameterCount, 2);
  assert.strictEqual(borrowed.maximumTotalBorrowedBytes, 32);
  assert.strictEqual(borrowed.maximumReadableBytes, 16);
  assert.strictEqual(borrowed.maximumWritableBytes, 16);
  assert.strictEqual(borrowed.maximumCopyInBytes, 16);
  assert.strictEqual(borrowed.maximumCopyOutBytes, 16);
  assert.strictEqual(borrowed.maximumTypedReads, 1);
  assert.strictEqual(borrowed.maximumTypedWrites, 1);
  assert.strictEqual(borrowed.maximumReadBytes, 4);
  assert.strictEqual(borrowed.maximumWriteBytes, 4);
  assert.strictEqual(borrowed.maximumDynamicBoundsChecks, 2);
  assert.strictEqual(borrowed.maximumRelationChecks, 2);
  assert.strictEqual(borrowed.maximumHostBindingValidationOperations, 21);
  assert.deepStrictEqual(borrowed.memoryDomains, ["wasm-linear"]);
  assert.deepStrictEqual(borrowed.supportedTransferModes, [
    "copied_into_wasm",
    "wasm_memory_view"
  ]);
  assert.strictEqual(borrowed.parameters[0].noescape, true);
  assert.strictEqual(borrowed.parameters[0].inPlaceAllowed, false);
  assert.deepStrictEqual(borrowed.unsupportedUnprovenReasons, []);

  const fieldTamper = clone(baseCertificate);
  fieldTamper.bounds.borrowedMemory.maximumTotalBorrowedBytes += 1;
  const fieldTamperResult = validateVerifiedResourceCertificate(fieldTamper);
  assert.strictEqual(fieldTamperResult.status, "fail");
  assert(hasCode(fieldTamperResult, "air.resource_certificate.digest_mismatch"));
  assert(hasCode(fieldTamperResult, "air.resource_certificate.borrowed_memory_digest_mismatch"));

  const packageSubstitution = validateVerifiedResourceCertificate(baseCertificate, {
    packageDigest: `sha256:${"9".repeat(64)}`
  });
  assert.strictEqual(packageSubstitution.status, "fail");
  assert(hasCode(packageSubstitution, "air.resource_certificate.package_substitution"));

  const identitySubstitution = clone(baseCertificate);
  identitySubstitution.bounds.borrowedMemory.parameters[0].identity = "module.air::transform::other";
  const identityResult = validateVerifiedResourceCertificate(identitySubstitution);
  assert.strictEqual(identityResult.status, "fail");
  assert(hasCode(identityResult, "air.resource_certificate.borrowed_parameter_identity_mismatch"));

  assert.strictEqual(validateVerifiedResourceCertificate({}).status, "fail");
  const malformedBorrowed = clone(baseCertificate);
  malformedBorrowed.bounds.borrowedMemory.parameters = {};
  assert.strictEqual(validateVerifiedResourceCertificate(malformedBorrowed).status, "fail");
  const unknownOption = validateVerifiedResourceCertificate(baseCertificate, { surprise: true });
  assert.strictEqual(unknownOption.status, "fail");
  assert(hasCode(unknownOption, "air.resource_certificate.option_unknown"));

  const legacy = certificateFor(`module legacy
capabilities { }
requires export run
export func run(value: i32) -> i32 {
entry:
  return %value
}
`, "legacy.air");
  assert.strictEqual(legacy.bounds.borrowedMemory.status, "verified");
  assert.strictEqual(legacy.bounds.borrowedMemory.borrowedParameterCount, 0);
  assert.strictEqual(legacy.bounds.borrowedMemory.feature, null);
  assert.strictEqual(validateVerifiedResourceCertificate(legacy).status, "pass");

  const basePackage = writePackage("base", source());
  const maxPackage = writePackage("max", source({ srcMax: 32 }));
  const readonlyToReadwritePackage = writePackage("readonly-to-readwrite", source({ srcAccess: "readwrite" }));
  const writeonlyToReadwritePackage = writePackage("writeonly-to-readwrite", source({ dstAccess: "readwrite" }));
  const relationRemovedPackage = writePackage("relation-removed", source({ relation: false }));
  const parameterAddedPackage = writePackage("parameter-added", source({ extraParam: true }));

  assertExpansion(strictPatch(basePackage, maxPackage), "resource_expansion", "borrowed_maximumByteLength_increased");
  assertExpansion(strictPatch(basePackage, readonlyToReadwritePackage), "effect_expansion", "borrowed_access_expanded");
  assertExpansion(strictPatch(basePackage, writeonlyToReadwritePackage), "effect_expansion", "borrowed_access_expanded");
  assertExpansion(strictPatch(basePackage, relationRemovedPackage), "contract_weakening", "borrowed_entry_relation_removed");
  assertExpansion(strictPatch(basePackage, parameterAddedPackage), "resource_expansion", "borrowed_parameter_added");

  const section = clone(borrowed);
  const weakenedAlias = clone(section);
  weakenedAlias.parameters[0].aliasPolicy = "allow_mutable_overlap";
  assertExpansion(
    { analysis: inspectBorrowedMemoryCertificateChange(section, weakenedAlias) },
    "effect_expansion",
    "borrowed_alias_policy_weakened"
  );

  const noescapeRemoved = clone(section);
  noescapeRemoved.parameters[0].noescape = false;
  assertExpansion(
    { analysis: inspectBorrowedMemoryCertificateChange(section, noescapeRemoved) },
    "contract_weakening",
    "borrowed_noescape_removed"
  );

  const broaderDomain = clone(section);
  broaderDomain.memoryDomains.push("native");
  assertExpansion(
    { analysis: inspectBorrowedMemoryCertificateChange(section, broaderDomain) },
    "capability_expansion",
    "borrowed_memory_domain_added"
  );

  const transferModeAdded = clone(section);
  transferModeAdded.supportedTransferModes.push("native_pointer");
  assertExpansion(
    { analysis: inspectBorrowedMemoryCertificateChange(section, transferModeAdded) },
    "capability_expansion",
    "borrowed_transfer_mode_added"
  );

  const partialOverlapEnabled = clone(section);
  partialOverlapEnabled.parameters[0].inPlaceAllowed = true;
  assertExpansion(
    { analysis: inspectBorrowedMemoryCertificateChange(section, partialOverlapEnabled) },
    "effect_expansion",
    "borrowed_partial_overlap_enabled"
  );

  const alignmentStrengthened = clone(section);
  alignmentStrengthened.parameters[0].requiredAlignment = 8;
  const alignmentResult = inspectBorrowedMemoryCertificateChange(section, alignmentStrengthened);
  assert(alignmentResult.narrowings.some((item) => item.category === "borrowed_alignment_strengthened"));

  const alignmentWeakened = clone(section);
  alignmentWeakened.parameters[0].requiredAlignment = 2;
  assertExpansion(
    { analysis: inspectBorrowedMemoryCertificateChange(section, alignmentWeakened) },
    "resource_expansion",
    "borrowed_alignment_weakened"
  );

  const missingComparable = inspectBorrowedMemoryCertificateChange(section, null);
  assert(missingComparable.unknowns.some((item) => item.classification === "unknown_unproven"));

  const evidence = await invocationEvidence(source());
  assert.strictEqual(validateBorrowedMemoryInvocationEvidence(evidence, {
    packageDigest
  }).status, "pass");
  const evidenceTamper = clone(evidence);
  evidenceTamper.parameters[0].actualLength -= 4;
  const evidenceTamperResult = validateBorrowedMemoryInvocationEvidence(evidenceTamper);
  assert.strictEqual(evidenceTamperResult.status, "fail");
  assert(hasCode(evidenceTamperResult, "air.borrow.evidence_digest_mismatch"));
  assert(hasCode(evidenceTamperResult, "air.borrow.binding_digest_mismatch"));

  console.log(JSON.stringify({
    status: "pass",
    hostileCases: 18,
    semanticPatchCases: 12,
    certificateFields: 24,
    deterministic: true
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
