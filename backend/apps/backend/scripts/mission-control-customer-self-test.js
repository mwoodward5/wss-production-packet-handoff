"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

const originalFetch = global.fetch;
const originalLoad = Module._load;
const env = { ...process.env };

const user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com" };
const account = {
  id: "22222222-2222-4222-8222-222222222222",
  owner_user_id: user.id,
  name: "Owner Test",
  type: "business",
  status: "active",
  owner_notification_phone: "+15555550123",
};
let subscription = null;
let agent = null;
let customerCalls = [];
let vapiFailureMode = null;
const requests = [];

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

global.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  const parsed = new URL(String(url));
  if (parsed.pathname === "/auth/v1/user") return jsonResponse(200, user);
  if (parsed.hostname.endsWith("supabase.co")) {
    const table = parsed.pathname.split("/").pop();
    const method = options.method || "GET";
    if (table === "answercrew_customer_accounts") {
      if (method === "GET") return jsonResponse(200, [account]);
      return jsonResponse(200, [account]);
    }
    if (table === "answercrew_customer_subscriptions") {
      if (method === "POST") {
        subscription = { ...subscription, ...JSON.parse(options.body || "{}") };
        return jsonResponse(200, [subscription]);
      }
      if (method === "PATCH") {
        subscription = { ...subscription, ...JSON.parse(options.body || "{}") };
        return jsonResponse(200, [subscription]);
      }
      return jsonResponse(200, subscription ? [subscription] : []);
    }
    if (table === "mission_control_agents") {
      if (method === "GET") {
        if (parsed.searchParams.get("phone_number_id") === "not.is.null") {
          return jsonResponse(200, agent?.phone_number_id ? [agent] : []);
        }
        if (parsed.searchParams.has("id") || parsed.searchParams.has("slot_key")) return jsonResponse(200, agent ? [agent] : []);
        return jsonResponse(200, agent ? [agent] : []);
      }
      const body = JSON.parse(options.body || "{}");
      agent = {
        id: agent?.id || "33333333-3333-4333-8333-333333333333",
        account_id: account.id,
        owner_user_id: user.id,
        status: "draft",
        ...agent,
        ...body,
      };
      return jsonResponse(200, [agent]);
    }
    if (table === "ghost_agency_suppressions" || table === "consent_registrar") return jsonResponse(200, []);
    if (table === "mission_control_customer_calls") {
      if (method === "POST") {
        const body = JSON.parse(options.body || "{}");
        const index = customerCalls.findIndex((row) => row.account_id === body.account_id && row.vapi_call_id === body.vapi_call_id);
        if (index >= 0) customerCalls[index] = { ...customerCalls[index], ...body };
        else customerCalls.push(body);
        return jsonResponse(200, [body]);
      }
      const start = String(parsed.searchParams.get("started_at") || "").replace(/^gte\./, "");
      const filtered = start ? customerCalls.filter((row) => String(row.started_at || "") >= start) : customerCalls;
      const offset = Number(parsed.searchParams.get("offset") || 0);
      const limit = Number(parsed.searchParams.get("limit") || filtered.length);
      return jsonResponse(200, filtered.slice(offset, offset + limit));
    }
    if (table === "hot_leads") return jsonResponse(200, []);
  }
  if (parsed.hostname === "api.stripe.com") {
    if (parsed.pathname === "/v1/customers") {
      return jsonResponse(200, { id: "cus_owner", email: user.email });
    }
    if (parsed.pathname === "/v1/billing_portal/sessions") {
      return jsonResponse(200, { id: "bps_owner", url: "https://billing.stripe.com/test" });
    }
    if (parsed.pathname === "/v1/checkout/sessions") {
      return jsonResponse(200, { id: "cs_test_owner", url: "https://checkout.stripe.com/test" });
    }
    if (parsed.pathname === "/v1/checkout/sessions/cs_test_owner") {
      return jsonResponse(200, {
        id: "cs_test_owner",
        status: "complete",
        customer: "cus_owner",
        metadata: {
          product: "mission-control",
          account_id: account.id,
          owner_user_id: user.id,
          plan: "starter",
          agent_draft_id: agent?.id,
        },
        subscription: {
          id: "sub_owner",
          customer: "cus_owner",
          status: "active",
          metadata: { plan: "starter", agent_draft_id: agent?.id },
          current_period_end: 1893456000,
        },
      });
    }
  }
  if (parsed.hostname === "api.vapi.ai") {
    if (parsed.pathname === "/assistant") return jsonResponse(201, { id: "vapi_customer_agent" });
    if (parsed.pathname === "/assistant/vapi_customer_agent") {
      if (vapiFailureMode === "assistant_update_503") return jsonResponse(503, { message: "temporary provider outage" });
      return jsonResponse(200, { id: "vapi_customer_agent" });
    }
    if (parsed.pathname === "/phone-number") {
      return jsonResponse(201, { id: "phone_customer_agent", number: "+15555550999", assistantId: "vapi_customer_agent" });
    }
    if (parsed.pathname === "/phone-number/phone_customer_agent") {
      if (vapiFailureMode === "phone_update_503" && JSON.parse(options.body || "{}").assistantId) {
        return jsonResponse(503, { message: "temporary provider outage" });
      }
      return jsonResponse(200, { id: "phone_customer_agent", number: "+15555550999" });
    }
    if (parsed.pathname === "/call/call_owner_practice" && (options.method || "GET") === "GET") {
      return jsonResponse(200, { id: "call_owner_practice", artifact: { recording: "https://vapi.example.test/current-owner-practice.wav" } });
    }
    if (parsed.pathname === "/call") return jsonResponse(201, {
      id: "call_owner_practice",
      status: "queued",
      artifact: { recording: "https://vapi.example.test/initial-owner-practice.wav" },
    });
  }
  throw new Error(`Unexpected request: ${url}`);
};

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
process.env.STRIPE_PRICE_STARTER = "price_starter";
process.env.VAPI_API_KEY = "vapi-test";
process.env.VAPI_WEBHOOK_SECRET = "webhook-test";
process.env.ANSWERCREW_AUTO_PROVISION_VAPI_NUMBER = "true";

