"use strict";

// test/riley-email-shell.test.js — the contract for the shell Riley's outbound
// notes are rendered in (lib/riley-email-shell.js), and for the send path that
// uses it (api/vapi-tools/send-note.js).
//
// Four properties are worth a test here, and they are not aesthetic ones:
//
//   1. HER WORDS SURVIVE. A shell that reflowed, truncated or "tidied" the
//      answer would be editing what an AI told a human on a live call, after
//      the call. Every word she wrote has to come out the other side.
//   2. IT IS SAFE TO RENDER. The answer arrives from a language model that was
//      listening to a stranger. Markup in it must paint as text, not as markup.
//   3. NOTHING IS INVENTED. An unset callback number omits its line; an unset
//      postal address omits its segment. Neither may fall back to a literal —
//      that exact fallback mailed a retired agency number to strangers on
//      2026-07-30 (see lib/riley-line.js).
//   4. THE TWO HALVES AGREE. Text and HTML are one message rendered twice, and
//      the opt-out promise is the sentence they are least allowed to disagree
//      about. Both halves render it from lib/opt-out-promise.js.
//
// And one truth-law test: the shell may not assert capabilities Riley has not
// demonstrated, or a team, or credentials, or customer counts.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const shell = require("../lib/riley-email-shell");
const { renderRileyEmail, RILEY_DISCLOSURE } = shell;
const { OPT_OUT_PROMISE } = require("../lib/opt-out-promise");
const design = require("../lib/wss-email-design");

const CONFIGURED = Object.freeze({
  GHOST_AGENT_PHONE: "(555) 013-8420",
  GHOST_AGENCY_POSTAL_ADDRESS: "27758 Santa Margarita Pkwy #445, Mission Viejo, CA 92691",
});

const ANSWER = [
  "Happy to. I'm Riley — I'm the AI that WSS Labs put on your account.",
  "",
  "Here's what that means:",
  "",
  "- I answer this line.",
  "- I can pull your business record up while we're talking.",
  "",
  "Anything else you want to know, just ask.",
].join("\n");

const render = (over = {}) => renderRileyEmail({
  subject: "A bit about me",
  answer: ANSWER,
  recipientName: "Mark",
  env: CONFIGURED,
  ...over,
});

/** The character runs a browser would paint — markup removed, entities decoded. */
function visibleText(html) {
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&middot;/g, "·").replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 1. HER WORDS SURVIVE
// ---------------------------------------------------------------------------

test("every word of her answer reaches both halves", () => {
  const out = render();
  const painted = visibleText(out.html);
  for (const line of ANSWER.split("\n").map((l) => l.replace(/^-\s+/, "").trim()).filter(Boolean)) {
    assert.ok(painted.includes(line), `the HTML half dropped: ${line}`);
  }
  // The text half is not a summary of the note. It carries the answer verbatim,
  // newlines and bullet characters included.
  assert.ok(out.text.includes(ANSWER), "the text half must carry the answer byte for byte");
});

test("a blank-line-separated answer becomes paragraphs, and a marker list becomes a list", () => {
  const blocks = shell.blocksOf(ANSWER);
  assert.deepEqual(blocks.map((b) => b.kind), ["paragraph", "paragraph", "list", "paragraph"]);
  assert.deepEqual(blocks[2].items.map((i) => i.text), [
    "I answer this line.",
    "I can pull your business record up while we're talking.",
  ]);
  // An ordered marker is content — the number is the author's, so it is kept
  // exactly. Only the unordered glyph is restyled.
  assert.deepEqual(
    shell.blocksOf("1) first\n2) second")[0].items.map((i) => i.marker),
    ["1)", "2)"],
  );
  assert.deepEqual(shell.blocksOf("- a\n* b\n• c")[0].items.map((i) => i.marker), ["•", "•", "•"]);
});

test("a line that merely starts with a dash mid-paragraph is not silently turned into a list", () => {
  const blocks = shell.blocksOf("Here's the thing.\n- and this");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
  assert.ok(blocks[0].text.includes("- and this"), "the dash is her punctuation, so it stays");
});

