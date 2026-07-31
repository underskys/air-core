#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("../src/parser");
const { verifyModule } = require("../src/verifier");
const { formatModule } = require("../src/format");
const { lowerToWat } = require("../src/lower_wasm");
const { diagnosticHintsFromMessage, normalizeDiagnostic } = require("../src/diagnostics");

function parse(source) {
  return parseAir(source.trim(), "<refinement-test>", { resolveSourceImports: false });
}

function verify(source) {
  const mod = parse(source);
  verifyModule(mod, { library: true });
  return mod;
}

function expectReject(source, code) {
  let error;
  try {
    verify(source);
  } catch (caught) {
    error = caught;
  }
  assert(error, `expected rejection with ${code}`);
  assert(
    error.message.includes(code),
    `expected ${code}, got: ${error.message}`
  );
  const hint = diagnosticHintsFromMessage(error.message);
  assert(hint, `expected structured diagnostic for ${error.message}`);
  const diagnostic = normalizeDiagnostic(hint);
  assert.strictEqual(diagnostic.code, code);
  assert.strictEqual(diagnostic.severity, "fail");
  return error;
}

const canonical = verify(`
module canonical_refinements
capabilities { }

func bounded(value: i32< 0 .. 10 >, bytes: slice<nonempty>) -> slice<len=1..2147483647> {
entry:
  return %bytes
}
`);
const canonicalText = formatModule(canonical);
assert(canonicalText.includes("value: i32<0..10>"));
assert(canonicalText.includes("bytes: slice<len=1..2147483647>"));
assert(canonicalText.includes("-> slice<len=1..2147483647>"));
verifyModule(parse(canonicalText), { library: true });
assert.strictEqual(formatModule(parse(canonicalText)), canonicalText);

verify(`
module inclusive_boundaries
capabilities { }

func accept(value: i32<0..10>) -> i32<0..10> {
entry:
  return %value
}

func caller() -> i32<0..10> {
entry:
  %lo:i32<0..10> = const.i32 0
  %hi:i32<0..10> = const.i32 10
  %accepted_lo:i32<0..10> = call @accept(%lo)
  %accepted_hi:i32<0..10> = call @accept(%hi)
  return %accepted_hi
}
`);

expectReject(`
module below_minimum
capabilities { }
func accept(value: i32<0..10>) -> i32 {
entry:
  return %value
}
func caller() -> i32 {
entry:
  %bad:i32 = const.i32 -1
  %result:i32 = call @accept(%bad)
  return %result
}
`, "air.refinement.call_argument_out_of_range");

expectReject(`
module above_maximum
capabilities { }
func accept(value: i32<0..10>) -> i32 {
entry:
  return %value
}
func caller() -> i32 {
entry:
  %bad:i32 = const.i32 11
  %result:i32 = call @accept(%bad)
  return %result
}
`, "air.refinement.call_argument_out_of_range");

expectReject(`
module impossible_i32
capabilities { }
func bad(value: i32<10..0>) -> i32 {
entry:
  return %value
}
`, "air.refinement.range_invalid");

expectReject(`
module impossible_slice
capabilities { }
func bad(value: slice<len=8..2>) -> slice {
entry:
  return %value
}
`, "air.refinement.range_invalid");

expectReject(`
module malformed_i32
capabilities { }
func bad(value: i32<0...10>) -> i32 {
entry:
  return %value
}
`, "air.refinement.syntax_invalid");

expectReject(`
module malformed_slice
capabilities { }
func bad(value: slice<len<10>) -> slice {
entry:
  return %value
}
`, "air.refinement.syntax_invalid");

expectReject(`
module overflow_bound
capabilities { }
func bad(value: i32<-2147483649..0>) -> i32 {
entry:
  return %value
}
`, "air.refinement.bound_out_of_range");

expectReject(`
module extern_return
capabilities { random }
extern random.u32() -> i32<0..2147483647>
export func run() -> i32 {
entry:
  %value:i32 = call @random.u32()
  return %value
}
`, "air.refinement.extern_return_unsupported");

