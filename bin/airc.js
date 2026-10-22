#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AirError } = require("../src/errors");
const { readBoundedRegularFile } = require("../src/bounded_file");
const {
  SOURCE_PROFILE_LEGACY,
  SOURCE_PROFILE_TYPED_V053,
  formatSource,
  isTypedSourceProfile,
  normalizeSourceProfile,
  parseSource,
  verifySource
} = require("../src/source_profile");
const { assertWasmTargetSupport, verifyModule, VerificationError } = require("../src/verifier");
const { ProvenanceFlowError } = require("../src/provenance_flow");
const { explainModule } = require("../src/explain");
const { auditModule } = require("../src/audit");
const lowerWasmModule = require("../src/lower_wasm");
const { lowerToWat, watToWasm } = lowerWasmModule;
const { createToolchainGuard } = require("../src/v052_toolchain_identity");
const {
  VERIFIED_TYPED_RUNTIME_LIMITS,
  enforceVerifiedTypedBuildLimit,
  verifiedTypedAstNodeCount
} = require("../src/v052_verified_build");
const { emitWit } = require("../src/wit");
const { loadGfxManifest, validateGfxManifest, emitGfxWit, buildGfxPackage } = require("../src/gfx_manifest");
const { createGfxImportManifest } = require("../src/gfx_import");
const { buildPackage, checkPackageDir, reportPackageDir, validatePackageDir, verifyPackageDir } = require("../src/sdk");
const { emitGfxStdlib } = require("../src/gfx_stdlib");
const { emitStdlib } = require("../src/stdlib");
const { emitRegistry } = require("../src/registry");
const { createConformanceReport } = require("../src/conformance_report");
const { createConformanceReplayReport, stableStringify: stableConformanceStringify } = require("../src/conformance_replay");
const { createAudioAuthorityReport, loadAudioManifest } = require("../src/audio_authority");
const { validatePackageManifest } = require("../src/package_manifest");
const { writeGeneratedHandleModules } = require("../src/handle_generator");
const { writeGeneratedOutputHandles } = require("../src/output_handle_generator");
const { writeGeneratedStateHandles } = require("../src/state_handle_generator");
const { writeGeneratedStructuredIoHandles } = require("../src/structured_io_schema");
const { createSurfaceReport } = require("../src/surface");
const { createLspDiagnostics } = require("../src/lsp_diagnostics");
const { runLspStdio } = require("../src/lsp_server");
const { createReviewBaseline } = require("../src/review_trends");
const { checkAirpkgArtifact, inspectAirpkg, stableStringify, writeAirpkgArtifact } = require("../src/airpkg");
const { createPackageLinkPlan, stableStringify: stableLinkPlanStringify } = require("../src/link_plan");
const { buildLinkedPackage } = require("../src/linked_package");
const { checkTargetBundle, createTargetBundle } = require("../src/target_bundle");
const { createPackageVerificationEvidence, stableStringify: stableEvidenceStringify } = require("../src/verification_evidence");
const { createMockHostInteractionEvidence, stableStringify: stableMockHostStringify } = require("../src/mock_host_policy");
const { createBenchmarkReport, stableStringify: stableBenchmarkStringify } = require("../src/benchmark_report");
const { createAiAuthoringEvalReport, createAiAuthoringEvalImportReport, createAiAuthoringEvalRegressionReport, stableStringify: stableAiEvalStringify } = require("../src/ai_authoring_eval");
const { createAiAuthoringBenchmarkReport, runAiAuthoringBenchmarkAdapter, stableStringify: stableAiBenchmarkStringify } = require("../src/ai_authoring_benchmark");
const { createVerifierSafetyFuzzReport, stableStringify: stableSafetyFuzzStringify } = require("../src/verifier_safety_fuzz");
const { createPackageDiff, stableStringify: stablePackageDiffStringify } = require("../src/package_diff");
const {
  applySemanticPatch,
  createSemanticPatch,
  inspectSemanticPatch,
  stableStringify: stableSemanticPatchStringify
} = require("../src/semantic_patch");
const { createE2eProofReport, stableStringify: stableE2eProofStringify } = require("../src/e2e_proof");
const { createEvidenceMarkdownReport } = require("../src/evidence_report");
const { AIR_VERSION, AIR_ABI_VERSION } = require("../src/version");

const SOURCE_FILE_COMMANDS = new Set([
  "fmt",
  "verify",
  "explain",
  "audit",
  "report",
  "audio-check",
  "wit",
  "gfx-check",
  "input-check",
  "app-check",
  "gfx-wit",
  "gfx-build",
  "build"
]);
const SOURCE_COMMAND_OPTIONS = Object.freeze({
  "app-check": { values: ["--manifest", "--source-profile"] },
  "audio-check": { values: ["--audio-manifest", "--source-profile"] },
  audit: { values: ["--source-profile"] },
  build: { values: ["--emit", "--output", "--source-profile", "-o"] },
  explain: { values: ["--source-profile"] },
  format: { flags: ["--canonical", "--check", "--json", "--stdin", "--write"], values: ["--source-profile"] },
  fmt: { values: ["--source-profile"] },
  "gfx-build": { values: ["--manifest", "--out", "--source-profile"] },
  "gfx-check": { values: ["--manifest", "--source-profile"] },
  "gfx-wit": { values: ["--manifest", "--source-profile"] },
  "input-check": { values: ["--manifest", "--source-profile"] },
  report: { flags: ["--ai-review"], values: ["--audio-manifest", "--manifest", "--profile", "--source-profile"] },
  verify: { flags: ["--library"], values: ["--source-profile"] },
  wit: { values: ["--source-profile"] }
});
// R-PROF-1 (OPEN-1 (a)): the candidate opt-in for typed-v0.53. It is accepted
// only together with `--source-profile typed-v0.53`; every other invocation
// keeps its 388c790 option handling (`air.cli.option_unknown`).
const CANDIDATE_PROFILE_FLAG = "--allow-candidate-profile";

