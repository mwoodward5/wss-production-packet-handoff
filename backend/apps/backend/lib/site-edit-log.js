"use strict";

// lib/site-edit-log.js — THE ORDERED, DURABLE LIST OF EVERY CHANGE A CUSTOMER
// HAS MADE TO THEIR OWN SITE, in the form a rebuild can replay.
//
// =====================================================================
// WHY THIS FILE EXISTS (the measured failure it closes)
// =====================================================================
// Two paths write a customer's site and until now they did not know about
// each other:
//
//   EDITS   lib/site-change-plan.js runSiteChange() reads the archived file
//           tree out of wss-site-sources/<slug>/, applies a plan to it,
//           uploads the changed files back, and redeploys. The change lives
//           in those bytes and nowhere else.
//
//   REBUILD lib/mirror-engine/engine.js mirror() composes a fresh tree from
//           donor + facts + content, deploys it, and then calls
//           archiveSiteSource() — which upserts over the SAME bucket prefix.
//
// So a rebuild overwrites the edited bytes on the live site AND in the
// archive, and nothing anywhere consults the edit history. Every rebuild
// silently undoes every edit the customer ever made.
//
// MEASURED, NOT REASONED (2026-08-11):
//   wss-test-rimrock-plumbing-billings — ten edit jobs reached `done` on
//   08-07 between 05:56 and 14:06, including "add my google analytics, the id
//   is G-4Q7RSTVWX2" (installed on 4 pages) and a generated privacy page.
//   Every archived file carries updated_at 2026-08-07T23:53:19-20Z — one
//   rebuild, one burst. Today the live page contains zero `wss-edit`
//   markers, zero occurrences of G-4Q7RSTVWX2, and https://wss-test-rimrock-
//   plumbing-billings.wss-ai.com/privacy answers 404. The archive's
//   index.html carries no marker either: the edits are gone at the source.
//
//   wss-test-air-creation-heating-and-cooling-llc-baton — the owner's own
//   call. Every archived file stamped 2026-08-11T09:35:03-05Z, 2.3 seconds
//   apart: this morning's rebuild rewrote the whole tree. No markers survive.
//
// =====================================================================
// WHERE THE LOG LIVES, AND WHY IT IS NOT A NEW TABLE
// =====================================================================
// `ghost_agency_edit_jobs` already is this list. One row per change, per
// site_slug, ordered by created_at, written by the ONE code path that applies
// edits (every caller — Riley's phone tool, the dashboard, the connect chat,
// the admin runner — funnels through executeEditJob -> runSiteChange). A
// second table would need DDL nobody has run yet, would be written from the
// same place, and could disagree with the row that is already the record of
// record. So the log is the jobs table, and what was missing from it was not
// a place to put the edits: it was the REPLAYABLE FORM of each one.
//
// `result.ops` recorded that a style_override happened, which selectors it
// used and how many bytes it was — everything except the bytes themselves.
// You cannot replay `{op:"style_override", bytes:40}`. runSiteChange now also
// records `result.replay`: for each applied op, exactly the input the
// deterministic apply function needs to perform it again. That is the whole
// contract between the two halves of this fix.
//
// =====================================================================
// WHAT AN ENTRY MEANS, AND WHAT IT DELIBERATELY DOES NOT
// =====================================================================
// An entry is a RECORD, in the same sense lib/site-change-log.js uses the
// word: it is derived from one row that exists, carries that row's own
// timestamp and job id, and describes only what that row recorded. There is
// no default branch that invents an op, and a row whose shape this module
// does not recognise contributes nothing.
//
// THREE OUTCOMES, ALL NAMED. Reading the log answers with:
//   entries  — replayable ops, oldest first, undo already applied.
//   legacy   — jobs that landed a change BEFORE `result.replay` existed.
//              Nothing about them can be replayed; the honest report is that
//              they are unrecoverable, never that the site has no edits.
//   ok/complete — false when the read itself failed. A failed read is NOT an
//              empty log (lib/customer-edits.js paid for that lesson): the
//              caller must be able to tell "this customer made no changes"
//              apart from "we could not find out", because the second one
//              must never be allowed to authorise a rebuild.
//
// UNDO IS PART OF THE LOG, NOT AN EXCEPTION TO IT. "Put it back the way it
// was" is itself a done job, and applyUndo records `restoredFrom` — the job
// whose snapshot it restored. Replaying an edit the customer explicitly took
// back would be its own catastrophe, so an undo REVOKES the entries of the
// job it names. Revoked entries stay in the list, marked, because "this was
// undone" is a fact worth being able to show.

const { select: defaultSelect } = require("./store");

/** Read cap: an owner-facing site's whole edit history, not an export. */
const JOB_LIMIT = 500;

/** Ops runSiteChange knows how to record a replayable form for. Anything not
 *  in this set is not replayable and says so rather than being guessed at. */
const REPLAYABLE_OPS = Object.freeze(new Set([
  "style_override",
  "insert_html",
  "replace_text",
  "replace_copy",
  "tracking_tag",
  "restore_files",
  "swap_image",
  "legal_page",
  "reorder_section",
  "set_hero_video",
]));

function normalizeSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(slug) ? slug : "";
}

function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** Same discipline as lib/site-change-log.readRows: a failed read is NOT []. */
function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  const mode = result && result.mode;
  if (mode && mode !== "live_select") {
    return { ok: false, rows: [], error: String(result?.error?.code || result?.error?.category || mode) };
  }
  if (Array.isArray(result && result.data)) return { ok: true, rows: result.data };
  if (Array.isArray(result && result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [], error: "unreadable_select_result" };
}

/**
 * validateReplayOp(op) -> { ok, reason }
 *
 * A recorded op is only replayable if it carries every field its apply
 * function reads. A half-recorded op is reported as unreplayable rather than
 * attempted with a missing argument — a replay that "mostly" applies is the
 * silent-wrong-edit this system exists to prevent.
 */
function validateReplayOp(op) {
  const kind = String((op && op.op) || "").trim();
  if (!kind) return { ok: false, reason: "op_missing" };
  if (!REPLAYABLE_OPS.has(kind)) return { ok: false, reason: `op_not_replayable:${kind}` };
  const has = (k) => typeof op[k] === "string" && op[k].length > 0;
  if (kind === "style_override") {
    if (!has("file")) return { ok: false, reason: "style_override_missing_file" };
    if (!has("css")) return { ok: false, reason: "style_override_missing_css" };
  } else if (kind === "insert_html") {
    if (!has("file")) return { ok: false, reason: "insert_html_missing_file" };
    if (!has("anchorExact")) return { ok: false, reason: "insert_html_missing_anchor" };
    if (!has("fragment")) return { ok: false, reason: "insert_html_missing_fragment" };
  } else if (kind === "replace_text") {
    if (!has("file")) return { ok: false, reason: "replace_text_missing_file" };
    if (!has("find")) return { ok: false, reason: "replace_text_missing_find" };
    if (typeof op.replace !== "string") return { ok: false, reason: "replace_text_missing_replace" };
  } else if (kind === "replace_copy") {
    if (!has("literal")) return { ok: false, reason: "replace_copy_missing_literal" };
    if (!has("replacement")) return { ok: false, reason: "replace_copy_missing_replacement" };
  } else if (kind === "tracking_tag") {
    if (!has("vendor")) return { ok: false, reason: "tracking_tag_missing_vendor" };
    if (!has("id")) return { ok: false, reason: "tracking_tag_missing_id" };
  } else if (kind === "restore_files") {
    const files = Array.isArray(op.files) ? op.files.filter((f) => typeof f === "string" && f) : [];
    if (!files.length) return { ok: false, reason: "restore_files_missing_files" };
  } else if (kind === "swap_image") {
    if (!has("from")) return { ok: false, reason: "swap_image_missing_from" };
    if (!has("to")) return { ok: false, reason: "swap_image_missing_to" };
  } else if (kind === "set_hero_video") {
    // The ladder swap's identity is the rung it retired and the clip it put
    // there. `from` may be EMPTY (a ladder with no playable rung — the replay
    // prepends), which is why it alone is not required to be a non-empty
    // string; the destination and the verified clip digest must always be.
    if (!has("to")) return { ok: false, reason: "set_hero_video_missing_to" };
    if (!has("file")) return { ok: false, reason: "set_hero_video_missing_file" };
    if (!has("sha256")) return { ok: false, reason: "set_hero_video_missing_sha256" };
    if (op.from != null && typeof op.from !== "string") return { ok: false, reason: "set_hero_video_from_invalid" };
  } else if (kind === "legal_page") {
    if (!has("file")) return { ok: false, reason: "legal_page_missing_file" };
    if (!has("route")) return { ok: false, reason: "legal_page_missing_route" };
  } else if (kind === "reorder_section") {
    if (!has("file")) return { ok: false, reason: "reorder_section_missing_file" };
    if (!has("headingExact")) return { ok: false, reason: "reorder_section_missing_heading" };
    if (!has("position")) return { ok: false, reason: "reorder_section_missing_position" };
    // A before/after move also needs its landmark; a top/bottom move has none.
    if ((op.position === "before" || op.position === "after") && !has("referenceExact")) {
      return { ok: false, reason: "reorder_section_missing_reference" };
    }
  }
  return { ok: true, reason: "" };
}

