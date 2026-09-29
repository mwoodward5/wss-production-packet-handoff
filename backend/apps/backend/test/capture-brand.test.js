"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const brand = require("../lib/capture-brand.js");

// REGRESSION LOCK (2026-07-28).
//
// The whole point of this module is that a client's palette is MEASURED from
// their own logo instead of falling back to a generic accent. The failure mode is
// not "no colour" — it is "a confident, wrong colour", which looks fine in every
// gate and paints somebody else's identity onto the customer's site.
//
// The first run of this module did exactly that: it matched
// "1024px-Facebook_f_logo_2021_svg.png" on the substring "logo" and reported
// Facebook blue as a roofing company's brand colour.

// px is an array of [r,g,b] triples -> flat RGB24 buffer
const rgb = (px) => Buffer.from(px.flat());

test("third-party marks are never treated as the client's logo", () => {
  for (const f of [
    "1024px-Facebook_f_logo_2021_svg-5cffdccb.png", // the actual bug
    "google_logo-google_icongoogle-512-d8c97257.png",
    "homeadvisor-088a4730.png",
    "bbb-accredited-logo.png",
    "gaf-master-elite-logo.png",
    "yelp_logo.png",
    "visa-logo.png",
    "amazon-logo.png",
    "available-on-amazon-badge.svg",
    "amzn-marketplace-seal.png",
  ]) {
    assert.equal(brand.isThirdPartyMark(f), true, `${f} must be rejected as a brand source`);
  }
});

// brand-assets.js runs this same regex over `hostname + path + query`, so the
// Amazon entry must not swallow the AWS hosts that legitimately carry a
// client's own logo. Denying those would reject the real brand as a foreign one.
test("AWS carrier hosts are not mistaken for the Amazon mark", () => {
  for (const probe of [
    "acme-fence-co.s3.amazonaws.com/brand/logo.png?",
    "s3.us-east-2.amazonaws.com/capital-city-concrete/logo-a1b2c3.svg?",
    "feedback-smtp.us-east-1.amazonses.com/mark.png?",
  ]) {
    assert.equal(brand.isThirdPartyMark(probe), false, `${probe} carries the client's own logo`);
  }
  for (const probe of [
    "www.example.com/img/amazon-logo.png?",
    "example.com/badges/shop-amazon.svg?ref=1",
  ]) {
    assert.equal(brand.isThirdPartyMark(probe), true, `${probe} is the Amazon mark`);
  }
});

// brand-assets.js documents a Facebook-pixel defense that never worked: the
// basename of "facebook.com/tr?id=..." is "tr?id=...", which matches nothing.
test("an asset served BY a third party is rejected on its host", () => {
  for (const probe of [
    "facebook.com/tr?id=123&ev=PageView", // the pixel the Genie approved as a photo
    "www.facebook.com/tr?id=1",
    "static.yelpcdn.com/badge.png?",
    "platform.linkedin.com/badge.png?",
  ]) {
    assert.equal(brand.isThirdPartyMark(probe), true, `${probe} is served by a third party`);
  }
});

// Google hosts carry the client's OWN Business Profile photos; the harvester
// depends on them. Denying the host would discard real client photography.
test("Google/GBP hosts stay allowed for the client's own media", () => {
  for (const probe of [
    "lh3.googleusercontent.com/p/AF1QipM-photo?",
    "maps.googleapis.com/photo.jpg?",
    "capitalcityconcrete.com/wp-content/uploads/logo.svg?",
  ]) {
    assert.equal(brand.isThirdPartyMark(probe), false, `${probe} is the client's own media`);
  }
});

test("the client's own logo is not mistaken for a third-party mark", () => {
  for (const f of ["logo-68ae57cd.png", "logo-d2e17638.png", "header-logo.png", "brand-logo-main.webp"]) {
    assert.equal(brand.isThirdPartyMark(f), false, `${f} is the client's own mark`);
  }
});

test("a primary logo outranks footer/alt variants", () => {
  assert.ok(
    brand.logoRank("logo-a1b2c3.png") < brand.logoRank("footer-logo-small-alt.png"),
    "logo-<hash>.png should win over a footer variant",
  );
  assert.ok(brand.logoRank("header-logo.png") < brand.logoRank("logo-icon-mono.png"));
});

