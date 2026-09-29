"use strict";

// lib/site-change-log.js — the true list of changes to ONE site over a window,
// assembled from records that already exist. Nothing here observes the site,
// nothing here writes, and nothing here invents.
//
// WHY THIS FILE EXISTS. The owner-update email ("here's what changed on your
// site this week") needs a list of changes a business owner would care about.
// This codebase has repeatedly paid for surfaces that pad, guess, or read from
// a fallback sentence ("QC PASS is never proof"; the FALLBACK.failed lie
// documented in lib/customer-edits.js). So this module is governed by one law:
//
//   EVERY ENTRY IS A RECORD. Each entry is derived from exactly one row or
//   event that already exists in the durable store, carries that record's own
//   timestamp, and names its source. A status or event type this module does
//   not recognise produces NO entry — there is no default branch that emits
//   text, so there is no path from "something unknown happened" to a sentence
//   claiming a change. If nothing changed, `entries` is [] and the caller
//   sends nothing.
//
// The four sources, and what they truthfully support saying:
//
//   1. ghost_agency_edit_jobs — the Riley/dashboard edit engine's job rows
//      (job_id, site_slug, instruction, status, result, created_at,
//      updated_at). Statuses queued|running|done|refused|failed. `done` is
//      written only after the runner landed and verified the change
//      (lib/edit-job-runner.js), so "is live" is safe for done and ONLY done.
//      `result.say` is the sentence composed for this customer at terminal
//      time; when present it is more specific than anything we could write
//      here and rides along as `detail`.
//
//   2. line.batch snapshots in ghost_agency_events — each snapshot carries the
//      batch's rows, and each row carries `history`: the state machine's own
//      log ({status, at, reason}) written by advanceRow (lib/line-state.js).
//      mirrored = a build produced a candidate; gate_passed = the render gate
//      proved its facts on the live DOM; queued = preview_url written (the
//      site became viewable — the "revealable flip"); sent = the batch email
//      went out after operator approval; gate_failed/error = the attempt
//      ended without replacing anything. picked/qualified are pipeline
//      internals a business owner would not call a change; they are skipped
//      BY NAME, not by default-case.
//
//   3. connect_threads — a row per conversation started on the site
//      (site_slug, channel, contact_name, contact_info, subject, created_at).
//      A row with contact details is a captured lead; a row without is a
//      conversation. `system` threads are internal notices and only surface
//      when they carry their own subject line to quote.
//
//   4. ghost_agency_events joined through the prospect row — reveal-link opens
//      (preview.reveal_opened / preview.clicked), assistant replies
//      (connect_ai_reply_sent), and build dispatches (system.run stage=built /
//      mirror_lane_refused). The join key is the durable prospect row's own
//      prospect_id / site_slug — never a fuzzy name match, because two
//      different ids that merely look alike is how a report ends up describing
//      someone else's site. No prospect row -> these events are simply not
//      derivable -> absent.
//
// A FAILED READ IS NOT AN EMPTY LIST (lib/customer-edits.js learned this the
// hard way): a source that could not be read reports ok:false in `sources`,
// contributes zero entries, and flips `complete` to false so the caller knows
// the list may be missing items — the opposite failure from inventing them.

const { select: defaultSelect } = require("./store");
const { parseEditInstruction } = require("./customer-uploads");

/** Public host every mirror lives on; the proof link is the live page itself. */
const SITE_HOST_SUFFIX = ".wss-ai.com";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest quoted excerpt of a customer instruction inside a sentence. */
const MAX_EXCERPT_CHARS = 140;

/** Row/event read caps — an owner digest, not an export. */
const EDIT_JOB_LIMIT = 100;
const THREAD_LIMIT = 100;
const BATCH_SNAPSHOT_LIMIT = 400;
const EVENT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Small honest helpers
// ---------------------------------------------------------------------------

function normalizeSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(slug) ? slug : "";
}

function siteUrlFor(slug) {
  return `https://${slug}${SITE_HOST_SUFFIX}/`;
}

/** The slug a previewUrl actually names, or "" — never a guess. */
function slugOfPreviewUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname.toLowerCase();
    if (!host.endsWith(SITE_HOST_SUFFIX)) return "";
    return normalizeSlug(host.slice(0, -SITE_HOST_SUFFIX.length));
  } catch {
    return "";
  }
}

