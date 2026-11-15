"use strict";

// SEC53-06B: linear-time matching for the expressions of QA's super-linear inventory.
// It compiles a RegExp's own source and flags to a Thompson program and runs it as a Pike VM. Threads
// keep the backtracking engine's priority order, so the match and its captures are ECMAScript's
// leftmost-first result, in time proportional to the input length times the program size. Each
// single-character test is delegated to V8 (a one-character RegExp), so character semantics are V8's.
// It refuses what the inventory's expressions do not use: backreferences, lookarounds, named groups,
// the i, s, u and y flags, a repeated body that can match the empty string, a capturing group inside a
// repetition that can run more than once (so no capture needs resetting between iterations), and the
// escapes Annex B reads otherwise: \c without a letter, \0 before a digit, \x or \u without their hex digits.
// Internal module: src/index.js does not spread it, and F-1's exports map gives no path to it.

const OP_CHAR = 0;
const OP_SPLIT = 1;
const OP_JMP = 2;
const OP_SAVE = 3;
const OP_BOL = 5;
const OP_EOL = 6;
const OP_WORDB = 7;
const OP_NWORDB = 8;
const OP_MATCH = 9;

function unsupported(source, why) {
  throw new Error(`linear_regex: /${source}/ is not supported (${why})`);
}

