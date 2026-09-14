const crypto = require("crypto");
const fs = require("fs");
const {
  PRIMITIVES,
  typeOfConstOp,
  parseArrayType,
  parseBufferType,
  isStructName,
  isCompositeType,
  scalarByteWidth,
  refinementContains,
  parseRefinementType,
  SLICE_LEN_MAX,
  I32_MIN,
  I32_MAX
} = require("./types");
const { KNOWN_CAPABILITIES, requiredCapabilityForExtern } = require("./capabilities");
const { hostSignature, isStrictHostModule } = require("./host_abi");
const { validateUseBundles, bundleForExtern } = require("./bundles");
const { AIR_VERSION } = require("./version");
const { analyzeProvenanceModule, assertProvenanceFlow } = require("./provenance_flow");
const {
  REGION_BOUNDS_STATIC_CODE,
  classifyRegionAccess,
  classifyRegionSize
} = require("./region_bounds");
const {
  BORROWED_SLICE_TYPE,
  borrowedAccessAllows,
  borrowedArgumentCompatible,
  requiredAirAbiForModule,
  parseBorrowedSliceType
} = require("./borrowed_slices");
const { checkAbi012Candidate, createDecisionEvidence, deriveEffectiveAuthority } = require("./v051_reference");
const { parseTypeReference } = require("./typed_interface");
const { semanticDiagnosticCode } = require("./errors");

const RESOURCE_CERTIFICATE_SCHEMA_VERSION = "1.0";
const RESOURCE_CERTIFICATE_KIND = "air.verifiedResourceCertificate";
const RESOURCE_CERTIFICATE_DOMAIN = "AIR_VERIFIED_RESOURCE_CERTIFICATE_V1";
const RESOURCE_PACKAGE_DOMAIN = "AIR_VERIFIED_RESOURCE_PACKAGE_V1";
const RESOURCE_VERIFIER_DOMAIN = "AIR_VERIFIER_IDENTITY_V1";
const BORROWED_MEMORY_CERTIFICATE_DOMAIN = "AIR_VERIFIED_BORROWED_MEMORY_V1";
const BORROWED_MEMORY_ALIAS_POLICY = "deny_mutable_overlap";
const BORROWED_MEMORY_FEATURE = "borrowed-slice-v1";
const BORROWED_MEMORY_TRANSFER_MODES = Object.freeze(["copied_into_wasm", "wasm_memory_view"]);
const BORROWED_HOST_VALIDATIONS_PER_PARAMETER = 9;
const REALTIME_SAFE_MODE = "realtime_safe";
const REALTIME_SAFE_REQUIRED_BOUNDS = Object.freeze([
  "borrowedMemory",
  "effects",
  "hostCalls",
  "loops",
  "memory"
]);
const RESOURCE_BOUND_CATEGORIES = new Set(["borrowedMemory", "loops", "memory", "hostCalls", "effects"]);
const RESOURCE_CERTIFICATE_VALIDATION_OPTION_KEYS = new Set([
  "certificateDigest",
  "packageDigest",
  "packageName",
  "required",
  "verifierDigest"
]);

class VerificationError extends Error {
  constructor(message, loc) {
    super(loc ? `${loc.file}:${loc.line}: ${message}` : message);
    this.name = "VerificationError";
    this.loc = loc;
    const code = semanticDiagnosticCode(message);
    if (code) this.code = code;
  }
}

function verifyModule(mod, options = {}) {
  const functions = new Map();
  const globals = new Map();
  const types = buildTypeEnv(mod);
  const constants = buildConstantEnv(mod);
  const tables = buildTableEnv(mod, constants);
  const tableGroups = buildTableGroupEnv(mod, tables, constants);
  const states = buildStateEnv(mod, constants, tables, tableGroups);
  const pools = buildPoolEnv(mod, constants, tables, tableGroups, states);
  const effectUsage = collectEffectUsage(mod, constants);
  validateUseBundles(mod, fail);
  for (const cap of mod.generatedCapabilities || []) {
    if ((mod.explicitCapabilities || new Set()).has(cap)) {
      fail(`capability '${cap}' is declared both explicitly and through a use bundle`);
    }
  }
  for (const cap of mod.capabilities || []) {
    if (!KNOWN_CAPABILITIES.has(cap)) fail(`unknown capability '${cap}'`);
  }
  verifyEffectsAndContracts(mod, effectUsage);
  for (const struct of mod.structs || []) {
    if (constants.has(struct.name)) fail(`struct '${struct.name}' conflicts with constant '${struct.name}'`, struct.loc);
    if (tables.has(struct.name)) fail(`struct '${struct.name}' conflicts with table '${struct.name}'`, struct.loc);
    if (tableGroups.has(struct.name)) fail(`struct '${struct.name}' conflicts with tablegroup '${struct.name}'`, struct.loc);
    if (states.has(struct.name)) fail(`struct '${struct.name}' conflicts with state '${struct.name}'`, struct.loc);
    if (pools.has(struct.name)) fail(`struct '${struct.name}' conflicts with pool '${struct.name}'`, struct.loc);
    for (const field of struct.fields) {
      rejectBorrowedStorage(field.type, `struct '${struct.name}' field '${field.name}'`, struct.loc);
      ensureKnownType(field.type, types, struct.loc);
    }
  }
  for (const global of mod.globals || []) {
    if (constants.has(global.name)) fail(`global '${global.name}' conflicts with constant '${global.name}'`, global.loc);
    if (tables.has(global.name)) fail(`global '${global.name}' conflicts with table '${global.name}'`, global.loc);
    if (tableGroups.has(global.name)) fail(`global '${global.name}' conflicts with tablegroup '${global.name}'`, global.loc);
    if (states.has(global.name)) fail(`global '${global.name}' conflicts with state '${global.name}'`, global.loc);
    if (pools.has(global.name)) fail(`global '${global.name}' conflicts with pool '${global.name}'`, global.loc);
    if (globals.has(global.name)) fail(`duplicate global '${global.name}'`, global.loc);
    rejectBorrowedStorage(global.type, `global '${global.name}'`, global.loc);
    ensureKnownType(global.type, types, global.loc);
    const constType = typeOfConstOp(global.init.op);
    if (!constType) fail(`global '${global.name}' initializer must be const.*`, global.loc);
    if (constType !== global.type) fail(`global '${global.name}' initializer produces ${constType}, assigned to ${global.type}`, global.loc);
    if ((global.init.args || []).length !== 1) fail(`global '${global.name}' initializer expects 1 arg`, global.loc);
    globals.set(global.name, global);
  }
  for (const ex of mod.externs || []) {
    if (constants.has(ex.name)) fail(`extern '${ex.name}' conflicts with constant '${ex.name}'`, ex.loc);
    if (tables.has(ex.name)) fail(`extern '${ex.name}' conflicts with table '${ex.name}'`, ex.loc);
    if (tableGroups.has(ex.name)) fail(`extern '${ex.name}' conflicts with tablegroup '${ex.name}'`, ex.loc);
    if (states.has(ex.name)) fail(`extern '${ex.name}' conflicts with state '${ex.name}'`, ex.loc);
    if (pools.has(ex.name)) fail(`extern '${ex.name}' conflicts with pool '${ex.name}'`, ex.loc);
    if (functions.has(ex.name)) fail(`duplicate function '${ex.name}'`, ex.loc);
    validateSignatureTypes(ex, types);
    rejectBorrowedExternSignature(ex);
    const refinedExternParam = ex.params.find((param) => param.refinement);
    if (refinedExternParam) {
      fail(
        `air.refinement.extern_parameter_unsupported: extern '${ex.name}' param '${refinedExternParam.name}' cannot declare a refinement at the current Host ABI boundary`,
        ex.loc
      );
    }
    if (ex.returnRefinement) {
      fail(
        `air.refinement.extern_return_unsupported: extern '${ex.name}' cannot declare a refined return because the current Host ABI cannot prove the host-produced bound`,
        ex.loc
      );
    }
    rejectBoundaryComposites(ex, `extern '${ex.name}'`);
    const capability = requiredCapabilityForExtern(ex.name);
    if (!capability) fail(`extern '${ex.name}' must be capability-qualified as module.function`, ex.loc);
    if (!mod.capabilities.has(capability)) {
      const bundle = bundleForExtern(ex.name);
      const hint = bundle ? `; add 'use ${bundle}' or declare capability '${capability}'` : "";
      fail(`extern '${ex.name}' requires capability '${capability}'${hint}`, ex.loc);
    }
    validateHostAbiSignature(ex);
    functions.set(ex.name, ex);
  }
  for (const fn of options.externalFunctions || []) {
    if (functions.has(fn.name)) continue;
    functions.set(fn.name, {
      name: fn.name,
      params: fn.params || [],
      returnType: fn.returnType || "void",
      external: true,
      packageExternal: true,
      loc: fn.loc || mod.loc || { file: "<package>", line: 1 }
    });
  }
  for (const fn of mod.functions) {
    if (constants.has(fn.name)) fail(`function '${fn.name}' conflicts with constant '${fn.name}'`, fn.loc);
    if (tables.has(fn.name)) fail(`function '${fn.name}' conflicts with table '${fn.name}'`, fn.loc);
    if (tableGroups.has(fn.name)) fail(`function '${fn.name}' conflicts with tablegroup '${fn.name}'`, fn.loc);
    if (states.has(fn.name)) fail(`function '${fn.name}' conflicts with state '${fn.name}'`, fn.loc);
    if (pools.has(fn.name)) fail(`function '${fn.name}' conflicts with pool '${fn.name}'`, fn.loc);
    if (functions.has(fn.name)) fail(`duplicate function '${fn.name}'`, fn.loc);
    validateSignatureTypes(fn, types);
    rejectBorrowedReturn(fn);
    if (fn.exported || fn.name === "main") rejectBoundaryComposites(fn, `function '${fn.name}'`);
    functions.set(fn.name, fn);
  }
  assertWasmTargetSupport(mod, { allowBorrowedSliceSource: true });
  const main = functions.get("main");
  const hasExport = mod.functions.some((fn) => fn.exported);
  if (!options.library && !main && !hasExport) fail("missing required function 'main' or exported host entrypoint");
  if (main) {
    if (main.external) fail("main cannot be external", main.loc);
    if (main.returnType !== "i32") fail("main must return i32", main.loc);
    if (main.params.length !== 1 || main.params[0].name !== "args" || main.params[0].type !== "slice") {
      fail("main signature must be main(args: slice) -> i32", main.loc);
    }
  }
  rejectLocalCallCycles(mod);
  for (const fn of mod.functions) verifyFunction(mod, fn, functions, globals, types, constants, tables, states, pools);
  if (!options.skipProvenance) {
    const provenanceFlow = analyzeProvenanceModule(mod, {
      path: options.modulePath,
      policy: options.provenancePolicy,
      context: options.provenanceContext
    });
    mod.provenanceFlowEvidence = provenanceFlow;
    assertProvenanceFlow(provenanceFlow);
  }
  return true;
}

function verifyV051Air(mod, options = {}) {
  if (!mod || !mod.v051TypedDecisionCandidate) {
    throw new VerificationError("air.v051.parser_required: v0.51 verification requires parseV051Air");
  }
  if (mod.v051TypedAst) return verifyV051TypedModule(mod);
  verifyModule(mod, options);
  return mod;
}

function verifyV051TypedModule(mod) {
  const declarations = new Map();
  for (const declaration of mod.enums || []) {
    if (!declaration || (declaration.kind !== "enum" && declaration.kind !== "error_enum") || typeof declaration.type_id !== "string") {
      throw new VerificationError("air.decision.enum_invalid: invalid enum declaration");
    }
    if (declarations.has(declaration.type_id)) throw new VerificationError(`air.decision.enum_duplicate_type: '${declaration.type_id}'`);
    if (!Array.isArray(declaration.cases) || !declaration.cases.length) throw new VerificationError(`air.decision.enum_empty: '${declaration.type_id}'`);
    const names = new Set(); const discriminants = new Set();
    for (const entry of declaration.cases) {
      if (!entry || !Number.isInteger(entry.discriminant) || entry.discriminant < 0 || entry.discriminant > 2147483647) throw new VerificationError(`air.decision.enum_discriminant_out_of_range: '${declaration.type_id}'`);
      if (typeof entry.name !== "string" || names.has(entry.name)) throw new VerificationError(`air.decision.enum_duplicate_case: '${declaration.type_id}'`);
      if (discriminants.has(entry.discriminant)) throw new VerificationError(`air.decision.enum_duplicate_discriminant: '${declaration.type_id}'`);
      names.add(entry.name); discriminants.add(entry.discriminant);
    }
    declarations.set(declaration.type_id, declaration);
  }
  const functions = new Set();
  for (const fn of mod.functions || []) {
    if (!fn || typeof fn.name !== "string" || functions.has(fn.name)) throw new VerificationError("air.v051.function_duplicate: typed function names must be unique", fn && fn.loc);
    functions.add(fn.name);
    const locals = new Map();
    const staticValues = new Map();
    const parameterNames = new Set();
    for (const parameter of fn.params || []) {
      if (!parameter || typeof parameter.name !== "string" || parameterNames.has(parameter.name)) throw new VerificationError(`air.v051.parameter_duplicate: '${fn.name}'`, fn.loc);
      parameterNames.add(parameter.name);
      verifyV051TypedType(parameter.type, declarations, fn.loc, false);
      locals.set(parameter.name, parameter.type);
    }
    verifyV051TypedType(fn.returnType, declarations, fn.loc, true);
    let hasReturn = false;
    for (const statement of fn.statements || []) {
      if (statement.kind === "local") {
        if (locals.has(statement.name)) throw new VerificationError(`air.v051.local_duplicate: '${statement.name}'`, statement.loc);
        const declared = verifyV051TypedType(statement.type, declarations, statement.loc, false);
        const staticValue = verifyV051TypedExpression(statement.value, declared, locals, declarations, statement.loc, staticValues);
        locals.set(statement.name, statement.type);
        if (staticValue !== undefined) staticValues.set(statement.name, staticValue);
      } else if (statement.kind === "match") {
        if (locals.has(statement.destination)) throw new VerificationError(`air.v051.local_duplicate: '${statement.destination}'`, statement.loc);
        verifyV051TypedMatch(statement, locals, declarations);
        locals.set(statement.destination, statement.destinationType);
      } else if (statement.kind === "return") {
        if (fn.returnType === "void") {
          if (statement.value) throw new VerificationError(`air.v051.return_type_mismatch: '${fn.name}'`, statement.loc);
        } else {
          verifyV051TypedExpression(statement.value, verifyV051TypedType(fn.returnType, declarations, statement.loc, false), locals, declarations, statement.loc, staticValues);
        }
        hasReturn = true;
      } else {
        throw new VerificationError("air.v051.typed_statement_invalid", statement.loc);
      }
    }
    if (fn.returnType !== "void" && !hasReturn) throw new VerificationError(`air.v051.return_missing: '${fn.name}'`, fn.loc);
  }
  return mod;
}

function verifyV051TypedType(typeName, declarations, loc, allowVoid) {
  let type;
  try {
    const refinement = parseRefinementType(typeName, loc);
    if (refinement) {
      if (refinement.base !== "i32") throw new VerificationError(`air.v051.type_reference_invalid: '${typeName}' is not an admitted typed refinement`, loc);
      type = { baseCanonical: refinement.base, canonical: refinement.canonical, kind: "primitive", refinement: refinement.refinement };
    } else {
      type = { ...parseTypeReference(typeName, { allowVoid }), baseCanonical: typeName };
    }
  } catch (err) { throw new VerificationError(err.message, loc); }
  const verifyEnum = (enumType, requireError = false) => {
    const declaration = declarations.get(enumType.canonical);
    if (!declaration) throw new VerificationError(`air.decision.enum_unknown: '${enumType.canonical}'`, loc);
    if (requireError && declaration.kind !== "error_enum") throw new VerificationError(`air.decision.result_error_type_invalid: '${enumType.canonical}'`, loc);
  };
  if (type.kind === "enum") verifyEnum(type);
  if (type.kind === "option" && type.payload.kind === "enum") verifyEnum(type.payload);
  if (type.kind === "result") {
    if (type.payload.kind === "enum") verifyEnum(type.payload);
    verifyEnum(type.error, true);
  }
  return type;
}

function v051TypeBase(type) {
  return type.baseCanonical || type.canonical;
}

function verifyV051RefinementValue(expected, value, loc) {
  if (!expected.refinement || expected.refinement.kind !== "i32_range" || value === undefined) return;
  if (!Number.isInteger(value) || value < expected.refinement.min || value > expected.refinement.max) {
    throw new VerificationError("air.refinement.assignment_out_of_range", loc);
  }
}

function verifyV051TypedMatch(statement, locals, declarations) {
  const typeName = locals.get(statement.value);
  if (!typeName) throw new VerificationError(`air.decision.match_unknown_value: '${statement.value}'`, statement.loc);
  const type = verifyV051TypedType(typeName, declarations, statement.loc, false);
  const destination = verifyV051TypedType(statement.destinationType, declarations, statement.loc, false);
  let expected;
  if (type.kind === "enum") {
    const declaration = declarations.get(type.canonical);
    expected = new Set(declaration.cases.map((item) => item.name));
  } else if (type.kind === "option") {
    expected = new Set(["none", "some"]);
  } else if (type.kind === "result") {
    expected = new Set(["ok", "err"]);
  } else {
    throw new VerificationError("air.decision.match_type_unsupported: match requires enum, option, or result", statement.loc);
  }
  const seen = new Set();
  for (const arm of statement.arms || []) {
    const pattern = parseV051TypedMatchPattern(arm.pattern, type, declarations, arm.loc || statement.loc);
    const key = pattern.key;
    if (!key || !expected.has(key)) throw new VerificationError(`air.decision.match_arm_invalid: '${arm.pattern}'`, arm.loc || statement.loc);
    if (seen.has(key)) throw new VerificationError(`air.decision.match_duplicate_arm: '${key}'`, arm.loc || statement.loc);
    const armLocals = new Map(locals);
    if (pattern.binding) {
      if (armLocals.has(pattern.binding)) throw new VerificationError(`air.decision.match_binding_shadow: '${pattern.binding}'`, arm.loc || statement.loc);
      armLocals.set(pattern.binding, pattern.bindingType);
    }
    verifyV051TypedExpression(arm.expression, destination, armLocals, declarations, arm.loc || statement.loc, new Map());
    seen.add(key);
  }
  if (seen.size !== expected.size || [...expected].some((item) => !seen.has(item))) throw new VerificationError("air.decision.match_nonexhaustive", statement.loc);
}

function verifyV051TypedExpression(value, expected, locals, declarations, loc, staticValues) {
  let staticValue;
  if (!value || typeof value !== "object" || value.kind !== "numeric_operation") {
    verifyV051TypedAtom(value, expected, locals, declarations, loc);
    staticValue = v051StaticScalarValue(value, expected, staticValues);
  } else {
    staticValue = verifyV051TypedNumericOperation(value, expected, locals, declarations, loc, staticValues);
  }
  verifyV051RefinementValue(expected, staticValue, loc);
  return staticValue;
}

function verifyV051TypedNumericOperation(operation, expected, locals, declarations, loc, staticValues) {
  const signatures = {
    "i64.checked_add": { args: ["i64", "i64"], result: "i64", checked: "add" },
    "i64.checked_sub": { args: ["i64", "i64"], result: "i64", checked: "sub" },
    "i64.checked_mul": { args: ["i64", "i64"], result: "i64", checked: "mul" },
    "i64.checked_div_s": { args: ["i64", "i64"], result: "i64", checked: "div_s" },
    "i64.checked_rem_s": { args: ["i64", "i64"], result: "i64", checked: "rem_s" },
    "i64.checked_neg": { args: ["i64"], result: "i64", checked: "neg" },
    "i64.eq": { args: ["i64", "i64"], result: "bool", comparison: "eq" },
    "i64.ne": { args: ["i64", "i64"], result: "bool", comparison: "ne" },
    "i64.lt_s": { args: ["i64", "i64"], result: "bool", comparison: "lt_s" },
    "i64.le_s": { args: ["i64", "i64"], result: "bool", comparison: "le_s" },
    "i64.gt_s": { args: ["i64", "i64"], result: "bool", comparison: "gt_s" },
    "i64.ge_s": { args: ["i64", "i64"], result: "bool", comparison: "ge_s" },
    "i64.to_i32_checked": { args: ["i64"], result: "i32", checked: "to_i32" },
    "i32.to_i64": { args: ["i32"], result: "i64" },
    "f32.to_f64": { args: ["f32"], result: "f64" },
    "f64.to_f32_checked": { args: ["f64"], result: "f32" }
  };
  const signature = signatures[operation.op];
  if (!signature || !Array.isArray(operation.args) || operation.args.length !== signature.args.length) {
    throw new VerificationError(`air.numeric.operation_invalid: '${operation.op}'`, loc);
  }
  if (v051TypeBase(expected) !== signature.result) throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${operation.op}'`, loc);
  for (let index = 0; index < signature.args.length; index += 1) {
    verifyV051TypedAtom(operation.args[index], parseTypeReference(signature.args[index]), locals, declarations, loc);
  }
  if (!signature.checked && !signature.comparison) return undefined;
  const values = operation.args.map((argument) => v051StaticI64Value(argument, locals, staticValues));
  if (values.some((value) => value === undefined)) return undefined;
  if (signature.comparison) return evaluateV051I64Comparison(signature.comparison, values);
  return evaluateV051CheckedI64(signature.checked, values, loc);
}

function evaluateV051I64Comparison(operation, values) {
  const [left, right] = values;
  if (operation === "eq") return left === right;
  if (operation === "ne") return left !== right;
  if (operation === "lt_s") return left < right;
  if (operation === "le_s") return left <= right;
  if (operation === "gt_s") return left > right;
  if (operation === "ge_s") return left >= right;
  throw new VerificationError(`air.numeric.operation_invalid: 'i64.${operation}'`);
}

function v051StaticScalarValue(value, expected, staticValues) {
  const text = String(value || "").trim();
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return staticValues.get(text.slice(1));
  if (expected.canonical === "i64" && /^-?(0|[1-9][0-9]*)$/.test(text)) return BigInt(text);
  if (v051TypeBase(expected) === "i32" && /^-?(0|[1-9][0-9]*)$/.test(text)) return Number(text);
  return undefined;
}

function v051StaticI64Value(value, locals, staticValues) {
  const text = String(value || "").trim();
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    return locals.get(text.slice(1)) === "i64" && typeof staticValues.get(text.slice(1)) === "bigint"
      ? staticValues.get(text.slice(1))
      : undefined;
  }
  return /^-?(0|[1-9][0-9]*)$/.test(text) ? BigInt(text) : undefined;
}

function evaluateV051CheckedI64(operation, values, loc) {
  const min = -9223372036854775808n;
  const max = 9223372036854775807n;
  const [left, right] = values;
  let result;
  if (operation === "add") result = left + right;
  else if (operation === "sub") result = left - right;
  else if (operation === "mul") result = left * right;
  else if (operation === "neg") result = -left;
  else if (operation === "div_s") {
    if (right === 0n) throw new VerificationError("air.numeric.checked_failure: division_by_zero", loc);
    if (left === min && right === -1n) throw new VerificationError("air.numeric.checked_failure: overflow", loc);
    result = left / right;
  } else if (operation === "rem_s") {
    if (right === 0n) throw new VerificationError("air.numeric.checked_failure: division_by_zero", loc);
    result = left === min && right === -1n ? 0n : left % right;
  } else if (operation === "to_i32") {
    if (left < -2147483648n || left > 2147483647n) throw new VerificationError("air.numeric.checked_failure: invalid_conversion", loc);
    return Number(left);
  } else {
    throw new VerificationError(`air.numeric.operation_invalid: '${operation}'`, loc);
  }
  if (result < min || result > max) throw new VerificationError("air.numeric.checked_failure: overflow", loc);
  return result;
}

