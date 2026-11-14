# Fail-closed secret scan for the bundle scripts. Sourced, never run.
#
# bundle_scan_tree ROOT PATTERN CANARY...
#
# Reads every byte of every file under ROOT, binary files included, for the
# extended regular expression PATTERN, and prints each file that matches, one
# per line. ROOT must be an absolute path. It returns:
#   0  the scan ran and found nothing
#   1  the scan ran and found something; the files are printed
#   2  the scan could not show that it ran; nothing is printed
#
# A scan counts as run only when it also found every CANARY. A CANARY is a
# string PATTERN must match; callers give one for each branch of PATTERN. Each
# is written to a fresh folder outside ROOT, once as a text line and once after
# a NUL byte, and the first also in a hidden file in a hidden folder. One grep
# call reads that folder and ROOT. So a grep or env that is missing, fails,
# exits 1 without reading, skips binary or hidden files, or takes options from
# the environment cannot pass for a clean scan. The canaries show that grep read
# their folder whole; they cannot show that it read every file under ROOT.
#
# ROOT may hold only folders and regular files: grep and zip treat links
# differently, and a FIFO can block grep.
#
# The canary folder is made by this function's own mkdir, which fails if
# anything is already at the name, so the function only ever removes a folder
# it made itself.
#
# Callers run under set -e, which does not apply inside a function called
# from an || list, so every status here is checked by hand. No line here sets a
# locale in the shell itself: LC_ALL reaches grep only through env's arguments.

bundle_scan_tree() {
  local root pattern tmp dir odd out status line canary i noglob nfound IFS
  local -a expect lines found
  root="${1:-}"
  pattern="${2:-}"
  if [ "$#" -lt 3 ] || [ -z "$root" ] || [ -z "$pattern" ]; then
    echo "bundle_scan_tree: needs ROOT, PATTERN and at least one CANARY" >&2
    return 2
  fi
  shift 2
  while [ "${#root}" -gt 1 ] && [ "${root%/}" != "$root" ]; do
    root="${root%/}"
  done
  # An absolute ROOT: find would read a relative name such as -d as an operator.
  case "$root" in
    /*) ;;
    *)
      echo "bundle_scan_tree: ROOT must be an absolute path: $root" >&2
      return 2
      ;;
  esac
  if [ ! -d "$root" ] || [ -L "$root" ]; then
    echo "bundle_scan_tree: not a folder: $root" >&2
    return 2
  fi

  tmp="${TMPDIR:-/tmp}"
  while [ "${#tmp}" -gt 1 ] && [ "${tmp%/}" != "$tmp" ]; do
    tmp="${tmp%/}"
  done
  dir="$(mktemp -u "$tmp/bundle_scan.XXXXXXXXXX")" || return 2
  case "$dir" in
    /?*) ;;
    *)
      echo "bundle_scan_tree: no absolute name for the canary folder" >&2
      return 2
      ;;
  esac
  if ! mkdir -m 700 -- "$dir" || [ ! -d "$dir" ] || [ -L "$dir" ]; then
    echo "bundle_scan_tree: could not make its canary folder" >&2
    return 2
  fi
  expect=()
  i=0
  for canary in "$@"; do
    i=$((i + 1))
    if ! printf '%s\n' "$canary" > "$dir/text$i" ||
       ! printf '\000%s\n' "$canary" > "$dir/nul$i"; then
      rm -rf "$dir"
      return 2
    fi
    expect+=("$dir/text$i" "$dir/nul$i")
  done
  if ! mkdir -- "$dir/.hidden" || ! printf '%s\n' "$1" > "$dir/.hidden/.text"; then
    rm -rf "$dir"
    return 2
  fi
  expect+=("$dir/.hidden/.text")

  # The folder check has a canary too: find must report this link, or its
  # silence proves nothing about ROOT.
  if ! ln -s text1 "$dir/link"; then
    rm -rf "$dir"
    return 2
  fi
  status=0
  odd="$(find "$dir" "$root" ! -type f ! -type d -print)" || status=$?
  if [ "$status" -ne 0 ] || [ "$odd" != "$dir/link" ]; then
    case "$odd" in
      "$dir/link") echo "bundle_scan_tree: find failed (status $status)" >&2 ;;
      *"$dir/link"*)
        echo "bundle_scan_tree: only folders and regular files may be scanned (the canary link aside):" >&2
        printf '%s\n' "$odd" >&2
        ;;
      *) echo "bundle_scan_tree: find did not report its canary (status $status)" >&2 ;;
    esac
    rm -rf "$dir"
    return 2
  fi

  status=0
  out="$(command env -i PATH="$PATH" LC_ALL=C grep -R -a -l -E -e "$pattern" -- "$dir" "$root")" || status=$?
  rm -rf "$dir"
  if [ "$status" -ne 0 ]; then
    echo "bundle_scan_tree: grep did not report the canaries (status $status)" >&2
    return 2
  fi

  for canary in "${expect[@]}"; do
    case $'\n'"$out"$'\n' in
      *$'\n'"$canary"$'\n'*) ;;
      *)
        echo "bundle_scan_tree: canary not reported: $canary" >&2
        return 2
        ;;
    esac
  done
  # Split in memory and in linear time, by newline with globbing off: a
  # here-document needs a temporary file, and one that cannot be made would
  # skip the loop and read as a clean scan. No name that matters is empty.
  case "$-" in *f*) noglob=1 ;; *) noglob=0 ;; esac
  set -f
  IFS=$'\n'
  lines=($out)
  IFS=$' \t\n'
  [ "$noglob" = 1 ] || set +f
  found=()
  nfound=0
  for line in "${lines[@]}"; do
    case "$line" in
      "$dir"/*) ;;
      "$root"/*)
        found+=("$line")
        nfound=$((nfound + 1))
        ;;
      *)
        echo "bundle_scan_tree: unexpected grep output" >&2
        return 2
        ;;
    esac
  done

  if [ "$nfound" -gt 0 ]; then
    printf '%s\n' "${found[@]}"
    return 1
  fi
  return 0
}
