"use strict";

// ---------------------------------------------------------------------------
// THE BEFORE THUMBNAIL MUST NEVER LINK TO OUR MIRROR.
//
// Two real prospect sends on 2026-08-11 (Harris Air 19fefbd709d49422, Advanced
// Mechanical Systems 19fefcfda93c84aa) went out with ONE <a href="{preview}">
// opening above the "Before" cell and closing below the "After" cell. The
// delivered HTML held exactly one anchor in the whole card, and the picture of
// the prospect's own site — greyscaled, captioned "Before" — was a click target
// for our rebuild. Nothing in the email linked to their actual site.
//
// The contract these lock:
//   · BEFORE -> the prospect's own site, or NO anchor at all.
//   · AFTER  -> the live preview.
//   · the two hrefs are NEVER equal, under any input, including a caller that
//     hands the same URL in for both.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { buildProofEmailInputs } = require("../lib/proof-email-inputs");

const PREVIEW = "https://wss-test-harris-air-west-sacramento.wss-ai.com/";
const THEIR_SITE = "https://harrisairwestsac.example/";
const BEFORE_IMG = "https://ghost.wss-ai.com/api/media/preview-shot?k=old.a&s=yX5C&v=old&c=9067bde8aa34";
const AFTER_IMG = "https://ghost.wss-ai.com/api/media/preview-shot?k=new.a&s=1yZR&v=new&c=41cd903d9e77";

const BASE = {
  businessName: "Harris Air",
  city: "West Sacramento",
  previewUrl: PREVIEW,
  beforeImage: BEFORE_IMG,
  afterImage: AFTER_IMG,
  postalAddress: "655 S Main St, Suite 200, Orange, CA 92868",
  unsubUrl: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=x",
};

/**
 * The href of the anchor ENCLOSING a given <img src>, exactly as a mail client
 * would resolve it: "" when the image is not inside an open anchor, null when
 * the image is not in the document at all.
 *
 * Deliberately structural rather than "does the preview URL appear somewhere":
 * the bug was an anchor that opened in the right place and closed in the wrong
 * one, which every substring assertion in this suite happily passed.
 */
function enclosingHref(html, imgSrc) {
  const src = String(imgSrc).replace(/&/g, "&amp;");
  const at = String(html).indexOf(`src="${src}"`);
  if (at < 0) return null;
  const head = String(html).slice(0, at);
  const open = head.lastIndexOf("<a ");
  if (open < 0) return "";
  if (head.lastIndexOf("</a>") > open) return "";
  const m = /href="([^"]*)"/.exec(String(html).slice(open, at));
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

// THE HEADLINE ASSERTION. If this ever fails, the card is once again offering
// one destination behind two different promises.
test("the before and after thumbnails never resolve to the same href", () => {
  const cases = [
    ["their own site on file", { currentUrl: THEIR_SITE }],
    ["no current site on file", {}],
    ["the caller hands us the preview as their site", { currentUrl: PREVIEW }],
    ["the same URL with a trailing-slash difference", { currentUrl: PREVIEW.replace(/\/$/, "") }],
    ["an http (non-https) current site", { currentUrl: "http://harrisairwestsac.example/" }],
    ["an animated after panel", { currentUrl: THEIR_SITE, afterAnimUrl: `${AFTER_IMG}&v=gif` }],
  ];
  for (const [label, extra] of cases) {
    const { html } = composeOutreachEmailV3({ ...BASE, ...extra });
    const afterSrc = extra.afterAnimUrl || AFTER_IMG;
    const before = enclosingHref(html, BEFORE_IMG);
    const after = enclosingHref(html, afterSrc);
    assert.notEqual(before, null, `${label}: the before thumbnail vanished`);
    assert.notEqual(after, null, `${label}: the after thumbnail vanished`);
    assert.equal(after, PREVIEW, `${label}: the after half must open the preview`);
    assert.notEqual(
      before,
      after,
      `${label}: both thumbnails link to ${after} — the before half is advertising our mirror`,
    );
    if (before) {
      assert.notEqual(before, PREVIEW, `${label}: the before half linked to the preview`);
    }
  }
});

test("with their site on file the before thumbnail opens THEIR site", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, currentUrl: THEIR_SITE });
  assert.equal(enclosingHref(html, BEFORE_IMG), THEIR_SITE);
  assert.equal(enclosingHref(html, AFTER_IMG), PREVIEW);
});

test("with no site on file the before thumbnail is not a link at all", () => {
  const { html } = composeOutreachEmailV3(BASE);
  assert.equal(enclosingHref(html, BEFORE_IMG), "", "an unknown destination must render no anchor");
  assert.equal(enclosingHref(html, AFTER_IMG), PREVIEW);
});

// An empty href is a dead click in an inbox, and it is what the old code shipped
// whenever an after-shot arrived without a preview URL.
test("no preview means no anchor, never href=\"\"", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, previewUrl: "", currentUrl: THEIR_SITE });
  assert.doesNotMatch(html, /<a href=""/, "an empty href reached the body");
});

// THE MAPPING HAS TO CARRY IT. The composer cannot link the before half to
// their site if lib/email.js's proofCta never hands the URL across — which is
// how the regression survived: the value was on the cta object the whole time
// and simply had no option to land in.
test("buildProofEmailInputs passes the prospect's own site through as currentUrl", () => {
  const opts = buildProofEmailInputs({
    prospect: { prospect_id: "p1", business_name: "Harris Air" },
    record: {},
    cta: {
      previewUrl: PREVIEW,
      currentUrl: THEIR_SITE,
      currentWebsite: THEIR_SITE,
      beforeImage: BEFORE_IMG,
      afterImage: AFTER_IMG,
    },
    footer: { postal: BASE.postalAddress, unsubscribe: BASE.unsubUrl },
    businessName: "Harris Air",
    city: "West Sacramento",
    env: {},
  });
  assert.equal(opts.currentUrl, THEIR_SITE);

  const { html } = composeOutreachEmailV3(opts);
  assert.equal(enclosingHref(html, BEFORE_IMG), THEIR_SITE);
  assert.equal(enclosingHref(html, AFTER_IMG), PREVIEW);
});
