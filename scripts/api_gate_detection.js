"use strict";

function declaresHostAbi012(text) {
  return [
    /\bHOST_ABI(?:_VERSION)?\s*=\s*["']0\.12["']/,
    /\bhostAbi(?:Version)?\b["']?\s*(?::|={1,3})\s*["']0\.12["']/,
    /["']?host_abi_lane["']?\s*(?::|={1,3})\s*["']0\.12["']/,
    /\bHost ABI(?:\s+lane)?\s+(?:`|["'])?0\.12\b/i
  ].some((pattern) => pattern.test(text));
}

function hostAbiDetectorInvariants() {
  return [
    [
      declaresHostAbi012("const HOST_ABI_VERSION = \"0.12\";"),
      "Host ABI 0.12 detector must reject an explicit version declaration"
    ],
    [
      declaresHostAbi012("const manifest = { hostAbi: \"0.12\" };"),
      "Host ABI 0.12 detector must reject an explicit manifest lane"
    ],
    [
      declaresHostAbi012("const hostAbiVersion = \"0.12\";"),
      "Host ABI detector must reject the camelCase version declaration"
    ],
    [
      declaresHostAbi012("const manifest = { \"hostAbiVersion\": \"0.12\" };"),
      "Host ABI detector must reject the quoted camelCase manifest key"
    ],
    [
      !declaresHostAbi012("const AIR_ABI = \"0.12\";\nconst lane = manifest.hostAbi;"),
      "AIR ABI 0.12 must not be confused with Host ABI 0.12"
    ]
  ];
}

module.exports = {
  declaresHostAbi012,
  hostAbiDetectorInvariants
};
