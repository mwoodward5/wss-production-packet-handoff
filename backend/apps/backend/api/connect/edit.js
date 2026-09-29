"use strict";

// POST /api/connect/edit — the chat door into the site edit engine.
//
// TWO DOORS, ONE BRAIN. Riley's phone tool (api/vapi-tools/site-edit.js) and
// this endpoint resolve the same target, mint and check the same confirmation
// (lib/edit-confirm.js), write the same ghost_agency_edit_jobs row and call the
// same executeEditJob. Nothing about the edit path is reimplemented here — a
// second implementation of "change a customer's live website" would drift, and
// the copy that drifts is the one nobody is watching. What this file adds is
// the two things a phone call cannot do: it takes FILES, and it leaves a
// written record the customer can read later.
//
// WHAT IS DIFFERENT FROM THE PHONE, AND WHY.
//
//   IDENTITY. Riley has to work out who is calling from a spoken business name
//   or a caller ID, which is why that endpoint carries a whole collision-safety
//   apparatus. Here the caller has already logged in and the site slug comes
//   off their own signed token — never off the request body. There is nothing
//   to guess, so nothing guesses.
//
//   CONFIRMATION. Riley reads a six-character code down the phone because a
//   voice model cannot carry 200 base64 characters (the incident is recorded in
//   lib/edit-confirm.js). A browser can, so the chat uses the long signed token
//   and the customer confirms by TAPPING a button under a sentence naming their
//   own business and domain. Strictly better: nothing is read aloud, nothing is
//   retyped, and the thing they approve is on screen while they approve it.
//
//   ATTACHMENTS. A photo the customer uploaded arrives as a link under their
//   own site's upload prefix and is re-checked here (isOwnUploadUrl) before it
//   is composed into the instruction. The composed string is what both phases
//   hash, so the files cannot change between the read-back and the tap.

const { resolveConnectScope } = require("../../lib/connect");
const { readJson } = require("../../lib/http");
const { insertRow, recordEvent, select, upsertRow } = require("../../lib/store");
const { describeSiteEditTarget } = require("../../lib/site-edit-targets");
const { executeEditJob } = require("../../lib/edit-job-runner");
const { mintConfirmToken, verifyEditConfirmation } = require("../../lib/edit-confirm");
const { composeEditInstruction, isOwnUploadUrl, MAX_ATTACHMENTS } = require("../../lib/customer-uploads");
const { describeEditJob, openEditFor, FALLBACK } = require("../../lib/customer-edits");
const { maybeSweepDeadEditJobs } = require("../../lib/edit-job-sweeper");
const { assessEditRequest } = require("../../lib/edit-clarify");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

/** What one customer may type in one turn. Long enough for a real request. */
const MAX_MESSAGE_CHARS = 1200;

/**
 * How long we hold the response open waiting for the change to land.
 *
 * Riley's budget is 12s because Vapi kills a tool webhook at 20s. A browser has
 * no such deadline, and the panel polls /api/connect/edits regardless — so this
 * is chosen for the person watching, not the platform: long enough that a
 * simple change (measured ~10.5s: plan, apply, deploy) is already done when the
 * answer arrives, short enough that nobody sits on a dead-looking spinner. Past
 * it the job keeps running, the two-minute sweeper finishes anything that
 * outlives this lambda, and the panel's polling shows the outcome.
 */
const RUN_BUDGET_MS = 22_000;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = ["https://connect.wss-labs.com", "https://wss-ai.com", "https://www.wss-ai.com"];
  res.setHeader("Access-Control-Allow-Origin", allowed.includes(origin) ? origin : "https://wss-ai.com");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

/**
 * The attachments this request is allowed to use.
 *
 * Only links we issued, for THIS site, deduplicated, capped. Anything else is
 * dropped and REPORTED rather than silently ignored: a customer whose photo
 * quietly vanished between the upload and the change would be told the edit
 * succeeded and then find the old picture still there.
 */
