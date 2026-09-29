"use strict";

/**
 * test/riley-never-promises-a-duration.test.js
 *
 * "Give me about a minute and it'll be live."
 *
 * That sentence was said to a caller at the moment the edit runner ran out of
 * its in-request budget — i.e. at the one moment nothing yet knew how long the
 * change would take, or whether it would land at all. MEASURED over the 126
 * real customer-shaped edit jobs on production (wss-probe-* fault injections
 * excluded), the 89 that outran the budget behaved like this:
 *
 *     reached done              63 / 89   (71%)
 *     took longer than 60s      28 / 89   (31%)
 *     time to a terminal state  p50 22s, with a tail past ten minutes
 *
 * So the promise was wrong about one time in three on duration, and about
 * three times in ten on the outcome. The owner's rule: a promise the system
 * cannot keep is the same defect class as a fabricated fact.
 *
 * This test holds the voice edit path to it. Every customer-facing `say`
 * string in the two files that tell a caller where their change stands is
 * scanned for a spoken duration. A refusal, a failure and a done are all
 * allowed to be specific — they are reports of something that already
 * happened. What is banned is a FORECAST: "a minute", "a couple of minutes",
 * "shortly", "any second now".
 *
 * The one survivor is deliberate and is asserted below: the >3-minute branch
 * says "check the page yourself in a few minutes", which is an instruction to
 * the caller about when to go and look, made only after we have stopped
 * claiming the change is imminent, and in the same breath as "I don't want to
 * guess at a time". It is exempted by exact sentence, so a new forecast cannot
 * hide behind it.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const FILES = [
  // The spoken sentences live in the tool cores; the routes are transport
  // shells over them (see api/vapi-tools/riley.js), so both are scanned.
  path.resolve(__dirname, "..", "lib", "site-edit-core.js"),
  path.resolve(__dirname, "..", "lib", "edit-status-core.js"),
  path.resolve(__dirname, "..", "api", "vapi-tools", "site-edit.js"),
  path.resolve(__dirname, "..", "api", "vapi-tools", "site-edit-status.js"),
];

/**
 * The dashboard says the same things in writing. lib/customer-edits.js FALLBACK
 * is the copy a customer reads on wss-ai.com/dashboard while a change is in
 * flight, and it carried the identical promise ("this usually takes a minute or
 * two") over the identical unknown. One queue, two surfaces, one rule.
 */
const STATUS_COPY = path.resolve(__dirname, "..", "lib", "customer-edits.js");

/** Sentences allowed to carry a time word, quoted exactly. "Check the page in
 *  a few minutes" is advice about when to LOOK, not a promise about when the
 *  work lands — and the flagged claim is made true before it is spoken (see
 *  flagStalledEditJob in lib/edit-progress.js). */
const ALLOWED = [
  "This is taking longer than it should, so I've flagged it for the team. I won't guess at a time — you can check the page yourself in a few minutes, or ask me again any time.",
];

/**
 * A spoken forecast of how long the caller must wait. Deliberately narrow:
 * it matches time words in the shapes a promise takes, not every appearance
 * of the word "minute".
 */
const FORECAST = new RegExp(
  [
    "\\b(?:about|around|roughly|just|in|give (?:me|it)|another|in about)\\s+(?:a|an|one|two|a couple of|a few)?\\s*(?:second|minute|hour)s?\\b",
    "\\b(?:a|one|two|a couple of|a few)\\s+(?:second|minute|hour)s?\\b",
    "\\b(?:shortly|momentarily|any (?:second|minute) now|in no time)\\b",
  ].join("|"),
  "i",
);

/** Pull every `say:` string literal out of a source file.
 *
 *  Empty literals are NOT sentences and are dropped. The `say:` pattern also
 *  matches the empty arm of a ternary — site-edit-status.js reads the row's own
 *  wording with `job.result.say : ""` — and counting that as a scanned sentence
 *  inflated the coverage floor below with something no caller can ever hear. */
