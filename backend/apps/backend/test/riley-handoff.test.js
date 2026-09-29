"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { draftReply, safeHandoff } = require("../lib/reply-agent");

test("Riley creates a pending human handoff without promising completion", async () => {
  const prior = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const result = await draftReply({
    prospect: { business_name: "Owner Test", preview_url: "https://example.test/preview" },
    inboundText: "This is broken. Have a human call me back.",
  });
  assert.equal(result.handoff.required, true);
  assert.equal(result.handoff.status, "pending_operator_approval");
  assert.equal(result.handoff.options.find((option) => option.type === "callback_request").requires_owner_approval, true);
  assert.match(result.draft.text, /won.t mark it complete until they confirm/i);
  assert.doesNotMatch(result.draft.text, /(?:booked|scheduled|completed|fixed) (?:your|the)/i);
  if (prior === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prior;
});

test("safe handoff exposes only supported paths", () => {
  const handoff = safeHandoff({ inboundText: "Please send a secure link" });
  assert.deepEqual(handoff.options.map((row) => row.type), ["support_ticket", "human_escalation", "callback_request", "secure_link"]);
  assert.equal(handoff.promise_policy.includes("provider or operator confirms"), true);
});
