"use strict";

// Authentication failures and connectivity failures are different operator
// states. The console must not turn a rejected token into an invented outage.

const test = require("node:test");
const assert = require("node:assert/strict");
const page = require("../lib/console-page");

test("401 and 403 show an honest authentication label and clear the token", () => {
  assert.match(page, /if\(error\.status===401\|\|error\.status===403\)\{/);
  assert.match(page, /clearToken\(\);\s*showGate\("Token expired or rejected\. Enter a current operator token\."\)/);
  assert.doesNotMatch(page, /Can't reach server \(server 401\)/i);
  assert.doesNotMatch(page, /Can't reach server \(server 403\)/i);
});

test("a non-auth refresh failure is labelled offline without claiming an HTTP outage", () => {
  assert.match(page, /textContent="offline · last refresh failed"/);
  assert.match(page, /textContent="Console refresh failed: "\+error\.message/);
  assert.doesNotMatch(page, /CAN'T REACH SERVER \(SERVER 503\)/i);
});

test("the access gate reports checking and rejected-token states separately", () => {
  assert.match(page, /accessButton\.textContent="Checking access…"/);
  assert.match(page, /accessStatus\.textContent="Checking access…"/);
  assert.match(page, /showGate\("Token expired or rejected\. Enter a current operator token\."\)/);
});
