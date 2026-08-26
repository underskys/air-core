const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { inspectAirpkg, stableStringify } = require("./airpkg");
const { loadHostProfile } = require("./host_profiles");
const { normalizeDiagnostic, sortDiagnostics } = require("./diagnostics");
const { validateVerifiedResourceCertificate } = require("./verifier");
const { isCandidateAbi012 } = require("./typed_interface");

const BUNDLE_SCHEMA_VERSION = "0.17";
const BUNDLE_KIND = "air.targetBundle";
const BUNDLE_VALIDATION_KIND = "air.targetBundle.validation";
const TARGETS = new Set(["native-dev", "web-dev"]);
const FORBIDDEN_RUNTIME_REQUIREMENTS = [
  "build scripts",
  "codex",
  "node",
  "npm install",
  "python",
  "source air repo"
];

function createTargetBundle(airpkgInput, outDir, options = {}) {
  const target = options.target;
  if (!TARGETS.has(target)) throw new Error(`unsupported bundle target: ${target || "<missing>"}`);
  if (!outDir) throw new Error("missing output directory");

  const airpkgPath = resolveAirpkgInput(airpkgInput);
  const airpkgDir = path.dirname(airpkgPath);
  const artifact = inspectAirpkg(airpkgPath);
  if (isCandidateAbi012(artifact?.abi?.airAbiRequired)) {
    throw new Error("air.bundle.candidate_unsupported: AIR ABI 0.12 candidate artifacts require the unpacked reference checker");
  }
  const profileId = artifact.hostProfiles?.checked || defaultProfileForTarget(target);
  const profile = loadHostProfile(profileId);
  const output = path.resolve(outDir);
  fs.mkdirSync(output, { recursive: true });

  const airpkgBundlePath = path.join(output, "airpkg.json");
  fs.copyFileSync(airpkgPath, airpkgBundlePath);

  const profileText = `${stableStringify(profile)}\n`;
  const profilePath = path.join(output, "host_profile.json");
  fs.writeFileSync(profilePath, profileText);

  const linkedOutput = copyLinkedOutput(artifact, airpkgDir, output);
  const certificate = copyResourceCertificate(options.resourceCertificate || artifact.resourceCertificate, output);
  const bundleInput = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    kind: BUNDLE_KIND,
    target,
    package: {
      name: artifact.package?.name || null,
      version: artifact.package?.version || null,
      airpkg: {
        path: "airpkg.json",
        hash: fileFingerprint(airpkgBundlePath)
      }
    },
    abi: {
      airAbiRequired: artifact.abi?.airAbiRequired || null,
      hostAbiRequired: artifact.abi?.hostAbiRequired || null
    },
    hostProfile: {
      id: profile.id,
      path: "host_profile.json",
      hash: hashBytes(profileText)
    },
    linkedOutput,
    resources: certificate ? [certificate.resource] : [],
    boundary: {
      runtimeRequires: [],
      buildTimeOnly: [],
      forbiddenAtRuntime: [
        "Codex",
        "Node",
        "Python",
        "build scripts",
        "npm install",
        "source AIR repo"
      ]
    }
  };
  if (certificate) {
    bundleInput.resourceCertificate = {
      path: certificate.resource.path,
      hash: certificate.resource.hash,
      certificateDigest: certificate.certificate.certificateDigest,
      packageDigest: certificate.certificate.package && certificate.certificate.package.digest || null,
      bindingDigest: resourceCertificateBindingDigest(
        fileFingerprint(airpkgBundlePath),
        certificate.certificate.package && certificate.certificate.package.digest,
        certificate.certificate.certificateDigest
      )
    };
  }
  const bundle = stableObject(bundleInput);

  assertNoAbsolutePaths(bundle);
  fs.writeFileSync(path.join(output, "bundle.json"), `${stableStringify(bundle)}\n`);
  fs.writeFileSync(path.join(output, "README.md"), readmeForBundle(target));
  return bundle;
}

function checkTargetBundle(input) {
  const bundleDir = path.resolve(input);
  const diagnostics = [];
  const checks = [];
  const bundlePath = path.join(bundleDir, "bundle.json");
  let bundle = null;

  if (!fs.existsSync(bundlePath) || !fs.statSync(bundlePath).isFile()) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", "bundle.json is required", {
      field: "bundle.json",
      repairHint: "provide a target bundle directory created by airc bundle"
    });
    return finalizeBundleValidation(input, bundle, diagnostics, checks);
  }

  try {
    bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    addCheck(checks, "json-parse", "pass", "bundle JSON parses");
  } catch (err) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", `bundle JSON does not parse: ${err.message}`, {
      field: "bundle.json",
      repairHint: "regenerate the bundle or fix invalid JSON"
    });
    return finalizeBundleValidation(input, bundle, diagnostics, checks);
  }

  validateBundleSchema(bundle, diagnostics, checks);
  validateNoAbsolutePaths(bundle, diagnostics, checks);
  validateNoTimestampFields(bundle, diagnostics, checks);
  validateRuntimeBoundary(bundle, diagnostics, checks);
  validateBundleFiles(bundle, bundleDir, diagnostics, checks);

  return finalizeBundleValidation(input, bundle, diagnostics, checks);
}

