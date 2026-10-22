const fs = require("fs");
const path = require("path");
const { pathToFileURL, fileURLToPath } = require("url");
const { createFileLspDiagnostics, createPackageLspDiagnostics } = require("./lsp_diagnostics");
const { parseAir } = require("./parser");
const { formatModule } = require("./format");
const { SOURCE_PROFILE_TYPED_V053 } = require("./errors");

const JSON_RPC_VERSION = "2.0";
const LSP_TEXT_SYNC_FULL = 1;

class AirLspSession {
  constructor(options = {}) {
    this.documents = new Map();
    this.rootUri = options.rootUri || null;
    this.rootPath = options.rootPath || null;
    this.profile = options.profile || "cli";
    this.shutdownRequested = false;
    // R-LSP-1: typed-v0.53 is selected explicitly, under the candidate gate.
    this.sourceProfile = null;
    if (options.sourceProfile !== undefined) this.selectSourceProfile(options.sourceProfile, options.allowCandidateProfile);
  }

  selectSourceProfile(sourceProfile, allowCandidateProfile) {
    if (sourceProfile !== SOURCE_PROFILE_TYPED_V053) return;
    const { normalizeSourceProfile } = require("./source_profile");
    this.sourceProfile = normalizeSourceProfile(sourceProfile, { allowCandidateProfile });
  }

  typedV053Options() {
    return { allowCandidateProfile: true, sourceProfile: SOURCE_PROFILE_TYPED_V053 };
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") return [];
    const method = message.method;
    const id = Object.prototype.hasOwnProperty.call(message, "id") ? message.id : undefined;
    try {
      if (method === "initialize") return this.withResponse(id, this.initialize(message.params || {}));
      if (method === "initialized") return [];
      if (method === "shutdown") {
        this.shutdownRequested = true;
        return this.withResponse(id, null);
      }
      if (method === "exit") return [{ __airExit: true, code: this.shutdownRequested ? 0 : 1 }];
      if (method === "textDocument/didOpen") return this.didOpen(message.params || {});
      if (method === "textDocument/didChange") return this.didChange(message.params || {});
      if (method === "textDocument/didSave") return this.didSave(message.params || {});
      if (method === "textDocument/didClose") return this.didClose(message.params || {});
      if (method === "textDocument/formatting") return this.withResponse(id, this.documentFormatting(message.params || {}));
      if (method === "textDocument/hover") return this.withResponse(id, this.hover(message.params || {}));
      if (id !== undefined) return this.withError(id, -32601, `method not found: ${method}`);
      return [];
    } catch (err) {
      if (id !== undefined) return this.withError(id, -32603, err && err.message ? err.message : String(err));
      return [];
    }
  }

