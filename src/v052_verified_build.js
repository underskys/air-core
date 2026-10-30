"use strict";

// This is a host-side SDK boundary, not an AIR ABI or Host Contract change.
// A result is only invocable when it originated from buildVerifiedTypedModule
// in this process. Its public record is evidence; the closure-held build state
// is the authority that permits checked invocation.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const lowerWasmModule = require("./lower_wasm");
const { lowerToWat, watToWasm } = lowerWasmModule;
const {
  SOURCE_PROFILE_TYPED_V051,
  SOURCE_PROFILE_TYPED_V053,
  isTypedSourceProfile,
  normalizeSourceProfile,
  parseSource,
  verifySource
} = require("./source_profile");
const parserModule = require("./parser");
const verifierModule = require("./verifier");
const { AnalysisRefusedError, enforceAnalysisCapacity, normalizeAnalysisCapacity } = require("./analysis_capacity");
const {
  canonicalDescriptor,
  descriptorDigest,
  enumSchemaContextFromDescriptor,
  normalizeTypedInterfaceDescriptor,
  parseTypeReference,
  validateDescriptorAgainstSource
} = require("./typed_interface");
const { canonical, typedValue } = require("./v051_reference");
const { AIR_VERSION } = require("./version");
const { checkedNumericFailureReason, typedV053FailureIdentity } = require("./v052_numeric_diagnostic");
const { parseRefinementType } = require("./types");
const { createToolchainGuard } = require("./v052_toolchain_identity");
const { AirError } = require("./errors");
const typedBorrowed = require("./borrowed_slices").typedV053;
const { BORROWED_SLICE_DOMAINS } = require("./borrowed_slices");
const typedClosure = require("./typed_closure");
const {
  WorkBoundError,
  analysisError,
  analyzeVerifiedTypedModule,
  bindVerifiedTypedWorkBound,
  registerBindingReader
} = require("./workbound");
const TOOLCHAIN = createToolchainGuard(__dirname);

const VERIFIED_TYPED_BUILD_SCHEMA = "air.v052.verifiedTypedBuild/2";
// P0-03 (slice text §4.3; owner decision OD-P3-2 (a)): every typed-v0.53 build
// record uses this schema, which adds `sourceSignature` to the /2 key set.
// Not exported: src/index.js spreads this module's exports.
const VERIFIED_TYPED_V053_BUILD_SCHEMA = "air.v053.verifiedTypedBuild/1";
const VERIFIED_TYPED_BUILD_KIND = "air.verifiedTypedBuild";
const CHECKED_TYPED_INVOCATION_KIND = "air.checkedTypedInvocation";
const LOWERING_ID = "air.lower_wasm.v051-typed";
const VERIFIED_TYPED_RUNTIME_BUILD_SCHEMA = "air.v052.verifiedRuntimeBuild/1";
const VERIFIED_TYPED_RUNTIME_BUILD_KIND = "air.verifiedRuntimeBuild";
const VERIFIED_TYPED_RUNTIME_CACHE_KEY_SCHEMA = "air.v052.verifiedRuntimeCacheKey/1";
const VERIFIED_TYPED_RUNTIME_STATUS_SCHEMA = "air.v052.verifiedRuntimeStatus/1";
const VERIFIED_TYPED_RUNTIME_LIMITS = Object.freeze({
  maxAstNodes: 65536,
  maxCacheBytes: 64 * 1024 * 1024,
  maxCacheEntries: 64,
  maxConcurrentBuilds: 8,
  maxDescriptorBytes: 256 * 1024,
  maxInvocationLanes: 64,
  maxSourceBytes: 256 * 1024,
  maxSourceNameBytes: 1024,
  maxWasmBytes: 4 * 1024 * 1024,
  maxWatBytes: 4 * 1024 * 1024
});
const BUILDS = new WeakMap();
// Private WorkBound binding of runtime handles (P0-02, R-WB-20); never read
// by admission, invocation or the cache key.
const HANDLE_WORKBOUND = new WeakMap();
registerBindingReader((target) => {
  const state = BUILDS.get(target);
  if (state) return state.workBound;
  return HANDLE_WORKBOUND.get(target) || null;
});
let pinnedToolchain;
let pinnedLoweringDigest;

class V052VerifiedBuildError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "V052VerifiedBuildError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new V052VerifiedBuildError(code, message);
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function digestCanonical(value) {
  return digestBytes(Buffer.from(canonical(value), "utf8"));
}

function currentToolchainIdentity() {
  const identity = TOOLCHAIN.snapshot();
  if (!pinnedToolchain) pinnedToolchain = identity;
  return identity;
}

function pinnedToolchainIdentity() {
  if (!pinnedToolchain) pinnedToolchain = TOOLCHAIN.snapshot();
  return pinnedToolchain;
}

function copyDescriptorData(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copyDescriptorData);
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = copyDescriptorData(value[key]);
  return copy;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function throwBuildSourceError(error, phase) {
  if (!error || !["AirError", "VerificationError"].includes(error.name)) throw error;
  let message = String(error.message);
  const prefix = error.loc ? `${error.loc.file}:${error.loc.line}: ` : "";
  if (prefix && message.startsWith(prefix)) message = message.slice(prefix.length);
  const match = /^(air\.[a-z0-9_]+(?:\.[a-z0-9_]+)*):\s*/.exec(message);
  const code = typeof error.code === "string" && /^air\./.test(error.code)
    ? error.code
    : match ? match[1] : `air.v052.source_${phase}_failure`;
  const wrapped = new V052VerifiedBuildError(code, match ? message.slice(match[0].length) : message);
  if (error.loc) wrapped.loc = { ...error.loc };
  wrapped.cause = error;
  throw wrapped;
}

function throwWorkBoundError(error) {
  const wrapped = new V052VerifiedBuildError(error.code, error.detail);
  if (error.loc) wrapped.loc = { ...error.loc };
  wrapped.disposition = error.disposition;
  wrapped.cause = error;
  throw wrapped;
}

// RFC R3.1 §6.12 (P0-02): WorkBound summaries of the verified typed AST, part
// of phase S. typed-v0.51 has no calls or loops, so no typed-v0.51 source can
// fail here; a failure would still be reported with its stable code.
function summarizeVerifiedTypedBuild(mod) {
  let analysis;
  try {
    analysis = analyzeVerifiedTypedModule(mod);
  } catch (error) {
    if (error instanceof WorkBoundError) throwWorkBoundError(error);
    throw error;
  }
  if (analysis.status !== "ok") throwWorkBoundError(analysisError(analysis));
  return analysis;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("air.v052.verified_build_input_invalid", `${label} must be an object`);
  }
  return value;
}

function requireRuntimeObject(value, label, code = "air.v052.runtime_input_invalid") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
  return value;
}

function requireAsciiText(value, label) {
  if (typeof value !== "string" || !value || /[^\x00-\x7f]/.test(value)) {
    fail("air.v052.verified_build_input_invalid", `${label} must be non-empty ASCII text`);
  }
  return value;
}

function loweringImplementationDigest() {
  if (!pinnedLoweringDigest) {
    pinnedLoweringDigest = digestBytes(fs.readFileSync(path.join(__dirname, "lower_wasm.js")));
  }
  return pinnedLoweringDigest;
}

function requireNoUnknownKeys(value, allowed, label, code = "air.v052.runtime_input_invalid") {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(code, `${label} has unknown field '${unknown.sort()[0]}'`);
}

function requireBoundedInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("air.v052.runtime_limits_invalid", `${label} must be an integer from 1 through ${maximum}`);
  }
  return value;
}

function normalizeRuntimeLimits(input) {
  if (input === undefined) return VERIFIED_TYPED_RUNTIME_LIMITS;
  requireRuntimeObject(input, "runtime limits", "air.v052.runtime_limits_invalid");
  const names = Object.keys(VERIFIED_TYPED_RUNTIME_LIMITS);
  requireNoUnknownKeys(input, names, "runtime limits", "air.v052.runtime_limits_invalid");
  const limits = {};
  for (const name of names) {
    limits[name] = input[name] === undefined
      ? VERIFIED_TYPED_RUNTIME_LIMITS[name]
      : requireBoundedInteger(input[name], name, VERIFIED_TYPED_RUNTIME_LIMITS[name]);
  }
  return Object.freeze(limits);
}

function enforceWorkLimit(code, actual, maximum, label) {
  if (actual > maximum) fail(code, `${label} exceeds the configured limit of ${maximum}`);
}

const TYPED_CLI_BUILD_LIMIT_CHECKS = Object.freeze({
  sourceBytes: ["air.v052.work_limit_source_bytes", "maxSourceBytes", "source bytes"],
  astNodes: ["air.v052.work_limit_ast_nodes", "maxAstNodes", "parsed AST nodes"],
  watBytes: ["air.v052.work_limit_wat_bytes", "maxWatBytes", "lowered WAT bytes"],
  wasmBytes: ["air.v052.work_limit_wasm_bytes", "maxWasmBytes", "emitted Wasm bytes"]
});

// Applies the verified typed build work limits to other typed build entrypoints
// (for example `airc build --source-profile typed-v0.51`), so that no typed
// lowering path is uncapped.
function enforceVerifiedTypedBuildLimit(kind, actual) {
  const check = TYPED_CLI_BUILD_LIMIT_CHECKS[kind];
  if (!check) throw new TypeError(`unknown verified typed build limit '${kind}'`);
  enforceWorkLimit(check[0], actual, VERIFIED_TYPED_RUNTIME_LIMITS[check[1]], check[2]);
}

function verifiedTypedAstNodeCount(mod) {
  return structuredObjectCount(mod);
}