function request(method, body, url = "/") {
  return {
    method,
    url,
    body,
    headers: { authorization: "Bearer customer-token", origin: "https://missioncontrol.wss-ai.com" },
  };
}

(async () => {
  const customer = require("../lib/mission-control-customer");
  const { transcriptText } = require("../lib/answercrew-call-artifacts");
  assert.equal(transcriptText("Hello there"), "Hello there");
  assert.equal(transcriptText([
    { role: "assistant", message: "Hello there" },
    { role: "user", message: "I need help" },
  ]), "assistant: Hello there\nuser: I need help");
  const { BILLING_USAGE_POLICY, PLANS } = require("../lib/mission-control-commerce");
  assert.equal(BILLING_USAGE_POLICY.overagePolicy, "hard_cap");
  assert.equal(BILLING_USAGE_POLICY.automaticOverageBilling, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(PLANS).map(([name, plan]) => [name, plan.minutesIncluded])),
    { solo: 125, crew: 325, front_office: 775, agency: 1850 },
  );
  assert.equal(customer.minuteQuotaState({ plan: "solo", minutes_included: 500 }).minutes_included, 125);
  const ownerAccess = customer.minuteQuotaState({
    plan: "agency",
    minutes_included: 1850,
    minutes_used: 42.5,
    internal_access_role: "owner",
    internal_unlimited_minutes: true,
  });
  assert.equal(ownerAccess.internal_access_role, "owner");
  assert.equal(ownerAccess.unlimited_minutes, true);
  assert.equal(ownerAccess.voice_experience, "signature");
  assert.equal(ownerAccess.minutes_included, null);
  assert.equal(ownerAccess.minutes_remaining, null);
  assert.equal(ownerAccess.quota_reached, false);
  const signatureConfig = require("../lib/answercrew-agent-core").buildAnswerCrewAssistantConfig({
    agent_name: "Riley",
    business_name: "Owner Test",
    city: "Mission Viejo",
    trade: "Software",
    services: ["Support"],
    service_area: "Nationwide",
    hours: "Monday through Friday",
    booking_method: "Owner confirms",
  }, { accountId: account.id, experienceTier: "signature" }).config;
  assert.equal(signatureConfig.model.model, "gpt-4.1");
  assert.equal(signatureConfig.voice.model, "eleven_turbo_v2_5");
  assert.equal(signatureConfig.transcriber.language, "multi");
  assert.match(signatureConfig.model.messages[0].content, /Detect the caller's language/);
  assert.ok(signatureConfig.analysisPlan.structuredDataPlan.schema.properties.caller_language);
  assert.ok(signatureConfig.analysisPlan.structuredDataPlan.schema.properties.sentiment);
  assert.equal(signatureConfig.metadata.voice_experience, "signature");

  const previewOrigin = "https://answercrew-cockpit-preview123-wss-labs.vercel.app";
  const previewReq = request("GET", {});
  previewReq.headers.origin = previewOrigin;
  const previewRes = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end() {},
  };
  assert.equal(customer.methodGuard(previewReq, previewRes, ["GET"]), true);
  assert.equal(previewRes.headers["Access-Control-Allow-Origin"], previewOrigin);

  const unrelatedReq = request("GET", {});
  unrelatedReq.headers.origin = "https://unrelated-preview.vercel.app";
  const unrelatedRes = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end() {},
  };
  assert.equal(customer.methodGuard(unrelatedReq, unrelatedRes, ["GET"]), true);
  assert.equal(unrelatedRes.headers["Access-Control-Allow-Origin"], "https://missioncontrol.wss-ai.com");

  const saved = await customer.saveAgent(request("POST", {}), "agent-1", {
    display_name: "Alex",
    role_template: "scheduler",
    business_name: "Owner Test",
    city: "Fresno",
    trade: "plumbing",
    services: ["leak repair", "drain clearing"],
    service_area: "Fresno and Clovis",
    hours: "Monday through Friday, eight to five",
    pricing_notes: "The owner confirms diagnostic pricing",
    booking_method: "capture the requested time for owner confirmation",
    emergency_keywords: ["burst pipe", "active flooding"],
    owner_name: "Jordan",
    owner_notification_phone: "+17146096275",
    voice_id: "21m00Tcm4TlvDq8ikWAM",
  }, { requireActive: false, provision: false });
  assert.equal(saved.row.status, "draft");
  assert.equal(saved.agent.role_template, "scheduler");
  assert.match(saved.row.prompt, /best employee they ever had/);
  assert.match(saved.row.prompt, /NEVER invent prices/);
  assert.match(saved.row.prompt, /Never take payment card details by voice/);

  const inactiveBalance = await customer.gateway(request("GET", {}, "/?path=/api/billing/balance"));
  assert.deepEqual(inactiveBalance, {
    status: "inactive",
    subscription_status: null,
    active_subscription: false,
    balance: null,
    currency: "minutes",
    calls_remaining_estimate: null,
    minutes_used: null,
    minutes_included: null,
    minutes_remaining: null,
    overage_policy: "hard_cap",
    automatic_overage_billing: false,
  });
  const inactiveSummary = await customer.billingSummary(request("GET", {}));
  assert.equal(inactiveSummary.status, "inactive");
  assert.equal(inactiveSummary.active_subscription, false);
  assert.equal(inactiveSummary.minutes_used, null);
  assert.equal(inactiveSummary.minutes_included, null);
  assert.equal(inactiveSummary.automatic_overage_billing, false);
  assert.deepEqual(await customer.gateway(request("GET", {}, "/?path=/api/calls/live")), []);
  await assert.rejects(
    () => customer.testAgent(request("POST", {}), "agent-1", {
      phone_number: "+15555550123",
      test_call_consent: true,
    }),
    (error) => error.code === "subscription_required",
  );

  const checkout = await customer.createCheckout(request("POST", {}), {
    plan: "starter",
    cycle: "monthly",
    agent_draft_id: saved.row.id,
  });
  assert.equal(checkout.url, "https://checkout.stripe.com/test");
  assert.equal(subscription.stripe_customer_id, "cus_owner");
  const checkoutRequest = requests.find((entry) => entry.url === "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(new URLSearchParams(checkoutRequest.options.body).get("customer"), "cus_owner");
  assert.equal(new URLSearchParams(checkoutRequest.options.body).has("customer_email"), false);
  assert.equal(new URLSearchParams(checkoutRequest.options.body).get("payment_method_collection"), "if_required");

  subscription = { account_id: account.id, plan: "starter", status: "checkout_pending", agent_quota: 1 };
  await assert.rejects(
    () => customer.testAgent(request("POST", {}), "agent-1", {
      phone_number: "+15555550123",
      test_call_consent: true,
    }),
    (error) => error.code === "subscription_required",
  );

  const activated = await customer.activateCheckout(request("POST", {}), { session_id: "cs_test_owner" });
  assert.equal(activated.subscription.status, "active");
  assert.equal(activated.agent.active, true);
  assert.equal(activated.agent.phone_number, "+15555550999");
  assert.ok(requests.some((entry) => entry.url === "https://api.vapi.ai/assistant"));
  const provisionRequest = requests.find((entry) => entry.url === "https://api.vapi.ai/assistant");
  const provisioned = JSON.parse(provisionRequest.options.body);
  assert.equal(provisioned.model.model, "gpt-4.1-mini");
  assert.ok(provisioned.name.length <= 40);
  assert.equal(provisioned.voice.provider, "11labs");
  assert.equal(provisioned.voice.model, "eleven_turbo_v2_5");
  assert.equal(provisioned.metadata.voice_experience, "natural");
  assert.equal(provisioned.startSpeakingPlan.smartEndpointingPlan.provider, "livekit");
  assert.equal(provisioned.stopSpeakingPlan.numWords, 2);
  assert.equal(provisioned.backchannelingEnabled, true);
  assert.equal(provisioned.artifactPlan.recordingEnabled, false);
  assert.equal(Object.hasOwn(provisioned, "recordingConsentPlan"), false);
  assert.match(provisioned.firstMessage, /Thanks for calling Owner Test/);
  assert.match(provisioned.model.messages[0].content, /burst pipe/);
  assert.equal(provisioned.server.secret, "webhook-test");
  const numberProvisionRequest = requests.find((entry) => entry.url === "https://api.vapi.ai/phone-number");
  assert.equal(JSON.parse(numberProvisionRequest.options.body).numberDesiredAreaCode, "714");

  const pausedAgent = await customer.saveAgent(request("PUT", { active: false }), "agent-1", { active: false }, {
    requireActive: true,
    provision: true,
  });
  assert.equal(pausedAgent.agent.active, false);
  assert.equal(pausedAgent.agent.status, "paused");
  const pauseRequest = requests.find((entry) => entry.url === "https://api.vapi.ai/phone-number/phone_customer_agent"
    && JSON.parse(entry.options.body || "{}").assistantId === null);
  assert.ok(pauseRequest);

  const resumedAgent = await customer.saveAgent(request("PUT", { active: true }), "agent-1", { active: true }, {
    requireActive: true,
    provision: true,
  });
  assert.equal(resumedAgent.agent.active, true);
  assert.equal(resumedAgent.agent.status, "active");

  vapiFailureMode = "phone_update_503";
  await assert.rejects(
    () => customer.saveAgent(request("PUT", { active: true }), "agent-1", { active: true }, {
      requireActive: true,
      provision: true,
    }),
    (error) => error.code === "vapi_unavailable",
  );
  assert.equal(agent.status, "error");
  assert.match(agent.last_error, /The voice service is temporarily unavailable/);
  assert.match(agent.last_error, /Code: vapi_unavailable/);
  assert.match(agent.last_error, /Error ID: [a-f0-9-]{36}/);
  vapiFailureMode = null;
  const recoveredAgent = await customer.saveAgent(request("PUT", { active: true }), "agent-1", { active: true }, {
    requireActive: true,
    provision: true,
  });
  assert.equal(recoveredAgent.agent.active, true);
  assert.equal(recoveredAgent.agent.status, "active");

  const activeAgentSnapshot = { ...agent };
  agent = { ...agent, status: "provisioning", updated_at: new Date().toISOString() };
  await assert.rejects(
    () => customer.saveAgent(request("PUT", { active: true }), "agent-1", { active: true }, {
      requireActive: true,
      provision: true,
    }),
    (error) => error.code === "agent_transition_in_progress",
  );
  agent = activeAgentSnapshot;

  const portal = await customer.createCustomerPortal(request("POST", {}), { return_url: "https://attacker.example/phish" });
  assert.equal(portal.url, "https://billing.stripe.com/test");
  const portalRequest = [...requests].reverse().find((entry) => entry.url === "https://api.stripe.com/v1/billing_portal/sessions");
  assert.equal(new URLSearchParams(String(portalRequest.options.body)).get("return_url"), "https://missioncontrol.wss-ai.com/billing");
  const billing = await customer.billingSummary(request("GET", {}));
  assert.equal(billing.status, "active");
  assert.equal(billing.minutes_included, 125);
  assert.equal(billing.automatic_overage_billing, false);
  const ownerPractice = await customer.testAgent(request("POST", {}), "agent-1", {
    phone_number: "+1 (555) 555-0123",
    test_call_consent: true,
    idempotency_key: "shared-client-key",
  });
  assert.equal(ownerPractice.call_id, "call_owner_practice");
  const ownerPracticeRequest = requests.find((entry) => entry.url === "https://api.vapi.ai/call");
  const ownerPracticePayload = JSON.parse(ownerPracticeRequest.options.body);
  assert.notEqual(ownerPracticeRequest.options.headers["Idempotency-Key"], "shared-client-key");
  assert.match(ownerPracticeRequest.options.headers["Idempotency-Key"], new RegExp(`^answercrew:test-call:${account.id}:${agent.id}:`));
  assert.equal(ownerPracticePayload.assistantOverrides.artifactPlan.recordingEnabled, true);
  assert.equal(ownerPracticePayload.assistantOverrides.artifactPlan.loggingEnabled, false);
  assert.equal(ownerPracticePayload.assistantOverrides.artifactPlan.pcapEnabled, false);
  assert.equal(ownerPracticePayload.assistantOverrides.artifactPlan.transcriptPlan.enabled, true);
  assert.equal(
    ownerPracticePayload.assistantOverrides.firstMessage,
    "Hi, this is Alex from AnswerCrew. You requested this practice call. What would you like to test?",
  );
  assert.equal(ownerPracticePayload.assistantOverrides.firstMessageMode, "assistant-waits-for-user");
  assert.deepEqual(ownerPracticePayload.assistantOverrides.variableValues, {
    ownerName: "account owner",
    businessName: "Owner Test",
    callDirection: "outbound",
    callPurpose: "authenticated owner practice call",
  });
  const playback = await customer.gateway(request("GET", {}, "/?path=/api/recordings/call_owner_practice/playback"));
  assert.equal(playback.playback_url, "https://vapi.example.test/current-owner-practice.wav");
  customerCalls = customerCalls.filter((row) => row.vapi_call_id !== "call_owner_practice");
  await assert.rejects(
    () => customer.testAgent(request("POST", {}), "agent-1", {
      phone_number: "+15555550124",
      test_call_consent: true,
    }),
    (error) => error.code === "owner_practice_destination_required",
  );
  await assert.rejects(
    () => customer.testAgent(request("POST", {}), "agent-1", { phone_number: "+15555550123" }),
    (error) => error.code === "call_consent_required",
  );

  // Usage attribution is windowed to the current UTC month; a plain
  // "10 minutes ago" startedAt crosses that boundary right after UTC midnight
  // (this self-test failed CI on 2026-09-01T00:01Z for exactly that reason)
  // and the call would fall outside the window. Keep the call inside the
  // period: never earlier than the period start, endedAt = start + 10min.
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);
  const startedAt = new Date(Math.max(Date.now() - 10 * 60 * 1000, periodStart.getTime()));
  const endedAt = new Date(startedAt.getTime() + 10 * 60 * 1000);
  const usageResult = await customer.recordCustomerCallUsage({
    id: "call_usage_test",
    assistantId: "vapi_customer_agent",
    type: "outboundPhoneCall",
    status: "ended",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
  });
  assert.equal(usageResult.mode, "usage_recorded");
  assert.equal(usageResult.usage.minutes_used, 10);
  assert.equal(usageResult.usage.automatic_overage_billing, false);

  const artifactUsage = await customer.recordCustomerCallUsage({
    id: "call_artifact_fixture",
    assistantId: "vapi_customer_agent",
    type: "outboundPhoneCall",
    status: "queued",
    artifact: {
      recording: "https://vapi.example.test/real-artifact.wav",
      transcript: [
        { role: "assistant", message: "Hello" },
        { role: "user", message: "Please call me back" },
      ],
    },
  }, {
    startedAt: "2026-07-11T20:00:00.000Z",
    endedAt: "2026-07-11T20:00:00.000Z",
    endedReason: "voicemail",
    compliance: { recordingConsent: { granted: true, mode: "owner_test" } },
  });
  assert.equal(artifactUsage.mode, "usage_recorded");
  const storedArtifact = customerCalls.find((row) => row.vapi_call_id === "call_artifact_fixture");
  assert.equal(storedArtifact.recording_url, "https://vapi.example.test/real-artifact.wav");
  assert.equal(storedArtifact.transcript, "assistant: Hello\nuser: Please call me back");
  assert.equal(storedArtifact.recording_consent_mode, "owner_test");
  assert.equal(storedArtifact.status, "completed");
  assert.equal(storedArtifact.payload.providerStatus, "queued");
  assert.equal(storedArtifact.payload.endedReason, "voicemail");
  assert.ok(storedArtifact.artifact_retention_expires_at);
  assert.equal(storedArtifact.transcript.includes("[object Object]"), false);
  const artifactView = await customer.gateway(request("GET", {}, "/?path=/api/calls"));
  const mappedArtifact = artifactView.find((row) => row.call_id === "call_artifact_fixture");
  assert.equal(mappedArtifact.agent_name, "Alex");
  assert.equal(mappedArtifact.status, "voicemail");
  assert.equal(mappedArtifact.provider_status, "queued");
  assert.equal(mappedArtifact.ended_reason, "voicemail");
  assert.equal(mappedArtifact.outcome, "voicemail");
  customerCalls = customerCalls.filter((row) => row.vapi_call_id !== "call_artifact_fixture");

  const currentMonthCalls = customerCalls;
  customerCalls = [];
  subscription.minutes_used = subscription.minutes_included;
  const resetBalance = await customer.gateway(request("GET", {}, "/?path=/api/billing/balance"));
  assert.equal(resetBalance.balance, subscription.minutes_included);
  assert.equal(resetBalance.minutes_used, 0);

  customerCalls = currentMonthCalls;
  customerCalls[0].duration_seconds = subscription.minutes_included * 60;
  subscription.minutes_used = subscription.minutes_included;
  const callsBeforeQuotaCheck = requests.filter((entry) => entry.url === "https://api.vapi.ai/call").length;
  await assert.rejects(
    () => customer.testAgent(request("POST", {}), "agent-1", {
      phone_number: "+15555550123",
      test_call_consent: true,
    }),
    (error) => error.code === "minute_quota_reached" && error.detail.automatic_overage_billing === false,
  );
  assert.equal(requests.filter((entry) => entry.url === "https://api.vapi.ai/call").length, callsBeforeQuotaCheck);

  const balance = await customer.gateway(request("GET", {}, "/?path=/api/billing/balance"));
  assert.equal(balance.balance, 0);
  assert.equal(balance.overage_policy, "hard_cap");
  assert.equal(balance.automatic_overage_billing, false);

  const listedCalls = await customer.gateway(request("GET", {}, "/?path=/api/calls"));
  assert.equal(listedCalls.length, 1);
  assert.equal(listedCalls[0].call_id, "call_usage_test");
  assert.equal(listedCalls[0].agent_name, "Alex");
  const callDetail = await customer.gateway(request("GET", {}, "/?path=/api/calls/call_usage_test"));
  assert.equal(callDetail.agent, "agent-1");

  const canceled = await customer.handleCustomerStripeEvent({
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_owner",
        customer: "cus_owner",
        status: "canceled",
        metadata: { product: "mission-control", account_id: account.id, plan: "solo" },
      },
    },
  });
  assert.equal(canceled.mode, "customer_subscription_upserted");
  assert.equal(subscription.status, "canceled");
  await assert.rejects(
    () => customer.testAgent(request("POST", {}), "agent-1", {
      phone_number: "+15555550123",
      test_call_consent: true,
    }),
    (error) => error.code === "subscription_required",
  );

  console.log("Mission Control customer isolation self-test OK");
})().finally(() => {
  global.fetch = originalFetch;
  Module._load = originalLoad;
  process.env = env;
});