  initialize(params) {
    this.rootUri = params.rootUri || this.rootUri || null;
    this.rootPath = params.rootPath || (this.rootUri ? uriToFilePath(this.rootUri) : this.rootPath);
    const initializationOptions = params.initializationOptions || {};
    if (initializationOptions.profile) this.profile = initializationOptions.profile;
    if (initializationOptions.sourceProfile !== undefined) {
      this.selectSourceProfile(initializationOptions.sourceProfile, initializationOptions.allowCandidateProfile);
    }
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: LSP_TEXT_SYNC_FULL,
          save: { includeText: false }
        },
        documentFormattingProvider: true,
        hoverProvider: true
      },
      serverInfo: {
        name: "airc-lsp",
        version: "0.19"
      }
    };
  }

  didOpen(params) {
    const doc = params.textDocument || {};
    if (!doc.uri) return [];
    this.documents.set(doc.uri, {
      uri: doc.uri,
      path: uriToFilePath(doc.uri),
      text: String(doc.text || ""),
      version: doc.version || 0
    });
    return this.publishFileDiagnostics(doc.uri);
  }

  didChange(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    if (!uri) return [];
    const current = this.documents.get(uri) || { uri, path: uriToFilePath(uri), text: "", version: 0 };
    let text = current.text;
    for (const change of params.contentChanges || []) {
      if (typeof change.text === "string") text = change.text;
    }
    this.documents.set(uri, {
      ...current,
      text,
      version: textDocument.version || current.version
    });
    return this.publishFileDiagnostics(uri);
  }

  didSave(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    if (!uri) return [];
    const current = this.documents.get(uri) || { uri, path: uriToFilePath(uri), text: "", version: 0 };
    if (typeof params.text === "string") {
      this.documents.set(uri, { ...current, text: params.text });
    }
    const packageRoot = this.sourceProfile ? null : findPackageRoot(current.path || uriToFilePath(uri));
    if (packageRoot) return this.publishPackageDiagnostics(uri, packageRoot);
    return this.publishFileDiagnostics(uri);
  }

  didClose(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    if (!uri) return [];
    this.documents.delete(uri);
    return [publishDiagnostics(uri, [])];
  }

  documentFormatting(params) {
    const uri = params.textDocument && params.textDocument.uri;
    const doc = uri ? this.documents.get(uri) : null;
    if (!doc) return [];
    if (hasAirComment(doc.text)) {
      throw new Error("air.format.comments_not_preserved: editor formatting refuses comment-bearing input");
    }
    let canonical;
    if (this.sourceProfile) {
      const { formatSource, parseSource } = require("./source_profile");
      canonical = formatSource(parseSource(doc.text, doc.path, this.typedV053Options()), this.typedV053Options());
    } else {
      canonical = formatModule(parseAir(doc.text, doc.path));
    }
    if (canonical === doc.text) return [];
    return [{
      range: fullDocumentRange(doc.text),
      newText: canonical
    }];
  }

  hover(params) {
    const uri = params.textDocument && params.textDocument.uri;
    const doc = uri ? this.documents.get(uri) : null;
    if (!doc) return null;
    let mod;
    try {
      mod = this.sourceProfile
        ? require("./source_profile").parseSource(doc.text, doc.path, this.typedV053Options())
        : parseAir(doc.text, doc.path);
    } catch {
      return null;
    }
    const token = tokenAtPosition(doc.text, params.position || {});
    const capabilities = Array.from(mod.explicitCapabilities || mod.capabilities || []).sort();
    if (token === "capabilities" || capabilities.includes(token)) {
      return markdownHover([
        "**AIR capabilities**",
        "",
        capabilities.length ? capabilities.map((item) => `- \`${item}\``).join("\n") : "No capabilities declared.",
        "",
        "Capabilities are verifier-visible declarations; they do not grant host authority by themselves."
      ]);
    }
    const effects = (mod.effects || []).slice().sort((a, b) => a.key.localeCompare(b.key));
    if (token === "effects" || effects.some((item) => item.key === token)) {
      return markdownHover([
        "**AIR effect budgets**",
        "",
        effects.length
          ? effects.map((item) => `- \`${item.key} ${item.op || "<="} ${item.limit}\``).join("\n")
          : "No module effect budgets declared.",
        "",
        "Effect budgets are statically checked upper bounds."
      ]);
    }
    return null;
  }

  publishFileDiagnostics(uri) {
    const doc = this.documents.get(uri);
    if (!doc) return [];
    const result = createFileLspDiagnostics(doc.path, this.sourceProfile
      ? { ...this.typedV053Options(), sourceText: doc.text }
      : { sourceText: doc.text });
    return [publishDiagnostics(uri, result.diagnostics.map(toProtocolDiagnostic))];
  }

  publishPackageDiagnostics(fallbackUri, packageRoot) {
    const result = createPackageLspDiagnostics(packageRoot, {
      profile: this.profile,
      built: false
    });
    const groups = new Map();
    for (const diagnostic of result.diagnostics || []) {
      const uri = diagnosticUri(diagnostic, packageRoot, fallbackUri);
      if (!groups.has(uri)) groups.set(uri, []);
      groups.get(uri).push(toProtocolDiagnostic(diagnostic));
    }
    if (!groups.has(fallbackUri)) groups.set(fallbackUri, []);
    return Array.from(groups.keys()).sort().map((uri) =>
      publishDiagnostics(uri, dedupeProtocolDiagnostics(groups.get(uri)).sort(compareProtocolDiagnostics))
    );
  }

  withResponse(id, result) {
    if (id === undefined) return [];
    return [{ jsonrpc: JSON_RPC_VERSION, id, result }];
  }

  withError(id, code, message) {
    return [{ jsonrpc: JSON_RPC_VERSION, id, error: { code, message } }];
  }
}

function runLspStdio(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const session = new AirLspSession(options);
  const parser = new JsonRpcStreamParser((message) => {
    const responses = session.handleMessage(message);
    for (const response of responses) {
      if (response.__airExit) {
        process.exitCode = response.code;
        if (output === process.stdout) setImmediate(() => process.exit(response.code));
        return;
      }
      output.write(encodeJsonRpcMessage(response));
    }
  });
  input.on("data", (chunk) => parser.push(chunk));
  input.resume();
}

class JsonRpcStreamParser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    while (true) {
      const headerEnd = this.buffer.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const match = /^Content-Length:\s*(\d+)$/im.exec(header);
      if (!match) throw new Error("missing Content-Length header");
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);
      this.onMessage(JSON.parse(body));
    }
  }
}

