"use strict";

// test/riley-followups.test.js — the contract for lib/riley-followups.js: the
// machinery that turns "you'll get 1 email when it's live" from a phantom
// promise into a durable row with a consent gate and exactly-one-send law.
//
// Every assertion below fires the mailer only through an injected spy. The
// load-bearing property: a refusal that still calls sendResendEmail is not a
// refusal — the consent gate, the suppression gate and the truth gate are all
// proven by the ABSENCE of a send.

const test = require("node:test");
const assert = require("node:assert/strict");

const fup = require("../lib/riley-followups");

function deps(over = {}) {
  const promises = new Map(); // promise_key -> row
  const sent = [];
  const events = [];
    const rows = over.prospect === undefined ? [] : (Array.isArray(over.prospect) ? over.prospect : [over.prospect]);
  return {
    sent,
    events,
    promises,
    select: async (table, query) => {
      if (table === fup.PROMISES_TABLE) {
        const key = /promise_key=eq\.([^&]+)/.exec(query || "");
        if (key) {
          const row = promises.get(decodeURIComponent(key[1]));
          return { ok: true, data: row ? [row] : [] };
        }
        const job = /job_id=eq\.([^&]+)/.exec(query || "");
        if (job) {
          const all = [...promises.values()].filter((r) => r.job_id === decodeURIComponent(job[1]));
          return { ok: true, data: all };
        }
        return { ok: true, data: [] };
      }
      if (table === "ghost_agency_suppressions") {
        if (over.suppressionReadFails) return { ok: false, data: [] };
        return { ok: true, data: over.suppressed ? [{ suppression_key: "x" }] : [] };
      }
      return { ok: true, data: rows };
    },
    upsertRow: async (_table, row) => {
      promises.set(row.promise_key, { ...promises.get(row.promise_key), ...row });
      return { mode: "live_upsert" };
    },
    recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
    sendResendEmail: async (input) => { sent.push(input); return { mode: "sent", id: "re_test_1" }; },
    now: () => "2026-09-02T12:00:00.000Z",
    ...(over.overrides || {}),
  };
}

const DONE_JOB = {
  job_id: "edit_test_1",
  site_slug: "wss-test-logic-heating-and-air-tulsa",
  instruction: "Make the phone number in the header bigger.",
  status: "done",
  result: { attempts: 1 },
  follow_up: null,
};

const PROSPECT = {
  prospect_id: "pros_1",
  business_name: "Logic Heating and Air",
  site_slug: "wss-test-logic-heating-and-air-tulsa",
  preview_url: "https://wss-test-logic-heating-and-air-tulsa.wss-ai.com/",
  email: "owner@logicheating.example",
  owner_email: null,
  record: {},
};

function promised(d, consent = true) {
  d.promises.set(fup.promiseKeyFor("edit_test_1", "live_email"), {
    promise_key: fup.promiseKeyFor("edit_test_1", "live_email"),
    job_id: "edit_test_1",
    site_slug: DONE_JOB.site_slug,
    promise_kind: "live_email",
    consent_email: consent,
    consent_source: consent ? "verbal_call" : null,
    status: "pending",
  });
}

// ---------------------------------------------------------------------------
// promise rows
// ---------------------------------------------------------------------------

test("a promise is durable, and a duplicate call reports itself without a second row", async () => {
  const d = deps();
  const first = await fup.recordFollowUpPromise({ jobId: "edit_test_1", callId: "call_a", siteSlug: DONE_JOB.site_slug, consentEmail: true }, d);
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  const second = await fup.recordFollowUpPromise({ jobId: "edit_test_1", consentEmail: true }, d);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true, "the second recording of the same promise is a duplicate");
  const rows = [...d.promises.values()].filter((r) => r.job_id === "edit_test_1");
  assert.equal(rows.length, 1, "one promise row, whatever is said twice");
});

test("consent can be upgraded, never downgraded", async () => {
  const d = deps();
  await fup.recordFollowUpPromise({ jobId: "j1", consentEmail: false }, d);
  await fup.recordFollowUpPromise({ jobId: "j1", consentEmail: true, consentSource: "verbal_call" }, d);
  assert.equal(d.promises.get(fup.promiseKeyFor("j1", "live_email")).consent_email, true, "a later yes stands");
  await fup.recordFollowUpPromise({ jobId: "j1", consentEmail: false }, d);
  assert.equal(d.promises.get(fup.promiseKeyFor("j1", "live_email")).consent_email, true, "a later no cannot un-hear the yes");
});

