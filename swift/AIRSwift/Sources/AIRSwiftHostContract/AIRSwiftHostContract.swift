import Foundation
import AIRSwiftCore

public struct AIRResourceClass: Sendable, Equatable, Comparable {
    public let value: AIREnumValue

    public init(discriminant: Int32) throws {
        self.value = try AIREnumValue(
            discriminant: discriminant,
            typeID: "air.host::ResourceClass",
            context: .host,
            expectedTypeID: "air.host::ResourceClass"
        )
    }

    public var discriminant: Int32 { value.discriminant }
    public var canonicalValue: AIRCanonicalValue { get throws { try value.canonicalValue } }
    public static func < (lhs: AIRResourceClass, rhs: AIRResourceClass) -> Bool { lhs.discriminant < rhs.discriminant }
}

public struct AIRGenerationFence: Sendable, Equatable {
    public let domain: String
    public let epoch: Int64
    public let fenceID: AIRDigest

    public init(domain: String, epoch: Int64, fenceID: AIRDigest) throws {
        self.domain = try AIRValidation.asciiIdentifier(domain, qualified: true, label: "generation domain")
        guard epoch >= 0 else { throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "generation epoch must be nonnegative") }
        self.epoch = epoch
        self.fenceID = fenceID
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("domain", .string(domain)),
                ("epoch", try AIRTypedValue.i64(epoch).canonicalValue()),
                ("fence_id", .string(fenceID.value))
            ])
        }
    }
}

public struct AIRDeadlineValue: Sendable, Equatable {
    public let clockDomain: String
    public let notAfterNanoseconds: Int64
    public let nowNanoseconds: Int64

    public init(clockDomain: String, notAfterNanoseconds: Int64, nowNanoseconds: Int64) throws {
        self.clockDomain = try AIRValidation.asciiIdentifier(clockDomain, qualified: true, label: "deadline clock domain")
        guard notAfterNanoseconds >= 0, nowNanoseconds >= 0 else {
            throw AIRSwiftError.invalid("air.v051.deadline_invalid", "deadline values must be nonnegative")
        }
        self.notAfterNanoseconds = notAfterNanoseconds
        self.nowNanoseconds = nowNanoseconds
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("clock_domain", .string(clockDomain)),
                ("not_after_ns", try AIRTypedValue.i64(notAfterNanoseconds).canonicalValue()),
                ("now_ns", try AIRTypedValue.i64(nowNanoseconds).canonicalValue())
            ])
        }
    }
}

public enum AIRDeadline: Sendable, Equatable {
    case none
    case some(AIRDeadlineValue)

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            switch self {
            case .none: return try .object([("tag", .string("none")), ("type", .string("option<air.host::Deadline>"))])
            case let .some(value):
                return try .object([("tag", .string("some")), ("type", .string("option<air.host::Deadline>")), ("value", try value.canonicalValue)])
            }
        }
    }
}

public struct AIRBudget: Sendable, Equatable {
    public let limit: Int64
    public let resourceClass: AIRResourceClass

    public init(limit: Int64, resourceClass: AIRResourceClass) throws {
        guard limit >= 0 else { throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "budget limit must be nonnegative") }
        self.limit = limit
        self.resourceClass = resourceClass
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("limit", try AIRTypedValue.i64(limit).canonicalValue()),
                ("resource_class", try resourceClass.canonicalValue)
            ])
        }
    }
}

public struct AIRGrantScope: Sendable, Equatable {
    public let effectTypes: [String]
    public let maxUses: Int64
    public let resourceClasses: [AIRResourceClass]
    public let targetClass: String

    public init(effectTypes: [String], maxUses: Int64, resourceClasses: [AIRResourceClass], targetClass: String) throws {
        self.effectTypes = try AIRValidation.sortedUniqueASCII(effectTypes, label: "effect types")
        guard maxUses > 0 else { throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "max uses must be positive") }
        self.maxUses = maxUses
        let sortedResources = resourceClasses.sorted()
        guard Set(sortedResources.map(\.discriminant)).count == sortedResources.count else {
            throw AIRSwiftError.duplicate("resource classes have duplicate discriminants")
        }
        self.resourceClasses = sortedResources
        self.targetClass = try AIRValidation.asciiIdentifier(targetClass, qualified: true, label: "target class")
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("effect_types", .array(effectTypes.map(AIRCanonicalValue.string))),
                ("max_uses", try AIRTypedValue.i64(maxUses).canonicalValue()),
                ("resource_classes", .array(try resourceClasses.map { try $0.canonicalValue })),
                ("target_class", .string(targetClass))
            ])
        }
    }
}

