"use strict";

// typed-v0.53 P0-02 WorkBound composition foundation (RFC R3.1 §6.2-§6.10,
// accepted at H53-P0-RFC). Internal module: it is not exported from
// src/index.js, adds no syntax, and changes no AIR ABI, Host ABI, Host
// Contract or public schema. It is the single exact-integer WorkBound algebra
// (HD-2). Values are BigInt only. Host analysis capacity, clocks, host limits
// and the legacy M1 report (collectEffectUsage, the legacy resource
// certificate, effect budgets, realtime fuel) are never inputs (RFC §6.1,
// R-WB-23). A WorkBound is not a Budget, a grant, a timeout or an admission
// authority (RFC §6.7): nothing in this module derives one.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { canonical } = require("./v051_reference");
const { parseRefinementType } = require("./types");
const { parseTypeReference } = require("./typed_interface");

const WB_MAX = 9223372036854775807n; // R-WB-1 (D-VAL-01): 2^63 - 1
// §6.6 invalid_bound: "above the profile cap of OPEN-14". LOOP_MAX is the
// R-LOOP-1 profile constant, OPEN-14 (a), accepted at H53 (B-1).
const LOOP_MAX = 4096n;
const COST_TABLE_ID = "air.workbound.cost/1";
const COST_TABLE_SCHEMA = "air.workbound.costTable/1";
const COST_TABLE_FILE = "workbound_cost_table_v1.json";
const COST_TABLE_DOMAIN = "AIR_WORKBOUND_COST_TABLE_V1";
const SUMMARY_DOMAIN = "AIR_WORKBOUND_SUMMARY_V1";
const SUMMARY_SCHEMA = "air.workbound.summary/1";

// R-WB-2 (R3): the strict partial algebra has exactly these failure reasons.
const FAILURE_REASONS = Object.freeze(["overflow", "unknown_bound", "invalid_bound", "missing_summary", "recursion"]);
// §6.6: every fail(r) maps to exactly one code; every row is phase S.
const FAILURE_CODES = Object.freeze({
  overflow: "air.workbound.overflow",
  unknown_bound: "air.workbound.unknown_bound",
  invalid_bound: "air.workbound.invalid_bound",
  missing_summary: "air.workbound.missing_summary",
  recursion: "air.call.recursion_rejected"
});
const IDENTITY_MISMATCH_CODE = "air.workbound.identity_mismatch";
// R-WB-26 (R3): IMPLEMENTATION_DEFECT guard, never a STATIC_REJECT, never a
// member of FAILURE_REASONS, never answered with a default cost.
const COST_UNDEFINED_CODE = "air.workbound.cost_undefined";
// R-WB-18 (R3): WorkBoundKeyV1. No analysis-capacity field (V53-ANA-07).
const KEY_FIELDS = Object.freeze(["body_digest", "compiler_implementation_digest", "cost_table", "cost_table_digest", "dependencies", "profile"]);
const RECORD_FIELDS = Object.freeze(["entries", "key", "schema"]);
const SUMMARY_FIELDS = Object.freeze(["calls", "effects", "iterations", "steps"]);
const ADDITIVE = Object.freeze(["steps", "calls", "iterations"]);
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const EFFECT_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const PROFILE_ID = /^[a-z][a-z0-9.-]{0,63}$/;
const MODULE_ID = /^[a-z][a-z0-9._-]{0,127}$/;
const LOCAL_REFERENCE = /^%[A-Za-z_][A-Za-z0-9_]*$/;
const CONSTRUCTOR_ATOM = /^(?:option\.(?:none|some)|result\.(?:ok|err))</;

class WorkBoundError extends Error {
  constructor(code, detail, loc, fields = {}) {
    const prefix = loc && loc.file ? `${loc.file}:${loc.line}: ` : "";
    super(`${prefix}${code}: ${detail}`);
    this.name = "WorkBoundError";
    this.code = code;
    this.detail = detail;
    this.disposition = code === COST_UNDEFINED_CODE ? "IMPLEMENTATION_DEFECT" : "STATIC_REJECT";
    if (loc) this.loc = { ...loc };
    this.fields = Object.freeze({ ...fields });
  }
}

function costUndefined(construct, loc) {
  throw new WorkBoundError(COST_UNDEFINED_CODE, `construct '${construct}' has no CT-1 row`, loc, { construct });
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function domainDigest(domain, text) {
  return digestBytes(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0]), Buffer.from(text, "utf8")]));
}

function exactDecimal(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new TypeError(`${label} must be a canonical decimal string`);
  return BigInt(value);
}

// ---------------------------------------------------------------------------
// CT-1 (RFC §6.4; R-WB-26, R-WB-27, R-WB-27a). The file is the only source of
// weights; the summarizer never carries a second copy.

