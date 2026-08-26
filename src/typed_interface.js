"use strict";

// AIR ABI 0.12 is deliberately kept outside the release ABI allowlist. This
// module is the single candidate-only schema authority for its interface and
// semantic manifest records.
const fs = require("fs");
const path = require("path");
const { isExistingHostAbiLane } = require("./host_abi");
const { listHostProfileIds } = require("./host_profiles");

const ABI_012 = "0.12";
const TYPED_INTERFACE_SCHEMA = "air.typed-interface/0.12-candidate.1";
const HOST_CONTRACT_VERSION = "air.host-contract/1.0.0-candidate.1";
const MODULE_ID = /^[a-z][a-z0-9._-]{0,127}$/;
const TYPE_NAME = /^[A-Z][A-Za-z0-9_]{0,127}$/;
const EXPORT_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const CASE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PRIMITIVES = new Set(["i32", "i64", "f32", "f64", "bool"]);
const CANDIDATE_MANIFEST_KEYS = new Set([
  "name", "version", "airAbi", "hostAbi", "entry", "wasm", "capabilities",
  "targetProfiles", "generatedModules", "factSchemas", "structuredIO",
  "outputContracts", "commandBuffers", "packageExports", "aiReview",
  "reviewPolicy", "resourceCertificate", "provenanceFlow", "executionProfile",
  "manifests", "typedInterface"
]);

class TypedInterfaceError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "TypedInterfaceError";
    this.code = code;
  }
}

