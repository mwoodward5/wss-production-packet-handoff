"use strict";

// test/email-trust-repackage.test.js — the owner's 2026-08-12 "put the trust
// signals back in the email" pass, pinned.
//
// Four things he asked for, each with the rule that keeps it honest:
//
//   1. A gold five-star emblem beside "4.9 · 1,212 Google Reviews", HIGH — as a
//      band. Renders only with BOTH numbers; an absent one removes the band.
//   2. A trust strip: the band's second row carries the credentials we hold
//      (years / licensed / insured) as pills. Each is fact-gated; none is
//      inferred, and "insured" never appears unless a boolean says so.
//   3. Two or three real review quotes with the reviewer's initial. The email's
//      first-party image law forbids a googleusercontent face, so the avatar is
//      a MONOGRAM — never an off-domain <img>. Capped at two.
//   4. The American-AI umbrella line in the value section, TEXT only, no logos.
//
// And the mapper (lib/proof-email-inputs) that feeds all of it from a stored
// record, fact-gated to the letter: an unheld datum emits no key.

const test = require("node:test");
const assert = require("node:assert/strict");

const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { buildProofEmailInputs, PROOF_EMAIL_V3_OPTION_KEYS } = require("../lib/proof-email-inputs");

const PREVIEW = "https://ramon-roofing.wss-ai.com/";
const BASE = {
  businessName: "Ramon Roofing",
  city: "Fort Worth",
  previewUrl: PREVIEW,
  brandColor: "#C0392B",
};
const TRUST = {
  rating: "4.9",
  reviewCount: "1212",
  reviewQuotes: [
    { text: "Best roofers in town, showed up on time and fixed it right.", author: "Marcus Bell", rating: 5 },
    { text: "Honest and fair. We will call them again.", author: "Dana Whitfield", rating: 5 },
  ],
  yearsInBusiness: 19,
  licensed: true,
  insured: true,
};

// ---------------------------------------------------------------------------
// 1. The trust band — the gold emblem beside the count, high
// ---------------------------------------------------------------------------

test("the trust band renders a gold star emblem beside the rating and grouped count", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, ...TRUST });
  // A gold star glyph is present. MOSAIC V2 (owner-approved): the rating gold is
  // #F59E0B, reserved for the stars only (was #FFC94D before the blue re-skin).
  assert.match(html, /#F59E0B/, "the reserved review gold is missing");
  assert.ok(html.includes("&#9733;"), "no star glyph rendered");
  // The exact rating and the GROUPED count (1212 -> 1,212), beside "Google reviews".
  assert.ok(html.includes(">4.9<"), "the rating number is missing from the band");
  assert.ok(html.includes("1,212 Google reviews"), "the count is not grouped or not shown");
});

test("the visual proof opens the email — shots above the trust band, band above the price", () => {
  // OWNER ORDER, 2026-08-13 ("juiciest-first: hero -> mobile pair -> reviews
  // below"): the before/after strip and the theirs-vs-ours phone pair open the
  // email, and the trust band (reviews) sits BELOW them. This reverses the
  // earlier "band above the pair" rule, which buried the shots the owner most
  // wanted to see at the top. The band still renders above the price.
  const { html } = composeOutreachEmailV3({
    ...BASE, ...TRUST,
    mobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=new-mobile&c=z",
    beforeMobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=old-mobile&c=z",
    currentUrl: "https://ramonroofingtx.com/",
  });
  // The trust BAND is identified by its credential pill, which only the band
  // renders — the hero's own compact rating line ("… Google reviews") sits at
  // the very top as part of the hero identity and must not be mistaken for the
  // band. The band is the prominent gold-star cluster that now follows the shots.
  const bandAt = html.indexOf("Licensed &amp; insured");
  const pairAt = html.indexOf("ON A PHONE, SIDE BY SIDE.");
  const priceAt = html.indexOf("IT IS ALREADY BUILT. HERE IS THE HONEST MATH.");
  assert.ok(bandAt > -1 && pairAt > -1 && priceAt > -1);
  assert.ok(pairAt < bandAt, "the phone comparison must open the email, above the trust band");
  assert.ok(bandAt < priceAt, "the trust band must sit above the price");
});

