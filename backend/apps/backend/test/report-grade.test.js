"use strict";

// ---------------------------------------------------------------------------
// test/report-grade.test.js — THE EMAIL MUST QUOTE THE PAGE IT LINKS TO.
//
// The proof email prints a letter grade next to a button that opens a Signal
// report. Those were two different scorers. Measured 2026-08-07 across every
// row in the store carrying both a real report id and a composite signal (8
// rows — the entire population, not a sample):
//
//   business                       DB      PAGE
//   Noble Plumbing                 C  76   C- 70
//   JL Plumbing & Home Repair      D+ 68   D  64
//   Goodson Plumbing Services      C+ 77   B  83
//   Diamond State Plumbing         D+ 69   C  74
//   Poor John's Plumbing           B  85   B  83
//   Holt Plumbing Company          C- 72   C+ 78
//   Rimrock Plumbing               C- 71   C+ 77
//   North Side Plumbing & Heating  C  73   D+ 69
//
// Score disagrees 8/8, letter 7/8. Per category, 43 of 56 disagree. And the two
// sides score different SETS: the DB scores `technology` on 8/8 rows where the
// page prints "NOT CAPTURED IN THIS REPORT VERSION", which is how "Site
// technology — C-, 70/100" ended up in an email about a card the page blanks.
//
// What these tests hold shut:
//
//   1. The mapper reads the VERIFIED field paths and nothing else.
//   2. NOT CAPTURED is decided by the page's own predicate, and a blanked
//      category is never cited as a failing.
//   3. Every failure of the fetch — unconfigured, 401, 403-with-HTML, 404,
//      ungraded 200, timeout, garbage — yields NO grade, never a fallback, and
//      never a throw that could fail a send.
//   4. The cache serves a second compose of the same report without a second
//      request, and does not leak across ids.
//   5. End to end through sendSequenceStep: the letter in the delivered email
//      is the page's letter, and the database's letter appears nowhere.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const {
  fetchReportFacts,
  reportGradeFacts,
  reportIdFromUrl,
  reportEndpoint,
  letterForScore,
  clearReportGradeCache,
  REPORT_GRADE_LETTERS,
  REPORT_CATEGORY_KEYS,
  DEFAULT_TIMEOUT_MS,
  MAX_CACHE_ENTRIES,
} = require("../lib/report-grade");
const { GRADE_LADDER } = require("../lib/outreach-email-v3");

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
  clearReportGradeCache();
});

const REPORT_ID = "3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
const REPORT_URL = `https://callprep.wss-ai.com/report/${REPORT_ID}`;
const OTHER_ID = "aa11bb22-cc33-dd44-ee55-ff6677889900";
const OTHER_URL = `https://callprep.wss-ai.com/report/${OTHER_ID}`;

const ENV = Object.freeze({
  CALLPREP_SUPABASE_URL: "https://qjiszykrgqdwlvooicvk.supabase.co",
  CALLPREP_SUPABASE_ANON_KEY: "anon-jwt-for-tests",
});

/**
 * The real shape of a scored report, reduced to the fields that matter. Modeled
 * on Goodson Plumbing Services: page B/83 where our database says C+/77.
 */
function reportPayload(overrides = {}, categoryOverrides = null) {
  return {
    data: {
      id: REPORT_ID,
      business_name: "Goodson Plumbing Services",
      business_url: "https://goodsonplumbing.example/",
      overall_grade: "B",
      overall_score: 83,
      technology_score: null,
      data_availability: { gbp: true, social: true, website: true },
      source_snapshot: {
        packet_id: `wss-genie-cert-v1:${"a".repeat(64)}`,
        business_name: "Goodson Plumbing Services",
        city: "Austin",
        state: "TX",
        industry: "Plumbing",
        categories: categoryOverrides || {
          geo: { grade: "B", score: 83 },
          seo: { grade: "B+", score: 89 },
          security: { grade: "B", score: 83 },
          socialMedia: { grade: "D-", score: 60 },
          onlineReputation: { grade: "B+", score: 87 },
          websitePerformance: { grade: "C+", score: 78 },
          googleBusinessProfile: { grade: "B+", score: 89 },
        },
      },
      ...overrides,
    },
  };
}

/** A fetch stub that records every call and answers from a script. */
function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, text: async () => text };
}

// ===========================================================================
// 1. THE PURE MAPPER — VERIFIED FIELD PATHS ONLY
// ===========================================================================

test("the headline letter and score are read from data.overall_*, verbatim", () => {
  const facts = reportGradeFacts(reportPayload());
  assert.equal(facts.grade, "B");
  assert.equal(facts.score, 83);
});

test("source_snapshot.overallGrade is NOT a fallback — it is absent on 6 of 20 rows", () => {
  // A row whose snapshot mirrors disagree must still answer with data.overall_*.
  const payload = reportPayload();
  payload.data.source_snapshot.overallGrade = "A";
  payload.data.source_snapshot.overallScore = 97;
  assert.equal(reportGradeFacts(payload).grade, "B");
  assert.equal(reportGradeFacts(payload).score, 83);

  // ...and a row with ONLY the mirrors has no headline at all.
  const mirrorOnly = reportPayload();
  delete mirrorOnly.data.overall_grade;
  delete mirrorOnly.data.overall_score;
  mirrorOnly.data.source_snapshot.overallGrade = "A";
  mirrorOnly.data.source_snapshot.overallScore = 97;
  assert.equal(reportGradeFacts(mirrorOnly), null);
});

