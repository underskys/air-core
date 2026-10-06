"use strict";

// AIR 0.52.1 bounded maintenance (AIR-0052-1-M1-SOUNDNESS-MAINTENANCE-0001).
// Each case is a P0-00 counterexample (ledger X-SND-01..07, X-BND-01..03)
// kept as a permanent regression vector. Expected outcomes come from the
// normative rules cited per case, not from the output of this implementation.

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const air = require("../src");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const ROOT = path.resolve(__dirname, "..");
const AIRC = path.join(ROOT, "bin", "airc.js");
const REQUIRED_POLICY = { mode: "required", requiredBounds: ["borrowedMemory", "effects", "hostCalls", "loops", "memory"] };

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

function legacy(source, file = "<m1>") {
  const mod = air.parseSource(source, file, { resolveSourceImports: false });
  air.verifySource(mod);
  return mod;
}

function rejects(source, pattern) {
  assert.throws(() => legacy(source), pattern);
}

async function instantiate(mod, imports = {}) {
  const wasm = await watToWasm(lowerToWat(mod), "<m1>");
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  return instance;
}

function trapCode(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof WebAssembly.RuntimeError ? "trap" : String(error.message);
  }
}

function sha(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "air-0521-"));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [AIRC, ...args], { encoding: "utf8", timeout: 20000, ...options });
}

const PHI_HOST_CALL = `module phi_effect
capabilities { debug }
effects { debug.metric <= 1 }
extern debug.metric(id: i32, value: i32) -> void

export func run(n: i32) -> i32 {
entry:
  %zero:i32 = const.i32 0
  br loop
loop:
  %i:i32 = phi.i32 entry:%zero, body:%next
  %done:bool = i32.ge_s %i, %n
  br_if %done, exit, body
body:
  %id:i32 = const.i32 1
  @debug.metric(%id, %i)
  %one:i32 = const.i32 1
  %next:i32 = i32.add %i, %one
  br loop
exit:
  return %i
}
`;

function foldNest(depth, budget = "") {
  let source = `module nest${depth}\ncapabilities { }\n${budget}`;
  source += "func f0(acc: i32) -> i32 {\nentry:\n  %one:i32 = 1\n  %n:i32 = add %acc, %one\n  return %n\n}\n";
  for (let i = 1; i <= depth; i += 1) {
    source += `func f${i}(acc: i32) -> i32 {\nentry:\n  %r:i32 = loop.fold.i32 @f${i - 1}, %acc, 4096\n  return %r\n}\n`;
  }
  source += `export func run() -> i32 {\nentry:\n  %z:i32 = 0\n  %r:i32 = @f${depth}(%z)\n  return %r\n}\n`;
  return source;
}

// X-SND-01 — spec/AIR_CORE.md:228 "dynamic bounded loops are charged at their verifier maximum".
test("X-SND-01 phi-loop host calls are charged at loop fuel, so debug.metric <= 1 is rejected", () => {
  rejects(PHI_HOST_CALL, /effect budget 'debug\.metric <= 1' is not satisfied/);
});

test("X-SND-01 certificate host-call bound covers every phi iteration", () => {
  const mod = air.parseSource(PHI_HOST_CALL.replace("effects { debug.metric <= 1 }\n", ""), "<m1>", { resolveSourceImports: false });
  air.verifySource(mod);
  const cert = air.createVerifiedResourceCertificate(mod, { packageName: "m1", mode: "required", policy: REQUIRED_POLICY });
  assert.ok(cert.bounds.hostCalls.totalUpperBound >= air.STRUCTURED_PHI_LOOP_FUEL_LIMIT, "certified host calls must cover the phi fuel");
  assert.ok(cert.bounds.loops.totalDynamicLoopFuelUpperBound >= air.STRUCTURED_PHI_LOOP_FUEL_LIMIT);
});

