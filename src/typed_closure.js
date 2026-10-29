"use strict";

// typed-v0.53 P0-09 (AIR-0053-P0-09-0001; slice text R2.5, P9-R1..P9-R30;
// docs/v0.53/P0_09_IMPORTS.md): the typed import closure. A root module's
// `use "<path>" as <alias>` lines name package-relative modules; this file
// resolves them (P9-R5), reads the closure with an explicit worklist (P9-R6),
// applies the per-module and closure intake limits in a fixed order (P9-R8),
// refuses cycles (P9-R7), measures the closure (P9-R9), orders the modules
// for verification and linking (P9-R10, P9-R18) and gives each module its
// identity (P9-R15). The imported modules live in side tables keyed by the
// root AST, so a module's own AST, its node count and every earlier output
// are unchanged (P9-R10). A text without `use` never reaches the file system.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { AirError } = require("./errors");
const { AnalysisRefusedError, enforceAnalysisCapacity, measureTypedModule, normalizeAnalysisCapacity } = require("./analysis_capacity");

// D-VAL-24 (OPEN-36 (a)): the closure totals, each over the unique modules.
// A runtime host can lower them (closureLimits), never raise them.
const TYPED_CLOSURE_LIMITS = Object.freeze({ maxClosureAstNodes: 262144, maxClosureModules: 64, maxClosureSourceBytes: 1048576 });
const CLOSURE_LIMIT_KEYS = Object.freeze(Object.keys(TYPED_CLOSURE_LIMITS));

// P9-R2: the literal path grammar; P9-R5 and P9-R26: a name and a module key.
const USE_PATH = /^\.\.?(?:\/[A-Za-z0-9_.-]+)*\/[A-Za-z0-9_.-]+\.air$/;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const MODULE_KEY = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.air$/;
const MAX_LINKS = 40;
const MAX_MAP_ENTRIES = 64;
const PROFILE = "typed-v0.53";
const IDENTITY_DOMAIN = "AIR_TYPED_MODULE_IDENTITY_V1";

const CLOSURES = new WeakMap();
const MODULES = new WeakMap();

class ClosureIntakeError extends AirError {
  constructor(code, scope, measure, required, limit, moduleKey) {
    super(`${code}: INTAKE_REFUSED ${scope} ${measure} ${required} exceed the configured limit of ${limit} at module '${moduleKey}'`);
    this.name = "ClosureIntakeError";
    this.disposition = "INTAKE_REFUSED";
    this.fields = Object.freeze({ limit, measure, module: moduleKey, required, scope });
  }
}

function importError(message, file, line) {
  return new AirError(message, { file, line });
}

// P9-R5: a `use` path, joined to the importing module's key directory and
// normalized lexically. A path that leaves the package root has no key.
function resolveKey(importerKey, literal) {
  const parts = path.posix.dirname(importerKey) === "." ? [] : path.posix.dirname(importerKey).split("/");
  return normalizeParts(parts, literal.split("/"));
}

function normalizeParts(base, segments) {
  const parts = base.slice();
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length ? parts.join("/") : null;
}

// P9-R26: the typed-v0.53 build input key `modules` and `sourceName` with it.
function validateModuleMap(modules, sourceName, maxSourceNameBytes, code, fail) {
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) fail(code, "modules must be a plain object of module keys to source text");
  const prototype = Object.getPrototypeOf(modules);
  if (prototype !== Object.prototype && prototype !== null) fail(code, "modules must be a plain object of module keys to source text");
  const keys = Object.keys(modules);
  if (keys.length < 1 || keys.length > MAX_MAP_ENTRIES) fail(code, `modules must hold 1 through ${MAX_MAP_ENTRIES} entries`);
  for (const key of keys) {
    if (!isModuleKey(key, maxSourceNameBytes)) fail(code, `modules key '${key}' is not a module key`);
    const value = modules[key];
    if (typeof value !== "string" || !value || !/^[\x00-\x7f]*$/.test(value)) fail(code, `modules['${key}'] must be non-empty ASCII source text`);
  }
  if (typeof sourceName !== "string" || !isModuleKey(sourceName, maxSourceNameBytes)) {
    fail(code, "sourceName must be the root module's key when modules is given");
  }
  if (Object.prototype.hasOwnProperty.call(modules, sourceName)) fail(code, `sourceName '${sourceName}' is the root and must not be a key of modules`);
}

