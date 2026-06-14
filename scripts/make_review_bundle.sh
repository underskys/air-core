#!/usr/bin/env bash
set -euo pipefail

# AIR review bundle builder.
#
# Creates a source snapshot zip/tarball and writes an explicit omission report
# *inside* the bundle:
#   - INCLUDED_FILES.txt
#   - EXCLUDED_FILES.txt              legacy/simple text format
#   - BUNDLE_REVIEW_NOTES.md          review-mode explanation and caveats
#   - BUNDLE_OMITTED_FILES.md        human-readable report
#   - BUNDLE_OMITTED_FILES.jsonl     machine-readable report
#   - BUNDLE_PLACEHOLDER_FILES.md     asset placeholders written into bundle
#   - BUNDLE_PLACEHOLDER_FILES.jsonl  machine-readable placeholder report
#   - SECRET_SCAN_REPORT.md           secret scan summary
#
# Usage:
#   ./make_review_bundle.sh [repo-root]
#
# Useful env vars:
#   OUT_DIR=snapshots        output directory
#   MAX_KB=750               max file size included in bundle
#   STRIP_DEMOS=0            if 1, include only demo/**/README.md from demos
#   BUNDLE_IMAGE_PLACEHOLDERS=1
#                            if 1, replace omitted non-demo image assets with safe placeholders
#   BUNDLE_PROFILE=review    free-form profile label written to manifest
#   BUNDLE_RETENTION=10      keep only the newest N review bundle archives
#   BUNDLE_NAME=...          optional archive/bundle directory name override
#   AIR_REVIEW_BUNDLE_SKIP_FETCH=1
#                            skip git fetch inside the captured pre-bundle ritual
#                            when a wrapper already ran it visibly
#   AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS=1
#                            run scripts/run_rc_checks.sh automatically when
#                            REVIEW_RESULTS is missing or stale for review/core-rc
#                            bundles; set to 0 to require a manual RC run

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-snapshots}"
MAX_KB="${MAX_KB:-750}"
MAX_BYTES=$((MAX_KB * 1024))
STRIP_DEMOS="${STRIP_DEMOS:-0}"
BUNDLE_IMAGE_PLACEHOLDERS="${BUNDLE_IMAGE_PLACEHOLDERS:-1}"
BUNDLE_PROFILE="${BUNDLE_PROFILE:-review}"
BUNDLE_RETENTION="${BUNDLE_RETENTION:-10}"
AIR_ALLOW_DIRTY_REVIEW_BUNDLE="${AIR_ALLOW_DIRTY_REVIEW_BUNDLE:-0}"
AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS="${AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS:-1}"
BUNDLE_FORMAT_VERSION="2.0"
if ! [[ "$BUNDLE_RETENTION" =~ ^[0-9]+$ ]]; then
  BUNDLE_RETENTION=10
fi

