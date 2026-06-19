#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "ERROR: NPM_TOKEN is not set." >&2
  exit 1
fi

DIST_TAG="${AIR_NPM_DIST_TAG:-alpha}"
EXPECTED_NAME="${AIR_NPM_EXPECTED_NAME:-@underskys/air-core}"
EXPECTED_VERSION="${AIR_NPM_EXPECTED_VERSION:-0.45.1}"
EXPECTED_TAG="${AIR_NPM_EXPECTED_TAG:-v0.45.1}"
export EXPECTED_NAME EXPECTED_VERSION EXPECTED_TAG
if ! printf '%s' "$DIST_TAG" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
  echo "ERROR: AIR_NPM_DIST_TAG has invalid npm dist-tag syntax: $DIST_TAG" >&2
  exit 1
fi

PACKAGE_NAME="$(node -p "require('./package.json').name")"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"

node -e '
const p = require("./package.json");
if (p.name !== process.env.EXPECTED_NAME || p.version !== process.env.EXPECTED_VERSION || p.license !== "Apache-2.0" || p.private === true || !p.bin || p.bin.airc !== "bin/airc.js") {
  console.error(JSON.stringify({ name: p.name, version: p.version, license: p.license, private: p.private, bin: p.bin }, null, 2));
  process.exit(1);
}
'

if [ "${PACKAGE_NAME}" != "${EXPECTED_NAME}" ] || [ "${PACKAGE_VERSION}" != "${EXPECTED_VERSION}" ]; then
  echo "ERROR: package identity must be ${EXPECTED_NAME}@${EXPECTED_VERSION}; got ${PACKAGE_NAME}@${PACKAGE_VERSION}" >&2
  exit 1
fi

if [ "${CI_COMMIT_TAG:-}" != "$EXPECTED_TAG" ]; then
  echo "ERROR: publish requires tag pipeline ${EXPECTED_TAG}; got ${CI_COMMIT_TAG:-<none>}" >&2
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

if npm view "${PACKAGE_NAME}@${PACKAGE_VERSION}" version --registry=https://registry.npmjs.org/ >/tmp/air-core-existing-version.txt 2>/dev/null; then
  echo "ERROR: ${PACKAGE_NAME}@${PACKAGE_VERSION} already exists on npm. Bump package.json before publishing." >&2
  cat /tmp/air-core-existing-version.txt >&2
  exit 1
fi

npm run check:public-package-surface
npm run check:public-claims
npm run check:review-bundle-policy
npm pack --dry-run --json > npm-publish-dry-run.json
npm pack --json > npm-publish-pack.json
TARBALL="$(node -e 'const fs=require("fs"); const pack=JSON.parse(fs.readFileSync("npm-publish-pack.json","utf8"))[0]; process.stdout.write(pack.filename);')"
test -f "$TARBALL"

npm publish "$TARBALL" --access public --tag "$DIST_TAG" --registry=https://registry.npmjs.org/

node -e '
const p = require("./package.json");
console.log(JSON.stringify({
  kind: "air.npmPublish",
  status: "published",
  package: p.name,
  version: p.version,
  distTag: process.env.AIR_NPM_DIST_TAG || "alpha"
}, null, 2));
'
