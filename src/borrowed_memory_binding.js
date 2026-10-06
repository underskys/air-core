"use strict";

const crypto = require("crypto");
const {
  airOwnedMemoryRange,
  borrowedOverlapAllowed,
  borrowedRangesOverlap,
  rangeIntersectsAirOwnedMemory,
  classifyBorrowedRange
} = require("./borrowed_slices");

const BORROWED_MEMORY_EVIDENCE_KIND = "air.borrowedMemoryInvocationEvidence";
const BORROWED_MEMORY_EVIDENCE_SCHEMA_VERSION = "0.50";
const BORROWED_MEMORY_HASH_DOMAIN = "AIR_BORROWED_MEMORY_INVOCATION_V1";
const TRANSFER_MODES = new Set(["copied_into_wasm", "wasm_memory_view"]);
const MEMORY_DOMAIN = "wasm-linear";
const WASM_PAGE_BYTES = 65536;
const MAX_SIGNED_I32 = 0x7fffffff;
const DESCRIPTOR_KEYS = new Set([
  "access",
  "actualLength",
  "aliasGroup",
  "alignment",
  "buffer",
  "maxLength",
  "memoryDomain",
  "transferMode"
]);
const activeInstances = new WeakSet();
const instanceIdentities = new WeakMap();

class BorrowedMemoryBindingError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "BorrowedMemoryBindingError";
    this.code = code;
  }
}

function invokeBorrowedMemory(options) {
  try {
    return prepareBorrowedMemoryInvocation(options).invoke();
  } catch (error) {
    if (error instanceof BorrowedMemoryBindingError) {
      return createRejectedInvocationResult(error, options);
    }
    throw error;
  }
}

function prepareBorrowedMemoryInvocation(options = {}) {
  requirePlainObject(options, "options");
  const instance = requireInstance(options.instance);
  const memory = requireMemory(instance);
  const interfaceDescriptor = stableObject(options.interfaceDescriptor);
  const entry = normalizeInterfaceEntry(interfaceDescriptor, options.entrypoint);
  const bindings = normalizeBindings(options.bindings, entry);
  const scalarArguments = normalizeScalarArguments(options.arguments, entry);
  const identity = resolveInstanceIdentity(instance, options);
  const moduleDigest = identity.moduleDigest;
  const packageDigest = identity.packageDigest;
  const resourceCertificateDigest = normalizeCertificateDigest(options.resourceCertificate, packageDigest);
  const transferModes = new Set(bindings.map((binding) => binding.transferMode));

  if (transferModes.size > 1) {
    bindingFail(
      "air.borrow.transfer_mode_mixed_unavailable",
      "copied and Wasm-view bindings cannot share one v0.50 invocation"
    );
  }
  rejectHostOverlap(bindings);
  const entryFailure = validateEntryContracts(entry, bindings, scalarArguments);
  if (entryFailure) {
    return prepareFailedInvocation({
      bindings,
      entry,
      failure: entryFailure,
      interfaceDescriptor,
      moduleDigest,
      packageDigest,
      resourceCertificateDigest
    });
  }

  const prepared = transferModes.has("copied_into_wasm")
    ? prepareCopiedBindings(memory, bindings)
    : prepareWasmViewBindings(memory, bindings, instance);
  const wasmArguments = flattenArguments(entry, prepared.bindings, scalarArguments);
  const entrypoint = instance.exports[entry.name];
  if (typeof entrypoint !== "function") {
    bindingFail("air.borrow.entrypoint_missing", `export '${entry.name}' is not executable`);
  }
  assertRuntimeInterface(instance, entry, entrypoint);

  return createPreparedInvocation({
    entry,
    entrypoint,
    instance,
    interfaceDescriptor,
    memory,
    moduleDigest,
    packageDigest,
    prepared,
    resourceCertificateDigest,
    wasmArguments
  });
}

