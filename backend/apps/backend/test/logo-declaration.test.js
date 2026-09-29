"use strict";

// test/logo-declaration.test.js
//
// WHY THIS EXISTS, measured 2026-08-06: a 250-candidate plumbing mine produced
// 17 build-ready leads and 3 of them (18%) shipped ANOTHER COMPANY'S MARK as the
// client's identity, every one with brand_check "passed".
//
//   Smith & Sons Plumbing  picked logo-04-free-img.png — alt="Google Reviews
//                          logo". Measured accent #3175f2: Google blue became
//                          their brand colour. Their real mark,
//                          class="custom-logo" alt="Smith and Sons San Antonio
//                          Texas Plumbers", was on the same page.
//   Murray Plumbing Co     picked LightRay_Logo.svg, class="swiper-slide-image"
//                          — a partner-carousel slide. Real mark Asset-1-3.svg,
//                          alt="primary murray logo", same page.
//   Today's Homeowner      picked find-a-pro-logo-300x138.png over its own
//                          th-logo.png, alt="Today's Homeowner".
//
// The scorer awarded -100 for the string "logo" in the FILENAME and nothing for
// class="custom-logo". A filename denylist could never have caught these: none
// of those filenames name anything.
//
// EVERY FIXTURE HERE IS A REAL EXCERPT of the live page, byte-for-byte, with the
// site's own nesting preserved (see test/fixtures/logo-declaration/*.html). None
// of it is markup written to make a test pass — that is the point: hand-written
// markup would have been written to the shape of the fix, and the shape of the
// fix is exactly what was wrong before.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { rankLogoCandidates, findLogoCandidates, attrOf } = require("../lib/web-brand");
const { isThirdPartyMark } = require("../lib/capture-brand");

const FIX = path.join(__dirname, "fixtures", "logo-declaration");
const load = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const rank = (name, site, business) => rankLogoCandidates(load(name), site, business);
const reasons = (r, url) => r.rejected.filter((x) => x.url === url).flatMap((x) => [x.why, ...(x.also || [])]);

// ---------------------------------------------------------------------------
// THE THREE LEAKS
// ---------------------------------------------------------------------------

test("Smith & Sons: the custom-logo mark wins and the Google/Facebook/Yelp badges are refused", () => {
  const r = rank("smith-and-sons-google-badge.html", "https://smithandsonstx.com/", "Smith & Sons Plumbing");

  // The FULL-SIZE original, not the -351x167 crop the page happens to put in
  // `src`. Both are declared on the same custom-logo <img> — the fixture's own
  // srcset lists "…-351x167.png 351w, …-300x142.png 300w, …TXplumbing.png 379w"
  // — and the picker now prefers the original over any crop of itself
  // (web-brand/isSizedDerivative, added 2026-08-07 after bulldogrooter.com
  // shipped a 150x58 crop of its own 296x114 mark as a header logo).
  //
  // Verified by DECODING the live bytes rather than reading the filenames:
  // the crop is 351x167 and the original is 379x180, both measure accent
  // #db7739, and both are the same artwork. Same mark, same identity, same
  // winning signal — strictly more resolution.
  assert.equal(
    r.candidates[0].url,
    "https://smithandsonstx.com/wp-content/uploads/2021/07/smithandsonsTXplumbing.png",
  );
  assert.equal(r.candidates[0].signal, "class=custom-logo");
  // The crop is still a candidate, just behind its original — the miner must be
  // able to fall back to it if the full-size file ever 404s.
  assert.ok(r.candidates.some((c) => c.url.endsWith("smithandsonsTXplumbing-351x167.png")));

  // The mark that actually shipped. It must not merely rank lower — it must be
  // gone, because the miner walks the list when a download or an accent fails.
  const badges = [
    "https://smithandsonstx.com/wp-content/uploads/2018/10/logo-04-free-img.png",
    "https://smithandsonstx.com/wp-content/uploads/2018/10/logo-03-free-img.png",
    "https://smithandsonstx.com/wp-content/uploads/2018/10/logo-02-free-img.png",
  ];
  for (const badge of badges) {
    assert.ok(!r.candidates.some((c) => c.url === badge), `${badge} is still a candidate`);
  }

  // …and refused on the page's own words, not on the filename.
  assert.deepEqual(
    r.rejected.find((x) => x.url === badges[0]).detail,
    "Google Reviews logo",
  );
  assert.ok(reasons(r, badges[1]).includes("links_to_third_party_profile"));
  assert.ok(reasons(r, badges[2]).includes("links_to_third_party_profile"));
  // The numbered-strip backstop fires on all three independently.
  for (const badge of badges) assert.ok(reasons(r, badge).includes("numbered_sibling_strip"), badge);
});

