#!/usr/bin/env node

const assert = require("assert");
const {
  SymbolRegistry,
  buildSymbolMap,
  canonicalizeModulePath,
  mangleSymbol,
  moduleIdForPath
} = require("../src/link_symbols");

assert.strictEqual(canonicalizeModulePath("./src/../main.air"), "main.air");
assert.strictEqual(canonicalizeModulePath("generated\\assets.air"), "generated/assets.air");

assert.throws(() => canonicalizeModulePath("/tmp/main.air"), /absolute module path/);
assert.throws(() => canonicalizeModulePath("C:\\tmp\\main.air"), /absolute module path/);
assert.throws(() => canonicalizeModulePath("../main.air"), /escapes package root/);
assert.throws(() => canonicalizeModulePath("https://example.test/main.air"), /remote module path/);

const symbolA = mangleSymbol("./main.air", "function", "run");
const symbolB = mangleSymbol("main.air", "function", "run");
assert.strictEqual(symbolA, symbolB);
assert.match(symbolA, /^__air\$main\$[a-f0-9]{8}\$fn\$run\$[a-f0-9]{8}$/);

const leftHelper = mangleSymbol("left.air", "function", "helper");
const rightHelper = mangleSymbol("right.air", "function", "helper");
assert.notStrictEqual(leftHelper, rightHelper);

const unsafe = mangleSymbol("generated/asset-handles.air", "table", "sprite-id/0");
assert.match(unsafe, /^__air\$generated_asset_handles\$[a-f0-9]{8}\$table\$sprite_id_0\$[a-f0-9]{8}$/);
assert.strictEqual(moduleIdForPath("generated/assets.air"), moduleIdForPath("./generated/assets.air"));

const registry = new SymbolRegistry();
registry.add({ modulePath: "b.air", kind: "function", sourceName: "same" });
registry.add({ modulePath: "a.air", kind: "global", sourceName: "value", type: "i32" });
registry.add({ modulePath: "a.air", kind: "function", sourceName: "same" });
registry.add({ modulePath: "generated/assets.air", kind: "generatedModule", sourceName: "assets" });
const symbols = registry.list();
assert.deepStrictEqual(symbols.map((symbol) => `${symbol.module}:${symbol.kind}:${symbol.sourceName}`), [
  "a.air:function:same",
  "a.air:global:value",
  "b.air:function:same",
  "generated/assets.air:generatedModule:assets"
]);
assert(symbols.every((symbol) => symbol.module && symbol.moduleId && symbol.kind && symbol.sourceName && symbol.mangledName));
assert(symbols.some((symbol) => symbol.module === "a.air" && symbol.kind === "global" && symbol.sourceName === "value" && symbol.type === "i32"));

const built = buildSymbolMap([
  { modulePath: "z.air", kind: "function", sourceName: "run" },
  { modulePath: "z.air", kind: "function", sourceName: "run" },
  { modulePath: "y.air", kind: "packageExport", sourceName: "main" },
  { modulePath: "host/imports.air", kind: "hostImport", sourceName: "debug.metric" }
]);
assert.strictEqual(built.length, 3);
assert.deepStrictEqual(built.map((symbol) => symbol.kind), ["hostImport", "packageExport", "function"]);

console.log("ok: link symbol tests");
