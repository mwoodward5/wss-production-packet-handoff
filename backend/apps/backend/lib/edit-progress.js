"use strict";

// lib/edit-progress.js — a 0-100 meter that CANNOT lie.
//
// THE PROBLEM THIS ENDS. Riley used to say "about a minute" over jobs that were
// measured taking twelve, and the dashboard's whole vocabulary for a running
// job was one unchanging sentence. Nothing recorded where the work actually
// was: a job went queued -> running -> done with no signal in between, so any
// percent anyone showed would have been an invention — the "about a minute"
// lie with decimals.
//
// THE RULE, stated once and enforced by construction:
//
//   EVERY NUMBER THIS MODULE EMITS IS DERIVED FROM A RECORDED TIMESTAMP.
//
//   - The STAGE is real: lib/site-change-plan.js stamps each transition onto
//     the job row (result.progress.stages) at the moment the runner passes it.
//     A poll reads the stamp; it never guesses.
//   - The PERCENT is measured: each stage's share of the bar is its p50
//     duration across completed jobs of the same lane — real history, not a
//     hardcoded weight. Until at least MIN_HISTORY completed jobs exist,
//     percent is null and the caller shows the stage name alone. A stage name
//     is honest; an invented percent is not.
//   - The TIME REMAINING is the same history read forward: p50 of what is left,
//     from the stamped moment the current stage began. It is an "about", and
//     it is only ever said when it comes from measurements.
//
// WITHIN ONE ATTEMPT THE PERCENT ONLY MOVES FORWARD. Stage stamps only append;
// elapsed time only grows; and a per-job monotonic guard clamps any residual
// wobble (e.g. the history cache refreshing mid-run) so a poller can never
// watch the bar go backwards. A RETRY IS A NEW BAR: attempt 2 starts its own
// trail, because "we are starting over" is the truth and a bar that pretended
// to continue would not be.
//
// Split of labour with the rest of the system:
//   write side  createStageTracker()  — called by lib/site-change-plan.js
//   read side   describeEditProgress() / editProgress() — called by the
//               dashboard (lib/customer-edits.js) and by Riley's status tool
//               (api/vapi-tools/site-edit-status.js, one-line wiring).
// Both sides speak through ghost_agency_edit_jobs.result.progress; there is no
// second store and no second truth.

const { select: defaultSelect, upsertRow: defaultUpsert, recordEvent: defaultRecordEvent } = require("./store");

/** Stage order per lane. A meter is only as honest as its map of the road, so
 *  each lane names exactly the transitions its code actually stamps. */
const LANES = {
  plan: ["reading_site", "planning", "applying", "uploading", "deploying", "verifying"],
  undo: ["reading_site", "applying", "uploading", "deploying", "verifying"],
  "seo-page": ["reading_site", "applying"],
};

/** The words. `chip` is the short dashboard label; `clause` is the spoken
 *  middle of Riley's sentence. No coder words in either. */
const STAGE_WORDS = {
  queued: { chip: "Queued", clause: "it's in line to start" },
  starting: { chip: "Starting", clause: "it's just getting started" },
  reading_site: { chip: "Reading your site", clause: "I'm reading your site over" },
  planning: { chip: "Planning the change", clause: "I'm working out exactly what to change" },
  applying: { chip: "Making the change", clause: "I'm making the change to your pages" },
  uploading: { chip: "Saving the new version", clause: "I'm saving the new version of your site" },
  deploying: { chip: "Publishing", clause: "it's publishing to your live site now" },
  verifying: { chip: "Checking the live page", clause: "I'm checking the live page to make sure it took" },
  live: { chip: "Live", clause: "it's live" },
  refused: { chip: "Not applied", clause: "" },
  failed: { chip: "Didn't go through", clause: "" },
};

/** Below this many fully-stamped completed jobs, no percent is shown. Three is
 *  the fewest for which a median is more than an anecdote. */
const MIN_HISTORY = 3;

/** How many completed rows one measurement pass reads. */
const HISTORY_LIMIT = 40;

/** How long a lane's measured shares are reused before re-measuring. */
const SHARES_TTL_MS = 5 * 60 * 1000;

/** Ceiling on any single progress write. A stamp that cannot land promptly is
 *  dropped — the meter is a passenger and must never slow the edit itself. */
