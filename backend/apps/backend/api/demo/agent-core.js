"use strict";

const { buildAnswerCrewAssistantConfig } = require("../../lib/answercrew-agent-core");
const { sendJson } = require("../../lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  const built = buildAnswerCrewAssistantConfig({
    agent_name: "Alex",
    business_name: "AnswerCrew Home Services",
    city: "Fresno",
    trade: "plumbing",
    services: ["leak repair", "drain clearing", "water heater service"],
    service_area: "Fresno and nearby communities",
    hours: "Monday through Friday, eight to five, with emergency callbacks after hours",
    pricing_notes: "Diagnostic pricing is confirmed by the owner before booking",
    booking_method: "capture the caller's preferred time and send it to the owner for confirmation",
    owner_name: "Jordan",
    emergency_keywords: ["burst pipe", "active flooding", "no water"],
  }, { accountId: "public-demo" });
  return sendJson(res, 200, {
    ok: true,
    core_version: built.coreVersion,
    first_message: built.config.firstMessage,
    model: built.config.model.model,
    voice_model: built.config.voice.model,
    recording_enabled: built.config.artifactPlan.recordingEnabled,
    profile: built.profile,
    system_prompt: built.prompt,
  });
};