function structuredObjectCount(root) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    count += 1;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
    } else {
      for (const item of Object.values(value)) stack.push(item);
    }
  }
  return count;
}

function enforceStructuredInputLimit(root, maximum, label) {
  let bytes = 0;
  const active = new Set();
  const stack = [{ leave: false, value: root }];
  while (stack.length) {
    const item = stack.pop();
    const value = item.value;
    if (item.leave) {
      active.delete(value);
      continue;
    }
    if (value === null) bytes += 4;
    else if (typeof value === "string") bytes += Buffer.byteLength(value, "utf8") + 2;
    else if (typeof value === "number") bytes += String(value).length;
    else if (typeof value === "boolean") bytes += value ? 4 : 5;
    else if (value && typeof value === "object") {
      if (active.has(value)) fail("air.v052.runtime_input_invalid", `${label} must not contain cycles`);
      active.add(value);
      stack.push({ leave: true, value });
      if (Array.isArray(value)) {
        bytes += 2 + Math.max(0, value.length - 1);
        for (const child of value) stack.push({ leave: false, value: child });
      } else {
        const keys = Object.keys(value);
        bytes += 2 + Math.max(0, keys.length - 1);
        for (const key of keys) {
          bytes += Buffer.byteLength(key, "utf8") + 3;
          stack.push({ leave: false, value: value[key] });
        }
      }
    } else {
      fail("air.v052.runtime_input_invalid", `${label} must contain only JSON values`);
    }
    enforceWorkLimit("air.v052.work_limit_descriptor_bytes", bytes, maximum, label);
  }
}

function normalizedBuildRecord(record) {
  requireObject(record, "verified build record");
  // /2 is typed-v0.51 only (P3-R7); typed-v0.53 records use the v053 schema,
  // whose closed key set is /2's plus `sourceSignature` (slice text §4.3).
  const typedV053 = record.schema === VERIFIED_TYPED_V053_BUILD_SCHEMA;
  const expected = [
    "compiler", "descriptor", "descriptorDigest", "kind", "lowering",
    "schema", "sourceDigest", "sourceProfile", ...(typedV053 ? ["sourceSignature"] : []), "wasmDigest"
  ];
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("air.v052.verified_build_invalid", "verified build record has missing or unknown fields");
  }
  if (record.kind !== VERIFIED_TYPED_BUILD_KIND || (!typedV053 && record.schema !== VERIFIED_TYPED_BUILD_SCHEMA)) {
    fail("air.v052.verified_build_invalid", "verified build schema is invalid");
  }
  if (record.sourceProfile !== (typedV053 ? SOURCE_PROFILE_TYPED_V053 : SOURCE_PROFILE_TYPED_V051)) {
    fail("air.v052.verified_build_invalid", "verified build source profile is invalid");
  }
  // P0-08: a typed-v0.53 borrowed-lane record carries the v2 descriptor.
  const borrowedLane = typedV053 && isTypedBorrowedDescriptor(record.descriptor);
  const descriptor = borrowedLane ? normalizeTypedBorrowedDescriptor(record.descriptor) : normalizeTypedInterfaceDescriptor(record.descriptor);
  if (record.descriptorDigest !== recordDescriptorDigest(descriptor)) {
    fail("air.v052.verified_build_descriptor_mismatch", "descriptor digest does not bind the descriptor");
  }
  for (const [label, value] of [["sourceDigest", record.sourceDigest], ["wasmDigest", record.wasmDigest]]) {
    if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
      fail("air.v052.verified_build_invalid", `${label} must be a sha256 digest`);
    }
  }
  requireObject(record.compiler, "compiler identity");
  requireObject(record.lowering, "lowering identity");
  if (Object.keys(record.compiler).sort().join(",") !== "implementationDigest,name,version" ||
      record.compiler.name !== "airc" || typeof record.compiler.version !== "string" ||
      typeof record.compiler.implementationDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(record.compiler.implementationDigest)) {
    fail("air.v052.verified_build_invalid", "compiler identity is invalid");
  }
  if (Object.keys(record.lowering).sort().join(",") !== "implementationDigest,name" ||
      record.lowering.name !== LOWERING_ID ||
      typeof record.lowering.implementationDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(record.lowering.implementationDigest)) {
    fail("air.v052.verified_build_invalid", "lowering identity is invalid");
  }
  return {
    compiler: { implementationDigest: record.compiler.implementationDigest, name: "airc", version: record.compiler.version },
    descriptor: copyDescriptorData(descriptor),
    descriptorDigest: record.descriptorDigest,
    kind: VERIFIED_TYPED_BUILD_KIND,
    lowering: {
      implementationDigest: record.lowering.implementationDigest,
      name: LOWERING_ID
    },
    schema: typedV053 ? VERIFIED_TYPED_V053_BUILD_SCHEMA : VERIFIED_TYPED_BUILD_SCHEMA,
    sourceDigest: record.sourceDigest,
    sourceProfile: record.sourceProfile,
    ...(typedV053 ? {
      sourceSignature: borrowedLane
        ? normalizedBorrowedSourceSignature(record.sourceSignature, descriptor)
        : normalizedSourceSignature(record.sourceSignature, descriptor)
    } : {}),
    wasmDigest: record.wasmDigest
  };
}

// P0-08: the source signature of a borrowed-lane record lists the v2
// descriptor's exports in order; a borrowed parameter's canonical source type
// states the descriptor's access, length and alignment, any other parameter
// type is the descriptor's.
function normalizedBorrowedSourceSignature(signature, descriptor) {
  const mismatch = (message) => fail("air.v052.verified_build_descriptor_mismatch", `sourceSignature ${message}`);
  const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === keys;
  if (!Array.isArray(signature) || signature.length !== descriptor.exports.length) {
    mismatch("must list every descriptor export in descriptor order");
  }
  return signature.map((entry, index) => {
    const exported = descriptor.exports[index];
    if (!exactKeys(entry, "function,name,parameters,return_type")) mismatch(`entry ${index} has missing or unknown fields`);
    if (entry.name !== exported.name || entry.function !== exported.name) mismatch(`entry ${index} does not match export '${exported.name}'`);
    if (!Array.isArray(entry.parameters) || !Array.isArray(exported.params) || entry.parameters.length !== exported.params.length) {
      mismatch(`export '${exported.name}' parameter count does not match the descriptor`);
    }
    const parameters = entry.parameters.map((parameter, position) => {
      const declared = exported.params[position];
      let borrow = null;
      try { borrow = exactKeys(parameter, "name,type") ? typedBorrowed.borrowOf(parameter.type) : null; } catch (_) { borrow = null; }
      const matches = exactKeys(parameter, "name,type") && parameter.name === declared.name && (declared.kind === "borrowed_slice"
        ? Boolean(borrow) && !/\s/.test(parameter.type) && borrow.access === declared.access && borrow.alignment === declared.alignment &&
          declared.length && borrow.length.min === declared.length.min && borrow.length.max === declared.length.max
        : declared.kind === "value" && parameter.type === declared.type);
      if (!matches) mismatch(`export '${exported.name}' parameter ${position} does not match the descriptor`);
      return { name: parameter.name, type: parameter.type };
    });
    if (typeof entry.return_type !== "string" || sourceTypeDescriptorImage(entry.return_type) === null) {
      mismatch(`export '${exported.name}' return type is not a canonical type`);
    }
    return { function: entry.function, name: entry.name, parameters, return_type: entry.return_type };
  });
}

// Slice text §4.3 item 3: every descriptor export, in descriptor order, as
// {name, function, parameters: [{name, type}], return_type} with the canonical
// typed-v0.53 source types; names, functions and arities equal the
// descriptor's, and desc(type) equals the descriptor type (R-TYPE-2).
function normalizedSourceSignature(signature, descriptor) {
  const mismatch = (message) => fail("air.v052.verified_build_descriptor_mismatch", `sourceSignature ${message}`);
  const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === keys;
  if (!Array.isArray(signature) || signature.length !== descriptor.exports.length) {
    mismatch("must list every descriptor export in descriptor order");
  }
  return signature.map((entry, index) => {
    const exported = descriptor.exports[index];
    if (!exactKeys(entry, "function,name,parameters,return_type")) mismatch(`entry ${index} has missing or unknown fields`);
    if (entry.name !== exported.name || entry.function !== exported.function) mismatch(`entry ${index} does not match export '${exported.name}'`);
    if (!Array.isArray(entry.parameters) || entry.parameters.length !== exported.parameters.length) {
      mismatch(`export '${exported.name}' parameter count does not match the descriptor`);
    }
    const parameters = entry.parameters.map((parameter, position) => {
      const declared = exported.parameters[position];
      if (!exactKeys(parameter, "name,type") || parameter.name !== declared.name || sourceTypeDescriptorImage(parameter.type) !== declared.type) {
        mismatch(`export '${exported.name}' parameter ${position} does not match the descriptor`);
      }
      return { name: parameter.name, type: parameter.type };
    });
    if (sourceTypeDescriptorImage(entry.return_type) !== exported.return_type) mismatch(`export '${exported.name}' return type does not match the descriptor`);
    return { function: entry.function, name: entry.name, parameters, return_type: entry.return_type };
  });
}

// desc (R-TYPE-2): `i32<a..b>` maps to `i32`, every descriptor type to itself.
// Only canonical type text has an image; anything else has none (null).
function sourceTypeDescriptorImage(typeText) {
  if (typeof typeText !== "string") return null;
  try {
    const refinement = parseRefinementType(typeText);
    if (refinement) return refinement.base === "i32" && refinement.canonical === typeText ? "i32" : null;
    const type = parseTypeReference(typeText, { allowVoid: true });
    return type.canonical === typeText ? typeText : null;
  } catch (_) {
    return null;
  }
}

