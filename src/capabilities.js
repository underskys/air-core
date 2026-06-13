const KNOWN_CAPABILITIES = new Set([
  "debug",
  "device",
  "fs",
  "gfx",
  "gpu",
  "input",
  "io",
  "audio",
  "net",
  "output",
  "random",
  "stdio",
  "time",
  "ui"
]);

function moduleCapability(name) {
  const idx = name.indexOf(".");
  return idx === -1 ? null : name.slice(0, idx);
}

function requiredCapabilityForExtern(name) {
  return moduleCapability(name);
}

module.exports = {
  KNOWN_CAPABILITIES,
  moduleCapability,
  requiredCapabilityForExtern
};
