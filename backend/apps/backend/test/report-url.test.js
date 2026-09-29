"use strict";

// test/report-url.test.js — a report link must be able to RESOLVE.
//
// 63 of 75 stored report_urls pointed at nothing. HTTP status could not catch
// it: CallPrep answers 200 for every /report/* path and resolves the id in the
// browser, so every dead link looked healthy. The database is the one that
// tells the truth — its id column is a uuid, and it rejects a build slug with
// "invalid input syntax for uuid". That is the shape asserted here.

const test = require("node:test");
const assert = require("node:assert");
const { isRealReportUrl, safeReportUrl } = require("../lib/report-url");

const REAL = "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc";

test("a report on our host with a uuid id is real", () => {
  assert.equal(isRealReportUrl(REAL), true);
  assert.equal(safeReportUrl(REAL), REAL);
});

test("a build slug in a report path is refused — it can never resolve", () => {
  // lib/siteforge.js used to mint exactly this.
  assert.equal(isRealReportUrl("https://callprep.wss-ai.com/report/place-chijxyepzcbldamr-wzkp5o1nk0"), false);
  assert.equal(isRealReportUrl("https://callprep.wss-ai.com/report/wss-test-rivercity-plumbing-jacksonville"), false);
  assert.equal(safeReportUrl("https://callprep.wss-ai.com/report/some-slug"), "");
});

test("a SiteForge scorecard.json is not a customer report", () => {
  assert.equal(isRealReportUrl("https://siteforge-app-seven.vercel.app/try/skin-savvy-aesthetics-8lmq2k_hngs/scorecard.json"), false);
});

test("a foreign host is refused even with a perfect uuid", () => {
  assert.equal(isRealReportUrl("https://evil.example/report/a127cdfa-b68b-4841-919c-7b35bfc95adc"), false);
});

test("http, junk and empty are refused", () => {
  for (const bad of ["", null, undefined, "not a url", "http://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc"]) {
    assert.equal(isRealReportUrl(bad), false, String(bad));
  }
});

test("the email composer prints a real report and drops a fabricated one", () => {
  const { outreachHtmlV2 } = require("../lib/outreach-email-v2");
  const base = {
    footer: { unsubscribe: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=t", postalAddress: "1 Main St" },
    senderName: "Mark Woodward",
    senderCity: "Mission Viejo, CA",
    cta: {
      businessName: "Acme Plumbing",
      city: "Austin",
      previewUrl: "https://acme.wss-ai.com/",
      currentUrl: "https://acme.example/",
      beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a&v=old",
      afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=b&v=new",
    },
  };
  const good = outreachHtmlV2({ ...base, cta: { ...base.cta, reportUrl: REAL } });
  assert.ok(good.includes(REAL));
  assert.match(good, /Read your report/);

  const bad = outreachHtmlV2({ ...base, cta: { ...base.cta, reportUrl: "https://callprep.wss-ai.com/report/acme-plumbing-austin" } });
  assert.doesNotMatch(bad, /Read your report/, "a link that resolves to nothing must not be sent to a prospect");
});