// The source signature a typed-v0.53 build records (§4.3): taken from the
// verified AST, whose types are the canonical text the formatter prints.
function typedV053SourceSignature(mod, descriptor) {
  const functions = new Map((mod.functions || []).map((fn) => [fn.name, fn]));
  return descriptor.exports.map((entry) => {
    // A v2 borrowed descriptor names each export by its function (P0-08).
    const name = isTypedBorrowedDescriptor(descriptor) ? entry.name : entry.function;
    const fn = functions.get(name);
    return {
      function: name,
      name: entry.name,
      parameters: fn.params.map((parameter) => ({ name: parameter.name, type: parameter.type })),
      return_type: fn.returnType
    };
  });
}

function publicBuildRecord(record) {
  return deepFreeze(normalizedBuildRecord(record));
}

async function buildVerifiedTypedModuleInternal(input, controls = {}) {
  requireObject(input, "verified build input");
  if (input.sourceProfile === SOURCE_PROFILE_TYPED_V053) return buildVerifiedTypedV053Internal(input, controls);
  const source = requireAsciiText(input.source, "source");
  const sourceName = typeof input.sourceName === "string" && input.sourceName
    ? input.sourceName
    : "<typed-source>";
  const sourceProfile = input.sourceProfile === undefined
    ? SOURCE_PROFILE_TYPED_V051
    : input.sourceProfile;
  if (!isTypedSourceProfile(sourceProfile)) {
    fail("air.v052.verified_build_profile_invalid", "verified typed build requires source profile typed-v0.51");
  }
  const limits = controls.limits;
  const sourceBytes = Buffer.byteLength(source, "utf8");
  const sourceNameBytes = Buffer.byteLength(sourceName, "utf8");
  if (limits) {
    enforceWorkLimit("air.v052.work_limit_source_bytes", sourceBytes, limits.maxSourceBytes, "source bytes");
    enforceWorkLimit("air.v052.work_limit_source_name_bytes", sourceNameBytes, limits.maxSourceNameBytes, "sourceName bytes");
  }

  let mod;
  try {
    mod = parseSource(source, sourceName, { sourceProfile: SOURCE_PROFILE_TYPED_V051 });
  } catch (error) { throwBuildSourceError(error, "parse"); }
  const astNodes = structuredObjectCount(mod);
  if (limits) enforceWorkLimit("air.v052.work_limit_ast_nodes", astNodes, limits.maxAstNodes, "parsed AST nodes");
  try {
    verifySource(mod, { sourceProfile: SOURCE_PROFILE_TYPED_V051 });
  } catch (error) { throwBuildSourceError(error, "verify"); }
  const workBoundAnalysis = summarizeVerifiedTypedBuild(mod);
  const descriptor = validateDescriptorAgainstSource(input.descriptor, mod);
  const descriptorBytes = Buffer.byteLength(canonicalDescriptor(descriptor), "utf8");
  if (limits) {
    enforceWorkLimit("air.v052.work_limit_descriptor_bytes", descriptorBytes, limits.maxDescriptorBytes, "canonical descriptor bytes");
  }
  const toolchain = currentToolchainIdentity();
  const wat = lowerToWat(mod, limits ? { maxWatBytes: limits.maxWatBytes } : undefined);
  const watBytes = Buffer.byteLength(wat, "utf8");
  if (limits) enforceWorkLimit("air.v052.work_limit_wat_bytes", watBytes, limits.maxWatBytes, "lowered WAT bytes");
  let wasmBytes;
  try {
    wasmBytes = Buffer.from(await watToWasm(wat, sourceName));
  } catch (_) {
    fail("air.v052.verified_build_emission_failure", "verified typed WAT could not be emitted as Wasm");
  }
  if (limits) enforceWorkLimit("air.v052.work_limit_wasm_bytes", wasmBytes.length, limits.maxWasmBytes, "emitted Wasm bytes");
  // Do not label old loaded code with new on-disk identities after an await.
  TOOLCHAIN.snapshot();
  const record = publicBuildRecord({
    compiler: { implementationDigest: toolchain.implementationDigest, name: "airc", version: AIR_VERSION },
    descriptor,
    descriptorDigest: descriptorDigest(descriptor),
    kind: VERIFIED_TYPED_BUILD_KIND,
    lowering: { implementationDigest: loweringImplementationDigest(), name: LOWERING_ID },
    schema: VERIFIED_TYPED_BUILD_SCHEMA,
    sourceDigest: digestBytes(Buffer.from(source, "utf8")),
    sourceProfile: SOURCE_PROFILE_TYPED_V051,
    wasmDigest: digestBytes(wasmBytes)
  });
  const build = Object.freeze({
    ...record,
    artifactDigest: digestCanonical(record),
    wasmBytes: Buffer.from(wasmBytes)
  });
  // R-WB-20: the summaries are bound to the existing identities of this
  // build (sourceProfile, sourceDigest, compiler.implementationDigest) plus
  // the cost-table id and content digest, in the private build state.
  const workBound = bindVerifiedTypedWorkBound(workBoundAnalysis, {
    compilerImplementationDigest: record.compiler.implementationDigest,
    sourceDigest: record.sourceDigest,
    sourceProfile: record.sourceProfile
  });
  BUILDS.set(build, { record, wasmBytes: Buffer.from(wasmBytes), workBound });
  return build;
}

async function buildVerifiedTypedModule(input) {
  return buildVerifiedTypedModuleInternal(input, { limits: VERIFIED_TYPED_RUNTIME_LIMITS });
}

// P0-08 (slice text P8-R22): the host's backing limit, 64 MiB by default and
// lowerable by the host (OPEN-37 (a)). Above it the build is a bounded
// BUILD_REFUSED before lowering; the legacy 256 MiB ceiling is unchanged.
const TYPED_V053_MEMORY_BACKING_LIMIT = 67108864;

function normalizeMemoryBackingLimit(value) {
  if (value === undefined) return TYPED_V053_MEMORY_BACKING_LIMIT;
  if (!Number.isSafeInteger(value) || value < 0 || value > TYPED_V053_MEMORY_BACKING_LIMIT) {
    fail("air.v052.runtime_input_invalid", `memoryBackingLimit must be an integer from 0 to ${TYPED_V053_MEMORY_BACKING_LIMIT}`);
  }
  return value;
}

function enforceMemoryBackingLimit(layout, limit) {
  if (layout.backingBytes <= limit) return;
  const refused = new V052VerifiedBuildError("air.build.memory_backing_limit",
    `BUILD_REFUSED backing_bytes ${layout.backingBytes} exceeds the host backing limit ${limit}`);
  refused.disposition = "BUILD_REFUSED";
  refused.backingBytes = layout.backingBytes;
  refused.limit = limit;
  throw refused;
}

// P0-08 (P8-R13, P8-R15; R2.1 delta review N-4): a borrowed-lane build takes
// the v2 borrowed descriptor, validated here with src/borrowed_slices.js;
// validateDescriptorAgainstSource is not used for it. A descriptor of another
// lane keeps the EXISTING code, at the first borrowed export, its message
// naming the lane the module needs (AD-4, reading R-12).
function isTypedBorrowedDescriptor(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.schema === typedBorrowed.INTERFACE.schema;
}

function validateTypedBorrowedDescriptor(input, mod) {
  const expected = typedContractDescriptor(mod);
  if (!isTypedBorrowedDescriptor(input)) {
    const exported = (mod.functions || []).find((fn) => fn.exported && (fn.params || []).some((param) => typedBorrowed.borrowOf(param.type)));
    const requested = input && typeof input === "object" ? input.air_abi_lane || input.airAbi : undefined;
    if (!exported) {
      fail("air.borrow.interface_invalid", `module '${mod.name}' imports host functions; a typed-v0.53 contract artifact takes the AIR ABI ` +
        `${typedBorrowed.INTERFACE.airAbi} ${typedBorrowed.INTERFACE.schema} descriptor${typeof requested === "string" ? `, not lane ${requested}` : ""}`);
    }
    throwBuildSourceError(new AirError(
      `air.abi.borrowed_slice_requires_0_11: module '${mod.name}' uses borrowed-slice exports and requires AIR ABI ${typedBorrowed.INTERFACE.airAbi}` +
        `${typeof requested === "string" ? `, not ${requested}` : ""}`,
      exported.loc
    ), "verify");
  }
  const descriptor = normalizeTypedBorrowedDescriptor(input);
  if (typedBorrowed.stableStringify(descriptor) !== typedBorrowed.stableStringify(expected)) {
    fail("air.borrow.interface_invalid", `descriptor does not describe the borrowed exports of module '${mod.name}'`);
  }
  return descriptor;
}

// P0-10 (P10-R11; ABI-8: OPEN-ABI-2 (b); OD-P10-3 (a)): every module of a
// verified closure, the root alone without imports; and the names of the host
// imports its artifact carries, sorted (P10-R21: a T1 fact of the record,
// never authority over the bytes).
function typedClosureModules(mod) {
  const closure = typedClosure.closureOf(mod);
  return closure ? closure.order.map((key) => closure.records.get(key).ast) : [mod];
}

// P10-R28: a sourceName of P9-R5's module-key form (the form validateModuleMap
// requires of a root key with `modules`); a `<…>` label or any other text has
// no package, and every `use` stays not_found (P9-R5's label rule).
function typedRootKey(sourceName, maxBytes) {
  return typeof sourceName === "string" && /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.air$/.test(sourceName) &&
    Buffer.byteLength(sourceName, "utf8") <= maxBytes && sourceName.split("/").every((segment) => segment !== "." && segment !== "..");
}

