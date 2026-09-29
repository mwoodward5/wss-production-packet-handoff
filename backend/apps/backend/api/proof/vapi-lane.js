"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { providerStatus } = require("../../lib/registry");
const { recordEvent } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;

  const status = providerStatus().vapi;
  const cleanAssistant = Boolean(process.env.VAPI_LOCAL_GROWTH_ASSISTANT_ID?.trim());
  const cleanNumber = Boolean(process.env.VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID?.trim());
  const blockedCsv = process.env.VAPI_BLOCKED_PHONE_NUMBER_IDS || "";
  const configuredNumber = process.env.VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID || process.env.VAPI_PHONE_NUMBER_ID || "";
  const blocked = blockedCsv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(configuredNumber);

  const missingEnv = [];
  if (!process.env.VAPI_API_KEY?.trim()) missingEnv.push("VAPI_API_KEY");
  if (!cleanAssistant) missingEnv.push("VAPI_LOCAL_GROWTH_ASSISTANT_ID");
  if (!cleanNumber) missingEnv.push("VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID");
  const recommendedEnv = [];
  if (!process.env.VAPI_WEBHOOK_SECRET?.trim()) recommendedEnv.push("VAPI_WEBHOOK_SECRET");
  if (!process.env.GHOST_AGENCY_OWNER_PHONE?.trim()) recommendedEnv.push("GHOST_AGENCY_OWNER_PHONE");

  const ok = Boolean(status.configured && cleanAssistant && cleanNumber && !blocked);
  await recordEvent("proof.vapi_lane", {
    ok,
    configured: status.configured,
    cleanAssistant,
    cleanNumber,
    blocked,
    missingEnv,
    recommendedEnv,
  });

  sendJson(res, ok ? 200 : 503, {
    ok,
    provider: {
      configured: status.configured,
      webhookConfigured: status.webhookConfigured,
      cleanLaneConfigured: status.cleanLaneConfigured,
    },
    checks: {
      cleanAssistant,
      cleanNumber,
      configuredNumberBlocked: blocked,
    },
    missingEnv,
    recommendedEnv,
    next: ok
      ? "Clean lane ready. Next step is an owner-only smoke call to GHOST_AGENCY_OWNER_PHONE. No prospect calls."
      : `Blocked. Missing env: ${missingEnv.join(", ") || "none - check VAPI_BLOCKED_PHONE_NUMBER_IDS"}. Never reuse legacy assistants or numbers.`,
  });
};
