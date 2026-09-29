"use strict";

// test/site-change-log.test.js — the change log is records-in, sentences-out,
// with NO fabrication path. Every test that matters here is a truth test:
// unknown statuses produce nothing, failed reads mark the log incomplete
// instead of empty, and every emitted entry names the record it came from.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  siteChangeLog,
  describeEditRow,
  describeHistoryStatus,
  describeThread,
  describeEvent,
  slugOfPreviewUrl,
  windowOf,
  siteUrlFor,
} = require("../lib/site-change-log");

const SLUG = "wss-test-rose-city-heating-and-air-portland";
const SITE_URL = `https://${SLUG}.wss-ai.com/`;

// A fixed window: 2026-08-10T00:00Z .. 2026-08-11T00:00Z
const SINCE = "2026-08-10T00:00:00.000Z";
const UNTIL = "2026-08-11T00:00:00.000Z";
const WINDOW = windowOf({ since: SINCE, until: UNTIL });
const IN_WINDOW = "2026-08-10T12:00:00.000Z";

function fakeSelect(handlers) {
  const calls = [];
  const select = async (table, query) => {
    calls.push({ table, query: String(query) });
    for (const handler of handlers) {
      if (handler.table !== table) continue;
      if (handler.match && !String(query).includes(handler.match)) continue;
      if (typeof handler.result === "function") return handler.result(String(query));
      return handler.result;
    }
    return { ok: true, mode: "live_select", data: [] };
  };
  select.calls = calls;
  return select;
}

const emptySelect = () => fakeSelect([]);

// ---------------------------------------------------------------------------
// windowOf / slug plumbing
// ---------------------------------------------------------------------------

test("windowOf: defaults to the 24h ending now, rejects inverted windows", () => {
  const now = Date.parse("2026-08-11T00:00:00.000Z");
  const defaulted = windowOf({}, now);
  assert.equal(defaulted.ok, true);
  assert.equal(defaulted.untilMs, now);
  assert.equal(defaulted.untilMs - defaulted.sinceMs, 24 * 60 * 60 * 1000);
  assert.equal(windowOf({ since: UNTIL, until: SINCE }).ok, false);
  assert.equal(windowOf({ until: "not a date" }).ok, false);
});

test("slugOfPreviewUrl: only *.wss-ai.com hosts resolve, everything else is empty", () => {
  assert.equal(slugOfPreviewUrl(`https://${SLUG}.wss-ai.com/`), SLUG);
  assert.equal(slugOfPreviewUrl("https://evil.example.com/"), "");
  assert.equal(slugOfPreviewUrl("not a url"), "");
  assert.equal(slugOfPreviewUrl(""), "");
});