function loadCostTable(text) {
  const table = JSON.parse(text);
  const keys = Object.keys(table).sort().join(",");
  if (keys !== "id,revision,rows,schema" || table.id !== COST_TABLE_ID || table.schema !== COST_TABLE_SCHEMA ||
      typeof table.revision !== "string" || !Array.isArray(table.rows) || !table.rows.length) {
    throw new TypeError("CT-1 cost table header is invalid");
  }
  const rows = new Map();
  for (const row of table.rows) {
    if (!row || typeof row !== "object" || typeof row.construct !== "string" || !row.construct || typeof row.ct1 !== "string") {
      throw new TypeError("CT-1 row is invalid");
    }
    const allowed = new Set(["construct", "ct1", "steps", "calls", "iterations", "steps_per_arm", "steps_per_case", "effect_per_key"]);
    for (const key of Object.keys(row)) if (!allowed.has(key)) throw new TypeError(`CT-1 row '${row.construct}' has unknown field '${key}'`);
    if (rows.has(row.construct)) throw new TypeError(`CT-1 row '${row.construct}' is duplicated`);
    rows.set(row.construct, Object.freeze({
      construct: row.construct,
      steps: exactDecimal(row.steps, `${row.construct}.steps`),
      calls: exactDecimal(row.calls, `${row.construct}.calls`),
      iterations: exactDecimal(row.iterations, `${row.construct}.iterations`),
      stepsPerArm: row.steps_per_arm === undefined ? null : exactDecimal(row.steps_per_arm, `${row.construct}.steps_per_arm`),
      stepsPerCase: row.steps_per_case === undefined ? null : exactDecimal(row.steps_per_case, `${row.construct}.steps_per_case`),
      effectPerKey: row.effect_per_key === undefined ? null : exactDecimal(row.effect_per_key, `${row.construct}.effect_per_key`)
    }));
  }
  return Object.freeze({ canonicalText: canonical(table), rows, table });
}

const COST_TABLE_PATH = path.join(__dirname, COST_TABLE_FILE);
const COST_TABLE_BYTES = fs.readFileSync(COST_TABLE_PATH);
const COST_TABLE = loadCostTable(COST_TABLE_BYTES.toString("utf8"));
// R-WB-27a: sha256(UTF8("AIR_WORKBOUND_COST_TABLE_V1") || 0x00 || canonical(table)).
const COST_TABLE_DIGEST = domainDigest(COST_TABLE_DOMAIN, COST_TABLE.canonicalText);
const COST_TABLE_FILE_SHA256 = digestBytes(COST_TABLE_BYTES);

function costTableDigest(table) {
  return domainDigest(COST_TABLE_DOMAIN, canonical(table));
}

function ctRow(construct, loc) {
  const row = COST_TABLE.rows.get(construct);
  if (!row) costUndefined(construct, loc);
  return row;
}

// ---------------------------------------------------------------------------
// Summary values (RFC §6.3). S = (steps, calls, iterations, effects); effects
// maps an EffectKey to a count, and the canonical form omits zero entries.

function exactCount(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new TypeError(`${label} must be non-negative`);
    return value;
  }
  if (typeof value === "string") return exactDecimal(value, label);
  throw new TypeError(`${label} must be a BigInt or a canonical decimal string; JS numbers are not WorkBound values`);
}

function freezeSummary(steps, calls, iterations, effects) {
  return Object.freeze({ calls, effects, iterations, steps });
}

function summary(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("summary must be an object");
  for (const key of Object.keys(input)) {
    if (!SUMMARY_FIELDS.includes(key)) throw new TypeError(`summary has unknown dimension '${key}'`);
  }
  const effects = new Map();
  const source = input.effects instanceof Map ? [...input.effects.entries()] : Object.entries(input.effects || {});
  for (const [key, value] of source) {
    if (typeof key !== "string" || !EFFECT_KEY.test(key)) throw new TypeError(`effect key '${key}' is invalid`);
    const count = exactCount(value, `effects.${key}`);
    if (count !== 0n) effects.set(key, count);
  }
  return freezeSummary(
    exactCount(input.steps === undefined ? 0n : input.steps, "steps"),
    exactCount(input.calls === undefined ? 0n : input.calls, "calls"),
    exactCount(input.iterations === undefined ? 0n : input.iterations, "iterations"),
    effects
  );
}

const ZERO = summary();

function canonicalSummary(value) {
  const effects = {};
  for (const key of [...value.effects.keys()].sort()) effects[key] = value.effects.get(key).toString();
  return { calls: value.calls.toString(), effects, iterations: value.iterations.toString(), steps: value.steps.toString() };
}

function summaryExceeds(value) {
  if (value.steps > WB_MAX || value.calls > WB_MAX || value.iterations > WB_MAX) return true;
  for (const count of value.effects.values()) if (count > WB_MAX) return true;
  return false;
}

function addValues(left, right) {
  const effects = new Map(left.effects);
  for (const [key, count] of right.effects) effects.set(key, (effects.get(key) || 0n) + count);
  return freezeSummary(left.steps + right.steps, left.calls + right.calls, left.iterations + right.iterations, effects);
}

function scaleValue(count, value) {
  if (count === 0n) return ZERO; // R-WB-2b: 0 ⊗ ok(S) = ok(0), empty effects
  const effects = new Map();
  for (const [key, item] of value.effects) effects.set(key, item * count);
  return freezeSummary(value.steps * count, value.calls * count, value.iterations * count, effects);
}