is_demo_status_line() {
  local line="$1"
  local path="${line#???}"

  case "$path" in
    demo|demo/*|demos|demos/*) return 0 ;;
    MOBILE_SUMMARY.md|REVIEW_REQUEST.md|CONSUMER_EVIDENCE_SUMMARY.md) return 0 ;;
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

review_results_commit() {
  node -e '
    const fs = require("fs");
    const text = fs.existsSync("REVIEW_RESULTS/SUMMARY.md") ? fs.readFileSync("REVIEW_RESULTS/SUMMARY.md", "utf8") : "";
    const match = text.match(/^Commit:\s*`([^`]+)`/m);
    if (match) process.stdout.write(match[1]);
  ' 2>/dev/null || true
}

auto_refresh_review_results() {
  local reason="$1"

  case "$BUNDLE_PROFILE" in
    review|core-rc)
      if [ "$AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS" = "0" ]; then
        echo "ERROR: REVIEW_RESULTS $reason." >&2
        echo "Run bash scripts/run_rc_checks.sh before creating a Core review bundle." >&2
        echo "Or leave AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS enabled for automatic refresh." >&2
        exit 1
      fi

      echo "INFO: REVIEW_RESULTS $reason; running bash scripts/run_rc_checks.sh before bundling." >&2
      AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS=0 bash scripts/run_rc_checks.sh
      ;;
  esac
}

ensure_review_results_current() {
  local current_commit_full
  local review_results_commit

  current_commit_full="$(git rev-parse HEAD 2>/dev/null || echo nogit)"

  if [ ! -d "REVIEW_RESULTS" ]; then
    auto_refresh_review_results "is missing"
  fi

  if [ -d "REVIEW_RESULTS" ]; then
    review_results_commit="$(review_results_commit)"
    if [ -z "$review_results_commit" ]; then
      auto_refresh_review_results "SUMMARY.md is missing current commit metadata"
      review_results_commit="$(review_results_commit)"
    elif [ "$current_commit_full" != "nogit" ] && [ "$review_results_commit" != "$current_commit_full" ]; then
      echo "INFO: REVIEW_RESULTS/SUMMARY.md: $review_results_commit" >&2
      echo "INFO: current HEAD: $current_commit_full" >&2
      auto_refresh_review_results "commit does not match current source commit"
      review_results_commit="$(review_results_commit)"
    fi

    if [ -z "$review_results_commit" ]; then
      case "$BUNDLE_PROFILE" in
        review|core-rc)
          echo "ERROR: REVIEW_RESULTS/SUMMARY.md is missing current commit metadata after RC refresh." >&2
          exit 1
          ;;
      esac
    elif [ "$current_commit_full" != "nogit" ] && [ "$review_results_commit" != "$current_commit_full" ]; then
      case "$BUNDLE_PROFILE" in
        review|core-rc)
          echo "ERROR: REVIEW_RESULTS commit still does not match current source commit after RC refresh." >&2
          echo "REVIEW_RESULTS/SUMMARY.md: $review_results_commit" >&2
          echo "current HEAD: $current_commit_full" >&2
          exit 1
          ;;
      esac
    fi
  fi
}

run_prebundle_git_ritual() {
  local failed=0
  local branch=""
  local head=""
  local upstream=""

  echo "# AIR pre-bundle git ritual"
  echo
  echo "These commands are captured before the review bundle snapshot is created."
  echo

  echo "\$ git fetch origin --prune"
  if [ "${AIR_REVIEW_BUNDLE_SKIP_FETCH:-0}" = "1" ]; then
    echo "skipped: AIR_REVIEW_BUNDLE_SKIP_FETCH=1 (wrapper already ran git fetch origin --prune)"
  else
    if ! git fetch origin --prune 2>&1; then
      echo "PREBUNDLE_GIT_FAILED: git fetch origin --prune"
      failed=1
    fi
  fi
  echo

  echo "\$ git status --short"
  if ! git status --short 2>&1; then
    echo "PREBUNDLE_GIT_FAILED: git status --short"
    failed=1
  fi
  echo

  echo "\$ git branch --show-current"
  if branch="$(git branch --show-current 2>&1)"; then
    printf '%s\n' "$branch"
  else
    printf '%s\n' "$branch"
    echo "PREBUNDLE_GIT_FAILED: git branch --show-current"
    failed=1
  fi
  echo

  echo "\$ git rev-parse HEAD"
  if head="$(git rev-parse HEAD 2>&1)"; then
    printf '%s\n' "$head"
  else
    printf '%s\n' "$head"
    echo "PREBUNDLE_GIT_FAILED: git rev-parse HEAD"
    failed=1
  fi
  echo

  echo "\$ git rev-parse --abbrev-ref --symbolic-full-name @{upstream}"
  if upstream="$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>&1)"; then
    printf '%s\n' "$upstream"
  else
    echo "upstream: none"
    echo "warning: no upstream configured for current branch"
    upstream=""
  fi
  echo

  if [ -n "$upstream" ]; then
    echo "\$ git log --oneline $upstream..HEAD"
    if ! git log --oneline "$upstream..HEAD" 2>&1; then
      echo "PREBUNDLE_GIT_FAILED: git log --oneline $upstream..HEAD"
      failed=1
    fi
    echo

    echo "\$ git log --oneline HEAD..$upstream"
    if ! git log --oneline "HEAD..$upstream" 2>&1; then
      echo "PREBUNDLE_GIT_FAILED: git log --oneline HEAD..$upstream"
      failed=1
    fi
  fi

  if [ "$failed" != "0" ]; then
    echo
    echo "PREBUNDLE_GIT_FAILED: one or more required git commands failed"
    return 1
  fi
}

if ! PREBUNDLE_GIT_RITUAL="$(run_prebundle_git_ritual)"; then
  if [ -t 2 ]; then
    printf '\033[31mERROR: pre-bundle git ritual failed. Review SNAPSHOT_PREBUNDLE_GIT output below.\033[0m\n' >&2
  else
    echo "ERROR: pre-bundle git ritual failed. Review SNAPSHOT_PREBUNDLE_GIT output below." >&2
  fi
  printf '%s\n' "$PREBUNDLE_GIT_RITUAL" >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then
  BRANCH="${CI_COMMIT_REF_NAME:-}"
fi
if [ -z "$BRANCH" ]; then
  BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
fi
if [ -z "$BRANCH" ]; then
  BRANCH="unknown"
fi
GIT_STATUS_SHORT="$(core_git_status_short || true)"
DIRTY_WORKTREE="no"
if [ -n "$GIT_STATUS_SHORT" ]; then
  DIRTY_WORKTREE="yes"
fi
if [ "$DIRTY_WORKTREE" = "yes" ] && [ "$AIR_ALLOW_DIRTY_REVIEW_BUNDLE" != "1" ]; then
  case "$BUNDLE_PROFILE" in
    review|core-rc)
      echo "ERROR: dirty working tree is not allowed for Core review bundles." >&2
      echo "Commit or stash changes before creating a review bundle." >&2
      echo "Dirty paths under demo/ and demos/ are ignored by Core review bundles; use a separate demo review flow for them." >&2
      echo "Use AIR_ALLOW_DIRTY_REVIEW_BUNDLE=1 only for explicit dirty planning/debug snapshots." >&2
      echo "$GIT_STATUS_SHORT" >&2
      exit 1
      ;;
  esac
fi

ensure_review_results_current

TS="$(date -u +%Y-%m-%d_%H-%M-%S)"
NAME="${BUNDLE_NAME:-${TS}_airlang-review_${SHA}}"
case "$NAME" in
  *[!A-Za-z0-9._-]*|"")
    echo "ERROR: BUNDLE_NAME may contain only letters, numbers, dot, underscore, and hyphen." >&2
    exit 1
    ;;
esac

TMP="$(mktemp -d)"
BUNDLE="$TMP/$NAME"

mkdir -p "$BUNDLE" "$OUT_DIR"

if [ -f "consumer_evidence/DEMO_REGISTRY.json" ] && [ -f "scripts/check_consumer_evidence.js" ]; then
  CONSUMER_CHECK_JSON="$(mktemp)"
  node scripts/check_consumer_evidence.js > "$CONSUMER_CHECK_JSON"
  node scripts/write_consumer_evidence_summary.js "$CONSUMER_CHECK_JSON" "$BRANCH" "$SHA" > CONSUMER_EVIDENCE_SUMMARY.md
  rm -f "$CONSUMER_CHECK_JSON"
fi

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

log_omitted() {
  local p="$1"
  local reason="$2"
  local detail="${3:-}"
  local size=""

  if [ -f "$p" ]; then
    size="$(wc -c < "$p" | tr -d ' ')"
  fi

  # Keep this legacy file because existing checks/tools may already read it.
  if [ -n "$detail" ]; then
    echo "$p :: $reason ($detail)" >> "$BUNDLE/EXCLUDED_FILES.txt"
  else
    echo "$p :: $reason" >> "$BUNDLE/EXCLUDED_FILES.txt"
  fi

  # Human-readable audit file.
  printf '| `%s` | %s | %s | %s |\n' \
    "$p" "$reason" "${size:-n/a}" "${detail:-}" >> "$BUNDLE/BUNDLE_OMITTED_FILES.md"

  # Machine-readable audit file, useful for CI/diffing.
  printf '{"path":"%s","reason":"%s","size_bytes":%s,"detail":"%s"}\n' \
    "$(json_escape "$p")" \
    "$(json_escape "$reason")" \
    "${size:-null}" \
    "$(json_escape "${detail:-}")" \
    >> "$BUNDLE/BUNDLE_OMITTED_FILES.jsonl"
}

log_placeholder() {
  local p="$1"
  local reason="$2"
  local placeholder="$3"
  local size=""

  if [ -f "$p" ]; then
    size="$(wc -c < "$p" | tr -d ' ')"
  fi

  echo "$p :: $placeholder placeholder for omitted review asset ($reason)" >> "$BUNDLE/BUNDLE_PLACEHOLDER_FILES.txt"
  printf '| `%s` | %s | %s | %s |\n' \
    "$p" "$placeholder" "${size:-n/a}" "$reason" >> "$BUNDLE/BUNDLE_PLACEHOLDER_FILES.md"
  printf '{"path":"%s","placeholder":"%s","original_size_bytes":%s,"original_omission_reason":"%s"}\n' \
    "$(json_escape "$p")" \
    "$(json_escape "$placeholder")" \
    "${size:-null}" \
    "$(json_escape "$reason")" \
    >> "$BUNDLE/BUNDLE_PLACEHOLDER_FILES.jsonl"
}

is_image_placeholder_candidate() {
  local p="${1,,}"

  case "$p" in
    *.png|*.jpg|*.jpeg|*.webp|*.gif|*.bmp|*.ico|*.svg) return 0 ;;
  esac

  return 1
}

is_demo_review_excluded_path() {
  local p="${1,,}"

  case "$p" in
    demo/*/assets/*.png|demo/*/assets/*.jpg|demo/*/assets/*.jpeg|demo/*/assets/*.webp|demo/*/assets/*.gif|demo/*/assets/*.svg|demo/*/assets/*.mp3|demo/*/assets/*.wav|demo/*/assets/*.ogg) return 0 ;;
    demo/*/public/*|demo/*/dist/*|demo/*/wasm/*) return 0 ;;
    demo/*/tmp_unused/*|demo/*/old_bundles/*) return 0 ;;
    */assets_tmp_unused_previous/*|*/references/full_pose/*) return 0 ;;
  esac

  return 1
}

write_base64_file() {
  local encoded="$1"
  local dest="$2"

  if command -v base64 >/dev/null 2>&1; then
    if printf '%s' "$encoded" | base64 --decode > "$dest" 2>/dev/null; then
      return 0
    fi
    if printf '%s' "$encoded" | base64 -D > "$dest" 2>/dev/null; then
      return 0
    fi
  fi

  if command -v node >/dev/null 2>&1; then
    node -e 'require("fs").writeFileSync(process.argv[1], Buffer.from(process.argv[2], "base64"));' "$dest" "$encoded"
    return 0
  fi

  return 1
}

copy_placeholder_image() {
  local p="$1"
  local reason="$2"

  if [ "$BUNDLE_IMAGE_PLACEHOLDERS" != "1" ]; then
    return 1
  fi

  # Core review bundles intentionally do not manufacture media placeholders for
  # separately-built demo projects. Demo bundles can choose a different policy.
  if is_demo_review_excluded_path "$p"; then
    return 1
  fi

  if ! is_image_placeholder_candidate "$p"; then
    return 1
  fi

  local dest="$BUNDLE/$p"
  mkdir -p "$(dirname "$dest")"

  case "${p,,}" in
    *.svg)
      cat > "$dest" <<'EOF_SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#bde7ff"/></svg>
EOF_SVG
      log_omitted "$p" "replaced by review placeholder" "$reason"
      log_placeholder "$p" "$reason" "1x1 light-blue SVG"
      ;;
    *)
      # 1x1 RGBA PNG, fill #bde7ff. Used only as a review-bundle placeholder.
      if ! write_base64_file "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPY+/z/fwAIqwOj7muDkwAAAABJRU5ErkJggg==" "$dest"; then
        rm -f "$dest"
        return 1
      fi
      log_omitted "$p" "replaced by review placeholder" "$reason"
      log_placeholder "$p" "$reason" "1x1 light-blue PNG"
      ;;
  esac

  return 0
}

is_force_included_resource() {
  local p="$1"

  case "$p" in
    # These are intentionally kept even though broad rules exclude assets/shaders.
    examples/gpu_arena/assets/*|examples/gpu_arena/shaders/*) return 0 ;;
    examples/gfx_showcase/assets/*|examples/gfx_showcase/shaders/*) return 0 ;;
    examples/gfx_fixtures/assets/*) return 0 ;;
    examples/package_manifest/assets/*|examples/package_manifest/assets/**/*) return 0 ;;
    examples/assets/audio/*|examples/assets/audio/**/*) return 0 ;;
    examples/assets/models/*|examples/assets/rigs/*|examples/assets/shaders/*|examples/assets/sprites/*|examples/assets/textures/*) return 0 ;;
    test/fixtures/assets_minimal/*|test/fixtures/assets_minimal/**/*) return 0 ;;
    test/fixtures/package_minimal/*|test/fixtures/package_minimal/**/*) return 0 ;;
    kits/gfx-basic/shaders/*) return 0 ;;
    kits/gfx-basic/materials/*) return 0 ;;
  esac

  return 1
}

# Print omission reason and return 0 if excluded by policy.
# Return 1 if not excluded by policy.
exclude_reason() {
  local p="$1"

  if is_demo_review_excluded_path "$p"; then
    echo "demo media/build output excluded from Core review bundle"
    return 0
  fi

  # Optional slim bundle profile: keep demo READMEs only.
  if [ "$STRIP_DEMOS" = "1" ]; then
    case "$p" in
      demo/**/README.md|demo/*/README.md|demo/README.md) return 1 ;;
      demo/*|demo/**/*) echo "demo stripped by STRIP_DEMOS=1"; return 0 ;;
    esac
  fi

  case "$p" in
    .git/*) echo "git metadata"; return 0 ;;
    node_modules/*|*/node_modules/*) echo "dependency directory"; return 0 ;;
    dist/*|*/dist/*|.dist/*|*/.dist/*) echo "build output"; return 0 ;;
    examples/public/*|examples/public/**/*) return 1 ;;
    build/*|*/build/*|public/*|*/public/*) echo "build/public output"; return 0 ;;
    coverage/*|*/coverage/*) echo "coverage output"; return 0 ;;
    snapshots/*|*/snapshots/*|demo_snapshots/*|*/demo_snapshots/*|old_bundles/*|*/old_bundles/*) echo "bundle/archive output"; return 0 ;;
    tmp_unused/*|*/tmp_unused/*|old_bundles/*|*/old_bundles/*|assets_tmp_unused_previous/*|*/assets_tmp_unused_previous/*|references/full_pose/*|*/references/full_pose/*|archived_asset_dumps/*|*/archived_asset_dumps/*|asset_dumps/*|*/asset_dumps/*) echo "archived/unused asset dump"; return 0 ;;
    DerivedData/*|*/DerivedData/*) echo "Xcode DerivedData"; return 0 ;;
    target/*|*/target/*) echo "target/build output"; return 0 ;;
    .next/*|*/.next/*|.vite/*|*/.vite/*|.turbo/*|*/.turbo/*|.cache/*|*/.cache/*) echo "tool cache/build output"; return 0 ;;
  esac

  # Do not let broad asset exclusions hide intentionally included test/showcase fixtures.
  if is_force_included_resource "$p"; then
    return 1
  fi

  case "$p" in
    *.png|*.jpg|*.jpeg|*.webp|*.gif|*.bmp|*.ico|*.svg) echo "binary/image asset excluded by default"; return 0 ;;
    *.mp3|*.wav|*.ogg|*.mp4|*.mov|*.avi|*.mkv) echo "media asset excluded by default"; return 0 ;;
    *.wasm|*.wat|*.map) echo "compiled/generated artifact excluded by default"; return 0 ;;
    *.glb|*.gltf|*.obj|*.fbx|*.bin) echo "3D/binary asset excluded by default"; return 0 ;;
    *.env|.env|*.pem|*.key|id_rsa|id_ed25519) echo "secret-like file excluded by default"; return 0 ;;
    .DS_Store|*/.DS_Store) echo "OS metadata"; return 0 ;;
  esac

  return 1
}

