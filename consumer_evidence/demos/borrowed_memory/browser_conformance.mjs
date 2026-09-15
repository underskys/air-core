#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const requireFromRunner = createRequire(import.meta.url);
const requireFromWebGpuHost = createRequire(path.join(root, "hosts", "webgpu", "package.json"));
let playwright;
try {
  playwright = requireFromRunner("playwright");
} catch (error) {
  if (error && error.code !== "MODULE_NOT_FOUND") throw error;
  playwright = requireFromWebGpuHost("playwright");
}
const { chromium } = playwright;

const [affinePath, checksumPath] = process.argv.slice(2);
if (!affinePath || !checksumPath) {
  throw new Error("usage: browser_conformance.mjs <affine.wasm> <checksum.wasm>");
}

const affineBytes = fs.readFileSync(path.resolve(affinePath));
const checksumBytes = fs.readFileSync(path.resolve(checksumPath));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const result = await page.evaluate(async ({ affine, checksum }) => {
    const writeI32 = (view, value) => {
      new DataView(view.buffer, view.byteOffset, view.byteLength).setInt32(0, value, true);
    };
    const readI32 = (view) =>
      new DataView(view.buffer, view.byteOffset, view.byteLength).getInt32(0, true);

    async function runAffine(bytes, mode) {
      const { instance } = await WebAssembly.instantiate(Uint8Array.from(bytes), {});
      const memory = instance.exports.memory;
      if (!(memory instanceof WebAssembly.Memory)) throw new Error("affine memory export missing");
      const marker = instance.exports.__air_abi_feature_borrowed_slice_v1;
      if (!(marker instanceof WebAssembly.Global) || marker.value !== 0x000b0001) {
        throw new Error("affine borrowed-slice feature marker missing");
      }
      const srcOffset = 0;
      const dstOffset = 64;
      const hostInput = new Float32Array([1, 2, 3, 4]);
      let output;
      if (mode === "copied_into_wasm") {
        new Uint8Array(memory.buffer, srcOffset, hostInput.byteLength)
          .set(new Uint8Array(hostInput.buffer));
        const hostOutput = new Float32Array(4);
        instance.exports.affine(srcOffset, 16, dstOffset, 16, 4, 2, 0.5);
        new Uint8Array(hostOutput.buffer)
          .set(new Uint8Array(memory.buffer, dstOffset, hostOutput.byteLength));
        output = hostOutput;
      } else {
        const inputView = new Float32Array(memory.buffer, srcOffset, 4);
        const outputView = new Float32Array(memory.buffer, dstOffset, 4);
        inputView.set(hostInput);
        instance.exports.affine(srcOffset, 16, dstOffset, 16, 4, 2, 0.5);
        output = new Float32Array(outputView);
      }
      const outputBytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
      return {
        result: Array.from(output),
        outputBytes: Array.from(outputBytes)
      };
    }

    async function runChecksum(bytes, mode) {
      const { instance } = await WebAssembly.instantiate(Uint8Array.from(bytes), {});
      const memory = instance.exports.memory;
      if (!(memory instanceof WebAssembly.Memory)) throw new Error("checksum memory export missing");
      const marker = instance.exports.__air_abi_feature_borrowed_slice_v1;
      if (!(marker instanceof WebAssembly.Global) || marker.value !== 0x000b0001) {
        throw new Error("checksum borrowed-slice feature marker missing");
      }
      const inputOffset = 0;
      const stateOffset = 64;
      const hostInput = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
      const hostState = new Uint8Array(4);
      writeI32(hostState, 10);
      let stateView;
      if (mode === "copied_into_wasm") {
        new Uint8Array(memory.buffer, inputOffset, 16).set(hostInput);
        new Uint8Array(memory.buffer, stateOffset, 4).set(hostState);
        instance.exports.checksum(inputOffset, 16, stateOffset, 4, 4);
        hostState.set(new Uint8Array(memory.buffer, stateOffset, 4));
        stateView = hostState;
      } else {
        const inputView = new Uint8Array(memory.buffer, inputOffset, 16);
        stateView = new Uint8Array(memory.buffer, stateOffset, 4);
        inputView.set(hostInput);
        stateView.set(hostState);
        instance.exports.checksum(inputOffset, 16, stateOffset, 4, 4);
        stateView = new Uint8Array(stateView);
      }
      return {
        result: readI32(stateView),
        outputBytes: Array.from(stateView)
      };
    }

    const affineCopied = await runAffine(affine, "copied_into_wasm");
    const affineView = await runAffine(affine, "wasm_memory_view");
    const checksumCopied = await runChecksum(checksum, "copied_into_wasm");
    const checksumView = await runChecksum(checksum, "wasm_memory_view");
    return { affineCopied, affineView, checksumCopied, checksumView };
  }, {
    affine: Array.from(affineBytes),
    checksum: Array.from(checksumBytes)
  });
  const affineDigest = crypto.createHash("sha256").update(affineBytes).digest("hex");
  const checksumDigest = crypto.createHash("sha256").update(checksumBytes).digest("hex");
  for (const [name, item] of Object.entries(result)) {
    item.outputDigest = crypto.createHash("sha256")
      .update(Buffer.from(item.outputBytes))
      .digest("hex");
    item.wasmDigest = name.startsWith("affine") ? affineDigest : checksumDigest;
  }

  console.log(JSON.stringify({
    kind: "air.borrowedMemoryBrowserConformance",
    version: 1,
    browser: "playwright-chromium",
    result,
    runnerDigest: `sha256:${crypto.createHash("sha256")
      .update(fs.readFileSync(fileURLToPath(import.meta.url)))
      .digest("hex")}`
  }));
} finally {
  await browser.close();
}