function maxValues(values) {
  let steps = 0n;
  let calls = 0n;
  let iterations = 0n;
  const effects = new Map();
  for (const value of values) {
    if (value.steps > steps) steps = value.steps;
    if (value.calls > calls) calls = value.calls;
    if (value.iterations > iterations) iterations = value.iterations;
    for (const [key, count] of value.effects) if (count > (effects.get(key) || 0n)) effects.set(key, count);
  }
  return freezeSummary(steps, calls, iterations, effects);
}

// ---------------------------------------------------------------------------
// Canonical composition tree (R-WB-2, R-WB-2a). One node per CT-1 row
// instance; multi-operator rows are split into their stated sub-nodes; a
// statement sequence is a left-nested chain of binary ⊕ nodes. Each node keeps
// the source position of the statement or function that introduces it.

function position(loc) {
  if (!loc) return null;
  const out = {};
  if (loc.file !== undefined) out.file = String(loc.file);
  out.line = Number.isSafeInteger(loc.line) ? loc.line : 0;
  out.column = Number.isSafeInteger(loc.column) ? loc.column : 0;
  return Object.freeze(out);
}

function node(op, loc, fields, children = []) {
  return Object.freeze({ ...fields, children: Object.freeze(children), loc: position(loc), op });
}

function lit(value, loc) {
  return node("lit", loc, { value: value && Object.isFrozen(value) && value.effects instanceof Map ? value : summary(value) });
}

function failLeaf(reason, loc, detail) {
  if (!["unknown_bound", "invalid_bound", "missing_summary"].includes(reason)) {
    throw new TypeError(`a leaf failure is unknown_bound, invalid_bound or missing_summary, not '${reason}'`);
  }
  return node("fail", loc, { detail: detail || reason, reason });
}

function row(construct, loc, params = {}) {
  return node("row", loc, { arms: params.arms, cases: params.cases, construct, key: params.key });
}

function add(left, right, loc) {
  return node("add", loc === undefined ? right.loc : loc, {}, [left, right]);
}

function empty(loc) {
  return node("empty", loc, {});
}

function seq(nodes, loc) {
  if (!Array.isArray(nodes)) throw new TypeError("seq expects an array of nodes");
  if (!nodes.length) return empty(loc);
  let out = nodes[0];
  for (let index = 1; index < nodes.length; index += 1) out = add(out, nodes[index], nodes[index].loc);
  return out;
}

function max(children, loc) {
  if (!Array.isArray(children) || !children.length) throw new TypeError("max expects at least one alternative");
  return node("max", loc, {}, children);
}

function summaryOf(callee, loc) {
  if (typeof callee !== "string" || !callee) throw new TypeError("callee name is required");
  return node("summary_of", loc, { callee });
}

// CT-1 local call: c1 = aggregate argument copies (empty: no aggregate is
// admitted), c2 = c1 ⊕ (steps 1, calls 1), c3 = c2 ⊕ B(f).
function call(callee, loc) {
  return add(row("call", loc), summaryOf(callee, loc), loc);
}

function loopCount(count, loc) {
  if (count && typeof count === "object" && count.unknown === true && Object.keys(count).length === 1) {
    return node("count", loc, { count: null, unknown: true });
  }
  if (typeof count === "bigint" || typeof count === "string") return node("count", loc, { count, unknown: false });
  throw new TypeError("loop count must be a BigInt, a decimal literal string or { unknown: true }");
}

// CT-1 bounded loop: t1 = (steps 1, iterations 1) ⊕ Bd; t2 = n ⊗ t1;
// t3 = (steps 1 + L_T) ⊕ t2. The body t1 is evaluated before the count leaf
// (innermost first; the callback precedes the count in `loop.fold @cb, %seed, n`).
function loop(count, body, loc) {
  const t1 = add(row("loop.iteration", loc), body, loc);
  const t2 = node("mul", loc, {}, [t1, loopCount(count, loc)]);
  return add(row("loop.exit", loc), t2, loc);
}

function branch(thenNode, elseNode, loc) {
  return add(row("branch", loc), max([thenNode, elseNode], loc), loc);
}

function match(arms, loc) {
  return add(row("match", loc, { arms: arms.length }), max(arms, loc), loc);
}

function extern(key, loc) {
  if (typeof key !== "string" || !EFFECT_KEY.test(key)) throw new TypeError(`effect key '${key}' is invalid`);
  return row("extern.call", loc, { key });
}

function atomArm(loc) {
  return row("match.atom_arm", loc);
}

// ---------------------------------------------------------------------------
// Entry ingress (CT-1 last row). Types: { kind: "i32"|"i64"|"f32"|"f64"|
// "bool"|"refined_i32" } | { kind: "enum", cases } | { kind: "option",
// payload } | { kind: "result", payload, error }.

function ingressOf(type, loc) {
  const stack = [{ type, phase: 0 }];
  const results = [];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const item = frame.type;
    if (!item || typeof item !== "object" || typeof item.kind !== "string") costUndefined("ingress.<invalid>", loc);
    const rowFor = ctRow(`ingress.${item.kind}`, loc);
    if (item.kind === "option" || item.kind === "result") {
      const parts = item.kind === "option" ? [item.payload] : [item.payload, item.error];
      if (frame.phase < parts.length) {
        stack.push({ type: parts[frame.phase], phase: 0 });
        frame.phase += 1;
        continue;
      }
      const values = results.splice(results.length - parts.length, parts.length);
      const inner = values.reduce((best, value) => (value > best ? value : best), 0n);
      results.push(rowFor.steps + inner);
    } else if (item.kind === "enum") {
      if (rowFor.stepsPerCase === null) costUndefined("ingress.enum.cases", loc);
      results.push(rowFor.steps + rowFor.stepsPerCase * exactCount(item.cases, "enum cases"));
    } else {
      results.push(rowFor.steps);
    }
    stack.pop();
  }
  return results[0];
}

