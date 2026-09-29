"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const handlerPath = require.resolve("../api/ghost-agency/orchestrate");
const intakePath = require.resolve("../lib/intake-genie-client");
const storePath = require.resolve("../lib/store");
const stripePath = require.resolve("../lib/stripe");

function mockedModule(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

async function invoke(options = {}) {
  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [intakePath, require.cache[intakePath]],
    [storePath, require.cache[storePath]],
    [stripePath, require.cache[stripePath]],
  ]);
  const events = [];
  const writes = [];
  const upserts = [];
  let intakeCalls = 0;
  let checkoutInput = null;

  delete require.cache[handlerPath];
  mockedModule(storePath, {
    insertRow: async (table, row) => {
      writes.push({ table, row });
      return options.writeResult || {
        mode: options.writeMode || "live_write",
        table,
        row: [{ id: "durable-row-1", job_id: row.job_id }],
      };
    },
    recordEvent: async (event, payload) => {
      events.push({ event, payload });
      return { mode: "live_write" };
    },
    upsertRow: async (table, row, conflict) => {
      upserts.push({ table, row, conflict });
      return options.linkResult || { mode: "live_upsert", table, row: [row] };
    },
  });
  mockedModule(intakePath, {
    callIntakeGenie: async () => {
      intakeCalls += 1;
      return options.intake || { ok: false, error: "intake_unavailable" };
    },
    truthPacketFromCanonical: () => ({}),
    status: () => ({ configured: false, reachable: false }),
  });
  mockedModule(stripePath, {
    createCheckoutSession: async (input) => {
      checkoutInput = input;
      if (options.checkoutError) throw options.checkoutError;
      return Object.prototype.hasOwnProperty.call(options, "checkout")
        ? options.checkout
        : { mode: "checkout_session", sessionId: "cs_test_123", url: "https://checkout.stripe.test/session" };
    },
  });

  try {
    const handler = require(handlerPath);
    // orchestrate now self-enforces admin auth (it is directly reachable as its
    // own endpoint). Supply the admin token by default; a case can override the
    // header to assert the rejection path.
    const ADMIN = "orchestrate-test-admin-token";
    process.env.GHOST_AGENCY_ADMIN_TOKEN = ADMIN;
    let raw = "";
    const res = {
      setHeader() {},
      end(value) { raw = value || ""; },
    };
    await handler({
      method: "POST",
      headers: Object.prototype.hasOwnProperty.call(options, "headers")
        ? (options.headers || {})
        : { "x-admin-token": ADMIN },
      body: options.body || { businessName: "Durability Test", ownerEmail: "owner@example.com" },
    }, res);
    return {
      statusCode: res.statusCode,
      body: JSON.parse(raw),
      intakeCalls,
      checkoutInput,
      events,
      writes,
      upserts,
    };
  } finally {
    delete require.cache[handlerPath];
    for (const [path, original] of originals) {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
  }
}

const readyIntake = {
  ok: true,
  packet: {
    status: "ready",
    facts: { name: "Durability Test", category: "Testing" },
  },
};

test("orchestrator accepts only after an explicit durable live_write", async () => {
  for (const mode of ["live_write_failed", "dry_run"]) {
    const result = await invoke({ writeMode: mode });
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error, "storage_unavailable");
    assert.equal(result.intakeCalls, 0);
  }

  const durable = await invoke();
  assert.equal(durable.statusCode, 202);
  assert.equal(durable.body.accepted, true);
  assert.equal(durable.body.state, "research_pending");
  assert.equal(durable.intakeCalls, 1);
  assert.equal(durable.writes.length, 1);
  assert.equal(durable.writes[0].table, "ghost_agency_jobs");
  assert.equal(durable.body.persistence.table, "ghost_agency_jobs");
  assert.equal(durable.body.persistence.key, "job_id");
  assert.match(durable.body.persistence.value, /^req_[a-f0-9]{16}$/);
  assert.doesNotMatch(durable.body.message, /will (email|follow up)/i);
});

