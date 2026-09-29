"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { STRIPE_API_VERSION } = require("./stripe");
const {
  buildAnswerCrewAssistantConfig,
  businessProfileStatus,
  normalizeBusinessProfile,
} = require("./answercrew-agent-core");
const { resolvePlanPriceId } = require("./billing-readiness");
const customerSms = require("./customer-sms");
const { mapCallArtifacts, retentionExpiresAt, transcriptText } = require("./answercrew-call-artifacts");
const { recordEvent } = require("./store");

const DEFAULT_ORIGIN = "https://missioncontrol.wss-ai.com";
const DEFAULT_PUBLIC_URL = "https://ghost.wss-ai.com";
// Vercel preview hostnames embed the TEAM slug: {project}-{hash}-{team}.vercel.app.
// The team was renamed rocketsites -> wss-labs, which silently invalidated the old
// pattern and made every cockpit preview origin fail CORS validation (falling back
// to DEFAULT_ORIGIN). This must track the live Vercel team slug.
const ANSWERCREW_PREVIEW_ORIGIN = /^https:\/\/answercrew-cockpit-[a-z0-9-]+-wss-labs\.vercel\.app$/i;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const LOCKED_SUBSCRIPTION_STATUSES = new Set(["canceled", "cancelled", "unpaid", "past_due", "paused", "incomplete_expired"]);
const CUSTOMER_ACCOUNTS_TABLE = "answercrew_customer_accounts";
const CUSTOMER_SUBSCRIPTIONS_TABLE = "answercrew_customer_subscriptions";

const PLAN_CONFIG = {
  solo: { price: "STRIPE_PRICE_SOLO", aliases: ["STRIPE_PRICE_STARTER"], annual: "STRIPE_PRICE_SOLO_ANNUAL", annualAliases: ["STRIPE_PRICE_STARTER_ANNUAL"], quota: 1, minutes: 125 },
  crew: { price: "STRIPE_PRICE_CREW", aliases: ["STRIPE_PRICE_GROWTH"], annual: "STRIPE_PRICE_CREW_ANNUAL", annualAliases: ["STRIPE_PRICE_GROWTH_ANNUAL"], quota: 3, minutes: 325 },
  front_office: { price: "STRIPE_PRICE_FRONT_OFFICE", aliases: [], annual: "STRIPE_PRICE_FRONT_OFFICE_ANNUAL", annualAliases: [], quota: 10, minutes: 775 },
  agency: { price: "STRIPE_PRICE_AGENCY", aliases: [], annual: "STRIPE_PRICE_AGENCY_ANNUAL", annualAliases: [], quota: 25, minutes: 1850 },
};

