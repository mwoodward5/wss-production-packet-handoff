const { requireAdmin } = require("../lib/admin-auth");
const { methodGuard, sendJson } = require("../lib/http");
const { SYSTEMS } = require("../lib/registry");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;
  sendJson(res, 200, {
    ok: true,
    systems: SYSTEMS,
    order: [
      "leadminer",
      "callprep",
      "rocketSerps",
      "woodwardLabs",
      "dreamForge",
      "missionControl",
      "deck",
    ],
  });
};
