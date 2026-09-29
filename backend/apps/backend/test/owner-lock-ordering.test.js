"use strict";

// ============================================================================
// D1 — AUTHORIZATION IS THE FIRST QUESTION, NOT A LATE FILTER.
//
// GHOST_AGENCY_PROSPECT_SEND_ENABLED (the owner lock) used to sit below
// composition, at the point of send. When the proof-first gate landed above it,
// every prospect without a build was refused for "no_preview_url" and the
// authorization decision was NEVER EVALUATED. Nothing shipped — no provider call
// is made on either path — so the lock looked like it was holding. It was
// holding by accident of ordering. Float the proof gate one line higher, or
// give an un-built prospect a preview, and the lock silently stops applying.
//
// These tests assert the ORDER OF THE DECISIONS, not the absence of a send.
// "Nothing was sent" is also what a crash looks like, so it is not evidence.
// Both gates are instrumented and every case asserts the exact sequence of
// gates that ran:
//
//   owner lock passes  -> proof gate runs and gives the refusal
//   owner lock refuses -> proof gate never runs at all
//
// The instrumentation delegates to the real implementations and changes no
// behaviour; it only records that a decision was taken and what it was. Both
// spies must be installed BEFORE lib/email.js is first required, because
// lib/email.js destructures these functions at load time — hence the module-
// scope require order below, which is load-bearing.
// ============================================================================

const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");

const trace = [];

const sendPolicy = require("../lib/send-policy");
const realProspectSendsEnabled = sendPolicy.prospectSendsEnabled;
sendPolicy.prospectSendsEnabled = function spiedProspectSendsEnabled(...args) {
  const verdict = realProspectSendsEnabled(...args);
  trace.push(`owner_lock:${verdict ? "enabled" : "locked"}`);
  return verdict;
};

const outreachEmailV2 = require("../lib/outreach-email-v2");
const realProofReadiness = outreachEmailV2.proofReadiness;
outreachEmailV2.proofReadiness = function spiedProofReadiness(...args) {
  const ready = realProofReadiness(...args);
  trace.push(`proof_gate:${ready && ready.ok ? "ok" : (ready && ready.reason) || "unknown"}`);
  return ready;
};

// Load order matters: the spies above must already be in place.
const { sendSequenceStep } = require("../lib/email");

// SNAPSHOT, NEVER THE LIVE ARRAY. `trace` is reset between tests, and
// node:assert renders its diff from the object it was handed — so asserting on
// `trace` itself produces a failure message describing whatever the NEXT test
// pushed into it. The first run of this file against the pre-fix ordering
// reported `actual: ['proof_gate:ok']` for a case whose actual trace was
// `['proof_gate:no_preview_url']`. A test whose failure message is wrong is
// worse than no test, because it sends the next reader after the wrong gate.
function gates() {
  return trace.slice();
}

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

let providerCalls = 0;

function unbuiltProspect(overrides = {}) {
  // A real mined lead the day it is mined: contactable, no site built yet.
  return {
    prospect_id: "owner-lock-ordering-1",
    business_name: "Roofing Example",
    email: "roofing@example.org",
    city: "Irvine",
    industry: "roofing",
    ...overrides,
  };
}

function builtProspect(overrides = {}) {
  // The same lead after the mirror is built and the before-shot is recorded as
  // having been captured from the prospect's own domain — i.e. a prospect the
  // proof gate has no reason to refuse.
  return unbuiltProspect({
    preview_url: "https://roofing-example.wss-ai.com/",
    current_website: "https://roofing-example.example/",
    before_shot_source_url: "https://www.roofing-example.example/",
    ...overrides,
  });
}

function sendableEnvironment() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  delete process.env.GHOST_AGENCY_REVIEW_HOLD;
}

// Suppression is the only lookup allowed to happen. Anything else reaching the
// network on a blocked path is itself the failure.
function stubSuppressionOnly() {
  providerCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("ghost_agency_suppressions")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [],
      };
    }
    providerCalls += 1;
    throw new Error(`no provider call is permitted on a blocked path: ${url}`);
  };
}

