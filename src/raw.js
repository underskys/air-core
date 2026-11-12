"use strict";

// SEC53-02: raw Wasm execution, published as @underskys/air-core/raw. These
// entries run the bytes and imports they are given with no AIR admission and
// no binding to verified source. The package root has no raw entry.
const fs = require("fs");
const {
  instantiateRegisteredWasm,
  invokeRawBorrowedMemory,
  prepareRawBorrowedMemoryInvocation
} = require("./borrowed_memory_binding");

async function instantiateRawWasm(options = {}) {
  const source = options.wasmBytes || fs.readFileSync(options.wasmPath);
  return instantiateRegisteredWasm(source, options.imports || {}, {
    packageDigest: options.packageDigest || null,
    verified: false
  });
}

module.exports = {
  instantiateRawWasm,
  invokeRawBorrowedMemory,
  prepareRawBorrowedMemoryInvocation
};
