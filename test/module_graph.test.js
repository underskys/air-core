#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmpRoot = path.join(root, "build", "module-graph-tests");
const packageGraphFixtures = path.join(root, "test", "fixtures", "package_graph");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runJson(dir, profile = "browser-webgpu") {
  return JSON.parse(run(["package-check", dir, "--profile", profile, "--json"]));
}

function moduleCoreFields(report) {
  return report.modules.map((mod) => ({
    name: mod.name,
    path: mod.path,
    imports: mod.imports,
    capabilities: mod.capabilities,
    exports: mod.exports,
    privateFunctions: mod.privateFunctions
  }));
}

function runFails(args) {
  try {
    run(args);
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      message: err.message
    };
  }
  throw new Error(`expected command to fail: ${args.join(" ")}`);
}

function writePackage(dir, files, manifest = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  fs.writeFileSync(path.join(dir, "module.wasm"), "placeholder wasm for module graph package-check\n");
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name: path.basename(dir).replace(/[^a-z0-9._-]/gi, "-").toLowerCase(),
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    wasm: "module.wasm",
    capabilities: ["debug", "input"],
    targetProfiles: ["browser-webgpu"],
    ...manifest
  }, null, 2));
}

const validPackageGraphFixture = path.join(packageGraphFixtures, "valid");
const verifyPackageOutput = run(["verify", "package", validPackageGraphFixture]);
assert.match(verifyPackageOutput, /ok: package/);
assert.match(verifyPackageOutput, /modules: 2/);

const packageGraphReportText = run(["report", "package", validPackageGraphFixture, "--json"]);
assert.strictEqual(run(["report", "package", validPackageGraphFixture, "--json"]), packageGraphReportText);
const packageGraphReport = JSON.parse(packageGraphReportText);
assert.strictEqual(packageGraphReport.status, "pass");
assert.strictEqual(packageGraphReport.linkedWasm, false);
assert.strictEqual(packageGraphReport.linking.status, "available");
assert.deepStrictEqual(packageGraphReport.graph.order, ["main.air", "math.air"]);
assert.deepStrictEqual(packageGraphReport.computedCapabilities, ["debug"]);
assert.deepStrictEqual(packageGraphReport.hostImports.used, ["debug.metric"]);
assert.deepStrictEqual(moduleCoreFields(packageGraphReport), [
  { name: "main", path: "main.air", imports: ["math.air"], capabilities: ["debug"], exports: ["run"], privateFunctions: [] },
  { name: "math", path: "math.air", imports: [], capabilities: [], exports: ["add_one"], privateFunctions: ["internal_add_one"] }
]);
assert.deepStrictEqual(packageGraphReport.modules[1].globals, [{ name: "cached", type: "i32" }]);
assert.deepStrictEqual(packageGraphReport.modules[1].staticTables, [
  {
    name: "offsets",
    type: "i32",
    elementType: "i32",
    storageType: "i32",
    length: 2,
    byteWidth: 4,
    byteSize: 8,
    equivalentI32Bytes: 8,
    estimatedI32SavingsBytes: 0,
    staticBytes: 8,
    approximateStorageBytes: 8,
    module: "math.air",
    origin: "manual"
  }
]);
assert(packageGraphReport.modules[0].functions.some((fn) => fn.name === "run" && fn.exported && fn.statements === 3));

const privatePackageGraph = JSON.parse(runFails(["report", "package", path.join(packageGraphFixtures, "private_call"), "--json"]).stdout);
assert.strictEqual(privatePackageGraph.status, "fail");
assert.match(privatePackageGraph.errors.join("\n"), /AIR_MODULE_PRIVATE_OR_MISSING_EXPORT/);
const privateVerifyFailure = JSON.parse(runFails(["verify", "package", path.join(packageGraphFixtures, "private_call"), "--json"]).stdout);
assert.strictEqual(privateVerifyFailure.status, "failed");
assert.match(privateVerifyFailure.errors.join("\n"), /AIR_MODULE_PRIVATE_OR_MISSING_EXPORT/);

