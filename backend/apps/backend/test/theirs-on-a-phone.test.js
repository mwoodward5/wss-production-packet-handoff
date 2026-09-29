"use strict";

// test/theirs-on-a-phone.test.js — THEIR site on a phone, next to OURS on a
// phone. Owner: "show their mobile view... so they can see the difference
// between ours and theirs, not just what ours looks like on both."
//
// Four boundaries, one law each:
//
//   1. CAPTURE (lib/line-proof-shots) records the old-mobile evidence pair —
//      pixel digest + landed URL — beside the desktop fields. The variant was
//      captured and uploaded from day one and recorded NOTHING, which is why
//      the comparison could never render. Identity still refuses first: a
//      phone shot that landed off the prospect's own registrable domain is
//      never stored and never recorded.
//
//   2. THE MINT (lib/email.js shotUrl("old-mobile")) is evidence-or-absent,
//      strictest in the family: recorded digest AND identity-proven landing
//      URL AND a current website, cache-busted from the recorded digest — the
//      42-byte GIF and the immutable-cache incidents are the two ghosts the
//      gate exists for.
//
//   3. THE COMPOSER adapts, never a spacer: theirs-vs-ours phone frames when
//      the evidence exists, the ours-only phone/desktop pair when it does
//      not, and each half links to ITS OWN site (theirs -> their site or
//      unlinked, ours -> the mirror; never theirs -> ours).
//
//   4. THE INPUT BOUNDARY (lib/proof-email-inputs) carries beforeMobileImage
//      only beside a real preview, https-only.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.GHOST_AGENCY_VISUAL_SECRET = process.env.GHOST_AGENCY_VISUAL_SECRET || "test-visual-secret";

const { proofMetaPath } = require("../lib/proof-storage");
const { ensureLineProofShots } = require("../lib/line-proof-shots");
const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { buildProofEmailInputs, PROOF_EMAIL_V3_OPTION_KEYS } = require("../lib/proof-email-inputs");

const MIRROR = "https://wss-test-flint-plumbing-buda.wss-ai.com/";
const THEIR_SITE = "https://flintplumbing.example/";

// ---------------------------------------------------------------------------
// The same no-network harness as test/line-email-assets.test.js: a fake
// bucket over global.fetch and a browser-shaped stub.
// ---------------------------------------------------------------------------

function fakeBucket(seed = {}) {
  const objects = new Map(Object.entries(seed));
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if ((options.method || "GET").toUpperCase() === "POST") {
      const key = target.split("/object/")[1] || target;
      objects.set(key, Buffer.from(options.body));
      return { ok: true, status: 200, text: async () => "", headers: new Map() };
    }
    const key = target.split("/public/wss-proof-assets/")[1] || "";
    const cleanKey = key.split("?")[0];
    const hit = objects.get(`wss-proof-assets/${cleanKey}`) || objects.get(cleanKey);
    if (!hit) return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (/content-type/i.test(h) ? "application/json" : "") },
      arrayBuffer: async () => hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.byteLength),
    };
  };
  return { objects, restore() { global.fetch = realFetch; } };
}

function fakeBrowser({ landOn = null } = {}) {
  const state = { pages: 0 };
  return {
    state,
    async newPage() {
      state.pages += 1;
      let current = "";
      return {
        async goto(u) { current = landOn || u; return { status: () => 200 }; },
        url() { return current; },
        async waitForTimeout() {},
        async screenshot() { return Buffer.from(`jpeg-bytes-for-${current}`); },
        async close() {},
      };
    },
    async close() {},
  };
}

function metaObject({ variant, url, buildHash, capturedUrl, sha = "d".repeat(64) }) {
  return [
    proofMetaPath({ url, variant }),
    Buffer.from(JSON.stringify({
      schema: "wss-proof-shot-meta-v2",
      variant,
      requested_url: url,
      captured_url: capturedUrl || url,
      build_hash: buildHash || null,
      shot_sha256: sha,
    }), "utf8"),
  ];
}

// ---------------------------------------------------------------------------
// 1. CAPTURE records the old-mobile evidence pair
// ---------------------------------------------------------------------------