test("an ungraded report is not an F — 6 of 20 live reports answer 200 with nothing scored", () => {
  // Punchys Mobile Detailing renders "Analysis in progress — nothing has been
  // scored yet." Reading that as F/0 would tell a real business it failed a
  // scan that never ran.
  const idle = reportPayload({ overall_grade: null, overall_score: 0 }, {
    onlineReputation: {}, googleBusinessProfile: {},
  });
  assert.equal(reportGradeFacts(idle), null);

  for (const [grade, score] of [
    [null, 0], ["", 83], ["  ", 83], ["Z", 83], ["B", 0], ["B", -1], ["B", 101],
    ["B", null], ["B", "83"], ["B", NaN], ["B", undefined], [undefined, undefined],
  ]) {
    const payload = reportPayload({ overall_grade: grade, overall_score: score });
    assert.equal(
      reportGradeFacts(payload), null,
      `accepted grade=${JSON.stringify(grade)} score=${JSON.stringify(score)}`,
    );
  }
});

test("a malformed body is null, never a partial fact", () => {
  for (const junk of [
    null, undefined, "", "not json", 0, [], [{ data: { overall_grade: "B" } }],
    {}, { data: null }, { data: "B" }, { data: [] }, { overall_grade: "B", overall_score: 83 },
  ]) {
    assert.equal(reportGradeFacts(junk), null, `accepted ${JSON.stringify(junk)}`);
  }
});

test("every letter the mapper can emit is a rung the composer will print", () => {
  // Two independent whitelists, one truth. If they drift, an email prints a
  // letter the report cannot render, or the composer silently drops a real one.
  assert.deepEqual([...REPORT_GRADE_LETTERS], [...GRADE_LADDER]);
});

test("the derived letter is the page's own ladder, at every breakpoint", () => {
  // 5 of 20 live reports carry a category score with no grade and the page
  // derives the letter client-side. These breakpoints are read back off all 20
  // reports: 39 distinct scores, zero conflicts.
  const expected = [
    [100, "A"], [93, "A"], [92, "A-"], [90, "A-"], [89, "B+"], [87, "B+"],
    [86, "B"], [83, "B"], [82, "B-"], [80, "B-"], [79, "C+"], [77, "C+"],
    [76, "C"], [73, "C"], [72, "C-"], [70, "C-"], [69, "D+"], [67, "D+"],
    [66, "D"], [63, "D"], [62, "D-"], [60, "D-"], [59, "F"], [31, "F"], [0, "F"],
  ];
  for (const [score, letter] of expected) {
    assert.equal(letterForScore(score), letter, `score ${score}`);
  }
  // Never derives A+ — nothing in the observed population produces one, and
  // inventing a top rung would be a claim the page never makes.
  assert.ok(!expected.some(([, letter]) => letter === "A+"));
  for (const junk of ["83", null, undefined, NaN, Infinity, {}, []]) {
    assert.equal(letterForScore(junk), "", `derived a letter from ${JSON.stringify(junk)}`);
  }
});

test("a category with a score and no grade gets the page's derived letter", () => {
  const facts = reportGradeFacts(reportPayload({}, {
    onlineReputation: { score: 88 },            // Urban Nail Bar: score, no grade
    socialMedia: { grade: "D-", score: 60 },    // grade present, quoted
    seo: { grade: "banana", score: 74 },        // grade off-ladder, derived
  }));
  assert.equal(facts.categories.onlineReputation.grade, "B+");
  assert.equal(facts.categories.socialMedia.grade, "D-");
  assert.equal(facts.categories.seo.grade, "C");
});

// ===========================================================================
// 2. "NOT CAPTURED IN THIS REPORT VERSION"
// ===========================================================================

test("the not-captured predicate is the page's own: !Number.isFinite(score)", () => {
  const facts = reportGradeFacts(reportPayload({}, {
    socialMedia: { grade: "D-", score: 60 },     // captured
    googleBusinessProfile: { grade: "B+" },      // key present, NO score
    onlineReputation: { score: null },
    seo: { score: "89" },                        // a numeric STRING is not finite
    security: { score: NaN },
    geo: {},
    websitePerformance: { score: 101 },          // out of range
  }));
  assert.deepEqual(Object.keys(facts.categories), ["socialMedia"]);
  assert.equal(facts.categories.socialMedia.score, 60);
});

test("technology is never quoted, because no live report renders it", () => {
  // 0 of 20 live reports carry a technology category; the page shows NOT
  // CAPTURED. Our database scores it on 8 of 8 rows. This is the Poor John's
  // defect: "Site technology — C-, 70/100" over a page that says it never
  // measured it.
  const facts = reportGradeFacts(reportPayload());
  assert.ok(!("technology" in facts.categories));
});

test("data_availability is never consulted — it disagreed with the page 3 times in 4", () => {
  // Its keys are schema-version dependent: the degraded schema carries only
  // `gbp`/`social`/`website`, so data_availability.googleBusinessProfile is
  // undefined on a page that draws the card, and vice versa.
  const facts = reportGradeFacts(reportPayload({
    data_availability: { googleBusinessProfile: false, socialMedia: false, seo: false },
  }));
  assert.equal(facts.categories.googleBusinessProfile.score, 89);
  assert.equal(facts.categories.socialMedia.score, 60);
  assert.equal(facts.categories.seo.score, 89);
});

