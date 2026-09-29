"use strict";

// lib/edit-timing.js — the true number, or no number.
//
// THE DEFECT THIS CLOSES. Riley told a caller "give me about a minute and it'll
// be live" over an edit that took twelve. Nothing had measured anything; the
// sentence was invented at the moment it was said, and it was said BEFORE the
// system knew which kind of change it was looking at. A promise the system
// cannot keep is the same defect class as a fabricated fact — it just fails an
// hour later instead of immediately.
//
// api/vapi-tools/site-edit.js already removed the invented duration and now
// says nothing at all ("Some go through quicker than others and I'd rather not
// guess at you"). That was the right emergency fix. It is not the answer,
// because the caller genuinely wants to know whether to hold the line or hang
// up, and we DO have the data to tell them.
//
// ── WHAT WAS ACTUALLY MEASURED (production, 2026-08-12) ─────────────────────
//
// 145 rows in ghost_agency_edit_jobs; 136 after dropping probe/self-test slugs.
//
//   done      75   p50  19.7s   p90  130.1s   p95 725s
//   refused   32   p50   8.5s   p90   11.7s
//   failed    28   p50 244.9s   p90 (tail runs to days — swept, not run)
//
//   done / terminal = 75 / 135 = 56%.
//
// Two things fall out of that, and both change what may be said out loud:
//
//   1. THE SPREAD IS THE STORY. p50 19.7s and p90 130.1s is a 6.6x spread.
//      Quoting the median means being wrong, long, for one request in two —
//      which is exactly how "about a minute" was born. So the spoken number is
//      always the p90 and always phrased as a BOUND ("most of these are live
//      inside N"), never a point estimate.
//
//   2. A DURATION ALONE IS A LIE BY OMISSION. 44% of terminal jobs never
//      reached done. Quoting "two minutes", conditioned silently on success,
//      tells a man his change is coming when there is a two-in-five chance it
//      is not. So a quote carries the landing rate whenever it is poor, in the
//      same breath, or it does not go out.
//
// ── WHICH CLOCK ────────────────────────────────────────────────────────────
// created_at -> updated_at, the span the CUSTOMER experiences: queue wait,
// retries and all. result.timings.total_s is the engine's own working time
// (28.1s on a job whose row spanned 228.8s because the sweeper re-ran it) and
// it is the wrong number to speak: nobody asked how long the second attempt
// took. The engine number is still returned in `basis` for engineering.
//
// ── HOW THE BUCKET IS CHOSEN ───────────────────────────────────────────────
// From the INSTRUCTION, via lib/riley-capabilities.js classifyRequest — the
// same function that decides whether the verb exists at all. It has to be the
// instruction and not the executed ops, because the quote is needed BEFORE the
// plan exists. History is bucketed by running that same classifier over each
// historical row's instruction, so the prediction and the measurement are the
// same function applied to the same kind of string. No second taxonomy.

const { select: defaultSelect } = require("./store");
const { classifyRequest } = require("./riley-capabilities");
const { parseEditInstruction } = require("./customer-uploads");

/** Terminal states. `cancelled` is an operator action, not an outcome. */
const TERMINAL = Object.freeze(["done", "refused", "failed"]);

/**
 * Fewest completed jobs of a kind before a number may be spoken. Five is the
 * point at which a p90 stops being "the slowest of the three I have seen".
 * Below it the honest answer is a sentence with no number in it.
 */
const MIN_SAMPLES = 5;

/** How far back history counts. Long enough for thin buckets to fill, short
 *  enough that a fix to the engine shows up in what Riley says. */
const WINDOW_DAYS = 45;

/** Rows read per measurement pass. */
const HISTORY_LIMIT = 400;

/**
 * A row whose span exceeds this did not take that long to RUN — it sat unrun
 * until a sweeper or a later write touched it (measured: one row spanning 14
 * days, another 15). Including them would move a p90 by orders of magnitude on
 * the strength of a bookkeeping artifact. They are dropped from the durations
 * AND counted in `basis.discarded`, because a silently dropped sample is how a
 * measurement becomes an opinion.
 */
