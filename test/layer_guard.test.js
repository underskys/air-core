#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const root = process.env.AIR_LAYER_GUARD_ROOT_DIR
  ? path.resolve(process.env.AIR_LAYER_GUARD_ROOT_DIR)
  : path.resolve(__dirname, "..");
const stdlibDir = process.env.AIR_LAYER_GUARD_STDLIB_DIR
  ? path.resolve(process.env.AIR_LAYER_GUARD_STDLIB_DIR)
  : path.join(root, "stdlib");

const forbiddenFiles = [
  { re: /\.wgsl$/i, rule: "WGSL shader files are backend resources", target: "kits/gfx-basic/shaders for reusable shaders, examples/ for educational shaders, or demo/ for project shaders" },
  { re: /\.gltf$/i, rule: "glTF files are graphics assets", target: "kits/ for reusable assets, examples/ for showcases, or demo/ for project assets" },
  { re: /\.glb$/i, rule: "GLB files are graphics assets", target: "kits/ for reusable assets, examples/ for showcases, or demo/ for project assets" },
  { re: /\.png$/i, rule: "PNG files are raster assets", target: "kits/ for reusable assets, examples/ for showcases, or demo/ for project assets" },
  { re: /\.jpe?g$/i, rule: "JPEG files are raster assets", target: "kits/ for reusable assets, examples/ for showcases, or demo/ for project assets" },
  { re: /\.svg$/i, rule: "SVG files are vector/raster resources", target: "kits/ for reusable assets, examples/ for showcases, or demo/ for project assets" },
  { re: /\.airgfx\.json$/i, rule: ".airgfx.json files are package/resource manifests", target: "kits/ for reusable fragments, examples/ for fixtures, or demo/ for project manifests" },
  { re: /(^|\/)manifest\.fragment\.json$/i, rule: "manifest fragments are package resources", target: "kits/ for reusable fragments, examples/ for fixtures, or demo/ for project manifests" }
];

const forbiddenPathSegments = [
  { segment: "webgpu", rule: "backend-specific resource packs do not belong in stdlib", target: "hosts/ for host code or kits/gfx-basic for reusable WebGPU starter resources" },
  { segment: "webgl", rule: "backend-specific resource packs do not belong in stdlib", target: "hosts/ for host code or kits/ for reusable starter resources" },
  { segment: "metal", rule: "backend-specific resource packs do not belong in stdlib", target: "hosts/ for host code or kits/ for reusable starter resources" },
  { segment: "vulkan", rule: "backend-specific resource packs do not belong in stdlib", target: "hosts/ for host code or kits/ for reusable starter resources" },
  { segment: "direct3d", rule: "backend-specific resource packs do not belong in stdlib", target: "hosts/ for host code or kits/ for reusable starter resources" },
  { segment: "d3d", rule: "backend-specific resource packs do not belong in stdlib", target: "hosts/ for host code or kits/ for reusable starter resources" },
  { segment: "assets", rule: "asset directories do not belong in stdlib", target: "kits/ for reusable resources, examples/ for showcases, or demo/ for project assets" },
  { segment: "shaders", rule: "shader directories do not belong in stdlib", target: "kits/gfx-basic/shaders, examples/, or demo/" },
  { segment: "textures", rule: "texture directories do not belong in stdlib", target: "kits/ for reusable resources, examples/ for showcases, or demo/ for project assets" },
  { segment: "materials", rule: "material preset directories do not belong in stdlib", target: "kits/gfx-basic/materials, examples/, or demo/" }
];

const forbiddenTerms = [
  "arena",
  "lava",
  "rune",
  "demo_material",
  "project_palette",
  "named_scene_route",
  "energy_wall",
  "lamp_core"
];

