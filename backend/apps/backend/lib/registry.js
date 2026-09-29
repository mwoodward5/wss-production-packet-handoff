const woodwardLabsSystem = {
  name: "WSS Labs",
  role: "Website package storefront and build handoff surface",
  url: "https://wss-ai.com/",
  ownedBy: "Woodward Software",
  status: "existing_live_surface",
};

const { getBillingReadiness } = require("./billing-readiness");
const { status: intakeGenieStatus } = require("./intake-genie-client");

const SYSTEMS = {
  leadminer: {
    name: "LeadMiner",
    role: "Lead discovery and scored export source",
    url: "https://leadminer.wss-ai.com/",
    ownedBy: "Woodward Software",
    status: "existing_live_surface",
  },
  callprep: {
    name: "WSS Labs Visibility Report / Rocket Search",
    role: "Business report card, local footprint, and buyer-facing audit reports",
    url: "https://callprep.wss-ai.com/sales-intelligence",
    sampleReportUrl:
      "https://callprep.wss-ai.com/report/audit/ab81146f-d365-4979-829a-4af8bad46621",
    ownedBy: "Woodward Software",
    status: "existing_live_surface",
  },
  rocketSerps: {
    name: "Rocket SERPs",
    role: "SERP and AI visibility data layer used by report packets",
    url: "https://callprep.wss-ai.com/sales-intelligence",
    ownedBy: "Woodward Software",
    status: "existing_live_surface",
  },
  woodwardLabs: woodwardLabsSystem,
  dreamForge: {
    name: "DreamForge",
    role: "Agentic site-building and build-packet execution surface",
    url: "https://wss-dream-forge.vercel.app/",
    ownedBy: "Woodward Software",
    status: "existing_live_surface",
  },
  missionControl: {
    name: "AnswerCrew",
    role: "VAPI/Twilio/Zapier call-center and communication operations surface",
    url: "https://missioncontrol.wss-ai.com/",
    ownedBy: "Woodward Software",
    status: "existing_live_surface",
  },
  deck: {
    name: "Woodward Local Growth Command Deck",
    role: "Public sales/demo shell for Woodward's done-for-you local website engine",
    url: "https://woodward-ghost-agency-vercel.vercel.app/",
    ownedBy: "Woodward Software",
    status: "existing_live_surface",
  },
};