function entryNode(params, body, loc) {
  if (!Array.isArray(params)) throw new TypeError("entry parameters must be an array");
  // E(f) = ingress(f) ⊕ B(f), evaluated as one checked node.
  return add(node("ingress", loc, { params: Object.freeze(params.slice()) }), body, loc);
}

// ---------------------------------------------------------------------------
// Evaluation: explicit post-order stack, never host recursion (R-WB-15b).
// Strictness first, then the checked operation (R-WB-2). Failures produced by
// a node are root failures; inherited ones carry a cause (R-WB-2f).

function rootFailure(context, reason, loc, detail) {
  const failure = Object.freeze({
    cause: null,
    code: FAILURE_CODES[reason],
    detail,
    function: context.functionName,
    loc: loc || context.functionLoc,
    module: context.moduleId,
    order: context.rootCounter.next++,
    reason,
    root: true
  });
  context.roots.push(failure);
  return Object.freeze({ failure, ok: false });
}

function propagated(context, child, loc) {
  const cause = child.failure.root ? child.failure : child.failure.cause;
  return Object.freeze({
    failure: Object.freeze({
      cause,
      code: cause.code,
      detail: cause.detail,
      function: context.functionName,
      loc: loc || context.functionLoc,
      module: context.moduleId,
      reason: cause.reason,
      root: false
    }),
    ok: false
  });
}

function okResult(value) {
  return Object.freeze({ ok: true, value });
}

function checked(context, value, loc, detail) {
  return summaryExceeds(value) ? rootFailure(context, "overflow", loc, detail) : okResult(value);
}

function rowValue(item) {
  const weights = ctRow(item.construct, item.loc);
  let steps = weights.steps;
  if (item.arms !== undefined) {
    if (weights.stepsPerArm === null) costUndefined(`${item.construct}.arms`, item.loc);
    steps += weights.stepsPerArm * exactCount(BigInt(item.arms), "match arms");
  }
  const effects = new Map();
  if (item.key !== undefined) {
    if (weights.effectPerKey === null) costUndefined(`${item.construct}.effects`, item.loc);
    if (weights.effectPerKey !== 0n) effects.set(item.key, weights.effectPerKey);
  }
  return freezeSummary(steps, weights.calls, weights.iterations, effects);
}

function countValue(context, item) {
  if (item.unknown) return rootFailure(context, "unknown_bound", item.loc, "loop count has no proven maximum");
  const text = typeof item.count === "bigint" ? item.count.toString() : item.count;
  if (!/^-?(0|[1-9][0-9]*)$/.test(text)) return rootFailure(context, "invalid_bound", item.loc, `loop count '${text}' is not an integer literal`);
  const count = BigInt(text);
  if (count < 0n) return rootFailure(context, "invalid_bound", item.loc, `loop count ${text} is negative`);
  if (count > LOOP_MAX) return rootFailure(context, "invalid_bound", item.loc, `loop count ${text} exceeds LOOP_MAX ${LOOP_MAX}`);
  return Object.freeze({ count, ok: true });
}

function evaluateNode(context, item, children) {
  context.stats.nodes += 1;
  switch (item.op) {
    case "lit":
      return checked(context, item.value, item.loc, "literal summary exceeds WB_MAX");
    case "empty":
      return okResult(ZERO);
    case "fail":
      return rootFailure(context, item.reason, item.loc, item.detail);
    case "row":
      return checked(context, rowValue(item), item.loc, `CT-1 row ${item.construct} exceeds WB_MAX`);
    case "ingress": {
      let steps = 0n;
      for (const param of item.params) steps += ingressOf(param, item.loc);
      // Exact, unchecked here: the enclosing entry node is the one checked node.
      return okResult(freezeSummary(steps, 0n, 0n, new Map()));
    }
    case "count":
      return countValue(context, item);
    case "summary_of": {
      const callee = context.summaries.get(item.callee);
      if (!callee) return rootFailure(context, "missing_summary", item.loc, `call target '@${item.callee}' has no summary in the closure`);
      if (!callee.ok) return propagated(context, callee, item.loc);
      return okResult(callee.value);
    }
    default:
      break;
  }
  for (const child of children) if (!child.ok) return propagated(context, child, item.loc);
  if (item.op === "add") {
    return checked(context, addValues(children[0].value, children[1].value), item.loc, "a dimension exceeds WB_MAX at a ⊕ node");
  }
  if (item.op === "mul") {
    return checked(context, scaleValue(children[1].count, children[0].value), item.loc, "a dimension exceeds WB_MAX at a ⊗ node");
  }
  if (item.op === "max") return okResult(maxValues(children.map((child) => child.value)));
  return costUndefined(`node.${item.op}`, item.loc);
}

