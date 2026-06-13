#!/usr/bin/env bash
set -euo pipefail

# Pretty wrapper for the canonical AIR Core review bundle builder.
# It streams the slow preflight steps, keeps a local log, and then delegates to
# scripts/make_review_bundle.sh for the actual bundle contents and policy.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REQUIRE_UPSTREAM=0
OUT_DIR="${OUT_DIR:-snapshots}"
BUNDLE_NAME="${BUNDLE_NAME:-}"
MAX_KB="${MAX_KB:-750}"
STRIP_DEMOS="${STRIP_DEMOS:-0}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --require-upstream)
      REQUIRE_UPSTREAM=1
      ;;
    --out-dir)
      shift
      if [ "$#" -eq 0 ] || [ -z "$1" ]; then
        echo "ERROR: --out-dir requires a non-empty value." >&2
        exit 1
      fi
      OUT_DIR="$1"
      ;;
    --bundle-name)
      shift
      if [ "$#" -eq 0 ] || [ -z "$1" ]; then
        echo "ERROR: --bundle-name requires a non-empty value." >&2
        exit 1
      fi
      BUNDLE_NAME="$1"
      ;;
    --max-kb)
      shift
      if [ "$#" -eq 0 ] || ! [[ "$1" =~ ^[0-9]+$ ]]; then
        echo "ERROR: --max-kb requires a positive integer." >&2
        exit 1
      fi
      MAX_KB="$1"
      ;;
    --strip-demos)
      STRIP_DEMOS=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  npm run bundle:recipe
  npm run bundle:recipe -- --require-upstream

Options:
  --require-upstream       fail if the current branch has no upstream
  --out-dir <dir>          archive output directory (default: snapshots)
  --bundle-name <name>     pass BUNDLE_NAME to make_review_bundle.sh
  --max-kb <n>             pass MAX_KB to make_review_bundle.sh
  --strip-demos            pass STRIP_DEMOS=1 to make_review_bundle.sh
EOF
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

mkdir -p "$OUT_DIR"
LOG_FILE="$OUT_DIR/review_bundle_recipe.log"
: > "$LOG_FILE"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_RESET=$'\033[0m'
else
  C_DIM=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_BLUE=""
  C_RESET=""
fi

progress_line() {
  local percent="$1"
  local label="$2"
  local filled rest dots dashes

  if [ "$percent" -lt 0 ]; then percent=0; fi
  if [ "$percent" -gt 100 ]; then percent=100; fi
  filled=$((percent / 5))
  rest=$((20 - filled))
  dots="$(printf '%*s' "$filled" "" | tr ' ' '.')"
  dashes="$(printf '%*s' "$rest" "" | tr ' ' '-')"

  printf '%b[%3d%%] %s%s%b %s\n' "$C_BLUE" "$percent" "$dots" "$dashes" "$C_RESET" "$label"
  printf '[%3d%%] %s\n' "$percent" "$label" >> "$LOG_FILE"
}

print_status() {
  local color="$1"
  local label="$2"
  local message="$3"
  printf '%b%s%b %s\n' "$color" "$label" "$C_RESET" "$message"
  printf '%s %s\n' "$label" "$message" >> "$LOG_FILE"
}

fail_step() {
  local message="$1"
  local next="${2:-Fix the reported issue and rerun npm run bundle:recipe.}"
  echo
  print_status "$C_RED" "ERROR:" "$message"
  print_status "$C_YELLOW" "NEXT:" "$next"
  print_status "$C_DIM" "LOG:" "$LOG_FILE"
  exit 1
}

run_stream() {
  local label="$1"
  shift
  print_status "$C_DIM" "RUN:" "$label"
  set +e
  "$@" 2>&1 | tee -a "$LOG_FILE"
  local status="${PIPESTATUS[0]}"
  set -e
  if [ "$status" -ne 0 ]; then
    fail_step "$label failed with exit code $status."
  fi
}

run_capture() {
  local label="$1"
  local capture_file="$2"
  shift 2
  print_status "$C_DIM" "RUN:" "$label"
  : > "$capture_file"
  set +e
  "$@" 2>&1 | tee "$capture_file" | tee -a "$LOG_FILE"
  local status="${PIPESTATUS[0]}"
  set -e
  if [ "$status" -ne 0 ]; then
    fail_step "$label failed with exit code $status."
  fi
}

is_ignored_dirty_line() {
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
    if ! is_ignored_dirty_line "$line"; then
      printf '%s\n' "$line"
    fi
  done
}

trap 'fail_step "Interrupted while building review bundle." "Rerun npm run bundle:recipe when the repo/network is ready."' INT TERM

progress_line 0 "start review bundle recipe"

progress_line 8 "resolve repository"
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  fail_step "not inside a git checkout"
fi

BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then
  fail_step "current branch could not be resolved"
