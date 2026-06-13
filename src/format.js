function formatModule(mod) {
  const out = [];
  out.push(`module ${mod.name}`);
  for (const use of mod.uses || []) out.push(`use ${formatUseName(use.name)}${use.alias ? ` as ${use.alias}` : ""}`);
  for (const constant of mod.constants || []) {
    if (!constant.importedFrom) out.push(`const ${constant.name}:${constant.type} = ${formatArg(constant.value)}`);
  }
  for (const table of (mod.tables || []).filter((item) => !item.tablegroup)) {
    const length = isCompactTableType(table.type) ? "" : `[${table.length}]`;
    out.push(`table ${table.name}:${table.type}${length} = [${(table.values || []).map(formatArg).join(", ")}]`);
  }
  for (const group of mod.tableGroups || []) {
    out.push(`tablegroup ${group.name} len ${group.length} {`);
    for (const field of group.fields || []) {
      const table = (mod.tables || []).find((item) => item.tablegroup === group.name && item.tablegroupField === field.name);
      const values = table ? table.values || [] : [];
      out.push(`  ${field.name}:${field.type} = [${values.map(formatArg).join(", ")}]`);
    }
    out.push("}");
  }
  for (const state of mod.states || []) {
    out.push(`state ${state.name}:${state.type}[${state.length}] = fill ${formatArg(state.init.value)}`);
  }
  for (const pool of mod.pools || []) {
    out.push(`pool ${pool.name} capacity ${pool.capacity} {`);
    for (const field of pool.fields || []) {
      out.push(`  ${field.name}:${field.type} = ${formatArg(field.init)}`);
    }
    out.push("}");
  }
  const capabilities = explicitCapabilities(mod).join(", ");
  out.push(capabilities ? `capabilities { ${capabilities} }` : "capabilities { }");
  if ((mod.effects || []).length) {
    out.push(`effects { ${mod.effects.map((effect) => `${effect.key} ${effect.op || "<="} ${effect.limit}`).join(", ")} }`);
  }
  for (const req of mod.requires || []) out.push(`requires ${formatContract(req)}`);
  for (const ens of mod.ensures || []) out.push(`ensures ${formatContract(ens)}`);
  out.push("");
  const localStructs = (mod.structs || []).filter((item) => !item.importedFrom);
  for (const struct of localStructs) {
    out.push(`struct ${struct.name} { ${struct.fields.map((field) => `${field.name}: ${field.type}`).join(", ")} }`);
  }
  if (localStructs.length) out.push("");
  for (const global of mod.globals || []) {
    out.push(`global ${global.name}:${global.type} = ${global.init.op} ${formatArgs(global.init.args)}`);
  }
  if ((mod.globals || []).length) out.push("");
  for (const ex of (mod.externs || []).filter((item) => !item.generated && !item.importedFrom)) {
    const params = ex.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    out.push(`extern ${ex.name}(${params}) -> ${ex.returnType}`);
  }
  if ((mod.externs || []).some((item) => !item.generated)) out.push("");
  for (const fn of mod.functions.filter((item) => !item.importedFrom)) {
    const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    out.push(`${fn.exported ? "export " : ""}func ${fn.name}(${params}) -> ${fn.returnType} {`);
    if ((fn.effects || []).length) {
      out.push(`  effects { ${fn.effects.map((effect) => `${effect.key} ${effect.op || "<="} ${effect.limit}`).join(", ")} }`);
    }
    for (const req of fn.requires || []) out.push(`  requires ${formatContract(req)}`);
    for (const ens of fn.ensures || []) out.push(`  ensures ${formatContract(ens)}`);
    for (const block of fn.blocks) {
      out.push(`${block.label}:`);
      for (const ins of block.instructions) out.push(`  ${formatInstruction(ins)}`);
    }
    out.push("}");
    out.push("");
  }
  return out.join("\n");
}

function formatInstruction(ins) {
  const body = formatBody(ins);
  return ins.result ? `${ins.result}:${ins.resultType} = ${body}` : body;
}