test("Murray: the home-linked header mark wins; the partner carousel is refused", () => {
  const r = rank("murray-partner-carousel.html", "https://murrayplumbing.com/", "Murray Plumbing Co");

  assert.equal(r.candidates[0].url, "https://murrayplumbing.com/wp-content/uploads/2023/02/Asset-1-3.svg");
  assert.match(r.candidates[0].signal, /header\+home-link, alt names murray/);

  const slides = [
    "https://murrayplumbing.com/wp-content/uploads/2024/02/LightRay_Logo.svg",   // what shipped
    "https://murrayplumbing.com/wp-content/uploads/2024/02/drop_logo-PNG.webp",
  ];
  for (const slide of slides) {
    assert.ok(!r.candidates.some((c) => c.url === slide), `${slide} is still a candidate`);
    assert.ok(reasons(r, slide).includes("carousel_or_partner_strip"), slide);
  }
});

test("Today's Homeowner: its own header wordmark wins over the Find-a-Pro sub-brand", () => {
  const r = rank("todays-homeowner-find-a-pro.html", "https://todayshomeowner.com/", "Today's Homeowner Media");

  assert.equal(
    r.candidates[0].url,
    "https://todayshomeowner.com/wp-content/themes/generatepress_child/assets/images/th-logo.png",
  );
  assert.match(r.candidates[0].signal, /alt names today\/homeowner/);
  assert.ok(!r.candidates.some((c) => /find-a-pro/.test(c.url)));

  // th-logo.png is a greyscale wordmark and measures no accent, so the miner
  // walks on. The next candidate must still be THEIR mark: the page's own
  // schema.org Organization.logo, not the nearest logo-shaped filename.
  assert.equal(r.candidates[1].url, "https://todayshomeowner.com/wp-content/uploads/2023/04/footerLogo.png");
  assert.equal(r.candidates[1].signal, "schema.org logo");
});

// ---------------------------------------------------------------------------
// THE 14 THAT WERE ALREADY RIGHT — these must not regress
// ---------------------------------------------------------------------------

test("Liberty: class=custom-logo outranks the schema logo, and a plugin's Google badge is refused", () => {
  const r = rank("liberty-custom-logo.html", "https://libertyplumbingllc.com/", "Liberty Plumbing");
  assert.equal(
    r.candidates[0].url,
    "https://libertyplumbingllc.com/wp-content/uploads/2026/03/cropped-LibertyPlumbingLogo2026.png",
  );
  assert.equal(r.candidates[0].signal, "class=custom-logo");
  assert.ok(!r.candidates.some((c) => /powered_by_google/.test(c.url)));
});

test("Local Plumbing: the header mark is found even though nothing in its markup says \"logo\"", () => {
  // The whole point of reading declarations. This file is named
  // Local-Plumbing-SOLID.jpg with alt="" — the old filename scorer could not see
  // it at all, so the build shipped the site's 300x300 favicon instead.
  const r = rank("local-plumbing-unnamed-header-mark.html", "https://localplumbingllc.net/", "Local Plumbing LLC");
  assert.equal(r.candidates[0].url, "https://localplumbingllc.net/wp-content/uploads/2022/07/Local-Plumbing-SOLID.jpg");
  assert.match(r.candidates[0].signal, /header\+home-link/);

  // Corroboration from the page itself: its schema.org Organization.logo names
  // that exact file.
  const { schemaLogoUrls } = require("../lib/web-brand");
  assert.ok(schemaLogoUrls(load("local-plumbing-unnamed-header-mark.html"))
    .some((u) => u.endsWith("/Local-Plumbing-SOLID.jpg")));

  // The favicon survives as the tail of the declared set — an apple-touch-icon
  // is the site's own icon by spec, so it can never be a third party's mark.
  assert.ok(r.candidates.some((c) => c.signal === "rel=apple-touch-icon"));
  // Review badges on the client's own domain are still refused.
  for (const junk of ["/BBB.png", "/yelp.png", "/google-reviews.png"]) {
    assert.ok(!r.candidates.some((c) => c.url.endsWith(junk)), junk);
  }
});

