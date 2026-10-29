const { AirError, SOURCE_PROFILE_TYPED_V053 } = require("./errors");
const { assertType, parseRefinementType } = require("./types");
const { applyUseBundles } = require("./bundles");
const { resolveSourceImports } = require("./imports");
const { parseV051Contract } = require("./v051_reference");
const { parseTypeReference } = require("./typed_interface");
const { parseBorrowedSliceType } = require("./borrowed_slices");

function parseAir(source, file = "<input>", options = {}) {
  const lines = source.split(/\r?\n/);
  const mod = { name: null, uses: [], constants: [], tables: [], tableGroups: [], states: [], pools: [], capabilities: new Set(), explicitCapabilities: new Set(), generatedCapabilities: new Set(), effects: [], requires: [], ensures: [], flowDeclarations: [], structs: [], globals: [], externs: [], functions: [] };
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

      if (line.startsWith("flow ")) {
        mod.flowDeclarations.push(parseFlowDeclaration(line, loc));
        continue;
      }

      const externMatch = line.match(/^extern\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(([^)]*)\)\s*->\s*([A-Za-z0-9_]+)$/);
      const externTypeMatch = line.match(/^extern\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(([^)]*)\)\s*->\s*(.+)$/);
      if (externTypeMatch && !externMatch) {
        const params = parseParams(externTypeMatch[2], loc);
        const returnType = parseDeclaredType(externTypeMatch[3], loc);
        mod.externs.push({
          name: externTypeMatch[1],
          params,
          returnType: returnType.type,
          ...returnTypeMetadata(returnType),
          external: true,
          loc
        });
        continue;
      }
      if (externMatch) {
        const params = parseParams(externMatch[2], loc);
        const returnType = parseDeclaredType(externMatch[3], loc);
        mod.externs.push({
          name: externMatch[1],
          params,
          returnType: returnType.type,
          ...returnTypeMetadata(returnType),
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
        const returnType = parseDeclaredType(funcMatch[4], loc);
        current = {
          name: funcMatch[2],
          params,
          returnType: returnType.type,
          ...returnTypeMetadata(returnType),
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

function parseV051Air(source, file = "<input>", options = {}) {
  if (looksLikeV051TypedSource(source)) return parseV051TypedAir(source, file);
  const mod = parseAir(source, file, options);
  const values = [
    ...(mod.constants || []).filter((item) => item.type === "i64").map((item) => item.value),
    ...(mod.functions || []).flatMap((fn) => (fn.blocks || []).flatMap((block) => (block.instructions || []).filter((ins) => ins.op === "const.i64").flatMap((ins) => ins.args || [])))
  ];
  for (const value of values) {
    if (!value || value.kind !== "number" || !value.raw || !/^-?(0|[1-9][0-9]*)$/.test(value.raw)) continue;
    const exact = BigInt(value.raw);
    if (exact < -9223372036854775808n || exact > 9223372036854775807n) {
      throw new AirError(`air.v051.i64_out_of_range: i64 literal '${value.raw}' is out of range`, { file, line: 1 });
    }
    value.exactI64 = value.raw;
  }
  mod.v051TypedDecisionCandidate = true;
  return mod;
}

function looksLikeV051TypedSource(source) {
  return /^\s*(?:error\s+)?enum\s+/m.test(source) ||
    /^\s*(?:export\s+)?func\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*:\s*[^)]/m.test(source) ||
    /^\s*%[A-Za-z_][A-Za-z0-9_]*\s*:\s*.+?\s*=\s*match\s+%[A-Za-z_][A-Za-z0-9_]*\s*\{$/m.test(source) ||
    /\b(?:option|result)</.test(source);
}

function parseV051TypedAir(source, file = "<input>") {
  const lines = source.split(/\r?\n/);
  const mod = {
    name: null,
    capabilities: new Set(),
    enums: [],
    functions: [],
    v051TypedAst: true,
    v051TypedDecisionCandidate: true
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const loc = { file, line: lineNo };
    const line = stripComment(lines[index]).trim();
    if (!line) continue;
    const moduleMatch = line.match(/^module\s+([a-z][a-z0-9._-]{0,127})$/);
    if (moduleMatch) {
      if (mod.name) throw new AirError("duplicate module declaration", loc);
      mod.name = moduleMatch[1];
      continue;
    }
    const capabilitiesMatch = line.match(/^capabilities\s*\{\s*([^}]*)\s*\}$/);
    if (capabilitiesMatch) {
      for (const capability of splitComma(capabilitiesMatch[1])) {
        if (capability) mod.capabilities.add(capability);
      }
      continue;
    }
    if (!mod.name) throw new AirError("missing module declaration", loc);
    const enumMatch = line.match(/^(error\s+)?enum\s+([A-Z][A-Za-z0-9_]{0,127})\s*\{$/);
    if (enumMatch) {
      const parsed = parseV051TypedEnum(lines, index, file, mod.name, enumMatch[2], Boolean(enumMatch[1]));
      if (mod.enums.some((item) => item.type_id === parsed.declaration.type_id)) {
        throw new AirError(`air.decision.enum_duplicate_type: duplicate enum '${enumMatch[2]}'`, loc);
      }
      mod.enums.push(parsed.declaration);
      index = parsed.endIndex;
      continue;
    }
    const functionMatch = line.match(/^(export\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*->\s*(.+)\s*\{$/);
    if (functionMatch) {
      const parsed = parseV051TypedFunction(lines, index, file, mod.name, functionMatch);
      if (mod.functions.some((item) => item.name === parsed.function.name)) {
        throw new AirError(`duplicate function '${parsed.function.name}'`, loc);
      }
      mod.functions.push(parsed.function);
      index = parsed.endIndex;
      continue;
    }
    throw new AirError(`air.v051.typed_syntax_invalid: unsupported typed source declaration '${line}'`, loc);
  }
  if (!mod.name) throw new AirError("missing module declaration", { file, line: 1 });
  return mod;
}

function parseV051TypedEnum(lines, startIndex, file, moduleId, typeName, isError) {
  const cases = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const loc = { file, line: index + 1 };
    const line = stripComment(lines[index]).trim();
    if (!line) continue;
    if (line === "}") {
      if (!cases.length) throw new AirError("air.decision.enum_empty: enum must declare at least one case", loc);
      return {
        declaration: { cases: cases.sort((left, right) => left.discriminant - right.discriminant || compareAscii(left.name, right.name)), kind: isError ? "error_enum" : "enum", type_id: `${moduleId}::${typeName}` },
        endIndex: index
      };
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[0-9]+)\s*,?$/);
    if (!match) throw new AirError("air.decision.enum_discriminant_required: enum cases require an explicit integer discriminant", loc);
    const discriminant = Number(match[2]);
    if (!Number.isSafeInteger(discriminant) || discriminant < 0 || discriminant > 2147483647) {
      throw new AirError(`air.decision.enum_discriminant_out_of_range: '${match[2]}'`, loc);
    }
    if (cases.some((item) => item.name === match[1])) throw new AirError(`air.decision.enum_duplicate_case: '${match[1]}'`, loc);
    if (cases.some((item) => item.discriminant === discriminant)) throw new AirError(`air.decision.enum_duplicate_discriminant: '${discriminant}'`, loc);
    cases.push({ discriminant, name: match[1] });
  }
  throw new AirError(`unclosed enum '${typeName}'`, { file, line: startIndex + 1 });
}

function parseV051TypedFunction(lines, startIndex, file, moduleId, match) {
  const loc = { file, line: startIndex + 1 };
  const params = match[3].trim() ? splitComma(match[3]).map((part) => {
    const parameter = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!parameter) throw new AirError(`air.v051.typed_syntax_invalid: invalid parameter '${part}'`, loc);
    return { name: parameter[1], type: parseV051TypedType(parameter[2], moduleId, false, loc) };
  }) : [];
  const returnType = parseV051TypedType(match[4], moduleId, true, loc);
  const statements = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const statementLoc = { file, line: index + 1 };
    const line = stripComment(lines[index]).trim();
    if (!line) continue;
    if (line === "}") {
      return {
        function: { name: match[2], exported: Boolean(match[1]), params, returnType, statements, loc },
        endIndex: index
      };
    }
    const matchHeader = line.match(/^%([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*match\s+%([A-Za-z_][A-Za-z0-9_]*)\s*\{$/);
    if (matchHeader) {
      const parsed = parseV051TypedMatch(lines, index, file, {
        destination: matchHeader[1],
        destinationType: parseV051TypedType(matchHeader[2], moduleId, false, statementLoc),
        moduleId,
        value: matchHeader[3]
      });
      statements.push(parsed.statement);
      index = parsed.endIndex;
      continue;
    }
    const local = line.match(/^%([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*(.+)$/);
    if (local) {
      const type = parseV051TypedType(local[2], moduleId, false, statementLoc);
      statements.push({
        kind: "local",
        loc: statementLoc,
        name: local[1],
        type,
        value: normalizeV051TypedInitializer(local[3], type, moduleId, statementLoc)
      });
      continue;
    }
    const returned = line.match(/^return\s+(.+)$/);
    if (returned) {
      statements.push({
        kind: "return",
        loc: statementLoc,
        value: normalizeV051TypedInitializer(returned[1], returnType, moduleId, statementLoc)
      });
      continue;
    }
    throw new AirError(`air.v051.typed_syntax_invalid: unsupported function statement '${line}'`, statementLoc);
  }
  throw new AirError(`unclosed function '${match[2]}'`, loc);
}

function parseV051TypedMatch(lines, startIndex, file, header) {
  const arms = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const loc = { file, line: index + 1 };
    const line = stripComment(lines[index]).trim();
    if (!line) continue;
    if (line === "}") return { statement: { arms, destination: header.destination, destinationType: header.destinationType, kind: "match", loc: { file, line: startIndex + 1 }, value: header.value }, endIndex: index };
    const arm = line.match(/^(.+?)\s*=>\s*(.+?)\s*[,;]?$/);
    if (!arm) throw new AirError("air.decision.match_arm_invalid: match arms must use pattern => expression", loc);
    arms.push({
      expression: normalizeV051TypedInitializer(arm[2], header.destinationType, header.moduleId, loc),
      loc,
      pattern: arm[1].trim()
    });
  }
  throw new AirError("unclosed match", { file, line: startIndex + 1 });
}

// v0.51 admits the historic short constructors only at parsing time. The AST
// and formatter retain the frozen generic constructor spelling exclusively.
function normalizeV051TypedInitializer(value, expectedType, moduleId, loc) {
  const text = String(value || "").trim();
  if (expectedType === "void") {
    if (text) throw new AirError("air.v051.return_type_mismatch: void return must not contain a value", loc);
    return "";
  }
  const refinement = parseRefinementType(expectedType, loc);
  const expected = refinement
    ? { baseCanonical: refinement.base, canonical: refinement.canonical, kind: "primitive", refinement: refinement.refinement }
    : parseTypeReference(expectedType);
  if (/^const\.i64(?:\s|$)/.test(text)) {
    if (expected.canonical !== "i64") throw new AirError("air.v051.typed_atom_type_mismatch: const.i64 requires i64", loc);
    const literal = text.match(/^const\.i64\s+(-?(?:0|[1-9][0-9]*))$/);
    if (!literal) throw new AirError("air.v051.typed_atom_invalid: const.i64 requires an exact decimal literal", loc);
    return literal[1] === "-0" ? "0" : literal[1];
  }
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return text;

  const numericOperation = text.match(/^(i64\.checked_(?:add|sub|mul|div_s|rem_s|neg)|i64\.(?:eq|ne|lt_s|le_s|gt_s|ge_s)|i64\.to_i32_checked|i32\.to_i64|f32\.to_f64|f64\.to_f32_checked)\s+(.+)$/);
  if (numericOperation) {
    return {
      args: splitComma(numericOperation[2]).map((argument) => argument.trim()),
      kind: "numeric_operation",
      op: numericOperation[1]
    };
  }

  if (expected.kind === "option") {
    if (text === "none") return `option.none<${expected.payload.canonical}>`;
    const shortSome = text.match(/^some\((.+)\)$/);
    if (shortSome) return `option.some<${expected.payload.canonical}> ${shortSome[1].trim()}`;
    const none = text.match(/^option\.none<(.+)>$/);
    if (none) {
      const payload = canonicalizeV051SourceType(none[1], moduleId, false, loc);
      return `option.none<${payload}>`;
    }
    const some = text.match(/^option\.some<(.+)>\s+(.+)$/);
    if (some) {
      const payload = canonicalizeV051SourceType(some[1], moduleId, false, loc);
      return `option.some<${payload}> ${some[2].trim()}`;
    }
  }

  if (expected.kind === "result") {
    if (text === "ok" || text === "err") {
      throw new AirError("air.v051.typed_constructor_invalid: result constructor requires a payload", loc);
    }
    const short = text.match(/^(ok|err)\((.+)\)$/);
    if (short) return `result.${short[1]}<${expected.payload.canonical},${expected.error.canonical}> ${short[2].trim()}`;
    const constructor = text.match(/^result\.(ok|err)<(.+)>\s+(.+)$/);
    if (constructor) {
      const parts = splitComma(constructor[2]);
      if (parts.length !== 2) throw new AirError("air.v051.typed_constructor_invalid: result constructor requires two type arguments", loc);
      const payload = canonicalizeV051SourceType(parts[0], moduleId, false, loc);
      const error = canonicalizeV051SourceType(parts[1], moduleId, false, loc);
      return `result.${constructor[1]}<${payload},${error}> ${constructor[3].trim()}`;
    }
  }

  if (expected.kind === "enum") {
    const literal = text.match(/^(?:(?<module>[a-z][a-z0-9._-]{0,127})::)?(?<type>[A-Z][A-Za-z0-9_]{0,127})\.(?<case>[A-Za-z_][A-Za-z0-9_]*)$/);
    if (literal) {
      const enumModule = literal.groups.module || moduleId;
      return `${enumModule}::${literal.groups.type}.${literal.groups.case}`;
    }
  }

  if ((expected.baseCanonical || expected.canonical) === "i32" || expected.canonical === "i64") {
    if (/^-?(0|[1-9][0-9]*)$/.test(text)) return text === "-0" ? "0" : text;
  }
  if (expected.canonical === "f32" || expected.canonical === "f64") {
    if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text)) return text;
  }
  if (expected.canonical === "bool" && (text === "true" || text === "false")) return text;
  return text;
}

function parseV051TypedType(value, moduleId, allowVoid, loc) {
  const canonical = canonicalizeV051SourceType(value.trim(), moduleId, allowVoid, loc);
  const refinement = parseRefinementType(canonical, loc);
  if (refinement) return refinement.canonical;
  return parseTypeReference(canonical, { allowVoid }).canonical;
}

function canonicalizeV051SourceType(value, moduleId, allowVoid, loc) {
  value = String(value || "").trim();
  if (allowVoid && value === "void") return "void";
  // v0.51 reuses the existing i32 refinement grammar. The refinement remains
  // source/verifier metadata; lowering erases it to the established i32 lane.
  const refinement = parseRefinementType(value, loc);
  if (refinement) {
    if (refinement.base !== "i32") {
      throw new AirError(`air.v051.type_reference_invalid: '${value}' is not an admitted typed refinement`, loc);
    }
    return refinement.canonical;
  }
  if (/^[A-Z][A-Za-z0-9_]{0,127}$/.test(value)) return `${moduleId}::${value}`;
  const option = value.match(/^option\s*<\s*(.+)\s*>$/);
  if (option) return `option<${canonicalizeV051SourceType(option[1], moduleId, false, loc)}>`;
  const result = value.match(/^result\s*<\s*(.+)\s*>$/);
  if (result) {
    const parts = splitComma(result[1]);
    if (parts.length !== 2) throw new AirError("air.v051.type_reference_invalid: result requires exactly two type parameters", loc);
    return `result<${canonicalizeV051SourceType(parts[0], moduleId, false, loc)},${canonicalizeV051SourceType(parts[1], moduleId, false, loc)}>`;
  }
  try { return parseTypeReference(value, { allowVoid }).canonical; } catch (err) {
    throw new AirError(err.message, loc);
  }
}

function parseParams(text, loc) {
  if (!text.trim()) return [];
  return splitComma(text).map((part) => {
    const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!match) throw new AirError(`invalid parameter '${part}'`, loc);
    const type = parseDeclaredType(match[2], loc);
    return {
      name: match[1],
      type: type.type,
      ...declaredTypeMetadata(type)
    };
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
  const checkedParam = text.match(/^checked\s+param\s+([A-Za-z_][A-Za-z0-9_]*)\s*(<=|==|>=)\s*(-?[0-9]+)$/);
  if (checkedParam) {
    return {
      kind: "checked_param",
      parameter: checkedParam[1],
      op: checkedParam[2],
      literal: Number(checkedParam[3]),
      loc
    };
  }
  const checkedBorrowLength = text.match(
    /^checked\s+bytes\s+([A-Za-z_][A-Za-z0-9_]*)\s*(>=)\s+param\s+([A-Za-z_][A-Za-z0-9_]*)\s*\*\s*([1-9][0-9]*)$/
  );
  if (checkedBorrowLength) {
    return {
      kind: "checked_borrow_length",
      borrow: checkedBorrowLength[1],
      unit: "bytes",
      op: checkedBorrowLength[2],
      parameter: checkedBorrowLength[3],
      multiplier: Number(checkedBorrowLength[4]),
      loc
    };
  }
  const paramMetric = text.match(/^param\s+([A-Za-z_][A-Za-z0-9_]*)\s*(<=|==|>=)\s*(-?[0-9]+(?:\.[0-9]+)?)$/);
  if (paramMetric) return { kind: "param", name: paramMetric[1], op: paramMetric[2], value: Number(paramMetric[3]), loc };
  const returnMetric = text.match(/^return\s*(<=|==|>=)\s*(-?[0-9]+(?:\.[0-9]+)?)$/);
  if (returnMetric) return { kind: "return", op: returnMetric[1], value: Number(returnMetric[2]), loc };
  const metric = text.match(/^([A-Za-z0-9_.*]+)\s*(<=|==|>=)\s*([0-9]+)$/);
  if (metric) return { kind: "metric", key: metric[1], op: metric[2], limit: Number(metric[3]), loc };
  throw new AirError(`invalid contract '${text}'`, loc);
}

function parseFlowDeclaration(text, loc) {
  let match = text.match(/^flow\s+policy\s+(required)$/);
  if (match) return { kind: "policy", mode: match[1], loc };

  match = text.match(/^flow\s+source\s+param\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?:\s+from\s+(fact|structured)(?::|\s+)([A-Za-z_][A-Za-z0-9_.]*))?\s+(public|internal|sensitive|restricted)$/);
  if (match) {
    return {
      kind: "source_param",
      function: match[1],
      param: match[2],
      bindingKind: match[3] || null,
      binding: match[4] || null,
      label: match[5],
      loc
    };
  }

  match = text.match(/^flow\s+source\s+extern\s+([A-Za-z_][A-Za-z0-9_.]*)\s+return\s+(public|internal|sensitive|restricted)$/);
  if (match) return { kind: "source_extern", extern: match[1], label: match[2], loc };

  match = text.match(/^flow\s+source\s+global\s+([A-Za-z_][A-Za-z0-9_]*)\s+(public|internal|sensitive|restricted)$/);
  if (match) return { kind: "source_global", global: match[1], label: match[2], loc };

  match = text.match(/^flow\s+sink\s+return\s+([A-Za-z_][A-Za-z0-9_]*)\s+(public|internal|sensitive|restricted)$/);
  if (match) return { kind: "sink_return", function: match[1], label: match[2], loc };

  match = text.match(/^flow\s+sink\s+extern\s+([A-Za-z_][A-Za-z0-9_.]*)\s+arg\s+([0-9]+)\s+(public|internal|sensitive|restricted)$/);
  if (match) return { kind: "sink_extern", extern: match[1], argIndex: Number(match[2]), label: match[3], loc };

  match = text.match(/^flow\s+sink\s+print\s+arg\s+0\s+(public|internal|sensitive|restricted)$/);
  if (match) return { kind: "sink_print", argIndex: 0, label: match[1], loc };

  match = text.match(/^flow\s+storage\s+(global|state)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(public|internal|sensitive|restricted)$/);
  if (match) return { kind: `storage_${match[1]}`, name: match[2], label: match[3], loc };

  match = text.match(/^flow\s+storage\s+pool\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s+(public|internal|sensitive|restricted)$/);
  if (match) return { kind: "storage_pool", pool: match[1], field: match[2], label: match[3], loc };

  match = text.match(/^flow\s+declassifier\s+([A-Za-z_][A-Za-z0-9_]*)\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+(public|internal|sensitive|restricted)\s+to\s+(public|internal|sensitive|restricted)$/);
  if (match) {
    return {
      kind: "declassifier",
      id: match[1],
      function: match[2],
      from: match[3],
      to: match[4],
      loc
    };
  }

  const label = text.match(/\s(public|internal|sensitive|restricted)\s*$/) ? null : text.match(/\s([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  const code = label ? "air.flow.label_invalid" : "air.flow.policy_invalid";
  throw new AirError(`${code}: invalid flow declaration '${text}'`, loc);
}

function parseInstruction(line, loc) {
  const assign = parseAssignment(line);
  if (assign) {
    const resultType = parseDeclaredType(assign.type, loc);
    const op = parseOp(assign.body, loc, resultType.type);
    return {
      result: assign.result,
      resultType: resultType.type,
      ...declaredTypeMetadata(resultType),
      ...op,
      loc
    };
  }
  return { ...parseOp(line, loc), loc };
}

function parseAssignment(line) {
  const head = line.match(/^(%[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
  if (!head) return null;
  let angleDepth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < head[2].length; i += 1) {
    const ch = head[2][i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "<" && head[2][i + 1] !== "=") angleDepth += 1;
    else if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === "=" && angleDepth === 0) {
      const type = head[2].slice(0, i).trim();
      const body = head[2].slice(i + 1).trim();
      if (type && body) return { result: head[1], type, body };
      return null;
    }
  }
  return null;
}

function parseDeclaredType(text, loc) {
  const descriptor = assertType(String(text || "").trim(), loc);
  return {
    type: descriptor.base,
    declaredType: descriptor.canonical,
    refinement: descriptor.refinement,
    borrow: descriptor.borrow || null
  };
}

function declaredTypeMetadata(type) {
  if (type.borrow) {
    return {
      declaredType: type.declaredType,
      borrow: type.borrow
    };
  }
  return type.refinement
    ? { declaredType: type.declaredType, refinement: type.refinement }
    : {};
}

function returnTypeMetadata(type) {
  if (type.borrow) {
    return {
      returnDeclaredType: type.declaredType,
      returnBorrow: type.borrow
    };
  }
  return type.refinement
    ? { returnDeclaredType: type.declaredType, returnRefinement: type.refinement }
    : {};
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
  if (/^br_if\b/.test(text)) {
    throw new AirError("air.control.br_if_syntax_invalid: expected br_if <bool>, <then-label>, <else-label>", loc);
  }

  const br = text.match(/^br\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (br) return { op: "br", labels: [br[1]], args: [] };
  if (/^br\b/.test(text)) {
    throw new AirError("air.control.br_syntax_invalid: expected br <label>", loc);
  }

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
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
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
    if (ch === "<" && text[i + 1] !== "=" && current[current.length - 1] && !/\s/.test(current[current.length - 1])) angleDepth += 1;
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

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// typed-v0.53 (SCALAR; RFC §5, D-VAL-12..14). The surface is typed-v0.51 plus
// the SCALAR operations. These functions are reached only through the
// candidate-gated source profile; they are deliberately not part of the
// enumerable exports, so the public index does not expose an ungated
// typed-v0.53 entry (R-PROF-2).

// The SCALAR operation set. `args` and `result` are source types; `wat` is the
// single Wasm instruction for the operations that lower to one. `fold` names
// the static evaluation of R-SCL-2 (slice text R-16): checked integer
// operations, integer comparisons and the two integer-operand checked
// conversions are evaluated when every operand is statically known.
const V053_OPERATIONS = Object.freeze(Object.fromEntries([
  ...["add", "sub", "mul", "div_s", "rem_s"].map((name) => [`i32.checked_${name}`, { args: ["i32", "i32"], fold: "checked", operation: name, result: "i32", width: 32 }]),
  ...["add", "sub", "mul"].map((name) => [`i32.wrapping_${name}`, { args: ["i32", "i32"], result: "i32", wat: `i32.${name}` }]),
  ...["and", "or", "xor", "shl", "shr_u"].map((name) => [`i32.${name}`, { args: ["i32", "i32"], result: "i32", wat: `i32.${name}` }]),
  ...["eq", "ne", "lt_s", "le_s", "gt_s", "ge_s"].map((name) => [`i32.${name}`, { args: ["i32", "i32"], fold: "comparison", operation: name, result: "bool", wat: `i32.${name}` }]),
  ["i32.to_f32_checked", { args: ["i32"], fold: "to_f32", result: "f32" }],
  ["f32.trunc_to_i32_checked", { args: ["f32"], result: "i32" }],
  ["i32.to_i64", { args: ["i32"], result: "i64" }],
  ["i64.to_i32_checked", { args: ["i64"], fold: "to_i32", result: "i32" }],
  ["f32.to_f64", { args: ["f32"], result: "f64" }],
  ["f64.to_f32_checked", { args: ["f64"], result: "f32" }],
  ...["add", "sub", "mul", "div_s", "rem_s"].map((name) => [`i64.checked_${name}`, { args: ["i64", "i64"], fold: "checked", operation: name, result: "i64", width: 64 }]),
  ["i64.checked_neg", { args: ["i64"], fold: "checked", operation: "neg", result: "i64", width: 64 }],
  ...["eq", "ne", "lt_s", "le_s", "gt_s", "ge_s"].map((name) => [`i64.${name}`, { args: ["i64", "i64"], fold: "comparison", operation: name, result: "bool" }]),
  ...["add", "sub", "mul", "div", "min", "max"].map((name) => [`f32.${name}`, { args: ["f32", "f32"], result: "f32", wat: `f32.${name}` }]),
  ...["eq", "ne", "lt", "le", "gt", "ge"].map((name) => [`f32.${name}`, { args: ["f32", "f32"], result: "bool", wat: `f32.${name}` }]),
  ["bool.and", { args: ["bool", "bool"], result: "bool", wat: "i32.and" }],
  ["bool.or", { args: ["bool", "bool"], result: "bool", wat: "i32.or" }],
  ["bool.not", { args: ["bool"], result: "bool", wat: "i32.eqz" }],
  ...["i32", "i64", "f32", "f64", "bool"].map((type) => [`select.${type}`, { args: ["bool", type, type], result: type, wat: "select" }])
].map(([op, signature]) => [op, Object.freeze({ ...signature, args: Object.freeze(signature.args) })])));

const V053_TYPE_NESTING_LIMIT = 64;
const V053_INTEGER_LITERAL = /^-?(0|[1-9][0-9]*)$/;
const V053_DECIMAL_LITERAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const V053_OPERATION_FORM = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\s+(.+)$/;

// AMD-2: the existing type-nesting guard of 64 is applied before any recursive
// processing of the type text, with the guard's existing code.
function guardV053TypeNesting(text, loc) {
  let nesting = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "<" && ++nesting > V053_TYPE_NESTING_LIMIT) {
      throw new AirError("air.decision.payload_type_unsupported: type nesting exceeds the supported flat-sum surface", loc);
    }
    if (text[index] === ">") nesting -= 1;
  }
}

function withV053Location(action, loc) {
  try {
    return action();
  } catch (error) {
    if (error instanceof AirError) throw error;
    throw new AirError(String(error && error.message || error), loc);
  }
}

// P0-03 (slice text §4.1): a refinement is admitted only as a top-level
// `i32<MIN..MAX>`. A refinement on another base is refused by R-REF-6, and a
// refinement nested in a type by P3-R4 with the existing non-flat-payload code.
// Neither message cites the ABI candidate (R-TYPE-4).
const V053_TOP_REFINEMENT = /^(i32|i64|f32|f64)\s*</;
const V053_NESTED_REFINEMENT = /[<,]\s*(?:i32|i64|f32|f64)\s*</;

function rejectV053RefinementForm(text, loc) {
  const top = text.match(V053_TOP_REFINEMENT);
  if (top && top[1] !== "i32") {
    throw new AirError(`air.refinement.base_type_unsupported: '${text}' refines ${top[1]}; typed-v0.53 refines only i32 (i32<MIN..MAX>)`, loc);
  }
  if (V053_NESTED_REFINEMENT.test(text)) {
    throw new AirError(`air.decision.payload_type_unsupported: '${text}' nests a refinement; a refinement is a top-level i32<MIN..MAX> type only`, loc);
  }
}

function parseV053TypedType(value, moduleId, allowVoid, loc) {
  const text = String(value || "").trim();
  guardV053TypeNesting(text, loc);
  // P0-08 (slice text P8-R1): the four memory types are internal and read
  // here, never through the AIR ABI 0.12 candidate grammar (R-TYPE-4). A
  // memory type inside an `option`, `result` or `array` keeps its text; the
  // verifier refuses that position as an escape (P8-R12) at its line.
  const memory = v053MemoryType(text, loc);
  if (memory !== null) return memory;
  if (V053_NESTED_MEMORY.test(text) && /^(?:option|result|array)\s*</.test(text)) return text.replace(/\s+/g, "");
  // P0-06 (P6-R7, P6-R10): `array<T,N>` is read here, before the base
  // grammar, which has no array; an array inside `option` or `result` is an
  // aggregate payload. A struct name canonicalizes as an enum name does.
  if (text.startsWith("array<")) return canonicalizeV053ArrayType(text, moduleId, loc);
  if (/^(?:option|result)\s*<.*\barray</.test(text)) {
    throw new AirError(`air.decision.payload_type_unsupported: '${text}' has an aggregate payload; an option or result payload is a primitive or an enum`, loc);
  }
  rejectV053RefinementForm(text, loc);
  return withV053Location(() => parseV051TypedType(text, moduleId, allowVoid, loc), loc);
}

// P0-08 (slice text P8-R1): `ptr`, `slice`, `buffer<T,N>` with T i32 or f32
// and 1 <= N <= 65536 written without whitespace, and the frozen v0.50
// `borrowed_slice<ACCESS,len…,align=K>` spelling (§11.2), checked by the
// borrowed-slice parser and kept as written without whitespace.
const V053_NESTED_MEMORY = /(?:^|[<,\s])(?:ptr|slice|buffer\s*<|borrowed_slice\s*<)/;

function v053MemoryType(text, loc) {
  if (text === "ptr" || text === "slice") return text;
  if (/^buffer\s*</.test(text)) {
    const parts = /^buffer<([a-z0-9]+),([0-9]+)>$/.exec(text);
    if (!parts || (parts[1] !== "i32" && parts[1] !== "f32") || !/^[1-9][0-9]*$/.test(parts[2]) || BigInt(parts[2]) > BigInt(V053_AGGREGATE_MAX)) {
      throw new AirError(`air.v051.type_reference_invalid: '${text}' is not admitted; a buffer type is buffer<T,N> with T i32 or f32, 1 <= N <= ${V053_AGGREGATE_MAX}, and no whitespace`, loc);
    }
    return text;
  }
  if (/^borrowed_slice\b/.test(text)) {
    parseBorrowedSliceType(text, loc);
    return text.replace(/\s+/g, "");
  }
  return null;
}

// P0-06 (slice text P6-R7): the canonical text `array<T,N>` with no
// whitespace; T is everything before the last top-level comma.
const V053_AGGREGATE_MAX = 65536;

function v053ArrayParts(text) {
  const match = /^array<(.*)>$/.exec(String(text));
  if (!match) return null;
  let depth = 0;
  let split = -1;
  for (let index = 0; index < match[1].length; index += 1) {
    const ch = match[1][index];
    if (ch === "<") depth += 1;
    else if (ch === ">" && --depth < 0) return null;
    else if (ch === "," && depth === 0) split = index;
  }
  if (depth !== 0 || split < 0) return null;
  return { count: match[1].slice(split + 1), element: match[1].slice(0, split) };
}

function canonicalizeV053ArrayType(text, moduleId, loc) {
  const parts = v053ArrayParts(text);
  if (!parts || /\s/.test(text) || !/^[1-9][0-9]*$/.test(parts.count) || BigInt(parts.count) > BigInt(V053_AGGREGATE_MAX)) {
    throw new AirError(`air.v051.type_reference_invalid: '${text}' is not admitted; an array type is array<T,N> with no whitespace and 1 <= N <= ${V053_AGGREGATE_MAX}`, loc);
  }
  return `array<${parseV053ElementType(parts.element, moduleId, loc)},${parts.count}>`;
}

// OD-P6-3 (a): a refined type is not admitted as a field or element type.
function parseV053ElementType(value, moduleId, loc) {
  const text = String(value || "").trim();
  if (V053_TOP_REFINEMENT.test(text)) {
    throw new AirError(`air.v051.type_reference_invalid: '${text}' is refined; a struct field or array element type is not refined (OD-P6-3 (a))`, loc);
  }
  return parseV053TypedType(text, moduleId, false, loc);
}

// P0-06 (P6-R11): an additive measure of a canonical typed-v0.53 type. A
// struct is the sum over its fields, `array<T,N>` is N times T, and every
// other type is `leaf(type)`. `structs` maps a struct type id to its field
// types. Evaluated with an explicit stack and memoized in `memo`; exact BigInt.
function measureV053Type(typeName, structs, leaf, memo) {
  const stack = [{ phase: 0, type: typeName }];
  const open = new Set();
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (memo.has(frame.type)) { stack.pop(); continue; }
    const array = v053ArrayParts(frame.type);
    const children = array ? [array.element] : structs.has(frame.type) ? structs.get(frame.type) : null;
    if (!children) {
      memo.set(frame.type, BigInt(leaf(frame.type)));
      stack.pop();
      continue;
    }
    if (frame.phase === 0) {
      if (open.has(frame.type)) throw new TypeError(`aggregate type '${frame.type}' contains itself`);
      open.add(frame.type);
      frame.phase = 1;
      for (const child of children) if (!memo.has(child)) stack.push({ phase: 0, type: child });
      continue;
    }
    open.delete(frame.type);
    memo.set(frame.type, array ? BigInt(array.count) * memo.get(array.element) : children.reduce((sum, child) => sum + memo.get(child), 0n));
    stack.pop();
  }
  return memo.get(typeName);
}

// The base lane count of a non-aggregate type (G-11): 1, or 1 + its lanes for
// `option`, 1 + both for `result` (whose payloads are primitives or enums).
function v053BaseLanes(typeName) {
  return /^option</.test(typeName) ? 2 : /^result</.test(typeName) ? 3 : 1;
}

function v053StructFieldTypes(mod) {
  return new Map((mod && Array.isArray(mod.structs) ? mod.structs : []).map((item) => [item.type_id, (item.fields || []).map((field) => field.type)]));
}

function v053IsAggregateType(typeName, structs) {
  return String(typeName).startsWith("array<") || structs.has(typeName);
}

function canonicalizeV053SourceType(value, moduleId, loc) {
  const text = String(value || "").trim();
  guardV053TypeNesting(text, loc);
  return withV053Location(() => canonicalizeV051SourceType(text, moduleId, false, loc), loc);
}

function v053BaseType(expectedType) {
  const refinement = parseRefinementType(expectedType);
  return refinement ? refinement.base : expectedType;
}

// OPEN-4 (a): literal carriers normalize to the bare literal; integer-spelled
// floats normalize to `N.0` (sign kept, so `-0` is `-0.0`). Integer `-0` is `0`.
function normalizeV053Literal(text, type) {
  const base = v053BaseType(type);
  if ((base === "i32" || base === "i64") && V053_INTEGER_LITERAL.test(text)) return text === "-0" ? "0" : text;
  if ((base === "f32" || base === "f64") && V053_DECIMAL_LITERAL.test(text)) {
    return V053_INTEGER_LITERAL.test(text) ? `${text}.0` : text;
  }
  return text;
}

function normalizeV053Carrier(text, expectedType, loc) {
  const carrier = text.match(/^const\.(i32|i64|f32|f64|bool)(?:\s+(.*))?$/);
  if (!carrier) return null;
  const type = carrier[1];
  const literal = String(carrier[2] || "").trim();
  if (v053BaseType(expectedType) !== type) {
    throw new AirError(`air.v051.typed_atom_type_mismatch: const.${type} requires ${type}`, loc);
  }
  const valid = type === "bool"
    ? literal === "true" || literal === "false"
    : (type === "i32" || type === "i64") ? V053_INTEGER_LITERAL.test(literal) : V053_DECIMAL_LITERAL.test(literal);
  if (!valid) throw new AirError(`air.v051.typed_atom_invalid: const.${type} requires an exact literal`, loc);
  return normalizeV053Literal(literal, type);
}

function normalizeV053Value(value, expectedType, moduleId, loc) {
  const text = String(value || "").trim();
  if (expectedType === "void") {
    if (text) throw new AirError("air.v051.return_type_mismatch: void return must not contain a value", loc);
    return "";
  }
  const carrier = normalizeV053Carrier(text, expectedType, loc);
  if (carrier !== null) return carrier;
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return text;

  const operation = text.match(V053_OPERATION_FORM);
  if (operation) {
    const signature = V053_OPERATIONS[operation[1]];
    const args = splitComma(operation[2]).map((argument) => argument.trim());
    return {
      args: signature && signature.args.length === args.length
        ? args.map((argument, index) => normalizeV053Literal(argument, signature.args[index]))
        : args,
      kind: "numeric_operation",
      op: operation[1]
    };
  }
  // P0-06: an array value is never a literal; the verifier refuses the text.
  if (String(expectedType).startsWith("array<")) return text;

  const refinement = parseRefinementType(expectedType, loc);
  const expected = refinement
    ? { baseCanonical: refinement.base, canonical: refinement.canonical, kind: "primitive", refinement: refinement.refinement }
    : withV053Location(() => parseTypeReference(expectedType), loc);

  if (expected.kind === "option") {
    if (text === "none") return `option.none<${expected.payload.canonical}>`;
    const shortSome = text.match(/^some\((.+)\)$/);
    if (shortSome) return `option.some<${expected.payload.canonical}> ${normalizeV053Literal(shortSome[1].trim(), expected.payload.canonical)}`;
    const none = text.match(/^option\.none<(.+)>$/);
    if (none) return `option.none<${canonicalizeV053SourceType(none[1], moduleId, loc)}>`;
    const some = text.match(/^option\.some<(.+)>\s+(.+)$/);
    if (some) {
      const payload = canonicalizeV053SourceType(some[1], moduleId, loc);
      return `option.some<${payload}> ${normalizeV053Literal(some[2].trim(), payload)}`;
    }
  }

  if (expected.kind === "result") {
    if (text === "ok" || text === "err") {
      throw new AirError("air.v051.typed_constructor_invalid: result constructor requires a payload", loc);
    }
    const short = text.match(/^(ok|err)\((.+)\)$/);
    if (short) {
      const laneType = short[1] === "ok" ? expected.payload.canonical : expected.error.canonical;
      return `result.${short[1]}<${expected.payload.canonical},${expected.error.canonical}> ${normalizeV053Literal(short[2].trim(), laneType)}`;
    }
    const constructor = text.match(/^result\.(ok|err)<(.+)>\s+(.+)$/);
    if (constructor) {
      guardV053TypeNesting(constructor[2], loc);
      const parts = splitComma(constructor[2]);
      if (parts.length !== 2) throw new AirError("air.v051.typed_constructor_invalid: result constructor requires two type arguments", loc);
      const payload = canonicalizeV053SourceType(parts[0], moduleId, loc);
      const error = canonicalizeV053SourceType(parts[1], moduleId, loc);
      const laneType = constructor[1] === "ok" ? payload : error;
      return `result.${constructor[1]}<${payload},${error}> ${normalizeV053Literal(constructor[3].trim(), laneType)}`;
    }
  }

  if (expected.kind === "enum") {
    const literal = text.match(/^(?:(?<module>[a-z][a-z0-9._-]{0,127})::)?(?<type>[A-Z][A-Za-z0-9_]{0,127})\.(?<case>[A-Za-z_][A-Za-z0-9_]*)$/);
    if (literal) return `${literal.groups.module || moduleId}::${literal.groups.type}.${literal.groups.case}`;
  }

  return normalizeV053Literal(text, expected.baseCanonical || expected.canonical);
}

// OPEN-9 (a): a qualified enum pattern of this module keeps the unqualified
// canonical output.
function normalizeV053Pattern(pattern, moduleId) {
  const text = String(pattern || "").trim();
  const qualified = text.match(/^([a-z][a-z0-9._-]{0,127})::([A-Z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)$/);
  return qualified && qualified[1] === moduleId ? qualified[2] : text;
}

function v053SyntaxError(message, loc) {
  return new AirError(`air.v051.typed_syntax_invalid: ${message}`, loc);
}

// P0-04 statement forms (slice text §4.1-§4.5). A call is a value object with
// `op: "call"`, so the R-WB-15c measure counts it (P4-R17); a block statement
// lists its blocks in `blocks`, each an object with a `statements` list.
const V053_CALL_FORM = /^call\s+@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\((.*)\)$/;
const V053_LABEL_LINE = /^[A-Za-z_][A-Za-z0-9_.]*:$/;
const V053_BRANCH_LINE = /^br(?:_if)?(?:\s|$)/;
const V053_IF_HEADER = /^%([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*if\s+(.+?)\s*\{$/;
const V053_MATCH_HEADER = /^%([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*match\s+%([A-Za-z_][A-Za-z0-9_]*)\s*\{$/;

function v053CallValue(match) {
  const args = match[2].trim() ? splitComma(match[2]).map((argument) => argument.trim()) : [];
  return { args, callee: match[1], kind: "call", op: "call" };
}

function v053UnstructuredError(line, loc) {
  return new AirError(`air.control.unstructured_unsupported: '${line}' is not admitted in typed-v0.53; branch with a value if or match ending in yield (R-CFG-1, R-CFG-3)`, loc);
}

// A call argument is an atom typed by the callee's parameter (slice text §4.1):
// literals and constructors normalize as a local's value does. A non-atom stays
// as written, and the verifier rejects it (P4-R4).
function normalizeV053Argument(text, type, moduleId, loc) {
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/.test(text) || V053_CALL_FORM.test(text)) return text;
  const value = normalizeV053Value(text, type, moduleId, loc);
  return typeof value === "string" ? value : text;
}

// P0-05 (slice text P5-R1, P5-R3): `%acc: T = loop.fold @f, <seed>, <count>`.
// The fold is a local's value object with `op: "loop.fold"`, never `op:
// "call"`, so the R-WB-15c measure counts it as a callback reference and not
// as a call site (P5-R14). The count is classified by its text: `%c max m`,
// a bare `%c`, or a literal.
const V053_FOLD_PREFIX = "loop.fold ";
const V053_FOLD_CALLBACK = /^@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;
const V053_FOLD_DYNAMIC_COUNT = /^%([A-Za-z_][A-Za-z0-9_]*)(?:\s+max\s+(\S.*))?$/;

function v053FoldValue(text, loc) {
  const operands = splitComma(text.slice(V053_FOLD_PREFIX.length)).map((operand) => operand.trim());
  if (operands.length !== 3 || operands.some((operand) => !operand)) {
    throw v053SyntaxError(`loop.fold takes a callback, a seed and a count (loop.fold @f, <seed>, <count>), not '${text}'`, loc);
  }
  const callback = operands[0].match(V053_FOLD_CALLBACK);
  if (!callback) throw v053SyntaxError(`a loop.fold callback is written @name, not '${operands[0]}'`, loc);
  const dynamic = operands[2].match(V053_FOLD_DYNAMIC_COUNT);
  const count = !dynamic ? { kind: "literal", value: operands[2] }
    : dynamic[2] === undefined ? { kind: "dynamic", local: dynamic[1] }
      : { kind: "dynamic", local: dynamic[1], max: dynamic[2].trim() };
  return { callback: callback[1], count, kind: "fold", op: "loop.fold", seed: operands[1] };
}

// P5-R9: in typed-v0.53 every other loop form is refused at parse time, at its
// line: a statement or value that begins with `loop.` but is not the canonical
// `loop.fold` followed by a space, one that begins with `io.poll_bounded`, and a
// statement that begins with `for ` or `while `.
function v053OtherLoopForm(text) {
  return (text.startsWith("loop.") && !text.startsWith(V053_FOLD_PREFIX)) || text.startsWith("io.poll_bounded");
}

function v053LoopFormError(line, loc) {
  return new AirError(`air.loop.form_unsupported: '${line}' is not admitted in typed-v0.53; the only loop form is %acc: T = loop.fold @f, <seed>, <count> (R-LOOP-1)`, loc);
}

function v053RejectOtherLoopForm(line, loc) {
  const local = line.match(/^%[A-Za-z_][A-Za-z0-9_]*\s*:\s*.+?\s*=\s*(.+)$/);
  const operand = line.match(/^(?:yield|return)\s+(.+)$/);
  const value = local ? local[1].trim() : operand ? operand[1].trim() : null;
  if (v053OtherLoopForm(line) || line.startsWith("for ") || line.startsWith("while ") || (value !== null && v053OtherLoopForm(value))) {
    throw v053LoopFormError(line, loc);
  }
}

// P0-09 (P9-R1..P9-R3): the `use` line. Its string syntax, `as` and the alias
// are typed_syntax_invalid; a literal outside the package-relative grammar is
// path_uncontained (AD-P9-1 (a)); a dotted name is a bundle, `std.` the
// standard library, both refused (OPEN-26 (a)). Resolution is the loader's
// (src/typed_closure.js).
const V053_USE_PATH = /^\.\.?(?:\/[A-Za-z0-9_.-]+)*\/[A-Za-z0-9_.-]+\.air$/;

function v053UseDeclaration(line, loc) {
  const quoted = /^use\s+"([^"]*)"(?:\s+as\s+([a-z_][a-z0-9_]*))?$/.exec(line);
  if (quoted) {
    if (quoted[2] === undefined) throw v053SyntaxError(`a use declaration names its alias: use "<path>" as <alias>`, loc);
    if (!V053_USE_PATH.test(quoted[1])) {
      throw new AirError(`air.import.path_uncontained: '${quoted[1]}' is not a package-relative path beginning with ./ or ../ and ending in .air`, loc);
    }
    return { alias: quoted[2], line: loc.line, path: quoted[1] };
  }
  const dotted = /^use\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/.exec(line);
  if (dotted && dotted[1].startsWith("std.")) {
    throw new AirError(`air.import.stdlib_unsupported: '${dotted[1]}' names a standard-library module; typed-v0.53 has no standard library`, loc);
  }
  if (dotted) throw new AirError(`air.import.bundle_unsupported: '${dotted[1]}' names a bundle; typed-v0.53 imports package-relative modules only`, loc);
  throw v053SyntaxError(`invalid use declaration '${line}'`, loc);
}

// P0-05 (slice text P5-R11): `work { steps <= N1, calls <= N2, iterations <= N3 }`,
// one module-level line. Keys are the additive non-effect dimensions, each at
// most once and at least one; a bound is a canonical decimal in 0..WB_MAX.
// Spaces and tabs are optional around `{`, `}`, each comma and each `<=`. The
// limits are kept in the dimension order, which the check and the formatter use.
const V053_WORK_LINE = /^work\s*\{([^{}]*)\}$/;
const V053_WORK_LIMIT = /^(steps|calls|iterations)[ \t]*<=[ \t]*(0|[1-9][0-9]*)$/;
const V053_WORK_KEYS = Object.freeze(["steps", "calls", "iterations"]);
const V053_WB_MAX = 9223372036854775807n;

function v053WorkDeclaration(line, loc) {
  const block = line.match(V053_WORK_LINE);
  if (!block) throw v053SyntaxError(`a work declaration is work { steps <= N, calls <= N, iterations <= N }, not '${line}'`, loc);
  const items = block[1].trim() ? block[1].split(",").map((item) => item.trim()) : [];
  if (!items.length) throw v053SyntaxError("a work declaration needs at least one bound", loc);
  const bounds = new Map();
  for (const item of items) {
    const limit = item.match(V053_WORK_LIMIT);
    if (!limit) throw v053SyntaxError(`work bound '${item}' must be steps, calls or iterations <= a canonical decimal`, loc);
    if (bounds.has(limit[1])) throw v053SyntaxError(`work bound '${limit[1]}' is declared twice`, loc);
    if (BigInt(limit[2]) > V053_WB_MAX) throw v053SyntaxError(`work bound ${limit[2]} exceeds WB_MAX ${V053_WB_MAX}`, loc);
    bounds.set(limit[1], limit[2]);
  }
  return { limits: V053_WORK_KEYS.filter((key) => bounds.has(key)).map((key) => ({ bound: bounds.get(key), key })), loc };
}

// P0-06 (slice text P6-R1, P6-R2, P6-R24): `table <name>: <T>[<N>] = [v0, …]`,
// one module line. The parser checks P6-R2 items 1-4 at the table's line;
// item 5 (each literal, as the base checks `%v: T = <literal>`) and item 6
// (a duplicate name) are phase S, in source order. The values are one array
// of literal strings, normalized as a local's literal is (`-0` is `0` for an
// integer, `1` is `1.0` for a float), so a table adds a fixed number of intake
// nodes whatever its length.
const V053_TABLE_LINE = /^table[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*([^[\]=]+?)[ \t]*\[[ \t]*(0|[1-9][0-9]*)[ \t]*\][ \t]*=[ \t]*\[(.*)\]$/;
const V053_TABLE_ELEMENTS = new Set(["i32", "i64", "f32", "f64", "bool"]);

function v053TableDeclaration(line, loc) {
  const table = line.match(V053_TABLE_LINE);
  const values = table ? (table[4].trim() ? table[4].split(",").map((value) => value.trim()) : []) : null;
  if (!table || values.some((value) => !value)) {
    throw v053SyntaxError(`a table is table <name>: <T>[<N>] = [v0, ..., vN-1] on one line, not '${line}'`, loc);
  }
  const elementType = table[2];
  if (!V053_TABLE_ELEMENTS.has(elementType)) {
    throw v053SyntaxError(`table element type '${elementType}' is not admitted; a table holds i32, i64, f32, f64 or bool`, loc);
  }
  if (BigInt(table[3]) < 1n || BigInt(table[3]) > BigInt(V053_AGGREGATE_MAX)) {
    throw new AirError(`air.v051.type_reference_invalid: table length ${table[3]} is outside 1..${V053_AGGREGATE_MAX}`, loc);
  }
  if (values.length !== Number(table[3])) {
    throw v053SyntaxError(`table '${table[1]}' declares ${table[3]} values and lists ${values.length}`, loc);
  }
  return { elementType, length: Number(table[3]), loc, name: table[1], values: values.map((value) => normalizeV053Literal(value, elementType)) };
}

// P0-06 (slice text P6-R6): `struct <Name> { f1: T1, …, fk: Tk }`, one module
// line, k >= 1, distinct field names, field order kept. A field type is
// canonicalized here (a struct or enum name qualified); whether a named type
// exists, recursion and the lane cap are phase S, once every type is known.
const V053_STRUCT_LINE = /^struct[ \t]+([A-Z][A-Za-z0-9_]{0,127})[ \t]*\{(.*)\}$/;
const V053_STRUCT_FIELD = /^([a-z][A-Za-z0-9_]*)[ \t]*:[ \t]*(\S(?:.*\S)?)$/;

function v053StructDeclaration(line, moduleId, loc) {
  const struct = line.match(V053_STRUCT_LINE);
  if (!struct) throw v053SyntaxError(`a struct is struct <Name> { f1: T1, ..., fk: Tk } on one line, not '${line}'`, loc);
  const parts = struct[2].trim() ? splitComma(struct[2]).map((part) => part.trim()) : [];
  if (!parts.length) throw v053SyntaxError(`struct '${struct[1]}' declares no field; a struct has at least one`, loc);
  const names = new Set();
  const fields = parts.map((part) => {
    const field = part.match(V053_STRUCT_FIELD);
    if (!field) throw v053SyntaxError(`invalid struct field '${part}'; a field is <name>: <Type> with a lowercase name`, loc);
    if (names.has(field[1])) throw v053SyntaxError(`struct '${struct[1]}' declares field '${field[1]}' twice`, loc);
    names.add(field[1]);
    return { name: field[1], type: parseV053ElementType(field[2], moduleId, loc) };
  });
  return { fields, loc, type_id: `${moduleId}::${struct[1]}` };
}

// P0-06 (slice text P6-R4, P6-R8): the aggregate and table operations. Each
// is a local's value object with `kind: "aggregate_operation"`; `args` keeps
// the operands as written (an index literal normalized as an i32 operand is,
// so `-0` is `0` and `+0` stays to be refused), and the verifier checks
// counts, kinds and types. An operand typed by a struct field or an array
// element is normalized once every struct is known.
const V053_AGGREGATE_FORM = /^(struct\.new|struct\.get\.([a-z][A-Za-z0-9_]*)|struct\.set\.([a-z][A-Za-z0-9_]*)|array\.new|array\.get|array\.set|table\.get)(?:\s+(\S.*))?$/;
const V053_INDEX_POSITION = Object.freeze({ "array.get": 1, "array.set": 1, "table.get": 1 });

function v053AggregateValue(text) {
  const form = text.match(V053_AGGREGATE_FORM);
  if (!form) return null;
  const op = form[2] !== undefined ? "struct.get" : form[3] !== undefined ? "struct.set" : form[1];
  const args = form[4] === undefined ? [] : splitComma(form[4]).map((argument) => argument.trim());
  const index = V053_INDEX_POSITION[op];
  if (index !== undefined && args.length > index) args[index] = normalizeV053Literal(args[index], "i32");
  const value = { args, kind: "aggregate_operation", op };
  if (form[2] !== undefined || form[3] !== undefined) value.field = form[2] !== undefined ? form[2] : form[3];
  return value;
}

// P0-08 (slice text P8-R2, P8-R3): the memory statements. A bound operation
// is a local's value object `{ kind: "memory_operation", op, args }`
// (`alloc_region … max B` adds `max`, kept as literal text; a literal view is
// `op: "slice.literal"` with its decoded `text`). `free_region`, `store.T`,
// `slice.store.T` and `buffer.store` are the unbound statements
// `{ kind: "memory", loc, value }`, admitted only with their operand count; any
// other unbound form falls to the statement catch-all. Offsets, lengths, sizes
// and indexes are normalized as an i32 index is (`-0` is `0`); the verifier
// checks operations, counts, kinds and domains.
const V053_MEMORY_FORM = /^(alloc_region|free_region|(?:slice\.load|slice\.store|load|store)\.[A-Za-z0-9_]+|slice\.(?:from_region|sub|len)|buffer\.(?:from_ptr|load|store))(?:\s+(\S.*))?$/;
const V053_MEMORY_UNBOUND = Object.freeze({ "buffer.store": 3, free_region: 1, "slice.store.f32": 3, "slice.store.i32": 3, "store.f32": 3, "store.i32": 3 });

function v053MemoryIndexPositions(op) {
  if (op === "alloc_region") return [0];
  if (op === "slice.sub") return [1, 2];
  if (op === "slice.from_region" || op === "buffer.load" || op === "buffer.store" || /^(?:slice\.)?(?:load|store)\./.test(op)) return [1];
  return [];
}

function v053MemoryValue(text, loc) {
  if (text.startsWith("\"")) {
    let decoded;
    try { decoded = JSON.parse(text); } catch (_) { decoded = null; }
    if (typeof decoded !== "string") throw v053SyntaxError(`a literal view is one JSON string, not '${text}'`, loc);
    return { args: [], kind: "memory_operation", op: "slice.literal", text: decoded };
  }
  const form = text.match(V053_MEMORY_FORM);
  if (!form) return null;
  const rest = form[2] === undefined ? "" : form[2].trim();
  const value = { args: [], kind: "memory_operation", op: form[1] };
  const sized = form[1] === "alloc_region" ? /^(\S+)\s+max\s+(\S+)$/.exec(rest) : null;
  if (sized) {
    value.args = [sized[1]];
    value.max = sized[2];
  } else if (rest) {
    value.args = splitComma(rest).map((argument) => argument.trim());
  }
  for (const index of v053MemoryIndexPositions(form[1])) {
    if (value.args.length > index) value.args[index] = normalizeV053Literal(value.args[index], "i32");
  }
  return value;
}

// The declared type of every parameter and local of a function, blocks
// included (names are unique per function, P4-R10). A block-bodied match
// arm's block is in the statement's `blocks` too (P4-R17).
function v053FunctionLocalTypes(fn) {
  const types = new Map((fn.params || []).map((parameter) => [parameter.name, parameter.type]));
  const stack = [fn.statements || []];
  while (stack.length) {
    for (const statement of stack.pop()) {
      if (statement.kind === "local") types.set(statement.name, statement.type);
      if (statement.kind === "if" || statement.kind === "match") types.set(statement.destination, statement.destinationType);
      for (const block of statement.blocks || []) stack.push(block.statements || []);
    }
  }
  return types;
}

function v053MemoryStatement(line, loc) {
  const value = v053MemoryValue(line, loc);
  if (!value || V053_MEMORY_UNBOUND[value.op] !== value.args.length || value.max !== undefined) return null;
  return { kind: "memory", loc, value };
}

// P6-R4: tables are read-only. A statement whose operation is `table.set`,
// bound or not, with any operands, is refused at its line.
function v053RejectTableSet(line, loc) {
  const local = line.match(/^%[A-Za-z_][A-Za-z0-9_]*\s*:\s*.+?\s*=\s*(.+)$/);
  const operand = line.match(/^(?:yield|return)\s+(.+)$/);
  const value = local ? local[1].trim() : operand ? operand[1].trim() : line;
  if (/^table\.set(?:\s|$)/.test(value)) {
    throw new AirError(`air.table.readonly: '${line}' writes a table; typed-v0.53 tables are read-only (table.get only)`, loc);
  }
}

// P0-07 (slice text P7-R1, P7-R2): `const <NAME>: <T> = <literal>`, one module
// line. The parser checks items 1-3 at the line (coarse shape and an uppercase
// name; one of the five types; a literal token as the initializer); items 4
// (the literal, as the base checks `%v: T = <literal>`) and 5 (a duplicate
// name) are phase S, in source order. The value is kept normalized as a
// local's literal is. A line that starts with `const.` is a literal carrier,
// not a `const` line.
const V053_CONST_SHAPE = /^const[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:([^=]*)=(.*)$/;
const V053_CONST_NAME = /^[A-Z][A-Za-z0-9_]*$/;
// A literal token: one token (no space, tab or comma) that starts with a
// digit, or with `-` or `+` followed by a digit, or is `true` or `false`.
const V053_LITERAL_TOKEN = /^(?:(?:[0-9]|[-+][0-9])[^\s,]*|true|false)$/;

function v053ConstDeclaration(line, loc) {
  const shape = line.match(V053_CONST_SHAPE);
  const type = shape ? shape[2].trim() : "";
  const rest = shape ? shape[3].trim() : "";
  if (!shape || !type || !rest || !V053_CONST_NAME.test(shape[1])) {
    throw v053SyntaxError(`a constant is const <NAME>: <T> = <literal> on one line, with an uppercase name, not '${line}'`, loc);
  }
  if (!V053_TABLE_ELEMENTS.has(type)) throw v053SyntaxError(`constant type '${type}' is not admitted; a constant is i32, i64, f32, f64 or bool`, loc);
  if (!V053_LITERAL_TOKEN.test(rest)) {
    throw new AirError(`air.const.initializer_invalid: constant '${shape[1]}' is initialized by '${rest}'; a constant takes one literal`, loc);
  }
  return { loc, name: shape[1], type, value: normalizeV053Literal(rest, type) };
}

// P0-07 (slice text P7-R5, P7-R6): `state <name>: <T>[<N>] = fill <literal>`,
// one module line, checked with the legacy `air.state.*` codes (OPEN-2 (a)).
// The parser checks items 1-4 at the line (coarse shape; cell type; a
// decimal length; 1 <= N <= 65536 without a leading zero); item 5 (`fill`
// and one valid literal of T) and item 6 (the name shared with states and
// tables) are phase S, in source order. `fill` keeps the normalized literal,
// or null when the rest is not `fill` and one literal token. No per-cell
// object is created (P7-R18).
const V053_STATE_SHAPE = /^state[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:([^[]*)\[([^\]]*)\][ \t]*=(.*)$/;

function v053StateDeclaration(line, loc) {
  const shape = line.match(V053_STATE_SHAPE);
  const type = shape ? shape[2].trim() : "";
  const rest = shape ? shape[4].trim() : "";
  if (!shape || !type || !rest) throw new AirError(`air.state.segment_invalid: a state is state <name>: <T>[<N>] = fill <literal> on one line, not '${line}'`, loc);
  if (!V053_TABLE_ELEMENTS.has(type)) throw new AirError(`air.state.cell_type_invalid: state cell type '${type}' is not admitted; a cell is i32, i64, f32, f64 or bool`, loc);
  const length = shape[3].trim();
  if (!/^[0-9]+$/.test(length)) throw new AirError(`air.state.dynamic_length: state length '${length}' is not a decimal literal`, loc);
  if (!/^[1-9][0-9]*$/.test(length) || BigInt(length) > BigInt(V053_AGGREGATE_MAX)) {
    throw new AirError(`air.state.length_invalid: state length ${length} is not a decimal in 1..${V053_AGGREGATE_MAX} without a leading zero`, loc);
  }
  const fill = rest.match(/^fill[ \t]+(\S+)$/);
  return {
    elementType: type,
    fill: fill && V053_LITERAL_TOKEN.test(fill[1]) ? normalizeV053Literal(fill[1], type) : null,
    init: rest,
    length: Number(length),
    loc,
    name: shape[1]
  };
}

// P0-07 (slice text P7-R7): `%v: D = state.get <s>, <index>` and the
// statement `state.set <s>, <index>, <value>`. Any `state.*` operation reads
// into the same value object; the verifier admits state.get as a value and
// state.set as a statement only.
const V053_STATE_FORM = /^(state\.[A-Za-z0-9_]+)(?:\s+(\S.*))?$/;

function v053StateValue(text) {
  const form = text.match(V053_STATE_FORM);
  if (!form) return null;
  const args = form[2] === undefined ? [] : splitComma(form[2]).map((argument) => argument.trim());
  if (args.length > 1) args[1] = normalizeV053Literal(args[1], "i32");
  return { args, kind: "aggregate_operation", op: form[1] };
}

// P6-R8: the operands that a struct field or an array element types are
// normalized as call arguments are; an aggregate-typed operand stays as written.
// `structs` maps a struct type id to its fields ({ name, type }).
function normalizeV053AggregateOperands(statement, structs, moduleId) {
  const value = statement.value;
  const parts = v053ArrayParts(statement.type);
  const element = parts ? parts.element : null;
  const fields = structs.get(statement.type) || null;
  const normalize = (argument, typeName) => (typeName === null || v053IsAggregateType(typeName, structs)
    ? argument
    : normalizeV053Argument(argument, typeName, moduleId, statement.loc));
  if (value.op === "struct.new" && fields && fields.length === value.args.length) {
    value.args = value.args.map((argument, index) => normalize(argument, fields[index].type));
  } else if (value.op === "array.new" && element !== null) {
    value.args = value.args.map((argument) => normalize(argument, element));
  } else if (value.op === "struct.set" && fields && value.args.length === 2) {
    const field = fields.find((item) => item.name === value.field);
    if (field) value.args[1] = normalize(value.args[1], field.type);
  } else if (value.op === "array.set" && value.args.length === 3) {
    value.args[2] = normalize(value.args[2], element);
  }
}

// One pass over the lines with an explicit stack of open frames (AMD-1). No
// parse step recurses on the host stack with the input. A frame is a module
// item (enum, function), a `match`, or a block (P0-04: the then- and
// else-block of a value `if`, a block-bodied `match` arm). A placement rule is
// checked when its line is read (P4-R10, P4-R13, P4-R15).
function parseV053TypedAir(source, file = "<input>") {
  const lines = String(source).split(/\r?\n/);
  const mod = {
    name: null,
    capabilities: new Set(),
    capabilityDeclarations: 0,
    enums: [],
    functions: [],
    v051TypedAst: true
  };
  Object.defineProperty(mod, "sourceProfile", { configurable: false, enumerable: true, value: SOURCE_PROFILE_TYPED_V053, writable: false });
  const stack = [];
  const calls = [];
  const folds = [];
  const aggregates = [];
  const stateSets = [];
  const memoryStores = [];
  // P7-R10: the names of `state` lines, collected without any check, so that
  // a state name in an exported signature is known before its line.
  const stateNames = new Set();
  for (const text of lines) {
    const named = stripComment(text).trim().match(/^state[ \t]+([A-Za-z_][A-Za-z0-9_]*)/);
    if (named) stateNames.add(named[1]);
  }
  for (let index = 0; index < lines.length; index += 1) {
    const loc = { file, line: index + 1 };
    const line = stripComment(lines[index]).trim();
    if (!line) continue;
    const frame = stack[stack.length - 1];

    if (!frame) {
      const moduleMatch = line.match(/^module\s+([a-z][a-z0-9._-]{0,127})$/);
      if (moduleMatch) {
        if (mod.name) throw v053SyntaxError("duplicate module declaration", loc);
        mod.name = moduleMatch[1];
        continue;
      }
      const capabilitiesMatch = line.match(/^capabilities\s*\{\s*([^}]*)\s*\}$/);
      if (capabilitiesMatch) {
        for (const capability of splitComma(capabilitiesMatch[1])) {
          if (capability) mod.capabilities.add(capability);
        }
        mod.capabilityDeclarations += 1;
        continue;
      }
      if (!mod.name) throw v053SyntaxError("missing module declaration", loc);
      // P0-09 (P9-R1..P9-R3): one `use "<path>" as <alias>` per line, after
      // the header. The `uses` list exists only once one is declared, so a
      // module without imports keeps its AST unchanged (P9-R10).
      if (/^use(?:\s|$)/.test(line)) {
        const use = v053UseDeclaration(line, loc);
        if (!mod.uses) mod.uses = [];
        if (mod.uses.some((item) => item.alias === use.alias)) throw v053SyntaxError(`duplicate import alias '${use.alias}'`, loc);
        mod.uses.push(use);
        continue;
      }
      if (/^work(?:\s|\{|$)/.test(line)) {
        // P5-R11: at most one declaration; a second one is refused at its line.
        if (mod.work) throw v053SyntaxError("a module has at most one work declaration", loc);
        mod.work = v053WorkDeclaration(line, loc);
        continue;
      }
      // P0-06: the `structs` and `tables` lists exist only once one is
      // declared, so a module without them keeps its AST unchanged.
      if (/^table(?:\s|$)/.test(line)) {
        if (!mod.tables) mod.tables = [];
        mod.tables.push(v053TableDeclaration(line, loc));
        continue;
      }
      if (/^struct(?:\s|\{|$)/.test(line)) {
        const declaration = v053StructDeclaration(line, mod.name, loc);
        // P6-R6: structs and enums share one type namespace.
        if (mod.enums.some((item) => item.type_id === declaration.type_id) || (mod.structs || []).some((item) => item.type_id === declaration.type_id)) {
          throw new AirError(`air.decision.enum_duplicate_type: duplicate type '${declaration.type_id.slice(mod.name.length + 2)}'`, loc);
        }
        if (!mod.structs) mod.structs = [];
        mod.structs.push(declaration);
        continue;
      }
      // P0-07: the `constants` and `states` lists exist only once one is
      // declared. The `module` header is checked before any of them (BA-2).
      if (/^const[ \t]/.test(line)) {
        if (!mod.constants) mod.constants = [];
        mod.constants.push(v053ConstDeclaration(line, loc));
        continue;
      }
      if (/^state[ \t]/.test(line)) {
        if (!mod.states) mod.states = [];
        mod.states.push(v053StateDeclaration(line, loc));
        continue;
      }
      const enumMatch = line.match(/^(error\s+)?enum\s+([A-Z][A-Za-z0-9_]{0,127})\s*\{$/);
      if (enumMatch) {
        stack.push({ cases: [], isError: Boolean(enumMatch[1]), kind: "enum", loc, typeName: enumMatch[2] });
        continue;
      }
      const functionMatch = line.match(/^(export\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*->\s*(.+)\s*\{$/);
      if (functionMatch) {
        if (mod.functions.some((item) => item.name === functionMatch[2])) {
          throw new AirError(`air.v051.function_duplicate: duplicate function '${functionMatch[2]}'`, loc);
        }
        // P7-R10: a state name in an exported signature is a state handle at
        // the export boundary; anywhere else the base type error stands.
        const signatureType = (text, allowVoid) => {
          try {
            return parseV053TypedType(text, mod.name, allowVoid, loc);
          } catch (error) {
            if (functionMatch[1] && stateNames.has(String(text).trim())) {
              throw new AirError(`air.abi.export_type_unsupported: export '${functionMatch[2]}' names state '${String(text).trim()}' as a type; a state is internal and has no handle at the AIR ABI`, loc);
            }
            throw error;
          }
        };
        const params = functionMatch[3].trim() ? splitComma(functionMatch[3]).map((part) => {
          const parameter = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
          if (!parameter) throw v053SyntaxError(`invalid parameter '${part}'`, loc);
          return { name: parameter[1], type: signatureType(parameter[2], false) };
        }) : [];
        const returnType = signatureType(functionMatch[4], true);
        const fn = { name: functionMatch[2], exported: Boolean(functionMatch[1]), params, returnType, statements: [], loc };
        mod.functions.push(fn);
        stack.push({ fn, kind: "function", statements: fn.statements });
        continue;
      }
      throw v053SyntaxError(`unsupported typed source declaration '${line}'`, loc);
    }

    if (frame.kind === "enum") {
      if (line === "}") {
        stack.pop();
        if (!frame.cases.length) throw new AirError("air.decision.enum_empty: enum must declare at least one case", loc);
        const declaration = {
          cases: frame.cases.sort((left, right) => left.discriminant - right.discriminant || compareAscii(left.name, right.name)),
          kind: frame.isError ? "error_enum" : "enum",
          type_id: `${mod.name}::${frame.typeName}`
        };
        if (mod.enums.some((item) => item.type_id === declaration.type_id)) {
          throw new AirError(`air.decision.enum_duplicate_type: duplicate enum '${frame.typeName}'`, frame.loc);
        }
        if ((mod.structs || []).some((item) => item.type_id === declaration.type_id)) {
          throw new AirError(`air.decision.enum_duplicate_type: duplicate type '${frame.typeName}'`, frame.loc);
        }
        mod.enums.push(declaration);
        continue;
      }
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[0-9]+)\s*,?$/);
      if (!match) throw new AirError("air.decision.enum_discriminant_required: enum cases require an explicit integer discriminant", loc);
      const discriminant = Number(match[2]);
      if (!Number.isSafeInteger(discriminant) || discriminant < 0 || discriminant > 2147483647) {
        throw new AirError(`air.decision.enum_discriminant_out_of_range: '${match[2]}'`, loc);
      }
      if (frame.cases.some((item) => item.name === match[1])) throw new AirError(`air.decision.enum_duplicate_case: '${match[1]}'`, loc);
      if (frame.cases.some((item) => item.discriminant === discriminant)) throw new AirError(`air.decision.enum_duplicate_discriminant: '${discriminant}'`, loc);
      frame.cases.push({ discriminant, name: match[1] });
      continue;
    }

    if (frame.kind === "match") {
      if (line === "}") {
        stack.pop();
        continue;
      }
      // P4-R9: a block-bodied arm opens a block frame; its closing line is `}`.
      const blockArm = line.match(/^(.+?)\s*=>\s*\{$/);
      if (blockArm) {
        const block = { statements: [] };
        // The block is enumerable once, in `blocks` (P4-R17). The arm refers to the
        // same block through a non-enumerable property, so a walk over enumerable
        // properties (the intake AST-node count) reaches each block subtree once.
        const blockArmNode = { loc, pattern: normalizeV053Pattern(blockArm[1], mod.name) };
        Object.defineProperty(blockArmNode, "block", { configurable: false, enumerable: false, value: block, writable: false });
        frame.statement.arms.push(blockArmNode);
        if (!frame.statement.blocks) frame.statement.blocks = [];
        frame.statement.blocks.push(block);
        stack.push({ fn: frame.fn, kind: "block", openLoc: loc, owner: "arm", statement: frame.statement, statements: block.statements, yielded: false });
        continue;
      }
      const arm = line.match(/^(.+?)\s*=>\s*(.+?)\s*[,;]?$/);
      if (!arm) throw new AirError("air.decision.match_arm_invalid: match arms must use pattern => expression", loc);
      if (v053OtherLoopForm(arm[2].trim())) throw v053LoopFormError(line, loc);
      frame.statement.arms.push({
        expression: normalizeV053Value(arm[2], frame.statement.destinationType, mod.name, loc),
        loc,
        pattern: normalizeV053Pattern(arm[1], mod.name)
      });
      continue;
    }

    // A statement frame: a function body or a block (R-CFG-1, R-CFG-2).
    const fn = frame.fn;
    const inBlock = frame.kind === "block";
    if (inBlock && frame.owner === "then" && line === "} else {") {
      // P4-R15: the then-block must end in its yield; reported at the `if` header.
      if (!frame.yielded) throw new AirError("air.control.yield_missing: the then-block of a value if must end with yield", frame.statement.loc);
      stack.pop();
      const block = frame.statement.blocks[1];
      stack.push({ fn, kind: "block", openLoc: loc, owner: "else", statement: frame.statement, statements: block.statements, yielded: false });
      continue;
    }
    if (line === "}") {
      stack.pop();
      if (!inBlock) continue;
      if (frame.owner === "then") {
        // A value if without an else block (P4-R15), reported at the `if` header.
        throw new AirError("air.control.yield_missing: a value if needs an else block ending with yield", frame.statement.loc);
      }
      if (!frame.yielded) {
        const what = frame.owner === "else" ? "the else-block of a value if" : "a block-bodied match arm";
        throw new AirError(`air.control.yield_missing: ${what} must end with yield`, frame.openLoc);
      }
      continue;
    }
    v053RejectOtherLoopForm(line, loc);
    v053RejectTableSet(line, loc);
    if (inBlock && frame.yielded) throw v053SyntaxError(`statement after the block's yield '${line}'`, loc);
    // P0-07 (P7-R7): `state.set` is the one statement without a result binding.
    if (/^state\.set(?:\s|$)/.test(line)) {
      const statement = { kind: "state_set", loc, value: v053StateValue(line) };
      frame.statements.push(statement);
      stateSets.push(statement);
      continue;
    }
    // P0-08 (P8-R2): the unbound memory statements.
    const memoryStatement = /^"/.test(line) ? null : v053MemoryStatement(line, loc);
    if (memoryStatement) {
      frame.statements.push(memoryStatement);
      memoryStores.push({ fn, statement: memoryStatement });
      continue;
    }
    // P4-R13: labels, br and br_if have no typed-v0.53 form.
    if (V053_LABEL_LINE.test(line) || V053_BRANCH_LINE.test(line)) throw v053UnstructuredError(line, loc);
    const yielded = line.match(/^yield\s+(.+)$/);
    if (yielded || line === "yield") {
      if (!inBlock) throw v053SyntaxError("yield outside a block", loc);
      if (!yielded) throw v053SyntaxError("yield requires an atom", loc);
      if (/^phi\./.test(yielded[1].trim())) throw v053UnstructuredError(line, loc);
      const value = normalizeV053Value(yielded[1], frame.statement.destinationType, mod.name, loc);
      // An operation is bound to a local first (OPEN-9 (a); no CT-1 row composes it with a yield).
      if (typeof value !== "string") throw v053SyntaxError(`yield operand must be an atom, not '${yielded[1]}'`, loc);
      frame.statements.push({ kind: "yield", loc, value });
      frame.yielded = true;
      continue;
    }
    const returned = line.match(/^return\s+(.+)$/);
    if (returned || line === "return") {
      if (inBlock) throw v053SyntaxError("return inside a block; a function has a single exit (R-CFG-2)", loc);
      if (!returned) {
        // P4-R12: a bare return in a function with a result.
        if (fn.returnType !== "void") throw new AirError(`air.v051.return_type_mismatch: function '${fn.name}' must return a value`, loc);
        frame.statements.push({ kind: "return", loc, value: "" });
        continue;
      }
      if (/^phi\./.test(returned[1].trim())) throw v053UnstructuredError(line, loc);
      frame.statements.push({ kind: "return", loc, value: normalizeV053Value(returned[1], fn.returnType, mod.name, loc) });
      continue;
    }
    if (/^if\s/.test(line)) throw v053SyntaxError("an if must bind its value (%r: T = if %c { ... })", loc);
    const ifHeader = line.match(V053_IF_HEADER);
    if (ifHeader) {
      const statement = {
        blocks: [{ statements: [] }, { statements: [] }],
        condition: ifHeader[3].trim(),
        destination: ifHeader[1],
        destinationType: parseV053TypedType(ifHeader[2], mod.name, false, loc),
        kind: "if",
        loc
      };
      frame.statements.push(statement);
      stack.push({ fn, kind: "block", openLoc: loc, owner: "then", statement, statements: statement.blocks[0].statements, yielded: false });
      continue;
    }
    const matchHeader = line.match(V053_MATCH_HEADER);
    if (matchHeader) {
      const statement = {
        arms: [],
        destination: matchHeader[1],
        destinationType: parseV053TypedType(matchHeader[2], mod.name, false, loc),
        kind: "match",
        loc,
        value: matchHeader[3]
      };
      frame.statements.push(statement);
      stack.push({ fn, kind: "match", statement });
      continue;
    }
    const callStatement = line.match(V053_CALL_FORM);
    if (callStatement) {
      const statement = { kind: "call", loc, value: v053CallValue(callStatement) };
      frame.statements.push(statement);
      calls.push(statement);
      continue;
    }
    const local = line.match(/^%([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*(.+)$/);
    if (local) {
      const type = parseV053TypedType(local[2], mod.name, false, loc);
      const valueText = local[3].trim();
      if (/^phi\./.test(valueText)) throw v053UnstructuredError(line, loc);
      if (valueText.startsWith(V053_FOLD_PREFIX)) {
        const statement = { kind: "local", loc, name: local[1], type, value: v053FoldValue(valueText, loc) };
        frame.statements.push(statement);
        folds.push(statement);
        continue;
      }
      const memory = v053MemoryValue(valueText, loc);
      if (memory) {
        const statement = { kind: "local", loc, name: local[1], type, value: memory };
        frame.statements.push(statement);
        memoryStores.push({ fn, statement });
        continue;
      }
      const aggregate = v053AggregateValue(valueText) || v053StateValue(valueText);
      if (aggregate) {
        const statement = { kind: "local", loc, name: local[1], type, value: aggregate };
        frame.statements.push(statement);
        aggregates.push(statement);
        continue;
      }
      const call = valueText.match(V053_CALL_FORM);
      // P0-08 (P8-R12): a type that nests a memory type is an escape the
      // verifier reports at this line; its value is kept as written.
      const nested = typeof type === "string" && v053MemoryType(type, loc) === null && V053_NESTED_MEMORY.test(type);
      const statement = { kind: "local", loc, name: local[1], type, value: call ? v053CallValue(call) : nested ? valueText : normalizeV053Value(valueText, type, mod.name, loc) };
      frame.statements.push(statement);
      if (call) calls.push(statement);
      continue;
    }
    throw v053SyntaxError(`unsupported function statement '${line}'`, loc);
  }
  if (stack.length) {
    const open = stack[stack.length - 1];
    const loc = open.kind === "enum" ? open.loc : open.kind === "function" ? open.fn.loc : open.kind === "match" ? open.statement.loc : open.openLoc;
    const label = open.kind === "enum" ? `enum '${open.typeName}'` : open.kind === "function" ? `function '${open.fn.name}'` : open.kind === "match" ? "match" : "block";
    throw v053SyntaxError(`unclosed ${label}`, loc);
  }
  if (!mod.name) throw v053SyntaxError("missing module declaration", { file, line: 1 });
  // Call arguments normalize against the callee's parameter types once every
  // function is known; an unknown callee or a wrong count stays for the verifier.
  const functions = new Map(mod.functions.map((item) => [item.name, item]));
  for (const statement of calls) {
    const callee = functions.get(statement.value.callee);
    if (!callee || callee.params.length !== statement.value.args.length) continue;
    statement.value.args = statement.value.args.map((argument, position) => normalizeV053Argument(argument, callee.params[position].type, mod.name, statement.loc));
  }
  // A fold's seed normalizes against the callback's accumulator type T (P5-R2).
  for (const statement of folds) {
    const callback = functions.get(statement.value.callback);
    if (!callback || !callback.params.length) continue;
    statement.value.seed = normalizeV053Argument(statement.value.seed, callback.params[0].type, mod.name, statement.loc);
  }
  // P0-06: struct and array operands normalize against their field or element type.
  const structs = new Map((mod.structs || []).map((item) => [item.type_id, item.fields]));
  for (const statement of aggregates) normalizeV053AggregateOperands(statement, structs, mod.name);
  // P0-07: a `state.set` value normalizes against the cell type.
  const cells = new Map((mod.states || []).map((item) => [item.name, item.elementType]));
  for (const statement of stateSets) {
    const args = statement.value.args;
    if (args.length === 3 && cells.has(args[0])) args[2] = normalizeV053Argument(args[2], cells.get(args[0]), mod.name, statement.loc);
  }
  // P0-08: a store's value normalizes against its access type, a buffer's
  // against the buffer's element type (the local's declared type).
  const localTypes = new Map();
  for (const { fn, statement } of memoryStores) {
    const value = statement.value;
    if (statement.kind !== "memory" || value.args.length !== 3) continue;
    if (!localTypes.has(fn)) localTypes.set(fn, v053FunctionLocalTypes(fn));
    let type = null;
    const access = /^(?:slice\.)?store\.(i32|f32)$/.exec(value.op);
    if (access) type = access[1];
    else if (value.op === "buffer.store") {
      const declared = localTypes.get(fn).get(String(value.args[0]).replace(/^%/, ""));
      const parts = declared ? /^buffer<(i32|f32),[0-9]+>$/.exec(declared) : null;
      if (parts) type = parts[1];
    }
    if (type) value.args[2] = normalizeV053Argument(value.args[2], type, mod.name, statement.loc);
  }
  return mod;
}

module.exports = { parseAir, parseV051Air, parseV051TypedAir, canonicalizeV051SourceType, splitComma, parseV051Contract };
Object.defineProperty(module.exports, "typedV053", {
  enumerable: false,
  value: Object.freeze({
    AGGREGATE_MAX: V053_AGGREGATE_MAX,
    CONST_NAME: V053_CONST_NAME,
    LITERAL_TOKEN: V053_LITERAL_TOKEN,
    OPERATIONS: V053_OPERATIONS,
    TABLE_ELEMENTS: V053_TABLE_ELEMENTS,
    arrayParts: v053ArrayParts,
    baseLanes: v053BaseLanes,
    isAggregateType: v053IsAggregateType,
    measureType: measureV053Type,
    parse: parseV053TypedAir,
    rejectRefinementForm: rejectV053RefinementForm,
    structFieldTypes: v053StructFieldTypes
  })
});
