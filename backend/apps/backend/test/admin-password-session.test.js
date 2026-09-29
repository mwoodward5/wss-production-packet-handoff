"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const auth = require("../lib/admin-auth");
const password = require("../lib/admin-password");
const page = require("../lib/operator-workspace-page-final");

test("owner password sessions are signed and accepted without exposing the password", () => {
  const old = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-secret";
  try {
    // The session is issued on the REAL clock. It used to be issued at epoch
    // 1_000 — one second after 1 January 1970 — with the expiry window checked
    // against those same fake numbers. verifySessionToken took the clock as an
    // argument and agreed; adminAllowed does not, and reads Date.now(). So the
    // last assertion below was handed a token that had been expired for
    // fifty-odd years and this test could never pass on any machine. Anchoring
    // everything to one real `now` keeps the window checks exact while letting
    // the live-clock path see a token that is genuinely valid right now.
    const now = Date.now();
    const session = password.issueSession({ sessionVersion: 7, now, ttlMs: 60_000 });
    assert.ok(session && session.token.startsWith("wss1."));
    assert.equal(session.sessionVersion, 7, "the session carries the credential version that minted it");

    // Inside the window, signed by this secret: accepted.
    assert.equal(password.verifySessionToken(session.token, now + 2_000).ok, true);
    // Tampered signature: refused.
    assert.equal(password.verifySessionToken(session.token + "x", now + 2_000).ok, false);
    // Past the 60s ttl: refused.
    assert.equal(password.verifySessionToken(session.token, now + 70_000).ok, false);

    // And the live-clock path — the one a browser actually hits — accepts it.
    assert.equal(auth.adminAllowed({ headers: { "x-admin-token": session.token } }).allowed, true);

    // The password itself is nowhere in the artefact the browser carries: the
    // token is a signed claim about the credential VERSION, not the credential.
    const claim = JSON.parse(Buffer.from(session.token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(claim.sv, 7);
    assert.equal(claim.sub, "owner");
    assert.doesNotMatch(session.token, /test-admin-secret/, "the signing secret never rides in the token");
  } finally {
    if (old === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = old;
  }
});

test("scrypt password verifier is deterministic for its salt and passwords remain strong", () => {
  const salt = Buffer.from("0123456789abcdef", "utf8").toString("base64url");
  const one = password.hashPassword("correct horse battery staple", salt);
  const two = password.hashPassword("correct horse battery staple", salt);
  const wrong = password.hashPassword("wrong horse battery staple", salt);
  assert.equal(one, two);
  assert.notEqual(one, wrong);
  assert.equal(password.validateNewPassword("short"), "password_must_be_at_least_12_characters");
  assert.equal(password.validateNewPassword("long-enough-password"), "");
});

test("Command Center uses password login and exposes in-console password change", () => {
  assert.match(page, /Enter your owner password/i);
  assert.match(page, /\/api\/admin\/session/);
  assert.match(page, /id="changePassword"/);
  assert.match(page, /id="passwordModal"/);
  assert.match(page, /\/api\/admin\/password/);
  assert.doesNotMatch(page, /Enter the operator token/i);
});
