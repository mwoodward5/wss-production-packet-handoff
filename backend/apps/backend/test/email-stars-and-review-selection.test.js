"use strict";

// test/email-stars-and-review-selection.test.js — the Ron Steele sandbox send
// (2026-08-16), and the three defects it exposed, pinned.
//
// The live proof to Ron Steele Plumbing printed, in one email:
//   1. FIVE full gold stars beside "3 · 14 Google reviews" — a 3.0 rating
//      rendered as a 5-star claim, because the hollow remainder was dimmed
//      with `opacity:.32` and the reading client ignored inline opacity,
//      painting all five at full gold. Twice: hero and trust band.
//   2. A 1-star rant opening "WHAT YOUR CUSTOMERS ALREADY SAY" — the card
//      quoted the first two reviews in arrival order, whatever they were.
//   3. The owner's own address as the dashboard sign-in — correct for a
//      sandbox proof, fatal if the same string ever shipped on a live send.
//
// Each fix is selection or rendering ONLY. Not one word of a review is edited
// and not one number is invented (the truth law is absolute); what changed is
// WHICH of the prospect's own facts the email prints, and how.

const test = require("node:test");
const assert = require("node:assert/strict");

const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { buildProofEmailInputs } = require("../lib/proof-email-inputs");

const PREVIEW = "https://ron-steele-plumbing.wss-ai.com/";
const BASE = {
  businessName: "Ron Steele Plumbing",
  city: "Fort Worth",
  previewUrl: PREVIEW,
  brandColor: "#1F6FEB",
};
// The exact shape of the live defect's inputs: a real 3.0 rating, 14 reviews,
// and a quote corpus whose loudest review is its worst.
const RATING_3 = { rating: "3", reviewCount: "14" };
const RANT = "This guy is extremely rude and cursed my wife out when she asked for a receipt.";
const REVIEWS_LIVE = [
  { text: RANT, author: "Former Customer", rating: 1, publishedAt: "2026-08-01T00:00:00Z" },
  { text: "Fixed our water heater the same day. Fair price, clean work.", author: "Al Day", rating: 5, publishedAt: "2026-06-01T00:00:00Z" },
  { text: "Honest, on time, and explained everything before touching a pipe.", author: "Bo Knight", rating: 5, publishedAt: "2026-07-15T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// 1. THE STARS PRINT THE NUMBER WE WERE GIVEN
// ---------------------------------------------------------------------------

test("a 3.0 rating renders THREE filled stars and a hollow remainder — never five gold", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, ...RATING_3 });
  // The live defect, verbatim: five contiguous full-gold glyphs. That string
  // is what a 3.0 must never produce again.
  assert.ok(!html.includes("&#9733;&#9733;&#9733;&#9733;&#9733;"), "a 3.0 rating rendered five full stars");
  // The trust band (size 20) and the hero (size 15) each show 3 filled and a
  // hollow remainder drawn by COLOUR, not opacity — the span style that broke.
  for (const size of [20, 15]) {
    assert.match(
      html,
      new RegExp(`color:#F59E0B;font-size:${size}px;letter-spacing:2px;line-height:1;white-space:nowrap">(&#9733;){3}<span style="color:#[0-9A-Fa-f]{6}">(&#9733;){2}</span>`),
      `the ${size === 20 ? "trust band" : "hero"} star row is not 3 filled + 2 hollow`,
    );
  }
  // The hollow remainder is a mixed colour, which every client renders — the
  // opacity span that Outlook painted solid must be gone from the email.
  assert.ok(!/<span style="opacity:/.test(html), "stars are still dimmed with opacity, which clients ignore");
});

test("a quote's own rating drives its star row, four filled for a 4, five for a 5", () => {
  const four = composeOutreachEmailV3({
    ...BASE, ...RATING_3,
    reviewQuotes: [{ text: "Solid work.", author: "Cy Marsh", rating: 4 }],
  }).html;
  assert.match(
    four,
    /font-size:13px;letter-spacing:2px;line-height:1;white-space:nowrap">(&#9733;){4}<span style="color:#[0-9A-Fa-f]{6}">(&#9733;){1}<\/span>/,
    "a 4-star review did not render four filled stars",
  );
  const five = composeOutreachEmailV3({
    ...BASE, rating: "4.9", reviewCount: "407",
    reviewQuotes: [{ text: "Perfect.", author: "Dee Ray", rating: 5 }],
  }).html;
  assert.match(
    five,
    /font-size:13px;letter-spacing:2px;line-height:1;white-space:nowrap">(&#9733;){5}<span style="color:#[0-9A-Fa-f]{6}"><\/span>/,
    "a 5-star review did not render five filled stars",
  );
});

