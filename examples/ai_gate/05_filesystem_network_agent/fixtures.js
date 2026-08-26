"use strict";

const { materializeFixture, scenarios } = require("../common/scenarios");
module.exports = scenarios.filter((item) => item.exampleId === "05_filesystem_network_agent").map(materializeFixture);
