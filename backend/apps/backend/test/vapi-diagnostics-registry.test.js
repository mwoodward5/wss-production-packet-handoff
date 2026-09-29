"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { callDiagnostic } = require("../api/admin/vapi-calls");
const { assistantRegistry, assertSafeMutation } = require("../api/admin/vapi-assistants");

test("VAPI diagnostics classify exact provider evidence", () => {
  assert.deepEqual(callDiagnostic({ endedReason: "twilio-failed-to-connect-call" }), {
    category: "carrier", stage: "dial_or_connect", providerCode: "twilio-failed-to-connect-call",
    evidence: ["twilio-failed-to-connect-call"], attributableToCaller: false, diagnosed: true,
  });
  assert.equal(callDiagnostic({ endedReason: "tool-calls-timeout" }).category, "tool_timeout");
  assert.equal(callDiagnostic({ endedReason: "server-url-not-found" }).category, "webhook");
  assert.equal(callDiagnostic({ endedReason: "recording-consent-failed" }).category, "consent");
  assert.equal(callDiagnostic({ endedReason: "customer-ended-call" }).attributableToCaller, true);
  assert.equal(callDiagnostic({ endedReason: "mystery-code" }).category, "unknown");
});

test("registry identifies production and duplicate assistants without approving deletion", () => {
  const registry = assistantRegistry([
    { id: "prod", name: "Riley", model: { model: "gpt" }, voice: { voiceId: "v1" } },
    { id: "dup", name: "Riley" },
    { id: "old", name: "REO legacy" },
    { id: "blank", name: "" },
  ], [{ id: "phone", number: "+15555550100", assistantId: "prod" }], {
    VAPI_LOCAL_GROWTH_ASSISTANT_ID: "prod",
    VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID: "phone",
  });
  assert.equal(registry.assistants.find((row) => row.id === "prod").routable, true);
  assert.equal(registry.assistants.find((row) => row.id === "old").state, "legacy");
  assert.equal(registry.assistants.every((row) => row.safeToDelete === false), true);
  assert.equal(registry.duplicateGroups[0].ids.length, 2);
});

test("mutations require the canonical assistant and explicit live identity", () => {
  const old = process.env.VAPI_LOCAL_GROWTH_ASSISTANT_ID;
  process.env.VAPI_LOCAL_GROWTH_ASSISTANT_ID = "prod";
  assert.equal(assertSafeMutation({ actorRole: "admin", explicitConfirmation: "CHANGE LIVE prod" }, { id: "prod", name: "Riley" }), null);
  assert.equal(assertSafeMutation({}, { id: "prod", name: "Riley" }).code, "vapi_admin_role_required");
  assert.equal(assertSafeMutation({ actorRole: "admin" }, { id: "prod", name: "Riley" }).code, "vapi_live_confirmation_required");
  assert.equal(assertSafeMutation({ actorRole: "admin", explicitConfirmation: "CHANGE LIVE old" }, { id: "old", name: "REO legacy" }).code, "vapi_assistant_not_canonical");
  if (old === undefined) delete process.env.VAPI_LOCAL_GROWTH_ASSISTANT_ID;
  else process.env.VAPI_LOCAL_GROWTH_ASSISTANT_ID = old;
});
