#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "anti-slop-diagnostics-test");
const aiFixtures = path.join(root, "test", "fixtures", "ai_review");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const largeFunctionPackage = writePackage("large-function-warning", {
  source: largeAirModule("large_function_warning", "run", 8),
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: { largeFunctionStatements: 4 },
    gates: { "air.review.large_function": "warn" }
  }
});
const largeFunction = runJson(["package-check", largeFunctionPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(largeFunction.status, "warn");
assert(hasDiagnostic(largeFunction, "air.review.large_function", { pathClass: "authored" }));

const largeEntryPackage = writePackage("large-entry-fail", {
  source: fixture("frame_budget.air"),
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: { largeEntryStatements: 3 },
    gates: { "air.review.large_entry": "fail" }
  }
});
const largeEntry = runJsonFails(["package-check", largeEntryPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(largeEntry.status, "fail");
assert(hasDiagnostic(largeEntry, "air.review.large_entry"));
assert(largeEntry.errors.some((item) => /reviewPolicy failed on entry-frame-budget:frame/.test(item)));

const repeatedLiteralPackage = writePackage("repeated-literal-warning", {
  source: fixture("repeated_literal.air"),
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: { repeatedLiteralCount: 3 },
    gates: { "air.review.repeated_literal": "warn" }
  }
});
const repeatedLiteral = runJson(["package-check", repeatedLiteralPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(repeatedLiteral.status, "warn");
assert(hasDiagnostic(repeatedLiteral, "air.review.repeated_literal"));

const debugMetricPackage = writePackage("debug-metric-event-bus-fail", {
  profile: "cli",
  capabilities: ["debug"],
  source: fixture("debug_metric_event_bus.air"),
  reviewPolicy: {
    schemaVersion: "0.15",
    gates: { "air.review.debug_metric_event_bus": "fail" }
  }
});
const debugMetric = runJsonFails(["package-check", debugMetricPackage, "--profile", "cli", "--source-only", "--release-candidate", "--json"]);
assert.strictEqual(debugMetric.status, "fail");
assert(hasDiagnostic(debugMetric, "air.review.debug_metric_event_bus"));
assert(debugMetric.errors.some((item) => /reviewPolicy failed on debug-metric-event-bus/.test(item)));
const debugMetricDiagnostic = allDiagnostics(debugMetric).find((item) => item.code === "air.review.debug_metric_event_bus");
assert(debugMetricDiagnostic, "expected canonical debug.metric event-bus diagnostic");
assert.strictEqual(debugMetricDiagnostic.source, "ai-review");
assert.strictEqual(debugMetricDiagnostic.file, "module.air");
assert.strictEqual(debugMetricDiagnostic.module, "module.air");
assert.strictEqual(debugMetricDiagnostic.gateAction, "fail");
assert.strictEqual(debugMetricDiagnostic.packageStatusImpact, "fail");
assert.strictEqual(debugMetricDiagnostic.fields.reviewPolicyGateAction, "fail");
assert.deepStrictEqual(debugMetricDiagnostic.fields.functions, ["run"]);
assert.strictEqual(debugMetricDiagnostic.fields.eventCount, 1);

const stableDebugMetricPackage = writePackage("stable-debug-metric-pass", {
  profile: "cli",
  capabilities: ["debug"],
  source: `module stable_debug_metric
capabilities { debug }
effects { debug.metric <= 1 }

extern debug.metric(id: i32, value: i32) -> void

export func run(seed: i32) -> i32 {
entry:
  @debug.metric(2, %seed)
  return %seed
}
`,
  reviewPolicy: {
    schemaVersion: "0.15",
    gates: { "air.review.debug_metric_event_bus": "fail" }
  }
});
const stableDebugMetric = runJson(["package-check", stableDebugMetricPackage, "--profile", "cli", "--source-only", "--release-candidate", "--json"]);
assert.strictEqual(stableDebugMetric.status, "pass");
assert(!hasDiagnostic(stableDebugMetric, "air.review.debug_metric_event_bus"));

const generatedRelaxedPackage = writePackage("generated-path-class-relaxed", {
  entry: "generated/module.air",
  files: {
    "generated/module.air": largeAirModule("generated_relaxed", "run", 8)
  },
  reviewPolicy: {
    schemaVersion: "0.15",
    pathClasses: { generated: ["generated/**/*.air"] },
    thresholds: { largeFunctionStatements: 4 },
    pathClassThresholds: { generated: { largeFunctionStatements: 999 } },
    gates: { "air.review.large_function": "fail" }
  }
});
const generatedRelaxed = runJson(["package-check", generatedRelaxedPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(generatedRelaxed.status, "pass");
assert.strictEqual(generatedRelaxed.aiReview.reviewPolicy.pathClass, "generated");
assert(!hasDiagnostic(generatedRelaxed, "air.review.large_function"));

const vendorWarningPackage = writePackage("vendor-path-class-warning", {
  entry: "kits/vendor.air",
  files: {
    "kits/vendor.air": largeAirModule("vendor_warning", "run", 8)
  },
  reviewPolicy: {
    schemaVersion: "0.15",
    pathClasses: { vendor: ["kits/**"] },
    thresholds: { largeFunctionStatements: 4 },
    gates: { "air.review.large_function": "warn" }
  }
});
const vendorWarning = runJson(["package-check", vendorWarningPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(vendorWarning.status, "warn");
assert(hasDiagnostic(vendorWarning, "air.review.large_function", { pathClass: "vendor" }));
assert(!vendorWarning.errors.some((item) => /reviewPolicy failed/.test(item)));

const generatedStalePackage = writePackage("stale-generated-artifact-fail", {
  generatedModules: ["generated/assets.air"],
  source: smallModule("stale_generated_artifact")
});
const generatedStale = runJsonFails(["package-check", generatedStalePackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(generatedStale.status, "fail");
assert(hasDiagnostic(generatedStale, "air.generated.stale", { file: null }));
assert(generatedStale.generatedArtifacts.errors.some((item) => /generated module missing: generated\/assets\.air/.test(item)));

const manifestMismatchPackage = writePackage("manifest-resource-mismatch", {
  profile: "browser-webgpu",
  source: smallModule("manifest_resource_mismatch"),
  manifests: { assets: "assets/manifest.json" },
  files: {
    "assets/tmp_unused/tiny.png": "AIR test placeholder\n",
    "assets/manifest.json": JSON.stringify({
      version: "0.12",
      assets: {
        textures: {
          stray: { path: "tmp_unused/tiny.png" }
        }
      },
      fallbacks: {}
    }, null, 2)
  }
});
const manifestMismatch = runJsonFails(["package-check", manifestMismatchPackage, "--profile", "browser-webgpu", "--source-only", "--json"]);
assert.strictEqual(manifestMismatch.status, "fail");
assert(hasDiagnostic(manifestMismatch, "air.manifest.forbidden_runtime_path"));
assert.deepStrictEqual(manifestMismatch.assets.resourceConsistency.forbiddenRuntimeReferences, [{
  field: "assets.textures.stray.path",
  path: "tmp_unused/tiny.png",
  fragment: "tmp_unused"
}]);

const packageLevelDiagnostic = generatedStale.diagnostics.find((item) => item.code === "air.generated.stale" && item.file === null);
assert(packageLevelDiagnostic, "expected package-level generated stale diagnostic without file range");
assert.strictEqual(packageLevelDiagnostic.line, null);
assert.strictEqual(packageLevelDiagnostic.col, null);

const parserErrorFile = path.join(tmp, "lsp-parser-error.air");
fs.writeFileSync(parserErrorFile, `module lsp_parser_error
capabilities { }

this is not AIR syntax
`);
const lspParserError = runJsonFails(["check", parserErrorFile, "--lsp-json"]);
assert.strictEqual(lspParserError.status, "fail");
assert(lspParserError.diagnostics.some((item) => item.code === "air.parser.syntax" && item.line === 4));

const verifierErrorFile = path.join(tmp, "lsp-verifier-error.air");
fs.writeFileSync(verifierErrorFile, `module lsp_verifier_error
capabilities { }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  @debug.metric(1, 1)
  return
}
`);
const lspVerifierError = runJsonFails(["check", verifierErrorFile, "--lsp-json"]);
assert.strictEqual(lspVerifierError.status, "fail");
assert(lspVerifierError.diagnostics.some((item) => item.code === "air.verifier.error" && /requires capability 'debug'/.test(item.message)));

const lspPackageError = runJsonFails(["check", generatedStalePackage, "--profile", "verifier-only", "--lsp-json"]);
assert.strictEqual(lspPackageError.status, "fail");
assert(lspPackageError.diagnostics.some((item) => item.code === "air.generated.stale" && item.file === null));

const lspReviewWarning = runJson(["check", largeFunctionPackage, "--profile", "verifier-only", "--lsp-json"]);
assert.strictEqual(lspReviewWarning.status, "warn");
assert(lspReviewWarning.diagnostics.some((item) => item.code === "air.review.large_function" && item.pathClass === "authored"));

console.log("ok: anti-slop diagnostics fixture tests");

function runJson(args) {
  return JSON.parse(cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

function runJsonFails(args) {
  const result = cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notStrictEqual(result.status, 0, `expected failure: ${args.join(" ")}`);
  return JSON.parse(result.stdout);
}

function writePackage(name, options = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const entry = options.entry || "module.air";
  const files = {
    [entry]: options.source || smallModule(name.replace(/-/g, "_")),
    ...(options.files || {})
  };
  for (const [relative, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry,
    capabilities: options.capabilities || [],
    targetProfiles: [options.profile || "verifier-only"],
    manifests: options.manifests || {},
    generatedModules: options.generatedModules || [],
    ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {})
  }, null, 2));
  return dir;
}

function fixture(file) {
  return fs.readFileSync(path.join(aiFixtures, file), "utf8");
}

function hasDiagnostic(report, code, fields = {}) {
  return allDiagnostics(report).some((item) => {
    if (item.code !== code) return false;
    return Object.entries(fields).every(([key, value]) => item[key] === value);
  });
}

function allDiagnostics(report) {
  return [
    ...(report.diagnostics || []),
    ...((report.packageReview && report.packageReview.diagnostics) || []),
    ...((report.aiReview && report.aiReview.warnings || []).map((item) => item.diagnostic).filter(Boolean))
  ];
}

function smallModule(moduleName) {
  return `module ${moduleName}
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = const.i32 1
  return %ok
}
`;
}

function largeAirModule(moduleName, functionName, statements) {
  const lines = [
    `module ${moduleName}`,
    "capabilities { }",
    "",
    `export func ${functionName}(value: i32) -> i32 {`,
    "entry:",
    "  %one:i32 = const.i32 1",
    "  %v0:i32 = i32.add %value, %one"
  ];
  for (let i = 1; i < statements; i += 1) {
    lines.push(`  %v${i}:i32 = i32.add %v${i - 1}, %one`);
  }
  lines.push(`  return %v${statements - 1}`);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
