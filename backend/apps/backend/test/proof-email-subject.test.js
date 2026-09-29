"use strict";
// test/proof-email-subject.test.js
//
// Regression lock for the Flint proof email (msg 57d0a6ee), whose subject shipped
//   "PROOF: Flint Plumbing LLC site is live — before/after, 0 errors, 0.2s load [INTERNAL TEST]"
// while the body had already been corrected to a measured value. The subject is
// held to the same bar as the body: a performance claim is DATA or it is ABSENT.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProofEmailSubject,
  formatLoadSeconds,
  measuredLoadLabel,
  proofEmailSubject,
  unsupportedPerfClaim,
} = require("../lib/proof-email-subject");
const { pchSubject, SUBJECT_POOL } = require("../lib/outreach-email-v2");

// The three shapes an unbacked perf claim takes. Identical to the tripwire's own
// list on purpose — a subject that trips any of these with no measurement behind
// it is a lie, however it is phrased.
const NO_ZERO_ERRORS = /\b0 errors\b/i;
const NO_TIMING = /\d+(\.\d+)?\s*s\b/i;
const NO_SPEED_ADJECTIVES = /fast|instant|blazing/i;

const BUSINESS = "Flint Plumbing LLC";

test("no measurement supplied -> the subject carries NO performance claim", () => {
  for (const measured of [undefined, null, {}, "", 0, NaN, -1, "0.2"]) {
    const subject = proofEmailSubject({ businessName: BUSINESS, measured, internalTest: true });

    assert.doesNotMatch(subject, NO_ZERO_ERRORS, `"0 errors" leaked for measured=${JSON.stringify(measured)}`);
    assert.doesNotMatch(subject, NO_TIMING, `a timing figure leaked for measured=${JSON.stringify(measured)}`);
    assert.doesNotMatch(subject, NO_SPEED_ADJECTIVES, `a speed adjective leaked for measured=${JSON.stringify(measured)}`);

    // Still a usable subject, not a stub.
    assert.match(subject, /^PROOF: Flint Plumbing LLC site is live/);
    assert.ok(subject.includes("[INTERNAL TEST]"));
  }
});

test("a measured metric may appear — and still no '0 errors'", () => {
  const { subject, measuredLabel } = buildProofEmailSubject({
    businessName: BUSINESS,
    measured: { loadSeconds: 0.42 },
    internalTest: true,
  });

  assert.equal(measuredLabel, "0.42s");
  assert.ok(subject.includes("0.42s"), `expected the measured figure in: ${subject}`);
  assert.doesNotMatch(subject, NO_ZERO_ERRORS);
  assert.doesNotMatch(subject, NO_SPEED_ADJECTIVES);
});

test("the printed figure is the measured value, never a prettied one", () => {
  // 0.42 must not round to "0.4" — the subject reports what the clock said.
  assert.equal(measuredLoadLabel({ loadMs: 420 }), "0.42s");
  assert.equal(measuredLoadLabel({ medianMs: 216 }), "0.22s"); // the { medianMs, samples } shape
  assert.equal(measuredLoadLabel(0.42), "0.42s");
  assert.equal(formatLoadSeconds(1), "1s");

  // Non-measurements are not measurements.
  for (const bad of [null, undefined, {}, "0.42", { loadMs: "420" }, { loadMs: 0 }, { loadMs: NaN }, -3]) {
    assert.equal(measuredLoadLabel(bad), null, `treated ${JSON.stringify(bad)} as a measurement`);
  }
});

test("the tripwire judges OUR copy, not the client's name", () => {
  // A real client may be called "Fast Eddie's". That is their name, not our claim.
  const subject = proofEmailSubject({ businessName: "Fast Eddie's Plumbing", measured: null, internalTest: true });
  assert.match(subject, /Fast Eddie's Plumbing/);
  assert.equal(unsupportedPerfClaim(subject, { businessName: "Fast Eddie's Plumbing" }), null);

  // But our own words are caught.
  assert.equal(unsupportedPerfClaim("PROOF: Acme site is live — 0 errors", { businessName: "Acme" }), "0 errors");
  assert.equal(unsupportedPerfClaim("PROOF: Acme site is live — 0.2s load", { businessName: "Acme" }), "0.2s");
  // ...unless the figure is the measured one that was handed in.
  assert.equal(
    unsupportedPerfClaim("PROOF: Acme site is live — 0.2s load", { businessName: "Acme", measuredLabel: "0.2s" }),
    null,
  );
});

test("the exact subject that shipped can no longer be produced", () => {
  const shipped = "PROOF: Flint Plumbing LLC site is live — before/after, 0 errors, 0.2s load [INTERNAL TEST]";
  const withMeasurement = proofEmailSubject({
    businessName: BUSINESS,
    measured: { medianMs: 200 },
    internalTest: true,
  });
  assert.notEqual(withMeasurement, shipped);
  assert.doesNotMatch(withMeasurement, NO_ZERO_ERRORS);
});

test("cold-outreach subjects carry no performance claim either", () => {
  for (const variant of SUBJECT_POOL) {
    assert.doesNotMatch(variant, NO_ZERO_ERRORS);
    assert.doesNotMatch(variant, NO_SPEED_ADJECTIVES);
  }
  const subject = pchSubject({ businessName: "Hamstra Heating & Cooling", city: "Tucson", prospectId: "p1" });
  assert.doesNotMatch(subject, NO_ZERO_ERRORS);
  assert.doesNotMatch(subject, NO_TIMING);
  assert.doesNotMatch(subject, NO_SPEED_ADJECTIVES);
});