test("the type ladder gives the note a hierarchy rather than one flat size", () => {
  const out = render();
  // Six distinct roles were the fix for "reads flat, like a PDF report". At
  // minimum the note must run an eyebrow, a headline, a lead and body copy at
  // four different sizes.
  const sizes = new Set([...out.html.matchAll(/font-size:([\d.]+)px/g)].map((m) => m[1]));
  assert.ok(sizes.size >= 4, `expected a real ladder, got sizes: ${[...sizes].join(",")}`);
  assert.ok(out.html.includes("font-size:30px"), "a short subject is set as the display headline");
  assert.equal(out.meta.headline, "display");
  // A long subject steps down instead of building a wall of headline on a phone.
  const long = render({ subject: "A few thoughts on what I can and cannot do for your website today" });
  assert.equal(long.meta.headline, "title");
  assert.ok(!long.html.includes("font-size:30px"));
});

test("an empty answer is a refusal, not an elegant blank card", () => {
  assert.throws(() => renderRileyEmail({ subject: "hi", answer: "   ", env: CONFIGURED }), /answer/);
});

// ---------------------------------------------------------------------------
// 2. IT IS SAFE TO RENDER
// ---------------------------------------------------------------------------

test("markup in her answer paints as text and cannot inject into the document", () => {
  const hostile = 'Try <script>alert(1)</script> and <img src=x onerror=alert(2)> and "quotes" & ampersands.';
  const out = renderRileyEmail({ subject: '<b>subject</b>', answer: hostile, env: CONFIGURED });
  // The assertion is about TAGS, not about the characters: "onerror=" as escaped
  // text is inert and a reader is entitled to see the words she actually wrote.
  // What must not exist is a tag the answer put there.
  const tags = [...out.html.matchAll(/<[^>]+>/g)].map((m) => m[0]);
  for (const tag of tags) {
    assert.ok(!/^<script/i.test(tag), `a script tag must never survive into the document: ${tag}`);
    assert.ok(!/\bon[a-z]+\s*=/i.test(tag), `an event handler must never survive into the document: ${tag}`);
    assert.ok(!/^<b>$/i.test(tag), "markup in the SUBJECT must be escaped too, not honoured");
  }
  // Exactly one image in the document, and it is our mark.
  const images = [...out.html.matchAll(/<img\b[^>]*>/gi)];
  assert.equal(images.length, 1);
  assert.ok(images[0][0].includes(design.WSS_MARK_URL));
  // And the reader still sees what she wrote.
  assert.ok(visibleText(out.html).includes("alert(1)"));
});

