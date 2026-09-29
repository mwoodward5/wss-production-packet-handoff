"use strict";

// THE BRAND-FRAME CONTRACT. The owner clicked /dashboard straight out of a
// WSS email and could not tell he was still inside the same company's site:
// "keep the branding consistent, familiar, and safe … bring the W logo's
// black/blue/green into the dashboard — a border, banner, or some homage —
// so the customer KNOWS they're still in the same company's dashboard."
// These tests pin that homage on every customer- and operator-facing surface:
// the customer Command Center (wss-ai.com/dashboard, where the outreach
// email's "Open your dashboard" button lands), the WSS Connect app, the
// operator console, and the operator deck. The palette is read from
// packages/wss-brand-system, not restated by hand, so the page and the test
// cannot drift apart.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const brand = require("../../../packages/wss-brand-system");
const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.resolve(ROOT, rel), "utf8");

const dashboard = read("labs-site/dashboard/index.html");
const connect = read("connect/index.html");
const consolePage = read("backend/lib/console-page.js");
const deckModule = require("../lib/dashboard-html");

/** Pull a token's hex straight out of the brand system's own token sheet. */
const tokenHex = (name) => {
  const match = new RegExp(`--wss-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(brand.tokensCss);
  assert.ok(match, `the brand system must define --wss-${name}`);
  return match[1];
};

// The logo's own colors, straight from the brand system tokens: ink blacks,
// the gradient blue-violet of the W stroke, and the green of the dot.
const WSS = {
  inkA: tokenHex("carbon"),
  inkB: tokenHex("void"),
  blue: tokenHex("blue"),
  violet: tokenHex("violet"),
  violetAlt: "#8B5CF6",
  green: tokenHex("green"),
};

test("brand tokens carry the W logo's black, blue, and green", () => {
  assert.equal(WSS.inkA, "#131318");
  assert.equal(WSS.blue, "#4A6CF7");
  assert.equal(WSS.violet, "#7C6CF6");
  assert.equal(WSS.green, "#34D399");
  assert.ok(brand.assets.mark.includes(WSS.blue), "the W stroke is brand blue");
  assert.ok(brand.assets.mark.includes(WSS.green), "the W dot is brand green");
});

test("the customer dashboard opens with the WSS brand bar and inline W mark", () => {
  assert.match(dashboard, /class="wss-brand-bar"/, "the brand banner must exist");
  assert.match(dashboard, /class="wss-brand-shelf"/, "the gradient shelf must exist");

  // The mark is INLINE SVG — the same guarantee the masthead mark already
  // carries: it cannot 404 during a deploy gap.
  assert.match(dashboard, /<svg class="wss-brand-mark"[^>]*aria-label="WSS Labs"/);
  assert.match(dashboard, /id="wssBrandBarG"[\s\S]{0,200}?stop-color="#4A6CF7"/);
  assert.match(dashboard, /stroke="url\(#wssBrandBarG\)"/);
  assert.match(dashboard, /fill="#34D399"/);
  assert.match(dashboard, /fill="#131318"/);
  assert.doesNotMatch(dashboard, /class="wss-brand-mark"[^>]*src=/, "the banner mark must never be a fetched image");

  // The bar sits at the very top of the page, before both the sign-in card
  // and the signed-in app, so EVERY arrival — magic link, PIN, reload —
  // sees it first.
  const barAt = dashboard.indexOf('class="wss-brand-bar"');
  assert.ok(barAt >= 0);
  assert.ok(barAt < dashboard.indexOf('id="login"'), "the banner must precede the sign-in card");
  assert.ok(barAt < dashboard.indexOf('id="dash"'), "the banner must precede the signed-in app");
});

test("the customer dashboard brand bar and shelf use the logo's own colors", () => {
  assert.match(dashboard, new RegExp(`\\.wss-brand-bar\\{background:linear-gradient\\(90deg,${WSS.inkA},${WSS.inkB}\\)`));
  assert.match(dashboard, new RegExp(`\\.wss-brand-shelf\\{height:3px;background:linear-gradient\\(90deg,${WSS.blue} 0%,${WSS.violet} 55%,${WSS.green} 100%\\)`));
  assert.match(dashboard, new RegExp(`color:${WSS.green}`), "the studio tag wears the logo green");
});

test("the customer dashboard names the company in the bar and the footer", () => {
  assert.match(dashboard, /class="wss-brand-word">WSS Labs</);
  assert.match(dashboard, /class="wss-brand-app">Command Center</);
  assert.match(dashboard, /American AI web studio/);
  // Footer homage: the same line the emails' identity carries.
  assert.match(dashboard, /WSS Labs &mdash; American AI web studio &#127482;&#127480;/);
  assert.match(dashboard, /class="wss-footer-shelf"/);
  assert.match(dashboard, /class="wss-footer-brand">WSS Labs &mdash; American AI web studio/);
});

test("the WSS Connect app carries the same brand bar", () => {
  assert.match(connect, /class="wss-brand-bar"/, "Connect must show the same ink bar");
  assert.match(connect, /<svg class="wss-brand-mark"[^>]*aria-label="WSS Labs"/);
  assert.match(connect, /stroke="url\(#wssConnectBarG\)"/);
  assert.match(connect, new RegExp(`\\.wss-brand-shelf \\{ height: 3px; background: linear-gradient\\(90deg, ${WSS.blue} 0%, ${WSS.violet} 55%, ${WSS.green} 100%\\); \\}`));
  assert.match(connect, /American AI web studio/);
});

test("the operator console masthead keeps the same gradient shelf", () => {
  assert.match(consolePage, /border-image:linear-gradient\(90deg,#4A6CF7 0%,#7C6CF6 55%,#34D399 100%\) 1/);
});

test("the operator deck shows the W mark, the shelf, and the studio footer", () => {
  const deck = deckModule.renderOperatorDashboard({});
  assert.match(deck, /class="brandshelf"/, "the deck opens with the gradient shelf");
  assert.match(deck, /aria-label="WSS Labs"/, "the deck carries the W mark");
  assert.match(deck, /stop-color="#4A6CF7"/);
  assert.match(deck, /fill="#34D399"/);
  assert.match(deck, /WSS Labs<\/b> &mdash; American AI web studio &#127482;&#127480;/, "the deck footer carries the studio homage");
  const gate = deckModule.renderTokenGate();
  assert.match(gate, /WSS Labs/, "even the gate names the company");
});
