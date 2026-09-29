"use strict";

// Guard: every inline <script> served on /console must parse as JavaScript.
// Two separate production incidents shipped a console page whose inline
// scripts had syntax errors (an unterminated string from a page-final swap,
// and unbalanced parens in the login recovery layer). With zero working JS
// the login form falls back to a browser GET submit ("/console?") and the
// owner is locked out even with a correct password. This test fails the
// build instead.
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");

// Follow the route's own PAGE require so the guard always inspects whatever
// api/admin/console.js actually serves. The 2026-08-19 lockout incident was
// caused by shipping syntax-broken inline scripts; this test fails the build
// instead of repeating it. (Today the route serves lib/console-page.)
const routeSource = fs.readFileSync(path.join(__dirname, "../api/admin/console.js"), "utf8");
const pageRequire = routeSource.match(/const PAGE = require\("([^"]+)"\);/);
assert.ok(pageRequire, "api/admin/console.js must declare a PAGE require");
const page = require(path.join(__dirname, "../api/admin", pageRequire[1]));

function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

test("console page has the arcade module and the dashboard controller scripts", () => {
  const scripts = inlineScripts(page);
  assert.ok(scripts.length >= 2, `expected >=2 inline scripts, got ${scripts.length}`);
  assert.ok(page.includes("window.WSSArcade"), "arcade layer script missing");
  assert.ok(page.includes('var KEY="wsl_admin_token"'), "dashboard controller script missing");
});

test("every inline console script parses as JavaScript", () => {
  const scripts = inlineScripts(page);
  for (const [i, src] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(src), `inline script #${i + 1} has a syntax error`);
  }
});

test("template-literal regex escapes survived into the page", () => {
  // The base page is a plain template literal; a bare \s or \w in it is eaten
  // at require time and ships a wrong regex (e.g. /s+ins+/ instead of /\s+in\s+/).
  for (const corrupted of ["/s+ins+", "replace(/w/g,", "/s+nationwide$"]) {
    assert.ok(!page.includes(corrupted), `corrupted regex shipped: ${corrupted}`);
  }
  assert.ok(page.includes("\\s+nationwide$"), "expected \\s+nationwide regex in page");
});
