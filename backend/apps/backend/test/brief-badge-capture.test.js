"use strict";

// THE CLIENT'S OWN APPROVAL STAMPS, OFF THEIR OWN PAGE.
//
// texasbestfence.com carries a homepage carousel of award/certification
// artwork; the brief measured every one of those images and the engine could
// render credential badge images — but nothing classified badge artwork into
// pride, so zero badge images ever reached a build (traced 2026-08-20). This
// pins the bridge: client-hosted + badge-shaped + badge-MEANING + not the
// logo, labels verbatim from their own alt text, never derived.
const test = require("node:test");
const assert = require("node:assert/strict");
const { briefBadgeImages, withBriefBadges } = require("../lib/mirror-lane-build");

const IMG = (over = {}) => ({
  kind: "img",
  url: "https://texasbestfence.com/wp-content/uploads/afa-pro-award-winner-2025.png",
  alt: "AFA Pro Award Winner 2025",
  naturalWidth: 220, naturalHeight: 220, renderedWidth: 160, renderedHeight: 160,
  renderedArea: 25600, inFirstViewport: false, logoLike: false,
  sameOrigin: true, thirdPartyMark: true, photoFloor: false,
  ...over,
});

function brief(images) {
  return {
    finalUrl: "https://texasbestfence.com/",
    logo: { url: "https://texasbestfence.com/wp-content/uploads/tbf-logo.png" },
    measurements: { images },
  };
}

test("client-hosted badge artwork becomes pride credentials with verbatim alt labels", () => {
  const badges = briefBadgeImages(brief([
    IMG(),
    IMG({ url: "https://texasbestfence.com/wp-content/uploads/bbb-a-plus-accredited.png", alt: "BBB A+ Accredited Business" }),
    IMG({ url: "https://texasbestfence.com/wp-content/uploads/nextdoor-neighborhood-fave.png", alt: "" }),
  ]));
  assert.equal(badges.length, 3);
  assert.equal(badges[0].alt, "AFA Pro Award Winner 2025", "the label is the client's own alt text, verbatim");
  assert.equal(badges[2].alt, "", "no alt means NO label — never derived from a filename");
});

test("selection is earned four ways — each condition alone is refused", () => {
  // Third-party HOSTED: the same badge on the provider's CDN never enters.
  assert.equal(briefBadgeImages(brief([
    IMG({ url: "https://seal.bbb.org/logo/texas-best-a-plus-award.png", sameOrigin: false }),
  ])).length, 0, "hosting on the client's own domain is the ownership boundary");
  // Shape without meaning: a same-origin icon with a mute name stays out.
  assert.equal(briefBadgeImages(brief([
    IMG({ url: "https://texasbestfence.com/assets/arrow-icon.png", alt: "" }),
  ])).length, 0, "badge SHAPE alone earns nothing — the name or alt must say what it is");
  // Meaning without badge shape: their award-page HERO photo is a photo.
  assert.equal(briefBadgeImages(brief([
    IMG({ naturalWidth: 1600, naturalHeight: 900, renderedWidth: 1200, renderedHeight: 675, renderedArea: 810000 }),
  ])).length, 0, "a photograph never rides the badge strip, whatever its filename says");
  // The logo is identity, not a badge — even when its name says "award".
  assert.equal(briefBadgeImages(brief([
    IMG({ url: "https://texasbestfence.com/wp-content/uploads/tbf-logo.png", alt: "Award winning fence company logo" }),
  ])).length, 0, "the brief's chosen logo is excluded by URL");
  // http:// on the client's own domain is still refused.
  assert.equal(briefBadgeImages(brief([
    IMG({ url: "http://texasbestfence.com/wp-content/uploads/afa-pro-award.png" }),
  ])).length, 0);
});

test("withBriefBadges rides badges as credentials[].image and leaves no-badge content untouched", () => {
  const content = { services: [{ name: "Wood Fences" }] };
  const out = withBriefBadges(content, brief([IMG(), IMG({ url: "https://texasbestfence.com/uploads/best-of-denton-county-2025.png", alt: "Best of Denton County 2025" })]), {});
  const creds = out.pride.sections.credentials;
  assert.equal(creds.length, 2);
  assert.equal(creds[1].image, "https://texasbestfence.com/uploads/best-of-denton-county-2025.png");
  assert.equal(creds[1].label, "Best of Denton County 2025");
  assert.equal(creds[1].proof.source, "https://texasbestfence.com/");
  assert.equal(out.services, content.services, "everything else is untouched");

  const untouched = withBriefBadges(content, brief([]), {});
  assert.equal(untouched, content, "zero badges returns the SAME object — no empty pride shell");
});

test("END TO END: badges measured off the client's page render as the strip", () => {
  // The two halves shipped separately (capture here, renderer in
  // content-inject); this is the weld. A brief with three same-origin badge
  // images must come out the other side as three evenly sized strip items.
  const { buildContentHtml } = require("../lib/mirror-engine/content-inject");
  const content = withBriefBadges({}, brief([
    IMG(),
    IMG({ url: "https://texasbestfence.com/uploads/bbb-a-plus-accredited.png", alt: "BBB A+ Accredited" }),
    IMG({ url: "https://texasbestfence.com/uploads/best-of-denton-county.png", alt: "Best of Denton County" }),
  ]), {});
  const html = buildContentHtml({
    content,
    facts: {
      business_name: "Texas Best Fence & Patio", industry: "fencing", city: "Lewisville", state: "TX",
      phone: "+19722450640", website: "https://texasbestfence.com/",
    },
    phoneDigits: "9722450640",
    donorRenders: [],
  });
  assert.match(html, /data-wss-pride="badge-strip"/, "the strip section renders from captured badges");
  assert.equal((html.match(/class="wss-bs__item"/g) || []).length, 3);
  assert.match(html, /BBB A\+ Accredited/);
});

test("existing text credentials are kept; badges fill the raised cap and never push past it", () => {
  // Caps raised 8 -> 24 with the credentials schema cap ("we still dump it
  // in"). Two boundaries, both pinned: badge discovery alone tops out at 24,
  // and when text credentials already hold slots, the bridge tops the TOTAL
  // up to the schema cap and never past it — so the assembled request can
  // never carry more credentials than the schema accepts.
  const { PRIDE_LIST_CAPS } = require("../lib/mirror-lane-build");
  const many = Array.from({ length: 30 }, (_, i) =>
    IMG({ url: `https://texasbestfence.com/uploads/award-badge-${i}.png`, alt: `Award ${i}` }));

  // No existing credentials: discovery alone caps the badges.
  const fresh = withBriefBadges({}, brief(many), {});
  assert.equal(fresh.pride.sections.credentials.length, 24, "twenty-four badge images ride — the raised cap");

  // One existing text credential: 23 badges top the list up to the cap.
  const applied = {};
  const content = { pride: { schema: "design-brief-loud-v1", sections: { credentials: [{ label: "EST. 2004", proof: { source: "x", quote: "EST. 2004" } }] } } };
  const out = withBriefBadges(content, brief(many), { applied });
  const creds = out.pride.sections.credentials;
  assert.equal(creds[0].label, "EST. 2004", "text credentials from the loud pass stay first");
  assert.equal(creds.length, PRIDE_LIST_CAPS.credentials, "the total tops out at the schema cap, never past it");
  assert.equal(applied.badge_images, PRIDE_LIST_CAPS.credentials - 1, "the applied report says how many were captured");
});