test("the band needs BOTH numbers — a rating or a count alone removes it", () => {
  for (const missing of [{ rating: "" }, { reviewCount: "" }, { rating: "", reviewCount: "" }]) {
    const { html } = composeOutreachEmailV3({ ...BASE, ...TRUST, ...missing });
    assert.ok(!html.includes("Google reviews"), `band rendered with ${JSON.stringify(missing)}`);
  }
});

// ---------------------------------------------------------------------------
// 2. The credentials row — fact-gated pills
// ---------------------------------------------------------------------------

test("credentials render only what is held, and never claim insured on their own", () => {
  const years = composeOutreachEmailV3({ ...BASE, ...TRUST, licensed: false, insured: false }).html;
  assert.match(years, /19\+ years in business/);
  assert.ok(!/Licensed/.test(years) && !/Insured/.test(years), "claimed a credential we cleared");

  const licOnly = composeOutreachEmailV3({ ...BASE, ...TRUST, insured: false, yearsInBusiness: 0 }).html;
  assert.ok(licOnly.includes("Licensed") && !/Licensed &amp; insured/.test(licOnly) && !licOnly.includes(">Insured"), "licensed-only leaked an insured claim");

  const insOnly = composeOutreachEmailV3({ ...BASE, ...TRUST, licensed: false, yearsInBusiness: 0 }).html;
  assert.match(insOnly, /Insured/);
  assert.ok(!/Licensed &amp; insured/.test(insOnly));

  const both = composeOutreachEmailV3({ ...BASE, ...TRUST }).html;
  assert.match(both, /Licensed &amp; insured/);
});

test("no credentials held leaves a clean band with just the emblem and count", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, rating: "4.7", reviewCount: "88" });
  assert.ok(html.includes("88 Google reviews"));
  assert.ok(!/years in business/.test(html) && !/Licensed/.test(html) && !/>Insured/.test(html));
});

// ---------------------------------------------------------------------------
// 3. Review quotes — monogram initials, capped at two, first-party only
// ---------------------------------------------------------------------------

test("review quotes render the reviewer's initial as a monogram, with the name and gold stars", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, ...TRUST });
  assert.ok(html.includes("WHAT YOUR CUSTOMERS ALREADY SAY"), "the quote card header is missing");
  assert.ok(html.includes(">M</span>"), "Marcus's monogram is missing");
  assert.ok(html.includes(">D</span>"), "Dana's monogram is missing");
  assert.match(html, /&mdash; Marcus Bell, on Google/);
  assert.match(html, /&ldquo;Best roofers in town/);
});

test("a googleusercontent face is NEVER emitted — the avatar is always a monogram", () => {
  const { html } = composeOutreachEmailV3({
    ...BASE, ...TRUST,
    reviewQuotes: [{
      text: "Great work all around.",
      author: "Marcus Bell",
      avatarUrl: "https://lh3.googleusercontent.com/a-/ALV-UjReal=s128-c",
      rating: 5,
    }],
  });
  assert.ok(!/googleusercontent|lh3\.google/.test(html), "an off-domain face leaked into the email");
  // Every <img> in the whole email is first-party — the same law the packet
  // adapter test enforces, checked here on the quote path specifically.
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    assert.match(m[1], /^https:\/\/[a-z0-9.-]*wss-ai\.com\//i, `non-first-party image: ${m[1]}`);
  }
});

test("the quote card caps at two and disappears entirely when there are none", () => {
  const three = composeOutreachEmailV3({
    ...BASE, ...TRUST,
    reviewQuotes: [
      { text: "One.", author: "Al" }, { text: "Two.", author: "Bo" }, { text: "Three.", author: "Cy" },
    ],
  }).html;
  assert.ok(three.includes(">A</span>") && three.includes(">B</span>"));
  assert.ok(!three.includes(">C</span>"), "a third quote was not capped");

  const none = composeOutreachEmailV3({ ...BASE, ...TRUST, reviewQuotes: [] }).html;
  assert.ok(!none.includes("WHAT YOUR CUSTOMERS ALREADY SAY"), "the empty quote card still rendered");
});

test("a long quote is trimmed to one line with no dangling separator", () => {
  const long = "This is a genuinely long five-star review that runs well past the one-line budget the card allows, so the composer really does have to cut it short here,";
  const { html } = composeOutreachEmailV3({ ...BASE, ...TRUST, reviewQuotes: [{ text: long, author: "Al" }] });
  assert.match(html, /…/, "a long quote was not truncated");
  assert.ok(!/,…/.test(html) && !/ …/.test(html), "the truncation left a dangling separator");
});

