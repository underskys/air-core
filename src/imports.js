const fs = require("fs");
const path = require("path");
const { AirError } = require("./errors");

function resolveSourceImports(mod, parseAir, options = {}) {
  const sourceUses = (mod.uses || []).filter((use) => use.kind === "source");
  if (sourceUses.length === 0) return mod;

  const baseFile = options.file || "<input>";
  const stack = options.importStack || [path.resolve(baseFile)];
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
    // Without packageRoot nothing changes (single-file airc, M() of P0-11).
    // SEC53-01 R4 (OD-S1-6 (a)): in package mode only a stdlib module name, std.<identifier>(.<identifier>)*, is exempt.
    if (options.packageRoot && use.name.startsWith("std.") && !/^std\.[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(use.name)) {
      const packagePaths = require("./package_paths");
      throw new packagePaths.PackagePathError(packagePaths.PATH_UNCONTAINED, `AIR import '${use.name}' is not a stdlib module name`);
    }
    const inPackage = Boolean(options.packageRoot) && !use.name.startsWith("std.");
    const packageRoot = inPackage ? path.resolve(options.packageRoot) : null;
    const importFile = inPackage ? path.resolve(path.dirname(path.resolve(packageRoot, baseFile)), use.name) : resolveImportPath(use, baseFile, stdlibDir);
    const resolved = path.resolve(importFile);
    if (stack.includes(resolved) || (inPackage && resolved === path.resolve(packageRoot, baseFile))) {
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
    } else if (!fs.existsSync(resolved)) {
      throw new AirError(`AIR import '${use.name}' not found at ${resolved}`, use.loc);
    }
    const alias = use.alias || defaultAlias(use.name);
    const source = admitted ? require("./package_paths").readAdmittedPackageFile(admitted, { encoding: "utf8" }) : fs.readFileSync(resolved, "utf8");
    const imported = parseAir(source, resolved, {
      ...options,
      file: resolved,
      importStack: [...stack, resolved],
      isImportedModule: true
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

module.exports = { resolveSourceImports };
