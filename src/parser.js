const { AirError } = require("./errors");
const { assertType } = require("./types");
const { applyUseBundles } = require("./bundles");
const { resolveSourceImports } = require("./imports");

function parseAir(source, file = "<input>", options = {}) {
  const lines = source.split(/\r?\n/);
  const mod = { name: null, uses: [], constants: [], tables: [], tableGroups: [], states: [], pools: [], capabilities: new Set(), explicitCapabilities: new Set(), generatedCapabilities: new Set(), effects: [], requires: [], ensures: [], structs: [], globals: [], externs: [], functions: [] };
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const loc = { file, line: lineNo };
    const line = stripComment(lines[i]).trim();
    if (!line) continue;

    if (!current) {
      const moduleMatch = line.match(/^module\s+([A-Za-z_][A-Za-z0-9_]*)$/);
      if (moduleMatch) {
        if (mod.name) throw new AirError("duplicate module declaration", loc);
        mod.name = moduleMatch[1];
        continue;
      }

      const capsMatch = line.match(/^capabilities\s*\{\s*([^}]*)\s*\}$/);
      if (capsMatch) {
        for (const cap of splitComma(capsMatch[1])) {
          if (cap) {
            mod.capabilities.add(cap);
            mod.explicitCapabilities.add(cap);
          }
        }
        continue;
      }

      const sourceUseMatch = line.match(/^use\s+"([^"]+)"(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
      if (sourceUseMatch) {
        const name = sourceUseMatch[1];
        const alias = sourceUseMatch[2] || null;
        if (mod.uses.some((use) => use.name === name && use.alias === alias)) throw new AirError(`duplicate use import '${name}'`, loc);
        mod.uses.push({ kind: "source", name, alias, loc });
        continue;
      }

      const useMatch = line.match(/^use\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
      if (useMatch) {
        if (mod.uses.some((use) => use.name === useMatch[1] && use.alias === (useMatch[2] || null))) {
          throw new AirError(`duplicate use '${useMatch[1]}'`, loc);
        }
        const isSource = useMatch[1].startsWith("std.");
        mod.uses.push({ kind: isSource ? "source" : "bundle", name: useMatch[1], alias: useMatch[2] || null, loc });
        continue;
      }

      const constMatch = line.match(/^const\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)\s*=\s*(.+)$/);
      if (constMatch) {
        if (mod.constants.some((constant) => constant.name === constMatch[1])) {
          throw new AirError(`duplicate constant '${constMatch[1]}'`, loc);
        }
        const type = constMatch[2];
        assertType(type, loc);
        mod.constants.push({
          name: constMatch[1],
          type,
          value: parseConstantLiteral(constMatch[1], type, constMatch[3].trim(), loc),
          loc
        });
        continue;
      }

      const tablegroupMatch = line.match(/^tablegroup\s+([A-Za-z_][A-Za-z0-9_]*)\s+len\s+([0-9]+)\s*\{$/);
      const tablegroupSyntaxMatch = line.match(/^tablegroup\s+([A-Za-z_][A-Za-z0-9_]*)\s+len\s+(.+)\s*\{$/);
      if (tablegroupSyntaxMatch && !tablegroupMatch) {
        throw new AirError(`tablegroup '${tablegroupSyntaxMatch[1]}' length must be a fixed positive integer literal`, loc);
      }
      if (tablegroupMatch) {
        const parsed = parseTablegroupBlock(lines, i, file, tablegroupMatch[1], Number(tablegroupMatch[2]), loc);
        if (mod.tableGroups.some((group) => group.name === parsed.group.name)) {
          throw new AirError(`duplicate tablegroup '${parsed.group.name}'`, loc);
        }
        for (const table of parsed.tables) {
          if (mod.tables.some((existing) => existing.name === table.name)) {
            throw new AirError(`duplicate table '${table.name}'`, table.loc);
          }
        }
        mod.tableGroups.push(parsed.group);
        mod.tables.push(...parsed.tables);
        i = parsed.endIndex;
        continue;
      }

      const compactTableMatch = line.match(/^table\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(u8|u16|i16)\s*=\s*\[(.*)\]$/);
      if (compactTableMatch) {
        if (mod.tables.some((table) => table.name === compactTableMatch[1])) {
          throw new AirError(`duplicate table '${compactTableMatch[1]}'`, loc);
        }
        const type = compactTableMatch[2];
        const values = parseTableLiteral(compactTableMatch[1], type, null, compactTableMatch[3], loc);
        mod.tables.push({
          name: compactTableMatch[1],
          type,
          length: values.length,
          values,
          loc
        });
        continue;
      }

      const tableMatch = line.match(/^table\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)\s*\[\s*([0-9]+)\s*\]\s*=\s*\[(.*)\]$/);
      const tableSyntaxMatch = line.match(/^table\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)\s*\[\s*([^\]]+)\s*\]\s*=\s*\[(.*)\]$/);
      if (tableSyntaxMatch && !tableMatch) {
        throw new AirError(`table '${tableSyntaxMatch[1]}' length must be a fixed positive integer literal`, loc);
      }
      if (tableMatch) {
        if (mod.tables.some((table) => table.name === tableMatch[1])) {
          throw new AirError(`duplicate table '${tableMatch[1]}'`, loc);
        }
        const type = tableMatch[2];
        const length = Number(tableMatch[3]);
        mod.tables.push({
          name: tableMatch[1],
          type,
          length,
          values: parseTableLiteral(tableMatch[1], type, length, tableMatch[4], loc),
          loc
        });
        continue;
      }

      const stateMatch = line.match(/^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)\s*\[\s*([0-9]+)\s*\]\s*=\s*fill\s+(.+)$/);
      const stateSyntaxMatch = line.match(/^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)\s*\[\s*([^\]]+)\s*\]\s*=\s*(.+)$/);
      if (stateSyntaxMatch && !stateMatch) {
        if (!/^[0-9]+$/.test(stateSyntaxMatch[3].trim())) {
          throw new AirError(`state '${stateSyntaxMatch[1]}' length must be a fixed positive integer literal`, loc);
        }
        throw new AirError(`state '${stateSyntaxMatch[1]}' initializer must be fill <i32 literal>`, loc);
      }
      if (stateMatch) {
        if (mod.states.some((state) => state.name === stateMatch[1])) {
          throw new AirError(`duplicate state '${stateMatch[1]}'`, loc);
        }
        const type = stateMatch[2];
        const length = Number(stateMatch[3]);
        mod.states.push({
          name: stateMatch[1],
          type,
          length,
          init: parseStateInit(stateMatch[1], type, length, stateMatch[4].trim(), loc),
          loc
        });
        continue;
      }

      const poolMatch = line.match(/^pool\s+([A-Za-z_][A-Za-z0-9_]*)\s+capacity\s+([0-9]+)\s*\{$/);
      const poolSyntaxMatch = line.match(/^pool\s+([A-Za-z_][A-Za-z0-9_]*)\s+capacity\s+(.+)\s*\{$/);
      if (poolSyntaxMatch && !poolMatch) {
        throw new AirError(`air.pool.dynamic_capacity_rejected: pool '${poolSyntaxMatch[1]}' capacity must be a fixed positive integer literal`, loc);
      }
      if (poolMatch) {
        const parsed = parsePoolBlock(lines, i, file, poolMatch[1], Number(poolMatch[2]), loc);
        if (mod.pools.some((pool) => pool.name === parsed.pool.name)) {
          throw new AirError(`air.pool.invalid: duplicate pool '${parsed.pool.name}'`, loc);
        }
        mod.pools.push(parsed.pool);
        i = parsed.endIndex;
        continue;
      }

      const effectsMatch = line.match(/^effects\s*\{\s*([^}]*)\s*\}$/);
      if (effectsMatch) {
        mod.effects.push(...parseEffectBudgets(effectsMatch[1], loc));
        continue;
      }

      const contractMatch = line.match(/^(requires|ensures)\s+(.+)$/);
      if (contractMatch) {
        const condition = parseContract(contractMatch[2], loc);
        if (contractMatch[1] === "requires") mod.requires.push(condition);
        else mod.ensures.push(condition);
        continue;
      }

      const externMatch = line.match(/^extern\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(([^)]*)\)\s*->\s*([A-Za-z0-9_]+)$/);
      const externTypeMatch = line.match(/^extern\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(([^)]*)\)\s*->\s*(.+)$/);
      if (externTypeMatch && !externMatch) {
        const params = parseParams(externTypeMatch[2], loc);
        assertType(externTypeMatch[3].trim(), loc);
        mod.externs.push({
          name: externTypeMatch[1],
          params,
          returnType: externTypeMatch[3].trim(),
          external: true,
          loc
        });
        continue;
      }
      if (externMatch) {
        const params = parseParams(externMatch[2], loc);
        assertType(externMatch[3], loc);
        mod.externs.push({
          name: externMatch[1],
          params,
          returnType: externMatch[3],
          external: true,
          loc
        });
        continue;
      }

      const structMatch = line.match(/^struct\s+([A-Z][A-Za-z0-9_]*)\s*\{\s*(.*)\s*\}$/);
      if (structMatch) {
        mod.structs.push({ name: structMatch[1], fields: parseFields(structMatch[2], loc), loc });
        continue;
      }

      const globalMatch = line.match(/^global\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*(const\.[A-Za-z0-9_]+)\s+(.+)$/);
      if (globalMatch) {
        assertType(globalMatch[2], loc);
        mod.globals.push({
          name: globalMatch[1],
          type: globalMatch[2],
          init: { op: globalMatch[3], args: parseArgs(globalMatch[4], loc) },
          loc
        });
        continue;
      }

      const funcMatch = line.match(/^(export\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)\s*->\s*(.+)\s*\{$/);
      if (funcMatch) {
        const params = parseParams(funcMatch[3], loc);
        const returnType = funcMatch[4].trim();
        assertType(returnType, loc);
        current = {
          name: funcMatch[2],
          params,
          returnType,
          exported: Boolean(funcMatch[1]),
          effects: [],
          requires: [],
          ensures: [],
          blocks: [],
          loc
        };
        continue;
      }

      throw new AirError(`expected module, capabilities, or func declaration; got '${line}'`, loc);
    }

    if (line === "}") {
      if (current.blocks.length === 0) throw new AirError(`function '${current.name}' has no blocks`, loc);
      mod.functions.push(current);
      current = null;
      continue;
    }

    const fnEffectsMatch = line.match(/^effects\s*\{\s*([^}]*)\s*\}$/);
    if (fnEffectsMatch && current.blocks.length === 0) {
      current.effects.push(...parseEffectBudgets(fnEffectsMatch[1], loc));
      continue;
    }

    const fnContractMatch = line.match(/^(requires|ensures)\s+(.+)$/);
    if (fnContractMatch && current.blocks.length === 0) {
      const condition = parseContract(fnContractMatch[2], loc);
      if (fnContractMatch[1] === "requires") current.requires.push(condition);
      else current.ensures.push(condition);
      continue;
    }

    const labelMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):$/);
    if (labelMatch) {
      current.blocks.push({ label: labelMatch[1], instructions: [], loc });
      continue;
    }

    const block = current.blocks[current.blocks.length - 1];
    if (!block) throw new AirError("instruction must be inside a basic block", loc);
    block.instructions.push(parseInstruction(line, loc));
  }

  if (current) {
    throw new AirError(`unclosed function '${current.name}'`, current.loc);
  }
  if (!mod.name) throw new AirError("missing module declaration", { file, line: 1 });
  const resolved = options.resolveSourceImports === false ? mod : resolveSourceImports(mod, parseAir, { ...options, file });
  return applyUseBundles(resolved);
}