const IMPLAUSIBLE_SPAN_MS = 60 * 60 * 1000;

/** Re-measure at most this often per lambda. */
const STATS_TTL_MS = 5 * 60 * 1000;

/** Probe and self-test rows are not customer experience. */
const PROBE_RE = /(probe|smoke|self-?test|__test|verification)/i;

/** Below this landing rate the quote must carry the caveat out loud. */
const SHAKY_LANDING_RATE = 0.85;

/** Below THIS, "most changes like that are live inside N" is not a caveat
 *  short of the truth — it is false, because most of them are not live at all.
 *  Measured 2026-08-12: the image bucket lands 12%. No duration is spoken. */
const POOR_LANDING_RATE = 0.4;

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function spanMs(row) {
  const a = Date.parse(String(row && row.created_at) || "");
  const b = Date.parse(String(row && row.updated_at) || "");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = b - a;
  return d >= 0 ? d : null;
}

/** The customer's own words, with any attachment block stripped back off, so a
 *  photo request is classified on what they asked for and not on our footer. */
function instructionText(row) {
  const { message } = parseEditInstruction(row && row.instruction);
  return message || String((row && row.instruction) || "");
}

function isProbeRow(row) {
  return PROBE_RE.test(String((row && row.job_id) || "")) || PROBE_RE.test(String((row && row.site_slug) || ""));
}

/** The bucket a row belongs to. Unsupported requests still get a bucket —
 *  "unsupported" — because refusals have durations too and a caller asking for
 *  something we cannot do still deserves to know how long the answer takes. */
function bucketOf(instruction) {
  const hit = classifyRequest(instruction);
  return hit.supported ? hit.family : "unsupported";
}

/**
 * summarize(rows, { now }) -> { window_days, buckets: { [family]: stat }, overall: stat }
 *
 * stat = {
 *   family, terminal, done, landed_rate,
 *   done_p50_ms, done_p90_ms, done_max_ms,
 *   refused_p90_ms | null, discarded,
 *   engine_p50_ms | null      // result.timings.total_s, engineering only
 * }
 *
 * Pure and synchronous so a test can hand it a fixture and pin every number.
 */
function summarize(rows, { now = Date.now(), windowDays = WINDOW_DAYS } = {}) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const buckets = new Map();
  const ensure = (family) => {
    if (!buckets.has(family)) {
      buckets.set(family, { family, terminal: 0, done: 0, doneMs: [], refusedMs: [], engineMs: [], discarded: 0 });
    }
    return buckets.get(family);
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isPlainObject(row)) continue;
    if (isProbeRow(row)) continue;
    const status = String(row.status || "").toLowerCase();
    if (!TERMINAL.includes(status)) continue;
    const created = Date.parse(String(row.created_at || ""));
    if (!Number.isFinite(created) || created < cutoff) continue;

    const family = bucketOf(instructionText(row));
    for (const target of [ensure(family), ensure("__all__")]) {
      target.terminal += 1;
      if (status === "done") target.done += 1;
      const span = spanMs(row);
      if (span == null) continue;
      if (span > IMPLAUSIBLE_SPAN_MS) { target.discarded += 1; continue; }
      if (status === "done") target.doneMs.push(span);
      else if (status === "refused") target.refusedMs.push(span);
      const engine = Number(isPlainObject(row.result) && isPlainObject(row.result.timings) ? row.result.timings.total_s : NaN);
      if (status === "done" && Number.isFinite(engine) && engine > 0) target.engineMs.push(Math.round(engine * 1000));
    }
  }

  const shape = (raw) => {
    const done = raw.doneMs.slice().sort((a, b) => a - b);
    const refused = raw.refusedMs.slice().sort((a, b) => a - b);
    const engine = raw.engineMs.slice().sort((a, b) => a - b);
    return {
      family: raw.family,
      terminal: raw.terminal,
      done: raw.done,
      landed_rate: raw.terminal ? raw.done / raw.terminal : null,
      samples: done.length,
      done_p50_ms: percentile(done, 50),
      done_p90_ms: percentile(done, 90),
      done_max_ms: percentile(done, 100),
      refused_p90_ms: percentile(refused, 90),
      engine_p50_ms: percentile(engine, 50),
      discarded: raw.discarded,
    };
  };

  const out = { window_days: windowDays, measured_at: new Date(now).toISOString(), buckets: {}, overall: null };
  for (const [family, raw] of buckets) {
    if (family === "__all__") out.overall = { ...shape(raw), family: "overall" };
    else out.buckets[family] = shape(raw);
  }
  if (!out.overall) out.overall = { family: "overall", terminal: 0, done: 0, landed_rate: null, samples: 0, done_p50_ms: null, done_p90_ms: null, done_max_ms: null, refused_p90_ms: null, engine_p50_ms: null, discarded: 0 };
  return out;
}