test("siteChangeLog: refuses an invalid slug outright", async () => {
  const result = await siteChangeLog({ siteSlug: "Bad Slug!", select: emptySelect() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "site_slug_invalid");
  assert.deepEqual(result.entries, []);
});

// ---------------------------------------------------------------------------
// Source 1: edit jobs
// ---------------------------------------------------------------------------

function editRow(overrides = {}) {
  return {
    job_id: "edit_1",
    site_slug: SLUG,
    instruction: "Make the logo in the top corner twice as big",
    status: "done",
    result: { say: "That's live on your site." },
    created_at: "2026-08-10T11:00:00.000Z",
    updated_at: IN_WINDOW,
    ...overrides,
  };
}

test("edit jobs: each recorded status maps to its own truthful sentence", () => {
  const done = describeEditRow(editRow(), WINDOW, SITE_URL);
  assert.equal(done.kind, "edit_done");
  assert.match(done.what, /is live on your site/);
  assert.match(done.what, /Make the logo in the top corner twice as big/);
  assert.equal(done.at, IN_WINDOW); // terminal entries use updated_at
  assert.equal(done.proof, SITE_URL);
  assert.equal(done.source.table, "ghost_agency_edit_jobs");
  assert.equal(done.detail, "That's live on your site.");

  const refused = describeEditRow(editRow({ status: "refused", result: {} }), WINDOW, SITE_URL);
  assert.equal(refused.kind, "edit_refused");
  assert.match(refused.what, /left as it was/);

  const failed = describeEditRow(editRow({ status: "failed", result: {} }), WINDOW, SITE_URL);
  assert.equal(failed.kind, "edit_failed");
  assert.match(failed.what, /did not go through/);
  // failed claims NOTHING about the state of the site — that sentence belongs
  // to result.say when the closer wrote one.
  assert.doesNotMatch(failed.what, /nothing on your site changed/i);

  const queued = describeEditRow(editRow({ status: "queued", result: null }), WINDOW, SITE_URL);
  assert.equal(queued.kind, "edit_in_progress");
  assert.equal(queued.at, "2026-08-10T11:00:00.000Z"); // open entries use created_at
});

test("edit jobs: unknown status produces NO entry — there is no fallback sentence", () => {
  assert.equal(describeEditRow(editRow({ status: "exploded" }), WINDOW, SITE_URL), null);
  assert.equal(describeEditRow(editRow({ status: "" }), WINDOW, SITE_URL), null);
  assert.equal(describeEditRow(null, WINDOW, SITE_URL), null);
});

test("edit jobs: an entry outside the window is absent", () => {
  assert.equal(
    describeEditRow(editRow({ updated_at: "2026-08-12T00:00:00.000Z" }), WINDOW, SITE_URL),
    null,
  );
  assert.equal(
    describeEditRow(editRow({ created_at: "bad", updated_at: "also bad" }), WINDOW, SITE_URL),
    null,
  );
});

// ---------------------------------------------------------------------------
// Source 2: batch history
// ---------------------------------------------------------------------------

test("batch history: recognised statuses only; picked/qualified and unknowns are silent", () => {
  const at = Date.parse(IN_WINDOW);
  const ctx = { previewUrl: SITE_URL, reason: "", siteUrl: SITE_URL, batchId: "line_b1", atMs: at };
  assert.equal(describeHistoryStatus("mirrored", ctx).kind, "rebuild");
  assert.equal(describeHistoryStatus("gate_passed", ctx).kind, "checks_passed");
  assert.equal(describeHistoryStatus("queued", ctx).kind, "preview_published");
  assert.equal(describeHistoryStatus("sent", ctx).kind, "update_emailed");
  assert.equal(describeHistoryStatus("gate_failed", ctx).kind, "rebuild_held");
  assert.equal(describeHistoryStatus("error", ctx).kind, "rebuild_incomplete");
  assert.equal(describeHistoryStatus("picked", ctx), null);
  assert.equal(describeHistoryStatus("qualified", ctx), null);
  assert.equal(describeHistoryStatus("teleported", ctx), null);
});

test("batch history: error claims nothing about the live site, carries the recorded reason", () => {
  const described = describeHistoryStatus("error", {
    previewUrl: SITE_URL,
    reason: "worker_stopped: the build process stopped mid-run",
    siteUrl: SITE_URL,
    batchId: "line_b1",
    atMs: Date.parse(IN_WINDOW),
  });
  assert.match(described.what, /stopped before completing/);
  assert.doesNotMatch(described.what, /site was not changed/i);
  assert.match(described.detail, /worker_stopped/);
});

function snapshot(id, createdAt, rows, batchId = "line_b1") {
  return { id, type: "line.batch", created_at: createdAt, payload: { batchId, batch: { batchId, rows } } };
}

test("siteChangeLog: cumulative snapshots dedup to one history, other slugs ignored", async () => {
  const myRow = (history) => ({ previewUrl: SITE_URL, history });
  const otherRow = {
    previewUrl: "https://wss-test-someone-else.wss-ai.com/",
    history: [{ status: "mirrored", at: IN_WINDOW }],
  };
  const shortHistory = [{ status: "mirrored", at: "2026-08-10T01:00:00.000Z" }];
  const longHistory = [
    { status: "picked", at: "2026-08-10T00:30:00.000Z" },
    { status: "mirrored", at: "2026-08-10T01:00:00.000Z" },
    { status: "gate_passed", at: "2026-08-10T01:05:00.000Z" },
    { status: "queued", at: "2026-08-10T01:06:00.000Z" },
  ];
  const select = fakeSelect([
    {
      table: "ghost_agency_events",
      match: "type=eq.line.batch",
      result: {
        ok: true,
        data: [
          snapshot(2, "2026-08-10T01:07:00.000Z", [myRow(longHistory), otherRow]),
          snapshot(1, "2026-08-10T01:01:00.000Z", [myRow(shortHistory)]),
        ],
      },
    },
  ]);
  const result = await siteChangeLog({ siteSlug: SLUG, since: SINCE, until: UNTIL, select });
  assert.equal(result.ok, true);
  const kinds = result.entries.map((e) => e.kind);
  // one rebuild (not two — the short snapshot is the same batch), checks, preview
  assert.deepEqual(kinds, ["rebuild", "checks_passed", "preview_published"]);
  // ascending order by recorded time
  assert.deepEqual(result.entries.map((e) => e.at), [
    "2026-08-10T01:00:00.000Z",
    "2026-08-10T01:05:00.000Z",
    "2026-08-10T01:06:00.000Z",
  ]);
  // nothing from the other site's row
  assert.equal(result.entries.some((e) => e.proof.includes("someone-else")), false);
  // proof is the recorded preview URL for this site
  assert.equal(result.entries[0].proof, SITE_URL);
});

// ---------------------------------------------------------------------------
// Source 3: threads
// ---------------------------------------------------------------------------

test("threads: contact details make a lead, none makes a conversation, system needs a subject", () => {
  const base = {
    id: 7,
    thread_key: "tk_1",
    site_slug: SLUG,
    channel: "chat",
    contact_name: "Pat Doe",
    contact_info: "",
    subject: "Quote request — Water heater",
    created_at: IN_WINDOW,
  };
  const conversation = describeThread(base, WINDOW, SITE_URL);
  assert.equal(conversation.kind, "new_conversation");
  assert.match(conversation.what, /Pat Doe started a conversation/);
  assert.match(conversation.what, /Quote request — Water heater/);

  const lead = describeThread({ ...base, contact_info: "pat@example.com" }, WINDOW, SITE_URL);
  assert.equal(lead.kind, "lead_captured");
  assert.match(lead.what, /left contact details/);
  assert.equal(lead.detail, "pat@example.com");

  assert.equal(describeThread({ ...base, channel: "system", subject: "" }, WINDOW, SITE_URL), null);
  const notice = describeThread({ ...base, channel: "system", subject: "Test checkout completed" }, WINDOW, SITE_URL);
  assert.equal(notice.kind, "site_notice");
  assert.match(notice.what, /Test checkout completed/);

  // unknown channel -> nothing
  assert.equal(describeThread({ ...base, channel: "carrier_pigeon" }, WINDOW, SITE_URL), null);
  // outside window -> nothing
  assert.equal(describeThread({ ...base, created_at: "2026-08-12T00:00:00.000Z" }, WINDOW, SITE_URL), null);
});

// ---------------------------------------------------------------------------
// Source 4: prospect-joined events
// ---------------------------------------------------------------------------

test("events: recognised types map, edit-job event types and unknowns are silent", () => {
  const at = IN_WINDOW;
  const opened = describeEvent(
    { id: 1, type: "preview.reveal_opened", created_at: at, payload: { prospectId: "p1" } },
    WINDOW,
    SITE_URL,
  );
  assert.equal(opened.kind, "preview_opened");

  const replied = describeEvent(
    { id: 2, type: "connect_ai_reply_sent", created_at: at, payload: { leadCaptured: true } },
    WINDOW,
    SITE_URL,
  );
  assert.equal(replied.kind, "assistant_replied");
  assert.match(replied.what, /captured their contact details/);
  const repliedNoLead = describeEvent(
    { id: 3, type: "connect_ai_reply_sent", created_at: at, payload: { leadCaptured: false } },
    WINDOW,
    SITE_URL,
  );
  assert.doesNotMatch(repliedNoLead.what, /captured/);

  const started = describeEvent(
    { id: 4, type: "system.run", created_at: at, payload: { stage: "built", status: "started" } },
    WINDOW,
    SITE_URL,
  );
  assert.equal(started.kind, "rebuild_started");
  const blocked = describeEvent(
    { id: 5, type: "system.run", created_at: at, payload: { stage: "built", status: "blocked", ready: false, blocked: "consent_required" } },
    WINDOW,
    SITE_URL,
  );
  assert.equal(blocked.kind, "rebuild_held");
  assert.equal(blocked.detail, "consent_required");
  const republished = describeEvent(
    { id: 6, type: "system.run", created_at: at, payload: { stage: "built", status: "ok", ready: true } },
    WINDOW,
    SITE_URL,
  );
  assert.equal(republished.kind, "rebuild");
  const refused = describeEvent(
    { id: 7, type: "system.run", created_at: at, payload: { stage: "mirror_lane_refused", reason: "invalid_request" } },
    WINDOW,
    SITE_URL,
  );
  assert.equal(refused.kind, "rebuild_held");
  assert.equal(refused.detail, "invalid_request");

  // edit-job event types are the edit table's story — never double-counted here
  assert.equal(
    describeEvent({ id: 8, type: "ghost_agency_site_edit_queued", created_at: at, payload: {} }, WINDOW, SITE_URL),
    null,
  );
  // unknown types: silent
  assert.equal(
    describeEvent({ id: 9, type: "vapi_customer_webhook", created_at: at, payload: {} }, WINDOW, SITE_URL),
    null,
  );
  // a system.run stage this module does not know: silent
  assert.equal(
    describeEvent({ id: 10, type: "system.run", created_at: at, payload: { stage: "mined" } }, WINDOW, SITE_URL),
    null,
  );
});

test("siteChangeLog: events dedup across join clauses; no prospect row means no event queries by id", async () => {
  const event = {
    id: 42,
    type: "preview.reveal_opened",
    created_at: IN_WINDOW,
    payload: { prospectId: "prospect_1", siteSlug: SLUG, at: IN_WINDOW },
  };
  const select = fakeSelect([
    {
      table: "ghost_agency_prospects",
      result: { ok: true, data: [{ prospect_id: "prospect_1", site_slug: SLUG, updated_at: IN_WINDOW }] },
    },
    { table: "ghost_agency_events", match: "payload->>prospectId", result: { ok: true, data: [event] } },
    { table: "ghost_agency_events", match: "payload->>siteSlug", result: { ok: true, data: [event] } },
  ]);
  const result = await siteChangeLog({ siteSlug: SLUG, since: SINCE, until: UNTIL, select });
  assert.equal(result.entries.filter((e) => e.kind === "preview_opened").length, 1); // deduped by event id
  assert.equal(result.sources.prospect.found, true);

  // without a prospect row the id-joined queries are simply not derivable
  const bare = emptySelect();
  const empty = await siteChangeLog({ siteSlug: SLUG, since: SINCE, until: UNTIL, select: bare });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.sources.prospect.found, false);
  const idJoins = bare.calls.filter((c) => c.query.includes("payload->>prospectId"));
  assert.equal(idJoins.length, 0);
});