const unresolvedVerifyFailure = runFails(["verify", "package", path.join(packageGraphFixtures, "unresolved_import")]);
assert.match(unresolvedVerifyFailure.stderr, /AIR import missing file: missing\.air/);
const unresolvedPackageGraphReport = JSON.parse(runFails(["report", "package", path.join(packageGraphFixtures, "unresolved_import"), "--json"]).stdout);
assert.strictEqual(unresolvedPackageGraphReport.status, "fail");
assert.match(unresolvedPackageGraphReport.errors.join("\n"), /AIR import missing file: missing\.air/);

const mainDebug = `module main
use "./player.air"
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func run() -> i32 {
entry:
  return 0
}
`;

const playerInput = `module player
capabilities { input }
extern input.axis(id: i32) -> f32

export func sample() -> i32 {
entry:
  return 0
}
`;

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

const basic = path.join(tmpRoot, "split-basic");
writePackage(basic, {
  "main.air": mainDebug,
  "player.air": playerInput
});
const basicReport = runJson(basic);
assert.strictEqual(basicReport.status, "pass");
assert.deepStrictEqual(moduleCoreFields(basicReport), [
  { name: "main", path: "main.air", imports: ["player.air"], capabilities: ["debug"], exports: ["run"], privateFunctions: [] },
  { name: "player", path: "player.air", imports: [], capabilities: ["input"], exports: ["sample"], privateFunctions: [] }
]);
assert.strictEqual(basicReport.linking.status, "available");
assert.strictEqual(basicReport.linkedWasm, false);
assert.strictEqual(basicReport.effectComposition.status, "per-module-only");
assert(basicReport.effectUsageOrigins["main.air"]);
assert(basicReport.checks.some((check) => check.id === "linked-output" && check.status === "pass"));
assert(!basicReport.checks.some((check) => check.id === "linked-wasm-deferred"));
assert.deepStrictEqual(basicReport.capabilityOrigins, {
  debug: ["main.air"],
  input: ["player.air"]
});
assert.deepStrictEqual(basicReport.hostImportOrigins, {
  "debug.metric": ["main.air"],
  "input.axis": ["player.air"]
});
assert.deepStrictEqual(basicReport.authorityChains, [
  { hostImport: "debug.metric", requiredCapability: "debug", module: "main.air", chain: ["main.air", "debug.metric"] },
  { hostImport: "input.axis", requiredCapability: "input", module: "player.air", chain: ["main.air", "player.air", "input.axis"] }
]);
assert.deepStrictEqual(basicReport.capabilities.required, ["debug", "input"]);
assert.deepStrictEqual(basicReport.hostImports.used, ["debug.metric", "input.axis"]);
assert.deepStrictEqual(JSON.parse(run(["package-check", basic, "--profile", "browser-webgpu", "--json"])), basicReport);

const crossModule = path.join(tmpRoot, "split-cross-module");
writePackage(crossModule, {
  "main.air": `module main
use "./math.air"
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = @math.answer(40)
  return %value
}
`,
  "math.air": `module math
capabilities { }

export func answer(value: i32) -> i32 {
entry:
  %two:i32 = 2
  %out:i32 = add %value, %two
  return %out
}

func hidden(value: i32) -> i32 {
entry:
  return %value
}
`
}, { capabilities: [], targetProfiles: ["cli"] });
const crossModuleReport = runJson(crossModule, "cli");
assert.strictEqual(crossModuleReport.status, "pass");
assert.deepStrictEqual(crossModuleReport.graph.order, ["main.air", "math.air"]);
assert.deepStrictEqual(moduleCoreFields(crossModuleReport), [
  { name: "main", path: "main.air", imports: ["math.air"], capabilities: [], exports: ["run"], privateFunctions: [] },
  { name: "math", path: "math.air", imports: [], capabilities: [], exports: ["answer"], privateFunctions: ["hidden"] }
]);

