"use strict";

// typed-v0.53 P0-11: M(), the deterministic legacy-v0.50 -> typed-v0.53
// migration, first increment I1 (slice text R2.3; card AIR-0053-P0-11-0001;
// docs/v0.53/MIGRATION.md). M() is a tool: it reads the legacy parser and
// verifier and the typed-v0.53 parser, verifier and formatter, and changes no
// profile's result (P11-R26). A record holds no host path, no clock and no
// locale: outputs and records are a pure function of the input's bytes, the
// bytes of what it imports and the options (P11-R1).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { applyUseBundles } = require("./bundles");
const { resolveSourceImports } = require("./imports");
const { parseAir, parseV051TypedAir } = require("./parser");
const { formatSource, parseSource, verifySource } = require("./source_profile");

const CODE = "air.migration.unsupported_construct";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: "typed-v0.53" });
const TYPED_MODULE_ID = /^[a-z][a-z0-9._-]{0,127}$/;
const SEMANTIC_CODE = /^(air\.[a-z0-9_]+(?:\.[a-z0-9_]+)*):(?:\s|$)/u;
const UNRESOLVED_IMPORT = /^(AIR import '.*' not found at )(.*)$/;
const LOOP_MAX = 4096n;
const I32_MIN = -2147483648n;
const I32_MAX = 2147483647n;

// P11-R24: rc:check refuses these spellings in a scanned file, in any case, so
// the names are built.
const TABLE_GROUPS = ["table", "Groups"].join("");
const TABLE_GROUP_FAMILY = ["table", "group."].join("");
const SHARED_RECORD_FAMILY = ["po", "ol."].join("");

const CLASS_ORDER = Object.freeze(["EXACT", "EXACT_ON_SUCCESS", "LEGACY_DEFECT_CORRECTED"]);

// P11-R8: a parameter or result type I1 maps.
const SCALAR_TYPES = new Set(["i32", "i64", "f32", "f64", "bool"]);
const GEOMETRY_TYPES = new Set(["vec3", "mat4", "quat"]);

// P11-R9: each operation with a new name, and its class.
const RENAMED_OPS = new Map([
  ["i32.add", ["i32.wrapping_add", "EXACT"]],
  ["i32.sub", ["i32.wrapping_sub", "EXACT"]],
  ["i32.mul", ["i32.wrapping_mul", "EXACT"]],
  ["i32.div_s", ["i32.checked_div_s", "EXACT_ON_SUCCESS"]],
  ["i32.rem_s", ["i32.checked_rem_s", "EXACT_ON_SUCCESS"]],
  ["i32.trunc_f32_s", ["f32.trunc_to_i32_checked", "EXACT_ON_SUCCESS"]]
]);
const SAME_NAME_OPS = new Set(["i32.and", "i32.or", "i32.xor", "i32.shl", "i32.shr_u", "i32.eq", "i32.ne", "i32.lt_s", "i32.le_s", "i32.gt_s",
  "i32.ge_s", "f32.add", "f32.sub", "f32.mul", "f32.div", "f32.min", "f32.max", "f32.eq", "f32.ne", "f32.lt", "f32.le", "f32.gt", "f32.ge",
  "bool.and", "bool.or", "bool.not", "select.i32", "select.f32", "select.bool"]);

// P11-R9 and G-4: the baseline lowering's operations in its order. A step is
// [result slot, op, operands]; a literal step is [result slot, literal]. Slot 0
// is the legacy result; slot k > 0 is the k-th fresh name (P11-R11). An operand
// is a legacy argument's index, or { slot }.
const HELPERS = new Map([
  ["f32.clamp", [[1, "f32.max", [0, 1]], [0, "f32.min", [{ slot: 1 }, 2]]]],
  ["f32.lerp", [[1, "f32.sub", [1, 0]], [2, "f32.mul", [{ slot: 1 }, 2]], [0, "f32.add", [{ slot: 2 }, 0]]]],
  ["f32.inverse_lerp", [[1, "f32.sub", [2, 0]], [2, "f32.sub", [1, 0]], [0, "f32.div", [{ slot: 1 }, { slot: 2 }]]]],
  ["ease.out_quad", [[1, "1.0"], [2, "f32.sub", [{ slot: 1 }, 0]], [3, "f32.mul", [{ slot: 2 }, { slot: 2 }]], [0, "f32.sub", [{ slot: 1 }, { slot: 3 }]]]],
  ["ease.smoothstep", [[1, "f32.mul", [0, 0]], [2, "2.0"], [3, "f32.mul", [{ slot: 2 }, 0]], [4, "3.0"], [5, "f32.sub", [{ slot: 4 }, { slot: 3 }]],
    [0, "f32.mul", [{ slot: 1 }, { slot: 5 }]]]]
]);