beforeEach(() => {
  trace.length = 0;
  sendableEnvironment();
  stubSuppressionOnly();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROL. The half that actually catches the regression.
//
// An un-built prospect is the exact input that used to short-circuit above the
// lock. With the lock OPEN it must REACH the authorization decision and PASS it,
// and only then be refused by the proof gate. If the gates are ever reordered
// back, the owner-lock entry disappears from the trace and this fails — even
// though the returned `blocked` value would be identical.
// ---------------------------------------------------------------------------
test("owner lock is evaluated and PASSES for an un-built prospect, before the proof gate refuses", async () => {
  process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED = "true";

  const result = await sendSequenceStep({
    prospect: unbuiltProspect(),
    sequence: 1,
    step: 1,
    dryRun: false,
  });

  // THE DECISION WAS TAKEN, and it was taken first.
  assert.deepEqual(gates(), ["owner_lock:enabled", "proof_gate:no_preview_url"]);

  // The proof gate is intact: an un-built prospect is still refused, for the
  // build reason, with the operator-facing message unchanged.
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "no_preview_url");
  assert.match(result.message, /Build the site first/i);
  assert.equal(providerCalls, 0);
});

// ---------------------------------------------------------------------------
// NEGATIVE. The lock engaged must produce the LOCK's refusal, not whichever
// gate happens to fire first. This is the same un-built prospect as above, so
// the only difference in the outcome is the authorization decision itself.
// ---------------------------------------------------------------------------
test("an un-built prospect with the lock engaged is refused for the owner lock, not the proof gate", async () => {
  delete process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED;

  const result = await sendSequenceStep({
    prospect: unbuiltProspect(),
    sequence: 1,
    step: 1,
    dryRun: false,
  });

  // The lock ran and refused; the proof gate was never consulted.
  assert.deepEqual(gates(), ["owner_lock:locked"]);

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "prospect_sends_disabled");
  assert.notEqual(result.blocked, "no_preview_url");
  assert.match(result.message, /owner-locked/i);
  assert.match(result.message, /GHOST_AGENCY_PROSPECT_SEND_ENABLED/);
  assert.equal(providerCalls, 0);
});

// A live prospect WITH a build — nothing for the proof gate to complain about —
// is still refused by the lock, and refused before composition.
test("a fully built live prospect is refused by the owner lock", async () => {
  delete process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED;

  const result = await sendSequenceStep({
    prospect: builtProspect(),
    sequence: 1,
    step: 1,
    dryRun: false,
  });

  assert.deepEqual(gates(), ["owner_lock:locked"]);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "prospect_sends_disabled");
  assert.equal(result.htmlPreview, undefined, "a refused send composes nothing");
  assert.equal(providerCalls, 0);
});

// The malformed/mis-set flag is the same as no flag: fail closed, and still by
// the lock rather than by something downstream.
test("a malformed owner-lock flag fails closed at the lock", async () => {
  for (const value of ["", "  ", "false", "0", "no", "maybe", "TRUE-ish"]) {
    trace.length = 0;
    process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED = value;
    const result = await sendSequenceStep({
      prospect: builtProspect(),
      sequence: 1,
      step: 1,
      dryRun: false,
    });
    assert.deepEqual(gates(), ["owner_lock:locked"], `flag ${JSON.stringify(value)}`);
    assert.equal(result.blocked, "prospect_sends_disabled", `flag ${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// The dry-run return is an early return too, so the decision has to be taken
// above it. Dry runs remain EXEMPT — they compose and send nothing — but exempt
// is a consequence of the decision, not a reason to skip taking it. Written as
// one short-circuited condition the lock was never consulted on this lane at
// all, which is exactly the unobservable state D1 is about.
// ---------------------------------------------------------------------------
test("the owner-lock decision is taken before the dry-run return, and dry runs stay exempt", async () => {
  delete process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED;

  const result = await sendSequenceStep({
    prospect: builtProspect(),
    sequence: 1,
    step: 1,
    dryRun: true,
  });

  assert.equal(gates()[0], "owner_lock:locked", "the decision is taken on the dry-run lane too");
  assert.ok(gates().includes("proof_gate:ok"), "a dry run still clears the proof gate");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mode, "dry_run");
  assert.equal(result.dryRun, true);
  assert.equal(providerCalls, 0);
});