function createPreparedInvocation(input) {
  let invoked = false;
  let state = input;
  return Object.freeze({
    invoke() {
      if (invoked) {
        bindingFail("air.borrow.invocation_reused", "a prepared borrowed invocation may execute only once");
      }
      invoked = true;
      const current = state;
      if (activeInstances.has(current.instance)) {
        clearCopiedRanges(current.prepared.bindings, current.prepared.memoryBuffer);
        state = null;
        bindingFail("air.borrow.reentrant_invocation", "the selected instance already has an active borrowed invocation");
      }
      activeInstances.add(current.instance);

      let result;
      let inputDigests = null;
      let outputDigests = null;
      try {
        assertMemoryIdentity(current.memory, current.prepared.memoryBuffer);
        assertPreparedBuffersUsable(current.prepared.bindings);
        inputDigests = copyReadableInputs(current.prepared.bindings, current.prepared.memoryBuffer);
        result = current.entrypoint(...current.wasmArguments);
        assertMemoryIdentity(current.memory, current.prepared.memoryBuffer);
        assertPreparedBuffersUsable(current.prepared.bindings);
        outputDigests = copyMutableOutputs(current.prepared.bindings, current.prepared.memoryBuffer);
        return stableObject({
          result,
          diagnostics: [],
          evidence: createInvocationEvidence({
            entry: current.entry,
            bindings: current.prepared.bindings,
            copiedIn: true,
            inputDigests,
            interfaceDescriptor: current.interfaceDescriptor,
            moduleDigest: current.moduleDigest,
            outputDigests,
            packageDigest: current.packageDigest,
            resourceCertificateDigest: current.resourceCertificateDigest,
            result,
            status: "passed"
          })
        });
      } catch (error) {
        if (error instanceof BorrowedMemoryBindingError) throw error;
        if (!isGeneratedBorrowFailure(error)) throw error;
        const code = "air.borrow.pointer_out_of_bounds";
        const message = "generated borrowed-slice bounds check rejected the invocation";
        const diagnostics = [borrowedDiagnostic(code, message)];
        return stableObject({
          result: null,
          diagnostics,
          evidence: createInvocationEvidence({
            entry: current.entry,
            bindings: current.prepared.bindings,
            copiedIn: true,
            failureReason: code,
            inputDigests: inputDigests || emptyDigestMap(current.prepared.bindings),
            interfaceDescriptor: current.interfaceDescriptor,
            moduleDigest: current.moduleDigest,
            outputDigests: emptyDigestMap(current.prepared.bindings),
            packageDigest: current.packageDigest,
            resourceCertificateDigest: current.resourceCertificateDigest,
            result: null,
            status: "failed"
          })
        });
      } finally {
        clearCopiedRanges(current.prepared.bindings, current.prepared.memoryBuffer);
        activeInstances.delete(current.instance);
        state = null;
      }
    }
  });
}

function normalizeInterfaceEntry(descriptor, entrypointName) {
  requirePlainObject(descriptor, "interfaceDescriptor");
  if (descriptor.schema !== "air.borrowed-slice-interface.v1" ||
      descriptor.airAbi !== "0.11" ||
      descriptor.feature !== "borrowed-slice-v1" ||
      descriptor.lengthUnit !== "bytes") {
    bindingFail("air.borrow.interface_invalid", "borrowed-memory binding requires the canonical AIR ABI 0.11 interface");
  }
  if (!Array.isArray(descriptor.memoryDomains) ||
      descriptor.memoryDomains.length !== 1 ||
      descriptor.memoryDomains[0] !== MEMORY_DOMAIN) {
    bindingFail("air.borrow.memory_domain_unsupported", "the interface must select the wasm-linear memory domain");
  }
  if (typeof entrypointName !== "string" || !entrypointName) {
    bindingFail("air.borrow.entrypoint_missing", "entrypoint must name a borrowed export");
  }
  const entry = (descriptor.exports || []).find((item) => item && item.name === entrypointName);
  if (!entry) bindingFail("air.borrow.entrypoint_missing", `missing borrowed export '${entrypointName}'`);
  return entry;
}

function normalizeBindings(value, entry) {
  requirePlainObject(value, "bindings");
  const borrowedParams = (entry.params || []).filter((param) => param.kind === "borrowed_slice");
  const expectedNames = borrowedParams.map((param) => param.name).sort();
  const actualNames = Object.keys(value).sort();
  if (expectedNames.join("\0") !== actualNames.join("\0")) {
    bindingFail(
      "air.borrow.binding_set_mismatch",
      `bindings must match borrowed parameters: ${expectedNames.join(", ")}`
    );
  }
  return borrowedParams.map((param) => normalizeBindingDescriptor(value[param.name], param));
}