public enum AIROptionalGrantScope: Sendable, Equatable {
    case none
    case some(AIRGrantScope)

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            switch self {
            case .none: return try .object([("tag", .string("none")), ("type", .string("option<air.host::GrantScope>"))])
            case let .some(value): return try .object([("tag", .string("some")), ("type", .string("option<air.host::GrantScope>")), ("value", try value.canonicalValue)])
            }
        }
    }
}

public struct AIRCapabilityObservation: Sendable, Equatable {
    public let generation: AIRGenerationFence
    public let logicalObservationID: AIRDigest
    public let observationID: AIRDigest
    public let observationType: String
    public let observedValue: AIRTypedValue
    public let precision: AIREnumValue
    public let provenance: AIRDigest
    public let sourceClass: AIREnumValue

    public init(
        generation: AIRGenerationFence,
        logicalObservationID: AIRDigest,
        observationID: AIRDigest,
        observationType: String,
        observedValue: AIRTypedValue,
        precision: AIREnumValue,
        provenance: AIRDigest,
        sourceClass: AIREnumValue
    ) throws {
        guard precision.typeID == "air.host::ObservationPrecision", sourceClass.typeID == "air.host::SourceClass" else {
            throw AIRSwiftError.invalid("air.v051.typed_value_invalid", "observation enums have invalid types")
        }
        self.generation = generation
        self.logicalObservationID = logicalObservationID
        self.observationID = observationID
        self.observationType = try AIRValidation.asciiIdentifier(observationType, qualified: true, label: "observation type")
        self.observedValue = observedValue
        self.precision = precision
        self.provenance = provenance
        self.sourceClass = sourceClass
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("generation", try generation.canonicalValue),
                ("logical_observation_id", .string(logicalObservationID.value)),
                ("observation_id", .string(observationID.value)),
                ("observation_type", .string(observationType)),
                ("observed_value", try observedValue.canonicalValue()),
                ("precision", try precision.canonicalValue),
                ("provenance", .string(provenance.value)),
                ("source_class", try sourceClass.canonicalValue)
            ])
        }
    }
}

public struct AIRCanonicalTypedInput: Sendable, Equatable {
    public let observations: [AIRCapabilityObservation]

    public init(observations: [AIRCapabilityObservation]) throws {
        self.observations = observations.sorted { $0.observationID.value < $1.observationID.value }
        guard Set(self.observations.map(\.observationID)).count == self.observations.count else {
            throw AIRSwiftError.duplicate("observations have duplicate observation IDs")
        }
    }

    public var canonicalValue: AIRCanonicalValue { get throws { try .object([("observations", .array(try observations.map { try $0.canonicalValue }))]) } }
    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.canonicalTypedInput.rawValue, canonicalValue) }
}

public struct AIRArgument: Sendable, Equatable {
    public let name: String
    public let value: AIRTypedValue

    public init(name: String, value: AIRTypedValue) throws {
        self.name = try AIRValidation.asciiIdentifier(name, label: "argument name")
        self.value = value
    }

    public var canonicalValue: AIRCanonicalValue { get throws { try .object([("name", .string(name)), ("value", try value.canonicalValue())]) } }
}

public struct AIRDecisionIntent: Sendable, Equatable {
    public let budgets: [AIRBudget]
    public let deadline: AIRDeadline
    public let effectType: String
    public let generation: AIRGenerationFence
    public let provenance: AIRDigest
    public let requiredCapabilities: [String]
    public let typedArguments: [AIRArgument]
    public let requestedScope: AIRGrantScope

    public init(
        budgets: [AIRBudget], deadline: AIRDeadline, effectType: String, generation: AIRGenerationFence,
        provenance: AIRDigest, requiredCapabilities: [String], typedArguments: [AIRArgument], requestedScope: AIRGrantScope
    ) throws {
        self.budgets = try AIRDecisionIntent.uniqueBudgets(budgets)
        self.deadline = deadline
        self.effectType = try AIRValidation.asciiIdentifier(effectType, qualified: true, label: "effect type")
        self.generation = generation
        self.provenance = provenance
        self.requiredCapabilities = try AIRValidation.sortedUniqueASCII(requiredCapabilities, label: "required capabilities")
        self.typedArguments = typedArguments.sorted { $0.name < $1.name }
        guard Set(self.typedArguments.map(\.name)).count == self.typedArguments.count else {
            throw AIRSwiftError.duplicate("typed arguments have duplicate names")
        }
        self.requestedScope = requestedScope
    }

