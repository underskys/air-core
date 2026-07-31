const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const {
  checkPackageDir
} = require("./sdk");
const {
  validatePackageManifest
} = require("./package_manifest");
const {
  validateVerifiedResourceCertificate,
  verifyModule
} = require("./verifier");
const { lowerToWat, watToWasm } = require("./lower_wasm");

const RUN_PACKAGE_SCHEMA_VERSION = "0.49";
const RUN_PACKAGE_KIND = "air.embeddingRunResult";
const RUN_EVIDENCE_KIND = "air.embeddingRunEvidence";
const HASH_DOMAIN = "AIR_EMBEDDING_RUN_V1";
const STABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const FORBIDDEN_AUTHORITY_KEY_RE = /(?:credential|password|secret|token|api.?key|filesystem|network|process|environment|spawn)/i;
const PACKAGE_KEYS = new Set([
  "directory",
  "profile",
  "entrypoint",
  "requiredGrant",
  "arguments"
]);
const REQUEST_KEYS = new Set([
  "package",
  "facts",
  "grants",
  "limits",
  "adapters"
]);
const GRANT_KEYS = new Set([
  "id",
  "decision",
  "capability",
  "effects",
  "targetId",
  "maxAmount",
  "quotaLimit",
  "rateLimit",
  "expiresAt",
  "redaction"
]);
const LIMIT_KEYS = new Set([
  "maxAmount",
  "quotaLimit",
  "rateLimit",
  "now",
  "maxOutputs",
  "maxHostCalls"
]);
const REQUIRED_LIMIT_KEYS = Array.from(LIMIT_KEYS).sort();
const ARGUMENT_SOURCES = new Set(["facts", "grant", "limits", "effective", "literal"]);

