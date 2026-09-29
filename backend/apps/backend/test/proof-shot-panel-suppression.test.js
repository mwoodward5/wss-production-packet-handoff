"use strict";

// OUR PANELS MUST NEVER BE IN A PICTURE OF THE CLIENT'S SITE.
//
// The before/after images in the outreach email are the whole proof. A mirror
// carries three things of ours that a camera can catch: the sign-up panel (the
// price, the "Launch my site now" button and the client's ID code), the chat
// widget, and the lead-capture hook. All three take themselves off the page
// when the URL carries ?wssthumb=1.
//
// WHY THIS FILE EXISTS
// That flag had THREE writers and only two of them were right:
//
//   lib/line-proof-shots.js   shotUrl()        — correct
//   lib/line-motion-shot.js   motionShotUrl()  — correct
//   lib/preview-visuals.js    (nothing)        — MISSING
//
// preview-visuals is the capture half that scripts/capture-proof-shots.js runs,
// and it uploads to the very object keys the email reads back. Every shot it
// ever took included our upsell. That was merely embarrassing while the panel
// was collapsed to a pill in the corner. On 2026-08-10 the panel started
// OPENING BY DEFAULT on a desktop — and 1200x900 is a desktop — so the same
// hole would have mailed the prospect a picture of their own homepage with our
// $149 price and their private Client ID card sitting on top of it.
//
// The fix is one writer (proof-storage.suppressOurPanelsUrl). These tests hold
// every camera to it, and the last one drives the real capture code so a fourth
// camera cannot be added wrong without a red test.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  suppressOurPanelsUrl,
  PANEL_SUPPRESSION_FLAG,
  normalizeProofUrl,
  proofObjectPath,
} = require("../lib/proof-storage");
const { urlForVariant } = require("../lib/line-proof-shots");
const { motionShotUrl } = require("../lib/line-motion-shot");
const { generatePreviewVisuals } = require("../lib/preview-visuals");

const MIRROR = "https://wss-test-rimrock-plumbing.wss-ai.com/";
const THEIRS = "https://rimrockplumbing.example/";

// ---------------------------------------------------------------------------
// 1. THE ONE WRITER
// ---------------------------------------------------------------------------

test("suppressOurPanelsUrl adds the flag once, keeps everything else, and never throws", () => {
  assert.equal(PANEL_SUPPRESSION_FLAG, "wssthumb");
  assert.match(suppressOurPanelsUrl(MIRROR), /[?&]wssthumb=1/);

  // Idempotent: capture paths chain, and two flags is a different URL.
  const once = suppressOurPanelsUrl(MIRROR);
  assert.equal(suppressOurPanelsUrl(once), once);

  // It is additive, not a rewrite — a deep link keeps its path and its params.
  const deep = suppressOurPanelsUrl("https://x.wss-ai.com/services/drains?utm=a");
  assert.match(deep, /\/services\/drains/);
  assert.match(deep, /utm=a/);
  assert.match(deep, /wssthumb=1/);

  // Garbage in, same garbage out. A capture that cannot parse its URL must not
  // lose the URL — it will fail honestly at navigation instead.
  assert.equal(suppressOurPanelsUrl("not a url"), "not a url");
  assert.equal(suppressOurPanelsUrl(""), "");
  assert.equal(suppressOurPanelsUrl(null), "");
});

test("the flag never reaches an object key", () => {
  // normalizeProofUrl deliberately KEEPS query params (sorted) so two different
  // pages cannot collide on one key. That is exactly why a key derived from the
  // flagged URL would fork away from every shot already in the bucket — the
  // 42-byte-spacer failure, arriving through a new door.
  assert.notEqual(normalizeProofUrl(suppressOurPanelsUrl(MIRROR)), normalizeProofUrl(MIRROR));
  assert.notEqual(
    proofObjectPath({ url: suppressOurPanelsUrl(MIRROR), variant: "new" }),
    proofObjectPath({ url: MIRROR, variant: "new" }),
  );
  // So every caller keys off the clean URL and flags only the navigation. The
  // two that publish a URL for a variant prove it here.
  assert.doesNotMatch(String(urlForVariant({ variant: "new", previewUrl: MIRROR, currentWebsite: THEIRS }) || ""), /wssthumb/);
});

// ---------------------------------------------------------------------------
// 2. EVERY CAMERA POINTED AT OUR MIRROR
// ---------------------------------------------------------------------------

test("the motion shot suppresses our panels", () => {
  assert.match(motionShotUrl(MIRROR), /[?&]wssthumb=1/);
});

/**
 * A playwright stand-in that records the URL of every navigation. Deliberately
 * minimal: it implements only what lib/preview-visuals actually calls, so if
 * that file starts doing something new this fails loudly rather than silently
 * capturing nothing.
 */
function recordingPlaywright(record) {
  const makePage = () => ({
    async goto(url) { record.push(String(url)); },
    async waitForLoadState() {},
    async waitForTimeout() {},
    async evaluate() { return []; },
    async setViewportSize() {},
    mouse: { async wheel() {} },
    url() { return record.length ? record[record.length - 1] : ""; },
    async screenshot() { return Buffer.from("fake-jpeg-bytes"); },
    async close() {},
  });
  return {
    chromium: {
      async launch() {
        return {
          async newContext() { return { newPage: async () => makePage(), close: async () => {} }; },
          async newPage() { return makePage(); },
          async close() {},
        };
      },
    },
  };
}

test("generatePreviewVisuals shoots OUR mirror flagged and THEIR site untouched", async () => {
  const navigations = [];
  const out = await generatePreviewVisuals({
    previewUrl: MIRROR,
    currentWebsite: THEIRS,
    mobile: true,
    playwright: recordingPlaywright(navigations),
  });
  assert.equal(out.ok, true);

  const ours = navigations.filter((u) => u.includes("wss-ai.com"));
  const theirs = navigations.filter((u) => u.includes("rimrockplumbing.example"));

  // desktop + mobile + three filmstrip frames all come off one navigation each
  assert.ok(ours.length >= 3, `expected desktop, mobile and filmstrip captures of our mirror, got ${ours.length}`);
  assert.equal(theirs.length, 2, "their site: desktop and mobile");

  assert.ok(
    ours.every((u) => /[?&]wssthumb=1/.test(u)),
    `every capture of our own mirror must suppress our panels: ${JSON.stringify(ours)}`,
  );
  assert.ok(
    theirs.every((u) => !/wssthumb/.test(u)),
    "we do not add query parameters to a stranger's website",
  );
});
