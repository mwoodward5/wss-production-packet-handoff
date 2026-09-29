"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { operatorNav, DESTINATIONS } = require("../lib/operator-nav");

const PAGES = [
  ["console", require("../lib/console-page")],
  ["gallery", require("../lib/gallery-page")],
  ["campaigns", require("../lib/campaigns-page")],
  ["replies", require("../lib/replies-page")],
  ["ledger", require("../lib/ledger-page")],
  ["line", require("../lib/line-console-page")],
];

test("the shared bar exposes the complete operator workflow", () => {
  assert.deepEqual(
    DESTINATIONS.map((entry) => [entry.href, entry.label]),
    [
      ["/console", "Home"],
      ["/gallery", "Websites"],
      ["/campaigns", "Outreach"],
      ["/replies", "Replies"],
      ["/ledger", "Results"],
      ["/line", "Engine room"],
    ],
  );
  const html = operatorNav("gallery");
  for (const entry of DESTINATIONS) {
    assert.ok(html.includes(`href="${entry.href}"`), `missing link to ${entry.href}`);
    assert.ok(html.includes(entry.label), `missing label ${entry.label}`);
  }
});

test("exactly one destination is marked current and named plainly", () => {
  const html = operatorNav("ledger");
  assert.equal((html.match(/ aria-current="page"/g) || []).length, 1);
  assert.match(html, /href="\/ledger" aria-current="page">Results<\/a>/);
  assert.match(html, /You are on Results/);
});

test("an unknown page still renders every way out", () => {
  const html = operatorNav("not-a-page");
  assert.equal(html.match(/ aria-current="page"/g), null);
  for (const entry of DESTINATIONS) assert.ok(html.includes(`href="${entry.href}"`));
});

test("the WSS mark and new-build action are always available", () => {
  const html = operatorNav("console");
  assert.match(html, /class="wssnav-home" href="\/console"/);
  assert.match(html, /href="\/console\?new=1">＋ New build<\/a>/);
});

test("shared chrome is viewport safe, readable, and responsive", () => {
  const html = operatorNav("console");
  assert.match(html, /id="wss-operator-suite-chrome"/);
  assert.match(html, /\.wssnav,\.wssnav \*\{box-sizing:border-box\}/);
  assert.match(html, /\.wssnav\{[^}]*width:100%/);
  assert.match(html, /\.wssnav\{[^}]*padding:0 22px/);
  assert.match(html, /--wss-copy:clamp\(15px,.82vw,17px\)/);
  assert.match(html, /--wss-control:clamp\(14px,.76vw,16px\)/);
  assert.match(html, /max-width:min\(1540px,calc\(100vw - 42px\)\)!important/);
  assert.match(html, /@media\(max-width:780px\)/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test("every non-Home operator surface carries the same bar once", () => {
  for (const [key, html] of PAGES.filter(([key]) => key !== "console")) {
    assert.equal(typeof html, "string", `${key} page is not a string`);
    assert.equal((html.match(/<nav class="wssnav"/g) || []).length, 1, `${key} needs one shared bar`);
    for (const entry of DESTINATIONS) {
      assert.ok(html.includes(`href="${entry.href}"`), `${key} cannot reach ${entry.href}`);
    }
  }
});

test("every legacy operator surface marks itself current", () => {
  for (const [key, html] of PAGES.filter(([key]) => key !== "console")) {
    const hit = DESTINATIONS.find((entry) => entry.key === key);
    assert.ok(hit, `${key} missing from destinations`);
    assert.ok(html.includes(`href="${hit.href}" aria-current="page"`), `${key} does not mark itself current`);
  }
});

test("shared bar carries truthful live factory state on every page", () => {
  const html = operatorNav("replies");
  assert.match(html, /id="wssnavLive"/);
  assert.match(html, /id="wssnavTruth"/);
  assert.match(html, /id="wssnavTruthRun"/);
  assert.match(html, /id="wssnavTruthAge"/);
  assert.match(html, /id="wssnavTruthStage"/);
  assert.match(html, /id="wssnavTruthEnv"/);
  assert.match(html, /\/api\/admin\/line/);
  assert.match(html, /Sourcing prospects/);
  assert.match(html, /Building websites/);
  assert.match(html, /Inspecting live sites/);
  assert.match(html, /Preparing proofs/);
  assert.match(html, /packet/);
  assert.match(html, /qualified/);
  assert.match(html, /build-started/);
  assert.match(html, /cleared/);
  assert.match(html, /inspected/);
  assert.match(html, /ready/);
  assert.match(html, /sent/);
  assert.match(html, /rejected/);
  assert.match(html, /last-updated/);
  assert.match(html, /data-age/);
  assert.match(html, /server-time/);
  assert.match(html, /wss-run-snapshot/);
  assert.match(html, /-Site Local Growth Sprint/);
  assert.match(html, /setInterval\(function\(\)\{if\(!document\.hidden\)poll\(\)\},7000\)/);
});

test("no page keeps the old duplicate backlink navigation", () => {
  for (const [key, html] of PAGES) {
    assert.ok(!html.includes("&#8592; Command Center"), `${key} still has a backlink`);
    assert.ok(!html.includes("Gallery &#8599;"), `${key} still has a duplicate gallery tab`);
    assert.ok(!html.includes('class="nav-link" href="/console"'), `${key} still has an old nav-link`);
  }
});