// P11-R14: never admitted in typed-v0.53.
const NEVER_OPS = new Set(["f32.sin", "f32.cos", "f32.sqrt", "f32.convert_i32_s", "print", "io.poll_bounded", "loop.poll", "table.get.u8", "table.get.u16",
  "table.get.i16"]);
const NEVER_OP_FAMILIES = Object.freeze(["vec3.", "mat4.", "quat.", "physics.", "collision.", "ray.", "fixed.", "state.", SHARED_RECORD_FAMILY, TABLE_GROUP_FAMILY]);
const NEVER_FORMS = Object.freeze(["globals", "states", "pools", "flowDeclarations", TABLE_GROUPS]);
const LATER_FORMS = Object.freeze(["constants", "structs", "externs", "effects", "requires", "ensures"]);
const COMPACT_TABLE_TYPES = new Set(["u8", "u16", "i16"]);

const LITERAL_OPS = new Map([["const.i32", "i32"], ["const.i64", "i64"], ["const.f32", "f32"], ["const.f64", "f64"], ["const.bool", "bool"]]);

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// The legacy parser's comment rule: `#` outside a string.
function withoutComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    if (inString && line[i] === "\\") i += 1;
    else if (line[i] === '"') inString = !inString;
    else if (line[i] === "#" && !inString) return line.slice(0, i).trim();
  }
  return line.trim();
}

// P11-R3: sorted keys, no whitespace, UTF-8, one final LF.
function canonicalRecord(record) {
  const sorted = (value) => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
    return value;
  };
  return `${JSON.stringify(sorted(record))}\n`;
}

// ---------------------------------------------------------------------------
// Exact literal values (P11-R8). A decimal text is a rational; binary32 values
// are rounded here, because Math.fround(Number(text)) rounds twice.

function exactDecimal(text) {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match) return null;
  const digits = match[3] || "";
  const scale = Number(match[4] || 0) - digits.length;
  const magnitude = BigInt(`${match[2]}${digits}`);
  return {
    negative: match[1] === "-",
    numerator: scale >= 0 ? magnitude * 10n ** BigInt(scale) : magnitude,
    denominator: scale >= 0 ? 1n : 10n ** BigInt(-scale)
  };
}

function sameRational(left, right) {
  if (!left || !right) return false;
  if (left.numerator === 0n || right.numerator === 0n) return left.numerator === right.numerator;
  return left.negative === right.negative && left.numerator * right.denominator === right.numerator * left.denominator;
}

function exactInteger(text) {
  const exact = exactDecimal(text);
  if (!exact || exact.numerator % exact.denominator !== 0n) return null;
  const magnitude = exact.numerator / exact.denominator;
  return exact.negative ? -magnitude : magnitude;
}

// The binary32 value of a decimal text, correctly rounded (ties to even), as a
// key: two texts round to one value exactly when their keys are equal. The sign
// of zero is part of the value (P11-R17: every value but NaN, bit for bit).
function binary32Key(text) {
  const exact = exactDecimal(text);
  if (!exact) return null;
  const sign = exact.negative ? "-" : "+";
  const { numerator, denominator } = exact;
  if (numerator === 0n) return `${sign}0`;
  let log2 = numerator.toString(2).length - denominator.toString(2).length;
  const atLeast = log2 >= 0 ? numerator >= denominator << BigInt(log2) : numerator << BigInt(-log2) >= denominator;
  if (!atLeast) log2 -= 1;
  let unit = Math.max(log2 - 23, -149);
  const scaledNumerator = unit >= 0 ? numerator : numerator << BigInt(-unit);
  const scaledDenominator = unit >= 0 ? denominator << BigInt(unit) : denominator;
  let mantissa = scaledNumerator / scaledDenominator;
  const twiceRemainder = (scaledNumerator % scaledDenominator) * 2n;
  if (twiceRemainder > scaledDenominator || (twiceRemainder === scaledDenominator && (mantissa & 1n) === 1n)) mantissa += 1n;
  if (mantissa === 0n) return `${sign}0`;
  if (mantissa === 1n << 24n) {
    mantissa >>= 1n;
    unit += 1;
  }
  if (unit + 23 > 127) return `${sign}inf`;
  return `${sign}${mantissa}*2^${unit}`;
}

// P11-R8: inside X-SND-08's domain exactly when legacy's text (the text of the
// atom's Number, G-12) and the literal denote different values of the type.
function insideLiteralDefect(type, atom) {
  const legacyText = String(atom.value);
  if (type === "i32" || type === "i64") return !sameRational(exactDecimal(legacyText), exactDecimal(atom.raw));
  if (type === "f32") return binary32Key(legacyText) !== binary32Key(atom.raw);
  return !Object.is(Number(legacyText), Number(atom.raw));
}