test("the mark is a hosted raster with explicit dimensions and alt text", () => {
  const img = render().html.match(/<img\b[^>]*>/i)[0];
  assert.match(img, /width="44"/, "a blocked image must still reserve its box");
  assert.match(img, /height="44"/);
  assert.match(img, /alt="WSS Labs"/, "with images off, the sender is still named");
  assert.match(img, /^<img src="https:\/\//, "hosted, because Gmail strips inline SVG");
});

test("the shell degrades legibly with images blocked — the sender is live text", () => {
  const painted = visibleText(render().html.replace(/<img\b[^>]*>/gi, ""));
  assert.ok(painted.includes("WSS Labs"), "the wordmark is text, not part of the image");
  assert.ok(painted.includes("Riley"));
});

// ---------------------------------------------------------------------------
// 3. NOTHING IS INVENTED
// ---------------------------------------------------------------------------

test("with no phone configured the callback line omits itself entirely", () => {
  const out = renderRileyEmail({ subject: "A bit about me", answer: ANSWER, env: {} });
  assert.equal(out.meta.phone, null);
  assert.ok(!/Call or text/i.test(out.html), "no phone means no CTA, not an empty one");
  assert.ok(!/Call or text/i.test(out.text));
  assert.ok(!/tel:/.test(out.html), "no dangling tel: href");
  // No digit sequence that could be read as a phone number anywhere in either half.
  assert.ok(!/\d{3}[.\s-]?\d{4}\b/.test(visibleText(out.html)), "a fallback number must not appear");
});

test("an unparseable phone is dropped rather than printed", () => {
  const out = renderRileyEmail({ subject: "s", answer: ANSWER, env: { GHOST_AGENT_PHONE: "call the office" } });
  assert.equal(out.meta.phone, null);
  assert.ok(!/call the office/i.test(out.html));
});

test("with no postal address the footer omits the segment instead of inventing one", () => {
  const out = renderRileyEmail({ subject: "s", answer: ANSWER, env: {} });
  assert.equal(out.meta.postal, null);
  // The footer still stands: identity and the opt-out promise are not optional.
  assert.ok(visibleText(out.html).includes("Woodward Software Systems"));
  assert.ok(visibleText(out.html).includes(OPT_OUT_PROMISE));
});

test("no recipient name means no greeting — never 'Hi there,'", () => {
  const out = renderRileyEmail({ subject: "s", answer: ANSWER, env: CONFIGURED });
  assert.equal(out.meta.hasGreeting, false);
  assert.ok(!/\bHi there\b/i.test(out.html));
  assert.ok(!/\bHi ,/.test(out.html), "an empty name must not weld a comma onto nothing");
  assert.ok(!/\n\n\n/.test(out.text), "an omitted segment must not open a hole in the text half");
});

// ---------------------------------------------------------------------------
// 4. THE TWO HALVES AGREE
// ---------------------------------------------------------------------------

test("both halves carry exactly one opt-out promise, and it is the shared constant", () => {
  const out = render();
  const htmlOptOut = visibleText(out.html).match(/Not interested\?[^]*?again\./);
  assert.ok(htmlOptOut, "the HTML half must carry the promise");
  assert.equal(htmlOptOut[0], OPT_OUT_PROMISE);
  assert.ok(out.text.includes(OPT_OUT_PROMISE), "the text half must carry the same promise");
  assert.equal((visibleText(out.html).match(/\bSTOP\b/g) || []).length, 1);
  assert.equal((out.text.match(/\bSTOP\b/g) || []).length, 1);
});

test("the promise is imported, never restated — one definition, system-wide", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "riley-email-shell.js"), "utf8");
  assert.match(source, /require\(["']\.\/opt-out-promise["']\)/);
  assert.ok(
    !source.includes(OPT_OUT_PROMISE),
    "the shell must render the promise from lib/opt-out-promise.js, not re-type it",
  );
});

test("the disclosure and the identity appear in BOTH halves", () => {
  const out = render();
  for (const half of [visibleText(out.html), out.text]) {
    assert.ok(half.includes(RILEY_DISCLOSURE), "a disclosure only one half carries is not a disclosure");
    assert.ok(half.includes("WSS Labs"));
    assert.ok(half.includes("Woodward Software Systems"));
    assert.ok(half.includes(CONFIGURED.GHOST_AGENCY_POSTAL_ADDRESS));
  }
});

// ---------------------------------------------------------------------------
// TRUTH LAW + BRAND
// ---------------------------------------------------------------------------

test("Riley is named as an AI and never as a human employee", () => {
  const painted = visibleText(render().html);
  assert.match(RILEY_DISCLOSURE, /\bAI\b/);
  assert.match(RILEY_DISCLOSURE, /not a person/i);
  assert.ok(painted.includes(RILEY_DISCLOSURE));
  // The shell's own copy must not describe her as staff. (Her answer is her own
  // and is not policed here — this asserts on the shell with a neutral answer.)
  const neutral = renderRileyEmail({ subject: "Note", answer: "Here are the two things we talked about.", env: CONFIGURED });
  const shellCopy = visibleText(neutral.html);
  for (const claim of [
    /\bour team\b/i, /\bmy team\b/i, /\bcertified\b/i, /\baward/i, /\bcolleague/i,
    /\btrusted by\b/i, /\bthousands\b/i, /\b\d+\+? (?:clients|customers|businesses)\b/i,
    /\bguarantee/i, /\baccount manager\b/i, /\bspecialist\b/i,
  ]) {
    assert.ok(!claim.test(shellCopy), `the shell must not claim: ${claim}`);
  }
});

test("the shell asserts no capability Riley has not demonstrated", () => {
  // Her edit EXECUTION is unproven. The shell describes who she is; it must not
  // promise what she will do to a website.
  const neutral = visibleText(renderRileyEmail({ subject: "Note", answer: "Two things.", env: CONFIGURED }).html);
  for (const claim of [
    /\bI(?:'ll| will) (?:build|rebuild|publish|deploy|launch)\b/i,
    /\bchanges? (?:are|is) live\b/i,
    /\bedits? (?:your|the) site\b/i,
    /\bdone while we talk\b/i,
    /\bunlimited edits\b/i,
  ]) {
    assert.ok(!claim.test(neutral), `the shell must not promise: ${claim}`);
  }
});

test("the look comes from the shared design module, not from invented literals", () => {
  const out = render();
  // Same palette, same mark, same card recipe as lib/outreach-email-v2.js — that
  // shared origin is what makes the two lanes read as one company.
  assert.ok(out.html.includes(design.PALETTE.page));
  assert.ok(out.html.includes(design.PALETTE.ink));
  assert.ok(out.html.includes(design.PALETTE.accent));
  assert.ok(out.html.includes(design.WSS_MARK_URL));
  assert.ok(out.html.includes(design.cardStyle()), "the raised card is the design module's, not a local restyle");
  // The design lock: three hexes may never appear in rendered email output.
  for (const hex of design.FORBIDDEN_HEX) {
    assert.ok(!new RegExp(hex, "i").test(out.html), `forbidden hex ${hex} rendered`);
  }
});

test("it is email HTML, not web HTML: tables and inline styles only", () => {
  const out = render();
  assert.ok(!/<style[\s>]/i.test(out.html), "Gmail deletes <style> blocks");
  assert.ok(!/\bclass=/i.test(out.html), "there is no stylesheet for a class to reference");
  assert.ok(!/position:\s*absolute/i.test(out.html), "Gmail drops position and the element reflows into the text");
  assert.ok(!/display:\s*(?:flex|grid)/i.test(out.html), "flex and grid do not survive Outlook");
  assert.ok(!/@media/i.test(out.html), "a media query Gmail ignores must never be load-bearing");
  assert.ok(!/<link\b/i.test(out.html), "no external CSS and no webfont link");
  assert.ok(!/https?:\/\/fonts\./i.test(out.html));
  assert.match(out.html, /max-width:600px/, "a fixed 600px container would scroll sideways on a phone");
  // Every layout table declares itself presentational for screen readers.
  const tables = [...out.html.matchAll(/<table\b[^>]*>/gi)];
  assert.ok(tables.length >= 3);
  for (const [tag] of tables) assert.match(tag, /role="presentation"/);
});

test("meta reports what the render actually decided", () => {
  const out = render();
  assert.equal(out.meta.phoneSource, "env:GHOST_AGENT_PHONE");
  assert.equal(out.meta.phone, "+15550138420");
  assert.equal(out.meta.postal, CONFIGURED.GHOST_AGENCY_POSTAL_ADDRESS);
  assert.equal(out.meta.hasGreeting, true);
  assert.equal(out.subject, "A bit about me");
});

// ---------------------------------------------------------------------------
// THE SEND PATH USES IT
// ---------------------------------------------------------------------------

const handlerPath = require.resolve("../api/vapi-tools/send-note.js");
const noteCorePath = require.resolve("../lib/riley-send-note-core");
const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");
const SECRET = "vapi-tool-secret-for-tests-0123456789";
const OWNER = "woodwardsoftware@gmail.com";

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    setHeader() {},
    end(chunk) { if (chunk) this.body += chunk; return this; },
  };
}

