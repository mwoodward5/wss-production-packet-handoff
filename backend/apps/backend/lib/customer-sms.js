"use strict";

const { assertSmsNotSuppressed, sendTwilioMessage } = require("./twilio");
const { insertRow, select, upsertRow } = require("./store");

const CONVERSATIONS_TABLE = "answercrew_sms_conversations";
const MESSAGES_TABLE = "answercrew_sms_messages";
const MAPPINGS_TABLE = "answercrew_sms_number_mappings";
const DEMO_TABLE = "answercrew_sms_demo_sends";

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function httpError(statusCode, code, message, detail) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.detail = detail;
  return error;
}

function normalizePhone(value, field = "phone") {
  const raw = clean(value, 80);
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  if (!raw || digits.length < 11 || digits.length > 15) {
    throw httpError(400, "invalid_phone", `${field} must be a valid phone number`);
  }
  return `+${digits}`;
}

function phoneKey(value) {
  return normalizePhone(value).replace(/\D/g, "");
}

function requireTextConsent(input = {}) {
  if (input.consent_to_text !== true && input.consentToText !== true) {
    throw httpError(403, "sms_consent_required", "Explicit SMS consent is required before texting");
  }
  if (!clean(input.consent_source || input.consentSource, 160)) {
    throw httpError(403, "sms_consent_source_required", "SMS consent source is required before texting");
  }
  if (!clean(input.consent_proof || input.consentProof, 500)) {
    throw httpError(403, "sms_consent_proof_required", "Durable SMS consent proof is required before texting");
  }
}

async function queryRows(table, filters = {}, options = {}) {
  const params = new URLSearchParams();
  params.set("select", options.select || "*");
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  if (options.order) params.set("order", options.order);
  if (options.limit) params.set("limit", String(options.limit));
  const result = await select(table, params.toString());
  if (!result.ok) {
    throw httpError(503, "sms_data_unavailable", "SMS data could not be verified", {
      table,
      mode: result.mode,
      status: result.status,
    });
  }
  return result.data;
}

async function writeRow(table, row) {
  const result = await insertRow(table, row);
  if (result.mode === "live_write_failed") {
    throw httpError(result.status === 409 ? 409 : 503, result.status === 409 ? "sms_write_conflict" : "sms_write_failed", "SMS data could not be saved", {
      table,
      status: result.status,
      error: result.error,
    });
  }
  return Array.isArray(result.row) ? result.row[0] : null;
}

async function updateRow(table, row) {
  const result = await upsertRow(table, row, "id");
  if (result.mode === "live_upsert_failed") {
    throw httpError(503, "sms_update_failed", "SMS data could not be updated", {
      table,
      status: result.status,
      error: result.error,
    });
  }
  return Array.isArray(result.row) ? result.row[0] : null;
}

async function conversationForAccount(accountId, conversationId) {
  const rows = await queryRows(CONVERSATIONS_TABLE, {
    account_id: `eq.${accountId}`,
    id: `eq.${clean(conversationId, 160)}`,
    limit: "1",
  });
  return rows[0] || null;
}

async function listConversations(context) {
  return queryRows(CONVERSATIONS_TABLE, {
    account_id: `eq.${context.account.id}`,
    order: "updated_at.desc",
    limit: "100",
  });
}

async function listMessages(context, conversationId) {
  const conversation = await conversationForAccount(context.account.id, conversationId);
  if (!conversation) throw httpError(404, "sms_conversation_not_found", "SMS conversation not found");
  const messages = await queryRows(MESSAGES_TABLE, {
    account_id: `eq.${context.account.id}`,
    conversation_id: `eq.${conversation.id}`,
    order: "created_at.asc",
    limit: "200",
  });
  return { conversation, messages };
}

async function outboundMappingForAccount(accountId) {
  const mappings = await queryRows(MAPPINGS_TABLE, {
    account_id: `eq.${accountId}`,
    active: "eq.true",
    limit: "10",
  });
  const mapping = mappings.find((row) => clean(row.messaging_service_sid, 80) || clean(row.twilio_phone_number, 80));
  if (!mapping) throw httpError(409, "sms_number_assignment_pending", "An active SMS number or messaging service must be assigned before sending");
  const serviceSid = clean(mapping.messaging_service_sid, 80);
  const fromNumber = clean(mapping.twilio_phone_number, 80);
  if (!serviceSid && !fromNumber) throw httpError(409, "sms_number_assignment_pending", "An active SMS number or messaging service must be assigned before sending");
  if (fromNumber) normalizePhone(fromNumber, "assigned Twilio phone");
  return { id: mapping.id || null, messagingServiceSid: serviceSid, fromNumber };
}

