"use strict";

// Each adapter is a host-owned proposal source. Its name is correlation data
// only; normalizeUntrustedProposal deliberately excludes it from AIR inputs.
function proposalProvider(identity) {
  return Object.freeze({
    identity,
    propose(input) {
      return { ...input, provider_identity: identity };
    }
  });
}

const providers = Object.freeze([
  proposalProvider("apple_local"),
  proposalProvider("windows_local"),
  proposalProvider("android_local"),
  proposalProvider("remote_grpc")
]);

module.exports = { providers, proposalProvider };
