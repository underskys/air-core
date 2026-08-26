"use strict";

const { materializeFixture, scenarios } = require("../common/scenarios");
module.exports = scenarios.filter((item) => item.exampleId === "03_provider_portability").map(materializeFixture);