const publicApiForbiddenCategories = [
  {
    name: "demo/project name",
    terms: ["airdoom", "contra", "contra-platformer", "contra_platformer", "voxel-demo", "voxel_demo"],
    rule: "demo/project names do not belong in public AIR API names",
    target: "keep demo-local, move to a project kit, or file an ABI request after generic extraction"
  },
  {
    name: "game role",
    terms: ["player", "enemy", "boss", "weapon", "pickup", "platformer"],
    rule: "game roles do not belong in public AIR API names",
    target: "keep gameplay semantics demo-local or extract a pure generic helper with neutral names"
  },
  {
    name: "host object",
    terms: [
      "dom",
      "canvas",
      "imagebitmap",
      "webaudionode",
      "webaudio",
      "webgpudevice",
      "webgpubuffer",
      "metaldevice",
      "metalbuffer",
      "vulkandevice",
      "vulkanbuffer",
      "direct3ddevice",
      "d3ddevice",
      "socket",
      "filehandle",
      "subprocesshandle",
      "platformpointer"
    ],
    rule: "host objects must not cross into AIR Core, stdlib, schemas, or public Host ABI names",
    target: "keep platform objects inside host implementation and expose only scalar, pointer/length, or manifest-backed handle values"
  },
  {
    name: "material/asset semantic",
    terms: ["demo_material", "project_material", "material_id", "materialid", "mat_jungle", "mat_doom", "mat_contra"],
    rule: "material or asset IDs must not become standard AIR semantics",
    target: "keep IDs package-local, generate handles, or route reusable conventions through manifests/kits"
  },
  {
    name: "route/level/art direction",
    terms: ["named_scene_route", "level_name", "art_direction", "project_palette", "palette_route", "lava_theme", "cave_lamp"],
    rule: "route, level, and art-direction names do not belong in public AIR API names",
    target: "keep art direction demo-local or move reusable resource conventions to a kit"
  }
];

const genericGridForbiddenTerms = [
  "voxel",
  "terrain",
  "biome",
  "route",
  "palette",
  "material",
  "material_id",
  "material id",
  "road",
  "river",
  "cave",
  "animal",
  "arena",
  "lamp",
  "tree",
  "rock",
  "water",
  "lava",
  "grass",
  "dirt",
  "stone",
  "skybox",
  "spawn",
  "doom",
  "airdoom",
  "contra",
  "platformer",
  "player",
  "enemy",
  "bullet",
  "weapon",
  "pickup",
  "score",
  "health",
  "boss",
  "npc"
];

const stdlibForbiddenTerms = [
  "voxel",
  "terrain",
  "biome",
  "cave",
  "animal",
  "route",
  "palette",
  "doom",
  "airdoom",
  "contra",
  "platformer",
  "player",
  "enemy",
  "bullet",
  "weapon",
  "pickup",
  "score",
  "health",
  "boss",
  "material_id",
  "material id",
  "project_material",
  "demo_material",
  "scene_route",
  "asset_id",
  "project_palette"
];

const hostAbiFamilies = [
  "gfx",
  "gpu",
  "ui",
  "audio",
  "net",
  "fs",
  "input",
  "debug",
  "device",
  "io",
  "time",
  "random"
];

const publicSourceFiles = [
  "src/parser.js",
  "src/verifier.js",
  "src/lower_wasm.js",
  "src/audit.js",
  "src/conformance_report.js",
  "src/explain.js",
  "src/host_abi.js",
  "src/package_manifest.js",
  "src/host_profiles.js",
  "src/asset_manifest.js",
  "spec/AIR_CORE.md",
  "spec/CAPABILITIES.md",
  "spec/GFX_ABI.md",
  "spec/GFX_HIGH_LEVEL_ABI.md",
  "spec/UI_ABI.md",
  "spec/AIR_PACKAGE_MANIFEST.md",
  "spec/HOST_PROFILES.md",
  "spec/ASSET_MANIFEST.md",
  "docs/V0_12_AI_LANGUAGE_CONTRACT.md",
  "docs/FEATURE_STATUS_v0.12.md"
];

const canonicalExampleFiles = [
  "examples/grid_math.air",
  "examples/module_constants.air",
  "examples/package_manifest/module.air",
  "examples/package_manifest/use_generated_handles.air",
  "examples/ai_generated/network_health_generated.air",
  "examples/network_dashboard/network_dashboard.air"
];

const allowedGridHelperNames = new Set([
  "cell_trunc_i32",
  "cell_origin_i32",
  "cell_center_i32",
  "clamp_coord_i32",
  "in_bounds_2d",
  "index_2d",
  "in_bounds_3d",
  "index_3d"
]);

