#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

function main() {
  runV027Gate();
  for (const packageDir of listExamplePackageRoots(path.join(root, "examples"))) {
    checkCanonicalOutputEmitPackage(packageDir);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("api gates v0.28: ok");
}

function runV027Gate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_27.js");
  const result = childProcess.spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkCanonicalOutputEmitPackage(packageDir) {
  const manifestPath = path.join(packageDir, "air.package.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_err) {
    return;
  }
  const generatedModules = (manifest.generatedModules || []).map((item) => String(item.path || item).replace(/\\/g, "/"));
  const usesGeneratedOutputHandles = generatedModules.includes("generated/output_handles.air");
  if (!usesGeneratedOutputHandles) return;

  const relPackage = normalize(path.relative(root, packageDir));
  const generatedSource = path.join(packageDir, "generated", "output_handles.air");
  if (fs.existsSync(generatedSource)) {
    const text = fs.readFileSync(generatedSource, "utf8");
    if (/\bfunc\b/.test(text) || /\bextern\b/.test(text) || /@output\.emit\b/.test(text)) {
      failures.push(`${relPackage}/generated/output_handles.air: generated output handles must contain constants only`);
    }
  }

  for (const airFile of listFiles(packageDir).filter((file) => file.endsWith(".air"))) {
    const rel = normalize(path.relative(root, airFile));
    if (rel.endsWith("generated/output_handles.air")) continue;
    const text = fs.readFileSync(airFile, "utf8");
    const calls = text.match(/@output\.emit\s*\(([^)]*)\)/g) || [];
    for (const call of calls) {
      const firstArg = call.replace(/^.*@output\.emit\s*\(/, "").split(",")[0].trim();
      if (/^-?\d+$/.test(firstArg)) {
        failures.push(`${rel}: canonical output.emit call must use generated OUTPUT_* handle, not raw numeric output_id`);
      } else if (firstArg.startsWith("%")) {
        failures.push(`${rel}: output.emit output_id must remain statically resolvable; dynamic SSA values are deferred`);
      } else if (!/^OUTPUT_[A-Z0-9_]+$/.test(firstArg)) {
        failures.push(`${rel}: canonical output.emit call must use an OUTPUT_* generated handle constant`);
      }
    }
  }
}

function listExamplePackageRoots(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(full, "air.package.json"))) out.push(full);
  }
  return out.sort();
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function normalize(value) {
  return value.split(path.sep).join("/");
}

main();
