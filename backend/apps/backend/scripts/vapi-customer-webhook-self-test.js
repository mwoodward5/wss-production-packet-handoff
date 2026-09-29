"use strict";

const assert = require("node:assert/strict");

process.env.VAPI_WEBHOOK_SECRET = "self-test-secret";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const customerModule = require("../lib/mission-control-customer");
const { durationSeconds } = customerModule;
const recordCustomerCallUsage = customerModule.recordCustomerCallUsage;
let capturedUsage = null;
customerModule.recordCustomerCallUsage = async (call, details) => {
  capturedUsage = { call, details };
  return recordCustomerCallUsage(call, details);
};
const handler = require("../api/webhooks/vapi-customer");
const { suppressContact } = require("../lib/contact-suppression");

function responseCapture() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = value || "";
    },
  };
}

async function invoke(headers) {
  const req = {
    method: "POST",
    headers,
    body: {
      message: {
        type: "end-of-call-report",
        durationSeconds: 87,
        durationMinutes: 1.45,
        startedAt: "2026-07-11T20:00:00.000Z",
        endedAt: "2026-07-11T20:01:27.000Z",
        endedReason: "voicemail",
        call: {
          id: "call_self_test",
          status: "queued",
          customer: { number: "+15555550100" },
          metadata: { prospect_id: "prospect_self_test", report_id: "report_self_test" },
        },
        artifact: {
          recording: "https://vapi.example.test/owner-practice.wav",
          transcript: [
            { role: "assistant", message: "Hello there" },
            { role: "user", message: "I need help" },
          ],
        },
        compliance: { recordingConsent: { granted: true, mode: "owner_test" } },
        analysis: { structuredData: { outcome: "opt_out", notes: "Remove me" } },
      },
    },
  };
  const res = responseCapture();
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

async function main() {
  assert.equal(durationSeconds({}, { durationSeconds: 87 }), 87);
  assert.equal(durationSeconds({}, { durationMinutes: 1.5 }), 90);
  assert.equal(durationSeconds({}, {
    startedAt: "2026-07-11T20:00:00.000Z",
    endedAt: "2026-07-11T20:01:05.000Z",
  }), 65);

  const smsOnly = await suppressContact({
    phone: "+15555550101",
    source: "self_test",
    reason: "sms_stop",
    channels: { text: true },
  });
  assert.equal(smsOnly.consent.rowPreview.consent_to_text, false);
  assert.equal("consent_to_call" in smsOnly.consent.rowPreview, false);
  assert.equal(smsOnly.hotLeads.patch.consent_to_text, false);
  assert.equal("consent_to_call" in smsOnly.hotLeads.patch, false);

  const unauthorized = await invoke({});
  assert.equal(unauthorized.status, 401);

  const authorized = await invoke({ "x-vapi-secret": "self-test-secret" });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.json.ok, true);
  assert.equal(authorized.json.optOut.suppression.mode, "dry_run");
  assert.equal(authorized.json.optOut.consent.mode, "dry_run");
  assert.equal(authorized.json.optOut.hotLeads.mode, "dry_run");
  assert.equal(authorized.json.usage.mode, "not_customer_call");
  assert.equal(capturedUsage.details.durationSeconds, 87);
  assert.equal(capturedUsage.details.durationMinutes, 1.45);
  assert.equal(capturedUsage.details.startedAt, "2026-07-11T20:00:00.000Z");
  assert.equal(capturedUsage.details.endedAt, "2026-07-11T20:01:27.000Z");
  assert.equal(capturedUsage.details.endedReason, "voicemail");
  assert.equal(capturedUsage.details.artifact.recording, "https://vapi.example.test/owner-practice.wav");
  assert.equal(capturedUsage.details.artifact.transcript.length, 2);
  assert.equal(capturedUsage.details.compliance.recordingConsent.granted, true);
  console.log("VAPI customer webhook self-test OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
