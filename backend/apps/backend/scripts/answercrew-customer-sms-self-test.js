"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");

process.env.NODE_ENV = "test";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const users = {
  "customer-a": { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" },
  "customer-b": { id: "22222222-2222-4222-8222-222222222222", email: "b@example.com" },
};
const accounts = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner_user_id: users["customer-a"].id, name: "Account A", status: "active", owner_notification_phone: "+15550001111" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", owner_user_id: users["customer-b"].id, name: "Account B", status: "active", owner_notification_phone: "+15550002222" },
];
const db = {
  subscriptions: accounts.map((account) => ({ account_id: account.id, status: "active", plan: "solo", minutes_included: 125, minutes_used: 0 })),
  hotLeads: [
    { id: "lead-a", account_id: accounts[0].id, prospect_id: "prospect-a", business_name: "Account A Lead", phone: "+15550003333", email: "a-lead@example.com", status: "new", consent_to_call: true, consent_to_text: true, updated_at: "2026-07-12T00:00:00Z", payload: { private: true, city: "Irvine" } },
    { id: "lead-wait", account_id: accounts[0].id, prospect_id: "prospect-wait", business_name: "Waiting Lead", phone: "+15550003334", status: "hot_lead_consent_blocked", consent_to_call: false, updated_at: "2026-07-11T00:00:00Z" },
    { id: "lead-b", account_id: accounts[1].id, prospect_id: "prospect-b", business_name: "Account B Lead", phone: "+15550004444", email: "b-lead@example.com", status: "new", consent_to_text: true, updated_at: "2026-07-12T00:00:00Z", payload: { private: true } },
    { id: "lead-unassigned", account_id: null, prospect_id: "legacy", business_name: "Unassigned Ghost Lead", phone: "+15550009998", status: "new", updated_at: "2026-07-12T00:00:00Z" },
  ],
  conversations: [
    { id: "conv-a", account_id: accounts[0].id, customer_phone: "+15550003333", customer_name: "Customer A", consent_to_text: true, consent_source: "web_form", consent_proof: "checked box", updated_at: "2026-07-12T00:00:00Z" },
    { id: "conv-b", account_id: accounts[1].id, customer_phone: "+15550004444", customer_name: "Customer B", consent_to_text: true, consent_source: "web_form", consent_proof: "checked box", updated_at: "2026-07-12T00:00:00Z" },
  ],
  messages: [],
  mappings: [{ id: "mapping-a", account_id: accounts[0].id, twilio_phone_number: "+15550009999", messaging_service_sid: "MG_A", active: true }],
  suppressions: [],
  demos: [],
  events: [],
};
const requests = [];

function twilioSignature(params) {
  const serialized = Object.keys(params).sort().map((key) => `${key}${params[key]}`).join("");
  return createHmac("sha1", process.env.TWILIO_AUTH_TOKEN).update(`https://example.test/api/webhooks/twilio-inbound${serialized}`).digest("base64");
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function eqFilter(rows, key, value) {
  const match = String(value || "").match(/^eq\.(.*)$/);
  if (!match) return rows;
  return rows.filter((row) => String(row[key] ?? "") === match[1]);
}

function rowsFor(table) {
  return {
    answercrew_customer_accounts: accounts,
    answercrew_customer_subscriptions: db.subscriptions,
    answercrew_sms_conversations: db.conversations,
    answercrew_sms_messages: db.messages,
    answercrew_sms_number_mappings: db.mappings,
    answercrew_sms_demo_sends: db.demos,
    hot_leads: db.hotLeads,
    ghost_agency_suppressions: db.suppressions,
    consent_registrar: [],
    ghost_agency_events: db.events,
  }[table] || [];
}

function saveRow(table, body, conflict) {
  const rows = rowsFor(table);
  const keys = conflict ? conflict.split(",") : [];
  const existingIndex = keys.length ? rows.findIndex((row) => keys.every((key) => body[key] !== null && body[key] !== undefined && row[key] === body[key])) : -1;
  if (existingIndex >= 0) {
    rows[existingIndex] = { ...rows[existingIndex], ...body };
    return rows[existingIndex];
  }
  const row = { id: `${table}-${rows.length + 1}`, created_at: "2026-07-12T00:00:00Z", ...body };
  rows.push(row);
  return row;
}

global.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  const parsed = new URL(String(url));
  if (parsed.pathname === "/auth/v1/user") {
    const token = String(options.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return users[token] ? jsonResponse(200, users[token]) : jsonResponse(401, {});
  }
  if (!parsed.hostname.endsWith("supabase.co")) throw new Error(`Unexpected external request: ${url}`);
  const table = parsed.pathname.split("/").pop();
  const method = options.method || "GET";
  if (method === "GET") {
    let rows = rowsFor(table).map((row) => ({ ...row }));
    for (const [key, value] of parsed.searchParams.entries()) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      rows = eqFilter(rows, key, value);
    }
    const order = parsed.searchParams.get("order");
    if (order?.startsWith("updated_at.desc")) rows.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    if (order?.startsWith("created_at.asc")) rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const offset = Number(parsed.searchParams.get("offset") || 0);
    const limit = Number(parsed.searchParams.get("limit") || rows.length);
    return jsonResponse(200, rows.slice(offset, offset + limit));
  }
  const body = JSON.parse(options.body || "{}");
  const rows = rowsFor(table);
  if (method === "PATCH") {
    let selected = rows;
    for (const [key, value] of parsed.searchParams.entries()) {
      if (key === "select") continue;
      selected = eqFilter(selected, key, value);
    }
    selected.forEach((row) => Object.assign(row, body));
    return jsonResponse(200, selected.map((row) => ({ ...row })));
  }
  const conflict = parsed.searchParams.get("on_conflict") || "";
  const uniqueConflict = table === "answercrew_sms_messages"
    ? rows.find((row) => (body.idempotency_key && row.account_id === body.account_id && row.idempotency_key === body.idempotency_key) || (body.twilio_message_sid && row.twilio_message_sid === body.twilio_message_sid))
    : table === "answercrew_sms_demo_sends" ? rows.find((row) => row.account_id === body.account_id) : null;
  if (method === "POST" && uniqueConflict && !conflict) return jsonResponse(409, { message: "duplicate" });
  const saved = saveRow(table, body, conflict);
  return jsonResponse(200, [saved]);
};

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;
delete process.env.TWILIO_MESSAGING_SERVICE_SID;
delete process.env.GHOST_AGENCY_ADMIN_TOKEN;

