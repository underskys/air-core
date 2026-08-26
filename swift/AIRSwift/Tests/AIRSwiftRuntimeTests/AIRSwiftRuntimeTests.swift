import Foundation
import XCTest
@testable import AIRSwiftCore
@testable import AIRSwiftHostContract
@testable import AIRSwiftRuntime
@testable import AIRSwiftGeneratedBindings

private struct FailingBackend: AIRExecutionBackend {
    enum Failure: Error { case expected }
    func evaluate(_ request: AIRRuntimeEvaluationRequest) async throws -> AIRDecision { throw Failure.expected }
}

final class AIRSwiftRuntimeTests: XCTestCase {
    private func digest(_ character: Character) throws -> AIRDigest {
        try AIRDigest("sha256:" + String(repeating: character, count: 64))
    }

    private func artifact() throws -> AIRArtifactEnvelope {
        let bytes = Data("immutable-artifact".utf8)
        let verified = try AIRVerifiedArtifact(airABILane: "0.12", artifactBytesDigest: AIRDigest.raw(bytes), verifierEvidenceDigest: digest("e"))
        let package = try AIRPackageIdentity(airABILane: "0.12", interfaceDescriptorDigest: digest("1"), manifestDigest: digest("2"), verifiedArtifactDigest: verified.digest())
        return AIRArtifactEnvelope(artifactBytes: bytes, packageIdentity: package, verifiedArtifact: verified, transport: .optionalPackage)
    }

    func testCandidateArtifactIsFailClosedByDefault() throws {
        let envelope = try artifact()
        XCTAssertThrowsError(try AIRArtifactBoundary.validate(envelope))
        XCTAssertNoThrow(try AIRArtifactBoundary.validate(envelope, configuration: .init(allowCandidateABI012: true)))
    }

    func testPreDecisionFailureCannotBecomeReceipt() async throws {
        let envelope = try artifact()
        let generation = try AIRGenerationFence(domain: "air.runtime", epoch: 1, fenceID: digest("f"))
        let session = AIRRuntimeSession(artifact: envelope, generation: generation, backend: FailingBackend())
        try await session.prepare(configuration: .init(allowCandidateABI012: true))
        let request = AIRRuntimeEvaluationRequest(generation: generation, intentDigest: try digest("a"))
        let result = await session.evaluate(request)
        guard case let .preDecisionFailure(failure) = result else { return XCTFail("backend failure must be containment evidence") }
        XCTAssertEqual(failure.code, "air.runtime.backend_failure")
        let state = await session.state
        XCTAssertEqual(state, .poisoned)
        let quarantine = try await session.quarantine(reasonCode: "air.runtime.containment")
        XCTAssertEqual(quarantine.generation, generation)
    }

    func testTypedInterfaceIdentityIsCandidateOnlyAndProductNeutral() throws {
        let enumType = try AIRTypedInterfaceType(
            cases: [try AIRTypedInterfaceCase(discriminant: 1, name: "allow"), try AIRTypedInterfaceCase(discriminant: 0, name: "deny")],
            kind: .enumeration, typeID: "example.policy::Admission", moduleID: "example.policy"
        )
        let descriptor = try AIRTypedInterfaceDescriptor(
            moduleID: "example.policy",
            exports: [try AIRTypedInterfaceExport(function: "decide", name: "decide", parameters: [try AIRTypedInterfaceParameter(name: "value", type: "i32")], returnType: "example.policy::Admission")],
            types: [enumType]
        )
        let identity = try AIRTypedInterfaceIdentity(descriptor: descriptor)
        XCTAssertEqual(identity.descriptorDigest.value, "sha256:876486b6fc1053a0a11c9649eff901a58a4bb5fadcfb402a601c217ae828dfbd")
    }
}