    public var intentRecordValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("budgets", .array(try budgets.map { try $0.canonicalValue })),
                ("deadline", try deadline.canonicalValue),
                ("effect_type", .string(effectType)),
                ("generation", try generation.canonicalValue),
                ("provenance", .string(provenance.value)),
                ("required_capabilities", .array(requiredCapabilities.map(AIRCanonicalValue.string))),
                ("typed_arguments", .array(try typedArguments.map { try $0.canonicalValue }))
            ])
        }
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws { try .object([("intent", try intentRecordValue), ("requested_scope", try requestedScope.canonicalValue)]) }
    }

    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.intent.rawValue, canonicalValue) }

    static func uniqueBudgets(_ budgets: [AIRBudget]) throws -> [AIRBudget] {
        let sorted = budgets.sorted { $0.resourceClass < $1.resourceClass }
        guard Set(sorted.map { $0.resourceClass.discriminant }).count == sorted.count else {
            throw AIRSwiftError.duplicate("budgets have duplicate resource classes")
        }
        return sorted
    }
}

public struct AIRCapabilityGrant: Sendable, Equatable {
    public let budgets: [AIRBudget]
    public let capability: String
    public let constraintsDigest: AIRDigest
    public let deadline: AIRDeadline
    public let generation: AIRGenerationFence
    public let grantID: AIRDigest
    public let issuerClass: String
    public let issuerID: AIRDigest
    public let scope: AIRGrantScope

    public init(
        budgets: [AIRBudget], capability: String, constraintsDigest: AIRDigest, deadline: AIRDeadline,
        generation: AIRGenerationFence, grantID: AIRDigest, issuerClass: String, issuerID: AIRDigest, scope: AIRGrantScope
    ) throws {
        self.budgets = try AIRDecisionIntent.uniqueBudgets(budgets)
        self.capability = try AIRValidation.asciiIdentifier(capability, qualified: true, label: "capability")
        self.constraintsDigest = constraintsDigest
        self.deadline = deadline
        self.generation = generation
        self.grantID = grantID
        self.issuerClass = try AIRValidation.asciiIdentifier(issuerClass, qualified: true, label: "issuer class")
        self.issuerID = issuerID
        self.scope = scope
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            try .object([
                ("budgets", .array(try budgets.map { try $0.canonicalValue })),
                ("capability", .string(capability)),
                ("constraints_digest", .string(constraintsDigest.value)),
                ("deadline", try deadline.canonicalValue),
                ("generation", try generation.canonicalValue),
                ("grant_id", .string(grantID.value)),
                ("issuer_class", .string(issuerClass)),
                ("issuer_id", .string(issuerID.value)),
                ("scope", try scope.canonicalValue)
            ])
        }
    }
}

public struct AIRGrantSet: Sendable, Equatable {
    public let grants: [AIRCapabilityGrant]

    public init(grants: [AIRCapabilityGrant]) throws {
        self.grants = grants.sorted { $0.grantID.value < $1.grantID.value }
        guard Set(self.grants.map(\.grantID)).count == self.grants.count else { throw AIRSwiftError.duplicate("grants have duplicate grant IDs") }
    }

    public var canonicalValue: AIRCanonicalValue { get throws { try .object([("grants", .array(try grants.map { try $0.canonicalValue }))]) } }
    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.grantSet.rawValue, canonicalValue) }
}

public struct AIRPolicyArtifact: Sendable, Equatable {
    public let policyIdentity: String
    public let policyInterfaceDigest: AIRDigest
    public let policySourceDigest: AIRDigest
    public let policyVersion: String

    public init(policyIdentity: String, policyInterfaceDigest: AIRDigest, policySourceDigest: AIRDigest, policyVersion: String) throws {
        self.policyIdentity = try AIRValidation.asciiIdentifier(policyIdentity, qualified: true, label: "policy identity")
        guard !policyVersion.isEmpty else { throw AIRSwiftError.invalid("air.v051.policy_invalid", "policy version is required") }
        self.policyInterfaceDigest = policyInterfaceDigest
        self.policySourceDigest = policySourceDigest
        self.policyVersion = policyVersion
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws { try .object([
            ("policy_identity", .string(policyIdentity)),
            ("policy_interface_digest", .string(policyInterfaceDigest.value)),
            ("policy_source_digest", .string(policySourceDigest.value)),
            ("policy_version", .string(policyVersion))
        ]) }
    }
    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.policy.rawValue, canonicalValue) }
}

public enum AIRDecisionOutcome: Int32, Sendable, Equatable { case allow = 0, deny = 1, limit = 2 }

public enum AIRFailureReason: Int32, Sendable, Equatable {
    case capabilityMissing = 0, grantMissing = 1, grantScopeMismatch = 2, staleGeneration = 3
    case deadlineExceeded = 4, budgetExceeded = 5, invalidIntent = 6, unknownCapability = 7
    case unknownEffect = 8, authorityWidening = 9, replayRejected = 10, duplicateRejected = 11
    case invalidReceipt = 12, hostFailure = 13

