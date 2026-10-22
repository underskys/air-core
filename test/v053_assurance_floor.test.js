#!/usr/bin/env node
"use strict";

// typed-v0.53 SCALAR slice (AIR-0053-P0-SCALAR-0001): the R-ASSUR-1 floor
// (V53-ASSUR-01..08 from R3.1 VECTORS.md, V53-ASSUR-09..12 from the admitted
// slice text's VECTORS_ADDITIONS.md). Expected codes are copied from those
// catalogues, never from the implementation under test. Preservation cases
// that say "equal to H52_BASELINE" run the baseline bytes from git objects
// (dev 94001cd / public 9c2b178) on the same inputs.
// Set AIR_SCALAR_VECTOR_RESULTS_DIR=<dir> to write one canonical result record
// per vector.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const { assertRealtimeSafeProfile, createVerifiedResourceCertificate } = require("../src/verifier");
const { createAiReviewReport } = require("../src/ai_review");
const { auditModule } = require("../src/audit");
const { explainModule } = require("../src/explain");
const { analyzeProvenanceModule } = require("../src/provenance_flow");
const { emitWit } = require("../src/wit");
const { createSemanticPatch, inspectSemanticPatch } = require("../src/semantic_patch");
const { createVerifiedExecutionSession } = require("../src/verified_execution_session");
const { createAudioAuthorityReport } = require("../src/audio_authority");
const { createConformanceReport } = require("../src/conformance_report");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const UNSUPPORTED = "air.assurance.profile_unsupported";
const H52_BASELINE_COMMITS = ["94001cd1c822ccd914874c85543aa99e91d6ae4e", "9c2b1788a42f747bf6d61f2517c8348a7d519159"];
// T2(i32.checked_add,i32,i32,i32) (VECTORS.md template).
const T2_SOURCE = "module v53.vec\nexport func f(a: i32, b: i32) -> i32 {\n%o: i32 = i32.checked_add %a, %b\nreturn %o\n}\n";
// A legacy-v0.50 module that verifies, so the preservation probes compare real reports.
const LEGACY_SOURCE = "module probe\n\nexport func value() -> i32 {\nentry:\n  %x:i32 = const.i32 7\n  return %x\n}\n";
const results = [];
const failures = [];

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function plain(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) if (value[key] !== undefined) out[key] = plain(value[key]);
    return out;
  }
  return value === undefined ? null : value;
}

function resultRecord(vectorId, status, value, extra = {}) {
  const valueOrFailure = plain(value === undefined ? null : value);
  return {
    evidence_digest: sha256(canonicalJson({ status, value_or_failure: valueOrFailure, vector: vectorId })),
    interface_digest: extra.interfaceDigest || null,
    source_digest: extra.sourceDigest || null,
    status,
    value_or_failure: valueOrFailure,
    vector: vectorId
  };
}

async function vector(id, action) {
  try {
    const outcome = (await action()) || {};
    results.push(resultRecord(id, outcome.status || "PASS", outcome.value, outcome));
  } catch (error) {
    failures.push(`${id}: ${error && error.stack || error}`);
    results.push(resultRecord(id, "FAIL", { error: String(error && error.message || error) }));
  }
}

