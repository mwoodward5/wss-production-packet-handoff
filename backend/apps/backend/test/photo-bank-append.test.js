"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { createPhotoBankAppendHandler } = require("../api/admin/photo-bank-append");

const NOW = new Date("2026-08-22T12:00:00.000Z");
const UPDATED_AT = "2026-08-22T11:59:00.000Z";
const NEW_BYTES = Buffer.from("new first-party customer photo bytes");
const NEW_SHA = createHash("sha256").update(NEW_BYTES).digest("hex");
const OLD_SHA = "a".repeat(64);

function prospectRow() {
  return {
    id: 91,
    prospect_id: "prospect-1",
    business_name: "Acme Plumbing",
    updated_at: UPDATED_AT,
    preview_url: "https://acme-plumbing.wss-ai.com/",
    record: {
      untouched: { nested: [1, 2, 3] },
      current_website: "https://www.acmeplumbing.com/",
      photo_bank: {
        version: 1,
        harvested_at: "2026-08-21T12:00:00.000Z",
        website: "https://acmeplumbing.com/",
        photos: [{
          url: "https://acmeplumbing.com/media/old-job.jpg",
          source: "own_site",
          found_on: "https://www.acmeplumbing.com/gallery",
          sha256: OLD_SHA,
          width: 1400,
          height: 900,
          grade: "hero",
          rank: 0,
        }],
      },
    },
  };
}

function photo(overrides = {}) {
  return {
    url: "https://cdn.example.net/acme/new-job.jpg",
    source: "own_site",
    found_on: "https://acmeplumbing.com/projects/new-job",
    sha256: NEW_SHA,
    width: 1920,
    height: 1080,
    grade: "hero",
    rank: 1,
    ...overrides,
  };
}

function responseHarness() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    end(value) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(value));
    },
  };
}

function goodFetch(bytes = NEW_BYTES) {
  return async (url) => ({
    ok: true,
    url,
    headers: { get: () => String(bytes.length) },
    arrayBuffer: async () => bytes,
  });
}

function buildHarness({ row = prospectRow(), conditionalResult, fetch = goodFetch() } = {}) {
  const writes = [];
  const handler = createPhotoBankAppendHandler({
    requireAdmin: () => true,
    select: async () => ({ ok: true, data: row ? [row] : [] }),
    conditionalUpdate: async (...args) => {
      writes.push(args);
      return conditionalResult || { ok: true, updated: true, rows: [{ prospect_id: "prospect-1" }] };
    },
    fetch,
    now: () => new Date(NOW),
  });
  return { handler, writes };
}

async function invoke(harness, body = { prospect_id: "prospect-1", photo: photo() }) {
  const res = responseHarness();
  await harness.handler({ method: "POST", headers: {}, body }, res);
  return res.captured;
}

test("the endpoint is admin-authenticated", async () => {
  let selected = false;
  const handler = createPhotoBankAppendHandler({
    requireAdmin(_req, res) {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return false;
    },
    select: async () => { selected = true; return { ok: true, data: [] }; },
  });
  const res = responseHarness();
  await handler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.captured.status, 401);
  assert.equal(selected, false);
});

test("wrong first-party domain is refused before bytes or writes", async () => {
  let fetched = false;
  const harness = buildHarness({ fetch: async () => { fetched = true; throw new Error("must not fetch"); } });
  const result = await invoke(harness, {
    prospect_id: "prospect-1",
    photo: photo({ found_on: "https://other-company.example/projects/copied" }),
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "photo_found_on_wrong_domain");
  assert.equal(fetched, false);
  assert.equal(harness.writes.length, 0);
});

test("anything except own_site source is refused", async () => {
  const harness = buildHarness();
  const result = await invoke(harness, { prospect_id: "prospect-1", photo: photo({ source: "stock" }) });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "photo_source_not_first_party");
  assert.equal(harness.writes.length, 0);
});

test("malformed and byte-mismatched SHAs are refused", async () => {
  const malformed = buildHarness();
  const malformedResult = await invoke(malformed, {
    prospect_id: "prospect-1",
    photo: photo({ sha256: "not-a-sha" }),
  });
  assert.equal(malformedResult.status, 400);
  assert.equal(malformedResult.body.error, "photo_sha256_invalid");
  assert.equal(malformed.writes.length, 0);

  const mismatch = buildHarness();
  const mismatchResult = await invoke(mismatch, {
    prospect_id: "prospect-1",
    photo: photo({ sha256: "b".repeat(64) }),
  });
  assert.equal(mismatchResult.status, 409);
  assert.equal(mismatchResult.body.error, "photo_sha256_mismatch");
  assert.equal(mismatch.writes.length, 0);
});

test("a missing prospect row is a 404 and does not fetch or write", async () => {
  let fetched = false;
  const harness = buildHarness({ row: null, fetch: async () => { fetched = true; throw new Error("must not fetch"); } });
  const result = await invoke(harness);
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "prospect_not_found");
  assert.equal(fetched, false);
  assert.equal(harness.writes.length, 0);
});

test("a CAS miss refuses the append instead of overwriting the concurrent record", async () => {
  const harness = buildHarness({ conditionalResult: { ok: true, updated: false, rows: [] } });
  const result = await invoke(harness);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "photo_bank_cas_conflict");
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.writes[0][3], { updated_at: `eq.${UPDATED_AT}` });
});

test("successful append preserves every record key and every existing bank photo", async () => {
  const original = prospectRow();
  const originalRecord = structuredClone(original.record);
  const harness = buildHarness({ row: original });
  const result = await invoke(harness);

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.appended_sha256, NEW_SHA);
  assert.equal(result.body.photo_count, 2);
  assert.equal(harness.writes.length, 1);

  const [table, idColumn, idValue, guards, patch] = harness.writes[0];
  assert.equal(table, "ghost_agency_prospects");
  assert.equal(idColumn, "prospect_id");
  assert.equal(idValue, "prospect-1");
  assert.deepEqual(guards, { updated_at: `eq.${UPDATED_AT}` });
  assert.deepEqual(patch.record.untouched, originalRecord.untouched);
  assert.equal(patch.record.current_website, originalRecord.current_website);
  assert.equal(patch.record.photo_bank.photos[0].sha256, OLD_SHA);
  assert.equal(patch.record.photo_bank.photos[1].sha256, NEW_SHA);
  assert.equal(patch.record.photo_bank.photos[1].source, "own_site");
  assert.equal(patch.record.photo_bank.photos[1].found_on, "https://acmeplumbing.com/projects/new-job");
  assert.match(patch.record.photo_bank.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(patch.updated_at, NOW.toISOString());
  assert.deepEqual(original.record, originalRecord, "the selected row must not be mutated");
});