    public var enumValue: AIREnumValue {
        get throws { try AIREnumValue(discriminant: rawValue, typeID: "air.host::FailureReason", context: .host, expectedTypeID: "air.host::FailureReason", requireErrorEnum: true) }
    }
}

public enum AIROptionalFailureReason: Sendable, Equatable {
    case none
    case some(AIRFailureReason)

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            switch self {
            case .none: return try .object([("tag", .string("none")), ("type", .string("option<air.host::FailureReason>"))])
            case let .some(reason): return try .object([("tag", .string("some")), ("type", .string("option<air.host::FailureReason>")), ("value", try reason.enumValue.canonicalValue)])
            }
        }
    }
}

public struct AIRDecision: Sendable, Equatable {
    public let outcome: AIRDecisionOutcome
    public let reason: AIRFailureReason?
    public let evidenceDigest: AIRDigest
    public let generation: AIRGenerationFence

    public init(outcome: AIRDecisionOutcome, reason: AIRFailureReason?, evidenceDigest: AIRDigest, generation: AIRGenerationFence) throws {
        guard (outcome == .deny) == (reason != nil) else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "deny requires a reason and allow/limit require none")
        }
        self.outcome = outcome
        self.reason = reason
        self.evidenceDigest = evidenceDigest
        self.generation = generation
    }
}

public struct AIRDecisionEvidenceComponents: Sendable, Equatable {
    public let canonicalTypedInput: AIRCanonicalTypedInput
    public let grantSet: AIRGrantSet
    public let intent: AIRDecisionIntent
    public let packageIdentity: AIRPackageIdentity
    public let policyArtifact: AIRPolicyArtifact
    public let verifiedArtifact: AIRVerifiedArtifact

    public init(canonicalTypedInput: AIRCanonicalTypedInput, grantSet: AIRGrantSet, intent: AIRDecisionIntent, packageIdentity: AIRPackageIdentity, policyArtifact: AIRPolicyArtifact, verifiedArtifact: AIRVerifiedArtifact) {
        self.canonicalTypedInput = canonicalTypedInput
        self.grantSet = grantSet
        self.intent = intent
        self.packageIdentity = packageIdentity
        self.policyArtifact = policyArtifact
        self.verifiedArtifact = verifiedArtifact
    }
}

/// A canonical schema record used for conformance and diagnostics only.
/// Constructing this record never confers semantic authority.
public struct AIRDecisionEvidenceRecord: Sendable, Equatable {
    public static let contractVersion = "air.host-contract/1.0.0-candidate.1"

    public let airABILane: String
    public let canonicalTypedInputDigest: AIRDigest
    public let deadline: AIRDeadline
    public let decisionOutcome: AIRDecisionOutcome
    public let effectiveBudgets: [AIRBudget]
    public let effectiveScope: AIROptionalGrantScope
    public let generationFence: AIRGenerationFence
    public let grantSetDigest: AIRDigest
    public let intentDigest: AIRDigest
    public let packageIdentityDigest: AIRDigest
    public let policyDigest: AIRDigest
    public let policyIdentity: String
    public let reason: AIROptionalFailureReason
    public let requestedBudgets: [AIRBudget]
    public let requestedScope: AIRGrantScope
    public let verifiedArtifactDigest: AIRDigest

