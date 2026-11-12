#!/usr/bin/env node
"use strict";

// SEC53-03 (AIR_V053_SEC53_03_HOST_AUTHORITY_SPEC_R2_2026_11_09): host-authoritative grants, facts and time.
// VECTORS.md section 1's 29 rows (P1, the eight P2 rows, P3, C1 and H1-H12), on the shipped tool_gate package. SPEC
// section 6's mutants M1-M9 each run on a scratch copy of the tree, against all 29 rows; a mutant is caught when a row
// it names fails. The rows run in a child process on a given tree (this file with --rows), so each tree loads its own
// src. A refusal also checks SPEC section 8's stage: a brand refusal comes at the request intake, before package
// verification (no package or certificate bound); a host-state-fact refusal comes at the facts step, after
// verification and the certificate (both bound), before the preflight (no facts bound).
// Set AIR_SEC53_03_RESULTS_DIR=<dir> to write the results.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CHILD_MS = 600000;
const sha = (text) => `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
const short = (e) => `${e && e.name ? `${e.name}: ` : ""}${String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160)}`;

// ---------------------------------------------------------------------------
// Child side: the rows, on the tree at ctx.tree. VECTORS.md's base values.

const ARGS = [["facts", "amount"], ["effective", "amountLimit"], ["facts", "quotaUsed"], ["effective", "quotaLimit"], ["facts", "rateUsed"],
  ["effective", "rateLimit"], ["facts", "targetId"], ["effective", "allowedTargetId"], ["effective", "now"], ["effective", "expiresAt"],
  ["effective", "redactionFlag"]].map(([from, key]) => ({ from, key }));
const GRANT = { id: "agent.tool.invoke", decision: "allow", capability: "output", effects: ["output.emit"], targetId: 7, maxAmount: 100,
  quotaLimit: 3, rateLimit: 4, expiresAt: 2000, redaction: "required" };
const LIMITS = { maxAmount: 80, quotaLimit: 2, rateLimit: 3, now: 1000, maxOutputs: 1, maxHostCalls: 1 };
const HOST_FACTS = { quotaUsed: 1, rateUsed: 1, requiresRedaction: true };
const REQUEST_FACTS = { amount: 25, targetId: 7 };
const UNBRANDED = ["authority_unbranded", "air.run.authority_unbranded"];
const hostStateMessage = (key) => `facts.${key} is host state: supply it in hostAuthority({ hostFacts })`;

function rowContext(tree) {
  const air = require(path.join(tree, "src"));
  const sdk = require(path.join(tree, "src", "sdk.js"));
  const example = require(path.join(tree, "examples", "tool_gate", "request.js"));
  const dir = path.join(tree, "examples", "tool_gate");
  const ctx = { tree, air, sdk, example };
  // Today's single-object request, the form runHostConstructed keeps: request and host facts in one object.
  ctx.legacy = (o = {}) => ({
    package: { directory: dir, profile: "mock-output-v011", entrypoint: "decide", requiredGrant: "agent.tool.invoke", arguments: ARGS },
    facts: { ...REQUEST_FACTS, ...HOST_FACTS, ...(o.requestFacts || {}), ...(o.hostFacts || {}) },
    grants: [{ ...GRANT, ...(o.grant || {}) }],
    limits: { ...LIMITS, ...(o.limits || {}) },
    adapters: { "output.emit": "capture" }
  });
  ctx.authorityOf = (o = {}) => example.createToolGateAuthority({ grant: o.grant, limits: o.limits, hostFacts: o.hostFacts });
  ctx.branded = (o = {}) => example.createToolGateRequest(ctx.authorityOf(o), { ...REQUEST_FACTS, ...(o.requestFacts || {}) });
  let reference = null;
  ctx.reference = async () => {
    if (!reference) reference = JSON.stringify(await air.runHostConstructed(ctx.legacy()));
    return reference;
  };
  return ctx;
}

function stageOf(result) {
  const b = (result.evidence && result.evidence.bindings) || {};
  return { package: Boolean(b.package), certificate: Boolean(b.certificateDigest), facts: Boolean(b.factsDigest) };
}

// VECTORS.md section 1: "refused" = deny with the reason named, the code named present, execution not_run, no outputs,
// and the message exact where one is named. Plus SPEC section 8's stage for the refusal's kind.
function refusedAs(result, [reason, code], message, stage) {
  const seen = {
    reason: result.decision.reasonCode,
    execution: result.evidence.execution.status,
    outputs: result.outputs.length,
    codes: result.diagnostics.map((item) => item.code),
    message: (result.diagnostics[0] || {}).message,
    stage: stageOf(result)
  };
  const atStage = stage === "intake" ? !seen.stage.package && !seen.stage.certificate
    : stage === "facts" ? seen.stage.package && seen.stage.certificate && !seen.stage.facts : true;
  const ok = seen.reason === reason && seen.execution === "not_run" && seen.outputs === 0 && seen.codes.includes(code)
    && (!message || seen.message === message) && atStage;
  return { ok, detail: seen };
}

const throwsWith = (fn) => { try { fn(); return null; } catch (error) { return String(error.message); } };

const P2 = [
  ["P2-amount", "request amount 81", { requestFacts: { amount: 81 } }, "amount_limit"],
  ["P2-target", "request targetId 8", { requestFacts: { targetId: 8 } }, "forbidden_target"],
  ["P2-quota", "host quotaUsed 2", { hostFacts: { quotaUsed: 2 } }, "quota_limit"],
  ["P2-rate", "host rateUsed 3", { hostFacts: { rateUsed: 3 } }, "rate_limit"],
  ["P2-now", "host now 2001", { limits: { now: 2001 } }, "expired_grant"],
  ["P2-deny", "grant decision deny", { grant: { decision: "deny" } }, "explicit_denial"],
  ["P2-redaction", "grant redaction none", { grant: { redaction: "none" } }, "redaction_required"],
  ["P2-allowed", "host requiresRedaction false, grant redaction none", { hostFacts: { requiresRedaction: false }, grant: { redaction: "none" } }, "allowed"]
];

const ROWS = {
  // P1: the example's request through run equals runHostConstructed(today's request), byte for byte.
  P1: async (ctx) => {
    const result = await ctx.air.run(ctx.example.createToolGateRequest());
    const text = JSON.stringify(result);
    return { ok: text === await ctx.reference() && result.decision.status === "allow" && result.outputs.length === 1,
      detail: { reason: result.decision.reasonCode, outputs: result.outputs.length, result: sha(text) } };
  },
  ...Object.fromEntries(P2.map(([id, , values, reason]) => [id, async (ctx) => {
    const branded = await ctx.air.run(ctx.branded(values));
    const named = await ctx.air.runHostConstructed(ctx.legacy(values));
    const a = JSON.stringify(branded);
    return { ok: a === JSON.stringify(named) && branded.decision.reasonCode === reason,
      detail: { reason: branded.decision.reasonCode, named: named.decision.reasonCode, result: sha(a) } };
  }])),
  // P3: one authority, two requests.
  P3: async (ctx) => {
    const authority = ctx.authorityOf();
    const a = JSON.stringify(await ctx.air.run(ctx.example.createToolGateRequest(authority)));
    const b = JSON.stringify(await ctx.air.run(ctx.example.createToolGateRequest(authority)));
    return { ok: a === b && a === await ctx.reference(), detail: { same: a === b, equalsP1: a === await ctx.reference(), result: sha(a) } };
  },
  // C1: the named single-object form keeps today's behaviour, a JSON round trip included (R-1).
  C1: async (ctx) => {
    const text = JSON.stringify(await ctx.air.runHostConstructed(JSON.parse(JSON.stringify(ctx.legacy()))));
    return { ok: text === await ctx.reference(), detail: { result: sha(text) } };
  },
  H1: async (ctx) => refusedAs(await ctx.air.run(ctx.legacy()), UNBRANDED, null, "intake"),
  H1s: async (ctx) => refusedAs(await ctx.sdk.run(ctx.legacy()), UNBRANDED, null, "intake"),
  H1p: async (ctx) => {
    const r = refusedAs(await ctx.air.runPackage(ctx.legacy()), UNBRANDED, null, "intake");
    const same = ctx.air.runPackage === ctx.air.run;
    return { ok: r.ok && same, detail: { ...r.detail, runPackageIsRun: same } };
  },
  H1j: async (ctx) => refusedAs(await ctx.air.run(JSON.parse(JSON.stringify(ctx.legacy()))), UNBRANDED, null, "intake"),
  H2: async (ctx) => {
    const request = ctx.example.createToolGateRequest();
    return refusedAs(await ctx.air.run({ authority: JSON.parse(JSON.stringify(request.authority)), facts: request.facts }), UNBRANDED, null, "intake");
  },
  H2b: async (ctx) => {
    const l = ctx.legacy();
    const plain = { package: l.package, grants: l.grants, limits: l.limits, adapters: l.adapters, hostFacts: HOST_FACTS };
    return refusedAs(await ctx.air.run({ authority: plain, facts: REQUEST_FACTS }), UNBRANDED, null, "intake");
  },
  ...Object.fromEntries([["H3", "grants"], ["H4", "limits"], ["H5", "package"], ["H5b", "adapters"]].map(([id, key]) => [id, async (ctx) => {
    const request = { ...ctx.example.createToolGateRequest(), [key]: ctx.legacy({ limits: { now: 0 } })[key] };
    return refusedAs(await ctx.air.run(request), UNBRANDED, null, "intake");
  }])),
  ...Object.fromEntries([["H6", "quotaUsed", 0], ["H7", "requiresRedaction", false]].map(([id, key, value]) => [id, async (ctx) => {
    const request = ctx.example.createToolGateRequest();
    return refusedAs(await ctx.air.run({ authority: request.authority, facts: { ...REQUEST_FACTS, [key]: value } }),
      ["input_invalid", "air.run.input_invalid"], hostStateMessage(key), "facts");
  }])),
  H6b: async (ctx) => {
    const authority = ctx.air.hostAuthority({ package: ctx.legacy().package, grants: [GRANT], limits: LIMITS, adapters: { "output.emit": "capture" },
      hostFacts: { rateUsed: 1, requiresRedaction: true } });
    return refusedAs(await ctx.air.run({ authority, facts: { ...REQUEST_FACTS, quotaUsed: 0 } }),
      ["input_invalid", "air.run.input_invalid"], hostStateMessage("quotaUsed"), "facts");
  },
  H8: async (ctx) => {
    const authority = ctx.authorityOf({ hostFacts: { riskLevel: 3 } });
    return refusedAs(await ctx.air.run({ authority, facts: { ...REQUEST_FACTS, riskLevel: 0 } }),
      ["input_invalid", "air.run.input_invalid"], hostStateMessage("riskLevel"), "facts");
  },
  // H9: the host's objects change after hostAuthority; the run uses the snapshot taken there.
  H9: async (ctx) => {
    const config = { package: ctx.legacy().package, grants: [{ ...GRANT }], limits: { ...LIMITS }, adapters: { "output.emit": "capture" }, hostFacts: { ...HOST_FACTS } };
    const authority = ctx.air.hostAuthority(config);
    config.limits.now = 2001;
    config.grants[0].targetId = 9;
    config.hostFacts.quotaUsed = 2;
    const text = JSON.stringify(await ctx.air.run({ authority, facts: REQUEST_FACTS }));
    return { ok: text === await ctx.reference(), detail: { equalsP1: text === await ctx.reference(), result: sha(text) } };
  },
  H10: async (ctx) => {
    const message = throwsWith(() => ctx.air.hostAuthority({ package: ctx.legacy().package, grants: [{ ...GRANT, sessionToken: "x" }], limits: LIMITS, adapters: {} }));
    return { ok: message === "air.run.authority_invalid: grants[0] contains unsupported field sessionToken", detail: { message } };
  },
  H11: async (ctx) => refusedAs(await ctx.air.run({ ...ctx.example.createToolGateRequest(), now: 0 }),
    ["request_invalid", "air.run.request_invalid"], "request contains unsupported field now", "intake"),
  H12: async (ctx) => {
    const a = throwsWith(() => ctx.example.createToolGateRequest(ctx.authorityOf(), JSON.parse("{\"amount\":25,\"targetId\":7,\"quotaUsed\":0}")));
    const b = throwsWith(() => ctx.example.createToolGateRequest(ctx.authorityOf(), JSON.parse("{\"amount\":25,\"targetId\":7,\"limits\":{\"now\":0}}")));
    return { ok: a === "tool request field quotaUsed is not accepted" && b === "tool request field limits is not accepted", detail: { quotaUsed: a, limits: b } };
  }
};

async function runRows(tree, ids) {
  const ctx = rowContext(tree);
  const out = {};
  for (const id of ids) {
    try {
      const r = await ROWS[id](ctx);
      out[id] = { ok: Boolean(r.ok), detail: r.detail };
    } catch (error) {
      out[id] = { ok: false, threw: short(error) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestrator side: SPEC section 6's mutants M1-M9, with the anchors of the spec's tools/s3_mutants.js. Each edit's
// anchor must occur exactly once in its file of the scratch copy, or the mutant is not applied.

const RP = "src/run_package.js";
const EX = "examples/tool_gate/request.js";
const MUTANTS = {
  M1: { rows: ["H2b"], description: "the brand check accepts any object that normalizes as authority",
    edits: [[RP, "HOST_AUTHORITY.get(request.authority) : undefined", "(HOST_AUTHORITY.get(request.authority) || HOST_AUTHORITY.get(hostAuthority(request.authority))) : undefined"]] },
  M2: { rows: ["H3", "H4", "H5", "H5b"], description: "authority material in the request is not refused (the snapshot is used)",
    edits: [[RP, "const carried = Object.keys(request).filter((key) => AUTHORITY_MATERIAL_KEYS.has(key)).sort();", "const carried = [];"],
      [RP, "rejectUnknownKeys(request, AUTHORITY_REQUEST_KEYS, \"request\");", "rejectUnknownKeys(request, new Set([...AUTHORITY_REQUEST_KEYS, ...AUTHORITY_MATERIAL_KEYS]), \"request\");"]] },
  M3: { rows: ["H6b"], description: "the host-state fact keys are not refused in request facts",
    edits: [[RP, "if (HOST_STATE_FACT_KEYS.includes(key) || Object.prototype", "if (Object.prototype"]] },
  M4: { rows: ["H8"], description: "request facts may repeat hostFacts keys, and win",
    edits: [[RP, "HOST_STATE_FACT_KEYS.includes(key) || Object.prototype.hasOwnProperty.call(hostFacts, key)", "HOST_STATE_FACT_KEYS.includes(key)"],
      [RP, "normalizeFacts({ ...requestFacts, ...hostFacts })", "normalizeFacts({ ...hostFacts, ...requestFacts })"]] },
  M5: { rows: ["H9"], description: "no snapshot: the authority reads the host's live objects at run time",
    edits: [[RP, "HOST_AUTHORITY.set(token, snapshot);", "HOST_AUTHORITY.set(token, { get descriptor() { return normalizePackageDescriptor(config.package); }, get grants() { return normalizeGrants(config.grants); }, get limits() { return normalizeLimits(config.limits); }, get adapters() { return normalizeAdapters(config.adapters); }, get hostFacts() { return normalizeFacts(config.hostFacts === undefined ? {} : config.hostFacts); } });"]] },
  M6: { rows: ["H1", "H1s", "H1j"], description: "run() falls back to today's single-object form",
    edits: [[RP, "return runRequest(request, \"authority\");", "return runRequest(request, request && Object.prototype.hasOwnProperty.call(request, \"authority\") ? \"authority\" : \"host-constructed\");"]] },
  M7: { rows: ["H12"], description: "the example passes client keys through",
    edits: [[EX, "if (extra.length) throw", "if (false) throw"], [EX, "return { amount: untrusted.amount, targetId: untrusted.targetId };", "return { ...untrusted };"]] },
  M8: { rows: ["P1"], description: "hostFacts are not merged into the bound facts",
    edits: [[RP, "return normalizeFacts({ ...requestFacts, ...hostFacts });", "return normalizeFacts({ ...requestFacts });"]] },
  M9: { rows: ["H1p"], description: "runPackage bound to runHostConstructed (QA's R1 review, P2-1)",
    edits: [[RP, "const runPackage = run;", "const runPackage = runHostConstructed;"]] }
};

function scratchTree(name, mutant) {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `air-sec53-03-${name}-`));
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
  const outDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-03-out-"));
  const outFile = path.join(outDir, "rows.json");
  const out = childProcess.spawnSync(process.execPath, [__filename, "--rows", tree, outFile, ...ids], {
    cwd: os.tmpdir(), encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: CHILD_MS
  });
  let results = null;
  if (!out.signal && out.status === 0 && fs.existsSync(outFile)) results = JSON.parse(fs.readFileSync(outFile, "utf8"));
  fs.rmSync(outDir, { force: true, recursive: true });
  if (results) return { ran: true, results };
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
    else failures.push(`${id}: ${JSON.stringify(row)}`);
  }
  const mutants = {};
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    const { applied, scratch } = scratchTree(name, mutant);
    let ran = false;
    let failing = [];
    let set = { results: {} };
    if (applied) {
      set = runChild(scratch, allRows);
      ran = set.ran;
      failing = allRows.filter((id) => !(set.results[id] && set.results[id].ok));
    }
    fs.rmSync(scratch, { force: true, recursive: true });
    const caughtBy = mutant.rows.filter((id) => failing.includes(id));
    const caught = applied && ran && caughtBy.length > 0;
    // Why each named row failed under the mutant, cut to 300 characters.
    const caughtDetail = Object.fromEntries(caughtBy.map((id) => [id, JSON.stringify(set.results[id]).slice(0, 300)]));
    mutants[name] = { applied, caught, caught_by: caughtBy, caught_detail: caughtDetail, description: mutant.description, failing_rows: failing, named_rows: mutant.rows, ran };
    if (caught) console.log(`ok - mutant ${name} (${mutant.description}): applied, ran, caught by ${caughtBy.join(", ")}${failing.length > caughtBy.length ? `; also failing ${failing.filter((id) => !caughtBy.includes(id)).join(", ")}` : ""}`);
    else failures.push(`mutant ${name} (${mutant.description}): applied ${applied}, ran ${ran}, caught ${caught}, failing ${failing.join(", ") || "none"}`);
  }
  const list = Object.values(mutants);
  const totals = { applied: list.filter((item) => item.applied).length, caught: list.filter((item) => item.caught).length, mutants: list.length, ran: list.filter((item) => item.ran).length };
  if (process.env.AIR_SEC53_03_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SEC53_03_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SEC53_03_RESULTS_DIR, "v053_host_authority.results.json"), `${JSON.stringify({ mutants, platform: process.platform, rows: real.results, totals }, null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`SEC53-03 host authority: ${failures.length} failed`);
    process.exitCode = 1;
    return;
  }
  assert.equal(totals.applied, totals.mutants);
  console.log(`SEC53-03 host authority: ${allRows.length} rows PASS (VECTORS.md section 1: P1, ${P2.length} P2 rows, P3, C1 and ${allRows.filter((id) => id.startsWith("H")).length} H rows); mutants applied ${totals.applied}, ran ${totals.ran}, caught ${totals.caught} of ${totals.mutants} (${process.platform})`);
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
