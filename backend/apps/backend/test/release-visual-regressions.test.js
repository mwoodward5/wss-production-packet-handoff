"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyPageErrors } = require("../lib/mirror-engine/verify");
const { buildFavicons } = require("../lib/mirror-engine/favicon");

const engineSource = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
const acceptanceSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "team-a-five-site-acceptance.js"), "utf8");

test("mobile fold keeps a verified headline independent of donor markup and recovers a discarded hero", () => {
  assert.match(engineSource, /const mobileLine =/);
  assert.match(engineSource, /h1::after \{ content: "\$\{mobileLineCss\}"/);
  assert.match(engineSource, /h1::after \{[^`]*color: inherit !important;[^`]*-webkit-text-fill-color: currentColor !important;/,
    "the generated one-line headline must inherit the h1 ink already proven against the cinematic wash");
  assert.doesNotMatch(engineSource, /h1::after \{[^`]*color: var\(--wss-slab-ink/,
    "the light theme's dark global slab ink must not override the hero-wash ink");
  assert.match(engineSource, /id=\"wss-mobile-hero-recovery\"/);
  assert.match(engineSource, /visible\(hero\.querySelector\(\"h1\"\)\)/);
  assert.match(engineSource, /setTimeout\(recover,900\)/);
  assert.match(engineSource, /data-wss-mobile-hero-recovered/);
});

test("HVAC's transparent hero call reuses proven wash ink at every width without changing filled donors", () => {
  const marker = "wss HVAC outline hero-call";
  const markerAt = engineSource.indexOf(marker);
  const mobileFoldAt = engineSource.indexOf("// 9a-quater. THE MOBILE FOLD");
  assert.ok(markerAt > engineSource.indexOf("const ink = heroTextCss"),
    "the call rule must reuse heroTextCss's proven headline ink");
  assert.ok(markerAt < mobileFoldAt,
    "the HVAC call is unreadable on desktop too, so its repair must sit outside the mobile media block");

  const scopeAt = engineSource.lastIndexOf('if (donorOut.name === "hvac-premier")', markerAt);
  const scope = engineSource.slice(scopeAt, engineSource.indexOf("heroWash = {", markerAt));
  assert.ok(scopeAt >= 0, "the transparent-call repair must be explicitly HVAC-only");
  assert.match(scope, /\[data-cta="hero-call"\] \{/);
  assert.match(scope, /color: \$\{ink\.headline\} !important;/,
    "call text must use the same white ink whose scrim contrast was proven");
  assert.match(scope, /border-color: color-mix\(in srgb, \$\{ink\.headline\} 40%, transparent\) !important;/);
  assert.doesNotMatch(scope, /electrical-livewire/,
    "electrical's pale filled hero call must retain its own dark ink");
  assert.equal((engineSource.match(/\[data-cta="hero-call"\] \{/g) || []).length, 1,
    "no fleet-wide call-text override may escape the HVAC scope");
});


test("mobile sticky controls and the measured HVAC marquee stay bounded under fallback fonts", () => {
  assert.match(engineSource, /wss-mobile-dock-font-fallback/);
  assert.match(engineSource, /\[data-cta="dock-call"\], \[data-cta="dock-quote"\][\s\S]*?min-width: 0 !important;[\s\S]*?overflow: hidden !important/);
  assert.match(engineSource, /text-overflow: ellipsis !important/);
  assert.match(engineSource, /font-size: clamp\(12px, 3\.35vw, 15px\) !important/);
  assert.match(engineSource, /if \(donorOut\.name === "hvac-premier"\)/);
  assert.match(engineSource, /html, body \{ box-sizing: border-box !important; max-width: 100% !important; overflow-x: clip !important; \}/);
  assert.match(engineSource, /\.animate-marquee \{ animation: none !important; transform: none !important; width: 100% !important;/);
  assert.doesNotMatch(engineSource, /body \[aria-hidden="true"\]\[class\*="-right-"\]/);
  assert.match(engineSource, /bottom:calc\(86px \+ env\(safe-area-inset-bottom\)\)!important/);
});

test("five-site mobile acceptance forces webfont fallback and waits for settled first paint", () => {
  assert.match(acceptanceSource, /const fontFallbackForced = kind === "mobile"/);
  assert.match(acceptanceSource, /page\.route\(\/\^https:/);
  assert.match(acceptanceSource, /waitForTimeout\(1800\)/);
  assert.match(acceptanceSource, /const horizontalScrollPx =/);
  assert.match(acceptanceSource, /const overflowNodes =/);
});

test("mobile fold hides side media only when a verified hero wash exists", () => {
  assert.match(engineSource, /if \(heroWash\.applied\) \{[\s\S]*div:not\(:has\(h1\)\)/);
});

test("React 418 recovers only after a meaningful interactive DOM exists", () => {
  const error = "Error: Minified React error #418; visit react.dev/errors/418";
  const recovered = classifyPageErrors([error], { bodyChars: 500, rootChildren: 3, h1Visible: true, interactiveCount: 4 });
  assert.deepEqual(recovered.fatal, []);
  assert.deepEqual(recovered.recovered, [error]);
  const blank = classifyPageErrors([error], { bodyChars: 20, rootChildren: 0, h1Visible: false, interactiveCount: 0 });
  assert.deepEqual(blank.fatal, [error]);
  assert.deepEqual(blank.recovered, []);
});

test("generated client icons include the runtime favicon.png compatibility path", () => {
  const built = buildFavicons({ businessName: "Release Proof", accent: "#1677B8", primary: "#0D2B45" });
  assert.ok(Buffer.isBuffer(built.files["favicon.png"]));
  assert.deepEqual(built.files["favicon.png"], built.files["icon-192.png"]);
});
