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
    const importFile = resolveImportPath(use, baseFile, stdlibDir);
    const resolved = path.resolve(importFile);
    if (stack.includes(resolved)) {
      throw new AirError(`cyclic AIR import '${use.name}'`, use.loc);
    }
    if (!fs.existsSync(resolved)) {
      throw new AirError(`AIR import '${use.name}' not found at ${resolved}`, use.loc);
    }
    const alias = use.alias || defaultAlias(use.name);
    const source = fs.readFileSync(resolved, "utf8");
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
