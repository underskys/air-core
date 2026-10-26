const { formatV051Contract } = require("./v051_reference");
const { AirError, isTypedV053Ast } = require("./errors");

// R-PROF-7 for typed-v0.53 ASTs (OD-4 (b)): never a TypeError and never a
// silent format in another profile.
function rejectTypedV053Ast(mod, requested) {
  if (isTypedV053Ast(mod)) {
    throw new AirError(`air.source_profile.ast_mismatch: the AST was parsed as 'typed-v0.53' and cannot be processed as '${requested}'`);
  }
}

function formatModule(mod) {
  rejectTypedV053Ast(mod, "legacy-v0.50");
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
  for (const declaration of (mod.flowDeclarations || []).slice().sort(compareFlowDeclarations)) {
    out.push(formatFlowDeclaration(declaration));
  }
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
    const params = ex.params.map((p) => `${p.name}: ${formatDeclaredType(p)}`).join(", ");
    out.push(`extern ${ex.name}(${params}) -> ${ex.returnDeclaredType || ex.returnType}`);
  }
  if ((mod.externs || []).some((item) => !item.generated)) out.push("");
  for (const fn of mod.functions.filter((item) => !item.importedFrom)) {
    const params = fn.params.map((p) => `${p.name}: ${formatDeclaredType(p)}`).join(", ");
    out.push(`${fn.exported ? "export " : ""}func ${fn.name}(${params}) -> ${fn.returnDeclaredType || fn.returnType} {`);
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

function formatV051Air(mod) {
  rejectTypedV053Ast(mod, "typed-v0.51");
  if (mod && mod.v051TypedAst) return formatV051TypedAir(mod);
  let formatted = formatModule(mod);
  for (const fn of mod.functions || []) {
    for (const block of fn.blocks || []) {
      for (const ins of block.instructions || []) {
        if (ins.op !== "const.i64" || !ins.result || !ins.args || !ins.args[0] || !ins.args[0].exactI64) continue;
        const compact = `${ins.result}:i64 = ${ins.args[0].exactI64}`;
        const typed = `${ins.result}:i64 = const.i64 ${ins.args[0].exactI64}`;
        formatted = formatted.replace(compact, typed);
      }
    }
  }
  return formatted;
}

function formatV051TypedAir(mod) {
  const out = [`module ${mod.name}`];
  const capabilities = Array.from(mod.capabilities || []).sort();
  if (capabilities.length) out.push(`capabilities { ${capabilities.join(", ")} }`);
  for (const declaration of (mod.enums || []).slice().sort((left, right) => compareAscii(left.type_id, right.type_id))) {
    const typeName = declaration.type_id.slice(declaration.type_id.lastIndexOf("::") + 2);
    out.push("");
    out.push(`${declaration.kind === "error_enum" ? "error " : ""}enum ${typeName} {`);
    for (const entry of declaration.cases.slice().sort((left, right) => left.discriminant - right.discriminant || compareAscii(left.name, right.name))) {
      out.push(`  ${entry.name} = ${entry.discriminant},`);
    }
    out.push("}");
  }
  for (const fn of (mod.functions || []).slice().sort((left, right) => compareAscii(left.name, right.name))) {
    out.push("");
    const params = fn.params.map((parameter) => `${parameter.name}: ${parameter.type}`).join(", ");
    out.push(`${fn.exported ? "export " : ""}func ${fn.name}(${params}) -> ${fn.returnType} {`);
    const locals = new Map(fn.params.map((parameter) => [parameter.name, parameter.type]));
    for (const statement of fn.statements || []) {
      if (statement.kind === "local") {
        out.push(`  %${statement.name}: ${statement.type} = ${formatV051TypedValue(statement.value)}`);
        locals.set(statement.name, statement.type);
      }
      else if (statement.kind === "match") {
        out.push(`  %${statement.destination}: ${statement.destinationType} = match %${statement.value} {`);
        for (const arm of sortV051MatchArms(statement.arms || [], locals.get(statement.value), mod)) out.push(`    ${arm.pattern} => ${formatV051TypedValue(arm.expression)},`);
        out.push("  }");
        locals.set(statement.destination, statement.destinationType);
      } else if (statement.kind === "return") out.push(`  return ${formatV051TypedValue(statement.value)}`);
    }
    out.push("}");
  }
  return out.join("\n");
}

function formatV051TypedValue(value) {
  if (value && value.kind === "numeric_operation") return `${value.op} ${value.args.join(", ")}`;
  return String(value || "");
}

function sortV051MatchArms(arms, subjectType, mod) {
  const typeName = typeof subjectType === "string" ? subjectType : "";
  const declaration = (mod.enums || []).find((item) => item.type_id === typeName);
  const enumOrder = declaration ? new Map(declaration.cases.map((item) => [item.name, item.discriminant])) : null;
  const rank = (arm) => {
    const pattern = String(arm.pattern || "");
    if (enumOrder) return enumOrder.get(pattern.slice(pattern.lastIndexOf(".") + 1));
    if (typeName.startsWith("option<")) return pattern === "none" ? 0 : 1;
    if (typeName.startsWith("result<")) return pattern.startsWith("ok(") ? 0 : 1;
    return 0;
  };
  return arms.slice().sort((left, right) => rank(left) - rank(right) || compareAscii(left.pattern, right.pattern));
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatInstruction(ins) {
  const body = formatBody(ins);
  return ins.result ? `${ins.result}:${formatDeclaredType(ins, "resultType")} = ${body}` : body;
}

function formatDeclaredType(value, fallback = "type") {
  return value.declaredType || value[fallback];
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
  if (contract.kind === "checked_param") {
    return `checked param ${contract.parameter} ${contract.op} ${contract.literal}`;
  }
  if (contract.kind === "checked_borrow_length") {
    return `checked bytes ${contract.borrow} ${contract.op} param ${contract.parameter} * ${contract.multiplier}`;
  }
  if (contract.kind === "param") return `param ${contract.name} ${contract.op || "<="} ${contract.value}`;
  if (contract.kind === "return") return `return ${contract.op || "<="} ${contract.value}`;
  return `${contract.key} ${contract.op || "<="} ${contract.limit}`;
}

function formatFlowDeclaration(declaration) {
  if (declaration.kind === "policy") return `flow policy ${declaration.mode}`;
  if (declaration.kind === "source_param") {
    const binding = declaration.bindingKind && declaration.binding
      ? ` from ${declaration.bindingKind} ${declaration.binding}`
      : "";
    return `flow source param ${declaration.function}.${declaration.param}${binding} ${declaration.label}`;
  }
  if (declaration.kind === "source_extern") return `flow source extern ${declaration.extern} return ${declaration.label}`;
  if (declaration.kind === "source_global") return `flow source global ${declaration.global} ${declaration.label}`;
  if (declaration.kind === "sink_return") return `flow sink return ${declaration.function} ${declaration.label}`;
  if (declaration.kind === "sink_extern") return `flow sink extern ${declaration.extern} arg ${declaration.argIndex} ${declaration.label}`;
  if (declaration.kind === "sink_print") return `flow sink print arg 0 ${declaration.label}`;
  if (declaration.kind === "storage_global") return `flow storage global ${declaration.name} ${declaration.label}`;
  if (declaration.kind === "storage_state") return `flow storage state ${declaration.name} ${declaration.label}`;
  if (declaration.kind === "storage_pool") return `flow storage pool ${declaration.pool}.${declaration.field} ${declaration.label}`;
  if (declaration.kind === "declassifier") {
    return `flow declassifier ${declaration.id} function ${declaration.function} from ${declaration.from} to ${declaration.to}`;
  }
  throw new Error(`unknown flow declaration kind: ${declaration.kind}`);
}

function compareFlowDeclarations(a, b) {
  const order = {
    policy: 0,
    source_param: 1,
    source_extern: 2,
    source_global: 3,
    sink_return: 4,
    sink_extern: 5,
    sink_print: 6,
    storage_global: 7,
    storage_state: 8,
    storage_pool: 9,
    declassifier: 10
  };
  return (order[a.kind] ?? 99) - (order[b.kind] ?? 99) ||
    formatFlowDeclaration(a).localeCompare(formatFlowDeclaration(b));
}

// typed-v0.53 canonical form (R-FMT-1; OPEN-3 (a), OPEN-4 (a)): the
// typed-v0.51 rules (alphabetical functions, qualified types, arm order) plus
// exactly one trailing LF. Carriers and integer-spelled floats are already
// normalized by the typed-v0.53 parser (`N.0`, `-0.0` kept). `match` over
// `bool` uses the frozen arm order: equal rank, ASCII, so `false` first (R-7).
//
// P0-04 (slice text P4-R9): blocks indent two spaces per level; `} else {`
// and a block's closing `}` sit at the opening line's indentation; an atom arm
// ends with `,`, a block arm's closing line is `}`; a bare `return` in `void`.
function formatV053TypedAir(mod) {
  if (!isTypedV053Ast(mod)) {
    throw new AirError("air.source_profile.ast_mismatch: typed-v0.53 formatting requires a typed-v0.53 AST");
  }
  const out = [`module ${mod.name}`];
  const capabilities = Array.from(mod.capabilities || []).sort();
  if (capabilities.length) out.push(`capabilities { ${capabilities.join(", ")} }`);
  // P0-05 (slice text P5-R11): the `work` line follows the module header with
  // no blank line, its keys in the dimension order, spaced as `capabilities`.
  if (mod.work && Array.isArray(mod.work.limits) && mod.work.limits.length) {
    out.push(`work { ${mod.work.limits.map((limit) => `${limit.key} <= ${limit.bound}`).join(", ")} }`);
  }
  for (const declaration of (mod.enums || []).slice().sort((left, right) => compareAscii(left.type_id, right.type_id))) {
    const typeName = declaration.type_id.slice(declaration.type_id.lastIndexOf("::") + 2);
    out.push("");
    out.push(`${declaration.kind === "error_enum" ? "error " : ""}enum ${typeName} {`);
    for (const entry of declaration.cases.slice().sort((left, right) => left.discriminant - right.discriminant || compareAscii(left.name, right.name))) {
      out.push(`  ${entry.name} = ${entry.discriminant},`);
    }
    out.push("}");
  }
  for (const fn of (mod.functions || []).slice().sort((left, right) => compareAscii(left.name, right.name))) {
    out.push("");
    const params = fn.params.map((parameter) => `${parameter.name}: ${parameter.type}`).join(", ");
    out.push(`${fn.exported ? "export " : ""}func ${fn.name}(${params}) -> ${fn.returnType} {`);
    formatV053Statements(fn.statements || [], "  ", new Map(fn.params.map((parameter) => [parameter.name, parameter.type])), mod, out);
    out.push("}");
  }
  return `${out.join("\n")}\n`;
}

// Block nesting is bounded by the analysis capacity, checked before formatting.
function formatV053Statements(statements, indent, locals, mod, out) {
  for (const statement of statements) {
    if (statement.kind === "local") {
      out.push(`${indent}%${statement.name}: ${statement.type} = ${formatV053Value(statement.value)}`);
      locals.set(statement.name, statement.type);
    } else if (statement.kind === "call") {
      out.push(`${indent}${formatV053Value(statement.value)}`);
    } else if (statement.kind === "match") {
      out.push(`${indent}%${statement.destination}: ${statement.destinationType} = match %${statement.value} {`);
      for (const arm of sortV051MatchArms(statement.arms || [], locals.get(statement.value), mod)) {
        if (arm.block) {
          out.push(`${indent}  ${arm.pattern} => {`);
          formatV053Statements(arm.block.statements || [], `${indent}    `, new Map(locals), mod, out);
          out.push(`${indent}  }`);
        } else {
          out.push(`${indent}  ${arm.pattern} => ${formatV053Value(arm.expression)},`);
        }
      }
      out.push(`${indent}}`);
      locals.set(statement.destination, statement.destinationType);
    } else if (statement.kind === "if") {
      out.push(`${indent}%${statement.destination}: ${statement.destinationType} = if ${statement.condition} {`);
      formatV053Statements(statement.blocks[0].statements || [], `${indent}  `, new Map(locals), mod, out);
      out.push(`${indent}} else {`);
      formatV053Statements(statement.blocks[1].statements || [], `${indent}  `, new Map(locals), mod, out);
      out.push(`${indent}}`);
      locals.set(statement.destination, statement.destinationType);
    } else if (statement.kind === "yield") {
      out.push(`${indent}yield ${formatV053Value(statement.value)}`);
    } else if (statement.kind === "return") {
      const value = formatV053Value(statement.value);
      out.push(value ? `${indent}return ${value}` : `${indent}return`);
    }
  }
}

function formatV053Value(value) {
  if (value && value.kind === "call") return `call @${value.callee}(${(value.args || []).join(", ")})`;
  if (value && value.kind === "fold") {
    // P5-R1: one space after each comma and on each side of `max`.
    const count = value.count && value.count.kind === "dynamic"
      ? `%${value.count.local}${value.count.max === undefined ? "" : ` max ${value.count.max}`}`
      : value.count && value.count.value;
    return `loop.fold @${value.callback}, ${value.seed}, ${count}`;
  }
  return formatV051TypedValue(value);
}

module.exports = { formatModule, formatV051Air, formatInstruction, formatArg, formatV051Contract };
// Reached only through the candidate-gated source profile (R-PROF-2).
Object.defineProperty(module.exports, "typedV053", {
  enumerable: false,
  value: Object.freeze({ format: formatV053TypedAir })
});
