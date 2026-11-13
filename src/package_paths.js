"use strict";

// SEC53-01 (spec R3 §4.1): package path containment. Internal: not exported
// from src/index.js.
//
// A path a package declares or imports is admitted one name at a time with
// lstat from the root's real path: real folders, no symbolic link anywhere
// (OD-S1-1 (a)), a regular file at the end, and the walk's folders unchanged
// at its end. The listed read sites (§4.3, OD-S1-2 (a)) then open the
// admitted file once with O_NOFOLLOW and O_NONBLOCK, check through fstat that
// it is a regular file within the bound and the admitted dev and ino, check
// the walk's folders again, and read only from that descriptor.
//
// Not promised (§2, §8): full race-free containment; hard links (R-3);
// content changed in place in the admitted inode (R-2); reads outside §4.3
// (R-1); the root and its ancestors, which the caller chooses (R-4); Windows
// (R-5). realpath is used only to anchor the root, never to prove containment.

const fs = require("fs");
const path = require("path");
const { BOUNDED_FILE_MAX_BYTES } = require("./bounded_file");

const PATH_UNCONTAINED = "air.package.path_uncontained";
const FILE_INVALID = "air.package.file_invalid";
const FILE_CHANGED = "air.package.file_changed";

// A refusal whose message begins with its code, as AirError messages do. A
// missing name keeps today's message, which has no code.
class PackagePathError extends Error {
  constructor(code, message) {
    super(code ? `${code}: ${message}` : message);
    this.name = "PackagePathError";
    if (code) this.code = code;
  }
}

// The caller's root, resolved once per call.
function packageRealRoot(base) {
  return fs.realpathSync.native(path.resolve(base));
}

// The lexical checks of a package-local path, with their messages: the ones
// validatePackageManifest has always applied, shared here so the legacy
// air-package.json format gets the same (OD-S1-5 (a)).
function lexicalPackageLocalPath(base, value, field, errors) {
  if (typeof value !== "string" || value === "") {
    errors.push(`${field} is required`);
    return null;
  }
  if (value.includes("\0")) {
    errors.push(`${field} contains a null byte`);
    return null;
  }
  const normalized = value.replace(/\\/g, "/");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) || /^file:\/\//i.test(normalized)) {
    errors.push(`${field} must not be a URL or remote path`);
    return null;
  }
  if (path.isAbsolute(value) || path.posix.isAbsolute(normalized)) {
    errors.push(`${field} must be relative and package-local`);
    return null;
  }
  if (normalized.split("/").includes("..")) {
    errors.push(`${field} must not contain parent traversal`);
    return null;
  }
  const absolute = path.resolve(base, value);
  const relativeFromBase = path.relative(base, absolute);
  if (relativeFromBase === "" || relativeFromBase.startsWith("..") || path.isAbsolute(relativeFromBase)) {
    errors.push(`${field} must stay inside the package directory`);
    return null;
  }
  return {
    relative: normalized,
    absolute
  };
}

function folderChanged(folders) {
  for (const folder of folders) {
    let stat;
    try {
      stat = fs.lstatSync(folder.path);
    } catch (_) {
      return true;
    }
    if (!stat.isDirectory() || stat.dev !== folder.dev || stat.ino !== folder.ino) return true;
  }
  return false;
}

// Admission after the lexical checks. `relative` is package-local and uses
// "/" separators. A missing name, or a non-folder in the middle, gives today's
// "does not exist" message, or { exists: false } when the path is optional.
// fs.lstatSync is called through the fs module object, so a test can step in.
function admitPackagePath(realRoot, relative, field, options = {}) {
  const shown = String(relative);
  // SEC53-01 R4 (QA's F1): `relative` is package-local and "/"-separated. A backslash, a NUL, an absolute path or a ".."
  // segment means a caller skipped its checks: refused, never walked. Empty and "." segments are skipped.
  if (typeof relative !== "string" || shown === "" || shown.includes("\0") || shown.includes("\\") || path.isAbsolute(shown) || shown.split("/").includes("..")) {
    throw new PackagePathError(PATH_UNCONTAINED, `${field} ${shown} is not a package-local path`);
  }
  const segments = shown.split("/").filter((segment) => segment !== "" && segment !== ".");
  const missing = (absolute, folders) => {
    if (options.optional) return Object.freeze({ absolute, exists: false, field, folders: Object.freeze(folders), identity: null, relative: shown });
    throw new PackagePathError(null, `${field} does not exist: ${shown}`);
  };
  let rootStat;
  try {
    rootStat = fs.lstatSync(realRoot);
  } catch (_) {
    return missing(path.join(realRoot, ...segments), []);
  }
  if (rootStat.isSymbolicLink()) throw new PackagePathError(PATH_UNCONTAINED, `${field} ${shown}: the package root is a symbolic link`);
  if (!rootStat.isDirectory()) return missing(path.join(realRoot, ...segments), []);
  const folders = [{ dev: rootStat.dev, ino: rootStat.ino, path: realRoot }];
  let current = realRoot;
  let final = null;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return missing(path.join(realRoot, ...segments), folders);
      throw new PackagePathError(FILE_INVALID, `${field} ${shown} cannot be examined (${error && error.code || "error"})`);
    }
    if (stat.isSymbolicLink()) throw new PackagePathError(PATH_UNCONTAINED, `${field} ${shown} is or passes through a symbolic link`);
    if (index < segments.length - 1) {
      if (!stat.isDirectory()) return missing(path.join(realRoot, ...segments), folders);
      folders.push({ dev: stat.dev, ino: stat.ino, path: current });
    } else {
      final = stat;
    }
  }
  if (!final) throw new PackagePathError(FILE_INVALID, `${field} ${shown} names no file`);
  if (folderChanged(folders)) throw new PackagePathError(FILE_CHANGED, `${field} ${shown}: a folder on its path changed during admission`);
  if (!final.isFile()) throw new PackagePathError(FILE_INVALID, `${field} is not a regular file: ${shown}`);
  return Object.freeze({
    absolute: current,
    exists: true,
    field,
    folders: Object.freeze(folders.map((folder) => Object.freeze(folder))),
    identity: Object.freeze({ dev: final.dev, ino: final.ino }),
    relative: shown
  });
}

