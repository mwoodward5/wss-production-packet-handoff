"use strict";

// Regression: a client's OWN Google Business homepage arrives with client-side
// UTM params (e.g. metrofence.net/?utm_source=google). The brand-asset denylist
// probe used to include the query, so path.basename() of the probe saw "google"
// and rejected the build with brand_asset_rejected — throwing away a legitimate
// first-party accent/logo source across every GBP-sourced lead. The probe now
// uses hostname + pathname only; the host test still catches third-party HOSTS
// and the basename test still catches named marks.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isThirdPartyMark } = require("../lib/capture-brand");

// Replicate the probe construction used in mirror-engine/brand-assets.js.
function probe(url) {
  const u = new URL(url);
  return decodeURIComponent(`${u.hostname}${u.pathname}`);
}

test("client asset URL with ?utm_source=google in the query is NOT a third-party mark", () => {
  // A first-party accent/logo source often carries a Google-attribution UTM
  // param. The query is what tripped the denylist (path.basename saw "google").
  const url = "https://truecomfortheating.com/img/hero.jpg?utm_source=google&utm_medium=gbp";
  // The OLD probe (with query) tripped the denylist — that was the bug:
  const oldProbe = (() => { const u = new URL(url); return decodeURIComponent(`${u.hostname}${u.pathname}?${u.search}`); })();
  assert.equal(isThirdPartyMark(oldProbe), true, "old query-bearing probe is the false positive we are removing");
  // The NEW probe (host + path only) passes — client keeps their own asset:
  assert.equal(isThirdPartyMark(probe(url)), false, "client-hosted asset must pass the denylist");
});

test("real third-party HOSTS are still caught (host test)", () => {
  assert.equal(isThirdPartyMark(probe("https://www.facebook.com/tr?id=123&ev=PageView")), true);
  assert.equal(isThirdPartyMark(probe("https://cdninstagram.com/v/photo.jpg")), true);
  assert.equal(isThirdPartyMark(probe("https://www.yelp.com/biz_photos/abc")), true);
});

test("named marks in the basename are still caught (basename test)", () => {
  assert.equal(isThirdPartyMark("google-reviews-logo.png"), true);
  assert.equal(isThirdPartyMark("facebook_f_logo_2021.png"), true);
});

test("a plain client asset path with no mark passes", () => {
  assert.equal(isThirdPartyMark(probe("https://metrofence.net/wp-content/uploads/2024/05/Logo-LG-Pt-Subtext.webp")), false);
});
