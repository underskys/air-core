const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { verifyModule } = require("./verifier");
const { checkPackageDir } = require("./sdk");
const { diagnosticHintsFromMessage, normalizeDiagnostic } = require("./diagnostics");

const LSP_SCHEMA_VERSION = "0.15";

function createLspDiagnostics(target, options = {}) {
  const resolved = path.resolve(target);
  const isPackage = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  return isPackage
    ? createPackageLspDiagnostics(target, options)
    : createFileLspDiagnostics(target, options);
}

function createFileLspDiagnostics(file, options = {}) {
  const diagnostics = [];
  try {
    const source = typeof options.sourceText === "string" ? options.sourceText : fs.readFileSync(file, "utf8");
    let mod = null;
    try {
      mod = parseAir(source, file);
    } catch (err) {
      diagnostics.push(diagnosticFromError(err, {
        code: "air.parser.syntax",
        source: "parser",
        category: "parser",
        file
      }));
      return envelope(file, "file", diagnostics);
    }
    try {
      verifyModule(mod, { library: Boolean(options.library) });
    } catch (err) {
      diagnostics.push(diagnosticFromError(err, {
        code: "air.verifier.error",
        source: "verifier",
        category: "verifier",
        file
      }));
    }
  } catch (err) {
    diagnostics.push(diagnosticFromError(err, {
      code: "air.package.file_read",
      source: "airc-check",
      category: "package",
      file
    }));
  }
  return envelope(file, "file", diagnostics);
}

function createPackageLspDiagnostics(packageDir, options = {}) {
  let report = null;
  try {
    report = checkPackageDir(packageDir, {
      profile: options.profile,
      built: Boolean(options.built),
      releaseCandidate: Boolean(options.releaseCandidate)
    });
  } catch (err) {
    const diagnostics = [diagnosticFromError(err, {
      code: "air.package.check_failed",
      source: "package-check",
      category: "package",
      file: null
    })];
    return envelope(packageDir, "package", diagnostics);
  }
  const diagnostics = [];
  for (const diagnostic of report.diagnostics || []) diagnostics.push(toLspDiagnostic(diagnostic));
  for (const warning of (report.packageReview && report.packageReview.warnings) || []) {
    if (warning.diagnostic) diagnostics.push(toLspDiagnostic(warning.diagnostic));
  }
  return envelope(packageDir, "package", dedupeDiagnostics(diagnostics));
}

function envelope(target, kind, diagnostics) {
  const normalized = sortLspDiagnostics(diagnostics.map(toLspDiagnostic));
  return {
    schemaVersion: LSP_SCHEMA_VERSION,
    target,
    kind,
    status: statusForDiagnostics(normalized),
    diagnostics: normalized
  };
}

function diagnosticFromError(err, defaults = {}) {
  const loc = err && err.loc ? err.loc : {};
  const message = cleanErrorMessage(err);
  const messageHints = diagnosticHintsFromMessage(message);
  const file = messageHints.file || loc.file || defaults.file || null;
  const fields = { ...(messageHints.fields || {}) };
  if (file && fields.path === null) fields.path = file;
  return normalizeDiagnostic({
    code: messageHints.code || defaults.code,
    legacyId: messageHints.legacyId || null,
    severity: "fail",
    source: defaults.source,
    category: messageHints.code ? undefined : defaults.category,
    message,
    repairHint: null,
    file,
    line: messageHints.line || loc.line,
    col: messageHints.col || loc.col,
    endLine: loc.endLine,
    endCol: loc.endCol,
    module: messageHints.module || loc.file || null,
    fields,
    packageStatusImpact: "fail"
  });
}

function cleanErrorMessage(err) {
  const message = err && err.message ? String(err.message) : String(err);
  const loc = err && err.loc;
  if (loc && loc.file && loc.line && message.startsWith(`${loc.file}:${loc.line}: `)) {
    return message.slice(`${loc.file}:${loc.line}: `.length);
  }
  return message;
}

function toLspDiagnostic(input) {
  const diagnostic = normalizeDiagnostic(input || {});
  return {
    file: diagnostic.file,
    line: diagnostic.line,
    col: diagnostic.col,
    endLine: diagnostic.endLine,
    endCol: diagnostic.endCol,
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    repairHint: diagnostic.repairHint,
    source: diagnostic.source,
    category: diagnostic.category,
    pathClass: diagnostic.pathClass,
    gateAction: diagnostic.gateAction,
    packageStatusImpact: diagnostic.packageStatusImpact,
    module: diagnostic.module,
    symbol: diagnostic.symbol,
    metric: diagnostic.metric,
    value: diagnostic.value,
    threshold: diagnostic.threshold,
    fields: diagnostic.fields || {},
    related: diagnostic.related
  };
}

function dedupeDiagnostics(diagnostics) {
  const out = [];
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic);
  }
  return out;
}

function sortLspDiagnostics(diagnostics) {
  return diagnostics.slice().sort(compareLspDiagnostics);
}

function compareLspDiagnostics(a, b) {
  return severityRank(a.severity) - severityRank(b.severity) ||
    fileRank(a.file) - fileRank(b.file) ||
    String(a.file || "").localeCompare(String(b.file || "")) ||
    numberRank(a.line) - numberRank(b.line) ||
    numberRank(a.col) - numberRank(b.col) ||
    String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.message || "").localeCompare(String(b.message || ""));
}

function severityRank(severity) {
  if (severity === "fail") return 0;
  if (severity === "warn") return 1;
  return 2;
}

function fileRank(file) {
  return file === null || file === undefined ? 1 : 0;
}

function numberRank(value) {
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function statusForDiagnostics(diagnostics) {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "fail" || diagnostic.packageStatusImpact === "fail")) return "fail";
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warn" || diagnostic.packageStatusImpact === "warn")) return "warn";
  return "pass";
}

module.exports = {
  LSP_SCHEMA_VERSION,
  createLspDiagnostics,
  createFileLspDiagnostics,
  createPackageLspDiagnostics,
  toLspDiagnostic,
  sortLspDiagnostics
};