// P11-R8: the typed literal of a legacy number atom.
function typedLiteral(type, raw) {
  if (type === "i32" || type === "i64") {
    const value = exactInteger(raw);
    return value === null ? raw : String(value);
  }
  return /^-?[0-9]+$/.test(raw) ? `${raw}.0` : raw;
}

// ---------------------------------------------------------------------------
// P11-R2 steps 1 to 4: what the text is, and what legacy says about it.

function isTypedSource(text, file) {
  try {
    parseV051TypedAir(text, file);
    return true;
  } catch (_) {
    // not typed-v0.51 source
  }
  try {
    parseSource(text, file, GATED);
    return true;
  } catch (_) {
    return false;
  }
}

// A Node I/O error says nothing about the program (P11-R2 step 4): no record.
function rethrowIoFailure(error) {
  if (error && error.syscall !== undefined) throw error;
}

// G-13: the parser resolves imports while it parses, so a refusal in an import
// leaves no list of what it read. This pass runs legacy's own resolver with an
// observing parse function, and gives the files read, each module's own AST (a
// merged function is not the input's own, P11-R5) and the `use` graph. Legacy's
// plain parse, run first, stays the authority on the verdict.
function observeLegacyImports(text, file) {
  const stdlibDir = path.resolve(__dirname, "..", "stdlib");
  const graph = { absolute: new Set(), file, nodes: new Map(), reads: new Set(), stdlibPrefix: `${stdlibDir}${path.sep}` };
  const observe = (source, nodeFile, options = {}) => {
    graph.reads.add(nodeFile);
    const ast = parseAir(source, nodeFile, { ...options, resolveSourceImports: false });
    // The bundles run once in legacy, after the merge (src/parser.js).
    const useLocs = new Set(ast.uses.map((use) => use.loc));
    const externs = ast.externs.filter((item) => !useLocs.has(item.loc));
    ast.externs = externs;
    const uses = ast.uses.map((use) => {
      if (use.kind !== "source") return { line: use.loc.line, name: use.name, target: null };
      const target = use.name.startsWith("std.")
        ? path.join(stdlibDir, `${use.name.slice("std.".length)}.air`)
        : path.resolve(path.dirname(nodeFile), use.name);
      if (!use.name.startsWith("std.") && (path.isAbsolute(use.name) || graph.absolute.has(nodeFile))) graph.absolute.add(target);
      return { line: use.loc.line, name: use.name, target };
    });
    graph.nodes.set(nodeFile, { ast, externs: externs.slice(), file: nodeFile, text: source, uses });
    return applyUseBundles(resolveSourceImports(ast, observe, { ...options, file: nodeFile }));
  };
  try {
    observe(text, file, {});
  } catch (error) {
    rethrowIoFailure(error);
    // The authority's refusal is reported; the graph holds what was read by then.
  }
  graph.reads.delete(file);
  return graph;
}

// P11-R3: `std:<module>` for the base's stdlib; a file an absolute `use` reaches
// keeps its path, which the input's bytes spell; else the path from the input's folder.
function importKey(graph, absoluteFile) {
  if (absoluteFile.startsWith(graph.stdlibPrefix)) return `std:${absoluteFile.slice(graph.stdlibPrefix.length).replace(/\.air$/, "")}`;
  if (graph.absolute.has(absoluteFile)) return absoluteFile;
  return path.relative(path.dirname(graph.file), absoluteFile);
}

function importsOf(graph) {
  const byKey = new Map();
  for (const file of graph.reads) byKey.set(importKey(graph, file), sha256(fs.readFileSync(file)));
  return [...byKey.keys()].sort(compareCodeUnits).map((key) => ({ path: key, sha256: byKey.get(key) }));
}

// The input's `use` line that brings `target` in, the smallest such line.
function useLineReaching(graph, target) {
  const reaches = (file, seen) => {
    if (file === target) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    const node = graph.nodes.get(file);
    return Boolean(node) && node.uses.some((use) => use.target && reaches(use.target, seen));
  };
  const lines = graph.nodes.get(graph.file).uses.filter((use) => use.target && reaches(use.target, new Set())).map((use) => use.line);
  return lines.length ? Math.min(...lines) : null;
}

// P11-R2 step 4: legacy's own first diagnostic depends on the working directory
// and the locale (G-14), so M() takes the first by code, file, line and message.
function firstDiagnostic(diagnostics, graph) {
  const rows = diagnostics.map((item) => {
    const where = item.file ? path.resolve(item.file) : null;
    return {
      code: String(item.code),
      key: where === null || where === graph.file ? "" : importKey(graph, where),
      line: Number.isInteger(item.line) ? item.line : null,
      message: String(item.message),
      where
    };
  });
  rows.sort((left, right) => compareCodeUnits(left.code, right.code) || compareCodeUnits(left.key, right.key) ||
    (left.line || 0) - (right.line || 0) || compareCodeUnits(left.message, right.message));
  return rows[0];
}