function copyLinkedOutput(artifact, airpkgDir, outDir) {
  const linked = artifact.linkedOutput || {};
  const status = linked.status || "deferred";
  const kind = linked.kind || "none";
  if (status !== "available" || !linked.path) {
    return {
      status,
      kind,
      path: null,
      hash: linked.hash || null
    };
  }
  const rel = normalizeRelative(linked.path);
  if (unsafeRelative(rel)) throw new Error(`linked output path must be artifact-relative: ${linked.path}`);
  const source = path.join(airpkgDir, rel);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`linked output does not exist: ${rel}`);
  const ext = kind === "wat" ? "wat" : "wasm";
  const destRel = `linked.${ext}`;
  const dest = path.join(outDir, destRel);
  fs.copyFileSync(source, dest);
  return {
    status: "available",
    kind,
    path: destRel,
    hash: fileFingerprint(dest)
  };
}

function validateBundleSchema(bundle, diagnostics, checks) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", "bundle.json must contain a JSON object", {
      field: "$",
      repairHint: "regenerate the bundle"
    });
    return;
  }
  if (bundle.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", `unsupported bundle schemaVersion ${JSON.stringify(bundle.schemaVersion)}; expected ${BUNDLE_SCHEMA_VERSION}`, {
      field: "schemaVersion",
      expected: BUNDLE_SCHEMA_VERSION,
      actual: bundle.schemaVersion,
      repairHint: "regenerate the bundle with compatible tooling"
    });
  } else {
    addCheck(checks, "schema-version", "pass", `schemaVersion ${BUNDLE_SCHEMA_VERSION} is supported`);
  }
  if (bundle.kind !== BUNDLE_KIND) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", "bundle kind must be air.targetBundle", {
      field: "kind",
      expected: BUNDLE_KIND,
      actual: bundle.kind,
      repairHint: "provide an AIR target bundle"
    });
  } else {
    addCheck(checks, "kind", "pass", "bundle kind is air.targetBundle");
  }
  if (!TARGETS.has(bundle.target)) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", "bundle target is invalid", {
      field: "target",
      actual: bundle.target,
      repairHint: "use target web-dev or native-dev"
    });
  }
}

function validateBundleFiles(bundle, bundleDir, diagnostics, checks) {
  validateHashedFile(bundleDir, bundle?.package?.airpkg, "package.airpkg", diagnostics, checks);
  validateHashedFile(bundleDir, bundle?.hostProfile, "hostProfile", diagnostics, checks);
  if (bundle?.linkedOutput?.status === "available") {
    validateHashedFile(bundleDir, bundle.linkedOutput, "linkedOutput", diagnostics, checks);
  }
  for (const resource of bundle?.resources || []) {
    validateHashedFile(bundleDir, resource, `resource:${resource.path || "<missing>"}`, diagnostics, checks);
  }
  validateResourceCertificateFile(bundle, bundleDir, diagnostics, checks);
}

function copyResourceCertificate(input, outDir) {
  if (!input) return null;
  let certificate = input;
  if (typeof input === "string") certificate = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  const validation = validateVerifiedResourceCertificate(certificate);
  if (!validation.ok) {
    throw new Error(`invalid resource certificate: ${validation.diagnostics.map((item) => item.code).join(", ")}`);
  }
  const text = `${stableStringify(certificate)}\n`;
  const relative = "resource_certificate.json";
  const target = path.join(outDir, relative);
  fs.writeFileSync(target, text);
  return {
    certificate,
    resource: {
      kind: "verified-resource-certificate",
      path: relative,
      hash: hashBytes(text)
    }
  };
}