async function run(request = {}) {
  const diagnostics = [];
  let descriptor = null;
  let packageReport = null;
  let resourceCertificate = null;

  try {
    requirePlainObject(request, "request");
    rejectUnknownKeys(request, REQUEST_KEYS, "request");
    descriptor = normalizePackageDescriptor(request.package);
  } catch (err) {
    diagnostics.push(runDiagnostic("air.run.request_invalid", "fail", safeMessage(err)));
    return finalizeRunResult({
      decision: denyDecision("request_invalid"),
      diagnostics,
      execution: executionRecord("not_run"),
      resourceCertificate
    });
  }

  try {
    packageReport = checkPackageDir(descriptor.directory, {
      profile: descriptor.profile,
      built: false,
      certificateRequired: true
    });
    resourceCertificate = packageReport.resourceCertificate || null;
  } catch (err) {
    diagnostics.push(runDiagnostic(
      "air.run.package_verification_failed",
      "fail",
      "package verification did not complete",
      { error: safeMessage(err, descriptor.directory) }
    ));
    return finalizeRunResult({
      descriptor,
      decision: denyDecision("package_verification_failed"),
      diagnostics,
      execution: executionRecord("not_run"),
      resourceCertificate
    });
  }

  if (packageReport.status === "fail") {
    diagnostics.push(runDiagnostic(
      "air.run.package_verification_failed",
      "fail",
      "package verification failed before execution",
      {
        diagnosticCodes: sortedStrings((packageReport.diagnostics || [])
          .filter((item) => item.severity === "fail")
          .map((item) => item.code))
      }
    ));
  }
  if (!resourceCertificate) {
    diagnostics.push(runDiagnostic(
      "air.run.resource_certificate_missing",
      "fail",
      "verified resource certificate is required before execution"
    ));
  } else {
    const validation = validateVerifiedResourceCertificate(resourceCertificate, {
      required: true,
      packageName: resourceCertificate.package && resourceCertificate.package.name,
      packageDigest: resourceCertificate.package && resourceCertificate.package.digest
    });
    for (const item of validation.diagnostics || []) {
      diagnostics.push(runDiagnostic(
        item.code || "air.run.resource_certificate_invalid",
        "fail",
        item.message || "resource certificate validation failed",
        item.fields || {}
      ));
    }
  }
  if (hasFailure(diagnostics)) {
    return finalizeRunResult({
      descriptor,
      packageReport,
      decision: denyDecision("verification_failed"),
      diagnostics,
      execution: executionRecord("not_run"),
      resourceCertificate
    });
  }

  let facts;
  let grants;
  let limits;
  let adapters;
  try {
    facts = normalizeFacts(request.facts);
    grants = normalizeGrants(request.grants);
    limits = normalizeLimits(request.limits);
    adapters = normalizeAdapters(request.adapters);
  } catch (err) {
    diagnostics.push(runDiagnostic("air.run.input_invalid", "fail", safeMessage(err)));
    return finalizeRunResult({
      descriptor,
      packageReport,
      facts,
      grants,
      limits,
      adapters,
      decision: denyDecision("input_invalid"),
      diagnostics,
      execution: executionRecord("not_run"),
      resourceCertificate
    });
  }

  const grant = grants.find((item) => item.id === descriptor.requiredGrant) || null;
  let preflight;
  try {
    preflight = validatePreflight({
      descriptor,
      packageReport,
      resourceCertificate,
      facts,
      grants,
      grant,
      limits,
      adapters
    });
  } catch (err) {
    diagnostics.push(runDiagnostic("air.run.input_invalid", "fail", safeMessage(err)));
    return finalizeRunResult({
      descriptor,
      packageReport,
      facts,
      grants,
      limits,
      adapters,
      decision: denyDecision("input_invalid"),
      diagnostics,
      execution: executionRecord("not_run"),
      resourceCertificate
    });
  }
  diagnostics.push(...preflight.diagnostics);
  if (preflight.decision) {
    return finalizeRunResult({
      descriptor,
      packageReport,
      facts,
      grants,
      limits,
      adapters,
      decision: preflight.decision,
      diagnostics,
      execution: executionRecord("not_run"),
      resourceCertificate
    });
  }

  try {
    const loaded = loadExecutableModule(descriptor, packageReport);
    const args = resolveArguments(descriptor.arguments, {
      facts,
      grant,
      grants,
      limits,
      effective: preflight.effective
    });
    validateEntrypoint(loaded.mod, descriptor.entrypoint, args);
    const capture = createExplicitImports({
      mod: loaded.mod,
      adapters,
      grant,
      limits,
      packageReport
    });
    const wat = lowerToWat(loaded.mod);
    const wasm = await watToWasm(wat, loaded.entryPath);
    const instantiated = await WebAssembly.instantiate(wasm, capture.imports);
    const instance = instantiated.instance || instantiated;
    const entrypoint = instance.exports[descriptor.entrypoint];
    if (typeof entrypoint !== "function") {
      throw new Error(`export ${descriptor.entrypoint} is not executable`);
    }
    const rawDecision = entrypoint(...args);
    const decisionCode = Number(rawDecision);
    if (decisionCode !== 0 && decisionCode !== 1) {
      diagnostics.push(runDiagnostic(
        "air.run.decision_invalid",
        "fail",
        "AIR entrypoint must return decision code 0 or 1",
        { actual: Number.isFinite(decisionCode) ? decisionCode : null }
      ));
    }
    if (decisionCode === 0 && capture.records.length) {
      diagnostics.push(runDiagnostic(
        "air.run.output_decision_mismatch",
        "fail",
        "denied AIR decision emitted an output intent"
      ));
    }
    if (decisionCode === 1 && packageReport.hostImports.used.includes("output.emit") && capture.records.length === 0) {
      diagnostics.push(runDiagnostic(
        "air.run.output_decision_mismatch",
        "fail",
        "allowed AIR decision did not emit its declared output intent"
      ));
    }
    if (hasFailure(diagnostics)) {
      return finalizeRunResult({
        descriptor,
        packageReport,
        facts,
        grants,
        limits,
        adapters,
        decision: denyDecision("execution_result_invalid"),
        diagnostics,
        execution: executionRecord("failed", descriptor.entrypoint, args),
        outputs: [],
        resourceCertificate
      });
    }
    const outputs = capture.records.map((record) => normalizeCapturedOutput(record, packageReport));
    const decision = decisionCode === 1
      ? allowDecision()
      : denyDecision("air_denied");
    return finalizeRunResult({
      descriptor,
      packageReport,
      facts,
      grants,
      limits,
      adapters,
      decision,
      diagnostics,
      execution: executionRecord("executed", descriptor.entrypoint, args, decisionCode),
      outputs,
      resourceCertificate
    });
  } catch (err) {
    diagnostics.push(runDiagnostic(
      "air.run.execution_failed",
      "fail",
      "verified package execution failed closed",
      { error: safeMessage(err, descriptor.directory) }
    ));
    return finalizeRunResult({
      descriptor,
      packageReport,
      facts,
      grants,
      limits,
      adapters,
      decision: denyDecision("execution_failed"),
      diagnostics,
      execution: executionRecord("failed", descriptor.entrypoint),
      resourceCertificate
    });
  }
}

