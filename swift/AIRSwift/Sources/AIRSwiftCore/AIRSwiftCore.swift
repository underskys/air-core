import Foundation

public enum AIRSwiftError: Error, Equatable, Sendable, CustomStringConvertible {
    case invalid(String, String)
    case duplicate(String)
    case unsupported(String)
    case parse(String)

    public var description: String {
        switch self {
        case let .invalid(code, message): return "\(code): \(message)"
        case let .duplicate(message): return "air.v051.collection_duplicate: \(message)"
        case let .unsupported(message): return "air.v051.unsupported: \(message)"
        case let .parse(message): return "air.v051.parse_invalid: \(message)"
        }
    }
}

public enum AIRValidation {
    public static func asciiIdentifier(_ value: String, qualified: Bool = false, label: String = "identifier") throws -> String {
        guard !value.isEmpty, value.unicodeScalars.allSatisfy({ $0.value < 0x80 }) else {
            throw AIRSwiftError.invalid("air.v051.value_invalid", "\(label) must be non-empty ASCII")
        }
        guard value.unicodeScalars.count <= 96 else {
            throw AIRSwiftError.invalid("air.v051.value_invalid", "\(label) is too long")
        }
        guard let first = value.unicodeScalars.first, first.value >= 97, first.value <= 122 else {
            throw AIRSwiftError.invalid("air.v051.value_invalid", "\(label) must begin with lowercase ASCII")
        }
        for scalar in value.unicodeScalars.dropFirst() {
            let allowed = (scalar.value >= 97 && scalar.value <= 122)
                || (scalar.value >= 48 && scalar.value <= 57)
                || scalar == "." || scalar == "_" || scalar == "-"
            guard allowed else {
                throw AIRSwiftError.invalid("air.v051.value_invalid", "\(label) contains an invalid character")
            }
        }
        guard !qualified || value.contains(".") else {
            throw AIRSwiftError.invalid("air.v051.value_invalid", "\(label) must be qualified")
        }
        return value
    }

    public static func qualifiedEnumTypeID(_ value: String, label: String = "enum type") throws -> String {
        // Keep the frozen two-part grammar portable to the package deployment baseline.
        let parts = value.components(separatedBy: "::")
        guard parts.count == 2 else {
            throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "\(label) must use module::Type identity")
        }
        _ = try asciiIdentifier(parts[0], label: label)
        guard let first = parts[1].unicodeScalars.first, first.value >= 65, first.value <= 90,
              !parts[1].isEmpty, parts[1].unicodeScalars.allSatisfy({ scalar in
                  (scalar.value >= 65 && scalar.value <= 90)
                      || (scalar.value >= 97 && scalar.value <= 122)
                      || (scalar.value >= 48 && scalar.value <= 57)
                      || scalar == "_"
              }) else {
            throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "\(label) must have a capitalized type name")
        }
        return value
    }

    public static func compareUnicodeCodePoints(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.unicodeScalars)
        let right = Array(rhs.unicodeScalars)
        for index in 0..<Swift.min(left.count, right.count) {
            if left[index].value != right[index].value { return left[index].value < right[index].value }
        }
        return left.count < right.count
    }

    public static func sortedUniqueASCII(_ values: [String], label: String, qualified: Bool = true) throws -> [String] {
        let normalized = try values.map { try asciiIdentifier($0, qualified: qualified, label: label) }
        guard Set(normalized).count == normalized.count else { throw AIRSwiftError.duplicate("\(label) has duplicate semantic keys") }
        return normalized.sorted()
    }
}

public struct AIRDigest: Hashable, Sendable, CustomStringConvertible {
    public let value: String

    public init(_ value: String) throws {
        guard value.hasPrefix("sha256:"), value.count == 71,
              value.dropFirst(7).unicodeScalars.allSatisfy({
                  ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
              }) else {
            throw AIRSwiftError.invalid("air.v051.digest_invalid", "digest must be sha256: followed by 64 lowercase hex digits")
        }
        self.value = value
    }

    public var description: String { value }