function typedHostImportNames(mod) {
  return [...new Set(typedClosureModules(mod).flatMap((item) => (item.externs || []).map((extern) => extern.name)))].sort();
}

// A contract artifact with an extern takes P0-08's v2 descriptor, which lists
// every export of the root (a scalar parameter as a value, a borrowed one as
// P0-08's generator writes it), so the typed admission invokes any of them.
// An artifact without an extern keeps P0-08's descriptor, byte for byte.
function typedContractDescriptor(mod) {
  const borrowed = typedBorrowed.interfaceDescriptor(mod);
  if (!typedHostImportNames(mod).length) return borrowed;
  const written = new Map(((borrowed && borrowed.exports) || []).map((entry) => [entry.name, entry]));
  return {
    schema: typedBorrowed.INTERFACE.schema,
    airAbi: typedBorrowed.INTERFACE.airAbi,
    feature: typedBorrowed.INTERFACE.feature,
    lengthUnit: "bytes",
    memoryDomains: BORROWED_SLICE_DOMAINS.slice(),
    transferModeRequired: true,
    exports: (mod.functions || []).filter((fn) => fn.exported).map((fn) => written.get(fn.name) || {
      name: fn.name,
      params: (fn.params || []).map((param) => ({ name: param.name, kind: "value", type: param.type })),
      entryContracts: []
    })
  };
}

// A JSON copy of a v2 descriptor with its fixed lane fields checked; the
// build compares the whole descriptor with the one its source implies.
function normalizeTypedBorrowedDescriptor(value) {
  if (!isTypedBorrowedDescriptor(value) || value.airAbi !== typedBorrowed.INTERFACE.airAbi ||
      value.feature !== typedBorrowed.INTERFACE.feature || !Array.isArray(value.exports) || !value.exports.length) {
    fail("air.borrow.interface_invalid", "typed-v0.53 borrowed descriptor schema, lane or feature is invalid");
  }
  let copy;
  try { copy = JSON.parse(JSON.stringify(value)); } catch (_) { copy = null; }
  if (!copy || typedBorrowed.stableStringify(copy) !== typedBorrowed.stableStringify(value)) {
    fail("air.borrow.interface_invalid", "typed-v0.53 borrowed descriptor must contain only JSON values");
  }
  return copy;
}

function recordDescriptorDigest(descriptor) {
  return isTypedBorrowedDescriptor(descriptor)
    ? `sha256:${typedBorrowed.interfaceDigest(normalizeTypedBorrowedDescriptor(descriptor))}`
    : descriptorDigest(descriptor);
}

function rethrowCodedSourceError(error, phase) {
  if (error instanceof AnalysisRefusedError) throw error;
  throwBuildSourceError(error, phase);
}

// typed-v0.53 (SCALAR) build under the candidate gate (R-PROF-1, slice text
// R-1). Phase order (slice text §3.1, §4.2 R17-d): source bytes → iterative
// parse → AST-node intake → capacity check → verify → WorkBound summaries →
// descriptor → phase-B engine limits → toolchain → lowering with the exact
// incremental WAT cap → assembly → Wasm cap on the assembler output before
// the bytes are hashed, compiled, cached or returned (AMD-10).
async function buildVerifiedTypedV053Internal(input, controls = {}) {
  try {
    normalizeSourceProfile(SOURCE_PROFILE_TYPED_V053, { allowCandidateProfile: input.allowCandidateProfile });
  } catch (error) { throwBuildSourceError(error, "parse"); }
  let analysisCapacity;
  try {
    analysisCapacity = normalizeAnalysisCapacity(controls.analysisCapacity !== undefined ? controls.analysisCapacity : input.analysisCapacity);
  } catch (error) { throwBuildSourceError(error, "parse"); }
  const source = requireAsciiText(input.source, "source");
  // P0-09 (P9-R26; OD-P9-6 (a)): the typed-v0.53 build input key `modules`.
  if (input.modules !== undefined) {
    typedClosure.validateModuleMap(input.modules, input.sourceName, VERIFIED_TYPED_RUNTIME_LIMITS.maxSourceNameBytes, "air.v052.verified_build_input_invalid", fail);
  }
  const sourceName = typeof input.sourceName === "string" && input.sourceName
    ? input.sourceName
    : "<typed-source>";
  const memoryBackingLimit = normalizeMemoryBackingLimit(input.memoryBackingLimit);
  const limits = controls.limits;
  if (limits) {
    enforceWorkLimit("air.v052.work_limit_source_bytes", Buffer.byteLength(source, "utf8"), limits.maxSourceBytes, "source bytes");
    enforceWorkLimit("air.v052.work_limit_source_name_bytes", Buffer.byteLength(sourceName, "utf8"), limits.maxSourceNameBytes, "sourceName bytes");
  }
  let mod;
  try {
    mod = parserModule.typedV053.parse(source, sourceName);
  } catch (error) { throwBuildSourceError(error, "parse"); }
  if (limits) enforceWorkLimit("air.v052.work_limit_ast_nodes", structuredObjectCount(mod), limits.maxAstNodes, "parsed AST nodes");
  // P0-09 (P9-R5..P9-R10, P9-R26): the closure from the module map, the
  // closure limits of the caller (the defaults on the direct builder) and
  // its capacity over the closure (P9-R26b).
  loadTypedBuildClosure(mod, source, input.modules, sourceName, { analysisCapacity, closureLimits: controls.closureLimits, limits });
  try {
    typedClosure.enforceCapacity(mod, analysisCapacity);
    verifierModule.typedV053.verify(mod);
  } catch (error) { rethrowCodedSourceError(error, "verify"); }
  const workBoundAnalysis = summarizeVerifiedTypedBuild(mod);
  // P0-08 (P8-R22): backing_bytes and region-slot bytes are functions of the
  // verified module; a borrowed export selects the typed borrowed lane.
  const layout = lowerWasmModule.typedV053.memoryLayout(mod);
  const descriptor = layout.borrowed ? validateTypedBorrowedDescriptor(input.descriptor, mod) : validateDescriptorAgainstSource(input.descriptor, mod);
  const descriptorBytes = Buffer.byteLength(layout.borrowed ? typedBorrowed.stableStringify(descriptor) : canonicalDescriptor(descriptor), "utf8");
  if (limits) {
    enforceWorkLimit("air.v052.work_limit_descriptor_bytes", descriptorBytes, limits.maxDescriptorBytes, "canonical descriptor bytes");
  }
  // The engine-structural limits first (P0-06 keeps its code for a module
  // whose memory exceeds them), then the host backing limit (P8-R22); both
  // before lowering.
  lowerWasmModule.typedV053.checkEngineLimits(mod);
  enforceMemoryBackingLimit(layout, memoryBackingLimit);
  const toolchain = currentToolchainIdentity();
  const wat = lowerToWat(mod, limits ? { analysisCapacity, maxWatBytes: limits.maxWatBytes } : { analysisCapacity });
  if (limits) enforceWorkLimit("air.v052.work_limit_wat_bytes", Buffer.byteLength(wat, "utf8"), limits.maxWatBytes, "lowered WAT bytes");
  let wasmBytes;
  try {
    wasmBytes = Buffer.from(await watToWasm(wat, sourceName));
  } catch (_) {
    fail("air.v052.verified_build_emission_failure", "verified typed WAT could not be emitted as Wasm");
  }
  if (limits) enforceWorkLimit("air.v052.work_limit_wasm_bytes", wasmBytes.length, limits.maxWasmBytes, "emitted Wasm bytes");
  // Do not label old loaded code with new on-disk identities after an await.
  TOOLCHAIN.snapshot();
  const record = publicBuildRecord({
    compiler: { implementationDigest: toolchain.implementationDigest, name: "airc", version: AIR_VERSION },
    descriptor,
    descriptorDigest: recordDescriptorDigest(descriptor),
    kind: VERIFIED_TYPED_BUILD_KIND,
    lowering: { implementationDigest: loweringImplementationDigest(), name: LOWERING_ID },
    schema: VERIFIED_TYPED_V053_BUILD_SCHEMA,
    sourceDigest: digestBytes(Buffer.from(source, "utf8")),
    sourceProfile: SOURCE_PROFILE_TYPED_V053,
    sourceSignature: typedV053SourceSignature(mod, descriptor),
    wasmDigest: digestBytes(wasmBytes)
  });
  const build = {
    ...record,
    artifactDigest: digestCanonical(record),
    wasmBytes: Buffer.from(wasmBytes)
  };
  // P0-08 (R-MEM-11, P8-R22): the two reported quantities, on a
  // non-enumerable property so the build's keys and JSON are unchanged.
  const memory = Object.freeze({ backingBytes: layout.backingBytes, regionSlotBytes: layout.regionSlotBytes });
  Object.defineProperty(build, "memory", { enumerable: false, value: memory });
  Object.freeze(build);
  // R-WB-20 with the typed-v0.53 profile in the key (V53-WB-ID-01).
  const closure = bindTypedClosureWorkBounds(mod, record.compiler.implementationDigest);
  const workBound = bindVerifiedTypedWorkBound(workBoundAnalysis, {
    compilerImplementationDigest: record.compiler.implementationDigest,
    dependencies: closure ? closure.dependencies : undefined,
    sourceDigest: record.sourceDigest,
    sourceProfile: record.sourceProfile
  });
  // P0-08 (P8-R15, R-ABI53-3a T1): the record of a borrowed-lane artifact
  // (digest, contract id, lane, owned range) lives in this private state.
  const borrowedLane = layout.borrowed ? typedBorrowedLaneRecord(record, wasmBytes, { end: layout.end, start: layout.base }, typedHostImportNames(mod)) : null;
  BUILDS.set(build, { borrowedLane, closure, memory, record, wasmBytes: Buffer.from(wasmBytes), workBound });
  return build;
}