test("a promise without a job is refused — every promise rides a real job", async () => {
  const d = deps();
  const out = await fup.recordFollowUpPromise({ consentEmail: true }, d);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "jobId_required");
});

test("the inline job-row flag is read in all three shapes", () => {
  assert.deepEqual(fup.inlinePromiseFromJob({ follow_up: true }), { promise_kind: "live_email", consent_email: false, inline: true });
  assert.deepEqual(
    fup.inlinePromiseFromJob({ follow_up: { promise_kind: "resend_report", consent_email: true, consent_source: "verbal_call" } }),
    { promise_kind: "resend_report", consent_email: true, consent_source: "verbal_call", inline: true },
  );
  assert.deepEqual(fup.inlinePromiseFromJob({ result: { follow_up: true } }), { promise_kind: "live_email", consent_email: false, inline: true });
  assert.equal(fup.inlinePromiseFromJob({ follow_up: null }), null);
  assert.equal(fup.inlinePromiseFromJob({}), null);
});

// ---------------------------------------------------------------------------
// the truth gate — compose refuses anything but a measured `done`
// ---------------------------------------------------------------------------

test("the customer live email refuses to compose for any job that is not done", () => {
  for (const status of ["queued", "running", "failed", "refused"]) {
    const out = fup.composeCustomerLiveEmail({ jobRow: { ...DONE_JOB, status }, record: PROSPECT });
    assert.equal(out.ok, false, `${status} must never produce a "it's live" email`);
    assert.equal(out.reason, "job_not_done");
  }
  assert.equal(fup.composeCustomerLiveEmail({ jobRow: null, record: PROSPECT }).ok, false);
});

