"use strict";

// lib/customer-edits.js — what the customer is shown about their own change.
//
// WHY THIS FILE EXISTS. The brief the chat panel was built against names the
// failure directly: "an edit that silently succeeds or silently fails is the
// exact failure mode this codebase keeps producing." A door into the edit
// engine is only half a feature; the other half is the customer being able to
// see, without asking anyone, that we heard them, that it is running, and what
// happened.
//
// Everything here reads ghost_agency_edit_jobs — the same rows Riley's calls
// create and the same rows the sweeper drains. There is no second store and no
// second transcript, so a change made by phone shows up in the chat and a
// change made in the chat shows up to the operator, both without any syncing.
//
// THE SENTENCES ARE THE PART TO GET RIGHT. Every one of them has to be true of
// a job in that state with nothing else known:
//   - a refusal reports the planner's own `say` when it wrote one, because that
//     sentence was composed for the customer and is more specific than anything
//     this module could invent;
//   - a failure says the site did not change, which is the guarantee
//     runSiteChange actually makes (it throws before deploying, and the runner
//     records the failure), and says the failure is logged, which recordEvent
//     makes true unconditionally;
//   - nothing here ever claims a human has looked at it, or will look at it by
//     a particular time, because this module cannot know either.

const { parseEditInstruction } = require("./customer-uploads");
// One definition of "this claim is dead", shared with the sweeper and the drain
// rather than copied. It used to be a local constant with a comment claiming it
// matched drainEditQueue — a comment is not a guarantee, and the three of them
// disagreeing is how a customer gets locked out of their own site.
const { STALE_RUNNING_MS } = require("./edit-job-sweeper");
// The progress meter. One implementation feeds this panel AND Riley's status
// tool, so the customer watching the web page and the customer on the phone
// are being read the same recorded trail — never two versions of "where it is".
const { describeEditProgress } = require("./edit-progress");

/** How many turns of the conversation the panel shows. */
const DEFAULT_LIMIT = 12;