function sayStrings(src) {
  const out = [];
  for (const m of src.matchAll(/\bsay:\s*(?:\n\s*)?("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g)) {
    let s = m[1].slice(1, -1);
    s = s.replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\'/g, "'");
    if (s.trim()) out.push(s);
  }
  // Ternary arms and || fallbacks put further quoted sentences on their own
  // lines; catch any bare string that reads like a spoken sentence to the
  // caller, so a new branch cannot slip a forecast past the scan.
  for (const m of src.matchAll(/^\s*(?:\?|:|\|\|)\s*("(?:[^"\\]|\\.)*")\s*$/gm)) {
    let s = m[1].slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, " ");
    if (/[.!?]/.test(s) && s.split(" ").length > 4) out.push(s);
  }
  return out;
}

test("no sentence Riley says about a pending change forecasts how long it will take", () => {
  const offenders = [];
  let scanned = 0;

  for (const file of FILES) {
    const src = fs.readFileSync(file, "utf8");
    for (const s of sayStrings(src)) {
      scanned += 1;
      if (ALLOWED.includes(s)) continue;
      const hit = s.match(FORECAST);
      if (hit) offenders.push(`  ${path.basename(file)}: "${s}"\n      forecast: "${hit[0]}"`);
    }
  }

  // Coverage floor: the scan has to still be FINDING the sentences, or the
  // green below means nothing. Five is what the voice edit path actually speaks
  // today, all of them in site-edit.js — the confirm prompts, the ownership
  // refusal and the fast-ack. It was written as 8, a number the path never had
  // once the fast-ack collapsed the terminal sentences into the status tool's
  // `return` literals; it only ever "passed" by counting an empty ternary arm.
  // If a sentence is deleted this trips; raise it when one is added.
  assert.ok(scanned >= 5, `only ${scanned} say-strings found — the scan is broken, not the code`);
  assert.deepStrictEqual(
    offenders, [],
    "These sentences promise the caller a duration the system has never measured:\n"
    + `${offenders.join("\n")}\n`
    + "Say what is known and what you will do instead. See the header of this file.",
  );
});

test("the dashboard's written status copy makes no forecast either", () => {
  const { FALLBACK } = require("../lib/customer-edits.js");
  assert.ok(FALLBACK && typeof FALLBACK === "object", "customer-edits must export its status copy for this to be checkable");
  const offenders = Object.entries(FALLBACK)
    .filter(([, sentence]) => FORECAST.test(String(sentence)))
    .map(([status, sentence]) => `  ${status}: "${sentence}"`);
  assert.deepStrictEqual(
    offenders, [],
    `The dashboard tells the customer how long to wait:\n${offenders.join("\n")}`,
  );
  // And the copy is not empty, or the check above passes vacuously.
  assert.ok(Object.keys(FALLBACK).length >= 5, "expected a sentence for every job status");
  assert.ok(String(STATUS_COPY).endsWith("customer-edits.js"));
});

test("the scan actually catches the sentence this test was written for", () => {
  // Negative control. If FORECAST ever stops matching the original defect, the
  // test above becomes a green light over the exact bug it exists to prevent.
  const originals = [
    "That's going on now — give me about a minute and it'll be live.",
    "Got it — that's building now. It usually lands in a minute or two, and I can check it before we hang up.",
    "Still working on it — should just be another minute or two.",
    "It'll be live in a couple of seconds.",
    "That'll be up shortly.",
  ];
  for (const s of originals) {
    assert.ok(FORECAST.test(s), `the forecast detector no longer catches: "${s}"`);
  }
  // And does not fire on honest reports of something that already happened,
  // or on the sentences that replaced them.
  const fine = [
    "Done — that's live on example.com. Give your page a refresh and you'll see it.",
    "That one's running now. Some go through quicker than others and I'd rather not guess at you — stay with me and I'll tell you the moment it's live.",
    "Got it — that's building now. I won't put a time on it, but I'll check where it's got to before we hang up.",
    "It's still running. I'm not going to guess at a time on you — give me a moment and I'll look again.",
    "That one didn't go through, and I'm not going to tell you it did.",
  ];
  for (const s of fine) {
    assert.ok(!FORECAST.test(s), `the detector is over-firing on an honest sentence: "${s}"`);
  }
});