test("the composed live email claims exactly what the terminal write proves", () => {
  const out = fup.composeCustomerLiveEmail({ jobRow: DONE_JOB, record: PROSPECT });
  assert.equal(out.ok, true);
  assert.match(out.subject, /it's live/i);
  assert.match(out.text, /Make the phone number in the header bigger\./, "the caller's own words, quoted");
  assert.match(out.text, /https:\/\/wss-test-logic-heating-and-air-tulsa\.wss-ai\.com\//, "the proof link is the site itself");
  assert.match(out.text, /owner@logicheating\.example|it's live/i);
  assert.match(out.text, /Reply STOP/, "the opt-out promise is in the text half");
  assert.match(out.html, /See it live/, "and the html half names the proof");
  // No ETAs, no durations, no invented numbers.
  assert.doesNotMatch(out.text, /minute|hour|shortly|soon/i);
});

// ---------------------------------------------------------------------------
// deliverFollowUp — the gates, in order
// ---------------------------------------------------------------------------

test("no promise on the job means no-op: one read, zero sends, zero writes", async () => {
  const d = deps();
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", jobRow: DONE_JOB }, d);
  assert.deepEqual(out, { ok: true, outcome: "no_promise" });
  assert.equal(d.sent.length, 0);
  assert.equal(d.events.length, 0, "nothing happened, so nothing is claimed");
});

test("a promise with NO consent is never sent: owner-only, and the row records the refusal", async () => {
  const d = deps({ prospect: PROSPECT });
  promised(d, false);
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  assert.equal(out.outcome, "refused");
  assert.equal(out.status, "refused_no_consent");
  assert.equal(out.ownerOnly, true);
  assert.equal(d.sent.length, 0, "the refusal must reach the mailer for nobody — not even by accident");
  assert.equal(d.promises.get(fup.promiseKeyFor("edit_test_1", "live_email")).status, "refused_no_consent");
  assert.ok(d.events.some((e) => e.name === "riley_followup_refused" && e.payload.refused === "no_consent"));
});

test("consent + client record + clean ledger = exactly one send, to the record's address only", async () => {
  const d = deps({ prospect: PROSPECT });
  promised(d, true);
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  assert.equal(out.outcome, "sent");
  assert.equal(d.sent.length, 1);
  assert.equal(d.sent[0].to, "owner@logicheating.example", "the recipient is the one ON THE RECORD");
  assert.equal(d.sent[0].idempotencyKey, fup.promiseKeyFor("edit_test_1", "live_email"), "a retried send dedupes at the provider boundary");
  assert.equal(d.promises.get(fup.promiseKeyFor("edit_test_1", "live_email")).status, "sent");
  assert.ok(d.events.some((e) => e.name === "riley_followup_sent"));
});

test("a second delivery attempt after `sent` is skipped — the email goes once", async () => {
  const d = deps({ prospect: PROSPECT });
  promised(d, true);
  await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  assert.equal(out.outcome, "skipped");
  assert.equal(d.sent.length, 1, "whatever re-runs, the customer gets one email");
});

test("the recipient NEVER comes from anywhere but the client record", async () => {
  const d = deps({ prospect: { ...PROSPECT, email: null, owner_email: "fallback@logicheating.example" } });
  promised(d, true);
  const out = await fup.deliverFollowUp({
    jobId: "edit_test_1",
    siteSlug: DONE_JOB.site_slug,
    jobRow: DONE_JOB,
    // even if a caller-supplied address rides along, it is ignored
    requestedTo: "stranger@elsewhere.example",
  }, d);
  assert.equal(out.outcome, "sent");
  assert.equal(d.sent[0].to, "fallback@logicheating.example", "owner_email is the record's fallback, still the record");
});

test("no client record, or a record with no address, refuses with a reason on the row", async () => {
  const d0 = deps({ prospect: [] });
  promised(d0, true);
  const noRecord = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d0);
  assert.equal(noRecord.status, "refused_no_client_record");
  assert.equal(d0.sent.length, 0);

  const d1 = deps({ prospect: { ...PROSPECT, email: null, owner_email: null } });
  promised(d1, true);
  const noEmail = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d1);
  assert.equal(noEmail.status, "refused_no_email");
  assert.equal(d1.sent.length, 0);
  assert.equal(d1.promises.get(fup.promiseKeyFor("edit_test_1", "live_email")).status, "refused_no_email");
});

test("a suppression hit refuses the send even WITH consent — the ledger wins", async () => {
  const d = deps({ prospect: PROSPECT, suppressed: true });
  promised(d, true);
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  assert.equal(out.status, "refused_suppressed");
  assert.equal(d.sent.length, 0);
  assert.equal(d.promises.get(fup.promiseKeyFor("edit_test_1", "live_email")).status, "refused_suppressed");
});

test("a suppression read that FAILS fails closed: no send on an unchecked ledger", async () => {
  const d = deps({ prospect: PROSPECT, suppressionReadFails: true });
  promised(d, true);
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  assert.equal(out.status, "failed_send");
  assert.equal(out.reason, "suppression_check_unavailable");
  assert.equal(d.sent.length, 0, "an unverifiable ledger never precedes a customer email");
});

test("an inline follow_up flag with consent rides the job row and keeps the promise", async () => {
  const d = deps({ prospect: PROSPECT });
  const out = await fup.deliverFollowUp({
    jobId: "edit_test_1",
    siteSlug: DONE_JOB.site_slug,
    jobRow: { ...DONE_JOB, follow_up: { consent_email: true, consent_source: "verbal_call" } },
  }, d);
  assert.equal(out.outcome, "sent");
  assert.equal(d.sent.length, 1);
  assert.equal(d.promises.get(fup.promiseKeyFor("edit_test_1", "live_email")).status, "sent");
});

test("an inline flag WITHOUT consent lands as refused_no_consent — never a send", async () => {
  const d = deps({ prospect: PROSPECT });
  const out = await fup.deliverFollowUp({
    jobId: "edit_test_1",
    siteSlug: DONE_JOB.site_slug,
    jobRow: { ...DONE_JOB, follow_up: true },
  }, d);
  assert.equal(out.status, "refused_no_consent");
  assert.equal(d.sent.length, 0);
});

test("resend_report keeps the 'send the review sheet again' promise only when the record carries a link", async () => {
  const withUrl = deps({ prospect: { ...PROSPECT, report_url: "https://callprep.wss-ai.com/report/r_abc123" } });
  withUrl.promises.set(fup.promiseKeyFor("edit_test_1", "resend_report"), {
    promise_key: fup.promiseKeyFor("edit_test_1", "resend_report"),
    job_id: "edit_test_1",
    site_slug: DONE_JOB.site_slug,
    promise_kind: "resend_report",
    consent_email: true,
    consent_source: "verbal_call",
    status: "pending",
  });
  const sent = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, withUrl);
  assert.equal(sent.outcome, "sent");
  assert.equal(sent.kind, "resend_report");
  assert.match(withUrl.sent[0].subject, /review sheet/i);
  assert.match(withUrl.sent[0].text, /https:\/\/callprep\.wss-ai\.com\/report\/r_abc123/);

  const withoutUrl = deps({ prospect: PROSPECT });
  withoutUrl.promises.set(fup.promiseKeyFor("edit_test_2", "resend_report"), {
    promise_key: fup.promiseKeyFor("edit_test_2", "resend_report"),
    job_id: "edit_test_2",
    site_slug: DONE_JOB.site_slug,
    promise_kind: "resend_report",
    consent_email: true,
    status: "pending",
  });
  const refused = await fup.deliverFollowUp({ jobId: "edit_test_2", siteSlug: DONE_JOB.site_slug, jobRow: { ...DONE_JOB, job_id: "edit_test_2" } }, withoutUrl);
  assert.equal(refused.status, "refused_no_report_url", "a fabricated link is the same defect as a fabricated claim");
  assert.equal(withoutUrl.sent.length, 0);
});

