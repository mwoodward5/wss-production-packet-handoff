"use strict";

// test/site-weakness.test.js — the weakness probe + its effect on the
// opportunity ranking. The core guarantee: a rich business with an ugly site
// must outrank a rich business with a great site (the target-buyer thesis),
// which the old hardcoded status:200 made impossible.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { analyzeWebsite, reviewRecencyDays } = require("../lib/site-weakness");

const UGLY = '<html><head><script src="https://img1.wsimg.com/godaddy/x.js"></script></head><body>'
  + "Roofing ".repeat(40) + "<footer>&copy; 2019</footer></body></html>";
const GREAT = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<script src="/_next/static/x.js"></script><script type="application/ld+json">{}</script></head><body>'
  + "Quality roofing services in Tucson ".repeat(120) + "reviews testimonial star</body></html>";

test("analyzeWebsite reads real weakness signals from ugly HTML", () => {
  const w = analyzeWebsite({ url: "https://x.godaddysites.com/", status: 200, html: UGLY, elapsedMs: 5200, ok: true });
  assert.equal(w.exists, true);
  assert.equal(w.mobile, false);
  assert.equal(w.thin, true);
  assert.equal(w.hasSchema, false);
  assert.equal(w.builder, "godaddysites");
  assert.ok(w.ageYears >= 4);
  assert.ok(w.signals.some((s) => /mobile viewport/.test(s)));
  assert.equal(w.modernPremium, false);
});

test("analyzeWebsite recognizes a genuinely modern site as premium", () => {
  const w = analyzeWebsite({ url: "https://summithvac.com/", status: 200, html: GREAT, elapsedMs: 500, ok: true });
  assert.equal(w.mobile, true);
  assert.equal(w.thin, false);
  assert.equal(w.hasSchema, true);
  assert.equal(w.modernPremium, true);
});

test("a dead/blocked site reports high weakness, never a false healthy", () => {
  const w = analyzeWebsite({ url: "https://metroconcrete.com/", status: 503, html: "", ok: false, failure: "http_503" });
  assert.equal(w.status, 503);
  assert.ok(w.signals.some((s) => /HTTP 503|unreachable/.test(s)));
});

test("no website is exists:false, not a fabricated status:200", () => {
  const w = analyzeWebsite({ url: "" });
  assert.equal(w.exists, false);
  assert.equal(w.status, null);
});

test("runningAds detected from tracking markup", () => {
  const w = analyzeWebsite({ url: "https://x.com/", status: 200, html: '<script src="https://www.googleadservices.com/pagead/conversion.js"></script>foo bar baz', ok: true });
  assert.equal(w.runningAds, true);
});

test("reviewRecencyDays comes from the newest review", () => {
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  assert.ok(reviewRecencyDays([{ publishTime: old }, { publishTime: recent }]) <= 6);
  assert.equal(reviewRecencyDays([]), null);
});

test("RANKING: rich+ugly outranks rich+great, and poor+ugly sinks", async () => {
  const { scoreLead } = await import(pathToFileURL(path.join(__dirname, "..", "asset-pipeline", "opportunity-score.mjs")).href);
  const fromProbe = (over, probe) => ({
    gbpClaimed: true, hasEmail: true, ...over,
    runningAds: Boolean(probe.runningAds),
    website: {
      exists: probe.exists, status: probe.status, https: probe.https, mobile: probe.mobile,
      thin: probe.thin, hasSchema: probe.hasSchema, builder: probe.builder, loadMs: probe.loadMs,
      ageYears: probe.ageYears, modernPremium: probe.modernPremium,
    },
  });
  const richUgly = scoreLead(fromProbe(
    { name: "Ace Roofing", category: "roofing", rating: 4.8, reviewCount: 412, reviewRecencyDays: 12 },
    analyzeWebsite({ url: "https://ace.godaddysites.com/", status: 200, html: UGLY, elapsedMs: 5200, ok: true }),
  ));
  const richGreat = scoreLead(fromProbe(
    { name: "Summit HVAC", category: "hvac", rating: 4.9, reviewCount: 520, reviewRecencyDays: 8 },
    analyzeWebsite({ url: "https://summithvac.com/", status: 200, html: GREAT, elapsedMs: 500, ok: true }),
  ));
  const poorUgly = scoreLead(fromProbe(
    { name: "Tiny Handyman", category: "handyman", rating: 4.2, reviewCount: 8, reviewRecencyDays: 200 },
    analyzeWebsite({ url: "https://tiny.wixsite.com/x", status: 200, html: UGLY, elapsedMs: 4800, ok: true }),
  ));
  assert.ok(richUgly.score > richGreat.score, `rich+ugly (${richUgly.score}) must beat rich+great (${richGreat.score})`);
  assert.ok(richUgly.score > poorUgly.score, "rich+ugly must beat poor+ugly");
  assert.equal(richUgly.tier, "A");
  assert.ok(poorUgly.tier === "C" || poorUgly.tier === "D", "no-demand lead is not a priority");
  assert.ok(richUgly.reasons.some((r) => /demand/i.test(r)) && richUgly.weakness >= 60);
});