function normalizeBindingDescriptor(value, param) {
  requirePlainObject(value, `bindings.${param.name}`);
  rejectAccessors(value, `bindings.${param.name}`);
  rejectUnknownKeys(value, DESCRIPTOR_KEYS, `bindings.${param.name}`);
  for (const key of ["buffer", "access", "maxLength", "alignment", "aliasGroup", "memoryDomain", "transferMode"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      bindingFail("air.borrow.descriptor_invalid", `bindings.${param.name}.${key} is required`);
    }
  }

  const view = snapshotSupportedView(value.buffer, `bindings.${param.name}.buffer`);
  const actualLength = value.actualLength === undefined ? view.byteLength : value.actualLength;
  if (!Number.isSafeInteger(actualLength) || actualLength < 0 || actualLength > MAX_SIGNED_I32) {
    bindingFail(
      "air.borrow.length_out_of_range",
      `bindings.${param.name}.actualLength must be a non-negative signed i32 byte length`
    );
  }
  requireNonNegativeInt(value.maxLength, `bindings.${param.name}.maxLength`);
  requirePositiveInt(value.alignment, `bindings.${param.name}.alignment`);

  if (value.access !== param.access) {
    bindingFail("air.borrow.access_mismatch", `bindings.${param.name}.access must be '${param.access}'`);
  }
  if (value.maxLength !== param.length.max) {
    bindingFail(
      "air.borrow.max_length_mismatch",
      `bindings.${param.name}.maxLength must equal the interface maximum ${param.length.max}`
    );
  }
  if (value.alignment !== param.alignment) {
    bindingFail(
      "air.borrow.alignment_mismatch",
      `bindings.${param.name}.alignment must equal the interface alignment ${param.alignment}`
    );
  }
  if (value.memoryDomain !== MEMORY_DOMAIN) {
    bindingFail("air.borrow.memory_domain_unsupported", `bindings.${param.name}.memoryDomain must be '${MEMORY_DOMAIN}'`);
  }
  if (!TRANSFER_MODES.has(value.transferMode)) {
    bindingFail(
      "air.borrow.transfer_mode_invalid",
      `bindings.${param.name}.transferMode must be copied_into_wasm or wasm_memory_view`
    );
  }
  if (!(value.aliasGroup === null || isStableName(value.aliasGroup))) {
    bindingFail("air.borrow.alias_group_invalid", `bindings.${param.name}.aliasGroup must be null or a stable name`);
  }
  if (actualLength > view.byteLength) {
    bindingFail("air.borrow.buffer_truncated", `bindings.${param.name}.actualLength exceeds the real view extent`);
  }
  if (actualLength < param.length.min || actualLength > param.length.max || actualLength > MAX_SIGNED_I32) {
    bindingFail(
      "air.borrow.length_out_of_range",
      `bindings.${param.name}.actualLength must be in ${param.length.min}..${param.length.max}`
    );
  }
  if (view.byteOffset % param.alignment !== 0) {
    bindingFail("air.borrow.alignment_mismatch", `bindings.${param.name}.buffer byte offset is not aligned`);
  }
  if (actualLength % view.BYTES_PER_ELEMENT !== 0) {
    bindingFail("air.borrow.buffer_layout_invalid", `bindings.${param.name}.actualLength splits a typed-array element`);
  }

  const snapshot = {
    name: param.name,
    access: value.access,
    actualLength,
    maximumLength: value.maxLength,
    alignment: value.alignment,
    aliasGroup: value.aliasGroup,
    memoryDomain: value.memoryDomain,
    transferMode: value.transferMode,
    hostBuffer: view.buffer,
    hostByteOffset: view.byteOffset,
    hostByteLength: view.byteLength,
    hostViewType: view.viewType,
    wasmPointer: null
  };
  return Object.freeze(snapshot);
}

function normalizeScalarArguments(value, entry) {
  const scalarParams = (entry.params || []).filter((param) => param.kind !== "borrowed_slice");
  if (value === undefined) value = {};
  requirePlainObject(value, "arguments");
  const expectedNames = scalarParams.map((param) => param.name).sort();
  const actualNames = Object.keys(value).sort();
  if (expectedNames.join("\0") !== actualNames.join("\0")) {
    bindingFail(
      "air.borrow.argument_set_mismatch",
      `arguments must match scalar parameters: ${expectedNames.join(", ")}`
    );
  }
  const out = new Map();
  for (const param of scalarParams) {
    const item = value[param.name];
    if (param.type === "i32") {
      if (!Number.isInteger(item) || item < -0x80000000 || item > MAX_SIGNED_I32) {
        bindingFail("air.borrow.argument_invalid", `arguments.${param.name} must be a signed i32`);
      }
    } else if (param.type === "f32") {
      if (typeof item !== "number") {
        bindingFail("air.borrow.argument_invalid", `arguments.${param.name} must be a number`);
      }
    } else {
      bindingFail("air.borrow.argument_invalid", `scalar type '${param.type}' is unsupported by this binding`);
    }
    out.set(param.name, item);
  }
  return out;
}

