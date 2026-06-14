#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "ERROR: NPM_TOKEN is not set." >&2
  exit 1
fi

USERCONFIG="$(mktemp)"
cleanup() {
  rm -f "$USERCONFIG"
}
trap cleanup EXIT

printf '%s\n' "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$USERCONFIG"
export NPM_CONFIG_USERCONFIG="$USERCONFIG"

node -e '
const p = require("./package.json");
if (p.name !== "@underskys/air-core" || p.private === true || !p.bin || p.bin.airc !== "./bin/airc.js") {
  console.error(JSON.stringify({ name: p.name, private: p.private, bin: p.bin }, null, 2));
  process.exit(1);
}
'

npm ping --registry=https://registry.npmjs.org/
export NPM_USER="$(npm whoami --registry=https://registry.npmjs.org/)"
npm view @underskys/air-core name version dist-tags --json --registry=https://registry.npmjs.org/ >/tmp/air-core-npm-view.json

node -e '
const fs = require("fs");
const view = JSON.parse(fs.readFileSync("/tmp/air-core-npm-view.json", "utf8"));
console.log(JSON.stringify({
  kind: "air.npmAuthCheck",
  status: "passed",
  package: view.name || "@underskys/air-core",
  publishedVersion: view.version || null,
  distTags: view["dist-tags"] || {},
  npmUser: process.env.NPM_USER || "<unknown>"
}, null, 2));
'
