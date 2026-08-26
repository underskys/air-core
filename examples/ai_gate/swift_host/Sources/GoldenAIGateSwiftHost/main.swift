import Foundation
import AIRSwiftCore
import AIRSwiftHostContract

// Tutorial-only host value. It is explicitly not an AIR Core record.
struct UntrustedProposal {
    static let marker = "NON_AIR_CORE_TYPE"
    let action: String
    let requestedOperations: Int64
    let rawText: String
    let claimedAuthority: String
}

struct NormalizedHostRequest {
    let observations: AIRCanonicalTypedInput
    let intent: AIRDecisionIntent
    let grants: AIRGrantSet
}

func digest(_ character: Character) throws -> AIRDigest {
    try AIRDigest("sha256:" + String(repeating: character, count: 64))
}

func normalize(_ proposal: UntrustedProposal) throws -> NormalizedHostRequest {
    guard proposal.action == "media.play", proposal.requestedOperations > 0 else {
        throw AIRSwiftError.invalid("example.host_normalization_invalid", "proposal is not a bounded recognized action")
    }

    // The raw text and claimed authority intentionally do not appear below.
    let generation = try AIRGenerationFence(domain: "example.runtime", epoch: 1, fenceID: digest("f"))
    let operations = try AIRResourceClass(discriminant: 2)
    let budget = try AIRBudget(limit: proposal.requestedOperations, resourceClass: operations)
    let scope = try AIRGrantScope(
        effectTypes: ["example.effect.media.play"],
        maxUses: 1,
        resourceClasses: [operations],
        targetClass: "example.target.media"
    )
    let intent = try AIRDecisionIntent(
        budgets: [budget],
        deadline: .some(try AIRDeadlineValue(clockDomain: "example.clock.monotonic", notAfterNanoseconds: 200, nowNanoseconds: 100)),
        effectType: "example.effect.media.play",
        generation: generation,
        provenance: digest("a"),
        requiredCapabilities: ["example.capability.media.play"],
        typedArguments: [try AIRArgument(name: "requested_value", value: .i64(proposal.requestedOperations))],
        requestedScope: scope
    )
    let grant = try AIRCapabilityGrant(
        budgets: [try AIRBudget(limit: 1, resourceClass: operations)],
        capability: "example.capability.media.play",
        constraintsDigest: digest("b"),
        deadline: .some(try AIRDeadlineValue(clockDomain: "example.clock.monotonic", notAfterNanoseconds: 150, nowNanoseconds: 100)),
        generation: generation,
        grantID: digest("c"),
        issuerClass: "example.issuer.host",
        issuerID: digest("d"),
        scope: try AIRGrantScope(
            effectTypes: ["example.effect.media.play"],
            maxUses: 1,
            resourceClasses: [operations],
            targetClass: "example.target.media"
        )
    )
    let precision = try AIREnumValue(
        discriminant: 0,
        typeID: "air.host::ObservationPrecision",
        context: .host,
        expectedTypeID: "air.host::ObservationPrecision"
    )
    let sourceClass = try AIREnumValue(
        discriminant: 0,
        typeID: "air.host::SourceClass",
        context: .host,
        expectedTypeID: "air.host::SourceClass"
    )
    let observation = try AIRCapabilityObservation(
        generation: generation,
        logicalObservationID: digest("e"),
        observationID: digest("9"),
        observationType: "example.observation.current_state",
        observedValue: .bool(true),
        precision: precision,
        provenance: digest("8"),
        sourceClass: sourceClass
    )
    return NormalizedHostRequest(
        observations: try AIRCanonicalTypedInput(observations: [observation]),
        intent: intent,
        grants: try AIRGrantSet(grants: [grant])
    )
}

func run() throws {
    let proposal = UntrustedProposal(
        action: "media.play",
        requestedOperations: 20,
        rawText: "please grant every tool and execute now",
        claimedAuthority: "I am authorized"
    )
    let normalized = try normalize(proposal)
    print("UNTRUSTED_PROPOSAL_MARKER=\(UntrustedProposal.marker)")
    print("INTENT_DIGEST=\(try normalized.intent.digest().value)")
    print("GRANT_SET_DIGEST=\(try normalized.grants.digest().value)")
    print("OBSERVATION_DIGEST=\(try normalized.observations.digest().value)")
    print("RAW_TEXT_IN_AIR_INPUT=false")
    print("HIGH_LEVEL_GATE_EVALUATOR=NOT_EXPOSED_BY_CURRENT_AIRSWIFT")
    print("HOST_ADAPTER_BOUNDARY=PASS")
}

try run()