function parseWhen(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : NaN;
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * windowOf({ since, until, windowMs, now }) -> { ok, sinceMs, untilMs } — the
 * report's time fence. Defaults to the 24 hours ending now. An entry is IN the
 * window when its own recorded timestamp is inside [since, until].
 */
function windowOf(options = {}, nowMs = Date.now()) {
  const untilMs = options.until === undefined ? nowMs : parseWhen(options.until);
  if (!Number.isFinite(untilMs)) return { ok: false, reason: "until_invalid" };
  let sinceMs;
  if (options.since !== undefined) {
    sinceMs = parseWhen(options.since);
  } else {
    const span = Number(options.windowMs);
    sinceMs = untilMs - (Number.isFinite(span) && span > 0 ? span : DAY_MS);
  }
  if (!Number.isFinite(sinceMs)) return { ok: false, reason: "since_invalid" };
  if (sinceMs >= untilMs) return { ok: false, reason: "window_empty" };
  return { ok: true, sinceMs, untilMs };
}

/** Same discipline as lib/customer-edits.readRows: a failed read is NOT []. */
function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  const mode = result && result.mode;
  if (mode && mode !== "live_select") return { ok: false, rows: [], error: String(result?.error?.code || result?.error?.category || mode) };
  if (Array.isArray(result && result.data)) return { ok: true, rows: result.data };
  if (Array.isArray(result && result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [], error: "unreadable_select_result" };
}

function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function excerpt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > MAX_EXCERPT_CHARS ? `${clean.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…` : clean;
}

/**
 * entry() — the single constructor every source funnels through. It refuses
 * (returns null) rather than emitting an entry whose "when" or "what" is not
 * real: an unparseable timestamp cannot honestly answer "when", and an empty
 * sentence is not a change.
 */
function entry({ atMs, kind, what, proof, source, detail }) {
  if (!Number.isFinite(atMs)) return null;
  const sentence = String(what || "").trim();
  if (!sentence || !kind) return null;
  const built = {
    at: new Date(atMs).toISOString(),
    kind,
    what: sentence,
    proof: String(proof || ""),
    source: source || null,
  };
  const extra = String(detail || "").trim();
  if (extra) built.detail = extra;
  return built;
}

function within(atMs, window) {
  return Number.isFinite(atMs) && atMs >= window.sinceMs && atMs <= window.untilMs;
}

// ---------------------------------------------------------------------------
// Source 1: edit jobs
// ---------------------------------------------------------------------------

/** The request as the customer typed it, quoted — or "" when the row has none. */
function requestExcerpt(instruction) {
  const { message } = parseEditInstruction(instruction);
  return excerpt(message);
}

/**
 * describeEditRow(row, window, siteUrl) -> entry | null
 *
 * Sentences are keyed on the EXACT recorded status. `done` may say "is live"
 * because the runner only writes done after the rendered page proved the
 * change (lib/edit-job-runner.js). `failed` deliberately claims nothing about
 * the state of the site — a job the sweeper closed may have died mid-deploy,
 * and the truthful sentence for that ending is the one the closer wrote into
 * result.say, which travels as `detail`.
 */
function describeEditRow(row, window, siteUrl) {
  const source = plain(row) || {};
  const status = String(source.status || "").toLowerCase();
  const result = plain(source.result) || {};
  const quoted = requestExcerpt(source.instruction);
  const asked = quoted ? `"${quoted}"` : "a change you asked for";
  const say = String(result.say || "").trim();
  const ref = { table: "ghost_agency_edit_jobs", job_id: String(source.job_id || "") };
  const terminalAt = parseWhen(source.updated_at || source.created_at);
  const openAt = parseWhen(source.created_at || source.updated_at);

  if (status === "done") {
    if (!within(terminalAt, window)) return null;
    return entry({
      atMs: terminalAt,
      kind: "edit_done",
      what: `Your requested change is live on your site: ${asked}.`,
      proof: siteUrl,
      source: ref,
      detail: say,
    });
  }
  if (status === "refused") {
    if (!within(terminalAt, window)) return null;
    return entry({
      atMs: terminalAt,
      kind: "edit_refused",
      what: `We did not make this change, and your site was left as it was: ${asked}.`,
      proof: siteUrl,
      source: ref,
      detail: say,
    });
  }
  if (status === "failed") {
    if (!within(terminalAt, window)) return null;
    return entry({
      atMs: terminalAt,
      kind: "edit_failed",
      what: `A change you asked for did not go through: ${asked}.`,
      proof: siteUrl,
      source: ref,
      detail: say,
    });
  }
  if (status === "queued" || status === "running") {
    if (!within(openAt, window)) return null;
    return entry({
      atMs: openAt,
      kind: "edit_in_progress",
      what: `We received your change request and it is being worked on: ${asked}.`,
      proof: siteUrl,
      source: ref,
    });
  }
  // An unrecognised status is NOT described. No fallback sentence exists.
  return null;
}