const FALLBACK_VOICES = [
  { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "Warm and clear", gender: "female", accent: "American", preview_url: "", tags: ["warm", "natural"], rating: 5 },
  { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Grounded and conversational", gender: "male", accent: "American", preview_url: "", tags: ["grounded", "conversational"], rating: 5 },
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Friendly and confident", gender: "female", accent: "American", preview_url: "", tags: ["friendly", "confident"], rating: 5 },
  { voice_id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "Calm and approachable", gender: "male", accent: "American", preview_url: "", tags: ["calm", "approachable"], rating: 5 },
];
let voiceCache = { expiresAt: 0, voices: FALLBACK_VOICES };
const vapiCircuit = { failures: 0, openUntil: 0 };
let vapiHealthCache = { expiresAt: 0, value: null };

function mapElevenVoice(voice = {}) {
  const labels = voice.labels || {};
  return {
    voice_id: clean(voice.voice_id, 240),
    name: clean(voice.name, 120) || "Voice",
    description: clean(voice.description || labels.description || labels.use_case, 300) || "Natural conversational voice",
    gender: clean(labels.gender, 40).toLowerCase() || "unspecified",
    accent: clean(labels.accent, 80) || "",
    age: clean(labels.age, 60) || "",
    use_case: clean(labels.use_case, 100) || "",
    preview_url: clean(voice.preview_url, 1000),
    tags: [labels.description, labels.use_case, labels.age].map((value) => clean(value, 60).toLowerCase()).filter(Boolean).slice(0, 4),
    rating: 5,
    provider: "11labs",
    category: clean(voice.category, 60) || "",
  };
}

async function voiceCatalog() {
  if (voiceCache.expiresAt > Date.now()) return voiceCache.voices;
  const key = clean(process.env.ELEVENLABS_API_KEY, 1000);
  if (!key) return FALLBACK_VOICES;
  const voices = [];
  let next = "";
  try {
    for (let page = 0; page < 5; page += 1) {
      const url = new URL("https://api.elevenlabs.io/v2/voices");
      url.searchParams.set("page_size", "100");
      url.searchParams.set("include_total_count", "false");
      if (next) url.searchParams.set("next_page_token", next);
      const response = await fetch(url, { headers: { "xi-api-key": key, Accept: "application/json" } });
      if (!response.ok) throw new Error(`elevenlabs_voices_http_${response.status}`);
      const body = await response.json();
      voices.push(...(Array.isArray(body.voices) ? body.voices.map(mapElevenVoice).filter((voice) => voice.voice_id) : []));
      if (!body.has_more || !body.next_page_token) break;
      next = body.next_page_token;
    }
    const unique = [...new Map(voices.map((voice) => [voice.voice_id, voice])).values()];
    voiceCache = { expiresAt: Date.now() + 10 * 60_000, voices: unique.length ? unique : FALLBACK_VOICES };
    return voiceCache.voices;
  } catch {
    voiceCache = { expiresAt: Date.now() + 60_000, voices: FALLBACK_VOICES };
    return voiceCache.voices;
  }
}

function httpError(statusCode, code, message, detail) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.detail = detail;
  return error;
}

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function ownerNotificationPhone(value) {
  const raw = clean(value, 80);
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  const phone = `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw httpError(400, "invalid_owner_notification_phone", "owner_notification_phone must be a valid E.164 phone number");
  }
  return phone;
}

function allowedOrigin(req) {
  const configured = clean(process.env.MISSION_CONTROL_ALLOWED_ORIGINS, 2000)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = new Set([DEFAULT_ORIGIN, ...configured]);
  const origin = clean(req.headers.origin, 500);
  return allowed.has(origin) || ANSWERCREW_PREVIEW_ORIGIN.test(origin) ? origin : DEFAULT_ORIGIN;
}

function configuredCustomerOrigin() {
  const candidate = clean(process.env.MISSION_CONTROL_PUBLIC_URL || DEFAULT_ORIGIN, 500).replace(/\/+$/, "");
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.origin;
  } catch {
    // Fall through to the production cockpit.
  }
  return DEFAULT_ORIGIN;
}

function safePortalReturnUrl(value) {
  const fallback = `${configuredCustomerOrigin()}/billing`;
  const candidate = clean(value, 1000);
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    const configured = clean(process.env.MISSION_CONTROL_ALLOWED_ORIGINS, 2000)
      .split(",")
      .map((origin) => {
        try { return new URL(origin.trim()).origin; } catch { return ""; }
      })
      .filter(Boolean);
    const allowed = new Set([DEFAULT_ORIGIN, configuredCustomerOrigin(), ...configured]);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return fallback;
    if (!allowed.has(parsed.origin) && !ANSWERCREW_PREVIEW_ORIGIN.test(parsed.origin)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function setCors(req, res, methods = ["GET", "POST", "PUT", "OPTIONS"]) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", methods.join(","));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With,X-Correlation-Id,Idempotency-Key");
  res.setHeader("Access-Control-Expose-Headers", "X-Correlation-Id");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
}

function sendJson(req, res, statusCode, payload, methods) {
  setCors(req, res, methods);
  const responseCorrelationId = clean(payload?.correlation_id || payload?.detail?.correlation_id, 120);
  if (responseCorrelationId) res.setHeader("X-Correlation-Id", responseCorrelationId);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function methodGuard(req, res, methods) {
  setCors(req, res, methods);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (!methods.includes(req.method)) {
    sendJson(req, res, 405, { ok: false, error: "method_not_allowed", allowed: methods }, methods);
    return false;
  }
  return true;
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRawBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "invalid_json", "Invalid JSON");
  }
}

function supabaseUrl() {
  const value = clean(process.env.SUPABASE_URL, 500).replace(/\/+$/, "");
  if (!value) throw httpError(503, "supabase_not_configured", "SUPABASE_URL is not configured");
  return value;
}

function supabaseKey() {
  const value = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY, 1000);
  if (!value) throw httpError(503, "supabase_not_configured", "SUPABASE_SERVICE_ROLE_KEY is not configured");
  return value;
}

async function rest(table, options = {}) {
  const url = new URL(`${supabaseUrl()}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseKey(),
      Authorization: `Bearer ${supabaseKey()}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw httpError(response.status, "supabase_request_failed", `Supabase ${table} request failed`, payload);
  return payload;
}

async function rows(table, query = {}) {
  const value = await rest(table, { query: { select: "*", ...query } });
  return Array.isArray(value) ? value : [];
}

async function upsert(table, body, conflict) {
  return rest(table, {
    method: "POST",
    query: conflict ? { on_conflict: conflict } : {},
    prefer: "resolution=merge-duplicates,return=representation",
    body,
  });
}

async function patch(table, query, body) {
  return rest(table, { method: "PATCH", query: { select: "*", ...query }, body });
}

function bearer(req) {
  const value = clean(req.headers.authorization || req.headers.Authorization, 5000);
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function authenticate(req) {
  const token = bearer(req);
  if (!token) throw httpError(401, "unauthorized", "Supabase bearer token required");
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: supabaseKey(), Authorization: `Bearer ${token}` },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw httpError(401, "unauthorized", "Invalid Supabase bearer token");
  return user;
}

async function accountForUser(user, body = {}) {
  let account = (await rows(CUSTOMER_ACCOUNTS_TABLE, { owner_user_id: `eq.${user.id}`, order: "created_at.asc", limit: "1" }))[0];
  const configuredOwnerPhone = ownerNotificationPhone(
    body.owner_notification_phone ||
    body.notificationPhone ||
    body.business_profile?.owner_notification_phone ||
    body.business_profile?.notificationPhone,
  );
  if (account) {
    if (configuredOwnerPhone && configuredOwnerPhone !== account.owner_notification_phone) {
      const updated = await patch(CUSTOMER_ACCOUNTS_TABLE, { id: `eq.${account.id}`, owner_user_id: `eq.${user.id}` }, {
        owner_notification_phone: configuredOwnerPhone,
        updated_at: new Date().toISOString(),
      });
      account = updated?.[0] || { ...account, owner_notification_phone: configuredOwnerPhone };
    }
    return account;
  }
  const inserted = await upsert(CUSTOMER_ACCOUNTS_TABLE, {
    owner_user_id: user.id,
    name: clean(body.account_name || body.business_name || user.email, 180) || "Mission Control Account",
    type: body.plan === "agency" ? "agency" : "business",
    status: "active",
    owner_notification_phone: configuredOwnerPhone || null,
    updated_at: new Date().toISOString(),
  }, "owner_user_id");
  account = inserted?.[0];
  if (!account) throw httpError(500, "account_create_failed", "Could not create the customer account");
  return account;
}

async function subscriptionFor(accountId) {
  return (await rows(CUSTOMER_SUBSCRIPTIONS_TABLE, { account_id: `eq.${accountId}`, limit: "1" }))[0] || null;
}

function isActiveSubscription(subscription) {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(clean(subscription?.status, 80).toLowerCase());
}

async function customerContext(req, body = {}, requireActive = false) {
  const user = await authenticate(req);
  const account = await accountForUser(user, body);
  const subscription = await subscriptionFor(account.id);
  if (requireActive && !isActiveSubscription(subscription)) {
    throw httpError(402, "subscription_required", "An active subscription is required", {
      status: subscription?.status || "missing",
    });
  }
  return { user, account, subscription };
}

function normalizedPlan(value) {
  const raw = clean(value || "solo", 40).toLowerCase();
  const plan = { starter: "solo", growth: "crew", "front-office": "front_office", frontoffice: "front_office" }[raw] || raw;
  if (!PLAN_CONFIG[plan]) throw httpError(400, "invalid_plan", "Plan must be solo, crew, front_office, or agency");
  return plan;
}

function voiceExperienceForPlan(value) {
  return ["front_office", "agency"].includes(normalizedPlan(value)) ? "signature" : "natural";
}

function minuteQuotaState(subscription) {
  const plan = normalizedPlan(subscription?.plan || "solo");
  const unlimitedMinutes = subscription?.internal_unlimited_minutes === true;
  const configuredMinutes = Number(PLAN_CONFIG[plan].minutes);
  const storedIncluded = Number(subscription?.minutes_included);
  const included = unlimitedMinutes ? null : Number.isFinite(storedIncluded) && storedIncluded > 0
    ? Math.min(storedIncluded, configuredMinutes)
    : configuredMinutes;
  const rawUsed = subscription?.minutes_used;
  const used = rawUsed === undefined || rawUsed === null || rawUsed === "" ? 0 : Number(rawUsed);
  if (!Number.isFinite(used) || used < 0) {
    throw httpError(503, "minute_usage_unavailable", "Minute usage is unavailable; calling is paused to prevent unapproved charges");
  }
  const remaining = unlimitedMinutes ? null : Math.max(0, Math.round((included - used) * 100) / 100);
  return {
    plan,
    voice_experience: voiceExperienceForPlan(plan),
    internal_access_role: clean(subscription?.internal_access_role, 80) || null,
    unlimited_minutes: unlimitedMinutes,
    minutes_included: included,
    minutes_used: Math.round(used * 100) / 100,
    minutes_remaining: remaining,
    quota_reached: unlimitedMinutes ? false : remaining <= 0,
    overage_policy: unlimitedMinutes ? "internal_unlimited" : "hard_cap",
    automatic_overage_billing: false,
  };
}

function enforceMinuteQuota(subscription) {
  const usage = minuteQuotaState(subscription);
  if (usage.quota_reached) {
    throw httpError(409, "minute_quota_reached", "Monthly calling minutes are used up; calling is paused until the quota resets or the plan changes", usage);
  }
  return usage;
}

function currentUsagePeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function durationSeconds(call = {}, details = {}) {
  const direct = Number(
    details.durationSeconds
      ?? details.duration_seconds
      ?? call.durationSeconds
      ?? call.duration_seconds
      ?? call.duration,
  );
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const minutes = Number(
    details.durationMinutes
      ?? details.duration_minutes
      ?? call.durationMinutes
      ?? call.duration_minutes,
  );
  if (Number.isFinite(minutes) && minutes >= 0) return minutes * 60;
  const started = Date.parse(details.startedAt || details.started_at || call.startedAt || call.started_at || call.createdAt || "");
  const ended = Date.parse(details.endedAt || details.ended_at || call.endedAt || call.ended_at || "");
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, (ended - started) / 1000) : 0;
}

async function refreshAccountUsage(accountId, subscription) {
  const baseline = minuteQuotaState(subscription);
  const pageSize = 1000;
  const maxPages = 25;
  let totalSeconds = 0;
  let truncated = false;
  for (let page = 0; page < maxPages; page += 1) {
    const callRows = await rows("mission_control_customer_calls", {
      account_id: `eq.${accountId}`,
      started_at: `gte.${currentUsagePeriodStart()}`,
      select: "duration_seconds",
      order: "started_at.asc",
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    totalSeconds += callRows.reduce((sum, row) => sum + Math.max(0, Number(row.duration_seconds) || 0), 0);
    if (callRows.length < pageSize || (!baseline.unlimited_minutes && totalSeconds / 60 >= baseline.minutes_included)) break;
    if (page === maxPages - 1) truncated = true;
  }
  const computedMinutes = Math.round((totalSeconds / 60) * 100) / 100;
  const minutesUsed = truncated && !baseline.unlimited_minutes ? Math.max(computedMinutes, baseline.minutes_included) : computedMinutes;
  const updated = await patch(CUSTOMER_SUBSCRIPTIONS_TABLE, { account_id: `eq.${accountId}` }, {
    minutes_used: minutesUsed,
    updated_at: new Date().toISOString(),
  });
  const current = updated?.[0] || { ...subscription, minutes_used: minutesUsed };
  return { subscription: current, truncated, usage: minuteQuotaState(current) };
}

function inactiveBalanceState(subscription) {
  return {
    status: "inactive",
    subscription_status: clean(subscription?.status, 80).toLowerCase() || null,
    active_subscription: false,
    balance: null,
    currency: "minutes",
    calls_remaining_estimate: null,
    minutes_used: null,
    minutes_included: null,
    minutes_remaining: null,
    overage_policy: "hard_cap",
    automatic_overage_billing: false,
  };
}

function recordingConsentFromCompliance(compliance = {}) {
  const value = compliance.recordingConsent ?? compliance.recording_consent ?? compliance.consent;
  if (value === true) return true;
  if (!value || typeof value !== "object") return false;
  return value.granted === true || value.consentGranted === true || value.status === "granted" || value.state === "granted";
}

function recordingConsentModeFromCompliance(compliance = {}) {
  return clean(
    compliance.recordingConsentMode ||
    compliance.recording_consent_mode ||
    compliance.consentMode ||
    compliance.recordingConsent?.mode ||
    compliance.recording_consent?.mode,
    120,
  );
}

async function recordCustomerCallUsage(call = {}, details = {}) {
  const callId = clean(call.id || details.callId, 240);
  const assistantId = clean(call.assistantId || call.assistant_id, 240);
  if (!callId || !assistantId) return { mode: "not_customer_call", reason: "call_or_assistant_missing" };

  const agent = (await rows("mission_control_agents", { vapi_assistant_id: `eq.${assistantId}`, limit: "1" }))[0];
  if (!agent?.account_id) return { mode: "not_customer_call", reason: "assistant_not_owned" };

  const existingCall = (await rows("mission_control_customer_calls", {
    account_id: `eq.${agent.account_id}`,
    vapi_call_id: `eq.${callId}`,
    limit: "1",
  }))[0] || {};

  const seconds = durationSeconds(call, details);
  const summaryValue = details.summary ?? call.analysis?.summary ?? call.summary ?? null;
  const summary = typeof summaryValue === "string" ? clean(summaryValue, 4000) : summaryValue ? clean(JSON.stringify(summaryValue), 4000) : null;
  const startedAt = details.startedAt || details.started_at || call.startedAt || call.started_at || call.createdAt || new Date().toISOString();
  const endedAt = details.endedAt || details.ended_at || call.endedAt || call.ended_at || null;
  const providerStatus = clean(call.status, 80).toLowerCase();
  const terminalFailure = ["failed", "error", "canceled", "cancelled"].includes(providerStatus);
  const status = endedAt ? (terminalFailure ? providerStatus : "completed") : (providerStatus || "unknown");
  const endedReason = clean(details.endedReason || details.ended_reason || call.endedReason || call.ended_reason, 160) || null;
  const type = clean(call.type, 80).toLowerCase();
  const artifact = details.artifact || call.artifact || {};
  const compliance = details.compliance || call.compliance || {};
  const recordingConsentEnabled = existingCall.recording_consent_enabled === true || call.recording_consent_enabled === true || recordingConsentFromCompliance(compliance);
  const recording = clean(artifact.recording, 2000) || null;
  const transcript = transcriptText(artifact.transcript ?? call.transcript);
  const artifactRetentionExpiresAt = (recording || transcript)
    ? retentionExpiresAt({ started_at: startedAt, ended_at: endedAt, created_at: new Date().toISOString() })
    : null;

  await upsert("mission_control_customer_calls", {
    account_id: agent.account_id,
    agent_id: agent.id,
    vapi_call_id: callId,
    direction: type.includes("inbound") ? "inbound" : "outbound",
    customer_number: clean(call.customer?.number || call.customerNumber, 80) || null,
    status,
    duration_seconds: seconds,
    summary,
    transcript: transcript || null,
    recording_url: recording || existingCall.recording_url || null,
    recording_consent_enabled: recordingConsentEnabled,
    recording_consent_mode: existingCall.recording_consent_mode || call.recording_consent_mode || recordingConsentModeFromCompliance(compliance) || (recordingConsentEnabled ? "vapi_compliance" : null),
    artifact_retention_expires_at: artifactRetentionExpiresAt || existingCall.artifact_retention_expires_at || null,
    payload: {
      id: callId,
      assistantId,
      type: call.type || null,
      status,
      providerStatus: providerStatus || null,
      endedReason,
      analysis: call.analysis || details.analysis || null,
    },
    started_at: startedAt,
    ended_at: endedAt,
    updated_at: new Date().toISOString(),
  }, "account_id,vapi_call_id");

  const subscription = await subscriptionFor(agent.account_id);
  if (!subscription) return { mode: "usage_recorded", account_id: agent.account_id, subscription: "missing" };
  const refreshed = await refreshAccountUsage(agent.account_id, subscription);
  return {
    mode: "usage_recorded",
    account_id: agent.account_id,
    call_id: callId,
    truncated: refreshed.truncated,
    usage: refreshed.usage,
  };
}

function configuredPrice(plan, annual) {
  const config = PLAN_CONFIG[plan];
  const envName = annual ? config.annual : config.price;
  const value = clean(resolvePlanPriceId(plan, process.env, { annual }), 500);
  if (!value) throw httpError(503, "stripe_price_not_configured", `${envName} is not configured`);
  return { envName, value };
}

async function stripeRequest(path, options = {}) {
  const secret = clean(process.env.STRIPE_SECRET_KEY, 1000);
  if (!secret) throw httpError(503, "stripe_not_configured", "STRIPE_SECRET_KEY is not configured");
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: options.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status >= 500 ? 502 : response.status, "stripe_request_failed", "Stripe request failed", payload);
  return payload;
}

async function ownedAgent(accountId, slotOrId) {
  const key = clean(slotOrId, 120).toLowerCase();
  if (!key) throw httpError(400, "agent_required", "Agent ID or slot is required");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    const byId = await rows("mission_control_agents", { account_id: `eq.${accountId}`, id: `eq.${key}`, limit: "1" });
    if (byId[0]) return byId[0];
  }
  const bySlot = await rows("mission_control_agents", { account_id: `eq.${accountId}`, slot_key: `eq.${key}`, limit: "1" });
  if (!bySlot[0]) throw httpError(404, "agent_not_found", "Agent not found");
  return bySlot[0];
}

function agentForClient(row) {
  const voiceExperience = row.business_profile?.voice_experience === "signature" ? "signature" : "natural";
  return {
    id: row.id,
    name: row.slot_key,
    display_name: row.display_name,
    role_template: row.role_template,
    voice: row.voice_id,
    voice_id: row.voice_id,
    model: voiceExperience === "signature" ? "gpt-4.1" : "gpt-4.1-mini",
    voice_experience: voiceExperience,
    temperature: 0.6,
    interruption_threshold: 400,
    background_track: row.business_profile?.background_sound || "office",
    max_duration: 8,
    prompt: row.prompt,
    business_profile: row.business_profile || {},
    active: row.status === "active",
    status: row.status,
    phone_number: row.phone_number || null,
    phone_number_id: row.phone_number_id || null,
    activation_error: row.last_error || null,
  };
}

function assistantConfig(row, experienceTier = "natural") {
  const webhookBase = clean(process.env.MISSION_CONTROL_BACKEND_URL || DEFAULT_PUBLIC_URL, 500).replace(/\/+$/, "");
  const built = buildAnswerCrewAssistantConfig({
    ...(row.business_profile || {}),
    agent_name: row.display_name,
    business_name: row.business_name,
    voice_id: row.voice_id,
  }, {
    accountId: row.account_id,
    webhookBase,
    webhookSecret: clean(process.env.VAPI_WEBHOOK_SECRET, 1000),
    experienceTier,
  });
  if (row.custom_instructions) {
    built.config.model.messages[0].content += `\n\n[Business-specific instructions]\n${clean(row.custom_instructions, 4000)}`;
  }
  return built.config;
}

function correlationId(value) {
  const normalized = clean(value, 120).replace(/[^a-zA-Z0-9._:-]/g, "");
  return normalized || randomUUID();
}

function requestCorrelationId(req) {
  return correlationId(
    req?.headers?.["x-correlation-id"] ||
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-vercel-id"],
  );
}

function hashValue(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function safeVapiTelemetry(value, key = "") {
  if (value === null || value === undefined) return value;
  if (/authorization|token|secret|api.?key|email|phone|number|customer|message|prompt|instructions|metadata|business|name|artifact|recording|transcript|signed|url|error.?detail|(?:^|_)(?:detail|errors?)$/i.test(key)) {
    return value && typeof value === "object" ? "[redacted object]" : "[redacted]";
  }
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeVapiTelemetry(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([entryKey, entryValue]) => [entryKey, safeVapiTelemetry(entryValue, entryKey)]));
  }
  if (typeof value === "string") {
    const safeStringKey = /^(?:operation|correlation_id|method|path|status|code|error_code|provider|model|upstream_request_id|idempotency_key_hash|retryable|checked_at)$/i.test(key);
    return safeStringKey ? value.slice(0, 1000) : "[redacted]";
  }
  return value;
}

function telemetryPath(path) {
  return clean(path, 500).replace(/\/(assistant|phone-number|call)\/[^/?]+/g, "/$1/:id");
}

function payloadMessage(payload) {
  const values = [
    payload?.message,
    payload?.error?.message,
    typeof payload?.error === "string" ? payload.error : "",
    payload?.detail,
    Array.isArray(payload?.errors) ? payload.errors.map((item) => item?.message || item).join("; ") : "",
  ];
  return clean(values.filter(Boolean).join("; "), 1000);
}

function vapiFailure(status, payload, context = {}) {
  const upstream = payloadMessage(payload);
  const message = upstream.toLowerCase();
  let statusCode = status >= 500 ? 503 : status;
  let code = "vapi_request_failed";
  let userMessage = "The voice service could not complete this request.";

  if (status === 401 || status === 403 || /unauthori|invalid.*(?:token|key)|api.?key|authentication/.test(message)) {
    statusCode = 503;
    code = "vapi_auth_failed";
    userMessage = "The voice service credentials need attention. Support can use the error ID below.";
  } else if (status === 429) {
    statusCode = 503;
    code = "vapi_rate_limited";
    userMessage = "The voice service is busy. Please wait a moment and try again.";
  } else if (status === 404 && /\/assistant\//.test(context.path || "")) {
    statusCode = 409;
    code = "vapi_assistant_missing";
    userMessage = "This agent's voice profile no longer exists. Resume it to rebuild the profile.";
  } else if (/phone|number|area.?code/.test(message) && /unavailable|availability|inventory|purchase|provider|region/.test(message)) {
    statusCode = 409;
    code = "vapi_number_unavailable";
    userMessage = "A phone number is not available for that region yet. Choose another area code or contact support.";
  } else if (/plan|seat|quota|limit|capacity|billing|credit/.test(message)) {
    statusCode = 409;
    code = "plan_capacity_exceeded";
    userMessage = "Voice capacity is unavailable on the current plan or provider account.";
  } else if (status >= 500) {
    statusCode = 503;
    code = "vapi_unavailable";
    userMessage = "The voice service is temporarily unavailable. Your agent was not marked active.";
  }

  const detail = {
    correlation_id: context.correlationId,
    upstream_status: status,
    upstream_request_id: context.upstreamRequestId || null,
    retryable: status === 429 || status >= 500,
  };
  const error = httpError(statusCode, code, userMessage, detail);
  error.correlationId = context.correlationId;
  return error;
}

function retryAfterMs(response, attempt, baseMs) {
  const retryAfterHeader = response?.headers?.get?.("retry-after");
  if (retryAfterHeader !== null && retryAfterHeader !== undefined && retryAfterHeader !== "") {
    const retryAfter = Number(retryAfterHeader);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 5000);
  }
  return Math.min(baseMs * (2 ** Math.max(0, attempt - 1)), 5000);
}

function tripsVapiCircuit(error) {
  return error?.detail?.retryable === true
    || ["vapi_unreachable", "vapi_timeout", "vapi_unavailable", "vapi_rate_limited"].includes(error?.code);
}

function wait(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function recordVapiTelemetry(event) {
  const safe = safeVapiTelemetry(event);
  const line = JSON.stringify({ event: "answercrew_vapi_request", ...safe });
  if (event.status >= 400 || event.error_code) console.error(line);
  else if (event.operation !== "health") console.info(line);
  const persistenceTimeoutMs = Math.max(100, Math.min(Number(process.env.ANSWERCREW_TELEMETRY_TIMEOUT_MS) || 750, 2000));
  await Promise.race([
    recordEvent("answercrew_vapi_request", safe).catch(() => null),
    wait(persistenceTimeoutMs),
  ]);
}

async function responsePayload(response) {
  if (typeof response.text === "function") {
    const text = await response.text().catch(() => "");
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { message: text.slice(0, 2000) }; }
  }
  return typeof response.json === "function" ? response.json().catch(() => ({})) : {};
}

async function vapiRequest(path, options = {}) {
  const apiKey = clean(process.env.VAPI_API_KEY, 1000);
  const requestId = correlationId(options.correlationId);
  if (!apiKey) {
    const error = httpError(503, "vapi_auth_missing", "The voice service is not configured.", { correlation_id: requestId });
    error.correlationId = requestId;
    throw error;
  }
  if (!options.bypassCircuit && vapiCircuit.openUntil > Date.now()) {
    const error = httpError(503, "vapi_circuit_open", "The voice service is recovering. Please retry shortly.", {
      correlation_id: requestId,
      retry_after_seconds: Math.max(1, Math.ceil((vapiCircuit.openUntil - Date.now()) / 1000)),
    });
    error.correlationId = requestId;
    throw error;
  }

  const method = options.method || "GET";
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts || 3), 4));
  const baseMs = options.retryBaseMs === undefined ? 250 : Math.max(0, Number(options.retryBaseMs) || 0);
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs || process.env.ANSWERCREW_VAPI_TIMEOUT_MS) || 12_000, 20_000));
  const idempotencyKey = clean(options.idempotencyKey, 240);
  let finalError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.vapi.ai${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          "X-Correlation-Id": requestId,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      response = null;
      const timedOut = cause?.name === "TimeoutError" || cause?.name === "AbortError";
      finalError = httpError(503, timedOut ? "vapi_timeout" : "vapi_unreachable", timedOut
        ? "The voice service timed out. Your agent was not marked active."
        : "The voice service could not be reached. Your agent was not marked active.", {
        correlation_id: requestId,
        retryable: true,
        cause: timedOut ? "provider_timeout" : clean(cause?.message, 300),
      });
      finalError.correlationId = requestId;
    }

    if (response) {
      const payload = await responsePayload(response);
      const upstreamRequestId = clean(
        response.headers?.get?.("x-request-id") || response.headers?.get?.("request-id") || response.headers?.get?.("x-vapi-request-id"),
        240,
      );
      await recordVapiTelemetry({
        operation: options.operation || "request",
        correlation_id: requestId,
        method,
        path: telemetryPath(path),
        attempt,
        status: response.status,
        upstream_request_id: upstreamRequestId || null,
        idempotency_key_hash: idempotencyKey ? hashValue(idempotencyKey) : null,
        request_body: options.body || null,
        response_body: payload,
      });
      if (response.ok) {
        vapiCircuit.failures = 0;
        vapiCircuit.openUntil = 0;
        return payload;
      }
      finalError = vapiFailure(response.status, payload, {
        path,
        correlationId: requestId,
        upstreamRequestId,
      });
      if (!(response.status === 429 || response.status >= 500) || attempt === maxAttempts) break;
      await wait(retryAfterMs(response, attempt, baseMs));
      continue;
    }

    await recordVapiTelemetry({
      operation: options.operation || "request",
      correlation_id: requestId,
      method,
      path: telemetryPath(path),
      attempt,
      status: 503,
      error_code: finalError.code,
      idempotency_key_hash: idempotencyKey ? hashValue(idempotencyKey) : null,
      request_body: options.body || null,
    });
    if (attempt < maxAttempts) await wait(baseMs * (2 ** Math.max(0, attempt - 1)));
  }

  if (tripsVapiCircuit(finalError)) {
    vapiCircuit.failures += 1;
    if (vapiCircuit.failures >= 3) {
      vapiCircuit.openUntil = Date.now() + Math.max(5000, Number(process.env.ANSWERCREW_VAPI_CIRCUIT_MS) || 30_000);
    }
  }
  throw finalError || httpError(503, "vapi_unavailable", "The voice service is temporarily unavailable.", { correlation_id: requestId });
}

async function probeVapiHealth(options = {}) {
  if (!options.force && vapiHealthCache.value && vapiHealthCache.expiresAt > Date.now()) {
    return vapiHealthCache.value;
  }
  let value;
  try {
    await vapiRequest("/assistant?limit=1", {
      operation: "health",
      maxAttempts: 1,
      bypassCircuit: true,
      correlationId: options.correlationId,
    });
    value = { status: "healthy", reachable: true, code: null, checked_at: new Date().toISOString() };
  } catch (error) {
    value = {
      status: "degraded",
      reachable: false,
      code: error.code || "vapi_unavailable",
      correlation_id: error.correlationId || error.detail?.correlation_id || null,
      checked_at: new Date().toISOString(),
    };
  }
  vapiHealthCache = { expiresAt: Date.now() + 30_000, value };
  return value;
}

async function voiceHealth(req) {
  await customerContext(req, {}, false);
  return probeVapiHealth({ correlationId: requestCorrelationId(req) });
}

function resetVapiRuntimeStateForTests() {
  vapiCircuit.failures = 0;
  vapiCircuit.openUntil = 0;
  vapiHealthCache = { expiresAt: 0, value: null };
}

function autoProvisionVapiNumber() {
  return clean(process.env.ANSWERCREW_AUTO_PROVISION_VAPI_NUMBER, 20).toLowerCase() === "true";
}

function preferredPhoneAreaCode(profile = {}) {
  const explicit = clean(profile.phone_area_code, 12).replace(/\D/g, "");
  if (/^[2-9]\d{2}$/.test(explicit)) return explicit;

  const digits = clean(profile.owner_notification_phone, 40).replace(/\D/g, "");
  const nationalNumber = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  const inferred = nationalNumber.length === 10 ? nationalNumber.slice(0, 3) : "";
  return /^[2-9]\d{2}$/.test(inferred) ? inferred : "";
}

function persistedActivationError(error, correlationId, suffix = "") {
  const code = clean(error?.code || "voice_service_error", 120);
  const message = clean(error?.message || "The voice service could not complete that change.", 320);
  return clean(`${message}${suffix ? ` ${suffix}` : ""} Code: ${code}. Error ID: ${correlationId}`, 500);
}

function requireActivationPhonePath(row) {
  if (row.phone_number_id || autoProvisionVapiNumber()) return;
  throw httpError(
    409,
    "vapi_phone_number_required",
    "Choose or provision a business phone number before activating this agent.",
    { setup_step: "phone_number", can_auto_provision: false },
  );
}

async function provisionAgent(row, options = {}) {
  requireActivationPhonePath(row);
  const activationCorrelationId = correlationId(options.correlationId);
  let assistantId = clean(row.vapi_assistant_id, 240);
  let provisionedPhoneNumberId = clean(row.phone_number_id, 240);
  await patch("mission_control_agents", { id: `eq.${row.id}`, account_id: `eq.${row.account_id}` }, {
    status: "provisioning",
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  try {
    const subscription = await subscriptionFor(row.account_id);
    const plan = normalizedPlan(subscription?.plan || "solo");
    const experienceTier = voiceExperienceForPlan(plan);
    const config = assistantConfig(row, experienceTier);
    const assistantKey = `answercrew:assistant:${row.account_id}:${row.id}:${hashValue(JSON.stringify(config))}`;
    const assistant = assistantId
      ? await vapiRequest(`/assistant/${encodeURIComponent(assistantId)}`, {
          method: "PATCH",
          body: config,
          operation: "assistant_update",
          correlationId: activationCorrelationId,
          idempotencyKey: assistantKey,
        })
      : await vapiRequest("/assistant", {
          method: "POST",
          body: config,
          operation: "assistant_create",
          correlationId: activationCorrelationId,
          idempotencyKey: assistantKey,
        });
    assistantId = clean(assistant?.id || assistantId, 240);
    if (!assistantId) {
      throw httpError(502, "vapi_assistant_not_created", "The voice service did not confirm an assistant profile.", {
        correlation_id: activationCorrelationId,
      });
    }
    await patch("mission_control_agents", { id: `eq.${row.id}`, account_id: `eq.${row.account_id}` }, {
      vapi_assistant_id: assistantId,
      status: "provisioning",
      updated_at: new Date().toISOString(),
    });
    const phoneUpdate = await provisionInboundNumber({ ...row, vapi_assistant_id: assistantId }, assistantId, {
      correlationId: activationCorrelationId,
    });
    const phoneNumberId = clean(phoneUpdate.phone_number_id || row.phone_number_id, 240);
    if (!phoneNumberId) {
      throw httpError(409, "vapi_phone_number_required", "A business phone number must be connected before this agent can go active.", {
        correlation_id: activationCorrelationId,
        setup_step: "phone_number",
      });
    }
    provisionedPhoneNumberId = phoneNumberId;
    const updated = await patch("mission_control_agents", { id: `eq.${row.id}`, account_id: `eq.${row.account_id}` }, {
      vapi_assistant_id: assistantId,
      status: "active",
      last_error: null,
      business_profile: { ...(row.business_profile || {}), voice_experience: experienceTier },
      ...phoneUpdate,
      updated_at: new Date().toISOString(),
    });
    return updated?.[0] || { ...row, vapi_assistant_id: assistantId, status: "active", ...phoneUpdate };
  } catch (error) {
    let rollbackError = null;
    if (provisionedPhoneNumberId) {
      try {
        await vapiRequest(`/phone-number/${encodeURIComponent(provisionedPhoneNumberId)}`, {
          method: "PATCH",
          body: { assistantId: null },
          operation: "activation_rollback",
          correlationId: activationCorrelationId,
          idempotencyKey: `answercrew:activation-rollback:${row.account_id}:${row.id}:${provisionedPhoneNumberId}`,
          maxAttempts: 1,
        });
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
    }
    const rollbackStatus = assistantId ? (rollbackError ? "error" : "paused") : "draft";
    const lastError = persistedActivationError(
      error,
      activationCorrelationId,
      rollbackError ? "Provider rollback needs attention." : "",
    );
    await patch("mission_control_agents", { id: `eq.${row.id}`, account_id: `eq.${row.account_id}` }, {
      vapi_assistant_id: assistantId || row.vapi_assistant_id || null,
      status: rollbackStatus,
      last_error: clean(lastError, 500),
      updated_at: new Date().toISOString(),
    }).catch(() => null);
    error.correlationId = error.correlationId || activationCorrelationId;
    if (error.detail && !error.detail.correlation_id) error.detail.correlation_id = activationCorrelationId;
    throw error;
  }
}

async function pauseAgent(row, options = {}) {
  const pauseCorrelationId = correlationId(options.correlationId);
  const transitioning = await patch("mission_control_agents", {
    id: `eq.${row.id}`,
    account_id: `eq.${row.account_id}`,
    status: `eq.${row.status}`,
  }, {
    status: "provisioning",
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  if (!transitioning?.[0]) {
    throw httpError(409, "agent_transition_conflict", "This agent changed while the pause request was starting. Refresh and try again.", {
      correlation_id: pauseCorrelationId,
    });
  }
  try {
    if (row.phone_number_id) {
      await vapiRequest(`/phone-number/${encodeURIComponent(row.phone_number_id)}`, {
        method: "PATCH",
        body: { assistantId: null },
        operation: "agent_pause",
        correlationId: pauseCorrelationId,
        idempotencyKey: `answercrew:pause:${row.account_id}:${row.id}:${row.phone_number_id}:${pauseCorrelationId}`,
      });
    }
  } catch (error) {
    await patch("mission_control_agents", { id: `eq.${row.id}`, account_id: `eq.${row.account_id}` }, {
      status: "error",
      last_error: persistedActivationError(error, pauseCorrelationId),
      updated_at: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }
  const updated = await patch("mission_control_agents", {
    id: `eq.${row.id}`,
    account_id: `eq.${row.account_id}`,
    status: "eq.provisioning",
  }, {
    status: "paused",
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  if (!updated?.[0]) {
    throw httpError(409, "agent_transition_conflict", "The phone was paused, but the saved state changed. Refresh before taking another action.", {
      correlation_id: pauseCorrelationId,
    });
  }
  return updated?.[0] || { ...row, status: "paused", last_error: null };
}

async function resumeAgent(row, options = {}) {
  const resumeCorrelationId = correlationId(options.correlationId);
  const assistantId = clean(row.vapi_assistant_id, 240);
  const phoneNumberId = clean(row.phone_number_id, 240);
  if (!assistantId || !phoneNumberId) {
    throw httpError(409, "vapi_binding_required", "Connect an existing assistant and phone number before resuming this agent.", {
      correlation_id: resumeCorrelationId,
      setup_step: "phone_number",
    });
  }

  const transitioning = await patch("mission_control_agents", {
    id: `eq.${row.id}`,
    account_id: `eq.${row.account_id}`,
    status: `eq.${row.status}`,
  }, {
    status: "provisioning",
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  if (!transitioning?.[0]) {
    throw httpError(409, "agent_transition_conflict", "This agent changed while the resume request was starting. Refresh and try again.", {
      correlation_id: resumeCorrelationId,
    });
  }

  try {
    await vapiRequest(`/phone-number/${encodeURIComponent(phoneNumberId)}`, {
      method: "PATCH",
      body: { assistantId },
      operation: "agent_resume",
      correlationId: resumeCorrelationId,
      idempotencyKey: `answercrew:resume:${row.account_id}:${row.id}:${phoneNumberId}:${assistantId}:${resumeCorrelationId}`,
    });
  } catch (error) {
    await patch("mission_control_agents", { id: `eq.${row.id}`, account_id: `eq.${row.account_id}` }, {
      status: "error",
      last_error: persistedActivationError(error, resumeCorrelationId),
      updated_at: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }

  const updated = await patch("mission_control_agents", {
    id: `eq.${row.id}`,
    account_id: `eq.${row.account_id}`,
    status: "eq.provisioning",
  }, {
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  if (!updated?.[0]) {
    await vapiRequest(`/phone-number/${encodeURIComponent(phoneNumberId)}`, {
      method: "PATCH",
      body: { assistantId: null },
      operation: "agent_resume_rollback",
      correlationId: resumeCorrelationId,
      idempotencyKey: `answercrew:resume-rollback:${row.account_id}:${row.id}:${phoneNumberId}:${resumeCorrelationId}`,
      maxAttempts: 1,
    }).catch(() => null);
    await patch("mission_control_agents", {
      id: `eq.${row.id}`,
      account_id: `eq.${row.account_id}`,
      status: "eq.provisioning",
    }, {
      status: "paused",
      last_error: "Resume did not complete; the phone was paused again.",
      updated_at: new Date().toISOString(),
    }).catch(() => null);
    throw httpError(409, "agent_transition_conflict", "The phone resumed, but the saved state changed. The phone was paused again; refresh before retrying.", {
      correlation_id: resumeCorrelationId,
    });
  }
  return updated[0];
}

async function saveAgent(req, slot, body = {}, options = {}) {
  const context = await customerContext(req, body, Boolean(options.requireActive));
  const operationCorrelationId = requestCorrelationId(req);
  const key = clean(slot || body.slot_key || "agent-1", 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const existing = (await rows("mission_control_agents", { account_id: `eq.${context.account.id}`, slot_key: `eq.${key}`, limit: "1" }))[0];
  const transitionStartedAt = Date.parse(existing?.updated_at || "");
  if (options.provision && existing?.status === "provisioning" && Number.isFinite(transitionStartedAt) && Date.now() - transitionStartedAt < 120_000) {
    throw httpError(409, "agent_transition_in_progress", "This agent is already changing state. Wait a moment, then refresh.", {
      correlation_id: operationCorrelationId,
    });
  }
  const displayName = clean(body.display_name || body.name || existing?.display_name, 80) || "Alex";
  const current = await rows("mission_control_agents", { account_id: `eq.${context.account.id}`, select: "id" });
  const quota = context.subscription?.agent_quota || (context.subscription ? PLAN_CONFIG[normalizedPlan(context.subscription.plan)].quota : 1);
  if (!existing && current.length >= quota) throw httpError(409, "agent_quota_reached", `Your plan allows ${quota} agent${quota === 1 ? "" : "s"}`);
  const lifecycleOnly = existing
    && options.provision
    && typeof body.active === "boolean"
    && Object.keys(body).every((keyName) => keyName === "active");
  if (lifecycleOnly) {
    const row = body.active === false
      ? await pauseAgent(existing, { correlationId: operationCorrelationId })
      : (existing.vapi_assistant_id && existing.phone_number_id
          ? await resumeAgent(existing, { correlationId: operationCorrelationId })
          : await provisionAgent(existing, { correlationId: operationCorrelationId }));
    return { context, row, agent: agentForClient(row) };
  }
  const businessProfile = normalizeBusinessProfile({
    ...(existing?.business_profile || {}),
    ...body,
    agent_name: displayName,
    business_name: body.business_name || existing?.business_name || context.account.name,
    voice_id: body.voice_id || existing?.voice_id,
  }, { allowIncomplete: !options.provision });
  const core = buildAnswerCrewAssistantConfig(businessProfile, {
    accountId: context.account.id,
    allowIncomplete: !options.provision,
  });
  const saved = await upsert("mission_control_agents", {
    account_id: context.account.id,
    owner_user_id: context.user.id,
    slot_key: key,
    display_name: displayName,
    business_name: businessProfile.business_name,
    role_template: clean(body.role_template || body.template || existing?.role_template || "receptionist", 80),
    voice_id: businessProfile.voice_id,
    prompt: core.prompt,
    custom_instructions: clean(body.custom_instructions ?? existing?.custom_instructions, 4000),
    business_profile: businessProfile,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 20) : (existing?.capabilities || []),
    status: existing?.status || "draft",
    vapi_assistant_id: existing?.vapi_assistant_id || null,
    phone_number_id: existing?.phone_number_id || null,
    phone_number: existing?.phone_number || null,
    updated_at: new Date().toISOString(),
  }, "account_id,slot_key");
  let row = saved?.[0];
  if (!row) throw httpError(500, "agent_save_failed", "Could not save the agent");
  if (options.provision) {
    if (body.active === false) row = await pauseAgent(row, { correlationId: operationCorrelationId });
    else if (body.active === true || existing?.status === "active") {
      row = await provisionAgent(row, { correlationId: operationCorrelationId });
    }
  }
  return { context, row, agent: agentForClient(row) };
}

async function listAgents(req) {
  const context = await customerContext(req, {}, false);
  const data = await rows("mission_control_agents", { account_id: `eq.${context.account.id}`, order: "created_at.asc" });
  return { context, agents: data.map(agentForClient) };
}

async function ensureStripeCustomer(context) {
  const existing = clean(context.subscription?.stripe_customer_id, 120);
  if (existing) return existing;

  const params = new URLSearchParams();
  params.set("email", clean(context.user.email, 240));
  params.set("name", clean(context.account.name || context.user.email, 180));
  params.set("metadata[product]", "mission-control");
  params.set("metadata[account_id]", context.account.id);
  params.set("metadata[owner_user_id]", context.user.id);
  const customer = await stripeRequest("/customers", { method: "POST", body: params });
  if (!customer?.id) throw httpError(502, "stripe_customer_create_failed", "Stripe did not return a customer ID");
  return customer.id;
}

async function createCheckout(req, body = {}) {
  const context = await customerContext(req, body, false);
  const plan = normalizedPlan(body.plan);
  const annual = body.annual === true || body.cycle === "annual";
  const price = configuredPrice(plan, annual);
  let draft = null;
  if (body.agent_draft_id || body.agentDraftId) {
    draft = await ownedAgent(context.account.id, body.agent_draft_id || body.agentDraftId);
  }
  const stripeCustomerId = await ensureStripeCustomer(context);
  const origin = clean(process.env.MISSION_CONTROL_PUBLIC_URL || DEFAULT_ORIGIN, 500).replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}&plan=${encodeURIComponent(plan)}`);
  params.set("cancel_url", `${origin}/pricing`);
  params.set("line_items[0][price]", price.value);
  params.set("line_items[0][quantity]", "1");
  params.set("allow_promotion_codes", "true");
  params.set("payment_method_collection", "if_required");
  params.set("client_reference_id", context.account.id);
  params.set("customer", stripeCustomerId);
  params.set("metadata[product]", "mission-control");
  params.set("metadata[account_id]", context.account.id);
  params.set("metadata[owner_user_id]", context.user.id);
  params.set("metadata[plan]", plan);
  if (draft?.id) params.set("metadata[agent_draft_id]", draft.id);
  params.set("subscription_data[metadata][product]", "mission-control");
  params.set("subscription_data[metadata][account_id]", context.account.id);
  params.set("subscription_data[metadata][owner_user_id]", context.user.id);
  params.set("subscription_data[metadata][plan]", plan);
  if (draft?.id) params.set("subscription_data[metadata][agent_draft_id]", draft.id);
  const session = await stripeRequest("/checkout/sessions", { method: "POST", body: params });
  await upsert(CUSTOMER_SUBSCRIPTIONS_TABLE, {
    account_id: context.account.id,
    stripe_customer_id: session.customer || stripeCustomerId,
    stripe_subscription_id: context.subscription?.stripe_subscription_id || null,
    plan,
    status: "checkout_pending",
    minutes_included: PLAN_CONFIG[plan].minutes,
    agent_quota: PLAN_CONFIG[plan].quota,
    updated_at: new Date().toISOString(),
  }, "account_id");
  return { url: session.url, session_id: session.id, plan, annual, draft_id: draft?.id || null };
}

