"use strict";

// A customer's analytics tag must not be able to make their own site
// un-rebuildable. Measured 2026-08-11 on wss-test-rimrock-plumbing-billings:
// the tag was installed and firing correctly in a real browser, and the next
// rebuild refused with `render: failed_requests:2 | console_errors:2` — both
// of them googletagmanager.com and google-analytics.com, unreachable from
// inside the build's serverless Chromium and counted twice each.

const test = require("node:test");
const assert = require("node:assert/strict");

const { isTagVendorUrl, TAG_VENDOR_HOSTS } = require("../lib/mirror-engine/verify");

test("the exact URLs that refused a real rebuild are recognised as tag traffic", () => {
  const seen = [
    "https://www.googletagmanager.com/gtag/js?id=G-4Q7RSTVWX2",
    "https://www.google-analytics.com/g/collect?v=2&tid=G-4Q7RSTVWX2&gtm=45je6871za200",
    "https://connect.facebook.net/en_US/fbevents.js",
    "https://www.clarity.ms/tag/abcdefghij",
  ];
  for (const url of seen) assert.equal(isTagVendorUrl(url), true, url);
});

test("a console error carrying the URL is recognised too — one dead tag, not two defects", () => {
  const text = "Failed to load resource: net::ERR_NAME_NOT_RESOLVED https://www.googletagmanager.com/gtag/js?id=G-4Q7RSTVWX2";
  assert.equal(isTagVendorUrl(text), true);
});

test("the site's own assets are never exempt — a broken page is still a broken page", () => {
  const ours = [
    "https://wss-test-rimrock-plumbing-billings.wss-ai.com/assets/hero.mp4",
    "https://wss-test-rimrock-plumbing-billings.wss-ai.com/assets/index-abc123.js",
    "https://images.example.com/client-photo.jpg",
    "https://fonts.gstatic.com/s/anton/v25/x.woff2",
    "https://maps.googleapis.com/maps/api/js?key=x",
  ];
  for (const url of ours) assert.equal(isTagVendorUrl(url), false, url);
});

test("the match is on host boundaries, so a lookalike domain is not exempt", () => {
  const lookalikes = [
    "https://www.google-analytics.com.evil.test/collect",
    "https://www.googletagmanager.com.attacker.example/gtag/js",
    "https://notwww.clarity.ms.evil.test/tag/x",
  ];
  for (const url of lookalikes) assert.equal(isTagVendorUrl(url), false, url);
});

test("every exempt host is a real host, listed once, and lower-case", () => {
  assert.ok(TAG_VENDOR_HOSTS.length > 0);
  assert.equal(new Set(TAG_VENDOR_HOSTS).size, TAG_VENDOR_HOSTS.length);
  for (const host of TAG_VENDOR_HOSTS) {
    assert.equal(host, host.toLowerCase());
    assert.match(host, /^[a-z0-9.-]+\.[a-z]{2,}$/);
  }
});

test("every origin our own tracking-tag op can install is covered by the exemption", () => {
  const { TRACKING_VENDORS } = require("../lib/site-change-plan");
  for (const [key, spec] of Object.entries(TRACKING_VENDORS)) {
    for (const origin of spec.origins || []) {
      assert.equal(isTagVendorUrl(`${origin}/whatever.js`), true, `${key} -> ${origin}`);
    }
  }
});

test("nothing is exempt by accident: empty, null and a bare hostname are not tag URLs", () => {
  for (const value of ["", null, undefined, "www.google-analytics.com", "google-analytics"]) {
    assert.equal(isTagVendorUrl(value), false, String(value));
  }
});