    public static func raw(_ bytes: Data) -> AIRDigest {
        AIRDigest(unchecked: "sha256:\(AIRSHA256.hex(bytes))")
    }

    public static func domain(_ domain: String, _ value: AIRCanonicalValue) throws -> AIRDigest {
        var bytes = Data(domain.utf8)
        bytes.append(0)
        bytes.append(try value.canonicalData())
        return raw(bytes)
    }

    private init(unchecked value: String) { self.value = value }
}

public enum AIRSHA256 {
    private static let initial: [UInt32] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]
    private static let constants: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]

    public static func hex(_ data: Data) -> String {
        var bytes = Array(data)
        let bitLength = UInt64(bytes.count) &* 8
        bytes.append(0x80)
        while bytes.count % 64 != 56 { bytes.append(0) }
        for shift in stride(from: 56, through: 0, by: -8) {
            bytes.append(UInt8((bitLength >> UInt64(shift)) & 0xff))
        }

        var hash = initial
        for offset in stride(from: 0, to: bytes.count, by: 64) {
            var words = Array(repeating: UInt32(0), count: 64)
            for index in 0..<16 {
                let base = offset + index * 4
                words[index] = (UInt32(bytes[base]) << 24) | (UInt32(bytes[base + 1]) << 16)
                    | (UInt32(bytes[base + 2]) << 8) | UInt32(bytes[base + 3])
            }
            for index in 16..<64 {
                let s0 = words[index - 15].rotatedRight(7) ^ words[index - 15].rotatedRight(18) ^ (words[index - 15] >> 3)
                let s1 = words[index - 2].rotatedRight(17) ^ words[index - 2].rotatedRight(19) ^ (words[index - 2] >> 10)
                words[index] = words[index - 16] &+ s0 &+ words[index - 7] &+ s1
            }
            var a = hash[0], b = hash[1], c = hash[2], d = hash[3]
            var e = hash[4], f = hash[5], g = hash[6], h = hash[7]
            for index in 0..<64 {
                let s1 = e.rotatedRight(6) ^ e.rotatedRight(11) ^ e.rotatedRight(25)
                let choice = (e & f) ^ (~e & g)
                let temporary1 = h &+ s1 &+ choice &+ constants[index] &+ words[index]
                let s0 = a.rotatedRight(2) ^ a.rotatedRight(13) ^ a.rotatedRight(22)
                let majority = (a & b) ^ (a & c) ^ (b & c)
                let temporary2 = s0 &+ majority
                h = g; g = f; f = e; e = d &+ temporary1
                d = c; c = b; b = a; a = temporary1 &+ temporary2
            }
            hash[0] = hash[0] &+ a; hash[1] = hash[1] &+ b; hash[2] = hash[2] &+ c; hash[3] = hash[3] &+ d
            hash[4] = hash[4] &+ e; hash[5] = hash[5] &+ f; hash[6] = hash[6] &+ g; hash[7] = hash[7] &+ h
        }
        return hash.map { String(format: "%08x", $0) }.joined()
    }
}

private extension UInt32 {
    func rotatedRight(_ distance: UInt32) -> UInt32 { (self >> distance) | (self << (32 - distance)) }
}

public struct AIRCanonicalObject: Sendable {
    public let fields: [(String, AIRCanonicalValue)]

    public init(_ fields: [(String, AIRCanonicalValue)]) throws {
        var seen = Set<String>()
        for (key, _) in fields {
            guard seen.insert(key).inserted else { throw AIRSwiftError.duplicate("canonical object repeats key '\(key)'") }
        }
        self.fields = fields.sorted { AIRValidation.compareUnicodeCodePoints($0.0, $1.0) }
    }

    public func value(for key: String) -> AIRCanonicalValue? {
        fields.first(where: { $0.0 == key })?.1
    }
}