function parseV051TypedMatchPattern(pattern, subjectType, declarations, loc) {
  const value = String(pattern || "").trim();
  if (subjectType.kind === "enum") {
    const patternMatch = value.match(/^([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    const declaration = declarations.get(subjectType.canonical);
    const typeName = subjectType.canonical.slice(subjectType.canonical.lastIndexOf("::") + 2);
    if (!patternMatch || patternMatch[1] !== typeName || !declaration.cases.some((entry) => entry.name === patternMatch[2])) throw new VerificationError(`air.decision.match_arm_invalid: '${value}'`, loc);
    return { binding: null, bindingType: null, key: patternMatch[2] };
  }
  if (subjectType.kind === "option") {
    if (value === "none") return { binding: null, bindingType: null, key: "none" };
    const some = value.match(/^some\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
    if (!some) throw new VerificationError(`air.decision.match_arm_invalid: '${value}'`, loc);
    return { binding: some[1], bindingType: subjectType.payload.canonical, key: "some" };
  }
  if (subjectType.kind === "result") {
    const wrapped = value.match(/^(ok|err)\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
    if (!wrapped) throw new VerificationError(`air.decision.match_arm_invalid: '${value}'`, loc);
    return { binding: wrapped[2], bindingType: wrapped[1] === "ok" ? subjectType.payload.canonical : subjectType.error.canonical, key: wrapped[1] };
  }
  throw new VerificationError("air.decision.match_type_unsupported: match requires enum, option, or result", loc);
}

function verifyV051TypedAtom(value, expected, locals, declarations, loc) {
  const text = String(value || "").trim();
  if (!text) throw new VerificationError("air.v051.typed_atom_invalid", loc);
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    const local = locals.get(text.slice(1));
    if (!local) throw new VerificationError(`air.v051.local_unknown: '${text}'`, loc);
    if (local !== expected.canonical) throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${text}'`, loc);
    return expected;
  }
  if (text === "true" || text === "false") {
    if (expected.canonical !== "bool") throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${text}'`, loc);
    return expected;
  }
  if (/^-?(0|[1-9][0-9]*)$/.test(text)) {
    if (v051TypeBase(expected) === "i32" && Number.isSafeInteger(Number(text)) && Number(text) >= -2147483648 && Number(text) <= 2147483647) return expected;
    if (expected.canonical === "i64") {
      const exact = BigInt(text);
      if (exact >= -9223372036854775808n && exact <= 9223372036854775807n) return expected;
      throw new VerificationError(`air.numeric.i64_constant_out_of_range: '${text}'`, loc);
    }
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${text}'`, loc);
  }
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text)) {
    const numeric = Number(text);
    if (expected.canonical === "f64" && Number.isFinite(numeric)) return expected;
    if (expected.canonical === "f32" && Number.isFinite(numeric) && Number.isFinite(Math.fround(numeric))) return expected;
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${text}'`, loc);
  }
  const option = text.match(/^option\.(none|some)<(.+)>\s*(.*)$/);
  if (option) {
    if (expected.kind !== "option") throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${text}'`, loc);
    let payload;
    try { payload = parseTypeReference(option[2]).canonical; } catch { throw new VerificationError(`air.v051.typed_constructor_type_mismatch: '${text}'`, loc); }
    if (payload !== expected.payload.canonical) throw new VerificationError(`air.v051.typed_constructor_type_mismatch: '${text}'`, loc);
    if (option[1] === "none") {
      if (option[3]) throw new VerificationError(`air.v051.typed_constructor_invalid: '${text}'`, loc);
      return expected;
    }
    if (!option[3]) throw new VerificationError(`air.v051.typed_constructor_invalid: '${text}'`, loc);
    verifyV051TypedAtom(option[3], expected.payload, locals, declarations, loc);
    return expected;
  }
  const result = text.match(/^result\.(ok|err)<(.+)>\s+(.+)$/);
  if (result) {
    if (expected.kind !== "result") throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${text}'`, loc);
    const parts = splitV051TypeArguments(result[2]);
    if (!parts || parts.length !== 2 || parts[0] !== expected.payload.canonical || parts[1] !== expected.error.canonical) {
      throw new VerificationError(`air.v051.typed_constructor_type_mismatch: '${text}'`, loc);
    }
    if (result[1] === "ok") {
      verifyV051TypedAtom(result[3], expected.payload, locals, declarations, loc);
      return expected;
    }
    if (result[1] === "err") {
      verifyV051TypedAtom(result[3], expected.error, locals, declarations, loc);
      return expected;
    }
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${text}'`, loc);
  }
  const enumLiteral = text.match(/^([a-z][a-z0-9._-]{0,127}::)?([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (enumLiteral && expected.kind === "enum") {
    const typeName = expected.canonical.slice(expected.canonical.lastIndexOf("::") + 2);
    const declaration = declarations.get(expected.canonical);
    const enumModule = enumLiteral[1] ? enumLiteral[1].slice(0, -2) : expected.moduleId;
    if (enumModule === expected.moduleId && enumLiteral[2] === typeName && declaration && declaration.cases.some((entry) => entry.name === enumLiteral[3])) return expected;
  }
  throw new VerificationError(`air.v051.typed_atom_invalid: '${text}'`, loc);
}

function splitV051TypeArguments(value) {
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

function assertRealtimeSafeProfile(mod, profile, certificate) {
  const failProfile = (code, message, loc = mod && mod.loc) => {
    fail(`${code}: ${message}`, loc);
  };
  if (!profile || profile.mode !== REALTIME_SAFE_MODE) {
    failProfile("air.realtime.profile_invalid", "execution profile must be realtime_safe");
  }
  if (profile.airAbi !== "0.11" || profile.feature !== BORROWED_MEMORY_FEATURE) {
    failProfile(
      "air.realtime.abi_feature_mismatch",
      "realtime_safe requires AIR ABI 0.11 with borrowed-slice-v1"
    );
  }
  if (!Number.isSafeInteger(profile.maximumFuel) || profile.maximumFuel <= 0) {
    failProfile("air.realtime.fuel_invalid", "maximumFuel must be a positive safe integer");
  }
  if ((mod.capabilities && mod.capabilities.size) || (mod.generatedCapabilities && mod.generatedCapabilities.size)) {
    failProfile("air.realtime.capability_forbidden", "realtime_safe modules must declare no capabilities");
  }
  if ((mod.externs || []).length) {
    failProfile("air.realtime.host_call_forbidden", "realtime_safe modules must declare no host imports");
  }
  if ((mod.effects || []).length || (mod.functions || []).some((fn) => (fn.effects || []).length)) {
    failProfile("air.realtime.effect_forbidden", "realtime_safe modules must declare no effects");
  }
  if ((mod.globals || []).length || (mod.states || []).length || (mod.pools || []).length) {
    failProfile(
      "air.realtime.hidden_state_forbidden",
      "persistent realtime state must use explicit mutable borrowed parameters"
    );
  }
  const entry = (mod.functions || []).find((fn) => fn.name === profile.entrypoint);
  if (!entry || !entry.exported) {
    failProfile(
      "air.realtime.entrypoint_invalid",
      `entrypoint '${profile.entrypoint || "-"}' must name an exported function`
    );
  }
  const borrowedParams = (entry.params || []).filter((param) => param.type === BORROWED_SLICE_TYPE);
  if (!borrowedParams.length) {
    failProfile("air.realtime.borrowed_boundary_required", "entrypoint must expose borrowed memory");
  }
  for (const param of entry.params || []) {
    if (param.type === "slice" || isCompositeType(param.type)) {
      failProfile(
        "air.realtime.borrowed_boundary_required",
        `entrypoint parameter '${param.name}' must use borrowed_slice at a memory boundary`,
        param.loc || entry.loc
      );
    }
  }
  const borrowedByName = new Map(borrowedParams.map((param) => [param.name, param]));
  for (const name of profile.stateParameters || []) {
    const param = borrowedByName.get(name);
    if (!param || !param.borrow || param.borrow.access !== "readwrite") {
      failProfile(
        "air.realtime.state_parameter_invalid",
        `state parameter '${name}' must be an entrypoint readwrite borrowed_slice`,
        entry.loc
      );
    }
  }
  const usage = collectEffectUsage(mod);
  if ((usage.get("stdio.print") || 0) > 0) {
    failProfile("air.realtime.logging_forbidden", "print and logging are forbidden during realtime invocation");
  }
  if ((usage.get("memory.alloc") || 0) > 0 || (usage.get("memory.dynamic_allocations") || 0) > 0) {
    failProfile("air.realtime.allocation_forbidden", "allocation is forbidden during realtime invocation");
  }
  if ((usage.get("memory.free") || 0) > 0) {
    failProfile("air.realtime.free_forbidden", "free is forbidden during realtime invocation");
  }
  if ((usage.get("effects.dynamic") || 0) > 0 || (usage.get("cpu.recursive_calls") || 0) > 0) {
    failProfile("air.realtime.unbounded_work_forbidden", "unbounded or recursive work is forbidden");
  }
  for (const fn of mod.functions || []) {
    for (const block of fn.blocks || []) {
      for (const ins of block.instructions || []) {
        if (ins.op === "io.poll_bounded" || ins.op === "loop.poll") {
          failProfile("air.realtime.async_forbidden", "async and polling work are forbidden", ins.loc);
        }
        if (String(ins.op || "").includes("indirect")) {
          failProfile("air.realtime.indirect_call_forbidden", "indirect calls are unsupported", ins.loc);
        }
      }
    }
  }
  const validation = validateVerifiedResourceCertificate(certificate, {
    required: true,
    packageDigest: certificate && certificate.package && certificate.package.digest
  });
  if (!validation.ok || !certificate || certificate.mode !== "required" ||
      certificate.status !== "verified" ||
      certificate.requiredBoundsSatisfied !== true) {
    failProfile("air.realtime.certificate_invalid", "a complete verified resource certificate is required");
  }
  const requiredBounds = new Set(certificate.requiredBounds || []);
  for (const category of REALTIME_SAFE_REQUIRED_BOUNDS) {
    if (!requiredBounds.has(category)) {
      failProfile(
        "air.realtime.certificate_invalid",
        `resource certificate must require '${category}'`
      );
    }
  }
  const bounds = certificate.bounds || {};
  if (!bounds.hostCalls || bounds.hostCalls.totalUpperBound !== 0) {
    failProfile("air.realtime.host_call_forbidden", "certificate host-call bound must be zero");
  }
  if (!bounds.memory || bounds.memory.dynamicAllocationSites !== 0 ||
      bounds.memory.dynamicAllocationBytesUpperBound !== 0) {
    failProfile("air.realtime.allocation_forbidden", "certificate dynamic allocation bound must be zero");
  }
  const effectBounds = bounds.effects && bounds.effects.upperBounds || [];
  const forbiddenEffect = effectBounds.find((item) =>
    item.key !== "exports" &&
    !String(item.key || "").startsWith("cpu.") &&
    !String(item.key || "").startsWith("memory.") &&
    !String(item.key || "").startsWith("borrowed.") &&
    item.upperBound > 0);
  if (forbiddenEffect) {
    failProfile(
      "air.realtime.effect_forbidden",
      `certificate effect '${forbiddenEffect.key}' must have a zero upper bound`
    );
  }
  const instructionRecord = effectBounds.find((item) => item.key === "cpu.instructions");
  const instructionUpperBound = instructionRecord && instructionRecord.upperBound;
  const loops = bounds.loops || {};
  const loopFuelUpperBound =
    Number(loops.totalStaticallyBoundedIterations || 0) +
    Number(loops.totalDynamicLoopFuelUpperBound || 0);
  if (!Number.isSafeInteger(instructionUpperBound) || instructionUpperBound < 0 ||
      !Number.isSafeInteger(loopFuelUpperBound) || loopFuelUpperBound < 0) {
    failProfile("air.realtime.fuel_unproven", "instruction and loop fuel must be statically bounded");
  }
  if (instructionUpperBound > profile.maximumFuel || loopFuelUpperBound > profile.maximumFuel) {
    failProfile(
      "air.realtime.fuel_exceeded",
      `verified instruction/fuel bounds exceed maximumFuel ${profile.maximumFuel}`
    );
  }
  return stableCertificateObject({
    mode: REALTIME_SAFE_MODE,
    entrypoint: entry.name,
    stateParameters: (profile.stateParameters || []).slice().sort(),
    instructionUpperBound,
    loopFuelUpperBound,
    certificateDigest: certificate.certificateDigest,
    packageDigest: certificate.package.digest,
    airAbi: profile.airAbi,
    feature: profile.feature
  });
}

function collectEffectUsage(mod, constants = constantValuesForModule(mod)) {
  const usage = new Map();
  const functions = functionMapForUsage(mod);
  const entries = (mod.functions || []).filter((fn) => fn.exported || fn.name === "main");
  for (const fn of entries.length ? entries : mod.functions || []) mergeUsage(usage, collectFunctionUsage(fn, functions, [], constants));
  usage.set("exports", (mod.functions || []).filter((fn) => fn.exported).length);
  usage.set("memory.static_readonly_bytes", staticReadonlyBytesForTables(mod));
  usage.set("static_readonly_bytes", staticReadonlyBytesForTables(mod));
  usage.set("memory.static_state_bytes", staticStateBytes(mod));
  usage.set("state.static_bytes", staticStateBytes(mod));
  const poolBytes = staticPoolBytes(mod);
  if (poolBytes > 0) {
    usage.set("memory.static_pool_bytes", poolBytes);
    usage.set("pool.static_bytes", poolBytes);
  }
  return usage;
}

function createVerifiedResourceCertificate(input, options = {}) {
  const entries = normalizeCertificateModules(input, options);
  const verifier = resourceVerifierIdentity();
  const moduleRecords = entries.map((entry) => {
    const facts = resourceFactsForModule(entry.mod);
    return stableCertificateObject({
      path: entry.path,
      name: entry.mod.name || null,
      digest: entry.digest || hashWithDomain("AIR_VERIFIED_RESOURCE_MODULE_V1", moduleDigestInput(entry.mod)),
      digestSource: entry.digest ? "source-bytes" : "canonical-module-facts",
      facts
    });
  }).sort((a, b) => String(a.path).localeCompare(String(b.path)));
  const manifestDigest = validSha256(options.manifestDigest) ? options.manifestDigest : null;
  const packageDigest = validSha256(options.packageDigest)
    ? options.packageDigest
    : hashWithDomain(RESOURCE_PACKAGE_DOMAIN, {
      manifestDigest,
      modules: moduleRecords.map((item) => ({ path: item.path, digest: item.digest }))
    });
  const bounds = combineResourceBounds(moduleRecords);
  const normalizedPolicy = normalizeCertificatePolicy(options.policy, options.mode);
  const policy = bounds.borrowedMemory.borrowedParameterCount > 0 && normalizedPolicy.mode === "required"
    ? {
        ...normalizedPolicy,
        requiredBounds: Array.from(new Set(
          normalizedPolicy.requiredBounds.concat("borrowedMemory")
        )).sort()
      }
    : normalizedPolicy;
  const unknown = unknownResourceReasons(bounds);
  const unsupported = [
    {
      code: "host_enforcement_separate",
      category: "hostEnforcement",
      reason: "The certificate proves AIR verifier bounds; whether a host enforces those bounds is a separate host responsibility."
    },
    {
      code: "wall_clock_time_not_proven",
      category: "timing",
      reason: "Wall-clock duration, scheduler delay, and external service latency are outside this certificate."
    },
    {
      code: "native_stack_usage_not_proven",
      category: "memory",
      reason: "Native host stack usage and host allocator behavior are outside AIR static memory accounting."
    }
  ];
  const requiredUnknown = unknown.filter((item) => policy.requiredBounds.includes(item.category));
  const declared = moduleRecords.flatMap((item) =>
    (item.facts.effectBudgets || []).map((budget) => ({
      module: item.path,
      category: "effects",
      key: budget.key,
      op: budget.op,
      limit: budget.limit,
      scope: budget.scope
    })));
  const payload = stableCertificateObject({
    schemaVersion: RESOURCE_CERTIFICATE_SCHEMA_VERSION,
    kind: RESOURCE_CERTIFICATE_KIND,
    status: requiredUnknown.length ? "incomplete" : "verified",
    mode: policy.mode,
    verifier,
    package: {
      name: options.packageName || moduleRecords[0]?.name || null,
      digest: packageDigest,
      manifestDigest
    },
    modules: moduleRecords,
    bounds,
    classifications: {
      verified: verifiedResourceClassifications(bounds),
      declared,
      unknown,
      unsupported
    },
    requiredBounds: policy.requiredBounds,
    requiredBoundsSatisfied: requiredUnknown.length === 0,
    hostEnforcement: "separate"
  });
  return stableCertificateObject({
    ...payload,
    certificateDigest: hashWithDomain(RESOURCE_CERTIFICATE_DOMAIN, payload)
  });
}

function validateVerifiedResourceCertificate(certificate, options = {}) {
  const diagnostics = [];
  const normalizedOptions = validateResourceCertificateOptions(options, diagnostics);
  if (!certificate || typeof certificate !== "object" || Array.isArray(certificate)) {
    diagnostics.push(resourceCertificateDiagnostic("air.resource_certificate.invalid", "certificate must be an object"));
    return resourceCertificateValidation(diagnostics);
  }
  if (certificate.schemaVersion !== RESOURCE_CERTIFICATE_SCHEMA_VERSION) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.schema_mismatch",
      `certificate schemaVersion must be ${RESOURCE_CERTIFICATE_SCHEMA_VERSION}`
    ));
  }
  if (certificate.kind !== RESOURCE_CERTIFICATE_KIND) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.kind_mismatch",
      `certificate kind must be ${RESOURCE_CERTIFICATE_KIND}`
    ));
  }
  const { certificateDigest, ...payload } = certificate;
  const expectedSelfDigest = hashWithDomain(RESOURCE_CERTIFICATE_DOMAIN, stableCertificateObject(payload));
  if (certificateDigest !== expectedSelfDigest) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.digest_mismatch",
      "certificate payload does not match certificateDigest"
    ));
  }
  validateBorrowedMemoryCertificateSection(certificate, diagnostics);
  compareCertificateExpectation(diagnostics, "package.digest", certificate.package && certificate.package.digest, normalizedOptions.packageDigest, "air.resource_certificate.package_substitution");
  compareCertificateExpectation(diagnostics, "package.name", certificate.package && certificate.package.name, normalizedOptions.packageName, "air.resource_certificate.package_substitution");
  compareCertificateExpectation(diagnostics, "verifier.digest", certificate.verifier && certificate.verifier.digest, normalizedOptions.verifierDigest, "air.resource_certificate.verifier_mismatch");
  compareCertificateExpectation(diagnostics, "certificateDigest", certificateDigest, normalizedOptions.certificateDigest, "air.resource_certificate.manifest_mismatch");
  if (normalizedOptions.required && certificate.requiredBoundsSatisfied !== true) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.required_bound_unknown",
      "certificate-required mode has unknown required bounds"
    ));
  }
  return resourceCertificateValidation(diagnostics);
}

function validateBorrowedMemoryCertificateSection(certificate, diagnostics) {
  const bounds = certificate && certificate.bounds && certificate.bounds.borrowedMemory;
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.borrowed_memory_invalid",
      "certificate bounds.borrowedMemory must be an object"
    ));
    return;
  }
  const { digest, ...payload } = bounds;
  if (digest !== hashWithDomain(BORROWED_MEMORY_CERTIFICATE_DOMAIN, stableCertificateObject(payload))) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.borrowed_memory_digest_mismatch",
      "borrowed-memory bounds do not match their digest"
    ));
  }
  const identities = new Set();
  const parameters = Array.isArray(bounds.parameters) ? bounds.parameters : [];
  if (!Array.isArray(bounds.parameters)) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.borrowed_memory_invalid",
      "borrowed-memory parameters must be an array"
    ));
  }
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.borrowed_memory_invalid",
        "borrowed-memory parameter records must be objects"
      ));
      continue;
    }
    const expectedIdentity = `${parameter.module}::${parameter.function}::${parameter.parameter}`;
    if (parameter.identity !== expectedIdentity || identities.has(parameter.identity)) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.borrowed_parameter_identity_mismatch",
        "borrowed-memory parameter identity is invalid or duplicated",
        { actual: parameter.identity || null, expected: expectedIdentity }
      ));
    }
    identities.add(parameter.identity);
  }
  const modules = Array.isArray(certificate.modules) ? certificate.modules : [];
  for (const moduleRecord of modules) {
    const facts = moduleRecord && moduleRecord.facts && moduleRecord.facts.borrowedMemory;
    if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.borrowed_memory_invalid",
        `module '${moduleRecord && moduleRecord.path || "-"}' is missing borrowed-memory facts`
      ));
      continue;
    }
    const { digest: moduleDigest, ...modulePayload } = facts;
    if (moduleDigest !== hashWithDomain(BORROWED_MEMORY_CERTIFICATE_DOMAIN, stableCertificateObject(modulePayload))) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.borrowed_memory_digest_mismatch",
        `module '${moduleRecord.path}' borrowed-memory facts do not match their digest`
      ));
    }
  }
  if (modules.length) {
    let recomputed = null;
    try {
      recomputed = combineBorrowedMemoryBounds(modules);
    } catch (_) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.borrowed_memory_aggregate_mismatch",
        "package borrowed-memory bounds cannot be recomputed from malformed module facts"
      ));
    }
    if (recomputed && stableCertificateStringify(recomputed) !== stableCertificateStringify(bounds)) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.borrowed_memory_aggregate_mismatch",
        "package borrowed-memory bounds do not match module facts"
      ));
    }
  }
}

function validateResourceCertificateOptions(options, diagnostics) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.option_unknown",
      "certificate validation options must be an object"
    ));
    return {};
  }
  const normalized = {};
  for (const rawKey of Reflect.ownKeys(options)) {
    const key = typeof rawKey === "string" ? rawKey : String(rawKey);
    if (typeof rawKey !== "string" || !RESOURCE_CERTIFICATE_VALIDATION_OPTION_KEYS.has(key)) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.option_unknown",
        `unsupported certificate validation option '${key}'`,
        { option: key }
      ));
      continue;
    }
    normalized[key] = options[rawKey];
  }
  for (const key of RESOURCE_CERTIFICATE_VALIDATION_OPTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(options, key) || !(key in options)) continue;
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.option_unknown",
      `certificate validation option '${key}' must be an own property`,
      { option: key }
    ));
  }
  for (const key in options) {
    if (Object.prototype.hasOwnProperty.call(options, key) ||
        RESOURCE_CERTIFICATE_VALIDATION_OPTION_KEYS.has(key)) continue;
    diagnostics.push(resourceCertificateDiagnostic(
      "air.resource_certificate.option_unknown",
      `certificate validation option '${key}' must be an own property`,
      { option: key }
    ));
  }
  return normalized;
}

function resourceVerifierIdentity() {
  const source = fs.readFileSync(__filename);
  return {
    version: AIR_VERSION,
    digest: hashWithDomain(RESOURCE_VERIFIER_DOMAIN, source)
  };
}