test("an unrecognised category key is dropped rather than printed raw", () => {
  // composeOutreachEmailV3's CATEGORY_LABEL falls back to the raw key, so a
  // schema addition we have no plain name for would put "someNewKey — F,
  // 20/100" in a cold email.
  const facts = reportGradeFacts(reportPayload({}, {
    socialMedia: { grade: "D-", score: 60 },
    someNewKey: { grade: "F", score: 20 },
    __proto__x: { grade: "F", score: 1 },
  }));
  assert.deepEqual(Object.keys(facts.categories), ["socialMedia"]);
});

test("every key the mapper can emit has a plain-English label in the composer", () => {
  // `businessIntelligence` had no entry and 7 of 20 live reports carry it.
  const { CATEGORY_LABEL } = require("../lib/outreach-email-v3");
  for (const key of REPORT_CATEGORY_KEYS) {
    assert.ok(
      CATEGORY_LABEL && typeof CATEGORY_LABEL[key] === "string" && CATEGORY_LABEL[key].trim(),
      `${key} would render as a raw key in a cold email`,
    );
  }
});

// ===========================================================================
// 3. THE FETCH — LINKS, ENDPOINT, HEADERS
// ===========================================================================

test("only a real report link becomes a request", () => {
  assert.equal(reportIdFromUrl(REPORT_URL), REPORT_ID);
  for (const dead of [
    "", null, undefined,
    "https://callprep.wss-ai.com/report/harbor-ridge-roofing",   // a build slug
    "https://siteforge-app-seven.vercel.app/try/x/scorecard.json",
    `https://evil.example.test/report/${REPORT_ID}`,             // foreign host
    `http://callprep.wss-ai.com/report/${REPORT_ID}`,            // not https
    `https://callprep.wss-ai.com:444/report/${REPORT_ID}`,        // wrong origin
    `https://user:pw@callprep.wss-ai.com/report/${REPORT_ID}`,    // embedded credentials
    `https://callprep.wss-ai.com/report/${REPORT_ID}?preview=1`,  // query changes identity
    `https://callprep.wss-ai.com/report/${REPORT_ID}#preview`,    // fragment changes identity
    `https://preview.wss-ai.com/report/${REPORT_ID}`,             // wrong subdomain
    "https://callprep.wss-ai.com/report/",
  ]) {
    assert.equal(reportIdFromUrl(dead), "", `accepted ${JSON.stringify(dead)}`);
  }
});

test("the endpoint is the exact call the prospect's own browser makes", async () => {
  const impl = stubFetch(() => jsonResponse(reportPayload()));
  const result = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });
  assert.equal(result.ok, true);
  assert.equal(result.reportExists, true);
  assert.deepEqual(result.identity, {
    businessName: "Goodson Plumbing Services",
    businessUrl: "https://goodsonplumbing.example/",
    packetId: `wss-genie-cert-v1:${"a".repeat(64)}`,
    snapshotBusinessName: "Goodson Plumbing Services",
    city: "Austin",
    state: "TX",
    industry: "Plumbing",
  });
  assert.equal(impl.calls.length, 1);
  assert.equal(
    impl.calls[0].url,
    `https://qjiszykrgqdwlvooicvk.supabase.co/functions/v1/get-business-report?id=${REPORT_ID}`,
  );
  assert.equal(impl.calls[0].init.method, "GET");
  // A bare request is 401 and `apikey` alone is not enough — the Bearer header
  // is what the page sends and what the function requires.
  assert.equal(impl.calls[0].init.headers.Authorization, `Bearer ${ENV.CALLPREP_SUPABASE_ANON_KEY}`);
  assert.ok(impl.calls[0].init.signal, "the request must be abortable");

  // The builder itself, in isolation: a trailing slash or a path on the base
  // must not produce a double slash or a lost segment.
  assert.equal(
    reportEndpoint("https://x.supabase.co/", REPORT_ID),
    `https://x.supabase.co/functions/v1/get-business-report?id=${REPORT_ID}`,
  );
  assert.equal(reportEndpoint("https://x.supabase.co", ""), "");
  assert.equal(reportEndpoint("", REPORT_ID), "");
});

test("a non-https or malformed supabase url yields no request and no grade", async () => {
  for (const base of ["", "   ", "http://x.supabase.co", "not a url", "https://user:pw@x.supabase.co"]) {
    const impl = stubFetch(() => jsonResponse(reportPayload()));
    const result = await fetchReportFacts({
      reportUrl: REPORT_URL, env: { ...ENV, CALLPREP_SUPABASE_URL: base }, fetch: impl,
    });
    assert.equal(result.facts, null, `fetched against ${JSON.stringify(base)}`);
    assert.equal(result.reason, "callprep_not_configured");
    assert.equal(impl.calls.length, 0);
  }
});