test("a repeated request is accepted once without rerunning dependencies", async () => {
  const result = await invoke({
    writeResult: {
      mode: "live_write_failed",
      status: 409,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "ghost_agency_jobs_job_id_key"',
        details: "Key (job_id)=(req_contract) already exists.",
      },
    },
  });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.duplicate, true);
  assert.equal(result.body.state, "already_received");
  assert.equal(result.intakeCalls, 0);
  assert.equal(result.events.length, 0);
  assert.equal(result.body.persistence.table, "ghost_agency_jobs");

  const unrelatedConflict = await invoke({
    writeResult: { mode: "live_write_failed", status: 409, error: { code: "other_conflict" } },
  });
  assert.equal(unrelatedConflict.statusCode, 503);
  assert.equal(unrelatedConflict.body.error, "storage_unavailable");
  assert.equal(unrelatedConflict.intakeCalls, 0);

  const unrelatedUnique = await invoke({
    writeResult: {
      mode: "live_write_failed",
      status: 409,
      error: { code: "23505", message: 'duplicate key violates constraint "some_other_unique_key"' },
    },
  });
  assert.equal(unrelatedUnique.statusCode, 503);
  assert.equal(unrelatedUnique.body.error, "storage_unavailable");
});

test("every non-session Stripe result remains an honest accepted hold", async () => {
  for (const checkout of [
    { mode: "dry_run", configured: false },
    { mode: "checkout_failed", status: 503 },
    { mode: "checkout_session", sessionId: "cs_missing_url" },
    null,
  ]) {
    const result = await invoke({ intake: readyIntake, checkout });
    assert.equal(result.statusCode, 202);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.state, "checkout_pending");
    assert.doesNotMatch(result.body.message, /will (email|follow up)/i);
  }
});

test("a real checkout session proceeds and receives the durable request key", async () => {
  const result = await invoke({ intake: readyIntake });
  assert.equal(result.statusCode, 200, result.body.message);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.actions.checkout.mode, "checkout_session");
  assert.match(result.checkoutInput.idempotencyKey, /^req_[a-f0-9]{16}$/);
  assert.equal(result.upserts.length, 1);
  assert.equal(result.upserts[0].table, "ghost_agency_jobs");
  assert.equal(result.upserts[0].row.job_id, result.body.requestId);
  assert.equal(result.upserts[0].row.payload.downstreamJobId, result.body.job.id);
  assert.equal(result.body.requestLink.mode, "live_upsert");
});

test("a failed durable request linkage returns an honest accepted hold", async () => {
  const result = await invoke({
    intake: readyIntake,
    linkResult: { mode: "live_upsert_failed", status: 500 },
  });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.state, "request_link_pending");
  assert.match(result.body.message, /internal handoff needs attention/i);
  assert.doesNotMatch(result.body.message, /will (email|follow up)/i);
  assert.ok(result.events.some((entry) => entry.event === "preview.request_state"));
});

test("oversized public fields fail before persistence or dependencies", async () => {
  const result = await invoke({
    body: { businessName: "x".repeat(161), ownerEmail: "owner@example.com" },
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "input_too_long");
  assert.equal(result.events.length, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(result.intakeCalls, 0);
});

test("public confirmation exposes the safe request reference", () => {
  const siteScript = fs.readFileSync(path.join(__dirname, "../../labs-site/site.js"), "utf8");
  assert.match(siteScript, /Reference: " \+ savedRequestId/);
  assert.match(siteScript, /result\.message \|\| "Your request is safely saved/);
  assert.doesNotMatch(siteScript, /send the working preview to your email/);
});

test("orchestrate rejects a direct request without admin auth (P0 guard)", async () => {
  const result = await invoke({ headers: {} });
  assert.ok(result.statusCode === 401 || result.statusCode === 503, `expected 401/503, got ${result.statusCode}`);
  assert.equal(result.events.length, 0, "no events written for an unauthenticated request");
  assert.equal(result.writes.length, 0, "no rows written for an unauthenticated request");
  assert.equal(result.intakeCalls, 0, "intake never called for an unauthenticated request");
});
