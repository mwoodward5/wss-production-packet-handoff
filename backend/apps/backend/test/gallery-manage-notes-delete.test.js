"use strict";

// The gallery's two new write doors: the owner's corrections ("notes") and
// the guarded permanent removal ("delete"). Notes must never invent a field
// the card cannot render back; delete must never reach a row that is not
// archived, no matter what the caller types.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createGalleryManageHandler,
} = require("../api/admin/gallery-manage");

const TOKEN = "gallery-manage-notes-delete-token";

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

function withToken(run) {
  return async () => {
    const saved = process.env.GHOST_AGENCY_ADMIN_TOKEN;
    process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
    try {
      await run();
    } finally {
      if (saved === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
      else process.env.GHOST_AGENCY_ADMIN_TOKEN = saved;
    }
  };
}

const NOW = () => new Date("2026-08-16T12:00:00.000Z");

function row(overrides = {}) {
  return {
    prospect_id: "p-1",
    status: "built",
    business_name: "Example Plumbing",
    city: "Tulsa",
    state: "OK",
    industry: "plumbing",
    record: {
      status: "built",
      business_name: "Example Plumbing",
      city: "Tulsa",
      state: "OK",
      industry: "plumbing",
      private_notes: "Prefers text messages.",
    },
    ...overrides,
  };
}

test("notes and delete both refuse an unauthenticated caller", withToken(async () => {
  const handler = createGalleryManageHandler({
    select: async () => { throw new Error("must not read"); },
    conditionalUpdate: async () => { throw new Error("must not write"); },
    removeRow: async () => { throw new Error("must not delete"); },
  });
  const notes = await call(handler, { action: "notes", prospectId: "p-1", city: "Dallas" }, "wrong");
  assert.equal(notes.status, 401);
  const deleted = await call(handler, { action: "delete", prospectId: "p-1", confirm: "Example Plumbing" }, "wrong");
  assert.equal(deleted.status, 401);
  const method = response();
  await handler({ method: "GET", headers: { "x-admin-token": TOKEN } }, method);
  assert.equal(method.statusCode, 405);
}));

test("notes writes only the provided fields and returns the server record as truth", withToken(async () => {
  const writes = [];
  const events = [];
  const handler = createGalleryManageHandler({
    select: async () => ({ ok: true, data: [row()] }),
    conditionalUpdate: async (table, idColumn, idValue, guards, patch) => {
      writes.push({ table, idColumn, idValue, guards, patch });
      return { ok: true, updated: true, rows: [{}] };
    },
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
    now: NOW,
  });

  const result = await call(handler, { action: "notes", prospectId: "p-1", business_name: "Example Plumbing Co" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.changed, ["business_name"]);
  assert.equal(writes.length, 1);
  const { idColumn, idValue, guards, patch } = writes[0];
  assert.equal(idColumn, "prospect_id");
  assert.equal(idValue, "p-1");
  assert.deepEqual(guards, { status: "eq.built" });
  // The name is written to BOTH the real column and the record mirror the
  // gallery reads from, and nothing else rode along.
  assert.equal(patch.business_name, "Example Plumbing Co");
  assert.equal(patch.city, undefined);
  assert.equal(patch.record.business_name, "Example Plumbing Co");
  assert.equal(patch.record.city, "Tulsa");
  assert.equal(patch.updated_at, NOW().toISOString());
  // The card re-renders from the server's answer, not from what was typed.
  assert.equal(result.payload.site.businessName, "Example Plumbing Co");
  assert.equal(result.payload.site.notes, "Prefers text messages.");

  // One audit event per changed field, in the file's existing event shape.
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "gallery.management");
  assert.equal(events[0].payload.action, "notes");
  assert.equal(events[0].payload.field, "business_name");
  assert.equal(events[0].payload.from, "Example Plumbing");
  assert.equal(events[0].payload.to, "Example Plumbing Co");
  assert.equal(events[0].payload.prospect_id, "p-1");
}));

test("notes edits record the private notes without quoting them into the audit log", withToken(async () => {
  const events = [];
  const handler = createGalleryManageHandler({
    select: async () => ({ ok: true, data: [row()] }),
    conditionalUpdate: async () => ({ ok: true, updated: true }),
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
    now: NOW,
  });
  const result = await call(handler, { action: "notes", prospectId: "p-1", notes: "Owner asked to call back Tuesday after 4pm." });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.changed, ["notes"]);
  assert.equal(result.payload.record.private_notes, "Owner asked to call back Tuesday after 4pm.");
  assert.equal(result.payload.site.notes, "Owner asked to call back Tuesday after 4pm.");
  assert.equal(events[0].payload.field, "notes");
  assert.equal(events[0].payload.from_chars, "Prefers text messages.".length);
  assert.equal(events[0].payload.to_chars, "Owner asked to call back Tuesday after 4pm.".length);
  assert.ok(!("to" in events[0].payload), "private note text must not be copied into events");
}));

