"use strict";

// test/design-diff.test.js — the truth-law gate is the whole point of the tool,
// so it is the thing that gets tested. Everything here is pure; no browser, no
// network, no API key.

const test = require("node:test");
const assert = require("node:assert");

const {
  looksLikeClaim, normalizeText, rgbToHsl, hueDistance, isChromatic, rankTally,
  enforceTruthLaw, verifyRegion, extractJsonObject, cleanList, comparePalettes,
  compareCopy, gateProse, significantTokens, surfaceOf, scanUncorroboratedClaims, SEEN_CEILING,
} = require("../scripts/design-diff.js");

// --- a minimal fake capture, enough for the gate -----------------------------

const IMAGES = [
  { id: "their-desktop-0", site: "theirs", viewport: "desktop", scrollY: 0, width: 1280, height: 900 },
  { id: "our-desktop-0", site: "ours", viewport: "desktop", scrollY: 0, width: 1280, height: 900 },
];

function ev(text, extra = {}) {
  return {
    measured: {
      visibleText: text,
      headings: extra.headings || [],
      backgrounds: extra.backgrounds || {},
      actionColors: extra.actionColors || {},
      images: [], bgImages: [], videoCount: 0, inlineSvgCount: 0,
      fontsHeading: {}, fontsBody: {}, docHeight: 4000, sectionCount: 6, formCount: 1,
      bodyBackground: extra.bodyBackground || "#ffffff",
    },
    palette: extra.palette || null,
  };
}

// ---------------------------------------------------------------------------

test("a credential the page never printed is REFUSED, not carried over", () => {
  const theirEv = ev("Reliable heating and cooling in Bridgeport. Call today for a free estimate.");
  const ourEv = ev("Heating and cooling. Book a visit.");
  const { kept, refused } = enforceTruthLaw({
    distinctive: [{
      kind: "certification", label: "Master plumber licence badge",
      quotedText: "Master Plumber Lic. #44219", isClaim: true, where: "theirs",
      prominence: "noticeable", confidence: 0.9,
      region: { image: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.1 },
    }],
  }, { theirEv, ourEv, images: IMAGES });

  assert.equal(kept.length, 0, "a licence number nobody printed must not survive");
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, "claim_text_not_found_in_page");
});

test("the SAME credential IS kept once it is really on the page", () => {
  const theirEv = ev("Serving Bridgeport since 1974. Master Plumber Lic. #44219. Free estimates.");
  const ourEv = ev("Heating and cooling. Book a visit.");
  const { kept, refused } = enforceTruthLaw({
    distinctive: [{
      kind: "certification", label: "Master plumber licence badge",
      quotedText: "Master Plumber Lic. #44219", isClaim: true, where: "theirs",
      prominence: "noticeable", confidence: 0.9,
    }],
  }, { theirEv, ourEv, images: IMAGES });

  assert.equal(refused.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].textVerified, true);
  assert.ok(kept[0].confidence <= SEEN_CEILING + 0.15);
});

test("a claim reported with no quoted words is refused outright", () => {
  const theirEv = ev("Some copy. BBB Accredited Business appears here.");
  const { kept, refused } = enforceTruthLaw({
    distinctive: [{ kind: "award", label: "an award seal of some kind", quotedText: "", isClaim: true, where: "theirs" }],
  }, { theirEv, ourEv: ev(""), images: IMAGES });
  assert.equal(kept.length, 0);
  assert.equal(refused[0].reason, "claim_without_quoted_text");
});

test("claim-shaped text is caught even when the model says isClaim:false", () => {
  // The model does not get to opt out of the credential rule by mislabelling.
  const theirEv = ev("We do drains and water heaters.");
  const { kept, refused } = enforceTruthLaw({
    distinctive: [{ kind: "other", label: "a green seal", quotedText: "BBB A+ Accredited", isClaim: false, where: "theirs" }],
  }, { theirEv, ourEv: ev(""), images: IMAGES });
  assert.equal(kept.length, 0);
  assert.equal(refused[0].reason, "claim_text_not_found_in_page");
});

