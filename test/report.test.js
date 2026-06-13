const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createAiReviewReport } = require("../src/ai_review");
const { normalizeDiagnostic, sortDiagnostics } = require("../src/diagnostics");
const { parseAir } = require("../src/parser");

const root = path.resolve(__dirname, "..");
const node = process.execPath;
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "report-test");
const aiFixtures = path.join(root, "test", "fixtures", "ai_review");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const slopSource = `module ai_slop_review
const UNUSED_ID:i32 = 44
capabilities { debug, time }
effects { debug.metric <= 4 }

extern debug.metric(id: i32, value: i32) -> void
extern time.now_ms() -> i64

export func run() -> i32 {
entry:
  %slot0_x:i32 = 42
  %slot1_x:i32 = 42
  %slot2_x:i32 = 42
  %mat0_cond:bool = false
  %mat1_cond:bool = false
  %mat2_cond:bool = true
  %mat0:i32 = select.i32 %mat0_cond, 11, 0
  %mat1:i32 = select.i32 %mat1_cond, 12, %mat0
  %mat2:i32 = select.i32 %mat2_cond, 13, %mat1
  @debug.metric(9, 1)
  @debug.metric(42, %slot0_x)
  return %slot0_x
}
`;

const airFile = path.join(tmp, "slop.air");
fs.writeFileSync(airFile, slopSource);

const first = runJson(["report", airFile, "--ai-review"]);
const secondText = run(["report", airFile, "--ai-review"]);
assert.strictEqual(JSON.stringify(first, null, 2) + "\n", secondText);
assert.strictEqual(first.status, "pass");
assert.strictEqual(first.aiReview.status, "warn");
assert.deepStrictEqual(
  first.aiReview.warnings.map((item) => item.id),
  first.aiReview.warnings.map((item) => item.id).slice().sort()
);
assert(first.aiReview.repeatedLiterals.some((item) => item.value === "42" && item.count >= 4));
assert(first.aiReview.magicHandleCandidates.some((item) => item.callee === "debug.metric" && item.value === "42"));
assert(first.aiReview.unused.externs.includes("time.now_ms"));
assert(first.aiReview.unused.constants.includes("UNUSED_ID"));
assert(first.aiReview.tableLikePatterns.some((item) => item.prefix === "slot"));
assert(first.aiReview.selectChainAsTablePatterns.some((item) => item.function === "run" && item.generatedCandidate === true && item.suggestion === "generated static table module"));
assert(first.aiReview.debugMetricEvents.some((item) => item.reason === "literal pulse value"));
const debugMetricDiagnostic = first.aiReview.warnings.find((item) => item.id === "debug-metric-event-bus").diagnostic;
assert.strictEqual(debugMetricDiagnostic.code, "air.review.debug_metric_event_bus");
assert.strictEqual(debugMetricDiagnostic.legacyId, "debug-metric-event-bus");
assert.strictEqual(debugMetricDiagnostic.severity, "warn");
assert.strictEqual(debugMetricDiagnostic.category, "review");
assert.strictEqual(debugMetricDiagnostic.source, "ai-review");
assert.strictEqual(debugMetricDiagnostic.packageStatusImpact, "warn");
assert(first.aiReview.repairHints.some((hint) => /module constant|generated package-local handle/.test(hint)));
assert(first.aiReview.repairHints.some((hint) => /Consider a readonly tablegroup if these values are related by row\./.test(hint)));

const withoutAiReview = runJson(["report", airFile]);
assert.strictEqual(withoutAiReview.aiReview, undefined);