test("a fresh capture records old_mobile_shot_sha and old_mobile_captured_url beside the desktop fields", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-aaa",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.match(String(out.shots.old_mobile_shot_sha || ""), /^[0-9a-f]{64}$/, "the phone digest must ride the record");
    assert.ok(String(out.shots.old_mobile_captured_url || "").startsWith(THEIR_SITE), "the landed URL must ride the record");
    // The desktop fields are untouched by the new pair.
    assert.match(String(out.shots.old_shot_sha || ""), /^[0-9a-f]{64}$/);
    assert.ok(String(out.shots.old_captured_url || "").startsWith(THEIR_SITE));
  } finally {
    bucket.restore();
  }
});

test("a REUSED old-mobile shot carries its stored digest and landing URL onto the record", async () => {
  const bucket = fakeBucket(Object.fromEntries([
    metaObject({ variant: "new", url: MIRROR, buildHash: "build-aaa" }),
    metaObject({ variant: "new-mobile", url: MIRROR, buildHash: "build-aaa" }),
    metaObject({ variant: "old", url: THEIR_SITE, capturedUrl: THEIR_SITE }),
    metaObject({ variant: "old-mobile", url: THEIR_SITE, capturedUrl: THEIR_SITE, sha: "e".repeat(64) }),
  ]));
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-aaa",
      browser,
    });
    assert.equal(browser.state.pages, 0, "nothing was re-shot");
    assert.equal(out.shots.old_mobile_shot_sha, "e".repeat(64), "a reuse without its digest un-busts the email <img>");
    assert.ok(String(out.shots.old_mobile_captured_url || "").startsWith(THEIR_SITE));
  } finally {
    bucket.restore();
  }
});

