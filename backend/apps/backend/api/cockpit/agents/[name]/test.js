"use strict";

const { handleCockpitProxy } = require("../../../../lib/mission-control-commerce");

function agentName(req) {
  const path = String(req.url || "").split("?")[0].split("/").filter(Boolean);
  return decodeURIComponent(req.query?.name || path[path.length - 2] || "");
}

module.exports = async function handler(req, res) {
  const name = agentName(req);
  await handleCockpitProxy(req, res, {
    methods: ["POST", "OPTIONS"],
    targetPath: `/api/agents/${encodeURIComponent(name)}/test`,
  });
};