const packageDir = path.join(tmp, "package");
fs.mkdirSync(packageDir, { recursive: true });
fs.writeFileSync(path.join(packageDir, "module.air"), slopSource);
fs.writeFileSync(path.join(packageDir, "module.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
fs.writeFileSync(path.join(packageDir, "air.package.json"), JSON.stringify({
  name: "ai-review-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["debug"],
  targetProfiles: ["cli"],
  manifests: {}
}, null, 2));

const packageReport = runFails(["package-check", packageDir, "--profile", "cli", "--json"]);
assert.strictEqual(packageReport.status, "fail");
assert(packageReport.checks.some((item) => item.id === "package-capability:time"));
const packageCapabilityDiagnostic = packageReport.checks.find((item) => item.id === "package-capability:time").diagnostic;
assert.strictEqual(packageCapabilityDiagnostic.code, "air.package.package_capability");
assert.strictEqual(packageCapabilityDiagnostic.source, "package-check");
assert.strictEqual(packageCapabilityDiagnostic.packageStatusImpact, "fail");
assert(packageReport.diagnostics.some((item) => item.legacyId === "package-capability:time" && item.code === "air.package.package_capability"));
assert.strictEqual(packageReport.aiReview.packageProfileMismatch.status, "fail");
assert(packageReport.aiReview.warnings.some((item) => item.id === "package-profile-mismatch"));
assert.strictEqual(packageReport.aiReview.warnings.find((item) => item.id === "package-profile-mismatch").code, "air.package.profile_mismatch");
assert(packageReport.aiReview.repairHints.some((hint) => /declare missing capabilities/.test(hint)));

const largeFunction = reviewFixture("large_function.air", { largeFunctionStatements: 4 });
assert(largeFunction.warnings.some((item) => item.id === "large-function:run"));
assert.strictEqual(largeFunction.topLargeFunctions[0].name, "run");
assert.strictEqual(largeFunction.topLargeModules[0].module, "ai_review_large_function");

const repeatedLiteral = reviewFixture("repeated_literal.air", { repeatedLiteralCount: 3 });
assert(repeatedLiteral.warnings.some((item) => item.id === "repeated-literal:number:42"));

const debugEvent = reviewFixture("debug_metric_event_bus.air");
assert(debugEvent.warnings.some((item) => item.id === "debug-metric-event-bus"));

const slotFamily = reviewFixture("slot_family.air", { tableLikeGroupSize: 3, maxMutableGlobalsPerModule: 2 });
assert(slotFamily.warnings.some((item) => item.id === "table-like-patterns"));
assert(slotFamily.warnings.some((item) => item.id === "mutable-global-budget"));
const slotFamilyHint = slotFamily.warnings.find((item) => item.id === "table-like-patterns").repairHint;
assert(/future declared pools/.test(slotFamilyHint));
assert(/generated handles/.test(slotFamilyHint));
assert(/command buffers/.test(slotFamilyHint));
assert(!/Consider a readonly tablegroup if these values are related by row\./.test(slotFamilyHint));

const budgetPackage = path.join(tmp, "budget-package");
fs.mkdirSync(budgetPackage, { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "frame_budget.air"), path.join(budgetPackage, "module.air"));
fs.writeFileSync(path.join(budgetPackage, "air.package.json"), JSON.stringify({
  name: "ai-review-budget-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  aiReview: {
    thresholds: {
      maxExportedEntryStatements: 3
    },
    failOn: ["entry-frame-budget"]
  }
}, null, 2));
const budgetFail = runFails(["package-check", budgetPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(budgetFail.status, "fail");
assert(budgetFail.checks.some((item) => item.id === "ai-review:entry-frame-budget:frame"));
assert(budgetFail.errors.some((item) => /reviewPolicy failed on entry-frame-budget:frame/.test(item)));

const reviewPolicyEntryPackage = path.join(tmp, "review-policy-entry-package");
fs.mkdirSync(reviewPolicyEntryPackage, { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "frame_budget.air"), path.join(reviewPolicyEntryPackage, "module.air"));
fs.writeFileSync(path.join(reviewPolicyEntryPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-entry-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    profile: "interactive",
    thresholds: {
      largeEntryStatements: 3
    },
    gates: {
      largeEntryFunction: "fail"
    }
  }
}, null, 2));
const reviewPolicyEntryFail = runFails(["package-check", reviewPolicyEntryPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(reviewPolicyEntryFail.status, "fail");
assert.strictEqual(reviewPolicyEntryFail.aiReview.thresholds.maxExportedEntryStatements, 3);
assert(reviewPolicyEntryFail.errors.some((item) => /reviewPolicy failed on entry-frame-budget:frame/.test(item)));

const reviewPolicyCodeGatePackage = path.join(tmp, "review-policy-code-gate-package");
fs.mkdirSync(reviewPolicyCodeGatePackage, { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "frame_budget.air"), path.join(reviewPolicyCodeGatePackage, "module.air"));
fs.writeFileSync(path.join(reviewPolicyCodeGatePackage, "air.package.json"), JSON.stringify({
  name: "review-policy-code-gate-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: {
      largeEntryStatements: 3
    },
    gates: {
      "air.review.large_entry": "fail"
    }
  }
}, null, 2));
const reviewPolicyCodeGateFail = runFails(["package-check", reviewPolicyCodeGatePackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(reviewPolicyCodeGateFail.status, "fail");
assert.strictEqual(reviewPolicyCodeGateFail.reviewPolicy.schemaVersion, "0.15");
assert(reviewPolicyCodeGateFail.errors.some((item) => /reviewPolicy failed on entry-frame-budget:frame/.test(item)));

const reviewPolicyPackage = path.join(tmp, "review-policy-package");
fs.mkdirSync(reviewPolicyPackage, { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "large_function.air"), path.join(reviewPolicyPackage, "module.air"));
fs.writeFileSync(path.join(reviewPolicyPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    profile: "batch",
    pathClasses: {
      authored: ["module.air"],
      generated: ["generated/**/*.air"],
      vendor: ["kits/**"]
    },
    thresholds: {
      largeFunctionStatements: 4
    },
    gates: {
      largeFunctionStatements: "warn"
    }
  }
}, null, 2));
const reviewPolicyWarn = JSON.parse(run(["package-check", reviewPolicyPackage, "--profile", "verifier-only", "--source-only", "--json"]));
assert.strictEqual(reviewPolicyWarn.status, "warn");
assert.strictEqual(reviewPolicyWarn.aiReview.reviewPolicy.profile, "batch");
assert.strictEqual(reviewPolicyWarn.aiReview.reviewPolicy.pathClass, "authored");
assert(reviewPolicyWarn.aiReview.warnings.some((item) => item.id === "large-function:run"));
const reviewPolicyPackageReportText = run(["report", "package", reviewPolicyPackage, "--json"]);
assert.strictEqual(run(["report", "package", reviewPolicyPackage, "--json"]), reviewPolicyPackageReportText);
const reviewPolicyPackageReport = JSON.parse(reviewPolicyPackageReportText);
assert.strictEqual(reviewPolicyPackageReport.status, "warn");
assert.strictEqual(reviewPolicyPackageReport.reviewPolicy.profile, "batch");
assert.strictEqual(reviewPolicyPackageReport.aiReview.reviewPolicy.pathClass, "authored");
assert(reviewPolicyPackageReport.aiReview.warnings.some((item) => item.id === "large-function:run"));
assert(reviewPolicyPackageReport.warnings.some((item) => /ai-review:module\.air:large-function:run/.test(item)));

const generatedReviewPolicyPackage = path.join(tmp, "review-policy-generated-package");
fs.mkdirSync(path.join(generatedReviewPolicyPackage, "generated"), { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "large_function.air"), path.join(generatedReviewPolicyPackage, "generated", "module.air"));
fs.writeFileSync(path.join(generatedReviewPolicyPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-generated-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "generated/module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    profile: "interactive",
    pathClasses: {
      authored: ["src/**/*.air"],
      generated: ["generated/**/*.air"],
      vendor: ["kits/**"]
    },
    thresholds: {
      largeFunctionStatements: 4
    },
    pathClassThresholds: {
      generated: {
        largeFunctionStatements: 999
      }
    },
    gates: {
      largeFunctionStatements: "fail"
    }
  }
}, null, 2));
const generatedReviewPolicy = JSON.parse(run(["package-check", generatedReviewPolicyPackage, "--profile", "verifier-only", "--source-only", "--json"]));
assert.strictEqual(generatedReviewPolicy.status, "pass");
assert.strictEqual(generatedReviewPolicy.aiReview.reviewPolicy.pathClass, "generated");
assert(!generatedReviewPolicy.aiReview.warnings.some((item) => item.id === "large-function:run"));
const generatedReviewPolicyReport = JSON.parse(run(["report", "package", generatedReviewPolicyPackage, "--json"]));
assert.strictEqual(generatedReviewPolicyReport.aiReview.reviewPolicy.pathClass, "generated");
assert(!generatedReviewPolicyReport.aiReview.warnings.some((item) => item.id === "large-function:run"));

