"use strict";

// ---------------------------------------------------------------------------
// POLICY MIGRATION 2026-07-31: CONSENT-FIRST -> PROOF-FIRST.
//
// This file used to lock the consent-first contract at the composer level:
// "ignore every legacy proof-shot, preview, report and commerce input" (exactly
// one <img>, the WSS mark; the unsubscribe link as the ONLY href), and "the
// replacement copy offers a preview only after a reply".
//
// The owner reversed that product decision on 2026-07-30. The first email now
// SHOWS the rebuilt site, and lib/email.js refuses the send outright when the
// preview or the before/after cannot be produced and attributed. So the two
// assertions about the preview being absent are obsolete BY DESIGN and are
// migrated below to their proof-first equivalents.
//
// WHAT DID NOT CHANGE, and is asserted here exactly as before:
//   · the WSS sender mark is the only non-proof image in the email;
//   · no <iframe>, ever;
//   · a report link (callprep) and a payment link (buy.stripe) never render,
//     even when both are handed to the composer;
//   · an expiry date never renders as a scarcity countdown;
//   · no third-party image host (s0.wp.com/mshots and friends) reaches the body;
//   · the prospect's guarantee that their current site is untouched.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { outreachHtmlV2 } = require("../lib/outreach-email-v2");

const FOOTER = {
  postal: "655 S Main St, Suite 200, Orange, CA 92868",
  unsubscribe: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=proof-token",
  support: "support@wss-ai.com",
};

function readableText(html = "") {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/(?:&#39;|&#x27;|&apos;)/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// MIGRATED. Was "consent-first outreach ignores every legacy proof-shot,
// preview, report, and commerce input". The proof artifacts are no longer
// "legacy" — they are the email. The commerce and report inputs still are.
test("proof-first outreach renders the proof and still drops every report, commerce, and third-party input", () => {
  const html = outreachHtmlV2({
    footer: FOOTER,
    senderName: "Mark Woodward",
    senderCity: "Mission Viejo, CA",
    senderPhone: "(949) 339-5562",
    cta: {
      businessName: "Acme Roofing",
      city: "Irvine",
      industry: "roofing",
      previewUrl: "https://acme-roofing.wss-ai.com/",
      currentUrl: "https://acme-roofing.example/current",
      beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a&v=old",
      afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=b&v=new",
      // Everything below is hostile input the composer must keep refusing.
      revealUrl: "https://ghost.wss-ai.com/api/reveal?token=legacy",
      reportUrl: "https://callprep.wss-ai.com/report/3f5c1a20-9d44-4c8e-b1f7-2a6e0c9d4b81",
      checkoutUrl: "https://buy.stripe.com/legacy",
      logoUrl: "https://acme-roofing.example/logo.svg",
      heroImage: "https://s0.wp.com/mshots/v1/legacy-hero",
      reviewSnapshotImage: "https://acme-roofing.example/reviews.png",
      expiryDate: "August 5, 2026",
    },
  });

  // THE PROOF. Three images: the WSS mark, plus the before and after shots,
  // both served from our own signed proxy.
  assert.equal((html.match(/<img\b/gi) || []).length, 3);
  assert.match(html, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  assert.equal((html.match(/\/api\/media\/preview-shot/g) || []).length, 2);

  // UNCHANGED REFUSALS.
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /\/api\/reveal|buy\.stripe\.com/i);
  assert.doesNotMatch(html, /s0\.wp\.com\/mshots|logo\.svg|reviews\.png/i);
  assert.doesNotMatch(html, /August 5, 2026/);
  assert.doesNotMatch(html, /Stripe|checkout|Launch my site/i);
  assert.doesNotMatch(html, /live (?:on my server|until)|comes down|delete(?:d| it)?|backups?/i);

  // Every rendered link belongs to this prospect or to compliance. Nothing
  // else — the property the old "unsubscribe is the only link" assertion was
  // really protecting.
  const hrefs = [...new Set([...html.matchAll(/\bhref="([^"]+)"/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&")))];
  assert.deepEqual(hrefs.sort(), [
    FOOTER.unsubscribe,
    "https://acme-roofing.example/current",
    "https://acme-roofing.wss-ai.com/",
    // The Signal report now rides along (owner, 2026-08-05). It is OURS and it
    // is about their own site; the composer's host allowlist is what keeps this
    // from becoming a way to place any link at all in front of a prospect.
    "https://callprep.wss-ai.com/report/3f5c1a20-9d44-4c8e-b1f7-2a6e0c9d4b81",
    "mailto:support@wss-ai.com",
  ].sort());
});

// MIGRATED. Was "the replacement copy offers a preview only after a reply and
// protects the current site". The first clause is the reversed policy. The
// second clause — the prospect's own site is never touched, and one reply stops
// everything — is a promise made to a stranger and is asserted verbatim.
test("the proof-first copy shows the preview and still protects the current site", () => {
  const text = readableText(outreachHtmlV2({
    footer: FOOTER,
    senderName: "Mark Woodward",
    senderCity: "Mission Viejo, CA",
    senderPhone: "(949) 339-5562",
    cta: {
      businessName: "Acme Roofing",
      city: "Irvine",
      industry: "roofing",
      previewUrl: "https://acme-roofing.wss-ai.com/",
    },
  }));

  assert.match(text, /I went ahead and rebuilt the site as a free live preview so you could actually see it rather than just imagine it/);
  assert.match(text, /Your current website is untouched\. Want changes, or want the preview taken down\? Just reply/);
  assert.match(text, /Not interested\? Reply STOP and you won't hear from me again\./);
  // The retired offer must not survive anywhere in the same email.
  assert.doesNotMatch(text, /reply and I'll build you a free custom preview/i);
});
