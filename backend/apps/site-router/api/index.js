"use strict";

const { createRouterApplication } = require("../lib/application");
const { createProductionStore } = require("../lib/store");

module.exports = createRouterApplication({
  env: process.env,
  store: createProductionStore({ env: process.env })
});
module.exports.createRouterApplication = createRouterApplication;