async function collectEditJobs({ slug, window, select, siteUrl }) {
  const sinceIso = new Date(window.sinceMs).toISOString();
  const found = await select(
    "ghost_agency_edit_jobs",
    `select=job_id,site_slug,instruction,status,result,created_at,updated_at`
      + `&site_slug=eq.${encodeURIComponent(slug)}`
      + `&updated_at=gte.${encodeURIComponent(sinceIso)}`
      + `&order=updated_at.desc&limit=${EDIT_JOB_LIMIT}`,
  ).catch(() => null);
  const { ok, rows, error } = readRows(found);
  if (!ok) return { ok: false, error: error || "edit_jobs_read_failed", entries: [] };
  const entries = [];
  for (const row of rows) {
    const described = describeEditRow(row, window, siteUrl);
    if (described) entries.push(described);
  }
  return { ok: true, count: rows.length, entries };
}

// ---------------------------------------------------------------------------
// Source 2: line.batch snapshots -> row history
// ---------------------------------------------------------------------------

/**
 * What each recorded history status supports saying to the business owner.
 * picked/qualified are pipeline selection steps, skipped by name. Anything not
 * listed here yields nothing — deliberately no default sentence.
 */
function describeHistoryStatus(status, { previewUrl, reason, siteUrl, batchId, atMs }) {
  const ref = { table: "ghost_agency_events", type: "line.batch", batch_id: batchId };
  switch (status) {
    case "mirrored":
      return entry({
        atMs,
        kind: "rebuild",
        what: "A new version of your website was built.",
        proof: previewUrl || siteUrl,
        source: ref,
      });
    case "gate_passed":
      return entry({
        atMs,
        kind: "checks_passed",
        what: "The new version of your site passed its pre-publish checks on the rendered page.",
        proof: previewUrl || siteUrl,
        source: ref,
      });
    case "queued":
      // preview_url is written only after a passing gate (lib/line-adapters
      // writePreviewUrl) and this history entry is stamped when that happened:
      // the moment the site became viewable at its public address.
      return entry({
        atMs,
        kind: "preview_published",
        what: "Your new site preview went live at its own web address.",
        proof: previewUrl || siteUrl,
        source: ref,
      });
    case "sent":
      return entry({
        atMs,
        kind: "update_emailed",
        what: "An email introducing the new site preview was sent.",
        proof: previewUrl || siteUrl,
        source: ref,
      });
    case "gate_failed":
      return entry({
        atMs,
        kind: "rebuild_held",
        what: "A new version was built but held back by our checks — it did not replace your live page.",
        proof: previewUrl || siteUrl,
        source: ref,
        detail: reason,
      });
    case "error":
      // Claims nothing about the state of the site: an error row may have
      // stopped before OR after its preview went live. The closer's own
      // sentence (reason) carries whatever specifics were recorded.
      return entry({
        atMs,
        kind: "rebuild_incomplete",
        what: "A build run for your site stopped before completing.",
        proof: previewUrl || siteUrl,
        source: ref,
        detail: reason,
      });
    case "picked":
    case "qualified":
      return null; // pipeline internals, skipped by name
    default:
      return null; // unknown status -> no sentence, ever
  }
}

/**
 * collectBatchActivity — line.batch snapshots are cumulative (every mutation
 * re-writes the whole batch), so the same history entry appears in many
 * snapshots. Per batch we keep the row with the LONGEST history for this slug
 * and then emit each history entry that falls inside the window, keyed by its
 * own `at`. Rows are matched by the slug their recorded previewUrl actually
 * names — a row with no previewUrl cannot be tied to this site and is left
 * alone.
 */
