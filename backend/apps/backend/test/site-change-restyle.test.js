"use strict";
// test/site-change-restyle.test.js — the restyle_site verb.
//
// "Change the colour of my whole site" was the most common request in the
// owner's queue with NO verb shaped like it: style_override's selector set is
// deliberately closed to the element catalog, and :root is not in it. These
// tests pin the whole-site recolour at the three layers that make it safe —
// the classifier that must route the sentence here, the token whitelist that
// reads the site's own palette rather than a typed vocabulary, and the
// rendered-check/rebuild contracts the rest of the system already enforces.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const P = require("../lib/site-change-plan");
const { classifyRequest, EXECUTOR_VERBS } = require("../lib/riley-capabilities");
const { declaredIntents } = require("../lib/edit-verify");

const SRC = fs.readFileSync(path.join(__dirname, "..", "lib", "site-change-plan.js"), "utf8");

// A compiled mirror's palette, in the two formats the fleet actually ships:
// Tailwind HSL triples on :root in the bundle, hex in a donor's inline styles.
const TRIPLE_MIRROR = `
:root{--background:210 20% 99%;--foreground:215 25% 27%;--primary:215 60% 16%;
--primary-foreground:0 0% 100%;--accent:36 97% 62%;--accent-ink:0 0% 100%}
`;
const HEX_MIRROR = `<style>:root{--primary:#1e3a8a;--accent:#22d3ee;--accent-ink:#ffffff}</style>`;

// ---------------------------------------------------------------------------
// THE CLASSIFIER — whole-site colour words land HERE, not on a one-element verb
// ---------------------------------------------------------------------------
test("classifier: whole-site colour requests name restyle_site", () => {
  const cases = [
    "change the color of my whole site to green",
    "can you change my whole website's colour scheme to navy",
    "repaint my entire site in blue",
    "recolor everything on the site",
    "change my color scheme",
    "I want a rebrand, make the site purple",
  ];
  for (const words of cases) {
    const hit = classifyRequest(words);
    assert.equal(hit.op, "restyle_site", `"${words}" -> ${JSON.stringify(hit)}`);
    assert.equal(hit.supported, true, `"${words}" must be a quick-edit yes`);
    assert.equal(hit.tier, "quick");
  }
});

test("classifier: one-element colour requests stay style_override", () => {
  const cases = [
    "make the phone number in the header dark green",
    "make the main headline orange",
    "make the logo bigger",
    "hide the gallery section",
  ];
  for (const words of cases) {
    const hit = classifyRequest(words);
    assert.equal(hit.op, "style_override", `"${words}" -> ${JSON.stringify(hit)}`);
  }
});

test("classifier: restyle_site rides the style family, so edit-timing buckets it with the other paint work", () => {
  const verb = EXECUTOR_VERBS.find((v) => v.op === "restyle_site");
  assert.ok(verb, "restyle_site must be declared to Riley");
  assert.equal(verb.family, "style");
});

// ---------------------------------------------------------------------------
// THE CAPABILITY FLOOR AND THE EXECUTOR CANNOT DRIFT (second opinion here; the
// enforcing test lives in riley-eyes.test.js)
// ---------------------------------------------------------------------------
test("restyle_site is both declared to Riley and executed by the apply loop", () => {
  const applyLoop = SRC.slice(SRC.indexOf("Phase 3 — the deterministic apply"));
  assert.match(applyLoop, /kind === "restyle_site"/, "apply loop must execute the verb");
  assert.ok(EXECUTOR_VERBS.some((v) => v.op === "restyle_site"), "capability floor must declare it");
  // Within the style family the WHOLE-SITE verb is scanned first: "change the
  // colour of my whole site" carries the word "colour", which is a
  // style_override cue, and family scanning takes the first verb that matches.
  const order = EXECUTOR_VERBS.map((v) => v.op);
  assert.ok(order.indexOf("restyle_site") < order.indexOf("style_override"));
});

