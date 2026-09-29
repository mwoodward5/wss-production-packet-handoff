"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { visibilitySnapshotCard, gradeBadgeColor } = require("../lib/email");
const { outreachHtmlV2, pchSubject } = require("../lib/outreach-email-v2");

const FOOTER = {
  postal: "655 S Main St, Suite 200, Orange, CA 92868",
  unsubscribe: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=visibility-token",
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

test("gradeBadgeColor maps grade bands to tasteful, non-forbidden colors", () => {
  assert.equal(gradeBadgeColor("A"), "#3FBF7F");
  assert.equal(gradeBadgeColor("A+"), "#3FBF7F");
  assert.equal(gradeBadgeColor("B"), "#7C9CFF");
  assert.equal(gradeBadgeColor("C"), "#E0A93B");
  assert.equal(gradeBadgeColor("F"), "#8A97AD");
  for (const g of ["A", "B", "C", "D", "F", ""]) {
    assert.doesNotMatch(gradeBadgeColor(g), /8B5CF6|B65CFF|FF7B9C/i, "no design-lock-forbidden color");
  }
});

test("visibility snapshot renders a grade badge and verifiable trust rows", () => {
  const html = visibilitySnapshotCard({ businessName: "Hamstra Heating", rating: 4.8, reviewCount: 120, grade: "B", signals: ["Verified on Google"] });
  assert.match(html, /Your local visibility snapshot/);
  assert.match(html, />B<\/td>/, "grade letter badge");
  assert.ok(html.includes(gradeBadgeColor("B")), "badge uses grade color");
  assert.match(html, /4\.8<\/b>[\s\S]*out of 5/, "rating row");
  assert.match(html, /120<\/b>/, "review count");
  assert.match(html, /Verified on Google/, "trust signal row");
  assert.doesNotMatch(html, /8B5CF6|B65CFF|FF7B9C/i);
});

test("snapshot shows a neutral 'analysis being finalized' state (never a fabricated grade) when there is no verifiable data", () => {
  // TASK 1c: no measured grade AND no measured reputation data -> a deliberate,
  // muted "being finalized" card. Still never fabricates a grade, star, or count.
  for (const input of [{}, { rating: 2.1, reviewCount: 0 }]) {
    const html = visibilitySnapshotCard(input);
    assert.match(html, /Your visibility analysis is being finalized/, "neutral muted state, not an empty hole");
    assert.doesNotMatch(html, />[A-F]<\/td>/, "no fabricated letter-grade badge");
    assert.doesNotMatch(html, /out of 5/, "no fabricated star rating");
    assert.doesNotMatch(html, /Google reviews/, "no fabricated review count");
  }
});

test("snapshot renders truthful partial reputation data without inventing the missing half", () => {
  // reviews present, no rating -> show the review count only (no fake stars)
  const reviewsOnly = visibilitySnapshotCard({ reviewCount: 55 });
  assert.match(reviewsOnly, /55<\/b>[\s\S]*Google reviews/);
  assert.doesNotMatch(reviewsOnly, /out of 5<\/span>/, "no fabricated star value");
  // rating present, no reviews -> show the rating only (no fake review count)
  const ratingOnly = visibilitySnapshotCard({ rating: 5 });
  assert.match(ratingOnly, /5\.0<\/b>[\s\S]*Google rating/);
  assert.doesNotMatch(ratingOnly, /Google reviews/, "no fabricated review count");
});

test("snapshot renders grade alone, or rating alone, without requiring both", () => {
  assert.match(visibilitySnapshotCard({ grade: "A" }), />A<\/td>/);
  const ratingOnly = visibilitySnapshotCard({ rating: 4.9, reviewCount: 88 });
  assert.match(ratingOnly, /4\.9<\/b>/);
  assert.doesNotMatch(ratingOnly, />[A-F]<\/td>/, "no badge when no grade");
});

test("signals are escaped and capped (no injection, no overflow)", () => {
  const html = visibilitySnapshotCard({ grade: "A", signals: ['<script>x</script>', "a", "b", "c", "d", "e"] });
  assert.doesNotMatch(html, /<script>/);
  const rows = (html.match(/&#10003;/g) || []).length; // checkmark per signal row
  assert.ok(rows <= 4, "at most 4 signal rows");
});

// MIGRATED 2026-07-31 (consent-first -> proof-first). Was "consent-first
// subject uses the exact business and city contract", pinning the single fixed
// subject "talk to your website and it changes — for {business} in {city}".
// The shipped subject now comes from the v3 rotation in
// lib/outreach-email-v2.js. What still has to be true, and is asserted, is that
// the business name reaches the subject line and no merge token survives into it.
test("proof-first subject carries the business and never leaks a merge token", () => {
  const subject = pchSubject({ businessName: "Hamstra Heating & Cooling", city: "Tucson", prospectId: "h-1" });
  assert.match(subject, /Hamstra Heating & Cooling/);
  assert.doesNotMatch(subject, /talk to your website and it changes/i);
  assert.doesNotMatch(subject, /\{\{|\}\}|\{city\}|\{Business Name\}/);
});

// MIGRATED 2026-07-31. Was "consent-first email keeps the branded shell and
// renders the complete moral offer". The "moral offer" was the consent
// sentence — reversed by the owner. The BRANDED SHELL half is untouched and is
// what this test is really for: doctype, viewport, the responsive width, the
// greeting, the included list, the sign-off, the postal address, the exact STOP
// promise, and the design-lock colour ban. All still asserted, verbatim.
test("proof-first email keeps the branded shell, the compliance footer, and the colour lock", () => {
  const html = outreachHtmlV2({
    footer: FOOTER,
    senderName: "Mark Woodward",
    senderCity: "Mission Viejo, CA",
    senderPhone: "(949) 339-5562",
    cta: {
      businessName: "Hamstra Heating & Cooling",
      city: "Tucson",
      industry: "HVAC",
      previewUrl: "https://hamstra-heating-cooling.wss-ai.com/",
    },
  });
  const text = readableText(html);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /name="viewport"/i);
  assert.match(html, /max-width:600px/i);
  assert.match(text, /Hi Hamstra Heating & Cooling team,/);
  assert.match(text, /I own an AI-powered web studio here in California/);
  assert.match(text, /Tucson HVAC competitor & search research/);
  assert.match(text, /Lead funnel widgets/);
  assert.match(text, /Hosting, SSL, lead capture & unlimited edits/);
  assert.match(text, /Custom domain setup — included/);
  assert.match(text, /I went ahead and rebuilt the site as a free live preview/);
  // This footer is outreach-email-v2.js's OWN sender-phone line (Mark's cell),
  // not Riley's voice line — v2 is out of the riley-copy-sweep's lane by rule.
  assert.match(text, /Call or text me: \(949\) 339-5562/);
  assert.match(text, /I build these one at a time, here in Mission Viejo, CA/);
  assert.match(text, /655 S Main St, Suite 200, Orange, CA 92868/);
  assert.match(text, /Not interested\? Reply STOP and you won't hear from me again\./);
  assert.doesNotMatch(html, /8B5CF6|B65CFF|FF7B9C/i);
});

// MIGRATED 2026-07-31. Was "consent-first email never renders the retired
// preview, payment, or scarcity mechanic". The preview is no longer retired.
// The payment mechanic and the scarcity countdown are, and every assertion
// about them — plus third-party image hosts and iframes — is kept exactly as it
// was, against exactly the same hostile inputs.
test("proof-first email still never renders the retired payment or scarcity mechanic", () => {
  const html = outreachHtmlV2({
    footer: FOOTER,
    senderName: "Mark Woodward",
    cta: {
      businessName: "Acme Roofing",
      city: "Irvine",
      industry: "roofing",
      previewUrl: "https://acme-roofing.wss-ai.com/",
      revealUrl: "https://ghost.wss-ai.com/api/reveal?token=legacy",
      reportUrl: "https://callprep.wss-ai.com/report/legacy",
      checkoutUrl: "https://buy.stripe.com/legacy",
      currentWebsite: "https://acme-roofing.example/",
      oldSiteShot: "https://s0.wp.com/mshots/v1/before",
      newSiteShot: "https://s0.wp.com/mshots/v1/after",
      expiryDate: "August 5, 2026",
    },
  });

  // The prospect's own preview is the one link that may appear.
  assert.match(html, /acme-roofing\.wss-ai\.com/i);
  // UNCHANGED REFUSALS.
  assert.doesNotMatch(html, /\/api\/reveal|buy\.stripe\.com|s0\.wp\.com\/mshots/i);
  assert.equal((html.match(/<img\b/gi) || []).length, 1, "third-party shots are not proof — only the WSS mark renders");
  assert.match(html, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /Stripe|checkout|Launch my site/i);
  assert.doesNotMatch(html, /live (?:on my server|until)|comes down|delete(?:d| it)?|backups?/i);
  assert.doesNotMatch(html, /August 5, 2026/);
});
