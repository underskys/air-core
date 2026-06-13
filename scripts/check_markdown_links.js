#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const root = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([".git", "node_modules", "build", "dist", "public", "coverage", "snapshots", "target", "DerivedData"]);

function main() {
  const files = collectMarkdownFiles();
  const broken = [];
  for (const file of files) {
    const source = stripCodeFences(fs.readFileSync(file, "utf8"));
    for (const link of markdownLinks(source)) {
      const target = resolveLocalTarget(file, link.href);
      if (!target) continue;
      if (!fs.existsSync(target)) {
        broken.push({
          file: path.relative(root, file).replace(/\\/g, "/"),
          href: link.href,
          text: link.text
        });
      }
    }
  }

  if (broken.length) {
    console.error("Markdown local link check failed.");
    for (const item of broken) {
      console.error(`- ${item.file}: '${item.text}' -> ${item.href}`);
    }
    process.exit(1);
  }

  console.log(`markdown link check: ${files.length} file(s), no broken local links`);
}

function collectMarkdownFiles() {
  const files = [];
  const roots = ["README.md", "AGENTS.md", "docs", "spec", "kits", "examples", "hosts", "demo"];
  for (const item of roots) {
    const abs = path.join(root, item);
    if (!fs.existsSync(abs)) continue;
    if (isGitIgnored(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile() && abs.endsWith(".md")) files.push(abs);
    if (stat.isDirectory()) files.push(...walk(abs));
  }
  return files.sort();
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (isGitIgnored(abs)) continue;
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile() && abs.endsWith(".md")) out.push(abs);
  }
  return out;
}

function isGitIgnored(abs) {
  const relative = path.relative(root, abs);
  try {
    cp.execFileSync("git", ["check-ignore", "-q", "--", relative], { cwd: root, stdio: "ignore" });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    return false;
  }
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
  while ((match = re.exec(source))) {
    out.push({ text: match[1], href: match[2] });
  }
  return out;
}

function resolveLocalTarget(file, href) {
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
  return resolved;
}

main();
