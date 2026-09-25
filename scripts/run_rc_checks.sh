#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RESULTS_DIR="$ROOT/REVIEW_RESULTS"
LOG_DIR="$RESULTS_DIR/logs"
CHECKS_JSONL="$RESULTS_DIR/.checks.jsonl"
COMMANDS_LOG="$RESULTS_DIR/COMMANDS.log"
SUMMARY_MD="$RESULTS_DIR/SUMMARY.md"
RED_FLAGS_MD="$RESULTS_DIR/RED_FLAGS.md"
CHECKS_JSON="$RESULTS_DIR/CHECKS.json"

rm -rf "$RESULTS_DIR"
mkdir -p "$LOG_DIR"
: > "$CHECKS_JSONL"
: > "$COMMANDS_LOG"

STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then
  BRANCH="DETACHED_HEAD"
fi
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo nogit)"
AIR_ALLOW_DIRTY_REVIEW_BUNDLE="${AIR_ALLOW_DIRTY_REVIEW_BUNDLE:-0}"
FAILED_REQUIRED=0

is_demo_status_line() {
  local line="$1"
  local path="${line#???}"

  case "$path" in
    demo|demo/*|demos|demos/*) return 0 ;;
    *" -> demo"|*" -> demo/"*|*" -> demos"|*" -> demos/"*) return 0 ;;
  esac

  return 1
}

core_git_status_short() {
  local line
  git status --short 2>/dev/null | while IFS= read -r line; do
    if ! is_demo_status_line "$line"; then
      printf '%s\n' "$line"
    fi
  done
}

INITIAL_STATUS="$(core_git_status_short || true)"

if [ -n "$INITIAL_STATUS" ] && [ "$AIR_ALLOW_DIRTY_REVIEW_BUNDLE" != "1" ]; then
  echo "ERROR: dirty working tree is not allowed for Core RC/review checks." >&2
  echo "Commit or stash changes before running RC checks." >&2
  echo "Dirty paths under demo/ and demos/ are ignored by Core RC checks; use a separate demo review flow for them." >&2
  echo "Use AIR_ALLOW_DIRTY_REVIEW_BUNDLE=1 only for explicit dirty planning/debug snapshots." >&2
  echo "$INITIAL_STATUS" >&2
  exit 1
fi

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

append_check() {
  local name="$1"
  local command="$2"
  local status="$3"
  local duration_ms="$4"
  local reason="$5"
  local log_path="$6"
  local excerpt="$7"

  node - "$CHECKS_JSONL" "$name" "$command" "$status" "$duration_ms" "$reason" "$log_path" "$excerpt" <<'NODE'
const fs = require("fs");
const [file, name, command, status, durationMs, reason, logPath, logExcerpt] = process.argv.slice(2);
fs.appendFileSync(file, JSON.stringify({
  name,
  command,
  status,
  durationMs: durationMs === "" ? null : Number(durationMs),
  reason: reason || undefined,
  logPath: logPath || undefined,
  logExcerpt: logExcerpt || undefined
}) + "\n");
NODE
}

run_check() {
  local name="$1"
  local command="$2"
  local cwd="${3:-$ROOT}"
  local required="${4:-required}"
  local slug
  slug="$(slugify "$name")"
  local log="$LOG_DIR/$slug.log"
  local rel_log="REVIEW_RESULTS/logs/$slug.log"
  local start end duration status excerpt

  start="$(now_ms)"
  {
    printf '\n## %s\n' "$name"
    printf 'cwd: %s\n' "$cwd"
    printf 'command: %s\n' "$command"
    printf 'required: %s\n' "$required"
  } >> "$COMMANDS_LOG"

  if (cd "$cwd" && bash -lc "$command") > "$log" 2>&1; then
    status="pass"
  else
    status="fail"
    if [ "$required" = "required" ]; then
      FAILED_REQUIRED=1
    fi
  fi

  end="$(now_ms)"
  duration=$((end - start))
  cat "$log" >> "$COMMANDS_LOG"
  printf '\nstatus: %s\n' "$status" >> "$COMMANDS_LOG"
  excerpt="$(tail -n 40 "$log")"
  append_check "$name" "$command" "$status" "$duration" "" "$rel_log" "$excerpt"
  printf '%s - %s\n' "$status" "$name"
}

skip_check() {
  local name="$1"
  local command="$2"
  local reason="$3"
  append_check "$name" "$command" "skip" "" "$reason" "" ""
  {
    printf '\n## %s\n' "$name"
    printf 'command: %s\n' "$command"
    printf 'status: skip\n'
    printf 'reason: %s\n' "$reason"
  } >> "$COMMANDS_LOG"
  printf 'skip - %s (%s)\n' "$name" "$reason"
}

run_check "npm ci" "npm ci"
run_check "Playwright browser identity" "node scripts/check_playwright_identity.js REVIEW_RESULTS/BROWSER_IDENTITY.json"
run_check "npm test" "npm test"
run_check "markdown links" "node scripts/check_markdown_links.js"
run_check "ABI request pipeline" "node scripts/check_abi_requests.js"
run_check "request ledger" "npm run check:request-ledger"
run_check "public claims" "npm run check:public-claims"
run_check "public package surface" "node scripts/check_public_package_surface.js"
run_check "release lane" "npm run check:release-lane"
run_check "review protocol" "npm run check:review-protocol"
run_check "review bundle policy" "npm run check:review-bundle-policy"
if [ -f "$ROOT/scripts/check_api_gates_v0_21.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.21.md" ]; then
  run_check "v0.21 API gates" "npm run check:api-gates:v0.21"
else
  skip_check "v0.21 API gates" "npm run check:api-gates:v0.21" "v0.21 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_22.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.22.md" ]; then
  run_check "v0.22 API gates" "npm run check:api-gates:v0.22"
else
  skip_check "v0.22 API gates" "npm run check:api-gates:v0.22" "v0.22 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_26.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.26.md" ]; then
  run_check "v0.26 API gates" "npm run check:api-gates:v0.26"
else
  skip_check "v0.26 API gates" "npm run check:api-gates:v0.26" "v0.26 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_27.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.27.md" ]; then
  run_check "v0.27 API gates" "npm run check:api-gates:v0.27"
else
  skip_check "v0.27 API gates" "npm run check:api-gates:v0.27" "v0.27 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_28.js" ] && [ -f "$ROOT/docs/OUTPUT_EMIT_AUTHORING.md" ]; then
  run_check "v0.28 API gates" "npm run check:api-gates:v0.28"
else
  skip_check "v0.28 API gates" "npm run check:api-gates:v0.28" "v0.28 API gate script or output emit authoring docs not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_32.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.32.md" ]; then
  run_check "v0.32 API gates" "npm run check:api-gates:v0.32"
else
  skip_check "v0.32 API gates" "npm run check:api-gates:v0.32" "v0.32 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_33.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.33.md" ]; then
  run_check "v0.33 API gates" "npm run check:api-gates:v0.33"
else
  skip_check "v0.33 API gates" "npm run check:api-gates:v0.33" "v0.33 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_37.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.37.md" ]; then
  run_check "v0.37 API gates" "npm run check:api-gates:v0.37"
else
  skip_check "v0.37 API gates" "npm run check:api-gates:v0.37" "v0.37 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_38.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.38.md" ]; then
  run_check "v0.38 API gates" "npm run check:api-gates:v0.38"
else
  skip_check "v0.38 API gates" "npm run check:api-gates:v0.38" "v0.38 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_39.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.39.md" ]; then
  run_check "v0.39 API gates" "npm run check:api-gates:v0.39"
else
  skip_check "v0.39 API gates" "npm run check:api-gates:v0.39" "v0.39 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_40.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.40.md" ]; then
  run_check "v0.40 API gates" "npm run check:api-gates:v0.40"
else
  skip_check "v0.40 API gates" "npm run check:api-gates:v0.40" "v0.40 API gate script or feature status not present on this branch"
fi
if [ -f "$ROOT/scripts/check_api_gates_v0_41.js" ] && [ -f "$ROOT/docs/FEATURE_STATUS_v0.41.md" ]; then
  run_check "v0.41 API gates" "npm run check:api-gates:v0.41"
else
  skip_check "v0.41 API gates" "npm run check:api-gates:v0.41" "v0.41 API gate script or feature status not present on this branch"
fi
run_check "layer guard" "node test/layer_guard.test.js"
run_check "prompt to module demo" "node scripts/prompt_to_module_demo.js"
run_check "conformance report gfx stream" "node bin/airc.js report examples/gfx.air"
run_check "conformance report gpu manifest" "node bin/airc.js report examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json"
run_check "review bundle structural sanity" "node scripts/check_review_bundle.js --structure-only"

if [ -f "$ROOT/hosts/webgpu/package.json" ]; then
  run_check "WebGPU host npm ci" "npm ci" "$ROOT/hosts/webgpu"
  run_check "WebGPU host typecheck" "npm run typecheck" "$ROOT/hosts/webgpu"
  run_check "WebGPU host build" "npm run build" "$ROOT/hosts/webgpu"
  skip_check "WebGPU browser/GPU smoke" "npm --prefix hosts/webgpu run smoke" "browser/GPU-dependent manual check; not required for Core RC gate"
else
  skip_check "WebGPU host checks" "cd hosts/webgpu && npm ci && npm run typecheck && npm run build" "hosts/webgpu/package.json not present"
fi

FINISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

node - "$CHECKS_JSONL" "$CHECKS_JSON" <<'NODE'
const fs = require("fs");
const [input, output] = process.argv.slice(2);
const checks = fs.readFileSync(input, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
fs.writeFileSync(output, JSON.stringify({ checks }, null, 2) + "\n");
NODE

node - "$CHECKS_JSON" "$SUMMARY_MD" "$STARTED_AT" "$FINISHED_AT" "$BRANCH" "$COMMIT" "$INITIAL_STATUS" "$AIR_ALLOW_DIRTY_REVIEW_BUNDLE" <<'NODE'
const fs = require("fs");
const [checksFile, summaryFile, startedAt, finishedAt, branch, commit, initialStatus, allowDirty] = process.argv.slice(2);
const { checks } = JSON.parse(fs.readFileSync(checksFile, "utf8"));
const counts = checks.reduce((acc, check) => {
  acc[check.status] = (acc[check.status] || 0) + 1;
  return acc;
}, {});
const lines = [
  "# AIR Core Review Results",
  "",
  `Started: \`${startedAt}\``,
  `Finished: \`${finishedAt}\``,
  `Branch: \`${branch}\``,
  `Commit: \`${commit}\``,
  "",
  "The release checks were run in the source checkout before bundle creation.",
  "The review bundle is a review artifact and not the primary execution environment.",
  "Review-bundle package/profile tests rely on tiny deterministic fixtures under `test/fixtures/assets_minimal/` and `test/fixtures/package_minimal/`; large demo media may be omitted from the Core bundle.",
];
if (initialStatus.trim() && allowDirty === "1") {
  lines.push(
    "",
    "**Dirty planning snapshot:** this run was explicitly allowed with `AIR_ALLOW_DIRTY_REVIEW_BUNDLE=1`. It is not a Core RC review bundle and is not review-ready for release.",
    "",
    "Dirty working tree:",
    "",
    "```text",
    initialStatus.trim(),
    "```"
  );
}
lines.push(
  "",
  "## Summary",
  "",
  `- Passed: ${counts.pass || 0}`,
  `- Failed: ${counts.fail || 0}`,
  `- Skipped: ${counts.skip || 0}`,
  "",
  "| Check | Status | Duration | Log |",
  "|---|---:|---:|---|"
);
for (const check of checks) {
  const duration = check.durationMs == null ? "n/a" : `${check.durationMs}ms`;
  const log = check.logPath ? `\`${check.logPath}\`` : (check.reason || "");
  lines.push(`| ${check.name} | ${check.status} | ${duration} | ${log} |`);
}
fs.writeFileSync(summaryFile, lines.join("\n") + "\n");
NODE

node - "$CHECKS_JSON" "$RED_FLAGS_MD" "$INITIAL_STATUS" "$FAILED_REQUIRED" <<'NODE'
const fs = require("fs");
const [checksFile, redFlagsFile, initialStatus, failedRequired] = process.argv.slice(2);
const { checks } = JSON.parse(fs.readFileSync(checksFile, "utf8"));
const failed = checks.filter((check) => check.status === "fail");
const skippedRequired = checks.filter((check) => check.status === "skip" && !/manual|GPU-dependent/i.test(check.reason || ""));
const checkFailed = (name) => failed.some((check) => check.name === name);
const flags = [];

if (initialStatus.trim()) flags.push(["dirty working tree", initialStatus.trim()]);
if (failed.length) flags.push(["failed checks", failed.map((check) => check.name).join(", ")]);
if (skippedRequired.length) flags.push(["skipped required checks", skippedRequired.map((check) => check.name).join(", ")]);
if (checkFailed("markdown links")) flags.push(["broken markdown links", "node scripts/check_markdown_links.js failed"]);
if (checkFailed("ABI request pipeline")) flags.push(["ABI request validation failure", "node scripts/check_abi_requests.js failed"]);
if (checkFailed("request ledger")) flags.push(["request ledger validation failure", "npm run check:request-ledger failed"]);
if (checkFailed("v0.21 API gates")) flags.push(["API gate violation", "npm run check:api-gates:v0.21 failed"]);
if (checkFailed("v0.22 API gates")) flags.push(["v0.22 API gate violation", "npm run check:api-gates:v0.22 failed"]);
if (checkFailed("v0.26 API gates")) flags.push(["v0.26 API gate violation", "npm run check:api-gates:v0.26 failed"]);
if (checkFailed("v0.27 API gates")) flags.push(["v0.27 API gate violation", "npm run check:api-gates:v0.27 failed"]);
if (checkFailed("v0.28 API gates")) flags.push(["v0.28 API gate violation", "npm run check:api-gates:v0.28 failed"]);
if (checkFailed("v0.32 API gates")) flags.push(["v0.32 API gate violation", "npm run check:api-gates:v0.32 failed"]);
if (checkFailed("v0.33 API gates")) flags.push(["v0.33 API gate violation", "npm run check:api-gates:v0.33 failed"]);
if (checkFailed("v0.37 API gates")) flags.push(["v0.37 API gate violation", "npm run check:api-gates:v0.37 failed"]);
if (checkFailed("v0.38 API gates")) flags.push(["v0.38 API gate violation", "npm run check:api-gates:v0.38 failed"]);
if (checkFailed("v0.39 API gates")) flags.push(["v0.39 API gate violation", "npm run check:api-gates:v0.39 failed"]);
if (checkFailed("layer guard")) flags.push(["stdlib layer contamination", "node test/layer_guard.test.js failed"]);
if (initialStatus.split(/\r?\n/).some((line) => /\b(src\/host_abi\.js|spec\/(GFX_ABI|GFX_HIGH_LEVEL_ABI|UI_ABI|CAPABILITIES|AIR_CORE)\.md)\b/.test(line))) {
  flags.push(["public ABI/spec drift", "Host ABI or public spec files have uncommitted changes; review against RFC/migration policy"]);
}
if (checkFailed("ABI request pipeline")) flags.push(["demo requests not triaged", "Canonical ABI request validation failed"]);
if (checkFailed("request ledger")) flags.push(["promise debt ledger incomplete", "Formal request ledger validation failed"]);
if (checkFailed("markdown links")) flags.push(["missing required docs", "Markdown link validation failed"]);
if (checkFailed("review bundle structural sanity")) {
  flags.push(["bundle contains node_modules/dist/tmp_unused/old_bundles", "Review bundle structural sanity failed"]);
}
if (!fs.existsSync(checksFile)) flags.push(["review bundle generated without RC checks", "REVIEW_RESULTS/CHECKS.json missing"]);

const categories = [
  ["dirty working tree", "working tree status"],
  ["failed checks", "required check failures"],
  ["skipped required checks", "required check skips"],
  ["broken markdown links", "markdown links"],
  ["ABI request validation failure", "ABI request validation"],
  ["API gate violation", "v0.21 API gates"],
  ["v0.22 API gate violation", "v0.22 API gates"],
  ["v0.26 API gate violation", "v0.26 API gates"],
  ["v0.27 API gate violation", "v0.27 API gates"],
  ["v0.28 API gate violation", "v0.28 API gates"],
  ["v0.32 API gate violation", "v0.32 API gates"],
  ["v0.33 API gate violation", "v0.33 API gates"],
  ["v0.37 API gate violation", "v0.37 API gates"],
  ["v0.38 API gate violation", "v0.38 API gates"],
  ["v0.39 API gate violation", "v0.39 API gates"],
  ["stdlib layer contamination", "stdlib layer hygiene"],
  ["public ABI/spec drift", "public ABI/spec drift"],
  ["demo requests not triaged", "demo request triage"],
  ["missing required docs", "required docs"],
  ["bundle contains node_modules/dist/tmp_unused/old_bundles", "bundle forbidden content"],
  ["review bundle generated without RC checks", "review results presence"]
];
const lines = ["# RC Red Flags", "", "## Active", ""];
if (flags.length) {
  for (const [label, detail] of flags) {
    lines.push(`- FLAG: ${label} - ${detail.replace(/\n/g, "; ")}`);
  }
} else {
  lines.push("- None");
}

lines.push("", "## Checked Categories", "");
for (const [label, okLabel] of categories) {
  const found = flags.find(([name]) => name === label);
  lines.push(`- ${found ? "FLAG" : "OK"}: ${found ? label : okLabel}`);
}

if (failedRequired === "1") {
  lines.push("", "Required checks failed. Do not tag this RC until failures are resolved.");
}

fs.writeFileSync(redFlagsFile, lines.join("\n") + "\n");
NODE

rm -f "$CHECKS_JSONL"

echo "Wrote REVIEW_RESULTS/SUMMARY.md"
echo "Wrote REVIEW_RESULTS/CHECKS.json"
echo "Wrote REVIEW_RESULTS/RED_FLAGS.md"
echo "Wrote REVIEW_RESULTS/COMMANDS.log"

if [ "$FAILED_REQUIRED" -ne 0 ]; then
  exit 1
fi