// ---------------------------------------------------------------------------
// 4. The American-AI umbrella line — value section, text only
// ---------------------------------------------------------------------------

test("the American-AI line names the four models as TEXT in the value section, no logos", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, ...TRUST });
  const eyebrowAt = html.indexOf("BUILT WITH AMERICAN AI");
  assert.ok(eyebrowAt > -1, "the American-AI eyebrow is missing");
  // All four models, in order, as text spans.
  assert.match(html, /Claude<\/span>[\s\S]*GPT<\/span>[\s\S]*Gemini<\/span>[\s\S]*Perplexity<\/span>/);
  // In the value section: after WHAT YOU GET, before the road-map / price.
  const getAt = html.indexOf("WHAT YOU GET");
  const priceAt = html.indexOf("IT IS ALREADY BUILT. HERE IS THE HONEST MATH.");
  assert.ok(getAt > -1 && getAt < eyebrowAt && eyebrowAt < priceAt, "the line is not in the value section");
  // The strip carries no image — text treatment only.
  const strip = html.slice(eyebrowAt, eyebrowAt + 600);
  assert.ok(!/<img/.test(strip), "the American-AI strip must be text only");
});

// ---------------------------------------------------------------------------
// Parity: the plain-text half carries the same trust, gated the same way
// ---------------------------------------------------------------------------

test("the text half mirrors the band, the quotes and the American-AI line", () => {
  const { text } = composeOutreachEmailV3({ ...BASE, ...TRUST });
  assert.match(text, /4\.9 stars on Google · 1,212 reviews · 19\+ years in business · Licensed & insured/);
  assert.match(text, /"Best roofers in town[^"]*" — Marcus Bell, on Google/);
  assert.ok(text.includes("We use every leading American AI model — Claude, GPT, Gemini, Perplexity — across everything we do for your business."));
});

test("the text half drops the trust line when the numbers are absent", () => {
  const { text } = composeOutreachEmailV3({ ...BASE, reviewQuotes: [] });
  assert.ok(!/stars on Google/.test(text), "the text trust line rendered with no numbers");
  // The American-AI line is a claim about our own stack — always present.
  assert.ok(text.includes("We use every leading American AI model"));
});

// ---------------------------------------------------------------------------
// The mapper — fact-gated, from a stored record
// ---------------------------------------------------------------------------

test("the four new option keys are on the composer's allowlist", () => {
  for (const key of ["reviewQuotes", "yearsInBusiness", "licensed", "insured"]) {
    assert.ok(PROOF_EMAIL_V3_OPTION_KEYS.includes(key), `${key} is not allowlisted`);
  }
});

test("reviewQuotes map from cta.reviews: text required, capped at two, no avatar carried", () => {
  // SELECTION, NOT ARRIVAL (2026-08-16): the praise block now picks the highest
  // ratings first, so the 5-star "Third" is SELECTED over the 4-star "Second"
  // even though it arrived later — the Ron Steele defect (a 1-star rant leading
  // "WHAT YOUR CUSTOMERS ALREADY SAY") is fixed at this boundary. Selection law
  // details are pinned in test/email-stars-and-review-selection.test.js.
  const opts = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: {
      previewUrl: PREVIEW,
      reviews: [
        { text: "First one.", author: "Al", avatarUrl: "https://lh3.googleusercontent.com/a-/x", rating: 5 },
        { text: "Second one.", author: "Bo", rating: 4 },
        { text: "Third one.", author: "Cy", rating: 5 },
        { text: "", author: "No text dropped" },
      ],
    },
  });
  assert.equal(opts.reviewQuotes.length, 2, "not capped at two, or empty-text not dropped");
  assert.deepEqual(opts.reviewQuotes[0], { text: "First one.", author: "Al", rating: 5 }, "avatar leaked or shape wrong");
  assert.equal(opts.reviewQuotes[1].author, "Cy", "a 4-star was preferred over an equal-or-better 5-star");
});