public indirect enum AIRCanonicalValue: Sendable {
    case string(String)
    case boolean(Bool)
    case integer(Int64)
    case array([AIRCanonicalValue])
    case object(AIRCanonicalObject)

    public static func object(_ fields: [(String, AIRCanonicalValue)]) throws -> AIRCanonicalValue {
        .object(try AIRCanonicalObject(fields))
    }

    public func canonicalString() throws -> String {
        switch self {
        case let .string(value): return AIRCanonicalValue.escape(value)
        case let .boolean(value): return value ? "true" : "false"
        case let .integer(value): return String(value)
        case let .array(values): return "[" + (try values.map { try $0.canonicalString() }).joined(separator: ",") + "]"
        case let .object(object):
            return "{" + (try object.fields.map { key, value in
                "\(AIRCanonicalValue.escape(key)):\(try value.canonicalString())"
            }).joined(separator: ",") + "}"
        }
    }

    public func canonicalData() throws -> Data { Data(try canonicalString().utf8) }

    private static func escape(_ value: String) -> String {
        var output = "\""
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x22: output += "\\\""
            case 0x5c: output += "\\\\"
            case 0x08: output += "\\b"
            case 0x0c: output += "\\f"
            case 0x0a: output += "\\n"
            case 0x0d: output += "\\r"
            case 0x09: output += "\\t"
            case 0..<0x20:
                let hex = String(scalar.value, radix: 16)
                output += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
            default: output.unicodeScalars.append(scalar)
            }
        }
        return output + "\""
    }
}

public enum AIRCanonicalJSON {
    public static func parse(_ text: String) throws -> AIRCanonicalValue {
        var parser = Parser(Array(text.utf8))
        let value = try parser.parseValue()
        parser.skipWhitespace()
        guard parser.isAtEnd else { throw AIRSwiftError.parse("trailing bytes after JSON value") }
        return value
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }
        var isAtEnd: Bool { index >= bytes.count }

