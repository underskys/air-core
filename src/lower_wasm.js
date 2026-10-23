const { formatArg } = require("./format");
const { parseArrayType, parseBufferType, isStructName, scalarByteWidth, parseRefinementType } = require("./types");
const { tableStorageByteWidth } = require("./table_metadata");
const {
  REGION_BACKING_MAX_BYTES,
  REGION_BOUNDS_FAILURE_FUNCTION,
  REGION_BOUNDS_RUNTIME_CODE
} = require("./region_bounds");
const { AirError, isTypedV053Ast } = require("./errors");
const verifierModule = require("./verifier");
const { STRUCTURED_PHI_LOOP_FUEL_LIMIT, assertWasmTargetSupport, verifyV051Air } = verifierModule;
const parserModule = require("./parser");
const { enforceAnalysisCapacity } = require("./analysis_capacity");

const REGION_SLOT_BYTES = 4096;
const WASM_PAGE_BYTES = 65536;
const WASM32_MAX_PAGES = 65536;
const AIR_STATIC_DATA_BASE = 1024;
const { parseTypeReference } = require("./typed_interface");
const {
  AIR_OWNED_MEMORY_BASE_EXPORT,
  AIR_OWNED_MEMORY_END_EXPORT,
  BORROWED_SLICE_TYPE,
  borrowedSliceInterfaceDescriptor,
  borrowedSliceInterfaceDigest
} = require("./borrowed_slices");

const BORROW_FAILURE_FUNCTION = "__air_borrow_failure";
const BORROWED_SLICE_FEATURE_MARKER = 0x000b0001;
const BORROW_FAILURE = Object.freeze({
  length: 1,
  pointer: 2,
  alignment: 3,
  overlap: 4,
  relation: 5,
  arithmetic: 6
});

function lowerToWat(mod, options = {}) {
  if (isTypedV053Ast(mod)) return lowerV053TypedToWat(mod, options);
  if (mod && mod.v051TypedAst) return lowerV051TypedToWat(mod, options);
  assertWasmTargetSupport(mod);
  const borrowedDescriptor = borrowedSliceInterfaceDescriptor(mod);
  const ctx = {
    dataOffset: AIR_STATIC_DATA_BASE,
    data: [],
    usesFdWrite: false,
    externs: new Map((mod.externs || []).map((ex) => [ex.name, ex])),
    globals: new Map((mod.globals || []).map((global) => [global.name, global])),
    constants: new Map((mod.constants || []).map((constant) => [constant.name, constant])),
    tables: new Map((mod.tables || []).map((table) => [table.name, table])),
    tableData: new Map(),
    states: new Map((mod.states || []).map((segment) => [segment.name, segment])),
    stateCells: new Map(),
    pools: new Map((mod.pools || []).map((pool) => [pool.name, pool])),
    poolCells: new Map(),
    structs: new Map((mod.structs || []).map((struct) => [struct.name, struct])),
    usesRegionBoundsFailure: false,
    usesBorrowFailure: false,
    regionBackingBytes: 0
  };
  allocateCompactTables(ctx, mod.tables || []);
  allocateStateCells(ctx, mod.states || []);
  allocatePoolCells(ctx, mod.pools || []);

  const functionWat = mod.functions.map((fn) => lowerFunction(fn, ctx));
  const globalsWat = (mod.globals || []).map(lowerGlobal);
  const stateCellsWat = lowerStateCellGlobals(ctx);
  const poolCellsWat = lowerPoolCellGlobals(ctx);

  const imports = ctx.usesFdWrite
    ? ['  (import "wasi_snapshot_preview1" "fd_write" (func $__wasi_fd_write (param i32 i32 i32 i32) (result i32)))']
    : [];
  for (const ex of mod.externs || []) {
    const [moduleName, fieldName] = splitExternalName(ex.name);
    const params = ex.params.map((p) => `(param ${watType(p.type)})`).join(" ");
    const result = ex.returnType === "void" ? "" : ` (result ${watType(ex.returnType)})`;
    imports.push(`  (import "${moduleName}" "${fieldName}" (func $${wasmName(ex.name)}${params ? ` ${params}` : ""}${result}))`);
  }
  const printHelper = ctx.usesFdWrite
    ? [
        `  (func $__print (param $ptr i32) (param $len i32) (result i32)`,
        `    (local $iovs i32)`,
        `    i32.const 8`,
        `    local.set $iovs`,
        `    local.get $iovs`,
        `    local.get $ptr`,
        `    i32.store`,
        `    local.get $iovs`,
        `    i32.const 4`,
        `    i32.add`,
        `    local.get $len`,
        `    i32.store`,
        `    i32.const 1`,
        `    local.get $iovs`,
        `    i32.const 1`,
        `    i32.const 0`,
        `    call $__wasi_fd_write`,
        `  )`
      ]
    : [];
  const regionBoundsHelper = ctx.usesRegionBoundsFailure
    ? [
        `  (func $${REGION_BOUNDS_FAILURE_FUNCTION}`,
        `    unreachable`,
        `  )`
      ]
    : [];
  const borrowBoundsHelper = ctx.usesBorrowFailure
    ? [
        `  (func $${BORROW_FAILURE_FUNCTION} (param $code i32)`,
        `    unreachable`,
        `  )`
      ]
    : [];
  const borrowedInterface = borrowedDescriptor
    ? [
        `  ;; air-abi: ${borrowedDescriptor.airAbi}`,
        `  ;; air-feature: ${borrowedDescriptor.feature}`,
        `  ;; air-interface-sha256: ${borrowedSliceInterfaceDigest(mod)}`,
        `  (global (export "__air_abi_feature_borrowed_slice_v1") i32 (i32.const ${BORROWED_SLICE_FEATURE_MARKER}))`,
        `  (global (export "${AIR_OWNED_MEMORY_BASE_EXPORT}") i32 (i32.const ${ctx.usesFdWrite ? 0 : AIR_STATIC_DATA_BASE}))`,
        `  (global (export "${AIR_OWNED_MEMORY_END_EXPORT}") i32 (i32.const ${ctx.dataOffset}))`
      ]
    : [];
  const data = ctx.data.map((d) => `  (data (i32.const ${d.offset}) ${d.bytes ? watBytes(d.bytes) : watString(d.value)})`);
  const memoryPages = Math.max(1, Math.ceil(ctx.dataOffset / WASM_PAGE_BYTES));
  if (memoryPages > WASM32_MAX_PAGES) {
    throw new AirError(`air.memory.region_backing_unsupported: linear memory needs ${memoryPages} pages; wasm32 allows ${WASM32_MAX_PAGES}`);
  }

  return [
    `(module`,
    ...imports,
    `  (memory (export "memory") ${memoryPages})`,
    ...borrowedInterface,
    ...globalsWat,
    ...stateCellsWat,
    ...poolCellsWat,
    ...printHelper,
    ...regionBoundsHelper,
    ...borrowBoundsHelper,
    ...functionWat,
    ...startFunction(mod),
    ...data,
    `)`
  ].join("\n");
}

class V051TypedLoweringError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "V051TypedLoweringError";
    this.code = code;
  }
}

function typedLowerFail(code, message) {
  throw new V051TypedLoweringError(code, message);
}

// The candidate path lowers the already-verified typed AST directly to WAT.
// It is intentionally separate from the legacy block IR, not an interpreter.
class BoundedTypedWatLines extends Array {
  constructor(budget) {
    super();
    this.budget = budget;
  }

  static get [Symbol.species]() { return Array; }

  push(...lines) {
    if (this.budget) {
      for (const line of lines) this.budget.charge(line);
    }
    return super.push(...lines);
  }
}

function typedWatBudget(maxWatBytes) {
  if (maxWatBytes === undefined) return null;
  if (!Number.isSafeInteger(maxWatBytes) || maxWatBytes < 1) {
    throw new TypeError("maxWatBytes must be a positive safe integer");
  }
  return {
    remaining: maxWatBytes,
    charge(line) {
      const bytes = Buffer.byteLength(line, "utf8") + 5;
      if (bytes > this.remaining) {
        typedLowerFail("air.v052.work_limit_wat_bytes", `lowered WAT exceeds the configured limit of ${maxWatBytes}`);
      }
      this.remaining -= bytes;
    }
  };
}

function lowerV051TypedToWat(mod, options = {}) {
  verifyV051Air(mod);
  try {
    const budget = typedWatBudget(options.maxWatBytes);
    const declarations = new Map((mod.enums || []).map((item) => [item.type_id, item]));
    const usesCanonicalSumIngress = (mod.functions || []).some((fn) => (fn.params || []).some((parameter) => {
      const type = v051TypedTypeInfo(parameter.type, declarations);
      return type.kind === "option" || type.kind === "result";
    }));
    const usesCheckedNumeric = (mod.functions || []).some(v051TypedFunctionUsesCheckedNumeric);
    const usesTypedRefinement = (mod.functions || []).some(v051TypedFunctionUsesRefinement);
    const functions = (mod.functions || []).map((fn) => lowerV051TypedFunction(fn, declarations, budget));
    return [
      "(module",
      "  (func $__air_v051_invalid_tag unreachable)",
      "  (func $__air_v051_invalid_enum_discriminant unreachable)",
      "  (func $__air_v051_invalid_bool unreachable)",
      ...(usesTypedRefinement ? ["  (func $__air_v051_refinement_out_of_range unreachable)"] : []),
      ...(usesCanonicalSumIngress ? ["  (func $__air_v051_noncanonical_sum_lane unreachable)"] : []),
      ...(usesCheckedNumeric ? [
        "  (global $__air_v051_checked_numeric_failure (export \"__air_v051_checked_numeric_failure\") (mut i32) (i32.const 0))",
        "  (func $__air_v051_numeric_overflow i32.const 1 global.set $__air_v051_checked_numeric_failure unreachable)",
        "  (func $__air_v051_numeric_division_by_zero i32.const 2 global.set $__air_v051_checked_numeric_failure unreachable)",
        "  (func $__air_v051_numeric_invalid_conversion i32.const 3 global.set $__air_v051_checked_numeric_failure unreachable)"
      ] : []),
      ...functions,
      ")"
    ].join("\n");
  } catch (error) {
    if (error instanceof V051TypedLoweringError) throw error;
    typedLowerFail("air.v051.typed_lowering_unsupported", error && error.message ? error.message : "unsupported typed AST");
  }
}

function lowerV051TypedFunction(fn, declarations, budget) {
  if (fn.returnType === "void") {
    typedLowerFail("air.v051.typed_lowering_unsupported", "void typed functions are outside the first vertical runtime subset");
  }
  const state = {
    declarations,
    localDecls: new BoundedTypedWatLines(budget),
    locals: new Map(),
    body: new BoundedTypedWatLines(budget),
    tempId: 0,
    usesCheckedNumeric: v051TypedFunctionUsesCheckedNumeric(fn)
  };
  const params = [];
  for (const parameter of fn.params || []) {
    const info = v051TypedTypeInfo(parameter.type, declarations);
    const record = v051TypedRecord(parameter.name, parameter.type, info, true);
    state.locals.set(parameter.name, record);
    for (let index = 0; index < record.names.length; index += 1) {
      const param = `(param ${record.names[index]} ${info.watTypes[index]})`;
      if (budget) budget.charge(param);
      params.push(param);
    }
    emitV051TypedRuntimeValidation(state, record);
  }
  if (state.usesCheckedNumeric) state.body.push("i32.const 0", "global.set $__air_v051_checked_numeric_failure");
  for (const statement of fn.statements || []) {
    if (statement.kind === "local") {
      const info = v051TypedTypeInfo(statement.type, declarations);
      const record = v051TypedRecord(statement.name, statement.type, info, false);
      state.locals.set(statement.name, record);
      state.localDecls.push(...record.names.map((name, index) => `(local ${name} ${info.watTypes[index]})`));
      emitV051TypedExpression(state, statement.value, statement.type);
      emitV051TypedRefinementAssignmentCheck(state, record.info);
      emitV051TypedSet(state, record);
      continue;
    }
    if (statement.kind === "match") {
      const info = v051TypedTypeInfo(statement.destinationType, declarations);
      const record = v051TypedRecord(statement.destination, statement.destinationType, info, false);
      state.locals.set(statement.destination, record);
      state.localDecls.push(...record.names.map((name, index) => `(local ${name} ${info.watTypes[index]})`));
      emitV051TypedMatch(state, statement, record);
      continue;
    }
    if (statement.kind === "return") {
      if (fn.returnType !== "void") {
        emitV051TypedExpression(state, statement.value, fn.returnType);
        emitV051TypedRefinementAssignmentCheck(state, v051TypedTypeInfo(fn.returnType, declarations));
      }
      state.body.push("return");
      continue;
    }
    typedLowerFail("air.v051.typed_lowering_unsupported", `unsupported statement kind '${statement.kind}'`);
  }
  const resultInfo = fn.returnType === "void" ? { watTypes: [] } : v051TypedTypeInfo(fn.returnType, declarations);
  const result = resultInfo.watTypes.length ? ` (result ${resultInfo.watTypes.join(" ")})` : "";
  const exportDecl = fn.exported ? ` (export "${fn.name}")` : "";
  return [
    `  (func $${wasmName(fn.name)}${exportDecl}${params.length ? ` ${params.join(" ")}` : ""}${result}`,
    ...state.localDecls.map((line) => `    ${line}`),
    ...state.body.map((line) => `    ${line}`),
    "  )"
  ].join("\n");
}

function v051TypedFunctionUsesCheckedNumeric(fn) {
  return (fn.statements || []).some((statement) => {
    return (statement.kind === "local" || statement.kind === "return") &&
      statement.value && statement.value.kind === "numeric_operation" &&
      /^(?:i64\.checked_|i64\.to_i32_checked|f64\.to_f32_checked)/.test(statement.value.op);
  });
}

function v051TypedFunctionUsesRefinement(fn) {
  const typeNames = [fn.returnType, ...(fn.params || []).map((parameter) => parameter.type)];
  for (const statement of fn.statements || []) {
    if (statement.kind === "local") typeNames.push(statement.type);
    if (statement.kind === "match") typeNames.push(statement.destinationType);
  }
  return typeNames.some((typeName) => {
    const refinement = parseRefinementType(typeName);
    return refinement && refinement.base === "i32";
  });
}

function v051TypedTypeInfo(typeName, declarations) {
  const refinement = parseRefinementType(typeName);
  if (refinement) {
    if (refinement.base !== "i32") typedLowerFail("air.v051.typed_lowering_unsupported", `unsupported typed refinement '${typeName}'`);
    return {
      baseCanonical: refinement.base,
      kind: "scalar",
      refinement: refinement.refinement,
      type: { baseCanonical: refinement.base, canonical: refinement.canonical, kind: "primitive", refinement: refinement.refinement },
      watTypes: ["i32"]
    };
  }
  let type;
  try { type = parseTypeReference(typeName); } catch { typedLowerFail("air.v051.typed_lowering_unsupported", `invalid type '${typeName}'`); }
  if (type.kind === "primitive") return { baseCanonical: type.canonical, kind: "scalar", refinement: null, type, watTypes: [v051TypedWatType(type.canonical)] };
  if (type.kind === "enum") {
    const declaration = declarations.get(type.canonical);
    if (!declaration) typedLowerFail("air.v051.typed_lowering_unsupported", `unknown enum '${type.canonical}'`);
    return { declaration, kind: "enum", type, watTypes: ["i32"] };
  }
  if (type.kind === "option") {
    const payload = v051TypedTypeInfo(type.payload.canonical, declarations);
    return { kind: "option", payload, type, watTypes: ["i32", ...payload.watTypes] };
  }
  if (type.kind === "result") {
    const payload = v051TypedTypeInfo(type.payload.canonical, declarations);
    const error = v051TypedTypeInfo(type.error.canonical, declarations);
    return { kind: "result", payload, error, type, watTypes: ["i32", ...payload.watTypes, ...error.watTypes] };
  }
  typedLowerFail("air.v051.typed_lowering_unsupported", `unsupported type '${typeName}'`);
}

function v051TypedBaseTypeName(typeName) {
  const refinement = parseRefinementType(typeName);
  return refinement ? refinement.base : typeName;
}

function v051TypedWatType(type) {
  if (type === "i32" || type === "bool") return "i32";
  if (type === "i64" || type === "f32" || type === "f64") return type;
  typedLowerFail("air.v051.typed_lowering_unsupported", `unsupported scalar type '${type}'`);
}

function v051TypedRecord(name, type, info, parameter) {
  const base = `$${String(name).replace(/[^A-Za-z0-9_]/g, "_")}`;
  const suffixes = info.kind === "option" ? ["tag", "payload"] : info.kind === "result" ? ["tag", "payload", "error"] : [""];
  const names = info.watTypes.map((_, index) => {
    const suffix = suffixes[index] || String(index);
    return parameter && !suffix ? base : suffix ? `${base}$${suffix}` : base;
  });
  return { info, name, names, parameter, type };
}

function emitV051TypedRuntimeValidation(state, record) {
  const { info } = record;
  if (info.kind === "scalar" && info.type.canonical === "bool") {
    emitV051TypedBinaryDomainCheck(state, record.names[0], "__air_v051_invalid_bool");
    return;
  }
  if (info.kind === "enum") {
    emitV051TypedEnumValidation(state, record.names[0], info.declaration);
    return;
  }
  if (info.kind === "scalar" && info.refinement && info.refinement.kind === "i32_range") {
    emitV051TypedRefinementIngressCheck(state, record.names[0], info.refinement);
    return;
  }
  if (info.kind === "option" || info.kind === "result") {
    emitV051TypedBinaryDomainCheck(state, record.names[0], "__air_v051_invalid_tag");
    if (info.kind === "option") {
      state.body.push(`local.get ${record.names[0]}`);
      state.body.push("i32.const 0");
      state.body.push("i32.eq");
      state.body.push("if");
      emitV051TypedCanonicalZeroCheck(state, record.names[1], info.payload);
      state.body.push("end");
      state.body.push(`local.get ${record.names[0]}`);
      state.body.push("i32.const 1");
      state.body.push("i32.eq");
      state.body.push("if");
      emitV051TypedActiveValueValidation(state, record.names[1], info.payload);
      state.body.push("end");
    }
    if (info.kind === "result") {
      state.body.push(`local.get ${record.names[0]}`);
      state.body.push("i32.const 0");
      state.body.push("i32.eq");
      state.body.push("if");
      emitV051TypedActiveValueValidation(state, record.names[1], info.payload);
      emitV051TypedCanonicalZeroCheck(state, record.names[2], info.error);
      state.body.push("end");
      state.body.push(`local.get ${record.names[0]}`);
      state.body.push("i32.const 1");
      state.body.push("i32.eq");
      state.body.push("if");
      emitV051TypedCanonicalZeroCheck(state, record.names[1], info.payload);
      emitV051TypedActiveValueValidation(state, record.names[2], info.error);
      state.body.push("end");
    }
  }
}

function emitV051TypedRefinementIngressCheck(state, local, refinement) {
  state.body.push(`local.get ${local}`, `i32.const ${refinement.min}`, "i32.lt_s", `local.get ${local}`, `i32.const ${refinement.max}`, "i32.gt_s", "i32.or", "if", "call $__air_v051_refinement_out_of_range", "end");
}