expectReject(`
module extern_parameter
capabilities { debug }
extern debug.metric(id: i32<0..10>, value: i32) -> void
export func run() -> i32 {
entry:
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.refinement.extern_parameter_unsupported");

verify(`
module slice_bounds
capabilities { }

func consume(value: slice<len=1..3>) -> slice<len=1..3> {
entry:
  return %value
}

func length(value: slice<len=1..3>) -> i32<1..3> {
entry:
  %len:i32<1..3> = slice.len %value
  return %len
}

func caller() -> slice<len=1..3> {
entry:
  %bytes:slice<len=1..3> = "abc"
  %result:slice<len=1..3> = call @consume(%bytes)
  %len:i32<1..3> = call @length(%result)
  return %result
}
`);

expectReject(`
module empty_slice
capabilities { }
func caller() -> slice {
entry:
  %empty:slice<nonempty> = ""
  return %empty
}
`, "air.refinement.slice_length_out_of_range");

expectReject(`
module long_slice
capabilities { }
func caller() -> slice {
entry:
  %long:slice<len<=3> = "abcd"
  return %long
}
`, "air.refinement.slice_length_out_of_range");

verify(`
module narrowing_widening
capabilities { }
func caller() -> i32 {
entry:
  %narrow:i32<0..10> = const.i32 5
  %wide:i32 = i32.add %narrow, 1
  return %wide
}
`);

verify(`
module overflow_exact_wrap
capabilities { }
func caller() -> i32<-2147483648..-2147483648> {
entry:
  %max:i32<2147483647..2147483647> = const.i32 2147483647
  %one:i32<1..1> = const.i32 1
  %wrapped:i32<-2147483648..-2147483648> = i32.add %max, %one
  return %wrapped
}
`);

expectReject(`
module overflow_dynamic_range
capabilities { }
func add_one(value: i32<2147483646..2147483647>) -> i32 {
entry:
  %one:i32 = const.i32 1
  %unsafe:i32<0..2147483647> = i32.add %value, %one
  return %unsafe
}
`, "air.refinement.assignment_out_of_range");

expectReject(`
module narrowing_unproven
capabilities { }
func caller(value: i32) -> i32 {
entry:
  %narrow:i32<0..10> = i32.add %value, 0
  return %narrow
}
`, "air.refinement.assignment_out_of_range");

expectReject(`
module return_out_of_range
capabilities { }
func bad() -> i32<0..10> {
entry:
  %value:i32 = const.i32 11
  return %value
}
`, "air.refinement.return_out_of_range");

verify(`
module contract_propagation
capabilities { }

func produced() -> i32 {
  ensures return >= 0
  ensures return <= 10
entry:
  %value:i32 = const.i32 5
  return %value
}

func consume(value: i32<0..10>) -> i32<0..10> {
  requires param value >= 0
  requires param value <= 10
entry:
  return %value
}

func caller() -> i32<0..10> {
entry:
  %from_contract:i32<0..10> = call @produced()
  %result:i32<0..10> = call @consume(%from_contract)
  return %result
}
`);

expectReject(`
module contract_refinement_conflict
capabilities { }
func bad(value: i32<0..10>) -> i32 {
  requires param value >= 20
entry:
  return %value
}
`, "air.refinement.range_invalid");

verify(`
module unrefined_compatibility
capabilities { }
func add_one(value: i32) -> i32 {
entry:
  %one:i32 = const.i32 1
  %next:i32 = i32.add %value, %one
  return %next
}
`);

const refinedErasure = verify(`
module erasure
capabilities { }
export func identity(value: i32<0..10>) -> i32<0..10> {
entry:
  return %value
}
`);
const plainErasure = verify(`
module erasure
capabilities { }
export func identity(value: i32) -> i32 {
entry:
  return %value
}
`);
assert.strictEqual(
  lowerToWat(refinedErasure),
  lowerToWat(plainErasure),
  "refinement metadata must erase before lowering"
);

const examplesDir = path.join(__dirname, "..", "examples", "refinement_types");
for (const name of fs.readdirSync(examplesDir).sort()) {
  if (!name.endsWith(".air")) continue;
  const source = fs.readFileSync(path.join(examplesDir, name), "utf8");
  const mod = parseAir(source, path.join("examples/refinement_types", name), { resolveSourceImports: false });
  if (name === "non_empty_slice.air") {
    assert.throws(
      () => verifyModule(mod),
      /air\.abi\.borrowed_slice_lowering_unavailable: exported function 'keep_non_empty' parameter 'data'/
    );
    continue;
  }
  verifyModule(mod);
  verifyModule(parseAir(formatModule(mod), `<formatted:${name}>`, { resolveSourceImports: false }));
  lowerToWat(mod);
}

console.log("Refinement type MVP tests passed");