async function provisionInboundNumber(row, assistantId, options = {}) {
  if (row.phone_number_id) {
    const phone = await vapiRequest(`/phone-number/${encodeURIComponent(row.phone_number_id)}`, {
      method: "PATCH",
      body: { assistantId },
      operation: "phone_assign",
      correlationId: options.correlationId,
      idempotencyKey: `answercrew:phone-assign:${row.account_id}:${row.id}:${row.phone_number_id}:${assistantId}`,
    });
    return {
      phone_number_id: phone.id || row.phone_number_id,
      phone_number: clean(phone.number || row.phone_number, 80) || null,
    };
  }
  if (!autoProvisionVapiNumber()) return {};

  const body = {
    provider: "vapi",
    assistantId,
    name: clean(`AnswerCrew ${row.account_id.slice(0, 8)} ${row.display_name}`, 80),
  };
  const areaCode = preferredPhoneAreaCode(row.business_profile);
  if (!areaCode) {
    throw httpError(409, "vapi_phone_area_code_required", "Add a preferred three-digit phone area code before activating this agent.", {
      setup_step: "phone_area_code",
    });
  }
  body.numberDesiredAreaCode = areaCode;
  const phone = await vapiRequest("/phone-number", {
    method: "POST",
    body,
    operation: "phone_create",
    correlationId: options.correlationId,
    idempotencyKey: `answercrew:phone-create:${row.account_id}:${row.id}:${areaCode || "any"}`,
  });
  if (!phone?.id) throw httpError(502, "vapi_phone_number_failed", "Vapi did not return a phone number");
  return {
    phone_number_id: phone.id,
    phone_number: clean(phone.number, 80) || null,
  };
}