test("neutrals are not brand colours", () => {
  // Logos are mostly white/black/grey. Without this filter every business on
  // earth has the same "brand colour" and the real one never surfaces.
  assert.equal(brand.isBrandCandidate(255, 255, 255), false, "white");
  assert.equal(brand.isBrandCandidate(0, 0, 0), false, "black");
  assert.equal(brand.isBrandCandidate(128, 128, 128), false, "grey");
  assert.equal(brand.isBrandCandidate(253, 126, 0), true, "saturated orange");
});

test("rankColors returns the dominant saturated colour, ignoring white padding", () => {
  const px = [];
  for (let i = 0; i < 50; i++) px.push([255, 255, 255]); // padding
  for (let i = 0; i < 30; i++) px.push([253, 126, 0]);   // brand orange
  for (let i = 0; i < 5; i++) px.push([2, 60, 120]);     // secondary
  const ranked = brand.rankColors(rgb(px));
  assert.ok(ranked.length >= 1);
  assert.match(ranked[0].hex, /^#f[cde]7[cde]0[0-9a-f]$|^#f[cd][0-9a-f]{4}$/i, `unexpected accent ${ranked[0].hex}`);
  // share is of QUALIFYING pixels, so white padding must not dilute it
  assert.ok(ranked[0].share > 0.5, `expected dominant share, got ${ranked[0].share}`);
});

test("an all-white logo reports measured:false rather than inventing a colour", () => {
  const ranked = brand.rankColors(rgb(Array.from({ length: 40 }, () => [255, 255, 255])));
  assert.deepEqual(ranked, [], "no measurable brand colour");
  const roles = brand.assignRoles(ranked);
  assert.equal(roles.accent, null, "must be null so the caller chooses a fallback deliberately");
  assert.equal(roles.ink, null);
});

test("assignRoles only reports ink when the logo really carries a dark colour", () => {
  const light = brand.assignRoles([{ hex: "#fd7e00", r: 253, g: 126, b: 0 }]);
  assert.equal(light.accent, "#fd7e00");
  assert.equal(light.ink, null, "a single bright colour has no ink");

  const twoTone = brand.assignRoles([
    { hex: "#fd7e00", r: 253, g: 126, b: 0 },
    { hex: "#12233f", r: 18, g: 35, b: 63 },
  ]);
  assert.equal(twoTone.accent, "#fd7e00");
  assert.equal(twoTone.ink, "#12233f");
});

test("hexToHsl matches the boilerplate's 'H S% L%' custom-property form", () => {
  assert.deepEqual(brand.hexToHsl("#fd7e00"), { h: 30, s: 100, l: 50 }); // the real client orange
  assert.deepEqual(brand.hexToHsl("#ffffff"), { h: 0, s: 0, l: 100 });
  assert.equal(brand.hexToHsl("not-a-colour"), null);
  assert.equal(brand.hslTriplet("#fd7e00"), "30 100% 50%");
});

test("applyBrandToCss swaps only the accent, leaving contrast pairs alone", () => {
  const css = `:root{--accent: 152 100% 40%;--accent-glow: 152 100% 36%;--background: 36 30% 97%;--foreground: 220 18% 11%;}`;
  const { css: out, changed } = brand.applyBrandToCss(css, { accent: "#fd7e00" });
  assert.equal(changed, 2, "accent + accent-glow");
  assert.match(out, /--accent: 30 100% 50%;/);
  assert.match(out, /--accent-glow: 30 100% 46%;/, "glow is derived, not flattened to the accent");
  // foreground/background are tuned against each other — touching them breaks contrast
  assert.match(out, /--background: 36 30% 97%;/);
  assert.match(out, /--foreground: 220 18% 11%;/);
});

test("an unmeasurable accent leaves the stylesheet untouched", () => {
  const css = `:root{--accent: 152 100% 40%;}`;
  const { css: out, changed } = brand.applyBrandToCss(css, { accent: null });
  assert.equal(changed, 0);
  assert.equal(out, css, "no measured colour must mean no edit, never a guessed one");
});

test("the donor's logo asset is detected as a brand asset", () => {
  // VERIFIED LIVE 2026-07-28: roofing-formula-llc-kirkland.wss-ai.com shipped
  // "TEKLINE ROOFING" in its header. The asset below is that logo.
  const files = [
    "index.html",
    "assets/logo-DmfM0H_8.png",       // the donor logo that actually shipped
    "assets/hero-roof-COMXu35-.jpg",  // stock photography, not an identity claim
    "assets/index-i_MesWgg.css",
    "media/hero-poster.jpg",
  ];
  assert.deepEqual(brand.donorBrandAssets(files), ["assets/logo-DmfM0H_8.png"]);
});

test("a donor brand asset that was not replaced blocks the build", () => {
  const files = ["index.html", "assets/logo-DmfM0H_8.png"];
  assert.deepEqual(
    brand.unreplacedDonorAssets(files, []),
    ["assets/logo-DmfM0H_8.png"],
    "must be reported so the caller can fail closed",
  );
  assert.deepEqual(
    brand.unreplacedDonorAssets(files, ["assets/logo-DmfM0H_8.png"]),
    [],
    "replaced with the client's own logo — safe to ship",
  );
});

// --- hydrator-level guarantees (donor logo can never ship) --------------------
const forge = require("../lib/forge.js");

test("hydration emits the client's own wordmark and drops donor brand assets", () => {
  const files = forge.hydrateBoilerplate({
    boilerplate: "roofing-tekline",
    prospect: {
      business_name: "First Rate Roofing Services",
      phone: "(509) 842-6611",
      city: "Spokane",
      state: "WA",
      county: "Spokane County",
      industry: "roofing",
      preview_host: "x.wss-ai.com",
    },
    dossier: {},
  });
  const names = Object.keys(files);

  // VERIFIED LIVE: roofing-formula-llc-kirkland.wss-ai.com rendered "TEKLINE
  // ROOFING" in its header from assets/logo-DmfM0H_8.png.
  assert.equal(
    brand.unreplacedDonorAssets(names, ["assets/brand-logo.svg"]).length,
    0,
    "no donor logo/wordmark/brand/emblem asset may ship",
  );
  assert.ok(names.includes("assets/brand-logo.svg"), "the client's wordmark must be emitted");

  const svg = files["assets/brand-logo.svg"].toString("utf8");
  assert.match(svg, /First Rate Roofing Services/, "the wordmark carries the CLIENT's name");
  assert.doesNotMatch(svg, /tekline|falcon/i);

  // and the template must resolve its mark through the token, not a shipped file
  const bundle = files["assets/index-DqHc579c.js"].toString("utf8");
  assert.match(bundle, /\/assets\/brand-logo\.svg/);
  assert.doesNotMatch(bundle, /logo-DmfM0H_8/, "the donor asset path must be gone");
});

test("the coverage list names the city once, not seven times", () => {
  // Live sites rendered "Kirkland Kirkland Kirkland Kirkland Kirkland Kirkland
  // Kirkland" because the template hardcoded {{CITY}} seven times.
  const files = forge.hydrateBoilerplate({
    boilerplate: "roofing-tekline",
    prospect: {
      business_name: "Acme Roofing",
      phone: "(555) 555-5555",
      city: "Kirkland",
      state: "WA",
      county: "King County",
      industry: "roofing",
      preview_host: "x.wss-ai.com",
    },
    dossier: {},
  });
  const bundle = files["assets/index-DqHc579c.js"].toString("utf8");
  const m = bundle.match(/serviceArea:\[[^\]]*\]/);
  assert.ok(m, "serviceArea array should still exist");
  assert.equal(m[0], 'serviceArea:["Kirkland"]', `repeated city regressed: ${m[0]}`);
});