function legacyRefusal(error, graph) {
  let line;
  let message;
  let where;
  if (error && Array.isArray(error.diagnostics) && error.diagnostics.length) {
    const first = firstDiagnostic(error.diagnostics, graph);
    ({ line, where } = first);
    message = `${first.code}: ${first.message}`;
  } else {
    const loc = error && error.loc;
    line = loc && Number.isInteger(loc.line) ? loc.line : null;
    where = loc && loc.file ? path.resolve(loc.file) : null;
    message = String(error && error.message !== undefined ? error.message : error);
    if (loc) {
      const prefix = `${loc.file}:${loc.line}: `;
      if (message.startsWith(prefix)) message = message.slice(prefix.length);
    }
  }
  // G-14: the one refusal that writes a path; the path is written as `imports` names a file.
  const unresolved = UNRESOLVED_IMPORT.exec(message);
  if (unresolved) message = `${unresolved[1]}${importKey(graph, unresolved[2])}`;
  const semantic = SEMANTIC_CODE.exec(message);
  const legacyCode = semantic ? semantic[1] : null;
  if (where !== null && where !== graph.file && graph.reads.has(where)) {
    const origin = { construct: "legacy-invalid", file: importKey(graph, where), line };
    return { legacy_code: legacyCode, legacy_message: message, line: useLineReaching(graph, where), origin };
  }
  return { legacy_code: legacyCode, legacy_message: message, line, origin: null };
}

// ---------------------------------------------------------------------------
// Control flow of a valid legacy function (P11-R10, R12; G-10).

function lastOf(block) {
  return block.instructions[block.instructions.length - 1];
}

function isPhi(ins) {
  return ins.op.startsWith("phi.");
}

function valueNames(ins) {
  return (ins.args || []).filter((arg) => arg && arg.kind === "value").map((arg) => arg.name);
}

function isValue(arg, name) {
  return Boolean(arg) && arg.kind === "value" && arg.name === name;
}

function structuredLoop(fn) {
  if (fn.blocks.length !== 4) return null;
  const [entry, header, body, exit] = fn.blocks;
  if (lastOf(entry).op !== "br" || lastOf(entry).labels[0] !== header.label) return null;
  if (lastOf(header).op !== "br_if" || lastOf(header).labels[0] !== exit.label || lastOf(header).labels[1] !== body.label) return null;
  if (lastOf(body).op !== "br" || lastOf(body).labels[0] !== header.label) return null;
  if (lastOf(exit).op !== "return") return null;
  if (!header.instructions.some(isPhi)) return null;
  return { body, entry, exit, header };
}

function i32Constant(ins) {
  if (!ins || ins.op !== "const.i32" || !ins.args[0] || ins.args[0].kind !== "number") return null;
  const value = exactInteger(ins.args[0].raw);
  return value !== null && value >= I32_MIN && value <= I32_MAX ? value : null;
}

// P11-R12: the fold of a counter loop, or null when the loop is not one.
function counterLoop(loop) {
  const { body, entry, exit, header } = loop;
  const lines = header.instructions;
  const phi = lines[0];
  if (lines.length < 3 || phi.op !== "phi.i32" || phi.resultType !== "i32" || phi.declaredType || phi.args.length !== 2) return null;
  const fromEntry = phi.args.find((arg) => arg.kind === "phi" && arg.label === entry.label);
  const fromBody = phi.args.find((arg) => arg.kind === "phi" && arg.label === body.label);
  if (!fromEntry || !fromBody) return null;
  const counter = phi.result;
  const test = lines[lines.length - 2];
  const branch = lines[lines.length - 1];
  if (test.op !== "i32.ge_s" || !isValue(test.args[0], counter) || !test.args[1] || test.args[1].kind !== "value") return null;
  if (!isValue(branch.args[0], test.result)) return null;
  const between = lines.slice(1, -2);
  if (between.some((ins) => i32Constant(ins) === null)) return null;

  const definitions = new Map([...entry.instructions, ...between].filter((ins) => ins.result).map((ins) => [ins.result, ins]));
  const init = i32Constant(definitions.get(fromEntry.value));
  const limit = i32Constant(definitions.get(test.args[1].name));
  if (init === null || limit === null) return null;

  const bodyLines = body.instructions.slice(0, -1);
  const bodyValues = new Map(bodyLines.filter((ins) => ins.result).map((ins) => [ins.result, ins]));
  if (bodyLines.some((ins) => valueNames(ins).some((name) => name !== counter && !bodyValues.has(name)))) return null;
  const step = bodyValues.get(fromBody.value);
  if (!step || step.op !== "i32.add" || step.args.length !== 2) return null;
  const isOne = (arg) => (arg.kind === "number" ? exactInteger(arg.raw) === 1n : arg.kind === "value" && i32Constant(bodyValues.get(arg.name)) === 1n);
  if (!((isValue(step.args[0], counter) && isOne(step.args[1])) || (isOne(step.args[0]) && isValue(step.args[1], counter)))) return null;

  const headerValues = new Set(lines.filter((ins) => ins.result && ins.result !== counter).map((ins) => ins.result));
  if (exit.instructions.some((ins) => valueNames(ins).some((name) => headerValues.has(name) || bodyValues.has(name)))) return null;

  const count = limit > init ? limit - init : 0n;
  if (count > LOOP_MAX) return null;
  const headerInit = between.find((ins) => ins.result === fromEntry.value) || null;
  return { count, counter, headerInit, init: fromEntry.value, next: fromBody.value };
}

