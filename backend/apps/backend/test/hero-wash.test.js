"use strict";
// test/hero-wash.test.js — the contrast guarantee, proved rather than eyeballed.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  relativeLuminance, contrastRatio, scrimAlphaFor, pickHeroPhoto, heroWashCss,
  heroTextCss, HERO_HEADLINE_INK, HERO_SUB_INK, AA_NORMAL, MAX_SCRIM,
} = require("../lib/hero-wash");

test("relative luminance matches the WCAG anchors", () => {
  assert.equal(Number(relativeLuminance("#ffffff").toFixed(4)), 1);
  assert.equal(Number(relativeLuminance("#000000").toFixed(4)), 0);
  // sRGB mid grey is ~0.2159, not 0.5 — the whole point of the linearisation.
  assert.ok(Math.abs(relativeLuminance("#808080") - 0.2159) < 0.002);
  assert.equal(relativeLuminance("not a colour"), null);
});

test("white on black is 21:1", () => {
  assert.equal(Number(contrastRatio(1, 0).toFixed(0)), 21);
});

test("the computed scrim holds against the BRIGHTEST possible photograph", () => {
  // A dark hero with white type — the eight dark donors.
  const p = scrimAlphaFor({ scrimHex: "#0b1220", textHex: "#ffffff" });
  assert.equal(p.ok, true);
  assert.equal(p.textIsLight, true);
  // Compose the worst case by hand and check it independently of the helper.
  const Ls = relativeLuminance("#0b1220");
  const worst = p.alpha * Ls + (1 - p.alpha) * 1;      // a pure-white photograph
  assert.ok(contrastRatio(1, worst) >= AA_NORMAL, `worst-case ratio ${contrastRatio(1, worst)}`);
});

test("the computed scrim holds against the DARKEST possible photograph", () => {
  // A light hero with near-black type.
  const p = scrimAlphaFor({ scrimHex: "#f7f7f5", textHex: "#111111" });
  assert.equal(p.ok, true);
  assert.equal(p.textIsLight, false);
  const Ls = relativeLuminance("#f7f7f5");
  const worst = p.alpha * Ls + (1 - p.alpha) * 0;      // a pure-black photograph
  assert.ok(contrastRatio(relativeLuminance("#111111"), worst) >= AA_NORMAL);
});

test("a hero whose own text already fails AA is refused, not patched over", () => {
  // Mid grey text on mid grey: nothing behind it can rescue this, and putting a
  // photograph there would only make it worse while looking like a fix.
  const p = scrimAlphaFor({ scrimHex: "#888888", textHex: "#9a9a9a" });
  assert.equal(p.ok, false);
  const out = heroWashCss({ imageHref: "/assets/hero-wash.jpg", accent: "#c53f34", scrimHex: "#888888", textHex: "#9a9a9a" });
  assert.equal(out.applied, false);
  assert.equal(out.css, "");
});

test("no photograph means no block at all — the donor keeps its gradient", () => {
  const out = heroWashCss({ imageHref: "", accent: "#c53f34" });
  assert.equal(out.applied, false);
  assert.equal(out.reason, "no_photo");
  assert.equal(out.css, "");
});

test("no MEASURED accent means no wash — a tint is never invented", () => {
  const out = heroWashCss({ imageHref: "/assets/hero-wash.jpg", accent: "", scrimHex: "", textHex: "#ffffff" });
  assert.equal(out.applied, false);
  assert.equal(out.reason, "no_measured_accent");
});

test("the emitted block paints the accent over the photograph, and nothing else", () => {
  const out = heroWashCss({
    imageHref: "/assets/hero-wash.jpg", accent: "#c53f34", scrimHex: "#0b1220", textHex: "#ffffff",
  });
  assert.equal(out.applied, true);
  assert.match(out.css, /background-image: linear-gradient\(rgba\(\d+, \d+, \d+, [\d.]+\), rgba\(\d+, \d+, \d+, [\d.]+\)\), url\("\/assets\/hero-wash\.jpg"\)/);
  assert.match(out.css, /background-size: cover/);
  // It ADDS a rule; it never rewrites one.
  assert.ok(!/--accent|!important/.test(out.css));
  assert.ok(out.alpha <= MAX_SCRIM);
  assert.ok(out.worstCaseRatio >= AA_NORMAL);
});

