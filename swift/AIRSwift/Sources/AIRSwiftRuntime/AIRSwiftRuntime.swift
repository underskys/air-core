import Foundation
import AIRSwiftCore
import AIRSwiftHostContract

public struct AIRCandidateConfiguration: Sendable, Equatable {
    public let allowCandidateABI012: Bool

    public init(allowCandidateABI012: Bool = false) {
        self.allowCandidateABI012 = allowCandidateABI012
    }
}

public enum AIRArtifactTransport: String, Sendable, Equatable {
    case unpacked
    case optionalPackage
}

public struct AIRArtifactEnvelope: Sendable, Equatable {
    public let artifactBytes: Data
    public let packageIdentity: AIRPackageIdentity
    public let verifiedArtifact: AIRVerifiedArtifact
    public let transport: AIRArtifactTransport

    public init(artifactBytes: Data, packageIdentity: AIRPackageIdentity, verifiedArtifact: AIRVerifiedArtifact, transport: AIRArtifactTransport) {
        self.artifactBytes = artifactBytes
        self.packageIdentity = packageIdentity
        self.verifiedArtifact = verifiedArtifact
        self.transport = transport
    }
}

public enum AIRArtifactBoundary {
    public static func validate(_ envelope: AIRArtifactEnvelope, configuration: AIRCandidateConfiguration = .init()) throws {
        guard envelope.packageIdentity.airABILane == envelope.verifiedArtifact.airABILane,
              envelope.packageIdentity.verifiedArtifactDigest == (try envelope.verifiedArtifact.digest()),
              AIRDigest.raw(envelope.artifactBytes) == envelope.verifiedArtifact.artifactBytesDigest else {
            throw AIRSwiftError.invalid("air.v051.artifact_identity_invalid", "artifact identity binding is invalid")
        }
        if envelope.packageIdentity.airABILane == "0.12", !configuration.allowCandidateABI012 {
            throw AIRSwiftError.invalid("air.v051.abi_candidate_disabled", "AIR ABI 0.12 candidate mode is disabled")
        }
    }
}

public protocol AIRArtifactVerifier: Sendable {
    func verify(_ envelope: AIRArtifactEnvelope, configuration: AIRCandidateConfiguration) throws
}

public struct AIRStructuralArtifactVerifier: AIRArtifactVerifier {
    public init() {}
    public func verify(_ envelope: AIRArtifactEnvelope, configuration: AIRCandidateConfiguration) throws {
        try AIRArtifactBoundary.validate(envelope, configuration: configuration)
    }
}

public struct AIRRuntimeEvaluationRequest: Sendable, Equatable {
    public let generation: AIRGenerationFence
    public let intentDigest: AIRDigest

    public init(generation: AIRGenerationFence, intentDigest: AIRDigest) {
        self.generation = generation
        self.intentDigest = intentDigest
    }
}

/// Bytes emitted by the verified AIR runtime implementation. The initializer is
/// package-scoped so consumer code cannot relabel arbitrary schema records as
/// runtime output.
public struct AIRRuntimeProducedDecisionEvidence: Sendable, Equatable {
    public let canonicalBytes: Data
    public let declaredDigest: AIRDigest

    package init(canonicalBytes: Data, declaredDigest: AIRDigest) {
        self.canonicalBytes = canonicalBytes
        self.declaredDigest = declaredDigest
    }
}

public protocol AIRExecutionBackend: Sendable {
    func evaluate(_ request: AIRRuntimeEvaluationRequest) async throws -> AIRDecision
}

public enum AIRRuntimeSessionState: String, Sendable, Equatable {
    case created, verified, ready, evaluating, completed, timedOut, poisoned, quarantined, terminated, replaced, closed
}

public struct AIRRuntimeEvaluationFailure: Sendable, Equatable {
    public let generation: AIRGenerationFence
    public let code: String

    public init(generation: AIRGenerationFence, code: String) throws {
        self.generation = generation
        self.code = try AIRValidation.asciiIdentifier(code, qualified: true, label: "runtime failure code")
    }

    fileprivate init(uncheckedGeneration generation: AIRGenerationFence, code: String) {
        self.generation = generation
        self.code = code
    }
}

public struct AIRSessionQuarantineEvent: Sendable, Equatable {
    public let generation: AIRGenerationFence
    public let reasonCode: String

    public init(generation: AIRGenerationFence, reasonCode: String) throws {
        self.generation = generation
        self.reasonCode = try AIRValidation.asciiIdentifier(reasonCode, qualified: true, label: "quarantine reason")
    }
}

public enum AIRRuntimeEvaluationResult: Sendable, Equatable {
    case decision(AIRDecision)
    case preDecisionFailure(AIRRuntimeEvaluationFailure)
}

