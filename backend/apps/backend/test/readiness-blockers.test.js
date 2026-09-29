"use strict";

// R1: /api/admin/readiness returned ready:false while the caller-visible blocker
// list was absent, with reviewHold and deliveryPause reported only as detached
// top-level fields. A blocked verdict that does not enumerate its causes is the
// same shape as checks.brand passing while logoImgs=0.
//
// These tests pin the invariant on the WIRE RESPONSE, not on source text:
//     ready === false  =>  blockers.length > 0
// and pin that reviewHold and deliveryPause each name themselves when active.

const assert = require("node:assert/strict");
const test = require("node:test");

const modulePaths = {
  handler: require.resolve("../api/admin/readiness"),
  adminAuth: require.resolve("../lib/admin-auth"),
  http: require.resolve("../lib/http"),
  registry: require.resolve("../lib/registry"),
  envCompat: require.resolve("../lib/env-compat"),
  outreachDns: require.resolve("../lib/outreach-dns"),
  email: require.resolve("../lib/email"),
  deliveryPause: require.resolve("../lib/delivery-pause"),
  readinessBlockers: require.resolve("../lib/readiness-blockers"),
};

function mockedModule(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const CLEAR_PROVIDERS = {
  resend: { webhookConfigured: true, unsubscribeConfigured: true, postalAddressConfigured: false },
  vapi: { cleanLaneConfigured: true },
};

function createHarness({
  providers = CLEAR_PROVIDERS,
  outreachSender = { ok: true, from: "Mark at Woodward <mark@go.wss-ai.com>", domain: "go.wss-ai.com" },
  outreachDns = { ok: true, checks: {} },
  reviewHold = false,
  deliveryPause = { active: false, known: true, reason: "" },
} = {}) {
  const originals = new Map(Object.values(modulePaths).map((filename) => [filename, require.cache[filename]]));

  mockedModule(modulePaths.adminAuth, { requireAdmin: () => true });
  mockedModule(modulePaths.http, {
    handleError: (res, error) => {
      res.status = 500;
      res.body = { ok: false, error: String(error && error.message) };
    },
    methodGuard: () => true,
    sendJson: (res, status, body) => {
      res.status = status;
      res.body = body;
    },
  });
  mockedModule(modulePaths.registry, { providerStatus: () => structuredClone(providers) });
  mockedModule(modulePaths.envCompat, { outreachFromStatus: () => structuredClone(outreachSender) });
  mockedModule(modulePaths.outreachDns, { outreachDnsStatus: async () => structuredClone(outreachDns) });
  mockedModule(modulePaths.email, { reviewHoldActive: () => reviewHold === true });
  mockedModule(modulePaths.deliveryPause, { deliveryPauseStatus: async () => structuredClone(deliveryPause) });

  delete require.cache[modulePaths.handler];
  const handler = require(modulePaths.handler);
  return {
    async request(expectedStatus = 200) {
      const res = {};
      await handler({ method: "GET", headers: {} }, res);
      assert.equal(res.status, expectedStatus);
      return res.body;
    },
    cleanup() {
      delete require.cache[modulePaths.handler];
      for (const [filename, original] of originals) {
        if (original) require.cache[filename] = original;
        else delete require.cache[filename];
      }
    },
  };
}

function codes(body) {
  return (body.blockers || []).map((blocker) => blocker.code);
}

// Every gate, alone, plus the state the endpoint is actually in right now.
const BLOCKING_STATES = [
  ["outreach sender", { outreachSender: { ok: false, reason: "GHOST_AGENCY_OUTREACH_FROM missing" } }, "outreach_sender_unconfigured"],
  ["outreach DNS", { outreachDns: { ok: false, checks: {} } }, "outreach_dns_records_missing"],
  ["resend webhook", { providers: { ...CLEAR_PROVIDERS, resend: { ...CLEAR_PROVIDERS.resend, webhookConfigured: false } } }, "resend_webhook_secret_missing"],
  ["unsubscribe secret", { providers: { ...CLEAR_PROVIDERS, resend: { ...CLEAR_PROVIDERS.resend, unsubscribeConfigured: false } } }, "unsubscribe_secret_missing"],
  ["postal without unsubscribe", { providers: { ...CLEAR_PROVIDERS, resend: { webhookConfigured: true, unsubscribeConfigured: false, postalAddressConfigured: true } } }, "postal_address_without_unsubscribe"],
  ["vapi clean lane", { providers: { ...CLEAR_PROVIDERS, vapi: { cleanLaneConfigured: false } } }, "vapi_clean_lane_unconfigured"],
  ["review hold", { reviewHold: true }, "review_hold_active"],
  ["delivery pause", { deliveryPause: { active: true, known: true, reason: "owner_reset_remine_pending_email_approval" } }, "delivery_pause_active"],
];

test("ready:false always enumerates at least one blocker, for every single blocking gate", async () => {
  for (const [label, overrides, expectedCode] of BLOCKING_STATES) {
    const harness = createHarness(overrides);
    try {
      const body = await harness.request();
      assert.equal(body.ready, false, `${label}: expected ready:false`);
      // The invariant under test.
      assert.ok(body.blockers.length > 0, `${label}: ready:false shipped an empty blockers[]`);
      assert.ok(codes(body).includes(expectedCode), `${label}: missing blocker code ${expectedCode}, got ${codes(body).join(",")}`);
      for (const blocker of body.blockers) {
        assert.equal(typeof blocker.code, "string", `${label}: blocker missing machine code`);
        assert.ok(blocker.code.length > 0, `${label}: blocker has an empty code`);
        assert.equal(typeof blocker.reason, "string", `${label}: blocker missing human reason`);
        assert.ok(blocker.reason.trim().length > 0, `${label}: blocker has an empty reason`);
      }
    } finally {
      harness.cleanup();
    }
  }
});

test("reviewHold:true is named in blockers[], not only as a detached top-level field", async () => {
  const harness = createHarness({ reviewHold: true });
  try {
    const body = await harness.request();
    assert.equal(body.reviewHold, true);
    assert.equal(body.ready, false);
    const blocker = body.blockers.find((entry) => entry.code === "review_hold_active");
    assert.ok(blocker, `reviewHold:true but no blocker names it; got ${codes(body).join(",")}`);
    assert.match(blocker.reason, /review hold/i);
  } finally {
    harness.cleanup();
  }
});

test("deliveryPause.active is named in blockers[] and carries its owner reason", async () => {
  const harness = createHarness({
    deliveryPause: { active: true, known: true, reason: "owner_reset_remine_pending_email_approval" },
  });
  try {
    const body = await harness.request();
    assert.equal(body.deliveryPause.active, true);
    assert.equal(body.ready, false);
    const blocker = body.blockers.find((entry) => entry.code === "delivery_pause_active");
    assert.ok(blocker, `deliveryPause active but no blocker names it; got ${codes(body).join(",")}`);
    assert.match(blocker.reason, /delivery pause/i);
    assert.match(blocker.reason, /owner_reset_remine_pending_email_approval/);
    assert.equal(blocker.detail.reasonCode, "owner_reset_remine_pending_email_approval");
  } finally {
    harness.cleanup();
  }
});

test("a delivery pause with no stated reason still names itself rather than reporting nothing", async () => {
  const harness = createHarness({ deliveryPause: { active: true, known: false, reason: "" } });
  try {
    const body = await harness.request();
    assert.equal(body.ready, false);
    const blocker = body.blockers.find((entry) => entry.code === "delivery_pause_active");
    assert.ok(blocker);
    assert.match(blocker.reason, /threshold crossed/i);
    assert.equal(blocker.detail.known, false);
  } finally {
    harness.cleanup();
  }
});

test("both owner gates active reports both blockers, and the current live shape", async () => {
  const harness = createHarness({
    reviewHold: true,
    deliveryPause: { active: true, known: true, reason: "owner_reset_remine_pending_email_approval" },
  });
  try {
    const body = await harness.request();
    assert.equal(body.ready, false);
    assert.deepEqual(codes(body), ["review_hold_active", "delivery_pause_active"]);
    assert.equal(body.reviewHold, true);
    assert.equal(body.deliveryPause.active, true);
  } finally {
    harness.cleanup();
  }
});

test("hardStops stays the reason list of blockers[], so existing consoles do not drift", async () => {
  const harness = createHarness({
    providers: { resend: { webhookConfigured: false, unsubscribeConfigured: false, postalAddressConfigured: false }, vapi: { cleanLaneConfigured: false } },
    outreachDns: { ok: false, checks: {} },
    reviewHold: true,
    deliveryPause: { active: true, known: true, reason: "owner_reset_remine_pending_email_approval" },
  });
  try {
    const body = await harness.request();
    assert.equal(body.ready, false);
    assert.deepEqual(body.hardStops, body.blockers.map((blocker) => blocker.reason));
    // The exact strings the console and prod-hardening-probe already render.
    assert.deepEqual(body.hardStops, [
      "go.wss-ai.com SPF/DKIM/DMARC DNS records missing at authoritative nameservers",
      "GHOST_AGENCY_RESEND_WEBHOOK_SECRET missing",
      "EMAIL_UNSUB_SECRET missing",
      "VAPI_LOCAL_GROWTH_ASSISTANT_ID and VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID missing",
      "Cold outreach review hold is active",
      "Cold outreach delivery pause is active: owner_reset_remine_pending_email_approval",
    ]);
  } finally {
    harness.cleanup();
  }
});

test("a fully clear board still reports ready:true with an empty blockers[]", async () => {
  const harness = createHarness();
  try {
    const body = await harness.request();
    assert.equal(body.ready, true);
    assert.deepEqual(body.blockers, []);
    assert.deepEqual(body.hardStops, []);
  } finally {
    harness.cleanup();
  }
});

test("postal address set WITH unsubscribe configured stays a note, not a blocker", async () => {
  const harness = createHarness({
    providers: { ...CLEAR_PROVIDERS, resend: { webhookConfigured: true, unsubscribeConfigured: true, postalAddressConfigured: true } },
  });
  try {
    const body = await harness.request();
    assert.equal(body.ready, true);
    assert.deepEqual(body.blockers, []);
    assert.equal(body.notes.length, 1);
    assert.match(body.notes[0], /unsubscribe-chain/);
  } finally {
    harness.cleanup();
  }
});

test("readinessVerdict refuses to let a blocked verdict ship with no named cause", () => {
  const { readinessVerdict, UNKNOWN_BLOCKER_CODE } = require("../lib/readiness-blockers");

  // A caller that decides ready:false some other way still cannot report nothing.
  const rescued = readinessVerdict({ ready: false, blockers: [] });
  assert.equal(rescued.ready, false);
  assert.equal(rescued.blockers.length, 1);
  assert.equal(rescued.blockers[0].code, UNKNOWN_BLOCKER_CODE);
  assert.ok(rescued.blockers[0].reason.trim().length > 0);

  // A caller cannot claim ready:true while naming blockers either.
  const contradiction = readinessVerdict({ ready: true, blockers: [{ code: "x", reason: "still blocked" }] });
  assert.equal(contradiction.ready, false);
  assert.equal(contradiction.blockers.length, 1);

  // Derived form is the pre-existing hardStops.length === 0 semantics.
  assert.equal(readinessVerdict({ blockers: [] }).ready, true);
  assert.equal(readinessVerdict({ blockers: [{ code: "x", reason: "y" }] }).ready, false);

  // Blockers with no reason are the exact defect this module exists to stop,
  // so an all-empty list is treated as naming nothing and gets rescued.
  const empties = readinessVerdict({ ready: false, blockers: [{ code: "x", reason: "   " }, null, {}] });
  assert.equal(empties.blockers.length, 1);
  assert.equal(empties.blockers[0].code, UNKNOWN_BLOCKER_CODE);

  // Every reported blocker carries a machine code even when the caller omits one.
  const coerced = readinessVerdict({ blockers: ["a bare string reason"] });
  assert.equal(coerced.blockers[0].code, "unspecified_blocker");
  assert.equal(coerced.blockers[0].reason, "a bare string reason");
});
