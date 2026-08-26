"use strict";

const { materializeFixture, scenarios } = require("../common/scenarios");
module.exports = scenarios.filter((item) => item.exampleId === "04_bounded_actuator").map(materializeFixture);
