"use strict";

const REGION_BOUNDS_STATIC_CODE = "air.memory.region_bounds_static";
const REGION_BOUNDS_RUNTIME_CODE = "air.memory.region_bounds_runtime";
const REGION_BOUNDS_FAILURE_FUNCTION = "__air_region_bounds_fail";

function classifyRegionSize(sizeRange) {
  if (!sizeRange) return { status: "dynamic" };
  if (sizeRange.max < 0) {
    return {
      status: "invalid",
      detail: `region size ${formatRange(sizeRange)} is always negative`
    };
  }
  return sizeRange.min >= 0 ? { status: "static" } : { status: "dynamic" };
}

function classifyRegionAccess(sizeRange, offsetRange, width) {
  if (!Number.isSafeInteger(width) || width <= 0) {
    return {
      status: "invalid",
      detail: `access width ${width} is not a positive safe integer`
    };
  }
  if (sizeRange && sizeRange.max < 0) {
    return {
      status: "invalid",
      detail: `region size ${formatRange(sizeRange)} is always negative`
    };
  }
  if (offsetRange && offsetRange.max < 0) {
    return {
      status: "invalid",
      detail: `offset ${formatRange(offsetRange)} is always negative`
    };
  }
  if (sizeRange && sizeRange.max < width) {
    return {
      status: "invalid",
      detail: `offset ${formatRange(offsetRange)}, width ${width}, region size ${formatRange(sizeRange)}`
    };
  }
  if (
    sizeRange &&
    offsetRange &&
    offsetRange.min >= 0 &&
    offsetRange.min > sizeRange.max - width
  ) {
    return {
      status: "invalid",
      detail: `offset ${formatRange(offsetRange)}, width ${width}, region size ${formatRange(sizeRange)}`
    };
  }
  if (
    sizeRange &&
    offsetRange &&
    sizeRange.min >= width &&
    offsetRange.min >= 0 &&
    offsetRange.max <= sizeRange.min - width
  ) {
    return { status: "static" };
  }
  return { status: "dynamic" };
}

function formatRange(range) {
  if (!range) return "unknown";
  if (range.min === range.max) return String(range.min);
  return `[${range.min}, ${range.max}]`;
}

module.exports = {
  REGION_BOUNDS_FAILURE_FUNCTION,
  REGION_BOUNDS_RUNTIME_CODE,
  REGION_BOUNDS_STATIC_CODE,
  classifyRegionAccess,
  classifyRegionSize
};
