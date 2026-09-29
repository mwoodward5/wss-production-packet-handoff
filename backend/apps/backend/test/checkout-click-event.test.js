"use strict";

// ---------------------------------------------------------------------------
// test/checkout-click-event.test.js — THE TOP OF THE CONVERSION FUNNEL.
//
// /api/checkout-link minted a Stripe session on click but recorded nothing:
// completions arrived (the webhook writes stripe_webhook for every event)
// while the click itself left no durable trace, so "how many businesses
// opened checkout" was unanswerable and the CONVERT station had no funnel to
// stand on. These tests hold the recording shut:
//
//   * A verified click records exactly one checkout.click event carrying the
//     signed prospect identity and nothing invented.
//   * The event is idempotent by construction: recordEvent's deterministic
//     id is a function of (type, payload), so repeat clicks by the same
//     prospect collapse onto one durable row.
//   * Recording is best-effort ONLY: a failing ledger can never alter the
//     redirect a paying business is waiting on.
//   * An unverifiable token is a scan, not a click, and records nothing.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { afterEach, test } = require("node:test");

const { buildCheckoutLink, verifyCheckoutLink, CHECKOUT_SECRET_ENV_NAME } = require("../lib/checkout-links");
const { deterministicEventId } = require("../lib/store");
const { createCheckoutLinkHandler } = require("../api/checkout-link");

const SECRET = "checkout-click-test-secret";
const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

const PROSPECT = Object.freeze({
  prospect_id: "acme-roofing-ventura",
  business_name: "Acme Roofing",
  industry: "roofing",
  city: "Ventura",
  state: "CA",
});

function mintedLink(jobId = "mirror-acme-roofing-ventura", prospect = PROSPECT) {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";
  const link = buildCheckoutLink({ prospect, job: { id: jobId } });
  const url = new URL(link);
  return { token: url.searchParams.get("token"), sig: url.searchParams.get("sig") };
}

function signedRequest({ token, sig }, overrides = {}) {
  return {
    method: "GET",
    query: { token, sig },
    headers: {},
    ...overrides,
  };
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    raw: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") { this.raw = String(payload || ""); },
  };
}

function captureRecorder() {
  const calls = [];
  return {
    calls,
    recordEvent: async (type, payload) => {
      calls.push({ type, payload });
      return { mode: "live_write" };
    },
  };
}

function stripeMintCapture() {
  const mints = [];
  return {
    mints,
    createCheckoutSession: async (input) => {
      mints.push(input);
      return { mode: "checkout_session", configured: true, url: "https://checkout.stripe.test/c/pay_acme" };
    },
  };
}

function baseDeps() {
  const recorder = captureRecorder();
  const mint = stripeMintCapture();
  return {
    recorder,
    mint,
    deps: {
      select: async () => ({ ok: true, data: [] }),
      recordEvent: recorder.recordEvent,
      createCheckoutSession: mint.createCheckoutSession,
      publicConfig: () => ({ publicAppUrl: "https://app.wss-ai.com/" }),
    },
  };
}

// ===========================================================================
// A VERIFIED CLICK RECORDS EXACTLY ONE EVENT
// ===========================================================================

test("a verified click records one checkout.click event with the signed prospect identity and source", async () => {
  const { recorder, mint, deps } = baseDeps();
  const handler = createCheckoutLinkHandler(deps);
  const res = fakeRes();
  await handler(signedRequest(mintedLink()), res);

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, "https://checkout.stripe.test/c/pay_acme");
  assert.equal(recorder.calls.length, 1, JSON.stringify(recorder.calls));
  const call = recorder.calls[0];
  assert.equal(call.type, "checkout.click");
  assert.deepEqual(call.payload, {
    jobId: "mirror-acme-roofing-ventura",
    prospectId: "acme-roofing-ventura",
    businessName: "Acme Roofing",
    industry: "roofing",
    city: "Ventura",
    state: "CA",
    source: "signed_checkout_link",
  });
  // The click was recorded before the session was minted: the funnel event
  // must not depend on Stripe's availability.
  assert.equal(mint.mints.length, 1);
});

test("a click that falls back to contact still counted — the click happened even when checkout minting did not", async () => {
  const recorder = captureRecorder();
  const handler = createCheckoutLinkHandler({
    ...baseDeps().deps,
    recordEvent: recorder.recordEvent,
    createCheckoutSession: async () => ({ mode: "dry_run", configured: false }),
  });
  const res = fakeRes();
  await handler(signedRequest(mintedLink()), res);

  assert.equal(res.statusCode, 302);
  assert.match(res.headers.Location, /^https:\/\/app\.wss-ai\.com\/factory-os\?checkout=contact/);
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].type, "checkout.click");
});