// The function's shape, or the constructs that keep it from having one.
function controlFlowOf(fn) {
  if (fn.blocks.length === 1) return { shape: "straight" };
  const loop = structuredLoop(fn);
  if (loop) {
    const fold = counterLoop(loop);
    if (fold) return { fold, loop, shape: "counter-loop" };
    return { unmapped: [{ construct: "phi-loop", line: loop.header.instructions.find(isPhi).loc.line }] };
  }
  const unmapped = [];
  const phi = fn.blocks.flatMap((block) => block.instructions).find(isPhi);
  if (phi) unmapped.push({ construct: "unstructured-cfg", line: phi.loc.line });
  const terminator = lastOf(fn.blocks[0]);
  const reached = new Set([fn.blocks[0].label, ...(terminator.labels || [])]);
  const unreachable = fn.blocks.find((block) => !reached.has(block.label));
  if (unreachable) unmapped.push({ construct: "unstructured-cfg", line: unreachable.loc.line });
  if (unmapped.length) return { unmapped };
  return { shape: terminator.op === "br" ? "br-merge" : "return-split" };
}

// ---------------------------------------------------------------------------
// P11-R5: what a module's own constructs say, in two passes.

// The module-level lines, with comments stripped: the lines a legacy AST keeps
// no location for (`module`, `capabilities`).
function moduleLines(text) {
  const out = [];
  let inBlock = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = withoutComment(raw);
    if (!line) return;
    if (inBlock) {
      if (line === "}") inBlock = false;
      return;
    }
    if (line.endsWith("{")) {
      inBlock = true;
      return;
    }
    out.push({ line: index + 1, text: line });
  });
  return out;
}

const CAPABILITIES_LINE = /^capabilities\s*\{\s*([^}]*)\s*\}$/;

function opReason(op) {
  if (NEVER_OPS.has(op) || NEVER_OP_FAMILIES.some((family) => op.startsWith(family))) return "not_admitted";
  return "later_increment";
}

function isMappedOp(op) {
  return RENAMED_OPS.has(op) || SAME_NAME_OPS.has(op) || HELPERS.has(op) || op === "call" || op === "return" || op === "br" || op === "br_if";
}

function typeConstruct(typeName) {
  if (SCALAR_TYPES.has(typeName)) return null;
  return { construct: `type ${typeName}`, reason: GEOMETRY_TYPES.has(typeName) ? "not_admitted" : "later_increment" };
}