// ---------------------------------------------------------------------------
// THE COLOUR — spoken words in, one exact paint out
// ---------------------------------------------------------------------------
test("colour input: hex (3 and 6), spoken names, and refusals", () => {
  assert.equal(P.normalizeRestyleColor("#0f0"), "#00ff00");
  assert.equal(P.normalizeRestyleColor("#16A34A"), "#16a34a");
  assert.equal(P.normalizeRestyleColor("green"), "#16a34a");
  assert.equal(P.normalizeRestyleColor("navy"), "#1e3a8a");
  assert.equal(P.normalizeRestyleColor("  ORANGE "), "#f97316");
  assert.equal(P.normalizeRestyleColor("bright-orange"), null);
  assert.equal(P.normalizeRestyleColor("#12345"), null);
  assert.equal(P.normalizeRestyleColor("css-red"), null);
  assert.equal(P.normalizeRestyleColor(""), null);
  assert.equal(P.normalizeRestyleColor(null), null);
  // A colour word the planner passes through is a DECISION, not a wavelength —
  // the table is fixed so two calls for "green" paint the same green.
  assert.ok(Object.values(P.RESTYLE_NAMED_COLORS).every((h) => /^#[0-9a-f]{6}$/.test(h)));
});

test("luminance: the ink flip is decided on a real number, not a vibe", () => {
  assert.ok(Math.abs(P.relativeLuminance("#ffffff") - 1) < 0.001);
  assert.equal(P.relativeLuminance("#000000"), 0);
  assert.ok(P.relativeLuminance("#facc15") > 0.5, "pale yellow must flip the ink dark");
  assert.ok(P.relativeLuminance("#16a34a") < 0.5, "green keeps white ink");
});

// ---------------------------------------------------------------------------
// THE WHITELIST — the site's own declarations are the vocabulary
// ---------------------------------------------------------------------------
test("token detection: reads the site's own palette, in the site's own format", () => {
  const found = P.detectRestyleTokens(TRIPLE_MIRROR);
  assert.deepEqual(found.palette.map((t) => t.token), ["--accent", "--primary"]);
  assert.ok(found.palette.every((t) => t.format === "triple"), "triple mirror -> triple format");
  assert.deepEqual(found.ink.map((t) => t.token), ["--accent-ink", "--primary-foreground"]);

  const hex = P.detectRestyleTokens(HEX_MIRROR);
  assert.ok(hex.palette.every((t) => t.format === "hex"), "hex mirror -> hex format");
  assert.equal(hex.palette.find((t) => t.token === "--accent").declared, "#22d3ee");
});

test("token detection: a token the site does not declare is not invented, and --ink is not reinterpreted", () => {
  // --brand and --background are absent on purpose; bare --ink (body text on
  // several donors) must NEVER be repainted from an accent colour.
  const found = P.detectRestyleTokens(TRIPLE_MIRROR);
  assert.ok(!found.palette.some((t) => t.token === "--brand"));
  assert.ok(!found.ink.some((t) => t.token === "--ink"));
  // "--accent-ink: …" must not satisfy a probe for "--accent" — the negative
  // lookbehind keeps token prefixes from matching each other.
  const onlyInk = P.detectRestyleTokens(":root{--accent-ink:#111827}");
  assert.ok(!onlyInk.palette.length, JSON.stringify(onlyInk));
  assert.equal(onlyInk.ink.length, 1);
  // A site whose colour is baked into literals has no palette, and the verb
  // must say so rather than half-paint.
  const baked = P.detectRestyleTokens(":root{color:#ff6600}a{color:var(--cta)}");
  assert.ok(!baked.palette.length && !baked.ink.length);
});

test("token detection: searches the compiled bundle too, not just the shell", () => {
  // Measured on the live Rimrock mirror: index.html carries only a fallback
  // reference and the real palette lives in assets/index-*.css.
  const found = P.detectRestyleTokens("index-shell with --wss-a: var(--accent,199 89% 48%)\nassets/index-DPiwUvaU.css: :root{--accent:36 97% 62%}");
  assert.equal(found.palette.length, 1);
  assert.equal(found.palette[0].format, "triple");
});

// ---------------------------------------------------------------------------
// THE BLOCK — one rule, real declarations, honest refusals
// ---------------------------------------------------------------------------
test("restyle: the block recolours every declared token in its declared format", () => {
  const built = P.buildRestyleCss({ color: "green", cssSources: TRIPLE_MIRROR });
  assert.equal(built.color, "#16a34a");
  // hexToHslTriple("#16a34a") — the token stays an HSL triple because that is
  // what this mirror declared, and hsl(var(--accent)) consumes a triple.
  assert.match(built.css, /--accent: 142 76% 36%/);
  assert.match(built.css, /--primary: 142 76% 36%/);
  assert.doesNotMatch(built.css, /--brand:/, "a token the site does not declare is not written");
  assert.match(built.css, /^\:root \{ .+; \}$/, "one complete :root rule");
  // Green is dark enough to keep the site's white ink, and ink that does not
  // move is not restated — the block touches only what the repaint changes.
  assert.doesNotMatch(built.css, /--accent-ink:/);
  assert.doesNotMatch(built.css, /--primary-foreground:/);
  assert.deepEqual(built.tokens, ["--accent", "--primary"]);
  assert.deepEqual(built.notes, []);
});

test("restyle: hex-declared tokens stay hex — the wrong format is a silently unpainted site", () => {
  const built = P.buildRestyleCss({ color: "#0f0", cssSources: HEX_MIRROR });
  assert.match(built.css, /--accent: #00ff00/);
  assert.match(built.css, /--primary: #00ff00/);
  assert.doesNotMatch(built.css, /--accent: 1\d\d /, "never an HSL triple where the site declared hex");
});

test("restyle: a pale accent flips the ink tokens dark, a deep one leaves them alone", () => {
  const pale = P.buildRestyleCss({ color: "#facc15", cssSources: TRIPLE_MIRROR });
  assert.match(pale.css, /--accent-ink: 221 39% 11%/, "pale yellow carries dark ink");
  assert.ok(pale.notes.includes("ink_tokens_flipped_for_contrast"));
  const deep = P.buildRestyleCss({ color: "#1e3a8a", cssSources: TRIPLE_MIRROR });
  assert.doesNotMatch(deep.css, /--accent-ink:/, "a deep accent leaves the site's declared ink untouched");
  assert.deepEqual(deep.notes, [], "no ink decision to record when the ink did not move");
});

test("restyle: a site with no palette gets a spoken refusal, not a half-paint", () => {
  try {
    P.buildRestyleCss({ color: "green", cssSources: ":root{color:#ff6600}" });
    assert.fail("must refuse");
  } catch (err) {
    assert.equal(err.planRefusal, true);
    assert.match(err.say, /can't repaint the whole/);
    assert.doesNotMatch(err.say, /which (section|element|file)|hex code/i, "no homework in the refusal");
  }
});

test("restyle: an unreadable colour is a sentence, not a crash", () => {
  try {
    P.buildRestyleCss({ color: "kind of a blue thing", cssSources: TRIPLE_MIRROR });
    assert.fail("must refuse");
  } catch (err) {
    assert.equal(err.planRefusal, true);
    assert.match(err.say, /couldn't read that as a colour/);
    // The refusal offers a re-supply in the caller's own words — an invitation,
    // never homework (which section/element/file is ours to work out).
    assert.doesNotMatch(err.say, /which (section|element|file|link)/i);
  }
});

// ---------------------------------------------------------------------------
// THE CONTRACTS — rendered verification and rebuild replay ride existing rails
// ---------------------------------------------------------------------------
test("the token block produces intents the rendered check can read off the live page", () => {
  const built = P.buildRestyleCss({ color: "green", cssSources: TRIPLE_MIRROR });
  const intents = declaredIntents([{ selector: ":root", declarations: built.declarations }]);
  assert.ok(intents.length >= 2, "one intent per recoloured token");
  for (const intent of intents) {
    assert.equal(intent.selector, ":root");
    assert.match(intent.property, /^--(accent|primary|primary-foreground|accent-ink)$/);
    assert.ok(intent.value.length > 0);
  }
  // getComputedStyle(:root).getPropertyValue("--accent") returns exactly the
  // string we wrote — the value format the probe compares is our own output.
  const accent = intents.find((i) => i.property === "--accent");
  assert.equal(accent.value, "142 76% 36%");
});

test("rebuilds replay the repaint through the style_override lane, not a second implementation", () => {
  // site-edit-replay.js re-injects style_override CSS verbatim; a restyle
  // recorded as op:"restyle_site" there would be dropped as op_not_replayable
  // and the customer's repaint would vanish on the next rebuild. Pin the
  // branch's replay shape in the executor source.
  const branch = SRC.slice(SRC.indexOf('kind === "restyle_site"'));
  assert.match(branch, /replay: \{ op: "style_override", file: rel, css: built\.css/);
});

test("the planner contract teaches the verb, and keeps one-element colour work on style_override", () => {
  assert.match(SRC, /"op":"restyle_site","color":"#16a34a"/);
  assert.match(SRC, /ONE element's\s+colour is still a style_override/);
});
