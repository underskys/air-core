"use strict";

const assert = require("assert");
const { runAllExamples } = require("../examples/ai_gate/common/scenarios");
const fixtureGroups = [
  require("../examples/ai_gate/01_music_assistant/fixtures"),
  require("../examples/ai_gate/02_prompt_injection/fixtures"),
  require("../examples/ai_gate/03_provider_portability/fixtures"),
  require("../examples/ai_gate/04_bounded_actuator/fixtures"),
  require("../examples/ai_gate/05_filesystem_network_agent/fixtures")
];

const records = runAllExamples();
assert.strictEqual(records.length, 15, "the Golden AI Gate pack has one executable record per required scenario");
for (const record of records) {
  assert.strictEqual(record.PASS, "PASS", `${record.SCENARIO_ID} must pass`);
  assert.strictEqual(record.internal.sameProviderOutcome, true, `${record.SCENARIO_ID} must not depend on provider identity`);
  assert.strictEqual(record.internal.rawExcluded, true, `${record.SCENARIO_ID} must exclude raw proposal text from AIR semantic input`);
  assert.strictEqual(record.internal.additionalChecksPass, true, `${record.SCENARIO_ID} must pass every documented supplementary check`);
}
const effectiveExecution = records.find((record) => record.internal.execution);
assert(effectiveExecution, "one scenario must demonstrate execution of only effective narrowed values");
assert.strictEqual(effectiveExecution.internal.execution.operations, "4");
assert.strictEqual(effectiveExecution.internal.execution.max_uses, "1");
for (const fixture of fixtureGroups.flat()) {
  assert.strictEqual(fixture.untrusted_proposal_marker, "NON_AIR_CORE_TYPE");
  assert(fixture.decision_intent.intent && fixture.grant_set.grants && fixture.observations.observations);
}
console.log(`v0.51 Golden AI Gate examples: ${records.length} scenarios passed`);