const STAMP_WRITE_MS = 6_000;

/** A running job whose stamps have gone quiet this long has no live worker
 *  speaking for it (live callers answer at 12/22s; the status tool's own spoken
 *  guard trips at the same three minutes). Past it the meter keeps the recorded
 *  stage and percent — they happened — but STOPS quoting a remainder. Measured
 *  live 2026-08-12: a job frozen in `deploying` said "under twenty seconds to
 *  go" for eleven minutes straight, which is the about-a-minute lie reborn. */
const STALLED_AFTER_MS = 3 * 60 * 1000;

/** What a stalled meter says instead of a time. True of the state with nothing
 *  else known: the trail stopped, nothing since, outcome unknown. "I've flagged
 *  it" is a CLAIM, and describeEditProgress makes it true before it is said —
 *  a ghost_agency_site_edit_stalled event lands on the ledger the first time a
 *  stalled job is read (see flagStalledEditJob). The owner's bar, verbatim from
 *  the walkthrough: say "this is taking longer than it should — I've flagged
 *  it" instead of freezing at a number. */
const STALLED_RUNNING_WORDS =
  "This is taking longer than it should — I've flagged it. Check the page in a few minutes; if it hasn't landed, send it again or call Riley and we'll finish it.";
const STALLED_QUEUED_WORDS =
  "This is taking longer than it should to get started — I've flagged it. If it doesn't pick up in the next few minutes, send it again and we'll get it moving.";

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function parseAt(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? at : null;
}

/** The stamped trail on a row, or null. Tolerates every malformed shape the
 *  store could hand back, because this reads rows written across versions. */
function trailOf(row) {
  const result = isPlainObject(row) ? row.result : null;
  const progress = isPlainObject(result) ? result.progress : null;
  if (!isPlainObject(progress)) return null;
  const stages = Array.isArray(progress.stages) ? progress.stages : [];
  const clean = [];
  for (const entry of stages) {
    if (!isPlainObject(entry)) continue;
    const stage = String(entry.stage || "").trim();
    const at = parseAt(entry.at);
    if (!stage || at == null) continue;
    // Timestamps must never run backwards inside one trail; a stamp that does
    // is clock skew or corruption, and the honest response is to drop it.
    if (clean.length && at < clean[clean.length - 1].atMs) continue;
    clean.push({ stage, at: entry.at, atMs: at });
  }
  if (!clean.length) return null;
  return {
    lane: LANES[progress.lane] ? progress.lane : "plan",
    attempt: Number.isFinite(Number(progress.attempt)) ? Number(progress.attempt) : 1,
    stages: clean,
  };
}

// ---------------------------------------------------------------------------
// WRITE SIDE — the tracker lib/site-change-plan.js stamps through
// ---------------------------------------------------------------------------