test("an absent credential means no grade, not an unauthenticated request", async () => {
  const impl = stubFetch(() => jsonResponse(reportPayload()));
  const result = await fetchReportFacts({
    reportUrl: REPORT_URL, env: { CALLPREP_SUPABASE_URL: ENV.CALLPREP_SUPABASE_URL }, fetch: impl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.facts, null);
  assert.equal(result.reason, "callprep_not_configured");
  assert.equal(impl.calls.length, 0, "issued a request that would 401");
});

// ===========================================================================
// 4. FAIL CLOSED — EVERY FAILURE MODE
// ===========================================================================

test("every documented failure status yields no grade and no throw", async () => {
  const cases = [
    [401, JSON.stringify({ error: "Unauthorized" }), "http_401"],
    [400, JSON.stringify({ error: "Report ID is required" }), "http_400"],
    [400, JSON.stringify({ error: "Invalid report ID format" }), "http_400"],
    [404, JSON.stringify({ error: "Report not found" }), "http_404"],
    [500, "", "http_500"],
    [302, "", "http_302"],
  ];
  for (const [status, body, reason] of cases) {
    clearReportGradeCache();
    const result = await fetchReportFacts({
      reportUrl: REPORT_URL, env: ENV, fetch: stubFetch(() => jsonResponse(body, status)),
    });
    assert.equal(result.ok, false);
    assert.equal(result.facts, null);
    assert.equal(result.reason, reason);
    assert.equal(result.reportExists, status === 404 ? false : null);
  }
});

test("a 403 Cloudflare HTML block page is guarded, not JSON.parse'd into a crash", async () => {
  // `id=' or 1=1--` answers 403 with an HTML block page. JSON.parse throws on
  // it, and an unguarded throw here would take down a send over a letter.
  const html = "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>";
  for (const [status, body] of [[403, html], [200, html], [200, ""], [200, "not json at all"]]) {
    clearReportGradeCache();
    let result;
    await assert.doesNotReject(async () => {
      result = await fetchReportFacts({
        reportUrl: REPORT_URL, env: ENV, fetch: stubFetch(() => jsonResponse(body, status)),
      });
    });
    assert.equal(result.facts, null);
    assert.ok(["http_403", "invalid_json"].includes(result.reason), result.reason);
  }
});

test("a timeout drops the grade and never rejects", async () => {
  // A fetch that honours the abort signal, exactly as the platform one does.
  const hang = stubFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));
  const started = Date.now();
  let result;
  await assert.doesNotReject(async () => {
    result = await fetchReportFacts({
      reportUrl: REPORT_URL, env: ENV, fetch: hang, timeoutMs: 40,
    });
  });
  assert.equal(result.ok, false);
  assert.equal(result.facts, null);
  assert.equal(result.reason, "timeout");
  // It really is bounded — it did not wait for the default ceiling.
  assert.ok(Date.now() - started < DEFAULT_TIMEOUT_MS, "the timeout did not bound the wait");
});

test("a fetch that throws, or is missing entirely, is a dropped grade — not a failed send", async () => {
  const thrower = stubFetch(() => { throw new Error("ECONNREFUSED"); });
  const threw = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: thrower });
  assert.equal(threw.facts, null);
  assert.equal(threw.reason, "fetch_failed");

  clearReportGradeCache();
  const rejecter = stubFetch(async () => { throw new TypeError("fetch failed"); });
  const rejected = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: rejecter });
  assert.equal(rejected.facts, null);
  assert.equal(rejected.reason, "fetch_failed");

  clearReportGradeCache();
  const noBody = await fetchReportFacts({
    reportUrl: REPORT_URL, env: ENV, fetch: stubFetch(async () => ({ status: 200, text: async () => { throw new Error("stream closed"); } })),
  });
  assert.equal(noBody.facts, null);
  assert.equal(noBody.reason, "body_unreadable");

  clearReportGradeCache();
  const shapeless = await fetchReportFacts({
    reportUrl: REPORT_URL, env: ENV, fetch: stubFetch(async () => ({})),
  });
  assert.equal(shapeless.facts, null);
  assert.equal(shapeless.reason, "invalid_response");

  clearReportGradeCache();
  const original = global.fetch;
  global.fetch = undefined;
  try {
    const none = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV });
    assert.equal(none.facts, null);
    assert.equal(none.reason, "fetch_unavailable");
  } finally {
    global.fetch = original;
  }
});

test("a 200 with no grade in it is a dropped card, never an F", async () => {
  const result = await fetchReportFacts({
    reportUrl: REPORT_URL,
    env: ENV,
    fetch: stubFetch(() => jsonResponse(reportPayload({ overall_grade: null, overall_score: 0 }))),
  });
  assert.equal(result.ok, false);
  assert.equal(result.facts, null);
  assert.equal(result.reason, "no_report_grade");
  assert.equal(result.reportExists, true);
  assert.deepEqual(result.identity, {
    businessName: "Goodson Plumbing Services",
    businessUrl: "https://goodsonplumbing.example/",
    packetId: `wss-genie-cert-v1:${"a".repeat(64)}`,
    snapshotBusinessName: "Goodson Plumbing Services",
    city: "Austin",
    state: "TX",
    industry: "Plumbing",
  });
});

test("report identity accepts only the conservative business and website field fallbacks", async () => {
  const variants = [
    [{ business_name: "Snake Name", business_url: "https://snake.example/" },
      { businessName: "Snake Name", businessUrl: "https://snake.example/" }],
    [{ business_name: "", businessName: "Camel Name", business_url: "", businessUrl: "https://camel.example/" },
      { businessName: "Camel Name", businessUrl: "https://camel.example/" }],
    [{ business_name: {}, businessName: "Fallback Name", business_url: "", website_url: "https://website-snake.example/" },
      { businessName: "Fallback Name", businessUrl: "https://website-snake.example/" }],
    [{ business_name: "Website Camel", business_url: [], websiteUrl: "https://website-camel.example/" },
      { businessName: "Website Camel", businessUrl: "https://website-camel.example/" }],
  ];

  for (const [overrides, expected] of variants) {
    const result = await fetchReportFacts({
      reportUrl: REPORT_URL,
      env: ENV,
      fetch: stubFetch(() => jsonResponse(reportPayload(overrides))),
      cache: new Map(),
    });
    assert.equal(result.reportExists, true);
    assert.deepEqual(result.identity, {
      ...expected,
      packetId: `wss-genie-cert-v1:${"a".repeat(64)}`,
      snapshotBusinessName: "Goodson Plumbing Services",
      city: "Austin",
      state: "TX",
      industry: "Plumbing",
    });
  }
});