test("notes validates lengths and rejects empty patches", withToken(async () => {
  const handler = createGalleryManageHandler({
    select: async () => ({ ok: true, data: [row()] }),
    conditionalUpdate: async () => { throw new Error("must not write"); },
    recordEvent: async () => null,
  });
  // The at-limit handler is separate because a 2000-character note IS a real
  // change and must be allowed to land. Its select resolves by prospect id so
  // the not-found case below is real.
  const atLimitHandler = createGalleryManageHandler({
    select: async (_table, query = "") => {
      const id = /prospect_id=eq\.([^&]+)/.exec(query)?.[1] || "";
      return { ok: true, data: id === "p-1" ? [row()] : [] };
    },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
    recordEvent: async () => null,
  });
  const longName = await call(handler, { action: "notes", prospectId: "p-1", business_name: "x".repeat(121) });
  assert.equal(longName.status, 400);
  assert.equal(longName.payload.error, "business_name_too_long");

  const longNotes = await call(handler, { action: "notes", prospectId: "p-1", notes: "x".repeat(2001) });
  assert.equal(longNotes.status, 400);
  assert.equal(longNotes.payload.error, "notes_too_long");

  // The caps are inclusive: 120 and 2000 are fine.
  const atLimit = await call(atLimitHandler, { action: "notes", prospectId: "p-1", notes: "x".repeat(2000) });
  assert.equal(atLimit.status, 200);

  const empty = await call(handler, { action: "notes", prospectId: "p-1" });
  assert.equal(empty.status, 400);
  assert.equal(empty.payload.error, "nothing_to_update");

  const junk = await call(handler, { action: "notes", prospectId: "p-1", city: "Tulsa\nOK" });
  assert.equal(junk.status, 400);
  assert.equal(junk.payload.error, "city_invalid_characters");

  const missing = await call(atLimitHandler, { action: "notes", prospectId: "p-none" });
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error, "website_not_found");
}));

