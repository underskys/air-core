const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  parseAir,
  verifyModule,
  formatModule,
  explainModule,
  auditModule,
  emitWit,
  loadGfxManifest,
  validateGfxManifest,
  emitGfxWit,
  createGfxImportManifest,
  lowerToWat,
  watToWasm,
  buildPackage,
  loadPackage,
  instantiateAirModule,
  createGpuImports,
  createInputImports,
  createIoImports,
  createUtilityImports,
  validatePackageDir,
  emitGfxStdlib,
  emitStdlib,
  emitRegistry,
  AIR_VERSION,
  AIR_ABI_VERSION,
  HOST_SIGNATURES,
  GPU_SIGNATURES,
  INPUT_SIGNATURES,
  collectEffectUsage,
  hostSignaturesForCapability,
  hostFunctionNamesForCapability,
  createConformanceReport,
  createAudioAuthorityReport
} = require("../src");
const { diagnosticHintsFromMessage, normalizeDiagnostic } = require("../src/diagnostics");
const { compileSceneLayout } = require("../tools/scene-compiler");

const root = path.resolve(__dirname, "..");
const isReviewBundleMode = process.env.AIR_REVIEW_BUNDLE === "1";

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

function readExample(name) {
  return fs.readFileSync(path.join(root, "examples", name), "utf8");
}

