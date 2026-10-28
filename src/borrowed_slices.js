const crypto = require("crypto");
const { BORROWED_SLICES_AIR_ABI_VERSION } = require("./version");

const BORROWED_SLICE_TYPE = "borrowed_slice";
const BORROWED_SLICE_LENGTH_MAX = 2147483647;
const BORROWED_SLICE_ACCESS = new Set(["readonly", "writeonly", "readwrite"]);
const BORROWED_SLICE_ALIGNMENTS = new Set([1, 2, 4, 8, 16]);
const BORROWED_SLICE_DOMAINS = Object.freeze(["wasm-linear"]);
const WASM32_MAX_ADDRESS = 0xffffffff;
const WASM32_BYTE_CAPACITY = 0x100000000;

function parseBorrowedSliceType(type, loc = null) {
  const text = String(type || "").trim();
  if (!/^borrowed_slice\b/.test(text)) return null;

  const outer = text.match(/^borrowed_slice\s*<\s*(.*?)\s*>$/);
  if (!outer) {
    borrowedFail(
      "syntax_invalid",
      `malformed borrowed slice '${text}'; expected borrowed_slice<ACCESS,len<=MAX,align=ALIGNMENT>`,
      loc
    );
  }

  const parts = splitDescriptorParts(outer[1]);
  if (parts.length !== 3) {
    borrowedFail(
      "syntax_invalid",
      `borrowed slice '${text}' must declare access, one finite length range, and alignment`,
      loc
    );
  }

  const access = parts[0];
  if (!BORROWED_SLICE_ACCESS.has(access)) {
    borrowedFail(
      "mode_invalid",
      `borrowed slice access '${access}' must be readonly, writeonly, or readwrite`,
      loc
    );
  }

  const length = parseBorrowedLength(parts[1], text, loc);
  const alignmentMatch = parts[2].match(/^align\s*=\s*([0-9]+)$/);
  if (!alignmentMatch) {
    borrowedFail(
      "alignment_invalid",
      `borrowed slice '${text}' must declare align=1, 2, 4, 8, or 16`,
      loc
    );
  }
  const alignment = Number(alignmentMatch[1]);
  if (!BORROWED_SLICE_ALIGNMENTS.has(alignment)) {
    borrowedFail(
      "alignment_invalid",
      `borrowed slice alignment ${alignment} must be one of 1, 2, 4, 8, or 16`,
      loc
    );
  }

  const lengthSyntax = length.min === 0
    ? `len<=${length.max}`
    : `len=${length.min}..${length.max}`;
  return {
    base: BORROWED_SLICE_TYPE,
    canonical: `borrowed_slice<${access},${lengthSyntax},align=${alignment}>`,
    refinement: null,
    borrow: {
      access,
      length: {
        unit: "bytes",
        min: length.min,
        max: length.max
      },
      alignment,
      lifetime: "invocation",
      noescape: true,
      growable: false,
      freeable: false,
      returnable: false,
      storable: false
    }
  };
}

function parseBorrowedLength(part, syntax, loc) {
  let match = part.match(/^len\s*<=\s*([0-9]+)$/);
  if (match) {
    return { min: 0, max: parseLengthBound(match[1], loc) };
  }
  match = part.match(/^len\s*=\s*([0-9]+)\s*\.\.\s*([0-9]+)$/);
  if (match) {
    const min = parseLengthBound(match[1], loc);
    const max = parseLengthBound(match[2], loc);
    if (min > max) {
      borrowedFail(
        "length_invalid",
        `borrowed slice '${syntax}' is impossible because ${min} > ${max}`,
        loc
      );
    }
    return { min, max };
  }
  if (/^len\b/.test(part)) {
    borrowedFail(
      "length_invalid",
      `borrowed slice '${syntax}' requires len<=MAX or len=MIN..MAX with byte bounds`,
      loc
    );
  }
  borrowedFail(
    "unbounded",
    `borrowed slice '${syntax}' requires a finite maximum byte length`,
    loc
  );
}

function parseLengthBound(raw, loc) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > BORROWED_SLICE_LENGTH_MAX) {
    borrowedFail(
      "length_invalid",
      `borrowed slice length '${raw}' must be an integer in 0..${BORROWED_SLICE_LENGTH_MAX}`,
      loc
    );
  }
  return value;
}

function splitDescriptorParts(text) {
  return String(text || "").split(",").map((part) => part.trim()).filter(Boolean);
}

function borrowedAccessAllows(access, operation) {
  if (operation === "read") return access === "readonly" || access === "readwrite";
  if (operation === "write") return access === "writeonly" || access === "readwrite";
  return false;
}

function borrowedArgumentCompatible(expected, actual) {
  if (!expected || !actual) return false;
  const actualCanRead = borrowedAccessAllows(actual.access, "read");
  const actualCanWrite = borrowedAccessAllows(actual.access, "write");
  if (borrowedAccessAllows(expected.access, "read") && !actualCanRead) return false;
  if (borrowedAccessAllows(expected.access, "write") && !actualCanWrite) return false;
  if (actual.length.min < expected.length.min || actual.length.max > expected.length.max) return false;
  if (actual.alignment < expected.alignment || actual.alignment % expected.alignment !== 0) return false;
  return true;
}

