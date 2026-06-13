const { HOST_SIGNATURES } = require("./host_abi");

const BUNDLES = {
  "utility.fs": {
    capabilities: ["fs"],
    externs: ["fs.exists", "fs.read_file", "fs.write_file", "fs.read_file_async", "fs.write_file_async"]
  },
  "utility.net": {
    capabilities: ["net"],
    externs: ["net.http_get", "net.http_get_async"]
  },
  "utility.io": {
    capabilities: ["io"],
    externs: ["io.poll", "io.cancel", "io.result_len"]
  },
  "utility.time": {
    capabilities: ["time"],
    externs: ["time.now_ms", "time.monotonic_ms"]
  },
  "utility.random": {
    capabilities: ["random"],
    externs: ["random.u32", "random.f32"]
  },
  "utility.audio": {
    capabilities: ["audio"],
    externs: ["audio.beep", "audio.play_tone", "audio.set_gain"]
  },
  "math.fixed": {
    capabilities: [],
    externs: [],
    ops: ["fixed.mul_i32", "fixed.div_i32", "fixed.clamp_i32", "fixed.lerp_i32"]
  }
};

function applyUseBundles(mod) {
  mod.uses = mod.uses || [];
  mod.generatedCapabilities = new Set(mod.generatedCapabilities || []);
  const externs = mod.externs || [];
  for (const use of mod.uses) {
    if (use.kind === "source") continue;
    const bundle = BUNDLES[use.name];
    if (!bundle) continue;
    for (const capability of bundle.capabilities || []) {
      if (!mod.capabilities.has(capability)) {
        mod.capabilities.add(capability);
        mod.generatedCapabilities.add(capability);
      }
    }
    for (const name of bundle.externs || []) {
      const signature = HOST_SIGNATURES.get(name);
      if (!signature) continue;
      const existing = externs.find((ex) => ex.name === name);
      if (existing) {
        const params = existing.params.map((param) => param.type);
        if (params.join(",") === signature.params.join(",") && existing.returnType === signature.returnType) {
          existing.generated = true;
          existing.bundle = use.name;
        }
        continue;
      }
      externs.push({
        name,
        params: signature.params.map((type, idx) => ({ name: `arg${idx}`, type })),
        returnType: signature.returnType,
        external: true,
        generated: true,
        bundle: use.name,
        loc: use.loc
      });
    }
  }
  mod.externs = externs;
  return mod;
}

function validateUseBundles(mod, fail) {
  for (const use of mod.uses || []) {
    if (use.kind === "source") continue;
    const bundle = BUNDLES[use.name];
    if (!bundle) {
      fail(`unknown use bundle '${use.name}'${suggestBundle(use.name)}`, use.loc);
    }
  }
  for (const use of mod.uses || []) {
    if (use.kind === "source") continue;
    const bundle = BUNDLES[use.name];
    if (!bundle) continue;
    for (const name of bundle.externs || []) {
      const expected = HOST_SIGNATURES.get(name);
      const matches = (mod.externs || []).filter((ex) => ex.name === name);
      for (const ex of matches) {
        const params = ex.params.map((param) => param.type);
        if (params.join(",") !== expected.params.join(",") || ex.returnType !== expected.returnType) {
          fail(`extern ${name} conflicts with use ${use.name}; expected (${expected.params.join(", ")}) -> ${expected.returnType}`, ex.loc);
        }
      }
    }
  }
}

function bundleForExtern(name) {
  for (const [bundleName, bundle] of Object.entries(BUNDLES)) {
    if ((bundle.externs || []).includes(name)) return bundleName;
  }
  return null;
}

function knownBundleNames() {
  return Object.keys(BUNDLES);
}

function suggestBundle(name) {
  const suggestion = nearest(name, knownBundleNames());
  return suggestion ? `; did you mean 'use ${suggestion}'?` : "";
}

function nearest(input, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= 6 ? best : null;
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length];
}

module.exports = {
  BUNDLES,
  applyUseBundles,
  validateUseBundles,
  bundleForExtern,
  knownBundleNames
};
