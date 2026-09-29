"use strict";

/**
 * test/refusal-never-hands-back-the-engineering.test.js
 *
 * MEASURED on a live Riley session, 2026-08-11, on
 * wss-test-northland-heating-and-air-conditioning-col.wss-ai.com:
 *
 *   caller  "Change the heading that says Comfort isn't a setting on the wall
 *            to say We show up when Columbus gets cold."
 *   reason  "The requested text does not exist on the page"
 *   say     "I don't see a heading that says 'Comfort isn't a setting on the
 *            wall' anywhere on your site — can you tell me which section it's
 *            in or what it's near?"
 *
 * The heading was on the page — rendered and measured as an <h2> at 56px
 * reading "Comfort isn't a setting on the wall. It's a system." So the sentence
 * was false, and it was homework, and the system prompt tells Riley to read the
 * tool's sentence out exactly.
 *
 * The `next` block on that same response already said, in capitals, "NEVER ask
 * the caller to identify an element, a section, a file, a selector, a colour
 * code or a link." An instruction in one field cannot police a string in
 * another when the model is told to obey both. So the string is filtered.
 *
 * These cases are the boundary. The refusals that survive are the ones that
 * tell the customer what happened; the ones that are dropped are the ones that
 * ask a plumber to do the finding.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { asksCallerToDoTheFinding } = require("../api/vapi-tools/site-edit.js");

test("the sentence from the live call is caught", () => {
  assert.equal(
    asksCallerToDoTheFinding(
      "I don't see a heading that says 'Comfort isn't a setting on the wall' anywhere on your site — can you tell me which section it's in or what it's near?",
    ),
    true,
  );
});

test("every shape of handing the engineering back is caught", () => {
  const homework = [
    "I couldn't find that one — can you tell me which section it's in?",
    "Could you point me at the element you mean?",
    "Which page is that on?",
    "Can you send me the link to the part of the page you mean?",
    "Do you know which colour code you'd like?",
    "Tell me where exactly on the site that sits and I'll take another run at it.",
    "Can you give me the file it's in?",
    "What's it near on the page it's on?",
  ];
  for (const s of homework) {
    assert.equal(asksCallerToDoTheFinding(s), true, `should have been caught: "${s}"`);
  }
});

test("an honest refusal that merely ends in a question still gets spoken", () => {
  const fine = [
    "I can't get that one done from here, and I'm not going to guess on your live site. I'm putting it in front of a person on our team today — shall I have them call you back?",
    "That one needs a photo we've never had. Do you want to email one over and I'll get it on there?",
    "I wasn't able to make that change. Nothing on your site has changed. Want me to have someone look at it today?",
    "Two ways I can take that — bigger across the whole header, or just the logo. Which sounds right?",
    "I can't put a competitor's wording on your page. Is there something of your own you'd like there instead?",
  ];
  for (const s of fine) {
    assert.equal(asksCallerToDoTheFinding(s), false, `should NOT have been caught: "${s}"`);
  }
});

test("a statement is never homework, however it is worded", () => {
  const statements = [
    "I don't see that heading on your site, so I've logged it for the team and nothing has changed.",
    "That one didn't go through. Nothing on your site changed.",
    "The section you mean isn't something I can reach from here.",
    "",
    null,
    undefined,
  ];
  for (const s of statements) {
    assert.equal(asksCallerToDoTheFinding(s), false, `should NOT have been caught: "${s}"`);
  }
});
