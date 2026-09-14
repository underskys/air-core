#!/usr/bin/env node
"use strict";
const assert = require("node:assert");
const { declaresHostAbi012, hostAbiDetectorInvariants } = require("../scripts/api_gate_detection");
for (const [ok, message] of hostAbiDetectorInvariants()) assert(ok, message);
for (const text of [
  'const HOST_ABI = "0.12";', 'const HOST_ABI_VERSION = "0.12";',
  'const hostAbiVersion = "0.12";', 'const x = {hostAbiVersion: "0.12"};',
  'const x = {"hostAbiVersion": "0.12"};', "const x = {'hostAbi': '0.12'};",
  'host_abi_lane = "0.12"', 'Host ABI lane `0.12`'
]) assert(declaresHostAbi012(text), text);
for (const text of [
  'const AIR_ABI = "0.12"; const lane = manifest.hostAbi;',
  'const ABI_012 = "0.12"; const keys = ["hostAbi"];',
  'const hostAbiVersion = "0.11";', 'const myhostAbiVersion = "0.12";',
  'const unrelated = "0.12"; const hostAbiVersion = "0.11";'
]) assert(!declaresHostAbi012(text), text);
console.log("v0.52 historical gate reconciliation: positive/negative detector invariants passed");
