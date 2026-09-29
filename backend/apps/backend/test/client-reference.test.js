"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clientReferenceCode,
  normalizeReferenceCode,
  referenceBody,
  referenceMatches,
} = require("../lib/client-reference");

test("client reference code is the stable WSS-XXXXXX shown in outreach email", () => {
  const code = clientReferenceCode({ prospect_id: "urban-nail-bar-scottsdale" });
  assert.match(code, /^WSS-[0-9A-F]{6}$/);
  // Stable across calls: the same lead must show the same code on every send,
  // report, and phone call.
  assert.equal(code, clientReferenceCode({ prospect_id: "urban-nail-bar-scottsdale" }));
  assert.notEqual(code, clientReferenceCode({ prospect_id: "some-other-business" }));
});

test("prospect id wins over business name so a rename cannot change an issued code", () => {
  const a = clientReferenceCode({ prospect_id: "stable-id", business_name: "Original Name" });
  const b = clientReferenceCode({ prospect_id: "stable-id", business_name: "Renamed Later" });
  assert.equal(a, b);
});

test("falls back to the record blob, then to business name", () => {
  assert.match(clientReferenceCode({ record: { prospect_id: "from-record" } }), /^WSS-[0-9A-F]{6}$/);
  assert.match(clientReferenceCode({ business_name: "Only A Name" }), /^WSS-[0-9A-F]{6}$/);
  assert.equal(clientReferenceCode({}), "", "nothing to seed => no code");
});

test("normalizes the code a caller reads to Riley over the phone", () => {
  const canonical = "WSS-1F9506";
  // The exact string printed in the email — this is the case the old
  // /^[A-Z0-9]{4,12}$/ check rejected outright because of the hyphen.
  assert.equal(normalizeReferenceCode("WSS-1F9506"), canonical);
  // Transcription noise from a spoken code.
  assert.equal(normalizeReferenceCode("wss-1f9506"), canonical);
  assert.equal(normalizeReferenceCode("WSS 1F9506"), canonical);
  assert.equal(normalizeReferenceCode("W S S - 1 F 9 5 0 6"), canonical);
  assert.equal(normalizeReferenceCode("wss1f9506"), canonical);
  // A phone transcriber spells the separator out as a WORD. Without stripping
  // it the input reads "WSSDASH1F9506" and fails the hex check entirely.
  assert.equal(normalizeReferenceCode("W S S dash 1 F 9 5 0 6"), canonical);
  assert.equal(normalizeReferenceCode("WSS hyphen 1F9506"), canonical);
  // Caller drops the prefix and just reads the digits.
  assert.equal(normalizeReferenceCode("1F9506"), canonical);
});

test("rejects input that cannot be a client code so lookup falls through to name/phone", () => {
  assert.equal(normalizeReferenceCode(""), "");
  assert.equal(normalizeReferenceCode(null), "");
  assert.equal(normalizeReferenceCode("AB Professional Detailing"), "");
  assert.equal(normalizeReferenceCode("XYZ"), "", "too short to be a code body");
  assert.equal(normalizeReferenceCode("WAY-TOO-LONG-TO-BE-A-CODE"), "", "too long");
});

test("resolves the REGISTERED alphanumeric codes too, not just derived hex", () => {
  // register-prospect.js mints and PERSISTS 6-char alphanumeric codes
  // (AB Professional Detailing = PVLNGW). A hex-only check would reject every
  // one of these and silently break the lookup path that already works.
  for (const registered of ["PVLNGW", "8LF2GC", "BFGSQ7", "VMQN80", "1O8B7J", "KMQZHF", "6MXAES"]) {
    assert.equal(referenceBody(registered), registered, `${registered} must survive normalization`);
    assert.equal(referenceMatches(registered, registered), true);
    assert.equal(referenceMatches(registered.toLowerCase(), registered), true);
  }
  assert.equal(referenceMatches("PVLNGW", "8LF2GC"), false, "different codes must not collide");
});

test("referenceMatches survives prefix drop and transcription noise", () => {
  const actual = clientReferenceCode({ prospect_id: "ab-professional-detailing" });
  const spokenBare = actual.replace("WSS-", "");
  assert.equal(referenceMatches(actual, actual), true);
  assert.equal(referenceMatches(spokenBare, actual), true);
  assert.equal(referenceMatches(spokenBare.toLowerCase(), actual), true);
  assert.equal(referenceMatches(spokenBare.split("").join(" "), actual), true);
  assert.equal(referenceMatches("WSS-000000", actual), false);
  assert.equal(referenceMatches("", actual), false);
});