function readManifest(name) {
  return loadGfxManifest(path.join(root, "examples", name));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const CONFORMANCE_REPORT_KEYS = [
  "reportVersion",
  "status",
  "moduleName",
  "airAbiVersion",
  "constants",
  "staticTables",
  "staticTableSummary",
  "tableGroups",
  "tableGroupSummary",
  "stateSegments",
  "stateSegmentSummary",
  "pools",
  "poolSummary",
  "exports",
  "capabilities",
  "hostImports",
  "strictHostAbi",
  "manifestFeatures",
  "loadedAssets",
  "resources",
  "audio",
  "unsupportedHostFeatures",
  "fallbackBehavior",
  "warnings",
  "errors",
  "repairHint"
];

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

(async () => {
  await test("parser and verifier accept grep demo", () => {
    const mod = parseAir(readExample("grep.air"), "grep.air");
    assert.strictEqual(mod.name, "grep_demo");
    assert.strictEqual(verifyModule(mod), true);
  });

  await test("formatter is deterministic", () => {
    const mod = parseAir(readExample("grep.air"), "grep.air");
    const once = formatModule(mod);
    const twice = formatModule(parseAir(once, "formatted.air"));
    assert.strictEqual(twice, once);
  });

  await test("module-level scalar constants parse, verify, lower, and report", async () => {
    const source = `module constants_demo
const ENEMY_COUNT:i32 = 3
const USE_DEBUG:bool = true
const GRAVITY:f32 = 9.8
capabilities { debug }
effects { debug.metric <= 1 }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> i32 {
entry:
  %bonus:i32 = select.i32 USE_DEBUG, ENEMY_COUNT, 0
  %score:i32 = add 10, %bonus
  @debug.metric(ENEMY_COUNT, %score)
  return %score
}
`;
    const mod = parseAir(source, "constants_demo.air");
    assert.deepStrictEqual(mod.constants.map((constant) => `${constant.name}:${constant.type}`), ["ENEMY_COUNT:i32", "USE_DEBUG:bool", "GRAVITY:f32"]);
    assert.strictEqual(verifyModule(mod), true);
    const formatted = formatModule(mod);
    assert.strictEqual(formatModule(parseAir(formatted, "constants_formatted.air")), formatted);
    assert.match(formatted, /const ENEMY_COUNT:i32 = 3/);
    assert.match(formatted, /const USE_DEBUG:bool = true/);
    const wat = lowerToWat(mod);
    assert.match(wat, /i32\.const 3/);
    assert.match(wat, /i32\.const 1/);
    const wasm = await watToWasm(wat, "constants_demo.air");
    const instance = await instantiateAirModule({
      wasmBytes: wasm,
      imports: { debug: { metric() {} } }
    });
    assert.strictEqual(instance.exports.run(), 13);
    assert.match(explainModule(mod), /Constants: ENEMY_COUNT: i32 = 3, USE_DEBUG: bool = true, GRAVITY: f32 = 9\.8/);
    assert.match(auditModule(mod), /Constants: ENEMY_COUNT:i32=3, USE_DEBUG:bool=true, GRAVITY:f32=9\.8/);
    const report = createConformanceReport(mod);
    assert.deepStrictEqual(report.constants, [
      { name: "ENEMY_COUNT", type: "i32", value: "3" },
      { name: "GRAVITY", type: "f32", value: "9.8" },
      { name: "USE_DEBUG", type: "bool", value: "true" }
    ]);
  });

  await test("module-level constants reject duplicate names, unknown types, and non-literals", () => {
    assert.throws(() => parseAir(`module bad
const VALUE:i32 = 1
const VALUE:i32 = 2
capabilities { }

export func run() -> i32 {
entry:
  return VALUE
}
`, "bad_duplicate_const.air"), /duplicate constant 'VALUE'/);

    assert.throws(() => parseAir(`module bad
const VALUE:str = 1
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`, "bad_const_type.air"), /unknown type 'str'|constant 'VALUE' type 'str' is not supported/);

    assert.throws(() => parseAir(`module bad
const VALUE:i32 = OTHER
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`, "bad_const_initializer.air"), /initializer must be a scalar literal/);
  });

  await test("module-level constants reject namespace collisions", () => {
    assert.throws(() => verifyModule(parseAir(`module bad
const run:i32 = 1
capabilities { }

export func run() -> i32 {
entry:
  return run
}
`, "bad_const_function_collision.air")), /function 'run' conflicts with constant 'run'/);

    assert.throws(() => verifyModule(parseAir(`module bad
const debug_metric:i32 = 1
capabilities { debug }
effects { debug.metric <= 1 }

extern debug_metric(id: i32) -> void

export func run() -> void {
entry:
  return
}
`, "bad_const_extern_collision.air")), /extern 'debug_metric' conflicts with constant 'debug_metric'/);

    assert.throws(() => verifyModule(parseAir(`module bad
const Pair:i32 = 1
capabilities { }

struct Pair { x: i32 }

export func run() -> i32 {
entry:
  return Pair
}
`, "bad_const_struct_collision.air")), /struct 'Pair' conflicts with constant 'Pair'/);
  });

  await test("static scalar tables reject unbounded generated data", () => {
    assert.throws(() => parseAir(`module bad_table
table values:i32[] = [1, 2, 3]
capabilities { }

export func run() -> i32 {
entry:
  return 0
}
`, "bad_unbounded_table.air"), /expected module, capabilities, or func declaration/);
  });

  await test("compiler package version and AIR ABI report from one source", () => {
    assert.strictEqual(AIR_ABI_VERSION, "0.10");
    assert.strictEqual(AIR_VERSION, "0.51.0");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    assert.strictEqual(pkg.version, AIR_VERSION);
    assert.strictEqual(lock.version, AIR_VERSION);
    assert.strictEqual(lock.packages[""].version, AIR_VERSION);
    const out = execFileSync(process.execPath, [path.join(root, "bin", "airc.js"), "version", "--json"], { encoding: "utf8" });
    const info = JSON.parse(out);
    assert.strictEqual(info.version, AIR_VERSION);
    assert.strictEqual(info.abi, AIR_ABI_VERSION);
    const text = execFileSync(process.execPath, [path.join(root, "bin", "airc.js"), "version"], { encoding: "utf8" });
    assert.strictEqual(text.trim(), `AIR ${AIR_VERSION} (AIR ABI ${AIR_ABI_VERSION})`);
  });

  await test("review bundle script includes tests, scripts, and CI metadata", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.strictEqual(pkg.config.reviewBundle.version, "2.0");
    assert.strictEqual(pkg.config.reviewBundle.script, "scripts/make_review_bundle.sh");
    assert.strictEqual(pkg.config.reviewBundle.retention, 10);
    assert.strictEqual(pkg.scripts.snapshot, "bash scripts/make_review_bundle.sh");
    assert.strictEqual(pkg.scripts["test:bundle"], "AIR_REVIEW_BUNDLE=1 npm test");
    const script = fs.readFileSync(path.join(root, pkg.config.reviewBundle.script), "utf8");
    for (const pattern of [".gitlab-ci.yml", "test/*.js", "test/**/*.js", "test/**/*.air", "scripts/*.sh", "scripts/**/*.sh", "scripts/*.json", "scripts/**/*.json", "tools/*.js", "prompts/**/*.md", "examples/**/*.md", "examples/**/*.mjs", "examples/**/*.wgsl", "examples/**/assets/*.gltf", "examples/**/assets/*.glb", "examples/**/assets/*.svg", "kits/**/*.wgsl", "kits/**/*.json", "hosts/**/*.toml", "hosts/**/*.rs", "hosts/**/Cargo.lock"]) {
      assert(script.includes(pattern), `${pattern} missing from review bundle allowlist`);
    }
    assert(script.includes("examples/gpu_arena/assets/*"), "required GFX fixture assets must bypass generic binary/media exclusions");
    assert(script.includes("examples/gpu_arena/shaders/*"), "required GFX fixture shaders must bypass generic binary/media exclusions");
    assert(script.includes("examples/gfx_showcase/assets/*"), "showcase assets must bypass generic binary/media exclusions");
    assert(script.includes("examples/gfx_showcase/shaders/*"), "showcase shaders must bypass generic binary/media exclusions");
    assert(script.includes("examples/package_manifest/assets/*"), "package manifest fixture assets must bypass generic binary/media exclusions");
    assert(script.includes("examples/assets/audio/*"), "asset manifest audio fixtures must bypass generic media exclusions");
    assert(script.includes("examples/assets/models/*"), "asset manifest model fixtures must bypass generic model exclusions");
    assert(script.includes("examples/assets/textures/*"), "asset manifest texture fixtures must bypass generic image exclusions");
    assert(script.includes("examples/assets/sprites/*"), "asset manifest sprite fixtures must bypass generic image exclusions");
    assert(script.includes("prompts/**/*.md"), "prompt library must be included in Core review bundle");
    assert(script.includes("evals/ai_authoring/prompts/*.md"), "AI authoring eval prompts must be included in Core review bundle");
    assert(script.includes("evals/ai_authoring/captured/model_outputs/*.json"), "AI authoring eval captured outputs must be included in Core review bundle");
    assert(script.includes("evals/ai_authoring/captured/repair_transcripts/*.json"), "AI authoring eval repair transcripts must be included in Core review bundle");
    assert(script.includes("evals/ai_authoring/expected/constraints.json"), "AI authoring eval constraints must be included in Core review bundle");
    assert(script.includes("test/fixtures/evidence_report/*.golden.md"), "evidence report golden markdown fixtures must be included in Core review bundle");
    assert(script.includes("test/fixtures/package_diff/README.md"), "package diff fixture README must be included in Core review bundle");
    assert(script.includes("consumer_evidence/README.md"), "consumer evidence README must be included in Core review bundle");
    assert(script.includes("consumer_evidence/DEMO_REGISTRY.json"), "consumer evidence registry must be included in Core review bundle");
    assert(script.includes("consumer_evidence/schemas/*.json"), "consumer evidence schemas must be included in Core review bundle");
    assert(script.includes("consumer_evidence/demos/*/MANIFEST.json"), "consumer evidence demo manifests must be included in Core review bundle");
    assert(script.includes("consumer_evidence/demos/*/PROOF_CARD.md"), "consumer evidence proof cards must be included in Core review bundle");
    const bundleCheck = fs.readFileSync(path.join(root, "scripts", "check_review_bundle.js"), "utf8");
    assert(bundleCheck.includes("collectEvalReviewFixtureRequirements"), "review bundle checker must require AI authoring eval review fixtures");
    assert(bundleCheck.includes("collectEvidenceReportFixtureRequirements"), "review bundle checker must require evidence report golden fixtures");
    assert(bundleCheck.includes("SNAPSHOT_STATUS.txt is dirty"), "review bundle checker must validate dirty snapshot status");
    assert(bundleCheck.includes("FLAG: dirty working tree"), "dirty snapshots must require an explicit red flag");
    assert(bundleCheck.includes("WARNING: dirty working tree"), "dirty planning snapshots must require an explicit warning");
    assert(bundleCheck.includes("AIR_ALLOW_DIRTY_REVIEW_BUNDLE"), "dirty review bundles must require an explicit allow-dirty env/flag");
    assert(bundleCheck.includes("--structure-only"), "review bundle tests must have an explicit structure-only mode");
    assert(bundleCheck.includes("core-rc|review"), "Core review bundles must not mark dirty snapshots OK");
    assert(bundleCheck.includes("dirty planning snapshot"), "allowed dirty bundles must be labelled as dirty planning snapshots");
    assert(script.includes("test/fixtures/assets_minimal/*"), "minimal asset test fixtures must bypass generic binary/media exclusions");
    assert(script.includes("test/fixtures/package_minimal/*"), "minimal package test fixtures must bypass generic binary/media exclusions");
    assert(script.includes("kits/gfx-basic/shaders/*"), "GFX Basic Kit shaders must bypass generic shader exclusions");
    assert(script.includes("BUNDLE_FORMAT_VERSION=\"2.0\""), "review bundle v2 format must be explicit");
    assert(script.includes("AIR_ALLOW_DIRTY_REVIEW_BUNDLE"), "review bundle script must enforce clean Core review snapshots by default");
    assert(script.includes("dirty planning/debug"), "review bundle script must label allowed dirty bundles as planning/debug snapshots");
    assert(script.includes("AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS"), "review bundle script must auto-refresh stale REVIEW_RESULTS by default");
    assert(script.includes("running bash scripts/run_rc_checks.sh before bundling"), "review bundle script must run RC checks before bundling when REVIEW_RESULTS is stale");
    assert(script.includes("REVIEW_RESULTS commit still does not match current source commit after RC refresh"), "review bundle script must fail if refreshed REVIEW_RESULTS is still stale");
    assert(script.includes("BUNDLE_IMAGE_PLACEHOLDERS"), "review bundle script must preserve stripped image paths with placeholders");
    assert(script.includes("BUNDLE_REVIEW_NOTES.md"), "review bundle script must include review-mode notes");
    assert(script.includes("BUNDLE_PLACEHOLDER_FILES.md"), "review bundle script must report placeholder assets");
    assert(script.includes("BUNDLE_RETENTION"), "review bundle script must enforce archive retention");
    assert(script.includes("NAME=\"${BUNDLE_NAME:-${TS}_airlang-review_${SHA}}\""), "review bundle archive name must default to timestamp");
    assert(script.includes("BUNDLE_NAME may contain only letters, numbers, dot, underscore, and hyphen"), "review bundle name override must be validated");
    assert(script.includes("ARCHIVE_BASE"), "review bundle script must support absolute OUT_DIR paths for isolated review checks");
    assert(script.includes("@{upstream}"), "pre-bundle git ritual must detect the current branch upstream");
    assert(!script.includes("origin/core/v0.24..HEAD"), "pre-bundle git ritual must not hardcode core/v0.24 ahead comparison");
    assert(!script.includes("HEAD..origin/core/v0.24"), "pre-bundle git ritual must not hardcode core/v0.24 behind comparison");
    assert(script.includes("PREBUNDLE_GIT_FAILED"), "pre-bundle git ritual failures must be explicit");
    assert(script.includes("git_excludes"), "review bundle script must prune expensive paths before git traversal");
    assert(script.includes("assets_tmp_unused_previous"), "review bundle script must prune archived asset leftovers");
    assert(script.includes("references/full_pose"), "review bundle script must prune full pose reference dumps");
    assert(script.includes("demo/**/assets/**/*.png"), "Core review bundle must prune demo media assets at traversal time");
    assert(script.includes("is_demo_review_excluded_path"), "Core review bundle must not create placeholders for demo media");
    const rcChecks = fs.readFileSync(path.join(root, "scripts", "run_rc_checks.sh"), "utf8");
    assert(rcChecks.includes("v0.21 API gates"), "Core RC checks must run v0.21 API gates when present");
    assert(rcChecks.includes("npm run check:api-gates:v0.21"), "Core RC checks must use the v0.21 API gate npm script");
    assert(rcChecks.includes("API gate violation"), "RED_FLAGS must report API gate violations explicitly");
  });

  await test("review bundle sanity gate catches required test, asset, shader, and tool files", () => {
    if (isReviewBundleMode) {
      console.log("ok - review bundle sanity gate skipped in AIR_REVIEW_BUNDLE mode");
      return;
    }
    const out = execFileSync(process.execPath, [path.join(root, "scripts", "check_review_bundle.js"), "--keep", "--structure-only"], { encoding: "utf8" });
    assert.match(out, /Review bundle sanity check passed/);
    assert.match(out, /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_airlang-review_(?:[a-f0-9]+|nogit)\.(?:zip|tar\.gz)/);
    const archive = out.match(/Archive: (.+\.zip|.+\.tar\.gz)/)?.[1]?.trim();
    assert(archive, "review bundle sanity gate must print archive path");
    try {
      const archiveListing = archive.endsWith(".zip")
        ? execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
        : execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
      assert.match(archiveListing, /\/BUNDLE_OMITTED_FILES\.md/);
      assert.match(archiveListing, /\/BUNDLE_OMITTED_FILES\.jsonl/);
      assert.match(archiveListing, /\/BUNDLE_PLACEHOLDER_FILES\.md/);
      assert.match(archiveListing, /\/BUNDLE_PLACEHOLDER_FILES\.jsonl/);
      assert.match(archiveListing, /\/BUNDLE_REVIEW_NOTES\.md/);
      assert.match(archiveListing, /\/SNAPSHOT_PREBUNDLE_GIT\.txt/);
      assert.match(archiveListing, /\/EXCLUDED_FILES\.txt/);
      assert.doesNotMatch(archiveListing, /\/node_modules\//);
      assert.doesNotMatch(archiveListing, /\/tmp_unused\//);
      assert.doesNotMatch(archiveListing, /\/old_bundles\//);
      assert.doesNotMatch(archiveListing, /\/assets_tmp_unused_previous\//);
      assert.doesNotMatch(archiveListing, /\/references\/full_pose\//);
      assert.doesNotMatch(archiveListing, /\/demo\/contra-platformer\/assets\/.*\.(png|jpe?g|webp|gif|svg|mp3|wav|ogg)$/mi);
      assert.doesNotMatch(archiveListing, /\/demo\/[^/]+\/assets\/.*\.(png|jpe?g|webp|gif|svg|mp3|wav|ogg)$/mi);
      assert.doesNotMatch(archiveListing, /\/demo\/[^/]+\/(public|dist|wasm)\//);
      assert.match(archiveListing, /\/test\/fixtures\/profiles\/portable_gfx\.air/);
      assert.match(archiveListing, /\/test\/fixtures\/profiles\/missing_audio_capability\.air/);
      assert.match(archiveListing, /\/examples\/package_manifest\/assets\/audio\/package_click\.wav/);
      assert.match(archiveListing, /\/examples\/assets\/audio\/music\/jungle-1\.mp3/);
      assert.match(archiveListing, /\/examples\/assets\/audio\/sfx\/heal\.wav/);
      assert.match(archiveListing, /\/examples\/assets\/audio\/silence\.wav/);
      assert.match(archiveListing, /\/examples\/assets\/models\/crate\.glb/);
      assert.match(archiveListing, /\/examples\/assets\/textures\/fallback\.png/);
      assert.match(archiveListing, /\/examples\/assets\/sprites\/player_idle\.png/);
      if (["SUMMARY.md", "CHECKS.json", "RED_FLAGS.md", "COMMANDS.log"].every((name) => fs.existsSync(path.join(root, "REVIEW_RESULTS", name)))) {
        assert.match(archiveListing, /\/REVIEW_RESULTS\/SUMMARY\.md/);
        assert.match(archiveListing, /\/REVIEW_RESULTS\/CHECKS\.json/);
        assert.match(archiveListing, /\/REVIEW_RESULTS\/RED_FLAGS\.md/);
        assert.match(archiveListing, /\/REVIEW_RESULTS\/COMMANDS\.log/);
      }
      if (archive.endsWith(".zip")) {
        const prebundleGit = execFileSync("unzip", ["-p", archive, "*/SNAPSHOT_PREBUNDLE_GIT.txt"], { encoding: "utf8" });
        assert.match(prebundleGit, /\$ git branch --show-current/);
        assert.match(prebundleGit, /\$ git rev-parse HEAD/);
        assert.match(prebundleGit, /\$ git rev-parse --abbrev-ref --symbolic-full-name @\{upstream\}/);
        assert.doesNotMatch(prebundleGit, /PREBUNDLE_GIT_FAILED/);
        if (prebundleGit.includes("core/v0.25")) {
          assert.doesNotMatch(prebundleGit, /origin\/core\/v0\.24/);
        }
        const placeholderReport = execFileSync("unzip", ["-p", archive, "*/BUNDLE_PLACEHOLDER_FILES.jsonl"], { encoding: "utf8" });
        assert.doesNotMatch(placeholderReport, /demo\/[^/]+\/assets\/.*\.(png|jpe?g|webp|gif|svg|mp3|wav|ogg)/i);
      }
    } finally {
      fs.rmSync(path.dirname(path.dirname(archive)), { recursive: true, force: true });
    }
    const slimOut = execFileSync(process.execPath, [path.join(root, "scripts", "check_review_bundle.js"), "--structure-only"], {
      encoding: "utf8",
      env: { ...process.env, STRIP_DEMOS: "1" }
    });
    assert.match(slimOut, /Review bundle sanity check passed/);
  });

  await test("public markdown docs have no broken local links", () => {
    const out = execFileSync(process.execPath, [path.join(root, "scripts", "check_markdown_links.js")], { encoding: "utf8" });
    assert.match(out, /no broken local links/);
  });

  await test("ABI request pipeline keeps canonical requests structured", () => {
    const out = execFileSync(process.execPath, [path.join(root, "scripts", "check_abi_requests.js")], { encoding: "utf8" });
    assert.match(out, /structured requests valid/);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.strictEqual(pkg.scripts["check:abi-requests"], "node scripts/check_abi_requests.js");
    const script = fs.readFileSync(path.join(root, "scripts", "check_abi_requests.js"), "utf8");
    assert(script.includes("Version target"), "ABI request checker must require version targets");
    assert(script.includes("allowedStatuses"), "ABI request checker must validate status values");
    assert(script.includes("allowedTargetLayers"), "ABI request checker must validate target layers");
    assert(script.includes("Host ABI registry impact"), "ABI request checker must require Host ABI registry impact notes");
  });

  await test("ABI request pipeline rejects malformed new request docs", () => {
    const tempRoot = path.join(root, "build", "abi-request-fixture");
    const docsDir = path.join(tempRoot, "docs");
    const requestDir = path.join(docsDir, "abi-requests");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(requestDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "abi-requests.md"), `# ABI Requests Index

Demo request files are evidence, not authority.
Public ABI changes require specs and tests.
Target layer must be classified.
`);
    fs.writeFileSync(path.join(requestDir, "README.md"), `# ABI Request Pipeline

Request
Status
Decision
Source demo/project
Target layer
Version target
Problem
Current Workaround
Alternatives
Why Generic
Non-goals
Verifier impact
Host ABI registry impact
Manifest / package impact
Conformance tests
Acceptance criteria
`);
    fs.writeFileSync(path.join(requestDir, "bad-demo.md"), `# Bad Demo Request

## Request: Bad Direct ABI

Status: maybe
Decision: project-only
Source demo/project: demo/bad
Target layer: public runtime
Version target: v0.11

### Problem

This malformed request tries to bypass triage.
`);
    assert.throws(
      () => execFileSync(process.execPath, [path.join(root, "scripts", "check_abi_requests.js")], {
        encoding: "utf8",
        env: { ...process.env, AIR_ABI_REQUESTS_ROOT: tempRoot },
        stdio: ["ignore", "pipe", "pipe"]
      }),
      /invalid Status|invalid Target layer|missing Non-goals/
    );
  });

  await test("v0.11 prompt-to-module scripted demo runs offline", () => {
    const out = execFileSync(process.execPath, [path.join(root, "scripts", "prompt_to_module_demo.js")], { encoding: "utf8" });
    assert.match(out, /AIR v0\.11 prompt-to-module demo/);
    assert.match(out, /summary: pass/);
    assert.match(out, /module: ai_generated_health_score/);
    assert.match(out, /host imports: debug\.metric/);
    const report = JSON.parse(fs.readFileSync(path.join(root, "build", "prompt-to-module-demo", "report.json"), "utf8"));
    assert.strictEqual(report.status, "pass");
    assert.strictEqual(report.moduleName, "ai_generated_health_score");
    assert.deepStrictEqual(report.capabilities, ["debug"]);
    const packageCheck = fs.readFileSync(path.join(root, "build", "prompt-to-module-demo", "package-check.txt"), "utf8");
    assert.match(packageCheck, /"ok":true/);
  });

  await test("layer guard prevents stdlib resource and demo contamination", () => {
    const out = execFileSync(process.execPath, [path.join(root, "test", "layer_guard.test.js")], { encoding: "utf8" });
    assert.match(out, /layer guard: public surfaces contain no resource packs/);
  });

  await test("layer guard rejects demo vocabulary in stdlib grid helpers", () => {
    const tempRoot = path.join(root, "build", "layer-guard-fixture");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "grid.air"), `module grid
capabilities { }

func terrain_height_world_at(x: i32, z: i32) -> i32 {
entry:
  return 0
}

func contra_player_score_route(player_x: i32, enemy_x: i32) -> i32 {
entry:
  %material_id:i32 = 20
  %out:i32 = add %material_id, %player_x
  return %out
}

func doom_cave_palette_boss(weapon: i32, pickup: i32) -> i32 {
entry:
  %out:i32 = add %weapon, %pickup
  return %out
}
`);
    assert.throws(
      () => execFileSync(process.execPath, [path.join(root, "test", "layer_guard.test.js")], {
        encoding: "utf8",
        env: { ...process.env, AIR_LAYER_GUARD_STDLIB_DIR: tempRoot },
        stdio: ["ignore", "pipe", "pipe"]
      }),
      /grid stdlib helpers must stay generic|grid stdlib public helper names must be generic|contra|doom|platformer|material_id/
    );
  });

  await test("repo AIR examples and stdlib are stored in canonical CLI formatted form", () => {
    const files = ["examples", "stdlib"].flatMap((dir) => {
      const abs = path.join(root, dir);
      return fs.readdirSync(abs).filter((name) => name.endsWith(".air")).sort().map((name) => path.join(dir, name));
    });
    assert(files.length > 0);
    const drift = [];
    for (const relative of files) {
      const file = path.join(root, relative);
      const source = fs.readFileSync(file, "utf8");
      const formatted = execFileSync(process.execPath, [path.join(root, "bin", "airc.js"), "fmt", file], { encoding: "utf8" });
      if (source !== formatted) drift.push(relative);
    }
    assert.deepStrictEqual(drift, [], `run node bin/airc.js fmt <file>.air and commit the result for: ${drift.join(", ")}`);
  });

  await test("canonical examples avoid mixed-unit memory wildcard budgets", () => {
    const files = fs.readdirSync(path.join(root, "examples")).filter((name) => name.endsWith(".air")).sort();
    const offenders = files.filter((name) => /\bmemory\.\*/.test(readExample(name)));
    assert.deepStrictEqual(offenders, [], `replace memory.* with exact memory budget keys in: ${offenders.join(", ")}`);
  });

  await test("explain and audit expose human review surface", () => {
    const mod = parseAir(readExample("memory.air"), "memory.air");
    verifyModule(mod);
    assert.match(explainModule(mod), /allocates a checked linear-memory region/);
    assert.match(auditModule(mod), /Memory risks:/);
  });

  await test("audit and explain summarize global dependencies per function", () => {
    const source = `module globals_demo
capabilities { }

global tick:i32 = const.i32 0
global total:i32 = const.i32 0

func bump(v: i32) -> i32 {
entry:
  %t:i32 = global.get tick
  %out:i32 = i32.add %v, %t
  return %out
}

export func run() -> i32 {
entry:
  %now:i32 = global.get tick
  %next:i32 = call @bump(%now)
  global.set total, %next
  return %next
}
`;
    const mod = parseAir(source, "globals_demo.air");
    verifyModule(mod);
    const audit = auditModule(mod);
    assert.match(audit, /Global dependencies:/);
    assert.match(audit, /bump:\n\s+reads: tick\n\s+writes: none/);
    assert.match(audit, /run:\n\s+reads: tick\n\s+writes: total/);
    const explain = explainModule(mod);
    assert.match(explain, /Global dependencies:/);
    assert.match(explain, /bump:\n\s+reads: tick\n\s+writes: none/);
  });

  await test("memory examples use explicit raw pointer offsets", () => {
    const memory = formatModule(parseAir(readExample("memory.air"), "memory.air"));
    assert.match(memory, /%off:i32 = 0/);
    assert.match(memory, /store\.i32 %ptr, %off, %value/);
    assert.match(memory, /%loaded:i32 = load\.i32 %ptr, %off/);
    assert.doesNotMatch(memory, /store\.i32 %ptr, %value/);
    assert.doesNotMatch(memory, /load\.i32 %ptr\n/);

    const effects = formatModule(parseAir(readExample("effects_contract.air"), "effects_contract.air"));
    assert.match(effects, /store\.i32 %ptr, %off, %value/);
    assert.match(effects, /%loaded:i32 = load\.i32 %ptr, %off/);
  });

  await test("verifier rejects type mismatch", () => {
    const source = `module bad
capabilities { stdio }

func main(args: slice) -> i32 {
entry:
  %msg:slice = const.str "x"
  return %msg
}
`;
    const mod = parseAir(source, "bad.air");
    assert.throws(() => verifyModule(mod), /expected i32, got slice/);
  });

  await test("verifier rejects use after free", () => {
    const source = `module bad
capabilities { stdio }

func main(args: slice) -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  free_region %ptr
  %x:i32 = load.i32 %ptr
  return %x
}
`;
    const mod = parseAir(source, "bad.air");
    assert.throws(() => verifyModule(mod), /not a live region/);
  });

  await test("verifier rejects leaked region at return", () => {
    const source = `module region_leak
capabilities { }

export func run() -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  %zero:i32 = const.i32 0
  return %zero
}
`;
    const mod = parseAir(source, "region_leak.air");
    let err;
    assert.throws(
      () => verifyModule(mod),
      (caught) => {
        err = caught;
        return /air\.memory\.region_leak: region %ptr/.test(caught && caught.message);
      }
    );
    const diagnostic = normalizeDiagnostic(diagnosticHintsFromMessage(err && err.message));
    assert.strictEqual(diagnostic.code, "air.memory.region_leak");
    assert.strictEqual(diagnostic.fields.region, "%ptr");
    assert.strictEqual(diagnostic.fields.returnBlock, "entry");
    assert.match(diagnostic.repairHint, /free_region on all paths/);
  });

  await test("verifier accepts region freed before return", () => {
    const source = `module region_free
capabilities { }

export func run() -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  free_region %ptr
  %zero:i32 = const.i32 0
  return %zero
}
`;
    verifyModule(parseAir(source, "region_free.air"));
  });

  await test("verifier rejects branch path that leaks region", () => {
    const source = `module branch_region_leak
capabilities { }

export func run() -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  %cond:bool = const.bool true
  br_if %cond, freed, leaked
freed:
  free_region %ptr
  %one:i32 = const.i32 1
  return %one
leaked:
  %zero:i32 = const.i32 0
  return %zero
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "branch_region_leak.air")),
      /air\.memory\.region_leak: region %ptr.*block 'leaked'/
    );
  });

  await test("verifier accepts branch paths that all free region", () => {
    const source = `module branch_region_free
capabilities { }

export func run() -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  %cond:bool = const.bool true
  br_if %cond, left, right
left:
  free_region %ptr
  %one:i32 = const.i32 1
  return %one
right:
  free_region %ptr
  %zero:i32 = const.i32 0
  return %zero
}
`;
    verifyModule(parseAir(source, "branch_region_free.air"));
  });

  await test("verifier rejects double free with path-sensitive lifetime", () => {
    const source = `module region_double_free
capabilities { }

export func run() -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  free_region %ptr
  free_region %ptr
  %zero:i32 = const.i32 0
  return %zero
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "region_double_free.air")),
      /cannot free non-live region %ptr/
    );
  });

  await test("verifier rejects undeclared host capability", () => {
    const source = `module bad
capabilities { gfx }

extern input.forward() -> i32

export func frame(t: i32) -> void {
entry:
  %x:i32 = call @input.forward()
  return
}
`;
    const mod = parseAir(source, "bad.air");
    assert.throws(() => verifyModule(mod), /requires capability 'input'/);
  });

  await test("verifier rejects gpu extern without gpu capability", () => {
    const source = `module bad_gpu
capabilities { debug }

extern gpu.begin_pass() -> void

export func frame(t: i32) -> void {
entry:
  call @gpu.begin_pass()
  return
}
`;
    const mod = parseAir(source, "bad_gpu.air");
    assert.throws(() => verifyModule(mod), /requires capability 'gpu'/);
  });

  await test("verifier rejects mismatched high-level gfx signature", () => {
    const source = `module bad_gfx
capabilities { gfx }

extern gfx.draw_cube(x: i32, y: i32) -> void

export func frame(t: i32) -> void {
entry:
  call @gfx.draw_cube(%t, %t)
  return
}
`;
    const mod = parseAir(source, "bad_gfx.air");
    assert.throws(() => verifyModule(mod), /extern gfx\.draw_cube signature must be \(i32, i32, i32, i32, i32\) -> void/);
  });

  await test("verifier accepts dashboard ui host ABI", () => {
    const source = `module dashboard
capabilities { ui }
effects { ui.* <= 15 }

extern ui.begin_frame(width: i32, height: i32, time_ms: i32) -> void
extern ui.panel(id: i32, x: i32, y: i32, w: i32, h: i32, style: i32) -> void
extern ui.label(id: i32, x: i32, y: i32, label: i32, style: i32) -> void
extern ui.badge(id: i32, x: i32, y: i32, label: i32, style: i32) -> void
extern ui.button(id: i32, x: i32, y: i32, w: i32, h: i32, label: i32, style: i32) -> bool
extern ui.input_i32(id: i32, x: i32, y: i32, w: i32, label: i32, value: i32, style: i32) -> i32
extern ui.bar(id: i32, x: i32, y: i32, w: i32, value: i32, max: i32, style: i32) -> void
extern ui.row(id: i32, x: i32, y: i32, w: i32, label: i32, value: i32, style: i32) -> void
extern ui.table(id: i32, x: i32, y: i32, w: i32, h: i32, rows: i32, cols: i32, data: i32, style: i32) -> void
extern ui.metric(id: i32, x: i32, y: i32, label: i32, value: i32, unit: i32, style: i32) -> void
extern ui.chart(id: i32, x: i32, y: i32, w: i32, h: i32, series: i32, style: i32) -> void
extern ui.status(id: i32, x: i32, y: i32, label: i32, severity: i32, style: i32) -> void
extern ui.warning(id: i32, x: i32, y: i32, label: i32, severity: i32, style: i32) -> void
extern ui.sparkline(id: i32, x: i32, y: i32, w: i32, h: i32, data: i32, style: i32) -> void
extern ui.end_frame() -> void

export func frame(t: i32) -> void {
entry:
  call @ui.begin_frame(1280, 720, %t)
  call @ui.panel(1, 24, 24, 520, 220, 1)
  call @ui.label(2, 44, 48, 100, 1)
  call @ui.badge(3, 44, 76, 101, 1)
  %value:i32 = @ui.input_i32(4, 44, 104, 220, 102, 42, 1)
  %pressed:bool = @ui.button(5, 288, 104, 96, 32, 103, 1)
  %pressed_i:i32 = select.i32 %pressed, 1, 0
  call @ui.metric(6, 44, 148, 104, %pressed_i, 200, 1)
  call @ui.bar(7, 44, 188, 460, %value, 100, 1)
  call @ui.row(8, 44, 232, 460, 105, %value, 1)
  call @ui.table(9, 44, 276, 460, 120, 3, 4, 1, 1)
  call @ui.chart(10, 44, 408, 220, 64, 2, 1)
  call @ui.status(11, 288, 408, 106, %pressed_i, 1)
  call @ui.warning(12, 288, 440, 107, %pressed_i, 1)
  call @ui.sparkline(13, 44, 480, 460, 64, 1, 1)
  call @ui.end_frame()
  return
}
`;
    const mod = parseAir(source, "dashboard.air");
    assert.strictEqual(verifyModule(mod), true);
    assert.match(formatModule(mod), /capabilities \{ ui \}/);
  });

  await test("verifier rejects mismatched dashboard ui signature", () => {
    const source = `module bad_ui
capabilities { ui }
effects { ui.* <= 1 }

extern ui.bar(id: i32, x: i32) -> void

export func frame(t: i32) -> void {
entry:
  call @ui.bar(%t, %t)
  return
}
`;
    const mod = parseAir(source, "bad_ui.air");
    assert.throws(() => verifyModule(mod), /extern ui\.bar signature must be \(i32, i32, i32, i32, i32, i32, i32\) -> void/);
  });

  await test("verifier requires ui capability and effect budget", () => {
    const missingCapability = `module bad_ui_capability
capabilities { }
effects { ui.* <= 1 }

extern ui.panel(id: i32, x: i32, y: i32, w: i32, h: i32, style: i32) -> void

export func frame(t: i32) -> void {
entry:
  call @ui.panel(1, 0, 0, 100, 80, 1)
  return
}
`;
    assert.throws(() => verifyModule(parseAir(missingCapability, "bad_ui_capability.air")), /requires capability 'ui'/);

    const missingBudget = `module bad_ui_budget
capabilities { ui }

extern ui.panel(id: i32, x: i32, y: i32, w: i32, h: i32, style: i32) -> void

export func frame(t: i32) -> void {
entry:
  call @ui.panel(1, 0, 0, 100, 80, 1)
  return
}
`;
    assert.throws(() => verifyModule(parseAir(missingBudget, "bad_ui_budget.air")), /ui host call 'ui\.panel' requires an explicit effect budget/);

    const partialBudget = `module bad_ui_partial_budget
capabilities { ui }
effects { ui.panel <= 1 }

extern ui.panel(id: i32, x: i32, y: i32, w: i32, h: i32, style: i32) -> void
extern ui.label(id: i32, x: i32, y: i32, label: i32, style: i32) -> void

export func frame(t: i32) -> void {
entry:
  call @ui.panel(1, 0, 0, 100, 80, 1)
  call @ui.label(2, 4, 4, 100, 1)
  return
}
`;
    assert.throws(() => verifyModule(parseAir(partialBudget, "bad_ui_partial_budget.air")), /ui host call 'ui\.label' requires an explicit effect budget/);

    const rawDom = `module bad_dom
capabilities { ui, dom }

extern dom.query_selector(id: i32) -> i32

export func run() -> i32 {
entry:
  %node:i32 = @dom.query_selector(1)
  return %node
}
`;
    assert.throws(() => verifyModule(parseAir(rawDom, "bad_dom.air")), /unknown capability 'dom'/);
  });

  await test("UI ABI spec and host registry expose stable utility widgets", () => {
    const spec = fs.readFileSync(path.join(root, "spec", "UI_ABI.md"), "utf8");
    for (const name of [
      "ui.begin_frame",
      "ui.panel",
      "ui.label",
      "ui.badge",
      "ui.button",
      "ui.input_i32",
      "ui.input_f32",
      "ui.table",
      "ui.metric",
      "ui.chart",
      "ui.status",
      "ui.warning",
      "ui.end_frame"
    ]) {
      assert(HOST_SIGNATURES.has(name), `${name} missing from host ABI registry`);
      assert(spec.includes(name), `${name} missing from UI_ABI.md`);
    }
    assert.match(spec, /AIR does not receive DOM nodes/);
    assert.match(spec, /CLI host: renders a text fallback/);
  });

  await test("verifier rejects unsupported CFG joins", () => {
    const source = `module bad_cfg
capabilities { stdio }

func main(args: slice) -> i32 {
entry:
  %cond:bool = const.bool true
  br_if %cond, left, right
left:
  br done
right:
  br done
done:
  %code:i32 = const.i32 0
  return %code
}
`;
    const mod = parseAir(source, "bad_cfg.air");
    assert.throws(() => verifyModule(mod), /must terminate with return|joins are not supported/);
  });

  await test("verifier rejects statically visible out-of-region memory access", () => {
    const source = `module bad_memory
capabilities { stdio }

func main(args: slice) -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  %off:i32 = const.i32 4
  %value:i32 = const.i32 99
  store.i32 %ptr, %off, %value
  free_region %ptr
  %code:i32 = const.i32 0
  return %code
}
`;
    const mod = parseAir(source, "bad_memory.air");
    assert.throws(() => verifyModule(mod), /out of region bounds/);
  });

  await test("lowering emits WASI fd_write WAT", () => {
    const mod = parseAir(readExample("grep.air"), "grep.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /wasi_snapshot_preview1/);
    assert.match(wat, /\(export "_start"\)/);
  });

  await test("WAT can compile to WASM with wabt", async () => {
    const mod = parseAir(readExample("grep.air"), "grep.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "grep.air");
    assert.strictEqual(wasm[0], 0x00);
    assert.strictEqual(wasm[1], 0x61);
    assert.strictEqual(wasm[2], 0x73);
    assert.strictEqual(wasm[3], 0x6d);
  });

  await test("memory-only program compiles without WASI imports", async () => {
    const mod = parseAir(readExample("memory.air"), "memory.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.doesNotMatch(wat, /wasi_snapshot_preview1/);
    const wasm = await watToWasm(wat, "memory.air");
    assert.strictEqual(wasm[0], 0x00);
  });

  await test("user function calls lower to wasm calls", async () => {
    const mod = parseAir(readExample("call.air"), "call.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\(func \$add_one/);
    assert.match(wat, /call \$add_one/);
    const wasm = await watToWasm(wat, "call.air");
    assert.strictEqual(wasm[0], 0x00);
  });

  await test("source imports flatten namespaced AIR modules", async () => {
    const fixtureDir = path.join(root, "build", "test-imports");
    fs.mkdirSync(fixtureDir, { recursive: true });
    const helperPath = path.join(fixtureDir, "helper.air");
    fs.writeFileSync(helperPath, `module helper

func add_two(v: i32) -> i32 {
entry:
  %two:i32 = const.i32 2
  %out:i32 = i32.add %v, %two
  return %out
}
`);
    const source = `module import_demo
use "./helper.air" as helper

func main(args: slice) -> i32 {
entry:
  %one:i32 = const.i32 1
  %out:i32 = call @helper.add_two(%one)
  return %out
}
`;
    const mod = parseAir(source, path.join(fixtureDir, "main.air"));
    assert.ok(mod.imports.some((item) => item.alias === "helper"));
    assert.ok(mod.functions.some((fn) => fn.name === "helper.add_two"));
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\(func \$helper_add_two/);
    const wasm = await watToWasm(wat, "import_demo.air");
    assert.strictEqual(wasm[0], 0x00);
  });

  await test("integer bit operations lower to wasm", async () => {
    const source = `module bit_ops
capabilities { }

export func run() -> i32 {
entry:
  %flags:i32 = 18
  %mask:i32 = 16
  %shift:i32 = 1
  %andv:i32 = i32.and %flags, %mask
  %xorv:i32 = i32.xor %andv, %mask
  %shlv:i32 = i32.shl %xorv, %shift
  %shrv:i32 = i32.shr_u %shlv, %shift
  return %shrv
}
`;
    const mod = parseAir(source, "bit_ops.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /i32\.xor/);
    assert.match(wat, /i32\.shl/);
    assert.match(wat, /i32\.shr_u/);
    const wasm = await watToWasm(wat, "bit_ops.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 0);
  });

  await test("bool.not verifies and lowers to i32.eqz", async () => {
    const source = `module bool_not_demo
capabilities { }

export func run() -> i32 {
entry:
  %a:bool = const.bool false
  %b:bool = bool.not %a
  %out:i32 = select.i32 %b, 7, 0
  return %out
}
`;
    const mod = parseAir(source, "bool_not_demo.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /i32\.eqz/);
    const wasm = await watToWasm(wat, "bool_not_demo.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 7);

    const bad = `module bool_not_bad
capabilities { }

export func run() -> bool {
entry:
  %a:i32 = const.i32 1
  %b:bool = bool.not %a
  return %b
}
`;
    assert.throws(() => verifyModule(parseAir(bad, "bool_not_bad.air")), /bool\.not input must be bool|expected bool, got i32/);
  });

  await test("stdlib packet helper exposes generic bitflag check", async () => {
    const source = `module packet_helper_demo
use std.packet
capabilities { }

export func run() -> i32 {
entry:
  %flags:i32 = 18
  %mask:i32 = 2
  %syn_generic:bool = @packet.has_flag(%flags, %mask)
  %syn_i:i32 = select.i32 %syn_generic, 1, 0
  return %syn_i
}
`;
    const mod = parseAir(source, "packet_helper_demo.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\(func \$packet_has_flag/);
    const wasm = await watToWasm(wat, "packet_helper_demo.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 1);
  });

  await test("TCP-specific flag aliases live in network example, not stdlib", async () => {
    const mod = parseAir(readExample("network_tcp_flags.air"), "network_tcp_flags.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\(func \$has_syn/);
    const wasm = await watToWasm(wat, "network_tcp_flags.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 11);
  });

  await test("network reasoning examples verify, lower, and run deterministically", async () => {
    const expected = {
      "network_ipv4_math.air": 14,
      "network_scan_plan.air": 2125,
      "network_tool_capabilities.air": 23,
      "network_dns_diagnose.air": 30,
      "network_route_diagnose.air": 0,
      "network_packet_record.air": 40
    };
    for (const [name, result] of Object.entries(expected)) {
      const mod = parseAir(readExample(name), name);
      verifyModule(mod);
      const wasm = await watToWasm(lowerToWat(mod), name);
      const instance = await WebAssembly.instantiate(wasm, {});
      assert.strictEqual(instance.instance.exports.run(), result, name);
    }
  });

  await test("network ABI spec preserves host-owned network authority boundary", () => {
    const spec = fs.readFileSync(path.join(root, "spec", "NETWORK_ABI.md"), "utf8");
    assert.match(spec, /Hosts own:/);
    assert.match(spec, /sockets, raw packet capture/);
    assert.match(spec, /AIR owns:/);
    assert.match(spec, /Packet Fact Records/);
    assert(spec.includes("`net.*` is reserved for host imports"));
  });

  await test("local composite function boundaries lower to scalar wasm ABI", async () => {
    const source = `module composite_local
struct Pair { x: i32, y: i32 }

func make_pair(x: i32, y: i32) -> Pair {
entry:
  %pair:Pair = struct.new %x, %y
  return %pair
}

func pair_sum(pair: Pair) -> i32 {
entry:
  %x:i32 = struct.get.x %pair
  %y:i32 = struct.get.y %pair
  %out:i32 = i32.add %x, %y
  return %out
}

func main(args: slice) -> i32 {
entry:
  %one:i32 = const.i32 1
  %two:i32 = const.i32 2
  %pair:Pair = call @make_pair(%one, %two)
  %out:i32 = call @pair_sum(%pair)
  return %out
}
`;
    const mod = parseAir(source, "composite_local.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\(func \$make_pair .*result i32 i32/);
    assert.match(wat, /\(func \$pair_sum \(param \$pair__x i32\) \(param \$pair__y i32\)/);
    const wasm = await watToWasm(wat, "composite_local.air");
    assert.strictEqual(wasm[0], 0x00);
  });

  await test("simple branches lower to wasm if", async () => {
    const mod = parseAir(readExample("branch.air"), "branch.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\n    if\n/);
    const wasm = await watToWasm(wat, "branch.air");
    assert.strictEqual(wasm[0], 0x00);
  });

  await test("high-level gfx imports lower to wasm imports", async () => {
    const mod = parseAir(readExample("gfx.air"), "gfx.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\(import "gfx" "draw_cube"/);
    assert.match(wat, /\(export "frame"\)/);
    const wasm = await watToWasm(wat, "gfx.air");
    assert.strictEqual(wasm[0], 0x00);
  });

  await test("WIT metadata exposes high-level gfx capability imports and exports", () => {
    const mod = parseAir(readExample("gfx.air"), "gfx.air");
    verifyModule(mod);
    const wit = emitWit(mod);
    assert.match(wit, /interface gfx/);
    assert.match(wit, /draw-cube: func/);
    assert.match(wit, /world gfx-demo-world/);
    assert.match(wit, /export frame: func/);
  });

  await test("GFX manifest validates gpu arena", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    const result = validateGfxManifest(mod, manifest);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.summary.shaders, 1);
    assert.strictEqual(result.summary.pipelines, 1);
    assert.strictEqual(result.summary.renderTargets, 3);
    assert.strictEqual(result.summary.renderGraphs, 1);
    assert.strictEqual(result.summary.cameras, 1);
    assert.strictEqual(result.summary.nodes, 1);
    assert.strictEqual(result.summary.voxels, 1);
    assert.strictEqual(result.summary.vectors, 1);
    assert.strictEqual(result.summary.vectorDecals, 1);
    assert.strictEqual(result.summary.skyboxes, 1);
  });

  await test("v0.11 conformance report covers utility and gfx stream modules", () => {
    const utility = createConformanceReport(parseAir(readExample("utility_math.air"), "utility_math.air"));
    assert.deepStrictEqual(Object.keys(utility), CONFORMANCE_REPORT_KEYS);
    assert.strictEqual(utility.reportVersion, "0.11");
    assert.strictEqual(utility.status, "pass");
    assert.strictEqual(utility.moduleName, "utility_math");
    assert.strictEqual(utility.airAbiVersion, AIR_ABI_VERSION);
    assert(utility.exports.some((item) => item.name === "run"));
    assert(utility.capabilities.includes("fs"));
    assert(utility.capabilities.includes("net"));
    assert(utility.hostImports.some((item) => item.name === "fs.read_file"));
    assert(utility.hostImports.some((item) => item.name === "net.http_get"));
    assert.strictEqual(utility.strictHostAbi.status, "pass");
    assert.deepStrictEqual(utility.strictHostAbi.errors, []);
    assert.strictEqual(utility.manifestFeatures, null);
    assert.deepStrictEqual(utility.loadedAssets, []);
    assert.strictEqual(utility.resources, null);
    assert.deepStrictEqual(utility.audio.used, true);
    assert.strictEqual(utility.audio.source, "direct-import");
    assert.strictEqual(utility.audio.authority, "module capability");
    assert.strictEqual(utility.audio.status, "pass");
    assert.deepStrictEqual(utility.unsupportedHostFeatures, []);
    assert.deepStrictEqual(utility.fallbackBehavior, []);
    assert.deepStrictEqual(utility.errors, []);

    const gfx = createConformanceReport(parseAir(readExample("gfx.air"), "gfx.air"));
    assert.deepStrictEqual(Object.keys(gfx), CONFORMANCE_REPORT_KEYS);
    assert.strictEqual(gfx.status, "pass");
    assert.strictEqual(gfx.moduleName, "gfx_demo");
    assert.deepStrictEqual(gfx.capabilities, ["gfx"]);
    assert(gfx.exports.some((item) => item.name === "frame"));
    assert(gfx.hostImports.some((item) => item.name === "gfx.draw_cube"));

    const cliOut = execFileSync(process.execPath, [path.join(root, "bin", "airc.js"), "report", path.join(root, "examples", "gfx.air")], { encoding: "utf8" });
    const cliReport = JSON.parse(cliOut);
    assert.deepStrictEqual(Object.keys(cliReport), CONFORMANCE_REPORT_KEYS);
    assert.strictEqual(cliReport.status, "pass");
    assert.strictEqual(cliReport.moduleName, "gfx_demo");
    assert(cliReport.hostImports.some((item) => item.name === "gfx.draw_cube"));

    const dashboard = createConformanceReport(parseAir(
      fs.readFileSync(path.join(root, "examples", "network_dashboard", "network_dashboard.air"), "utf8"),
      "network_dashboard.air"
    ));
    assert.deepStrictEqual(Object.keys(dashboard), CONFORMANCE_REPORT_KEYS);
    assert.strictEqual(dashboard.status, "pass");
    assert.strictEqual(dashboard.moduleName, "network_dashboard");
    assert.deepStrictEqual(dashboard.capabilities, ["debug", "ui"]);
    assert(dashboard.hostImports.some((item) => item.name === "ui.metric"));
    assert(dashboard.hostImports.some((item) => item.name === "debug.metric"));
    assert.strictEqual(dashboard.strictHostAbi.status, "pass");
    assert.deepStrictEqual(dashboard.unsupportedHostFeatures, []);

    const badSource = `module bad_report
capabilities { gpu }
extern gpu.fake_draw(x: i32) -> void

export func frame() -> void {
entry:
  %x:i32 = 0
  @gpu.fake_draw(%x)
  return
}
`;
    const badHost = createConformanceReport(parseAir(badSource, "bad_report.air"));
    assert.strictEqual(badHost.status, "fail");
    assert.strictEqual(badHost.strictHostAbi.status, "fail");
    assert(badHost.strictHostAbi.errors.some((item) => item.includes("gpu.fake_draw")));
    assert(badHost.unsupportedHostFeatures.some((item) => item.includes("gpu.fake_draw")));
    assert.deepStrictEqual(badHost.fallbackBehavior, []);
    assert.match(badHost.repairHint, /registered Host ABI import/);
  });

  await test("v0.11 audio authority report catches AIR-driven host playback boundaries", () => {
    const debugOnlySource = `module audio_boundary
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func frame() -> void {
entry:
  @debug.metric(8, 1)
  return
}
`;
    const debugOnly = parseAir(debugOnlySource, "audio_boundary.air");
    verifyModule(debugOnly);
    const missing = createAudioAuthorityReport(debugOnly, {
      manifest: {
        sfx: { hit: "hit.wav" },
        music: { stage: "stage.mp3" }
      }
    });
    assert.strictEqual(missing.used, true);
    assert.strictEqual(missing.source, "module-driven");
    assert.strictEqual(missing.authority, "missing");
    assert.strictEqual(missing.status, "fail");
    assert(missing.errors.some((item) => item.includes("audio authority missing")));

    const manifestAuthority = createAudioAuthorityReport(debugOnly, {
      manifest: {
        authority: {
          kind: "host-owned",
          source: "module-driven",
          triggers: ["debug.metric:bossActive"]
        },
        music: { boss: "boss.mp3" }
      }
    });
    assert.strictEqual(manifestAuthority.status, "fail");
    assert.strictEqual(manifestAuthority.authority, "package manifest");
    assert.deepStrictEqual(manifestAuthority.triggers, ["debug.metric:bossActive"]);
    assert(manifestAuthority.errors.some((item) => item.includes("debug.metric must not authorize audio")));

    const moduleAuthority = createAudioAuthorityReport(parseAir(`module audio_capability
capabilities { debug, audio }
extern debug.metric(id: i32, value: i32) -> void

export func frame() -> void {
entry:
  @debug.metric(2, 1)
  return
}
`, "audio_capability.air"), {
      manifest: {
        sfx: { shoot: "shoot.wav" },
        authority: {
          kind: "host-owned",
          source: "module-driven",
          triggers: ["debug.metric:bulletActive"]
        }
      }
    });
    assert.strictEqual(moduleAuthority.status, "fail");
    assert.strictEqual(moduleAuthority.authority, "module capability");
    assert(moduleAuthority.errors.some((item) => item.includes("debug.metric must not authorize audio")));

    const hostOwned = createAudioAuthorityReport(debugOnly, {
      manifest: {
        authority: {
          kind: "host-owned",
          source: "host-owned",
          triggers: ["event:user-start"]
        },
        music: { ambience: "ambience.mp3" }
      }
    });
    assert.strictEqual(hostOwned.status, "pass");
    assert.strictEqual(hostOwned.source, "host-owned");
    assert.strictEqual(hostOwned.authority, "package manifest");

    const directAudio = parseAir(`module direct_audio
capabilities { audio }
extern audio.beep(id: i32) -> void

export func run() -> void {
entry:
  @audio.beep(1)
  return
}
`, "direct_audio.air");
    verifyModule(directAudio);
    const directReport = createAudioAuthorityReport(directAudio);
    assert.strictEqual(directReport.status, "pass");
    assert.strictEqual(directReport.source, "direct-import");
    assert.strictEqual(directReport.authority, "module capability");
    assert.deepStrictEqual(directReport.triggers, ["audio.beep"]);
  });

  await test("airc report and package-check expose audio authority status", () => {
    const audioReportDir = path.join(root, "build", "test-audio-report");
    fs.rmSync(audioReportDir, { recursive: true, force: true });
    fs.mkdirSync(audioReportDir, { recursive: true });
    const airFile = path.join(audioReportDir, "direct_audio.air");
    const audioManifest = path.join(audioReportDir, "audio.json");
    fs.writeFileSync(airFile, `module direct_audio_report
capabilities { audio }
extern audio.beep(id: i32) -> void

export func run() -> void {
entry:
  @audio.beep(1)
  return
}
`);
    fs.writeFileSync(audioManifest, JSON.stringify({
      authority: {
        kind: "host-owned",
        source: "direct-import",
        triggers: ["audio.beep:manifest-handle"]
      },
      sfx: { beep: "beep.wav" }
    }, null, 2));
    const reportOut = execFileSync(process.execPath, [
      path.join(root, "bin", "airc.js"),
      "report",
      airFile,
      "--audio-manifest",
      audioManifest
    ], { encoding: "utf8" });
    const report = JSON.parse(reportOut);
    assert.strictEqual(report.audio.used, true);
    assert.strictEqual(report.audio.source, "direct-import");
    assert.strictEqual(report.audio.authority, "module capability");
    assert.strictEqual(report.audio.status, "pass");
    assert(report.audio.triggers.includes("audio.beep"));

    const out = path.join(root, "build", "test-audio-package");
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "demo.wasm"), Buffer.from([0]));
    const metadata = {
      abi: AIR_ABI_VERSION,
      module: "audio_package",
      wasm: "demo.wasm",
      capabilities: ["debug"],
      imports: [{ name: "debug.metric", params: ["i32", "i32"], returnType: "void" }],
      audioManifest: "audio.json"
    };
    fs.writeFileSync(path.join(out, "air-package.json"), JSON.stringify(metadata, null, 2));
    fs.writeFileSync(path.join(out, "audio.json"), JSON.stringify({
      sfx: { hit: "hit.wav" }
    }, null, 2));
    assert.throws(() => validatePackageDir(out), /audio authority check failed: .*audio authority missing/);

    fs.writeFileSync(path.join(out, "audio.json"), JSON.stringify({
      authority: {
        kind: "host-owned",
        source: "module-driven",
        triggers: ["debug.metric:hit"]
      },
      sfx: { hit: "hit.wav" }
    }, null, 2));
    assert.throws(() => validatePackageDir(out), /debug\.metric must not authorize audio|module-driven audio authority is not active/);
  });

  await test("v0.11 conformance report covers gpu manifest and unsupported features", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    const manifest = readManifest("gpu_arena.airgfx.json");
    const report = createConformanceReport(mod, { manifest });
    assert.deepStrictEqual(Object.keys(report), CONFORMANCE_REPORT_KEYS);
    assert.strictEqual(report.status, "pass");
    assert.strictEqual(report.moduleName, "gpu_arena");
    assert.deepStrictEqual(report.capabilities, ["gpu"]);
    assert(report.hostImports.some((item) => item.name === "gpu.execute_render_graph"));
    assert.strictEqual(report.strictHostAbi.status, "pass");
    assert.strictEqual(report.manifestFeatures.ok, true);
    assert.deepStrictEqual(report.manifestFeatures.renderGraphs, ["main_graph"]);
    assert.deepStrictEqual(report.manifestFeatures.pipelines, ["arena_pipeline"]);
    assert(report.manifestFeatures.assets.models.includes("arena_platform"));
    assert(report.loadedAssets.models.some((item) => item.key === "arena_platform" && item.status === "declared"));
    assert(report.loadedAssets.textures.some((item) => item.key === "rune_atlas" && item.status === "declared"));
    assert.deepStrictEqual(report.resources.renderGraphs, ["main_graph"]);
    assert.deepStrictEqual(report.resources.pipelines, ["arena_pipeline"]);
    assert.deepStrictEqual(report.fallbackBehavior, []);
    assert.deepStrictEqual(report.errors, []);

    const fallbackManifest = readManifest("gpu_arena.airgfx.json");
    fallbackManifest.materials.heated_panel.model = "pbr";
    delete fallbackManifest.materials.heated_panel.metallic;
    delete fallbackManifest.materials.heated_panel.roughness;
    const fallbackReport = createConformanceReport(mod, { manifest: fallbackManifest });
    assert.strictEqual(fallbackReport.status, "pass");
    assert(fallbackReport.fallbackBehavior.some((item) => item.includes("defaults to")));

    const badManifest = readManifest("gpu_arena.airgfx.json");
    badManifest.post.unsupported_effect = { kind: "lens_flare" };
    const badReport = createConformanceReport(mod, { manifest: badManifest });
    assert.deepStrictEqual(Object.keys(badReport), CONFORMANCE_REPORT_KEYS);
    assert.strictEqual(badReport.status, "fail");
    assert.strictEqual(badReport.manifestFeatures.ok, false);
    assert(badReport.errors.some((item) => item.includes("unsupported")));
    assert(badReport.unsupportedHostFeatures.some((item) => item.includes("lens_flare")));
    assert.deepStrictEqual(badReport.fallbackBehavior, []);
    assert.match(badReport.repairHint, /unsupported features/);
  });

  await test("scene compiler converts valid layout to instances and collision metadata", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    const generated = compileSceneLayout(layout, base);
    generated.__file = path.join(root, "examples", "gpu_arena.generated.airgfx.json");
    generated.__dir = path.join(root, "examples");
    assert.strictEqual(generated.scene.instances.outer_walls.count, 48);
    assert.strictEqual(generated.scene.instances.cardinal_bridges.count, 4);
    assert.strictEqual(generated.scene.nodes.central_platform.mesh, "circular_platform");
    assert(generated.collision.colliders.length > 0);
    assert(generated.collision.triggers.length > 0);
    const domeLayout = cloneJson(layout);
    domeLayout.skybox.layout = "equirectangular";
    domeLayout.skybox.projection = "spherical";
    const domeGenerated = compileSceneLayout(domeLayout, base);
    assert.strictEqual(domeGenerated.scene.skybox.layout, "equirectangular");
    assert.strictEqual(domeGenerated.scene.skybox.projection, "spherical");
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const result = validateGfxManifest(mod, generated);
    assert.deepStrictEqual(result.errors, []);
    assert(result.summary.instances >= 10);
  });

  await test("scene compiler rejects unknown model references", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    delete base.assets.models.floor_panel_4x4;
    assert.throws(() => compileSceneLayout(layout, base), /unknown model 'floor_panel_4x4'/);
  });

  await test("scene compiler rejects unknown material references", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    layout.instanceGroups[0].material = "missing_material";
    assert.throws(() => compileSceneLayout(layout, base), /unknown material 'missing_material'/);
  });

  await test("scene compiler rejects duplicate instance keys", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    layout.instanceGroups.push(cloneJson(layout.instanceGroups[0]));
    assert.throws(() => compileSceneLayout(layout, base), /duplicate instance key 'main_floor_grid'/);
  });

  await test("scene compiler reports repairable repeat kind errors", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    layout.instanceGroups[0].repeat.kind = "spiral";
    assert.throws(
      () => compileSceneLayout(layout, base),
      /instanceGroups\.main_floor_grid: repeat\.kind 'spiral' is unsupported; expected one of: line, rect_ring, radial/
    );
  });

  await test("scene compiler accepts registry inputs and preserves interaction metadata", () => {
    const base = {
      version: AIR_ABI_VERSION,
      module: "mini_scene",
      renderGraphs: { main: { passes: [] } }
    };
    const layout = {
      kind: "air-gfx-scene-layout",
      module: "mini_scene",
      instanceGroups: [
        {
          key: "cube_0",
          module: "cube_mesh",
          material: "mat_default",
          transforms: [{ position: [0, 1, 2], rotation: [0, 90, 0], scale: [1, 1, 1] }],
          collision: { type: "box", layer: "world", size: [1, 1, 1] }
        }
      ],
      pickups: [{ id: "pickup_0", kind: "health", position: [0, 1, 0] }],
      triggers: [{ id: "trigger_0", kind: "enter", target: "cube_0" }],
      jumpPads: [{ id: "jump_0", impulse: [0, 9, 0] }],
      teleporters: [{ id: "teleport_0", target: "exit_0" }],
      debug: true
    };
    const generated = compileSceneLayout(layout, base, {
      assets: { models: { cube_mesh: { path: "assets/cube.glb" } } },
      materials: { mat_default: { pipeline: "pbr_lite" } },
      generatedAt: "test"
    });
    assert.strictEqual(generated.scene.instances.cube_0.count, 1);
    assert.strictEqual(generated.collision.colliders[0].type, "box");
    assert.strictEqual(generated.scene.interactions.pickups[0].id, "pickup_0");
    assert.strictEqual(generated.scene.interactions.triggers[0].id, "trigger_0");
    assert.strictEqual(generated.scene.interactions.jumpPads[0].id, "jump_0");
    assert.strictEqual(generated.scene.interactions.teleporters[0].id, "teleport_0");
    assert.strictEqual(generated.debug.sceneCompiler.generatedAt, "test");
  });

  await test("scene compiler rejects invalid collision shapes with useful diagnostics", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    layout.instanceGroups[0].collision = { type: "pyramid", layer: "world" };
    assert.throws(
      () => compileSceneLayout(layout, base),
      /instanceGroups\.main_floor_grid\.collision\.type 'pyramid' is unsupported/
    );
  });

  await test("scene compiler rejects unsupported render graph references", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    base.renderGraphs.main_graph.passes[0].pipeline = "missing_pipeline";
    assert.throws(
      () => compileSceneLayout(layout, base),
      /renderGraphs\.main_graph\.passes\.0 references unknown pipeline 'missing_pipeline'/
    );
  });

  await test("scene compiler output is deterministic across runs", () => {
    const layout = readManifest("gpu_arena.layout.json");
    const base = readManifest("gpu_arena.airgfx.json");
    const first = compileSceneLayout(layout, base);
    const second = compileSceneLayout(layout, base);
    assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  });

  await test("scene compiler CLI writes generated manifest that passes gfx-check", () => {
    const out = path.join(root, "examples", "gpu_arena.generated.airgfx.json");
    execFileSync(process.execPath, [
      path.join(root, "tools", "scene-compiler.js"),
      "--layout", path.join(root, "examples", "gpu_arena.layout.json"),
      "--manifest", path.join(root, "examples", "gpu_arena.airgfx.json"),
      "--out", out
    ], { encoding: "utf8" });
    const checked = execFileSync(process.execPath, [
      path.join(root, "bin", "airc.js"),
      "gfx-check",
      path.join(root, "examples", "gpu_arena.air"),
      "--manifest",
      out
    ], { encoding: "utf8" });
    assert.match(checked, /ok: /);
  });

  await test("GFX showcase verifies, compiles layout, and builds package", () => {
    const dir = path.join(root, "examples", "gfx_showcase");
    const layout = JSON.parse(fs.readFileSync(path.join(dir, "showcase.layout.json"), "utf8"));
    const base = JSON.parse(fs.readFileSync(path.join(dir, "showcase.airgfx.json"), "utf8"));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "showcase.generated.airgfx.json"), "utf8"));
    const generated = compileSceneLayout(layout, base, { debug: true });
    assert.deepStrictEqual(generated, expected);

    const mod = parseAir(fs.readFileSync(path.join(dir, "showcase.air"), "utf8"), "showcase.air");
    verifyModule(mod);
    generated.__file = path.join(dir, "showcase.generated.airgfx.json");
    generated.__dir = dir;
    const result = validateGfxManifest(mod, generated);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.summary.skyboxes, 1);
    assert.strictEqual(result.summary.inputs, 4);
    assert.strictEqual(result.summary.postEffects, 2);
    assert(result.summary.instances >= 3);

    const out = path.join(root, "build", "test-gfx-showcase");
    fs.rmSync(out, { recursive: true, force: true });
    execFileSync(process.execPath, [
      path.join(root, "bin", "airc.js"),
      "gfx-build",
      path.join(dir, "showcase.air"),
      "--manifest",
      path.join(dir, "showcase.generated.airgfx.json"),
      "--out",
      out
    ], { encoding: "utf8" });
    const checked = execFileSync(process.execPath, [
      path.join(root, "bin", "airc.js"),
      "package-check",
      out
    ], { encoding: "utf8" });
    assert.match(checked, /"ok":true/);
  });

  await test("WebGPU host reports showcase graphics feature diagnostics explicitly", () => {
    const host = fs.readFileSync(path.join(root, "hosts", "webgpu", "src", "main.ts"), "utf8");
    assert(host.includes("GLB/glTF model asset loading and GPU buffer upload"), "GLB/glTF model loading must be reported by the WebGPU host");
    assert(host.includes("material fallback used"), "material fallback diagnostics must be reported by the WebGPU host");
    for (const feature of [
      "unsupported feature: PBR-lite material shading",
      "unsupported feature: material texture sampling",
      "unsupported feature: bloom post effect",
      "unsupported feature: tone-map post effect"
    ]) {
      assert(host.includes(feature), `${feature} must be reported by the WebGPU host`);
    }
  });

  await test("GFX skybox pass is validated as world environment, not scene mesh", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    const result = validateGfxManifest(mod, manifest);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.summary.meshInstances, 0);
    assert.strictEqual(result.summary.skyboxes, 1);

    const moved = readManifest("gpu_arena.airgfx.json");
    moved.scene.cameras.main.position = [100, 50, -30];
    const movedResult = validateGfxManifest(mod, moved);
    assert.deepStrictEqual(movedResult.errors, []);
    assert.strictEqual(movedResult.summary.skyboxes, result.summary.skyboxes);
    assert.strictEqual(movedResult.summary.meshInstances, result.summary.meshInstances);
  });

  await test("GFX skybox pass rejects scene transforms and depth-writing pipelines", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    const sky = manifest.renderGraphs.main_graph.passes.find((pass) => pass.kind === "skybox");
    sky.transform = { translation: [0, 0, 0] };
    sky.followCamera = true;
    sky.cameraSpace = true;
    sky.inheritPlayerTransform = true;
    manifest.pipelines.arena_pipeline.depthWrite = true;
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("transform is not allowed on skybox/environment passes")));
    assert(result.errors.some((error) => error.includes("followCamera is not allowed on skybox/environment passes")));
    assert(result.errors.some((error) => error.includes("cameraSpace is not allowed on skybox/environment passes")));
    assert(result.errors.some((error) => error.includes("inheritPlayerTransform is not allowed on skybox/environment passes")));
    assert(result.errors.some((error) => error.includes("must disable depth writes")));
  });

  await test("GFX skybox spec locks environment sampling contract", () => {
    const highLevel = fs.readFileSync(path.join(root, "spec", "GFX_HIGH_LEVEL_ABI.md"), "utf8");
    const rawGpu = fs.readFileSync(path.join(root, "spec", "GFX_ABI.md"), "utf8");
    for (const spec of [highLevel, rawGpu]) {
      assert(spec.includes("environment state"), "skybox must be documented as environment state");
      assert(spec.includes("world-space view direction"), "skybox must be sampled by world-space view direction");
      assert(spec.includes("mat4(mat3(view))"), "cube skybox must zero view translation");
      assert(spec.includes("inverse projection"), "shader skybox must document inverse projection ray reconstruction");
      assert(spec.includes("equirectangular"), "skydome must document spherical/equirectangular environment sampling");
      assert(spec.includes("must not inherit"), "skybox must not inherit camera/player transform");
    }
  });

  await test("GFX manifest validates manual gpu arena separately", () => {
    const mod = parseAir(readExample("gpu_arena_manual.air"), "gpu_arena_manual.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.module = "gpu_arena_manual";
    const result = validateGfxManifest(mod, manifest);
    assert.deepStrictEqual(result.errors, []);
    assert.match(auditModule(mod), /gpu.draw_mesh_instanced/);
  });

  await test("GFX manifest rejects missing shader resource", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.shaders.arena_wgsl.path = "gpu_arena/shaders/missing.wgsl";
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("path not found")));
  });

  await test("GFX manifest rejects unknown pipeline shader", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.pipelines.arena_pipeline.shader = "missing_shader";
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("unknown shader")));
  });

  await test("GFX render graph rejects unknown material and unproduced input", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.renderGraphs.main_graph.passes[1].material = "missing_material";
    manifest.renderGraphs.main_graph.passes[2].inputs = ["missing_target"];
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("unknown material")));
    assert(result.errors.some((error) => error.includes("is not produced by an earlier pass")));
  });

  await test("GFX scene rejects unknown mesh and camera handle", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.scene.nodes.platform.mesh = "missing_mesh";
    delete manifest.handles.cameras.main;
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("unknown mesh")));
    assert(result.errors.some((error) => error.includes("unknown camera handle")));
  });

  await test("GFX lifecycle rejects draw before pipeline", () => {
    const source = `module bad_gpu_order
capabilities { gpu }

extern gpu.begin_frame(r: i32, g: i32, b: i32, a: i32) -> void
extern gpu.begin_pass() -> void
extern gpu.draw_mesh_instanced(mesh: i32, instances: i32) -> void
extern gpu.end_pass() -> void
extern gpu.submit() -> void

export func frame(t: i32) -> void {
entry:
  %z:i32 = const.i32 0
  %a:i32 = const.i32 255
  call @gpu.begin_frame(%z, %z, %z, %a)
  call @gpu.begin_pass()
  %mesh:i32 = const.i32 1
  %instances:i32 = const.i32 1
  call @gpu.draw_mesh_instanced(%mesh, %instances)
  call @gpu.end_pass()
  call @gpu.submit()
  return
}
`;
    const mod = parseAir(source, "bad_gpu_order.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.module = "bad_gpu_order";
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("before gpu.set_pipeline")));
  });

  await test("GFX lifecycle rejects mixed render graph and manual draw flow", () => {
    const source = `module bad_gpu_mixed_lifecycle
capabilities { gpu }

extern gpu.execute_render_graph(graph: i32) -> void
extern gpu.begin_frame(r: i32, g: i32, b: i32, a: i32) -> void
extern gpu.begin_pass() -> void
extern gpu.set_pipeline(pipeline: i32) -> void
extern gpu.draw_mesh_instanced(mesh: i32, instances: i32) -> void
extern gpu.end_pass() -> void
extern gpu.submit() -> void

export func frame(t: i32) -> void {
entry:
  %graph:i32 = const.i32 1
  call @gpu.execute_render_graph(%graph)
  %z:i32 = const.i32 0
  %a:i32 = const.i32 255
  call @gpu.begin_frame(%z, %z, %z, %a)
  call @gpu.begin_pass()
  %pipeline:i32 = const.i32 1
  call @gpu.set_pipeline(%pipeline)
  %mesh:i32 = const.i32 1
  %instances:i32 = const.i32 1
  call @gpu.draw_mesh_instanced(%mesh, %instances)
  call @gpu.end_pass()
  call @gpu.submit()
  return
}
`;
    const mod = parseAir(source, "bad_gpu_mixed_lifecycle.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.module = "bad_gpu_mixed_lifecycle";
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("do not mix gpu.execute_render_graph with manual")));
  });

  await test("GFX WIT includes manifest metadata", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    const result = validateGfxManifest(mod, manifest);
    assert.deepStrictEqual(result.errors, []);
    const wit = emitGfxWit(mod, manifest);
    assert.match(wit, /interface gpu/);
    assert.match(wit, /AIR GFX manifest metadata/);
    assert.match(wit, /pipelines: arena_pipeline/);
    assert.match(wit, /renderTargets: scene_color/);
    assert.match(wit, /renderGraphs: main_graph/);
    assert.match(wit, /scene cameras: main/);
  });

  await test("host conformance succeeds with matching JS imports", async () => {
    const source = `module host_plugin
capabilities { debug }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  %id:i32 = const.i32 7
  %value:i32 = const.i32 42
  call @debug.metric(%id, %value)
  return
}
`;
    const mod = parseAir(source, "host_plugin.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "host_plugin.air");
    const seen = [];
    const instance = await WebAssembly.instantiate(wasm, {
      debug: {
        metric: (id, value) => seen.push([id, value])
      }
    });
    instance.instance.exports.run();
    assert.deepStrictEqual(seen, [[7, 42]]);
  });

  await test("host conformance fails clearly when imports are missing", async () => {
    const mod = parseAir(readExample("gfx.air"), "gfx.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "gfx.air");
    await assert.rejects(
      () => WebAssembly.instantiate(wasm, {}),
      /Import #0 module="gfx"|module is not an object or function/
    );
  });

  await test("gameplay primitives lower to wasm", async () => {
    const source = `module gameplay_primitives
capabilities { debug, gfx, input }

global player_x:i32 = const.i32 100
global score:i32 = const.i32 0

extern input.button(id: i32) -> bool
extern debug.metric(id: i32, value: i32) -> void

export func frame(t: i32) -> void {
entry:
  %px:i32 = global.get player_x
  %pressed:bool = call @input.button(1)
  %forward:i32 = select.i32 %pressed, 1, 0
  %step:i32 = const.i32 4
  %delta:i32 = i32.mul %forward, %step
  %candidate:i32 = i32.add %px, %delta
  %min:i32 = const.i32 0
  %too_low:bool = i32.lt_s %candidate, %min
  %clamped:i32 = select.i32 %too_low, %min, %candidate
  global.set score, %clamped
  global.set player_x, %clamped
  %bytes:i32 = const.i32 16
  %ptr:ptr = alloc_region %bytes
  %off:i32 = const.i32 4
  store.i32 %ptr, %off, %clamped
  %loaded:i32 = load.i32 %ptr, %off
  %id:i32 = const.i32 0
  call @debug.metric(%id, %loaded)
  free_region %ptr
  return
}
`;
    const mod = parseAir(source, "gameplay.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /\(global \$player_x \(mut i32\) \(i32.const 100\)\)/);
    assert.match(wat, /global\.get \$player_x/);
    assert.match(wat, /global\.set \$score/);
    assert.match(wat, /select/);
    assert.match(wat, /i32\.store/);
    const wasm = await watToWasm(wat, "gameplay.air");
    assert.strictEqual(wasm[0], 0x00);
  });

  await test("vec3 player-relative movement lowers to wasm and runs", async () => {
    const mod = parseAir(readExample("player_math.air"), "player_math.air");
    verifyModule(mod);
    const formatted = formatModule(mod);
    assert.match(formatted, /%moved:vec3 = vec3.move_relative/);
    const wat = lowerToWat(mod);
    assert.match(wat, /f32\.mul/);
    assert.match(wat, /local \$moved__x f32/);
    const wasm = await watToWasm(wat, "player_math.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 5);
  });

  await test("vec3 components and i32 f32 conversions lower to wasm and run", async () => {
    const source = `module vec3_components
capabilities { }

export func run() -> i32 {
entry:
  %x_i:i32 = const.i32 7
  %y_i:i32 = const.i32 2
  %z_i:i32 = const.i32 -3
  %x:f32 = f32.convert_i32_s %x_i
  %y:f32 = f32.convert_i32_s %y_i
  %z:f32 = f32.convert_i32_s %z_i
  %v:vec3 = vec3.new %x, %y, %z
  %vx:f32 = vec3.x %v
  %vz:f32 = vec3.z %v
  %sum:f32 = f32.sub %vx, %vz
  %out:i32 = i32.trunc_f32_s %sum
  return %out
}
`;
    const mod = parseAir(source, "vec3_components.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /f32\.convert_i32_s/);
    assert.match(wat, /i32\.trunc_f32_s/);
    const wasm = await watToWasm(wat, "vec3_components.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 10);
  });

  await test("verifier rejects composite ABI boundaries with repair hints", () => {
    const source = `module bad_vec_boundary
capabilities { }

export func run() -> vec3 {
entry:
  %zero:f32 = const.f32 0.0
  %v:vec3 = vec3.new %zero, %zero, %zero
  return %v
}
`;
    const mod = parseAir(source, "bad_vec_boundary.air");
    assert.throws(() => verifyModule(mod), /cannot return vec3.*x_i32\/y_i32\/z_i32.*output buffer handle/);

    const externSource = `module bad_extern_vec_boundary
capabilities { debug }

extern debug.metric3(pos: vec3) -> void

export func run() -> void {
entry:
  return
}
`;
    assert.throws(
      () => verifyModule(parseAir(externSource, "bad_extern_vec_boundary.air")),
      /param 'pos' cannot use vec3.*x:f32, y:f32, z:f32/
    );
  });

  await test("struct data model lowers to wasm and runs", async () => {
    const mod = parseAir(readExample("player_state.air"), "player_state.air");
    verifyModule(mod);
    const formatted = formatModule(mod);
    assert.match(formatted, /struct PlayerState/);
    assert.match(formatted, /struct\.set\.x/);
    const wasm = await watToWasm(lowerToWat(mod), "player_state.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 2);
  });

  await test("fixed array data model lowers to wasm and runs", async () => {
    const mod = parseAir(readExample("particle_update.air"), "particle_update.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /local \$particles_2 i32/);
    const wasm = await watToWasm(wat, "particle_update.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 8);
  });

  await test("typed buffer data model lowers to wasm and runs", async () => {
    const mod = parseAir(readExample("transform_pack.air"), "transform_pack.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /f32\.store/);
    assert.match(wat, /f32\.load/);
    const wasm = await watToWasm(wat, "transform_pack.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 9);
  });

  await test("mat4.store_f32 writes 16 f32 values to linear memory", async () => {
    const source = `module mat4_store_demo
capabilities { }
effects { memory.alloc <= 1, memory.free <= 1, memory.load <= 1, memory.store <= 16, memory.static_alloc_bytes <= 64 }

export func run() -> i32 {
entry:
  %bytes:i32 = 64
  %ptr:ptr = alloc_region %bytes
  %off:i32 = 0
  %m:mat4 = mat4.identity
  mat4.store_f32 %m, %ptr, %off
  %first:f32 = load.f32 %ptr, %off
  %out:i32 = i32.trunc_f32_s %first
  free_region %ptr
  return %out
}
`;
    const mod = parseAir(source, "mat4_store_demo.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /f32\.store/);
    const wasm = await watToWasm(wat, "mat4_store_demo.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 1);

    const bad = source.replace("%bytes:i32 = 64", "%bytes:i32 = 16");
    assert.throws(
      () => verifyModule(parseAir(bad, "bad_mat4_store_demo.air")),
      /air\.memory\.region_bounds_static: raw memory access out of region bounds: offset 0, width 64, region size 16/
    );
  });

  await test("mat4.from_trs lowers translation and scale into stored matrix", async () => {
    const source = `module mat4_trs_demo
capabilities { }
effects { memory.alloc <= 1, memory.free <= 1, memory.load <= 2, memory.store <= 16, memory.static_alloc_bytes <= 64 }

export func run() -> i32 {
entry:
  %bytes:i32 = 64
  %ptr:ptr = alloc_region %bytes
  %off:i32 = 0
  %one:f32 = 1
  %two:f32 = 2
  %three:f32 = 3
  %four:f32 = 4
  %pos:vec3 = vec3.new %two, %three, %four
  %rot:quat = quat.identity
  %scale:vec3 = vec3.new %one, %two, %one
  %m:mat4 = mat4.from_trs %pos, %rot, %scale
  mat4.store_f32 %m, %ptr, %off
  %scale_y:f32 = load.f32 %ptr, 20
  %tx:f32 = load.f32 %ptr, 48
  %sy_i:i32 = i32.trunc_f32_s %scale_y
  %tx_i:i32 = i32.trunc_f32_s %tx
  %out:i32 = add %sy_i, %tx_i
  free_region %ptr
  return %out
}
`;
    const mod = parseAir(source, "mat4_trs_demo.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /f32\.store/);
    const wasm = await watToWasm(wat, "mat4_trs_demo.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 4);
  });

  await test("effects budgets and contracts verify, format, audit, and run", async () => {
    const mod = parseAir(readExample("effects_contract.air"), "effects_contract.air");
    verifyModule(mod);
    const formatted = formatModule(mod);
    assert.match(formatted, /effects \{ debug\.metric <= 1/);
    const audit = auditModule(mod);
    assert.match(audit, /Effect budgets:/);
    assert.match(audit, /Effect usage:/);
    const wasm = await watToWasm(lowerToWat(mod), "effects_contract.air");
    const seen = [];
    const instance = await WebAssembly.instantiate(wasm, {
      debug: {
        metric: (id, value) => seen.push([id, value])
      }
    });
    instance.instance.exports.run();
    assert.deepStrictEqual(seen, [[1, 42]]);
  });

  await test("resource budgets and function contracts verify, audit, and run", async () => {
    const mod = parseAir(readExample("resource_contract.air"), "resource_contract.air");
    verifyModule(mod);
    const formatted = formatModule(mod);
    assert.match(formatted, /effects \{ cpu\.instructions <= 3 \}/);
    assert.match(formatted, /requires param value >= 0/);
    assert.match(formatted, /requires param value <= 2147483646/);
    const audit = auditModule(mod);
    assert.match(audit, /Resource usage:/);
    assert.match(audit, /cpu\.instructions=/);
    const wasm = await watToWasm(lowerToWat(mod), "resource_contract.air");
    const seen = [];
    const instance = await WebAssembly.instantiate(wasm, {
      debug: { metric: (id, value) => seen.push([id, value]) }
    });
    assert.strictEqual(instance.instance.exports.run(), 1);
    assert.deepStrictEqual(seen, [[1, 1]]);
  });

  await test("function preconditions reject statically invalid call sites", () => {
    const source = `module bad_precondition
capabilities { }

func inc(value: i32) -> i32 {
  requires param value >= 0
entry:
  %one:i32 = const.i32 1
  %next:i32 = i32.add %value, %one
  return %next
}

export func run() -> i32 {
entry:
  %neg:i32 = const.i32 -1
  %out:i32 = call @inc(%neg)
  return %out
}
`;
    const mod = parseAir(source, "bad_precondition.air");
    assert.throws(() => verifyModule(mod), /violates precondition/);
    let err;
    try {
      verifyModule(mod);
    } catch (caught) {
      err = caught;
    }
    const diagnostic = normalizeDiagnostic(diagnosticHintsFromMessage(err && err.message));
    assert.strictEqual(diagnostic.code, "air.contract.precondition_violated");
    assert.strictEqual(diagnostic.fields.callee, "inc");
    assert.strictEqual(diagnostic.fields.param, "value");
    assert.strictEqual(diagnostic.fields.actualValue, -1);
  });

  await test("function preconditions reject statically visible i32 overflow inputs", () => {
    const source = `module bad_overflow_precondition
capabilities { }

func inc(value: i32) -> i32 {
  requires param value >= 0
  requires param value <= 2147483646
entry:
  %one:i32 = const.i32 1
  %next:i32 = i32.add %value, %one
  return %next
}

export func run() -> i32 {
entry:
  %max:i32 = const.i32 2147483647
  %out:i32 = call @inc(%max)
  return %out
}
`;
    const mod = parseAir(source, "bad_overflow_precondition.air");
    assert.throws(() => verifyModule(mod), /violates precondition param value <= 2147483646: 2147483647/);
  });

  await test("caller param contracts seed verifier range analysis", () => {
    const source = `module caller_contract_ranges
capabilities { }

func needs_width(w: i32) -> i32 {
  requires param w >= 0
entry:
  return %w
}

func needs_height(h: i32) -> i32 {
  requires param h >= 0
entry:
  return %h
}

export func run(w: i32, h: i32) -> i32 {
  requires param w >= 0
  requires param h >= 0
entry:
  %ok_w:i32 = call @needs_width(%w)
  %ok_h:i32 = call @needs_height(%h)
  %sum:i32 = i32.add %ok_w, %ok_h
  return %sum
}
`;
    verifyModule(parseAir(source, "caller_contract_ranges.air"));
  });

  await test("caller param contracts support <= and == range narrowing", () => {
    const source = `module caller_contract_upper_eq
capabilities { }

func needs_small(value: i32) -> i32 {
  requires param value <= 10
entry:
  return %value
}

func needs_exact(value: i32) -> i32 {
  requires param value == 7
entry:
  return %value
}

export func run(value: i32, exact: i32) -> i32 {
  requires param value <= 10
  requires param exact == 7
entry:
  %small:i32 = call @needs_small(%value)
  %same:i32 = call @needs_exact(%exact)
  %sum:i32 = i32.add %small, %same
  return %sum
}
`;
    verifyModule(parseAir(source, "caller_contract_upper_eq.air"));
  });

  await test("missing caller range facts produce stable precondition diagnostics", () => {
    const source = `module missing_contract_range
capabilities { }

func needs_width(w: i32) -> i32 {
  requires param w >= 0
entry:
  return %w
}

export func run(w: i32) -> i32 {
entry:
  %out:i32 = call @needs_width(%w)
  return %out
}
`;
    let err;
    assert.throws(
      () => verifyModule(parseAir(source, "missing_contract_range.air")),
      (caught) => {
        err = caught;
        return /cannot prove precondition param w >= 0; known range is \[-2147483648, 2147483647\]; missing fact for %w/.test(caught.message);
      }
    );
    const diagnostic = normalizeDiagnostic(diagnosticHintsFromMessage(err && err.message));
    assert.strictEqual(diagnostic.code, "air.contract.precondition_unproven");
    assert.strictEqual(diagnostic.fields.callee, "needs_width");
    assert.deepStrictEqual(diagnostic.fields.knownRange, [-2147483648, 2147483647]);
    assert.match(diagnostic.fields.missingFact, /caller precondition/);
  });

  await test("callee return postconditions narrow call result ranges", () => {
    const source = `module return_contract_ranges
capabilities { }

func nonnegative(value: i32) -> i32 {
  requires param value >= 0
  ensures return >= 0
entry:
  return %value
}

func needs_nonnegative(value: i32) -> i32 {
  requires param value >= 0
entry:
  return %value
}

export func run(input: i32) -> i32 {
  requires param input >= 0
entry:
  %known:i32 = call @nonnegative(%input)
  %out:i32 = call @needs_nonnegative(%known)
  return %out
}
`;
    verifyModule(parseAir(source, "return_contract_ranges.air"));
  });

  await test("callee return postconditions support <= and == range narrowing", () => {
    const source = `module return_contract_upper_eq
capabilities { }

func upper(value: i32) -> i32 {
  requires param value <= 10
  ensures return <= 10
entry:
  return %value
}

func exact(value: i32) -> i32 {
  requires param value == 7
  ensures return == 7
entry:
  return %value
}

func needs_small(value: i32) -> i32 {
  requires param value <= 10
entry:
  return %value
}

func needs_exact(value: i32) -> i32 {
  requires param value == 7
entry:
  return %value
}

export func run(value: i32, seven: i32) -> i32 {
  requires param value <= 10
  requires param seven == 7
entry:
  %small_value:i32 = call @upper(%value)
  %exact_value:i32 = call @exact(%seven)
  %small:i32 = call @needs_small(%small_value)
  %same:i32 = call @needs_exact(%exact_value)
  %sum:i32 = i32.add %small, %same
  return %sum
}
`;
    verifyModule(parseAir(source, "return_contract_upper_eq.air"));
  });

  await test("unsupported complex contracts are rejected explicitly", () => {
    const source = `module unsupported_contract
capabilities { }

export func run(w: i32, h: i32) -> i32 {
  requires param w >= %h
entry:
  return %w
}
`;
    assert.throws(() => parseAir(source, "unsupported_contract.air"), /invalid contract 'param w >= %h'/);
  });

  await test("function postconditions reject statically invalid returns", () => {
    const source = `module bad_postcondition
capabilities { }

export func run() -> i32 {
  ensures return >= 1
entry:
  %zero:i32 = const.i32 0
  return %zero
}
`;
    const mod = parseAir(source, "bad_postcondition.air");
    assert.throws(() => verifyModule(mod), /violates postcondition/);
  });

  await test("function effect budgets reject excessive local work", () => {
    const source = `module bad_function_budget
capabilities { }

export func run() -> i32 {
  effects { cpu.instructions <= 1 }
entry:
  %zero:i32 = const.i32 0
  return %zero
}
`;
    const mod = parseAir(source, "bad_function_budget.air");
    assert.throws(() => verifyModule(mod), /function 'run' effect budget.*repair:/);
  });

  await test("GFX budgets reject over-budget manifest resources", () => {
    const source = readExample("ui_tool.air").replace(
      "effects { gpu.* <= 9, input.* <= 6, memory.alloc <= 2, memory.free <= 2, memory.load <= 1, memory.store <= 20, memory.static_alloc_bytes <= 80, memory.dynamic_allocations <= 0 }",
      "effects { gpu.* <= 9, gpu.render_passes <= 2, input.* <= 6, memory.alloc <= 2, memory.free <= 2, memory.load <= 1, memory.store <= 20, memory.static_alloc_bytes <= 80, memory.dynamic_allocations <= 0 }"
    );
    const mod = parseAir(source, "ui_tool_budget.air");
    verifyModule(mod);
    const manifest = readManifest("ui_tool.airgfx.json");
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("gpu.render_passes <= 2")));
  });

  await test("verifier rejects exceeded effect budgets", () => {
    const source = `module bad_budget
capabilities { debug }
effects { debug.metric <= 0 }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  %id:i32 = const.i32 1
  %value:i32 = const.i32 2
  call @debug.metric(%id, %value)
  return
}
`;
    const mod = parseAir(source, "bad_budget.air");
    assert.throws(() => verifyModule(mod), /effect budget 'debug.metric <= 0' is not satisfied.*repair:/);
  });

  await test("verifier rejects unsatisfied contracts", () => {
    const source = `module bad_contract
capabilities { }
requires capability debug

export func run() -> void {
entry:
  return
}
`;
    const mod = parseAir(source, "bad_contract.air");
    assert.throws(() => verifyModule(mod), /requires capability 'debug'/);
  });

  await test("bounded loop lowers by static unrolling and runs", async () => {
    const mod = parseAir(readExample("bounded_loop.air"), "bounded_loop.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /call \$step/);
    const wasm = await watToWasm(wat, "bounded_loop.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 15);
  });

  await test("local self recursion is rejected before lowering", () => {
    const source = `module self_recursion
capabilities { }

func fact(n: i32) -> i32 {
entry:
  %next:i32 = call @fact(%n)
  return %next
}

export func run() -> i32 {
entry:
  %one:i32 = const.i32 1
  %out:i32 = call @fact(%one)
  return %out
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "self_recursion.air")),
      /air\.call\.recursion_rejected: local function call cycle @fact -> @fact/
    );
    let err;
    try {
      verifyModule(parseAir(source, "self_recursion.air"));
    } catch (caught) {
      err = caught;
    }
    const rawDiagnostic = diagnosticHintsFromMessage(err && err.message);
    assert.strictEqual(rawDiagnostic.severity, "error");
    const diagnostic = normalizeDiagnostic(rawDiagnostic);
    assert.strictEqual(diagnostic.code, "air.call.recursion_rejected");
    assert.strictEqual(diagnostic.severity, "fail");
    assert.strictEqual(diagnostic.packageStatusImpact, "fail");
    assert.strictEqual(diagnostic.fields.cyclePath, "@fact -> @fact");
    assert.deepStrictEqual(diagnostic.fields.functions, ["fact", "fact"]);
    assert.match(diagnostic.repairHint, /bounded loop/);
  });

  await test("mutual local recursion is rejected before lowering", () => {
    const source = `module mutual_recursion
capabilities { }

func left(n: i32) -> i32 {
entry:
  %next:i32 = call @right(%n)
  return %next
}

func right(n: i32) -> i32 {
entry:
  %next:i32 = call @left(%n)
  return %next
}

export func run() -> i32 {
entry:
  %one:i32 = const.i32 1
  %out:i32 = call @left(%one)
  return %out
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "mutual_recursion.air")),
      /air\.call\.recursion_rejected: local function call cycle @left -> @right -> @left/
    );
  });

  await test("recursion hidden behind a rare branch is rejected", () => {
    const source = `module hidden_recursion
capabilities { }

func maybe(n: i32) -> i32 {
entry:
  %never:bool = const.bool false
  br_if %never, rare, done
rare:
  %next:i32 = call @maybe(%n)
  return %next
done:
  return %n
}

export func run() -> i32 {
entry:
  %one:i32 = const.i32 1
  %out:i32 = call @maybe(%one)
  return %out
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "hidden_recursion.air")),
      /air\.call\.recursion_rejected: local function call cycle @maybe -> @maybe/
    );
  });

  await test("loop.fold accepts 4096 and rejects 4097", () => {
    const valid = `module loop_fold_cap
capabilities { }

func step(value: i32) -> i32 {
entry:
  return %value
}

export func run() -> i32 {
entry:
  %seed:i32 = const.i32 0
  %out:i32 = loop.fold.i32 @step, %seed, 4096
  return %out
}
`;
    verifyModule(parseAir(valid, "loop_fold_4096.air"));

    const invalid = valid.replace("4096", "4097");
    assert.throws(
      () => verifyModule(parseAir(invalid, "loop_fold_4097.air")),
      /loop\.fold\.i32 count must be between 0 and 4096/
    );
  });

  await test("dynamic loop count lowers with runtime bound check", async () => {
    const source = `module bad_loop
capabilities { random }

extern random.u32() -> i32

func step(value: i32) -> i32 {
entry:
  %one:i32 = const.i32 1
  %next:i32 = i32.add %value, %one
  return %next
}

export func run() -> i32 {
entry:
  %seed:i32 = const.i32 0
  %count:i32 = call @random.u32()
  %out:i32 = loop.fold.i32 @step, %seed, %count
  return %out
}
`;
    const mod = parseAir(source, "bad_loop.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "bad_loop.air");
    const instance = await WebAssembly.instantiate(wasm, { random: { u32: () => 3 } });
    assert.strictEqual(instance.instance.exports.run(), 3);
  });

  await test("dynamic loop effect budgets use verifier upper bounds", () => {
    const rangeSource = `module dynamic_loop_budget
capabilities { debug, random }
effects { debug.metric <= 4 }

extern debug.metric(id: i32, value: i32) -> void
extern random.u32() -> i32

func step(value: i32) -> i32 {
entry:
  %id:i32 = const.i32 1
  call @debug.metric(%id, %value)
  return %value
}

export func run() -> i32 {
entry:
  %seed:i32 = const.i32 0
  %count:i32 = call @random.u32()
  %out:i32 = loop.fold.i32 @step, %seed, %count
  return %out
}
`;
    assert.throws(
      () => verifyModule(parseAir(rangeSource, "dynamic_loop_budget.air")),
      /effect budget 'debug\.metric <= 4' is not satisfied: 4096.*repair:/
    );

    const pollSource = `module dynamic_poll_budget
capabilities { io, random }
effects { io.poll <= 4 }

extern io.poll(request: i32) -> i32
extern random.u32() -> i32

export func run() -> i32 {
entry:
  %req:i32 = 1
  %count:i32 = @random.u32()
  %out:i32 = loop.poll @io.poll, %req, %count
  return %out
}
`;
    assert.throws(
      () => verifyModule(parseAir(pollSource, "dynamic_poll_budget.air")),
      /effect budget 'io\.poll <= 4' is not satisfied: 4096.*repair:/
    );
    const wildcardOk = pollSource.replace("effects { io.poll <= 4 }", "effects { io.* <= 4096 }");
    verifyModule(parseAir(wildcardOk, "dynamic_poll_wildcard_budget.air"));
  });

  await test("legacy loop.range formats as loop.fold and rejects polling misuse", () => {
    const legacy = `module legacy_range
capabilities { }

func step(value: i32) -> i32 {
entry:
  return %value
}

export func run() -> i32 {
entry:
  %seed:i32 = 1
  %out:i32 = loop.range.i32 @step, %seed, 2
  return %out
}
`;
    const mod = parseAir(legacy, "legacy_range.air");
    verifyModule(mod);
    assert.match(formatModule(mod), /loop\.fold\.i32 @step, %seed, 2/);

    const badPolling = `module bad_range_polling
capabilities { io }

extern io.poll(request: i32) -> i32

func poll_once(request: i32) -> i32 {
entry:
  %status:i32 = @io.poll(%request)
  return %status
}

export func run() -> i32 {
entry:
  %req:i32 = 1
  %out:i32 = loop.range.i32 @poll_once, %req, 2
  return %out
}
`;
    assert.throws(
      () => verifyModule(parseAir(badPolling, "bad_range_polling.air")),
      /Use 'loop\.poll @io\.poll, %request, count'/
    );
  });

  await test("legacy async loop.range polling pattern is rejected with second-poll diagnostic", () => {
    const source = `module old_async_polling_bug
use utility.fs
use utility.io
capabilities { }
effects { fs.* <= 1, io.* <= 3 }

func poll_once(request: i32) -> i32 {
entry:
  %status:i32 = @io.poll(%request)
  return %status
}

export func run() -> i32 {
entry:
  %path_ptr:i32 = 2048
  %path_len:i32 = 12
  %bytes:i32 = 256
  %buf:ptr = alloc_region %bytes
  %file_req:i32 = @fs.read_file_async(%path_ptr, %path_len, %buf, %bytes)
  %status:i32 = loop.range.i32 @poll_once, %file_req, 2
  %len:i32 = @io.result_len(%file_req)
  free_region %buf
  return %len
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "old_async_polling_bug.air")),
      /second poll would receive previous status instead of the original request handle.*loop\.poll/
    );
  });

  await test("dynamic region slices lower to wasm and run", async () => {
    const mod = parseAir(readExample("dynamic_slice.air"), "dynamic_slice.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /local \$slice_len i32/);
    const wasm = await watToWasm(wat, "dynamic_slice.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 12);
  });

  await test("structured phi loop lowers to wasm and runs", async () => {
    const mod = parseAir(readExample("phi_loop.air"), "phi_loop.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /loop/);
    assert.match(wat, /i32\.const 4096/);
    assert.match(formatModule(mod), /phi\.i32 entry:%zero, body:%next/);
    const wasm = await watToWasm(wat, "phi_loop.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 5);
  });

  await test("structured phi loop with constant false exit is fuel-bounded", async () => {
    const source = `module phi_loop_fuel
capabilities { }

export func run() -> i32 {
entry:
  %zero:i32 = const.i32 0
  br loop
loop:
  %i:i32 = phi.i32 entry:%zero, body:%next
  %done:bool = const.bool false
  br_if %done, exit, body
body:
  %one:i32 = const.i32 1
  %next:i32 = i32.add %i, %one
  br loop
exit:
  return %i
}
`;
    const mod = parseAir(source, "phi_loop_fuel.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /i32\.const 4096/);
    assert.match(wat, /unreachable/);
    const wasm = await watToWasm(wat, "phi_loop_fuel.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.throws(() => instance.instance.exports.run(), WebAssembly.RuntimeError);
  });

  await test("slice subviews load and store with runtime bounds checks", async () => {
    const mod = parseAir(readExample("slice_borrow.air"), "slice_borrow.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /i32\.gt_s/);
    const wasm = await watToWasm(wat, "slice_borrow.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 42);
  });

  await test("slice verifier rejects statically visible subview overflow", () => {
    const source = `module bad_slice
capabilities { }

export func run() -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  %slice:slice = slice.from_region %ptr, %bytes
  %off:i32 = const.i32 2
  %len:i32 = const.i32 4
  %view:slice = slice.sub %slice, %off, %len
  %out:i32 = slice.len %view
  free_region %ptr
  return %out
}
`;
    const mod = parseAir(source, "bad_slice.air");
    assert.throws(() => verifyModule(mod), /static slice access out of bounds/);
  });

  await test("dynamic array and buffer indexing lower with runtime bounds checks", async () => {
    const mod = parseAir(readExample("dynamic_collections.air"), "dynamic_collections.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /loop/);
    assert.match(wat, /unreachable/);
    const wasm = await watToWasm(wat, "dynamic_collections.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 8);
  });

  await test("dynamic array indexing traps on runtime out-of-bounds", async () => {
    const source = `module bad_dynamic_index
capabilities { }
global idx:i32 = const.i32 1

export func run() -> i32 {
entry:
  %one:i32 = const.i32 1
  %items:array<i32,1> = array.new %one
  %idx:i32 = global.get idx
  %out:i32 = array.get %items, %idx
  return %out
}
`;
    const mod = parseAir(source, "bad_dynamic_index.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "bad_dynamic_index.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.throws(() => instance.instance.exports.run(), WebAssembly.RuntimeError);
  });

  await test("utility host modules verify, emit WIT, and run with SDK imports", async () => {
    const mod = parseAir(readExample("utility_plugin.air"), "utility_plugin.air");
    verifyModule(mod);
    const wit = emitWit(mod);
    assert.match(wit, /interface fs/);
    assert.match(wit, /interface net/);
    assert.match(wit, /interface random/);
    const wasm = await watToWasm(lowerToWat(mod), "utility_plugin.air");
    const imports = createUtilityImports({
      fs: {
        exists: () => 1,
        read_file: () => 7
      },
      net: {
        http_get: () => 11
      },
      random: {
        u32: () => 5
      },
      audio: {
        beep: () => {},
        play_tone: () => {}
      }
    });
    const instance = await WebAssembly.instantiate(wasm, imports);
    assert.strictEqual(instance.instance.exports.run(), 24);
  });

  await test("v0.10 use bundles expand to host capabilities and compact fmt", async () => {
    const source = `module compact_utility
use utility.random
use utility.audio
use math.fixed
capabilities { }

export func run() -> i32 {
entry:
  %seed:i32 = @random.u32()
  %scale:i32 = 2000
  %scaled:i32 = fixed.mul_i32 %seed, %scale
  %id:i32 = 1
  @audio.beep(%id)
  return %scaled
}
`;
    const mod = parseAir(source, "compact_utility.air");
    verifyModule(mod);
    assert(mod.capabilities.has("random"));
    assert(mod.capabilities.has("audio"));
    assert(mod.externs.some((ex) => ex.name === "random.u32" && ex.generated));
    const formatted = formatModule(mod);
    assert.match(formatted, /use utility\.random/);
    assert.match(formatted, /%seed:i32 = @random\.u32\(\)/);
    assert.match(formatted, /%scale:i32 = 2000/);
    assert(!formatted.includes("extern random.u32"));
    const reparsed = parseAir(formatted, "compact_utility.formatted.air");
    verifyModule(reparsed);
    assert.strictEqual(formatModule(reparsed), formatted);
    const wasm = await watToWasm(lowerToWat(mod), "compact_utility.air");
    const beeps = [];
    const imports = createUtilityImports({
      random: { u32: () => 7 },
      audio: { beep: (id) => beeps.push(id) }
    });
    const instance = await WebAssembly.instantiate(wasm, imports);
    assert.strictEqual(instance.instance.exports.run(), 14);
    assert.deepStrictEqual(beeps, [1]);
  });

  await test("v0.10 bundle diagnostics reject unknown bundles, conflicts, and hallucinated calls", () => {
    assert.throws(
      () => verifyModule(parseAir(`module bad_bundle
use utility.files
capabilities { }
export func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`, "bad_bundle.air")),
      /unknown use bundle 'utility\.files'.*use utility\.fs/
    );
    assert.throws(
      () => verifyModule(parseAir(`module bad_bundle_conflict
use utility.fs
capabilities { }
extern fs.read_file(path: slice) -> i32
export func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`, "bad_bundle_conflict.air")),
      /conflicts with use utility\.fs|signature must/
    );
    assert.throws(
      () => verifyModule(parseAir(`module missing_bundle
capabilities { }
export func run() -> i32 {
entry:
  %out:i32 = @random.u32()
  return %out
}
`, "missing_bundle.air")),
      /unknown function 'random\.u32'.*use utility\.random/
    );
    assert.throws(
      () => verifyModule(parseAir(`module bad_op
capabilities { }
export func run() -> i32 {
entry:
  %one:i32 = 1
  %two:i32 = 2
  %out:i32 = ad %one, %two
  return %out
}
`, "bad_op.air")),
      /unknown instruction 'ad'.*add/
    );
  });

  await test("async IO ABI verifies and runs through bounded polling", async () => {
    const mod = parseAir(readExample("async_io.air"), "async_io.air");
    verifyModule(mod);
    const wit = emitWit(mod);
    assert.match(wit, /interface io/);
    assert.match(formatModule(mod), /io\.poll_bounded %file_req, %count/);
    assert.match(auditModule(mod), /io\.poll=4/);
    assert.match(auditModule(mod), /io\.result_len=2/);
    const wasm = await watToWasm(lowerToWat(mod), "async_io.air");
    const polls = [];
    const outputPtrs = [];
    const imports = createUtilityImports({
      fs: { read_file_async: (_pathPtr, _pathLen, outPtr) => {
        outputPtrs.push(outPtr);
        return 10;
      } },
      net: { http_get_async: (_urlPtr, _urlLen, outPtr) => {
        outputPtrs.push(outPtr);
        return 20;
      } },
      io: {
        poll: (request) => {
          polls.push(request);
          return 1;
        },
        result_len: (request) => (request === 10 ? 7 : 11),
        cancel: () => {}
      }
    });
    const instance = await WebAssembly.instantiate(wasm, imports);
    assert.strictEqual(instance.instance.exports.run(), 18);
    assert.deepStrictEqual(polls, [10, 10, 20, 20]);
    assert.strictEqual(outputPtrs.length, 2);
    assert.notStrictEqual(outputPtrs[0], outputPtrs[1]);

    const pendingInstance = await WebAssembly.instantiate(wasm, createUtilityImports({
      fs: { read_file_async: () => 10 },
      net: { http_get_async: () => 20 },
      io: { poll: () => 0, result_len: () => 0, cancel: () => {} }
    }));
    assert.throws(() => pendingInstance.instance.exports.run(), WebAssembly.RuntimeError);
  });

  await test("io.result_len requires statically ready async request", () => {
    const source = `module bad_async_result_len_pending
use utility.fs
use utility.io
capabilities { }
effects { fs.* <= 1, io.* <= 3 }

export func run() -> i32 {
entry:
  %path_ptr:i32 = 2048
  %path_len:i32 = 12
  %bytes:i32 = 256
  %buf:ptr = alloc_region %bytes
  %file_req:i32 = @fs.read_file_async(%path_ptr, %path_len, %buf, %bytes)
  %status:i32 = loop.poll @io.poll, %file_req, 2
  %len:i32 = @io.result_len(%file_req)
  free_region %buf
  return %len
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "bad_async_result_len_pending.air")),
      /io\.result_len\(%file_req\) requires a ready async request.*io\.poll_bounded/
    );
  });

  await test("async output buffers cannot be shared while requests are pending", () => {
    const source = `module bad_async_buffer_alias
use utility.fs
use utility.net
use utility.io
capabilities { }
effects { fs.* <= 1, net.* <= 1, io.* <= 6 }

export func run() -> i32 {
entry:
  %path_ptr:i32 = 2048
  %path_len:i32 = 12
  %url_ptr:i32 = 2304
  %url_len:i32 = 18
  %bytes:i32 = 256
  %buf:ptr = alloc_region %bytes
  %file_req:i32 = @fs.read_file_async(%path_ptr, %path_len, %buf, %bytes)
  %net_req:i32 = @net.http_get_async(%url_ptr, %url_len, %buf, %bytes)
  %count:i32 = 2
  %file_status:i32 = loop.poll @io.poll, %file_req, %count
  %net_status:i32 = loop.poll @io.poll, %net_req, %count
  %file_len:i32 = @io.result_len(%file_req)
  %net_len:i32 = @io.result_len(%net_req)
  %total:i32 = add %file_len, %net_len
  free_region %buf
  return %total
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "bad_async_buffer_alias.air")),
      /async output buffer %buf is already used by pending request %file_req/
    );
  });

  await test("loop.poll rejects accumulator polling misuse and preserves effect honesty", () => {
    const badLocal = `module bad_poll_local
capabilities { io }
extern io.poll(request: i32) -> i32

func poll_once(request: i32) -> i32 {
entry:
  %status:i32 = @io.poll(%request)
  return %status
}

export func run() -> i32 {
entry:
  %req:i32 = 1
  %count:i32 = 2
  %out:i32 = loop.poll @poll_once, %req, %count
  return %out
}
`;
    assert.throws(() => verifyModule(parseAir(badLocal, "bad_poll_local.air")), /loop\.poll is reserved for @io\.poll/);

    const dynamic = `module dynamic_poll
capabilities { io, random }
extern io.poll(request: i32) -> i32
extern random.u32() -> i32

export func run() -> i32 {
entry:
  %req:i32 = 1
  %count:i32 = @random.u32()
  %out:i32 = loop.poll @io.poll, %req, %count
  return %out
}
`;
    const mod = parseAir(dynamic, "dynamic_poll.air");
    verifyModule(mod);
    assert.match(auditModule(mod), /effects\.dynamic=1|io\.poll\.dynamic=1/);
  });

  await test("strict host modules reject hallucinated signatures and contracts", () => {
    const source = `module bad_host_abi
capabilities { fs }
requires no capability net
requires export run

extern fs.read_file(path: slice) -> i32

export func run() -> i32 {
entry:
  %zero:i32 = const.i32 0
  return %zero
}
`;
    const mod = parseAir(source, "bad_host_abi.air");
    assert.throws(() => verifyModule(mod), /extern fs.read_file signature must be/);
  });

  await test("strict public host ABI rejects hallucinated extern names", () => {
    const cases = [
      {
        source: `module bad_debug
capabilities { debug }
extern debug.metric3(id: i32, value: i32, extra: i32) -> void
export func run() -> void {
entry:
  return
}
`,
        error: /unsupported host extern 'debug\.metric3'/
      },
      {
        source: `module bad_gpu
capabilities { gpu }
extern gpu.fake_draw(id: i32) -> void
export func run() -> void {
entry:
  return
}
`,
        error: /unsupported host extern 'gpu\.fake_draw'/
      },
      {
        source: `module bad_input
capabilities { input }
extern input.forward() -> i32
export func run() -> i32 {
entry:
  %value:i32 = 0
  return %value
}
`,
        error: /unsupported host extern 'input\.forward'/
      },
      {
        source: `module bad_device
capabilities { device }
extern device.open(id: i32) -> i32
export func run() -> i32 {
entry:
  %value:i32 = 0
  return %value
}
`,
        error: /unsupported host extern 'device\.open'/
      },
      {
        source: `module bad_stdio
capabilities { stdio }
extern stdio.fd_write(fd: i32, ptr: i32, len: i32) -> i32
export func run() -> i32 {
entry:
  %value:i32 = 0
  return %value
}
`,
        error: /unsupported host extern 'stdio\.fd_write'/
      }
    ];
    for (const item of cases) {
      assert.throws(() => verifyModule(parseAir(item.source, "bad_host.air")), item.error);
    }
  });

  await test("strict public host ABI accepts canonical signatures only", () => {
    const good = `module good_host_abi
capabilities { debug, gpu, input }
effects { debug.metric <= 1 }

extern debug.metric(id: i32, value: i32) -> void
extern gpu.begin_pass() -> void
extern input.axis(id: i32) -> f32

export func frame(time: i32) -> void {
entry:
  %id:i32 = 1
  call @debug.metric(%id, %time)
  return
}
`;
    assert.strictEqual(verifyModule(parseAir(good, "good_host_abi.air")), true);

    const badDebug = good.replace("extern debug.metric(id: i32, value: i32) -> void", "extern debug.metric(id: i32) -> void");
    assert.throws(() => verifyModule(parseAir(badDebug, "bad_debug_metric.air")), /extern debug\.metric signature must be \(i32, i32\) -> void/);
  });

  await test("host ABI registry is the source of truth for GPU, input, and SDK wrappers", () => {
    assert.deepStrictEqual(Array.from(GPU_SIGNATURES.keys()).sort(), Array.from(hostSignaturesForCapability("gpu").keys()).sort());
    assert.deepStrictEqual(Array.from(INPUT_SIGNATURES.keys()).sort(), Array.from(hostSignaturesForCapability("input").keys()).sort());
    assert.deepStrictEqual(Object.keys(createGpuImports({}).gpu).sort(), hostFunctionNamesForCapability("gpu"));
    assert.deepStrictEqual(Object.keys(createInputImports({}).input).sort(), hostFunctionNamesForCapability("input"));
    assert(HOST_SIGNATURES.has("debug.metric"), "debug.metric must be registered as public host ABI");
    assert(HOST_SIGNATURES.has("gpu.draw_mesh_instanced"), "gpu.draw_mesh_instanced must be registered as public host ABI");
    assert(HOST_SIGNATURES.has("input.axis"), "input.axis must be registered as public host ABI");
  });

  await test("audit resource allocation accounting matches verifier usage", () => {
    const source = `module audit_alloc
capabilities { random }
effects { memory.alloc <= 2, memory.free <= 2, memory.static_alloc_bytes <= 16, memory.dynamic_allocations <= 1, random.u32 <= 1 }

extern random.u32() -> i32

export func run() -> i32 {
entry:
  %static_bytes:i32 = 16
  %static_ptr:ptr = alloc_region %static_bytes
  %dynamic_bytes:i32 = @random.u32()
  %dynamic_ptr:ptr = alloc_region %dynamic_bytes
  free_region %dynamic_ptr
  free_region %static_ptr
  %ok:i32 = 0
  return %ok
}
`;
    const mod = parseAir(source, "audit_alloc.air");
    verifyModule(mod);
    const usage = collectEffectUsage(mod);
    const audit = auditModule(mod);
    assert.strictEqual(usage.get("memory.static_alloc_bytes"), 16);
    assert.strictEqual(usage.get("memory.dynamic_allocations"), 1);
    assert.match(audit, /Estimated static allocation: 16 bytes/);
    assert.match(audit, /Dynamic allocation sites: 1/);
    assert.match(audit, /Resource usage: .*memory\.static_alloc_bytes=16/);
    assert.match(audit, /Resource usage: .*memory\.dynamic_allocations=1/);
  });

  await test("SDK builds, loads, validates, and instantiates a package", async () => {
    const out = path.join(root, "build", "test-sdk-data");
    const written = await buildPackage({ air: path.join(root, "examples", "transform_pack.air"), out });
    assert(fs.existsSync(written.metadata));
    const checked = validatePackageDir(out);
    assert.strictEqual(checked.module, "transform_pack");
    assert.strictEqual(checked.abi, AIR_ABI_VERSION);
    const pkg = loadPackage(out);
    assert.strictEqual(pkg.metadata.compiler, `airc ${AIR_VERSION}`);
    const instance = await instantiateAirModule({ wasmBytes: pkg.wasmBytes, imports: {} });
    assert.strictEqual(instance.exports.run(), 9);
  });

  await test("network conformance fixture builds package metadata with v0.10 ABI", () => {
    const out = path.join(root, "build", "test-network-packet-fixture");
    execFileSync(process.execPath, [path.join(root, "bin", "airc.js"), "conformance-fixture", "network-packet", "--out", out], { encoding: "utf8" });
    const checked = validatePackageDir(out);
    assert.strictEqual(checked.module, "network_packet_record");
    assert.strictEqual(checked.abi, AIR_ABI_VERSION);
  });

  await test("SDK createGpuImports reports missing host functions clearly", () => {
    const imports = createGpuImports({});
    assert.throws(() => imports.gpu.begin_pass(), /host missing gpu.begin_pass/);
    assert.throws(() => imports.gpu.draw_particles(1, 1), /host missing gpu.draw_particles/);
  });

  await test("WebGPU and native host metadata is aligned with AIR GFX v0.10", () => {
    const webPkg = JSON.parse(fs.readFileSync(path.join(root, "hosts", "webgpu", "package.json"), "utf8"));
    const webLock = JSON.parse(fs.readFileSync(path.join(root, "hosts", "webgpu", "package-lock.json"), "utf8"));
    const nativeCargo = fs.readFileSync(path.join(root, "hosts", "native", "Cargo.toml"), "utf8");
    const nativeReadme = fs.readFileSync(path.join(root, "hosts", "native", "README.md"), "utf8");
    const webReadme = fs.readFileSync(path.join(root, "hosts", "webgpu", "README.md"), "utf8");
    const webMain = fs.readFileSync(path.join(root, "hosts", "webgpu", "src", "main.ts"), "utf8");
    const types = fs.readFileSync(path.join(root, "hosts", "webgpu", "src", "types.ts"), "utf8");
    assert.strictEqual(webPkg.version, "0.10.0");
    assert.strictEqual(webLock.version, "0.10.0");
    assert.strictEqual(webLock.packages[""].version, "0.10.0");
    assert.match(webPkg.description, /AIR GFX v0\.10/);
    assert.match(nativeCargo, /version = "0\.10\.0"/);
    assert.match(nativeReadme, /AIR GFX\s+v0\.10/);
    assert.match(nativeReadme, /gfx-window/);
    assert.match(nativeReadme, /CI-safe/);
    assert.match(nativeReadme, /Manual GPU\/window/);
    assert.match(nativeReadme, /cargo run -- gfx-stream/);
    assert.match(nativeReadme, /cargo run -- conformance/);
    assert.match(nativeReadme, /no new AIR Core syntax or public\s+GFX ABI/);
    assert(fs.existsSync(path.join(root, "hosts", "native", "Cargo.lock")), "native host app should include Cargo.lock");
    assert.match(webReadme, /AIR GFX\s+v0\.10/);
    assert(webMain.includes('const CURRENT_ABI = "0.10"'), "WebGPU host should use current ABI source");
    assert(webMain.includes('const SUPPORTED_MANIFEST_VERSIONS = new Set(["0.9", "0.10"])'), "WebGPU host should preserve v0.9 manifest compatibility");
    assert(!webMain.includes("/gpu_arena.airgfx.json"), "WebGPU host must not fall back to a demo-specific manifest");
    assert(types.includes('"0.9"') && types.includes('"0.10"'), "WebGPU manifest type must accept current and v0.9 GFX manifests");
  });

  await test("SDK createInputImports reports missing host functions clearly", () => {
    const imports = createInputImports({});
    assert.throws(() => imports.input.axis(1), /host missing input.axis/);
  });

  await test("SDK createIoImports reports missing async functions clearly", () => {
    const imports = createIoImports({});
    assert.throws(() => imports.io.poll(1), /host missing io.poll/);
  });

  await test("GFX stdlib exposes stable AI-facing blocks", () => {
    const stdlib = JSON.parse(emitGfxStdlib());
    assert.strictEqual(stdlib.version, AIR_ABI_VERSION);
    assert(stdlib.primitives.voxel_chunk);
    assert(stdlib.postEffects.bloom);
    assert(stdlib.postEffects.screen_flash);
    assert(stdlib.math.vectors.includes("vec3.move_relative"));
    assert(stdlib.math.transforms.includes("mat4.from_trs"));
    assert(stdlib.math.helpers.includes("bounds.sphere_visible_plane"));
    assert(stdlib.bufferLayouts.mesh_instance_v0.bytes === 80);
    assert(stdlib.shaders.templates.includes("kits/gfx-basic/shaders/unlit_mesh.wgsl"));
    assert.strictEqual(stdlib.shaders.manifestFragment, "kits/gfx-basic/manifest.fragment.json");
    assert(stdlib.input.axes.includes("orbit_x"));
    const spec = fs.readFileSync(path.join(root, "spec", "GFX_ABI.md"), "utf8");
    assert(spec.includes("`gpu.draw_particles(particle, count) -> void`"), "GFX ABI spec must document gpu.draw_particles when code exposes it");
  });

  await test("stdlib .air modules verify in explicit library mode", () => {
    const files = fs.readdirSync(path.join(root, "stdlib")).filter((name) => name.endsWith(".air")).sort();
    assert(files.length > 0);
    for (const required of ["bounds.air", "collision.air", "color.air", "easing.air", "grid.air", "noise.air", "packet.air", "physics.air", "transform.air"]) {
      assert(files.includes(required), `missing required stdlib module ${required}`);
    }
    for (const name of files) {
      const mod = parseAir(fs.readFileSync(path.join(root, "stdlib", name), "utf8"), name);
      assert.strictEqual(verifyModule(mod, { library: true }), true);
    }
    const physics = parseAir(fs.readFileSync(path.join(root, "stdlib", "physics.air"), "utf8"), "physics.air");
    assert.throws(() => verifyModule(physics), /missing required function 'main' or exported host entrypoint/);
    const out = execFileSync(process.execPath, [path.join(root, "bin", "airc.js"), "verify", "--library", path.join(root, "stdlib", "physics.air")], { encoding: "utf8" });
    assert.match(out, /ok:/);
  });

  await test("stdlib stays generic and avoids demo-specific voxel helpers", () => {
    const stdlibDir = path.join(root, "stdlib");
    const names = fs.readdirSync(stdlibDir).filter((name) => name.endsWith(".air"));
    const combined = names.map((name) => fs.readFileSync(path.join(stdlibDir, name), "utf8")).join("\n");
    for (const forbidden of ["draw_cave_", "draw_lamp_", "arena_gate", "skyrealm", "height_world", "camera_lift_for_collision", "camera_collision_hit"]) {
      assert(!combined.includes(forbidden), `${forbidden} should live in a Project Kit, not stdlib`);
    }
    assert(!/draw_.*\(1[3-5],/.test(combined), "generic stdlib must not hardcode demo material IDs 13/14/15 in draw helpers");
  });

  await test("AIR layer manifest documents core, stdlib, host ABI, manifest, and project-kit boundaries", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    assert(readme.includes("[AIR Layer Manifest](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/spec/AIR_LAYER_MANIFEST.md)"));
    const spec = fs.readFileSync(path.join(root, "spec", "AIR_LAYER_MANIFEST.md"), "utf8");
    for (const section of ["## AIR Core", "## AIR Stdlib", "## Host ABIs", "## Manifests", "## Reusable Kits", "## Examples", "## Project Kits", "## Hosts", "## Promotion Rule"]) {
      assert(spec.includes(section), `${section} missing from AIR layer manifest`);
    }
    assert.match(spec, /AIR Core must not contain graphics, network, filesystem, UI, audio, physics/);
    assert.match(spec, /Stdlib must not contain demo material IDs/);
    assert.match(spec, /Host ABIs must not depend on each other implicitly/);
    assert.match(spec, /Manifests do not add AIR Core semantics/);
    assert.match(spec, /Hosts own real platform devices and services/);
    assert.match(spec, /Kits must not define public AIR Core syntax or public Host ABI imports/);
    assert.match(spec, /Examples are public teaching and conformance material/);
    assert.match(spec, /Example-local helper code is not standard API/);
  });

  await test("high-level GFX host ABI registry matches v0.10 spec surface", () => {
    const stable = [
      "gfx.begin_frame",
      "gfx.camera_look_at",
      "gfx.draw_cube",
      "gfx.end_frame",
      "gfx.draw_primitive",
      "gfx.skybox_world"
    ];
    for (const name of stable) assert(HOST_SIGNATURES.has(name), `${name} missing from host ABI registry`);
    for (const removed of ["gfx.camera_angle", "gfx.draw_sprite", "gfx.material_profile"]) {
      assert(!HOST_SIGNATURES.has(removed), `${removed} is not in GFX_HIGH_LEVEL_ABI.md`);
    }
    const spec = fs.readFileSync(path.join(root, "spec", "GFX_HIGH_LEVEL_ABI.md"), "utf8");
    for (const name of stable) assert(spec.includes(`\`${name}`), `${name} missing from high-level GFX spec`);
    assert(spec.includes("`fov` is fixed-point degrees where `1000 == 1 degree`"), "gfx.camera_look_at must document FOV fixed-point units");
    assert(spec.includes("`79000` means `79 degrees`"), "gfx.camera_look_at must document a concrete FOV example");
    assert(spec.includes("`10000..120000`"), "gfx.camera_look_at must document the recommended FOV range");
    const scene = fs.readFileSync(path.join(root, "kits", "gfx-basic", "air", "scene.air"), "utf8");
    const gfx3d = fs.readFileSync(path.join(root, "kits", "gfx-basic", "air", "gfx3d.air"), "utf8");
    assert(scene.includes("func skydome_world"), "scene kit should expose skydome_world helper");
    assert(gfx3d.includes("func skydome_world"), "gfx3d kit should expose skydome_world helper");
    assert(!spec.includes("Experimental v0.10 imports"), "gfx.camera_look_at is stable in v0.10 and must not be documented as experimental");
  });

  await test("high-level primitive registry is unambiguous across specs and stdlib", () => {
    const spec = fs.readFileSync(path.join(root, "spec", "GFX_HIGH_LEVEL_ABI.md"), "utf8");
    for (const line of ["`1`: box/block", "`2`: cylinder", "`3`: cone", "`4`: wedge", "`5`: plane/quad"]) {
      assert(spec.includes(line), `${line} missing from primitive registry`);
    }
    const gfx3d = fs.readFileSync(path.join(root, "kits", "gfx-basic", "air", "gfx3d.air"), "utf8");
    const voxel = fs.readFileSync(path.join(root, "kits", "voxel-basic", "air", "voxel.air"), "utf8");
    assert.match(gfx3d, /%cone:i32 = 3/);
    assert.match(gfx3d, /%wedge:i32 = 4/);
    assert.match(gfx3d, /%plane:i32 = 5/);
    assert.match(gfx3d, /func primitive_flags/);
    assert.match(voxel, /@primitive_flags\(3,/);
    assert.match(voxel, /@primitive_flags\(4,/);
    assert.match(voxel, /@primitive_flags\(5,/);
    assert(!/%wedge:i32 = 3/.test(gfx3d), "primitive id 3 must not mean wedge");
  });

  await test("AIR stdlib catalog exposes math3d, GPU, resources, and async IO", () => {
    const stdlib = JSON.parse(emitStdlib());
    assert.strictEqual(stdlib.version, AIR_ABI_VERSION);
    assert(stdlib.modules.bundles.utility.includes("utility.fs"));
    assert(stdlib.modules.math3d.collisions.includes("collision.sphere_sphere"));
    assert(stdlib.modules.math3d.matrices.includes("mat4.from_trs"));
    assert(stdlib.modules.transform.helpers.includes("transform.compose_trs"));
    assert(stdlib.modules.bounds.helpers.includes("bounds.point_in_circle_sq"));
    assert(stdlib.modules.color.helpers.includes("color.rgb_lerp_1000"));
    assert(stdlib.modules.easing.helpers.includes("easing.in_out_quad_1000"));
    assert(stdlib.modules.physics.fixedOps.includes("fixed.mul_i32"));
    assert(stdlib.modules.physics.controller.includes("physics.damp_i32"));
    assert(stdlib.modules.collision.helpers.includes("collision.lift_y_from_ground"));
    assert(stdlib.modules.uiBasicKit.widgets.includes("ui.input_i32"));
    assert(stdlib.modules.uiBasicKit.widgets.includes("ui.table"));
    assert(stdlib.modules.gfxBasicKit.helpers.includes("gfx3d.primitive_flags"));
    assert(stdlib.modules.network.examples.includes("network_packet_record.air"));
    assert(stdlib.modules.network.examples.includes("network_tcp_flags.air"));
    assert.strictEqual(stdlib.modules.gpu.kit, "kits/gfx-basic");
    assert(stdlib.modules.gpu.templates.includes("kits/gfx-basic/shaders/unlit_mesh.wgsl"));
    assert(stdlib.modules.resources.handles.includes("textures"));
    assert(stdlib.modules.resources.bufferLayouts.includes("mesh_instance_v0"));
    assert(stdlib.modules.asyncIo.startCalls.includes("fs.read_file_async"));
  });

  await test("AIR layer registry keeps core separate from stdlib and host ABIs", () => {
    const registry = JSON.parse(emitRegistry());
    assert.strictEqual(registry.version, AIR_ABI_VERSION);
    assert(registry.layers.core.ops.includes("call"));
    assert(registry.layers.core.ops.includes("print"));
    assert(registry.layers.core.ops.includes("loop.fold.i32"));
    assert(registry.layers.core.ops.includes("mat4.from_trs"));
    assert(!registry.layers.core.ops.includes("vec3.move_relative"));
    assert(!registry.layers.core.ops.includes("physics.damp_i32"));
    assert(registry.layers.stdlib.modules.math3d.includes("vec3.*"));
    assert(registry.layers.stdlib.modules.transform.includes("transform.compose_trs"));
    assert(registry.layers.stdlib.modules.bounds.includes("bounds.aabb_merge"));
    assert(registry.layers.stdlib.modules.color.includes("color.rgb_pack"));
    assert(registry.layers.stdlib.modules.easing.includes("easing.pingpong_time"));
    assert(registry.layers.stdlib.modules.physics.includes("physics.damp_i32"));
    assert(registry.layers.stdlib.modules.collision.includes("collision.lift_y_from_ground"));
    assert(registry.layers.stdlib.modules.network.includes("packet fact scoring"));
    assert(registry.layers.hostAbi.capabilities.includes("gpu"));
    assert(registry.layers.hostAbi.capabilities.includes("fs"));
  });

  await test("GFX buffer layout spec names stable v0.10 record sizes", () => {
    const spec = fs.readFileSync(path.join(root, "spec", "GFX_BUFFER_LAYOUTS.md"), "utf8");
    assert(spec.includes("`mat4` is 64 bytes"));
    assert(spec.includes("`mesh_instance_v0` is 80 bytes"));
    assert(spec.includes("`sprite_instance_v0` is 48 bytes"));
    assert(spec.includes("`particle_instance_v0` is 64 bytes"));
    assert(spec.includes("| 64 | `i32` | material handle |"));
    assert(spec.includes("| 44 | `i32` | user data |"));
  });

  await test("v0.10 visual stdlib examples verify, lower, and run", async () => {
    const cases = [
      ["instance_pack.air", 21],
      ["sprite_pack.air", 128],
      ["frustum_cull.air", 1],
      ["vector_hit_test.air", 11]
    ];
    for (const [file, expected] of cases) {
      const mod = parseAir(readExample(file), file);
      verifyModule(mod);
      const wasm = await watToWasm(lowerToWat(mod), file);
      const instance = await WebAssembly.instantiate(wasm, {});
      assert.strictEqual(instance.instance.exports.run(), expected, file);
    }
  });

  await test("v0.10 stdlib contracts reject zero modulus for hash2_mod", () => {
    const source = `module bad_hash_mod
use std.noise
capabilities { }

export func run() -> i32 {
entry:
  %out:i32 = @noise.hash2_mod(1, 2, 3, 0)
  return %out
}
`;
    assert.throws(() => verifyModule(parseAir(source, "bad_hash_mod.air")), /cannot prove precondition param modulus >= 1|violates precondition param modulus >= 1/);
  });

  await test("v0.11 grid stdlib verifies, audits, lowers, and packages", async () => {
    const lib = parseAir(fs.readFileSync(path.join(root, "stdlib", "grid.air"), "utf8"), "grid.air");
    assert.strictEqual(verifyModule(lib, { library: true }), true);

    const mod = parseAir(readExample("grid_math.air"), "grid_math.air");
    assert.strictEqual(verifyModule(mod), true);
    const formatted = formatModule(mod);
    assert.strictEqual(verifyModule(parseAir(formatted, "grid_math.formatted.air")), true);
    assert.match(auditModule(mod), /grid\.index_3d/);

    const catalog = JSON.parse(emitStdlib());
    assert.deepStrictEqual(catalog.modules.grid.helpers, [
      "grid.cell_trunc_i32",
      "grid.cell_origin_i32",
      "grid.cell_center_i32",
      "grid.clamp_coord_i32",
      "grid.in_bounds_2d",
      "grid.index_2d",
      "grid.in_bounds_3d",
      "grid.index_3d"
    ]);

    const wasm = await watToWasm(lowerToWat(mod), "grid_math.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 3154);

    const out = path.join(root, "build", "test-grid-fixture");
    execFileSync(process.execPath, [path.join(root, "bin", "airc.js"), "conformance-fixture", "grid", "--out", out], { encoding: "utf8" });
    const checked = validatePackageDir(out);
    assert.strictEqual(checked.module, "grid_math");
    assert.strictEqual(checked.abi, AIR_ABI_VERSION);
  });

  await test("v0.12 numeric constraints example verifies, audits, lowers, and runs", async () => {
    const mod = parseAir(readExample("numeric_constraints.air"), "numeric_constraints.air");
    assert.strictEqual(verifyModule(mod), true);
    const formatted = formatModule(mod);
    assert.strictEqual(verifyModule(parseAir(formatted, "numeric_constraints.formatted.air")), true);
    assert.match(auditModule(mod), /bounds\.aabb_overlap_center_i32/);
    assert.match(auditModule(mod), /Dynamic allocation sites: 0/);

    const catalog = JSON.parse(emitStdlib());
    assert(catalog.modules.bounds.helpers.includes("bounds.abs_i32"));
    assert(catalog.modules.bounds.helpers.includes("bounds.in_range_i32"));
    assert(catalog.modules.bounds.helpers.includes("bounds.aabb_overlap_center_i32"));

    const wasm = await watToWasm(lowerToWat(mod), "numeric_constraints.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(10), 32);
  });

  await test("math3d collision stdlib op lowers to wasm and runs", async () => {
    const mod = parseAir(readExample("math3d_collision.air"), "math3d_collision.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "math3d_collision.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 1);
  });

  await test("physics controller stdlib ops lower to wasm and run", async () => {
    const source = `module physics_controller
capabilities { }

export func run() -> i32 {
entry:
  %current:i32 = const.i32 320
  %target:i32 = const.i32 0
  %inertia:i32 = const.i32 4
  %weight:i32 = const.i32 0
  %div:i32 = const.i32 8
  %damped:i32 = physics.damp_i32 %current, %target, %inertia, %weight, %div
  %y:i32 = const.i32 2010
  %ground:i32 = const.i32 1800
  %vy:i32 = const.i32 -42
  %snap:i32 = const.i32 220
  %grounded:bool = physics.grounded_i32 %y, %ground, %vy, %snap
  %snapped_y:i32 = physics.snap_y_i32 %y, %ground, %vy, %snap
  %snapped_vy:i32 = physics.snap_vy_i32 %y, %ground, %vy, %snap
  %g:i32 = select.i32 %grounded, 1, 0
  %sum0:i32 = i32.add %damped, %snapped_y
  %sum1:i32 = i32.add %sum0, %snapped_vy
  %out:i32 = i32.add %sum1, %g
  return %out
}
`;
    const mod = parseAir(source, "physics_controller.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "physics_controller.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 1961);
  });

  await test("v0.10 utility math proof verifies, audits, emits WIT, builds, and runs", async () => {
    const mod = parseAir(readExample("utility_math.air"), "utility_math.air");
    verifyModule(mod);
    const formatted = formatModule(mod);
    assert.match(formatted, /use utility\.fs/);
    assert.match(formatted, /%path_ptr:i32 = 2048/);
    assert.match(auditModule(mod), /Uses: .*utility\.audio/);
    assert.match(auditModule(mod), /Operation shape: compactable=/);
    assert.match(emitWit(mod), /interface fs/);
    const wasm = await watToWasm(lowerToWat(mod), "utility_math.air");
    const beeps = [];
    const imports = createUtilityImports({
      fs: { read_file: () => 7 },
      net: { http_get: () => 11 },
      random: { u32: () => 2 },
      audio: { beep: (id) => beeps.push(id) }
    });
    const instance = await WebAssembly.instantiate(wasm, imports);
    assert.strictEqual(instance.instance.exports.run(), 30);
    assert.deepStrictEqual(beeps, [1]);
  });

  await test("v0.10 f32 visual math lowers to wasm and runs", async () => {
    const source = `module visual_math
capabilities { }

export func run() -> i32 {
entry:
  %zero:f32 = const.f32 0.0
  %one:f32 = const.f32 1.0
  %neg:f32 = const.f32 -1.0
  %clamped:f32 = f32.clamp %zero, %neg, %one
  %lerped:f32 = f32.lerp %zero, %one, %clamped
  %sin:f32 = f32.sin %zero
  %cos:f32 = f32.cos %zero
  %sum:f32 = f32.add %lerped, %cos
  %out:i32 = i32.trunc_f32_s %sum
  return %out
}
`;
    const mod = parseAir(source, "visual_math.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "visual_math.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 1);
  });

  await test("f32 trig lowers with game-yaw range reduction", async () => {
    const source = `module trig_yaw
capabilities { }

export func run() -> i32 {
entry:
  %half_pi:f32 = const.f32 1.5707964
  %tau:f32 = const.f32 6.2831855
  %scale:f32 = const.f32 1000.0
  %sin_half:f32 = f32.sin %half_pi
  %sin_turn:f32 = f32.sin %tau
  %scaled_half:f32 = f32.mul %sin_half, %scale
  %scaled_turn:f32 = f32.mul %sin_turn, %scale
  %half:i32 = i32.trunc_f32_s %scaled_half
  %turn:i32 = i32.trunc_f32_s %scaled_turn
  %out:i32 = i32.add %half, %turn
  return %out
}
`;
    const mod = parseAir(source, "trig_yaw.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "trig_yaw.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 1000);
  });

  await test("AI-facing scene math stdlib lowers to wasm and runs", async () => {
    const source = `module scene_math
capabilities { }

export func run() -> i32 {
entry:
  %zero:f32 = const.f32 0.0
  %one:f32 = const.f32 1.0
  %two:f32 = const.f32 2.0
  %three:f32 = const.f32 3.0
  %four:f32 = const.f32 4.0
  %five:f32 = const.f32 5.0
  %eight:f32 = const.f32 8.0
  %ten:f32 = const.f32 10.0
  %v2:vec2 = vec2.new %three, %four
  %v2_len:f32 = vec2.len_sq %v2
  %v4:vec4 = vec4.new %three, %four, %zero, %two
  %v4_dot:f32 = vec4.dot %v4, %v4
  %origin:vec3 = vec3.new %zero, %zero, %zero
  %dir:vec3 = vec3.new %zero, %two, %zero
  %v3:vec3 = vec3.new %three, %four, %zero
  %hit:f32 = ray.plane_y %origin, %dir, %eight
  %axis:vec3 = vec3.new %zero, %one, %zero
  %q:quat = quat.from_axis_angle %axis, %zero
  %qi:quat = quat.identity
  %qm:quat = quat.mul %qi, %q
  %rot:vec3 = quat.rotate_vec3 %qm, %v3
  %rot_comp:f32 = vec3.y %rot
  %smooth:f32 = ease.smoothstep %one
  %out_quad:f32 = ease.out_quad %one
  %mid:f32 = f32.inverse_lerp %zero, %ten, %five
  %a:f32 = f32.add %v2_len, %v4_dot
  %b:f32 = f32.add %hit, %rot_comp
  %c:f32 = f32.add %smooth, %out_quad
  %d:f32 = f32.add %a, %b
  %e:f32 = f32.add %c, %mid
  %sum:f32 = f32.add %d, %e
  %out:i32 = i32.trunc_f32_s %sum
  return %out
}
`;
    const mod = parseAir(source, "scene_math.air");
    verifyModule(mod);
    const wat = lowerToWat(mod);
    assert.match(wat, /local \$q__w f32/);
    assert.match(wat, /f32\.sqrt|f32\.mul/);
    const wasm = await watToWasm(wat, "scene_math.air");
    const instance = await WebAssembly.instantiate(wasm, {});
    assert.strictEqual(instance.instance.exports.run(), 64);
  });

  await test("v0.10 interactive UI tool validates, lowers, and runs one frame", async () => {
    const mod = parseAir(readExample("ui_tool.air"), "ui_tool.air");
    verifyModule(mod);
    const manifest = readManifest("ui_tool.airgfx.json");
    const result = validateGfxManifest(mod, manifest);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.summary.inputs, 4);
    assert.strictEqual(result.summary.uiPanels, 1);
    assert.strictEqual(result.summary.meshInstances, 1);
    assert.strictEqual(result.summary.voxels, 1);
    assert.strictEqual(result.summary.particles, 1);
    const wasm = await watToWasm(lowerToWat(mod), "ui_tool.air");
    const calls = [];
    const instance = await WebAssembly.instantiate(wasm, {
      input: {
        axis: () => 0,
        button: () => 0,
        pointer_delta_x: () => 0,
        pointer_delta_y: () => 0,
        pointer_down: () => 0
      },
      gpu: {
        set_scene_time: (time) => calls.push(["time", time]),
        set_camera_matrix: (camera, ptr, len) => calls.push(["camera_matrix", camera, ptr, len]),
        set_camera: (camera) => calls.push(["camera", camera]),
        execute_render_graph: (graph) => calls.push(["graph", graph])
      }
    });
    instance.instance.exports.frame(33);
    assert.deepStrictEqual(calls, [["time", 34], ["camera_matrix", 1, 1024, 64], ["camera", 1], ["graph", 1]]);
  });

  await test("v0.11 network dashboard verifies and recalculates mock UI status", async () => {
    const airFile = path.join(root, "examples", "network_dashboard", "network_dashboard.air");
    const mod = parseAir(fs.readFileSync(airFile, "utf8"), airFile);
    verifyModule(mod);
    assert.deepStrictEqual(Array.from(mod.capabilities).sort(), ["debug", "ui"]);
    const wasm = await watToWasm(lowerToWat(mod), "network_dashboard.air");
    let latencyThreshold = 120;
    let lossThreshold = 2.0;
    const statuses = [];
    const debugMetrics = [];
    const calls = [];
    const instance = await WebAssembly.instantiate(wasm, {
      ui: {
        begin_frame: () => calls.push("begin_frame"),
        panel: () => calls.push("panel"),
        label: () => calls.push("label"),
        button: () => 0,
        input_i32: () => latencyThreshold,
        input_f32: () => lossThreshold,
        metric: (_id, _x, _y, _label, value) => calls.push(["metric", value]),
        table: () => calls.push("table"),
        chart: () => calls.push("chart"),
        status: (_id, _x, _y, _label, severity) => statuses.push(severity),
        warning: (_id, _x, _y, _label, severity) => calls.push(["warning", severity]),
        end_frame: () => calls.push("end_frame")
      },
      debug: {
        metric: (id, value) => debugMetrics.push([id, value])
      }
    });
    assert.strictEqual(instance.instance.exports.render(120, 2.0), 40);
    latencyThreshold = 180;
    lossThreshold = 2.0;
    assert.strictEqual(instance.instance.exports.render(120, 2.0), 65);
    latencyThreshold = 240;
    lossThreshold = 5.0;
    assert.strictEqual(instance.instance.exports.render(120, 2.0), 100);
    assert.deepStrictEqual(statuses, [2, 1, 0]);
    assert(debugMetrics.some(([id, value]) => id === 9001 && value === 131));
    assert(calls.includes("table"));
    assert(calls.includes("chart"));

    const smoke = JSON.parse(execFileSync(process.execPath, [path.join(root, "examples", "network_dashboard", "run.mjs")], { encoding: "utf8" }));
    assert.deepStrictEqual(smoke.capabilities, ["debug", "ui"]);
    assert(smoke.imports.some((item) => item.name === "ui.metric"));
    assert(smoke.imports.some((item) => item.name === "debug.metric"));
    assert(!smoke.imports.some((item) => item.name.startsWith("net.") || item.name.startsWith("fs.")));
    assert.strictEqual(smoke.strictHostAbi.status, "pass");
    assert.deepStrictEqual(smoke.unsupportedHostFeatures, []);
    assert.strictEqual(smoke.mockInputFacts.source, "checked-in static fixture");
    assert.deepStrictEqual(smoke.mockInputFacts.latencySamplesMs, [42, 138, 215]);
    assert.strictEqual(smoke.mockInputFacts.averageLatencyMs, 131);
    assert.strictEqual(smoke.mockInputFacts.packetLossPct, 2.75);
    assert.strictEqual(smoke.computedStatus.score, 40);
    assert.strictEqual(smoke.computedStatus.text, "error");
    assert.strictEqual(smoke.hostAccess.network, false);
    assert.strictEqual(smoke.hostAccess.rawSockets, false);
  });

  await test("scene data model rejects bad particles and render pass kinds", () => {
    const mod = parseAir(readExample("ui_tool.air"), "ui_tool.air");
    verifyModule(mod);
    const manifest = readManifest("ui_tool.airgfx.json");
    manifest.scene.particles.spark_field.count = 300;
    manifest.renderGraphs.main_graph.passes[2].kind = "fluid";
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("count exceeds budget")));
    assert(result.errors.some((error) => error.includes("kind is unsupported")));
  });

  await test("v0.10 manifest rejects bad input binding and missing UI sprite", () => {
    const mod = parseAir(readExample("ui_tool.air"), "ui_tool.air");
    verifyModule(mod);
    const manifest = readManifest("ui_tool.airgfx.json");
    manifest.inputs.orbit_x.bindings.browser = "BadBinding";
    manifest.ui.imageQuads.select_icon.sprite = "missing_sprite";
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("unknown input binding")));
    assert(result.errors.some((error) => error.includes("unknown sprite")));
  });

  await test("dynamic buffer loop count traps when runtime bound is exceeded", async () => {
    const source = `module bad_buffer_loop
capabilities { input }

extern input.axis(id: i32) -> f32

func step(value: f32) -> f32 {
entry:
  return %value
}

export func run() -> void {
entry:
  %bytes:i32 = const.i32 16
  %ptr:ptr = alloc_region %bytes
  %buf:buffer<f32,4> = buffer.from_ptr %ptr
  %id:i32 = const.i32 1
  %axis:f32 = call @input.axis(%id)
  %count:i32 = i32.trunc_f32_s %axis
  loop.buffer.f32 @step, %buf, %count
  free_region %ptr
  return
}
`;
    const mod = parseAir(source, "bad_buffer_loop.air");
    verifyModule(mod);
    const wasm = await watToWasm(lowerToWat(mod), "bad_buffer_loop.air");
    const instance = await WebAssembly.instantiate(wasm, { input: { axis: () => 99 } });
    assert.throws(() => instance.instance.exports.run(), WebAssembly.RuntimeError);
  });

  await test("verifier rejects statically visible uninitialized buffer loop reads", () => {
    const source = `module bad_uninit_buffer_loop
capabilities { }

func step(value: f32) -> f32 {
entry:
  return %value
}

export func run() -> void {
entry:
  %bytes:i32 = const.i32 16
  %ptr:ptr = alloc_region %bytes
  %buf:buffer<f32,4> = buffer.from_ptr %ptr
  %idx:i32 = const.i32 0
  %zero:f32 = const.f32 0.0
  buffer.store %buf, %idx, %zero
  loop.buffer.f32 @step, %buf, 4
  free_region %ptr
  return
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "bad_uninit_buffer_loop.air")),
      /loop\.buffer\.f32 reads uninitialized %buf\[1\]/
    );
  });

  await test("verifier rejects statically visible uninitialized buffer load", () => {
    const source = `module bad_uninit_buffer_load
capabilities { }

export func run() -> i32 {
entry:
  %bytes:i32 = const.i32 16
  %ptr:ptr = alloc_region %bytes
  %buf:buffer<f32,4> = buffer.from_ptr %ptr
  %idx:i32 = const.i32 0
  %value:f32 = buffer.load %buf, %idx
  %out:i32 = i32.trunc_f32_s %value
  free_region %ptr
  return %out
}
`;
    assert.throws(
      () => verifyModule(parseAir(source, "bad_uninit_buffer_load.air")),
      /buffer\.load reads uninitialized %buf\[0\]/
    );
  });

  await test("verifier rejects statically visible array bounds", () => {
    const source = `module bad_array
capabilities { }

export func run() -> i32 {
entry:
  %one:i32 = const.i32 1
  %items:array<i32,1> = array.new %one
  %idx:i32 = const.i32 1
  %out:i32 = array.get %items, %idx
  return %out
}
`;
    const mod = parseAir(source, "bad_array.air");
    assert.throws(() => verifyModule(mod), /out of bounds/);
  });

  await test("GFX validator rejects invalid post, material, and lighting parameters", () => {
    const mod = parseAir(readExample("ui_tool.air"), "ui_tool.air");
    verifyModule(mod);
    const manifest = readManifest("ui_tool.airgfx.json");
    manifest.post.tonemap.operator = "bad";
    manifest.post.outline.width = -1;
    manifest.materials.tool_surface.roughness = 2;
    manifest.materials.ui_surface.textures.normal = "missing_normal";
    manifest.scene.lights.key.direction = [1, 2];
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("operator is unsupported")));
    assert(result.errors.some((error) => error.includes("post.outline.width must be >=")));
    assert(result.errors.some((error) => error.includes("materials.tool_surface.roughness must be <=")));
    assert(result.errors.some((error) => error.includes("unknown texture")));
    assert(result.errors.some((error) => error.includes("scene.lights.key.direction must be an array")));
  });

  await test("GFX validator accepts generic skeleton animation and vector decals", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.assets.skeletons = {
      rig: { model: "arena_platform", joints: ["root", "joint_a"], root: "root", handle: 1 }
    };
    manifest.assets.animations = {
      idle: { model: "arena_platform", skeleton: "rig", durationMs: 1000, channels: ["translation", "rotation", "scale"], loop: true, handle: 1 }
    };
    manifest.assets.models.arena_platform.skinned = true;
    manifest.assets.models.arena_platform.skeleton = "rig";
    manifest.assets.models.arena_platform.animations = ["idle"];
    manifest.scene.animators = {
      platform_idle: { node: "platform", skeleton: "rig", clip: "idle", playback: "loop", speed: 1, weight: 1 }
    };
    const result = validateGfxManifest(mod, manifest);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.summary.skeletons, 1);
    assert.strictEqual(result.summary.animations, 1);
    assert.strictEqual(result.summary.animators, 1);
    assert.strictEqual(result.summary.vectors, 1);
    assert.strictEqual(result.summary.vectorDecals, 1);
  });

  await test("GFX validator rejects broken generic asset references", () => {
    const mod = parseAir(readExample("gpu_arena.air"), "gpu_arena.air");
    verifyModule(mod);
    const manifest = readManifest("gpu_arena.airgfx.json");
    manifest.assets.models.arena_platform.skinned = true;
    manifest.assets.models.arena_platform.skeleton = "missing_rig";
    manifest.assets.animations = {
      bad_clip: { model: "missing_model", skeleton: "missing_rig", durationMs: -1, channels: ["badchannel"] }
    };
    manifest.scene.animators = {
      broken: { node: "missing_node", clip: "missing_clip", playback: "forever" }
    };
    manifest.scene.vectorDecals.floor_rune.vector = "missing_vector";
    manifest.scene.vectorDecals.floor_rune.alpha = 2;
    const result = validateGfxManifest(mod, manifest);
    assert(result.errors.some((error) => error.includes("unknown skeleton 'missing_rig'")));
    assert(result.errors.some((error) => error.includes("unknown model 'missing_model'")));
    assert(result.errors.some((error) => error.includes("durationMs must be >=")));
    assert(result.errors.some((error) => error.includes("unsupported channel 'badchannel'")));
    assert(result.errors.some((error) => error.includes("unknown node 'missing_node'")));
    assert(result.errors.some((error) => error.includes("playback must be once, loop, or pingpong")));
    assert(result.errors.some((error) => error.includes("unknown vector 'missing_vector'")));
    assert(result.errors.some((error) => error.includes("alpha must be <=")));
  });

  await test("gfx-import creates manifest fragments for source models and textures", () => {
    const obj = createGfxImportManifest("assets/hero mech.obj", { name: "hero_mech" });
    assert.strictEqual(obj.assets.models.hero_mech.runtimeReady, false);
    assert.strictEqual(obj.assets.models.hero_mech.conversion.required, true);
    assert.match(obj.assets.models.hero_mech.conversion.toolHint, /Blender|obj2gltf/);
    const texture = createGfxImportManifest("assets/albedo.png", { name: "hero_albedo" });
    assert.strictEqual(texture.assets.textures.hero_albedo.colorSpace, "srgb");
    assert.strictEqual(texture.materials.hero_albedo_material.textures.base, "hero_albedo");
    const vector = createGfxImportManifest("assets/rune.svg", { name: "rune_mark", kind: "vector" });
    assert.strictEqual(vector.assets.vectors.rune_mark.format, "svg");
    assert.strictEqual(vector.scene.vectorDecals.rune_mark_decal.vector, "rune_mark");
  });

  await test("AI-generation corpus verifies, formats, audits, and builds", async () => {
    for (let i = 0; i < 20; i += 1) {
      const source = `module ai_plugin_${i}
capabilities { debug }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  %id:i32 = const.i32 ${i}
  %base:i32 = const.i32 ${i + 10}
  %scale:i32 = const.i32 2
  %value:i32 = i32.mul %base, %scale
  call @debug.metric(%id, %value)
  return
}
`;
      const mod = parseAir(source, `ai_plugin_${i}.air`);
      verifyModule(mod);
      const formatted = formatModule(mod);
      verifyModule(parseAir(formatted, `ai_plugin_${i}.formatted.air`));
      assert.match(auditModule(mod), /debug.metric/);
      const wasm = await watToWasm(lowerToWat(mod), `ai_plugin_${i}.air`);
      assert.strictEqual(wasm[0], 0x00);
    }
  });

  await test("AI-generation visual plugin corpus passes gfx-check", () => {
    for (let i = 0; i < 10; i += 1) {
      const source = `module gpu_arena
capabilities { gpu }

extern gpu.begin_frame(r: i32, g: i32, b: i32, a: i32) -> void
extern gpu.begin_pass() -> void
extern gpu.set_pipeline(pipeline: i32) -> void
extern gpu.draw_mesh_instanced(mesh: i32, instances: i32) -> void
extern gpu.end_pass() -> void
extern gpu.submit() -> void

export func frame(t: i32) -> void {
entry:
  %r:i32 = const.i32 ${i}
  %g:i32 = const.i32 12
  %b:i32 = const.i32 28
  %a:i32 = const.i32 255
  call @gpu.begin_frame(%r, %g, %b, %a)
  call @gpu.begin_pass()
  %pipeline:i32 = const.i32 1
  call @gpu.set_pipeline(%pipeline)
  %mesh:i32 = const.i32 1
  %instances:i32 = const.i32 ${i + 1}
  call @gpu.draw_mesh_instanced(%mesh, %instances)
  call @gpu.end_pass()
  call @gpu.submit()
  return
}
`;
      const mod = parseAir(source, `visual_${i}.air`);
      verifyModule(mod);
      const manifest = readManifest("gpu_arena.airgfx.json");
      const result = validateGfxManifest(mod, manifest);
      assert.deepStrictEqual(result.errors, []);
      assert.match(auditModule(mod), /gpu.draw_mesh_instanced/);
    }
  });

  await test("public naming surfaces use AIR project name", () => {
    const roots = ["README.md", "docs", "spec", "hosts", "examples", "scripts"].map((name) => path.join(root, name));
    const allowed = new Set([
      path.join(root, "docs", "project-identity.md")
    ]);
    const offenders = [];
    for (const item of roots) {
      const files = fs.statSync(item).isDirectory() ? walkFiles(item) : [item];
      for (const file of files) {
        const rel = path.relative(root, file).replace(/\\/g, "/");
        if (rel.startsWith("docs/archive/")) continue;
        if (rel.startsWith("REVIEW_RESULTS/")) continue;
        if (/(^|\/)(node_modules|dist|build|bundles|coverage|\.cache)\//.test(rel)) continue;
        if (/(^|\/)(target)\//.test(rel)) continue;
        if (!/\.(md|txt|html|json|js|ts|rs|sh|air|wgsl|toml|yml|yaml|css)$/.test(rel)) continue;
        if (allowed.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (/(AIRLang|AirLang|AIRLANG)/.test(text)) offenders.push(rel);
      }
    }
    assert.deepStrictEqual(offenders.sort(), []);
  });
})();