const runPackage = run;

function validatePreflight(input) {
  const diagnostics = [];
  const {
    descriptor,
    packageReport,
    resourceCertificate,
    facts,
    grants,
    grant,
    limits,
    adapters
  } = input;

  if (!grant) {
    diagnostics.push(runDiagnostic(
      "air.run.grant_missing",
      "fail",
      "required explicit grant is missing",
      { grantId: descriptor.requiredGrant }
    ));
    return { diagnostics, decision: denyDecision("grant_missing"), effective: null };
  }
  if (grant.decision !== "allow") {
    diagnostics.push(runDiagnostic(
      "air.run.grant_denied",
      "warn",
      "explicit grant denies this operation",
      { grantId: grant.id }
    ));
    return { diagnostics, decision: denyDecision("explicit_denial"), effective: null };
  }

  const requiredCapabilities = sortedStrings(packageReport.capabilities && packageReport.capabilities.required);
  if (requiredCapabilities.some((capability) => capability !== grant.capability)) {
    diagnostics.push(runDiagnostic(
      "air.run.capability_mismatch",
      "fail",
      "grant does not cover every package capability",
      { grantCapability: grant.capability, requiredCapabilities }
    ));
  }
  const usedImports = sortedStrings(packageReport.hostImports && packageReport.hostImports.used);
  const missingEffects = usedImports.filter((name) => !grant.effects.includes(name));
  if (missingEffects.length) {
    diagnostics.push(runDiagnostic(
      "air.run.effect_grant_mismatch",
      "fail",
      "grant does not cover every verifier-visible host effect",
      { missingEffects }
    ));
  }
  const missingAdapters = usedImports.filter((name) => adapters[name] !== "capture");
  if (missingAdapters.length) {
    diagnostics.push(runDiagnostic(
      "air.run.adapter_missing",
      "fail",
      "every host import requires an explicit supported adapter",
      { missingAdapters }
    ));
  }
  const unusedAdapters = Object.keys(adapters).filter((name) => !usedImports.includes(name));
  if (unusedAdapters.length) {
    diagnostics.push(runDiagnostic(
      "air.run.adapter_not_declared",
      "fail",
      "adapter was supplied for an import not declared by the verified package",
      { unusedAdapters: unusedAdapters.sort() }
    ));
  }
  if (usedImports.some((name) => name !== "output.emit")) {
    diagnostics.push(runDiagnostic(
      "air.run.adapter_unsupported",
      "fail",
      "the bounded embedding facade supports only explicit output.emit capture",
      { unsupportedImports: usedImports.filter((name) => name !== "output.emit") }
    ));
  }

  const bounds = resourceCertificate.bounds || {};
  const hostCallUpperBound = bounds.hostCalls && bounds.hostCalls.totalUpperBound || 0;
  const outputUpperBound = bounds.outputs && bounds.outputs.totalHostCallUpperBound || 0;
  if (hostCallUpperBound > limits.maxHostCalls) {
    diagnostics.push(runDiagnostic(
      "air.run.resource_limit_exceeded",
      "fail",
      "certified host-call upper bound exceeds the supplied limit",
      { certified: hostCallUpperBound, limit: limits.maxHostCalls, resource: "hostCalls" }
    ));
  }
  if (outputUpperBound > limits.maxOutputs) {
    diagnostics.push(runDiagnostic(
      "air.run.resource_limit_exceeded",
      "fail",
      "certified output upper bound exceeds the supplied limit",
      { certified: outputUpperBound, limit: limits.maxOutputs, resource: "outputs" }
    ));
  }
  if (hasFailure(diagnostics)) {
    return { diagnostics, decision: denyDecision("authority_mismatch"), effective: null };
  }

  const amount = requiredFactInt(facts, "amount");
  const quotaUsed = requiredFactInt(facts, "quotaUsed");
  const rateUsed = requiredFactInt(facts, "rateUsed");
  const targetId = requiredFactInt(facts, "targetId");
  const requiresRedaction = requiredFactBool(facts, "requiresRedaction");
  const effective = stableObject({
    amountLimit: Math.min(grant.maxAmount, limits.maxAmount),
    quotaLimit: Math.min(grant.quotaLimit, limits.quotaLimit),
    rateLimit: Math.min(grant.rateLimit, limits.rateLimit),
    allowedTargetId: grant.targetId,
    expiresAt: grant.expiresAt,
    now: limits.now,
    redactionFlag: grant.redaction === "required" ? 1 : 0
  });

  if (amount > effective.amountLimit) {
    diagnostics.push(runDiagnostic(
      "air.run.amount_limit_exceeded",
      "warn",
      "requested amount exceeds the effective bound",
      { amount, limit: effective.amountLimit }
    ));
    return { diagnostics, decision: denyDecision("amount_limit"), effective };
  }
  if (quotaUsed >= effective.quotaLimit) {
    diagnostics.push(runDiagnostic(
      "air.run.quota_limit_exceeded",
      "warn",
      "quota is exhausted",
      { limit: effective.quotaLimit, used: quotaUsed }
    ));
    return { diagnostics, decision: denyDecision("quota_limit"), effective };
  }
  if (rateUsed >= effective.rateLimit) {
    diagnostics.push(runDiagnostic(
      "air.run.rate_limit_exceeded",
      "warn",
      "rate limit is exhausted",
      { limit: effective.rateLimit, used: rateUsed }
    ));
    return { diagnostics, decision: denyDecision("rate_limit"), effective };
  }
  if (targetId !== effective.allowedTargetId) {
    diagnostics.push(runDiagnostic(
      "air.run.target_denied",
      "warn",
      "requested target is not the explicitly granted target",
      { requestedTargetId: targetId }
    ));
    return { diagnostics, decision: denyDecision("forbidden_target"), effective };
  }
  if (effective.now > effective.expiresAt) {
    diagnostics.push(runDiagnostic(
      "air.run.grant_expired",
      "warn",
      "explicit grant is expired at the supplied logical time"
    ));
    return { diagnostics, decision: denyDecision("expired_grant"), effective };
  }
  if (requiresRedaction && effective.redactionFlag !== 1) {
    diagnostics.push(runDiagnostic(
      "air.run.redaction_required",
      "warn",
      "sensitive output requires an explicit redaction grant"
    ));
    return { diagnostics, decision: denyDecision("redaction_required"), effective };
  }
  return { diagnostics, decision: null, effective };
}