test("a FIRST-PARTY faceUrl is carried; a googleusercontent one is dropped", () => {
  // The caller (email.js) re-hosts the Google face and hands it on as faceUrl on
  // a *.wss-ai.com host. The mapper carries that; a raw googleusercontent URL —
  // or the old avatarUrl field — never survives.
  const carried = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: {
      previewUrl: PREVIEW,
      reviews: [
        { text: "One.", author: "Al", faceUrl: "https://ghost.wss-ai.com/api/media/preview-shot?k=x&v=face-0", rating: 5 },
        { text: "Two.", author: "Bo", faceUrl: "https://lh3.googleusercontent.com/a-/x", rating: 4 },
      ],
    },
  });
  assert.equal(carried.reviewQuotes[0].faceUrl, "https://ghost.wss-ai.com/api/media/preview-shot?k=x&v=face-0");
  assert.ok(!("faceUrl" in carried.reviewQuotes[1]), "a googleusercontent faceUrl leaked into the inputs");
});

test("a first-party faceUrl renders a real <img>, not a monogram — still all first-party", () => {
  const face = "https://ghost.wss-ai.com/api/media/preview-shot?k=abc&s=def&v=face-0&c=0123456789ab";
  const { html } = composeOutreachEmailV3({
    ...BASE, ...TRUST,
    reviewQuotes: [{ text: "Real crew, real face.", author: "Marcus Bell", faceUrl: face, rating: 5 }],
  });
  assert.match(html, /<img[^>]+src="https:\/\/ghost\.wss-ai\.com\/api\/media\/preview-shot[^"]*v=face-0[^"]*"[^>]*alt="Marcus Bell, on Google"/, "the mirrored face did not render as an <img>");
  // A composer that is handed a NON-first-party faceUrl drops it back to a monogram.
  const leaked = composeOutreachEmailV3({
    ...BASE, ...TRUST,
    reviewQuotes: [{ text: "Nope.", author: "Al", faceUrl: "https://lh3.googleusercontent.com/a-/x", rating: 5 }],
  }).html;
  assert.ok(!/googleusercontent|lh3\.google/.test(leaked), "a googleusercontent faceUrl leaked into the email");
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    assert.match(m[1], /^https:\/\/[a-z0-9.-]*wss-ai\.com\//i, `non-first-party image: ${m[1]}`);
  }
});

test("reviewQuotes fall back to a flatter record's evidence.reviews", () => {
  const opts = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    record: { reviews: [{ text: "From the record.", author: "Ed", rating: 5 }] },
    cta: { previewUrl: PREVIEW },
  });
  assert.equal(opts.reviewQuotes.length, 1);
  assert.equal(opts.reviewQuotes[0].text, "From the record.");
});

test("yearsInBusiness comes from a held count, or a founding year — never inferred", () => {
  const held = buildProofEmailInputs({
    prospect: {}, cta: { previewUrl: PREVIEW }, record: { years_in_business: 22 },
  });
  assert.equal(held.yearsInBusiness, 22);

  const derived = buildProofEmailInputs({
    prospect: {}, cta: { previewUrl: PREVIEW }, record: { year_founded: 2007 },
    now: () => Date.parse("2026-08-12T00:00:00Z"),
  });
  assert.equal(derived.yearsInBusiness, 19);

  const none = buildProofEmailInputs({ prospect: {}, cta: { previewUrl: PREVIEW }, record: {} });
  assert.ok(!("yearsInBusiness" in none), "invented a years figure from nothing");

  const insane = buildProofEmailInputs({
    prospect: {}, cta: { previewUrl: PREVIEW }, record: { year_founded: 1200 },
  });
  assert.ok(!("yearsInBusiness" in insane), "accepted an out-of-range founding year");
});

test("licensed / insured fire only on a strict boolean true", () => {
  const yes = buildProofEmailInputs({
    prospect: {}, cta: { previewUrl: PREVIEW }, record: { licensed: true, insured: true },
  });
  assert.equal(yes.licensed, true);
  assert.equal(yes.insured, true);

  for (const truthy of ["true", 1, "yes", "Y"]) {
    const opts = buildProofEmailInputs({
      prospect: {}, cta: { previewUrl: PREVIEW }, record: { licensed: truthy, insured: truthy },
    });
    assert.ok(!("licensed" in opts), `licensed set from non-boolean ${JSON.stringify(truthy)}`);
    assert.ok(!("insured" in opts), `insured set from non-boolean ${JSON.stringify(truthy)}`);
  }
});

test("a record with no trust data emits none of the new keys, and the mapper still validates", () => {
  const opts = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: { previewUrl: PREVIEW },
    record: {},
  });
  for (const key of ["reviewQuotes", "yearsInBusiness", "licensed", "insured"]) {
    assert.ok(!(key in opts), `${key} was emitted with no data behind it`);
  }
});