async function lockCustomerVoiceResources(accountId) {
  const agents = await rows("mission_control_agents", { account_id: `eq.${accountId}` });
  for (const agent of agents) {
    if (agent.phone_number_id) {
      await vapiRequest(`/phone-number/${encodeURIComponent(agent.phone_number_id)}`, {
        method: "PATCH",
        body: { assistantId: null },
      }).catch(() => null);
    }
  }
  await patch("mission_control_agents", { account_id: `eq.${accountId}` }, {
    status: "disabled",
    updated_at: new Date().toISOString(),
  });
  return { mode: "customer_voice_locked", agents: agents.length };
}

async function createCustomerPortal(req, body = {}) {
  const context = await customerContext(req, body, false);
  if (!context.subscription?.stripe_customer_id) {
    throw httpError(404, "stripe_customer_missing", "No Stripe customer is attached to this account");
  }
  const params = new URLSearchParams();
  params.set("customer", context.subscription.stripe_customer_id);
  params.set("return_url", safePortalReturnUrl(body.return_url));
  const session = await stripeRequest("/billing_portal/sessions", { method: "POST", body: params });
  return { url: session.url, account_id: context.account.id };
}

async function upsertStripeSubscription(subscription, fallback = {}) {
  let accountId = clean(subscription?.metadata?.account_id || fallback.account_id, 120) || null;
  if (!accountId && subscription?.id) {
    const existing = await rows(CUSTOMER_SUBSCRIPTIONS_TABLE, {
      stripe_subscription_id: `eq.${subscription.id}`,
      limit: "1",
    });
    accountId = existing[0]?.account_id || null;
  }
  if (!accountId && subscription?.customer) {
    const existing = await rows(CUSTOMER_SUBSCRIPTIONS_TABLE, {
      stripe_customer_id: `eq.${subscription.customer}`,
      limit: "1",
    });
    accountId = existing[0]?.account_id || null;
  }
  if (!accountId) return { mode: "customer_subscription_skipped", reason: "account_id_missing" };

  const plan = normalizedPlan(subscription?.metadata?.plan || fallback.plan || "solo");
  const saved = await upsert(CUSTOMER_SUBSCRIPTIONS_TABLE, {
    account_id: accountId,
    stripe_customer_id: subscription?.customer || fallback.stripe_customer_id || null,
    stripe_subscription_id: subscription?.id || fallback.stripe_subscription_id || null,
    plan,
    status: clean(subscription?.status || fallback.status || "unknown", 80),
    current_period_end: subscription?.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    minutes_included: PLAN_CONFIG[plan].minutes,
    agent_quota: PLAN_CONFIG[plan].quota,
    updated_at: new Date().toISOString(),
  }, "account_id");
  const status = clean(subscription?.status || fallback.status || "unknown", 80).toLowerCase();
  const voice = LOCKED_SUBSCRIPTION_STATUSES.has(status)
    ? await lockCustomerVoiceResources(accountId)
    : { mode: "unchanged" };
  return { mode: "customer_subscription_upserted", account_id: accountId, row: saved?.[0] || null, voice };
}