// ---------------------------------------------------------------------------
// THE GUARANTEE MUST BE ABOUT THE COLOUR THAT REACHES THE PAGE
// ---------------------------------------------------------------------------
// This function used to compute the alpha against `scrimHex` and then paint
// `accent`. Rendered on the donor library 2026-08-11, the proof claimed 4.6:1
// while the headline measured 4.14:1 on the roofing donor's /commercial-roofing
// hero and 2.89:1 on the plumbing donor's home hero: #c53f34 is roughly four
// times as bright as the #332c2a the maths had been done against. These pin the
// property that makes that impossible — whatever colour is written into the
// rule is the colour the contrast was proven for.
test("the scrim that is PAINTED is the scrim the contrast was proven against", () => {
  const out = heroWashCss({
    imageHref: "/a.jpg", accent: "#c53f34", scrimHex: "#332c2a", textHex: "#faf8f5",
  });
  assert.equal(out.applied, true);
  const m = /linear-gradient\(rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(out.css);
  assert.ok(m, "the rule must carry an rgba scrim");
  const painted = "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  const alpha = Number(m[4]);
  // Re-derive the worst case from the RENDERED numbers, independently of what
  // the function reported: light text, so the danger is a white photograph.
  const Ls = relativeLuminance(painted);
  const Lt = relativeLuminance("#faf8f5");
  const worst = contrastRatio(Lt, alpha * Ls + (1 - alpha));
  assert.ok(worst >= AA_NORMAL, `painted scrim ${painted} @${alpha} gives ${worst.toFixed(2)}:1`);
  // …and the raw accent could NOT have carried it, which is why the mix exists.
  assert.ok(out.tintMix > 0, "this accent is too light for white text unaided");
});

test("the scrim keeps the client's hue — it is walked toward the donor's hero, not replaced by it", () => {
  const out = heroWashCss({ imageHref: "/a.jpg", accent: "#c53f34", scrimHex: "#332c2a", textHex: "#faf8f5" });
  const m = /rgba\((\d+), (\d+), (\d+),/.exec(out.css);
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Still unmistakably red: the accent's channel ordering survives the mix.
  assert.ok(r > g && r > b, `scrim rgb(${r},${g},${b}) lost the accent's hue`);
  assert.ok(out.tintMix < 1, "a mix of 1 means the client contributed nothing");
});

// A donor whose hero background is exactly on the 4.5:1 boundary used to be
// REFUSED by floating point: plumbing-premier (#0a222d / #fbfdfd) computed
// 4.499999999999999:1. The scrim now carries a small margin so the shipped page
// clears the bar rather than landing on it.
test("a hero that passes by construction is not refused by floating point", () => {
  const out = heroWashCss({ imageHref: "/a.jpg", accent: "#0a222d", scrimHex: "#0a222d", textHex: "#fbfdfd" });
  assert.equal(out.applied, true, out.reason || "");
  assert.ok(out.worstCaseRatio >= AA_NORMAL);
});

test("every page hero is targeted, including a donor that opted in explicitly", () => {
  const out = heroWashCss({ imageHref: "/a.jpg", accent: "#c53f34", scrimHex: "#0b1220", textHex: "#ffffff" });
  assert.match(out.selectors, /\[data-hero-wash\]/);
  assert.match(out.selectors, /\.hero/);
  // Three :is() rules, none escalating specificity: the flat desktop scrim, its
  // reduced-motion sibling, and the @media(max-width:640px) cinematic gradient
  // that lets the client's photo pop on the mobile fold.
  assert.equal((out.css.match(/:is\(/g) || []).length, 3, "desktop scrim, reduced-motion sibling, mobile gradient");
  assert.match(out.css, /@media \(max-width: 640px\)/, "mobile cinematic gradient block present");
});

// ---------------------------------------------------------------------------
// THEIR HERO, NOT A WASHED DONOR HERO (owner, comparing the Texas Best Fence
// mirror against the client's own site: our hero was a pale generic pick where
// theirs is a rich photograph of THEIR work)
// ---------------------------------------------------------------------------
// Tier 1 (current_hero) already picks their site's actual hero image when the
// brief measured one. These pin the tier UNDER it: when no current_hero flag
// landed, the generic pick must still be the client's own-site photography —
// the largest landscape their site publishes — not whatever row happened to
// sort first. Each test is PAIRED with the pre-change rule
// (photos.find(grade === "hero"), bank order) evaluated inline, so the diff
// between old and new behaviour is asserted rather than remembered.
test("the generic hero tier prefers the client's own-site largest landscape over the first-sorted GBP row", () => {
  const bank = {
    photos: [
      // Bank order puts GBP first (bankRank's gallery priority) — the exact
      // shape where the old rule shipped a GBP interior as the hero.
      { url: "https://cdn.gbp/a.jpg", grade: "hero", source: "gbp", width: 1600, height: 900 },
      { url: "https://client.example/site-hero.jpg", grade: "hero", source: "own_site", width: 1920, height: 1080 },
      { url: "https://client.example/smaller.jpg", grade: "hero", source: "own_site", width: 1280, height: 720 },
    ],
  };
  assert.equal(pickHeroPhoto(bank).url, "https://client.example/site-hero.jpg");
  // PAIRED: the washed build's rule — first hero-grade in bank order — picked
  // the GBP row. If this half ever fails, the fixture no longer demonstrates
  // the defect and the test above is passing vacuously.
  const oldPick = bank.photos.find((p) => p.grade === "hero");
  assert.equal(oldPick.url, "https://cdn.gbp/a.jpg", "fixture must keep the GBP row first, as bankRank sorts it");
});

test("own-site landscape beats own-site portrait for the wash — a portrait crops to mush under cover-fit", () => {
  const bank = {
    photos: [
      { url: "https://client.example/portrait.jpg", grade: "hero", source: "own_site", width: 1080, height: 1920 },
      { url: "https://client.example/landscape.jpg", grade: "hero", source: "own_site", width: 1600, height: 900 },
    ],
  };
  assert.equal(pickHeroPhoto(bank).url, "https://client.example/landscape.jpg");
  // …and the flags still outrank the heuristic: their CURRENT hero wins even
  // when a bigger own-site landscape exists (the owner's literal ask).
  const flagged = {
    photos: [
      { url: "https://client.example/bigger.jpg", grade: "hero", source: "own_site", width: 1920, height: 1080 },
      { url: "https://client.example/their-hero.jpg", grade: "hero", source: "own_site", width: 1600, height: 900, current_hero: true },
    ],
  };
  assert.equal(pickHeroPhoto(flagged).url, "https://client.example/their-hero.jpg");
});

test("a bank that recorded no source metadata keeps the old order — provenance is never invented", () => {
  // No `source` on any row: the own-site tier must skip entirely, not guess.
  const bank = {
    photos: [
      { url: "https://a.example/first.jpg", grade: "hero", width: 1600, height: 900 },
      { url: "https://a.example/bigger.jpg", grade: "hero", width: 1920, height: 1080 },
    ],
  };
  assert.equal(pickHeroPhoto(bank).url, "https://a.example/first.jpg");
  // A row claiming own_site but carrying no measured dimensions cannot claim
  // "largest landscape" either — it falls through to bank order.
  const dimless = {
    photos: [
      { url: "https://a.example/first.jpg", grade: "hero" },
      { url: "https://a.example/undimensioned.jpg", grade: "hero", source: "own_site" },
    ],
  };
  assert.equal(pickHeroPhoto(dimless).url, "https://a.example/first.jpg");
  // And the tier can never reach past the ownership gate: a suspected stock
  // caption stays unpickable even wearing source + dimensions.
  const suspect = {
    photos: [
      { url: "https://a.example/sus.jpg", grade: "hero", source: "own_site", width: 1920, height: 1080, stock_caption_suspect: true },
      { url: "https://a.example/clean.jpg", grade: "hero", source: "own_site", width: 1600, height: 900 },
    ],
  };
  assert.equal(pickHeroPhoto(suspect).url, "https://a.example/clean.jpg");
});

test("the hero is the client's real photograph or nothing — never a suspected caption", () => {
  const bank = {
    photos: [
      { url: "https://a.com/a.jpg", grade: "hero", stock_caption_suspect: true },
      { url: "https://a.com/b.jpg", grade: "gallery" },
      { url: "https://a.com/c.jpg", grade: "hero" },
    ],
  };
  assert.equal(pickHeroPhoto(bank).url, "https://a.com/c.jpg");
  assert.equal(pickHeroPhoto({ photos: [{ url: "https://a.com/b.jpg", grade: "gallery" }] }), null);
  assert.equal(pickHeroPhoto(null), null);
  // An http photograph never reaches a https mirror.
  assert.equal(pickHeroPhoto({ photos: [{ url: "http://a.com/c.jpg", grade: "hero" }] }), null);
});

// ---------------------------------------------------------------------------
// THE ENGINE APPLIES THIS ONLY WHERE A RENDER PROVED IT
// ---------------------------------------------------------------------------
// DEFAULT_HERO_SELECTORS is the union of the class conventions in donors-clean.
// Rendered against the library on 2026-08-11 it matched ZERO elements on four
// of seven donors — the compiled Tailwind builds name their hero nothing at
// all — and a selector that matches nothing emits exactly the same `applied`
// as one that works. So engine.js gates the whole feature on a per-donor
// `hero_wash` block, and these tests hold that gate and the recorded values to
// what was actually measured.
const fs = require("node:fs");
const path = require("node:path");
const DONORS = path.join(__dirname, "..", "donors-clean");

test("engine.js applies the wash only from a donor's measured hero_wash block", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
  assert.match(src, /donorOut\.manifest && donorOut\.manifest\.hero_wash/);
  // …and an unmeasured donor is REFUSED BY NAME rather than silently skipped.
  assert.match(src, /donor_hero_unmeasured/);
  assert.match(src, /hero_wash: \{/);
  assert.match(src, /photo_sha: heroWash\.photo_sha \|\| null/,
    "signed release evidence must bind the exact fetched hero bytes");
  assert.match(src, /photo_url: heroWash\.photo_url \|\| null/,
    "signed release evidence must bind the exact verified hero origin");
});

// The wash was switched on library-wide on 2026-08-13, after the engine learned
// to derive the scrim from the THEME pass's slab/slabInk rather than from
// constants sampled off the un-themed donor. It has since SHRUNK, deliberately:
// the verbatim-port campaign (2026-08-16/17) replaced clean-room approximations
// with the real designs, and a verbatim port owns its hero pixels outright — a
// second shared scrim over a design's own six-layer hero is the flattening that
// was removed from landscaping-evergreen when Greenfront shipped. So the block
// is now carried by the donors whose hero the engine really does paint, and the
// donors that dropped it must say so by name (the exemption test below).
//
// The recorded background/text_color are the raw donor hero, used ONLY when the
// theme pass does not apply. This gate requires that any donor which opts in has
// said what a render proved, and that the two colours it named still clear AA
// for the text they name.
test("every recorded hero_wash block still clears AA for the text it names", () => {
  const donors = fs.readdirSync(DONORS).filter((d) => fs.existsSync(path.join(DONORS, d, "BOILERPLATE.json")));
  let measured = 0;
  for (const donor of donors) {
    const man = JSON.parse(fs.readFileSync(path.join(DONORS, donor, "BOILERPLATE.json"), "utf8"));
    const spec = man.hero_wash;
    if (!spec) continue;
    measured++;
    assert.ok(spec.selector, `${donor}: hero_wash needs a selector`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(spec.background || ""), `${donor}: hero_wash.background must be a measured hex`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(spec.text_color || ""), `${donor}: hero_wash.text_color must be a measured hex`);
    // pages_verified is the honest scope of the claim. A non-empty list names
    // the pages a render proved the wash PAINTS. An empty list is allowed ONLY
    // where the render found the hero is a full-bleed <img> that covers the
    // wash on every page (hvac-brandforge today) — a checked-and-explained
    // empty. A silent "enabled it and looked at nothing" is still forbidden:
    // the verified note must say the hero is image-covered.
    assert.ok(Array.isArray(spec.pages_verified), `${donor}: hero_wash.pages_verified must be an array`);
    if (!spec.pages_verified.length) {
      assert.match(String(spec.verified || ""), /IMG|image[- ]?covered|covers the wash|full-bleed/i,
        `${donor}: an empty pages_verified must be explained in verified (the hero is a full-bleed image that covers the wash)`);
    }
    assert.ok(String(spec.verified || "").length > 20, `${donor}: hero_wash.verified must say how`);
    // The library must still accept these numbers. If a donor's hero is
    // re-skinned and its text goes dark, this fails here rather than on a
    // customer's page.
    const out = heroWashCss({
      imageHref: "/assets/hero-wash.jpg", accent: spec.background,
      scrimHex: spec.background, textHex: spec.text_color, selectors: [spec.selector],
    });
    assert.equal(out.applied, true, `${donor}: ${out.reason}`);
    assert.ok(out.worstCaseRatio >= AA_NORMAL, `${donor}: ${out.worstCaseRatio}:1`);
  }
  // A donor that opts in without saying what a render proved is forbidden —
  // checked above, per donor. This floor is the COVERAGE ratchet: it is the
  // count that actually ships today (5 of 11 on 2026-08-19, the rest being
  // verbatim ports that own their hero pixels). Dropping a donor's wash without
  // moving it into the verbatim-port exemption below fails here, so the feature
  // cannot quietly decay to zero. Raise this number when a donor opts back in;
  // never lower it to make a red test green.
  assert.ok(measured >= 5, `only ${measured} donors carry a hero_wash block; the library should not decay below the shipped coverage`);
});

// ---------------------------------------------------------------------------
// THE CINEMATIC DARK SCRIM (owner, on the live Family Heating hero: the video is
// "buried under a flat blue")
// ---------------------------------------------------------------------------
// heroWashCss walks its scrim from the colour it is GIVEN toward the dark anchor
// and STOPS the instant white text passes. Handed the raw brand accent it stops
// at step 0 — painting the accent (#005DAC) at ~0.92 alpha: the flat blue smother
// the owner saw. engine.darkenForScrim fixes it UPSTREAM of the walk, handing the
// wash a base that is already near-black. These prove the painted scrim is dark
// (the video shows through) while white text still clears AA — by calculation off
// the RENDERED rgba, not the function's own report.
const { darkenForScrim } = require("../lib/mirror-engine/engine");

test("darkenForScrim makes a near-black base, keeping a hint of the client hue", () => {
  const dark = darkenForScrim("#005DAC");       // Family Heating brand blue
  assert.ok(relativeLuminance(dark) < 0.03, `${dark} should be near-black, got L=${relativeLuminance(dark)}`);
  const c = /^#(..)(..)(..)$/.exec(dark).slice(1).map((h) => parseInt(h, 16));
  assert.ok(c[2] > c[0], `a hint of the blue survives: b(${c[2]}) should exceed r(${c[0]})`);
  // Garbage / empty accent collapses to the pure dark anchor, never white.
  assert.equal(darkenForScrim(""), "#0b1220");
  assert.equal(darkenForScrim("not a colour"), "#0b1220");
});

test("the painted hero scrim is DARK (video shows through) yet white text still clears AA", () => {
  for (const accent of ["#005DAC", "#C53F34", "#1B7D9F", "#FFC107"]) {
    const out = heroWashCss({
      imageHref: "/assets/hero-wash.jpg",
      accent: darkenForScrim(accent),
      scrimHex: "#0b1220",
      textHex: "#ffffff",
      selectors: [".hero"],
    });
    assert.equal(out.applied, true, `${accent}: ${out.reason}`);
    const m = /linear-gradient\(rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(out.css);
    assert.ok(m, `${accent}: no rgba scrim painted`);
    const painted = "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
    const alpha = Number(m[4]);
    // LOW luminance is the whole point — the client's video reads through it.
    assert.ok(relativeLuminance(painted) < 0.05, `${accent}: scrim ${painted} is not dark (L=${relativeLuminance(painted)})`);
    // AA re-derived from the RENDERED numbers against a pure-white photograph.
    const worst = contrastRatio(1, alpha * relativeLuminance(painted) + (1 - alpha));
    assert.ok(worst >= AA_NORMAL, `${accent}: painted ${painted}@${alpha} gives ${worst.toFixed(2)}:1`);
  }
});

test("REGRESSION: the raw accent alone paints a bright smother — darkening it is what fixes the hero", () => {
  // The exact defect: heroWashCss handed the raw brand blue stops at step 0 and
  // paints that blue. Its luminance dwarfs the darkened base's, and it is that
  // brightness at ~0.9 alpha the owner saw over the video.
  const raw = heroWashCss({ imageHref: "/a.jpg", accent: "#005DAC", scrimHex: "#0b1220", textHex: "#ffffff", selectors: [".hero"] });
  const dark = heroWashCss({ imageHref: "/a.jpg", accent: darkenForScrim("#005DAC"), scrimHex: "#0b1220", textHex: "#ffffff", selectors: [".hero"] });
  const lumOf = (out) => {
    const m = /rgba\((\d+), (\d+), (\d+),/.exec(out.css);
    return relativeLuminance("#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join(""));
  };
  assert.ok(lumOf(raw) > lumOf(dark) * 4, `raw scrim L=${lumOf(raw)} should dwarf darkened L=${lumOf(dark)}`);
});

// ---------------------------------------------------------------------------
// EVERY WORD ON THE SCRIM IS PROVEN, NOT JUST THE HEADLINE (owner, on the HVAC
// rebuild: accent-coloured headline, near-transparent reviews line)
// ---------------------------------------------------------------------------
// Two shipped failure modes, each paired here with the treatment that fixes it:
//   1. The scrim alpha was proven for pure white while the sub-line and the
//      reviews line paint one step dimmer — so the proof did not cover the
//      dimmest ink actually on the page.
//   2. The headline was forced white with `color` alone, which a gradient-text
//      donor (-webkit-text-fill-color: transparent — fencing-sterling ships
//      exactly this) ignores, and which leaves opacity-tinted lines transparent.

test("the scrim alpha is proven for the DIMMEST ink on it — the white-only proof left the reviews line under AA", () => {
  const base = { imageHref: "/a.jpg", accent: darkenForScrim("#005DAC"), scrimHex: "#0b1220", textHex: "#ffffff", selectors: [".hero"] };
  const out = heroWashCss({ ...base, inkFloorHex: HERO_SUB_INK });
  assert.equal(out.applied, true, out.reason || "");
  // Re-derive both guarantees from the RENDERED rgba, independently of the
  // function's own report: worst case is a pure-white photograph under the
  // painted scrim.
  const m = /linear-gradient\(rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(out.css);
  assert.ok(m, "no rgba scrim painted");
  const painted = "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  const alpha = Number(m[4]);
  const worst = alpha * relativeLuminance(painted) + (1 - alpha);
  assert.ok(contrastRatio(relativeLuminance(HERO_SUB_INK), worst) >= AA_NORMAL,
    `sub/reviews ink must clear AA: ${contrastRatio(relativeLuminance(HERO_SUB_INK), worst).toFixed(2)}:1`);
  assert.ok(contrastRatio(relativeLuminance(HERO_HEADLINE_INK), worst) >= AA_NORMAL, "the white headline passes a fortiori");
  assert.ok(alpha <= MAX_SCRIM, "the stricter proof still fits under the scrim ceiling");
  assert.ok(out.inkFloorRatio >= AA_NORMAL, "the report carries the sub-ink guarantee");
  // PAIRED: the washed build's call shape — white-only proof — ships an alpha
  // under which the very same sub ink FAILS AA in the worst case. That failing
  // number IS the near-transparent reviews line the owner measured; if this
  // half ever passes AA the fixture no longer demonstrates the defect.
  const old = heroWashCss(base);
  const mo = /linear-gradient\(rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(old.css);
  const oldPainted = "#" + [mo[1], mo[2], mo[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  const oldAlpha = Number(mo[4]);
  const oldWorst = oldAlpha * relativeLuminance(oldPainted) + (1 - oldAlpha);
  assert.ok(contrastRatio(relativeLuminance(HERO_SUB_INK), oldWorst) < AA_NORMAL,
    "the white-only proof must demonstrably NOT cover the dimmer ink");
});

test("the hero ink kills gradient-text transparency and opacity dimming — the color-only rule could not", () => {
  const ink = heroTextCss({ selector: ".hero" });
  assert.equal(ink.applied, true);
  // The headline block: solid ink on BOTH channels a donor can paint text
  // through, plus the opacity clamp.
  assert.match(ink.css, new RegExp(`:is\\(\\.hero\\) h1, :is\\(\\.hero\\) h1 \\* \\{[^}]*color: ${HERO_HEADLINE_INK} !important`));
  assert.match(ink.css, new RegExp(`-webkit-text-fill-color: ${HERO_HEADLINE_INK} !important`));
  assert.match(ink.css, /opacity: 1 !important/);
  // The sub-line/reviews rule: the ADJACENT paragraph only — a stat card or
  // CTA elsewhere in the hero keeps its own ink — in the exact ink the scrim
  // alpha is proven against.
  assert.match(ink.css, new RegExp(`:is\\(\\.hero\\) h1 \\+ p, :is\\(\\.hero\\) h1 \\+ p \\* \\{[^}]*color: ${HERO_SUB_INK} !important`));
  // PAIRED: the washed build's rule, verbatim from the old engine.js. Against
  // a gradient-text donor it is inert (-webkit-text-fill-color: transparent
  // outranks color) and it clamps no opacity — both defects the owner saw.
  const washed = ":is(.hero) h1, :is(.hero) h1 * { color: #ffffff !important; }";
  assert.doesNotMatch(washed, /text-fill-color/, "the old rule never touched the channel gradient text paints through");
  assert.doesNotMatch(washed, /opacity/, "the old rule left 60%-tinted lines transparent");
  // No selector, no block — the ink is donor-gated exactly like the wash.
  assert.equal(heroTextCss({ selector: "" }).applied, false);
});

test("engine.js darkens the scrim base BEFORE the wash walk, and passes it as the accent", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
  assert.match(src, /const scrimBase = darkenForScrim\(/);
  assert.match(src, /accent: scrimBase,/);
  // The two halves of "every word on the scrim is proven" are wired: the walk
  // proves the sub ink, and the hero ink is painted from lib/hero-wash.
  assert.match(src, /inkFloorHex: HERO_SUB_INK/);
  // The call passes the light palette's proven band inks too, so heroTextCss
  // restates the pair light-scoped (final QA Class B, 2026-09-04: in light
  // mode the themed pale hero layers paint over the wash, and the forced
  // white pair measured 1.1-1.6:1 on the pale composite).
  assert.match(src, /lightInk: lightSide && lightSide\.slabInk \? lightSide\.slabInk : ""/);
  assert.match(src, /lightSubInk: lightSide && lightSide\.slabMuted \? lightSide\.slabMuted : ""/);
  // …and the old color-only headline rule is gone, not merely duplicated.
  assert.ok(!src.includes("h1 * { color: #ffffff !important; }"), "the color-only headline rule must not survive beside the ink block");
});

// A donor that carries NO hero_wash block is invisible to the gate above — the
// loop simply skips it. That is the hole this test closes. Until 2026-08-17 it
// was closed by naming the two donors that had been switched back ON; the
// verbatim-port campaign then moved donor after donor the other way, and a
// hardcoded ON list is exactly the wrong shape for that. The rule that survives
// is about the REASON, not the roster: the only excuse for having no wash is
// that the donor is a verbatim port whose own design owns the hero pixels, and
// the manifest has to say so in prose a human wrote. An engineer who deletes a
// hero_wash block without writing that down fails here.
//
// (roofing-falcon-clean was the first to move: the verbatim Lovable port
// falcon_roofing_llc_1 ships the design's own bg-gradient-hero-strong scrim plus
// blueprint grid and storm bolts. A second shared wash over that stack is the
// flattening that was removed from landscaping-evergreen when Greenfront
// shipped — "one hero system owns the pixels now".)
test("a donor with no hero_wash is an exempt verbatim port that SAYS its design owns the hero", () => {
  const donors = fs.readdirSync(DONORS).filter((d) => fs.existsSync(path.join(DONORS, d, "BOILERPLATE.json")));
  let exempt = 0;
  for (const donor of donors) {
    const man = JSON.parse(fs.readFileSync(path.join(DONORS, donor, "BOILERPLATE.json"), "utf8"));
    if (man.hero_wash) {
      // A donor that DOES opt in still owes the reason it can: the note carries
      // the theme-pass derivation, which is what made the scrim safe at all.
      assert.match(String(man.hero_wash_note || ""), /theme/i, `${donor}: an opted-in donor's note must keep the theme reason`);
      continue;
    }
    exempt++;
    // 1. The exemption is only available to a verbatim source port.
    const port = String((man.source_project || {}).port_mode || "") + " " + String(man.source || "");
    assert.match(port, /verbatim/i,
      `${donor}: no hero_wash and not a verbatim port — a hero with no scrim and no design of its own is an illegible hero`);
    // 2. …and it has to be CLAIMED, in prose, about this donor's own hero.
    const prose = [
      man.hero_note, man.hero_wash_note, man.verbatim_port_note,
      man.hero_video && man.hero_video.note, man.hero_video && (man.hero_video.ladder || []).join(" "),
    ].filter(Boolean).join("\n");
    assert.match(prose, /hero/i, `${donor}: the exemption must be written down against this donor's hero`);
    assert.match(prose, /owns? (its|their|the)|design's own|the design's|ships verbatim|cinematic layer/i,
      `${donor}: say WHY there is no wash — that this design owns its own hero pixels`);
  }
  // The exemption must stay an exemption. If it ever swallows the whole library
  // the wash is dead code wearing a green suite, and this says so out loud.
  assert.ok(exempt < donors.length,
    "every donor claimed the verbatim-port exemption — the hero wash is no longer applied anywhere");
});