const aliasImport = path.join(tmpRoot, "split-alias-import");
writePackage(aliasImport, {
  "main.air": `module main
use "./math.air" as calc
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = @calc.answer(40)
  return %value
}
`,
  "math.air": `module math
capabilities { }

export func answer(value: i32) -> i32 {
entry:
  %two:i32 = 2
  %out:i32 = add %value, %two
  return %out
}
`
}, { capabilities: [], targetProfiles: ["cli"] });
const aliasImportReport = runJson(aliasImport, "cli");
assert.strictEqual(aliasImportReport.status, "pass");
assert.deepStrictEqual(aliasImportReport.graph.order, ["main.air", "math.air"]);

const stdNoise = path.join(tmpRoot, "stdlib-noise");
writePackage(stdNoise, {
  "main.air": `module main
use std.noise
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = @noise.hash2(1, 2, 3)
  return %value
}
`
}, { capabilities: [], targetProfiles: ["cli"] });
const stdNoiseReport = runJson(stdNoise, "cli");
assert.strictEqual(stdNoiseReport.status, "pass");
assert.deepStrictEqual(stdNoiseReport.importClassifications, [
  { module: "main.air", import: "std.noise", class: "stdlib", status: "accepted", alias: "noise", resolved: "stdlib/noise.air" }
]);

const rejectedStdImports = [
  ["gfx3d", /std\.gfx3d is not stdlib; it belongs to kits\/gfx-basic/, /kits\/gfx-basic\/air\/gfx3d\.air/],
  ["scene", /std\.scene is not stdlib; it belongs to kits\/gfx-basic or project-local code/, /kits\/gfx-basic\/air\/scene\.air/],
  ["voxel", /std\.voxel is not stdlib; use kits\/voxel-basic as vendored\/project-local helper/, /kits\/voxel-basic\/air\/voxel\.air/]
];
for (const [name, errorPattern, hintPattern] of rejectedStdImports) {
  const dir = path.join(tmpRoot, `bad-std-${name}`);
  writePackage(dir, {
    "main.air": `module main
use std.${name}
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`
  }, { capabilities: [], targetProfiles: ["cli"] });
  const report = JSON.parse(runFails(["package-check", dir, "--profile", "cli", "--json"]).stdout);
  assert.strictEqual(report.status, "fail");
  assert.match(report.errors.join("\n"), errorPattern);
  assert(report.checks.some((check) => check.id === "stdlib-import" && hintPattern.test(check.repairHint)));
  assert(report.importClassifications.some((item) => item.import === `std.${name}` && item.class === "rejected-stdlib" && item.status === "rejected"));
}

const packageLocalKit = path.join(tmpRoot, "package-local-kit");
writePackage(packageLocalKit, {
  "main.air": `module main
use "./generated/kits/gfx3d.air" as gfx3d
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = @gfx3d.primitive_flags(2)
  return %value
}
`,
  "generated/kits/gfx3d.air": `module gfx3d
capabilities { }

export func primitive_flags(value: i32) -> i32 {
entry:
  return %value
}
`
}, { capabilities: [], targetProfiles: ["cli"] });
const packageLocalKitReport = runJson(packageLocalKit, "cli");
assert.strictEqual(packageLocalKitReport.status, "pass");
assert.deepStrictEqual(packageLocalKitReport.importClassifications, [
  { module: "main.air", import: "./generated/kits/gfx3d.air", class: "package-local", status: "accepted", alias: "gfx3d", resolved: "generated/kits/gfx3d.air" }
]);

