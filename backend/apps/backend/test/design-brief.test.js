"use strict";

// test/design-brief.test.js — the brief may only say what it can prove.
//
// These tests are all over the PURE half: ranking, colour rules, and the
// verification gate that stands between a vision model's opinion and a real
// business's website. Nothing here launches a browser.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const db = require("../lib/design-brief");
const theme = require("../lib/mirror-engine/theme");

// ---------------------------------------------------------------------------
// the dependency this module is built on
// ---------------------------------------------------------------------------

test("theme.js still exports the colour maths design-brief re-uses", () => {
  for (const fn of ["normalizeHex", "hexToHsl", "hslToHex", "relativeLuminance", "contrastRatio", "enforceContrast"]) {
    assert.equal(typeof theme[fn], "function", `theme.${fn} is gone — design-brief.js depends on it`);
  }
});

// ---------------------------------------------------------------------------
// synthetic measured evidence — a roofing site, all numbers plausible
// ---------------------------------------------------------------------------

function evidenceFixture(overrides = {}) {
  const measured = {
    viewport: { width: 1280, height: 800 },
    docHeight: 3200,
    title: "Ramon Roofing",
    lang: "en",
    bodySurface: "#FFFFFF",
    backgrounds: { "#FFFFFF": 900000, "#F5F5F5": 120000 },
    textColors: { "#1A1A1A": 4200, "#6B7280": 900, "#FFFFFF": 300 },
    borderColors: { "#E5E7EB": 22, "#DDDDDD": 3 },
    chromaAreas: {},
    fontStats: {
      Anton: { chars: 180, maxSize: 54, area: 90000, weights: { 400: 180 } },
      Inter: { chars: 5200, maxSize: 18, area: 400000, weights: { 400: 4000, 600: 900, 700: 300 } },
    },
    actionFills: {
      "#C53F34": { area: 42000, count: 7, labels: ["Get a Free Estimate", "Call Now"] },
      "#FFFFFF": { area: 12000, count: 3, labels: ["Learn more"] },
    },
    actionInks: {
      "#C53F34": { chars: 60, count: 4, labels: ["Financing"] },
      "#1A1A1A": { chars: 300, count: 22, labels: ["Services"] },
    },
    loudCandidates: [
      { text: "24/7 EMERGENCY ROOF REPAIR", tag: "div", className: "banner", fontSize: 34, weight: 800, color: "#FFFFFF", background: "#C53F34", pinned: false, classLoud: true, inFirstViewport: true, rect: { x: 0, y: 120, width: 1280, height: 88 }, area: 112640 },
      { text: "GAF Master Elite Certified", tag: "span", className: "badge", fontSize: 16, weight: 600, color: "#1A1A1A", background: "", pinned: false, classLoud: true, inFirstViewport: false, rect: { x: 80, y: 1400, width: 280, height: 40 }, area: 11200 },
      { text: "Financing available from $89/mo", tag: "div", className: "promo", fontSize: 22, weight: 700, color: "#FFFFFF", background: "#1A1A1A", pinned: true, classLoud: true, inFirstViewport: true, rect: { x: 0, y: 0, width: 1280, height: 44 }, area: 56320 },
    ],
    images: [
      { url: "https://ramonroofing.com/img/crew.jpg", kind: "img", alt: "Our crew", naturalWidth: 1600, naturalHeight: 1067, renderedWidth: 640, renderedHeight: 427, renderedArea: 273280, x: 0, y: 900, inFirstViewport: false, logoLike: false },
      { url: "https://ramonroofing.com/img/hero-truck.jpg", kind: "img", alt: "", naturalWidth: 2000, naturalHeight: 1100, renderedWidth: 1280, renderedHeight: 704, renderedArea: 901120, x: 0, y: 200, inFirstViewport: true, logoLike: false },
      { url: "https://ramonroofing.com/img/logo.svg", kind: "img", alt: "Ramon Roofing logo", naturalWidth: 220, naturalHeight: 60, renderedWidth: 180, renderedHeight: 48, renderedArea: 8640, x: 24, y: 12, inFirstViewport: true, logoLike: true },
      { url: "https://cdn.example.net/stock/roof.jpg", kind: "img", alt: "", naturalWidth: 800, naturalHeight: 533, renderedWidth: 400, renderedHeight: 266, renderedArea: 106400, x: 0, y: 2200, inFirstViewport: false, logoLike: false },
    ],
    logoCandidates: [
      { url: "https://ramonroofing.com/img/logo.svg", alt: "Ramon Roofing logo", className: "site-logo", inHeader: true, order: 0, naturalWidth: 220, naturalHeight: 60, rect: { x: 24, y: 12, width: 180, height: 48 } },
    ],
    visibleText: [
      "24/7 EMERGENCY ROOF REPAIR",
      "GAF Master Elite Certified",
      "Financing available from $89/mo",
      "Serving Baton Rouge since 2004",
    ],
    elementCount: 812,
    truncatedElements: false,
    ...(overrides.measured || {}),
  };
  return {
    ok: true,
    url: "https://ramonroofing.com",
    finalUrl: "https://ramonroofing.com/",
    capturedAt: "2026-08-10T12:00:00.000Z",
    measured,
    pixelSurface: "#FFFFFF",
    pixelShare: 0.72,
    shots: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// the measured brief
// ---------------------------------------------------------------------------

test("measured brief reads the page without a model", () => {
  const brief = db.briefFromMeasurement(evidenceFixture());

  assert.equal(brief.version, "design-brief-v1");
  assert.equal(brief.surface, "#FFFFFF");
  assert.equal(brief.mode, "light");
  assert.equal(brief.text, "#1A1A1A");
  assert.equal(brief.muted, "#6B7280");
  assert.equal(brief.border, "#E5E7EB");
  assert.equal(brief.fontDisplay, "Anton");
  assert.equal(brief.fontBody, "Inter");
  assert.deepEqual(brief.fontWeights.body, [400, 600, 700]);

  for (const field of ["surface", "text", "muted", "border", "fontDisplay", "fontBody", "mode"]) {
    assert.equal(brief.provenance[field].source, "measured", `${field} must be measured`);
  }
  // Judgement fields are ABSENT, not defaulted, before a vision pass.
  for (const field of ["temperature", "character", "typographyCharacter", "identityImages", "loudElements", "carryOver"]) {
    assert.equal(brief.provenance[field].source, "absent", `${field} must be absent before vision`);
  }
  assert.deepEqual(brief.loudElements, []);
  assert.deepEqual(brief.carryOver, []);
});

test("a page with nothing measurable reports absence, never a guess", () => {
  const empty = db.briefFromMeasurement({
    url: "https://blank.test", finalUrl: "https://blank.test/",
    measured: { backgrounds: {}, textColors: {}, borderColors: {}, fontStats: {}, actionFills: {}, actionInks: {}, loudCandidates: [], images: [], visibleText: [] },
    pixelSurface: "",
  });
  assert.equal(empty.surface, null);
  assert.equal(empty.accent, null);
  assert.equal(empty.fontDisplay, null);
  assert.equal(empty.heroImage, null);
  assert.equal(empty.provenance.accent.source, "absent");
  assert.equal(empty.provenance.surface.source, "absent");
  assert.equal(empty.provenance.accent.confidence, 0);
});

test("hero is the largest real photo above the fold, never the logo", () => {
  const brief = db.briefFromMeasurement(evidenceFixture());
  assert.equal(brief.heroImage.url, "https://ramonroofing.com/img/hero-truck.jpg");
  assert.equal(brief.heroImage.width, 2000, "dimensions come from naturalWidth, not the rendered box");
  assert.ok(!brief.measurements.images.find((i) => i.logoLike && i.photoFloor), "a logo never clears the photo floor");
});

// ---------------------------------------------------------------------------
// whose mark is it — the incident this module was built after
// ---------------------------------------------------------------------------

test("a third-party badge in the header never becomes the client's logo", () => {
  // whitebirdfence.com, verbatim: the header carries the client's own Logo.png
  // AND a HomeAdvisor badge, both logo-shaped, the badge served from the
  // CLIENT'S OWN /wp-content/. Document order is a coin flip that has already
  // been lost once, in production, with every gate green.
  const { logo, refused } = db.chooseLogo([
    { url: "https://client.com/wp-content/uploads/HomeAdvisor-300x73.png", alt: "HomeAdvisor Screened & Approved", className: "", inHeader: true, order: 0, naturalWidth: 300, naturalHeight: 73, rect: { x: 0, y: 0, width: 240, height: 58 } },
    { url: "https://client.com/wp-content/uploads/Logo.png", alt: "Whitebird Fence", className: "site-logo", inHeader: true, order: 1, naturalWidth: 1444, naturalHeight: 1079, rect: { x: 115, y: 30, width: 169, height: 144 } },
  ]);
  assert.equal(logo.url, "https://client.com/wp-content/uploads/Logo.png");
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, "third_party_mark");
});

test("a mark named only in its alt text is still refused", () => {
  // smithandsonstx.com: logo-02-free-img.png with alt="Google Reviews logo".
  // The filename names nothing; the page said whose mark it was in words.
  const { logo, refused } = db.chooseLogo([
    { url: "https://client.com/img/logo-02-free-img.png", alt: "Google Reviews logo", className: "", inHeader: true, order: 0, naturalWidth: 200, naturalHeight: 80, rect: {} },
  ]);
  assert.equal(logo, null, "no mark is better than somebody else's mark");
  assert.equal(refused[0].reason, "third_party_mark");
});

test("third-party marks cannot clear the photo floor, however big or same-origin", () => {
  const measured = evidenceFixture().measured;
  measured.images = [{
    url: "https://ramonroofing.com/img/gaf-master-elite-badge-1200x800.png",
    kind: "img", alt: "GAF Master Elite", naturalWidth: 1200, naturalHeight: 800,
    renderedWidth: 600, renderedHeight: 400, renderedArea: 240000, x: 0, y: 400,
    inFirstViewport: true, logoLike: false,
  }];
  const ranked = db.rankImageCandidates(measured, "https://ramonroofing.com/");
  assert.equal(ranked[0].sameOrigin, true, "it really is on their own domain");
  assert.equal(ranked[0].thirdPartyMark, true);
  assert.equal(ranked[0].photoFloor, false, "hosting a mark is not owning it");
});

test("vision cannot promote a third-party mark to hero or identity", () => {
  const evidence = evidenceFixture();
  evidence.measured.images.push({
    url: "https://ramonroofing.com/img/gaf-badge.png", kind: "img", alt: "GAF",
    naturalWidth: 900, naturalHeight: 700, renderedWidth: 900, renderedHeight: 700,
    renderedArea: 630000, x: 0, y: 300, inFirstViewport: true, logoLike: false,
  });
  const base = db.briefFromMeasurement(evidence);
  const badge = base.measurements.images.find((i) => i.url.includes("gaf-badge"));
  const brief = db.applyVision(base, {
    hero_image_index: badge.index,
    identity_images: [{ index: badge.index, what: "premises", confidence: 0.9 }],
  }, { visibleText: evidence.measured.visibleText });

  assert.ok(brief.refusals.some((r) => r.field === "heroImage" && r.reason === "third_party_mark"));
  assert.ok(brief.refusals.some((r) => r.field === "identityImages" && r.reason === "third_party_mark"));
  assert.ok(!brief.identityImages.some((i) => i.url.includes("gaf-badge")));
  assert.ok(!brief.heroImage.url.includes("gaf-badge"));
});

test("the client's own logo is reported, with its measured rectangle", () => {
  const brief = db.briefFromMeasurement(evidenceFixture());
  assert.equal(brief.measurements.logo.url, "https://ramonroofing.com/img/logo.svg");
  assert.equal(brief.measurements.logo.inHeader, true);
  assert.deepEqual(brief.measurements.logo.rect, { x: 24, y: 12, width: 180, height: 48 });
});

// ---------------------------------------------------------------------------
// accent ranking — "the one used for action", not "the one that appears a lot"
// ---------------------------------------------------------------------------

test("action fills outrank link inks and near-neutrals", () => {
  const ranked = db.rankAccentCandidates(evidenceFixture().measured, "#FFFFFF");
  assert.equal(ranked[0].hex, "#C53F34");
  assert.equal(ranked[0].role, "fill");
  assert.equal(ranked[0].index, 0);
  const white = ranked.find((c) => c.hex === "#FFFFFF");
  assert.ok(!white || white.score < ranked[0].score, "a fill the same colour as the surface cannot win");
  const ink = ranked.find((c) => c.hex === "#1A1A1A");
  assert.ok(ink.score < ranked[0].score, "near-black link text cannot outrank a brand-coloured button");
});

test("a colour that merely covers area is not an accent", () => {
  // Grey covers ten times the area of the brand blue, on twice as many
  // elements. It is still not what a customer clicks.
  const measured = evidenceFixture().measured;
  measured.actionFills = {
    "#EEEEEE": { area: 400000, count: 20, labels: ["Read more"] },
    "#0F6FBF": { area: 30000, count: 4, labels: ["Book Now"] },
  };
  const ranked = db.rankAccentCandidates(measured, "#FFFFFF");
  assert.equal(ranked[0].hex, "#0F6FBF");
});

// ---------------------------------------------------------------------------
// spec point 4 — a brand colour is never silently changed
// ---------------------------------------------------------------------------

test("an accent that already clears 4.5:1 is passed through untouched", () => {
  const r = db.resolveAccentColours("#C53F34", "#FFFFFF");
  assert.equal(r.accent, "#C53F34");
  assert.equal(r.accentText, "#C53F34");
  assert.equal(r.adjustment, null);
  assert.ok(theme.contrastRatio(r.accentText, "#FFFFFF") >= 4.5);
});

test("an illegible accent yields a compliant NEAR-neighbour, and says so", () => {
  const gold = "#F0B429";
  const r = db.resolveAccentColours(gold, "#FFFFFF");

  assert.equal(r.accent, gold, "brief.accent must still be the brand colour");
  assert.notEqual(r.accentText, gold);
  assert.ok(theme.contrastRatio(r.accentText, "#FFFFFF") >= 4.5, "accentText must clear the target");

  assert.ok(r.adjustment, "an adjustment must be recorded");
  assert.equal(r.adjustment.original, gold);
  assert.equal(r.adjustment.adjusted, r.accentText);
  assert.equal(r.adjustment.target, 4.5);
  assert.ok(r.adjustment.ratioBefore < 4.5 && r.adjustment.ratioAfter >= 4.5);

  // NEAR-neighbour: same hue family, so their gold is still gold.
  const before = theme.hexToHsl(gold);
  const after = theme.hexToHsl(r.accentText);
  assert.ok(Math.abs(before.h - after.h) <= 3, `hue drifted ${before.h} -> ${after.h}`);
  assert.ok(Math.abs(before.s - after.s) <= 3, `saturation drifted ${before.s} -> ${after.s}`);
});

test("on a dark page the neighbour is found by going lighter", () => {
  const r = db.resolveAccentColours("#1F3A93", "#0B0B0C");
  assert.equal(r.accent, "#1F3A93");
  assert.ok(theme.contrastRatio(r.accentText, "#0B0B0C") >= 4.5);
  assert.ok(theme.relativeLuminance(r.accentText) > theme.relativeLuminance("#1F3A93"));
});

test("hover moves away from the surface in both modes", () => {
  assert.ok(theme.relativeLuminance(db.hoverOf("#C53F34", "#FFFFFF")) < theme.relativeLuminance("#C53F34"));
  assert.ok(theme.relativeLuminance(db.hoverOf("#C53F34", "#111111")) > theme.relativeLuminance("#C53F34"));
});

// ---------------------------------------------------------------------------
// surface: pixels beat computed styles
// ---------------------------------------------------------------------------

test("when computed styles and pixels disagree, the pixels win and it is recorded", () => {
  const d = db.decideSurface({ bodySurface: "#FFFFFF", backgrounds: { "#FFFFFF": 100 }, pixelSurface: "#101014" });
  assert.equal(d.hex, "#101014");
  assert.match(d.note, /outranks computed body background/);
  assert.ok(d.confidence < 0.9);
  assert.equal(db.modeOfSurface(d.hex), "dark");
});

test("agreement raises confidence; no pixels lowers it", () => {
  assert.ok(db.decideSurface({ bodySurface: "#FFFFFF", backgrounds: {}, pixelSurface: "#FFFFFF", pixelShare: 0.8 }).confidence > 0.9);
  assert.ok(db.decideSurface({ bodySurface: "#FFFFFF", backgrounds: {}, pixelSurface: "" }).confidence < 0.8);
});

test("a plurality is not a certainty — confidence tracks the pixel share", () => {
  // whitebirdfence.com's winning bucket is 24% of pixels, because the
  // photographs shatter into hundreds of buckets. Right answer, thin evidence.
  const thin = db.decideSurface({ bodySurface: "#303138", backgrounds: {}, pixelSurface: "#303138", pixelShare: 0.24 });
  const solid = db.decideSurface({ bodySurface: "#FFFFFF", backgrounds: {}, pixelSurface: "#FFFFFF", pixelShare: 0.75 });
  assert.equal(thin.hex, "#303138");
  assert.ok(thin.confidence < solid.confidence);
  assert.ok(thin.confidence < 0.8, `a 24% plurality read as ${thin.confidence}`);
  assert.match(thin.note, /24% of pixels/);
});

test("mode is corroborated by the ink, and says when the two disagree", () => {
  const dark = db.briefFromMeasurement({
    url: "https://d.test", finalUrl: "https://d.test/",
    measured: { bodySurface: "#303138", backgrounds: {}, textColors: { "#F1F1F1": 1000 }, borderColors: {}, fontStats: {}, actionFills: {}, actionInks: {}, loudCandidates: [], images: [], visibleText: [] },
    pixelSurface: "#303138", pixelShare: 0.24,
  });
  assert.equal(dark.mode, "dark");
  assert.match(dark.provenance.mode.note, /corroborated by body text/);

  // Light ink on a light surface: the page cannot be read, so neither can we.
  const muddled = db.briefFromMeasurement({
    url: "https://m.test", finalUrl: "https://m.test/",
    measured: { bodySurface: "#FFFFFF", backgrounds: {}, textColors: { "#F4F4F4": 1000 }, borderColors: {}, fontStats: {}, actionFills: {}, actionInks: {}, loudCandidates: [], images: [], visibleText: [] },
    pixelSurface: "#FFFFFF", pixelShare: 0.8,
  });
  assert.match(muddled.provenance.mode.note, /the two disagree/);
  assert.ok(muddled.provenance.mode.confidence < muddled.provenance.surface.confidence);
});

// ---------------------------------------------------------------------------
// fonts, as rendered
// ---------------------------------------------------------------------------

test("a vivid brand colour is never reported as muted text", () => {
  // dripfixplumbingde.com, measured: their brand blue #38B6FF is 7% of
  // characters and sits neatly between the ink and the paper, so a purely
  // positional test picks it — and hands a builder an accent labelled
  // "secondary copy".
  const brief = db.briefFromMeasurement({
    url: "https://drip.test", finalUrl: "https://drip.test/",
    measured: {
      bodySurface: "#FBFBFB", backgrounds: {},
      textColors: { "#333333": 3100, "#38B6FF": 700, "#666666": 400 },
      borderColors: {}, fontStats: {}, actionFills: {}, actionInks: {},
      loudCandidates: [], images: [], visibleText: [],
    },
    pixelSurface: "#FBFBFB", pixelShare: 0.42,
  });
  assert.notEqual(brief.muted, "#38B6FF");
  assert.equal(brief.muted, "#666666", "the desaturated grey is the muted colour");
});

test("no desaturated candidate means muted is absent, not the nearest colour", () => {
  const brief = db.briefFromMeasurement({
    url: "https://drip.test", finalUrl: "https://drip.test/",
    measured: {
      bodySurface: "#FBFBFB", backgrounds: {},
      textColors: { "#333333": 3100, "#38B6FF": 700 },
      borderColors: {}, fontStats: {}, actionFills: {}, actionInks: {},
      loudCandidates: [], images: [], visibleText: [],
    },
    pixelSurface: "#FBFBFB", pixelShare: 0.42,
  });
  assert.equal(brief.muted, null);
  assert.equal(brief.provenance.muted.source, "absent");
});

test("muted must be legible on the surface, not merely present on the page", () => {
  // dripfixplumbingde.com again: #F8F8F9 is desaturated AND sits between the
  // ink and the paper, but it is 1.03:1 against a white page — it is the copy
  // inside their dark sections. As `muted` it would be invisible text.
  const brief = db.briefFromMeasurement({
    url: "https://drip.test", finalUrl: "https://drip.test/",
    measured: {
      bodySurface: "#FBFBFB", backgrounds: {},
      textColors: { "#333333": 3100, "#F8F8F9": 600 },
      borderColors: {}, fontStats: {}, actionFills: {}, actionInks: {},
      loudCandidates: [], images: [], visibleText: [],
    },
    pixelSurface: "#FBFBFB", pixelShare: 0.42,
  });
  assert.equal(brief.muted, null, "an unreadable colour is not a text colour for this surface");
});

test("display is the biggest type, body is the most characters", () => {
  const f = db.chooseFonts({
    Anton: { chars: 180, maxSize: 54, area: 9000, weights: { 400: 180 } },
    Inter: { chars: 5200, maxSize: 18, area: 40000, weights: { 400: 5000, 700: 200 } },
  });
  assert.equal(f.display, "Anton");
  assert.equal(f.body, "Inter");
});

test("one family doing both jobs is reported for both", () => {
  const f = db.chooseFonts({ Inter: { chars: 5200, maxSize: 48, area: 40000, weights: { 400: 5200 } } });
  assert.equal(f.display, "Inter");
  assert.equal(f.body, "Inter");
});

// ---------------------------------------------------------------------------
// the stylesheet must serve the fonts the brief NAMES
// ---------------------------------------------------------------------------

/** A fetch that serves a fixed page and a Google Fonts endpoint that is honest. */
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

test("a site that LINKS one font and RENDERS another gets an href for what it renders", async () => {
  // whitebirdfence.com, measured: links Open Sans, renders Montserrat + Raleway.
  // Handing back the Open Sans link would ship a typeface the client does not use.
  const brief = db.briefFromMeasurement(evidenceFixture({
    measured: {
      ...evidenceFixture().measured,
      fontStats: {
        Montserrat: { chars: 300, maxSize: 67, area: 90000, weights: { 700: 200, 900: 100 } },
        Raleway: { chars: 2030, maxSize: 18, area: 400000, weights: { 400: 2000, 700: 30 } },
      },
    },
  }));
  const out = await db.attachFontHref(brief, { finalUrl: "https://client.test/" }, fontFetch({
    pageHtml: '<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700">',
    knownFamilies: ["Montserrat", "Raleway", "Open Sans"],
  }));

  assert.match(out.fontHref, /Montserrat/);
  assert.match(out.fontHref, /Raleway/);
  assert.ok(!/Open\+Sans/.test(out.fontHref), "the declared-but-unrendered family must not be served");
  assert.equal(out.provenance.fontHref.source, "measured");
  assert.ok(out.refusals.some((r) => r.reason === "declared_and_rendered_disagree"));
});

test("an href that cannot be verified is absent, not offered", async () => {
  const brief = db.briefFromMeasurement(evidenceFixture({
    measured: { ...evidenceFixture().measured, fontStats: { "Bespoke Foundry Sans": { chars: 900, maxSize: 40, area: 5000, weights: { 400: 900 } } } },
  }));
  const out = await db.attachFontHref(brief, { finalUrl: "https://client.test/" }, fontFetch({
    pageHtml: "<html><body>self hosted</body></html>",
    knownFamilies: ["Montserrat"],
  }));
  assert.equal(out.fontHref, "");
  assert.equal(out.provenance.fontHref.source, "absent");
});

test("when the declared stylesheet does serve the rendered faces, it is used as-is", async () => {
  const brief = db.briefFromMeasurement(evidenceFixture({
    measured: {
      ...evidenceFixture().measured,
      fontStats: {
        Anton: { chars: 180, maxSize: 54, area: 90000, weights: { 400: 180 } },
        Inter: { chars: 5200, maxSize: 18, area: 400000, weights: { 400: 5200 } },
      },
    },
  }));
  const out = await db.attachFontHref(brief, { finalUrl: "https://client.test/" }, fontFetch({
    pageHtml: '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700">',
    knownFamilies: ["Anton", "Inter"],
  }));
  assert.match(out.fontHref, /Anton/);
  assert.match(out.fontHref, /Inter/);
  assert.ok(!out.refusals.some((r) => r.reason === "declared_and_rendered_disagree"));
});

// ---------------------------------------------------------------------------
// THE GATE — what a vision model is and is not allowed to put in the brief
// ---------------------------------------------------------------------------

function briefWithVision(seen) {
  const evidence = evidenceFixture();
  const base = db.briefFromMeasurement(evidence);
  return db.applyVision(base, seen, { visibleText: evidence.measured.visibleText });
}

test("the accent is looked up by index; a hex the model typed is ignored", () => {
  const brief = briefWithVision({
    accent: { candidate_index: 0, why: "every call-to-action button", hex: "#C44B3B" },
    temperature: "warm",
  });
  // #C44B3B is what a real vision model answered for a #C53F34 swatch. It must
  // not be able to reach the brief by any path.
  assert.equal(brief.accent, "#C53F34");
  assert.equal(JSON.stringify(brief).includes("C44B3B"), false, "a model-emitted hex leaked into the brief");
  assert.equal(brief.provenance.accent.source, "measured", "the hex is measured even though the choice was seen");
});

test("an out-of-range index is refused, not clamped", () => {
  const brief = briefWithVision({ accent: { candidate_index: 99 } });
  assert.equal(brief.accent, "#C53F34", "the measured top rank survives a bad pick");
  assert.ok(brief.refusals.some((r) => r.field === "accent" && r.reason === "candidate_index_out_of_range"));
});

test("a DOM-verified credential is allowed through", () => {
  const brief = briefWithVision({
    loud_elements: [{ candidate_index: 2, kind: "certification", text: "GAF Master Elite Certified", text_source: "dom", confidence: 0.9 }],
  });
  const claim = brief.loudElements.find((l) => l.kind === "certification");
  assert.ok(claim, "the badge is genuinely in the page text and must survive");
  assert.equal(claim.textVerified, true);
  assert.equal(claim.isClaim, true);
  assert.deepEqual(claim.rect, { x: 80, y: 1400, width: 280, height: 40 });
  assert.equal(claim.crop.source, "measured");
});

test("a credential read off a picture and NOT in the page text is refused", () => {
  const brief = briefWithVision({
    loud_elements: [
      { candidate_index: null, kind: "accreditation", text: "BBB A+ Accredited Business", text_source: "image", band: "middle", confidence: 0.95 },
      { candidate_index: null, kind: "award", text: "Angi Super Service Award 2025", text_source: "image", band: "lower", confidence: 0.9 },
    ],
  });
  assert.deepEqual(brief.loudElements, [], "no unverifiable credential may reach a real business's site");
  assert.equal(brief.refusals.filter((r) => r.reason === "unverifiable_claim").length, 2);
  assert.ok(brief.refusals.some((r) => r.detail.includes("BBB A+ Accredited Business")));
});

test("a claim disguised by its 'kind' is still caught by its words", () => {
  const brief = briefWithVision({
    loud_elements: [{ candidate_index: null, kind: "promo", text: "Licensed, Bonded & Insured since 1974", text_source: "image", confidence: 0.9 }],
  });
  assert.deepEqual(brief.loudElements, []);
  assert.ok(brief.refusals.some((r) => r.reason === "unverifiable_claim"));
});

test("decorative loudness may be reported from the picture, at lower confidence", () => {
  const brief = briefWithVision({
    loud_elements: [{ candidate_index: null, kind: "promo", text: "Same-day service", text_source: "image", band: "top", confidence: 1 }],
  });
  assert.equal(brief.loudElements.length, 1);
  assert.equal(brief.loudElements[0].textVerified, false);
  assert.equal(brief.loudElements[0].isClaim, false);
  assert.equal(brief.loudElements[0].crop.source, "seen");
  assert.equal(brief.loudElements[0].crop.band, "top");
  assert.ok(brief.loudElements[0].confidence <= db.SEEN_CONFIDENCE_CEILING * 0.7 + 0.001);
});

test("confidence from the model is clamped and capped", () => {
  const brief = briefWithVision({
    loud_elements: [{ candidate_index: 0, kind: "emergency_line", text: "24/7 EMERGENCY ROOF REPAIR", text_source: "dom", confidence: 42 }],
  });
  assert.ok(brief.loudElements[0].confidence <= db.SEEN_CONFIDENCE_CEILING);
});

test("identity images resolve to measured URLs; logos and thumbnails are refused", () => {
  const brief = briefWithVision({
    identity_images: [
      { index: 1, what: "crew", confidence: 0.9 },
      { index: 3, what: "premises", confidence: 0.8 },
    ],
    filler_images: [2],
    hero_image_index: 0,
  });
  assert.equal(brief.identityImages.length, 1);
  assert.equal(brief.identityImages[0].url, "https://ramonroofing.com/img/crew.jpg");
  assert.equal(brief.identityImages[0].what, "crew");
  assert.equal(brief.identityImages[0].sameOrigin, true);
  assert.ok(brief.refusals.some((r) => r.reason === "logo_is_not_a_photograph"));
  assert.deepEqual(brief.fillerImages, ["https://cdn.example.net/stock/roof.jpg"]);
  assert.equal(brief.heroImage.url, "https://ramonroofing.com/img/hero-truck.jpg");
});

test("a logo nominated as the hero is refused", () => {
  const brief = briefWithVision({ hero_image_index: 3 });
  assert.ok(brief.refusals.some((r) => r.reason === "logo_is_not_a_hero"));
  assert.equal(brief.heroImage.url, "https://ramonroofing.com/img/hero-truck.jpg");
});

test("vocabulary is closed — invented feelings are refused", () => {
  const brief = briefWithVision({ temperature: "spicy", character: "vibes", typography_character: "swooshy" });
  assert.equal(brief.temperature, null);
  assert.equal(brief.character, null);
  assert.equal(brief.typographyCharacter, null);
  assert.equal(brief.refusals.filter((r) => r.reason === "not_in_vocabulary").length, 3);
});

test("carry-over anchored to a measured element outranks a floating opinion", () => {
  const brief = briefWithVision({
    carry_over: [
      { what: "The red emergency banner", why: "it is how people reach them at 2am", anchor_kind: "loud", anchor_index: 0, confidence: 1 },
      { what: "The friendly tone", why: "it reads like a person", anchor_kind: "none", anchor_index: null, confidence: 1 },
      { what: "Their EPA Lead-Safe certification", why: "customers ask", anchor_kind: "none", anchor_index: null, confidence: 1 },
    ],
  });
  assert.equal(brief.carryOver.length, 2, "the unverifiable certification must be dropped");
  assert.equal(brief.carryOver[0].anchored, true);
  assert.ok(brief.carryOver[0].confidence <= db.SEEN_CONFIDENCE_CEILING);
  assert.equal(brief.carryOver[1].anchored, false);
  assert.ok(brief.carryOver[1].confidence <= 0.5, "an unanchored opinion is capped lower");
  assert.ok(brief.refusals.some((r) => r.field === "carryOver" && r.reason === "unverifiable_claim"));
});

test("a missing vision result leaves a complete measured brief behind", () => {
  const evidence = evidenceFixture();
  const brief = db.applyVision(db.briefFromMeasurement(evidence), null, { visibleText: [] });
  assert.equal(brief.accent, "#C53F34");
  assert.equal(brief.surface, "#FFFFFF");
  assert.ok(brief.refusals.some((r) => r.reason === "no_vision_result"));
});

// ---------------------------------------------------------------------------
// odds and ends
// ---------------------------------------------------------------------------

test("JSON survives code fences and trailing chatter", () => {
  const parsed = db.extractJsonObject('Sure!\n```json\n{"temperature":"warm","nested":{"a":"}"}}\n```\nHope that helps.');
  assert.equal(parsed.temperature, "warm");
  assert.equal(parsed.nested.a, "}");
  assert.equal(db.extractJsonObject("no json here"), null);
});

test("dominantPixelColor measures the surface from real pixels", () => {
  const png = solidishPng(64, 64, [255, 255, 255], [197, 63, 52], 0.12);
  const found = db.dominantPixelColor(png, { step: 1 });
  assert.equal(found.hex, "#FFFFFF");
  assert.ok(found.share > 0.8);
});

test("dominantPixelColor returns null rather than guessing at undecodable bytes", () => {
  assert.equal(db.dominantPixelColor(Buffer.from("not a png")), null);
});

// ---------------------------------------------------------------------------
// a quoted string must be the WHOLE string
// ---------------------------------------------------------------------------

function loudCandidate(text, extra = {}) {
  return {
    text, tag: "h1", className: "", fontSize: 60, weight: 700, color: "#000000",
    background: "", area: 60000, inFirstViewport: true, pinned: false, classLoud: false,
    ...extra,
  };
}

test("a headline split by an inline tag is ranked whole, not as two fragments", () => {
  // rockys.plumbing: <h1>THE <strong>PLUMBER</strong> CHICKAMAUGA DESERVES</h1>.
  // Direct text nodes alone gave "The Chickamauga Deserves" — a real business's
  // headline with a word missing and the rest reading as a different sentence.
  const ranked = db.rankLoudCandidates({
    loudCandidates: [
      loudCandidate("THE PLUMBER CHICKAMAUGA DESERVES"),
      loudCandidate("PLUMBER", { tag: "strong", area: 9000 }),
    ],
  });
  assert.equal(ranked.length, 1, "the <strong> inside the headline is not a second loud thing");
  assert.equal(ranked[0].text, "THE PLUMBER CHICKAMAUGA DESERVES");
});

test("a genuinely separate line is kept even when it shares words", () => {
  const ranked = db.rankLoudCandidates({
    loudCandidates: [
      loudCandidate("24/7 Emergency Plumber"),
      loudCandidate("Free Estimates", { area: 20000 }),
    ],
  });
  assert.equal(ranked.length, 2, "distinct strings must both survive");
  assert.deepEqual(ranked.map((r) => r.text).sort(), ["24/7 Emergency Plumber", "Free Estimates"]);
});

test("the longest form wins regardless of which order the DOM produced them", () => {
  const short = db.rankLoudCandidates({
    loudCandidates: [loudCandidate("620"), loudCandidate("(662) 328-6203")],
  });
  assert.equal(short.length, 1);
  assert.equal(short[0].text, "(662) 328-6203", "the truncated fragment must never be the survivor");
});

// ---------------------------------------------------------------------------
// crops — the picture must be OF the element it is labelled with
// ---------------------------------------------------------------------------

/** A page that records the screenshot options it was handed. */
function fakePage() {
  const calls = [];
  return {
    calls,
    viewportSize: () => ({ width: 1280, height: 800 }),
    evaluate: async () => { throw new Error("captureLoudCrops must not touch the live page's scroll position"); },
    waitForTimeout: async () => { throw new Error("captureLoudCrops must not wait on a scroll"); },
    screenshot: async (opts) => { calls.push(opts); return Buffer.from(`shot-${calls.length}`); },
  };
}

test("crops are clipped in DOCUMENT coordinates, never by scrolling the live page", async () => {
  // Regression: mmheatingandcooling.com, 2026-08-11. Scrolling to the element
  // and clipping the viewport returned the sticky header — a picture of the
  // Trane badge filed under the hero headline.
  const page = fakePage();
  const el = { rect: { x: 229, y: 6340, width: 407, height: 105 } };
  const out = await db.captureLoudCrops(page, [el], { padding: 12 });

  assert.equal(out.length, 1);
  assert.ok(Buffer.isBuffer(out[0]), "a clippable rect must yield bytes");
  assert.equal(page.calls.length, 1);
  const { clip, fullPage } = page.calls[0];
  assert.equal(fullPage, true, "without fullPage, a y past the fold clips the wrong band or throws");
  // y stays in document space: 6340 - 12 padding. A viewport-relative crop
  // would have subtracted scrollY and landed near the top of the page.
  assert.equal(clip.y, 6328);
  assert.equal(clip.x, 217);
  assert.equal(clip.height, 129);
});

test("a rect that cannot be clipped yields null, not a picture of somewhere else", async () => {
  const page = fakePage();
  page.screenshot = async () => { throw new Error("Clipped area is either empty or outside the resulting image"); };
  const out = await db.captureLoudCrops(page, [{ rect: { x: 0, y: 99999, width: 100, height: 20 } }]);
  assert.deepEqual(out, [null]);
});

test("an element with no measured rect is skipped rather than guessed at", async () => {
  const page = fakePage();
  const out = await db.captureLoudCrops(page, [{ rect: null }, { rect: { x: 10, y: 20, width: 50, height: 30 } }]);
  assert.equal(out[0], null);
  assert.ok(Buffer.isBuffer(out[1]));
  assert.equal(page.calls.length, 1, "the rect-less element must not consume a screenshot");
});

// ---------------------------------------------------------------------------
// cost accounting — the same truth law, applied to money
// ---------------------------------------------------------------------------

test("readUsage normalises both providers' usage blocks", () => {
  const anthropic = db.readUsage("claude-sonnet-4-5", { input_tokens: 3000, output_tokens: 500 });
  const openrouter = db.readUsage("anthropic/claude-sonnet-4.5", { prompt_tokens: 3000, completion_tokens: 500 });
  assert.equal(anthropic.inputTokens, 3000);
  assert.equal(openrouter.inputTokens, 3000);
  assert.equal(anthropic.outputTokens, 500);
  assert.equal(openrouter.outputTokens, 500);
  // 3000/1e6*3 + 500/1e6*15 = 0.009 + 0.0075
  assert.equal(anthropic.costUsd, 0.0165);
  assert.equal(openrouter.costUsd, 0.0165);
});

test("a provider that reports no usage yields null, not a zero that reads as free", () => {
  assert.equal(db.readUsage("claude-sonnet-4-5", undefined), null);
  assert.equal(db.readUsage("claude-sonnet-4-5", {}), null);
});

test("an unpriced model costs null rather than a plausible invented number", () => {
  const usage = db.readUsage("some-new-model-nobody-priced", { input_tokens: 3000, output_tokens: 500 });
  assert.equal(usage.inputTokens, 3000);
  assert.equal(usage.costUsd, null, "an unknown model must not be silently priced as if it were Sonnet");
  assert.equal(db.priceVision("claude-sonnet-4-5", NaN, 500), null);
});

// --- a minimal PNG encoder, so the histogram test uses real bytes -----------

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** `fraction` of the rows painted in `minor`, the rest in `major`. */
function solidishPng(w, h, major, minor, fraction) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  const minorRows = Math.round(h * fraction);
  for (let y = 0; y < h; y += 1) {
    const [r, g, b] = y < minorRows ? minor : major;
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x += 1) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// THE THREE RECORDED FAULTS (8-site run, 2026-08-11) — each fixed, each pinned
// ---------------------------------------------------------------------------

test("FAULT (a): a near-tie between two brand colours is decided by discrete keys, not by area jitter", () => {
  const fills = (redArea, blueArea) => ({
    actionFills: {
      "#C53F34": { area: redArea, count: 6, labels: ["Call Now"] },
      "#1F6FB2": { area: blueArea, count: 5, labels: ["Get a Quote"] },
    },
    actionInks: {},
  });
  // Two renders of the same two-colour brand, areas jittered either way.
  const runA = db.rankAccentCandidates(fills(40000, 41000), "#FFFFFF");
  const runB = db.rankAccentCandidates(fills(40000, 48000), "#FFFFFF");
  assert.equal(runA[0].hex, "#C53F34", "run A picks the higher-count fill");
  assert.equal(runB[0].hex, "#C53F34", "run B picks the SAME colour despite the jitter putting blue's score first");
  assert.match(String(runB[0].decidedBy || ""), /near_tie/, "the tie-break is recorded, not silent");
});

test("FAULT (a): outside the tie margin the score still decides", () => {
  const ranked = db.rankAccentCandidates({
    actionFills: {
      "#C53F34": { area: 400000, count: 9, labels: ["Call"] },
      "#1F6FB2": { area: 4000, count: 1, labels: ["x"] },
    },
    actionInks: {},
  }, "#FFFFFF");
  assert.equal(ranked[0].hex, "#C53F34");
  assert.equal(ranked[0].decidedBy, undefined, "a clear win is not annotated as a tie");
});

test("FAULT (b): a near-white top action colour ABSTAINS instead of shipping as the brand", () => {
  const brief = db.briefFromMeasurement(evidenceFixture({
    measured: {
      ...evidenceFixture().measured,
      actionFills: { "#F8F8F9": { area: 90000, count: 8, labels: ["Learn more"] } },
      actionInks: {},
    },
  }));
  assert.equal(brief.accent, null, "no accent is the honest answer");
  assert.equal(brief.provenance.accent.source, "absent");
  assert.ok(
    brief.refusals.some((r) => r.field === "accent" && r.reason === "below_saturation_floor"),
    "the abstention is recorded in refusals",
  );
});

test("FAULT (b): vision may not promote a below-floor candidate either", () => {
  const base = db.briefFromMeasurement(evidenceFixture({
    measured: {
      ...evidenceFixture().measured,
      actionFills: {
        "#C53F34": { area: 42000, count: 7, labels: ["Call"] },
        "#F8F8F9": { area: 40000, count: 6, labels: ["Learn more"] },
      },
      actionInks: {},
    },
  }));
  const whiteIdx = base.measurements.accentCandidates.find((c) => c.hex === "#F8F8F9").index;
  const out = db.applyVision(base, { accent: { candidate_index: whiteIdx, why: "the ghost buttons" } }, { visibleText: [] });
  assert.equal(out.accent, "#C53F34", "the measured saturated accent stands");
  assert.ok(out.refusals.some((r) => r.field === "accent" && r.reason === "below_saturation_floor"));
});

test("FAULT (c): a client photograph on a third-party CDN is a PHOTO; a badge is still a MARK", () => {
  const images = [
    // Their own crew photo, served from Instagram's CDN — the recorded fault.
    { url: "https://scontent.cdninstagram.com/v/t51.2885-15/crew.jpg", kind: "img", alt: "Our crew on site", naturalWidth: 1080, naturalHeight: 1080, renderedWidth: 500, renderedHeight: 500, renderedArea: 250000, x: 0, y: 900, inFirstViewport: false, logoLike: false },
    // A HomeAdvisor badge served from the client's OWN domain — still a mark.
    { url: "https://client.example.com/wp-content/uploads/homeadvisor-badge.png", kind: "img", alt: "", naturalWidth: 200, naturalHeight: 100, renderedWidth: 200, renderedHeight: 100, renderedArea: 20000, x: 0, y: 60, inFirstViewport: true, logoLike: false },
    // A big image whose ALT names somebody else's mark — the words still refuse it.
    { url: "https://client.example.com/img/reviews-hero.png", kind: "img", alt: "Google Reviews logo", naturalWidth: 900, naturalHeight: 600, renderedWidth: 600, renderedHeight: 400, renderedArea: 240000, x: 0, y: 1400, inFirstViewport: false, logoLike: false },
  ];
  const ranked = db.rankImageCandidates({ images }, "https://client.example.com/");
  const insta = ranked.find((i) => i.url.includes("cdninstagram"));
  const badge = ranked.find((i) => i.url.includes("homeadvisor"));
  const altMark = ranked.find((i) => i.url.includes("reviews-hero"));
  assert.equal(insta.thirdPartyMark, false, "the CDN-hosted photo is not a mark");
  assert.equal(insta.photoFloor, true, "and it clears the photo floor");
  assert.equal(badge.thirdPartyMark, true, "the badge is a mark wherever it is hosted");
  assert.equal(altMark.thirdPartyMark, true, "alt text naming a mark refuses even a big image");
});

// ---------------------------------------------------------------------------
// THE HERO SLOGAN — their own first sentence, measured, then judged
// ---------------------------------------------------------------------------

const FARR_LOUD = [
  { text: "BIG CITY SERVICE. SMALL TOWN VALUE", fontSize: 44, weight: 800, inFirstViewport: true, area: 300000, rect: { x: 0, y: 300, width: 900, height: 120 }, index: 0 },
  { text: "Farr Better Plumbing", fontSize: 30, weight: 700, inFirstViewport: true, area: 60000, rect: { x: 0, y: 40, width: 300, height: 50 }, index: 1 },
  { text: "(417) 555-0123", fontSize: 28, weight: 700, inFirstViewport: true, area: 30000, rect: { x: 900, y: 40, width: 220, height: 40 }, index: 2 },
  { text: "Get a Free Quote", fontSize: 26, weight: 700, inFirstViewport: true, area: 22000, rect: { x: 0, y: 520, width: 220, height: 60 }, index: 3 },
];

test("deriveHeroSlogan reads Farr Better's slogan and folds the shout", () => {
  const slogan = db.deriveHeroSlogan(FARR_LOUD, { businessName: "Farr Better Plumbing" });
  assert.ok(slogan, "a slogan is found");
  assert.equal(slogan.text, "BIG CITY SERVICE. SMALL TOWN VALUE", "verbatim DOM text is kept");
  assert.equal(slogan.display, "Big City Service. Small Town Value", "display case-folds the shout");
  assert.equal(slogan.source, "measured");
});

test("the name, a phone and a button label are never slogans", () => {
  assert.equal(db.deriveHeroSlogan(FARR_LOUD.slice(1), { businessName: "Farr Better Plumbing" }), null);
});

test("foldShoutCase leaves mixed case alone and preserves acronyms", () => {
  assert.equal(db.foldShoutCase("Big City Service"), "Big City Service");
  assert.equal(db.foldShoutCase("24/7 EMERGENCY AC REPAIR"), "24/7 Emergency AC Repair");
});

test("a carousel of same-size slides: the motto outranks the offers, whatever slide the capture landed on", () => {
  // farrbetterplumbing.com, measured 2026-08-12: three 50px hero slides.
  const carousel = (order) => order.map((text, i) => (
    { text, fontSize: 50, weight: 800, inFirstViewport: true, area: 250000 + i, rect: { x: 0, y: 300, width: 900, height: 110 }, index: i }
  ));
  const a = db.deriveHeroSlogan(carousel([
    "NO DRIVE TIME FEE IN SERVICE AREA.",
    "BIG CITY SERVICE. SMALL TOWN VALUES.",
    "NO SERVICE FEES. BILLED HOURLY.",
  ]), { businessName: "Farr Better Plumbing" });
  const b = db.deriveHeroSlogan(carousel([
    "NO SERVICE FEES. BILLED HOURLY.",
    "NO DRIVE TIME FEE IN SERVICE AREA.",
    "BIG CITY SERVICE. SMALL TOWN VALUES.",
  ]), { businessName: "Farr Better Plumbing" });
  assert.equal(a.display, "Big City Service. Small Town Values.");
  assert.equal(b.display, "Big City Service. Small Town Values.", "carousel position does not change the motto");
});

test("vision tagging two slogans: the one that talks money loses", () => {
  const fixture = evidenceFixture({
    measured: {
      ...evidenceFixture().measured,
      loudCandidates: [
        { text: "NO SERVICE FEES. BILLED HOURLY.", tag: "h1", className: "slide", fontSize: 50, weight: 800, color: "#FFFFFF", background: "", pinned: false, classLoud: false, inFirstViewport: true, rect: { x: 0, y: 300, width: 900, height: 110 }, area: 250000 },
        { text: "BIG CITY SERVICE. SMALL TOWN VALUES.", tag: "h1", className: "slide", fontSize: 50, weight: 800, color: "#FFFFFF", background: "", pinned: false, classLoud: false, inFirstViewport: true, rect: { x: 0, y: 300, width: 900, height: 110 }, area: 250000 },
      ],
      visibleText: ["NO SERVICE FEES. BILLED HOURLY.", "BIG CITY SERVICE. SMALL TOWN VALUES."],
    },
  });
  const base = db.briefFromMeasurement(fixture, { businessName: "Farr Better Plumbing" });
  const cands = base.measurements.loudCandidates;
  const idxOf = (t) => cands.find((c) => c.text === t).index;
  const out = db.applyVision(base, {
    loud_elements: [
      { candidate_index: idxOf("NO SERVICE FEES. BILLED HOURLY."), kind: "slogan", text: "NO SERVICE FEES. BILLED HOURLY.", text_source: "dom", band: "upper", confidence: 0.9 },
      { candidate_index: idxOf("BIG CITY SERVICE. SMALL TOWN VALUES."), kind: "slogan", text: "BIG CITY SERVICE. SMALL TOWN VALUES.", text_source: "dom", band: "upper", confidence: 0.9 },
    ],
  }, { visibleText: fixture.measured.visibleText });
  assert.equal(out.heroSlogan.display, "Big City Service. Small Town Values.");
  assert.equal(out.heroSlogan.source, "measured+seen");
});

test("vision flip-flop protection: motto tagged promo + money line tagged slogan changes nothing", () => {
  // The second real Farr run: vision called "BIG CITY SERVICE. SMALL TOWN
  // VALUES." a promo and crowned "NO SERVICE FEES. BILLED HOURLY." the slogan.
  const fixture = evidenceFixture({
    measured: {
      ...evidenceFixture().measured,
      loudCandidates: [
        { text: "NO SERVICE FEES. BILLED HOURLY.", tag: "h1", className: "slide", fontSize: 50, weight: 800, color: "#FFFFFF", background: "", pinned: false, classLoud: false, inFirstViewport: true, rect: { x: 0, y: 300, width: 900, height: 110 }, area: 250000 },
        { text: "BIG CITY SERVICE. SMALL TOWN VALUES.", tag: "h1", className: "slide", fontSize: 50, weight: 800, color: "#FFFFFF", background: "", pinned: false, classLoud: false, inFirstViewport: true, rect: { x: 0, y: 300, width: 900, height: 110 }, area: 250000 },
      ],
      visibleText: ["NO SERVICE FEES. BILLED HOURLY.", "BIG CITY SERVICE. SMALL TOWN VALUES."],
    },
  });
  const base = db.briefFromMeasurement(fixture, { businessName: "Farr Better Plumbing" });
  assert.equal(base.heroSlogan.display, "Big City Service. Small Town Values.", "the measured heuristic already prefers the motto");
  const cands = base.measurements.loudCandidates;
  const idxOf = (t) => cands.find((c) => c.text === t).index;
  const out = db.applyVision(base, {
    loud_elements: [
      { candidate_index: idxOf("NO SERVICE FEES. BILLED HOURLY."), kind: "slogan", text: "NO SERVICE FEES. BILLED HOURLY.", text_source: "dom", band: "upper", confidence: 0.9 },
      { candidate_index: idxOf("BIG CITY SERVICE. SMALL TOWN VALUES."), kind: "promo", text: "BIG CITY SERVICE. SMALL TOWN VALUES.", text_source: "dom", band: "upper", confidence: 0.9 },
    ],
  }, { visibleText: fixture.measured.visibleText });
  assert.equal(out.heroSlogan.display, "Big City Service. Small Town Values.", "the money line may not be crowned and the motto may not be demoted");
});

test("vision confirming kind slogan upgrades the pick; reclassification demotes it", () => {
  const fixture = () => evidenceFixture({
    measured: {
      ...evidenceFixture().measured,
      loudCandidates: [
        { text: "BIG CITY SERVICE. SMALL TOWN VALUE", tag: "h1", className: "hero", fontSize: 44, weight: 800, color: "#FFFFFF", background: "", pinned: false, classLoud: false, inFirstViewport: true, rect: { x: 0, y: 300, width: 900, height: 120 }, area: 300000 },
      ],
      visibleText: ["BIG CITY SERVICE. SMALL TOWN VALUE"],
    },
  });
  const base = db.briefFromMeasurement(fixture(), { businessName: "Farr Better Plumbing" });
  assert.ok(base.heroSlogan, "the measured heuristic already found it");

  const idx = base.measurements.loudCandidates[0].index;
  const confirmed = db.applyVision(base, {
    loud_elements: [{ candidate_index: idx, kind: "slogan", text: "BIG CITY SERVICE. SMALL TOWN VALUE", text_source: "dom", band: "upper", confidence: 0.9 }],
  }, { visibleText: fixture().measured.visibleText });
  assert.equal(confirmed.heroSlogan.source, "measured+seen");
  assert.equal(confirmed.heroSlogan.display, "Big City Service. Small Town Value");

  const demoted = db.applyVision(db.briefFromMeasurement(fixture(), { businessName: "Farr Better Plumbing" }), {
    loud_elements: [{ candidate_index: idx, kind: "emergency_line", text: "BIG CITY SERVICE. SMALL TOWN VALUE", text_source: "dom", band: "upper", confidence: 0.9 }],
  }, { visibleText: fixture().measured.visibleText });
  assert.equal(demoted.heroSlogan, null, "vision calling it something specific demotes the heuristic");
  assert.ok(demoted.refusals.some((r) => r.field === "heroSlogan" && r.reason === "vision_reclassified"));
});


test("vision refusal detail serializes object model values and preserves strings", () => {
  const evidence = evidenceFixture();
  const base = db.briefFromMeasurement(evidence);
  const objectBrief = db.applyVision(base, { character: { code: "invented_character", nested: { value: 1 } } }, { visibleText: evidence.measured.visibleText });
  const objectRefusal = objectBrief.refusals.find((entry) => entry.field === "character" && entry.reason === "not_in_vocabulary");
  assert.equal(objectRefusal.detail, '{"code":"invented_character","nested":{"value":1}}');
  assert.equal(objectRefusal.detail.includes("[object Object]"), false);

  const stringBrief = db.applyVision(base, { character: "invented-character" }, { visibleText: evidence.measured.visibleText });
  const stringRefusal = stringBrief.refusals.find((entry) => entry.field === "character" && entry.reason === "not_in_vocabulary");
  assert.equal(stringRefusal.detail, "invented-character");
});
