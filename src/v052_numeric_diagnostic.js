"use strict";

// Host-side translation of the already frozen v0.51 Wasm failure flag.
// This is not a new arithmetic rule or a source of execution authority.
const REASONS = Object.freeze({
  1: "overflow",
  2: "division_by_zero",
  3: "invalid_conversion"
});

function checkedNumericFailureReason(error, instance) {
  if (!(error instanceof WebAssembly.RuntimeError)) return null;
  const flag = instance && instance.exports &&
    instance.exports.__air_v051_checked_numeric_failure;
  if (!(flag instanceof WebAssembly.Global) || !Number.isInteger(flag.value)) return null;
  return Object.prototype.hasOwnProperty.call(REASONS, flag.value)
    ? REASONS[flag.value]
    : null;
}

// typed-v0.53 failure-reason registry (R-REF-9 as amended by AMD-P3-1; P0-03
// slice text §4.4 A-1). A bijection between reason values and host-facing
// identities; only the numeric identities carry a reason word. Read by the
// typed-v0.53 adapter only: typed-v0.51 keeps checkedNumericFailureReason (A-5).
const TYPED_V053_FAILURE_REASON_EXPORT = "__air_failure_reason";
const TYPED_V053_FAILURE_REASONS = Object.freeze({
  1: Object.freeze({ code: "air.numeric.checked_failure", reason: "overflow" }),
  2: Object.freeze({ code: "air.numeric.checked_failure", reason: "division_by_zero" }),
  3: Object.freeze({ code: "air.numeric.checked_failure", reason: "invalid_conversion" }),
  16: Object.freeze({ code: "air.refinement.ingress_out_of_range" }),
  17: Object.freeze({ code: "air.refinement.assignment_out_of_range" }),
  32: Object.freeze({ code: "air.loop.count_out_of_range" }),
  33: Object.freeze({ code: "air.table.index_out_of_range" }),
  34: Object.freeze({ code: "air.memory.region_bounds_runtime" }),
  35: Object.freeze({ code: "air.array.index_out_of_range" }),
  48: Object.freeze({ code: "air.decision.enum_discriminant_invalid" }),
  49: Object.freeze({ code: "air.decision.payload_tag_invalid" }),
  50: Object.freeze({ code: "air.decision.bool_lane_invalid" }),
  51: Object.freeze({ code: "air.decision.payload_lane_noncanonical" })
});

// A-1, A-2: a WebAssembly.RuntimeError of a typed-v0.53 export is mapped by
// the `__air_failure_reason` value of the same, fresh instance. Value 0 is an
// implementation defect, and a value outside the registry (or no readable
// value) fails closed. Any other exception is not an AIR trap: null.
function typedV053FailureIdentity(error, instance) {
  if (!(error instanceof WebAssembly.RuntimeError)) return null;
  const flag = instance && instance.exports && instance.exports[TYPED_V053_FAILURE_REASON_EXPORT];
  const value = flag instanceof WebAssembly.Global && Number.isInteger(flag.value) ? flag.value : null;
  if (value === 0) return Object.freeze({ code: "air.runtime.trap_unclassified", disposition: "IMPLEMENTATION_DEFECT", value });
  if (value !== null && Object.prototype.hasOwnProperty.call(TYPED_V053_FAILURE_REASONS, value)) {
    return Object.freeze({ ...TYPED_V053_FAILURE_REASONS[value], value });
  }
  return Object.freeze({ code: "air.runtime.failure_reason_unknown", value });
}

module.exports = {
  TYPED_V053_FAILURE_REASONS,
  TYPED_V053_FAILURE_REASON_EXPORT,
  checkedNumericFailureReason,
  typedV053FailureIdentity
};