function classifyBorrowedRange(base, length, options = {}) {
  const limit = options.limit === undefined ? WASM32_BYTE_CAPACITY : options.limit;
  const alignment = options.alignment === undefined ? 1 : options.alignment;
  const accessWidth = options.accessWidth === undefined ? 0 : options.accessWidth;

  if (!Number.isSafeInteger(length) || length < 0 || length > BORROWED_SLICE_LENGTH_MAX) {
    return rangeFailure("air.borrow.length_out_of_range");
  }
  if (!Number.isSafeInteger(base) || base < 0 || base > WASM32_MAX_ADDRESS) {
    return rangeFailure("air.borrow.pointer_out_of_bounds");
  }
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > WASM32_BYTE_CAPACITY) {
    return rangeFailure("air.borrow.pointer_out_of_bounds");
  }
  if (!Number.isSafeInteger(alignment) || alignment <= 0 || base % alignment !== 0) {
    return rangeFailure("air.borrow.alignment_mismatch");
  }
  if (!Number.isSafeInteger(accessWidth) || accessWidth < 0 || accessWidth > BORROWED_SLICE_LENGTH_MAX) {
    return rangeFailure("air.borrow.pointer_out_of_bounds");
  }
  if (base > limit || length > limit - base || accessWidth > length || accessWidth > limit - base) {
    return rangeFailure("air.borrow.pointer_out_of_bounds");
  }
  return Object.freeze({
    ok: true,
    end: base + length
  });
}

function borrowedRangesOverlap(leftBase, leftLength, rightBase, rightLength) {
  for (const value of [leftBase, leftLength, rightBase, rightLength]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("borrowed ranges require non-negative safe integers");
    }
  }
  if (leftLength === 0 || rightLength === 0) return false;
  const leftEnd = BigInt(leftBase) + BigInt(leftLength);
  const rightEnd = BigInt(rightBase) + BigInt(rightLength);
  return BigInt(leftBase) < rightEnd && BigInt(rightBase) < leftEnd;
}

function borrowedOverlapAllowed(leftAccess, rightAccess, overlap) {
  if (!overlap) return true;
  return leftAccess === "readonly" && rightAccess === "readonly";
}

function rangeFailure(code) {
  return Object.freeze({ ok: false, code });
}

function moduleUsesBorrowedSlices(mod) {
  return (mod.functions || []).some(
    (fn) => fn.exported && (fn.params || []).some((param) => param.type === BORROWED_SLICE_TYPE)
  );
}

function requiredAirAbiForModule(mod) {
  return moduleUsesBorrowedSlices(mod) ? BORROWED_SLICES_AIR_ABI_VERSION : null;
}

function borrowedSliceInterfaceDescriptor(mod) {
  if (!moduleUsesBorrowedSlices(mod)) return null;
  return {
    schema: "air.borrowed-slice-interface.v1",
    airAbi: BORROWED_SLICES_AIR_ABI_VERSION,
    feature: "borrowed-slice-v1",
    lengthUnit: "bytes",
    memoryDomains: BORROWED_SLICE_DOMAINS.slice(),
    transferModeRequired: true,
    exports: (mod.functions || [])
      .filter((fn) => fn.exported && (fn.params || []).some((param) => param.type === BORROWED_SLICE_TYPE))
      .map((fn) => ({
        name: fn.name,
        params: fn.params.map((param) => param.type === BORROWED_SLICE_TYPE
          ? {
              name: param.name,
              kind: "borrowed_slice",
              lowered: [`${param.name}$ptr`, `${param.name}$byte_len`],
              access: param.borrow.access,
              length: { ...param.borrow.length },
              alignment: param.borrow.alignment,
              lifetime: param.borrow.lifetime,
              noescape: param.borrow.noescape
            }
          : {
              name: param.name,
              kind: "value",
              type: param.type
            }),
        entryContracts: (fn.requires || [])
          .filter((contract) => contract.kind === "checked_param" || contract.kind === "checked_borrow_length")
          .map(canonicalEntryContract)
      }))
  };
}

function canonicalEntryContract(contract) {
  if (contract.kind === "checked_param") {
    return {
      kind: contract.kind,
      parameter: contract.parameter,
      op: contract.op,
      literal: contract.literal
    };
  }
  return {
    kind: contract.kind,
    borrow: contract.borrow,
    unit: contract.unit,
    op: contract.op,
    parameter: contract.parameter,
    multiplier: contract.multiplier
  };
}

function borrowedSliceInterfaceDigest(mod) {
  const descriptor = borrowedSliceInterfaceDescriptor(mod);
  if (!descriptor) return null;
  return crypto
    .createHash("sha256")
    .update("air.borrowed-slice-interface.v1\0")
    .update(stableStringify(descriptor))
    .digest("hex");
}

