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
  REGION_BACKING_MAX_BYTES,
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
const { assuranceProfileUnsupported, isTypedV053Ast, semanticDiagnosticCode } = require("./errors");
const parserModule = require("./parser");

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
// Runtime fuel of one structured phi loop entry; lowering traps beyond it.
const STRUCTURED_PHI_LOOP_FUEL_LIMIT = 4096;
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
  // R-PROF-7 for typed-v0.53 ASTs (OD-4 (b)): the legacy verifier never walks one.
  if (isTypedV053Ast(mod)) {
    throw new VerificationError("air.source_profile.ast_mismatch: the AST was parsed as 'typed-v0.53' and cannot be processed as 'legacy-v0.50'");
  }
  const functions = new Map();
  const globals = new Map();
  const types = buildTypeEnv(mod);
  const constants = buildConstantEnv(mod);
  const tables = buildTableEnv(mod, constants);
  const tableGroups = buildTableGroupEnv(mod, tables, constants);
  const states = buildStateEnv(mod, constants, tables, tableGroups);
  const pools = buildPoolEnv(mod, constants, tables, tableGroups, states);
  // QA52 P1-3: the shape scan inside the usage analysis runs before any
  // call-graph walk, and its callee summaries are reused for every function.
  const usageAnalysis = createLegacyUsageAnalysis(mod, functionMapForUsage(mod), constants);
  const effectUsage = collectEffectUsage(mod, constants, usageAnalysis);
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
  for (const fn of mod.functions) verifyFunction(mod, fn, functions, globals, types, constants, tables, states, pools, usageAnalysis);
  assertRegionBackingWithinLimit(mod);
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
  if (isTypedV053Ast(mod)) {
    throw new VerificationError("air.source_profile.ast_mismatch: the AST was parsed as 'typed-v0.53' and cannot be processed as 'typed-v0.51'");
  }
  if (!mod || !mod.v051TypedDecisionCandidate) {
    throw new VerificationError("air.v051.parser_required: v0.51 verification requires parseV051Air");
  }
  if (mod.v051TypedAst) return verifyV051TypedModule(mod);
  verifyModule(mod, options);
  return mod;
}

function verifyV051TypedModule(mod) {
  for (const capability of mod.capabilities || []) {
    if (!KNOWN_CAPABILITIES.has(capability)) {
      throw new VerificationError(`air.capability.unknown: unknown capability '${capability}'`);
    }
  }
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
      if (hasReturn) throw new VerificationError("air.control.statement_after_return: return must be the last statement", statement.loc);
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
  // R-ASSUR-1 floor, first check whatever the other arguments (OPEN-34 (a):
  // the typed realtime profile is DEFERRED_V054).
  if (isTypedV053Ast(mod)) throw assuranceProfileUnsupported("assertRealtimeSafeProfile");
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
  // QA52 P1-1: an absent loop total is unproven, never zero.
  const loopFuelUpperBound = loops.status === "verified" && bounds.effects && bounds.effects.status === "verified"
    ? loops.totalStaticallyBoundedIterations + loops.totalDynamicLoopFuelUpperBound
    : null;
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

function collectEffectUsage(mod, constants = constantValuesForModule(mod), analysis = null) {
  const usage = new Map();
  const active = analysis || createLegacyUsageAnalysis(mod, functionMapForUsage(mod), constants);
  const entries = (mod.functions || []).filter((fn) => fn.exported || fn.name === "main");
  // A cyclic module keeps the former walk: one memo shared by the entries,
  // entries themselves never read from or stored in it.
  const cyclicMemo = active.shape.acyclic ? null : new Map();
  for (const fn of entries.length ? entries : mod.functions || []) {
    const entryUsage = cyclicMemo ? runUsageCollection(fn, active, cyclicMemo) : usageForFunction(fn, active);
    chargeLegacyAnalysis(active.meter, entryUsage.size, fn.loc);
    mergeUsage(usage, entryUsage);
  }
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
  const combinedBounds = combineResourceBounds(moduleRecords);
  const workUnknown = workBoundUnknownReasons(moduleRecords, combinedBounds);
  const bounds = applyWorkBoundUnknown(combinedBounds, workUnknown);
  const normalizedPolicy = normalizeCertificatePolicy(options.policy, options.mode);
  const policy = bounds.borrowedMemory.borrowedParameterCount > 0 && normalizedPolicy.mode === "required"
    ? {
        ...normalizedPolicy,
        requiredBounds: Array.from(new Set(
          normalizedPolicy.requiredBounds.concat("borrowedMemory")
        )).sort()
      }
    : normalizedPolicy;
  const unknown = unknownResourceReasons(bounds).concat(workUnknown);
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
  validateCertificateWorkBounds(certificate, diagnostics);
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

// Totals a consumer may read from a `verified` category (QA52 P1-1).
const CERTIFICATE_TOTAL_FIELDS = Object.freeze({
  loops: Object.freeze([
    "maximumStaticallyBoundedIterations",
    "totalStaticallyBoundedIterations",
    "maximumDynamicLoopFuel",
    "totalDynamicLoopFuelUpperBound"
  ]),
  memory: Object.freeze(["totalStaticBytesUpperBound", "dynamicAllocationBytesUpperBound"]),
  hostCalls: Object.freeze(["totalUpperBound"]),
  outputs: Object.freeze(["totalHostCallUpperBound"]),
  effects: Object.freeze([])
});

// X-SND-02: a `verified` certificate must not carry a work category that is
// not verified, or a bound that is not an exact safe integer. QA52 P1-1: a
// verified category must also carry every total as a non-negative safe
// integer; a missing (null) or negative total is malformed, never zero.
function validateCertificateWorkBounds(certificate, diagnostics) {
  if (certificate.status !== "verified") return;
  const bounds = certificate.bounds && typeof certificate.bounds === "object" ? certificate.bounds : {};
  const required = new Set(Array.isArray(certificate.requiredBounds) ? certificate.requiredBounds : []);
  for (const category of ["loops", "memory", "hostCalls", "effects", "outputs"]) {
    const section = bounds[category];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      if (required.has(category)) {
        diagnostics.push(resourceCertificateDiagnostic(
          "air.resource_certificate.bound_invalid",
          `verified certificate has an invalid '${category}' bound`,
          { category }
        ));
      }
      continue;
    }
    const { declaredBudgets, ...boundValues } = section;
    const unsafe = hasUnsafeNumber(boundValues) || hasNegativeNumber(boundValues);
    const totalMissing = section.status === "verified" &&
      CERTIFICATE_TOTAL_FIELDS[category].some((field) => typeof section[field] !== "number");
    const unverifiedRequired = required.has(category) && section.status !== "verified";
    if (unsafe || totalMissing || unverifiedRequired) {
      diagnostics.push(resourceCertificateDiagnostic(
        "air.resource_certificate.bound_invalid",
        `verified certificate has an invalid '${category}' bound`,
        { category }
      ));
    }
  }
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
  // X-SND-02: totals are exact only inside the safe-integer range; a total
  // outside it is unknown, never a verified bound.
  const overflowKeys = Array.from(usage.entries())
    .filter(([, value]) => typeof value === "number" && !Number.isSafeInteger(value))
    .map(([key]) => key)
    .sort();
  const packageExternalCalls = usage.get("call.package_external") || 0;
  const stdlibExternalCalls = usage.get("call.stdlib_external") || 0;
  const workKnown = overflowKeys.length === 0 && packageExternalCalls === 0 && stdlibExternalCalls === 0;
  const loops = loopCertificateFacts(mod, usage);
  const memory = memoryCertificateFacts(usage);
  const hostCalls = hostCallCertificateFacts(mod, usage);
  const effects = Array.from(usage.entries())
    .filter(([, value]) => Number.isSafeInteger(value) && value !== 0)
    .map(([key, upperBound]) => ({ key, upperBound }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return stableCertificateObject({
    loops: workKnown ? loops : nullUnsafeNumbers({ ...loops, status: "unknown" }),
    memory,
    hostCalls: workKnown ? hostCalls : nullUnsafeNumbers({ ...hostCalls, status: "unknown" }),
    borrowedMemory: borrowedMemoryCertificateFacts(mod),
    effects,
    effectBudgets: effectBudgetFacts(mod),
    workBoundOverflowKeys: overflowKeys,
    packageExternalCalls,
    stdlibExternalCalls
  });
}

function nullUnsafeNumbers(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (Array.isArray(value)) return value.map(nullUnsafeNumbers);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = nullUnsafeNumbers(item);
    return out;
  }
  return value;
}

function hasUnsafeNumber(value) {
  if (typeof value === "number") return !Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.some(hasUnsafeNumber);
  if (value && typeof value === "object") return Object.values(value).some(hasUnsafeNumber);
  return false;
}

function hasNegativeNumber(value) {
  if (typeof value === "number") return value < 0;
  if (Array.isArray(value)) return value.some(hasNegativeNumber);
  if (value && typeof value === "object") return Object.values(value).some(hasNegativeNumber);
  return false;
}

const WORK_BOUND_CATEGORIES = Object.freeze(["loops", "hostCalls", "effects", "outputs"]);

// X-SND-02/X-SND-03: work categories stay unknown when any module total
// overflows, the package-level sum overflows, or a module calls another
// package module (cross-module composition is not proven by this certificate).
function workBoundUnknownReasons(moduleRecords, bounds) {
  const reasons = [];
  const overflowModules = moduleRecords.filter((item) => (item.facts.workBoundOverflowKeys || []).length > 0);
  const packageOverflow = WORK_BOUND_CATEGORIES.some((category) => hasUnsafeNumber(bounds[category]));
  if (overflowModules.length || packageOverflow) {
    for (const category of WORK_BOUND_CATEGORIES) {
      reasons.push({
        code: "work_bound_overflow",
        category,
        reason: "A work or effect total exceeds the exact safe-integer range; no verified upper bound is reported."
      });
    }
  }
  const externalModules = moduleRecords.filter((item) => (item.facts.packageExternalCalls || 0) > 0);
  if (externalModules.length) {
    for (const category of WORK_BOUND_CATEGORIES) {
      reasons.push({
        code: "package_call_composition_unproven",
        category,
        reason: `${externalModules.length} module(s) call functions of another package module; cross-module work and host-call composition is not proven by this certificate.`
      });
    }
  }
  const stdlibModules = moduleRecords.filter((item) => (item.facts.stdlibExternalCalls || 0) > 0);
  if (stdlibModules.length) {
    for (const category of WORK_BOUND_CATEGORIES) {
      reasons.push({
        code: "stdlib_call_composition_unproven",
        category,
        reason: `${stdlibModules.length} module(s) call functions of an unresolved std.* source import; the imported functions' work and host calls are not composed by this certificate.`
      });
    }
  }
  return reasons;
}

function applyWorkBoundUnknown(bounds, reasons) {
  const categories = new Set(reasons.map((item) => item.category));
  if (!categories.size) return bounds;
  const overflowed = new Set(reasons.filter((item) => item.code === "work_bound_overflow").map((item) => item.category));
  const out = { ...bounds };
  for (const category of categories) {
    if (!out[category]) continue;
    out[category] = overflowed.has(category)
      ? nullAllNumbers({ ...out[category], status: "unknown" })
      : nullUnsafeNumbers({ ...out[category], status: "unknown" });
  }
  return stableCertificateObject(out);
}

function nullAllNumbers(value) {
  if (typeof value === "number") return null;
  if (Array.isArray(value)) return value.map(nullAllNumbers);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = nullAllNumbers(item);
    return out;
  }
  return value;
}

function borrowedMemoryCertificateFacts(mod) {
  const functions = functionMapForUsage(mod);
  const constants = buildConstantEnv(mod);
  const usageAnalysis = createLegacyUsageAnalysis(mod, functions, constants);
  const exports = [];
  const parameters = [];
  const relations = [];
  const unsupportedUnprovenReasons = [];

  for (const fn of mod.functions || []) {
    if (!fn.exported) continue;
    const borrowedParams = (fn.params || []).filter((param) => param.type === BORROWED_SLICE_TYPE);
    if (!borrowedParams.length) continue;
    const usage = usageForFunction(fn, usageAnalysis);
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
    if (Array.isArray(fn.blocks) && fn.blocks.length === 4 && detectStructuredPhiLoop(fn)) {
      dynamicLoops += 1;
      maximumDynamicFuel = Math.max(maximumDynamicFuel, STRUCTURED_PHI_LOOP_FUEL_LIMIT);
    }
    const consts = createConstScope(constants);
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
    if (isTypedV053Ast(normalized.mod)) {
      // R-WB-24 / V53-ASSUR-01: the same refusal for typed-v0.53 ASTs.
      throw new VerificationError(`air.resource_certificate.profile_unsupported: module ${index} uses the typed-v0.53 source profile; the legacy resource certificate cannot bound typed modules`);
    }
    if (normalized.mod.v051TypedAst) {
      // X-SND-04: this certificate walks the legacy block IR only.
      throw new VerificationError(`air.resource_certificate.profile_unsupported: module ${index} uses the typed-v0.51 source profile; the legacy resource certificate cannot bound typed modules`);
    }
    const shapeProblem = legacyCertificateShapeProblem(normalized.mod);
    if (shapeProblem) {
      // QA52 P2-5: legacy safety is never inferred from a missing marker.
      throw new VerificationError(`air.resource_certificate.profile_unsupported: module ${index} is not a legacy block-IR module (${shapeProblem}); the legacy resource certificate cannot bound it`);
    }
    return {
      mod: normalized.mod,
      path: normalized.path || normalized.mod.name || `module-${index}`,
      digest: validSha256(normalized.digest) ? normalized.digest : null
    };
  });
}