async function collectBatchActivity({ slug, window, select, siteUrl }) {
  const sinceIso = new Date(window.sinceMs).toISOString();
  const found = await select(
    "ghost_agency_events",
    `select=id,type,created_at,payload&type=eq.line.batch`
      + `&created_at=gte.${encodeURIComponent(sinceIso)}`
      + `&order=created_at.desc&limit=${BATCH_SNAPSHOT_LIMIT}`,
  ).catch(() => null);
  const { ok, rows, error } = readRows(found);
  if (!ok) return { ok: false, error: error || "line_batch_read_failed", entries: [] };

  const bestByBatch = new Map(); // batchId -> { row, batchId }
  let snapshots = 0;
  for (const snapshot of rows) {
    const batch = plain(plain(snapshot?.payload)?.batch);
    if (!batch) continue;
    snapshots += 1;
    const batchId = String(batch.batchId || plain(snapshot.payload).batchId || "");
    for (const row of Array.isArray(batch.rows) ? batch.rows : []) {
      if (slugOfPreviewUrl(row?.previewUrl) !== slug) continue;
      const key = batchId || `snapshot_${snapshot.id}`;
      const history = Array.isArray(row.history) ? row.history : [];
      const kept = bestByBatch.get(key);
      if (!kept || history.length > (Array.isArray(kept.row.history) ? kept.row.history.length : 0)) {
        bestByBatch.set(key, { row, batchId: key });
      }
    }
  }

  const entries = [];
  for (const { row, batchId } of bestByBatch.values()) {
    for (const step of Array.isArray(row.history) ? row.history : []) {
      const atMs = parseWhen(step?.at);
      if (!within(atMs, window)) continue;
      const described = describeHistoryStatus(String(step?.status || ""), {
        previewUrl: String(row.previewUrl || ""),
        reason: String(step?.reason || ""),
        siteUrl,
        batchId,
        atMs,
      });
      if (described) entries.push(described);
    }
  }
  return { ok: true, snapshots, batches: bestByBatch.size, entries };
}

// ---------------------------------------------------------------------------
// Source 3: connect threads
// ---------------------------------------------------------------------------

const CHANNEL_WORD = Object.freeze({
  chat: "website chat",
  email: "email",
  sms: "text message",
  phone: "phone",
});

function describeThread(row, window, siteUrl) {
  const source = plain(row) || {};
  const atMs = parseWhen(source.created_at);
  if (!within(atMs, window)) return null;
  const channel = String(source.channel || "").toLowerCase();
  const subject = excerpt(source.subject);
  const name = excerpt(source.contact_name);
  const contactInfo = excerpt(source.contact_info);
  const ref = { table: "connect_threads", id: source.id ?? null, thread_key: String(source.thread_key || "") };

  if (channel === "system") {
    // Internal notice threads only surface when they carry their own subject
    // to quote; a bare system row supports no owner-facing sentence.
    if (!subject) return null;
    return entry({
      atMs,
      kind: "site_notice",
      what: `A notice was posted to your site's inbox: "${subject}".`,
      proof: siteUrl,
      source: ref,
    });
  }

  const via = CHANNEL_WORD[channel];
  if (!via) return null; // unknown channel -> nothing

  const who = name ? `${name} started` : "A visitor started";
  const about = subject ? ` — "${subject}"` : "";
  if (contactInfo) {
    return entry({
      atMs,
      kind: "lead_captured",
      what: `New lead from your site: ${who.replace(/ started$/, "")} reached out via ${via} and left contact details${about}.`,
      proof: siteUrl,
      source: ref,
      detail: contactInfo,
    });
  }
  return entry({
    atMs,
    kind: "new_conversation",
    what: `${who} a conversation on your site via ${via}${about}.`,
    proof: siteUrl,
    source: ref,
  });
}

async function collectThreads({ slug, window, select, siteUrl }) {
  const sinceIso = new Date(window.sinceMs).toISOString();
  const found = await select(
    "connect_threads",
    `select=id,thread_key,site_slug,channel,contact_name,contact_info,subject,created_at`
      + `&site_slug=eq.${encodeURIComponent(slug)}`
      + `&created_at=gte.${encodeURIComponent(sinceIso)}`
      + `&order=created_at.desc&limit=${THREAD_LIMIT}`,
  ).catch(() => null);
  const { ok, rows, error } = readRows(found);
  if (!ok) return { ok: false, error: error || "connect_threads_read_failed", entries: [] };
  const entries = [];
  for (const row of rows) {
    const described = describeThread(row, window, siteUrl);
    if (described) entries.push(described);
  }
  return { ok: true, count: rows.length, entries };
}