function fail(code, message) { throw new TypedInterfaceError(code, message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("air.v051.typed_interface_invalid", `${label} must be an object`);
  return value;
}
function exactKeys(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("air.v051.typed_interface_invalid", `${label} has missing or unknown fields`);
  }
}
function ascii(value, label) {
  if (typeof value !== "string" || /[^\x00-\x7f]/.test(value)) fail("air.v051.typed_interface_invalid", `${label} must be ASCII`);
  return value;
}
function requireMatch(value, expression, label) {
  ascii(value, label);
  if (!expression.test(value)) fail("air.v051.typed_interface_invalid", `${label} is invalid`);
  return value;
}
function compareAscii(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

function splitTopLevel(text) {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "<") depth += 1;
    else if (text[index] === ">") depth -= 1;
    else if (text[index] === "," && depth === 0) {
      items.push(text.slice(start, index));
      start = index + 1;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  items.push(text.slice(start));
  return items;
}

function parseTypeReference(value, { allowVoid = false } = {}) {
  if (typeof value !== "string" || value !== value.trim() || !value) fail("air.v051.type_reference_invalid", "type reference must be canonical text");
  if (allowVoid && value === "void") return { kind: "void", canonical: "void" };
  if (PRIMITIVES.has(value)) return { kind: "primitive", canonical: value };
  const enumMatch = value.match(/^([a-z][a-z0-9._-]{0,127})::([A-Z][A-Za-z0-9_]{0,127})$/);
  if (enumMatch) return { kind: "enum", canonical: value, moduleId: enumMatch[1], typeName: enumMatch[2] };
  const option = value.match(/^option<(.+)>$/);
  if (option) {
    const payload = parseTypeReference(option[1]);
    if (payload.kind !== "primitive" && payload.kind !== "enum") fail("air.decision.payload_type_unsupported", `option payload '${option[1]}' is unsupported`);
    return { kind: "option", canonical: `option<${payload.canonical}>`, payload };
  }
  const result = value.match(/^result<(.+)>$/);
  if (result) {
    const parts = splitTopLevel(result[1]);
    if (!parts || parts.length !== 2 || parts.some((item) => !item)) fail("air.v051.type_reference_invalid", "result type must have exactly two canonical parameters");
    const payload = parseTypeReference(parts[0]);
    const error = parseTypeReference(parts[1]);
    if ((payload.kind !== "primitive" && payload.kind !== "enum") || error.kind !== "enum") {
      fail("air.decision.payload_type_unsupported", `result type '${value}' is unsupported`);
    }
    return { kind: "result", canonical: `result<${payload.canonical},${error.canonical}>`, payload, error };
  }
  fail("air.v051.type_reference_invalid", `type reference '${value}' is not admitted by AIR ABI 0.12 candidate`);
}

function collectReferencedEnums(type, into) {
  if (type.kind === "enum") into.add(type.canonical);
  if (type.kind === "option") collectReferencedEnums(type.payload, into);
  if (type.kind === "result") {
    collectReferencedEnums(type.payload, into);
    collectReferencedEnums(type.error, into);
  }
}

function normalizeTypeDeclaration(value, moduleId, label) {
  exactKeys(value, ["cases", "kind", "type_id"], label);
  if (value.kind !== "enum" && value.kind !== "error_enum") fail("air.v051.typed_interface_invalid", `${label}.kind must be enum or error_enum`);
  const expectedPrefix = `${moduleId}::`;
  if (typeof value.type_id !== "string" || !value.type_id.startsWith(expectedPrefix)) fail("air.v051.typed_interface_invalid", `${label}.type_id must be qualified in descriptor module`);
  const typeName = value.type_id.slice(expectedPrefix.length);
  requireMatch(typeName, TYPE_NAME, `${label}.type_id`);
  if (!Array.isArray(value.cases) || !value.cases.length) fail("air.v051.typed_interface_invalid", `${label}.cases must be a non-empty array`);
  const names = new Set();
  const discriminants = new Set();
  const cases = value.cases.map((item, index) => {
    exactKeys(item, ["discriminant", "name"], `${label}.cases[${index}]`);
    requireMatch(item.name, CASE_NAME, `${label}.cases[${index}].name`);
    if (!Number.isInteger(item.discriminant) || item.discriminant < 0 || item.discriminant > 2147483647) fail("air.v051.typed_interface_invalid", `${label}.cases[${index}].discriminant is invalid`);
    if (names.has(item.name) || discriminants.has(item.discriminant)) fail("air.v051.typed_interface_duplicate", `${label} has duplicate enum case identity`);
    names.add(item.name); discriminants.add(item.discriminant);
    return { discriminant: item.discriminant, name: item.name };
  }).sort((left, right) => left.discriminant - right.discriminant || compareAscii(left.name, right.name));
  return { cases, kind: value.kind, type_id: value.type_id };
}

function normalizeExport(value, label) {
  exactKeys(value, ["function", "name", "parameters", "return_type"], label);
  requireMatch(value.name, EXPORT_NAME, `${label}.name`);
  requireMatch(value.function, FUNCTION_NAME, `${label}.function`);
  if (!Array.isArray(value.parameters)) fail("air.v051.typed_interface_invalid", `${label}.parameters must be an array`);
  const parameterNames = new Set();
  const parameters = value.parameters.map((item, index) => {
    exactKeys(item, ["name", "type"], `${label}.parameters[${index}]`);
    requireMatch(item.name, PARAMETER_NAME, `${label}.parameters[${index}].name`);
    if (parameterNames.has(item.name)) fail("air.v051.typed_interface_duplicate", `${label} has duplicate parameter name '${item.name}'`);
    parameterNames.add(item.name);
    const type = parseTypeReference(item.type);
    return { name: item.name, type: type.canonical };
  });
  return { function: value.function, name: value.name, parameters, return_type: parseTypeReference(value.return_type, { allowVoid: true }).canonical };
}

function validateEnumReferences(exportsList, types) {
  const referenced = new Set();
  for (const item of exportsList) {
    for (const parameter of item.parameters) collectReferencedEnums(parseTypeReference(parameter.type), referenced);
    const returned = parseTypeReference(item.return_type, { allowVoid: true });
    if (returned.kind !== "void") collectReferencedEnums(returned, referenced);
  }
  const declared = new Map(types.map((item) => [item.type_id, item]));
  for (const typeId of referenced) {
    const declaration = declared.get(typeId);
    if (!declaration) fail("air.v051.typed_interface_invalid", `referenced enum '${typeId}' has no declaration`);
    const type = parseTypeReference(typeId);
    if (type.kind !== "enum") fail("air.v051.typed_interface_invalid", `invalid enum reference '${typeId}'`);
  }
  for (const type of types) {
    if (!referenced.has(type.type_id)) fail("air.v051.typed_interface_invalid", `unreachable type declaration '${type.type_id}'`);
  }
  for (const item of exportsList) {
    for (const type of [...item.parameters.map((parameter) => parseTypeReference(parameter.type)), parseTypeReference(item.return_type, { allowVoid: true })]) {
      if (type.kind === "result") {
        const error = declared.get(type.error.canonical);
        if (!error || error.kind !== "error_enum") fail("air.v051.typed_interface_invalid", `result error '${type.error.canonical}' must be declared error_enum`);
      }
    }
  }
}

function normalizeTypedInterfaceDescriptor(value) {
  exactKeys(value, ["air_abi_lane", "exports", "module_id", "schema", "types"], "TypedInterfaceDescriptorV1");
  if (value.air_abi_lane !== ABI_012 || value.schema !== TYPED_INTERFACE_SCHEMA) fail("air.v051.typed_interface_invalid", "descriptor schema or ABI lane is invalid");
  requireMatch(value.module_id, MODULE_ID, "TypedInterfaceDescriptorV1.module_id");
  if (!Array.isArray(value.exports) || !value.exports.length) fail("air.v051.typed_interface_invalid", "descriptor.exports must be non-empty array");
  if (!Array.isArray(value.types)) fail("air.v051.typed_interface_invalid", "descriptor.types must be an array");
  const names = new Set(); const functions = new Set();
  const exportsList = value.exports.map((item, index) => {
    const normalized = normalizeExport(item, `exports[${index}]`);
    if (names.has(normalized.name) || functions.has(normalized.function)) fail("air.v051.typed_interface_duplicate", "descriptor export names and functions must be unique");
    names.add(normalized.name); functions.add(normalized.function);
    return normalized;
  }).sort((left, right) => compareAscii(left.name, right.name));
  const typeIds = new Set();
  const types = value.types.map((item, index) => {
    const normalized = normalizeTypeDeclaration(item, value.module_id, `types[${index}]`);
    if (typeIds.has(normalized.type_id)) fail("air.v051.typed_interface_duplicate", `duplicate type '${normalized.type_id}'`);
    typeIds.add(normalized.type_id);
    return normalized;
  }).sort((left, right) => compareAscii(left.type_id, right.type_id));
  validateEnumReferences(exportsList, types);
  return { air_abi_lane: ABI_012, exports: exportsList, module_id: value.module_id, schema: TYPED_INTERFACE_SCHEMA, types };
}

function canonicalDescriptor(value) { return canonicalJson(normalizeTypedInterfaceDescriptor(value)); }
function descriptorDigest(value) { return rawDigest(normalizeTypedInterfaceDescriptor(value)); }

function normalizeSemanticManifest(value) {
  exactKeys(value, ["air_abi_lane", "capabilities", "entry_export", "host_abi_lane", "host_contract_version", "interface_descriptor_digest", "name", "target_profiles", "version"], "TypedPackageManifestV1");
  if (value.air_abi_lane !== ABI_012) fail("air.v051.typed_manifest_invalid", "semantic manifest must use AIR ABI 0.12 candidate");
  requireMatch(value.name, MODULE_ID, "TypedPackageManifestV1.name");
  if (typeof value.version !== "string" || !value.version) fail("air.v051.typed_manifest_invalid", "TypedPackageManifestV1.version is required");
  if (!isExistingHostAbiLane(value.host_abi_lane)) fail("air.v051.typed_manifest_invalid", "TypedPackageManifestV1.host_abi_lane must be existing host ABI");
  if (value.host_contract_version !== HOST_CONTRACT_VERSION) fail("air.v051.typed_manifest_invalid", "TypedPackageManifestV1.host_contract_version is invalid");
  requireDigest(value.interface_descriptor_digest, "TypedPackageManifestV1.interface_descriptor_digest");
  requireMatch(value.entry_export, EXPORT_NAME, "TypedPackageManifestV1.entry_export");
  const capabilities = sortedAscii(value.capabilities, "TypedPackageManifestV1.capabilities", (item) => requireMatch(item, /^[a-z][a-z0-9_.-]{0,95}$/, "capability"));
  const knownProfiles = new Set(listHostProfileIds());
  const target_profiles = sortedAscii(value.target_profiles, "TypedPackageManifestV1.target_profiles", (item) => {
    requireMatch(item, /^[a-z][a-z0-9_.-]{0,95}$/, "target profile");
    if (!knownProfiles.has(item)) fail("air.v051.typed_manifest_invalid", `unknown target profile '${item}'`);
    return item;
  });
  return { air_abi_lane: ABI_012, capabilities, entry_export: value.entry_export, host_abi_lane: value.host_abi_lane, host_contract_version: HOST_CONTRACT_VERSION, interface_descriptor_digest: value.interface_descriptor_digest, name: value.name, target_profiles, version: value.version };
}

function semanticManifestDigest(value) { return rawDigest(normalizeSemanticManifest(value)); }
function requireDigest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) fail("air.v051.typed_interface_invalid", `${label} must be a sha256 digest`);
  return value;
}
function sortedAscii(value, label, validate) {
  if (!Array.isArray(value)) fail("air.v051.typed_manifest_invalid", `${label} must be an array`);
  const values = value.map((item, index) => validate(item, `${label}[${index}]`));
  if (new Set(values).size !== values.length) fail("air.v051.typed_interface_duplicate", `${label} has duplicate keys`);
  return values.sort(compareAscii);
}