test("no numeric rating means NO star row at all — never five placeholders", () => {
  // letter-spacing:2px is the star row's signature style; it appears nowhere
  // else in the composer. Without a rating on the band, the hero or the quote,
  // there must be no star markup — an absent measurement is not a 0, and it is
  // not five dim stars standing in for a number nobody measured.
  const { html } = composeOutreachEmailV3({
    ...BASE,
    reviewQuotes: [{ text: "Nice enough, I suppose.", author: "E Fran" }],
  });
  assert.ok(!html.includes("letter-spacing:2px"), "a star row rendered with no numeric rating behind it");
});

// ---------------------------------------------------------------------------
// 2. THE PRAISE BLOCK SELECTS ITS OWN PRAISE
// ---------------------------------------------------------------------------

test("the quote card prefers the highest ratings, then recency — the rant never ships", () => {
  const opts = buildProofEmailInputs({ prospect: { business_name: "Ron Steele Plumbing" }, cta: { previewUrl: PREVIEW, reviews: REVIEWS_LIVE } });
  assert.deepEqual(
    opts.reviewQuotes.map((q) => q.author),
    ["Bo Knight", "Al Day"],
    "selection was not highest-rating-first with recency as the tie-break",
  );
  assert.ok(!opts.reviewQuotes.some((q) => q.text === RANT), "the 1-star rant was selected for the praise block");

  // End to end: the composed email carries the praise and not the rant, in
  // both MIME halves.
  const { html, text } = composeOutreachEmailV3({ ...BASE, ...RATING_3, reviewQuotes: opts.reviewQuotes });
  assert.ok(html.includes("WHAT YOUR CUSTOMERS ALREADY SAY"));
  assert.ok(html.includes("Bo Knight") && html.includes("Al Day"));
  assert.ok(!html.includes(RANT) && !text.includes(RANT), "the rant reached the composed email");
});

test("shorthanded corpora fill from the best available — and never a 1-star", () => {
  const opts = buildProofEmailInputs({
    prospect: {},
    cta: {
      previewUrl: PREVIEW,
      reviews: [
        { text: RANT, author: "Former Customer", rating: 1 },
        { text: "Did the job, mostly.", author: "Gi Poe", rating: 3 },
        { text: "Rough around the edges but cheap.", author: "Hal Quinn", rating: 2 },
      ],
    },
  });
  assert.deepEqual(
    opts.reviewQuotes.map((q) => q.author),
    ["Gi Poe", "Hal Quinn"],
    "with fewer than two 4+ reviews the fill was not best-available, or a 1-star shipped",
  );
});

test("an unrated review fills only after rated ones, newest first among its own", () => {
  const opts = buildProofEmailInputs({
    prospect: {},
    cta: {
      previewUrl: PREVIEW,
      reviews: [
        { text: "Fine work.", author: "Ivy Ross", rating: 4 },
        { text: "No stars given, newer.", author: "Jon Tate", publishedAt: "2026-08-10T00:00:00Z" },
        { text: "No stars given, older.", author: "Kit Vale", publishedAt: "2026-01-10T00:00:00Z" },
      ],
    },
  });
  assert.deepEqual(
    opts.reviewQuotes.map((q) => q.author),
    ["Ivy Ross", "Jon Tate"],
    "a rated review must outrank an unrated one, and unrated ones break ties by recency",
  );
});

test("the unix `time` field breaks recency ties too", () => {
  const opts = buildProofEmailInputs({
    prospect: {},
    cta: {
      previewUrl: PREVIEW,
      reviews: [
        { text: "Older five.", author: "Lou Wade", rating: 5, time: 1700000000 },
        { text: "Newer five.", author: "Mia Xian", rating: 5, time: 1750000000 },
      ],
    },
  });
  assert.deepEqual(opts.reviewQuotes.map((q) => q.author), ["Mia Xian", "Lou Wade"]);
});

test("selection never edits a word: the carried quote is the source text verbatim", () => {
  const opts = buildProofEmailInputs({ prospect: {}, cta: { previewUrl: PREVIEW, reviews: REVIEWS_LIVE } });
  const five = opts.reviewQuotes.find((q) => q.rating === 5);
  assert.equal(five.text, "Honest, on time, and explained everything before touching a pipe.");
});

// ---------------------------------------------------------------------------
// 3. THE SIGN-IN ADDRESS IS THE PROSPECT'S, OR THE DOOR DOES NOT SHIP
// ---------------------------------------------------------------------------

