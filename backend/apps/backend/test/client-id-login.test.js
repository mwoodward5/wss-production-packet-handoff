"use strict";
// The customer holds exactly one credential — the Client ID printed in their
// email. These tests pin that it works, that it is a one-time door rather than
// a standing key, and that an ambiguous code is refused instead of guessed.
const test = require("node:test");
const assert = require("node:assert");
const {
  resolveClientId, codesFor, hashSecret, loginVerdict, passwordProblem,
} = require("../lib/client-id-login");
const { clientReferenceCode } = require("../lib/client-reference");

const HARRIS = { prospect_id: "wss-test-harris-air-west-sacramento", business_name: "Harris Air" };
const ROSE = { prospect_id: "wss-test-rose-city-heating-and-air-portland", business_name: "Rose City" };
const CODE = clientReferenceCode(HARRIS);

test("the code printed in the email is the code that logs them in", () => {
  assert.match(CODE, /^WSS-[0-9A-F]{6}$/);
  const out = resolveClientId(CODE, [HARRIS, ROSE]);
  assert.equal(out.ok, true);
  assert.equal(out.prospect.business_name, "Harris Air");
});

test("however a tired owner types it", () => {
  for (const typed of [CODE.toLowerCase(), CODE.replace("-", " "), CODE.replace("WSS-", ""), ` ${CODE} `]) {
    assert.equal(resolveClientId(typed, [HARRIS, ROSE]).ok, true, `failed on ${JSON.stringify(typed)}`);
  }
});

test("a registered code on the reference column resolves too, not just derived ones", () => {
  const registered = { prospect_id: "x", business_name: "Registered Co", reference: "PVLNGW" };
  assert.equal(resolveClientId("PVLNGW", [registered]).ok, true);
  // codesFor returns CANONICAL forms, so a bare registered code appears as
  // "WSS-PVLNGW" — matching is done on the normalized value at both ends,
  // which is why the customer can type it either way.
  assert.ok(codesFor(registered).includes("WSS-PVLNGW"), codesFor(registered).join(","));
  // and its derived code still resolves too, so a registered prospect keeps
  // working if an older email quoted the derived one
  assert.equal(codesFor(registered).length, 2);
});

test("an unknown code is a refusal, not the nearest business", () => {
  assert.equal(resolveClientId("WSS-000000", [HARRIS, ROSE]).reason, "no_such_client_id");
  // "hello" is refused for the right reason: it is a legal code SHAPE
  // (registered codes are 6-char alphanumeric like PVLNGW, so a hex-only test
  // would reject every registered prospect) and simply matches nobody. The
  // distinction matters — "that is not a code" and "no account has that code"
  // are different sentences to a customer squinting at their phone.
  assert.equal(resolveClientId("hello", [HARRIS]).reason, "no_such_client_id");
});

test("input that cannot be a code at all says so, rather than searching for it", () => {
  for (const junk of ["", "   ", "!!!", "-", null, undefined]) {
    assert.equal(resolveClientId(junk, [HARRIS]).reason, "not_a_client_id",
      `failed on ${JSON.stringify(junk)}`);
  }
});

test("two businesses answering to one code is refused, never a coin flip", () => {
  const twin = { prospect_id: "other", business_name: "Twin", reference: CODE };
  const out = resolveClientId(CODE, [HARRIS, twin]);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "client_id_ambiguous",
    "picking one would read a stranger their own account");
});

test("first visit: the Client ID opens the door exactly once, to set a password", () => {
  const v = loginVerdict({ row: { job_id: "j1" } });
  assert.equal(v.ok, true);
  assert.equal(v.mustSetPassword, true);
});

test("after a password exists, the Client ID alone no longer gets in", () => {
  const row = { job_id: "j1", password_hash: hashSecret("hunter22!", "j1") };
  assert.equal(loginVerdict({ row }).ok, false, "a forwarded email must stop being a key");
  assert.equal(loginVerdict({ row }).reason, "password_required");
  assert.equal(loginVerdict({ row, password: "wrong" }).reason, "wrong_password");
  assert.equal(loginVerdict({ row, password: "hunter22!" }).ok, true);
});

test("the salt is per-account, so one stolen hash does not unlock another", () => {
  const a = hashSecret("same-password", "job-a");
  const b = hashSecret("same-password", "job-b");
  assert.notEqual(a, b);
});

test("passwords a plumber will actually set, but not a guessable one", () => {
  assert.equal(passwordProblem("longenough1"), "");
  assert.match(passwordProblem("short"), /8 characters/);
  assert.match(passwordProblem("        "), /8 characters/);
  assert.match(passwordProblem("x".repeat(500)), /too long/);
});
