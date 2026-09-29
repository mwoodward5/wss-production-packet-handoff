"use strict";
// test/email-voice-and-mobile-pair.test.js — the owner's 2026-08-12 walkthrough,
// pinned.
//
// Three directives from the video, each with the failure it names:
//
//   1. SUBJECTS. "quick one about your plumbing site" was lowercase and sold
//      nothing; his reference is CarsForSale's "Don't gamble with your
//      inventory" — sell a feeling. The pool is rewritten benefit-led, properly
//      capitalized, business name in every variant.
//
//   2. THE DOUBLE WORD. "Diamond State Plumbing — plumbing in Little Rock"
//      reads "plumbing" twice, because half the trades carry their trade in
//      their name. Wherever we compose name + trade, the trade word is dropped
//      when the name already says it: industryForSubject() for email copy,
//      seoTitle() for the mirror's own <title>.
//
//   3. MOBILE VS DESKTOP. "another mini email is missing is doing the mobile
//      layouts versus the desktop... so they really see how much better it
//      looks on their mobile phone." A 390 capture in a phone frame beside the
//      desktop still, real pixels, both clicking through to the live site —
//      and ABSENT (never a placeholder) when the mobile capture was not
//      recorded.

const test = require("node:test");
const assert = require("node:assert/strict");

const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { pchSubject, industryForSubject, SUBJECT_POOL } = require("../lib/outreach-email-v2");
const { seoTitle } = require("../lib/mirror-engine/content-inject");
const { buildProofEmailInputs, PROOF_EMAIL_V3_OPTION_KEYS } = require("../lib/proof-email-inputs");

// ---------------------------------------------------------------------------
// 1. The subject pool
// ---------------------------------------------------------------------------

test("every subject variant is capitalized, benefit-led, and carries the business name", () => {
  assert.ok(Array.isArray(SUBJECT_POOL) && SUBJECT_POOL.length >= 3);
  for (const variant of SUBJECT_POOL) {
    // The name is the only word that earns the open on a phone's 35-character
    // subject window; no variant may spend that window without it.
    assert.ok(variant.includes("{Business Name}"), `variant lost the business name: "${variant}"`);
    // Properly capitalized: a variant either opens with the name token or with
    // a capital letter — never a lowercase mail-merge fragment.
    assert.match(variant, /^(\{Business Name\}|[A-Z])/, `lowercase subject: "${variant}"`);
    // The retired hooks are unreachable.
    assert.doesNotMatch(variant, /quick one|did I get this right/i);
    // No variant carries the trade word — the class of subject that produced
    // "Diamond State Plumbing — plumbing".
    assert.doesNotMatch(variant, /\{industry\}/);
  }
});

test("pchSubject ships the whole business name for every rotation lane", () => {
  for (const prospectId of ["p1", "aa", "h-1", "x9", "rot-4", ""]) {
    const subject = pchSubject({ businessName: "Ramon Roofing", city: "Fort Worth", prospectId });
    assert.match(subject, /Ramon Roofing/, `prospectId=${JSON.stringify(prospectId)}: ${subject}`);
    assert.doesNotMatch(subject, /\{|\}/);
  }
});

// ---------------------------------------------------------------------------
// 2. The trade double-word
// ---------------------------------------------------------------------------

test("industryForSubject drops the trade word when the name already says it", () => {
  // The owner's literal example.
  assert.equal(industryForSubject("Diamond State Plumbing", "plumbing"), "");
  // Multi-word trades match as a word run.
  assert.equal(industryForSubject("Comfort Zone Air Conditioning", "air conditioning"), "");
  // A name that does NOT carry the trade keeps it.
  assert.equal(industryForSubject("Riverside Services", "plumbing"), "plumbing");
  // Substrings never fire: "Temperature Pros" does not contain the word "hvac".
  assert.equal(industryForSubject("Temperature Pros", "hvac"), "hvac");
  // No trade in means nothing out — never an invented word.
  assert.equal(industryForSubject("Diamond State Plumbing", ""), "");
});

test("seoTitle never says the trade twice", () => {
  const title = seoTitle({
    facts: {
      business_name: "Diamond State Plumbing",
      industry: "plumbing",
      city: "Little Rock",
      state: "AR",
    },
  });
  // The name's own occurrence is the only one.
  const hits = (title.match(/plumbing/gi) || []).length;
  assert.equal(hits, 1, `"${title}" says the trade ${hits} times`);
  // The location clause survives on its own — the title still places them.
  assert.match(title, /Little Rock/);

  // A name that does not carry the trade still gets its trade clause.
  const kept = seoTitle({
    facts: {
      business_name: "O'Brien & Sons",
      industry: "roofing",
      city: "Ventura",
      state: "CA",
    },
  });
  assert.match(kept, /Roofing/);
});