const graphReviewPackage = path.join(tmp, "graph-review-package");
fs.mkdirSync(path.join(graphReviewPackage, "src"), { recursive: true });
fs.mkdirSync(path.join(graphReviewPackage, "generated"), { recursive: true });
fs.mkdirSync(path.join(graphReviewPackage, "kits"), { recursive: true });
fs.writeFileSync(path.join(graphReviewPackage, "src", "main.air"), `module graph_main
use "../generated/generated_worker.air" as generated_worker
use "../kits/vendor.air" as vendor
capabilities { }

export func run(seed: i32) -> i32 {
entry:
  %generated:i32 = @generated_worker.generated_value(%seed)
  %out:i32 = @vendor.heavy(%generated)
  return %out
}
`);
fs.writeFileSync(path.join(graphReviewPackage, "generated", "generated_worker.air"), largeAirModule("generated_worker", "generated_value", 12));
fs.writeFileSync(path.join(graphReviewPackage, "kits", "vendor.air"), largeAirModule("vendor", "heavy", 8));
fs.writeFileSync(path.join(graphReviewPackage, "air.package.json"), JSON.stringify({
  name: "graph-review-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "src/main.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    profile: "graph-review",
    pathClasses: {
      authored: ["src/**/*.air"],
      generated: ["generated/**/*.air"],
      vendor: ["kits/**"]
    },
    thresholds: {
      largeFunctionStatements: 4
    },
    pathClassThresholds: {
      generated: {
        largeFunctionStatements: 999
      }
    },
    gates: {
      largeFunctionStatements: "warn"
    }
  }
}, null, 2));

