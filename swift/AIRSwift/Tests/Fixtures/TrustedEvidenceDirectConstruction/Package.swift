// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AIRSwiftExternalEvidenceFixture",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: "../../../")],
    targets: [
        .executableTarget(
            name: "AIRSwiftExternalEvidenceFixture",
            dependencies: [
                .product(name: "AIRSwiftHostContract", package: "AIRSwift"),
                .product(name: "AIRSwiftRuntime", package: "AIRSwift")
            ]
        )
    ]
)
