"use strict";

// ---------------------------------------------------------------------------
// test/proof-email-inputs.test.js — THE MAPPING THAT MUST NOT INVENT ANYTHING.
//
// lib/proof-email-inputs.js turns a stored prospect into composeOutreachEmailV3
// options. It is the single most dangerous file in the outreach path, because
// a mapping is where fabrication is introduced: every `?? 0`, every `|| "B"`,
// every "not measured" that quietly became "scored zero" was written at a
// mapping boundary. A composer cannot invent a grade it was never handed, so
// the only place a fake grade can come from is here.
//
// What these tests hold shut:
//
//   1. A FULL record maps every field to the value the data actually holds.
//   2. A SPARSE record emits only what it can source, and the email still
//      composes into a clean render — no empty boxes, no orphaned headings.
//   3. An EMPTY object produces essentially nothing, and does NOT throw.
//   4. NO FALLBACKS on truth-bearing fields: no default letter, no default
//      score, no half a rating/review pair, no manufactured expiry date, no
//      placeholder business name.
//   5. The flag parses defensively — on, off, absent, blank, junk.
//   6. A NON-PROOF step never reaches V3, whatever the flag says.
//
// Where a claim is about what the reader SEES, the assertion is made against
// the composed DOM rather than against the options object. "The option was
// omitted" is exactly the assertion that would pass while the composer printed
// a fallback anyway.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const {
  buildProofEmailInputs,
  proofEmailV3Enabled,
  assertKnownProofEmailInputs,
  PROOF_EMAIL_V3_OPTION_KEYS,
} = require("../lib/proof-email-inputs");
const { composeOutreachEmailV3, GRADE_LADDER } = require("../lib/outreach-email-v3");

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
});

const PREVIEW = "https://harbor-ridge-roofing.wss-ai.com/";
const REPORT = "https://callprep.wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
const SHOT_OLD = "https://ghost.wss-ai.com/api/media/preview-shot?k=old.aa&s=bb&v=old&c=0123456789ab";
const SHOT_NEW = "https://ghost.wss-ai.com/api/media/preview-shot?k=new.aa&s=bb&v=new&c=0123456789ab";

/** A prospect with everything the line actually stores. */
function fullProspect(overrides = {}) {
  return {
    prospect_id: "harbor-ridge-inputs",
    business_name: "Harbor Ridge Roofing",
    city: "Ventura",
    industry: "roofing",
    email: "owner@harborridgeroofing.com",
    preview_url: PREVIEW,
    current_website: "https://harborridgeroofing.com/",
    report_url: REPORT,
    record: {
      rating: 4.9,
      review_count: 407,
      build_ready: {
        qualification: {
          composite_signal: { grade: "C+", score: 77.4 },
          categories: {
            socialMedia: {
              grade: "F",
              score: 40,
              signals: [{ name: "instagram", observed: false }, { name: "yelp", observed: false }],
            },
            technology: { grade: "D", score: 62, signals: [] },
            security: { grade: "C", score: 75, signals: [] },
            seo: { grade: "A", score: 95, signals: [] },
          },
        },
      },
    },
    ...overrides,
  };
}

/**
 * WHAT THE LINKED REPORT ITSELF SAYS — the shape lib/report-grade.js returns
 * after reading get-business-report. Deliberately DISAGREES with the DB
 * composite above (report B/83, database C+/77), because that is the real
 * situation: measured across every row in the store carrying both, the two
 * scorers disagree on the score 8 times out of 8. Goodson Plumbing is exactly
 * this pair. Every assertion about a printed grade below is therefore also an
 * assertion that the DATABASE's number never reached the reader.
 *
 * Note what is NOT here: `technology`. Zero of twenty live reports carry a
 * technology category — the page renders it "NOT CAPTURED IN THIS REPORT
 * VERSION" — while the DB scores it on 8 of 8 rows. That asymmetry is the
 * reason "Site technology — C-, 70/100" ever appeared in an email.
 */
function reportFacts(overrides = {}) {
  return {
    grade: "B",
    score: 83,
    categories: {
      socialMedia: { grade: "D-", score: 60 },
      seo: { grade: "B+", score: 89 },
      security: { grade: "B", score: 83 },
      geo: { grade: "B", score: 83 },
      onlineReputation: { grade: "B+", score: 87 },
      websitePerformance: { grade: "C+", score: 78 },
      googleBusinessProfile: { grade: "B+", score: 89 },
    },
    ...overrides,
  };
}

function fullCta(overrides = {}) {
  return {
    previewUrl: PREVIEW,
    revealUrl: PREVIEW,
    currentUrl: "https://harborridgeroofing.com/",
    beforeImage: SHOT_OLD,
    afterImage: SHOT_NEW,
    clientId: "WSS-42624A",
    rating: 4.9,
    reviewCount: 407,
    reportUrl: REPORT,
    ...overrides,
  };
}

const FOOTER = Object.freeze({
  ok: true,
  postal: "655 S Main St, Suite 200, Orange, CA 92868",
  unsubscribe: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=abc.def",
  support: "support@wss-ai.com",
});

