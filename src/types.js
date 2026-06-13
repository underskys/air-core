const VECTOR_TYPES = new Set(["vec2", "vec3", "vec4", "mat4", "quat"]);
const PRIMITIVES = new Set(["i32", "i64", "f32", "f64", "bool", "ptr", "slice", "void", ...VECTOR_TYPES]);
const HOST_OBJECT_HANDLE_TYPES = new Set([
  "DOM",
  "Canvas",
  "CanvasRenderingContext2D",
  "HTMLAudioElement",
  "ImageBitmap",
  "WebAudioNode",
  "AudioNode",
  "WebGPUDevice",
  "GPUDevice",
  "GPUBuffer",
  "GPUTexture",
  "MetalDevice",
  "MTLDevice",
  "VkDevice",
  "D3DDevice",
  "Socket",
  "FileHandle",
  "ProcessHandle"
]);

function assertType(type, loc) {
  const { AirError } = require("./errors");
  if (HOST_OBJECT_HANDLE_TYPES.has(type)) {
    throw new AirError(`AIR_HOST_OBJECT_HANDLE_TYPE: host object handle type '${type}' is not allowed in AIR; use scalar manifest/package handles and host-owned resources`, loc);
  }
  if (!isTypeSyntax(type)) {
    throw new AirError(`unknown type '${type}'`, loc);
  }
}

function isTypeSyntax(type) {
  if (PRIMITIVES.has(type)) return true;
  if (/^[A-Z][A-Za-z0-9_]*$/.test(type)) return true;
  const array = parseArrayType(type);
  if (array) return Boolean(array.length > 0 && array.length <= 65536 && isTypeSyntax(array.element));
  const buffer = parseBufferType(type);
  return Boolean(buffer && buffer.length > 0 && buffer.length <= 65536 && scalarByteWidth(buffer.element));
}

function typeOfConstOp(op) {
  if (op === "const.i32") return "i32";
  if (op === "const.i64") return "i64";
  if (op === "const.f32") return "f32";
  if (op === "const.f64") return "f64";
  if (op === "const.bool") return "bool";
  if (op === "const.str") return "slice";
  return null;
}

function isVectorType(type) {
  return VECTOR_TYPES.has(type);
}

function parseArrayType(type) {
  const match = type.match(/^array<(.+),([0-9]+)>$/);
  if (!match) return null;
  return { element: match[1].trim(), length: Number(match[2]) };
}

function parseBufferType(type) {
  const match = type.match(/^buffer<(.+),([0-9]+)>$/);
  if (!match) return null;
  return { element: match[1].trim(), length: Number(match[2]) };
}

function isArrayType(type) {
  return Boolean(parseArrayType(type));
}

function isBufferType(type) {
  return Boolean(parseBufferType(type));
}

function isStructName(type) {
  return /^[A-Z][A-Za-z0-9_]*$/.test(type);
}

function isCompositeType(type) {
  return isVectorType(type) || isArrayType(type) || isStructName(type) || isBufferType(type);
}

function scalarByteWidth(type) {
  if (["i32", "f32", "ptr", "slice", "bool"].includes(type)) return 4;
  if (["i64", "f64"].includes(type)) return 8;
  return undefined;
}

module.exports = {
  PRIMITIVES,
  VECTOR_TYPES,
  assertType,
  typeOfConstOp,
  isVectorType,
  parseArrayType,
  parseBufferType,
  isArrayType,
  isBufferType,
  isStructName,
  isCompositeType,
  HOST_OBJECT_HANDLE_TYPES,
  scalarByteWidth
};
