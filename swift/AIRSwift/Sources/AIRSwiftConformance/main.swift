import Foundation
import AIRSwiftCore

private struct AIRSwiftConformanceResult {
    let vectorID: String
    let expected: String
    let actual: String
    let pass: String
}

private func emit(_ result: AIRSwiftConformanceResult) {
    print("VECTOR_ID=\(result.vectorID)")
    print("EXPECTED=\(result.expected)")
    print("ACTUAL=\(result.actual)")
    print("PASS=\(result.pass)")
}

private func runFrozenLiteral(_ vector: AIRSwiftFrozenVector) -> AIRSwiftConformanceResult {
    do {
        let parsed = try AIRCanonicalJSON.parse(vector.literal)
        let canonical = try parsed.canonicalString()
        let digest = try AIRDigest.domain(vector.domain.rawValue, parsed).value
        let passed = canonical == vector.literal && digest == vector.expectedDigest
        return AIRSwiftConformanceResult(
            vectorID: vector.id,
            expected: vector.expectedDigest,
            actual: passed ? digest : "canonical_or_digest_mismatch:\(digest)",
            pass: passed ? "true" : "false"
        )
    } catch {
        return AIRSwiftConformanceResult(vectorID: vector.id, expected: vector.expectedDigest, actual: "swift_error", pass: "false")
    }
}

private let frozenFixtureSHA256 = "sha256:8f9bc31ec07f9268197d77926fb5203b89b2d050836b2bed0a69fdedaa435a8d"

private func frozenFixtureURL() -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("fixtures/v051/conformance/typed_decisions_numerics_clarified.json")
}

private func frozenSubcase(_ id: String) throws -> [String: Any] {
    let data = try Data(contentsOf: frozenFixtureURL())
    guard AIRDigest.raw(data).value == frozenFixtureSHA256,
          let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          root["STATUS"] as? String == "HUMAN_CLARIFIED_CANDIDATE",
          root["PARENT_V2_JSON_SHA256"] as? String == "d916aa9b3c9a69d14d1e344f04abc708e578643ef3e4dd5daa5c5722a1d31f3a",
          root["SEMANTIC_FIXTURE_CHANGES"] as? Int == 0,
          root["UNAUTHORIZED_V1_FIXTURE_CHANGES"] as? Int == 0,
          let rows = root["SUBCASES"] as? [[String: Any]],
          let row = rows.first(where: { $0["SUBCASE_ID"] as? String == id }) else {
        throw AIRSwiftError.invalid("air.v051.frozen_fixture_invalid", "frozen conformance fixture is unavailable or has the wrong identity")
    }
    return row
}

private func runFrozenTypedValue(_ id: String, value: AIRTypedValue) -> AIRSwiftConformanceResult {
    do {
        let row = try frozenSubcase(id)
        guard let expectedBytes = row["EXPECTED_CANONICAL_BYTES"] as? String,
              let expectedDigest = row["EXPECTED_RAW_SHA256"] as? String else {
            throw AIRSwiftError.invalid("air.v051.frozen_fixture_invalid", "\(id) has no literal fixture")
        }
        let canonical = try value.canonicalValue().canonicalString()
        let actualDigest = AIRDigest.raw(Data(canonical.utf8)).value
        let passed = canonical == expectedBytes && actualDigest == expectedDigest
        return AIRSwiftConformanceResult(
            vectorID: id,
            expected: expectedDigest,
            actual: passed ? actualDigest : "canonical_or_digest_mismatch:\(actualDigest)",
            pass: passed ? "true" : "false"
        )
    } catch {
        return AIRSwiftConformanceResult(vectorID: id, expected: "frozen fixture", actual: "swift_fixture_error", pass: "false")
    }
}

var failures = 0
for vector in AIRSwiftFrozenVectors.values {
    let result = runFrozenLiteral(vector)
    emit(result)
    if result.pass != "true" { failures += 1 }
}

for (id, value) in [
    ("H02-C01", AIRTypedValue.i64(9_007_199_254_740_993)),
    ("H02-C02", AIRTypedValue.i64(Int64.min)),
    ("H03-C01", AIRTypedValue.f32(.bits("00000000"))),
    ("H03-C02", AIRTypedValue.f32(.bits("80000000"))),
    ("H04-C01", AIRTypedValue.f32(.nan))
] {
    let result = runFrozenTypedValue(id, value: value)
    emit(result)
    if result.pass != "true" { failures += 1 }
}

if failures > 0 {
    Foundation.exit(1)
}
