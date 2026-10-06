"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  airOwnedMemoryRange,
  borrowedOverlapAllowed,
  borrowedRangesOverlap,
  borrowedSliceInterfaceDescriptor,
  rangeIntersectsAirOwnedMemory
} = require("./borrowed_slices");
const { lowerToWat, watToWasm } = require("./lower_wasm");
const { validatePackageManifest, normalizePackageMetadata } = require("./package_manifest");
const { parseAir } = require("./parser");
const { assertRealtimeSafeProfile, validateVerifiedResourceCertificate, verifyModule } = require("./verifier");

const SESSION_KIND = "air.verifiedExecutionSession";
const SESSION_SCHEMA_VERSION = "0.50";
const SESSION_HASH_DOMAIN = "AIR_VERIFIED_EXECUTION_SESSION_V1";
const SESSION_OPTION_KEYS = new Set([
  "arguments",
  "entrypoint",
  "memoryPlan",
  "packageDir",
  "resourceCertificate"
]);
const MEMORY_PLAN_KEYS = new Set([
  "access",
  "actualLength",
  "aliasGroup",
  "alignment",
  "byteOffset",
  "maxLength",
  "memoryDomain",
  "transferMode"
]);
const FAILURE_CODES = Object.freeze({
  none: 0,
  closed: 1,
  nested_or_concurrent: 2,
  configuration_changed: 3,
  memory_changed: 4,
  runtime_trap: 5,
  unexpected_runtime_error: 6
});

class VerifiedExecutionSessionError extends Error {
  constructor(code, message, compactCode = FAILURE_CODES.configuration_changed) {
    super(`${code}: ${message}`);
    this.name = "VerifiedExecutionSessionError";
    this.code = code;
    this.compactCode = compactCode;
  }
}

