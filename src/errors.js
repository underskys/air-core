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

// typed-v0.53 (SCALAR): every typed-v0.53 AST carries this profile id as an
// immutable own property (R-PROF-7). Guards key on the tag, never on a
// heuristic (R-PROF-8). Kept in this leaf module so assurance tools can check
// it without loading the parser or verifier.
const SOURCE_PROFILE_TYPED_V053 = "typed-v0.53";

function isTypedV053Ast(mod) {
  return Boolean(mod) && typeof mod === "object" &&
    Object.prototype.hasOwnProperty.call(mod, "sourceProfile") &&
    mod.sourceProfile === SOURCE_PROFILE_TYPED_V053;
}

// R-ASSUR-1 floor: an assurance entrypoint given a typed-v0.53 AST refuses
// before any other check. Never a silent PASS, `not_enabled` or TypeError.
function assuranceProfileUnsupported(entrypoint, profile = SOURCE_PROFILE_TYPED_V053) {
  const error = new AirError(`air.assurance.profile_unsupported: ${entrypoint} does not support the '${profile}' source profile`);
  error.disposition = "UNSUPPORTED";
  return error;
}

module.exports = {
  AirError,
  SOURCE_PROFILE_TYPED_V053,
  assuranceProfileUnsupported,
  isTypedV053Ast,
  semanticDiagnosticCode
};
