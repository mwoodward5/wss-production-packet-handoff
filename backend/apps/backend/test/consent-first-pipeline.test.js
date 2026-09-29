"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPreviewForProspect,
  consentFirstSendProspect,
  packetProspectForConsent,
  runFullSystem,
} = require("../lib/full-run");
const {
  hasRecordedPositivePreviewConsent,
  recordedPositivePreviewConsent,
} = require("../lib/preview-consent");
const nightlyHandler = require("../api/cron/nightly-pipeline");

test("preview consent fails closed unless a positive decision and timestamp were recorded", () => {
  assert.equal(hasRecordedPositivePreviewConsent({}), false);
  assert.equal(hasRecordedPositivePreviewConsent({
    record: { preview_build_consent: { status: "granted" } },
  }), false, "positive state without a durable timestamp is not enough");
  assert.equal(hasRecordedPositivePreviewConsent({
    record: {
      preview_build_consent: {
        status: "granted",
        recorded_at: "2026-07-29T12:00:00.000Z",
        source: "email_reply",
      },
    },
  }), true);
  assert.equal(
    recordedPositivePreviewConsent({
      previewBuildConsentStatus: "interested",
      previewBuildConsentAt: "2026-07-29T12:00:00.000Z",
    }).status,
    "interested",
  );
});