async function createVerifiedExecutionSession(options) {
  requirePlainObject(options, "options");
  rejectUnknownKeys(options, SESSION_OPTION_KEYS, "options");
  const base = path.resolve(requireString(options.packageDir, "options.packageDir"));
  const packageManifest = validatePackageManifest(base, { built: true });
  const metadata = normalizePackageMetadata(packageManifest);
  if (!metadata.executionProfile || metadata.executionProfile.mode !== "realtime_safe") {
    sessionFail("air.realtime.profile_missing", "package must declare executionProfile.mode realtime_safe");
  }
  if (options.entrypoint !== undefined && options.entrypoint !== metadata.executionProfile.entrypoint) {
    sessionFail("air.realtime.entrypoint_mismatch", "requested entrypoint does not match the verified profile");
  }
  const { checkPackageDir, instantiateAirModule } = require("./sdk");
  const packageReport = checkPackageDir(base, {
    built: true,
    certificateRequired: true
  });
  if (packageReport.status === "fail") {
    sessionFail(
      "air.realtime.package_verification_failed",
      firstFailure(packageReport) || "package verification failed"
    );
  }
  const generatedCertificate = packageReport.resourceCertificate;
  requirePlainObject(options.resourceCertificate, "options.resourceCertificate");
  const suppliedCertificate = options.resourceCertificate;
  if (!generatedCertificate ||
      suppliedCertificate.certificateDigest !== generatedCertificate.certificateDigest ||
      stableStringify(suppliedCertificate) !== stableStringify(generatedCertificate)) {
    sessionFail(
      "air.realtime.certificate_substitution",
      "resource certificate does not match the exact verified package"
    );
  }
  const certificateValidation = validateVerifiedResourceCertificate(suppliedCertificate, {
    required: true,
    packageDigest: generatedCertificate.package.digest,
    certificateDigest: generatedCertificate.certificateDigest
  });
  if (!certificateValidation.ok) {
    sessionFail("air.realtime.certificate_invalid", "resource certificate validation failed");
  }
  const sourcePath = path.join(base, metadata.entry);
  const source = fs.readFileSync(sourcePath, "utf8");
  const mod = parseAir(source, sourcePath);
  verifyModule(mod);
  const profileValidation = assertRealtimeSafeProfile(
    mod,
    metadata.executionProfile,
    suppliedCertificate
  );
  const expectedWasm = await watToWasm(lowerToWat(mod), sourcePath);
  const wasmPath = path.join(base, metadata.wasm);
  const wasm = fs.readFileSync(wasmPath);
  if (!Buffer.from(expectedWasm).equals(wasm)) {
    sessionFail(
      "air.realtime.wasm_source_mismatch",
      "package Wasm does not match deterministic lowering of the verified source"
    );
  }
  const instance = await instantiateAirModule({
    wasmBytes: wasm,
    packageDigest: suppliedCertificate.package.digest,
    imports: {}
  });
  const memory = requireExportedMemory(instance);
  const interfaceDescriptor = borrowedSliceInterfaceDescriptor(mod);
  const entry = requireInterfaceEntry(
    interfaceDescriptor,
    metadata.executionProfile.entrypoint
  );
  const plan = normalizeMemoryPlan(
    options.memoryPlan,
    entry,
    memory,
    metadata.executionProfile.stateParameters
  );
  rejectAirOwnedMemoryOverlap(instance, plan.records);
  const scalarArguments = normalizeScalarArguments(options.arguments, entry);
  const callArguments = lowerInvocationArguments(entry, plan, scalarArguments);
  const entryFunction = instance.exports[entry.name];
  if (typeof entryFunction !== "function") {
    sessionFail("air.realtime.entrypoint_missing", `missing Wasm export '${entry.name}'`);
  }
  requireBorrowedFeatureMarker(instance);
  const initialBuffer = memory.buffer;
  const initialByteLength = initialBuffer.byteLength;
  const warmSnapshot = new Uint8Array(initialBuffer).slice();
  try {
    entryFunction(...callArguments);
  } catch (error) {
    sessionFail(
      "air.realtime.warmup_failed",
      error instanceof WebAssembly.RuntimeError ? "entrypoint rejected the fixed warmup plan" : "entrypoint warmup failed"
    );
  } finally {
    if (memory.buffer === initialBuffer && memory.buffer.byteLength === initialByteLength) {
      new Uint8Array(memory.buffer).set(warmSnapshot);
    }
  }
  if (memory.buffer !== initialBuffer || memory.buffer.byteLength !== initialByteLength) {
    sessionFail("air.realtime.memory_growth_forbidden", "memory changed during warmup");
  }
  const preparationPayload = stableObject({
    kind: SESSION_KIND,
    schemaVersion: SESSION_SCHEMA_VERSION,
    status: "prepared",
    package: {
      name: metadata.name,
      digest: suppliedCertificate.package.digest
    },
    certificateDigest: suppliedCertificate.certificateDigest,
    profile: profileValidation,
    memoryPlan: plan.records,
    memoryBytes: initialByteLength,
    warmup: "completed_outside_invocation"
  });
  const preparationEvidence = deepFreeze({
    ...preparationPayload,
    preparationDigest: hashStable(preparationPayload)
  });
  return createSessionHandle({
    entryFunction,
    callArguments,
    memory,
    initialBuffer,
    initialByteLength,
    plan,
    preparationEvidence
  });
}