function parseParams(text, loc) {
  if (!text.trim()) return [];
  return splitComma(text).map((part) => {
    const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!match) throw new AirError(`invalid parameter '${part}'`, loc);
    const type = match[2].trim();
    assertType(type, loc);
    return { name: match[1], type };
  });
}

function parseFields(text, loc) {
  if (!text.trim()) return [];
  return splitComma(text).map((part) => {
    const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!match) throw new AirError(`invalid struct field '${part}'`, loc);
    const type = match[2].trim();
    assertType(type, loc);
    return { name: match[1], type };
  });
}

function parseConstantLiteral(name, type, text, loc) {
  if (!["i32", "i64", "f32", "f64", "bool"].includes(type)) {
    throw new AirError(`constant '${name}' type '${type}' is not supported in scalar constants`, loc);
  }
  const atom = parseAtom(text);
  if (!atom || !["number", "bool"].includes(atom.kind)) {
    throw new AirError(`constant '${name}' initializer must be a scalar literal`, loc);
  }
  if (type === "bool") {
    if (atom.kind !== "bool") throw new AirError(`constant '${name}' initializer must be bool`, loc);
    return atom;
  }
  if (atom.kind !== "number") throw new AirError(`constant '${name}' initializer must be numeric`, loc);
  if ((type === "i32" || type === "i64") && !Number.isInteger(atom.value)) {
    throw new AirError(`constant '${name}' initializer must be an integer literal`, loc);
  }
  return atom;
}

