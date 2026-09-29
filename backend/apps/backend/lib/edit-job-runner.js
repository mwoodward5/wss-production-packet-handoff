"use strict";

// lib/edit-job-runner.js — EXECUTE a queued site-edit job.
//
// WHY THIS FILE EXISTS. Riley's phone flow queues a job and tells the caller
// "hold for a second" — and then NOTHING ran it. The only executor was
// api/admin/run-edit-job.js, an admin-gated HTTP endpoint with no cron behind
// it and no kick from the queueing path: a job sat "queued" for 40 minutes on a
// live test until someone would have POSTed to it by hand. The owner's bar is
// "can you refresh your page now?" — which needs the queue to DRAIN ITSELF.
//
// The execution logic moved here verbatim from that endpoint so three callers
// share one implementation instead of drifting:
//   1. api/admin/run-edit-job.js  — the operator's by-hand runner (unchanged
//      contract, still admin-gated),
//   2. api/cron/run-edit-jobs.js  — the sweeper that drains the queue,
//   3. the fire-and-forget kick in api/vapi-tools/site-edit.js right after a
//      confirmed job is queued, which is what makes the mid-call loop real.
//
// ── EVERY JOB REACHES AN ENDING ──────────────────────────────────────────────
//
// Measured 2026-08-08: two rows stamped "running" for 33 hours, one "queued"
// for 15 days, each one showing its customer "Working…" forever. Three separate
// holes put them there, and all three are closed in this file:
//
//   1. NO DEADLINE. runSiteChange was awaited bare. Nothing under it carries a
//      timeout either — the planner's two model calls, the archive read-back
//      loop, the per-file upload and the deploy poll are all untimed fetches.
//      One that never answers meant this function never reached its own
//      terminal write. Every long pole now runs under withDeadline.
//
//   2. RACE THE DEADLINE, DO NOT MERELY PASS A SIGNAL. lib/report-grade.js
//      records what an AbortController alone buys you: aborting is a REQUEST to
//      the transport, and a transport that ignores it leaves the await pending
//      anyway — the documented ceiling becomes the transport's promise rather
//      than ours. So withDeadline RACES. The ceiling is ours to enforce, not to
//      hope for.
//
//   3. A SILENT RETURN IS NOT AN ENDING. When resolveSiteEditTarget came back
//      null this returned {status:400} without writing anything, so the row
//      stayed "queued" for ever and — because drainEditQueue orders
//      created_at.asc — was re-selected first on every single pass, burning a
//      slot on a job that could never run. That is exactly what
//      manual-dq-build-sgi-energy had been doing since 2026-07-24. It now
//      writes a terminal row.
//
// The deadline is deliberately under vercel.json's maxDuration of 300s, so the
// terminal write happens INSIDE the invocation rather than racing the platform
// for it. What this cannot cover is the process simply being gone — the live
// callers answer at 12s/22s and a serverless instance can freeze there with the
// job unfinished. That case belongs to lib/edit-job-sweeper.js.

const { randomUUID } = require("node:crypto");
const {
  select: defaultSelect,
  upsertRow: defaultUpsert,
  insertRow: defaultInsertRow,
  recordEvent: defaultRecordEvent,
  conditionalUpdate: defaultConditionalUpdate,
} = require("./store");
const { classifyEditKind } = require("./seo-page-edit");
const { resolveSiteEditTarget: defaultResolveTarget } = require("./site-edit-targets");
const { runSiteChange: defaultRunSiteChange } = require("./site-change-plan");
const { MAX_ATTEMPTS, STALE_RUNNING_MS, ABANDONED_SAY, attemptsOf, classifyStuckJob } = require("./edit-job-sweeper");

// The completion follow-up, kept where it can honestly be kept. Lazy on
// purpose: the follow-up machinery is reached only by jobs that finish `done`
// AND carry a promise, and keeping it out of the module's cold start keeps the
// runner's dependency set exactly as wide as it was. See lib/riley-followups.js
// for the consent + recipient gates this hook inherits.
const defaultDeliverFollowUp = (options) => require("./riley-followups").deliverFollowUp(options);

/** The whole edit, end to end. Under maxDuration 300 with room left over for
 *  the terminal write, the event and the notification that follow it. */
const EDIT_DEADLINE_MS = 240_000;

/** Resolving the target can reach listAll + download + a promotion deploy
 *  (lib/site-edit-targets.js), so it is a long pole in its own right — just a
 *  much shorter one than the edit. */
const TARGET_DEADLINE_MS = 45_000;

/** Bookkeeping that must never outlive the work it describes. */
const WRITE_DEADLINE_MS = 20_000;
const NOTIFY_DEADLINE_MS = 15_000;

/** The sentence for a job that stopped because the stale-base guard measured
 *  another write landing between its archive read and its upload. Unlike the
 *  abandoned case, this one IS provable: the guard fires BEFORE a single byte
 *  is uploaded, so "nothing from this request went live" is a fact. */