function createSessionHandle(context) {
  let active = false;
  let closed = false;
  const counters = {
    invocationCount: 0,
    failureCount: 0,
    lastFailureCode: FAILURE_CODES.none,
    maximumObservedBoundedFuel: context.preparationEvidence.profile.instructionUpperBound,
    lastResult: 0
  };
  const errors = {
    closed: new VerifiedExecutionSessionError(
      "air.realtime.session_closed",
      "verified execution session is closed",
      FAILURE_CODES.closed
    ),
    nested: new VerifiedExecutionSessionError(
      "air.realtime.concurrent_invocation",
      "nested or concurrent invocation is unsupported",
      FAILURE_CODES.nested_or_concurrent
    ),
    memory: new VerifiedExecutionSessionError(
      "air.realtime.memory_changed",
      "WebAssembly memory changed after session preparation",
      FAILURE_CODES.memory_changed
    ),
    trap: new VerifiedExecutionSessionError(
      "air.realtime.runtime_trap",
      "verified entrypoint trapped",
      FAILURE_CODES.runtime_trap
    ),
    arguments: new VerifiedExecutionSessionError(
      "air.realtime.invoke_arguments_forbidden",
      "invoke accepts no dynamic arguments, callbacks, or promises",
      FAILURE_CODES.configuration_changed
    )
  };

  function recordFailure(error) {
    counters.failureCount += 1;
    counters.lastFailureCode = error.compactCode;
  }

  function invoke() {
    if (arguments.length !== 0) {
      recordFailure(errors.arguments);
      throw errors.arguments;
    }
    if (closed) {
      recordFailure(errors.closed);
      throw errors.closed;
    }
    if (active) {
      recordFailure(errors.nested);
      throw errors.nested;
    }
    if (context.memory.buffer !== context.initialBuffer ||
        context.memory.buffer.byteLength !== context.initialByteLength) {
      recordFailure(errors.memory);
      throw errors.memory;
    }
    active = true;
    try {
      const result = context.entryFunction(...context.callArguments);
      if (context.memory.buffer !== context.initialBuffer ||
          context.memory.buffer.byteLength !== context.initialByteLength) {
        recordFailure(errors.memory);
        throw errors.memory;
      }
      counters.invocationCount += 1;
      counters.lastFailureCode = FAILURE_CODES.none;
      counters.lastResult = typeof result === "number" ? result : 0;
      return result;
    } catch (error) {
      if (error === errors.memory) throw error;
      if (error === errors.nested || error === errors.closed || error === errors.arguments) {
        throw error;
      }
      if (error instanceof WebAssembly.RuntimeError) {
        recordFailure(errors.trap);
        throw errors.trap;
      }
      counters.failureCount += 1;
      counters.lastFailureCode = FAILURE_CODES.unexpected_runtime_error;
      throw error;
    } finally {
      active = false;
    }
  }

  function close() {
    if (active) {
      recordFailure(errors.nested);
      throw errors.nested;
    }
    closed = true;
  }

  function countersSnapshot() {
    return Object.freeze({
      invocationCount: counters.invocationCount,
      failureCount: counters.failureCount,
      lastFailureCode: counters.lastFailureCode,
      maximumObservedBoundedFuel: counters.maximumObservedBoundedFuel,
      lastResult: counters.lastResult,
      closed
    });
  }

  function evidence() {
    const payload = stableObject({
      kind: "air.verifiedExecutionSessionEvidence",
      schemaVersion: SESSION_SCHEMA_VERSION,
      preparationDigest: context.preparationEvidence.preparationDigest,
      counters: countersSnapshot()
    });
    return Object.freeze({
      ...payload,
      evidenceDigest: hashStable(payload)
    });
  }

  function memoryView(name) {
    const view = context.plan.views[name];
    if (!view) sessionFail("air.realtime.binding_unknown", `unknown memory binding '${name}'`);
    return view;
  }

  return Object.freeze({
    kind: SESSION_KIND,
    schemaVersion: SESSION_SCHEMA_VERSION,
    invoke,
    close,
    counters: countersSnapshot,
    evidence,
    memoryView,
    memory: context.memory,
    preparationEvidence: context.preparationEvidence
  });
}