    public init(
        airABILane: String, canonicalTypedInputDigest: AIRDigest, deadline: AIRDeadline, decisionOutcome: AIRDecisionOutcome,
        effectiveBudgets: [AIRBudget], effectiveScope: AIROptionalGrantScope, generationFence: AIRGenerationFence,
        grantSetDigest: AIRDigest, intentDigest: AIRDigest, packageIdentityDigest: AIRDigest, policyDigest: AIRDigest,
        policyIdentity: String, reason: AIROptionalFailureReason, requestedBudgets: [AIRBudget], requestedScope: AIRGrantScope,
        verifiedArtifactDigest: AIRDigest
    ) throws {
        guard ["0.10", "0.11", "0.12"].contains(airABILane) else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "AIR ABI lane is invalid")
        }
        self.airABILane = airABILane
        self.canonicalTypedInputDigest = canonicalTypedInputDigest
        self.deadline = deadline
        self.decisionOutcome = decisionOutcome
        self.effectiveBudgets = try AIRDecisionIntent.uniqueBudgets(effectiveBudgets)
        self.effectiveScope = effectiveScope
        self.generationFence = generationFence
        self.grantSetDigest = grantSetDigest
        self.intentDigest = intentDigest
        self.packageIdentityDigest = packageIdentityDigest
        self.policyDigest = policyDigest
        self.policyIdentity = try AIRValidation.asciiIdentifier(policyIdentity, qualified: true, label: "policy identity")
        self.reason = reason
        self.requestedBudgets = try AIRDecisionIntent.uniqueBudgets(requestedBudgets)
        self.requestedScope = requestedScope
        self.verifiedArtifactDigest = verifiedArtifactDigest
        try validateShape()
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            let outcome = try AIREnumValue(discriminant: decisionOutcome.rawValue, typeID: "air.host::DecisionOutcome", context: .host, expectedTypeID: "air.host::DecisionOutcome")
            return try .object([
                ("air_abi_lane", .string(airABILane)),
                ("canonical_typed_input_digest", .string(canonicalTypedInputDigest.value)),
                ("contract_version", .string(Self.contractVersion)),
                ("deadline", try deadline.canonicalValue),
                ("decision_outcome", try outcome.canonicalValue),
                ("effective_budgets", .array(try effectiveBudgets.map { try $0.canonicalValue })),
                ("effective_scope", try effectiveScope.canonicalValue),
                ("generation_fence", try generationFence.canonicalValue),
                ("grant_set_digest", .string(grantSetDigest.value)),
                ("intent_digest", .string(intentDigest.value)),
                ("package_identity_digest", .string(packageIdentityDigest.value)),
                ("policy_digest", .string(policyDigest.value)),
                ("policy_identity", .string(policyIdentity)),
                ("reason", try reason.canonicalValue),
                ("requested_budgets", .array(try requestedBudgets.map { try $0.canonicalValue })),
                ("requested_scope", try requestedScope.canonicalValue),
                ("verified_artifact_digest", .string(verifiedArtifactDigest.value))
            ])
        }
    }

    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.decisionEvidence.rawValue, canonicalValue) }

    /// This checks record/component byte bindings for diagnostics. It intentionally
    /// does not evaluate policy or promote this record to trusted evidence.
    public func validateDiagnosticComponents(_ components: AIRDecisionEvidenceComponents) throws {
        guard airABILane == components.packageIdentity.airABILane,
              airABILane == components.verifiedArtifact.airABILane,
              canonicalTypedInputDigest == (try components.canonicalTypedInput.digest()),
              grantSetDigest == (try components.grantSet.digest()),
              intentDigest == (try components.intent.digest()),
              packageIdentityDigest == (try components.packageIdentity.digest()),
              policyDigest == (try components.policyArtifact.digest()),
              verifiedArtifactDigest == (try components.verifiedArtifact.digest()),
              verifiedArtifactDigest == components.packageIdentity.verifiedArtifactDigest,
              policyIdentity == components.policyArtifact.policyIdentity,
              requestedBudgets == components.intent.budgets,
              requestedScope == components.intent.requestedScope,
              generationFence == components.intent.generation else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "DecisionEvidence component binding mismatch")
        }
    }

    private func validateShape() throws {
        let deny = decisionOutcome == .deny
        switch (deny, effectiveScope, reason) {
        case (true, .none, .some) where effectiveBudgets.isEmpty: return
        case (false, .some, .none): return
        default: throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "DecisionEvidence authority shape is invalid")
        }
    }
}

public enum AIRDecisionEvidenceTrustLevel: String, Sendable, Equatable {
    case schemaOnly
    case trustedRuntimeBoundary
}

public extension AIRDecisionEvidenceRecord {
    var trustLevel: AIRDecisionEvidenceTrustLevel { .schemaOnly }

    func canonicalBytes() throws -> Data { try canonicalValue.canonicalData() }

    /// Accepts only the exact canonical JSON representation of the frozen record.
    static func parseCanonicalBytes(_ bytes: Data) throws -> AIRDecisionEvidenceRecord {
        guard let text = String(data: bytes, encoding: .utf8) else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "DecisionEvidence bytes must be UTF-8")
        }
        let value = try AIRCanonicalJSON.parse(text)
        guard try value.canonicalData() == bytes else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_noncanonical", "DecisionEvidence bytes are not canonical")
        }
        let record = try AIRDecisionEvidenceRecordDecoder.decode(value)
        guard try record.canonicalBytes() == bytes else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_noncanonical", "DecisionEvidence record does not round-trip canonically")
        }
        return record
    }
}

/// The identity context that a verified runtime supplies when admitting evidence.
/// It is public data, but cannot construct trusted evidence by itself.
public struct AIRDecisionEvidenceSourceBinding: Sendable, Equatable {
    public let airABILane: String
    public let artifactBytesDigest: AIRDigest
    public let interfaceDescriptorDigest: AIRDigest
    public let packageIdentityDigest: AIRDigest
    public let verifiedArtifactDigest: AIRDigest

