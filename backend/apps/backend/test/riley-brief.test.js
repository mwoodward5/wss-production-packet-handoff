"use strict";

// test/riley-brief.test.js — the contract for what Riley is allowed to SAY.
//
// Everything else this suite guards is about what we publish. This file is
// about what a synthetic voice asserts to a business owner about his own
// business, on a line he answered, with no way to take it back. So the tests
// are written as prohibitions first and features second:
//
//   1. The two sales documents are the source of truth for our own copy, and a
//      silent edit to either must fail here rather than drift into a call.
//   2. Objections 9 and 10 are EMBARGOED. Not discouraged — absent.
//   3. A fault is spoken only from a measurement that was actually taken.
//   4. A site that measured well is never attacked.
//   5. Nothing internal — lead scoring, gate notes — reaches the caller's ear.
//   6. A customer's review is quoted whole or not at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  EMBARGOED_OBJECTIONS,
  METAPHORS,
  NEVER,
  OBJECTIONS,
  customerQuote,
  rileyBrief,
  speakableFaults,
} = require("../lib/riley-brief");

const DOCS = path.join(__dirname, "..", "..", "..", "docs", "sales");
const playbook = fs.readFileSync(path.join(DOCS, "objection-playbook.md"), "utf8");
const bank = fs.readFileSync(path.join(DOCS, "riley-metaphor-bank.md"), "utf8");

