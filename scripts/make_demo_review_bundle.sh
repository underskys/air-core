#!/usr/bin/env bash
set -euo pipefail

# AIR demo review bundle builder.
#
# Creates a demo-only orientation/evidence archive. The source tree is not
# modified. This archive is not a standalone demo build artifact and is not an
# AIR Core release gate.
# Image files are replaced with tiny deterministic placeholders by default, or
# included with real bytes when explicitly requested for manual review. Audio
# files keep the existing placeholder/stub policy.
#
# Usage:
#   scripts/make_demo_review_bundle.sh [repo-root]
#
# Useful env vars:
#   OUT_DIR=demo_snapshots       output directory
#   DEMO_MAX_KB=10240            max non-media file size included in bundle
#   DEMO_BUNDLE_RETENTION=10     keep only the newest N demo archives
#   DEMO_BUNDLE_SELECTION=all    selected demos: 1,2,3,4/all or names
#   DEMO_BUNDLE_INCLUDE_IMAGES=0 include real image bytes for selected demos

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-demo_snapshots}"
DEMO_MAX_KB="${DEMO_MAX_KB:-10240}"
MAX_BYTES=$((DEMO_MAX_KB * 1024))
DEMO_BUNDLE_RETENTION="${DEMO_BUNDLE_RETENTION:-10}"
DEMO_BUNDLE_FORMAT_VERSION="1.0"
if ! [[ "$DEMO_BUNDLE_RETENTION" =~ ^[0-9]+$ ]]; then
  DEMO_BUNDLE_RETENTION=10
fi

KNOWN_DEMOS=("contra-platformer" "voxel-demo" "airdoom")

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|y|Y) return 0 ;;
  esac
  return 1
}

interactive_demo_selection() {
  local selection=""
  local include_images=""

  echo "Select demo bundles to include:"
  echo "  1) contra-platformer"
  echo "  2) voxel-demo"
  echo "  3) airdoom"
  echo "  4) all"
  printf 'Enter choice(s), comma-separated [4]: '
  read -r selection || selection=""
  selection="${selection:-4}"

  printf 'Include real image assets? [y/N]: '
  read -r include_images || include_images=""

  DEMO_BUNDLE_SELECTION="$selection"
  if is_truthy "$include_images"; then
    DEMO_BUNDLE_INCLUDE_IMAGES=1
  else
    DEMO_BUNDLE_INCLUDE_IMAGES=0
  fi
}

normalize_demo_selection() {
  local raw="${1:-all}"
  local normalized="${raw// /}"
  local item
  local selected=()

  if [ -z "$normalized" ] || [ "$normalized" = "4" ] || [ "$normalized" = "all" ]; then
    selected=("${KNOWN_DEMOS[@]}")
  else
    IFS=',' read -r -a parts <<< "$normalized"
    for item in "${parts[@]}"; do
      case "$item" in
        1|contra-platformer) append_unique selected "contra-platformer" ;;
        2|voxel-demo) append_unique selected "voxel-demo" ;;
        3|airdoom) append_unique selected "airdoom" ;;
        4|all)
          selected=("${KNOWN_DEMOS[@]}")
          break
          ;;
        *)
          echo "Invalid demo bundle selection: $raw. Use 1,2,3,4 or all." >&2
          exit 1
          ;;
      esac
    done
  fi

  if [ "${#selected[@]}" -eq 0 ]; then
    echo "Invalid demo bundle selection: $raw. Use 1,2,3,4 or all." >&2
    exit 1
  fi

  SELECTED_DEMOS=("${selected[@]}")
}

append_unique() {
  local array_name="$1"
  local value="$2"
  local existing
  eval "local current=(\"\${${array_name}[@]}\")"
  for existing in "${current[@]}"; do
    if [ "$existing" = "$value" ]; then
      return
    fi
  done
  eval "$array_name+=(\"\$value\")"
}

join_by_comma() {
  local IFS=','
  echo "$*"
}

if [ -t 0 ] && [ "${CI:-0}" != "1" ] && [ -z "${DEMO_BUNDLE_SELECTION+x}" ] && [ -z "${DEMO_BUNDLE_INCLUDE_IMAGES+x}" ]; then
  interactive_demo_selection
fi

DEMO_BUNDLE_SELECTION="${DEMO_BUNDLE_SELECTION:-all}"
DEMO_BUNDLE_INCLUDE_IMAGES="${DEMO_BUNDLE_INCLUDE_IMAGES:-0}"
normalize_demo_selection "$DEMO_BUNDLE_SELECTION"