public actor AIRRuntimeSession {
    public private(set) var state: AIRRuntimeSessionState = .created

    private let artifact: AIRArtifactEnvelope
    private let generation: AIRGenerationFence
    private let backend: any AIRExecutionBackend

    public init(artifact: AIRArtifactEnvelope, generation: AIRGenerationFence, backend: any AIRExecutionBackend) {
        self.artifact = artifact
        self.generation = generation
        self.backend = backend
    }

    public func prepare(verifier: any AIRArtifactVerifier = AIRStructuralArtifactVerifier(), configuration: AIRCandidateConfiguration = .init()) throws {
        guard state == .created else { throw AIRSwiftError.invalid("air.v051.session_state_invalid", "session must be created before preparation") }
        try verifier.verify(artifact, configuration: configuration)
        state = .verified
        state = .ready
    }

    /// Admits AIR-runtime-produced bytes as opaque trusted evidence after exact
    /// schema, digest, contract, ABI, and artifact identity checks. It does not
    /// re-evaluate policy or alter the decision record.
    public func acceptDecisionEvidence(_ output: AIRRuntimeProducedDecisionEvidence) throws -> AIRTrustedDecisionEvidence {
        guard state == .ready || state == .evaluating || state == .completed else {
            throw AIRSwiftError.invalid("air.v051.runtime_evidence_invalid", "runtime session is not prepared for evidence admission")
        }
        let record = try AIRDecisionEvidenceRecord.parseCanonicalBytes(output.canonicalBytes)
        let digest = try record.digest()
        guard digest == output.declaredDigest else {
            throw AIRSwiftError.invalid("air.v051.decision_evidence_digest_mismatch", "runtime evidence digest mismatches canonical bytes")
        }
        let packageIdentityDigest = try artifact.packageIdentity.digest()
        let verifiedArtifactDigest = try artifact.verifiedArtifact.digest()
        let artifactBytesDigest = AIRDigest.raw(artifact.artifactBytes)
        let sourceBinding = try AIRDecisionEvidenceSourceBinding(
            airABILane: artifact.packageIdentity.airABILane,
            artifactBytesDigest: artifactBytesDigest,
            interfaceDescriptorDigest: artifact.packageIdentity.interfaceDescriptorDigest,
            packageIdentityDigest: packageIdentityDigest,
            verifiedArtifactDigest: verifiedArtifactDigest
        )
        guard record.airABILane == sourceBinding.airABILane,
              record.packageIdentityDigest == sourceBinding.packageIdentityDigest,
              record.verifiedArtifactDigest == sourceBinding.verifiedArtifactDigest,
              record.generationFence == generation else {
            throw AIRSwiftError.invalid("air.v051.runtime_evidence_binding_invalid", "runtime evidence does not bind this ABI, artifact, package, or generation")
        }
        return AIRTrustedDecisionEvidence(
            canonicalBytes: output.canonicalBytes,
            digest: digest,
            generation: record.generationFence,
            hostContractVersion: AIRDecisionEvidenceRecord.contractVersion,
            intentID: record.intentDigest,
            sourceBinding: sourceBinding
        )
    }

    public func evaluate(_ request: AIRRuntimeEvaluationRequest) async -> AIRRuntimeEvaluationResult {
        guard state == .ready else {
            return .preDecisionFailure((try? AIRRuntimeEvaluationFailure(generation: generation, code: "air.runtime.session_not_ready")) ?? impossibleFailure())
        }
        guard request.generation == generation else {
            state = .poisoned
            return .preDecisionFailure((try? AIRRuntimeEvaluationFailure(generation: generation, code: "air.runtime.stale_generation")) ?? impossibleFailure())
        }
        state = .evaluating
        do {
            let decision = try await backend.evaluate(request)
            guard decision.generation == generation else {
                state = .poisoned
                return .preDecisionFailure((try? AIRRuntimeEvaluationFailure(generation: generation, code: "air.runtime.backend_generation_mismatch")) ?? impossibleFailure())
            }
            state = .completed
            return .decision(decision)
        } catch {
            state = .poisoned
            return .preDecisionFailure((try? AIRRuntimeEvaluationFailure(generation: generation, code: "air.runtime.backend_failure")) ?? impossibleFailure())
        }
    }

    public func quarantine(reasonCode: String) throws -> AIRSessionQuarantineEvent {
        guard state == .poisoned || state == .timedOut else {
            throw AIRSwiftError.invalid("air.v051.session_state_invalid", "only poisoned or timed out sessions may be quarantined")
        }
        state = .quarantined
        return try AIRSessionQuarantineEvent(generation: generation, reasonCode: reasonCode)
    }

    public func close() {
        state = .closed
    }

    private func impossibleFailure() -> AIRRuntimeEvaluationFailure {
        AIRRuntimeEvaluationFailure(uncheckedGeneration: generation, code: "air.runtime.internal_failure")
    }
}