// QA52 P2-5: the legacy certificate binds to the legacy AST shape itself:
// every function is a list of labelled blocks, and no typed-profile field
// (statement bodies, enums, typed markers) is present. Returns null when the
// module has that shape, otherwise the first reason it does not.
function legacyCertificateShapeProblem(mod) {
  if (mod.v051TypedDecisionCandidate) return "typed-v0.51 candidate marker";
  if (Object.prototype.hasOwnProperty.call(mod, "enums")) return "typed enum declarations";
  if (!Array.isArray(mod.functions)) return "functions are not a list";
  for (const fn of mod.functions) {
    if (!fn || typeof fn !== "object") return "function record is invalid";
    if (Object.prototype.hasOwnProperty.call(fn, "statements")) return `function '${fn.name}' has a statement body`;
    if (!Array.isArray(fn.blocks)) return `function '${fn.name}' has no block list`;
    for (const block of fn.blocks) {
      if (!block || !Array.isArray(block.instructions)) return `function '${fn.name}' has a block without instructions`;
    }
  }
  return null;
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

// X-BND-02 / QA52 P1-3: deterministic structural bound on legacy verifier
// analysis. These are tooling-safety limits only: they are not wall-clock
// based, not a Host Budget and not the typed-v0.53 WorkBound, and they never
// change what a call or loop means. A module inside the limits is analysed
// exactly as before; a module outside them is rejected with
// air.verifier.analysis_limit_exceeded before any recursion or long walk.
const LEGACY_VERIFIER_ANALYSIS_LIMITS = Object.freeze({
  maxFunctions: 4096,
  maxCallEdges: 65536,
  maxCallDepth: 256,
  maxStructuralVisits: 4194304,
  maxSummaryWork: 4194304
});

function analysisLimitExceeded(resource, observed, limit, loc) {
  fail(`air.verifier.analysis_limit_exceeded: legacy verifier ${resource} ${observed} exceeds the maintenance limit ${limit}`, loc);
}

// Local call targets that usage collection descends into: direct calls and
// loop callbacks (every loop.* form except loop.poll).
function localUsageCallee(ins, localFunctions) {
  if (!ins || typeof ins.op !== "string") return null;
  if (ins.op === "call") return localFunctions.has(ins.callee) ? ins.callee : null;
  if (ins.op.startsWith("loop.") && ins.op !== "loop.poll") {
    const arg = ins.args && ins.args[0];
    return arg && arg.kind === "function" && localFunctions.has(arg.name) ? arg.name : null;
  }
  return null;
}

// Checked, iterative shape scan run before any call-graph analysis: function
// count, local call edges, structural visits (instructions, plus the
// per-function constant scope the verifier builds) and the longest local call
// chain. Back edges (local recursion) do not count toward depth; they are
// rejected separately by rejectLocalCallCycles.
function assertLegacyAnalysisShape(mod) {
  const limits = LEGACY_VERIFIER_ANALYSIS_LIMITS;
  const loc = mod && mod.loc;
  const functions = mod && Array.isArray(mod.functions) ? mod.functions : [];
  if (functions.length > limits.maxFunctions) analysisLimitExceeded("function count", functions.length, limits.maxFunctions, loc);
  const constantCount = mod && Array.isArray(mod.constants) ? mod.constants.length : 0;
  const localFunctions = new Map(functions.map((fn) => [fn.name, fn]));
  const edges = new Map();
  let edgeCount = 0;
  let visits = functions.length * constantCount;
  if (visits > limits.maxStructuralVisits) analysisLimitExceeded("structural visits", visits, limits.maxStructuralVisits, loc);
  for (const fn of functions) {
    const targets = edges.get(fn.name) || [];
    for (const block of fn.blocks || []) {
      for (const ins of block.instructions || []) {
        visits += 1;
        if (visits > limits.maxStructuralVisits) analysisLimitExceeded("structural visits", visits, limits.maxStructuralVisits, ins.loc);
        const callee = localUsageCallee(ins, localFunctions);
        if (callee === null) continue;
        edgeCount += 1;
        if (edgeCount > limits.maxCallEdges) analysisLimitExceeded("call edge count", edgeCount, limits.maxCallEdges, ins.loc);
        targets.push(callee);
      }
    }
    edges.set(fn.name, targets);
  }
  const state = new Map();
  const depth = new Map();
  let callDepth = 0;
  let acyclic = true;
  for (const root of localFunctions.keys()) {
    if (state.has(root)) continue;
    const stack = [{ name: root, next: 0 }];
    state.set(root, "active");
    while (stack.length) {
      const top = stack[stack.length - 1];
      const targets = edges.get(top.name) || [];
      if (top.next < targets.length) {
        const callee = targets[top.next];
        top.next += 1;
        const seen = state.get(callee);
        if (seen === "active") acyclic = false;
        if (!seen) {
          state.set(callee, "active");
          stack.push({ name: callee, next: 0 });
        }
        continue;
      }
      let chain = 1;
      for (const callee of targets) {
        if (state.get(callee) === "done") chain = Math.max(chain, depth.get(callee) + 1);
      }
      depth.set(top.name, chain);
      state.set(top.name, "done");
      stack.pop();
      if (chain > callDepth) callDepth = chain;
      if (callDepth > limits.maxCallDepth) {
        analysisLimitExceeded("call depth", callDepth, limits.maxCallDepth, localFunctions.get(top.name).loc);
      }
    }
  }
  return { functions: functions.length, callEdges: edgeCount, callDepth, structuralVisits: visits, acyclic };
}

// One analysis per module walk: the shape scan, a checked work meter and the
// callee summary memo. Summaries are shared across roots only when the local
// call graph is acyclic, where a summary does not depend on the call path; a
// cyclic module keeps the former per-root memo so its result is unchanged.
function createLegacyUsageAnalysis(mod, functions, constants) {
  return {
    functions,
    constants,
    stdlibAliases: stdlibImportAliases(mod),
    shape: assertLegacyAnalysisShape(mod),
    memo: new Map(),
    meter: { units: 0, limit: LEGACY_VERIFIER_ANALYSIS_LIMITS.maxSummaryWork, loc: mod && mod.loc }
  };
}

// Shape and summary-work counters of one effect-usage walk, for evidence and
// boundary vectors. Throws the same analysis_limit_exceeded error as the
// verifier when a limit is crossed.
function legacyVerifierAnalysisProfile(mod) {
  const analysis = createLegacyUsageAnalysis(mod, functionMapForUsage(mod), constantValuesForModule(mod));
  collectEffectUsage(mod, analysis.constants, analysis);
  return { ...analysis.shape, summaryWork: analysis.meter.units };
}

function chargeLegacyAnalysis(meter, units, loc) {
  meter.units += units;
  if (meter.units > meter.limit) analysisLimitExceeded("summary work", meter.units, meter.limit, loc || meter.loc);
}

// Summary of one function. In an acyclic module it is memoised for every
// later root and caller.
function usageForFunction(fn, analysis) {
  if (!analysis.shape.acyclic) return runUsageCollection(fn, analysis, new Map());
  if (analysis.memo.has(fn.name)) {
    chargeLegacyAnalysis(analysis.meter, 1, fn.loc);
    return analysis.memo.get(fn.name);
  }
  const usage = runUsageCollection(fn, analysis, analysis.memo);
  analysis.memo.set(fn.name, usage);
  return usage;
}

// Drives functionUsageSteps with an explicit frame stack. It reproduces the
// former recursive walk exactly: a callee already on the active call path
// contributes the recursion marker, a summarised callee is reused from `memo`,
// and any other callee is summarised once and stored in `memo`. The root's own
// summary is returned and left to the caller to store.
function runUsageCollection(root, analysis, memo) {
  const { functions, constants, meter } = analysis;
  const frames = [];
  const active = new Map();
  const enter = (fn) => {
    if (frames.length >= LEGACY_VERIFIER_ANALYSIS_LIMITS.maxCallDepth) {
      analysisLimitExceeded("call depth", frames.length + 1, LEGACY_VERIFIER_ANALYSIS_LIMITS.maxCallDepth, fn.loc);
    }
    chargeLegacyAnalysis(meter, 1, fn.loc);
    frames.push({ fn, steps: functionUsageSteps(fn, functions, constants, meter, analysis.stdlibAliases) });
    active.set(fn.name, (active.get(fn.name) || 0) + 1);
  };
  enter(root);
  let input;
  for (;;) {
    const frame = frames[frames.length - 1];
    const step = frame.steps.next(input);
    input = undefined;
    if (step.done) {
      frames.pop();
      const remaining = active.get(frame.fn.name) - 1;
      if (remaining) active.set(frame.fn.name, remaining);
      else active.delete(frame.fn.name);
      if (!frames.length) return step.value;
      memo.set(frame.fn.name, step.value);
      input = step.value;
      continue;
    }
    const callee = step.value;
    chargeLegacyAnalysis(meter, 1, callee.loc);
    if (active.has(callee.name)) {
      input = new Map([["effects.dynamic", 1], ["cpu.recursive_calls", 1]]);
    } else if (memo.has(callee.name)) {
      input = memo.get(callee.name);
    } else {
      enter(callee);
    }
  }
}

// Aliases of unresolved `use std.*` source imports (QA52 P2-2).
function stdlibImportAliases(mod) {
  const aliases = new Set();
  for (const use of mod && mod.uses || []) {
    if (!use || use.kind !== "source" || !String(use.name || "").startsWith("std.")) continue;
    aliases.add(use.alias || String(use.name).slice("std.".length));
  }
  return aliases;
}

// Module constants seen through a per-function overlay, so building a
// function's constant scope costs nothing per module constant.
function createConstScope(constants) {
  const local = new Map();
  return {
    get(name) {
      if (local.has(name)) return local.get(name);
      const constant = constants.get(name);
      return constant === undefined ? undefined : constant.constValue;
    },
    set(name, value) {
      local.set(name, value);
    }
  };
}

// One function's usage, written as a generator: every nested callee summary is
// requested with `yield` and supplied by runUsageCollection, so call depth
// never becomes JavaScript recursion (QA52 P1-3). The counting rules are
// unchanged from 0.52.1.
function* functionUsageSteps(fn, functions, constants, meter, stdlibAliases) {
  const usage = new Map();
  let staticAllocBytes = 0;
  let dynamicAllocations = 0;
  // `add` targets the current block; block usage is merged into the function
  // usage scaled by how often that block can execute (structured phi loops).
  let blockUsage = usage;
  const add = (key, amount = 1) => blockUsage.set(key, (blockUsage.get(key) || 0) + amount);
  const consts = createConstScope(constants);
  const valueTypes = new Map((fn.params || []).map((param) => [param.name, param.type]));
  const phiLoop = Array.isArray(fn.blocks) && fn.blocks.length === 4 ? detectStructuredPhiLoop(fn) : null;
  if (phiLoop) {
    // X-SND-01: a structured phi loop runs its body up to the lowering fuel
    // limit per entry and evaluates its header once more; charge it as one
    // dynamic loop with that fuel instead of counting each block once.
    add("cpu.loops");
    add("cpu.dynamic_loops");
    add("cpu.phi_loops");
    add("effects.dynamic");
    add("cpu.loop_iterations_upper_bound", STRUCTURED_PHI_LOOP_FUEL_LIMIT);
  }
  for (const block of fn.blocks || []) {
    const multiplicity = phiLoop ? structuredPhiLoopBlockMultiplicity(phiLoop, block.label) : 1;
    blockUsage = multiplicity === 1 ? usage : new Map();
    add("cpu.blocks");
    for (const ins of block.instructions || []) {
      chargeLegacyAnalysis(meter, 1, ins.loc);
      add("cpu.instructions");
      if (ins.result && ins.op === "const.i32" && ins.args[0] && ins.args[0].kind === "number") {
        consts.set(ins.result, ins.args[0].value);
      }
      if (ins.op === "call") {
        const callee = functions.get(ins.callee);
        if (callee && !callee.external) {
          add(`call.${ins.callee}`);
          const nested = yield callee;
          chargeLegacyAnalysis(meter, nested.size, ins.loc);
          mergeUsage(blockUsage, nested);
        } else {
          add(ins.callee);
          // X-SND-03: the callee lives in another package module, so its own
          // work and host calls are not part of this module's usage. QA52
          // P2-2: an unresolved `use std.*` callee is counted separately so
          // the certificate names the right unproven composition.
          if (!callee || callee.packageExternal) {
            add(stdlibAliases.has(String(ins.callee).split(".")[0]) ? "call.stdlib_external" : "call.package_external");
          }
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
            const nested = yield callee;
            chargeLegacyAnalysis(meter, 2 * nested.size, ins.loc);
            mergeUsage(blockUsage, scaledUsage(nested, count));
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
    if (blockUsage !== usage) {
      chargeLegacyAnalysis(meter, 2 * blockUsage.size, fn.loc);
      mergeUsage(usage, scaledUsage(blockUsage, multiplicity));
    }
  }
  blockUsage = usage;
  usage.set("static_alloc_bytes", staticAllocBytes);
  usage.set("memory.static_alloc_bytes", staticAllocBytes);
  usage.set("dynamic_allocations", dynamicAllocations);
  usage.set("memory.dynamic_allocations", dynamicAllocations);
  return usage;
}

function structuredPhiLoopBlockMultiplicity(loop, label) {
  if (label === loop.header) return STRUCTURED_PHI_LOOP_FUEL_LIMIT + 1;
  if (label === loop.body) return STRUCTURED_PHI_LOOP_FUEL_LIMIT;
  return 1;
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

  // Iterative depth-first search (QA52 P1-3): same visiting order and the
  // same first reported cycle as the former recursive search, without
  // JavaScript recursion.
  for (const fn of mod.functions || []) {
    if (visited.has(fn.name) || visiting.has(fn.name)) continue;
    const frames = [{ name: fn.name, edges: graph.get(fn.name) || [], next: 0 }];
    visiting.add(fn.name);
    stack.push(fn.name);
    while (frames.length) {
      const frame = frames[frames.length - 1];
      if (frame.next >= frame.edges.length) {
        frames.pop();
        stack.pop();
        visiting.delete(frame.name);
        visited.add(frame.name);
        continue;
      }
      const edge = frame.edges[frame.next];
      frame.next += 1;
      if (!localFunctions.has(edge.to)) continue;
      if (visiting.has(edge.to)) {
        const idx = stack.indexOf(edge.to);
        const cycle = stack.slice(idx).concat(edge.to);
        fail(`air.call.recursion_rejected: local function call cycle ${formatCallCycle(cycle)}`, edge.loc || localFunctions.get(frame.name).loc);
      }
      if (visited.has(edge.to)) continue;
      visiting.add(edge.to);
      stack.push(edge.to);
      frames.push({ name: edge.to, edges: graph.get(edge.to) || [], next: 0 });
    }
  }
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
    const actual = checkedEffectCount(usage, budget.key, budget.loc);
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
      const actual = checkedEffectCount(usage, contract.key, contract.loc);
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
      const actual = checkedEffectCount(usage, contract.key, contract.loc);
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
    const actual = checkedEffectCount(usage, budget.key, budget.loc);
    if (!compareMetric(actual, budget.op || "<=", budget.limit)) {
      fail(`function '${fn.name}' effect budget '${budget.key} ${budget.op || "<="} ${budget.limit}' is not satisfied: ${actual}; repair: tighten bounded loops, reduce matching operations, or raise the explicit budget`, budget.loc);
    }
  }
  for (const contract of [...(fn.requires || []), ...(fn.ensures || [])]) {
    if (contract.kind === "metric") {
      const actual = checkedEffectCount(usage, contract.key, contract.loc);
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

// X-SND-02: a budget or metric contract is never satisfied by a total that
// left the exact safe-integer range.
function checkedEffectCount(usage, key, loc) {
  const actual = effectCount(usage, key);
  if (!Number.isSafeInteger(actual)) {
    fail(`air.resource.work_bound_overflow: '${key}' total exceeds the exact safe-integer range; reduce nested bounded loops or call fan-out`, loc);
  }
  return actual;
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

function verifyFunction(mod, fn, functions, globals, types, constants = new Map(), tables = new Map(), states = new Map(), pools = new Map(), usageAnalysis = null) {
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
  verifyFunctionEffectsAndContracts(mod, fn, usageForFunction(fn, usageAnalysis || createLegacyUsageAnalysis(mod, functions, constants)));
  return cfg;
}

function verifyRegionLifetimes(fn) {
  if (!fn.blocks || fn.blocks.length === 0) return;
  const blocks = new Map(fn.blocks.map((block) => [block.label, block]));
  const regionNames = new Set();
  for (const block of fn.blocks) {
    for (const ins of block.instructions || []) {
      if (ins.op === "alloc_region" && ins.result) regionNames.add(ins.result);
    }
  }
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
      applyRegionInstruction(state, ins, block, regionNames);
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

function applyRegionInstruction(state, ins, block, regionNames = new Set()) {
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
  if (ins.op === "call") {
    for (const arg of ins.args || []) {
      const name = valueArgName(arg);
      if (name && regionNames.has(name)) requireRegionLiveForLifetime(state, name, ins.loc);
      // QA52 P2-10: a region-derived slice or buffer view passed across a
      // call edge needs its region alive, like a direct use.
      const base = name ? state.slices.get(name) : null;
      if (base) requireRegionLiveForLifetime(state, base, ins.loc);
    }
  }
  if (ins.op === "buffer.from_ptr" && ins.result) {
    const base = valueArgName(ins.args[0]);
    if (base && state.live.has(base)) state.slices.set(ins.result, base);
    return;
  }
  if (ins.op === "buffer.load" || ins.op === "buffer.store" || ins.op === "loop.buffer.f32") {
    const view = valueArgName(ins.op === "loop.buffer.f32" ? ins.args[1] : ins.args[0]);
    const base = view ? state.slices.get(view) : null;
    if (base) requireRegionLiveForLifetime(state, base, ins.loc);
    return;
  }
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
  if (ins.op === "load.i32" || ins.op === "load.f32" || ins.op === "store.i32" || ins.op === "store.f32" || ins.op === "slice.from_region" || ins.op === "buffer.from_ptr") {
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
    if (callee.external && !callee.packageExternal) {
      ins.hostBufferChecks = verifyHostBufferArguments(callee, values, regions, ins);
    }
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
    const buffer = expectBuffer(ins.resultType, ins.loc);
    expectArgCount(ins, 1);
    // X-SND-06: a buffer view must lie inside a live AIR region.
    const region = expectLivePtr(values, regions, ins.args[0], ins.loc);
    const viewBytes = buffer.length * scalarByteWidth(buffer.element);
    ins.regionBoundsCheck = expectRegionBounds(region, { min: 0, max: 0 }, viewBytes, ins.loc);
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
    const region = expectLivePtr(values, regions, ins.args[0], ins.loc);
    expectType(values, ins.args[1], "i32", ins.loc);
    // X-SND-06: the slice length must not exceed the region size.
    ins.regionLengthCheck = expectRegionLength(region, rangeOf(values, ins.args[1]), "slice.from_region length", ins.loc);
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
    const sizeRange = rangeOf(values, ins.args[0]);
    const classification = classifyRegionSize(sizeRange);
    if (classification.status === "invalid") {
      fail(`${REGION_BOUNDS_STATIC_CODE}: alloc_region ${classification.detail}`, ins.loc);
    }
    ins.regionSizeCheck = classification.status;
    // X-SND-05: each allocation site owns a disjoint slot that covers its
    // largest possible size; a size that is not a compile-time constant is
    // also checked against the slot at runtime.
    const slot = regionSlotBytesForRange(sizeRange);
    if (slot === null) {
      fail(`air.memory.region_size_unsupported: alloc_region upper bound ${sizeRange.max} exceeds ${REGION_SLOT_MAX_BYTES} bytes`, ins.loc);
    }
    ins.regionSlotBytes = slot;
    ins.regionSizeConstant = constValueOf(values, ins.args[0]) !== undefined;
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

const REGION_SLOT_BYTES = 4096;
const REGION_SLOT_MAX_BYTES = 16 * 1024 * 1024;

// QA52 P2-4: every allocation site owns a slot, so the module's physical
// region backing is the checked sum of its slots. It must stay within the
// maintenance ceiling before any WAT or Wasm is generated.
function assertRegionBackingWithinLimit(mod) {
  let total = 0;
  for (const fn of mod.functions || []) {
    for (const block of fn.blocks || []) {
      for (const ins of block.instructions || []) {
        if (ins.op !== "alloc_region" || !Number.isSafeInteger(ins.regionSlotBytes)) continue;
        total += ins.regionSlotBytes;
        if (total > REGION_BACKING_MAX_BYTES) {
          fail(`air.memory.region_backing_unsupported: region slots need ${total} bytes; the maintenance limit is ${REGION_BACKING_MAX_BYTES} bytes`, ins.loc);
        }
      }
    }
  }
}

function regionSlotBytesForRange(sizeRange) {
  if (!sizeRange || sizeRange.min < 0) return REGION_SLOT_BYTES;
  if (sizeRange.max > REGION_SLOT_MAX_BYTES) return null;
  return Math.max(REGION_SLOT_BYTES, Math.ceil(sizeRange.max / 16) * 16);
}

// Classifies `length` bytes starting at region offset 0: static when proven
// within the region size, dynamic when a runtime check is required.
function expectRegionLength(region, lengthRange, label, loc) {
  const sizeRange = region.sizeRange;
  if (lengthRange && lengthRange.max < 0) {
    fail(`${REGION_BOUNDS_STATIC_CODE}: ${label} ${lengthRange.max} is always negative`, loc);
  }
  if (lengthRange && sizeRange && lengthRange.min > sizeRange.max) {
    fail(`${REGION_BOUNDS_STATIC_CODE}: ${label} exceeds the region size`, loc);
  }
  if (lengthRange && sizeRange && lengthRange.min >= 0 && sizeRange.min >= 0 && lengthRange.max <= sizeRange.min) {
    return "static";
  }
  return "dynamic";
}

// X-SND-06: a host import that receives an AIR pointer and a capacity may
// write that many bytes, so the pointer must be a live region and the
// capacity must fit inside it.
function verifyHostBufferArguments(callee, values, regions, ins) {
  const checks = [];
  callee.params.forEach((param, idx) => {
    if (param.type !== "ptr") return;
    const region = expectLivePtr(values, regions, ins.args[idx], ins.loc);
    const capParam = callee.params[idx + 1];
    if (!capParam || capParam.type !== "i32") return;
    const status = expectRegionLength(region, rangeOf(values, ins.args[idx + 1]), `@${ins.callee} capacity argument ${idx + 1}`, ins.loc);
    checks.push({ ptrIndex: idx, capIndex: idx + 1, status });
  });
  return checks;
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

// ---------------------------------------------------------------------------
// typed-v0.53 (SCALAR) verification: typed-v0.51 plus the SCALAR operations
// (RFC §5; D-VAL-12..14). A separate path keyed on the typed-v0.53 tag, so no
// typed-v0.51 result, code or error order changes (R-PROF-4). Every code here
// carries the `code:` delimiter (R-DIAG-1); codes are reused where the meaning
// is identical (OPEN-2 (a)).

// R-SCL-1 (OPEN-5 (a)): unqualified i32 arithmetic has no implicit mode.
const V053_MODE_REQUIRED = Object.freeze({
  add: "i32.checked_add or i32.wrapping_add",
  "i32.add": "i32.checked_add or i32.wrapping_add",
  "i32.div_s": "i32.checked_div_s",
  "i32.mul": "i32.checked_mul or i32.wrapping_mul",
  "i32.rem_s": "i32.checked_rem_s",
  "i32.sub": "i32.checked_sub or i32.wrapping_sub",
  mul: "i32.checked_mul or i32.wrapping_mul",
  sub: "i32.checked_sub or i32.wrapping_sub"
});
const V053_INTEGER_RANGE = Object.freeze({
  32: Object.freeze({ max: 2147483647n, min: -2147483648n }),
  64: Object.freeze({ max: 9223372036854775807n, min: -9223372036854775808n })
});

// P0-09 (P9-R10): the modules of a root's closure are verified dependencies
// first, each once and each in its own declarations, capabilities and
// contracts; the root last. A module's verdict does not depend on whether it
// is the root or an import, so P0-08's per-module checks run on every module.
function verifyV053TypedModule(mod) {
  if (!isTypedV053Ast(mod)) {
    throw new VerificationError("air.source_profile.ast_mismatch: typed-v0.53 verification requires a typed-v0.53 AST");
  }
  const typedClosure = require("./typed_closure");
  const closure = typedClosure.closureOf(mod);
  if (closure) {
    for (const key of closure.order) {
      const member = closure.records.get(key).ast;
      if (member === mod || closure.verified.has(key)) continue;
      verifyV053ClosureModule(member, typedClosure.importsOf(member));
      closure.verified.add(key);
      typedClosure.countOnce(member, "verify");
    }
  }
  verifyV053ClosureModule(mod, closure ? typedClosure.importsOf(mod) : null);
  if (closure) typedClosure.countOnce(mod, "verify");
  return mod;
}

function verifyV053ClosureModule(mod, imports) {
  for (const capability of mod.capabilities || []) {
    if (!KNOWN_CAPABILITIES.has(capability)) {
      throw new VerificationError(`air.capability.unknown: unknown capability '${capability}'`);
    }
  }
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
  // P0-06: structs join the enums' type namespace; tables have their own.
  // P0-07: constants have their own namespace; states share the tables'.
  verifyV053Structs(mod, declarations);
  const { states, tables } = verifyV053ModuleItems(mod, declarations);
  const functions = new Map();
  for (const fn of mod.functions || []) {
    if (!fn || typeof fn.name !== "string" || functions.has(fn.name)) throw new VerificationError("air.v051.function_duplicate: typed function names must be unique", fn && fn.loc);
    functions.set(fn.name, fn);
  }
  verifyV053BorrowedLaneExports(mod);
  for (const fn of mod.functions || []) {
    const ctx = { declarations, fn, functions, imports, moduleName: mod.name, names: new Set(), states, tables };
    const scope = { locals: new Map(), memory: new Map(), regions: new Map(), staticValues: new Map() };
    // P7-R10: a state name in an exported signature is a state handle.
    const handle = fn && fn.exported ? [...(fn.params || []).map((parameter) => parameter && parameter.type), fn.returnType].find((type) => typeof type === "string" && states.has(type.trim())) : undefined;
    if (handle !== undefined) {
      throw new VerificationError(`air.abi.export_type_unsupported: export '${fn.name}' names state '${handle.trim()}' as a type; a state is internal and has no handle at the AIR ABI`, fn.loc);
    }
    const signature = [];
    for (const parameter of fn.params || []) {
      if (!parameter || typeof parameter.name !== "string" || ctx.names.has(parameter.name)) throw new VerificationError(`air.v051.parameter_duplicate: '${fn.name}'`, fn.loc);
      ctx.names.add(parameter.name);
      const type = verifyV053TypedType(parameter.type, declarations, fn.loc);
      signature.push(type);
      scope.locals.set(parameter.name, parameter.type);
      if (type.kind === "memory") scope.memory.set(parameter.name, v053ParameterMemory(type));
    }
    // OPEN-17 (a): `-> void` is admitted (P0-04); its body ends with a bare return.
    ctx.returnType = verifyV053TypedType(fn.returnType, declarations, fn.loc, true);
    // P0-08 (P8-R12): memory types at the export boundary and as results.
    verifyV053MemorySignature(fn, signature, ctx.returnType);
    // P6-R10: an aggregate is internal. Checked once every type of the
    // signature is valid, at the `export func` line.
    const exportedAggregate = fn.exported ? [...signature, ctx.returnType].find(isV053AggregateKind) : undefined;
    if (exportedAggregate) {
      throw new VerificationError(`air.abi.export_type_unsupported: export '${fn.name}' takes or returns ${exportedAggregate.canonical}; structs and arrays are internal and never cross the AIR ABI`, fn.loc);
    }
    let hasReturn = false;
    for (const statement of fn.statements || []) {
      if (hasReturn) throw new VerificationError("air.control.statement_after_return: return must be the last statement", statement && statement.loc);
      if (statement && statement.kind === "return") {
        verifyV053Return(statement, ctx, scope);
        hasReturn = true;
      } else {
        verifyV053Statement(statement, ctx, scope, null);
      }
    }
    if (!hasReturn) throw new VerificationError(`air.v051.return_missing: '${fn.name}'`, fn.loc);
  }
  // P4-R8 (P0-04 slice text §4.2): the call-graph phase and the WorkBound
  // summaries are part of phase S wherever typed-v0.53 is verified, after the
  // verifier's own checks. A recursion or a summary failure is STATIC_REJECT.
  verifyV053WorkBound(mod);
  return mod;
}

function verifyV053WorkBound(mod) {
  const workbound = require("./workbound");
  const analysis = workbound.analyzeVerifiedTypedModule(mod);
  if (analysis.status === "ok") {
    verifyV053WorkAssertion(mod, analysis);
    return;
  }
  const failure = workbound.analysisError(analysis);
  const error = new VerificationError(`${failure.code}: ${failure.detail}`, failure.loc);
  error.disposition = "STATIC_REJECT";
  if (failure.fields.cyclePath) error.cyclePath = failure.fields.cyclePath;
  error.workBound = failure.fields;
  throw error;
}

// P0-05 (slice text P5-R12, P5-R13): an author's `work` assertion, checked in
// phase S right after the WorkBound phase succeeds. For every export in source
// order and every declared key in the dimension order, E(e).key <= bound. It
// reads only the entry summaries of the analysis the WorkBound phase returned;
// it changes no summary and no artifact, and it is never host authority.
function verifyV053WorkAssertion(mod, analysis) {
  const limits = mod.work && Array.isArray(mod.work.limits) ? mod.work.limits : [];
  if (!limits.length || !(analysis.entries instanceof Map)) return;
  for (const fn of mod.functions || []) {
    if (!fn.exported) continue;
    const entry = analysis.entries.get(fn.name);
    if (!entry || !entry.ok) continue;
    for (const limit of limits) {
      const value = entry.value[limit.key];
      if (typeof value === "bigint" && value > BigInt(limit.bound)) {
        const error = new VerificationError(`air.workbound.assertion_exceeded: export '${fn.name}' ${limit.key} ${value} exceeds the declared work bound ${limit.bound}`, mod.work.loc);
        error.disposition = "STATIC_REJECT";
        error.workAssertion = Object.freeze({ bound: limit.bound, export: fn.name, key: limit.key, value: value.toString() });
        throw error;
      }
    }
  }
}

// P0-05 (slice text P5-R2, P5-R2a; OD-P5-1 (b)): containment only at a fold
// boundary. Identity, or for the i32 family the P3-R2 relation: any i32-family
// type is contained in `i32`, and `i32<a..b>` in `i32<c..d>` when c <= a and
// b <= d. Anything else would be a narrowing, which a fold refuses.
function v053TypeContained(source, destination) {
  if (source === destination) return true;
  if (!V053_I32_FAMILY.test(source) || !V053_I32_FAMILY.test(destination)) return false;
  if (destination === "i32") return true;
  const from = parseRefinementType(source);
  const to = parseRefinementType(destination);
  return Boolean(from && to) && BigInt(to.refinement.min) <= BigInt(from.refinement.min) && BigInt(from.refinement.max) <= BigInt(to.refinement.max);
}

// R-LOOP-1 with P5-R2 and P5-R3: `%acc: D = loop.fold @f, <seed>, <count>`. The
// callback is a function of this module with one parameter `T` or two (`T`,
// `i32`) and the result `T`; the seed is contained in `T` and `T` in `D`; a
// dynamic count is an `i32`-family local in scope. A count's bound is not
// checked here: it is a WorkBound result (invalid_bound, unknown_bound) of phase
// S (P5-R3), and a statically known count is never a static rejection (P5-R4).
function verifyV053Fold(value, ctx, scope, loc, destination) {
  const callback = ctx.functions.get(value.callback) || verifyV053ImportedCallee(value.callback, ctx, loc);
  if (!callback) throw new VerificationError(`air.call.unknown_function: '@${value.callback}' is not a function of module '${ctx.moduleName || "this module"}'`, loc);
  const params = callback.params || [];
  if (params.length !== 1 && params.length !== 2) {
    throw new VerificationError(`air.call.argument_count_mismatch: loop.fold passes the accumulator (and the index); '@${callback.name}' takes ${params.length} argument(s)`, loc);
  }
  const accumulator = verifyV053TypedType(params[0].type, ctx.declarations, loc);
  const result = verifyV053TypedType(callback.returnType, ctx.declarations, loc, true);
  if (result.canonical !== accumulator.canonical) {
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: a loop.fold callback takes and returns one type T; '@${callback.name}' takes ${accumulator.canonical} and returns ${result.canonical}`, loc);
  }
  if (params.length === 2 && verifyV053TypedType(params[1].type, ctx.declarations, loc).canonical !== "i32") {
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: the index parameter of '@${callback.name}' must be i32, not ${params[1].type}`, loc);
  }
  const T = accumulator.canonical;
  const seed = typeof value.seed === "string" ? value.seed.trim() : "";
  const seedLocal = /^%[A-Za-z_][A-Za-z0-9_]*$/.test(seed) ? scope.locals.get(seed.slice(1)) : undefined;
  if (seedLocal !== undefined && V053_I32_FAMILY.test(seedLocal)) {
    if (!v053TypeContained(seedLocal, T)) throw new VerificationError(`air.v051.typed_atom_type_mismatch: the seed '${seed}' of type ${seedLocal} is not contained in ${T}; narrow it one statement earlier`, loc);
  } else if (accumulator.refinement) {
    // A literal or a constructor has an unrefined type, contained only in an unrefined T.
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: the seed '${seed}' is not contained in ${T}; bind it to a ${T} local first`, loc);
  } else {
    verifyV053TypedAtom(seed, accumulator, scope.locals, ctx.declarations, loc);
  }
  if (value.count && value.count.kind === "dynamic") {
    const count = scope.locals.get(value.count.local);
    if (count === undefined) throw new VerificationError(`air.v051.local_unknown: '%${value.count.local}'`, loc);
    if (!V053_I32_FAMILY.test(count)) throw new VerificationError(`air.v051.typed_atom_type_mismatch: a loop.fold count is an i32, not ${count}`, loc);
  }
  if (!v053TypeContained(T, destination.canonical)) {
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: loop.fold over '@${callback.name}' yields ${T}, which is not contained in ${destination.canonical}`, loc);
  }
}

// One statement of a body or a block (R-CFG-1). `yieldType` is the type a
// block's yield enters, or null at the top level of a function.
function verifyV053Statement(statement, ctx, scope, yieldType) {
  const loc = statement && statement.loc;
  if (statement && statement.kind === "local") {
    declareV053Local(statement.name, ctx, scope, loc);
    const declared = verifyV053TypedType(statement.type, ctx.declarations, loc);
    let staticValue;
    const memoryValue = Boolean(statement.value) && typeof statement.value === "object" && statement.value.kind === "memory_operation";
    // P0-08 (P8-R1, P8-R12; AD-6): a memory local is bound only by the
    // statement that produces it; a memory-typed copy, call result or fold
    // accumulator is not admitted at P0-08.
    if (declared.kind === "memory" && !memoryValue) {
      throw v053ViewEscape(`'%${statement.name}: ${declared.canonical}' is not bound by a memory statement; a memory-typed copy, call result or fold accumulator is not admitted at P0-08`, loc);
    }
    if (memoryValue) {
      const info = verifyV053MemoryOperation(statement, declared, ctx, scope, loc);
      if (info) scope.memory.set(statement.name, info);
    } else if (statement.value && typeof statement.value === "object" && statement.value.kind === "fold") {
      verifyV053Fold(statement.value, ctx, scope, loc, declared);
    } else if (statement.value && typeof statement.value === "object" && statement.value.kind === "call") {
      verifyV053Call(statement.value, ctx, scope, loc, declared);
    } else if (statement.value && typeof statement.value === "object" && statement.value.kind === "aggregate_operation") {
      verifyV053AggregateOperation(statement.value, declared, ctx, scope, loc);
    } else {
      staticValue = verifyV053TypedExpression(statement.value, declared, scope.locals, ctx.declarations, loc, scope.staticValues);
    }
    scope.locals.set(statement.name, statement.type);
    if (staticValue !== undefined) scope.staticValues.set(statement.name, staticValue);
  } else if (statement && statement.kind === "memory") {
    verifyV053MemoryOperation(statement, null, ctx, scope, loc);
  } else if (statement && statement.kind === "state_set") {
    if (!statement.value || typeof statement.value !== "object" || !String(statement.value.op || "").startsWith("state.")) {
      throw new VerificationError("air.state.op_invalid: a statement without a result binding is state.set <s>, <index>, <value>", loc);
    }
    verifyV053AggregateOperation(statement.value, null, ctx, scope, loc);
  } else if (statement && statement.kind === "call") {
    verifyV053Call(statement.value, ctx, scope, loc, null);
  } else if (statement && statement.kind === "match") {
    declareV053Local(statement.destination, ctx, scope, loc);
    if (verifyV053TypedType(statement.destinationType, ctx.declarations, loc).kind === "memory") {
      throw v053ViewEscape(`the match destination '%${statement.destination}' has a memory type; a memory-typed block result is not admitted at P0-08`, loc);
    }
    const branches = [];
    verifyV053TypedMatch(statement, ctx, scope, branches);
    joinV053Regions(scope.regions, branches);
    scope.locals.set(statement.destination, statement.destinationType);
  } else if (statement && statement.kind === "if") {
    declareV053Local(statement.destination, ctx, scope, loc);
    const destination = verifyV053TypedType(statement.destinationType, ctx.declarations, loc);
    if (destination.kind === "memory") {
      throw v053ViewEscape(`the if destination '%${statement.destination}' has a memory type; a memory-typed block result is not admitted at P0-08`, loc);
    }
    // P4-R9: the condition is a `bool` atom.
    verifyV053TypedAtom(statement.condition, verifyV053TypedType("bool", ctx.declarations, loc), scope.locals, ctx.declarations, loc);
    if (!Array.isArray(statement.blocks) || statement.blocks.length !== 2) {
      throw new VerificationError("air.control.yield_missing: a value if needs a then-block and an else-block", loc);
    }
    const branches = statement.blocks.map((block) => verifyV053Block(block, destination, ctx, scope, null, loc).regions);
    joinV053Regions(scope.regions, branches);
    scope.locals.set(statement.destination, statement.destinationType);
  } else if (statement && statement.kind === "yield") {
    if (!yieldType) throw new VerificationError("air.v051.typed_syntax_invalid: yield outside a block", loc);
    if (typeof statement.value !== "string") throw new VerificationError("air.v051.typed_syntax_invalid: yield operand must be an atom", loc);
    verifyV053TypedExpression(statement.value, yieldType, scope.locals, ctx.declarations, loc, scope.staticValues);
  } else if (statement && statement.kind === "return") {
    throw new VerificationError("air.v051.typed_syntax_invalid: return inside a block; a function has a single exit (R-CFG-2)", loc);
  } else {
    throw new VerificationError("air.v051.typed_statement_invalid: unsupported statement", loc);
  }
}

// A block: its own scope (locals defined inside are not visible after it),
// every statement, and exactly one final yield (R-CFG-1, P4-R10, P4-R15).
function verifyV053Block(block, destination, ctx, outer, binding, loc) {
  const statements = block && Array.isArray(block.statements) ? block.statements : [];
  const last = statements[statements.length - 1];
  if (!last || last.kind !== "yield") throw new VerificationError("air.control.yield_missing: a block must end with yield", loc);
  const scope = {
    locals: new Map(outer.locals),
    memory: new Map(outer.memory || []),
    regions: new Map(outer.regions || []),
    staticValues: new Map(outer.staticValues)
  };
  if (binding) scope.locals.set(binding.name, binding.type);
  statements.forEach((statement, index) => {
    if (statement.kind === "yield" && index !== statements.length - 1) {
      throw new VerificationError("air.v051.typed_syntax_invalid: statement after the block's yield", statements[index + 1].loc);
    }
    verifyV053Statement(statement, ctx, scope, destination);
  });
  return scope;
}

// P4-R11: a local name is unique within its function across all blocks.
function declareV053Local(name, ctx, scope, loc) {
  if (scope.locals.has(name) || ctx.names.has(name)) throw new VerificationError(`air.v051.local_duplicate: '${name}'`, loc);
  ctx.names.add(name);
}

function verifyV053Return(statement, ctx, scope) {
  const loc = statement.loc;
  // P0-08 (P8-R9): no region is live or possibly live at the return.
  verifyV053NoLeak(scope, loc);
  // P4-R12: a return that does not match the declared result type.
  if (ctx.returnType.canonical === "void") {
    if (statement.value !== "" && statement.value !== undefined) throw new VerificationError("air.v051.return_type_mismatch: void return must not contain a value", loc);
    return;
  }
  if (statement.value === "" || statement.value === undefined) throw new VerificationError(`air.v051.return_type_mismatch: function '${ctx.fn.name}' must return a value`, loc);
  if (statement.value && typeof statement.value === "object" && statement.value.kind === "call") {
    throw new VerificationError("air.numeric.operation_invalid: 'call'", loc);
  }
  verifyV053TypedExpression(statement.value, ctx.returnType, scope.locals, ctx.declarations, loc, scope.staticValues);
}

// R-CALL-1, R-CALL-2 (D-VAL-15; P0-04 slice text §4.1): `%r: T = call @f(…)`
// for a callee with a result, `call @f(…)` for a `void` callee. Arguments are
// atoms checked against the parameters (a refined parameter is a refinement
// entry point: proven, or checked at the call site); a bound result has the
// callee's declared result type (P4-R5).
// P0-09 (P9-R11, P9-R12; OD-P9-2 (a)): `@alias.f` names the export `f` of the
// module the alias imports; anything else stays unknown_function. Only types
// the importer can spell cross the boundary, decided before any argument
// check (AD-P9-15 (a)). A `void` result passes no value, so it crosses nothing.
function verifyV053ImportedCallee(name, ctx, loc) {
  const dot = typeof name === "string" ? name.indexOf(".") : -1;
  if (dot < 1 || !ctx.imports) return undefined;
  const imported = ctx.imports.get(name.slice(0, dot));
  if (!imported) return undefined;
  const callee = (imported.ast.functions || []).find((fn) => fn.exported && fn.name === name.slice(dot + 1));
  if (!callee) return undefined;
  const crossing = [...(callee.params || []).map((parameter) => parameter.type), ...(callee.returnType === "void" ? [] : [callee.returnType])];
  const blocked = crossing.find((type) => !v053ImportableType(type));
  if (blocked !== undefined) {
    throw new VerificationError(`air.import.signature_type_unsupported: '@${name}' takes or returns ${blocked}, which cannot cross a module boundary; only i32, i64, f32, f64, bool, refined integers and option<T> of these do`, loc);
  }
  return callee;
}

function v053ImportableType(type) {
  const text = String(type).trim();
  if (/^(i32|i64|f32|f64|bool)$/.test(text) || parseRefinementType(text)) return true;
  const option = /^option<(.+)>$/.exec(text);
  return Boolean(option) && (/^(i32|i64|f32|f64|bool)$/.test(option[1].trim()) || Boolean(parseRefinementType(option[1].trim())));
}

function verifyV053Call(value, ctx, scope, loc, destination) {
  const callee = ctx.functions.get(value.callee) || verifyV053ImportedCallee(value.callee, ctx, loc);
  if (!callee) throw new VerificationError(`air.call.unknown_function: '@${value.callee}' is not a function of module '${ctx.moduleName || "this module"}'`, loc);
  const args = Array.isArray(value.args) ? value.args : [];
  const params = callee.params || [];
  if (args.length !== params.length) {
    throw new VerificationError(`air.call.argument_count_mismatch: '@${callee.name}' takes ${params.length} argument(s), got ${args.length}`, loc);
  }
  args.forEach((argument, index) => {
    if (typeof argument !== "string") throw new VerificationError("air.v051.typed_atom_invalid: expected a typed atom", loc);
    const parameter = verifyV053TypedType(params[index].type, ctx.declarations, loc);
    // P0-08 (P8-R12): a memory value passed to a local call.
    if (parameter.kind === "memory" || (scope.memory && scope.memory.has(argument.trim().slice(1)))) {
      if (parameter.kind !== "memory") throw new VerificationError(`air.v051.typed_atom_type_mismatch: argument ${index} of @${callee.name} is a memory value, not ${parameter.canonical}`, loc);
      verifyV053MemoryArgument(argument, parameter, ctx, scope, loc, callee.name, index);
      return;
    }
    verifyV053TypedExpression(argument, parameter, scope.locals, ctx.declarations, loc, scope.staticValues);
  });
  if (!destination) {
    if (callee.returnType !== "void") {
      throw new VerificationError(`air.call.result_unbound: '@${callee.name}' returns ${callee.returnType}; bind its result (%r: T = call @${callee.name}(...))`, loc);
    }
    return;
  }
  // P4-R4: the result type `void` is not the destination's. P4-R5: an i32-family
  // result enters an i32-family destination by containment or a checked narrowing.
  const result = callee.returnType;
  const widened = V053_I32_FAMILY.test(result) && v051TypeBase(destination) === "i32";
  if (result !== destination.canonical && !widened) {
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: '@${callee.name}' returns ${result}, not ${destination.canonical}`, loc);
  }
}

// P0-03 (slice text §4.1): a declared type is checked by the typed-v0.51 type
// rule after the typed-v0.53 refinement-form rule (R-REF-6, P3-R4, R-TYPE-4).
// P0-06 (slice text P6-R6, P6-R7, P6-R10, P6-R11): a struct or `array<T,N>`
// resolves first; its type carries `lanes` once the struct lanes are known.
function verifyV053TypedType(typeName, declarations, loc, allowVoid = false) {
  return resolveV053Type(typeName, declarations, loc, allowVoid, false);
}

function isV053AggregateKind(type) {
  return Boolean(type) && (type.kind === "struct" || type.kind === "array");
}

function v053LaneCapError(canonical, lanes, loc) {
  return new VerificationError(`air.v051.type_reference_invalid: '${canonical}' has ${lanes} lanes, more than the ${parserModule.typedV053.AGGREGATE_MAX}-lane cap of an aggregate type (OD-P6-6 (a))`, loc);
}

function resolveV053Type(typeName, declarations, loc, allowVoid, element) {
  const text = String(typeName || "").trim();
  const v053 = parserModule.typedV053;
  // P0-08 (P8-R1, P8-R12): a memory type is internal; as a struct field, an
  // array element or an option/result payload it is an escape.
  const memory = v053MemoryKind(text);
  if (memory) {
    if (element) throw v053ViewEscape(`'${text}' is a memory type; a struct field or an array element never holds one`, loc);
    return { canonical: text, kind: "memory", memory };
  }
  if (/^(?:option|result)\s*</.test(text) && V053_NESTED_MEMORY.test(text)) {
    throw v053ViewEscape(`'${text}' carries a memory type as a payload; an option or result never holds one`, loc);
  }
  if (text.startsWith("array<")) {
    const parts = v053.arrayParts(text);
    if (!parts || /\s/.test(text) || !/^[1-9][0-9]*$/.test(parts.count) || BigInt(parts.count) > BigInt(v053.AGGREGATE_MAX)) {
      throw new VerificationError(`air.v051.type_reference_invalid: '${text}' is not admitted; an array type is array<T,N> with no whitespace and 1 <= N <= ${v053.AGGREGATE_MAX}`, loc);
    }
    const item = resolveV053Type(parts.element, declarations, loc, false, true);
    const itemLanes = isV053AggregateKind(item) ? item.lanes : BigInt(v053.baseLanes(item.canonical));
    const lanes = itemLanes === undefined ? undefined : BigInt(parts.count) * itemLanes;
    if (lanes !== undefined && lanes > BigInt(v053.AGGREGATE_MAX)) throw v053LaneCapError(text, lanes, loc);
    return { canonical: text, count: Number(parts.count), element: item, kind: "array", lanes };
  }
  // OD-P6-3 (a): a field or element type is never refined.
  if (element && /^(?:i32|i64|f32|f64)\s*</.test(text)) {
    throw new VerificationError(`air.v051.type_reference_invalid: '${text}' is refined; a struct field or array element type is not refined (OD-P6-3 (a))`, loc);
  }
  const declaration = declarations.get(text);
  if (declaration && declaration.kind === "struct") return { canonical: text, declaration, kind: "struct", lanes: declaration.lanes };
  const sum = /^(?:option|result)\s*<(.+)>$/.exec(text);
  if (sum && (splitV051TypeArguments(sum[1]) || []).some((part) => {
    const item = part.trim();
    return item.startsWith("array<") || (declarations.get(item) || {}).kind === "struct";
  })) {
    throw new VerificationError(`air.decision.payload_type_unsupported: '${text}' has an aggregate payload; an option or result payload is a primitive or an enum`, loc);
  }
  try {
    parserModule.typedV053.rejectRefinementForm(text, null);
  } catch (error) {
    throw new VerificationError(String(error.message), loc);
  }
  return verifyV051TypedType(typeName, declarations, loc, allowVoid);
}

// P0-06 (slice text P6-R6, P6-R11): every struct joins the type namespace
// first, so a name may be used before its declaration; then, in source order,
// its fields; then recursion, at the first struct of a cycle in source order;
// then the lane cap, at the declaring line.
function verifyV053Structs(mod, declarations) {
  const structs = Array.isArray(mod.structs) ? mod.structs : [];
  for (const declaration of structs) {
    if (!declaration || typeof declaration.type_id !== "string" || !Array.isArray(declaration.fields) || !declaration.fields.length) {
      throw new VerificationError("air.v051.typed_syntax_invalid: a struct declares at least one field", declaration && declaration.loc);
    }
    if (declarations.has(declaration.type_id)) throw new VerificationError(`air.decision.enum_duplicate_type: '${declaration.type_id}'`, declaration.loc);
    declarations.set(declaration.type_id, { fields: declaration.fields, kind: "struct", loc: declaration.loc, type_id: declaration.type_id });
  }
  const edges = new Map();
  for (const declaration of structs) {
    const names = new Set();
    const references = [];
    for (const field of declaration.fields) {
      if (!field || typeof field.name !== "string" || !/^[a-z][A-Za-z0-9_]*$/.test(field.name) || names.has(field.name)) {
        throw new VerificationError(`air.v051.typed_syntax_invalid: struct '${declaration.type_id}' has an invalid or repeated field`, declaration.loc);
      }
      names.add(field.name);
      let type = resolveV053Type(field.type, declarations, declaration.loc, false, true);
      while (type.kind === "array") type = type.element;
      if (type.kind === "struct") references.push(type.canonical);
    }
    edges.set(declaration.type_id, references);
  }
  const cyclic = v053CyclicStructs(structs.map((declaration) => declaration.type_id), edges);
  const first = structs.find((declaration) => cyclic.has(declaration.type_id));
  if (first) throw new VerificationError(`air.v051.type_reference_invalid: struct '${first.type_id}' contains itself, directly or through structs and arrays`, first.loc);
  const fieldTypes = parserModule.typedV053.structFieldTypes(mod);
  const memo = new Map();
  for (const declaration of structs) {
    const lanes = parserModule.typedV053.measureType(declaration.type_id, fieldTypes, parserModule.typedV053.baseLanes, memo);
    if (lanes > BigInt(parserModule.typedV053.AGGREGATE_MAX)) throw v053LaneCapError(declaration.type_id, lanes, declaration.loc);
    declarations.get(declaration.type_id).lanes = lanes;
  }
}

// Iterative Tarjan: the struct ids on a cycle (a component of more than one
// struct, or a struct that names itself).
function v053CyclicStructs(ids, edges) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cyclic = new Set();
  let counter = 0;
  const open = (id, work) => {
    index.set(id, counter); low.set(id, counter); counter += 1;
    stack.push(id); onStack.add(id);
    work.push({ id, next: 0 });
  };
  for (const start of ids) {
    if (index.has(start)) continue;
    const work = [];
    open(start, work);
    while (work.length) {
      const frame = work[work.length - 1];
      const targets = edges.get(frame.id) || [];
      if (frame.next < targets.length) {
        const to = targets[frame.next++];
        if (!index.has(to)) open(to, work);
        else if (onStack.has(to)) low.set(frame.id, Math.min(low.get(frame.id), index.get(to)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].id;
        low.set(parent, Math.min(low.get(parent), low.get(frame.id)));
      }
      if (low.get(frame.id) !== index.get(frame.id)) continue;
      const component = [];
      let item;
      do { item = stack.pop(); onStack.delete(item); component.push(item); } while (item !== frame.id);
      if (component.length > 1 || targets.includes(frame.id)) for (const id of component) cyclic.add(id);
    }
  }
  return cyclic;
}

// P0-07 (slice text P7-R3): the module's constants, by name, for the
// declarations map of one verification. A constant is a typed atom whose
// value is its literal.
const V053_MODULE_CONSTANTS = new WeakMap();

function v053ConstantOf(declarations, text) {
  const constants = declarations ? V053_MODULE_CONSTANTS.get(declarations) : undefined;
  return constants && typeof text === "string" ? constants.get(text.trim()) : undefined;
}

// The module's constants, tables and states, in source order. P0-06 (slice
// text P6-R2 items 5 and 6): each table's literals, checked exactly as the
// base checks `%v: T = <literal>`, then a repeated name at the second table's
// line. P0-07 (P7-R2 items 4 and 5): each constant's literal, then a repeated
// constant. P0-07 (P7-R6 items 5 and 6): each state's `fill` literal
// (`air.state.init_invalid`), then a name already taken by a state or a
// table (`air.state.segment_invalid`); a table after a state of the same name
// keeps the table's duplicate code. The parse checks of each line are
// repeated here for an AST input. Literal-text positions take literals only,
// never a constant (P7-R3 reading R-9).
function verifyV053ModuleItems(mod, declarations) {
  const typed = parserModule.typedV053;
  const lineOf = (item) => (item && item.loc && Number.isSafeInteger(item.loc.line) ? item.loc.line : Number.MAX_SAFE_INTEGER);
  const items = [
    ...(Array.isArray(mod.constants) ? mod.constants : []).map((item) => ({ item, kind: "const" })),
    ...(Array.isArray(mod.tables) ? mod.tables : []).map((item) => ({ item, kind: "table" })),
    ...(Array.isArray(mod.states) ? mod.states : []).map((item) => ({ item, kind: "state" }))
  ].sort((left, right) => lineOf(left.item) - lineOf(right.item));
  const constants = new Map();
  const tables = new Map();
  const states = new Map();
  const none = new Map();
  const literal = (value, type, loc) => {
    if (typeof value !== "string") throw new VerificationError("air.v051.typed_atom_invalid: expected a literal", loc);
    verifyV051TypedAtom(value, type, none, declarations, loc);
  };
  for (const { item, kind } of items) {
    const loc = item && item.loc;
    if (kind === "const") {
      if (!item || typeof item.name !== "string" || !typed.CONST_NAME.test(item.name) || !typed.TABLE_ELEMENTS.has(item.type)) {
        throw new VerificationError("air.v051.typed_syntax_invalid: a constant is const <NAME>: <T> = <literal> with T one of i32, i64, f32, f64, bool", loc);
      }
      if (typeof item.value !== "string" || !typed.LITERAL_TOKEN.test(item.value)) {
        throw new VerificationError(`air.const.initializer_invalid: constant '${item.name}' takes one literal`, loc);
      }
      literal(item.value, verifyV051TypedType(item.type, declarations, loc, false), loc);
      if (constants.has(item.name)) throw new VerificationError(`air.v051.typed_syntax_invalid: duplicate constant '${item.name}'`, loc);
      constants.set(item.name, { loc, name: item.name, type: item.type, value: item.value });
    } else if (kind === "table") {
      if (!item || typeof item.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name) || !Array.isArray(item.values) ||
          !typed.TABLE_ELEMENTS.has(item.elementType)) {
        throw new VerificationError("air.v051.typed_syntax_invalid: a table is table <name>: <T>[<N>] = [v0, ..., vN-1] with T one of i32, i64, f32, f64, bool", loc);
      }
      if (!Number.isSafeInteger(item.length) || item.length < 1 || item.length > typed.AGGREGATE_MAX) {
        throw new VerificationError(`air.v051.type_reference_invalid: table length ${item.length} is outside 1..${typed.AGGREGATE_MAX}`, loc);
      }
      if (item.values.length !== item.length) throw new VerificationError(`air.v051.typed_syntax_invalid: table '${item.name}' declares ${item.length} values and lists ${item.values.length}`, loc);
      const element = verifyV051TypedType(item.elementType, declarations, loc, false);
      for (const value of item.values) literal(value, element, loc);
      if (tables.has(item.name) || states.has(item.name)) throw new VerificationError(`air.v051.typed_syntax_invalid: duplicate table '${item.name}'`, loc);
      tables.set(item.name, { element, length: item.length, name: item.name });
    } else {
      if (!item || typeof item.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name)) {
        throw new VerificationError("air.state.segment_invalid: a state is state <name>: <T>[<N>] = fill <literal>", loc);
      }
      if (!typed.TABLE_ELEMENTS.has(item.elementType)) throw new VerificationError(`air.state.cell_type_invalid: state cell type '${item.elementType}' is not admitted`, loc);
      if (!Number.isSafeInteger(item.length) || item.length < 1 || item.length > typed.AGGREGATE_MAX) {
        throw new VerificationError(`air.state.length_invalid: state length ${item.length} is outside 1..${typed.AGGREGATE_MAX}`, loc);
      }
      const element = verifyV051TypedType(item.elementType, declarations, loc, false);
      try {
        if (typeof item.fill !== "string" || !typed.LITERAL_TOKEN.test(item.fill)) throw new Error("not one literal token");
        literal(item.fill, element, loc);
      } catch (_) {
        throw new VerificationError(`air.state.init_invalid: state '${item.name}' is initialized by '${typeof item.init === "string" ? item.init : item.fill}'; a state is fill <literal of ${item.elementType}>`, loc);
      }
      if (states.has(item.name) || tables.has(item.name)) throw new VerificationError(`air.state.segment_invalid: the name '${item.name}' is already a state or a table`, loc);
      states.set(item.name, { element, length: item.length, name: item.name });
    }
  }
  V053_MODULE_CONSTANTS.set(declarations, constants);
  return { states, tables };
}

// P0-06 (slice text P6-R4, P6-R8, P6-R9): the table and aggregate operations.
// Shape errors are `operation_invalid`, type errors `typed_atom_type_mismatch`
// (R-10). A scalar result enters D as an operation result does (P0-03 §5.0:
// D = T, or a refined D of base T); an aggregate result needs D = T. A
// statically known index (SCALAR R-16) outside 0 <= i < N is a static
// rejection; every other index is checked at run time (P6-R4 reading R-2).
function verifyV053AggregateOperation(value, destination, ctx, scope, loc) {
  const op = String(value.op || "");
  const args = Array.isArray(value.args) ? value.args : [];
  const label = value.field === undefined ? op : `${op}.${value.field}`;
  const invalid = () => new VerificationError(`air.numeric.operation_invalid: '${label}'`, loc);
  const mismatch = (detail) => new VerificationError(`air.v051.typed_atom_type_mismatch: '${label}' ${detail}`, loc);
  const subjectOf = (text, kind) => {
    const name = typeof text === "string" ? text.trim() : "";
    if (!/^%[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw invalid();
    const typeName = scope.locals.get(name.slice(1));
    if (typeName === undefined) throw new VerificationError(`air.v051.local_unknown: '${name}'`, loc);
    const type = verifyV053TypedType(typeName, ctx.declarations, loc);
    if (type.kind !== kind) throw mismatch(`needs a ${kind} local, not ${type.canonical}`);
    return type;
  };
  const fieldOf = (subject) => {
    const field = subject.declaration.fields.find((item) => item.name === value.field);
    if (!field) throw invalid();
    return verifyV053TypedType(field.type, ctx.declarations, loc);
  };
  const atom = (text, type) => {
    if (typeof text !== "string") throw new VerificationError("air.v051.typed_atom_invalid: expected a typed atom", loc);
    verifyV053TypedExpression(text, type, scope.locals, ctx.declarations, loc, scope.staticValues);
  };
  const index = (text) => {
    verifyV053TypedAtom(text, verifyV053TypedType("i32", ctx.declarations, loc), scope.locals, ctx.declarations, loc);
    return v053StaticInteger(text, scope.staticValues, ctx.declarations);
  };
  const enter = (result) => {
    const admitted = isV053AggregateKind(result) ? destination.canonical === result.canonical : v051TypeBase(destination) === result.canonical;
    if (!admitted) throw mismatch(`yields ${result.canonical}, not ${destination.canonical}`);
  };
  const domain = (at, length, code, what) => {
    if (at !== undefined && (at < 0n || at >= BigInt(length))) {
      throw new VerificationError(`${code}: index ${at} is outside ${what} (0 <= i < ${length})`, loc);
    }
  };
  if (op === "table.set") throw new VerificationError("air.table.readonly: typed-v0.53 tables are read-only (table.get only)", loc);
  // P0-07 (slice text P7-R7, P7-R8): `state.get` is a value and `state.set` a
  // statement (`destination` null); every other `state.*` form, an unknown
  // state and a wrong operand count are `air.state.op_invalid`. An index is
  // static: a statically known value (SCALAR R-16, constants included) inside
  // 0 <= i < N; outside it `air.state.index_out_of_bounds`, and an index that
  // is not statically known `air.state.dynamic_bounds_required`.
  if (op.startsWith("state.")) {
    const opInvalid = (detail) => new VerificationError(`air.state.op_invalid: '${op}' ${detail}`, loc);
    const expected = destination === null ? "state.set" : "state.get";
    if (op !== expected) throw opInvalid(destination === null ? "is not a statement; state.set <s>, <index>, <value> is" : "is not a value; %v: T = state.get <s>, <index> is, and state.set has no result binding");
    if (args.length !== (destination === null ? 3 : 2)) throw opInvalid(`takes ${destination === null ? 3 : 2} operands, not ${args.length}`);
    const state = ctx.states.get(args[0]);
    if (!state) throw opInvalid(`names no state of this module: '${args[0]}'`);
    const at = index(args[1]);
    if (destination === null) atom(args[2], state.element);
    else enter(state.element);
    if (at === undefined) {
      throw new VerificationError(`air.state.dynamic_bounds_required: the index '${args[1]}' of state '${state.name}' is not statically known; typed-v0.53 state indexes are static`, loc);
    }
    if (at < 0n || at >= BigInt(state.length)) {
      throw new VerificationError(`air.state.index_out_of_bounds: index ${at} is outside state '${state.name}' (0 <= i < ${state.length})`, loc);
    }
    return;
  }
  if (op === "table.get") {
    if (args.length !== 2) throw invalid();
    const table = ctx.tables.get(args[0]);
    if (!table) throw invalid();
    const at = index(args[1]);
    enter(table.element);
    domain(at, table.length, "air.table.index_out_of_range", `table '${table.name}'`);
  } else if (op === "struct.new") {
    if (destination.kind !== "struct") throw mismatch(`builds a struct, not ${destination.canonical}`);
    const fields = destination.declaration.fields;
    if (args.length !== fields.length) throw invalid();
    args.forEach((argument, position) => atom(argument, verifyV053TypedType(fields[position].type, ctx.declarations, loc)));
  } else if (op === "struct.get") {
    if (args.length !== 1) throw invalid();
    enter(fieldOf(subjectOf(args[0], "struct")));
  } else if (op === "struct.set") {
    if (args.length !== 2) throw invalid();
    const subject = subjectOf(args[0], "struct");
    const field = fieldOf(subject);
    if (destination.canonical !== subject.canonical) throw mismatch(`yields ${subject.canonical}, not ${destination.canonical}`);
    atom(args[1], field);
  } else if (op === "array.new") {
    if (destination.kind !== "array") throw mismatch(`builds an array, not ${destination.canonical}`);
    if (args.length !== destination.count) throw invalid();
    for (const argument of args) atom(argument, destination.element);
  } else if (op === "array.get") {
    if (args.length !== 2) throw invalid();
    const subject = subjectOf(args[0], "array");
    const at = index(args[1]);
    enter(subject.element);
    domain(at, subject.count, "air.array.index_out_of_range", `'${args[0]}'`);
  } else if (op === "array.set") {
    if (args.length !== 3) throw invalid();
    const subject = subjectOf(args[0], "array");
    if (destination.canonical !== subject.canonical) throw mismatch(`yields ${subject.canonical}, not ${destination.canonical}`);
    const at = index(args[1]);
    atom(args[2], subject.element);
    domain(at, subject.count, "air.array.index_out_of_range", `'${args[0]}'`);
  } else {
    throw invalid();
  }
}

const V053_I32_FAMILY = /^i32(?:<-?[0-9]+\.\.-?[0-9]+>)?$/;
const V053_CONSTRUCTOR_PAYLOAD = /^(?:option\.some|result\.(?:ok|err))<.+>\s+%([A-Za-z_][A-Za-z0-9_]*)$/;

// P0-03 (slice text §4.1, P3-R2; R-REF-5): for a reference of the i32 family
// (`i32` or `i32<a..b>`) typed-v0.53 replaces the typed-v0.51 identity rule.
// Into `i32`, or into a refinement that contains its declared type, it widens
// implicitly; into any other refinement it is a narrowing at a refinement
// entry point, statically proven or runtime-checked (R-REF-3). A constructor
// payload slot is plain, so a refined payload reference widens into it.
// Everything else keeps the typed-v0.51 atom rule and its codes.
// ---------------------------------------------------------------------------
// P0-08 (slice text P8-R1..P8-R16; docs/v0.53/TYPED_MEMORY.md): regions,
// views, buffers and borrowed views. A memory local's facts live in
// `scope.memory` (name -> { kind, region, ... }); a region is its
// `alloc_region` statement's record, whose state in `scope.regions` is
// "live", "dead" or "maybe" (possibly live after a branch). Each
// `alloc_region` statement's maximum (P8-R7) is kept for the WorkBound phase
// and the lowering in a side table keyed by the statement, so verification
// attaches nothing to the AST.
const V053_REGION_MAX = 16777216n;
const V053_MEMORY_SITES = new WeakMap();
const V053_NESTED_MEMORY = /(?:^|[<,])(?:ptr|slice|buffer<|borrowed_slice<)/;
const V053_MEMORY_ARITY = Object.freeze({
  alloc_region: 1, "buffer.from_ptr": 1, "buffer.load": 2, "buffer.store": 3, free_region: 1, "load.f32": 2, "load.i32": 2,
  "slice.from_region": 2, "slice.len": 1, "slice.literal": 0, "slice.load.f32": 2, "slice.load.i32": 2, "slice.store.f32": 3,
  "slice.store.i32": 3, "slice.sub": 3, "store.f32": 3, "store.i32": 3
});
const V053_MEMORY_UNBOUND = new Set(["buffer.store", "free_region", "slice.store.f32", "slice.store.i32", "store.f32", "store.i32"]);

function v053MemoryKind(text) {
  const type = String(text || "").trim();
  if (type === "ptr") return { kind: "ptr" };
  if (type === "slice") return { kind: "slice" };
  const buffer = /^buffer<(i32|f32),([1-9][0-9]*)>$/.exec(type);
  if (buffer) return { count: BigInt(buffer[2]), element: buffer[1], kind: "buffer" };
  if (/^borrowed_slice</.test(type)) return { borrow: parseBorrowedSliceType(type).borrow, kind: "borrowed" };
  return null;
}

function v053ViewEscape(detail, loc) {
  return new VerificationError(`air.memory.view_escape: ${detail}`, loc);
}

function v053MemorySite(statement) {
  return V053_MEMORY_SITES.get(statement);
}

// P8-R12: where a memory type may not stand in a signature.
// OD-P8-6 (b), F-1: a borrowed-lane artifact is invoked only through the
// typed admission, whose v2 descriptor lists borrowed exports only (P8-R13,
// P8-R15, P8-R24). A plain export beside a borrowed one would be a Wasm
// export no supported host path can call, so the module is refused before
// any artifact exists, at the first plain export in source order.
function verifyV053BorrowedLaneExports(mod) {
  const exported = (mod.functions || []).filter((fn) => fn && fn.exported);
  const borrowed = (fn) => (fn.params || []).some((parameter) => parameter && /^borrowed_slice\s*</.test(String(parameter.type)));
  const lane = exported.find(borrowed);
  if (!lane) return;
  const plain = exported.find((fn) => !borrowed(fn));
  if (!plain) return;
  throw new VerificationError(`air.abi.borrowed_lane_plain_export: export '${plain.name}' takes no borrowed_slice in a module whose export '${lane.name}' does; a borrowed-lane artifact is invoked only through the typed admission, so every export of the module must take a borrowed_slice`, plain.loc);
}

function verifyV053MemorySignature(fn, signature, returnType) {
  // P8-R15: the typed-memory-v1 marker's export name is reserved, as the
  // legacy lane reserves the v1 marker's (assertWasmTargetSupport).
  if (fn.exported && fn.name === "__air_abi_feature_typed_memory_v1") {
    throw new VerificationError(`air.abi.borrowed_slice_interface_mismatch: export '${fn.name}' is reserved for the AIR ABI typed-memory-v1 feature marker`, fn.loc);
  }
  if (fn.exported) {
    const parameter = signature.find((type) => type.kind === "memory" && type.memory.kind !== "borrowed");
    if (parameter) {
      throw new VerificationError(`air.abi.export_type_unsupported: export '${fn.name}' takes ${parameter.canonical}; region pointers, views and buffers are internal and never cross the AIR ABI`, fn.loc);
    }
  }
  if (returnType.kind !== "memory") return;
  if (returnType.memory.kind === "borrowed") {
    throw new VerificationError(`air.borrow.escape_return: '${fn.name}' returns a borrowed slice; a borrowed view never outlives its invocation`, fn.loc);
  }
  if (fn.exported && returnType.memory.kind === "slice") {
    throw new VerificationError(`air.abi.slice_return_unsupported: export '${fn.name}' returns a slice; a view never crosses the AIR ABI`, fn.loc);
  }
  if (fn.exported) {
    throw new VerificationError(`air.abi.export_type_unsupported: export '${fn.name}' returns ${returnType.canonical}; region pointers and buffers are internal and never cross the AIR ABI`, fn.loc);
  }
  throw v053ViewEscape(`'${fn.name}' returns ${returnType.canonical}; a function never returns a memory value`, fn.loc);
}

function v053ParameterMemory(type) {
  const memory = type.memory;
  if (memory.kind === "ptr") return { ext: undefined, kind: "ptr", region: null };
  if (memory.kind === "slice") return { kind: "slice", len: undefined, readonly: false, region: null };
  if (memory.kind === "buffer") return { count: memory.count, element: memory.element, kind: "buffer", region: null };
  return { borrow: memory.borrow, kind: "borrowed", region: null };
}

// P8-R9: after an `if` or a `match`, a region is live if it is live at the end
// of every branch, dead if it is dead (or not allocated) on every branch, and
// possibly live otherwise.
function joinV053Regions(outer, branches) {
  const records = new Set();
  for (const branch of branches) for (const record of branch.keys()) records.add(record);
  for (const record of records) {
    const states = branches.map((branch) => branch.get(record) || "dead");
    outer.set(record, states.every((state) => state === "live") ? "live" : states.every((state) => state === "dead") ? "dead" : "maybe");
  }
}

// P8-R9: a return reached while a region is live or possibly live.
function verifyV053NoLeak(scope, loc) {
  for (const [record, state] of scope.regions || []) {
    if (state !== "dead") {
      throw new VerificationError(`air.memory.region_leak: the region of '%${record.name}' is ${state === "live" ? "live" : "possibly live"} at this return; free it on every path`, loc);
    }
  }
}

// P8-R12 (call rules): a memory value passed to a local call. The callee's
// parameter takes it for the call only. A read-only view never binds a
// `slice` parameter (P8-R3: a view derived from a read-only view stays
// read-only, and the callee could store through it).
function verifyV053MemoryArgument(argument, parameter, ctx, scope, loc, callee, index) {
  const text = String(argument || "").trim();
  const name = /^%[A-Za-z_][A-Za-z0-9_]*$/.test(text) ? text.slice(1) : null;
  const info = name ? scope.memory.get(name) : undefined;
  if (name && !scope.locals.has(name)) throw new VerificationError(`air.v051.local_unknown: '${text}'`, loc);
  const expected = parameter.memory;
  if (expected.kind === "borrowed" || (info && info.kind === "borrowed")) {
    if (!info || info.kind !== "borrowed" || expected.kind !== "borrowed" || !borrowedArgumentCompatible(expected.borrow, info.borrow)) {
      throw new VerificationError(`air.borrow.call_mismatch: argument ${index} for @${callee} is not compatible with ${parameter.canonical}`, loc);
    }
    return;
  }
  if (!info || info.kind !== expected.kind || (expected.kind === "buffer" && scope.locals.get(name) !== parameter.canonical)) {
    throw new VerificationError(`air.v051.typed_atom_type_mismatch: argument ${index} of @${callee} must be ${parameter.canonical}`, loc);
  }
  verifyV053RegionLive(info, scope, loc);
  if (info.kind === "slice" && info.readonly) {
    throw new VerificationError(`air.memory.readonly_data: argument ${index} of @${callee} is a read-only view; a slice parameter may be stored through`, loc);
  }
}

function verifyV053RegionLive(info, scope, loc) {
  if (info.region && scope.regions.get(info.region) !== "live") {
    throw new VerificationError(`air.memory.region_not_live: the region of '%${info.region.name}' is ${scope.regions.get(info.region) === "maybe" ? "possibly freed" : "freed"} here`, loc);
  }
}

// P8-R2..P8-R11, P8-R16: one memory statement. `declared` is the bound
// local's resolved type, or null for an unbound statement. Returns the bound
// memory local's facts, or null.
function verifyV053MemoryOperation(statement, declared, ctx, scope, loc) {
  const value = statement.value;
  const op = value.op;
  const args = Array.isArray(value.args) ? value.args : [];
  const invalid = (detail) => new VerificationError(`air.numeric.operation_invalid: '${op}' ${detail}`, loc);
  if (!Object.prototype.hasOwnProperty.call(V053_MEMORY_ARITY, op)) {
    throw invalid("is not a typed-v0.53 memory operation; memory accesses are i32 and f32 (P8-R1)");
  }
  if (declared && V053_MEMORY_UNBOUND.has(op)) throw invalid("has no result; it is written without a binding");
  if (!declared && !V053_MEMORY_UNBOUND.has(op)) throw new VerificationError(`air.v051.typed_syntax_invalid: '${op}' needs a result binding`, loc);
  if (args.length !== V053_MEMORY_ARITY[op] || (value.max !== undefined && op !== "alloc_region")) {
    throw invalid(`takes ${V053_MEMORY_ARITY[op]} operand(s), not ${args.length}`);
  }
  const i32 = verifyV053TypedType("i32", ctx.declarations, loc);
  const operand = (text, kinds) => {
    const atom = String(text || "").trim();
    if (!/^%[A-Za-z_][A-Za-z0-9_]*$/.test(atom)) throw new VerificationError(`air.v051.typed_atom_invalid: '${atom}' is not a ${kinds.join(" or ")} local`, loc);
    const name = atom.slice(1);
    if (!scope.locals.has(name)) throw new VerificationError(`air.v051.local_unknown: '${atom}'`, loc);
    const info = scope.memory.get(name);
    if (!info || !kinds.includes(info.kind)) {
      throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${atom}' is ${scope.locals.get(name)}, not a ${kinds.join(" or ")}`, loc);
    }
    return info;
  };
  const integer = (text) => {
    verifyV053TypedAtom(text, i32, scope.locals, ctx.declarations, loc);
    return v053StaticInteger(text, scope.staticValues, ctx.declarations);
  };
  const staticFail = (detail, message) => {
    const error = new VerificationError(`air.memory.region_bounds_static: ${message}`, loc);
    error.detail = detail;
    return error;
  };
  const destination = (kind, text) => {
    if (!declared || declared.kind !== "memory" || declared.memory.kind !== kind) {
      throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${op}' yields ${text}, not ${declared ? declared.canonical : "nothing"}`, loc);
    }
  };
  const scalarResult = (type) => {
    const admitted = type === "i32" ? V053_I32_FAMILY.test(declared.canonical) : declared.canonical === type;
    if (declared.kind === "memory" || !admitted) {
      throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${op}' yields ${type}, not ${declared.canonical}`, loc);
    }
  };
  const storedValue = (text, type) => verifyV053TypedAtom(text, verifyV053TypedType(type, ctx.declarations, loc), scope.locals, ctx.declarations, loc);
  // P8-R5: lower bounds in operand order, then extents; `w` the access width.
  const accessChecks = (offset, extent, what) => {
    if (offset !== undefined && offset < 0n) throw staticFail("lower_bound", `offset ${offset} is negative`);
    if (extent !== undefined && extent < 4n) throw staticFail("extent", `${what} of ${extent} byte(s) holds no 4-byte value`);
    if (offset !== undefined && extent !== undefined && offset > extent - 4n) throw staticFail("extent", `offset ${offset} plus 4 bytes passes the ${extent}-byte ${what}`);
  };

  if (op === "slice.literal") {
    destination("slice", "a read-only slice");
    return { kind: "slice", len: BigInt(Buffer.byteLength(value.text, "utf8")), readonly: true, region: null };
  }
  if (op === "alloc_region") {
    destination("ptr", "a region pointer");
    const size = integer(args[0]);
    let max = null;
    let failure = null;
    if (size !== undefined) {
      if (size < 0n) throw staticFail("lower_bound", `region size ${size} is negative`);
      if (size > V053_REGION_MAX) throw new VerificationError(`air.memory.region_size_unsupported: region size ${size} exceeds REGION_MAX ${V053_REGION_MAX}`, loc);
      max = size;
    } else if (value.max !== undefined) {
      if (/^(0|[1-9][0-9]*)$/.test(String(value.max))) {
        max = BigInt(value.max);
        if (max > V053_REGION_MAX) throw new VerificationError(`air.memory.region_size_unsupported: region maximum ${max} exceeds REGION_MAX ${V053_REGION_MAX}`, loc);
      } else {
        failure = "invalid_bound";
      }
    } else {
      const refined = parseRefinementType(String(scope.locals.get(String(args[0]).trim().slice(1)) || ""), loc);
      if (refined && refined.base === "i32") {
        const upper = BigInt(refined.refinement.max);
        if (upper < 0n) throw staticFail("lower_bound", `every value of ${refined.canonical || "the size"} is negative`);
        if (upper > V053_REGION_MAX) throw new VerificationError(`air.memory.region_size_unsupported: region size up to ${upper} exceeds REGION_MAX ${V053_REGION_MAX}`, loc);
        max = upper;
      } else {
        failure = "unknown_bound";
      }
    }
    V053_MEMORY_SITES.set(statement, Object.freeze({ failure, max, maxText: value.max === undefined ? null : String(value.max) }));
    const record = Object.freeze({ name: statement.name, site: statement });
    scope.regions.set(record, "live");
    return { ext: size, kind: "ptr", region: record };
  }
  if (op === "free_region") {
    const info = operand(args[0], ["ptr", "borrowed", "slice", "buffer"]);
    if (info.kind === "borrowed") throw new VerificationError("air.borrow.free_forbidden: a borrowed slice is host memory; AIR never frees it", loc);
    if (info.kind !== "ptr") throw new VerificationError(`air.v051.typed_atom_type_mismatch: free_region takes a region pointer, not ${scope.locals.get(String(args[0]).trim().slice(1))}`, loc);
    if (!info.region) throw new VerificationError(`air.memory.free_not_owner: '${String(args[0]).trim()}' is a parameter; only the allocating function frees a region`, loc);
    verifyV053RegionLive(info, scope, loc);
    scope.regions.set(info.region, "dead");
    return null;
  }
  const access = /^(slice\.)?(load|store)\.(i32|f32)$/.exec(op);
  if (access && !access[1]) {
    const info = operand(args[0], ["ptr"]);
    verifyV053RegionLive(info, scope, loc);
    const offset = integer(args[1]);
    if (access[2] === "store") storedValue(args[2], access[3]);
    accessChecks(offset, info.ext, "region");
    if (access[2] === "load") scalarResult(access[3]);
    return null;
  }
  if (access) {
    const info = operand(args[0], ["slice", "borrowed"]);
    verifyV053RegionLive(info, scope, loc);
    if (access[2] === "store" && info.kind === "slice" && info.readonly) {
      throw new VerificationError(`air.memory.readonly_data: '${String(args[0]).trim()}' is a read-only view of literal data`, loc);
    }
    const offset = integer(args[1]);
    if (access[2] === "store") storedValue(args[2], access[3]);
    if (info.kind === "borrowed") {
      verifyV053BorrowedAccess(info.borrow, access[2] === "load" ? "read" : "write", 4, offset, op, loc);
    } else {
      accessChecks(offset, info.len, "view");
    }
    if (access[2] === "load") scalarResult(access[3]);
    return null;
  }
  if (op === "slice.from_region") {
    destination("slice", "a slice");
    const info = operand(args[0], ["ptr"]);
    verifyV053RegionLive(info, scope, loc);
    const length = integer(args[1]);
    if (length !== undefined && length < 0n) throw staticFail("lower_bound", `view length ${length} is negative`);
    if (length !== undefined && info.ext !== undefined && length > info.ext) throw staticFail("extent", `view length ${length} passes the ${info.ext}-byte region`);
    return { kind: "slice", len: length, readonly: false, region: info.region };
  }
  if (op === "slice.sub") {
    const info = operand(args[0], ["slice", "borrowed"]);
    verifyV053RegionLive(info, scope, loc);
    const offset = integer(args[1]);
    const length = integer(args[2]);
    if (info.kind === "borrowed") {
      if (!declared || declared.kind !== "memory" || declared.memory.kind !== "borrowed") {
        throw new VerificationError("air.borrow.reinterpret_forbidden: slice.sub of a borrowed slice must preserve an explicit borrowed_slice type", loc);
      }
      verifyV053BorrowedSubslice(info.borrow, declared.memory.borrow, offset, length, scope, args[2], loc);
      return { borrow: declared.memory.borrow, kind: "borrowed", region: null };
    }
    destination("slice", "a slice");
    if (offset !== undefined && offset < 0n) throw staticFail("lower_bound", `sub-view offset ${offset} is negative`);
    if (length !== undefined && length < 0n) throw staticFail("lower_bound", `sub-view length ${length} is negative`);
    if (length !== undefined && info.len !== undefined && length > info.len) throw staticFail("extent", `sub-view length ${length} passes the ${info.len}-byte view`);
    if (offset !== undefined && length !== undefined && info.len !== undefined && offset > info.len - length) {
      throw staticFail("extent", `sub-view [${offset}, ${offset + length}) passes the ${info.len}-byte view`);
    }
    return { kind: "slice", len: length, readonly: info.readonly, region: info.region };
  }
  if (op === "slice.len") {
    const info = operand(args[0], ["slice", "borrowed"]);
    verifyV053RegionLive(info, scope, loc);
    scalarResult("i32");
    return null;
  }
  if (op === "buffer.from_ptr") {
    destination("buffer", "a buffer");
    const info = operand(args[0], ["ptr"]);
    verifyV053RegionLive(info, scope, loc);
    const bytes = declared.memory.count * 4n;
    if (info.ext !== undefined && bytes > info.ext) throw staticFail("extent", `${declared.canonical} needs ${bytes} bytes; the region has ${info.ext}`);
    return { count: declared.memory.count, element: declared.memory.element, kind: "buffer", region: info.region };
  }
  // buffer.load, buffer.store
  const info = operand(args[0], ["buffer"]);
  verifyV053RegionLive(info, scope, loc);
  const index = integer(args[1]);
  if (op === "buffer.store") storedValue(args[2], info.element);
  if (index !== undefined && index < 0n) throw staticFail("lower_bound", `element index ${index} is negative`);
  if (index !== undefined && index >= info.count) throw staticFail("extent", `element index ${index} passes the ${info.count}-element buffer`);
  if (op === "buffer.load") scalarResult(info.element);
  return null;
}

// P8-R13: the frozen borrowed access rules (v0.50 validateBorrowedAccess).
function verifyV053BorrowedAccess(borrow, operation, width, offset, op, loc) {
  if (!borrowedAccessAllows(borrow.access, operation)) {
    throw new VerificationError(`air.borrow.mode_violation: ${borrow.access} borrowed slice does not permit ${operation} access`, loc);
  }
  if (width > borrow.alignment) {
    throw new VerificationError(`air.borrow.alignment_invalid: ${op} requires ${width}-byte alignment, but the borrowed slice declares ${borrow.alignment}`, loc);
  }
  if (offset !== undefined && (offset < 0n || offset > 2147483647n - BigInt(width) || offset + BigInt(width) > BigInt(borrow.length.max))) {
    throw new VerificationError(`air.borrow.length_invalid: ${op} offset ${offset} and width ${width} cannot fit maximum ${borrow.length.max}`, loc);
  }
  if (offset !== undefined && offset % BigInt(width) !== 0n) {
    throw new VerificationError(`air.borrow.alignment_invalid: ${op} offset ${offset} is not aligned to ${width} bytes`, loc);
  }
}

// P8-R13: the frozen borrowed sub-view rules (v0.50 validateBorrowedSubslice).
function verifyV053BorrowedSubslice(parent, child, offset, length, scope, lengthText, loc) {
  if (parent.access !== child.access) throw new VerificationError(`air.borrow.mode_violation: slice.sub must preserve ${parent.access} access mode`, loc);
  if (child.length.max > parent.length.max) {
    throw new VerificationError(`air.borrow.length_invalid: subslice maximum ${child.length.max} exceeds parent maximum ${parent.length.max}`, loc);
  }
  const refined = parseRefinementType(String(scope.locals.get(String(lengthText).trim().slice(1)) || ""), loc);
  const requested = length !== undefined ? { max: length, min: length }
    : refined && refined.base === "i32" ? { max: BigInt(refined.refinement.max), min: BigInt(refined.refinement.min) } : null;
  if (requested && (requested.min < BigInt(child.length.min) || requested.max > BigInt(child.length.max))) {
    throw new VerificationError(`air.borrow.length_invalid: slice.sub requested length does not fit declared range ${child.length.min}..${child.length.max}`, loc);
  }
  if (child.alignment !== parent.alignment) throw new VerificationError(`air.borrow.alignment_invalid: slice.sub must preserve declared alignment ${parent.alignment}`, loc);
  if (offset !== undefined && length !== undefined && (offset < 0n || length < 0n || offset > 2147483647n - length || offset + length > BigInt(parent.length.max))) {
    throw new VerificationError(`air.borrow.length_invalid: slice.sub offset ${offset} and length ${length} cannot fit parent maximum ${parent.length.max}`, loc);
  }
  if (offset !== undefined && offset % BigInt(parent.alignment) !== 0n) {
    throw new VerificationError(`air.borrow.alignment_invalid: slice.sub offset ${offset} does not preserve ${parent.alignment}-byte alignment`, loc);
  }
}

function verifyV053TypedAtom(value, expected, locals, declarations, loc) {
  if (typeof value !== "string" || !value.trim()) throw new VerificationError("air.v051.typed_atom_invalid: expected a typed atom", loc);
  const text = value.trim();
  // P0-07 (slice text P7-R3): a constant reference is an atom of its declared
  // type, never re-typed by its context (reading R-7); a refined slot of that
  // base takes it as it takes an operation result.
  const constant = v053ConstantOf(declarations, text);
  if (constant) {
    if (v051TypeBase(expected) !== constant.type) throw new VerificationError(`air.v051.typed_atom_type_mismatch: constant '${text}' is ${constant.type}, not ${expected.canonical}`, loc);
    return expected;
  }
  // A constructor payload that is a constant: the payload slot's type must be
  // the constant's type; the constructor is then checked over its literal.
  const constructor = text.match(/^(option\.some<(.+)>|result\.(ok|err)<(.+)>)\s+([A-Z][A-Za-z0-9_]*)$/);
  const payloadConstant = constructor ? v053ConstantOf(declarations, constructor[5]) : undefined;
  if (payloadConstant) {
    const parts = constructor[2] === undefined ? splitV051TypeArguments(constructor[4]) : null;
    const slot = constructor[2] !== undefined ? constructor[2] : parts && parts.length === 2 ? parts[constructor[3] === "ok" ? 0 : 1] : null;
    if (slot === null || slot.trim() !== payloadConstant.type) {
      throw new VerificationError(`air.v051.typed_atom_type_mismatch: constant '${constructor[5]}' is ${payloadConstant.type}, not the payload type of '${constructor[1]}'`, loc);
    }
    return verifyV051TypedAtom(`${constructor[1]} ${payloadConstant.value}`, expected, locals, declarations, loc);
  }
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    const local = locals.get(text.slice(1));
    if (local && V053_I32_FAMILY.test(local) && v051TypeBase(expected) === "i32") return expected;
  }
  const payload = text.match(V053_CONSTRUCTOR_PAYLOAD);
  if (payload) {
    const local = locals.get(payload[1]);
    if (local && local !== "i32" && V053_I32_FAMILY.test(local)) {
      const widened = new Map(locals);
      widened.set(payload[1], "i32");
      return verifyV051TypedAtom(value, expected, widened, declarations, loc);
    }
  }
  return verifyV051TypedAtom(value, expected, locals, declarations, loc);
}

// R-SCL-2 with the slice text's reading R-16: a value is statically known when
// it is an integer literal, or a reference to a local whose initializer was
// statically known (an integer literal, a statically known reference, or an
// evaluated checked operation). Float literals and every other result are not.
// P0-07 (P7-R3 reading R-6): an integer constant names a literal, so it is
// statically known too.
function v053StaticInteger(value, staticValues, declarations) {
  const text = String(value || "").trim();
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    const known = staticValues.get(text.slice(1));
    return typeof known === "bigint" ? known : undefined;
  }
  const constant = v053ConstantOf(declarations, text);
  if (constant) return /^-?(0|[1-9][0-9]*)$/.test(constant.value) ? BigInt(constant.value) : undefined;
  return /^-?(0|[1-9][0-9]*)$/.test(text) ? BigInt(text) : undefined;
}

function verifyV053TypedExpression(value, expected, locals, declarations, loc, staticValues) {
  let staticValue;
  if (value && typeof value === "object" && value.kind === "numeric_operation") {
    staticValue = verifyV053TypedOperation(value, expected, locals, declarations, loc, staticValues);
  } else {
    verifyV053TypedAtom(value, expected, locals, declarations, loc);
    const base = v051TypeBase(expected);
    if (base === "i32" || base === "i64") staticValue = v053StaticInteger(value, staticValues, declarations);
  }
  if (expected.refinement && expected.refinement.kind === "i32_range" && typeof staticValue === "bigint" &&
      (staticValue < BigInt(expected.refinement.min) || staticValue > BigInt(expected.refinement.max))) {
    throw new VerificationError(`air.refinement.assignment_out_of_range: ${staticValue} is outside ${expected.canonical}`, loc);
  }
  return staticValue;
}

function verifyV053TypedOperation(operation, expected, locals, declarations, loc, staticValues) {
  const op = String(operation.op || "");
  if (Object.prototype.hasOwnProperty.call(V053_MODE_REQUIRED, op)) {
    throw new VerificationError(`air.numeric.operation_mode_required: '${op}' has no implicit mode; use ${V053_MODE_REQUIRED[op]}`, loc);
  }
  const signature = Object.prototype.hasOwnProperty.call(parserModule.typedV053.OPERATIONS, op) ? parserModule.typedV053.OPERATIONS[op] : null;
  if (!signature || !Array.isArray(operation.args) || operation.args.length !== signature.args.length) {
    throw new VerificationError(`air.numeric.operation_invalid: '${op}'`, loc);
  }
  if (v051TypeBase(expected) !== signature.result) throw new VerificationError(`air.v051.typed_atom_type_mismatch: '${op}'`, loc);
  for (let index = 0; index < signature.args.length; index += 1) {
    verifyV053TypedAtom(operation.args[index], parseTypeReference(signature.args[index]), locals, declarations, loc);
  }
  if (!signature.fold) return undefined;
  const values = operation.args.map((argument) => v053StaticInteger(argument, staticValues, declarations));
  if (values.some((value) => value === undefined)) return undefined;
  if (signature.fold === "comparison") return evaluateV051I64Comparison(signature.operation, values);
  if (signature.fold === "to_i32") {
    if (values[0] < V053_INTEGER_RANGE[32].min || values[0] > V053_INTEGER_RANGE[32].max) {
      throw new VerificationError("air.numeric.checked_failure: invalid_conversion", loc);
    }
    return values[0];
  }
  if (signature.fold === "to_f32") {
    // Exact iff the binary32 value equals the integer (|i32| < 2^53 is exact
    // in a JS Number). The f32 result is not a statically known integer.
    const number = Number(values[0]);
    if (Math.fround(number) !== number) throw new VerificationError("air.numeric.checked_failure: invalid_conversion", loc);
    return undefined;
  }
  return evaluateV053Checked(signature, values, loc);
}

function evaluateV053Checked(signature, values, loc) {
  const { max, min } = V053_INTEGER_RANGE[signature.width];
  const [left, right] = values;
  let result;
  if (signature.operation === "add") result = left + right;
  else if (signature.operation === "sub") result = left - right;
  else if (signature.operation === "mul") result = left * right;
  else if (signature.operation === "neg") result = -left;
  else if (signature.operation === "div_s") {
    if (right === 0n) throw new VerificationError("air.numeric.checked_failure: division_by_zero", loc);
    if (left === min && right === -1n) throw new VerificationError("air.numeric.checked_failure: overflow", loc);
    result = left / right;
  } else if (signature.operation === "rem_s") {
    if (right === 0n) throw new VerificationError("air.numeric.checked_failure: division_by_zero", loc);
    result = left === min && right === -1n ? 0n : left % right;
  } else {
    throw new VerificationError(`air.numeric.operation_invalid: '${signature.operation}'`, loc);
  }
  if (result < min || result > max) throw new VerificationError("air.numeric.checked_failure: overflow", loc);
  return result;
}

function verifyV053TypedMatch(statement, ctx, scope, branches = []) {
  const { declarations } = ctx;
  const { locals, staticValues } = scope;
  const typeName = locals.get(statement.value);
  if (!typeName) throw new VerificationError(`air.decision.match_unknown_value: '${statement.value}'`, statement.loc);
  const type = verifyV053TypedType(typeName, declarations, statement.loc);
  const destination = verifyV053TypedType(statement.destinationType, declarations, statement.loc);
  const isBool = type.kind === "primitive" && !type.refinement && type.canonical === "bool";
  let expected;
  if (type.kind === "enum") {
    expected = new Set(declarations.get(type.canonical).cases.map((item) => item.name));
  } else if (type.kind === "option") {
    expected = new Set(["none", "some"]);
  } else if (type.kind === "result") {
    expected = new Set(["ok", "err"]);
  } else if (isBool) {
    // RFC §5.4: value-level branch-on-bool, patterns `true` and `false`, exhaustive.
    expected = new Set(["false", "true"]);
  } else {
    throw new VerificationError("air.decision.match_type_unsupported: match requires enum, option, result or bool", statement.loc);
  }
  const seen = new Set();
  for (const arm of statement.arms || []) {
    const armLoc = arm.loc || statement.loc;
    if (arm.expression && typeof arm.expression === "object") {
      // OPEN-9 (a): numeric-operation arms are rejected (X-VL-01).
      throw new VerificationError(`air.decision.match_arm_invalid: '${arm.pattern}' must yield an atom, not an operation`, armLoc);
    }
    let pattern;
    if (isBool) {
      const value = String(arm.pattern || "").trim();
      if (value !== "true" && value !== "false") throw new VerificationError(`air.decision.match_arm_invalid: '${value}'`, armLoc);
      pattern = { binding: null, bindingType: null, key: value };
    } else {
      pattern = parseV051TypedMatchPattern(arm.pattern, type, declarations, armLoc);
    }
    if (!pattern.key || !expected.has(pattern.key)) throw new VerificationError(`air.decision.match_arm_invalid: '${arm.pattern}'`, armLoc);
    if (seen.has(pattern.key)) throw new VerificationError(`air.decision.match_duplicate_arm: '${pattern.key}'`, armLoc);
    if (pattern.binding && locals.has(pattern.binding)) throw new VerificationError(`air.decision.match_binding_shadow: '${pattern.binding}'`, armLoc);
    if (arm.block) {
      // P0-04 (R-CFG-1, P4-R9): a block-bodied arm ends with its yield.
      const armScope = verifyV053Block(arm.block, destination, ctx, scope, pattern.binding ? { name: pattern.binding, type: pattern.bindingType } : null, armLoc);
      branches.push(armScope.regions);
    } else {
      branches.push(new Map(scope.regions || []));
      const armLocals = new Map(locals);
      if (pattern.binding) armLocals.set(pattern.binding, pattern.bindingType);
      // A match arm is P0-03's block-yield entry point (P3-R5): a statically
      // known value outside a refined destination is rejected here (P3-R3).
      // Arm bindings never shadow a local, so they have no static value.
      verifyV053TypedExpression(arm.expression, destination, armLocals, declarations, armLoc, staticValues);
    }
    seen.add(pattern.key);
  }
  if (seen.size !== expected.size || [...expected].some((item) => !seen.has(item))) {
    const missing = [...expected].filter((item) => !seen.has(item)).sort();
    throw new VerificationError(`air.decision.match_nonexhaustive: match over '${typeName}' misses ${missing.map((item) => `'${item}'`).join(", ")}`, statement.loc);
  }
}

module.exports = {
  LEGACY_VERIFIER_ANALYSIS_LIMITS,
  legacyVerifierAnalysisProfile,
  RESOURCE_CERTIFICATE_KIND,
  RESOURCE_CERTIFICATE_SCHEMA_VERSION,
  STRUCTURED_PHI_LOOP_FUEL_LIMIT,
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
// Reached only through the candidate-gated source profile (R-PROF-2); not
// part of the enumerable exports that the public index spreads.
Object.defineProperty(module.exports, "typedV053", {
  enumerable: false,
  // P0-08: `memorySite(statement)` reads the maximum (P8-R7) the last
  // verification recorded for an `alloc_region` statement.
  value: Object.freeze({ memorySite: v053MemorySite, verify: verifyV053TypedModule })
});