fi
COMMIT_SHORT="$(git rev-parse --short HEAD 2>/dev/null)"
COMMIT_FULL="$(git rev-parse HEAD 2>/dev/null)"
print_status "$C_GREEN" "BRANCH:" "$BRANCH"
print_status "$C_GREEN" "COMMIT:" "$COMMIT_SHORT"

progress_line 18 "fetch origin"
run_stream "git fetch origin --prune" git fetch origin --prune

progress_line 30 "check working tree"
CORE_STATUS="$(core_git_status_short || true)"
if [ -n "$CORE_STATUS" ]; then
  printf '%s\n' "$CORE_STATUS" | tee -a "$LOG_FILE"
  fail_step "dirty Core working tree is not allowed for review bundles" "Commit or stash Core changes, then rerun npm run bundle:recipe."
fi
print_status "$C_GREEN" "DIRTY:" "no"

progress_line 42 "check upstream"
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null || true)"
if [ -z "$UPSTREAM" ]; then
  if [ "$REQUIRE_UPSTREAM" = "1" ]; then
    fail_step "no upstream configured for $BRANCH" "Run git push -u origin $BRANCH, then rerun npm run bundle:recipe."
  fi
  print_status "$C_YELLOW" "UPSTREAM:" "none (warning only)"
else
  AHEAD="$(git rev-list --count "$UPSTREAM..HEAD" 2>/dev/null || echo 0)"
  BEHIND="$(git rev-list --count "HEAD..$UPSTREAM" 2>/dev/null || echo 0)"
  print_status "$C_GREEN" "UPSTREAM:" "$UPSTREAM (ahead $AHEAD, behind $BEHIND)"
  if [ "$BEHIND" != "0" ]; then
    fail_step "branch is behind upstream by $BEHIND commit(s)" "Run git pull --ff-only, then rerun npm run bundle:recipe."
  fi
fi

progress_line 55 "check REVIEW_RESULTS metadata"
ensure_review_results_current() {
  local review_commit=""
  if [ -f REVIEW_RESULTS/SUMMARY.md ]; then
    review_commit="$(sed -n 's/^Commit: `\([^`]*\)`.*/\1/p' REVIEW_RESULTS/SUMMARY.md | head -1)"
  fi

  if [ "$review_commit" = "$COMMIT_FULL" ]; then
    print_status "$C_GREEN" "REVIEW_RESULTS:" "current"
    return
  fi

  if [ -z "$review_commit" ]; then
    print_status "$C_YELLOW" "REVIEW_RESULTS:" "missing or missing commit metadata; running RC checks"
  else
    print_status "$C_YELLOW" "REVIEW_RESULTS:" "stale ($review_commit); running RC checks"
  fi

  AIR_REVIEW_BUNDLE_AUTO_RC_CHECKS=0 run_stream "bash scripts/run_rc_checks.sh" bash scripts/run_rc_checks.sh

  review_commit=""
  if [ -f REVIEW_RESULTS/SUMMARY.md ]; then
    review_commit="$(sed -n 's/^Commit: `\([^`]*\)`.*/\1/p' REVIEW_RESULTS/SUMMARY.md | head -1)"
  fi
  if [ "$review_commit" != "$COMMIT_FULL" ]; then
    fail_step "REVIEW_RESULTS still does not match current source commit after RC checks" "Inspect REVIEW_RESULTS/SUMMARY.md and rerun npm run bundle:recipe."
  fi
}

ensure_review_results_current

progress_line 70 "create review bundle"
BUNDLE_OUTPUT="$(mktemp)"
ENV_ARGS=(
  "OUT_DIR=$OUT_DIR"
  "MAX_KB=$MAX_KB"
  "STRIP_DEMOS=$STRIP_DEMOS"
  "AIR_REVIEW_BUNDLE_SKIP_FETCH=1"
)
if [ -n "$BUNDLE_NAME" ]; then
  ENV_ARGS+=("BUNDLE_NAME=$BUNDLE_NAME")
fi
run_capture "scripts/make_review_bundle.sh" "$BUNDLE_OUTPUT" env "${ENV_ARGS[@]}" bash scripts/make_review_bundle.sh "$ROOT"

progress_line 92 "verify created archive"
ARCHIVE_PATH="$(sed -n 's/^Created: //p' "$BUNDLE_OUTPUT" | tail -1)"
rm -f "$BUNDLE_OUTPUT"
if [ -z "$ARCHIVE_PATH" ]; then
  fail_step "make_review_bundle.sh did not print a Created: archive path"
fi
if [ ! -f "$ARCHIVE_PATH" ]; then
  fail_step "review bundle archive was not created: $ARCHIVE_PATH"
fi
print_status "$C_GREEN" "ARCHIVE:" "$ARCHIVE_PATH"

progress_line 100 "done"
print_status "$C_GREEN" "PASS:" "review bundle recipe complete"
print_status "$C_DIM" "LOG:" "$LOG_FILE"