function isModuleKey(key, maxBytes) {
  return typeof key === "string" && MODULE_KEY.test(key) && Buffer.byteLength(key, "utf8") <= maxBytes &&
    key.split("/").every((segment) => segment !== "." && segment !== "..");
}

// P9-R26: the runtime option `closureLimits`; each key optional, from 1
// through its default.
function normalizeClosureLimits(value, fail) {
  if (value === undefined) return TYPED_CLOSURE_LIMITS;
  const code = "air.v052.runtime_limits_invalid";
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, "closureLimits must be a plain object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code, "closureLimits must be a plain object");
  const out = { ...TYPED_CLOSURE_LIMITS };
  for (const key of Object.keys(value)) {
    if (!CLOSURE_LIMIT_KEYS.includes(key)) fail(code, `closureLimits has unknown key '${key}'`);
    const limit = value[key];
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > TYPED_CLOSURE_LIMITS[key]) {
      fail(code, `closureLimits.${key} must be an integer from 1 through ${TYPED_CLOSURE_LIMITS[key]}`);
    }
    out[key] = limit;
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// Packages (P9-R5, P9-R26): the root file's directory on a file entrypoint,
// the caller's module map on the builder and the runtime, or none (a `<…>`
// label, or a builder input without `modules`).

function filePackage(file) {
  const absolute = path.resolve(file);
  const rootDir = path.dirname(absolute);
  let realRoot = null;
  return {
    file,
    rootKey: path.basename(absolute),
    rootUsable() {
      const name = path.basename(absolute);
      if (!SEGMENT.test(name)) return false;
      try {
        return fs.readdirSync(rootDir).includes(name) && fs.lstatSync(absolute).isFile();
      } catch (_) {
        return false;
      }
    },
    resolve(key) {
      return walkPackage(rootDir, () => {
        if (realRoot === null) realRoot = fs.realpathSync.native(rootDir);
        return realRoot;
      }, key);
    },
    read(found) {
      return fs.readFileSync(found.file).toString("utf8");
    }
  };
}

function mapPackage(modules, rootKey) {
  return {
    file: rootKey,
    rootKey,
    rootUsable: () => true,
    resolve: (key) => (modules && Object.prototype.hasOwnProperty.call(modules, key) ? { key } : { code: "air.import.not_found" }),
    read: (found) => modules[found.key]
  };
}

// P9-R5 step 2 and 3: from the root, one name at a time, without following
// links. A name must be spelled exactly as a directory entry before it is
// tested as a link; a link's target text replaces it (relative to the link's
// directory; an absolute target only inside the root's real path), and a
// target outside the root is path_uncontained whether or not it exists.
function walkPackage(rootDir, realRoot, key) {
  const NOT_FOUND = { code: "air.import.not_found" };
  const UNCONTAINED = { code: "air.import.path_uncontained" };
  let parts = key.split("/");
  let links = 0;
  for (;;) {
    let dir = rootDir;
    let restarted = false;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      if (!SEGMENT.test(name)) return NOT_FOUND;
      let entries;
      try { entries = fs.readdirSync(dir); } catch (_) { return NOT_FOUND; }
      if (!entries.includes(name)) return NOT_FOUND;
      const full = path.join(dir, name);
      let info;
      try { info = fs.lstatSync(full); } catch (_) { return NOT_FOUND; }
      if (info.isSymbolicLink()) {
        links += 1;
        if (links > MAX_LINKS) return NOT_FOUND;
        let target;
        try { target = fs.readlinkSync(full); } catch (_) { return NOT_FOUND; }
        let base;
        let segments;
        if (path.isAbsolute(target)) {
          const prefix = `${realRoot()}/`;
          if (!target.startsWith(prefix)) return UNCONTAINED;
          base = [];
          segments = target.slice(prefix.length).split("/");
        } else {
          base = parts.slice(0, index);
          segments = target.split("/");
        }
        const next = normalizeParts(base, [...segments, ...parts.slice(index + 1)]);
        if (next === null) return UNCONTAINED;
        parts = next.split("/");
        restarted = true;
        break;
      }
      if (index < parts.length - 1) {
        if (!info.isDirectory()) return NOT_FOUND;
        dir = full;
        continue;
      }
      return info.isFile() ? { file: full } : NOT_FOUND;
    }
    if (!restarted) return NOT_FOUND;
  }
}

