"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { conditionalUpdate, insertRow, upsertRow } = require("../lib/store");
const { createLinePersistence } = require("../lib/line-persistence");

const originalFetch = global.fetch;
const originalWarn = console.warn;
const originalError = console.error;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonResponse(status, body, headers = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) || null },
    json: async () => body,
  };
}

function previewRow(overrides = {}) {
  const expiresAt = "2026-07-21T12:00:00.000Z";
  return {
    prospect_id: "places-preview-store-test",
    status: "previewed",
    report_url: "https://callprep.example/report/store-test",
    preview_url: "https://preview.example/store-test",
    preview_expires_at: expiresAt,
    record: {
      prospect_id: "places-preview-store-test",
      business_name: "Sensitive Business Name",
      email: "owner@example.test",
      provider_secret: "do-not-log-this-secret",
      preview_expires_at: expiresAt,
    },
    updated_at: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

function missingColumnResponse(details = "owner@example.test do-not-log-this-secret") {
  return jsonResponse(400, {
    code: "PGRST204",
    message: "Could not find the 'preview_expires_at' column of 'ghost_agency_prospects' in the schema cache",
    details,
    hint: "Sensitive Business Name",
  }, { "x-request-id": "supabase-schema-request" });
}

function assertInterruptedWrite(result, mode, code, category) {
  assert.deepEqual(result, {
    mode,
    table: "ghost_agency_prospects",
    status: 0,
    error: { code, category, retryable: true },
    aborted: true,
    ...(mode === "live_update_failed" ? { ok: false, updated: false } : {}),
    ...(mode === "live_upsert_failed"
      ? { attempts: 1, diagnosticId: result.diagnosticId }
      : {}),
  });
  assert.equal(JSON.stringify(result).includes("owner@example.test"), false);
  assert.equal(JSON.stringify(result).includes("service-role-test-secret"), false);
}

test("Supabase upsert persistence contract", async (t) => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";

  let warnings = [];
  let errors = [];
  console.warn = (line) => warnings.push(String(line));
  console.error = (line) => errors.push(String(line));

  t.after(() => {
    global.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  });

  await t.test("uses the normal upsert path when the schema accepts the full row", async () => {
    warnings = [];
    errors = [];
    const requests = [];
    const row = previewRow();
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse(201, [{ prospect_id: row.prospect_id }]);
    };

    const result = await upsertRow("ghost_agency_prospects", row, "prospect_id");

    assert.equal(result.mode, "live_upsert");
    assert.equal(result.compatibility, undefined);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /on_conflict=prospect_id/);
    assert.equal(requests[0].options.headers.apikey, "service-role-test-secret");
    assert.equal(requests[0].options.headers.Prefer, "resolution=merge-duplicates,return=representation");
    assert.deepEqual(JSON.parse(requests[0].options.body), row);
    assert.deepEqual(warnings, []);
    assert.deepEqual(errors, []);
  });

  await t.test("retries without a missing optional column only when record already mirrors it", async () => {
    warnings = [];
    errors = [];
    const requests = [];
    const row = previewRow();
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? missingColumnResponse()
        : jsonResponse(201, [{ prospect_id: row.prospect_id }], { "x-request-id": "supabase-compat-success" });
    };

    const result = await upsertRow("ghost_agency_prospects", row, "prospect_id");
    const firstBody = JSON.parse(requests[0].options.body);
    const retryBody = JSON.parse(requests[1].options.body);

    assert.equal(result.mode, "live_upsert");
    assert.equal(requests.length, 2);
    assert.equal(firstBody.preview_expires_at, row.preview_expires_at);
    assert.equal(Object.prototype.hasOwnProperty.call(retryBody, "preview_expires_at"), false);
    assert.equal(retryBody.record.preview_expires_at, row.preview_expires_at);
    assert.deepEqual(result.compatibility, {
      mode: "mirrored_optional_column_omitted",
      omittedColumns: ["preview_expires_at"],
      mirroredColumn: "record",
      attempts: 2,
    });
    assert.equal(warnings.length, 1);
    assert.deepEqual(errors, []);

    const diagnostic = JSON.parse(warnings[0]);
    assert.equal(diagnostic.event, "ghost_store_upsert_compat");
    assert.equal(diagnostic.table, "ghost_agency_prospects");
    assert.equal(diagnostic.error_code, "PGRST204");
    assert.equal(diagnostic.error_column, "preview_expires_at");
    assert.deepEqual(diagnostic.omitted_columns, ["preview_expires_at"]);
    for (const secret of ["owner@example.test", "do-not-log-this-secret", "Sensitive Business Name", "service-role-test-secret"]) {
      assert.equal(warnings[0].includes(secret), false);
    }
  });

  await t.test("does not drop a missing column when its value is not durably mirrored", async () => {
    warnings = [];
    errors = [];
    let calls = 0;
    const row = previewRow({ record: { prospect_id: "places-preview-store-test" } });
    global.fetch = async () => {
      calls += 1;
      return missingColumnResponse();
    };

    const result = await upsertRow("ghost_agency_prospects", row, "prospect_id");

    assert.equal(calls, 1);
    assert.equal(result.mode, "live_upsert_failed");
    assert.equal(result.status, 400);
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.error, {
      code: "PGRST204",
      category: "schema_column_missing",
      retryable: false,
      column: "preview_expires_at",
    });
    assert.deepEqual(warnings, []);
    assert.equal(errors.length, 1);
    assert.equal(JSON.parse(errors[0]).error_column, "preview_expires_at");
    for (const secret of ["owner@example.test", "do-not-log-this-secret", "Sensitive Business Name", "service-role-test-secret"]) {
      assert.equal(`${errors[0]}${JSON.stringify(result)}`.includes(secret), false);
    }
  });

  await t.test("does not drop a mirrored column outside the compatibility allowlist", async () => {
    warnings = [];
    errors = [];
    let calls = 0;
    const row = previewRow({
      unapproved_column: "mirrored-value",
      record: {
        ...previewRow().record,
        unapproved_column: "mirrored-value",
      },
    });
    global.fetch = async () => {
      calls += 1;
      return jsonResponse(400, {
        code: "PGRST204",
        message: "Could not find the 'unapproved_column' column of 'ghost_agency_prospects' in the schema cache",
      });
    };

    const result = await upsertRow("ghost_agency_prospects", row, "prospect_id");

    assert.equal(calls, 1);
    assert.equal(result.mode, "live_upsert_failed");
    assert.equal(result.error.column, "unapproved_column");
    assert.deepEqual(warnings, []);
    assert.equal(errors.length, 1);
    assert.equal(JSON.parse(errors[0]).error_column, "unapproved_column");
  });

  await t.test("remains failed when the compatibility retry is rejected", async () => {
    warnings = [];
    errors = [];
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return calls === 1
        ? missingColumnResponse()
        : jsonResponse(503, {
            code: "XX000",
            message: "owner@example.test",
            details: "do-not-log-this-secret",
          }, { "x-request-id": "supabase-retry-failure" });
    };

    const result = await upsertRow("ghost_agency_prospects", previewRow(), "prospect_id");

    assert.equal(calls, 2);
    assert.equal(result.mode, "live_upsert_failed");
    assert.equal(result.status, 503);
    assert.equal(result.attempts, 2);
    assert.deepEqual(result.error, {
      code: "XX000",
      category: "provider_unavailable",
      retryable: true,
    });
    assert.deepEqual(result.compatibility, {
      mode: "mirrored_optional_column_retry_failed",
      omittedColumns: ["preview_expires_at"],
      mirroredColumn: "record",
    });
    assert.deepEqual(warnings, []);
    assert.equal(errors.length, 1);
    for (const secret of ["owner@example.test", "do-not-log-this-secret", "Sensitive Business Name", "service-role-test-secret"]) {
      assert.equal(`${errors[0]}${JSON.stringify(result)}`.includes(secret), false);
    }
  });

  await t.test("turns network exceptions into an observable fail-closed result", async () => {
    warnings = [];
    errors = [];
    global.fetch = async () => {
      throw new Error("request included service-role-test-secret");
    };

    const result = await upsertRow("ghost_agency_prospects", previewRow(), "prospect_id");

    assert.equal(result.mode, "live_upsert_failed");
    assert.equal(result.status, 0);
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.error, {
      code: "network_error",
      category: "network_failure",
      retryable: true,
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].includes("service-role-test-secret"), false);
  });

  await t.test("pre-expired INSERT and UPSERT deadlines perform no fetch", async () => {
    warnings = [];
    errors = [];
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(201, []);
    };
    const options = { deadlineAt: Date.now() - 1 };

    const inserted = await insertRow("ghost_agency_prospects", previewRow(), options);
    const upserted = await upsertRow("ghost_agency_prospects", previewRow(), "prospect_id", options);

    assertInterruptedWrite(inserted, "live_write_failed", "write_timeout", "provider_timeout");
    assertInterruptedWrite(upserted, "live_upsert_failed", "write_timeout", "provider_timeout");
    assert.equal(fetchCalls, 0);
    assert.deepEqual(warnings, []);
    assert.equal(errors.length, 1, "upsert emits one PII-free diagnostic");
    assert.equal(errors[0].includes("owner@example.test"), false);
    assert.equal(errors[0].includes("service-role-test-secret"), false);
  });

  await t.test("INSERT and UPSERT deadlines bound fetch implementations that never settle", async () => {
    warnings = [];
    errors = [];
    const receivedSignals = [];
    global.fetch = async (_url, options) => {
      receivedSignals.push(options.signal);
      return new Promise(() => {});
    };

    const insertStartedAt = Date.now();
    const inserted = await insertRow(
      "ghost_agency_prospects",
      previewRow(),
      { deadlineAt: insertStartedAt + 25 },
    );
    const upsertStartedAt = Date.now();
    const upserted = await upsertRow(
      "ghost_agency_prospects",
      previewRow(),
      "prospect_id",
      { deadlineAt: upsertStartedAt + 25 },
    );

    assertInterruptedWrite(inserted, "live_write_failed", "write_timeout", "provider_timeout");
    assertInterruptedWrite(upserted, "live_upsert_failed", "write_timeout", "provider_timeout");
    assert.ok(Date.now() - insertStartedAt < 250);
    assert.ok(Date.now() - upsertStartedAt < 250);
    assert.equal(receivedSignals.length, 2);
    assert.ok(receivedSignals.every((signal) => signal?.aborted === true));
    assert.equal(errors.length, 1);
  });

  await t.test("line persistence forwards write options into the default INSERT seam", async () => {
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(201, []);
    };
    const persistence = createLinePersistence({
      selectRows: async () => ({ mode: "live_select", rows: [] }),
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    });

    const result = await persistence.createBatch({
      batchId: "store-deadline-forwarding",
      lane: "sandbox",
      target: "Portland dentists",
      requested: 1,
      status: "building",
    }, { deadlineAt: Date.now() - 1 });

    assert.deepEqual(result, { ok: false, error: "write_timeout", retryable: true });
    assert.equal(fetchCalls, 0);
  });

  await t.test("conditional PATCH forwards AbortSignal and cannot mutate after cancellation", async () => {
    let lateMutations = 0;
    let receivedSignal;
    global.fetch = async (_url, options) => new Promise((resolve, reject) => {
      receivedSignal = options.signal;
      const timer = setTimeout(() => {
        lateMutations += 1;
        resolve(jsonResponse(200, [{ prospect_id: "abort-owner-proof" }]));
      }, 100);
      options.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("conditional update aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    const controller = new AbortController();
    const request = conditionalUpdate(
      "ghost_agency_prospects",
      "prospect_id",
      "abort-owner-proof",
      { updated_at: "eq.2026-07-28T12:00:00.000Z" },
      { status: "held" },
      { signal: controller.signal },
    );
    controller.abort(new Error("owner@example.test service-role-test-secret"));

    const result = await request;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assertInterruptedWrite(result, "live_update_failed", "write_aborted", "request_aborted");
    assert.ok(receivedSignal);
    assert.equal(receivedSignal.aborted, true);
    assert.equal(lateMutations, 0);
  });

  await t.test("expired conditional PATCH deadline performs no fetch", async () => {
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(200, []);
    };

    const result = await conditionalUpdate(
      "ghost_agency_prospects",
      "prospect_id",
      "expired-owner-proof",
      { updated_at: "eq.2026-07-28T12:00:00.000Z" },
      { status: "held" },
      { deadlineAt: Date.now() - 1 },
    );

    assertInterruptedWrite(result, "live_update_failed", "write_timeout", "provider_timeout");
    assert.equal(fetchCalls, 0);
  });

  await t.test("conditional PATCH deadline remains active through response body parsing", async () => {
    let receivedSignal;
    let lateBodyCompletions = 0;
    global.fetch = async (_url, options) => {
      receivedSignal = options.signal;
      return {
        ok: true,
        status: 200,
        json: async () => new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            lateBodyCompletions += 1;
            resolve([{ prospect_id: "slow-body-owner-proof" }]);
          }, 100);
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("response body aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        }),
      };
    };

    const startedAt = Date.now();
    const result = await conditionalUpdate(
        "ghost_agency_prospects",
        "prospect_id",
        "slow-body-owner-proof",
        { updated_at: "eq.2026-07-28T12:00:00.000Z" },
        { status: "held" },
        { deadlineAt: startedAt + 30 },
    );
    const settledAt = Date.now();

    await new Promise((resolve) => setTimeout(resolve, 120));
    assertInterruptedWrite(result, "live_update_failed", "write_timeout", "provider_timeout");
    assert.ok(receivedSignal);
    assert.equal(receivedSignal.aborted, true);
    assert.ok(settledAt - startedAt < 100);
    assert.equal(lateBodyCompletions, 0);
  });
});
