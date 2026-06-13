const LEGACY_CODE_RULES = Object.freeze([
  [/^large-function(?::|$)/, "air.review.large_function"],
  [/^entry-frame-budget(?::|$)/, "air.review.large_entry"],
  [/^large-module$/, "air.review.large_module"],
  [/^mutable-global-budget$/, "air.review.mutable_globals"],
  [/^repeated-literal(?::|$)/, "air.review.repeated_literal"],
  [/^magic-host-literals$/, "air.review.magic_handle_literal"],
  [/^unused-public-surface$/, "air.review.unused_public_surface"],
  [/^select-chain-as-table$/, "air.review.select_chain_table"],
  [/^table-like-patterns$/, "air.review.slot_family_state"],
  [/^debug-metric-event-bus$/, "air.review.debug_metric_event_bus"],
  [/^package-profile-mismatch$/, "air.package.profile_mismatch"],
  [/^facts-schema(?::|$)/, "air.facts.schema_invalid"],
  [/^output-contract(?::|$)/, "air.output_contract.schema_invalid"],
  [/^table-storage-type-invalid$/, "air.table.storage_type_invalid"],
  [/^table-value-out-of-range$/, "air.table.value_out_of_range"],
  [/^table-unsupported-storage-lowering$/, "air.table.unsupported_storage_lowering"],
  [/^tablegroup-invalid$/, "air.tablegroup.invalid"],
  [/^tablegroup-length-mismatch$/, "air.tablegroup.length_mismatch"],
  [/^tablegroup-field-type-invalid$/, "air.tablegroup.field_type_invalid"],
  [/^tablegroup-index-out-of-bounds$/, "air.tablegroup.index_out_of_bounds"],
  [/^tablegroup-dynamic-index-unchecked$/, "air.tablegroup.dynamic_index_unchecked"],
  [/^tablegroup-object-model-rejected$/, "air.tablegroup.object_model_rejected"],
  [/^tablegroup-mutable-rejected$/, "air.tablegroup.mutable_rejected"],
  [/^state-segment-invalid$/, "air.state.segment_invalid"],
  [/^state-cell-type-invalid$/, "air.state.cell_type_invalid"],
  [/^state-length-invalid$/, "air.state.length_invalid"],
  [/^state-init-invalid$/, "air.state.init_invalid"],
  [/^state-op-invalid$/, "air.state.op_invalid"],
  [/^state-pointer-escape$/, "air.state.pointer_escape"],
  [/^state-dynamic-length$/, "air.state.dynamic_length"],
  [/^state-index-out-of-bounds$/, "air.state.index_out_of_bounds"],
  [/^state-dynamic-bounds-required$/, "air.state.dynamic_bounds_required"],
  [/^state-read-budget-exceeded$/, "air.state.read_budget_exceeded"],
  [/^state-write-budget-exceeded$/, "air.state.write_budget_exceeded"],
  [/^state-size-budget-exceeded$/, "air.state.size_budget_exceeded"],
  [/^pool-invalid$/, "air.pool.invalid"],
  [/^pool-capacity-invalid$/, "air.pool.capacity_invalid"],
  [/^pool-active-flag-missing$/, "air.pool.active_flag_missing"],
  [/^pool-field-type-invalid$/, "air.pool.field_type_invalid"],
  [/^pool-unknown-pool$/, "air.pool.unknown_pool"],
  [/^pool-unknown-field$/, "air.pool.unknown_field"],
  [/^pool-index-out-of-bounds$/, "air.pool.index_out_of_bounds"],
  [/^pool-dynamic-capacity-rejected$/, "air.pool.dynamic_capacity_rejected"],
  [/^pool-object-model-rejected$/, "air.pool.object_model_rejected"],
  [/^pool-pointer-escape$/, "air.pool.pointer_escape"],
  [/^pool-loop-budget-exceeded$/, "air.pool.loop_budget_exceeded"],
  [/^pool-mutable-tablegroup-rejected$/, "air.pool.mutable_tablegroup_rejected"],
  [/^generated-(handles|artifacts)$/, "air.generated.stale"],
  [/^module-missing$/, "air.package.unresolved_import"],
  [/^module-private-or-missing-export$/, "air.package.private_cross_module_call"],
  [/^linked-wasm-deferred$/, "air.package.linked_wasm_deferred"],
  [/^asset-placeholder$|^manifest-placeholder-resource$/, "air.manifest.placeholder_resource"],
  [/^manifest-forbidden-runtime-path$/, "air.manifest.forbidden_runtime_path"],
  [/^manifest-missing-runtime-resource$/, "air.manifest.missing_runtime_resource"],
  [/^asset-warning$|^assets?$|^asset$/, "air.manifest.missing_runtime_resource"],
  [/^manifest$/, "air.manifest.id_missing"],
  [/^host-profile$|^target-profile-declared$/, "air.package.profile_mismatch"]
]);