function formatBody(ins) {
  const compact = formatCompactBody(ins);
  if (compact) return compact;
  if (ins.op === "call") return `call @${ins.callee}(${formatArgs(ins.args)})`;
  if (ins.op === "return") return ins.args.length ? `return ${formatArgs(ins.args)}` : "return";
  if (ins.op === "print") return `print ${formatArgs(ins.args)}`;
  if (ins.op === "br") return `br ${ins.labels[0]}`;
  if (ins.op === "br_if") return `br_if ${formatArg(ins.args[0])}, ${ins.labels[0]}, ${ins.labels[1]}`;
  if (ins.op === "state.len") return `state.len ${formatArgs(ins.args)}`;
  if (ins.op === "state.get") return `state.get ${formatArgs(ins.args)}`;
  if (ins.op === "state.set") return `state.set ${formatArgs(ins.args)}`;
  if (ins.op === "tablegroup.get.i32" || ins.op === "tablegroup.get.bool") return `${ins.op} ${formatArgs(ins.args)}`;
  if (ins.op === "pool.capacity" || ins.op === "pool.get.i32" || ins.op === "pool.get.bool" || ins.op === "pool.set.i32" || ins.op === "pool.set.bool") return `${ins.op} ${formatArgs(ins.args)}`;
  if (ins.op === "loop.range.i32") return `loop.fold.i32 ${formatArgs(ins.args)}`;
  if (ins.op === "loop.range.f32") return `loop.fold.f32 ${formatArgs(ins.args)}`;
  return ins.args && ins.args.length ? `${ins.op} ${formatArgs(ins.args)}` : ins.op;
}

function formatCompactBody(ins) {
  if (ins.op === "call") return `@${ins.callee}(${formatArgs(ins.args)})`;
  if (ins.op === "const.str" && ins.resultType === "slice") return formatArg(ins.args[0]);
  if (ins.op === `const.${ins.resultType}` && ins.args.length === 1) return formatArg(ins.args[0]);
  const alias = aliasForOp(ins.op, ins.resultType);
  return alias ? `${alias} ${formatArgs(ins.args)}` : null;
}

function aliasForOp(op, resultType) {
  if (resultType === "i32") {
    if (op === "i32.add") return "add";
    if (op === "i32.sub") return "sub";
    if (op === "i32.mul") return "mul";
  }
  if (resultType === "f32") {
    if (op === "f32.add") return "add";
    if (op === "f32.sub") return "sub";
    if (op === "f32.mul") return "mul";
    if (op === "f32.div") return "div";
    if (op === "f32.min") return "min";
    if (op === "f32.max") return "max";
    if (op === "f32.clamp") return "clamp";
    if (op === "f32.lerp") return "lerp";
  }
  return null;
}

function explicitCapabilities(mod) {
  if (mod.explicitCapabilities) return Array.from(mod.explicitCapabilities).sort();
  const generated = new Set(mod.generatedCapabilities || []);
  return Array.from(mod.capabilities || []).filter((cap) => !generated.has(cap)).sort();
}

function formatArgs(args) {
  return args.map(formatArg).join(", ");
}

function formatArg(arg) {
  if (arg.kind === "value") return arg.name;
  if (arg.kind === "number" || arg.kind === "bool") return arg.raw || String(arg.value);
  if (arg.kind === "string") return JSON.stringify(arg.value);
  if (arg.kind === "phi") return `${arg.label}:${arg.value}`;
  if (arg.kind === "function") return `@${arg.name}`;
  if (arg.kind === "tablegroupField") return `@${arg.group}.${arg.field}`;
  if (arg.kind === "poolName") return `@${arg.name}`;
  if (arg.kind === "poolField") return `@${arg.pool}.${arg.field}`;
  return arg.name;
}

function formatUseName(name) {
  return name.includes("/") || name.endsWith(".air") ? JSON.stringify(name) : name;
}

function isCompactTableType(type) {
  return type === "u8" || type === "u16" || type === "i16";
}

function formatContract(contract) {
  if (contract.kind === "capability") return `capability ${contract.capability}`;
  if (contract.kind === "no-capability") return `no capability ${contract.capability}`;
  if (contract.kind === "export") return `export ${contract.name}`;
  if (contract.kind === "param") return `param ${contract.name} ${contract.op || "<="} ${contract.value}`;
  if (contract.kind === "return") return `return ${contract.op || "<="} ${contract.value}`;
  return `${contract.key} ${contract.op || "<="} ${contract.limit}`;
}

module.exports = { formatModule, formatInstruction, formatArg };