async function isKnownLegacyCustomerSubscription(subscription = {}) {
  const subscriptionId = clean(subscription?.id, 120);
  if (!subscriptionId) return false;
  const existing = await rows(CUSTOMER_SUBSCRIPTIONS_TABLE, {
    stripe_subscription_id: `eq.${subscriptionId}`,
    limit: "1",
  });
  return existing.some((row) => clean(row.stripe_subscription_id, 120) === subscriptionId);
}

async function handleCustomerStripeEvent(event = {}) {
  const type = clean(event.type, 120);
  const object = event.data?.object || {};
  if (type === "checkout.session.completed") {
    if (object.metadata?.product !== "mission-control") {
      return { mode: "not_answercrew_customer_checkout" };
    }
    const subscription = typeof object.subscription === "object"
      ? object.subscription
      : object.subscription
        ? await stripeRequest(`/subscriptions/${encodeURIComponent(object.subscription)}`)
        : null;
    if (!subscription) {
      return { mode: "customer_checkout_recorded_without_subscription", session_id: object.id || null };
    }
    return upsertStripeSubscription(subscription, {
      account_id: object.metadata?.account_id,
      plan: object.metadata?.plan,
      stripe_customer_id: object.customer,
    });
  }
  if (type.startsWith("customer.subscription.")) {
    const product = clean(object.metadata?.product, 120);
    const knownLegacy = !product && await isKnownLegacyCustomerSubscription(object);
    if (product !== "mission-control" && !knownLegacy) {
      return { mode: "not_answercrew_customer_subscription" };
    }
    return upsertStripeSubscription(object);
  }
  return { mode: "customer_commerce_event_ignored", type };
}

