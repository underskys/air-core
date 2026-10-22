const { formatArg } = require("./format");
const { collectGlobalDependencies, formatGlobalDependencies } = require("./global_deps");
const { assuranceProfileUnsupported, isTypedV053Ast } = require("./errors");

function explainModule(mod) {
  // R-ASSUR-1 floor (OPEN-30 (a): no typed parity in v0.53); no TypeError.
  if (isTypedV053Ast(mod)) throw assuranceProfileUnsupported("explainModule");
  const lines = [];
  lines.push(`# ${mod.name}`);
  lines.push("");
  lines.push(`Capabilities: ${Array.from(mod.capabilities).sort().join(", ") || "none"}`);
  if ((mod.constants || []).length) {
    lines.push(`Constants: ${mod.constants.map((constant) => `${constant.name}: ${constant.type} = ${formatArg(constant.value)}`).join(", ")}`);
  }
  if ((mod.tables || []).length) {
    lines.push(`Static tables: ${mod.tables.map((table) => `${table.name}: ${table.type}[${table.length}]`).join(", ")}`);
  }
  if ((mod.externs || []).length) {
    lines.push(`Host imports: ${mod.externs.map((ex) => ex.name).join(", ")}`);
  }
  if ((mod.globals || []).length) {
    lines.push(`Mutable globals: ${mod.globals.map((global) => `${global.name}: ${global.type}`).join(", ")}`);
  }
  lines.push(...formatGlobalDependencies(collectGlobalDependencies(mod)));
  lines.push("");
  for (const fn of mod.functions) {
    const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ") || "none";
    lines.push(`Function ${fn.name}(${params}) -> ${fn.returnType}`);
    for (const block of fn.blocks) {
      lines.push(`- block ${block.label}`);
      for (const ins of block.instructions) lines.push(`  - ${explainInstruction(ins)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function explainInstruction(ins) {
  if (ins.op === "const.str") return `${ins.result} is a constant byte slice ${formatArg(ins.args[0])}`;
  if (ins.op.startsWith("const.")) return `${ins.result} is ${formatArg(ins.args[0])}`;
  if (ins.op === "print") return `writes ${formatArg(ins.args[0])} to stdout through WASI`;
  if (ins.op === "return") return `returns ${ins.args.map(formatArg).join(", ") || "void"}`;
  if (ins.op === "call") return `${ins.result || "call"} invokes @${ins.callee}`;
  if (ins.op === "table.get") return `${ins.result} reads ${formatArg(ins.args[0])}[${formatArg(ins.args[1])}]`;
  if (ins.op === "global.get") return `${ins.result} reads global ${formatArg(ins.args[0])}`;
  if (ins.op === "global.set") return `writes ${formatArg(ins.args[1])} to global ${formatArg(ins.args[0])}`;
  if (ins.op === "select.i32") return `${ins.result} selects an i32 value from ${formatArg(ins.args[0])}`;
  if (ins.op === "br") return `jumps to ${ins.labels[0]}`;
  if (ins.op === "br_if") return `branches on ${formatArg(ins.args[0])} to ${ins.labels[0]} or ${ins.labels[1]}`;
  if (ins.op === "alloc_region") return `${ins.result} allocates a checked linear-memory region`;
  if (ins.op === "free_region") return `frees region ${formatArg(ins.args[0])}`;
  if (ins.op === "load.i32") return `${ins.result} loads i32 from ${formatArg(ins.args[0])}`;
  if (ins.op === "store.i32") return `stores i32 into ${formatArg(ins.args[0])}`;
  return `${ins.result ? `${ins.result} = ` : ""}${ins.op}`;
}

module.exports = { explainModule };
