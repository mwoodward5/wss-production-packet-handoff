"use strict";

// test/email-dashboard-claim-card.test.js
//
// THE DASHBOARD CARD ALWAYS RENDERS (2026-09-03). Until this pass the V3
// composer gated the whole "free backend" slot on `dashboardDoor` (url AND
// email AND pin), so a dry run, an unconfigured store or a failed access-row
// write shipped the email with EMPTY SPACE where every provisioned send shows
// a dashboard card. The card now renders in BOTH states:
//
//   * provisioned — the sign-in card, byte-for-byte the card that always
//     shipped (PIN plate, sign-in line, OPEN YOUR DASHBOARD button);
//   * unprovisioned — a CLAIM-PATH CTA: "Your customer dashboard is ready to
//     claim", button in the email's own gradButton language pointing at the
//     checkout link when one exists.
//
// THE TRUTH LAW, pinned from both directions: the claim card may never say
// the dashboard is live, switched on, or sign-in-able — an unprovisioned row
// cannot be logged into — and may never render a button whose href is absent
// or dead. And the provisioned card must stay exactly itself.

const test = require("node:test");
const assert = require("node:assert/strict");

const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");

const PREVIEW = "https://ramon-roofing.wss-ai.com/";
const BASE = {
  businessName: "Ramon Roofing",
  city: "Fort Worth",
  previewUrl: PREVIEW,
  beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=old",
  afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=new",
  mobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=new-mobile&c=abc123def456",
  currentUrl: "https://ramonroofingtx.com/",
  rileyPhone: "+19493395562",
  checkoutUrl: "https://buy.stripe.com/test_abc",
};
const PROVISIONED = {
  dashboardUrl: "https://wss-ai.com/dashboard",
  dashboardEmail: "owner@ramonroofingtx.com",
  dashboardPin: "482913",
  dashboardMagicLink: "https://wss-ai.com/dashboard#t=signed-token",
};

// ---------------------------------------------------------------------------
// (a) UNPROVISIONED — the card renders WITH the claim CTA
// ---------------------------------------------------------------------------

test("unprovisioned: the dashboard card renders as a claim CTA on the checkout link", () => {
  const { html, text } = composeOutreachEmailV3(BASE);
  // The card itself — never empty space.
  assert.match(html, /YOUR CUSTOMER DASHBOARD IS READY TO CLAIM/, "the claim card is missing");
  // The CTA is a real button carrying the real checkout URL — the email's
  // gradButton language, not a new widget.
  const cta = html.match(/<a href="([^"]+)"[^>]*>CLAIM YOUR DASHBOARD[^<]*<\/a>/);
  assert.ok(cta, "the CLAIM YOUR DASHBOARD button is missing");
  assert.equal(cta[1], BASE.checkoutUrl, "the claim button does not point at the checkout link");
  // BOTH HALVES: the text half carries the same claim, claim-worded.
  assert.match(text, /Your customer dashboard is ready to claim — it comes with your plan\./);
});

test("unprovisioned: the claim card never claims the dashboard is live — truth law", () => {
  const { html, text } = composeOutreachEmailV3(BASE);
  for (const half of [html, text]) {
    // No provisioned-state wording may survive into the claim state.
    assert.ok(!half.includes("YOUR FREE BACKEND IS READY"), "the switched-on eyebrow rendered unprovisioned");
    assert.ok(!half.includes("already switched on"), "a live claim rendered unprovisioned");
    assert.ok(!half.includes("Dashboard PIN"), "a PIN plate rendered with no provisioned row behind it");
    assert.ok(!half.includes("OPEN YOUR DASHBOARD"), "a dashboard door rendered with no door to open");
    // And nothing that could be typed into a login that will 401.
    assert.ok(!half.includes(PROVISIONED.dashboardEmail), "a sign-in email rendered unprovisioned");
    assert.ok(!/PIN:? ?\d{6}/.test(text), "a sign-in PIN rendered unprovisioned");
  }
});

