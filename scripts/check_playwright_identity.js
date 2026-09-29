#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

async function observeBrowser(chromium, entry, options) {
  const server = await chromium.launchServer(options);
  let browser;
  try {
    browser = await chromium.connect(server.wsEndpoint());
    const executable = fs.realpathSync(server.process().spawnfile);
    const observedVersion = browser.version();
    return {
      registryName: entry.name,
      expectedRevision: entry.revision,
      expectedBrowserVersion: entry.browserVersion,
      observedBrowserVersion: observedVersion,
      versionMatch: observedVersion === entry.browserVersion,
      executablePath: executable,
      executableSha256: crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex")
    };
  } finally {
    try { if (browser) await browser.close(); }
    finally { await server.close(); }
  }
}

async function main(output) {
  assert(output, "output path required");
  const lock = require("../package-lock.json");
  const playwrightVersion = require("playwright/package.json").version;
  const lockedVersion = lock.packages["node_modules/playwright"].version;
  assert.equal(playwrightVersion, lockedVersion, "Playwright version differs from lockfile");
  const registryPath = path.join(path.dirname(require.resolve("playwright-core")), "browsers.json");
  const registryBytes = fs.readFileSync(registryPath);
  const registry = JSON.parse(registryBytes.toString("utf8"));
  const entry = (name) => {
    const value = registry.browsers.find((browser) => browser.name === name);
    assert(value && /^\d+$/.test(value.revision) && value.browserVersion, `${name} identity unavailable`);
    return value;
  };
  const { chromium } = require("playwright");
  const browsers = [];
  browsers.push(await observeBrowser(chromium, entry("chromium"), { headless: true, channel: "chromium" }));
  browsers.push(await observeBrowser(chromium, entry("chromium-headless-shell"), { headless: true }));
  const identity = {
    playwrightVersion,
    lockedVersion,
    // Revisions are registry expectations, not claims inferred from cache names.
    chromiumRevision: entry("chromium").revision,
    headlessShellRevision: entry("chromium-headless-shell").revision,
    registrySha256: crypto.createHash("sha256").update(registryBytes).digest("hex"),
    browsers,
    status: browsers.every((browser) => browser.versionMatch) ? "pass" : "fail"
  };
  fs.writeFileSync(output, `${JSON.stringify(identity, null, 2)}\n`);
  console.log(JSON.stringify(identity));
  assert.equal(identity.status, "pass", "Executed browser version differs from registry expectation");
}

if (require.main === module) main(process.argv[2]).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { observeBrowser };