        mutating func skipWhitespace() {
            while index < bytes.count, [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
        }

        mutating func parseValue() throws -> AIRCanonicalValue {
            skipWhitespace()
            guard index < bytes.count else { throw AIRSwiftError.parse("unexpected end of JSON") }
            switch bytes[index] {
            case 0x7b: return try parseObject()
            case 0x5b: return try parseArray()
            case 0x22: return .string(try parseString())
            case 0x74: try consume("true"); return .boolean(true)
            case 0x66: try consume("false"); return .boolean(false)
            case 0x2d, 0x30...0x39: return .integer(try parseInteger())
            default: throw AIRSwiftError.parse("unsupported JSON value")
            }
        }

        mutating func parseObject() throws -> AIRCanonicalValue {
            try consumeByte(0x7b)
            skipWhitespace()
            var fields: [(String, AIRCanonicalValue)] = []
            if try consumeIf(0x7d) { return try .object(fields) }
            while true {
                skipWhitespace()
                guard index < bytes.count, bytes[index] == 0x22 else { throw AIRSwiftError.parse("object key must be a JSON string") }
                let key = try parseString()
                skipWhitespace(); try consumeByte(0x3a)
                let value = try parseValue()
                fields.append((key, value))
                skipWhitespace()
                if try consumeIf(0x7d) { return try .object(fields) }
                try consumeByte(0x2c)
            }
        }

        mutating func parseArray() throws -> AIRCanonicalValue {
            try consumeByte(0x5b)
            skipWhitespace()
            var values: [AIRCanonicalValue] = []
            if try consumeIf(0x5d) { return .array(values) }
            while true {
                values.append(try parseValue())
                skipWhitespace()
                if try consumeIf(0x5d) { return .array(values) }
                try consumeByte(0x2c)
            }
        }

        mutating func parseString() throws -> String {
            try consumeByte(0x22)
            var output: [UInt8] = []
            while index < bytes.count {
                let byte = bytes[index]; index += 1
                if byte == 0x22 {
                    guard let value = String(bytes: output, encoding: .utf8) else { throw AIRSwiftError.parse("invalid UTF-8 string") }
                    return value
                }
                guard byte >= 0x20 else { throw AIRSwiftError.parse("unescaped control character") }
                if byte != 0x5c { output.append(byte); continue }
                guard index < bytes.count else { throw AIRSwiftError.parse("incomplete string escape") }
                let escape = bytes[index]; index += 1
                switch escape {
                case 0x22, 0x5c, 0x2f: output.append(escape)
                case 0x62: output.append(0x08)
                case 0x66: output.append(0x0c)
                case 0x6e: output.append(0x0a)
                case 0x72: output.append(0x0d)
                case 0x74: output.append(0x09)
                case 0x75:
                    let first = try parseUnicodeEscape()
                    if (0xd800...0xdbff).contains(first) {
                        try consumeByte(0x5c); try consumeByte(0x75)
                        let second = try parseUnicodeEscape()
                        guard (0xdc00...0xdfff).contains(second) else { throw AIRSwiftError.parse("invalid UTF-16 surrogate pair") }
                        let scalar = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
                        output.append(contentsOf: String(UnicodeScalar(scalar)!).utf8)
                    } else {
                        guard !(0xdc00...0xdfff).contains(first), let scalar = UnicodeScalar(first) else {
                            throw AIRSwiftError.parse("invalid UTF-16 surrogate")
                        }
                        output.append(contentsOf: String(scalar).utf8)
                    }
                default: throw AIRSwiftError.parse("invalid string escape")
                }
            }
            throw AIRSwiftError.parse("unterminated string")
        }

        mutating func parseUnicodeEscape() throws -> UInt32 {
            guard index + 4 <= bytes.count else { throw AIRSwiftError.parse("incomplete unicode escape") }
            var value: UInt32 = 0
            for _ in 0..<4 {
                let byte = bytes[index]; index += 1
                let digit: UInt32
                switch byte {
                case 48...57: digit = UInt32(byte - 48)
                case 65...70: digit = UInt32(byte - 55)
                case 97...102: digit = UInt32(byte - 87)
                default: throw AIRSwiftError.parse("invalid unicode escape")
                }
                value = value * 16 + digit
            }
            return value
        }

        mutating func parseInteger() throws -> Int64 {
            let start = index
            if bytes[index] == 0x2d { index += 1 }
            guard index < bytes.count else { throw AIRSwiftError.parse("invalid number") }
            if bytes[index] == 0x30 { index += 1 }
            else {
                guard (0x31...0x39).contains(bytes[index]) else { throw AIRSwiftError.parse("invalid number") }
                while index < bytes.count, (0x30...0x39).contains(bytes[index]) { index += 1 }
            }
            guard index == bytes.count || ![0x2e, 0x45, 0x65].contains(bytes[index]) else {
                throw AIRSwiftError.parse("floating JSON numbers are not canonical AIR values")
            }
            guard let value = Int64(String(bytes: bytes[start..<index], encoding: .utf8) ?? "") else {
                throw AIRSwiftError.parse("integer is out of Int64 range")
            }
            return value
        }

        mutating func consume(_ literal: String) throws {
            for byte in literal.utf8 { try consumeByte(byte) }
        }

        mutating func consumeByte(_ expected: UInt8) throws {
            skipWhitespace()
            guard index < bytes.count, bytes[index] == expected else { throw AIRSwiftError.parse("unexpected JSON byte") }
            index += 1
        }

        mutating func consumeIf(_ expected: UInt8) throws -> Bool {
            skipWhitespace()
            guard index < bytes.count, bytes[index] == expected else { return false }
            index += 1
            return true
        }
    }
}

public enum AIRPrimitiveType: String, Sendable, Equatable {
    case i32, i64, f32, f64, bool
}

public enum AIRFlatTypeReference: Sendable, Equatable {
    case primitive(AIRPrimitiveType)
    case enumeration(String)

    public var canonical: String {
        switch self {
        case let .primitive(type): return type.rawValue
        case let .enumeration(typeID): return typeID
        }
    }

    public static func parse(_ text: String) throws -> AIRFlatTypeReference {
        if let primitive = AIRPrimitiveType(rawValue: text) { return .primitive(primitive) }
        return .enumeration(try AIRValidation.qualifiedEnumTypeID(text))
    }
}