is_included() {
  local p="$1"

  case "$p" in
    AGENTS.md|README.md|WHY_AIR.md|METHOD.md|SECURITY.md|THREAT_MODEL.md|CONFORMANCE.md|SHOWCASE.md|VERSIONING.md|ROADMAP.md|CONTRIBUTING.md|CHANGELOG.md|LICENSE|NOTICE|NOTICE.md|AUTHORS|MOBILE_SUMMARY.md|REVIEW_REQUEST.md|CONSUMER_EVIDENCE_SUMMARY.md|package.json|package-lock.json|pnpm-lock.yaml|tsconfig.json|.gitlab-ci.yml|.gitignore|.npmignore) return 0 ;;
    REVIEW_RESULTS/*|REVIEW_RESULTS/**/*) return 0 ;;
    spec/*.md|docs/*.md|docs/release/*.md|docs/release/*.json|docs/release/artifact_templates/*.md|docs/release/artifact_templates/*.json) return 0 ;;
    review_artifacts/templates/*.md|review_artifacts/templates/*.json|schemas/review/*.json) return 0 ;;
    consumer_evidence/README.md|consumer_evidence/DEMO_REGISTRY.json|consumer_evidence/.gitignore) return 0 ;;
    consumer_evidence/schemas/*.json) return 0 ;;
    consumer_evidence/demos/*/MANIFEST.json|consumer_evidence/demos/*/PROOF_CARD.md|consumer_evidence/demos/*/PROMPTS.md) return 0 ;;
    consumer_evidence/demos/*/reports/*.md|consumer_evidence/demos/*/reports/*.json) return 0 ;;
    consumer_evidence/demos/*/replay/README.md|consumer_evidence/demos/*/replay/*.json) return 0 ;;
    consumer_evidence/demos/*/metrics/README.md|consumer_evidence/demos/*/metrics/*.json) return 0 ;;
    benchmarks/*/README.md|benchmarks/*/benchmark.json) return 0 ;;
    evals/ai_authoring/prompts/*.md) return 0 ;;
    evals/ai_authoring/captured/model_outputs/*.json) return 0 ;;
    evals/ai_authoring/captured/repair_transcripts/*.json) return 0 ;;
    evals/ai_authoring/expected/constraints.json) return 0 ;;
    evals/ai_authoring/reports/README.md) return 0 ;;
    stdlib/*.air|stdlib/**/*.air) return 0 ;;
    kits/*.md|kits/**/*.md|kits/**/*.air|kits/**/*.json|kits/**/*.wgsl) return 0 ;;
    examples/*.air|examples/**/*.air|examples/*.json|examples/**/*.json|examples/*.md|examples/**/*.md|examples/*.mjs|examples/**/*.mjs) return 0 ;;
    examples/**/*.wgsl|examples/**/assets/*.gltf|examples/**/assets/*.glb|examples/**/assets/*.svg|examples/**/assets/*.json) return 0 ;;
    examples/package_manifest/assets/*|examples/package_manifest/assets/**/*) return 0 ;;
    examples/assets/audio/*|examples/assets/audio/**/*|examples/assets/models/*|examples/assets/rigs/*|examples/assets/sprites/*|examples/assets/textures/*) return 0 ;;
    test/fixtures/assets_minimal/*|test/fixtures/assets_minimal/**/*) return 0 ;;
    test/fixtures/package_minimal/*|test/fixtures/package_minimal/**/*) return 0 ;;
    data/*.json|data/**/*.json) return 0 ;;
    src/*.js|src/**/*.js|src/*.mjs|src/**/*.mjs|src/*.ts|src/**/*.ts) return 0 ;;
    bin/*.js|bin/*.mjs|bin/*.sh) return 0 ;;
    scripts/*.sh|scripts/**/*.sh|scripts/*.js|scripts/**/*.js|scripts/*.mjs|scripts/**/*.mjs|scripts/*.json|scripts/**/*.json) return 0 ;;
    tools/*.js|tools/**/*.js|tools/*.mjs|tools/**/*.mjs) return 0 ;;
    prompts/*.md|prompts/**/*.md) return 0 ;;
    requests/*.md|requests/**/*.md) return 0 ;;
    test/*.js|test/**/*.js|test/*.mjs|test/**/*.mjs|test/*.json|test/**/*.json|test/**/*.air) return 0 ;;
    test/fixtures/evidence_report/README.md|test/fixtures/evidence_report/*.golden.md|test/fixtures/evidence_report/*.json) return 0 ;;
    test/fixtures/lan_observer_readonly/unsafe_raw_authority/README.md) return 0 ;;
    test/fixtures/package_diff/README.md) return 0 ;;
    test/fixtures/pools/projectile_pool_basic/README.md) return 0 ;;
    examples/public/*|examples/public/**/*) return 0 ;;
    hosts/*.md|hosts/**/*.md|hosts/**/*.ts|hosts/**/*.js|hosts/**/*.mjs|hosts/**/*.swift|hosts/**/*.rs|hosts/**/*.wgsl|hosts/**/*.json|hosts/**/*.toml|hosts/**/Cargo.lock|hosts/**/*.css|hosts/**/*.html) return 0 ;;
    demo/*.md|demo/**/*.md|demo/**/*.air|demo/**/*.json|demo/**/*.ts|demo/**/*.js|demo/**/*.mjs|demo/**/*.swift|demo/**/*.wgsl|demo/**/*.html|demo/**/*.css) return 0 ;;
    tests/**/*.air|tests/**/*.js|tests/**/*.mjs|tests/**/*.json|tests/**/*.md) return 0 ;;
  esac

  return 1
}