function validateDescriptorAgainstSource(descriptorInput, sourceModule) {
  const descriptor = normalizeTypedInterfaceDescriptor(descriptorInput);
  if (!sourceModule || !sourceModule.v051TypedAst) fail("air.v051.typed_interface_source_invalid", "descriptor requires parsed and verified v0.51 typed source");
  if (sourceModule.name !== descriptor.module_id) fail("air.v051.typed_interface_source_invalid", "descriptor module_id does not match source module");
  const functions = new Map((sourceModule.functions || []).map((item) => [item.name, item]));
  const sourceTypes = new Map((sourceModule.enums || []).map((item) => [item.type_id, item]));
  for (const entry of descriptor.exports) {
    const fn = functions.get(entry.function);
    if (!fn || !fn.exported) fail("air.v051.typed_interface_source_invalid", `export '${entry.name}' does not bind an exported source function`);
    if (fn.params.length !== entry.parameters.length) fail("air.v051.typed_interface_source_invalid", `export '${entry.name}' parameter count mismatches source`);
    for (let index = 0; index < entry.parameters.length; index += 1) {
      const actual = fn.params[index]; const expected = entry.parameters[index];
      if (actual.name !== expected.name || actual.type !== expected.type) fail("air.v051.typed_interface_source_invalid", `export '${entry.name}' parameter ${index} mismatches source`);
    }
    if (fn.returnType !== entry.return_type) fail("air.v051.typed_interface_source_invalid", `export '${entry.name}' return type mismatches source`);
  }
  for (const declaration of descriptor.types) {
    const source = sourceTypes.get(declaration.type_id);
    if (!source || canonicalJson(source) !== canonicalJson(declaration)) fail("air.v051.typed_interface_source_invalid", `type '${declaration.type_id}' mismatches source declaration`);
  }
  return descriptor;
}