function validateEntryContracts(entry, bindings, scalarArguments) {
  const bindingMap = new Map(bindings.map((binding) => [binding.name, binding]));
  for (const contract of entry.entryContracts || []) {
    if (contract.kind === "checked_param") {
      const value = scalarArguments.get(contract.parameter);
      const passed = contract.op === ">="
        ? value >= contract.literal
        : contract.op === "<="
          ? value <= contract.literal
          : value === contract.literal;
      if (!passed) {
        return new BorrowedMemoryBindingError(
          "air.borrow.entry_relation_failed",
          `entry contract for '${contract.parameter}' rejected the supplied value`
        );
      }
      continue;
    }
    if (contract.kind === "checked_borrow_length") {
      const value = scalarArguments.get(contract.parameter);
      const binding = bindingMap.get(contract.borrow);
      if (!Number.isInteger(contract.multiplier) || contract.multiplier <= 0 || !binding) {
        bindingFail("air.borrow.interface_invalid", "borrowed entry contract metadata is invalid");
      }
      if (value < 0 || value > Math.floor(MAX_SIGNED_I32 / contract.multiplier)) {
        return new BorrowedMemoryBindingError(
          "air.borrow.entry_arithmetic_overflow",
          `entry arithmetic for '${contract.parameter}' exceeds signed i32`
        );
      }
      if (binding.actualLength < value * contract.multiplier) {
        return new BorrowedMemoryBindingError(
          "air.borrow.entry_relation_failed",
          `binding '${contract.borrow}' is shorter than its checked entry relationship`
        );
      }
      continue;
    }
    bindingFail("air.borrow.interface_invalid", `unsupported entry contract '${contract.kind}'`);
  }
  return null;
}

function prepareFailedInvocation(input) {
  let invoked = false;
  let state = input;
  return Object.freeze({
    invoke() {
      if (invoked) {
        bindingFail("air.borrow.invocation_reused", "a prepared borrowed invocation may execute only once");
      }
      invoked = true;
      const current = state;
      try {
        const message = current.failure.message.replace(`${current.failure.code}: `, "");
        return stableObject({
          result: null,
          diagnostics: [borrowedDiagnostic(current.failure.code, message)],
          evidence: createInvocationEvidence({
            bindings: current.bindings,
            copiedIn: false,
            entry: current.entry,
            failureReason: current.failure.code,
            inputDigests: emptyDigestMap(current.bindings),
            interfaceDescriptor: current.interfaceDescriptor,
            moduleDigest: current.moduleDigest,
            outputDigests: emptyDigestMap(current.bindings),
            packageDigest: current.packageDigest,
            resourceCertificateDigest: current.resourceCertificateDigest,
            result: null,
            status: "failed"
          })
        });
      } finally {
        state = null;
      }
    }
  });
}

function prepareCopiedBindings(memory, bindings) {
  const startingSize = memory.buffer.byteLength;
  let cursor = startingSize;
  const ranges = [];
  for (const binding of bindings) {
    cursor = alignUp(cursor, binding.alignment);
    ranges.push({ binding, pointer: cursor });
    cursor = checkedAdd(cursor, binding.actualLength);
  }
  const additionalBytes = cursor - startingSize;
  if (additionalBytes > 0) {
    const pages = Math.ceil(additionalBytes / WASM_PAGE_BYTES);
    try {
      memory.grow(pages);
    } catch (_) {
      bindingFail("air.borrow.memory_capacity_exceeded", "instance memory could not reserve the copied borrowed ranges");
    }
  }
  const memoryBuffer = memory.buffer;
  const preparedBindings = ranges.map(({ binding, pointer }) => Object.freeze({
    ...binding,
    wasmPointer: pointer
  }));
  for (const binding of preparedBindings) assertRangeInMemory(binding, memoryBuffer);
  return { bindings: preparedBindings, memoryBuffer };
}

