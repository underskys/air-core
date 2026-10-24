const { AirError, SOURCE_PROFILE_TYPED_V053 } = require("./errors");
const { assertType, parseRefinementType } = require("./types");
const { applyUseBundles } = require("./bundles");
const { resolveSourceImports } = require("./imports");
const { parseV051Contract } = require("./v051_reference");
const { parseTypeReference } = require("./typed_interface");

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
  rejectV053RefinementForm(text, loc);
  return withV053Location(() => parseV051TypedType(text, moduleId, allowVoid, loc), loc);
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
        const params = functionMatch[3].trim() ? splitComma(functionMatch[3]).map((part) => {
          const parameter = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
          if (!parameter) throw v053SyntaxError(`invalid parameter '${part}'`, loc);
          return { name: parameter[1], type: parseV053TypedType(parameter[2], mod.name, false, loc) };
        }) : [];
        const returnType = parseV053TypedType(functionMatch[4], mod.name, true, loc);
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
        frame.statement.arms.push({ block, loc, pattern: normalizeV053Pattern(blockArm[1], mod.name) });
        if (!frame.statement.blocks) frame.statement.blocks = [];
        frame.statement.blocks.push(block);
        stack.push({ fn: frame.fn, kind: "block", openLoc: loc, owner: "arm", statement: frame.statement, statements: block.statements, yielded: false });
        continue;
      }
      const arm = line.match(/^(.+?)\s*=>\s*(.+?)\s*[,;]?$/);
      if (!arm) throw new AirError("air.decision.match_arm_invalid: match arms must use pattern => expression", loc);
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
    if (inBlock && frame.yielded) throw v053SyntaxError(`statement after the block's yield '${line}'`, loc);
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
      const call = valueText.match(V053_CALL_FORM);
      const statement = { kind: "local", loc, name: local[1], type, value: call ? v053CallValue(call) : normalizeV053Value(valueText, type, mod.name, loc) };
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
  return mod;
}

module.exports = { parseAir, parseV051Air, parseV051TypedAir, canonicalizeV051SourceType, splitComma, parseV051Contract };
Object.defineProperty(module.exports, "typedV053", {
  enumerable: false,
  value: Object.freeze({ OPERATIONS: V053_OPERATIONS, parse: parseV053TypedAir, rejectRefinementForm: rejectV053RefinementForm })
});
