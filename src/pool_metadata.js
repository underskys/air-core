const path = require("path");
const { collectEffectUsage } = require("./verifier");
const { scalarByteWidth } = require("./types");

function poolMetadata(mod, options = {}) {
  const usage = options.usage || safeUsage(mod);
  return (mod.pools || []).map((pool) => {
    const fields = (pool.fields || []).map((field) => {
      const byteWidth = scalarByteWidth(field.type) || 0;
      return {
        name: field.name,
        type: field.type,
        byteWidth,
        byteSize: (pool.capacity || 0) * byteWidth,
        initializer: initializerSummary(field.init)
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const storageFootprint = fields.reduce((sum, field) => sum + field.byteSize, 0);
    return {
      name: pool.name,
      ownerModule: options.modulePath || mod.name,
      module: options.modulePath || mod.name,
      capacity: pool.capacity,
      fieldCount: fields.length,
      fields,
      activeField: pool.activeField || "active",
      storageFootprint,
      staticBytes: storageFootprint,
      readBudget: poolBudget(mod, "pool.read"),
      writeBudget: poolBudget(mod, "pool.write"),
      moduleObservedReads: usage.get("pool.read") || 0,
      moduleObservedWrites: usage.get("pool.write") || 0,
      generatedArtifactStatus: "derived-not-required",
      diagnostics: [],
      source: poolSource(pool),
      origin: poolOrigin(pool)
    };
  }).sort((a, b) => String(a.module).localeCompare(String(b.module)) || a.name.localeCompare(b.name));
}

function poolSummary(mod, options = {}) {
  const pools = poolMetadata(mod, options);
  return {
    count: pools.length,
    names: pools.map((pool) => pool.name).sort(),
    totalStaticBytes: pools.reduce((sum, pool) => sum + pool.staticBytes, 0)
  };
}

function poolBudget(mod, key) {
  const budget = (mod.effects || []).find((item) => item.key === key);
  if (!budget) return null;
  return { key: budget.key, op: budget.op || "<=", limit: budget.limit };
}

function initializerSummary(value) {
  if (!value) return null;
  if (value.kind === "bool") return { kind: "literal", type: "bool", value: Boolean(value.value) };
  if (value.kind === "number") return { kind: "literal", type: "i32", value: value.value };
  return { kind: value.kind || "unknown", value: null };
}

function safeUsage(mod) {
  try {
    return collectEffectUsage(mod);
  } catch (_) {
    return new Map();
  }
}

function poolOrigin(pool) {
  const file = pool && pool.loc && pool.loc.file ? pool.loc.file.replace(/\\/g, "/") : "";
  return /(^|\/)generated\//.test(file) ? "generated" : "manual";
}

function poolSource(pool) {
  const file = pool && pool.loc && pool.loc.file ? pool.loc.file : null;
  if (!file) return null;
  return path.normalize(file).replace(/\\/g, "/");
}

module.exports = {
  poolMetadata,
  poolSummary
};