// ===========================================================================
// IDEMPOTENT BY CONSTRUCTION
// ===========================================================================

test("repeat clicks by the same prospect collapse onto one deterministic event id", async () => {
  const { recorder, deps } = baseDeps();
  const handler = createCheckoutLinkHandler(deps);
  const link = mintedLink();

  for (let i = 0; i < 3; i += 1) {
    const res = fakeRes();
    await handler(signedRequest(link), res);
    assert.equal(res.statusCode, 302);
  }

  assert.equal(recorder.calls.length, 3, "the handler attempts the write on every click");
  const ids = new Set(recorder.calls.map(({ type, payload }) => deterministicEventId(type, payload)));
  assert.equal(ids.size, 1, "recordEvent's deterministic id must dedupe these onto one durable row");
});

test("different prospects produce different event ids — one funnel row per business", async () => {
  const { recorder, deps } = baseDeps();
  const handler = createCheckoutLinkHandler(deps);
  const harborRidge = { ...PROSPECT, prospect_id: "harbor-ridge-lane", business_name: "Harbor Ridge Roofing" };

  for (const [jobId, prospect] of [
    ["mirror-acme-roofing-ventura", PROSPECT],
    ["mirror-harbor-ridge-lane", harborRidge],
  ]) {
    const res = fakeRes();
    await handler(signedRequest(mintedLink(jobId, prospect)), res);
    assert.equal(res.statusCode, 302);
  }

  const ids = recorder.calls.map(({ type, payload }) => deterministicEventId(type, payload));
  assert.equal(new Set(ids).size, 2);
});

// ===========================================================================
// RECORDING IS BEST-EFFORT ONLY — CHECKOUT CAN NEVER BE BLOCKED BY IT
// ===========================================================================

test("a failing or throwing ledger never changes the redirect", async () => {
  for (const failingRecord of [
    async () => { throw new Error("supabase down"); },
    async () => ({ mode: "live_write_failed", status: 409 }),
  ]) {
    const handler = createCheckoutLinkHandler({
      ...baseDeps().deps,
      recordEvent: failingRecord,
    });
    const res = fakeRes();
    await handler(signedRequest(mintedLink()), res);
    assert.equal(res.statusCode, 302, "a ledger hiccup must not block a paying business");
    assert.equal(res.headers.Location, "https://checkout.stripe.test/c/pay_acme");
  }
});

test("a failing prospect enrichment never changes the redirect", async () => {
  const { recorder, deps } = baseDeps();
  const handler = createCheckoutLinkHandler({
    ...deps,
    select: async () => {
      throw new Error("db unavailable");
    },
  });
  const res = fakeRes();
  await handler(signedRequest(mintedLink()), res);
  assert.equal(res.statusCode, 302);
  assert.equal(recorder.calls.length, 1);
});

// ===========================================================================
// AN UNVERIFIABLE TOKEN IS A SCAN, NOT A CLICK
// ===========================================================================

test("an invalid signature records nothing and stays a 401", async () => {
  const { recorder, deps } = baseDeps();
  const handler = createCheckoutLinkHandler(deps);
  const { token } = mintedLink();
  const res = fakeRes();
  await handler(signedRequest({ token, sig: "forged-signature" }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(recorder.calls.length, 0);
});

test("an expired link records nothing and stays a 410", async () => {
  const { recorder, deps } = baseDeps();
  const handler = createCheckoutLinkHandler(deps);
  const realNow = Date.now;
  let link;
  try {
    // Mint in the far past so the payload's exp is already behind us.
    Date.now = () => realNow() - (60 * 24 * 60 * 60 * 1000);
    link = mintedLink();
  } finally {
    Date.now = realNow;
  }
  assert.equal(verifyCheckoutLink(link.token, link.sig).ok, false);
  const res = fakeRes();
  await handler(signedRequest(link), res);
  assert.equal(res.statusCode, 410);
  assert.equal(recorder.calls.length, 0);
});

test("no signing secret configured records nothing — every token is refused", async () => {
  const { recorder, deps } = baseDeps();
  const handler = createCheckoutLinkHandler(deps);
  const { token, sig } = mintedLink();
  delete process.env[CHECKOUT_SECRET_ENV_NAME];
  const res = fakeRes();
  await handler(signedRequest({ token, sig }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(recorder.calls.length, 0);
});

test("non-GET methods are refused before anything is recorded", async () => {
  const { recorder, deps } = baseDeps();
  const handler = createCheckoutLinkHandler(deps);
  const link = mintedLink();
  for (const method of ["POST", "HEAD", "OPTIONS"]) {
    const res = fakeRes();
    await handler(signedRequest(link, { method }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET");
  }
  assert.equal(recorder.calls.length, 0);
});