function emitV051TypedRefinementAssignmentCheck(state, info) {
  if (!info || !info.refinement || info.refinement.kind !== "i32_range") return;
  const value = declareV051TypedTemporary(state, "i32");
  state.body.push(`local.set ${value}`, `local.get ${value}`, `i32.const ${info.refinement.min}`, "i32.lt_s", `local.get ${value}`, `i32.const ${info.refinement.max}`, "i32.gt_s", "i32.or", "if", "call $__air_v051_refinement_out_of_range", "end", `local.get ${value}`);
}

function emitV051TypedActiveValueValidation(state, local, info) {
  if (info.kind === "scalar" && info.type.canonical === "bool") {
    emitV051TypedBinaryDomainCheck(state, local, "__air_v051_invalid_bool");
    return;
  }
  if (info.kind === "enum") emitV051TypedEnumValidation(state, local, info.declaration);
}

// Canonical A2 sum values have physically zeroed inactive lanes. Integer lanes
// compare directly; float lanes compare raw bits so -0.0 is not accepted as a
// nonsemantic padding value.
function emitV051TypedCanonicalZeroCheck(state, local, info) {
  if (!info || !Array.isArray(info.watTypes) || info.watTypes.length !== 1) {
    typedLowerFail("air.v051.typed_lowering_unsupported", "sum ABI payload must lower to one scalar lane");
  }
  state.body.push(`local.get ${local}`);
  switch (info.watTypes[0]) {
    case "i32": state.body.push("i32.eqz"); state.body.push("i32.eqz"); break;
    case "i64": state.body.push("i64.eqz"); state.body.push("i32.eqz"); break;
    case "f32": state.body.push("i32.reinterpret_f32"); state.body.push("i32.eqz"); state.body.push("i32.eqz"); break;
    case "f64": state.body.push("i64.reinterpret_f64"); state.body.push("i64.eqz"); state.body.push("i32.eqz"); break;
    default: typedLowerFail("air.v051.typed_lowering_unsupported", `unsupported sum ABI lane '${info.watTypes[0]}'`);
  }
  state.body.push("if");
  state.body.push("call $__air_v051_noncanonical_sum_lane");
  state.body.push("end");
}

function emitV051TypedBinaryDomainCheck(state, local, failureFunction) {
  state.body.push(`local.get ${local}`);
  state.body.push("i32.const 0");
  state.body.push("i32.eq");
  state.body.push(`local.get ${local}`);
  state.body.push("i32.const 1");
  state.body.push("i32.eq");
  state.body.push("i32.or");
  state.body.push("i32.eqz");
  state.body.push("if");
  state.body.push(`call $${failureFunction}`);
  state.body.push("end");
}

function emitV051TypedEnumValidation(state, local, declaration) {
  let first = true;
  for (const entry of declaration.cases || []) {
    state.body.push(`local.get ${local}`);
    state.body.push(`i32.const ${entry.discriminant}`);
    state.body.push("i32.eq");
    if (!first) state.body.push("i32.or");
    first = false;
  }
  state.body.push("i32.eqz");
  state.body.push("if");
  state.body.push("call $__air_v051_invalid_enum_discriminant");
  state.body.push("end");
}

function emitV051TypedExpression(state, value, expectedType) {
  if (value && typeof value === "object" && value.kind === "numeric_operation") {
    emitV051TypedNumericOperation(state, value, expectedType);
    return;
  }
  const text = String(value || "").trim();
  const info = v051TypedTypeInfo(expectedType, state.declarations);
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    const local = state.locals.get(text.slice(1));
    // typed-v0.53 (P0-03) admits an i32-family reference into any i32-family
    // slot (widening or a checked narrowing); the lane is the same i32. The
    // narrowing check is emitted by the statement. typed-v0.51 is unchanged.
    const widened = Boolean(local) && state.typedV053 === true && V053_I32_FAMILY.test(local.type) && V053_I32_FAMILY.test(expectedType);
    if (!local || (local.type !== expectedType && !widened)) typedLowerFail("air.v051.typed_lowering_unsupported", `unknown or mismatched local '${text}'`);
    emitV051TypedGet(state, local);
    return;
  }
  if (info.kind === "scalar") {
    if (info.type.canonical === "bool") {
      state.body.push(`i32.const ${text === "true" ? 1 : 0}`);
      return;
    }
    state.body.push(`${info.watTypes[0]}.const ${text}`);
    return;
  }
  if (info.kind === "enum") {
    const entry = v051TypedEnumLiteral(text, info.type, info.declaration);
    state.body.push(`i32.const ${entry.discriminant}`);
    return;
  }
  if (info.kind === "option") {
    const constructor = text.match(/^option\.(none|some)<(.+)>\s*(.*)$/);
    if (!constructor || constructor[2] !== info.payload.type.canonical) typedLowerFail("air.v051.typed_lowering_unsupported", `invalid option constructor '${text}'`);
    state.body.push(`i32.const ${constructor[1] === "none" ? 0 : 1}`);
    if (constructor[1] === "none") emitV051TypedZero(state, info.payload);
    else {
      if (!constructor[3]) typedLowerFail("air.v051.typed_lowering_unsupported", "option.some requires a payload");
      emitV051TypedExpression(state, constructor[3], info.payload.type.canonical);
    }
    return;
  }
  if (info.kind === "result") {
    const constructor = text.match(/^result\.(ok|err)<(.+)>\s+(.+)$/);
    if (!constructor) typedLowerFail("air.v051.typed_lowering_unsupported", `invalid result constructor '${text}'`);
    const parts = splitV051TypedArguments(constructor[2]);
    if (!parts || parts.length !== 2 || parts[0] !== info.payload.type.canonical || parts[1] !== info.error.type.canonical) {
      typedLowerFail("air.v051.typed_lowering_unsupported", `result constructor type mismatch '${text}'`);
    }
    state.body.push(`i32.const ${constructor[1] === "ok" ? 0 : 1}`);
    if (constructor[1] === "ok") {
      emitV051TypedExpression(state, constructor[3], info.payload.type.canonical);
      emitV051TypedZero(state, info.error);
    } else {
      emitV051TypedZero(state, info.payload);
      emitV051TypedExpression(state, constructor[3], info.error.type.canonical);
    }
    return;
  }
  typedLowerFail("air.v051.typed_lowering_unsupported", `unsupported expression '${text}'`);
}

function emitV051TypedNumericOperation(state, operation, expectedType) {
  const signatures = {
    "i64.checked_add": { args: ["i64", "i64"], result: "i64" },
    "i64.checked_sub": { args: ["i64", "i64"], result: "i64" },
    "i64.checked_mul": { args: ["i64", "i64"], result: "i64" },
    "i64.checked_div_s": { args: ["i64", "i64"], result: "i64" },
    "i64.checked_rem_s": { args: ["i64", "i64"], result: "i64" },
    "i64.checked_neg": { args: ["i64"], result: "i64" },
    "i64.eq": { args: ["i64", "i64"], result: "bool" },
    "i64.ne": { args: ["i64", "i64"], result: "bool" },
    "i64.lt_s": { args: ["i64", "i64"], result: "bool" },
    "i64.le_s": { args: ["i64", "i64"], result: "bool" },
    "i64.gt_s": { args: ["i64", "i64"], result: "bool" },
    "i64.ge_s": { args: ["i64", "i64"], result: "bool" },
    "i64.to_i32_checked": { args: ["i64"], result: "i32" },
    "i32.to_i64": { args: ["i32"], result: "i64" },
    "f32.to_f64": { args: ["f32"], result: "f64" },
    "f64.to_f32_checked": { args: ["f64"], result: "f32" }
  };
  const signature = signatures[operation.op];
  if (!signature || !Array.isArray(operation.args) || operation.args.length !== signature.args.length || v051TypedBaseTypeName(expectedType) !== signature.result) {
    typedLowerFail("air.v051.typed_lowering_unsupported", `invalid checked numeric operation '${operation.op}'`);
  }
  if (operation.op === "i64.checked_add") return emitV051CheckedI64Add(state, operation.args);
  if (operation.op === "i64.checked_sub") return emitV051CheckedI64Sub(state, operation.args);
  if (operation.op === "i64.checked_mul") return emitV051CheckedI64Mul(state, operation.args);
  if (operation.op === "i64.checked_div_s") return emitV051CheckedI64Div(state, operation.args);
  if (operation.op === "i64.checked_rem_s") return emitV051CheckedI64Rem(state, operation.args);
  if (operation.op === "i64.checked_neg") return emitV051CheckedI64Neg(state, operation.args[0]);
  if (/^i64\.(?:eq|ne|lt_s|le_s|gt_s|ge_s)$/.test(operation.op)) return emitV051TypedI64Comparison(state, operation.args, operation.op.slice(4));
  if (operation.op === "i64.to_i32_checked") return emitV051CheckedI64ToI32(state, operation.args[0]);
  if (operation.op === "i32.to_i64") {
    emitV051TypedExpression(state, operation.args[0], "i32");
    state.body.push("i64.extend_i32_s");
    return;
  }
  if (operation.op === "f32.to_f64") {
    emitV051TypedExpression(state, operation.args[0], "f32");
    state.body.push("f64.promote_f32");
    return;
  }
  emitV051CheckedF64ToF32(state, operation.args[0]);
}

function emitV051TypedI64Comparison(state, args, operation) {
  const { left, right } = emitV051CheckedI64Operands(state, args);
  state.body.push(`local.get ${left}`, `local.get ${right}`, `i64.${operation}`);
}

function declareV051TypedTemporary(state, type) {
  const name = `$__air_v051_numeric_${state.tempId++}`;
  state.localDecls.push(`(local ${name} ${type})`);
  return name;
}

function emitV051CheckedI64Operands(state, args) {
  const left = declareV051TypedTemporary(state, "i64");
  const right = declareV051TypedTemporary(state, "i64");
  emitV051TypedExpression(state, args[0], "i64");
  state.body.push(`local.set ${left}`);
  emitV051TypedExpression(state, args[1], "i64");
  state.body.push(`local.set ${right}`);
  return { left, right };
}

function emitV051CheckedI64Add(state, args) {
  const { left, right } = emitV051CheckedI64Operands(state, args);
  const result = declareV051TypedTemporary(state, "i64");
  state.body.push(`local.get ${left}`, `local.get ${right}`, "i64.add", `local.set ${result}`);
  state.body.push(`local.get ${result}`, `local.get ${left}`, "i64.xor", `local.get ${result}`, `local.get ${right}`, "i64.xor", "i64.and", "i64.const 0", "i64.lt_s", "if", "call $__air_v051_numeric_overflow", "end", `local.get ${result}`);
}

function emitV051CheckedI64Sub(state, args) {
  const { left, right } = emitV051CheckedI64Operands(state, args);
  const result = declareV051TypedTemporary(state, "i64");
  state.body.push(`local.get ${left}`, `local.get ${right}`, "i64.sub", `local.set ${result}`);
  state.body.push(`local.get ${left}`, `local.get ${right}`, "i64.xor", `local.get ${left}`, `local.get ${result}`, "i64.xor", "i64.and", "i64.const 0", "i64.lt_s", "if", "call $__air_v051_numeric_overflow", "end", `local.get ${result}`);
}

function emitV051CheckedI64Mul(state, args) {
  const { left, right } = emitV051CheckedI64Operands(state, args);
  const result = declareV051TypedTemporary(state, "i64");
  state.body.push(`local.get ${left}`, `local.get ${right}`, "i64.mul", `local.set ${result}`);
  state.body.push(`local.get ${left}`, "i64.eqz", "if", "else");
  state.body.push(`local.get ${left}`, "i64.const -9223372036854775808", "i64.eq", `local.get ${right}`, "i64.const -1", "i64.eq", "i32.and", `local.get ${left}`, "i64.const -1", "i64.eq", `local.get ${right}`, "i64.const -9223372036854775808", "i64.eq", "i32.and", "i32.or", "if", "call $__air_v051_numeric_overflow", "end");
  state.body.push(`local.get ${result}`, `local.get ${left}`, "i64.div_s", `local.get ${right}`, "i64.ne", "if", "call $__air_v051_numeric_overflow", "end", "end", `local.get ${result}`);
}

function emitV051CheckedI64Neg(state, arg) {
  const value = declareV051TypedTemporary(state, "i64");
  emitV051TypedExpression(state, arg, "i64");
  state.body.push(`local.set ${value}`, `local.get ${value}`, "i64.const -9223372036854775808", "i64.eq", "if", "call $__air_v051_numeric_overflow", "end", "i64.const 0", `local.get ${value}`, "i64.sub");
}

function emitV051CheckedI64Div(state, args) {
  const { left, right } = emitV051CheckedI64Operands(state, args);
  state.body.push(`local.get ${right}`, "i64.eqz", "if", "call $__air_v051_numeric_division_by_zero", "end");
  state.body.push(`local.get ${left}`, "i64.const -9223372036854775808", "i64.eq", `local.get ${right}`, "i64.const -1", "i64.eq", "i32.and", "if", "call $__air_v051_numeric_overflow", "end", `local.get ${left}`, `local.get ${right}`, "i64.div_s");
}

function emitV051CheckedI64Rem(state, args) {
  const { left, right } = emitV051CheckedI64Operands(state, args);
  state.body.push(`local.get ${right}`, "i64.eqz", "if", "call $__air_v051_numeric_division_by_zero", "end");
  state.body.push(`local.get ${left}`, "i64.const -9223372036854775808", "i64.eq", `local.get ${right}`, "i64.const -1", "i64.eq", "i32.and", "if (result i64)", "i64.const 0", "else", `local.get ${left}`, `local.get ${right}`, "i64.rem_s", "end");
}

function emitV051CheckedI64ToI32(state, arg) {
  const value = declareV051TypedTemporary(state, "i64");
  emitV051TypedExpression(state, arg, "i64");
  state.body.push(`local.set ${value}`, `local.get ${value}`, "i64.const 2147483647", "i64.gt_s", `local.get ${value}`, "i64.const -2147483648", "i64.lt_s", "i32.or", "if", "call $__air_v051_numeric_invalid_conversion", "end", `local.get ${value}`, "i32.wrap_i64");
}

function emitV051CheckedF64ToF32(state, arg) {
  const value = declareV051TypedTemporary(state, "f64");
  const narrowed = declareV051TypedTemporary(state, "f32");
  emitV051TypedExpression(state, arg, "f64");
  state.body.push(`local.set ${value}`, `local.get ${value}`, "f32.demote_f64", `local.set ${narrowed}`);
  state.body.push(`local.get ${value}`, `local.get ${value}`, "f64.ne", "if", "else", `local.get ${narrowed}`, "f64.promote_f32", `local.get ${value}`, "f64.ne", "if", "call $__air_v051_numeric_invalid_conversion", "end", "end", `local.get ${narrowed}`);
}

function emitV051TypedZero(state, info) {
  for (const type of info.watTypes) state.body.push(`${type}.const 0`);
}

function emitV051TypedGet(state, record) {
  for (const name of record.names) state.body.push(`local.get ${name}`);
}

function emitV051TypedSet(state, record) {
  for (let index = record.names.length - 1; index >= 0; index -= 1) state.body.push(`local.set ${record.names[index]}`);
}