async function billingSummary(req) {
  const context = await customerContext(req, {}, false);
  const subscription = context.subscription;
  const agents = await rows("mission_control_agents", {
    account_id: `eq.${context.account.id}`,
    status: "eq.active",
    select: "id",
  });
  if (!isActiveSubscription(subscription)) {
    return {
      plan: null,
      status: "inactive",
      subscription_status: clean(subscription?.status, 80).toLowerCase() || null,
      active_subscription: false,
      minutes_used: null,
      minutes_included: null,
      agents_active: agents.length,
      next_invoice_at: null,
      next_invoice_amount: null,
      customer_email: context.user.email || "",
      overage_policy: "hard_cap",
      automatic_overage_billing: false,
    };
  }
  const refreshed = await refreshAccountUsage(context.account.id, subscription);
  return {
    plan: normalizedPlan(refreshed.subscription.plan),
    status: clean(refreshed.subscription.status, 80) || "inactive",
    active_subscription: true,
    internal_access_role: refreshed.usage.internal_access_role,
    unlimited_minutes: refreshed.usage.unlimited_minutes,
    voice_experience: refreshed.usage.voice_experience,
    minutes_used: refreshed.usage.minutes_used,
    minutes_included: refreshed.usage.minutes_included,
    agents_active: agents.length,
    next_invoice_at: refreshed.subscription.current_period_end || null,
    next_invoice_amount: null,
    customer_email: context.user.email || "",
    overage_policy: "hard_cap",
    automatic_overage_billing: false,
  };
}

