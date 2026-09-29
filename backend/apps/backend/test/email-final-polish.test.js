"use strict";

// test/email-final-polish.test.js — the owner's FINAL POLISH pass on the
// v3-polish-mock branch (2026-09-03), pinned ask by ask.
//
//   1. THE FLAG IS A REAL GRAPHIC. A first-party US flag raster
//      (/brand/us-flag.png) replaces BOTH prior renderings — the pure-table
//      drawn flag AND the 🇺🇸 emoji (which Windows Outlook prints as "US").
//      width 100% of its container, aspect preserved, alt text, https host.
//   2. THE RILEY BUTTONS NEVER DIAL. Every big Riley button opens the WEB
//      surface (the VAPI web-call interface via talkToRileyUrl, else the live
//      site's #chat surface); the phone number is its own separate underlined
//      TEXT link. Two affordances, never one hybrid.
//   3. PHONE NUMBERS READ. The dial link is 18px bold — a real tap target.
//   4. THE LIGHT-SWEEP. The two primary CTAs (OPEN YOUR LIVE PREVIEW, START MY
//      PLAN) carry the sweep: an inline baked band (static highlight where
//      animation is stripped — Outlook, Gmail) plus exactly one <style> block
//      animating it where head CSS survives.
//
// The pinned test strings, prices and data mappings are untouched — this file
// pins only the four NEW behaviours.

const test = require("node:test");
const assert = require("node:assert/strict");

const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");

const PREVIEW = "https://ramon-roofing.wss-ai.com/";
const RILEY = "+19493395562";
const VAPI_WEB = "https://talk.riley.example/webcall";
const BASE = {
  businessName: "Ramon Roofing",
  city: "Fort Worth",
  previewUrl: PREVIEW,
  brandColor: "#C0392B",
  rileyPhone: RILEY,
};

// ---------------------------------------------------------------------------
// 1. The flag is a real first-party graphic — drawn table and emoji retired
// ---------------------------------------------------------------------------