    public init(airABILane: String, artifactBytesDigest: AIRDigest, interfaceDescriptorDigest: AIRDigest, packageIdentityDigest: AIRDigest, verifiedArtifactDigest: AIRDigest) throws {
        guard ["0.10", "0.11", "0.12"].contains(airABILane) else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "AIR ABI lane is invalid")
        }
        self.airABILane = airABILane
        self.artifactBytesDigest = artifactBytesDigest
        self.interfaceDescriptorDigest = interfaceDescriptorDigest
        self.packageIdentityDigest = packageIdentityDigest
        self.verifiedArtifactDigest = verifiedArtifactDigest
    }
}

/// Opaque semantic evidence admitted only by the AIRSwift runtime boundary.
/// It communicates verified provenance, not a second Swift policy decision.
public struct AIRTrustedDecisionEvidence: Sendable, Equatable {
    public let canonicalBytes: Data
    public let digest: AIRDigest
    public let generation: AIRGenerationFence
    public let hostContractVersion: String
    public let intentID: AIRDigest
    public let sourceBinding: AIRDecisionEvidenceSourceBinding
    public var trustLevel: AIRDecisionEvidenceTrustLevel { .trustedRuntimeBoundary }

    package init(canonicalBytes: Data, digest: AIRDigest, generation: AIRGenerationFence, hostContractVersion: String, intentID: AIRDigest, sourceBinding: AIRDecisionEvidenceSourceBinding) {
        self.canonicalBytes = canonicalBytes
        self.digest = digest
        self.generation = generation
        self.hostContractVersion = hostContractVersion
        self.intentID = intentID
        self.sourceBinding = sourceBinding
    }
}

private enum AIRDecisionEvidenceRecordDecoder {
    private static let recordKeys: Set<String> = [
        "air_abi_lane", "canonical_typed_input_digest", "contract_version", "deadline", "decision_outcome",
        "effective_budgets", "effective_scope", "generation_fence", "grant_set_digest", "intent_digest",
        "package_identity_digest", "policy_digest", "policy_identity", "reason", "requested_budgets",
        "requested_scope", "verified_artifact_digest"
    ]

