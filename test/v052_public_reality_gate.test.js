#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");const fs=require("node:fs");const os=require("node:os");const path=require("node:path");
const {parseArgs,aggregate,exactInventory,sha256,resolveInstallation,secretSignature}=require("../scripts/v052_public_reality_gate");
let checks=0;
function rejects(fn,code){assert.throws(fn,e=>e.code===code);checks++;}
rejects(()=>parseArgs([]),"gate.arguments_invalid");
rejects(()=>parseArgs(["--project=x"]),"gate.arguments_invalid");
rejects(()=>parseArgs(["--project","x","--project","y"]),"gate.arguments_invalid");
assert.equal(secretSignature(Buffer.from(["-----BEGIN","PRIVATE","KEY-----"].join(" "))),"private_key");checks++;
assert.equal(secretSignature(Buffer.from("ordinary public documentation")),null);checks++;
const records=Array.from({length:10},(_,i)=>({id:`R${String(i+1).padStart(2,"0")}`,status:"PASS"}));
assert.equal(aggregate(records),"PASS");checks++;
for(const status of ["BLOCKED","NOT_RUN","FAIL"]){assert.equal(aggregate(records.map((r,i)=>i===6?{...r,status}:r)),status==="FAIL"?"FAIL":"BLOCKED");checks++;}
rejects(()=>aggregate(records.slice(1)),"gate.records_incomplete");
rejects(()=>aggregate([...records.slice(1),records[1]]),"gate.records_incomplete");
rejects(()=>aggregate(records.map((r,i)=>i===3?{...r,status:"PASS_WITH_SKIP"}:r)),"gate.records_invalid");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"air-public-gate-unit-"));
try {
  const pkgRoot=path.join(root,"node_modules/@underskys/air-core");fs.mkdirSync(pkgRoot,{recursive:true});
  const content="\"use strict\"; module.exports={};\n";fs.writeFileSync(path.join(pkgRoot,"index.js"),content);
  const inv=[{path:"index.js",sha256:sha256(Buffer.from(content))}];
  assert.equal(exactInventory(pkgRoot,inv).file_count,1);checks++;
  rejects(()=>exactInventory(pkgRoot,[...inv,...inv]),"gate.inventory_invalid");
  rejects(()=>exactInventory(pkgRoot,[{path:"../escape",sha256:inv[0].sha256}]),"gate.inventory_invalid");
  rejects(()=>exactInventory(pkgRoot,[{path:"root.png",sha256:inv[0].sha256}]),"gate.private_content");
  const onePixelPng=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(onePixelPng);Buffer.from("IHDR").copy(onePixelPng,12);onePixelPng.writeUInt32BE(1,16);onePixelPng.writeUInt32BE(1,20);
  fs.mkdirSync(path.join(pkgRoot,"docs"));fs.writeFileSync(path.join(pkgRoot,"docs/placeholder.png"),onePixelPng);
  rejects(()=>exactInventory(pkgRoot,[...inv,{path:"docs/placeholder.png",sha256:sha256(onePixelPng)}]),"gate.placeholder_content");
  fs.unlinkSync(path.join(pkgRoot,"docs/placeholder.png"));fs.rmdirSync(path.join(pkgRoot,"docs"));
  rejects(()=>exactInventory(pkgRoot,[{path:"REVIEW_RESULTS/log",sha256:inv[0].sha256}]),"gate.private_content");
  const secret=Buffer.from(["-----BEGIN","OPENSSH","PRIVATE","KEY-----"].join(" "));fs.writeFileSync(path.join(pkgRoot,"secret.txt"),secret);
  rejects(()=>exactInventory(pkgRoot,[...inv,{path:"secret.txt",sha256:sha256(secret)}]),"gate.secret_signature");fs.unlinkSync(path.join(pkgRoot,"secret.txt"));
  rejects(()=>exactInventory(pkgRoot,[{path:"index.js",sha256:"0".repeat(64)}]),"gate.package_hash_mismatch");
  fs.writeFileSync(path.join(pkgRoot,"extra"),"x");rejects(()=>exactInventory(pkgRoot,inv),"gate.unexpected_package_file");fs.unlinkSync(path.join(pkgRoot,"extra"));
  fs.symlinkSync(path.join(pkgRoot,"index.js"),path.join(pkgRoot,"link"));rejects(()=>exactInventory(pkgRoot,inv),"gate.package_symlink");fs.unlinkSync(path.join(pkgRoot,"link"));
  fs.writeFileSync(path.join(root,"package.json"),'{"private":true}');
  fs.writeFileSync(path.join(pkgRoot,"package.json"),'{"name":"airlang-dev-workspace","private":true}');
  rejects(()=>resolveInstallation(root),"gate.package_identity");
  fs.writeFileSync(path.join(pkgRoot,"package.json"),JSON.stringify({name:"@underskys/air-core",private:false,version:"0.0.0-test-only",main:"index.js",bin:{airc:"../../escape.js"}}));
  rejects(()=>resolveInstallation(root),"gate.cli_invalid");
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log(`public gate unit checks: ${checks}; synthetic fixtures test the harness only, not AIR or package readiness`);
