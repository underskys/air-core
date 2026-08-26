import Foundation
import XCTest
@testable import AIRSwiftCore
@testable import AIRSwiftHostContract
@testable import AIRSwiftRuntime

private struct EvidenceBoundaryBackend: AIRExecutionBackend {
    func evaluate(_ request: AIRRuntimeEvaluationRequest) async throws -> AIRDecision {
        throw EvidenceBoundaryFailure.unused
    }

    enum EvidenceBoundaryFailure: Error { case unused }
}

final class AIRSwiftDecisionEvidenceBoundaryTests: XCTestCase {
    private func digest(_ character: Character) throws -> AIRDigest {
        try AIRDigest("sha256:" + String(repeating: character, count: 64))
    }

    private func generation() throws -> AIRGenerationFence {
        try AIRGenerationFence(domain: "air.runtime", epoch: 7, fenceID: digest("f"))
    }

    private func artifact(abi: String = "0.12") throws -> AIRArtifactEnvelope {
        let bytes = Data("immutable-artifact".utf8)
        let verified = try AIRVerifiedArtifact(airABILane: abi, artifactBytesDigest: AIRDigest.raw(bytes), verifierEvidenceDigest: digest("e"))
        let package = try AIRPackageIdentity(airABILane: abi, interfaceDescriptorDigest: digest("1"), manifestDigest: digest("2"), verifiedArtifactDigest: verified.digest())
        return AIRArtifactEnvelope(artifactBytes: bytes, packageIdentity: package, verifiedArtifact: verified, transport: .optionalPackage)
    }

    private func session(abi: String = "0.12") async throws -> AIRRuntimeSession {
        let value = AIRRuntimeSession(artifact: try artifact(abi: abi), generation: try generation(), backend: EvidenceBoundaryBackend())
        try await value.prepare(configuration: .init(allowCandidateABI012: true))
        return value
    }

    private func scope(resource: AIRResourceClass? = nil) throws -> AIRGrantScope {
        let resource = try resource ?? AIRResourceClass(discriminant: 2)
        return try AIRGrantScope(effectTypes: ["air.effect.example"], maxUses: 1, resourceClasses: [resource], targetClass: "air.target.example")
    }

    private func runtimeMatchedRecord(outcome: AIRDecisionOutcome = .allow, effectiveBudgets: [AIRBudget] = [], effectiveScope: AIROptionalGrantScope? = nil) throws -> AIRDecisionEvidenceRecord {
        let envelope = try artifact()
        let recordScope = try scope()
        return try AIRDecisionEvidenceRecord(
            airABILane: "0.12", canonicalTypedInputDigest: digest("a"), deadline: .none, decisionOutcome: outcome,
            effectiveBudgets: effectiveBudgets, effectiveScope: effectiveScope ?? .some(recordScope), generationFence: try generation(),
            grantSetDigest: digest("b"), intentDigest: digest("c"), packageIdentityDigest: envelope.packageIdentity.digest(), policyDigest: digest("d"),
            policyIdentity: "air.policy.example", reason: .none, requestedBudgets: [], requestedScope: recordScope,
            verifiedArtifactDigest: envelope.verifiedArtifact.digest()
        )
    }

    private func componentsForMissingGrant() throws -> (AIRDecisionEvidenceComponents, AIRDecisionEvidenceRecord) {
        let envelope = try artifact()
        let resource = try AIRResourceClass(discriminant: 2)
        let requestedScope = try scope(resource: resource)
        let intent = try AIRDecisionIntent(
            budgets: [], deadline: .none, effectType: "air.effect.example", generation: try generation(), provenance: digest("a"),
            requiredCapabilities: ["air.capability.example"], typedArguments: [], requestedScope: requestedScope
        )
        let policy = try AIRPolicyArtifact(policyIdentity: "air.policy.example", policyInterfaceDigest: digest("b"), policySourceDigest: digest("c"), policyVersion: "1")
        let components = try AIRDecisionEvidenceComponents(
            canonicalTypedInput: AIRCanonicalTypedInput(observations: []), grantSet: AIRGrantSet(grants: []), intent: intent,
            packageIdentity: envelope.packageIdentity, policyArtifact: policy, verifiedArtifact: envelope.verifiedArtifact
        )
        let record = try AIRDecisionEvidenceRecord(
            airABILane: "0.12", canonicalTypedInputDigest: components.canonicalTypedInput.digest(), deadline: .none, decisionOutcome: .allow,
            effectiveBudgets: [], effectiveScope: .some(requestedScope), generationFence: try generation(),
            grantSetDigest: components.grantSet.digest(), intentDigest: components.intent.digest(), packageIdentityDigest: components.packageIdentity.digest(),
            policyDigest: components.policyArtifact.digest(), policyIdentity: components.policyArtifact.policyIdentity, reason: .none,
            requestedBudgets: components.intent.budgets, requestedScope: components.intent.requestedScope,
            verifiedArtifactDigest: components.verifiedArtifact.digest()
        )
        return (components, record)
    }