test("core preview build ignores request-body consent and fails closed without durable stored consent", async () => {
  let truthCalls = 0;
  let dispatchCalls = 0;
  const prospect = {
    prospect_id: "request-consent-is-not-durable",
    business_name: "Request Body Roofing",
    industry: "roofing",
    record: {
      preview_build_consent: {
        status: "granted",
        recorded_at: "2026-07-29T12:00:00.000Z",
        source: "admin_json",
      },
    },
  };
  const result = await buildPreviewForProspect(prospect, {
    persist: false,
    select: async () => ({
      ok: true,
      data: [{
        prospect_id: prospect.prospect_id,
        record: {
          business_name: prospect.business_name,
          industry: prospect.industry,
        },
      }],
    }),
    truthPacketWithLocalPlan: async () => {
      truthCalls += 1;
      return { meta: { source: "test" }, facts: {} };
    },
    dispatchSiteForgePreview: async () => {
      dispatchCalls += 1;
      return {};
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "recorded_positive_preview_consent_required");
  assert.equal(result.consent_store_status, "recorded_consent_missing");
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(truthCalls, 0);
  assert.equal(dispatchCalls, 0);
});

test("core preview build reaches Mirror only after a fresh stored consent check", async () => {
  let mirrorCalls = 0;
  let siteForgeCalls = 0;
  const prospect = {
    prospect_id: "durably-consented-build",
    business_name: "Durable Consent Plumbing",
    industry: "plumbing",
    city: "Irvine",
  };
  const result = await buildPreviewForProspect(prospect, {
    persist: false,
    select: async () => ({
      ok: true,
      data: [{
        prospect_id: prospect.prospect_id,
        record: {
          business_name: prospect.business_name,
          industry: prospect.industry,
          preview_build_consent: {
            status: "granted",
            recorded_at: "2026-07-29T12:00:00.000Z",
            source: "email_reply",
          },
        },
      }],
    }),
    truthPacketWithLocalPlan: async () => ({
      meta: { source: "test_intake" },
      facts: {},
      identity: { category: { value: "plumbing", verified: true } },
    }),
    buildMirrorForProspect: async () => {
      mirrorCalls += 1;
      return { ok: false, reason: "test_dispatch_hold" };
    },
    dispatchSiteForgePreview: async () => {
      siteForgeCalls += 1;
      throw new Error("fresh SiteForge dispatch must be unreachable");
    },
  });

  assert.equal(mirrorCalls, 1);
  assert.equal(siteForgeCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "test_dispatch_hold");
  assert.equal(result.siteforge_dispatched, false);
});

test("packet-only preparation persists packets, retires autosend, and never dispatches SiteForge", async () => {
  const writes = [];
  const prospect = {
    prospect_id: "consent-packet-1",
    business_name: "Consent Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    email: "owner@example.test",
    status: "new",
    record: {
      autosend: {
        run_id: "legacy-run",
        sandbox_mode: false,
        requested_at: "2026-07-28T00:00:00.000Z",
        status: "pending",
      },
    },
  };
  const result = await packetProspectForConsent(prospect, {
    now: () => Date.parse("2026-07-29T12:30:00.000Z"),
    truthPacketWithLocalPlan: async () => ({
      meta: { source: "test_intake" },
      facts: {},
      identity: { category: { value: "plumbing", verified: true } },
    }),
    upsertRow: async (...args) => {
      writes.push(args);
      return { ok: true, mode: "live_upsert" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.packeted, true);
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(result.autosend_created, false);
  assert.ok(result.packets.site.id);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].record.autosend.status, "abandoned");
  assert.match(writes[0][1].record.autosend.reason, /consent_first/);
  assert.equal(writes[0][1].record.preview_build_consent_gate.status, "blocked_until_recorded_positive_consent");
});

test("packet persistence cannot overwrite a concurrent do_not_contact record", async () => {
  const originalRecord = {
    owner_email: "Ops@ConsentPlumbing.COM",
    source: "durable_fixture",
  };
  const canonical = {
    prospect_id: "consent-packet-race",
    business_name: "Consent Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    email: null,
    owner_email: "Ops@ConsentPlumbing.COM",
    status: "new",
    updated_at: "2026-07-29T12:00:00.000Z",
    record: originalRecord,
  };
  let casCalls = 0;
  let upsertCalls = 0;

  const result = await packetProspectForConsent(canonical, {
    requireCanonicalGuard: true,
    now: () => Date.parse("2026-07-29T12:30:00.000Z"),
    select: async () => ({ ok: true, data: [canonical] }),
    truthPacketWithLocalPlan: async () => ({
      meta: { source: "test_intake" },
      facts: {},
      identity: { category: { value: "plumbing", verified: true } },
    }),
    conditionalUpdate: async (_table, _idColumn, _id, guards) => {
      casCalls += 1;
      assert.equal(guards.updated_at, "eq.2026-07-29T12:00:00.000Z");
      assert.equal(guards.status, "eq.new");
      assert.equal(guards.owner_email, "eq.Ops@ConsentPlumbing.COM");
      assert.equal(guards.email, "is.null");
      assert.equal(guards["record->>status"], "is.null");
      assert.equal(guards["record->>do_not_contact"], "is.null");
      assert.equal(Object.hasOwn(guards, "record"), false, "CAS guards stay compact");
      // Reproduce the dangerous legacy writer: only nested truth changes. The
      // compact JSON-path guards must make this CAS miss even though top-level
      // status, updated_at, and owner_email are all unchanged.
      canonical.record = {
        ...originalRecord,
        status: "do_not_contact",
        do_not_contact: true,
      };
      return { ok: true, updated: false };
    },
    upsertRow: async () => {
      upsertCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "consent_packet_persist_conflict");
  assert.equal(result.policyHold, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(result.provider_calls, 0);
  assert.equal(casCalls, 1);
  assert.equal(upsertCalls, 0);
  assert.equal(canonical.status, "new");
  assert.equal(canonical.updated_at, "2026-07-29T12:00:00.000Z");
  assert.equal(canonical.record.do_not_contact, true);
});

test("full-run sends only an artifact-free consent offer and performs zero builds", async () => {
  const source = {
    prospect_id: "consent-full-1",
    business_name: "Moral Roofing",
    industry: "roofing",
    city: "Orange",
    state: "CA",
    email: "dispatch@moralroofing.com",
    status: "new",
    preview_url: "https://moral-roofing.wss-ai.com/",
    checkout_url: "https://buy.example.test/old",
    report_url: "https://callprep.wss-ai.com/report/old",
    preview_expires_at: "2026-08-05T00:00:00.000Z",
    record: {
      preview_url: "https://moral-roofing.wss-ai.com/",
      checkout_url: "https://buy.example.test/old",
      report_url: "https://callprep.wss-ai.com/report/old",
      build_dispatch: { ready: true },
    },
  };
  let buildCalls = 0;
  const sendCalls = [];
  const result = await runFullSystem({
    count: 1,
    prospectIds: [source.prospect_id],
    dryRun: false,
    sandboxMode: true,
    _test: {
      ownerSandboxAddress: () => "owner@wss-test.example",
      select: async () => ({ ok: true, data: [source] }),
      progress: async () => null,
      emailLogExists: async () => ({ exists: false }),
      buildPreviewForProspect: async () => {
        buildCalls += 1;
        throw new Error("SiteForge must not run");
      },
      packetProspectForConsent: async (prospect) => ({
        ok: true,
        prospect_id: prospect.prospect_id,
        business_name: prospect.business_name,
        packeted: true,
        siteforge_dispatched: false,
        autosend_created: false,
        prospect,
      }),
      sendSequenceStep: async (args) => {
        sendCalls.push(args);
        return { ok: true, mode: "owner_only_proof", id: "local-test-only" };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(buildCalls, 0);
  assert.equal(result.built.length, 0);
  assert.equal(result.packeted.length, 1);
  assert.equal(sendCalls.length, 1);
  const sent = sendCalls[0];
  assert.equal(sent.vars.consent_first, true);
  for (const key of ["preview_url", "checkout_url", "report_url", "preview_expires_at", "build_dispatch"]) {
    assert.equal(Object.hasOwn(sent.prospect, key), false, `${key} stripped at cold-send boundary`);
    assert.equal(Object.hasOwn(sent.prospect.record, key), false, `record.${key} stripped at cold-send boundary`);
    assert.equal(Object.hasOwn(sent.vars, key), false, `vars.${key} not supplied`);
  }
});

test("nightly pipeline enriches/reports/packets but never invokes previewBuild", async () => {
  const calls = { enrich: 0, report: 0, packet: 0, previewBuild: 0 };
  const stages = {
    enrich: async () => { calls.enrich += 1; return { ok: true }; },
    report: async () => { calls.report += 1; return { ok: true }; },
    packetStage: async () => { calls.packet += 1; return { ok: true }; },
    previewBuild: async () => { calls.previewBuild += 1; return { ok: true }; },
  };
  const prospect = {
    prospect_id: "nightly-no-consent",
    business_name: "Nightly Plumbing",
    industry: "plumbing",
    leadminer_score: 99,
    status: "new",
  };
  const result = await nightlyHandler.processNightlyProspect(prospect, { stages, threshold: 80 });
  assert.deepEqual(calls, { enrich: 1, report: 1, packet: 1, previewBuild: 0 });
  assert.equal(result.prebuild, "blocked_until_recorded_positive_consent");
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(result.autosend_created, false);

  const consented = await nightlyHandler.processNightlyProspect({
    ...prospect,
    prospect_id: "nightly-consented",
    record: {
      preview_build_consent: {
        status: "granted",
        recorded_at: "2026-07-29T12:00:00.000Z",
        source: "email_reply",
      },
    },
  }, { stages, threshold: 80 });
  assert.equal(calls.previewBuild, 0, "even consented rows require an explicit post-reply build action");
  assert.equal(consented.prebuild, "explicit_post_reply_build_required");
});

test("consentFirstSendProspect removes nested and top-level prebuilt artifacts", () => {
  const clean = consentFirstSendProspect({
    business_name: "Acme",
    email: "owner@example.test",
    previewUrl: "https://preview.example.test",
    stripe_checkout_url: "https://checkout.stripe.com/example",
    screenshot_url: "https://preview.example.test/screenshot.png",
    iframe_html: "<iframe src=\"https://preview.example.test\"></iframe>",
    truth_packet: { assets: [{ url: "https://preview.example.test/screenshot.png" }] },
    siteforge_callback: { preview_url: "https://preview.example.test" },
    record: {
      checkoutUrl: "https://buy.example.test",
      purchase_url: "https://buy.example.test",
      forge_job: { stage: "done" },
    },
  });
  assert.equal(clean.business_name, "Acme");
  assert.equal(clean.consent_first, true);
  assert.equal(Object.hasOwn(clean, "previewUrl"), false);
  assert.equal(Object.hasOwn(clean, "stripe_checkout_url"), false);
  assert.equal(Object.hasOwn(clean, "screenshot_url"), false);
  assert.equal(Object.hasOwn(clean, "iframe_html"), false);
  assert.equal(Object.hasOwn(clean, "truth_packet"), false);
  assert.equal(Object.hasOwn(clean, "siteforge_callback"), false);
  assert.equal(Object.hasOwn(clean.record, "checkoutUrl"), false);
  assert.equal(Object.hasOwn(clean.record, "purchase_url"), false);
  assert.equal(Object.hasOwn(clean.record, "forge_job"), false);
});