function validateCandidateManifestObject(manifest, options = {}) {
  object(manifest, "package manifest");
  const lane = manifest.airAbi || manifest.air_abi_lane;
  if (lane === "0.10" || lane === "0.11") {
    if (manifest.typedInterface !== undefined || manifest.typed_interface !== undefined) fail("air.v051.typed_manifest_invalid", "typedInterface is forbidden on legacy AIR ABI lanes");
    return { accepted: true, legacy: true, candidate: false, airAbi: lane };
  }
  if (lane !== ABI_012) return { accepted: false, code: "air.v051.abi_unsupported", message: "unsupported AIR ABI lane" };
  if (!options.allowCandidateAbi012) return { accepted: false, code: "air.v051.abi_candidate_disabled", message: "AIR ABI 0.12 is candidate-only and disabled" };
  const descriptor = manifest.typedInterface || manifest.typed_interface;
  if (!descriptor) return { accepted: false, code: "air.v051.abi_descriptor_missing", message: "AIR ABI 0.12 requires typed interface descriptor" };
  const normalized = normalizeTypedInterfaceDescriptor(descriptor);
  if (manifest.name && manifest.name !== normalized.module_id) fail("air.v051.typed_manifest_invalid", "descriptor module_id must equal package name");
  if (options.sourceModule) validateDescriptorAgainstSource(normalized, options.sourceModule);
  return { accepted: true, candidate: true, legacy: false, airAbi: ABI_012, descriptor: normalized, descriptorDigest: descriptorDigest(normalized) };
}