const privateCall = path.join(tmpRoot, "bad-private-cross-module");
writePackage(privateCall, {
  "main.air": `module main
use "./math.air"
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = @math.hidden(40)
  return %value
}
`,
  "math.air": `module math
capabilities { }

func hidden(value: i32) -> i32 {
entry:
  return %value
}
`
}, { capabilities: [], targetProfiles: ["cli"] });
const privateCallReport = JSON.parse(runFails(["package-check", privateCall, "--profile", "cli", "--json"]).stdout);
assert.strictEqual(privateCallReport.status, "fail");
assert.match(privateCallReport.errors.join("\n"), /AIR_MODULE_PRIVATE_OR_MISSING_EXPORT/);
assert.deepStrictEqual(privateCallReport.moduleDiagnostics, [
  {
    code: "AIR_MODULE_PRIVATE_OR_MISSING_EXPORT",
    callerModule: "main.air",
    targetModule: "math.air",
    summary: "1 private or missing exported function call across module boundary",
    symbols: [
      { name: "hidden", callSites: 1, locations: [{ file: "main.air", line: 7 }] }
    ],
    repair: "Export these functions or expose one exported wrapper and keep helpers local."
  }
]);

const repeatedPrivateCalls = path.join(tmpRoot, "bad-repeated-private-cross-module");
writePackage(repeatedPrivateCalls, {
  "main.air": `module main
use "./math.air"
capabilities { }

export func run() -> i32 {
entry:
  %a:i32 = @math.hidden(1)
  %b:i32 = @math.hidden(2)
  %c:i32 = @math.hidden(3)
  %d:i32 = @math.also_hidden(4)
  %e:i32 = @math.also_hidden(5)
  return %e
}
`,
  "math.air": `module math
capabilities { }

func hidden(value: i32) -> i32 {
entry:
  return %value
}

func also_hidden(value: i32) -> i32 {
entry:
  return %value
}
`
}, { capabilities: [], targetProfiles: ["cli"] });
const repeatedPrivateReport = JSON.parse(runFails(["package-check", repeatedPrivateCalls, "--profile", "cli", "--json"]).stdout);
assert.strictEqual(repeatedPrivateReport.status, "fail");
assert.strictEqual(
  repeatedPrivateReport.errors.filter((error) => /AIR_MODULE_PRIVATE_OR_MISSING_EXPORT/.test(error)).length,
  1
);
assert.deepStrictEqual(repeatedPrivateReport.moduleDiagnostics, [
  {
    code: "AIR_MODULE_PRIVATE_OR_MISSING_EXPORT",
    callerModule: "main.air",
    targetModule: "math.air",
    summary: "5 private or missing exported function calls across module boundary",
    symbols: [
      {
        name: "also_hidden",
        callSites: 2,
        locations: [
          { file: "main.air", line: 10 },
          { file: "main.air", line: 11 }
        ]
      },
      {
        name: "hidden",
        callSites: 3,
        locations: [
          { file: "main.air", line: 7 },
          { file: "main.air", line: 8 },
          { file: "main.air", line: 9 }
        ]
      }
    ],
    repair: "Export these functions or expose one exported wrapper and keep helpers local."
  }
]);

const indirectCall = path.join(tmpRoot, "bad-indirect-cross-module");
writePackage(indirectCall, {
  "main.air": `module main
use "./middle.air"
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = @math.answer(40)
  return %value
}
`,
  "middle.air": `module middle
use "./math.air"
capabilities { }

export func pass(value: i32) -> i32 {
entry:
  return %value
}
`,
  "math.air": `module math
capabilities { }

export func answer(value: i32) -> i32 {
entry:
  return %value
}
`
}, { capabilities: [], targetProfiles: ["cli"] });
const indirectCallReport = JSON.parse(runFails(["package-check", indirectCall, "--profile", "cli", "--json"]).stdout);
assert.strictEqual(indirectCallReport.status, "fail");
assert.match(indirectCallReport.errors.join("\n"), /AIR_MODULE_MISSING_DIRECT_IMPORT/);

