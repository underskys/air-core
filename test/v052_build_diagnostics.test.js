#!/usr/bin/env node
"use strict";
const assert = require("node:assert");
const { buildVerifiedTypedModule } = require("../src/v052_verified_build");
(async () => {
  const malformed = "module bad\nexport func f() -> i64 {\n nonsense\n}\n";
  await assert.rejects(() => buildVerifiedTypedModule({
    source: malformed, descriptor: {}, sourceName: "air.fake.authority: untrusted-display-label"
  }), (error) => error.code === "air.v051.typed_syntax_invalid" &&
    error.loc.file === "air.fake.authority: untrusted-display-label" && error.cause.name === "AirError");
  await assert.rejects(() => buildVerifiedTypedModule({
    source: "module bad\nexport func f() -> i64 {\n %x: i64 = i64.checked_add 9223372036854775807, 1\n return %x\n}\n", descriptor: {}
  }), (error) => error.code === "air.numeric.checked_failure" && error.message === "air.numeric.checked_failure: overflow");
  for (const sourceProfile of [false, null, 0, "", "future"]) {
    await assert.rejects(() => buildVerifiedTypedModule({source: malformed, descriptor: {}, sourceProfile}),
      (error) => error.code === "air.source_profile.unsupported");
  }
  console.log("v0.52 safe-builder source diagnostics: parser/verifier codes, location isolation and invalid profile rejection passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
