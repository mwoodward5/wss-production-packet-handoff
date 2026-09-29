"use strict";

// ---------------------------------------------------------------------------
// THE EMAIL MAY ONLY CALL IT "LIVE FOOTAGE" WHEN IT REALLY IS.
//
// lib/line-motion-shot has two capture lanes: "hero" — the client's own hero
// video actually playing, seek-driven — and "pan", a scripted scroll it falls
// back to when the hero is dead. Both encode to the same GIF, and the
// generator has recorded which lane won (shots.anim_lane) since the sidecar
// went v3 — but NO composer read it, so every motion caption fired on the
// GIF's mere existence and a pan over a static page went out badged
// "► Watch it move — live footage".
//
// These pin the honest-motion gate: anim_lane travels beside afterAnimUrl
// (proofCta -> buildProofEmailInputs' allowlist -> the composer), and only
// "hero" earns the live-video words. The pan — and any row captured before
// the lane was recorded — still ships its GIF, captioned as the preview it
// is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { buildProofEmailInputs, PROOF_EMAIL_V3_OPTION_KEYS, assertKnownProofEmailInputs } = require("../lib/proof-email-inputs");

const PREVIEW = "https://wss-test-flint-plumbing.wss-ai.com/";
const ANIM = "https://ghost.wss-ai.com/api/media/preview-shot?k=e&s=f&v=gif&c=abc123abc123";

// Everything the mobile phone-pair block needs to render, so the motion copy
// sites are actually in the document under assertion.
const BASE = {
  businessName: "Flint Plumbing",
  previewUrl: PREVIEW,
  beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a&s=b&v=old",
  afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=c&s=d&v=new",
  mobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=m&s=n&v=new-mobile",
  beforeMobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=o&s=p&v=old-mobile",
  currentUrl: "https://flintplumbing.example/",
  postalAddress: "655 S Main St, Suite 200, Orange, CA 92868",
  unsubUrl: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=x",
};

/** The rendered copy as a reader sees it, entities folded. */
function visibleText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&#9654;/g, "▶")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const srcsOf = (html) => [...String(html).matchAll(/<img[^>]+src="([^"]+)"/g)]
  .map((m) => m[1].replace(/&amp;/g, "&"));

test("the hero lane keeps the live-motion copy — that claim is true", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, afterAnimUrl: ANIM, afterAnimLane: "hero" });
  const text = visibleText(html);
  assert.ok(srcsOf(html).includes(ANIM), "the loop renders");
  assert.match(text, /Watch it move — live footage/);
  assert.match(text, /next to your new one moving/);
  assert.match(text, /Your new site — live/i);
  assert.match(html, /live video loop/, "the alt keeps the live claim");
});

test("the pan lane ships the same GIF captioned as a preview — never as video", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, afterAnimUrl: ANIM, afterAnimLane: "pan" });
  const text = visibleText(html);
  // The GIF itself still ships: honesty fixes the words, not the asset.
  assert.ok(srcsOf(html).includes(ANIM), "the pan loop still renders");
  assert.match(text, /Your new site — preview/i);
  assert.match(text, /next to a preview of your new one/);
  assert.match(html, /new site preview/, "the alt says preview");
  // None of the live-motion claims survive.
  assert.doesNotMatch(text, /Watch it move/i);
  assert.doesNotMatch(text, /live footage/i);
  assert.doesNotMatch(text, /new one moving/i);
  assert.doesNotMatch(html, /live video loop/i);
  assert.doesNotMatch(text, /Your new site — live\b/i);
});

test("a loop with no recorded lane is treated as the pan — unknown motion is not live footage", () => {
  // Rows captured before the sidecar recorded anim_lane mint a loop with no
  // lane. Fail-honest: the claim needs the evidence, not the other way round.
  const { html } = composeOutreachEmailV3({ ...BASE, afterAnimUrl: ANIM });
  const text = visibleText(html);
  assert.ok(srcsOf(html).includes(ANIM));
  assert.doesNotMatch(text, /Watch it move/i);
  assert.doesNotMatch(text, /live footage/i);
  assert.doesNotMatch(html, /live video loop/i);
  assert.match(text, /Your new site — preview/i);
});

test("no loop at all keeps the untouched two-screenshot copy", () => {
  const { html } = composeOutreachEmailV3(BASE);
  const text = visibleText(html);
  assert.match(text, /Both are real screenshots at the same phone size/);
  assert.doesNotMatch(text, /Watch it move|live footage|preview of your new one/i);
});

test("the mapper threads the lane beside the loop, and the allowlist admits it", () => {
  assert.ok(PROOF_EMAIL_V3_OPTION_KEYS.includes("afterAnimLane"));
  assert.doesNotThrow(() => assertKnownProofEmailInputs({ afterAnimUrl: ANIM, afterAnimLane: "hero" }));
  const opts = buildProofEmailInputs({
    prospect: { prospect_id: "p1", business_name: "Flint Plumbing" },
    record: {},
    cta: { previewUrl: PREVIEW },
    footer: { postal: BASE.postalAddress, unsubscribe: BASE.unsubUrl },
    businessName: "Flint Plumbing",
    afterAnimUrl: ANIM,
    afterAnimLane: "hero",
    env: {},
  });
  assert.equal(opts.afterAnimUrl, ANIM);
  assert.equal(opts.afterAnimLane, "hero");
});

test("a lane without a loop is a claim about nothing and is not emitted", () => {
  const opts = buildProofEmailInputs({
    prospect: { prospect_id: "p1", business_name: "Flint Plumbing" },
    record: {},
    cta: { previewUrl: PREVIEW },
    footer: { postal: BASE.postalAddress, unsubscribe: BASE.unsubUrl },
    businessName: "Flint Plumbing",
    afterAnimLane: "hero",
    env: {},
  });
  assert.ok(!("afterAnimUrl" in opts));
  assert.ok(!("afterAnimLane" in opts));
});
