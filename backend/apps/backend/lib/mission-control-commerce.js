"use strict";

const { STRIPE_API_VERSION } = require("./stripe");
const { getBillingReadiness } = require("./billing-readiness");

const DEFAULT_COCKPIT_ORIGIN = "https://missioncontrol.wss-ai.com";
const DEFAULT_PUBLIC_ORIGINS = [
  "https://getanswercrew.com",
  "https://www.getanswercrew.com",
  "https://woodward-ghost-agency-vercel.vercel.app",
];
const DEFAULT_RAILWAY_API = "https://rocket-admin-api-production.up.railway.app";
const BILLING_USAGE_POLICY = Object.freeze({
  overagePolicy: "hard_cap",
  automaticOverageBilling: false,
  note: "Calling pauses at the included-minute limit; no overage is charged automatically.",
});

const PLANS = {
  solo: {
    label: "Solo",
    priceEnv: "STRIPE_PRICE_SOLO",
    annualPriceEnv: "STRIPE_PRICE_SOLO_ANNUAL",
    priceAliases: ["STRIPE_PRICE_STARTER", "STRIPE_MISSION_CONTROL_STARTER_PRICE_ID"],
    annualPriceAliases: ["STRIPE_PRICE_STARTER_ANNUAL", "STRIPE_MISSION_CONTROL_STARTER_ANNUAL_PRICE_ID"],
    minutesIncluded: 125,
    agentQuota: 1,
    accountType: "business",
  },
  crew: {
    label: "Crew",
    priceEnv: "STRIPE_PRICE_CREW",
    annualPriceEnv: "STRIPE_PRICE_CREW_ANNUAL",
    priceAliases: ["STRIPE_PRICE_GROWTH", "STRIPE_MISSION_CONTROL_GROWTH_PRICE_ID"],
    annualPriceAliases: ["STRIPE_PRICE_GROWTH_ANNUAL", "STRIPE_MISSION_CONTROL_GROWTH_ANNUAL_PRICE_ID"],
    minutesIncluded: 325,
    agentQuota: 3,
    accountType: "business",
  },
  front_office: {
    label: "Front Office",
    priceEnv: "STRIPE_PRICE_FRONT_OFFICE",
    annualPriceEnv: "STRIPE_PRICE_FRONT_OFFICE_ANNUAL",
    priceAliases: ["STRIPE_MISSION_CONTROL_FRONT_OFFICE_PRICE_ID"],
    annualPriceAliases: ["STRIPE_MISSION_CONTROL_FRONT_OFFICE_ANNUAL_PRICE_ID"],
    minutesIncluded: 775,
    agentQuota: 10,
    accountType: "business",
  },
  agency: {
    label: "Agency",
    priceEnv: "STRIPE_PRICE_AGENCY",
    annualPriceEnv: "STRIPE_PRICE_AGENCY_ANNUAL",
    priceAliases: ["STRIPE_MISSION_CONTROL_AGENCY_PRICE_ID"],
    annualPriceAliases: ["STRIPE_MISSION_CONTROL_AGENCY_ANNUAL_PRICE_ID"],
    minutesIncluded: 1850,
    agentQuota: 25,
    accountType: "agency",
  },
};

const PLAN_ALIASES = Object.freeze({
  starter: "solo",
  start: "solo",
  growth: "crew",
  team: "crew",
  frontoffice: "front_office",
  "front-office": "front_office",
});

function httpError(statusCode, code, message, detail) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.detail = detail;
  return error;
}

