const { moduleCapability } = require("./capabilities");
const {
  BORROWED_SLICE_TYPE,
  borrowedSliceInterfaceDescriptor,
  borrowedSliceInterfaceDigest
} = require("./borrowed_slices");

function emitWit(mod) {
  const lines = [];
  const packageName = sanitizePackageName(mod.name);
  const borrowedDescriptor = borrowedSliceInterfaceDescriptor(mod);
  lines.push(`package air:${packageName};`);
  lines.push("");
  if (borrowedDescriptor) {
    lines.push(`// air-abi: ${borrowedDescriptor.airAbi}`);
    lines.push(`// air-feature: ${borrowedDescriptor.feature}`);
    lines.push(`// air-interface-sha256: ${borrowedSliceInterfaceDigest(mod)}`);
    lines.push("interface borrowed-slice-types {");
    lines.push("  record borrowed-slice-v1 {");
    lines.push("    ptr: u32,");
    lines.push("    byte-len: u32,");
    lines.push("  }");
    lines.push("}");
    lines.push("");
  }

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
  if (borrowedDescriptor) {
    lines.push("  use borrowed-slice-types.{borrowed-slice-v1};");
  }
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
  if (type === BORROWED_SLICE_TYPE) return "borrowed-slice-v1";
  throw new Error(`cannot emit WIT type for ${type}`);
}

function sanitizePackageName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function witIdent(name) {
  return name.replace(/_/g, "-").replace(/\./g, "-").toLowerCase();
}

module.exports = { emitWit };