function v051TypedEnumLiteral(text, type, declaration) {
  const literal = text.match(/^([a-z][a-z0-9._-]{0,127}::)?([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!literal) typedLowerFail("air.v051.typed_lowering_unsupported", `invalid enum literal '${text}'`);
  const moduleId = literal[1] ? literal[1].slice(0, -2) : type.moduleId;
  if (moduleId !== type.moduleId || literal[2] !== type.typeName) typedLowerFail("air.v051.typed_lowering_unsupported", `enum literal type mismatch '${text}'`);
  const entry = (declaration.cases || []).find((item) => item.name === literal[3]);
  if (!entry) typedLowerFail("air.v051.typed_lowering_unsupported", `unknown enum case '${text}'`);
  return entry;
}

function emitV051TypedMatch(state, statement, destination) {
  const subject = state.locals.get(statement.value);
  if (!subject) typedLowerFail("air.v051.typed_lowering_unsupported", `unknown match value '${statement.value}'`);
  const arms = new Map();
  for (const arm of statement.arms || []) arms.set(v051TypedMatchKey(arm.pattern, subject.info), arm);
  const keys = subject.info.kind === "enum"
    ? subject.info.declaration.cases.map((entry) => entry.name)
    : subject.info.kind === "option" ? ["none", "some"]
      : subject.info.kind === "result" ? ["ok", "err"] : null;
  if (!keys) typedLowerFail("air.v051.typed_lowering_unsupported", "match subject is not a tagged type");
  const endLabel = `$__air_v051_match_end_${state.tempId++}`;
  state.body.push(`block ${endLabel}`);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const arm = arms.get(key);
    if (!arm) typedLowerFail("air.v051.typed_lowering_unsupported", `missing verified match arm '${key}'`);
    emitV051TypedMatchCondition(state, subject, key, index);
    state.body.push("if");
    emitV051TypedMatchArm(state, subject, arm, destination);
    state.body.push(`br ${endLabel}`, "end");
  }
  state.body.push("call $__air_v051_invalid_tag");
  state.body.push("end");
}

function emitV051TypedMatchCondition(state, subject, key, index) {
  state.body.push(`local.get ${subject.names[0]}`);
  if (subject.info.kind === "enum") {
    const entry = subject.info.declaration.cases[index];
    state.body.push(`i32.const ${entry.discriminant}`);
  } else {
    state.body.push(`i32.const ${key === "none" || key === "ok" ? 0 : 1}`);
  }
  state.body.push("i32.eq");
}

function emitV051TypedMatchArm(state, subject, arm, destination) {
  const binding = v051TypedMatchBinding(arm.pattern, subject.info);
  let previous;
  if (binding) {
    previous = state.locals.get(binding.name);
    state.locals.set(binding.name, binding.record(subject));
  }
  emitV051TypedExpression(state, arm.expression, destination.type);
  emitV051TypedSet(state, destination);
  if (binding) {
    if (previous) state.locals.set(binding.name, previous);
    else state.locals.delete(binding.name);
  }
}

function v051TypedMatchKey(pattern, info) {
  const value = String(pattern || "").trim();
  if (info.kind === "enum") return value.slice(value.lastIndexOf(".") + 1);
  if (value === "none") return "none";
  const wrapped = value.match(/^(some|ok|err)\([A-Za-z_][A-Za-z0-9_]*\)$/);
  return wrapped ? wrapped[1] : value;
}

function v051TypedMatchBinding(pattern, info) {
  const wrapped = String(pattern || "").trim().match(/^(some|ok|err)\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
  if (!wrapped) return null;
  const name = wrapped[2];
  if (info.kind === "option" && wrapped[1] === "some") {
    return { name, record: (subject) => ({ info: subject.info.payload, names: subject.names.slice(1), parameter: false, type: subject.info.payload.type.canonical }) };
  }
  if (info.kind === "result" && wrapped[1] === "ok") {
    return { name, record: (subject) => ({ info: subject.info.payload, names: subject.names.slice(1, 1 + subject.info.payload.watTypes.length), parameter: false, type: subject.info.payload.type.canonical }) };
  }
  if (info.kind === "result" && wrapped[1] === "err") {
    return { name, record: (subject) => ({ info: subject.info.error, names: subject.names.slice(1 + subject.info.payload.watTypes.length), parameter: false, type: subject.info.error.type.canonical }) };
  }
  typedLowerFail("air.v051.typed_lowering_unsupported", `invalid match binding '${pattern}'`);
}

function splitV051TypedArguments(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "<") depth += 1;
    else if (value[index] === ">") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(value.slice(start));
  return parts;
}

// ---------------------------------------------------------------------------
// typed-v0.53 (SCALAR) lowering. A separate path keyed on the typed-v0.53 tag:
// typed-v0.51 lowering and its WAT budget are unchanged (R-PROF-4). Atoms,
// constructors, ingress validation, enum/option/result matches and the frozen
// checked-i64 helpers are the typed-v0.51 emitters; the SCALAR operations and
// `match` over `bool` are added here.

// R-WB-17 as read by the slice text (R17-a, R17-b): every emitted byte counts,
// exactly (module header, helpers, every function, line separators and the
// closing parenthesis), and a WAT of exactly `maxWatBytes` bytes is produced.
// The first emission that would exceed the cap stops lowering, so no WAT
// beyond the cap is materialized.
function v053WatWriter(maxWatBytes) {
  if (maxWatBytes !== undefined && (!Number.isSafeInteger(maxWatBytes) || maxWatBytes < 1)) {
    throw new V051TypedLoweringError("air.v052.runtime_limits_invalid", "maxWatBytes must be a positive safe integer");
  }
  return {
    maximum: maxWatBytes,
    total: 0,
    charge(bytes) {
      if (this.maximum !== undefined && this.total + bytes > this.maximum) {
        const error = new V051TypedLoweringError("air.v052.work_limit_wat_bytes", `lowered WAT would exceed the configured limit of ${this.maximum}`);
        error.disposition = "BUILD_REFUSED";
        throw error;
      }
      this.total += bytes;
    }
  };
}

// A WAT line list that charges each line as it is pushed: the separator
// before it, its indentation and its bytes. In counting mode (phase-B
// planning) nothing is kept, only counted.
class V053WatLines {
  constructor(writer, indentBytes, counting = false) {
    this.writer = writer;
    this.indentBytes = indentBytes;
    this.lines = counting ? null : [];
    this.count = 0;
  }

  push(...lines) {
    for (const line of lines) {
      if (this.writer) this.writer.charge(1 + this.indentBytes + Buffer.byteLength(line, "utf8"));
      if (this.lines) this.lines.push(line);
      this.count += 1;
    }
    return this.count;
  }

  get length() { return this.count; }
}

const V053_I32_FAMILY = /^i32(?:<-?[0-9]+\.\.-?[0-9]+>)?$/;

const V053_CHECKED_OPERATIONS = new Set([
  "i32.checked_add", "i32.checked_sub", "i32.checked_mul", "i32.checked_div_s", "i32.checked_rem_s",
  "i32.to_f32_checked", "f32.trunc_to_i32_checked",
  "i64.checked_add", "i64.checked_sub", "i64.checked_mul", "i64.checked_div_s", "i64.checked_rem_s", "i64.checked_neg",
  "i64.to_i32_checked", "f64.to_f32_checked"
]);
// Lowered by the frozen typed-v0.51 emitters, unchanged.
const V053_FROZEN_V051_OPERATIONS = new Set([
  "i64.checked_add", "i64.checked_sub", "i64.checked_mul", "i64.checked_div_s", "i64.checked_rem_s", "i64.checked_neg",
  "i64.eq", "i64.ne", "i64.lt_s", "i64.le_s", "i64.gt_s", "i64.ge_s",
  "i64.to_i32_checked", "i32.to_i64", "f32.to_f64", "f64.to_f32_checked"
]);

function v053FunctionUsesCheckedNumeric(fn) {
  return (fn.statements || []).some((statement) => (statement.kind === "local" || statement.kind === "return") &&
    statement.value && typeof statement.value === "object" && V053_CHECKED_OPERATIONS.has(statement.value.op));
}

function v053ModuleFeatures(mod) {
  const declarations = new Map((mod.enums || []).map((item) => [item.type_id, item]));
  const functions = mod.functions || [];
  return {
    declarations,
    usesCanonicalSumIngress: functions.some((fn) => (fn.params || []).some((parameter) => {
      const type = v051TypedTypeInfo(parameter.type, declarations);
      return type.kind === "option" || type.kind === "result";
    })),
    usesCheckedNumeric: functions.some(v053FunctionUsesCheckedNumeric),
    usesTypedRefinement: functions.some(v051TypedFunctionUsesRefinement)
  };
}

// P0-03 failure transport (slice text §4.4; OPEN-38 (b), D-VAL-22): every
// typed-v0.53 artifact exports `__air_failure_reason`, a mutable i32 starting
// at 0, and nothing else carries a reason (T-1, T-2: no numeric global). Each
// AIR-defined trap sets its R-REF-9 value (AMD-P3-1) immediately before
// `unreachable`, on the failing path only (T-3). The helpers keep their
// typed-v0.51 names so the shared ingress emitters call them; their bodies
// here set the registry value. The exhaustive-match fall-through is not a
// language failure and sets nothing (T-4).
const V053_FAILURE_REASON_GLOBAL = "__air_failure_reason";

function v053FailureHelper(name, value) {
  return `  (func $${name} i32.const ${value} global.set $${V053_FAILURE_REASON_GLOBAL} unreachable)`;
}

function v053ModuleHeaderLines(features) {
  return [
    "(module",
    `  (global $${V053_FAILURE_REASON_GLOBAL} (export "${V053_FAILURE_REASON_GLOBAL}") (mut i32) (i32.const 0))`,
    v053FailureHelper("__air_v051_invalid_tag", 49),
    v053FailureHelper("__air_v051_invalid_enum_discriminant", 48),
    v053FailureHelper("__air_v051_invalid_bool", 50),
    "  (func $__air_v053_match_unreachable unreachable)",
    ...(features.usesTypedRefinement ? [
      v053FailureHelper("__air_v053_refinement_ingress_out_of_range", 16),
      v053FailureHelper("__air_v053_refinement_assignment_out_of_range", 17)
    ] : []),
    ...(features.usesCanonicalSumIngress ? [v053FailureHelper("__air_v051_noncanonical_sum_lane", 51)] : []),
    ...(features.usesCheckedNumeric ? [
      v053FailureHelper("__air_v051_numeric_overflow", 1),
      v053FailureHelper("__air_v051_numeric_division_by_zero", 2),
      v053FailureHelper("__air_v051_numeric_invalid_conversion", 3)
    ] : [])
  ];
}

function lowerV053TypedToWat(mod, options = {}) {
  const opts = options || {};
  // An AST entrypoint recomputes both capacity measures before lowering
  // (slice text §3.1), then verifies (phase S).
  enforceAnalysisCapacity(mod, opts.analysisCapacity);
  verifierModule.typedV053.verify(mod);
  const writer = v053WatWriter(opts.maxWatBytes);
  try {
    const features = v053ModuleFeatures(mod);
    const header = v053ModuleHeaderLines(features);
    header.forEach((line, index) => writer.charge((index ? 1 : 0) + Buffer.byteLength(line, "utf8")));
    const functions = (mod.functions || []).map((fn) => lowerV053TypedFunction(fn, features.declarations, writer, false));
    writer.charge(1 + 1);
    const wat = [...header, ...functions, ")"].join("\n");
    if (Buffer.byteLength(wat, "utf8") !== writer.total) {
      typedLowerFail("air.v051.typed_lowering_unsupported", "typed-v0.53 WAT byte accounting mismatch");
    }
    return wat;
  } catch (error) {
    if (error instanceof V051TypedLoweringError) throw error;
    typedLowerFail("air.v051.typed_lowering_unsupported", error && error.message ? error.message : "unsupported typed AST");
  }
}

function lowerV053TypedFunction(fn, declarations, writer, counting) {
  if (fn.returnType === "void") {
    typedLowerFail("air.v051.typed_lowering_unsupported", "void typed functions are not admitted in typed-v0.53 before P0-04");
  }
  const state = {
    declarations,
    localDecls: new V053WatLines(writer, 4, counting),
    locals: new Map(),
    body: new V053WatLines(writer, 4, counting),
    tempId: 0,
    typedV053: true
  };
  const params = [];
  const records = [];
  let parameterLanes = 0;
  for (const parameter of fn.params || []) {
    const info = v051TypedTypeInfo(parameter.type, declarations);
    const record = v051TypedRecord(parameter.name, parameter.type, info, true);
    state.locals.set(parameter.name, record);
    records.push(record);
    parameterLanes += record.names.length;
    if (!counting) {
      for (let index = 0; index < record.names.length; index += 1) params.push(`(param ${record.names[index]} ${info.watTypes[index]})`);
    }
  }
  const resultInfo = v051TypedTypeInfo(fn.returnType, declarations);
  let headerLine = null;
  if (!counting) {
    const result = resultInfo.watTypes.length ? ` (result ${resultInfo.watTypes.join(" ")})` : "";
    const exportDecl = fn.exported ? ` (export "${fn.name}")` : "";
    headerLine = `  (func $${wasmName(fn.name)}${exportDecl}${params.length ? ` ${params.join(" ")}` : ""}${result}`;
    writer.charge(1 + Buffer.byteLength(headerLine, "utf8"));
  }
  // Ingress checks in parameter order, before any other evaluation (T-5).
  for (const record of records) emitV053TypedRuntimeValidation(state, record);
  for (const statement of fn.statements || []) {
    if (statement.kind === "local") {
      const info = v051TypedTypeInfo(statement.type, declarations);
      const record = v051TypedRecord(statement.name, statement.type, info, false);
      state.locals.set(statement.name, record);
      state.localDecls.push(...record.names.map((name, index) => `(local ${name} ${info.watTypes[index]})`));
      emitV053TypedExpression(state, statement.value, statement.type);
      emitV053NarrowingCheck(state, info, statement.value);
      emitV051TypedSet(state, record);
      continue;
    }
    if (statement.kind === "match") {
      const info = v051TypedTypeInfo(statement.destinationType, declarations);
      const record = v051TypedRecord(statement.destination, statement.destinationType, info, false);
      state.locals.set(statement.destination, record);
      state.localDecls.push(...record.names.map((name, index) => `(local ${name} ${info.watTypes[index]})`));
      emitV053TypedMatch(state, statement, record);
      continue;
    }
    if (statement.kind === "return") {
      emitV053TypedExpression(state, statement.value, fn.returnType);
      emitV053NarrowingCheck(state, resultInfo, statement.value);
      state.body.push("return");
      continue;
    }
    typedLowerFail("air.v051.typed_lowering_unsupported", `unsupported statement kind '${statement.kind}'`);
  }
  if (counting) {
    return { locals: parameterLanes + state.localDecls.count, name: fn.name, parameters: parameterLanes, results: resultInfo.watTypes.length };
  }
  writer.charge(1 + 3);
  return [
    headerLine,
    ...state.localDecls.lines.map((line) => `    ${line}`),
    ...state.body.lines.map((line) => `    ${line}`),
    "  )"
  ].join("\n");
}

function emitV053TypedExpression(state, value, expectedType) {
  if (value && typeof value === "object" && value.kind === "numeric_operation") {
    emitV053TypedOperation(state, value, expectedType);
    return;
  }
  emitV051TypedExpression(state, value, expectedType);
}

function emitV053TypedOperation(state, operation, expectedType) {
  const signature = Object.prototype.hasOwnProperty.call(parserModule.typedV053.OPERATIONS, operation.op)
    ? parserModule.typedV053.OPERATIONS[operation.op]
    : null;
  const args = operation.args;
  if (!signature || !Array.isArray(args) || args.length !== signature.args.length || v051TypedBaseTypeName(expectedType) !== signature.result) {
    typedLowerFail("air.v051.typed_lowering_unsupported", `invalid typed-v0.53 operation '${operation.op}'`);
  }
  if (V053_FROZEN_V051_OPERATIONS.has(operation.op)) {
    emitV051TypedNumericOperation(state, operation, expectedType);
    return;
  }
  if (signature.fold === "checked" && signature.width === 32) {
    emitV053CheckedI32(state, signature.operation, args);
    return;
  }
  if (operation.op === "i32.to_f32_checked") {
    emitV053CheckedI32ToF32(state, args[0]);
    return;
  }
  if (operation.op === "f32.trunc_to_i32_checked") {
    emitV053CheckedF32ToI32(state, args[0]);
    return;
  }
  if (signature.wat === "select") {
    // Wasm `select` takes (a, b, condition) and keeps a when the condition is 1.
    emitV051TypedExpression(state, args[1], signature.args[1]);
    emitV051TypedExpression(state, args[2], signature.args[2]);
    emitV051TypedExpression(state, args[0], signature.args[0]);
    state.body.push("select");
    return;
  }
  if (signature.wat) {
    for (let index = 0; index < args.length; index += 1) emitV051TypedExpression(state, args[index], signature.args[index]);
    state.body.push(signature.wat);
    return;
  }
  typedLowerFail("air.v051.typed_lowering_unsupported", `unlowerable typed-v0.53 operation '${operation.op}'`);
}

// RFC §5.1: exact signed i32 arithmetic; a result outside the range fails
// with reason 1 overflow, division or remainder by zero with reason 2, through
// the existing failure global (R-SCL-3). checked_rem_s(MIN, -1) returns 0.
function emitV053CheckedI32(state, operation, args) {
  const left = declareV051TypedTemporary(state, "i32");
  const right = declareV051TypedTemporary(state, "i32");
  emitV051TypedExpression(state, args[0], "i32");
  state.body.push(`local.set ${left}`);
  emitV051TypedExpression(state, args[1], "i32");
  state.body.push(`local.set ${right}`);
  if (operation === "add" || operation === "sub" || operation === "mul") {
    const wide = declareV051TypedTemporary(state, "i64");
    state.body.push(`local.get ${left}`, "i64.extend_i32_s", `local.get ${right}`, "i64.extend_i32_s", `i64.${operation}`, `local.set ${wide}`);
    state.body.push(`local.get ${wide}`, "i64.const 2147483647", "i64.gt_s", `local.get ${wide}`, "i64.const -2147483648", "i64.lt_s", "i32.or", "if", "call $__air_v051_numeric_overflow", "end");
    state.body.push(`local.get ${wide}`, "i32.wrap_i64");
    return;
  }
  state.body.push(`local.get ${right}`, "i32.eqz", "if", "call $__air_v051_numeric_division_by_zero", "end");
  if (operation === "div_s") {
    state.body.push(`local.get ${left}`, "i32.const -2147483648", "i32.eq", `local.get ${right}`, "i32.const -1", "i32.eq", "i32.and", "if", "call $__air_v051_numeric_overflow", "end");
    state.body.push(`local.get ${left}`, `local.get ${right}`, "i32.div_s");
    return;
  }
  state.body.push(`local.get ${left}`, "i32.const -2147483648", "i32.eq", `local.get ${right}`, "i32.const -1", "i32.eq", "i32.and", "if (result i32)", "i32.const 0", "else", `local.get ${left}`, `local.get ${right}`, "i32.rem_s", "end");
}

// RFC §5.2 (OPEN-6 (a)): fails with invalid_conversion unless the binary32
// result is exact; compared in f64, where every i32 and every f32 is exact.
function emitV053CheckedI32ToF32(state, arg) {
  const value = declareV051TypedTemporary(state, "i32");
  const narrowed = declareV051TypedTemporary(state, "f32");
  emitV051TypedExpression(state, arg, "i32");
  state.body.push(`local.set ${value}`, `local.get ${value}`, "f32.convert_i32_s", `local.set ${narrowed}`);
  state.body.push(`local.get ${narrowed}`, "f64.promote_f32", `local.get ${value}`, "f64.convert_i32_s", "f64.ne", "if", "call $__air_v051_numeric_invalid_conversion", "end", `local.get ${narrowed}`);
}

// RFC §5.2 (OPEN-6 (a)): truncates toward zero; NaN, ±∞ and values outside
// [-2^31, 2^31) fail with invalid_conversion before the trapping instruction.
function emitV053CheckedF32ToI32(state, arg) {
  const value = declareV051TypedTemporary(state, "f32");
  emitV051TypedExpression(state, arg, "f32");
  state.body.push(`local.set ${value}`);
  state.body.push(`local.get ${value}`, `local.get ${value}`, "f32.ne", `local.get ${value}`, "f32.const -2147483648", "f32.lt", "i32.or", `local.get ${value}`, "f32.const 2147483648", "f32.ge", "i32.or", "if", "call $__air_v051_numeric_invalid_conversion", "end");
  state.body.push(`local.get ${value}`, "i32.trunc_f32_s");
}

// A `match` over enum, option, result or bool. Each arm is P0-03's yield
// entry point (P3-R5): a value that narrows into a refined destination is
// checked (17) before it is stored. Ingress validation and canonical
// construction make the final fall-through unreachable; it sets no failure
// reason, so it never shares the 49/50 ingress paths (T-4).
function emitV053TypedMatch(state, statement, destination) {
  const subject = state.locals.get(statement.value);
  if (!subject) typedLowerFail("air.v051.typed_lowering_unsupported", `unknown match value '${statement.value}'`);
  const isBool = subject.info.kind === "scalar" && subject.info.type.canonical === "bool";
  const keys = isBool ? ["false", "true"]
    : subject.info.kind === "enum" ? subject.info.declaration.cases.map((entry) => entry.name)
      : subject.info.kind === "option" ? ["none", "some"]
        : subject.info.kind === "result" ? ["ok", "err"] : null;
  if (!keys) typedLowerFail("air.v051.typed_lowering_unsupported", "match subject is not a tagged type or bool");
  const arms = new Map((statement.arms || []).map((arm) => [isBool ? String(arm.pattern).trim() : v051TypedMatchKey(arm.pattern, subject.info), arm]));
  const endLabel = `$__air_v051_match_end_${state.tempId++}`;
  state.body.push(`block ${endLabel}`);
  keys.forEach((key, index) => {
    const arm = arms.get(key);
    if (!arm) typedLowerFail("air.v051.typed_lowering_unsupported", `missing verified match arm '${key}'`);
    if (isBool) state.body.push(`local.get ${subject.names[0]}`, `i32.const ${index}`, "i32.eq");
    else emitV051TypedMatchCondition(state, subject, key, index);
    state.body.push("if");
    const binding = isBool ? null : v051TypedMatchBinding(arm.pattern, subject.info);
    let previous;
    if (binding) {
      previous = state.locals.get(binding.name);
      state.locals.set(binding.name, binding.record(subject));
    }
    emitV053TypedExpression(state, arm.expression, destination.type);
    emitV053NarrowingCheck(state, destination.info, arm.expression);
    emitV051TypedSet(state, destination);
    if (binding) {
      if (previous) state.locals.set(binding.name, previous);
      else state.locals.delete(binding.name);
    }
    state.body.push(`br ${endLabel}`, "end");
  });
  state.body.push("call $__air_v053_match_unreachable", "end");
}

// Ingress (T-3, T-5): a refined parameter's entry check fails with 16; every
// other parameter kind keeps the typed-v0.51 check order, whose helpers set
// 48, 49, 50 and 51 in a typed-v0.53 module.
function emitV053TypedRuntimeValidation(state, record) {
  const { info } = record;
  if (info.kind === "scalar" && info.refinement && info.refinement.kind === "i32_range") {
    emitV053RangeCheck(state, record.names[0], info.refinement, "__air_v053_refinement_ingress_out_of_range");
    return;
  }
  emitV051TypedRuntimeValidation(state, record);
}

function emitV053RangeCheck(state, local, refinement, failureFunction) {
  state.body.push(`local.get ${local}`, `i32.const ${refinement.min}`, "i32.lt_s", `local.get ${local}`, `i32.const ${refinement.max}`, "i32.gt_s", "i32.or", "if", `call $${failureFunction}`, "end");
}

// A refinement entry point (assignment, match-arm yield, return) with the
// value on the stack: no check when the value is a local reference whose
// declared type is contained in the destination (widening, P3-R2); otherwise
// the narrowing check, which fails with 17. Elision of a statically proven
// check is optional (R-REF-4); this lowering keeps it.
function emitV053NarrowingCheck(state, info, value) {
  if (!info || !info.refinement || info.refinement.kind !== "i32_range") return;
  if (v053ContainedReference(state, value, info.refinement)) return;
  const temporary = declareV051TypedTemporary(state, "i32");
  state.body.push(`local.set ${temporary}`);
  emitV053RangeCheck(state, temporary, info.refinement, "__air_v053_refinement_assignment_out_of_range");
  state.body.push(`local.get ${temporary}`);
}

function v053ContainedReference(state, value, destination) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return false;
  const local = state.locals.get(text.slice(1));
  const refinement = local && local.info && local.info.refinement;
  return Boolean(refinement) && refinement.kind === "i32_range" && destination.min <= refinement.min && refinement.max <= destination.max;
}