public enum AIRTypeReference: Sendable, Equatable {
    case flat(AIRFlatTypeReference)
    case option(AIRFlatTypeReference)
    case result(payload: AIRFlatTypeReference, errorEnum: String)

    public var canonical: String {
        switch self {
        case let .flat(value): return value.canonical
        case let .option(payload): return "option<\(payload.canonical)>"
        case let .result(payload, errorEnum): return "result<\(payload.canonical),\(errorEnum)>"
        }
    }

    public static func parse(_ text: String) throws -> AIRTypeReference {
        guard text == text.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            throw AIRSwiftError.invalid("air.v051.type_reference_invalid", "type reference must be canonical text")
        }
        if text.hasPrefix("option<"), text.hasSuffix(">") {
            return .option(try AIRFlatTypeReference.parse(String(text.dropFirst(7).dropLast())))
        }
        if text.hasPrefix("result<"), text.hasSuffix(">") {
            let body = String(text.dropFirst(7).dropLast())
            let pieces = body.split(separator: ",", omittingEmptySubsequences: false)
            guard pieces.count == 2, !pieces[0].isEmpty, !pieces[1].isEmpty else {
                throw AIRSwiftError.invalid("air.v051.type_reference_invalid", "result type must have two canonical parameters")
            }
            let payload = try AIRFlatTypeReference.parse(String(pieces[0]))
            let errorType = try AIRValidation.qualifiedEnumTypeID(String(pieces[1]))
            return .result(payload: payload, errorEnum: errorType)
        }
        return .flat(try AIRFlatTypeReference.parse(text))
    }
}

public enum AIRClosedEnumKind: String, Sendable, Equatable { case enumeration = "enum", errorEnum = "error_enum" }

public struct AIRClosedEnumSchema: Sendable, Equatable {
    public let typeID: String
    public let kind: AIRClosedEnumKind
    public let allowedDiscriminants: Set<Int32>

    public init(typeID: String, kind: AIRClosedEnumKind, allowedDiscriminants: Set<Int32>) throws {
        self.typeID = try AIRValidation.qualifiedEnumTypeID(typeID)
        guard !allowedDiscriminants.isEmpty else { throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "closed enum has no cases") }
        self.kind = kind
        self.allowedDiscriminants = allowedDiscriminants
    }

    fileprivate init(uncheckedTypeID: String, kind: AIRClosedEnumKind, allowedDiscriminants: Set<Int32>) {
        self.typeID = uncheckedTypeID
        self.kind = kind
        self.allowedDiscriminants = allowedDiscriminants
    }
}

public struct AIRClosedEnumContext: Sendable {
    private let schemas: [String: AIRClosedEnumSchema]

    public init(_ schemas: [AIRClosedEnumSchema] = []) throws {
        var indexed: [String: AIRClosedEnumSchema] = [:]
        for schema in schemas {
            guard indexed[schema.typeID] == nil else { throw AIRSwiftError.duplicate("enum schema repeats '\(schema.typeID)'") }
            indexed[schema.typeID] = schema
        }
        self.schemas = indexed
    }

    public func schema(for typeID: String) -> AIRClosedEnumSchema? { schemas[typeID] }

    public static let host: AIRClosedEnumContext = {
        let values: [(String, AIRClosedEnumKind, Set<Int32>)] = [
            ("air.host::ResourceClass", .enumeration, Set(0...5)),
            ("air.host::SourceClass", .enumeration, Set(0...3)),
            ("air.host::ObservationPrecision", .enumeration, Set(0...5)),
            ("air.host::DecisionOutcome", .enumeration, Set(0...2)),
            ("air.host::FailureReason", .errorEnum, Set(0...13)),
            ("air.host::ReceiptOutcome", .enumeration, Set(0...4)),
            ("air.host::TerminalState", .enumeration, Set(0...2))
        ]
        let schemas = values.map { AIRClosedEnumSchema(uncheckedTypeID: $0.0, kind: $0.1, allowedDiscriminants: $0.2) }
        return AIRClosedEnumContext(unchecked: schemas)
    }()