function hasAll(...names) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function hasAny(...names) {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function missionControlCommerceStatus() {
  const billing = getBillingReadiness();
  const monthlyPriceEnvs = [
    ["solo", "STRIPE_PRICE_SOLO", "STRIPE_PRICE_STARTER"],
    ["crew", "STRIPE_PRICE_CREW", "STRIPE_PRICE_GROWTH"],
    ["front_office", "STRIPE_PRICE_FRONT_OFFICE", "STRIPE_MISSION_CONTROL_FRONT_OFFICE_PRICE_ID"],
    ["agency", "STRIPE_PRICE_AGENCY", "STRIPE_MISSION_CONTROL_AGENCY_PRICE_ID"],
  ];
  const annualPriceEnvs = [
    ["solo", "STRIPE_PRICE_SOLO_ANNUAL", "STRIPE_PRICE_STARTER_ANNUAL"],
    ["crew", "STRIPE_PRICE_CREW_ANNUAL", "STRIPE_PRICE_GROWTH_ANNUAL"],
    ["front_office", "STRIPE_PRICE_FRONT_OFFICE_ANNUAL", "STRIPE_MISSION_CONTROL_FRONT_OFFICE_ANNUAL_PRICE_ID"],
    ["agency", "STRIPE_PRICE_AGENCY_ANNUAL", "STRIPE_MISSION_CONTROL_AGENCY_ANNUAL_PRICE_ID"],
  ];
  const monthlyMissing = monthlyPriceEnvs
    .filter(([plan]) => !billing.plans[plan])
    .map(([plan, primary, alias]) => ({ plan, required: primary, alias }));
  const annualMissing = annualPriceEnvs
    .filter(([plan]) => !billing.annualPlans[plan])
    .map(([plan, primary, alias]) => ({ plan, required: primary, alias }));
  const adminProxyConfigured = hasAny(
    "ADMIN_TOKEN",
    "RAILWAY_ADMIN_TOKEN",
    "MISSION_CONTROL_ADMIN_TOKEN",
    "GHOST_AGENCY_ADMIN_TOKEN",
  );
  const monthlyPricesConfigured = monthlyMissing.length === 0;
  return {
    configured: billing.ready && adminProxyConfigured,
    billingReady: billing.ready,
    publicCheckoutEnabled: billing.publicCheckoutEnabled,
    blockers: billing.blockers,
    monthlyPricesConfigured,
    annualPricesConfigured: annualMissing.length === 0,
    adminProxyConfigured,
    mode:
      billing.ready && adminProxyConfigured
        ? "checkout_and_cockpit_proxy"
        : "setup_required",
    missingMonthlyPriceEnvs: monthlyMissing,
    missingAnnualPriceEnvs: annualMissing,
  };
}

function providerStatus() {
  const hasVapiAssistant = hasAny("VAPI_LOCAL_GROWTH_ASSISTANT_ID", "VAPI_ASSISTANT_ID");
  const hasVapiPhone = hasAny("VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID", "VAPI_PHONE_NUMBER_ID");
  const hasResendFrom = hasAny("GHOST_AGENCY_RESEND_FROM", "RESEND_FROM_EMAIL", "RESEND_FROM");
  const hasOutreachFrom = hasAll("GHOST_AGENCY_OUTREACH_FROM");
  const hasResendWebhook = hasAny("GHOST_AGENCY_RESEND_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET");
  const hasStripePrice = hasAny(
    "STRIPE_LOCAL_GROWTH_PRICE_ID",
    "STRIPE_WEBSITE_GROWTH_PRICE_ID",
    "STRIPE_GHOST_AGENCY_PRICE_ID",
  );
  return {
    supabase: {
      configured: hasAll("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
      mode: hasAll("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") ? "live_write" : "dry_run",
    },
    stripe: {
      configured: hasAll("STRIPE_SECRET_KEY"),
      webhookConfigured: hasAll("STRIPE_WEBHOOK_SECRET"),
      // 2026-07-22: a real $0 owner-sandbox checkout was run end to end and
      // Stripe's webhook delivery came back signature-UNVERIFIED on both of
      // its attempts, even though STRIPE_WEBHOOK_SECRET is present (above).
      // "Present" only proves a value exists, not that it's the right one --
      // this checks the value has at least the shape Stripe issues
      // (`whsec_...`), to distinguish "wrong/stale secret copied in" from
      // "not a Stripe webhook secret at all" without ever reading the value
      // itself.
      webhookSecretLooksValid: /^whsec_/.test(String(process.env.STRIPE_WEBHOOK_SECRET || "").trim()),
      // These two flags gate real money (a live Vercel domain purchase) and
      // a free-checkout bypass, respectively. Both were previously
      // "unconfirmed" for anyone auditing production, because Vercel masks
      // their value on every `env pull`/CLI read once a var is marked
      // sensitive -- the only way to know the real answer was to read the
      // runtime's own process.env, which is exactly what this does. Surfaced
      // here (booleans only, never secrets) so admin/readiness and
      // proof/stripe-chain give a definitive true/false going forward.
      liveKeyDetected: String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live"),
      liveKeyAllowed: String(process.env.STRIPE_ALLOW_LIVE || "").trim().toLowerCase() === "true",
      domainPurchaseLive: String(process.env.DOMAIN_PURCHASE_ENABLED || "").trim().toLowerCase() === "true",
      testCheckoutEnabled: String(process.env.STRIPE_TEST_CHECKOUT_ENABLED || "").trim() === "true",
      prices: {
        websiteConfigured: hasStripePrice,
        soloConfigured: Boolean(getBillingReadiness().plans.solo),
      },
      readyForCheckout: getBillingReadiness().ready,
      mode: hasAll("STRIPE_SECRET_KEY") && hasStripePrice
        ? "checkout_session"
        : "dry_run",
    },
    missionControlCommerce: missionControlCommerceStatus(),
    intakeGenie: intakeGenieStatus(),
    elevenLabs: {
      configured: hasAll("ELEVENLABS_API_KEY"),
      mode: hasAll("ELEVENLABS_API_KEY") ? "live_voice_catalog" : "curated_fallback",
    },
    vapi: {
      configured: hasAll("VAPI_API_KEY") && hasVapiAssistant && hasVapiPhone,
      webhookConfigured: hasAll("VAPI_WEBHOOK_SECRET"),
      mode: hasAll("VAPI_API_KEY") && hasVapiAssistant && hasVapiPhone
        ? "consent_gated_calling"
        : "dry_run",
      cleanLaneConfigured: hasAll("VAPI_LOCAL_GROWTH_ASSISTANT_ID", "VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID"),
    },
    twilio: {
      configured:
        hasAll("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN") &&
        (hasAll("TWILIO_MESSAGING_SERVICE_SID") || hasAll("TWILIO_FROM_NUMBER")),
      mode:
        hasAll("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN") &&
        (hasAll("TWILIO_MESSAGING_SERVICE_SID") || hasAll("TWILIO_FROM_NUMBER"))
          ? "consent_gated_messaging"
          : "dry_run",
    },
    woodwardLabsBuildTicket: {
      configured:
        hasAll("WOODWARD_LABS_BUILD_TICKET_URL")
        && hasAll("WOODWARD_LABS_BUILD_TICKET_TOKEN"),
      legacyEnvSupported: false,
      mode:
        hasAll("WOODWARD_LABS_BUILD_TICKET_URL")
          && hasAll("WOODWARD_LABS_BUILD_TICKET_TOKEN")
          ? "http_dispatch"
          : hasAll("WOODWARD_LABS_BUILD_TICKET_URL")
            ? "configuration_blocked"
            : "handoff_packet",
    },
    zapier: {
      configured: hasAll("ZAPIER_GHOST_AGENCY_HOOK_URL"),
      mode: hasAll("ZAPIER_GHOST_AGENCY_HOOK_URL") ? "webhook_dispatch" : "dry_run",
    },
    resend: {
      configured: hasAll("RESEND_API_KEY") && hasResendFrom,
      webhookConfigured: hasResendWebhook,
      outreachConfigured: hasOutreachFrom,
      outreachDomain: (process.env.GHOST_AGENCY_OUTREACH_FROM || "").replace(/^.*@/, "").replace(/[>\s]/g, ""),
      complianceReady: hasAll("GHOST_AGENCY_POSTAL_ADDRESS", "EMAIL_UNSUB_SECRET"),
      unsubscribeConfigured: hasAll("EMAIL_UNSUB_SECRET"),
      postalAddressConfigured: hasAll("GHOST_AGENCY_POSTAL_ADDRESS"),
      mode: hasAll("RESEND_API_KEY") && hasResendFrom
        ? "buyer_delivery_email"
        : "dry_run",
    },
  };
}

function safeMissionControlAuthUrl(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw, fallback);
    if (url.pathname.replace(/\/+$/, "") === "/signup") {
      url.pathname = "/login";
    }
    return url.toString();
  } catch (_) {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// THE PUBLIC BASE A CUSTOMER-FACING LINK IS BUILT ON
// ---------------------------------------------------------------------------
// Every URL publicConfig().publicAppUrl / .apiUrl feeds (signed checkout
// links, report/reveal links, unsubscribe links, the Stripe success/cancel
// redirect, the /factory-os checkout page) is clicked from the OPEN INTERNET.
// A local compose stack legitimately configures private bases for internal
// traffic — PUBLIC_APP_URL=https://api.local.wss-ai.test:5443,
// GHOST_AGENCY_API_URL=http://localhost:3000 — but those same values shipped
// inside customer-facing links produce a 404 (or a TLS failure) for every
// prospect off-machine. Measured 2026-09-18: a valid signed checkout link
// 302'd to https://api.local.wss-ai.test:5443/factory-os?... — a host that
// resolves nowhere outside this desktop.
//
// isLocalOnlyOrigin() recognizes the shapes that cannot be reached from the
// public internet; publicLinkBase() replaces them with the tunnelled public
// name of this backend (https://ghost.wss-ai.com), so the SAME env serves
// internal traffic honestly AND mints links that work. An operator who wants
// a different public name sets GHOST_AGENCY_PUBLIC_BASE_URL.
const DEFAULT_PUBLIC_BASE_URL = "https://ghost.wss-ai.com";
const PUBLIC_BASE_URL_ENV_NAME = "GHOST_AGENCY_PUBLIC_BASE_URL";

function isLocalOnlyOrigin(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return true;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return true;
  // RFC1918 + loopback + link-local ranges.
  if (/^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return true;
  // Reserved / internal-use TLDs (the local compose stack lives under
  // *.local.wss-ai.test) and mDNS-style names.
  if (/(?:\.|^)(?:test|local|internal|localhost|home|corp|lan|intranet)$/.test(host)) return true;
  return false;
}

function publicBaseUrl(env = process.env) {
  const explicit = String((env && env[PUBLIC_BASE_URL_ENV_NAME]) || "").trim();
  if (explicit && !isLocalOnlyOrigin(explicit)) return explicit.replace(/\/+$/, "");
  return DEFAULT_PUBLIC_BASE_URL;
}

// A configured value wins when it is genuinely public; a local-only or absent
// value falls back to the public base. Trailing slashes are normalized.
function publicLinkBase(configured, env = process.env) {
  const value = String(configured || "").trim();
  if (value && !isLocalOnlyOrigin(value)) return value.replace(/\/+$/, "");
  return publicBaseUrl(env);
}

function publicConfig() {
  const billing = getBillingReadiness();
  const missionControlAppUrl = (
    process.env.MISSION_CONTROL_APP_URL ||
    process.env.MISSION_CONTROL_PUBLIC_URL ||
    "https://missioncontrol.wss-ai.com"
  ).replace(/\/+$/, "");
  const missionControlLoginUrl = safeMissionControlAuthUrl(
    process.env.MISSION_CONTROL_LOGIN_URL,
    `${missionControlAppUrl}/login`,
  );
  return {
    publicAppUrl: publicLinkBase(process.env.PUBLIC_APP_URL),
    apiUrl: publicLinkBase(process.env.GHOST_AGENCY_API_URL),
    ownerEmail: process.env.LOCAL_GROWTH_OWNER_EMAIL || process.env.GHOST_AGENCY_OWNER_EMAIL || "",
    supportEmail:
      process.env.LOCAL_GROWTH_SUPPORT_EMAIL ||
      process.env.GHOST_AGENCY_SUPPORT_EMAIL ||
      "support@woodwardsoftware.com",
    missionControlAppUrl,
    missionControlLoginUrl,
    missionControlSignupUrl: safeMissionControlAuthUrl(
      process.env.MISSION_CONTROL_SIGNUP_URL,
      missionControlLoginUrl,
    ),
    missionControlCheckoutEnabled: billing.publicCheckoutEnabled && billing.ready,
  };
}

module.exports = {
  SYSTEMS,
  DEFAULT_PUBLIC_BASE_URL,
  PUBLIC_BASE_URL_ENV_NAME,
  isLocalOnlyOrigin,
  missionControlCommerceStatus,
  providerStatus,
  publicBaseUrl,
  publicConfig,
  publicLinkBase,
};
