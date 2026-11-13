#!/usr/bin/env node
"use strict";

// SEC53-08 (frozen as SEC53_07_RUN_ARGUMENT_RANGE; AIR_V053_SEC53_07_RUN_ARGUMENT_RANGE_SPEC_R3_2026_11_12): air.run's entry-point
// arguments stay in the signed i32 range. VECTORS.md's 17 rows (P1, P2a, P2b, P3, P4, N1-N8, H1, U1-U3) on the shipped tool_gate
// package, built into an authority with hostAuthority as examples/tool_gate/request.js does; each row changes one thing. A "units" row
// maps argument 2 (the module's quota_used) to a request fact the preflight does not check; the module emits quota_used as the output's
// fourth scalar, so the output shows the value AIR received. SPEC section 6's mutants M1-M6 each run on a scratch copy of the tree,
// against all 17 rows: M1-M5 must be caught by a row they name; M6 is the one section 6 states equivalent (Number.isInteger is redundant
// behind resolveArguments), so it must be applied and ran, and is recorded caught or not. The rows run in a child process on a given
// tree (this file with --rows), so each tree loads its own src.
// A refused row also checks SPEC section 8: nothing ran before the refusal (no WebAssembly.instantiate call, so no host import), the
// execution record is failed with no argumentDigest, and there is no output. An in-range row also checks its argumentDigest against
// VECTORS.md's values (section 8: unchanged by the check).
// Set AIR_SEC53_08_RESULTS_DIR=<dir> to write the results.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CHILD_MS = 600000;
const short = (e) => `${e && e.name ? `${e.name}: ` : ""}${String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160)}`;

// ---------------------------------------------------------------------------
// Child side: the rows, on the tree at ctx.tree.

const ARGUMENTS = [
  { from: "facts", key: "amount" }, { from: "effective", key: "amountLimit" }, { from: "facts", key: "quotaUsed" },
  { from: "effective", key: "quotaLimit" }, { from: "facts", key: "rateUsed" }, { from: "effective", key: "rateLimit" },
  { from: "facts", key: "targetId" }, { from: "effective", key: "allowedTargetId" }, { from: "effective", key: "now" },
  { from: "effective", key: "expiresAt" }, { from: "effective", key: "redactionFlag" }
];
const P31 = 2 ** 31;
// VECTORS.md: "Every P and U row gives the same result on both trees, argumentDigest included".
const DIGEST = {
  shipped: "sha256:a6ec10ae9722878bae99b1fea14664f37a3078222ff3e3e7a8e701bb569abbf3",
  P2b: "sha256:e7ec7e20714918f29a2b9bbec6e2d0f03b351a905b4a9f0e1304601baeffdac9",
  P3: "sha256:b730aace11087907c82db928b9f16cc33f7b49a20f99203625b5ceae6ed32183",
  P4: "sha256:f0ffdd2b800daa956f73894666844e56a30bdfd4266a10080a1ef8826bb6811b"
};

function rowContext(tree) {
  const air = require(path.join(tree, "src"));
  const dir = path.join(tree, "examples", "tool_gate");
  // Count WebAssembly.instantiate calls: a refused run must make none, so it reaches no host import.
  const original = WebAssembly.instantiate;
  let instantiations = 0;
  WebAssembly.instantiate = function countingInstantiate(...args) { instantiations += 1; return original.apply(this, args); };
  // The shipped example's host state (examples/tool_gate/request.js's createToolGateAuthority), with one change per row.
  const hostState = (change = {}) => {
    const args = ARGUMENTS.map((a) => ({ ...a }));
    if (change.arg2) args[2] = change.arg2;
    return {
      package: { directory: dir, profile: "mock-output-v011", entrypoint: "decide", requiredGrant: "agent.tool.invoke", arguments: args },
      grants: [{ id: "agent.tool.invoke", decision: "allow", capability: "output", effects: ["output.emit"], targetId: 7, maxAmount: 100,
        quotaLimit: 3, rateLimit: 4, expiresAt: 2000, redaction: "required", ...(change.grant || {}) }],
      limits: { maxAmount: 80, quotaLimit: 2, rateLimit: 3, now: 1000, maxOutputs: 1, maxHostCalls: 1, ...(change.limits || {}) },
      adapters: { "output.emit": "capture" },
      hostFacts: { quotaUsed: 1, rateUsed: 1, requiresRedaction: true }
    };
  };
  const measure = async (make) => {
    const before = instantiations;
    const result = await make();
    return { result, instantiations: instantiations - before };
  };
  return {
    air,
    viaRun: (change = {}, facts = {}) => measure(() => air.run({ authority: air.hostAuthority(hostState(change)), facts: { amount: 25, targetId: 7, ...facts } })),
    viaHostConstructed: (change = {}, facts = {}) => measure(() => {
      const { hostFacts, ...rest } = hostState(change);
      return air.runHostConstructed({ ...rest, facts: { amount: 25, targetId: 7, ...hostFacts, ...facts } });
    })
  };
}
const units = () => ({ arg2: { from: "facts", key: "units" } });