test("report identity carries the immutable packet token and closed snapshot fields", async () => {
  const source_snapshot = {
    packetId: `wss-genie-cert-v1:${"b".repeat(64)}`,
    businessName: "Snapshot Name",
    city: " Phoenix ",
    state: "az",
    industryLabel: "HVAC",
    categories: {},
  };
  const result = await fetchReportFacts({
    reportUrl: REPORT_URL,
    env: ENV,
    fetch: stubFetch(() => jsonResponse(reportPayload({ source_snapshot }))),
    cache: new Map(),
  });
  assert.equal(result.reportExists, true);
  assert.deepEqual(result.identity, {
    businessName: "Goodson Plumbing Services",
    businessUrl: "https://goodsonplumbing.example/",
    packetId: `wss-genie-cert-v1:${"b".repeat(64)}`,
    snapshotBusinessName: "Snapshot Name",
    city: "Phoenix",
    state: "az",
    industry: "HVAC",
  });
});

test("identity is withheld when a 200 payload names a different report row", async () => {
  const result = await fetchReportFacts({
    reportUrl: REPORT_URL,
    env: ENV,
    fetch: stubFetch(() => jsonResponse(reportPayload({ id: OTHER_ID }))),
    cache: new Map(),
  });
  assert.equal(result.reportExists, null);
  assert.equal(result.identity, null);
  assert.equal(result.facts, null);
  assert.equal(result.reason, "report_identity_mismatch");
});

test("the timeout is bounded and defaults safely for junk input", async () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 4000, "the ceiling is the worst measured cold start plus headroom");
  for (const bad of [0, -1, NaN, null, "soon", undefined, Infinity]) {
    clearReportGradeCache();
    const result = await fetchReportFacts({
      reportUrl: REPORT_URL, env: ENV, timeoutMs: bad,
      fetch: stubFetch(() => jsonResponse(reportPayload())),
    });
    assert.equal(result.ok, true, `timeoutMs ${JSON.stringify(bad)} broke the fetch`);
  }
});

// ===========================================================================
// 5. THE CACHE
// ===========================================================================

test("the same report composed twice in a run costs one request", async () => {
  const impl = stubFetch(() => jsonResponse(reportPayload()));
  const first = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });
  const second = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });

  assert.equal(impl.calls.length, 1, "the second compose went back to the network");
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.facts, first.facts);
  assert.deepEqual(second.identity, first.identity);
});

test("the cache does not leak one business's grade onto another", async () => {
  const impl = stubFetch((url) => jsonResponse(
    url.includes(OTHER_ID)
      ? reportPayload({ id: OTHER_ID, overall_grade: "D+", overall_score: 69 })
      : reportPayload(),
  ));
  const a = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });
  const b = await fetchReportFacts({ reportUrl: OTHER_URL, env: ENV, fetch: impl });
  assert.equal(impl.calls.length, 2);
  assert.equal(a.facts.grade, "B");
  assert.equal(b.facts.grade, "D+");
  assert.equal(b.cached, false);
});

test("a failure is cached too, so a dead report is not re-asked once per email", async () => {
  const impl = stubFetch(() => jsonResponse({ error: "Report not found" }, 404));
  const first = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });
  const second = await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });
  assert.equal(impl.calls.length, 1);
  assert.equal(first.reason, "http_404");
  assert.equal(second.reason, "http_404");
  assert.equal(second.facts, null);
  assert.equal(second.cached, true);
});

test("the cache expires, and cannot grow without bound", async () => {
  const cache = new Map();
  let clock = 1_000_000;
  const impl = stubFetch(() => jsonResponse(reportPayload()));
  const call = () => fetchReportFacts({
    reportUrl: REPORT_URL, env: ENV, fetch: impl, cache, ttlMs: 1000, now: () => clock,
  });

  await call();
  await call();
  assert.equal(impl.calls.length, 1);
  clock += 1001;
  await call();
  assert.equal(impl.calls.length, 2, "a stale entry was served past its TTL");

  // Bounded: a long-lived process cannot accumulate every report it ever read.
  const big = new Map();
  for (let i = 0; i < MAX_CACHE_ENTRIES + 40; i += 1) {
    const id = `${String(i).padStart(8, "0")}-7d4e-4c2b-9a1f-0e5d8c7b6a44`;
    // eslint-disable-next-line no-await-in-loop
    await fetchReportFacts({
      reportUrl: `https://callprep.wss-ai.com/report/${id}`,
      env: ENV,
      fetch: stubFetch(() => jsonResponse(reportPayload())),
      cache: big,
    });
  }
  assert.ok(big.size <= MAX_CACHE_ENTRIES, `cache grew to ${big.size}`);
});

test("clearReportGradeCache actually clears the module cache", async () => {
  const impl = stubFetch(() => jsonResponse(reportPayload()));
  await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });
  clearReportGradeCache();
  await fetchReportFacts({ reportUrl: REPORT_URL, env: ENV, fetch: impl });
  assert.equal(impl.calls.length, 2);
});

