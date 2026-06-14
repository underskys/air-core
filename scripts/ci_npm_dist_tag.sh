#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "ERROR: NPM_TOKEN is not set." >&2
  exit 1
fi
if [ -z "${AIR_NPM_VERSION:-}" ] || [ -z "${AIR_NPM_DIST_TAG:-}" ]; then
  echo "ERROR: AIR_NPM_VERSION and AIR_NPM_DIST_TAG are required." >&2
  exit 1
fi
if [ "${AIR_NPM_DIST_TAG_UPDATE:-}" != "1" ] || [ "${AIR_RELEASE_DECISION:-}" != "OK" ]; then
  echo "ERROR: dist-tag update requires AIR_NPM_DIST_TAG_UPDATE=1 and AIR_RELEASE_DECISION=OK." >&2
  exit 1
fi
if ! printf '%s' "$AIR_NPM_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'; then
  echo "ERROR: AIR_NPM_VERSION is not a package version: $AIR_NPM_VERSION" >&2
  exit 1
fi
if ! printf '%s' "$AIR_NPM_DIST_TAG" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
  echo "ERROR: AIR_NPM_DIST_TAG has invalid npm dist-tag syntax: $AIR_NPM_DIST_TAG" >&2
  exit 1
fi

PACKAGE_NAME="$(node -p "require('./package.json').name")"
if [ "$PACKAGE_NAME" != "@underskys/air-core" ]; then
  echo "ERROR: package name must be @underskys/air-core; got $PACKAGE_NAME" >&2
  exit 1
fi

USERCONFIG="$(mktemp)"
cleanup() {
  rm -f "$USERCONFIG"
}
trap cleanup EXIT

printf '%s\n' "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$USERCONFIG"
export NPM_CONFIG_USERCONFIG="$USERCONFIG"

npm whoami --registry=https://registry.npmjs.org/ >/dev/null
npm view "${PACKAGE_NAME}@${AIR_NPM_VERSION}" version --registry=https://registry.npmjs.org/ >/dev/null
npm dist-tag add "${PACKAGE_NAME}@${AIR_NPM_VERSION}" "$AIR_NPM_DIST_TAG" --registry=https://registry.npmjs.org/
npm dist-tag ls "$PACKAGE_NAME" --registry=https://registry.npmjs.org/
