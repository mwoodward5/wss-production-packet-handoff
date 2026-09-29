"use strict";

// BF-5 hardening. identityScan can excuse a donor "place" atom when it is
// really the CLIENT's own verified city/county (a Tempe prospect on a Tempe
// donor). Donor PERSON names, however, are carried in the `socials` bucket
// (scan.js folds m.persons/owner/owner_name into it), which the place excuse
// would otherwise cover — and many first/last names are also town names
// ("Brandon" is both a donor owner and a town near Tampa). Excusing one would
// re-open the documented person-name leak (the "OWNER · M. FORCHIONE" class),
// so a donor person atom must NEVER be excused, whatever bucket it sits in.
const test = require("node:test");
const assert = require("node:assert/strict");
const { identityScan } = require("../lib/mirror-engine/scan.js");

const DONOR = {
  name: "plumbing-premier",
  donor_city: "Brandon",
  persons: ["Brandon", "Barnett"],
  socials: [],
};

// The hydrated page legitimately names the client's own market, Brandon FL.
const files = { "index.html": Buffer.from("<h1>Tampa Plumbing</h1><p>Serving Brandon and greater Tampa.</p>") };
// Shape accepted by clientAreaAllowlist: { facts, content }.
const CLIENT = {
  facts: { city: "Tampa", state: "FL", county: "Hillsborough County" },
  content: { areas: ["Brandon"], nearby: [{ name: "Brandon", miles: 11 }] },
};

test("a donor PERSON name is never excused, even when it matches a client place", () => {
  const res = identityScan(files, DONOR, CLIENT);
  const tokens = (res.hits || []).map((h) => String(h.token || "").toLowerCase());
  assert.ok(
    tokens.includes("brandon"),
    `donor person "Brandon" must still be flagged; hits=${JSON.stringify(res.hits || [])}`,
  );
  assert.equal(res.clean, false, "a donor person-name hit must keep the scan dirty");
});

test("a pure place atom with no person collision is still excusable", () => {
  const donorNoPerson = { name: "plumbing-premier", donor_city: "Brandon", persons: [], socials: [] };
  const res = identityScan(files, donorNoPerson, CLIENT);
  const excusedTokens = (res.excused || []).map((h) => String(h.token || "").toLowerCase());
  const hitTokens = (res.hits || []).map((h) => String(h.token || "").toLowerCase());
  // Either it was excused, or it never became a hit — both mean the client's
  // own verified place did not fail the build.
  assert.ok(
    excusedTokens.includes("brandon") || !hitTokens.includes("brandon"),
    `client's own place should not fail the build; hits=${JSON.stringify(res.hits || [])}`,
  );
});

test("strict mode (no client) keeps every donor atom authoritative", () => {
  const res = identityScan(files, DONOR, null);
  const tokens = (res.hits || []).map((h) => String(h.token || "").toLowerCase());
  assert.ok(tokens.includes("brandon"), "without a client allowlist nothing may be excused");
});
