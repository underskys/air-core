// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AIRSwift",
    products: [
        .library(name: "AIRSwiftCore", targets: ["AIRSwiftCore"]),
        .library(name: "AIRSwiftHostContract", targets: ["AIRSwiftHostContract"]),
        .library(name: "AIRSwiftRuntime", targets: ["AIRSwiftRuntime"]),
        .library(name: "AIRSwiftGeneratedBindings", targets: ["AIRSwiftGeneratedBindings"]),
        .executable(name: "AIRSwiftConformance", targets: ["AIRSwiftConformance"])
    ],
    targets: [
        .target(name: "AIRSwiftCore"),
        .target(name: "AIRSwiftHostContract", dependencies: ["AIRSwiftCore"]),
        .target(name: "AIRSwiftRuntime", dependencies: ["AIRSwiftCore", "AIRSwiftHostContract"]),
        .target(name: "AIRSwiftGeneratedBindings", dependencies: ["AIRSwiftCore", "AIRSwiftHostContract"]),
        .executableTarget(
            name: "AIRSwiftConformance",
            dependencies: ["AIRSwiftCore", "AIRSwiftHostContract", "AIRSwiftRuntime", "AIRSwiftGeneratedBindings"]
        ),
        .testTarget(name: "AIRSwiftCoreTests", dependencies: ["AIRSwiftCore"]),
        .testTarget(name: "AIRSwiftHostContractTests", dependencies: ["AIRSwiftHostContract"]),
        .testTarget(name: "AIRSwiftRuntimeTests", dependencies: ["AIRSwiftRuntime", "AIRSwiftGeneratedBindings"])
    ]
)