function loadExecutableModule(descriptor, packageReport) {
  if ((packageReport.modules || []).length !== 1) {
    throw new Error("bounded facade requires one verified source module");
  }
  const manifest = validatePackageManifest(descriptor.directory, { built: false });
  const entryRelative = normalizeRelativeFile(manifest.entry, "package entry");
  const entryPath = path.resolve(descriptor.directory, entryRelative);
  if (!isInside(descriptor.directory, entryPath)) {
    throw new Error("package entry escapes the explicit package directory");
  }
  const source = fs.readFileSync(entryPath, "utf8");
  const mod = parseAir(source, entryRelative, { resolveSourceImports: false });
  verifyModule(mod);
  return { entryPath: entryRelative, mod };
}

function validateEntrypoint(mod, name, args) {
  const fn = (mod.functions || []).find((item) => item.name === name && item.exported);
  if (!fn) throw new Error(`missing exported entrypoint ${name}`);
  if (fn.returnType !== "i32") throw new Error("embedding entrypoint must return i32 decision code");
  if ((fn.params || []).length !== args.length) throw new Error("embedding argument count does not match entrypoint");
  for (const param of fn.params || []) {
    if (param.type !== "i32") throw new Error("embedding v1 supports i32 entrypoint parameters only");
  }
}

function createExplicitImports({ mod, adapters, grant, limits, packageReport }) {
  const records = [];
  const imports = {};
  const contracts = outputContractMap(packageReport);
  for (const external of mod.externs || []) {
    if (external.name !== "output.emit" || adapters[external.name] !== "capture") {
      throw new Error(`unsupported or missing explicit adapter for ${external.name}`);
    }
    if (!imports.output) imports.output = {};
    imports.output.emit = (outputId, arg0, arg1, arg2, arg3) => {
      if (!grant.effects.includes("output.emit")) throw new Error("output.emit grant was revoked");
      if (!contracts.has(outputId)) throw new Error(`undeclared output id ${outputId}`);
      if (records.length >= limits.maxOutputs) throw new Error("runtime output limit exceeded");
      records.push(stableObject({
        outputId,
        args: [arg0, arg1, arg2, arg3]
      }));
      return 0;
    };
  }
  return { imports, records };
}