test("a decorative element needs no quoted text and is marked unverified", () => {
  const { kept, refused } = enforceTruthLaw({
    distinctive: [{ kind: "truck", label: "photo of their wrapped service van", quotedText: "", isClaim: false, where: "theirs", confidence: 0.8 }],
  }, { theirEv: ev("copy"), ourEv: ev("copy"), images: IMAGES });
  assert.equal(refused.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].textVerified, false);
  assert.ok(kept[0].confidence <= SEEN_CEILING, "nothing judged from a picture may read as certain");
});

test("a model that volunteers a hex has its element dropped whole", () => {
  const { kept, refused } = enforceTruthLaw({
    distinctive: [{ kind: "slogan", label: "red banner #C53F34 across the top", quotedText: "", isClaim: false, where: "theirs" }],
  }, { theirEv: ev("copy"), ourEv: ev("copy"), images: IMAGES });
  assert.equal(kept.length, 0);
  assert.equal(refused[0].reason, "model_emitted_a_colour");
});

test("regions are clamped to the image, and a bad image index is dropped", () => {
  assert.equal(verifyRegion({ image: 9, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, IMAGES), null);
  assert.equal(verifyRegion({ image: 1, x: 0.1, y: 0.1, w: 0, h: 0.2 }, IMAGES), null);
  const r = verifyRegion({ image: 1, x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, IMAGES);
  assert.equal(r.imageId, "their-desktop-0");
  assert.ok(r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001);
});

test("claim detection covers the classes that become legal problems", () => {
  for (const s of [
    "BBB A+ Accredited", "Licensed & Insured", "Master Plumber Lic. #44219",
    "Angi Super Service Award 2024", "25-Year Warranty", "Family owned since 1974",
    "4.9 stars", "0% APR financing", "$89 Drain Special", "NATE Certified",
  ]) assert.equal(looksLikeClaim(s), true, `should be a claim: ${s}`);
  for (const s of ["Our Services", "Contact Us", "Emergency Plumbing", "About the team"]) {
    assert.equal(looksLikeClaim(s), false, `should not be a claim: ${s}`);
  }
});

test("text verification ignores case, punctuation and whitespace", () => {
  assert.equal(normalizeText("  BBB  A+   Accredited! "), normalizeText("bbb a+ accredited"));
});

test("greys and near-whites are not brand colours", () => {
  assert.equal(isChromatic("#c53f34"), true);
  assert.equal(isChromatic("#ffffff"), false);
  assert.equal(isChromatic("#0b0b0b"), false);
  assert.equal(isChromatic("#8a8a8a"), false);
});

test("hue distance wraps around the colour wheel", () => {
  assert.equal(hueDistance(350, 10), 20);
  assert.equal(hueDistance(10, 350), 20);
  assert.equal(Math.round(rgbToHsl({ r: 197, g: 63, b: 52 }).h), 5);
});

test("palette comparison names the verdict from the measured hue delta", () => {
  const theirEv = { palette: { colors: [{ hex: "#c53f34", share: 0.2, hue: 5, chromatic: true }] }, measured: { actionColors: {}, backgrounds: {} } };
  const same = { palette: { colors: [{ hex: "#d04a3a", share: 0.2, hue: 8, chromatic: true }] }, measured: { actionColors: {}, backgrounds: {} } };
  const wrong = { palette: { colors: [{ hex: "#2b6cb0", share: 0.2, hue: 210, chromatic: true }] }, measured: { actionColors: {}, backgrounds: {} } };
  assert.equal(comparePalettes(theirEv, same).familyMatch, "yes");
  assert.equal(comparePalettes(theirEv, wrong).rows[0].verdict, "different colour");
});

test("owning a swatch of their colour off-screen is not carrying it over", () => {
  // Pioneer Fence: their brand green is 7% of their page — the nav bar and the
  // callback form. Ours has a mint green a visitor never sees.
  const theirEv = { palette: { colors: [{ hex: "#024f35", share: 0.072, hue: 160, chromatic: true }] }, measured: { actionColors: {}, backgrounds: {} } };
  const barely = { palette: { colors: [], all: [] }, measured: { actionColors: { "#05cc86": 3 }, backgrounds: {} } };
  const really = {
    palette: { colors: [{ hex: "#06553a", share: 0.09, hue: 158, chromatic: true }], all: [{ hex: "#06553a", share: 0.09, hue: 158, sat: 0.87, lum: 0.18 }] },
    measured: { actionColors: {}, backgrounds: {} },
  };
  assert.match(comparePalettes(theirEv, barely).rows[0].verdict, /far less of the page/);
  assert.equal(comparePalettes(theirEv, really).rows[0].verdict, "same colour");
});

test("prominence is a RATIO, so a CTA the hero photo outvotes still counts", () => {
  // The earlier proxy asked which tally the match came from, and called
  // Pioneer's heavily-used button yellow unused purely because one dark hero
  // photograph pushed it out of the top-ten pixel buckets. What matters is
  // their share against ours.
  const theirEv = { palette: { colors: [{ hex: "#fecd08", share: 0.172, hue: 48, chromatic: true }] }, measured: { actionColors: {}, backgrounds: {} } };
  const ourPage = (yellowShare) => ({
    palette: {
      colors: [{ hex: "#1b1713", share: 0.6, hue: 30, chromatic: false }],
      all: [{ hex: "#1b1713", share: 0.6, hue: 30, sat: 0.16, lum: 0.09 }, { hex: "#e8a530", share: yellowShare, hue: 38, sat: 0.8, lum: 0.55 }],
    },
    measured: { actionColors: { "#e8a530": 900 }, backgrounds: {} },
  });

  const carried = comparePalettes(theirEv, ourPage(0.08)).rows[0];
  assert.equal(carried.nearestOurs, "#e8a530");
  assert.equal(carried.verdict, "same colour", "8% against their 17% is the same design decision");

  const dropped = comparePalettes(theirEv, ourPage(0.004)).rows[0];
  assert.match(dropped.verdict, /far less of the page/, "0.4% against their 17% is not");
});

test("copy comparison is exact containment, not a similarity score", () => {
  const theirEv = ev("x", { headings: [{ tag: "h1", text: "Emergency Drain Cleaning" }, { tag: "h2", text: "Why Bridgeport Calls Us" }] });
  const ourEv = ev("Emergency drain cleaning, day or night.");
  const c = compareCopy(theirEv, ourEv);
  assert.deepEqual(c.presentInOurs, ["Emergency Drain Cleaning"]);
  assert.deepEqual(c.missingFromOurs, ["Why Bridgeport Calls Us"]);
});

test("JSON survives a model that wraps it in prose and fences", () => {
  const parsed = extractJsonObject('Sure! Here you go:\n```json\n{"closeness":{"score":4}}\n```\nHope that helps.');
  assert.equal(parsed.closeness.score, 4);
});

test("free-text lists drop anything shaped like a colour value", () => {
  assert.deepEqual(cleanList(["their red is warmer", "ours uses #1a2b3c"]), ["their red is warmer"]);
});

test("light-or-dark is answered from the FOLD, with the whole page beside it", () => {
  // The real M & M mirror: 12,000px of mostly-white page whose first screen is
  // near-black. Reporting "light" here is how a tool tells you a dark-hero
  // rebuild matched a white site.
  const s = surfaceOf({
    measured: { bodyBackground: "#ffffff", backgrounds: {} },
    palette: { surface: { hex: "#fbfcfd", share: 0.42 }, colors: [] },
    foldPalette: { surface: { hex: "#2a1420", share: 0.55 }, colors: [] },
  });
  assert.equal(s.mode, "dark", "the screen a visitor lands on is dark");
  assert.equal(s.pageMode, "light");
  assert.equal(s.foldDisagreesWithPage, true);
  assert.equal(s.hex, "#2a1420");
  assert.equal(s.source, "fold pixels");
});

test("with no fold reading, the whole-page measurement is used and said so", () => {
  const s = surfaceOf({
    measured: { bodyBackground: "#101010", backgrounds: {} },
    palette: { surface: { hex: "#111111", share: 0.6 }, colors: [] },
    foldPalette: null,
  });
  assert.equal(s.mode, "dark");
  assert.equal(s.source, "whole-page pixels");
  assert.equal(s.foldDisagreesWithPage, false);
});

test("prose naming a brand the page never printed is quarantined, not deleted", () => {
  // The real one, from mmheatingandcooling.com: "Wells Fargo" is nowhere in
  // that page's HTML. It exists only as pixels inside a JPEG banner. The report
  // must not tell an owner the prospect has a Wells Fargo financing offer.
  const theirText = normalizeText("Superior heating and cooling services in CT. Special Financing available. 681 Ratings & Reviews.");
  const g = gateProse([
    "Wells Fargo Home Projects credit card financing banner",
    "Trane authorized dealer certification badge",
    "The site is bright and open with a lot of white space",
    "681 Ratings & Reviews shown in the header",
  ], theirText);

  assert.deepEqual(g.verified, [
    "The site is bright and open with a lot of white space",
    "681 Ratings & Reviews shown in the header",
  ]);
  assert.equal(g.unverified.length, 2);
  assert.ok(g.unverified[0].notFoundInPageText.includes("Wells"));
  assert.ok(g.unverified[1].notFoundInPageText.includes("Trane"));
});

test("significantTokens picks names and numbers, not grammar", () => {
  const t = significantTokens("The complete absence of the Wells Fargo offer, 4.7 stars, and NATE certification");
  assert.ok(t.includes("Wells") && t.includes("Fargo") && t.includes("NATE") && t.includes("4.7"));
  assert.ok(!t.includes("The") && !t.includes("complete"));
});

test("a sentence-opening design word is not mistaken for a brand", () => {
  // All measured on the first real batch. The left column used to quarantine
  // every one of these, burying the four that mattered.
  for (const line of [
    "Dark purple background throughout creating a moody aesthetic",
    "Monospace technical annotations throughout",
    "Photo of the company service van parked at their building",
    "Text stating 'coverage published, not estimated by radius'",
    "Three prominent pill-shaped service buttons with checkmarks",
  ]) assert.deepEqual(significantTokens(line), [], `should be all design vocabulary: ${line}`);
});

test("a brand still counts when it opens the sentence", () => {
  assert.ok(significantTokens("Google reviews badge with visual stars").includes("Google"));
  assert.ok(significantTokens("Wells Fargo Home Projects financing banner").includes("Wells"));
  assert.ok(significantTokens("Trane manufacturer logo above the nav").includes("Trane"));
  assert.ok(significantTokens("BBB Rated A Trusted seal").includes("BBB"));
});

test("a claim only OUR mirror makes is a fabrication, not an unreadable badge", () => {
  // The real one: monolithtattoocompany.com's whole page carries no tattoo
  // price. Our mirror advertises a $150 deposit under their logo. That is not
  // a misread JPEG, and filing it as one buries it.
  const theirEv = ev("Tattooing Nashville since 2013. We are appointment based.");
  const ourEv = ev("Custom tattoos. $150 deposit. $220/hr rate.");
  const { kept, refused } = enforceTruthLaw({
    distinctive: [{ kind: "price", label: "Deposit amount", quotedText: "$150", isClaim: true, where: "theirs" }],
  }, { theirEv, ourEv, images: IMAGES });
  assert.equal(kept.length, 0);
  assert.equal(refused[0].reason, "claim_only_on_our_mirror");
  assert.match(refused[0].detail, /a claim they never made/);
});

test("the uncorroborated scan finds our claims without any model at all", () => {
  const found = scanUncorroboratedClaims(
    "Custom tattoos. $150 DEPOSIT $250 MINIMUM $220/hr RATE. 4.9 stars across 242 reviews. Licensed #44219. Since 2013.",
    "Tattooing Nashville since 2013. We are appointment based but always take walk-in tattoos.",
  );
  const texts = found.map((f) => f.text.toLowerCase());
  assert.ok(texts.some((t) => t.includes("$150")), "the deposit is ours alone");
  assert.ok(texts.some((t) => t.includes("$220/hr")), "the hourly rate is ours alone");
  assert.ok(texts.some((t) => t.includes("242 reviews")), "the review count is ours alone");
  assert.ok(!texts.some((t) => t === "since 2013"), "what they DO say is corroborated and not flagged");
});

test("rankTally reports shares that sum to one", () => {
  const r = rankTally({ "#fff": 30, "#000": 10, "": 999 });
  assert.equal(r.length, 2);
  assert.equal(r[0].hex, "#fff");
  assert.equal(Math.round((r[0].share + r[1].share) * 100) / 100, 1);
});