function brief({ result, instantiations }) {
  const exec = result.evidence && result.evidence.execution;
  return {
    decision: `${result.decision.status}:${result.decision.reasonCode}`,
    execution: exec ? { status: exec.status, argumentDigest: exec.argumentDigest } : null,
    outputs: (result.outputs || []).map((o) => o.scalarArgs),
    failures: (result.diagnostics || []).filter((d) => d.severity === "fail").map((d) => ({ code: d.code, error: d.fields && d.fields.error ? String(d.fields.error) : d.message })),
    instantiations
  };
}
// Executed in range: the decision, the argumentDigest, the module instantiated (an executed run instantiates it twice here), and (for an
// allow) the quota_used AIR received.
const executed = (decision, digest, quotaSeen) => (got) => got.decision === decision && got.execution && got.execution.status === "executed"
  && got.execution.argumentDigest === digest && got.instantiations >= 1
  && (quotaSeen === undefined || (got.outputs.length === 1 && got.outputs[0][3] === quotaSeen));
// Refused (VECTORS.md): deny:execution_failed; air.run.execution_failed whose error begins with the message (OD-S7-1 (a)); execution
// failed; no argumentDigest; no output; and nothing instantiated before the refusal (section 8).
const refused = (index) => (got) => {
  const want = `air.run.argument_invalid: embedding argument ${index} must be a signed i32`;
  return got.decision === "deny:execution_failed" && got.execution && got.execution.status === "failed" && got.execution.argumentDigest === null
    && got.outputs.length === 0 && got.instantiations === 0
    && got.failures.some((f) => f.code === "air.run.execution_failed" && f.error.startsWith(want));
};

const ROWS = {
  P1: { what: "the shipped request, unchanged", run: (c) => c.viaRun(), ok: executed("allow:allowed", DIGEST.shipped, 1) },
  P2a: { what: "units = 1 through a host-mapped request fact", run: (c) => c.viaRun(units(), { units: 1 }), ok: executed("allow:allowed", DIGEST.shipped, 1) },
  P2b: { what: "units = 3", run: (c) => c.viaRun(units(), { units: 3 }), ok: executed("deny:air_denied", DIGEST.P2b) },
  P3: { what: "units = 2^31 - 1, the top of the range", run: (c) => c.viaRun(units(), { units: P31 - 1 }), ok: executed("deny:air_denied", DIGEST.P3) },
  P4: { what: "units = -2^31, the bottom of the range: AIR receives it unchanged", run: (c) => c.viaRun(units(), { units: -P31 }), ok: executed("allow:allowed", DIGEST.P4, -P31) },
  N1: { what: "units = 2^31", run: (c) => c.viaRun(units(), { units: P31 }), ok: refused(2) },
  N2: { what: "units = 2^32 + 1", run: (c) => c.viaRun(units(), { units: 2 ** 32 + 1 }), ok: refused(2) },
  N3: { what: "units = -2^31 - 1", run: (c) => c.viaRun(units(), { units: -P31 - 1 }), ok: refused(2) },
  N4: { what: "units = 2^53 - 1", run: (c) => c.viaRun(units(), { units: Number.MAX_SAFE_INTEGER }), ok: refused(2) },
  N5: { what: "a host grant with expiresAt = 2^53 - 1, through effective.expiresAt", run: (c) => c.viaRun({ grant: { expiresAt: Number.MAX_SAFE_INTEGER } }), ok: refused(9) },
  N6: { what: "millisecond times: limits.now 1731400000000, grant expiresAt 1731500000000", run: (c) => c.viaRun({ limits: { now: 1731400000000 }, grant: { expiresAt: 1731500000000 } }), ok: refused(8) },
  N7: { what: "an effective bound past the range: grant maxAmount and limits maxAmount 2^31", run: (c) => c.viaRun({ grant: { maxAmount: P31 }, limits: { maxAmount: P31 } }), ok: refused(1) },
  N8: { what: "a literal argument of 2^31", run: (c) => c.viaRun({ arg2: { from: "literal", value: P31 } }), ok: refused(2) },
  H1: { what: "runHostConstructed, units = 2^32 + 1", run: (c) => c.viaHostConstructed(units(), { units: 2 ** 32 + 1 }), ok: refused(2) },
  U1: { what: "units = true: today's boolean mapping (1)", run: (c) => c.viaRun(units(), { units: true }), ok: executed("allow:allowed", DIGEST.shipped, 1) },
  U2: { what: "units = \"12\": today's refusal of a value that is not a safe integer", run: (c) => c.viaRun(units(), { units: "12" }),
    ok: (got) => got.decision === "deny:execution_failed" && got.instantiations === 0 && got.failures.some((f) => f.error.includes("must resolve to a safe integer")) },
  U3: { what: "units = 1.5: today's refusal at fact intake", run: (c) => c.viaRun(units(), { units: 1.5 }),
    ok: (got) => got.decision === "deny:input_invalid" && got.instantiations === 0 && (!got.execution || got.execution.status !== "executed") }
};

