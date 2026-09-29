"use strict";

// test/opt-out-parity.test.js — THE OPT-OUT PROMISE, LOCKED TO ONE DEFINITION.
//
// A cold email ships as multipart/alternative: one message, rendered twice. The
// recipient's client picks a half and shows it, and the recipient never learns
// the other half existed. So "how do I make this stop?" cannot be answered
// differently by the two halves — whichever one they are shown has to carry the
// same promise, in the same words.
//
// It did not. The sentence was a string literal in lib/email.js (the plain-text
// compliance footer) and a SECOND string literal in lib/outreach-email-v2.js
// (the proof-first HTML footer), with nothing in the code connecting them. The
// HTML one was dropped in the proof-first template rewrite, so real cold email
// went out whose text part said "Reply STOP and you won't hear from me again"
// and whose HTML part — the half most clients render — said nothing of the
// kind. Re-typing the sentence back into the HTML shell restored the words and
// left the defect: two literals, still unconnected, still free to drift.
//
// This suite locks the two properties that make the promise a promise:
//
//   1. PARITY      for a REAL composed cold email, the opt-out sentence in the
//                  text part and the opt-out sentence in the HTML part are
//                  byte-identical once HTML entities are decoded. Both halves
//                  of one actual message, not two components that resemble them.
//   2. ONE HOME    the sentence has exactly one definition in the backend
//                  source. A second copy anywhere in lib/, api/ or scripts/
//                  fails this suite, because a second copy is how the first
//                  divergence happened.
//
// The extraction below deliberately does NOT search for the sentence. It finds
// the opt-out line structurally — the one line of each rendered half that
// carries the STOP instruction — and only then compares the two. A test that
// grepped for the expected string would pass just as happily against an email
// that had lost it.
//
// No network, no provider call, no database. dryRun composes and sends nothing.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const { OPT_OUT_PROMISE } = require("../lib/opt-out-promise");

const BACKEND_ROOT = path.join(__dirname, "..");
const CONSTANT_MODULE = path.join("lib", "opt-out-promise.js");

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
}

afterEach(restoreEnvironment);

// ---------------------------------------------------------------------------
// A reader's eye, modelled independently.
//
// Not lib/mirror-engine/html-entities.js on purpose: the thing under test must
// not also be the thing that judges it. This is a small, explicit decoder for
// numeric, hex and the handful of named references an email footer can contain.
// ---------------------------------------------------------------------------
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

function decodeEntities(value) {
  return String(value).replace(
    /&(#\d{1,8}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, body) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
        ? NAMED_ENTITIES[body]
        : match;
    },
  );
}

