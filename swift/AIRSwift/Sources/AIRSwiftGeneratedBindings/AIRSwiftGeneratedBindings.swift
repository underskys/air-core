import AIRSwiftCore
import AIRSwiftHostContract

public enum AIRTypedInterfaceCandidate {
    public static let airABILane = "0.12"
    public static let schema = "air.typed-interface/0.12-candidate.1"
    public static let hostContractVersion = "air.host-contract/1.0.0-candidate.1"
}

public struct AIRTypedInterfaceCase: Sendable, Equatable {
    public let discriminant: Int32
    public let name: String

    public init(discriminant: Int32, name: String) throws {
        self.discriminant = discriminant
        guard !name.isEmpty, name.unicodeScalars.allSatisfy({ $0.value < 0x80 }) else {
            throw AIRSwiftError.invalid("air.v051.typed_interface_invalid", "enum case name must be ASCII")
        }
        self.name = name
    }

    var canonicalValue: AIRCanonicalValue { get throws { try .object([("discriminant", .integer(Int64(discriminant))), ("name", .string(name))]) } }
}

public struct AIRTypedInterfaceType: Sendable, Equatable {
    public let cases: [AIRTypedInterfaceCase]
    public let kind: AIRClosedEnumKind
    public let typeID: String

    public init(cases: [AIRTypedInterfaceCase], kind: AIRClosedEnumKind, typeID: String, moduleID: String) throws {
        self.typeID = try AIRValidation.qualifiedEnumTypeID(typeID)
        guard self.typeID.hasPrefix("\(moduleID)::") else {
            throw AIRSwiftError.invalid("air.v051.typed_interface_invalid", "type must be declared in descriptor module")
        }
        let normalized = cases.sorted { $0.discriminant == $1.discriminant ? $0.name < $1.name : $0.discriminant < $1.discriminant }
        guard !normalized.isEmpty,
              Set(normalized.map(\.discriminant)).count == normalized.count,
              Set(normalized.map(\.name)).count == normalized.count else {
            throw AIRSwiftError.invalid("air.v051.typed_interface_duplicate", "enum case identity is invalid")
        }
        self.cases = normalized
        self.kind = kind
    }

    public var enumSchema: AIRClosedEnumSchema {
        get throws { try AIRClosedEnumSchema(typeID: typeID, kind: kind, allowedDiscriminants: Set(cases.map(\.discriminant))) }
    }

    var canonicalValue: AIRCanonicalValue {
        get throws { try .object([("cases", .array(try cases.map { try $0.canonicalValue })), ("kind", .string(kind.rawValue)), ("type_id", .string(typeID))]) }
    }
}

public struct AIRTypedInterfaceParameter: Sendable, Equatable {
    public let name: String
    public let type: AIRTypeReference

    public init(name: String, type: String) throws {
        self.name = try AIRValidation.asciiIdentifier(name, label: "parameter name")
        self.type = try AIRTypeReference.parse(type)
    }

    var canonicalValue: AIRCanonicalValue { get throws { try .object([("name", .string(name)), ("type", .string(type.canonical))]) } }
}

public struct AIRTypedInterfaceExport: Sendable, Equatable {
    public let function: String
    public let name: String
    public let parameters: [AIRTypedInterfaceParameter]
    public let returnType: String

    public init(function: String, name: String, parameters: [AIRTypedInterfaceParameter], returnType: String) throws {
        self.function = try AIRValidation.asciiIdentifier(function, label: "function name")
        self.name = try AIRValidation.asciiIdentifier(name, label: "export name")
        guard Set(parameters.map(\.name)).count == parameters.count else { throw AIRSwiftError.duplicate("export parameters have duplicate names") }
        self.parameters = parameters
        if returnType == "void" { self.returnType = returnType }
        else { self.returnType = try AIRTypeReference.parse(returnType).canonical }
    }

    var canonicalValue: AIRCanonicalValue {
        get throws { try .object([
            ("function", .string(function)),
            ("name", .string(name)),
            ("parameters", .array(try parameters.map { try $0.canonicalValue })),
            ("return_type", .string(returnType))
        ]) }
    }
}

public struct AIRTypedInterfaceDescriptor: Sendable, Equatable {
    public let exports: [AIRTypedInterfaceExport]
    public let moduleID: String
    public let types: [AIRTypedInterfaceType]

    public init(moduleID: String, exports: [AIRTypedInterfaceExport], types: [AIRTypedInterfaceType]) throws {
        self.moduleID = try AIRValidation.asciiIdentifier(moduleID, label: "module id")
        let normalizedExports = exports.sorted { $0.name < $1.name }
        guard !normalizedExports.isEmpty,
              Set(normalizedExports.map(\.name)).count == normalizedExports.count,
              Set(normalizedExports.map(\.function)).count == normalizedExports.count else {
            throw AIRSwiftError.invalid("air.v051.typed_interface_duplicate", "typed interface exports are invalid")
        }
        self.exports = normalizedExports
        let normalizedTypes = types.sorted { $0.typeID < $1.typeID }
        guard Set(normalizedTypes.map(\.typeID)).count == normalizedTypes.count else { throw AIRSwiftError.duplicate("typed interface repeats a type") }
        self.types = normalizedTypes
        let schemas = try normalizedTypes.map { try $0.enumSchema }
        let context = try AIRClosedEnumContext(schemas)
        for item in normalizedExports {
            for parameter in item.parameters { try validateReference(parameter.type, context: context) }
            if item.returnType != "void" { try validateReference(AIRTypeReference.parse(item.returnType), context: context) }
        }
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws { try .object([
            ("air_abi_lane", .string(AIRTypedInterfaceCandidate.airABILane)),
            ("exports", .array(try exports.map { try $0.canonicalValue })),
            ("module_id", .string(moduleID)),
            ("schema", .string(AIRTypedInterfaceCandidate.schema)),
            ("types", .array(try types.map { try $0.canonicalValue }))
        ]) }
    }

    public func digest() throws -> AIRDigest { AIRDigest.raw(try canonicalValue.canonicalData()) }

    private func validateReference(_ type: AIRTypeReference, context: AIRClosedEnumContext) throws {
        switch type {
        case let .flat(.enumeration(typeID)):
            guard context.schema(for: typeID) != nil else { throw AIRSwiftError.invalid("air.v051.typed_interface_invalid", "referenced enum is not declared") }
        case let .option(.enumeration(typeID)):
            guard context.schema(for: typeID) != nil else { throw AIRSwiftError.invalid("air.v051.typed_interface_invalid", "referenced option enum is not declared") }
        case let .result(payload, errorEnum):
            if case let .enumeration(typeID) = payload, context.schema(for: typeID) == nil {
                throw AIRSwiftError.invalid("air.v051.typed_interface_invalid", "referenced result payload enum is not declared")
            }
            guard context.schema(for: errorEnum)?.kind == .errorEnum else {
                throw AIRSwiftError.invalid("air.v051.typed_interface_invalid", "result error must be a declared error enum")
            }
        default: return
        }
    }
}

public struct AIRTypedInterfaceIdentity: Sendable, Equatable {
    public let descriptor: AIRTypedInterfaceDescriptor
    public let descriptorDigest: AIRDigest

    public init(descriptor: AIRTypedInterfaceDescriptor) throws {
        self.descriptor = descriptor
        self.descriptorDigest = try descriptor.digest()
    }
}