function validateTypedPackageBinding(manifest, packageDir, options = {}) {
  if (!options.allowCandidateAbi012) fail("air.v051.abi_candidate_disabled", "AIR ABI 0.12 candidate validation is disabled");
  object(manifest, "air.package.json");
  for (const key of Object.keys(manifest)) if (!CANDIDATE_MANIFEST_KEYS.has(key)) fail("air.v051.typed_manifest_invalid", `unknown AIR ABI 0.12 manifest field '${key}'`);
  if (manifest.airAbi !== ABI_012) fail("air.v051.typed_manifest_invalid", "typed package binding requires airAbi 0.12");
  if (manifest.typedInterface === undefined) fail("air.v051.abi_descriptor_missing", "AIR ABI 0.12 requires typedInterface");
  exactKeys(manifest.typedInterface, ["descriptor", "descriptorDigest", "entryExport", "hostContractVersion"], "typedInterface");
  if (typeof manifest.typedInterface.descriptor !== "string" || !manifest.typedInterface.descriptor || path.isAbsolute(manifest.typedInterface.descriptor) || manifest.typedInterface.descriptor.includes("\\") || manifest.typedInterface.descriptor.split("/").includes("..")) fail("air.v051.typed_manifest_invalid", "typedInterface.descriptor must be a safe package-local path");
  const packageRoot = fs.realpathSync(packageDir);
  const descriptorPath = path.resolve(packageRoot, manifest.typedInterface.descriptor);
  if (!descriptorPath.startsWith(`${packageRoot}${path.sep}`) || !fs.existsSync(descriptorPath) || !fs.statSync(descriptorPath).isFile()) fail("air.v051.typed_manifest_invalid", "typedInterface descriptor file is unavailable");
  if (!fs.realpathSync(descriptorPath).startsWith(`${packageRoot}${path.sep}`)) fail("air.v051.typed_manifest_invalid", "typedInterface descriptor must resolve inside package directory");
  let source;
  try { source = JSON.parse(fs.readFileSync(descriptorPath, "utf8")); } catch { fail("air.v051.typed_manifest_invalid", "typedInterface descriptor is not JSON"); }
  const descriptor = normalizeTypedInterfaceDescriptor(source);
  const actualDigest = descriptorDigest(descriptor);
  if (manifest.typedInterface.descriptorDigest !== actualDigest) fail("air.v051.typed_manifest_invalid", "typedInterface descriptor digest mismatch");
  if (manifest.typedInterface.hostContractVersion !== HOST_CONTRACT_VERSION || descriptor.module_id !== manifest.name || descriptor.air_abi_lane !== ABI_012) fail("air.v051.typed_manifest_invalid", "typed interface binding identity mismatch");
  const entry = descriptor.exports.find((item) => item.name === manifest.typedInterface.entryExport);
  if (!entry) fail("air.v051.typed_manifest_invalid", "typedInterface.entryExport is missing from descriptor");
  if (!Array.isArray(manifest.packageExports) || manifest.packageExports.length !== descriptor.exports.length) fail("air.v051.typed_manifest_invalid", "packageExports must exactly bind descriptor exports");
  const bindings = new Map(manifest.packageExports.map((item) => [item && item.name, item]));
  for (const item of descriptor.exports) {
    const binding = bindings.get(item.name);
    if (!binding || binding.function !== item.function) fail("air.v051.typed_manifest_invalid", `package export '${item.name}' mismatches descriptor`);
    if (binding.module !== manifest.entry) fail("air.v051.typed_manifest_invalid", `package export '${item.name}' must bind manifest.entry for AIR ABI 0.12 candidate`);
  }
  let sourceModule = options.sourceModule || null;
  if (!sourceModule && options.loadSource !== false) {
    const entryPath = path.resolve(packageRoot, manifest.entry || "");
    if (!manifest.entry || !entryPath.startsWith(`${packageRoot}${path.sep}`) || !fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile() || !fs.realpathSync(entryPath).startsWith(`${packageRoot}${path.sep}`)) fail("air.v051.typed_manifest_invalid", "candidate package entry source is unavailable");
    const { parseV051Air } = require("./parser");
    const { verifyV051Air } = require("./verifier");
    sourceModule = parseV051Air(fs.readFileSync(entryPath, "utf8"), entryPath);
    verifyV051Air(sourceModule);
  }
  if (sourceModule) validateDescriptorAgainstSource(descriptor, sourceModule);
  const semanticManifest = normalizeSemanticManifest({
    air_abi_lane: ABI_012,
    capabilities: manifest.capabilities || [],
    entry_export: manifest.typedInterface.entryExport,
    host_abi_lane: manifest.hostAbi,
    host_contract_version: HOST_CONTRACT_VERSION,
    interface_descriptor_digest: actualDigest,
    name: manifest.name,
    target_profiles: manifest.targetProfiles || [],
    version: manifest.version
  });
  return { descriptor, descriptorDigest: actualDigest, semanticManifest, manifestDigest: semanticManifestDigest(semanticManifest), sourceModule };
}

function isCandidateAbi012(value) { return value === ABI_012; }
function enumSchemaContextFromDescriptor(descriptorInput) {
  const descriptor = normalizeTypedInterfaceDescriptor(descriptorInput);
  return {
    enums: Object.fromEntries(descriptor.types.map((declaration) => [declaration.type_id, {
      kind: declaration.kind,
      values: declaration.cases.map((entry) => entry.discriminant)
    }]))
  };
}
function canonicalJson(value) { return require("./v051_reference").canonical(value); }
function rawDigest(value) { return require("./v051_reference").rawDigest(value); }

module.exports = {
  ABI_012,
  TYPED_INTERFACE_SCHEMA,
  HOST_CONTRACT_VERSION,
  TypedInterfaceError,
  parseTypeReference,
  normalizeTypedInterfaceDescriptor,
  descriptorDigest,
  canonicalDescriptor,
  normalizeSemanticManifest,
  semanticManifestDigest,
  validateDescriptorAgainstSource,
  validateCandidateManifestObject,
  validateTypedPackageBinding,
  isCandidateAbi012,
  enumSchemaContextFromDescriptor
};
