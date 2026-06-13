#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAir } = require("../src/parser");
const { verifyModule } = require("../src/verifier");
const { formatModule } = require("../src/format");
const { createFileLspDiagnostics } = require("../src/lsp_diagnostics");
const { createConformanceReport } = require("../src/conformance_report");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");

function runAirc(args, options = {}) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    ...options
  });
}

function diagnosticsFor(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-tablegroup-"));
  const file = path.join(dir, "main.air");
  fs.writeFileSync(file, source);
  return createFileLspDiagnostics(file).diagnostics;
}

function assertDiagnostic(source, code) {
  const diagnostics = diagnosticsFor(source);
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === code),
    `expected ${code}, got ${diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`
  );
  return diagnostics.find((diagnostic) => diagnostic.code === code);
}

async function instantiate(source) {
  const mod = parseAir(source, "<tablegroup-test>");
  verifyModule(mod);
  const wasm = await watToWasm(lowerToWat(mod), "<tablegroup-test>");
  const result = await WebAssembly.instantiate(wasm, {});
  return { mod, instance: result.instance || result };
}

(async () => {
  const source = `module tablegroup_demo
tablegroup sections len 3 {
  x:i32 = [0, 120, 240]
  y:i32 = [80, 96, 112]
  w:i32 = [64, 64, 64]
  h:i32 = [16, 16, 16]
  enabled:bool = [true, true, false]
}
capabilities { }

export func read_y(index: i32) -> i32 {
entry:
  %v:i32 = tablegroup.get.i32 @sections.y, %index
  return %v
}

export func read_enabled(index: i32) -> bool {
entry:
  %v:bool = tablegroup.get.bool @sections.enabled, %index
  return %v
}
`;
  const { mod, instance } = await instantiate(source);
  assert.strictEqual(instance.exports.read_y(2), 112);
  assert.strictEqual(instance.exports.read_enabled(0), 1);
  assert.strictEqual(instance.exports.read_enabled(2), 0);
  assert.throws(() => instance.exports.read_y(3), /unreachable|RuntimeError/);

  assert.deepStrictEqual(mod.tableGroups.map((group) => ({
    name: group.name,
    length: group.length,
    fields: group.fields.map((field) => ({ name: field.name, type: field.type, loweredTableName: field.loweredTableName }))
  })), [{
    name: "sections",
    length: 3,
    fields: [
      { name: "x", type: "i32", loweredTableName: "__tablegroup_sections_x" },
      { name: "y", type: "i32", loweredTableName: "__tablegroup_sections_y" },
      { name: "w", type: "i32", loweredTableName: "__tablegroup_sections_w" },
      { name: "h", type: "i32", loweredTableName: "__tablegroup_sections_h" },
      { name: "enabled", type: "bool", loweredTableName: "__tablegroup_sections_enabled" }
    ]
  }]);

  const formatted = formatModule(mod);
  assert.match(formatted, /tablegroup sections len 3 \{/);
  assert.match(formatted, /  y:i32 = \[80, 96, 112\]/);
  assert.match(formatted, /%v:i32 = tablegroup\.get\.i32 @sections\.y, %index/);
  assert.strictEqual(formatModule(parseAir(formatted, "<tablegroup-formatted>")), formatted);

  const wat = lowerToWat(mod);
  assert(!wat.includes("import \"tablegroup\""), "tablegroups must not add host imports");
  assert(!wat.includes("sections.y"), "tablegroup fields must not become host-visible layout names");

  const report = createConformanceReport(mod);
  assert.deepStrictEqual(report.tableGroups.map((group) => ({
    name: group.name,
    length: group.length,
    fieldCount: group.fieldCount,
    byteSize: group.byteSize,
    fields: group.fields.map((field) => ({ name: field.name, type: field.type, byteSize: field.byteSize, loweredTableName: field.loweredTableName }))
  })), [{
    name: "sections",
    length: 3,
    fieldCount: 5,
    byteSize: 60,
    fields: [
      { name: "enabled", type: "bool", byteSize: 12, loweredTableName: "__tablegroup_sections_enabled" },
      { name: "h", type: "i32", byteSize: 12, loweredTableName: "__tablegroup_sections_h" },
      { name: "w", type: "i32", byteSize: 12, loweredTableName: "__tablegroup_sections_w" },
      { name: "x", type: "i32", byteSize: 12, loweredTableName: "__tablegroup_sections_x" },
      { name: "y", type: "i32", byteSize: 12, loweredTableName: "__tablegroup_sections_y" }
    ]
  }]);

  const lengthMismatchDiagnostic = assertDiagnostic(`module bad_tablegroup_len
tablegroup sections len 3 {
  x:i32 = [0, 1]
}
capabilities { }
`, "air.tablegroup.length_mismatch");
  assert.match(lengthMismatchDiagnostic.repairHint || "", /Make every tablegroup field initializer length match/);

  assertDiagnostic(`module bad_tablegroup_field
tablegroup sections len 1 {
  x:i32 = [0]
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = tablegroup.get.i32 @sections.missing, 0
  return %v
}
`, "air.tablegroup.invalid");

  assertDiagnostic(`module bad_tablegroup_type
tablegroup sections len 1 {
  label:string = ["secret"]
}
capabilities { }
`, "air.tablegroup.field_type_invalid");

  assertDiagnostic(`module bad_tablegroup_oob
tablegroup sections len 1 {
  x:i32 = [0]
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = tablegroup.get.i32 @sections.x, 1
  return %v
}
`, "air.tablegroup.index_out_of_bounds");

  assertDiagnostic(`module bad_tablegroup_mutation
tablegroup sections len 1 {
  x:i32 = [0]
}
capabilities { }

export func run() -> i32 {
entry:
  tablegroup.set @sections.x, 0, 1
  return 0
}
`, "air.tablegroup.mutable_rejected");

  assertDiagnostic(`module bad_tablegroup_object
tablegroup sections len 1 {
  x:i32 = [0]
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = tablegroup.json @sections.x
  return %v
}
`, "air.tablegroup.object_model_rejected");

  const aironStyle = `module airon_level_tables
tablegroup platforms len 2 {
  x:i32 = [0, 120]
  y:i32 = [80, 96]
  w:i32 = [64, 64]
  h:i32 = [16, 16]
  material_id:i32 = [10, 11]
}
tablegroup enemy_anchors len 2 {
  x:i32 = [40, 220]
  y:i32 = [72, 88]
  enemy_kind:i32 = [1, 2]
}
capabilities { }

export func platform_y(index: i32) -> i32 {
entry:
  %v:i32 = tablegroup.get.i32 @platforms.y, %index
  return %v
}

export func enemy_kind(index: i32) -> i32 {
entry:
  %v:i32 = tablegroup.get.i32 @enemy_anchors.enemy_kind, %index
  return %v
}
`;
  const airon = await instantiate(aironStyle);
  assert.strictEqual(airon.instance.exports.platform_y(1), 96);
  assert.strictEqual(airon.instance.exports.enemy_kind(0), 1);

  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-tablegroup-pkg-"));
  fs.writeFileSync(path.join(packageDir, "main.air"), source);
  fs.writeFileSync(path.join(packageDir, "module.wasm"), "placeholder wasm for tablegroup report package\n");
  fs.writeFileSync(path.join(packageDir, "air.package.json"), JSON.stringify({
    name: "readonly-tablegroup-package",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    wasm: "module.wasm",
    capabilities: [],
    targetProfiles: ["cli"],
    manifests: {}
  }, null, 2));

  const packageReport = JSON.parse(runAirc(["report", "package", packageDir, "--json"]));
  assert.strictEqual(packageReport.status, "pass");
  assert.strictEqual(packageReport.tableGroups.length, 1);
  assert.strictEqual(packageReport.tableGroups[0].name, "sections");
  assert.strictEqual(packageReport.tableGroups[0].length, 3);
  assert.strictEqual(packageReport.tableGroups[0].byteSize, 60);
  assert.strictEqual(packageReport.modules[0].tableGroups[0].fields.length, 5);

  const evidence = JSON.parse(runAirc(["verify", "package", packageDir, "--profile", "cli", "--json"]));
  assert.strictEqual(evidence.status, "passed");
  assert.strictEqual(evidence.airAbi, "0.10");
  assert.strictEqual(evidence.hostAbi, "0.10");
  assert.strictEqual(evidence.tableGroups.length, 1);
  assert.strictEqual(evidence.tableGroups[0].name, "sections");
  assert.strictEqual(evidence.tableGroups[0].fields.length, 5);

  console.log("readonly tablegroup tests passed");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
