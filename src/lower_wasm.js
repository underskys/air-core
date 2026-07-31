const { formatArg } = require("./format");
const { parseArrayType, parseBufferType, isStructName, scalarByteWidth } = require("./types");
const { tableStorageByteWidth } = require("./table_metadata");
const {
  REGION_BOUNDS_FAILURE_FUNCTION,
  REGION_BOUNDS_RUNTIME_CODE
} = require("./region_bounds");
const { assertWasmTargetSupport } = require("./verifier");
const {
  BORROWED_SLICE_TYPE,
  borrowedSliceInterfaceDescriptor,
  borrowedSliceInterfaceDigest
} = require("./borrowed_slices");

const STRUCTURED_PHI_LOOP_FUEL_LIMIT = 4096;
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

function lowerToWat(mod) {
  assertWasmTargetSupport(mod);
  const borrowedDescriptor = borrowedSliceInterfaceDescriptor(mod);
  const ctx = {
    dataOffset: 1024,
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
    usesBorrowFailure: false
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
        `  (global (export "__air_abi_feature_borrowed_slice_v1") i32 (i32.const ${BORROWED_SLICE_FEATURE_MARKER}))`
      ]
    : [];
  const data = ctx.data.map((d) => `  (data (i32.const ${d.offset}) ${d.bytes ? watBytes(d.bytes) : watString(d.value)})`);

  return [
    `(module`,
    ...imports,
    `  (memory (export "memory") 1)`,
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
    const offset = state.globals.dataOffset;
    state.globals.dataOffset += 4096;
    state.regions.set(ins.result, { sizeArg: ins.args[0] });
    if (ins.regionSizeCheck !== "static") emitRuntimeRegionSizeCheck(state, ins.args[0]);
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

function emitRuntimeRegionSizeCheck(state, sizeArg) {
  const sizeLocal = declareTemp(state, "i32");
  lowerValue(state, sizeArg);
  state.instr.push(`local.set ${sizeLocal}`);
  emitNegativeRuntimeCheck(state, sizeLocal);
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
