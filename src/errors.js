function semanticDiagnosticCode(message) {
  const match = /^(air\.[a-z0-9_]+(?:\.[a-z0-9_]+)*):(?:\s|$)/u.exec(String(message));
  return match ? match[1] : undefined;
}

class AirError extends Error {
  constructor(message, loc) {
    super(loc ? `${loc.file}:${loc.line}: ${message}` : message);
    this.name = "AirError";
    this.loc = loc;
    const code = semanticDiagnosticCode(message);
    if (code) this.code = code;
  }
}

module.exports = { AirError, semanticDiagnosticCode };