const CODE_CATEGORY = Object.freeze({
  parser: "parser",
  verifier: "verifier",
  package: "package",
  review: "review",
  generated: "generated",
  manifest: "manifest",
  profile: "profile",
  surface: "surface",
  state: "state",
  table: "table",
  trend: "trend"
});

const OUT_EMIT_LABEL = ["output", "emit"].join(".");
const OUT_EVENT_LABEL = ["output", "event"].join(".");

const REPAIR_HINTS_BY_CODE = Object.freeze({
  ["air.api_gate." + "output_event_rejected"]: `Use bounded ${OUT_EMIT_LABEL} or command buffer output intents; ${OUT_EVENT_LABEL} is not accepted.`,
  "air.api_gate.raw_host_authority_rejected": "Move raw host access to a host adapter; AIR may emit bounded scalar intent only.",
  "air.call.recursion_rejected": "Rewrite local recursion as a verifier-bounded loop.fold/loop.array/loop.buffer pattern, or keep recursive work host-owned outside AIR.",
  "air.contract.precondition_unproven": "Add a simple scalar caller precondition, use a callee return postcondition, or pass a statically bounded value that proves the callee requirement.",
  "air.contract.precondition_violated": "Pass a value that satisfies the callee's declared scalar precondition.",
  "air.generated.output_handles_missing": "Run airc generate output-handles for the package or remove the generated output handles declaration.",
  "air.generated.output_handles_mismatch": "Regenerate output handles from Output Contracts; generated files are derived artifacts.",
  "air.generated.output_handles_stale": "Regenerate output handles from Output Contracts; do not edit generated handles by hand.",
  "air.generated.output_metadata_invalid": "Regenerate output handle metadata from Output Contracts.",
  "air.generated.stale": "Regenerate derived artifacts from their source manifests or remove stale generated declarations.",
  "air.generated.state_handles_missing": "Run the state handle generator for the package or remove the generated state handles declaration.",
  "air.generated.state_handles_mismatch": "Regenerate state handles from state declarations; generated files are derived artifacts.",
  "air.generated.state_handles_stale": "Regenerate state handles from state declarations; do not edit generated handles by hand.",
  "air.generated.state_metadata_invalid": "Regenerate state handle metadata from state declarations.",
  "air.memory.region_leak": "Call free_region on all paths before returning from the function.",
  "air.output_emit.host_abi_unsupported": `Use Host ABI 0.11 only for bounded ${OUT_EMIT_LABEL} packages, or remove ${OUT_EMIT_LABEL}.`,
  "air.output_emit.output_handle_required": "Use the generated OUTPUT_* handle constant for canonical bounded output authoring.",
  "air.output_emit.output_id_dynamic": "Use a generated OUTPUT_* handle or a static output id declared by Output Contracts.",
  "air.output_emit.output_id_invalid": "Declare the output id in Output Contracts or use an existing generated OUTPUT_* handle.",
  "air.output_emit.profile_unsupported": `Choose a host profile that supports bounded ${OUT_EMIT_LABEL} or remove ${OUT_EMIT_LABEL}.`,
  "air.package.host_abi": "Use a compatible host profile or migrate ABI only through the version policy.",
  "air.package.profile_mismatch": "Choose a compatible profile or remove unsupported package requirements.",
  "air.review.debug_metric_event_bus": "Keep debug.metric diagnostic-only; use accepted output contracts or command buffers for host-visible intents.",
  "air.structured_io.field_type_invalid": "Use supported scalar field types: i32 or bool; represent enums, handles, and ids as i32.",
  "air.structured_io.generated_stale": "Regenerate structured IO handles from schemas; schemas remain the source of truth.",
  "air.structured_io.object_field_rejected": "Replace objects, maps, and nested fields with fixed scalar fields in a bounded schema.",
  ["air.structured_io." + "runtime_json_rejected"]: "Use a bounded scalar structured IO schema instead of unbounded payload data.",
  "air.structured_io.schema_invalid": "Fix structured IO schema shape with stable names, scalar fields, privacy classification, and fixed bounds.",
  ["air.structured_io." + "unbounded_rowset"]: "Add a fixed positive maxRows bound to the schema.",
  "air.tablegroup.field_type_invalid": "Use readonly tablegroup fields with supported scalar types: i32 or bool.",
  "air.tablegroup.length_mismatch": "Make every tablegroup field initializer length match the declared fixed len.",
  "air.tablegroup.mutable_rejected": "Use readonly tablegroup.get access only; mutable pools require a separate accepted feature.",
  "air.tablegroup.object_model_rejected": "Use fixed scalar tablegroup fields; runtime JSON, objects, maps, and methods are rejected.",
  "air.pool.invalid": "Use the accepted first-slice pool declaration and pool.capacity/pool.get/pool.set operations only.",
  "air.pool.capacity_invalid": "Declare a fixed positive integer literal pool capacity.",
  "air.pool.active_flag_missing": "Add an active:bool field to the pool declaration.",
  "air.pool.field_type_invalid": "Use scalar pool fields with supported types: i32 or bool, initialized with scalar literals.",
  "air.pool.unknown_pool": "Reference an existing declared pool.",
  "air.pool.unknown_field": "Reference an existing field on the declared pool.",
  "air.pool.index_out_of_bounds": "Prove the pool index is within the declared fixed capacity.",
  "air.pool.dynamic_capacity_rejected": "Use a fixed positive integer literal capacity; dynamic pool capacity is deferred.",
  "air.pool.object_model_rejected": "Use fixed scalar pool fields; runtime JSON, objects, maps, GC, and methods are rejected.",
  "air.pool.pointer_escape": "Use pool.get/pool.set only; pool pointers, slices, references, and exports must not escape.",
  "air.pool.loop_budget_exceeded": "Keep pool loops within verifier-visible static loop budgets.",
  "air.pool.mutable_tablegroup_rejected": "Use a declared pool for mutable repeated state; readonly tablegroups cannot be mutated.",
  "air.verify.host_object_handle_rejected": "Use scalar package or manifest ids; host-owned objects must stay outside AIR."
});

