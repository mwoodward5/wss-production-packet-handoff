"use strict";

// test/boilerplate-template-hygiene.test.js
//
// THE DONOR-TEMPLATE SOURCE LAW (owner, 2026-09-01, on the Comet 10-site
// audit, issue #563): the render layer (fleet-polish/content-inject) patches
// defects per build, but the DONOR TEMPLATES THEMSELVES must be born clean.
// These gates pin the audit's structural items against the template sources
// so a regression cannot re-enter through a rebuilt or newly-ported donor:
//
//   ITEM 8 — HERO JS-GATING. A hero (or any scroll-reveal block) that starts
//     `opacity:0` behind a JS-added class blank-flashes and stays blank when
//     JS fails. Content is visible by default; JS only ENHANCES; any hidden
//     state is scoped under a `.js` root class the page sets first thing.
//   ITEM 1 — HEADER RIGHT-CLUSTER. Nav links + phone CTA compose as a flex
//     row, the phone CTA never wraps mid-number, and the nav collapses below
//     1024px so the cluster never collides.
//   ITEM 9 — STAR TOGGLE. A favorite/star toggle is unlabeled garbage to a
//     screen reader: it must carry `aria-label="Toggle favorite"` and, when a
//     button, `type="button"`.
//   ITEM 5 — TESTIMONIAL OVERFLOW. A card track that stops animating (reduced
//     motion) must become a scroll-snap carousel, never a clipped strip.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");

const TEMPLATE_ROOTS = [
  path.join(BACKEND, "boilerplates"),
  path.join(BACKEND, "boilerplates-source"),
  path.join(BACKEND, "donors-clean"),
];

function walkHtml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(p, out);
    else if (/\.html?$/i.test(entry.name)) out.push(p);
  }
  return out;
}

function donorHtmlFiles() {
  return TEMPLATE_ROOTS.flatMap((root) => (fs.existsSync(root) ? walkHtml(root) : []));
}

const read = (p) => fs.readFileSync(p, "utf8");

