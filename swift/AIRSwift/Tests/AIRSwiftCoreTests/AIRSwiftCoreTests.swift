import XCTest
@testable import AIRSwiftCore

final class AIRSwiftCoreTests: XCTestCase {
    func testSHA256AndDomainDigestMatchFrozenSerializerVector() throws {
        XCTAssertEqual(AIRSHA256.hex(Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        let fixture = try AIRCanonicalJSON.parse(#"{"evidence_digest":"sha256:EXAMPLE","interface_digest":"sha256:EXAMPLE","source_digest":"sha256:EXAMPLE","status":"pass","value_or_failure":{"decimal":"42","type":"i64"},"vector":"N04"}"#)
        XCTAssertEqual(try fixture.canonicalString(), #"{"evidence_digest":"sha256:EXAMPLE","interface_digest":"sha256:EXAMPLE","source_digest":"sha256:EXAMPLE","status":"pass","value_or_failure":{"decimal":"42","type":"i64"},"vector":"N04"}"#)
        XCTAssertEqual(AIRDigest.raw(try fixture.canonicalData()).value, "sha256:f28f4f51f397d490ef68d002ed9ddb07f2f5e7e3ebb6354ea8befa3aec2f9a38")
    }

    func testCanonicalOrderingUsesUnicodeCodePoints() throws {
        let value = try AIRCanonicalValue.object([("😀", .integer(2)), ("\u{e000}", .integer(1))])
        XCTAssertEqual(try value.canonicalString(), "{\"\u{e000}\":1,\"😀\":2}")
    }

    func testTypedValuesPreserveExactIntegerAndFloatRepresentation() throws {
        XCTAssertEqual(try AIRTypedValue.i64(Int64.max).canonicalValue().canonicalString(), #"{"decimal":"9223372036854775807","type":"i64"}"#)
        XCTAssertEqual(try AIRTypedValue.f32(.bits("80000000")).canonicalValue().canonicalString(), #"{"bits":"80000000","type":"f32"}"#)
        XCTAssertEqual(try AIRTypedValue.f64(.nan).canonicalValue().canonicalString(), #"{"classification":"nan","type":"f64"}"#)
        XCTAssertThrowsError(try AIRTypedValue.f32(.bits("7fc00000")).canonicalValue())
    }

    func testClosedEnumContextAndFlatSumsFailClosed() throws {
        let context = try AIRClosedEnumContext([AIRClosedEnumSchema(typeID: "example.policy::Admission", kind: .enumeration, allowedDiscriminants: [0, 1])])
        let allow = try AIREnumValue(discriminant: 1, typeID: "example.policy::Admission", context: context)
        XCTAssertEqual(try AIRTypedValue.option(type: .enumeration("example.policy::Admission"), value: .enumeration(allow)).canonicalValue().canonicalString(), #"{"tag":"some","type":"option<example.policy::Admission>","value":{"discriminant":1,"type":"example.policy::Admission"}}"#)
        XCTAssertThrowsError(try AIREnumValue(discriminant: 2, typeID: "example.policy::Admission", context: context))
        XCTAssertThrowsError(try AIRTypeReference.parse("option<option<i32>>"))
    }
}
