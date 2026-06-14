const fs = require("fs");
const path = require("path");

const EXPECTED_PROD = "/Users/sky/DEV/air-core";
const EXPECTED_DEV = "/Users/sky/DEV/airlang";
const EXPECTED_PACKAGE = "@underskys/air-core";

const cwd = process.cwd();
const isCi = Boolean(process.env.CI);
const warnings = [];
const blockers = [];

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function real(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { error: error.message };
  }
}

function readPackage(repoPath) {
  const pkgPath = path.join(repoPath, "package.json");
  if (!exists(pkgPath)) {
    return null;
  }
  const pkg = readJson(pkgPath);
  if (pkg.error) {
    return { error: pkg.error };
  }
  return {
    name: pkg.name,
    version: pkg.version,
    bin: pkg.bin,
    private: pkg.private,
  };
}

function walkFiles(root, files = []) {
  if (!exists(root)) {
    return files;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      walkFiles(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function scanPublicDocs(prodPath) {
  const candidates = [
    "package.json",
    "package-lock.json",
    "README.md",
    "CHANGELOG.md",
    "VERSIONING.md",
    ".gitlab-ci.yml",
  ]
    .map((name) => path.join(prodPath, name))
    .filter(exists);

  const docsRoot = path.join(prodPath, "docs");
  for (const file of walkFiles(docsRoot)) {
    candidates.push(file);
  }

  const hits = [];
  for (const file of candidates) {
    const rel = path.relative(prodPath, file);
    const text = fs.readFileSync(file, "utf8");
    const stalePatterns = [
      { label: "legacy verifier package identity", pattern: /\bair-verifier\b/ },
      { label: "dev package global install command", pattern: /npm\s+install\s+-g\s+airlang\b/ },
    ];
    for (const stale of stalePatterns) {
      if (stale.pattern.test(text)) {
        hits.push(`${rel}: ${stale.label}`);
      }
    }
  }
  return hits;
}

const prodExists = exists(EXPECTED_PROD);
const devExists = exists(EXPECTED_DEV);
const cwdReal = real(cwd);
const prodReal = real(EXPECTED_PROD);
const devReal = real(EXPECTED_DEV);

console.log("AIR workspace state");
console.log(`cwd: ${cwd}`);
console.log(`production repo expected: ${EXPECTED_PROD} (${prodExists ? "present" : "missing"})`);
console.log(`dev repo expected: ${EXPECTED_DEV} (${devExists ? "present" : "missing"})`);

if (!prodExists && !isCi) {
  blockers.push(`production repo is missing at ${EXPECTED_PROD}`);
}

if (!devExists) {
  warnings.push(`dev/private repo is missing at ${EXPECTED_DEV}; continuing`);
}

const prodPackage = prodExists ? readPackage(EXPECTED_PROD) : readPackage(cwd);
if (prodPackage) {
  console.log(`production package: ${prodPackage.name || "<missing>"} ${prodPackage.version || "<missing>"}`);
} else {
  blockers.push("production package.json is missing");
}

const devPackage = devExists ? readPackage(EXPECTED_DEV) : null;
if (devPackage) {
  if (devPackage.error) {
    warnings.push(`dev package.json is invalid: ${devPackage.error}`);
  } else {
    console.log(`dev package: ${devPackage.name || "<missing>"} ${devPackage.version || "<missing>"}`);
  }
}

const cwdPackage = readPackage(cwd);
if (!cwdPackage || cwdPackage.error) {
  blockers.push("current directory does not contain a readable package.json");
} else {
  console.log(`current package: ${cwdPackage.name || "<missing>"} ${cwdPackage.version || "<missing>"}`);
}

if (devReal && cwdReal === devReal) {
  blockers.push("current directory is the dev/private airlang repo; release checks must run from air-core");
}

if (cwdPackage && !cwdPackage.error && cwdPackage.name !== EXPECTED_PACKAGE) {
  blockers.push(`current package name is ${cwdPackage.name || "<missing>"}, expected ${EXPECTED_PACKAGE}`);
}

if (prodPackage && !prodPackage.error && prodPackage.name !== EXPECTED_PACKAGE) {
  blockers.push(`production package name is ${prodPackage.name || "<missing>"}, expected ${EXPECTED_PACKAGE}`);
}

if (prodReal && cwdReal && cwdReal !== prodReal) {
  warnings.push(`current directory is not ${EXPECTED_PROD}; verify release commands are running from the production checkout`);
}

const scanRoot = prodExists ? EXPECTED_PROD : cwd;
const staleHits = scanPublicDocs(scanRoot);
for (const hit of staleHits) {
  blockers.push(`stale public reference: ${hit}`);
}

for (const warning of warnings) {
  console.warn(`WARN: ${warning}`);
}

if (blockers.length > 0) {
  for (const blocker of blockers) {
    console.error(`ERROR: ${blocker}`);
  }
  process.exit(1);
}

console.log("OK: workspace state is release-safe for air-core local checks.");

