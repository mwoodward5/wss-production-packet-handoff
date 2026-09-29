"use strict";

// test/callprep-local-service.test.js — the LOCAL CALLPREP CONTRACT.
//
// Proves the local signal-report service (infra/callprep/server.cjs) satisfies
// the backend's own readers BYTE-FOR-BYTE where it matters: a row saved
// through save-business-report must read back through get-business-report in
// exactly the shape lib/report-grade.js (the owner-proof email's grade
// reader) and lib/callprep-client.js (the URL canonicalizer) already parse.
// If this passes, the local platform's signal reports are a drop-in for the
// hosted CallPrep project — same env vars, same endpoints, same auth.

const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");

const { createCallPrepService } = require("../../../infra/callprep/server.cjs");
const { buildCallPrepRow, reportUrlForId } = require("../lib/callprep-client");
const {
  reportEndpoint,
  reportGradeFacts,
  reportPayloadHasRow,
  reportPayloadIdentity,
} = require("../lib/report-grade");
const { REPORT_UUID } = require("../lib/report-url");

const ANON_KEY = "local-callprep-anon-key-0123456789abcdef";
const ADAPTER_SECRET = "local-adapter-secret-0123456789abcdef-0123456789";
const SUPABASE_ORIGIN = "https://supabase.local.wss-ai.test:54321";

// --- in-memory PostgREST stand-in for the report table ----------------------
function memoryStore() {
  const rows = new Map();
  let external = new Map();
  return async (url, options = {}) => {
    const target = new URL(String(url));
    const method = String(options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    const reply = (status, payload) => new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

    if (!target.pathname.endsWith("/callprep_business_reports")) {
      return reply(404, { message: "unknown table" });
    }
    if (method === "POST") {
      rows.set(body.id, body);
      if (body.external_id) external.set(body.external_id, body.id);
      return reply(201, [body]);
    }
    if (method === "PATCH") {
      const id = target.searchParams.get("id") ? target.searchParams.get("id").split("eq.")[1] : "";
      const existing = rows.get(id);
      if (!existing) return reply(404, { message: "not found" });
      rows.set(id, { ...existing, ...body });
      return reply(200, [rows.get(id)]);
    }
    if (method === "GET") {
      const idFilter = target.searchParams.get("id");
      const externalFilter = target.searchParams.get("external_id");
      if (idFilter) {
        const id = idFilter.split("eq.")[1];
        return rows.has(id) ? reply(200, [rows.get(id)]) : reply(200, []);
      }
      if (externalFilter) {
        const key = externalFilter.split("eq.")[1];
        const id = external.get(key);
        return id ? reply(200, [rows.get(id)]) : reply(200, []);
      }
      return reply(200, []);
    }
    return reply(405, { message: "method not allowed" });
  };
}

async function startService({ env = {} } = {}) {
  const service = createCallPrepService({
    env: {
      CALLPREP_ANON_KEY: ANON_KEY,
      GHOST_REPORT_ADAPTER_HMAC_SECRET: ADAPTER_SECRET,
      SUPABASE_URL: SUPABASE_ORIGIN,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      ...env,
    },
    fetchImpl: memoryStore(),
    log: () => {},
  });
  const server = http.createServer(service);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
    call: (path, { method = "GET", headers = {}, body } = {}) => fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    }),
  };
}

// The row the build phase actually builds for a prospect.
function sampleProspectRow() {
  return buildCallPrepRow({
    prospect: {
      businessName: "Noble Plumbing",
      city: "Columbia",
      state: "SC",
      phone: "(803) 555-0100",
      currentWebsite: "https://nobleplumbing.example.com",
      rating: 4.6,
      review_count: 87,
      reviews: [{ text: "Fixed our leak fast.", rating: 5, date: "2 weeks ago", authorName: "Sam" }],
      weaknesses: ["Review responses missing on Google"],
      recommendations: [{ action: "Reply to every Google review this month", timeline: "1-2 weeks" }],
      record: {},
    },
  });
}

