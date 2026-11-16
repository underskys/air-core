const fs = require("fs");
const path = require("path");
const { AirError } = require("./errors");

// SEC53-01 R4 (OD-S1-6 (a)): a stdlib module name, std.<identifier>(.<identifier>)*.
const STD_MODULE_NAME = /^std\.[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

// A path from the root that is empty, `..`, climbs above the root or is absolute leaves the root.
function leavesRoot(root, resolved) {
  const relative = path.relative(root, resolved);
  return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

// SEC53-10 (OD-S10-4 (b), OD-S10-5 (a); spec R3 section 4): without a package root, a single file's imports are read as a
// package's, rooted at R, the top-level input's folder: path.dirname of its absolute lexical path, never its real path, or the
// working folder for a label such as <input> or <stdin>. R is computed once and carried to nested imports. SEC53-01's admission
// anchors at R's real path. A refusal is an AirError at the `use` line, with its code in the message and in `code`: one message
// for containment (outside R, a malformed std. name, a link below R), SEC53-01's text for a file it cannot admit or read.
function singleFileRealRoot(root) {
  const packagePaths = require("./package_paths");
  try {
    return packagePaths.packageRealRoot(root);
  } catch (_) {
    return path.resolve(root); // a missing folder: the admission then reports the import missing, as today's "not found"
  }
}

// SEC53-10 erratum 1 (route (A)): a non-std target's path below R, as SEC53-01's admission takes it, or null when the target is
// outside R. Lexically inside R: its path from R, as before. When that test fails: the target's path below the topmost ancestor
// folder A whose real path is R's real path, the path the admission anchors at (packageRealRoot(R)). The ancestors are the
// target's path.dirname chain, the target itself excluded, tried from the file-system root down; one whose realpath fails does not
// match. These realpath calls, at most one per ancestor, are made only after the lexical test fails, and never open, read or
// resolve the target. The admission walks the path below A with lstat from R's real path, so every link below R on the path below
// the matched ancestor stays refused, and the file read is always below R's real path.
function singleFilePathBelowRoot(root, target) {
  if (!leavesRoot(root, target)) return path.relative(root, target).split(path.sep).join("/");
  const packagePaths = require("./package_paths");
  let realRoot;
  try {
    realRoot = packagePaths.packageRealRoot(root);
  } catch (_) {
    return null; // R has no real path, so no ancestor resolves to it
  }
  const ancestors = [];
  for (let folder = path.dirname(target); folder !== target; folder = path.dirname(folder)) {
    ancestors.unshift(folder);
    if (path.dirname(folder) === folder) break;
  }
  for (const folder of ancestors) {
    let real;
    try {
      real = fs.realpathSync.native(folder);
    } catch (_) {
      continue;
    }
    if (real === realRoot) return path.relative(folder, target).split(path.sep).join("/");
  }
  return null;
}

function singleFileRefusal(error, use) {
  const packagePaths = require("./package_paths");
  if (!(error instanceof packagePaths.PackagePathError) || !error.code) return error;
  const message = error.code === packagePaths.PATH_UNCONTAINED ? `${error.code}: AIR import '${use.name}' leaves the input's folder` : error.message;
  const refusal = new AirError(message, use.loc);
  refusal.code = error.code;
  refusal.importName = use.name;
  return refusal;
}

// The single-file branch: SEC53-01's package-mode tests, in their order, with the root R and the importing file as its absolute
// lexical path: a std. name outside the identifier pattern, the cycle check, a non-std target outside R (singleFilePathBelowRoot),
// then the admission below R and the read through one descriptor; a valid stdlib name resolves and reads as it always has.
// Returns { bytes, resolved }.
function singleFileImport(use, base, root, stack, stdlibDir) {
  const packagePaths = require("./package_paths");
  try {
    if (use.name.startsWith("std.") && !STD_MODULE_NAME.test(use.name)) {
      throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${use.name}' is not a stdlib module name`);
    }
    const inRoot = !use.name.startsWith("std.");
    const resolved = path.resolve(inRoot ? path.resolve(path.dirname(path.resolve(root, base)), use.name) : resolveImportPath(use, base, stdlibDir));
    if (stack.includes(resolved) || (inRoot && resolved === path.resolve(root, base))) throw new AirError(`cyclic AIR import '${use.name}'`, use.loc);
    let admitted = null;
    if (inRoot) {
      const below = singleFilePathBelowRoot(root, resolved);
      if (below === null) throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${use.name}' leaves the input's folder`);
      admitted = packagePaths.admitPackagePath(singleFileRealRoot(root), below, `AIR import '${use.name}'`, { optional: true });
      if (!admitted.exists) throw new AirError(`AIR import '${use.name}' not found at ${resolved}`, use.loc);
    } else if (!fs.existsSync(resolved)) {
      throw new AirError(`AIR import '${use.name}' not found at ${resolved}`, use.loc);
    }
    return { bytes: admitted ? packagePaths.readAdmittedPackageFile(admitted) : fs.readFileSync(resolved), resolved };
  } catch (error) {
    throw singleFileRefusal(error, use);
  }
}

// M()'s look (spec R3 section 4), steps 1 and 2 at one `use` of `importingFile` under R, with the single-file branch's own tests
// and before any file-system call on the target: a std. name outside the identifier pattern, then a non-std target outside R (the
// lexical test, then erratum 1's ancestors: singleFilePathBelowRoot). Returns the target (a valid stdlib name's file in
// stdlibDir). Throws the refusal as a PackagePathError.
function singleFileImportTarget(name, importingFile, root, stdlibDir) {
  const packagePaths = require("./package_paths");
  if (name.startsWith("std.")) {
    if (!STD_MODULE_NAME.test(name)) throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${name}' is not a stdlib module name`);
    return path.join(stdlibDir, `${name.slice("std.".length)}.air`);
  }
  const target = path.resolve(path.dirname(importingFile), name);
  if (singleFilePathBelowRoot(root, target) === null) throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${name}' leaves the input's folder`);
  return target;
}

// Step 3: SEC53-01's admission of a non-std target below R, as the single-file branch admits it (a link or a NUL:
// air.package.path_uncontained; a non-regular file or one that cannot be examined: air.package.file_invalid; a missing file is
// no refusal). Reads nothing. Throws the refusal as a PackagePathError.
function admitSingleFileImport(name, target, root) {
  const packagePaths = require("./package_paths");
  const below = singleFilePathBelowRoot(root, target);
  if (below === null) throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${name}' leaves the input's folder`);
  return packagePaths.admitPackagePath(singleFileRealRoot(root), below, `AIR import '${name}'`, { optional: true });
}

function resolveSourceImports(mod, parseAir, options = {}) {
  const sourceUses = (mod.uses || []).filter((use) => use.kind === "source");
  if (sourceUses.length === 0) return mod;

  const baseFile = options.file || "<input>";
  const stack = options.importStack || [path.resolve(baseFile)];
  // SEC53-10: without packageRoot, R (the top-level input's lexical folder) roots the single-file branch (singleFileImport).
  const singleFileRoot = options.packageRoot ? null : (options.singleFileRoot || path.dirname(path.resolve(baseFile)));
  const stdlibDir = options.stdlibDir || path.resolve(__dirname, "..", "stdlib");
  const merged = {
    ...mod,
    constants: [...(mod.constants || [])],
    structs: [...(mod.structs || [])],
    externs: [...(mod.externs || [])],
    functions: [...(mod.functions || [])],
    imports: [...(mod.imports || [])]
  };
  const structNames = new Set(merged.structs.map((struct) => struct.name));
  const externNames = new Set(merged.externs.map((ex) => ex.name));
  const functionNames = new Set(merged.functions.map((fn) => fn.name));

  for (const use of sourceUses) {
    // SEC53-01 (§4.4, OD-S1-4 (a)): in package mode a non-std import resolves
    // against the package root plus the importing file's folder (a relative
    // base file counts as relative to the root, so labels stay unchanged), must
    // stay inside the root, and is admitted and read through its descriptor.
    // SEC53-10 (OD-S10-4 (b)): without packageRoot (single-file airc, the SDK, the LSP, M() of P0-11) the same tests run rooted at
    // the input's folder, in singleFileImport; this loop then parses and merges what it read.
    // SEC53-01 R4 (OD-S1-6 (a)): in package mode only a stdlib module name, std.<identifier>(.<identifier>)*, is exempt.
    if (options.packageRoot && use.name.startsWith("std.") && !/^std\.[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(use.name)) {
      const packagePaths = require("./package_paths");
      throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${use.name}' is not a stdlib module name`);
    }
    const inPackage = Boolean(options.packageRoot) && !use.name.startsWith("std.");
    const packageRoot = inPackage ? path.resolve(options.packageRoot) : null;
    const single = singleFileRoot ? singleFileImport(use, path.resolve(baseFile), singleFileRoot, stack, stdlibDir) : null;
    const importFile = single ? single.resolved : inPackage ? path.resolve(path.dirname(path.resolve(packageRoot, baseFile)), use.name) : resolveImportPath(use, baseFile, stdlibDir);
    const resolved = path.resolve(importFile);
    if (!single && (stack.includes(resolved) || (inPackage && resolved === path.resolve(packageRoot, baseFile)))) {
      throw new AirError(`cyclic AIR import '${use.name}'`, use.loc);
    }
    let admitted = null;
    if (inPackage) {
      const packagePaths = require("./package_paths");
      const relative = path.relative(packageRoot, resolved);
      if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${use.name}' leaves the package root`);
      }
      admitted = packagePaths.admitPackagePath(packagePaths.packageRealRoot(packageRoot), relative.split(path.sep).join("/"), `AIR import '${use.name}'`, { optional: true });
      if (!admitted.exists) throw new AirError(`AIR import '${use.name}' not found at ${resolved}`, use.loc);
    } else if (!single && !fs.existsSync(resolved)) {
      throw new AirError(`AIR import '${use.name}' not found at ${resolved}`, use.loc);
    }
    const alias = use.alias || defaultAlias(use.name);
    // SEC53-10: the bytes read reach M()'s importsOf (onImportRead), so M() hashes them with no second read by path.
    const bytes = single ? single.bytes : admitted ? require("./package_paths").readAdmittedPackageFile(admitted) : fs.readFileSync(resolved);
    if (typeof options.onImportRead === "function") options.onImportRead(resolved, bytes);
    const source = bytes.toString("utf8");
    const imported = parseAir(source, resolved, {
      ...options,
      file: resolved,
      importStack: [...stack, resolved],
      isImportedModule: true,
      ...(singleFileRoot ? { singleFileRoot } : {})
    });
    if ((imported.globals || []).length > 0) {
      throw new AirError(`AIR import '${use.name}' cannot declare globals in v0.10 source imports`, use.loc);
    }
    if ((imported.states || []).length > 0) {
      throw new AirError(`AIR import '${use.name}' cannot declare state segments in first-slice source imports`, use.loc);
    }
    if ((imported.constants || []).length > 0) {
      throw new AirError(`AIR import '${use.name}' cannot declare constants in first-slice source imports`, use.loc);
    }
    merged.imports.push({ name: use.name, alias, file: resolved });

    const localFunctionNames = new Set((imported.functions || []).map((fn) => fn.name));
    for (const struct of imported.structs || []) {
      if (structNames.has(struct.name)) {
        throw new AirError(`import '${use.name}' conflicts on struct '${struct.name}'`, use.loc);
      }
      structNames.add(struct.name);
      merged.structs.push({ ...struct, importedFrom: use.name });
    }
    for (const ex of imported.externs || []) {
      const existing = merged.externs.find((item) => item.name === ex.name);
      if (existing) {
        const existingParams = existing.params.map((param) => param.type).join(",");
        const nextParams = ex.params.map((param) => param.type).join(",");
        if (existingParams !== nextParams || existing.returnType !== ex.returnType) {
          throw new AirError(`import '${use.name}' conflicts on extern '${ex.name}'`, use.loc);
        }
        continue;
      }
      externNames.add(ex.name);
      merged.externs.push({ ...ex, importedFrom: use.name });
    }
    for (const fn of imported.functions || []) {
      const nextName = `${alias}.${fn.name}`;
      if (functionNames.has(nextName) || externNames.has(nextName)) {
        throw new AirError(`import '${use.name}' conflicts on function '${nextName}'`, use.loc);
      }
      functionNames.add(nextName);
      merged.functions.push(prefixFunction(fn, alias, localFunctionNames));
    }
  }

  return merged;
}

function resolveImportPath(use, baseFile, stdlibDir) {
  if (use.name.startsWith("std.")) {
    return path.join(stdlibDir, `${use.name.slice("std.".length)}.air`);
  }
  return path.resolve(path.dirname(path.resolve(baseFile)), use.name);
}

function defaultAlias(name) {
  if (name.startsWith("std.")) return name.slice("std.".length);
  return path.basename(name, ".air").replace(/[^A-Za-z0-9_]/g, "_");
}

function prefixFunction(fn, alias, localFunctionNames) {
  return {
    ...fn,
    name: `${alias}.${fn.name}`,
    exported: false,
    importedFrom: alias,
    blocks: (fn.blocks || []).map((block) => ({
      ...block,
      instructions: (block.instructions || []).map((ins) => rewriteInstruction(ins, alias, localFunctionNames))
    }))
  };
}

function rewriteInstruction(ins, alias, localFunctionNames) {
  if (ins.op !== "call" || !localFunctionNames.has(ins.callee)) return ins;
  return { ...ins, callee: `${alias}.${ins.callee}` };
}

module.exports = { admitSingleFileImport, resolveSourceImports, singleFileImportTarget };
