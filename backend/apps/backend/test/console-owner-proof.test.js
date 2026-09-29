"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/console-page");

function scripts() {
  return [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function controllerScript() {
  const sources = scripts();
  const controllers = sources.filter((source) => source.includes("function api(path,opts)") && source.includes("wsl_admin_token"));
  assert.equal(controllers.length, 1, "approved console should have exactly one authenticated inline controller");
  return controllers[0];
}

test("approved console inline scripts parse and expose one authenticated controller", () => {
  const sources = scripts();
  assert.ok(sources.length >= 1, "approved console should have inline behavior");
  for (const [index, source] of sources.entries()) {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `approved-console-inline-${index + 1}.js` }));
  }
  controllerScript();
});

test("operator token is added only as the x-admin-token header", () => {
  const script = controllerScript();
  const apiStart = script.indexOf("function api(path,opts)");
  const apiEnd = script.indexOf("function post(path,body)", apiStart);
  assert.ok(apiStart >= 0 && apiEnd > apiStart, "authenticated api helper must exist");
  const apiSource = script.slice(apiStart, apiEnd);

  assert.match(apiSource, /opts\.headers\["x-admin-token"\]=token\(\)/);
  assert.match(apiSource, /return fetch\(path,opts\)/);
  assert.doesNotMatch(apiSource, /(?:path|url|href)\s*(?:\+|=)[^;\n]*token\(\)/i);

  const postStart = apiEnd;
  const postEnd = script.indexOf("function showGate", postStart);
  assert.match(script.slice(postStart, postEnd), /return api\(path,\{method:"POST",headers:\{"content-type":"application\/json"\},body:JSON\.stringify\(body\)\}\)/);
});

test("operator token cannot be ingested from a URL or hash", () => {
  const script = controllerScript();
  assert.match(page, /<input id="tokenInput" type="password"/);
  assert.match(script, /var value=tokenInput\.value\.trim\(\)/);
  // Arcade integration 2026-09-03: the hero's demo flag reader (?demo=arcade)
  // is the one sanctioned location.search read — a display mode, never a
  // credential. It is stripped below so the law stays byte-strict.
  const withoutDemoFlag = script.replace(/var ARCADE_DEMO=[^\n]*\n/, "");
  assert.doesNotMatch(withoutDemoFlag, /location\.(?:hash|search)\b|URLSearchParams|searchParams|decodeURIComponent\(/);
  assert.doesNotMatch(page, /[?&#](?:t|token|admin_token)=/i);
});

test("the access gate stays closed until console-data authenticates", () => {
  const script = controllerScript();
  const loadStart = script.indexOf("function load()");
  const loadEnd = script.indexOf('accessForm.addEventListener("submit"', loadStart);
  const loadSource = script.slice(loadStart, loadEnd);
  assert.ok(loadSource.indexOf("renderApprovedOverview(snapshot)") < loadSource.indexOf("hideGate()"));
  assert.doesNotMatch(script.slice(script.indexOf('accessForm.addEventListener("submit"'), script.indexOf('document.querySelectorAll(".launchBtn")')), /hideGate\(\)/);
});

test("rejected credentials are removed before the operator retries", () => {
  const script = controllerScript();
  assert.match(script, /if\(error\.status===401\|\|error\.status===403\)\{\s*clearToken\(\);\s*showGate\("Token expired or rejected\. Enter a current operator token\."\);/);
  assert.match(script, /function clearToken\(\)\{try\{localStorage\.removeItem\(KEY\);\}catch\(_\)\{\}\}/);
});