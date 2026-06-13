#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REQUIRE_UPSTREAM=0
NEXT_ACTION="Review the bundle and confirm blockers before merge or next prompt."
while [ "$#" -gt 0 ]; do
  case "$1" in
    --require-upstream) REQUIRE_UPSTREAM=1 ;;
    --next-action)
      shift
      if [ "$#" -eq 0 ] || [ -z "$1" ]; then
        echo "ERROR: --next-action requires a non-empty value." >&2
        exit 1
      fi
      NEXT_ACTION="$1"
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

COMMAND_NAMES=()
COMMAND_STATUSES=()
COMMAND_LINES=()

record_command() {
  COMMAND_NAMES+=("$1")
  COMMAND_STATUSES+=("$2")
  COMMAND_LINES+=("$3")
}

run_checked() {
  local name="$1"
  local command="$2"
  echo
  echo "==> $command"
  if bash -lc "$command"; then
    record_command "$name" "pass" "$command"
  else
    local status=$?
    record_command "$name" "fail" "$command"
    echo
    echo "ERROR: agent finish check failed: $command" >&2
    echo "Bundle is not ready." >&2
    exit "$status"
  fi
}

sanitize_branch() {
  printf '%s' "$1" | tr '/ ' '--' | tr -cd 'A-Za-z0-9._-'
}