    static func decode(_ value: AIRCanonicalValue) throws -> AIRDecisionEvidenceRecord {
        let fields = try object(value, exactKeys: recordKeys, label: "DecisionEvidence")
        let contractVersion = try string(fields, "contract_version")
        guard contractVersion == AIRDecisionEvidenceRecord.contractVersion else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "Host Contract version is not accepted")
        }
        let outcomeValue = try enumValue(fields["decision_outcome"]!, expectedType: "air.host::DecisionOutcome")
        guard let outcome = AIRDecisionOutcome(rawValue: outcomeValue.discriminant) else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "Decision outcome discriminant is invalid")
        }
        return try AIRDecisionEvidenceRecord(
            airABILane: try string(fields, "air_abi_lane"),
            canonicalTypedInputDigest: try digest(fields, "canonical_typed_input_digest"),
            deadline: try deadline(fields["deadline"]!),
            decisionOutcome: outcome,
            effectiveBudgets: try budgets(fields["effective_budgets"]!),
            effectiveScope: try optionalScope(fields["effective_scope"]!),
            generationFence: try generation(fields["generation_fence"]!),
            grantSetDigest: try digest(fields, "grant_set_digest"),
            intentDigest: try digest(fields, "intent_digest"),
            packageIdentityDigest: try digest(fields, "package_identity_digest"),
            policyDigest: try digest(fields, "policy_digest"),
            policyIdentity: try string(fields, "policy_identity"),
            reason: try optionalFailureReason(fields["reason"]!),
            requestedBudgets: try budgets(fields["requested_budgets"]!),
            requestedScope: try scope(fields["requested_scope"]!),
            verifiedArtifactDigest: try digest(fields, "verified_artifact_digest")
        )
    }

    private static func object(_ value: AIRCanonicalValue, exactKeys: Set<String>, label: String) throws -> [String: AIRCanonicalValue] {
        guard case let .object(object) = value else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "\(label) must be an object")
        }
        let keys = Set(object.fields.map(\.0))
        guard keys == exactKeys, object.fields.count == exactKeys.count else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "\(label) has an unknown or missing field")
        }
        return Dictionary(uniqueKeysWithValues: object.fields)
    }

    private static func string(_ fields: [String: AIRCanonicalValue], _ key: String) throws -> String {
        guard let value = fields[key], case let .string(string) = value else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "\(key) must be a string")
        }
        return string
    }

    private static func digest(_ fields: [String: AIRCanonicalValue], _ key: String) throws -> AIRDigest {
        try AIRDigest(try string(fields, key))
    }

    private static func enumValue(_ value: AIRCanonicalValue, expectedType: String) throws -> AIREnumValue {
        let fields = try object(value, exactKeys: ["discriminant", "type"], label: expectedType)
        guard case let .integer(raw) = fields["discriminant"], raw >= Int64(Int32.min), raw <= Int64(Int32.max),
              try string(fields, "type") == expectedType else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "\(expectedType) is invalid")
        }
        return try AIREnumValue(discriminant: Int32(raw), typeID: expectedType, context: .host, expectedTypeID: expectedType)
    }

    private static func typedI64(_ value: AIRCanonicalValue) throws -> Int64 {
        let fields = try object(value, exactKeys: ["decimal", "type"], label: "i64")
        let decimal = try string(fields, "decimal")
        guard try string(fields, "type") == "i64", let parsed = Int64(decimal), String(parsed) == decimal else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "i64 is not canonical")
        }
        return parsed
    }

    private static func generation(_ value: AIRCanonicalValue) throws -> AIRGenerationFence {
        let fields = try object(value, exactKeys: ["domain", "epoch", "fence_id"], label: "generation_fence")
        return try AIRGenerationFence(domain: try string(fields, "domain"), epoch: try typedI64(fields["epoch"]!), fenceID: try digest(fields, "fence_id"))
    }

    private static func deadline(_ value: AIRCanonicalValue) throws -> AIRDeadline {
        let fields = try optionFields(value, type: "option<air.host::Deadline>")
        guard try string(fields, "tag") == "some" else { return .none }
        let payload = try object(fields["value"]!, exactKeys: ["clock_domain", "not_after_ns", "now_ns"], label: "deadline")
        return try .some(AIRDeadlineValue(clockDomain: try string(payload, "clock_domain"), notAfterNanoseconds: try typedI64(payload["not_after_ns"]!), nowNanoseconds: try typedI64(payload["now_ns"]!)))
    }

    private static func scope(_ value: AIRCanonicalValue) throws -> AIRGrantScope {
        let fields = try object(value, exactKeys: ["effect_types", "max_uses", "resource_classes", "target_class"], label: "GrantScope")
        guard case let .array(effectValues) = fields["effect_types"], case let .array(resourceValues) = fields["resource_classes"] else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "GrantScope collections are invalid")
        }
        let effects = try effectValues.map { item -> String in
            guard case let .string(value) = item else { throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "effect type must be a string") }
            return value
        }
        let resources = try resourceValues.map { item -> AIRResourceClass in
            let value = try enumValue(item, expectedType: "air.host::ResourceClass")
            return try AIRResourceClass(discriminant: value.discriminant)
        }
        return try AIRGrantScope(effectTypes: effects, maxUses: try typedI64(fields["max_uses"]!), resourceClasses: resources, targetClass: try string(fields, "target_class"))
    }

    private static func optionalScope(_ value: AIRCanonicalValue) throws -> AIROptionalGrantScope {
        let fields = try optionFields(value, type: "option<air.host::GrantScope>")
        return try string(fields, "tag") == "none" ? .none : .some(scope(fields["value"]!))
    }

    private static func optionalFailureReason(_ value: AIRCanonicalValue) throws -> AIROptionalFailureReason {
        let fields = try optionFields(value, type: "option<air.host::FailureReason>")
        guard try string(fields, "tag") == "some" else { return .none }
        let enumValue = try enumValue(fields["value"]!, expectedType: "air.host::FailureReason")
        guard let reason = AIRFailureReason(rawValue: enumValue.discriminant) else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "FailureReason discriminant is invalid")
        }
        return .some(reason)
    }

    private static func optionFields(_ value: AIRCanonicalValue, type: String) throws -> [String: AIRCanonicalValue] {
        guard case let .object(object) = value else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "\(type) must be an object")
        }
        let fields = Dictionary(uniqueKeysWithValues: object.fields)
        let tag = try string(fields, "tag")
        let expected = tag == "none" ? Set(["tag", "type"]) : tag == "some" ? Set(["tag", "type", "value"]) : Set<String>()
        guard Set(object.fields.map(\.0)) == expected, object.fields.count == expected.count, try string(fields, "type") == type else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "\(type) is not canonical")
        }
        return fields
    }

    private static func budget(_ value: AIRCanonicalValue) throws -> AIRBudget {
        let fields = try object(value, exactKeys: ["limit", "resource_class"], label: "Budget")
        let resource = try enumValue(fields["resource_class"]!, expectedType: "air.host::ResourceClass")
        return try AIRBudget(limit: typedI64(fields["limit"]!), resourceClass: AIRResourceClass(discriminant: resource.discriminant))
    }

    private static func budgets(_ value: AIRCanonicalValue) throws -> [AIRBudget] {
        guard case let .array(values) = value else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_invalid", "budgets must be an array")
        }
        return try values.map(budget)
    }
}