function parseTableLiteral(name, type, length, text, loc) {
  if (!["i32", "i64", "f32", "f64", "bool", "u8", "u16", "i16"].includes(type)) {
    throw new AirError(`table '${name}' element type '${type}' is not supported in static scalar tables`, loc);
  }
  const values = text.trim() ? splitComma(text).map((part) => parseAtom(part.trim())) : [];
  if (length === null) length = values.length;
  if (!Number.isInteger(length) || length <= 0 || length > 65536) {
    throw new AirError(`table '${name}' length must be between 1 and 65536`, loc);
  }
  if (values.length !== length) {
    throw new AirError(`table '${name}' length ${length} does not match ${values.length} initializer value(s)`, loc);
  }
  return values.map((value, index) => parseTableValue(name, type, value, index, loc));
}

function parseTablegroupBlock(lines, startIndex, file, name, length, loc) {
  if (!Number.isInteger(length) || length <= 0 || length > 65536) {
    throw new AirError(`tablegroup '${name}' length must be between 1 and 65536`, loc);
  }
  const fields = [];
  const tables = [];
  const seen = new Set();
  let endIndex = -1;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const fieldLoc = { file, line: i + 1 };
    const line = stripComment(lines[i]).trim();
    if (!line) continue;
    if (line === "}") {
      endIndex = i;
      break;
    }
    const fieldMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)\s*=\s*\[(.*)\]$/);
    if (!fieldMatch) {
      throw new AirError(`tablegroup '${name}' field declaration is invalid`, fieldLoc);
    }
    const fieldName = fieldMatch[1];
    const type = fieldMatch[2];
    if (seen.has(fieldName)) throw new AirError(`tablegroup '${name}' duplicate field '${fieldName}'`, fieldLoc);
    seen.add(fieldName);
    if (!["i32", "bool"].includes(type)) {
      throw new AirError(`tablegroup '${name}' field '${fieldName}' type '${type}' is not supported; first slice supports i32 and bool only`, fieldLoc);
    }
    const values = parseTableLiteral(`${name}.${fieldName}`, type, length, fieldMatch[3], fieldLoc);
    const loweredTableName = tablegroupBackingTableName(name, fieldName);
    fields.push({
      name: fieldName,
      type,
      length,
      byteWidth: type === "bool" ? 4 : 4,
      byteSize: length * 4,
      loweredTableName,
      loc: fieldLoc
    });
    tables.push({
      name: loweredTableName,
      type,
      length,
      values,
      loc: fieldLoc,
      tablegroup: name,
      tablegroupField: fieldName,
      sourceName: `${name}.${fieldName}`
    });
  }
  if (endIndex === -1) throw new AirError(`unclosed tablegroup '${name}'`, loc);
  if (fields.length === 0) throw new AirError(`tablegroup '${name}' must declare at least one field`, loc);
  return {
    group: { name, length, fields, loc },
    tables,
    endIndex
  };
}