const STALE_BASE_SAY =
  "Your site changed while this edit was being prepared, so we stopped rather than publish over it — nothing from this request went live. Send it again and we'll take it from the current version, or call Riley.";

/**
 * withDeadline(work, ms, label) — a ceiling this module enforces itself.
 *
 * Promise.race, not an AbortSignal handed to a callee that may or may not
 * honour it. See the note at the top of the file; report-grade.js paid for that
 * lesson today and this is the same shape.
 */
function withDeadline(work, ms, label) {
  const budget = Number.isFinite(ms) && ms > 0 ? ms : EDIT_DEADLINE_MS;
  let timer = null;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} did not finish within ${Math.round(budget / 1000)}s`), {
        code: "edit_deadline_exceeded",
        label,
        budgetMs: budget,
      }));
    }, budget);
  });
  return Promise.race([Promise.resolve().then(work), expiry]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** A tail call whose failure or slowness must not cost the caller an answer. */
function bounded(work, ms, label) {
  return withDeadline(work, ms, label).catch(() => null);
}

// ── THE PER-SITE LEASE — why a per-job claim is not enough ───────────────────
//
// MEASURED IN PRODUCTION, 2026-08-10→11 (Air Creation, call forensics): four
// edit jobs fired ~68s apart. Edit 1 (logo) and edit 2 (box height) were
// verifiably LIVE and seen by the caller. Then BOTH vanished between 22:39:11
// and 22:40:44, coinciding with edit 3's late-landing deploy — while edit 3's
// own change (hero text) never appeared. Caller, verbatim: "the hero verbiage
// has not been changed... And the logo appears to be back to the original
// size."
//
// The mechanism: runSiteChange reads the site's WHOLE archive, plans against
// it, and publishes the WHOLE site from what it read. The atomic per-JOB claim
// above stops two workers running the SAME job; it does nothing about two
// DIFFERENT jobs for the SAME site. Job N+1 fires 68 seconds after job N —
// against an apply+deploy window measured north of 60s — so N+1 reads an
// archive that predates N's write, and its full-site publish puts the older
// bytes back. Last-write-wins at full-site granularity: rapid successive edits
// CANNOT accumulate. Edit 3 published the pre-edit-1 site.
//
// The fix is a second, coarser claim — one lease per SITE, held from before
// the archive read until after the terminal write, so job N+1's read cannot
// begin until job N's deploy + rendered verification + terminal write are all
// done (read-after-write). The lease is a row in ghost_agency_edit_jobs itself
// — no migration, and every store primitive it needs already exists:
//
//   job_id    = "site_lock:<slug>"     the lease's identity
//   site_slug = "_site_lock"           NEVER a real slug, so the customer
//                                      transcript (listCustomerEdits filters
//                                      site_slug=eq.<slug>) cannot see it
//   status    = "lock"                 deliberately not queued/running/done, so
//                                      the drain's and the sweeper's selects
//                                      (which match only queued/running) never
//                                      pick a lease up as work
//   result    = { lock: <token>, held_by: <jobId>, ... }   the one-shot token
//
// SERVERLESS-SAFE: two lambdas racing for the lease resolve through one
// conditional PATCH, exactly like the job claim above — the guard admits a row
// that is not held (status≠lock), a RELEASED lease (result->>lock is null), or
// a DEAD holder's lease (updated_at older than the same STALE_RUNNING_MS the
// job claim uses; no live worker can exist behind it because vercel.json caps
// api/** at 300s and the edit deadline is 240s). And like the job claim, an
// empty representation is ambiguous (PostgREST re-applies the guard to the
// RETURNING set, and the status≠lock disjunct is falsified by the very
// transition it authorises), so the one-shot token read-back settles it.
const SITE_LOCK_PREFIX = "site_lock:";
/** The site_slug a lease row carries. An underscore can never be produced by
 *  SLUG_RE or resolveSiteEditTarget, so no customer-facing query can hit it. */
const SITE_LOCK_SLUG = "_site_lock";
const SITE_LOCK_INSTRUCTION = "per-site edit lease — not a job";

/** Named reason: another job for this site holds a live lease. */
const LOCK_REASON_HELD = "site_lock_held";
/** Named reason: the lease store could not be reached or the row never
 *  appeared. Fail-safe — the job waits rather than runs unlocked. */
const LOCK_REASON_UNAVAILABLE = "site_lock_unavailable";

function siteLockRowId(siteSlug) {
  return `${SITE_LOCK_PREFIX}${String(siteSlug || "").trim().toLowerCase()}`;
}

/**
 * acquireSiteLock({ siteSlug, jobId, select, insertRow, conditionalUpdate, now, staleMs })
 *   -> { ok: true, token } | { ok: false, reason, holder }
 *
 * One conditional PATCH decides the winner; the token read-back decides the
 * ambiguous case; a missing lease row is seeded with a plain INSERT (the
 * unique index on job_id makes concurrent seeds safe — the loser's insert
 * simply fails and the claim decides). A lease that cannot be proven acquired
 * is reported NOT acquired: the whole point of this lock is that work never
 * runs unlocked.
 */
async function acquireSiteLock({
  siteSlug,
  jobId,
  select,
  insertRow,
  conditionalUpdate,
  now = Date.now(),
  staleMs = STALE_RUNNING_MS,
}) {
  const lockId = siteLockRowId(siteSlug);
  const token = randomUUID();
  const at = new Date(now).toISOString();
  const staleBefore = new Date(now - staleMs).toISOString();
  // Claimable when: not held (status≠lock), OR released (the holder cleared the
  // token — fresh updated_at, so this disjunct is what makes an immediately
  // consecutive job able to take the lease without waiting out the TTL), OR
  // stale (the holder is dead). `result->>lock` passes through the store's
  // identifier filter untouched (it is recognised as a JSONB path).
  const guard = {
    or: `(and(status.neq.lock),and(status.eq.lock,updated_at.lt.${staleBefore}),and(status.eq.lock,result->>lock.is.null))`,
  };
  const patch = {
    status: "lock",
    result: { lock: token, held_by: jobId, site_slug: siteSlug, acquired_at: at },
    updated_at: at,
  };

  const attempt = async () => {
    const claim = await conditionalUpdate("ghost_agency_edit_jobs", "job_id", lockId, guard, patch);
    // An unconfigured store (dry runs, tests wired to plain fakes) offers no
    // atomicity, so it offers no lease — the same line the job claim draws
    // when it falls back to its legacy path.
    if (claim && claim.mode === "dry_run") return { dry_run: true };
    if (claim && claim.ok === true && claim.updated === true) return { won: true };
    // Ambiguous — the row is the truth. Read it back and look for OUR token.
    const found = await select("ghost_agency_edit_jobs", `job_id=eq.${encodeURIComponent(lockId)}&limit=1`);
    const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
    const rowLock = row && row.result && typeof row.result === "object" ? row.result.lock : null;
    if (row && rowLock === token) return { won: true };
    return { won: false, missing: !row, holder: (row && row.result && row.result.held_by) || null };
  };

  let outcome = await attempt();
  if (outcome.dry_run) return { ok: true, token: "dry_run", mode: "dry_run" };
  if (!outcome.won && outcome.missing) {
    // First lease for this site, ever. INSERT (not upsert — an upsert would
    // let a racing loser overwrite a LIVE holder's row, which is the one thing
    // this lock may never do). The unique index makes a double-seed harmless.
    await insertRow("ghost_agency_edit_jobs", {
      job_id: lockId,
      site_slug: SITE_LOCK_SLUG,
      instruction: SITE_LOCK_INSTRUCTION,
      status: "lock",
      result: { lock: null, seeded_at: at },
      created_at: at,
      updated_at: at,
    }).catch(() => null);
    outcome = await attempt();
  }
  if (outcome.won) return { ok: true, token };
  return {
    ok: false,
    token: null,
    holder: outcome.holder,
    reason: outcome.missing ? LOCK_REASON_UNAVAILABLE : LOCK_REASON_HELD,
  };
}

/**
 * releaseSiteLock({ siteSlug, token, jobId, conditionalUpdate, now })
 *
 * Token-guarded, so only the holder can let go — a release can never erase a
 * successor's live claim. Best-effort at the call site: a release that fails
 * self-heals when the lease goes stale, costing the site a waited turn, not a
 * clobbered edit.
 */
async function releaseSiteLock({ siteSlug, token, jobId, conditionalUpdate, now = Date.now() }) {
  if (!token) return { ok: false, reason: "no_lock_token" };
  const at = new Date(now).toISOString();
  const res = await conditionalUpdate(
    "ghost_agency_edit_jobs",
    "job_id",
    siteLockRowId(siteSlug),
    { "result->>lock": `eq.${token}` },
    { status: "lock", result: { lock: null, released_by: jobId, released_at: at }, updated_at: at },
  );
  if (res && res.mode === "dry_run") return { ok: true, mode: "dry_run" };
  return { ok: Boolean(res && res.ok === true), released: Boolean(res && res.ok === true && res.updated === true) };
}

// Owner notification after an edit lands (or fails). The owner asked for the
// full loop — Riley takes the request, the change goes live, and an email
// confirms it — so the confirmation is part of the job, not a nicety.
async function notifyOwner({ jobId, siteSlug, instruction, ok, result, error }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) return;
  const to = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "woodwardsoftware@gmail.com").trim();
  const from = String(process.env.GHOST_AGENCY_RESEND_FROM || "mark@go.wss-ai.com").trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const url = `https://${siteSlug}.wss-ai.com/`;
  const changed = ok && result && Array.isArray(result.changedFiles) ? result.changedFiles : [];
  // "Nothing was deployed" is a claim, and it is only true of a plan that threw
  // before the upload. A change that deployed and then failed the rendered check
  // was very much deployed — and either rolled back or not. Say which.
  const notLanded = Boolean(result && result.not_landed);
  const verified = (result && result.verified) || null;
  const reverted = result ? result.reverted : undefined;
  const aftermath = notLanded
    ? (reverted === true
      ? `It deployed, the rendered page showed the change had not taken (${esc((verified && verified.reason) || "unverified")}), and it was rolled back — the live site is back to its pre-edit bytes.`
      : reverted === false
        ? "It deployed, the rendered page showed the change had not taken, AND THE ROLLBACK DID NOT COMPLETE. The live site needs a human now."
        : `It deployed but could not be confirmed on the rendered page (${esc((verified && verified.reason) || "unverified")}). Nothing was rolled back — the deployed bytes are still live.`)
    : "Nothing was deployed; the live site is unchanged.";
  const title = ok ? "Site edit is live" : notLanded ? "Site edit DID NOT LAND" : "Site edit FAILED";
  const html = `<div style="max-width:560px;font-family:-apple-system,Segoe UI,sans-serif">
<h2 style="font-size:17px">${title} — ${esc(siteSlug)}</h2>
<p style="font-size:14px;color:#33332c"><strong>Request:</strong> ${esc(instruction)}</p>
${ok
    ? `<p style="font-size:14px">${changed.length ? `Changed ${changed.length} file(s): <code>${esc(changed.slice(0, 6).join(", "))}</code>.` : "Change applied."} See it live: <a href="${esc(url)}">${esc(url)}</a></p>`
    : `<p style="font-size:14px;color:#8a1c1c"><strong>Error:</strong> ${esc(error)}</p>`
      + `<p style="font-size:13px;color:#6a6a60">${aftermath}</p>`
      + (notLanded && verified && verified.detail
        ? `<p style="font-size:12px;color:#6a6a60"><code>${esc(JSON.stringify(verified.detail).slice(0, 400))}</code></p>`
        : "")}
<p style="color:#8a8a80;font-size:12px;margin-top:16px">Job ${esc(jobId)} · triggered via Riley's site-edit tool.</p>
</div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `WSS Labs <${from}>`, to: [to], subject: `${ok ? "✅" : "❌"} Site edit — ${siteSlug}`, html }),
  }).catch(() => {});
}

/**
 * executeEditJob(jobId, deps) -> { ok, jobId, status, ... }
 *
 * Terminal states are exactly the endpoint's: done | refused | failed, plus
 * pass-throughs for not-found and already-done. A REFUSAL IS NOT A FAILURE —
 * the truth gate declining to publish an unbacked claim is the system working,
 * and it carries the sentence Riley says.
 *
 * `deps` exists so a test can prove the guarantee this function now makes: hand
 * it work that never settles and watch the row still land on `failed`. Every
 * caller in production passes nothing and gets the real store.
 */
async function executeEditJob(jobId, deps = {}) {
  const select = deps.select || defaultSelect;
  const upsertRow = deps.upsertRow || defaultUpsert;
  const insertRow = deps.insertRow || defaultInsertRow;
  const recordEvent = deps.recordEvent || defaultRecordEvent;
  const conditionalUpdate = deps.conditionalUpdate || defaultConditionalUpdate;
  const resolveSiteEditTarget = deps.resolveSiteEditTarget || defaultResolveTarget;
  const runSiteChange = deps.runSiteChange || defaultRunSiteChange;
  const notify = deps.notifyOwner || notifyOwner;
  const deliverFollowUp = deps.deliverFollowUp || defaultDeliverFollowUp;
  const editDeadlineMs = Number.isFinite(deps.editDeadlineMs) ? deps.editDeadlineMs : EDIT_DEADLINE_MS;
  const targetDeadlineMs = Number.isFinite(deps.targetDeadlineMs) ? deps.targetDeadlineMs : TARGET_DEADLINE_MS;

  const id = String(jobId || "").trim();
  if (!id) return { ok: false, error: "jobId required" };

  const found = await withDeadline(
    () => select("ghost_agency_edit_jobs", `job_id=eq.${encodeURIComponent(id)}&limit=1`),
    WRITE_DEADLINE_MS,
    "reading the job",
  ).catch(() => null);
  const job = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (!job) return { ok: false, status: 404, error: "job not found" };
  if (job.status === "done") return { ok: true, jobId: id, status: "done", result: job.result };

  const base = { job_id: id, site_slug: job.site_slug, instruction: job.instruction };
  const kind = classifyEditKind(job.instruction);
  const attempts = attemptsOf(job) + 1;

  // Write the ending, always, from one place. Everything below either reaches
  // this or throws into the catch that reaches it.
  const finish = async (status, result, { event, payload, notifyOk = null, error = null } = {}) => {
    await withDeadline(
      () => upsertRow("ghost_agency_edit_jobs", { ...base, status, result, updated_at: new Date().toISOString() }, "job_id"),
      WRITE_DEADLINE_MS,
      "writing the outcome",
    ).catch(() => null);
    if (event) await bounded(() => recordEvent(event, { jobId: id, kind, ...(payload || {}) }), WRITE_DEADLINE_MS, "recording the outcome");
    if (notifyOk !== null) {
      await bounded(
        () => notify({ jobId: id, siteSlug: job.site_slug, instruction: job.instruction, ok: notifyOk, result, error }),
        NOTIFY_DEADLINE_MS,
        "notifying the owner",
      );
    }
    // THE PROMISED FOLLOW-UP. When the caller was told "you'll get an email
    // when it's live", THIS write is the first moment that sentence is true —
    // `done` only lands after the rendered page verified the change. Whether a
    // customer email may actually go is decided entirely by
    // lib/riley-followups.js (durable promise, consent, client-record
    // recipient, suppression ledger); with no promise recorded this is a
    // no-op read. Bounded like every tail call here: the follow-up must never
    // be able to cost the job its ending.
    if (status === "done") {
      await bounded(
        () => deliverFollowUp({
          jobId: id,
          siteSlug: job.site_slug,
          instruction: job.instruction,
          jobRow: { ...base, status, result, follow_up: job.follow_up === undefined ? null : job.follow_up },
        }),
        NOTIFY_DEADLINE_MS,
        "delivering the promised follow-up",
      );
    }
  };

  // STOP TRYING, OUT LOUD. A job that has already burned its attempts is not
  // going to start working on the next pass, and leaving it runnable meant
  // drainEditQueue spent a slot on it every two minutes for ever.
  if (attempts > MAX_ATTEMPTS) {
    const failure = `gave up after ${MAX_ATTEMPTS} attempts`;
    // A run whose LAST attempt died on the stale-base guard has a provable
    // ending — the guard fires pre-upload — so it gets its own honest sentence
    // instead of the abandoned one, which hedges about bytes it never sent.
    const diedStale = !!(job.result && typeof job.result === "object" && job.result.stale_site_base);
    // It carries the abandoned sentence, NOT the generic failure one. Those
    // attempts each got as far as somewhere unknown before dying; "nothing on
    // your site changed" is not a claim anyone here is entitled to make.
    await finish("failed", { kind, error: "attempts_exhausted", attempts: attempts - 1, ...(diedStale ? { stale_site_base: true, say: STALE_BASE_SAY } : { say: ABANDONED_SAY }) }, {
      event: "ghost_agency_site_edit_failed",
      payload: { error: failure },
      notifyOk: false,
      error: failure,
    });
    return { ok: false, jobId: id, status: "failed", error: failure };
  }

  // ── THE CLAIM IS ATOMIC ─────────────────────────────────────────────────────
  //
  // Three callers share this function — the by-hand admin runner, the cron
  // drain, and the fire-and-forget kick right after Riley queues a job — and
  // the old claim was an unconditional "status=running" upsert. Two of them
  // arriving inside the same window both read "queued", both wrote "running",
  // and both DEPLOYED THE SAME EDIT: the double-execution behind the customer's
  // photo upload hanging at 79% while two workers fought over one job's row and
  // one of them overwrote the other's progress trail.
  //
  // Now the claim is one conditional PATCH, evaluated atomically by PostgREST:
  // it succeeds only while the row is still claimable (not held by a live
  // worker, not already done), and the second caller matches zero rows and
  // walks away WITHOUT running anything. `updated_at` in the guard makes a
  // fresh "running" row unclaimable and a stale one (dead lambda, past
  // STALE_RUNNING_MS) reclaimable — the same line the sweeper draws.
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  // The claim carries a one-shot token because "how many rows did the PATCH
  // return" is NOT a reliable win signal here. Measured against the live
  // store (2026-08-12, patch-probe): the conditional PATCH applied — the row
  // read back status=running with our result — and the representation came
  // back `[]`, because PostgREST re-applies the or= tree to the RETURNING set
  // and this guard is falsified by the very transition it authorizes
  // (status.neq.running stops being true the moment the claim lands). So an
  // empty representation is ambiguous: lost the race, OR won it and the
  // filter hid the evidence. The token settles it — the row is the truth.
  const claimToken = randomUUID();
  // A store that has no conditionalUpdate (a test stubbing lib/store with just
  // select/upsertRow) gets the legacy claim below, exactly like dry_run.
  const claim = typeof conditionalUpdate === "function"
    ? await withDeadline(
      () => conditionalUpdate(
        "ghost_agency_edit_jobs",
        "job_id",
        id,
        { or: `(and(status.neq.running,status.neq.done),and(status.eq.running,updated_at.lt.${staleBefore}))` },
        { status: "running", result: { attempts, claim: claimToken }, updated_at: new Date().toISOString() },
      ),
      WRITE_DEADLINE_MS,
      "claiming the job",
    ).catch(() => ({ ok: false, mode: "claim_error", updated: false }))
    : { ok: false, mode: "dry_run", updated: false };

  if (claim && claim.ok === true && claim.updated === false) {
    // Ambiguous outcome — read the row and look for OUR token.
    const verify = await withDeadline(
      () => select("ghost_agency_edit_jobs", `job_id=eq.${encodeURIComponent(id)}&limit=1`),
      WRITE_DEADLINE_MS,
      "verifying the claim",
    ).catch(() => null);
    const verifyRow = verify?.ok && Array.isArray(verify.data) ? verify.data[0] : null;
    const rowClaim = verifyRow && verifyRow.result && typeof verifyRow.result === "object" ? verifyRow.result.claim : null;
    if (rowClaim !== claimToken) {
      // Someone else genuinely holds the row. Losing this race is the
      // mechanism WORKING, not an error worth a terminal write.
      return { ok: false, jobId: id, status: "in_flight", error: "another worker is already running this job" };
    }
    // The write applied and the representation hid it. We won; carry on.
  }
  if (claim && claim.mode === "dry_run") {
    // No conditional store behind this environment (tests wired to plain
    // fakes, local dry runs). Keep the legacy claim so the row still reads
    // "running" — the atomicity guarantee only exists where the store does.
    await withDeadline(
      () => upsertRow("ghost_agency_edit_jobs", { ...base, status: "running", result: { attempts }, updated_at: new Date().toISOString() }, "job_id"),
      WRITE_DEADLINE_MS,
      "claiming the job",
    ).catch(() => null);
  } else if (!claim || claim.ok !== true) {
    // The claim write itself failed (store hiccup, timeout). Running anyway
    // would give up the single-execution guarantee, so leave the row queued
    // for the next pass rather than risk a second worker on a live site.
    return { ok: false, jobId: id, status: "claim_unavailable", error: "could not claim the job; it stays queued for the next pass" };
  }

  // ── THE SITE LEASE, TAKEN BEFORE ANYTHING READS THE SITE ────────────────────
  //
  // The lease is acquired AFTER the per-job claim (so a job that lost its own
  // claim never touches the lease) and BEFORE resolveSiteEditTarget (which can
  // itself deploy, and which precedes the archive read). From this line until
  // the terminal write + release below, no other job for this site may begin
  // its read — that is the read-after-write ordering the 68-second clobber
  // ran straight through.
  const lockSupported = typeof conditionalUpdate === "function";
  const lease = !lockSupported
    // A store with no conditionalUpdate has no atomicity to offer (the legacy
    // dry-run path below); the lease would be a fiction, so it is not taken.
    // Production always has the real store.
    ? { ok: true, token: "dry_run" }
    : await withDeadline(
      () => acquireSiteLock({ siteSlug: job.site_slug, jobId: id, select, insertRow, conditionalUpdate }),
      WRITE_DEADLINE_MS,
      "acquiring the site lease",
    ).catch(() => ({ ok: false, reason: LOCK_REASON_UNAVAILABLE, holder: null }));

  if (lockSupported && !lease.ok) {
    // BACKPRESSURE, NOT FAILURE. The site is already being edited (or the lease
    // store hiccupped). Re-queue the row, restoring the PRE-claim attempt count
    // — waiting for another job to finish is not an attempt, and burning the
    // retry budget on waits would kill the second of two rapid-fire edits
    // without it ever running. The next pass picks it up against the fresh
    // bytes the holder just published.
    await withDeadline(
      () => upsertRow("ghost_agency_edit_jobs", {
        ...base,
        status: "queued",
        result: {
          ...(job.result && typeof job.result === "object" ? job.result : {}),
          claim: null,
          attempts: Math.max(0, attempts - 1),
          waiting_site_lock: true,
          wait_reason: lease.reason || LOCK_REASON_HELD,
          lock_holder: lease.holder || null,
        },
        updated_at: new Date().toISOString(),
      }, "job_id"),
      WRITE_DEADLINE_MS,
      "requeueing behind the site lease",
    ).catch(() => null);
    await bounded(
      () => recordEvent("ghost_agency_site_edit_deferred", {
        jobId: id,
        kind,
        siteSlug: job.site_slug,
        reason: lease.reason || LOCK_REASON_HELD,
        holder: lease.holder || null,
      }),
      WRITE_DEADLINE_MS,
      "recording the deferral",
    );
    return { ok: false, jobId: id, status: "deferred_site_busy", reason: lease.reason || LOCK_REASON_HELD, holder: lease.holder || null };
  }

  // Everything from here owns the site lease; the finally below lets it go.
  try {
  // Re-validate here too (defense in depth): a prospect's deploy target can
  // change between enqueue and run. This runs AFTER the claim on purpose — it
  // can take 45 seconds, and the whole point of the atomic claim is that the
  // window between reading "queued" and owning the row is milliseconds.
  let site = null;
  let targetError = null;
  try {
    site = await withDeadline(() => resolveSiteEditTarget(job.site_slug), targetDeadlineMs, "finding your site");
  } catch (err) {
    targetError = String((err && err.message) || err);
  }
  if (!site) {
    // NOT a silent return. This is where manual-dq-build-sgi-energy lived for
    // fifteen days: unroutable, unrunnable, and still reported as queued.
    const failure = targetError || `unknown or unauthorized site ${job.site_slug}`;
    await finish("failed", { kind, error: failure, attempts, unroutable: true }, {
      event: "ghost_agency_site_edit_failed",
      payload: { error: failure },
      notifyOk: false,
      error: failure,
    });
    return { ok: false, jobId: id, status: "failed", error: failure };
  }

  try {
    const result = await withDeadline(
      () => runSiteChange({
        siteSlug: job.site_slug,
        instruction: job.instruction,
        projectName: site.projectName,
        aliasHost: site.aliasHost,
        jobId: id,
      }),
      editDeadlineMs,
      "making the change",
    );
    const stored = { kind, attempts, ...result };

    if (result && result.applied === false) {
      await finish("refused", stored, {
        event: "ghost_agency_site_edit_refused",
        payload: { reason: result.reason || null },
      });
      return { ok: true, jobId: id, kind, status: "refused", result: stored };
    }

    // ── APPLIED IS NOT LANDED ────────────────────────────────────────────────
    //
    // The edit engine now RENDERS the deployed page and checks each declaration
    // against the computed style of the elements it matched (lib/edit-verify.js).
    // Until it did, "applied" meant the bytes changed — which is how a customer
    // who asked for an orange headline was told "Done — it's live on your site
    // now" over a headline that was still white.
    //
    // So a run that could not prove the change is on the page does NOT reach
    // `done`. It reaches `failed`, carrying the sentence runSiteChange composed
    // for it: either "it didn't take and I've put it back", or "it went out and
    // I couldn't confirm it, so I won't call it done". `done` from here on means
    // measured, on the live page.
    if (result && result.verified && result.verified.ok === false) {
      const why = `edit did not land: ${result.verified.status}/${result.verified.reason || "unknown"}`;
      await finish("failed", { ...stored, not_landed: true }, {
        event: "ghost_agency_site_edit_not_landed",
        payload: {
          status: result.verified.status,
          reason: result.verified.reason || null,
          detail: result.verified.detail || null,
          reverted: result.reverted === undefined ? null : result.reverted,
        },
        notifyOk: false,
        error: why,
      });
      return { ok: false, jobId: id, kind, status: "failed", notLanded: true, error: why, result: { ...stored, not_landed: true } };
    }

    await finish("done", stored, {
      event: "ghost_agency_site_edit_done",
      payload: { result: stored },
      notifyOk: true,
    });
    return { ok: true, jobId: id, kind, status: "done", result: stored };
  } catch (err) {
    // STALE BASE — the guard inside runSiteChange measured that the site was
    // written by ANOTHER job between this job's archive read and its upload.
    // Nothing was uploaded (the guard fires pre-upload), so nothing was
    // published and nothing needs undoing. The fail-safe is a RETRY, not a
    // terminal failure: the row goes back to queued, attempts keep counting so
    // the loop is bounded, and the next pass replans against the fresh bytes.
    if (err && err.code === "stale_site_base") {
      await withDeadline(
        () => upsertRow("ghost_agency_edit_jobs", {
          ...base,
          status: "queued",
          result: {
            kind,
            attempts,
            error: "stale_site_base",
            stale_site_base: true,
            say: STALE_BASE_SAY,
            ...(err.staleBase ? { stale_base_markers: err.staleBase } : {}),
          },
          updated_at: new Date().toISOString(),
        }, "job_id"),
        WRITE_DEADLINE_MS,
        "requeueing after a stale base",
      ).catch(() => null);
      await bounded(
        () => recordEvent("ghost_agency_site_edit_stale_base", { jobId: id, kind, siteSlug: job.site_slug, attempts }),
        WRITE_DEADLINE_MS,
        "recording the stale base",
      );
      return { ok: false, jobId: id, status: "deferred_stale_base", reason: "stale_site_base", attempts };
    }
    const failure = String((err && err.message) || err);
    // A deadline is a distinct ending from a crash, and the customer's sentence
    // has to say so — "nothing changed" is a claim we cannot make about work
    // that was cut off mid-flight.
    const timedOut = err && err.code === "edit_deadline_exceeded";
    // The progress trail the run stamped onto the row before it died answers
    // "which phase ate it" in seconds instead of by re-running production — so
    // the terminal write must not erase it. Read it back before overwriting.
    const trail = await bounded(async () => {
      const at = await select("ghost_agency_edit_jobs", `job_id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = at?.ok && Array.isArray(at.data) ? at.data[0] : null;
      const p = row && row.result && typeof row.result === "object" ? row.result.progress : null;
      return p && typeof p === "object" ? p : null;
    }, WRITE_DEADLINE_MS, "reading the progress trail");
    const stored = {
      kind,
      attempts,
      error: failure,
      ...(trail ? { progress: trail } : {}),
      ...(timedOut
        ? {
          timed_out: true,
          say: "That change ran too long and we stopped it, so we can't confirm whether any of it reached your site. Open your page to see where it stands, then send it again or call Riley.",
        }
        : {}),
    };
    await finish("failed", stored, {
      event: "ghost_agency_site_edit_failed",
      payload: { error: failure },
      notifyOk: false,
      error: failure,
    });
    return { ok: false, jobId: id, status: "failed", error: failure, ...(timedOut ? { timedOut: true } : {}) };
  }
  } finally {
    // The lease outlives the terminal write ON PURPOSE: the ending is on the
    // row before the next job of this site may read a single byte.
    if (lockSupported) {
      await bounded(
        () => releaseSiteLock({ siteSlug: job.site_slug, token: lease.token, jobId: id, conditionalUpdate }),
        WRITE_DEADLINE_MS,
        "releasing the site lease",
      );
    }
  }
}