test("an old-mobile capture that landed on somebody else's domain records NOTHING", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser({ landOn: "https://parked-domains-r-us.example/expired" });
  try {
    const out = await ensureLineProofShots({ currentWebsite: THEIR_SITE, previewUrl: MIRROR, browser });
    assert.ok(!out.shots.old_mobile_shot_sha, "a refused capture must not leave a digest behind");
    assert.ok(!out.shots.old_mobile_captured_url);
    const refused = out.results.find((r) => r.variant === "old-mobile");
    assert.match(String(refused.reason || ""), /capture_identity_/);
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. THE MINT — driven through the real compose path (lib/email.js dry run),
// because shotUrl is deliberately not exported.
// ---------------------------------------------------------------------------

const FINGERPRINT = "flint-plumbing-composition-v1";
const RELEASE_EVIDENCE = {
  schema: "siteforge-release-evidence-v1",
  map: {
    verified: true,
    qc_check: { name: "release-map-evidence", detail: "verified" },
    artifact: "screenshots/desktop/map.png",
    evidence_artifact: "screenshots/map-evidence.json",
    manifest_artifact: "screenshots/manifest.json",
    screenshot: { size: 4096, sha256: "c".repeat(64) },
    runtime: { response_ok: true, geometry_ok: true, pixels_ok: true, unique_colors: 32, variance: 120 },
    manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true },
    supporting_checks: [
      { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
      { name: "visual-address-map-directions", pass: true, detail: "verified" },
    ],
    screenshot_url: "https://preview.wss-ai.com/try/FlintZ9/screenshots/desktop/map.png",
  },
  identity: {
    verified: true,
    qc_check: { name: "release-business-identity-match", detail: "matched" },
    expected: { business_name: "Flint Plumbing LLC" },
    actual: { business_name: "Flint Plumbing LLC", public_packet_business_name: "Flint Plumbing LLC", local_business_nodes: 1 },
    public_packet_url: "https://preview.wss-ai.com/try/FlintZ9/packet.json",
  },
  template_family: {
    verified: true,
    qc_check: { name: "release-template-family-match", detail: "matched" },
    expected: { family: "plumbing-pressure-lens" },
    actual: { family: "plumbing-pressure-lens" },
    public_packet_url: "https://preview.wss-ai.com/try/FlintZ9/packet.json",
  },
};

async function compose(extra) {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  const { sendSequenceStep } = require("../lib/email");
  return sendSequenceStep({
    prospect: {
      prospect_id: "flint-1",
      business_name: "Flint Plumbing LLC",
      email: "owner@example.test",
      city: "Buda",
      industry: "plumbing",
      current_website: "https://flintplumb.com/",
      preview_url: "https://preview.wss-ai.com/try/FlintZ9/",
      before_shot_source_url: "https://www.flintplumb.com/",
      siteforge_renderer: "05-build-v8",
      siteforge_generation_fingerprint: FINGERPRINT,
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
      release_evidence: RELEASE_EVIDENCE,
      truth_packet: { intakeGenie: { generation_fingerprint: FINGERPRINT, release_evidence: RELEASE_EVIDENCE } },
      ...extra,
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });
}

/** A full capture record: every variant present, every digest distinct. */
const FULL_SHOTS = Object.freeze({
  build_hash: "a".repeat(64),
  old_shot_sha: "1".repeat(64),
  old_captured_url: "https://www.flintplumb.com/",
  new_shot_sha: "2".repeat(64),
  new_captured_url: "https://preview.wss-ai.com/try/FlintZ9/",
  new_mobile_shot_sha: "3".repeat(64),
  new_mobile_captured_url: "https://preview.wss-ai.com/try/FlintZ9/",
  old_mobile_shot_sha: "4".repeat(64),
  old_mobile_captured_url: "https://flintplumb.com/",
});

test("full evidence mints v=old-mobile, cache-busted from the recorded digest, and the comparison renders", async () => {
  const out = await compose({ proof_shots: { ...FULL_SHOTS } });
  assert.equal(out.ok, true, out.blocked || "");
  assert.match(out.htmlPreview, /v=old-mobile&amp;c=444444444444/, "the old-mobile <img> must be busted on ITS OWN digest");
  assert.ok(out.htmlPreview.includes("ON A PHONE, SIDE BY SIDE."), "the theirs-vs-ours comparison is missing");
  assert.ok(out.htmlPreview.includes("Your site on a phone today"));
  assert.ok(out.htmlPreview.includes("Your new site on a phone"));
  // Theirs links to THEIR site, ours to the mirror — read out of the block.
  const block = out.htmlPreview.slice(
    out.htmlPreview.indexOf("ON A PHONE, SIDE BY SIDE."),
    out.htmlPreview.indexOf("Both are real screenshots"),
  );
  const anchors = [...block.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(anchors.length, 2, "both phones must be clickable");
  assert.equal(anchors[0], "https://flintplumb.com/", "theirs must open their site");
  assert.equal(anchors[1], "https://preview.wss-ai.com/try/FlintZ9/", "ours must open the mirror");
});

test("no recorded old-mobile digest: the mint refuses and the block ADAPTS to the ours-only pair", async () => {
  const { old_mobile_shot_sha, old_mobile_captured_url, ...withoutTheirs } = FULL_SHOTS;
  const out = await compose({ proof_shots: withoutTheirs });
  assert.equal(out.ok, true, out.blocked || "");
  assert.ok(!/v=old-mobile/.test(out.htmlPreview), "no digest may never mint an <img>");
  assert.ok(!out.htmlPreview.includes("Your site on a phone today"));
  assert.ok(out.htmlPreview.includes("ON A PHONE. ON A DESKTOP."), "the block must adapt, never vanish into a spacer");
});

test("an old-mobile record whose landing URL is a stranger's domain is refused at the mint", async () => {
  const out = await compose({
    proof_shots: { ...FULL_SHOTS, old_mobile_captured_url: "https://signature-landscape.example/" },
  });
  assert.equal(out.ok, true, out.blocked || "");
  assert.ok(!/v=old-mobile/.test(out.htmlPreview), "identity mismatch must never caption a stranger's phone render");
  assert.ok(out.htmlPreview.includes("ON A PHONE. ON A DESKTOP."));
});

test("FAIL CLOSED: an old-mobile digest with no recorded landing URL does not mint", async () => {
  const { old_mobile_captured_url, ...unrecorded } = FULL_SHOTS;
  const out = await compose({ proof_shots: unrecorded });
  assert.equal(out.ok, true, out.blocked || "");
  assert.ok(!/v=old-mobile/.test(out.htmlPreview), "absence of evidence is not evidence of a match");
});

// ---------------------------------------------------------------------------
// 3. THE COMPOSER — shapes and links, unit level
// ---------------------------------------------------------------------------

const PREVIEW = "https://ramon-roofing.wss-ai.com/";
const BASE = {
  businessName: "Ramon Roofing",
  city: "Fort Worth",
  previewUrl: PREVIEW,
  currentUrl: "https://ramonroofingtx.com/",
  beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=old",
  afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=new",
  mobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=new-mobile&c=abc123def456",
  beforeMobileImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a.b.c.d&s=sig&v=old-mobile&c=def456abc123",
};

const pairSlice = (html) => html.slice(
  html.indexOf("ON A PHONE, SIDE BY SIDE."),
  html.indexOf("Both are real screenshots"),
);

test("theirs-vs-ours: two labelled phone frames each link to its own site; the desktop strip is DROPPED (mobile-first)", () => {
  const { html, text } = composeOutreachEmailV3(BASE);
  assert.ok(html.includes("ON A PHONE, SIDE BY SIDE."));
  assert.ok(html.includes("Your site on a phone today"));
  assert.ok(html.includes("Your new site on a phone"));
  assert.ok(html.includes(BASE.beforeMobileImage.replace(/&/g, "&amp;")), "their phone capture is not the img src");
  assert.ok(html.includes(BASE.mobileImage.replace(/&/g, "&amp;")), "our phone capture is not the img src");
  const anchors = [...pairSlice(html).matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(anchors, [BASE.currentUrl, PREVIEW], "theirs -> their site, ours -> the mirror");
  // MOBILE-FIRST (owner, 2026-08-13): the desktop before/after STRIP is dropped
  // when the phone pair renders — the greyscale "site before" img is unique to
  // that strip, so its absence proves the drop. The after-shot may still appear
  // as the how-to-get-in door thumbnail; only the desktop comparison strip goes.
  assert.doesNotMatch(html, /alt="Ramon Roofing site before"/, "desktop before/after strip dropped when the phone pair renders");
  // The plain-text half names the same comparison and both destinations.
  assert.ok(text.includes("your site as phones show it today"));
  assert.ok(text.includes(BASE.currentUrl));
  // No empty hrefs anywhere in either shape.
  assert.ok(!html.includes('href=""'));
});

test("their frame is UNLINKED — never linked to our mirror — when their URL is missing or is our own", () => {
  for (const currentUrl of ["", PREVIEW]) {
    const { html } = composeOutreachEmailV3({ ...BASE, currentUrl, beforeImage: "" });
    assert.ok(html.includes("Your site on a phone today"), "the comparison itself still renders");
    const anchors = [...pairSlice(html).matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(anchors, [PREVIEW], `currentUrl=${JSON.stringify(currentUrl)}: only ours may be a link`);
    assert.ok(!html.includes('href=""'));
  }
});

test("no before-mobile capture ADAPTS the block to the ours-only pair; no phone capture at all removes it", () => {
  const adapted = composeOutreachEmailV3({ ...BASE, beforeMobileImage: "" });
  assert.ok(!adapted.html.includes("ON A PHONE, SIDE BY SIDE."));
  assert.ok(!adapted.html.includes("Your site on a phone today"));
  assert.ok(adapted.html.includes("ON A PHONE. ON A DESKTOP."), "the ours-only pair is the adapted shape");

  const removed = composeOutreachEmailV3({ ...BASE, beforeMobileImage: "", mobileImage: "" });
  assert.ok(!removed.html.includes("ON A PHONE, SIDE BY SIDE."));
  assert.ok(!removed.html.includes("ON A PHONE. ON A DESKTOP."), "no evidence, no block — never a placeholder");
});

test("a non-https beforeMobileImage is refused by the composer, not rendered", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, beforeMobileImage: "http://ghost.wss-ai.com/x.jpg" });
  assert.ok(!html.includes("ON A PHONE, SIDE BY SIDE."));
  assert.ok(html.includes("ON A PHONE. ON A DESKTOP."));
});

// ---------------------------------------------------------------------------
// 4. THE INPUT BOUNDARY
// ---------------------------------------------------------------------------

test("buildProofEmailInputs carries beforeMobileImage only beside a real preview, https-only", () => {
  assert.ok(PROOF_EMAIL_V3_OPTION_KEYS.includes("beforeMobileImage"));
  const withPreview = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: { previewUrl: PREVIEW, beforeMobileImage: BASE.beforeMobileImage, mobileImage: BASE.mobileImage },
  });
  assert.equal(withPreview.beforeMobileImage, BASE.beforeMobileImage);
  const noPreview = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: { beforeMobileImage: BASE.beforeMobileImage },
  });
  assert.ok(!("beforeMobileImage" in noPreview));
  const junk = buildProofEmailInputs({
    prospect: { business_name: "Ramon Roofing" },
    cta: { previewUrl: PREVIEW, beforeMobileImage: "http://ghost.wss-ai.com/x.jpg" },
  });
  assert.ok(!("beforeMobileImage" in junk));
});