function isLineTerminator(code) {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

function isWordChar(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

// One code unit tested by V8 itself. The 128 ASCII answers are memoized per atom; other code units are
// tested each time, so no state grows with the input.
function charTest(atomSource) {
  const re = new RegExp(`^(?:${atomSource})$`);
  const ascii = new Int8Array(128);
  return (code) => {
    if (code < 128) {
      let v = ascii[code];
      if (v === 0) { v = re.test(String.fromCharCode(code)) ? 1 : -1; ascii[code] = v; }
      return v === 1;
    }
    return re.test(String.fromCharCode(code));
  };
}

function parse(source) {
  let pos = 0;
  let groupCount = 0;
  const peek = () => source[pos];
  function parseAlternation() {
    const alts = [parseSequence()];
    while (peek() === "|") { pos += 1; alts.push(parseSequence()); }
    return alts.length === 1 ? alts[0] : { type: "alt", alts };
  }
  function parseSequence() {
    const items = [];
    while (pos < source.length && peek() !== "|" && peek() !== ")") items.push(parseQuantified());
    return { type: "cat", items };
  }
  function parseQuantified() {
    const atom = parseAtom();
    const q = readQuantifier();
    if (!q) return atom;
    if (atom.type === "assert") unsupported(source, "quantified assertion");
    return { type: "rep", min: q.min, max: q.max, greedy: q.greedy, body: atom };
  }
  function readQuantifier() {
    const c = peek();
    let min;
    let max;
    if (c === "*") { min = 0; max = Infinity; pos += 1; }
    else if (c === "+") { min = 1; max = Infinity; pos += 1; }
    else if (c === "?") { min = 0; max = 1; pos += 1; }
    else if (c === "{") {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(source.slice(pos));
      if (!m) return null; // a literal "{" in non-unicode mode
      min = Number(m[1]);
      max = m[2] === undefined ? min : (m[3] === "" ? Infinity : Number(m[3]));
      if (max < min) unsupported(source, "bad interval");
      pos += m[0].length;
    } else return null;
    let greedy = true;
    if (peek() === "?") { greedy = false; pos += 1; }
    return { min, max, greedy };
  }
  function parseAtom() {
    const c = peek();
    if (c === "(") {
      if (source.startsWith("(?:", pos)) {
        pos += 3;
        const body = parseAlternation();
        if (peek() !== ")") unsupported(source, "unclosed group");
        pos += 1;
        return { type: "group", index: null, body };
      }
      if (source[pos + 1] === "?") unsupported(source, "lookaround or named group");
      pos += 1;
      groupCount += 1;
      const index = groupCount;
      const body = parseAlternation();
      if (peek() !== ")") unsupported(source, "unclosed group");
      pos += 1;
      return { type: "group", index, body };
    }
    if (c === "^") { pos += 1; return { type: "assert", kind: OP_BOL }; }
    if (c === "$") { pos += 1; return { type: "assert", kind: OP_EOL }; }
    if (c === ".") { pos += 1; return { type: "char", src: "." }; }
    if (c === "[") {
      let end = pos + 1;
      if (source[end] === "^") end += 1;
      while (end < source.length && source[end] !== "]") end += source[end] === "\\" ? 2 : 1;
      if (end >= source.length) unsupported(source, "unclosed class");
      const src = source.slice(pos, end + 1);
      pos = end + 1;
      return { type: "char", src };
    }
    if (c === "\\") {
      const n = source[pos + 1];
      if (n === undefined) unsupported(source, "trailing backslash");
      if (n === "b") { pos += 2; return { type: "assert", kind: OP_WORDB }; }
      if (n === "B") { pos += 2; return { type: "assert", kind: OP_NWORDB }; }
      if (/[1-9]/.test(n)) unsupported(source, "backreference");
      if (n === "k") unsupported(source, "named backreference");
      // Annex B reads these as more than one code unit, or as an octal escape: refused, not approximated.
      const rest = source.slice(pos + 2, pos + 6);
      if (n === "c" && !/^[A-Za-z]/.test(rest)) unsupported(source, "\\c without a letter");
      if (n === "0" && /^[0-9]/.test(rest)) unsupported(source, "\\0 before a digit");
      if (n === "x" && !/^[0-9A-Fa-f]{2}/.test(rest)) unsupported(source, "\\x without two hex digits");
      if (n === "u" && !/^[0-9A-Fa-f]{4}/.test(rest)) unsupported(source, "\\u without four hex digits");
      let len = 2;
      if (n === "x") len = 4;
      else if (n === "u") len = 6;
      else if (n === "c") len = 3;
      const src = source.slice(pos, pos + len);
      pos += len;
      return { type: "char", src };
    }
    if (c === "*" || c === "+" || c === "?" || c === ")" || c === "|") unsupported(source, `unexpected ${c}`);
    pos += 1;
    return { type: "char", src: c.replace(/[\\^$.*+?()[\]{}|/]/, "\\$&") };
  }
  const ast = parseAlternation();
  if (pos !== source.length) unsupported(source, "unbalanced )");
  return { ast, groupCount };
}

function nullable(node) {
  switch (node.type) {
    case "char": return false;
    case "assert": return true;
    case "cat": return node.items.every(nullable);
    case "alt": return node.alts.some(nullable);
    case "group": return nullable(node.body);
    case "rep": return node.min === 0 || nullable(node.body);
    default: return true;
  }
}

function groupRange(node) {
  let lo = Infinity;
  let hi = -Infinity;
  (function walk(n) {
    if (n.type === "group" && n.index !== null) { lo = Math.min(lo, n.index); hi = Math.max(hi, n.index); }
    if (n.body) walk(n.body);
    if (n.items) n.items.forEach(walk);
    if (n.alts) n.alts.forEach(walk);
  }(node));
  return lo === Infinity ? null : [lo, hi];
}

function compile(source, flags) {
  if (/[^gm]/.test(flags)) unsupported(source, `flags ${flags}`);
  const { ast, groupCount } = parse(source);
  const code = [];
  const emit = (ins) => { code.push(ins); return code.length - 1; };
  function gen(node) {
    switch (node.type) {
      case "char": emit({ op: OP_CHAR, test: charTest(node.src) }); return;
      case "assert": emit({ op: node.kind }); return;
      case "cat": node.items.forEach(gen); return;
      case "group":
        if (node.index === null) { gen(node.body); return; }
        emit({ op: OP_SAVE, slot: node.index * 2 });
        gen(node.body);
        emit({ op: OP_SAVE, slot: node.index * 2 + 1 });
        return;
      case "alt": {
        const jumps = [];
        node.alts.forEach((alt, k) => {
          if (k < node.alts.length - 1) {
            const split = emit({ op: OP_SPLIT, x: code.length + 1, y: -1 });
            gen(alt);
            jumps.push(emit({ op: OP_JMP, x: -1 }));
            code[split].y = code.length;
          } else gen(alt);
        });
        jumps.forEach((j) => { code[j].x = code.length; });
        return;
      }
      case "rep": {
        if (node.max > node.min && nullable(node.body)) unsupported(source, "repeated body can match empty");
        if (node.max > 1 && groupRange(node.body)) unsupported(source, "capturing group inside a repetition");
        for (let k = 0; k < node.min; k += 1) gen(node.body);
        if (node.max === Infinity) {
          const split = emit({ op: OP_SPLIT, x: -1, y: -1 });
          const bodyStart = code.length;
          gen(node.body);
          emit({ op: OP_JMP, x: split });
          const out = code.length;
          if (node.greedy) { code[split].x = bodyStart; code[split].y = out; } else { code[split].x = out; code[split].y = bodyStart; }
        } else {
          const splits = [];
          for (let k = node.min; k < node.max; k += 1) {
            const split = emit({ op: OP_SPLIT, x: -1, y: -1 });
            splits.push(split);
            const bodyStart = code.length;
            gen(node.body);
            if (node.greedy) code[split].x = bodyStart; else code[split].y = bodyStart;
          }
          const out = code.length;
          splits.forEach((s) => { if (node.greedy) code[s].y = out; else code[s].x = out; });
        }
        return;
      }
      default: unsupported(source, "node");
    }
  }
  emit({ op: OP_SAVE, slot: 0 });
  gen(ast);
  emit({ op: OP_SAVE, slot: 1 });
  emit({ op: OP_MATCH });
  const anchored = ast.type === "cat" && ast.items[0] && ast.items[0].type === "assert" && ast.items[0].kind === OP_BOL;
  // The literal text right after a leading "^" (without m): an input that does not start with it cannot match.
  let prefix = "";
  if (anchored && !flags.includes("m")) {
    for (const item of ast.items.slice(1)) {
      if (item.type !== "char") break;
      const src = item.src;
      if (src === ".") break;
      if (src.length === 1) prefix += src;
      else if (src.length === 2 && src[0] === "\\" && /[^A-Za-z0-9]/.test(src[1])) prefix += src[1];
      else break;
    }
  }
  return { code, slots: (groupCount + 1) * 2, multiline: flags.includes("m"), anchored, prefix, mark: new Int32Array(code.length).fill(-1), gen: 0 };
}

const CACHE = new Map();
function program(re) {
  const key = `${re.flags}/${re.source}`;
  let prog = CACHE.get(key);
  if (!prog) { prog = compile(re.source, re.flags); CACHE.set(key, prog); }
  return prog;
}

// The leftmost-first match at or after `start` (exactly at `start` when sticky), as a capture slot array, or null.
function run(prog, s, start, sticky) {
  const { code, slots, multiline, mark } = prog;
  const n = s.length;
  if (prog.prefix && !(start === 0 && s.startsWith(prog.prefix))) return null;
  // mark is an Int32Array, so the counter must stay below 2^31. A call adds at most its input length + 2,
  // and V8's longest string is under 2^30, so resetting above 0x3fffff00 keeps every call below 2^31.
  if (prog.gen > 0x3fffff00) { prog.mark.fill(-1); prog.gen = 0; }
  let gen = prog.gen;
  try {
  let found = null;
  const atBol = (i) => i === 0 || (multiline && isLineTerminator(s.charCodeAt(i - 1)));
  const atEol = (i) => i === n || (multiline && isLineTerminator(s.charCodeAt(i)));
  const atWordB = (i) => (i > 0 && isWordChar(s.charCodeAt(i - 1))) !== (i < n && isWordChar(s.charCodeAt(i)));
  function add(list, pc, caps, i) {
    if (mark[pc] === gen) return;
    mark[pc] = gen;
    const ins = code[pc];
    switch (ins.op) {
      case OP_JMP: add(list, ins.x, caps, i); return;
      case OP_SPLIT: add(list, ins.x, caps, i); add(list, ins.y, caps, i); return;
      case OP_SAVE: { const c = caps.slice(); c[ins.slot] = i; add(list, pc + 1, c, i); return; }
      case OP_BOL: if (atBol(i)) add(list, pc + 1, caps, i); return;
      case OP_EOL: if (atEol(i)) add(list, pc + 1, caps, i); return;
      case OP_WORDB: if (atWordB(i)) add(list, pc + 1, caps, i); return;
      case OP_NWORDB: if (!atWordB(i)) add(list, pc + 1, caps, i); return;
      default: list.push(pc, caps);
    }
  }
  const empty = new Array(slots).fill(-1);
  let clist = [];
  gen += 1;
  add(clist, 0, empty, start);
  for (let i = start; i <= n; i += 1) {
    const code1 = i < n ? s.charCodeAt(i) : -1;
    const nlist = [];
    gen += 1;
    for (let t = 0; t < clist.length; t += 2) {
      const pc = clist[t];
      const ins = code[pc];
      if (ins.op === OP_MATCH) { found = clist[t + 1]; break; }
      if (code1 >= 0 && ins.test(code1)) add(nlist, pc + 1, clist[t + 1], i + 1);
    }
    if (i === n) break;
    clist = nlist;
    if (found === null && !sticky && !(prog.anchored && !multiline)) add(clist, 0, empty, i + 1);
    if (clist.length === 0 && (found !== null || sticky || (prog.anchored && !multiline))) break;
  }
  prog.gen = gen;
  return found;
  } finally { prog.gen = gen; }
}

function toResult(caps, s) {
  const out = [];
  for (let k = 0; k < caps.length; k += 2) out.push(caps[k] >= 0 && caps[k + 1] >= 0 ? s.slice(caps[k], caps[k + 1]) : undefined);
  out.index = caps[0];
  out.input = s;
  out.groups = undefined;
  return out;
}

function plain(re) {
  if (re.global || re.sticky) throw new Error(`linear_regex: /${re.source}/${re.flags} must not be global or sticky here`);
}

// RegExp.prototype.exec and String.prototype.match for a non-global expression.
function exec(re, value) {
  plain(re);
  const s = String(value);
  const caps = run(program(re), s, 0, false);
  return caps === null ? null : toResult(caps, s);
}

function test(re, value) {
  plain(re);
  return run(program(re), String(value), 0, false) !== null;
}

// String.prototype.replace with a string replacement that holds no "$" pattern.
function replace(re, value, replacement) {
  if (re.sticky || typeof replacement !== "string" || replacement.includes("$")) throw new Error("linear_regex: replace takes a non-sticky expression and a plain string");
  const s = String(value);
  const prog = program(re);
  let out = "";
  let last = 0;
  let from = 0;
  while (from <= s.length) {
    const caps = run(prog, s, from, false);
    if (caps === null) break;
    out += s.slice(last, caps[0]) + replacement;
    last = caps[1];
    if (!re.global) break;
    from = caps[1] === caps[0] ? caps[1] + 1 : caps[1];
  }
  return out + s.slice(last);
}

// String.prototype.split with no limit (ECMAScript's SplitMatcher, by searching forward instead of trying each position).
function split(re, value) {
  if (re.sticky) throw new Error("linear_regex: split takes a non-sticky expression");
  const s = String(value);
  const prog = program(re);
  const size = s.length;
  if (size === 0) return run(prog, s, 0, true) !== null ? [] : [s];
  const out = [];
  let p = 0;
  let q = 0;
  while (q < size) {
    const caps = run(prog, s, q, false);
    if (caps === null || caps[0] >= size) break;
    const e = caps[1];
    if (e === p) { q = caps[0] + 1; continue; }
    out.push(s.slice(p, caps[0]));
    for (let k = 2; k < caps.length; k += 2) out.push(caps[k] >= 0 && caps[k + 1] >= 0 ? s.slice(caps[k], caps[k + 1]) : undefined);
    p = e;
    q = p;
  }
  out.push(s.slice(p));
  return out;
}

// An object a call site uses in place of its RegExp: exec and test, and the hooks that
// String.prototype.match, replace and split consult. search, matchAll and new RegExp(…) are refused:
// they would otherwise run outside the engine or give a wrong answer. Stateless, so one per expression is shared.
const WRAPS = new Map();
function wrap(re) {
  const key = `${re.flags}/${re.source}`;
  let w = WRAPS.get(key);
  if (w) return w;
  program(re);
  const refuse = (what) => () => { throw new Error(`linear_regex: ${what} is not supported on a wrapped expression`); };
  w = Object.freeze({
    get source() { return refuse("reading source")(); },
    get flags() { return refuse("reading flags")(); },
    exec: (value) => exec(re, value),
    test: (value) => test(re, value),
    [Symbol.match]: (value) => exec(re, value),
    [Symbol.replace]: (value, replacement) => replace(re, value, replacement),
    [Symbol.split]: (value, limit) => {
      if (limit !== undefined) throw new Error("linear_regex: split takes no limit");
      return split(re, value);
    },
    [Symbol.search]: refuse("search"),
    [Symbol.matchAll]: refuse("matchAll")
  });
  WRAPS.set(key, w);
  return w;
}

module.exports = { exec, test, replace, split, wrap };