function encodeJsonRpcMessage(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function publishDiagnostics(uri, diagnostics) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method: "textDocument/publishDiagnostics",
    params: {
      uri,
      diagnostics
    }
  };
}

function toProtocolDiagnostic(diagnostic) {
  return {
    range: diagnosticRange(diagnostic),
    severity: lspSeverity(diagnostic.severity, diagnostic.packageStatusImpact),
    code: diagnostic.code || "air.diagnostic",
    source: diagnostic.source || diagnostic.category || "air",
    message: diagnostic.message || "",
    data: stableObject({
      code: diagnostic.code || null,
      severity: diagnostic.severity || null,
      category: diagnostic.category || null,
      repairHint: diagnostic.repairHint || null,
      pathClass: diagnostic.pathClass || null,
      gateAction: diagnostic.gateAction || null,
      packageStatusImpact: diagnostic.packageStatusImpact || null,
      module: diagnostic.module || null,
      symbol: diagnostic.symbol || null,
      metric: diagnostic.metric || null,
      value: diagnostic.value,
      threshold: diagnostic.threshold,
      fields: diagnostic.fields || {}
    })
  };
}

function diagnosticRange(diagnostic) {
  const startLine = lineToLsp(diagnostic.line);
  const startCharacter = colToLsp(diagnostic.col);
  const endLine = lineToLsp(diagnostic.endLine || diagnostic.line);
  const endCharacter = Math.max(colToLsp(diagnostic.endCol || diagnostic.col) + 1, startCharacter + 1);
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter }
  };
}

function lineToLsp(value) {
  return Number.isFinite(value) && value > 0 ? value - 1 : 0;
}

function colToLsp(value) {
  return Number.isFinite(value) && value > 0 ? value - 1 : 0;
}

function lspSeverity(severity, packageStatusImpact = null) {
  if (severity === "fail" || packageStatusImpact === "fail") return 1;
  if (severity === "warn" || packageStatusImpact === "warn") return 2;
  return 3;
}

function diagnosticUri(diagnostic, packageRoot, fallbackUri) {
  if (!diagnostic || !diagnostic.file) return fallbackUri;
  const file = path.isAbsolute(diagnostic.file) ? diagnostic.file : path.join(packageRoot, diagnostic.file);
  return filePathToUri(file);
}

function findPackageRoot(file) {
  let dir = fs.existsSync(file) && fs.statSync(file).isDirectory() ? file : path.dirname(file);
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "air.package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function uriToFilePath(uri) {
  if (!uri || !String(uri).startsWith("file://")) return path.resolve(String(uri || ""));
  return fileURLToPath(uri);
}

function filePathToUri(file) {
  return pathToFileURL(path.resolve(file)).href;
}

function dedupeProtocolDiagnostics(diagnostics) {
  const out = [];
  const seen = new Set();
  for (const diagnostic of diagnostics || []) {
    const key = [
      diagnostic.source || "",
      diagnostic.code || "",
      diagnostic.message || "",
      JSON.stringify(diagnostic.range || {})
    ].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic);
  }
  return out;
}

function compareProtocolDiagnostics(a, b) {
  return (a.severity || 3) - (b.severity || 3) ||
    a.range.start.line - b.range.start.line ||
    a.range.start.character - b.range.start.character ||
    String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.message || "").localeCompare(String(b.message || ""));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function hasAirComment(source) {
  for (const line of String(source || "").split(/\r?\n/)) {
    let inString = false;
    let escape = false;
    for (const ch of line) {
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "#") return true;
    }
  }
  return false;
}

function fullDocumentRange(source) {
  const lines = String(source || "").split(/\r?\n/);
  return {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1].length }
  };
}

function tokenAtPosition(source, position) {
  const lines = String(source || "").split(/\r?\n/);
  const line = lines[Math.max(0, Math.min(lines.length - 1, Number(position.line) || 0))] || "";
  const index = Math.max(0, Math.min(line.length, Number(position.character) || 0));
  let start = index;
  let end = index;
  while (start > 0 && /[A-Za-z0-9_.-]/.test(line[start - 1])) start -= 1;
  while (end < line.length && /[A-Za-z0-9_.-]/.test(line[end])) end += 1;
  return line.slice(start, end);
}

function markdownHover(lines) {
  return {
    contents: {
      kind: "markdown",
      value: lines.join("\n")
    }
  };
}

module.exports = {
  AirLspSession,
  JsonRpcStreamParser,
  encodeJsonRpcMessage,
  filePathToUri,
  findPackageRoot,
  runLspStdio,
  toProtocolDiagnostic
};