async function refusal(label, action) {
  let error = null;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label}: expected ${UNSUPPORTED}, got a result (silent PASS)`);
  assert(!(error instanceof TypeError), `${label}: TypeError`);
  assert.equal(error.code, UNSUPPORTED, `${label}: ${error && error.message}`);
  return { code: error.code, entrypoint: label };
}

function runCli(args) {
  return childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function baselineSrc(tmp) {
  const dir = path.join(tmp, "h52");
  if (fs.existsSync(path.join(dir, "src"))) return dir;
  for (const commit of H52_BASELINE_COMMITS) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: ROOT }).status !== 0) continue;
    fs.mkdirSync(dir, { recursive: true });
    const archive = childProcess.spawnSync("sh", ["-c", `git archive ${commit} src | tar -x -C "${dir}"`], { cwd: ROOT, encoding: "utf8" });
    if (archive.status === 0) {
      fs.writeFileSync(path.join(dir, "COMMIT"), commit);
      return dir;
    }
  }
  return null;
}

// Runs one preservation probe against a src tree in a child process and
// returns a comparable outcome.
const PROBE_SCRIPT = `"use strict";
const path = require("path");
const src = process.argv[2];
const input = JSON.parse(process.argv[3]);
const r = (m) => require(path.join(src, m));
const report = (error) => ({ ok: false, code: error && error.code || null, name: error && error.name || null, message: String(error && error.message) });
async function main() {
  const probes = {
    session: () => r("verified_execution_session.js").createVerifiedExecutionSession({ packageDir: input.packageDir }),
    createPatch: () => r("semantic_patch.js").createSemanticPatch(input.packageDir, input.resultDir),
    inspectPatch: () => r("semantic_patch.js").inspectSemanticPatch(input.patchInput),
    audioLegacy: () => r("audio_authority.js").createAudioAuthorityReport(r("parser.js").parseAir(input.source, "legacy.air")),
    audioModuleLike: () => r("audio_authority.js").createAudioAuthorityReport({ capabilities: new Set(input.capabilities), externs: input.externs, name: "package" }, { manifest: input.manifest }),
    conformanceLegacy: () => r("conformance_report.js").createConformanceReport(r("parser.js").parseAir(input.source, "legacy.air"))
  };
  try { const value = await probes[input.probe](); return { ok: true, value: JSON.parse(JSON.stringify(value)) }; } catch (error) { return report(error); }
}
main().then((out) => process.stdout.write(JSON.stringify(out)));
`;

function runProbe(tmp, srcDir, input) {
  const script = path.join(tmp, "probe.js");
  if (!fs.existsSync(script)) fs.writeFileSync(script, PROBE_SCRIPT);
  const out = childProcess.spawnSync(process.execPath, [script, srcDir, JSON.stringify(input)], {
    encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, maxBuffer: 64 * 1024 * 1024
  });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

// The baseline and the candidate run on the same bytes; equal outcomes keep
// the default behaviour unchanged (OD-3 (c), OD-8 (b) preservation).
function sameAsBaseline(tmp, input) {
  const dir = baselineSrc(tmp);
  if (!dir) return { status: "ENVIRONMENT_UNAVAILABLE" };
  const current = runProbe(tmp, path.join(ROOT, "src"), input);
  const baseline = runProbe(tmp, path.join(dir, "src"), input);
  assert.deepEqual(current, baseline, `${input.probe}: equal to H52_BASELINE`);
  return { baseline_commit: fs.readFileSync(path.join(dir, "COMMIT"), "utf8"), outcome: current.ok ? "result" : current.code || current.name };
}

function writePackage(dir, source) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.air"), source);
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({ entry: "main.air", hostAbi: "0.10", name: "v53.vec", version: "0.1.0" }, null, 2)}\n`);
  return dir;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-assurance-"));
  try {
    const ast = sp.parseSource(T2_SOURCE, "f.air", GATED);
    sp.verifySource(ast, GATED);
    const file = path.join(tmp, "f.air");
    fs.writeFileSync(file, T2_SOURCE);
    const packageDir = writePackage(path.join(tmp, "P"), T2_SOURCE);
    const resultDir = writePackage(path.join(tmp, "P2"), T2_SOURCE);

    await vector("V53-ASSUR-01", async () => {
      // R-WB-24: the legacy certificate never returns `verified` for a typed-v0.53 AST.
      let error = null;
      try {
        createVerifiedResourceCertificate(ast);
      } catch (caught) {
        error = caught;
      }
      assert(error, "never verified");
      assert.equal(error.code, "air.resource_certificate.profile_unsupported");
      return { value: { code: error.code }, sourceDigest: sha256(T2_SOURCE) };
    });
    await vector("V53-ASSUR-02", async () => ({ value: await refusal("createAiReviewReport", () => createAiReviewReport(ast)) }));
    await vector("V53-ASSUR-03", async () => ({
      value: [await refusal("auditModule", () => auditModule(ast)), await refusal("explainModule", () => explainModule(ast))]
    }));
    await vector("V53-ASSUR-04", async () => ({ value: await refusal("analyzeProvenanceModule", () => analyzeProvenanceModule(ast)) }));
    await vector("V53-ASSUR-05", async () => ({
      value: [
        await refusal("createSemanticPatch", () => createSemanticPatch(packageDir, resultDir, { sourceProfile: V053 })),
        await refusal("inspectSemanticPatch", () => inspectSemanticPatch({ any: "input" }, { sourceProfile: V053 }))
      ]
    }));
    await vector("V53-ASSUR-06", async () => {
      const sdk = await refusal("emitWit", () => emitWit(ast));
      const cli = runCli(["wit", file, "--source-profile", V053, "--allow-candidate-profile"]);
      assert.notEqual(cli.status, 0);
      assert.match(cli.stderr, /^air\.source_profile\.command_unsupported:/mu);
      const ungated = runCli(["wit", file, "--source-profile", V053]);
      assert.match(ungated.stderr, /^air\.source_profile\.candidate_disabled:/mu);
      return { value: { cli: "air.source_profile.command_unsupported", sdk: sdk.code } };
    });
    await vector("V53-ASSUR-07", () => {
      const out = {};
      for (const command of ["audit", "explain", "report"]) {
        const cli = runCli([command, file, "--source-profile", V053, "--allow-candidate-profile"]);
        assert.notEqual(cli.status, 0);
        assert.match(cli.stderr, /^air\.source_profile\.command_unsupported:/mu, command);
        out[command] = "air.source_profile.command_unsupported";
      }
      return { value: out };
    });
    await vector("V53-ASSUR-08", async () => ({
      value: [
        await refusal("assertRealtimeSafeProfile", () => assertRealtimeSafeProfile(ast, { airAbi: "0.11", feature: "borrowed-slice-v1", maximumFuel: 1, mode: "realtime_safe" }, null)),
        await refusal("createVerifiedExecutionSession", () => createVerifiedExecutionSession({ packageDir, sourceProfile: V053 }))
      ]
    }));
    await vector("V53-ASSUR-09", async () => {
      const outcomes = [];
      for (const profile of [null, { airAbi: "0.11", feature: "borrowed-slice-v1", maximumFuel: 1, mode: "realtime_safe" }]) {
        let error = null;
        try {
          assertRealtimeSafeProfile(ast, profile, null);
        } catch (caught) {
          error = caught;
        }
        assert(error && !(error instanceof TypeError), "never success, never a TypeError");
        assert.equal(error.code, UNSUPPORTED);
        assert(!/^air\.realtime\./u.test(error.code), "never an air.realtime.* code");
        outcomes.push(error.code);
      }
      return { value: outcomes };
    });
    await vector("V53-ASSUR-10", async () => {
      const out = {};
      // (i)-(iii): refused before the package is read or parsed, whatever P contains.
      const missing = path.join(tmp, "does-not-exist");
      for (const [profile, expected] of [[V053, UNSUPPORTED], ["typed-v0.51", UNSUPPORTED], ["typed-v0.52", "air.source_profile.unsupported"]]) {
        const codes = [];
        for (const [label, action] of [
          ["createVerifiedExecutionSession", () => createVerifiedExecutionSession({ packageDir: missing, sourceProfile: profile })],
          ["createSemanticPatch", () => createSemanticPatch(missing, missing, { sourceProfile: profile })],
          ["inspectSemanticPatch", () => inspectSemanticPatch(undefined, { sourceProfile: profile })]
        ]) {
          let error = null;
          try {
            await action();
          } catch (caught) {
            error = caught;
          }
          assert(error, `${label} ${profile}`);
          assert.equal(error.code, expected, `${label} ${profile}: ${error.message}`);
          codes.push(error.code);
        }
        out[profile] = codes;
      }
      // (vi): without the option, the 388c790 behaviour, equal to H52_BASELINE.
      const preservation = [
        sameAsBaseline(tmp, { packageDir, probe: "session" }),
        sameAsBaseline(tmp, { packageDir, probe: "createPatch", resultDir }),
        sameAsBaseline(tmp, { patchInput: { any: "input" }, probe: "inspectPatch" })
      ];
      if (preservation.some((item) => item.status === "ENVIRONMENT_UNAVAILABLE")) return { status: "ENVIRONMENT_UNAVAILABLE", value: out };
      out.without_option = preservation;
      return { value: out };
    });
    await vector("V53-ASSUR-11", async () => {
      const refused = [
        await refusal("createAudioAuthorityReport", () => createAudioAuthorityReport(ast)),
        await refusal("createAudioAuthorityReport", () => createAudioAuthorityReport(ast, { manifest: { authority: { kind: "host-owned" } } }))
      ];
      const preservation = [
        sameAsBaseline(tmp, { probe: "audioLegacy", source: LEGACY_SOURCE }),
        sameAsBaseline(tmp, { capabilities: ["audio"], externs: [{ name: "audio.play_sound" }], manifest: { audio: { cues: [] } }, probe: "audioModuleLike" })
      ];
      if (preservation.some((item) => item.status === "ENVIRONMENT_UNAVAILABLE")) return { status: "ENVIRONMENT_UNAVAILABLE", value: { refused } };
      return { value: { preservation, refused } };
    });
    await vector("V53-ASSUR-12", async () => {
      const refused = await refusal("createConformanceReport", () => createConformanceReport(ast));
      const preservation = sameAsBaseline(tmp, { probe: "conformanceLegacy", source: LEGACY_SOURCE });
      if (preservation.status === "ENVIRONMENT_UNAVAILABLE") return { status: "ENVIRONMENT_UNAVAILABLE", value: { refused } };
      return { value: { preservation, refused } };
    });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const passed = results.filter((item) => item.status === "PASS").length;
  if (process.env.AIR_SCALAR_VECTOR_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, "v053_assurance_floor.results.json"), `${JSON.stringify(results.map((item) => JSON.parse(canonicalJson(item))), null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    console.error(`typed-v0.53 assurance floor: ${failures.length} failed, ${passed} passed`);
    process.exitCode = 1;
    return;
  }
  console.log(`typed-v0.53 assurance floor: ${passed}/${results.length} PASS (V53-ASSUR-01..12)`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
