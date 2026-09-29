"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const forge = require("../lib/forge.js");

// REGRESSION LOCK (2026-07-29). Owner directive (Task 3): show BOTH phone
// numbers side by side on the mirror — GBP + website — as a deliberate hook.
// After PR #193 mergeAttestedFacts unshifts the attested GBP phone to the
// front of dossier.phones and the website line demotes to index 1+. {{PHONE}}
// resolves to the GBP number via firstFact; {{PHONE_ALT}} must resolve to the
// FIRST distinct website line — never a second formatting of the primary.

test("{{PHONE_ALT}} returns the second distinct phone (GBP then website)", () => {
  const dossier = { phones: [
    { value: "(713) 630-2882", source: "google-business-profile" },
    { value: "832-555-0177",   source: "https://allthetimeplumbing.com/contact" },
  ]};
  assert.equal(forge.secondDistinctPhone(dossier), "832-555-0177");
});

test("{{PHONE_ALT}} skips reformattings of the primary phone", () => {
  const dossier = { phones: [
    { value: "(713) 630-2882", source: "google-business-profile" },
    { value: "+1 713 630 2882", source: "https://allthetimeplumbing.com/" },     // same digits, different formatting
    { value: "713.630.2882",   source: "https://www.bbb.org/us/tx/houston" },    // same digits again
    { value: "832-555-0177",   source: "https://allthetimeplumbing.com/contact" },
  ]};
  assert.equal(forge.secondDistinctPhone(dossier), "832-555-0177");
});

test("{{PHONE_ALT}} returns \"\" when there is only one distinct verified number", () => {
  const dossier = { phones: [
    { value: "(713) 630-2882", source: "google-business-profile" },
    { value: "+1 713 630 2882", source: "https://allthetimeplumbing.com/" },
  ]};
  assert.equal(forge.secondDistinctPhone(dossier), "");
});

test("{{PHONE_ALT}} is OPTIONAL and collapses when nothing is verified", () => {
  assert.equal(forge.secondDistinctPhone({}), "");
  assert.equal(forge.secondDistinctPhone({ phones: [] }), "");
  assert.equal(forge.secondDistinctPhone({ phones: [{ value: "" }, { value: "   " }] }), "");
  assert.equal(forge.secondDistinctPhone(null), "");
});

test("{{PHONE_ALT}} short-digit fragments do not count as phones", () => {
  const dossier = { phones: [
    { value: "(713) 630-2882", source: "google-business-profile" },
    { value: "ext. 4",         source: "scraped-noise" },
    { value: "832-555-0177",   source: "https://allthetimeplumbing.com/contact" },
  ]};
  // Even though 'ext. 4' produces empty last-10 suffix (only 1 digit),
  // secondDistinctPhone must skip it and return the real second line.
  assert.equal(forge.secondDistinctPhone(dossier), "832-555-0177");
});

test("mergeAttestedFacts + secondDistinctPhone: full path", () => {
  // Website scrape yielded 832-555-0177 first; GBP attestation is 713-630-2882.
  // After merge the GBP wins position 0, website is second, {{PHONE_ALT}} = website.
  const dossier = { phones: [
    { value: "832-555-0177", source: "https://allthetimeplumbing.com/" },
  ]};
  forge.mergeAttestedFacts(dossier, { phone: "(713) 630-2882" });
  assert.equal(forge.firstFact(dossier, "phones"), "(713) 630-2882");
  assert.equal(forge.secondDistinctPhone(dossier), "832-555-0177");
});
