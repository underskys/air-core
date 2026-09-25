#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const keep = process.argv.includes("--keep");
const structureOnly = process.argv.includes("--structure-only") || process.env.AIR_REVIEW_BUNDLE_STRUCTURE_ONLY === "1";
const allowDirtyReviewBundle = process.argv.includes("--allow-dirty") || process.env.AIR_ALLOW_DIRTY_REVIEW_BUNDLE === "1";
const reviewBundleConfig = readReviewBundleConfig();
const stripDemos = process.env.STRIP_DEMOS === "1";

function main() {
  const requirements = collectRequirements();
  const bundle = createReviewBundle();
  const included = listBundleFiles(bundle.archive);
  const missing = requirements.filter((item) => !included.has(item.file));
  const forbidden = forbiddenBundleFiles(included);
  const metadataErrors = structureOnly ? [] : validateBundleMetadata(bundle.archive, included);

  if (missing.length || forbidden.length || metadataErrors.length) {
    console.error("Review bundle sanity check failed.");
    console.error("");
    if (missing.length) {
      console.error("Missing required files:");
      for (const item of missing.sort(compareRequirement)) {
        console.error(`- ${item.file}`);
        console.error(`  referenced by: ${item.referencedBy}`);
        console.error(`  required for: ${item.requiredFor}`);
      }
      console.error("");
    }
    if (forbidden.length) {
      console.error("Forbidden traversal output:");
      for (const item of forbidden.slice(0, 50)) console.error(`- ${item}`);
      if (forbidden.length > 50) console.error(`- ... ${forbidden.length - 50} more`);
      console.error("");
    }
    if (metadataErrors.length) {
      console.error("Metadata errors:");
      for (const item of metadataErrors) console.error(`- ${item}`);
      console.error("");
    }
    console.error(`Fix ${reviewBundleConfig.script} allowlist/export rules, or change tests/docs to use an explicit review-safe mode.`);
    cleanup(bundle.tmpDir);
    process.exit(1);
  }

  console.log(`Review bundle sanity check passed: ${requirements.length} required file(s) present.`);
  console.log(`Archive: ${bundle.archive}`);
  if (!keep) cleanup(bundle.tmpDir);
}

function collectRequirements() {
  const requirements = new Map();
  const add = (file, referencedBy, requiredFor) => {
    const normalized = normalizeFile(file);
    if (!normalized || !fs.existsSync(path.join(root, normalized))) return;
    if (isCoreReviewExcludedFile(normalized)) return;
    const key = `${normalized}\0${referencedBy}\0${requiredFor}`;
    requirements.set(key, { file: normalized, referencedBy, requiredFor });
  };

  collectPackageScriptRequirements(add);
  collectTestRequirements(add);
  collectReviewSafeFixtureRequirements(add);
  collectEvalReviewFixtureRequirements(add);
  collectEvidenceReportFixtureRequirements(add);
  collectManifestRequirements(add);
  collectReadmeCommandRequirements(add);
  collectMarkdownLinkRequirements(add);
  collectPromptLibraryRequirements(add);

  return Array.from(requirements.values());
}

function collectPromptLibraryRequirements(add) {
  for (const file of findFiles(path.join(root, "prompts"), ".md")) {
    add(file, "prompts/ AI authoring surface", "prompt library");
  }
}

function collectPackageScriptRequirements(add) {
  for (const packageFile of findFiles(root, "package.json")) {
    if (packageFile.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const packageDir = path.dirname(packageFile);
    const relativePackage = path.relative(root, packageFile);
    if (relativePackage.startsWith(`demo${path.sep}`)) continue;
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    for (const [name, script] of Object.entries(pkg.scripts || {})) {
      for (const file of filesFromCommand(String(script), packageDir)) {
        add(file, `${relativePackage} script '${name}'`, "package scripts");
      }
    }
    if (pkg.bin && typeof pkg.bin === "object") {
      for (const [name, target] of Object.entries(pkg.bin)) {
        add(path.resolve(packageDir, String(target)), `${relativePackage} bin '${name}'`, "package scripts");
      }
    }
  }
}

function collectTestRequirements(add) {
  if (stripDemos) return;
  for (const file of findFiles(path.join(root, "test"), ".js")) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file);
    for (const required of relativeModuleRequires(source, path.dirname(file))) {
      add(required, `${relative} import`, "tests");
    }
    for (const literal of quotedLiterals(source)) {
      for (const candidate of testFixtureCandidates(literal, path.dirname(file))) {
        add(candidate, `${relative} fixture '${literal}'`, "tests");
      }
    }
  }
}

