"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const test = require("node:test");

const {
  buildCallPrepRow,
  canonicalCallPrepReportUrl,
  customerSafePacket,
  existingCallPrepReportUrl,
  saveBusinessReport,
} = require("../lib/callprep-client");
const { createCallPrepReportHandler } = require("../api/adapters/callprep-report");

const REPORT_ID = "8f53c794-f32a-4cf6-a99b-52057b23fb8e";
const SECURE_ADAPTER_URL = "https://callprep-project.supabase.co/functions/v1/ghost-report-adapter";
const SECURE_SECRET = "test-secret-with-at-least-thirty-two-bytes";
const SECURE_NOW_MS = 1750000000000;
const IMMUTABLE_PACKET_ID = `wss-genie-cert-v1:${"a".repeat(64)}`;

function adapterFixture() {
  return {
    mode: "report_packet",
    configured: true,
    system: { name: "CallPrep / Rocket Search", role: "reseller report engine" },
    packet: {
      id: "report_123",
      businessName: "Measured Plumbing",
      market: "Phoenix, AZ",
      industry: "Plumbing",
      reportSystems: ["Rocket SERPs", "CallPrep"],
      requestedSignals: [
        "organic rankings",
        "Rocket Search reseller score",
        "AI visibility readiness",
      ],
      targetTerms: [
        { term: "roof repair Phoenix", currentRank: 7, mapsRank: 3, searchVolume: 170 },
        { term: "Rocket SERPs internal path", currentRank: 1 },
      ],
      deepLinks: { internal: "https://rocket-search.example.test" },
    },
    expectedOutput: "Rocket Search reseller report",
  };
}

function immutableAdapterFixture() {
  const adapter = adapterFixture();
  return {
    ...adapter,
    packet: { ...adapter.packet, id: IMMUTABLE_PACKET_ID },
  };
}

function secureEnv(overrides = {}) {
  return {
    CALLPREP_GHOST_ADAPTER_URL: SECURE_ADAPTER_URL,
    GHOST_REPORT_ADAPTER_HMAC_SECRET: SECURE_SECRET,
    ...overrides,
  };
}

function secureAdapterResponse(mode = "created") {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      mode,
      reportId: REPORT_ID,
      // The secure adapter still emits its historical audit route. Ghost must
      // derive the current customer route from reportId instead of trusting it.
      reportUrl: `https://callprep.wss-ai.com/report/audit/${REPORT_ID}`,
    }),
  };
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value = "") {
      this.rawBody = value;
      this.body = value ? JSON.parse(value) : null;
    },
  };
}

test("maps the existing adapter packet into a truthful customer-safe row", () => {
  const adapter = adapterFixture();
  const prospect = {
    businessName: "Measured Plumbing",
    industry: "Plumbing",
    currentWebsite: "https://measured-plumbing.example",
    phone: "+1 602 555 0101",
    address: "123 Main St, Phoenix, AZ 85001",
  };

  const packet = customerSafePacket(adapter, prospect);
  const row = buildCallPrepRow({ adapter, prospect });

  assert.deepEqual(packet.requestedSignals, ["organic rankings", "AI visibility readiness"]);
  assert.equal(Object.hasOwn(packet, "reportSystems"), false);
  assert.equal(Object.hasOwn(packet, "deepLinks"), false);
  assert.equal(row.business_name, "Measured Plumbing");
  assert.equal(row.business_url, "https://measured-plumbing.example/");
  assert.equal(row.overall_score, null);
  assert.equal(row.seo_score, null);
  assert.equal(row.data_availability.scores, "not_provided");
  assert.deepEqual(row.source_snapshot.serpIntelligence.targetTerms, [{
    term: "roof repair Phoenix",
    currentRank: 7,
    mapsRank: 3,
    searchVolume: 170,
  }]);
  assert.equal(row.source_snapshot.serpIntelligence.currentVisibility.measured, true);
  assert.equal(row.whiteLabel.tenantId, "wss");
  assert.doesNotMatch(JSON.stringify(row), /rocket\s+(?:search|serps?)|reseller/i);
});

