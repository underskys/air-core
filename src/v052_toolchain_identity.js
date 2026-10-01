"use strict";

// Internal host SDK evidence, not AIR/Host ABI. Deliberately conservative:
// bind every regular file under src and the installed WABT package instead of
// guessing a transitive require graph or trusting the dev version string.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { canonical } = require("./v051_reference");
const TOOLCHAIN_SCHEMA = "air.v052.toolchainManifest/1";

class ToolchainIdentityError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ToolchainIdentityError";
    this.code = code;
  }
}

function fail(code, message) { throw new ToolchainIdentityError(code, message); }
function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function treeManifest(root, prefix) {
  const files = [];
  function walk(relative) {
    const full = path.join(root, ...relative.split("/"));
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      fail("air.v052.toolchain_input_invalid", "toolchain tree must not contain symbolic links");
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        walk(relative ? `${relative}/${name}` : name);
      }
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(full);
      files.push(Object.freeze({ path: `${prefix}/${relative}`, sha256: digest(bytes), size: bytes.length }));
    } else {
      fail("air.v052.toolchain_input_invalid", "toolchain tree contains a non-regular input");
    }
  }
  try { walk(""); }
  catch (error) {
    if (error instanceof ToolchainIdentityError) throw error;
    fail("air.v052.toolchain_input_unavailable", "cannot read required toolchain bytes");
  }
  if (!files.length) fail("air.v052.toolchain_input_unavailable", "toolchain tree is empty");
  return Object.freeze(files);
}

function installedWabtRoot() {
  try {
    const packagePath = require.resolve("wabt/package.json");
    const root = path.dirname(packagePath);
    const metadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    if (metadata.name !== "wabt" || typeof metadata.version !== "string" ||
        path.resolve(root, metadata.main || "index.js") !== require.resolve("wabt")) {
      fail("air.v052.toolchain_input_invalid", "WABT package does not bind its resolved entry point");
    }
    return root;
  } catch (error) {
    if (error instanceof ToolchainIdentityError) throw error;
    fail("air.v052.toolchain_input_unavailable", "installed WABT identity is unavailable");
  }
}

function createToolchainGuard(sourceRoot, dependencyRoot = installedWabtRoot) {
  // Capture source bytes when this builder module is loaded, not after an
  // asynchronous compilation. A changed installation requires a fresh process.
  const sourceFiles = treeManifest(sourceRoot, "src");
  const sourceCanonical = canonical(sourceFiles);
  let dependencyPath;
  let identity;
  function snapshot() {
    if (canonical(treeManifest(sourceRoot, "src")) !== sourceCanonical) {
      fail("air.v052.toolchain_changed", "toolchain source changed; restart the builder");
    }
    const resolved = dependencyRoot();
    if (dependencyPath !== undefined && resolved !== dependencyPath) {
      fail("air.v052.toolchain_changed", "toolchain dependency resolution changed; restart the builder");
    }
    const dependencies = treeManifest(resolved, "wabt");
    const manifest = Object.freeze({
      dependencies,
      schema: TOOLCHAIN_SCHEMA,
      sources: sourceFiles
    });
    const implementationDigest = digest(Buffer.from(canonical(manifest), "utf8"));
    if (identity && identity.implementationDigest !== implementationDigest) {
      fail("air.v052.toolchain_changed", "toolchain dependency bytes changed; restart the builder");
    }
    dependencyPath = resolved;
    if (!identity) identity = Object.freeze({ implementationDigest, manifest });
    return identity;
  }
  return Object.freeze({ snapshot });
}

module.exports = { TOOLCHAIN_SCHEMA, ToolchainIdentityError, createToolchainGuard };
