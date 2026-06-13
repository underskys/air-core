const { moduleCapability } = require("./capabilities");

function emitWit(mod) {
  const lines = [];
  const packageName = sanitizePackageName(mod.name);
  lines.push(`package air:${packageName};`);
  lines.push("");

  const externsByInterface = new Map();
  for (const ex of mod.externs || []) {
    const iface = moduleCapability(ex.name);
    const field = iface ? ex.name.slice(iface.length + 1) : ex.name;
    if (!externsByInterface.has(iface)) externsByInterface.set(iface, []);
    externsByInterface.get(iface).push({ ...ex, field });
  }

  for (const [iface, externs] of externsByInterface) {
    lines.push(`interface ${witIdent(iface)} {`);
    for (const ex of externs) {
      lines.push(`  ${witIdent(ex.field)}: func(${witParams(ex.params)})${witResult(ex.returnType)};`);
    }
    lines.push("}");
    lines.push("");
  }

  const worldName = witIdent(`${mod.name}-world`);
  lines.push(`world ${worldName} {`);
  for (const iface of externsByInterface.keys()) {
    lines.push(`  import ${witIdent(iface)};`);
  }
  for (const fn of mod.functions.filter((item) => item.exported || item.name === "main")) {
    lines.push(`  export ${witIdent(fn.name)}: func(${witParams(fn.params)})${witResult(fn.returnType)};`);
  }
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

function witParams(params) {
  return params.map((param) => `${witIdent(param.name)}: ${witType(param.type)}`).join(", ");
}

function witResult(type) {
  return type === "void" ? "" : ` -> ${witType(type)}`;
}

function witType(type) {
  if (type === "i32" || type === "bool") return type === "bool" ? "bool" : "s32";
  if (type === "i64") return "s64";
  if (type === "f32") return "float32";
  if (type === "f64") return "float64";
  if (type === "ptr" || type === "slice") return "u32";
  throw new Error(`cannot emit WIT type for ${type}`);
}

function sanitizePackageName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function witIdent(name) {
  return name.replace(/_/g, "-").replace(/\./g, "-").toLowerCase();
}

module.exports = { emitWit };