copy_file() {
  local p="$1"

  if [ ! -f "$p" ]; then
    return
  fi

  local reason
  if reason="$(exclude_reason "$p")"; then
    if copy_placeholder_image "$p" "$reason"; then
      return
    fi
    log_omitted "$p" "$reason"
    return
  fi

  if ! is_included "$p"; then
    log_omitted "$p" "not in allowlist"
    return
  fi

  local size
  size="$(wc -c < "$p" | tr -d ' ')"

  if [ "$size" -gt "$MAX_BYTES" ]; then
    if copy_placeholder_image "$p" "too large (${size} bytes > ${MAX_BYTES} bytes)"; then
      return
    fi
    log_omitted "$p" "too large" "${size} bytes > ${MAX_BYTES} bytes"
    return
  fi

  mkdir -p "$BUNDLE/$(dirname "$p")"
  cp "$p" "$BUNDLE/$p"
  echo "$p" >> "$BUNDLE/INCLUDED_FILES.txt"
}

# Bundle audit files.
touch "$BUNDLE/INCLUDED_FILES.txt"
touch "$BUNDLE/EXCLUDED_FILES.txt"
touch "$BUNDLE/BUNDLE_OMITTED_FILES.jsonl"
touch "$BUNDLE/BUNDLE_PLACEHOLDER_FILES.txt"
touch "$BUNDLE/BUNDLE_PLACEHOLDER_FILES.jsonl"
REVIEW_RESULTS_PRESENT=0
if [ -d "REVIEW_RESULTS" ]; then
  REVIEW_RESULTS_PRESENT=1
