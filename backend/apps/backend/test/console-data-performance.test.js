"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const modulePaths = {
  handler: require.resolve("../api/admin/console-data"),
  adminAuth: require.resolve("../lib/admin-auth"),
  http: require.resolve("../lib/http"),
  registry: require.resolve("../lib/registry"),
  envCompat: require.resolve("../lib/env-compat"),
  outreachDns: require.resolve("../lib/outreach-dns"),
  store: require.resolve("../lib/store"),
  email: require.resolve("../lib/email"),
  deliveryPause: require.resolve("../lib/delivery-pause"),
};

const qcPass = {
  hero_media: { passed: true, evidence: "nested hero" },
  business_identity: { passed: true, evidence: "identity" },
  map: { passed: true, evidence: "map" },
  brand: { passed: true, evidence: "brand" },
  photos: { passed: true, evidence: "photos" },
  internal_terms: { passed: true, evidence: "terms" },
  social_meta: { passed: true, evidence: "social" },
  activation_rail: { passed: true, evidence: "activation" },
  checkout: { passed: true, evidence: "checkout" },
  accessibility: { passed: true, evidence: "accessibility" },
  unused_qc_blob: "not selected",
};

const rootContactEnrichment = {
  outreach: {
    review_hold: true,
    hold_reasons: ["email_suppressed"],
    sendable_email: null,
  },
};

const fullProspects = [{
  prospect_id: "p-1",
  status: "previewed",
  business_name: "Exact Roofing",
  email: "owner@example.test",
  owner_email: null,
  phone: "4805550100",
  current_website: "https://exact.example",
  industry: "roofing",
  city: "Mesa",
  state: "AZ",
  leadminer_score: 92,
  preview_url: "https://preview.example",
  source: "gbp",
  updated_at: "2026-07-25T12:00:00.000Z",
  canonical_prospect_id: "p-1",
  merged_into_prospect_id: null,
  ref_code: "ROOT-REF",
  contact_enrichment: rootContactEnrichment,
  outreach_hold_reasons: ["email_suppressed"],
  outreach_review_hold: true,
  record: {
    place_id: null,
    business_name: null,
    current_website: null,
    phone: null,
    city: null,
    state: null,
    address: null,
    postal_code: null,
    truth_packet: {
      gbp: { name: "GBP fallback", photos: ["large unused photo metadata"] },
      unused_truth_blob: "not selected",
    },
    siteforge: null,
    build: null,
    preview_build: null,
    renderer: "siteforge-renderer-v8",
    release_ready: true,
    hero_media: null,
    qc: qcPass,
    category: "roofing",
    batch_id: "batch-1",
    unused_record_blob: "x".repeat(100_000),
  },
}, {
  prospect_id: "p-alias",
  status: "merged",
  business_name: "Exact Roof Alias",
  email: null,
  owner_email: null,
  phone: null,
  current_website: null,
  industry: "roofing",
  city: "Mesa",
  state: "AZ",
  leadminer_score: 10,
  preview_url: null,
  source: "legacy",
  updated_at: "2026-07-25T11:00:00.000Z",
  canonical_prospect_id: "p-1",
  merged_into_prospect_id: "p-1",
  record: {
    business_name: "Exact Roof Alias",
    address: "1 Main St",
    city: "Mesa",
    state: "AZ",
    unused_record_blob: "y".repeat(100_000),
  },
}];

