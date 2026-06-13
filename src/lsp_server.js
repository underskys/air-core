const fs = require("fs");
const path = require("path");
const { pathToFileURL, fileURLToPath } = require("url");
const { createFileLspDiagnostics, createPackageLspDiagnostics } = require("./lsp_diagnostics");

const JSON_RPC_VERSION = "2.0";
const LSP_TEXT_SYNC_FULL = 1;

class AirLspSession {
  constructor(options = {}) {
    this.documents = new Map();
    this.rootUri = options.rootUri || null;
    this.rootPath = options.rootPath || null;
    this.profile = options.profile || "cli";
    this.shutdownRequested = false;
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
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: LSP_TEXT_SYNC_FULL,
          save: { includeText: false }
        }
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
    const packageRoot = findPackageRoot(current.path || uriToFilePath(uri));
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

  publishFileDiagnostics(uri) {
    const doc = this.documents.get(uri);
    if (!doc) return [];
    const result = createFileLspDiagnostics(doc.path, { sourceText: doc.text });
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

module.exports = {
  AirLspSession,
  JsonRpcStreamParser,
  encodeJsonRpcMessage,
  filePathToUri,
  findPackageRoot,
  runLspStdio,
  toProtocolDiagnostic
};
