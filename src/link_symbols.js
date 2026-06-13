const crypto = require("crypto");
const path = require("path");

const SYMBOL_SCHEMA_VERSION = "0.16";

const CATEGORY_TAGS = {
  function: "fn",
  global: "global",
  table: "table",
  staticTable: "table",
  hostImport: "host",
  packageExport: "export",
  generatedModule: "generated"
};

function canonicalizeModulePath(modulePath) {
  const raw = String(modulePath || "");
  if (!raw.trim()) throw new Error("module path is empty");
  if (raw.includes("\0")) throw new Error(`unsafe module path contains null byte: ${raw}`);
  const slashed = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(slashed) || slashed.startsWith("/")) {
    throw new Error(`absolute module path is not allowed: ${raw}`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(slashed)) {
    throw new Error(`remote module path is not allowed: ${raw}`);
  }
  const normalized = path.posix.normalize(slashed);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`module path escapes package root: ${raw}`);
  }
  if (normalized.includes("/../")) {
    throw new Error(`module path escapes package root: ${raw}`);
  }
  return normalized.replace(/^\.\//, "");
}

function moduleIdForPath(modulePath) {
  const canonical = canonicalizeModulePath(modulePath);
  const withoutExtension = canonical.replace(/\.air$/i, "");
  const safe = sanitizeIdentifier(withoutExtension, "module");
  const hash = shortHash(canonical);
  return `${safe}$${hash}`;
}

function symbolKey(modulePath, kind, sourceName) {
  const canonical = canonicalizeModulePath(modulePath);
  return `${canonical}\0${canonicalSymbolKind(kind)}\0${String(sourceName || "")}`;
}

function mangleSymbol(modulePath, kind, sourceName) {
  const canonical = canonicalizeModulePath(modulePath);
  const symbolKind = canonicalSymbolKind(kind);
  const tag = CATEGORY_TAGS[symbolKind];
  if (!tag) throw new Error(`unsupported symbol kind: ${kind}`);
  const moduleId = moduleIdForPath(canonical);
  const namePart = sanitizeIdentifier(sourceName || "anonymous", "symbol");
  const hash = shortHash(`${canonical}\0${symbolKind}\0${String(sourceName || "")}`);
  return `__air$${moduleId}$${tag}$${namePart}$${hash}`;
}

function createSymbolEntry(input) {
  const modulePath = canonicalizeModulePath(input.modulePath || input.module);
  const kind = canonicalSymbolKind(input.kind);
  const sourceName = String(input.sourceName || input.name || "");
  return {
    kind,
    module: modulePath,
    moduleId: moduleIdForPath(modulePath),
    sourceName,
    mangledName: mangleSymbol(modulePath, kind, sourceName)
  };
}

class SymbolRegistry {
  constructor() {
    this.entries = [];
    this.byKey = new Map();
    this.byMangled = new Map();
  }

  add(input) {
    const entry = {
      ...createSymbolEntry(input),
      ...withoutIdentityFields(input)
    };
    const key = symbolKey(entry.module, entry.kind, entry.sourceName);
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const collision = this.byMangled.get(entry.mangledName);
    if (collision) {
      throw new Error(`symbol collision: ${entry.mangledName}`);
    }
    this.byKey.set(key, entry);
    this.byMangled.set(entry.mangledName, entry);
    this.entries.push(entry);
    return entry;
  }

  get(modulePath, kind, sourceName) {
    return this.byKey.get(symbolKey(modulePath, kind, sourceName)) || null;
  }

  list() {
    return this.entries.slice().sort(compareSymbolEntry);
  }
}

function buildSymbolMap(entries) {
  const registry = new SymbolRegistry();
  for (const entry of entries || []) registry.add(entry);
  return registry.list();
}

function compareSymbolEntry(a, b) {
  return a.module.localeCompare(b.module) ||
    a.kind.localeCompare(b.kind) ||
    a.sourceName.localeCompare(b.sourceName) ||
    a.mangledName.localeCompare(b.mangledName);
}

function canonicalSymbolKind(kind) {
  if (kind === "staticTable") return "table";
  const value = String(kind || "");
  if (!CATEGORY_TAGS[value]) throw new Error(`unsupported symbol kind: ${kind}`);
  return value;
}

function sanitizeIdentifier(value, fallback) {
  const safe = String(value || "")
    .replace(/\.air$/i, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const withFallback = safe || fallback;
  return /^[0-9]/.test(withFallback) ? `_${withFallback}` : withFallback;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
}

function withoutIdentityFields(input) {
  const out = { ...input };
  delete out.modulePath;
  delete out.module;
  delete out.kind;
  delete out.sourceName;
  delete out.name;
  delete out.mangledName;
  delete out.moduleId;
  return out;
}

module.exports = {
  SYMBOL_SCHEMA_VERSION,
  SymbolRegistry,
  buildSymbolMap,
  canonicalizeModulePath,
  canonicalSymbolKind,
  compareSymbolEntry,
  createSymbolEntry,
  mangleSymbol,
  moduleIdForPath,
  symbolKey
};