function resourceFactsForModule(mod) {
  const usage = collectEffectUsage(mod);
  const loops = loopCertificateFacts(mod, usage);
  const memory = memoryCertificateFacts(usage);
  const hostCalls = hostCallCertificateFacts(mod, usage);
  const effects = Array.from(usage.entries())
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
    .map(([key, upperBound]) => ({ key, upperBound }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return stableCertificateObject({
    loops,
    memory,
    hostCalls,
    borrowedMemory: borrowedMemoryCertificateFacts(mod),
    effects,
    effectBudgets: effectBudgetFacts(mod)
  });
}

function borrowedMemoryCertificateFacts(mod) {
  const functions = functionMapForUsage(mod);
  const constants = buildConstantEnv(mod);
  const exports = [];
  const parameters = [];
  const relations = [];
  const unsupportedUnprovenReasons = [];

  for (const fn of mod.functions || []) {
    if (!fn.exported) continue;
    const borrowedParams = (fn.params || []).filter((param) => param.type === BORROWED_SLICE_TYPE);
    if (!borrowedParams.length) continue;
    const usage = collectFunctionUsage(fn, functions, [], constants);
    const relationRecords = (fn.requires || [])
      .filter((contract) => contract.kind === "checked_borrow_length")
      .map((contract) => stableCertificateObject({
        identity: `${fn.name}::relation::${contract.borrow}::${contract.parameter}::${contract.multiplier}`,
        function: fn.name,
        borrow: contract.borrow,
        parameter: contract.parameter,
        multiplier: contract.multiplier,
        op: contract.op,
        unit: contract.unit
      }))
      .sort((a, b) => a.identity.localeCompare(b.identity));
    const parameterRecords = borrowedParams.map((param) => {
      if (!param.borrow || !param.borrow.length) {
        unsupportedUnprovenReasons.push({
          code: "borrowed_parameter_metadata_unavailable",
          category: "borrowedMemory",
          identity: `${fn.name}::${param.name}`,
          reason: "Borrowed parameter metadata is incomplete."
        });
      }
      const borrow = param.borrow || {};
      const length = borrow.length || {};
      const access = borrow.access || null;
      return stableCertificateObject({
        identity: `${fn.name}::${param.name}`,
        function: fn.name,
        parameter: param.name,
        access,
        memoryDomain: "wasm-linear",
        minimumByteLength: numberOrNull(length.min),
        maximumByteLength: numberOrNull(length.max),
        requiredAlignment: numberOrNull(borrow.alignment),
        aliasPolicy: BORROWED_MEMORY_ALIAS_POLICY,
        noescape: borrow.noescape === true,
        inPlaceAllowed: false,
        copyInAllowed: access === "readonly" || access === "readwrite",
        copyOutAllowed: access === "writeonly" || access === "readwrite",
        entryRelations: relationRecords.filter((item) => item.borrow === param.name)
      });
    }).sort((a, b) => a.identity.localeCompare(b.identity));
    const maximumTotalBorrowedBytes = sumKnown(parameterRecords.map((item) => item.maximumByteLength));
    const maximumReadableBytes = sumKnown(parameterRecords
      .filter((item) => item.access === "readonly" || item.access === "readwrite")
      .map((item) => item.maximumByteLength));
    const maximumWritableBytes = sumKnown(parameterRecords
      .filter((item) => item.access === "writeonly" || item.access === "readwrite")
      .map((item) => item.maximumByteLength));
    const typedReads = usage.get("borrowed.typed_reads") || 0;
    const typedWrites = usage.get("borrowed.typed_writes") || 0;
    const typedReadBytes = usage.get("borrowed.typed_read_bytes") || 0;
    const typedWriteBytes = usage.get("borrowed.typed_write_bytes") || 0;
    const dynamicBoundsChecks = usage.get("borrowed.dynamic_bounds_checks") || 0;
    const aliasComparisons = borrowedParams.length * (borrowedParams.length - 1) / 2;
    const hostBindingValidationOperations =
      borrowedParams.length * BORROWED_HOST_VALIDATIONS_PER_PARAMETER +
      aliasComparisons +
      relationRecords.length;
    const entry = stableCertificateObject({
      function: fn.name,
      borrowedParameterCount: borrowedParams.length,
      maximumTotalBorrowedBytes,
      maximumReadableBytes,
      maximumWritableBytes,
      maximumCopyInBytes: maximumReadableBytes,
      maximumCopyOutBytes: maximumWritableBytes,
      maximumTypedReads: typedReads,
      maximumTypedWrites: typedWrites,
      maximumReadBytes: typedReadBytes,
      maximumWriteBytes: typedWriteBytes,
      maximumDynamicBoundsChecks: dynamicBoundsChecks,
      maximumRelationChecks: relationRecords.length,
      maximumHostBindingValidationOperations: hostBindingValidationOperations,
      loopFuelContribution: (usage.get("cpu.loop_iterations") || 0) +
        (usage.get("cpu.loop_iterations_upper_bound") || 0),
      parameters: parameterRecords,
      entryRelations: relationRecords
    });
    exports.push(entry);
    parameters.push(...parameterRecords);
    relations.push(...relationRecords);
  }

  const usesBorrowedMemory = parameters.length > 0;
  const payload = stableCertificateObject({
    status: unsupportedUnprovenReasons.length ? "unknown" : "verified",
    airAbi: usesBorrowedMemory ? requiredAirAbiForModule(mod) : null,
    feature: usesBorrowedMemory ? BORROWED_MEMORY_FEATURE : null,
    memoryDomains: usesBorrowedMemory ? ["wasm-linear"] : [],
    supportedTransferModes: usesBorrowedMemory ? BORROWED_MEMORY_TRANSFER_MODES : [],
    aliasPolicy: BORROWED_MEMORY_ALIAS_POLICY,
    borrowedParameterCount: parameters.length,
    maximumParametersPerInvocation: maximumOf(exports, "borrowedParameterCount"),
    maximumTotalBorrowedBytes: maximumOf(exports, "maximumTotalBorrowedBytes"),
    maximumReadableBytes: maximumOf(exports, "maximumReadableBytes"),
    maximumWritableBytes: maximumOf(exports, "maximumWritableBytes"),
    maximumCopyInBytes: maximumOf(exports, "maximumCopyInBytes"),
    maximumCopyOutBytes: maximumOf(exports, "maximumCopyOutBytes"),
    maximumTypedReads: maximumOf(exports, "maximumTypedReads"),
    maximumTypedWrites: maximumOf(exports, "maximumTypedWrites"),
    maximumReadBytes: maximumOf(exports, "maximumReadBytes"),
    maximumWriteBytes: maximumOf(exports, "maximumWriteBytes"),
    maximumDynamicBoundsChecks: maximumOf(exports, "maximumDynamicBoundsChecks"),
    maximumRelationChecks: maximumOf(exports, "maximumRelationChecks"),
    maximumHostBindingValidationOperations: maximumOf(exports, "maximumHostBindingValidationOperations"),
    loopFuelContribution: maximumOf(exports, "loopFuelContribution"),
    parameters: parameters.sort((a, b) => a.identity.localeCompare(b.identity)),
    entryRelations: relations.sort((a, b) => a.identity.localeCompare(b.identity)),
    exports: exports.sort((a, b) => a.function.localeCompare(b.function)),
    unsupportedUnprovenReasons: unsupportedUnprovenReasons.sort((a, b) =>
      String(a.identity).localeCompare(String(b.identity)))
  });
  return stableCertificateObject({
    ...payload,
    digest: hashWithDomain(BORROWED_MEMORY_CERTIFICATE_DOMAIN, payload)
  });
}

function maximumOf(items, key) {
  const values = (items || []).map((item) => item[key]);
  if (values.some((value) => value === null)) return null;
  return Math.max(0, ...values);
}

function sumKnown(values) {
  if ((values || []).some((value) => value === null)) return null;
  return (values || []).reduce((sum, value) => sum + value, 0);
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function loopCertificateFacts(mod, usage) {
  let maximumStatic = 0;
  let maximumDynamicFuel = 0;
  let staticLoops = 0;
  let dynamicLoops = 0;
  const constants = constantValuesForModule(mod);
  for (const fn of mod.functions || []) {
    const consts = new Map();
    for (const [name, value] of constants.entries()) consts.set(name, value.constValue);
    const valueTypes = new Map((fn.params || []).map((param) => [param.name, param.type]));
    for (const block of fn.blocks || []) {
      for (const ins of block.instructions || []) {
        if (ins.result && ins.op === "const.i32" && ins.args[0] && ins.args[0].kind === "number") {
          consts.set(ins.result, ins.args[0].value);
        }
        if (ins.op.startsWith("loop.") || ins.op === "io.poll_bounded") {
          const countArg = ins.op === "io.poll_bounded" ? ins.args[1] : ins.args[2];
          const count = constNumberForArg(countArg, consts);
          if (count === undefined) {
            dynamicLoops += 1;
            maximumDynamicFuel = Math.max(maximumDynamicFuel, ins.op === "io.poll_bounded" ? 4096 : loopIterationUpperBound(ins, valueTypes));
          } else {
            staticLoops += 1;
            maximumStatic = Math.max(maximumStatic, count);
          }
        }
        if (ins.result) valueTypes.set(ins.result, ins.resultType);
      }
    }
  }
  return {
    status: "verified",
    staticLoopCount: staticLoops,
    dynamicLoopCount: dynamicLoops,
    maximumStaticallyBoundedIterations: maximumStatic,
    totalStaticallyBoundedIterations: usage.get("cpu.loop_iterations") || 0,
    maximumDynamicLoopFuel: maximumDynamicFuel,
    totalDynamicLoopFuelUpperBound: usage.get("cpu.loop_iterations_upper_bound") || 0
  };
}

function memoryCertificateFacts(usage) {
  const dynamicAllocationSites = usage.get("memory.dynamic_allocations") || 0;
  const staticReadonlyBytes = usage.get("memory.static_readonly_bytes") || 0;
  const staticStateBytes = usage.get("memory.static_state_bytes") || 0;
  const staticPoolBytes = usage.get("memory.static_pool_bytes") || 0;
  const staticAllocationBytes = usage.get("memory.static_alloc_bytes") || 0;
  return {
    status: dynamicAllocationSites > 0 ? "unknown" : "verified",
    staticReadonlyBytes,
    staticStateBytes,
    staticPoolBytes,
    staticAllocationBytes,
    totalStaticBytesUpperBound: staticReadonlyBytes + staticStateBytes + staticPoolBytes + staticAllocationBytes,
    dynamicAllocationSites,
    dynamicAllocationBytesUpperBound: dynamicAllocationSites > 0 ? null : 0
  };
}

function hostCallCertificateFacts(mod, usage) {
  const byEffect = (mod.externs || []).map((ex) => {
    const upperBound = usage.get(ex.name) || 0;
    return {
      effect: ex.name,
      capability: requiredCapabilityForExtern(ex.name),
      upperBound,
      dynamicBoundUsed: usage.has(`${ex.name}.dynamic`)
    };
  }).filter((item) => item.upperBound > 0)
    .sort((a, b) => a.effect.localeCompare(b.effect));
  const capabilityTotals = new Map();
  for (const item of byEffect) {
    const capability = item.capability || "unknown";
    capabilityTotals.set(capability, (capabilityTotals.get(capability) || 0) + item.upperBound);
  }
  return {
    status: "verified",
    totalUpperBound: byEffect.reduce((sum, item) => sum + item.upperBound, 0),
    byEffect,
    byCapability: Array.from(capabilityTotals.entries())
      .map(([capability, upperBound]) => ({ capability, upperBound }))
      .sort((a, b) => a.capability.localeCompare(b.capability))
  };
}

function effectBudgetFacts(mod) {
  const budgets = [];
  for (const budget of mod.effects || []) {
    budgets.push({ scope: "module", key: budget.key, op: budget.op || "<=", limit: budget.limit });
  }
  for (const fn of mod.functions || []) {
    for (const budget of fn.effects || []) {
      budgets.push({ scope: `function:${fn.name}`, key: budget.key, op: budget.op || "<=", limit: budget.limit });
    }
  }
  return budgets.sort((a, b) =>
    a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key) || a.op.localeCompare(b.op) || a.limit - b.limit);
}

function combineResourceBounds(modules) {
  const loopFacts = modules.map((item) => item.facts.loops);
  const memoryFacts = modules.map((item) => item.facts.memory);
  const hostEffects = new Map();
  const hostCapabilities = new Map();
  for (const item of modules) {
    for (const call of item.facts.hostCalls.byEffect || []) {
      const key = `${call.effect}\0${call.capability || ""}`;
      const current = hostEffects.get(key) || {
        effect: call.effect,
        capability: call.capability,
        upperBound: 0,
        dynamicBoundUsed: false
      };
      current.upperBound += call.upperBound;
      current.dynamicBoundUsed = current.dynamicBoundUsed || call.dynamicBoundUsed;
      hostEffects.set(key, current);
    }
    for (const call of item.facts.hostCalls.byCapability || []) {
      hostCapabilities.set(call.capability, (hostCapabilities.get(call.capability) || 0) + call.upperBound);
    }
  }
  const dynamicAllocationSites = memoryFacts.reduce((sum, item) => sum + item.dynamicAllocationSites, 0);
  return stableCertificateObject({
    borrowedMemory: combineBorrowedMemoryBounds(modules),
    loops: {
      status: "verified",
      maximumStaticallyBoundedIterations: Math.max(0, ...loopFacts.map((item) => item.maximumStaticallyBoundedIterations)),
      totalStaticallyBoundedIterations: loopFacts.reduce((sum, item) => sum + item.totalStaticallyBoundedIterations, 0),
      maximumDynamicLoopFuel: Math.max(0, ...loopFacts.map((item) => item.maximumDynamicLoopFuel)),
      totalDynamicLoopFuelUpperBound: loopFacts.reduce((sum, item) => sum + item.totalDynamicLoopFuelUpperBound, 0)
    },
    memory: {
      status: dynamicAllocationSites > 0 ? "unknown" : "verified",
      staticReadonlyBytes: memoryFacts.reduce((sum, item) => sum + item.staticReadonlyBytes, 0),
      staticStateBytes: memoryFacts.reduce((sum, item) => sum + item.staticStateBytes, 0),
      staticPoolBytes: memoryFacts.reduce((sum, item) => sum + item.staticPoolBytes, 0),
      staticAllocationBytes: memoryFacts.reduce((sum, item) => sum + item.staticAllocationBytes, 0),
      totalStaticBytesUpperBound: memoryFacts.reduce((sum, item) => sum + item.totalStaticBytesUpperBound, 0),
      dynamicAllocationSites,
      dynamicAllocationBytesUpperBound: dynamicAllocationSites > 0 ? null : 0
    },
    hostCalls: {
      status: "verified",
      totalUpperBound: Array.from(hostEffects.values()).reduce((sum, item) => sum + item.upperBound, 0),
      byEffect: Array.from(hostEffects.values()).sort((a, b) => a.effect.localeCompare(b.effect)),
      byCapability: Array.from(hostCapabilities.entries())
        .map(([capability, upperBound]) => ({ capability, upperBound }))
        .sort((a, b) => a.capability.localeCompare(b.capability))
    },
    outputs: outputCertificateFacts(modules, hostEffects),
    effects: {
      status: "verified",
      upperBounds: combineEffectUpperBounds(modules)
    }
  });
}

function combineBorrowedMemoryBounds(modules) {
  const records = [];
  const parameters = [];
  const relations = [];
  const unsupportedUnprovenReasons = [];
  for (const moduleRecord of modules || []) {
    const facts = moduleRecord.facts && moduleRecord.facts.borrowedMemory;
    if (!facts) {
      unsupportedUnprovenReasons.push({
        code: "borrowed_module_facts_missing",
        category: "borrowedMemory",
        identity: moduleRecord.path,
        reason: "Module borrowed-memory facts are absent."
      });
      continue;
    }
    records.push(facts);
    for (const parameter of facts.parameters || []) {
      parameters.push(stableCertificateObject({
        ...parameter,
        identity: `${moduleRecord.path}::${parameter.identity}`,
        module: moduleRecord.path
      }));
    }
    for (const relation of facts.entryRelations || []) {
      relations.push(stableCertificateObject({
        ...relation,
        identity: `${moduleRecord.path}::${relation.identity}`,
        module: moduleRecord.path
      }));
    }
    for (const reason of facts.unsupportedUnprovenReasons || []) {
      unsupportedUnprovenReasons.push(stableCertificateObject({
        ...reason,
        identity: `${moduleRecord.path}::${reason.identity || reason.code}`,
        module: moduleRecord.path
      }));
    }
  }
  const usesBorrowedMemory = parameters.length > 0;
  const airAbiValues = Array.from(new Set(records.map((item) => item.airAbi).filter(Boolean))).sort();
  const features = Array.from(new Set(records.map((item) => item.feature).filter(Boolean))).sort();
  const memoryDomains = Array.from(new Set(records.flatMap((item) => item.memoryDomains || []))).sort();
  const supportedTransferModes = Array.from(new Set(
    records.flatMap((item) => item.supportedTransferModes || [])
  )).sort();
  if (airAbiValues.length > 1) {
    unsupportedUnprovenReasons.push({
      code: "borrowed_air_abi_inconsistent",
      category: "borrowedMemory",
      identity: "package",
      reason: "Borrowed modules disagree on AIR ABI identity."
    });
  }
  if (features.length > 1) {
    unsupportedUnprovenReasons.push({
      code: "borrowed_feature_inconsistent",
      category: "borrowedMemory",
      identity: "package",
      reason: "Borrowed modules disagree on feature identity."
    });
  }
  const payload = stableCertificateObject({
    status: unsupportedUnprovenReasons.length ? "unknown" : "verified",
    airAbi: usesBorrowedMemory ? airAbiValues[0] || null : null,
    feature: usesBorrowedMemory ? features[0] || null : null,
    memoryDomains,
    supportedTransferModes,
    aliasPolicy: BORROWED_MEMORY_ALIAS_POLICY,
    borrowedParameterCount: parameters.length,
    maximumParametersPerInvocation: maximumOf(records, "maximumParametersPerInvocation"),
    maximumTotalBorrowedBytes: maximumOf(records, "maximumTotalBorrowedBytes"),
    maximumReadableBytes: maximumOf(records, "maximumReadableBytes"),
    maximumWritableBytes: maximumOf(records, "maximumWritableBytes"),
    maximumCopyInBytes: maximumOf(records, "maximumCopyInBytes"),
    maximumCopyOutBytes: maximumOf(records, "maximumCopyOutBytes"),
    maximumTypedReads: maximumOf(records, "maximumTypedReads"),
    maximumTypedWrites: maximumOf(records, "maximumTypedWrites"),
    maximumReadBytes: maximumOf(records, "maximumReadBytes"),
    maximumWriteBytes: maximumOf(records, "maximumWriteBytes"),
    maximumDynamicBoundsChecks: maximumOf(records, "maximumDynamicBoundsChecks"),
    maximumRelationChecks: maximumOf(records, "maximumRelationChecks"),
    maximumHostBindingValidationOperations: maximumOf(records, "maximumHostBindingValidationOperations"),
    loopFuelContribution: maximumOf(records, "loopFuelContribution"),
    parameters: parameters.sort((a, b) => a.identity.localeCompare(b.identity)),
    entryRelations: relations.sort((a, b) => a.identity.localeCompare(b.identity)),
    unsupportedUnprovenReasons: unsupportedUnprovenReasons.sort((a, b) =>
      String(a.identity).localeCompare(String(b.identity)))
  });
  return stableCertificateObject({
    ...payload,
    digest: hashWithDomain(BORROWED_MEMORY_CERTIFICATE_DOMAIN, payload)
  });
}

function outputCertificateFacts(modules, hostEffects) {
  const hostCallUpperBounds = Array.from(hostEffects.values())
    .filter((item) => String(item.effect || "").startsWith("output."))
    .sort((a, b) => a.effect.localeCompare(b.effect));
  const declaredBudgets = modules.flatMap((item) =>
    (item.facts.effectBudgets || [])
      .filter((budget) => String(budget.key || "").startsWith("output."))
      .map((budget) => ({ module: item.path, ...budget })))
    .sort((a, b) =>
      a.module.localeCompare(b.module) ||
      a.scope.localeCompare(b.scope) ||
      a.key.localeCompare(b.key));
  return {
    status: "verified",
    totalHostCallUpperBound: hostCallUpperBounds.reduce((sum, item) => sum + item.upperBound, 0),
    hostCallUpperBounds,
    declaredBudgets
  };
}

function combineEffectUpperBounds(modules) {
  const totals = new Map();
  for (const item of modules) {
    for (const effect of item.facts.effects || []) {
      totals.set(effect.key, (totals.get(effect.key) || 0) + effect.upperBound);
    }
  }
  return Array.from(totals.entries())
    .map(([key, upperBound]) => ({ key, upperBound }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function unknownResourceReasons(bounds) {
  const unknown = [];
  if (bounds.memory.dynamicAllocationSites > 0) {
    unknown.push({
      code: "dynamic_allocation_size_unknown",
      category: "memory",
      reason: `${bounds.memory.dynamicAllocationSites} dynamic allocation site(s) do not have a package-level byte upper bound`
    });
  }
  for (const reason of bounds.borrowedMemory && bounds.borrowedMemory.unsupportedUnprovenReasons || []) {
    unknown.push(stableCertificateObject(reason));
  }
  return unknown;
}

function verifiedResourceClassifications(bounds) {
  return [
    { category: "borrowedMemory", status: bounds.borrowedMemory.status },
    { category: "loops", status: bounds.loops.status },
    { category: "memory", status: bounds.memory.status },
    { category: "hostCalls", status: bounds.hostCalls.status },
    { category: "outputs", status: bounds.outputs.status },
    { category: "effects", status: bounds.effects.status }
  ].filter((item) => item.status === "verified");
}

function normalizeCertificateModules(input, options) {
  const source = Array.isArray(input) ? input : [{ mod: input, path: options.modulePath, digest: options.moduleDigest }];
  if (!source.length) throw new Error("resource certificate requires at least one AIR module");
  return source.map((entry, index) => {
    const normalized = entry && entry.mod ? entry : { mod: entry };
    if (!normalized.mod || typeof normalized.mod !== "object") throw new Error(`resource certificate module ${index} is invalid`);
    return {
      mod: normalized.mod,
      path: normalized.path || normalized.mod.name || `module-${index}`,
      digest: validSha256(normalized.digest) ? normalized.digest : null
    };
  });
}

function normalizeCertificatePolicy(policy, modeOverride) {
  const source = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {};
  const mode = modeOverride || source.mode || "optional";
  const requiredBounds = Array.isArray(source.requiredBounds) && source.requiredBounds.length
    ? Array.from(new Set(source.requiredBounds.filter((item) => RESOURCE_BOUND_CATEGORIES.has(item)))).sort()
    : Array.from(RESOURCE_BOUND_CATEGORIES).sort();
  return {
    mode: mode === "required" ? "required" : "optional",
    requiredBounds
  };
}

function moduleDigestInput(mod) {
  return {
    name: mod.name || null,
    capabilities: Array.from(mod.capabilities || []).sort(),
    effects: effectBudgetFacts(mod),
    externs: (mod.externs || []).map((ex) => ({
      name: ex.name,
      params: ex.params,
      returnType: ex.returnType
    })).sort((a, b) => a.name.localeCompare(b.name)),
    functions: (mod.functions || []).map((fn) => ({
      name: fn.name,
      exported: Boolean(fn.exported),
      params: fn.params,
      returnType: fn.returnType,
      blocks: (fn.blocks || []).map((block) => ({
        label: block.label,
        instructions: (block.instructions || []).map((ins) => ({
          result: ins.result || null,
          resultType: ins.resultType || null,
          op: ins.op,
          callee: ins.callee || null,
          args: ins.args || []
        }))
      }))
    })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

function compareCertificateExpectation(diagnostics, field, actual, expected, code) {
  if (expected == null) return;
  if (actual !== expected) {
    diagnostics.push(resourceCertificateDiagnostic(code, `${field} does not match the expected package or manifest value`, {
      field,
      expected,
      actual: actual == null ? null : actual
    }));
  }
}

function resourceCertificateDiagnostic(code, message, fields = {}) {
  return { code, severity: "fail", message, fields: stableCertificateObject(fields) };
}

function resourceCertificateValidation(diagnostics) {
  return stableCertificateObject({
    ok: diagnostics.length === 0,
    status: diagnostics.length === 0 ? "pass" : "fail",
    diagnostics
  });
}

function hashWithDomain(domain, value) {
  const hash = crypto.createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
  if (Buffer.isBuffer(value)) hash.update(value);
  else hash.update(stableCertificateStringify(value), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function validSha256(value) {
  return /^sha256:[a-f0-9]{64}$/.test(String(value || ""));
}

function stableCertificateStringify(value) {
  return JSON.stringify(stableCertificateObject(value));
}

function stableCertificateObject(value) {
  if (Array.isArray(value)) return value.map(stableCertificateObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableCertificateObject(value[key]);
  return out;
}

function functionMapForUsage(mod) {
  const functions = new Map();
  for (const ex of mod.externs || []) functions.set(ex.name, ex);
  for (const fn of mod.functions || []) functions.set(fn.name, fn);
  return functions;
}

function buildConstantEnv(mod) {
  const constants = new Map();
  for (const constant of mod.constants || []) {
    if (constants.has(constant.name)) fail(`duplicate constant '${constant.name}'`, constant.loc);
    if (!["i32", "i64", "f32", "f64", "bool"].includes(constant.type)) {
      fail(`constant '${constant.name}' type '${constant.type}' is not supported in scalar constants`, constant.loc);
    }
    const constValue = constantRuntimeValue(constant);
    validateConstantRange(constant, constValue);
    constants.set(constant.name, { ...constant, constValue });
  }
  return constants;
}

function buildTableEnv(mod, constants = new Map()) {
  const tables = new Map();
  for (const table of mod.tables || []) {
    if (constants.has(table.name)) fail(`table '${table.name}' conflicts with constant '${table.name}'`, table.loc);
    if (tables.has(table.name)) fail(`duplicate table '${table.name}'`, table.loc);
    rejectBorrowedStorage(table.type, `table '${table.name}'`, table.loc);
    if (!["i32", "i64", "f32", "f64", "bool", "u8", "u16", "i16"].includes(table.type)) {
      fail(`table '${table.name}' element type '${table.type}' is not supported in static scalar tables`, table.loc);
    }
    if (!Number.isInteger(table.length) || table.length <= 0 || table.length > 65536) {
      fail(`table '${table.name}' length must be between 1 and 65536`, table.loc);
    }
    if (!Array.isArray(table.values) || table.values.length !== table.length) {
      fail(`table '${table.name}' length ${table.length} does not match ${(table.values || []).length} initializer value(s)`, table.loc);
    }
    const values = table.values.map((value, index) => tableRuntimeValue(table, value, index, constants));
    tables.set(table.name, { ...table, constValues: values });
  }
  return tables;
}

function buildTableGroupEnv(mod, tables = new Map(), constants = new Map()) {
  const groups = new Map();
  for (const group of mod.tableGroups || []) {
    if (constants.has(group.name)) fail(`tablegroup '${group.name}' conflicts with constant '${group.name}'`, group.loc);
    if (tables.has(group.name)) fail(`tablegroup '${group.name}' conflicts with table '${group.name}'`, group.loc);
    if (groups.has(group.name)) fail(`duplicate tablegroup '${group.name}'`, group.loc);
    if (!Number.isInteger(group.length) || group.length <= 0 || group.length > 65536) {
      fail(`tablegroup '${group.name}' length must be between 1 and 65536`, group.loc);
    }
    const fields = new Map();
    for (const field of group.fields || []) {
      if (fields.has(field.name)) fail(`tablegroup '${group.name}' duplicate field '${field.name}'`, field.loc || group.loc);
      rejectBorrowedStorage(field.type, `tablegroup '${group.name}' field '${field.name}'`, field.loc || group.loc);
      if (!["i32", "bool"].includes(field.type)) {
        fail(`tablegroup '${group.name}' field '${field.name}' type '${field.type}' is not supported; first slice supports i32 and bool only`, field.loc || group.loc);
      }
      if (field.length !== group.length) {
        fail(`tablegroup '${group.name}' field '${field.name}' length ${field.length} does not match group length ${group.length}`, field.loc || group.loc);
      }
      const table = tables.get(field.loweredTableName);
      if (!table) fail(`tablegroup '${group.name}' field '${field.name}' missing lowered table '${field.loweredTableName}'`, field.loc || group.loc);
      if (table.length !== group.length) {
        fail(`tablegroup '${group.name}' field '${field.name}' length ${table.length} does not match group length ${group.length}`, field.loc || group.loc);
      }
      if (table.type !== field.type) {
        fail(`tablegroup '${group.name}' field '${field.name}' type ${table.type} does not match ${field.type}`, field.loc || group.loc);
      }
      fields.set(field.name, { ...field, table });
    }
    groups.set(group.name, { ...group, fields });
  }
  return groups;
}

function buildStateEnv(mod, constants = new Map(), tables = new Map(), tableGroups = new Map()) {
  const states = new Map();
  for (const state of mod.states || []) {
    if (constants.has(state.name)) fail(`state '${state.name}' conflicts with constant '${state.name}'`, state.loc);
    if (tables.has(state.name)) fail(`state '${state.name}' conflicts with table '${state.name}'`, state.loc);
    if (tableGroups.has(state.name)) fail(`state '${state.name}' conflicts with tablegroup '${state.name}'`, state.loc);
    if (states.has(state.name)) fail(`duplicate state '${state.name}'`, state.loc);
    rejectBorrowedStorage(state.type, `state '${state.name}'`, state.loc);
    if (state.type !== "i32") {
      fail(`state '${state.name}' cell type '${state.type}' is not supported; first slice supports i32 only`, state.loc);
    }
    if (!Number.isInteger(state.length) || state.length <= 0 || state.length > 65536) {
      fail(`state '${state.name}' length must be between 1 and 65536`, state.loc);
    }
    if (!state.init || state.init.kind !== "fill" || !state.init.value || state.init.value.kind !== "number" || !Number.isInteger(state.init.value.value)) {
      fail(`state '${state.name}' initializer must be fill <i32 literal>`, state.loc);
    }
    states.set(state.name, state);
  }
  return states;
}

function buildPoolEnv(mod, constants = new Map(), tables = new Map(), tableGroups = new Map(), states = new Map()) {
  const pools = new Map();
  for (const pool of mod.pools || []) {
    if (constants.has(pool.name)) fail(`air.pool.invalid: pool '${pool.name}' conflicts with constant '${pool.name}'`, pool.loc);
    if (tables.has(pool.name)) fail(`air.pool.invalid: pool '${pool.name}' conflicts with table '${pool.name}'`, pool.loc);
    if (tableGroups.has(pool.name)) fail(`air.pool.invalid: pool '${pool.name}' conflicts with tablegroup '${pool.name}'`, pool.loc);
    if (states.has(pool.name)) fail(`air.pool.invalid: pool '${pool.name}' conflicts with state '${pool.name}'`, pool.loc);
    if (pools.has(pool.name)) fail(`air.pool.invalid: duplicate pool '${pool.name}'`, pool.loc);
    if (!Number.isInteger(pool.capacity) || pool.capacity <= 0 || pool.capacity > 65536) {
      fail(`air.pool.capacity_invalid: pool '${pool.name}' capacity must be between 1 and 65536`, pool.loc);
    }
    const fields = new Map();
    for (const field of pool.fields || []) {
      if (fields.has(field.name)) fail(`air.pool.invalid: pool '${pool.name}' duplicate field '${field.name}'`, field.loc || pool.loc);
      rejectBorrowedStorage(field.type, `pool '${pool.name}' field '${field.name}'`, field.loc || pool.loc);
      if (!["i32", "bool"].includes(field.type)) {
        fail(`air.pool.field_type_invalid: pool '${pool.name}' field '${field.name}' type '${field.type}' is not supported; first slice supports i32 and bool only`, field.loc || pool.loc);
      }
      if (!isPoolScalarLiteral(field.init, field.type)) {
        fail(`air.pool.field_type_invalid: pool '${pool.name}' field '${field.name}' initializer must be ${field.type} literal`, field.loc || pool.loc);
      }
      fields.set(field.name, { ...field, capacity: pool.capacity });
    }
    const active = fields.get("active");
    if (!active || active.type !== "bool") {
      fail(`air.pool.active_flag_missing: pool '${pool.name}' must declare active:bool`, pool.loc);
    }
    pools.set(pool.name, { ...pool, fields, activeField: "active" });
  }
  return pools;
}

function isPoolScalarLiteral(value, type) {
  if (type === "bool") return value && value.kind === "bool";
  if (type === "i32") return value && value.kind === "number" && Number.isInteger(value.value) && value.value >= -2147483648 && value.value <= 2147483647;
  return false;
}

function tableRuntimeValue(table, value, index, constants = new Map()) {
  if (!value || !["number", "bool", "symbol"].includes(value.kind)) {
    fail(`table '${table.name}' value ${index} must be a scalar literal or same-module constant`, table.loc);
  }
  if (value.kind === "symbol") {
    if (isCompactTableType(table.type)) {
      fail(`table '${table.name}' value ${index} must be a literal for compact storage type ${table.type}`, table.loc);
    }
    const constant = constants.get(value.name);
    if (!constant) fail(`table '${table.name}' value ${index} references unknown constant '${value.name}'`, table.loc);
    if (constant.type !== table.type) {
      fail(`table '${table.name}' value ${index} constant '${value.name}' has type ${constant.type}, expected ${table.type}`, table.loc);
    }
    return constant.constValue;
  }
  if (table.type === "bool") {
    if (value.kind !== "bool") fail(`table '${table.name}' value ${index} must be bool`, table.loc);
    return value.value ? 1 : 0;
  }
  if (value.kind !== "number") fail(`table '${table.name}' value ${index} must be numeric`, table.loc);
  if ((table.type === "i32" || table.type === "i64" || isCompactTableType(table.type)) && !Number.isInteger(value.value)) {
    fail(`table '${table.name}' value ${index} must be an integer literal`, table.loc);
  }
  validateTableValueRange(table, value.value, index);
  if (table.type === "i32" && (value.value < -2147483648 || value.value > 2147483647)) {
    fail(`table '${table.name}' value ${index} i32 literal out of range`, table.loc);
  }
  return value.value;
}

function staticReadonlyBytesForTables(mod) {
  return (mod.tables || []).reduce((sum, table) => sum + (table.length || 0) * (tableStorageByteWidth(table.type) || 0), 0);
}

function staticStateBytes(mod) {
  return (mod.states || []).reduce((sum, state) => sum + (state.length || 0) * (scalarByteWidth(state.type) || 0), 0);
}

function staticPoolBytes(mod) {
  return (mod.pools || []).reduce((sum, pool) => {
    return sum + (pool.fields || []).reduce((fieldSum, field) => fieldSum + (pool.capacity || 0) * (scalarByteWidth(field.type) || 0), 0);
  }, 0);
}

function constantValuesForModule(mod) {
  const constants = new Map();
  for (const constant of mod.constants || []) {
    constants.set(constant.name, { ...constant, constValue: literalRuntimeValue(constant.value) });
  }
  return constants;
}

function constantRuntimeValue(constant) {
  const value = constant.value;
  if (!value || !["number", "bool"].includes(value.kind)) {
    fail(`constant '${constant.name}' initializer must be a scalar literal`, constant.loc);
  }
  if (constant.type === "bool") {
    if (value.kind !== "bool") fail(`constant '${constant.name}' initializer must be bool`, constant.loc);
    return value.value ? 1 : 0;
  }
  if (value.kind !== "number") fail(`constant '${constant.name}' initializer must be numeric`, constant.loc);
  if ((constant.type === "i32" || constant.type === "i64") && !Number.isInteger(value.value)) {
    fail(`constant '${constant.name}' initializer must be an integer literal`, constant.loc);
  }
  return value.value;
}

function literalRuntimeValue(value) {
  if (!value) return undefined;
  if (value.kind === "bool") return value.value ? 1 : 0;
  if (value.kind === "number") return value.value;
  return undefined;
}

function validateConstantRange(constant, value) {
  if (constant.type === "i32" && (value < -2147483648 || value > 2147483647)) {
    fail(`constant '${constant.name}' i32 literal out of range`, constant.loc);
  }
  if (constant.type === "bool" && value !== 0 && value !== 1) {
    fail(`constant '${constant.name}' bool literal out of range`, constant.loc);
  }
}

function collectFunctionUsage(fn, functions = new Map(), stack = [], constants = new Map()) {
  const usage = new Map();
  let staticAllocBytes = 0;
  let dynamicAllocations = 0;
  const add = (key, amount = 1) => usage.set(key, (usage.get(key) || 0) + amount);
  const consts = new Map();
  for (const [name, constant] of constants.entries()) consts.set(name, constant.constValue);
  const valueTypes = new Map((fn.params || []).map((param) => [param.name, param.type]));
  for (const block of fn.blocks || []) {
    add("cpu.blocks");
    for (const ins of block.instructions || []) {
      add("cpu.instructions");
      if (ins.result && ins.op === "const.i32" && ins.args[0] && ins.args[0].kind === "number") {
        consts.set(ins.result, ins.args[0].value);
      }
      if (ins.op === "call") {
        const callee = functions.get(ins.callee);
        if (callee && !callee.external) {
          add(`call.${ins.callee}`);
          mergeUsage(usage, collectNestedFunctionUsage(callee, functions, stack.concat(fn.name), constants));
        } else {
          add(ins.callee);
        }
        if (ins.callee.startsWith("gpu.")) add("gpu.calls");
        if (ins.callee.startsWith("gpu.draw")) {
          add("gpu.draw_calls");
          const staticInstances = constNumberForArg(ins.args[1], consts);
          if (staticInstances !== undefined) add("gpu.instances", staticInstances);
        }
        if (ins.callee === "gpu.execute_render_graph") add("gpu.render_graph_calls");
      }
      if (ins.op === "print") add("stdio.print");
      if (ins.op === "br" || ins.op === "br_if") add("cpu.branches");
      if (ins.op.startsWith("loop.")) {
        add("cpu.loops");
        const staticCount = constNumberForArg(ins.args[2], consts);
        const upperBound = loopIterationUpperBound(ins, valueTypes);
        const count = staticCount !== undefined ? staticCount : upperBound;
        if (staticCount !== undefined) add("cpu.loop_iterations", staticCount);
        else {
          add("cpu.dynamic_loops");
          add("effects.dynamic");
          add("cpu.loop_iterations_upper_bound", count);
        }
        if (ins.op !== "loop.poll") {
          const calleeArg = ins.args[0];
          const callee = calleeArg && calleeArg.kind === "function" ? functions.get(calleeArg.name) : null;
          if (callee && !callee.external) {
            mergeUsage(usage, scaledUsage(collectNestedFunctionUsage(callee, functions, stack.concat(fn.name), constants), count));
          }
        }
      }
      if (ins.op === "loop.poll") {
        const callee = ins.args[0] && ins.args[0].kind === "function" ? ins.args[0].name : null;
        const staticCount = constNumberForArg(ins.args[2], consts);
        const count = staticCount !== undefined ? staticCount : loopIterationUpperBound(ins, valueTypes);
        if (callee) add(callee, count);
        if (callee && staticCount === undefined) {
          add(`${callee}.dynamic`);
        }
      }
      if (ins.op === "io.poll_bounded") {
        const staticCount = constNumberForArg(ins.args[1], consts);
        const count = staticCount !== undefined ? staticCount : 4096;
        add("io.poll", count);
        if (staticCount === undefined) {
          add("io.poll.dynamic");
          add("effects.dynamic");
        }
      }
      if (ins.result) valueTypes.set(ins.result, ins.resultType);
      if (ins.op.startsWith("phi.")) add("cpu.phi");
      if (ins.op === "alloc_region") {
        add("memory.alloc");
        const arg = ins.args[0];
        const staticBytes = constNumberForArg(arg, consts);
        if (staticBytes !== undefined) staticAllocBytes += staticBytes;
        else dynamicAllocations += 1;
      }
      if (ins.op === "free_region") add("memory.free");
      if (ins.op.startsWith("load.") || ins.op === "buffer.load" || ins.op.startsWith("slice.load.")) add("memory.load");
      if (ins.op.startsWith("store.") || ins.op === "buffer.store" || ins.op.startsWith("slice.store.")) add("memory.store");
      if (ins.op.startsWith("slice.load.") && valueTypeForArg(ins.args[0], valueTypes) === BORROWED_SLICE_TYPE) {
        const width = scalarByteWidth(ins.op.slice("slice.load.".length));
        add("borrowed.typed_reads");
        add("borrowed.typed_read_bytes", width);
        add("borrowed.dynamic_bounds_checks");
      }
      if (ins.op.startsWith("slice.store.") && valueTypeForArg(ins.args[0], valueTypes) === BORROWED_SLICE_TYPE) {
        const width = scalarByteWidth(ins.op.slice("slice.store.".length));
        add("borrowed.typed_writes");
        add("borrowed.typed_write_bytes", width);
        add("borrowed.dynamic_bounds_checks");
      }
      if (ins.op === "mat4.store_f32") add("memory.store", 16);
      if (isTableGetOp(ins.op) || isTableGroupGetOp(ins.op)) add("memory.table_read");
      if (ins.op === "state.get") {
        add("state.read");
        add("memory.state_read");
      }
      if (ins.op === "state.set") {
        add("state.write");
        add("memory.state_write");
      }
      if (ins.op === "pool.get.i32" || ins.op === "pool.get.bool") {
        add("pool.read");
        add("memory.pool_read");
      }
      if (ins.op === "pool.set.i32" || ins.op === "pool.set.bool") {
        add("pool.write");
        add("memory.pool_write");
      }
      if (ins.op === "slice.sub") add("memory.slice_sub");
    }
  }
  usage.set("static_alloc_bytes", staticAllocBytes);
  usage.set("memory.static_alloc_bytes", staticAllocBytes);
  usage.set("dynamic_allocations", dynamicAllocations);
  usage.set("memory.dynamic_allocations", dynamicAllocations);
  return usage;
}

function collectNestedFunctionUsage(fn, functions, stack, constants) {
  if (stack.includes(fn.name)) {
    const usage = new Map();
    usage.set("effects.dynamic", 1);
    usage.set("cpu.recursive_calls", 1);
    return usage;
  }
  return collectFunctionUsage(fn, functions, stack, constants);
}

function valueTypeForArg(arg, valueTypes) {
  if (!arg || arg.kind !== "value") return null;
  return valueTypes.get(arg.name) || valueTypes.get(String(arg.name).replace(/^%/, "")) || null;
}

function rejectLocalCallCycles(mod) {
  const localFunctions = new Map((mod.functions || []).map((fn) => [fn.name, fn]));
  const graph = new Map();
  for (const fn of mod.functions || []) {
    graph.set(fn.name, collectLocalCallEdges(fn, localFunctions));
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);
    stack.push(name);
    for (const edge of graph.get(name) || []) {
      if (!localFunctions.has(edge.to)) continue;
      if (visiting.has(edge.to)) {
        const idx = stack.indexOf(edge.to);
        const cycle = stack.slice(idx).concat(edge.to);
        fail(`air.call.recursion_rejected: local function call cycle ${formatCallCycle(cycle)}`, edge.loc || localFunctions.get(name).loc);
      }
      visit(edge.to);
    }
    stack.pop();
    visiting.delete(name);
    visited.add(name);
  }

  for (const fn of mod.functions || []) visit(fn.name);
}

function collectLocalCallEdges(fn, localFunctions) {
  const edges = [];
  for (const block of fn.blocks || []) {
    for (const ins of block.instructions || []) {
      if (ins.op === "call" && localFunctions.has(ins.callee)) {
        edges.push({ to: ins.callee, loc: ins.loc });
        continue;
      }
      const callback = localLoopCallbackName(ins);
      if (callback && localFunctions.has(callback)) {
        edges.push({ to: callback, loc: ins.loc });
      }
    }
  }
  return edges;
}

function localLoopCallbackName(ins) {
  if (!ins || !ins.args || !ins.args[0] || ins.args[0].kind !== "function") return null;
  if (isScalarFoldLoop(ins.op) || ins.op === "loop.array.i32" || ins.op === "loop.array.f32" || ins.op === "loop.buffer.f32") {
    return ins.args[0].name;
  }
  return null;
}

function formatCallCycle(cycle) {
  return cycle.map((name) => `@${name}`).join(" -> ");
}

function scaledUsage(source, amount) {
  const usage = new Map();
  for (const [key, value] of source.entries()) {
    if (key === "exports") continue;
    usage.set(key, value * amount);
  }
  return usage;
}

function loopIterationUpperBound(ins, valueTypes) {
  if (ins.op === "loop.array.i32" || ins.op === "loop.array.f32") {
    const array = parseArrayType(ins.resultType);
    return array ? Math.min(array.length, 4096) : 4096;
  }
  if (ins.op === "loop.buffer.f32") {
    const bufferArg = ins.args[1];
    const bufferType = bufferArg && bufferArg.kind === "value" ? valueTypes.get(bufferArg.name) : undefined;
    const buffer = parseBufferType(bufferType);
    return buffer ? Math.min(buffer.length, 4096) : 4096;
  }
  return 4096;
}

function mergeUsage(target, source) {
  for (const [key, value] of source.entries()) target.set(key, (target.get(key) || 0) + value);
}

function constNumberForArg(arg, consts) {
  if (!arg) return undefined;
  if (arg.kind === "number") return arg.value;
  if (arg.kind === "value") return consts.get(arg.name);
  if (arg.kind === "symbol") return consts.get(arg.name);
  return undefined;
}

function verifyEffectsAndContracts(mod, usage) {
  for (const budget of mod.effects || []) {
    const actual = effectCount(usage, budget.key);
    if (!compareMetric(actual, budget.op || "<=", budget.limit)) {
      fail(`effect budget '${budget.key} ${budget.op || "<="} ${budget.limit}' is not satisfied: ${actual}; repair: tighten bounded loops, reduce matching operations, or raise the explicit budget`, budget.loc);
    }
  }
  requireBudgetedEffectFamily(mod, usage, "ui");
  requireBudgetedEffectFamily(mod, usage, "output");
  const exported = new Set((mod.functions || []).filter((fn) => fn.exported).map((fn) => fn.name));
  for (const contract of mod.requires || []) {
    if (contract.kind === "capability" && !mod.capabilities.has(contract.capability)) {
      fail(`requires capability '${contract.capability}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "no-capability" && mod.capabilities.has(contract.capability)) {
      fail(`requires no capability '${contract.capability}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "export" && !exported.has(contract.name)) {
      fail(`requires export '${contract.name}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "metric") {
      const actual = effectCount(usage, contract.key);
      if (!compareMetric(actual, contract.op || "<=", contract.limit)) {
        fail(`requires ${contract.key} ${contract.op || "<="} ${contract.limit} is not satisfied: ${actual}; repair: adjust the contract or the counted operations`, contract.loc);
      }
    }
  }
  for (const contract of mod.ensures || []) {
    if (contract.kind === "capability" && !mod.capabilities.has(contract.capability)) {
      fail(`ensures capability '${contract.capability}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "no-capability" && mod.capabilities.has(contract.capability)) {
      fail(`ensures no capability '${contract.capability}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "export" && !exported.has(contract.name)) {
      fail(`ensures export '${contract.name}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "metric") {
      const actual = effectCount(usage, contract.key);
      if (!compareMetric(actual, contract.op || "<=", contract.limit)) {
        fail(`ensures ${contract.key} ${contract.op || "<="} ${contract.limit} is not satisfied: ${actual}; repair: adjust the contract or the counted operations`, contract.loc);
      }
    }
  }
}

function requireBudgetedEffectFamily(mod, usage, family) {
  const prefix = `${family}.`;
  const budgets = mod.effects || [];
  if (budgets.some((budget) => budget.key === `${family}.*`)) return;
  for (const [key, value] of usage.entries()) {
    if (value <= 0 || !key.startsWith(prefix) || key.endsWith(".dynamic")) continue;
    if (!budgets.some((budget) => budget.key === key)) {
      fail(`${family} host call '${key}' requires an explicit effect budget such as 'effects { ${family}.* <= N }' or '${key} <= N'`);
    }
  }
}

function verifyFunctionEffectsAndContracts(mod, fn, usage) {
  for (const budget of fn.effects || []) {
    const actual = effectCount(usage, budget.key);
    if (!compareMetric(actual, budget.op || "<=", budget.limit)) {
      fail(`function '${fn.name}' effect budget '${budget.key} ${budget.op || "<="} ${budget.limit}' is not satisfied: ${actual}; repair: tighten bounded loops, reduce matching operations, or raise the explicit budget`, budget.loc);
    }
  }
  for (const contract of [...(fn.requires || []), ...(fn.ensures || [])]) {
    if (contract.kind === "metric") {
      const actual = effectCount(usage, contract.key);
      if (!compareMetric(actual, contract.op || "<=", contract.limit)) {
        fail(`function '${fn.name}' contract ${contract.key} ${contract.op || "<="} ${contract.limit} is not satisfied: ${actual}; repair: adjust the contract or the counted operations`, contract.loc);
      }
    }
    if (contract.kind === "capability" && !mod.capabilities.has(contract.capability)) {
      fail(`function '${fn.name}' requires capability '${contract.capability}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "no-capability" && mod.capabilities.has(contract.capability)) {
      fail(`function '${fn.name}' requires no capability '${contract.capability}' is not satisfied`, contract.loc);
    }
    if (contract.kind === "export" && (fn.name !== contract.name || !fn.exported)) {
      fail(`function '${fn.name}' export contract '${contract.name}' is not satisfied`, contract.loc);
    }
  }
}

function validateFunctionContractDeclarations(mod, fn) {
  const params = new Map(fn.params.map((param) => [param.name, param]));
  for (const contract of fn.ensures || []) {
    if (contract.kind === "checked_param" || contract.kind === "checked_borrow_length") {
      fail("air.borrow.syntax_invalid: checked entry contracts are valid only in requires declarations", contract.loc);
    }
  }
  for (const contract of [...(fn.requires || []), ...(fn.ensures || [])]) {
    if (contract.kind === "param") {
      const param = params.get(contract.name);
      if (!param) fail(`function '${fn.name}' contract references unknown param '${contract.name}'`, contract.loc);
      if (!["i32", "i64", "f32", "f64"].includes(param.type)) {
        fail(`function '${fn.name}' param contract requires numeric param '${contract.name}'`, contract.loc);
      }
    }
    if (contract.kind === "return") {
      if (!["i32", "i64", "f32", "f64"].includes(fn.returnType)) {
        fail(`function '${fn.name}' return contract requires numeric return type`, contract.loc);
      }
    }
    if (contract.kind === "checked_param") {
      const param = params.get(contract.parameter);
      if (!fn.exported) {
        fail("air.borrow.syntax_invalid: checked entry contracts require an exported function", contract.loc);
      }
      if (!param || param.type !== "i32") {
        fail(
          `air.borrow.syntax_invalid: checked param '${contract.parameter}' must reference an i32 exported parameter`,
          contract.loc
        );
      }
      if (!Number.isSafeInteger(contract.literal) || contract.literal < I32_MIN || contract.literal > I32_MAX) {
        fail("air.borrow.syntax_invalid: checked param literal must fit signed i32", contract.loc);
      }
    }
    if (contract.kind === "checked_borrow_length") {
      const borrow = params.get(contract.borrow);
      const parameter = params.get(contract.parameter);
      if (!fn.exported) {
        fail("air.borrow.syntax_invalid: checked entry contracts require an exported function", contract.loc);
      }
      if (!borrow || borrow.type !== BORROWED_SLICE_TYPE || !borrow.borrow) {
        fail(
          `air.borrow.syntax_invalid: checked bytes '${contract.borrow}' must reference a borrowed_slice parameter`,
          contract.loc
        );
      }
      if (!parameter || parameter.type !== "i32") {
        fail(
          `air.borrow.syntax_invalid: checked bytes parameter '${contract.parameter}' must reference an i32 parameter`,
          contract.loc
        );
      }
      if (!Number.isSafeInteger(contract.multiplier) || contract.multiplier <= 0 || contract.multiplier > I32_MAX) {
        fail("air.borrow.syntax_invalid: checked byte multiplier must be a positive i32 literal", contract.loc);
      }
    }
  }
}

function compareMetric(actual, op, limit) {
  if (op === "<=") return actual <= limit;
  if (op === "==") return actual === limit;
  if (op === ">=") return actual >= limit;
  return false;
}

function effectCount(usage, key) {
  if (key.endsWith(".*")) {
    const prefix = key.slice(0, -1);
    let total = 0;
    for (const [name, count] of usage.entries()) {
      if (name.endsWith(".dynamic")) continue;
      if (name.startsWith(prefix)) total += count;
    }
    return total;
  }
  return usage.get(key) || 0;
}

function validateHostAbiSignature(ex) {
  if (!isStrictHostModule(ex.name)) return;
  const expected = hostSignature(ex.name);
  if (!expected) fail(`unsupported host extern '${ex.name}'`, ex.loc);
  const actual = ex.params.map((param) => param.type);
  if (actual.join(",") !== expected.params.join(",") || ex.returnType !== expected.returnType) {
    fail(`extern ${ex.name} signature must be (${expected.params.join(", ")}) -> ${expected.returnType}`, ex.loc);
  }
}

function isStaticOutputEmitIdArg(arg, values) {
  if (!arg) return false;
  if (arg.kind === "number" && Number.isInteger(arg.value)) return true;
  if (arg.kind === "symbol") {
    const found = values.get(arg.name);
    return Boolean(found && found.type === "i32" && found.constant === true && Number.isInteger(found.constValue));
  }
  return false;
}

function validateCallPreconditions(callee, values, args, loc) {
  if (callee.external) return;
  const paramIndex = new Map(callee.params.map((param, idx) => [param.name, idx]));
  for (const contract of callee.requires || []) {
    if (contract.kind !== "param") continue;
    const idx = paramIndex.get(contract.name);
    if (idx === undefined) continue;
    const actual = constValueOf(values, args[idx]);
    if (actual !== undefined && !compareMetric(actual, contract.op || "<=", contract.value)) {
      fail(`call @${callee.name} violates precondition param ${contract.name} ${contract.op || "<="} ${contract.value}: ${actual}`, loc);
    }
    const range = rangeOf(values, args[idx]);
    if (actual === undefined && range && !rangeSatisfies(range, contract.op || "<=", contract.value)) {
      const factHint = preconditionFactHint(args[idx], contract);
      fail(`call @${callee.name} cannot prove precondition param ${contract.name} ${contract.op || "<="} ${contract.value}; known range is ${formatRange(range)}; ${factHint}`, loc);
    }
  }
}

function validateCallRefinements(callee, values, args, loc) {
  for (let idx = 0; idx < (callee.params || []).length; idx += 1) {
    const param = callee.params[idx];
    if (!param.refinement) continue;
    const actual = refinementRangeOf(values, args[idx], param.refinement.kind);
    if (!actual || !refinementContains(param.refinement, actual)) {
      const known = actual ? formatRange(actual) : "unknown";
      fail(
        `air.refinement.call_argument_out_of_range: call @${callee.name} argument '${param.name}' known range ${known} is not within ${formatRefinementRange(param.refinement)}`,
        loc
      );
    }
  }
}

function preconditionFactHint(arg, contract) {
  const required = `requires param ${contract.name} ${contract.op || "<="} ${contract.value}`;
  if (arg && arg.kind === "value") {
    return `missing fact for ${arg.name}; add caller precondition, callee postcondition, or bounded operation proving '${required}'`;
  }
  return `missing fact proving '${required}'`;
}

function validateReturnContracts(fn, values, arg, loc) {
  const actual = constValueOf(values, arg);
  if (actual === undefined) return;
  for (const contract of fn.ensures || []) {
    if (contract.kind !== "return") continue;
    if (!compareMetric(actual, contract.op || "<=", contract.value)) {
      fail(`function '${fn.name}' violates postcondition return ${contract.op || "<="} ${contract.value}: ${actual}`, loc);
    }
  }
}

function validateReturnRefinement(fn, values, arg, loc) {
  if (!fn.returnRefinement) return;
  const actual = refinementRangeOf(values, arg, fn.returnRefinement.kind);
  if (!actual || !refinementContains(fn.returnRefinement, actual)) {
    const known = actual ? formatRange(actual) : "unknown";
    fail(
      `air.refinement.return_out_of_range: function '${fn.name}' return known range ${known} is not within ${formatRefinementRange(fn.returnRefinement)}`,
      loc
    );
  }
}

function buildTypeEnv(mod) {
  const structs = new Map();
  for (const struct of mod.structs || []) {
    if (structs.has(struct.name)) fail(`duplicate struct '${struct.name}'`, struct.loc);
    const fields = new Map();
    for (const field of struct.fields || []) {
      if (fields.has(field.name)) fail(`duplicate field '${field.name}' in struct '${struct.name}'`, struct.loc);
      fields.set(field.name, field);
    }
    structs.set(struct.name, { ...struct, fields });
  }
  return { structs };
}

function verifyFunction(mod, fn, functions, globals, types, constants = new Map(), tables = new Map(), states = new Map(), pools = new Map()) {
  const labels = new Set(fn.blocks.map((b) => b.label));
  if (labels.size !== fn.blocks.length) fail(`duplicate block label in '${fn.name}'`, fn.loc);
  const cfg = verifySupportedControlFlow(fn);
  const values = new Map();
  const regions = new Map();
  const pendingAsyncBuffers = new Map();
  const asyncRequestBuffers = new Map();
  const readyAsyncRequests = new Set();
  const bufferInit = new Map();
  const pendingPhi = [];
  validateFunctionContractDeclarations(mod, fn);

  for (const [name, constant] of constants.entries()) {
    values.set(name, {
      type: constant.type,
      loc: constant.loc,
      constValue: constant.constValue,
      range: rangeForConstant(constant),
      constant: true
    });
  }
  for (const param of fn.params) {
    values.set(`%${param.name}`, {
      type: param.type,
      loc: fn.loc,
      range: initialRangeForParam(fn, param),
      borrow: param.borrow || undefined,
      sliceRange: param.borrow
        ? {
            kind: "slice_length",
            min: param.borrow.length.min,
            max: param.borrow.length.max
          }
        : param.refinement && param.refinement.kind === "slice_length"
        ? { ...param.refinement }
        : (param.type === "slice" ? { kind: "slice_length", min: 0, max: SLICE_LEN_MAX } : undefined)
    });
  }

  for (const block of fn.blocks) {
    for (const ins of block.instructions) {
      if (ins.result) {
        if (values.has(ins.result)) fail(`SSA value ${ins.result} is already defined`, ins.loc);
      }
      verifyInstruction(mod, fn, ins, functions, globals, labels, values, regions, types, pendingPhi, bufferInit, tables, states, pools);
      trackBufferInitialization(ins, values, bufferInit);
      if (ins.result) {
        const constValue = constValueForInstruction(ins, values, tables);
        const baseRange = rangeForInstruction(ins, values, tables);
        const numericRange = rangeForCallPostconditions(ins, functions, baseRange);
        const slice = sliceMetadataForInstruction(ins, values);
        const sliceRange = sliceRangeForInstruction(ins, functions, values, slice);
        validateAssignedRefinement(ins, numericRange, sliceRange);
        values.set(ins.result, {
          type: ins.resultType,
          loc: ins.loc,
          constValue,
          range: numericRange,
          borrow: borrowMetadataForInstruction(ins, functions, values),
          slice,
          sliceRange: narrowedRefinementRange(ins.refinement, sliceRange)
        });
      }
      if (ins.result && ins.resultType === "ptr" && ins.op === "alloc_region") {
        const size = constValueOf(values, ins.args[0]);
        regions.set(ins.result, {
          live: true,
          loc: ins.loc,
          size,
          sizeRange: rangeOf(values, ins.args[0])
        });
      }
      trackAsyncBufferSafety(ins, pendingAsyncBuffers, asyncRequestBuffers, readyAsyncRequests);
    }
  }
  for (const item of pendingPhi) {
    const found = values.get(item.value);
    if (!found) fail(`phi incoming ${item.value} is not defined`, item.loc);
    if (found.type !== item.type) fail(`phi incoming ${item.value} must be ${item.type}, got ${found.type}`, item.loc);
  }

  const hasReturn = fn.blocks.some((block) => block.instructions.some((ins) => ins.op === "return"));
  if (!hasReturn) fail(`function '${fn.name}' has no return`, fn.loc);
  verifyRegionLifetimes(fn);
  verifyFunctionEffectsAndContracts(mod, fn, collectFunctionUsage(fn, functions, [], constants));
  return cfg;
}

function verifyRegionLifetimes(fn) {
  if (!fn.blocks || fn.blocks.length === 0) return;
  const blocks = new Map(fn.blocks.map((block) => [block.label, block]));
  const work = [{ label: fn.blocks[0].label, state: emptyRegionState() }];
  const seen = new Set();

  while (work.length) {
    const item = work.pop();
    const block = blocks.get(item.label);
    if (!block) continue;
    const key = `${item.label}|${regionStateKey(item.state)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state = cloneRegionState(item.state);

    for (const ins of block.instructions || []) {
      applyRegionInstruction(state, ins, block);
      if (ins.op === "return") {
        failIfRegionsLeakAtReturn(state, block, ins);
        break;
      }
      if (ins.op === "br") {
        for (const label of ins.labels || []) work.push({ label, state: cloneRegionState(state) });
        break;
      }
      if (ins.op === "br_if") {
        for (const label of ins.labels || []) work.push({ label, state: cloneRegionState(state) });
        break;
      }
    }
  }
}

function emptyRegionState() {
  return { live: new Map(), slices: new Map() };
}

function cloneRegionState(state) {
  return {
    live: new Map(state.live),
    slices: new Map(state.slices)
  };
}

function regionStateKey(state) {
  return [
    Array.from(state.live.keys()).sort().join(","),
    Array.from(state.slices.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([slice, base]) => `${slice}:${base}`).join(",")
  ].join("|");
}

function applyRegionInstruction(state, ins, block) {
  if (ins.op === "alloc_region" && ins.result) {
    state.live.set(ins.result, { loc: ins.loc, block: block.label });
    return;
  }
  if (ins.op === "free_region") {
    const ptr = valueArgName(ins.args[0]);
    if (!ptr || !state.live.has(ptr)) fail(`cannot free non-live region ${ptr || "<unknown>"}`, ins.loc);
    state.live.delete(ptr);
    return;
  }
  const ptr = directRegionUseArg(ins);
  if (ptr) requireRegionLiveForLifetime(state, ptr, ins.loc);
  if (ins.op === "slice.from_region" && ins.result) {
    const base = valueArgName(ins.args[0]);
    if (base && state.live.has(base)) state.slices.set(ins.result, base);
    return;
  }
  if (ins.op === "slice.sub" && ins.result) {
    const parent = valueArgName(ins.args[0]);
    const base = parent ? state.slices.get(parent) : null;
    if (base) {
      requireRegionLiveForLifetime(state, base, ins.loc);
      state.slices.set(ins.result, base);
    }
    return;
  }
  if (ins.op === "slice.len" || ins.op.startsWith("slice.load.") || ins.op.startsWith("slice.store.")) {
    const slice = valueArgName(ins.args[0]);
    const base = slice ? state.slices.get(slice) : null;
    if (base) requireRegionLiveForLifetime(state, base, ins.loc);
  }
}

function directRegionUseArg(ins) {
  if (ins.op === "load.i32" || ins.op === "load.f32" || ins.op === "store.i32" || ins.op === "store.f32" || ins.op === "slice.from_region") {
    return valueArgName(ins.args[0]);
  }
  if (ins.op === "mat4.store_f32") return valueArgName(ins.args[1]);
  return null;
}

function requireRegionLiveForLifetime(state, ptr, loc) {
  if (!state.live.has(ptr)) fail(`pointer ${ptr} is not a live region`, loc);
}

function failIfRegionsLeakAtReturn(state, block, ins) {
  const leaked = Array.from(state.live.entries()).sort((a, b) => a[0].localeCompare(b[0]))[0];
  if (!leaked) return;
  const [name, region] = leaked;
  const allocLine = region.loc && region.loc.line ? ` allocated at line ${region.loc.line}` : "";
  fail(`air.memory.region_leak: region ${name}${allocLine} reaches return in block '${block.label}' without free_region; call free_region on all paths before returning`, ins.loc);
}

function trackAsyncBufferSafety(ins, pendingAsyncBuffers, asyncRequestBuffers, readyAsyncRequests) {
  if (ins.op === "free_region") {
    const ptr = valueArgName(ins.args[0]);
    if (ptr && pendingAsyncBuffers.has(ptr)) {
      const pending = pendingAsyncBuffers.get(ptr);
      fail(`cannot free ${ptr} while async request ${pending.request} from ${pending.callee} may still write to it; poll and consume/cancel the request first`, ins.loc);
    }
    return;
  }
  if (ins.op === "io.poll_bounded") {
    const request = valueArgName(ins.args[0]);
    const ptr = request ? asyncRequestBuffers.get(request) : null;
    if (request) readyAsyncRequests.add(request);
    if (ptr) pendingAsyncBuffers.delete(ptr);
    return;
  }
  if (ins.op !== "call") return;
  if (isAsyncOutputCall(ins.callee)) {
    const ptr = valueArgName(ins.args[2]);
    if (!ptr) return;
    const existing = pendingAsyncBuffers.get(ptr);
    if (existing) {
      fail(`async output buffer ${ptr} is already used by pending request ${existing.request} from ${existing.callee}; use a separate buffer or wait for io.result_len/io.cancel before reusing it`, ins.loc);
    }
    if (ins.result) {
      pendingAsyncBuffers.set(ptr, { request: ins.result, callee: ins.callee, loc: ins.loc });
      asyncRequestBuffers.set(ins.result, ptr);
    }
    return;
  }
  if (ins.callee === "io.result_len") {
    const request = valueArgName(ins.args[0]);
    if (request && asyncRequestBuffers.has(request) && !readyAsyncRequests.has(request)) {
      fail(`io.result_len(${request}) requires a ready async request; use 'io.poll_bounded ${request}, count' or an explicit ready-status branch before reading result metadata`, ins.loc);
    }
    const ptr = request ? asyncRequestBuffers.get(request) : null;
    if (ptr) {
      pendingAsyncBuffers.delete(ptr);
      asyncRequestBuffers.delete(request);
      readyAsyncRequests.delete(request);
    }
    return;
  }
  if (ins.callee === "io.cancel") {
    const request = valueArgName(ins.args[0]);
    const ptr = request ? asyncRequestBuffers.get(request) : null;
    if (ptr) {
      pendingAsyncBuffers.delete(ptr);
      asyncRequestBuffers.delete(request);
      readyAsyncRequests.delete(request);
    }
  }
}

function isAsyncOutputCall(callee) {
  return callee === "fs.read_file_async" || callee === "net.http_get_async";
}

function valueArgName(arg) {
  return arg && arg.kind === "value" ? arg.name : null;
}

function trackBufferInitialization(ins, values, bufferInit) {
  if (ins.op === "buffer.from_ptr" && ins.result) {
    bufferInit.set(ins.result, new Set());
    return;
  }
  if (ins.op === "buffer.store") {
    const bufferName = valueArgName(ins.args[0]);
    const index = constValueOf(values, ins.args[1]);
    if (bufferName && index !== undefined && bufferInit.has(bufferName)) {
      bufferInit.get(bufferName).add(index);
    }
  }
}

function verifySupportedControlFlow(fn) {
  const loop = detectStructuredPhiLoop(fn);
  if (loop) return { kind: "loop", ...loop };
  const blockIndex = new Map(fn.blocks.map((block, idx) => [block.label, idx]));
  const incoming = new Map();
  for (let idx = 0; idx < fn.blocks.length; idx += 1) {
    const block = fn.blocks[idx];
    if (block.instructions.length === 0) fail(`block '${block.label}' is empty`, block.loc);
    let terminators = 0;
    for (let insIdx = 0; insIdx < block.instructions.length; insIdx += 1) {
      const ins = block.instructions[insIdx];
      if (isTerminator(ins)) {
        terminators += 1;
        if (insIdx !== block.instructions.length - 1) fail(`terminator '${ins.op}' must be the last instruction in block '${block.label}'`, ins.loc);
      }
    }
    const last = block.instructions[block.instructions.length - 1];
    if (!isTerminator(last)) fail(`block '${block.label}' must terminate with return, br, or br_if`, block.loc);
    if (terminators !== 1) fail(`block '${block.label}' must have exactly one terminator`, block.loc);

    for (const label of branchLabels(last)) {
      const targetIdx = blockIndex.get(label);
      if (targetIdx === undefined) continue;
      if (targetIdx <= idx) fail(`branch target '${label}' must be a forward-only target in AIR v0.2`, last.loc);
      incoming.set(label, (incoming.get(label) || 0) + 1);
      const target = fn.blocks[targetIdx];
      const targetLast = target.instructions[target.instructions.length - 1];
      if (targetLast.op !== "return") {
        fail(`branch target '${label}' must terminate with return in AIR v0.2`, targetLast.loc);
      }
    }
  }
  for (const [label, count] of incoming) {
    if (count > 1) fail(`branch target '${label}' has ${count} incoming branches; joins are not supported in AIR v0.2`, fn.loc);
  }
  return { kind: "tree" };
}

function detectStructuredPhiLoop(fn) {
  const blocks = fn.blocks;
  if (blocks.length !== 4) return null;
  const [entry, header, body, exit] = blocks;
  const entryLast = lastInstruction(entry);
  const headerLast = lastInstruction(header);
  const bodyLast = lastInstruction(body);
  const exitLast = lastInstruction(exit);
  if (!entryLast || !headerLast || !bodyLast || !exitLast) return null;
  if (entryLast.op !== "br" || entryLast.labels[0] !== header.label) return null;
  if (headerLast.op !== "br_if") return null;
  if (headerLast.labels[0] !== exit.label || headerLast.labels[1] !== body.label) return null;
  if (bodyLast.op !== "br" || bodyLast.labels[0] !== header.label) return null;
  if (exitLast.op !== "return") return null;
  const phiInstructions = header.instructions.filter((ins) => ins.op.startsWith("phi."));
  if (phiInstructions.length === 0) return null;
  for (const [idx, ins] of header.instructions.entries()) {
    if (idx < phiInstructions.length && !ins.op.startsWith("phi.")) return null;
    if (idx >= phiInstructions.length && ins.op.startsWith("phi.")) return null;
  }
  return { entry: entry.label, header: header.label, body: body.label, exit: exit.label, phiCount: phiInstructions.length };
}

function lastInstruction(block) {
  return block.instructions[block.instructions.length - 1];
}

function isTerminator(ins) {
  return ins.op === "return" || ins.op === "br" || ins.op === "br_if";
}

function branchLabels(ins) {
  return ins.op === "br" || ins.op === "br_if" ? ins.labels || [] : [];
}

function verifyInstruction(mod, fn, ins, functions, globals, labels, values, regions, types, pendingPhi = [], bufferInit = new Map(), tables = new Map(), states = new Map(), pools = new Map()) {
  if (ins.op === "return") {
    if (fn.returnType === "void") {
      if (ins.args.length !== 0) fail("void function must return without value", ins.loc);
    } else {
      expectArgCount(ins, 1);
      if (borrowedValue(values, ins.args[0])) {
        fail("air.borrow.escape_return: an invocation-scoped borrowed slice cannot be returned", ins.loc);
      }
      expectType(values, ins.args[0], fn.returnType, ins.loc);
      validateReturnContracts(fn, values, ins.args[0], ins.loc);
      validateReturnRefinement(fn, values, ins.args[0], ins.loc);
    }
    return;
  }

  if (ins.op === "br") {
    if (!labels.has(ins.labels[0])) fail(`invalid branch target '${ins.labels[0]}'`, ins.loc);
    return;
  }

  if (ins.op === "br_if") {
    expectType(values, ins.args[0], "bool", ins.loc);
    for (const label of ins.labels) {
      if (!labels.has(label)) fail(`invalid branch target '${label}'`, ins.loc);
    }
    return;
  }

  if (ins.op === "phi.i32" || ins.op === "phi.f32" || ins.op === "phi.bool") {
    const type = ins.op.slice("phi.".length);
    requireResult(ins);
    if (ins.resultType !== type) fail(`${ins.op} produces ${type}`, ins.loc);
    if (ins.args.length < 2) fail(`${ins.op} expects at least 2 incoming values`, ins.loc);
    for (const arg of ins.args) {
      if (!arg || arg.kind !== "phi") fail(`${ins.op} expects label:%value incoming operands`, ins.loc);
      if (!labels.has(arg.label)) fail(`${ins.op} references unknown incoming label '${arg.label}'`, ins.loc);
      const found = values.get(arg.value);
      if (found && found.type !== type) fail(`phi incoming ${arg.value} must be ${type}, got ${found.type}`, ins.loc);
      if (!found) pendingPhi.push({ value: arg.value, type, loc: ins.loc });
    }
    return;
  }

  if (ins.op === "print") {
    expectArgCount(ins, 1);
    if (!mod.capabilities.has("stdio")) fail("print requires capability 'stdio'", ins.loc);
    const value = inferType(values, ins.args[0], ins.loc);
    if (value.type === BORROWED_SLICE_TYPE) {
      fail("air.borrow.extern_opaque: borrowed slices cannot be forwarded to print or another opaque host boundary", ins.loc);
    }
    expectType(values, ins.args[0], "slice", ins.loc);
    return;
  }

  if (ins.op === "call") {
    const callee = functions.get(ins.callee);
    if (!callee) {
      const bundle = bundleForExtern(ins.callee);
      const hint = bundle ? `; add 'use ${bundle}'` : "";
      fail(`unknown function '${ins.callee}'${hint}`, ins.loc);
    }
    if (callee.params.length !== ins.args.length) {
      fail(`call @${ins.callee} expects ${callee.params.length} args, got ${ins.args.length}`, ins.loc);
    }
    callee.params.forEach((param, idx) => {
      const actual = inferType(values, ins.args[idx], ins.loc);
      if (actual.type === BORROWED_SLICE_TYPE || param.type === BORROWED_SLICE_TYPE) {
        const actualBorrow = borrowedValue(values, ins.args[idx]);
        if (callee.external || callee.packageExternal) {
          fail(`air.borrow.extern_opaque: borrowed slice argument ${idx} cannot be passed to opaque extern @${ins.callee}`, ins.loc);
        }
        if (!param.borrow || !actualBorrow || !borrowedArgumentCompatible(param.borrow, actualBorrow)) {
          fail(
            `air.borrow.call_mismatch: argument ${idx} for @${ins.callee} is not compatible with ${param.declaredType || param.type}`,
            ins.loc
          );
        }
        return;
      }
      expectType(values, ins.args[idx], param.type, ins.loc);
    });
    validateCallRefinements(callee, values, ins.args, ins.loc);
    if (ins.callee === "output.emit" && !isStaticOutputEmitIdArg(ins.args[0], values)) {
      fail("output.emit output_id must be a statically resolvable i32 literal or module constant in v0.26", ins.loc);
    }
    validateCallPreconditions(callee, values, ins.args, ins.loc);
    if (!ins.result && callee.returnType !== "void") fail(`call @${ins.callee} result must be assigned`, ins.loc);
    if (ins.result && ins.resultType !== callee.returnType) {
      fail(`call @${ins.callee} returns ${callee.returnType}, assigned to ${ins.resultType}`, ins.loc);
    }
    return;
  }

  if (ins.op === "loop.poll") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("loop.poll produces i32", ins.loc);
    expectArgCount(ins, 3);
    const calleeArg = ins.args[0];
    if (!calleeArg || calleeArg.kind !== "function") fail("loop.poll expects a function reference such as @io.poll", ins.loc);
    const callee = functions.get(calleeArg.name);
    if (!callee) fail(`loop.poll expects known function @${calleeArg.name}`, ins.loc);
    if (callee.name !== "io.poll") fail("loop.poll is reserved for @io.poll request handles; use loop.fold.* for scalar accumulator loops", ins.loc);
    if (callee.params.length !== 1 || callee.params[0].type !== "i32" || callee.returnType !== "i32") {
      fail("loop.poll function @io.poll must be (i32) -> i32", ins.loc);
    }
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], "i32", ins.loc);
    const count = constValueOf(values, ins.args[2]);
    if (count !== undefined && (count < 0 || count > 4096)) fail("loop.poll count must be between 0 and 4096", ins.loc);
    return;
  }

  if (ins.op === "io.poll_bounded") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("io.poll_bounded produces i32 ready status", ins.loc);
    expectArgCount(ins, 2);
    const poll = functions.get("io.poll");
    if (!poll) fail("io.poll_bounded requires extern io.poll; add 'use utility.io'", ins.loc);
    if (!mod.capabilities.has("io")) fail("io.poll_bounded requires capability 'io'; add 'use utility.io'", ins.loc);
    if (poll.params.length !== 1 || poll.params[0].type !== "i32" || poll.returnType !== "i32") {
      fail("io.poll_bounded requires io.poll(request: i32) -> i32", ins.loc);
    }
    expectType(values, ins.args[0], "i32", ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    const count = constValueOf(values, ins.args[1]);
    if (count !== undefined && (count < 1 || count > 4096)) fail("io.poll_bounded count must be between 1 and 4096", ins.loc);
    return;
  }

  if (isScalarFoldLoop(ins.op)) {
    const valueType = ins.op.endsWith(".i32") ? "i32" : "f32";
    requireResult(ins);
    if (ins.resultType !== valueType) fail(`${ins.op} produces ${valueType}`, ins.loc);
    expectArgCount(ins, 3);
    const calleeArg = ins.args[0];
    if (!calleeArg || calleeArg.kind !== "function") fail(`${ins.op} expects a local function reference`, ins.loc);
    const callee = functions.get(calleeArg.name);
    if (!callee || callee.external) fail(`${ins.op} expects local function @${calleeArg.name}`, ins.loc);
    if (callee.params.length !== 1 || callee.params[0].type !== valueType || callee.returnType !== valueType) {
      fail(`${ins.op} function @${calleeArg.name} must be (${valueType}) -> ${valueType}`, ins.loc);
    }
    if (functionCallsExtern(callee, "io.poll")) {
      fail(`${ins.op} is a scalar accumulator fold: each iteration receives the previous result, so the second poll would receive previous status instead of the original request handle. Use 'loop.poll @io.poll, %request, count' for request polling.`, ins.loc);
    }
    expectType(values, ins.args[1], valueType, ins.loc);
    expectType(values, ins.args[2], "i32", ins.loc);
    const count = constValueOf(values, ins.args[2]);
    if (count !== undefined && (count < 0 || count > 4096)) fail(`${ins.op} count must be between 0 and 4096`, ins.loc);
    return;
  }

  if (ins.op === "loop.array.i32" || ins.op === "loop.array.f32") {
    const valueType = ins.op.endsWith(".i32") ? "i32" : "f32";
    requireResult(ins);
    expectArgCount(ins, 3);
    const calleeArg = ins.args[0];
    if (!calleeArg || calleeArg.kind !== "function") fail(`${ins.op} expects a local function reference`, ins.loc);
    const callee = functions.get(calleeArg.name);
    if (!callee || callee.external) fail(`${ins.op} expects local function @${calleeArg.name}`, ins.loc);
    if (callee.params.length !== 1 || callee.params[0].type !== valueType || callee.returnType !== valueType) {
      fail(`${ins.op} function @${calleeArg.name} must be (${valueType}) -> ${valueType}`, ins.loc);
    }
    const owner = inferType(values, ins.args[1], ins.loc);
    const array = expectArray(owner.type, ins.loc);
    if (array.element !== valueType) fail(`${ins.op} requires array<${valueType},N>`, ins.loc);
    if (array.length > 4096) fail(`${ins.op} array length must be <= 4096`, ins.loc);
    if (ins.resultType !== owner.type) fail(`${ins.op} produces ${owner.type}, assigned to ${ins.resultType}`, ins.loc);
    expectType(values, ins.args[2], "i32", ins.loc);
    const count = constValueOf(values, ins.args[2]);
    if (count !== undefined && (count < 0 || count > array.length)) {
      fail(`${ins.op} count must be between 0 and array length ${array.length}`, ins.loc);
    }
    return;
  }

  if (ins.op === "loop.buffer.f32") {
    if (ins.result) fail("loop.buffer.f32 does not produce a result", ins.loc);
    expectArgCount(ins, 3);
    const calleeArg = ins.args[0];
    if (!calleeArg || calleeArg.kind !== "function") fail("loop.buffer.f32 expects a local function reference", ins.loc);
    const callee = functions.get(calleeArg.name);
    if (!callee || callee.external) fail(`loop.buffer.f32 expects local function @${calleeArg.name}`, ins.loc);
    if (callee.params.length !== 1 || callee.params[0].type !== "f32" || callee.returnType !== "f32") {
      fail(`loop.buffer.f32 function @${calleeArg.name} must be (f32) -> f32`, ins.loc);
    }
    const owner = inferType(values, ins.args[1], ins.loc);
    const buffer = expectBuffer(owner.type, ins.loc);
    if (buffer.element !== "f32") fail("loop.buffer.f32 requires buffer<f32,N>", ins.loc);
    expectType(values, ins.args[2], "i32", ins.loc);
    const count = constValueOf(values, ins.args[2]);
    if (buffer.length > 4096) fail("loop.buffer.f32 buffer length must be <= 4096", ins.loc);
    if (count !== undefined && (count < 0 || count > buffer.length || count > 4096)) {
      fail(`loop.buffer.f32 count must be between 0 and min(buffer length, 4096), got ${count}`, ins.loc);
    }
    if (count !== undefined) expectInitializedBufferRange(bufferInit, owner.name, count, ins.loc);
    return;
  }

  const constType = typeOfConstOp(ins.op);
  if (constType) {
    requireResult(ins);
    if (ins.resultType !== constType) fail(`${ins.op} produces ${constType}, assigned to ${ins.resultType}`, ins.loc);
    expectArgCount(ins, 1);
    return;
  }

  if (["i32.add", "i32.sub", "i32.mul"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "i32") fail(`${ins.op} produces i32`, ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "i32", ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    return;
  }

  if (["i32.div_s", "i32.rem_s", "i32.and", "i32.or", "i32.xor", "i32.shl", "i32.shr_u"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "i32") fail(`${ins.op} produces i32`, ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "i32", ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    return;
  }

  if (["f32.add", "f32.sub", "f32.mul", "f32.div", "f32.min", "f32.max"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "f32") fail(`${ins.op} produces f32`, ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "f32", ins.loc);
    expectType(values, ins.args[1], "f32", ins.loc);
    return;
  }

  if (["f32.sin", "f32.cos"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "f32") fail(`${ins.op} produces f32`, ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "f32", ins.loc);
    return;
  }

  if (ins.op === "f32.clamp") {
    requireResult(ins);
    if (ins.resultType !== "f32") fail("f32.clamp produces f32", ins.loc);
    expectArgCount(ins, 3);
    for (const arg of ins.args) expectType(values, arg, "f32", ins.loc);
    return;
  }

  if (ins.op === "f32.lerp" || ins.op === "f32.inverse_lerp") {
    requireResult(ins);
    if (ins.resultType !== "f32") fail(`${ins.op} produces f32`, ins.loc);
    expectArgCount(ins, 3);
    for (const arg of ins.args) expectType(values, arg, "f32", ins.loc);
    return;
  }

  if (["ease.smoothstep", "ease.out_quad"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "f32") fail(`${ins.op} produces f32`, ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "f32", ins.loc);
    return;
  }

  if (ins.op === "f32.convert_i32_s") {
    requireResult(ins);
    if (ins.resultType !== "f32") fail("f32.convert_i32_s produces f32", ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "i32", ins.loc);
    return;
  }

  if (ins.op === "i32.trunc_f32_s") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("i32.trunc_f32_s produces i32", ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "f32", ins.loc);
    return;
  }

  if (ins.op === "f32.sqrt") {
    requireResult(ins);
    if (ins.resultType !== "f32") fail("f32.sqrt produces f32", ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "f32", ins.loc);
    return;
  }

  if (["i32.eq", "i32.ne", "i32.lt_s", "i32.gt_s", "i32.le_s", "i32.ge_s"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "bool") fail(`${ins.op} produces bool`, ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "i32", ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    return;
  }

  if (["f32.eq", "f32.ne", "f32.lt", "f32.gt", "f32.le", "f32.ge"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "bool") fail(`${ins.op} produces bool`, ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "f32", ins.loc);
    expectType(values, ins.args[1], "f32", ins.loc);
    return;
  }

  if (["bool.and", "bool.or"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "bool") fail(`${ins.op} produces bool`, ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "bool", ins.loc);
    expectType(values, ins.args[1], "bool", ins.loc);
    return;
  }

  if (ins.op === "bool.not") {
    requireResult(ins);
    if (ins.resultType !== "bool") fail("bool.not produces bool", ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "bool", ins.loc);
    return;
  }

  if (ins.op === "physics.damp_i32") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("physics.damp_i32 produces i32", ins.loc);
    expectArgCount(ins, 5);
    for (const arg of ins.args) expectType(values, arg, "i32", ins.loc);
    return;
  }

  if (ins.op === "physics.grounded_i32") {
    requireResult(ins);
    if (ins.resultType !== "bool") fail("physics.grounded_i32 produces bool", ins.loc);
    expectArgCount(ins, 4);
    for (const arg of ins.args) expectType(values, arg, "i32", ins.loc);
    return;
  }

  if (ins.op === "physics.snap_y_i32" || ins.op === "physics.snap_vy_i32") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail(`${ins.op} produces i32`, ins.loc);
    expectArgCount(ins, 4);
    for (const arg of ins.args) expectType(values, arg, "i32", ins.loc);
    return;
  }

  if (ins.op === "fixed.mul_i32" || ins.op === "fixed.div_i32") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail(`${ins.op} produces i32`, ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "i32", ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    requireUse(mod, "math.fixed", ins);
    return;
  }

  if (ins.op === "fixed.clamp_i32") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("fixed.clamp_i32 produces i32", ins.loc);
    expectArgCount(ins, 3);
    for (const arg of ins.args) expectType(values, arg, "i32", ins.loc);
    requireUse(mod, "math.fixed", ins);
    return;
  }
  if (ins.op === "fixed.lerp_i32") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("fixed.lerp_i32 produces i32", ins.loc);
    expectArgCount(ins, 3);
    for (const arg of ins.args) expectType(values, arg, "i32", ins.loc);
    requireUse(mod, "math.fixed", ins);
    return;
  }

  if (ins.op === "select.i32") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("select.i32 produces i32", ins.loc);
    expectArgCount(ins, 3);
    expectType(values, ins.args[0], "bool", ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], "i32", ins.loc);
    return;
  }

  if (ins.op === "select.f32") {
    requireResult(ins);
    if (ins.resultType !== "f32") fail("select.f32 produces f32", ins.loc);
    expectArgCount(ins, 3);
    expectType(values, ins.args[0], "bool", ins.loc);
    expectType(values, ins.args[1], "f32", ins.loc);
    expectType(values, ins.args[2], "f32", ins.loc);
    return;
  }

  const vectorOp = ins.op.match(/^(vec[234])\.(new|add|sub|scale|dot|len_sq|normalize|x|y|z|w)$/);
  if (vectorOp) {
    const [, type, op] = vectorOp;
    const width = Number(type.slice(3));
    const componentNames = ["x", "y", "z", "w"].slice(0, width);
    requireResult(ins);
    if (op === "new") {
      if (ins.resultType !== type) fail(`${type}.new produces ${type}`, ins.loc);
      expectArgCount(ins, width);
      for (const arg of ins.args) expectType(values, arg, "f32", ins.loc);
      return;
    }
    if (op === "add" || op === "sub") {
      if (ins.resultType !== type) fail(`${ins.op} produces ${type}`, ins.loc);
      expectArgCount(ins, 2);
      expectType(values, ins.args[0], type, ins.loc);
      expectType(values, ins.args[1], type, ins.loc);
      return;
    }
    if (op === "scale") {
      if (ins.resultType !== type) fail(`${type}.scale produces ${type}`, ins.loc);
      expectArgCount(ins, 2);
      expectType(values, ins.args[0], type, ins.loc);
      expectType(values, ins.args[1], "f32", ins.loc);
      return;
    }
    if (op === "dot") {
      if (ins.resultType !== "f32") fail(`${type}.dot produces f32`, ins.loc);
      expectArgCount(ins, 2);
      expectType(values, ins.args[0], type, ins.loc);
      expectType(values, ins.args[1], type, ins.loc);
      return;
    }
    if (op === "len_sq") {
      if (ins.resultType !== "f32") fail(`${type}.len_sq produces f32`, ins.loc);
      expectArgCount(ins, 1);
      expectType(values, ins.args[0], type, ins.loc);
      return;
    }
    if (op === "normalize") {
      if (ins.resultType !== type) fail(`${type}.normalize produces ${type}`, ins.loc);
      expectArgCount(ins, 1);
      expectType(values, ins.args[0], type, ins.loc);
      return;
    }
    if (componentNames.includes(op)) {
      if (ins.resultType !== "f32") fail(`${ins.op} produces f32`, ins.loc);
      expectArgCount(ins, 1);
      expectType(values, ins.args[0], type, ins.loc);
      return;
    }
  }

  if (ins.op === "vec3.move_relative") {
    requireResult(ins);
    if (ins.resultType !== "vec3") fail("vec3.move_relative produces vec3", ins.loc);
    expectArgCount(ins, 6);
    expectType(values, ins.args[0], "vec3", ins.loc);
    expectType(values, ins.args[1], "vec3", ins.loc);
    expectType(values, ins.args[2], "vec3", ins.loc);
    expectType(values, ins.args[3], "f32", ins.loc);
    expectType(values, ins.args[4], "f32", ins.loc);
    expectType(values, ins.args[5], "f32", ins.loc);
    return;
  }

  if (["vec3.x", "vec3.y", "vec3.z"].includes(ins.op)) {
    requireResult(ins);
    if (ins.resultType !== "f32") fail(`${ins.op} produces f32`, ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "vec3", ins.loc);
    return;
  }

  if (ins.op === "mat4.identity") {
    requireResult(ins);
    if (ins.resultType !== "mat4") fail("mat4.identity produces mat4", ins.loc);
    expectArgCount(ins, 0);
    return;
  }

  if (ins.op === "mat4.mul") {
    requireResult(ins);
    if (ins.resultType !== "mat4") fail("mat4.mul produces mat4", ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "mat4", ins.loc);
    expectType(values, ins.args[1], "mat4", ins.loc);
    return;
  }

  if (ins.op === "mat4.from_trs") {
    requireResult(ins);
    if (ins.resultType !== "mat4") fail("mat4.from_trs produces mat4", ins.loc);
    expectArgCount(ins, 3);
    expectType(values, ins.args[0], "vec3", ins.loc);
    expectType(values, ins.args[1], "quat", ins.loc);
    expectType(values, ins.args[2], "vec3", ins.loc);
    return;
  }

  if (ins.op === "mat4.perspective") {
    requireResult(ins);
    if (ins.resultType !== "mat4") fail("mat4.perspective produces mat4", ins.loc);
    expectArgCount(ins, 4);
    for (const arg of ins.args) expectType(values, arg, "f32", ins.loc);
    return;
  }

  if (ins.op === "mat4.look_at") {
    requireResult(ins);
    if (ins.resultType !== "mat4") fail("mat4.look_at produces mat4", ins.loc);
    expectArgCount(ins, 3);
    for (const arg of ins.args) expectType(values, arg, "vec3", ins.loc);
    return;
  }

  if (ins.op === "mat4.store_f32") {
    if (ins.result) fail("mat4.store_f32 does not produce a result", ins.loc);
    expectArgCount(ins, 3);
    expectType(values, ins.args[0], "mat4", ins.loc);
    const region = expectLivePtr(values, regions, ins.args[1], ins.loc);
    expectType(values, ins.args[2], "i32", ins.loc);
    ins.regionBoundsCheck = expectRegionBounds(region, rangeOf(values, ins.args[2]), 64, ins.loc);
    return;
  }

  if (ins.op === "quat.identity") {
    requireResult(ins);
    if (ins.resultType !== "quat") fail("quat.identity produces quat", ins.loc);
    expectArgCount(ins, 0);
    return;
  }

  if (ins.op === "quat.from_axis_angle") {
    requireResult(ins);
    if (ins.resultType !== "quat") fail("quat.from_axis_angle produces quat", ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "vec3", ins.loc);
    expectType(values, ins.args[1], "f32", ins.loc);
    return;
  }

  if (ins.op === "quat.mul") {
    requireResult(ins);
    if (ins.resultType !== "quat") fail("quat.mul produces quat", ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "quat", ins.loc);
    expectType(values, ins.args[1], "quat", ins.loc);
    return;
  }

  if (ins.op === "quat.rotate_vec3") {
    requireResult(ins);
    if (ins.resultType !== "vec3") fail("quat.rotate_vec3 produces vec3", ins.loc);
    expectArgCount(ins, 2);
    expectType(values, ins.args[0], "quat", ins.loc);
    expectType(values, ins.args[1], "vec3", ins.loc);
    return;
  }

  if (ins.op === "ray.plane_y") {
    requireResult(ins);
    if (ins.resultType !== "f32") fail("ray.plane_y produces f32", ins.loc);
    expectArgCount(ins, 3);
    expectType(values, ins.args[0], "vec3", ins.loc);
    expectType(values, ins.args[1], "vec3", ins.loc);
    expectType(values, ins.args[2], "f32", ins.loc);
    return;
  }

  if (ins.op === "collision.sphere_sphere") {
    requireResult(ins);
    if (ins.resultType !== "bool") fail("collision.sphere_sphere produces bool", ins.loc);
    expectArgCount(ins, 4);
    expectType(values, ins.args[0], "vec3", ins.loc);
    expectType(values, ins.args[1], "f32", ins.loc);
    expectType(values, ins.args[2], "vec3", ins.loc);
    expectType(values, ins.args[3], "f32", ins.loc);
    return;
  }

  if (ins.op === "struct.new") {
    requireResult(ins);
    const struct = expectStruct(types, ins.resultType, ins.loc);
    const fields = Array.from(struct.fields.values());
    if (ins.args.length !== fields.length) fail(`struct.new ${ins.resultType} expects ${fields.length} args, got ${ins.args.length}`, ins.loc);
    fields.forEach((field, idx) => expectType(values, ins.args[idx], field.type, ins.loc));
    return;
  }

  const structGet = ins.op.match(/^struct\.get\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (structGet) {
    requireResult(ins);
    expectArgCount(ins, 1);
    const owner = inferType(values, ins.args[0], ins.loc);
    const struct = expectStruct(types, owner.type, ins.loc);
    const field = struct.fields.get(structGet[1]);
    if (!field) fail(`struct ${owner.type} has no field '${structGet[1]}'`, ins.loc);
    if (ins.resultType !== field.type) fail(`${ins.op} produces ${field.type}, assigned to ${ins.resultType}`, ins.loc);
    return;
  }

  const structSet = ins.op.match(/^struct\.set\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (structSet) {
    requireResult(ins);
    expectArgCount(ins, 2);
    const owner = inferType(values, ins.args[0], ins.loc);
    const struct = expectStruct(types, owner.type, ins.loc);
    const field = struct.fields.get(structSet[1]);
    if (!field) fail(`struct ${owner.type} has no field '${structSet[1]}'`, ins.loc);
    if (ins.resultType !== owner.type) fail(`${ins.op} produces ${owner.type}, assigned to ${ins.resultType}`, ins.loc);
    expectType(values, ins.args[1], field.type, ins.loc);
    return;
  }

  if (ins.op === "array.new") {
    requireResult(ins);
    const array = expectArray(ins.resultType, ins.loc);
    if (ins.args.length !== array.length) fail(`array.new ${ins.resultType} expects ${array.length} args, got ${ins.args.length}`, ins.loc);
    for (const arg of ins.args) expectType(values, arg, array.element, ins.loc);
    return;
  }

  if (ins.op === "array.get") {
    requireResult(ins);
    expectArgCount(ins, 2);
    const owner = inferType(values, ins.args[0], ins.loc);
    const array = expectArray(owner.type, ins.loc);
    if (ins.resultType !== array.element) fail(`array.get produces ${array.element}, assigned to ${ins.resultType}`, ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectStaticIndex(array, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (ins.op === "array.set") {
    requireResult(ins);
    expectArgCount(ins, 3);
    const owner = inferType(values, ins.args[0], ins.loc);
    const array = expectArray(owner.type, ins.loc);
    if (ins.resultType !== owner.type) fail(`array.set produces ${owner.type}, assigned to ${ins.resultType}`, ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], array.element, ins.loc);
    expectStaticIndex(array, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (isTableGetOp(ins.op)) {
    requireResult(ins);
    expectArgCount(ins, 2);
    const tableArg = ins.args[0];
    if (!tableArg || tableArg.kind !== "symbol") fail(`${ins.op} expects a table name as first argument`, ins.loc);
    const table = tables.get(tableArg.name);
    if (!table) fail(`unknown table '${tableArg.name}'`, ins.loc);
    if (isCompactTableType(table.type)) {
      if (ins.op !== `table.get.${table.type}`) {
        fail(`table '${tableArg.name}' storage type ${table.type} must be read with table.get.${table.type}`, ins.loc);
      }
      if (ins.resultType !== "i32") fail(`${ins.op} ${tableArg.name} produces i32, assigned to ${ins.resultType}`, ins.loc);
    } else {
      if (ins.op !== "table.get") fail(`${ins.op} requires compact table storage, but '${tableArg.name}' is ${table.type}`, ins.loc);
      if (ins.resultType !== table.type) fail(`table.get ${tableArg.name} produces ${table.type}, assigned to ${ins.resultType}`, ins.loc);
    }
    expectType(values, ins.args[1], "i32", ins.loc);
    expectStaticIndex(table, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (isTableGroupGetOp(ins.op)) {
    requireResult(ins);
    expectArgCount(ins, 2);
    const fieldArg = ins.args[0];
    if (!fieldArg || fieldArg.kind !== "tablegroupField") fail(`${ins.op} expects a tablegroup field as first argument`, ins.loc);
    const table = tables.get(tablegroupBackingTableName(fieldArg.group, fieldArg.field));
    if (!table || table.tablegroup !== fieldArg.group || table.tablegroupField !== fieldArg.field) {
      fail(`unknown tablegroup field '${fieldArg.name}'`, ins.loc);
    }
    const expectedOp = `tablegroup.get.${table.type}`;
    if (ins.op !== expectedOp) fail(`tablegroup field '${fieldArg.name}' type ${table.type} must be read with ${expectedOp}`, ins.loc);
    if (ins.resultType !== table.type) fail(`${ins.op} @${fieldArg.name} produces ${table.type}, assigned to ${ins.resultType}`, ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectStaticTablegroupIndex(fieldArg, table, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (ins.op === "table.set") {
    fail("static tables are read-only; table.set is not supported", ins.loc);
  }

  if (/^tablegroup\.(?:set|mut|mutable|push|append|store)/.test(ins.op)) {
    fail(`${ins.op} is forbidden: readonly tablegroups cannot mutate, expose pointers, or use object/JSON semantics`, ins.loc);
  }

  if (/^tablegroup\.(?:addr|ptr|pointer|ref|reference|slice|object|json|method)/.test(ins.op)) {
    fail(`${ins.op} is forbidden: readonly tablegroups cannot expose pointers or use object/JSON semantics`, ins.loc);
  }

  if (ins.op === "state.len") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("state.len produces i32", ins.loc);
    expectArgCount(ins, 1);
    expectState(states, ins.args[0], ins.loc);
    return;
  }

  if (ins.op === "state.get") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("state.get produces i32", ins.loc);
    expectArgCount(ins, 2);
    const state = expectState(states, ins.args[0], ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectStaticStateIndex(state, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (ins.op === "state.set") {
    if (ins.result) fail("state.set does not produce a result", ins.loc);
    expectArgCount(ins, 3);
    const state = expectState(states, ins.args[0], ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], state.type, ins.loc);
    expectStaticStateIndex(state, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (ins.op === "pool.capacity") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("pool.capacity produces i32", ins.loc);
    expectArgCount(ins, 1);
    expectPool(pools, ins.args[0], ins.loc);
    return;
  }

  if (ins.op === "pool.get.i32" || ins.op === "pool.get.bool") {
    requireResult(ins);
    expectArgCount(ins, 2);
    const field = expectPoolField(pools, ins.args[0], ins.loc);
    const expectedOp = `pool.get.${field.type}`;
    if (ins.op !== expectedOp) fail(`air.pool.field_type_invalid: pool field '${ins.args[0].name}' type ${field.type} must be read with ${expectedOp}`, ins.loc);
    if (ins.resultType !== field.type) fail(`${ins.op} @${ins.args[0].name} produces ${field.type}, assigned to ${ins.resultType}`, ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectStaticPoolIndex(field, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (ins.op === "pool.set.i32" || ins.op === "pool.set.bool") {
    if (ins.result) fail("pool.set does not produce a result", ins.loc);
    expectArgCount(ins, 3);
    const field = expectPoolField(pools, ins.args[0], ins.loc);
    const expectedOp = `pool.set.${field.type}`;
    if (ins.op !== expectedOp) fail(`air.pool.field_type_invalid: pool field '${ins.args[0].name}' type ${field.type} must be written with ${expectedOp}`, ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], field.type, ins.loc);
    expectStaticPoolIndex(field, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (/^pool\.(?:ptr|pointer|ref|reference|slice|addr|address|export)/.test(ins.op)) {
    fail(`air.pool.pointer_escape: ${ins.op} is forbidden: pool pointers, slices, references, and exports must not escape`, ins.loc);
  }

  if (/^pool\.(?:object|json|map|dict|dictionary|method|gc|heap)/.test(ins.op)) {
    fail(`air.pool.object_model_rejected: ${ins.op} is forbidden: pools cannot use runtime JSON, objects, maps, GC, or methods`, ins.loc);
  }

  if (ins.op.startsWith("pool.")) {
    fail(`air.pool.invalid: unsupported pool operation '${ins.op}'`, ins.loc);
  }

  if (/^state\.(?:ptr|pointer|ref|reference|slice|export|addr|address)/.test(ins.op)) {
    fail(`${ins.op} is forbidden: state pointers, slices, references, and exports must not escape`, ins.loc);
  }

  if (ins.op === "buffer.from_ptr") {
    requireResult(ins);
    expectBuffer(ins.resultType, ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "ptr", ins.loc);
    return;
  }

  if (ins.op === "buffer.load") {
    requireResult(ins);
    expectArgCount(ins, 2);
    const owner = inferType(values, ins.args[0], ins.loc);
    const buffer = expectBuffer(owner.type, ins.loc);
    if (ins.resultType !== buffer.element) fail(`buffer.load produces ${buffer.element}, assigned to ${ins.resultType}`, ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    const index = constValueOf(values, ins.args[1]);
    expectStaticIndex(buffer, index, ins.loc);
    if (index !== undefined) expectInitializedBufferIndex(bufferInit, owner.name, index, ins.loc);
    return;
  }

  if (ins.op === "buffer.store") {
    expectArgCount(ins, 3);
    const owner = inferType(values, ins.args[0], ins.loc);
    const buffer = expectBuffer(owner.type, ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], buffer.element, ins.loc);
    expectStaticIndex(buffer, constValueOf(values, ins.args[1]), ins.loc);
    return;
  }

  if (ins.op === "global.get") {
    requireResult(ins);
    expectArgCount(ins, 1);
    const global = expectGlobal(globals, ins.args[0], ins.loc);
    if (ins.resultType !== global.type) fail(`global.get ${global.name} produces ${global.type}, assigned to ${ins.resultType}`, ins.loc);
    return;
  }

  if (ins.op === "slice.from_region") {
    requireResult(ins);
    if (ins.resultType !== "slice") fail("slice.from_region produces slice", ins.loc);
    expectArgCount(ins, 2);
    expectLivePtr(values, regions, ins.args[0], ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    return;
  }

  if (ins.op === "slice.len") {
    requireResult(ins);
    if (ins.resultType !== "i32") fail("slice.len produces i32", ins.loc);
    expectArgCount(ins, 1);
    expectSliceLike(values, ins.args[0], ins.loc);
    return;
  }

  if (ins.op === "slice.sub") {
    requireResult(ins);
    expectArgCount(ins, 3);
    const source = expectSliceLike(values, ins.args[0], ins.loc);
    if (source.type === BORROWED_SLICE_TYPE) {
      validateBorrowedSubslice(ins, source.borrow, values);
    } else if (ins.resultType !== "slice") {
      fail("slice.sub from a legacy slice produces slice", ins.loc);
    }
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], "i32", ins.loc);
    expectStaticSliceBounds(values, ins.args[0], constValueOf(values, ins.args[1]), constValueOf(values, ins.args[2]), ins.loc);
    return;
  }

  if (ins.op === "slice.grow") {
    expectArgCount(ins, 2);
    if (borrowedValue(values, ins.args[0])) {
      fail("air.borrow.free_forbidden: host-owned borrowed memory cannot be grown by AIR", ins.loc);
    }
    fail("slice.grow is unsupported for legacy slices", ins.loc);
  }

  if (ins.op === "slice.load.i32" || ins.op === "slice.load.f32") {
    const loadType = ins.op.slice("slice.load.".length);
    requireResult(ins);
    if (ins.resultType !== loadType) fail(`${ins.op} produces ${loadType}`, ins.loc);
    expectArgCount(ins, 2);
    const source = expectSliceLike(values, ins.args[0], ins.loc);
    validateBorrowedAccess(source.borrow, "read", scalarByteWidth(loadType), ins, values);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectStaticSliceBounds(values, ins.args[0], constValueOf(values, ins.args[1]), scalarByteWidth(loadType), ins.loc);
    return;
  }

  if (ins.op === "slice.store.i32" || ins.op === "slice.store.f32") {
    const storeType = ins.op.slice("slice.store.".length);
    expectArgCount(ins, 3);
    const source = expectSliceLike(values, ins.args[0], ins.loc);
    validateBorrowedAccess(source.borrow, "write", scalarByteWidth(storeType), ins, values);
    expectType(values, ins.args[1], "i32", ins.loc);
    expectType(values, ins.args[2], storeType, ins.loc);
    expectStaticSliceBounds(values, ins.args[0], constValueOf(values, ins.args[1]), scalarByteWidth(storeType), ins.loc);
    return;
  }

  if (ins.op === "global.set") {
    expectArgCount(ins, 2);
    const global = expectGlobal(globals, ins.args[0], ins.loc);
    if (borrowedValue(values, ins.args[1])) {
      fail(`air.borrow.escape_storage: borrowed slice cannot be stored in global '${global.name}'`, ins.loc);
    }
    expectType(values, ins.args[1], global.type, ins.loc);
    return;
  }

  if (ins.op === "alloc_region") {
    requireResult(ins);
    if (ins.resultType !== "ptr") fail("alloc_region produces ptr", ins.loc);
    expectArgCount(ins, 1);
    expectType(values, ins.args[0], "i32", ins.loc);
    const classification = classifyRegionSize(rangeOf(values, ins.args[0]));
    if (classification.status === "invalid") {
      fail(`${REGION_BOUNDS_STATIC_CODE}: alloc_region ${classification.detail}`, ins.loc);
    }
    ins.regionSizeCheck = classification.status;
    return;
  }

  if (ins.op === "free_region") {
    expectArgCount(ins, 1);
    if (borrowedValue(values, ins.args[0])) {
      fail("air.borrow.free_forbidden: host-owned borrowed memory cannot be freed by AIR", ins.loc);
    }
    const ptr = expectType(values, ins.args[0], "ptr", ins.loc);
    const region = regions.get(ptr);
    if (!region) fail(`cannot free non-live region ${ptr}`, ins.loc);
    return;
  }

  if (ins.op === "load.i32" || ins.op === "load.f32") {
    const loadType = ins.op.slice("load.".length);
    requireResult(ins);
    if (ins.resultType !== loadType) fail(`${ins.op} produces ${loadType}`, ins.loc);
    if (![1, 2].includes(ins.args.length)) fail(`${ins.op} expects 1 or 2 args, got ${ins.args.length}`, ins.loc);
    const region = expectLivePtr(values, regions, ins.args[0], ins.loc);
    if (ins.args[1]) expectType(values, ins.args[1], "i32", ins.loc);
    const offsetRange = ins.args[1] ? rangeOf(values, ins.args[1]) : { min: 0, max: 0 };
    ins.regionBoundsCheck = expectRegionBounds(region, offsetRange, scalarByteWidth(loadType), ins.loc);
    return;
  }

  if (ins.op === "store.i32" || ins.op === "store.f32") {
    const storeType = ins.op.slice("store.".length);
    if (![2, 3].includes(ins.args.length)) fail(`${ins.op} expects 2 or 3 args, got ${ins.args.length}`, ins.loc);
    const region = expectLivePtr(values, regions, ins.args[0], ins.loc);
    if (ins.args.length === 2) {
      expectType(values, ins.args[1], storeType, ins.loc);
      ins.regionBoundsCheck = expectRegionBounds(region, { min: 0, max: 0 }, scalarByteWidth(storeType), ins.loc);
    } else {
      expectType(values, ins.args[1], "i32", ins.loc);
      expectType(values, ins.args[2], storeType, ins.loc);
      ins.regionBoundsCheck = expectRegionBounds(region, rangeOf(values, ins.args[1]), scalarByteWidth(storeType), ins.loc);
    }
    return;
  }

  fail(`unknown instruction '${ins.op}'${suggestInstruction(ins.op)}`, ins.loc);
}

function requireUse(mod, name, ins) {
  if (!(mod.uses || []).some((use) => use.name === name)) {
    fail(`${ins.op} requires 'use ${name}'`, ins.loc);
  }
}

function expectGlobal(globals, arg, loc) {
  if (!arg || arg.kind !== "symbol") fail("expected global name", loc);
  const global = globals.get(arg.name);
  if (!global) fail(`unknown global '${arg.name}'`, loc);
  return global;
}

function expectState(states, arg, loc) {
  if (!arg || arg.kind !== "symbol") fail("expected state segment name", loc);
  const state = states.get(arg.name);
  if (!state) fail(`unknown state '${arg.name}'`, loc);
  return state;
}

function expectPool(pools, arg, loc) {
  if (!arg || arg.kind !== "poolName") fail("air.pool.invalid: expected pool name", loc);
  const pool = pools.get(arg.name);
  if (!pool) fail(`air.pool.unknown_pool: unknown pool '${arg.name}'`, loc);
  return pool;
}

function expectPoolField(pools, arg, loc) {
  if (!arg || arg.kind !== "poolField") fail("air.pool.invalid: expected pool field", loc);
  const pool = pools.get(arg.pool);
  if (!pool) fail(`air.pool.unknown_pool: unknown pool '${arg.pool}'`, loc);
  const field = pool.fields.get(arg.field);
  if (!field) fail(`air.pool.unknown_field: unknown pool field '${arg.name}'`, loc);
  return { ...field, pool: pool.name, capacity: pool.capacity, fullName: arg.name };
}

function expectLivePtr(values, regions, arg, loc) {
  const ptr = expectType(values, arg, "ptr", loc);
  const region = regions.get(ptr);
  if (!region || !region.live) fail(`pointer ${ptr} is not a live region`, loc);
  return region;
}

function expectRegionBounds(region, offsetRange, width, loc) {
  const classification = classifyRegionAccess(region.sizeRange, offsetRange, width);
  if (classification.status === "invalid") {
    fail(`${REGION_BOUNDS_STATIC_CODE}: raw memory access out of region bounds: ${classification.detail}`, loc);
  }
  return classification.status;
}

function expectStaticSliceBounds(values, sliceArg, offset, width, loc) {
  if (offset === undefined || width === undefined) return;
  const found = sliceArg.kind === "value" ? values.get(sliceArg.name) : null;
  const len = found && found.slice ? found.slice.length : undefined;
  if (len === undefined) return;
  if (offset < 0 || width < 0 || offset + width > len) {
    fail(`static slice access out of bounds: offset ${offset}, width ${width}, slice length ${len}`, loc);
  }
}

function expectStruct(types, type, loc) {
  const struct = types.structs.get(type);
  if (!struct) fail(`unknown struct '${type}'`, loc);
  return struct;
}

function expectArray(type, loc) {
  const array = parseArrayType(type);
  if (!array) fail(`expected array type, got ${type}`, loc);
  return array;
}

function expectBuffer(type, loc) {
  const buffer = parseBufferType(type);
  if (!buffer) fail(`expected buffer type, got ${type}`, loc);
  if (!scalarByteWidth(buffer.element)) fail(`buffer element '${buffer.element}' is not supported`, loc);
  return buffer;
}

function expectStaticIndex(arrayLike, index, loc) {
  if (index === undefined) return;
  if (index < 0 || index >= arrayLike.length) fail(`static index ${index} out of bounds for length ${arrayLike.length}`, loc);
}

function expectStaticStateIndex(state, index, loc) {
  if (index === undefined) return;
  if (index < 0 || index >= state.length) fail(`state '${state.name}' static index ${index} out of bounds for length ${state.length}`, loc);
}

function expectStaticPoolIndex(field, index, loc) {
  if (index === undefined) return;
  if (!Number.isInteger(index)) fail(`air.pool.index_out_of_bounds: pool '${field.pool}' field '${field.name}' static index must be an integer`, loc);
  if (index < 0 || index >= field.capacity) {
    fail(`air.pool.index_out_of_bounds: pool '${field.pool}' field '${field.name}' static index ${index} out of bounds for capacity ${field.capacity}`, loc);
  }
}

function expectInitializedBufferIndex(bufferInit, bufferName, index, loc) {
  const initialized = bufferInit.get(bufferName);
  if (!initialized || !initialized.has(index)) {
    fail(`buffer.load reads uninitialized ${bufferName}[${index}]; write the element with buffer.store before reading it`, loc);
  }
}

function expectInitializedBufferRange(bufferInit, bufferName, count, loc) {
  const initialized = bufferInit.get(bufferName);
  for (let idx = 0; idx < count; idx += 1) {
    if (!initialized || !initialized.has(idx)) {
      fail(`loop.buffer.f32 reads uninitialized ${bufferName}[${idx}]; initialize every element in the static loop range before loop.buffer.f32`, loc);
    }
  }
}

function ensureKnownType(type, types, loc) {
  if (PRIMITIVES.has(type)) return;
  const array = parseArrayType(type);
  if (array) {
    ensureKnownType(array.element, types, loc);
    return;
  }
  const buffer = parseBufferType(type);
  if (buffer) {
    if (!scalarByteWidth(buffer.element)) fail(`buffer element '${buffer.element}' is not supported`, loc);
    return;
  }
  if (isStructName(type) && types.structs.has(type)) return;
  fail(`unknown type '${type}'`, loc);
}

function rejectBorrowedStorage(type, label, loc) {
  if (type === BORROWED_SLICE_TYPE || parseBorrowedSliceType(type)) {
    fail(`air.borrow.escape_storage: ${label} cannot store an invocation-scoped borrowed slice`, loc);
  }
}

function rejectBorrowedExternSignature(fn) {
  const param = (fn.params || []).find((item) => item.type === BORROWED_SLICE_TYPE || item.borrow);
  if (param) {
    fail(
      `air.borrow.extern_opaque: extern '${fn.name}' parameter '${param.name}' cannot accept an invocation-scoped borrowed slice`,
      param.loc || fn.loc
    );
  }
  if (fn.returnType === BORROWED_SLICE_TYPE || fn.returnBorrow) {
    fail(`air.borrow.extern_opaque: extern '${fn.name}' cannot return an invocation-scoped borrowed slice`, fn.loc);
  }
}

function rejectBorrowedReturn(fn) {
  if (fn.returnType === BORROWED_SLICE_TYPE || fn.returnBorrow) {
    fail(`air.borrow.escape_return: function '${fn.name}' cannot return an invocation-scoped borrowed slice`, fn.loc);
  }
}

function validateSignatureTypes(fn, types) {
  for (const param of fn.params || []) ensureKnownType(param.type, types, fn.loc);
  ensureKnownType(fn.returnType, types, fn.loc);
}

function assertWasmTargetSupport(mod, options = {}) {
  const requiredAirAbi = requiredAirAbiForModule(mod);
  if (
    requiredAirAbi &&
    (mod.functions || []).some((fn) => fn.exported && fn.name === "__air_abi_feature_borrowed_slice_v1")
  ) {
    fail(
      `air.abi.borrowed_slice_interface_mismatch: module '${mod.name}' reserves export '__air_abi_feature_borrowed_slice_v1' for the AIR ABI feature marker`,
      mod.loc
    );
  }
  if (requiredAirAbi && options.airAbi && options.airAbi !== requiredAirAbi) {
    fail(
      `air.abi.borrowed_slice_requires_0_11: module '${mod.name}' uses borrowed-slice exports and requires AIR ABI ${requiredAirAbi}, not ${options.airAbi}`,
      mod.loc
    );
  }
  if (!requiredAirAbi && options.airAbi === "0.11") {
    fail(
      `air.abi.borrowed_slice_interface_mismatch: module '${mod.name}' has no borrowed-slice export and cannot be invoked through the borrowed-slice-v1 interface`,
      mod.loc
    );
  }
  for (const fn of mod.functions || []) {
    if (!fn.exported) continue;
    for (const param of fn.params || []) {
      if (param.type === BORROWED_SLICE_TYPE) {
        continue;
      }
      if (param.type !== "slice") continue;
      fail(
        `air.abi.borrowed_slice_lowering_unavailable: exported function '${fn.name}' parameter '${param.name}' uses slice without ABI length metadata; the current Wasm target cannot lower this boundary`,
        param.loc || fn.loc
      );
    }
  }
  return true;
}

function rejectBoundaryComposites(fn, label) {
  for (const param of fn.params || []) {
    if (isCompositeType(param.type)) fail(`${label} param '${param.name}' cannot use ${param.type} at function or host ABI boundary in AIR v0.10; ${boundaryHint(param.type, "param")}`, fn.loc);
  }
  if (isCompositeType(fn.returnType)) fail(`${label} cannot return ${fn.returnType} at function or host ABI boundary in AIR v0.10; ${boundaryHint(fn.returnType, "return")}`, fn.loc);
}

function boundaryHint(type, position) {
  const returnPrefix = position === "return" ? "AIR v0.10 exports return one scalar; write composite output into an explicit ptr/slice/buffer handle or return a scalar status. " : "";
  if (type === "vec2") return `${returnPrefix}use two scalar f32 values (x, y), or fixed-point i32 pair when the ABI must be deterministic`;
  if (type === "vec3") return `${returnPrefix}use three scalar fields instead: x:f32, y:f32, z:f32; for deterministic fixed-point ABIs use x_i32/y_i32/z_i32; for returns, pass an output buffer handle`;
  if (type === "vec4" || type === "quat") return `${returnPrefix}use four scalar f32 fields, or fixed-point i32 fields for deterministic ABIs; for returns, pass an output buffer handle`;
  if (type === "mat4") return `${returnPrefix}pack 16 scalar values into an explicit buffer handle at the ABI boundary`;
  if (parseArrayType(type) || parseBufferType(type) || isStructName(type)) return `${returnPrefix}pack structured data behind ptr/slice/buffer handles at the ABI boundary and keep ${type} internal-only`;
  return "use scalar ABI fields or an explicit buffer handle";
}

function isScalarFoldLoop(op) {
  return op === "loop.fold.i32" || op === "loop.fold.f32" || op === "loop.range.i32" || op === "loop.range.f32";
}

function functionCallsExtern(fn, externName) {
  for (const block of fn.blocks || []) {
    for (const ins of block.instructions || []) {
      if (ins.op === "call" && ins.callee === externName) return true;
    }
  }
  return false;
}

function expectType(values, arg, type, loc) {
  const actual = inferType(values, arg, loc);
  if (actual.type !== type) fail(`expected ${type}, got ${actual.type}`, loc);
  return actual.name;
}

function borrowedValue(values, arg) {
  if (!arg || arg.kind !== "value") return undefined;
  const found = values.get(arg.name);
  return found ? found.borrow : undefined;
}

function expectSliceLike(values, arg, loc) {
  const actual = inferType(values, arg, loc);
  if (actual.type !== "slice" && actual.type !== BORROWED_SLICE_TYPE) {
    fail(`expected slice or borrowed_slice, got ${actual.type}`, loc);
  }
  return actual;
}

function validateBorrowedAccess(borrow, operation, width, ins, values) {
  if (!borrow) return;
  if (!borrowedAccessAllows(borrow.access, operation)) {
    fail(`air.borrow.mode_violation: ${borrow.access} borrowed slice does not permit ${operation} access`, ins.loc);
  }
  if (width > borrow.alignment) {
    fail(
      `air.borrow.alignment_invalid: ${ins.op} requires ${width}-byte alignment, but the borrowed slice declares ${borrow.alignment}`,
      ins.loc
    );
  }
  const offset = constValueOf(values, ins.args[1]);
  if (offset !== undefined && (offset < 0 || offset > I32_MAX - width || offset + width > borrow.length.max)) {
    fail(
      `air.borrow.length_invalid: ${ins.op} offset ${offset} and width ${width} cannot fit maximum ${borrow.length.max}`,
      ins.loc
    );
  }
  if (offset !== undefined && offset % width !== 0) {
    fail(`air.borrow.alignment_invalid: ${ins.op} offset ${offset} is not aligned to ${width} bytes`, ins.loc);
  }
}

function validateBorrowedSubslice(ins, parent, values) {
  if (ins.resultType !== BORROWED_SLICE_TYPE || !ins.borrow) {
    fail(
      "air.borrow.reinterpret_forbidden: slice.sub of a borrowed slice must preserve an explicit borrowed_slice type",
      ins.loc
    );
  }
  if (parent.access !== ins.borrow.access) {
    fail(`air.borrow.mode_violation: slice.sub must preserve ${parent.access} access mode`, ins.loc);
  }
  if (ins.borrow.length.max > parent.length.max) {
    fail(
      `air.borrow.length_invalid: subslice maximum ${ins.borrow.length.max} exceeds parent maximum ${parent.length.max}`,
      ins.loc
    );
  }
  const requested = rangeOf(values, ins.args[2]);
  if (
    requested &&
    (requested.min < ins.borrow.length.min || requested.max > ins.borrow.length.max)
  ) {
    fail(
      `air.borrow.length_invalid: slice.sub requested length ${formatRange(requested)} does not fit declared range ${formatRange(ins.borrow.length)}`,
      ins.loc
    );
  }
  if (ins.borrow.alignment !== parent.alignment) {
    fail(
      `air.borrow.alignment_invalid: slice.sub must preserve declared alignment ${parent.alignment}`,
      ins.loc
    );
  }
  const offset = constValueOf(values, ins.args[1]);
  const requestedLength = constValueOf(values, ins.args[2]);
  if (
    offset !== undefined &&
    requestedLength !== undefined &&
    (
      offset < 0 ||
      requestedLength < 0 ||
      offset > I32_MAX - requestedLength ||
      offset + requestedLength > parent.length.max
    )
  ) {
    fail(
      `air.borrow.length_invalid: slice.sub offset ${offset} and length ${requestedLength} cannot fit parent maximum ${parent.length.max}`,
      ins.loc
    );
  }
  if (offset !== undefined && offset % parent.alignment !== 0) {
    fail(
      `air.borrow.alignment_invalid: slice.sub offset ${offset} does not preserve ${parent.alignment}-byte alignment`,
      ins.loc
    );
  }
}

function inferType(values, arg, loc) {
  if (!arg) fail("missing operand", loc);
  if (arg.kind === "value") {
    const found = values.get(arg.name);
    if (!found) fail(`use of undefined value ${arg.name}`, loc);
    return { type: found.type, name: arg.name, borrow: found.borrow };
  }
  if (arg.kind === "symbol") {
    const found = values.get(arg.name);
    if (found && found.constant) return { type: found.type, name: arg.name };
  }
  if (arg.kind === "number") return { type: Number.isInteger(arg.value) ? "i32" : "f64" };
  if (arg.kind === "bool") return { type: "bool" };
  if (arg.kind === "string") return { type: "slice" };
  fail(`unsupported operand '${arg.raw || arg.name}'`, loc);
}

function constValueForInstruction(ins, values, tables = new Map()) {
  if (ins.op === "const.i32" && ins.args[0] && ins.args[0].kind === "number") return ins.args[0].value;
  if (ins.op === "const.f32" && ins.args[0] && ins.args[0].kind === "number") return ins.args[0].value;
  if (ins.op === "const.bool" && ins.args[0] && ins.args[0].kind === "bool") return ins.args[0].value ? 1 : 0;
  if (ins.op === "i32.add" || ins.op === "i32.sub" || ins.op === "i32.mul") {
    const left = constValueOf(values, ins.args[0]);
    const right = constValueOf(values, ins.args[1]);
    if (left === undefined || right === undefined) return undefined;
    if (ins.op === "i32.add") return (left + right) | 0;
    if (ins.op === "i32.sub") return (left - right) | 0;
    return Math.imul(left, right);
  }
  if (ins.op === "f32.add" || ins.op === "f32.sub" || ins.op === "f32.mul") {
    const left = constValueOf(values, ins.args[0]);
    const right = constValueOf(values, ins.args[1]);
    if (left === undefined || right === undefined) return undefined;
    if (ins.op === "f32.add") return left + right;
    if (ins.op === "f32.sub") return left - right;
    return left * right;
  }
  if (ins.op === "select.i32") {
    const cond = constValueOf(values, ins.args[0]);
    if (cond === true || cond === 1) return constValueOf(values, ins.args[1]);
    if (cond === false || cond === 0) return constValueOf(values, ins.args[2]);
  }
  if (isTableGetOp(ins.op) || isTableGroupGetOp(ins.op)) {
    const tableArg = ins.args[0];
    const table = tableForInstructionArg(tableArg, tables);
    const index = constValueOf(values, ins.args[1]);
    if (!table || index === undefined || index < 0 || index >= table.length) return undefined;
    return table.constValues[index];
  }
  return undefined;
}

function rangeForInstruction(ins, values, tables = new Map()) {
  const constant = constValueForInstruction(ins, values, tables);
  if (constant !== undefined && Number.isFinite(constant)) return { min: constant, max: constant };
  if (isTableGetOp(ins.op) || isTableGroupGetOp(ins.op)) {
    const tableArg = ins.args[0];
    const table = tableForInstructionArg(tableArg, tables);
    if (table && Array.isArray(table.constValues) && table.constValues.length) {
      return {
        min: Math.min(...table.constValues),
        max: Math.max(...table.constValues)
      };
    }
  }
  if (ins.op === "fixed.clamp_i32") {
    const lo = constValueOf(values, ins.args[1]);
    const hi = constValueOf(values, ins.args[2]);
    if (lo !== undefined && hi !== undefined) return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
  }
  if (ins.op === "slice.len") {
    const length = sliceRangeOf(values, ins.args[0]);
    if (length) return { min: length.min, max: length.max };
  }
  if (ins.op === "i32.and") {
    const left = rangeOf(values, ins.args[0]);
    const right = constValueOf(values, ins.args[1]);
    if (right !== undefined && right >= 0) return { min: 0, max: right };
    if (left && left.min >= 0 && left.max >= 0) return { min: 0, max: Math.max(left.max, 0) };
  }
  if (ins.op === "i32.add" || ins.op === "i32.sub" || ins.op === "i32.mul") {
    const left = rangeOf(values, ins.args[0]);
    const right = rangeOf(values, ins.args[1]);
    if (left && right) {
      if (ins.op === "i32.add") return checkedI32Range(left.min + right.min, left.max + right.max);
      if (ins.op === "i32.sub") return checkedI32Range(left.min - right.max, left.max - right.min);
      const products = [
        left.min * right.min,
        left.min * right.max,
        left.max * right.min,
        left.max * right.max
      ];
      return checkedI32Range(Math.min(...products), Math.max(...products));
    }
  }
  return fullRangeForType(ins.resultType);
}

function checkedI32Range(min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < I32_MIN || max > I32_MAX) {
    return { min: I32_MIN, max: I32_MAX };
  }
  return { min, max };
}

function rangeOf(values, arg) {
  if (!arg) return undefined;
  if (arg.kind === "number") return { min: arg.value, max: arg.value };
  if (arg.kind === "bool") return { min: arg.value ? 1 : 0, max: arg.value ? 1 : 0 };
  if (arg.kind === "value") {
    const found = values.get(arg.name);
    return found ? found.range : undefined;
  }
  if (arg.kind === "symbol") {
    const found = values.get(arg.name);
    return found && found.constant ? found.range : undefined;
  }
  return undefined;
}

function sliceRangeOf(values, arg) {
  if (!arg) return undefined;
  if (arg.kind === "string") {
    const length = Buffer.byteLength(arg.value, "utf8");
    return { kind: "slice_length", min: length, max: length };
  }
  if (arg.kind === "value") {
    const found = values.get(arg.name);
    if (!found) return undefined;
    if (found.slice && found.slice.length !== undefined) {
      return { kind: "slice_length", min: found.slice.length, max: found.slice.length };
    }
    return found.sliceRange;
  }
  if (arg.kind === "symbol") {
    const found = values.get(arg.name);
    return found && found.constant ? found.sliceRange : undefined;
  }
  return undefined;
}

function refinementRangeOf(values, arg, kind) {
  if (kind === "i32_range") {
    const range = rangeOf(values, arg);
    return range ? { kind, min: range.min, max: range.max } : undefined;
  }
  if (kind === "slice_length") return sliceRangeOf(values, arg);
  return undefined;
}

function validateAssignedRefinement(ins, numericRange, sliceRange) {
  if (!ins.refinement) return;
  const actual = ins.refinement.kind === "i32_range"
    ? (numericRange ? { kind: "i32_range", min: numericRange.min, max: numericRange.max } : undefined)
    : sliceRange;
  if (!actual || !refinementContains(ins.refinement, actual)) {
    const known = actual ? formatRange(actual) : "unknown";
    const code = ins.refinement.kind === "slice_length"
      ? "air.refinement.slice_length_out_of_range"
      : "air.refinement.assignment_out_of_range";
    fail(
      `${code}: assignment to ${ins.result}:${ins.declaredType || ins.resultType} has known range ${known}, expected ${formatRefinementRange(ins.refinement)}`,
      ins.loc
    );
  }
}

function narrowedRefinementRange(refinement, actual) {
  if (!actual) return undefined;
  if (!refinement || refinement.kind !== "slice_length") return actual;
  return {
    kind: "slice_length",
    min: Math.max(actual.min, refinement.min),
    max: Math.min(actual.max, refinement.max)
  };
}

function formatRefinementRange(refinement) {
  const label = refinement.kind === "slice_length" ? "slice length" : "i32";
  return `${label} ${formatRange(refinement)}`;
}

function rangeForConstant(constant) {
  if (constant.constValue !== undefined && Number.isFinite(constant.constValue)) {
    return { min: constant.constValue, max: constant.constValue };
  }
  return fullRangeForType(constant.type);
}

function initialRangeForParam(fn, param) {
  let range = param.refinement && param.refinement.kind === "i32_range"
    ? { min: param.refinement.min, max: param.refinement.max }
    : fullRangeForType(param.type);
  for (const contract of fn.requires || []) {
    if (contract.kind !== "param" || contract.name !== param.name) continue;
    range = applySimpleContractRange(
      range,
      contract,
      param.type,
      `function '${fn.name}' precondition`,
      contract.loc,
      param.refinement ? "air.refinement.range_invalid" : null
    );
  }
  return range;
}

function rangeForCallPostconditions(ins, functions, baseRange) {
  if (ins.op !== "call") return baseRange;
  const callee = functions.get(ins.callee);
  if (!callee || callee.external) return baseRange;
  let range = callee.returnRefinement && callee.returnRefinement.kind === "i32_range"
    ? { min: callee.returnRefinement.min, max: callee.returnRefinement.max }
    : baseRange;
  for (const contract of callee.ensures || []) {
    if (contract.kind !== "return") continue;
    range = applySimpleContractRange(range, contract, callee.returnType, `function '${callee.name}' postcondition`, contract.loc || ins.loc);
  }
  return range;
}

function applySimpleContractRange(range, contract, type, label, loc, errorCode = null) {
  if (!range) return range;
  if (type !== "i32") return range;
  if (!Number.isInteger(contract.value)) return range;
  const op = contract.op || "<=";
  let next = range;
  if (op === ">=") next = { min: Math.max(range.min, contract.value), max: range.max };
  else if (op === "<=") next = { min: range.min, max: Math.min(range.max, contract.value) };
  else if (op === "==") next = { min: contract.value, max: contract.value };
  else return range;
  if (next.min > next.max) {
    const prefix = errorCode ? `${errorCode}: ` : "";
    fail(`${prefix}${label} ${contract.kind === "param" ? `param ${contract.name} ` : "return "}${op} ${contract.value} is unsatisfiable with known range ${formatRange(range)}`, loc);
  }
  return next;
}

function fullRangeForType(type) {
  if (type === "i32") return { min: -2147483648, max: 2147483647 };
  if (type === "bool") return { min: 0, max: 1 };
  return undefined;
}

function rangeSatisfies(range, op, value) {
  if (op === ">=") return range.min >= value;
  if (op === "<=") return range.max <= value;
  if (op === "==") return range.min === value && range.max === value;
  return false;
}

function formatRange(range) {
  return `[${range.min}, ${range.max}]`;
}

function sliceMetadataForInstruction(ins, values) {
  if (ins.op === "const.str" && ins.args[0] && ins.args[0].kind === "string") {
    return { length: Buffer.byteLength(ins.args[0].value, "utf8") };
  }
  if (ins.op === "slice.from_region") {
    return { base: ins.args[0].kind === "value" ? ins.args[0].name : undefined, length: constValueOf(values, ins.args[1]) };
  }
  if (ins.op === "slice.sub") {
    const parent = ins.args[0].kind === "value" ? values.get(ins.args[0].name) : null;
    return {
      base: parent && parent.slice ? parent.slice.base : undefined,
      length: constValueOf(values, ins.args[2])
    };
  }
  return undefined;
}

function borrowMetadataForInstruction(ins, functions, values) {
  if (ins.borrow) return ins.borrow;
  if (ins.op === "slice.sub") return borrowedValue(values, ins.args[0]);
  if (ins.op === "call") {
    const callee = functions.get(ins.callee);
    return callee && callee.returnBorrow ? callee.returnBorrow : undefined;
  }
  return undefined;
}

function sliceRangeForInstruction(ins, functions, values, metadata) {
  if (metadata && metadata.length !== undefined) {
    return { kind: "slice_length", min: metadata.length, max: metadata.length };
  }
  if (ins.op === "slice.from_region") {
    const length = rangeOf(values, ins.args[1]);
    return length ? {
      kind: "slice_length",
      min: Math.max(0, length.min),
      max: Math.min(SLICE_LEN_MAX, length.max)
    } : undefined;
  }
  if (ins.op === "slice.sub") {
    const length = rangeOf(values, ins.args[2]);
    return length ? {
      kind: "slice_length",
      min: Math.max(0, length.min),
      max: Math.min(SLICE_LEN_MAX, length.max)
    } : undefined;
  }
  if (ins.op === "call") {
    const callee = functions.get(ins.callee);
    if (callee && !callee.external && callee.returnRefinement && callee.returnRefinement.kind === "slice_length") {
      return { ...callee.returnRefinement };
    }
  }
  if (ins.borrow) {
    return {
      kind: "slice_length",
      min: ins.borrow.length.min,
      max: ins.borrow.length.max
    };
  }
  return ins.resultType === "slice"
    ? { kind: "slice_length", min: 0, max: SLICE_LEN_MAX }
    : undefined;
}

function constValueOf(values, arg) {
  if (!arg) return undefined;
  if (arg.kind === "number" || arg.kind === "bool") return arg.kind === "bool" ? (arg.value ? 1 : 0) : arg.value;
  if (arg.kind === "value") {
    const found = values.get(arg.name);
    return found ? found.constValue : undefined;
  }
  if (arg.kind === "symbol") {
    const found = values.get(arg.name);
    return found && found.constant ? found.constValue : undefined;
  }
  return undefined;
}

function expectArgCount(ins, count) {
  if ((ins.args || []).length !== count) {
    fail(`${ins.op} expects ${count} args, got ${(ins.args || []).length}`, ins.loc);
  }
}

function requireResult(ins) {
  if (!ins.result) fail(`${ins.op} requires an assigned result`, ins.loc);
}

function suggestInstruction(op) {
  if (op === "loop.map.i32" || op === "loop.map.f32") {
    return "; use 'loop.array.*' for fixed-array maps, 'loop.buffer.f32' for buffer maps, or 'loop.fold.*' for scalar accumulators";
  }
  if (op === "loop.range.i32" || op === "loop.range.f32") {
    return "; legacy alias: formatter will canonicalize this to 'loop.fold.*'";
  }
  const suggestion = nearest(op, KNOWN_INSTRUCTIONS);
  return suggestion ? `; did you mean '${suggestion}'?` : "";
}

function nearest(input, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= 5 ? best : null;
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length];
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

function tableStorageByteWidth(type) {
  if (type === "u8") return 1;
  if (type === "u16" || type === "i16") return 2;
  return scalarByteWidth(type);
}

function expectStaticTablegroupIndex(fieldArg, table, constant, loc) {
  if (constant === undefined) return;
  if (!Number.isInteger(constant)) fail(`tablegroup '${fieldArg.group}' field '${fieldArg.field}' static index must be an integer`, loc);
  if (constant < 0 || constant >= table.length) {
    fail(`tablegroup '${fieldArg.group}' field '${fieldArg.field}' static index ${constant} out of bounds for length ${table.length}`, loc);
  }
}

function validateTableValueRange(table, value, index) {
  if (table.type === "u8" && (value < 0 || value > 255)) {
    fail(`table '${table.name}' value ${index} literal ${value} out of range for u8 storage`, table.loc);
  }
  if (table.type === "u16" && (value < 0 || value > 65535)) {
    fail(`table '${table.name}' value ${index} literal ${value} out of range for u16 storage`, table.loc);
  }
  if (table.type === "i16" && (value < -32768 || value > 32767)) {
    fail(`table '${table.name}' value ${index} literal ${value} out of range for i16 storage`, table.loc);
  }
}

function fail(message, loc) {
  throw new VerificationError(message, loc);
}

const KNOWN_INSTRUCTIONS = [
  "add",
  "sub",
  "mul",
  "div",
  "clamp",
  "lerp",
  "const.i32",
  "const.i64",
  "const.f32",
  "const.f64",
  "const.bool",
  "const.str",
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
  "bool.and",
  "bool.or",
  "bool.not",
  "f32.add",
  "f32.sub",
  "f32.mul",
  "f32.div",
  "f32.clamp",
  "f32.lerp",
  "fixed.mul_i32",
  "fixed.div_i32",
  "fixed.clamp_i32",
  "fixed.lerp_i32",
  "mat4.from_trs",
  "mat4.store_f32",
  "physics.damp_i32",
  "physics.grounded_i32",
  "physics.snap_y_i32",
  "physics.snap_vy_i32",
  "array.get",
  "array.set",
  "table.get",
  "table.get.u8",
  "table.get.u16",
  "table.get.i16",
  "tablegroup.get.i32",
  "tablegroup.get.bool",
  "state.len",
  "state.get",
  "state.set",
  "pool.capacity",
  "pool.get.i32",
  "pool.get.bool",
  "pool.set.i32",
  "pool.set.bool",
  "buffer.load",
  "buffer.store",
  "loop.range.i32",
  "loop.range.f32",
  "loop.fold.i32",
  "loop.fold.f32",
  "loop.poll",
  "io.poll_bounded",
  "loop.array.i32",
  "loop.buffer.f32",
  "return",
  "br",
  "br_if"
];

module.exports = {
  RESOURCE_CERTIFICATE_KIND,
  RESOURCE_CERTIFICATE_SCHEMA_VERSION,
  VerificationError,
  collectEffectUsage,
  createVerifiedResourceCertificate,
  assertRealtimeSafeProfile,
  resourceVerifierIdentity,
  stableCertificateStringify,
  assertWasmTargetSupport,
  validateVerifiedResourceCertificate,
  verifyModule,
  verifyV051Air,
  checkAbi012Candidate,
  createDecisionEvidence,
  deriveEffectiveAuthority
};
