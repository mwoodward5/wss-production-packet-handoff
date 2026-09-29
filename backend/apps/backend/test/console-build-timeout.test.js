"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const page = require("../lib/operator-workspace-page-final");

function inlineScript() {
  const matches = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(matches.length, "operator workspace must contain an inline controller");
  return matches.map((match) => match[1]).join("\n");
}

test("new build starts one bounded canonical batch and progress is GET-polled", () => {
  const script = inlineScript();

  // The current operator product has one explicit Start production run action.
  // It POSTs the requested quota/target/lane exactly once. After that, the
  // server owns durable continuation and the browser only GETs /api/admin/line
  // for truthful telemetry; the UI must never keep a build alive by re-POSTing
  // action:start from a poll loop.
  assert.match(script, /api\('\/api\/admin\/line',\{method:'POST',body:JSON\.stringify\(\{action:'start',count:count,target:target\(\),lane:state\.mode\}\)\}\)/);
  assert.equal((script.match(/action:'start'/g) || []).length, 1);
  assert.match(script, /Promise\.all\(\[api\('\/api\/admin\/line'\)/);
  assert.match(script, /setInterval\(function\(\)\{if\(!document\.hidden\)load\(true\);\},5000\)/);
  assert.match(script, /n>=1&&n<=500/);
  assert.doesNotMatch(script, /continueBuild|again\.action=['"]start|action:['"]start['"][^\n]{0,180}setInterval|\/api\/admin\/full-run/);
});

test("operator workspace itself exposes no direct approve or send API bypass", () => {
  const script = inlineScript();
  assert.doesNotMatch(script, /\/api\/admin\/(?:approve|send)(?:["'/?]|$)/i);
  assert.match(page, /Live → prospects/);
  assert.match(page, /Prospect sends still require the normal approval rules/i);
  assert.match(page, /href="\/campaigns"/);
});