// ---------------------------------------------------------------------------
// 3. The mobile-vs-desktop pair
// ---------------------------------------------------------------------------

const PREVIEW = "https://ramon-roofing.wss-ai.com/";
const BASE = {
  businessName: "Ramon Roofing",
  city: "Fort Worth",
  previewUrl: PREVIEW,
  beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=old",
  afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=new",
  mobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=new-mobile&c=abc123def456",
  currentUrl: "https://ramonroofingtx.com/",
};

test("the pair renders with real pixels and both halves click through to the live site", () => {
  const { html, text } = composeOutreachEmailV3(BASE);
  assert.ok(html.includes("ON A PHONE. ON A DESKTOP."), "the pair block is missing");
  // Both pictures are the supplied captures — never a third image invented here.
  assert.ok(html.includes(BASE.mobileImage.replace(/&/g, "&amp;")), "the phone capture is not the img src");
  assert.match(html, /alt="Ramon Roofing new site on a phone"/);
  assert.match(html, /alt="Ramon Roofing new site on a desktop"/);
  // Each half is wrapped in an anchor to the preview.
  const pair = html.slice(html.indexOf("ON A PHONE. ON A DESKTOP."));
  const anchors = [...pair.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]).slice(0, 2);
  assert.equal(anchors.length, 2, "both halves must be clickable");
  for (const href of anchors) assert.equal(href, PREVIEW);
  // The text half carries the same claim, gated on the same facts.
  assert.ok(text.includes("Most of your customers are on their phone."));
});

test("no recorded mobile capture removes the whole pair — never a placeholder", () => {
  for (const extra of [
    { mobileImage: "" },
    { mobileImage: undefined },
    { afterImage: "" }, // a pair with one picture is not a comparison
  ]) {
    const { html, text } = composeOutreachEmailV3({ ...BASE, ...extra });
    assert.ok(!html.includes("ON A PHONE. ON A DESKTOP."), `pair rendered for ${JSON.stringify(extra)}`);
    assert.ok(!text.includes("Most of your customers are on their phone."), "text half kept the orphaned claim");
  }
});

test("buildProofEmailInputs carries mobileImage only alongside a real preview", () => {
  assert.ok(PROOF_EMAIL_V3_OPTION_KEYS.includes("mobileImage"));
  const withPreview = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: { previewUrl: PREVIEW, mobileImage: BASE.mobileImage, afterImage: BASE.afterImage },
  });
  assert.equal(withPreview.mobileImage, BASE.mobileImage);
  // No preview means nothing built to show — the shot is dropped with the rest
  // of the proof, exactly like beforeImage/afterImage.
  const noPreview = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: { mobileImage: BASE.mobileImage },
  });
  assert.ok(!("mobileImage" in noPreview));
  // And a non-https value is refused, not passed through.
  const junk = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: { previewUrl: PREVIEW, mobileImage: "http://ghost.wss-ai.com/x.jpg" },
  });
  assert.ok(!("mobileImage" in junk));
});

// ---------------------------------------------------------------------------
// Structure: the five-second scan order
// ---------------------------------------------------------------------------

test("the owner's 2026-08-12 order: comparison, then what-you-get, then price, then doors", () => {
  // His literal sequence for the compressed email: 1) the image comparison at
  // the top, 2) what you GET, 3) the story, 4) the price with the waived items
  // struck through, 5) three pictures for how to get in. The doors moved from
  // above the price to BELOW it — how-to-get-in is a thing you read after you
  // want in, not before you know what it costs.
  const { html } = composeOutreachEmailV3({
    ...BASE,
    clientId: "WSS-7A3980",
    rileyPhone: "+19493395562",
    dashboardUrl: "https://wss-ai.com/dashboard",
    dashboardEmail: "owner@ramonroofingtx.com",
    dashboardPin: "123456",
  });
  const pairAt = html.indexOf("ON A PHONE. ON A DESKTOP.");
  const getAt = html.indexOf("WHAT YOU GET");
  const storyAt = html.indexOf("Why you? We scan local businesses");
  const priceAt = html.indexOf("IT IS ALREADY BUILT. HERE IS THE HONEST MATH.");
  const doorsAt = html.indexOf("HOW TO GET IN");
  assert.ok(pairAt > -1 && getAt > -1 && storyAt > -1 && priceAt > -1 && doorsAt > -1,
    "a structural block is missing");
  assert.ok(pairAt < getAt, "the comparison must open the email");
  assert.ok(getAt < storyAt, "what-you-get must render above the story");
  assert.ok(storyAt < priceAt, "the story must render above the price card");
  assert.ok(priceAt < doorsAt, "how-to-get-in must render below the price card");
});
