"use strict";

// lib/report-grade.js — THE GRADE THE PROSPECT WILL SEE WHEN THEY CLICK.
//
// WHY THIS FILE EXISTS.
//
// The proof email prints a letter grade and a "SEE YOUR ROAD MAP" button that
// opens a Signal report. Until now the letter came out of OUR database
// (record.build_ready.qualification.composite_signal) while the page came out
// of CallPrep's. They are two different scorers, and they disagree:
//
//   business                       DB      PAGE    delta
//   Noble Plumbing                 C  76   C- 70   +6
//   JL Plumbing & Home Repair      D+ 68   D  64   +4
//   Goodson Plumbing Services      C+ 77   B  83   -6
//   Diamond State Plumbing         D+ 69   C  74   -5
//   Poor John's Plumbing           B  85   B  83   +2
//   Holt Plumbing Company          C- 72   C+ 78   -6
//   Rimrock Plumbing               C- 71   C+ 77   -6
//   North Side Plumbing & Heating  C  73   D+ 69   +4
//
// Measured 2026-08-07 over every row in the store that carries BOTH a real
// report id and a composite signal (8 rows — that is the whole population, not
// a sample). The SCORE disagrees on 8 of 8 and the LETTER on 7 of 8. Direction
// is symmetric — DB higher on 4, lower on 4, mean signed delta -0.88 points,
// mean absolute delta 4.88 — so this is not staleness, it is two scorers. On 6
// of the 8 rows the two timestamps are under 50ms apart: one pipeline run wrote
// both numbers and they still did not match.
//
// Per category it is worse: of 56 categories present on both sides, 43 disagree
// (77%), with gaps as violent as websitePerformance DB B/83 vs page F/39. And
// the two sides score DIFFERENT SETS: the DB scores `technology` on 8/8 rows
// where the page renders "NOT CAPTURED IN THIS REPORT VERSION" (0 of 20 live
// reports carry a technology category at all), which is how the email came to
// print "Site technology — C-, 70/100" about a row the linked page explicitly
// says it did not measure.
//
// An email that says C+ over a page that says B is a lie the reader catches
// with one click, and it is the kind of lie that ends the conversation. So the
// email now READS THE PAGE. This module is the reader.
//
// WHAT IT DOES NOT DO. It does not "reconcile", average, prefer, or fall back.
// There is exactly one source for the letter in the email — the same JSON the
// prospect's browser fetches — and if that source cannot be read the email says
// nothing about a grade at all. `record.build_ready.qualification` is no longer
// consulted by the outreach path; see lib/proof-email-inputs.js.
//
// THE TRANSPORT IS THE BROWSER'S. The report page issues exactly
//   GET <CALLPREP_SUPABASE_URL>/functions/v1/get-business-report?id=<uuid>
//   Authorization: Bearer <CALLPREP_SUPABASE_ANON_KEY>
// (verified by Playwright network capture on the live page). A bare request
// with no Authorization header is 401 — this endpoint is NOT public — and the
// `apikey` header alone is not enough. Reading it server-side with the same
// header returns byte-identical data to what the reader sees; the row is
// stored, not re-scanned on view (three reads 4s apart on three businesses
// returned identical grade, score and report_generated_at).

const { canonicalCallPrepReportUrl } = require("./callprep-client");
const { REPORT_UUID } = require("./report-url");

// ---------------------------------------------------------------------------
// THE LETTERS
// ---------------------------------------------------------------------------

/**
 * The rungs a Signal report can render. Deliberately a private copy of
 * lib/outreach-email-v3.js's GRADE_LADDER rather than an import: requiring the
 * composer here would drag in lib/email.js (the composer needs gradeBadgeColor)
 * and hand this module a half-initialised copy of the send path. The two lists
 * must stay identical, and test/report-grade.test.js asserts that they are.
 */
const REPORT_GRADE_LETTERS = Object.freeze([
  "F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+",
]);