core_status_short() {
  local line path
  git status --short | while IFS= read -r line; do
    path="${line#???}"
    case "$path" in
      demo|demo/*|demos|demos/*) continue ;;
      MOBILE_SUMMARY.md|REVIEW_REQUEST.md|CONSUMER_EVIDENCE_SUMMARY.md) continue ;;
    esac
    printf '%s\n' "$line"
  done
}

feature_status_for_branch() {
  local branch="$1"
  local version candidate latest

  version="$(printf '%s' "$branch" | sed -n 's#.*v\([0-9][0-9]*\.[0-9][0-9]*\).*#v\1#p')"
  if [ -n "$version" ]; then
    candidate="docs/FEATURE_STATUS_${version}.md"
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi

  latest="$(find docs -maxdepth 1 -type f -name 'FEATURE_STATUS_v*.md' | sort -V | tail -1 || true)"
  if [ -n "$latest" ]; then
    printf '%s\n' "$latest"
  fi
}

read_red_flags_status() {
  if [ ! -f REVIEW_RESULTS/RED_FLAGS.md ]; then
    printf 'missing'
    return
  fi
  if grep -q '^- None$' REVIEW_RESULTS/RED_FLAGS.md; then
    printf 'none'
  else
    printf 'active'
  fi
}

write_consumer_evidence_summary() {
  local check_file="$1"
  local branch="$2"
  local commit_short="$3"

  node - "$check_file" "$branch" "$commit_short" > CONSUMER_EVIDENCE_SUMMARY.md <<'NODE'
const fs = require("fs");

const [checkFile, branch, commit] = process.argv.slice(2);
const check = JSON.parse(fs.readFileSync(checkFile, "utf8"));
const registry = JSON.parse(fs.readFileSync("consumer_evidence/DEMO_REGISTRY.json", "utf8"));

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function flattenUnique(items, key) {
  const values = new Set();
  for (const item of items) {
    for (const value of item[key] || []) values.add(value);
  }
  return [...values].sort();
}

function bulletList(items) {
  if (!items.length) return "- none\n";
  return items.map((item) => `- ${item}`).join("\n") + "\n";
}

function countList(entries) {
  if (!entries.length) return "- none\n";
  return entries.map(([key, count]) => `- ${key}: ${count}`).join("\n") + "\n";
}

const demos = [...(registry.demos || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const pending = demos
  .filter((demo) => demo.replayCount === 0 || demo.status === "proposed" || demo.status === "pressure-evidence")
  .map((demo) => `${demo.id}: ${demo.notes && demo.notes.length ? demo.notes.join("; ") : "pending or pressure-only evidence"}`);

const proofTypes = flattenUnique(demos, "proofTypes");
const allowedCapabilities = flattenUnique(demos, "allowedCapabilities");
const deniedAuthorities = flattenUnique(demos, "deniedAuthorities");
const replayCovered = demos.filter((demo) => Number(demo.replayCount || 0) > 0).map((demo) => demo.id).sort();
const diagnostics = (check.diagnostics || []).map((diagnostic) => `${diagnostic.code}: ${diagnostic.file}: ${diagnostic.message}`);

process.stdout.write(`# AIR Consumer Evidence Summary

Branch: ${branch}

Commit: ${commit}

## Validator

- kind: ${check.kind}
- status: ${check.status}
- demos checked: ${check.demoCount}
- passed: ${check.passed}
- failed: ${check.failed}

## Demo Count

${demos.length}

## Categories

${countList(countBy(demos, "category"))}
## Proof Coverage

${bulletList(proofTypes)}
## Allowed Capabilities Coverage

${bulletList(allowedCapabilities)}
## Denied Authorities Coverage

${bulletList(deniedAuthorities)}
## Replay Coverage

${bulletList(replayCovered)}
## Pending Evidence Items

${bulletList(pending)}
## Diagnostics

${bulletList(diagnostics)}
`);
NODE
}

check_review_results_commit() {
  local current summary_commit
  current="$(git rev-parse HEAD)"
  summary_commit="$(
    node -e '
const fs = require("fs");
const text = fs.existsSync("REVIEW_RESULTS/SUMMARY.md") ? fs.readFileSync("REVIEW_RESULTS/SUMMARY.md", "utf8") : "";
const m = text.match(/^Commit:\s*`([^`]+)`/m);
process.stdout.write(m ? m[1] : "");
'
  )"
  if [ -z "$summary_commit" ]; then
    echo "INFO: REVIEW_RESULTS/SUMMARY.md is missing current commit metadata; running RC checks." >&2
    run_checked "bash scripts/run_rc_checks.sh" "AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS=0 bash scripts/run_rc_checks.sh"
    summary_commit="$(
      node -e '
const fs = require("fs");
const text = fs.existsSync("REVIEW_RESULTS/SUMMARY.md") ? fs.readFileSync("REVIEW_RESULTS/SUMMARY.md", "utf8") : "";
const m = text.match(/^Commit:\s*`([^`]+)`/m);
process.stdout.write(m ? m[1] : "");
'
    )"
  fi
  if [ "$summary_commit" != "$current" ]; then
    echo "INFO: REVIEW_RESULTS commit does not match current source commit; running RC checks." >&2
    echo "REVIEW_RESULTS/SUMMARY.md: $summary_commit" >&2
    echo "current source commit:       $current" >&2
    run_checked "bash scripts/run_rc_checks.sh" "AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS=0 bash scripts/run_rc_checks.sh"
    summary_commit="$(
      node -e '
const fs = require("fs");
const text = fs.existsSync("REVIEW_RESULTS/SUMMARY.md") ? fs.readFileSync("REVIEW_RESULTS/SUMMARY.md", "utf8") : "";
const m = text.match(/^Commit:\s*`([^`]+)`/m);
process.stdout.write(m ? m[1] : "");
'
    )"
    if [ "$summary_commit" != "$current" ]; then
      echo "ERROR: REVIEW_RESULTS commit still does not match current source commit after RC checks." >&2
      echo "REVIEW_RESULTS/SUMMARY.md: $summary_commit" >&2
      echo "current source commit:       $current" >&2
      exit 1
    fi
  fi
}

archive_extension() {
  if command -v zip >/dev/null 2>&1; then
    printf 'zip'
  else
    printf 'tar.gz'
  fi
}

archive_list() {
  local archive="$1"
  case "$archive" in
    *.zip) unzip -Z1 "$archive" ;;
    *.tar.gz) tar -tzf "$archive" ;;
    *)
      echo "ERROR: unsupported review bundle archive type: $archive" >&2
      return 1
      ;;
  esac
}

archive_cat() {
  local archive="$1"
  local pattern="$2"
  local entries member
  entries="$(archive_list "$archive")" || return 1
  member="$(printf '%s\n' "$entries" | grep "$pattern" | head -1 || true)"
  if [ -z "$member" ]; then
    return 1
  fi
  case "$archive" in
    *.zip) unzip -p "$archive" "$member" ;;
    *.tar.gz) tar -xOzf "$archive" "$member" ;;
    *)
      echo "ERROR: unsupported review bundle archive type: $archive" >&2
      return 1
      ;;
  esac
}

write_mobile_summary() {
  local branch="$1"
  local commit_short="$2"
  local commit_full="$3"
  local upstream_label="$4"
  local ahead_count="$5"
  local behind_count="$6"
  local bundle_path="$7"
  local red_flags="$8"
  local next_action="$9"
  local changed_files

  changed_files="$(git show --name-only --format= HEAD | sed '/^$/d' | head -40 || true)"

  {
    echo "# AIR Agent Finish Mobile Summary"
    echo
    echo "- Branch: \`$branch\`"
    echo "- Commit: \`$commit_short\`"
    echo "- Dirty status: \`no\`"
    echo "- Upstream: \`$upstream_label\`"
    echo "- Ahead/behind: \`${ahead_count}/${behind_count}\`"
    echo "- AIR ABI: \`0.10\` unchanged"
    echo "- Host ABI: latest \`0.11\` bounded \`output.emit\`; baseline \`0.10\` unchanged"
    echo "- RED_FLAGS: \`$red_flags\`"
    echo "- Review bundle: \`$bundle_path\`"
    echo
    echo "## Files Changed In Current Commit"
    echo
    if [ -n "$changed_files" ]; then
      printf '%s\n' "$changed_files" | sed 's/^/- `/' | sed 's/$/`/'
    else
      echo "- none detected"
    fi
    echo
    echo "## Commands"
    echo
    local i
    for i in "${!COMMAND_NAMES[@]}"; do
      echo "- ${COMMAND_STATUSES[$i]}: \`${COMMAND_LINES[$i]}\`"
    done
    echo
    echo "## Next Recommended Action"
    echo
    echo "- $next_action"
  } > MOBILE_SUMMARY.md
}

write_review_request() {
  local branch="$1"
  local commit_short="$2"
  local bundle_path="$3"
  local scope_summary=""
  local feature_status=""

  feature_status="$(feature_status_for_branch "$branch")"
  if [ -n "$feature_status" ] && [ -f "$feature_status" ]; then
    scope_summary="$(
      sed -n '1,35p' "$feature_status" |
        sed 's/[[:space:]]\+$//' |
        perl -pe 's{\]\(\.\./}{](}g; s{\]\((?!https?://|#|/|docs/|requests/)([^)]+)\)}{](docs/$1)}g'
    )"
  fi

  {
    echo "# AIR Review Request"
    echo
    echo "Please review the AIR Core bundle for release/blocker risk."
    echo
    echo "- Bundle: \`$bundle_path\`"
    echo "- Branch: \`$branch\`"
    echo "- Commit: \`$commit_short\`"
    echo "- AIR ABI: \`0.10\` unchanged"
    echo "- Host ABI: latest \`0.11\` bounded \`output.emit\`; baseline \`0.10\` unchanged"
    echo
    echo "## Scope Summary"
    echo
    if [ -n "$scope_summary" ]; then
      printf '%s\n' "$scope_summary"
    else
      echo "No feature status summary found."
    fi
    echo
    echo "## Review Focus"
    echo
    echo "Check for:"
    echo
    echo "- release blockers;"
    echo "- architecture risks;"
    echo "- stale active docs;"
    echo "- forbidden implementation;"
    echo "- AIR ABI drift;"
    echo "- Host ABI drift;"
    echo "- review bundle omissions;"
    echo "- RED_FLAGS issues."
    echo
    echo "Do not assume planned/deferred docs are implemented. Treat demos as pressure evidence only unless the bundle explicitly marks them as Core artifacts."
  } > REVIEW_REQUEST.md
}

verify_bundle() {
  local archive="$1"
  local current entries
  current="$(git rev-parse HEAD)"

  if [ ! -f "$archive" ]; then
    echo "ERROR: expected review bundle archive was not created: $archive" >&2
    exit 1
  fi

  if ! entries="$(archive_list "$archive")"; then
    echo "ERROR: review bundle archive is unreadable: $archive" >&2
    exit 1
  fi

  if ! printf '%s\n' "$entries" | grep -q '/SNAPSHOT_PREBUNDLE_GIT.txt$'; then
    echo "ERROR: review bundle missing SNAPSHOT_PREBUNDLE_GIT.txt" >&2
    exit 1
  fi
  if ! printf '%s\n' "$entries" | grep -q '/MOBILE_SUMMARY.md$'; then
    echo "ERROR: review bundle missing MOBILE_SUMMARY.md" >&2
    exit 1
  fi
  if ! printf '%s\n' "$entries" | grep -q '/REVIEW_REQUEST.md$'; then
    echo "ERROR: review bundle missing REVIEW_REQUEST.md" >&2
    exit 1
  fi
  if [ -f CONSUMER_EVIDENCE_SUMMARY.md ] && ! printf '%s\n' "$entries" | grep -Eq '(^|/)CONSUMER_EVIDENCE_SUMMARY\.md$'; then
    echo "ERROR: review bundle missing CONSUMER_EVIDENCE_SUMMARY.md" >&2
    exit 1
  fi
  if archive_cat "$archive" '/SNAPSHOT_COMMIT.txt$' | grep -q '^dirty: yes$'; then
    echo "ERROR: review bundle snapshot is dirty" >&2
    exit 1
  fi
  if ! archive_cat "$archive" '/REVIEW_RESULTS/SUMMARY.md$' | grep -q "Commit: \`$current\`"; then
    echo "ERROR: bundle REVIEW_RESULTS commit does not match current commit" >&2
    exit 1
  fi
  if ! archive_cat "$archive" '/REVIEW_RESULTS/RED_FLAGS.md$' | grep -q '^- None$'; then
    echo "ERROR: bundle RED_FLAGS is not clean" >&2
    exit 1
  fi
}

echo "==> agent finish preflight"

echo "$ git fetch origin --prune"
git fetch origin --prune

BRANCH="$(git branch --show-current)"
if [ -z "$BRANCH" ]; then
  echo "ERROR: current branch is missing or detached." >&2
  exit 1
fi

COMMIT_SHORT="$(git rev-parse --short HEAD)"
COMMIT_FULL="$(git rev-parse HEAD)"
STATUS_SHORT="$(core_status_short || true)"

echo "$ git branch --show-current"
echo "$BRANCH"
echo "$ git rev-parse --short HEAD"
echo "$COMMIT_SHORT"
echo "$ git status --short"
git status --short

if [ -n "$STATUS_SHORT" ]; then
  echo "ERROR: dirty working tree is not allowed for agent finish." >&2
  echo "$STATUS_SHORT" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required." >&2
  exit 1
fi

echo "$ node -v"
node -v
echo "$ npm -v"
npm -v

UPSTREAM=""
UPSTREAM_LABEL="none"
AHEAD_COUNT=0
BEHIND_COUNT=0
if UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null)"; then
  UPSTREAM_LABEL="$UPSTREAM"
  echo "$ git rev-parse --abbrev-ref --symbolic-full-name @{upstream}"
  echo "$UPSTREAM"
  echo "$ git log --oneline $UPSTREAM..HEAD"
  git log --oneline "$UPSTREAM..HEAD"
  echo "$ git log --oneline HEAD..$UPSTREAM"
  git log --oneline "HEAD..$UPSTREAM"
  AHEAD_COUNT="$(git rev-list --count "$UPSTREAM..HEAD")"
  BEHIND_COUNT="$(git rev-list --count "HEAD..$UPSTREAM")"
  if [ "$BEHIND_COUNT" -gt 0 ]; then
    echo "ERROR: HEAD is behind upstream. Run git pull --ff-only before agent finish." >&2
    exit 1
  fi
else
  if [ "$REQUIRE_UPSTREAM" = "1" ]; then
    echo "ERROR: no upstream configured for current branch." >&2
    exit 1
  fi
  echo "warning: no upstream configured for current branch"
fi

run_checked "npm test" "npm test"
run_checked "npm run test:bundle" "npm run test:bundle"

if node -e 'const p=require("./package.json"); process.exit(p.scripts && p.scripts["check:consumer-evidence"] ? 0 : 1)' >/dev/null 2>&1; then
  run_checked "npm run check:consumer-evidence" "npm run check:consumer-evidence"
fi

while IFS= read -r script; do
  base="$(basename "$script" .js)"
  version="${base#check_api_gates_}"
  version="${version//_/.}"
  run_checked "npm run check:api-gates:$version" "npm run check:api-gates:$version"
done < <(find scripts -maxdepth 1 -type f -name 'check_api_gates_v0_*.js' | sort)

run_checked "bash scripts/run_rc_checks.sh" "bash scripts/run_rc_checks.sh"
check_review_results_commit

run_checked "node scripts/check_markdown_links.js" "node scripts/check_markdown_links.js"
run_checked "node scripts/check_abi_requests.js" "node scripts/check_abi_requests.js"
run_checked "node test/layer_guard.test.js" "node test/layer_guard.test.js"
run_checked "git diff --check" "git diff --check"
run_checked "node scripts/check_review_bundle.js --keep" "node scripts/check_review_bundle.js --keep"

RED_FLAGS_STATUS="$(read_red_flags_status)"
if [ "$RED_FLAGS_STATUS" != "none" ]; then
  echo "ERROR: RED_FLAGS is not clean." >&2
  exit 1
fi

OUT_DIR="${AGENT_FINISH_OUT_DIR:-snapshots/agent_finish}"
BUNDLE_NAME="${AGENT_FINISH_BUNDLE_NAME:-$(date -u +%Y-%m-%d_%H-%M-%S)_airlang-review_${COMMIT_SHORT}-agent-finish}"
EXT="$(archive_extension)"
BUNDLE_PATH="$OUT_DIR/$BUNDLE_NAME.$EXT"

write_mobile_summary "$BRANCH" "$COMMIT_SHORT" "$COMMIT_FULL" "$UPSTREAM_LABEL" "$AHEAD_COUNT" "$BEHIND_COUNT" "$BUNDLE_PATH" "$RED_FLAGS_STATUS" "$NEXT_ACTION"
write_review_request "$BRANCH" "$COMMIT_SHORT" "$BUNDLE_PATH"
if [ -f consumer_evidence/DEMO_REGISTRY.json ]; then
  CONSUMER_CHECK_JSON="$(mktemp)"
  node scripts/check_consumer_evidence.js > "$CONSUMER_CHECK_JSON"
  write_consumer_evidence_summary "$CONSUMER_CHECK_JSON" "$BRANCH" "$COMMIT_SHORT"
  rm -f "$CONSUMER_CHECK_JSON"
fi

echo
echo "==> creating final review bundle with generated summaries"
BUNDLE_NAME="$BUNDLE_NAME" OUT_DIR="$OUT_DIR" bash scripts/make_review_bundle.sh "$ROOT"
verify_bundle "$BUNDLE_PATH"

echo
echo "agent finish: pass"
echo "bundle: $BUNDLE_PATH"