const graphReviewReport = JSON.parse(run(["report", "package", graphReviewPackage, "--json"]));
assert.strictEqual(graphReviewReport.packageReview.status, "warn");
assert.deepStrictEqual(graphReviewReport.moduleReviews.map((item) => item.path), [
  "generated/generated_worker.air",
  "kits/vendor.air",
  "src/main.air"
]);
assert.strictEqual(graphReviewReport.moduleReviews.find((item) => item.path === "generated/generated_worker.air").pathClass, "generated");
assert.strictEqual(graphReviewReport.moduleReviews.find((item) => item.path === "kits/vendor.air").pathClass, "vendor");
assert(!graphReviewReport.packageReview.warnings.some((item) => item.module === "generated/generated_worker.air" && item.id === "large-function:generated_value"));
assert(graphReviewReport.packageReview.warnings.some((item) => item.module === "kits/vendor.air" && item.id === "large-function:heavy"));
assert(graphReviewReport.diagnostics.some((item) => item.file === "kits/vendor.air" && item.code === "air.review.large_function"));
assert.deepStrictEqual(graphReviewReport.packageReview.topLargeFunctions.map((item) => `${item.module}:${item.name}`), [
  "generated/generated_worker.air:generated_value",
  "kits/vendor.air:heavy",
  "src/main.air:run"
]);

const graphReviewWarn = JSON.parse(run(["package-check", graphReviewPackage, "--profile", "verifier-only", "--source-only", "--json"]));
assert.strictEqual(graphReviewWarn.status, "warn");
assert(graphReviewWarn.checks.some((item) => item.id === "ai-review:large-function:heavy" && item.status === "warn"));
assert(!graphReviewWarn.errors.some((item) => /reviewPolicy failed on large-function:heavy/.test(item)));

const graphReviewFailManifest = JSON.parse(fs.readFileSync(path.join(graphReviewPackage, "air.package.json"), "utf8"));
graphReviewFailManifest.reviewPolicy.gates.largeFunctionStatements = "fail";
fs.writeFileSync(path.join(graphReviewPackage, "air.package.json"), JSON.stringify(graphReviewFailManifest, null, 2));
const graphReviewFail = runFails(["package-check", graphReviewPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(graphReviewFail.status, "fail");
assert(graphReviewFail.errors.some((item) => /reviewPolicy failed on large-function:heavy/.test(item)));

const pathClassSpecificityPackage = path.join(tmp, "review-policy-path-class-specificity");
fs.mkdirSync(path.join(pathClassSpecificityPackage, "generated", "vendor"), { recursive: true });
fs.writeFileSync(path.join(pathClassSpecificityPackage, "generated", "vendor", "module.air"), largeAirModule("vendor_generated", "heavy", 8));
fs.writeFileSync(path.join(pathClassSpecificityPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-path-class-specificity",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "generated/vendor/module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    pathClassOrder: ["authored", "generated", "vendor"],
    pathClasses: {
      generated: ["generated/**/*.air"],
      vendor: ["generated/vendor/**/*.air"]
    },
    thresholds: {
      largeFunctionStatements: 4
    },
    pathClassThresholds: {
      vendor: {
        largeFunctionStatements: 999
      }
    },
    gates: {
      "air.review.large_function": "fail"
    }
  }
}, null, 2));
const pathClassSpecificity = JSON.parse(run(["package-check", pathClassSpecificityPackage, "--profile", "verifier-only", "--source-only", "--json"]));
assert.strictEqual(pathClassSpecificity.status, "pass");
assert.strictEqual(pathClassSpecificity.aiReview.reviewPolicy.pathClass, "vendor");

