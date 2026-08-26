"use strict";

const { runAllExamples } = require("../examples/ai_gate/common/scenarios");

function run() {
  const records = runAllExamples();
  for (const { internal, ...record } of records) process.stdout.write(`${JSON.stringify(record)}\n`);
  const failures = records.filter((record) => record.PASS !== "PASS");
  const summary = { EXAMPLE_COUNT: records.length, PASS: failures.length === 0, FAILED_SCENARIOS: failures.map((record) => record.SCENARIO_ID) };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (failures.length) process.exitCode = 1;
  return { records, summary };
}

if (require.main === module) run();

module.exports = { run };
