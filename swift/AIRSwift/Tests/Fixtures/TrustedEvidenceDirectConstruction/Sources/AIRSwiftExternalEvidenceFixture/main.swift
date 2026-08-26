import Foundation
import AIRSwiftHostContract
import AIRSwiftRuntime

func directConstructionMustNotCompile() throws {
    let digest = try AIRDigest("sha256:" + String(repeating: "a", count: 64))
    let binding = try AIRDecisionEvidenceSourceBinding(
        airABILane: "0.12", artifactBytesDigest: digest, interfaceDescriptorDigest: digest,
        packageIdentityDigest: digest, verifiedArtifactDigest: digest
    )
    _ = AIRTrustedDecisionEvidence(
        canonicalBytes: Data(), digest: digest,
        generation: try AIRGenerationFence(domain: "air.runtime", epoch: 1, fenceID: digest),
        hostContractVersion: "air.host-contract/1.0.0-candidate.1", intentID: digest, sourceBinding: binding
    )
    _ = AIRRuntimeProducedDecisionEvidence(canonicalBytes: Data(), declaredDigest: digest)
}