// ---------------------------------------------------------------------------
// 4. THE FRAME SIZE (audit A4 defect F, 2026-09-05) — the phone shots must
//    render LEGIBLY: 120x260 made a dark-slab hero an unreadable near-black
//    rectangle in 34/34 delivered slots. Pinned here: the legible dimensions,
//    the exact 390:844 ratio, and the fluidity law that keeps narrow reads
//    inside the card.
// ---------------------------------------------------------------------------

test("the phone pair renders each capture at a legible 220x476 — exact 390:844 ratio, fluid, never 120x260", () => {
  const { html } = composeOutreachEmailV3(BASE);
  const block = pairSlice(html);

  // THE PAIR: both phone imgs carry the legible dimensions and the Outlook/
  // Gmail-compatible fluid fallback (width attr for Outlook desktop,
  // max-width:100% + height:auto for every phone client).
  const phoneImgs = [...block.matchAll(/<img [^>]*width="220" height="476"[^>]*>/g)];
  assert.equal(phoneImgs.length, 2, "both phone frames must render at 220x476");
  for (const img of phoneImgs) {
    assert.match(img[0], /max-width:100%/, "a fixed-width phone img can poke out of the card on narrow reads");
    assert.match(img[0], /height:auto/, "without height:auto a narrowed img squashes instead of scaling");
  }
  // The unreadable miniature is gone — from the whole email, both shapes.
  assert.doesNotMatch(html, /width="120" height="260"/, "the 120x260 miniature must not ship");
  assert.doesNotMatch(html, /width="92" height="188"/, "the 92x188 fallback miniature must not ship");

  // THE PAIR GEOMETRY: 234px bezels in a 480px wrapper — side by side where
  // the 600 shell fits it, wrapping below on every phone read (the aligned-
  // table mechanism), never overflowing.
  assert.ok(block.includes(`width="234"`), "the pair halves carry the 234px bezel width");
  assert.ok(block.includes("max-width:480px"), "the pair wrapper carries its 480px max");
  assert.ok(block.includes(`width="480"`), "Outlook desktop gets the width-attribute fallback");
});