test("X-SND-01 state.write budget sees every phi iteration", () => {
  rejects(`module phi_state
capabilities { }
state counter:i32[1] = fill 0
effects { state.write <= 1 }

export func run(n: i32) -> i32 {
entry:
  %zero:i32 = const.i32 0
  br loop
loop:
  %i:i32 = phi.i32 entry:%zero, body:%next
  %done:bool = i32.ge_s %i, %n
  br_if %done, exit, body
body:
  state.set counter, 0, %i
  %one:i32 = const.i32 1
  %next:i32 = i32.add %i, %one
  br loop
exit:
  return %i
}
`, /state\.write <= 1' is not satisfied/);
});

test("X-SND-01 realtime_safe does not admit a parameter-bounded phi loop", () => {
  const mod = legacy(`module realtime_phi
capabilities { }
requires export step

export func step(input: borrowed_slice<readonly,len=4..4,align=4>, output: borrowed_slice<writeonly,len=4..4,align=4>, state: borrowed_slice<readwrite,len=4..4,align=4>, delta: i32) -> i32 {
entry:
  %zero:i32 = 0
  br loop
loop:
  %i:i32 = phi.i32 entry:%zero, body:%next
  %done:bool = i32.ge_s %i, %delta
  br_if %done, exit, body
body:
  %one:i32 = 1
  %next:i32 = i32.add %i, %one
  br loop
exit:
  slice.store.i32 %state, 0, %i
  slice.store.i32 %output, 0, %i
  return %i
}
`);
  const cert = air.createVerifiedResourceCertificate(mod, { packageName: "rt", mode: "required", policy: REQUIRED_POLICY });
  const profile = { mode: "realtime_safe", entrypoint: "step", maximumFuel: 64, airAbi: "0.11", feature: "borrowed-slice-v1", stateParameters: ["state"] };
  assert.throws(() => air.assertRealtimeSafeProfile(mod, profile, cert), /air\.realtime\./);
});

// X-SND-02 — docs/VERIFIED_RESOURCE_CERTIFICATE.md: verified bounds are conservative; an inexact total is not a bound.
test("X-SND-02 exact totals stay verified (control: 4096^3)", () => {
  const cert = air.createVerifiedResourceCertificate(legacy(foldNest(3)), { packageName: "m1", mode: "required", policy: REQUIRED_POLICY });
  assert.strictEqual(cert.status, "verified");
  assert.strictEqual(cert.bounds.loops.status, "verified");
  assert.ok(Number.isSafeInteger(cert.bounds.loops.totalStaticallyBoundedIterations));
});

for (const depth of [5, 90]) {
  test(`X-SND-02 overflowing totals (4096^${depth}) are never verified`, () => {
    const cert = air.createVerifiedResourceCertificate(legacy(foldNest(depth)), { packageName: "m1", mode: "required", policy: REQUIRED_POLICY });
    assert.notStrictEqual(cert.status, "verified");
    assert.strictEqual(cert.bounds.loops.status, "unknown");
    assert.ok(cert.classifications.unknown.some((item) => item.code === "work_bound_overflow"));
    const validation = air.validateVerifiedResourceCertificate(cert, { required: true });
    assert.strictEqual(validation.ok, false);
  });
}

test("X-SND-02 a forged verified certificate with a non-exact bound is rejected", () => {
  const cert = air.createVerifiedResourceCertificate(legacy(foldNest(2)), { packageName: "m1", mode: "required", policy: REQUIRED_POLICY });
  const { certificateDigest, ...payload } = JSON.parse(air.stableCertificateStringify(cert));
  assert.ok(certificateDigest);
  payload.bounds.loops.totalStaticallyBoundedIterations = 2 ** 60;
  // Re-seal the tampered payload with the producer's domain-separated digest so
  // that only the work bound, not the self digest, is wrong.
  const resealed = {
    ...payload,
    certificateDigest: `sha256:${crypto.createHash("sha256")
      .update("AIR_VERIFIED_RESOURCE_CERTIFICATE_V1\0", "utf8")
      .update(air.stableCertificateStringify(payload), "utf8")
      .digest("hex")}`
  };
  const validation = air.validateVerifiedResourceCertificate(resealed, {});
  assert.deepStrictEqual(validation.diagnostics.map((item) => item.code), ["air.resource_certificate.bound_invalid"]);
});

test("X-SND-02 a budget is never satisfied by an overflowing total", () => {
  assert.throws(() => legacy(foldNest(5, "effects { cpu.loop_iterations <= 100 }\n")), (error) => error.code === "air.resource.work_bound_overflow");
});

// X-SND-03 — cross-module work is not composed by this certificate, so it must not be verified.
test("X-SND-03 a module calling another package module yields an incomplete certificate", () => {
  const main = air.parseSource(`module main
use "./math.air" as math
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func run(seed: i32) -> i32 {
entry:
  %a:i32 = @math.add_one(%seed)
  @debug.metric(1, %a)
  return %a
}
`, "main.air", { resolveSourceImports: false });
  const math = air.parseSource(`module math
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func add_one(value: i32) -> i32 {
entry:
  %one:i32 = 1
  %next:i32 = add %value, %one
  @debug.metric(2, %next)
  return %next
}
`, "math.air", { resolveSourceImports: false });
  const cert = air.createVerifiedResourceCertificate([{ path: "main.air", mod: main }, { path: "math.air", mod: math }], { packageName: "pkg", mode: "required", policy: REQUIRED_POLICY });
  assert.strictEqual(cert.status, "incomplete");
  assert.strictEqual(cert.bounds.hostCalls.status, "unknown");
  assert.ok(cert.classifications.unknown.some((item) => item.code === "package_call_composition_unproven"));
});

// X-SND-04 — the legacy certificate walks block IR only.
test("X-SND-04 the legacy certificate rejects a typed-v0.51 AST", () => {
  const typed = air.parseSource("module t.probe\nexport func run() -> i64 {\nreturn 1\n}\n", "t.air", { sourceProfile: "typed-v0.51" });
  air.verifySource(typed, { sourceProfile: "typed-v0.51" });
  assert.throws(() => air.createVerifiedResourceCertificate([{ path: "t.air", mod: typed }], { mode: "required" }),
    (error) => error.code === "air.resource_certificate.profile_unsupported");
});

// X-SND-05 — docs/v0.50/REGION_BOUNDS_INTEGRITY.md: an access inside a live region cannot reach another region.
test("X-SND-05 a region larger than 4096 bytes does not overlap the next region", async () => {
  const mod = legacy(`module big_region
capabilities { }
export func run() -> i32 {
entry:
  %big:i32 = 8192
  %small:i32 = 16
  %a:ptr = alloc_region %big
  %b:ptr = alloc_region %small
  %zero:i32 = 0
  %init:i32 = 11
  store.i32 %b, %zero, %init
  %off:i32 = 4096
  %v:i32 = 77
  store.i32 %a, %off, %v
  %seen:i32 = load.i32 %b, %zero
  free_region %b
  free_region %a
  return %seen
}
`);
  const instance = await instantiate(mod);
  assert.strictEqual(instance.exports.run(), 11);
});

test("X-SND-05 a dynamic region size larger than its slot traps instead of overlapping", async () => {
  const mod = legacy(`module dyn_region
capabilities { }
export func run(n: i32) -> i32 {
entry:
  %p:ptr = alloc_region %n
  %zero:i32 = 0
  %v:i32 = 5
  store.i32 %p, %zero, %v
  %x:i32 = load.i32 %p, %zero
  free_region %p
  return %x
}
`);
  const instance = await instantiate(mod);
  assert.strictEqual(instance.exports.run(16), 5);
  assert.strictEqual(trapCode(() => instance.exports.run(8192)), "trap");
});

// X-SND-06 — spec/MEMORY.md:20-21,41: views are derived from live regions within their bounds.
test("X-SND-06 buffer.from_ptr over a freed region is rejected", () => {
  rejects(`module buf_uaf
capabilities { }
export func run() -> i32 {
entry:
  %n:i32 = 16
  %a:ptr = alloc_region %n
  free_region %a
  %buf:buffer<i32,4> = buffer.from_ptr %a
  %i:i32 = 0
  %v:i32 = 5
  buffer.store %buf, %i, %v
  %x:i32 = buffer.load %buf, %i
  return %x
}
`, /not a live region/);
});

test("X-SND-06 a buffer used after free_region is rejected", () => {
  rejects(`module buf_late
capabilities { }
export func run() -> i32 {
entry:
  %n:i32 = 16
  %a:ptr = alloc_region %n
  %buf:buffer<i32,4> = buffer.from_ptr %a
  %i:i32 = 0
  %v:i32 = 5
  buffer.store %buf, %i, %v
  free_region %a
  %x:i32 = buffer.load %buf, %i
  return %x
}
`, /not a live region/);
});

test("X-SND-06 a buffer larger than its region is rejected", () => {
  rejects(`module buf_big
capabilities { }
export func run() -> i32 {
entry:
  %small:i32 = 16
  %a:ptr = alloc_region %small
  %buf:buffer<i32,2048> = buffer.from_ptr %a
  %idx:i32 = 1024
  %v:i32 = 77
  buffer.store %buf, %idx, %v
  free_region %a
  return %v
}
`, /region_bounds_static/);
});

test("X-SND-06 a buffer over a raw pointer parameter is rejected", () => {
  rejects(`module buf_param
capabilities { }
export func peek(p: ptr, idx: i32) -> i32 {
entry:
  %buf:buffer<i32,4096> = buffer.from_ptr %p
  %x:i32 = buffer.load %buf, %idx
  return %x
}
`, /not a live region/);
});

test("X-SND-06 control: an exactly sized buffer still verifies and runs", async () => {
  const mod = legacy(fs.readFileSync(path.join(ROOT, "examples", "transform_pack.air"), "utf8"));
  const instance = await instantiate(mod);
  assert.strictEqual(typeof instance.exports.run, "function");
});

test("X-SND-06 slice.from_region longer than its region is rejected or checked at runtime", async () => {
  rejects(`module slice_big
capabilities { }
export func run() -> i32 {
entry:
  %n:i32 = 16
  %p:ptr = alloc_region %n
  %len:i32 = 64
  %s:slice = slice.from_region %p, %len
  %l:i32 = slice.len %s
  free_region %p
  return %l
}
`, /region_bounds_static/);
  const mod = legacy(`module slice_dyn
capabilities { }
export func run(len: i32) -> i32 {
entry:
  %n:i32 = 16
  %p:ptr = alloc_region %n
  %s:slice = slice.from_region %p, %len
  %l:i32 = slice.len %s
  free_region %p
  return %l
}
`);
  const instance = await instantiate(mod);
  assert.strictEqual(instance.exports.run(16), 16);
  assert.strictEqual(trapCode(() => instance.exports.run(17)), "trap");
});

test("X-SND-06 a host write capacity larger than the region is rejected or checked at runtime", async () => {
  rejects(`module read_big
capabilities { fs }
extern fs.read_file(path_ptr: i32, path_len: i32, out_ptr: ptr, max_len: i32) -> i32
export func run() -> i32 {
entry:
  %path_ptr:i32 = 0
  %path_len:i32 = 0
  %n:i32 = 16
  %buf:ptr = alloc_region %n
  %cap:i32 = 4096
  %read:i32 = @fs.read_file(%path_ptr, %path_len, %buf, %cap)
  free_region %buf
  return %read
}
`, /region_bounds_static/);
  const mod = legacy(`module read_dyn
capabilities { fs }
extern fs.read_file(path_ptr: i32, path_len: i32, out_ptr: ptr, max_len: i32) -> i32
export func run(cap: i32) -> i32 {
entry:
  %path_ptr:i32 = 0
  %path_len:i32 = 0
  %n:i32 = 16
  %buf:ptr = alloc_region %n
  %read:i32 = @fs.read_file(%path_ptr, %path_len, %buf, %cap)
  free_region %buf
  return %read
}
`);
  let writes = 0;
  const instance = await instantiate(mod, { fs: { read_file: () => { writes += 1; return 0; } } });
  assert.strictEqual(instance.exports.run(16), 0);
  assert.strictEqual(trapCode(() => instance.exports.run(17)), "trap");
  assert.strictEqual(writes, 1, "the host import must not be reached with an oversized capacity");
});

// X-SND-07 — docs/v0.50/BORROWED_SLICES_THREAT_MODEL.md:16-18: AIR-owned memory is an asset.
test("X-SND-07 a Wasm-view binding over AIR-owned memory is rejected by the SDK", async () => {
  const source = `module borrow_region_alias
capabilities { }
requires export f
export func f(src: borrowed_slice<readonly,len=4..4,align=4>) -> i32 {
entry:
  %n:i32 = 16
  %p:ptr = alloc_region %n
  %z:i32 = 0
  %v:i32 = 777
  store.i32 %p, %z, %v
  %seen:i32 = slice.load.i32 %src, %z
  free_region %p
  return %seen
}
`;
  const mod = legacy(source);
  const wasm = await watToWasm(lowerToWat(mod), "<alias>");
  const packageDigest = sha(Buffer.from("m1-alias"));
  const instance = await air.instantiateAirModule({ wasmBytes: wasm, packageDigest });
  assert.ok(instance.exports.__air_owned_memory_end instanceof WebAssembly.Global);
  const memory = instance.exports.memory;
  const invoke = (offset) => air.invokeBorrowedMemory({
    instance,
    interfaceDescriptor: air.borrowedSliceInterfaceDescriptor(mod),
    moduleDigest: sha(wasm),
    packageDigest,
    entrypoint: "f",
    bindings: {
      src: {
        buffer: new Uint8Array(memory.buffer, offset, 4),
        access: "readonly",
        maxLength: 4,
        alignment: 4,
        aliasGroup: "in",
        memoryDomain: "wasm-linear",
        transferMode: "wasm_memory_view"
      }
    },
    arguments: {}
  });
  new DataView(memory.buffer).setInt32(1024, 5, true);
  const aliased = invoke(1024);
  assert.deepStrictEqual(aliased.diagnostics.map((item) => item.code), ["air.borrow.air_owned_memory_overlap"]);
  assert.strictEqual(new DataView(memory.buffer).getInt32(1024, true), 5, "host readonly memory must stay unchanged");
  new DataView(memory.buffer).setInt32(0, 9, true);
  const below = invoke(0);
  assert.strictEqual(below.result, 9);
  assert.deepStrictEqual(below.diagnostics, []);
});

// X-BND-01 — CHANGELOG 0.52.0 "bounded compilation" must hold on every typed build path.
test("X-BND-01 CLI typed build applies the verified typed build WAT cap", () => {
  const dir = tempDir();
  const cases = Array.from({ length: 1000 }, (_, i) => `case${i} = ${i},`).join("\n");
  const params = Array.from({ length: 1000 }, (_, i) => `p${i}: E`).join(", ");
  const file = path.join(dir, "wide.air");
  fs.writeFileSync(file, `module work.pressure\nenum E {\n${cases}\n}\nfunc hidden(${params}) -> i32 {\nreturn 0\n}\nexport func run() -> i32 {\nreturn 1\n}\n`);
  const out = path.join(dir, "wide.wat");
  const result = runCli(["build", file, "--source-profile", "typed-v0.51", "--emit", "wat", "-o", out]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /^air\.v052\.work_limit_wat_bytes:/);
  assert.doesNotMatch(result.stderr, /\n\s+at /, "no JavaScript stack");
  assert.strictEqual(fs.existsSync(out), false);
});

// X-BND-02 — verifier work must stay bounded for a deep call DAG (no exponential re-walk).
test("X-BND-02 a depth-24 call DAG verifies quickly with exact work counts", () => {
  let source = "module dag\ncapabilities { }\nfunc d0(x: i32) -> i32 {\nentry:\n  return %x\n}\n";
  for (let i = 1; i <= 24; i += 1) {
    source += `func d${i}(x: i32) -> i32 {\nentry:\n  %a:i32 = @d${i - 1}(%x)\n  %b:i32 = @d${i - 1}(%a)\n  return %b\n}\n`;
  }
  source += "export func run(x: i32) -> i32 {\nentry:\n  %r:i32 = @d24(%x)\n  return %r\n}\n";
  const started = process.hrtime.bigint();
  const mod = legacy(source);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 3000, `verification took ${elapsedMs} ms`);
  const usage = air.collectEffectUsage(mod);
  assert.strictEqual(usage.get("call.d0"), 2 ** 24);
});

