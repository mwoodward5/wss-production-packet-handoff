"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const orchestrate = require("./orchestrate");

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  return orchestrate(req, res);
};