test("the ours-only fallback renders the phone at the same legible 220x476 above a full-width desktop still", () => {
  const { html } = composeOutreachEmailV3({ ...BASE, beforeMobileImage: "" });
  assert.ok(html.includes("ON A PHONE. ON A DESKTOP."));
  const adapted = html.slice(
    html.indexOf("ON A PHONE. ON A DESKTOP."),
    html.indexOf("Same site, sized right"),
  );
  // THE PHONE: same legible frame the pair uses — the fallback used to ship a
  // 92x188 thumbnail (audit A4's other unreadable miniature).
  const phoneImg = adapted.match(/<img [^>]*width="220" height="476"[^>]*>/);
  assert.ok(phoneImg, "the fallback phone shot renders at 220x476");
  assert.match(phoneImg[0], /max-width:100%/);
  // THE DESKTOP: full-width still under the phone, ratio-true (height:auto),
  // never a fixed height cropping the 1440x900 capture.
  const desktopImg = adapted.match(/<img [^>]*width="360" height="188"[^>]*>/);
  assert.ok(desktopImg, "the desktop still keeps its 360x188 attributes");
  assert.match(desktopImg[0], /max-width:360px/, "the desktop still stays bounded at 360px");
  assert.match(desktopImg[0], /height:auto/, "the desktop still scales its ratio on narrow reads");
});