// ---------------------------------------------------------------------------
// ITEM 8 — NO JS-GATED REVEAL STATES IN DONOR MARKUP
// ---------------------------------------------------------------------------
test("item 8: no donor template ships an inline opacity:0 scroll-reveal gate", () => {
  const offenders = [];
  for (const file of donorHtmlFiles()) {
    const html = read(file);
    // `height:0px;opacity:0` is an interactive accordion collapse — allowed.
    // Anything else is a JS-animated entrance baked into static markup.
    for (const m of html.matchAll(/style="[^"]*opacity:\s*0(?![.\d])[^"]*"/g)) {
      if (!/height:\s*0/.test(m[0])) offenders.push(`${path.relative(BACKEND, file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `JS-gated opacity:0 inline styles are back in donor markup:\n${offenders.join("\n")}`);
});

test("item 8: the tattoo source hero starts visible — framer-motion never gates it", () => {
  const hero = read(path.join(BACKEND, "boilerplates-source", "tattoo-dark", "src", "components", "Hero.tsx"));
  assert.doesNotMatch(hero, /initial=\{\{\s*opacity:\s*0/, "the hero copy must not mount at opacity 0");
  assert.match(hero, /initial=\{false\}/, "the hero starts from its animate (visible) state");
});

test("item 8: static donors mark the .js root first and scope the hero entrance under it", () => {
  for (const rel of [
    path.join("boilerplates", "plumbing-pressure-lens", "index.html"),
    path.join("donors-clean", "tattoo-aurelia", "index.html"),
    path.join("boilerplates-source", "tattoo-port-staging", "site", "index.html"),
  ]) {
    const html = read(path.join(BACKEND, rel));
    assert.match(html, /document\.documentElement\.classList\.add\(["']js["']\)/, `${rel}: the boot script sets the .js root`);
    assert.match(html, /\.js \.hero-(?:in|enter)/, `${rel}: the hero entrance is scoped to the JS-marked root`);
    assert.match(html, /@keyframes hero-(?:in|enter)/, `${rel}: the entrance keyframes ship`);
  }
});

test("item 8: the plumbing hero copy is NOT a .reveal element — it renders visible by default", () => {
  const html = read(path.join(BACKEND, "boilerplates", "plumbing-pressure-lens", "index.html"));
  assert.match(html, /class="hero-copy hero-in"/);
  assert.doesNotMatch(html, /class="hero-copy[^"]*reveal/);
});

// ---------------------------------------------------------------------------
// ITEM 8 — NO-JS SAFETY FOR COMPILED CSS REVEAL GATES
// ---------------------------------------------------------------------------
test("item 8: donors whose stylesheet gates .reveal content carry the html:not(.js) override and set the root", () => {
  for (const [dir, gates] of [
    ["concrete-elconstruction", [".reveal", ".reveal-d1"]],
    ["hvac-premier", [".reveal"]],
    ["plumbing-premier", [".reveal"]],
    ["realestate-waterline", [".reveal-up", ".reveal-scale", ".reveal-clip"]],
  ]) {
    const donorDir = path.join(BACKEND, "donors-clean", dir);
    const cssFile = fs.readdirSync(path.join(donorDir, "assets")).find((f) => f.endsWith(".css"));
    const css = read(path.join(donorDir, "assets", cssFile));
    assert.match(css, /html:not\(\.js\)/, `${dir}: the no-js safety override ships in ${cssFile}`);
    for (const gate of gates) {
      assert.ok(css.includes(`html:not(.js) ${gate}`), `${dir}: ${gate} is covered by the override`);
    }
    const html = read(path.join(donorDir, "index.html"));
    assert.match(html, /document\.documentElement\.classList\.add\(["']js["']\)/, `${dir}: index.html marks the root first thing`);
  }
});

// ---------------------------------------------------------------------------
// ITEM 9 — STAR / FAVORITE TOGGLES ARE LABELED
// ---------------------------------------------------------------------------
test("item 9: every star/favorite toggle in donor markup is labeled and type=button", () => {
  const offenders = [];
  for (const file of donorHtmlFiles()) {
    const html = read(file);
    // A star glyph or "favorite" wording on an interactive element is the
    // toggle pattern from the audit. Decorative rating rows are not toggles.
    for (const m of html.matchAll(/<(?:button|a)[^>]*(?:★|☆|favorite|star)[^>]*>/gi)) {
      const tag = m[0];
      if (/aria-label="(?:Toggle menu|Open )/i.test(tag)) continue; // named controls, not favorite toggles
      if (!/toggle|favorite/i.test(tag)) continue; // decorative/inert
      if (!/aria-label="Toggle favorite"/i.test(tag)) {
        offenders.push(`${path.relative(BACKEND, file)}: ${tag.slice(0, 120)}`);
      } else if (/^<button/i.test(tag) && !/type="button"/.test(tag)) {
        offenders.push(`${path.relative(BACKEND, file)}: missing type="button" — ${tag.slice(0, 120)}`);
      }
    }
  }
  // The library currently ships ZERO favorite toggles (the live fence-site
  // star is injected at the render layer, not in donors). This census pins
  // that any donor-level toggle that appears must be labeled.
  assert.deepEqual(offenders, [], `unlabeled star/favorite toggles:\n${offenders.join("\n")}`);
});

// ---------------------------------------------------------------------------
// ITEM 1 — HEADER RIGHT-CLUSTER HARDENING
// ---------------------------------------------------------------------------
test("item 1: the phone CTA never wraps and the nav collapses below 1024px", () => {
  const plumbing = read(path.join(BACKEND, "boilerplates", "plumbing-pressure-lens", "index.html"));
  assert.match(plumbing, /\.nav \.button \{ white-space: nowrap; \}/);
  assert.match(plumbing, /@media \(max-width: 1024px\) \{\s*\.nav-links > a:not\(\.button\) \{ display: none; \}/);

  const gc = read(path.join(BACKEND, "donors-clean", "general-contractor-clean", "assets", "styles.css"));
  assert.match(gc, /\.nav-call \{[^}]*white-space: nowrap/s);
  assert.match(gc, /@media \(max-width: 1024px\) \{\s*\.site-nav > a:not\(\.nav-call\) \{ display: none; \}/);

  const tree = read(path.join(BACKEND, "boilerplates", "tree-care-dark", "index.html"));
  assert.match(tree, /href="tel:\+1\{\{PHONE\}\}" class="[^"]*whitespace-nowrap/);
});

// ---------------------------------------------------------------------------
// ITEM 5 — TESTIMONIAL TRACKS SNAP, NEVER CLIP
// ---------------------------------------------------------------------------
test("item 5: the reviews track is a scroll-snap carousel when its animation is stopped", () => {
  const css = read(path.join(BACKEND, "boilerplates-source", "tattoo-dark", "src", "styles.css"));
  assert.match(css, /\.snap-track \{[^}]*scroll-snap-type: x mandatory/s);
  assert.match(css, /\.snap-track > \* \{[^}]*scroll-snap-align: start/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.snap-track \{[^}]*overflow-x: auto/s);

  const reviews = read(path.join(BACKEND, "boilerplates-source", "tattoo-dark", "src", "components", "Reviews.tsx"));
  assert.match(reviews, /marquee-track snap-track/);

  for (const rel of [
    path.join("boilerplates-source", "tattoo-port-staging", "site", "index.html"),
    path.join("donors-clean", "tattoo-aurelia", "index.html"),
  ]) {
    const html = read(path.join(BACKEND, rel));
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.marquee-track \{[^}]*scroll-snap-type: x mandatory/s, `${rel}: reduced-motion snap track`);
  }
});