    func testDESwift01ArbitraryRecordCannotBecomeTrustedEvidence() throws {
        let record = try runtimeMatchedRecord()
        XCTAssertEqual(record.trustLevel, .schemaOnly)
    }

    func testDESwift02FrozenDE01IsSchemaOnlyAndCannotBindThisRuntime() async throws {
        let de01 = #"""
{"air_abi_lane":"0.11","canonical_typed_input_digest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","contract_version":"air.host-contract/1.0.0-candidate.1","deadline":{"tag":"none","type":"option<air.host::Deadline>"},"decision_outcome":{"discriminant":1,"type":"air.host::DecisionOutcome"},"effective_budgets":[],"effective_scope":{"tag":"none","type":"option<air.host::GrantScope>"},"generation_fence":{"domain":"air.runtime","epoch":{"decimal":"7","type":"i64"},"fence_id":"sha256:2222222222222222222222222222222222222222222222222222222222222222"},"grant_set_digest":"sha256:3333333333333333333333333333333333333333333333333333333333333333","intent_digest":"sha256:4444444444444444444444444444444444444444444444444444444444444444","package_identity_digest":"sha256:5555555555555555555555555555555555555555555555555555555555555555","policy_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","policy_identity":"air.policy.default","reason":{"tag":"some","type":"option<air.host::FailureReason>","value":{"discriminant":1,"type":"air.host::FailureReason"}},"requested_budgets":[{"limit":{"decimal":"4","type":"i64"},"resource_class":{"discriminant":2,"type":"air.host::ResourceClass"}}],"requested_scope":{"effect_types":["air.effect.example"],"max_uses":{"decimal":"1","type":"i64"},"resource_classes":[{"discriminant":2,"type":"air.host::ResourceClass"}],"target_class":"air.target.example"},"verified_artifact_digest":"sha256:7777777777777777777777777777777777777777777777777777777777777777"}
"""#
        let bytes = Data(de01.utf8)
        let record = try AIRDecisionEvidenceRecord.parseCanonicalBytes(bytes)
        XCTAssertEqual(record.trustLevel, .schemaOnly)
        XCTAssertEqual(try record.digest().value, "sha256:74a439506428651773946c8bb6cd4f64ee1d9ce9f68c0e47264a426aa897f165")
        let output = AIRRuntimeProducedDecisionEvidence(canonicalBytes: bytes, declaredDigest: try record.digest())
        let prepared = try await session()
        await XCTAssertThrowsErrorAsync(try await prepared.acceptDecisionEvidence(output))
    }

    func testDESwift03MissingGrantAllowRecordIsOnlyDiagnostic() throws {
        let (components, record) = try componentsForMissingGrant()
        XCTAssertNoThrow(try record.validateDiagnosticComponents(components))
        XCTAssertEqual(record.decisionOutcome, .allow)
        XCTAssertEqual(record.trustLevel, .schemaOnly)
    }

    func testDESwift04CoherentComponentsDoNotUpgradeArbitraryOutcome() throws {
        let (components, record) = try componentsForMissingGrant()
        XCTAssertNoThrow(try record.validateDiagnosticComponents(components))
        XCTAssertEqual(record.trustLevel, .schemaOnly)
    }

    func testDESwift05CoherentComponentsDoNotUpgradeAlteredEffectiveFields() throws {
        let (components, source) = try componentsForMissingGrant()
        let resource = try AIRResourceClass(discriminant: 2)
        let changed = try AIRDecisionEvidenceRecord(
            airABILane: source.airABILane, canonicalTypedInputDigest: source.canonicalTypedInputDigest, deadline: source.deadline,
            decisionOutcome: .allow, effectiveBudgets: [try AIRBudget(limit: 99, resourceClass: resource)], effectiveScope: .some(try scope(resource: resource)),
            generationFence: source.generationFence, grantSetDigest: source.grantSetDigest, intentDigest: source.intentDigest,
            packageIdentityDigest: source.packageIdentityDigest, policyDigest: source.policyDigest, policyIdentity: source.policyIdentity,
            reason: .none, requestedBudgets: source.requestedBudgets, requestedScope: source.requestedScope,
            verifiedArtifactDigest: source.verifiedArtifactDigest
        )
        XCTAssertNoThrow(try changed.validateDiagnosticComponents(components))
        XCTAssertEqual(changed.trustLevel, .schemaOnly)
    }

    func testDESwift06VerifiedRuntimeAdmissionCreatesTrustedEvidence() async throws {
        let record = try runtimeMatchedRecord()
        let output = AIRRuntimeProducedDecisionEvidence(canonicalBytes: try record.canonicalBytes(), declaredDigest: try record.digest())
        let prepared = try await session()
        let trusted = try await prepared.acceptDecisionEvidence(output)
        XCTAssertEqual(trusted.trustLevel, .trustedRuntimeBoundary)
        XCTAssertEqual(trusted.digest, try record.digest())
        XCTAssertEqual(trusted.intentID, record.intentDigest)
    }

    func testDESwift07WrongDigestRejects() async throws {
        let record = try runtimeMatchedRecord()
        let output = AIRRuntimeProducedDecisionEvidence(canonicalBytes: try record.canonicalBytes(), declaredDigest: try digest("9"))
        await XCTAssertThrowsErrorAsync(try await session().acceptDecisionEvidence(output))
    }

    func testDESwift08NoncanonicalBytesReject() async throws {
        let record = try runtimeMatchedRecord()
        let output = AIRRuntimeProducedDecisionEvidence(canonicalBytes: try record.canonicalBytes() + Data(" ".utf8), declaredDigest: try record.digest())
        await XCTAssertThrowsErrorAsync(try await session().acceptDecisionEvidence(output))
    }

    func testDESwift09WrongABIOrContractBindingRejects() async throws {
        let record = try runtimeMatchedRecord()
        let wrongABI = try await session(abi: "0.11")
        let output = AIRRuntimeProducedDecisionEvidence(canonicalBytes: try record.canonicalBytes(), declaredDigest: try record.digest())
        await XCTAssertThrowsErrorAsync(try await wrongABI.acceptDecisionEvidence(output))
        let original = String(decoding: try record.canonicalBytes(), as: UTF8.self)
        let wrongContract = Data(original.replacingOccurrences(of: "candidate.1", with: "candidate.2").utf8)
        let wrongContractOutput = AIRRuntimeProducedDecisionEvidence(canonicalBytes: wrongContract, declaredDigest: AIRDigest.raw(Data(AIRDigestDomain.decisionEvidence.rawValue.utf8) + Data([0]) + wrongContract))
        await XCTAssertThrowsErrorAsync(try await session().acceptDecisionEvidence(wrongContractOutput))
    }

    func testDESwift10ExternalConsumerCannotCompileTrustedConstruction() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = root.appendingPathComponent("Tests/Fixtures/TrustedEvidenceDirectConstruction")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["swift", "build", "--package-path", fixture.path]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        process.waitUntilExit()
        let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        XCTAssertNotEqual(process.terminationStatus, 0)
        XCTAssertTrue(text.contains("AIRTrustedDecisionEvidence") || text.contains("AIRRuntimeProducedDecisionEvidence"))
    }

    func testEffectReceiptRequiresTrustedRuntimeEvidence() async throws {
        let record = try runtimeMatchedRecord()
        let output = AIRRuntimeProducedDecisionEvidence(canonicalBytes: try record.canonicalBytes(), declaredDigest: try record.digest())
        let trusted = try await session().acceptDecisionEvidence(output)
        let receipt = try AIREffectReceipt(
            consumedBudgets: [], trustedDecisionEvidence: trusted, failureReason: .none, generation: trusted.generation,
            hostExecutionID: try digest("e"), intentID: trusted.intentID, outcome: .executed, receiptID: try digest("d"),
            redactedObservationRefs: [], terminalState: .completed
        )
        try receipt.validateBinding(trustedDecisionEvidence: trusted, intentID: trusted.intentID, generation: trusted.generation)
        XCTAssertThrowsError(try receipt.validateBinding(trustedDecisionEvidence: trusted, intentID: digest("9"), generation: trusted.generation))
    }
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
    do {
        _ = try await expression()
        XCTFail("expected an error", file: file, line: line)
    } catch {}
}