function tablegroupBackingTableName(group, field) {
  return `__tablegroup_${group}_${field}`;
}

function parsePoolBlock(lines, startIndex, file, name, capacity, loc) {
  if (!Number.isInteger(capacity) || capacity <= 0 || capacity > 65536) {
    throw new AirError(`air.pool.capacity_invalid: pool '${name}' capacity must be between 1 and 65536`, loc);
  }
  const fields = [];
  const seen = new Set();
  let endIndex = -1;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const fieldLoc = { file, line: i + 1 };
    const line = stripComment(lines[i]).trim();
    if (!line) continue;
    if (line === "}") {
      endIndex = i;
      break;
    }
    const fieldMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!fieldMatch) {
      throw new AirError(`air.pool.invalid: pool '${name}' field declaration is invalid`, fieldLoc);
    }
    const fieldName = fieldMatch[1];
    const type = fieldMatch[2];
    if (seen.has(fieldName)) throw new AirError(`air.pool.invalid: pool '${name}' duplicate field '${fieldName}'`, fieldLoc);
    seen.add(fieldName);
    if (!["i32", "bool"].includes(type)) {
      throw new AirError(`air.pool.field_type_invalid: pool '${name}' field '${fieldName}' type '${type}' is not supported; first slice supports i32 and bool only`, fieldLoc);
    }
    fields.push({
      name: fieldName,
      type,
      init: parsePoolInit(name, fieldName, type, fieldMatch[3].trim(), fieldLoc),
      capacity,
      byteWidth: 4,
      byteSize: capacity * 4,
      loc: fieldLoc
    });
  }
  if (endIndex === -1) throw new AirError(`air.pool.invalid: unclosed pool '${name}'`, loc);
  if (!fields.some((field) => field.name === "active" && field.type === "bool")) {
    throw new AirError(`air.pool.active_flag_missing: pool '${name}' must declare active:bool`, loc);
  }
  return {
    pool: { name, capacity, fields, activeField: "active", loc },
    endIndex
  };
}