function ownConstructs(node, graph, moduleId, verdicts) {
  const { ast } = node;
  const found = [];
  const lines = moduleLines(node.text);
  const hasMapping = moduleId !== null;
  const add = (line, construct, reason, origin = null) => found.push({ construct, line, origin, reason });

  if (!TYPED_MODULE_ID.test(hasMapping ? moduleId : ast.name)) add(lines.find((item) => item.text.startsWith("module")).line, "module-identity", "not_admitted");
  for (const form of NEVER_FORMS) for (const item of ast[form]) add(item.loc.line, form, "not_admitted");
  for (const form of LATER_FORMS) {
    for (const item of form === "externs" ? node.externs : ast[form]) add(item.loc.line, form, "later_increment");
  }
  for (const table of ast.tables) add(table.loc.line, "tables", COMPACT_TABLE_TYPES.has(table.type) ? "not_admitted" : "later_increment");

  for (const use of node.uses) {
    let reason = !use.target && use.name.startsWith("math.") ? "not_admitted" : "later_increment";
    let origin = null;
    if (use.target && graph.nodes.has(use.target)) {
      const verdict = reportedConstruct(graph.nodes.get(use.target), graph, null, verdicts);
      if (verdict && verdict.reason === "not_admitted") {
        reason = "not_admitted";
        origin = verdict.origin || { construct: verdict.construct, file: importKey(graph, use.target), line: verdict.line };
      }
    }
    add(use.line, "uses", reason, origin);
  }

  for (const item of lines) {
    const capabilities = CAPABILITIES_LINE.exec(item.text);
    if (capabilities && capabilities[1].split(",").some((part) => part.trim())) add(item.line, "capabilities", "later_increment");
  }

  for (const fn of ast.functions) {
    for (const typeName of [...fn.params.map((parameter) => parameter.type), fn.returnType]) {
      const unmapped = typeConstruct(typeName);
      if (unmapped) add(fn.loc.line, unmapped.construct, unmapped.reason);
    }
    for (const form of ["effects", "requires", "ensures"]) for (const item of fn[form]) add(item.loc.line, form, "later_increment");
    for (const block of fn.blocks) {
      for (const ins of block.instructions) {
        if (LITERAL_OPS.has(ins.op)) {
          const atom = ins.args[0];
          // A carrier's operand that is no literal of its type has no typed spelling (P11-R8).
          if (!atom || atom.kind !== (ins.op === "const.bool" ? "bool" : "number")) add(ins.loc.line, ins.op, "not_admitted");
        } else if (!isPhi(ins) && !isMappedOp(ins.op)) {
          add(ins.loc.line, ins.op, opReason(ins.op));
        }
      }
    }
    for (const item of controlFlowOf(fn).unmapped || []) add(item.line, item.construct, "not_admitted");
  }
  return found;
}

function reportedConstruct(node, graph, moduleId, verdicts) {
  if (verdicts.has(node.file)) return verdicts.get(node.file);
  const found = ownConstructs(node, graph, moduleId, verdicts);
  const first = (reason) => found.filter((item) => item.reason === reason).reduce((best, item) => (!best || item.line < best.line ? item : best), null);
  const verdict = first("not_admitted") || first("later_increment");
  verdicts.set(node.file, verdict);
  return verdict;
}

// ---------------------------------------------------------------------------
// The mapping (P11-R6 ... R13). It runs on a module with nothing left to report,
// so every construct below has its rule, and no module here has a `use` line.

function atomText(atom) {
  return atom.kind === "value" ? atom.name : atom.raw;
}

function declaredOf(ins) {
  return ins.declaredType || ins.resultType;
}

function highestClass(entries) {
  return entries.reduce((highest, entry) => Math.max(highest, CLASS_ORDER.indexOf(entry.class)), 0);
}

function entry(line, construct, from, to, rule, entryClass = "EXACT", ledger = null, legacyValue = null) {
  return { class: entryClass, construct, from, ledger, legacy_value: legacyValue, line, rule, to };
}

class FunctionMapper {
  constructor(fn, lines, entries) {
    this.fn = fn;
    this.sourceLines = lines;
    this.entries = entries;
    this.names = new Set(fn.params.map((parameter) => `%${parameter.name}`));
    for (const block of fn.blocks) for (const ins of block.instructions) if (ins.result) this.names.add(ins.result);
  }

  // P11-R11.
  freshName(base) {
    for (let k = 1; ; k += 1) {
      const name = `${base}__${k}`;
      if (!this.names.has(name)) {
        this.names.add(name);
        return name;
      }
    }
  }

  literalLine(ins) {
    const type = LITERAL_OPS.get(ins.op);
    const atom = ins.args[0];
    if (type === "bool") {
      if (ins.compact !== "const") this.entries.push(entry(ins.loc.line, "literal", `${ins.op} ${atom.raw}`, atom.raw, "P11-R8"));
      return `${ins.result}: ${declaredOf(ins)} = ${atom.raw}`;
    }
    const literal = typedLiteral(type, atom.raw);
    const from = ins.compact === "const" ? atom.raw : `${ins.op} ${atom.raw}`;
    if (insideLiteralDefect(type, atom)) {
      this.entries.push(entry(ins.loc.line, "literal", from, literal, "P11-R8", "LEGACY_DEFECT_CORRECTED", "X-SND-08", String(atom.value)));
    } else if (from !== literal) {
      this.entries.push(entry(ins.loc.line, "literal", from, literal, "P11-R8"));
    }
    return `${ins.result}: ${declaredOf(ins)} = ${literal}`;
  }

  helperLines(ins, written) {
    const steps = HELPERS.get(ins.op);
    const slots = new Map([[0, ins.result]]);
    for (const step of steps) if (step[0] !== 0) slots.set(step[0], this.freshName(ins.result));
    const operand = (item) => (typeof item === "number" ? atomText(ins.args[item]) : slots.get(item.slot));
    const typeText = declaredOf(ins);
    this.entries.push(entry(ins.loc.line, ins.op, written, steps.map((step) => step[1]).join(", "), "P11-R9"));
    return steps.map(([slot, what, operands]) => `${slots.get(slot)}: ${typeText} = ${what}${operands ? ` ${operands.map(operand).join(", ")}` : ""}`);
  }