/** Per-lambda cache; a cold instance simply re-measures. */
let statsCache = null;

function resetTimingCache() {
  statsCache = null;
}

/**
 * loadEditTimings({ select, now }) -> summary | null
 *
 * null means the read failed. It does NOT mean "no history" — an unreadable
 * table and an empty one produce different sentences, and collapsing them is
 * how a customer gets told there is nothing there.
 */
async function loadEditTimings({ select = defaultSelect, now = Date.now(), windowDays = WINDOW_DAYS } = {}) {
  if (statsCache && now - statsCache.at < STATS_TTL_MS) return statsCache.summary;
  let found = null;
  try {
    found = await select("ghost_agency_edit_jobs", `order=created_at.desc&limit=${HISTORY_LIMIT}`);
  } catch {
    found = null;
  }
  if (!found || found.ok !== true || !Array.isArray(found.data)) return null;
  const summary = summarize(found.data, { now, windowDays });
  statsCache = { at: now, summary };
  return summary;
}

/** "under a minute" / "about three minutes" — spoken, rounded UP, never down.
 *  Rounding a bound down is how a bound becomes a broken promise. */
function boundWords(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const s = ms / 1000;
  if (s <= 30) return "half a minute";
  if (s <= 60) return "a minute";
  if (s <= 120) return "a couple of minutes";
  const minutes = Math.ceil(s / 60);
  if (minutes <= 5) return `${["", "one", "two", "three", "four", "five"][minutes]} minutes`;
  if (minutes <= 10) return "ten minutes";
  if (minutes <= 20) return "twenty minutes";
  return "half an hour";
}

/**
 * quoteFor({ instruction, summary }) -> { say, number_spoken, basis }
 *
 * THE RULES, all of which exist because one of them was broken on a live call:
 *
 *   · No history read  -> no number. ("I won't guess at you.")
 *   · Fewer than MIN_SAMPLES completed jobs of this kind -> no number.
 *   · Otherwise the p90, spoken as a ceiling, never the median.
 *   · Landing rate under SHAKY_LANDING_RATE -> the sentence carries the caveat
 *     in the same breath as the number.
 *   · Landing rate under POOR_LANDING_RATE -> NO number at all. "Most changes
 *     like that are live inside N" is not a soft claim when most of them never
 *     go live; it is a false one.
 *
 * `basis` carries every input to the sentence. A spoken number whose derivation
 * cannot be printed is indistinguishable from an invented one.
 */