else
  echo "WARNING: REVIEW_RESULTS/ is missing. Run scripts/run_rc_checks.sh before creating an RC review bundle." >&2
  cat > "$BUNDLE/REVIEW_RESULTS_MISSING.md" <<'EOF_MISSING'
# REVIEW_RESULTS missing

This bundle was generated without `REVIEW_RESULTS/`.

For Core RC review, run `bash scripts/run_rc_checks.sh` in the source checkout
before creating the review bundle. The bundle is a review artifact, not the
primary execution environment for full release checks.
EOF_MISSING
fi
cat > "$BUNDLE/BUNDLE_OMITTED_FILES.md" <<EOF_REPORT
# Omitted files

These files were present in the source tree but intentionally omitted from this review bundle.
The source repository is not modified by this script.

Bundle profile: \`$BUNDLE_PROFILE\`
STRIP_DEMOS: \`$STRIP_DEMOS\`
Max included file size: \`${MAX_KB}KB\`
Bundle format: \`$BUNDLE_FORMAT_VERSION\`

| Path | Reason | Size bytes | Detail |
|---|---:|---:|---|
EOF_REPORT

cat > "$BUNDLE/BUNDLE_PLACEHOLDER_FILES.md" <<EOF_PLACEHOLDERS
# Placeholder files

Some review bundles replace omitted image assets with tiny deterministic
placeholders at the same path. This keeps local smoke checks, markdown previews,
and Core-owned startup paths from failing only because large or project-local
artwork was stripped from the review archive. Core review bundles do not create
placeholders for demo media/assets.

These placeholders are not source assets and must not be treated as approved
visual output. Use the source repository or project asset package for real
artwork.

Bundle image placeholders: \`$BUNDLE_IMAGE_PLACEHOLDERS\`
Placeholder color: \`#bde7ff\`

| Path | Placeholder | Original size bytes | Original omission reason |
|---|---:|---:|---|
EOF_PLACEHOLDERS

list_source_files() {
  local git_excludes=(
    ":(exclude).git/**"
    ":(exclude)node_modules/**"
    ":(exclude)**/node_modules/**"
    ":(exclude)dist/**"
    ":(exclude)**/dist/**"
    ":(exclude)build/**"
    ":(exclude)**/build/**"
    ":(exclude)public/**"
    ":(exclude)**/public/**"
    ":(exclude)coverage/**"
    ":(exclude)**/coverage/**"
    ":(exclude)snapshots/**"
    ":(exclude)**/snapshots/**"
    ":(exclude)DerivedData/**"
    ":(exclude)**/DerivedData/**"
    ":(exclude)target/**"
    ":(exclude)**/target/**"
    ":(exclude).next/**"
    ":(exclude)**/.next/**"
    ":(exclude).vite/**"
    ":(exclude)**/.vite/**"
    ":(exclude).turbo/**"
    ":(exclude)**/.turbo/**"
    ":(exclude).cache/**"
    ":(exclude)**/.cache/**"
    ":(exclude)demo/**/tmp_unused/**"
    ":(exclude)demo/**/old_bundles/**"
    ":(exclude)demo/**/public/**"
    ":(exclude)demo/**/dist/**"
    ":(exclude)demo/**/wasm/**"
    ":(glob,exclude)demo/**/assets/*.png"
    ":(glob,exclude)demo/**/assets/*.jpg"
    ":(glob,exclude)demo/**/assets/*.jpeg"
    ":(glob,exclude)demo/**/assets/*.webp"
    ":(glob,exclude)demo/**/assets/*.gif"
    ":(glob,exclude)demo/**/assets/*.svg"
    ":(glob,exclude)demo/**/assets/*.mp3"
    ":(glob,exclude)demo/**/assets/*.wav"
    ":(glob,exclude)demo/**/assets/*.ogg"
    ":(glob,exclude)demo/**/assets/**/*.png"
    ":(glob,exclude)demo/**/assets/**/*.jpg"
    ":(glob,exclude)demo/**/assets/**/*.jpeg"
    ":(glob,exclude)demo/**/assets/**/*.webp"
    ":(glob,exclude)demo/**/assets/**/*.gif"
    ":(glob,exclude)demo/**/assets/**/*.svg"
    ":(glob,exclude)demo/**/assets/**/*.mp3"
    ":(glob,exclude)demo/**/assets/**/*.wav"
    ":(glob,exclude)demo/**/assets/**/*.ogg"
    ":(exclude)**/assets_tmp_unused_previous/**"
    ":(exclude)**/references/full_pose/**"
  )

  if git ls-files --cached --others --exclude-standard -- . "${git_excludes[@]}" >/dev/null 2>&1; then
    git ls-files --cached --others --exclude-standard -- . "${git_excludes[@]}" | while IFS= read -r file; do
      if ! is_pruned_source_path "$file"; then
        printf '%s\n' "$file"
      fi
    done
    return
  fi

  find . \
    \( \
      -path './.git' -o \
      -path './node_modules' -o -path './*/node_modules' -o \
      -path './dist' -o -path './*/dist' -o \
      -path './build' -o -path './*/build' -o \
      -path './public' -o -path './*/public' -o \
      -path './coverage' -o -path './*/coverage' -o \
      -path './snapshots' -o -path './*/snapshots' -o \
      -path './demo_snapshots' -o -path './*/demo_snapshots' -o \
      -path './old_bundles' -o -path './*/old_bundles' -o \
      -path './tmp_unused' -o -path './*/tmp_unused' -o \
      -path './old_bundles' -o -path './*/old_bundles' -o \
      -path './demo/*/public' -o \
      -path './demo/*/dist' -o \
      -path './demo/*/wasm' -o \
      -path './assets_tmp_unused_previous' -o -path './*/assets_tmp_unused_previous' -o \
      -path './references/full_pose' -o -path './*/references/full_pose' -o \
      -path './archived_asset_dumps' -o -path './*/archived_asset_dumps' -o \
      -path './asset_dumps' -o -path './*/asset_dumps' -o \
      -path './DerivedData' -o -path './*/DerivedData' -o \
      -path './target' -o -path './*/target' -o \
      -path './.next' -o -path './*/.next' -o \
      -path './.vite' -o -path './*/.vite' -o \
      -path './.turbo' -o -path './*/.turbo' -o \
      -path './.cache' -o -path './*/.cache' \
    \) -prune -o \
    -type f -print | sed 's#^\./##' | while IFS= read -r file; do
      if ! is_pruned_source_path "$file"; then
        printf '%s\n' "$file"
      fi
    done
}

is_pruned_source_path() {
  local p="$1"

  case "$p" in
    .git/*|node_modules/*|*/node_modules/*) return 0 ;;
    dist/*|*/dist/*|build/*|*/build/*|public/*|*/public/*|coverage/*|*/coverage/*) return 0 ;;
    snapshots/*|*/snapshots/*|DerivedData/*|*/DerivedData/*|target/*|*/target/*) return 0 ;;
    .next/*|*/.next/*|.vite/*|*/.vite/*|.turbo/*|*/.turbo/*|.cache/*|*/.cache/*) return 0 ;;
    demo/*/public/*|demo/*/dist/*|demo/*/wasm/*) return 0 ;;
    demo/*/assets/*.png|demo/*/assets/*.jpg|demo/*/assets/*.jpeg|demo/*/assets/*.webp|demo/*/assets/*.gif|demo/*/assets/*.svg|demo/*/assets/*.mp3|demo/*/assets/*.wav|demo/*/assets/*.ogg) return 0 ;;
    demo/*/tmp_unused/*|demo/**/tmp_unused/*|demo/*/old_bundles/*|demo/**/old_bundles/*) return 0 ;;
    assets_tmp_unused_previous/*|*/assets_tmp_unused_previous/*|references/full_pose/*|*/references/full_pose/*) return 0 ;;
  esac

  return 1
}

review_safe_forced_files() {
  local files=(
    "MOBILE_SUMMARY.md"
    "REVIEW_REQUEST.md"
    "CONSUMER_EVIDENCE_SUMMARY.md"
    "examples/package_manifest/assets/audio/package_click.wav"
    "examples/assets/audio/music/jungle-1.mp3"
    "examples/assets/audio/sfx/heal.wav"
    "examples/assets/audio/silence.wav"
    "examples/assets/models/crate.glb"
    "test/fixtures/assets_minimal/audio/music/jungle_1.wav"
    "test/fixtures/assets_minimal/audio/sfx/heal.wav"
    "test/fixtures/assets_minimal/audio/silence.wav"
    "test/fixtures/assets_minimal/models/crate.glb"
    "test/fixtures/assets_minimal/textures/fallback.png"
    "test/fixtures/assets_minimal/textures/tiny.png"
    "test/fixtures/assets_minimal/sprites/player_idle.png"
    "test/fixtures/package_minimal/assets/audio/package_click.wav"
    "test/fixtures/package_minimal/assets/audio/silence.wav"
    "test/fixtures/package_minimal/assets/textures/fallback.png"
    "test/fixtures/package_minimal/assets/textures/package_checker.png"
  )

  local file
  for file in "${files[@]}"; do
    if [ -f "$file" ]; then
      printf '%s\n' "$file"
    fi
  done

  if [ -d "test/fixtures" ]; then
    find test/fixtures -type f -name '*.air' -print
    find test/fixtures/assets_minimal test/fixtures/package_minimal -type f -print 2>/dev/null || true
  fi
  if [ -d "examples/public" ]; then
    find examples/public -type f -print
  fi
}

# Include tracked + untracked-but-not-ignored files. REVIEW_RESULTS is added
# explicitly because log files are often ignored by repository rules, but RC
# review bundles must carry those logs.
while IFS= read -r file; do
  copy_file "$file"
done < <(
  {
    list_source_files
    review_safe_forced_files
    if [ -d "REVIEW_RESULTS" ]; then
      find REVIEW_RESULTS -type f -print
    fi
  } | sort -u
)

# Git reports.
{
  echo "branch: $BRANCH"
  echo "commit_short: $SHA"
  echo "commit_full: $(git rev-parse HEAD 2>/dev/null || echo nogit)"
  echo "created_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "bundle_format_version: $BUNDLE_FORMAT_VERSION"
  echo "bundle_profile: $BUNDLE_PROFILE"
  echo "strip_demos: $STRIP_DEMOS"
  echo "dirty: $DIRTY_WORKTREE"
  echo "dirty_allowed: $AIR_ALLOW_DIRTY_REVIEW_BUNDLE"
} > "$BUNDLE/SNAPSHOT_COMMIT.txt"

git log --oneline -n 30 > "$BUNDLE/SNAPSHOT_LOG.txt" 2>/dev/null || true
printf '%s\n' "$PREBUNDLE_GIT_RITUAL" > "$BUNDLE/SNAPSHOT_PREBUNDLE_GIT.txt"
printf '%s\n' "$GIT_STATUS_SHORT" > "$BUNDLE/SNAPSHOT_STATUS.txt"
git diff --stat > "$BUNDLE/SNAPSHOT_DIFF.stat" 2>/dev/null || true
git diff > "$BUNDLE/SNAPSHOT_DIFF.patch" 2>/dev/null || true

DIRTY_REVIEW_NOTICE=""
if [ "$DIRTY_WORKTREE" = "yes" ]; then
  DIRTY_REVIEW_NOTICE="
## Dirty planning snapshot

This bundle was created with a dirty working tree. It is a dirty planning/debug
snapshot, not a Core RC review bundle and not review-ready for release. Inspect
\`SNAPSHOT_STATUS.txt\` and \`SNAPSHOT_DIFF.patch\` before using it.
"
fi

cat > "$BUNDLE/BUNDLE_REVIEW_NOTES.md" <<EOF_NOTES
# AIR review bundle

This archive is a review snapshot, not a pristine source checkout. It is meant
to let reviewers inspect code, docs, tests, specs, manifests, and package shape
without carrying every generated artifact, dependency directory, build output, or
large/project-local asset.

This is the Core review bundle. It is release-relevant for AIR Core checks,
but it is not a standalone build of every demo project. Demo projects are built
from their full project checkouts.

Demo content in this bundle is informational/evidence-only. The Core bundle
keeps demo README/request documents, canonical AIR modules, and active manifests
when they are needed by Core verifier/report checks. Demo media packs, public
build output, wasm output, archived asset dumps, and generated demo assets are
excluded by default.

## What changed in this snapshot

- Source commit: \`$SHA\`
- Source branch: \`$BRANCH\`
- Bundle profile: \`$BUNDLE_PROFILE\`
- Bundle format: \`$BUNDLE_FORMAT_VERSION\`
- STRIP_DEMOS: \`$STRIP_DEMOS\`
- Image placeholders: \`$BUNDLE_IMAGE_PLACEHOLDERS\`
- REVIEW_RESULTS included: \`$REVIEW_RESULTS_PRESENT\`
- Dirty working tree: \`$DIRTY_WORKTREE\`
- Dirty allowed: \`$AIR_ALLOW_DIRTY_REVIEW_BUNDLE\`

$DIRTY_REVIEW_NOTICE

For repository changes, inspect:

- \`SNAPSHOT_COMMIT.txt\`
- \`SNAPSHOT_STATUS.txt\`
- \`SNAPSHOT_DIFF.stat\`
- \`SNAPSHOT_DIFF.patch\`
- \`SNAPSHOT_LOG.txt\`
- \`SNAPSHOT_PREBUNDLE_GIT.txt\`

For bundle-specific changes, inspect:

- \`INCLUDED_FILES.txt\`
- \`EXCLUDED_FILES.txt\`
- \`BUNDLE_OMITTED_FILES.md\`
- \`BUNDLE_PLACEHOLDER_FILES.md\`
- \`SECRET_SCAN_REPORT.md\`
- \`SNAPSHOT_MANIFEST.json\`
- \`REVIEW_RESULTS/SUMMARY.md\`
- \`REVIEW_RESULTS/CHECKS.json\`
- \`REVIEW_RESULTS/RED_FLAGS.md\`
- \`REVIEW_RESULTS/COMMANDS.log\`

If \`REVIEW_RESULTS/\` is missing, this bundle is not a Core RC review bundle.
Run \`bash scripts/run_rc_checks.sh\` in the source checkout before bundling.

## Running checks from an unpacked bundle

Source-checkout RC checks are strict and remain the release authority. This
archive may not contain \`.git\` metadata or every source-checkout artifact.
After unpacking the archive and running \`npm ci\`, use:

\`\`\`sh
npm run test:bundle
\`\`\`

The bundle test mode runs meaningful compiler, manifest, report, and package
tests while avoiding failures caused only by missing source-checkout metadata.
It does not replace \`npm test\` and \`bash scripts/run_rc_checks.sh\` in the
source checkout.

## Placeholder policy

When non-demo image assets are excluded by review policy, the bundle may include
a tiny light-blue placeholder at the original path. This preserves file
existence for Core-owned local checks and markdown previews. Demo media/assets
do not receive placeholders in the Core review bundle; use the full demo project
checkout or a separate demo review bundle for demo media. Placeholders are
review scaffolding only; they are not AIR source, public ABI, approved demo art,
or production assets.

Core-owned package/profile tests use tiny deterministic assets under
\`test/fixtures/assets_minimal/\` and \`test/fixtures/package_minimal/\`. Those
fixtures are intentionally included in this archive so source-only diagnostics
and review-bundle sanity checks do not depend on stripped demo media.

v0.29 benchmark descriptors under \`benchmarks/*/README.md\` and
\`benchmarks/*/benchmark.json\` are intentionally included so reviewers can
inspect the deterministic baseline inputs. Runtime outputs, logs, generated
artifacts, dependency folders, and large assets remain excluded by policy.

v0.32 AI authoring replay fixtures under \`evals/ai_authoring/\` are included
because they are deterministic review fixtures. They must not contain live model
API payloads, API keys, tokens, secrets, raw private URLs, absolute local paths,
timestamps, or large logs.

Evidence report golden fixtures under \`test/fixtures/evidence_report/\` are
included because Markdown evidence reports are part of the AIR human review
surface. They must remain deterministic and free of raw private payloads,
tokens, secrets, timestamps, absolute paths, raw state values, and helper return
dumps.
EOF_NOTES

find "$BUNDLE" -type f | sed "s#^$BUNDLE/##" | sort > "$BUNDLE/SNAPSHOT_TREE.txt"

# Secret scan: fail on likely real secrets, warn on unexpected labels.
DANGEROUS='-----BEGIN ((RSA|OPENSSH|EC|DSA) )?PRIVATE KEY-----|glpat-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}'
SUSPICIOUS='OPENAI_API_KEY|ANTHROPIC_API_KEY|GITLAB_TOKEN|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID'
EXPECTED_SECRET_LABEL_FILES='^(scripts/make_review_bundle\.sh|scripts/gitlab_mr_policy\.mjs|scripts/check_api_gates_v0_33\.js|test/ai_authoring_eval\.test\.js)$'

danger_files="$(
  LC_ALL=C grep -R -I -l -E -e "$DANGEROUS" "$BUNDLE" 2>/dev/null || true
)"

if [ -n "$danger_files" ]; then
  echo "ERROR: likely secrets found in included files:"
  echo "$danger_files"
  echo "Bundle was not created."
  rm -rf "$TMP"
  exit 1
fi

all_label_files="$(
  LC_ALL=C grep -R -I -l -E -e "$SUSPICIOUS" "$BUNDLE" 2>/dev/null || true
)"

warn_files=""
allowed_label_files=""
if [ -n "$all_label_files" ]; then
  while IFS= read -r label_file; do
    rel_label_file="${label_file#"$BUNDLE"/}"
    if printf '%s\n' "$rel_label_file" | LC_ALL=C grep -E -q "$EXPECTED_SECRET_LABEL_FILES"; then
      allowed_label_files="${allowed_label_files}${rel_label_file}"$'\n'
    else
      warn_files="${warn_files}${label_file}"$'\n'
    fi
  done <<EOF_LABEL_FILES
$all_label_files
EOF_LABEL_FILES
fi

{
  echo "# Secret Scan Report"
  echo
  echo "- Dangerous secret matches: none"
  if [ -n "$warn_files" ]; then
    echo "- Suspicious secret labels: warn"
  else
    echo "- Suspicious secret labels: none"
  fi
  if [ -n "$allowed_label_files" ]; then
    echo "- Expected scanner/policy labels: allowed"
    echo
    echo "## Allowed Label References"
    echo
    printf '%s' "$allowed_label_files" | sed '/^$/d' | sort | sed 's/^/- /'
  else
    echo "- Expected scanner/policy labels: none"
  fi
} > "$BUNDLE/SECRET_SCAN_REPORT.md"

if [ -n "$warn_files" ]; then
  echo "WARNING: suspicious secret labels found:"
  printf '%s' "$warn_files" | sed '/^$/d'
fi

included_count="$(wc -l < "$BUNDLE/INCLUDED_FILES.txt" | tr -d ' ')"
excluded_count="$(wc -l < "$BUNDLE/EXCLUDED_FILES.txt" | tr -d ' ')"
placeholder_count="$(wc -l < "$BUNDLE/BUNDLE_PLACEHOLDER_FILES.txt" | tr -d ' ')"
included_bytes="$(find "$BUNDLE" -type f -exec wc -c {} + | awk 'END {print $1 + 0}')"

cat > "$BUNDLE/SNAPSHOT_MANIFEST.json" <<EOF_MANIFEST
{
  "name": "$NAME",
  "branch": "$(json_escape "$BRANCH")",
  "commit": "$(json_escape "$SHA")",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "bundle_format_version": "$BUNDLE_FORMAT_VERSION",
  "bundle_profile": "$(json_escape "$BUNDLE_PROFILE")",
  "dirty": "$DIRTY_WORKTREE",
  "dirty_allowed": "$AIR_ALLOW_DIRTY_REVIEW_BUNDLE",
  "strip_demos": "$STRIP_DEMOS",
  "review_results_present": "$REVIEW_RESULTS_PRESENT",
  "included_files": $included_count,
  "excluded_files": $excluded_count,
  "placeholder_files": $placeholder_count,
  "included_bytes": $included_bytes,
  "max_file_kb": $MAX_KB,
  "retention": $BUNDLE_RETENTION,
  "omission_reports": [
    "EXCLUDED_FILES.txt",
    "BUNDLE_OMITTED_FILES.md",
    "BUNDLE_OMITTED_FILES.jsonl"
  ],
  "placeholder_reports": [
    "BUNDLE_PLACEHOLDER_FILES.md",
    "BUNDLE_PLACEHOLDER_FILES.jsonl"
  ],
  "secret_scan_report": "SECRET_SCAN_REPORT.md",
  "review_notes": "BUNDLE_REVIEW_NOTES.md"
}
EOF_MANIFEST

if [[ "$OUT_DIR" = /* ]]; then
  ARCHIVE_BASE="$OUT_DIR"
else
  ARCHIVE_BASE="$ROOT/$OUT_DIR"
fi

mkdir -p "$ARCHIVE_BASE"
ARCHIVE="$ARCHIVE_BASE/$NAME.zip"

if command -v zip >/dev/null 2>&1; then
  (cd "$TMP" && zip -qr "$ARCHIVE" "$NAME")
else
  ARCHIVE="$ARCHIVE_BASE/$NAME.tar.gz"
  tar -czf "$ARCHIVE" -C "$TMP" "$NAME"
fi

rm -rf "$TMP"

deleted_count=0
if [[ "$BUNDLE_RETENTION" =~ ^[0-9]+$ ]] && [ "$BUNDLE_RETENTION" -gt 0 ]; then
  archive_list="$(mktemp)"
  find "$ARCHIVE_BASE" -maxdepth 1 -type f \( \
    -name "*_airlang-review_*.zip" -o \
    -name "*_airlang-review_*.tar.gz" -o \
    -name "airlang-review-*.zip" -o \
    -name "airlang-review-*.tar.gz" \
  \) -print > "$archive_list"
  if [ -s "$archive_list" ]; then
    sorted_list="$(mktemp)"
    while IFS= read -r file; do
      mtime="$(stat -f '%m' "$file" 2>/dev/null || stat -c '%Y' "$file" 2>/dev/null || echo 0)"
      printf '%s\t%s\n' "$mtime" "$file"
    done < "$archive_list" | sort -rn | cut -f2- > "$sorted_list"

    index=0
    while IFS= read -r file; do
      index=$((index + 1))
      if [ "$index" -gt "$BUNDLE_RETENTION" ]; then
        rm -f "$file"
        deleted_count=$((deleted_count + 1))
      fi
    done < "$sorted_list"
    rm -f "$sorted_list"
  fi
  rm -f "$archive_list"
fi

echo "Created: $ARCHIVE"
echo "Bundle format: $BUNDLE_FORMAT_VERSION"
echo "Included files: $included_count"
echo "Excluded files: $excluded_count"
echo "Placeholder files: $placeholder_count"
echo "Max file size: ${MAX_KB}KB"
echo "Retention: kept latest ${BUNDLE_RETENTION} archive(s), deleted ${deleted_count}"
echo "Omission reports: EXCLUDED_FILES.txt, BUNDLE_OMITTED_FILES.md, BUNDLE_OMITTED_FILES.jsonl"
echo "Placeholder reports: BUNDLE_PLACEHOLDER_FILES.md, BUNDLE_PLACEHOLDER_FILES.jsonl"
echo "Review notes: BUNDLE_REVIEW_NOTES.md"