  instructionLines(ins) {
    if (LITERAL_OPS.has(ins.op)) return [this.literalLine(ins)];
    const args = (ins.args || []).map(atomText);
    if (ins.op === "call") {
      const typed = `call @${ins.callee}(${args.join(", ")})`;
      if (ins.compact === "call") {
        const written = /@[^\s(]+\(.*\)$/.exec(this.sourceLines[ins.loc.line - 1])[0];
        this.entries.push(entry(ins.loc.line, "call", written, typed, "P11-R9"));
      }
      return [`${ins.result}: ${declaredOf(ins)} = ${typed}`];
    }
    const written = ins.compact === "alias" ? ins.op.slice(ins.op.indexOf(".") + 1) : ins.op;
    if (HELPERS.has(ins.op)) return this.helperLines(ins, written);
    let typedOp = ins.op;
    if (RENAMED_OPS.has(ins.op)) {
      const [renamed, opClass] = RENAMED_OPS.get(ins.op);
      typedOp = renamed;
      this.entries.push(entry(ins.loc.line, ins.op, written, renamed, "P11-R9", opClass));
    } else if (written !== ins.op) {
      this.entries.push(entry(ins.loc.line, ins.op, written, ins.op, "P11-R9"));
    }
    return [`${ins.result}: ${declaredOf(ins)} = ${typedOp} ${args.join(", ")}`];
  }

  blockLines(block, terminator) {
    const lines = [];
    for (const ins of block.instructions) {
      if (ins.op === "br" || ins.op === "br_if") continue;
      if (ins.op === "return") lines.push(`${terminator} ${atomText(ins.args[0])}`);
      else lines.push(...this.instructionLines(ins));
    }
    return lines;
  }

  branchText(ins) {
    return this.sourceLines[ins.loc.line - 1];
  }

  labelEntry() {
    const first = this.fn.blocks[0];
    this.entries.push(entry(first.loc.line, "label", `${first.label}:`, null, "P11-R10"));
  }

  returnSplit() {
    const [first] = this.fn.blocks;
    const branch = lastOf(first);
    const [thenBlock, elseBlock] = branch.labels.map((label) => this.fn.blocks.find((block) => block.label === label));
    const result = this.names.has("%ret") ? this.freshName("%ret") : "%ret";
    this.names.add(result);
    const header = `${result}: ${this.fn.returnDeclaredType || this.fn.returnType} = if ${atomText(branch.args[0])}`;
    this.entries.push(entry(branch.loc.line, "return-split", this.branchText(branch), header, "P11-R10"));
    return [...this.blockLines(first, "return"), `${header} {`, ...this.blockLines(thenBlock, "yield"), "} else {", ...this.blockLines(elseBlock, "yield"), "}",
      `return ${result}`];
  }

  counterLoop(flow, callback) {
    const { fold, loop } = flow;
    const jump = lastOf(loop.entry);
    const header = `${fold.counter}: i32 = loop.fold @${callback}, ${fold.init}, ${fold.count}`;
    this.entries.push(entry(jump.loc.line, "counter-loop", this.branchText(jump), header, "P11-R12", "EXACT_ON_SUCCESS", "X-SND-01"));
    const body = this.blockLines(loop.body, "return");
    return {
      callback: { body: [...body, `return ${fold.next}`], name: callback, parameter: fold.counter.slice(1) },
      lines: [...this.blockLines(loop.entry, "return"), ...(fold.headerInit ? [this.literalLine(fold.headerInit)] : []), header, ...this.blockLines(loop.exit, "return")]
    };
  }
}

function signatureLine(fn, entries) {
  const refined = [];
  const typeOf = (declared, base) => {
    if (declared && declared !== base && !refined.includes(declared)) refined.push(declared);
    return declared || base;
  };
  const params = fn.params.map((parameter) => `${parameter.name}: ${typeOf(parameter.declaredType, parameter.type)}`);
  const result = typeOf(fn.returnDeclaredType, fn.returnType);
  for (const spelling of refined) entries.push(entry(fn.loc.line, "refinement", spelling, spelling, "P11-R13", "LEGACY_DEFECT_CORRECTED", "X-SND-09"));
  return `${fn.exported ? "export " : ""}func ${fn.name}(${params.join(", ")}) -> ${result} {`;
}

function mappedFunctions(ast, text, entries) {
  const sourceLines = text.split(/\r?\n/).map(withoutComment);
  const names = new Set(ast.functions.map((fn) => fn.name));
  const functions = [];
  for (const fn of ast.functions) {
    const mapper = new FunctionMapper(fn, sourceLines, entries);
    const signature = signatureLine(fn, entries);
    const flow = controlFlowOf(fn);
    mapper.labelEntry();
    let lines;
    if (flow.shape === "straight") {
      lines = mapper.blockLines(fn.blocks[0], "return");
    } else if (flow.shape === "br-merge") {
      const jump = lastOf(fn.blocks[0]);
      entries.push(entry(jump.loc.line, "br-merge", mapper.branchText(jump), null, "P11-R10"));
      lines = [...mapper.blockLines(fn.blocks[0], "return"), ...mapper.blockLines(fn.blocks[1], "return")];
    } else if (flow.shape === "return-split") {
      lines = mapper.returnSplit();
    } else {
      // P11-R11: `<function>__<header label>`, the smallest unused name.
      const base = `${fn.name}__${flow.loop.header.label}`;
      let callback = base;
      for (let k = 1; names.has(callback); k += 1) callback = `${base}__${k}`;
      names.add(callback);
      const mapped = mapper.counterLoop(flow, callback);
      lines = mapped.lines;
      functions.push(`func ${callback}(${mapped.callback.parameter}: i32) -> i32 {\n${mapped.callback.body.join("\n")}\n}`);
    }
    functions.push(`${signature}\n${lines.join("\n")}\n}`);
  }
  return functions;
}

// P11-R19: the output parses, verifies and formats to itself, or it is no output.
function checkedOutput(typedText) {
  const canonical = formatSource(parseSource(typedText, "<migrated>", GATED), GATED);
  const reread = parseSource(canonical, "<migrated>", GATED);
  verifySource(reread, GATED);
  if (formatSource(reread, GATED) !== canonical) throw new Error("the output does not format to itself");
  return canonical;
}

// ---------------------------------------------------------------------------

function migrateV053(source, options = {}) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(String(source), "utf8");
  const text = bytes.toString("utf8");
  const file = path.resolve(options.path === undefined ? "<input>" : String(options.path));
  const moduleId = options.moduleId === undefined || options.moduleId === null ? null : String(options.moduleId);
  const common = {
    from: "legacy-v0.50",
    imports: [],
    increment: "I1",
    input_sha256: sha256(bytes),
    options: moduleId === null ? {} : { module_id: moduleId },
    schema: "air.migration-record/1",
    to: "typed-v0.53"
  };
  const rejected = (rejection, imports = []) => {
    const details = { code: CODE, ...rejection };
    return {
      ...details,
      kind: "REJECTED",
      record: canonicalRecord({ ...common, entries: [], imports, rejection: details })
    };
  };

