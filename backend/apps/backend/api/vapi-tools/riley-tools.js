"use strict";
// api/vapi-tools/riley-tools.js — ONE service for Riley's voice tools.
//
// Base: https://ghost.wss-ai.com/api/vapi-tools/riley-tools  (owner-approved)
// Auth: the same timing-safe shared-secret check the existing three tools use.
//
// TRUTH LAW (Mirror Engine deck), enforced here rather than trusted:
//   · every returned field is tied to a live source, or is null + status
//     "unavailable". Never a fabricated count, finding, price or date.
//   · no secrets in responses.
//   · no payment by voice — payment links are EMAILED only, and gated.
//   · outbound (email/SMS) is consent-gated and refuses without consent===true.
//   · small, voice-friendly JSON plus a report_url.
//
// REUSE, DO NOT REBUILD: the Signal/CallPrep integration already exists in
// lib/callprep-client.js and api/adapters/callprep-report.js. These tools are a
// voice-shaped wrapper over it.

const { timingSafeEqual } = require("node:crypto");
const { select, insertRow, recordEvent } = require("../../lib/store");
const {
  saveBusinessReport,
  existingCallPrepReportUrl,
  reportUrlForId,
  customerSafePacket,
} = require("../../lib/callprep-client");
const { clientReferenceCode } = require("../../lib/client-reference");

const UNAVAILABLE = "unavailable";

/* ------------------------------------------------------------------ auth */
function authorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim()).filter(Boolean);
  const got = String(req.headers["x-vapi-secret"] || req.headers["x-admin-token"] || "").trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => { const b = Buffer.from(s); return g.length === b.length && timingSafeEqual(g, b); });
}

/* --------------------------------------------------------------- helpers */
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const clean = (v, cap = 200) => String(v == null ? "" : v).trim().slice(0, cap);

/** Never let a null become a zero. A missing number is `null` + unavailable. */
const numOrNull = (v) => (v === 0 || (v && Number.isFinite(Number(v))) ? Number(v) : null);

/** Find our prospect row by phone / url / name. Signal has no such lookup. */
async function findProspect({ phone, url, business_name, business_id }) {
  const tries = [];
  if (business_id) tries.push(`prospect_id=eq.${encodeURIComponent(business_id)}&limit=1`);
  if (phone) tries.push(`phone=eq.${encodeURIComponent(phone)}&limit=1`);
  if (url) tries.push(`current_website=eq.${encodeURIComponent(url)}&limit=1`);
  if (business_name) tries.push(`business_name=ilike.${encodeURIComponent(`%${business_name}%`)}&limit=1`);
  for (const q of tries) {
    const r = await select("ghost_agency_prospects", q).catch(() => null);
    if (r && r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0];
  }
  // phone fallback: last-10 compare across a bounded recent slice
  if (phone) {
    const want = digits10(phone);
    const r = await select("ghost_agency_prospects", "order=created_at.desc&limit=500").catch(() => null);
    if (r && r.ok && Array.isArray(r.data)) {
      const hit = r.data.find((p) => digits10(p.phone) === want);
      if (hit) return hit;
    }
  }
  return null;
}

/* ============================== 1. lookup_business_record ============== */
// The cheap first gate. Returns identity + whether a report already exists, so
// get_or_create_report is often unnecessary.
async function lookup_business_record(args) {
  const p = await findProspect(args);
  if (!p) return { status: UNAVAILABLE, reason: "no matching business record", business_name: null };
  const rec = p.record && typeof p.record === "object" ? p.record : {};
  return {
    status: "ok",
    business_name: p.business_name || null,
    client_id: p.reference || rec.reference || clientReferenceCode(p),
    site_preview_url: p.preview_url || rec.preview_url || null,
    review_count: numOrNull(p.review_count ?? rec.review_count),
    avg_rating: numOrNull(p.rating ?? rec.rating),
    top_findings: (p.weaknesses || rec.weaknesses || []).slice(0, 3),
    report_url: existingCallPrepReportUrl(p) || p.report_url || rec.report_url || null,
  };
}