// Phase-B engine-structural limits (slice text §6.2; owner decision OD-2 (a)):
// the compile-time "Implementation-defined Limits" of the WebAssembly
// JavaScript Interface, W3C Candidate Recommendation Draft of 22 October 2026,
// §8 (https://www.w3.org/TR/2026/CRD-wasm-js-api-2-20261022/#limits; content
// sha256 80a91c1a616752ef40838cffff18e839f9bde4a62de6c9154a86e69e1b47306e).
// The count limits that apply to a typed-v0.53 module are checked before
// lowering starts; a count equal to a limit is admitted. The two size limits
// are covered by maxWasmBytes (AMD-10).
const V053_ENGINE_LIMITS = Object.freeze([
  Object.freeze({ key: "functions", label: "functions", maximum: 1000000 }),
  Object.freeze({ key: "types", label: "types", maximum: 1000000 }),
  Object.freeze({ key: "imports", label: "imports", maximum: 1000000 }),
  Object.freeze({ key: "exports", label: "exports", maximum: 1000000 }),
  Object.freeze({ key: "globals", label: "globals", maximum: 1000000 }),
  Object.freeze({ key: "parameters", label: "parameters per function or block", maximum: 1000, perFunction: true }),
  Object.freeze({ key: "results", label: "results per function or block", maximum: 1000, perFunction: true }),
  Object.freeze({ key: "locals", label: "locals per function (incl. parameters)", maximum: 50000, perFunction: true })
]);

class V053EngineLimitError extends Error {
  constructor(limit, actual, subject) {
    super(`air.build.engine_limit: BUILD_REFUSED ${subject} has ${actual} ${limit.label}; the WebAssembly JavaScript Interface limit is ${limit.maximum} (W3C CRD 2026-10-22, §8)`);
    this.name = "V053EngineLimitError";
    this.code = "air.build.engine_limit";
    this.disposition = "BUILD_REFUSED";
    this.limit = limit.label;
    this.actual = actual;
    this.maximum = limit.maximum;
  }
}

// Counts the module the build would emit: every lane after expansion and every
// lowering temporary, by running the typed-v0.53 lowering in counting mode
// (no WAT is kept). Throws V053EngineLimitError on the first exceeded limit.
function checkV053EngineLimits(mod) {
  if (!isTypedV053Ast(mod)) typedLowerFail("air.v051.typed_lowering_unsupported", "engine-limit planning requires a typed-v0.53 AST");
  const features = v053ModuleFeatures(mod);
  const helpers = v053ModuleHeaderLines(features).filter((line) => line.startsWith("  (func ")).length;
  const plans = (mod.functions || []).map((fn) => lowerV053TypedFunction(fn, features.declarations, null, true));
  const signatures = new Set(helpers ? ["->"] : []);
  for (const fn of mod.functions || []) {
    const lanes = (fn.params || []).flatMap((parameter) => v051TypedTypeInfo(parameter.type, features.declarations).watTypes);
    signatures.add(`${lanes.join(",")}->${v051TypedTypeInfo(fn.returnType, features.declarations).watTypes.join(",")}`);
  }
  // `__air_failure_reason` is the one global and one extra export (T-1).
  const totals = {
    exports: (mod.functions || []).filter((fn) => fn.exported).length + 1,
    functions: (mod.functions || []).length + helpers,
    globals: 1,
    imports: 0,
    types: signatures.size
  };
  for (const limit of V053_ENGINE_LIMITS) {
    if (limit.perFunction) {
      for (const plan of plans) {
        if (plan[limit.key] > limit.maximum) throw new V053EngineLimitError(limit, plan[limit.key], `function '${plan.name}'`);
      }
    } else if (totals[limit.key] > limit.maximum) {
      throw new V053EngineLimitError(limit, totals[limit.key], "the module");
    }
  }
  return Object.freeze({ functions: plans.map((plan) => Object.freeze({ ...plan })), totals: Object.freeze(totals) });
}

function lowerGlobal(global) {
  return `  (global $${global.name} (mut ${watType(global.type)}) (${watType(global.type)}.const ${constNumber(global.init.args[0])}))`;
}

function lowerFunction(fn, ctx) {
  if (isStructuredPhiLoop(fn)) return lowerStructuredPhiLoop(fn, ctx);
  const state = {
    globals: ctx,
    fn,
    blocksByLabel: new Map(fn.blocks.map((block) => [block.label, block])),
    skippedBlocks: new Set(),
    locals: new Map(),
    localTypes: new Map(),
    constants: ctx.constants,
    regions: new Map(),
    localDecls: [],
    tempId: 0,
    instr: []
  };
  for (const param of fn.params) {
    bindParam(state, param);
  }
  emitBorrowedEntryPreflight(state);
  for (const block of fn.blocks) {
    if (!state.skippedBlocks.has(block.label)) lowerBlock(block, state);
  }
  const params = flattenParams(fn.params, ctx.structs).map((p) => `(param ${p.name} ${p.type})`).join(" ");
  const resultTypes = flattenType(fn.returnType, ctx.structs).map(watType);
  const result = resultTypes.length ? ` (result ${resultTypes.join(" ")})` : "";
  const locals = state.localDecls.map((local) => `    (local ${local.name} ${local.type})`);
  const body = state.instr.map((line) => `    ${line}`);
  const exportDecl = fn.exported ? ` (export "${fn.name}")` : "";
  return [`  (func $${wasmName(fn.name)}${exportDecl}${params ? ` ${params}` : ""}${result}`, ...locals, ...body, `  )`].join("\n");
}

function lowerStructuredPhiLoop(fn, ctx) {
  const state = {
    globals: ctx,
    fn,
    blocksByLabel: new Map(fn.blocks.map((block) => [block.label, block])),
    skippedBlocks: new Set(),
    locals: new Map(),
    localTypes: new Map(),
    constants: ctx.constants,
    regions: new Map(),
    localDecls: [],
    tempId: 0,
    instr: []
  };
  for (const param of fn.params) {
    bindParam(state, param);
  }
  emitBorrowedEntryPreflight(state);
  const [entry, header, body, exit] = fn.blocks;
  const phiInstructions = header.instructions.filter((ins) => ins.op.startsWith("phi."));
  for (const phi of phiInstructions) declareLocal(state, phi.result, phi.resultType);

  state.instr.push(`;; block ${entry.label}`);
  for (const ins of entry.instructions.slice(0, -1)) lowerInstruction(ins, state);
  for (const phi of phiInstructions) {
    const incoming = phi.args.find((arg) => arg.label === entry.label);
    if (!incoming) throw new Error(`${phi.result} missing entry incoming`);
    lowerValue(state, { kind: "value", name: incoming.value });
    state.instr.push(`local.set ${scalarLocal(state, phi.result)}`);
  }
  const fuelLocal = "__structured_phi_loop_fuel";
  declareLocal(state, fuelLocal, "i32");
  state.instr.push(`i32.const ${STRUCTURED_PHI_LOOP_FUEL_LIMIT}`);
  state.instr.push(`local.set ${scalarLocal(state, fuelLocal)}`);

  state.instr.push("block");
  state.instr.push("loop");
  state.instr.push(`;; block ${header.label}`);
  const headerBody = header.instructions.slice(phiInstructions.length, -1);
  for (const ins of headerBody) lowerInstruction(ins, state);
  const headerTerm = header.instructions[header.instructions.length - 1];
  lowerValue(state, headerTerm.args[0]);
  state.instr.push("br_if 1");
  emitStructuredPhiLoopFuelCheck(state, fuelLocal);

  state.instr.push(`;; block ${body.label}`);
  for (const ins of body.instructions.slice(0, -1)) lowerInstruction(ins, state);
  for (const phi of phiInstructions) {
    const incoming = phi.args.find((arg) => arg.label === body.label);
    if (!incoming) throw new Error(`${phi.result} missing backedge incoming`);
    lowerValue(state, { kind: "value", name: incoming.value });
    state.instr.push(`local.set ${scalarLocal(state, phi.result)}`);
  }
  state.instr.push("br 0");
  state.instr.push("end");
  state.instr.push("end");

  state.instr.push(`;; block ${exit.label}`);
  for (const ins of exit.instructions) lowerInstruction(ins, state);

  const params = flattenParams(fn.params, ctx.structs).map((p) => `(param ${p.name} ${p.type})`).join(" ");
  const resultTypes = flattenType(fn.returnType, ctx.structs).map(watType);
  const result = resultTypes.length ? ` (result ${resultTypes.join(" ")})` : "";
  const locals = state.localDecls.map((local) => `    (local ${local.name} ${local.type})`);
  const bodyWat = state.instr.map((line) => `    ${line}`);
  const exportDecl = fn.exported ? ` (export "${fn.name}")` : "";
  return [`  (func $${wasmName(fn.name)}${exportDecl}${params ? ` ${params}` : ""}${result}`, ...locals, ...bodyWat, `  )`].join("\n");
}

function emitStructuredPhiLoopFuelCheck(state, fuelLocal) {
  const local = scalarLocal(state, fuelLocal);
  state.instr.push(`local.get ${local}`);
  state.instr.push("i32.eqz");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
  state.instr.push(`local.get ${local}`);
  state.instr.push("i32.const 1");
  state.instr.push("i32.sub");
  state.instr.push(`local.set ${local}`);
}

function isStructuredPhiLoop(fn) {
  if (fn.blocks.length !== 4) return false;
  const [entry, header, body, exit] = fn.blocks;
  const entryLast = entry.instructions[entry.instructions.length - 1];
  const headerLast = header.instructions[header.instructions.length - 1];
  const bodyLast = body.instructions[body.instructions.length - 1];
  const exitLast = exit.instructions[exit.instructions.length - 1];
  return Boolean(
    entryLast?.op === "br" &&
      entryLast.labels[0] === header.label &&
      header.instructions.some((ins) => ins.op.startsWith("phi.")) &&
      headerLast?.op === "br_if" &&
      headerLast.labels[0] === exit.label &&
      headerLast.labels[1] === body.label &&
      bodyLast?.op === "br" &&
      bodyLast.labels[0] === header.label &&
      exitLast?.op === "return"
  );
}

function lowerBlock(block, state) {
  state.instr.push(`;; block ${block.label}`);
  for (const ins of block.instructions) {
    if (ins.op === "br") {
      const target = state.blocksByLabel.get(ins.labels[0]);
      state.skippedBlocks.add(target.label);
      lowerBlock(target, state);
      return;
    }
    if (ins.op === "br_if") {
      const thenBlock = state.blocksByLabel.get(ins.labels[0]);
      const elseBlock = state.blocksByLabel.get(ins.labels[1]);
      state.skippedBlocks.add(thenBlock.label);
      state.skippedBlocks.add(elseBlock.label);
      lowerValue(state, ins.args[0]);
      state.instr.push("if");
      lowerBlock(thenBlock, state);
      state.instr.push("else");
      lowerBlock(elseBlock, state);
      state.instr.push("end");
      state.instr.push("unreachable");
      return;
    }
    lowerInstruction(ins, state);
  }
}