// ---------------------------------------------------------------------------
// The loader (P9-R5..P9-R10).

function nodeCount(mod) {
  return require("./v052_verified_build").verifiedTypedAstNodeCount(mod);
}

function moduleLimits(limits) {
  const defaults = require("./v052_verified_build").VERIFIED_TYPED_RUNTIME_LIMITS;
  return {
    maxAstNodes: limits && limits.maxAstNodes !== undefined ? limits.maxAstNodes : defaults.maxAstNodes,
    maxSourceBytes: limits && limits.maxSourceBytes !== undefined ? limits.maxSourceBytes : defaults.maxSourceBytes
  };
}

function newCounters() {
  return { measure: 0, parse: 0, read: 0, summarize: 0, verify: 0 };
}

// P9-R4: an imported text that typed-v0.53 refuses but the legacy parser
// (without import resolution) or typed-v0.51 reads is another profile.
function parsesAsOtherProfile(source, key) {
  const parser = require("./parser");
  try {
    parser.parseAir(source, key, { resolveSourceImports: false });
    return true;
  } catch (_) { /* not legacy-v0.50 */ }
  try {
    parser.parseV051TypedAir(source, key);
    return true;
  } catch (_) {
    return false;
  }
}

// Loads the closure of a parsed root module. `pkg` is the package, `rootFile`
// the root's position name, and `settings` the closure limits, the per-module
// limits and the caller's analysis capacity. A root without `use` returns at
// once, with no side table and no file-system access.
function loadClosure(root, rootSource, pkg, settings = {}) {
  if (!root || !Array.isArray(root.uses) || !root.uses.length) return null;
  const parser = require("./parser");
  const closureLimits = settings.closureLimits || TYPED_CLOSURE_LIMITS;
  const perModule = moduleLimits(settings.limits);
  const rootKey = pkg.rootKey;
  const rootFile = pkg.file;
  const records = new Map();
  const counters = new Map();
  const totals = { astNodes: 0, modules: 0, sourceBytes: 0 };
  const edges = [];

  const discover = (key) => {
    totals.modules += 1;
    if (totals.modules > closureLimits.maxClosureModules) {
      throw new ClosureIntakeError("air.v052.work_limit_modules", "closure", "modules", totals.modules, closureLimits.maxClosureModules, key);
    }
  };
  const admitBytes = (key, bytes) => {
    if (bytes > perModule.maxSourceBytes) {
      throw new ClosureIntakeError("air.v052.work_limit_source_bytes", "module", "source bytes", bytes, perModule.maxSourceBytes, key);
    }
    totals.sourceBytes += bytes;
    if (totals.sourceBytes > closureLimits.maxClosureSourceBytes) {
      throw new ClosureIntakeError("air.v052.work_limit_source_bytes", "closure", "source bytes", totals.sourceBytes, closureLimits.maxClosureSourceBytes, key);
    }
  };
  const admitNodes = (key, mod) => {
    const nodes = nodeCount(mod);
    if (nodes > perModule.maxAstNodes) {
      throw new ClosureIntakeError("air.v052.work_limit_ast_nodes", "module", "parsed AST nodes", nodes, perModule.maxAstNodes, key);
    }
    totals.astNodes += nodes;
    if (totals.astNodes > closureLimits.maxClosureAstNodes) {
      throw new ClosureIntakeError("air.v052.work_limit_ast_nodes", "closure", "parsed AST nodes", totals.astNodes, closureLimits.maxClosureAstNodes, key);
    }
    return nodes;
  };

  // The root: discovered, read and parsed by its entrypoint.
  discover(rootKey);
  counters.set(rootKey, { ...newCounters(), parse: 1, read: 1 });
  const rootBytes = Buffer.byteLength(rootSource, "utf8");
  admitBytes(rootKey, rootBytes);
  admitNodes(rootKey, root);
  records.set(rootKey, { ast: root, bytes: rootBytes, file: rootFile, imports: new Map(), key: rootKey, source: rootSource, uses: [] });
  if (!pkg.rootUsable()) {
    throw importError(`air.import.not_found: the root '${rootKey}' is not an entry of its directory spelled exactly, so its imports cannot be resolved`, rootFile, root.uses[0].line);
  }

  const queue = [rootKey];
  const found = new Map();
  while (queue.length) {
    const key = queue.shift();
    const record = records.get(key);
    if (!record.ast) {
      const source = pkg.read(found.get(key));
      counters.get(key).read += 1;
      const bytes = Buffer.byteLength(source, "utf8");
      admitBytes(key, bytes);
      let mod;
      try {
        mod = parser.typedV053.parse(source, key);
      } catch (error) {
        if (parsesAsOtherProfile(source, key)) {
          throw importError(`air.import.profile_mismatch: '${key}' is not a typed-v0.53 module; a typed-v0.53 module imports typed-v0.53 modules only`, record.importer.file, record.importer.line);
        }
        throw error;
      }
      counters.get(key).parse += 1;
      admitNodes(key, mod);
      Object.assign(record, { ast: mod, bytes, source });
    }
    // P9-R5: this module's `use` lines in line order; the first failing one
    // is reported. Containment is lexical; a key this module already imports
    // is duplicate_module; then the package is asked.
    const imported = new Set();
    const fresh = [];
    for (const use of record.ast.uses || []) {
      const target = resolveKey(key, use.path);
      if (target === null) {
        throw importError(`air.import.path_uncontained: '${use.path}' leaves the package root`, record.file, use.line);
      }
      if (imported.has(target)) {
        throw importError(`air.import.duplicate_module: '${use.path}' names the module '${target}', which this module already imports`, record.file, use.line);
      }
      imported.add(target);
      if (!records.has(target)) {
        const resolution = pkg.resolve(target);
        if (resolution.code === "air.import.path_uncontained") {
          throw importError(`air.import.path_uncontained: '${use.path}' leads outside the package root through a symbolic link`, record.file, use.line);
        }
        if (resolution.code) throw importError(`air.import.not_found: no module '${target}' in the package`, record.file, use.line);
        if (!found.has(target)) found.set(target, resolution);
        if (!fresh.includes(target)) fresh.push(target);
      }
      record.imports.set(use.alias, target);
      record.uses.push({ alias: use.alias, line: use.line, target });
      edges.push({ from: key, line: use.line, to: target });
    }
    // P9-R6: new keys in ascending order, each discovered once.
    for (const target of fresh.sort(compareAscii)) {
      if (records.has(target)) continue;
      discover(target);
      counters.set(target, newCounters());
      records.set(target, { ast: null, file: target, importer: { file: record.file, line: record.uses.find((use) => use.target === target).line }, imports: new Map(), key: target, uses: [] });
      queue.push(target);
    }
  }

  const cycle = firstCycleLine(records, edges);
  if (cycle) throw importError(`air.import.cycle: '${cycle.from}' and '${cycle.to}' import each other through a cycle`, records.get(cycle.from).file, cycle.line);

  const order = reverseTopologicalOrder(records);
  const identities = new Map();
  for (const key of order) {
    const record = records.get(key);
    const dependencies = [...new Set([...record.imports.values()].map((target) => identities.get(target)))].sort(compareAscii);
    identities.set(key, moduleIdentity(sourceDigest(record.source), dependencies));
  }
  const closure = {
    counters,
    edges,
    identities,
    order,
    records,
    root,
    rootKey,
    totals: Object.freeze({ ...totals }),
    analyses: new Map(),
    verified: new Set()
  };
  closure.measures = closureMeasures(closure);
  CLOSURES.set(root, closure);
  for (const key of order) MODULES.set(records.get(key).ast, { closure, key });
  enforceClosureMeasures(closure.measures, settings.analysisCapacity);
  return closure;
}