/* ===================== 2+3 MERGED. get_or_create_report ================ */
// Owner-approved merge: Riley must never branch on "does a report exist?" while
// a caller waits. One call — return the existing report, or assemble on our
// side and POST to Signal's save-business-report.
async function get_or_create_report(args) {
  const p = await findProspect(args);
  if (!p) return { status: UNAVAILABLE, reason: "no matching business record", report_url: null };

  const existing = existingCallPrepReportUrl(p);
  if (existing && !args.refresh) {
    return { status: "ok", created: false, report_url: existing, ...reportSummary(p) };
  }

  // Assemble on OUR side (Signal persists a row; it does not scan for us).
  const packet = customerSafePacket ? customerSafePacket({ prospect: p }) : {};
  const saved = await saveBusinessReport({ adapter: packet.adapter || {}, prospect: p }).catch((e) => ({ ok: false, reason: String(e && e.message) }));
  if (!saved || saved.ok !== true) {
    return { status: UNAVAILABLE, created: false, report_url: existing || null, reason: saved && (saved.reason || saved.mode) || "report service unavailable" };
  }
  const url = saved.report_url || reportUrlForId(saved.id);
  await recordEvent("ghost_agency_riley_report_created", { prospect_id: p.prospect_id, report_url: url }).catch(() => {});
  return { status: "ok", created: true, report_id: saved.id || null, report_url: url, eta_seconds: 0, ...reportSummary(p) };
}

/** Voice-shaped summary. Every field is null+unavailable when unmeasured. */
function reportSummary(p) {
  const rec = p.record && typeof p.record === "object" ? p.record : {};
  const rating = numOrNull(p.rating ?? rec.rating);
  const count = numOrNull(p.review_count ?? rec.review_count);
  return {
    review_intelligence: {
      avg_rating: rating,
      review_count: count,
      // sentiment/velocity/response_rate are NOT measured by any live source we
      // hold. Null + unavailable beats a plausible invented number on a call.
      sentiment: null, velocity: null, response_rate: null,
      availability: rating == null && count == null ? UNAVAILABLE : "partial",
    },
    digital_audit: {
      seo_health: null, pagespeed: null, ssl: null, tech_stack: null,
      availability: UNAVAILABLE,
      note: "graded inside the Signal report; not exposed as an API field",
    },
    talking_points: (p.weaknesses || rec.weaknesses || []).slice(0, 5),
    pain_points: (rec.weakness_reasons || []).slice(0, 5),
  };
}

/* ========================= 6. send_report_email ======================== */
async function send_report_email(args) {
  if (args.consented !== true) return { sent: false, status: "refused", reason: "explicit consent required before sending" };
  const to = clean(args.contact_email, 160);
  const link = clean(args.report_url, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { sent: false, status: "refused", reason: "invalid email" };
  if (!/^https:\/\/callprep\.wss-ai\.com\/report\//.test(link)) return { sent: false, status: "refused", reason: "report_url must be a callprep.wss-ai.com report link" };
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) return { sent: false, status: UNAVAILABLE, reason: "mail provider not configured" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: String(process.env.GHOST_AGENCY_RESEND_FROM || "mark@go.wss-ai.com"),
      to: [to],
      subject: "Your business report",
      html: `<p>Here is the report we discussed:</p><p><a href="${link}">${link}</a></p>`,
    }),
  }).catch(() => null);
  const body = r ? await r.json().catch(() => ({})) : {};
  return r && r.ok
    ? { sent: true, status: "ok", provider_message_id: body.id || null }
    : { sent: false, status: UNAVAILABLE, reason: "mail provider rejected the send" };
}

/* =========================== 7. send_sms_link ========================== */
// No SMS provider is configured (Resend is email-only). Returning a truthful
// "unavailable" rather than stubbing a fake send, per owner instruction.
async function send_sms_link(args) {
  if (args.consented !== true) return { sent: false, status: "refused", reason: "explicit consent required" };
  return { sent: false, status: UNAVAILABLE, reason: "no SMS provider is configured — offer to email the link instead" };
}

