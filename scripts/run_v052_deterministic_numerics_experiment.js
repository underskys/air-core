#!/usr/bin/env node
"use strict";

const { run } = require("./research/v052/run_deterministic_numerics_experiment");

run().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
