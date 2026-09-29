"use strict";

// lib/mirror-engine/first-impression.js — THE FIRST-SECOND LAW (2026-09-04
// first-impression robustness lane). Owner bar: "every site looks and works
// like a $10,000 website — including the FIRST SECOND on a cold cache."
//
// Two engine-side nets, injected over the complete HTML tree (the same seam
// the hero-video ladder failsafe uses), so the guarantee holds for every
// donor shape — the 12 reveal-wired donor families this repo ships AND any
// external donor root an operator points MIRROR_DONOR_ROOT at.
//
//   1. REVEAL NEVER-HIDDEN NET (marker: data-wss-reveal-failsafe).
//      The donors' scroll-reveal entrances used to ship opacity:0 as the
//      PRE-JS state (`.js .reveal { opacity: 0 }` until an observer added
//      .in). On a real machine that pre-state survives indefinitely: a
//      blocking extension, a smooth-scroll interrupt, a font-metric anomaly
//      — any JS hiccup after the head's `js` class lands leaves 30+ sections
//      painting as blank bands, the exact "raw unstyled dump" owners judge
//      builds by. The donor families now arm the hidden state themselves
//      (visible-by-default + .reveal-armed/.js-reveal-armed progressive
//      enhancement, with the #703 capture-safety timer kept as the slower
//      net). This engine net is the floor under all of them:
//        · CSS: .reveal transitions FROM visible unless the root gate
//          (.js-reveal-armed) AND the per-element arming class are present.
//          A page whose JS never ran has no gate — everything shows.
//        · a <noscript> style belt-and-braces for JS-disabled visitors;
//        · a one-shot inline script that force-reveals everything if, 900ms
//          after the script runs (≈ first paint), NOTHING has been revealed
//          — the signature of an observer that never fired.
//      Where the mechanism works (observer alive, above-fold reveals land
//      within a frame or two), the one-shot stands down and the entrance
//      animation survives untouched.
//
//   2. HERO VIDEO FRAME-READY GUARD (marker: data-wss-hero-ready-guard).
//      A hero clip that unhides on metadata alone (readyState 1) can paint a
//      black/gray rectangle over the poster photograph while its first frame
//      is still in flight — the "hero blank until readyState arrives"
//      defect. The guard keeps a ladder-marked video invisible until it can
//      actually DRAW (readyState >= 2, the data-hero-ready attribute set by
//      the capture-phase listeners below), over the poster photograph; a
//      clip that never reaches a frame stays hidden and the painted hero
//      surface shows. The donor walkers control display via [hidden]; this
//      is the visibility floor under them, scoped to html.js so a no-JS
//      visitor's static video still paints its own poster attribute.

const REVEAL_MARKER = "data-wss-reveal-failsafe";
const HERO_MARKER = "data-wss-hero-ready-guard";

