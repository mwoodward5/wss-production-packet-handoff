const { providerStatus } = require("./registry");
const { recordEvent } = require("./store");

const DEFAULT_BLOCKED_PHONE_NUMBER_IDS = ["5fc1d88e-e744-4a72-b6e6-f8919d5ecfcd"];

function envList(name, fallback = []) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertCallConsent(input = {}) {
  if (!input.consentToCall) {
    const error = new Error("Outbound AI calling is blocked until the prospect gives call consent.");
    error.statusCode = 403;
    error.code = "call_consent_required";
    throw error;
  }
}

function localGrowthScript(input = {}) {
  const businessName = input.businessName || input.prospect?.businessName || "your business";
  const ownerName = input.customerName || input.prospect?.ownerName || "there";
  return (
    input.firstMessage ||
    `Hi ${ownerName}, this is Woodward calling about the website preview and local visibility report you requested for ${businessName}. I can walk you through what we found and what we can fix first.`
  );
}

function assistantOverrides(input = {}) {
  const current = input.assistantOverrides || {};
  return {
    ...current,
    firstMessage: current.firstMessage || localGrowthScript(input),
    variableValues: {
      ownerName: input.customerName || input.prospect?.ownerName || "there",
      businessName: input.businessName || input.prospect?.businessName || "your business",
      city: input.city || input.prospect?.city || "",
      offerName: "local website growth plan",
      ...current.variableValues,
    },
  };
}

function resolveVapiIds(input = {}) {
  return {
    assistantId:
      input.assistantId ||
      process.env.VAPI_LOCAL_GROWTH_ASSISTANT_ID ||
      process.env.VAPI_ASSISTANT_ID,
    phoneNumberId:
      input.phoneNumberId ||
      process.env.VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID ||
      process.env.VAPI_PHONE_NUMBER_ID,
  };
}

function assertCleanPhoneNumber(phoneNumberId) {
  const blocked = envList("VAPI_BLOCKED_PHONE_NUMBER_IDS", DEFAULT_BLOCKED_PHONE_NUMBER_IDS);
  if (phoneNumberId && blocked.includes(phoneNumberId)) {
    const error = new Error(
      "Outbound VAPI calling is blocked because the configured phone number is a rejected legacy line. Set VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID to a clean VAPI number before running calls.",
    );
    error.statusCode = 409;
    error.code = "legacy_vapi_phone_number_blocked";
    throw error;
  }
}

async function createVapiCall(input = {}) {
  assertCallConsent(input);
  const status = providerStatus().vapi;
  const customerNumber = input.to || input.phone || input.prospect?.phone;
  if (!customerNumber) {
    const error = new Error("Missing destination phone number.");
    error.statusCode = 400;
    error.code = "missing_phone";
    throw error;
  }

  const ids = resolveVapiIds(input);
  assertCleanPhoneNumber(ids.phoneNumberId);

  const body = {
    assistantId: ids.assistantId,
    phoneNumberId: ids.phoneNumberId,
    customer: {
      number: customerNumber,
      name: input.customerName || input.prospect?.ownerName || "Business owner",
    },
    assistantOverrides: assistantOverrides(input),
    metadata: {
      jobId: input.jobId || input.job?.id || "",
      businessName: input.businessName || input.prospect?.businessName || "",
      product: "local-growth-website-plan",
      system: "woodward-local-growth",
    },
  };

  if (!status.configured) {
    return {
      mode: "dry_run",
      configured: false,
      reason: "VAPI_API_KEY, VAPI_ASSISTANT_ID, and/or VAPI_PHONE_NUMBER_ID not configured",
      plannedCall: body,
    };
  }

  const response = await fetch(process.env.VAPI_CALLS_URL || "https://api.vapi.ai/call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  await recordEvent("vapi_call", { customerNumber, status: response.status, json });
  if (!response.ok) {
    return { mode: "call_failed", configured: true, status: response.status, error: json };
  }
  return { mode: "call_created", configured: true, id: json.id, status: json.status, json };
}

function verifyVapiWebhook(req) {
  const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return { verified: false, configured: false, reason: "VAPI_WEBHOOK_SECRET not configured" };
  }
  const header =
    req.headers["x-vapi-signature"] ||
    req.headers["x-vapi-secret"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return {
    configured: true,
    verified: Boolean(header && String(header) === secret),
  };
}

module.exports = {
  assertCallConsent,
  createVapiCall,
  verifyVapiWebhook,
};