test("Ray's Plumbing: review-author-logo.png is refused on context, not on its name", () => {
  const r = rank("rays-review-author-badge.html", "https://www.rayplumbingchattanooga.com/", "Ray's Plumbing");
  assert.equal(
    r.candidates[0].url,
    "https://www.rayplumbingchattanooga.com/wp-content/uploads/2024/12/rays-plumbing-logo.png",
  );
  const author = "https://www.rayplumbingchattanooga.com/wp-content/uploads/2024/12/review-author-logo.png";
  assert.ok(!r.candidates.some((c) => c.url === author));
  assert.ok(reasons(r, author).includes("badge_or_review_context"));
});

test("AccuTemp: a university's mark and a calendar icon in the same home link are both refused", () => {
  const r = rank("accutemp-lsu-and-header.html", "https://www.accutempbr.com/", "AccuTemp Services");
  assert.equal(r.candidates[0].url, "https://www.accutempbr.com/wp-content/uploads/2024/06/cropped-accutemp-logo.png");

  // accutemp-lsu-logo-1.png: LSU's mark, on the client's own domain, with
  // "logo" in the filename. It was candidate #3 under the old scorer.
  assert.ok(!r.candidates.some((c) => /lsu-logo/.test(c.url)));
  // The header's home link also wraps a calendar icon; only the first mark in
  // that slot is the brand.
  assert.ok(!r.candidates.some((c) => /calendar_clock/.test(c.url)));
});

test("Quarter Moon: association badges in a swiper are refused, the header mark is kept", () => {
  const r = rank("quarter-moon-swiper-badges.html", "https://quartermoonplumbing.com/", "Quarter Moon Plumbing, AC & Heating");
  assert.equal(r.candidates[0].url, "https://quartermoonplumbing.com/wp-content/uploads/2026/01/quarter-moon-logo.svg");
  for (const badge of ["agclogolargeraventritech24_1", "rgbeducationfoundationlogo1_1"]) {
    assert.ok(!r.candidates.some((c) => c.url.includes(badge)), badge);
    assert.ok(r.rejected.some((x) => x.url.includes(badge) && x.why === "carousel_or_partner_strip"), badge);
  }
});

test("S&S Plumbing: the header mark is kept; both variants stay available", () => {
  const r = rank("ss-plumbing-header-mark.html", "https://www.ss-plumbing.com/", "S&S Plumbing Contractors");
  assert.equal(r.candidates[0].url, "https://www.ss-plumbing.com/wp-content/uploads/2026/06/SS-Plumbing-transparent.png");
  assert.ok(r.candidates.length >= 2);
});

test("Buddy the Plumber: a dead staging host never outranks the live one", () => {
  // Measured by fetching: the staging copy carried the better alt text and so
  // ranked first, and https://staging.buddytheplumber.com does not resolve.
  const r = rank("buddy-staging-host.html", "https://buddytheplumber.com/", "Buddy the Plumber");
  assert.equal(new URL(r.candidates[0].url).hostname, "buddytheplumber.com");
  const staging = r.candidates.findIndex((c) => /staging\./.test(c.url));
  assert.ok(staging === -1 || staging > 0, "staging must not be the pick");
});

test("Plumbco: the marketing agency's own wordmark in the footer is refused", () => {
  const r = rank("plumbco-agency-wordmark.html", "https://www.alplumbco.com/", "Plumbco");
  assert.equal(r.candidates[0].url, "https://www.alplumbco.com/images/brand/logo-dark.2411081210180.png");
  // /common/scorpion/logo/wordmark-gray.png — Scorpion built the site and signs
  // it in the footer. Same shape as every other leak: their name, our client's
  // domain, "logo" in the path.
  assert.ok(!r.candidates.some((c) => /scorpion/.test(c.url)));
});