/**
 * drainEditQueue({ max }) — run every runnable job, oldest first.
 *
 * "Runnable" is decided by classifyStuckJob, the same function the sweeper
 * uses, so the two can never disagree about a row: this re-runs what that calls
 * retryable, and it closes what that calls dead. A stale "running" claim is a
 * lambda that died (ten minutes is far past the 300s function cap), and it gets
 * MAX_ATTEMPTS tries before executeEditJob gives up on it out loud.
 *
 * SERIAL SAME-SITE DRAIN. When a job reaches a terminal state and its site has
 * ANOTHER queued job, the next one is pulled to the FRONT of this same pass
 * instead of being left for the next cron tick: consecutive edits to one site
 * must run against each other's published bytes (read-after-write), and the
 * per-site lease plus the stale-base guard only hold if the follower starts
 * AFTER the leader finishes — which is exactly what this loop enforces, within
 * the same `max` budget the invocation always had. Different sites are not
 * reordered by this; they were and remain one-at-a-time only within this
 * sequential loop, and the lease makes any OTHER caller (a kick, the admin
 * runner) wait its turn rather than run beside it.
 */
async function drainEditQueue({ max = 3, now = Date.now(), select = defaultSelect, execute = (jobId) => executeEditJob(jobId) } = {}) {
  const staleBefore = new Date(now - STALE_RUNNING_MS).toISOString();
  const found = await select(
    "ghost_agency_edit_jobs",
    `or=(status.eq.queued,and(status.eq.running,updated_at.lt.${encodeURIComponent(staleBefore)}))&order=created_at.asc&limit=${Math.max(1, Math.min(10, max))}`,
  );
  const jobs = found?.ok && Array.isArray(found.data) ? found.data : [];
  const ran = [];
  const ranIds = new Set();
  const budget = Math.max(1, Math.min(10, max));
  const pending = [...jobs];
  while (pending.length && ran.length < budget) {
    const job = pending.shift();
    if (!job || ranIds.has(job.job_id)) continue;
    if (classifyStuckJob(job, now).state === "in_flight") continue;
    ranIds.add(job.job_id);
    const outcome = await execute(job.job_id).catch((e) => ({ ok: false, jobId: job.job_id, status: "failed", error: String(e && e.message) }));
    ran.push(outcome);
    // The follow-up pull. Only a TERMINAL outcome proves the site's lease was
    // released and the bytes are settled; a deferral (site busy / stale base)
    // must not spend the budget re-selecting a site it cannot run yet.
    if (outcome && ["done", "failed", "refused"].includes(String(outcome.status))) {
      const nextFound = await select(
        "ghost_agency_edit_jobs",
        `site_slug=eq.${encodeURIComponent(job.site_slug)}&status=eq.queued&order=created_at.asc&limit=1`,
      ).catch(() => null);
      const nextRow = nextFound?.ok && Array.isArray(nextFound.data) ? nextFound.data[0] : null;
      if (nextRow && !ranIds.has(nextRow.job_id)) pending.unshift(nextRow);
    }
  }
  return { ok: true, examined: jobs.length, ran };
}

module.exports = {
  executeEditJob,
  drainEditQueue,
  notifyOwner,
  withDeadline,
  acquireSiteLock,
  releaseSiteLock,
  siteLockRowId,
  STALE_BASE_SAY,
  LOCK_REASON_HELD,
  LOCK_REASON_UNAVAILABLE,
  SITE_LOCK_PREFIX,
  EDIT_DEADLINE_MS,
  TARGET_DEADLINE_MS,
};