function allowedOrigins() {
  const configured = (process.env.MISSION_CONTROL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([
    DEFAULT_COCKPIT_ORIGIN,
    ...DEFAULT_PUBLIC_ORIGINS,
    ...configured,
  ]);
}

function safePortalReturnUrl(value) {
  const hardFallback = `${DEFAULT_COCKPIT_ORIGIN}/billing`;
  const defaultReturn = `${cockpitBaseUrl()}/billing`;
  const configuredReturn = String(process.env.STRIPE_MISSION_CONTROL_PORTAL_RETURN_URL || "").trim();
  const fallbackCandidate = configuredReturn || defaultReturn;
  const trusted = allowedOrigins();
  for (const candidate of [configuredReturn, process.env.MISSION_CONTROL_PUBLIC_URL]) {
    try {
      if (candidate) trusted.add(new URL(candidate).origin);
    } catch {
      // Ignore invalid trusted configuration values.
    }
  }
  const validate = (candidate, fallback) => {
    try {
      const parsed = new URL(String(candidate || ""));
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || !trusted.has(parsed.origin)) return fallback;
      return parsed.toString();
    } catch {
      return fallback;
    }
  };
  const fallback = validate(fallbackCandidate, hardFallback);
  return validate(value, fallback);
}

function checkoutSuccessUrl(value, planName) {
  const parsed = new URL(String(value));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw httpError(503, "billing_not_ready", "Checkout success URL must be HTTPS");
  }
  parsed.searchParams.set("plan", planName);
  parsed.searchParams.set("session_id", "__CHECKOUT_SESSION_ID__");
  return parsed.toString().replace("__CHECKOUT_SESSION_ID__", "{CHECKOUT_SESSION_ID}");
}

function setMissionControlCors(req, res, methods = ["GET", "POST", "PUT", "OPTIONS"]) {
  const origin = req.headers.origin;
  const origins = allowedOrigins();
  if (origin && origins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", DEFAULT_COCKPIT_ORIGIN);
  }
  res.setHeader("Access-Control-Allow-Methods", methods.join(","));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With");
  res.setHeader("Cache-Control", "no-store");
}

function sendCommerceJson(req, res, statusCode, payload, methods) {
  setMissionControlCors(req, res, methods);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload, null, 2));
}

function methodGuard(req, res, methods) {
  setMissionControlCors(req, res, methods);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (!methods.includes(req.method)) {
    sendCommerceJson(req, res, 405, { ok: false, error: "method_not_allowed", allowed: methods }, methods);
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
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRawBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw httpError(400, "invalid_json", "Invalid JSON", raw.slice(0, 240));
  }
}

function supabaseUrl() {
  const value = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!value) throw httpError(503, "supabase_not_configured", "SUPABASE_URL is not configured");
  return value;
}

function supabaseServiceKey() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!value) throw httpError(503, "supabase_not_configured", "SUPABASE_SERVICE_ROLE_KEY is not configured");
  return value;
}

async function supabaseRest(table, options = {}) {
  const url = new URL(`${supabaseUrl()}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseServiceKey(),
      Authorization: `Bearer ${supabaseServiceKey()}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw httpError(response.status, "supabase_rest_failed", `Supabase ${table} request failed`, json);
  }
  return json;
}

async function selectRows(table, query = {}) {
  const rows = await supabaseRest(table, {
    query: {
      select: "*",
      ...query,
    },
  });
  return Array.isArray(rows) ? rows : [];
}

async function upsertRow(table, row, conflictColumns) {
  return supabaseRest(table, {
    method: "POST",
    query: conflictColumns ? { on_conflict: conflictColumns } : {},
    prefer: "resolution=merge-duplicates,return=representation",
    body: row,
  });
}

async function patchRows(table, query, patch) {
  return supabaseRest(table, {
    method: "PATCH",
    query: {
      select: "*",
      ...query,
    },
    body: patch,
  });
}

function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function authenticateSupabaseUser(req, options = {}) {
  const token = bearerToken(req);
  if (!token) {
    if (options.optional) return { authenticated: false, user: null, token: "" };
    throw httpError(401, "unauthorized", "Supabase bearer token required");
  }

  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseServiceKey(),
      Authorization: `Bearer ${token}`,
    },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) {
    throw httpError(401, "unauthorized", "Invalid Supabase bearer token", user);
  }
  return { authenticated: true, user, token };
}

function normalizePlan(planName) {
  const raw = String(planName || "solo").toLowerCase().trim();
  const key = PLAN_ALIASES[raw] || raw;
  if (!PLANS[key]) {
    throw httpError(400, "invalid_plan", "Plan must be solo, crew, front_office, or agency");
  }
  return key;
}