async function activateCheckout(req, body = {}) {
  const context = await customerContext(req, body, false);
  const sessionId = clean(body.session_id || body.sessionId, 240);
  if (!sessionId) throw httpError(400, "session_id_required", "Stripe session_id is required");
  const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`);
  if (session.metadata?.product !== "mission-control") throw httpError(400, "invalid_checkout", "This is not a Mission Control checkout");
  if (String(session.metadata?.owner_user_id) !== String(context.user.id) || String(session.metadata?.account_id) !== String(context.account.id)) {
    throw httpError(403, "checkout_forbidden", "This checkout belongs to another account");
  }
  const subscription = typeof session.subscription === "object" ? session.subscription : null;
  if (!subscription || !isActiveSubscription(subscription)) {
    throw httpError(409, "subscription_not_active", "Stripe has not confirmed an active subscription yet", { status: subscription?.status || session.status });
  }
  const plan = normalizedPlan(subscription.metadata?.plan || session.metadata?.plan);
  const saved = await upsert(CUSTOMER_SUBSCRIPTIONS_TABLE, {
    account_id: context.account.id,
    stripe_customer_id: session.customer || subscription.customer || null,
    stripe_subscription_id: subscription.id,
    plan,
    status: subscription.status,
    current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    minutes_included: PLAN_CONFIG[plan].minutes,
    agent_quota: PLAN_CONFIG[plan].quota,
    updated_at: new Date().toISOString(),
  }, "account_id");
  let agent = null;
  let agentProvisioning = null;
  const draftId = session.metadata?.agent_draft_id || subscription.metadata?.agent_draft_id;
  if (draftId) {
    const draft = await ownedAgent(context.account.id, draftId);
    const readiness = businessProfileStatus(draft.business_profile);
    if (readiness.complete) {
      agent = agentForClient(await provisionAgent(draft));
      agentProvisioning = { status: "active", missing_profile_fields: [] };
    } else {
      agentProvisioning = {
        status: "profile_required",
        missing_profile_fields: readiness.missing,
      };
    }
  }
  return { subscription: saved?.[0] || null, agent, agent_provisioning: agentProvisioning };
}

async function ensureCallAuthorized(phone, options = {}) {
  const normalized = clean(phone, 80).replace(/[^+\d]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw httpError(400, "invalid_phone", "Use an E.164 phone number such as +14155551234");
  const suppression = await rows("ghost_agency_suppressions", { suppression_key: `eq.${normalized}`, limit: "1" });
  if (suppression[0]) throw httpError(409, "contact_suppressed", "This number is suppressed and cannot be called");
  const consent = await rows("consent_registrar", { consent_key: `eq.phone:${normalized}`, limit: "1" });
  if (consent[0] && consent[0].consent_to_call === false) throw httpError(409, "call_consent_revoked", "Call consent has been revoked for this number");
  if (!consent[0]?.consent_to_call && options.selfTestConsent !== true) {
    throw httpError(409, "call_consent_required", "Call consent is required before dialing this number");
  }
  return {
    phone: normalized,
    consent_mode: consent[0]?.consent_to_call ? "registrar" : "authenticated_self_test",
  };
}

async function testAgent(req, slot, body = {}) {
  const context = await customerContext(req, body, true);
  const testCorrelationId = requestCorrelationId(req);
  const refreshed = await refreshAccountUsage(context.account.id, context.subscription);
  enforceMinuteQuota(refreshed.subscription);
  let agent = await ownedAgent(context.account.id, slot);
  if (!agent.vapi_assistant_id || agent.status !== "active") {
    agent = await provisionAgent(agent, { correlationId: testCorrelationId });
  }
  const authorization = await ensureCallAuthorized(body.phone_number || body.phone, {
    selfTestConsent: body.test_call_consent === true,
  });
  const phone = authorization.phone;
  const ownerPhone = context.account.owner_notification_phone
    ? customerSms.normalizePhone(context.account.owner_notification_phone, "owner notification phone")
    : "";
  const ownerPracticeCall = body.test_call_consent === true;
  if (ownerPracticeCall && (!ownerPhone || phone !== ownerPhone)) {
    throw httpError(403, "owner_practice_destination_required", "Owner practice calls require the authenticated owner's structured phone");
  }
  const phoneNumberId = clean(agent.phone_number_id || process.env.VAPI_PHONE_NUMBER_ID, 240);
  if (!phoneNumberId) throw httpError(503, "vapi_phone_number_not_configured", "VAPI_PHONE_NUMBER_ID is not configured");
  const callBody = {
    assistantId: agent.vapi_assistant_id,
    phoneNumberId,
    customer: { number: phone, name: clean(body.customer_name || context.user.email, 120) || "Account owner" },
  };
  if (ownerPracticeCall) {
    const practiceAgentName = clean(agent.display_name, 80) || "your AnswerCrew agent";
    callBody.assistantOverrides = {
      firstMessage: `Hi, this is ${practiceAgentName} from AnswerCrew. You requested this practice call. What would you like to test?`,
      firstMessageMode: "assistant-waits-for-user",
      variableValues: {
        ownerName: clean(body.customer_name, 120) || "account owner",
        businessName: clean(agent.business_name, 160) || "your business",
        callDirection: "outbound",
        callPurpose: "authenticated owner practice call",
      },
      artifactPlan: {
        recordingEnabled: true,
        loggingEnabled: false,
        pcapEnabled: false,
        transcriptPlan: { enabled: true },
      },
    };
  }
  const call = await vapiRequest("/call", {
    method: "POST",
    body: callBody,
    operation: "owner_test_call",
    correlationId: testCorrelationId,
    idempotencyKey: `answercrew:test-call:${context.account.id}:${agent.id}:${hashValue(phone)}:${hashValue(clean(body.idempotency_key || req.headers?.["idempotency-key"], 240) || testCorrelationId)}`,
  });
  await upsert("mission_control_customer_calls", {
    account_id: context.account.id,
    agent_id: agent.id,
    vapi_call_id: call.id,
    direction: "outbound",
    customer_number: phone,
    status: call.status || "queued",
    payload: {
      id: call.id,
      assistantId: call.assistantId,
      status: call.status,
      consent_mode: authorization.consent_mode,
      owner_practice_call: ownerPracticeCall,
    },
    recording_consent_enabled: ownerPracticeCall,
    recording_consent_mode: ownerPracticeCall ? "authenticated_owner_test_call" : null,
    recording_url: clean(call.artifact?.recording, 2000) || null,
    artifact_retention_expires_at: clean(call.artifact?.recording, 2000) ? retentionExpiresAt(call) : null,
    updated_at: new Date().toISOString(),
  }, "account_id,vapi_call_id");
  return { call_id: call.id, status: call.status || "queued" };
}

function mapStoredCall(call, agentById, subscription) {
  const agent = agentById.get(call.agent_id) || {};
  const payload = call.payload && typeof call.payload === "object" ? call.payload : {};
  const score = Number(payload.manual_score ?? payload.analysis?.successEvaluation);
  const rawStatus = clean(call.status, 80).toLowerCase();
  const endedReason = clean(payload.endedReason || payload.ended_reason, 160).toLowerCase();
  const voicemail = endedReason.includes("voicemail");
  const status = voicemail
    ? "voicemail"
    : rawStatus === "ended"
      ? "completed"
      : rawStatus === "in-progress"
        ? "in_progress"
        : rawStatus || "unknown";
  const outcome = clean(payload.analysis?.structuredData?.outcome, 80).toLowerCase() || (voicemail ? "voicemail" : status);
  const artifacts = mapCallArtifacts(call, subscription, call.recording_consent_enabled === true || agent.recording_consent_enabled === true);
  return {
    id: call.id,
    call_id: call.vapi_call_id,
    agent: agent.slot_key || "agent",
    agent_name: clean(agent.display_name, 80) || null,
    phone_number: call.customer_number || "",
    business_name: agent.business_name || "",
    status,
    provider_status: clean(payload.providerStatus || payload.provider_status, 80).toLowerCase() || null,
    ended_reason: endedReason || null,
    outcome,
    is_practice_call: call.recording_consent_mode === "authenticated_owner_test_call" || payload.owner_practice_call === true,
    duration: Math.max(0, Number(call.duration_seconds) || 0),
    quality_score: Number.isFinite(score) ? score : null,
    report_sent: false,
    transferred: Boolean(payload.analysis?.structuredData?.transferred),
    callback_scheduled: ["booked", "callback_requested"].includes(String(payload.analysis?.structuredData?.outcome || "")),
    transcript: artifacts.transcript.available ? artifacts.transcript.value : null,
    summary: artifacts.summary.available ? artifacts.summary.value : null,
    action_items: artifacts.action_items.available ? artifacts.action_items.value : [],
    recording: artifacts.recording,
    artifact_present: artifacts.artifact_present,
    artifact_entitlement: artifacts.entitlement,
    retention_expires_at: artifacts.retention_expires_at,
    created_at: call.started_at || call.created_at || new Date().toISOString(),
    completed_at: call.ended_at || null,
  };
}

async function listCalls(req) {
  const context = await customerContext(req, {}, false);
  const agents = await rows("mission_control_agents", { account_id: `eq.${context.account.id}` });
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const stored = await rows("mission_control_customer_calls", {
    account_id: `eq.${context.account.id}`,
    order: "created_at.desc",
    limit: "100",
  });
  const calls = stored.map((call) => mapStoredCall(call, agentById, context.subscription));
  return { context, calls };
}

async function ownedCall(context, callId) {
  const key = clean(callId, 240);
  const byId = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(key)
    ? await rows("mission_control_customer_calls", { account_id: `eq.${context.account.id}`, id: `eq.${key}`, limit: "1" })
    : [];
  const found = byId[0] || (await rows("mission_control_customer_calls", {
    account_id: `eq.${context.account.id}`,
    vapi_call_id: `eq.${key}`,
    limit: "1",
  }))[0];
  if (!found) throw httpError(404, "call_not_found", "Call not found");
  return found;
}

async function callForClient(req, callId) {
  const context = await customerContext(req, {}, false);
  const call = await ownedCall(context, callId);
  const agent = (await rows("mission_control_agents", {
    account_id: `eq.${context.account.id}`,
    id: `eq.${call.agent_id}`,
    limit: "1",
  }))[0];
  return mapStoredCall(call, new Map(agent ? [[agent.id, agent]] : []), context.subscription);
}

async function callAnalysis(req, callId) {
  const context = await customerContext(req, {}, false);
  const call = await ownedCall(context, callId);
  const agent = (await rows("mission_control_agents", {
    account_id: `eq.${context.account.id}`,
    id: `eq.${call.agent_id}`,
    limit: "1",
  }))[0] || {};
  const artifacts = mapCallArtifacts(call, context.subscription, call.recording_consent_enabled === true || agent.recording_consent_enabled === true);
  const analysis = call.payload?.analysis || {};
  const structured = analysis.structuredData || {};
  const score = Number(call.payload?.manual_score ?? analysis.successEvaluation);
  const sentiment = ["positive", "neutral", "negative"].includes(structured.sentiment)
    ? structured.sentiment
    : "neutral";
  return {
    sentiment,
    vak_type: ["visual", "auditory", "kinesthetic"].includes(structured.vak_type) ? structured.vak_type : "auditory",
    suggested_score: Number.isFinite(score) ? score : 0,
    key_moments: artifacts.summary.available && Array.isArray(structured.key_moments) ? structured.key_moments.slice(0, 30) : [],
    objections_detected: artifacts.summary.available && Array.isArray(structured.objections_detected) ? structured.objections_detected.slice(0, 20) : [],
    techniques_used: artifacts.summary.available && Array.isArray(structured.techniques_used) ? structured.techniques_used.slice(0, 20) : [],
    summary: artifacts.summary.available ? artifacts.summary.value || "" : "",
    action_items: artifacts.action_items.available ? artifacts.action_items.value : [],
    artifact_entitlement: artifacts.entitlement,
    retention_expires_at: artifacts.retention_expires_at,
  };
}

async function recordingContext(req, callId) {
  const context = await customerContext(req, {}, false);
  const call = await ownedCall(context, callId);
  const agent = (await rows("mission_control_agents", {
    account_id: `eq.${context.account.id}`,
    id: `eq.${call.agent_id}`,
    limit: "1",
  }))[0] || {};
  return {
    context,
    call,
    artifacts: mapCallArtifacts(call, context.subscription, call.recording_consent_enabled === true || agent.recording_consent_enabled === true),
  };
}

async function listRecordings(req) {
  const result = await listCalls(req);
  return {
    retention_policy: "fixed_14_day_vapi_build_retention",
    extended_retention_available: false,
    recordings: result.calls.filter((call) => call.artifact_present).map((call) => ({
      id: call.id,
      call_id: call.call_id,
      created_at: call.created_at,
      retention_expires_at: call.retention_expires_at,
      recording: call.recording,
      transcript_available: Boolean(call.transcript),
      summary_available: Boolean(call.summary),
      action_items_available: Array.isArray(call.action_items) && call.action_items.length > 0,
    })),
  };
}

async function recordingDetail(req, callId) {
  const { call, artifacts } = await recordingContext(req, callId);
  if (!artifacts.artifact_present) throw httpError(404, "call_artifact_not_found", "No call artifact exists");
  return {
    call_id: call.vapi_call_id,
    retention_expires_at: artifacts.retention_expires_at,
    artifact_entitlement: artifacts.entitlement,
    recording: artifacts.recording,
    transcript: artifacts.transcript,
    summary: artifacts.summary,
    action_items: artifacts.action_items,
  };
}

async function recordingPlayback(req, callId) {
  const { call, artifacts } = await recordingContext(req, callId);
  if (!artifacts.entitlement.included) throw httpError(402, "subscription_required", "An active paid plan is required to access call artifacts");
  if (!artifacts.entitlement.recording_included) throw httpError(403, "recording_consent_required", "Recording disclosure and consent are not configured for this account");
  if (artifacts.expired) throw httpError(410, "recording_retention_expired", "This recording is outside the 14-day customer access window", { retention_expires_at: artifacts.retention_expires_at });

  let playbackUrl = "";
  try {
    const liveCall = await vapiRequest(`/call/${encodeURIComponent(call.vapi_call_id)}`);
    const liveUrl = liveCall?.artifact?.recording;
    const parsed = liveUrl ? new URL(String(liveUrl)) : null;
    if (parsed?.protocol === "https:") playbackUrl = parsed.toString();
  } catch {
    const storedUrl = artifacts.recording.playback_url;
    try {
      const parsed = storedUrl ? new URL(String(storedUrl)) : null;
      if (parsed?.protocol === "https:") {
        const probe = await fetch(parsed, { method: "HEAD" });
        if (probe.ok) playbackUrl = parsed.toString();
      }
    } catch {
      playbackUrl = "";
    }
  }
  if (!playbackUrl) throw httpError(404, "recording_url_not_available", "The provider did not return a live recording URL");
  return { available: true, playback_url: playbackUrl, retention_expires_at: artifacts.retention_expires_at };
}

async function scoreCall(req, callId, body = {}) {
  const context = await customerContext(req, {}, false);
  const call = await ownedCall(context, callId);
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw httpError(400, "invalid_score", "Score must be a whole number from 0 to 100");
  }
  const updated = await patch("mission_control_customer_calls", {
    account_id: `eq.${context.account.id}`,
    id: `eq.${call.id}`,
  }, {
    payload: { ...(call.payload || {}), manual_score: score },
    updated_at: new Date().toISOString(),
  });
  return { ok: true, call: updated?.[0] || null };
}

function metrics(calls) {
  const now = Date.now();
  const windowStats = (days) => {
    const selected = calls.filter((call) => now - new Date(call.created_at).getTime() <= days * 86400000);
    const durations = selected.map((call) => Number(call.duration || 0));
    const scores = selected.map((call) => Number(call.quality_score)).filter(Number.isFinite);
    return {
      calls: selected.length,
      duration_avg: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      quality_avg: scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)) : 0,
    };
  };
  return { today: windowStats(1), week: windowStats(7), month: windowStats(30), recent_calls: calls.slice(0, 10) };
}

async function listHotLeads(context) {
  const data = await rows("hot_leads", { account_id: `eq.${context.account.id}`, order: "last_opened_at.desc", limit: "100" });
  return data.map((lead) => ({
    ...lead,
    business_name: lead.business_name || lead.business,
    opened_at: lead.opened_at || lead.last_opened_at,
    consent_call: Boolean(lead.consent_to_call),
    consent_sms: Boolean(lead.consent_to_text),
  }));
}

function safeCustomerLead(lead = {}) {
  const payload = lead.payload && typeof lead.payload === "object" ? lead.payload : {};
  const rawStatus = clean(lead.status, 80).toLowerCase();
  const statusAliases = {
    hot_lead_consent_ready: "new",
    hot_lead_consent_blocked: "new",
    hot_lead_opted_out: "dnc",
  };
  const allowedStatuses = new Set([
    "new", "imported", "called", "connected", "transferred", "voicemail", "no_answer",
    "call_failed", "contacted", "converted", "resolved", "dnc", "invalid",
  ]);
  const status = statusAliases[rawStatus] || (allowedStatuses.has(rawStatus) ? rawStatus : "new");
  const revoked = status === "dnc" || /(?:revok|stop|unsubscribe|opt.?out)/i.test(clean(lead.consent_source, 120));
  const consent = revoked ? "revoked" : lead.consent_to_call === true ? "granted" : "pending";
  return {
    id: clean(lead.id, 160),
    prospect_id: lead.prospect_id || null,
    report_id: lead.report_id || null,
    business_name: clean(lead.business_name || lead.business, 300),
    phone: clean(lead.phone, 80),
    website: clean(lead.website || lead.website_url || payload.website || payload.website_url, 1000),
    city: clean(lead.city || payload.city, 160),
    category: clean(lead.category || payload.category || payload.trade, 160),
    email: clean(lead.email || lead.owner_email, 320),
    contact_name: clean(lead.contact_name || lead.owner_name || payload.contact_name, 240),
    custom_data: {},
    tags: [],
    status,
    campaign_id: null,
    last_called_at: lead.last_called_at || null,
    call_count: Number.isFinite(Number(lead.call_count)) ? Number(lead.call_count) : 0,
    consent,
    report_opened_at: lead.opened_at || lead.last_opened_at || null,
    opened_at: lead.opened_at || lead.last_opened_at || null,
    last_opened_at: lead.last_opened_at || null,
    consent_to_call: lead.consent_to_call === true,
    consent_to_text: lead.consent_to_text === true,
    consent_source: lead.consent_source || null,
    created_at: lead.created_at || null,
    updated_at: lead.updated_at || null,
  };
}

async function listCustomerLeads(context, searchParams = new URLSearchParams()) {
  const stored = await rows("hot_leads", {
    account_id: `eq.${context.account.id}`,
    order: "last_opened_at.desc.nullslast,updated_at.desc",
    limit: "500",
  });
  const status = clean(searchParams.get("status"), 80).toLowerCase();
  const search = clean(searchParams.get("search"), 160).toLowerCase();
  const offset = Math.max(0, Math.min(Number(searchParams.get("offset")) || 0, 10_000));
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 100, 200));
  const mapped = stored.map(safeCustomerLead).filter((lead) => {
    if (status && lead.status !== status) return false;
    if (!search) return true;
    return [lead.business_name, lead.contact_name, lead.email, lead.phone, lead.city]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
  return { leads: mapped.slice(offset, offset + limit), total: mapped.length };
}

function gatewayTarget(req, body = {}) {
  const url = new URL(req.url || "/", "https://mission-control.invalid");
  const raw = clean(url.searchParams.get("path") || body.path, 1000);
  const target = new URL(raw || "/", "https://gateway.invalid");
  return { path: target.pathname, searchParams: target.searchParams };
}

async function gateway(req, body = {}) {
  const target = gatewayTarget(req, body);
  const path = target.path;
  if (!path.startsWith("/api/")) throw httpError(400, "invalid_gateway_path", "Gateway path must begin with /api/");

  if (req.method === "GET" && path === "/api/agents") return (await listAgents(req)).agents;
  if (req.method === "GET" && path === "/api/voice/health") return voiceHealth(req);
  if (req.method === "GET" && path === "/api/voices") {
    await customerContext(req, {}, false);
    return voiceCatalog();
  }
  if (req.method === "GET" && path === "/api/calls") return (await listCalls(req)).calls;
  if (req.method === "GET" && path === "/api/recordings") return listRecordings(req);
  const recordingPlaybackMatch = path.match(/^\/api\/recordings\/([^/]+)\/playback$/);
  if (req.method === "GET" && recordingPlaybackMatch) return recordingPlayback(req, decodeURIComponent(recordingPlaybackMatch[1]));
  const recordingDetailMatch = path.match(/^\/api\/recordings\/([^/]+)$/);
  if (req.method === "GET" && recordingDetailMatch) return recordingDetail(req, decodeURIComponent(recordingDetailMatch[1]));
  const callMatch = path.match(/^\/api\/calls\/(?!live$|send$)([^/]+)$/);
  if (req.method === "GET" && callMatch) return callForClient(req, decodeURIComponent(callMatch[1]));
  const callScoreMatch = path.match(/^\/api\/calls\/([^/]+)\/score$/);
  if (req.method === "POST" && callScoreMatch) return scoreCall(req, decodeURIComponent(callScoreMatch[1]), body);
  const callAnalysisMatch = path.match(/^\/api\/calls\/([^/]+)\/analysis$/);
  if (req.method === "GET" && callAnalysisMatch) return callAnalysis(req, decodeURIComponent(callAnalysisMatch[1]));
  if (req.method === "POST" && path === "/api/calls/send") {
    return testAgent(req, body.agent, body);
  }
  if (req.method === "GET" && path === "/api/calls/live") {
    await customerContext(req, {}, false);
    return [];
  }
  if (req.method === "GET" && path.startsWith("/api/metrics/overview")) {
    const result = await listCalls(req);
    return metrics(result.calls);
  }
  if (req.method === "GET" && path.startsWith("/api/metrics/timeline")) {
    await customerContext(req, {}, true);
    return [];
  }
  if (req.method === "GET" && path === "/api/metrics/ab-test") {
    await customerContext(req, {}, true);
    const empty = { total_calls: 0, avg_duration: 0, avg_quality: 0, report_sent_rate: 0, transfer_rate: 0, callback_rate: 0 };
    return { kelly: empty, mike: empty, winner: null, confidence: 0 };
  }
  if (req.method === "GET" && path.startsWith("/api/hot-leads")) {
    const context = await customerContext(req, {}, true);
    return { ok: true, leads: await listHotLeads(context) };
  }
  if (req.method === "GET" && path.startsWith("/api/leads/stats")) {
    await customerContext(req, {}, true);
    return { total: 0, by_status: {}, by_campaign: [] };
  }
  if (req.method === "GET" && path.startsWith("/api/leads")) {
    const context = await customerContext(req, {}, true);
    return listCustomerLeads(context, target.searchParams);
  }
  const leadMatch = path.match(/^\/api\/leads\/([^/]+)$/);
  if (req.method === "PUT" && leadMatch) {
    const context = await customerContext(req, body, true);
    const status = clean(body.status, 80).toLowerCase();
    const allowedStatuses = new Set([
      "new", "imported", "called", "connected", "transferred", "voicemail", "no_answer",
      "call_failed", "contacted", "converted", "resolved", "dnc", "invalid",
    ]);
    if (!allowedStatuses.has(status)) throw httpError(400, "invalid_lead_status", "Choose a supported lead status");
    const updated = await patch("hot_leads", {
      id: `eq.${decodeURIComponent(leadMatch[1])}`,
      account_id: `eq.${context.account.id}`,
    }, { status, updated_at: new Date().toISOString() });
    if (!updated?.[0]) throw httpError(404, "lead_not_found", "Lead not found");
    return safeCustomerLead(updated[0]);
  }
  if (req.method === "GET" && path.startsWith("/api/campaigns")) {
    await customerContext(req, {}, true);
    return [];
  }
  if (req.method === "GET" && path === "/api/sms/conversations") {
    const context = await customerContext(req, {}, true);
    return { ok: true, conversations: await customerSms.listConversations(context) };
  }
  const smsMessagesMatch = path.match(/^\/api\/sms\/conversations\/([^/]+)\/messages$/);
  if (req.method === "GET" && smsMessagesMatch) {
    const context = await customerContext(req, {}, true);
    return { ok: true, ...(await customerSms.listMessages(context, decodeURIComponent(smsMessagesMatch[1]))) };
  }
  if (req.method === "GET" && path === "/api/sms/messages") {
    const context = await customerContext(req, {}, true);
    const conversationId = clean(target.searchParams.get("conversation_id") || target.searchParams.get("conversationId"), 160);
    if (!conversationId) throw httpError(400, "sms_conversation_required", "conversation_id is required");
    return { ok: true, ...(await customerSms.listMessages(context, conversationId)) };
  }
  if (req.method === "POST" && path === "/api/sms/conversations") {
    const context = await customerContext(req, body, true);
    return { ok: true, conversation: await customerSms.createConversation(context, body) };
  }
  const smsConsentMatch = path.match(/^\/api\/sms\/conversations\/([^/]+)\/consent$/);
  if (req.method === "POST" && smsConsentMatch) {
    const context = await customerContext(req, body, true);
    const conversation = await customerSms.listMessages(context, decodeURIComponent(smsConsentMatch[1]));
    return { ok: true, conversation: await customerSms.createConversation(context, { ...body, phone: conversation.conversation.customer_phone }) };
  }
  const smsSendMatch = path.match(/^\/api\/sms\/conversations\/([^/]+)\/messages$/);
  if (req.method === "POST" && smsSendMatch) {
    const context = await customerContext(req, body, true);
    return customerSms.sendCustomerSms(context, body, decodeURIComponent(smsSendMatch[1]));
  }
  if (req.method === "POST" && (path === "/api/sms/send" || path === "/api/sms/messages")) {
    const context = await customerContext(req, body, true);
    return customerSms.sendCustomerSms(context, body, body.conversation_id || body.conversationId);
  }
  if (req.method === "POST" && path === "/api/sms/demo") {
    const context = await customerContext(req, body, true);
    return customerSms.ownerDemo(context, body);
  }
  if (path.startsWith("/api/sms/")) {
    await customerContext(req, {}, true);
    throw httpError(404, "sms_route_not_found", "SMS route not found");
  }
  if (req.method === "GET" && path === "/api/billing/summary") {
    return billingSummary(req);
  }
  if (req.method === "GET" && path === "/api/billing/balance") {
    const context = await customerContext(req, {}, false);
    if (!isActiveSubscription(context.subscription)) return inactiveBalanceState(context.subscription);
    const { usage } = await refreshAccountUsage(context.account.id, context.subscription);
    return {
      status: "active",
      active_subscription: true,
      balance: usage.minutes_remaining,
      currency: "minutes",
      calls_remaining_estimate: usage.unlimited_minutes ? null : Math.floor(usage.minutes_remaining / 3),
      ...usage,
    };
  }
  if (req.method === "GET" && path === "/api/learnings/summary") {
    await customerContext(req, {}, true);
    return { top_objections: [], best_techniques: [], negative_patterns: [], total_calls_analyzed: 0 };
  }

  const agentMatch = path.match(/^\/api\/(?:cockpit\/)?agents\/([^/]+)$/);
  if (req.method === "PUT" && agentMatch) {
    return (await saveAgent(req, decodeURIComponent(agentMatch[1]), body, { requireActive: true, provision: true })).agent;
  }
  const testMatch = path.match(/^\/api\/(?:cockpit\/)?agents\/([^/]+)\/test$/);
  if (req.method === "POST" && testMatch) return testAgent(req, decodeURIComponent(testMatch[1]), body);
  const voiceMatch = path.match(/^\/api\/voices\/([^/]+)\/voice$/);
  if (req.method === "PUT" && voiceMatch) {
    const voiceId = clean(body.voice_id, 240);
    if (!(await voiceCatalog()).some((voice) => voice.voice_id === voiceId)) throw httpError(400, "invalid_voice", "Choose a voice from the AnswerCrew voice library");
    return (await saveAgent(req, decodeURIComponent(voiceMatch[1]), { voice_id: voiceId }, {
      requireActive: true,
      provision: true,
    })).agent;
  }
  const scriptMatch = path.match(/^\/api\/(?:cockpit\/)?scripts\/([^/]+)$/);
  if (req.method === "POST" && scriptMatch) {
    const context = await customerContext(req, body, true);
    const agent = await ownedAgent(context.account.id, decodeURIComponent(scriptMatch[1]));
    const saved = await saveAgent(req, agent.slot_key, { ...agent, prompt: body.prompt || agent.prompt }, { requireActive: true, provision: true });
    return { id: saved.row.id, agent: saved.row.slot_key, version: 1, prompt: saved.row.prompt, change_notes: body.change_notes || null, is_active: true, performance_score: null, calls_with_version: 0, created_at: saved.row.updated_at };
  }

  throw httpError(501, "customer_feature_not_available", "This customer feature is not available yet");
}

module.exports = {
  VOICES: FALLBACK_VOICES,
  activateCheckout,
  billingSummary,
  createCheckout,
  createCustomerPortal,
  durationSeconds,
  gateway,
  handleCustomerStripeEvent,
  listAgents,
  methodGuard,
  minuteQuotaState,
  probeVapiHealth,
  readJson,
  recordCustomerCallUsage,
  requireActivationPhonePath,
  resetVapiRuntimeStateForTests,
  resumeAgent,
  safePortalReturnUrl,
  saveAgent,
  sendJson,
  testAgent,
  vapiRequest,
  voiceCatalog,
  voiceHealth,
};
