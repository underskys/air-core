import AIRSwiftCore

struct AIRSwiftFrozenVector {
    let id: String
    let domain: AIRDigestDomain
    let literal: String
    let expectedDigest: String
}

enum AIRSwiftFrozenVectors {
    static let values: [AIRSwiftFrozenVector] = [
        AIRSwiftFrozenVector(
            id: "DE01",
            domain: .decisionEvidence,
            literal: #"""
{"air_abi_lane":"0.11","canonical_typed_input_digest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","contract_version":"air.host-contract/1.0.0-candidate.1","deadline":{"tag":"none","type":"option<air.host::Deadline>"},"decision_outcome":{"discriminant":1,"type":"air.host::DecisionOutcome"},"effective_budgets":[],"effective_scope":{"tag":"none","type":"option<air.host::GrantScope>"},"generation_fence":{"domain":"air.runtime","epoch":{"decimal":"7","type":"i64"},"fence_id":"sha256:2222222222222222222222222222222222222222222222222222222222222222"},"grant_set_digest":"sha256:3333333333333333333333333333333333333333333333333333333333333333","intent_digest":"sha256:4444444444444444444444444444444444444444444444444444444444444444","package_identity_digest":"sha256:5555555555555555555555555555555555555555555555555555555555555555","policy_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","policy_identity":"air.policy.default","reason":{"tag":"some","type":"option<air.host::FailureReason>","value":{"discriminant":1,"type":"air.host::FailureReason"}},"requested_budgets":[{"limit":{"decimal":"4","type":"i64"},"resource_class":{"discriminant":2,"type":"air.host::ResourceClass"}}],"requested_scope":{"effect_types":["air.effect.example"],"max_uses":{"decimal":"1","type":"i64"},"resource_classes":[{"discriminant":2,"type":"air.host::ResourceClass"}],"target_class":"air.target.example"},"verified_artifact_digest":"sha256:7777777777777777777777777777777777777777777777777777777777777777"}
"""#,
            expectedDigest: "sha256:74a439506428651773946c8bb6cd4f64ee1d9ce9f68c0e47264a426aa897f165"
        ),
        AIRSwiftFrozenVector(
            id: "OBS01",
            domain: .canonicalTypedInput,
            literal: #"""
{"observations":[{"generation":{"domain":"air.runtime","epoch":{"decimal":"7","type":"i64"},"fence_id":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"},"logical_observation_id":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","observation_id":"sha256:1111111111111111111111111111111111111111111111111111111111111111","observation_type":"air.observation.example","observed_value":{"decimal":"5","type":"i64"},"precision":{"discriminant":0,"type":"air.host::ObservationPrecision"},"provenance":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","source_class":{"discriminant":1,"type":"air.host::SourceClass"}},{"generation":{"domain":"air.runtime","epoch":{"decimal":"7","type":"i64"},"fence_id":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"},"logical_observation_id":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","observation_id":"sha256:2222222222222222222222222222222222222222222222222222222222222222","observation_type":"air.observation.example","observed_value":{"decimal":"8","type":"i64"},"precision":{"discriminant":0,"type":"air.host::ObservationPrecision"},"provenance":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","source_class":{"discriminant":1,"type":"air.host::SourceClass"}}]}
"""#,
            expectedDigest: "sha256:da0dfb66260717d5d93ef006ee9b0cb1d6b4def74bfff7f67e15ae051e94e861"
        ),
        AIRSwiftFrozenVector(
            id: "INT01",
            domain: .intent,
            literal: #"""
{"intent":{"budgets":[{"limit":{"decimal":"4","type":"i64"},"resource_class":{"discriminant":2,"type":"air.host::ResourceClass"}}],"deadline":{"tag":"none","type":"option<air.host::Deadline>"},"effect_type":"air.effect.example","generation":{"domain":"air.runtime","epoch":{"decimal":"7","type":"i64"},"fence_id":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"},"provenance":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","required_capabilities":["air.capability.example"],"typed_arguments":[{"name":"amount","value":{"decimal":"4","type":"i64"}}]},"requested_scope":{"effect_types":["air.effect.example"],"max_uses":{"decimal":"1","type":"i64"},"resource_classes":[{"discriminant":2,"type":"air.host::ResourceClass"}],"target_class":"air.target.example"}}
"""#,
            expectedDigest: "sha256:f5e4b65125c93a93605811e77cb80a48dd1d6bdcc8bfd56563b39b10a028a0d0"
        ),
        AIRSwiftFrozenVector(
            id: "TP01",
            domain: .packageIdentity,
            literal: #"""
{"air_abi_lane":"0.12","interface_descriptor_digest":"sha256:3333333333333333333333333333333333333333333333333333333333333333","manifest_digest":"sha256:4444444444444444444444444444444444444444444444444444444444444444","verified_artifact_digest":"sha256:5555555555555555555555555555555555555555555555555555555555555555"}
"""#,
            expectedDigest: "sha256:c8d769bf321bf04fc61ce7f8eb15a125017758ec58ab6844a672a04bbfd3ea22"
        )
    ]
}