const missingImportedCapability = path.join(tmpRoot, "missing-imported-capability");
writePackage(missingImportedCapability, {
  "main.air": mainDebug,
  "player.air": playerInput
}, { capabilities: ["debug"] });
const missingImportedCapabilityReport = JSON.parse(runFails(["package-check", missingImportedCapability, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(missingImportedCapabilityReport.status, "fail");
assert.deepStrictEqual(missingImportedCapabilityReport.computedCapabilities, ["debug", "input"]);
assert.deepStrictEqual(missingImportedCapabilityReport.capabilityOrigins, {
  debug: ["main.air"],
  input: ["player.air"]
});
assert(missingImportedCapabilityReport.checks.some((check) => check.id === "package-capability:input" && check.status === "fail"));

const sharedInside = path.join(tmpRoot, "shared-inside");
writePackage(sharedInside, {
  "main.air": `module main
use "./app/player.air"
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func run() -> i32 {
entry:
  return 0
}
`,
  "app/player.air": `module player
use "../shared/math.air"
capabilities { input }
extern input.axis(id: i32) -> f32

export func sample() -> i32 {
entry:
  return 0
}
`,
  "shared/math.air": `module math
capabilities { }

export func zero() -> i32 {
entry:
  return 0
}
`
});
const sharedReport = runJson(sharedInside);
assert.strictEqual(sharedReport.status, "pass");
assert.deepStrictEqual(sharedReport.graph.order, ["main.air", "app/player.air", "shared/math.air"]);

const authorityChain = path.join(tmpRoot, "authority-chain");
writePackage(authorityChain, {
  "main.air": `module main
use "./audio_logic.air" as audio_logic
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func run() -> i32 {
entry:
  @audio_logic.emit_beep(4)
  return 0
}
`,
  "audio_logic.air": `module audio_logic
capabilities { audio }
effects { audio.beep <= 1 }
extern audio.beep(id: i32) -> void

export func emit_beep(id: i32) -> void {
entry:
  @audio.beep(%id)
  return
}
`
}, { capabilities: ["audio", "debug"], targetProfiles: ["browser-webgpu"] });
const authorityReport = runJson(authorityChain);
assert.strictEqual(authorityReport.status, "pass");
assert.deepStrictEqual(authorityReport.computedCapabilities, ["audio", "debug"]);
assert.deepStrictEqual(authorityReport.hostImportOrigins, {
  "audio.beep": ["audio_logic.air"],
  "debug.metric": ["main.air"]
});
assert.deepStrictEqual(authorityReport.authorityChains, [
  { hostImport: "audio.beep", requiredCapability: "audio", module: "audio_logic.air", chain: ["main.air", "audio_logic.air", "audio.beep"] },
  { hostImport: "debug.metric", requiredCapability: "debug", module: "main.air", chain: ["main.air", "debug.metric"] }
]);

const noPrefix = path.join(tmpRoot, "bad-no-prefix");
writePackage(noPrefix, {
  "main.air": mainDebug.replace('"./player.air"', '"player.air"'),
  "player.air": playerInput
});
const noPrefixReport = JSON.parse(runFails(["package-check", noPrefix, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(noPrefixReport.status, "fail");
assert.match(noPrefixReport.errors.join("\n"), /must start with \.\/ or \.\.\//);

const httpsImport = path.join(tmpRoot, "bad-https");
writePackage(httpsImport, {
  "main.air": mainDebug.replace('"./player.air"', '"https://example.com/player.air"'),
  "player.air": playerInput
});
const httpsReport = JSON.parse(runFails(["package-check", httpsImport, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(httpsReport.errors.join("\n"), /URL scheme/);

const fileUrlImport = path.join(tmpRoot, "bad-file-url");
writePackage(fileUrlImport, {
  "main.air": mainDebug.replace('"./player.air"', '"file:///tmp/player.air"'),
  "player.air": playerInput
});
const fileUrlReport = JSON.parse(runFails(["package-check", fileUrlImport, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(fileUrlReport.errors.join("\n"), /URL scheme/);

const absoluteImport = path.join(tmpRoot, "bad-absolute");
writePackage(absoluteImport, {
  "main.air": mainDebug.replace('"./player.air"', `"/tmp/player.air"`),
  "player.air": playerInput
});
const absoluteReport = JSON.parse(runFails(["package-check", absoluteImport, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(absoluteReport.errors.join("\n"), /not absolute/);

const missingImport = path.join(tmpRoot, "bad-missing");
writePackage(missingImport, {
  "main.air": mainDebug
});
const missingReport = JSON.parse(runFails(["package-check", missingImport, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(missingReport.errors.join("\n"), /missing file: player\.air/);
assert(missingReport.checks.some((check) => check.id === "module-missing" && /create the imported \.air file/.test(check.repairHint)));

const escapeImport = path.join(tmpRoot, "bad-escape");
writePackage(escapeImport, {
  "main.air": mainDebug.replace('"./player.air"', '"../outside.air"'),
  "player.air": playerInput
});
fs.writeFileSync(path.join(tmpRoot, "outside.air"), playerInput);
const escapeReport = JSON.parse(runFails(["package-check", escapeImport, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(escapeReport.errors.join("\n"), /escapes package root/);
assert(escapeReport.checks.some((check) => check.id === "module-path-escape" && /under the package root/.test(check.repairHint)));

const symlinkEscape = path.join(tmpRoot, "bad-symlink-escape");
writePackage(symlinkEscape, {
  "main.air": mainDebug.replace('"./player.air"', '"./link.air"'),
  "player.air": playerInput
});
try {
  fs.symlinkSync(path.join(tmpRoot, "outside.air"), path.join(symlinkEscape, "link.air"));
  const symlinkReport = JSON.parse(runFails(["package-check", symlinkEscape, "--profile", "browser-webgpu", "--json"]).stdout);
  assert.match(symlinkReport.errors.join("\n"), /resolves outside package root/);
} catch (err) {
  if (!["EPERM", "EACCES", "ENOTSUP", "EEXIST"].includes(err.code)) throw err;
}

const cycle = path.join(tmpRoot, "bad-cycle");
writePackage(cycle, {
  "main.air": mainDebug,
  "player.air": playerInput.replace("module player", "module player\nuse \"./main.air\"")
});
const cycleReport = JSON.parse(runFails(["package-check", cycle, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(cycleReport.errors.join("\n"), /cyclic AIR import: main\.air -> player\.air -> main\.air/);
assert(cycleReport.checks.some((check) => check.id === "module-cycle" && /acyclic graph/.test(check.repairHint)));

const duplicate = path.join(tmpRoot, "bad-duplicate");
writePackage(duplicate, {
  "main.air": `module main
use "./collision.air"
use "./legacy/collision.air"
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`,
  "collision.air": `module collision
capabilities { }

export func a() -> i32 {
entry:
  return 0
}
`,
  "legacy/collision.air": `module collision
capabilities { }

export func b() -> i32 {
entry:
  return 0
}
`
}, { capabilities: [], targetProfiles: ["browser-webgpu"] });
const duplicateReport = JSON.parse(runFails(["package-check", duplicate, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(duplicateReport.errors.join("\n"), /duplicate module identity 'collision'/);

const duplicateAlias = path.join(tmpRoot, "bad-duplicate-alias");
writePackage(duplicateAlias, {
  "main.air": `module main
use "./a.air" as util
use "./b.air" as util
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`,
  "a.air": `module alpha
capabilities { }

export func a() -> i32 {
entry:
  return 0
}
`,
  "b.air": `module beta
capabilities { }

export func b() -> i32 {
entry:
  return 0
}
`
}, { capabilities: [], targetProfiles: ["browser-webgpu"] });
const duplicateAliasReport = JSON.parse(runFails(["package-check", duplicateAlias, "--profile", "browser-webgpu", "--json"]).stdout);
assert.match(duplicateAliasReport.errors.join("\n"), /duplicate AIR import name 'util'/);
assert(duplicateAliasReport.checks.some((check) => check.id === "module-duplicate-alias" && /distinct alias/.test(check.repairHint)));

console.log("ok: module graph tests");