/**
 * The score -> letter ladder the report page applies CLIENT-SIDE.
 *
 * It is needed because a category can carry a score and no letter: 5 of 20 live
 * reports have `categories.onlineReputation.score` with no `.grade`, and the
 * page derives the letter in the browser. Derived here from the reports
 * themselves — across all 20 reports, every headline and every category (39
 * distinct scores) the score->letter mapping is a pure function with zero
 * conflicts, and these are its breakpoints.
 *
 * A+ is absent on purpose: nothing in the observed population derives one, so
 * this never invents a rung the page would not print. A headline letter is
 * never derived at all — `overall_grade` is quoted literally.
 */
const SCORE_LADDER = Object.freeze([
  [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"],
  [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"],
]);

function letterForScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "";
  for (const [floor, letter] of SCORE_LADDER) if (score >= floor) return letter;
  return "F";
}

/**
 * The nine category keys a Signal report can render, with the label the page
 * prints above each one. A key that is NOT on this list is dropped rather than
 * quoted: lib/outreach-email-v3.js's CATEGORY_LABEL falls back to the raw key,
 * so an unrecognised schema addition would put `someNewKey — F, 20/100` in a
 * cold email. Omission is the safe direction for a category we cannot name.
 */
const REPORT_CATEGORY_LABEL = Object.freeze({
  googleBusinessProfile: "Google Profile",
  onlineReputation: "Online Reputation",
  socialMedia: "Social Media",
  websitePerformance: "Website Performance",
  seo: "SEO & Schema Health",
  security: "Website Security",
  geo: "AI Search Readiness",
  technology: "Technology & Infrastructure",
  businessIntelligence: "Business Intelligence",
});
const REPORT_CATEGORY_KEYS = Object.freeze(Object.keys(REPORT_CATEGORY_LABEL));

// ---------------------------------------------------------------------------
// THE PURE MAPPER
// ---------------------------------------------------------------------------

const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/**
 * reportGradeFacts(payload) -> { grade, score, categories } | null
 *
 * Pure. Takes the parsed body of get-business-report and returns only what the
 * page actually renders. `null` means "this report has no grade to quote", and
 * the caller must then say nothing at all.
 *
 * THE WORST FAILURE MODE OF THIS ENDPOINT IS A 200. Six of twenty live reports
 * answer 200 with `overall_grade: null`, `overall_score: 0` and no scored
 * category; rendered, the page shows an ellipsis where the letter goes and the
 * words "Analysis in progress — nothing has been scored yet." Treating that as
 * F/0 would tell a real business it failed a scan that never ran, so a null
 * letter or a non-positive score returns null here.
 *
 * FIELD PATHS ARE THE VERIFIED ONES, not the plausible ones:
 *
 *   data.overall_grade / data.overall_score
 *       The hero letter and the NN/100 beside it. `source_snapshot.overallGrade`
 *       and `.overallScore` mirror them but are ABSENT on 6 of 20 rows, so they
 *       are not read and are not a fallback.
 *
 *   data.source_snapshot.categories[key].score
 *       The page's "NOT CAPTURED IN THIS REPORT VERSION" predicate is exactly
 *       `!Number.isFinite(categories[key].score)` — verified against rendered
 *       DOM, 45 of 45 category cards. So a strictly finite NUMBER is the test
 *       here too. A numeric STRING is refused deliberately: Number.isFinite("83")
 *       is false, so the page would render that card as not captured, and the
 *       email must not cite a card the page blanks.
 *
 *       `data.data_availability` is NOT used for this. It disagreed with the
 *       rendered page on 3 of 4 checked cases — its keys are schema-version
 *       dependent (the rich schema carries both `gbp` and `googleBusinessProfile`,
 *       the degraded schema only the short names), so it reports "unavailable"
 *       for cards the page draws and vice versa. `data.technology_score` is null
 *       on 20 of 20 rows and is not read either.
 *
 *   data.source_snapshot.categories[key].grade
 *       Quoted when present and on the ladder; otherwise DERIVED from the score
 *       with the same breakpoints the page uses. Never invented from thin air —
 *       a category with no finite score has already been dropped above.
 */
function reportGradeFacts(payload) {
  const envelope = plainObject(payload);
  const data = plainObject(envelope && envelope.data);
  if (!data) return null;

  const grade = String(data.overall_grade == null ? "" : data.overall_grade).trim().toUpperCase();
  if (!REPORT_GRADE_LETTERS.includes(grade)) return null;

  const score = data.overall_score;
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0 || score > 100) return null;

  const snapshot = plainObject(data.source_snapshot);
  const raw = plainObject(snapshot && snapshot.categories) || {};
  const categories = {};
  for (const key of REPORT_CATEGORY_KEYS) {
    const cell = plainObject(raw[key]);
    if (!cell) continue;
    const cellScore = cell.score;
    // The NOT-CAPTURED predicate. Anything that is not a finite number in range
    // is a card the page blanks, and a blanked card is not evidence.
    if (typeof cellScore !== "number" || !Number.isFinite(cellScore)) continue;
    if (cellScore < 0 || cellScore > 100) continue;
    const letter = String(cell.grade == null ? "" : cell.grade).trim().toUpperCase();
    categories[key] = {
      grade: REPORT_GRADE_LETTERS.includes(letter) ? letter : letterForScore(cellScore),
      score: Math.round(cellScore),
    };
  }

  return { grade, score: Math.round(score), categories };
}