async function main(argv) {
  let [command, file, ...rest] = argv;
  if (command === "gfx-stdlib") {
    process.stdout.write(emitGfxStdlib());
    return 0;
  }
  if (command === "stdlib") {
    process.stdout.write(emitStdlib());
    return 0;
  }
  if (command === "registry") {
    process.stdout.write(emitRegistry());
    return 0;
  }
  if (command === "surface" || command === "report-surface") {
    const args = [file, ...rest].filter(Boolean);
    const profile = readOption(args, "--profile") || "browser-webgpu";
    const json = args.includes("--json");
    const report = createSurfaceReport({ profile });
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printSurfaceSummary(report);
    return 0;
  }
  if (command === "version") {
    const json = rest.includes("--json") || file === "--json";
    const info = { version: AIR_VERSION, abi: AIR_ABI_VERSION };
    process.stdout.write(json ? `${JSON.stringify(info, null, 2)}\n` : `AIR ${AIR_VERSION} (AIR ABI ${AIR_ABI_VERSION})\n`);
    return 0;
  }

  if (command === "lsp") {
    const args = [file, ...rest].filter(Boolean);
    if (!args.includes("--stdio")) throw new Error("unsupported LSP transport; expected airc lsp --stdio");
    const lspOptions = { profile: readOption(args, "--profile") || "cli" };
    // R-LSP-1: the LSP selects typed-v0.53 explicitly, under the candidate gate.
    if (readOption(args, "--source-profile") === SOURCE_PROFILE_TYPED_V053) {
      lspOptions.sourceProfile = normalizeSourceProfile(SOURCE_PROFILE_TYPED_V053, { allowCandidateProfile: args.includes(CANDIDATE_PROFILE_FLAG) });
      lspOptions.allowCandidateProfile = true;
    }
    runLspStdio(lspOptions);
    return null;
  }

  if (command === "gfx-import") {
    const name = readOption(rest, "--name");
    const fragment = createGfxImportManifest(file, { name });
    const output = readOption(rest, "-o") || readOption(rest, "--output");
    const json = `${JSON.stringify(fragment, null, 2)}\n`;
    if (output) {
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
      fs.writeFileSync(output, json);
      console.log(`wrote ${output}`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  }

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "package-check") {
    const profile = readOption(rest, "--profile");
    const json = rest.includes("--json");
    const built = !(rest.includes("--source-only") || rest.includes("--no-built"));
    const releaseCandidate = rest.includes("--release-candidate");
    if (!profile) {
      const validation = validatePackageDir(file, { built });
      if (!validation.executionProfile) {
        if (json) {
          process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
        } else {
          console.log(`ok: ${file}`);
          console.log(JSON.stringify(validation));
        }
        return 0;
      }
    }
    const result = checkPackageDir(file, { profile, built, releaseCandidate });
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printPackageCheckSummary(result);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "check") {
    const args = [file, ...rest].filter(Boolean);
    if (args.some((arg) => arg === "--source-profile" || arg.startsWith("--source-profile="))) {
      // R-LSP-1: `check` accepts exactly `--source-profile typed-v0.53` (with the
      // candidate opt-in). Every other profile request keeps its 388c790 refusal.
      const profileIndex = args.indexOf("--source-profile");
      const singleTypedV053 = profileIndex >= 0 && args[profileIndex + 1] === SOURCE_PROFILE_TYPED_V053 &&
        args.filter((arg) => arg === "--source-profile" || arg.startsWith("--source-profile=")).length === 1;
      if (!singleTypedV053) {
        throw new AirError("air.source_profile.command_unsupported: 'check' does not support --source-profile");
      }
      normalizeSourceProfile(SOURCE_PROFILE_TYPED_V053, { allowCandidateProfile: args.includes(CANDIDATE_PROFILE_FLAG) });
      const typedTarget = args.find((arg, index) => !arg.startsWith("-") && index !== profileIndex + 1);
      if (!typedTarget) throw new Error("missing target: airc check <file> --source-profile typed-v0.53 --allow-candidate-profile --lsp-json");
      if (fs.existsSync(typedTarget) && fs.statSync(typedTarget).isDirectory()) {
        throw new AirError(`air.source_profile.command_unsupported: 'check' does not support package targets under '${SOURCE_PROFILE_TYPED_V053}'`);
      }
      const typedResult = createLspDiagnostics(typedTarget, { allowCandidateProfile: true, sourceProfile: SOURCE_PROFILE_TYPED_V053 });
      if (!args.includes("--lsp-json")) {
        printLspDiagnosticSummary(typedResult);
      } else {
        process.stdout.write(`${JSON.stringify(typedResult, null, 2)}\n`);
      }
      // No verdict was reached on a refusal, so it is not a success either.
      return typedResult.status === "pass" || typedResult.status === "warn" ? 0 : 1;
    }
    const target = args.find((arg) => !arg.startsWith("-"));
    if (!target) throw new Error("missing target: airc check <file-or-package> --lsp-json");
    const lspJson = args.includes("--lsp-json");
    const result = createLspDiagnostics(target, {
      profile: readOption(args, "--profile"),
      built: args.includes("--built"),
      library: args.includes("--library"),
      releaseCandidate: args.includes("--release-candidate")
    });
    if (!lspJson) {
      printLspDiagnosticSummary(result);
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "diff" && file === "package") {
    const oldPackageDir = rest.shift();
    const newPackageDir = rest.shift();
    if (!oldPackageDir || !newPackageDir) throw new Error("missing package directories: airc diff package <old-package-dir> <new-package-dir> --json");
    const result = createPackageDiff(oldPackageDir, newPackageDir, { cwd: process.cwd() });
    if (rest.includes("--json")) {
      process.stdout.write(stablePackageDiffStringify(result));
    } else {
      console.log(`package diff: ${result.status}`);
      console.log(`air ABI: ${result.airAbiDelta.old || "-"} -> ${result.airAbiDelta.new || "-"}`);
      console.log(`host ABI: ${result.hostAbiDelta.old || "-"} -> ${result.hostAbiDelta.new || "-"}`);
      console.log(`capabilities: +${joinList(result.capabilityDelta.added)} -${joinList(result.capabilityDelta.removed)}`);
      console.log(`output contracts: +${result.outputContractDelta.added.length} -${result.outputContractDelta.removed.length} changed=${result.outputContractDelta.changedItems.length}`);
      console.log(`generated artifacts: +${result.generatedArtifactDelta.added.length} -${result.generatedArtifactDelta.removed.length} changed=${result.generatedArtifactDelta.changedItems.length}`);
      for (const diagnostic of result.diagnostics) console.log(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
    }
    return result.status === "failed" ? 1 : 0;
  }

  if (command === "semantic-patch") {
    const action = file;
    if (action === "generate") {
      const basePackageDir = rest.shift();
      const resultPackageDir = rest.shift();
      const output = readOption(rest, "-o") || readOption(rest, "--output");
      if (!basePackageDir || !resultPackageDir || !output) {
        throw new Error("usage: airc semantic-patch generate <base-package> <result-package> -o <patch.json>");
      }
      const patch = createSemanticPatch(basePackageDir, resultPackageDir, {
        policyMode: readOption(rest, "--mode") || "strict",
        authoritySource: readOption(rest, "--authority-source"),
        actor: readOption(rest, "--actor"),
        humanForced: rest.includes("--human-forced"),
        humanReasonCode: readOption(rest, "--reason")
      });
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
      fs.writeFileSync(output, stableSemanticPatchStringify(patch));
      if (rest.includes("--json")) process.stdout.write(stableSemanticPatchStringify(patch));
      else console.log(`wrote ${output}`);
      return 0;
    }
    if (action === "inspect" || action === "verify") {
      const patchFile = rest.shift();
      if (!patchFile) throw new Error(`usage: airc semantic-patch ${action} <patch.json> [--strict] --json`);
      const evidence = inspectSemanticPatch(patchFile, {
        strict: rest.includes("--strict") ? true : undefined
      });
      if (rest.includes("--json")) process.stdout.write(stableSemanticPatchStringify(evidence));
      else printSemanticPatchSummary(evidence);
      return evidence.status === "accepted" ? 0 : 1;
    }
    if (action === "apply") {
      const patchFile = rest.shift();
      const basePackageDir = rest.shift();
      const output = readOption(rest, "-o") || readOption(rest, "--output");
      if (!patchFile || !basePackageDir || !output) {
        throw new Error("usage: airc semantic-patch apply <patch.json> <base-package> -o <result-package> [--strict]");
      }
      const result = applySemanticPatch(basePackageDir, patchFile, output, {
        strict: rest.includes("--strict") ? true : undefined
      });
      if (rest.includes("--json")) process.stdout.write(stableSemanticPatchStringify(result));
      else console.log(`semantic patch applied: ${result.outputPackageDigest}`);
      return 0;
    }
    throw new Error("unsupported semantic-patch action; expected generate, inspect, verify, or apply");
  }

  if (command === "evidence" && file === "report") {
    const packageDir = rest.find((arg) => !arg.startsWith("-"));
    if (!packageDir) throw new Error("missing package directory: airc evidence report <package-dir> --format markdown -o <file>");
    const format = readOption(rest, "--format") || "markdown";
    if (format !== "markdown") throw new Error("unsupported evidence report format; expected --format markdown");
    const output = readOption(rest, "-o") || readOption(rest, "--output");
    if (!output) throw new Error("missing output: airc evidence report <package-dir> --format markdown -o <file>");
    const markdown = createEvidenceMarkdownReport(packageDir, {
      profile: readOption(rest, "--profile"),
      hostEvidence: readOption(rest, "--host-evidence"),
      conformance: readOption(rest, "--conformance"),
      e2eProof: readOption(rest, "--e2e-proof"),
      benchmark: readOption(rest, "--benchmark"),
      semanticPatch: readOption(rest, "--semantic-patch"),
      semanticPatchStrict: rest.includes("--semantic-patch-strict")
    });
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, markdown);
    console.log(`wrote ${output}`);
    return 0;
  }

  if (command === "package") {
    const args = [file, ...rest].filter(Boolean);
    const packageDir = args.find((arg) => !arg.startsWith("-"));
    const output = readOption(args, "-o") || readOption(args, "--output");
    if (!packageDir) throw new Error("missing package directory: airc package <package-dir> -o <output.airpkg.json>");
    if (!output) throw new Error("missing output: airc package <package-dir> -o <output.airpkg.json>");
    const result = writeAirpkgArtifact(packageDir, output, {
      profile: readOption(args, "--profile"),
      releaseCandidate: args.includes("--release-candidate")
    });
    if (args.includes("--json")) {
      process.stdout.write(`${stableStringify(result.artifact)}\n`);
    } else {
      console.log(`wrote ${result.path}`);
    }
    return result.artifact.report.packageStatus === "fail" || result.artifact.report.graphStatus === "fail" ? 1 : 0;
  }

  if (command === "build" && file === "package") {
    const packageDir = rest.shift();
    if (!packageDir) throw new Error("missing package directory: airc build package <package-dir> --linked-wasm -o <output.wasm>");
    if (!rest.includes("--linked-wasm")) throw new Error("unsupported package build mode; expected --linked-wasm");
    const output = readOption(rest, "-o") || readOption(rest, "--output");
    if (!output) throw new Error("missing output: airc build package <package-dir> --linked-wasm -o <output.wasm>");
    const result = await buildLinkedPackage(packageDir, output, {
      profile: readOption(rest, "--profile"),
      releaseCandidate: rest.includes("--release-candidate"),
      emit: readOption(rest, "--emit")
    });
    if (rest.includes("--json")) {
      process.stdout.write(`${stableLinkPlanStringify(result.report)}\n`);
    } else {
      console.log(`wrote ${result.output}`);
      console.log(`wrote ${result.sidecar}`);
    }
    return result.report.status === "fail" ? 1 : 0;
  }

  if (command === "inspect-airpkg") {
    const args = [file, ...rest].filter(Boolean);
    const input = args.find((arg) => !arg.startsWith("-"));
    if (!input) throw new Error("missing airpkg path: airc inspect-airpkg <file-or-dir>");
    const result = inspectAirpkg(input);
    process.stdout.write(`${stableStringify(result)}\n`);
    return 0;
  }

  if (command === "check-airpkg") {
    const args = [file, ...rest].filter(Boolean);
    const input = args.find((arg) => !arg.startsWith("-"));
    if (!input) throw new Error("missing airpkg path: airc check-airpkg <file-or-dir> --json");
    const result = checkAirpkgArtifact(input, {
      profile: readOption(args, "--profile")
    });
    if (args.includes("--json")) {
      process.stdout.write(`${stableStringify(result)}\n`);
    } else {
      console.log(`status: ${result.status}`);
      for (const diagnostic of result.diagnostics) console.log(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "mock-host") {
    const args = [file, ...rest].filter(Boolean);
    const packageDir = args.find((arg) => !arg.startsWith("-"));
    const policy = readOption(args, "--policy");
    if (!packageDir) throw new Error("missing package directory: airc mock-host <package-dir> --policy <policy.json> --json");
    if (!policy) throw new Error("missing policy: airc mock-host <package-dir> --policy <policy.json> --json");
    const result = createMockHostInteractionEvidence(packageDir, {
      policy,
      profile: readOption(args, "--profile"),
      trace: readOption(args, "--trace")
    });
    if (args.includes("--json")) {
      process.stdout.write(stableMockHostStringify(result));
    } else {
      console.log(`mock-host: ${result.package}`);
      console.log(`status: ${result.status}`);
      console.log(`host profile: ${result.hostProfile || "-"}`);
      console.log(`commands: ${result.commandRecords.length}`);
      console.log(`decisions: ${result.decisions.length}`);
      console.log(`denied capabilities: ${joinList(result.deniedCapabilities)}`);
      for (const diagnostic of result.diagnostics) console.log(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
    }
    return result.status === "failed" ? 1 : 0;
  }

  if (command === "bundle") {
    const args = [file, ...rest].filter(Boolean);
    const input = args.find((arg) => !arg.startsWith("-"));
    const target = readOption(args, "--target");
    const output = readOption(args, "-o") || readOption(args, "--output");
    if (!input) throw new Error("missing airpkg path: airc bundle <airpkg-file> --target <target> -o <out-dir>");
    if (!target) throw new Error("missing target: airc bundle <airpkg-file> --target web-dev|native-dev -o <out-dir>");
    if (!output) throw new Error("missing output: airc bundle <airpkg-file> --target <target> -o <out-dir>");
    const result = createTargetBundle(input, output, { target });
    if (args.includes("--json")) {
      process.stdout.write(`${stableStringify(result)}\n`);
    } else {
      console.log(`wrote ${path.join(output, "bundle.json")}`);
    }
    return 0;
  }

  if (command === "check-bundle") {
    const args = [file, ...rest].filter(Boolean);
    const input = args.find((arg) => !arg.startsWith("-"));
    if (!input) throw new Error("missing bundle directory: airc check-bundle <dir> --json");
    const result = checkTargetBundle(input);
    if (args.includes("--json")) {
      process.stdout.write(`${stableStringify(result)}\n`);
    } else {
      console.log(`status: ${result.status}`);
      for (const diagnostic of result.diagnostics) console.log(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "link-plan") {
    const args = [file, ...rest].filter(Boolean);
    const packageDir = args.find((arg) => !arg.startsWith("-"));
    if (!packageDir) throw new Error("missing package directory: airc link-plan <package-dir> --profile <id> --json");
    const result = createPackageLinkPlan(packageDir, {
      profile: readOption(args, "--profile"),
      releaseCandidate: args.includes("--release-candidate")
    });
    if (args.includes("--json")) {
      process.stdout.write(`${stableLinkPlanStringify(result)}\n`);
    } else {
      console.log(`package: ${result.package.name}`);
      console.log(`status: ${result.status}`);
      console.log(`modules: ${result.moduleOrder.join(", ") || "-"}`);
      console.log(`linked wasm: no`);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "package-manifest-check") {
    const result = validatePackageManifest(file, { built: false });
    console.log(`ok: ${file}`);
    console.log(JSON.stringify(result));
    return 0;
  }

  if (command === "verify" && file === "package") {
    const packageDir = rest.shift();
    if (!packageDir) throw new Error("missing package directory: airc verify package <package-dir>");
    const json = rest.includes("--json");
    if (json) {
      const evidence = createPackageVerificationEvidence(packageDir, {
        profile: readOption(rest, "--profile"),
        releaseCandidate: rest.includes("--release-candidate"),
        hostEvidence: readOption(rest, "--host-evidence"),
        semanticPatch: readOption(rest, "--semantic-patch"),
        semanticPatchStrict: rest.includes("--semantic-patch-strict")
      });
      process.stdout.write(stableEvidenceStringify(evidence));
      return evidence.status === "failed" ? 1 : 0;
    }
    let result = null;
    try {
      result = verifyPackageDir(packageDir);
    } catch (err) {
      console.error(err.message || String(err));
      return 1;
    }
    console.log(`ok: package ${packageDir}`);
    console.log(`modules: ${result.modules.length}`);
    return 0;
  }

  if (command === "report" && file === "package") {
    const packageDir = rest.shift();
    if (!packageDir) throw new Error("missing package directory: airc report package <package-dir>");
    const result = reportPackageDir(packageDir, {
      profile: readOption(rest, "--profile"),
      releaseCandidate: rest.includes("--release-candidate"),
      compareBaseline: readOption(rest, "--compare-baseline")
    });
    if (rest.includes("--review-baseline")) {
      process.stdout.write(`${JSON.stringify(createReviewBaseline(result), null, 2)}\n`);
      return result.status === "fail" ? 1 : 0;
    }
    if (rest.includes("--json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printPackageGraphSummary(result);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "generate-handles") {
    const written = writeGeneratedHandleModules(file);
    const json = rest.includes("--json");
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, package: file, written }, null, 2)}\n`);
    } else {
      console.log(`generated handles for ${file}`);
      for (const rel of written) console.log(`wrote ${rel}`);
    }
    return 0;
  }

  if (command === "generate" && file === "state-handles") {
    const packageDir = rest.shift();
    if (!packageDir) throw new Error("missing package directory: airc generate state-handles <package-dir>");
    const written = writeGeneratedStateHandles(packageDir);
    const json = rest.includes("--json");
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, package: packageDir, written }, null, 2)}\n`);
    } else {
      console.log(`generated state handles for ${packageDir}`);
      for (const rel of written) console.log(`wrote ${rel}`);
    }
    return 0;
  }

  if (command === "generate" && file === "output-handles") {
    const packageDir = rest.shift();
    if (!packageDir) throw new Error("missing package directory: airc generate output-handles <package-dir>");
    const written = writeGeneratedOutputHandles(packageDir);
    const json = rest.includes("--json");
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, package: packageDir, written }, null, 2)}\n`);
    } else {
      console.log(`generated output handles for ${packageDir}`);
      for (const rel of written) console.log(`wrote ${rel}`);
    }
    return 0;
  }

  if (command === "generate" && file === "structured-io") {
    const packageDir = rest.shift();
    if (!packageDir) throw new Error("missing package directory: airc generate structured-io <package-dir>");
    const written = writeGeneratedStructuredIoHandles(packageDir);
    const json = rest.includes("--json");
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, package: packageDir, written }, null, 2)}\n`);
    } else {
      console.log(`generated structured IO handles for ${packageDir}`);
      for (const rel of written) console.log(`wrote ${rel}`);
    }
    return 0;
  }

  if (command === "conformance-fixture") {
    const outDir = readOption(rest, "--out");
    if (!outDir) throw new Error("missing --out <dir>");
    const written = await buildConformanceFixture(file, outDir);
    console.log(`wrote ${written.wasm}`);
    if (written.manifest) console.log(`wrote ${written.manifest}`);
    console.log(`wrote ${written.metadata}`);
    return 0;
  }

  if (command === "conformance") {
    const profile = readOption(rest, "--profile");
    const trace = readOption(rest, "--trace");
    const json = rest.includes("--json");
    const result = await createConformanceReplayReport(file, { profile, trace });
    if (json) {
      process.stdout.write(`${stableConformanceStringify(result)}\n`);
    } else {
      console.log(`conformance: ${result.package}`);
      console.log(`profile: ${result.profile}`);
      console.log(`trace: ${result.trace.id}`);
      console.log(`status: ${result.status}`);
      for (const mismatch of result.mismatches) console.error(`mismatch: ${mismatch.message}`);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "benchmark") {
    const args = [file, ...rest].filter(Boolean);
    const benchmarkDir = args.find((arg) => !arg.startsWith("-"));
    const json = args.includes("--json");
    const result = await createBenchmarkReport(benchmarkDir, { cwd: process.cwd() });
    if (json) {
      process.stdout.write(stableBenchmarkStringify(result));
    } else {
      console.log(`benchmark: ${result.benchmarkName || result.benchmarkId || "-"}`);
      console.log(`status: ${result.status}`);
      for (const diagnostic of result.diagnostics || []) console.log(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
    }
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "run-proof") {
    const args = [file, ...rest].filter(Boolean);
    const packageDir = args.find((arg) => !arg.startsWith("-"));
    if (!packageDir) throw new Error("missing package directory: airc run-proof <package-dir> --fixture <fixture.json> --policy <policy.json> --json");
    const fixture = readOption(args, "--fixture");
    const policy = readOption(args, "--policy");
    const result = await createE2eProofReport(packageDir, {
      fixture,
      policy,
      profile: readOption(args, "--profile")
    });
    if (args.includes("--json")) {
      process.stdout.write(stableE2eProofStringify(result));
    } else {
      console.log(`e2e proof: ${result.packageName || packageDir}`);
      console.log(`status: ${result.status}`);
      console.log(`fixture: ${result.fixtureId || "-"}`);
      console.log(`host decision: ${result.hostDecision ? result.hostDecision.decision : "not_run"}`);
      for (const diagnostic of result.diagnostics) console.log(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
    }
    return result.status === "failed" ? 1 : 0;
  }

  if (command === "eval-ai") {
    const args = [file, ...rest].filter(Boolean);
    if (file === "benchmark") {
      const benchmarkDir = rest.find((arg) => !arg.startsWith("-"));
      if (!benchmarkDir) throw new Error("missing benchmark directory: airc eval-ai benchmark <dir> --import <capture-dir> --json");
      const adapterConfig = readOption(rest, "--adapter-config");
      const captureDir = readOption(rest, "--import");
      if (Boolean(adapterConfig) === Boolean(captureDir)) {
        throw new Error("choose exactly one benchmark source: --import <capture-dir> or --adapter-config <file>");
      }
      const result = adapterConfig
        ? await runAiAuthoringBenchmarkAdapter(benchmarkDir, adapterConfig, { cwd: process.cwd() })
        : createAiAuthoringBenchmarkReport(benchmarkDir, { captureDir, cwd: process.cwd() });
      if (rest.includes("--json")) {
        process.stdout.write(stableAiBenchmarkStringify(result));
      } else {
        console.log(`eval-ai benchmark: ${result.corpusId || "-"}`);
        console.log(`mode: ${result.mode || "-"}`);
        console.log(`status: ${result.status}`);
        console.log(`recommendation: ${result.recommendation}`);
      }
      return result.status === "failed" ? 1 : 0;
    }
    if (file === "import") {
      const captureDir = rest.find((arg) => !arg.startsWith("-"));
      if (!captureDir) throw new Error("missing capture directory: airc eval-ai import <capture-dir> --json");
      const result = createAiAuthoringEvalImportReport(captureDir, { cwd: process.cwd() });
      if (rest.includes("--json")) {
        process.stdout.write(stableAiEvalStringify(result));
      } else {
        console.log(`eval-ai import: ${result.captureId || "-"}`);
        console.log(`mode: ${result.mode}`);
        console.log(`status: ${result.status}`);
        console.log(`imported cases: ${result.importedCaseCount}`);
        console.log(`rejected cases: ${result.rejectedCaseCount}`);
      }
      return result.status === "failed" ? 1 : 0;
    }
    const evalDir = args.find((arg) => !arg.startsWith("-"));
    if (!evalDir) throw new Error("missing eval directory: airc eval-ai <eval-dir> --json");
    const json = args.includes("--json");
    const regression = args.includes("--regression");
    const result = regression
      ? createAiAuthoringEvalRegressionReport(evalDir, { cwd: process.cwd() })
      : createAiAuthoringEvalReport(evalDir, { cwd: process.cwd() });
    if (json) {
      process.stdout.write(stableAiEvalStringify(result));
    } else {
      console.log(`eval-ai: ${result.suite || result.evalSuite || "-"}`);
      console.log(`mode: ${result.mode}`);
      console.log(`status: ${result.status}`);
      console.log(`cases: ${result.metrics.totalCases}`);
      console.log(`first-pass verify: ${result.metrics.firstPassVerifyRate}`);
      console.log(`first-pass package-check: ${result.metrics.firstPassPackageCheckRate}`);
    }
    return result.status === "failed" ? 1 : 0;
  }

  if (command === "fuzz-safety") {
    const args = [file, ...rest].filter(Boolean);
    const json = args.includes("--json");
    const seed = readOption(args, "--seed") || "1";
    const cases = readOption(args, "--cases") || "50";
    const result = await createVerifierSafetyFuzzReport({ cwd: process.cwd(), seed, cases });
    if (json) {
      process.stdout.write(stableSafetyFuzzStringify(result));
    } else {
      console.log(`fuzz-safety: ${result.status}`);
      console.log(`seed: ${result.seed}`);
      console.log(`cases: ${result.metrics.totalCases}`);
      console.log(`failed: ${result.metrics.failed}`);
    }
    return result.status === "failed" ? 1 : 0;
  }

  if (command === "format") {
    return runFormatCommand([file, ...rest].filter(Boolean));
  }

  if (!SOURCE_FILE_COMMANDS.has(command)) {
    throw new AirError(`air.cli.command_unknown: ${command}`);
  }

  const sourceInvocation = parseSourceInvocation([file, ...rest].filter(Boolean), { command });
  file = sourceInvocation.file;
  rest = sourceInvocation.rest;
  let source;
  source = readSourceFile(file);
  const sourceProfile = sourceInvocation.sourceProfile;
  // typed-v0.53 was selected with the candidate opt-in (parseSourceInvocation);
  // its phase A (source bytes, parse, AST nodes, capacity) runs inside parseSource.
  const candidate = sourceProfile === SOURCE_PROFILE_TYPED_V053 ? { allowCandidateProfile: true } : {};
  let mod;
  try {
    mod = parseSource(source, file, { sourceProfile, ...candidate });
  } catch (error) {
    if (sourceProfile === SOURCE_PROFILE_LEGACY && !rest.includes("--source-profile") && error instanceof AirError) {
      error.message += " (default profile: legacy-v0.50; typed sources require --source-profile typed-v0.51)";
    }
    throw error;
  }

  if (command === "fmt" || command === "format") {
    process.stdout.write(formatSource(mod, { sourceProfile, ...candidate }));
    return 0;
  }

  if (command === "verify") {
    verifySource(mod, { sourceProfile, library: rest.includes("--library"), ...candidate });
    console.log(`ok: ${file}`);
    return 0;
  }

  if (command === "build" && sourceProfile === SOURCE_PROFILE_TYPED_V053) {
    return buildTypedV053(mod, file, rest);
  }

  if (isTypedSourceProfile(sourceProfile) && command !== "build") {
    throw new AirError(`air.source_profile.command_unsupported: '${command}' does not support '${sourceProfile}' source`);
  }

  if (command === "explain") {
    verifyModule(mod);
    process.stdout.write(explainModule(mod));
    return 0;
  }

  if (command === "audit") {
    verifyModule(mod);
    process.stdout.write(auditModule(mod));
    return 0;
  }

  if (command === "report") {
    const manifest = rest.includes("--manifest") ? loadManifestOption(rest) : null;
    const audioManifest = rest.includes("--audio-manifest") ? loadAudioManifestOption(rest) : null;
    const report = createConformanceReport(mod, { manifest, audioManifest, profile: readOption(rest, "--profile"), aiReview: rest.includes("--ai-review"), source });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === "pass" ? 0 : 1;
  }

  if (command === "audio-check") {
    verifyModule(mod);
    const audioManifest = rest.includes("--audio-manifest") ? loadAudioManifestOption(rest) : null;
    const audio = createAudioAuthorityReport(mod, { manifest: audioManifest });
    const report = {
      ok: audio.status === "pass",
      module: mod.name,
      audio,
      errors: audio.errors,
      warnings: audio.warnings
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  if (command === "wit") {
    verifyModule(mod);
    process.stdout.write(emitWit(mod));
    return 0;
  }

  if (command === "gfx-check" || command === "input-check" || command === "app-check") {
    verifyModule(mod);
    const manifest = loadManifestOption(rest);
    const result = validateGfxManifest(mod, manifest);
    printGfxResult(file, manifest, result);
    if (!result.ok) return 1;
    return 0;
  }

  if (command === "gfx-wit") {
    verifyModule(mod);
    const manifest = loadManifestOption(rest);
    const result = validateGfxManifest(mod, manifest);
    if (!result.ok) {
      printGfxResult(file, manifest, result);
      return 1;
    }
    process.stdout.write(emitGfxWit(mod, manifest));
    return 0;
  }

  if (command === "gfx-build") {
    verifyModule(mod);
    const manifest = loadManifestOption(rest);
    const result = validateGfxManifest(mod, manifest);
    if (!result.ok) {
      printGfxResult(file, manifest, result);
      return 1;
    }
    const outDir = readOption(rest, "--out") || "public";
    const written = await buildGfxPackage(mod, manifest, { outDir, sourceName: file });
    console.log(`wrote ${written.wasm}`);
    console.log(`wrote ${written.manifest}`);
    console.log(`wrote ${written.metadata}`);
    return 0;
  }

  if (command === "build") {
    verifySource(mod, { sourceProfile });
    if (!isTypedSourceProfile(sourceProfile)) assertWasmTargetSupport(mod);
    const emit = readOption(rest, "--emit") || "wat";
    const output = readOption(rest, "-o") || readOption(rest, "--output");
    if (!["wat", "wasm"].includes(emit)) {
      throw new Error(`unsupported --emit ${emit}; expected wat or wasm`);
    }
    const typed = isTypedSourceProfile(sourceProfile);
    let wat;
    let wasm;
    try {
      if (typed) {
        // Same work limits as the verified typed builder (X-BND-01).
        enforceVerifiedTypedBuildLimit("sourceBytes", Buffer.byteLength(source, "utf8"));
        enforceVerifiedTypedBuildLimit("astNodes", verifiedTypedAstNodeCount(mod));
        wat = lowerToWat(mod, { maxWatBytes: VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes });
        enforceVerifiedTypedBuildLimit("watBytes", Buffer.byteLength(wat, "utf8"));
      } else {
        wat = lowerToWat(mod);
      }
      if (emit === "wasm") {
        wasm = await watToWasm(wat, file);
        if (typed) enforceVerifiedTypedBuildLimit("wasmBytes", wasm.length);
      }
    } catch (error) {
      if (typed && error && typeof error.code === "string" && error.code.startsWith("air.") && !(error instanceof AirError)) {
        throw new AirError(String(error.message).startsWith(error.code) ? error.message : `${error.code}: ${error.message}`);
      }
      throw error;
    }
    const outPath = output || replaceExt(file, emit);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, emit === "wat" ? wat : wasm);
    console.log(`wrote ${outPath}`);
    return 0;
  }

  throw new AirError(`air.cli.command_unknown: ${command}`);
}

// E1: `airc build --source-profile typed-v0.53 --allow-candidate-profile`.
// Phase A already ran in parseSource (source bytes, iterative parse, AST
// nodes, capacity); then verify (phase S), the phase-B engine limits, the
// WABT toolchain guard for `--emit wasm` (F3: a stable environment code, never
// a raw module error), lowering with the exact incremental WAT cap, and the
// Wasm cap on the assembler output before the file is written (AMD-10).
async function buildTypedV053(mod, file, rest) {
  verifySource(mod, { allowCandidateProfile: true, sourceProfile: SOURCE_PROFILE_TYPED_V053 });
  const emit = readOption(rest, "--emit") || "wat";
  const output = readOption(rest, "-o") || readOption(rest, "--output");
  if (!["wat", "wasm"].includes(emit)) {
    throw new AirError(`air.cli.option_unknown: unsupported --emit '${emit}'; expected wat or wasm`);
  }
  let wat;
  let wasm;
  try {
    lowerWasmModule.typedV053.checkEngineLimits(mod);
    if (emit === "wasm") createToolchainGuard(path.join(__dirname, "..", "src")).snapshot();
    wat = lowerToWat(mod, { maxWatBytes: VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes });
    enforceVerifiedTypedBuildLimit("watBytes", Buffer.byteLength(wat, "utf8"));
    if (emit === "wasm") {
      wasm = await watToWasm(wat, file);
      enforceVerifiedTypedBuildLimit("wasmBytes", wasm.length);
    }
  } catch (error) {
    if (error && typeof error.code === "string" && error.code.startsWith("air.") && !(error instanceof AirError)) {
      throw new AirError(String(error.message).startsWith(error.code) ? error.message : `${error.code}: ${error.message}`);
    }
    throw error;
  }
  const outPath = output || replaceExt(file, emit);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, emit === "wat" ? wat : wasm);
  console.log(`wrote ${outPath}`);
  return 0;
}

async function buildConformanceFixture(name, outDir) {
  const root = path.resolve(__dirname, "..");
  const fixtures = {
    math: { air: path.join(root, "examples", "player_math.air") },
    data: { air: path.join(root, "examples", "transform_pack.air") },
    effects: { air: path.join(root, "examples", "effects_contract.air") },
    loop: { air: path.join(root, "examples", "bounded_loop.air") },
    collections: { air: path.join(root, "examples", "dynamic_collections.air") },
    grid: { air: path.join(root, "examples", "grid_math.air") },
    utility: { air: path.join(root, "examples", "utility_plugin.air") },
    slice: { air: path.join(root, "examples", "dynamic_slice.air") },
    "network-ipv4": { air: path.join(root, "examples", "network_ipv4_math.air") },
    "network-scan": { air: path.join(root, "examples", "network_scan_plan.air") },
    "network-tools": { air: path.join(root, "examples", "network_tool_capabilities.air") },
    "network-dns": { air: path.join(root, "examples", "network_dns_diagnose.air") },
    "network-route": { air: path.join(root, "examples", "network_route_diagnose.air") },
    "network-packet": { air: path.join(root, "examples", "network_packet_record.air") },
    gpu: { air: path.join(root, "examples", "gpu_arena.air"), manifest: path.join(root, "examples", "gpu_arena.airgfx.json") },
    "ui-tool": { air: path.join(root, "examples", "ui_tool.air"), manifest: path.join(root, "examples", "ui_tool.airgfx.json") }
  };
  const fixture = fixtures[name];
  if (!fixture) throw new Error(`unknown fixture '${name}'; expected ${Object.keys(fixtures).sort().join(", ")}`);
  return buildPackage({ ...fixture, out: outDir });
}

function runFormatCommand(args) {
  const opts = parseFormatArgs(args);
  const source = opts.stdin ? fs.readFileSync(0, "utf8") : readSourceFile(opts.file);
  const inputKind = opts.stdin ? "stdin" : "file";
  const diagnostics = [];
  let canonical = "";

  const typedV053 = opts.sourceProfile === SOURCE_PROFILE_TYPED_V053;
  const candidate = typedV053 ? { allowCandidateProfile: true } : {};
  try {
    const mod = parseSource(source, opts.file || "<stdin>", { sourceProfile: opts.sourceProfile, ...candidate });
    canonical = formatSource(mod, { sourceProfile: opts.sourceProfile, ...candidate });
  } catch (err) {
    const message = sanitizeDiagnosticMessage(err && err.message ? err.message : String(err));
    if (typedV053 && err && typeof err.code === "string" && err.code.startsWith("air.")) {
      // R-14 / R-DIAG-1: typed-v0.53 keeps the stable code, and a refusal
      // (ANALYSIS_REFUSED, INTAKE_REFUSED) keeps its own disposition.
      diagnostics.push({ ...formatDiagnostic(err.code, "fail", message), disposition: err.disposition || "STATIC_REJECT" });
    } else {
      diagnostics.push(formatDiagnostic("air.format.parse_failed", "fail", message));
    }
    return finishFormatResult({ opts, inputKind, changed: false, canonical: "", diagnostics });
  }

  const changed = source !== canonical;
  if (opts.write && hasAirComment(source)) {
    diagnostics.push(formatDiagnostic(
      "air.format.comments_not_preserved",
      "fail",
      "format --write refuses comment-bearing input until comment preservation is implemented"
    ));
    return finishFormatResult({ opts, inputKind, changed, canonical, diagnostics });
  }
  if (opts.check && changed) {
    diagnostics.push(formatDiagnostic("air.format.not_canonical", "fail", "AIR source is not canonical"));
  }
  if (opts.write && !diagnostics.length && changed) {
    try {
      writeFileAtomic(opts.file, canonical);
    } catch (err) {
      diagnostics.push(formatDiagnostic("air.format.write_failed", "fail", sanitizeDiagnosticMessage(err && err.message ? err.message : String(err))));
    }
  }

  return finishFormatResult({ opts, inputKind, changed, canonical, diagnostics });
}

// Shared bounded regular-file reader (src/bounded_file.js).
function readSourceFile(file) {
  return readBoundedRegularFile(file, { label: "source" });
}

function parseFormatArgs(args) {
  const stdin = args.includes("--stdin");
  const sourceInvocation = parseSourceInvocation(args, { command: "format", requireFile: !stdin });
  const opts = {
    check: args.includes("--check"),
    write: args.includes("--write"),
    stdin,
    json: args.includes("--json"),
    canonical: args.includes("--canonical"),
    sourceProfile: sourceInvocation.sourceProfile,
    file: stdin ? "<stdin>" : sourceInvocation.file
  };
  if (stdin && sourceInvocation.file) throw new Error("format --stdin does not accept a file argument");
  if (stdin && opts.write) throw new Error("format --stdin does not support --write");
  return opts;
}

function finishFormatResult({ opts, inputKind, changed, canonical, diagnostics }) {
  const status = diagnostics.some((diag) => diag.severity === "fail") ? "fail" : "pass";
  const result = {
    kind: "air.formatResult",
    status,
    changed,
    diagnostics,
    inputKind,
    outputHash: canonical ? sha256(canonical) : null
  };
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (status === "fail") {
    for (const diagnostic of diagnostics) {
      process.stderr.write(`${diagnostic.code}: ${diagnostic.message}\n`);
    }
  } else if (!opts.check && !opts.write) {
    process.stdout.write(canonical);
  }
  return status === "fail" ? 1 : 0;
}

function formatDiagnostic(code, severity, message) {
  return { code, severity, message };
}

function hasAirComment(source) {
  for (const line of source.split(/\r?\n/)) {
    let inString = false;
    let escape = false;
    for (const ch of line) {
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "#") return true;
    }
  }
  return false;
}

function writeFileAtomic(file, text) {
  const dir = path.dirname(path.resolve(file));
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function sha256(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function sanitizeDiagnosticMessage(message) {
  return String(message)
    .split(path.resolve(__dirname, "..")).join(".")
    .split(process.cwd()).join(".");
}

function readOption(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function readSourceProfileOption(args) {
  let profile = SOURCE_PROFILE_LEGACY;
  let seen = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--source-profile=")) {
      throw new AirError("air.source_profile.invalid_form: use '--source-profile <profile>'");
    }
    if (arg !== "--source-profile") continue;
    if (seen) {
      throw new AirError("air.source_profile.duplicate: specify --source-profile at most once");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      throw new AirError("air.source_profile.missing: expected a versioned profile after --source-profile");
    }
    profile = normalizeSourceProfile(value, { allowCandidateProfile: args.includes(CANDIDATE_PROFILE_FLAG) });
    seen = true;
  }
  return profile;
}

function parseSourceInvocation(args, { command, requireFile = true } = {}) {
  const sourceProfile = readSourceProfileOption(args);
  const commandOptions = SOURCE_COMMAND_OPTIONS[command] || { flags: [], values: [] };
  const flags = new Set(commandOptions.flags || []);
  const valueFlags = new Set(commandOptions.values || []);
  const optionValues = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-")) continue;
    if (valueFlags.has(arg)) {
      optionValues.add(index + 1);
      continue;
    }
    if (flags.has(arg)) continue;
    if (arg === CANDIDATE_PROFILE_FLAG && sourceProfile === SOURCE_PROFILE_TYPED_V053) continue;
    throw new AirError(`air.cli.option_unknown: '${arg}' is not supported by '${command}'`);
  }
  const fileIndex = args.findIndex((arg, index) => !arg.startsWith("-") && !optionValues.has(index));
  if (fileIndex < 0 && requireFile) {
    throw new AirError("air.source_profile.file_missing: expected an AIR source file");
  }
  return {
    sourceProfile,
    file: fileIndex < 0 ? null : args[fileIndex],
    rest: args.filter((_, index) => index !== fileIndex)
  };
}

function loadManifestOption(args) {
  const file = readOption(args, "--manifest");
  if (!file) throw new Error("missing --manifest <file>");
  return loadGfxManifest(file);
}

function loadAudioManifestOption(args) {
  const file = readOption(args, "--audio-manifest");
  if (!file) throw new Error("missing --audio-manifest <file>");
  return loadAudioManifest(file);
}

function printGfxResult(file, manifest, result) {
  if (result.ok) {
    console.log(`ok: ${file} + ${manifest.__file}`);
    console.log(JSON.stringify(result.summary));
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    return;
  }
  for (const error of result.errors) console.error(`error: ${error}`);
}

function printPackageCheckSummary(result) {
  console.log(`package: ${result.package}`);
  if (result.profile) console.log(`profile: ${result.profile}`);
  console.log(`status: ${result.status}`);
  console.log(`capabilities: required=${joinList(result.capabilities.required)} supported=${joinList(result.capabilities.supported)} unsupported=${joinList(result.capabilities.unsupported)}`);
  console.log(`host imports: used=${joinList(result.hostImports.used)} unsupported=${joinList(result.hostImports.unsupported)}`);
  if (Array.isArray(result.modules) && result.modules.length) {
    console.log(`modules: ${result.modules.map((mod) => `${mod.path}[exports=${joinList(mod.exports)}]`).join("; ")}`);
  }
  if (Array.isArray(result.authorityChains) && result.authorityChains.length) {
    console.log(`authority chains: ${result.authorityChains.map((item) => `${item.chain.join(" -> ")} (${item.requiredCapability || "unknown"})`).join("; ")}`);
  }
  for (const diagnostic of result.moduleDiagnostics || []) {
    console.log(`module diagnostic: ${diagnostic.code}: ${diagnostic.callerModule} -> ${diagnostic.targetModule}: ${diagnostic.summary}`);
    for (const symbol of diagnostic.symbols || []) {
      console.log(`  symbol ${symbol.name}: callSites=${symbol.callSites}`);
    }
    if (diagnostic.repair) console.log(`repair: ${diagnostic.repair}`);
  }
  const manifestKinds = Object.keys(result.manifests || {}).sort();
  console.log(`manifests: ${manifestKinds.length ? manifestKinds.map((kind) => `${kind}:${result.manifests[kind].exists ? "ok" : "missing"}(${result.manifests[kind].path})`).join(", ") : "none"}`);
  for (const check of (result.checks || []).filter((item) => item.status === "fail" || item.status === "warn")) {
    console.log(`check ${check.status}: ${check.id}: ${check.message}`);
    if (check.repairHint) console.log(`repair: ${check.repairHint}`);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  for (const error of result.errors) console.error(`error: ${error}`);
  for (const hint of result.repairHints || []) console.error(`repair: ${hint}`);
}

function printPackageGraphSummary(result) {
  console.log(`package: ${result.package}`);
  if (result.entry) console.log(`entry: ${result.entry}`);
  console.log(`status: ${result.status}`);
  console.log(`linked wasm: ${result.linkedWasm ? "yes" : "no"}`);
  console.log(`modules: ${result.modules.map((mod) => `${mod.path}[functions=${mod.functions.length}, globals=${mod.globals.length}, tables=${mod.staticTables.length}]`).join("; ") || "none"}`);
  console.log(`capabilities: declared=${joinList(result.declaredCapabilities)} computed=${joinList(result.computedCapabilities)}`);
  console.log(`host imports: ${joinList(result.hostImports.used)}`);
  for (const diagnostic of result.moduleDiagnostics || []) {
    console.log(`module diagnostic: ${diagnostic.code}: ${diagnostic.callerModule} -> ${diagnostic.targetModule}: ${diagnostic.summary}`);
    if (diagnostic.repair) console.log(`repair: ${diagnostic.repair}`);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  for (const error of result.errors) console.error(`error: ${error}`);
}

function printSemanticPatchSummary(evidence) {
  console.log(`semantic patch: ${evidence.status}`);
  console.log(`mode: ${evidence.mode}`);
  console.log(`classification: ${(evidence.classifications || []).join(",") || "unknown_unproven"}`);
  console.log(`operations: ${evidence.operationCount}`);
  console.log(`patch digest: ${evidence.patchDigest || "-"}`);
  for (const reason of evidence.rejectedReasons || []) console.log(`rejected: ${reason}`);
}

function joinList(values) {
  return values && values.length ? values.join(",") : "-";
}

function printSurfaceSummary(report) {
  console.log(`surface: ${report.reportVersion}`);
  console.log(`profile: ${report.profile}`);
  console.log(`active core features: ${joinList(report.activeCoreFeatures)}`);
  console.log(`stdlib modules: ${joinList(report.stdlib.modules.map((item) => item.name))}`);
  console.log(`kits: ${joinList(report.kits.map((item) => item.name))}`);
  console.log(`supported capabilities: ${joinList(report.hostProfiles.selected.supportedCapabilities)}`);
  console.log(`supported host imports: ${joinList(report.hostProfiles.selected.supportedHostImports)}`);
}

function printLspDiagnosticSummary(report) {
  console.log(`check: ${report.target}`);
  console.log(`kind: ${report.kind}`);
  console.log(`status: ${report.status}`);
  for (const diagnostic of report.diagnostics || []) {
    const location = diagnostic.file ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}` : "<package>";
    console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location}: ${diagnostic.message}`);
    if (diagnostic.repairHint) console.log(`  repair: ${diagnostic.repairHint}`);
  }
}

function replaceExt(file, ext) {
  const parsed = path.parse(file);
  return path.join(parsed.dir, `${parsed.name}.${ext}`);
}

function printHelp() {
  console.log(`airc <command> <file> [options]

Commands:
  fmt      Print canonical AIR
  format <file> [--check|--write|--json]
           Print, check, or write canonical AIR
  format --stdin [--json]
           Read AIR from stdin and print canonical AIR
  format --canonical <file>
           Compatibility spelling for canonical AIR output
  verify   Run parser and verifier (--library allows no entrypoint)
  explain  Print a human behavior summary
  audit    Print capabilities, imports, and memory risks
  report   Print deterministic JSON conformance/report metadata
           (--ai-review adds generated-code repair diagnostics)
           Use "report package <dir> --json" for package module graph reports
  check    Print LSP-lite diagnostics for a file or package (--lsp-json)
  diff package <old-dir> <new-dir> --json
           Print deterministic package evidence diff metadata
  semantic-patch generate <base-dir> <result-dir> -o <patch.json>
           Generate a digest-bound canonical semantic patch
  semantic-patch inspect <patch.json> [--strict] --json
           Inspect classification, compatibility, and non-expansion evidence
  semantic-patch verify <patch.json> --strict --json
           Fail closed unless strict non-expansion is proven
  semantic-patch apply <patch.json> <base-dir> -o <result-dir> [--strict]
           Apply operations to the exact bound base and verify the result digest
  evidence report <dir> --format markdown -o <file>
           Write human-readable package evidence report
           Optional: --host-evidence <json> --conformance <json> --e2e-proof <json> --benchmark <json>
           Optional: --semantic-patch <json> [--semantic-patch-strict]
  lsp      Run diagnostics-only JSON-RPC LSP server (--stdio)
  audio-check Validate host/project audio authority declarations
  wit      Print WIT-compatible interface metadata
  gfx-check Validate AIR + AIR GFX manifest
  input-check Validate AIR input capability + interactive manifest
  app-check Validate AIR interactive app package manifest
  gfx-wit   Print WIT-compatible metadata plus GFX manifest summary
  gfx-build Build AIR wasm and copy GFX manifest/assets to an output directory
  gfx-import Build a manifest fragment for OBJ/FBX/USD/glTF/GLB or texture assets
  stdlib Print AI-facing AIR standard library catalog
  registry Print machine-readable AIR layer registry
  surface Print v0.14 allowed/rejected generation surface (--profile <id>, --json)
  gfx-stdlib Print AI-facing AIR GFX standard block catalog
  package-manifest-check Validate air.package.json in an AIR package directory
  verify package <dir> Verify an AIR package authored module graph (--json emits verification evidence)
                       Use --host-evidence <json> to attach host interaction evidence summary
                       Use --semantic-patch <json> to attach deterministic semantic patch evidence
  report package <dir> Print package authored module graph report (--json)
                       Use --review-baseline to emit air.review.baseline.json
                       Use --compare-baseline <path> to add trend diagnostics
  package-check Validate an AIR package directory (--profile <id>, --json, --source-only)
  package Create deterministic first-slice airpkg JSON metadata (-o <output.airpkg.json>)
  inspect-airpkg Inspect deterministic airpkg JSON metadata
  check-airpkg Validate deterministic airpkg JSON metadata (--profile <id>, --json)
  mock-host Run deterministic mock host policy over command buffer intents
            (--policy <policy.json>, --profile <id>, --trace <trace.json>, --json)
  bundle Create deterministic web-dev/native-dev target bundle folder
  check-bundle Validate deterministic target bundle folder (--json)
  link-plan Print deterministic package link plan metadata (--profile <id>, --json)
  generate-handles Generate package-local AIR handle helper modules
  generate state-handles <dir>
           Generate package-local fixed state handle constants and metadata
  generate output-handles <dir>
           Generate package-local output handle constants and metadata
  conformance Run deterministic host/profile conformance trace (--profile <id>, --trace <trace.json>)
  conformance-fixture Build a named conformance fixture package
  benchmark <dir> Run a deterministic benchmark descriptor (--json)
  run-proof <dir> --fixture <fixture.json> --policy <policy.json>
           Run deterministic end-to-end execution proof (--json)
  eval-ai import <dir>
           Import sanitized external AI eval captures from files (--json)
  eval-ai benchmark <dir> --import <capture-dir>
           Compare paired readable AIR and TypeScript authoring results (--json)
           Use --adapter-config <file> for one explicit external adapter call per pair
  build    Emit WAT or WASM
  build package <dir> --linked-wasm -o <output.wasm>
           Emit first-slice deterministic linked package WAT/Wasm plus sidecar report
  version  Print compiler/runtime ABI version

Build options:
  --source-profile legacy-v0.50|typed-v0.51
           Select the versioned source grammar explicitly (default: legacy-v0.50)
  --emit wat|wasm
  -o, --output <path>

GFX options:
  --manifest <path>
  --audio-manifest <path>
  --profile <host-profile-id>
  --source-only, --no-built
  --lsp-json
  --out <dir>
  --name <asset_key>

Conformance fixtures:
  airc conformance-fixture math --out build/conformance/math
  airc conformance-fixture data --out build/conformance/data
  airc conformance-fixture collections --out build/conformance/collections
  airc conformance-fixture grid --out build/conformance/grid
  airc conformance-fixture utility --out build/conformance/utility
  airc conformance-fixture network-packet --out build/conformance/network-packet
  airc conformance-fixture gpu --out build/conformance/gpu
  airc conformance-fixture ui-tool --out build/conformance/ui-tool`);
}

main(process.argv.slice(2)).then((code) => {
  if (typeof code === "number") process.exitCode = code;
}).catch((err) => {
  if (err instanceof VerificationError || err instanceof AirError) {
    console.error(err.message);
  } else if (err instanceof ProvenanceFlowError) {
    for (const diagnostic of err.diagnostics || []) {
      const location = diagnostic.file
        ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`
        : "<module>";
      console.error(`${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location}: ${diagnostic.message}`);
    }
  } else {
    console.error(err && err.stack ? err.stack : String(err));
  }
  process.exitCode = 1;
});