function main() {
  runRegressionFixtures();

  const failures = [];
  for (const file of walk(stdlibDir)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    checkPath(rel, failures);
    if (isTextFile(file)) checkContent(file, rel, failures);
  }
  checkPublicSurfaces(root, failures);

  if (failures.length) {
    console.error("AIR layer guard failed: public surfaces contain resource, backend, demo/project, or host-object leakage.");
    console.error("");
    for (const failure of failures) {
      console.error(`- ${failure.file}`);
      if (failure.layer) console.error(`  layer: ${failure.layer}`);
      console.error(`  rule: ${failure.rule}`);
      if (failure.match) console.error(`  match: ${failure.match}`);
      console.error(`  suggested target: ${failure.target}`);
    }
    process.exit(1);
  }

  console.log("ok - layer guard: public surfaces contain no resource packs, demo/project public API names, or host-object handles");
}

function checkPath(rel, failures) {
  for (const item of forbiddenFiles) {
    if (item.re.test(rel)) {
      failures.push({ file: rel, rule: item.rule, target: item.target });
    }
  }
  const segments = rel.split("/");
  for (const item of forbiddenPathSegments) {
    if (segments.includes(item.segment)) {
      failures.push({ file: rel, rule: item.rule, match: item.segment, target: item.target });
    }
  }
  checkForbiddenTerms(rel, rel, failures, "path");
}

function checkContent(file, rel, failures) {
  const source = fs.readFileSync(file, "utf8");
  checkForbiddenTerms(source, rel, failures, "content");
  checkPublicIdentifiers(source, rel, failures, layerForRel(rel));
  if (rel.startsWith("stdlib/") && rel.endsWith(".air")) {
    checkStdlibAirModule(source, rel, failures);
  }
  if (rel === "stdlib/grid.air" || path.basename(file) === "grid.air") {
    checkGridStdlib(source, rel, failures);
  }
}