function acceptAttachments(list, siteSlug) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const url = String((item && item.url) || "").trim();
    if (!isOwnUploadUrl({ url, siteSlug })) { rejected.push(url.slice(0, 120)); continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    accepted.push({
      url,
      name: String((item && item.name) || ""),
      kind: (item && item.kind) === "document" ? "document" : "photo",
    });
    if (accepted.length >= MAX_ATTACHMENTS) break;
  }
  return { accepted, rejected };
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" });

  const scope = resolveConnectScope(req);
  if (!scope) return send(res, 401, { ok: false, error: "unauthorized" });

  // The slug comes off the token. A full/admin token carries no business, so it
  // must name one; with none it is refused rather than defaulted to somebody's.
  const asked = String((req.query && req.query.slug) || "").trim().toLowerCase();
  const siteSlug = scope.mode === "tenant"
    ? String(scope.siteSlug || "")
    : (SLUG_RE.test(asked) ? asked : "");
  if (!SLUG_RE.test(siteSlug)) {
    return send(res, 400, {
      ok: false,
      status: "no_site",
      say: "This login isn't linked to a website yet, so there's nothing for us to change.",
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { ok: false, status: "bad_request", say: "That didn't arrive in one piece. Send it again." });
  }

  const message = String(body.message || body.instruction || "").trim().slice(0, MAX_MESSAGE_CHARS);
  const { accepted, rejected } = acceptAttachments(body.attachments, siteSlug);
  if (!message && !accepted.length) {
    return send(res, 400, { ok: false, status: "empty", say: "Tell us what to change and we'll get on it." });
  }
  if (rejected.length) {
    await recordEvent("ghost_agency_customer_edit_attachment_rejected", { siteSlug, rejected }).catch(() => {});
    return send(res, 400, {
      ok: false,
      status: "attachment_not_ours",
      say: "One of those files isn't one you uploaded here, so we've left it out. Attach it again and we'll take it.",
    });
  }
  if (!message && accepted.length) {
    // A file with no words is not a request. Asking is the honest move: we do
    // not get to decide what a customer wanted done with a photograph.
    return send(res, 400, {
      ok: false,
      status: "needs_words",
      say: "Got the file. Tell us what to do with it and we'll get on it.",
    });
  }

  // WHOSE SITE IS THIS? Named out loud before anything is touched, from what
  // the SERVER resolved. describeSiteEditTarget returns null when it cannot
  // establish whose site a slug is, or when two rows claim it — and an
  // unidentifiable site is never edited on an unconfirmed request.
  let described = null;
  try {
    described = await describeSiteEditTarget(siteSlug);
  } catch {
    described = null;
  }
  if (!described) {
    return send(res, 409, {
      ok: false,
      status: "unidentifiable_site",
      say: "We can see your site, but we can't confirm which business it belongs to right now — so we're not going to change it. Call Riley and we'll sort it out.",
    });
  }

  const instruction = composeEditInstruction({ message, attachments: accepted });
  const facts = {
    siteSlug: described.site_slug,
    businessName: described.business_name,
    domain: described.domain,
    instruction,
  };
  const confirmToken = String(body.confirm_token || body.confirmToken || "").trim();
  const confirmCode = String(body.confirm_code || body.confirmCode || "").trim();

  // ---- PHASE 0: should Riley ASK before it acts? ---------------------------
  // Before the read-back, decide whether this request can be actioned as-is or
  // needs one warm clarifying question first — a team page with no people to put
  // on it, a photo swap with no photo, an ambiguous target. This is the
  // Lovable-style behaviour: ask, with options, instead of queuing a doomed edit
  // that reports "didn't go through". FAIL-OPEN: any assessment error falls
  // straight through to the normal confirm flow, so it can never block an edit.
  // Only on the first turn (no confirm token); once the owner has answered and
  // tapped Apply, the request rides through unchanged. Feature-flagged
  // (GHOST_AGENCY_EDIT_CLARIFY=1) so it is OFF in tests and local — where the
  // model key is present and would fire a real, non-deterministic call on every
  // edit-driving test — and turned on in production once ready.
  if (!confirmToken && !confirmCode && process.env.GHOST_AGENCY_EDIT_CLARIFY === "1") {
    let clarify = { needsInput: false };
    try {
      clarify = await assessEditRequest({
        message,
        businessName: described.business_name,
        hasAttachments: accepted.length > 0,
      });
    } catch { clarify = { needsInput: false }; }
    if (clarify && clarify.needsInput && clarify.say) {
      await recordEvent("ghost_agency_site_edit_clarify", {
        siteSlug: described.site_slug,
        via: "dashboard_chat",
      }).catch(() => {});
      return send(res, 200, {
        ok: true,
        status: "needs_input",
        applied: false,
        queued: false,
        say: clarify.say,
      });
    }
  }

  // ---- PHASE 1: read it back, change nothing --------------------------------
  if (!confirmToken && !confirmCode) {
    return send(res, 200, {
      ok: true,
      status: "confirm_required",
      applied: false,
      queued: false,
      confirm: {
        business_name: described.business_name,
        domain: described.domain,
        site_slug: described.site_slug,
        client_id: described.client_id || null,
      },
      message,
      attachments: accepted,
      confirm_token: mintConfirmToken(facts),
      say: `We'll make this change to ${described.business_name} at ${described.domain}. Apply it?`,
    });
  }

  // ---- PHASE 2: the customer tapped Apply ----------------------------------
  const verified = verifyEditConfirmation({ confirmToken, confirmCode, facts });
  if (!verified.ok) {
    await recordEvent("ghost_agency_site_edit_confirm_rejected", {
      siteSlug: described.site_slug,
      reason: verified.reason,
      via: "dashboard_chat",
    }).catch(() => {});
    // A stale or mismatched confirmation is not an error the customer caused
    // and not one they can fix by understanding it. Hand back a fresh read-back
    // for the request in front of us — the same shape phase 1 returns — so the
    // panel can ask once more instead of dead-ending.
    return send(res, 409, {
      ok: false,
      status: "confirm_required",
      reason: verified.reason,
      applied: false,
      queued: false,
      confirm: {
        business_name: described.business_name,
        domain: described.domain,
        site_slug: described.site_slug,
        client_id: described.client_id || null,
      },
      message,
      attachments: accepted,
      confirm_token: mintConfirmToken(facts),
      say: `Let's confirm that once more — this change goes to ${described.business_name} at ${described.domain}. Apply it?`,
    });
  }

  // Close anything already dead before deciding whether this site is busy. The
  // cron that was supposed to do this has been switched off at the Vercel
  // project since 2026-07-29 (see lib/edit-job-sweeper.js), so the sweep rides
  // on real traffic instead. Throttled per instance; it never starts work.
  await maybeSweepDeadEditJobs({ select, upsertRow, recordEvent }).catch(() => null);

  // ONE CHANGE AT A TIME. Two edits racing through the same read/patch/deploy
  // cycle overwrite each other, and the customer is told both landed.
  const inFlight = await openEditFor({ siteSlug: described.site_slug, select }).catch(() => null);
  if (inFlight) {
    return send(res, 409, {
      ok: false,
      status: "busy",
      say: "Your last change is still going through. Give it a moment and send this one right after.",
      pending: inFlight,
    });
  }

  const jobId = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const written = await insertRow("ghost_agency_edit_jobs", {
    job_id: jobId,
    site_slug: described.site_slug,
    instruction,
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
  }).catch((error) => ({ mode: "insert_threw", error: String((error && error.message) || error) }));

  // A REQUEST THAT WAS NEVER STORED MUST NOT BE REPORTED AS UNDERWAY. If the
  // row did not land there is nothing for executeEditJob to find, nothing for
  // the sweeper to pick up, and nothing for the panel to poll — it would sit on
  // "working on it" forever. That is the silent-failure shape this whole panel
  // exists to stop, so it is answered as a failure the moment we know.
  if (!written || written.mode !== "live_write") {
    await recordEvent("ghost_agency_customer_edit_not_stored", {
      siteSlug: described.site_slug,
      jobId,
      mode: (written && written.mode) || "unknown",
    }).catch(() => {});
    return send(res, 503, {
      ok: false,
      status: "not_stored",
      applied: false,
      queued: false,
      say: "We couldn't record that request just now, so nothing has been started and nothing on your site has changed. Try again in a moment, or call Riley.",
    });
  }

  await recordEvent("ghost_agency_site_edit_queued", {
    jobId,
    siteSlug: described.site_slug,
    instruction,
    via: "dashboard_chat",
    attachments: accepted.length,
    matched_by: "dashboard_login",
    confirmed: true,
    confirmed_business_name: described.business_name,
    confirmed_domain: described.domain,
    confirmed_via: described.source,
  }).catch(() => {});

  // Run it now, awaited, exactly as the phone path does — a serverless instance
  // freezes the moment res.end runs, so a detached kick dies with the lambda.
  let ran = null;
  try {
    ran = await Promise.race([
      executeEditJob(jobId).catch((e) => ({ ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 200) })),
      new Promise((resolve) => setTimeout(() => resolve({ status: "still_running" }), RUN_BUDGET_MS)),
    ]);
  } catch (e) {
    ran = { ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 200) };
  }

  // executeEditJob answers a terminal state as a word (done | refused | failed)
  // and a machinery problem as an HTTP-ish number with ok:false. A number is
  // still an ANSWER — treating it as "not settled yet" would leave the panel
  // polling a job that will never move.
  //
  // NOT-FAILED OK:FALSE STATUSES. A deferral (the per-site lease was held by
  // the site's previous edit, or the stale-base guard requeued the job) and a
  // lost claim race leave the row QUEUED for the next pass — the panel must
  // keep showing "working", because that is the truth. Calling a job that is
  // merely WAITING "failed" would be its own false report.
  const raw = (ran && ran.status) || "queued";
  const unsettled = ["deferred_site_busy", "deferred_stale_base", "in_flight", "claim_unavailable"].includes(String(raw));
  const status = typeof raw === "number" || (ran && ran.ok === false && raw !== "failed" && !unsettled) ? "failed" : String(raw);
  const settled = status === "done" || status === "refused" || status === "failed";
  const edit = describeEditJob({
    job_id: jobId,
    site_slug: described.site_slug,
    instruction,
    status: settled ? status : "running",
    result: (ran && ran.result) || null,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
  });

  return send(res, 200, {
    ok: true,
    status: settled ? status : "applying",
    applied: status === "done",
    queued: !settled,
    jobId,
    confirmed: {
      business_name: described.business_name,
      domain: described.domain,
      site_slug: described.site_slug,
    },
    edit,
    // The one sentence the panel prints. On the slow path it is not a claim
    // that anything landed — the request IS still running, and the panel keeps
    // polling until it settles.
    say: settled ? edit.say : FALLBACK.running,
  });
};