// P0-09: a closure intake refusal keeps its disposition and fields (P9-R8);
// an import diagnostic its code and position (P9-R24); a capacity refusal
// passes through, as on one module.
function loadTypedBuildClosure(mod, source, modules, sourceName, settings) {
  try {
    return typedClosure.loadMapClosure(mod, source, modules, sourceName, settings);
  } catch (error) {
    if (error instanceof typedClosure.ClosureIntakeError) {
      const wrapped = new V052VerifiedBuildError(error.code, error.message.slice(error.code.length + 2));
      wrapped.disposition = error.disposition;
      wrapped.fields = error.fields;
      throw wrapped;
    }
    return rethrowCodedSourceError(error, "parse");
  }
}

// P0-09 (P9-R15, P9-R16; R-WB-18, R-WB-21): every module of the closure is
// bound in link order, each key listing one entry per distinct identity of
// its direct imports, with the digest of that import's own summary record
// recomputed here; the root's entries go into the build's key. The
// identities and records stay in this private state (P9-R17).
function bindTypedClosureWorkBounds(mod, compilerImplementationDigest) {
  const closure = typedClosure.closureOf(mod);
  if (!closure) return null;
  const bindings = new Map();
  const entriesOf = (key) => {
    const byIdentity = new Map();
    for (const target of closure.records.get(key).imports.values()) {
      byIdentity.set(closure.identities.get(target), {
        body_digest: typedClosure.sourceDigest(closure.records.get(target).source),
        module: closure.identities.get(target),
        summary_digest: bindings.get(target).recordDigest
      });
    }
    return [...byIdentity.keys()].sort().map((identity) => byIdentity.get(identity));
  };
  for (const key of closure.order) {
    if (key === closure.rootKey) continue;
    const member = closure.records.get(key);
    bindings.set(key, bindVerifiedTypedWorkBound(summarizeVerifiedTypedBuild(member.ast), {
      compilerImplementationDigest,
      dependencies: entriesOf(key),
      sourceDigest: typedClosure.sourceDigest(member.source),
      sourceProfile: SOURCE_PROFILE_TYPED_V053
    }));
  }
  return Object.freeze({
    bindings,
    counters: typedClosure.closureCounters(mod),
    dependencies: entriesOf(closure.rootKey),
    identities: new Map(closure.identities),
    order: closure.order.slice()
  });
}

function typedBorrowedLaneRecord(record, wasmBytes, ownedRange, capabilityImports) {
  const contract = lowerWasmModule.typedV053.contractImport;
  return Object.freeze({
    capabilityImports: Object.freeze(capabilityImports.slice()),
    contractId: contract.field,
    contractModule: contract.module,
    descriptor: deepFreeze(copyDescriptorData(record.descriptor)),
    lane: typedBorrowed.INTERFACE.airAbi,
    ownedRange: Object.freeze({ end: ownedRange.end, start: ownedRange.start }),
    wasmBytes: Buffer.from(wasmBytes),
    wasmDigest: record.wasmDigest
  });
}

// P0-08 (R-ABI53-9, P8-R24): a borrowed-lane artifact is invoked only through
// the typed admission, which supplies the contract import and binds borrowed
// views; the plain verified paths refuse it before instantiation.
// P0-10 (P10-R17): so is a contract artifact with a host import; its T1 record
// is the same record (P10-R11).
function refuseBorrowedLane(build) {
  const state = BUILDS.get(build);
  if (state && state.borrowedLane) {
    fail("air.assurance.profile_unsupported", "a typed-v0.53 contract build (a borrowed export or a host import) is invoked only through the typed admission (admitTypedV053Artifact)");
  }
}

function assertTrustedBuild(build) {
  const state = BUILDS.get(build);
  if (!state) {
    fail("air.v052.verified_build_untrusted", "checked invocation requires a build returned by buildVerifiedTypedModule in this process");
  }
  const record = publicBuildRecord({
    compiler: build.compiler,
    descriptor: build.descriptor,
    descriptorDigest: build.descriptorDigest,
    kind: build.kind,
    lowering: build.lowering,
    schema: build.schema,
    sourceDigest: build.sourceDigest,
    sourceProfile: build.sourceProfile,
    ...(state.record.schema === VERIFIED_TYPED_V053_BUILD_SCHEMA ? { sourceSignature: build.sourceSignature } : {}),
    wasmDigest: build.wasmDigest
  });
  if (canonical(record) !== canonical(state.record) || build.artifactDigest !== digestCanonical(state.record)) {
    fail("air.v052.verified_build_untrusted", "verified build identity was substituted");
  }
  if (!Buffer.isBuffer(build.wasmBytes) || digestBytes(build.wasmBytes) !== state.record.wasmDigest) {
    fail("air.v052.verified_build_wasm_mismatch", "Wasm bytes do not match the verified build descriptor");
  }
  if (recordDescriptorDigest(build.descriptor) !== state.record.descriptorDigest) {
    fail("air.v052.verified_build_descriptor_mismatch", "descriptor does not match the verified build descriptor");
  }
  return { record: state.record, wasmBytes: Buffer.from(build.wasmBytes) };
}

function interfaceExport(record, exportName) {
  if (typeof exportName !== "string" || !exportName) {
    fail("air.v052.invocation_export_invalid", "export name must be a non-empty string");
  }
  const entry = record.descriptor.exports.find((item) => item.name === exportName);
  if (!entry) fail("air.v052.invocation_export_unknown", `export '${exportName}' is not declared by the verified descriptor`);
  return entry;
}

function normalizeArguments(entry, args, enumContext) {
  if (!Array.isArray(args) || args.length !== entry.parameters.length) {
    fail("air.v052.invocation_arguments_invalid", `export '${entry.name}' expects ${entry.parameters.length} argument(s)`);
  }
  const wasmArgs = [];
  for (let index = 0; index < entry.parameters.length; index += 1) {
    const parameter = entry.parameters[index];
    let value;
    try {
      value = typedValue(args[index], `arguments[${index}]`, enumContext, parameter.type);
    } catch (error) {
      if (error && error.code) throw error;
      fail("air.v052.invocation_arguments_invalid", `argument ${index} is invalid`);
    }
    wasmArgs.push(...encodeForWasm(value, parameter.type, enumContext));
  }
  return wasmArgs;
}

function encodeForWasm(value, typeText, enumContext) {
  const type = parseTypeReference(typeText);
  if (type.kind === "primitive") {
    if (type.canonical === "i32") return [value];
    if (type.canonical === "bool") return [value ? 1 : 0];
    // i64 reaches WebAssembly only from the canonical decimal object. A JS
    // Number is never an ingress representation for this lane.
    if (type.canonical === "i64") return [BigInt(value.decimal)];
    return [numberFromCanonicalFloat(value)];
  }
  if (type.kind === "enum") return [value.discriminant];
  if (type.kind === "option") {
    if (value.tag === "none") return [0, ...zeroWasmLanes(type.payload)];
    return [1, ...encodeForWasm(value.value, type.payload.canonical, enumContext)];
  }
  if (type.kind === "result") {
    if (value.tag === "ok") return [0, ...encodeForWasm(value.value, type.payload.canonical, enumContext), ...zeroWasmLanes(type.error)];
    return [1, ...zeroWasmLanes(type.payload), ...encodeForWasm(value.error, type.error.canonical, enumContext)];
  }
  fail("air.v052.invocation_arguments_invalid", `type '${typeText}' is not supported by the checked invocation ABI`);
}

function zeroWasmLanes(type) {
  if (type.kind === "primitive") return [type.canonical === "i64" ? 0n : 0];
  if (type.kind === "enum") return [0];
  fail("air.v052.invocation_arguments_invalid", `sum payload type '${type.canonical}' is unsupported`);
}

function numberFromCanonicalFloat(value) {
  if (value.classification === "nan") return Number.NaN;
  if (value.type === "f32") {
    const bytes = Buffer.from(value.bits, "hex");
    return bytes.readFloatBE(0);
  }
  const bytes = Buffer.from(value.bits, "hex");
  return bytes.readDoubleBE(0);
}

function canonicalFloatFromNumber(value, type) {
  if (Number.isNaN(value)) return { classification: "nan", type };
  const bytes = Buffer.alloc(type === "f32" ? 4 : 8);
  if (type === "f32") bytes.writeFloatBE(value, 0);
  else bytes.writeDoubleBE(value, 0);
  return { bits: bytes.toString("hex"), type };
}

function wasmLaneCount(type) {
  if (type.kind === "primitive" || type.kind === "enum") return 1;
  if (type.kind === "option") return 1 + wasmLaneCount(type.payload);
  if (type.kind === "result") return 1 + wasmLaneCount(type.payload) + wasmLaneCount(type.error);
  fail("air.v052.invocation_result_invalid", `unsupported return type '${type.canonical}'`);
}

function takeWasmLane(lanes, cursor, label) {
  if (cursor.index >= lanes.length) fail("air.v052.invocation_result_invalid", `${label} did not return enough Wasm lanes`);
  return lanes[cursor.index++];
}

function decodeScalarLane(lanes, cursor, type, label) {
  if (type.kind === "primitive") {
    const lane = takeWasmLane(lanes, cursor, label);
    if (type.canonical === "i32") return lane;
    if (type.canonical === "bool") return lane === 1;
    if (type.canonical === "i64") return { decimal: String(lane), type: "i64" };
    return canonicalFloatFromNumber(lane, type.canonical);
  }
  if (type.kind === "enum") return { discriminant: takeWasmLane(lanes, cursor, label), type: type.canonical };
  fail("air.v052.invocation_result_invalid", `${label} has a non-scalar Wasm lane`);
}

