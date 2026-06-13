#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { buildPackage } = require("../src/sdk");

const root = path.resolve(__dirname, "..");
const node = process.execPath;
const airc = path.join(root, "bin", "airc.js");
const fixtureDir = path.join(root, "examples", "ai_generated");
const promptFile = path.join(fixtureDir, "network_health_prompt.md");
const generatedFile = path.join(fixtureDir, "network_health_generated.air");
const outDir = path.join(root, "build", "prompt-to-module-demo");
const workAir = path.join(outDir, "generated.air");
const formattedAir = path.join(outDir, "formatted.air");
const wasmFile = path.join(outDir, "ai_generated_health_score.wasm");
const packageDir = path.join(outDir, "package");

async function main() {
  const steps = [];
  resetOutputDir();

  step(steps, "copy prompt fixture", () => {
    ensureFile(promptFile);
    ensureFile(generatedFile);
    fs.copyFileSync(promptFile, path.join(outDir, "prompt.md"));
    fs.copyFileSync(generatedFile, workAir);
  });

  step(steps, "format module", () => {
    const formatted = run([airc, "fmt", workAir]);
    fs.writeFileSync(formattedAir, formatted);
  });

  step(steps, "verify module", () => {
    run([airc, "verify", formattedAir]);
  });

  step(steps, "explain module", () => {
    fs.writeFileSync(path.join(outDir, "explain.txt"), run([airc, "explain", formattedAir]));
  });

  step(steps, "audit module", () => {
    fs.writeFileSync(path.join(outDir, "audit.txt"), run([airc, "audit", formattedAir]));
  });

  let report = null;
  step(steps, "write JSON report with AI review", () => {
    const text = run([airc, "report", formattedAir, "--ai-review"]);
    fs.writeFileSync(path.join(outDir, "report.json"), text);
    report = JSON.parse(text);
    if (report.status !== "pass") throw new Error(`report status is ${report.status}`);
    if (!report.aiReview) throw new Error("report is missing aiReview");
  });

  step(steps, "build wasm", () => {
    run([airc, "build", formattedAir, "--emit", "wasm", "-o", wasmFile]);
  });

  await asyncStep(steps, "build AIR package", async () => {
    await buildPackage({ air: formattedAir, out: packageDir });
  });

  let packageCheck = null;
  step(steps, "package-check", () => {
    const text = run([airc, "package-check", packageDir]);
    fs.writeFileSync(path.join(outDir, "package-check.txt"), text);
    packageCheck = JSON.parse(text.trim().split("\n").pop());
    if (!packageCheck.ok) throw new Error("package-check returned ok=false");
  });

  printSummary(steps, report, packageCheck);
}

function resetOutputDir() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
}

function ensureFile(file) {
  if (!fs.existsSync(file)) throw new Error(`missing fixture: ${relative(file)}`);
}

function step(steps, name, fn) {
  try {
    fn();
    steps.push({ name, status: "pass" });
  } catch (err) {
    steps.push({ name, status: "fail" });
    fail(name, err);
  }
}

async function asyncStep(steps, name, fn) {
  try {
    await fn();
    steps.push({ name, status: "pass" });
  } catch (err) {
    steps.push({ name, status: "fail" });
    fail(name, err);
  }
}

function run(args) {
  try {
    return execFileSync(node, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const command = ["node", ...args.map(relative)].join(" ");
    const stdout = err.stdout ? String(err.stdout).trim() : "";
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    const details = [`command: ${command}`];
    if (stdout) details.push(`stdout:\n${stdout}`);
    if (stderr) details.push(`stderr:\n${stderr}`);
    details.push(`repair: inspect ${relative(formattedAir)} and rerun the failing command.`);
    throw new Error(details.join("\n"));
  }
}

function printSummary(steps, report, packageCheck) {
  console.log("AIR v0.11 prompt-to-module demo");
  console.log(`prompt: ${relative(promptFile)}`);
  console.log(`generated: ${relative(generatedFile)}`);
  console.log(`output: ${relative(outDir)}`);
  for (const item of steps) {
    console.log(`${item.status === "pass" ? "ok" : "not ok"} - ${item.name}`);
  }
  console.log(`module: ${report.moduleName}`);
  console.log(`abi: ${report.airAbiVersion}`);
  console.log(`exports: ${report.exports.map((item) => item.name).join(", ") || "none"}`);
  console.log(`capabilities: ${report.capabilities.join(", ") || "none"}`);
  console.log(`host imports: ${report.hostImports.map((item) => item.name).join(", ") || "none"}`);
  console.log(`ai review: ${report.aiReview.status}; warnings=${report.aiReview.warnings.length}`);
  console.log(`package module: ${packageCheck.module}`);
  console.log("summary: pass");
}

function fail(name, err) {
  console.error(`not ok - ${name}`);
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
}

function relative(file) {
  const resolved = path.resolve(String(file));
  return resolved.startsWith(root) ? path.relative(root, resolved) || "." : String(file);
}

main().catch((err) => fail("prompt-to-module demo", err));