const pathClassAmbiguousPackage = path.join(tmp, "review-policy-path-class-ambiguous");
fs.mkdirSync(path.join(pathClassAmbiguousPackage, "ambiguous"), { recursive: true });
fs.writeFileSync(path.join(pathClassAmbiguousPackage, "ambiguous", "module.air"), largeAirModule("ambiguous_module", "heavy", 8));
fs.writeFileSync(path.join(pathClassAmbiguousPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-path-class-ambiguous",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "ambiguous/module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    pathClassOrder: ["vendor", "generated", "authored"],
    pathClasses: {
      generated: ["ambiguous/**/*.air"],
      vendor: ["ambiguous/**/*.air"]
    },
    thresholds: {
      largeFunctionStatements: 999
    }
  }
}, null, 2));
const pathClassAmbiguous = JSON.parse(run(["report", "package", pathClassAmbiguousPackage, "--json"]));
assert.strictEqual(pathClassAmbiguous.aiReview.reviewPolicy.pathClass, "vendor");
assert(pathClassAmbiguous.reviewPolicyReport.pathClassDiagnostics.some((item) => item.code === "air.review.path_class_ambiguous" && item.file === "ambiguous/module.air"));

const waiverPackage = path.join(tmp, "review-policy-waiver-package");
fs.mkdirSync(waiverPackage, { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "large_function.air"), path.join(waiverPackage, "module.air"));
fs.writeFileSync(path.join(waiverPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-waiver-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: {
      largeFunctionStatements: 4
    },
    gates: {
      "air.review.large_function": "fail"
    },
    waivers: [
      {
        code: "air.review.large_function",
        file: "module.air",
        reason: "known compact fixture for reviewPolicy waiver test"
      }
    ]
  }
}, null, 2));
const waiverReport = JSON.parse(run(["package-check", waiverPackage, "--profile", "verifier-only", "--source-only", "--json"]));
assert.strictEqual(waiverReport.status, "pass");
assert.strictEqual(waiverReport.reviewPolicyReport.waivers[0].status, "active");
assert(waiverReport.packageReview.warnings.some((item) => item.id === "large-function:run" && item.waived === true && item.waiver.reason));

const expiredWaiverPackage = path.join(tmp, "review-policy-expired-waiver-package");
fs.cpSync(waiverPackage, expiredWaiverPackage, { recursive: true });
const expiredWaiverManifest = JSON.parse(fs.readFileSync(path.join(expiredWaiverPackage, "air.package.json"), "utf8"));
expiredWaiverManifest.name = "review-policy-expired-waiver-package";
expiredWaiverManifest.reviewPolicy.waivers[0].expires = "2000-01-01";
fs.writeFileSync(path.join(expiredWaiverPackage, "air.package.json"), JSON.stringify(expiredWaiverManifest, null, 2));
const expiredWaiverDev = JSON.parse(run(["package-check", expiredWaiverPackage, "--profile", "verifier-only", "--source-only", "--json"]));
assert.strictEqual(expiredWaiverDev.status, "pass");
assert.strictEqual(expiredWaiverDev.reviewPolicyReport.waivers[0].status, "expired");
const expiredWaiverRc = runFails(["package-check", expiredWaiverPackage, "--profile", "verifier-only", "--source-only", "--release-candidate", "--json"]);
assert.strictEqual(expiredWaiverRc.status, "fail");
assert(expiredWaiverRc.errors.some((item) => /reviewPolicy waiver expired/.test(item)));

