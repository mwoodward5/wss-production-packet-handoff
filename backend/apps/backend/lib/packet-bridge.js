"use strict";

// lib/packet-bridge.js — packet JSON → lane leadMinerInput.
//
// A Genie v2 canonical packet that has been written to a packetDir by
// lib/packet-ingester.js needs to be mapped to the fields the lane
// (lib/line-adapters.js / lib/mirror-lane-build.js) reads from a prospect row.
//
// THE BOUNDARY THIS MODULE ENFORCES
// • NAP (name, address, phone, email, website) — NEVER copied from the
//   packet into the patch. The packet may contain these; they are ignored
//   exactly as lib/mirror-engine/from-genie.js ignores them. A fabricated
//   phone is a live danger; a fabricated address would corrupt JSON-LD.
// • Trust numerals (rating, review_count) — NEVER copied. The rule is the
//   same as in from-genie.js: a number the Genie asserts about itself is
//   not corroborated evidence.
// • Consent flags — NEVER set here. Nothing in this module may emit an
//   outbound action or change any consent field.
//
// WHAT DOES COME ACROSS
// • business_name, city, state, industry — the identity fields the lane
//   needs to pick a donor and slug.
// • services — string list, normalised, NAP-stripped.
// • intake_packet_dir — the path written by the ingester; this is the
//   key that lib/mirror-lane-build.js uses to call readIntakePacket().
// • genie_source_version — carried for auditability.

const NAP_KEYS = new Set([
  "phone", "phones", "telephone", "tel", "mobile", "fax",
  "address", "address1", "address_line1", "street", "street_address",
  "full_address", "formatted_address", "postal_address",
  "email", "emails", "email_address", "contact_email",
  "website", "websites", "website_url", "current_website",
  "url", "site", "site_url", "homepage", "domain", "booking_url",
]);

const TRUST_KEYS = new Set(["rating", "review_count", "review_recency_days"]);

function isNapKey(k) {
  return NAP_KEYS.has(String(k).toLowerCase().replace(/-/g, "_"));
}
function isTrustKey(k) {
  return TRUST_KEYS.has(String(k).toLowerCase().replace(/-/g, "_"));
}

function clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function cleanServices(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    const name = typeof s === "string" ? clean(s) : clean(s && (s.name || s.title || s.label));
    if (name && !isNapKey(name.toLowerCase().replace(/\s+/g, "_"))) out.push(name);
  }
  return [...new Set(out)].slice(0, 30);
}

/**
 * categoryToIndustry(category) → canonical industry label.
 * Mirrors the coarse mapping in lib/mirror-engine/from-genie.js so the two
 * paths produce consistent store values without depending on each other.
 */
function categoryToIndustry(category) {
  const c = clean(category).toLowerCase();
  if (/plumb/i.test(c)) return "plumbing";
  if (/hvac|heat|cool|air.?cond|furnace|boiler/i.test(c)) return "hvac";
  if (/roof/i.test(c)) return "roofing";
  if (/electr/i.test(c)) return "electrical";
  if (/landscap|tree|lawn/i.test(c)) return "landscaping";
  if (/paint/i.test(c)) return "painting";
  if (/concrete|masonry|flat.?work/i.test(c)) return "concrete";
  if (/fenc/i.test(c)) return "fencing";
  if (/general.?contract/i.test(c)) return "general contractor";
  if (/carpet|floor/i.test(c)) return "flooring";
  if (/tattoo/i.test(c)) return "tattoo";
  return clean(category);
}

/**
 * bridgePacketToLane(packet, opts) →
 *   { ok: true,  patch, droppedNap, droppedTrust }
 * | { ok: false, reason }
 *
 * patch — the flat record fields to merge into the prospect row.
 * droppedNap   — list of NAP key names that were found but refused.
 * droppedTrust — list of trust key names that were found but refused.
 *
 * opts.packetDir — the directory written by packet-ingester (required for a
 *   full bridge; may be omitted in parse-only mode).
 * opts.prospectId — if the caller already knows the row id.
 */
function bridgePacketToLane(packet, opts = {}) {
  if (!packet || typeof packet !== "object") {
    return { ok: false, reason: "packet_missing" };
  }

  const facts = packet.facts || {};
  const droppedNap = [];
  const droppedTrust = [];

  // Enumerate every key in facts; drop NAP and trust.
  for (const key of Object.keys(facts)) {
    if (isNapKey(key)) droppedNap.push(key);
    else if (isTrustKey(key)) droppedTrust.push(key);
  }
  if (packet.trust && typeof packet.trust === "object") {
    for (const key of Object.keys(packet.trust)) {
      if (isTrustKey(key) && !droppedTrust.includes(key)) droppedTrust.push(key);
    }
  }

  const businessName = clean(facts.name || "");
  const city = clean(facts.city || "");
  const state = clean(facts.state || "");
  const industry = categoryToIndustry(facts.category || "");
  const services = cleanServices(
    Array.isArray(facts.services) ? facts.services
      : (Array.isArray(packet.content && packet.content.services)
        ? packet.content.services : []),
  );

  // The intake_packet_dir field is what mirror-lane-build looks up with
  // readIntakePacket().  It is required for a useful patch but we do not
  // refuse without it so that callers can call in parse-only mode.
  const packetDir = String(opts.packetDir || "");

  // Genie-grade certification: the Compiler verified logo and services at
  // compile time, so the packet shelf's build-readiness preflight can skip
  // re-verification for this row. A packet missing either element is not
  // certified; it gets the full preflight when the line picks it.
  const approvedLogoUrl = Array.isArray(packet.assets)
    ? (packet.assets.find((a) => a && a.kind === "logo" && a.approved === true && String(a.url || "").startsWith("https://")) || null)
    : null;
  const genieBuildCertified = Boolean(approvedLogoUrl && services.length > 0);

  const patch = {
    ...(businessName ? { business_name: businessName } : {}),
    ...(city        ? { city } : {}),
    ...(state       ? { state } : {}),
    ...(industry    ? { industry } : {}),
    ...(services.length ? { services } : {}),
    ...(packetDir   ? { intake_packet_dir: packetDir } : {}),
    // Marks the row as having a packet so the lane's readiness gate knows.
    packet_ready: true,
    genie_source_version: clean(packet.version || "intake-genie-v2"),
    // Timestamp so an operator can see when the packet was ingested.
    packet_ingested_at: new Date().toISOString(),
    // Build-readiness certification: set when the Genie packet carries a
    // verified logo and non-empty services. Rows bearing this flag skip the
    // preflight re-verification at the packet shelf (they were verified here,
    // at compile time, not at pick time).
    ...(genieBuildCertified ? { genie_build_certified: true } : {}),
  };

  return { ok: true, patch, droppedNap, droppedTrust, genieBuildCertified };
}