function planForPrice(priceId) {
  for (const [key, plan] of Object.entries(PLANS)) {
    const candidates = [plan.priceEnv, plan.annualPriceEnv, ...(plan.priceAliases || []), ...(plan.annualPriceAliases || [])]
      .map((name) => process.env[name])
      .filter(Boolean);
    if (priceId && candidates.includes(priceId)) {
      return key;
    }
  }
  return "";
}

function priceIdFor(planName, annual) {
  const plan = PLANS[planName];
  const envName = annual ? plan.annualPriceEnv : plan.priceEnv;
  const aliases = annual ? plan.annualPriceAliases || [] : plan.priceAliases || [];
  return {
    envName,
    priceId: process.env[envName] || aliases.map((name) => process.env[name]).find(Boolean) || "",
    aliases,
  };
}

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || "";
}

async function stripePost(path, params) {
  if (!stripeSecretKey()) {
    throw httpError(503, "stripe_not_configured", "STRIPE_SECRET_KEY is not configured");
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    },
    body: params,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status >= 500 ? 502 : response.status, "stripe_request_failed", "Stripe request failed", json);
  }
  return json;
}

async function stripeGet(path) {
  if (!stripeSecretKey()) {
    throw httpError(503, "stripe_not_configured", "STRIPE_SECRET_KEY is not configured");
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      "Stripe-Version": STRIPE_API_VERSION,
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status >= 500 ? 502 : response.status, "stripe_request_failed", "Stripe request failed", json);
  }
  return json;
}

async function getPublicBillingPlans() {
  const readiness = getBillingReadiness();
  if (!stripeSecretKey()) {
    return {
      ready: readiness.ready,
      publicCheckoutEnabled: readiness.publicCheckoutEnabled && readiness.ready,
      plans: Object.fromEntries(Object.keys(PLANS).map((key) => [key, { configured: Boolean(readiness.plans[key]) }])),
      solo: { configured: Boolean(readiness.plans.solo) },
      usagePolicy: BILLING_USAGE_POLICY,
    };
  }
  const plans = {};
  for (const key of Object.keys(PLANS)) {
    const priceId = readiness.plans[key];
    if (!priceId) {
      plans[key] = { configured: false };
      continue;
    }
    const price = await stripeGet(`/prices/${encodeURIComponent(priceId)}`);
    plans[key] = {
      configured: true,
      active: Boolean(price.active),
      currency: price.currency || "usd",
      unitAmount: Number.isFinite(price.unit_amount) ? price.unit_amount : null,
      interval: price.recurring?.interval || null,
      intervalCount: price.recurring?.interval_count || 1,
      usageType: price.recurring?.usage_type || "licensed",
    };
  }
  return {
    ready: readiness.ready,
    publicCheckoutEnabled: readiness.publicCheckoutEnabled && readiness.ready,
    plans,
    solo: plans.solo,
    usagePolicy: BILLING_USAGE_POLICY,
  };
}

function cockpitBaseUrl() {
  return (process.env.MISSION_CONTROL_PUBLIC_URL || DEFAULT_COCKPIT_ORIGIN).replace(/\/+$/, "");
}

function missionControlSignupUrl(planName) {
  const fallback = `${cockpitBaseUrl()}/login?plan=${encodeURIComponent(planName)}`;
  const configured = process.env.MISSION_CONTROL_SIGNUP_URL?.trim();
  if (!configured) return fallback;
  try {
    const url = new URL(configured, cockpitBaseUrl());
    if (url.pathname.replace(/\/+$/, "") === "/signup") {
      url.pathname = "/login";
    }
    url.searchParams.set("plan", planName);
    return url.toString();
  } catch (_) {
    return fallback;
  }
}

async function accountById(accountId) {
  if (!accountId) return null;
  const rows = await selectRows("accounts", { id: `eq.${accountId}`, limit: "1" });
  return rows[0] || null;
}

