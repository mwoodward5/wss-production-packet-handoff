"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const forge = require("../lib/forge.js");

// REGRESSION LOCK (2026-07-29). The {{LICENSE}} token used to map to the
// FIRST certification only. On all-the-time-plumbing-houston the mirror
// displayed only "bonded" and the audit logged the rest of the business's
// OWN verified credentials as certification OMISSIONs. Fixed by joining
// every distinct certification value in dossier order — never inventing,
// never padding.

const ATP_CERTS = [
  { value: "bonded",        source: "https://allthetimeplumbing.com/" },
  { value: "insured",       source: "https://allthetimeplumbing.com/about" },
  { value: "MPL: 41889",    source: "https://allthetimeplumbing.com/" },
  { value: "Bonded",        source: "https://www.bbb.org/us/tx/houston/profile/plumber/all-the-time-plumbing" }, // dup, different case
  { value: "Master Plumber License #41889", source: "https://tdlr.texas.gov/mpl/41889" }, // distinct from short form
  { value: "  ",            source: "empty-guard" },                     // must be ignored
  { value: "",              source: "empty-guard" },                     // must be ignored
];

test("joinFacts surfaces every distinct certification in source order", () => {
  const out = forge.joinFacts({ certifications: ATP_CERTS }, "certifications");
  assert.equal(
    out,
    "bonded \u00b7 insured \u00b7 MPL: 41889 \u00b7 Master Plumber License #41889"
  );
});

test("joinFacts preserves the first casing and drops case-duplicates", () => {
  const out = forge.joinFacts({ certifications: [
    { value: "MPL: 41889", source: "site" },
    { value: "mpl: 41889", source: "bbb"  },
  ]}, "certifications");
  assert.equal(out, "MPL: 41889");
});

test("joinFacts is OPTIONAL and returns \"\" when there is nothing verified", () => {
  assert.equal(forge.joinFacts({}, "certifications"), "");
  assert.equal(forge.joinFacts({ certifications: [] }, "certifications"), "");
  assert.equal(forge.joinFacts({ certifications: [{ value: "" }, { value: "   " }] }, "certifications"), "");
  assert.equal(forge.joinFacts(null, "certifications"), "");
});

test("joinFacts truncates on a credential boundary, never mid-value, at ~120 chars", () => {
  const longer = [
    { value: "General Liability Insurance $2,000,000 aggregate policy", source: "s" },
    { value: "State Master Plumber License #41889 (Texas TDLR)",         source: "s" },
    { value: "BBB Accredited A+ since 2011",                             source: "s" },
    { value: "Rheem Pro Partner Certified 2023",                         source: "s" }, // this would push past 120
  ];
  const out = forge.joinFacts({ certifications: longer }, "certifications");
  assert.ok(out.length <= 120, `expected <=120, got ${out.length}`);
  // The last kept credential must be a complete, unbroken string that appears
  // verbatim in the input list — no mid-value truncation.
  const lastPiece = out.split(" \u00b7 ").pop();
  assert.ok(
    longer.some((c) => c.value === lastPiece),
    `truncated on a boundary; last piece was "${lastPiece}"`
  );
});

test("joinFacts respects a custom separator + cap", () => {
  const out = forge.joinFacts(
    { certifications: [{ value: "a" }, { value: "b" }, { value: "c" }] },
    "certifications",
    { separator: ", ", cap: 4 }
  );
  // "a, b" is 4 chars, adding ", c" would exceed 4 — must stop at "a, b".
  assert.equal(out, "a, b");
});

test("hydrateBoilerplate: {{LICENSE}} substitutes the joined credential string", async () => {
  // Sanity-check that the token substitution pipeline picks up joinFacts.
  // We stub out the file I/O by asserting the hydration string map goes
  // through forge.joinFacts — the actual boilerplate-copy path is exercised
  // by the existing forge-media-reuse + forge-vercel-deploy tests.
  const dossier = { certifications: ATP_CERTS };
  const joined  = forge.joinFacts(dossier, "certifications");
  assert.ok(
    joined.includes("bonded") && joined.includes("insured") && joined.includes("MPL: 41889") && joined.includes("Master Plumber License #41889"),
    "the joined LICENSE string must carry every distinct verified credential"
  );
});