async function runRows(tree, ids) {
  const ctx = rowContext(tree);
  const out = {};
  for (const id of ids) {
    try {
      const got = brief(await ROWS[id].run(ctx));
      out[id] = { ok: Boolean(ROWS[id].ok(got)), got };
    } catch (error) {
      out[id] = { ok: false, threw: short(error) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestrator side: SPEC section 6's mutants M1-M6, with the anchors of the spec's tools/s7_mutants.js. Each edit's anchor must occur
// exactly once in src/run_package.js of the scratch copy, or the mutant is not applied.

const RP = "src/run_package.js";
const CHECK = "    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {\n";
const MUTANTS = {
  M1: { rows: ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "H1"], description: "the check removed",
    edits: [[RP, "  args.forEach((value, index) => {\n" + CHECK + "      throw new Error(`air.run.argument_invalid: embedding argument ${index} must be a signed i32`);\n    }\n  });\n", ""]] },
  M2: { rows: ["N1", "N7", "N8"], description: "the upper bound one too high (admits 2^31)", edits: [[RP, "value > 2147483647)", "value > 2147483648)"]] },
  M3: { rows: ["N3"], description: "the lower bound one too low (admits -2^31 - 1)", edits: [[RP, "value < -2147483648 ||", "value < -2147483649 ||"]] },
  M4: { rows: ["P3"], description: "the upper bound one too low (refuses 2^31 - 1)", edits: [[RP, "value > 2147483647)", "value >= 2147483647)"]] },
  M5: { rows: ["P4"], description: "the lower bound one too high (refuses -2^31)", edits: [[RP, "value < -2147483648 ||", "value <= -2147483648 ||"]] },
  M6: { rows: [], equivalent: true, description: "Number.isInteger dropped (equivalent: resolveArguments admits only safe integers and booleans mapped to 0 or 1)",
    edits: [[RP, "!Number.isInteger(value) || ", ""]] }
};

function scratchTree(name, mutant) {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `air-sec53-08-${name}-`));
  for (const part of ["src", "stdlib", "data", "package.json", "examples/tool_gate"]) fs.cpSync(path.join(ROOT, part), path.join(scratch, part), { recursive: true });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(scratch, "node_modules"), "dir");
  let applied = true;
  for (const [file, from, to] of mutant.edits) {
    const target = path.join(scratch, file);
    const text = fs.readFileSync(target, "utf8");
    if (text.split(from).length !== 2) { applied = false; continue; }
    fs.writeFileSync(target, text.replace(from, () => to));
  }
  return { applied, scratch };
}

// A child "ran" only when it finished and wrote its rows; a timeout or a crash is not a run, so it cannot catch.
function runChild(tree, ids) {
  const outDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-08-out-"));
  const outFile = path.join(outDir, "rows.json");
  let out;
  try {
    out = childProcess.spawnSync(process.execPath, [__filename, "--rows", tree, outFile, ...ids], {
      cwd: os.tmpdir(), encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: CHILD_MS
    });
    if (!out.signal && out.status === 0 && fs.existsSync(outFile)) return { ran: true, results: JSON.parse(fs.readFileSync(outFile, "utf8")) };
  } finally {
    fs.rmSync(outDir, { force: true, recursive: true });
  }
  const reason = out.signal ? `killed by ${out.signal} (timeout)` : `exit ${out.status}: ${String(out.stderr).slice(0, 400)}`;
  return { ran: false, results: Object.fromEntries(ids.map((id) => [id, { ok: false, child: reason }])) };
}

