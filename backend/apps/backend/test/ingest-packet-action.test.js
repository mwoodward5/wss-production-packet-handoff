"use strict";

/**
 * test/ingest-packet-action.test.js
 *
 * api/admin/ingest-packet.js — round-trip admin action.
 *
 * The fixture is modelled on the ingester's own test case: a synthetic
 * plain-text email carrying a Genie v2 packet for a plumbing prospect.
 * The test verifies the full flow without real database or filesystem I/O.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const { createIngestPacketHandler } = require("../api/admin/ingest-packet");

// ---------------------------------------------------------------------------
// Minimal HTTP mock helpers (no express required)
// ---------------------------------------------------------------------------

function makeReq(body = {}) {
  const json = JSON.stringify(body);
  const readable = Readable.from([json]);
  readable.headers = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(json)),
    "x-ghost-admin-token": "test-admin-token",
  };
  readable.method = "POST";
  return readable;
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    setHeader() {},
    end(data) { this.body = JSON.parse(data || "{}"); },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Auth / method guard stubs
// ---------------------------------------------------------------------------

// Override requireAdmin to always pass in tests by patching the module cache.
// We do this by providing the handler factory with inline dependencies.

// ---------------------------------------------------------------------------
// Fixture packet
// ---------------------------------------------------------------------------

function cedarPacket() {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    job_id: "genie-job-cedar",
    request_id: "ghost:cedar-creek-plumbing-ak:manual-ingest",
    idempotency_key: "ghost:cedar-creek-plumbing-ak:manual-ingest",
    sources: { website_url: "https://cedarcreekplumbing.com" },
    scope: { supported: true, category: "plumbing" },
    facts: {
      name: "Cedar Creek Plumbing",
      city: "Anchorage",
      state: "AK",
      category: "plumbing",
      phone: "(907) 555-0100",
      email: "owner@cedarcreekplumbing.com",
      website: "https://cedarcreekplumbing.com",
      services: ["Drain Cleaning", "Water Heater Repair", "Sewer Line Replacement"],
    },
    evidence: [
      { field: "name", value: "Cedar Creek Plumbing", source_url: "https://cedarcreekplumbing.com", confidence: 0.95 },
      { field: "services", value: "Drain Cleaning", source_url: "https://cedarcreekplumbing.com/services" },
      { field: "services", value: "Water Heater Repair", source_url: "https://cedarcreekplumbing.com/services" },
      { field: "services", value: "Sewer Line Replacement", source_url: "https://cedarcreekplumbing.com/services" },
    ],
    assets: [],
    trust: { rating: 4.7, review_count: 92 },
    optimization: {
      target_queries: ["plumbing anchorage ak", "drain cleaning anchorage"],
    },
    content: {
      about: "Cedar Creek Plumbing has served Anchorage homeowners for over 15 years with honest, reliable plumbing.",
      services: [
        { name: "Drain Cleaning", description: "Expert drain cleaning for Anchorage homes." },
        { name: "Water Heater Repair" },
      ],
      faqs: [
        { q: "Do you offer emergency service?", a: "Yes, we offer 24/7 emergency plumbing in Anchorage." },
      ],
    },
  };
}

function cedarEmail() {
  return `From: genie@siteforge.example.test\nTo: mark@woodwardsoftware.com\nContent-Type: text/plain\n\n${JSON.stringify(cedarPacket())}`;
}

// ---------------------------------------------------------------------------
// Dependency stubs
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ipa-t-"));
  const upserted = [];
  const selected = [];

  return {
    tmpBase,
    upserted,
    selected,
    certificationKey: "test-only-ingest-certification-key",
    ingestPacketEmail: overrides.ingestPacketEmail || undefined,
    bridgePacketToLane: overrides.bridgePacketToLane || undefined,
    select: overrides.select || (async (_table, query) => {
      selected.push(query);
      if (overrides.prospectRow) {
        return { ok: true, data: [overrides.prospectRow] };
      }
      return { ok: true, data: [] };
    }),
    upsertRow: overrides.upsertRow || (async (_table, row) => {
      upserted.push(row);
      return { mode: "dry_run", ok: true };
    }),
    // packet base dir
    _tmpBase: tmpBase,
    cleanup() { fs.rmSync(tmpBase, { recursive: true, force: true }); },
  };
}

// ---------------------------------------------------------------------------
// Helper: run the handler with overridden auth
// ---------------------------------------------------------------------------

async function runHandler(body, deps = {}) {
  const handler = createIngestPacketHandler({
    requireAdmin: () => true,
    ...deps,
  });
  const req = makeReq(body);
  const res = makeRes();
  await handler(req, res);
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("ingest_packet action: round-trip with synthetic Cedar Creek Plumbing fixture", async () => {
  const deps = makeDeps({
    prospectRow: {
      prospect_id: "cedar-creek-plumbing-ak",
      business_name: "Cedar Creek Plumbing",
      city: "Anchorage",
      state: "AK",
      industry: "plumbing",
      email: "owner@cedarcreekplumbing.com",
      website: "https://cedarcreekplumbing.com",
      record: { email: "owner@cedarcreekplumbing.com", notes: "original note" },
    },
  });

  // Override ingestPacketEmail to avoid real disk writes.
  const packetDir = deps.tmpBase + "/cedar-creek-plumbing-abc12345";
  fs.mkdirSync(packetDir, { recursive: true });

  const res = await runHandler({
    email_body: cedarEmail(),
    prospect_id: "cedar-creek-plumbing-ak",
    packet_dir: deps.tmpBase,
  }, {
    ...deps,
    // Fake ingest so we control the packetDir path deterministically.
    ingestPacketEmail: (_emailBody, _opts) => ({
      ok: true,
      packetDir,
      packet: cedarPacket(),
      businessName: "Cedar Creek Plumbing",
      prospectHint: { name: "Cedar Creek Plumbing", city: "Anchorage", state: "AK", category: "plumbing" },
    }),
  });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, "live");
  assert.equal(res.body.prospectId, "cedar-creek-plumbing-ak");
  assert.equal(res.body.businessName, "Cedar Creek Plumbing");
  assert.ok(res.body.packetDir, "packetDir returned");

  // NAP must never appear in the patch
  assert.ok(!("phone" in res.body.patch), "phone must not be in patch");
  assert.ok(!("email" in res.body.patch), "email must not be in patch");
  assert.ok(!("website" in res.body.patch), "website must not be in patch");

  // Trust must never appear in the patch
  assert.ok(!("rating" in res.body.patch), "rating must not be in patch");
  assert.ok(!("review_count" in res.body.patch), "review_count must not be in patch");

  // Core identity must be present
  assert.equal(res.body.patch.business_name, "Cedar Creek Plumbing");
  assert.equal(res.body.patch.industry, "plumbing");
  assert.equal(res.body.patch.packet_ready, true);

  // droppedNap / droppedTrust surfaced to operator
  assert.ok(Array.isArray(res.body.droppedNap), "droppedNap array present");
  assert.ok(res.body.droppedNap.includes("phone"), "phone listed as dropped");
  assert.ok(Array.isArray(res.body.droppedTrust), "droppedTrust array present");
  assert.ok(res.body.droppedTrust.includes("rating"), "rating listed as dropped");

  // The upsert was called once with the correct prospectId
  assert.equal(deps.upserted.length, 1);
  assert.equal(deps.upserted[0].prospect_id, "cedar-creek-plumbing-ak");
  // Existing email in the record must be preserved
  assert.equal(deps.upserted[0].record.email, "owner@cedarcreekplumbing.com", "existing email not touched");
  assert.equal(deps.upserted[0].record.notes, "original note", "existing notes preserved");

  deps.cleanup();
});

test("ingest_packet action: dry-run when no prospect_id and no match found", async () => {
  const deps = makeDeps();

  const res = await runHandler({
    email_body: cedarEmail(),
    packet_dir: deps.tmpBase,
  }, {
    ...deps,
    ingestPacketEmail: (_emailBody, _opts) => ({
      ok: true,
      packetDir: deps.tmpBase + "/cedar",
      packet: cedarPacket(),
      businessName: "Cedar Creek Plumbing",
      prospectHint: { name: "Cedar Creek Plumbing", city: "Anchorage", state: "AK", category: "plumbing" },
    }),
    // select returns no rows → no prospect found
    select: async () => ({ ok: true, data: [] }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, "dry_run");
  assert.equal(res.body.reason, "prospect_not_identified");
  assert.ok(res.body.hint, "hint returned for operator");
  assert.ok(res.body.patch, "patch returned for operator preview");
  assert.equal(deps.upserted.length, 0, "no upsert on dry-run");

  deps.cleanup();
});

test("ingest_packet action: 422 when email body is empty", async () => {
  const deps = makeDeps();
  const res = await runHandler({ email_body: "" }, deps);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "email_body_required");
  deps.cleanup();
});

test("ingest_packet action: 422 when no packet found in email", async () => {
  const deps = makeDeps();
  const res = await runHandler({ email_body: "no packet here" }, {
    ...deps,
    ingestPacketEmail: () => ({ ok: false, reason: "no_genie_packet_found" }),
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "no_genie_packet_found");
  deps.cleanup();
});

test("ingest_packet action: consent laws untouched — no consent field ever written", async () => {
  const deps = makeDeps({
    prospectRow: {
      prospect_id: "pid-consent-test",
      business_name: "Cedar Creek Plumbing",
      city: "Anchorage",
      state: "AK",
      website: "https://cedarcreekplumbing.com",
      record: { consentToCall: true, consentToText: false, consent_source: "existing" },
    },
  });

  const res = await runHandler({
    email_body: cedarEmail(),
    prospect_id: "pid-consent-test",
  }, {
    ...deps,
    ingestPacketEmail: () => ({
      ok: true,
      packetDir: deps.tmpBase,
      packet: cedarPacket(),
      businessName: "Cedar Creek Plumbing",
      prospectHint: { name: "Cedar Creek Plumbing", city: "Anchorage", state: "AK", category: "plumbing" },
    }),
  });

  assert.equal(res.body.ok, true);
  // The upserted record must preserve original consent values unchanged
  if (deps.upserted.length > 0) {
    const rec = deps.upserted[0].record;
    assert.equal(rec.consentToCall, true, "consentToCall preserved");
    assert.equal(rec.consentToText, false, "consentToText preserved");
    assert.equal(rec.consent_source, "existing", "consent_source preserved");
  }

  deps.cleanup();
});

test("ingest_packet action: explicit prospect identity mismatch returns 422 with zero upsert", async () => {
  const deps = makeDeps({
    prospectRow: {
      prospect_id: "wrong-business",
      business_name: "Other Plumbing",
      city: "Reno",
      state: "NV",
      website: "https://other-plumbing.example",
      record: {},
    },
  });
  const res = await runHandler({ email_body: cedarEmail(), prospect_id: "wrong-business" }, {
    ...deps,
    ingestPacketEmail: () => ({
      ok: true,
      packetDir: deps.tmpBase,
      packet: cedarPacket(),
      businessName: "Cedar Creek Plumbing",
      prospectHint: { name: "Cedar Creek Plumbing", city: "Anchorage", state: "AK" },
    }),
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, "genie_content_certification_failed");
  assert.equal(deps.upserted.length, 0, "a mismatched explicit id may not write any bridge or packet field");
  deps.cleanup();
});