function normalizeMemoryPlan(value, entry, memory, stateParameters) {
  requirePlainObject(value, "options.memoryPlan");
  const expected = (entry.params || []).filter((param) => param.kind === "borrowed_slice");
  const expectedNames = expected.map((param) => param.name).sort();
  const actualNames = Object.keys(value).sort();
  if (stableStringify(actualNames) !== stableStringify(expectedNames)) {
    sessionFail(
      "air.realtime.memory_plan_mismatch",
      `memoryPlan must match borrowed parameters: ${expectedNames.join(", ")}`
    );
  }
  const records = [];
  const views = Object.create(null);
  for (const param of expected) {
    const descriptor = value[param.name];
    requirePlainObject(descriptor, `options.memoryPlan.${param.name}`);
    rejectUnknownKeys(descriptor, MEMORY_PLAN_KEYS, `options.memoryPlan.${param.name}`);
    for (const field of ["byteOffset", "actualLength", "maxLength", "alignment"]) {
      requireNonNegativeInt(descriptor[field], `options.memoryPlan.${param.name}.${field}`);
    }
    if (descriptor.alignment <= 0 || descriptor.byteOffset % descriptor.alignment !== 0) {
      sessionFail("air.realtime.alignment_mismatch", `memoryPlan.${param.name} is not aligned`);
    }
    if (descriptor.access !== param.access) {
      sessionFail("air.realtime.access_mismatch", `memoryPlan.${param.name}.access must be '${param.access}'`);
    }
    if (descriptor.maxLength !== param.length.max || descriptor.actualLength < param.length.min ||
        descriptor.actualLength > descriptor.maxLength) {
      sessionFail("air.realtime.length_out_of_range", `memoryPlan.${param.name} violates verified byte bounds`);
    }
    if (descriptor.alignment !== param.alignment) {
      sessionFail("air.realtime.alignment_mismatch", `memoryPlan.${param.name}.alignment does not match the interface`);
    }
    if (descriptor.memoryDomain !== "wasm-linear" || descriptor.transferMode !== "wasm_memory_view") {
      sessionFail(
        "air.realtime.memory_mode_unsupported",
        "realtime_safe requires wasm-linear wasm_memory_view bindings"
      );
    }
    if (descriptor.aliasGroup !== null && !isStableName(descriptor.aliasGroup)) {
      sessionFail("air.realtime.alias_group_invalid", `memoryPlan.${param.name}.aliasGroup is invalid`);
    }
    const end = checkedAdd(descriptor.byteOffset, descriptor.actualLength);
    if (end > memory.buffer.byteLength) {
      sessionFail("air.realtime.memory_plan_out_of_bounds", `memoryPlan.${param.name} exceeds memory`);
    }
    const record = Object.freeze({
      name: param.name,
      access: descriptor.access,
      byteOffset: descriptor.byteOffset,
      actualLength: descriptor.actualLength,
      maxLength: descriptor.maxLength,
      alignment: descriptor.alignment,
      aliasGroup: descriptor.aliasGroup,
      memoryDomain: descriptor.memoryDomain,
      transferMode: descriptor.transferMode,
      role: stateParameters.includes(param.name) ? "state" : "data"
    });
    records.push(record);
    views[param.name] = new Uint8Array(memory.buffer, record.byteOffset, record.actualLength);
    Object.freeze(descriptor);
  }
  assertNoMutableOverlap(records);
  Object.freeze(value);
  return Object.freeze({
    records: Object.freeze(records.sort((a, b) => a.name.localeCompare(b.name))),
    views: Object.freeze(views)
  });
}

function normalizeScalarArguments(value, entry) {
  const source = value === undefined ? {} : value;
  requirePlainObject(source, "options.arguments");
  const scalarParams = (entry.params || []).filter((param) => param.kind !== "borrowed_slice");
  const expected = scalarParams.map((param) => param.name).sort();
  const actual = Object.keys(source).sort();
  if (stableStringify(expected) !== stableStringify(actual)) {
    sessionFail("air.realtime.argument_set_mismatch", `arguments must match scalar parameters: ${expected.join(", ")}`);
  }
  const out = Object.create(null);
  for (const param of scalarParams) {
    const item = source[param.name];
    if (param.type === "i32") {
      if (!Number.isInteger(item) || item < -2147483648 || item > 2147483647) {
        sessionFail("air.realtime.argument_invalid", `arguments.${param.name} must be signed i32`);
      }
    } else if (!["f32", "f64"].includes(param.type) || typeof item !== "number" || !Number.isFinite(item)) {
      sessionFail("air.realtime.argument_invalid", `arguments.${param.name} has unsupported scalar type`);
    }
    out[param.name] = item;
  }
  return Object.freeze(out);
}