// P9-R7: the strongly connected components (iterative Tarjan, modules in
// key order). The failure is at the first `use` line, in (module key, line)
// order, whose importer and target lie in one cyclic component.
function firstCycleLine(records, edges) {
  const keys = [...records.keys()].sort(compareAscii);
  const targets = new Map(keys.map((key) => [key, [...new Set(edges.filter((edge) => edge.from === key).map((edge) => edge.to))].sort(compareAscii)]));
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const component = new Map();
  let counter = 0;
  let componentId = 0;
  for (const start of keys) {
    if (index.has(start)) continue;
    const work = [{ key: start, next: 0 }];
    index.set(start, counter); low.set(start, counter); counter += 1;
    stack.push(start); onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const list = targets.get(frame.key);
      if (frame.next < list.length) {
        const target = list[frame.next++];
        if (!index.has(target)) {
          index.set(target, counter); low.set(target, counter); counter += 1;
          stack.push(target); onStack.add(target);
          work.push({ key: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.key, Math.min(low.get(frame.key), index.get(target)));
        }
        continue;
      }
      work.pop();
      if (work.length) low.set(work[work.length - 1].key, Math.min(low.get(work[work.length - 1].key), low.get(frame.key)));
      if (low.get(frame.key) === index.get(frame.key)) {
        for (;;) {
          const member = stack.pop();
          onStack.delete(member);
          component.set(member, componentId);
          if (member === frame.key) break;
        }
        componentId += 1;
      }
    }
  }
  const sizes = new Map();
  for (const id of component.values()) sizes.set(id, (sizes.get(id) || 0) + 1);
  const cyclic = edges.filter((edge) => component.get(edge.from) === component.get(edge.to) &&
    (sizes.get(component.get(edge.from)) > 1 || edge.from === edge.to));
  cyclic.sort((left, right) => compareAscii(left.from, right.from) || left.line - right.line);
  return cyclic.length ? cyclic[0] : null;
}