function checkStdlibAirModule(source, rel, failures) {
  const capabilityMatch = source.match(/\bcapabilities\s*\{([^}]*)\}/);
  if (!capabilityMatch) {
    failures.push({
      file: rel,
      layer: "stdlib",
      rule: "stdlib AIR modules must explicitly declare empty capabilities",
      match: "missing capabilities { }",
      target: "add capabilities { } or move capability-bearing behavior to host ABI, kits, examples, or demo code"
    });
  } else if (capabilityMatch[1].trim() !== "") {
    failures.push({
      file: rel,
      layer: "stdlib",
      rule: "stdlib AIR modules must be resource-free and cannot request host capabilities",
      match: `capabilities { ${capabilityMatch[1].trim()} }`,
      target: "move capability-bearing wrappers to kits/, examples/, demo/, or host implementation; stdlib must keep capabilities { }"
    });
  }

  for (const match of source.matchAll(/\bextern\s+([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    failures.push({
      file: rel,
      layer: "stdlib",
      rule: "stdlib AIR modules must not declare extern host imports",
      match: `extern ${match[1]}`,
      target: "declare host imports in application modules or kits/examples that explicitly require the capability"
    });
  }

  const hostCallPattern = new RegExp(`@(${hostAbiFamilies.map(escapeRegex).join("|")})\\.[A-Za-z_][A-Za-z0-9_]*\\s*\\(`, "g");
  for (const match of source.matchAll(hostCallPattern)) {
    failures.push({
      file: rel,
      layer: "stdlib",
      rule: "stdlib AIR modules must not call public Host ABI families",
      match: `host call ${match[0].trim()}`,
      target: "keep host behavior in host implementation, manifests, kits, examples, or demo modules"
    });
  }

  checkForbiddenTerms(
    source,
    rel,
    failures,
    "content",
    stdlibForbiddenTerms,
    "demo/project/resource vocabulary must not enter stdlib public helpers"
  );
}

function checkGridStdlib(source, rel, failures) {
  checkForbiddenTerms(source, rel, failures, "content", genericGridForbiddenTerms, "grid stdlib helpers must stay generic and not encode demo/project domains");

  if (!/\bcapabilities\s*\{\s*\}/.test(source)) {
    failures.push({
      file: rel,
      rule: "grid stdlib must be deterministic, resource-free, and backend-neutral",
      match: "capabilities must be empty",
      target: "host capabilities belong in host ABI modules, manifests, kits, examples, or demo code"
    });
  }

  const forbiddenRuntimePatterns = [
    { re: /\bextern\b/, match: "extern" },
    { re: /\balloc\b|\bload\.[a-z0-9_]+|\bstore\.[a-z0-9_]+/, match: "memory/resource operation" },
    { re: /@(gfx|gpu|ui|input|fs|net|io|audio|device|time|random|debug)\./, match: "host ABI call" },
    { re: /\b(use\s+std\.gfx|use\s+std\.voxel|use\s+std\.scene)\b/, match: "graphics/project stdlib dependency" }
  ];
  for (const item of forbiddenRuntimePatterns) {
    if (item.re.test(source)) {
      failures.push({
        file: rel,
        rule: "grid stdlib must remain deterministic, resource-free, and backend-neutral",
        match: `content: ${item.match}`,
        target: "stdlib/grid.air may contain only pure coordinate/index helpers"
      });
    }
  }

  const names = [...source.matchAll(/\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]);
  for (const name of names) {
    if (!allowedGridHelperNames.has(name)) {
      failures.push({
        file: rel,
        rule: "grid stdlib public helper names must be generic and reviewable",
        match: `func ${name}`,
        target: `allowed grid helpers: ${[...allowedGridHelperNames].sort().join(", ")}`
      });
    }
  }
}

function checkForbiddenTerms(source, rel, failures, location, terms = forbiddenTerms, rule = "demo/project art direction and named gameplay semantics do not belong in stdlib") {
  const lower = source.toLowerCase();
  for (const term of terms) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(term.toLowerCase())}([^a-z0-9]|$)`);
    if (pattern.test(lower)) {
      failures.push({
        file: rel,
        rule,
        match: `${location}: ${term}`,
        target: "demo/ for project-specific content, examples/ for educational fixtures, or kits/ only after generic extraction"
      });
    }
  }
}

function checkPublicSurfaces(rootDir, failures) {
  for (const rel of publicSourceFiles) {
    const file = path.join(rootDir, rel);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    checkPublicIdentifiers(source, rel, failures, layerForRel(rel));
  }

  for (const rel of canonicalExampleFiles) {
    const file = path.join(rootDir, rel);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    checkPublicIdentifiers(source, rel, failures, "canonical example");
  }

  const profileDir = path.join(rootDir, "data", "host_profiles");
  for (const file of walk(profileDir)) {
    if (!/\.json$/i.test(file)) continue;
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    const source = fs.readFileSync(file, "utf8");
    checkHostProfileImports(source, rel, failures);
  }
}

function checkPublicIdentifiers(source, rel, failures, layer) {
  for (const token of publicTokens(source, rel)) {
    checkPublicToken(token.value, rel, failures, layer, token.kind);
  }
}

function publicTokens(source, rel) {
  const tokens = [];
  const addMatches = (re, kind, group = 1) => {
    for (const match of source.matchAll(re)) {
      tokens.push({ value: match[group], kind });
    }
  };

  if (/\.air$/i.test(rel)) {
    addMatches(/^\s*module\s+([A-Za-z_][A-Za-z0-9_.-]*)/gm, "AIR module name");
    addMatches(/\b(?:export\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "AIR function name");
    addMatches(/\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g, "AIR struct name");
    addMatches(/\bextern\s+([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "AIR extern name");
    addMatches(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/g, "AIR constant name");
    return tokens;
  }

  if (/src\/host_abi\.js$/.test(rel)) {
    addMatches(/["']([a-z][a-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)["']\s*,\s*\{/g, "Host ABI registry import");
  }

  if (/src\/(parser|verifier|lower_wasm|audit|conformance_report|explain)\.js$/.test(rel)) {
    addMatches(/["'`]([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)["'`]/g, "Core public string");
  }

  if (/src\/(package_manifest|host_profiles|asset_manifest)\.js$/.test(rel)) {
    addMatches(/["'`]([A-Za-z_][A-Za-z0-9_.-]*)["'`]/g, "schema public string");
  }

  if (/\.md$/i.test(rel)) {
    addMatches(/^\s*extern\s+([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\(/gm, "documented extern");
    addMatches(/^\s*extern\s+[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\b([A-Za-z][A-Za-z0-9_]*(?:Handle|Device|Node|Bitmap|Canvas|Buffer|Pointer))\b[^)]*\)/gm, "documented host object type");
    addMatches(/^\s*(?:export\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm, "documented function");
    addMatches(/^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm, "documented constant");
    addMatches(/`([a-z][a-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)`/g, "documented Host ABI name");
  }

  return tokens;
}

function checkHostProfileImports(source, rel, failures) {
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    return;
  }
  const imports = data && data.supports && Array.isArray(data.supports.hostImports)
    ? data.supports.hostImports
    : [];
  for (const name of imports) {
    checkPublicToken(name, rel, failures, "host profile schema", "host profile import");
  }
}

function checkPublicToken(value, rel, failures, layer, kind) {
  const normalized = normalizeToken(value);
  for (const category of publicApiForbiddenCategories) {
    for (const term of category.terms) {
      if (tokenContainsTerm(normalized, term)) {
        failures.push({
          file: rel,
          layer,
          rule: `${category.rule} (${category.name})`,
          match: `${kind}: ${value}`,
          target: category.target
        });
        return;
      }
    }
  }
}

function normalizeToken(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function tokenContainsTerm(token, term) {
  const normalizedTerm = normalizeToken(term);
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedTerm)}([^a-z0-9]|$)`);
  if (pattern.test(token)) return true;
  const compactToken = token.replace(/[^a-z0-9]/g, "");
  const compactTerm = normalizedTerm.replace(/[^a-z0-9]/g, "");
  return compactTerm.length >= 8 && compactToken.includes(compactTerm);
}

function layerForRel(rel) {
  if (rel.startsWith("stdlib/")) return "stdlib";
  if (rel.startsWith("src/")) return "AIR Core/tooling public names";
  if (rel.startsWith("spec/")) return "spec";
  if (rel.startsWith("docs/")) return "public docs";
  if (rel.startsWith("examples/")) return "canonical example";
  if (rel.startsWith("data/host_profiles/")) return "host profile schema";
  return "public surface";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTextFile(file) {
  return /\.(air|md|txt|json|js|mjs|ts)$/i.test(file);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function runRegressionFixtures() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-layer-guard-"));
  try {
    writeFixture(tmp, "stdlib/grid.air", `module grid
capabilities { }

func platformer_player_speed(value: i32) -> i32 {
entry:
  return %value
}
`);
    writeFixture(tmp, "src/host_abi.js", `const HOST_SIGNATURES = new Map([
  ["gfx.draw_player", { params: ["i32"], returnType: "void" }],
  ["audio.play_boss_theme", { params: ["i32"], returnType: "void" }]
]);
`);
    writeFixture(tmp, "spec/AIR_CORE.md", `# Fixture

\`\`\`air
extern device.use_webgpu_device(handle: WebGPUDevice) -> void
\`\`\`
`);
    writeFixture(tmp, "docs/PUBLIC_API_HYGIENE.md", `# Fixture

Rejected example: \`gfx.draw_player\` must stay demo-local.
`);
    writeFixture(tmp, "docs/STDLIB_POLICY.md", "# Fixture\n");
    writeFixture(tmp, "spec/AIR_LAYER_MANIFEST.md", "# Fixture\n");

    const failures = [];
    for (const file of walk(path.join(tmp, "stdlib"))) {
      const rel = path.relative(tmp, file).replace(/\\/g, "/");
      checkPath(rel, failures);
      if (isTextFile(file)) checkContent(file, rel, failures);
    }
    checkPublicSurfaces(tmp, failures);

    assertFixtureFailure(failures, "stdlib/grid.air", "platformer_player_speed", "stdlib rejects platformer/player helper");
    assertFixtureFailure(failures, "src/host_abi.js", "gfx.draw_player", "Host ABI rejects draw_player");
    assertFixtureFailure(failures, "src/host_abi.js", "audio.play_boss_theme", "Host ABI rejects play_boss_theme");
    assertFixtureFailure(failures, "spec/AIR_CORE.md", "WebGPUDevice", "Core/spec rejects browser object handles");
    const hygieneFailures = failures.filter((failure) => failure.file === "docs/PUBLIC_API_HYGIENE.md");
    if (hygieneFailures.length !== 0) {
      throw new Error(`layer guard fixture failed: rejected-example docs should be allowed, got ${hygieneFailures.length} failure(s)`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function writeFixture(rootDir, rel, source) {
  const file = path.join(rootDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
}

function assertFixtureFailure(failures, file, match, label) {
  if (!failures.some((failure) => failure.file === file && String(failure.match || "").includes(match))) {
    const rendered = failures.map((failure) => `${failure.file}: ${failure.match || failure.rule}`).join("\n");
    throw new Error(`layer guard fixture failed: ${label}\n${rendered}`);
  }
}

main();
