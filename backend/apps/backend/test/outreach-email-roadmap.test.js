"use strict";
// The report card must never state a grade we did not measure. A hardcoded
// fallback letter once put "D" in an email whose own report link rendered "B" —
// these lock that shut, and lock the road map framing to real measurements.
const test = require("node:test");
const assert = require("node:assert");
const {
  composeOutreachEmailV3,
  gradeReasonsFromCategories,
  targetGrade,
} = require("../lib/outreach-email-v3");

const BASE = {
  businessName: "Poor John's Plumbing",
  city: "Parkville",
  previewUrl: "https://example.wss-ai.com/",
  reportUrl: "https://callprep.wss-ai.com/report/abc",
};
const render = (extra) => {
  const out = composeOutreachEmailV3({ ...BASE, ...extra });
  return typeof out === "string" ? out : out.html;
};

test("a measured grade is printed with its score", () => {
  const html = render({ grade: "B", gradeScore: 85 });
  assert.match(html, />B</);
  assert.match(html, /85</);
  assert.match(html, /road map/i);
});

test("no grade means no grade tile — never a fallback letter", () => {
  const html = render({});
  assert.doesNotMatch(html, /shoot the messenger[\s\S]{0,400}?\bat a [A-F]\b/i);
  assert.doesNotMatch(html, /We measured your site at a /);
});

test("a grade that is not on the report's scale is refused, not printed", () => {
  for (const junk of ["Z", "??", "1", "unknown", "  "]) {
    const html = render({ grade: junk, gradeScore: 40 });
    assert.doesNotMatch(html, /We measured your site at a /, `printed junk grade ${JSON.stringify(junk)}`);
  }
});

test("targetGrade lifts two rungs, floors at B+, and never promises A+", () => {
  assert.equal(targetGrade("D"), "B+");   // owner's line: a D gets a B+ road map
  assert.equal(targetGrade("F"), "B+");
  assert.equal(targetGrade("B"), "A-");
  assert.equal(targetGrade("A-"), "");    // no headroom left to sell
  assert.equal(targetGrade("A+"), "");
  assert.equal(targetGrade("Z"), "");
});

test("reasons are the weakest measured categories, in plain words", () => {
  const reasons = gradeReasonsFromCategories({
    seo: { grade: "A+", score: 100, signals: [] },
    socialMedia: {
      grade: "F", score: 40,
      signals: [{ name: "instagram", observed: false }, { name: "linkedin", observed: false }],
    },
    security: { grade: "C", score: 75, signals: [{ name: "content-security-policy", observed: false }] },
  });
  assert.equal(reasons.length, 2, "a category at 90+ is not holding anyone back");
  assert.match(reasons[0], /^Social media — F, 40\/100\./);
  assert.match(reasons[0], /Instagram and LinkedIn/);
  assert.doesNotMatch(reasons.join(" "), /content-security-policy/, "engineer-speak must be translated");
  assert.match(reasons[1], /security headers/);
});

test("a business with nothing under 90 yields no complaints", () => {
  assert.deepEqual(gradeReasonsFromCategories({ seo: { grade: "A", score: 95, signals: [] } }), []);
  assert.deepEqual(gradeReasonsFromCategories(null), []);
  assert.deepEqual(gradeReasonsFromCategories({ seo: { score: "" } }), []);
});