test("notes with nothing actually changed writes nothing and audits nothing", withToken(async () => {
  const events = [];
  const handler = createGalleryManageHandler({
    select: async () => ({ ok: true, data: [row()] }),
    conditionalUpdate: async () => { throw new Error("must not write"); },
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
  });
  const result = await call(handler, { action: "notes", prospectId: "p-1", city: "Tulsa" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.changed, []);
  assert.equal(events.length, 0);
}));

test("a record that changed mid-edit is reported, not overwritten", withToken(async () => {
  const handler = createGalleryManageHandler({
    select: async () => ({ ok: true, data: [row()] }),
    conditionalUpdate: async () => ({ ok: true, updated: false }),
    recordEvent: async () => null,
  });
  const result = await call(handler, { action: "notes", prospectId: "p-1", business_name: "Someone Else" });
  assert.equal(result.status, 409);
  assert.equal(result.payload.error, "website_changed_while_updating");
}));

test("delete refuses a website that is not archived", withToken(async () => {
  let removals = 0;
  const handler = createGalleryManageHandler({
    select: async () => ({ ok: true, data: [row({ status: "built" })] }),
    conditionalUpdate: async () => ({ ok: true, updated: true }),
    removeRow: async () => { removals += 1; return { ok: true, deleted: true }; },
    recordEvent: async () => null,
  });
  const result = await call(handler, { action: "delete", prospectId: "p-1", confirm: "Example Plumbing" });
  assert.equal(result.status, 409);
  assert.equal(result.payload.error, "not_archived");
  assert.equal(removals, 0, "an active record must never be deleted, however correct the confirmation");
}));

test("delete refuses a confirmation that does not match the business name", withToken(async () => {
  let removals = 0;
  const events = [];
  const handler = createGalleryManageHandler({
    select: async () => ({ ok: true, data: [row({ status: "archived_legacy", record: { status: "archived_legacy", business_name: "Example Plumbing", private_notes: "" } })] }),
    removeRow: async () => { removals += 1; return { ok: true, deleted: true }; },
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
  });
  const wrong = await call(handler, { action: "delete", prospectId: "p-1", confirm: "Example" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.payload.error, "confirm_name_mismatch");

  const absent = await call(handler, { action: "delete", prospectId: "p-1" });
  assert.equal(absent.status, 400);
  assert.equal(absent.payload.error, "confirm_name_required");

  const batch = await call(handler, { action: "delete", prospectId: "p-1", prospectIds: ["p-1", "p-2"], confirm: "Example Plumbing" });
  assert.equal(batch.status, 400);
  assert.equal(batch.payload.error, "delete_is_one_at_a_time");

  assert.equal(removals, 0);
  assert.equal(events.length, 0);
}));

test("delete retires an archived legacy site, tombstones it, and never hard-deletes its record", withToken(async () => {
  const writes = [];
  const events = [];
  const handler = createGalleryManageHandler({
    select: async (table) => table === "ghost_agency_dashboard_access"
      ? { ok: true, data: [] }
      : { ok: true, data: [row({
        prospect_id: "wss-test-example-plumbing",
        status: "archived_legacy",
        record: { status: "archived_legacy", prospect_id: "wss-test-example-plumbing", site_slug: "wss-test-example-plumbing", business_name: "Example Plumbing", private_notes: "" },
      })] },
    conditionalUpdate: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
    executeRetirement: async () => ({ ok: true, receipt: { project: { ok: true }, source: { ok: true }, fleet: { ok: true } } }),
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
    now: NOW,
  });
  const result = await call(handler, { action: "delete", prospectId: "wss-test-example-plumbing", confirm: "example   plumbing" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.deleted, true);
  assert.equal(writes.length, 2, "one durable retiring marker and one completed tombstone");
  assert.equal(writes[0][4].status, "retiring");
  assert.equal(writes[1][4].status, "retired");
  assert.equal(writes[1][4].record.site_retirement.state, "retired");
  assert.equal(writes[1][4].record.do_not_contact, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "gallery_retired");
  assert.equal(events[0].payload.prospect_id, "wss-test-example-plumbing");
  assert.equal(events[0].payload.business_name, "Example Plumbing");
  assert.equal(events[0].payload.created_at, NOW().toISOString());
  assert.ok(result.payload.note.includes("tombstone"));
  assert.equal(result.payload.undo, null);
}));

test("a teardown failure remains durably pending and does not claim deletion", withToken(async () => {
  const writes = [];
  const handler = createGalleryManageHandler({
    select: async (table) => table === "ghost_agency_dashboard_access"
      ? { ok: true, data: [] }
      : { ok: true, data: [row({
        prospect_id: "wss-test-example-plumbing",
        status: "archived_legacy",
        record: { status: "archived_legacy", prospect_id: "wss-test-example-plumbing", site_slug: "wss-test-example-plumbing", business_name: "Example Plumbing" },
      })] },
    conditionalUpdate: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
    executeRetirement: async () => ({ ok: false, reason: "vercel_teardown_failed" }),
    recordEvent: async () => null,
  });
  const result = await call(handler, { action: "delete", prospectId: "wss-test-example-plumbing", confirm: "Example Plumbing" });
  assert.equal(result.status, 202);
  assert.equal(result.payload.deleted, false);
  assert.equal(result.payload.teardownPending, true);
  assert.equal(writes.at(-1)[4].record.site_retirement.state, "teardown_pending");
}));
