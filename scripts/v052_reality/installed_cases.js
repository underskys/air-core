#!/usr/bin/env node
"use strict";
// This worker resolves ONLY the installed package's advertised root export.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {createRequire}=require("node:module");
const {spawnSync}=require("node:child_process");
const [id,project,cli,fixtureDir,shippedTyped]=process.argv.slice(2);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"air-public-retest-"));
const expectedPackageRoot=path.join(fs.realpathSync(project),"node_modules/@underskys/air-core");
const req=createRequire(path.join(project,"package.json"));
const I64=decimal=>({type:"i64",decimal});
const read=name=>fs.readFileSync(path.join(fixtureDir,name),"utf8");
const input=name=>({source:read(name+".air"),descriptor:JSON.parse(read(name+".interface.json")),sourceProfile:"typed-v0.51"});
function cliRun(args) { return spawnSync(process.execPath,[cli,...args],{cwd:project,encoding:"utf8",timeout:10000,maxBuffer:256*1024}); }
function cliPass(args) { const r=cliRun(args);assert.equal(r.status,0,r.stderr||r.error?.code);return r; }
function cliDeny(args,code) {const r=cliRun(args);assert.notEqual(r.status,0);assert.equal(r.error,undefined);assert(!/(?:TypeError|RangeError|ReferenceError|\n\s+at\s)/.test(r.stderr));if(code) assert(r.stderr.includes(code),r.stderr);return r;}
async function denied(action,code) {await assert.rejects(action,e=>e.code===code && !(e instanceof RangeError));}
let api;
async function cases() {
  assert(req.resolve("@underskys/air-core").startsWith(expectedPackageRoot+path.sep),"private source fallback");
  api=req("@underskys/air-core");
  const build=()=>api.buildVerifiedTypedModule(input("limit"));
  const runtime=(admit=async()=>true,limits)=>api.createVerifiedTypedRuntime({admit,...(limits?{limits}:{})});
  if(id==="R01") {
    const sourceFile=shippedTyped || path.join(fixtureDir,"limit.air");
    cliPass(["verify",sourceFile,"--source-profile","typed-v0.51"]);
    cliPass(["build","--source-profile","typed-v0.51",sourceFile,"--emit","wasm","-o",path.join(tmp,"limit.wasm")]);
    assert(WebAssembly.validate(fs.readFileSync(path.join(tmp,"limit.wasm"))));
    const result=await build();
    for(const n of ["-9223372036854775808","9223372036854775807","9007199254740993"]) assert.deepEqual((await api.invokeVerifiedTypedExport(result,"echo",[I64(n)])).value,I64(n));
    return {status:shippedTyped?"PASS":"BLOCKED",evidence:{installed_cli:true,installed_sdk:true,exact_i64_cases:3,shipped_typed_fixture:Boolean(shippedTyped)},
      reason:shippedTyped?undefined:"installed implementation executed, but a byte-identical shipped typed fixture was not found in the reviewed inventory"};
  }
  if(id==="R02") {
    cliPass(["verify",path.join(fixtureDir,"legacy.air"),"--source-profile","legacy-v0.50"]);
    cliDeny(["verify",path.join(fixtureDir,"legacy_invalid.air"),"--source-profile","legacy-v0.50"],"air.control.br_if_syntax_invalid");
    cliDeny(["verify",path.join(fixtureDir,"legacy.air"),"--source-profile","typed-v0.51"],"air.v051.typed_syntax_invalid");
    cliDeny(["verify",path.join(fixtureDir,"legacy.air"),"--source-profile","unknown"],"air.source_profile.unsupported");
    return {status:"PASS",scope:"bounded explicit-profile fixture subset; full compatibility corpus is R10"};
  }
  if(id==="R03") {
    const r=runtime();const one=await r.build(input("limit"));const two=await r.build(input("panel"));
    assert.deepEqual((await r.invoke(one,"echo",[I64("9007199254740993")])).value,I64("9007199254740993"));
    assert.deepEqual((await r.invoke(two,"show_badge",[{type:"option<bool>",tag:"some",value:true},{type:"panel.control::Badge",discriminant:1}])).value,
      {type:"option<panel.control::Badge>",tag:"some",value:{type:"panel.control::Badge",discriminant:1}});
    return {status:"PASS",evidence:{distinct_module_schemas:2,shared_runtime:true}};
  }
  if(id==="R04") {
    // Trusted test host owns tokens/limits. This is NOT an AIR GrantSet implementation.
    const token=Object.freeze({});let revoked=false;
    const r=runtime(async(_,ctx)=>ctx?.token===token && !revoked && BigInt(ctx.value)<=100n);
    const context={token,value:"75"};const h=await r.build(input("limit"),context);
    const before=r.inspect().counters.successfulInvocations;
    assert.equal((await r.invoke(h,"within_business_limit",[I64(context.value)],context)).value,false);
    assert.equal(r.inspect().counters.successfulInvocations,before+1);
    await denied(()=>r.invoke(h,"within_business_limit",[I64("120")],{token,value:"120"}),"air.v052.runtime_admission_denied");
    revoked=true;
    await denied(()=>r.invoke(h,"within_business_limit",[I64("25")],{token,value:"25"}),"air.v052.runtime_admission_denied");
    return {status:"PASS",scope:"controlled trusted-host fixture, not production grant/effect mediation",evidence:{hard_limit:100,air_threshold:50,request:75,air_result:false}};
  }
  if(id==="R05") {
    let revoked=false;const r=runtime(async()=>!revoked);const inA=input("limit");
    const [a,b]=await Promise.all([r.build(inA),r.build({...inA,sourceName:"not-semantic.air"})]);
    assert.equal(a.artifactDigest,b.artifactDigest);assert.equal(r.inspect().counters.compilations,1);
    await r.build(inA);assert.equal(r.inspect().counters.compilations,1);
    revoked=true;await denied(()=>r.invoke(a,"echo",[I64("1")]),"air.v052.runtime_admission_denied");
    revoked=false;
    await denied(()=>r.invoke(a,"checked_add",[I64("9223372036854775807"),I64("1")]),"air.numeric.checked_failure");
    assert.deepEqual((await r.invoke(a,"echo",[I64("3")])).value,I64("3"));
    assert.equal(r.inspect().counters.instantiations,2);
    await r.build({...inA,source:inA.source+"\n"});assert.equal(r.inspect().counters.compilations,2);
    await denied(()=>r.build({...inA,sourceProfile:"other"}),"air.source_profile.unsupported");
    const foreign=runtime();await foreign.build(inA);
    await denied(()=>foreign.invoke(a,"echo",[I64("3")]),"air.v052.runtime_handle_untrusted");
    return {status:"PASS",scope:"cache/single-flight/revocation/instance isolation on finite pure fixtures; toolchain mutation requires source QA"};
  }
  if(id==="R06") {
    const h=await build();
    await denied(()=>api.invokeVerifiedTypedExport(h,"echo",[Number.MAX_SAFE_INTEGER+2]),"air.v051.record_invalid");
    for(const arg of [I64("9223372036854775808"),I64("-9223372036854775809"),I64("01")])
      await denied(()=>api.invokeVerifiedTypedExport(h,"echo",[arg]),"air.v051.typed_value_invalid");
    await denied(()=>api.invokeVerifiedTypedExport({...h},"echo",[I64("1")]),"air.v052.verified_build_untrusted");
    const panel=await api.buildVerifiedTypedModule(input("panel"));
    await denied(()=>api.invokeVerifiedTypedExport(panel,"show_badge",[{type:"option<bool>",tag:"invalid"},{type:"panel.control::Badge",discriminant:1}]),"air.v051.typed_value_invalid");
    await denied(()=>api.invokeVerifiedTypedExport(panel,"show_badge",[{type:"option<bool>",tag:"none"},{type:"panel.control::Badge",discriminant:2}]),"air.decision.enum_discriminant_invalid");
    await denied(()=>api.invokeVerifiedTypedExport({...h,descriptor:panel.descriptor},"echo",[I64("1")]),"air.v052.verified_build_untrusted");
    h.wasmBytes[0]^=255;
    await denied(()=>api.invokeVerifiedTypedExport(h,"echo",[I64("1")]),"air.v052.verified_build_wasm_mismatch");
    const malformed=input("limit");malformed.descriptor.exports[0].parameters[0].type="option<".repeat(8000)+"i64"+">".repeat(8000);
    await denied(()=>api.buildVerifiedTypedModule(malformed),"air.decision.payload_type_unsupported");
    return {status:"PASS",scope:"i64/tags/provenance/substitution/deep-invalid-type; not a claim of unsupported refinement execution"};
  }
  if(id==="R07") {
    for(const [limit,code] of [["maxSourceBytes","air.v052.work_limit_source_bytes"],["maxDescriptorBytes","air.v052.work_limit_descriptor_bytes"],["maxAstNodes","air.v052.work_limit_ast_nodes"],["maxWatBytes","air.v052.work_limit_wat_bytes"],["maxWasmBytes","air.v052.work_limit_wasm_bytes"]])
      await denied(()=>runtime(async()=>true,{[limit]:1}).build(input("limit")),code);
    const r=runtime(async()=>true,{maxInvocationLanes:1});const h=await r.build(input("limit"));
    await denied(()=>r.invoke(h,"echo",[I64("1")]),"air.v052.work_limit_invocation_lanes");
    const descriptor=input("limit").descriptor;
    for(const statement of ["call @other()","loop","br nowhere"]) {
      const source=`module public_limit\nexport func run() -> i32 {\n${statement}\nreturn 0\n}\n`;
      await denied(()=>api.buildVerifiedTypedModule({source,descriptor,sourceProfile:"typed-v0.51"}),"air.v051.typed_syntax_invalid");
    }
    const limits=r.inspect().limits;
    return {status:"PASS",scope:"typed-v0.51 static emission bound; no dynamic WorkBound ABI",evidence:{
      forbidden_dynamic_control_flow:["call","loop","br"],invocation_lane_limit_is_arity_only:true,
      max_ast_nodes:limits.maxAstNodes,max_source_bytes:limits.maxSourceBytes,max_wasm_bytes:limits.maxWasmBytes,
      max_wat_bytes:limits.maxWatBytes,source_owned_linearity_witness:"test/v052_typed_subset_work_witness.test.js"}};
  }
  if(id==="R08") {
    cliDeny(["verify",path.join(fixtureDir,"legacy_invalid.air"),"--source-profile","legacy-v0.50"],"air.control.br_if_syntax_invalid");
    cliDeny(["verify",path.join(fixtureDir,"legacy.air"),"--source-profile=typed-v0.51"],"air.source_profile.invalid_form");
    cliDeny(["verify",path.join(fixtureDir,"legacy.air"),"--source-profile","legacy-v0.50","--source-profile","typed-v0.51"],"air.source_profile.duplicate");
    cliDeny(["not_a_command"],"air.cli.command_unknown");
    return {status:"PASS",scope:"declared malformed/profile/unknown-command fixtures"};
  }
  throw new Error("undeclared case");
}
cases().then(record=>console.log(JSON.stringify({id,...record}))).catch(e=>{
  const blocked=e.code==="MODULE_NOT_FOUND" && /wabt/.test(e.message);
  console.log(JSON.stringify({id,status:blocked?"BLOCKED":"FAIL",reason:e.code||e.name,message:String(e.message).slice(0,2048)}));
}).finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