function request(token, method, url, body = {}) {
  return { method, url, body, headers: { authorization: `Bearer ${token}`, origin: "https://missioncontrol.wss-ai.com" } };
}

function gatewayCall(customer, token, method, url, body = {}) {
  return customer.gateway(request(token, method, url, body), body);
}

function response() {
  return { statusCode: 200, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value = "") { this.body = value; } };
}

(async () => {
  const customer = require("../lib/mission-control-customer");
  const smsModule = require("../lib/customer-sms");
  assert.equal(smsModule.normalizePhone("(555) 000-1111"), "+15550001111");
  const sms = await customer.gateway(request("customer-a", "GET", "/?path=/api/sms/conversations"));
  assert.equal(sms.conversations.length, 1);
  assert.equal(sms.conversations[0].account_id, accounts[0].id);

  const leads = await customer.gateway(request("customer-a", "GET", "/?path=/api/leads"));
  assert.equal(leads.total, 2);
  assert.equal(leads.leads[0].business_name, "Account A Lead");
  assert.equal(leads.leads[0].consent, "granted");
  assert.equal(leads.leads[1].consent, "pending");
  assert.equal(leads.leads[0].account_id, undefined);
  assert.equal(leads.leads[0].payload, undefined);

  const filteredLeads = await customer.gateway(request(
    "customer-a",
    "GET",
    `/?path=${encodeURIComponent("/api/leads?status=new&search=Account A&limit=1")}`,
  ));
  assert.equal(filteredLeads.total, 1);
  assert.equal(filteredLeads.leads.length, 1);
  assert.equal(filteredLeads.leads[0].id, "lead-a");

  const resolvedLead = await customer.gateway(request("customer-a", "PUT", "/?path=/api/leads/lead-a", { status: "resolved" }), { status: "resolved" });
  assert.equal(resolvedLead.status, "resolved");
  await assert.rejects(
    () => customer.gateway(request("customer-a", "PUT", "/?path=/api/leads/lead-b", { status: "resolved" }), { status: "resolved" }),
    (error) => error.code === "lead_not_found",
  );

  await assert.rejects(
    () => customer.gateway(request("customer-a", "POST", "/?path=/api/sms/conversations", {
      phone: "5550000777",
      consent_to_text: true,
      consent_source: "web_form",
    })),
    (error) => error.code === "sms_consent_proof_required" || error.code === "invalid_phone",
  );

  await assert.rejects(
    () => customer.gateway(request("customer-a", "GET", "/?path=/api/sms/conversations/conv-b/messages")),
    (error) => error.code === "sms_conversation_not_found",
  );

  const sent = await gatewayCall(customer, "customer-a", "POST", "/?path=/api/sms/conversations/conv-a/messages", {
    body: "Hello from AnswerCrew",
    idempotency_key: "customer-a-1",
    sender: { messagingServiceSid: "MG_REQUEST_FORBIDDEN" },
  });
  assert.equal(sent.provider.mode, "dry_run");
  assert.equal(sent.provider.plannedMessage.sender.messagingServiceSid, "MG_A");
  assert.equal(sent.provider.plannedMessage.sender.fromNumber, "+15550009999");
  const replay = await gatewayCall(customer, "customer-a", "POST", "/?path=/api/sms/conversations/conv-a/messages", {
    body: "Different body must not resend",
    idempotency_key: "customer-a-1",
  });
  assert.equal(replay.idempotent, true);
  assert.equal(requests.some((entry) => entry.url.includes("api.twilio.com")), false);

  await assert.rejects(
    () => gatewayCall(customer, "customer-b", "POST", "/?path=/api/sms/conversations/conv-b/messages", {
      body: "Account B must wait for its own number",
      idempotency_key: "customer-b-1",
      sender: { messagingServiceSid: "MG_A" },
    }),
    (error) => error.code === "sms_number_assignment_pending",
  );

  db.suppressions.push({ suppression_key: "+15550005555", reason: "sms_stop" });
  db.conversations.push({ id: "conv-suppressed", account_id: accounts[0].id, customer_phone: "+15550005555", consent_to_text: true, consent_source: "web_form", consent_proof: "checked box" });
  await assert.rejects(
    () => gatewayCall(customer, "customer-a", "POST", "/?path=/api/sms/conversations/conv-suppressed/messages", { body: "blocked", idempotency_key: "blocked-1" }),
    (error) => error.code === "sms_suppressed",
  );

  const demo = await gatewayCall(customer, "customer-a", "POST", "/?path=/api/sms/demo", {
    destination: "+1 (555) 000-1111",
    body: "Owner demo",
    consent_to_text: true,
    consent_source: "owner_checkbox",
    consent_proof: "owner_checkbox_2026-07-12",
  });
  assert.equal(demo.dry_run, true);
  await assert.rejects(
    () => gatewayCall(customer, "customer-a", "POST", "/?path=/api/sms/demo", { destination: "+15550002222", consent_to_text: true, consent_source: "owner_checkbox" }),
    (error) => error.code === "owner_demo_destination_mismatch",
  );

  process.env.GHOST_AGENCY_ADMIN_TOKEN = "admin-test";
  const legacyHandler = require("../api/outreach/twilio-message");
  const legacyResponse = response();
  await legacyHandler({ method: "POST", headers: {}, body: {} }, legacyResponse);
  assert.equal(legacyResponse.statusCode, 401);

  delete process.env.TWILIO_AUTH_TOKEN;
  const inboundHandler = require("../api/outreach/twilio-inbound");
  const inboundResponse = response();
  await inboundHandler({
    method: "POST",
    url: "/api/webhooks/twilio-inbound",
    headers: { host: "example.test" },
    body: { From: "+15550006666", To: "+15550009999", MessagingServiceSid: "MG_A", Body: "Can you help?", MessageSid: "SM_A1" },
  }, inboundResponse);
  assert.equal(inboundResponse.statusCode, 401);
  assert.equal(db.messages.some((row) => row.twilio_message_sid === "SM_A1"), false);

  process.env.TWILIO_AUTH_TOKEN = "twilio-test";
  const invalidResponse = response();
  await inboundHandler({
    method: "POST",
    url: "/api/webhooks/twilio-inbound",
    headers: { host: "example.test" },
    body: { From: "+15550006666", To: "+15550009999", MessagingServiceSid: "MG_A", Body: "hello", MessageSid: "SM_A2" },
  }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 401);

  const validParams = { From: "+15550006666", To: "+15550009999", MessagingServiceSid: "MG_A", Body: "Can you help?", MessageSid: "SM_A_VALID" };
  const validResponse = response();
  await inboundHandler({
    method: "POST",
    url: "/api/webhooks/twilio-inbound",
    headers: { host: "example.test", "x-twilio-signature": twilioSignature(validParams) },
    body: validParams,
  }, validResponse);
  assert.equal(validResponse.statusCode, 200);
  const validConversation = db.conversations.find((row) => row.account_id === accounts[0].id && row.customer_phone === "+15550006666");
  assert.equal(validConversation.consent_to_text, true);
  assert.equal(validConversation.consent_source, "customer_initiated_sms");
  assert.equal(validConversation.consent_proof, "SM_A_VALID");

  const suppressedParams = { From: "+15550005555", To: "+15550009999", MessagingServiceSid: "MG_A", Body: "hello", MessageSid: "SM_A_SUPPRESSED" };
  const suppressedResponse = response();
  await inboundHandler({
    method: "POST",
    url: "/api/webhooks/twilio-inbound",
    headers: { host: "example.test", "x-twilio-signature": twilioSignature(suppressedParams) },
    body: suppressedParams,
  }, suppressedResponse);
  assert.equal(suppressedResponse.statusCode, 200);
  assert.equal(db.conversations.find((row) => row.id === "conv-suppressed").consent_to_text, false);

  const stopResponse = response();
  await inboundHandler({
    method: "POST",
    url: "/api/webhooks/twilio-inbound",
    headers: { host: "example.test" },
    body: { From: "+15550007777", To: "+15550009999", MessagingServiceSid: "MG_A", Body: "STOP", MessageSid: "SM_A3" },
  }, stopResponse);
  assert.equal(stopResponse.statusCode, 200);
  assert.equal(db.suppressions.some((row) => row.suppression_key === "+15550007777"), true);
  assert.equal(db.messages.some((row) => row.twilio_message_sid === "SM_A3" && row.account_id === accounts[0].id), true);

  console.log("AnswerCrew customer SMS isolation/security self-test OK");
})().finally(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});