// P0-08 (slice text P8-R13, P8-R15; ABI-1 (A), AD-3): the typed-v0.53
// borrowed lane. Its descriptor keeps the v1 fields and binding semantics
// under its own schema, lane, feature and digest domain; the v1 schema and
// domain above stay for legacy, byte for byte. A typed-v0.53 parameter type is
// its canonical source text, so the borrow is read from that text.
const TYPED_BORROWED_SLICE_INTERFACE = Object.freeze({
  airAbi: "0.13",
  digestDomain: "air.borrowed-slice-interface.v2\0",
  feature: "typed-memory-v1",
  schema: "air.borrowed-slice-interface.v2"
});

function typedBorrowOf(type) {
  return /^borrowed_slice</.test(String(type || "")) ? parseBorrowedSliceType(type).borrow : null;
}

function typedModuleUsesBorrowedSlices(mod) {
  return (mod.functions || []).some((fn) => fn.exported && (fn.params || []).some((param) => typedBorrowOf(param.type)));
}

function typedBorrowedSliceInterfaceDescriptor(mod) {
  if (!typedModuleUsesBorrowedSlices(mod)) return null;
  return {
    schema: TYPED_BORROWED_SLICE_INTERFACE.schema,
    airAbi: TYPED_BORROWED_SLICE_INTERFACE.airAbi,
    feature: TYPED_BORROWED_SLICE_INTERFACE.feature,
    lengthUnit: "bytes",
    memoryDomains: BORROWED_SLICE_DOMAINS.slice(),
    transferModeRequired: true,
    exports: (mod.functions || [])
      .filter((fn) => fn.exported && (fn.params || []).some((param) => typedBorrowOf(param.type)))
      .map((fn) => ({
        name: fn.name,
        params: fn.params.map((param) => {
          const borrow = typedBorrowOf(param.type);
          return borrow
            ? {
                name: param.name,
                kind: "borrowed_slice",
                lowered: [`${param.name}$ptr`, `${param.name}$byte_len`],
                access: borrow.access,
                length: { ...borrow.length },
                alignment: borrow.alignment,
                lifetime: borrow.lifetime,
                noescape: borrow.noescape
              }
            : { name: param.name, kind: "value", type: param.type };
        }),
        entryContracts: []
      }))
  };
}

function typedBorrowedSliceInterfaceDigest(descriptor) {
  return crypto
    .createHash("sha256")
    .update(TYPED_BORROWED_SLICE_INTERFACE.digestDomain)
    .update(stableStringify(descriptor))
    .digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function borrowedFail(suffix, message, loc) {
  const { AirError } = require("./errors");
  throw new AirError(`air.borrow.${suffix}: ${message}`, loc);
}

// X-SND-07: borrowed-lane modules export the linear-memory range that AIR
// itself owns (static data and region slots). A host view that intersects it
// could be mutated by the module or could mutate module-owned memory.
const AIR_OWNED_MEMORY_BASE_EXPORT = "__air_owned_memory_base";
const AIR_OWNED_MEMORY_END_EXPORT = "__air_owned_memory_end";

function airOwnedMemoryRange(instance) {
  const exports = instance && instance.exports ? instance.exports : {};
  const base = exports[AIR_OWNED_MEMORY_BASE_EXPORT];
  const end = exports[AIR_OWNED_MEMORY_END_EXPORT];
  if (!(base instanceof WebAssembly.Global) || !(end instanceof WebAssembly.Global)) return null;
  const start = Number(base.value);
  const stop = Number(end.value);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop) || start < 0 || stop < start) return null;
  return { start, end: stop };
}

function rangeIntersectsAirOwnedMemory(owned, offset, length) {
  if (!owned || owned.end <= owned.start || length <= 0) return false;
  return offset < owned.end && offset + length > owned.start;
}

module.exports = {
  AIR_OWNED_MEMORY_BASE_EXPORT,
  AIR_OWNED_MEMORY_END_EXPORT,
  BORROWED_SLICE_TYPE,
  BORROWED_SLICE_LENGTH_MAX,
  BORROWED_SLICE_ACCESS,
  BORROWED_SLICE_ALIGNMENTS,
  BORROWED_SLICE_DOMAINS,
  WASM32_MAX_ADDRESS,
  WASM32_BYTE_CAPACITY,
  airOwnedMemoryRange,
  borrowedAccessAllows,
  borrowedArgumentCompatible,
  borrowedOverlapAllowed,
  borrowedRangesOverlap,
  borrowedSliceInterfaceDescriptor,
  borrowedSliceInterfaceDigest,
  classifyBorrowedRange,
  moduleUsesBorrowedSlices,
  requiredAirAbiForModule,
  parseBorrowedSliceType,
  rangeIntersectsAirOwnedMemory
};
// typed-v0.53 borrowed lane (P0-08), used by the verified build and the typed
// admission; not part of the enumerable exports.
Object.defineProperty(module.exports, "typedV053", {
  enumerable: false,
  value: Object.freeze({
    INTERFACE: TYPED_BORROWED_SLICE_INTERFACE,
    borrowOf: typedBorrowOf,
    interfaceDescriptor: typedBorrowedSliceInterfaceDescriptor,
    interfaceDigest: typedBorrowedSliceInterfaceDigest,
    moduleUsesBorrowedSlices: typedModuleUsesBorrowedSlices,
    stableStringify
  })
});