async function accountForOwner(userId) {
  const rows = await selectRows("accounts", {
    owner_user_id: `eq.${userId}`,
    order: "created_at.asc",
    limit: "1",
  });
  return rows[0] || null;
}

function userOwnsAccount(user, account) {
  return Boolean(user?.id && account?.owner_user_id && String(account.owner_user_id) === String(user.id));
}

async function getOrCreateAccount(user, body = {}) {
  if (!user?.id) return null;
  if (body.account_id) {
    const existing = await accountById(body.account_id);
    if (!existing || !userOwnsAccount(user, existing)) {
      throw httpError(403, "account_forbidden", "You do not have access to that account");
    }
    return existing;
  }

  const existing = await accountForOwner(user.id);
  if (existing) return existing;

  const inserted = await upsertRow("accounts", {
    owner_user_id: user.id,
    name: body.account_name || body.business_name || user.email || "AnswerCrew Account",
    type: body.account_type || "business",
    status: "active",
    updated_at: new Date().toISOString(),
  });
  return inserted?.[0] || null;
}

async function subscriptionForAccount(accountId) {
  if (!accountId) return null;
  const rows = await selectRows("subscriptions", { account_id: `eq.${accountId}`, limit: "1" });
  return rows[0] || null;
}

function activeSubscription(subscription) {
  return ["active", "trialing"].includes(String(subscription?.status || ""));
}

async function requireBillableAccount(req, body = {}) {
  const auth = await authenticateSupabaseUser(req);
  const account = await getOrCreateAccount(auth.user, body);
  if (!account) throw httpError(403, "account_required", "Account required");
  const subscription = await subscriptionForAccount(account.id);
  if (!activeSubscription(subscription)) {
    throw httpError(402, "subscription_required", "An active subscription is required for this action", {
      account_id: account.id,
      status: subscription?.status || "missing",
    });
  }
  return { user: auth.user, account, subscription };
}

