#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const demosRoot = path.join(root, "demos");

const DEMOS = {
  "air-tetris": {
    maturity: "primary showcase",
    requiredText: ["deterministic game rules", "host rendering", "host input"]
  },
  "air-voxel": {
    maturity: "visual/3D host-composition showcase",
    requiredText: ["bounded voxel", "host rendering", "3D"]
  },
  "air-world": {
    maturity: "experimental semantic world showcase",
    requiredText: ["semantic object", "world representation", "experimental"]
  }
};

const REQUIRED_DIRS = ["air", "src", "evidence", "screenshots"];
const REQUIRED_README_TEXT = [
  "Status: experimental alpha demo",
  "What it demonstrates",
  "What AIR owns",
  "What the host owns",
  "Install/build/run commands",
  "AIR verify/package/check commands",
  "Known limitations",
  "AIR is not a game engine",
  "AIR is not a 3D engine"
];

const FORBIDDEN_PATTERNS = [
  /(^|[/\\])node_modules($|[/\\])/,
  /(^|[/\\])dist($|[/\\])/,
  /(^|[/\\])build($|[/\\])/,
  /(^|[/\\])review_bundles($|[/\\])/,
  /(^|[/\\])REVIEW_RESULTS($|[/\\])/,
  /(^|[/\\])public_export($|[/\\])/,
  /(^|[/\\])prompts?($|[/\\])/i,
  /PROMPTS\.md$/i,
  /raw.*chat/i,
  /\.tgz$/i,
  /\.zip$/i,
  /\.tar\.gz$/i,
  /\.wasm$/i,
  /\.env$/i,
  /\.npmrc$/i
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory()) walk(full, out);
  }
  return out;
}

function checkDemo(id) {
  const diagnostics = [];
  const demoDir = path.join(demosRoot, id);
  const readmePath = path.join(demoDir, "README.md");
  const packagePath = path.join(demoDir, "package.json");

  if (!fs.existsSync(demoDir)) {
    diagnostics.push({ code: "missing_demo_dir", path: path.relative(root, demoDir) });
  }
  for (const dir of REQUIRED_DIRS) {
    const full = path.join(demoDir, dir);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      diagnostics.push({ code: "missing_demo_subdir", path: path.relative(root, full) });
    }
  }

  let readme = "";
  if (!fs.existsSync(readmePath)) {
    diagnostics.push({ code: "missing_readme", path: path.relative(root, readmePath) });
  } else {
    readme = fs.readFileSync(readmePath, "utf8");
    for (const text of REQUIRED_README_TEXT) {
      if (!readme.includes(text)) {
        diagnostics.push({ code: "missing_readme_text", demo: id, text });
      }
    }
    for (const text of DEMOS[id].requiredText) {
      if (!readme.toLowerCase().includes(text.toLowerCase())) {
        diagnostics.push({ code: "missing_demo_specific_text", demo: id, text });
      }
    }
  }

  if (!fs.existsSync(packagePath)) {
    diagnostics.push({ code: "missing_package_json", path: path.relative(root, packagePath) });
  } else {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    if (pkg.private !== true) {
      diagnostics.push({ code: "demo_package_not_private", demo: id });
    }
    if (!pkg.scripts || typeof pkg.scripts.check !== "string") {
      diagnostics.push({ code: "missing_demo_check_script", demo: id });
    }
  }

  for (const item of walk(demoDir)) {
    const rel = path.relative(root, item);
    if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(rel))) {
      diagnostics.push({ code: "forbidden_demo_artifact", path: rel });
    }
  }

  return {
    id,
    maturity: DEMOS[id].maturity,
    status: diagnostics.length === 0 ? "passed" : "failed",
    diagnostics
  };
}

const requested = process.argv.slice(2);
const ids = requested.length > 0 ? requested : Object.keys(DEMOS);
const unknown = ids.filter((id) => !DEMOS[id]);
const results = ids.filter((id) => DEMOS[id]).map(checkDemo);
const diagnostics = unknown.map((id) => ({ code: "unknown_demo", demo: id }));
for (const result of results) diagnostics.push(...result.diagnostics);

const report = {
  kind: "air.demoShowcaseCheck",
  status: diagnostics.length === 0 ? "passed" : "failed",
  checked: ids.filter((id) => DEMOS[id]),
  results,
  diagnostics
};

console.log(JSON.stringify(report, null, 2));
if (diagnostics.length > 0) process.exit(1);
