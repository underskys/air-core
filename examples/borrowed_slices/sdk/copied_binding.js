#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const air = require("../../../src");

async function main() {
  const sourcePath = path.resolve(__dirname, "..", "wasm", "copy_final_i32.air");
  const source = fs.readFileSync(sourcePath, "utf8");
  const mod = air.parseAir(source, sourcePath, {
    resolveSourceImports: false
  });
  air.verifyModule(mod, { library: true });
  const wasm = await air.watToWasm(air.lowerToWat(mod), sourcePath);
  const packageDigest = digest(Buffer.from(source, "utf8"));
  const instance = await air.instantiateAirModule({
    wasmBytes: wasm,
    packageDigest
  });
  const src = new Uint8Array(8);
  const dst = new Uint8Array(8);
  new DataView(src.buffer).setInt32(4, 42, true);

  const invocation = air.invokeBorrowedMemory({
    instance,
    interfaceDescriptor: air.borrowedSliceInterfaceDescriptor(mod),
    moduleDigest: digest(wasm),
    packageDigest,
    entrypoint: "copy_final",
    bindings: {
      src: descriptor(src, "readonly"),
      dst: descriptor(dst, "writeonly")
    },
    arguments: { count: 2 }
  });

  process.stdout.write(`${JSON.stringify({
    result: invocation.result,
    output: new DataView(dst.buffer).getInt32(4, true),
    evidence: invocation.evidence
  }, null, 2)}\n`);
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function descriptor(buffer, access) {
  return {
    buffer,
    access,
    maxLength: 8,
    alignment: 4,
    aliasGroup: null,
    memoryDomain: "wasm-linear",
    transferMode: "copied_into_wasm"
  };
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