function lowerInstruction(ins, state) {
  if (ins.result) declareLocal(state, ins.result, ins.resultType);
  if (["const.i32", "const.i64", "const.f32", "const.f64", "const.bool"].includes(ins.op)) {
    const type = constWatType(ins.op);
    state.instr.push(`${type}.const ${constNumber(ins.args[0])}`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "const.str") {
    const value = ins.args[0].value;
    const offset = state.globals.dataOffset;
    const len = Buffer.byteLength(value, "utf8");
    state.globals.dataOffset += len + 16;
    state.globals.data.push({ offset, value });
    state.instr.push(`i32.const ${offset}`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    declareLocal(state, `${ins.result}$len`, "i32");
    state.instr.push(`i32.const ${len}`);
    state.instr.push(`local.set ${scalarLocal(state, `${ins.result}$len`)}`);
    return;
  }
  if (
    [
      "i32.add",
      "i32.sub",
      "i32.mul",
      "i32.div_s",
      "i32.rem_s",
      "i32.and",
      "i32.or",
      "i32.xor",
      "i32.shl",
      "i32.shr_u",
      "i32.eq",
      "i32.ne",
      "i32.lt_s",
      "i32.gt_s",
      "i32.le_s",
      "i32.ge_s"
    ].includes(ins.op)
  ) {
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push(ins.op);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (["f32.eq", "f32.ne", "f32.lt", "f32.gt", "f32.le", "f32.ge"].includes(ins.op)) {
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push(ins.op);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (["f32.add", "f32.sub", "f32.mul", "f32.div", "f32.sqrt", "f32.min", "f32.max"].includes(ins.op)) {
    lowerValue(state, ins.args[0]);
    if (ins.args[1]) lowerValue(state, ins.args[1]);
    state.instr.push(ins.op);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "f32.sin" || ins.op === "f32.cos") {
    lowerF32Trig(state, ins);
    return;
  }
  if (ins.op === "f32.clamp") {
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push("f32.max");
    lowerValue(state, ins.args[2]);
    state.instr.push("f32.min");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "f32.lerp") {
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[0]);
    state.instr.push("f32.sub");
    lowerValue(state, ins.args[2]);
    state.instr.push("f32.mul");
    lowerValue(state, ins.args[0]);
    state.instr.push("f32.add");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "f32.inverse_lerp") {
    lowerValue(state, ins.args[2]);
    lowerValue(state, ins.args[0]);
    state.instr.push("f32.sub");
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[0]);
    state.instr.push("f32.sub");
    state.instr.push("f32.div");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "ease.smoothstep") {
    const t = declareTemp(state, "f32");
    lowerValue(state, ins.args[0]);
    state.instr.push(`local.set ${t}`);
    state.instr.push(`local.get ${t}`);
    state.instr.push(`local.get ${t}`);
    state.instr.push("f32.mul");
    state.instr.push("f32.const 3");
    state.instr.push("f32.const 2");
    state.instr.push(`local.get ${t}`);
    state.instr.push("f32.mul");
    state.instr.push("f32.sub");
    state.instr.push("f32.mul");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "ease.out_quad") {
    const inv = declareTemp(state, "f32");
    state.instr.push("f32.const 1");
    lowerValue(state, ins.args[0]);
    state.instr.push("f32.sub");
    state.instr.push(`local.set ${inv}`);
    state.instr.push("f32.const 1");
    state.instr.push(`local.get ${inv}`);
    state.instr.push(`local.get ${inv}`);
    state.instr.push("f32.mul");
    state.instr.push("f32.sub");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "f32.convert_i32_s" || ins.op === "i32.trunc_f32_s") {
    lowerValue(state, ins.args[0]);
    state.instr.push(ins.op);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "bool.and" || ins.op === "bool.or") {
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push(ins.op === "bool.and" ? "i32.and" : "i32.or");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "bool.not") {
    lowerValue(state, ins.args[0]);
    state.instr.push("i32.eqz");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "physics.damp_i32") {
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[2]);
    state.instr.push("i32.mul");
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[3]);
    state.instr.push("i32.mul");
    state.instr.push("i32.add");
    lowerValue(state, ins.args[4]);
    state.instr.push("i32.div_s");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "physics.grounded_i32") {
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[3]);
    state.instr.push("i32.add");
    state.instr.push("i32.le_s");
    lowerValue(state, ins.args[2]);
    state.instr.push("i32.const 0");
    state.instr.push("i32.le_s");
    state.instr.push("i32.and");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "physics.snap_y_i32" || ins.op === "physics.snap_vy_i32") {
    const cond = declareTemp(state, "bool");
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[3]);
    state.instr.push("i32.add");
    state.instr.push("i32.le_s");
    lowerValue(state, ins.args[2]);
    state.instr.push("i32.const 0");
    state.instr.push("i32.le_s");
    state.instr.push("i32.and");
    state.instr.push(`local.set ${cond}`);
    if (ins.op === "physics.snap_y_i32") {
      lowerValue(state, ins.args[1]);
      lowerValue(state, ins.args[0]);
    } else {
      state.instr.push("i32.const 0");
      lowerValue(state, ins.args[2]);
    }
    state.instr.push(`local.get ${cond}`);
    state.instr.push("select");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "fixed.mul_i32") {
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push("i32.mul");
    state.instr.push("i32.const 1000");
    state.instr.push("i32.div_s");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "fixed.div_i32") {
    lowerValue(state, ins.args[0]);
    state.instr.push("i32.const 1000");
    state.instr.push("i32.mul");
    lowerValue(state, ins.args[1]);
    state.instr.push("i32.div_s");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "fixed.clamp_i32") {
    const clamped = declareTemp(state, "i32");
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push("i32.lt_s");
    state.instr.push("select");
    state.instr.push(`local.set ${clamped}`);
    lowerValue(state, ins.args[2]);
    state.instr.push(`local.get ${clamped}`);
    state.instr.push(`local.get ${clamped}`);
    lowerValue(state, ins.args[2]);
    state.instr.push("i32.gt_s");
    state.instr.push("select");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "fixed.lerp_i32") {
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[0]);
    state.instr.push("i32.sub");
    lowerValue(state, ins.args[2]);
    state.instr.push("i32.mul");
    state.instr.push("i32.const 1000");
    state.instr.push("i32.div_s");
    lowerValue(state, ins.args[0]);
    state.instr.push("i32.add");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "select.i32" || ins.op === "select.f32") {
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[2]);
    lowerValue(state, ins.args[0]);
    state.instr.push("select");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  const vectorOp = ins.op.match(/^(vec[234])\.(new|add|sub|scale|dot|len_sq|normalize|x|y|z|w)$/);
  if (vectorOp) {
    const [, type, op] = vectorOp;
    const width = Number(type.slice(3));
    if (op === "new") {
      const dest = vectorLocals(state, ins.result, width);
      for (let idx = 0; idx < width; idx += 1) {
        lowerValue(state, ins.args[idx]);
        state.instr.push(`local.set ${dest[idx]}`);
      }
      return;
    }
    if (op === "add" || op === "sub") {
      const dest = vectorLocals(state, ins.result, width);
      for (let idx = 0; idx < width; idx += 1) {
        lowerVectorComponent(state, ins.args[0], idx);
        lowerVectorComponent(state, ins.args[1], idx);
        state.instr.push(op === "add" ? "f32.add" : "f32.sub");
        state.instr.push(`local.set ${dest[idx]}`);
      }
      return;
    }
    if (op === "scale") {
      const dest = vectorLocals(state, ins.result, width);
      for (let idx = 0; idx < width; idx += 1) {
        lowerVectorComponent(state, ins.args[0], idx);
        lowerValue(state, ins.args[1]);
        state.instr.push("f32.mul");
        state.instr.push(`local.set ${dest[idx]}`);
      }
      return;
    }
    if (op === "dot") {
      lowerVectorDot(state, ins.args[0], ins.args[1], width);
      state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
      return;
    }
    if (op === "len_sq") {
      lowerVectorDot(state, ins.args[0], ins.args[0], width);
      state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
      return;
    }
    if (op === "normalize") {
      const len = declareTemp(state, "f32");
      lowerVectorDot(state, ins.args[0], ins.args[0], width);
      state.instr.push("f32.sqrt");
      state.instr.push(`local.set ${len}`);
      const dest = vectorLocals(state, ins.result, width);
      for (let idx = 0; idx < width; idx += 1) {
        lowerVectorComponent(state, ins.args[0], idx);
        state.instr.push(`local.get ${len}`);
        state.instr.push("f32.div");
        state.instr.push(`local.set ${dest[idx]}`);
      }
      return;
    }
    const component = ["x", "y", "z", "w"].indexOf(op);
    if (component >= 0) {
      lowerVectorComponent(state, ins.args[0], component);
      state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
      return;
    }
  }
  if (ins.op === "vec3.new") {
    const dest = vectorLocals(state, ins.result, 3);
    for (let idx = 0; idx < 3; idx += 1) {
      lowerValue(state, ins.args[idx]);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "vec3.add" || ins.op === "vec3.sub") {
    const dest = vectorLocals(state, ins.result, 3);
    for (let idx = 0; idx < 3; idx += 1) {
      lowerVectorComponent(state, ins.args[0], idx);
      lowerVectorComponent(state, ins.args[1], idx);
      state.instr.push(ins.op === "vec3.add" ? "f32.add" : "f32.sub");
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "vec3.scale") {
    const dest = vectorLocals(state, ins.result, 3);
    for (let idx = 0; idx < 3; idx += 1) {
      lowerVectorComponent(state, ins.args[0], idx);
      lowerValue(state, ins.args[1]);
      state.instr.push("f32.mul");
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "vec3.dot") {
    lowerVec3Dot(state, ins.args[0], ins.args[1]);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "vec3.len_sq") {
    lowerVec3Dot(state, ins.args[0], ins.args[0]);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "vec3.normalize") {
    const len = declareTemp(state, "f32");
    lowerVec3Dot(state, ins.args[0], ins.args[0]);
    state.instr.push("f32.sqrt");
    state.instr.push(`local.set ${len}`);
    const dest = vectorLocals(state, ins.result, 3);
    for (let idx = 0; idx < 3; idx += 1) {
      lowerVectorComponent(state, ins.args[0], idx);
      state.instr.push(`local.get ${len}`);
      state.instr.push("f32.div");
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "vec3.move_relative") {
    const dest = vectorLocals(state, ins.result, 3);
    for (let idx = 0; idx < 3; idx += 1) {
      lowerVectorComponent(state, ins.args[0], idx);
      lowerVectorComponent(state, ins.args[1], idx);
      lowerValue(state, ins.args[3]);
      state.instr.push("f32.mul");
      lowerValue(state, ins.args[5]);
      state.instr.push("f32.mul");
      state.instr.push("f32.add");
      lowerVectorComponent(state, ins.args[2], idx);
      lowerValue(state, ins.args[4]);
      state.instr.push("f32.mul");
      lowerValue(state, ins.args[5]);
      state.instr.push("f32.mul");
      state.instr.push("f32.add");
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "vec3.x" || ins.op === "vec3.y" || ins.op === "vec3.z") {
    const component = ins.op === "vec3.x" ? 0 : ins.op === "vec3.y" ? 1 : 2;
    lowerVectorComponent(state, ins.args[0], component);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "mat4.identity") {
    const dest = matrixLocals(state, ins.result);
    for (let idx = 0; idx < 16; idx += 1) {
      state.instr.push(`f32.const ${idx === 0 || idx === 5 || idx === 10 || idx === 15 ? 1 : 0}`);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "mat4.mul") {
    const dest = matrixLocals(state, ins.result);
    const src = matrixLocals(state, ins.args[0].name);
    for (let idx = 0; idx < 16; idx += 1) {
      state.instr.push(`local.get ${src[idx]}`);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "mat4.from_trs") {
    lowerMat4FromTrs(state, ins);
    return;
  }
  if (ins.op === "mat4.perspective") {
    const dest = matrixLocals(state, ins.result);
    for (let idx = 0; idx < 16; idx += 1) {
      if (idx === 0) lowerValue(state, ins.args[1]);
      else if (idx === 5) lowerValue(state, ins.args[0]);
      else if (idx === 10) lowerValue(state, ins.args[2]);
      else if (idx === 14) lowerValue(state, ins.args[3]);
      else if (idx === 15) state.instr.push("f32.const 1");
      else state.instr.push("f32.const 0");
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "mat4.look_at") {
    const dest = matrixLocals(state, ins.result);
    for (let idx = 0; idx < 16; idx += 1) {
      state.instr.push(`f32.const ${idx === 0 || idx === 5 || idx === 10 || idx === 15 ? 1 : 0}`);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "mat4.store_f32") {
    const src = matrixLocals(state, ins.args[0].name);
    emitRawRegionBoundsCheck(state, ins, ins.args[1], ins.args[2], 64);
    for (let idx = 0; idx < 16; idx += 1) {
      lowerValue(state, ins.args[1]);
      lowerValue(state, ins.args[2]);
      state.instr.push("i32.add");
      if (idx > 0) {
        state.instr.push(`i32.const ${idx * 4}`);
        state.instr.push("i32.add");
      }
      state.instr.push(`local.get ${src[idx]}`);
      state.instr.push("f32.store");
    }
    return;
  }
  if (ins.op === "quat.identity") {
    const dest = vectorLocals(state, ins.result, 4);
    for (let idx = 0; idx < 4; idx += 1) {
      state.instr.push(`f32.const ${idx === 3 ? 1 : 0}`);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "quat.from_axis_angle") {
    const dest = vectorLocals(state, ins.result, 4);
    for (let idx = 0; idx < 3; idx += 1) {
      lowerVectorComponent(state, ins.args[0], idx);
      lowerValue(state, ins.args[1]);
      state.instr.push("f32.const 0.5");
      state.instr.push("f32.mul");
      state.instr.push("f32.mul");
      state.instr.push(`local.set ${dest[idx]}`);
    }
    state.instr.push("f32.const 1");
    state.instr.push(`local.set ${dest[3]}`);
    return;
  }
  if (ins.op === "quat.mul") {
    const dest = vectorLocals(state, ins.result, 4);
    const ax = ins.args[0];
    const bx = ins.args[1];
    lowerQuatMulComponent(state, ax, bx, 0);
    state.instr.push(`local.set ${dest[0]}`);
    lowerQuatMulComponent(state, ax, bx, 1);
    state.instr.push(`local.set ${dest[1]}`);
    lowerQuatMulComponent(state, ax, bx, 2);
    state.instr.push(`local.set ${dest[2]}`);
    lowerQuatMulComponent(state, ax, bx, 3);
    state.instr.push(`local.set ${dest[3]}`);
    return;
  }
  if (ins.op === "quat.rotate_vec3") {
    const dest = vectorLocals(state, ins.result, 3);
    for (let idx = 0; idx < 3; idx += 1) {
      lowerVectorComponent(state, ins.args[1], idx);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "ray.plane_y") {
    lowerValue(state, ins.args[2]);
    lowerVectorComponent(state, ins.args[0], 1);
    state.instr.push("f32.sub");
    lowerVectorComponent(state, ins.args[1], 1);
    state.instr.push("f32.div");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "collision.sphere_sphere") {
    const delta = declareTempComposite(state, "vec3");
    for (let idx = 0; idx < 3; idx += 1) {
      lowerVectorComponent(state, ins.args[0], idx);
      lowerVectorComponent(state, ins.args[2], idx);
      state.instr.push("f32.sub");
      state.instr.push(`local.set ${delta[idx]}`);
    }
    for (let idx = 0; idx < 3; idx += 1) {
      state.instr.push(`local.get ${delta[idx]}`);
      state.instr.push(`local.get ${delta[idx]}`);
      state.instr.push("f32.mul");
      if (idx > 0) state.instr.push("f32.add");
    }
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[3]);
    state.instr.push("f32.add");
    lowerValue(state, ins.args[1]);
    lowerValue(state, ins.args[3]);
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.le");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "struct.new") {
    const dest = compositeLocals(state, ins.result);
    for (let idx = 0; idx < ins.args.length; idx += 1) {
      lowerValue(state, ins.args[idx]);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  const structGet = ins.op.match(/^struct\.get\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (structGet) {
    const fieldIndex = structFieldIndex(state, ins.args[0].name, structGet[1]);
    lowerCompositeComponent(state, ins.args[0], fieldIndex);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  const structSet = ins.op.match(/^struct\.set\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (structSet) {
    const fieldIndex = structFieldIndex(state, ins.args[0].name, structSet[1]);
    const dest = compositeLocals(state, ins.result);
    const src = compositeLocals(state, ins.args[0].name);
    for (let idx = 0; idx < src.length; idx += 1) {
      if (idx === fieldIndex) lowerValue(state, ins.args[1]);
      else state.instr.push(`local.get ${src[idx]}`);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "array.new") {
    const dest = compositeLocals(state, ins.result);
    for (let idx = 0; idx < ins.args.length; idx += 1) {
      lowerValue(state, ins.args[idx]);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (ins.op === "array.get") {
    const index = staticIndexArg(ins.args[1]);
    if (index === undefined) {
      const array = parseArrayType(valueType(state, ins.args[0].name));
      const idxLocal = lowerIndexToTemp(state, ins.args[1], array.length);
      lowerDynamicArrayGet(state, ins.args[0], idxLocal, scalarLocal(state, ins.result));
      return;
    }
    const array = parseArrayType(valueType(state, ins.args[0].name));
    emitConstIndexCheck(state, index, array.length);
    lowerCompositeComponent(state, ins.args[0], index);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "array.set") {
    const index = staticIndexArg(ins.args[1]);
    const dest = compositeLocals(state, ins.result);
    const src = compositeLocals(state, ins.args[0].name);
    if (index === undefined) {
      const array = parseArrayType(valueType(state, ins.args[0].name));
      const idxLocal = lowerIndexToTemp(state, ins.args[1], array.length);
      const valueLocal = declareTemp(state, array.element);
      lowerValue(state, ins.args[2]);
      state.instr.push(`local.set ${valueLocal}`);
      copyComposite(state, src, dest);
      lowerDynamicArraySet(state, idxLocal, valueLocal, dest);
      return;
    }
    const array = parseArrayType(valueType(state, ins.args[0].name));
    emitConstIndexCheck(state, index, array.length);
    for (let idx = 0; idx < src.length; idx += 1) {
      if (idx === index) lowerValue(state, ins.args[2]);
      else state.instr.push(`local.get ${src[idx]}`);
      state.instr.push(`local.set ${dest[idx]}`);
    }
    return;
  }
  if (isTableGetOp(ins.op) || isTableGroupGetOp(ins.op)) {
    const table = tableForInstructionArg(ins.args[0], state.globals.tables);
    if (!table) throw new Error(`unknown table ${ins.args[0].name}`);
    if (isCompactTableType(table.type)) {
      lowerCompactTableGet(state, table, ins);
      return;
    }
    const index = staticIndexArgWithConstants(state, ins.args[1]);
    if (index !== undefined) {
      emitConstIndexCheck(state, index, table.length);
      lowerTableConstValue(state, table, index);
      state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
      return;
    }
    const idxLocal = lowerIndexToTemp(state, ins.args[1], table.length);
    const resultLocal = scalarLocal(state, ins.result);
    lowerTableConstValue(state, table, 0);
    state.instr.push(`local.set ${resultLocal}`);
    for (let idx = 1; idx < table.length; idx += 1) {
      state.instr.push(`local.get ${idxLocal}`);
      state.instr.push(`i32.const ${idx}`);
      state.instr.push("i32.eq");
      state.instr.push("if");
      lowerTableConstValue(state, table, idx);
      state.instr.push(`local.set ${resultLocal}`);
      state.instr.push("end");
    }
    return;
  }
  if (ins.op === "state.len") {
    const segment = loweredStateSegment(state, ins.args[0]);
    state.instr.push(`i32.const ${segment.length}`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "state.get") {
    lowerStateGet(state, ins);
    return;
  }
  if (ins.op === "state.set") {
    lowerStateSet(state, ins);
    return;
  }
  if (ins.op === "pool.capacity") {
    const pool = loweredPool(state, ins.args[0]);
    state.instr.push(`i32.const ${pool.capacity}`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "pool.get.i32" || ins.op === "pool.get.bool") {
    lowerPoolGet(state, ins);
    return;
  }
  if (ins.op === "pool.set.i32" || ins.op === "pool.set.bool") {
    lowerPoolSet(state, ins);
    return;
  }
  if (ins.op === "buffer.from_ptr") {
    const buffer = parseBufferType(ins.resultType);
    const viewBytes = buffer.length * scalarByteWidth(buffer.element);
    emitRawRegionBoundsCheck(state, ins, ins.args[0], { kind: "number", value: 0, raw: "0" }, viewBytes);
    lowerValue(state, ins.args[0]);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "buffer.load") {
    const buffer = parseBufferType(valueType(state, ins.args[0].name));
    emitRuntimeIndexCheck(state, ins.args[1], buffer.length);
    lowerBufferAddress(state, ins.args[0], ins.args[1], buffer);
    state.instr.push(`${buffer.element}.load`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "buffer.store") {
    const buffer = parseBufferType(valueType(state, ins.args[0].name));
    emitRuntimeIndexCheck(state, ins.args[1], buffer.length);
    lowerBufferAddress(state, ins.args[0], ins.args[1], buffer);
    lowerValue(state, ins.args[2]);
    state.instr.push(`${buffer.element}.store`);
    return;
  }
  if (ins.op === "global.get") {
    state.instr.push(`global.get $${ins.args[0].name}`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "global.set") {
    lowerValue(state, ins.args[1]);
    state.instr.push(`global.set $${ins.args[0].name}`);
    return;
  }
  if (ins.op === "print") {
    state.globals.usesFdWrite = true;
    lowerSlice(state, ins.args[0]);
    state.instr.push(`call $__print`);
    state.instr.push(`drop`);
    return;
  }
  if (ins.op === "return") {
    if (ins.args.length) lowerReturnValue(state, ins.args[0]);
    state.instr.push("return");
    return;
  }
  if (ins.op === "alloc_region") {
    // X-SND-05: one disjoint slot per allocation site, covering the verified
    // maximum size; a non-constant size is checked against the slot.
    const slotBytes = Number.isSafeInteger(ins.regionSlotBytes) ? ins.regionSlotBytes : REGION_SLOT_BYTES;
    // QA52 P2-4: checked total of region slots per lowered module.
    state.globals.regionBackingBytes += slotBytes;
    if (state.globals.regionBackingBytes > REGION_BACKING_MAX_BYTES) {
      throw new AirError(`air.memory.region_backing_unsupported: region slots need ${state.globals.regionBackingBytes} bytes; the maintenance limit is ${REGION_BACKING_MAX_BYTES} bytes`);
    }
    const offset = state.globals.dataOffset;
    state.globals.dataOffset += slotBytes;
    state.regions.set(ins.result, { sizeArg: ins.args[0], slotBytes });
    if (!ins.regionSizeConstant) emitRuntimeRegionSlotCheck(state, ins.args[0], slotBytes);
    state.instr.push(`i32.const ${offset}`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "free_region") return;
  if (ins.op === "store.i32" || ins.op === "store.f32") {
    const storeType = ins.op.slice("store.".length);
    const offsetArg = ins.args.length === 3
      ? ins.args[1]
      : { kind: "number", value: 0, raw: "0" };
    emitRawRegionBoundsCheck(state, ins, ins.args[0], offsetArg, scalarByteWidth(storeType));
    lowerValue(state, ins.args[0]);
    if (ins.args.length === 3) {
      lowerValue(state, ins.args[1]);
      state.instr.push("i32.add");
      lowerValue(state, ins.args[2]);
    } else {
      lowerValue(state, ins.args[1]);
    }
    state.instr.push(`${ins.op.slice("store.".length)}.store`);
    return;
  }
  if (ins.op === "load.i32" || ins.op === "load.f32") {
    const loadType = ins.op.slice("load.".length);
    const offsetArg = ins.args.length === 2
      ? ins.args[1]
      : { kind: "number", value: 0, raw: "0" };
    emitRawRegionBoundsCheck(state, ins, ins.args[0], offsetArg, scalarByteWidth(loadType));
    lowerValue(state, ins.args[0]);
    if (ins.args.length === 2) {
      lowerValue(state, ins.args[1]);
      state.instr.push("i32.add");
    }
    state.instr.push(`${ins.op.slice("load.".length)}.load`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "call") {
    for (const check of hostBufferChecksForCall(state, ins)) {
      if (check.status !== "static") emitRegionLengthCheck(state, ins, ins.args[check.ptrIndex], ins.args[check.capIndex]);
    }
    for (const arg of ins.args) lowerCallArgument(state, arg);
    state.instr.push(`call $${wasmName(ins.callee)}`);
    if (ins.result) {
      if (isCompositeLoweredType(valueType(state, ins.result), state.globals.structs)) {
        const dest = compositeLocals(state, ins.result);
        for (let idx = dest.length - 1; idx >= 0; idx -= 1) state.instr.push(`local.set ${dest[idx]}`);
      } else {
        state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
      }
    }
    return;
  }
  if (ins.op === "loop.fold.i32" || ins.op === "loop.fold.f32" || ins.op === "loop.range.i32" || ins.op === "loop.range.f32") {
    const count = staticIndexArg(ins.args[2]);
    lowerValue(state, ins.args[1]);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    if (count === undefined) {
      lowerRangeLoop(state, ins, 4096);
      return;
    }
    for (let idx = 0; idx < count; idx += 1) {
      state.instr.push(`local.get ${scalarLocal(state, ins.result)}`);
      state.instr.push(`call $${wasmName(ins.args[0].name)}`);
      state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    }
    return;
  }
  if (ins.op === "loop.poll") {
    const count = staticIndexArg(ins.args[2]);
    lowerValue(state, ins.args[1]);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    if (count === undefined) {
      lowerPollLoop(state, ins, 4096);
      return;
    }
    for (let idx = 0; idx < count; idx += 1) {
      lowerValue(state, ins.args[1]);
      state.instr.push(`call $${wasmName(ins.args[0].name)}`);
      state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    }
    return;
  }
  if (ins.op === "io.poll_bounded") {
    const count = staticIndexArg(ins.args[1]);
    state.instr.push("i32.const 0");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    if (count === undefined) {
      lowerBoundedIoPollLoop(state, ins, 4096);
      emitReadyStatusTrap(state, scalarLocal(state, ins.result));
      return;
    }
    for (let idx = 0; idx < count; idx += 1) {
      lowerValue(state, ins.args[0]);
      state.instr.push(`call $${wasmName("io.poll")}`);
      state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    }
    emitReadyStatusTrap(state, scalarLocal(state, ins.result));
    return;
  }
  if (ins.op === "loop.array.i32" || ins.op === "loop.array.f32") {
    const array = parseArrayType(valueType(state, ins.args[1].name));
    const dest = compositeLocals(state, ins.result);
    const src = compositeLocals(state, ins.args[1].name);
    copyComposite(state, src, dest);
    const count = staticIndexArg(ins.args[2]);
    if (count !== undefined) {
      emitConstIndexCheck(state, count, array.length + 1);
      for (let idx = 0; idx < count; idx += 1) {
        state.instr.push(`local.get ${dest[idx]}`);
        state.instr.push(`call $${wasmName(ins.args[0].name)}`);
        state.instr.push(`local.set ${dest[idx]}`);
      }
      return;
    }
    lowerArrayLoop(state, ins, array, dest);
    return;
  }
  if (ins.op === "loop.buffer.f32") {
    const count = staticIndexArg(ins.args[2]);
    const value = declareTemp(state, "f32");
    if (count === undefined) {
      lowerBufferLoop(state, ins, value, parseBufferType(valueType(state, ins.args[1].name)));
      return;
    }
    for (let idx = 0; idx < count; idx += 1) {
      lowerBufferAddress(state, ins.args[1], { kind: "number", value: idx, raw: String(idx) }, { element: "f32" });
      state.instr.push("f32.load");
      state.instr.push(`call $${wasmName(ins.args[0].name)}`);
      state.instr.push(`local.set ${value}`);
      lowerBufferAddress(state, ins.args[1], { kind: "number", value: idx, raw: String(idx) }, { element: "f32" });
      state.instr.push(`local.get ${value}`);
      state.instr.push("f32.store");
    }
    return;
  }
  if (ins.op === "slice.from_region") {
    if (ins.regionLengthCheck !== "static") emitRegionLengthCheck(state, ins, ins.args[0], ins.args[1]);
    lowerValue(state, ins.args[0]);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    declareLocal(state, `${ins.result}$len`, "i32");
    lowerValue(state, ins.args[1]);
    state.instr.push(`local.set ${scalarLocal(state, `${ins.result}$len`)}`);
    return;
  }
  if (ins.op === "slice.len") {
    const lenLocal = scalarLocal(state, `${ins.args[0].name}$len`);
    state.instr.push(`local.get ${lenLocal}`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "slice.sub") {
    emitRuntimeSliceBoundsCheck(state, ins.args[0], ins.args[1], ins.args[2]);
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push("i32.add");
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    declareLocal(state, `${ins.result}$len`, "i32");
    lowerValue(state, ins.args[2]);
    state.instr.push(`local.set ${scalarLocal(state, `${ins.result}$len`)}`);
    return;
  }
  if (ins.op === "slice.load.i32" || ins.op === "slice.load.f32") {
    const loadType = ins.op.slice("slice.load.".length);
    emitRuntimeSliceBoundsCheck(state, ins.args[0], ins.args[1], { kind: "number", value: scalarByteWidth(loadType), raw: String(scalarByteWidth(loadType)) });
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push("i32.add");
    state.instr.push(`${loadType}.load`);
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  if (ins.op === "slice.store.i32" || ins.op === "slice.store.f32") {
    const storeType = ins.op.slice("slice.store.".length);
    emitRuntimeSliceBoundsCheck(state, ins.args[0], ins.args[1], { kind: "number", value: scalarByteWidth(storeType), raw: String(scalarByteWidth(storeType)) });
    lowerValue(state, ins.args[0]);
    lowerValue(state, ins.args[1]);
    state.instr.push("i32.add");
    lowerValue(state, ins.args[2]);
    state.instr.push(`${storeType}.store`);
    return;
  }
  if (ins.op === "br" || ins.op === "br_if") return;
  throw new Error(`cannot lower ${ins.op}`);
}

function emitRawRegionBoundsCheck(state, ins, ptrArg, offsetArg, width) {
  if (ins.regionBoundsCheck === "static") return;
  if (!ptrArg || ptrArg.kind !== "value") {
    throw new Error(`cannot bind region bounds for ${ins.op}: expected direct region pointer`);
  }
  const region = state.regions.get(ptrArg.name);
  if (!region) {
    throw new Error(`cannot bind region bounds for ${ins.op}: unknown region ${ptrArg.name}`);
  }

  const sizeLocal = declareTemp(state, "i32");
  const offsetLocal = declareTemp(state, "i32");
  lowerValue(state, region.sizeArg);
  state.instr.push(`local.set ${sizeLocal}`);
  lowerValue(state, offsetArg);
  state.instr.push(`local.set ${offsetLocal}`);

  emitNegativeRuntimeCheck(state, sizeLocal);
  emitNegativeRuntimeCheck(state, offsetLocal);

  state.instr.push(`local.get ${sizeLocal}`);
  state.instr.push(`i32.const ${width}`);
  state.instr.push("i32.lt_u");
  emitRegionBoundsFailureIf(state);

  state.instr.push(`local.get ${offsetLocal}`);
  state.instr.push(`local.get ${sizeLocal}`);
  state.instr.push(`i32.const ${width}`);
  state.instr.push("i32.sub");
  state.instr.push("i32.gt_u");
  emitRegionBoundsFailureIf(state);
}

// X-SND-06 / QA52 P1-2: a host import call always carries its (ptr, capacity)
// checks. The verifier annotates which ones it proved statically; a call it
// did not annotate (for example an AST lowered without verification) is
// checked at runtime for every ptr parameter followed by an i32 capacity, and
// a ptr that is not a live region of this function fails the build.
function hostBufferChecksForCall(state, ins) {
  if (Array.isArray(ins.hostBufferChecks)) return ins.hostBufferChecks;
  const extern = state.globals.externs && state.globals.externs.get(ins.callee);
  if (!extern) return [];
  const checks = [];
  (extern.params || []).forEach((param, idx) => {
    if (param.type !== "ptr") return;
    const ptrArg = ins.args[idx];
    if (!ptrArg || ptrArg.kind !== "value" || !state.regions.has(ptrArg.name)) {
      throw new Error(`cannot bind host buffer for @${ins.callee}: argument ${idx} is not a live region pointer`);
    }
    const capParam = extern.params[idx + 1];
    if (capParam && capParam.type === "i32") checks.push({ ptrIndex: idx, capIndex: idx + 1, status: "dynamic" });
  });
  return checks;
}

function emitRuntimeRegionSlotCheck(state, sizeArg, slotBytes) {
  const sizeLocal = declareTemp(state, "i32");
  lowerValue(state, sizeArg);
  state.instr.push(`local.set ${sizeLocal}`);
  emitNegativeRuntimeCheck(state, sizeLocal);
  state.instr.push(`local.get ${sizeLocal}`);
  state.instr.push(`i32.const ${slotBytes}`);
  state.instr.push("i32.gt_u");
  emitRegionBoundsFailureIf(state);
}

// Fails when `length` is negative or larger than the region's runtime size.
function emitRegionLengthCheck(state, ins, ptrArg, lengthArg) {
  if (!ptrArg || ptrArg.kind !== "value") {
    throw new Error(`cannot bind region length for ${ins.op}: expected direct region pointer`);
  }
  const region = state.regions.get(ptrArg.name);
  if (!region) {
    throw new Error(`cannot bind region length for ${ins.op}: unknown region ${ptrArg.name}`);
  }
  const sizeLocal = declareTemp(state, "i32");
  const lengthLocal = declareTemp(state, "i32");
  lowerValue(state, region.sizeArg);
  state.instr.push(`local.set ${sizeLocal}`);
  lowerValue(state, lengthArg);
  state.instr.push(`local.set ${lengthLocal}`);
  emitNegativeRuntimeCheck(state, lengthLocal);
  state.instr.push(`local.get ${lengthLocal}`);
  state.instr.push(`local.get ${sizeLocal}`);
  state.instr.push("i32.gt_u");
  emitRegionBoundsFailureIf(state);
}

function emitNegativeRuntimeCheck(state, local) {
  state.instr.push(`local.get ${local}`);
  state.instr.push("i32.const 0");
  state.instr.push("i32.lt_s");
  emitRegionBoundsFailureIf(state);
}

function emitRegionBoundsFailureIf(state) {
  state.globals.usesRegionBoundsFailure = true;
  state.instr.push("if");
  state.instr.push(`;; ${REGION_BOUNDS_RUNTIME_CODE}`);
  state.instr.push(`call $${REGION_BOUNDS_FAILURE_FUNCTION}`);
  state.instr.push("end");
}

function lowerValue(state, arg) {
  if (arg.kind === "value") {
    const local = scalarLocal(state, arg.name);
    state.instr.push(`local.get ${local}`);
    return;
  }
  if (arg.kind === "symbol" && state.constants.has(arg.name)) {
    const constant = state.constants.get(arg.name);
    state.instr.push(`${watType(constant.type)}.const ${constNumber(constant.value)}`);
    return;
  }
  if (arg.kind === "number" || arg.kind === "bool") {
    state.instr.push(`i32.const ${constNumber(arg)}`);
    return;
  }
  throw new Error(`cannot lower value ${formatArg(arg)}`);
}

function lowerSlice(state, arg) {
  if (arg.kind === "value") {
    const local = scalarLocal(state, arg.name);
    const lenLocal = scalarLocal(state, `${arg.name}$len`);
    if (!local || !lenLocal) throw new Error(`slice ${arg.name} does not have known static length`);
    state.instr.push(`local.get ${local}`);
    state.instr.push(`local.get ${lenLocal}`);
    return;
  }
  if (arg.kind === "string") {
    const offset = state.globals.dataOffset;
    const len = Buffer.byteLength(arg.value, "utf8");
    state.globals.dataOffset += len + 16;
    state.globals.data.push({ offset, value: arg.value });
    state.instr.push(`i32.const ${offset}`);
    state.instr.push(`i32.const ${len}`);
    return;
  }
  throw new Error(`cannot lower slice ${formatArg(arg)}`);
}

function emitRuntimeSliceBoundsCheck(state, sliceArg, offsetArg, widthArg) {
  const offset = declareTemp(state, "i32");
  const width = declareTemp(state, "i32");
  const length = scalarLocal(state, `${sliceArg.name}$len`);
  const borrowed = valueType(state, sliceArg.name) === BORROWED_SLICE_TYPE;
  lowerValue(state, offsetArg);
  state.instr.push(`local.set ${offset}`);
  lowerValue(state, widthArg);
  state.instr.push(`local.set ${width}`);
  state.instr.push(`local.get ${offset}`);
  state.instr.push("i32.const 0");
  state.instr.push("i32.lt_s");
  emitSliceFailureIf(state, borrowed, BORROW_FAILURE.pointer, "air.borrow.pointer_out_of_bounds");
  state.instr.push("i32.const 0");
  state.instr.push(`local.get ${width}`);
  state.instr.push("i32.gt_s");
  emitSliceFailureIf(state, borrowed, BORROW_FAILURE.pointer, "air.borrow.pointer_out_of_bounds");
  state.instr.push(`local.get ${length}`);
  state.instr.push(`local.get ${width}`);
  state.instr.push("i32.lt_u");
  emitSliceFailureIf(state, borrowed, BORROW_FAILURE.pointer, "air.borrow.pointer_out_of_bounds");
  state.instr.push(`local.get ${offset}`);
  state.instr.push(`local.get ${length}`);
  state.instr.push(`local.get ${width}`);
  state.instr.push("i32.sub");
  state.instr.push("i32.gt_u");
  emitSliceFailureIf(state, borrowed, BORROW_FAILURE.pointer, "air.borrow.pointer_out_of_bounds");
}

function emitSliceFailureIf(state, borrowed, code, diagnostic) {
  state.instr.push("if");
  state.instr.push(`;; ${diagnostic}`);
  if (borrowed) {
    state.globals.usesBorrowFailure = true;
    state.instr.push(`i32.const ${code}`);
    state.instr.push(`call $${BORROW_FAILURE_FUNCTION}`);
  } else {
    state.instr.push("unreachable");
  }
  state.instr.push("end");
}

function emitBorrowedEntryPreflight(state) {
  if (!state.fn.exported) return;
  const borrowed = (state.fn.params || []).filter((param) => param.type === BORROWED_SLICE_TYPE);
  if (!borrowed.length) return;
  state.globals.usesBorrowFailure = true;
  state.instr.push(";; borrowed-slice-v1 entry preflight");
  for (const param of borrowed) {
    emitBorrowedParameterPreflight(state, param);
  }
  for (let left = 0; left < borrowed.length; left += 1) {
    for (let right = left + 1; right < borrowed.length; right += 1) {
      if (borrowed[left].borrow.access === "readonly" && borrowed[right].borrow.access === "readonly") continue;
      emitBorrowedAliasPreflight(state, borrowed[left], borrowed[right]);
    }
  }
  for (const contract of state.fn.requires || []) {
    if (contract.kind === "checked_param") emitCheckedParamPreflight(state, contract);
    if (contract.kind === "checked_borrow_length") emitCheckedBorrowPreflight(state, contract);
  }
}

function emitBorrowedParameterPreflight(state, param) {
  const ptr = scalarLocal(state, `%${param.name}`);
  const length = scalarLocal(state, `%${param.name}$len`);
  const memoryBytes = declareTemp(state, "i32");
  state.instr.push("memory.size");
  state.instr.push("i32.const 16");
  state.instr.push("i32.shl");
  state.instr.push(`local.set ${memoryBytes}`);

  state.instr.push(`local.get ${length}`);
  state.instr.push("i32.const 0");
  state.instr.push("i32.lt_s");
  emitBorrowFailureIf(state, BORROW_FAILURE.length, "air.borrow.length_out_of_range");
  if (param.borrow.length.min > 0) {
    state.instr.push(`local.get ${length}`);
    state.instr.push(`i32.const ${param.borrow.length.min}`);
    state.instr.push("i32.lt_s");
    emitBorrowFailureIf(state, BORROW_FAILURE.length, "air.borrow.length_out_of_range");
  }
  state.instr.push(`local.get ${length}`);
  state.instr.push(`i32.const ${param.borrow.length.max}`);
  state.instr.push("i32.gt_s");
  emitBorrowFailureIf(state, BORROW_FAILURE.length, "air.borrow.length_out_of_range");

  if (param.borrow.alignment > 1) {
    state.instr.push(`local.get ${ptr}`);
    state.instr.push(`i32.const ${param.borrow.alignment - 1}`);
    state.instr.push("i32.and");
    emitBorrowFailureIf(state, BORROW_FAILURE.alignment, "air.borrow.alignment_mismatch");
  }

  state.instr.push(`local.get ${ptr}`);
  state.instr.push(`local.get ${memoryBytes}`);
  state.instr.push("i32.gt_u");
  emitBorrowFailureIf(state, BORROW_FAILURE.pointer, "air.borrow.pointer_out_of_bounds");
  state.instr.push(`local.get ${length}`);
  state.instr.push(`local.get ${memoryBytes}`);
  state.instr.push(`local.get ${ptr}`);
  state.instr.push("i32.sub");
  state.instr.push("i32.gt_u");
  emitBorrowFailureIf(state, BORROW_FAILURE.pointer, "air.borrow.pointer_out_of_bounds");
}

function emitBorrowedAliasPreflight(state, left, right) {
  const leftPtr = scalarLocal(state, `%${left.name}`);
  const leftLength = scalarLocal(state, `%${left.name}$len`);
  const rightPtr = scalarLocal(state, `%${right.name}`);
  const rightLength = scalarLocal(state, `%${right.name}$len`);
  const leftEnd = declareTemp(state, "i32");
  const rightEnd = declareTemp(state, "i32");
  state.instr.push(`local.get ${leftPtr}`);
  state.instr.push(`local.get ${leftLength}`);
  state.instr.push("i32.add");
  state.instr.push(`local.set ${leftEnd}`);
  state.instr.push(`local.get ${rightPtr}`);
  state.instr.push(`local.get ${rightLength}`);
  state.instr.push("i32.add");
  state.instr.push(`local.set ${rightEnd}`);
  state.instr.push(`local.get ${leftLength}`);
  state.instr.push("i32.eqz");
  state.instr.push("i32.eqz");
  state.instr.push(`local.get ${rightLength}`);
  state.instr.push("i32.eqz");
  state.instr.push("i32.eqz");
  state.instr.push("i32.and");
  state.instr.push(`local.get ${leftPtr}`);
  state.instr.push(`local.get ${rightEnd}`);
  state.instr.push("i32.lt_u");
  state.instr.push("i32.and");
  state.instr.push(`local.get ${rightPtr}`);
  state.instr.push(`local.get ${leftEnd}`);
  state.instr.push("i32.lt_u");
  state.instr.push("i32.and");
  emitBorrowFailureIf(state, BORROW_FAILURE.overlap, "air.borrow.mutable_overlap");
}

function emitCheckedParamPreflight(state, contract) {
  const param = scalarLocal(state, `%${contract.parameter}`);
  state.instr.push(`local.get ${param}`);
  state.instr.push(`i32.const ${contract.literal}`);
  state.instr.push(contract.op === ">=" ? "i32.lt_s" : contract.op === "<=" ? "i32.gt_s" : "i32.ne");
  emitBorrowFailureIf(state, BORROW_FAILURE.relation, "air.borrow.entry_relation_failed");
}

function emitCheckedBorrowPreflight(state, contract) {
  const param = scalarLocal(state, `%${contract.parameter}`);
  const length = scalarLocal(state, `%${contract.borrow}$len`);
  state.instr.push(`local.get ${param}`);
  state.instr.push("i32.const 0");
  state.instr.push("i32.lt_s");
  emitBorrowFailureIf(state, BORROW_FAILURE.arithmetic, "air.borrow.entry_arithmetic_overflow");
  state.instr.push(`local.get ${param}`);
  state.instr.push(`i32.const ${Math.floor(2147483647 / contract.multiplier)}`);
  state.instr.push("i32.gt_s");
  emitBorrowFailureIf(state, BORROW_FAILURE.arithmetic, "air.borrow.entry_arithmetic_overflow");
  state.instr.push(`local.get ${length}`);
  state.instr.push(`local.get ${param}`);
  state.instr.push(`i32.const ${contract.multiplier}`);
  state.instr.push("i32.mul");
  state.instr.push("i32.lt_u");
  emitBorrowFailureIf(state, BORROW_FAILURE.relation, "air.borrow.entry_relation_failed");
}

function emitBorrowFailureIf(state, code, diagnostic) {
  state.instr.push("if");
  state.instr.push(`;; ${diagnostic}`);
  state.instr.push(`i32.const ${code}`);
  state.instr.push(`call $${BORROW_FAILURE_FUNCTION}`);
  state.instr.push("end");
}

function lowerVectorComponent(state, arg, idx) {
  const width = vectorWidth(valueType(state, arg.name));
  const locals = vectorLocals(state, arg.name, width);
  state.instr.push(`local.get ${locals[idx]}`);
}

function lowerVectorDot(state, left, right, width) {
  for (let idx = 0; idx < width; idx += 1) {
    lowerVectorComponent(state, left, idx);
    lowerVectorComponent(state, right, idx);
    state.instr.push("f32.mul");
    if (idx > 0) state.instr.push("f32.add");
  }
}

function lowerVec3Dot(state, left, right) {
  lowerVectorDot(state, left, right, 3);
}

function lowerQuatMulComponent(state, left, right, component) {
  const terms = [
    [
      [3, 0, 1],
      [0, 3, 1],
      [1, 2, 1],
      [2, 1, -1]
    ],
    [
      [3, 1, 1],
      [0, 2, -1],
      [1, 3, 1],
      [2, 0, 1]
    ],
    [
      [3, 2, 1],
      [0, 1, 1],
      [1, 0, -1],
      [2, 3, 1]
    ],
    [
      [3, 3, 1],
      [0, 0, -1],
      [1, 1, -1],
      [2, 2, -1]
    ]
  ][component];
  terms.forEach(([a, b, sign], idx) => {
    lowerVectorComponent(state, left, a);
    lowerVectorComponent(state, right, b);
    state.instr.push("f32.mul");
    if (sign < 0) {
      state.instr.push("f32.const -1");
      state.instr.push("f32.mul");
    }
    if (idx > 0) state.instr.push("f32.add");
  });
}

function lowerF32Trig(state, ins) {
  const x = declareTemp(state, "f32");
  const x2 = declareTemp(state, "f32");
  lowerValue(state, ins.args[0]);
  state.instr.push(`local.set ${x}`);
  state.instr.push(`local.get ${x}`);
  state.instr.push("f32.const 3.1415927");
  state.instr.push("f32.gt");
  state.instr.push("if");
  state.instr.push(`local.get ${x}`);
  state.instr.push("f32.const 6.2831855");
  state.instr.push("f32.sub");
  state.instr.push(`local.set ${x}`);
  state.instr.push("end");
  state.instr.push(`local.get ${x}`);
  state.instr.push("f32.const -3.1415927");
  state.instr.push("f32.lt");
  state.instr.push("if");
  state.instr.push(`local.get ${x}`);
  state.instr.push("f32.const 6.2831855");
  state.instr.push("f32.add");
  state.instr.push(`local.set ${x}`);
  state.instr.push("end");
  state.instr.push(`local.get ${x}`);
  state.instr.push(`local.get ${x}`);
  state.instr.push("f32.mul");
  state.instr.push(`local.set ${x2}`);
  if (ins.op === "f32.sin") {
    state.instr.push(`local.get ${x}`);
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const -0.16666667");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const 0.008333331");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const -0.00019840874");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const 0.0000027525562");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.const 1");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
  } else {
    state.instr.push("f32.const 1");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const -0.5");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const 0.041666667");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const -0.0013888889");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const 0.000024801587");
    state.instr.push(`local.get ${x2}`);
    state.instr.push("f32.const -0.0000002755732");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
    state.instr.push("f32.mul");
    state.instr.push("f32.add");
  }
  state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
}

function lowerMat4FromTrs(state, ins) {
  const dest = matrixLocals(state, ins.result);
  const q = Array.from({ length: 4 }, () => declareTemp(state, "f32"));
  const p = Array.from({ length: 3 }, () => declareTemp(state, "f32"));
  const s = Array.from({ length: 3 }, () => declareTemp(state, "f32"));
  for (let idx = 0; idx < 3; idx += 1) {
    lowerVectorComponent(state, ins.args[0], idx);
    state.instr.push(`local.set ${p[idx]}`);
  }
  for (let idx = 0; idx < 4; idx += 1) {
    lowerVectorComponent(state, ins.args[1], idx);
    state.instr.push(`local.set ${q[idx]}`);
  }
  for (let idx = 0; idx < 3; idx += 1) {
    lowerVectorComponent(state, ins.args[2], idx);
    state.instr.push(`local.set ${s[idx]}`);
  }

  const [x, y, z, w] = q;
  const [sx, sy, sz] = s;
  emitMatTerm(state, dest[0], ["one", ["neg", ["two", ["mul", y, y]]], ["neg", ["two", ["mul", z, z]]], ["scale", sx]]);
  emitMatTerm(state, dest[1], [["two", ["mul", x, y]], ["two", ["mul", w, z]], ["scale", sx]]);
  emitMatTerm(state, dest[2], [["two", ["mul", x, z]], ["neg", ["two", ["mul", w, y]]], ["scale", sx]]);
  emitConstToLocal(state, dest[3], 0);
  emitMatTerm(state, dest[4], [["two", ["mul", x, y]], ["neg", ["two", ["mul", w, z]]], ["scale", sy]]);
  emitMatTerm(state, dest[5], ["one", ["neg", ["two", ["mul", x, x]]], ["neg", ["two", ["mul", z, z]]], ["scale", sy]]);
  emitMatTerm(state, dest[6], [["two", ["mul", y, z]], ["two", ["mul", w, x]], ["scale", sy]]);
  emitConstToLocal(state, dest[7], 0);
  emitMatTerm(state, dest[8], [["two", ["mul", x, z]], ["two", ["mul", w, y]], ["scale", sz]]);
  emitMatTerm(state, dest[9], [["two", ["mul", y, z]], ["neg", ["two", ["mul", w, x]]], ["scale", sz]]);
  emitMatTerm(state, dest[10], ["one", ["neg", ["two", ["mul", x, x]]], ["neg", ["two", ["mul", y, y]]], ["scale", sz]]);
  emitConstToLocal(state, dest[11], 0);
  state.instr.push(`local.get ${p[0]}`);
  state.instr.push(`local.set ${dest[12]}`);
  state.instr.push(`local.get ${p[1]}`);
  state.instr.push(`local.set ${dest[13]}`);
  state.instr.push(`local.get ${p[2]}`);
  state.instr.push(`local.set ${dest[14]}`);
  emitConstToLocal(state, dest[15], 1);
}

function emitConstToLocal(state, local, value) {
  state.instr.push(`f32.const ${value}`);
  state.instr.push(`local.set ${local}`);
}

function emitMatTerm(state, local, parts) {
  const scale = parts.find((part) => Array.isArray(part) && part[0] === "scale");
  const terms = scale ? parts.filter((part) => part !== scale) : parts;
  emitExpr(state, terms[0]);
  for (const term of terms.slice(1)) {
    emitExpr(state, term);
    state.instr.push("f32.add");
  }
  if (scale) {
    state.instr.push(`local.get ${scale[1]}`);
    state.instr.push("f32.mul");
  }
  state.instr.push(`local.set ${local}`);
}

function emitExpr(state, expr) {
  if (expr === "one") {
    state.instr.push("f32.const 1");
    return;
  }
  if (typeof expr === "string") {
    state.instr.push(`local.get ${expr}`);
    return;
  }
  const [op, a, b] = expr;
  if (op === "neg") {
    state.instr.push("f32.const 0");
    emitExpr(state, a);
    state.instr.push("f32.sub");
    return;
  }
  if (op === "two") {
    emitExpr(state, a);
    state.instr.push("f32.const 2");
    state.instr.push("f32.mul");
    return;
  }
  if (op === "mul") {
    emitExpr(state, a);
    emitExpr(state, b);
    state.instr.push("f32.mul");
    return;
  }
  throw new Error(`unknown mat4.from_trs expression '${op}'`);
}

function scalarLocal(state, name) {
  const found = state.locals.get(name);
  if (!found) throw new Error(`missing local for ${name}`);
  if (typeof found !== "string") throw new Error(`${name} is a composite value and cannot be used as scalar`);
  return found;
}

function vectorLocals(state, name, expectedCount) {
  const found = state.locals.get(name);
  if (!found) throw new Error(`missing local for ${name}`);
  if (typeof found === "string") throw new Error(`${name} is a scalar value and cannot be used as vector`);
  if (found.components.length !== expectedCount) throw new Error(`${name} is ${found.type}, expected vec${expectedCount}`);
  return found.components;
}

function vectorWidth(type) {
  if (type === "quat") return 4;
  if (/^vec[234]$/.test(type)) return Number(type.slice(3));
  throw new Error(`expected vector type, got ${type}`);
}

function matrixLocals(state, name) {
  const found = state.locals.get(name);
  if (!found) throw new Error(`missing local for ${name}`);
  if (typeof found === "string") throw new Error(`${name} is a scalar value and cannot be used as matrix`);
  if (found.type !== "mat4" || found.components.length !== 16) throw new Error(`${name} is ${found.type}, expected mat4`);
  return found.components;
}

function compositeLocals(state, name) {
  const found = state.locals.get(name);
  if (!found) throw new Error(`missing local for ${name}`);
  if (typeof found === "string") throw new Error(`${name} is a scalar value and cannot be used as composite`);
  return found.components;
}

function lowerCompositeComponent(state, arg, idx) {
  const locals = compositeLocals(state, arg.name);
  state.instr.push(`local.get ${locals[idx]}`);
}

function valueType(state, name) {
  const type = state.localTypes.get(name);
  if (!type) throw new Error(`missing type for ${name}`);
  return type;
}

function structFieldIndex(state, valueName, fieldName) {
  const type = valueType(state, valueName);
  const struct = state.globals.structs.get(type);
  if (!struct) throw new Error(`${valueName} is not a struct`);
  const index = struct.fields.findIndex((field) => field.name === fieldName);
  if (index < 0) throw new Error(`${type} has no field ${fieldName}`);
  return index;
}

function staticIndexArg(arg) {
  if (arg.kind === "number") return arg.value;
  return undefined;
}

function staticIndexArgWithConstants(state, arg) {
  if (arg.kind === "number") return arg.value;
  if (arg.kind === "symbol" && state.constants.has(arg.name)) {
    const constant = state.constants.get(arg.name);
    return literalNumber(constant.value);
  }
  return undefined;
}

function lowerTableConstValue(state, table, index) {
  const value = table.values[index];
  if (value && value.kind === "symbol" && state.constants.has(value.name)) {
    state.instr.push(`${watType(table.type)}.const ${literalNumber(state.constants.get(value.name).value)}`);
    return;
  }
  state.instr.push(`${watType(table.type)}.const ${literalNumber(value)}`);
}

function lowerCompactTableGet(state, table, ins) {
  const data = state.globals.tableData.get(table.name);
  if (!data) throw new Error(`compact table ${table.name} has no data segment`);
  const index = staticIndexArgWithConstants(state, ins.args[1]);
  if (index !== undefined) {
    emitConstIndexCheck(state, index, table.length);
    state.instr.push(`i32.const ${data.offset + index * data.width}`);
    state.instr.push(compactLoadOp(table.type));
    state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
    return;
  }
  const idxLocal = lowerIndexToTemp(state, ins.args[1], table.length);
  state.instr.push(`i32.const ${data.offset}`);
  state.instr.push(`local.get ${idxLocal}`);
  if (data.width !== 1) {
    state.instr.push(`i32.const ${data.width}`);
    state.instr.push("i32.mul");
  }
  state.instr.push("i32.add");
  state.instr.push(compactLoadOp(table.type));
  state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
}

function compactLoadOp(type) {
  if (type === "u8") return "i32.load8_u";
  if (type === "u16") return "i32.load16_u";
  if (type === "i16") return "i32.load16_s";
  throw new Error(`unsupported compact table type ${type}`);
}

function allocateCompactTables(ctx, tables) {
  for (const table of tables) {
    if (!isCompactTableType(table.type)) continue;
    const width = tableStorageByteWidth(table.type);
    const offset = ctx.dataOffset;
    const bytes = compactTableBytes(ctx, table, width);
    ctx.tableData.set(table.name, { offset, width, byteLength: bytes.length });
    ctx.data.push({ offset, bytes });
    ctx.dataOffset += bytes.length + 16;
  }
}

function compactTableBytes(ctx, table, width) {
  const bytes = [];
  for (const value of table.values || []) {
    const literal = tableLiteralNumber(ctx, value);
    if (width === 1) {
      bytes.push(literal & 0xff);
    } else {
      const encoded = literal & 0xffff;
      bytes.push(encoded & 0xff, (encoded >> 8) & 0xff);
    }
  }
  return bytes;
}

function tableLiteralNumber(ctx, value) {
  if (value && value.kind === "symbol" && ctx.constants.has(value.name)) {
    return literalNumber(ctx.constants.get(value.name).value);
  }
  return literalNumber(value);
}

function isCompactTableType(type) {
  return type === "u8" || type === "u16" || type === "i16";
}

function isTableGetOp(op) {
  return op === "table.get" || op === "table.get.u8" || op === "table.get.u16" || op === "table.get.i16";
}

function isTableGroupGetOp(op) {
  return op === "tablegroup.get.i32" || op === "tablegroup.get.bool";
}

function tableForInstructionArg(arg, tables) {
  if (arg && arg.kind === "symbol") return tables.get(arg.name);
  if (arg && arg.kind === "tablegroupField") return tables.get(tablegroupBackingTableName(arg.group, arg.field));
  return null;
}

function tablegroupBackingTableName(group, field) {
  return `__tablegroup_${group}_${field}`;
}

function allocateStateCells(ctx, states) {
  for (const segment of states) {
    const cells = [];
    for (let idx = 0; idx < segment.length; idx += 1) {
      cells.push(`$__air_state_${wasmName(segment.name)}_${idx}`);
    }
    ctx.stateCells.set(segment.name, cells);
  }
}

function lowerStateCellGlobals(ctx) {
  const out = [];
  for (const segment of ctx.states.values()) {
    const init = stateInitNumber(segment);
    const cells = ctx.stateCells.get(segment.name) || [];
    for (const cell of cells) {
      out.push(`  (global ${cell} (mut i32) (i32.const ${init}))`);
    }
  }
  return out;
}

function allocatePoolCells(ctx, pools) {
  for (const pool of pools) {
    const fieldCells = new Map();
    for (const field of pool.fields || []) {
      const cells = [];
      for (let idx = 0; idx < pool.capacity; idx += 1) {
        cells.push(`$__air_pool_${wasmName(pool.name)}_${wasmName(field.name)}_${idx}`);
      }
      fieldCells.set(field.name, cells);
    }
    ctx.poolCells.set(pool.name, fieldCells);
  }
}

function lowerPoolCellGlobals(ctx) {
  const out = [];
  for (const pool of ctx.pools.values()) {
    const fieldCells = ctx.poolCells.get(pool.name) || new Map();
    for (const field of pool.fields || []) {
      const init = literalNumber(field.init);
      const cells = fieldCells.get(field.name) || [];
      for (const cell of cells) {
        out.push(`  (global ${cell} (mut i32) (i32.const ${init}))`);
      }
    }
  }
  return out;
}

function stateInitNumber(segment) {
  return literalNumber(segment.init?.value);
}

function loweredStateSegment(state, arg) {
  if (!arg || arg.kind !== "symbol") throw new Error(`state operation requires a state symbol`);
  const segment = state.globals.states.get(arg.name);
  if (!segment) throw new Error(`unknown state ${arg.name}`);
  if (segment.type !== "i32") throw new Error(`cannot lower ${segment.type} state ${segment.name}`);
  return segment;
}

function lowerStateGet(state, ins) {
  const segment = loweredStateSegment(state, ins.args[0]);
  const cells = loweredStateCells(state, segment);
  const index = staticIndexArgWithConstants(state, ins.args[1]);
  const resultLocal = scalarLocal(state, ins.result);
  if (index !== undefined) {
    emitConstIndexCheck(state, index, segment.length);
    if (index < 0 || index >= segment.length) return;
    state.instr.push(`global.get ${cells[index]}`);
    state.instr.push(`local.set ${resultLocal}`);
    return;
  }

  const idxLocal = lowerIndexToTemp(state, ins.args[1], segment.length);
  state.instr.push("i32.const 0");
  state.instr.push(`local.set ${resultLocal}`);
  for (let idx = 0; idx < cells.length; idx += 1) {
    state.instr.push(`local.get ${idxLocal}`);
    state.instr.push(`i32.const ${idx}`);
    state.instr.push("i32.eq");
    state.instr.push("if");
    state.instr.push(`global.get ${cells[idx]}`);
    state.instr.push(`local.set ${resultLocal}`);
    state.instr.push("end");
  }
}

function lowerStateSet(state, ins) {
  const segment = loweredStateSegment(state, ins.args[0]);
  const cells = loweredStateCells(state, segment);
  const index = staticIndexArgWithConstants(state, ins.args[1]);
  if (index !== undefined) {
    emitConstIndexCheck(state, index, segment.length);
    if (index < 0 || index >= segment.length) return;
    lowerValue(state, ins.args[2]);
    state.instr.push(`global.set ${cells[index]}`);
    return;
  }

  const idxLocal = lowerIndexToTemp(state, ins.args[1], segment.length);
  const valueLocal = declareTemp(state, "i32");
  lowerValue(state, ins.args[2]);
  state.instr.push(`local.set ${valueLocal}`);
  for (let idx = 0; idx < cells.length; idx += 1) {
    state.instr.push(`local.get ${idxLocal}`);
    state.instr.push(`i32.const ${idx}`);
    state.instr.push("i32.eq");
    state.instr.push("if");
    state.instr.push(`local.get ${valueLocal}`);
    state.instr.push(`global.set ${cells[idx]}`);
    state.instr.push("end");
  }
}

function loweredStateCells(state, segment) {
  const cells = state.globals.stateCells.get(segment.name);
  if (!cells) throw new Error(`state ${segment.name} has no lowered storage`);
  return cells;
}

function loweredPool(state, arg) {
  if (!arg || arg.kind !== "poolName") throw new Error(`pool operation requires a pool symbol`);
  const pool = state.globals.pools.get(arg.name);
  if (!pool) throw new Error(`unknown pool ${arg.name}`);
  return pool;
}

function loweredPoolField(state, arg) {
  if (!arg || arg.kind !== "poolField") throw new Error(`pool operation requires a pool field`);
  const pool = state.globals.pools.get(arg.pool);
  if (!pool) throw new Error(`unknown pool ${arg.pool}`);
  const field = (pool.fields || []).find((item) => item.name === arg.field);
  if (!field) throw new Error(`unknown pool field ${arg.name}`);
  const fieldCells = state.globals.poolCells.get(pool.name);
  const cells = fieldCells && fieldCells.get(field.name);
  if (!cells) throw new Error(`pool ${pool.name}.${field.name} has no lowered storage`);
  return { pool, field, cells };
}

function lowerPoolGet(state, ins) {
  const lowered = loweredPoolField(state, ins.args[0]);
  const index = staticIndexArgWithConstants(state, ins.args[1]);
  const resultLocal = scalarLocal(state, ins.result);
  if (index !== undefined) {
    emitConstIndexCheck(state, index, lowered.pool.capacity);
    if (index < 0 || index >= lowered.pool.capacity) return;
    state.instr.push(`global.get ${lowered.cells[index]}`);
    state.instr.push(`local.set ${resultLocal}`);
    return;
  }

  const idxLocal = lowerIndexToTemp(state, ins.args[1], lowered.pool.capacity);
  state.instr.push("i32.const 0");
  state.instr.push(`local.set ${resultLocal}`);
  for (let idx = 0; idx < lowered.cells.length; idx += 1) {
    state.instr.push(`local.get ${idxLocal}`);
    state.instr.push(`i32.const ${idx}`);
    state.instr.push("i32.eq");
    state.instr.push("if");
    state.instr.push(`global.get ${lowered.cells[idx]}`);
    state.instr.push(`local.set ${resultLocal}`);
    state.instr.push("end");
  }
}

function lowerPoolSet(state, ins) {
  const lowered = loweredPoolField(state, ins.args[0]);
  const index = staticIndexArgWithConstants(state, ins.args[1]);
  if (index !== undefined) {
    emitConstIndexCheck(state, index, lowered.pool.capacity);
    if (index < 0 || index >= lowered.pool.capacity) return;
    lowerValue(state, ins.args[2]);
    state.instr.push(`global.set ${lowered.cells[index]}`);
    return;
  }

  const idxLocal = lowerIndexToTemp(state, ins.args[1], lowered.pool.capacity);
  const valueLocal = declareTemp(state, "i32");
  lowerValue(state, ins.args[2]);
  state.instr.push(`local.set ${valueLocal}`);
  for (let idx = 0; idx < lowered.cells.length; idx += 1) {
    state.instr.push(`local.get ${idxLocal}`);
    state.instr.push(`i32.const ${idx}`);
    state.instr.push("i32.eq");
    state.instr.push("if");
    state.instr.push(`local.get ${valueLocal}`);
    state.instr.push(`global.set ${lowered.cells[idx]}`);
    state.instr.push("end");
  }
}

function literalNumber(value) {
  if (!value) return 0;
  if (value.kind === "bool") return value.value ? 1 : 0;
  if (value.kind === "number") return value.value;
  return 0;
}

function emitConstIndexCheck(state, index, length) {
  if (index < 0 || index >= length) state.instr.push("unreachable");
}

function emitRuntimeIndexCheck(state, indexArg, length) {
  lowerValue(state, indexArg);
  state.instr.push("i32.const 0");
  state.instr.push("i32.lt_s");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
  lowerValue(state, indexArg);
  state.instr.push(`i32.const ${length}`);
  state.instr.push("i32.ge_s");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
}

function lowerIndexToTemp(state, indexArg, length) {
  const idxLocal = declareTemp(state, "i32");
  lowerValue(state, indexArg);
  state.instr.push(`local.set ${idxLocal}`);
  emitRuntimeIndexCheckFromLocal(state, idxLocal, length);
  return idxLocal;
}

function emitRuntimeIndexCheckFromLocal(state, idxLocal, length) {
  state.instr.push(`local.get ${idxLocal}`);
  state.instr.push("i32.const 0");
  state.instr.push("i32.lt_s");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
  state.instr.push(`local.get ${idxLocal}`);
  state.instr.push(`i32.const ${length}`);
  state.instr.push("i32.ge_s");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
}

function emitRuntimeCountCheckFromLocal(state, countLocal, length) {
  state.instr.push(`local.get ${countLocal}`);
  state.instr.push("i32.const 0");
  state.instr.push("i32.lt_s");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
  state.instr.push(`local.get ${countLocal}`);
  state.instr.push(`i32.const ${length}`);
  state.instr.push("i32.gt_s");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
}

function copyComposite(state, src, dest) {
  for (let idx = 0; idx < src.length; idx += 1) {
    state.instr.push(`local.get ${src[idx]}`);
    state.instr.push(`local.set ${dest[idx]}`);
  }
}

function lowerDynamicArrayGet(state, arrayArg, idxLocal, resultLocal) {
  const src = compositeLocals(state, arrayArg.name);
  lowerDynamicCompositeGet(state, src, idxLocal, resultLocal);
}

function lowerDynamicCompositeGet(state, src, idxLocal, resultLocal) {
  for (let idx = 0; idx < src.length; idx += 1) {
    state.instr.push(`local.get ${idxLocal}`);
    state.instr.push(`i32.const ${idx}`);
    state.instr.push("i32.eq");
    state.instr.push("if");
    state.instr.push(`local.get ${src[idx]}`);
    state.instr.push(`local.set ${resultLocal}`);
    state.instr.push("end");
  }
}

function lowerDynamicArraySet(state, idxLocal, valueLocal, dest) {
  for (let idx = 0; idx < dest.length; idx += 1) {
    state.instr.push(`local.get ${idxLocal}`);
    state.instr.push(`i32.const ${idx}`);
    state.instr.push("i32.eq");
    state.instr.push("if");
    state.instr.push(`local.get ${valueLocal}`);
    state.instr.push(`local.set ${dest[idx]}`);
    state.instr.push("end");
  }
}

function lowerRangeLoop(state, ins, maxCount) {
  const countLocal = declareTemp(state, "i32");
  const iLocal = declareTemp(state, "i32");
  lowerValue(state, ins.args[2]);
  state.instr.push(`local.set ${countLocal}`);
  emitRuntimeCountCheckFromLocal(state, countLocal, maxCount);
  state.instr.push("i32.const 0");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("block");
  state.instr.push("loop");
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push(`local.get ${countLocal}`);
  state.instr.push("i32.ge_s");
  state.instr.push("br_if 1");
  state.instr.push(`local.get ${scalarLocal(state, ins.result)}`);
  state.instr.push(`call $${wasmName(ins.args[0].name)}`);
  state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push("i32.const 1");
  state.instr.push("i32.add");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("br 0");
  state.instr.push("end");
  state.instr.push("end");
}

function lowerPollLoop(state, ins, maxCount) {
  const countLocal = declareTemp(state, "i32");
  const iLocal = declareTemp(state, "i32");
  lowerValue(state, ins.args[2]);
  state.instr.push(`local.set ${countLocal}`);
  emitRuntimeCountCheckFromLocal(state, countLocal, maxCount);
  state.instr.push("i32.const 0");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("block");
  state.instr.push("loop");
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push(`local.get ${countLocal}`);
  state.instr.push("i32.ge_s");
  state.instr.push("br_if 1");
  lowerValue(state, ins.args[1]);
  state.instr.push(`call $${wasmName(ins.args[0].name)}`);
  state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push("i32.const 1");
  state.instr.push("i32.add");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("br 0");
  state.instr.push("end");
  state.instr.push("end");
}

function lowerBoundedIoPollLoop(state, ins, maxCount) {
  const countLocal = declareTemp(state, "i32");
  const iLocal = declareTemp(state, "i32");
  lowerValue(state, ins.args[1]);
  state.instr.push(`local.set ${countLocal}`);
  emitRuntimeCountCheckFromLocal(state, countLocal, maxCount);
  state.instr.push("i32.const 0");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("block");
  state.instr.push("loop");
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push(`local.get ${countLocal}`);
  state.instr.push("i32.ge_s");
  state.instr.push("br_if 1");
  lowerValue(state, ins.args[0]);
  state.instr.push(`call $${wasmName("io.poll")}`);
  state.instr.push(`local.set ${scalarLocal(state, ins.result)}`);
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push("i32.const 1");
  state.instr.push("i32.add");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("br 0");
  state.instr.push("end");
  state.instr.push("end");
}

function emitReadyStatusTrap(state, statusLocal) {
  state.instr.push(`local.get ${statusLocal}`);
  state.instr.push("i32.const 1");
  state.instr.push("i32.ne");
  state.instr.push("if");
  state.instr.push("unreachable");
  state.instr.push("end");
}

function lowerArrayLoop(state, ins, array, dest) {
  const countLocal = declareTemp(state, "i32");
  const iLocal = declareTemp(state, "i32");
  const valueLocal = declareTemp(state, array.element);
  lowerValue(state, ins.args[2]);
  state.instr.push(`local.set ${countLocal}`);
  emitRuntimeCountCheckFromLocal(state, countLocal, array.length);
  state.instr.push("i32.const 0");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("block");
  state.instr.push("loop");
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push(`local.get ${countLocal}`);
  state.instr.push("i32.ge_s");
  state.instr.push("br_if 1");
  lowerDynamicCompositeGet(state, dest, iLocal, valueLocal);
  state.instr.push(`local.get ${valueLocal}`);
  state.instr.push(`call $${wasmName(ins.args[0].name)}`);
  state.instr.push(`local.set ${valueLocal}`);
  lowerDynamicArraySet(state, iLocal, valueLocal, dest);
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push("i32.const 1");
  state.instr.push("i32.add");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("br 0");
  state.instr.push("end");
  state.instr.push("end");
}

function lowerBufferLoop(state, ins, valueLocal, buffer) {
  const countLocal = declareTemp(state, "i32");
  const iLocal = declareTemp(state, "i32");
  lowerValue(state, ins.args[2]);
  state.instr.push(`local.set ${countLocal}`);
  emitRuntimeCountCheckFromLocal(state, countLocal, buffer.length);
  state.instr.push("i32.const 0");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("block");
  state.instr.push("loop");
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push(`local.get ${countLocal}`);
  state.instr.push("i32.ge_s");
  state.instr.push("br_if 1");
  lowerBufferAddressFromLocal(state, ins.args[1], iLocal, buffer);
  state.instr.push("f32.load");
  state.instr.push(`call $${wasmName(ins.args[0].name)}`);
  state.instr.push(`local.set ${valueLocal}`);
  lowerBufferAddressFromLocal(state, ins.args[1], iLocal, buffer);
  state.instr.push(`local.get ${valueLocal}`);
  state.instr.push("f32.store");
  state.instr.push(`local.get ${iLocal}`);
  state.instr.push("i32.const 1");
  state.instr.push("i32.add");
  state.instr.push(`local.set ${iLocal}`);
  state.instr.push("br 0");
  state.instr.push("end");
  state.instr.push("end");
}

function lowerBufferAddress(state, bufferArg, indexArg, buffer) {
  lowerValue(state, bufferArg);
  lowerValue(state, indexArg);
  state.instr.push(`i32.const ${scalarByteWidth(buffer.element)}`);
  state.instr.push("i32.mul");
  state.instr.push("i32.add");
}

function lowerBufferAddressFromLocal(state, bufferArg, indexLocal, buffer) {
  lowerValue(state, bufferArg);
  state.instr.push(`local.get ${indexLocal}`);
  state.instr.push(`i32.const ${scalarByteWidth(buffer.element)}`);
  state.instr.push("i32.mul");
  state.instr.push("i32.add");
}

function declareTemp(state, type) {
  const name = `$__tmp_${state.tempId++}`;
  state.localDecls.push({ name, type: watType(type) });
  return name;
}

function declareTempComposite(state, type) {
  const count = type === "mat4" ? 16 : type === "quat" ? 4 : Number(type.slice(3));
  const names = type === "mat4" ? Array.from({ length: 16 }, (_, idx) => `m${idx}`) : ["x", "y", "z", "w"].slice(0, count);
  return names.map((suffix) => {
    const name = `$__tmp_${state.tempId++}_${suffix}`;
    state.localDecls.push({ name, type: "f32" });
    return name;
  });
}

function bindParam(state, param) {
  const base = param.name.replace(/[^A-Za-z0-9_]/g, "_");
  const type = param.type;
  if (type === BORROWED_SLICE_TYPE) {
    state.locals.set(`%${param.name}`, `$${base}`);
    state.localTypes.set(`%${param.name}`, type);
    state.locals.set(`%${param.name}$len`, `$${base}$len`);
    state.localTypes.set(`%${param.name}$len`, "i32");
    return;
  }
  if (type === "vec2" || type === "vec3" || type === "vec4" || type === "mat4" || type === "quat") {
    const count = type === "mat4" ? 16 : type === "quat" ? 4 : Number(type.slice(3));
    const names = type === "mat4" ? Array.from({ length: 16 }, (_, idx) => `m${idx}`) : ["x", "y", "z", "w"].slice(0, count);
    const components = names.map((suffix) => `$${base}__${suffix}`);
    state.locals.set(`%${param.name}`, { type, components });
    state.localTypes.set(`%${param.name}`, type);
    return;
  }
  const array = parseArrayType(type);
  if (array) {
    const components = Array.from({ length: array.length }, (_, idx) => `$${base}_${idx}`);
    state.locals.set(`%${param.name}`, { type, components });
    state.localTypes.set(`%${param.name}`, type);
    return;
  }
  if (isStructName(type) && state.globals.structs.has(type)) {
    const struct = state.globals.structs.get(type);
    const components = struct.fields.map((field) => `$${base}__${field.name}`);
    state.locals.set(`%${param.name}`, { type, components });
    state.localTypes.set(`%${param.name}`, type);
    return;
  }
  const local = `$${param.name}`;
  state.locals.set(`%${param.name}`, local);
  state.localTypes.set(`%${param.name}`, type);
}

function flattenParams(params, structs) {
  const out = [];
  for (const param of params) {
    const base = param.name.replace(/[^A-Za-z0-9_]/g, "_");
    if (param.type === BORROWED_SLICE_TYPE) {
      out.push({ name: `$${base}`, type: "i32" });
      out.push({ name: `$${base}$len`, type: "i32" });
      continue;
    }
    const flattened = flattenType(param.type, structs);
    if (flattened.length === 1 && flattened[0] === param.type) {
      out.push({ name: `$${param.name}`, type: watType(param.type) });
      continue;
    }
    flattened.forEach((type, idx) => {
      const sep = param.type === "vec2" || param.type === "vec3" || param.type === "vec4" || param.type === "mat4" || param.type === "quat" || structs.has(param.type) ? "__" : "_";
      out.push({ name: `$${base}${sep}${flattenSuffix(param.type, idx, structs)}`, type: watType(type) });
    });
  }
  return out;
}

function flattenSuffix(type, idx, structs) {
  if (type === "mat4") return `m${idx}`;
  if (type === "quat") return ["x", "y", "z", "w"][idx];
  if (/^vec[234]$/.test(type)) return ["x", "y", "z", "w"][idx];
  const struct = structs.get(type);
  if (struct) return struct.fields[idx].name;
  return String(idx);
}

function flattenType(type, structs) {
  if (type === "void") return [];
  if (type === "vec2") return ["f32", "f32"];
  if (type === "vec3") return ["f32", "f32", "f32"];
  if (type === "vec4" || type === "quat") return ["f32", "f32", "f32", "f32"];
  if (type === "mat4") return Array.from({ length: 16 }, () => "f32");
  const array = parseArrayType(type);
  if (array) return Array.from({ length: array.length }, () => array.element);
  const struct = structs.get(type);
  if (struct) return struct.fields.map((field) => field.type);
  return [type];
}

function isCompositeLoweredType(type, structs) {
  return flattenType(type, structs).length > 1 || parseArrayType(type) || structs.has(type) || /^vec[234]$/.test(type) || type === "mat4" || type === "quat";
}

function lowerCallArgument(state, arg) {
  if (arg.kind === "value" && valueType(state, arg.name) === BORROWED_SLICE_TYPE) {
    state.instr.push(`local.get ${scalarLocal(state, arg.name)}`);
    state.instr.push(`local.get ${scalarLocal(state, `${arg.name}$len`)}`);
    return;
  }
  if (arg.kind === "value" && isCompositeLoweredType(valueType(state, arg.name), state.globals.structs)) {
    const locals = compositeLocals(state, arg.name);
    for (const local of locals) state.instr.push(`local.get ${local}`);
    return;
  }
  lowerValue(state, arg);
}

function lowerReturnValue(state, arg) {
  if (arg.kind === "value" && isCompositeLoweredType(valueType(state, arg.name), state.globals.structs)) {
    const locals = compositeLocals(state, arg.name);
    for (const local of locals) state.instr.push(`local.get ${local}`);
    return;
  }
  lowerValue(state, arg);
}

function declareLocal(state, name, type = "i32") {
  if (state.locals.has(name)) return;
  const base = name.replace(/^%/, "").replace(/[^A-Za-z0-9_]/g, "_");
  if (type === "vec2" || type === "vec3" || type === "vec4" || type === "mat4" || type === "quat") {
    const count = type === "mat4" ? 16 : type === "quat" ? 4 : Number(type.slice(3));
    const names = type === "mat4" ? Array.from({ length: 16 }, (_, idx) => `m${idx}`) : ["x", "y", "z", "w"].slice(0, count);
    const components = names.map((suffix) => `$${base}__${suffix}`);
    for (const component of components) state.localDecls.push({ name: component, type: "f32" });
    state.locals.set(name, { type, components });
    state.localTypes.set(name, type);
    return;
  }
  const array = parseArrayType(type);
  if (array) {
    const components = Array.from({ length: array.length }, (_, idx) => `$${base}_${idx}`);
    for (const component of components) state.localDecls.push({ name: component, type: watType(array.element) });
    state.locals.set(name, { type, components });
    state.localTypes.set(name, type);
    return;
  }
  if (isStructName(type) && state.globals.structs.has(type)) {
    const struct = state.globals.structs.get(type);
    const components = struct.fields.map((field) => `$${base}__${field.name}`);
    struct.fields.forEach((field, idx) => state.localDecls.push({ name: components[idx], type: watType(field.type) }));
    state.locals.set(name, { type, components });
    state.localTypes.set(name, type);
    return;
  }
  const buffer = parseBufferType(type);
  if (buffer) {
    const watName = `$${base}`;
    state.locals.set(name, watName);
    state.localTypes.set(name, type);
    state.localDecls.push({ name: watName, type: "i32" });
    return;
  }
  const watName = `$${base}`;
  state.locals.set(name, watName);
  state.localTypes.set(name, type);
  state.localDecls.push({ name: watName, type: watType(type) });
}

function watType(type) {
  if (["i32", "bool", "ptr", "slice", BORROWED_SLICE_TYPE].includes(type)) return "i32";
  if (type === "i64") return "i64";
  if (type === "f32") return "f32";
  if (type === "f64") return "f64";
  throw new Error(`cannot lower type ${type}`);
}

function constWatType(op) {
  if (op === "const.i64") return "i64";
  if (op === "const.f32") return "f32";
  if (op === "const.f64") return "f64";
  return "i32";
}

function startFunction(mod) {
  if (!mod.functions.some((fn) => fn.name === "main")) return [];
  return [
    `  (func $_start (export "_start")`,
    `    i32.const 0`,
    `    call $main`,
    `    drop`,
    `  )`
  ];
}

function splitExternalName(name) {
  const idx = name.indexOf(".");
  if (idx === -1) return ["env", name];
  return [name.slice(0, idx), name.slice(idx + 1)];
}

function wasmName(name) {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

function constNumber(arg) {
  if (arg.kind === "bool") return arg.value ? 1 : 0;
  return Number(arg.value);
}

function watString(value) {
  return JSON.stringify(value)
    .replace(/\\n/g, "\\0a")
    .replace(/\\r/g, "\\0d")
    .replace(/\\t/g, "\\09");
}

function watBytes(bytes) {
  return `"${bytes.map((byte) => `\\${byte.toString(16).padStart(2, "0")}`).join("")}"`;
}

async function watToWasm(wat, name = "module.air") {
  const wabtFactory = require("wabt");
  const wabt = await wabtFactory();
  const module = wabt.parseWat(name, wat);
  module.resolveNames();
  module.validate();
  const { buffer } = module.toBinary({ log: false, write_debug_names: true });
  module.destroy();
  return Buffer.from(buffer);
}

module.exports = { lowerToWat, watToWasm };
// Internal typed-v0.53 build planning, used by the gated build entrypoints;
// not part of the enumerable exports that the public index spreads.
Object.defineProperty(module.exports, "typedV053", {
  enumerable: false,
  value: Object.freeze({ ENGINE_LIMITS: V053_ENGINE_LIMITS, checkEngineLimits: checkV053EngineLimits })
});