function prepareWasmViewBindings(memory, bindings, instance) {
  const memoryBuffer = memory.buffer;
  const owned = airOwnedMemoryRange(instance);
  if (!owned) {
    bindingFail(
      "air.borrow.air_memory_layout_unknown",
      "selected instance does not export its AIR-owned memory range; Wasm-view bindings are rejected"
    );
  }
  const preparedBindings = bindings.map((binding) => {
    if (binding.hostBuffer !== memoryBuffer) {
      bindingFail(
        "air.borrow.backing_identity_mismatch",
        `bindings.${binding.name}.buffer is not backed by the selected instance memory`
      );
    }
    return Object.freeze({
      ...binding,
      wasmPointer: binding.hostByteOffset
    });
  });
  for (const binding of preparedBindings) assertRangeInMemory(binding, memoryBuffer);
  for (const binding of preparedBindings) {
    if (rangeIntersectsAirOwnedMemory(owned, binding.wasmPointer, binding.actualLength)) {
      bindingFail(
        "air.borrow.air_owned_memory_overlap",
        `bindings.${binding.name} overlaps AIR-owned module memory [${owned.start}, ${owned.end})`
      );
    }
  }
  rejectWasmOverlap(preparedBindings);
  return { bindings: preparedBindings, memoryBuffer };
}

function flattenArguments(entry, bindings, scalarArguments) {
  const bindingMap = new Map(bindings.map((item) => [item.name, item]));
  const out = [];
  for (const param of entry.params || []) {
    if (param.kind === "borrowed_slice") {
      const binding = bindingMap.get(param.name);
      out.push(binding.wasmPointer, binding.actualLength);
    } else {
      out.push(scalarArguments.get(param.name));
    }
  }
  return out;
}

function copyReadableInputs(bindings, memoryBuffer) {
  const memoryBytes = new Uint8Array(memoryBuffer);
  const inputDigests = new Map();
  for (const binding of bindings) {
    if (binding.access === "writeonly") {
      inputDigests.set(binding.name, null);
      continue;
    }
    const input = currentHostBytes(binding);
    if (binding.transferMode === "copied_into_wasm") {
      memoryBytes.set(input, binding.wasmPointer);
    }
    inputDigests.set(binding.name, hashBytes(input));
  }
  return inputDigests;
}

function copyMutableOutputs(bindings, memoryBuffer) {
  const memoryBytes = new Uint8Array(memoryBuffer);
  const outputDigests = new Map();
  for (const binding of bindings) {
    if (binding.access === "readonly") {
      outputDigests.set(binding.name, null);
      continue;
    }
    const output = memoryBytes.slice(binding.wasmPointer, binding.wasmPointer + binding.actualLength);
    if (binding.transferMode === "copied_into_wasm") {
      currentHostBytes(binding).set(output);
    }
    outputDigests.set(binding.name, hashBytes(output));
  }
  return outputDigests;
}

function clearCopiedRanges(bindings, memoryBuffer) {
  if (!memoryBuffer) return;
  let memoryBytes;
  try {
    memoryBytes = new Uint8Array(memoryBuffer);
  } catch (_) {
    return;
  }
  for (const binding of bindings || []) {
    if (binding.transferMode !== "copied_into_wasm" || binding.actualLength === 0) continue;
    const end = binding.wasmPointer + binding.actualLength;
    if (end <= memoryBytes.byteLength) memoryBytes.fill(0, binding.wasmPointer, end);
  }
}