if is_truthy "$DEMO_BUNDLE_INCLUDE_IMAGES"; then
  INCLUDE_REAL_IMAGES=1
  IMAGE_POLICY="real"
else
  INCLUDE_REAL_IMAGES=0
  IMAGE_POLICY="placeholder"
fi
SELECTED_DEMOS_CSV="$(join_by_comma "${SELECTED_DEMOS[@]}")"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
BRANCH="$(git branch --show-current 2>/dev/null || echo unknown)"
TS="$(date -u +%Y-%m-%d_%H-%M-%S)"
NAME="${TS}_airlang-demo-review_${SHA}"

TMP="$(mktemp -d)"
BUNDLE="$TMP/$NAME"

mkdir -p "$BUNDLE" "$OUT_DIR"

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

selected_demos_json_lines() {
  local idx
  local count="${#SELECTED_DEMOS[@]}"
  for ((idx = 0; idx < count; idx += 1)); do
    printf '    "%s"' "$(json_escape "${SELECTED_DEMOS[$idx]}")"
    if [ "$idx" -lt $((count - 1)) ]; then
      printf ','
    fi
    printf '\n'
  done
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

file_size() {
  local p="$1"
  if [ -f "$p" ]; then
    wc -c < "$p" | tr -d ' '
  else
    printf '0'
  fi
}

log_included() {
  local p="$1"
  echo "$p" >> "$BUNDLE/INCLUDED_FILES.txt"
}

log_excluded() {
  local p="$1"
  local reason="$2"
  local detail="${3:-}"
  local size
  size="$(file_size "$p")"

  if [ -n "$detail" ]; then
    echo "$p :: $reason ($detail)" >> "$BUNDLE/EXCLUDED_FILES.txt"
  else
    echo "$p :: $reason" >> "$BUNDLE/EXCLUDED_FILES.txt"
  fi

  printf '| `%s` | %s | %s | %s |\n' \
    "$p" "$reason" "$size" "$detail" >> "$BUNDLE/DEMO_BUNDLE_OMITTED_FILES.md"
  printf '{"path":"%s","reason":"%s","size_bytes":%s,"detail":"%s"}\n' \
    "$(json_escape "$p")" \
    "$(json_escape "$reason")" \
    "$size" \
    "$(json_escape "$detail")" \
    >> "$BUNDLE/DEMO_BUNDLE_OMITTED_FILES.jsonl"
}

log_replaced() {
  local p="$1"
  local media_kind="$2"
  local placeholder="$3"
  local size
  size="$(file_size "$p")"

  printf '| `%s` | %s | %s | %s |\n' \
    "$p" "$media_kind" "$placeholder" "$size" >> "$BUNDLE/DEMO_BUNDLE_REPLACED_MEDIA.md"
  printf '{"path":"%s","media_kind":"%s","placeholder":"%s","original_size_bytes":%s}\n' \
    "$(json_escape "$p")" \
    "$(json_escape "$media_kind")" \
    "$(json_escape "$placeholder")" \
    "$size" \
    >> "$BUNDLE/DEMO_BUNDLE_REPLACED_MEDIA.jsonl"
}

is_image() {
  case "${1,,}" in
    *.png|*.jpg|*.jpeg|*.webp|*.gif|*.svg) return 0 ;;
  esac
  return 1
}

is_audio() {
  case "${1,,}" in
    *.mp3|*.wav|*.ogg|*.m4a|*.flac|*.aac) return 0 ;;
  esac
  return 1
}

write_image_placeholder() {
  local p="$1"
  local dest="$BUNDLE/$p"
  mkdir -p "$(dirname "$dest")"

  case "${p,,}" in
    *.svg)
      cat > "$dest" <<'EOF_SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#bde7ff"/></svg>
EOF_SVG
      log_replaced "$p" "image" "1x1 light-blue SVG"
      ;;
    *)
      # 1x1 RGBA PNG, fill #bde7ff. For non-PNG image extensions this is still
      # a deterministic review placeholder; it is not intended as production art.
      write_base64_file "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPY+/z/fwAIqwOj7muDkwAAAABJRU5ErkJggg==" "$dest"
      log_replaced "$p" "image" "1x1 light-blue PNG bytes"
      ;;
  esac

  log_included "$p"
}