function build(overrides = {}) {
  return buildProofEmailInputs({
    prospect: fullProspect(),
    record: fullProspect().record,
    cta: fullCta(),
    footer: FOOTER,
    businessName: "Harbor Ridge Roofing",
    city: "Ventura",
    reportFacts: reportFacts(),
    env: {},
    ...overrides,
  });
}

/** The rendered DOM as a reader sees it. Assertions about copy use THIS. */
function visibleText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/(?:&#39;|&#x27;|&apos;)/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ===========================================================================
// 1. A FULL RECORD
// ===========================================================================

test("a full record maps every field to what the data actually holds", () => {
  const options = build();

  assert.equal(options.businessName, "Harbor Ridge Roofing");
  assert.equal(options.city, "Ventura");
  assert.equal(options.previewUrl, PREVIEW);
  assert.equal(options.beforeImage, SHOT_OLD);
  assert.equal(options.afterImage, SHOT_NEW);
  assert.equal(options.clientId, "WSS-42624A");
  assert.equal(options.reportUrl, REPORT);
  assert.equal(options.postalAddress, FOOTER.postal);
  assert.equal(options.unsubUrl, FOOTER.unsubscribe);

  // THE GRADE IS THE REPORT'S, VERBATIM — and the database's C+/77 is nowhere
  // in this email. The record still holds composite_signal C+/77; the linked
  // page says B/83; the reader gets B/83, because that is the page one click
  // away from the button under this sentence.
  assert.equal(options.grade, "B");
  assert.equal(options.gradeScore, 83);
  assert.notEqual(options.grade, "C+");
  assert.notEqual(options.gradeScore, 77);

  // Reasons come from the REPORT's categories, weakest first, and a category
  // at 90+ is not a complaint.
  assert.equal(options.gradeReasons.length, 3);
  assert.match(options.gradeReasons[0], /^Social media — D-, 60\/100\./);
  assert.match(options.gradeReasons[1], /^Site speed — C\+, 78\/100\./);
  // The DB scores `technology` at 62 — low enough to be one of the three
  // weakest — but the linked report does not render a technology card at all.
  // Citing it is the Poor John's defect: "Site technology — C-, 70/100" over a
  // page that says NOT CAPTURED IN THIS REPORT VERSION.
  assert.ok(
    !options.gradeReasons.some((reason) => /^Site technology/.test(reason)),
    `cited a category the linked report does not render: ${JSON.stringify(options.gradeReasons)}`,
  );

  // Trust numbers are strings for the composer, and they are the measured
  // numbers — not rounded down, not bucketed, not decorated.
  assert.equal(options.rating, "4.9");
  assert.equal(options.reviewCount, "407");
});

test("the full record composes into a coherent email with every block present", () => {
  const composed = composeOutreachEmailV3(build());
  const visible = visibleText(composed.html);

  assert.ok(visible.includes("Harbor Ridge Roofing, we already built your new website."));
  assert.ok(visible.includes("Ventura"), "the city drives the 'why you' line");
  assert.ok(visible.includes("WSS-42624A"), "the client id must be readable");
  assert.ok(/We measured your site at a B\b/.test(visible), visible.slice(0, 400));
  assert.ok(!/We measured your site at a C\+/.test(visible), "the database grade reached the reader");
  assert.ok(visible.includes("Social media — D-, 60/100."));
  assert.ok(visible.includes("Your 4.9"), "the rating renders with its review count");
  assert.ok(visible.includes("407 reviews"));

  // Structural hygiene, on the shipped markup.
  assert.equal((composed.html.match(/<body\b/gi) || []).length, 1);
  assert.doesNotMatch(composed.html, /\b(?:href|src)=""/i);
  assert.doesNotMatch(composed.html, /\b(?:undefined|null)\b/i);
  assert.doesNotMatch(composed.html, /<script\b|<iframe\b|javascript:/i);

  // Every image is served from a host we control. A third-party <img> in cold
  // outreach is what the send path's own suites refuse.
  for (const [, src] of composed.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    assert.match(src.replace(/&amp;/g, "&"), /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i);
  }
});

// ===========================================================================
// 2. A SPARSE RECORD
// ===========================================================================

test("a sparse record emits only what it can source", () => {
  const options = buildProofEmailInputs({
    prospect: { prospect_id: "sparse-1", business_name: "Sparse Plumbing", city: "Modesto" },
    cta: { previewUrl: PREVIEW, clientId: "WSS-000001" },
    footer: FOOTER,
    businessName: "Sparse Plumbing",
    city: "Modesto",
    env: {},
  });

  assert.equal(options.businessName, "Sparse Plumbing");
  assert.equal(options.previewUrl, PREVIEW);
  assert.equal(options.clientId, "WSS-000001");

  // Everything unsourced is ABSENT — not empty string, not null, not zero.
  for (const key of [
    "grade", "gradeScore", "gradeReasons", "rating", "reviewCount",
    "reportUrl", "beforeImage", "afterImage", "afterAnimUrl",
    "expiresAt", "scannedCount", "countdownGifUrl", "connectMagicLink",
  ]) {
    assert.ok(!(key in options), `${key} was emitted for a record that has no such fact`);
  }
});

test("the sparse record still renders clean — no empty boxes, no orphaned headings", () => {
  const composed = composeOutreachEmailV3(buildProofEmailInputs({
    prospect: { prospect_id: "sparse-2", business_name: "Sparse Plumbing", city: "Modesto" },
    cta: { previewUrl: PREVIEW, clientId: "WSS-000001" },
    footer: FOOTER,
    businessName: "Sparse Plumbing",
    city: "Modesto",
    env: {},
  }));
  const visible = visibleText(composed.html);

  // The grade card, its heading and its road-map button all disappear as one
  // unit. A "WHAT'S HOLDING YOU BACK" heading over nothing is the exact
  // orphaned-heading failure this asserts against.
  assert.ok(!visible.includes("Don't shoot the messenger"));
  assert.ok(!visible.includes("What's holding you back"));
  assert.ok(!visible.includes("SEE YOUR ROAD MAP"));
  assert.ok(!/We measured your site/.test(visible));

  // No half-populated trust sentence: the generic line, or nothing.
  assert.ok(!/\d+(?:\.\d+)? reviews/.test(visible), visible);
  assert.ok(visible.includes("Your Google rating and reviews"));

  // No expiry commitment, and no hero panel without shots.
  assert.ok(!/keep your preview on our server until/i.test(visible));
  assert.ok(!/open it live/i.test(visible), "no before/after panel without any shot");

  // Still structurally sound and still compliant.
  assert.doesNotMatch(composed.html, /\b(?:href|src)=""/i);
  assert.doesNotMatch(composed.html, /\b(?:undefined|null)\b/i);
  assert.equal((composed.html.match(/<body\b/gi) || []).length, 1);
  assert.ok(visible.includes(FOOTER.postal));
  assert.ok(visible.includes("Not interested? Reply STOP and you won't hear from me again."));
});

// ===========================================================================
// 3. AN EMPTY RECORD
// ===========================================================================

test("an empty object maps to almost nothing and never throws", () => {
  const options = buildProofEmailInputs({ env: {} });
  assert.deepEqual(options, {});

  // Called with no argument at all, it must still not throw — and must still
  // not read anything out of the ambient environment except the Riley line,
  // which is absent here.
  assert.doesNotThrow(() => buildProofEmailInputs());
});

test("an empty record composes a generic email rather than a broken one", () => {
  const composed = composeOutreachEmailV3(buildProofEmailInputs({ env: {} }));
  const visible = visibleText(composed.html);

  // Addressed to nobody, so it says nobody's name — never "your business,".
  assert.ok(visible.includes("We already built your new website."));
  // The only legitimate "your business" is the American-AI value line
  // ("...everything we do for your business."). The leak THIS guards is the
  // placeholder used as the NAME ("your business, we already built…"), so strip
  // the known value line first — the broad guard still holds everywhere else.
  assert.ok(!/your business/i.test(visible.replace(/everything we do for your business\./gi, "")));
  assert.ok(!/undefined|NaN/i.test(visible));
  assert.doesNotMatch(composed.html, /\b(?:href|src)=""/i);
  assert.equal((composed.html.match(/<body\b/gi) || []).length, 1);
  assert.equal(typeof composed.text, "string");
  assert.equal(typeof composed.html, "string");
});

// ===========================================================================
// 4. NO FALLBACKS ON TRUTH-BEARING FIELDS
// ===========================================================================

test("an unreadable report means NO grade — the card drops, and no letter is invented", () => {
  // This is the fail-closed case that matters most in production: the report
  // fetch timed out, 404'd, or came back ungraded, so lib/report-grade.js
  // handed back null. The record STILL carries composite_signal C+/77, and the
  // reader must not see it — a grade we cannot show them the page for is a
  // grade we do not say out loud.
  for (const missing of [null, undefined, {}, [], "B", 0, false]) {
    const options = build({ reportFacts: missing });
    assert.ok(!("grade" in options), `invented a grade from ${JSON.stringify(missing)}`);
    assert.ok(!("gradeScore" in options));
    assert.ok(!("gradeReasons" in options));

    const visible = visibleText(composeOutreachEmailV3(options).html);
    assert.ok(!/We measured your site at/.test(visible));
    assert.ok(!/\bat a [A-F][+-]?\b/.test(visible), `a grade letter appeared anyway: ${visible}`);
    assert.ok(!visible.includes("What's holding you back"));
    // The DB's own letter must not turn up by any other route either.
    assert.ok(!/\bC\+\b/.test(visible), `the database grade leaked: ${visible}`);
  }
});

test("the database composite is never consulted, even when the report is silent", () => {
  // The exact regression this whole change exists to prevent: a report that
  // answers but carries no grade must NOT fall back to record.build_ready.
  const prospect = fullProspect();
  assert.equal(prospect.record.build_ready.qualification.composite_signal.grade, "C+");

  const options = build({ prospect, record: prospect.record, reportFacts: { categories: {} } });
  assert.ok(!("grade" in options));
  assert.ok(!("gradeScore" in options));
  assert.ok(!("gradeReasons" in options));
});

test("an off-scale grade is refused rather than printed, and takes its score with it", () => {
  for (const junk of ["Z", "??", "1", "unknown", "  ", "", null, undefined, 0, {}]) {
    const options = build({ reportFacts: reportFacts({ grade: junk, score: 41 }) });
    assert.ok(!("grade" in options), `printed junk grade ${JSON.stringify(junk)}`);
    // The score lives inside the grade tile; without a letter it has no home,
    // and a bare "41/100" with no grade is a number with no meaning.
    assert.ok(!("gradeScore" in options), `kept an orphaned score for grade ${JSON.stringify(junk)}`);
    assert.ok(!("gradeReasons" in options));
  }
});

test("every rung of the report's own ladder is accepted — the whitelist is not a blocklist", () => {
  for (const grade of GRADE_LADDER) {
    assert.equal(build({ reportFacts: reportFacts({ grade, score: 50 }) }).grade, grade);
  }
});

test("a grade with no report to back it is withheld from BOTH halves", () => {
  // composeOutreachEmailV3 hides the grade CARD when there is no reportUrl but
  // its plain-text half does not — it would print "We measured your site at
  // C+ (77/100)" plus three numbered failings with no link to anything
  // substantiating them. That is an unsourced accusation in the half a
  // text-only client renders, and it makes the two MIME parts disagree.
  const prospect = fullProspect({ report_url: "" });
  const options = build({
    prospect,
    record: prospect.record,
    cta: fullCta({ reportUrl: "" }),
  });
  assert.ok(!("reportUrl" in options));
  assert.ok(!("grade" in options), "a grade shipped with no report behind it");
  assert.ok(!("gradeScore" in options));
  assert.ok(!("gradeReasons" in options));

  const composed = composeOutreachEmailV3(options);
  assert.ok(!/We measured your site at/.test(composed.text), composed.text);
  assert.ok(!/What's holding you back/.test(composed.text));

  // AND THE COMPOSER REFUSES ON ITS OWN TERMS. Until 2026-08-07 the mapping was
  // the only thing hiding this: hand V3 a grade with no reportUrl directly and
  // its HTML dropped the card while its plain-text half printed "We measured
  // your site at D (41/100)" and three numbered failings with nothing behind
  // them. Two MIME parts of one message, saying different things. A direct
  // caller must not be able to reintroduce that.
  const direct = composeOutreachEmailV3({
    businessName: "Harbor Ridge Roofing",
    previewUrl: PREVIEW,
    grade: "D",
    gradeScore: 41,
    gradeReasons: ["Social media — F, 40/100.", "SEO — D, 62/100."],
  });
  assert.ok(!/We measured your site/.test(direct.text), direct.text);
  assert.ok(!/What's holding you back/.test(direct.text));
  assert.ok(!/Social media — F/.test(direct.text));
  assert.ok(!/\bD \(41\/100\)/.test(direct.text));
  // The HTML half already dropped it; both halves now agree on the omission.
  assert.ok(!/We measured your site/.test(visibleText(direct.html)));
  assert.ok(!/What's holding you back/.test(visibleText(direct.html)));
});

test("with a report, BOTH halves carry the same letter, score and reasons", () => {
  // The other direction of the same contract. A parity bug is only half-fixed
  // if the text half goes quiet when the HTML speaks.
  const composed = composeOutreachEmailV3(build());
  const visible = visibleText(composed.html);

  for (const half of [visible, composed.text]) {
    assert.ok(/We measured your site at a B\b/.test(half), half.slice(0, 400));
    assert.ok(half.includes("Social media — D-, 60/100."), half.slice(0, 600));
    assert.ok(half.includes("Site speed — C+, 78/100."));
    assert.ok(/What's holding you back/i.test(half));
    assert.ok(half.includes("road map to get you to A-"), half.slice(0, 400));
  }
  // The score is in the HTML badge and spelled out in the text half.
  assert.ok(visible.includes("83"), visible.slice(0, 400));
  assert.ok(composed.text.includes("(83/100)"), composed.text.slice(0, 400));
  assert.ok(composed.text.includes(`See your road map: ${REPORT}`));
});

test("a dead or foreign report link is dropped, never printed", () => {
  for (const dead of [
    "https://callprep.wss-ai.com/report/harbor-ridge-roofing", // build slug, not a uuid
    "https://siteforge-app-seven.vercel.app/try/x/scorecard.json",
    "https://evil.example.test/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44",
    "http://callprep.wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44", // not https
  ]) {
    const options = build({ cta: fullCta({ reportUrl: dead }), prospect: fullProspect({ report_url: dead }) });
    assert.ok(!("reportUrl" in options), `accepted a dead report link: ${dead}`);
    assert.ok(!("grade" in options), `graded off a dead report link: ${dead}`);
  }
});

test("rating and review count are all-or-nothing — never half a claim", () => {
  const onlyRating = build({ cta: fullCta({ reviewCount: "" }) , record: { rating: 4.9 } });
  assert.ok(!("rating" in onlyRating), "a rating shipped with no review count behind it");
  assert.ok(!("reviewCount" in onlyRating));

  const onlyCount = build({ cta: fullCta({ rating: "" }), record: { review_count: 407 } });
  assert.ok(!("reviewCount" in onlyCount), "a review count shipped with no rating");
  assert.ok(!("rating" in onlyCount));

  // The rendered line falls back to the generic wording — it never prints a
  // number it was not given.
  const visible = visibleText(composeOutreachEmailV3(onlyRating).html);
  assert.ok(visible.includes("Your Google rating and reviews"));
  assert.ok(!/4\.9/.test(visible));
});

test("a zero, empty or out-of-range trust number is never coerced into a claim", () => {
  // Number("") and Number(null) are both 0. If any of these become 0 the email
  // tells a business it has a 0-star rating, or 0 reviews, which it did not.
  for (const [rating, reviewCount] of [
    ["", ""], [null, null], [0, 0], [0, 407], [4.9, 0], [5.4, 12], [-1, 12],
    ["not a number", 407], [4.9, "lots"], [4.9, 12.5],
  ]) {
    const options = build({ cta: fullCta({ rating, reviewCount }), record: {} });
    assert.ok(
      !("rating" in options) && !("reviewCount" in options),
      `coerced ${JSON.stringify([rating, reviewCount])} into ${JSON.stringify(options.rating)}/${JSON.stringify(options.reviewCount)}`,
    );
  }
});

test("a category we never measured is not a category scoring zero", () => {
  const options = build({
    reportFacts: reportFacts({
      categories: {
        socialMedia: { grade: "F", score: 40, signals: [] },
        technology: { score: "" },      // never measured
        security: { score: null },      // never measured
        geo: {},                        // never measured
      },
    }),
  });
  assert.equal(options.gradeReasons.length, 1);
  assert.match(options.gradeReasons[0], /^Social media/);
  // Matched with the separator in front of it: "40/100" also contains the
  // characters "0/100", so a bare substring check would pass on the wrong
  // string and fail on the right one.
  assert.ok(
    !options.gradeReasons.some((reason) => /,\s*0\/100\b/.test(reason)),
    `an unmeasured category was reported as scoring zero: ${JSON.stringify(options.gradeReasons)}`,
  );
  assert.ok(!options.gradeReasons.some((reason) => /^(?:Site technology|Security|AI search)/.test(reason)));
});

test("no expiry is invented — the block only exists for a real future timestamp", () => {
  const now = Date.parse("2026-08-07T12:00:00Z");

  // The 44-of-45 case: nothing stored.
  const none = build({ now });
  assert.ok(!("expiresAt" in none));
  assert.ok(!/keep your preview on our server until/i.test(composeOutreachEmailV3(none).html));
  assert.ok(!/keep your preview on our server until/i.test(composeOutreachEmailV3(none).text));

  // Falsy and malformed values must not become "seven days from now" either.
  for (const value of ["", null, 0, "   ", "not a date", "August 32, 2026"]) {
    const options = build({ prospect: fullProspect({ preview_expires_at: value }), now });
    assert.ok(!("expiresAt" in options), `invented an expiry from ${JSON.stringify(value)}`);
  }

  // A date that has already passed is a broken promise, not a missing one.
  const past = build({ prospect: fullProspect({ preview_expires_at: "2026-08-01T00:00:00Z" }), now });
  assert.ok(!("expiresAt" in past));

  // A real future timestamp DOES render.
  const future = build({ prospect: fullProspect({ preview_expires_at: "2026-08-21T00:00:00Z" }), now });
  assert.ok("expiresAt" in future);
  assert.match(composeOutreachEmailV3(future).html, /keep your preview on our server until/i);
});

test("placeholder identity copy is stripped instead of being addressed to a stranger", () => {
  // lib/email.js substitutes these when it has no real value; they are merge
  // scaffolding, not names. "your business, we already built your new website."
  // is worse than saying nothing.
  const options = build({ businessName: "your business", city: "your area", prospect: {}, record: {} });
  assert.ok(!("businessName" in options));
  assert.ok(!("city" in options));

  const visible = visibleText(composeOutreachEmailV3(options).html);
  assert.ok(visible.includes("We already built your new website."));
  // The only legitimate "your business" is the American-AI value line
  // ("...everything we do for your business."). The leak THIS guards is the
  // placeholder used as the NAME ("your business, we already built…"), so strip
  // the known value line first — the broad guard still holds everywhere else.
  assert.ok(!/your business/i.test(visible.replace(/everything we do for your business\./gi, "")));
  assert.ok(!/around your area/i.test(visible));
});

test("no fabricated Riley number, and never the prospect's own line", () => {
  // Unset environment => no phone => the whole free-call panel disappears.
  const unset = build({ env: {} });
  assert.ok(!("rileyPhone" in unset));
  assert.ok(!/Call Riley free right now/i.test(composeOutreachEmailV3(unset).html));

  // Configured => our agency line, in E.164.
  const configured = build({ env: { GHOST_AGENCY_AGENT_PHONE: "+19493395562" } });
  assert.equal(configured.rileyPhone, "+19493395562");

  // THE PROSPECT'S OWN PHONE IS NOT RILEY'S LINE. A mapping that passed the
  // prospect's bag to resolveRileyLine would tell a business to call itself.
  const withProspectPhone = build({
    env: {},
    prospect: fullProspect({ phone: "+15551234567", riley_phone: "+15559876543" }),
  });
  assert.ok(!("rileyPhone" in withProspectPhone));
});

test("the hero never ships an empty link, and unsourced surfaces stay absent", () => {
  // beforeImage/afterImage without a preview URL would make V3 wrap the whole
  // before/after card in <a href="">, captioned "open it live".
  const noPreview = build({ cta: fullCta({ previewUrl: "", revealUrl: "" }) });
  assert.ok(!("previewUrl" in noPreview));
  assert.ok(!("beforeImage" in noPreview));
  assert.ok(!("afterImage" in noPreview));
  assert.doesNotMatch(composeOutreachEmailV3(noPreview).html, /\bhref=""/i);

  // Surfaces with no working source today are never derived, only accepted.
  const options = build();
  for (const key of ["afterAnimUrl", "afterAnimLane", "countdownGifUrl", "connectMagicLink", "scannedCount", "connectIncluded"]) {
    assert.ok(!(key in options), `${key} was derived from thin air`);
  }
  // ...and a caller that has proven one can still pass it.
  const supplied = build({
    afterAnimUrl: "https://ghost.wss-ai.com/anim.gif",
    afterAnimLane: "hero",
    scannedCount: 38,
    connectIncluded: true,
  });
  assert.equal(supplied.afterAnimUrl, "https://ghost.wss-ai.com/anim.gif");
  assert.equal(supplied.afterAnimLane, "hero");
  assert.equal(supplied.scannedCount, 38);
  assert.equal(supplied.connectIncluded, true);

  // Non-https and non-strict-true are refused rather than half-honoured.
  const hostile = build({
    afterAnimUrl: "http://insecure.example/anim.gif",
    afterAnimLane: "hero",
    connectMagicLink: "javascript:alert(1)",
    scannedCount: 0,
    connectIncluded: "yes",
  });
  assert.ok(!("afterAnimUrl" in hostile));
  // The lane is a claim ABOUT the loop; a refused loop URL must strip it too,
  // or the composer would be told "hero" about an <img> that never minted.
  assert.ok(!("afterAnimLane" in hostile));
  assert.ok(!("connectMagicLink" in hostile));
  assert.ok(!("scannedCount" in hostile));
  assert.ok(!("connectIncluded" in hostile));
});

test("an owner-only provisional market emits the marker and withholds market claims", () => {
  const options = build({
    sandbox: true,
    marketProvisional: true,
    city: "Spokane",
    scannedCount: 38,
  });

  assert.equal(options.ownerProof, true);
  assert.equal(options.marketProvisional, true);
  assert.ok(!("city" in options));
  assert.ok(!("scannedCount" in options));
});

test("a live send ignores a poisoned provisional marker and preserves proven market facts", () => {
  const options = build({
    sandbox: false,
    marketProvisional: true,
    city: "Spokane",
    scannedCount: 38,
  });

  assert.ok(!("ownerProof" in options));
  assert.ok(!("marketProvisional" in options));
  assert.equal(options.city, "Spokane");
  assert.equal(options.scannedCount, 38);
});

test("the mapping cannot emit an option the composer does not read", () => {
  // The guard lib/outreach-email-v3.js lacks. `industry` is populated on 45 of
  // 45 rows and read by nothing — passing it would be the silent-drop defect
  // that shipped every follow-up as the wrong email in July.
  assert.ok(!("industry" in build()));
  for (const key of Object.keys(build())) {
    assert.ok(PROOF_EMAIL_V3_OPTION_KEYS.includes(key), `${key} is not a V3 option`);
  }
  assert.throws(
    () => assertKnownProofEmailInputs({ businessName: "Ace", bodytext: "oops" }),
    /does not read: bodytext/,
  );
});

// ===========================================================================
// 5. THE FLAG
// ===========================================================================

test("the flag defaults ON and only an explicit off-value falls back to V2", () => {
  // ABSENT => ON. The owner wants V3 live; not-configured is not "off".
  assert.equal(proofEmailV3Enabled({}), true);
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: undefined }), true);
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: null }), true);
  assert.equal(proofEmailV3Enabled(undefined ?? {}), true);
  assert.equal(proofEmailV3Enabled(null), true, "a missing env object must not throw");

  // EXPLICITLY OFF, in every spelling an operator would reach for, and
  // whatever the casing or surrounding whitespace.
  for (const off of [
    "0", "false", "off", "no", "n", "disabled", "disable",
    "FALSE", "  Off  ", "No", "\tDISABLED\n",
  ]) {
    assert.equal(
      proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: off }),
      false,
      `"${off}" should turn V3 off`,
    );
  }

  // EXPLICITLY ON.
  for (const on of ["1", "true", "on", "yes", "TRUE", " On "]) {
    assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: on }), true, `"${on}"`);
  }
});

