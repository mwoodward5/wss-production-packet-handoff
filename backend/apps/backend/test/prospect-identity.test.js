"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalIdentity,
  identityCounters,
  matchCanonicalIdentity,
  mergeSafePlan,
  normalizeAddress,
  normalizeBusinessName,
  normalizeDomain,
  normalizePhone,
} = require("../lib/prospect-identity");

test("normalizes domains without paths, ports, case, or www", () => {
  assert.equal(normalizeDomain(" HTTPS://WWW.Example.COM:443/services?q=1 "), "example.com");
  assert.equal(normalizeDomain("example.com/about"), "example.com");
  assert.equal(normalizeDomain("not-a-domain"), "");
});

test("shared social and directory hosts are never treated as business identity", () => {
  for (const url of ["https://facebook.com/one", "https://instagram.com/two", "https://yelp.com/biz/three"]) {
    assert.equal(normalizeDomain(url), "");
  }
});

test("normalizes North American and international phones conservatively", () => {
  assert.equal(normalizePhone("(214) 555-0199"), "+12145550199");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("555"), "");
});

test("normalizes business names and addresses without suite noise", () => {
  assert.equal(normalizeBusinessName("José's Ink & Co., LLC"), "jose s ink and");
  assert.equal(normalizeAddress("3550 Watt Avenue, Suite 170"), "3550 watt ave");
});

test("canonical identity prefers domain, then phone, then name plus address", () => {
  const identity = canonicalIdentity({
    business_name: "Deep Ellum Tattoo LLC",
    current_website: "https://www.deepellum.example/gallery",
    phone: "214-555-0100",
    address: "100 Main Street",
    city: "Dallas",
    state: "TX",
  });
  assert.equal(identity.canonicalKey, "domain:deepellum.example");
  assert.deepEqual(identity.keys, [
    "domain:deepellum.example",
    "phone:+12145550100",
    "name_address:deep ellum tattoo|100 main st dallas tx",
  ]);
});

test("Google Place ID is the strongest canonical identity", () => {
  const identity = canonicalIdentity({ place_id: "ChIJ-123", current_website: "https://ink.example" });
  assert.equal(identity.canonicalKey, "place:ChIJ-123");
});

test("matches duplicate records when any canonical key agrees", () => {
  const result = matchCanonicalIdentity(
    { business_name: "Acme Tattoo", phone: "2145550111" },
    { business_name: "ACME Tattoo LLC", phone: "+1 (214) 555-0111" },
  );
  assert.equal(result.matched, true);
  assert.equal(result.strongestKey, "phone:+12145550111");
});

test("merge plan fills blanks but never overwrites conflicting history", () => {
  const plan = mergeSafePlan(
    { business_name: "Acme Tattoo", phone: "2145550111", email: "old@example.com" },
    { business_name: "Acme Tattoo LLC", phone: "+12145550111", email: "new@example.com", city: "Dallas" },
  );
  assert.equal(plan.safeToMerge, true);
  assert.deepEqual(plan.patch, { city: "Dallas" });
  assert.equal(plan.requiresReview, true);
  assert.deepEqual(plan.conflicts.map((item) => item.field), ["email"]);
});

test("honest counters separate duplicate and unidentifiable rows", () => {
  const result = identityCounters([
    { business_name: "A", current_website: "a.example" },
    { business_name: "A Duplicate", current_website: "https://www.a.example/path" },
    { business_name: "B", phone: "2145550123" },
    { business_name: "No Contact" },
  ]);
  assert.deepEqual(result, {
    rows: 4,
    identifiableRows: 3,
    uniqueProspects: 2,
    duplicateRows: 1,
    unidentifiableRows: 1,
  });
});