// ---------------------------------------------------------------------------
// Source 4: prospect-joined events (reveal opens, assistant replies, dispatches)
// ---------------------------------------------------------------------------

async function resolveProspect({ slug, select, siteUrl }) {
  const bySlug = await select(
    "ghost_agency_prospects",
    `select=prospect_id,site_slug,status,preview_url,business_name,updated_at`
      + `&site_slug=eq.${encodeURIComponent(slug)}&order=updated_at.desc&limit=1`,
  ).catch(() => null);
  const slugRead = readRows(bySlug);
  if (slugRead.ok && slugRead.rows[0]) return { ok: true, row: slugRead.rows[0] };
  const byUrl = await select(
    "ghost_agency_prospects",
    `select=prospect_id,site_slug,status,preview_url,business_name,updated_at`
      + `&preview_url=eq.${encodeURIComponent(siteUrl)}&order=updated_at.desc&limit=1`,
  ).catch(() => null);
  const urlRead = readRows(byUrl);
  if (urlRead.ok && urlRead.rows[0]) return { ok: true, row: urlRead.rows[0] };
  if (!slugRead.ok && !urlRead.ok) return { ok: false, row: null, error: slugRead.error || urlRead.error };
  return { ok: true, row: null };
}

/**
 * describeEvent — event types this module recognises, and ONLY those. Edit-job
 * event types (ghost_agency_site_edit_*) are skipped by name: the edit-jobs
 * TABLE is the authoritative record of those and already reported above —
 * describing both would double-count the same change.
 */
function describeEvent(event, window, siteUrl) {
  const type = String(event?.type || "");
  const payload = plain(event?.payload) || {};
  const atMs = parseWhen(payload.at || event?.created_at);
  if (!within(atMs, window)) return null;
  const ref = { table: "ghost_agency_events", id: event?.id ?? null, type };

  if (type === "preview.reveal_opened" || type === "preview.clicked") {
    return entry({
      atMs,
      kind: "preview_opened",
      what: "Your site preview link was opened.",
      proof: siteUrl,
      source: ref,
    });
  }
  if (type === "connect_ai_reply_sent") {
    const captured = payload.leadCaptured === true;
    return entry({
      atMs,
      kind: "assistant_replied",
      what: captured
        ? "Our assistant answered a visitor in your website chat and captured their contact details."
        : "Our assistant answered a visitor in your website chat.",
      proof: siteUrl,
      source: ref,
    });
  }
  if (type === "system.run") {
    const stage = String(payload.stage || "");
    if (stage === "built") {
      if (payload.status === "started") {
        return entry({
          atMs,
          kind: "rebuild_started",
          what: "A rebuild of your site started.",
          proof: siteUrl,
          source: ref,
        });
      }
      if (payload.ready === true) {
        return entry({
          atMs,
          kind: "rebuild",
          what: "Your site was rebuilt and republished.",
          proof: siteUrl,
          source: ref,
        });
      }
      if (payload.blocked) {
        return entry({
          atMs,
          kind: "rebuild_held",
          what: "A site rebuild was attempted and stopped before publishing.",
          proof: siteUrl,
          source: ref,
          detail: String(payload.blocked),
        });
      }
      return null;
    }
    if (stage === "mirror_lane_refused") {
      return entry({
        atMs,
        kind: "rebuild_held",
        what: "A rebuild attempt was refused by our quality checks and did not publish.",
        proof: siteUrl,
        source: ref,
        detail: String(payload.reason || payload.detail || ""),
      });
    }
    return null;
  }
  return null; // every other event type: not this site's story, or not known
}

