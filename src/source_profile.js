"use strict";

const { AirError, SOURCE_PROFILE_TYPED_V053, isTypedV053Ast } = require("./errors");
const { enforceAnalysisCapacity } = require("./analysis_capacity");
const format = require("./format");
const parser = require("./parser");
const typedClosure = require("./typed_closure");
const verifier = require("./verifier");

const { formatModule, formatV051Air } = format;
const { parseAir, parseV051TypedAir } = parser;
const { verifyModule, verifyV051Air } = verifier;

const SOURCE_PROFILE_LEGACY = "legacy-v0.50";
const SOURCE_PROFILE_TYPED_V051 = "typed-v0.51";
const SOURCE_PROFILES = Object.freeze([
  SOURCE_PROFILE_LEGACY,
  SOURCE_PROFILE_TYPED_V051
]);

// Kill switch (RFC §14.6; D-VAL-11; OD-7 (a)). It is off in every committed
// state; turning it on is a commit. With it on, every selection of
// typed-v0.53 fails with air.source_profile.unsupported before the candidate
// gate is consulted; legacy-v0.50 and typed-v0.51 are unaffected.
const disable_typed_v053_profile = false;

function typedV053Selectable() {
  return !disable_typed_v053_profile;
}

function normalizeSourceProfile(value = SOURCE_PROFILE_LEGACY, options = {}) {
  // R-PROF-1 (OPEN-1 (a)): typed-v0.53 is candidate-gated until H53-RELEASE.
  // The gate is independent of the AIR ABI 0.12 gate.
  if (value === SOURCE_PROFILE_TYPED_V053 && typedV053Selectable()) {
    if (!options || options.allowCandidateProfile !== true) {
      const error = new AirError(
        `air.source_profile.candidate_disabled: '${SOURCE_PROFILE_TYPED_V053}' is a candidate source profile; select it with allowCandidateProfile: true (CLI --allow-candidate-profile)`
      );
      error.code = "air.source_profile.candidate_disabled";
      throw error;
    }
    return value;
  }
  // Only an omitted/undefined value selects the documented default. Explicit
  // null, false, zero, empty text or a coercible object is not a profile.
  if (typeof value !== "string" || !SOURCE_PROFILES.includes(value)) {
    const label = typeof value === "string" ? `'${value}'` : "non-string value";
    const error = new AirError(
      `air.source_profile.unsupported: ${label}; expected ${SOURCE_PROFILES.join(" or ")}`
    );
    error.code = "air.source_profile.unsupported";
    throw error;
  }
  return value;
}

function intakeRefused(code, message) {
  const error = new AirError(`${code}: INTAKE_REFUSED ${message}`);
  error.disposition = "INTAKE_REFUSED";
  return error;
}

// Phase A for typed-v0.53 source bytes (R-WB-15, R-WB-15c; slice text §3.1):
// source bytes → iterative parse → AST-node intake → capacity check. A
// refused source returns no AST. The intake values are the accepted
// VERIFIED_TYPED_RUNTIME_LIMITS; SCALAR admits no imports, so the closure is
// the module and the closure totals cannot bind before the per-module limits.
function parseTypedV053Source(source, file, options = {}) {
  const { VERIFIED_TYPED_RUNTIME_LIMITS, verifiedTypedAstNodeCount } = require("./v052_verified_build");
  if (typeof source !== "string") {
    throw new AirError("air.v051.typed_syntax_invalid: typed-v0.53 source must be text");
  }
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (sourceBytes > VERIFIED_TYPED_RUNTIME_LIMITS.maxSourceBytes) {
    throw intakeRefused("air.v052.work_limit_source_bytes", `source bytes ${sourceBytes} exceed the configured limit of ${VERIFIED_TYPED_RUNTIME_LIMITS.maxSourceBytes}`);
  }
  const mod = typedClosure.parseTypedV053Closure(source, file, options);
  const astNodes = verifiedTypedAstNodeCount(mod);
  if (astNodes > VERIFIED_TYPED_RUNTIME_LIMITS.maxAstNodes) {
    throw intakeRefused("air.v052.work_limit_ast_nodes", `parsed AST nodes ${astNodes} exceed the configured limit of ${VERIFIED_TYPED_RUNTIME_LIMITS.maxAstNodes}`);
  }
  typedClosure.enforceCapacity(mod, options.analysisCapacity);
  return mod;
}