test("the US flag renders as the first-party raster, not the drawn table or the emoji", () => {
  const { html } = composeOutreachEmailV3(BASE);
  // The drawn flag's exact pigments are gone (canton navy, stripe red).
  assert.doesNotMatch(html, /#B22234|#3C3B6E/, "the pure-table drawn flag is still in the email");
  // The emoji is gone — Windows Outlook desktop prints its fallback letters.
  assert.ok(!html.includes("&#127482;&#127480;"), "the 🇺🇸 emoji is still in the email");
  // The raster renders in all three flag spots: brand row, American-AI story
  // card, BUILT WITH AMERICAN AI strip.
  const flags = [...html.matchAll(/<img[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/us-flag\.png"[^>]*>/gi)];
  assert.equal(flags.length, 3, `expected the flag in three spots, got ${flags.length}`);
  for (const [tag] of flags) {
    assert.match(tag, /alt="The flag of the United States"/, "a flag img without its alt text");
    assert.match(tag, /height:auto/, "every flag keeps its aspect ratio");
    assert.match(tag, /aspect-ratio:/, "the aspect must be declared for rescaling clients");
  }
  // The two 63px-container instances fill their column and keep the 800×640
  // aspect; the brand-row instance is a fixed 16×13 inline glyph.
  for (const [tag] of flags.filter((m) => m[0].includes("width=\"63\""))) {
    assert.match(tag, /width:100%/, "the card flags must fill their container");
    assert.match(tag, /height:auto/, "the flag must keep its aspect ratio");
    assert.match(tag, /aspect-ratio:63\/50/, "the aspect must be declared for rescaling clients");
  }
  // The brand-row instance is a real img element with reserved box dimensions.
  assert.match(html, /<img src="https:\/\/ghost\.wss-ai\.com\/brand\/us-flag\.png" width="16" height="13"/);
  // The story-card instance reserves the 63px column box while bytes load.
  assert.match(html, /<img src="https:\/\/ghost\.wss-ai\.com\/brand\/us-flag\.png" width="63" height="50"/);
});

// ---------------------------------------------------------------------------
// 2. Riley buttons open the web surface; the dial is a separate text link
// ---------------------------------------------------------------------------

test("with a VAPI web-call URL, both big Riley buttons link to it and never to tel:", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, talkToRileyUrl: VAPI_WEB });
  // TALK TO RILEY NOW (meet-Riley card) and CALL RILEY NOW (the doors card)
  // both open the web-call interface.
  const buttonHrefs = [...html.matchAll(/<a href="([^"]+)"[^>]*>[^<]*&nbsp;\s*(?:TALK TO RILEY NOW|CALL RILEY NOW)/g)]
    .map((m) => m[1]);
  assert.deepEqual(buttonHrefs.sort(), [VAPI_WEB, VAPI_WEB].sort(), "both Riley buttons must open the VAPI web-call URL");
  // NO anchor in the whole email carries a tel: href while also styled as a
  // big button (the buttons are gradButton tables; the dial link is plain).
  assert.ok(!/href="tel:[^"]*"[^>]*style="[^"]*display:inline-block;padding:0 /.test(html),
    "a big button is dialling — buttons open the web surface, never the dialer");
});

test("without a VAPI URL the buttons fall back to the live chat surface — still never tel:", () => {
  const { html } = composeOutreachEmailV3(BASE);
  const buttonHrefs = [...html.matchAll(/<a href="([^"]+)"[^>]*>[^<]*&nbsp;\s*(?:TALK TO RILEY NOW|CALL RILEY NOW)/g)]
    .map((m) => m[1]);
  assert.ok(buttonHrefs.length >= 2, "both Riley buttons should render");
  for (const href of buttonHrefs) {
    assert.ok(!href.startsWith("tel:"), `a Riley button fell back to the dialer: ${href}`);
    assert.match(href, /^https:\/\//, `a Riley button href is not https: ${href}`);
  }
});

test("the phone number is its own separate underlined text link beside the button", () => {
  const { html, text } = composeOutreachEmailV3({ ...BASE, talkToRileyUrl: VAPI_WEB });
  // Exactly two dial links (meet-Riley card + doors card), each a plain text
  // link — underlined, NOT a filled button, NOT the button's own href.
  const dials = [...html.matchAll(/<a href="tel:\+19493395562"[^>]*>/g)].map((m) => m[0]);
  assert.equal(dials.length, 2, `expected the dial link in two cards, got ${dials.length}`);
  for (const tag of dials) {
    assert.match(tag, /text-decoration:underline/, "the dial link must read as a link");
    assert.match(tag, /font-size:18px/, "the dial link must be 18px");
    assert.match(tag, /font-weight:800/, "the dial link must be bold");
    assert.match(tag, /white-space:nowrap/, "the number must never wrap mid-number");
  }
  // And the display number itself is the link's text — a bare underlined
  // number, no glyph (the button above carries the icon; a glyph here widened
  // the doors card's min-content past the 390 gutter).
  assert.match(html, /\(949\) 339-5562<\/a>/, "the dial link's visible text is the bare number");
  assert.doesNotMatch(html, /&#9742;\s*\(949\)/, "the dial link must not carry a glyph — that is the button's job");
  // The plain-text half carries the web call too when it exists.
  assert.match(text, new RegExp(VAPI_WEB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the text half must name the web-call URL");
  assert.match(text, /\(949\) 339-5562/, "the text half must keep the dial line");
});

test("a phone-only record (no web surface at all) keeps a dial affordance in the door", () => {
  // No previewUrl, no talkToRileyUrl: the doors card's green button is the
  // ONLY affordance, so there — and only there — it carries the dial.
  const { html } = composeOutreachEmailV3({ ...BASE, previewUrl: "" });
  assert.match(html, /<a href="tel:\+19493395562"/, "a phone-only record must keep a dial link");
});

// ---------------------------------------------------------------------------
// 3. The light-sweep on the two primary CTAs
// ---------------------------------------------------------------------------

test("the light-sweep is baked inline and animated by exactly one style block", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, checkoutUrl: "https://ghost.wss-ai.com/api/checkout-link?p=x" });
  // Exactly one <style> block, carrying the keyframes and the class rule.
  const styleBlocks = html.match(/<style>[\s\S]*?<\/style>/g) || [];
  assert.equal(styleBlocks.length, 1, `expected exactly one style block, got ${styleBlocks.length}`);
  assert.match(styleBlocks[0], /@keyframes wssSweep/, "the sweep keyframes are missing");
  assert.match(styleBlocks[0], /\.wss-sweep\{animation:wssSweep/, "the sweep class rule is missing");
  // Exactly TWO swept buttons: OPEN YOUR LIVE PREVIEW and START MY PLAN.
  const swept = [...html.matchAll(/<td class="wss-sweep"/g)];
  assert.equal(swept.length, 2, `exactly the two primary CTAs carry the sweep, got ${swept.length}`);
  const previewBtn = html.indexOf("OPEN YOUR LIVE PREVIEW");
  const planBtn = html.indexOf("START MY PLAN");
  const sweepAt = html.indexOf('class="wss-sweep"');
  const secondSweepAt = html.indexOf('class="wss-sweep"', sweepAt + 1);
  assert.ok(sweepAt > -1 && sweepAt < previewBtn, "the hero preview button must carry the sweep");
  assert.ok(secondSweepAt > previewBtn && secondSweepAt < planBtn, "START MY PLAN must carry the sweep");
  // The inline band is parked off-button (static state = the baked highlight
  // every client renders; the animation walks it across where supported).
  assert.match(html, /background-size:220% 100%,100% 100%,100% 100%/, "the sweep band layer is missing");
  assert.match(html, /background-position:130% 0,0 0,0 0/, "the parked sweep position is missing");
  // The two primary CTAs span full width — the mobile button law. (The
  // lookback reaches from the label back to its button table's width attr.)
  const full = (label) => html.slice(Math.max(0, html.indexOf(label) - 1400), html.indexOf(label));
  assert.match(full("OPEN YOUR LIVE PREVIEW"), /<table role="presentation" width="100%"/, "the hero preview button must be full width");
  assert.match(full("START MY PLAN"), /<table role="presentation" width="100%"/, "START MY PLAN must be full width");
});
