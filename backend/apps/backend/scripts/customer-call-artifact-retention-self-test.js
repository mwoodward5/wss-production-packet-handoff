"use strict";

const assert = require("node:assert/strict");

process.env.CRON_SECRET = "cron-test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";

const expired = {
  id: "call-expired",
  account_id: "account-a",
  agent_id: "agent-a",
  vapi_call_id: "vapi-expired",
  status: "completed",
  duration_seconds: 42,
  recording_url: "https://vapi.example/expired.wav",
  transcript: "assistant: hello",
  summary: "Old summary",
  recording_consent_enabled: true,
  recording_consent_mode: "authenticated_owner_test_call",
  artifact_retention_expires_at: "2020-01-01T00:00:00.000Z",
  payload: {
    analysis: { structuredData: { action_items: ["call back"] } },
    artifact: { recording: "real" },
    non_artifact_metadata: { source: "vapi" },
  },
};
const fresh = {
  id: "call-fresh",
  account_id: "account-a",
  agent_id: "agent-a",
  vapi_call_id: "vapi-fresh",
  status: "completed",
  duration_seconds: 8,
  recording_url: "https://vapi.example/fresh.wav",
  transcript: "assistant: hello",
  summary: "Fresh summary",
  recording_consent_enabled: true,
  recording_consent_mode: "vapi_compliance",
  artifact_retention_expires_at: "2099-01-01T00:00:00.000Z",
  payload: { analysis: { structuredData: { action_items: ["keep"] } } },
};
const rows = [expired, fresh];
const writes = [];

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, headers: { get() { return null; } }, json: async () => payload };
}

global.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  if (parsed.hostname !== "example.supabase.co") throw new Error(`Unexpected request: ${url}`);
  const method = options.method || "GET";
  if (method === "GET") return jsonResponse(200, rows.filter((row) => row.artifact_retention_expires_at < "2026-07-13T00:00:00.000Z"));
  if (method !== "PATCH") throw new Error(`Unexpected method: ${method}`);

  const idFilter = String(parsed.searchParams.get("id") || "").replace(/^eq\./, "");
  const expiryFilter = String(parsed.searchParams.get("artifact_retention_expires_at") || "").replace(/^eq\./, "");
  const row = rows.find((item) => item.id === idFilter);
  if (!row || row.artifact_retention_expires_at !== expiryFilter) return jsonResponse(200, []);
  const patch = JSON.parse(options.body || "{}");
  Object.assign(row, patch);
  writes.push(patch);
  return jsonResponse(200, [row]);
};

function response() {
  return { statusCode: 200, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value = "") { this.body = value; } };
}

(async () => {
  const handler = require("../api/cron/customer-call-artifact-retention");
  const unauthorized = response();
  await handler({ method: "GET", url: "/api/cron/customer-call-artifact-retention", headers: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const dry = response();
  await handler({ method: "GET", url: "/api/cron/customer-call-artifact-retention?dry_run=true", headers: { authorization: "Bearer cron-test" } }, dry);
  const dryJson = JSON.parse(dry.body);
  assert.equal(dryJson.mode, "dry_run");
  assert.equal(dryJson.purged, 0);
  assert.equal(writes.length, 0);

  const purge = response();
  await handler({ method: "POST", url: "/api/cron/customer-call-artifact-retention", headers: { authorization: "Bearer cron-test" } }, purge);
  const purgeJson = JSON.parse(purge.body);
  assert.equal(purgeJson.ok, true);
  assert.equal(purgeJson.purged, 1);
  assert.equal(writes.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(writes[0], "account_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(writes[0], "agent_id"), false);
  assert.equal(expired.recording_url, null);
  assert.equal(expired.transcript, null);
  assert.equal(expired.summary, null);
  assert.equal(expired.status, "completed");
  assert.equal(expired.duration_seconds, 42);
  assert.equal(expired.recording_consent_mode, "authenticated_owner_test_call");
  assert.equal(expired.payload.analysis, undefined);
  assert.equal(expired.payload.artifact, undefined);
  assert.deepEqual(expired.payload.non_artifact_metadata, { source: "vapi" });
  assert.equal(expired.payload.retention_policy, "fixed_14_day_vapi_build_retention");
  assert.equal(fresh.recording_url, "https://vapi.example/fresh.wav");

  const noop = response();
  await handler({ method: "GET", url: "/api/cron/customer-call-artifact-retention", headers: { authorization: "Bearer cron-test" } }, noop);
  assert.equal(JSON.parse(noop.body).mode, "no_op");
  console.log("Customer call artifact retention self-test OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