function diagnosticCodeForLegacyId(legacyId, fallback = null) {
  const id = String(legacyId || "");
  for (const [re, code] of LEGACY_CODE_RULES) {
    if (re.test(id)) return code;
  }
  return fallback || codeFromLegacyId(id);
}

function diagnosticHintsFromMessage(message) {
  const text = String(message || "");
  const loc = parseLeadingLocation(text);

  let match = text.match(/air\.call\.recursion_rejected: local function call cycle ([^\n]+)/);
  if (match) {
    const cyclePath = match[1].trim();
    return withLocation(loc, {
      legacyId: "call-recursion-rejected",
      code: "air.call.recursion_rejected",
      severity: "error",
      fields: {
        cyclePath,
        functions: cyclePath.split(/\s*->\s*/).map((name) => name.replace(/^@/, "")),
        path: loc.file
      }
    });
  }

  match = text.match(/air\.memory\.region_leak: region (%[A-Za-z_][A-Za-z0-9_]*)(?: allocated at line ([0-9]+))? reaches return in block '([^']+)' without free_region/);
  if (match) {
    return withLocation(loc, {
      legacyId: "memory-region-leak",
      code: "air.memory.region_leak",
      severity: "error",
      fields: {
        region: match[1],
        allocationLine: match[2] === undefined ? null : Number(match[2]),
        returnBlock: match[3],
        path: loc.file
      }
    });
  }

  match = text.match(/call @([A-Za-z_][A-Za-z0-9_.]*) violates precondition param ([A-Za-z_][A-Za-z0-9_]*) (<=|==|>=) (-?[0-9]+(?:\.[0-9]+)?): (-?[0-9]+(?:\.[0-9]+)?)/);
  if (match) {
    return withLocation(loc, {
      legacyId: "contract-precondition-violated",
      code: "air.contract.precondition_violated",
      severity: "error",
      fields: {
        callee: match[1],
        param: match[2],
        op: match[3],
        requiredValue: Number(match[4]),
        actualValue: Number(match[5]),
        path: loc.file
      }
    });
  }

  match = text.match(/call @([A-Za-z_][A-Za-z0-9_.]*) cannot prove precondition param ([A-Za-z_][A-Za-z0-9_]*) (<=|==|>=) (-?[0-9]+(?:\.[0-9]+)?); known range is \[(-?[0-9]+(?:\.[0-9]+)?), (-?[0-9]+(?:\.[0-9]+)?)\](?:; ([^\n]+))?/);
  if (match) {
    return withLocation(loc, {
      legacyId: "contract-precondition-unproven",
      code: "air.contract.precondition_unproven",
      severity: "error",
      fields: {
        callee: match[1],
        param: match[2],
        op: match[3],
        requiredValue: Number(match[4]),
        knownRange: [Number(match[5]), Number(match[6])],
        missingFact: match[7] || null,
        path: loc.file
      }
    });
  }

  match = text.match(/table '([^']+)' value ([0-9]+)(?: literal (-?[0-9]+))? out of range for (u8|u16|i16) storage/);
  if (match) {
    const storageType = match[4];
    return withLocation(loc, {
      legacyId: "table-value-out-of-range",
      code: "air.table.value_out_of_range",
      fields: {
        table: match[1],
        index: Number(match[2]),
        value: match[3] === undefined ? null : Number(match[3]),
        storageType,
        allowedRange: allowedRangeForStorageType(storageType),
        path: loc.file
      }
    });
  }

  match = text.match(/table '([^']+)' storage type ([A-Za-z0-9_]+) must be read with (table\.get\.[A-Za-z0-9_]+)/);
  if (match) {
    return withLocation(loc, {
      legacyId: "table-storage-type-invalid",
      code: "air.table.storage_type_invalid",
      fields: {
        table: match[1],
        storageType: match[2],
        expectedOp: match[3],
        path: loc.file
      }
    });
  }

  match = text.match(/(table\.get\.[A-Za-z0-9_]+) requires compact table storage, but '([^']+)' is ([A-Za-z0-9_]+)/);
  if (match) {
    return withLocation(loc, {
      legacyId: "table-storage-type-invalid",
      code: "air.table.storage_type_invalid",
      fields: {
        op: match[1],
        table: match[2],
        storageType: match[3],
        path: loc.file
      }
    });
  }

  match = text.match(/table '([^']+)' element type '([^']+)' is not supported in static scalar tables/);
  if (match) {
    return withLocation(loc, {
      legacyId: "table-storage-type-invalid",
      code: "air.table.storage_type_invalid",
      fields: {
        table: match[1],
        storageType: match[2],
        path: loc.file
      }
    });
  }

  if (/unsupported compact table|unsupported storage lowering/.test(text)) {
    return withLocation(loc, {
      legacyId: "table-unsupported-storage-lowering",
      code: "air.table.unsupported_storage_lowering",
      fields: {
        path: loc.file
      }
    });
  }

  let tablegroupMatch = text.match(/tablegroup '([^']+)' field '([^']+)' type '([^']+)' is not supported/);
  if (tablegroupMatch) {
    return withLocation(loc, {
      legacyId: "tablegroup-field-type-invalid",
      code: "air.tablegroup.field_type_invalid",
      fields: {
        tablegroup: tablegroupMatch[1],
        field: tablegroupMatch[2],
        type: tablegroupMatch[3],
        path: loc.file
      }
    });
  }

  tablegroupMatch = text.match(/tablegroup '([^']+)'(?: field '([^']+)')? length must be|tablegroup '([^']+)' must declare|tablegroup '([^']+)' field declaration is invalid|unknown tablegroup field '([^']+)'|duplicate tablegroup '([^']+)'/);
  if (tablegroupMatch) {
    return withLocation(loc, {
      legacyId: "tablegroup-invalid",
      code: "air.tablegroup.invalid",
      fields: {
        tablegroup: tablegroupMatch[1] || tablegroupMatch[3] || tablegroupMatch[4] || tablegroupMatch[6] || null,
        field: tablegroupMatch[2] || tablegroupMatch[5] || null,
        path: loc.file
      }
    });
  }

  tablegroupMatch = text.match(/tablegroup '([^']+)' field '([^']+)' length ([0-9]+) does not match group length ([0-9]+)/);
  if (tablegroupMatch) {
    return withLocation(loc, {
      legacyId: "tablegroup-length-mismatch",
      code: "air.tablegroup.length_mismatch",
      fields: {
        tablegroup: tablegroupMatch[1],
        field: tablegroupMatch[2],
        length: Number(tablegroupMatch[3]),
        expectedLength: Number(tablegroupMatch[4]),
        path: loc.file
      }
    });
  }

  tablegroupMatch = text.match(/table '([^']+\.[^']+)' length ([0-9]+) does not match ([0-9]+) initializer value/);
  if (tablegroupMatch) {
    const [group, field] = tablegroupMatch[1].split(".");
    return withLocation(loc, {
      legacyId: "tablegroup-length-mismatch",
      code: "air.tablegroup.length_mismatch",
      fields: {
        tablegroup: group,
        field,
        length: Number(tablegroupMatch[3]),
        expectedLength: Number(tablegroupMatch[2]),
        path: loc.file
      }
    });
  }

  tablegroupMatch = text.match(/tablegroup '([^']+)' field '([^']+)' static index (-?[0-9]+) out of bounds for length ([0-9]+)/);
  if (tablegroupMatch) {
    return withLocation(loc, {
      legacyId: "tablegroup-index-out-of-bounds",
      code: "air.tablegroup.index_out_of_bounds",
      fields: {
        tablegroup: tablegroupMatch[1],
        field: tablegroupMatch[2],
        index: Number(tablegroupMatch[3]),
        length: Number(tablegroupMatch[4]),
        path: loc.file
      }
    });
  }

  if (/^.*tablegroup\.(?:set|mut|mutable|push|append|store)/.test(text) || /readonly tablegroups cannot mutate/.test(text)) {
    return withLocation(loc, {
      legacyId: "tablegroup-mutable-rejected",
      code: "air.tablegroup.mutable_rejected",
      fields: { path: loc.file }
    });
  }

  if (/tablegroup\.(?:addr|ptr|pointer|ref|reference|slice|object|json|method)|object\/JSON semantics/.test(text)) {
    return withLocation(loc, {
      legacyId: "tablegroup-object-model-rejected",
      code: "air.tablegroup.object_model_rejected",
      fields: { path: loc.file }
    });
  }

  let poolMatch = text.match(/(air\.pool\.[A-Za-z_]+):\s*(.*)$/);
  if (poolMatch) {
    return withLocation(loc, {
      legacyId: poolMatch[1].replace(/^air\./, "").replace(/\./g, "-"),
      code: poolMatch[1],
      severity: "error",
      fields: poolFieldsFromMessage(poolMatch[2], loc.file)
    });
  }

  let stateMatch = text.match(/state '([^']+)' cell type '([^']+)' is not supported/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-cell-type-invalid",
      code: "air.state.cell_type_invalid",
      fields: {
        state: stateMatch[1],
        cellType: stateMatch[2],
        path: loc.file
      }
    });
  }

  stateMatch = text.match(/state '([^']+)' length must be a fixed positive integer literal/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-dynamic-length",
      code: "air.state.dynamic_length",
      fields: {
        state: stateMatch[1],
        path: loc.file
      }
    });
  }

  stateMatch = text.match(/state '([^']+)' length must be between 1 and 65536/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-length-invalid",
      code: "air.state.length_invalid",
      fields: {
        state: stateMatch[1],
        path: loc.file
      }
    });
  }

  stateMatch = text.match(/state '([^']+)' initializer/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-init-invalid",
      code: "air.state.init_invalid",
      fields: {
        state: stateMatch[1],
        path: loc.file
      }
    });
  }

  stateMatch = text.match(/unknown state '([^']+)'|expected state segment name|state\.[A-Za-z0-9_.]+ .*forbidden|state\.set does not produce a result|state\.(?:len|get|set) (?:produces|expects|requires)/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-op-invalid",
      code: /forbidden|pointer|slice|reference|escape/.test(text) ? "air.state.pointer_escape" : "air.state.op_invalid",
      fields: {
        state: stateMatch[1] || null,
        path: loc.file
      }
    });
  }

  stateMatch = text.match(/state '([^']+)' static index (-?[0-9]+) out of bounds for length ([0-9]+)/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-index-out-of-bounds",
      code: "air.state.index_out_of_bounds",
      fields: {
        state: stateMatch[1],
        index: Number(stateMatch[2]),
        length: Number(stateMatch[3]),
        path: loc.file
      }
    });
  }

  stateMatch = text.match(/effect budget '(state\.read) ([<>=]+) ([0-9]+)' is not satisfied: ([0-9]+)/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-read-budget-exceeded",
      code: "air.state.read_budget_exceeded",
      fields: budgetFields(stateMatch, loc)
    });
  }

  stateMatch = text.match(/effect budget '(state\.write) ([<>=]+) ([0-9]+)' is not satisfied: ([0-9]+)/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-write-budget-exceeded",
      code: "air.state.write_budget_exceeded",
      fields: budgetFields(stateMatch, loc)
    });
  }

  stateMatch = text.match(/effect budget '((?:memory\.)?static_state_bytes|state\.static_bytes) ([<>=]+) ([0-9]+)' is not satisfied: ([0-9]+)/);
  if (stateMatch) {
    return withLocation(loc, {
      legacyId: "state-size-budget-exceeded",
      code: "air.state.size_budget_exceeded",
      fields: budgetFields(stateMatch, loc)
    });
  }

  return {};
}

