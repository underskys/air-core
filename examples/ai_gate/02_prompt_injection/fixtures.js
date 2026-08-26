"use strict";

const { materializeFixture, scenarios } = require("../common/scenarios");
module.exports = scenarios.filter((item) => item.exampleId === "02_prompt_injection").map(materializeFixture);