const OPEN_STATES = new Set(["queued", "running"]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * readRows(result) -> { ok, rows }
 *
 * A FAILED READ IS NOT AN EMPTY LIST. lib/customer-site.js records what
 * collapsing those two costs: a select that 400s on a missing column returns no
 * rows, and a caller that only checks the shape tells the customer there is
 * nothing there. An empty transcript and an unreadable one are different
 * sentences.
 */
function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  const mode = result && result.mode;
  if (mode && mode !== "live_select") return { ok: false, rows: [] };
  if (Array.isArray(result && result.data)) return { ok: true, rows: result.data };
  if (Array.isArray(result && result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [] };
}

const FALLBACK = {
  queued: "We've got this. It starts in a moment.",
  // No duration here either — this line is the dashboard's half of the same
  // promise Riley used to make out loud, and it rests on the same nothing. Of
  // the 89 real edit jobs that ran past the in-request budget, 28 took longer
  // than a minute and 26 never finished at all. See the note above the
  // "applying" branch in api/vapi-tools/site-edit.js.
  running: "Working on it now. We'll show it here the moment it's live.",
  done: "That's live on your site. Give your page a refresh and you'll see it.",
  refused: "We couldn't make that change automatically, and we won't guess on your live site. Nothing has changed, and the request is logged for the team.",
  failed: "This one didn't go through. Nothing on your site changed, and the failure is logged for the team.",
};

/**
 * describeEditJob(row) -> the customer-facing shape of one request.
 *
 * `message` and `attachments` come back out of the stored instruction, so what
 * the customer sees is what they typed rather than the composed string the
 * planner reads (see composeEditInstruction).
 */
function describeEditJob(row) {
  const source = plainObject(row) || {};
  const status = String(source.status || "queued").toLowerCase();
  const result = plainObject(source.result) || {};
  const { message, attachments } = parseEditInstruction(source.instruction);
  const say = String(result.say || "").trim();

  return {
    jobId: String(source.job_id || ""),
    at: String(source.created_at || ""),
    updatedAt: String(source.updated_at || ""),
    message,
    attachments,
    status,
    open: OPEN_STATES.has(status),
    // On queued/running there is no result yet and nothing to prefer.
    // The planner's own sentence wins on the outcomes it writes one for, and so
    // does the sweeper's. FALLBACK.failed says "nothing on your site changed" —
    // true of a plan that threw before deploying, and a LIE about a job whose
    // worker died mid-deploy or whose deadline cut it off. Those endings carry
    // their own `say` precisely because that claim cannot be made for them.
    // A change that DEPLOYED and then failed its rendered check is not covered
    // by FALLBACK.failed either — "nothing on your site changed" is only true
    // once the rollback is confirmed, and that run writes its own sentence
    // saying which happened. If such a row ever arrives without one, say the
    // thing that is true of every ending rather than the thing that is true of
    // most of them.
    say: (status === "done" || status === "refused" || status === "failed") && say
      ? say
      : (result.not_landed
        ? "This one didn't go through, and we're not going to tell you where your site stands without checking it. The team has it."
        : (FALLBACK[status] || FALLBACK.queued)),
    changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles.length : 0,
  };
}

/**
 * listCustomerEdits({ siteSlug, select, limit }) -> { ok, edits }
 *
 * Newest first from the database; the panel reverses it so the conversation
 * reads downward like every other chat.
 */
async function listCustomerEdits({ siteSlug, select, limit = DEFAULT_LIMIT } = {}) {
  const slug = String(siteSlug || "").trim().toLowerCase();
  if (!slug || typeof select !== "function") return { ok: false, edits: [] };
  const cap = Math.max(1, Math.min(50, Number(limit) || DEFAULT_LIMIT));
  let found;
  try {
    found = await select(
      "ghost_agency_edit_jobs",
      `site_slug=eq.${encodeURIComponent(slug)}&order=created_at.desc&limit=${cap}`,
    );
  } catch {
    return { ok: false, edits: [] };
  }
  const { ok, rows } = readRows(found);
  if (!ok) return { ok: false, edits: [] };
  const edits = rows.map(describeEditJob);
  // The meter, attached from the same rows. Open jobs get the live reading —
  // stage, measured percent (or none, honestly), expected remainder — and
  // terminal jobs answer from the row alone. A meter that cannot be computed
  // must never take the transcript down with it: the panel without a bar is
  // still the truth, the panel erroring out is nothing.
  await Promise.all(rows.map(async (row, i) => {
    try {
      edits[i].meter = await describeEditProgress(row, { select });
    } catch { /* transcript first, meter second */ }
  }));
  return { ok: true, edits };
}

/**
 * openEditFor({ siteSlug, select }) -> the request still in flight, or null.
 *
 * ONE CHANGE AT A TIME, PER SITE. Two edits running against one site race each
 * other through the same archive-read/patch/deploy cycle, and the loser's work
 * is silently overwritten — the customer is told both landed and only one did.
 * A stale "running" claim is NOT in flight: it is a lambda that died, which the
 * sweeper will re-run, and treating it as live would lock a customer out of
 * their own site for as long as the row sat there.
 */
async function openEditFor({ siteSlug, select, now = Date.now() } = {}) {
  const { ok, edits } = await listCustomerEdits({ siteSlug, select, limit: 5 });
  if (!ok) return null;
  return edits.find((edit) => {
    if (!edit.open) return false;
    if (edit.status !== "running") return true;
    const at = Date.parse(edit.updatedAt || edit.at);
    return Number.isFinite(at) ? now - at < STALE_RUNNING_MS : true;
  }) || null;
}

module.exports = {
  DEFAULT_LIMIT,
  STALE_RUNNING_MS,
  FALLBACK,
  describeEditJob,
  listCustomerEdits,
  openEditFor,
};