/** True only when a 200 payload identifies the exact row that was requested. */
function reportPayloadHasRow(payload, requestedId) {
  const envelope = plainObject(payload);
  const data = plainObject(envelope && envelope.data);
  const id = cleanString(data && data.id);
  return Boolean(id)
    && REPORT_UUID.test(id)
    && id.toLowerCase() === cleanString(requestedId).toLowerCase();
}

/**
 * The business identity carried by the exact report row.
 *
 * Both snake_case (the current endpoint) and camelCase (older fixtures and
 * stored payloads) are accepted. The immutable packet token and the closed
 * snapshot identity travel separately from optional grade facts, including on
 * valid ungraded rows. A non-scalar primary field cannot shadow a fallback.
 *
 * The website falls back to `source_snapshot.resolvedWebsiteUrl` — stamped by
 * the writer next to the packet token — so a read projection that serves the
 * snapshot verbatim but loses the top-level website columns (#595) still
 * yields the signed domain the identity verdict compares.
 */
function reportPayloadIdentity(payload) {
  const envelope = plainObject(payload);
  const data = plainObject(envelope && envelope.data);
  if (!data) return {
    businessName: "",
    businessUrl: "",
    packetId: "",
    snapshotBusinessName: "",
    city: "",
    state: "",
    industry: "",
  };
  const snapshot = plainObject(data.source_snapshot) || {};

  const firstString = (...values) => {
    for (const value of values) {
      const candidate = cleanString(value);
      if (candidate) return candidate;
    }
    return "";
  };

  return {
    businessName: firstString(data.business_name, data.businessName),
    businessUrl: firstString(
      data.business_url,
      data.businessUrl,
      data.website_url,
      data.websiteUrl,
      snapshot.resolvedWebsiteUrl,
    ),
    packetId: firstString(snapshot.packet_id, snapshot.packetId),
    snapshotBusinessName: firstString(snapshot.business_name, snapshot.businessName),
    city: firstString(snapshot.city),
    state: firstString(snapshot.state),
    industry: firstString(snapshot.industry, snapshot.industryLabel),
  };
}

// ---------------------------------------------------------------------------
// THE FETCH
// ---------------------------------------------------------------------------

/**
 * THE TIMEOUT, AND WHY IT IS 4000ms.
 *
 * Measured 2026-08-07: 60 sequential reads of 20 distinct live report ids, in
 * three passes.
 *
 *   pass   min   p50   p75   p90   p95   max
 *     1    106   223   242   367   379   379
 *     2    115   208   237   262   434   434
 *     3    143   225   250   292   310   310
 *
 * Warm: p50 ~220ms, p95 ~400ms, worst 434ms. But the FIRST pass of a cold
 * session hit 1634 / 1709 / 1825 / 2035 / 2065 / 3085ms on six ids — the edge
 * function cold-starts, and a send that happens to be the first one in an idle
 * hour pays that. A 1s budget would silently drop the grade off the first email
 * of every batch; a 3s budget would still have cut the worst observed cold
 * start (3085ms) by 3%.
 *
 * 4000ms is the worst measured cold start plus ~30% headroom, and ~10x the
 * warm p95, so on the normal path it is never reached. It is a CEILING, not a
 * cost: the typical send pays ~220ms once. There is no retry — a retry would
 * double the ceiling to buy a grade, and a missing grade is not worth delaying
 * a delivery for.
 */
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_TIMEOUT_MS = 10000;