function evaluateTree(root, context) {
  const stack = [{ item: root, next: 0, values: [] }];
  let result = null;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const children = frame.item && Array.isArray(frame.item.children) ? frame.item.children : null;
    if (!children) costUndefined("node.<invalid>", frame.item && frame.item.loc);
    if (frame.next < children.length) {
      stack.push({ item: children[frame.next], next: 0, values: [] });
      frame.next += 1;
      continue;
    }
    stack.pop();
    const value = evaluateNode(context, frame.item, frame.values);
    if (stack.length) stack[stack.length - 1].values.push(value);
    else result = value;
  }
  return result;
}

function newContext(moduleId, summaries) {
  return {
    functionLoc: null,
    functionName: null,
    moduleId,
    rootCounter: { next: 0 },
    roots: [],
    stats: { entrySummaries: 0, functionSummaries: 0, nodes: 0 },
    summaries
  };
}

// Evaluates one tree against given callee summaries (harness helper for the
// MODEL vectors). Callee summaries are ok(S) values built with summary().
function evaluate(root, options = {}) {
  const summaries = new Map();
  for (const [name, value] of Object.entries(options.summaries || {})) summaries.set(name, okResult(summary(value)));
  const context = newContext(options.module || "v53.model", summaries);
  context.functionName = options.function || null;
  const result = evaluateTree(root, context);
  return Object.freeze({ result, roots: Object.freeze(context.roots.slice()), stats: Object.freeze({ ...context.stats }) });
}

// ---------------------------------------------------------------------------
// Module analysis: call-graph phase first (R-WB-2f.1), then one memoised
// summary per function in reverse topological order (R-WB-14), then entry
// summaries for exported functions, then the module report (R-WB-2f.4).

function calleesOf(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const item = stack.pop();
    if (item.op === "summary_of") out.push({ loc: item.loc, to: item.callee });
    for (let index = item.children.length - 1; index >= 0; index -= 1) stack.push(item.children[index]);
  }
  return out;
}