// The read-time rule (§4.3): one descriptor, checked, then read from. With
// `prefixBytes`, only that many bytes are read and the size bound is skipped.
function readAdmittedPackageFile(ref, options = {}) {
  if (!ref || !ref.identity) throw new PackagePathError(FILE_INVALID, `${ref && ref.field || "package file"} ${ref && ref.relative || ""} was not admitted`.trim());
  const label = `${ref.field} ${ref.relative}`;
  const maxBytes = options.maxBytes === undefined ? BOUNDED_FILE_MAX_BYTES : options.maxBytes;
  let fd;
  try {
    fd = fs.openSync(ref.absolute, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error && ["ELOOP", "ENOENT", "ENOTDIR"].includes(error.code)) throw new PackagePathError(FILE_CHANGED, `${label} is not the file admitted (${error.code} at open)`);
    throw new PackagePathError(FILE_INVALID, `${label} cannot be opened (${error && error.code || error && error.message || "error"})`);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new PackagePathError(FILE_INVALID, `${label} is not a regular file`);
    if (options.prefixBytes === undefined && stat.size > maxBytes) throw new PackagePathError(FILE_INVALID, `${label} exceeds ${maxBytes} bytes`);
    if (stat.dev !== ref.identity.dev || stat.ino !== ref.identity.ino) throw new PackagePathError(FILE_CHANGED, `${label} is not the file admitted`);
    if (folderChanged(ref.folders)) throw new PackagePathError(FILE_CHANGED, `${label}: a folder on its path changed after admission`);
    const limit = options.prefixBytes === undefined ? maxBytes : options.prefixBytes;
    // SEC53-01 R4 (QA's F6): a prefix read takes at most prefixBytes bytes; a bounded read takes one more, to see an overflow.
    const want = options.prefixBytes === undefined ? limit + 1 : limit;
    const chunks = [];
    let total = 0;
    while (total < want) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, want - total));
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      total += count;
      chunks.push(chunk.subarray(0, count));
      if (total > limit) {
        if (options.prefixBytes !== undefined) break;
        throw new PackagePathError(FILE_INVALID, `${label} exceeds ${maxBytes} bytes`);
      }
    }
    let bytes = Buffer.concat(chunks, total);
    if (options.prefixBytes !== undefined) bytes = bytes.subarray(0, options.prefixBytes);
    return options.encoding ? bytes.toString(options.encoding) : bytes;
  } catch (error) {
    if (error instanceof PackagePathError) throw error;
    throw new PackagePathError(FILE_INVALID, `${label} cannot be read (${error && error.code || "error"})`);
  } finally {
    fs.closeSync(fd);
  }
}

// The admitted refs of a validatePackageManifest result, kept off the result
// itself so no report or serialized manifest changes shape.
const ADMITTED = new WeakMap();
function attachAdmittedRefs(result, refs) {
  ADMITTED.set(result, Object.freeze({ ...(ADMITTED.get(result) || {}), ...refs }));
}
function admittedRefsOf(result) {
  return (result && typeof result === "object" && ADMITTED.get(result)) || {};
}

module.exports = {
  FILE_CHANGED,
  FILE_INVALID,
  PATH_UNCONTAINED,
  PackagePathError,
  admitPackagePath,
  admittedRefsOf,
  attachAdmittedRefs,
  lexicalPackageLocalPath,
  packageRealRoot,
  readAdmittedPackageFile
};