async function createBillingCheckout(req, body = {}) {
  const planName = normalizePlan(body.plan);
  const plan = PLANS[planName];
  const annual = Boolean(body.annual);
  const auth = await authenticateSupabaseUser(req, { optional: true });
  if (!auth.authenticated) {
    throw httpError(401, "auth_required", "Sign in or create an owner account before checkout", {
      signupUrl: missionControlSignupUrl(planName),
    });
  }
  const readiness = getBillingReadiness();
  const price = priceIdFor(planName, annual);
  if (!price.priceId) {
    throw httpError(503, "stripe_price_not_configured", `${price.envName} is not configured`, {
      requiredEnv: price.envName,
      aliases: price.aliases,
    });
  }

  if (!readiness.ready) {
    throw httpError(503, "billing_not_ready", "AnswerCrew checkout is not ready", {
      blockers: readiness.blockers,
    });
  }
  const account = await getOrCreateAccount(auth.user, { ...body, account_type: plan.accountType });
  const subscription = await subscriptionForAccount(account.id);
  const customerEmail = auth.user?.email || "";
  const successUrl = checkoutSuccessUrl(readiness.successUrl, planName);
  const cancelUrl = readiness.cancelUrl;

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("line_items[0][price]", price.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("allow_promotion_codes", "true");
  params.set("metadata[product]", "answercrew");
  params.set("metadata[plan]", planName);
  params.set("metadata[annual]", annual ? "true" : "false");
  params.set("subscription_data[metadata][product]", "answercrew");
  params.set("subscription_data[metadata][plan]", planName);
  params.set("client_reference_id", auth.user.id);
  params.set("metadata[supabase_user_id]", auth.user.id);
  params.set("subscription_data[metadata][supabase_user_id]", auth.user.id);
  if (account?.id) {
    params.set("metadata[account_id]", account.id);
    params.set("metadata[owner_user_id]", account.owner_user_id || "");
    params.set("subscription_data[metadata][account_id]", account.id);
    params.set("subscription_data[metadata][owner_user_id]", account.owner_user_id || "");
  }
  if (subscription?.stripe_customer_id) {
    params.set("customer", subscription.stripe_customer_id);
  } else if (customerEmail) {
    params.set("customer_email", customerEmail);
  }

  const session = await stripePost("/checkout/sessions", params);
  if (account?.id) {
    await upsertRow("subscriptions", {
      account_id: account.id,
      stripe_customer_id: session.customer || subscription?.stripe_customer_id || null,
      stripe_subscription_id: session.subscription || subscription?.stripe_subscription_id || null,
      plan: planName,
      status: "checkout_pending",
      minutes_included: plan.minutesIncluded,
      agent_quota: plan.agentQuota,
      updated_at: new Date().toISOString(),
    }, "account_id");
  }

  return {
    mode: "stripe_checkout",
    url: session.url,
    session_id: session.id,
    plan: planName,
    annual,
    account_id: account?.id || null,
  };
}

async function createBillingPortal(req, body = {}) {
  const auth = await authenticateSupabaseUser(req);
  const account = await getOrCreateAccount(auth.user, body);
  const subscription = await subscriptionForAccount(account.id);
  if (!subscription?.stripe_customer_id) {
    throw httpError(404, "stripe_customer_missing", "No Stripe customer is attached to this account");
  }
  const params = new URLSearchParams();
  params.set("customer", subscription.stripe_customer_id);
  params.set("return_url", safePortalReturnUrl(body.return_url));
  const session = await stripePost("/billing_portal/sessions", params);
  return {
    mode: "stripe_billing_portal",
    url: session.url,
    account_id: account.id,
  };
}

function unixToIso(value) {
  const numeric = Number(value || 0);
  return numeric > 0 ? new Date(numeric * 1000).toISOString() : null;
}

async function upsertSubscriptionFromStripe(subscription, fallback = {}) {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || "";
  const planName = normalizePlan(subscription.metadata?.plan || fallback.plan || planForPrice(priceId) || "solo");
  const plan = PLANS[normalizePlan(planName)];
  let accountId = subscription.metadata?.account_id || fallback.account_id || null;

  if (!accountId && subscription.id) {
    const existing = await selectRows("subscriptions", { stripe_subscription_id: `eq.${subscription.id}`, limit: "1" });
    accountId = existing[0]?.account_id || null;
  }
  if (!accountId && subscription.customer) {
    const existing = await selectRows("subscriptions", { stripe_customer_id: `eq.${subscription.customer}`, limit: "1" });
    accountId = existing[0]?.account_id || null;
  }
  if (!accountId && fallback.createPendingAccount) {
    const inserted = await upsertRow("accounts", {
      owner_user_id: null,
      name: fallback.accountName || fallback.email || "Pending AnswerCrew Account",
      type: plan.accountType,
      status: "pending_claim",
      updated_at: new Date().toISOString(),
    });
    accountId = inserted?.[0]?.id || null;
  }
  if (!accountId) {
    return { mode: "subscription_record_skipped", reason: "account_id_missing", stripe_subscription_id: subscription.id };
  }

  const row = await upsertRow("subscriptions", {
    account_id: accountId,
    stripe_customer_id: subscription.customer || fallback.stripe_customer_id || null,
    stripe_subscription_id: subscription.id || fallback.stripe_subscription_id || null,
    plan: planName,
    status: subscription.status || fallback.status || "unknown",
    current_period_end: unixToIso(subscription.current_period_end),
    minutes_included: plan.minutesIncluded,
    agent_quota: plan.agentQuota,
    updated_at: new Date().toISOString(),
  }, "account_id");
  return { mode: "subscription_upserted", account_id: accountId, row };
}

async function handleCheckoutCompleted(session) {
  if (!["answercrew", "mission-control"].includes(session.metadata?.product)) {
    return { mode: "not_answercrew_checkout" };
  }
  let subscription = null;
  if (session.subscription) {
    subscription = await stripeGet(`/subscriptions/${encodeURIComponent(session.subscription)}`);
  }
  if (!subscription) {
    return { mode: "checkout_recorded_without_subscription", session_id: session.id };
  }
  const result = await upsertSubscriptionFromStripe(subscription, {
    account_id: session.metadata?.account_id || null,
    supabase_user_id: session.metadata?.supabase_user_id || null,
    plan: session.metadata?.plan || null,
    stripe_customer_id: session.customer || null,
    createPendingAccount: !session.metadata?.account_id,
    accountName: session.customer_details?.name || session.customer_email || "",
    email: session.customer_details?.email || session.customer_email || "",
  });
  // Welcome email: fire-and-forget, never blocks entitlement.
  try {
    const email = session.customer_details?.email || session.customer_email || "";
    if (email) {
      const { sendAnswerCrewWelcomeEmail } = require("./answercrew-welcome-email");
      const planName = normalizePlan(session.metadata?.plan || "solo");
      await sendAnswerCrewWelcomeEmail({
        email,
        ownerName: session.customer_details?.name || "",
        planName: PLANS[planName]?.label || PLANS[planName]?.name || planName,
      });
    }
  } catch (_) {
    // never fail the webhook over a welcome email
  }
  return result;
}

async function isKnownLegacyCommerceSubscription(subscription = {}) {
  const subscriptionId = String(subscription.id || "").trim();
  if (!subscriptionId) return false;
  const existing = await selectRows("subscriptions", {
    stripe_subscription_id: `eq.${subscriptionId}`,
    limit: "1",
  });
  return existing.some((row) => String(row.stripe_subscription_id || "") === subscriptionId);
}

async function handleCommerceStripeEvent(event = {}) {
  const type = event.type || "";
  const object = event.data?.object || {};
  if (type === "checkout.session.completed") {
    return handleCheckoutCompleted(object);
  }
  if (type.startsWith("customer.subscription.")) {
    const product = String(object.metadata?.product || "").trim();
    const explicitProduct = ["answercrew", "mission-control"].includes(product);
    const knownLegacy = !product && await isKnownLegacyCommerceSubscription(object);
    if (!explicitProduct && !knownLegacy) {
      return { mode: "not_answercrew_subscription", product };
    }
    return upsertSubscriptionFromStripe(object);
  }
  return { mode: "commerce_event_ignored", type };
}

function railwayAdminToken() {
  return (
    process.env.ADMIN_TOKEN ||
    process.env.RAILWAY_ADMIN_TOKEN ||
    process.env.MISSION_CONTROL_ADMIN_TOKEN ||
    process.env.GHOST_AGENCY_ADMIN_TOKEN ||
    ""
  );
}

function railwayBaseUrl() {
  return (process.env.RAILWAY_ADMIN_API_URL || DEFAULT_RAILWAY_API).replace(/\/+$/, "");
}

async function forwardRailway(req, targetPath, body) {
  if (!railwayAdminToken()) {
    throw httpError(503, "railway_admin_not_configured", "ADMIN_TOKEN is not configured on ghost-agency-backend");
  }
  const response = await fetch(`${railwayBaseUrl()}${targetPath}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${railwayAdminToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { upstreamText: text };
  }
  return { status: response.status, payload };
}

async function handleCockpitProxy(req, res, options) {
  const methods = options.methods || ["POST", "PUT", "OPTIONS"];
  if (!methodGuard(req, res, methods)) return;
  try {
    const body = await readJson(req);
    await requireBillableAccount(req, body);
    const forwarded = await forwardRailway(req, options.targetPath, body);
    sendCommerceJson(req, res, forwarded.status, forwarded.payload ?? {}, methods);
  } catch (error) {
    sendCommerceJson(req, res, error.statusCode || 500, {
      ok: false,
      error: error.code || "internal_error",
      message: error.message,
      detail: error.detail,
    }, methods);
  }
}

module.exports = {
  BILLING_USAGE_POLICY,
  PLANS,
  createBillingCheckout,
  createBillingPortal,
  checkoutSuccessUrl,
  getPublicBillingPlans,
  handleCockpitProxy,
  handleCommerceStripeEvent,
  activeSubscription,
  methodGuard,
  readJson,
  safePortalReturnUrl,
  railwayAdminToken,
  sendCommerceJson,
};
