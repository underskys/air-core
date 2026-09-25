#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const output = process.argv[2];
assert(output, "output path required");

const lock = require("../package-lock.json");
const playwrightVersion = require("playwright/package.json").version;
const lockedVersion = lock.packages["node_modules/playwright"].version;
assert.equal(playwrightVersion, lockedVersion, "Playwright version differs from lockfile");

const registryPath = path.join(path.dirname(require.resolve("playwright-core")), "browsers.json");
const registryBytes = fs.readFileSync(registryPath);
const registry = JSON.parse(registryBytes.toString("utf8"));
const revision = (name) => {
  const entry = registry.browsers.find((browser) => browser.name === name);
  assert(entry && /^\d+$/.test(entry.revision), `${name} revision unavailable`);
  return entry.revision;
};
const chromiumExecutablePresent = fs.existsSync(require("playwright").chromium.executablePath());
assert(chromiumExecutablePresent, "Playwright Chromium executable unavailable");

const identity = {
  playwrightVersion,
  lockedVersion,
  chromiumRevision: revision("chromium"),
  headlessShellRevision: revision("chromium-headless-shell"),
  registrySha256: crypto.createHash("sha256").update(registryBytes).digest("hex"),
  chromiumExecutablePresent
};
fs.writeFileSync(output, `${JSON.stringify(identity, null, 2)}\n`);
console.log(JSON.stringify(identity));