function collectEvalReviewFixtureRequirements(add) {
  for (const file of [
    ...findFiles(path.join(root, "evals", "ai_authoring", "prompts"), ".md"),
    ...findFiles(path.join(root, "evals", "ai_authoring", "captured", "model_outputs"), ".json"),
    ...findFiles(path.join(root, "evals", "ai_authoring", "captured", "repair_transcripts"), ".json"),
    path.join(root, "evals", "ai_authoring", "expected", "constraints.json"),
    path.join(root, "evals", "ai_authoring", "reports", "README.md")
  ]) {
    add(file, "evals/ai_authoring replay fixtures", "AI authoring eval review");
  }
}

function collectEvidenceReportFixtureRequirements(add) {
  const fixtureDir = path.join(root, "test", "fixtures", "evidence_report");
  for (const file of [
    path.join(fixtureDir, "README.md"),
    ...findFiles(fixtureDir, ".golden.md"),
    ...findFiles(fixtureDir, ".json")
  ]) {
    add(file, "test/fixtures/evidence_report golden fixtures", "evidence review surface");
  }
}

function collectReviewSafeFixtureRequirements(add) {
  for (const fixtureDir of [
    path.join(root, "fixtures", "v050"),
    path.join(root, "fixtures", "semantic_patch")
  ]) {
    for (const file of findAllFiles(fixtureDir)) {
      add(file, "frozen and semantic-patch fixtures", "full source review tests");
    }
  }
  for (const file of [
    path.join(root, "test", "fixtures", "format", "canonical", "README.md"),
    ...findFiles(path.join(root, "test", "fixtures", "lowering"), "README.md"),
    path.join(root, "examples", "ai_gate", "swift_host", "Package.swift"),
    ...findFiles(path.join(root, "examples", "ai_gate", "swift_host", "Sources"), ".swift"),
    path.join(root, "examples", "borrowed_slices", ".npmignore")
  ]) {
    add(file, "reviewable public source fixtures", "full source review tests");
  }
  for (const file of findFiles(path.join(root, "test", "fixtures"), ".air")) {
    add(file, "test/fixtures/**/*.air", "tests");
  }
  for (const fixtureDir of [
    path.join(root, "test", "fixtures", "assets_minimal"),
    path.join(root, "test", "fixtures", "package_minimal")
  ]) {
    for (const file of findAllFiles(fixtureDir)) {
      add(file, "test/fixtures review-safe package/asset fixtures", "tests");
    }
  }
  for (const file of [
    "examples/package_manifest/assets/audio/package_click.wav",
    "examples/assets/audio/music/jungle-1.mp3",
    "examples/assets/audio/sfx/heal.wav",
    "examples/assets/audio/silence.wav",
    "examples/assets/models/crate.glb",
    "examples/assets/rigs/player_rig.json",
    "examples/assets/shaders/unlit_mesh.wgsl",
    "examples/assets/sprites/player_idle.png",
    "examples/assets/textures/fallback.png"
  ]) {
    add(path.join(root, file), "review-safe asset fixture", "tests");
  }
}

function collectManifestRequirements(add) {
  for (const manifestFile of findFiles(path.join(root, "examples"), ".airgfx.json")) {
    const relative = path.relative(root, manifestFile);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    for (const referenced of manifestFileRefs(manifest, path.dirname(manifestFile))) {
      add(referenced.file, `${relative} ${referenced.pointer}`, "examples");
    }
  }
}