const compactProspects = [{
  prospect_id: "p-1",
  status: "previewed",
  business_name: "Exact Roofing",
  email: "owner@example.test",
  owner_email: null,
  phone: "4805550100",
  current_website: "https://exact.example",
  industry: "roofing",
  city: "Mesa",
  state: "AZ",
  leadminer_score: 92,
  preview_url: "https://preview.example",
  source: "gbp",
  updated_at: "2026-07-25T12:00:00.000Z",
  canonical_prospect_id: "p-1",
  merged_into_prospect_id: null,
  root_extras: {
    ref_code: "ROOT-REF",
    contact_enrichment: rootContactEnrichment,
    outreach_hold_reasons: ["email_suppressed"],
    outreach_review_hold: true,
  },
  record: {
    place_id: null,
    business_name: null,
    current_website: null,
    phone: null,
    city: null,
    state: null,
    address: null,
    postal_code: null,
    truth_packet: { gbp: { name: "GBP fallback" } },
    siteforge: null,
    build: null,
    preview_build: null,
    renderer: "siteforge-renderer-v8",
    release_ready: true,
    hero_media: null,
    qc: {
      hero_media: qcPass.hero_media,
      business_identity: qcPass.business_identity,
      map: qcPass.map,
      brand: qcPass.brand,
      photos: qcPass.photos,
      internal_terms: qcPass.internal_terms,
      social_meta: qcPass.social_meta,
      activation_rail: qcPass.activation_rail,
      checkout: qcPass.checkout,
      accessibility: qcPass.accessibility,
    },
    category: "roofing",
    batch_id: "batch-1",
  },
}, {
  prospect_id: "p-alias",
  status: "merged",
  business_name: "Exact Roof Alias",
  email: null,
  owner_email: null,
  phone: null,
  current_website: null,
  industry: "roofing",
  city: "Mesa",
  state: "AZ",
  leadminer_score: 10,
  preview_url: null,
  source: "legacy",
  updated_at: "2026-07-25T11:00:00.000Z",
  canonical_prospect_id: "p-1",
  merged_into_prospect_id: "p-1",
  root_extras: {},
  record: {
    business_name: "Exact Roof Alias",
    address: "1 Main St",
    city: "Mesa",
    state: "AZ",
  },
}];

const fullEmails = [{
  prospect_id: "p-1",
  sequence: 1,
  step: 1,
  sent_at: "2026-07-25T12:01:00.000Z",
  suppressed: false,
  mode: "sent",
  payload: {
    resendId: "message-1",
    subject: "Your preview",
    to: "owner@example.test",
    runId: null,
    unused_provider_blob: "x".repeat(50_000),
  },
}];

const compactEmails = [{
  ...fullEmails[0],
  payload: {
    resendId: "message-1",
    subject: "Your preview",
    to: "owner@example.test",
    runId: null,
  },
}];

const fullEvents = [{
  id: "event-1",
  type: "resend.webhook",
  prospect_id: "p-1",
  created_at: "2026-07-25T12:02:00.000Z",
  payload: {
    type: "email.delivered",
    prospectId: null,
    email_id: "message-1",
    unused_event_blob: "x".repeat(50_000),
  },
}, {
  id: "event-2",
  type: "system.run",
  created_at: "2026-07-25T12:03:00.000Z",
  payload: {
    runId: "run-1",
    stage: "built",
    status: "ok",
    category: "roofing",
    location: "Mesa, AZ",
    found: 2,
    selected: 1,
    built: 1,
    queued: 0,
    sent: 0,
    reason: null,
  },
}];

const compactEvents = [{
  id: "event-1",
  type: "resend.webhook",
  created_at: "2026-07-25T12:02:00.000Z",
  root_extras: { prospect_id: "p-1" },
  payload: {
    type: "email.delivered",
    prospectId: null,
    email_id: "message-1",
  },
}, {
  id: "event-2",
  type: "system.run",
  created_at: "2026-07-25T12:03:00.000Z",
  root_extras: {},
  payload: { ...fullEvents[1].payload },
}];

const fullAgentEvents = [{
  id: "agent-event-1",
  type: "agent.completed",
  created_at: "2026-07-25T12:04:00.000Z",
  payload: {
    actor: "agent_00_orchestrator",
    telemetry: "completed",
    code: null,
    unused_agent_blob: "x".repeat(50_000),
  },
}];

const compactAgentEvents = [{
  type: "agent.completed",
  created_at: "2026-07-25T12:04:00.000Z",
  payload: {
    actor: "agent_00_orchestrator",
    telemetry: "completed",
    code: null,
  },
}];