test("the flag parse survives the truthiness traps this codebase keeps hitting", () => {
  // THE EMPTY STRING. `env.X ?? "true"` does NOT catch "" — nullish coalescing
  // only fires on null/undefined — so a variable that exists but is blank
  // silently falls through whatever branch follows. Blank is not a decision to
  // disable, so it stays ON.
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: "" }), true);
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: "   " }), true);

  // Number("") is 0 and Number(null) is 0, and Number.isFinite(0) is true, so
  // any numeric coercion turns "unset" into a real falsy value. There is none.
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: 0 }), false, "numeric 0 is an explicit off");
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: 1 }), true);

  // Boolean("false") is true — the classic. Compared as a string, never coerced.
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: false }), false);
  assert.equal(proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: true }), true);

  // JUNK LEAVES THE OWNER'S DEFAULT IN PLACE. A typo must not silently revert
  // the whole line to the old composer.
  for (const junk of ["maybe", "1.0", "yes please", "ON!", "v3", "{}", "[object Object]"]) {
    assert.equal(
      proofEmailV3Enabled({ GHOST_AGENCY_PROOF_EMAIL_V3: junk }),
      true,
      `junk value "${junk}" must not disable V3`,
    );
  }
});

// ===========================================================================
// 6. THE LANE — WHICH STEPS REACH V3 AT ALL
// ===========================================================================