public enum AIRReceiptOutcome: Int32, Sendable, Equatable { case executed = 0, refused = 1, cancelled = 2, failed = 3, notAttempted = 4 }
public enum AIRTerminalState: Int32, Sendable, Equatable { case completed = 0, cancelled = 1, failed = 2 }

public struct AIREffectReceipt: Sendable, Equatable {
    public let consumedBudgets: [AIRBudget]
    public let decisionEvidenceDigest: AIRDigest
    public let failureReason: AIROptionalFailureReason
    public let generation: AIRGenerationFence
    public let hostExecutionID: AIRDigest
    public let intentID: AIRDigest
    public let outcome: AIRReceiptOutcome
    public let receiptID: AIRDigest
    public let redactedObservationRefs: [AIRDigest]
    public let terminalState: AIRTerminalState

    public init(
        consumedBudgets: [AIRBudget], trustedDecisionEvidence: AIRTrustedDecisionEvidence, failureReason: AIROptionalFailureReason,
        generation: AIRGenerationFence, hostExecutionID: AIRDigest, intentID: AIRDigest, outcome: AIRReceiptOutcome,
        receiptID: AIRDigest, redactedObservationRefs: [AIRDigest], terminalState: AIRTerminalState
    ) throws {
        self.consumedBudgets = try AIRDecisionIntent.uniqueBudgets(consumedBudgets)
        self.decisionEvidenceDigest = trustedDecisionEvidence.digest
        self.failureReason = failureReason
        self.generation = generation
        self.hostExecutionID = hostExecutionID
        guard intentID == trustedDecisionEvidence.intentID, generation == trustedDecisionEvidence.generation else {
            throw AIRSwiftError.invalid("air.v051.receipt_binding_invalid", "EffectReceipt must bind the trusted evidence intent and generation")
        }
        self.intentID = intentID
        self.outcome = outcome
        self.receiptID = receiptID
        self.redactedObservationRefs = redactedObservationRefs.sorted { $0.value < $1.value }
        guard Set(self.redactedObservationRefs).count == self.redactedObservationRefs.count else {
            throw AIRSwiftError.duplicate("redacted observation references have duplicate digests")
        }
        self.terminalState = terminalState
        if outcome == .executed, case .some = failureReason {
            throw AIRSwiftError.invalid("air.v051.receipt_invalid", "executed receipt cannot carry a failure reason")
        }
    }

    public var canonicalValue: AIRCanonicalValue {
        get throws {
            let outcomeValue = try AIREnumValue(discriminant: outcome.rawValue, typeID: "air.host::ReceiptOutcome", context: .host, expectedTypeID: "air.host::ReceiptOutcome")
            let stateValue = try AIREnumValue(discriminant: terminalState.rawValue, typeID: "air.host::TerminalState", context: .host, expectedTypeID: "air.host::TerminalState")
            return try .object([
                ("consumed_budgets", .array(try consumedBudgets.map { try $0.canonicalValue })),
                ("decision_evidence_digest", .string(decisionEvidenceDigest.value)),
                ("failure_reason", try failureReason.canonicalValue),
                ("generation", try generation.canonicalValue),
                ("host_execution_id", .string(hostExecutionID.value)),
                ("intent_id", .string(intentID.value)),
                ("outcome", try outcomeValue.canonicalValue),
                ("receipt_id", .string(receiptID.value)),
                ("redacted_observation_refs", .array(redactedObservationRefs.map { .string($0.value) })),
                ("terminal_state", try stateValue.canonicalValue)
            ])
        }
    }

    public func digest() throws -> AIRDigest { try AIRDigest.domain(AIRDigestDomain.effectReceipt.rawValue, canonicalValue) }

    public func validateBinding(trustedDecisionEvidence: AIRTrustedDecisionEvidence, intentID: AIRDigest, generation: AIRGenerationFence) throws {
        guard self.decisionEvidenceDigest == trustedDecisionEvidence.digest, self.intentID == intentID,
              self.generation == generation, self.intentID == trustedDecisionEvidence.intentID,
              self.generation == trustedDecisionEvidence.generation else {
            throw AIRSwiftError.invalid("air.v051.receipt_binding_invalid", "EffectReceipt decision, intent, or generation binding mismatches")
        }
    }
}

public enum AIRContractFacadeDisposition: String, Sendable {
    case deferredRequiresSeparateRFC = "DEFERRED_REQUIRES_SEPARATE_RFC"
}
