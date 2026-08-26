// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GoldenAIGateSwiftHost",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "../../../swift/AIRSwift")
    ],
    targets: [
        .executableTarget(
            name: "GoldenAIGateSwiftHost",
            dependencies: [
                .product(name: "AIRSwiftCore", package: "AIRSwift"),
                .product(name: "AIRSwiftHostContract", package: "AIRSwift")
            ]
        )
    ]
)