async function createConversation(context, input = {}) {
  const phone = normalizePhone(input.phone || input.customer_phone, "customer phone");
  requireTextConsent(input);
  const existing = (await queryRows(CONVERSATIONS_TABLE, {
    account_id: `eq.${context.account.id}`,
    customer_phone: `eq.${phone}`,
    limit: "1",
  }))[0];
  const now = new Date().toISOString();
  const row = {
    ...(existing || {}),
    account_id: context.account.id,
    customer_phone: phone,
    customer_name: clean(input.customer_name || input.customerName, 160) || existing?.customer_name || null,
    consent_to_text: true,
    consent_source: clean(input.consent_source || input.consentSource, 160),
    consent_proof: clean(input.consent_proof || input.consentProof, 500) || null,
    consent_granted_at: existing?.consent_granted_at || now,
    updated_at: now,
  };
  const result = await upsertRow(CONVERSATIONS_TABLE, row, "account_id,customer_phone");
  if (result.mode === "live_upsert_failed") {
    throw httpError(503, "sms_conversation_save_failed", "SMS conversation could not be saved", { status: result.status });
  }
  return Array.isArray(result.row) ? result.row[0] : row;
}

async function reserveMessage(context, conversation, input, mapping) {
  const idempotencyKey = clean(input.idempotency_key || input.idempotencyKey, 160);
  if (!idempotencyKey) throw httpError(400, "idempotency_key_required", "idempotency_key is required for SMS sends");
  const existing = (await queryRows(MESSAGES_TABLE, {
    account_id: `eq.${context.account.id}`,
    idempotency_key: `eq.${idempotencyKey}`,
    limit: "1",
  }))[0];
  if (existing) return { existing, idempotencyKey };
  const reserved = await writeRow(MESSAGES_TABLE, {
    account_id: context.account.id,
    conversation_id: conversation.id,
    direction: "outbound",
    from_phone: mapping.fromNumber ? normalizePhone(mapping.fromNumber, "assigned Twilio phone") : null,
    to_phone: conversation.customer_phone,
    body: clean(input.body, 1600),
    status: "pending",
    idempotency_key: idempotencyKey,
    provider: "twilio",
    payload: { source: "answercrew_customer_sms", mapping_id: mapping.id },
  });
  if (!reserved) {
    throw httpError(503, "sms_reservation_unavailable", "SMS send could not be safely reserved");
  }
  return { reserved, idempotencyKey };
}

async function sendCustomerSms(context, input = {}, conversationId) {
  const body = clean(input.body || input.message, 1600);
  if (!body) throw httpError(400, "sms_body_required", "SMS body is required");
  const conversation = await conversationForAccount(context.account.id, conversationId || input.conversation_id || input.conversationId);
  if (!conversation) throw httpError(404, "sms_conversation_not_found", "SMS conversation not found");
  if (!conversation.consent_to_text || !clean(conversation.consent_source, 160) || !clean(conversation.consent_proof, 500)) {
    throw httpError(403, "sms_consent_required", "This conversation does not have verified SMS consent");
  }
  const destination = normalizePhone(conversation.customer_phone, "customer phone");
  const mapping = await outboundMappingForAccount(context.account.id);
  await assertSmsNotSuppressed(destination);
  const reservation = await reserveMessage(context, conversation, input, mapping);
  if (reservation.existing) return { ok: true, idempotent: true, conversation, message: reservation.existing };
  const dryRun = input.dry_run === true || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "testing";
  const provider = await sendTwilioMessage({
    to: destination,
    body,
    consentToText: true,
    dryRun,
    sender: mapping,
  });
  const status = provider.mode === "send_failed" ? "failed" : provider.mode === "message_sent" ? "sent" : "dry_run";
  const message = await updateRow(MESSAGES_TABLE, {
    ...reservation.reserved,
    status,
    twilio_message_sid: provider.sid || null,
    provider_status: provider.status || null,
    payload: { source: "answercrew_customer_sms", provider },
    updated_at: new Date().toISOString(),
  });
  if (provider.mode === "send_failed") throw httpError(502, "sms_send_failed", "Twilio rejected the SMS", { message, provider });
  return { ok: true, idempotent: false, conversation, message: message || reservation.reserved, provider };
}