/** The doc's own spoken answers, keyed by objection number. */
function spokenAnswersFromPlaybook() {
  const answers = new Map();
  const sections = playbook.split(/^## (\d+)\. /m);
  for (let i = 1; i < sections.length; i += 2) {
    const match = sections[i + 1].match(/### Right response — spoken\s*\n([\s\S]*?)\n\s*\n###/);
    if (match) answers.set(Number(sections[i]), match[1].trim());
  }
  return answers;
}

/** The doc's Riley column, keyed by row number. */
function metaphorsFromBank() {
  const rows = new Map();
  for (const line of bank.split(/\r?\n/)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.set(Number(cells[0]), cells[3]);
  }
  return rows;
}

// A real row, trimmed to the fields the brief reads. Values are the shapes
// production actually stores (grades are {grade,score} objects; the probe
// carries booleans beside its prose).
function row(overrides = {}) {
  const { record = {}, ...columns } = overrides;
  return {
    prospect_id: "p_test",
    business_name: "Ramon Roofing",
    city: "Fort Worth",
    state: "TX",
    status: "line_queued",
    ...columns,
    record: {
      rating: 4.9,
      review_count: 353,
      current_website: "https://ramonroofing.com",
      website_probe: {
        analyzed: true, exists: true, mobile: false, https: true,
        hasSchema: true, hasReviews: true, thin: false, loadMs: 900,
        signals: ["no mobile viewport — the site does not adapt to phones"],
      },
      build_ready: {
        qualification: {
          website_axis: { grade: "C+", score: 77 },
          composite_signal: { grade: "C", score: 74 },
          reasons: ["website axis grades C+ (77) — at or under C+"],
        },
      },
      opportunity: {
        tier: "A", score: 94, lane: "email",
        reasons: [
          "High-ticket trade — margin to invest in a better site",
          "Already spends on ads — pays to be found, but the site underdelivers",
        ],
      },
      ...record,
    },
  };
}

function saidAloud(brief) {
  return [
    ...brief.points.map((point) => point.say),
    ...brief.answers.map((answer) => answer.say),
    ...(brief.objections || []).map((objection) => objection.say),
    ...brief.unknown,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 1. OUR OWN COPY IS THE DOCUMENTS' COPY
// ---------------------------------------------------------------------------

test("every objection Riley may speak is the playbook's own sentence, verbatim", () => {
  const fromDoc = spokenAnswersFromPlaybook();
  assert.equal(fromDoc.size, 16, "the playbook should carry all 16 documented objections");
  assert.deepEqual([...fromDoc.keys()], Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(OBJECTIONS.map((objection) => objection.n), [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13]);
  for (const n of [14, 15, 16]) {
    assert.equal(OBJECTIONS.find((objection) => objection.n === n), undefined,
      `objection ${n} requires conditional grounding before Riley may speak it`);
  }
  for (const objection of OBJECTIONS) {
    const doc = fromDoc.get(objection.n);
    assert.ok(doc, `playbook lost objection ${objection.n}`);
    // The doc wraps the spoken line in quotes; Riley is handed the sentence.
    assert.equal(doc, `“${objection.say}”`, `objection ${objection.n} drifted from the playbook`);
  }
});

test("every explanation Riley may give is the metaphor bank's own sentence, verbatim", () => {
  const fromDoc = metaphorsFromBank();
  assert.equal(fromDoc.size, 60, "the bank should still carry 60 rows");
  for (const [topic, metaphor] of Object.entries(METAPHORS)) {
    assert.equal(metaphor.full, fromDoc.get(metaphor.row), `${topic} drifted from bank row ${metaphor.row}`);
  }
});

// ---------------------------------------------------------------------------
// 2. THE EMBARGO
// ---------------------------------------------------------------------------

test("objections 9 and 10 are absent, not merely discouraged", () => {
  assert.deepEqual(EMBARGOED_OBJECTIONS.map((o) => o.n), [9, 10]);
  assert.equal(OBJECTIONS.length, 11);
  for (const n of [9, 10]) {
    assert.equal(OBJECTIONS.find((o) => o.n === n), undefined, `objection ${n} is embargoed`);
  }
  // And the sentences themselves must not reach a brief by any other door.
  const fromDoc = spokenAnswersFromPlaybook();
  const brief = rileyBrief(row(), { includeObjections: true });
  const spoken = saidAloud(brief);
  for (const n of [9, 10]) {
    const promise = fromDoc.get(n).replace(/[“”]/g, "");
    assert.ok(!spoken.includes(promise), `the embargoed answer ${n} appeared in a brief`);
  }
});

test("the brief tells Riley what to do with a cancellation or ownership question", () => {
  const brief = rileyBrief(row());
  const guard = brief.never.join(" ");
  assert.match(guard, /CANCELLING/);
  assert.match(guard, /WHO OWNS/);
  assert.match(guard, /do not answer either one/);
  // It must not substitute a promise of its own about what the terms say.
  assert.ok(!/you (own|keep) (the|your) (site|website)/i.test(guard));
});

// ---------------------------------------------------------------------------
// 3. A FAULT NEEDS A MEASUREMENT
// ---------------------------------------------------------------------------

test("no fault is spoken when the probe never ran", () => {
  for (const probe of [
    undefined,
    {},
    { analyzed: false, exists: true, mobile: false },
    { analyzed: true, exists: false, mobile: false },
  ]) {
    assert.deepEqual(speakableFaults(row({ record: { website_probe: probe } })), []);
  }
});

test("an ABSENT measurement is never a fault — only a measured false is", () => {
  // The probe ran and found the site, but says nothing about mobile or schema.
  const quiet = row({ record: { website_probe: { analyzed: true, exists: true, loadMs: 800 } } });
  assert.deepEqual(speakableFaults(quiet), []);

  const measured = row({
    record: { website_probe: { analyzed: true, exists: true, mobile: false, loadMs: 800 } },
  });
  assert.equal(speakableFaults(measured).length, 1);
  assert.equal(speakableFaults(measured)[0].topic, "mobile");
});

test("a spoken fault carries the exact field that produced it", () => {
  const faults = speakableFaults(row({
    record: {
      website_probe: {
        analyzed: true, exists: true, mobile: false, https: false,
        hasReviews: false, hasSchema: false, thin: true, wordCount: 213, loadMs: 6000,
        signals: ["copyright still says 2019 — stale for 7 years"],
      },
    },
  }));
  const byTopic = Object.fromEntries(faults.map((fault) => [fault.topic, fault]));
  assert.equal(byTopic.mobile.src, "record.website_probe.mobile=false");
  assert.equal(byTopic.ssl.src, "record.website_probe.https=false");
  assert.equal(byTopic.reviews.src, "record.website_probe.hasReviews=false");
  assert.equal(byTopic.schema.src, "record.website_probe.hasSchema=false");
  assert.equal(byTopic.speed.src, "record.website_probe.loadMs=6000");
  assert.equal(byTopic.content.src, "record.website_probe.wordCount=213");
  // Numbers spoken are the numbers measured, not rounded into a story.
  assert.match(byTopic.speed.say, /6\.0 seconds/);
  assert.match(byTopic.content.say, /about 213 words/);
  // The copyright YEAR is read out of the probe's own sentence, never derived.
  assert.match(byTopic.stale.say, /still says 2019/);
});

test("a copyright year is only spoken when the probe wrote one down", () => {
  const noYear = speakableFaults(row({
    record: { website_probe: { analyzed: true, exists: true, signals: ["built on divi — DIY template, upgradeable"] } },
  }));
  assert.equal(noYear.find((fault) => fault.topic === "stale"), undefined);
});

// ---------------------------------------------------------------------------
// 4. A GOOD SITE IS NOT ATTACKED
// ---------------------------------------------------------------------------

test("a site measuring B- or better is never criticised, and Riley is told why", () => {
  for (const grade of ["B-", "B", "B+", "A-", "A", "A+"]) {
    const brief = rileyBrief(row({
      record: {
        build_ready: { qualification: { website_axis: { grade, score: 88 } } },
        website_probe: {
          analyzed: true, exists: true, mobile: false, https: false, hasSchema: false,
        },
      },
    }));
    const faultSaid = brief.points.some((point) => point.src.includes("website_probe"));
    assert.equal(faultSaid, false, `${grade} site was criticised`);
    assert.ok(
      brief.unknown.some((line) => line.includes("do not tell them it is bad")),
      `${grade} site: Riley was not told to leave it alone`,
    );
  }
});

test("a site measuring C+ or worse may be discussed, at most two faults", () => {
  const brief = rileyBrief(row({
    record: {
      build_ready: { qualification: { website_axis: { grade: "C+", score: 77 } } },
      website_probe: {
        analyzed: true, exists: true, mobile: false, https: false,
        hasSchema: false, hasReviews: false, thin: true, wordCount: 40, loadMs: 7000,
      },
    },
  }));
  const faults = brief.points.filter((point) => point.src.includes("website_probe"));
  assert.equal(faults.length, 2, "a call is not an audit — two faults is the cap");
});

// ---------------------------------------------------------------------------
// 5. NOTHING INTERNAL REACHES THE CALLER
// ---------------------------------------------------------------------------

test("lead-scoring reasons and gate notes never appear in anything Riley says", () => {
  const brief = rileyBrief(row(), { includeObjections: true });
  const spoken = saidAloud(brief);
  for (const forbidden of [
    "High-ticket trade",
    "margin to invest",
    "Already spends on ads",
    "underdelivers",
    "DIY template",
    "grade gate is off",
    "at or under C+",
    "website axis grades",
  ]) {
    assert.ok(!spoken.includes(forbidden), `internal phrase reached the caller: ${forbidden}`);
  }
});

test("every point carries a source; none is generated to fill a slot", () => {
  const brief = rileyBrief(row());
  assert.ok(brief.points.length > 0);
  for (const point of brief.points) {
    assert.ok(point.say && point.say.trim(), "a point with no sentence");
    assert.ok(point.src && point.src.trim(), `no source for: ${point.say}`);
  }
});

test("a row with nothing measured produces an empty brief that says so", () => {
  const brief = rileyBrief({ prospect_id: "p_bare", business_name: "Bare Co", record: {} });
  assert.deepEqual(brief.points, []);
  assert.equal(brief.who, "Bare Co");
  assert.ok(brief.unknown.some((line) => line.includes("Do not invent a fault")));
  assert.deepEqual(brief.never, NEVER);
});

test("an empty object does not throw", () => {
  const brief = rileyBrief({});
  assert.deepEqual(brief.points, []);
  assert.equal(typeof brief.who, "string");
});

// ---------------------------------------------------------------------------
// 6. A REVIEW IS QUOTED WHOLE OR NOT AT ALL
// ---------------------------------------------------------------------------

const REVIEWS = [
  { text: "Jon was great and very thorough. He explained everything he was doing to fix the system and taught me in detail about the parts he replaced and why they had failed in the first place, which I appreciated a great deal.", author: "Priya", rating: 5 },
  { text: "Exceptional service and extremely respectful. Got the job done and now its cool in here. Thanks so much.", author: "Matt Whalen", rating: 5 },
];

test("the quote is the shortest usable review, unedited", () => {
  const quote = customerQuote(row({ record: { build_ready: { mirror_request: { content: { reviews: REVIEWS } } } } }));
  assert.equal(quote.author, "Matt Whalen");
  assert.equal(quote.body, REVIEWS[1].text);
});

test("a long review is dropped, never trimmed into a misquote", () => {
  const long = [{ text: `${"x".repeat(400)}`, author: "Dana", rating: 5 }];
  assert.equal(customerQuote(row({ record: { build_ready: { mirror_request: { content: { reviews: long } } } } })), null);
});

test("invisible marks are stripped but no visible character changes", () => {
  const withMarks = [{
    text: `​Great crew.​ They\nshowed up on time.﻿`,
    author: "Sam",
    rating: 5,
  }];
  const quote = customerQuote(row({ record: { build_ready: { mirror_request: { content: { reviews: withMarks } } } } }));
  assert.equal(quote.body, "Great crew. They showed up on time.");
});

test("a review with no author is not quoted — an anonymous quote is unverifiable", () => {
  const anonymous = [{ text: "Great work.", rating: 5 }];
  assert.equal(customerQuote(row({ record: { build_ready: { mirror_request: { content: { reviews: anonymous } } } } })), null);
});

// ---------------------------------------------------------------------------
// 7. WHAT OURS CARRIES — CLAIMED ONLY FROM BUILD EVIDENCE
// ---------------------------------------------------------------------------

const BUILT = {
  preview_url: "https://wss-test-ramon-roofing-fort-worth.wss-ai.com/",
  record: {
    build_ready: {
      qualification: { website_axis: { grade: "C+", score: 77 } },
      brand_evidence: {
        logo_url: "https://ramonroofing.com/logo.png",
        source: "prospect's own registrable domain",
        accent: "#C53F34",
        accent_origin: "measured_from_logo(png-js, share 0.22)",
      },
      mirror_request: { content: { reviews: REVIEWS, hours: [{ day: "monday", text: "8 AM–5 PM" }] } },
    },
  },
};

test("the logo claim needs evidence it came off THEIR domain", () => {
  const built = rileyBrief(row(BUILT));
  const mirrorPoint = built.points.find((point) => point.src.includes("preview_url"));
  assert.match(mirrorPoint.say, /your own logo off your own site/);

  // Same logo, evidence says it came from somewhere else: the claim disappears.
  // A manufacturer's badge has shipped as a client's identity in this system
  // before, and this is the sentence that would have announced it on a call.
  const borrowed = JSON.parse(JSON.stringify(BUILT));
  borrowed.record.build_ready.brand_evidence.source = "firecrawl_image_search";
  const guarded = rileyBrief(row(borrowed));
  const guardedPoint = guarded.points.find((point) => point.src.includes("preview_url"));
  assert.ok(!/logo/.test(guardedPoint.say), "an unowned logo was claimed as theirs");
});

test("nothing about our build is claimed when no mirror exists", () => {
  const brief = rileyBrief(row({ record: BUILT.record })); // evidence, but no preview_url
  assert.equal(brief.points.find((point) => point.src.includes("preview_url")), undefined);
});

// ---------------------------------------------------------------------------
// 8. PRIDE POINTS — WIRED, AND SILENT WITHOUT AN EXTRACTION
// ---------------------------------------------------------------------------

test("owner pride is spoken verbatim when an extraction exists", () => {
  const brief = rileyBrief(row({
    record: {
      owner_behind: {
        A_identity_brand_equity: {
          tagline_or_motto: {
            status: "FOUND",
            confidence: "high",
            value: "Creating comfort for your family!",
            evidence: [{ source_url: "https://ramonroofing.com/", quote: "Creating comfort for your family!" }],
          },
        },
      },
    },
  }));
  const pride = brief.points.find((point) => point.src.includes("owner_behind"));
  assert.ok(pride, "a found, evidenced tagline was not spoken");
  assert.match(pride.say, /“Creating comfort for your family!”/);
});

test("a low-confidence or unevidenced pride claim is never spoken", () => {
  for (const entry of [
    { status: "FOUND", confidence: "low", value: "Family owned since 1985", evidence: [{ source_url: "x", quote: "y" }] },
    { status: "FOUND", confidence: "high", value: "Family owned since 1985", evidence: [] },
    { status: "NOT FOUND", confidence: "high", value: "Family owned since 1985", evidence: [{ source_url: "x", quote: "y" }] },
  ]) {
    const brief = rileyBrief(row({
      record: { owner_behind: { A_identity_brand_equity: { tagline_or_motto: entry } } },
    }));
    assert.equal(brief.points.find((point) => point.src.includes("owner_behind")), undefined);
  }
});

// ---------------------------------------------------------------------------
// 9. SIZE — A WALL OF TEXT IS THE THING THIS WAS BUILT TO AVOID
// ---------------------------------------------------------------------------

test("a brief stays small enough to be worth sending", () => {
  const full = rileyBrief(row(BUILT));
  const lean = rileyBrief(row(BUILT), { includeObjections: false });
  assert.ok(full.points.length <= 6, "at most six points");
  assert.ok(full.answers.length <= 3, "at most three explanations");
  assert.ok(Buffer.byteLength(JSON.stringify(lean), "utf8") < 2500, "the per-prospect part must stay under 2.5 KB");
  assert.ok(Buffer.byteLength(JSON.stringify(full), "utf8") < 5000, "the whole brief must stay under 5 KB");
});

test("explanations are offered only for topics this call will actually raise", () => {
  const brief = rileyBrief(row({
    record: {
      build_ready: { qualification: { website_axis: { grade: "C+", score: 77 } } },
      website_probe: { analyzed: true, exists: true, mobile: false },
    },
  }));
  const topics = brief.answers.map((answer) => answer.on).sort();
  assert.deepEqual(topics, ["mobile", "reviews"]);
});