write_audio_placeholder() {
  local p="$1"
  local dest="$BUNDLE/$p"
  mkdir -p "$(dirname "$dest")"

  case "${p,,}" in
    *.wav)
      # Valid tiny PCM WAV header with zero samples.
      write_base64_file "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=" "$dest"
      log_replaced "$p" "audio" "empty WAV header"
      ;;
    *.mp3)
      # Empty ID3v2.3 tag. It preserves the file path and media kind for review
      # without carrying music bytes.
      printf 'ID3\003\000\000\000\000\000\000' > "$dest"
      log_replaced "$p" "audio" "empty ID3 mp3 stub"
      ;;
    *)
      printf 'AIR_DEMO_REVIEW_AUDIO_PLACEHOLDER\n' > "$dest"
      log_replaced "$p" "audio" "text audio stub"
      ;;
  esac

  log_included "$p"
}

exclude_reason() {
  local p="$1"

  case "$p" in
    demo/**/.git/*|demo/.git/*) echo "git metadata"; return 0 ;;
    demo/**/node_modules/*|demo/*/node_modules/*) echo "dependency directory"; return 0 ;;
    demo/**/dist/*|demo/*/dist/*|demo/**/build/*|demo/*/build/*|demo/**/public/*|demo/*/public/*) echo "build/public output"; return 0 ;;
    demo/**/.build/*|demo/*/.build/*) echo "build database/cache"; return 0 ;;
    demo/**/tmp_unused/*|demo/*/tmp_unused/*) echo "unused/archived demo files"; return 0 ;;
    demo/**/old_bundles/*|demo/*/old_bundles/*|demo/**/archived_asset_dumps/*|demo/*/archived_asset_dumps/*|demo/**/asset_dumps/*|demo/*/asset_dumps/*) echo "archived asset or bundle dump"; return 0 ;;
    demo/**/assets_tmp_unused_previous/*|demo/*/assets_tmp_unused_previous/*) echo "archived asset leftovers"; return 0 ;;
    demo/**/references/full_pose/*|demo/*/references/full_pose/*) echo "archived/reference pose dump"; return 0 ;;
    demo/**/DerivedData/*|demo/*/DerivedData/*) echo "Xcode DerivedData"; return 0 ;;
    demo/**/target/*|demo/*/target/*) echo "Rust target output"; return 0 ;;
    demo/**/.next/*|demo/**/.vite/*|demo/**/.turbo/*|demo/**/.cache/*) echo "tool cache"; return 0 ;;
    demo/**/.DS_Store|demo/.DS_Store) echo "OS metadata"; return 0 ;;
    demo/**/.env|demo/**/*.env|demo/**/*.pem|demo/**/*.key|demo/**/id_rsa|demo/**/id_ed25519) echo "secret-like file"; return 0 ;;
  esac

  return 1
}

copy_demo_file() {
  local p="$1"

  if [ ! -f "$p" ]; then
    return
  fi

  local reason
  if reason="$(exclude_reason "$p")"; then
    log_excluded "$p" "$reason"
    return
  fi

  if is_image "$p"; then
    if [ "$INCLUDE_REAL_IMAGES" = "1" ]; then
      mkdir -p "$BUNDLE/$(dirname "$p")"
      cp "$p" "$BUNDLE/$p"
      log_included "$p"
    else
      write_image_placeholder "$p"
    fi
    return
  fi

  if is_audio "$p"; then
    write_audio_placeholder "$p"
    return
  fi

  local size
  size="$(file_size "$p")"
  if [ "$size" -gt "$MAX_BYTES" ]; then
    log_excluded "$p" "too large" "${size} bytes > ${MAX_BYTES} bytes"
    return
  fi

  mkdir -p "$BUNDLE/$(dirname "$p")"
  cp "$p" "$BUNDLE/$p"
  log_included "$p"
}

touch "$BUNDLE/INCLUDED_FILES.txt"
touch "$BUNDLE/EXCLUDED_FILES.txt"
touch "$BUNDLE/DEMO_BUNDLE_OMITTED_FILES.jsonl"
touch "$BUNDLE/DEMO_BUNDLE_REPLACED_MEDIA.jsonl"

cat > "$BUNDLE/DEMO_BUNDLE_OMITTED_FILES.md" <<EOF_OMITTED
# Omitted demo files

