"use strict";

const { materializeFixture, scenarios } = require("../common/scenarios");
module.exports = scenarios.filter((item) => item.exampleId === "01_music_assistant").map(materializeFixture);