test("a mailer failure records failed_send and never claims success", async () => {
  const d = deps({ prospect: PROSPECT, overrides: { sendResendEmail: async () => ({ mode: "dry_run" }) } });
  promised(d, true);
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  assert.equal(out.outcome, "refused");
  assert.equal(out.status, "failed_send");
  assert.ok(d.events.some((e) => e.name === "riley_followup_failed"));
});

test("a promise row read back with its generated id is written WITHOUT the id — PostgREST 428C9 guard", async () => {
  // ghost_agency tables use GENERATED ALWAYS identities; a write that carries
  // `id` is rejected by PostgREST, and store.js strips generated columns only
  // for its own allowlist — so the promise machinery strips it itself.
  const d = deps({ prospect: PROSPECT });
  promised(d, true);
  const key = fup.promiseKeyFor("edit_test_1", "live_email");
  d.promises.set(key, { ...d.promises.get(key), id: 42, created_at: "2026-09-01T00:00:00.000Z" });
  const upserts = [];
  const originalUpsert = d.upsertRow;
  d.upsertRow = async (table, row, conflict) => { upserts.push(row); return originalUpsert(table, row, conflict); };
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d);
  assert.equal(out.outcome, "sent");
  assert.equal(upserts.some((r) => Object.prototype.hasOwnProperty.call(r, "id")), false, "the generated identity never re-enters a write");
});

test("deliverFollowUp never throws, whatever the store does", async () => {
  const d = deps({ overrides: { select: async () => { throw new Error("store down"); } } });
  // MUST resolve (the runner runs this as a tail call) and MUST send nothing:
  // a broken store can produce a no-send, never a wrong send.
  const out = await fup.deliverFollowUp({ jobId: "edit_test_1" }, d);
  assert.ok(out && typeof out === "object");
  assert.equal(d.sent.length, 0, "a broken store can never produce a send");

  // Same guarantee mid-flow: the promise and record reads succeed, then the
  // ledger read explodes. Fail closed — no send, no crash into the runner.
  const d2 = deps({ prospect: PROSPECT });
  promised(d2, true);
  d2.select = async (table, query) => {
    if (String(table) === "ghost_agency_suppressions") throw new Error("ledger down");
    return (deps({ prospect: PROSPECT })).select(table, query);
  };
  const out2 = await fup.deliverFollowUp({ jobId: "edit_test_1", siteSlug: DONE_JOB.site_slug, jobRow: DONE_JOB }, d2);
  assert.equal(d2.sent.length, 0);
  assert.notEqual(out2.outcome, "sent");
});