  if (isTypedSource(text, file)) return rejected({ construct: "source-profile", line: 1, origin: null, reason: "not_admitted" });

  let ast;
  let refusal = null;
  try {
    ast = parseSource(text, file);
    const library = !ast.functions.some((fn) => fn.name === "main" || fn.exported);
    verifySource(ast, { library });
  } catch (error) {
    rethrowIoFailure(error);
    refusal = error;
  }
  const graph = observeLegacyImports(text, file);
  const imports = importsOf(graph);
  if (refusal) return rejected({ construct: "legacy-invalid", reason: "legacy_invalid", ...legacyRefusal(refusal, graph) }, imports);

  const node = graph.nodes.get(file);
  const unmapped = reportedConstruct(node, graph, moduleId, new Map());
  if (unmapped) return rejected({ construct: unmapped.construct, line: unmapped.line, origin: unmapped.origin, reason: unmapped.reason }, imports);

  const entries = [];
  const lines = moduleLines(text);
  const moduleLine = lines.find((item) => item.text.startsWith("module")).line;
  if (moduleId !== null) entries.push(entry(moduleLine, "module-identity", node.ast.name, moduleId, "P11-R7"));
  for (const item of lines) if (CAPABILITIES_LINE.test(item.text)) entries.push(entry(item.line, "capabilities", item.text, null, "P11-R6"));
  const functions = mappedFunctions(node.ast, text, entries);
  entries.sort((left, right) => left.line - right.line);

  let output;
  try {
    output = checkedOutput(`module ${moduleId === null ? node.ast.name : moduleId}\n\n${functions.join("\n\n")}\n`);
  } catch (error) {
    return rejected({ construct: "typed-verification", line: 1, origin: null, reason: "not_admitted", typed_code: error && error.code ? error.code : null }, imports);
  }
  const moduleClass = CLASS_ORDER[highestClass(entries)];
  return {
    class: moduleClass,
    kind: "MIGRATED",
    output,
    record: canonicalRecord({ ...common, class: moduleClass, entries, imports, output_sha256: sha256(output) })
  };
}

module.exports = { MIGRATION_CODE: CODE, migrateV053 };