function quoteFor({ instruction, summary } = {}) {
  const family = bucketOf(instruction);
  const noNumber = (say, why) => ({
    say,
    number_spoken: false,
    basis: { family, why, samples: 0, min_samples: MIN_SAMPLES },
  });

  if (!summary) {
    return noNumber(
      "That's running now. I can't tell you how long this one takes and I'm not going to guess at you — stay with me and I'll tell you the moment it's live.",
      "history_unreadable",
    );
  }
  const stat = summary.buckets[family] || null;
  const fallback = summary.overall;
  const use = stat && stat.samples >= MIN_SAMPLES ? stat : (fallback && fallback.samples >= MIN_SAMPLES ? fallback : null);
  if (!use || use.done_p90_ms == null) {
    return noNumber(
      "That's running now. I haven't done enough of this kind to tell you how long it takes, so I won't put a time on it — stay with me and I'll tell you the moment it's live.",
      stat ? "too_few_samples" : "no_bucket",
    );
  }

  // ── THE TWO NUMBERS HAVE DIFFERENT EVIDENCE, SO THEY GET DIFFERENT SOURCES ──
  //
  // A DURATION needs completed jobs; a LANDING RATE only needs jobs that
  // finished, whatever way they finished. Bucketing them together silently
  // hides the worse fact. Measured on production 2026-08-12, the image bucket:
  //
  //     image   17 terminal, 2 done  ->  12% landed
  //     overall 135 terminal, 75 done -> 56% landed
  //
  // With two completed jobs, the image bucket cannot supply a p90, so the quote
  // borrows the overall duration — and the first version borrowed the overall
  // LANDING RATE with it. That would have told a customer asking for a photo
  // swap that changes like theirs land better than one in two, when the measured
  // answer for that exact request is roughly one in eight.
  //
  // So the rate comes from the request's OWN bucket whenever that bucket has
  // enough finished jobs to know, even when the duration had to be borrowed.
  const rateStat = stat && stat.terminal >= MIN_SAMPLES ? stat : use;
  const bound = boundWords(use.done_p90_ms);
  const shaky = rateStat.landed_rate != null && rateStat.landed_rate < SHAKY_LANDING_RATE;
  const basis = {
    family,
    measured_as: use.family,
    rate_measured_as: rateStat.family,
    why: "measured",
    samples: use.samples,
    min_samples: MIN_SAMPLES,
    window_days: summary.window_days,
    p50_ms: use.done_p50_ms,
    p90_ms: use.done_p90_ms,
    max_ms: use.done_max_ms,
    engine_p50_ms: use.engine_p50_ms,
    landed_rate: rateStat.landed_rate,
    terminal: rateStat.terminal,
    done: rateStat.done,
    discarded: use.discarded,
    quoted: "p90",
  };

  // ── THREE SENTENCES, BECAUSE THERE ARE THREE TRUTHS ────────────────────────
  //
  // The caveat is not decoration. 44% of terminal jobs measured never reached
  // done, and one bucket (image) lands 12% of the time. A duration spoken
  // without that is a promise with a hole in it — and below POOR_LANDING_RATE
  // the phrase "most changes like that are live inside N" is simply FALSE,
  // because most of them are not live at all. That case gets no headline
  // duration; it gets the truth and an offer to stay on the line.
  const poor = rateStat.landed_rate != null && rateStat.landed_rate < POOR_LANDING_RATE;
  const say = poor
    ? "I'll be straight with you — changes like that don't go through as often as they should. I'm starting it now and I'll stay with you and tell you either way, rather than put a time on it."
    : shaky
      ? `Most changes like that are live inside ${bound}. Some don't take on the first go, so I'll check it before we hang up rather than leave you guessing.`
      : `Most changes like that are live inside ${bound}. I'll tell you the moment it's through.`;

  return { say, number_spoken: !poor, basis: { ...basis, ...(poor ? { quoted: "none_poor_landing_rate" } : {}) } };
}

/**
 * describeEditTiming({ instruction, select, now }) -> quote (async)
 * The one call a tool endpoint needs.
 */
async function describeEditTiming({ instruction, select = defaultSelect, now = Date.now(), windowDays = WINDOW_DAYS } = {}) {
  const summary = await loadEditTimings({ select, now, windowDays });
  return quoteFor({ instruction, summary });
}

module.exports = {
  MIN_SAMPLES,
  WINDOW_DAYS,
  HISTORY_LIMIT,
  IMPLAUSIBLE_SPAN_MS,
  SHAKY_LANDING_RATE,
  POOR_LANDING_RATE,
  TERMINAL,
  bucketOf,
  summarize,
  loadEditTimings,
  quoteFor,
  describeEditTiming,
  boundWords,
  resetTimingCache,
};