function validateResourceCertificateFile(bundle, bundleDir, diagnostics, checks) {
  const metadata = bundle && bundle.resourceCertificate;
  if (!metadata) return;
  const relative = normalizeRelative(metadata.path);
  if (unsafeRelative(relative)) return;
  const file = path.join(bundleDir, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  let certificate;
  try {
    certificate = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    addBundleDiagnostic(diagnostics, checks, "air.resource_certificate.invalid", `resource certificate JSON does not parse: ${err.message}`, {
      field: "resourceCertificate.path",
      path: relative,
      repairHint: "regenerate the target bundle from a valid certificate"
    });
    return;
  }
  const validation = validateVerifiedResourceCertificate(certificate, {
    packageName: bundle.package && bundle.package.name,
    packageDigest: metadata.packageDigest,
    certificateDigest: metadata.certificateDigest
  });
  for (const diagnostic of validation.diagnostics) {
    addBundleDiagnostic(diagnostics, checks, diagnostic.code, diagnostic.message, {
      field: diagnostic.fields && diagnostic.fields.field || "resourceCertificate",
      path: relative,
      expected: diagnostic.fields && diagnostic.fields.expected,
      actual: diagnostic.fields && diagnostic.fields.actual,
      repairHint: "regenerate the bundle from the exact package certificate"
    });
  }
  const expectedBinding = resourceCertificateBindingDigest(
    bundle.package && bundle.package.airpkg && bundle.package.airpkg.hash,
    certificate.package && certificate.package.digest,
    certificate.certificateDigest
  );
  if (metadata.bindingDigest !== expectedBinding) {
    addBundleDiagnostic(diagnostics, checks, "air.resource_certificate.package_substitution", "resource certificate binding does not match the bundled package", {
      field: "resourceCertificate.bindingDigest",
      expected: expectedBinding,
      actual: metadata.bindingDigest,
      path: relative,
      repairHint: "regenerate the target bundle from one exact package and certificate"
    });
  } else if (validation.ok) {
    addCheck(checks, "resource-certificate", "pass", "resource certificate digest and package binding are valid");
  }
}

function resourceCertificateBindingDigest(airpkgHash, packageDigest, certificateDigest) {
  return hashBytes(`AIR_TARGET_RESOURCE_CERTIFICATE_BINDING_V1\0${airpkgHash || ""}\0${packageDigest || ""}\0${certificateDigest || ""}`);
}

function validateHashedFile(bundleDir, entry, id, diagnostics, checks) {
  if (!entry || typeof entry !== "object" || !entry.path) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.missing_file", `${id} path is required`, {
      field: `${id}.path`,
      repairHint: "regenerate the bundle with required runtime files"
    });
    return;
  }
  const rel = normalizeRelative(entry.path);
  if (unsafeRelative(rel)) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.absolute_path", `${id} path must be bundle-relative`, {
      field: `${id}.path`,
      repairHint: "use bundle-relative paths"
    });
    return;
  }
  const file = path.join(bundleDir, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.missing_file", `${id} file does not exist: ${rel}`, {
      field: `${id}.path`,
      path: rel,
      repairHint: "restore the missing file or regenerate the bundle"
    });
    return;
  }
  const expected = entry.hash;
  if (expected) {
    const actual = fileFingerprint(file);
    if (actual !== expected) {
      addBundleDiagnostic(diagnostics, checks, "air.bundle.hash_mismatch", `${id} hash mismatch: ${rel}`, {
        field: `${id}.hash`,
        path: rel,
        expected,
        actual,
        repairHint: "restore the original file or regenerate the bundle"
      });
      return;
    }
  }
  addCheck(checks, id, "pass", `${id} file is present and hashed`);
}

function validateNoAbsolutePaths(value, diagnostics, checks) {
  const offenders = [];
  visitWithPath(value, (item, pointer) => {
    if (typeof item === "string" && looksAbsolutePath(item)) offenders.push(pointer);
  });
  for (const pointer of offenders) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.absolute_path", `bundle metadata contains absolute path at ${pointer}`, {
      field: pointer,
      repairHint: "regenerate the bundle with relative paths"
    });
  }
  if (!offenders.length) addCheck(checks, "absolute-paths", "pass", "bundle metadata contains no absolute paths");
}

function validateNoTimestampFields(value, diagnostics, checks) {
  const offenders = [];
  visitWithPath(value, (_item, pointer, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt|date/i.test(key)) offenders.push(pointer);
  });
  for (const pointer of offenders) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", `timestamp-like deterministic metadata field is not allowed: ${pointer}`, {
      field: pointer,
      repairHint: "remove timestamp-like fields from deterministic bundle metadata"
    });
  }
  if (!offenders.length) addCheck(checks, "timestamps", "pass", "bundle metadata contains no timestamp-like fields");
}