    private init(unchecked schemas: [AIRClosedEnumSchema]) {
        self.schemas = Dictionary(uniqueKeysWithValues: schemas.map { ($0.typeID, $0) })
    }
}

public struct AIREnumValue: Sendable, Equatable {
    public let discriminant: Int32
    public let typeID: String

    public init(discriminant: Int32, typeID: String, context: AIRClosedEnumContext, expectedTypeID: String? = nil, requireErrorEnum: Bool = false) throws {
        self.typeID = try AIRValidation.qualifiedEnumTypeID(typeID)
        guard expectedTypeID == nil || expectedTypeID == typeID,
              let schema = context.schema(for: typeID),
              (!requireErrorEnum || schema.kind == .errorEnum),
              schema.allowedDiscriminants.contains(discriminant) else {
            throw AIRSwiftError.invalid("air.decision.enum_discriminant_invalid", "closed enum discriminant is invalid")
        }
        self.discriminant = discriminant
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws { try .object([("discriminant", .integer(Int64(discriminant))), ("type", .string(typeID))]) }
    }
}

public enum AIRFloatRepresentation: Sendable, Equatable {
    case bits(String)
    case nan
}

public indirect enum AIRTypedValue: Sendable, Equatable {
    case i32(Int32)
    case i64(Int64)
    case f32(AIRFloatRepresentation)
    case f64(AIRFloatRepresentation)
    case bool(Bool)
    case enumeration(AIREnumValue)
    case option(type: AIRFlatTypeReference, value: AIRTypedValue?)
    case result(type: AIRFlatTypeReference, errorType: String, value: ResultValue)

    public enum ResultValue: Sendable, Equatable {
        case ok(AIRTypedValue)
        case err(AIREnumValue)
    }

    public func canonicalValue(expectedType: AIRTypeReference? = nil) throws -> AIRCanonicalValue {
        if let expectedType { try validate(expectedType: expectedType) }
        switch self {
        case let .i32(value): return .integer(Int64(value))
        case let .i64(value): return try .object([("decimal", .string(String(value))), ("type", .string("i64"))])
        case let .bool(value): return .boolean(value)
        case let .f32(value): return try floatingCanonical(value, type: "f32", width: 8)
        case let .f64(value): return try floatingCanonical(value, type: "f64", width: 16)
        case let .enumeration(value): return try value.canonicalValue
        case let .option(type, value):
            let canonicalType = "option<\(type.canonical)>"
            guard let value else { return try .object([("tag", .string("none")), ("type", .string(canonicalType))]) }
            return try .object([("tag", .string("some")), ("type", .string(canonicalType)), ("value", try value.canonicalValue(expectedType: .flat(type)))])
        case let .result(type, errorType, value):
            let canonicalType = "result<\(type.canonical),\(errorType)>"
            switch value {
            case let .ok(payload):
                return try .object([("tag", .string("ok")), ("type", .string(canonicalType)), ("value", try payload.canonicalValue(expectedType: .flat(type)))])
            case let .err(error):
                guard error.typeID == errorType else { throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "result error type mismatches declared error enum") }
                return try .object([("error", try error.canonicalValue), ("tag", .string("err")), ("type", .string(canonicalType))])
            }
        }
    }

    private func validate(expectedType: AIRTypeReference) throws {
        switch expectedType {
        case let .flat(expected):
            switch (expected, self) {
            case (.primitive(.i32), .i32), (.primitive(.i64), .i64), (.primitive(.f32), .f32), (.primitive(.f64), .f64), (.primitive(.bool), .bool): return
            case let (.enumeration(typeID), .enumeration(value)) where typeID == value.typeID: return
            default: throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "typed value does not match expected type")
            }
        case let .option(payload):
            if case let .option(type, _) = self, type == payload { return }
            throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "typed value does not match expected option type")
        case let .result(payload, errorEnum):
            if case let .result(type, errorType, _) = self, type == payload, errorType == errorEnum { return }
            throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "typed value does not match expected result type")
        }
    }

    private func floatingCanonical(_ representation: AIRFloatRepresentation, type: String, width: Int) throws -> AIRCanonicalValue {
        switch representation {
        case .nan: return try .object([("classification", .string("nan")), ("type", .string(type))])
        case let .bits(bits):
            guard bits.count == width, bits.unicodeScalars.allSatisfy({
                ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
            }), !AIRTypedValue.isNaNBits(bits, type: type) else {
                throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "floating bits are invalid or use a non-canonical NaN")
            }
            return try .object([("bits", .string(bits)), ("type", .string(type))])
        }
    }

    private static func isNaNBits(_ bits: String, type: String) -> Bool {
        if type == "f32", let value = UInt32(bits, radix: 16) {
            return (value & 0x7f80_0000) == 0x7f80_0000 && (value & 0x007f_ffff) != 0
        }
        if type == "f64", let value = UInt64(bits, radix: 16) {
            return (value >> 52) & 0x7ff == 0x7ff && (value & 0x000f_ffff_ffff_ffff) != 0
        }
        return true
    }
}