function stronglyConnected(names, edges) {
  // Iterative Tarjan: components come out callees-first (reverse topological).
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;
  for (const start of names) {
    if (index.has(start)) continue;
    const work = [{ name: start, next: 0 }];
    index.set(start, counter); low.set(start, counter); counter += 1;
    stack.push(start); onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const targets = edges.get(frame.name);
      if (frame.next < targets.length) {
        const to = targets[frame.next].to;
        frame.next += 1;
        if (!edges.has(to)) continue;
        if (!index.has(to)) {
          index.set(to, counter); low.set(to, counter); counter += 1;
          stack.push(to); onStack.add(to);
          work.push({ name: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.name, Math.min(low.get(frame.name), index.get(to)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].name;
        low.set(parent, Math.min(low.get(parent), low.get(frame.name)));
      }
      if (low.get(frame.name) === index.get(frame.name)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.name);
        components.push(component);
      }
    }
  }
  return components;
}

function cycleOf(component, order, edges) {
  const members = new Set(component);
  const start = component.slice().sort((a, b) => order.get(a) - order.get(b))[0];
  const visited = new Set([start]);
  const frames = [{ edge: null, name: start, next: 0 }];
  while (frames.length) {
    const frame = frames[frames.length - 1];
    const targets = edges.get(frame.name);
    if (frame.next >= targets.length) { frames.pop(); continue; }
    const edge = targets[frame.next];
    frame.next += 1;
    if (!members.has(edge.to)) continue;
    if (edge.to === start) {
      const names = frames.map((item) => item.name).concat(start);
      const firstEdge = frames.length > 1 ? frames[1].edge : edge;
      return { functions: names, loc: firstEdge.loc, start };
    }
    if (visited.has(edge.to)) continue;
    visited.add(edge.to);
    frames.push({ edge, name: edge.to, next: 0 });
  }
  throw new Error("strongly connected component without a cycle");
}

function compareRoots(left, right) {
  if (left.module !== right.module) return left.module < right.module ? -1 : 1;
  const a = left.loc || { column: 0, line: 0 };
  const b = right.loc || { column: 0, line: 0 };
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  return left.order - right.order;
}

function validateModel(model) {
  if (!model || typeof model !== "object" || !Array.isArray(model.functions)) throw new TypeError("WorkBound model must list functions");
  const moduleId = model.module === undefined ? "v53.model" : model.module;
  if (typeof moduleId !== "string" || !MODULE_ID.test(moduleId)) throw new TypeError("WorkBound model module identity is invalid");
  const seen = new Set();
  for (const fn of model.functions) {
    if (!fn || typeof fn.name !== "string" || !fn.name || seen.has(fn.name)) throw new TypeError("WorkBound model function names must be unique");
    if (!fn.body || typeof fn.body.op !== "string") throw new TypeError(`function '${fn.name}' has no composition tree`);
    if (fn.exported && !Array.isArray(fn.params)) throw new TypeError(`exported function '${fn.name}' must list its ingress types`);
    seen.add(fn.name);
  }
  return moduleId;
}

function analyzeModel(model) {
  const moduleId = validateModel(model);
  const functions = model.functions;
  const order = new Map(functions.map((fn, index) => [fn.name, index]));
  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  const edges = new Map(functions.map((fn) => [fn.name, calleesOf(fn.body).filter((edge) => byName.has(edge.to))]));
  const components = stronglyConnected(functions.map((fn) => fn.name), edges);

  // R-WB-2f.1: any call-graph cycle (call or loop-callback edge, including
  // edges behind statically false branches) rejects the module before any
  // summary is computed. Every cyclic component is reported once, with the
  // first cycle found from its first function in source order.
  const cycles = components
    .filter((component) => component.length > 1 || edges.get(component[0]).some((edge) => edge.to === component[0]))
    .map((component) => cycleOf(component, order, edges))
    .sort((a, b) => order.get(a.start) - order.get(b.start))
    .map((cycle) => Object.freeze({
      code: FAILURE_CODES.recursion,
      cyclePath: cycle.functions.map((name) => `@${name}`).join(" -> "),
      functions: Object.freeze(cycle.functions.slice()),
      loc: cycle.loc,
      module: moduleId,
      reason: "recursion",
      root: true
    }));
  if (cycles.length) {
    return Object.freeze({
      cycles: Object.freeze(cycles),
      entries: new Map(),
      functions: new Map(),
      module: moduleId,
      primary: cycles[0],
      roots: Object.freeze(cycles.slice()),
      stats: Object.freeze({ entrySummaries: 0, functionSummaries: 0, nodes: 0 }),
      status: "rejected"
    });
  }

  const summaries = new Map();
  const context = newContext(moduleId, summaries);
  for (const component of components) {
    const fn = byName.get(component[0]);
    context.functionName = fn.name;
    context.functionLoc = position(fn.loc);
    summaries.set(fn.name, evaluateTree(fn.body, context));
    context.stats.functionSummaries += 1;
  }
  const entries = new Map();
  for (const fn of functions) {
    if (!fn.exported) continue;
    context.functionName = fn.name;
    context.functionLoc = position(fn.loc);
    const bodyNode = node("summary_of", fn.loc, { callee: fn.name });
    entries.set(fn.name, evaluateTree(entryNode(fn.params, bodyNode, fn.loc), context));
    context.stats.entrySummaries += 1;
  }
  const roots = context.roots.slice().sort(compareRoots);
  const bodies = new Map(functions.map((fn) => [fn.name, summaries.get(fn.name)]));
  return Object.freeze({
    cycles: Object.freeze([]),
    entries,
    functions: bodies,
    module: moduleId,
    primary: roots.length ? roots[0] : null,
    roots: Object.freeze(roots),
    stats: Object.freeze({ ...context.stats }),
    status: roots.length ? "rejected" : "ok"
  });
}

function analysisError(analysis) {
  const primary = analysis.primary;
  if (!primary) return null;
  if (primary.reason === "recursion") {
    return new WorkBoundError(primary.code, `local function call cycle ${primary.cyclePath}`, primary.loc, {
      cyclePath: primary.cyclePath,
      cycles: analysis.cycles.map((cycle) => cycle.cyclePath)
    });
  }
  return new WorkBoundError(primary.code, `${primary.detail} (function '${primary.function}')`, primary.loc, {
    function: primary.function,
    reason: primary.reason,
    rootFailures: analysis.roots.length
  });
}

// ---------------------------------------------------------------------------
// typed-v0.51 ASTs (RFC §6.12): straight-line functions with `local`, `match`
// and `return` statements. Each statement is one CT-1 statement row chosen by
// its form; atoms used as operands (literals, enum constants, constructor
// atoms, references) add no row of their own; a value that enters a refined
// type from another type adds one `refinement.check` row.

function refinementOf(typeName, loc) {
  try { return parseRefinementType(typeName, loc); } catch (_) { return costUndefined(`type '${typeName}'`, loc); }
}

function typedTypeInfo(typeName, declarations, loc) {
  const refinement = refinementOf(typeName, loc);
  if (refinement) {
    if (refinement.base !== "i32") costUndefined(`ingress.refined_${refinement.base}`, loc);
    return { kind: "refined_i32" };
  }
  let reference;
  try { reference = parseTypeReference(typeName); } catch (_) { costUndefined(`type '${typeName}'`, loc); }
  const resolve = (item) => {
    if (item.kind === "primitive") return { kind: item.canonical };
    if (item.kind === "enum") {
      const declaration = declarations.get(item.canonical);
      if (!declaration || !Array.isArray(declaration.cases)) costUndefined(`enum '${item.canonical}'`, loc);
      return { cases: BigInt(declaration.cases.length), kind: "enum" };
    }
    if (item.kind === "option") return { kind: "option", payload: resolve(item.payload) };
    if (item.kind === "result") return { error: resolve(item.error), kind: "result", payload: resolve(item.payload) };
    return costUndefined(`type '${item.canonical}'`, loc);
  };
  return resolve(reference);
}

function isRefinedType(typeName, loc) {
  return Boolean(refinementOf(typeName, loc));
}

function isLocalReference(value) {
  return typeof value === "string" && LOCAL_REFERENCE.test(value.trim());
}

function isConstructorAtom(value) {
  return typeof value === "string" && CONSTRUCTOR_ATOM.test(value.trim());
}

function withRefinementCheck(base, destinationType, value, loc) {
  // The verifier admits a local reference into a refined type only when the
  // types are identical, so only literals and operation results enter one.
  if (!isRefinedType(destinationType, loc) || isLocalReference(value)) return base;
  return add(base, row("refinement.check", loc), loc);
}

function typedStatementNode(fn, statement) {
  const loc = statement && statement.loc;
  if (!statement || typeof statement !== "object") costUndefined("statement.<invalid>", fn.loc);
  if (statement.kind === "local") {
    const construct = isConstructorAtom(statement.value) ? "statement.constructor" : "statement.scalar";
    return withRefinementCheck(row(construct, loc), statement.type, statement.value, loc);
  }
  if (statement.kind === "match") {
    if (!Array.isArray(statement.arms) || !statement.arms.length) costUndefined("match.<no arms>", loc);
    const arms = statement.arms.map((arm) => withRefinementCheck(atomArm(arm.loc || loc), statement.destinationType, arm.expression, arm.loc || loc));
    return match(arms, loc);
  }
  if (statement.kind === "return") {
    return withRefinementCheck(row("return", loc), fn.returnType, statement.value, loc);
  }
  return costUndefined(`statement.${statement.kind}`, loc);
}

function typedV051Model(mod) {
  if (!mod || !mod.v051TypedAst || !Array.isArray(mod.functions)) {
    throw new TypeError("WorkBound summaries need a verified typed-v0.51 AST");
  }
  const declarations = new Map((mod.enums || []).map((item) => [item.type_id, item]));
  const moduleId = typeof mod.name === "string" && MODULE_ID.test(mod.name) ? mod.name : "v53.model";
  return {
    functions: mod.functions.map((fn) => ({
      body: seq((fn.statements || []).map((statement) => typedStatementNode(fn, statement)), fn.loc),
      exported: fn.exported === true,
      loc: fn.loc,
      name: fn.name,
      params: (fn.params || []).map((parameter) => typedTypeInfo(parameter.type, declarations, fn.loc))
    })),
    module: moduleId
  };
}

// Summaries of a verified typed-v0.51 module: B(f) for every function
// (R-WB-11) and E(f) for every export. The caller has already verified `mod`.
function analyzeVerifiedTypedModule(mod) {
  return analyzeModel(typedV051Model(mod));
}

// ---------------------------------------------------------------------------
// Identity binding (R-WB-18..21, R-WB-27a). WorkBoundKeyV1 and the summary
// record; the record digest is domain-separated and never the undomained
// artifactDigest of v0.52 (R-WB-19).

function workBoundKey(input) {
  if (!input || typeof input !== "object") throw new TypeError("WorkBound key input must be an object");
  const key = {
    body_digest: input.bodyDigest,
    compiler_implementation_digest: input.compilerImplementationDigest,
    cost_table: input.costTable === undefined ? COST_TABLE_ID : input.costTable,
    cost_table_digest: input.costTableDigest === undefined ? COST_TABLE_DIGEST : input.costTableDigest,
    dependencies: (input.dependencies || []).map((item) => ({ ...item })),
    profile: input.profile
  };
  validateKey(key);
  return deepFreeze(key);
}

function validateKey(key) {
  if (!key || typeof key !== "object" || Array.isArray(key) || Object.keys(key).sort().join(",") !== KEY_FIELDS.join(",")) {
    throw new TypeError("WorkBoundKeyV1 has missing or unknown fields");
  }
  for (const field of ["body_digest", "compiler_implementation_digest", "cost_table_digest"]) {
    if (typeof key[field] !== "string" || !DIGEST.test(key[field])) throw new TypeError(`WorkBoundKeyV1.${field} must be a sha256 digest`);
  }
  if (typeof key.cost_table !== "string" || !/^air\.workbound\.cost\/[1-9][0-9]*$/.test(key.cost_table)) {
    throw new TypeError("WorkBoundKeyV1.cost_table is invalid");
  }
  if (typeof key.profile !== "string" || !PROFILE_ID.test(key.profile)) throw new TypeError("WorkBoundKeyV1.profile is invalid");
  if (!Array.isArray(key.dependencies)) throw new TypeError("WorkBoundKeyV1.dependencies must be an array");
  let previous = null;
  for (const item of key.dependencies) {
    if (!item || typeof item !== "object" || Object.keys(item).sort().join(",") !== "body_digest,module,summary_digest" ||
        typeof item.module !== "string" || !MODULE_ID.test(item.module) ||
        !DIGEST.test(String(item.body_digest)) || !DIGEST.test(String(item.summary_digest))) {
      throw new TypeError("WorkBoundKeyV1.dependencies entry is invalid");
    }
    if (previous !== null && !(previous < item.module)) throw new TypeError("WorkBoundKeyV1.dependencies must be ordered ASCII by module identity");
    previous = item.module;
  }
}

function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).sort().join(",") !== RECORD_FIELDS.join(",")) {
    throw new TypeError("WorkBound summary record has missing or unknown fields");
  }
  if (record.schema !== SUMMARY_SCHEMA) throw new TypeError("WorkBound summary record schema is invalid");
  validateKey(record.key);
  if (!record.entries || typeof record.entries !== "object" || Array.isArray(record.entries)) {
    throw new TypeError("WorkBound summary record entries must be an object");
  }
  for (const [name, value] of Object.entries(record.entries)) {
    if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== SUMMARY_FIELDS.join(",")) {
      throw new TypeError(`WorkBound entry '${name}' has missing or unknown dimensions`);
    }
    for (const field of ADDITIVE) {
      if (typeof value[field] !== "string" || !DECIMAL.test(value[field]) || BigInt(value[field]) > WB_MAX) {
        throw new TypeError(`WorkBound entry '${name}'.${field} is not a canonical decimal within WB_MAX`);
      }
    }
    if (!value.effects || typeof value.effects !== "object" || Array.isArray(value.effects)) {
      throw new TypeError(`WorkBound entry '${name}'.effects must be an object`);
    }
    for (const [key, count] of Object.entries(value.effects)) {
      if (!EFFECT_KEY.test(key) || typeof count !== "string" || !DECIMAL.test(count) || count === "0" || BigInt(count) > WB_MAX) {
        throw new TypeError(`WorkBound entry '${name}'.effects.${key} is invalid`);
      }
    }
  }
}