const OWNER = "woodwardsoftware@gmail.com";
const PROSPECT_EMAIL = "ron@ronsteeleplumbing.com";
const ENV_WITH_OWNER = { GHOST_AGENCY_OWNER_EMAIL: OWNER };
const accessFor = (ownerEmail) => ({
  provisioned: true,
  dashboardUrl: "https://wss-ai.com/dashboard",
  ownerEmail,
  pin: "482913",
  magicLink: "https://wss-ai.com/dashboard#t=signed-token",
});
const doorKeys = (opts) => ["dashboardUrl", "dashboardEmail", "dashboardPin", "dashboardMagicLink"].filter((k) => k in opts);

test("LIVE: the owner's address as the sign-in removes the whole door", () => {
  const opts = buildProofEmailInputs({
    prospect: { email: PROSPECT_EMAIL },
    cta: { previewUrl: PREVIEW },
    dashboardAccess: accessFor(OWNER),
    env: ENV_WITH_OWNER,
  });
  assert.deepEqual(doorKeys(opts), [], `a live send kept the door under the owner's address: ${doorKeys(opts)}`);

  // And the composed email built from those inputs never prints the agency's
  // address, in either MIME half — the PIN plate and sign-in line are all gone.
  // ("HOW TO GET IN" itself may still render: the preview door is a door too.)
  const { html, text } = composeOutreachEmailV3({ ...BASE, ...RATING_3, ...opts });
  assert.ok(!html.includes(OWNER) && !text.includes(OWNER), "the agency owner's address reached a live email");
  assert.ok(!html.includes("Dashboard PIN") && !html.includes("YOUR FREE BACKEND IS READY"), "the dashboard door rendered without a valid sign-in");
  assert.ok(!text.includes("PIN:"), "a sign-in PIN printed in the text half with no valid door");
});

test("LIVE: the prospect's own address keeps the door", () => {
  const opts = buildProofEmailInputs({
    prospect: { email: PROSPECT_EMAIL },
    cta: { previewUrl: PREVIEW },
    dashboardAccess: accessFor(PROSPECT_EMAIL),
    env: ENV_WITH_OWNER,
  });
  assert.equal(opts.dashboardEmail, PROSPECT_EMAIL);
  assert.equal(opts.dashboardPin, "482913");
  assert.equal(opts.dashboardMagicLink, "https://wss-ai.com/dashboard#t=signed-token");
});

test("LIVE: mixed case and a mailto: prefix still recognise the prospect's own address", () => {
  // The prospect row can carry "mailto:Ron@RonSteelePlumbing.com" while the
  // access row holds the normalised lowercase — that is one address, and the
  // guard must treat it as one.
  const opts = buildProofEmailInputs({
    prospect: { email: `mailto:${PROSPECT_EMAIL.toUpperCase()}` },
    cta: { previewUrl: PREVIEW },
    dashboardAccess: accessFor(PROSPECT_EMAIL),
    env: ENV_WITH_OWNER,
  });
  assert.equal(opts.dashboardEmail, PROSPECT_EMAIL);
});

test("SANDBOX: the owner's address is allowed — the proof lane prints its own sign-in", () => {
  const opts = buildProofEmailInputs({
    prospect: { email: PROSPECT_EMAIL },
    cta: { previewUrl: PREVIEW },
    dashboardAccess: accessFor(OWNER),
    sandbox: true,
    env: ENV_WITH_OWNER,
  });
  assert.equal(opts.dashboardEmail, OWNER, "the sandbox proof lost the owner's sign-in");
  assert.equal(opts.dashboardPin, "482913");

  // Composed, the proof DOES show the owner his own sign-in — that is the
  // point of a proof.
  const { html, text } = composeOutreachEmailV3({ ...BASE, ...RATING_3, ...opts });
  assert.ok(html.includes(OWNER) && text.includes(OWNER), "the sandbox proof lost its sign-in line");
  assert.ok(html.includes("YOUR FREE BACKEND IS READY"));
});

test("SANDBOX admits ONLY the owner — a third party's address still refuses", () => {
  const opts = buildProofEmailInputs({
    prospect: { email: PROSPECT_EMAIL },
    cta: { previewUrl: PREVIEW },
    dashboardAccess: accessFor("someone.else entirely@gmail.com"),
    sandbox: true,
    env: ENV_WITH_OWNER,
  });
  assert.deepEqual(doorKeys(opts), [], "the sandbox flag admitted an address that is neither the prospect's nor the owner's");
});

test("a prospect row with no email at all fails closed: no door on a live send", () => {
  const opts = buildProofEmailInputs({
    prospect: { business_name: "Ron Steele Plumbing" },
    cta: { previewUrl: PREVIEW },
    dashboardAccess: accessFor(PROSPECT_EMAIL),
    env: ENV_WITH_OWNER,
  });
  assert.deepEqual(doorKeys(opts), [], "a door shipped with no prospect address to check it against");
});
