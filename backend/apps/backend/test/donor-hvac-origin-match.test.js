"use strict";
// test/donor-hvac-origin-match.test.js
//
// THE ORIGIN-MATCH PIN (2026-09-04). The hvac-premier donor now carries the
// premier field ledger — the FILE/VOLUME side rails, the corner-bracket
// field frame with REEL/FIELD chips, the SERVICE WINDOW / DISPATCH overlay
// cards, the comfort temperature ticker and the free-quotes chip row —
// ported from the owner's Texan's Trust HVAC design. This suite pins the
// biggest ported element (the hero field frame + its comfort ticker) at the
// byte and geometry level so the port cannot silently regress:
//
//   1. BYTES — the comfort ticker's data contract ships EXACTLY, with null
//      slots (truth law: the ticker renders no invented temperature), and
//      the donor tree introduces no unmapped engine token.
//   2. GEOMETRY — the frame anatomy is wired the way the origin design
//      draws it: .hero-visual is a DIRECT wrapper of the poster img (the
//      engine's landscape-tile pass and its tests key on that adjacency),
//      the corner brackets live on .hero-field (the visual clips its own
//      paint), and the re-asserted display scale rides the Fraunces token.
//   3. FONTS — the self-hosted premier faces ship real woff2 bytes and the
//      stylesheet references exactly those paths.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONOR_DIR = path.join(BACKEND, "donors-clean", "hvac-premier");

const { loadDonor } = require("../lib/mirror-engine/donor");
const { unknownTokensIn } = require("../lib/mirror-engine/tokens");

const donorHtml = () => fs.readFileSync(path.join(DONOR_DIR, "index.html"), "utf8");
const donorCss = () => fs.readFileSync(path.join(DONOR_DIR, "assets", "style.css"), "utf8");

const COMFORT_SLOT =
  '<script type="application/json" data-comfort-data>{"outside":null,"inside":null}</script>';

test("ORIGIN-MATCH bytes: the comfort ticker ships its data contract with null slots — no invented temperature", () => {
  const html = donorHtml();
  assert.ok(html.includes(COMFORT_SLOT),
    "the comfort ticker's JSON slot must ship byte-exact, both readings null");
  // The field additions carry no degree readings at all — the only degree
  // claims allowed on the page are the climate-guarded headline claims.
  const heroField = /<div class="hero-field reveal">[\s\S]*?<div class="stat-strip"/.exec(html);
  assert.ok(heroField, "the hero field block is present");
  assert.doesNotMatch(heroField[0], /\d+\s*(?:°|&#176;|&deg;)/i,
    "no temperature numeral may ship in the field frame (truth law)");
  // The readouts render only from data: display none until the runtime
  // proves a slot was filled.
  assert.match(donorCss(), /\.comfort-value \{[^}]*display: none/s,
    "the empty-ticker readouts must be hidden by default");
  assert.match(donorHtml(), /values\.outside|data-comfort-outside/,
    "the runtime wires the outside slot");
});

test("ORIGIN-MATCH bytes: the field additions introduce no unmapped engine token", () => {
  const files = loadDonor(DONOR_DIR).files;
  const offenders = [];
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(html|css|js|json|svg)$/.test(rel)) continue;
    for (const token of unknownTokensIn(buf.toString("utf8"))) offenders.push(`${rel}:{{${token}}}`);
  }
  assert.deepEqual(offenders, [], "every {{TOKEN}} in the donor must be engine-mapped");
});

test("ORIGIN-MATCH geometry: the field frame is wired the way the origin design draws it", () => {
  const html = donorHtml();
  const css = donorCss();
  // .hero-visual is the DIRECT wrapper of the poster img — the engine's
  // landscape-tile pass matches `class="hero-visual" … ><img` adjacency.
  assert.match(html, /<div class="hero-visual">\s*<img\s+src="assets\/hero-poster\.svg"/,
    "the poster img must sit directly inside .hero-visual");
  // The chips are SIBLINGS over the visual (inside them they would clip and
  // they would break the tile pass's adjacency).
  assert.ok(/<div class="hero-field reveal">\s*<div class="hero-visual">/.test(html),
    ".hero-field wraps the visual");
  assert.match(html, /<span class="frame-chip frame-chip-live"[^>]*>/, "the REEL chip ships");
  assert.match(html, /<span class="frame-chip frame-chip-field"[^>]*>/, "the FIELD chip ships");
  // The corner brackets paint on .hero-field — .hero-visual clips its own
  // paint (radius + cover img), so brackets drawn there never show.
  assert.match(css, /\.hero-field::before,\s*\.hero-field::after \{[^}]*border: 2px solid var\(--wss-band-accent\)/s,
    "the corner brackets ride .hero-field in the band accent");
  // Overlay cards + chip row + rails ship.
  assert.match(html, /field-card field-card-window/, "the SERVICE WINDOW card ships");
  assert.match(html, /field-card field-card-dispatch/, "the DISPATCH card ships");
  assert.match(html, /field-rail field-rail-start/, "the FILE side rail ships");
  assert.match(html, /<li>Free quotes<\/li>\s*<li>No upsell pressure<\/li>/, "the free-quotes chip row ships");
  // The re-asserted display scale is pinned to the Fraunces token so the
  // engine's appended type-scale variant can never compress the hero.
  assert.match(css, /\.hero \.hero-safe h1 \{[^}]*font-family: var\(--wss-font-display\) !important;/s,
    "the hero display scale re-assertion ships");
  // The navy field band rides the token family the mirror theme never sets.
  assert.match(css, /--wss-band: #0e1a2b;/, "the band token ships in the donor defaults");
});

test("ORIGIN-MATCH fonts: the premier faces ship as real woff2 bytes at pinned paths", () => {
  const faces = [
    ["fonts/fraunces-latin-wght.woff2", "font-family: \"Fraunces\"", "font-style: normal"],
    ["fonts/fraunces-italic-latin-wght.woff2", "font-family: \"Fraunces\"", "font-style: italic"],
    ["fonts/inter-latin-wght.woff2", "font-family: \"Inter\"", "font-style: normal"],
    ["fonts/jetbrains-mono-latin-wght.woff2", "font-family: \"JetBrains Mono\"", "font-style: normal"],
  ];
  const css = donorCss();
  for (const [rel, family, style] of faces) {
    const buf = fs.readFileSync(path.join(DONOR_DIR, "assets", rel));
    assert.ok(buf.length > 10000, `${rel} ships real bytes`);
    assert.equal(buf.slice(0, 4).toString("ascii"), "wOF2", `${rel} is woff2`);
    const faceRe = new RegExp(
      `@font-face \\{[^}]*${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^}]*${style}[^}]*src: url\\("${rel}"\\)`,
      "s",
    );
    assert.match(css, faceRe, `${rel} is declared for ${family} (${style})`);
  }
});