function lowerInvocationArguments(entry, plan, scalarArguments) {
  const records = new Map(plan.records.map((item) => [item.name, item]));
  const out = [];
  for (const param of entry.params || []) {
    if (param.kind === "borrowed_slice") {
      const record = records.get(param.name);
      out.push(record.byteOffset, record.actualLength);
    } else {
      out.push(scalarArguments[param.name]);
    }
  }
  return Object.freeze(out);
}

// X-SND-07: realtime views must not alias memory the module itself owns.
function rejectAirOwnedMemoryOverlap(instance, records) {
  const owned = airOwnedMemoryRange(instance);
  if (!owned) {
    sessionFail("air.realtime.air_memory_layout_unknown", "Wasm does not export its AIR-owned memory range");
  }
  for (const record of records) {
    if (rangeIntersectsAirOwnedMemory(owned, record.byteOffset, record.actualLength)) {
      sessionFail(
        "air.realtime.air_owned_memory_overlap",
        `memoryPlan.${record.name} overlaps AIR-owned module memory [${owned.start}, ${owned.end})`
      );
    }
  }
}

function assertNoMutableOverlap(records) {
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const a = records[left];
      const b = records[right];
      const overlap = borrowedRangesOverlap(a.byteOffset, a.actualLength, b.byteOffset, b.actualLength);
      if (!borrowedOverlapAllowed(a.access, b.access, overlap)) {
        sessionFail("air.realtime.mutable_overlap", `memoryPlan.${a.name} overlaps memoryPlan.${b.name}`);
      }
    }
  }
}

function requireInterfaceEntry(descriptor, name) {
  if (!descriptor || descriptor.airAbi !== "0.11" || descriptor.feature !== "borrowed-slice-v1") {
    sessionFail("air.realtime.abi_feature_mismatch", "package lacks borrowed-slice-v1 interface metadata");
  }
  const entry = (descriptor.exports || []).find((item) => item.name === name);
  if (!entry) sessionFail("air.realtime.entrypoint_missing", `interface lacks export '${name}'`);
  return entry;
}

function requireBorrowedFeatureMarker(instance) {
  const marker = instance.exports.__air_abi_feature_borrowed_slice_v1;
  if (!(marker instanceof WebAssembly.Global) || marker.value !== 0x000b0001) {
    sessionFail("air.realtime.abi_feature_mismatch", "Wasm lacks borrowed-slice-v1 feature marker");
  }
}

function requireExportedMemory(instance) {
  const memory = instance && instance.exports && instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    sessionFail("air.realtime.memory_missing", "package must export WebAssembly memory");
  }
  return memory;
}

function firstFailure(report) {
  const check = (report.checks || []).find((item) => item.status === "fail");
  return check && check.message || (report.errors || [])[0] || null;
}

function rejectUnknownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) sessionFail("air.realtime.option_unknown", `${field}.${unknown[0]} is not supported`);
}

function requirePlainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    sessionFail("air.realtime.input_invalid", `${field} must be a plain object`);
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || !value) sessionFail("air.realtime.input_invalid", `${field} must be a string`);
  return value;
}

function requireNonNegativeInt(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    sessionFail("air.realtime.input_invalid", `${field} must be a non-negative safe integer`);
  }
}

function checkedAdd(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < left) {
    sessionFail("air.realtime.memory_plan_out_of_bounds", "memory-plan arithmetic overflowed");
  }
  return result;
}

function isStableName(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function sessionFail(code, message) {
  throw new VerifiedExecutionSessionError(code, message);
}

function hashStable(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${SESSION_HASH_DOMAIN}:json\0`, "utf8")
    .update(stableStringify(value), "utf8")
    .digest("hex")}`;
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

module.exports = {
  FAILURE_CODES,
  SESSION_KIND,
  SESSION_SCHEMA_VERSION,
  VerifiedExecutionSessionError,
  createVerifiedExecutionSession
};