function createInvocationEvidence(input) {
  const interfaceDigest = hashStable(input.interfaceDescriptor);
  const parameters = input.bindings.map((binding) => stableObject({
    access: binding.access,
    actualLength: binding.actualLength,
    aliasGroup: binding.aliasGroup,
    alignment: {
      required: binding.alignment,
      validated: true
    },
    bytesCopiedIn: input.copiedIn &&
      binding.transferMode === "copied_into_wasm" &&
      binding.access !== "writeonly"
      ? binding.actualLength
      : 0,
    bytesCopiedOut: input.status === "passed" &&
      binding.transferMode === "copied_into_wasm" &&
      binding.access !== "readonly"
      ? binding.actualLength
      : 0,
    descriptorDigest: hashStable({
      access: binding.access,
      actualLength: binding.actualLength,
      aliasGroup: binding.aliasGroup,
      alignment: binding.alignment,
      bufferExtent: binding.hostByteLength,
      bufferType: binding.hostViewType,
      maximumLength: binding.maximumLength,
      memoryDomain: binding.memoryDomain,
      transferMode: binding.transferMode
    }),
    inputDigest: input.inputDigests.get(binding.name),
    maximumLength: binding.maximumLength,
    memoryDomain: binding.memoryDomain,
    name: binding.name,
    outputDigest: input.outputDigests.get(binding.name),
    overlapValidation: "passed",
    transferMode: binding.transferMode
  }));
  const payload = stableObject({
    schemaVersion: BORROWED_MEMORY_EVIDENCE_SCHEMA_VERSION,
    kind: BORROWED_MEMORY_EVIDENCE_KIND,
    status: input.status,
    entrypoint: input.entry.name,
    interfaceDigest,
    moduleDigest: input.moduleDigest,
    packageDigest: input.packageDigest,
    airAbi: input.interfaceDescriptor.airAbi,
    feature: input.interfaceDescriptor.feature,
    memoryDomain: MEMORY_DOMAIN,
    transferModes: Array.from(new Set(parameters.map((item) => item.transferMode))).sort(),
    validationOutcome: input.status === "passed" ? "passed" : "failed",
    failureReason: input.failureReason || null,
    parameters,
    totals: {
      actualBytes: parameters.reduce((sum, item) => sum + item.actualLength, 0),
      bytesCopiedIn: parameters.reduce((sum, item) => sum + item.bytesCopiedIn, 0),
      bytesCopiedOut: parameters.reduce((sum, item) => sum + item.bytesCopiedOut, 0)
    },
    result: {
      type: Number.isInteger(input.result) ? "i32" : "number",
      value: input.result,
      digest: hashStable(input.result)
    },
    resourceCertificateDigest: input.resourceCertificateDigest
  });
  return stableObject({
    ...payload,
    bindingDigest: hashStable({
      interfaceDigest,
      moduleDigest: input.moduleDigest,
      parameters,
      packageDigest: input.packageDigest,
      resourceCertificateDigest: input.resourceCertificateDigest,
      resultDigest: payload.result.digest
    }),
    evidenceDigest: hashStable(payload)
  });
}

function createRejectedInvocationResult(error, options) {
  const diagnostic = borrowedDiagnostic(error.code, error.message.replace(`${error.code}: `, ""));
  const interfaceDescriptor = safeStableObject(options && options.interfaceDescriptor);
  const interfaceDigest = interfaceDescriptor ? hashStable(interfaceDescriptor) : null;
  const registered = options && options.instance ? instanceIdentities.get(options.instance) : null;
  const moduleDigest = registered && registered.moduleDigest || safeIdentityDigest(options && options.moduleDigest);
  const packageDigest = registered && registered.packageDigest || safeIdentityDigest(options && options.packageDigest);
  const payload = stableObject({
    schemaVersion: BORROWED_MEMORY_EVIDENCE_SCHEMA_VERSION,
    kind: BORROWED_MEMORY_EVIDENCE_KIND,
    status: "failed",
    entrypoint: options && typeof options.entrypoint === "string" ? options.entrypoint : null,
    interfaceDigest,
    moduleDigest,
    packageDigest,
    airAbi: interfaceDescriptor && interfaceDescriptor.airAbi || null,
    feature: interfaceDescriptor && interfaceDescriptor.feature || null,
    memoryDomain: MEMORY_DOMAIN,
    transferModes: [],
    validationOutcome: "failed",
    failureReason: error.code,
    parameters: [],
    totals: {
      actualBytes: 0,
      bytesCopiedIn: 0,
      bytesCopiedOut: 0
    },
    result: {
      type: null,
      value: null,
      digest: hashStable(null)
    },
    resourceCertificateDigest: null
  });
  return stableObject({
    result: null,
    diagnostics: [diagnostic],
    evidence: {
      ...payload,
      bindingDigest: hashStable({
        failureReason: error.code,
        interfaceDigest,
        moduleDigest,
        packageDigest
      }),
      evidenceDigest: hashStable(payload)
    }
  });
}

function borrowedDiagnostic(code, message) {
  return stableObject({
    code,
    severity: "fail",
    source: "borrowed-memory-binding",
    message
  });
}

function emptyDigestMap(bindings) {
  return new Map((bindings || []).map((binding) => [binding.name, null]));
}

function isGeneratedBorrowFailure(error) {
  return error instanceof WebAssembly.RuntimeError &&
    error.message === "unreachable" &&
    typeof error.stack === "string" &&
    /\bat __air_borrow_failure\b/.test(error.stack);
}