function withCeiling(work, ms) {
  let timer = null;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([Promise.resolve().then(work), expiry])
    .catch(() => null)
    .finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * createStageTracker({ jobId, siteSlug, instruction }) -> tracker
 *
 * tracker.stamp(stage)  — append {stage, at} locally and persist the trail onto
 *                         the job row. NEVER throws and never exceeds
 *                         STAMP_WRITE_MS per call: the meter must not be able
 *                         to fail or slow the edit it describes.
 * tracker.lane(name)    — name the lane ("plan" | "undo" | "seo-page") so the
 *                         read side compares this run against its own kind.
 * tracker.summary()     — { lane, attempt, stages } for embedding in the final
 *                         result, which is how completed rows keep their trail
 *                         (the runner's terminal write replaces `result`).
 *
 * PERSISTENCE IS GUARDED BY A READ. The first stamp reads the row and carries
 * its existing result forward (result.attempts is the runner's retry budget —
 * clobbering it would un-cap retries). No readable row means no persistence:
 * a direct runSiteChange() invocation from a script stamps locally into its
 * return value and touches no table.
 */
function createStageTracker({ jobId, siteSlug, instruction, deps = {} } = {}) {
  const select = deps.select || defaultSelect;
  const upsertRow = deps.upsertRow || defaultUpsert;
  const nowFn = typeof deps.now === "function" ? deps.now : () => new Date();

  const id = String(jobId || "").trim();
  const stages = [];
  let lane = "plan";
  let attempt = 1;
  let baseResult = null; // the row's result at first stamp, carried forward
  let baseRow = null;
  let checked = false;

  const summary = () => ({ lane, attempt, stages: stages.map((s) => ({ stage: s.stage, at: s.at })) });

  async function ensureBase() {
    if (checked) return;
    checked = true;
    if (!id) return;
    const found = await withCeiling(
      () => select("ghost_agency_edit_jobs", `job_id=eq.${encodeURIComponent(id)}&limit=1`),
      STAMP_WRITE_MS,
    );
    const row = found && found.ok === true && Array.isArray(found.data) ? found.data[0] : null;
    if (!row) return; // no row, no persistence — local trail only
    baseRow = { job_id: row.job_id, site_slug: row.site_slug, instruction: row.instruction };
    baseResult = isPlainObject(row.result) ? row.result : {};
    const n = Number(baseResult.attempts);
    attempt = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  }

  async function persist() {
    if (!baseRow) return;
    await withCeiling(
      () => upsertRow(
        "ghost_agency_edit_jobs",
        {
          ...baseRow,
          // Merge, never replace: attempts (the retry cap) and anything else
          // the runner wrote at claim time survive every stamp.
          result: { ...baseResult, progress: summary() },
          // Bumping updated_at is load-bearing: it is the sweeper's liveness
          // signal, so a job that is stamping progress can never be reclaimed
          // as a stale worker mid-flight.
          updated_at: nowFn().toISOString(),
        },
        "job_id",
      ),
      STAMP_WRITE_MS,
    );
  }

  return {
    lane(name) { if (LANES[name]) lane = name; },
    async stamp(stage) {
      const name = String(stage || "").trim();
      if (!name) return;
      if (stages.length && stages[stages.length - 1].stage === name) return; // idempotent
      stages.push({ stage: name, at: nowFn().toISOString() });
      try {
        await ensureBase();
        await persist();
      } catch { /* the meter never takes the edit down */ }
    },
    summary,
  };
}

/** For call sites that may or may not have been handed a tracker. */
function nullTracker() {
  return { lane() {}, async stamp() {}, summary: () => null };
}

// ---------------------------------------------------------------------------
// MEASUREMENT — what completed jobs say each stage costs
// ---------------------------------------------------------------------------

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** In-memory per-lane cache. Instance-local, TTL-bound; a cold lambda simply
 *  re-measures from the store. */
const sharesCache = new Map();

function resetSharesCache() {
  sharesCache.clear();
  lastReported.clear();
}

/**
 * loadStageShares({ select, lane }) -> shares | null
 *
 * shares = {
 *   lane, samples,
 *   totalMs,                       // p50 whole-run duration
 *   stages: [{ stage, durMs, startFrac }]   // in lane order
 * }
 *
 * Built ONLY from completed (status=done) rows whose trail covers every stage
 * of the lane and ends in "live" — the rows where each stamp has a successor
 * to measure against. Returns null when history is thinner than MIN_HISTORY:
 * null is the module saying "I have not measured this yet", and the read side
 * turns that into a stage name with no number.
 */
async function loadStageShares({ select = defaultSelect, lane = "plan", now = Date.now() } = {}) {
  const order = LANES[lane] || LANES.plan;
  const cached = sharesCache.get(lane);
  if (cached && now - cached.at < SHARES_TTL_MS) return cached.shares;

  let found = null;
  try {
    found = await select(
      "ghost_agency_edit_jobs",
      `status=eq.done&order=updated_at.desc&limit=${HISTORY_LIMIT}`,
    );
  } catch { found = null; }
  const rows = found && found.ok === true && Array.isArray(found.data) ? found.data : [];

  const perStage = new Map(order.map((s) => [s, []]));
  let samples = 0;
  for (const row of rows) {
    const trail = trailOf(row);
    if (!trail || trail.lane !== lane) continue;
    const seq = trail.stages;
    if (seq[seq.length - 1].stage !== "live") continue; // no measured ending
    // Each stage's cost is the gap to the NEXT stamp. Every lane stage must be
    // present exactly in order for the row to count — partial trails would
    // skew the very shares that make the percent honest.
    const names = seq.map((s) => s.stage);
    if (names.slice(0, -1).join(">") !== order.join(">")) continue;
    for (let i = 0; i < seq.length - 1; i += 1) {
      perStage.get(seq[i].stage).push(seq[i + 1].atMs - seq[i].atMs);
    }
    samples += 1;
  }

  let shares = null;
  if (samples >= MIN_HISTORY) {
    const durs = order.map((stage) => ({ stage, durMs: Math.max(1, median(perStage.get(stage))) }));
    const totalMs = durs.reduce((sum, d) => sum + d.durMs, 0);
    let acc = 0;
    shares = {
      lane,
      samples,
      totalMs,
      stages: durs.map((d) => {
        const startFrac = acc / totalMs;
        acc += d.durMs;
        return { stage: d.stage, durMs: d.durMs, startFrac };
      }),
    };
  }
  sharesCache.set(lane, { at: now, shares });
  return shares;
}

// ---------------------------------------------------------------------------
// READ SIDE — the meter
// ---------------------------------------------------------------------------

/** Per-(job, attempt) high-water mark so a poller can never watch the bar move
 *  backwards, whatever the history cache does between polls. */
const lastReported = new Map();

function monotone(jobId, attempt, percent) {
  if (percent == null) return null;
  const key = `${jobId}#${attempt}`;
  if (lastReported.size > 500) lastReported.clear();
  const floor = lastReported.get(key);
  const value = floor != null && floor > percent ? floor : percent;
  lastReported.set(key, value);
  return value;
}

/** "about twenty seconds to go" — spoken, rounded, and only ever composed from
 *  measured milliseconds. */
function remainingWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = ms / 1000;
  if (s < 15) return "under twenty seconds to go";
  if (s < 55) {
    const tens = Math.max(2, Math.round(s / 10));
    const word = { 2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "a minute" }[tens] || "a few";
    return tens >= 6 ? "about a minute to go" : `about ${word} seconds to go`;
  }
  if (s < 90) return "about a minute to go";
  const minutes = Math.round(s / 60);
  if (minutes <= 2) return "about two minutes to go";
  return `about ${minutes} minutes to go`;
}

function composeRunning({ stage, percent, expectedRemainingMs }) {
  const words = STAGE_WORDS[stage] || { clause: "it's working on it" };
  const clause = words.clause || "it's working on it";
  const tail = expectedRemainingMs != null ? remainingWords(expectedRemainingMs) : "";
  if (percent != null) {
    return `It's about ${percent} percent through — ${clause}${tail ? `, ${tail}` : ""}.`;
  }
  // No measured history yet: the stage is stated and nothing is invented.
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}${tail ? `, ${tail}` : ""}. I'll tell you the moment it's live.`;
}

/**
 * meterFromRow(row, shares, { now }) -> the meter, synchronously.
 *
 * { ok, jobId, status, stage, stageWords, plainWords,
 *   percent|null, startedAt|null, expectedRemainingMs|null,
 *   attempt, lane, measuredOver, stages }
 */
function meterFromRow(row, shares, { now = Date.now() } = {}) {
  const source = isPlainObject(row) ? row : {};
  const jobId = String(source.job_id || "");
  const status = String(source.status || "queued").toLowerCase();
  const result = isPlainObject(source.result) ? source.result : {};
  const say = String(result.say || "").trim();
  const trail = trailOf(source);
  const lane = trail ? trail.lane : "plan";
  const attempt = trail ? trail.attempt : (Number(result.attempts) > 0 ? Math.floor(Number(result.attempts)) : 1);
  const stamped = trail ? trail.stages.map((s) => ({ stage: s.stage, at: s.at })) : [];
  const startedAt = trail ? trail.stages[0].at : String(source.updated_at || source.created_at || "") || null;

  const base = { ok: true, jobId, status, attempt, lane, measuredOver: shares ? shares.samples : 0, stages: stamped };

  if (status === "done") {
    return {
      ...base,
      stage: "live",
      stageWords: STAGE_WORDS.live.chip,
      percent: 100,
      startedAt,
      expectedRemainingMs: 0,
      plainWords: say || "That's live on your site — refresh the page and you'll see it.",
    };
  }
  if (status === "refused" || status === "failed") {
    return {
      ...base,
      stage: status,
      stageWords: STAGE_WORDS[status].chip,
      // No percent on a stopped job: "how far it got" is in the trail, and a
      // number here would read as progress still being made.
      percent: null,
      startedAt,
      expectedRemainingMs: null,
      plainWords: say || (status === "refused"
        ? "We couldn't make that one automatically, and nothing on your site was changed."
        : "That one didn't go through. It's logged and the team has it."),
    };
  }
  if (status === "queued") {
    const queuedAt = parseAt(source.created_at);
    const waitedMs = queuedAt != null ? Math.max(0, now - queuedAt) : null;
    const stalled = waitedMs != null && waitedMs > STALLED_AFTER_MS;
    return {
      ...base,
      stage: "queued",
      stageWords: STAGE_WORDS.queued.chip,
      percent: 0,
      startedAt: String(source.created_at || "") || null,
      // "Picks up in a moment" is a claim with a clock on it, and a row that
      // has already waited past the stall line has disproved it.
      expectedRemainingMs: stalled ? null : shares ? shares.totalMs : null,
      ...(stalled ? { stalledMs: waitedMs, stalled: true } : {}),
      plainWords: stalled ? STALLED_QUEUED_WORDS : "It's in line to start — it picks up in a moment.",
    };
  }

  // running
  const current = stamped.length ? stamped[stamped.length - 1].stage : "starting";
  const stage = current === "live" ? "verifying" : current; // a raced terminal stamp still reads as the last real phase
  let percent = null;
  let expectedRemainingMs = null;
  if (shares) {
    const idx = shares.stages.findIndex((s) => s.stage === stage);
    if (idx >= 0) {
      const here = shares.stages[idx];
      const enteredAt = trail ? trail.stages[trail.stages.length - 1].atMs : null;
      const elapsed = enteredAt != null ? Math.max(0, now - enteredAt) : 0;
      // Within-stage motion is real elapsed clock against the stage's measured
      // p50, capped at the stage's own span — the bar can approach the next
      // boundary but never claim a transition that was not stamped.
      const within = Math.min(elapsed, here.durMs);
      percent = Math.round(((here.startFrac * shares.totalMs + within) / shares.totalMs) * 100);
      percent = Math.max(0, Math.min(99, percent));
      const laterMs = shares.stages.slice(idx + 1).reduce((sum, s) => sum + s.durMs, 0);
      expectedRemainingMs = Math.max(0, here.durMs - elapsed) + laterMs;
    } else if (stage === "starting") {
      percent = 0;
      expectedRemainingMs = shares.totalMs;
    }
  }
  percent = monotone(jobId, attempt, percent);

  // STALL GUARD. The stamps are the worker's heartbeat: quiet past the stall
  // line means no live process is speaking for this job, so the stage and the
  // recorded percent hold (they happened) but the time promise goes. Without
  // this, a frozen deploy kept saying "under twenty seconds to go" for eleven
  // measured minutes — every word individually sourced, the sentence a lie.
  const lastMoveMs = trail ? trail.stages[trail.stages.length - 1].atMs : parseAt(source.updated_at || source.created_at);
  const sinceMoveMs = lastMoveMs != null ? Math.max(0, now - lastMoveMs) : null;
  if (sinceMoveMs != null && sinceMoveMs > STALLED_AFTER_MS) {
    return {
      ...base,
      stage,
      stageWords: (STAGE_WORDS[stage] || STAGE_WORDS.starting).chip,
      percent,
      startedAt,
      expectedRemainingMs: null,
      stalledMs: sinceMoveMs,
      stalled: true,
      plainWords: STALLED_RUNNING_WORDS,
    };
  }

  return {
    ...base,
    stage,
    stageWords: (STAGE_WORDS[stage] || STAGE_WORDS.starting).chip,
    percent,
    startedAt,
    expectedRemainingMs,
    plainWords: composeRunning({ stage, percent, expectedRemainingMs }),
  };
}

// ---------------------------------------------------------------------------
// THE FLAG. "I've flagged it" is only sayable because this runs: the first
// read that finds a job stalled writes ghost_agency_site_edit_stalled onto the
// ledger, where the operator surfaces and the morning report read. Deduped per
// (job, attempt) per process — a dashboard polling every few seconds must not
// turn one stall into a hundred ledger rows; a second lambda writing one more
// is harmless and still true.
//
// AWAITED, NOT FIRE-AND-FORGET. Measured live 2026-08-12: the status tool
// spoke the flagged sentence and the ledger stayed empty, because a promise
// scheduled after res.end() dies with the frozen lambda — a serverless
// runtime does not finish work nobody awaited. So this returns the write's
// own promise under a ceiling, and both callers await it BEFORE the sentence
// leaves the building. The ceiling keeps a slow ledger from slowing the read;
// the dedup means the cost is paid once per stall, not once per poll.
// ---------------------------------------------------------------------------
const flaggedStalls = new Set();

/** Ceiling on the flag write. Past it the read proceeds; the dedup entry is
 *  dropped so a later poll retries the write instead of never flagging. */
const FLAG_WRITE_MS = 3_000;

function resetStallFlags() {
  flaggedStalls.clear();
}

async function flagStalledEditJob({ jobId, attempt = 1, stage = "", stalledMs = null, siteSlug = "", source = "meter" } = {}, { recordEvent = defaultRecordEvent } = {}) {
  const id = String(jobId || "").trim();
  if (!id) return false;
  const key = `${id}#${attempt}`;
  if (flaggedStalls.has(key)) return false;
  if (flaggedStalls.size > 500) flaggedStalls.clear();
  flaggedStalls.add(key);
  const landed = await withCeiling(
    () => recordEvent("ghost_agency_site_edit_stalled", {
      jobId: id,
      attempt,
      stage: String(stage || ""),
      stalledMs: Number.isFinite(stalledMs) ? Math.round(stalledMs) : null,
      siteSlug: String(siteSlug || ""),
      source: String(source || "meter"),
    }).then(() => true),
    FLAG_WRITE_MS,
  );
  if (landed !== true) flaggedStalls.delete(key); // let a later poll retry
  return landed === true;
}