test("maps real reputation + gaps into a populated, truthful row", () => {
  const adapter = adapterFixture();
  const prospect = {
    businessName: "Austin Air Conditioning",
    industry: "HVAC",
    city: "Austin",
    state: "TX",
    currentWebsite: "https://austinairconditioning.com/",
    rating: 4.9,
    review_count: 1226,
    weaknesses: ["No online booking on the website", "Not appearing in AI assistant answers"],
  };

  const row = buildCallPrepRow({ adapter, prospect });

  // Reputation is the one category ghost has real Google signals for.
  assert.equal(row.data_availability.reputation, "measured");
  assert.equal(typeof row.reviews_score, "number");
  assert.ok(row.reviews_score >= 80);
  assert.equal(row.overall_grade, "B+");
  assert.equal(row.reputation_metrics.availability, "measured");
  assert.equal(row.reputation_metrics.starRating, 4.9);
  assert.equal(row.reputation_metrics.reviewCount, 1226);
  // Everything ghost did not scan stays honestly unavailable — never a fake 0/F.
  assert.equal(row.data_availability.gbp, "not_provided");
  assert.equal(row.data_availability.website, "not_provided");
  assert.equal(row.data_availability.scores, "not_provided");
  assert.equal(row.seo_score, null);
  assert.equal(row.website_score, null);
  // Weaknesses become customer-facing gap cards.
  assert.equal(row.issues_found.length, 2);
  assert.equal(row.issues_found[0].description, "No online booking on the website");
  // Snapshot carries the reputation category the renderer hydrates from.
  assert.equal(row.source_snapshot.categories.onlineReputation.metrics.avgRating, 4.9);
  assert.equal(row.source_snapshot.categories.onlineReputation.metrics.totalReviews, 1226);
  assert.equal(row.source_snapshot.dataAvailability.reputation, "measured");
  // Self entry keeps the hero review badge truthful; no fabricated rivals.
  assert.equal(row.competitor_data.length, 1);
  assert.equal(row.competitor_data[0].review_count, 1226);
  assert.doesNotMatch(JSON.stringify(row), /rocket\s+(?:search|serps?)|reseller/i);
});

test("never fabricates reputation when no rating or reviews are provided", () => {
  const row = buildCallPrepRow({
    adapter: adapterFixture(),
    prospect: { businessName: "Measured Plumbing", weaknesses: ["No website"] },
  });
  assert.equal(row.overall_score, null);
  assert.equal(row.overall_grade, null);
  assert.equal(row.reviews_score, null);
  assert.equal(row.data_availability.reputation, "not_provided");
  assert.deepEqual(row.reputation_metrics, {});
  assert.deepEqual(row.competitor_data, []);
  // A gap with no reputation still renders as an issue.
  assert.equal(row.issues_found.length, 1);
});