// ---------------------------------------------------------------------------
// The assembled truth surface
// ---------------------------------------------------------------------------

test("siteChangeLog: nothing changed -> entries [] and complete true (caller sends nothing)", async () => {
  const result = await siteChangeLog({ siteSlug: SLUG, since: SINCE, until: UNTIL, select: emptySelect() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries, []);
  assert.equal(result.complete, true);
});

test("siteChangeLog: a failed source read marks the log INCOMPLETE, never empty-and-certain", async () => {
  const select = fakeSelect([
    { table: "connect_threads", result: { ok: false, mode: "live_select_failed", status: 400, error: { code: "PGRST100" } } },
    {
      table: "ghost_agency_edit_jobs",
      result: { ok: true, data: [editRow()] },
    },
  ]);
  const result = await siteChangeLog({ siteSlug: SLUG, since: SINCE, until: UNTIL, select });
  assert.equal(result.ok, true);
  assert.equal(result.complete, false);
  assert.equal(result.sources.connect_threads.ok, false);
  // the healthy source still reports its real entries
  assert.equal(result.entries.some((e) => e.kind === "edit_done"), true);
  // and the failed source contributed nothing
  assert.equal(result.entries.some((e) => e.kind === "new_conversation"), false);
});

test("siteChangeLog: a throwing select is a failed source, not a crash and not entries", async () => {
  const select = async (table) => {
    if (table === "ghost_agency_edit_jobs") throw new Error("network down");
    return { ok: true, mode: "live_select", data: [] };
  };
  const result = await siteChangeLog({ siteSlug: SLUG, since: SINCE, until: UNTIL, select });
  assert.equal(result.ok, true);
  assert.equal(result.sources.edit_jobs.ok, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.entries, []);
});

test("siteChangeLog: every emitted entry has when/what/proof/source, proof on this site", async () => {
  const select = fakeSelect([
    { table: "ghost_agency_edit_jobs", result: { ok: true, data: [editRow()] } },
    {
      table: "connect_threads",
      result: {
        ok: true,
        data: [{
          id: 1, thread_key: "t", site_slug: SLUG, channel: "chat",
          contact_name: "Website visitor", contact_info: "", subject: "Website chat",
          created_at: IN_WINDOW,
        }],
      },
    },
    {
      table: "ghost_agency_events",
      match: "type=eq.line.batch",
      result: {
        ok: true,
        data: [snapshot(1, IN_WINDOW, [{ previewUrl: SITE_URL, history: [{ status: "mirrored", at: IN_WINDOW }] }])],
      },
    },
  ]);
  const result = await siteChangeLog({ siteSlug: SLUG, since: SINCE, until: UNTIL, select });
  assert.equal(result.entries.length, 3);
  for (const item of result.entries) {
    assert.match(item.at, /^2026-08-10T/);
    assert.equal(typeof item.what, "string");
    assert.notEqual(item.what.trim(), "");
    assert.equal(item.proof, SITE_URL);
    assert.equal(item.source && typeof item.source.table, "string");
  }
  assert.equal(siteUrlFor(SLUG), SITE_URL);
});
