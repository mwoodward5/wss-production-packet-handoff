"use strict";

const PLAN_ENV = Object.freeze({
  solo: "STRIPE_PRICE_SOLO",
  crew: "STRIPE_PRICE_CREW",
  front_office: "STRIPE_PRICE_FRONT_OFFICE",
  agency: "STRIPE_PRICE_AGENCY",
});

const PLAN_ANNUAL_ENV = Object.freeze({
  solo: "STRIPE_PRICE_SOLO_ANNUAL",
  crew: "STRIPE_PRICE_CREW_ANNUAL",
  front_office: "STRIPE_PRICE_FRONT_OFFICE_ANNUAL",
  agency: "STRIPE_PRICE_AGENCY_ANNUAL",
});

const PLAN_ENV_ALIASES = Object.freeze({
  solo: ["STRIPE_PRICE_STARTER", "STRIPE_MISSION_CONTROL_STARTER_PRICE_ID"],
  crew: ["STRIPE_PRICE_GROWTH", "STRIPE_MISSION_CONTROL_GROWTH_PRICE_ID"],
  front_office: ["STRIPE_MISSION_CONTROL_FRONT_OFFICE_PRICE_ID"],
  agency: ["STRIPE_MISSION_CONTROL_AGENCY_PRICE_ID"],
});

const PLAN_ANNUAL_ENV_ALIASES = Object.freeze({
  solo: ["STRIPE_PRICE_STARTER_ANNUAL", "STRIPE_MISSION_CONTROL_STARTER_ANNUAL_PRICE_ID"],
  crew: ["STRIPE_PRICE_GROWTH_ANNUAL", "STRIPE_MISSION_CONTROL_GROWTH_ANNUAL_PRICE_ID"],
  front_office: ["STRIPE_MISSION_CONTROL_FRONT_OFFICE_ANNUAL_PRICE_ID"],
  agency: ["STRIPE_MISSION_CONTROL_AGENCY_ANNUAL_PRICE_ID"],
});

// Canonical live Stripe price IDs (storefront-canon, not secrets). Legacy alias
// envs still point at old Mission Control prices ($149/$499) that mismatch the
// public pricing page ($129/$699), so resolution order is: canonical env var >
// canonical default below > legacy alias envs. The defaults guarantee the
// storefront promise wins unless a canonical env explicitly overrides it.
const CANONICAL_DEFAULTS = Object.freeze({
  solo: "price_1TrQWXLEuaGjNcchvqvbqlf0",
  crew: "price_1Ts891LEuaGjNcchuJRIVcFe",
  front_office: "price_1Ts89CLEuaGjNcchRlQagIXp",
  agency: "price_1Ts89DLEuaGjNcchgMeK1PrM",
});

const CANONICAL_ANNUAL_DEFAULTS = Object.freeze({
  solo: "price_1TrQXiLEuaGjNcchRoK3E99p",
  crew: "price_1Ts8arLEuaGjNcchk4moQILJ",
  front_office: "price_1Ts8asLEuaGjNcch7z8e47mV",
  agency: "price_1Ts8auLEuaGjNcchASUEAmuB",
});

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function resolvePlanPriceId(plan, env = process.env, { annual = false } = {}) {
  const envName = annual ? PLAN_ANNUAL_ENV[plan] : PLAN_ENV[plan];
  const defaults = annual ? CANONICAL_ANNUAL_DEFAULTS : CANONICAL_DEFAULTS;
  const aliases = (annual ? PLAN_ANNUAL_ENV_ALIASES : PLAN_ENV_ALIASES)[plan] || [];
  return (
    (envName && env[envName]?.trim()) ||
    defaults[plan] ||
    aliases.map((name) => env[name]?.trim()).find(Boolean) ||
    null
  );
}

function getBillingReadiness(env = process.env) {
  const plans = Object.fromEntries(
    Object.keys(PLAN_ENV).map((plan) => [plan, resolvePlanPriceId(plan, env)]),
  );
  const annualPlans = Object.fromEntries(
    Object.keys(PLAN_ANNUAL_ENV).map((plan) => [plan, resolvePlanPriceId(plan, env, { annual: true })]),
  );
  const blockers = [];

  if (!env.STRIPE_SECRET_KEY?.trim()) blockers.push("stripe_secret_missing");
  if (!env.STRIPE_WEBHOOK_SECRET?.trim()) blockers.push("stripe_webhook_missing");
  if (!plans.solo) blockers.push("solo_price_missing");
  if (!env.STRIPE_MISSION_CONTROL_SUCCESS_URL?.trim()) blockers.push("success_url_missing");
  if (!env.STRIPE_MISSION_CONTROL_CANCEL_URL?.trim()) blockers.push("cancel_url_missing");
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    blockers.push("supabase_identity_missing");
  }

  return {
    plans,
    annualPlans,
    blockers,
    ready: blockers.length === 0,
    publicCheckoutEnabled: enabled(env.PUBLIC_MISSION_CONTROL_CHECKOUT_ENABLED),
    successUrl: env.STRIPE_MISSION_CONTROL_SUCCESS_URL?.trim() || null,
    cancelUrl: env.STRIPE_MISSION_CONTROL_CANCEL_URL?.trim() || null,
  };
}

module.exports = {
  PLAN_ENV,
  PLAN_ANNUAL_ENV,
  PLAN_ENV_ALIASES,
  PLAN_ANNUAL_ENV_ALIASES,
  CANONICAL_DEFAULTS,
  CANONICAL_ANNUAL_DEFAULTS,
  resolvePlanPriceId,
  getBillingReadiness,
};