/**
 * describeEditProgress(row, { select, now }) -> meter (async)
 *
 * The one-call read side: measures history only when the job is still open —
 * terminal rows answer without touching the store at all.
 */
async function describeEditProgress(row, { select = defaultSelect, recordEvent = defaultRecordEvent, now = Date.now() } = {}) {
  const status = String((isPlainObject(row) && row.status) || "").toLowerCase();
  let shares = null;
  if (status === "queued" || status === "running") {
    const trail = trailOf(row);
    shares = await loadStageShares({ select, lane: trail ? trail.lane : "plan", now });
  }
  const meter = meterFromRow(row, shares, { now });
  // The sentence says "I've flagged it"; make that true before anyone reads
  // it. AWAITED — a write left dangling dies with the lambda (see the note on
  // flagStalledEditJob), and it is bounded + once-per-stall so the poll that
  // pays for it pays once.
  if (meter && meter.stalled === true) {
    await flagStalledEditJob({
      jobId: meter.jobId,
      attempt: meter.attempt,
      stage: meter.stage,
      stalledMs: meter.stalledMs,
      siteSlug: String((isPlainObject(row) && row.site_slug) || ""),
      source: "dashboard_meter",
    }, { recordEvent });
  }
  return meter;
}

/** editProgress(jobId, { select }) -> meter | { ok:false } — for callers that
 *  hold only the id. */
async function editProgress(jobId, { select = defaultSelect, now = Date.now() } = {}) {
  const id = String(jobId || "").trim();
  if (!id) return { ok: false, error: "jobId required" };
  let found = null;
  try {
    found = await select("ghost_agency_edit_jobs", `job_id=eq.${encodeURIComponent(id)}&limit=1`);
  } catch { found = null; }
  const row = found && found.ok === true && Array.isArray(found.data) ? found.data[0] : null;
  if (!row) return { ok: false, error: "job not found" };
  return describeEditProgress(row, { select, now });
}

module.exports = {
  LANES,
  STAGE_WORDS,
  MIN_HISTORY,
  SHARES_TTL_MS,
  STALLED_AFTER_MS,
  STALLED_RUNNING_WORDS,
  STALLED_QUEUED_WORDS,
  createStageTracker,
  nullTracker,
  trailOf,
  loadStageShares,
  meterFromRow,
  describeEditProgress,
  editProgress,
  flagStalledEditJob,
  remainingWords,
  resetSharesCache,
  resetStallFlags,
};
