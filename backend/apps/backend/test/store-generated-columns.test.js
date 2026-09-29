"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { conditionalUpdate, insertRow, upsertRow } = require("../lib/store");

const originalFetch = global.fetch;
const originalError = console.error;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function generatedFailure(column = "future_generated") {
  return jsonResponse(400, {
    code: "428C9",
    message: `cannot insert a non-DEFAULT value into column "${column}"`,
    details: "owner@example.test Sensitive Business Name",
    hint: "service-role-test-secret",
  });
}

test("generated-column writes are table-specific and fail closed", async (t) => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  let errors = [];
  console.error = (line) => errors.push(String(line));

  t.after(() => {
    global.fetch = originalFetch;
    console.error = originalError;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  });

  await t.test("proactively strips ghost_agency_prospects.site_slug from upserts", async () => {
    errors = [];
    const requests = [];
    const row = {
      prospect_id: "prospect-upsert",
      site_slug: "generated-slug",
      status: "previewed",
      record: { site_slug: "historical-record-value" },
    };
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse(201, [{ prospect_id: row.prospect_id }]);
    };

    const result = await upsertRow("ghost_agency_prospects", row, "prospect_id");
    const written = JSON.parse(requests[0].options.body);

    assert.equal(result.mode, "live_upsert");
    assert.equal(requests.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(written, "site_slug"), false);
    assert.equal(written.record.site_slug, "historical-record-value");
    assert.equal(row.site_slug, "generated-slug", "the caller-owned row must not be mutated");
    assert.deepEqual(errors, []);
  });

  await t.test("proactively strips site_slug from every row in a bulk insert", async () => {
    const requests = [];
    const rows = [
      { prospect_id: "prospect-insert-a", site_slug: "generated-a", status: "held" },
      { prospect_id: "prospect-insert-b", site_slug: "generated-b", status: "held" },
    ];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse(201, rows.map(({ prospect_id }) => ({ prospect_id })));
    };

    const result = await insertRow("ghost_agency_prospects", rows);
    const written = JSON.parse(requests[0].options.body);

    assert.equal(result.mode, "live_write");
    assert.equal(written.length, 2);
    assert.ok(written.every((row) => !Object.prototype.hasOwnProperty.call(row, "site_slug")));
    assert.deepEqual(rows.map((row) => row.site_slug), ["generated-a", "generated-b"]);
  });

  await t.test("strips site_slug from PATCH while preserving writable fields", async () => {
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse(200, [{ prospect_id: "prospect-patch", status: "held" }]);
    };

    const patch = { site_slug: "generated-patch", status: "held" };
    const result = await conditionalUpdate(
      "ghost_agency_prospects",
      "prospect_id",
      "prospect-patch",
      {},
      patch,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(requests[0].options.body), { status: "held" });
    assert.equal(patch.site_slug, "generated-patch");
  });

  await t.test("refuses a PATCH containing only a generated field without a network call", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return jsonResponse(200, []);
    };

    const result = await conditionalUpdate(
      "ghost_agency_prospects",
      "prospect_id",
      "prospect-generated-only",
      {},
      { site_slug: "generated-only" },
    );

    assert.equal(calls, 0);
    assert.deepEqual(result, {
      ok: false,
      mode: "live_update_rejected",
      table: "ghost_agency_prospects",
      updated: false,
      error: {
        code: "generated_conflict_column",
        category: "generated_column",
        retryable: false,
        column: "site_slug",
      },
    });
  });

  await t.test("rejects site_slug as a prospect upsert conflict column before I/O", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return jsonResponse(201, []);
    };

    const result = await upsertRow(
      "ghost_agency_prospects",
      { prospect_id: "prospect-conflict", site_slug: "generated-conflict", email: "owner@example.test" },
      "prospect_id, site_slug",
    );

    assert.equal(calls, 0);
    assert.deepEqual(result.error, {
      code: "generated_conflict_column",
      category: "generated_column",
      retryable: false,
      column: "site_slug",
    });
    assert.equal(JSON.stringify(result).includes("owner@example.test"), false);
  });

  await t.test("does not retry an unknown 428C9 column and returns no provider PII", async () => {
    errors = [];
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return generatedFailure("future_generated");
    };

    const result = await upsertRow(
      "ghost_agency_prospects",
      {
        prospect_id: "prospect-unknown-generated",
        future_generated: "owner@example.test",
        business_name: "Sensitive Business Name",
      },
      "prospect_id",
    );

    assert.equal(calls, 1);
    assert.equal(result.mode, "live_upsert_failed");
    assert.deepEqual(result.error, {
      code: "428C9",
      category: "generated_column",
      retryable: false,
      column: "future_generated",
    });
    assert.equal(errors.length, 1);
    for (const secret of ["owner@example.test", "Sensitive Business Name", "service-role-test-secret"]) {
      assert.equal(`${errors[0]}${JSON.stringify(result)}`.includes(secret), false);
    }
  });

  await t.test("classifies a 428C9 response even when the provider omits its column", async () => {
    errors = [];
    global.fetch = async () => jsonResponse(400, {
      code: "428C9",
      message: "generated write rejected for owner@example.test",
      details: "Sensitive Business Name",
    });

    const result = await upsertRow(
      "ghost_agency_prospects",
      { prospect_id: "prospect-unparsed-generated" },
      "prospect_id",
    );

    assert.deepEqual(result.error, {
      code: "428C9",
      category: "generated_column",
      retryable: false,
    });
    assert.equal(`${errors[0]}${JSON.stringify(result)}`.includes("owner@example.test"), false);
    assert.equal(`${errors[0]}${JSON.stringify(result)}`.includes("Sensitive Business Name"), false);
  });

  await t.test("sanitizes 428C9 responses from insert and PATCH paths", async () => {
    global.fetch = async () => generatedFailure("future_generated");

    const inserted = await insertRow("ghost_agency_prospects", {
      prospect_id: "prospect-insert-error",
      email: "owner@example.test",
    });
    const patched = await conditionalUpdate(
      "ghost_agency_prospects",
      "prospect_id",
      "prospect-patch-error",
      {},
      { status: "held", email: "owner@example.test" },
    );

    for (const result of [inserted, patched]) {
      assert.deepEqual(result.error, {
        code: "428C9",
        category: "generated_column",
        retryable: false,
        column: "future_generated",
      });
      assert.equal(JSON.stringify(result).includes("owner@example.test"), false);
      assert.equal(JSON.stringify(result).includes("Sensitive Business Name"), false);
    }
  });

  await t.test("does not treat site_slug as generated on other tables", async () => {
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse(options.method === "PATCH" ? 200 : 201, [{ site_slug: "stored-slug" }]);
    };

    await insertRow("connect_site_settings", { site_slug: "stored-slug", greeting: "Hi" });
    await upsertRow("connect_site_settings", { site_slug: "stored-slug", greeting: "Hi" }, "site_slug");
    await conditionalUpdate(
      "connect_site_settings",
      "site_slug",
      "stored-slug",
      {},
      { site_slug: "stored-slug", greeting: "Hello" },
    );

    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map(({ options }) => JSON.parse(options.body)), [
      { site_slug: "stored-slug", greeting: "Hi" },
      { site_slug: "stored-slug", greeting: "Hi" },
      { site_slug: "stored-slug", greeting: "Hello" },
    ]);
  });
});
