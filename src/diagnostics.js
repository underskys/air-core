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
  "air.memory.region_bounds_runtime": "Keep runtime offsets and access widths inside the exact allocated region boundary.",
  "air.memory.region_bounds_static": "Keep offset non-negative and prove offset plus access width is within the allocated region, or use a verifier-bounded dynamic offset.",
  "air.verifier.analysis_limit_exceeded": "Split the module or flatten its local call graph so function count, call edges, call depth and analysis work stay within the documented legacy verifier maintenance limits.",
  "air.workbound.overflow": "Reduce loop counts, call fan-out or nesting so every WorkBound dimension stays within 9223372036854775807.",
  "air.workbound.unknown_bound": "Give the loop count, index range or allocation size a proven maximum; unknown is not a WorkBound value.",
  "air.workbound.missing_summary": "Call only functions whose summary is in the verified closure; external, opaque or missing targets have no summary.",
  "air.workbound.invalid_bound": "Declare the maximum as a non-negative integer literal within the profile cap.",
  "air.workbound.identity_mismatch": "Discard the supplied WorkBound summary or record; summaries are recomputed from bytes bound by identity and never lowered.",
  "air.workbound.cost_undefined": "Implementation defect: a construct reached the WorkBound summarizer without a CT-1 row. Report it; do not change the source.",
  // typed-v0.53 SCALAR (RFC §15; docs/v0.53/SCALAR.md §6).
  "air.analysis.capacity_exceeded": "ANALYSIS_REFUSED is not a verdict: this host's analysis capacity is below the measure the source requires. Use a host with more capacity or a smaller closure; the program's validity is unchanged.",
  "air.assurance.profile_unsupported": "This assurance tool does not support typed-v0.53 sources in v0.53; use the typed-v0.53 verifier, WorkBound summaries and diagnostics instead.",
  "air.build.engine_limit": "The admitted build plan exceeds a WebAssembly engine limit (JS API §8); split the function or reduce its parameters or locals.",
  "air.numeric.operation_mode_required": "Choose an explicit i32 family: i32.checked_* fails on overflow, i32.wrapping_* wraps modulo 2^32; division and remainder exist only as i32.checked_div_s and i32.checked_rem_s.",
  "air.source_profile.ast_mismatch": "Process the AST under the source profile it was parsed with.",
  "air.source_profile.candidate_disabled": "typed-v0.53 is a candidate profile: select it with allowCandidateProfile: true or --allow-candidate-profile.",
  // typed-v0.53 P0-03 (slice text §4.1, §4.4; docs/v0.53/P0_03_REFINEMENTS.md).
  "air.refinement.ingress_out_of_range": "The host passed a value outside the exported parameter's refinement; pass a value inside i32<MIN..MAX> or widen the parameter type.",
  "air.refinement.base_type_unsupported": "typed-v0.53 refines only i32: use i32<MIN..MAX>, or keep i64, f32 and f64 values unrefined and check them explicitly.",
  "air.runtime.trap_unclassified": "Implementation defect: a typed-v0.53 trap left failure reason 0, which is never a valid language disposition. Report it with the source and the build record.",
  "air.runtime.failure_reason_unknown": "The artifact reported a failure reason that is not in the registry; the adapter fails closed. Rebuild the artifact with the matching compiler and adapter.",
  "air.decision.enum_discriminant_invalid": "Pass a discriminant that is a declared case of the enum; a direct Wasm caller must encode only declared cases.",
  "air.decision.payload_tag_invalid": "A direct Wasm caller passed an option/result tag other than 0 or 1; encode none/ok as 0 and some/err as 1.",
  "air.decision.bool_lane_invalid": "A direct Wasm caller passed a bool lane other than 0 or 1; encode false as 0 and true as 1.",
  "air.decision.payload_lane_noncanonical": "A direct Wasm caller passed non-zero bits in an inactive option/result lane; write all-zero bits (raw bits for f32/f64) in every lane the tag makes inactive.",
  // typed-v0.53 P0-04 (slice text §4.1-§4.5; docs/v0.53/P0_04_CALLS_CFG.md).
  "air.call.unknown_function": "Call a function declared in this module; imported and extern callees arrive with later slices.",
  "air.call.result_unbound": "Bind the result of a non-void call (%r: T = call @f(...)); only a void callee is called as a statement.",
  "air.call.argument_count_mismatch": "Pass exactly one atom per parameter of the callee.",
  "air.control.unstructured_unsupported": "typed-v0.53 has no labels, br, br_if or phi; branch with a value if or a match whose blocks end with yield.",
  "air.control.yield_missing": "End every block with exactly one yield, and give every value if an else block.",
  // typed-v0.53 P0-05 (slice text §4.2, §4.6, §4.7; docs/v0.53/P0_05_LOOPS.md).
  "air.loop.form_unsupported": "typed-v0.53 has one loop form, %acc: T = loop.fold @f, <seed>, <count>, with a literal count or %c max n; loop.range/map/while/array/buffer, polling forms, for and while are not admitted.",
  "air.loop.count_out_of_range": "The dynamic count of loop.fold @f, <seed>, %c max n was outside 0..n; no iteration ran. Pass a count within the declared maximum.",
  "air.workbound.assertion_exceeded": "An export's WorkBound exceeds the module's work { ... } assertion: reduce the work or raise the declared bound. The assertion is a static verifier check, never host authority.",
  // typed-v0.53 P0-06 (slice text P6-R4, P6-R8, P6-R10; docs/v0.53/P0_06_AGGREGATES.md).
  "air.table.readonly": "typed-v0.53 tables are read-only: read them with %v: T = table.get t, i, and keep values that change in locals, structs or arrays.",
  "air.table.index_out_of_range": "Keep the table index inside 0 <= i < N: a statically known index outside it is rejected, and any other index is checked before the read (failure 33).",
  "air.array.index_out_of_range": "Keep the array index inside 0 <= i < N: a statically known index outside it is rejected, and any other index is checked before the access (failure 35).",
  "air.abi.export_type_unsupported": "Structs and arrays are internal: give an export scalar, enum, option or result parameters and results, and build or read the aggregate inside the module.",
  // typed-v0.53 P0-07 (slice text P7-R2; docs/v0.53/P0_07_STATE.md).
  "air.const.initializer_invalid": "A constant takes exactly one literal of its type: const NAME: T = <literal>. Compute any other value in a function.",
  // typed-v0.53 P0-08 (slice text P8-R26; docs/v0.53/TYPED_MEMORY.md).
  "air.memory.region_not_live": "Use a region, or a view or buffer made from it, only between its alloc_region and its free_region on every path; free it exactly once.",
  "air.memory.view_escape": "Keep ptr, slice, buffer and borrowed views in locals and parameters: no memory-typed result, field, element, payload, accumulator, branch destination or copy is admitted at P0-08.",
  "air.memory.free_not_owner": "Free a region only in the function that allocated it; a ptr parameter belongs to the caller.",
  "air.memory.readonly_data": "A literal view is read-only: copy its bytes into a region (alloc_region, store) before writing, and pass it only to readonly uses.",
  "air.memory.region_size_unsupported": "Keep every region size at most 16777216 bytes (REGION_MAX): use a smaller literal size, max bound or refinement.",
  "air.abi.borrowed_lane_plain_export": "A module with a borrowed_slice export is invoked only through the typed admission: give every export a borrowed_slice parameter, or move the plain export to a module without borrowed exports.",
  "air.abi.slice_return_unsupported": "An export cannot return a slice: return a scalar, or write into a writeonly or readwrite borrowed_slice parameter.",
  "air.build.memory_backing_limit": "BUILD_REFUSED is not a verdict: the module's backing_bytes exceed this host's backing limit (64 MiB by default). Reduce region maxima or literal views, or use a host with a larger limit.",
  "air.abi.contract_unsupported": "The artifact's AIR contract import is not the one this host implements (air:contract typed-v0.53.v1, nothing else imported); rebuild it with a matching compiler.",
  "air.borrow.air_owned_memory_overlap": "A borrowed range overlaps memory the module owns: bind host ranges outside the AIR-owned range (typed-v0.53: [16, 16 + backing_bytes) from the trusted record).",
  "air.borrow.module_identity_mismatch": "The artifact bytes are not the bytes the trust root names: admit the exact verified artifact with its own record or pinned digest.",
  "air.borrow.air_memory_layout_unknown": "The instance's owned range is absent or differs from the trusted record; the instance is discarded. Rebuild the artifact with the verified builder.",
  "air.abi.record_untrusted": "Admit a typed-v0.53 artifact with its verified build record from buildVerifiedTypedModule in this process (T1) or a host-pinned sha256 digest of its bytes (T2); a record delivered with the bytes is not trusted.",
  // typed-v0.53 P0-09 (slice text P9-R24; docs/v0.53/P0_09_IMPORTS.md).
  "air.import.path_uncontained": "Import a package-relative module: use \"./name.air\" as alias or \"../dir/name.air\" as alias, with ASCII segments and no path that leaves the package root, directly or through a symbolic link.",
  "air.import.not_found": "Name a module file of the package, spelled exactly as its directory entry (case included); a <...> source label has no package, so pass the root's file path to import.",
  "air.import.cycle": "typed-v0.53 module imports must form no cycle: move the shared functions into a module that both import.",
  "air.import.duplicate_module": "Import each module once per module: keep one use line for the module and call its exports through that alias.",
  "air.import.bundle_unsupported": "typed-v0.53 imports package-relative modules only: write use \"./name.air\" as alias; bundles are not imported by typed-v0.53.",
  "air.import.stdlib_unsupported": "typed-v0.53 has no standard library: import a package-relative module (use \"./name.air\" as alias) or write the function in this module.",
  "air.import.profile_mismatch": "A typed-v0.53 module imports typed-v0.53 modules only: port the imported module to typed-v0.53 or keep it out of this closure.",
  "air.import.signature_type_unsupported": "Only i32, i64, f32, f64, bool, refined integers and option<T> of these cross a module boundary: call an export with such a signature, or move the function into this module.",
  "air.v052.work_limit_modules": "INTAKE_REFUSED is not a verdict: the closure reaches more modules than the configured limit (64 by default); import fewer modules or merge small ones.",
  // typed-v0.53 P0-10 (slice text P10-R26; docs/v0.53/P0_10_EFFECT_DEMAND.md).
  "air.extern.unsupported": "Declare only a Host ABI registry entry as extern <family>.<name>(...) -> R; typed-v0.53 adds no host import, and the async and io entries are DEFERRED_V054.",
  "air.extern.signature_mismatch": "Write the extern with the registry entry's exact parameter and result types (i32, i64, f32, bool, ptr, void); a refined type is not a registry type.",
  "air.extern.alias_conflict": "An import alias equals an extern's family, so @family.name would be ambiguous: rename the import alias.",
  "air.capability.required_missing": "Declare capabilities { <family> } for every extern the module declares and for every effect key its calls reach, imported calls included; importing grants no capability.",
  "air.effect.demand_missing": "Declare every effect key the module calls or an export reaches in demand { <key> <= N }; a demand is an upper bound on calls per key, never a grant.",
  "air.effect.demand_exceeded": "An export reaches an effect key more times than the module's demand allows: raise the bound in demand { <key> <= N } or make fewer host calls.",
  "air.effect.demand_key_invalid": "A demand key names a host import the module may declare (an admitted registry entry); work keys, misspellings, async or io keys and the contract import are never demand keys.",
  "air.host.binding_missing": "Pass handlers with one function per host import the artifact declares, called or not; the adapter supplies no default or stub handler.",
  "air.host.binding_invalid": "Pass handlers as a plain object whose own data properties are the artifact's host import names with function values; no getter, extra name or other value.",
  "air.host.result_invalid": "Return the registry result type exactly: i32 an integer Number in range, bool 0 or 1, i64 a BigInt in range, f32 a Number exactly representable (or NaN), void undefined.",
  "air.host.import_failed": "A host handler threw or returned a promise; the invocation failed and nothing is rolled back. Handlers are synchronous: return a value, never a promise.",
  "air.host.reentrancy_forbidden": "A handler invoked the same admission or one of its instances during a host call; the inner call never started and the running invocation failed. Invoke after the call returns.",
  "air.host.call_before_admission": "The artifact called a host import before admission (in its start function); the host function did not run and the instance was discarded. Rebuild it with the verified builder.",
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
  "air.abi.borrowed_slice_lowering_unavailable": "Keep slices internal until Borrowed Slices define exported pointer-and-length metadata, or expose explicit scalar ABI fields.",
  "air.abi.borrowed_slice_requires_0_11": "Select AIR ABI 0.11 for packages with borrowed-slice exports; AIR ABI 0.10 remains the legacy scalar/handle ABI.",
  "air.abi.borrowed_slice_interface_mismatch": "Use the interface descriptor and AIR ABI selected for the exact module; do not pass a borrowed tuple to a legacy export.",
  "air.borrow.syntax_invalid": "Use borrowed_slice<ACCESS,len<=MAX,align=ALIGNMENT> with an explicit access mode, finite byte length, and supported alignment.",
  "air.borrow.mode_invalid": "Use readonly, writeonly, or readwrite.",
  "air.borrow.mode_violation": "Use only operations permitted by the declared mode and preserve the mode across sub-slices.",
  "air.borrow.length_invalid": "Use a finite byte-length range within the parent borrow and 0..2147483647.",
  "air.borrow.length_out_of_range": "Pass a non-negative actual byte length within the declared borrowed-slice range.",
  "air.borrow.pointer_out_of_bounds": "Bind the borrowed pointer and byte length entirely within Wasm linear memory.",
  "air.borrow.alignment_mismatch": "Use a pointer aligned to the borrowed-slice declaration.",
  "air.borrow.mutable_overlap": "Use disjoint non-empty ranges whenever either borrowed slice is mutable.",
  "air.borrow.entry_relation_failed": "Satisfy every checked scalar and borrowed-length entry relation.",
  "air.borrow.entry_arithmetic_overflow": "Keep checked scalar multiplication inside signed i32 before comparing it with a borrowed byte length.",
  "air.borrow.async_forbidden": "Do not retain or forward an invocation-scoped borrow across asynchronous work.",
  "air.borrow.reentrant_invocation": "Finish the active invocation before binding borrowed memory to the same instance again.",
  "air.borrow.invocation_reused": "Prepare a new invocation so every borrow is revalidated against current memory and descriptors.",
  "air.borrow.memory_changed": "Recreate and revalidate borrowed views after WebAssembly.Memory grows or changes identity.",
  "air.borrow.buffer_stale": "Create a fresh host view and repeat validation before invoking.",
  "air.borrow.buffer_detached": "Use an attached TypedArray backing buffer and repeat validation.",
  "air.borrow.unbounded": "Declare a finite maximum byte length.",
  "air.borrow.alignment_invalid": "Use alignment 1, 2, 4, 8, or 16 and keep typed accesses and subslices aligned.",
  "air.borrow.escape_return": "Keep the borrowed value invocation-scoped; return a scalar status or write through an authorized borrowed output.",
  "air.borrow.escape_storage": "Do not store a borrowed value in globals, state, pools, structs, or retained handles.",
  "air.borrow.free_forbidden": "Borrowed memory is host-owned and cannot be freed or grown by AIR.",
  "air.borrow.extern_opaque": "Keep the borrow inside statically verified local calls; opaque extern forwarding is unsupported.",
  "air.borrow.call_mismatch": "Match the callee borrow access, length range, and alignment without expanding authority.",
  "air.borrow.reinterpret_forbidden": "Preserve the explicit borrowed_slice descriptor; do not reinterpret it as a legacy slice.",
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
  "air.refinement.syntax_invalid": "Use i32<MIN..MAX>, slice<len<=N>, slice<len=MIN..MAX>, or slice<nonempty>.",
  "air.refinement.bound_out_of_range": "Keep i32 bounds inside signed 32-bit limits and slice lengths inside 0..2147483647.",
  "air.refinement.range_invalid": "Make the lower bound less than or equal to the upper bound.",
  "air.refinement.assignment_out_of_range": "Widen the destination refinement or produce a value whose proven range fits it.",
  "air.refinement.call_argument_out_of_range": "Pass a value whose proven range fits the parameter refinement, or add a bounded fact that proves it.",
  "air.refinement.return_out_of_range": "Return a value whose proven range fits the declared return refinement.",
  "air.refinement.slice_length_out_of_range": "Use a slice with a statically proven length inside the declared refinement.",
  "air.refinement.extern_parameter_unsupported": "Keep extern parameters at their current Host ABI base types and narrow values before the call.",
  "air.refinement.extern_return_unsupported": "Keep host-produced return values unrefined, then validate or narrow them inside AIR with existing explicit operations.",
  "air.flow.label_invalid": "Use one fixed provenance label: public, internal, sensitive, or restricted.",
  "air.flow.policy_invalid": "Use exactly one 'flow policy required' declaration and a valid package provenanceFlow policy.",
  "air.flow.source_missing": "Declare the exact exported parameter or extern return source and bind schema-backed sources in package policy.",
  "air.flow.source_unresolved": "Correct the source declaration or schema binding so it resolves to one exact package boundary.",
  "air.flow.sink_missing": "Declare an explicit return, extern argument, print, or output-contract sink ceiling.",
  "air.flow.sink_unresolved": "Correct the sink declaration so it resolves to one exact return, extern argument, or output contract.",
  "air.flow.storage_label_missing": "Declare an explicit storage ceiling for every mutable global, state segment, and pool field.",
  "air.flow.forbidden": "Remove the prohibited dependency, raise the sink ceiling only through reviewed policy, or use an exact authorized declassifier.",
  "air.flow.control_forbidden": "Remove the secret-dependent effect/control path or keep the effect within an equal-or-higher sink.",
  "air.flow.declassification_unauthorized": "Add an exact matching package-policy authority for the local pure declassifier.",
  "air.flow.declassification_mismatch": "Match function, labels, purity, scalar type, and public auxiliary arguments to the authorized declassifier.",
  "air.flow.alias_unsupported": "Use a statically resolved whole aggregate or region alias; per-element and unknown alias tracking are outside this MVP.",
  "air.flow.operation_unsupported": "Use a supported bounded AIR operation or request an architecture scope revision.",
  "air.flow.analysis_budget_exceeded": "Reduce the provenance graph or request an architecture revision; evidence is never silently truncated.",
  "air.flow.package_binding_mismatch": "Make the module declaration, schema flowLabel, and package source/declassifier policy match exactly.",
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

  let match = text.match(/air\.flow\.([a-z_]+): ([^\n]+)/);
  if (match) {
    const suffix = match[1];
    return withLocation(loc, {
      legacyId: `flow-${suffix.replace(/_/g, "-")}`,
      code: `air.flow.${suffix}`,
      severity: "error",
      fields: {
        detail: match[2],
        path: loc.file
      }
    });
  }

  match = text.match(/air\.refinement\.([a-z_]+): ([^\n]+)/);
  if (match) {
    const suffix = match[1];
    return withLocation(loc, {
      legacyId: `refinement-${suffix.replace(/_/g, "-")}`,
      code: `air.refinement.${suffix}`,
      severity: "error",
      fields: {
        detail: match[2],
        path: loc.file
      }
    });
  }

  match = text.match(/air\.borrow\.([a-z_]+): ([^\n]+)/);
  if (match) {
    const suffix = match[1];
    return withLocation(loc, {
      legacyId: `borrow-${suffix.replace(/_/g, "-")}`,
      code: `air.borrow.${suffix}`,
      severity: "error",
      fields: {
        detail: match[2],
        path: loc.file
      }
    });
  }

  match = text.match(/air\.abi\.borrowed_slice_lowering_unavailable: exported function '([^']+)' parameter '([^']+)' ([^\n]+)/);
  if (match) {
    return withLocation(loc, {
      legacyId: "abi-borrowed-slice-lowering-unavailable",
      code: "air.abi.borrowed_slice_lowering_unavailable",
      severity: "error",
      fields: {
        function: match[1],
        parameter: match[2],
        detail: match[3],
        path: loc.file
      }
    });
  }

  match = text.match(/air\.call\.recursion_rejected: local function call cycle ([^\n]+)/);
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

  // QA52 P2-7: bounded CLI file reads keep their stable air.cli.file_* code.
  match = text.match(/air\.cli\.(file_[a-z_]+): ([^\n]+)/);
  if (match) {
    return withLocation(loc, {
      legacyId: `cli-${match[1].replace(/_/g, "-")}`,
      code: `air.cli.${match[1]}`,
      severity: "error",
      fields: {
        detail: match[2],
        path: loc.file
      }
    });
  }

  // typed-v0.53 P0-02: WorkBound family (RFC R3.1 §6.6). cost_undefined is an
  // implementation defect, never a language disposition (R-WB-26).
  match = text.match(/air\.workbound\.(overflow|unknown_bound|missing_summary|invalid_bound|identity_mismatch|cost_undefined): ([^\n]+)/);
  if (match) {
    return withLocation(loc, {
      legacyId: `workbound-${match[1].replace(/_/g, "-")}`,
      code: `air.workbound.${match[1]}`,
      severity: "error",
      fields: {
        detail: match[2],
        disposition: match[1] === "cost_undefined" ? "IMPLEMENTATION_DEFECT" : "STATIC_REJECT",
        path: loc.file
      }
    });
  }

  // QA52 P1-3: deterministic legacy verifier analysis limit.
  match = text.match(/air\.verifier\.analysis_limit_exceeded: ([^\n]+)/);
  if (match) {
    return withLocation(loc, {
      legacyId: "verifier-analysis-limit-exceeded",
      code: "air.verifier.analysis_limit_exceeded",
      severity: "error",
      fields: {
        detail: match[1],
        path: loc.file
      }
    });
  }

  match = text.match(/air\.memory\.region_bounds_static: ([^\n]+)/);
  if (match) {
    return withLocation(loc, {
      legacyId: "memory-region-bounds-static",
      code: "air.memory.region_bounds_static",
      severity: "error",
      fields: {
        detail: match[1],
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