public enum AIRDigestDomain: String, Sendable {
    case canonicalTypedInput = "AIR_CANONICAL_TYPED_INPUT_V1"
    case grantSet = "AIR_GRANT_SET_V1"
    case intent = "AIR_DECISION_INTENT_V1"
    case packageIdentity = "AIR_PACKAGE_IDENTITY_V1"
    case policy = "AIR_POLICY_ARTIFACT_V1"
    case verifiedArtifact = "AIR_VERIFIED_ARTIFACT_V1"
    case decisionEvidence = "AIR_DECISION_EVIDENCE_V1"
    case effectReceipt = "AIR_EFFECT_RECEIPT_V1"
}

public struct AIRPackageIdentity: Sendable, Equatable {
    public let airABILane: String
    public let interfaceDescriptorDigest: AIRDigest
    public let manifestDigest: AIRDigest
    public let verifiedArtifactDigest: AIRDigest

    public init(airABILane: String, interfaceDescriptorDigest: AIRDigest, manifestDigest: AIRDigest, verifiedArtifactDigest: AIRDigest) throws {
        guard ["0.10", "0.11", "0.12"].contains(airABILane) else {
            throw AIRSwiftError.invalid("air.v051.package_identity_invalid", "AIR ABI lane is not admitted")
        }
        self.airABILane = airABILane
        self.interfaceDescriptorDigest = interfaceDescriptorDigest
        self.manifestDigest = manifestDigest
        self.verifiedArtifactDigest = verifiedArtifactDigest
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("air_abi_lane", .string(airABILane)),
                ("interface_descriptor_digest", .string(interfaceDescriptorDigest.value)),
                ("manifest_digest", .string(manifestDigest.value)),
                ("verified_artifact_digest", .string(verifiedArtifactDigest.value))
            ])
        }
    }

    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.packageIdentity.rawValue, canonicalValue) }
}

public struct AIRVerifiedArtifact: Sendable, Equatable {
    public let airABILane: String
    public let artifactBytesDigest: AIRDigest
    public let verifierEvidenceDigest: AIRDigest

    public init(airABILane: String, artifactBytesDigest: AIRDigest, verifierEvidenceDigest: AIRDigest) throws {
        guard ["0.10", "0.11", "0.12"].contains(airABILane) else {
            throw AIRSwiftError.invalid("air.v051.verified_artifact_invalid", "AIR ABI lane is not admitted")
        }
        self.airABILane = airABILane
        self.artifactBytesDigest = artifactBytesDigest
        self.verifierEvidenceDigest = verifierEvidenceDigest
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("air_abi_lane", .string(airABILane)),
                ("artifact_bytes_digest", .string(artifactBytesDigest.value)),
                ("verifier_disposition", .string("accepted")),
                ("verifier_evidence_digest", .string(verifierEvidenceDigest.value))
            ])
        }
    }

    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.verifiedArtifact.rawValue, canonicalValue) }
}