const generatedStaleWaiverPackage = path.join(tmp, "review-policy-generated-stale-waiver-package");
fs.mkdirSync(generatedStaleWaiverPackage, { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "large_function.air"), path.join(generatedStaleWaiverPackage, "module.air"));
fs.writeFileSync(path.join(generatedStaleWaiverPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-generated-stale-waiver-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  generatedModules: ["generated/missing.air"],
  reviewPolicy: {
    waivers: [
      {
        code: "air.generated.stale",
        reason: "attempted hard generated-artifact waiver must not suppress package-check"
      }
    ]
  }
}, null, 2));
const generatedStaleWaiver = runFails(["package-check", generatedStaleWaiverPackage, "--profile", "verifier-only", "--source-only", "--json"]);
assert.strictEqual(generatedStaleWaiver.status, "fail");
assert(generatedStaleWaiver.errors.some((item) => /generated module missing: generated\/missing\.air/.test(item)));
assert(generatedStaleWaiver.checks.some((item) => item.id === "review-policy-waiver:0" && item.status === "warn"));

const trendPackage = path.join(tmp, "review-trend-package");
fs.mkdirSync(trendPackage, { recursive: true });
fs.writeFileSync(path.join(trendPackage, "module.air"), largeAirModule("review_trend", "run", 4));
fs.writeFileSync(path.join(trendPackage, "air.package.json"), JSON.stringify({
  name: "review-trend-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    trend: {
      thresholds: {
        functionStatementDelta: 1
      }
    }
  }
}, null, 2));
const trendBaselineText = run(["report", "package", trendPackage, "--review-baseline"]);
assert.strictEqual(run(["report", "package", trendPackage, "--review-baseline"]), trendBaselineText);
const trendBaseline = JSON.parse(trendBaselineText);
assert.strictEqual(trendBaseline.schemaVersion, "0.15");
assert.strictEqual(trendBaseline.metrics.modules["module.air"].functions.run.statements, 5);
assert(!JSON.stringify(trendBaseline).includes(path.resolve(trendPackage)));
const trendBaselineFile = path.join(trendPackage, "air.review.baseline.json");
fs.writeFileSync(trendBaselineFile, trendBaselineText);
fs.writeFileSync(path.join(trendPackage, "module.air"), largeAirModule("review_trend", "run", 8));
const trendCompare = JSON.parse(run(["report", "package", trendPackage, "--compare-baseline", trendBaselineFile, "--json"]));
assert.strictEqual(trendCompare.reviewTrend.status, "warn");
assert(trendCompare.reviewTrend.diagnostics.some((item) => item.code === "air.trend.function_statements_increased" && item.file === "module.air" && item.symbol === "run"));

const debugTrendPackage = path.join(tmp, "review-trend-debug-package");
fs.mkdirSync(debugTrendPackage, { recursive: true });
fs.writeFileSync(path.join(debugTrendPackage, "module.air"), `module debug_trend
capabilities { debug }
effects { debug.metric <= 2 }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  return
}
`);
fs.writeFileSync(path.join(debugTrendPackage, "air.package.json"), JSON.stringify({
  name: "review-trend-debug-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: ["debug"],
  targetProfiles: ["cli"],
  reviewPolicy: {
    trend: {
      thresholds: {
        diagnosticCountDelta: 0
      },
      gates: {
        "diagnostics.air.review.debug_metric_event_bus": "fail"
      }
    }
  }
}, null, 2));
const debugTrendBaselineFile = path.join(debugTrendPackage, "air.review.baseline.json");
fs.writeFileSync(debugTrendBaselineFile, run(["report", "package", debugTrendPackage, "--profile", "cli", "--review-baseline"]));
fs.writeFileSync(path.join(debugTrendPackage, "module.air"), `module debug_trend
capabilities { debug }
effects { debug.metric <= 2 }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  @debug.metric(7, 1)
  return
}
`);
const debugTrendFail = runFails(["report", "package", debugTrendPackage, "--profile", "cli", "--compare-baseline", debugTrendBaselineFile, "--json"]);
assert.strictEqual(debugTrendFail.status, "fail");
assert(debugTrendFail.reviewTrend.diagnostics.some((item) =>
  item.code === "air.trend.diagnostic_count_increased" &&
  item.metric === "diagnostics.air.review.debug_metric_event_bus" &&
  item.fields.diagnosticCode === "air.review.debug_metric_event_bus" &&
  item.packageStatusImpact === "fail"
));