function parsePoolInit(pool, field, type, text, loc) {
  const atom = parseAtom(text);
  if (type === "bool") {
    if (!atom || atom.kind !== "bool") throw new AirError(`air.pool.field_type_invalid: pool '${pool}' field '${field}' initializer must be bool literal`, loc);
    return atom;
  }
  if (!atom || atom.kind !== "number" || !Number.isInteger(atom.value)) {
    throw new AirError(`air.pool.field_type_invalid: pool '${pool}' field '${field}' initializer must be i32 literal`, loc);
  }
  if (atom.value < -2147483648 || atom.value > 2147483647) {
    throw new AirError(`air.pool.field_type_invalid: pool '${pool}' field '${field}' i32 initializer out of range`, loc);
  }
  return atom;
}

function parseTableValue(name, type, value, index, loc) {
  if (!value || !["number", "bool", "symbol"].includes(value.kind)) {
    throw new AirError(`table '${name}' value ${index} must be a scalar literal or same-module constant`, loc);
  }
  if (value.kind === "symbol") {
    return value;
  }
  if (type === "bool") {
    if (value.kind !== "bool") throw new AirError(`table '${name}' value ${index} must be bool`, loc);
    return value;
  }
  if (value.kind !== "number") throw new AirError(`table '${name}' value ${index} must be numeric`, loc);
  if ((type === "i32" || type === "i64" || type === "u8" || type === "u16" || type === "i16") && !Number.isInteger(value.value)) {
    throw new AirError(`table '${name}' value ${index} must be an integer literal`, loc);
  }
  return value;
}

function parseStateInit(name, type, length, text, loc) {
  if (type !== "i32") {
    throw new AirError(`state '${name}' cell type '${type}' is not supported; first slice supports i32 only`, loc);
  }
  if (!Number.isInteger(length) || length <= 0 || length > 65536) {
    throw new AirError(`state '${name}' length must be between 1 and 65536`, loc);
  }
  const atom = parseAtom(text);
  if (!atom || atom.kind !== "number" || !Number.isInteger(atom.value)) {
    throw new AirError(`state '${name}' initializer must be fill <i32 literal>`, loc);
  }
  if (atom.value < -2147483648 || atom.value > 2147483647) {
    throw new AirError(`state '${name}' initializer i32 literal out of range`, loc);
  }
  return { kind: "fill", value: atom, loc };
}