test("fails closed without CallPrep credentials and never calls fetch", async () => {
  let called = false;
  const result = await saveBusinessReport(
    { adapter: adapterFixture(), prospect: { businessName: "Measured Plumbing" } },
    {
      env: {},
      fetch: async () => {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.deepEqual(result, {
    ok: false,
    configured: false,
    mode: "not_configured",
    reason: "CallPrep server credentials are not configured.",
  });
});

test("immutable saves fail closed without the private adapter URL and 32-byte secret", async () => {
  let called = false;
  const result = await saveBusinessReport(
    {
      adapter: immutableAdapterFixture(),
      prospect: { businessName: "Measured Plumbing" },
      immutablePacketId: IMMUTABLE_PACKET_ID,
    },
    {
      env: {
        CALLPREP_SUPABASE_URL: "https://callprep-project.supabase.co",
        CALLPREP_SUPABASE_ANON_KEY: "legacy-anon-key",
        CALLPREP_GHOST_ADAPTER_URL: SECURE_ADAPTER_URL,
        GHOST_REPORT_ADAPTER_HMAC_SECRET: "too-short",
      },
      fetch: async () => {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.deepEqual(result, {
    ok: false,
    configured: false,
    mode: "not_configured",
    reason: "CallPrep secure report adapter is not configured.",
  });
});

test("immutable saves sign the exact packet-bound body and return only /report/<uuid>", async () => {
  const calls = [];
  const adapter = immutableAdapterFixture();
  const prospect = {
    businessName: "Measured Plumbing",
    currentWebsite: "https://measured-plumbing.example",
  };
  const result = await saveBusinessReport(
    { adapter, prospect, immutablePacketId: IMMUTABLE_PACKET_ID },
    {
      env: secureEnv(),
      now: () => SECURE_NOW_MS,
      fetch: async (url, options) => {
        calls.push({ url, options });
        return secureAdapterResponse("created");
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SECURE_ADAPTER_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.headers["X-WSS-Timestamp"], String(SECURE_NOW_MS / 1000));
  assert.equal(Object.hasOwn(calls[0].options.headers, "Authorization"), false);
  assert.equal(Object.hasOwn(calls[0].options.headers, "apikey"), false);

  const expectedBody = JSON.stringify({
    tenantId: "wss",
    externalId: IMMUTABLE_PACKET_ID,
    report: buildCallPrepRow({ adapter, prospect }),
  });
  assert.equal(calls[0].options.body, expectedBody);
  const expectedSignature = createHmac("sha256", SECURE_SECRET)
    .update(`${SECURE_NOW_MS / 1000}.${expectedBody}`)
    .digest("hex");
  assert.equal(calls[0].options.headers["X-WSS-Signature"], `sha256=${expectedSignature}`);
  assert.deepEqual(result, {
    ok: true,
    configured: true,
    mode: "report_created",
    report_id: REPORT_ID,
    report_url: `https://callprep.wss-ai.com/report/${REPORT_ID}`,
  });
  assert.doesNotMatch(result.report_url, /\/audit\//);
});

test("immutable saves reject a token that does not exactly match the report row", async () => {
  let called = false;
  const result = await saveBusinessReport(
    {
      adapter: immutableAdapterFixture(),
      prospect: { businessName: "Measured Plumbing" },
      immutablePacketId: `wss-genie-cert-v1:${"b".repeat(64)}`,
    },
    {
      env: secureEnv(),
      fetch: async () => {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.mode, "invalid_packet");
});

test("two independent immutable clients replay one packet token to the same report UUID", async () => {
  const calls = [];
  let responseNumber = 0;
  const runClient = () => saveBusinessReport(
    {
      adapter: immutableAdapterFixture(),
      prospect: { businessName: "Measured Plumbing" },
      immutablePacketId: IMMUTABLE_PACKET_ID,
    },
    {
      env: secureEnv(),
      now: () => SECURE_NOW_MS,
      fetch: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        responseNumber += 1;
        return secureAdapterResponse(responseNumber === 1 ? "created" : "updated");
      },
    },
  );

  const [firstIsolate, secondIsolate] = await Promise.all([runClient(), runClient()]);
  assert.equal(calls.length, 2, "separate isolates each reach the atomic database adapter");
  assert.equal(calls[0].externalId, IMMUTABLE_PACKET_ID);
  assert.equal(calls[1].externalId, IMMUTABLE_PACKET_ID);
  assert.equal(firstIsolate.report_id, REPORT_ID);
  assert.equal(secondIsolate.report_id, REPORT_ID);
  assert.equal(firstIsolate.report_url, `https://callprep.wss-ai.com/report/${REPORT_ID}`);
  assert.equal(secondIsolate.report_url, firstIsolate.report_url);
  assert.deepEqual(
    new Set([firstIsolate.mode, secondIsolate.mode]),
    new Set(["report_created", "report_reused"]),
  );
});

test("authenticates the edge request and returns only the durable WSS customer URL", async () => {
  const calls = [];
  const secret = "callprep-anon-secret-value";
  const closer = "c8e79f43-ec3a-4a85-a34e-73794de79711";
  const result = await saveBusinessReport(
    {
      adapter: adapterFixture(),
      prospect: {
        businessName: "Measured Plumbing",
        currentWebsite: "https://measured-plumbing.example",
      },
      closerId: closer,
    },
    {
      env: {
        CALLPREP_SUPABASE_URL: "https://callprep-project.supabase.co/",
        CALLPREP_SUPABASE_ANON_KEY: secret,
        CALLPREP_REPORT_ORIGIN: "https://launchpad-analyze.lovable.app",
        CALLPREP_SAVE_FN: "save-business-report",
      },
      fetch: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: REPORT_ID }),
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://callprep-project.supabase.co/functions/v1/save-business-report",
  );
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0].options.headers.apikey, secret);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.closer_id, closer);
  assert.equal(payload.row.business_name, "Measured Plumbing");
  assert.doesNotMatch(JSON.stringify(payload), /rocket\s+(?:search|serps?)|reseller/i);
  assert.deepEqual(result, {
    ok: true,
    configured: true,
    mode: "report_created",
    report_id: REPORT_ID,
    report_url: `https://callprep.wss-ai.com/report/${REPORT_ID}`,
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(result.report_url, /lovable/i);
});

test("a stale CallPrep slug cannot shadow the UUID minted by a successful save", async () => {
  const stale = "https://callprep.wss-ai.com/report/measured-plumbing";
  assert.equal(existingCallPrepReportUrl({ report_url: stale }), "");
  for (const unsafe of [
    `https://callprep.wss-ai.com:444/report/${REPORT_ID}`,
    `https://user:pw@callprep.wss-ai.com/report/${REPORT_ID}`,
    `https://callprep.wss-ai.com/report/${REPORT_ID}?preview=1`,
  ]) {
    assert.equal(existingCallPrepReportUrl({ report_url: unsafe }), "", unsafe);
    assert.equal(canonicalCallPrepReportUrl(unsafe), "", unsafe);
  }
  assert.equal(
    canonicalCallPrepReportUrl(`https://callprep.wss-ai.com/report/${REPORT_ID}/`),
    `https://callprep.wss-ai.com/report/${REPORT_ID}`,
  );

  const result = await saveBusinessReport(
    {
      adapter: adapterFixture(),
      prospect: { businessName: "Measured Plumbing", report_url: stale },
    },
    {
      env: {
        CALLPREP_SUPABASE_URL: "https://callprep-project.supabase.co",
        CALLPREP_SUPABASE_ANON_KEY: "anon-test",
      },
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: REPORT_ID }),
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.report_id, REPORT_ID);
  assert.equal(result.report_url, `https://callprep.wss-ai.com/report/${REPORT_ID}`);
});

test("CallPrep refuses a successful response whose report id is not a UUID", async () => {
  const result = await saveBusinessReport(
    { adapter: adapterFixture(), prospect: { businessName: "Measured Plumbing" } },
    {
      env: {
        CALLPREP_SUPABASE_URL: "https://callprep-project.supabase.co",
        CALLPREP_SUPABASE_ANON_KEY: "anon-test",
      },
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "measured-plumbing" }),
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.mode, "invalid_response");
});

test("does not leak provider errors or credentials when CallPrep rejects the request", async () => {
  const secret = "do-not-return-this-secret";
  const result = await saveBusinessReport(
    { adapter: adapterFixture(), prospect: { businessName: "Measured Plumbing" } },
    {
      env: {
        CALLPREP_SUPABASE_URL: "https://callprep-project.supabase.co",
        CALLPREP_SUPABASE_ANON_KEY: secret,
      },
      fetch: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: `provider echoed ${secret}` }),
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.mode, "request_failed");
  assert.equal(result.status, 401);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("the adapter route authenticates before creating a report", async () => {
  let saveCalled = false;
  const handler = createCallPrepReportHandler({
    requireAdmin: (_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return false;
    },
    saveBusinessReport: async () => {
      saveCalled = true;
    },
  });
  const res = responseRecorder();

  await handler({ method: "POST", headers: {}, body: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(saveCalled, false);
});

test("the adapter route persists and returns the customer report URL", async () => {
  const adapter = adapterFixture();
  const upserts = [];
  const handler = createCallPrepReportHandler({
    requireAdmin: () => true,
    buildCanonicalJob: () => ({
      id: "job-123",
      prospect: {
        id: "prospect-123",
        businessName: "Measured Plumbing",
        industry: "Plumbing",
        currentWebsite: "https://measured-plumbing.example",
      },
    }),
    callprepAdapter: () => adapter,
    // This case covers the STATIC packet path. The adapter now attempts a live
    // scan first (that wiring is what stopped every report rendering "NOT
    // CAPTURED"), so the scan is stubbed to yield nothing and hand control to
    // the static save being asserted below.
    scanBusiness: async () => null,
    saveBusinessReport: async ({ adapter: received, closerId }) => {
      assert.equal(received, adapter);
      assert.equal(closerId, "c8e79f43-ec3a-4a85-a34e-73794de79711");
      return {
        ok: true,
        configured: true,
        mode: "report_created",
        report_id: REPORT_ID,
        report_url: `https://callprep.wss-ai.com/report/${REPORT_ID}`,
      };
    },
    upsertRow: async (...args) => {
      upserts.push(args);
      return { mode: "live_upsert" };
    },
  });
  const res = responseRecorder();

  await handler({
    method: "POST",
    headers: {},
    body: {
      prospect: { address: "123 Main St" },
      closer_id: "c8e79f43-ec3a-4a85-a34e-73794de79711",
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.report_url, `https://callprep.wss-ai.com/report/${REPORT_ID}`);
  assert.equal(res.body.adapter.packet.reportUrl, res.body.report_url);
  assert.equal(res.body.persistence.persisted, true);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][0], "ghost_agency_prospects");
  assert.equal(upserts[0][1].prospect_id, "prospect-123");
  assert.equal(upserts[0][1].report_url, res.body.report_url);
  assert.equal(upserts[0][2], "prospect_id");
  assert.doesNotMatch(JSON.stringify(res.body), /rocket\s+(?:search|serps?)|reseller/i);
});

test("accepts a snake_case build-lane payload gated by the tool secret", async () => {
  let received = null;
  const handler = createCallPrepReportHandler({
    toolSecretAuthorized: () => true,
    requireAdmin: () => {
      throw new Error("admin session must not be required when the tool secret authorizes");
    },
    callprepAdapter: () => adapterFixture(),
    // Static path (see the note above): this case is about the snake_case
    // payload reaching the report builder, not about the live scan.
    scanBusiness: async () => null,
    saveBusinessReport: async ({ prospect }) => {
      received = prospect;
      return {
        ok: true,
        configured: true,
        mode: "report_created",
        report_id: REPORT_ID,
        report_url: `https://callprep.wss-ai.com/report/${REPORT_ID}`,
      };
    },
    upsertRow: async () => ({ mode: "live_upsert" }),
  });
  const res = responseRecorder();

  await handler({
    method: "POST",
    headers: { "x-vapi-secret": "shared-secret" },
    body: {
      business_name: "Austin Air Conditioning",
      city: "Austin",
      state: "TX",
      industry: "hvac",
      current_website: "https://austinairconditioning.com/",
      rating: 4.9,
      review_count: 1226,
      weaknesses: ["No online booking on the website"],
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.report_url, `https://callprep.wss-ai.com/report/${REPORT_ID}`);
  // Snake_case identity + real signals reached the report builder.
  assert.equal(received.businessName, "Austin Air Conditioning");
  assert.equal(received.rating, 4.9);
  assert.equal(received.review_count, 1226);
  assert.deepEqual(received.weaknesses, ["No online booking on the website"]);
});

test("the adapter route preserves an existing real CallPrep report URL", async () => {
  const existingReportId = "c93b71e5-2f48-4d6a-8b0c-1e7f9a3d5c62";
  const existingReportUrl = `https://callprep.wss-ai.com/report/${existingReportId}`;
  const replacementReportUrl = `https://callprep.wss-ai.com/report/${REPORT_ID}`;
  const upserts = [];
  const handler = createCallPrepReportHandler({
    requireAdmin: () => true,
    buildCanonicalJob: () => ({
      id: "job-existing-report",
      prospect: { id: "prospect-existing-report", businessName: "Measured Plumbing" },
    }),
    callprepAdapter: () => adapterFixture(),
    // Static path (see the note above): the live scan is stubbed out so the
    // assertion is about preserving an EXISTING report URL, not about which
    // generator produced it.
    scanBusiness: async () => null,
    saveBusinessReport: async () => ({
      ok: true,
      configured: true,
      mode: "report_created",
      report_id: REPORT_ID,
      report_url: replacementReportUrl,
    }),
    upsertRow: async (...args) => {
      upserts.push(args);
      return { mode: "live_upsert" };
    },
  });
  const res = responseRecorder();

  await handler({
    method: "POST",
    headers: {},
    body: { prospect: { report_url: existingReportUrl } },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.report_url, existingReportUrl);
  assert.equal(res.body.callprep.report_url, existingReportUrl);
  assert.equal(upserts[0][1].report_url, existingReportUrl);
});

// TRUTH-LAW (2026-07-22): partial reputation data must never be graded from a
// coerced zero. A real 5.0 rating with an UNKNOWN review count was previously
// scored as "5.0 with zero reviews" -> F 20/100 on the customer report.
test("partial reputation (rating only) surfaces the real half but never scores from a coerced zero", () => {
  const adapter = adapterFixture();
  const row = buildCallPrepRow({ adapter, prospect: { businessName: "Redland Electric", rating: 5 } });
  assert.equal(row.overall_score, null, "no fabricated composite");
  assert.equal(row.overall_grade, null, "no fabricated grade");
  assert.equal(row.reviews_score, null, "no reputation score from a coerced zero review count");
  assert.equal(row.data_availability.reputation, "partial");
  assert.equal(row.reputation_metrics.availability, "partial");
  assert.equal(row.reputation_metrics.starRating, 5, "the real rating half is surfaced");
  assert.equal(row.reputation_metrics.reviewCount, null);
  assert.deepEqual(row.competitor_data, [], "no self-entry with a fabricated 0 score");
});

test("partial reputation (review count only) surfaces the count but never invents a rating or grade", () => {
  const adapter = adapterFixture();
  const row = buildCallPrepRow({ adapter, prospect: { businessName: "Lori Fowler Luxury", review_count: 55 } });
  assert.equal(row.overall_score, null);
  assert.equal(row.overall_grade, null);
  assert.equal(row.reviews_score, null);
  assert.equal(row.data_availability.reputation, "partial");
  assert.equal(row.reputation_metrics.reviewCount, 55, "the real review-count half is surfaced");
  assert.equal(row.reputation_metrics.starRating, null);
});
