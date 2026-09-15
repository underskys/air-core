#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const requireFromProject = createRequire(path.join(root, "package.json"));
const { chromium } = requireFromProject("playwright");

const [wasmPath] = process.argv.slice(2);
if (!wasmPath) throw new Error("usage: browser_runtime.mjs <module.wasm>");

const wasmBytes = fs.readFileSync(path.resolve(wasmPath));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const result = await page.evaluate(async (bytes) => {
    const { instance } = await WebAssembly.instantiate(Uint8Array.from(bytes), {});
    return {
      checkedAdd: instance.exports.checked_add(1n, 2n).toString(),
      exactI64: instance.exports.echo(9007199254740993n).toString(),
      withinLimit: instance.exports.within_business_limit(49n)
    };
  }, Array.from(wasmBytes));

  console.log(JSON.stringify({
    kind: "air.v052.verifiedRuntimeBrowserConformance",
    browser: "playwright-chromium",
    result
  }));
} finally {
  await browser.close();
}