function parseWhen(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * buildLog(rows) -> { entries, legacy, revoked }
 *
 * Pure. `rows` are edit-job rows in ANY order; this sorts them oldest-first by
 * their own created_at (job_id as the tiebreak, so the order is total and the
 * same on every read) and walks them once.
 */
function buildLog(rows) {
  const jobs = [...rows]
    .filter((row) => plain(row))
    .sort((a, b) => {
      const at = parseWhen(a.created_at) || 0;
      const bt = parseWhen(b.created_at) || 0;
      if (at !== bt) return at - bt;
      return String(a.job_id || "") < String(b.job_id || "") ? -1 : 1;
    });

  const entries = [];
  const legacy = [];
  const revoked = [];

  for (const row of jobs) {
    if (String(row.status || "").toLowerCase() !== "done") continue;
    const result = plain(row.result) || {};
    const jobId = String(row.job_id || "");
    const at = String(row.updated_at || row.created_at || "");
    const instruction = String(row.instruction || "");

    // AN UNDO IS A CHANGE TOO — it takes one back. Revoke the entries of the
    // job it restored, so a rebuild cannot re-apply something the customer
    // asked us to remove.
    if (String(result.via || "") === "undo") {
      const target = String(result.restoredFrom || "");
      let hit = 0;
      for (const entry of entries) {
        if (entry.jobId === target && !entry.revoked) {
          entry.revoked = true;
          entry.revokedBy = jobId;
          hit += 1;
        }
      }
      revoked.push({ jobId, restoredFrom: target, entriesRevoked: hit, at });
      continue;
    }

    const replay = Array.isArray(result.replay) ? result.replay : null;
    if (!replay) {
      // A job that changed files but recorded no replayable form. This is
      // every edit made before this file existed. It is UNRECOVERABLE, and
      // that is the honest word for it — not "no edits".
      const changed = Array.isArray(result.changedFiles) ? result.changedFiles : [];
      const created = Array.isArray(result.createdFiles) ? result.createdFiles : [];
      if (changed.length || created.length) {
        legacy.push({
          jobId,
          at,
          instruction,
          changedFiles: changed,
          createdFiles: created,
          reason: "no_replay_payload_recorded",
        });
      }
      continue;
    }

    replay.forEach((op, index) => {
      const check = validateReplayOp(op);
      entries.push({
        jobId,
        at,
        instruction,
        seq: `${jobId}#${index}`,
        op: plain(op) || { op: String((op && op.op) || "") },
        replayable: check.ok,
        reason: check.reason,
        revoked: false,
      });
    });
  }

  return { entries, legacy, revoked };
}

/**
 * siteEditLog({ siteSlug, select }) ->
 *   {
 *     ok,                // the read succeeded
 *     siteSlug,
 *     entries: [ { jobId, at, instruction, seq, op, replayable, reason, revoked } ],
 *     active:  [ … ],    // entries that are replayable and not revoked, in order
 *     legacy:  [ … ],    // landed edits with no replayable record — unrecoverable
 *     revoked: [ … ],    // the undo jobs and what each took back
 *     fingerprint,       // stable digest of `active`; folds into the build hash
 *     complete,          // false when a read failed; NEVER treat as "no edits"
 *   }
 */
async function siteEditLog({ siteSlug, select = defaultSelect } = {}) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return { ok: false, reason: "site_slug_invalid", entries: [], active: [], legacy: [], revoked: [], complete: false, fingerprint: "" };

  const found = await select(
    "ghost_agency_edit_jobs",
    `select=job_id,site_slug,instruction,status,result,created_at,updated_at`
      + `&site_slug=eq.${encodeURIComponent(slug)}`
      + `&order=created_at.asc&limit=${JOB_LIMIT}`,
  ).catch((error) => ({ mode: "read_threw", error: { code: String((error && error.message) || error).slice(0, 120) } }));

  // NO STORE IS NOT AN EMPTY LOG, AND IT IS NOT A FAILED READ EITHER. Without
  // Supabase there is no edit-jobs table to have made an edit into, so "this
  // site has no recorded edits" is true — but the caller is told WHICH of the
  // three it is, so a production instance running with a broken env var shows
  // up as `configured:false` in the manifest instead of as a clean bill.
  if (found && found.skipped === "supabase_not_configured") {
    return {
      ok: true,
      configured: false,
      siteSlug: slug,
      rows: 0,
      entries: [],
      active: [],
      legacy: [],
      revoked: [],
      fingerprint: "",
      complete: true,
    };
  }

  const { ok, rows, error } = readRows(found);
  if (!ok) {
    return {
      ok: false,
      siteSlug: slug,
      reason: error || "edit_jobs_read_failed",
      entries: [],
      active: [],
      legacy: [],
      revoked: [],
      fingerprint: "",
      complete: false,
    };
  }

  const { entries, legacy, revoked } = buildLog(rows);
  const active = entries.filter((e) => e.replayable && !e.revoked);
  return {
    ok: true,
    configured: true,
    siteSlug: slug,
    rows: rows.length,
    entries,
    active,
    legacy,
    revoked,
    fingerprint: fingerprintOf(active),
    complete: true,
  };
}

/**
 * A stable digest of the edits a build is expected to carry. It participates in
 * the mirror's build_hash so that "same donor, same facts, one more edit" is a
 * DIFFERENT build rather than a memo hit that silently returns the pre-edit
 * manifest. Empty when there are no edits, which keeps every existing build
 * hash byte-identical.
 */
function fingerprintOf(active) {
  if (!Array.isArray(active) || !active.length) return "";
  const { createHash } = require("node:crypto");
  const h = createHash("sha256");
  for (const entry of active) {
    h.update(entry.seq);
    h.update("\0");
    h.update(JSON.stringify(entry.op));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 32);
}

module.exports = {
  siteEditLog,
  buildLog,
  fingerprintOf,
  validateReplayOp,
  REPLAYABLE_OPS,
};