function rejectHostOverlap(bindings) {
  for (let left = 0; left < bindings.length; left += 1) {
    for (let right = left + 1; right < bindings.length; right += 1) {
      const a = bindings[left];
      const b = bindings[right];
      if (a.hostBuffer !== b.hostBuffer) continue;
      const overlap = rangesOverlap(a.hostByteOffset, a.actualLength, b.hostByteOffset, b.actualLength);
      if (borrowedOverlapAllowed(a.access, b.access, overlap)) continue;
      bindingFail("air.borrow.mutable_overlap", `bindings.${a.name} and bindings.${b.name} overlap`);
    }
  }
}

function rejectWasmOverlap(bindings) {
  for (let left = 0; left < bindings.length; left += 1) {
    for (let right = left + 1; right < bindings.length; right += 1) {
      const a = bindings[left];
      const b = bindings[right];
      const overlap = rangesOverlap(a.wasmPointer, a.actualLength, b.wasmPointer, b.actualLength);
      if (borrowedOverlapAllowed(a.access, b.access, overlap)) continue;
      bindingFail("air.borrow.mutable_overlap", `bindings.${a.name} and bindings.${b.name} overlap`);
    }
  }
}

function rangesOverlap(aStart, aLength, bStart, bLength) {
  return borrowedRangesOverlap(aStart, aLength, bStart, bLength);
}

function assertRangeInMemory(binding, memoryBuffer) {
  const range = classifyBorrowedRange(binding.wasmPointer, binding.actualLength, {
    alignment: binding.alignment,
    limit: memoryBuffer.byteLength
  });
  if (!range.ok) {
    const detail = range.code === "air.borrow.alignment_mismatch"
      ? `bindings.${binding.name} pointer is not aligned`
      : `bindings.${binding.name} exceeds selected instance memory`;
    bindingFail(range.code, detail);
  }
}

function assertPreparedBuffersUsable(bindings) {
  for (const binding of bindings) {
    assertArrayBufferAttached(binding.hostBuffer, `bindings.${binding.name}.buffer`);
    if (binding.hostByteOffset > binding.hostBuffer.byteLength ||
        binding.hostByteLength > binding.hostBuffer.byteLength - binding.hostByteOffset) {
      bindingFail("air.borrow.buffer_stale", `bindings.${binding.name}.buffer is stale after validation`);
    }
  }
}

function assertMemoryIdentity(memory, expectedBuffer) {
  if (memory.buffer !== expectedBuffer) {
    bindingFail("air.borrow.memory_changed", "selected WebAssembly.Memory changed during the borrowed invocation");
  }
}

function currentHostBytes(binding) {
  assertPreparedBuffersUsable([binding]);
  return new Uint8Array(binding.hostBuffer, binding.hostByteOffset, binding.actualLength);
}

function snapshotSupportedView(value, field) {
  if (!(value instanceof Uint8Array) && !(value instanceof Float32Array)) {
    bindingFail("air.borrow.buffer_type_invalid", `${field} must be a Uint8Array or Float32Array`);
  }
  if (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer) {
    bindingFail("air.borrow.buffer_shared_unsupported", `${field} must not use shared memory`);
  }
  assertArrayBufferAttached(value.buffer, field);
  return Object.freeze({
    buffer: value.buffer,
    byteOffset: value.byteOffset,
    byteLength: value.byteLength,
    BYTES_PER_ELEMENT: value.BYTES_PER_ELEMENT,
    viewType: value.constructor.name
  });
}

function assertArrayBufferAttached(buffer, field) {
  try {
    ArrayBuffer.prototype.slice.call(buffer, 0, 0);
  } catch (_) {
    bindingFail("air.borrow.buffer_detached", `${field} is detached`);
  }
}

function requireInstance(instance) {
  if (!instance || typeof instance !== "object" || !instance.exports) {
    bindingFail("air.borrow.instance_invalid", "options.instance must be a WebAssembly.Instance");
  }
  return instance;
}

function requireMemory(instance) {
  const memory = instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    bindingFail("air.borrow.memory_missing", "selected instance does not export WebAssembly.Memory");
  }
  return memory;
}

function registerBorrowedMemoryInstanceIdentity(instance, identity = {}) {
  requireInstance(instance);
  const moduleDigest = normalizeIdentityDigest(identity.moduleDigest, "moduleDigest");
  const packageDigest = identity.packageDigest == null
    ? null
    : normalizeIdentityDigest(identity.packageDigest, "packageDigest");
  instanceIdentities.set(instance, Object.freeze({ moduleDigest, packageDigest }));
}

