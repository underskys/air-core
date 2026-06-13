const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { verifyModule } = require("./verifier");
const { lowerToWat, watToWasm } = require("./lower_wasm");
const { checkPackageDir, createOutputImports } = require("./sdk");
const { AIR_ABI_VERSION } = require("./version");
const { HOST_ABI_VERSION } = require("./package_manifest");

const SAFETY_FUZZ_KIND = "air.verifierSafetyFuzzReport";
const SAFETY_FUZZ_SCHEMA_VERSION = "0.32";

async function createVerifierSafetyFuzzReport(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const seed = positiveInteger(options.seed, 1);
  const requestedCases = positiveInteger(options.cases, 50);
  const rng = createRng(seed);
  const cases = [];
  const diagnostics = [];
  const workDir = path.join(cwd, "build", "verifier_safety_fuzz", `run-${process.pid}-seed-${seed}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const templates = [
    arithmeticCase,
    invalidArithmeticCase,
    fixedStateCase,
    invalidStateCase,
    outputEmitCase,
    generatedHandleCase,
    invalidDynamicOutputCase,
    structuredIoFixtureCase,
    structuredIoInvalidJsonCase,
    structuredIoInvalidObjectCase,
    structuredIoInvalidStringCase,
    structuredIoGeneratedMissingCase,
    structuredIoGeneratedStaleCase
  ];

  for (let i = 0; i < requestedCases; i += 1) {
    const template = templates[i % templates.length];
    const testCase = await runCase(template(i, rng, cwd), cwd, workDir);
    cases.push(testCase);
    for (const diagnostic of testCase.diagnostics || []) diagnostics.push(diagnostic);
  }

  const failed = cases.filter((item) => item.status !== "pass");
  const skipped = cases.filter((item) => item.status === "skip");
  const passed = cases.filter((item) => item.status === "pass");
  const report = stableObject({
    schemaVersion: SAFETY_FUZZ_SCHEMA_VERSION,
    kind: SAFETY_FUZZ_KIND,
    status: failed.length ? "failed" : "passed",
    seed,
    requestedCases,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    families: familiesForCases(cases),
    runConfig: stableObject({
      deterministicSeed: true,
      liveNetwork: false,
      apiKeysRequired: false,
      liveModelCalls: false
    }),
    airAbi: AIR_ABI_VERSION,
    hostAbi: HOST_ABI_VERSION,
    metrics: stableObject({
      totalCases: cases.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      validCases: cases.filter((item) => item.expected === "valid").length,
      invalidCases: cases.filter((item) => item.expected === "invalid").length,
      unexpectedTraps: cases.filter((item) => item.unexpectedTrap).length,
      unexpectedImports: cases.filter((item) => item.unexpectedImport).length,
      invalidLoweringAttempts: cases.filter((item) => item.invalidLoweringAttempt).length,
      packageChecks: cases.filter((item) => item.packageDir).length
    }),
    cases: cases.sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics: normalizeDiagnostics(diagnostics),
    minimizedCase: failed.length ? minimizedCaseForFailure(failed[0]) : null,
    limitations: [
      "tiny deterministic scaffold only; this is not formal verification",
      "runtime execution covers generated valid cases from a small supported subset",
      "structured IO is exercised through existing package-check metadata fixtures, not runtime JSON"
    ]
  });
  fs.rmSync(workDir, { recursive: true, force: true });
  return report;
}

async function runCase(testCase, cwd, workDir) {
  if (testCase.packageCase) return runPackageCase(testCase, cwd, workDir);
  if (testCase.expected === "invalid") return runInvalidSourceCase(testCase);
  return runValidSourceCase(testCase);
}

async function runValidSourceCase(testCase) {
  const diagnostics = [];
  try {
    const mod = parseAir(testCase.source, `${testCase.id}.air`);
    verifyModule(mod);
    const wat = lowerToWat(mod);
    const wasm = await watToWasm(wat, `${testCase.id}.air`);
    const imports = testCase.imports === "output.emit"
      ? createOutputImports({ emit: () => 0 })
      : {};
    const instanceResult = await WebAssembly.instantiate(wasm, imports);
    const instance = instanceResult.instance || instanceResult;
    const fn = instance.exports.run;
    if (typeof fn !== "function") {
      diagnostics.push(diagnostic("air.fuzz_safety.export_missing", "fail", "generated valid case did not export run"));
      return finalizeCase(testCase, "fail", diagnostics, { unexpectedTrap: false, unexpectedImport: false });
    }
    const result = fn();
    const expected = typeof testCase.expectedResult === "number" ? testCase.expectedResult : result;
    if (result !== expected) {
      diagnostics.push(diagnostic("air.fuzz_safety.result_mismatch", "fail", "generated valid case returned unexpected scalar result", {
        expected,
        observed: result
      }));
    }
    const unexpectedImport = !testCase.allowImports && /\(import\s/.test(wat);
    if (unexpectedImport) diagnostics.push(diagnostic("air.fuzz_safety.unexpected_import", "fail", "generated valid case lowered to an unexpected import"));
    return finalizeCase(testCase, diagnostics.length ? "fail" : "pass", diagnostics, {
      observedResult: result,
      wasmBytes: wasm.length,
      watFingerprint: fingerprint(wat),
      unexpectedTrap: false,
      unexpectedImport
    });
  } catch (err) {
    diagnostics.push(diagnostic("air.fuzz_safety.unexpected_trap", "fail", sanitizeError(err)));
    return finalizeCase(testCase, "fail", diagnostics, {
      unexpectedTrap: true,
      unexpectedImport: false
    });
  }
}

function runInvalidSourceCase(testCase) {
  const diagnostics = [];
  try {
    const mod = parseAir(testCase.source, `${testCase.id}.air`);
    verifyModule(mod);
    diagnostics.push(diagnostic("air.fuzz_safety.invalid_accepted", "fail", "generated invalid case passed verification"));
    return finalizeCase(testCase, "fail", diagnostics, { invalidLoweringAttempt: true });
  } catch (err) {
    const message = sanitizeError(err);
    const matchedExpected = !testCase.expectedMessage || message.includes(testCase.expectedMessage);
    if (!matchedExpected) {
      diagnostics.push(diagnostic("air.fuzz_safety.invalid_wrong_diagnostic", "fail", "generated invalid case failed with an unexpected diagnostic", {
        expectedMessage: testCase.expectedMessage,
        observedMessage: message
      }));
      return finalizeCase(testCase, "fail", diagnostics, { invalidLoweringAttempt: false });
    }
    return finalizeCase(testCase, "pass", diagnostics, {
      invalidLoweringAttempt: false,
      observedDiagnosticCodes: testCase.expectedDiagnosticCodes || []
    });
  }
}

function runPackageCase(testCase, cwd, workDir) {
  const diagnostics = [];
  const packageDir = materializePackageCase(testCase, workDir);
  try {
    const report = checkPackageDir(packageDir, {
      profile: "cli",
      built: false
    });
    const observedCodes = diagnosticCodesFromPackageReport(report);
    if (testCase.expected === "valid" && report.status !== "pass") diagnostics.push(diagnostic("air.fuzz_safety.package_check_failed", "fail", "package-check did not pass"));
    if (testCase.expected === "invalid" && report.status === "pass") diagnostics.push(diagnostic("air.fuzz_safety.invalid_accepted", "fail", "generated invalid package case passed package-check"));
    for (const code of testCase.expectedDiagnosticCodes || []) {
      if (!observedCodes.includes(code)) {
        diagnostics.push(diagnostic("air.fuzz_safety.invalid_wrong_diagnostic", "fail", "generated invalid package case missed expected diagnostic", {
          expectedCode: code,
          observedCodes
        }));
      }
    }
    const structuredSchemas = (((report.structuredIO || {}).schemas) || []).length;
    if (testCase.expected === "valid" && !structuredSchemas) {
      diagnostics.push(diagnostic("air.fuzz_safety.structured_io_missing", "fail", "structured IO fixture did not report structured IO schemas"));
    }
    return finalizeCase(testCase, diagnostics.length ? "fail" : "pass", diagnostics, {
      observedResult: null,
      structuredSchemas,
      unexpectedTrap: false,
      unexpectedImport: false,
      invalidLoweringAttempt: false,
      observedDiagnosticCodes: observedCodes
    });
  } catch (err) {
    diagnostics.push(diagnostic("air.fuzz_safety.package_check_failed", "fail", sanitizeError(err)));
    return finalizeCase(testCase, "fail", diagnostics, {
      unexpectedTrap: false,
      unexpectedImport: false,
      invalidLoweringAttempt: false
    });
  }
}

function finalizeCase(testCase, status, diagnostics, extra = {}) {
  return stableObject({
    id: testCase.id,
    family: testCase.family || testCase.kind,
    kind: testCase.kind,
    expected: testCase.expected,
    status,
    sourceFingerprint: testCase.source ? fingerprint(testCase.source) : null,
    packageDir: testCase.packageDir || null,
    observedResult: Object.prototype.hasOwnProperty.call(extra, "observedResult") ? extra.observedResult : null,
    observedDiagnosticCodes: (extra.observedDiagnosticCodes || []).slice().sort(),
    wasmBytes: extra.wasmBytes || null,
    watFingerprint: extra.watFingerprint || null,
    structuredSchemas: extra.structuredSchemas || 0,
    unexpectedTrap: Boolean(extra.unexpectedTrap),
    unexpectedImport: Boolean(extra.unexpectedImport),
    invalidLoweringAttempt: Boolean(extra.invalidLoweringAttempt),
    diagnostics: normalizeDiagnostics(diagnostics)
  });
}

function arithmeticCase(index, rng) {
  const a = nextSmall(rng);
  const b = nextSmall(rng);
  const expectedResult = a + b;
  return {
    id: caseId(index, "arithmetic"),
    family: "arithmetic",
    kind: "arithmetic",
    expected: "valid",
    expectedResult,
    source: `module fuzz_arithmetic_${index}
capabilities { }

export func run() -> i32 {
entry:
  %a:i32 = const.i32 ${a}
  %b:i32 = const.i32 ${b}
  %sum:i32 = i32.add %a, %b
  return %sum
}
`
  };
}

function invalidArithmeticCase(index) {
  return {
    id: caseId(index, "invalid_arithmetic_type"),
    family: "arithmetic",
    kind: "invalid_arithmetic_type",
    expected: "invalid",
    expectedMessage: "expected i32, got f32",
    expectedDiagnosticCodes: ["air.verifier.error"],
    source: `module fuzz_invalid_arithmetic_${index}
capabilities { }

export func run() -> i32 {
entry:
  %v:f32 = const.f32 1.0
  return %v
}
`
  };
}

function fixedStateCase(index, rng) {
  const length = 2 + (nextSmall(rng) % 5);
  const slot = nextSmall(rng) % length;
  const value = nextSmall(rng) + 10;
  return {
    id: caseId(index, "fixed_state"),
    family: "fixed_state",
    kind: "fixed_state",
    expected: "valid",
    expectedResult: value,
    source: `module fuzz_fixed_state_${index}
state board:i32[${length}] = fill 0
capabilities { }

export func run() -> i32 {
entry:
  state.set board, ${slot}, ${value}
  %v:i32 = state.get board, ${slot}
  return %v
}
`
  };
}

function outputEmitCase(index, rng) {
  const value = nextSmall(rng);
  return {
    id: caseId(index, "output_emit"),
    family: "output_emit",
    kind: "output_emit",
    expected: "valid",
    expectedResult: 0,
    imports: "output.emit",
    allowImports: true,
    source: `module fuzz_output_emit_${index}
const OUTPUT_FUZZ_EVENT:i32 = 1
capabilities { output }
effects { output.emit <= 1 }
extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32

export func run() -> i32 {
entry:
  %zero:i32 = const.i32 0
  %status:i32 = @output.emit(OUTPUT_FUZZ_EVENT, ${value}, %zero, %zero, %zero)
  return %status
}
`
  };
}

function generatedHandleCase(index, rng) {
  const value = nextSmall(rng) + 1;
  return {
    id: caseId(index, "generated_handle"),
    family: "generated_handles",
    kind: "generated_handle",
    expected: "valid",
    expectedResult: value,
    source: `module fuzz_generated_handle_${index}
const STRUCT_TASK_SUMMARY_FIELD_STATUS_ID_OFFSET:i32 = 1
capabilities { }

export func run() -> i32 {
entry:
  %base:i32 = const.i32 ${value}
  %offset:i32 = i32.add STRUCT_TASK_SUMMARY_FIELD_STATUS_ID_OFFSET, %base
  %out:i32 = i32.sub %offset, STRUCT_TASK_SUMMARY_FIELD_STATUS_ID_OFFSET
  return %out
}
`
  };
}

function invalidStateCase(index) {
  return {
    id: caseId(index, "invalid_state_oob"),
    family: "fixed_state",
    kind: "invalid_state_oob",
    expected: "invalid",
    expectedMessage: "out of bounds",
    source: `module fuzz_invalid_state_${index}
state board:i32[2] = fill 0
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = state.get board, 2
  return %v
}
`
  };
}

function invalidDynamicOutputCase(index) {
  return {
    id: caseId(index, "invalid_dynamic_output"),
    family: "output_emit",
    kind: "invalid_dynamic_output",
    expected: "invalid",
    expectedMessage: "output_id must be a statically resolvable",
    source: `module fuzz_invalid_output_${index}
capabilities { output }
effects { output.emit <= 1 }
extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32

export func run() -> i32 {
entry:
  %zero:i32 = const.i32 0
  %id:i32 = i32.add %zero, 1
  %status:i32 = @output.emit(%id, %zero, %zero, %zero, %zero)
  return %status
}
`
  };
}

function structuredIoFixtureCase(index) {
  return {
    id: caseId(index, "structured_io_fixture"),
    family: "structured_io",
    kind: "structured_io_fixture",
    expected: "valid",
    packageCase: true,
    files: structuredIoPackageFiles(validStructuredIoSchema()),
    packageDir: `build/verifier_safety_fuzz/${caseId(index, "structured_io_fixture")}`
  };
}

function structuredIoInvalidJsonCase(index) {
  return invalidStructuredIoPackageCase(index, "structured_io_invalid_json", "air.structured_io.runtime_json_rejected", {
    ...validStructuredIoSchema(),
    fields: [{ name: "payload", type: "json", privacy: "minimized" }]
  });
}

function structuredIoInvalidObjectCase(index) {
  return invalidStructuredIoPackageCase(index, "structured_io_invalid_object", "air.structured_io.object_field_rejected", {
    ...validStructuredIoSchema(),
    fields: [{ name: "task", type: "i32", privacy: "minimized", fields: [{ name: "nested", type: "i32" }] }]
  });
}

function structuredIoInvalidStringCase(index) {
  return invalidStructuredIoPackageCase(index, "structured_io_invalid_string", "air.structured_io.field_type_invalid", {
    ...validStructuredIoSchema(),
    fields: [{ name: "note", type: "string", privacy: "minimized" }]
  });
}

function structuredIoGeneratedMissingCase(index) {
  const id = caseId(index, "generated_handles_missing");
  return {
    id,
    family: "generated_handles",
    kind: "generated_handles_missing",
    expected: "invalid",
    expectedDiagnosticCodes: ["air.structured_io.generated_stale"],
    packageCase: true,
    files: structuredIoPackageFiles(validStructuredIoSchema(), { generatedModules: true }),
    packageDir: `build/verifier_safety_fuzz/${id}`
  };
}

function structuredIoGeneratedStaleCase(index) {
  const id = caseId(index, "generated_handles_stale");
  const files = structuredIoPackageFiles(validStructuredIoSchema(), { generatedModules: true });
  files["generated/structured_io_handles.air"] = "module stale_structured_io_handles\ncapabilities { }\n";
  files["generated/structured_io.meta.json"] = JSON.stringify({
    schemaVersion: "0.32",
    kind: "air.generatedStructuredIO",
    generator: "stale",
    sourceFingerprints: [],
    handlesFingerprint: "sha256:stale"
  }, null, 2) + "\n";
  return {
    id,
    family: "generated_handles",
    kind: "generated_handles_stale",
    expected: "invalid",
    expectedDiagnosticCodes: ["air.structured_io.generated_stale"],
    packageCase: true,
    files,
    packageDir: `build/verifier_safety_fuzz/${id}`
  };
}

function invalidStructuredIoPackageCase(index, kind, expectedCode, schema) {
  const id = caseId(index, kind);
  return {
    id,
    family: "structured_io",
    kind,
    expected: "invalid",
    expectedDiagnosticCodes: [expectedCode],
    packageCase: true,
    files: structuredIoPackageFiles(schema),
    packageDir: `build/verifier_safety_fuzz/${id}`
  };
}

function validStructuredIoSchema() {
  return {
    schemaVersion: "0.32",
    kind: "air.structuredRowsetSchema",
    name: "fuzz_task_summary",
    maxRows: 4,
    privacyPolicy: {
      defaultClassification: "minimized",
      forbiddenByDefault: ["raw_text", "raw_url", "token", "secret"]
    },
    fields: [
      { name: "task_id", type: "i32", privacy: "minimized", semantic: "id" },
      { name: "status_id", type: "i32", privacy: "minimized", semantic: "enum" },
      { name: "blocked", type: "bool", privacy: "public", semantic: "flag" }
    ]
  };
}

function structuredIoPackageFiles(schema, options = {}) {
  const generatedModules = options.generatedModules ? ["generated/structured_io_handles.air"] : [];
  return {
    "air.package.json": JSON.stringify({
      name: "fuzz-structured-io",
      version: "0.1.0",
      airAbi: "0.10",
      hostAbi: "0.10",
      entry: "main.air",
      capabilities: [],
      targetProfiles: ["cli"],
      generatedModules,
      structuredIO: ["schemas/fuzz.structured.rowset.json"]
    }, null, 2) + "\n",
    "main.air": `module fuzz_structured_io
capabilities { }

export func run() -> i32 {
entry:
  return 1
}
`,
    "schemas/fuzz.structured.rowset.json": JSON.stringify(schema, null, 2) + "\n"
  };
}

function materializePackageCase(testCase, workDir) {
  const dir = path.join(workDir, testCase.id);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(testCase.files || {})) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

function diagnosticCodesFromPackageReport(report) {
  const codes = [];
  for (const diagnostic of report.diagnostics || []) if (diagnostic.code) codes.push(diagnostic.code);
  for (const check of report.checks || []) if (check.code) codes.push(check.code);
  return Array.from(new Set(codes)).sort();
}

function familiesForCases(cases) {
  const byFamily = new Map();
  for (const item of cases) {
    const family = item.family || item.kind || "unknown";
    const current = byFamily.get(family) || {
      family,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      valid: 0,
      invalid: 0
    };
    current.total += 1;
    if (item.status === "pass") current.passed += 1;
    else if (item.status === "skip") current.skipped += 1;
    else current.failed += 1;
    if (item.expected === "valid") current.valid += 1;
    if (item.expected === "invalid") current.invalid += 1;
    byFamily.set(family, current);
  }
  return Array.from(byFamily.values()).sort((a, b) => a.family.localeCompare(b.family)).map(stableObject);
}

function minimizedCaseForFailure(testCase) {
  return stableObject({
    id: testCase.id,
    family: testCase.family,
    kind: testCase.kind,
    diagnosticCodes: (testCase.diagnostics || []).map((item) => item.code).filter(Boolean).sort()
  });
}

function caseId(index, kind) {
  return `${String(index + 1).padStart(4, "0")}_${kind}`;
}

function nextSmall(rng) {
  return rng() % 37;
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function diagnostic(code, severity, message, details = {}) {
  return stableObject({
    code,
    severity,
    message,
    details: stableObject(details)
  });
}

function normalizeDiagnostics(items) {
  return (items || []).map((item) => stableObject({
    code: item.code || null,
    severity: item.severity || null,
    message: item.message || null,
    details: stableObject(item.details || {})
  })).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)));
}

function sanitizeError(err) {
  return String(err && err.message || err || "unknown error")
    .replace(/[A-Za-z]:[\\/][^\s)]+/g, "<abs-path>")
    .replace(/\/[^\s)]+/g, (value) => value.includes(".air") ? path.basename(value) : "<path>");
}

function fingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function stableStringify(value) {
  return `${JSON.stringify(stableObject(value), null, 2)}\n`;
}

module.exports = {
  SAFETY_FUZZ_KIND,
  SAFETY_FUZZ_SCHEMA_VERSION,
  createVerifierSafetyFuzzReport,
  stableStringify
};