function decodeFromWasm(lanes, cursor, typeText, enumContext, label) {
  const type = parseTypeReference(typeText);
  let value;
  if (type.kind === "primitive" || type.kind === "enum") {
    value = decodeScalarLane(lanes, cursor, type, label);
  } else if (type.kind === "option") {
    const tag = takeWasmLane(lanes, cursor, label);
    // Inactive sum lanes are canonical zero bytes, not active typed values.
    // Decode before validation so an enum that has no case zero is still a
    // valid inactive lane.
    const payload = decodeScalarLane(lanes, cursor, type.payload, `${label}.payload`);
    if (tag === 0) {
      assertZeroValue(payload, type.payload.canonical, `${label}.inactive_payload`);
      value = { tag: "none", type: type.canonical };
    } else if (tag === 1) value = { tag: "some", type: type.canonical, value: payload };
    else fail("air.v052.invocation_result_invalid", `${label} option tag is invalid`);
  } else if (type.kind === "result") {
    const tag = takeWasmLane(lanes, cursor, label);
    const payload = decodeScalarLane(lanes, cursor, type.payload, `${label}.payload`);
    const error = decodeScalarLane(lanes, cursor, type.error, `${label}.error`);
    if (tag === 0) {
      assertZeroValue(error, type.error.canonical, `${label}.inactive_error`);
      value = { tag: "ok", type: type.canonical, value: payload };
    } else if (tag === 1) {
      assertZeroValue(payload, type.payload.canonical, `${label}.inactive_payload`);
      value = { error, tag: "err", type: type.canonical };
    } else fail("air.v052.invocation_result_invalid", `${label} result tag is invalid`);
  } else {
    fail("air.v052.invocation_result_invalid", `${label} has an unsupported return type`);
  }
  try {
    return typedValue(value, label, enumContext, type.canonical);
  } catch (error) {
    if (error && error.code) throw error;
    fail("air.v052.invocation_result_invalid", `${label} does not satisfy the verified return type`);
  }
}

function assertZeroValue(value, typeText, label) {
  const type = parseTypeReference(typeText);
  if (type.kind === "primitive") {
    if ((type.canonical === "i64" && value.decimal === "0") ||
        (type.canonical === "bool" && value === false) ||
        ((type.canonical === "i32" || type.canonical === "f32" || type.canonical === "f64") && isCanonicalNumericZero(value))) return;
  }
  if (type.kind === "enum" && value && value.discriminant === 0) return;
  fail("air.v052.invocation_result_invalid", `${label} must use a canonical zero lane`);
}

function isCanonicalNumericZero(value) {
  if (typeof value === "number") return Object.is(value, 0);
  return value && value.bits === (value.type === "f32" ? "00000000" : "0000000000000000");
}

function normalizeWasmResults(raw, expectedLanes) {
  const lanes = expectedLanes === 1 ? [raw] : (Array.isArray(raw) ? raw : []);
  if (lanes.length !== expectedLanes) {
    fail("air.v052.invocation_result_invalid", "Wasm return lane count does not match the verified descriptor");
  }
  return lanes;
}

function invocationLaneCount(entry) {
  const input = entry.parameters.reduce((total, parameter) => total + wasmLaneCount(parseTypeReference(parameter.type)), 0);
  const returned = parseTypeReference(entry.return_type, { allowVoid: true });
  return input + (returned.kind === "void" ? 0 : wasmLaneCount(returned));
}

function invokeInstantiatedExport(record, instance, exportName, args = [], maxInvocationLanes) {
  const entry = interfaceExport(record, exportName);
  if (maxInvocationLanes !== undefined) {
    enforceWorkLimit(
      "air.v052.work_limit_invocation_lanes",
      invocationLaneCount(entry),
      maxInvocationLanes,
      "invocation ABI lanes"
    );
  }
  const enumContext = enumSchemaContextFromDescriptor(record.descriptor);
  const wasmArgs = normalizeArguments(entry, args, enumContext);
  const exported = instance && instance.exports && instance.exports[entry.function];
  if (typeof exported !== "function") {
    fail("air.v052.verified_build_descriptor_mismatch", `descriptor function '${entry.function}' is unavailable from verified Wasm`);
  }
  let raw;
  try {
    raw = exported(...wasmArgs);
  } catch (error) {
    // The typed-v0.53 adapter (slice text §4.4 A-1, A-2): the registry value of
    // this fresh instance; typed-v0.51 keeps the numeric mapping (A-5).
    if (record.schema === VERIFIED_TYPED_V053_BUILD_SCHEMA) {
      const identity = typedV053FailureIdentity(error, instance);
      if (identity) {
        const failure = new V052VerifiedBuildError(identity.code, identity.reason || typedV053FailureMessage(identity));
        if (identity.reason) failure.reason = identity.reason;
        if (identity.disposition) failure.disposition = identity.disposition;
        failure.failureReason = identity.value;
        throw failure;
      }
      fail("air.v052.invocation_runtime_failure", "verified Wasm trapped during checked invocation");
    }
    const reason = checkedNumericFailureReason(error, instance);
    if (reason) {
      const failure = new V052VerifiedBuildError("air.numeric.checked_failure", reason);
      failure.reason = reason;
      throw failure;
    }
    fail("air.v052.invocation_runtime_failure", "verified Wasm trapped during checked invocation");
  }
  const returnType = parseTypeReference(entry.return_type, { allowVoid: true });
  if (returnType.kind === "void") return { kind: CHECKED_TYPED_INVOCATION_KIND, value: null };
  const lanes = normalizeWasmResults(raw, wasmLaneCount(returnType));
  const cursor = { index: 0 };
  const value = decodeFromWasm(lanes, cursor, returnType.canonical, enumContext, "result");
  if (cursor.index !== lanes.length) fail("air.v052.invocation_result_invalid", "Wasm returned extra lanes");
  return { kind: CHECKED_TYPED_INVOCATION_KIND, value };
}

function typedV053FailureMessage(identity) {
  if (identity.code === "air.runtime.trap_unclassified") return "verified Wasm trapped with failure reason 0 (implementation defect)";
  if (identity.code === "air.runtime.failure_reason_unknown") return `failure reason ${identity.value} is not in the registry`;
  return `typed-v0.53 failure reason ${identity.value}`;
}

async function invokeVerifiedTypedExport(build, exportName, args = []) {
  const { record, wasmBytes } = assertTrustedBuild(build);
  refuseBorrowedLane(build);
  let instance;
  try {
    const instantiated = await WebAssembly.instantiate(wasmBytes, {});
    instance = instantiated.instance || instantiated;
  } catch (error) {
    fail("air.v052.verified_build_wasm_mismatch", "verified Wasm artifact cannot be instantiated");
  }
  return invokeInstantiatedExport(record, instance, exportName, args);
}