function configureSendEnvironment() {
  process.env.EMAIL_UNSUB_SECRET = "proof-email-inputs-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  global.fetch = async () => {
    throw new Error("composing a dry-run email must not reach the network");
  };
}

function sendableProspect() {
  return {
    prospect_id: "harbor-ridge-lane",
    business_name: "Harbor Ridge Roofing",
    city: "Ventura",
    industry: "roofing",
    email: "owner@harborridgeroofing.com",
    preview_url: PREVIEW,
    current_website: "https://harborridgeroofing.com/",
    before_shot_source_url: "https://www.harborridgeroofing.com/",
  };
}

async function composeStep(step, flag) {
  configureSendEnvironment();
  if (flag === undefined) delete process.env.GHOST_AGENCY_PROOF_EMAIL_V3;
  else process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = flag;
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: sendableProspect(),
    sequence: 1,
    step,
    dryRun: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

// Copy that exists in the V3 shell and nowhere else.
const V3_ONLY = "IT IS ALREADY BUILT. HERE IS THE HONEST MATH.";
// Copy that exists in the V2 proof shell and nowhere else.
const V2_ONLY = "It's already built. Here's the honest math.";

test("only sequence 1 step 1 is composed by V3 — follow-ups never are", async () => {
  const step1 = await composeStep(1, undefined);
  assert.ok(visibleText(step1.htmlPreview).includes(V3_ONLY), "step 1 should be V3 by default");

  // V3 has no concept of the step-2/3 copy: it takes no bodyText, so handing it
  // a follow-up would render the full proof pitch under a follow-up's text
  // half — one message shipping as two different emails.
  for (const step of [2, 3]) {
    const result = await composeStep(step, undefined);
    const visible = visibleText(result.htmlPreview);
    assert.ok(!visible.includes(V3_ONLY), `step ${step} was composed by V3`);
    assert.ok(!visible.includes("$149"), `step ${step} carried the V3 price card`);
    assert.ok(!visible.includes("WALKTHROUGH"), `step ${step} carried the V3 reply card`);
    // It renders its OWN copy, in both halves. (Sentences updated 2026-08-10
    // with the owner-approved follow-up rewrite; the assertion is unchanged.)
    assert.ok(
      visible.includes("The website WSS Labs built for Harbor Ridge Roofing is ready to review.")
      || visible.includes("WSS Labs built a website for Harbor Ridge Roofing and kept the preview available for review."),
      visible.slice(0, 300),
    );
  }
});

test("warm and intake sequences are never composed by V3 either", async () => {
  configureSendEnvironment();
  delete process.env.GHOST_AGENCY_PROOF_EMAIL_V3;
  const { sendSequenceStep } = require("../lib/email");
  for (const sequence of [2, 3]) {
    const result = await sendSequenceStep({
      prospect: sendableProspect(), sequence, step: 1, dryRun: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const visible = visibleText(result.htmlPreview);
    assert.ok(!visible.includes(V3_ONLY), `sequence ${sequence} was composed by V3`);
    assert.ok(visible.includes("Thanks for replying."));
  }
});

test("turning the flag off returns step 1 to V2, with no other change", async () => {
  const off = await composeStep(1, "false");
  const visible = visibleText(off.htmlPreview);
  assert.ok(visible.includes(V2_ONLY), "step 1 did not fall back to the V2 shell");
  assert.ok(!visible.includes(V3_ONLY));

  // The envelope is identical either way: same subject contract, same masked
  // recipient, same owner-lane markers, same compliance surfaces.
  const on = await composeStep(1, "true");
  assert.equal(off.subject, on.subject);
  assert.equal(off.to, on.to);
  assert.deepEqual(off.cc, on.cc);
  assert.deepEqual(off.bcc, on.bcc);
  assert.equal(off.campaignLogPersisted, on.campaignLogPersisted);
  assert.equal(off.previewExpiresOn, on.previewExpiresOn);
  // The one-click unsubscribe headers are the same SHAPE on both lanes. The
  // token itself embeds a signing timestamp, so two composes a millisecond
  // apart legitimately differ — comparing the raw strings would assert a clock,
  // not a contract.
  assert.deepEqual(Object.keys(off.headers).sort(), Object.keys(on.headers).sort());
  assert.equal(off.headers["List-Unsubscribe-Post"], on.headers["List-Unsubscribe-Post"]);
  for (const headers of [off.headers, on.headers]) {
    assert.match(headers["List-Unsubscribe"], /^<https:\/\/ghost\.wss-ai\.com\/api\/outreach\/unsubscribe\?t=[\w-]+\.[\w-]+>$/);
  }
});

test("both lanes ship exactly one opt-out promise per half, and the same one", async () => {
  for (const flag of ["true", "false"]) {
    const result = await composeStep(1, flag);
    const promise = "Not interested? Reply STOP and you won't hear from me again.";

    const textStops = result.composedText.split(/\r?\n/).filter((line) => /\bSTOP\b/.test(line));
    assert.equal(textStops.length, 1, `flag=${flag} text half: ${JSON.stringify(textStops)}`);
    assert.equal(textStops[0].trim(), promise);

    const htmlStops = String(result.htmlPreview)
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .split(/<[^>]*>/)
      .map((chunk) => chunk.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
      .filter((chunk) => /\bSTOP\b/.test(chunk));
    assert.equal(htmlStops.length, 1, `flag=${flag} HTML half: ${JSON.stringify(htmlStops)}`);
    assert.equal(htmlStops[0], promise);

    // Postal address and a live unsubscribe link in the HTML half, both lanes.
    assert.ok(result.htmlPreview.includes("655 S Main St, Suite 200, Orange, CA 92868"));
    assert.match(result.htmlPreview, /\/api\/outreach\/unsubscribe\?/);
  }
});

test("on the V3 lane the two MIME halves are two renderings of ONE email", async () => {
  const result = await composeStep(1, "true");
  const visible = visibleText(result.htmlPreview);
  const text = result.composedText;

  // The load-bearing claims must appear in BOTH halves. The July defect was a
  // message whose HTML said one thing and whose text said another, with the
  // reader's mail client picking which one they saw.
  for (const claim of [
    "Harbor Ridge Roofing",
    "$149",
    "WALKTHROUGH",
    "Worst case, you got a free look at a better version of your site.",
  ]) {
    assert.ok(visible.includes(claim), `HTML half lost "${claim}"`);
    assert.ok(text.includes(claim), `text half lost "${claim}"`);
  }

  // And the text half must not carry the RETIRED V2 body — that would be the
  // two-different-emails defect in its original direction.
  assert.ok(!text.includes("I went ahead and rebuilt the site as a free live preview"));
  assert.ok(!text.includes(V2_ONLY));

  // The preview link is the one CTA, and it is in both halves.
  assert.ok(text.includes(PREVIEW));
  assert.ok(result.htmlPreview.includes(PREVIEW));
});

test("the V3 lane links no host but ours, the prospect's own, or a tel:/mailto:", async () => {
  const result = await composeStep(1, "true");
  const hrefs = [...new Set([...String(result.htmlPreview).matchAll(/\bhref="([^"]+)"/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&")))];
  assert.ok(hrefs.length > 0);
  for (const href of hrefs) {
    assert.match(
      href,
      /^(?:https:\/\/(?:[a-z0-9-]+\.)*(?:wss-ai\.com|harborridgeroofing\.com)\/|tel:\+[0-9]+$|mailto:)/i,
      `V3 linked a host that is not ours: ${href}`,
    );
  }
  // THE ONLY PAYMENT DESTINATION IS OUR OWN SIGNED ROUTE (narrowed 2026-08-08).
  //
  // This read `doesNotMatch(/buy\.stripe|checkout|Launch my site/i)` — "no
  // payment link, ever". That was right while the email printed a price as its
  // largest object and gave the reader nowhere to act on it; it is not the rule
  // any more, because the whole machine past payment was live and unreachable.
  // The rule that actually protects a prospect is narrower and stronger: a
  // third-party payment host in a cold email is refused BY NAME, and every href
  // still has to belong to us or to them (asserted immediately above). The
  // positive case — that the button exists, is signed, and verifies — is proven
  // against the composed email in test/checkout-loop.test.js.
  assert.doesNotMatch(
    result.htmlPreview,
    /buy\.stripe\.com|checkout\.stripe\.com|paypal|venmo|cash\.app|Launch my site/i,
  );
});
