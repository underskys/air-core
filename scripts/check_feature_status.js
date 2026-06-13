#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const errors = [];

function read(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    errors.push(`${relative}: missing file`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function readOptional(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

function requireText(relative, pattern, message) {
  const text = read(relative);
  if (!pattern.test(text)) errors.push(`${relative}: ${message}`);
  return text;
}

function rejectText(relative, pattern, message) {
  const text = read(relative);
  if (pattern.test(text)) errors.push(`${relative}: ${message}`);
}

requireText(
  "docs/FEATURE_STATUS_v0.18.md",
  /Status:\s+first-slice implementation/i,
  "must be marked as the active v0.18 first-slice implementation status"
);
requireText(
  "docs/FEATURE_STATUS_v0.18.md",
  /Bounded Facts & Output Contract Readiness/,
  "must name the active v0.18 theme"
);
requireText(
  "docs/FEATURE_STATUS_v0.18.md",
  /\| Bounded facts schema validator \| package\/check\/report \| Active first slice\./,
  "must classify bounded facts schema validator as active first slice"
);
requireText(
  "docs/FEATURE_STATUS_v0.18.md",
  /\| Output Contract manifest validator \| package\/check\/report \| Active first slice\./,
  "must classify Output Contract manifest validator as active first slice"
);
requireText(
  "docs/FEATURE_STATUS_v0.18.md",
  /\| Host ABI `0\.11` \| Deferred\./,
  "must keep Host ABI 0.11 deferred"
);
requireText(
  "docs/FEATURE_STATUS_v0.18.md",
  /\| AIR ABI `0\.11` \| Deferred\./,
  "must keep AIR ABI 0.11 deferred"
);
requireText(
  "docs/FEATURE_STATUS_v0.18.md",
  /\| Dynamic maps, GC, reflection, host object handles \| Rejected\./,
  "must keep forbidden Core expansions rejected"
);

requireText(
  "docs/RFC_CORE_STATIC_TABLES_v0.12.md",
  /Status:\s+superseded by v0\.13 first implementation slice/i,
  "must be clearly superseded after v0.13 table promotion"
);
requireText(
  "docs/RFC_CORE_MODULE_SPLIT_v0.12.md",
  /Status:\s+partially superseded by v0\.13 graph-analysis implementation/i,
  "must be clearly superseded for the v0.13 graph-analysis slice"
);

const reviewSummary = readOptional("REVIEW_RESULTS/SUMMARY.md");
if (reviewSummary) {
  if (/^# AIR v0\.\d+ RC Review Results/m.test(reviewSummary)) {
    errors.push("REVIEW_RESULTS/SUMMARY.md: version-specific RC title must use neutral AIR Core Review Results wording");
  }
  if (!/^# AIR Core Review Results/m.test(reviewSummary)) {
    errors.push("REVIEW_RESULTS/SUMMARY.md: must use neutral AIR Core Review Results title");
  }
}

for (const relative of [
  "docs/FEATURE_STATUS_v0.18.md",
  "docs/V0_18_RELEASE_PLAN.md",
  "README.md",
  "spec/AIR_CORE.md",
  "src/ai_review.js"
]) {
  rejectText(
    relative,
    /static (?:scalar )?tables?.{0,120}(?:not active|syntax remains rejected|RFC-gated|when .*v0\.12.*accepted|when .*v0\.12.*available)/is,
    "active surfaces must not describe static tables as rejected, draft-only, or waiting for v0.12 acceptance"
  );
  rejectText(
    relative,
    /when (?:those )?v0\.12 features are available|when the v0\.12 table slice is accepted/i,
    "AI repair hints must not refer to promoted features as future v0.12 work"
  );
}

for (const relative of [
  "README.md",
  "docs/RC_REVIEW_BUNDLE_POLICY.md",
  "scripts/make_review_bundle.sh"
]) {
  rejectText(
    relative,
    /active v0\.13|v0\.13 RC review|AIR v0\.13 RC Review Bundle Policy/i,
    "active onboarding and bundle policy text must not describe v0.13 as current"
  );
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("feature status hygiene: ok");
