"use strict";

// lib/mirror-engine/trust-brightdata.js — ATTESTED trust data.
//
// The Intake Genie returns trust:{rating:null,review_count:null,reviews:[]}
// even for businesses Google rates 4.9 with hundreds of reviews (measured on
// all five prospects tonight). Truth law then correctly ships no rating at
// all, so every mirror loses its single strongest conversion element and the
// 108-stack points that depend on it (27 real reviews quoted, 44 aggregate
// rating, plus the AggregateRating node in the schema graph).
//
// This module closes that gap the honest way: read Google's own knowledge
// panel via BrightData SERP (the source the intake packet's
// BRIGHTDATA-SERP-AUDIT already documents) and accept the numbers ONLY when
// the panel provably describes THIS business. An unverified panel is
// discarded, never averaged, never guessed.
//
// ATTESTATION RULE — all three must hold:
//   1. the panel's business name matches the prospect's (normalized, or one
//      contains the other: "Lyons Roofing" vs "Lyons Roofing Inc"),
//   2. the panel's address/locality mentions the prospect's city, OR the
//      panel phone's last-10 digits equal the prospect's phone,
//   3. rating parses to 0-5 and review_count to a positive integer.
// Anything short of that returns { ok:false, reason } and the mirror ships
// without social proof — a blank is recoverable, a wrong company's rating is
// not (that is the Tekline lesson in numeric form).

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ltd|co|company|the)\b/g, "").replace(/\s+/g, " ").trim();
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

function brightDataEnv() {
  const key = String(process.env.BRIGHTDATA_API_KEY || "").trim();
  const zone = String(process.env.BRIGHTDATA_SERP_ZONE || "serp").trim();
  const endpoint = String(process.env.BRIGHTDATA_SERP_ENDPOINT || "https://api.brightdata.com/request").trim();
  if (!key) throw new Error("BRIGHTDATA_API_KEY not configured");
  return { key, zone, endpoint };
}

/**
 * One SERP call with retry. BrightData answers a repeated failing query with
 * a plain-text "recently failed ... try again after 15 seconds" body, so a
 * transient response is retried with backoff rather than treated as a miss.
 */
async function serp(query, { attempts = 3, waitMs = 20000, fetchImpl = fetch } = {}) {
  const { key, zone, endpoint } = brightDataEnv();
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1`;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url, format: "raw" }),
      signal: AbortSignal.timeout(70000),
    });
    const text = await res.text();
    if (!text.trim() || /recently failed|try again later/i.test(text)) continue;
    try { return JSON.parse(text); } catch { continue; }
  }
  return null;
}

/**
 * fetchTrust({ business_name, city, state, phone, address })
 *   -> { ok:true, rating, review_count, source, panel, observed_at }
 *   | { ok:false, reason, panel? }
 */
async function fetchTrust(facts = {}, opts = {}) {
  const query = [facts.business_name, facts.city, facts.state].filter(Boolean).join(" ");
  const json = await serp(query, opts);
  if (!json) return { ok: false, reason: "serp_unavailable" };
  const panel = json.knowledge || json.knowledge_panel || null;
  if (!panel) return { ok: false, reason: "no_knowledge_panel" };

  // 1. name agreement
  const a = norm(panel.name);
  const b = norm(facts.business_name);
  const nameOk = Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));

  // 2. locality OR phone agreement
  const panelAddr = String(panel.address || panel.located_in || "");
  const cityOk = Boolean(facts.city && panelAddr.toLowerCase().includes(String(facts.city).toLowerCase()));
  const phoneOk = Boolean(facts.phone && panel.phone && digits10(panel.phone) === digits10(facts.phone));
  const placeOk = cityOk || phoneOk;

  // 3. numeric sanity
  const rating = Number(panel.rating);
  const count = parseInt(String(panel.reviews_cnt ?? panel.reviews_count ?? panel.reviews ?? "").replace(/[^0-9]/g, ""), 10);
  const numbersOk = Number.isFinite(rating) && rating > 0 && rating <= 5 && Number.isInteger(count) && count > 0;

  if (!nameOk || !placeOk || !numbersOk) {
    return {
      ok: false,
      reason: !nameOk ? "panel_name_mismatch" : !placeOk ? "panel_place_mismatch" : "panel_numbers_unusable",
      panel: { name: panel.name, address: panelAddr, phone: panel.phone, rating: panel.rating, reviews: panel.reviews_cnt ?? panel.reviews },
    };
  }

  return {
    ok: true,
    rating: Math.round(rating * 10) / 10,
    review_count: count,
    source: "google_knowledge_panel_via_brightdata",
    attested_by: { name_match: nameOk, city_match: cityOk, phone_match: phoneOk },
    panel: { name: panel.name, address: panelAddr, phone: panel.phone },
    observed_at: new Date().toISOString(),
  };
}

module.exports = { fetchTrust, serp, norm, digits10 };