test("the state comes from the prospect, not the donor's Washington", () => {
  // VERIFIED LIVE: sunset-roofing-llc-tucson.wss-ai.com shipped
  // "Roofing Contractor in Tucson, WA" and "TUCSON, WA / PIMA COUNTY".
  // Pima County is in ARIZONA. The template hardcoded the donor's state 50+ times,
  // so every customer outside Washington was told they were in Washington.
  const files = forge.hydrateBoilerplate({
    boilerplate: "roofing-tekline",
    prospect: {
      business_name: "Sunset Roofing, LLC",
      phone: "(520) 400-1741",
      city: "Tucson",
      state: "AZ",
      county: "Pima County",
      industry: "roofing",
      preview_host: "x.wss-ai.com",
    },
    dossier: {},
  });
  const js = files["assets/index-DqHc579c.js"].toString("utf8");
  assert.match(js, /Tucson, AZ/, "must render the prospect's real state");
  assert.doesNotMatch(js, /Tucson, WA/, "the donor's state must not survive");
  assert.doesNotMatch(js, /, WA\b/, "no hardcoded state literal may remain");
});

test("unverifiable operational claims and the donor's owner are gone", () => {
  const files = forge.hydrateBoilerplate({
    boilerplate: "roofing-tekline",
    prospect: {
      business_name: "Acme Roofing",
      phone: "(555) 555-5555",
      city: "Boise",
      state: "ID",
      county: "Ada County",
      industry: "roofing",
      preview_host: "x.wss-ai.com",
    },
    dossier: {},
  });
  const js = files["assets/index-DqHc579c.js"].toString("utf8");
  // "Owner · M." is the donor's owner initial (M. FORCHIONE) and rendered
  // identically on every roofing mirror.
  assert.doesNotMatch(js, /Owner · M/, "donor owner initial must not ship");
  // "owner-led" asserts how a real business is run; we have no evidence for it.
  assert.doesNotMatch(js, /owner-led/, "unverifiable claim must not ship");
});

