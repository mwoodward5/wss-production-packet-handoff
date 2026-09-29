"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const { buildAnswerCrewAssistantConfig } = require("../lib/answercrew-agent-core");

function jsonResponse(status, body, headers = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) || null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("AnswerCrew Vapi reliability contract", async (t) => {
  process.env.VAPI_API_KEY = "test-key";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const customer = require("../lib/mission-control-customer");

  await t.test("uses the current Vapi voicemail detection schema", () => {
    const { config } = buildAnswerCrewAssistantConfig({
      business_name: "AnswerCrew QA",
      city: "Mission Viejo, CA",
      trade: "software",
      service_area: "Owner-only testing",
      hours: "Monday-Friday, 9:00 AM - 5:00 PM Pacific Time",
      booking_method: "Take a message for the owner",
      owner_name: "Owner",
      services: ["Owner-only testing"],
    });
    assert.deepEqual(config.voicemailDetection, { provider: "vapi" });
    assert.equal(Object.hasOwn(config.voicemailDetection, "voicemailDetectionTypes"), false);
  });

  await t.test("passes idempotency and returns a successful response", async () => {
    customer.resetVapiRuntimeStateForTests();
    let received;
    global.fetch = async (_url, options) => {
      received = options;
      return jsonResponse(201, { id: "assistant-ok" }, { "x-request-id": "vapi-req-1" });
    };
    const result = await customer.vapiRequest("/assistant", {
      method: "POST",
      body: { name: "Test agent" },
      idempotencyKey: "answercrew-test-idempotency",
      retryBaseMs: 0,
    });
    assert.equal(result.id, "assistant-ok");
    assert.equal(received.headers["Idempotency-Key"], "answercrew-test-idempotency");
    assert.ok(received.headers["X-Correlation-Id"]);
  });

  await t.test("retries transient 5xx responses with exponential backoff", async () => {
    customer.resetVapiRuntimeStateForTests();
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse(503, { message: "temporary upstream outage" })
        : jsonResponse(200, { id: "recovered" });
    };
    const result = await customer.vapiRequest("/assistant", { retryBaseMs: 0 });
    assert.equal(result.id, "recovered");
    assert.equal(calls, 3);
  });

  await t.test("retries 429 and succeeds without duplicate work", async () => {
    customer.resetVapiRuntimeStateForTests();
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(429, { message: "rate limit" }, { "retry-after": "0" })
        : jsonResponse(200, { id: "after-rate-limit" });
    };
    const result = await customer.vapiRequest("/assistant", {
      idempotencyKey: "same-operation",
      retryBaseMs: 0,
    });
    assert.equal(result.id, "after-rate-limit");
    assert.equal(calls, 2);
  });

  await t.test("maps provider timeouts without marking activation successful", async () => {
    customer.resetVapiRuntimeStateForTests();
    const timeout = new Error("request timed out");
    timeout.name = "TimeoutError";
    global.fetch = async () => { throw timeout; };
    await assert.rejects(
      () => customer.vapiRequest("/assistant", { maxAttempts: 1, retryBaseMs: 0, timeoutMs: 1000 }),
      (error) => error.code === "vapi_timeout"
        && error.statusCode === 503
        && error.detail.cause === "provider_timeout",
    );
  });

  await t.test("maps authentication failures to an actionable safe error", async () => {
    customer.resetVapiRuntimeStateForTests();
    global.fetch = async () => jsonResponse(401, { message: "invalid api key" }, { "x-request-id": "vapi-auth-1" });
    await assert.rejects(
      () => customer.vapiRequest("/assistant", { maxAttempts: 1, retryBaseMs: 0 }),
      (error) => error.code === "vapi_auth_failed"
        && error.statusCode === 503
        && error.detail.upstream_request_id === "vapi-auth-1"
        && Boolean(error.detail.correlation_id),
    );
  });

  await t.test("does not hide repeated credential failures behind the outage circuit", async () => {
    customer.resetVapiRuntimeStateForTests();
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return jsonResponse(401, { message: "invalid api key" });
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(
        () => customer.vapiRequest("/assistant", { maxAttempts: 1, retryBaseMs: 0 }),
        (error) => error.code === "vapi_auth_failed",
      );
    }
    assert.equal(calls, 4);
  });

  await t.test("distinguishes a missing assistant", async () => {
    customer.resetVapiRuntimeStateForTests();
    global.fetch = async () => jsonResponse(404, { message: "assistant not found" });
    await assert.rejects(
      () => customer.vapiRequest("/assistant/missing", { maxAttempts: 1, retryBaseMs: 0 }),
      (error) => error.code === "vapi_assistant_missing" && error.statusCode === 409,
    );
  });

  await t.test("does not expose upstream response bodies to clients", async () => {
    customer.resetVapiRuntimeStateForTests();
    global.fetch = async () => jsonResponse(400, {
      message: "private provider diagnostic",
      customer: { number: "+15555550100" },
    });
    await assert.rejects(
      () => customer.vapiRequest("/call", { method: "POST", maxAttempts: 1, retryBaseMs: 0 }),
      (error) => error.code === "vapi_request_failed"
        && !Object.hasOwn(error.detail, "provider_error")
        && !JSON.stringify(error.detail).includes("private provider diagnostic"),
    );
  });

  await t.test("blocks activation until a phone provisioning path exists", () => {
    const previous = process.env.ANSWERCREW_AUTO_PROVISION_VAPI_NUMBER;
    delete process.env.ANSWERCREW_AUTO_PROVISION_VAPI_NUMBER;
    assert.throws(
      () => customer.requireActivationPhonePath({ phone_number_id: null }),
      (error) => error.code === "vapi_phone_number_required" && error.statusCode === 409,
    );
    if (previous === undefined) delete process.env.ANSWERCREW_AUTO_PROVISION_VAPI_NUMBER;
    else process.env.ANSWERCREW_AUTO_PROVISION_VAPI_NUMBER = previous;
  });

  await t.test("resumes an existing binding without rewriting the assistant", async () => {
    customer.resetVapiRuntimeStateForTests();
    process.env.SUPABASE_URL = "https://answercrew-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    const calls = [];
    const row = {
      id: "agent-riley",
      account_id: "account-owner",
      status: "paused",
      vapi_assistant_id: "assistant-riley",
      phone_number_id: "phone-riley",
    };
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      if (href.includes("/rest/v1/mission_control_agents")) {
        const nextStatus = new URL(href).searchParams.get("status") === "eq.paused" ? "provisioning" : "active";
        return jsonResponse(200, [{ ...row, status: nextStatus }]);
      }
      return jsonResponse(200, { id: "phone-riley", assistantId: "assistant-riley" });
    };

    const result = await customer.resumeAgent(row, { correlationId: "resume-proof" });
    const providerCalls = calls.filter((call) => call.href.includes("api.vapi.ai"));
    assert.equal(result.status, "active");
    assert.equal(providerCalls.length, 1);
    assert.match(providerCalls[0].href, /\/phone-number\/phone-riley$/);
    assert.deepEqual(providerCalls[0].body, { assistantId: "assistant-riley" });
    assert.equal(calls.some((call) => /\/assistant\//.test(call.href)), false);

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  await t.test("distinguishes regional number availability failures", async () => {
    customer.resetVapiRuntimeStateForTests();
    global.fetch = async () => jsonResponse(400, { message: "No phone numbers available in this region" });
    await assert.rejects(
      () => customer.vapiRequest("/phone-number", { method: "POST", maxAttempts: 1, retryBaseMs: 0 }),
      (error) => error.code === "vapi_number_unavailable" && error.statusCode === 409,
    );
  });

  await t.test("opens the circuit after repeated provider failures", async () => {
    customer.resetVapiRuntimeStateForTests();
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return jsonResponse(503, { message: "provider down" });
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(
        () => customer.vapiRequest("/assistant", { maxAttempts: 1, retryBaseMs: 0 }),
        (error) => error.code === "vapi_unavailable",
      );
    }
    await assert.rejects(
      () => customer.vapiRequest("/assistant", { maxAttempts: 1, retryBaseMs: 0 }),
      (error) => error.code === "vapi_circuit_open",
    );
    assert.equal(calls, 3);
  });

  await t.test("does not open the circuit for ordinary client errors", async () => {
    customer.resetVapiRuntimeStateForTests();
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return jsonResponse(400, { message: "invalid request" });
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(
        () => customer.vapiRequest("/assistant", { maxAttempts: 1, retryBaseMs: 0 }),
        (error) => error.code === "vapi_request_failed",
      );
    }
    assert.equal(calls, 4);
  });
});

test.after(() => {
  global.fetch = originalFetch;
  process.env = originalEnv;
});
