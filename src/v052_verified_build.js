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
const { checkedNumericFailureReason } = require("./v052_numeric_diagnostic");
const { createToolchainGuard } = require("./v052_toolchain_identity");
const {
  WorkBoundError,
  analysisError,
  analyzeVerifiedTypedModule,
  bindVerifiedTypedWorkBound,
  registerBindingReader
} = require("./workbound");
const TOOLCHAIN = createToolchainGuard(__dirname);

const VERIFIED_TYPED_BUILD_SCHEMA = "air.v052.verifiedTypedBuild/2";
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
  const expected = [
    "compiler", "descriptor", "descriptorDigest", "kind", "lowering",
    "schema", "sourceDigest", "sourceProfile", "wasmDigest"
  ];
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("air.v052.verified_build_invalid", "verified build record has missing or unknown fields");
  }
  if (record.kind !== VERIFIED_TYPED_BUILD_KIND || record.schema !== VERIFIED_TYPED_BUILD_SCHEMA) {
    fail("air.v052.verified_build_invalid", "verified build schema is invalid");
  }
  if (record.sourceProfile !== SOURCE_PROFILE_TYPED_V051 && record.sourceProfile !== SOURCE_PROFILE_TYPED_V053) {
    fail("air.v052.verified_build_invalid", "verified build source profile is invalid");
  }
  const descriptor = normalizeTypedInterfaceDescriptor(record.descriptor);
  if (record.descriptorDigest !== descriptorDigest(descriptor)) {
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
    schema: VERIFIED_TYPED_BUILD_SCHEMA,
    sourceDigest: record.sourceDigest,
    sourceProfile: record.sourceProfile,
    wasmDigest: record.wasmDigest
  };
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
  const sourceName = typeof input.sourceName === "string" && input.sourceName
    ? input.sourceName
    : "<typed-source>";
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
  try {
    enforceAnalysisCapacity(mod, analysisCapacity);
    verifierModule.typedV053.verify(mod);
  } catch (error) { rethrowCodedSourceError(error, "verify"); }
  const workBoundAnalysis = summarizeVerifiedTypedBuild(mod);
  const descriptor = validateDescriptorAgainstSource(input.descriptor, mod);
  const descriptorBytes = Buffer.byteLength(canonicalDescriptor(descriptor), "utf8");
  if (limits) {
    enforceWorkLimit("air.v052.work_limit_descriptor_bytes", descriptorBytes, limits.maxDescriptorBytes, "canonical descriptor bytes");
  }
  lowerWasmModule.typedV053.checkEngineLimits(mod);
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
    descriptorDigest: descriptorDigest(descriptor),
    kind: VERIFIED_TYPED_BUILD_KIND,
    lowering: { implementationDigest: loweringImplementationDigest(), name: LOWERING_ID },
    schema: VERIFIED_TYPED_BUILD_SCHEMA,
    sourceDigest: digestBytes(Buffer.from(source, "utf8")),
    sourceProfile: SOURCE_PROFILE_TYPED_V053,
    wasmDigest: digestBytes(wasmBytes)
  });
  const build = Object.freeze({
    ...record,
    artifactDigest: digestCanonical(record),
    wasmBytes: Buffer.from(wasmBytes)
  });
  // R-WB-20 with the typed-v0.53 profile in the key (V53-WB-ID-01).
  const workBound = bindVerifiedTypedWorkBound(workBoundAnalysis, {
    compilerImplementationDigest: record.compiler.implementationDigest,
    sourceDigest: record.sourceDigest,
    sourceProfile: record.sourceProfile
  });
  BUILDS.set(build, { record, wasmBytes: Buffer.from(wasmBytes), workBound });
  return build;
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
    wasmDigest: build.wasmDigest
  });
  if (canonical(record) !== canonical(state.record) || build.artifactDigest !== digestCanonical(state.record)) {
    fail("air.v052.verified_build_untrusted", "verified build identity was substituted");
  }
  if (!Buffer.isBuffer(build.wasmBytes) || digestBytes(build.wasmBytes) !== state.record.wasmDigest) {
    fail("air.v052.verified_build_wasm_mismatch", "Wasm bytes do not match the verified build descriptor");
  }
  if (descriptorDigest(build.descriptor) !== state.record.descriptorDigest) {
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

async function invokeVerifiedTypedExport(build, exportName, args = []) {
  const { record, wasmBytes } = assertTrustedBuild(build);
  let instance;
  try {
    const instantiated = await WebAssembly.instantiate(wasmBytes, {});
    instance = instantiated.instance || instantiated;
  } catch (error) {
    fail("air.v052.verified_build_wasm_mismatch", "verified Wasm artifact cannot be instantiated");
  }
  return invokeInstantiatedExport(record, instance, exportName, args);
}

function normalizeRuntimeBuildRequest(input, limits, analysisCapacity) {
  requireRuntimeObject(input, "runtime build input");
  // typed-v0.53 requests also accept the candidate opt-in (slice text R-1);
  // a typed-v0.51 request keeps its key set and behaviour.
  const typedV053 = input.sourceProfile === SOURCE_PROFILE_TYPED_V053;
  requireNoUnknownKeys(
    input,
    typedV053
      ? ["allowCandidateProfile", "buildOptions", "descriptor", "source", "sourceName", "sourceProfile"]
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
      mod = parserModule.typedV053.parse(source, "<typed-source>");
    } catch (error) { throwBuildSourceError(error, "parse"); }
    enforceWorkLimit("air.v052.work_limit_ast_nodes", structuredObjectCount(mod), limits.maxAstNodes, "parsed AST nodes");
    enforceAnalysisCapacity(mod, analysisCapacity);
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
  const keyRecord = deepFreeze({
    buildOptions: {},
    compilerImplementationDigest: toolchain.implementationDigest,
    descriptorDigest: descriptorDigest(descriptor),
    schema: VERIFIED_TYPED_RUNTIME_CACHE_KEY_SCHEMA,
    sourceDigest: digestBytes(Buffer.from(source, "utf8")),
    sourceProfile: typedV053 ? SOURCE_PROFILE_TYPED_V053 : SOURCE_PROFILE_TYPED_V051
  });
  return {
    // sourceName is non-semantic display metadata. A fixed internal name also
    // prevents one single-flight caller's path from leaking to another caller.
    buildInput: typedV053
      ? { allowCandidateProfile: true, buildOptions: {}, descriptor, source, sourceName: "<typed-source>", sourceProfile }
      : { buildOptions: {}, descriptor, source, sourceName: "<typed-source>", sourceProfile },
    key: digestCanonical(keyRecord),
    keyRecord
  };
}

function createVerifiedTypedRuntime(options) {
  requireRuntimeObject(options, "runtime options");
  requireNoUnknownKeys(options, ["admit", "analysisCapacity", "limits"], "runtime options");
  if (typeof options.admit !== "function") {
    fail("air.v052.runtime_input_invalid", "runtime admit callback is required");
  }
  const admit = options.admit;
  const limits = normalizeRuntimeLimits(options.limits);
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
    const build = await buildVerifiedTypedModuleInternal(request.buildInput, { analysisCapacity, limits });
    const trusted = assertTrustedBuild(build);
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
    const request = normalizeRuntimeBuildRequest(input, limits, analysisCapacity);
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