function astProfileName(mod) {
  if (isTypedV053Ast(mod)) return SOURCE_PROFILE_TYPED_V053;
  return mod && mod.v051TypedAst ? SOURCE_PROFILE_TYPED_V051 : SOURCE_PROFILE_LEGACY;
}

function astMismatch(mod, requested) {
  return new AirError(
    `air.source_profile.ast_mismatch: the AST was parsed as '${astProfileName(mod)}' and cannot be processed as '${requested}'`
  );
}

// R-PROF-7 for typed-v0.53 ASTs (CR-53-02 applies to typed-v0.53 ASTs only,
// OD-4 (b)): a mismatch fails closed, never a TypeError or a silent format in
// another profile. Untagged ASTs under legacy-v0.50 / typed-v0.51 keep their
// 388c790 behaviour.
function requireProfileMatch(mod, sourceProfile) {
  if (sourceProfile === SOURCE_PROFILE_TYPED_V053) {
    if (!isTypedV053Ast(mod)) throw astMismatch(mod, sourceProfile);
  } else if (isTypedV053Ast(mod)) {
    throw astMismatch(mod, sourceProfile);
  }
}

function parseSource(source, file = "<input>", options = {}) {
  const { sourceProfile: requestedProfile, ...parseOptions } = options;
  const sourceProfile = normalizeSourceProfile(requestedProfile, options);
  if (sourceProfile === SOURCE_PROFILE_TYPED_V053) {
    return parseTypedV053Source(source, file, options);
  }
  if (sourceProfile === SOURCE_PROFILE_TYPED_V051) {
    return parseV051TypedAir(source, file);
  }
  return parseAir(source, file, parseOptions);
}

function verifySource(mod, options = {}) {
  const { sourceProfile: requestedProfile, ...verifyOptions } = options;
  const sourceProfile = normalizeSourceProfile(requestedProfile, options);
  requireProfileMatch(mod, sourceProfile);
  if (sourceProfile === SOURCE_PROFILE_TYPED_V053) {
    // An AST entrypoint recomputes both measures before any phase-S analysis.
    typedClosure.enforceCapacity(mod, options.analysisCapacity);
    return verifier.typedV053.verify(mod);
  }
  if (sourceProfile === SOURCE_PROFILE_TYPED_V051) {
    return verifyV051Air(mod, verifyOptions);
  }
  return verifyModule(mod, verifyOptions);
}

function formatSource(mod, options = {}) {
  const sourceProfile = normalizeSourceProfile(options.sourceProfile, options);
  requireProfileMatch(mod, sourceProfile);
  if (sourceProfile === SOURCE_PROFILE_TYPED_V053) {
    typedClosure.enforceCapacity(mod, options.analysisCapacity);
    return format.typedV053.format(mod);
  }
  if (sourceProfile === SOURCE_PROFILE_TYPED_V051) return formatV051Air(mod);
  return formatModule(mod);
}

function isTypedSourceProfile(value) {
  if (value === SOURCE_PROFILE_TYPED_V053 && typedV053Selectable()) return true;
  return normalizeSourceProfile(value) === SOURCE_PROFILE_TYPED_V051;
}

module.exports = {
  SOURCE_PROFILE_LEGACY,
  SOURCE_PROFILE_TYPED_V051,
  SOURCE_PROFILE_TYPED_V053,
  SOURCE_PROFILES,
  formatSource,
  isTypedSourceProfile,
  normalizeSourceProfile,
  parseSource,
  verifySource
};
