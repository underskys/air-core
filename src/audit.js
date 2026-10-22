const { collectEffectUsage } = require("./verifier");
const { collectGlobalDependencies, formatGlobalDependencies } = require("./global_deps");
const { assuranceProfileUnsupported, isTypedV053Ast } = require("./errors");

function auditModule(mod) {
  // R-ASSUR-1 floor (OPEN-30 (a): no typed parity in v0.53); no TypeError.
  if (isTypedV053Ast(mod)) throw assuranceProfileUnsupported("auditModule");
  const imports = new Set();
  const risks = [];
  const effects = new Map();
  let expandedOps = 0;
  let compactableOps = 0;
  const addEffect = (key) => effects.set(key, (effects.get(key) || 0) + 1);
  const addEffectAmount = (key, amount) => effects.set(key, (effects.get(key) || 0) + amount);

  for (const fn of mod.functions) {
    const consts = new Map();
    for (const constant of mod.constants || []) consts.set(constant.name, constantNumber(constant.value));
    for (const block of fn.blocks) {
      for (const ins of block.instructions) {
        expandedOps += 1;
        if (isCompactableInstruction(ins)) compactableOps += 1;
        if (ins.result && ins.op === "const.i32" && ins.args[0] && ins.args[0].kind === "number") consts.set(ins.result, ins.args[0].value);
        if (ins.op === "print") {
          imports.add("wasi_snapshot_preview1.fd_write");
          addEffect("stdio.print");
        }
        if (ins.op === "call") addEffect(ins.callee);
        if (ins.op === "loop.poll") {
          const callee = ins.args[0] && ins.args[0].kind === "function" ? ins.args[0].name : "loop.poll";
          const count = constNumberForArg(ins.args[2], consts);
          if (count === undefined) addEffect(`${callee}.dynamic`);
          else addEffectAmount(callee, count);
        }
        if (ins.op === "io.poll_bounded") {
          const count = constNumberForArg(ins.args[1], consts);
          if (count === undefined) addEffect("io.poll.dynamic");
          else addEffectAmount("io.poll", count);
        }
        if (ins.op === "alloc_region") {
          addEffect("memory.alloc");
        }
        if (ins.op === "free_region") addEffect("memory.free");
        if (ins.op.startsWith("load.") || ins.op === "buffer.load") addEffect("memory.load");
        if (ins.op.startsWith("store.") || ins.op === "buffer.store") addEffect("memory.store");
        if (ins.op === "mat4.store_f32") addEffectAmount("memory.store", 16);
        if (ins.op.startsWith("load.") || ins.op.startsWith("store.")) {
          risks.push(`${fn.name}:${block.label}: ${ins.op} depends on verifier-proven live region checks`);
        }
        if (ins.op === "mat4.store_f32") {
          risks.push(`${fn.name}:${block.label}: mat4.store_f32 writes 16 f32 values through a verifier-proven live region`);
        }
      }
    }
  }
  for (const ex of mod.externs || []) imports.add(ex.name);

  const lines = [];
  const verifiedUsage = collectEffectUsage(mod);
  const staticAllocationBytes = verifiedUsage.get("memory.static_alloc_bytes") || verifiedUsage.get("static_alloc_bytes") || 0;
  const dynamicAllocationSites = verifiedUsage.get("memory.dynamic_allocations") || verifiedUsage.get("dynamic_allocations") || 0;
  lines.push(`# Audit: ${mod.name}`);
  lines.push("");
  lines.push(`Uses: ${(mod.uses || []).map((use) => use.name).sort().join(", ") || "none"}`);
  lines.push(`Capabilities: ${Array.from(mod.capabilities).sort().join(", ") || "none"}`);
  lines.push(`Imports: ${Array.from(imports).sort().join(", ") || "none"}`);
  lines.push(`Expanded imports: ${Array.from(mod.externs || []).map((ex) => ex.name).sort().join(", ") || "none"}`);
  lines.push(`Constants: ${formatConstants(mod.constants || [])}`);
  lines.push(`Static tables: ${formatTables(mod.tables || [])}`);
  lines.push(`Mutable globals: ${(mod.globals || []).map((global) => `${global.name}:${global.type}`).join(", ") || "none"}`);
  lines.push(...formatGlobalDependencies(collectGlobalDependencies(mod)));
  lines.push(`Estimated static allocation: ${staticAllocationBytes} bytes`);
  lines.push(`Dynamic allocation sites: ${dynamicAllocationSites}`);
  lines.push(`Effect budgets: ${(mod.effects || []).map((effect) => `${effect.key}${effect.op || "<="}${effect.limit}`).join(", ") || "none"}`);
  lines.push(`Requires: ${(mod.requires || []).map(formatContract).join(", ") || "none"}`);
  lines.push(`Ensures: ${(mod.ensures || []).map(formatContract).join(", ") || "none"}`);
  lines.push(`Effect usage: ${Array.from(effects.entries()).sort().map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
  lines.push(`Budget usage upper bound: ${formatUsage(verifiedUsage)}`);
  if (verifiedUsage.has("effects.dynamic")) {
    lines.push("Budget note: dynamic loop counts are verified against their maximum runtime bound, not treated as exact counts.");
  }
  lines.push(`Operation shape: compactable=${compactableOps}, expanded=${expandedOps}`);
  const resourceUsage = verifiedUsage;
  const resourceKeys = Array.from(resourceUsage.entries())
    .filter(([key]) => key.startsWith("cpu.") || key.startsWith("gpu.") || key.startsWith("memory.") || key === "static_alloc_bytes" || key === "static_readonly_bytes" || key === "dynamic_allocations")
    .sort();
  lines.push(`Resource usage: ${resourceKeys.map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
  const functionContracts = [];
  for (const fn of mod.functions || []) {
    if ((fn.effects || []).length || (fn.requires || []).length || (fn.ensures || []).length) {
      functionContracts.push(
        `${fn.name}: effects=${(fn.effects || []).map((effect) => `${effect.key}${effect.op || "<="}${effect.limit}`).join("|") || "none"}; requires=${(fn.requires || []).map(formatContract).join("|") || "none"}; ensures=${(fn.ensures || []).map(formatContract).join("|") || "none"}`
      );
    }
  }
  lines.push(`Function contracts: ${functionContracts.join("; ") || "none"}`);
  lines.push("");
  lines.push("Memory risks:");
  if (risks.length === 0) {
    lines.push("- none detected in AIR-level memory operations");
  } else {
    for (const risk of risks) lines.push(`- ${risk}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatUsage(usage) {
  return Array.from(usage.entries())
    .sort()
    .map(([key, value]) => `${key}=${value}`)
    .join(", ") || "none";
}

function constNumberForArg(arg, consts) {
  if (!arg) return undefined;
  if (arg.kind === "number") return arg.value;
  if (arg.kind === "value") return consts.get(arg.name);
  if (arg.kind === "symbol") return consts.get(arg.name);
  return undefined;
}

function constantNumber(value) {
  if (!value) return undefined;
  if (value.kind === "bool") return value.value ? 1 : 0;
  if (value.kind === "number") return value.value;
  return undefined;
}

function formatConstants(constants) {
  return constants.map((constant) => `${constant.name}:${constant.type}=${formatConstantValue(constant.value)}`).join(", ") || "none";
}

function formatTables(tables) {
  return tables.map((table) => `${table.name}:${table.type}[${table.length}]`).join(", ") || "none";
}

function formatConstantValue(value) {
  if (!value) return "?";
  if (value.kind === "bool") return value.raw || (value.value ? "true" : "false");
  if (value.kind === "number") return value.raw || String(value.value);
  return "?";
}

function isCompactableInstruction(ins) {
  if (ins.op === "call") return true;
  if (ins.op.startsWith("const.")) return true;
  return Boolean(aliasForOp(ins.op, ins.resultType));
}

function aliasForOp(op, resultType) {
  if (resultType === "i32") return ["i32.add", "i32.sub", "i32.mul"].includes(op);
  if (resultType === "f32") return ["f32.add", "f32.sub", "f32.mul", "f32.div", "f32.min", "f32.max", "f32.clamp", "f32.lerp"].includes(op);
  return false;
}

function formatContract(contract) {
  if (contract.kind === "capability") return `capability ${contract.capability}`;
  if (contract.kind === "no-capability") return `no capability ${contract.capability}`;
  if (contract.kind === "export") return `export ${contract.name}`;
  if (contract.kind === "param") return `param ${contract.name}${contract.op || "<="}${contract.value}`;
  if (contract.kind === "return") return `return${contract.op || "<="}${contract.value}`;
  return `${contract.key}${contract.op || "<="}${contract.limit}`;
}

module.exports = { auditModule };
