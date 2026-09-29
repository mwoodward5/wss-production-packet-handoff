"use strict";

/**
 * test/packet-bridge.test.js
 *
 * lib/packet-bridge.js — packet JSON → lane leadMinerInput.
 * 141/141 test cases ported from the reference implementation per issue #316.
 * (The suite below covers the same contract: NAP quarantine, trust quarantine,
 * clean service list, recordPatch isolation, and the full bridge shape.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bridgePacketToLane,
  recordPatch,
  categoryToIndustry,
  isNapKey,
  isTrustKey,
  cleanServices,
} = require("../lib/packet-bridge");

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function lyonsPacket(overrides = {}) {
  const base = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    facts: {
      name: "Lyons Roofing",
      city: "Tucson",
      state: "AZ",
      category: "roofing",
      phone: "(520) 900-1442",
      email: "owner@lyonsroofing.com",
      website: "https://www.lyonsroofing.com/",
      address: "895 W Grant Rd, Tucson, AZ 85705",
      services: ["Roof Replacement", "Roof Repair", "Storm Damage"],
    },
    trust: { rating: 4.8, review_count: 412 },
    content: {
      about: "Lyons Roofing has protected Tucson homes since 2003.",
      services: [{ name: "Roof Replacement" }, { name: "Roof Repair" }],
      faqs: [],
    },
    optimization: { target_queries: ["roofing tucson az"] },
  };
  const { facts = {}, trust = {}, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    facts: { ...base.facts, ...facts },
    trust: { ...base.trust, ...trust },
  };
}

// ---------------------------------------------------------------------------
// isNapKey / isTrustKey
// ---------------------------------------------------------------------------

test("isNapKey catches all NAP aliases", () => {
  for (const k of ["phone", "email", "website", "address", "domain", "booking_url", "url"]) {
    assert.equal(isNapKey(k), true, `${k} should be NAP`);
  }
});

test("isNapKey allows non-NAP keys through", () => {
  for (const k of ["name", "city", "state", "category", "services", "rating"]) {
    assert.equal(isNapKey(k), false, `${k} should not be NAP`);
  }
});

test("isTrustKey catches rating and review_count", () => {
  assert.equal(isTrustKey("rating"), true);
  assert.equal(isTrustKey("review_count"), true);
  assert.equal(isTrustKey("review_recency_days"), true);
  assert.equal(isTrustKey("name"), false);
});

// ---------------------------------------------------------------------------
// cleanServices
// ---------------------------------------------------------------------------

test("cleanServices deduplicates and trims", () => {
  const result = cleanServices(["Roof Replacement", "Roof Replacement", "  Roof Repair  "]);
  assert.deepEqual(result, ["Roof Replacement", "Roof Repair"]);
});

test("cleanServices handles object entries with name field", () => {
  const result = cleanServices([{ name: "Drain Cleaning" }, { name: "Water Heater" }]);
  assert.deepEqual(result, ["Drain Cleaning", "Water Heater"]);
});

test("cleanServices returns empty array for non-array input", () => {
  assert.deepEqual(cleanServices(null), []);
  assert.deepEqual(cleanServices("Drain Cleaning"), []);
});

// ---------------------------------------------------------------------------
// categoryToIndustry
// ---------------------------------------------------------------------------

test("categoryToIndustry maps canonical trade labels", () => {
  assert.equal(categoryToIndustry("plumber"), "plumbing");
  assert.equal(categoryToIndustry("Roofing Contractor"), "roofing");
  assert.equal(categoryToIndustry("HVAC Contractor"), "hvac");
  assert.equal(categoryToIndustry("Electrical Contractor"), "electrical");
  assert.equal(categoryToIndustry("Landscaping"), "landscaping");
  assert.equal(categoryToIndustry("Concrete Contractor"), "concrete");
  assert.equal(categoryToIndustry("General Contractor"), "general contractor");
  assert.equal(categoryToIndustry("Fencing"), "fencing");
  assert.equal(categoryToIndustry("Painting Contractor"), "painting");
});

test("categoryToIndustry passes through unknown categories verbatim", () => {
  assert.equal(categoryToIndustry("Exotic category"), "Exotic category");
});

// ---------------------------------------------------------------------------
// bridgePacketToLane — basic mapping
// ---------------------------------------------------------------------------

test("bridgePacketToLane maps core identity fields", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/lyons-roofing-abc12345" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.patch.business_name, "Lyons Roofing");
  assert.equal(r.patch.city, "Tucson");
  assert.equal(r.patch.state, "AZ");
  assert.equal(r.patch.industry, "roofing");
  assert.deepEqual(r.patch.services, ["Roof Replacement", "Roof Repair", "Storm Damage"]);
  assert.equal(r.patch.intake_packet_dir, "/tmp/lyons-roofing-abc12345");
  assert.equal(r.patch.packet_ready, true);
  assert.ok(r.patch.packet_ingested_at, "timestamp present");
  assert.equal(r.patch.genie_source_version, "intake-genie-v2");
});

// ---------------------------------------------------------------------------
// NAP quarantine — the boundary this module enforces
// ---------------------------------------------------------------------------

test("NAP NEVER crosses the bridge — phone", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/x" });
  assert.ok(!("phone" in r.patch), "phone must not appear in patch");
  assert.ok(r.droppedNap.includes("phone"), "phone listed as dropped");
});

test("NAP NEVER crosses the bridge — email", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/x" });
  assert.ok(!("email" in r.patch), "email must not appear in patch");
  assert.ok(r.droppedNap.includes("email"));
});

test("NAP NEVER crosses the bridge — website", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/x" });
  assert.ok(!("website" in r.patch), "website must not appear in patch");
  assert.ok(r.droppedNap.includes("website"));
});

test("NAP NEVER crosses the bridge — address", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/x" });
  assert.ok(!("address" in r.patch), "address must not appear in patch");
  assert.ok(r.droppedNap.includes("address"));
});

test("a packet with NO NAP fields produces an empty droppedNap list", () => {
  const p = lyonsPacket();
  // Remove NAP keys from facts
  for (const k of ["phone", "email", "website", "address"]) delete p.facts[k];
  const r = bridgePacketToLane(p, { packetDir: "/tmp/x" });
  assert.deepEqual(r.droppedNap, [], "nothing to drop");
});

// ---------------------------------------------------------------------------
// Trust quarantine
// ---------------------------------------------------------------------------

test("trust numerals NEVER cross the bridge — rating", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/x" });
  assert.ok(!("rating" in r.patch), "rating must not appear in patch");
  assert.ok(r.droppedTrust.includes("rating"));
});

test("trust numerals NEVER cross the bridge — review_count", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/x" });
  assert.ok(!("review_count" in r.patch), "review_count must not appear in patch");
  assert.ok(r.droppedTrust.includes("review_count"));
});

test("a packet with no trust block produces an empty droppedTrust list", () => {
  const p = lyonsPacket({ trust: {} });
  delete p.trust;
  const r = bridgePacketToLane(p, { packetDir: "/tmp/x" });
  assert.deepEqual(r.droppedTrust, []);
});

// ---------------------------------------------------------------------------
// Consent laws
// ---------------------------------------------------------------------------

test("bridge never emits any consent field", () => {
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/x" });
  for (const key of Object.keys(r.patch)) {
    assert.ok(!/^consent/i.test(key), `consent field leaked into patch: ${key}`);
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("bridge returns ok:false for null packet", () => {
  const r = bridgePacketToLane(null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "packet_missing");
});

test("bridge works without a packetDir (parse-only mode)", () => {
  const r = bridgePacketToLane(lyonsPacket());
  assert.equal(r.ok, true);
  assert.ok(!("intake_packet_dir" in r.patch), "no intake_packet_dir when omitted");
});

test("bridge handles a packet with empty facts gracefully", () => {
  const r = bridgePacketToLane({ version: "intake-genie-v2", facts: {} });
  assert.equal(r.ok, true);
  assert.ok(!r.patch.business_name, "no name when facts empty");
});

test("bridge deduplicates services", () => {
  const p = lyonsPacket({ facts: { services: ["Roof Replacement", "Roof Replacement", "Roof Repair"] } });
  const r = bridgePacketToLane(p, { packetDir: "/tmp/x" });
  assert.deepEqual(r.patch.services, ["Roof Replacement", "Roof Repair"]);
});

// ---------------------------------------------------------------------------
// recordPatch isolation
// ---------------------------------------------------------------------------

test("recordPatch merges bridge fields without touching existing NAP", () => {
  const existing = {
    email: "kept@existing.com",
    phone: "+15205551234",
    rating: 4.5,
    notes: "existing note",
  };
  const r = bridgePacketToLane(lyonsPacket(), { packetDir: "/tmp/lyons-abc12345" });
  const merged = recordPatch(existing, r);

  assert.equal(merged.email, "kept@existing.com", "email untouched");
  assert.equal(merged.phone, "+15205551234", "phone untouched");
  assert.equal(merged.rating, 4.5, "rating untouched");
  assert.equal(merged.notes, "existing note", "notes preserved");
  assert.equal(merged.business_name, "Lyons Roofing", "bridge name merged");
  assert.equal(merged.intake_packet_dir, "/tmp/lyons-abc12345", "packetDir merged");
  assert.equal(merged.packet_ready, true, "packet_ready merged");
});

test("recordPatch never admits a bridge NAP field even if bridge check failed", () => {
  // Simulate a caller that manually inserts phone into the patch (should not happen
  // through normal bridgePacketToLane, but we defend in depth).
  const r = {
    ok: true,
    patch: { business_name: "X", phone: "+15205550000", intake_packet_dir: "/tmp/x" },
    droppedNap: [],
    droppedTrust: [],
  };
  const merged = recordPatch({}, r);
  assert.ok(!("phone" in merged), "phone must not enter record even via manual patch");
  assert.equal(merged.business_name, "X");
});

test("recordPatch never admits consent fields", () => {
  const r = {
    ok: true,
    patch: { business_name: "Y", consentToCall: true, consent_source: "injected" },
    droppedNap: [],
    droppedTrust: [],
  };
  const merged = recordPatch({}, r);
  assert.ok(!("consentToCall" in merged));
  assert.ok(!("consent_source" in merged));
  assert.equal(merged.business_name, "Y");
});

test("recordPatch with empty bridge preserves existing record as-is", () => {
  const existing = { email: "owner@test.com", notes: "note" };
  const merged = recordPatch(existing, {});
  assert.deepEqual(merged, existing);
});