/** The character runs a browser would paint, one entry per text node. */
function htmlTextChunks(html) {
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .split(/<[^>]*>/)
    .map((chunk) => decodeEntities(chunk).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The lines a plain-text reader would see. */
function textLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => decodeEntities(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * The opt-out instruction, located by what it DOES rather than by what it says:
 * the line that tells the reader the keyword. Exactly one line per rendered
 * half must carry it — zero means the half lost its promise (the original
 * defect), more than one means the reader is being given two instructions.
 */
function soleOptOutLine(lines, half) {
  const found = lines.filter((line) => /\bSTOP\b/.test(line));
  assert.equal(
    found.length,
    1,
    `the ${half} part must carry exactly one opt-out instruction, found ${found.length}: ${JSON.stringify(found)}`,
  );
  return found[0];
}

// ---------------------------------------------------------------------------
// A prospect the proof-first gate will actually compose for.
//
// Sequence 1 refuses to compose without a preview on an approved host that can
// be tied to this prospect, and a "before" shot recorded as captured from this
// prospect's own domain. Those gates are supplied here, not relaxed; they are
// asserted in test/security-contracts.test.js and
// test/before-image-identity.test.js.
// ---------------------------------------------------------------------------
function provableProspect() {
  return {
    prospect_id: "opt-out-parity-1",
    business_name: "Roofing Example",
    email: "roofing@example.org",
    city: "Irvine",
    industry: "roofing",
    preview_url: "https://roofing-example.wss-ai.com/",
    current_website: "https://roofing-example.example/",
    before_shot_source_url: "https://www.roofing-example.example/",
  };
}

async function composeColdEmail() {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  global.fetch = async () => {
    throw new Error("composing a dry-run email must not reach the network");
  };

  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: provableProspect(),
    sequence: 1,
    step: 1,
    dryRun: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

// ---------------------------------------------------------------------------
// 1. PARITY — the two halves of one real cold email
// ---------------------------------------------------------------------------

test("both MIME parts of a composed cold email carry a byte-identical opt-out promise", async () => {
  const composed = await composeColdEmail();

  // composedText is the exact string handed to the provider as the text part;
  // htmlPreview is the exact string handed to it as the HTML part.
  assert.equal(typeof composed.composedText, "string");
  assert.equal(typeof composed.htmlPreview, "string");

  const textOptOut = soleOptOutLine(textLines(composed.composedText), "text");
  const htmlOptOut = soleOptOutLine(htmlTextChunks(composed.htmlPreview), "HTML");

  // THE ASSERTION. Same message, same promise, character for character.
  assert.equal(
    htmlOptOut,
    textOptOut,
    "the HTML and text parts of one cold email give the reader different opt-out instructions",
  );
  assert.deepEqual(
    Buffer.from(htmlOptOut, "utf8"),
    Buffer.from(textOptOut, "utf8"),
    "opt-out instructions differ at the byte level after entity decoding",
  );

  // Both resolve to the shared constant — so parity cannot be achieved by the
  // two halves drifting together into some third wording.
  assert.equal(textOptOut, OPT_OUT_PROMISE);
  assert.equal(htmlOptOut, OPT_OUT_PROMISE);

  // And the promise still promises. An emptied constant would make the two
  // halves trivially equal; it would not survive this.
  assert.match(OPT_OUT_PROMISE, /\bReply STOP\b/);
  assert.match(OPT_OUT_PROMISE, /won't hear from me again/);
  assert.equal(
    OPT_OUT_PROMISE,
    "Not interested? Reply STOP and you won't hear from me again.",
  );
});

test("the HTML part encodes the promise so it decodes back to the text part exactly", async () => {
  const composed = await composeColdEmail();

  // The HTML half is allowed to escape — it is markup — but every entity it
  // emits has to resolve to the same characters the text half shipped raw. The
  // apostrophe in "won't" is the one that matters today.
  const rawHtmlParagraph = composed.htmlPreview.match(/<p[^>]*>([^<]*\bSTOP\b[^<]*)<\/p>/);
  assert.ok(rawHtmlParagraph, "the HTML footer must render the promise as its own paragraph");
  assert.equal(decodeEntities(rawHtmlParagraph[1]).trim(), OPT_OUT_PROMISE);
  assert.doesNotMatch(
    rawHtmlParagraph[1],
    /&(?!(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);)/,
    "an unterminated or unknown entity would paint as literal ampersand text",
  );
});

// ---------------------------------------------------------------------------
// 2. ONE HOME — the constant is the only definition
// ---------------------------------------------------------------------------

function productionSourceFiles() {
  const roots = ["lib", "api", "scripts"].map((dir) => path.join(BACKEND_ROOT, dir));
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(?:js|mjs|cjs|json|html)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  };
  roots.forEach(walk);
  return files;
}

// Tests are excluded on purpose: quoting the promise verbatim is exactly what a
// test of the promise is for, and this file does it three times above. What
// must not exist twice is a DEFINITION that something renders from.
test("the opt-out promise has exactly one definition in the backend source", () => {
  const offenders = [];
  for (const file of productionSourceFiles()) {
    const relative = path.relative(BACKEND_ROOT, file);
    if (relative === CONSTANT_MODULE) continue;
    const source = fs.readFileSync(file, "utf8");
    // Decoded as well as raw, so an entity-encoded re-typing of the sentence in
    // a template ("won&#39;t") is caught as the second definition it is.
    if (source.includes(OPT_OUT_PROMISE) || decodeEntities(source).includes(OPT_OUT_PROMISE)) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the opt-out promise is written out in these files instead of imported from lib/opt-out-promise.js — "
    + "duplicating it is how the HTML and text halves drifted apart in the first place",
  );

  const home = fs.readFileSync(path.join(BACKEND_ROOT, CONSTANT_MODULE), "utf8");
  const occurrences = home.split(OPT_OUT_PROMISE).length - 1;
  assert.equal(occurrences, 1, "the constant module itself must state the promise exactly once");
});

test("every renderer of the promise imports it rather than restating it", () => {
  for (const relative of [
    path.join("lib", "email.js"),                  // plain-text compliance footer
    path.join("lib", "outreach-email-v2.js"),      // proof-first HTML footer
    path.join("lib", "supervised-held-drafts.js"), // supervised review draft
  ]) {
    const source = fs.readFileSync(path.join(BACKEND_ROOT, relative), "utf8");
    assert.match(
      source,
      /require\(["']\.\/opt-out-promise["']\)/,
      `${relative} renders the opt-out promise and must import it from lib/opt-out-promise.js`,
    );
  }
});