function parseEffectBudgets(text, loc) {
  if (!text.trim()) return [];
  return splitComma(text).map((part) => {
    const match = part.match(/^([A-Za-z0-9_.*]+)\s*(<=|==|>=)\s*([0-9]+)$/);
    if (!match) throw new AirError(`invalid effect budget '${part}'`, loc);
    return { key: match[1], op: match[2], limit: Number(match[3]), loc };
  });
}

function parseContract(text, loc) {
  const cap = text.match(/^capability\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (cap) return { kind: "capability", capability: cap[1], loc };
  const noCap = text.match(/^no\s+capability\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (noCap) return { kind: "no-capability", capability: noCap[1], loc };
  const exportMatch = text.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (exportMatch) return { kind: "export", name: exportMatch[1], loc };
  const paramMetric = text.match(/^param\s+([A-Za-z_][A-Za-z0-9_]*)\s*(<=|==|>=)\s*(-?[0-9]+(?:\.[0-9]+)?)$/);
  if (paramMetric) return { kind: "param", name: paramMetric[1], op: paramMetric[2], value: Number(paramMetric[3]), loc };
  const returnMetric = text.match(/^return\s*(<=|==|>=)\s*(-?[0-9]+(?:\.[0-9]+)?)$/);
  if (returnMetric) return { kind: "return", op: returnMetric[1], value: Number(returnMetric[2]), loc };
  const metric = text.match(/^([A-Za-z0-9_.*]+)\s*(<=|==|>=)\s*([0-9]+)$/);
  if (metric) return { kind: "metric", key: metric[1], op: metric[2], limit: Number(metric[3]), loc };
  throw new AirError(`invalid contract '${text}'`, loc);
}

function parseInstruction(line, loc) {
  const assign = line.match(/^(%[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*(.+)$/);
  if (assign) {
    const resultType = assign[2].trim();
    assertType(resultType, loc);
    const op = parseOp(assign[3], loc, resultType);
    return { result: assign[1], resultType, ...op, loc };
  }
  return { ...parseOp(line, loc), loc };
}

function parseOp(text, loc, resultType = null) {
  const compactCall = text.match(/^@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/);
  if (compactCall) {
    return { op: "call", callee: compactCall[1], args: parseArgs(compactCall[2], loc), compact: "call" };
  }

  const call = text.match(/^call\s+@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/);
  if (call) {
    return { op: "call", callee: call[1], args: parseArgs(call[2], loc) };
  }

  if (resultType) {
    const compactConst = parseCompactConst(text, resultType);
    if (compactConst) return compactConst;
    const alias = parseAliasOp(text, resultType, loc);
    if (alias) return alias;
  }

  const standaloneCall = text.match(/^@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/);
  if (standaloneCall) {
    return { op: "call", callee: standaloneCall[1], args: parseArgs(standaloneCall[2], loc), compact: "call" };
  }

  const print = text.match(/^print\s+(.+)$/);
  if (print) return { op: "print", args: parseArgs(print[1], loc) };

  const ret = text.match(/^return(?:\s+(.+))?$/);
  if (ret) return { op: "return", args: ret[1] ? parseArgs(ret[1], loc) : [] };

  const brIf = text.match(/^br_if\s+([^,]+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)$/);
  if (brIf) return { op: "br_if", args: [parseAtom(brIf[1].trim())], labels: [brIf[2], brIf[3]] };

  const br = text.match(/^br\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (br) return { op: "br", labels: [br[1]], args: [] };

  const tablegroupGet = text.match(/^(tablegroup\.get\.(?:i32|bool))\s+@([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(.+)$/);
  if (tablegroupGet) {
    return {
      op: tablegroupGet[1],
      args: [
        { kind: "tablegroupField", group: tablegroupGet[2], field: tablegroupGet[3], name: `${tablegroupGet[2]}.${tablegroupGet[3]}` },
        ...parseArgs(tablegroupGet[4], loc)
      ]
    };
  }

  const poolCapacity = text.match(/^(pool\.capacity)\s+@([A-Za-z_][A-Za-z0-9_]*)$/);
  if (poolCapacity) {
    return { op: poolCapacity[1], args: [{ kind: "poolName", name: poolCapacity[2] }] };
  }

  const poolAccess = text.match(/^(pool\.(?:get|set)\.(?:i32|bool))\s+@([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*(.*))?$/);
  if (poolAccess) {
    return {
      op: poolAccess[1],
      args: [
        { kind: "poolField", pool: poolAccess[2], field: poolAccess[3], name: `${poolAccess[2]}.${poolAccess[3]}` },
        ...(poolAccess[4] ? parseArgs(poolAccess[4], loc) : [])
      ]
    };
  }

  const generic = text.match(/^([A-Za-z0-9_.]+)(?:\s+(.+))?$/);
  if (!generic) throw new AirError(`invalid instruction '${text}'`, loc);
  return { op: generic[1], args: generic[2] ? parseArgs(generic[2], loc) : [] };
}

function parseCompactConst(text, resultType) {
  if (resultType === "slice" && text.startsWith('"')) return { op: "const.str", args: [parseStringAtom(text)], compact: "const" };
  if (resultType === "bool" && (text === "true" || text === "false")) {
    return { op: "const.bool", args: [{ kind: "bool", value: text === "true", raw: text }], compact: "const" };
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    if (resultType === "i32" || resultType === "i64" || resultType === "f32" || resultType === "f64") {
      return { op: `const.${resultType}`, args: [{ kind: "number", value: Number(text), raw: text }], compact: "const" };
    }
  }
  return null;
}

function parseAliasOp(text, resultType, loc) {
  const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.+))?$/);
  if (!match) return null;
  const alias = match[1];
  const args = match[2] ? parseArgs(match[2], loc) : [];
  const scalarPrefix = resultType === "i32" ? "i32" : resultType === "f32" ? "f32" : null;
  if (scalarPrefix && ["add", "sub", "mul"].includes(alias)) return { op: `${scalarPrefix}.${alias}`, args, compact: "alias" };
  if (resultType === "f32" && ["div", "min", "max", "clamp", "lerp"].includes(alias)) return { op: `f32.${alias}`, args, compact: "alias" };
  return null;
}

function parseArgs(text) {
  return splitComma(text).map((arg) => parseAtom(arg.trim())).filter(Boolean);
}

function parseAtom(text) {
  if (!text) return null;
  if (text.startsWith('"')) return parseStringAtom(text);
  if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: "number", value: Number(text), raw: text };
  if (text === "true" || text === "false") return { kind: "bool", value: text === "true", raw: text };
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return { kind: "value", name: text };
  const phi = text.match(/^([A-Za-z_][A-Za-z0-9_]*):(%[A-Za-z_][A-Za-z0-9_]*)$/);
  if (phi) return { kind: "phi", label: phi[1], value: phi[2], raw: text };
  if (/^@[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(text)) return { kind: "function", name: text.slice(1) };
  return { kind: "symbol", name: text };
}

function parseStringAtom(text) {
  try {
    return { kind: "string", value: JSON.parse(text), raw: text };
  } catch (err) {
    throw new AirError(`invalid string literal ${text}`);
  }
}

function splitComma(text) {
  const parts = [];
  let current = "";
  let inString = false;
  let escape = false;
  let angleDepth = 0;
  for (const ch of text) {
    if (inString) {
      current += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === "<" && current[current.length - 1] && !/\s/.test(current[current.length - 1])) angleDepth += 1;
    if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (ch === "," && angleDepth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stripComment(line) {
  let inString = false;
  let escape = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === "#") return line.slice(0, i);
  }
  return line;
}

module.exports = { parseAir, splitComma };
