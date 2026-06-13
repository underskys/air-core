#!/usr/bin/env bash
set -euo pipefail

# AIR consumer evidence bundle builder.
#
# Packages standardized downstream demo/consumer evidence descriptors. This is
# not a Core review bundle and does not include full demo projects, media, build
# output, raw logs, or external demo source trees.
#
# Usage:
#   bash scripts/make_consumer_evidence_bundle.sh [repo-root]

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-snapshots/consumer_evidence}"
BUNDLE_RETENTION="${CONSUMER_EVIDENCE_BUNDLE_RETENTION:-10}"
BUNDLE_FORMAT_VERSION="1.0"
if ! [[ "$BUNDLE_RETENTION" =~ ^[0-9]+$ ]]; then
  BUNDLE_RETENTION=10
fi

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
BRANCH="$(git branch --show-current 2>/dev/null || echo unknown)"
NAME="${CONSUMER_EVIDENCE_BUNDLE_NAME:-airlang-consumer-evidence_${SHA}}"
case "$NAME" in
  *[!A-Za-z0-9._-]*|"")
    echo "ERROR: CONSUMER_EVIDENCE_BUNDLE_NAME may contain only letters, numbers, dot, underscore, and hyphen." >&2
    exit 1
    ;;
esac

TMP="$(mktemp -d)"
BUNDLE="$TMP/$NAME"
CHECK_JSON="$TMP/consumer_evidence_check.json"
ARCHIVE="$ROOT/$OUT_DIR/$NAME.zip"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$BUNDLE" "$OUT_DIR"

echo "Running consumer evidence validator..."
node scripts/check_consumer_evidence.js > "$CHECK_JSON"

is_included() {
  local p="$1"

  case "$p" in
    consumer_evidence/README.md) return 0 ;;
    consumer_evidence/DEMO_REGISTRY.json) return 0 ;;
    consumer_evidence/schemas/*.json) return 0 ;;
    consumer_evidence/demos/*/MANIFEST.json) return 0 ;;
    consumer_evidence/demos/*/PROOF_CARD.md) return 0 ;;
    consumer_evidence/demos/*/PROMPTS.md) return 0 ;;
    consumer_evidence/demos/*/reports/*.md) return 0 ;;
    consumer_evidence/demos/*/reports/*.json) return 0 ;;
    consumer_evidence/demos/*/replay/*.json) return 0 ;;
    consumer_evidence/demos/*/metrics/*.json) return 0 ;;
    docs/EXAMPLES_AND_DEMOS.md) return 0 ;;
    docs/ARCHITECTURE_GATES.md) return 0 ;;
    docs/AIR_STRATEGY.md) return 0 ;;
  esac

  return 1
}

exclude_reason() {
  local p="${1,,}"

  case "$p" in
    */node_modules/*|node_modules/*) echo "node_modules excluded"; return 0 ;;
    */build/*|build/*|*/dist/*|dist/*|*/tmp/*|tmp/*) echo "build/dist/tmp output excluded"; return 0 ;;
    */raw_logs/*|raw_logs/*) echo "local raw logs excluded"; return 0 ;;
    */media/*|media/*|*.mp4|*.mov|*.webm) echo "media/raw video excluded"; return 0 ;;
    */screenshots/raw/*|screenshots/raw/*) echo "huge/raw screenshots excluded"; return 0 ;;
    *.pem|*.key|*.env|.env|id_rsa|id_ed25519) echo "secret-like file excluded"; return 0 ;;
  esac

  echo "not in consumer evidence bundle allowlist"
  return 0
}

copy_included_file() {
  local p="$1"
  mkdir -p "$BUNDLE/$(dirname "$p")"
  cp "$p" "$BUNDLE/$p"
  echo "$p" >> "$BUNDLE/INCLUDED_FILES.txt"
}

log_omitted() {
  local p="$1"
  local reason="$2"
  printf '| `%s` | %s |\n' "$p" "$reason" >> "$BUNDLE/CONSUMER_EVIDENCE_OMITTED_FILES.md"
  echo "$p :: $reason" >> "$BUNDLE/EXCLUDED_FILES.txt"
}

cat > "$BUNDLE/INCLUDED_FILES.txt" <<'EOF'
EOF
cat > "$BUNDLE/EXCLUDED_FILES.txt" <<'EOF'
EOF
cat > "$BUNDLE/CONSUMER_EVIDENCE_OMITTED_FILES.md" <<'EOF'
# Consumer Evidence Omitted Files

This bundle intentionally excludes full demo projects, large media, build
output, dependency folders, raw logs, raw screenshots, and secret-like files.

| Path | Reason |
| --- | --- |
EOF

tracked_files="$(git ls-files | LC_ALL=C sort)"
while IFS= read -r p; do
  [ -n "$p" ] || continue
  case "$p" in
    consumer_evidence/*|docs/EXAMPLES_AND_DEMOS.md|docs/ARCHITECTURE_GATES.md|docs/AIR_STRATEGY.md)
      if is_included "$p"; then
        copy_included_file "$p"
      else
        log_omitted "$p" "$(exclude_reason "$p")"
      fi
      ;;
  esac
done <<< "$tracked_files"

cp "$CHECK_JSON" "$BUNDLE/consumer_evidence_check.json"
echo "consumer_evidence_check.json" >> "$BUNDLE/INCLUDED_FILES.txt"

node - "$CHECK_JSON" "$BRANCH" "$SHA" "$BUNDLE_FORMAT_VERSION" > "$BUNDLE/CONSUMER_EVIDENCE_SUMMARY.md" <<'NODE'
const fs = require("fs");

const [checkFile, branch, commit, formatVersion] = process.argv.slice(2);
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

process.stdout.write(`# AIR Consumer Evidence Summary

Bundle format: ${formatVersion}

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

${bulletList((check.diagnostics || []).map((diagnostic) => `${diagnostic.code}: ${diagnostic.file}: ${diagnostic.message}`))}
`);
NODE
echo "CONSUMER_EVIDENCE_SUMMARY.md" >> "$BUNDLE/INCLUDED_FILES.txt"
echo "CONSUMER_EVIDENCE_OMITTED_FILES.md" >> "$BUNDLE/INCLUDED_FILES.txt"

rm -f "$ARCHIVE"
(cd "$TMP" && zip -X -q -r "$ARCHIVE" "$NAME")

if [ "$BUNDLE_RETENTION" -gt 0 ]; then
  ls -1t "$OUT_DIR"/airlang-consumer-evidence_*.zip 2>/dev/null | awk "NR>$BUNDLE_RETENTION" | xargs -r rm -f
fi

echo "consumer evidence bundle: $ARCHIVE"