function recordBytes(record) {
  validateRecord(record);
  return canonical(record);
}

function recordDigest(record) {
  return domainDigest(SUMMARY_DOMAIN, recordBytes(record));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

// R-WB-20: binds the summaries of a verified build only to existing
// identities (sourceProfile, sourceDigest, compiler.implementationDigest) plus
// the cost-table id and content digest. No public schema.
function bindVerifiedTypedWorkBound(analysis, identity) {
  if (!analysis || analysis.status !== "ok") throw new TypeError("only a fully summarised module can be bound");
  const key = workBoundKey({
    bodyDigest: identity.sourceDigest,
    compilerImplementationDigest: identity.compilerImplementationDigest,
    profile: identity.sourceProfile
  });
  const entries = {};
  for (const name of [...analysis.entries.keys()].sort()) entries[name] = canonicalSummary(analysis.entries.get(name).value);
  const record = deepFreeze({ entries, key, schema: SUMMARY_SCHEMA });
  const bytes = recordBytes(record);
  const functions = {};
  for (const name of [...analysis.functions.keys()].sort()) functions[name] = canonicalSummary(analysis.functions.get(name).value);
  return deepFreeze({
    functions,
    key,
    record,
    recordBytes: bytes,
    recordDigest: domainDigest(SUMMARY_DOMAIN, bytes),
    stats: { ...analysis.stats }
  });
}

// R-WB-21: a supplied summary or record is never an input. It is compared for
// equality with the recomputed one; a mismatch fails, and the derived value is
// what remains bound either way.
function compareSuppliedRecord(binding, supplied) {
  let bytes = null;
  try { bytes = recordBytes(supplied); } catch (_) { bytes = null; }
  if (bytes !== binding.recordBytes) {
    throw new WorkBoundError(IDENTITY_MISMATCH_CODE, "supplied WorkBound record does not match the recomputed summary record", null, {
      derivedRecordDigest: binding.recordDigest
    });
  }
  return binding;
}

function compareSuppliedEntry(binding, entryName, supplied) {
  const derived = binding.record.entries[entryName];
  let text = null;
  try { text = canonical(canonicalSummary(summary(supplied))); } catch (_) { text = null; }
  if (!derived || text !== canonical(derived)) {
    throw new WorkBoundError(IDENTITY_MISMATCH_CODE, `supplied summary for '${entryName}' does not match the recomputed entry summary`, null, {
      entry: entryName
    });
  }
  return binding;
}

// Read-only inspection of the private build binding. The authority copy stays
// in the private build state of v052_verified_build.js, which registers the
// reader; nothing here can write or replace a binding.
const bindingReaders = [];
function registerBindingReader(reader) {
  if (typeof reader !== "function") throw new TypeError("binding reader must be a function");
  bindingReaders.push(reader);
}
function inspectBoundWorkBound(target) {
  for (const reader of bindingReaders) {
    const binding = reader(target);
    if (binding) return binding;
  }
  return null;
}

module.exports = {
  COST_TABLE_DIGEST,
  COST_TABLE_DOMAIN,
  COST_TABLE_FILE,
  COST_TABLE_FILE_SHA256,
  COST_TABLE_ID,
  COST_UNDEFINED_CODE,
  FAILURE_CODES,
  FAILURE_REASONS,
  IDENTITY_MISMATCH_CODE,
  KEY_FIELDS,
  LOOP_MAX,
  RECORD_FIELDS,
  SUMMARY_DOMAIN,
  SUMMARY_FIELDS,
  SUMMARY_SCHEMA,
  WB_MAX,
  WorkBoundError,
  analysisError,
  analyzeModel,
  analyzeVerifiedTypedModule,
  bindVerifiedTypedWorkBound,
  canonicalSummary,
  compareSuppliedEntry,
  compareSuppliedRecord,
  costTableDigest,
  evaluate,
  inspectBoundWorkBound,
  recordBytes,
  recordDigest,
  registerBindingReader,
  summary,
  tree: Object.freeze({ add, atomArm, branch, call, empty, entry: entryNode, extern, failLeaf, lit, loop, match, max, row, seq, summaryOf }),
  typedV051Model,
  workBoundKey
};