function mockedModule(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function clone(value) {
  return structuredClone(value);
}

function stableSnapshot(value) {
  const snapshot = clone(value);
  snapshot.generatedAt = "<generated>";
  snapshot.drip.nextRun = "<next-run>";
  return snapshot;
}

function createHarness({ mode = "compact", delayMs = 0, ttlMs = 3_000, prospectRows, emailRows } = {}) {
  const originals = new Map(Object.values(modulePaths).map((filename) => [filename, require.cache[filename]]));
  const previousTtl = process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_TTL_MS;
  const previousStale = process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_STALE_MS;
  process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_TTL_MS = String(ttlMs);
  process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_STALE_MS = "30000";
  const calls = [];
  const selectedProspects = prospectRows || (mode === "legacy" ? fullProspects : compactProspects);
  const selectedEmails = emailRows || (mode === "legacy" ? fullEmails : compactEmails);
  const state = { fail: false, failTable: null, deliveryCalls: 0 };
  const pause = () => delayMs ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();

  mockedModule(modulePaths.adminAuth, { requireAdmin: () => true });
  mockedModule(modulePaths.http, {
    handleError: (res, error) => {
      res.status = error.statusCode || 500;
      res.body = {
        ok: false,
        error: error.code || "internal_error",
        message: error.message || String(error),
      };
    },
    methodGuard: () => true,
    sendJson: (res, status, body) => {
      res.status = status;
      res.body = body;
    },
  });
  mockedModule(modulePaths.registry, {
    providerStatus: () => ({
      resend: {
        webhookConfigured: true,
        unsubscribeConfigured: true,
        postalAddressConfigured: true,
      },
      vapi: { cleanLaneConfigured: true },
    }),
  });
  mockedModule(modulePaths.envCompat, {
    outreachFromStatus: () => ({ ok: true, reason: "" }),
  });
  mockedModule(modulePaths.outreachDns, {
    outreachDnsStatus: async () => ({ ok: true, checks: {} }),
  });
  mockedModule(modulePaths.email, { reviewHoldActive: () => false });
  mockedModule(modulePaths.deliveryPause, {
    deliveryPauseStatus: async () => {
      state.deliveryCalls += 1;
      await pause();
      return state.fail
        ? { active: true, known: false, reason: "delivery_pause_status_unavailable" }
        : { active: false, known: true, reason: "" };
    },
  });
  mockedModule(modulePaths.store, {
    selectRows: async (table, options) => {
      calls.push({ kind: "selectRows", table, options });
      await pause();
      if (state.fail || state.failTable === table) {
        return { mode: "live_select_failed", status: 0, error: { code: "read_timeout" }, rows: [] };
      }
      if (table.startsWith("ghost_agency_console_") && mode === "legacy") {
        return { mode: "live_select_failed", status: 404, error: { code: "PGRST205" }, rows: [] };
      }
      if (table === "ghost_agency_console_prospects_v1") return { mode: "live_select", rows: clone(selectedProspects) };
      if (table === "ghost_agency_console_email_log_v1") return { mode: "live_select", rows: clone(selectedEmails) };
      if (table === "ghost_agency_console_events_v1") return { mode: "live_select", rows: clone(compactEvents) };
      if (table === "ghost_agency_prospects") return { mode: "live_select", rows: clone(selectedProspects) };
      if (table === "ghost_agency_email_log") return { mode: "live_select", rows: clone(selectedEmails) };
      if (table === "ghost_agency_events") return { mode: "live_select", rows: clone(fullEvents) };
      throw new Error(`unexpected table: ${table}`);
    },
    select: async (table, query) => {
      calls.push({ kind: "select", table, query });
      await pause();
      if (state.fail || state.failTable === table) {
        return { ok: false, mode: "live_select_failed", status: 0, error: { code: "read_timeout" }, data: [] };
      }
      if (table === "ghost_agency_console_events_v1" && mode === "legacy") {
        return { ok: false, mode: "live_select_failed", status: 404, error: { code: "PGRST205" }, data: [] };
      }
      if (table === "ghost_agency_console_events_v1") {
        return { ok: true, mode: "live_select", data: clone(compactAgentEvents) };
      }
      if (table === "ghost_agency_events") {
        return { ok: true, mode: "live_select", data: clone(fullAgentEvents) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  });

  delete require.cache[modulePaths.handler];
  const handler = require(modulePaths.handler);
  return {
    calls,
    state,
    async request(expectedStatus = 200) {
      const res = {};
      await handler({ method: "GET" }, res);
      assert.equal(res.status, expectedStatus);
      return res.body;
    },
    cleanup() {
      delete require.cache[modulePaths.handler];
      for (const [filename, original] of originals) {
        if (original) require.cache[filename] = original;
        else delete require.cache[filename];
      }
      if (previousTtl === undefined) delete process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_TTL_MS;
      else process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_TTL_MS = previousTtl;
      if (previousStale === undefined) delete process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_STALE_MS;
      else process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_STALE_MS = previousStale;
    },
  };
}

test("compact views deep-match the legacy full-row payload, including null precedence and root fallbacks", async () => {
  const legacy = createHarness({ mode: "legacy" });
  let legacyBody;
  try {
    legacyBody = await legacy.request();
  } finally {
    legacy.cleanup();
  }

  const compact = createHarness({ mode: "compact" });
  try {
    const compactBody = await compact.request();
    assert.deepEqual(stableSnapshot(compactBody), stableSnapshot(legacyBody));
    assert.equal(compactBody.recentProspects[0].ref_code, "ROOT-REF");
    assert.equal(compactBody.recentProspects[0].qcEvidence.gates[0].passed, false);
    assert.deepEqual(compactBody.recentProspects[0].qcEvidence.failedGates, ["heroMedia"]);
    assert.equal(compactBody.prospectIdentity.unidentifiableRows, 1);
    assert.equal(compactBody.totals.sendable, 0);
    assert.equal(compactBody.needsAction.contactHold, 1);
    assert.equal(compactBody.engagement.delivered, 1);
    assert.equal(compactBody.feed[0].summary, "for Exact Roofing");
  } finally {
    compact.cleanup();
  }
});

test("recent prospect sent state comes from unsuppressed sent email logs without changing workflow status", async () => {
  const suppressedProspect = {
    ...clone(compactProspects[0]),
    prospect_id: "p-suppressed",
    canonical_prospect_id: "p-suppressed",
    business_name: "Suppressed Roofing",
    email: "suppressed@example.test",
    record: { ...clone(compactProspects[0].record), business_name: "Suppressed Roofing" },
  };
  const suppressedEmail = {
    ...clone(compactEmails[0]),
    prospect_id: "p-suppressed",
    suppressed: true,
    payload: { ...clone(compactEmails[0].payload), to: "suppressed@example.test" },
  };
  const harness = createHarness({
    prospectRows: [clone(compactProspects[0]), suppressedProspect],
    emailRows: [clone(compactEmails[0]), suppressedEmail],
  });
  try {
    const body = await harness.request();
    const sentProspect = body.recentProspects.find((prospect) => prospect.prospect_id === "p-1");
    const suppressed = body.recentProspects.find((prospect) => prospect.prospect_id === "p-suppressed");
    assert.equal(sentProspect.status, "previewed");
    assert.equal(sentProspect.sent, true);
    assert.equal(suppressed.status, "previewed");
    assert.equal(suppressed.sent, false);
  } finally {
    harness.cleanup();
  }
});

test("short snapshot caching covers sequential and concurrent polls without stale-provider fanout", async () => {
  const sequential = createHarness();
  try {
    const first = await sequential.request();
    const second = await sequential.request();
    assert.deepEqual(stableSnapshot(second), stableSnapshot(first));
    assert.equal(sequential.calls.filter((call) => call.kind === "selectRows").length, 3);
    assert.equal(sequential.calls.filter((call) => call.kind === "select").length, 1);
    assert.equal(sequential.state.deliveryCalls, 1);
  } finally {
    sequential.cleanup();
  }

  const concurrent = createHarness({ delayMs: 20 });
  try {
    const [first, second] = await Promise.all([concurrent.request(), concurrent.request()]);
    assert.deepEqual(stableSnapshot(second), stableSnapshot(first));
    assert.equal(concurrent.calls.filter((call) => call.kind === "selectRows").length, 3);
    assert.equal(concurrent.calls.filter((call) => call.kind === "select").length, 1);
    assert.equal(concurrent.state.deliveryCalls, 1);
  } finally {
    concurrent.cleanup();
  }
});

test("expired snapshots serve stale rows on provider failure but keep delivery readiness fail-closed", async () => {
  const harness = createHarness({ ttlMs: 250 });
  try {
    const fresh = await harness.request();
    await new Promise((resolve) => setTimeout(resolve, 275));
    harness.state.fail = true;
    const stale = await harness.request();
    assert.deepEqual(stale.totals, fresh.totals);
    assert.deepEqual(stale.engagement, fresh.engagement);
    assert.equal(stale.drip.deliveryPause.active, true);
    assert.match(stale.hardStops.join(" "), /delivery pause/i);
    assert.equal(harness.calls.filter((call) => call.kind === "selectRows").length, 6);
    assert.equal(harness.calls.filter((call) => call.kind === "select").length, 2);
    assert.equal(harness.state.deliveryCalls, 2);
  } finally {
    harness.cleanup();
  }
});

test("cold-start source failure returns unavailable instead of a zeroed successful snapshot", async () => {
  const harness = createHarness();
  harness.state.failTable = "ghost_agency_console_prospects_v1";
  try {
    const body = await harness.request(503);
    assert.deepEqual(body, {
      ok: false,
      error: "console_source_snapshot_unavailable",
      message: "Console source snapshot is temporarily unavailable",
    });
    assert.equal(body.totals, undefined);
    assert.equal(harness.state.deliveryCalls, 1);
  } finally {
    harness.cleanup();
  }
});

test("Supabase reads abort with bounded, non-secret failure objects", async () => {
  const originalStore = require.cache[modulePaths.store];
  const originalRegistry = require.cache[modulePaths.registry];
  const originalFetch = global.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousTimeout = process.env.GHOST_AGENCY_STORE_READ_TIMEOUT_MS;
  process.env.SUPABASE_URL = "https://supabase-timeout.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GHOST_AGENCY_STORE_READ_TIMEOUT_MS = "250";
  mockedModule(modulePaths.registry, {
    providerStatus: () => ({ supabase: { configured: true } }),
  });
  global.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  delete require.cache[modulePaths.store];
  try {
    const { select, selectRows } = require(modulePaths.store);
    const started = Date.now();
    const [rows, data] = await Promise.all([
      selectRows("ghost_agency_events", { limit: 1 }),
      select("ghost_agency_events", "?select=id&limit=1"),
    ]);
    assert.ok(Date.now() - started < 1_000);
    assert.deepEqual(rows.error, {
      code: "read_timeout",
      category: "provider_timeout",
      retryable: true,
    });
    assert.deepEqual(data.error, rows.error);
    assert.deepEqual(rows.rows, []);
    assert.deepEqual(data.data, []);
    assert.doesNotMatch(JSON.stringify([rows, data]), /test-service-role-key/);
    global.fetch = async () => ({
      ok: true,
      json: () => new Promise(() => {}),
    });
    const bodyStarted = Date.now();
    const stalledBody = await selectRows("ghost_agency_events", { limit: 1 });
    assert.ok(Date.now() - bodyStarted < 1_000);
    assert.equal(stalledBody.error.code, "read_timeout");
  } finally {
    global.fetch = originalFetch;
    if (originalStore) require.cache[modulePaths.store] = originalStore;
    else delete require.cache[modulePaths.store];
    if (originalRegistry) require.cache[modulePaths.registry] = originalRegistry;
    else delete require.cache[modulePaths.registry];
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    if (previousTimeout === undefined) delete process.env.GHOST_AGENCY_STORE_READ_TIMEOUT_MS;
    else process.env.GHOST_AGENCY_STORE_READ_TIMEOUT_MS = previousTimeout;
  }
});

test("migration supplies compact security-invoker views and matching partial/global indexes", () => {
  const source = fs.readFileSync(require.resolve("../supabase/console-data-performance.sql"), "utf8");
  assert.match(source, /ghost_console_record_projection/);
  assert.match(source, /ghost_console_qc_projection/);
  assert.match(source, /security_invoker\s*=\s*true/g);
  assert.match(source, /ghost_agency_prospects \(updated_at desc\)/i);
  assert.match(source, /ghost_agency_email_log \(sent_at desc\)/i);
  assert.match(source, /where \(payload ->> 'actor'\) is not null/i);
  assert.match(source, /where type = 'outreach\.delivery_pause'/i);
  assert.doesNotMatch(source, /record\s+as\s+record/i);
});
