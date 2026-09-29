"use strict";

// test/design-brief-font-fallback.test.js — recover the DISPLAY face when only
// the BODY face is un-serveable.
//
// attachFontHref used to verify one href for BOTH measured families at once.
// That is all-or-nothing: a client whose body copy is a self-hosted foundry
// face lost their headline typeface too, and the mirror shipped entirely in
// the donor's type. The headline is the face a person actually notices, so it
// is worth recovering on its own — but ONLY a Google-VERIFIED family may ever
// be named, and the body family must be DROPPED when the href cannot serve it
// (briefFonts in mirror-lane-build pairs every named family with this one
// href; a family named beside an href that never loads it falls back to the
// browser default, which is worse than the donor's own body face).

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../lib/design-brief");

/** A fetch that serves a fixed page and a Google Fonts endpoint that is honest:
 *  400 for any family Google has never heard of, otherwise CSS naming each. */
function fontFetch({ pageHtml, knownFamilies }) {
  return async (url) => {
    const u = String(url);
    if (u.startsWith("https://fonts.googleapis.com/css2")) {
      const asked = [...u.matchAll(/family=([^:&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, " "));
      const unknown = asked.filter((f) => !knownFamilies.includes(f));
      if (unknown.length) return new Response("", { status: 400 });
      return new Response(asked.map((f) => `@font-face{font-family:'${f}';}`).join("\n"), { status: 200 });
    }
    return new Response(pageHtml, { status: 200, headers: { "content-type": "text/html" } });
  };
}

/** Measured evidence whose only interesting axis is which families rendered. */
function evidenceWithFonts(fontStats) {
  return {
    ok: true,
    url: "https://client.test",
    finalUrl: "https://client.test/",
    capturedAt: "2026-08-19T12:00:00.000Z",
    pixelSurface: "#FFFFFF",
    pixelShare: 0.72,
    shots: [],
    measured: {
      viewport: { width: 1280, height: 800 },
      docHeight: 3200,
      title: "Client",
      lang: "en",
      bodySurface: "#FFFFFF",
      backgrounds: { "#FFFFFF": 900000 },
      textColors: { "#1A1A1A": 4200 },
      borderColors: { "#E5E7EB": 22 },
      chromaAreas: {},
      fontStats,
      actionFills: {},
      actionInks: {},
      loudCandidates: [],
      images: [],
      logoCandidates: [],
      visibleText: [],
      elementCount: 812,
      truncatedElements: false,
    },
  };
}

// Anton renders the headlines (biggest type); the foundry face renders the
// body copy (most characters). Google serves Anton and has never heard of the
// foundry face.
const SPLIT_FONTS = {
  Anton: { chars: 180, maxSize: 54, area: 90000, weights: { 400: 180 } },
  "Bespoke Foundry Sans": { chars: 5200, maxSize: 18, area: 400000, weights: { 400: 5200 } },
};

test("a serveable DISPLAY face survives an un-serveable body face", async () => {
  const brief = db.briefFromMeasurement(evidenceWithFonts(SPLIT_FONTS));
  // Guard the premise: if the roles ever flip, the assertions below would pass
  // for the wrong reason.
  assert.equal(brief.fontDisplay, "Anton");
  assert.equal(brief.fontBody, "Bespoke Foundry Sans");

  const out = await db.attachFontHref(brief, { finalUrl: "https://client.test/" }, fontFetch({
    pageHtml: "<html><body>self-hosted body face, no font link</body></html>",
    knownFamilies: ["Anton"], // Google cannot serve "Bespoke Foundry Sans"
  }));

  // BEFORE the fix the combined Anton+Bespoke href 400s and the whole field is
  // absent — the client loses their headline typeface to the donor as well.
  assert.ok(out.fontHref, "the display face must still be served");
  assert.match(out.fontHref, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(out.fontHref, /family=Anton/);
  assert.ok(!/Bespoke/i.test(out.fontHref), "an un-serveable family must never appear in the href");
  assert.equal(out.provenance.fontHref.source, "measured");

  // Dropping the body family is load-bearing: briefFonts() pairs every named
  // family with this href, and this href does not load the foundry face.
  assert.equal(out.fontBody, null, "the body family must be dropped, not left beside an href that cannot load it");
  assert.equal(out.fontDisplay, "Anton");
  assert.equal(out.provenance.fontBody.source, "absent");
  assert.ok(out.refusals.some((r) => r.field === "fontBody" && r.reason === "body_face_not_servable"));
});

test("the fallback still names only what Google PROVABLY serves", async () => {
  // Neither face is serveable — the field must stay absent. The fallback must
  // not become a way to name an unverified family.
  const brief = db.briefFromMeasurement(evidenceWithFonts({
    "Bespoke Foundry Display": { chars: 180, maxSize: 54, area: 90000, weights: { 400: 180 } },
    "Bespoke Foundry Sans": { chars: 5200, maxSize: 18, area: 400000, weights: { 400: 5200 } },
  }));
  const out = await db.attachFontHref(brief, { finalUrl: "https://client.test/" }, fontFetch({
    pageHtml: "<html><body>self hosted</body></html>",
    knownFamilies: ["Montserrat"],
  }));

  assert.equal(out.fontHref, "");
  assert.equal(out.provenance.fontHref.source, "absent");
  assert.equal(out.fontBody, "Bespoke Foundry Sans", "nothing is dropped when nothing was recovered");
});

test("two serveable faces are still served together", async () => {
  // The fallback must not fire when the combined href verifies.
  const brief = db.briefFromMeasurement(evidenceWithFonts({
    Anton: { chars: 180, maxSize: 54, area: 90000, weights: { 400: 180 } },
    Inter: { chars: 5200, maxSize: 18, area: 400000, weights: { 400: 5200 } },
  }));
  const out = await db.attachFontHref(brief, { finalUrl: "https://client.test/" }, fontFetch({
    pageHtml: "<html><body>self hosted</body></html>",
    knownFamilies: ["Anton", "Inter"],
  }));

  assert.match(out.fontHref, /family=Anton/);
  assert.match(out.fontHref, /family=Inter/);
  assert.equal(out.fontBody, "Inter", "a serveable body face is kept");
  assert.ok(!out.refusals.some((r) => r.reason === "body_face_not_servable"));
});