test("health endpoint reports configuration", async () => {
  const s = await startService();
  try {
    const response = await s.call("/");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "wss-local-callprep");
    assert.equal(body.storage, "configured");
  } finally {
    await s.close();
  }
});

test("save + get round-trip satisfies report-grade.js, the email's own grade reader", async () => {
  const s = await startService();
  try {
    const row = sampleProspectRow();
    const saved = await s.call("/functions/v1/save-business-report", {
      method: "POST",
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: { row, closer_id: randomUUID() },
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.match(savedBody.id, REPORT_UUID);

    // reportUrlForId accepts it — the email link canonicalizer.
    assert.equal(reportUrlForId(savedBody.id), `https://callprep.wss-ai.com/report/${savedBody.id}`);

    const fetched = await s.call(`/functions/v1/get-business-report?id=${savedBody.id}`, {
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });
    assert.equal(fetched.status, 200);
    const payload = await fetched.json();

    // The exact predicates the owner-proof email applies.
    assert.equal(reportPayloadHasRow(payload, savedBody.id), true);
    const identity = reportPayloadIdentity(payload);
    assert.equal(identity.businessName, "Noble Plumbing");
    assert.equal(identity.businessUrl, "https://nobleplumbing.example.com/");
    const facts = reportGradeFacts(payload);
    assert.ok(facts, "the row must yield grade facts");
    assert.equal(facts.grade, "B"); // 4.6 stars / 87 reviews -> 77-79 band
    assert.ok(facts.score > 0 && facts.score <= 100);
    assert.ok(facts.categories.onlineReputation);

    // reportEndpoint builds the same URL the page fetch would — the transport
    // contract is the same two env values the backend already carries.
    assert.equal(
      reportEndpoint("https://callprep.wss-ai.com", savedBody.id),
      `https://callprep.wss-ai.com/functions/v1/get-business-report?id=${savedBody.id}`,
    );
  } finally {
    await s.close();
  }
});

test("get rejects unknown ids definitively (404) and bad ids (400)", async () => {
  const s = await startService();
  try {
    const missing = await s.call(`/functions/v1/get-business-report?id=${randomUUID()}`, {
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });
    assert.equal(missing.status, 404);
    const malformed = await s.call("/functions/v1/get-business-report?id=not-a-uuid", {
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });
    assert.equal(malformed.status, 400);
  } finally {
    await s.close();
  }
});

test("anon auth is enforced on every function endpoint", async () => {
  const s = await startService();
  try {
    for (const path of [
      "/functions/v1/get-business-report?id=00000000-0000-4000-8000-000000000000",
      "/functions/v1/api-gateway?action=ssl&host=example.com",
    ]) {
      const response = await s.call(path);
      assert.equal(response.status, 401, `${path} without credentials must 401`);
    }
    const save = await s.call("/functions/v1/save-business-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { row: { business_name: "X" } },
    });
    assert.equal(save.status, 401);
    const adapter = await s.call("/functions/v1/ghost-report-adapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(adapter.status, 401);
  } finally {
    await s.close();
  }
});

test("ghost-report-adapter verifies HMAC, is idempotent on externalId, and refuses stale timestamps", async () => {
  const s = await startService();
  try {
    const externalId = `wss-genie-cert-v1:${"a".repeat(64)}`;
    const report = {
      ...sampleProspectRow(),
      source_snapshot: { ...sampleProspectRow().source_snapshot, packet_id: externalId },
    };
    const body = JSON.stringify({ tenantId: "wss", externalId, report });
    const sign = (payload, timestamp) => ({
      "Content-Type": "application/json",
      "X-WSS-Timestamp": timestamp,
      "X-WSS-Signature": `sha256=${createHmac("sha256", ADAPTER_SECRET).update(`${timestamp}.${payload}`, "utf8").digest("hex")}`,
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const first = await s.call("/functions/v1/ghost-report-adapter", {
      method: "POST",
      headers: sign(body, timestamp),
      body,
    });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.mode, "created");
    assert.match(firstBody.reportId, REPORT_UUID);

    // Same packet again -> updated, SAME report id (the immutable-packet key).
    const second = await s.call("/functions/v1/ghost-report-adapter", {
      method: "POST",
      headers: sign(body, timestamp),
      body,
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.mode, "updated");
    assert.equal(secondBody.reportId, firstBody.reportId);

    // The saved adapter report also reads back through the grade reader.
    const fetched = await s.call(`/functions/v1/get-business-report?id=${firstBody.reportId}`, {
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });
    const payload = await fetched.json();
    assert.equal(reportPayloadHasRow(payload, firstBody.reportId), true);
    assert.equal(reportPayloadIdentity(payload).packetId, externalId);

    // Bad signature -> 401.
    const badSig = { ...sign(body, timestamp), "X-WSS-Signature": `sha256=${"0".repeat(64)}` };
    const refused = await s.call("/functions/v1/ghost-report-adapter", {
      method: "POST",
      headers: badSig,
      body,
    });
    assert.equal(refused.status, 401);

    // Stale timestamp (outside the 300s window) -> 401.
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const staleRes = await s.call("/functions/v1/ghost-report-adapter", {
      method: "POST",
      headers: sign(body, stale),
      body,
    });
    assert.equal(staleRes.status, 401);

    // Malformed externalId -> 400 (the immutable-packet shape is required).
    const junk = JSON.stringify({ tenantId: "wss", externalId: "not-a-packet", report });
    const junkRes = await s.call("/functions/v1/ghost-report-adapter", {
      method: "POST",
      headers: sign(junk, timestamp),
      body: junk,
    });
    assert.equal(junkRes.status, 400);
  } finally {
    await s.close();
  }
});

test("save refuses rows without a customer-safe business name", async () => {
  const s = await startService();
  try {
    const response = await s.call("/functions/v1/save-business-report", {
      method: "POST",
      headers: { Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      body: { row: { business_name: "" } },
    });
    assert.equal(response.status, 400);
  } finally {
    await s.close();
  }
});

test("api-gateway answers settled declines for unconfigured keyed actions, 200-shaped", async () => {
  const s = await startService();
  try {
    // callGateway treats a 200 {error} envelope as a SETTLED decline (never
    // retried) and the category stays not_provided — never a fabricated score.
    for (const [query, expected] of [
      ["action=pagespeed&url=https://example.com", "no_psi_key"],
      ["action=lookup&input=Example Seattle WA", "no_places_key"],
      ["action=whatcms&url=https://example.com", "no_whatcms_key"],
      ["action=company&domain=example.com", "no_company_key"],
      ["action=bogus", "unknown_action"],
    ]) {
      const response = await s.call(`/functions/v1/api-gateway?${query}`, {
        headers: { Authorization: `Bearer ${ANON_KEY}` },
      });
      assert.equal(response.status, 200, query);
      const body = await response.json();
      assert.equal(body.error, expected, query);
    }
  } finally {
    await s.close();
  }
});

test("the report page renders the stored row with escaped text", async () => {
  const s = await startService();
  try {
    const row = buildCallPrepRow({
      prospect: {
        businessName: 'Noble <script>alert(1)</script> Plumbing',
        city: "Columbia",
        rating: 4.6,
        review_count: 87,
        record: {},
      },
    });
    const saved = await s.call("/functions/v1/save-business-report", {
      method: "POST",
      headers: { Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      body: { row },
    });
    const { id } = await saved.json();
    const page = await s.call(`/report/${id}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    const html = await page.text();
    assert.ok(!html.includes("<script>alert"), "business name must be escaped");
    assert.ok(html.includes("Noble &lt;script&gt;"), "escaped name must render");
    assert.ok(html.includes("Not captured in this report version"), "unmeasured cards render honestly");
  } finally {
    await s.close();
  }
});