// ===========================================================================
// 6. END TO END THROUGH THE SEND PATH
// ===========================================================================

const PREVIEW = "https://goodson-plumbing.wss-ai.com/";

function visibleText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A prospect the send path will actually compose: a real report link, and a
 * database composite that DISAGREES with what the report says.
 */
function sendableProspect() {
  return {
    prospect_id: "goodson-report-grade",
    business_name: "Goodson Plumbing Services",
    city: "Austin",
    industry: "plumbing",
    email: "owner@goodsonplumbing.test",
    preview_url: PREVIEW,
    current_website: "https://goodsonplumbing.example/",
    before_shot_source_url: "https://www.goodsonplumbing.example/",
    report_url: REPORT_URL,
    record: {
      genie_content_certification: {
        signature: "a".repeat(64),
        identity: {
          business_name: "Goodson Plumbing Services",
          canonical_domain: "goodsonplumbing.example",
          city: "Austin",
          state: "TX",
          category: "Plumbing",
        },
      },
      genie_canonical_packet: {},
      build_ready: {
        qualification: {
          composite_signal: { grade: "C+", score: 77 },
          categories: {
            technology: { grade: "C-", score: 70, signals: [] },
            socialMedia: { grade: "F", score: 25, signals: [] },
            websitePerformance: { grade: "B", score: 83, signals: [] },
          },
        },
      },
    },
  };
}

function acceptFixtureReceipt(_prospect, record) {
  return {
    ok: true,
    receipt: record.genie_content_certification,
  };
}

function configureSendEnvironment() {
  process.env.EMAIL_UNSUB_SECRET = "report-grade-test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.CALLPREP_SUPABASE_URL = ENV.CALLPREP_SUPABASE_URL;
  process.env.CALLPREP_SUPABASE_ANON_KEY = ENV.CALLPREP_SUPABASE_ANON_KEY;
  delete process.env.GHOST_AGENCY_PROOF_EMAIL_V3;
  clearReportGradeCache();
}

async function composeProof() {
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: sendableProspect(), sequence: 1, step: 1, dryRun: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

test("the delivered email quotes the page, and the database grade appears nowhere", async () => {
  configureSendEnvironment();
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push(String(url));
    return jsonResponse(reportPayload(), 200);
  };

  const result = await composeProof();
  const visible = visibleText(result.htmlPreview);

  assert.equal(calls.length, 1, `expected exactly one report read, got ${JSON.stringify(calls)}`);
  assert.match(calls[0], /\/functions\/v1\/get-business-report\?id=/);

  // THE PAGE SAYS B/83. THE DATABASE SAYS C+/77.
  assert.ok(/We measured your site at a B\b/.test(visible), visible.slice(0, 600));
  assert.ok(visible.includes("83"), "the page's score is missing");
  assert.ok(!/\bC\+\b/.test(visible), `the database grade leaked into the email: ${visible}`);
  assert.ok(!/at a C\+/.test(result.composedText || ""), result.composedText);

  // AND NOT ONE REASON THE PAGE DOES NOT RENDER. The DB scores technology at
  // C-/70; the report has no technology card at all.
  assert.ok(!/Site technology/.test(visible), `cited a not-captured category: ${visible}`);
  assert.ok(visible.includes("Social media — D-, 60/100."), visible.slice(0, 900));
  assert.ok(result.htmlPreview.includes(`href="${REPORT_URL}"`), "Signal URL missing from HTML");
  assert.ok(result.composedText.includes(REPORT_URL), "Signal URL missing from plain text");
});