// X-BND-03 — CHANGELOG 0.52.0 Security: CLI file inputs are bounded regular files.
test("X-BND-03 check, semantic-patch and evidence JSON inputs reject non-regular files", () => {
  const dir = tempDir();
  const invalid = [];
  if (process.platform !== "win32") {
    const fifo = path.join(dir, "input.fifo");
    const made = spawnSync("mkfifo", [fifo]);
    if (made.status === 0) invalid.push(fifo);
    if (fs.existsSync("/dev/zero")) invalid.push("/dev/zero");
  }
  invalid.push(dir);
  const pkg = path.join(ROOT, "test", "fixtures", "package_graph", "valid");
  for (const target of invalid) {
    const check = runCli(["check", target.endsWith(".fifo") || target === "/dev/zero" ? target : path.join(target, "missing.air"), "--lsp-json"]);
    assert.notStrictEqual(check.error && check.error.code, "ETIMEDOUT", `check must not hang on ${target}`);
    assert.strictEqual(check.status, 1, `check ${target}`);
    if (target.endsWith(".fifo") || target === "/dev/zero") {
      const patch = runCli(["semantic-patch", "inspect", target, "--json"]);
      assert.notStrictEqual(patch.error && patch.error.code, "ETIMEDOUT");
      assert.match(patch.stderr, /air\.cli\.file_invalid/);
      if (fs.existsSync(pkg)) {
        const evidence = runCli(["evidence", "report", pkg, "--format", "markdown", "--host-evidence", target, "-o", path.join(dir, "r.md")]);
        assert.notStrictEqual(evidence.error && evidence.error.code, "ETIMEDOUT");
        assert.match(evidence.stderr, /air\.cli\.file_invalid/);
      }
    }
  }
  const big = path.join(dir, "big.air");
  fs.writeFileSync(big, "x".repeat(4 * 1024 * 1024 + 1));
  const oversize = runCli(["check", big, "--lsp-json"]);
  assert.strictEqual(oversize.status, 1);
  assert.match(oversize.stdout + oversize.stderr, /air\.cli\.file_too_large/);
});

(async () => {
  let failed = 0;
  for (const item of cases) {
    try {
      await item.fn();
      process.stdout.write(`ok - ${item.name}\n`);
    } catch (error) {
      failed += 1;
      process.stdout.write(`not ok - ${item.name}\n${error && error.stack ? error.stack : error}\n`);
    }
  }
  process.stdout.write(`v0.52.1 maintenance vectors: ${cases.length - failed}/${cases.length} passed\n`);
  if (failed) process.exitCode = 1;
})();