function resolveInstanceIdentity(instance, options) {
  const registered = instanceIdentities.get(instance);
  if (!registered) {
    bindingFail(
      "air.borrow.instance_identity_unavailable",
      "instantiate the module through instantiateAirModule before borrowed invocation"
    );
  }
  const packageDigest = normalizeIdentityDigest(options.packageDigest, "packageDigest");
  if (registered.packageDigest !== packageDigest) {
    bindingFail("air.borrow.package_identity_mismatch", "packageDigest does not match the instantiated module binding");
  }
  if (options.moduleDigest !== undefined) {
    const suppliedModuleDigest = normalizeIdentityDigest(options.moduleDigest, "moduleDigest");
    if (suppliedModuleDigest !== registered.moduleDigest) {
      bindingFail("air.borrow.module_identity_mismatch", "moduleDigest does not match the instantiated Wasm bytes");
    }
  }
  return registered;
}

function assertRuntimeInterface(instance, entry, entrypoint) {
  const marker = instance.exports.__air_abi_feature_borrowed_slice_v1;
  if (!(marker instanceof WebAssembly.Global) || marker.value !== 0x000b0001) {
    bindingFail("air.borrow.interface_invalid", "selected instance does not expose the borrowed-slice-v1 ABI marker");
  }
  const flattenedCount = (entry.params || []).reduce(
    (count, param) => count + (param.kind === "borrowed_slice" ? 2 : 1),
    0
  );
  if (entrypoint.length !== flattenedCount) {
    bindingFail(
      "air.borrow.interface_invalid",
      `export '${entry.name}' does not match the canonical flattened parameter count`
    );
  }
}

function normalizeCertificateDigest(certificate, packageDigest) {
  if (certificate === undefined || certificate === null) return null;
  requirePlainObject(certificate, "resourceCertificate");
  const digest = certificate.certificateDigest;
  if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    bindingFail("air.borrow.certificate_invalid", "resourceCertificate.certificateDigest is invalid");
  }
  const certificatePackageDigest = certificate.package && certificate.package.digest;
  if (certificatePackageDigest !== packageDigest) {
    bindingFail("air.borrow.certificate_invalid", "resource certificate package digest does not match packageDigest");
  }
  return digest;
}

function normalizeIdentityDigest(value, field) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    bindingFail("air.borrow.identity_digest_invalid", `${field} must be a canonical SHA-256 digest`);
  }
  return value;
}

function safeIdentityDigest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value) ? value : null;
}

function safeStableObject(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return stableObject(value);
  } catch (_) {
    return null;
  }
}

function rejectAccessors(value, field) {
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      bindingFail("air.borrow.descriptor_invalid", `${field}.${key} must be a data property`);
    }
  }
}

function rejectUnknownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) bindingFail("air.borrow.descriptor_invalid", `${field} contains unsupported field '${unknown[0]}'`);
}

function requirePlainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    bindingFail("air.borrow.descriptor_invalid", `${field} must be a plain object`);
  }
}

function requireNonNegativeInt(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    bindingFail("air.borrow.descriptor_invalid", `${field} must be a non-negative safe integer`);
  }
}

function requirePositiveInt(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    bindingFail("air.borrow.descriptor_invalid", `${field} must be a positive safe integer`);
  }
}

function isStableName(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function alignUp(value, alignment) {
  const remainder = value % alignment;
  return remainder === 0 ? value : checkedAdd(value, alignment - remainder);
}

function checkedAdd(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < left) {
    bindingFail("air.borrow.pointer_out_of_bounds", "borrowed-memory range arithmetic overflowed");
  }
  return result;
}

function hashBytes(bytes) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${BORROWED_MEMORY_HASH_DOMAIN}:bytes\0`, "utf8")
    .update(bytes)
    .digest("hex")}`;
}

function hashStable(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${BORROWED_MEMORY_HASH_DOMAIN}:json\0`, "utf8")
    .update(JSON.stringify(stableObject(value)), "utf8")
    .digest("hex")}`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function bindingFail(code, message) {
  throw new BorrowedMemoryBindingError(code, message);
}

module.exports = {
  BORROWED_MEMORY_EVIDENCE_KIND,
  BORROWED_MEMORY_EVIDENCE_SCHEMA_VERSION,
  BorrowedMemoryBindingError,
  invokeBorrowedMemory,
  prepareBorrowedMemoryInvocation,
  registerBorrowedMemoryInstanceIdentity
};