test("unprovisioned with no checkout link: the card still renders — and never a dead button", () => {
  const { checkoutUrl, ...noCheckout } = BASE;
  const { html, text } = composeOutreachEmailV3(noCheckout);
  // ALWAYS-renders law: no checkout URL removes the BUTTON, never the card.
  assert.match(html, /YOUR CUSTOMER DASHBOARD IS READY TO CLAIM/, "the claim card vanished with no checkout link");
  assert.ok(!html.includes("CLAIM YOUR DASHBOARD"), "a claim button rendered with no href to carry");
  // The quiet fallback names the free call path with the number the email
  // already carries — plain text, not a third dial link (the final-polish law
  // pins the tel: inventory at exactly two).
  assert.match(html, /To claim it sooner, call Riley[\s\S]{0,220}?\(949\) 339-5562/);
  const dials = [...html.matchAll(/<a href="tel:\+19493395562"/g)];
  assert.equal(dials.length, 2, "the claim card must not add a third dial link");
  // The absolute floor — no checkout, no Riley line — still renders the card.
  const bare = composeOutreachEmailV3({ ...noCheckout, rileyPhone: "" });
  assert.match(bare.html, /YOUR CUSTOMER DASHBOARD IS READY TO CLAIM/, "the claim card needs nothing to render");
  assert.match(bare.text, /Your customer dashboard is ready to claim/);
});

test("the claim button takes no light-sweep — the two swept primaries stay exactly two", () => {
  const { html } = composeOutreachEmailV3(BASE);
  const swept = [...html.matchAll(/class="wss-sweep"/g)];
  assert.equal(swept.length, 2, "the sweep inventory changed: OPEN YOUR LIVE PREVIEW and START MY PLAN only");
});

// ---------------------------------------------------------------------------
// (b) PROVISIONED — the sign-in card is unchanged
// ---------------------------------------------------------------------------

test("provisioned: the sign-in card renders exactly as before — no claim card, no claim line", () => {
  const { html, text } = composeOutreachEmailV3({ ...BASE, ...PROVISIONED });
  // The provisioned card's load-bearing strings, pinned.
  assert.match(html, /YOUR FREE BACKEND IS READY/);
  assert.match(html, /A whole back office &mdash; already switched on for you\./);
  assert.match(html, /Dashboard PIN/);
  assert.match(html, /Sign in at /);
  // The one-tap button leads with the signed magic link.
  const cta = html.match(/<a href="([^"]+)"[^>]*>OPEN YOUR DASHBOARD[^<]*<\/a>/);
  assert.ok(cta, "the provisioned dashboard button is missing");
  assert.equal(cta[1], PROVISIONED.dashboardMagicLink);
  // The claim state is unreachable when provisioned — one card, the right one.
  assert.ok(!html.includes("READY TO CLAIM"), "the claim card rendered on a provisioned send");
  assert.ok(!text.includes("ready to claim"), "the claim line rendered on a provisioned send");
  // The how-to-get-in door keeps its sign-in pair under the same numbers —
  // the one-tap variant names both the magic link and the manual pair.
  assert.match(text, new RegExp(`2\\. Your dashboard — ask for a change to your site in plain words, and watch it happen: ${PROVISIONED.dashboardMagicLink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(text, new RegExp(`Email: ${PROVISIONED.dashboardEmail} / PIN: ${PROVISIONED.dashboardPin}`));
});

test("the dashboard card slot is never empty in ANY state", () => {
  // Both states, and the lean record (no images, no Riley, no checkout) —
  // whichever card wins, one of the two eyebrows is always present.
  const states = [
    BASE,
    { ...BASE, ...PROVISIONED },
    { businessName: "Lean Plumbing", city: "Irvine", previewUrl: PREVIEW },
  ];
  for (const input of states) {
    const { html } = composeOutreachEmailV3(input);
    const claim = html.includes("YOUR CUSTOMER DASHBOARD IS READY TO CLAIM");
    const signedIn = html.includes("YOUR FREE BACKEND IS READY");
    assert.ok(claim !== signedIn, `exactly one dashboard card must render for ${JSON.stringify(Object.keys(input))}`);
    assert.ok(claim || signedIn, `the dashboard card slot rendered empty for ${JSON.stringify(Object.keys(input))}`);
  }
});