// P9-R10, P9-R18: dependencies first; among the modules whose imports are
// all placed, the smallest key first.
function reverseTopologicalOrder(records) {
  const placed = new Set();
  const order = [];
  const keys = [...records.keys()].sort(compareAscii);
  while (order.length < keys.length) {
    const next = keys.find((key) => !placed.has(key) && [...records.get(key).imports.values()].every((target) => placed.has(target)));
    placed.add(next);
    order.push(next);
  }
  return order;
}

function sourceDigest(source) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(source, "utf8")).digest("hex")}`;
}

// P9-R15 (OPEN-33 (c)): mid(m) over the raw body digest, the sorted unique
// identities of the direct imports and the profile; a WorkBound-internal
// digest domain, never a PackageIdentityV1 domain (P9-R17).
function moduleIdentity(bodyDigest, dependencies) {
  const record = JSON.stringify({ body_digest: bodyDigest, dependencies, profile: PROFILE });
  const hash = crypto.createHash("sha256");
  hash.update(Buffer.from(IDENTITY_DOMAIN, "utf8"));
  hash.update(Buffer.from([0]));
  hash.update(Buffer.from(record, "utf8"));
  return `mid-${hash.digest("hex")}`;
}

// P9-R9 (R-WB-15c): each module once; every `use` is one declaration and one
// import edge. For a module without `use` this is measureTypedModule's.
function closureMeasures(closure) {
  let units = 0;
  let callSites = 0;
  let callbackRefs = 0;
  let importEdges = 0;
  let depth = 0;
  for (const key of closure.order) {
    const mod = closure.records.get(key).ast;
    const own = measureTypedModule(mod);
    closure.counters.get(key).measure += 1;
    const uses = Array.isArray(mod.uses) ? mod.uses.length : 0;
    units += own.analysis_units + 2 * uses;
    callSites += own.call_sites;
    callbackRefs += own.callback_refs;
    importEdges += uses;
    if (own.nesting_depth > depth) depth = own.nesting_depth;
  }
  return Object.freeze({ analysis_units: units, call_sites: callSites, callback_refs: callbackRefs, import_edges: importEdges, nesting_depth: depth });
}

function enforceClosureMeasures(measures, capacityInput) {
  const capacity = normalizeAnalysisCapacity(capacityInput);
  if (measures.analysis_units > capacity.maxAnalysisUnits) {
    throw new AnalysisRefusedError("analysis_units", measures.analysis_units, capacity.maxAnalysisUnits);
  }
  if (measures.nesting_depth > capacity.maxSyntaxNestingDepth) {
    throw new AnalysisRefusedError("nesting_depth", measures.nesting_depth, capacity.maxSyntaxNestingDepth);
  }
}

// P9-R26b: the caller's capacity over the closure measure; for a module
// without a closure, the module's own measure (the base's check).
function enforceCapacity(mod, capacityInput) {
  const closure = CLOSURES.get(mod);
  if (!closure) return enforceAnalysisCapacity(mod, capacityInput);
  return enforceClosureMeasures(closure.measures, capacityInput);
}

// ---------------------------------------------------------------------------
// Entrypoints.

// The SDK parse (src/source_profile.js): the root with the same parser, then,
// for a text with `use`, the closure from the file's directory (a `<…>`
// label is an empty package), with the default closure limits and the
// caller's analysis capacity.
function parseTypedV053Closure(source, file, options = {}) {
  const parser = require("./parser");
  const mod = parser.typedV053.parse(source, file);
  if (!Array.isArray(mod.uses) || !mod.uses.length) return mod;
  const label = typeof file !== "string" || !file || file.startsWith("<");
  const pkg = label ? mapPackage(null, file) : filePackage(file);
  if (label) pkg.file = file;
  loadClosure(mod, source, pkg, { analysisCapacity: options && options.analysisCapacity });
  return mod;
}

// The builder and the runtime: the module map (P9-R26), `sourceName` the
// root's key. Without `modules` the package is the root alone.
function loadMapClosure(mod, source, modules, sourceName, settings) {
  if (!Array.isArray(mod.uses) || !mod.uses.length) return null;
  return loadClosure(mod, source, mapPackage(modules || null, sourceName), settings);
}

function closureOf(mod) {
  return CLOSURES.get(mod) || null;
}

// The closure a module AST belongs to, with its key; null for a module
// without imports that is no closure's member.
function moduleContext(mod) {
  return MODULES.get(mod) || null;
}

// alias → the imported module's AST, for one module of a closure.
function importsOf(mod) {
  const context = MODULES.get(mod);
  if (!context) return null;
  const record = context.closure.records.get(context.key);
  const out = new Map();
  for (const [alias, key] of record.imports) out.set(alias, { ast: context.closure.records.get(key).ast, key });
  return out;
}

function countOnce(mod, counter) {
  const context = MODULES.get(mod);
  if (!context) return;
  const counters = context.closure.counters.get(context.key);
  if (counters[counter] === 0) counters[counter] = 1;
}

// The per-module counters of P9-R10 (card exact_evidence), by module key.
function closureCounters(mod) {
  const closure = CLOSURES.get(mod);
  if (!closure) return null;
  const out = {};
  for (const key of [...closure.counters.keys()].sort(compareAscii)) out[key] = { ...closure.counters.get(key) };
  return out;
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

module.exports = {
  ClosureIntakeError,
  TYPED_CLOSURE_LIMITS,
  USE_PATH,
  closureCounters,
  closureOf,
  countOnce,
  enforceCapacity,
  importsOf,
  loadMapClosure,
  moduleContext,
  moduleIdentity,
  normalizeClosureLimits,
  parseTypedV053Closure,
  sourceDigest,
  validateModuleMap
};
