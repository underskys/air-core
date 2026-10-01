#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { parseSource, verifySource, formatSource } = require("../src/source_profile");
const { buildVerifiedTypedModule, invokeVerifiedTypedExport } = require("../src/v052_verified_build");
const { observeBrowser } = require("../scripts/check_playwright_identity");

const options = { sourceProfile: "typed-v0.51" };
const descriptor = {
  schema: "air.typed-interface/0.12-candidate.1", air_abi_lane: "0.12",
  module_id: "test.numeric", types: [],
  exports: [{ name: "value", function: "value", parameters: [], return_type: "i64" }]
};
const source = (body, declarations = "") => `module test.numeric\n${declarations}\nexport func value() -> i64 {\n${body}\n}\n`;
const verify = (text) => verifySource(parseSource(text, "correction.air", options), options);

(async () => {
  const rejected = [
    [source("return 7", "capabilities { net, fs, invented }"), "air.capability.unknown"],
    [source("return 7\n%dead: i64 = 2"), "air.control.statement_after_return"],
    [source("return 7\nreturn 2"), "air.control.statement_after_return"],
    [source("return 7\n%dead: i64 = i64.checked_add 1, 2"), "air.control.statement_after_return"],
    [source("%n: i64 = const.i64 9223372036854775808\nreturn %n"), "air.numeric.i64_constant_out_of_range"],
    [source("%n: i64 = const.i64 -9223372036854775809\nreturn %n"), "air.numeric.i64_constant_out_of_range"],
    [source("%n: i32 = const.i64 5\nreturn 7"), "air.v051.typed_atom_type_mismatch"]
  ];
  for (const [text, code] of rejected) {
    assert.throws(() => verify(text), (error) => error.code === code, code);
    await assert.rejects(buildVerifiedTypedModule({ source: text, descriptor }), (error) => error.code === code, code);
  }
  for (const value of ["1.5", "01", "1e3", "%n", "", "5 trailing"]) {
    assert.throws(() => verify(source(`%n: i64 = const.i64 ${value}\nreturn %n`)),
      (error) => error.code === "air.v051.typed_atom_invalid");
  }
  // Known declarations retain existing metadata semantics, not effect authority.
  verify(source("return 7", "capabilities { net, fs }"));
  verify(source("return 7", "capabilities { }"));
  for (const value of ["-9223372036854775808", "9223372036854775807", "9007199254740993", "5", "-0"]) {
    const text = source(`%n: i64 = const.i64 ${value}\nreturn %n`);
    const formatted = formatSource(verify(text), options);
    assert.equal(formatSource(verify(formatted), options), formatted);
    const built = await buildVerifiedTypedModule({ source: text, descriptor });
    const bare = await buildVerifiedTypedModule({ source: source(`%n: i64 = ${value}\nreturn %n`), descriptor });
    assert.deepEqual(built.wasmBytes, bare.wasmBytes);
    const invoked = await invokeVerifiedTypedExport(built, "value", []);
    assert.equal(invoked.value.decimal, BigInt(value).toString());
  }

  const events = [];
  const mock = (version) => ({
    async launchServer() { return {
      wsEndpoint() { return "fixture"; },
      process() { return { spawnfile: process.execPath }; },
      async close() { events.push("server"); }
    }; },
    async connect() { return { version() { return version; }, async close() { events.push("browser"); } }; }
  });
  const expected = { name: "chromium", revision: "1234", browserVersion: "151.0.7922.34" };
  const mismatch = await observeBrowser(mock("older.binary"), expected, { headless: true });
  assert.equal(mismatch.versionMatch, false);
  assert.equal(mismatch.observedBrowserVersion, "older.binary");
  assert.equal(mismatch.executablePath, fs.realpathSync(process.execPath));
  assert.match(mismatch.executableSha256, /^[a-f0-9]{64}$/);
  const matching = await observeBrowser(mock(expected.browserVersion), expected, { headless: true });
  assert.equal(matching.versionMatch, true);
  assert.deepEqual(events, ["browser", "server", "browser", "server"]);
  console.log("v0.52 bounded correction: typed admission, exact const.i64 Wasm execution and observed browser identity passed");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
