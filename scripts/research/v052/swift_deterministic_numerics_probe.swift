import Foundation

func hex64(_ value: Double) -> String {
    String(format: "%016llx", value.bitPattern)
}

func json(_ values: [String: String]) {
    let data = try! JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

let halfway = Double(sign: .plus, exponent: -53, significand: 1)
let oneThird = 1.0 / 3.0
let i64Overflow = Int64.max.addingReportingOverflow(1)
let i64ProductOverflow = Int64.max.multipliedReportingOverflow(by: 2)
let dynamicMin = Int64("-9223372036854775808")!
let dynamicNegativeOne = Int64("-1")!
let i64DivisionOverflow = dynamicMin.dividedReportingOverflow(by: dynamicNegativeOne)
let scale: Int64 = 1_000
let scaledProduct = Int64(1_500).multipliedReportingOverflow(by: Int64(2_000))
let scaledDivision = Int64(1_500).multipliedReportingOverflow(by: scale)

json([
    "probe_kind": "native_swift_ieee_and_int64_probe_not_swift_wasm",
    "swift_wasm_backend": "NOT_PRESENT_IN_AIRSWIFT",
    "f64_plus_zero_bits": hex64(0.0),
    "f64_minus_zero_bits": hex64(-0.0),
    "f64_normal_bits": hex64(1.5),
    "f64_least_subnormal_bits": hex64(Double.leastNonzeroMagnitude),
    "f64_least_normal_bits": hex64(Double.leastNormalMagnitude),
    "f64_max_finite_bits": hex64(Double.greatestFiniteMagnitude),
    "f64_infinity_bits": hex64(Double.infinity),
    "f64_nan_classification": Double.nan.isNaN ? "nan" : "not_nan",
    "f64_halfway_add_bits": hex64(1.0 + halfway),
    "f64_one_third_bits": hex64(oneThird),
    "f64_overflow_classification": (Double.greatestFiniteMagnitude * 2.0).isInfinite ? "infinity" : "not_infinity",
    "f64_underflow_bits": hex64(Double.leastNonzeroMagnitude / 2.0),
    "i64_add_overflow": i64Overflow.overflow ? "true" : "false",
    "i64_mul_overflow": i64ProductOverflow.overflow ? "true" : "false",
    "i64_div_overflow": i64DivisionOverflow.overflow ? "true" : "false",
    "scaled_product_raw": String(scaledProduct.partialValue),
    "scaled_product_overflow": scaledProduct.overflow ? "true" : "false",
    "scaled_dividend_raw": String(scaledDivision.partialValue),
    "scaled_dividend_overflow": scaledDivision.overflow ? "true" : "false"
])
