"use strict";

// test/edit-clarify.test.js — the clarifying-question turn.
// Riley asks ONE warm question (with options) before queuing an edit it can't do
// from the data (a team page with nobody to put on it); a clear ask passes
// straight through. Fail-open on every model failure so the edit path is never
// blocked.

const test = require("node:test");
const assert = require("node:assert/strict");

const { assessEditRequest, firstJsonObject } = require("../lib/edit-clarify");

const model = (text) => async () => ({ ok: true, text });

test("firstJsonObject takes the first balanced object, ignoring trailing junk", () => {
  assert.equal(firstJsonObject('{"needsInput":false} then a note'), '{"needsInput":false}');
  assert.equal(firstJsonObject('noise {"a":{"b":"}"}} tail'), '{"a":{"b":"}"}}');
  assert.equal(firstJsonObject("no object here"), null);
});

test("a team-page-with-no-people ask returns a warm clarifying question", async () => {
  const say = "Love this — a team page builds trust fast. Type each name, upload a photo + name for each, or I can make a section from what's on your site. Which?";
  const out = await assessEditRequest({
    message: "make a team page with a profile for everyone",
    businessName: "Family Heating",
    callModelImpl: model(`{"needsInput": true, "say": ${JSON.stringify(say)}}`),
  });
  assert.equal(out.needsInput, true);
  assert.equal(out.say, say);
});

test("a clear, actionable ask passes through (no question)", async () => {
  const out = await assessEditRequest({
    message: "make the phone number in the header bigger",
    businessName: "Family Heating",
    callModelImpl: model('{"needsInput": false, "say": ""}'),
  });
  assert.equal(out.needsInput, false);
});

test("an empty message never calls the model and needs no input", async () => {
  let called = false;
  const out = await assessEditRequest({ message: "   ", callModelImpl: async () => { called = true; return { ok: true, text: "{}" }; } });
  assert.equal(out.needsInput, false);
  assert.equal(called, false);
});

test("FAIL-OPEN: a thrown model, a not-ok result, and unparseable text all pass through", async () => {
  const thrown = await assessEditRequest({ message: "x", callModelImpl: async () => { throw new Error("boom"); } });
  assert.equal(thrown.needsInput, false);
  const notOk = await assessEditRequest({ message: "x", callModelImpl: async () => ({ ok: false, reason: "down" }) });
  assert.equal(notOk.needsInput, false);
  const junk = await assessEditRequest({ message: "x", callModelImpl: model("Sorry, I can't answer in JSON.") });
  assert.equal(junk.needsInput, false);
});

test("needsInput:true with an empty say is treated as no-question (guards a lazy model)", async () => {
  const out = await assessEditRequest({ message: "x", callModelImpl: model('{"needsInput": true, "say": "   "}') });
  assert.equal(out.needsInput, false);
});

test("a model that appends a note after the JSON still parses", async () => {
  const out = await assessEditRequest({
    message: "add a team page",
    callModelImpl: model('{"needsInput": true, "say": "Who is on your team?"}\nHope that helps!'),
  });
  assert.equal(out.needsInput, true);
  assert.equal(out.say, "Who is on your team?");
});