function normalizeRuntimeBuildRequest(input, limits, analysisCapacity, closureLimits) {
  requireRuntimeObject(input, "runtime build input");
  // typed-v0.53 requests also accept the candidate opt-in (slice text R-1);
  // a typed-v0.51 request keeps its key set and behaviour.
  const typedV053 = input.sourceProfile === SOURCE_PROFILE_TYPED_V053;
  requireNoUnknownKeys(
    input,
    typedV053
      ? ["allowCandidateProfile", "buildOptions", "descriptor", "modules", "source", "sourceName", "sourceProfile"]
      : ["buildOptions", "descriptor", "source", "sourceName", "sourceProfile"],
    "runtime build input"
  );
  if (typedV053) {
    try {
      normalizeSourceProfile(SOURCE_PROFILE_TYPED_V053, { allowCandidateProfile: input.allowCandidateProfile });
    } catch (error) { throwBuildSourceError(error, "parse"); }
  }
  const source = requireAsciiText(input.source, "source");
  const sourceName = input.sourceName === undefined ? "<typed-source>" : input.sourceName;
  if (typeof sourceName !== "string" || !sourceName) {
    fail("air.v052.runtime_input_invalid", "sourceName must be non-empty text when provided");
  }
  // P0-09 (P9-R26): with `modules`, sourceName is the root's key and is kept
  // for resolution and positions.
  const modules = typedV053 && input.modules !== undefined ? input.modules : undefined;
  if (modules !== undefined) typedClosure.validateModuleMap(modules, input.sourceName, limits.maxSourceNameBytes, "air.v052.runtime_input_invalid", fail);
  const rootName = modules !== undefined ? sourceName : "<typed-source>";
  let reached = null;
  const sourceProfile = input.sourceProfile === undefined
    ? SOURCE_PROFILE_TYPED_V051
    : input.sourceProfile;
  if (!typedV053 && !isTypedSourceProfile(sourceProfile)) {
    fail("air.v052.verified_build_profile_invalid", "runtime build requires source profile typed-v0.51");
  }
  const buildOptions = input.buildOptions === undefined ? {} : input.buildOptions;
  requireRuntimeObject(buildOptions, "buildOptions");
  requireNoUnknownKeys(buildOptions, [], "buildOptions");
  enforceWorkLimit(
    "air.v052.work_limit_source_bytes",
    Buffer.byteLength(source, "utf8"),
    limits.maxSourceBytes,
    "source bytes"
  );
  enforceWorkLimit(
    "air.v052.work_limit_source_name_bytes",
    Buffer.byteLength(sourceName, "utf8"),
    limits.maxSourceNameBytes,
    "sourceName bytes"
  );
  if (typedV053) {
    // End of phase A on every build request, before the compile cache is
    // consulted (slice text R-13): a result cached under a larger capacity is
    // never served to a request that this runtime's capacity refuses.
    let mod;
    try {
      mod = parserModule.typedV053.parse(source, rootName);
    } catch (error) { throwBuildSourceError(error, "parse"); }
    enforceWorkLimit("air.v052.work_limit_ast_nodes", structuredObjectCount(mod), limits.maxAstNodes, "parsed AST nodes");
    // P0-09 (P9-R26a): the whole closure is read in phase A, before the cache.
    // P0-10 (P10-R28; AD-P10-12 (a)): without `modules`, a sourceName of the
    // module-key form keys the root for resolution only, so every root `use`
    // resolves as on the direct builder (a self-import is a cycle); the root's
    // name and the cache key stay `<typed-source>`, and a root intake failure
    // is relabelled so after the base's unwrapping.
    const intakeKey = modules === undefined && typedRootKey(sourceName, limits.maxSourceNameBytes) ? sourceName : rootName;
    try {
      reached = loadTypedBuildClosure(mod, source, modules, intakeKey, { analysisCapacity, closureLimits, limits });
    } catch (error) {
      if (intakeKey !== rootName && error instanceof V052VerifiedBuildError && error.loc && error.loc.file === intakeKey) {
        error.loc = { ...error.loc, file: rootName };
      }
      throw error;
    }
    typedClosure.enforceCapacity(mod, analysisCapacity);
    // P0-08 (P8-R15, P8-R24): a borrowed-lane module is invoked only through
    // the typed admission. Its static failures come first; then a descriptor
    // of another lane keeps the builder's code (V53-MEM-N14), and the v2
    // descriptor is refused by this runtime.
    // P0-10 (P10-R17): so is a contract artifact with a host import.
    if (typedBorrowed.moduleUsesBorrowedSlices(mod) || typedHostImportNames(mod).length) {
      try {
        verifierModule.typedV053.verify(mod);
      } catch (error) { rethrowCodedSourceError(error, "verify"); }
      if (isTypedBorrowedDescriptor(input.descriptor)) {
        fail("air.assurance.profile_unsupported", "a typed-v0.53 contract module (a borrowed export or a host import) is invoked only through the typed admission (admitTypedV053Artifact)");
      }
      validateTypedBorrowedDescriptor(input.descriptor, mod);
    }
  }
  enforceStructuredInputLimit(input.descriptor, limits.maxDescriptorBytes, "descriptor input bytes");
  const descriptor = normalizeTypedInterfaceDescriptor(input.descriptor);
  enforceWorkLimit(
    "air.v052.work_limit_descriptor_bytes",
    Buffer.byteLength(canonicalDescriptor(descriptor), "utf8"),
    limits.maxDescriptorBytes,
    "canonical descriptor bytes"
  );
  const toolchain = pinnedToolchainIdentity();
  // P0-09 (P9-R26a): with `modules`, the key also covers every module the
  // closure intake reached, by key and raw-bytes digest; map entries the
  // closure does not reach do not change it. Without `modules` the record is
  // the base's, byte for byte.
  const closureModules = modules === undefined ? null : (reached
    ? reached.order.slice().sort().map((key) => ({ key, sourceDigest: typedClosure.sourceDigest(reached.records.get(key).source) }))
    : [{ key: rootName, sourceDigest: digestBytes(Buffer.from(source, "utf8")) }]);
  const keyRecord = deepFreeze({
    buildOptions: {},
    ...(closureModules ? { closureDigest: digestCanonical({ modules: closureModules }) } : {}),
    compilerImplementationDigest: toolchain.implementationDigest,
    descriptorDigest: descriptorDigest(descriptor),
    schema: VERIFIED_TYPED_RUNTIME_CACHE_KEY_SCHEMA,
    sourceDigest: digestBytes(Buffer.from(source, "utf8")),
    sourceProfile: typedV053 ? SOURCE_PROFILE_TYPED_V053 : SOURCE_PROFILE_TYPED_V051
  });
  return {
    // sourceName is non-semantic display metadata. A fixed internal name also
    // prevents one single-flight caller's path from leaking to another caller.
    // With `modules` it is the root's key (P9-R26).
    buildInput: typedV053
      ? { allowCandidateProfile: true, buildOptions: {}, descriptor, ...(modules !== undefined ? { modules: Object.freeze({ ...modules }) } : {}), source, sourceName: rootName, sourceProfile }
      : { buildOptions: {}, descriptor, source, sourceName: "<typed-source>", sourceProfile },
    key: digestCanonical(keyRecord),
    keyRecord
  };
}

function createVerifiedTypedRuntime(options) {
  requireRuntimeObject(options, "runtime options");
  requireNoUnknownKeys(options, ["admit", "analysisCapacity", "closureLimits", "limits"], "runtime options");
  if (typeof options.admit !== "function") {
    fail("air.v052.runtime_input_invalid", "runtime admit callback is required");
  }
  const admit = options.admit;
  const limits = normalizeRuntimeLimits(options.limits);
  // P0-09 (P9-R26): this runtime's closure limits, for typed-v0.53 requests;
  // not part of `limits`, whose key set is pinned.
  const closureLimits = typedClosure.normalizeClosureLimits(options.closureLimits, fail);
  // PS-1 (slice text R-12, R-13): the analysis capacity of this runtime
  // instance, applied to typed-v0.53 requests only. It is not part of the
  // `limits` object, whose key set is pinned.
  let analysisCapacity;
  try {
    analysisCapacity = normalizeAnalysisCapacity(options.analysisCapacity);
  } catch (error) { throwBuildSourceError(error, "parse"); }
  const toolchain = pinnedToolchainIdentity();
  const cache = new Map();
  const inFlight = new Map();
  const handles = new WeakMap();
  let cacheBytes = 0;
  let cacheGeneration = 0;
  const counters = {
    admissionChecks: 0,
    admissionDenials: 0,
    buildRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    compilations: 0,
    evictions: 0,
    instantiations: 0,
    invalidations: 0,
    invocationRequests: 0,
    singleFlightJoins: 0,
    successfulInvocations: 0
  };

  async function requireAdmission(phase, identity, context) {
    counters.admissionChecks += 1;
    const request = deepFreeze({
      artifactDigest: identity.artifactDigest || null,
      compilerImplementationDigest: identity.compilerImplementationDigest,
      descriptorDigest: identity.descriptorDigest,
      phase,
      sourceDigest: identity.sourceDigest,
      sourceProfile: identity.sourceProfile
    });
    let admitted = false;
    try {
      admitted = await admit(request, context);
    } catch (_) {
      admitted = false;
    }
    if (admitted !== true) {
      counters.admissionDenials += 1;
      fail("air.v052.runtime_admission_denied", "host admission denied the runtime operation");
    }
  }

  function touch(entry) {
    if (cache.get(entry.key) !== entry) return false;
    cache.delete(entry.key);
    cache.set(entry.key, entry);
    return true;
  }

  function evictFor(incomingBytes) {
    enforceWorkLimit(
      "air.v052.work_limit_cache_bytes",
      incomingBytes,
      limits.maxCacheBytes,
      "single cached Wasm input"
    );
    while (cache.size >= limits.maxCacheEntries || cacheBytes + incomingBytes > limits.maxCacheBytes) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = cache.get(oldestKey);
      cache.delete(oldestKey);
      cacheBytes -= oldest.wasmBytes;
      counters.evictions += 1;
    }
  }

  function publicHandle(entry) {
    const handle = deepFreeze({
      artifactDigest: entry.artifactDigest,
      compiler: copyDescriptorData(entry.record.compiler),
      descriptorDigest: entry.record.descriptorDigest,
      kind: VERIFIED_TYPED_RUNTIME_BUILD_KIND,
      lowering: copyDescriptorData(entry.record.lowering),
      schema: VERIFIED_TYPED_RUNTIME_BUILD_SCHEMA,
      sourceDigest: entry.record.sourceDigest,
      sourceProfile: entry.record.sourceProfile,
      wasmDigest: entry.record.wasmDigest
    });
    handles.set(handle, { artifactDigest: entry.artifactDigest, key: entry.key, token: entry.token });
    HANDLE_WORKBOUND.set(handle, entry.workBound);
    return handle;
  }

  function trustedEntry(handle) {
    const authority = handles.get(handle);
    if (!authority) {
      fail("air.v052.runtime_handle_untrusted", "runtime operation requires an unmodified handle from this runtime");
    }
    const entry = cache.get(authority.key);
    if (!entry || entry.token !== authority.token || entry.artifactDigest !== authority.artifactDigest) {
      fail("air.v052.runtime_handle_stale", "runtime handle is stale or its cached module was invalidated");
    }
    return entry;
  }

  async function compileEntry(request, generation) {
    const build = await buildVerifiedTypedModuleInternal(request.buildInput, { analysisCapacity, closureLimits, limits });
    const trusted = assertTrustedBuild(build);
    refuseBorrowedLane(build);
    let module;
    try {
      module = await WebAssembly.compile(trusted.wasmBytes);
    } catch (_) {
      fail("air.v052.verified_build_wasm_mismatch", "verified Wasm artifact cannot be compiled");
    }
    counters.compilations += 1;
    const entry = Object.freeze({
      artifactDigest: build.artifactDigest,
      key: request.key,
      module,
      record: trusted.record,
      token: Object.freeze({}),
      wasmBytes: trusted.wasmBytes.length,
      workBound: BUILDS.get(build).workBound
    });
    if (generation !== cacheGeneration) {
      fail("air.v052.runtime_handle_stale", "runtime cache was cleared while the module was compiling");
    }
    evictFor(entry.wasmBytes);
    cache.set(entry.key, entry);
    cacheBytes += entry.wasmBytes;
    return entry;
  }

  async function build(input, admissionContext) {
    counters.buildRequests += 1;
    const request = normalizeRuntimeBuildRequest(input, limits, analysisCapacity, closureLimits);
    let entry = cache.get(request.key);
    await requireAdmission("build", {
      ...request.keyRecord,
      artifactDigest: entry ? entry.artifactDigest : null
    }, admissionContext);
    if (entry) {
      if (cache.get(request.key) !== entry) entry = null;
    }
    if (entry) {
      counters.cacheHits += 1;
      touch(entry);
      return publicHandle(entry);
    }
    let pending = inFlight.get(request.key);
    if (pending) {
      counters.singleFlightJoins += 1;
    } else {
      if (inFlight.size >= limits.maxConcurrentBuilds) {
        fail("air.v052.work_limit_concurrent_builds", "concurrent unique runtime builds exceed the configured limit");
      }
      counters.cacheMisses += 1;
      pending = compileEntry(request, cacheGeneration);
      inFlight.set(request.key, pending);
      pending.finally(() => inFlight.delete(request.key)).catch(() => {});
    }
    entry = await pending;
    await requireAdmission("build_completion", {
      ...request.keyRecord,
      artifactDigest: entry.artifactDigest
    }, admissionContext);
    if (cache.get(request.key) !== entry) {
      fail("air.v052.runtime_handle_stale", "compiled runtime module was evicted before admission completed");
    }
    touch(entry);
    return publicHandle(entry);
  }

  async function invoke(handle, exportName, args = [], admissionContext) {
    counters.invocationRequests += 1;
    const entry = trustedEntry(handle);
    await requireAdmission("invoke", {
      artifactDigest: entry.artifactDigest,
      compilerImplementationDigest: entry.record.compiler.implementationDigest,
      descriptorDigest: entry.record.descriptorDigest,
      sourceDigest: entry.record.sourceDigest,
      sourceProfile: entry.record.sourceProfile
    }, admissionContext);
    if (cache.get(entry.key) !== entry) {
      fail("air.v052.runtime_handle_stale", "runtime module was invalidated before invocation");
    }
    const declaredExport = interfaceExport(entry.record, exportName);
    enforceWorkLimit(
      "air.v052.work_limit_invocation_lanes",
      invocationLaneCount(declaredExport),
      limits.maxInvocationLanes,
      "invocation ABI lanes"
    );
    let instance;
    try {
      instance = new WebAssembly.Instance(entry.module, {});
    } catch (_) {
      fail("air.v052.verified_build_wasm_mismatch", "cached verified module cannot be instantiated");
    }
    counters.instantiations += 1;
    const result = invokeInstantiatedExport(
      entry.record,
      instance,
      exportName,
      args,
      limits.maxInvocationLanes
    );
    counters.successfulInvocations += 1;
    touch(entry);
    return result;
  }

  function invalidate(handle) {
    const entry = trustedEntry(handle);
    cache.delete(entry.key);
    cacheBytes -= entry.wasmBytes;
    counters.invalidations += 1;
    return true;
  }

  function clear() {
    cacheGeneration += 1;
    counters.invalidations += cache.size;
    cache.clear();
    cacheBytes = 0;
  }

  function inspect() {
    return deepFreeze({
      cache: { bytes: cacheBytes, entries: cache.size, inFlight: inFlight.size },
      compiler: { implementationDigest: toolchain.implementationDigest, name: "airc", version: AIR_VERSION },
      counters: { ...counters },
      kind: "air.verifiedRuntimeStatus",
      limits: { ...limits },
      schema: VERIFIED_TYPED_RUNTIME_STATUS_SCHEMA
    });
  }

  return Object.freeze({ build, clear, inspect, invalidate, invoke });
}

