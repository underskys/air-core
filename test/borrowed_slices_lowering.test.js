#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAir } = require("../src/parser");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { emitWit } = require("../src/wit");
const {
  borrowedSliceInterfaceDescriptor,
  borrowedSliceInterfaceDigest
} = require("../src/borrowed_slices");
const { assertWasmTargetSupport, verifyModule } = require("../src/verifier");
const {
  BORROWED_SLICES_AIR_ABI_VERSION,
  SUPPORTED_AIR_ABI_VERSIONS,
  validatePackageManifest
} = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");

function compile(source, file = "<borrowed-lowering>") {
  const mod = parseAir(source.trim(), file, { resolveSourceImports: false });
  verifyModule(mod, { library: true });
  return mod;
}

async function instantiate(mod) {
  const firstWat = lowerToWat(mod);
  const secondWat = lowerToWat(mod);
  assert.strictEqual(secondWat, firstWat, "WAT must be byte-identical");
  const firstWasm = await watToWasm(firstWat, "<borrowed-lowering>");
  const secondWasm = await watToWasm(secondWat, "<borrowed-lowering>");
  assert.deepStrictEqual(secondWasm, firstWasm, "Wasm must be byte-identical");
  const result = await WebAssembly.instantiate(firstWasm, {});
  return { instance: result.instance, wat: firstWat, wasm: firstWasm };
}

function expectTrap(fn, label) {
  assert.throws(fn, WebAssembly.RuntimeError, label);
}

(async () => {
  const sourcePath = path.join(root, "examples", "borrowed_slices", "wasm", "copy_final_i32.air");
  const mod = compile(fs.readFileSync(sourcePath, "utf8"), sourcePath);
  const descriptor = borrowedSliceInterfaceDescriptor(mod);
  assert.strictEqual(descriptor.airAbi, "0.11");
  assert.strictEqual(BORROWED_SLICES_AIR_ABI_VERSION, "0.11");
  assert.deepStrictEqual(SUPPORTED_AIR_ABI_VERSIONS, ["0.10", "0.11"]);
  assert.strictEqual(descriptor.feature, "borrowed-slice-v1");
  assert.strictEqual(descriptor.exports[0].params[0].lowered[1], "src$byte_len");
  assert.match(borrowedSliceInterfaceDigest(mod), /^[0-9a-f]{64}$/);
  assertWasmTargetSupport(mod, { airAbi: "0.11" });
  assert.throws(
    () => assertWasmTargetSupport(mod, { airAbi: "0.10" }),
    /air\.abi\.borrowed_slice_requires_0_11/
  );

  const { instance, wat } = await instantiate(mod);
  assert.match(wat, /air-abi: 0\.11/);
  assert.match(wat, /\(param \$src i32\) \(param \$src\$len i32\)/);
  assert.match(wat, /air\.borrow\.pointer_out_of_bounds/);
  assert.match(wat, /air\.borrow\.mutable_overlap/);
  assert.strictEqual(instance.exports.__air_abi_feature_borrowed_slice_v1.value, 0x000b0001);

  const memory = new DataView(instance.exports.memory.buffer);
  memory.setInt32(4, 0x12345678, true);
  assert.strictEqual(instance.exports.copy_final(0, 8, 16, 8, 2), 2);
  assert.strictEqual(memory.getInt32(20, true), 0x12345678);

  expectTrap(() => instance.exports.copy_final(0, -1, 16, 8, 0), "negative length");
  expectTrap(() => instance.exports.copy_final(0, 9, 16, 8, 0), "length above max");
  expectTrap(() => instance.exports.copy_final(-4, 8, 16, 8, 0), "unsigned pointer overflow");
  expectTrap(() => instance.exports.copy_final(65532, 8, 16, 8, 0), "base plus bytes");
  expectTrap(() => instance.exports.copy_final(2, 8, 16, 8, 0), "alignment");
  expectTrap(() => instance.exports.copy_final(0, 8, 4, 8, 0), "mutable overlap");
  expectTrap(() => instance.exports.copy_final(0, 8, 16, 8, 3), "scalar relation");
  expectTrap(() => instance.exports.copy_final(0, 8, 16, 8, 0x7fffffff), "relation multiplication overflow");
  expectTrap(() => instance.exports.copy_final(0), "legacy handle passed to ABI 0.11");

  const short = compile(`
module short_actual_length
capabilities { }
requires export read_final
export func read_final(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, 4
  return %value
}
`);
  const shortInstance = (await instantiate(short)).instance;
  new DataView(shortInstance.exports.memory.buffer).setInt32(4, 99, true);
  assert.strictEqual(shortInstance.exports.read_final(0, 8), 99);
  expectTrap(() => shortInstance.exports.read_final(0, 7), "one byte beyond actual length");

  const readonly = compile(`
module readonly_overlap
capabilities { }
requires export lengths
export func lengths(a: borrowed_slice<readonly,len<=8,align=4>, b: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %length:i32 = slice.len %a
  return %length
}
`);
  const readonlyInstance = (await instantiate(readonly)).instance;
  assert.strictEqual(readonlyInstance.exports.lengths(0, 8, 0, 8), 8);

  const helper = compile(`
module borrowed_helper
capabilities { }
requires export length
func helper(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %length:i32 = slice.len %src
  return %length
}
export func length(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %length:i32 = call @helper(%src)
  return %length
}
`);
  const helperInstance = (await instantiate(helper)).instance;
  assert.strictEqual(helperInstance.exports.length(0, 8), 8);

  const legacy = compile(`
module legacy_scalar
capabilities { }
requires export identity
export func identity(value: i32) -> i32 {
entry:
  return %value
}
`);
  const legacyWat = lowerToWat(legacy);
  assert.doesNotMatch(legacyWat, /borrowed-slice-v1/);
  assert.match(legacyWat, /\(param \$value i32\)/);
  assert.throws(
    () => assertWasmTargetSupport(legacy, { airAbi: "0.11" }),
    /air\.abi\.borrowed_slice_interface_mismatch/
  );

  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-borrowed-abi-"));
  try {
    fs.writeFileSync(path.join(packageDir, "module.air"), fs.readFileSync(sourcePath));
    fs.writeFileSync(path.join(packageDir, "air.package.json"), `${JSON.stringify({
      name: "borrowed-abi-package",
      version: "0.0.0",
      airAbi: "0.11",
      hostAbi: "0.10",
      entry: "module.air",
      capabilities: [],
      targetProfiles: []
    }, null, 2)}\n`);
    assert.strictEqual(validatePackageManifest(packageDir, { built: false }).airAbi, "0.11");
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }

  const wit = emitWit(mod);
  assert.match(wit, /record borrowed-slice-v1/);
  assert.match(wit, /src: borrowed-slice-v1/);
  assert.match(wit, new RegExp(borrowedSliceInterfaceDigest(mod)));

  console.log("borrowed slices lowering tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
