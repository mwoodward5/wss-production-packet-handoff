"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { measureThemeHeadlineContrast } = require("../lib/mirror-engine/verify");

function withThemeDom({ foreground, html, body, hero, headline }, run) {
  let activeMode = "light";
  const root = {
    parentElement: null,
    setAttribute(name, value) { if (name === "data-wss-theme") activeMode = value; },
    classList: { toggle() {} },
  };
  const bodyNode = { parentElement: root };
  const heroNode = { parentElement: bodyNode };
  const h1 = { parentElement: heroNode, getBoundingClientRect: () => ({ width: 500, height: 80 }) };
  const colors = new Map([
    [root, html],
    [bodyNode, body],
    [heroNode, hero],
    [h1, headline],
  ]);
  const previousDocument = global.document;
  const previousComputedStyle = global.getComputedStyle;
  global.document = { documentElement: root, querySelector: (selector) => selector === "h1" ? h1 : null };
  global.getComputedStyle = (node) => ({
    backgroundColor: typeof colors.get(node) === "function" ? colors.get(node)(activeMode) : colors.get(node),
    color: node === h1 ? foreground(activeMode) : "rgb(0, 0, 0)",
    display: "block",
    visibility: "visible",
    opacity: "1",
  });
  try { return run(); } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousComputedStyle;
  }
}

test("theme contrast composites translucent hero layers instead of treating them as opaque", () => {
  withThemeDom({
    foreground: () => "rgb(255, 255, 255)",
    html: "rgba(0, 0, 0, 0)",
    body: "rgb(0, 0, 0)",
    hero: "rgba(255, 255, 255, 0.10)",
    // This exact transparent-white shape was previously read as opaque white.
    headline: "rgba(255, 255, 255, 0)",
  }, () => {
    for (const mode of ["light", "dark"]) {
      const proof = measureThemeHeadlineContrast(mode);
      assert.equal(proof.visible, true);
      assert.ok(proof.contrast >= 4.5, `${mode} must pass against the composited dark hero`);
    }
  });
});
test("theme contrast still refuses a genuinely unreadable headline", () => {
  withThemeDom({
    foreground: () => "rgb(130, 130, 130)",
    html: "rgba(0, 0, 0, 0)",
    body: "rgb(128, 128, 128)",
    hero: "rgba(255, 255, 255, 0)",
    headline: "transparent",
  }, () => {
    for (const mode of ["light", "dark"]) {
      assert.ok(measureThemeHeadlineContrast(mode).contrast < 4.5, `${mode} must remain blocked`);
    }
  });
});