// P0-08 (R-ABI53-3a): the T1 record of a borrowed-lane build, read by the
// typed admission from this private state by the build object's identity;
// null for anything else (the admission then refuses it as untrusted).
function readBorrowedLaneRecord(candidate) {
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return null;
  const state = BUILDS.get(candidate);
  if (state) return state.borrowedLane || null;
  return HARNESS_RECORDS.get(candidate) || null;
}

// Test-only builder-defect seam (docs/v0.53/TYPED_MEMORY.md; V53-MEM-N23,
// N38, V53-ABI-42, -58, -64 (c)): mints a T1 record that a defective builder
// could have produced, from a real borrowed-lane build, with the artifact
// bytes and/or the owned range replaced. Non-enumerable, never in index.js.
const HARNESS_RECORDS = new WeakMap();

function mintHarnessRecord(options = {}) {
  const base = readBorrowedLaneRecord(options.from);
  if (!base || !BUILDS.has(options.from)) fail("air.v052.runtime_input_invalid", "harness record requires a borrowed-lane build");
  const wasmBytes = options.wasmBytes === undefined ? base.wasmBytes : Buffer.from(options.wasmBytes);
  const range = options.ownedRange === undefined ? base.ownedRange : options.ownedRange;
  if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) {
    fail("air.v052.runtime_input_invalid", "harness ownedRange must have integer start and end");
  }
  const token = Object.freeze({ kind: "air.v053.harnessRecord" });
  HARNESS_RECORDS.set(token, Object.freeze({
    ...base,
    ownedRange: Object.freeze({ end: range.end, start: range.start }),
    wasmBytes: Buffer.from(wasmBytes),
    wasmDigest: digestBytes(wasmBytes)
  }));
  return token;
}

function inspectVerifiedTypedBuild(build) {
  const { record, wasmBytes } = assertTrustedBuild(build);
  return Object.freeze({ ...copyDescriptorData(record), artifactDigest: digestCanonical(record), wasmBytes: Buffer.from(wasmBytes) });
}

module.exports = {
  CHECKED_TYPED_INVOCATION_KIND,
  LOWERING_ID,
  VERIFIED_TYPED_BUILD_KIND,
  VERIFIED_TYPED_BUILD_SCHEMA,
  VERIFIED_TYPED_RUNTIME_BUILD_KIND,
  VERIFIED_TYPED_RUNTIME_BUILD_SCHEMA,
  VERIFIED_TYPED_RUNTIME_CACHE_KEY_SCHEMA,
  VERIFIED_TYPED_RUNTIME_LIMITS,
  VERIFIED_TYPED_RUNTIME_STATUS_SCHEMA,
  V052VerifiedBuildError,
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime,
  enforceVerifiedTypedBuildLimit,
  inspectVerifiedTypedBuild,
  invokeVerifiedTypedExport,
  verifiedTypedAstNodeCount
};
// P0-10 (P10-R13, P10-R14, P10-R16; OD-P10-2 (a)): the typed admission's
// value rules for a host import, used by src/borrowed_memory_binding.js. A
// handler's result is validated against its registry type before it reaches
// Wasm and is never coerced (the JS-API conversions are not relied on). A
// native promise, resolved or not, fails as import_failed: it is detected
// without reading a property and marked handled with the intrinsic `then`
// captured here, inside a try, so its rejection never reaches
// unhandledRejection; a marking that throws is discarded and the call still
// fails. Any other object, a thenable included, is result_invalid, unread.
const INTRINSIC_PROMISE_THEN = Promise.prototype.then;
const { isPromise } = require("util").types;
const TYPED_I64_MIN = -(2n ** 63n);
const TYPED_I64_MAX = 2n ** 63n - 1n;

function typedHostResult(type, value) {
  if (isPromise(value)) {
    try {
      INTRINSIC_PROMISE_THEN.call(value, undefined, () => {});
    } catch (_) {
      // P10-R14: host code ran during the marking and threw; the call fails anyway.
    }
    return Object.freeze({ code: "air.host.import_failed", ok: false });
  }
  const accepted =
    type === "i32" ? typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
      : type === "bool" ? value === 0 || value === 1
        : type === "void" ? value === undefined
          : type === "i64" ? typeof value === "bigint" && value >= TYPED_I64_MIN && value <= TYPED_I64_MAX
            : type === "f32" ? typeof value === "number" && (Number.isNaN(value) || Object.is(Math.fround(value), value))
              : false;
  return accepted ? Object.freeze({ ok: true, value }) : Object.freeze({ code: "air.host.result_invalid", ok: false });
}

// A (ptr, cap) window: a fresh array of exactly cap bytes copied out of the
// instance memory, never a view of it; null when the window is not inside the
// memory. Written back only on a valid result, and only into a writable view.
function typedHostWindowIn(memory, pointer, capacity) {
  const buffer = memory.buffer;
  if (!Number.isInteger(pointer) || !Number.isInteger(capacity) || pointer < 0 || capacity < 0 || pointer + capacity > buffer.byteLength) return null;
  return new Uint8Array(buffer.slice(pointer, pointer + capacity));
}

function typedHostWindowOut(memory, pointer, capacity, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== capacity) return;
  new Uint8Array(memory.buffer, pointer, capacity).set(bytes);
}

// P0-08 typed borrowed lane (T1 reader, test seam, backing limit); not part
// of the enumerable exports that src/index.js spreads.
Object.defineProperty(module.exports, "typedV053", {
  enumerable: false,
  value: Object.freeze({
    MEMORY_BACKING_LIMIT: TYPED_V053_MEMORY_BACKING_LIMIT,
    hostResult: typedHostResult,
    hostWindowIn: typedHostWindowIn,
    hostWindowOut: typedHostWindowOut,
    mintHarnessRecord,
    readBorrowedLaneRecord
  })
});