function budgetFields(match, loc) {
  return {
    budget: match[1],
    op: match[2],
    limit: Number(match[3]),
    actual: Number(match[4]),
    path: loc.file
  };
}

function codeFromLegacyId(legacyId) {
  const id = String(legacyId || "unknown")
    .replace(/:.+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `air.package.${id || "unknown"}`;
}

function categoryForCode(code) {
  const domain = String(code || "").split(".")[1] || "package";
  return CODE_CATEGORY[domain] || domain;
}

function normalizeSeverity(value) {
  const severity = String(value || "").toLowerCase();
  if (severity === "error" || severity === "fail" || severity === "failed") return "fail";
  if (severity === "warning" || severity === "warn") return "warn";
  if (severity === "skip" || severity === "skipped") return "info";
  if (severity === "pass" || severity === "ok") return "info";
  if (severity === "info") return "info";
  return "warn";
}

function packageStatusImpactForSeverity(severity, gateAction = null) {
  if (gateAction === "fail" || severity === "fail") return "fail";
  if (gateAction === "warn" || severity === "warn") return "warn";
  return "none";
}

function repairHintForDiagnosticCode(code) {
  return REPAIR_HINTS_BY_CODE[String(code || "")] || null;
}

function normalizeDiagnostic(input = {}) {
  const legacyId = input.legacyId || input.id || null;
  const code = input.code || diagnosticCodeForLegacyId(legacyId);
  const severity = normalizeSeverity(input.severity || input.status);
  const category = input.category || categoryForCode(code);
  const gateAction = input.gateAction || null;
  const diagnostic = {
    code,
    legacyId,
    severity,
    category,
    source: input.source || category,
    message: String(input.message || ""),
    repairHint: input.repairHint || repairHintForDiagnosticCode(code),
    file: input.file || null,
    line: numberOrNull(input.line),
    col: numberOrNull(input.col),
    endLine: numberOrNull(input.endLine),
    endCol: numberOrNull(input.endCol),
    module: input.module || null,
    symbol: input.symbol || null,
    metric: input.metric || (input.fields && input.fields.metric) || null,
    value: numberOrNull(input.value !== undefined ? input.value : (input.fields && input.fields.value)),
    threshold: numberOrNull(input.threshold !== undefined ? input.threshold : (input.fields && input.fields.threshold)),
    pathClass: input.pathClass || null,
    gateAction,
    packageStatusImpact: input.packageStatusImpact || packageStatusImpactForSeverity(severity, gateAction),
    fields: stableObject(input.fields || {}),
    related: normalizeRelated(input.related || [])
  };
  return diagnostic;
}

function normalizeRelated(items) {
  return (items || [])
    .map((item) => stableObject(item || {}))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function sortDiagnostics(diagnostics) {
  return (diagnostics || []).slice().sort(compareDiagnostics);
}

function compareDiagnostics(a, b) {
  return String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.file || "").localeCompare(String(b.file || "")) ||
    numberCompare(a.line, b.line) ||
    numberCompare(a.col, b.col) ||
    String(a.legacyId || "").localeCompare(String(b.legacyId || "")) ||
    String(a.message || "").localeCompare(String(b.message || ""));
}

function normalizeDiagnostics(items) {
  return sortDiagnostics((items || []).map((item) => normalizeDiagnostic(item)));
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function numberCompare(a, b) {
  const left = Number.isFinite(a) ? a : Number.MAX_SAFE_INTEGER;
  const right = Number.isFinite(b) ? b : Number.MAX_SAFE_INTEGER;
  return left - right;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function parseLeadingLocation(message) {
  const match = String(message || "").match(/^(.+?):([0-9]+)(?::([0-9]+))?:\s+/);
  if (!match) return { file: null, line: null, col: null };
  return {
    file: match[1] || null,
    line: Number(match[2]),
    col: match[3] === undefined ? null : Number(match[3])
  };
}

function withLocation(loc, hint) {
  return {
    ...hint,
    file: loc.file || null,
    line: Number.isFinite(loc.line) ? loc.line : null,
    col: Number.isFinite(loc.col) ? loc.col : null,
    module: loc.file || null,
    fields: stableObject(hint.fields || {})
  };
}

function poolFieldsFromMessage(message, file) {
  const fields = { path: file };
  const pool = String(message || "").match(/pool '([^']+)'/);
  if (pool) fields.pool = pool[1];
  const field = String(message || "").match(/field '([^']+)'/);
  if (field) fields.field = field[1];
  const type = String(message || "").match(/type '([^']+)'|type ([A-Za-z0-9_]+)/);
  if (type) fields.type = type[1] || type[2];
  const index = String(message || "").match(/static index (-?[0-9]+)/);
  if (index) fields.index = Number(index[1]);
  const capacity = String(message || "").match(/capacity ([0-9]+)/);
  if (capacity) fields.capacity = Number(capacity[1]);
  return fields;
}

function allowedRangeForStorageType(storageType) {
  if (storageType === "u8") return "0..255";
  if (storageType === "u16") return "0..65535";
  if (storageType === "i16") return "-32768..32767";
  return null;
}

module.exports = {
  diagnosticCodeForLegacyId,
  diagnosticHintsFromMessage,
  normalizeDiagnostic,
  normalizeDiagnostics,
  normalizeSeverity,
  repairHintForDiagnosticCode,
  sortDiagnostics
};