test("Marino & Son: the header mark wins, the hero copy stays as fallback", () => {
  const r = rank("marino-header-mark.html", "https://www.marinoandson.com/", "Marino & Son Plumbing & Heating");
  assert.equal(r.candidates[0].url, "https://www.marinoandson.com/img/M&S-FlatBar.svg");
  assert.equal(r.candidates[1].url, "https://www.marinoandson.com/img/logoLarge.svg");
});

// ---------------------------------------------------------------------------
// THE POLICY: what happens when the page declares nothing
// ---------------------------------------------------------------------------

test("with no declaration and several logo-shaped files, nothing is returned", () => {
  // The three <img> tags below are Smith & Sons' real badge tags, lifted
  // verbatim, but with the surrounding markup that condemned them removed. This
  // is the guess-only path — the one the old scorer always took — and on an
  // ambiguous page it must refuse rather than choose. A build with no logo loses
  // one lead; a build with someone else's trademark is published.
  const badgesOnly = load("smith-and-sons-google-badge.html")
    .split("\n")
    .filter((line) => /^<img /.test(line) && /free-img/.test(line))
    .join("\n");
  assert.equal(badgesOnly.split("\n").length, 3);
  assert.deepEqual(findLogoCandidates(badgesOnly, "https://smithandsonstx.com/"), []);
});

test("a page that declares a logo drops every undeclared guess, however logo-shaped", () => {
  const r = rank("todays-homeowner-find-a-pro.html", "https://todayshomeowner.com/", "Today's Homeowner Media");
  assert.ok(r.declared);
  assert.ok(r.rejected.some((x) => x.why === "undeclared_filename_guess_page_declares_a_logo"));
  assert.ok(r.candidates.every((c) => c.signal !== "filename contains \"logo\""));
});

// ---------------------------------------------------------------------------
// THE DENYLIST IS A BACKSTOP — and two of its entries were refusing real marks
// ---------------------------------------------------------------------------

test("the third-party denylist no longer matches inside ordinary words", () => {
  // "epa" inside "rEPAir" — and "repair" is the commonest word in a plumbing
  // logo filename. "x-logo" inside "maXX-logo".
  assert.equal(isThirdPartyMark("https://acme.com/img/drain-repair-logo.png"), false);
  assert.equal(isThirdPartyMark("https://acme.com/img/sewer-repair.png"), false);
  assert.equal(isThirdPartyMark("https://acme.com/img/maxx-logo.png"), false);
  // …while still catching what it exists to catch.
  assert.equal(isThirdPartyMark("https://acme.com/img/epa-certified.png"), true);
  assert.equal(isThirdPartyMark("https://acme.com/img/epa_logo.svg"), true);
  assert.equal(isThirdPartyMark("https://acme.com/img/twitter-x-logo.png"), true);
  assert.equal(isThirdPartyMark("https://acme.com/img/x-logo.png"), true);
});

// ---------------------------------------------------------------------------
// EXTRACTION DETAILS THAT COST US REAL PICKS
// ---------------------------------------------------------------------------

test("attrOf reads the attribute it was asked for, not one that ends with it", () => {
  // Real tag from todayshomeowner.com: the src is a lazy-load placeholder and
  // the mark is in data-src. `\bsrc=` also matches inside `data-src=`, so the
  // two could be silently swapped.
  const tag = load("todays-homeowner-find-a-pro.html")
    .split("\n")
    .find((line) => /^<img /.test(line) && /data-src=/.test(line) && /th-logo/.test(line));
  assert.ok(tag, "fixture must contain a lazy-loaded logo tag");
  assert.match(attrOf(tag, "src"), /^data:image\/png;base64,/);
  assert.match(attrOf(tag, "data-src"), /th-logo\.png$/);
});

test("markup inside a <script> is not markup on the page", () => {
  // ss-plumbing.com embeds an escaped <img src=\"https:\/\/…\"> inside a JSON
  // blob in a <script>. The old extractor ranked that mangled string FIRST.
  const html = `<script>var x = {"html":"<img src=\\"https:\\/\\/www.ss-plumbing.com\\/junk-logo.png\\" class=\\"logo\\">"};</script>`
    + load("ss-plumbing-header-mark.html");
  const got = findLogoCandidates(html, "https://www.ss-plumbing.com/", "S&S Plumbing Contractors");
  assert.ok(got.length > 0);
  assert.ok(!got.some((u) => /junk-logo/.test(u)), "a logo inside a script tag is not on the page");
});