const ignoredGeneratedTrendPackage = path.join(tmp, "review-trend-generated-ignored");
fs.mkdirSync(path.join(ignoredGeneratedTrendPackage, "generated"), { recursive: true });
fs.writeFileSync(path.join(ignoredGeneratedTrendPackage, "generated", "module.air"), largeAirModule("generated_ignored", "run", 4));
fs.writeFileSync(path.join(ignoredGeneratedTrendPackage, "air.package.json"), JSON.stringify({
  name: "review-trend-generated-ignored",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "generated/module.air",
  capabilities: [],
  targetProfiles: ["verifier-only"],
  reviewPolicy: {
    pathClasses: {
      generated: ["generated/**/*.air"]
    },
    trend: {
      ignorePathClasses: ["generated"],
      thresholds: {
        functionStatementDelta: 1
      }
    }
  }
}, null, 2));
const ignoredGeneratedBaseline = path.join(ignoredGeneratedTrendPackage, "air.review.baseline.json");
fs.writeFileSync(ignoredGeneratedBaseline, run(["report", "package", ignoredGeneratedTrendPackage, "--review-baseline"]));
fs.writeFileSync(path.join(ignoredGeneratedTrendPackage, "generated", "module.air"), largeAirModule("generated_ignored", "run", 12));
const ignoredGeneratedCompare = JSON.parse(run(["report", "package", ignoredGeneratedTrendPackage, "--compare-baseline", ignoredGeneratedBaseline, "--json"]));
assert.strictEqual(ignoredGeneratedCompare.reviewTrend.status, "pass");
assert(!ignoredGeneratedCompare.reviewTrend.diagnostics.some((item) => item.file === "generated/module.air"));

const debugPolicyPackage = path.join(tmp, "review-policy-debug-package");
fs.mkdirSync(debugPolicyPackage, { recursive: true });
fs.copyFileSync(path.join(aiFixtures, "debug_metric_event_bus.air"), path.join(debugPolicyPackage, "module.air"));
fs.writeFileSync(path.join(debugPolicyPackage, "air.package.json"), JSON.stringify({
  name: "review-policy-debug-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: ["debug"],
  targetProfiles: ["cli"],
  reviewPolicy: {
    gates: {
      debugMetricEventBus: "fail"
    }
  }
}, null, 2));
const debugPolicyFail = runFails(["package-check", debugPolicyPackage, "--profile", "cli", "--source-only", "--json"]);
assert.strictEqual(debugPolicyFail.status, "fail");
assert(debugPolicyFail.aiReview.warnings.some((item) => item.id === "debug-metric-event-bus"));
assert(debugPolicyFail.errors.some((item) => /reviewPolicy failed on debug-metric-event-bus/.test(item)));

const normalized = normalizeDiagnostic({
  legacyId: "generated-handles",
  status: "fail",
  message: "generated handle file stale: generated/assets.air",
  repairHint: "run: node bin/airc.js generate-handles <package-dir>",
  source: "package-check"
});
assert.strictEqual(normalized.code, "air.generated.stale");
assert.strictEqual(normalized.severity, "fail");
assert.strictEqual(normalized.packageStatusImpact, "fail");
assert.deepStrictEqual(
  sortDiagnostics([
    normalizeDiagnostic({ legacyId: "debug-metric-event-bus", message: "b" }),
    normalizeDiagnostic({ legacyId: "large-function:run", message: "a" })
  ]).map((item) => item.code),
  ["air.review.debug_metric_event_bus", "air.review.large_function"]
);

console.log("ok: report AI review tests");

function run(args) {
  return execFileSync(node, [airc, ...args], { cwd: root, encoding: "utf8" });
}

function runJson(args) {
  return JSON.parse(run(args));
}

function runFails(args) {
  try {
    run(args);
  } catch (err) {
    return JSON.parse(String(err.stdout));
  }
  throw new Error(`expected command to fail: ${args.join(" ")}`);
}

function reviewFixture(name, thresholds = {}) {
  const file = path.join(aiFixtures, name);
  const source = fs.readFileSync(file, "utf8");
  return createAiReviewReport(parseAir(source, file), { source, thresholds });
}

function largeAirModule(moduleName, functionName, statements) {
  const lines = [
    `module ${moduleName}`,
    "capabilities { }",
    "",
    `export func ${functionName}(value: i32) -> i32 {`,
    "entry:",
    "  %v0:i32 = add %value, 1"
  ];
  for (let i = 1; i < statements; i += 1) {
    lines.push(`  %v${i}:i32 = add %v${i - 1}, 1`);
  }
  lines.push(`  return %v${statements - 1}`);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