test("an unreadable report ships the rest of the email with no grade card at all", async () => {
  for (const answer of [
    () => jsonResponse({ error: "Report not found" }, 404),
    () => jsonResponse({ error: "Unauthorized" }, 401),
    () => jsonResponse("<html>blocked</html>", 403),
    () => jsonResponse(reportPayload({ overall_grade: null, overall_score: 0 })),
    () => { throw new Error("ECONNREFUSED"); },
  ]) {
    configureSendEnvironment();
    global.fetch = async () => answer();

    // eslint-disable-next-line no-await-in-loop
    const result = await composeProof();
    const visible = visibleText(result.htmlPreview);

    // The WHOLE card is gone from BOTH halves — including the button. A
    // "SEE YOUR ROAD MAP" link under "we measured your site" with no letter is
    // a claim with nothing behind it, and on the 6-of-20 ungraded reports it
    // opens a page that says nothing has been scored yet.
    assert.ok(!/We measured your site/.test(visible), visible.slice(0, 600));
    assert.ok(!/What's holding you back/i.test(visible));
    assert.ok(!/SEE YOUR ROAD MAP/i.test(visible), visible.slice(0, 900));
    assert.ok(!/Don't shoot the messenger/i.test(visible));
    assert.ok(!/We measured your site/.test(result.composedText || ""));
    assert.ok(!/See your road map:/.test(result.composedText || ""), result.composedText);
    assert.ok(!/\bC\+\b/.test(visible), "the database grade filled the gap");
    // No dangling empty href where the button used to be.
    assert.doesNotMatch(result.htmlPreview, /\bhref=""/i);

    // ...and the email itself still ships, whole.
    assert.ok(visible.includes("IT IS ALREADY BUILT. HERE IS THE HONEST MATH."));
    assert.ok(visible.includes("$149"));
    assert.match(result.htmlPreview, /goodson-plumbing\.wss-ai\.com/);
  }
});

test("a prospect with no report link never touches the network", async () => {
  configureSendEnvironment();
  global.fetch = async () => {
    throw new Error("composing an email with no report link must not reach the network");
  };
  const { sendSequenceStep } = require("../lib/email");
  const prospect = sendableProspect();
  delete prospect.report_url;

  const result = await sendSequenceStep({ prospect, sequence: 1, step: 1, dryRun: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(!/We measured your site/.test(visibleText(result.htmlPreview)));
});

test("the report is read once per run even when the same prospect composes twice", async () => {
  configureSendEnvironment();
  let reads = 0;
  global.fetch = async () => { reads += 1; return jsonResponse(reportPayload()); };
  await composeProof();
  await composeProof();
  assert.equal(reads, 1, `read the report ${reads} times for two composes of one report`);
});

test("with V3 switched off there is no report read at all", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = "false";
  let reads = 0;
  global.fetch = async () => { reads += 1; return jsonResponse(reportPayload()); };
  const result = await composeProof();
  assert.equal(reads, 0, "the V2 lane paid for a grade it cannot render");
  assert.ok(!/We measured your site/.test(visibleText(result.htmlPreview)));
});

test("owner-only Practice forces the Signal composer and includes the real report in both MIME parts", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = "false";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  let reads = 0;
  global.fetch = async () => { reads += 1; return jsonResponse(reportPayload()); };
  const { sendSequenceStep } = require("../lib/email");
  const prospect = { ...sendableProspect(), email: process.env.GHOST_AGENCY_OWNER_EMAIL };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ownerProof, true);
  assert.equal(reads, 1);
  assert.ok(result.htmlPreview.includes(`href="${REPORT_URL}"`), "Signal URL missing from HTML");
  assert.ok(result.composedText.includes(REPORT_URL), "Signal URL missing from plain text");
});

test("owner-only Practice cannot be replaced by the V2 dark-launch composer", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = "false";
  process.env.GHOST_AGENCY_EMAIL_V2 = "true";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  global.fetch = async () => jsonResponse(reportPayload());
  const { sendSequenceStep } = require("../lib/email");
  const prospect = { ...sendableProspect(), email: process.env.GHOST_AGENCY_OWNER_EMAIL };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ownerProof, true);
  assert.ok(result.htmlPreview.includes(`href="${REPORT_URL}"`));
  assert.ok(result.composedText.includes(REPORT_URL));
});

test("Practice reuses one cached existence read for the zero-POST Signal and both MIME parts", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  let reads = 0;
  let saves = 0;
  global.fetch = async () => {
    reads += 1;
    return jsonResponse(reportPayload({ overall_grade: null, overall_score: 0 }), 200);
  };
  const { ensureLineReport } = require("../lib/line-report");
  const prospect = {
    ...sendableProspect(),
    email: process.env.GHOST_AGENCY_OWNER_EMAIL,
  };

  const ensured = await ensureLineReport(prospect, {
    preferImmutablePacket: true,
    deps: {
      saveBusinessReport: async () => { saves += 1; throw new Error("must not POST"); },
      scanBusiness: async () => { throw new Error("must not scan"); },
      verifyGenieContentReceipt: () => ({
        ok: true,
        receipt: {
          signature: "a".repeat(64),
          identity: {
            business_name: "Goodson Plumbing Services",
            canonical_domain: "goodsonplumbing.example",
            city: "Austin",
            state: "TX",
            category: "Plumbing",
          },
        },
      }),
    },
  });
  assert.equal(ensured.ok, true, JSON.stringify(ensured));
  assert.equal(ensured.mode, "existing");

  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(reads, 1, "the email must consume the existence read cached by ensureLineReport");
  assert.equal(saves, 0);
  assert.ok(result.htmlPreview.includes(`href="${REPORT_URL}"`));
  assert.ok(result.composedText.includes(REPORT_URL));
});

test("owner-inbox Practice matches production gates: a mismatched Signal row warns, never blocks", async (t) => {
  const cases = [
    {
      name: "wrong business",
      payload: () => reportPayload({ business_name: "Another Company" }),
    },
    {
      name: "wrong domain",
      payload: () => reportPayload({ business_url: "https://another-company.example/" }),
    },
    {
      name: "wrong packet token",
      payload: () => reportPayload({
        source_snapshot: {
          packet_id: `wss-genie-cert-v1:${"b".repeat(64)}`,
          business_name: "Goodson Plumbing Services",
          city: "Austin",
          state: "TX",
          industry: "Plumbing",
          categories: {},
        },
      }),
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      configureSendEnvironment();
      process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
      global.fetch = async () => jsonResponse(item.payload());
      const { sendSequenceStep } = require("../lib/email");
      const result = await sendSequenceStep({
        prospect: { ...sendableProspect(), email: process.env.GHOST_AGENCY_OWNER_EMAIL },
        sequence: 1,
        step: 1,
        dryRun: true,
        internalOwnerProof: true,
        verifyOwnerPracticeReceipt: acceptFixtureReceipt,
        lineBatchApproved: true,
        allowContactHoldBypass: true,
        requireSignalReportInEmail: true,
      });
      // OWNER LAW (2026-09-02): the owner's own inbox follows the production
      // gate set — prospect-facing sends never ran the report-identity
      // verdict, so the internal lane must not either. A mismatched report
      // link composes with a loud warn; only a missing/unsafe report blocks.
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(result.htmlPreview.includes(`href="${REPORT_URL}"`));
    });
  }
});

