"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createGalleryManageHandler,
  normalizedIds,
} = require("../api/admin/gallery-manage");

const TOKEN = "gallery-manage-test-token";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = value || ""; },
  };
}

async function call(handler, body, token = TOKEN) {
  const res = response();
  await handler({
    method: "POST",
    headers: { "x-admin-token": token },
    body,
  }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || "{}") };
}

test("archive is reversible, guarded, and does not delete the row", async () => {
  const saved = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
  const writes = [];
  const events = [];
  try {
    const handler = createGalleryManageHandler({
      select: async () => ({
        ok: true,
        data: [{ prospect_id: "p-1", status: "built", record: { status: "built", business_name: "Example" } }],
      }),
      conditionalUpdate: async (...args) => {
        writes.push(args);
        return { ok: true, updated: true, rows: [{}] };
      },
      recordEvent: async (type, payload) => { events.push({ type, payload }); },
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });

    const result = await call(handler, { action: "archive", prospectIds: ["p-1"] });
    assert.equal(result.status, 200);
    assert.equal(result.payload.changed, 1);
    assert.equal(writes.length, 1);
    const [, idColumn, idValue, guards, patch] = writes[0];
    assert.equal(idColumn, "prospect_id");
    assert.equal(idValue, "p-1");
    assert.deepEqual(guards, { status: "eq.built" });
    assert.equal(patch.status, "archived_legacy");
    assert.equal(patch.record.gallery_previous_status, "built");
    assert.equal(patch.record.business_name, "Example");
    assert.equal(events[0].type, "gallery.management");
  } finally {
    if (saved === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = saved;
  }
});

test("restore uses the previously recorded status", async () => {
  const saved = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
  let patch;
  try {
    const handler = createGalleryManageHandler({
      select: async () => ({
        ok: true,
        data: [{
          prospect_id: "p-2",
          status: "archived_legacy",
          record: { status: "archived_legacy", gallery_previous_status: "line_queued" },
        }],
      }),
      conditionalUpdate: async (_table, _idColumn, _idValue, _guards, next) => {
        patch = next;
        return { ok: true, updated: true };
      },
      recordEvent: async () => null,
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });

    const result = await call(handler, { action: "restore", prospectIds: ["p-2"] });
    assert.equal(result.payload.changed, 1);
    assert.equal(patch.status, "line_queued");
    assert.equal(patch.record.status, "line_queued");
    assert.equal(patch.record.gallery_archived_at, null);
  } finally {
    if (saved === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = saved;
  }
});

test("a stale guarded write is reported instead of overwritten", async () => {
  const saved = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
  try {
    const handler = createGalleryManageHandler({
      select: async () => ({ ok: true, data: [{ prospect_id: "p-3", status: "built", record: {} }] }),
      conditionalUpdate: async () => ({ ok: true, updated: false }),
      recordEvent: async () => null,
    });
    const result = await call(handler, { action: "archive", prospectIds: ["p-3"] });
    assert.equal(result.payload.changed, 0);
    assert.equal(result.payload.failed, 1);
    assert.equal(result.payload.results[0].reason, "website_changed_while_updating");
  } finally {
    if (saved === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = saved;
  }
});

test("batch input is unique and bounded at 100", () => {
  const ids = normalizedIds(Array.from({ length: 140 }, (_, index) => `p-${index}`).concat(["p-1"]));
  assert.equal(ids.length, 100);
  assert.equal(new Set(ids).size, 100);
});

test("the route refuses unauthenticated management", async () => {
  const saved = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
  try {
    const handler = createGalleryManageHandler({
      select: async () => { throw new Error("must not read"); },
      conditionalUpdate: async () => { throw new Error("must not write"); },
    });
    const result = await call(handler, { action: "archive", prospectIds: ["p-1"] }, "wrong");
    assert.equal(result.status, 401);
  } finally {
    if (saved === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = saved;
  }
});