These files were present under \`demo/\` but intentionally omitted from the
demo review bundle. The source repository is not modified by this script.

| Path | Reason | Size bytes | Detail |
|---|---:|---:|---|
EOF_OMITTED

cat > "$BUNDLE/DEMO_BUNDLE_REPLACED_MEDIA.md" <<EOF_REPLACED
# Replaced demo media

Image and audio files are included at their original paths with tiny
deterministic placeholder bytes. This keeps demo loaders from failing on missing
paths while avoiding large/project-local artwork and music in review archives.

Placeholders are review scaffolding only. They are not approved demo assets.

| Path | Media kind | Placeholder | Original size bytes |
|---|---:|---:|---:|
EOF_REPLACED

while IFS= read -r file; do
  copy_demo_file "$file"
done < <(
  for demo_name in "${SELECTED_DEMOS[@]}"; do
    if [ ! -d "demo/$demo_name" ]; then
      echo "Invalid demo bundle selection: $demo_name. Use 1,2,3,4 or all." >&2
      exit 1
    fi
    find "demo/$demo_name" \
      \( \
        -path '*/.git' -o \
        -path '*/node_modules' -o \
        -path '*/dist' -o \
        -path '*/build' -o \
        -path '*/public' -o \
        -path '*/.build' -o \
        -path '*/tmp_unused' -o \
        -path '*/old_bundles' -o \
        -path '*/archived_asset_dumps' -o \
        -path '*/asset_dumps' -o \
        -path '*/assets_tmp_unused_previous' -o \
        -path '*/references/full_pose' -o \
        -path '*/DerivedData' -o \
        -path '*/target' -o \
        -path '*/.next' -o \
        -path '*/.vite' -o \
        -path '*/.turbo' -o \
        -path '*/.cache' -o \
        -name '*.app' \
      \) -prune -o \
      -type f -print | sed 's#^\./##'
  done
)

{
  echo "branch: $BRANCH"
  echo "commit_short: $SHA"
  echo "commit_full: $(git rev-parse HEAD 2>/dev/null || echo nogit)"
  echo "created_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "bundle_format_version: $DEMO_BUNDLE_FORMAT_VERSION"
  echo "bundle_profile: demo-review"
  echo "selected_demo_bundles: $SELECTED_DEMOS_CSV"
  echo "include_images: $([ "$INCLUDE_REAL_IMAGES" = "1" ] && echo true || echo false)"
  echo "image_policy: $IMAGE_POLICY"
  echo "max_non_media_file_kb: $DEMO_MAX_KB"
  echo "dirty: $(git diff --quiet && git diff --cached --quiet && echo no || echo yes)"
} > "$BUNDLE/SNAPSHOT_COMMIT.txt"

git status --short -- demo > "$BUNDLE/SNAPSHOT_DEMO_STATUS.txt" 2>/dev/null || true
git diff --stat -- demo > "$BUNDLE/SNAPSHOT_DEMO_DIFF.stat" 2>/dev/null || true
git diff -- demo > "$BUNDLE/SNAPSHOT_DEMO_DIFF.patch" 2>/dev/null || true
find "$BUNDLE" -type f | sed "s#^$BUNDLE/##" | sort > "$BUNDLE/SNAPSHOT_TREE.txt"

cat > "$BUNDLE/DEMO_BUNDLE_REVIEW_NOTES.md" <<EOF_NOTES
# AIR demo review bundle

This archive contains the \`demo/\` tree for orientation and evidence review.
This demo review bundle is not standalone. It is not a pristine demo asset
package, not a production build, and not an AIR Core release gate.

Use a full demo project checkout, or a full adjacent AIR Core checkout, to
install dependencies and build/run demos. Demo builds happen in their own project
checkouts.

Requests from demos are evidence, not ABI authority. Core triages requests in
\`docs/abi-requests/\`; demo request files do not automatically approve Core,
stdlib, manifest schema, or public Host ABI changes.

## Media policy

- Selected demo bundles: \`$SELECTED_DEMOS_CSV\`
- Include real image assets: \`$([ "$INCLUDE_REAL_IMAGES" = "1" ] && echo true || echo false)\`
- Image policy: \`$IMAGE_POLICY\`
- Images are $([ "$INCLUDE_REAL_IMAGES" = "1" ] && echo "included with real bytes for selected active demo paths." || echo "replaced with tiny light-blue placeholders at the same path.")
- Audio/music files are replaced with tiny mostly-empty stubs at the same path.
- Source files, AIR modules, manifests, scripts, native host files, package
  metadata, and request notes are preserved when they fit the size limit.
- Dependency directories, build outputs, tool caches, \`tmp_unused\`,
  \`old_bundles\`, and archived asset dumps are omitted.

Use \`DEMO_BUNDLE_REPLACED_MEDIA.md\` to inspect every replaced media file.
Use \`DEMO_BUNDLE_OMITTED_FILES.md\` to inspect omitted dependency/cache/large
files.
EOF_NOTES

cp "$BUNDLE/DEMO_BUNDLE_REVIEW_NOTES.md" "$BUNDLE/BUNDLE_REVIEW_NOTES.md"

DANGEROUS='-----BEGIN ((RSA|OPENSSH|EC|DSA) )?PRIVATE KEY-----|glpat-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}'
danger_files="$(
  LC_ALL=C grep -R -I -l -E -e "$DANGEROUS" "$BUNDLE" 2>/dev/null || true
)"

if [ -n "$danger_files" ]; then
  echo "ERROR: likely secrets found in included demo files:"
  echo "$danger_files"
  echo "Bundle was not created."
  rm -rf "$TMP"
  exit 1
fi

included_count="$(wc -l < "$BUNDLE/INCLUDED_FILES.txt" | tr -d ' ')"
excluded_count="$(wc -l < "$BUNDLE/EXCLUDED_FILES.txt" | tr -d ' ')"
replaced_count="$(wc -l < "$BUNDLE/DEMO_BUNDLE_REPLACED_MEDIA.jsonl" | tr -d ' ')"
included_bytes="$(find "$BUNDLE" -type f -exec wc -c {} + | awk 'END {print $1 + 0}')"

cat > "$BUNDLE/SNAPSHOT_MANIFEST.json" <<EOF_MANIFEST
{
  "name": "$NAME",
  "branch": "$(json_escape "$BRANCH")",
  "commit": "$(json_escape "$SHA")",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "bundle_format_version": "$DEMO_BUNDLE_FORMAT_VERSION",
  "bundle_profile": "demo-review",
  "selected_demo_bundles": [
$(selected_demos_json_lines)
  ],
  "includeImages": $([ "$INCLUDE_REAL_IMAGES" = "1" ] && echo true || echo false),
  "image_policy": "$IMAGE_POLICY",
  "included_files": $included_count,
  "excluded_files": $excluded_count,
  "replaced_media_files": $replaced_count,
  "included_bytes": $included_bytes,
  "max_non_media_file_kb": $DEMO_MAX_KB,
  "retention": $DEMO_BUNDLE_RETENTION,
  "media_report": "DEMO_BUNDLE_REPLACED_MEDIA.md",
  "omission_report": "DEMO_BUNDLE_OMITTED_FILES.md",
  "review_notes": "DEMO_BUNDLE_REVIEW_NOTES.md"
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
if [[ "$DEMO_BUNDLE_RETENTION" =~ ^[0-9]+$ ]] && [ "$DEMO_BUNDLE_RETENTION" -gt 0 ]; then
  archive_list="$(mktemp)"
  find "$ARCHIVE_BASE" -maxdepth 1 -type f \( \
    -name "*_airlang-demo-review_*.zip" -o \
    -name "*_airlang-demo-review_*.tar.gz" \
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
      if [ "$index" -gt "$DEMO_BUNDLE_RETENTION" ]; then
        rm -f "$file"
        deleted_count=$((deleted_count + 1))
      fi
    done < "$sorted_list"
    rm -f "$sorted_list"
  fi
  rm -f "$archive_list"
fi

echo "Created: $ARCHIVE"
echo "Bundle format: $DEMO_BUNDLE_FORMAT_VERSION"
echo "Selected demos: $SELECTED_DEMOS_CSV"
echo "Include real image assets: $([ "$INCLUDE_REAL_IMAGES" = "1" ] && echo true || echo false)"
echo "Image policy: $IMAGE_POLICY"
echo "Included files: $included_count"
echo "Excluded files: $excluded_count"
echo "Replaced media files: $replaced_count"
echo "Max non-media file size: ${DEMO_MAX_KB}KB"
echo "Retention: kept latest ${DEMO_BUNDLE_RETENTION} archive(s), deleted ${deleted_count}"
echo "Media report: DEMO_BUNDLE_REPLACED_MEDIA.md"
echo "Omission report: DEMO_BUNDLE_OMITTED_FILES.md"
echo "Review notes: DEMO_BUNDLE_REVIEW_NOTES.md"