test("owner-only Practice holds missing and unsafe Signal reports before delivery", async (t) => {
  const cases = [
    { name: "missing", reportUrl: "", response: null, blocked: "owner_proof_signal_report_missing", reads: 0 },
    { name: "unsafe", reportUrl: "https://example.test/report/not-a-report", response: null, blocked: "owner_proof_signal_report_unsafe", reads: 0 },
    { name: "wrong port", reportUrl: `https://callprep.wss-ai.com:444/report/${REPORT_ID}`, response: null, blocked: "owner_proof_signal_report_unsafe", reads: 0 },
    { name: "embedded credentials", reportUrl: `https://user:pw@callprep.wss-ai.com/report/${REPORT_ID}`, response: null, blocked: "owner_proof_signal_report_unsafe", reads: 0 },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      configureSendEnvironment();
      process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
      let reads = 0;
      global.fetch = async () => {
        reads += 1;
        if (!item.response) throw new Error("unsafe Signal URL reached the network");
        return item.response;
      };
      const { sendSequenceStep } = require("../lib/email");
      const base = sendableProspect();
      const prospect = {
        ...base,
        email: process.env.GHOST_AGENCY_OWNER_EMAIL,
        report_url: item.reportUrl,
      };
  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
        allowContactHoldBypass: true,
        requireSignalReportInEmail: true,
      });

      assert.equal(result.ok, false);
      assert.equal(result.mode, "send_blocked");
      assert.equal(result.blocked, item.blocked);
      assert.equal(reads, item.reads);
      assert.equal(result.htmlPreview, undefined);
    });
  }
});

test("owner-only Practice keeps a neutral Signal link when the real row exists but is ungraded", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  let reads = 0;
  global.fetch = async () => {
    reads += 1;
    return jsonResponse(reportPayload({ overall_grade: null, overall_score: 0 }));
  };
  const { sendSequenceStep } = require("../lib/email");
  const prospect = { ...sendableProspect(), email: process.env.GHOST_AGENCY_OWNER_EMAIL };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(reads, 1, "availability and grade facts must share one report read");
  assert.ok(result.htmlPreview.includes(`href="${REPORT_URL}"`));
  assert.match(result.htmlPreview, /OPEN YOUR SIGNAL REPORT/i);
  assert.ok(result.composedText.includes(`Open your Signal Report: ${REPORT_URL}`));
  assert.doesNotMatch(visibleText(result.htmlPreview), /We measured your site/i);
  assert.doesNotMatch(result.composedText, /We measured your site/i);
});

test("owner-only Practice holds a definitive 404 before provider work", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  let reads = 0;
  global.fetch = async () => {
    reads += 1;
    return jsonResponse({ error: "Report not found" }, 404);
  };
  const { sendSequenceStep } = require("../lib/email");
  const prospect = { ...sendableProspect(), email: process.env.GHOST_AGENCY_OWNER_EMAIL };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, "send_blocked");
  assert.equal(result.blocked, "owner_proof_signal_report_missing");
  assert.equal(result.retryableBeforeProvider, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(reads, 1, "definitive absence needs one cached report read");
  assert.equal(result.htmlPreview, undefined);
});

test("owner-only Practice holds unknown report availability instead of guessing the row exists", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  let reads = 0;
  global.fetch = async () => { reads += 1; throw new Error("transport unavailable"); };
  const { sendSequenceStep } = require("../lib/email");
  const prospect = { ...sendableProspect(), email: process.env.GHOST_AGENCY_OWNER_EMAIL };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_signal_report_unavailable");
  assert.equal(result.retryableBeforeProvider, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(reads, 1);
});

test("approved owner-only Line Practice cannot bypass Signal by omitting the explicit flag", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  global.fetch = async () => { throw new Error("missing Signal must not reach the network"); };
  const { sendSequenceStep } = require("../lib/email");
  const prospect = {
    ...sendableProspect(),
    email: process.env.GHOST_AGENCY_OWNER_EMAIL,
    report_url: "",
  };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_signal_report_missing");
  assert.equal(result.providerAttempted, false);
});

test("an unsafe top-level report cannot shadow a later valid durable Signal URL", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  global.fetch = async () => jsonResponse(reportPayload());
  const { sendSequenceStep } = require("../lib/email");
  const base = sendableProspect();
  const prospect = {
    ...base,
    email: process.env.GHOST_AGENCY_OWNER_EMAIL,
    report_url: "https://example.test/report/not-safe",
    record: { ...base.record, report_url: REPORT_URL },
  };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.htmlPreview.includes(`href="${REPORT_URL}"`));
  assert.ok(result.composedText.includes(REPORT_URL));
  assert.doesNotMatch(result.htmlPreview, /example\.test\/report\/not-safe/);
});

test("stronger preview safety still outranks a missing required Practice Signal", async () => {
  configureSendEnvironment();
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  global.fetch = async () => { throw new Error("no network expected"); };
  const { sendSequenceStep } = require("../lib/email");
  const prospect = { ...sendableProspect(), email: process.env.GHOST_AGENCY_OWNER_EMAIL, preview_url: "", report_url: "" };

  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    verifyOwnerPracticeReceipt: acceptFixtureReceipt,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "no_preview_url");
});