async function main() {
  const failures = [];
  const allRows = Object.keys(ROWS);
  const real = runChild(ROOT, allRows);
  if (!real.ran) failures.push(`rows: the child did not finish: ${JSON.stringify(real.results[allRows[0]])}`);
  for (const id of allRows) {
    const row = real.results[id];
    if (row && row.ok) console.log(`ok - ${id}`);
    else failures.push(`${id} (${ROWS[id].what}): ${JSON.stringify(row)}`);
  }
  const mutants = {};
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    const { applied, scratch } = scratchTree(name, mutant);
    let ran = false;
    let failing = [];
    let set = { results: {} };
    try {
      if (applied) {
        set = runChild(scratch, allRows);
        ran = set.ran;
        failing = allRows.filter((id) => !(set.results[id] && set.results[id].ok));
      }
    } finally {
      fs.rmSync(scratch, { force: true, recursive: true });
    }
    const caughtBy = mutant.rows.filter((id) => failing.includes(id));
    const caught = applied && ran && caughtBy.length > 0;
    const caughtDetail = Object.fromEntries(caughtBy.map((id) => [id, JSON.stringify(set.results[id]).slice(0, 300)]));
    mutants[name] = { applied, caught, caught_by: caughtBy, caught_detail: caughtDetail, description: mutant.description, equivalent: Boolean(mutant.equivalent), failing_rows: failing, named_rows: mutant.rows, ran };
    if (mutant.equivalent) {
      // Section 6: "M6 | Number.isInteger dropped | none: equivalent"; section 14: "M6 shown equivalent, or caught".
      if (applied && ran) console.log(`ok - mutant ${name} (${mutant.description}): applied, ran, ${failing.length ? `caught by ${failing.join(", ")}` : "not caught: equivalent, as section 6 states"}`);
      else failures.push(`mutant ${name} (${mutant.description}): applied ${applied}, ran ${ran}`);
    } else if (caught) {
      console.log(`ok - mutant ${name} (${mutant.description}): applied, ran, caught by ${caughtBy.join(", ")}${failing.length > caughtBy.length ? `; also failing ${failing.filter((id) => !caughtBy.includes(id)).join(", ")}` : ""}`);
    } else {
      failures.push(`mutant ${name} (${mutant.description}): applied ${applied}, ran ${ran}, caught ${caught}, failing ${failing.join(", ") || "none"}`);
    }
  }
  const list = Object.values(mutants);
  const required = list.filter((item) => !item.equivalent);
  const equivalent = list.filter((item) => item.equivalent);
  const totals = { applied: list.filter((item) => item.applied).length, ran: list.filter((item) => item.ran).length, mutants: list.length,
    caught: required.filter((item) => item.caught).length, required: required.length, equivalentCaught: equivalent.filter((item) => item.failing_rows.length > 0).length };
  if (process.env.AIR_SEC53_08_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SEC53_08_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SEC53_08_RESULTS_DIR, "v053_run_argument_range.results.json"), `${JSON.stringify({ mutants, platform: process.platform, rows: real.results, totals }, null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`SEC53-08 run argument range: ${failures.length} failed`);
    process.exitCode = 1;
    return;
  }
  assert.equal(totals.applied, totals.mutants);
  assert.equal(totals.ran, totals.mutants);
  console.log(`SEC53-08 run argument range: ${allRows.length} rows PASS (VECTORS.md: P1, P2a, P2b, P3, P4, N1-N8, H1, U1-U3); mutants applied ${totals.applied}, ran ${totals.ran}, caught ${totals.caught} of ${totals.required} (M1-M5); M6 ${totals.equivalentCaught ? "caught" : "not caught, equivalent as section 6 states"} (${process.platform})`);
}

if (process.argv[2] === "--rows") {
  const outFile = process.argv[4];
  runRows(path.resolve(process.argv[3]), process.argv.slice(5)).then((out) => fs.writeFileSync(outFile, JSON.stringify(out)), (error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
} else {
  main().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}
