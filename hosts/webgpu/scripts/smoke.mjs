import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";
import { PNG } from "pngjs";

const url = "http://127.0.0.1:4183";
const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "4183"], {
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(url);
} catch (error) {
  server.kill("SIGTERM");
  throw error;
}

const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"]
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const status = await page.waitForFunction(
    () => {
      const text = document.querySelector("#status")?.textContent || "";
      if (text.includes("AIR wasm linked")) return "ready";
      if (text.includes("WebGPU unsupported") || text.includes("adapter unavailable") || text.includes("context unavailable")) return "unsupported";
      if (text.includes("failed") || text.includes("missing") || text.includes("unknown")) return `error:${text}`;
      return false;
    },
    null,
    { timeout: 30_000 }
  );
  const result = await status.jsonValue();
  if (typeof result === "string" && result.startsWith("error:")) throw new Error(result);
  if (result === "unsupported") {
    console.log("ok - WebGPU unsupported with clear status");
  } else {
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(420, 340);
    await page.mouse.up();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
    const screenshot = await page.screenshot({ path: "test-artifacts/airgfx-webgpu-smoke.png", fullPage: true });
    const pixels = analyzePng(screenshot);
    if (pixels.varied < 80 || pixels.maxLuma < 40) {
      throw new Error(`WebGPU canvas appears blank: ${JSON.stringify(pixels)}`);
    }
    const report = await page.evaluate(() => globalThis.__airgfxReport || null);
    if (!report || report.host !== "browser" || report.backend !== "webgpu") {
      throw new Error(`missing conformance report: ${JSON.stringify(report)}`);
    }
    if (report.module !== "gfx_showcase" || report.abi !== "0.10") {
      throw new Error(`wrong showcase package loaded: ${JSON.stringify(report)}`);
    }
    if (!report.supportedFeatures?.includes("render graph traversal")) {
      throw new Error(`missing supported feature diagnostics: ${JSON.stringify(report)}`);
    }
    if (!report.supportedFeatures?.includes("GLB/glTF model asset loading and GPU buffer upload")) {
      throw new Error(`missing GLB/glTF loading support diagnostics: ${JSON.stringify(report)}`);
    }
    if (!report.loadedAssets?.some((item) => item.includes("cube.glb"))) {
      throw new Error(`asset preflight did not load generated GLB fixture: ${JSON.stringify(report)}`);
    }
    if (!report.loadedModelAssets?.some((item) => item.includes("showcase_block:assets/cube.glb"))) {
      throw new Error(`GLB fixture was not parsed and uploaded: ${JSON.stringify(report)}`);
    }
    if (report.missingAssets?.length) {
      throw new Error(`unexpected missing assets: ${JSON.stringify(report)}`);
    }
    if (!report.unsupportedFeatures?.some((item) => item.includes("material texture sampling is not implemented"))) {
      throw new Error(`missing unsupported host feature diagnostics: ${JSON.stringify(report)}`);
    }
    if (!report.unsupportedGltfFeatures?.some((item) => item.includes("no mesh primitive with POSITION attribute"))) {
      throw new Error(`missing unsupported model feature diagnostics: ${JSON.stringify(report)}`);
    }
    if (!report.materialFallbacks?.some((item) => item.includes("default material fallback"))) {
      throw new Error(`missing fallback material diagnostics: ${JSON.stringify(report)}`);
    }
    if (!report.render || report.render.drawCalls <= 0) {
      throw new Error(`missing draw call count: ${JSON.stringify(report)}`);
    }
    const panel = await page.evaluate(() => ({
      packageName: document.querySelector("#diag-package")?.textContent || "",
      manifest: document.querySelector("#diag-manifest")?.textContent || "",
      backend: document.querySelector("#diag-backend")?.textContent || "",
      drawCalls: Number(document.querySelector("#diag-draw-calls")?.textContent || "0"),
      assets: document.querySelector("#diag-assets")?.textContent || "",
      unsupported: document.querySelector("#diag-unsupported")?.textContent || ""
    }));
    if (panel.packageName !== "gfx_showcase" || panel.manifest !== "0.10" || panel.backend !== "webgpu") {
      throw new Error(`diagnostics panel did not render package metadata: ${JSON.stringify(panel)}`);
    }
    if (panel.drawCalls <= 0 || !panel.assets.includes("cube.glb")) {
      throw new Error(`diagnostics panel did not render runtime state: ${JSON.stringify(panel)}`);
    }
    if (!panel.unsupported.includes("material fallback used")) {
      throw new Error(`diagnostics panel did not render material fallback diagnostics: ${JSON.stringify(panel)}`);
    }
    if (!report.inputs?.includes("orbit_x") || !report.input || report.input.pointerDeltaX === 0) {
      throw new Error(`input conformance did not update: ${JSON.stringify(report)}`);
    }
    console.log(`ok - WebGPU smoke ${JSON.stringify({ ...pixels, report })}`);
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

async function waitForServer(target) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 30_000) {
    if (server.exitCode !== null) throw new Error(`vite exited before smoke test started: ${server.exitCode}`);
    try {
      const status = await httpStatus(target);
      if (status >= 200 && status < 500) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite did not start: ${lastError}`);
}

function httpStatus(target) {
  return new Promise((resolve, reject) => {
    const req = http.get(target, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", reject);
    req.setTimeout(1000, () => req.destroy(new Error("request timed out")));
  });
}

function analyzePng(buffer) {
  const png = PNG.sync.read(buffer);
  let varied = 0;
  let maxLuma = 0;
  for (let y = 0; y < png.height; y += 8) {
    for (let x = 0; x < png.width; x += 8) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      const luma = r + g + b;
      if (Math.abs(r - 5) + Math.abs(g - 7) + Math.abs(b - 18) > 24) varied += 1;
      if (luma > maxLuma) maxLuma = luma;
    }
  }
  return { varied, maxLuma, width: png.width, height: png.height };
}