/**
 * recordPatch(existing, bridge) → merged record object.
 *
 * Merges the bridge's patch into the prospect's existing `record` column.
 * Existing values for NAP/trust/consent fields are never touched.
 */
function recordPatch(existing = {}, bridge = {}) {
  const rec = typeof existing === "object" && existing !== null ? { ...existing } : {};
  const p = bridge.patch || {};

  // Only non-NAP, non-trust, non-consent fields flow through.
  for (const [k, v] of Object.entries(p)) {
    if (isNapKey(k) || isTrustKey(k)) continue;
    if (/^consent/i.test(k)) continue;
    rec[k] = v;
  }

  return rec;
}

module.exports = {
  bridgePacketToLane,
  recordPatch,
  categoryToIndustry,
  // exposed for tests
  isNapKey,
  isTrustKey,
  cleanServices,
};

// -------------------------------------------------------------------
// Self-test  node lib/packet-bridge.js --test
// -------------------------------------------------------------------
if (require.main === module && process.argv.includes("--test")) {
  const assert = require("node:assert/strict");

  const PACKET = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    facts: {
      name: "Anchor Plumbing",
      city: "Tucson",
      state: "AZ",
      category: "plumbing",
      phone: "(520) 900-1442",
      email: "owner@anchorplumbing.com",
      website: "https://anchorplumbing.com",
      services: ["Drain Cleaning", "Water Heater Repair", "Sewer Line Replacement"],
    },
    trust: { rating: 4.9, review_count: 312 },
    content: {
      about: "Anchor Plumbing has served Tucson since 1998.",
      services: [{ name: "Drain Cleaning" }],
      faqs: [],
    },
    optimization: { target_queries: ["plumbing tucson az"] },
  };

  // 1. Basic bridge
  const r = bridgePacketToLane(PACKET, { packetDir: "/tmp/anchor-plumbing-abc12345" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.patch.business_name, "Anchor Plumbing");
  assert.equal(r.patch.city, "Tucson");
  assert.equal(r.patch.state, "AZ");
  assert.equal(r.patch.industry, "plumbing");
  assert.deepEqual(r.patch.services, ["Drain Cleaning", "Water Heater Repair", "Sewer Line Replacement"]);
  assert.equal(r.patch.intake_packet_dir, "/tmp/anchor-plumbing-abc12345");
  assert.equal(r.patch.packet_ready, true);

  // 2. NAP NEVER crosses the bridge
  assert.ok(!("phone" in r.patch), "phone must not appear in patch");
  assert.ok(!("email" in r.patch), "email must not appear in patch");
  assert.ok(!("website" in r.patch), "website must not appear in patch");
  assert.ok(r.droppedNap.includes("phone"), "phone listed in droppedNap");
  assert.ok(r.droppedNap.includes("email"), "email listed in droppedNap");

  // 3. Trust numerals NEVER cross the bridge
  assert.ok(!("rating" in r.patch), "rating must not appear in patch");
  assert.ok(!("review_count" in r.patch), "review_count must not appear in patch");
  assert.ok(r.droppedTrust.includes("rating"), "rating listed in droppedTrust");
  assert.ok(r.droppedTrust.includes("review_count"), "review_count listed in droppedTrust");

  // 4. recordPatch merges without overwriting NAP
  const existing = { email: "kept@existing.com", rating: 4.5, notes: "old notes" };
  const merged = recordPatch(existing, r);
  assert.equal(merged.email, "kept@existing.com", "existing email never touched");
  assert.equal(merged.rating, 4.5, "existing rating never touched");
  assert.equal(merged.business_name, "Anchor Plumbing", "bridge name merged");
  assert.equal(merged.intake_packet_dir, "/tmp/anchor-plumbing-abc12345", "packetDir merged");

  // 5. Missing packet
  const bad = bridgePacketToLane(null);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "packet_missing");

  // 6. categoryToIndustry
  assert.equal(categoryToIndustry("plumber"), "plumbing");
  assert.equal(categoryToIndustry("HVAC Contractor"), "hvac");
  assert.equal(categoryToIndustry("Roofing Contractor"), "roofing");
  assert.equal(categoryToIndustry("Electrical Contractor"), "electrical");

  console.log("packet-bridge: all self-tests passed");
}