function normalizeCapturedOutput(record, packageReport) {
  const contract = outputContractMap(packageReport).get(record.outputId);
  const args = record.args || [];
  const redactionApplied = args[2] === 1;
  return stableObject({
    kind: "air.outputIntent",
    outputId: record.outputId,
    name: contract && contract.name || null,
    channel: contract && contract.channel || null,
    capability: contract && contract.capability || null,
    targetId: args[0],
    amount: args[1],
    redactionApplied,
    display: redactionApplied ? "[REDACTED]" : "not_provided",
    scalarArgs: args
  });
}

function outputContractMap(packageReport) {
  const out = new Map();
  for (const schema of packageReport.outputContracts && packageReport.outputContracts.schemas || []) {
    if (!schema.ok) continue;
    for (const output of schema.outputs || []) out.set(output.id, output);
  }
  return out;
}

function resolveArguments(argumentsList, sources) {
  return argumentsList.map((argument) => {
    if (argument.from === "literal") return argument.value;
    const owner = sources[argument.from];
    if (!owner || !Object.prototype.hasOwnProperty.call(owner, argument.key)) {
      throw new Error(`missing ${argument.from}.${argument.key} embedding argument`);
    }
    const value = owner[argument.key];
    if (typeof value === "boolean") return value ? 1 : 0;
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${argument.from}.${argument.key} must resolve to a safe integer`);
    }
    return value;
  });
}

function normalizePackageDescriptor(value) {
  requirePlainObject(value, "package");
  rejectUnknownKeys(value, PACKAGE_KEYS, "package");
  if (typeof value.directory !== "string" || !path.isAbsolute(value.directory)) {
    throw new Error("package.directory must be an absolute explicitly supplied path");
  }
  const directory = path.resolve(value.directory);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error("package.directory does not exist");
  }
  const profile = stableName(value.profile, "package.profile");
  const entrypoint = stableName(value.entrypoint, "package.entrypoint");
  const requiredGrant = stableName(value.requiredGrant, "package.requiredGrant");
  if (!Array.isArray(value.arguments) || value.arguments.length > 32) {
    throw new Error("package.arguments must be an array of at most 32 bounded arguments");
  }
  const args = value.arguments.map((item, index) => normalizeArgument(item, index));
  return {
    directory,
    profile,
    entrypoint,
    requiredGrant,
    arguments: args
  };
}

function normalizeArgument(value, index) {
  requirePlainObject(value, `package.arguments[${index}]`);
  rejectUnknownKeys(value, new Set(["from", "key", "value"]), `package.arguments[${index}]`);
  if (!ARGUMENT_SOURCES.has(value.from)) {
    throw new Error(`package.arguments[${index}].from is unsupported`);
  }
  if (value.from === "literal") {
    if (!Number.isSafeInteger(value.value)) {
      throw new Error(`package.arguments[${index}].value must be a safe integer`);
    }
    return { from: "literal", value: value.value };
  }
  return {
    from: value.from,
    key: stableName(value.key, `package.arguments[${index}].key`)
  };
}

function normalizeFacts(value) {
  requirePlainObject(value, "facts");
  rejectForbiddenAuthorityKeys(value, "facts");
  const facts = {};
  for (const key of Object.keys(value).sort()) {
    stableName(key, `facts.${key}`);
    const item = value[key];
    if (!(item === null || typeof item === "boolean" || Number.isSafeInteger(item) || isStableFactString(item))) {
      throw new Error(`facts.${key} must be a bounded JSON scalar`);
    }
    facts[key] = item;
  }
  return facts;
}

function normalizeGrants(value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("grants must be an array of at most 32 explicit grants");
  }
  const seen = new Set();
  const grants = value.map((item, index) => {
    requirePlainObject(item, `grants[${index}]`);
    rejectUnknownKeys(item, GRANT_KEYS, `grants[${index}]`);
    rejectForbiddenAuthorityKeys(item, `grants[${index}]`);
    const id = stableName(item.id, `grants[${index}].id`);
    if (seen.has(id)) throw new Error(`duplicate grant id ${id}`);
    seen.add(id);
    const decision = item.decision;
    if (!["allow", "deny"].includes(decision)) throw new Error(`grants[${index}].decision must be allow or deny`);
    const effects = normalizeStableNames(item.effects, `grants[${index}].effects`);
    const redaction = item.redaction || "none";
    if (!["none", "required"].includes(redaction)) {
      throw new Error(`grants[${index}].redaction must be none or required`);
    }
    return {
      id,
      decision,
      capability: stableName(item.capability, `grants[${index}].capability`),
      effects,
      targetId: nonNegativeInt(item.targetId, `grants[${index}].targetId`),
      maxAmount: nonNegativeInt(item.maxAmount, `grants[${index}].maxAmount`),
      quotaLimit: positiveInt(item.quotaLimit, `grants[${index}].quotaLimit`),
      rateLimit: positiveInt(item.rateLimit, `grants[${index}].rateLimit`),
      expiresAt: nonNegativeInt(item.expiresAt, `grants[${index}].expiresAt`),
      redaction
    };
  });
  return grants.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeLimits(value) {
  requirePlainObject(value, "limits");
  rejectUnknownKeys(value, LIMIT_KEYS, "limits");
  for (const key of REQUIRED_LIMIT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`limits.${key} is required`);
  }
  return {
    maxAmount: nonNegativeInt(value.maxAmount, "limits.maxAmount"),
    quotaLimit: positiveInt(value.quotaLimit, "limits.quotaLimit"),
    rateLimit: positiveInt(value.rateLimit, "limits.rateLimit"),
    now: nonNegativeInt(value.now, "limits.now"),
    maxOutputs: positiveInt(value.maxOutputs, "limits.maxOutputs"),
    maxHostCalls: positiveInt(value.maxHostCalls, "limits.maxHostCalls")
  };
}

function normalizeAdapters(value) {
  requirePlainObject(value, "adapters");
  const adapters = {};
  for (const key of Object.keys(value).sort()) {
    stableName(key, `adapters.${key}`);
    if (value[key] !== "capture") throw new Error(`adapters.${key} must select the bounded capture adapter`);
    adapters[key] = "capture";
  }
  return adapters;
}

function requiredFactInt(facts, key) {
  if (!Number.isSafeInteger(facts[key]) || facts[key] < 0) {
    throw new Error(`facts.${key} must be a non-negative safe integer`);
  }
  return facts[key];
}

function requiredFactBool(facts, key) {
  if (typeof facts[key] !== "boolean") throw new Error(`facts.${key} must be boolean`);
  return facts[key];
}

function finalizeRunResult(input) {
  const diagnostics = sortRunDiagnostics(input.diagnostics || []);
  const outputs = (input.outputs || []).map(stableObject);
  const decision = stableObject(input.decision || denyDecision("failed_closed"));
  const descriptor = input.descriptor || null;
  const facts = input.facts || null;
  const grants = input.grants || null;
  const limits = input.limits || null;
  const adapters = input.adapters || null;
  const certificate = input.resourceCertificate || null;
  const packageBinding = descriptor && certificate
    ? stableObject({
      name: certificate.package && certificate.package.name || null,
      packageDigest: certificate.package && certificate.package.digest || null,
      descriptorDigest: hashStable(publicPackageDescriptor(descriptor))
    })
    : null;
  const bindings = stableObject({
    package: packageBinding,
    factsDigest: facts ? hashStable(facts) : null,
    grantsDigest: grants ? hashStable(grants) : null,
    adaptersDigest: adapters ? hashStable(adapters) : null,
    limitsDigest: limits ? hashStable(limits) : null,
    outputsDigest: hashStable(outputs),
    certificateDigest: certificate && certificate.certificateDigest || null
  });
  const bindingDigest = hashStable(bindings);
  const evidencePayload = stableObject({
    schemaVersion: RUN_PACKAGE_SCHEMA_VERSION,
    kind: RUN_EVIDENCE_KIND,
    status: hasFailure(diagnostics) ? "failed" : decision.status === "allow" ? "passed" : "denied",
    decision,
    execution: input.execution || executionRecord("not_run"),
    bindings,
    bindingDigest,
    diagnostics
  });
  const evidence = stableObject({
    ...evidencePayload,
    replayDigest: hashStable(evidencePayload)
  });
  return stableObject({
    schemaVersion: RUN_PACKAGE_SCHEMA_VERSION,
    kind: RUN_PACKAGE_KIND,
    decision,
    outputs,
    evidence,
    resourceCertificate: certificate,
    diagnostics
  });
}

function publicPackageDescriptor(descriptor) {
  return stableObject({
    profile: descriptor.profile,
    entrypoint: descriptor.entrypoint,
    requiredGrant: descriptor.requiredGrant,
    arguments: descriptor.arguments
  });
}

function executionRecord(status, entrypoint = null, args = [], returnCode = null) {
  return stableObject({
    status,
    entrypoint,
    argumentDigest: args && args.length ? hashStable(args) : null,
    returnCode
  });
}

function allowDecision() {
  return { status: "allow", code: 1, reasonCode: "allowed" };
}

function denyDecision(reasonCode) {
  return { status: "deny", code: 0, reasonCode };
}

function runDiagnostic(code, severity, message, fields = {}) {
  return stableObject({
    code,
    severity,
    source: "embedding-facade",
    message,
    fields
  });
}

function sortRunDiagnostics(value) {
  return value.map(stableObject).sort((a, b) =>
    a.code.localeCompare(b.code) ||
    a.severity.localeCompare(b.severity) ||
    a.message.localeCompare(b.message));
}

function hasFailure(diagnostics) {
  return diagnostics.some((item) => item.severity === "fail");
}

function normalizeStableNames(value, field) {
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${field} must be an array of at most 32 names`);
  return sortedStrings(value.map((item, index) => stableName(item, `${field}[${index}]`)));
}

function stableName(value, field) {
  if (typeof value !== "string" || !STABLE_NAME_RE.test(value)) {
    throw new Error(`${field} must be a stable identifier`);
  }
  return value;
}

function isStableFactString(value) {
  return typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9_.:@/-]*$/.test(value);
}

function rejectUnknownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) throw new Error(`${field} contains unsupported field ${unknown[0]}`);
}

function rejectForbiddenAuthorityKeys(value, field) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_AUTHORITY_KEY_RE.test(key)) {
      throw new Error(`${field}.${key} contains forbidden ambient authority material`);
    }
  }
}

function requirePlainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${field} must be a plain object`);
  }
}

function nonNegativeInt(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
}

function positiveInt(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`);
  return value;
}

function normalizeRelativeFile(value, field) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) throw new Error(`${field} must be relative`);
  const normalized = value.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => part === "..")) throw new Error(`${field} escapes package`);
  return normalized;
}

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeMessage(err, base = null) {
  let message = err && err.message ? err.message : String(err);
  if (base) message = message.split(base).join("<package>");
  return message.replace(/\/private\/tmp\/[A-Za-z0-9_./-]+/g, "<temporary>");
}

function sortedStrings(value) {
  return Array.from(new Set((value || []).filter((item) => typeof item === "string" && item))).sort();
}

function hashStable(value) {
  const hash = crypto.createHash("sha256");
  hash.update(`${HASH_DOMAIN}\0`, "utf8");
  hash.update(stableStringify(value), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

module.exports = {
  RUN_EVIDENCE_KIND,
  RUN_PACKAGE_KIND,
  RUN_PACKAGE_SCHEMA_VERSION,
  run,
  runPackage,
  stableRunStringify: stableStringify
};
