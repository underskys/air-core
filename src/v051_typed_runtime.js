"use strict";

class V051TypedRuntimeFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "V051TypedRuntimeFailure";
    this.code = code;
  }
}

const KNOWN_RUNTIME_FAILURES = new Set([
  "air.decision.enum_discriminant_invalid",
  "air.refinement.assignment_out_of_range",
  "air.numeric.checked_failure: overflow",
  "air.numeric.checked_failure: division_by_zero",
  "air.numeric.checked_failure: invalid_conversion",
  "air.v051.typed_value_invalid"
]);

function normalizeV051TypedRuntimeFailure(error, airReason) {
  if (!(error instanceof WebAssembly.RuntimeError) || !KNOWN_RUNTIME_FAILURES.has(airReason)) throw error;
  return new V051TypedRuntimeFailure(airReason);
}

function invokeV051TypedExport(instance, exportName, args = [], options = {}) {
  const exported = instance && instance.exports && instance.exports[exportName];
  if (typeof exported !== "function") throw new TypeError(`typed export '${exportName}' is unavailable`);
  try {
    return exported(...args);
  } catch (error) {
    throw normalizeV051TypedRuntimeFailure(error, options.airReason);
  }
}

module.exports = {
  KNOWN_RUNTIME_FAILURES,
  V051TypedRuntimeFailure,
  invokeV051TypedExport,
  normalizeV051TypedRuntimeFailure
};