function validateRuntimeBoundary(bundle, diagnostics, checks) {
  if (isCandidateAbi012(bundle?.abi?.airAbiRequired)) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.candidate_unsupported", "AIR ABI 0.12 candidate bundles are not admitted", {
      field: "abi.airAbiRequired",
      repairHint: "use the unpacked candidate package/interface checker"
    });
  }
  const runtimeRequires = bundle?.boundary?.runtimeRequires;
  if (!Array.isArray(runtimeRequires)) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.schema_invalid", "boundary.runtimeRequires must be an array", {
      field: "boundary.runtimeRequires",
      repairHint: "regenerate the bundle with runtime boundary metadata"
    });
    return;
  }
  const violations = runtimeRequires.filter((item) => {
    const lower = String(item || "").toLowerCase();
    return FORBIDDEN_RUNTIME_REQUIREMENTS.some((forbidden) => lower.includes(forbidden));
  });
  for (const item of violations) {
    addBundleDiagnostic(diagnostics, checks, "air.bundle.runtime_boundary_violation", `runtime bundle must not require ${item}`, {
      field: "boundary.runtimeRequires",
      requirement: item,
      repairHint: "move build-time tools out of runtime requirements"
    });
  }
  if (!violations.length) addCheck(checks, "runtime-boundary", "pass", "runtime requirements do not include build-time tools");
}

function finalizeBundleValidation(input, bundle, diagnostics, checks) {
  const normalizedDiagnostics = sortDiagnostics(diagnostics.map((diagnostic) => normalizeDiagnostic(diagnostic)));
  const status = normalizedDiagnostics.some((item) => item.severity === "fail") ? "fail" :
    normalizedDiagnostics.some((item) => item.severity === "warn") ? "warn" : "pass";
  return stableObject({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    kind: BUNDLE_VALIDATION_KIND,
    status,
    bundle: {
      path: path.basename(String(input || "")),
      target: bundle?.target || null,
      package: bundle?.package?.name || null
    },
    checks: checks.sort((a, b) => String(a.id).localeCompare(String(b.id)) || String(a.message).localeCompare(String(b.message))),
    diagnostics: normalizedDiagnostics
  });
}

function addBundleDiagnostic(diagnostics, checks, code, message, options = {}) {
  const severity = options.severity || "fail";
  diagnostics.push({
    code,
    severity,
    category: "bundle",
    source: "bundle-check",
    message,
    repairHint: options.repairHint || null,
    fields: stableObject({
      actual: options.actual === undefined ? null : options.actual,
      expected: options.expected === undefined ? null : options.expected,
      field: options.field || null,
      path: options.path || null,
      requirement: options.requirement || null
    })
  });
  addCheck(checks, code, severity, message, options.repairHint || null);
}

function addCheck(checks, id, status, message, repairHint = null) {
  checks.push({ id, status, message, repairHint });
}

function resolveAirpkgInput(input) {
  const target = path.resolve(input);
  if (!fs.existsSync(target)) throw new Error(`airpkg does not exist: ${input}`);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const file = path.join(target, "airpkg.json");
    if (!fs.existsSync(file)) throw new Error(`airpkg directory missing airpkg.json: ${input}`);
    return file;
  }
  if (!stat.isFile()) throw new Error(`airpkg is not a file or directory: ${input}`);
  return target;
}

function defaultProfileForTarget(target) {
  if (target === "web-dev") return "browser-webgpu";
  if (target === "native-dev") return "native-wgpu";
  return "cli";
}

function normalizeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function unsafeRelative(value) {
  return looksAbsolutePath(value) || String(value || "").split("/").includes("..");
}

function fileFingerprint(file) {
  return hashBytes(fs.readFileSync(file));
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  visitWithPath(value, (item) => {
    if (typeof item === "string" && looksAbsolutePath(item)) offenders.push(item);
  });
  if (offenders.length) throw new Error(`bundle metadata contains absolute path: ${offenders.slice(0, 3).join(", ")}`);
}

function visitWithPath(value, fn, pointer = "$", key = null) {
  fn(value, pointer, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitWithPath(item, fn, `${pointer}[${index}]`, String(index)));
  } else if (value && typeof value === "object") {
    for (const childKey of Object.keys(value).sort()) {
      visitWithPath(value[childKey], fn, pointer === "$" ? childKey : `${pointer}.${childKey}`, childKey);
    }
  }
}

function looksAbsolutePath(value) {
  return String(value || "").startsWith("/") || /^[A-Za-z]:[\\/]/.test(String(value || ""));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function readmeForBundle(target) {
  return `# AIR ${target} development bundle

This folder is an AIR development target bundle.

It is not a native installer, production web deploy, package registry artifact,
or Steam-ready package. Runtime files are listed in bundle.json. Runtime use
must not require Node, npm install, Python, Codex, a source AIR repository, or
build scripts.
`;
}

module.exports = {
  BUNDLE_SCHEMA_VERSION,
  checkTargetBundle,
  createTargetBundle
};
