"use strict";

const { AirError } = require("./errors");
const { formatModule, formatV051Air } = require("./format");
const { parseAir, parseV051TypedAir } = require("./parser");
const { verifyModule, verifyV051Air } = require("./verifier");

const SOURCE_PROFILE_LEGACY = "legacy-v0.50";
const SOURCE_PROFILE_TYPED_V051 = "typed-v0.51";
const SOURCE_PROFILES = Object.freeze([
  SOURCE_PROFILE_LEGACY,
  SOURCE_PROFILE_TYPED_V051
]);

function normalizeSourceProfile(value = SOURCE_PROFILE_LEGACY) {
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

function parseSource(source, file = "<input>", options = {}) {
  const { sourceProfile: requestedProfile, ...parseOptions } = options;
  const sourceProfile = normalizeSourceProfile(requestedProfile);
  if (sourceProfile === SOURCE_PROFILE_TYPED_V051) {
    return parseV051TypedAir(source, file);
  }
  return parseAir(source, file, parseOptions);
}

function verifySource(mod, options = {}) {
  const { sourceProfile: requestedProfile, ...verifyOptions } = options;
  const sourceProfile = normalizeSourceProfile(requestedProfile);
  if (sourceProfile === SOURCE_PROFILE_TYPED_V051) {
    return verifyV051Air(mod, verifyOptions);
  }
  return verifyModule(mod, verifyOptions);
}

function formatSource(mod, options = {}) {
  const sourceProfile = normalizeSourceProfile(options.sourceProfile);
  if (sourceProfile === SOURCE_PROFILE_TYPED_V051) return formatV051Air(mod);
  return formatModule(mod);
}

function isTypedSourceProfile(value) {
  return normalizeSourceProfile(value) === SOURCE_PROFILE_TYPED_V051;
}

module.exports = {
  SOURCE_PROFILE_LEGACY,
  SOURCE_PROFILE_TYPED_V051,
  SOURCE_PROFILES,
  formatSource,
  isTypedSourceProfile,
  normalizeSourceProfile,
  parseSource,
  verifySource
};
