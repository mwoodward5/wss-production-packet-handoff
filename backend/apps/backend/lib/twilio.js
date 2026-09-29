const { createHmac, timingSafeEqual } = require("node:crypto");
const { providerStatus } = require("./registry");
const { recordEvent, select } = require("./store");

function assertTextConsent(input = {}) {
  if (!input.consentToText) {
    const error = new Error("Texting is blocked until the prospect gives explicit SMS consent.");
    error.statusCode = 403;
    error.code = "text_consent_required";
    throw error;
  }
}

function smsBlockedError(message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = code;
  error.details = details;
  return error;
}

async function assertSmsNotSuppressed(to) {
  const phone = String(to || "").trim();
  if (!phone) return;

  const query = new URLSearchParams({
    select: "suppression_key,reason,updated_at",
    suppression_key: `eq.${phone}`,
    limit: "1",
  }).toString();
  const result = await select("ghost_agency_suppressions", query);

  if (!result.ok) {
    throw smsBlockedError(
      "Texting is blocked because the SMS suppression list could not be verified.",
      "sms_suppression_check_failed",
      { mode: result.mode, status: result.status, table: result.table },
    );
  }

  if (Array.isArray(result.data) && result.data.length > 0) {
    throw smsBlockedError("Texting is blocked because this number is suppressed.", "sms_suppressed", {
      reason: result.data[0].reason || "suppressed",
      updated_at: result.data[0].updated_at || null,
    });
  }
}

async function sendTwilioMessage(input = {}) {
  assertTextConsent(input);
  const status = providerStatus().twilio;
  const sender = input.sender && typeof input.sender === "object" ? {
    messagingServiceSid: String(input.sender.messagingServiceSid || "").trim(),
    fromNumber: String(input.sender.fromNumber || "").trim(),
  } : { messagingServiceSid: "", fromNumber: "" };
  const credentialsConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim());
  const configured = status.configured || (credentialsConfigured && Boolean(sender.messagingServiceSid || sender.fromNumber));
  const to = input.to || input.phone || input.prospect?.phone;
  const body =
    input.body ||
    "Your Woodward local visibility report and preview-site direction are ready. Reply YES if you want a walkthrough.";
  if (!to) {
    const error = new Error("Missing destination phone number.");
    error.statusCode = 400;
    error.code = "missing_phone";
    throw error;
  }
  await assertSmsNotSuppressed(to);
  if (input.dryRun === true) {
    return {
      mode: "dry_run",
      configured,
      reason: "explicit_dry_run",
      plannedMessage: { to, body, sender },
    };
  }
  if (!configured) {
    return {
      mode: "dry_run",
      configured: false,
      reason: "Twilio credentials/sender not configured",
      plannedMessage: { to, body, sender },
    };
  }

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("Body", body);
  if (sender.messagingServiceSid || process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()) {
    params.set("MessagingServiceSid", sender.messagingServiceSid || process.env.TWILIO_MESSAGING_SERVICE_SID.trim());
  } else {
    params.set("From", sender.fromNumber || process.env.TWILIO_FROM_NUMBER.trim());
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID.trim();
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`,
          "utf8",
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );
  const json = await response.json().catch(() => ({}));
  await recordEvent("twilio_message", { to, status: response.status, json });
  if (!response.ok) {
    return { mode: "send_failed", configured: true, status: response.status, error: json };
  }
  return { mode: "message_sent", configured: true, sid: json.sid, status: json.status };
}

function validateTwilioSignature(url, params, header) {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) {
    return { verified: false, configured: false, reason: "TWILIO_AUTH_TOKEN not configured" };
  }
  if (!header) {
    return { verified: false, configured: true, reason: "X-Twilio-Signature header missing" };
  }
  const sorted = Object.keys(params || {})
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  const expected = createHmac("sha1", token).update(`${url}${sorted}`).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  const verified = a.length === b.length && timingSafeEqual(a, b);
  return { verified, configured: true };
}

module.exports = {
  assertTextConsent,
  assertSmsNotSuppressed,
  sendTwilioMessage,
  validateTwilioSignature,
};