async function ownerDemo(context, input = {}) {
  const ownerPhone = context.account.owner_notification_phone;
  if (!ownerPhone) throw httpError(409, "owner_notification_phone_not_configured", "The account owner notification phone is not configured");
  const destination = normalizePhone(input.destination || input.to, "destination");
  if (phoneKey(destination) !== phoneKey(ownerPhone)) {
    throw httpError(403, "owner_demo_destination_mismatch", "Demo destination must equal the structured owner notification phone");
  }
  requireTextConsent(input);
  const body = clean(input.body || input.message, 1600) || "AnswerCrew SMS demo";
  const dryRun = input.dry_run === undefined ? true : input.dry_run === true || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "testing";
  await assertSmsNotSuppressed(destination);
  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      destination,
      provider: await sendTwilioMessage({ to: destination, body, consentToText: true, dryRun: true }),
    };
  }

  const idempotencyKey = clean(input.idempotency_key || input.idempotencyKey, 160) || "owner-demo";
  const existing = (await queryRows(DEMO_TABLE, {
    account_id: `eq.${context.account.id}`,
    limit: "1",
  }))[0];
  if (existing) {
    if (existing.idempotency_key === idempotencyKey) return { ok: true, idempotent: true, demo: existing };
    throw httpError(409, "owner_demo_already_used", "The account owner demo send has already been used");
  }
  const reserved = await writeRow(DEMO_TABLE, {
    account_id: context.account.id,
    idempotency_key: idempotencyKey,
    destination,
    body,
    status: "pending",
    dry_run: false,
  });
  if (!reserved) throw httpError(503, "owner_demo_reservation_unavailable", "Owner demo send could not be safely reserved");
  const provider = await sendTwilioMessage({ to: destination, body, consentToText: true, dryRun: false });
  const status = provider.mode === "send_failed" ? "failed" : provider.mode === "message_sent" ? "sent" : "dry_run";
  const demo = await updateRow(DEMO_TABLE, { ...reserved, status, provider_status: provider.status || null, twilio_message_sid: provider.sid || null, updated_at: new Date().toISOString() });
  if (provider.mode === "send_failed") throw httpError(502, "sms_send_failed", "Twilio rejected the owner demo SMS", { demo, provider });
  return { ok: true, idempotent: false, demo: demo || reserved, provider };
}

async function resolveSmsNumberMapping(params = {}) {
  const serviceSid = clean(params.MessagingServiceSid || params.messaging_service_sid, 80);
  const to = clean(params.To, 80);
  let rows = [];
  if (serviceSid) {
    rows = await queryRows(MAPPINGS_TABLE, { messaging_service_sid: `eq.${serviceSid}`, active: "eq.true", limit: "1" });
  }
  if (!rows.length && to) {
    const phone = normalizePhone(to, "Twilio receiving phone");
    rows = await queryRows(MAPPINGS_TABLE, { twilio_phone_number: `eq.${phone}`, active: "eq.true", limit: "1" });
  }
  return rows[0] || null;
}

async function persistInboundSms(params = {}, mapping, verification, action) {
  if (!mapping?.account_id) return null;
  const sid = clean(params.MessageSid || params.SmsSid, 120) || null;
  if (sid) {
    const existing = (await queryRows(MESSAGES_TABLE, { account_id: `eq.${mapping.account_id}`, twilio_message_sid: `eq.${sid}`, limit: "1" }))[0];
    if (existing) return existing;
  }
  const from = normalizePhone(params.From, "Twilio sender");
  const to = params.To ? normalizePhone(params.To, "Twilio receiving phone") : null;
  const suppressed = (await queryRows("ghost_agency_suppressions", {
    suppression_key: `eq.${from}`,
    limit: "1",
  })).length > 0;
  const customerInitiated = action === "message" && verification?.verified === true && Boolean(sid) && !suppressed;
  const existing = (await queryRows(CONVERSATIONS_TABLE, { account_id: `eq.${mapping.account_id}`, customer_phone: `eq.${from}`, limit: "1" }))[0] || null;
  const now = new Date().toISOString();
  const conversationRow = {
    ...(existing || {}),
    account_id: mapping.account_id,
    customer_phone: from,
    consent_to_text: customerInitiated ? true : (action === "stop" || suppressed ? false : existing?.consent_to_text === true),
    consent_source: customerInitiated ? "customer_initiated_sms" : (action === "stop" ? "twilio_stop" : existing?.consent_source || "twilio_inbound"),
    consent_proof: customerInitiated ? sid : (action === "stop" ? null : existing?.consent_proof || null),
    consent_granted_at: customerInitiated ? now : existing?.consent_granted_at || null,
    updated_at: now,
  };
  const conversation = existing ? await updateRow(CONVERSATIONS_TABLE, conversationRow) : await writeRow(CONVERSATIONS_TABLE, conversationRow);
  return writeRow(MESSAGES_TABLE, {
    account_id: mapping.account_id,
    conversation_id: conversation?.id || null,
    direction: "inbound",
    from_phone: from,
    to_phone: to,
    body: clean(params.Body, 1600),
    status: "received",
    twilio_message_sid: sid,
    provider: "twilio",
    payload: { action, verified: Boolean(verification?.verified), customer_initiated_consent: customerInitiated, mapping_id: mapping.id || null },
  });
}

module.exports = {
  createConversation,
  listConversations,
  listMessages,
  normalizePhone,
  ownerDemo,
  persistInboundSms,
  resolveSmsNumberMapping,
  sendCustomerSms,
};