function collectReadmeCommandRequirements(add) {
  for (const file of [path.join(root, "README.md"), ...findFiles(path.join(root, "examples"), "README.md")]) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file);
    for (const line of source.split(/\r?\n/)) {
      if (!/\b(node|npm|bash)\b|bin\/airc|tools\//.test(line)) continue;
      for (const required of filesFromCommand(line.replace(/^[-*]\s*/, ""), root)) {
        add(required, `${relative} command '${line.trim()}'`, "docs");
      }
    }
  }
}

function collectMarkdownLinkRequirements(add) {
  for (const file of markdownFilesForPublicDocs()) {
    const relative = path.relative(root, file);
    if (stripDemos && relative.startsWith(`demo${path.sep}`)) continue;
    const source = stripCodeFences(fs.readFileSync(file, "utf8"));
    for (const link of markdownLinks(source)) {
      const resolved = resolveMarkdownLocalLink(file, link.href);
      if (stripDemos && resolved && path.relative(root, resolved).startsWith(`demo${path.sep}`)) continue;
      if (resolved) add(resolved, `${relative} link '${link.href}'`, "docs");
    }
  }
}

function createReviewBundle() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "airlang-review-gate-"));
  const outDir = path.join(tmpDir, "out");
  fs.mkdirSync(outDir, { recursive: true });
  childProcess.execFileSync("bash", [path.join(root, reviewBundleConfig.script), root], {
    cwd: root,
    env: {
      ...process.env,
      AIR_ALLOW_DIRTY_REVIEW_BUNDLE: structureOnly ? "1" : process.env.AIR_ALLOW_DIRTY_REVIEW_BUNDLE,
      BUNDLE_PROFILE: structureOnly ? "structure-only" : process.env.BUNDLE_PROFILE,
      OUT_DIR: outDir,
      BUNDLE_RETENTION: String(reviewBundleConfig.retention || 10)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const archives = fs.readdirSync(outDir).filter((name) => name.endsWith(".zip") || name.endsWith(".tar.gz")).sort();
  if (!archives.length) throw new Error("review bundle script did not create an archive");
  return { tmpDir, archive: path.join(outDir, archives[archives.length - 1]) };
}

function readReviewBundleConfig() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const config = pkg.config?.reviewBundle || {};
  return {
    version: config.version || "2.0",
    script: config.script || "scripts/make_review_bundle.sh",
    retention: Number(config.retention || 10)
  };
}

function listBundleFiles(archive) {
  const raw = listArchiveEntries(archive);
  const files = new Set();
  for (const name of raw.split(/\r?\n/).filter(Boolean)) {
    const parts = name.split("/");
    if (parts.length > 1) files.add(parts.slice(1).join("/"));
  }
  return files;
}

function listArchiveEntries(archive) {
  const raw = archive.endsWith(".zip")
    ? childProcess.execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    : childProcess.execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  return raw;
}

function readBundleFile(archive, relativeFile) {
  const entry = listArchiveEntries(archive)
    .split(/\r?\n/)
    .filter(Boolean)
    .find((name) => name.endsWith(`/${relativeFile}`));
  if (!entry) return null;
  return archive.endsWith(".zip")
    ? childProcess.execFileSync("unzip", ["-p", archive, entry], { encoding: "utf8" })
    : childProcess.execFileSync("tar", ["-xOzf", archive, entry], { encoding: "utf8" });
}

function validateBundleMetadata(archive, included) {
  const errors = [];
  const snapshot = readBundleFile(archive, "SNAPSHOT_COMMIT.txt") || "";
  const snapshotStatus = readBundleFile(archive, "SNAPSHOT_STATUS.txt") || "";
  const prebundleGit = readBundleFile(archive, "SNAPSHOT_PREBUNDLE_GIT.txt") || "";
  const redFlags = readBundleFile(archive, "REVIEW_RESULTS/RED_FLAGS.md") || "";
  const bundleProfile = matchValue(snapshot, /^bundle_profile:\s*(\S+)/m) || "review";
  const snapshotBranch = matchValue(snapshot, /^branch:\s*(\S+)/m) || "";
  const dirty = snapshotStatus.trim() !== "";
  const hasReviewSummary = included.has("REVIEW_RESULTS/SUMMARY.md");

  if (!prebundleGit.trim()) {
    errors.push("SNAPSHOT_PREBUNDLE_GIT.txt is missing or empty. Run scripts/make_review_bundle.sh from a git checkout with the pre-bundle git ritual enabled.");
  } else {
    if (/PREBUNDLE_GIT_FAILED/.test(prebundleGit)) {
      errors.push("SNAPSHOT_PREBUNDLE_GIT.txt reports PREBUNDLE_GIT_FAILED. Re-run the pre-bundle git ritual and fix branch/upstream/git command failures before review.");
    }
    if (!/\$ git rev-parse --abbrev-ref --symbolic-full-name @\{upstream\}/.test(prebundleGit)) {
      errors.push("SNAPSHOT_PREBUNDLE_GIT.txt does not record current branch upstream detection.");
    }
    if (snapshotBranch && snapshotBranch !== "core/v0.24" && /origin\/core\/v0\.24/.test(prebundleGit)) {
      errors.push(`SNAPSHOT_PREBUNDLE_GIT.txt compares ${snapshotBranch} to hardcoded origin/core/v0.24 instead of its upstream.`);
    }
  }

  if (dirty) {
    const dirtyFlag = /^-\s+FLAG:\s+dirty working tree\b/m.test(redFlags);
    const dirtyWarning = /^-\s+WARNING:\s+dirty working tree\b/m.test(redFlags);
    const strictDirtyProfile = /^(core-rc|review)$/i.test(bundleProfile);

    if (strictDirtyProfile && !allowDirtyReviewBundle) {
      errors.push(`SNAPSHOT_STATUS.txt is dirty for bundle_profile=${bundleProfile}. Commit or stash changes before creating a Core review bundle, or set AIR_ALLOW_DIRTY_REVIEW_BUNDLE=1 only for an explicit dirty planning/debug snapshot.`);
    }
    if (hasReviewSummary && !redFlags.trim()) {
      errors.push("SNAPSHOT_STATUS.txt is dirty but REVIEW_RESULTS/RED_FLAGS.md is missing or empty. Re-run bash scripts/run_rc_checks.sh on the current source checkout.");
    } else if (redFlags.trim() && strictDirtyProfile && !dirtyFlag) {
      errors.push(`SNAPSHOT_STATUS.txt is dirty for bundle_profile=${bundleProfile} but REVIEW_RESULTS/RED_FLAGS.md does not report FLAG: dirty working tree. Re-run bash scripts/run_rc_checks.sh on the current source checkout.`);
    } else if (redFlags.trim() && !strictDirtyProfile && !dirtyFlag && !dirtyWarning) {
      errors.push(`SNAPSHOT_STATUS.txt is dirty for bundle_profile=${bundleProfile} but REVIEW_RESULTS/RED_FLAGS.md does not report FLAG or WARNING: dirty working tree. Dirty planning snapshots must be explicit.`);
    }
    if (/^-\s+OK:\s+working tree status\b/m.test(redFlags)) {
      errors.push("SNAPSHOT_STATUS.txt is dirty but REVIEW_RESULTS/RED_FLAGS.md reports OK: working tree status. Re-run bash scripts/run_rc_checks.sh after fixing red flag generation.");
    }
  }

  if (!hasReviewSummary) return errors;
  const summary = readBundleFile(archive, "REVIEW_RESULTS/SUMMARY.md") || "";
  if (isHistoricalReviewSummary(summary)) return errors;
  if (dirty && allowDirtyReviewBundle && !/dirty planning snapshot/i.test(summary)) {
    errors.push("SNAPSHOT_STATUS.txt is dirty and AIR_ALLOW_DIRTY_REVIEW_BUNDLE=1 is set, but REVIEW_RESULTS/SUMMARY.md does not label this as a dirty planning snapshot.");
  }
  const snapshotCommit = matchValue(snapshot, /^commit_full:\s*(\S+)/m) || matchValue(snapshot, /^commit_short:\s*(\S+)/m);
  const summaryCommit = matchValue(summary, /^Commit:\s*`([^`]+)`/m);
  if (!snapshotCommit || !summaryCommit) {
    errors.push("REVIEW_RESULTS/SUMMARY.md commit validation failed: missing Commit line or SNAPSHOT_COMMIT.txt commit metadata. Run bash scripts/run_rc_checks.sh before bundling.");
    return errors;
  }
  if (!commitsMatch(snapshotCommit, summaryCommit)) {
    errors.push(`REVIEW_RESULTS/SUMMARY.md commit ${summaryCommit} does not match bundle snapshot commit ${snapshotCommit}. Run bash scripts/run_rc_checks.sh on the current source checkout before creating the review bundle.`);
  }
  return errors;
}

function isHistoricalReviewSummary(summary) {
  return /^#\s+Superseded\b/m.test(summary) || /\bStatus:\s*historical\b/i.test(summary);
}

function matchValue(source, re) {
  const match = source.match(re);
  return match ? match[1] : null;
}

function commitsMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 7 && b.startsWith(a)) return true;
  if (b.length >= 7 && a.startsWith(b)) return true;
  return false;
}

function forbiddenBundleFiles(files) {
  const forbidden = [];
  for (const file of files) {
    if (/(^|\/)node_modules\//.test(file)) forbidden.push(file);
    if (/(^|\/)(tmp_unused|old_bundles|assets_tmp_unused_previous)\//.test(file)) forbidden.push(file);
    if (/(^|\/)references\/full_pose\//.test(file)) forbidden.push(file);
    if (isCoreReviewExcludedFile(file)) forbidden.push(file);
  }
  return Array.from(new Set(forbidden)).sort();
}

function isCoreReviewExcludedFile(file) {
  const normalized = file.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (/^demo\/[^/]+\/assets\/.*\.(png|jpe?g|webp|gif|svg|mp3|wav|ogg)$/.test(lower)) return true;
  if (/^demo\/[^/]+\/(public|dist|wasm)\//.test(lower)) return true;
  if (/^demo\/[^/]+\/(tmp_unused|old_bundles)\//.test(lower)) return true;
  if (/(^|\/)assets_tmp_unused_previous\//.test(lower)) return true;
  if (/(^|\/)references\/full_pose\//.test(lower)) return true;
  return false;
}

function filesFromCommand(command, baseDir) {
  const out = [];
  for (const token of shellTokens(command)) {
    const cleaned = token.replace(/^['"]|['"]$/g, "");
    if (!looksLikePath(cleaned)) continue;
    const resolved = path.resolve(baseDir, cleaned);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) out.push(resolved);
  }
  return out;
}

function shellTokens(command) {
  return command.match(/(?:"[^"]+"|'[^']+'|[^\s\\]+)(?:\\\s*(?:"[^"]+"|'[^']+'|[^\s\\]+))*/g) || [];
}

function relativeModuleRequires(source, baseDir) {
  const out = [];
  const re = /\b(?:require\(|from\s+|import\()\s*["'](\.{1,2}\/[^"']+)["']/g;
  let match;
  while ((match = re.exec(source))) {
    const resolved = resolveModulePath(path.resolve(baseDir, match[1]));
    if (resolved) out.push(resolved);
  }
  return out;
}

function resolveModulePath(base) {
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.json`,
    path.join(base, "index.js"),
    path.join(base, "index.mjs")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function quotedLiterals(source) {
  const values = [];
  const re = /["']([^"'\n]+)["']/g;
  let match;
  while ((match = re.exec(source))) values.push(match[1]);
  return values;
}

function testFixtureCandidates(literal, baseDir) {
  if (!/\.(air|airgfx\.json|json|wgsl|gltf|glb|svg|mjs|js|md)$/i.test(literal)) return [];
  if (/^(node:|https?:|@)/.test(literal)) return [];
  const candidates = [];
  if (looksLikePath(literal)) {
    candidates.push(path.resolve(baseDir, literal));
    candidates.push(path.resolve(root, literal));
  }
  for (const prefix of ["examples", "stdlib", "kits", "spec", "tools", "scripts", "hosts", "test/fixtures"]) {
    candidates.push(path.join(root, prefix, literal));
  }
  return candidates.filter((candidate, index, all) => all.indexOf(candidate) === index);
}

function manifestFileRefs(value, baseDir, pointer = "$") {
  const refs = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => refs.push(...manifestFileRefs(item, baseDir, `${pointer}[${index}]`)));
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  for (const [key, item] of Object.entries(value)) {
    const next = `${pointer}.${key}`;
    if ((key === "path" || key === "tool") && typeof item === "string") {
      refs.push(...resolveManifestPath(item, baseDir, next));
    } else {
      refs.push(...manifestFileRefs(item, baseDir, next));
    }
  }
  return refs;
}

