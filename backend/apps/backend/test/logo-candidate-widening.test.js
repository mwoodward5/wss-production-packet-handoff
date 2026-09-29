"use strict";

// test/logo-candidate-widening.test.js
//
// WHY THIS EXISTS, measured: a 300-candidate live mine across concrete and
// fencing in six metros produced 32 weak sites and ZERO qualified leads. Every
// one died at stage 4 with `no_own_domain_logo_candidate`. The gate was not
// wrong — the EXTRACTOR was too narrow. It only read a plain `src` attribute,
// while the site builders that weak-site prospects actually use (Wix,
// Squarespace, Duda, GoDaddy) ship the mark as a responsive `srcset` or paint it
// as a CSS background-image.
//
// The ownership check is the thing that must NOT loosen: it is the APOC fix,
// the guard that stops another company's mark landing on a client's page. So
// these tests prove the extractor now SEES more while the ownership gate still
// REFUSES exactly as much.

const test = require("node:test");
const assert = require("node:assert/strict");
const { findLogoCandidates, sameOwner } = require("../lib/web-brand");

const SITE = "https://acefence.com/";

test("srcset: the largest variant is taken, not the first", () => {
  const out = findLogoCandidates(
    '<img srcset="/logo-320.png 320w, /logo-640.png 640w, /logo-960.png 960w" alt="Ace Fence logo">',
    SITE,
  );
  assert.deepEqual(out, ["https://acefence.com/logo-960.png"]);
});

test("data-srcset is read too — lazy-loading is the norm on builder sites", () => {
  const out = findLogoCandidates('<img data-srcset="/site-logo.webp 800w" class="header-logo">', SITE);
  assert.deepEqual(out, ["https://acefence.com/site-logo.webp"]);
});

test("a CSS background-image logo is found, quoted or bare", () => {
  for (const css of [
    '<div style="background-image:url(/img/site-logo.svg)"></div>',
    `<div style="background:url('/img/site-logo.svg') no-repeat"></div>`,
    '<div style=\'background-image: url("/img/site-logo.svg")\'></div>',
  ]) {
    assert.deepEqual(findLogoCandidates(css, SITE), ["https://acefence.com/img/site-logo.svg"], css);
  }
});

test("THE GATE HOLDS: an off-domain mark is still refused, however it is shipped", () => {
  const foreign = [
    '<img srcset="https://cdn.competitor.com/logo-960.png 960w" alt="logo">',
    '<div style="background-image:url(https://cdn.competitor.com/site-logo.svg)"></div>',
    '<img src="https://cdn.competitor.com/logo.png" alt="logo">',
  ];
  for (const html of foreign) {
    assert.deepEqual(findLogoCandidates(html, SITE), [], html);
  }
  assert.equal(sameOwner(SITE, "https://cdn.competitor.com/logo.png"), false);
  assert.equal(sameOwner(SITE, "https://www.acefence.com/logo.png"), true, "www is the same owner");
});

test("a srcset with no logo hint anywhere is not a logo candidate", () => {
  // A hero photo also ships responsively. Without a hint it must not be mistaken
  // for the mark — a wrong logo is worse than no logo, because no logo refuses.
  assert.deepEqual(findLogoCandidates('<img srcset="/hero-1600.jpg 1600w" alt="new fence install">', SITE), []);
});

test("the plain src path is unchanged", () => {
  assert.deepEqual(findLogoCandidates('<img src="/logo.png" alt="logo">', SITE), ["https://acefence.com/logo.png"]);
});

test("a data: URI is never a candidate", () => {
  assert.deepEqual(findLogoCandidates('<img src="data:image/png;base64,iVBORw0KG" alt="logo">', SITE), []);
});
