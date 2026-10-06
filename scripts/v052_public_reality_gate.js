#!/usr/bin/env node
"use strict";
// Evidence tooling only. This program neither installs nor publishes packages.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {createRequire} = require("node:module");
const {spawnSync} = require("node:child_process");
const PACKAGE = "@underskys/air-core";
const REQUIRED = ["R01","R02","R03","R04","R05","R06","R07","R08","R09","R10"];
const FLAGS = ["project","expected-version","expected-cli-version","tarball","tarball-sha256","inventory","inventory-sha256","source-root","source-commit","source-tree","report"];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function problem(code,message) { const e=new Error(message); e.code=code; return e; }
function demand(ok,code,message) { if(!ok) throw problem(code,message); }
function readLimited(file,max=64*1024*1024) {
  const st=fs.lstatSync(file);
  demand(st.isFile() && !st.isSymbolicLink() && st.size<=max,"gate.input_invalid","input must be a bounded regular file");
  return fs.readFileSync(file);
}
function isOnePixelPng(bytes) {
  return bytes.length >= 24 &&
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    bytes.subarray(12,16).toString("ascii") === "IHDR" &&
    bytes.readUInt32BE(16) === 1 && bytes.readUInt32BE(20) === 1;
}
function parseArgs(argv) {
  const out={};
  for(let i=0;i<argv.length;i+=2) {
    const key=argv[i].startsWith("--") ? argv[i].slice(2) : "";
    demand(FLAGS.includes(key) && !Object.hasOwn(out,key) && typeof argv[i+1]==="string" && !argv[i+1].startsWith("--"),
      "gate.arguments_invalid","use each required --flag VALUE exactly once; '=' form is not supported");
    out[key]=argv[i+1];
  }
  for(const flag of FLAGS) demand(Boolean(out[flag]),"gate.arguments_invalid",`missing --${flag}`);
  for(const key of ["tarball-sha256","inventory-sha256","source-commit","source-tree"]) demand(/^[a-f0-9]{40}$/.test(out[key]) || (/sha256/.test(key) && /^[a-f0-9]{64}$/.test(out[key])),"gate.arguments_invalid",`${key} has an invalid digest`);
  return out;
}
function secretSignature(bytes) {
  if(bytes.includes(0)) return null;
  const text=bytes.toString("utf8");
  const signatures=[
    ["private_key",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["aws_access_key",/\bAKIA[0-9A-Z]{16}\b/],
    ["github_token",/\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
    ["gitlab_token",/\bglpat-[A-Za-z0-9_-]{20,}\b/],
    ["npm_token",/\bnpm_[A-Za-z0-9]{36,}\b/]
  ];
  return signatures.find(([,pattern])=>pattern.test(text))?.[0] || null;
}
function exactInventory(root,expected) {
  demand(Array.isArray(expected) && expected.length>0 && expected.length<=20000,"gate.inventory_invalid","inventory must be a nonempty bounded file array");
  const map=new Map();
  for(const row of expected) {
    demand(row && typeof row.path==="string" && !row.path.includes("\\") && !row.path.startsWith("/") &&
      !row.path.split("/").some(x=>x===".." || x==="." || !x) && /^[a-f0-9]{64}$/.test(row.sha256) && !map.has(row.path),
      "gate.inventory_invalid","unsafe path, duplicate path or invalid digest");
    demand(!/(^|\/)(?:\.git|\.swiftpm|REVIEW_RESULTS|snapshots|prompts|air_evidence)(\/|$)/i.test(row.path) &&
      !/(^|\/)(?:SNAPSHOT_|BUNDLE_|SECRET_SCAN)/.test(row.path) &&
      !/\.(?:zip|tgz|token|pem)$/i.test(row.path) && !/^([^/]+)\.(?:png|jpe?g|webp)$/i.test(row.path),
      "gate.private_content","private/review material or unintended root asset is forbidden");
    map.set(row.path,row.sha256);
  }
  const seen=[];let total=0;
  function walk(rel) {
    for(const name of fs.readdirSync(path.join(root,rel)).sort()) {
      const child=rel?`${rel}/${name}`:name;const full=path.join(root,child);const st=fs.lstatSync(full);
      demand(!st.isSymbolicLink(),"gate.package_symlink","installed package contains symlink");
      if(st.isDirectory()) walk(child);
      else {
        demand(st.isFile() && seen.length<20000 && (total+=st.size)<=128*1024*1024,"gate.inventory_invalid","installed content exceeds inventory limits");
        demand(map.has(child),"gate.unexpected_package_file",`unlisted installed file: ${child}`);
        const bytes=fs.readFileSync(full);
        demand(sha256(bytes)===map.get(child),"gate.package_hash_mismatch",`content mismatch: ${child}`);
        demand(!/\.png$/i.test(child) || !isOnePixelPng(bytes),"gate.placeholder_content",`1x1 placeholder PNG is forbidden: ${child}`);
        demand(!secretSignature(bytes),"gate.secret_signature",`secret signature is forbidden: ${child}`);
        seen.push(child);
      }
    }
  }
  walk("");
  demand(seen.length===map.size,"gate.missing_package_file","installed package does not contain every declared file");
  return {file_count:seen.length,total_bytes:total};
}
function reviewPublicClaims(installed,expectedVersion) {
  const read=name=>readLimited(path.join(installed.root,name),2*1024*1024).toString("utf8");
  const readme=read("README.md");const changelog=read("CHANGELOG.md");const notes=read(`docs/RELEASE_NOTES_${String(expectedVersion).replace(/\./g,"_")}.md`);
  const combined=[readme,changelog,notes].join("\n");
  demand(readme.includes(`@underskys/air-core@${expectedVersion}`),"gate.claims_invalid","README candidate version is missing");
  demand(changelog.includes(`v${expectedVersion}`) && notes.includes(`@underskys/air-core@${expectedVersion}`),"gate.claims_invalid","release history version is missing");
  for(const marker of ["legacy-v0.50","typed-v0.51","candidate-only"])
    demand(combined.includes(marker),"gate.claims_invalid",`public claims are missing ${marker}`);
  demand(/Host ABI[^\n]*(?:unchanged|are unchanged)/i.test(combined),"gate.claims_invalid","Host ABI non-change is not explicit");
  demand(/not (?:a )?(?:CapabilityGrant|production effect|AIR grant)/i.test(combined),"gate.claims_invalid","runtime authority boundary is not explicit");
  return {claims_files:3,secret_findings:0,placeholder_findings:0,abi_012_candidate_only:true,host_abi_changed:false};
}
function spawnBounded(command,args,cwd,timeout=300000,maxBuffer=64*1024*1024) {
  return spawnSync(command,args,{cwd,env:process.env,encoding:"utf8",timeout,maxBuffer});
}
function commandText(result) { return `${result.stdout||""}\n${result.stderr||""}`; }
function runSourceRegression(options) {
  const root=fs.realpathSync(path.resolve(options["source-root"]));
  const git=(args)=>spawnBounded("git",["-C",root,...args],root,30000,1024*1024);
  const head=git(["rev-parse","HEAD^{commit}"]);const tree=git(["rev-parse","HEAD^{tree}"]);const status=git(["status","--porcelain=v1","--untracked-files=all"]);
  demand(head.status===0 && head.stdout.trim()===options["source-commit"],"gate.source_identity","source commit mismatch");
  demand(tree.status===0 && tree.stdout.trim()===options["source-tree"],"gate.source_identity","source tree mismatch");
  demand(status.status===0 && status.stdout.trim()==="","gate.source_dirty","source worktree must be clean");
  const npmTest=spawnBounded("npm",["test"],root);
  const npmOutput=commandText(npmTest);
  demand(npmTest.status===0,"gate.source_regression","source npm test failed");
  demand(npmOutput.includes('"browserConformance":"pass:playwright-chromium"') && npmOutput.includes('"browserResult":"pass:playwright-chromium"'),"gate.browser_evidence","pinned Chromium evidence is missing from npm test");
  const g2=spawnBounded(process.execPath,["scripts/run_v052_deterministic_numerics_experiment.js"],root,120000,16*1024*1024);
  demand(g2.status===0,"gate.g2_regression","G2 runner failed");
  let g2Report;try{g2Report=JSON.parse(g2.stdout);}catch(_){throw problem("gate.g2_regression","G2 runner did not emit JSON");}
  demand(g2Report.vectors_executed===38 && /^HOLD_CROSS_HOST_SWIFT_/.test(g2Report.swift_wasm_result),"gate.g2_regression","G2 accounting or Swift/Wasm HOLD changed");
  const s4=spawnBounded(process.execPath,["scripts/run_v052_pressure_conformance.js"],root,120000,16*1024*1024);
  demand(s4.status===0,"gate.s4_regression","S4 runner failed");
  let s4Report;try{s4Report=JSON.parse(s4.stdout);}catch(_){throw problem("gate.s4_regression","S4 runner did not emit JSON");}
  demand(s4Report.summary.vector_count===24 && s4Report.summary.fail_count===0 && s4Report.summary.unexpected_host_exception_count===0,"gate.s4_regression","S4 accounting changed");
  const diff=git(["diff","--check"]);demand(diff.status===0,"gate.source_diff","git diff --check failed");
  return {source_commit:options["source-commit"],source_tree:options["source-tree"],npm_test:"PASS",browser:"PASS_PLAYWRIGHT_CHROMIUM",g2_vectors:38,
    s4_vectors:24,swift_wasm_gate:g2Report.swift_wasm_result,npm_output_sha256:sha256(Buffer.from(npmOutput)),git_diff_check:"PASS"};
}
function resolveInstallation(project) {
  project=fs.realpathSync(project);
  const root=path.join(project,"node_modules","@underskys","air-core");
  demand(fs.realpathSync(root)===root,"gate.package_symlink","package must be an installed directory, not npm link/workspace source");
  const pkg=JSON.parse(readLimited(path.join(root,"package.json"),1024*1024));
  demand(pkg.name===PACKAGE && pkg.private!==true,"gate.package_identity","private development workspace is not a public candidate");
  const req=createRequire(path.join(project,"package.json"));const entry=req.resolve(PACKAGE);
  demand(entry.startsWith(root+path.sep),"gate.private_source_fallback","public SDK resolution escaped the installed package");
  const bin=typeof pkg.bin==="object" && pkg.bin && pkg.bin.airc;
  demand(typeof bin==="string","gate.cli_missing","package must declare airc bin");
  const cli=path.resolve(root,bin);
  demand(cli.startsWith(root+path.sep) && fs.realpathSync(cli)===cli,"gate.cli_invalid","airc must be a regular in-package entrypoint");
  return {project,root,pkg,entry,cli};
}
function aggregate(records) {
  const ids=records.map(r=>r.id);
  demand(records.length===REQUIRED.length && new Set(ids).size===REQUIRED.length && REQUIRED.every(id=>ids.includes(id)),
    "gate.records_incomplete","exact R01-R10 accounting required");
  demand(records.every(r=>["PASS","FAIL","BLOCKED","NOT_RUN"].includes(r.status)),"gate.records_invalid","unknown result status");
  return records.some(r=>r.status==="FAIL")?"FAIL":records.every(r=>r.status==="PASS")?"PASS":"BLOCKED";
}
function safeEnvironment() {
  const keep=["PATH","SystemRoot","WINDIR","TMPDIR","TMP","TEMP","LANG","LC_ALL","TZ"];
  return Object.fromEntries(keep.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
}
function childCase(id,installed,fixtures,shippedTyped = "") {
  const result=spawnSync(process.execPath,[path.join(__dirname,"v052_reality/installed_cases.js"),
    id,installed.project,installed.cli,fixtures,shippedTyped],{cwd:installed.project,env:safeEnvironment(),encoding:"utf8",timeout:20000,maxBuffer:512*1024});
  if(result.error) return {id,status:result.error.code==="ETIMEDOUT"?"BLOCKED":"FAIL",reason:result.error.code||"child_error"};
  try {
    const record=JSON.parse(result.stdout);
    demand(record.id===id && result.status===0,"gate.child_failure","child did not complete normally");
    return record;
  } catch(_) { return {id,status:"FAIL",reason:"invalid_child_result",exit_code:result.status,stderr:(result.stderr||"").slice(0,8192)}; }
}
function run(options) {
  // The caller must use a NEW output path, never overwrite prior evidence.
  const reportPath=path.resolve(options.report);
  demand(!fs.existsSync(reportPath),"gate.report_exists","refusing to overwrite prior evidence");
  const fixtures=path.resolve(__dirname,"../fixtures/v052/public_reality");
  const fixtureManifest=readLimited(path.join(fixtures,"manifest.json"),1024*1024);
  for(const row of JSON.parse(fixtureManifest).files) {
    demand(typeof row.path==="string" && path.basename(row.path)===row.path,"gate.fixture_identity","invalid fixture path");
    demand(sha256(readLimited(path.join(fixtures,row.path)))===row.sha256,"gate.fixture_identity","test fixture changed");
  }
  const report={schema:"air.test.public-reality-report/1",scope:"INSTALLED_SURFACE_SUBGATE_NOT_FULL_S5_QA",records:[],
    public_package_retest:"BLOCKED",s5_complete:false,expected_inputs:{package:PACKAGE,version:options["expected-version"],
    cli_version:options["expected-cli-version"],tarball_sha256:options["tarball-sha256"],inventory_sha256:options["inventory-sha256"]},
    harness_sha256:sha256(fs.readFileSync(__filename)),fixture_manifest_sha256:sha256(fixtureManifest)};
  try {
    const tarball=readLimited(path.resolve(options.tarball));
    demand(sha256(tarball)===options["tarball-sha256"],"gate.tarball_hash","tarball digest mismatch");
    const inventoryBytes=readLimited(path.resolve(options.inventory),8*1024*1024);
    demand(sha256(inventoryBytes)===options["inventory-sha256"],"gate.inventory_hash","inventory digest mismatch");
    const installed=resolveInstallation(path.resolve(options.project));
    demand(installed.pkg.version===options["expected-version"],"gate.version_mismatch","installed package version differs from supplied decision");
    const lock=JSON.parse(readLimited(path.join(installed.project,"package-lock.json"),8*1024*1024));
    const locked=lock.packages && lock.packages["node_modules/"+PACKAGE];
    const sri="sha512-"+crypto.createHash("sha512").update(tarball).digest("base64");
    demand(locked && locked.integrity===sri && locked.link!==true,"gate.install_provenance","lockfile does not bind the supplied tarball bytes");
    const inventoryFileList=JSON.parse(inventoryBytes).files;
    const inventory=exactInventory(installed.root,inventoryFileList);
    const typedFixtureDigest=sha256(readLimited(path.join(fixtures,"limit.air")));
    const shippedRow=inventoryFileList.find(row=>row.path.endsWith(".air") && row.sha256===typedFixtureDigest);
    const shippedTyped=shippedRow?path.join(installed.root,shippedRow.path):"";
    report.installation={package:installed.pkg.name,version:installed.pkg.version,integrity:sri,...inventory};
    for(const id of ["R01","R02","R03","R04","R05","R06","R07","R08"]) report.records.push(childCase(id,installed,fixtures,shippedTyped));
    report.post_execution_inventory=exactInventory(installed.root,inventoryFileList);
    const cliVersion=spawnSync(process.execPath,[installed.cli,"version","--json"],{cwd:installed.project,env:safeEnvironment(),encoding:"utf8",timeout:15000,maxBuffer:65536});
    let version;
    try { version=JSON.parse(cliVersion.stdout).version; } catch(_) {}
    demand(cliVersion.status===0 && version===options["expected-cli-version"],"gate.cli_version_mismatch","CLI version differs from supplied decision");
    report.records.push({id:"R09",status:"PASS",evidence:reviewPublicClaims(installed,options["expected-version"])});
    report.records.push({id:"R10",status:"PASS",evidence:runSourceRegression(options)});
  } catch(e) {
    report.preflight={status:"FAIL",code:e.code||"gate.input_or_environment",message:String(e.message).slice(0,1024)};
    for(const id of REQUIRED) if(!report.records.some(r=>r.id===id)) report.records.push({id,status:"NOT_RUN",reason:"preflight_or_prior_stage_failed"});
  }
  report.status=report.preflight?"FAIL":aggregate(report.records);
  report.public_package_retest=report.status;
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  return report;
}
if(require.main===module) {
  try {const report=run(parseArgs(process.argv.slice(2)));console.log(JSON.stringify({status:report.status,report:process.argv[process.argv.indexOf("--report")+1]}));process.exitCode=report.status==="PASS"?0:report.status==="FAIL"?1:2;}
  catch(e) { console.error(JSON.stringify({status:"BLOCKED",code:e.code||"gate.input_or_environment",message:String(e.message).slice(0,1024)}));process.exitCode=2; }
}
module.exports={parseArgs,exactInventory,resolveInstallation,aggregate,sha256,isOnePixelPng,secretSignature,reviewPublicClaims,runSourceRegression,run};