test("a scraped email keeps its percent-encoding out of the page", () => {
  // roofing-formula-llc-kirkland.wss-ai.com displayed "%20roofingformulanw@outlook.com"
  assert.equal(forge.sanitizeEmail("%20roofingformulanw@outlook.com"), "roofingformulanw@outlook.com");
  assert.equal(forge.sanitizeEmail("mailto:%20a@b.co"), "a@b.co");
  assert.equal(forge.sanitizeEmail("  spaced@x.io "), "spaced@x.io");
  // {{EMAIL}} is OPTIONAL, so junk must blank out rather than render broken
  assert.equal(forge.sanitizeEmail("not-an-email"), "");
  assert.equal(forge.sanitizeEmail(null), "");
});

test("no fabricated testimonials — reviews are tokenised or absent", () => {
  // THE WORST DEFECT FOUND. The template shipped FOUR of the donor's real
  // customer reviews with {{BUSINESS_NAME}} substituted into the body, so a live
  // customer site read "We had our roof replaced by <that customer> in April
  // 2025..." attributed to a real named person who never said it.
  const files = forge.hydrateBoilerplate({
    boilerplate: "roofing-tekline",
    prospect: {
      business_name: "Acme Roofing",
      phone: "(555) 555-5555",
      city: "Boise",
      state: "ID",
      county: "Ada County",
      industry: "roofing",
      preview_host: "x.wss-ai.com",
    },
    dossier: {}, // no verified reviews -> the section must be empty, never invented
  });
  const js = files["assets/index-DqHc579c.js"].toString("utf8");

  for (const donorReviewer of ["Robyn Miller", "Evelyn Liebscher", "Michael Mey", "John Hart"]) {
    assert.doesNotMatch(js, new RegExp(donorReviewer), `${donorReviewer} is the DONOR's customer`);
  }
  // exactly one review slot, and it is the tokenised one (blank here)
  const authors = [...js.matchAll(/author:"([^"]*)"/g)].map((m) => m[1]);
  assert.equal(authors.length, 1, `expected a single tokenised review slot, got ${JSON.stringify(authors)}`);
  assert.equal(authors[0], "", "with no verified review the author must be blank, not invented");
});

test("no donor person name or donor-branded class survives", () => {
  const files = forge.hydrateBoilerplate({
    boilerplate: "roofing-tekline",
    prospect: {
      business_name: "Acme Roofing",
      phone: "(555) 555-5555",
      city: "Boise",
      state: "ID",
      county: "Ada County",
      industry: "roofing",
      preview_host: "x.wss-ai.com",
    },
    dossier: {},
  });
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(js|css|html|json|svg|txt)$/i.test(rel)) continue;
    const text = buf.toString("utf8");
    assert.doesNotMatch(text, /\bMike\b/, `donor owner first name in ${rel}`);
    assert.doesNotMatch(text, /falcon/i, `donor brand token in ${rel}`);
    assert.doesNotMatch(text, /tekline/i, `donor brand token in ${rel}`);
  }
  // the donor-named hero video must not be shipped either
  assert.ok(!Object.keys(files).some((f) => /falcon/i.test(f)), "no donor-named asset may ship");
});
