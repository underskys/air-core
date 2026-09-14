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

module.exports = { checkedNumericFailureReason };