async function collectProspectEvents({ slug, prospectId, window, select, siteUrl }) {
  const sinceIso = new Date(window.sinceMs).toISOString();
  const clauses = [];
  if (prospectId) {
    clauses.push(`payload->>prospectId=eq.${encodeURIComponent(prospectId)}`);
    clauses.push(`payload->>prospect_id=eq.${encodeURIComponent(prospectId)}`);
  }
  clauses.push(`payload->>siteSlug=eq.${encodeURIComponent(slug)}`);

  const seen = new Set();
  const entries = [];
  let readFailures = 0;
  let count = 0;
  for (const clause of clauses) {
    const found = await select(
      "ghost_agency_events",
      `select=id,type,created_at,payload&${clause}`
        + `&created_at=gte.${encodeURIComponent(sinceIso)}`
        + `&order=created_at.desc&limit=${EVENT_LIMIT}`,
    ).catch(() => null);
    const { ok, rows } = readRows(found);
    if (!ok) { readFailures += 1; continue; }
    for (const event of rows) {
      const key = String(event?.id ?? `${event?.type}:${event?.created_at}`);
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
      const described = describeEvent(event, window, siteUrl);
      if (described) entries.push(described);
    }
  }
  // Partial reads are still incomplete reads: one failed clause means events
  // that belong in the list may be missing, and `complete` must say so.
  return { ok: readFailures === 0, error: readFailures ? "events_read_partial" : undefined, count, entries };
}

// ---------------------------------------------------------------------------
// The assembled log
// ---------------------------------------------------------------------------

/**
 * siteChangeLog({ siteSlug, since, until, windowMs, now, select })
 *   -> {
 *        ok, siteSlug, siteUrl,
 *        window: { since, until },
 *        entries: [{ at, kind, what, proof, source, detail? }], // ascending
 *        sources: { edit_jobs, line_batches, connect_threads, prospect, events },
 *        complete,        // true only when EVERY source read cleanly
 *      }
 *
 * `entries` empty + `complete` true  -> genuinely nothing changed; send nothing.
 * `entries` empty + `complete` false -> unknown; the caller must not claim
 * "no changes" either, because a source could not be read.
 */
async function siteChangeLog(options = {}) {
  const slug = normalizeSlug(options.siteSlug || options.slug);
  if (!slug) return { ok: false, reason: "site_slug_invalid", entries: [] };
  const window = windowOf(options, parseWhen(options.now) || Date.now());
  if (!window.ok) return { ok: false, reason: window.reason, entries: [] };
  const select = typeof options.select === "function" ? options.select : defaultSelect;
  const siteUrl = siteUrlFor(slug);

  const [editJobs, batches, threads, prospect] = await Promise.all([
    collectEditJobs({ slug, window, select, siteUrl }),
    collectBatchActivity({ slug, window, select, siteUrl }),
    collectThreads({ slug, window, select, siteUrl }),
    resolveProspect({ slug, select, siteUrl }),
  ]);

  const events = await collectProspectEvents({
    slug,
    prospectId: prospect.ok && prospect.row ? String(prospect.row.prospect_id || "") : "",
    window,
    select,
    siteUrl,
  });

  const entries = [
    ...editJobs.entries,
    ...batches.entries,
    ...threads.entries,
    ...events.entries,
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const sources = {
    edit_jobs: editJobs.ok ? { ok: true, rows: editJobs.count } : { ok: false, error: editJobs.error },
    line_batches: batches.ok
      ? { ok: true, snapshots: batches.snapshots, batches: batches.batches }
      : { ok: false, error: batches.error },
    connect_threads: threads.ok ? { ok: true, rows: threads.count } : { ok: false, error: threads.error },
    prospect: prospect.ok
      ? { ok: true, found: Boolean(prospect.row), prospect_id: prospect.row ? String(prospect.row.prospect_id || "") : "" }
      : { ok: false, error: prospect.error },
    events: events.ok ? { ok: true, rows: events.count } : { ok: false, error: events.error },
  };

  return {
    ok: true,
    siteSlug: slug,
    siteUrl,
    window: {
      since: new Date(window.sinceMs).toISOString(),
      until: new Date(window.untilMs).toISOString(),
    },
    entries,
    sources,
    complete: Object.values(sources).every((source) => source.ok === true),
  };
}

module.exports = {
  siteChangeLog,
  // exported for tests — each one is part of the truth surface
  describeEditRow,
  describeHistoryStatus,
  describeThread,
  describeEvent,
  slugOfPreviewUrl,
  windowOf,
  siteUrlFor,
};
