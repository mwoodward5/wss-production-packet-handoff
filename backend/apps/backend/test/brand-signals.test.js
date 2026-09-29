"use strict";

// test/brand-signals.test.js — the research-sourced signal table, held to account.
//
// This table exists because a hardcoded denylist failed. It caught the two
// marks it was written from and nothing else: the next mine produced 17 leads
// of which 3 still shipped someone else's mark, because none of their filenames
// contained a denylisted token.
//
// A data file that anyone can extend is only safe if extending it cannot break
// the product. These tests are that guarantee. The second block is the one that
// matters most: a signal that refuses a real client's own logo costs us a
// customer, silently, and is far harder to notice than a missed badge.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSignals, weighCandidate, toJsPattern, CONCLUSIVE } = require("../lib/brand-signals");

test("every pattern in the table compiles for OUR regex engine", () => {
  // The source data arrived in PCRE/Python dialect — every row began with an
  // inline `(?i)`, which is a parse error in JavaScript. A row that will not
  // compile is dropped and reported rather than thrown, so one bad research
  // line cannot take the miner down; but the shipped file must have none.
  const { signals, rejected } = loadSignals();
  assert.deepEqual(rejected, [], "no shipped row may fail to compile");
  assert.ok(signals.length > 50, `expected a substantial table, got ${signals.length}`);
});

test("inline (?i) is lifted to a flag rather than left to explode", () => {
  const { source, flags } = toJsPattern("(?i)google[-_ ]reviews?");
  assert.equal(source, "google[-_ ]reviews?");
  assert.match(flags, /i/);
  assert.doesNotThrow(() => new RegExp(source, flags));
});

test("the marks that actually shipped to customers are caught", () => {
  // Each of these was live on a real mirror or was the sole cause of a lost
  // lead. If one of these ever scores zero again, we have regressed to the
  // failure this table was built for.
  const cases = [
    ["Google Reviews badge", { url: "https://smithandsonsplumbing.com/uploads/logo-04-free-img.png", alt: "Google Reviews logo" }],
    ["Mastercool trademark", { url: "https://simmonsplumbing.info/uploads/mastercool-logo10874446.png", alt: "Mastercool" }],
    ["partner carousel slide", { url: "https://murrayplumbing.com/img/LightRay_Logo.svg", alt: "LightRay_Logo", className: "swiper-slide-image" }],
    ["BBB seal", { url: "https://www.attaboyla.com/images/bbb-logo.png", alt: "BBB Accredited Business" }],
  ];
  for (const [label, candidate] of cases) {
    assert.ok(weighCandidate(candidate).score > 0, `${label} must be flagged`);
  }
});

test("a vendor's own CDN or embed script refuses outright; a filename never does", () => {
  // Nothing but Yelp serves from yelpcdn.com, so that is a verdict. A filename
  // is a guess about a string, and a business may legitimately be called
  // Carrier Plumbing — so filenames accumulate evidence, they do not decide.
  const cdn = weighCandidate({ url: "https://s3-media0.fl.yelpcdn.com/assets/yelp.png" });
  assert.equal(cdn.refuse, true);
  assert.ok(cdn.score >= CONCLUSIVE);

  const filenameOnly = weighCandidate({ url: "https://client.com/moen.png", alt: "" });
  assert.ok(filenameOnly.score > 0, "still evidence");
  assert.equal(filenameOnly.refuse, false, "a filename alone must never be a verdict");
});

// --- THE ONE THAT MATTERS ---------------------------------------------------

test("no signal touches a logo we have verified belongs to its client", () => {
  // Every entry here is a real mark from a real prospect, confirmed by reading
  // the host page's own markup. The last four are traps that a naive token list
  // gets wrong, and two of them ALREADY DID: the shipped denylist matched "epa"
  // inside "re-pa-ir" — the commonest word in a plumbing logo filename — and
  // "x[_-]logo" inside "maxx-logo.png", a client's own mark.
  const verified = [
    ["Smith & Sons", { url: "https://smithandsonsplumbing.com/uploads/smithandsonsTXplumbing-351x167.png", alt: "Smith and Sons San Antonio Texas Plumbers", className: "custom-logo" }],
    ["Rimrock", { url: "https://irp.cdn-website.com/Rimrock-Plumbing-Logo1-272w.png", alt: "Rimrock Plumbing" }],
    ["Noble", { url: "https://nobleplumbers.com/cropped-noble-plumbing-site-icon-180x180.png", alt: "Noble Plumbing" }],
    ["Goodson", { url: "https://le-cdn.hibuwebsites.com/logo-goodson-plumbing-services-1920w.png", alt: "Goodson Plumbing Services" }],
    ["North Side", { url: "https://www.northsideplumbingfw.com/logo-gold.png", alt: "North Side Plumbing & Heating" }],
    ["drain-repair (epa trap)", { url: "https://x.com/drain-repair-logo.png", alt: "Drain Repair" }],
    ["maxx-logo (x-logo trap)", { url: "https://tpwbatonrouge.com/maxx-logo.png", alt: "Maxx Plumbing" }],
    ["Carrier Plumbing (real business)", { url: "https://carrierplumbing.com/carrier-plumbing-logo.png", alt: "Carrier Plumbing" }],
    ["Goodman Plumbing (real business)", { url: "https://goodmanplumbing.com/goodman-logo.png", alt: "Goodman Plumbing" }],
    ["Front Porch Plumbing", { url: "https://frontporchplumbing.com/front-porch-logo.png", alt: "Front Porch Plumbing" }],
    ["Nate Plumbing (a person's name)", { url: "https://nateplumbing.com/nate-logo.png", alt: "Nate Plumbing" }],
  ];
  for (const [label, candidate] of verified) {
    const verdict = weighCandidate(candidate);
    assert.equal(
      verdict.score, 0,
      `${label} is a real client mark and must not be flagged — matched ${JSON.stringify(verdict.hits)}`,
    );
  }
});