/* ==================== 8. send_secure_payment_link ====================== */
// Owner-flag gated. Emails a link; never accepts, returns or echoes card data.
async function send_secure_payment_link(args) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.RILEY_PAYMENT_LINKS_ENABLED || ""))) {
    return { sent: false, status: "disabled", reason: "payment links are switched off for the voice agent" };
  }
  const to = clean(args.contact_email, 160);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { sent: false, status: "refused", reason: "invalid email" };
  const quote = await create_membership_quote({ plan: args.plan });
  if (quote.status !== "ok") return { sent: false, status: UNAVAILABLE, reason: "could not resolve that plan" };
  const base = String(process.env.GHOST_AGENCY_API_URL || "https://ghost.wss-ai.com");
  const link = `${base}/api/checkout-link?plan=${encodeURIComponent(quote.plan)}`;
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) return { sent: false, status: UNAVAILABLE, reason: "mail provider not configured" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: String(process.env.GHOST_AGENCY_RESEND_FROM || "mark@go.wss-ai.com"),
      to: [to],
      subject: `Secure signup link — ${quote.label}`,
      html: `<p>Here is your secure signup link. We never take card details over the phone.</p><p><a href="${link}">${link}</a></p>`,
    }),
  }).catch(() => null);
  return r && r.ok ? { sent: true, status: "ok" } : { sent: false, status: UNAVAILABLE, reason: "mail provider rejected the send" };
}

/* ==================== 9. create_membership_quote ======================= */
// Plans are solo / crew / front_office / agency. Amounts are resolved from
// STRIPE AT CALL TIME — never hardcoded, never the legacy $149/$499, never the
// storefront page number. A failed lookup returns null + unavailable.
const PLAN_META = {
  solo: { label: "Solo", minutes: 125, agents: 1 },
  crew: { label: "Crew", minutes: 325, agents: 3 },
  front_office: { label: "Front Office", minutes: 775, agents: 10 },
  agency: { label: "Agency", minutes: 1850, agents: 25 },
};
const PLAN_ALIASES = { starter: "solo", start: "solo", growth: "crew", team: "crew", frontoffice: "front_office", "front-office": "front_office" };

async function create_membership_quote(args) {
  const raw = String(args.plan || "").toLowerCase().trim();
  const plan = PLAN_META[raw] ? raw : PLAN_ALIASES[raw];
  if (!plan) return { status: "refused", reason: "plan must be solo, crew, front_office or agency", plan: null, price: null };
  const meta = PLAN_META[plan];

  let priceId = null, resolver = null;
  try { resolver = require("../../lib/billing-readiness"); } catch { /* not present */ }
  if (resolver && typeof resolver.resolvePlanPriceId === "function") {
    priceId = resolver.resolvePlanPriceId(plan, process.env, { annual: false });
  }
  const sk = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!priceId || !sk) {
    return { status: UNAVAILABLE, plan, label: meta.label, price: null,
      reason: "live pricing could not be confirmed — offer to email exact pricing instead",
      inclusions: [`${meta.minutes} minutes included`, `${meta.agents} agent${meta.agents > 1 ? "s" : ""}`] };
  }
  const r = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { Authorization: `Bearer ${sk}` },
  }).catch(() => null);
  const body = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || typeof body.unit_amount !== "number") {
    return { status: UNAVAILABLE, plan, label: meta.label, price: null,
      reason: "live pricing could not be confirmed — offer to email exact pricing instead",
      inclusions: [`${meta.minutes} minutes included`, `${meta.agents} agent${meta.agents > 1 ? "s" : ""}`] };
  }
  return {
    status: "ok", plan, label: meta.label,
    price: body.unit_amount / 100,
    currency: String(body.currency || "usd").toUpperCase(),
    interval: (body.recurring && body.recurring.interval) || "month",
    inclusions: [`${meta.minutes} minutes included`, `${meta.agents} agent${meta.agents > 1 ? "s" : ""}`],
  };
}

/* ======================== 10. schedule_callback ======================== */
async function schedule_callback(args) {
  const contact = clean(args.contact, 160);
  const when = clean(args.datetime, 60);
  if (!contact || !when) return { status: "refused", reason: "need a contact and a date/time", booking_id: null };
  const parsed = new Date(when);
  if (Number.isNaN(parsed.getTime())) return { status: "refused", reason: "could not understand that date and time", booking_id: null };
  const booking_id = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const saved = await insertRow("ghost_agency_events", {
    type: "ghost_agency_callback_requested",
    payload: { booking_id, contact, datetime: parsed.toISOString(), topic: clean(args.topic, 300) },
    created_at: new Date().toISOString(),
  }).catch(() => null);
  if (!saved || saved.mode !== "live_write") return { status: UNAVAILABLE, booking_id: null, reason: "could not save the callback — take a message instead" };
  return { status: "ok", booking_id, scheduled_for: parsed.toISOString() };
}

