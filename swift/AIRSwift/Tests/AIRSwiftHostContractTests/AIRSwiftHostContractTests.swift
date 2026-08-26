import XCTest
@testable import AIRSwiftCore
@testable import AIRSwiftHostContract

final class AIRSwiftHostContractTests: XCTestCase {
    private func digest(_ character: Character) throws -> AIRDigest {
        try AIRDigest("sha256:" + String(repeating: character, count: 64))
    }

    func testFrozenIntentAndPackageIdentityBytes() throws {
        let generation = try AIRGenerationFence(domain: "air.runtime", epoch: 7, fenceID: digest("f"))
        let resource = try AIRResourceClass(discriminant: 2)
        let budget = try AIRBudget(limit: 4, resourceClass: resource)
        let scope = try AIRGrantScope(effectTypes: ["air.effect.example"], maxUses: 1, resourceClasses: [resource], targetClass: "air.target.example")
        let intent = try AIRDecisionIntent(
            budgets: [budget], deadline: .none, effectType: "air.effect.example", generation: generation,
            provenance: digest("a"), requiredCapabilities: ["air.capability.example"],
            typedArguments: [try AIRArgument(name: "amount", value: .i64(4))], requestedScope: scope
        )
        XCTAssertEqual(try intent.canonicalValue.canonicalString(), #"{"intent":{"budgets":[{"limit":{"decimal":"4","type":"i64"},"resource_class":{"discriminant":2,"type":"air.host::ResourceClass"}}],"deadline":{"tag":"none","type":"option<air.host::Deadline>"},"effect_type":"air.effect.example","generation":{"domain":"air.runtime","epoch":{"decimal":"7","type":"i64"},"fence_id":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"},"provenance":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","required_capabilities":["air.capability.example"],"typed_arguments":[{"name":"amount","value":{"decimal":"4","type":"i64"}}]},"requested_scope":{"effect_types":["air.effect.example"],"max_uses":{"decimal":"1","type":"i64"},"resource_classes":[{"discriminant":2,"type":"air.host::ResourceClass"}],"target_class":"air.target.example"}}"#)
        XCTAssertEqual(try intent.digest().value, "sha256:f5e4b65125c93a93605811e77cb80a48dd1d6bdcc8bfd56563b39b10a028a0d0")

        let package = try AIRPackageIdentity(airABILane: "0.12", interfaceDescriptorDigest: digest("3"), manifestDigest: digest("4"), verifiedArtifactDigest: digest("5"))
        XCTAssertEqual(try package.digest().value, "sha256:c8d769bf321bf04fc61ce7f8eb15a125017758ec58ab6844a672a04bbfd3ea22")
    }

    func testDecisionEvidenceRecordRemainsSchemaOnly() throws {
        let generation = try AIRGenerationFence(domain: "air.runtime", epoch: 1, fenceID: digest("f"))
        let resource = try AIRResourceClass(discriminant: 2)
        let scope = try AIRGrantScope(effectTypes: ["air.effect.example"], maxUses: 1, resourceClasses: [resource], targetClass: "air.target.example")
        let record = try AIRDecisionEvidenceRecord(
            airABILane: "0.12", canonicalTypedInputDigest: digest("1"), deadline: .none, decisionOutcome: .allow,
            effectiveBudgets: [], effectiveScope: .some(scope), generationFence: generation,
            grantSetDigest: digest("2"), intentDigest: digest("3"), packageIdentityDigest: digest("4"), policyDigest: digest("5"),
            policyIdentity: "air.policy.example", reason: .none, requestedBudgets: [], requestedScope: scope,
            verifiedArtifactDigest: digest("6")
        )
        XCTAssertEqual(record.trustLevel, .schemaOnly)
        XCTAssertEqual(try AIRDecisionEvidenceRecord.parseCanonicalBytes(record.canonicalBytes()).trustLevel, .schemaOnly)
    }
}
