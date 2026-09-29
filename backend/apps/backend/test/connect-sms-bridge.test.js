"use strict";
// The customer texts the business's number, it lands in their app, they reply
// from the app, it goes back out as a text. The owner described it as "we
// don't need any texting, and we could get around all of it" — and he is right,
// but only because of WHY it is legal: every outbound message here is a REPLY
// to a customer-initiated conversation. Cited research (docs/, 2026-08-11):
// TCPA has no B2B exemption, cold SMS risks $1,500/text, and carriers approve
// inbound-triggered conversational campaigns while flagging cold outbound.
//
// So these tests exist to make cold SMS impossible by construction, not by
// policy. Each one is a door that has to stay shut.
const test = require("node:test");
const assert = require("node:assert");
const { connectThreadSeed, smsReplyAuthorized, deliverSmsReply } = require("../lib/connect-sms-bridge");

const MAPPING = { account_id: "acct_1", site_slug: "wss-test-airco", twilio_phone_number: "+15125550100" };
const INBOUND = { From: "+18325557788", To: "+15125550100", Body: "do you service Prairieville?", MessageSid: "SM123" };

function thread(over = {}) {
  return {
    id: 7, channel: "sms",
    meta: { source: "sms_inbound", customer_phone: "+18325557788", business_number: "+15125550100", account_id: "acct_1" },
    ...over,
  };
}
const CONSENTED = { consent_to_text: true, consent_source: "customer_initiated_sms" };
const INBOUND_MSGS = [{ id: 1, direction: "inbound" }];

test("a customer text becomes a thread seed for that tenant, with the number masked", () => {
  const seed = connectThreadSeed(MAPPING, INBOUND, "message");
  assert.equal(seed.siteSlug, "wss-test-airco");
  assert.equal(seed.channel, "sms");
  assert.equal(seed.threadKey, "wss-test-airco:sms:18325557788");
  assert.equal(seed.contactLabel, "***7788", "the inbox shows last four, not the full number");
  assert.equal(seed.meta.customer_phone, "+18325557788", "the reply path needs the real number in meta");
  assert.equal(seed.meta.inbound_sid, "SM123", "the consent proof travels with the thread");
});

test("STOP, HELP and START never reach the client's inbox", () => {
  for (const action of ["stop", "help", "start"]) {
    assert.equal(connectThreadSeed(MAPPING, { ...INBOUND, Body: action }, action), null,
      `${action} is compliance traffic, not a lead`);
  }
});

test("a number with no WSS site does not open a Connect thread", () => {
  assert.equal(connectThreadSeed({ account_id: "acct_1" }, INBOUND, "message"), null);
});

test("a reply is authorized only when the customer texted first", () => {
  assert.equal(smsReplyAuthorized({ thread: thread(), messages: INBOUND_MSGS, conversation: CONSENTED }).ok, true);

  // the thread exists but every message on it is ours — that is cold outbound
  // wearing a reply's clothes
  assert.equal(
    smsReplyAuthorized({ thread: thread(), messages: [{ direction: "outbound" }], conversation: CONSENTED }).reason,
    "no_inbound_message_on_thread",
  );
});

test("no consent row, no send — even with an inbound message present", () => {
  assert.equal(
    smsReplyAuthorized({ thread: thread(), messages: INBOUND_MSGS, conversation: null }).reason,
    "no_recorded_consent",
  );
  assert.equal(
    smsReplyAuthorized({ thread: thread(), messages: INBOUND_MSGS, conversation: { consent_to_text: false } }).reason,
    "no_recorded_consent",
  );
});

test("a suppressed contact is refused even with consent on file", () => {
  const v = smsReplyAuthorized({ thread: thread(), messages: INBOUND_MSGS, conversation: CONSENTED, suppressed: true });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "contact_suppressed", "STOP outranks a stored consent");
});

test("a thread carrying no customer phone cannot be replied to", () => {
  const t = thread({ meta: { source: "sms_inbound" } });
  assert.equal(smsReplyAuthorized({ thread: t, messages: INBOUND_MSGS, conversation: CONSENTED }).reason,
    "no_customer_phone_on_thread");
});

test("deliverSmsReply sends to the thread's own number and nowhere else", async () => {
  const sent = [];
  const out = await deliverSmsReply({
    sendTwilioMessage: async (p) => { sent.push(p); return { sid: "SM999" }; },
    readConversation: async () => CONSENTED,
    isSuppressed: async () => false,
  }, { thread: thread(), messages: INBOUND_MSGS, body: "Yes — we cover Prairieville." });

  assert.equal(out.delivered, true);
  assert.equal(out.sid, "SM999");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "+18325557788", "the destination comes from the thread, never from the caller");
  assert.equal(sent[0].body, "Yes — we cover Prairieville.");
});

test("a refused reply never touches Twilio", async () => {
  let called = 0;
  const out = await deliverSmsReply({
    sendTwilioMessage: async () => { called += 1; return { sid: "nope" }; },
    readConversation: async () => null,          // no consent
    isSuppressed: async () => false,
  }, { thread: thread(), messages: INBOUND_MSGS, body: "hello" });

  assert.equal(called, 0, "the gate must run before the provider, not after");
  assert.equal(out.delivered, false);
  assert.equal(out.reason, "no_recorded_consent");
});

test("the module exposes no way to text an arbitrary number", () => {
  const api = require("../lib/connect-sms-bridge");
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn !== "function") continue;
    const src = fn.toString();
    assert.ok(!/\bto:\s*(String\()?\s*(params|input|options|opts)\.(to|phone|number)/i.test(src),
      `${name} appears to accept a caller-supplied destination`);
  }
});