function resolveManifestPath(value, baseDir, pointer) {
  if (/^(https?:|data:)/.test(value)) return [];
  const candidates = [path.resolve(baseDir, value), path.resolve(root, value)];
  return candidates
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    .map((file) => ({ file, pointer }));
}

function findFiles(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "build", "dist", "public", "coverage", "snapshots", "target", "DerivedData", ".next", ".vite", ".turbo", ".cache", "tmp_unused", "old_bundles", "assets_tmp_unused_previous"].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (path.relative(root, abs).replace(/\\/g, "/").endsWith("references/full_pose")) continue;
    if (entry.isDirectory()) out.push(...findFiles(abs, suffix));
    else if (entry.isFile() && abs.endsWith(suffix)) out.push(abs);
  }
  return out;
}

function findAllFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAllFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function markdownFilesForPublicDocs() {
  const roots = ["README.md", "AGENTS.md", "docs", "spec", "kits", "examples", "hosts", "demo/README.md"];
  const files = [];
  for (const item of roots) {
    const abs = path.join(root, item);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile() && abs.endsWith(".md")) files.push(abs);
    if (stat.isDirectory()) files.push(...findFiles(abs, ".md"));
  }
  return files;
}

function stripCodeFences(source) {
  const lines = source.split(/\r?\n/);
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

function markdownLinks(source) {
  const out = [];
  const re = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match;
  while ((match = re.exec(source))) out.push({ text: match[1], href: match[2] });
  return out;
}

function resolveMarkdownLocalLink(file, href) {
  if (/^(https?:|mailto:|data:|app:|plugin:)/i.test(href)) return null;
  if (href.startsWith("#")) return null;
  const withoutAnchor = href.split("#")[0].split("?")[0];
  if (!withoutAnchor) return null;
  let decoded = withoutAnchor;
  try {
    decoded = decodeURIComponent(withoutAnchor);
  } catch {
    decoded = withoutAnchor;
  }
  const resolved = path.resolve(path.dirname(file), decoded);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

function looksLikePath(value) {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^(bin|src|test|scripts|tools|examples|stdlib|kits|spec|hosts|demo|docs)\//.test(value) ||
    /\.(air|airgfx\.json|json|js|mjs|sh|ts|toml|md|wgsl|gltf|glb|svg)$/i.test(value)
  );
}

function normalizeFile(file) {
  const relative = path.relative(root, path.resolve(file)).replace(/\\/g, "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return relative;
}

function compareRequirement(a, b) {
  return a.file.localeCompare(b.file) || a.requiredFor.localeCompare(b.requiredFor) || a.referencedBy.localeCompare(b.referencedBy);
}

function cleanup(tmpDir) {
  if (!keep) fs.rmSync(tmpDir, { recursive: true, force: true });
}

main();