/** Load the handler with the mailer and the event store stubbed. */
async function withHandler(run) {
  const sends = [];
  const events = [];
  const saved = {
    email: require.cache[emailPath],
    store: require.cache[storePath],
    handler: require.cache[handlerPath],
    noteCore: require.cache[noteCorePath],
    secret: process.env.VAPI_TOOL_SECRET,
    hook: process.env.VAPI_WEBHOOK_SECRET,
    admin: process.env.GHOST_AGENCY_ADMIN_TOKEN,
    phone: process.env.GHOST_AGENT_PHONE,
    postal: process.env.GHOST_AGENCY_POSTAL_ADDRESS,
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENT_PHONE = CONFIGURED.GHOST_AGENT_PHONE;
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = CONFIGURED.GHOST_AGENCY_POSTAL_ADDRESS;

  require.cache[emailPath] = {
    id: emailPath, filename: emailPath, loaded: true,
    exports: { sendResendEmail: async (input) => { sends.push(input); return { mode: "sent", id: "re_test" }; } },
  };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: { recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; } },
  };
  delete require.cache[handlerPath];
  delete require.cache[noteCorePath];
  const handler = require(handlerPath);

  const call = async (args) => {
    const res = mockRes();
    await handler({ method: "POST", headers: { "x-vapi-secret": SECRET }, body: args, query: {} }, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };

  try {
    await run({ call, sends, events });
  } finally {
    delete require.cache[handlerPath];
    delete require.cache[noteCorePath];
    delete require.cache[emailPath];
    delete require.cache[storePath];
    if (saved.noteCore) require.cache[noteCorePath] = saved.noteCore;
    if (saved.email) require.cache[emailPath] = saved.email;
    if (saved.store) require.cache[storePath] = saved.store;
    if (saved.handler) require.cache[handlerPath] = saved.handler;
    for (const [key, value] of [
      ["VAPI_TOOL_SECRET", saved.secret], ["VAPI_WEBHOOK_SECRET", saved.hook],
      ["GHOST_AGENCY_ADMIN_TOKEN", saved.admin], ["GHOST_AGENT_PHONE", saved.phone],
      ["GHOST_AGENCY_POSTAL_ADDRESS", saved.postal],
    ]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("Riley's send-note tool mails the branded shell, not raw text", () => withHandler(async ({ call, sends }) => {
  const r = await call({ to: OWNER, subject: "A bit about me", body: ANSWER });
  assert.equal(r.json.sent, true);
  assert.equal(sends.length, 1);
  const { html, text } = sends[0];
  // The shell, not the old bare <div>.
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes(design.WSS_MARK_URL), "the masthead carries the real WSS mark");
  assert.ok(visibleText(html).includes(RILEY_DISCLOSURE), "the disclosure ships with every note");
  assert.ok(visibleText(html).includes(OPT_OUT_PROMISE), "the compliance footer ships with every note");
  assert.ok(visibleText(html).includes("Call or text Riley"), "a configured line is offered back to the caller");
  // Her words, intact, in both halves.
  assert.ok(text.includes(ANSWER));
  assert.ok(visibleText(html).includes("I answer this line."));
  // Provenance: the note exists because a call happened.
  assert.ok(visibleText(html).includes("Sent by Riley during a live call"));
}));

test("the caller's number reaches the note's provenance line, escaped", () => withHandler(async ({ call, sends }) => {
  await call({ to: OWNER, subject: "s", body: ANSWER, caller_phone: "+17146096275" });
  assert.ok(visibleText(sends[0].html).includes("live call with +17146096275"));
}));

test("the send log records whether the shell had a line and an address to render", () => withHandler(async ({ call, events }) => {
  await call({ to: OWNER, subject: "s", body: ANSWER });
  const logged = events.find((e) => e.name === "riley.note_sent");
  assert.equal(logged.payload.shell_phone_source, "env:GHOST_AGENT_PHONE");
  assert.equal(logged.payload.shell_has_postal, true);
}));

test("a refused note never reaches the shell or the mailer", () => withHandler(async ({ call, sends }) => {
  for (const args of [
    { to: "attacker@evil.example", subject: "s", body: ANSWER },
    { to: OWNER, subject: "s", body: "key sk-abcdefghijklmnopqrstuvwxyz012345" },
    { to: OWNER, subject: "", body: ANSWER },
  ]) {
    const r = await call(args);
    assert.equal(r.json.sent, false);
  }
  assert.equal(sends.length, 0);
}));
