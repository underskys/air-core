#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAir } = require("../src/parser");
const { verifyModule } = require("../src/verifier");
const { formatModule } = require("../src/format");
const { auditModule } = require("../src/audit");
const { createConformanceReport } = require("../src/conformance_report");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

async function instantiate(source) {
  const mod = parseAir(source, "<static-table-test>");
  verifyModule(mod);
  const wasm = await watToWasm(lowerToWat(mod), "<static-table-test>");
  const result = await WebAssembly.instantiate(wasm, {});
  return { mod, instance: result.instance || result };
}

(async () => {
  const source = `module table_demo
table weights:i32[3] = [4, 7, 9]
table enabled:bool[2] = [true, false]
capabilities { }

export func static_read() -> i32 {
entry:
  %v:i32 = table.get weights, 1
  return %v
}

export func dynamic_read(index: i32) -> i32 {
entry:
  %v:i32 = table.get weights, %index
  return %v
}

export func bool_read() -> bool {
entry:
  %v:bool = table.get enabled, 0
  return %v
}
`;
  const { mod, instance } = await instantiate(source);
  assert.strictEqual(instance.exports.static_read(), 7);
  assert.strictEqual(instance.exports.dynamic_read(2), 9);
  assert.strictEqual(instance.exports.bool_read(), 1);
  assert.throws(() => instance.exports.dynamic_read(3), /unreachable|RuntimeError/);

  const formatted = formatModule(mod);
  assert.match(formatted, /table weights:i32\[3\] = \[4, 7, 9\]/);
  assert.strictEqual(formatModule(parseAir(formatted)), formatted);

  const audit = auditModule(mod);
  assert.match(audit, /Static tables: weights:i32\[3\], enabled:bool\[2\]/);
  assert.match(audit, /memory.static_readonly_bytes=20/);

  const report = createConformanceReport(mod);
  assert.deepStrictEqual(report.staticTables, [
    {
      name: "enabled",
      type: "bool",
      elementType: "bool",
      storageType: "bool",
      length: 2,
      byteWidth: 4,
      byteSize: 8,
      equivalentI32Bytes: 8,
      estimatedI32SavingsBytes: 0,
      staticBytes: 8,
      approximateStorageBytes: 8,
      module: "table_demo",
      source: "<static-table-test>",
      origin: "manual"
    },
    {
      name: "weights",
      type: "i32",
      elementType: "i32",
      storageType: "i32",
      length: 3,
      byteWidth: 4,
      byteSize: 12,
      equivalentI32Bytes: 12,
      estimatedI32SavingsBytes: 0,
      staticBytes: 12,
      approximateStorageBytes: 12,
      module: "table_demo",
      source: "<static-table-test>",
      origin: "manual"
    }
  ]);
  assert.deepStrictEqual(report.staticTableSummary, {
    count: 2,
    names: ["enabled", "weights"],
    totalApproximateStorageBytes: 20,
    totalEquivalentI32Bytes: 20,
    totalEstimatedI32SavingsBytes: 0
  });

  const constantsInTables = `module constant_tables
const WARN:i32 = 70
const FAIL:i32 = 90
const ENABLED:bool = true
table thresholds:i32[2] = [WARN, FAIL]
table flags:bool[1] = [ENABLED]
capabilities { }

export func warn_threshold() -> i32 {
entry:
  %v:i32 = table.get thresholds, 0
  return %v
}

export func enabled_flag() -> bool {
entry:
  %v:bool = table.get flags, 0
  return %v
}
`;
  const constantTableMod = parseAir(constantsInTables, "<constant-table-test>");
  verifyModule(constantTableMod);
  assert.match(formatModule(constantTableMod), /table thresholds:i32\[2\] = \[WARN, FAIL\]/);
  const constantTableWasm = await watToWasm(lowerToWat(constantTableMod), "<constant-table-test>");
  const constantTableResult = await WebAssembly.instantiate(constantTableWasm, {});
  const constantTableInstance = constantTableResult.instance || constantTableResult;
  assert.strictEqual(constantTableInstance.exports.warn_threshold(), 70);
  assert.strictEqual(constantTableInstance.exports.enabled_flag(), 1);
  const constantTableReport = createConformanceReport(constantTableMod);
  assert.deepStrictEqual(constantTableReport.staticTables.map((table) => ({
    name: table.name,
    type: table.type,
    length: table.length
  })), [
    { name: "flags", type: "bool", length: 1 },
    { name: "thresholds", type: "i32", length: 2 }
  ]);

  assert.throws(() => verifyModule(parseAir(`module bad_const_table
const LIMIT:f32 = 1.5
table xs:i32[1] = [LIMIT]
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`)), /constant 'LIMIT' has type f32, expected i32/);

  assert.throws(() => verifyModule(parseAir(`module bad
table xs:i32[2] = [1, 2]
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = table.get xs, 2
  return %v
}
`)), /static index 2 out of bounds for length 2/);

  assert.throws(() => parseAir(`module bad_len
table xs:i32[3] = [1, 2]
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`), /length 3 does not match 2 initializer/);

  assert.throws(() => parseAir(`module bad_dynamic_len
const N:i32 = 2
table xs:i32[N] = [1, 2]
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`), /length must be a fixed positive integer literal/);

  assert.throws(() => parseAir(`module bad_type
table xs:slice[1] = ["x"]
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`), /element type 'slice' is not supported/);

  assert.throws(() => verifyModule(parseAir(`module bad_mutation
table xs:i32[1] = [1]
capabilities { }

export func run() -> i32 {
entry:
  table.set xs, 0, 2
  return 0
}
`)), /static tables are read-only/);

  const compactSource = `module compact_tables
table tiles:u8 = [0, 7, 255]
table materials:u16 = [0, 513, 65535]
table offsets:i16 = [-32768, 0, 32767]
capabilities { }

export func read_u8(index: i32) -> i32 {
entry:
  %v:i32 = table.get.u8 tiles, %index
  return %v
}

export func read_u16() -> i32 {
entry:
  %v:i32 = table.get.u16 materials, 1
  return %v
}

export func read_i16() -> i32 {
entry:
  %v:i32 = table.get.i16 offsets, 0
  return %v
}
`;
  const compactMod = parseAir(compactSource, "<compact-table-test>");
  verifyModule(compactMod);
  const compactFormatted = formatModule(compactMod);
  assert.match(compactFormatted, /table tiles:u8 = \[0, 7, 255\]/);
  assert.strictEqual(formatModule(parseAir(compactFormatted)), compactFormatted);
  const compactWat = lowerToWat(compactMod);
  assert.match(compactWat, /i32\.load8_u/);
  assert.match(compactWat, /i32\.load16_u/);
  assert.match(compactWat, /i32\.load16_s/);
  const compactWasm = await watToWasm(compactWat, "<compact-table-test>");
  const compactResult = await WebAssembly.instantiate(compactWasm, {});
  const compactInstance = compactResult.instance || compactResult;
  assert.strictEqual(compactInstance.exports.read_u8(2), 255);
  assert.strictEqual(compactInstance.exports.read_u16(), 513);
  assert.strictEqual(compactInstance.exports.read_i16(), -32768);
  assert.throws(() => compactInstance.exports.read_u8(3), /unreachable|RuntimeError/);

  const compactReport = createConformanceReport(compactMod);
  assert.deepStrictEqual(compactReport.staticTables.map((table) => ({
    name: table.name,
    storageType: table.storageType,
    length: table.length,
    byteSize: table.byteSize,
    equivalentI32Bytes: table.equivalentI32Bytes,
    estimatedI32SavingsBytes: table.estimatedI32SavingsBytes
  })), [
    { name: "materials", storageType: "u16", length: 3, byteSize: 6, equivalentI32Bytes: 12, estimatedI32SavingsBytes: 6 },
    { name: "offsets", storageType: "i16", length: 3, byteSize: 6, equivalentI32Bytes: 12, estimatedI32SavingsBytes: 6 },
    { name: "tiles", storageType: "u8", length: 3, byteSize: 3, equivalentI32Bytes: 12, estimatedI32SavingsBytes: 9 }
  ]);
  assert.deepStrictEqual(compactReport.staticTableSummary, {
    count: 3,
    names: ["materials", "offsets", "tiles"],
    totalApproximateStorageBytes: 15,
    totalEquivalentI32Bytes: 36,
    totalEstimatedI32SavingsBytes: 21
  });

  assert.throws(() => verifyModule(parseAir(`module bad_u8
table xs:u8 = [256]
capabilities { }
export func run() -> i32 {
entry:
  %v:i32 = table.get.u8 xs, 0
  return %v
}
`)), /out of range for u8 storage/);

  assert.throws(() => verifyModule(parseAir(`module bad_u16
table xs:u16 = [65536]
capabilities { }
export func run() -> i32 {
entry:
  %v:i32 = table.get.u16 xs, 0
  return %v
}
`)), /out of range for u16 storage/);

  assert.throws(() => verifyModule(parseAir(`module bad_i16
table xs:i16 = [-32769]
capabilities { }
export func run() -> i32 {
entry:
  %v:i32 = table.get.i16 xs, 0
  return %v
}
`)), /out of range for i16 storage/);

  assert.throws(() => verifyModule(parseAir(`module bad_result_type
table xs:u8 = [1]
capabilities { }
export func run() -> bool {
entry:
  %v:bool = table.get.u8 xs, 0
  return %v
}
`)), /table\.get\.u8 xs produces i32, assigned to bool/);

  assert.throws(() => verifyModule(parseAir(`module bad_get_op
table xs:u8 = [1]
capabilities { }
export func run() -> i32 {
entry:
  %v:i32 = table.get xs, 0
  return %v
}
`)), /must be read with table\.get\.u8/);

  assert.throws(() => parseAir(`module bad_value_type
table xs:u8 = [1]
capabilities { }
export func run() -> u8 {
entry:
  %v:i32 = table.get.u8 xs, 0
  return %v
}
`), /unknown type 'u8'/);

  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-compact-table-"));
  fs.writeFileSync(path.join(packageDir, "bad.air"), `module bad_pkg
table xs:u8 = [256]
capabilities { }
export func run() -> i32 {
entry:
  %v:i32 = table.get.u8 xs, 0
  return %v
}
`);
  fs.writeFileSync(path.join(packageDir, "air.package.json"), JSON.stringify({
    name: "bad-compact-table",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "bad.air",
    capabilities: [],
    targetProfiles: ["cli"]
  }, null, 2));
  const pkg = cp.spawnSync(process.execPath, ["bin/airc.js", "package-check", packageDir, "--profile", "cli", "--source-only", "--json"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });
  assert.notStrictEqual(pkg.status, 0);
  const pkgReport = JSON.parse(pkg.stdout);
  const rangeDiagnostic = pkgReport.diagnostics.find((diagnostic) => diagnostic.code === "air.table.value_out_of_range");
  assert(rangeDiagnostic);
  assert.strictEqual(rangeDiagnostic.fields.table, "xs");
  assert.strictEqual(rangeDiagnostic.fields.storageType, "u8");
  assert.strictEqual(rangeDiagnostic.fields.index, 0);
  assert.strictEqual(rangeDiagnostic.fields.value, 256);
  assert.strictEqual(rangeDiagnostic.fields.allowedRange, "0..255");

  const compactExample = cp.spawnSync(process.execPath, [
    "bin/airc.js",
    "package-check",
    "examples/compact_tables_package",
    "--profile",
    "cli",
    "--source-only",
    "--json"
  ], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });
  assert.strictEqual(compactExample.status, 0, compactExample.stderr);
  const compactExampleReport = JSON.parse(compactExample.stdout);
  assert.strictEqual(compactExampleReport.status, "pass");
  const compactExampleTotals = compactExampleReport.modules[0].staticTables.reduce((totals, table) => ({
    bytes: totals.bytes + table.byteSize,
    i32Bytes: totals.i32Bytes + table.equivalentI32Bytes,
    savings: totals.savings + table.estimatedI32SavingsBytes
  }), { bytes: 0, i32Bytes: 0, savings: 0 });
  assert.deepStrictEqual(compactExampleTotals, { bytes: 16, i32Bytes: 40, savings: 24 });

  console.log("ok: static table tests");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