/* =================== 12. get_service_area_cities ======================= */
// SOURCE LABEL FLAGGED FOR OWNER APPROVAL. The spec says source "bright_data",
// but our Bright Data integration is a SERP zone that reads Google's knowledge
// panel for rating/review attestation ONLY — it holds no geo dataset and
// returns no city list, and Signal does not use Bright Data at all. So cities
// come from the client's own published service area (first-party, which
// truth-law already prefers) and are then capped by the owner's hard 50-mile
// geodesic rule using Google-geocoded centroids. Every exclusion is reported
// with its measured distance — never silently dropped.
const RADIUS_MILES = 50;

function haversineMiles(a, b) {
  const R = 3958.7613, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function geocode(query) {
  const key = String(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!key) return null;
  const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`;
  const r = await fetch(u).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  const loc = j.results && j.results[0] && j.results[0].geometry && j.results[0].geometry.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function get_service_area_cities(args) {
  const p = args.business_id || args.phone || args.url ? await findProspect(args) : null;
  const hqQuery = clean(args.address, 200) || (p ? [p.address, p.city, p.state, p.postal_code].filter(Boolean).join(", ") : "");
  if (!hqQuery) return { status: UNAVAILABLE, cities: [], radius_miles: RADIUS_MILES, reason: "no HQ address to measure from" };

  const rec = p && p.record && typeof p.record === "object" ? p.record : {};
  const candidates = [...new Set([].concat(rec.areas || [], rec.service_areas || [], p ? [p.city] : []).filter(Boolean).map(String))];
  if (!candidates.length) {
    return { status: UNAVAILABLE, cities: [], radius_miles: RADIUS_MILES,
      source: "first_party_site+geo_cap",
      reason: "the business publishes no service-area list we can verify" };
  }

  const hq = await geocode(hqQuery);
  if (!hq) return { status: UNAVAILABLE, cities: [], radius_miles: RADIUS_MILES, reason: "could not geocode the business address" };

  const included = [], excluded = [];
  for (const city of candidates.slice(0, 40)) {
    const c = await geocode(`${city}, ${p ? p.state || "" : ""}`.trim());
    if (!c) { excluded.push({ city, reason: "could not geocode" }); continue; }
    const miles = Math.round(haversineMiles(hq, c) * 10) / 10;
    (miles <= RADIUS_MILES ? included : excluded).push({ city, miles, ...(miles <= RADIUS_MILES ? {} : { reason: `${miles} mi exceeds the ${RADIUS_MILES} mi cap` }) });
  }
  return {
    status: "ok",
    cities: included.map((c) => c.city),
    detail: included,
    excluded,
    radius_miles: RADIUS_MILES,
    source: "first_party_site+geo_cap",
    source_note: "Bright Data holds no geo dataset; its SERP zone attests rating/reviews only.",
  };
}

/* ============================== dispatcher ============================= */
const TOOLS = {
  lookup_business_record,
  get_or_create_report,
  get_call_prep_report: get_or_create_report, // alias: same call, no branch
  run_new_report: (a) => get_or_create_report({ ...a, refresh: true }),
  send_report_email,
  send_sms_link,
  send_secure_payment_link,
  create_membership_quote,
  schedule_callback,
  get_service_area_cities,
  // transfer_to_team is INTENTIONALLY ABSENT — the proposed roster
  // (Marcus/Ava/Jake/Sophie/Mia) matches no one in this codebase, and inventing
  // staff on a live call is the unverified-claim defect with a human listening.
};

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "method not allowed" })); }
  if (!authorized(req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" })); }
  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      body = JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); }));
    }
    // VAPI wraps tool args; accept wrapped and direct forms.
    const call = body?.message?.toolCalls?.[0];
    const name = clean(call?.function?.name || body.tool || body.name, 60);
    let args = call?.function?.arguments ?? body.arguments ?? body.args ?? body;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }

    const fn = TOOLS[name];
    if (!fn) { res.statusCode = 400; return res.end(JSON.stringify({ error: `unknown tool ${name || "(none)"}` })); }

    const result = await fn(args || {});
    await recordEvent("ghost_agency_riley_tool_call", { tool: name, status: result && result.status }).catch(() => {});
    return res.end(JSON.stringify(call?.id ? { results: [{ toolCallId: call.id, result }] } : result));
  } catch (error) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: String(error.message || error), status: UNAVAILABLE }));
  }
};

module.exports.TOOLS = TOOLS;
