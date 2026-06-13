function collectGlobalDependencies(mod) {
  const globals = new Set((mod.globals || []).map((global) => global.name));
  const deps = [];
  for (const fn of mod.functions || []) {
    const reads = new Set();
    const writes = new Set();
    for (const block of fn.blocks || []) {
      for (const ins of block.instructions || []) {
        if (ins.op === "global.get" && ins.args[0]?.kind === "symbol" && globals.has(ins.args[0].name)) {
          reads.add(ins.args[0].name);
        }
        if (ins.op === "global.set" && ins.args[0]?.kind === "symbol" && globals.has(ins.args[0].name)) {
          writes.add(ins.args[0].name);
        }
      }
    }
    deps.push({
      name: fn.name,
      reads: Array.from(reads).sort(),
      writes: Array.from(writes).sort()
    });
  }
  return deps;
}

function formatGlobalDependencies(deps, options = {}) {
  const indent = options.indent || "";
  const lines = [`${indent}Global dependencies:`];
  if (!deps.some((dep) => dep.reads.length || dep.writes.length)) {
    lines.push(`${indent}  none`);
    return lines;
  }
  for (const dep of deps) {
    if (!dep.reads.length && !dep.writes.length) continue;
    lines.push(`${indent}  ${dep.name}:`);
    lines.push(`${indent}    reads: ${dep.reads.join(", ") || "none"}`);
    lines.push(`${indent}    writes: ${dep.writes.join(", ") || "none"}`);
  }
  return lines;
}

module.exports = {
  collectGlobalDependencies,
  formatGlobalDependencies
};
