const VECTOR_TYPES = new Set(["vec2", "vec3", "vec4", "mat4", "quat"]);
const { BORROWED_SLICE_TYPE, parseBorrowedSliceType } = require("./borrowed_slices");
const PRIMITIVES = new Set(["i32", "i64", "f32", "f64", "bool", "ptr", "slice", BORROWED_SLICE_TYPE, "void", ...VECTOR_TYPES]);
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const SLICE_LEN_MAX = 2147483647;
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
  const borrowed = parseBorrowedSliceType(type, loc);
  if (borrowed) return borrowed;
  const refinement = parseRefinementType(type, loc);
  if (refinement) return refinement;
  if (!isTypeSyntax(type)) {
    throw new AirError(`unknown type '${type}'`, loc);
  }
  return { base: type, canonical: type, refinement: null };
}

function isTypeSyntax(type) {
  try {
    if (parseBorrowedSliceType(type)) return true;
    if (parseRefinementType(type)) return true;
  } catch {
    return false;
  }
  if (PRIMITIVES.has(type)) return true;
  if (/^[A-Z][A-Za-z0-9_]*$/.test(type)) return true;
  const array = parseArrayType(type);
  if (array) return Boolean(array.length > 0 && array.length <= 65536 && isTypeSyntax(array.element));
  const buffer = parseBufferType(type);
  return Boolean(buffer && buffer.length > 0 && buffer.length <= 65536 && scalarByteWidth(buffer.element));
}

function parseRefinementType(type, loc = null) {
  const text = String(type || "").trim();
  if (!/^(?:i32|slice)\s*</.test(text)) return null;

  let match = text.match(/^i32<\s*(-?[0-9]+)\s*\.\.\s*(-?[0-9]+)\s*>$/);
  if (match) {
    const min = parseBound(match[1], I32_MIN, I32_MAX, "i32", loc);
    const max = parseBound(match[2], I32_MIN, I32_MAX, "i32", loc);
    assertOrderedRange(min, max, text, loc);
    return {
      base: "i32",
      canonical: `i32<${min}..${max}>`,
      refinement: { kind: "i32_range", min, max }
    };
  }

  if (/^i32\s*</.test(text)) {
    refinementFail("syntax_invalid", `malformed i32 refinement '${text}'; expected i32<MIN..MAX>`, loc);
  }

  if (/^slice<\s*nonempty\s*>$/.test(text)) {
    return {
      base: "slice",
      canonical: `slice<len=1..${SLICE_LEN_MAX}>`,
      refinement: { kind: "slice_length", min: 1, max: SLICE_LEN_MAX }
    };
  }

  match = text.match(/^slice<\s*len\s*<=\s*([0-9]+)\s*>$/);
  if (match) {
    const max = parseBound(match[1], 0, SLICE_LEN_MAX, "slice length", loc);
    return {
      base: "slice",
      canonical: `slice<len<=${max}>`,
      refinement: { kind: "slice_length", min: 0, max }
    };
  }

  match = text.match(/^slice<\s*len\s*=\s*([0-9]+)\s*\.\.\s*([0-9]+)\s*>$/);
  if (match) {
    const min = parseBound(match[1], 0, SLICE_LEN_MAX, "slice length", loc);
    const max = parseBound(match[2], 0, SLICE_LEN_MAX, "slice length", loc);
    assertOrderedRange(min, max, text, loc);
    const canonical = min === 0
      ? `slice<len<=${max}>`
      : `slice<len=${min}..${max}>`;
    return {
      base: "slice",
      canonical,
      refinement: { kind: "slice_length", min, max }
    };
  }

  refinementFail(
    "syntax_invalid",
    `malformed slice refinement '${text}'; expected slice<len<=N>, slice<len=MIN..MAX>, or slice<nonempty>`,
    loc
  );
}

function parseBound(raw, min, max, label, loc) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    refinementFail("bound_out_of_range", `${label} refinement bound '${raw}' must be an integer in ${min}..${max}`, loc);
  }
  return value;
}

function assertOrderedRange(min, max, syntax, loc) {
  if (min > max) {
    refinementFail("range_invalid", `refinement '${syntax}' is impossible because ${min} > ${max}`, loc);
  }
}

function refinementFail(suffix, message, loc) {
  const { AirError } = require("./errors");
  throw new AirError(`air.refinement.${suffix}: ${message}`, loc);
}

function refinementContains(expected, actual) {
  if (!expected || !actual || expected.kind !== actual.kind) return false;
  return actual.min >= expected.min && actual.max <= expected.max;
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
  scalarByteWidth,
  I32_MIN,
  I32_MAX,
  SLICE_LEN_MAX,
  parseRefinementType,
  refinementContains
};
