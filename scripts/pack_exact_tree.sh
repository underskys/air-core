#!/usr/bin/env bash
# Packs @underskys/air-core from an exact git tree (QA52 P2-1).
#
# The package is built from a clean `git archive` export under umask 022, so
# each packed file has the mode git records (0644, or 0755 for executables)
# whatever the permissions in a working checkout are. npm fixes entry order
# and timestamps, so the same tree gives the same tarball bytes.
#
# usage: scripts/pack_exact_tree.sh <git-ref> <out-dir>
set -euo pipefail

ref="${1:?usage: scripts/pack_exact_tree.sh <git-ref> <out-dir>}"
out="${2:?usage: scripts/pack_exact_tree.sh <git-ref> <out-dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

umask 022
git -C "$root" archive --format=tar "$ref" | tar -x -C "$work"
mkdir -p "$out"
dest="$(cd "$out" && pwd)"
(cd "$work" && npm pack --json --pack-destination "$dest")