// A page participates in the reveal net when its bytes name the reveal
// system: a .reveal class token in markup or the donors' observe wiring.
function pageHasReveal(html) {
  return /class=(["'])[^"]*\breveal\b/.test(html)
    || html.includes("querySelectorAll('.reveal')")
    || html.includes('querySelectorAll(".reveal")');
}

// A page participates in the hero guard when a ladder-marked video can
// appear on it: the ladder island itself, the mount marker, or a static
// marked element.
function pageHasHeroVideo(html) {
  return html.includes("hero-video-ladder") || html.includes("data-hero-video");
}

function revealFailSafeSnippet() {
  const floorCss = [
    "/* wss first-impression: content is never hidden as its pre-JS state. */",
    ".reveal { opacity: 1 !important; transform: none !important; }",
    "html.js-reveal-armed .reveal.reveal-armed:not(.in) { opacity: 0 !important; transform: translateY(18px) !important; }",
  ].join("\n");
  const noscriptCss = ".reveal { opacity: 1 !important; transform: none !important; }";
  const js = [
    '(function(){try{',
    'if(window.wssRevealFailsafe)return;window.wssRevealFailsafe="1";',
    'var d=document,r=d.documentElement;',
    'function revealAll(){try{',
    'r.classList.remove("js-reveal-armed");',
    'var els=d.querySelectorAll(".reveal");',
    'for(var i=0;i<els.length;i++){els[i].style.transition="none";els[i].classList.add("in");}',
    '}catch(e){}}',
    'setTimeout(function(){try{',
    'var els=d.querySelectorAll(".reveal");',
    'if(!els.length)return;',
    'var revealed=false;',
    'for(var i=0;i<els.length;i++){var el=els[i];',
    'if(el.classList.contains("in")){revealed=true;break}',
    'var op=1;try{op=parseFloat(getComputedStyle(el).opacity)}catch(e){}',
    'if(!(op<0.98)){revealed=true;break}',
    '}',
    'if(!revealed)revealAll();',
    '}catch(e){}},900);',
    '}catch(e){}})();',
  ].join("");
  return [
    `<noscript><style ${REVEAL_MARKER}>${noscriptCss}</style></noscript>`,
    `<style ${REVEAL_MARKER}>${floorCss}</style>`,
    `<script ${REVEAL_MARKER}>${js}</` + `script>`,
  ].join("");
}

function heroReadyGuardSnippet() {
  const css = "html.js video[data-hero-video]:not([data-hero-ready]) { visibility: hidden !important; }";
  const js = [
    '(function(){try{',
    'if(window.wssHeroReadyGuard)return;window.wssHeroReadyGuard="1";',
    'var d=document;',
    'function mark(v){try{if(v&&v.tagName==="VIDEO"&&v.hasAttribute("data-hero-video")&&v.readyState>=2)v.setAttribute("data-hero-ready","1")}catch(e){}}',
    'function sweep(){try{var vs=d.querySelectorAll("video[data-hero-video]");for(var i=0;i<vs.length;i++)mark(vs[i])}catch(e){}}',
    'd.addEventListener("loadeddata",function(e){mark(e&&e.target)},true);',
    'd.addEventListener("canplay",function(e){mark(e&&e.target)},true);',
    'd.addEventListener("playing",function(e){mark(e&&e.target)},true);',
    'sweep();setTimeout(sweep,400);setTimeout(sweep,1200);',
    '}catch(e){}})();',
  ].join("");
  return [
    `<style ${HERO_MARKER}>${css}</style>`,
    `<script ${HERO_MARKER}>${js}</` + `script>`,
  ].join("");
}

function injectBeforeBodyClose(html, snippet) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  return html + snippet;
}

/**
 * applyToFiles(files) -> { reveal_pages, hero_pages }
 * One idempotent pass over the built tree. Files are Buffer values keyed by
 * repository-relative path, exactly as the engine's other HTML-tree passes
 * consume them. Only .html pages are touched; a page already carrying a
 * marker is left byte-identical.
 */
function applyToFiles(files) {
  let revealPages = 0;
  let heroPages = 0;
  const reveal = revealFailSafeSnippet();
  const hero = heroReadyGuardSnippet();
  for (const rel of Object.keys(files)) {
    if (!/\.html?$/i.test(rel)) continue;
    const before = files[rel].toString("utf8");
    let html = before;
    if (!html.includes(REVEAL_MARKER) && pageHasReveal(html)) {
      html = injectBeforeBodyClose(html, reveal);
      revealPages += 1;
    }
    if (!html.includes(HERO_MARKER) && pageHasHeroVideo(html)) {
      html = injectBeforeBodyClose(html, hero);
      heroPages += 1;
    }
    if (html !== before) files[rel] = Buffer.from(html, "utf8");
  }
  return { reveal_pages: revealPages, hero_pages: heroPages };
}

module.exports = {
  REVEAL_MARKER,
  HERO_MARKER,
  pageHasReveal,
  pageHasHeroVideo,
  revealFailSafeSnippet,
  heroReadyGuardSnippet,
  applyToFiles,
};