/**
 * CACHE TTL. The report row is stored, not recomputed on read (proven: three
 * reads 4s apart returned identical grade, score and report_generated_at), so
 * within one run the same id cannot legitimately answer two different things.
 * Ten minutes caches a whole batch while guaranteeing that a long-lived warm
 * lambda re-reads a report that has since been regenerated.
 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

/** 8MB. A report is ~100KB; anything at this size is not a report. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const MODULE_CACHE = new Map();

function cleanString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

/** The uuid out of a link we have already proven is a real report link. */
function reportIdFromUrl(value) {
  const safe = canonicalCallPrepReportUrl(value);
  if (!safe) return "";
  let url;
  try { url = new URL(safe); } catch { return ""; }
  const match = /^\/report\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return "";
  const id = decodeURIComponent(match[1]);
  return REPORT_UUID.test(id) ? id : "";
}

/** The same call the page makes, built from the same two env values. */
function reportEndpoint(baseUrl, id) {
  const base = cleanString(baseUrl);
  if (!base || !id) return "";
  let url;
  try { url = new URL(base); } catch { return ""; }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/functions/v1/get-business-report`;
  url.search = `?id=${encodeURIComponent(id)}`;
  url.hash = "";
  return url.toString();
}

function boundedTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.round(parsed), MAX_TIMEOUT_MS);
}

/**
 * fetchReportFacts({...}) -> { ok, facts, identity, reason, cached, reportExists }
 *
 * NEVER THROWS, NEVER REJECTS. Every failure — unconfigured, unreachable,
 * timed out, 401, 403-with-an-HTML-body, 404, ungraded — returns
 * `{ ok: false, facts: null, reason }`. `reportExists` is true only for a valid
 * 200 row, false only for a definitive 404, and null when transport/auth cannot
 * prove either direction. The caller drops the grade card and sends the rest
 * of the email. `reason` is for gates, logs, and tests; nothing about a business
 * is ever derived from it.
 *
 * @param {string}  reportUrl the link the email will actually print. Put
 *                  through safeReportUrl first, so a build-slug link or a
 *                  foreign host never becomes a request.
 * @param {object}  env       CALLPREP_SUPABASE_URL + CALLPREP_SUPABASE_ANON_KEY,
 *                  both already present on the send path. No new variable, and
 *                  an absent one means no grade — which is the safe answer.
 * @param {function} fetch    injectable; defaults to the ambient fetch READ AT
 *                  CALL TIME so a test can stub globalThis.fetch.
 * @param {Map}     cache     injectable; defaults to the module-level cache.
 */
async function fetchReportFacts({
  reportUrl = "",
  env = process.env,
  fetch: fetchImpl = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cache = MODULE_CACHE,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
} = {}) {
  const fail = (reason, cached = false, reportExists = null, identity = null) => ({
    ok: false,
    facts: null,
    identity,
    reason,
    cached,
    reportExists,
  });

  const id = reportIdFromUrl(reportUrl);
  if (!id) return fail("no_report_id");

  const settings = env && typeof env === "object" ? env : {};
  const anonKey = cleanString(settings.CALLPREP_SUPABASE_ANON_KEY);
  const endpoint = reportEndpoint(settings.CALLPREP_SUPABASE_URL, id);
  if (!anonKey || !endpoint) return fail("callprep_not_configured");

  const nowMs = Number(typeof now === "function" ? now() : now);
  const clock = Number.isFinite(nowMs) ? nowMs : Date.now();
  const store = cache instanceof Map ? cache : null;
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;

  // KEY ON THE ENDPOINT, NOT THE ID. `env` is injectable, so a test or a
  // staging run pointed at a different CALLPREP_SUPABASE_URL would otherwise
  // read a cached answer minted from a DIFFERENT backend and print a grade
  // that came from somewhere the prospect's link does not go. The endpoint
  // already contains the id; the anon key is deliberately NOT in the key,
  // since it authenticates rather than selects.
  const key = endpoint;

  // CACHE HITS INCLUDE FAILURES. A report that answered 404 once will answer
  // 404 for every other compose in the same batch; re-asking would spend the
  // timeout budget again for the same nothing.
  if (store && store.has(key)) {
    const entry = store.get(key);
    if (entry && clock - entry.at < ttl) {
      return { ...entry.result, cached: true };
    }
    store.delete(key);
  }

  const remember = (result) => {
    if (store) {
      if (store.size >= MAX_CACHE_ENTRIES) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
      store.set(key, { at: clock, result: { ...result, cached: false } });
    }
    return result;
  };

  const doFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof doFetch !== "function") return fail("fetch_unavailable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    let response;
    try {
      // RACE THE SIGNAL, DO NOT MERELY PASS IT. Aborting a controller is a
      // REQUEST to the transport; a transport that ignores it leaves this
      // await pending forever, and the documented 4s ceiling becomes the
      // transport's promise rather than this module's guarantee. Measured: a
      // fetch that ignored the signal stalled the whole send past 12s, which
      // in a lambda is an invocation hung to its own timeout over a decorative
      // letter. undici honours the signal, so this is belt-and-braces today —
      // but the ceiling is ours to enforce, not to hope for.
      response = await Promise.race([
        doFetch(endpoint, {
          method: "GET",
          headers: { Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
          signal: controller.signal,
        }),
        new Promise((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        }),
      ]);
    } catch {
      // An abort and a DNS failure are both "no grade"; they are distinguished
      // only so a log can tell a slow report from a broken one.
      return remember(fail(controller.signal.aborted ? "timeout" : "fetch_failed"));
    }

    if (!response || typeof response.status !== "number") return remember(fail("invalid_response"));
    if (response.status !== 200) {
      return remember(fail(`http_${response.status}`, false, response.status === 404 ? false : null));
    }

    // READ AS TEXT, THEN PARSE. `id=' or 1=1--` returns 403 with a Cloudflare
    // HTML block page, and any WAF or proxy can put HTML behind a 200 too;
    // response.json() throws on those and an unguarded throw here would take
    // the whole send down with it.
    let body;
    try { body = await response.text(); } catch { return remember(fail("body_unreadable")); }
    if (typeof body !== "string" || body.length > MAX_BODY_BYTES) return remember(fail("body_unusable"));

    let payload;
    try { payload = JSON.parse(body); } catch { return remember(fail("invalid_json")); }

    const validRow = reportPayloadHasRow(payload, id);
    const reportExists = validRow ? true : null;
    const identity = validRow ? reportPayloadIdentity(payload) : null;
    if (!validRow) return remember(fail("report_identity_mismatch"));
    const facts = reportGradeFacts(payload);
    if (!facts) return remember(fail("no_report_grade", false, reportExists, identity));
    return remember({ ok: true, facts, identity, reason: "", cached: false, reportExists });
  } catch {
    // Belt and braces: nothing above is expected to throw, and a throw out of
    // this function would fail a send over a decorative letter.
    return fail("unexpected_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam, and an operational reset. */
function clearReportGradeCache(cache = MODULE_CACHE) {
  if (cache instanceof Map) cache.clear();
}

module.exports = {
  fetchReportFacts,
  reportGradeFacts,
  reportPayloadHasRow,
  reportPayloadIdentity,
  reportIdFromUrl,
  reportEndpoint,
  letterForScore,
  clearReportGradeCache,
  REPORT_GRADE_LETTERS,
  REPORT_CATEGORY_KEYS,
  REPORT_CATEGORY_LABEL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TTL_MS,
  MAX_CACHE_ENTRIES,
};
