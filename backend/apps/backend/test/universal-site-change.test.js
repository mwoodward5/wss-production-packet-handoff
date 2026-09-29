"use strict";
// test/universal-site-change.test.js — contracts for the ONE site-change tool.
//
// These are not "does the happy path work" tests. Each one pins a failure this
// system has actually produced or would produce if the gate were removed:
// a truncated model reply reported as success, a fabricated claim published to
// a customer's live site, an edit reaching a file that is not the caller's.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const P = require("../lib/site-change-plan");
const { universalSiteChangeToolDefinition } = require("../api/admin/vapi-assistants");

// A stand-in for a real client's published facts: a plumber whose site says it
// has a 4.9 rating from 106 reviews, and says nothing about licensing, tenure,
// guarantees or price.
const FACTS = { businessName: "Flint Plumbing LLC", city: "Austin", state: "TX", phone: "(512) 971-2445" };
const EVIDENCE = [
  "Flint Plumbing LLC",
  "- Rating: 4.9 from 106 reviews",
  "Phone: (512) 971-2445",
  "Services in Austin, TX What customers say",
].join("\n");

const gate = (html) => P.assertSubstantiated(html, { evidence: EVIDENCE, facts: FACTS });
const refusal = (html) => {
  try { gate(html); } catch (error) { return error; }
  return null;
};

// ---------------------------------------------------------------------------
// TRUTH LAW
// ---------------------------------------------------------------------------
test("truth law: a rating the site already publishes may be surfaced", () => {
  assert.doesNotThrow(() => gate('<div class="r"><strong>4.9</strong> out of 5 &middot; 106 reviews</div>'));
});

test("truth law: a review count the site never published is refused", () => {
  const error = refusal("<div>4.9 out of 5 from 320 Google reviews</div>");
  assert.ok(error, "a fabricated review count must be refused");
  assert.equal(error.truthRefusal, true);
  assert.match(error.message, /320/);
});

test("truth law: licences, tenure, guarantees and prices are refused when unsourced", () => {
  for (const claim of [
    "<p>Licensed, bonded and insured.</p>",
    "<p>Over 20 years of experience.</p>",
    "<p>100% satisfaction guarantee.</p>",
    "<p>Drain cleaning from $89.</p>",
    "<p>Available 24/7 for emergency service.</p>",
    "<p>Voted number one plumber in Austin.</p>",
    "<p>Family-owned since 1985.</p>",
  ]) {
    const error = refusal(claim);
    assert.ok(error, `must refuse: ${claim}`);
    assert.equal(error.truthRefusal, true, `${claim} must be a refusal, not a crash`);
    assert.ok(String(error.say || "").length > 20, "a refusal must carry a sentence Riley can say");
  }
});

test("truth law: a phone number that is not the business's own is refused", () => {
  const error = refusal('<a href="tel:5125550000">(512) 555-0000</a>');
  assert.ok(error && error.truthRefusal);
  assert.doesNotThrow(() => gate('<a href="tel:5129712445">(512) 971-2445</a>'));
});

test("truth law: CSS cannot smuggle a claim past the gate", () => {
  // `content:` renders words on the page without a single HTML tag. If styling
  // were waved through as "not text", this is the hole it would open.
  const spoken = P.cssSpokenText('.badge::after { content: "Licensed & Insured"; }');
  const error = refusal(spoken);
  assert.ok(error && error.truthRefusal, "a claim inside CSS content must be refused");
});

test("truth law: single digits are structure, not claims", () => {
  // "out of 5" must not be refused as an unsourced figure, or the honest
  // rendering of a sourced rating becomes impossible.
  assert.doesNotThrow(() => gate("<p>4.9 out of 5</p>"));
});

// ---------------------------------------------------------------------------
// SCOPE
// ---------------------------------------------------------------------------
test("scope: only files in THIS client's own archive are writable", () => {
  const allowed = new Set(["index.html", "about.html", "llms.txt", "sitemap.xml"]);
  assert.equal(P.assertInScope("index.html", allowed), "index.html");
  for (const bad of [
    "../wss-test-other-client/index.html",
    "/etc/passwd",
    "lib/store.js",
    ".env",
    "assets/bundle.js",
    "",
  ]) {
    assert.throws(() => P.assertInScope(bad, allowed), /out of scope|names no file/, `must reject ${bad}`);
  }
});

test("scope: membership is against real keys, so traversal has nothing to defeat", () => {
  // The guard is not a "../" filter that a novel encoding could slip past — a
  // path is writable only if it is literally one of the keys this client's
  // archive listing returned.
  const allowed = new Set(["index.html"]);
  assert.throws(() => P.assertInScope("index.html/../../secrets.txt", allowed), /out of scope/);
  assert.throws(() => P.assertInScope("INDEX.HTML", allowed), /out of scope/);
});

// ---------------------------------------------------------------------------
// THE TRUNCATION REGRESSION
// ---------------------------------------------------------------------------
test("a truncated planner reply fails loudly instead of reporting no changes", () => {
  // This is the measured failure of the path this replaces: the model's reply
  // was cut off mid-file, the file regex matched nothing, and the job reported
  // a result while the live DOM was byte-identical.
  assert.throws(() => P.parsePlan('{"summary":"add a badge","ops":[{"op":"insert_html","anchor":"a29","html":"<div clas'), /unparseable|no JSON/);
});

test("a plan with no ops, or absurdly many, is rejected", () => {
  assert.throws(() => P.parsePlan('{"summary":"x","ops":[]}'), /no ops/);
  const many = JSON.stringify({ summary: "x", ops: Array.from({ length: P.PLAN_MAX_OPS + 1 }, () => ({ op: "style_override", css: "a{}" })) });
  assert.throws(() => P.parsePlan(many), /max/);
});

test("a planner refusal is a normal outcome, not an exception", () => {
  const plan = P.parsePlan('{"refusal":{"reason":"unbacked","say":"I can\'t add that unless it\'s something you can back up."}}');
  assert.equal(plan.ops.length, 0);
  assert.match(plan.refusal.say, /back up/);
});

// ---------------------------------------------------------------------------
// THE TRAILING-CONTENT REGRESSION (Family Heating, 2026-08-12: "add more blue")
//
// A valid plan object followed by ANY more content used to poison the parse:
// the old slice ran first-"{" to last-"}", so JSON.parse saw two values and
// threw "Unexpected non-whitespace character after JSON at position N". The
// planner emits this shape occasionally on every model; parsePlan now takes the
// first complete, brace-balanced object and ignores the rest.
// ---------------------------------------------------------------------------
test("a valid plan followed by a SECOND object parses the first, not an error", () => {
  const plan = P.parsePlan('{"summary":"more blue","ops":[{"op":"style_override","css":"a{color:blue}"}]}\n{"note":"ignore me"}');
  assert.equal(plan.summary, "more blue");
  assert.equal(plan.ops.length, 1);
});

test("a valid plan followed by trailing prose (with stray braces) still parses", () => {
  const plan = P.parsePlan('```json\n{"summary":"ok","ops":[{"op":"style_override","css":"h1{font-weight:800}"}]}\n```\nDone — anything else? {maybe}');
  assert.equal(plan.summary, "ok");
  assert.equal(plan.ops.length, 1);
});

test("a closing brace INSIDE a JSON string never ends the object early", () => {
  const plan = P.parsePlan('{"summary":"css is a{}","ops":[{"op":"style_override","css":".x{color:red}"}]}');
  assert.equal(plan.summary, "css is a{}");
  assert.equal(plan.ops[0].css, ".x{color:red}");
});

// ---------------------------------------------------------------------------
// ANCHORS — the model chooses WHERE, never spells the anchor
// ---------------------------------------------------------------------------
test("anchors: ambiguous headings are dropped rather than disambiguated", () => {
  const html = "<h2>Services</h2><p>a</p><h2>Services</h2><h2>What customers say</h2>";
  const anchors = P.buildAnchorCatalog({ "index.html": html });
  assert.deepEqual(anchors.map((a) => a.label), ["What customers say"]);
});

test("anchors: an id the catalog does not contain cannot be used", () => {
  const anchors = P.buildAnchorCatalog({ "index.html": "<h2>What customers say</h2>" });
  const byId = new Map(anchors.map((a) => [a.id, a]));
  assert.ok(byId.has("a1"));
  assert.equal(byId.get("hallucinated"), undefined);
});

test("apply: a non-unique anchor or find-string refuses instead of guessing", () => {
  assert.throws(
    () => P.applyInsertHtml("<h2>X</h2><h2>X</h2>", { exact: "<h2>X</h2>", position: "after", fragment: "<p>y</p>", jobId: "j" }),
    /occurs 2 times/
  );
  assert.throws(() => P.applyReplaceText("open 9-5", { find: "closed", replace: "open" }), /is not on that page/);
  assert.throws(() => P.applyReplaceText("a a", { find: "a", replace: "b" }), /appears 2 times/);
  assert.equal(P.applyReplaceText("open 9-5", { find: "9-5", replace: "8-6" }), "open 8-6");
});

test("apply: a style override is appended inside head and carries the job marker", () => {
  const out = P.applyStyleOverride("<html><head><title>t</title></head><body></body></html>", { css: ".a{color:red}", why: "test", jobId: "job1" });
  assert.match(out, /<!-- wss-edit job1 -->/);
  assert.ok(out.indexOf("wss-edit job1") < out.indexOf("</head>"), "the override must land inside <head>");
});

// ---------------------------------------------------------------------------
// WHAT RILEY SAYS
// ---------------------------------------------------------------------------
test("the spoken result is past tense, not a restated intention", () => {
  const say = P.spokenResult("I will add your Google rating of 4.9 from 106 reviews above the reviews section.");
  assert.ok(!/\bI will\b|\bWe will\b/i.test(say), `still an intention: ${say}`);
  assert.match(say, /^Done — add/);
  assert.match(say, /put it straight back/);
  assert.match(P.spokenResult("We will hide the banner."), /^Done — hide the banner\./);
  assert.match(P.spokenResult(""), /That's done/);
});

// ---------------------------------------------------------------------------
// THE TOOL SURFACE
// ---------------------------------------------------------------------------
test("one tool, carrying intent, pointed at the universal endpoint", () => {
  const def = universalSiteChangeToolDefinition({ GHOST_AGENCY_API_URL: "https://ghost.wss-ai.com", VAPI_WEBHOOK_SECRET: "s" });
  assert.equal(def.function.name, "request_site_change");
  assert.deepEqual(def.function.parameters.required, ["client_ref", "instruction"]);
  // CONTRACT CHANGED 2026-08-06, after call 019fd8d1. The confirming parameter
  // is the SIX-CHARACTER code, not the ~200-character signed token. Riley was
  // asked to echo the token on a live call, mangled the slug inside it twice,
  // and told the owner "the confirmation token system glitched on me" for an
  // edit that was authorised. A parameter a voice model cannot carry is not a
  // safety mechanism, so the schema must not offer him one.
  assert.ok("confirm_code" in def.function.parameters.properties);
  assert.ok(!("confirm_token" in def.function.parameters.properties));
  assert.equal(def.server.url, "https://ghost.wss-ai.com/api/vapi-tools/request-site-change");
  // The description is where the two-step confirmation and the refusal
  // behaviour are taught, because the persona's system prompt is not touched.
  assert.match(def.function.description, /confirm_code/);
  assert.match(def.function.description, /six-character/i);
  assert.match(def.function.description, /read (those|the).*back|read them back/i);
  assert.match(def.function.description, /back up/);
});

// CONTRACT CHANGED 2026-08-06, after a live customer call failed.
//
// This used to assert that a tool built with no secret configured simply
// carried `secret: undefined`. It did — and the endpoint answers
// 401 {"error":"unauthorized"} to an unauthenticated caller, so the tool was
// provisioned pre-broken. The owner rang his own line, read out his Client ID,
// and the transcript shows lookup_business_record returning "unauthorized"
// twice while Riley told him she couldn't find the account.
//
// The intent worth keeping is "never INVENT a secret". Refusing to build the
// tool keeps that intent and removes the failure mode: no silent, guaranteed-
// to-401 tool reaches a phone line.
test("a tool that could never authenticate is refused, not shipped", () => {
  assert.throws(
    () => universalSiteChangeToolDefinition({ GHOST_AGENCY_API_URL: "https://ghost.wss-ai.com" }),
    /vapi_tool_secret_unset/,
    "provisioning must fail loudly rather than emit a tool that 401s on every call",
  );
  // With a secret available it is carried through, from any of the accepted names.
  const def = universalSiteChangeToolDefinition({ GHOST_AGENCY_API_URL: "https://ghost.wss-ai.com", VAPI_TOOL_SECRET: "s1" });
  assert.equal(def.server.secret, "s1");
});

test("the universal endpoint is the SAME handler as site-edit, not a second copy", () => {
  // A parallel implementation is how one of two front doors ends up missing
  // the confirm-before-apply gate.
  assert.equal(require("../api/vapi-tools/request-site-change"), require("../api/vapi-tools/site-edit"));
});

test("the worker no longer reaches the whole-file editor that could not finish a file", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "run-edit-job.js"), "utf8");
  assert.ok(!/require\(["'][^"']*site-editor["']\)/.test(src), "run-edit-job must not import the whole-file editor");
  assert.match(src, /runSiteChange/);
});

test("a refusal is recorded as its own outcome, never as a completed change", () => {
  // The execution moved to lib/edit-job-runner.js so the admin endpoint, the
  // cron sweeper and Riley's post-queue kick share one implementation — the
  // refusal contract is asserted where the logic now lives, and the endpoint
  // is pinned to delegating there rather than growing a second copy.
  const runner = fs.readFileSync(path.join(__dirname, "..", "lib", "edit-job-runner.js"), "utf8");
  assert.match(runner, /applied === false/);
  assert.match(runner, /status: "refused"/);
  const endpoint = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "run-edit-job.js"), "utf8");
  assert.match(endpoint, /executeEditJob/);
});

// ---------------------------------------------------------------------------
// PERSONA
// ---------------------------------------------------------------------------
test("attaching the tool cannot rewrite the persona it is being added to", () => {
  const { additiveModelPatch } = require("../api/admin/vapi-assistants");
  const current = {
    model: {
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.7,
      messages: [{ role: "system", content: "[Identity] You are Riley…" }],
      toolIds: ["tool-a"],
    },
  };
  const built = additiveModelPatch(current, ["tool-new"]);
  assert.equal(built.ok, true);
  assert.equal(built.patch.model.provider, "openai");
  assert.equal(built.patch.model.model, "gpt-4.1-mini");
  assert.deepEqual(built.patch.model.messages, current.model.messages);
  assert.deepEqual(built.patch.model.toolIds, ["tool-a", "tool-new"]);
  // Nothing outside `model` is in the patch, so voice, transcriber,
  // startSpeakingPlan, stopSpeakingPlan and firstMessage cannot move.
  assert.deepEqual(Object.keys(built.patch), ["model"]);
  // An unreadable assistant is a refusal, not a partial patch that would wipe
  // her provider, model and system prompt.
  assert.equal(additiveModelPatch({}, ["tool-new"]).ok, false);
});

// ---------------------------------------------------------------------------
// THE ELEMENT CATALOG — added after the owner's live call 019fd91d
// ---------------------------------------------------------------------------
// A client asked Riley to make the hero more colorful, then to enlarge the logo
// and move it to the right. Both were REFUSED by the planner:
//     "Cannot select image"        "Cannot identify logo element"
// and Riley then asked the caller to supply an image and to "identify the
// element that represents your logo". The owner's verdict: "we're not that
// intelligent — you should understand our layman's terms."
//
// The planner was right that it could not see those elements: these mirrors are
// compiled apps whose index.html is an empty shell, and the catalog was built
// only from the editable text files. Everything a customer can see is created
// by the bundle under assets/ at runtime. So the catalog now scans the bundle
// READ-ONLY, and offers selectors verified against the live DOM.
const { buildElementCatalog, buildPlannerContext } = require("../lib/site-change-plan");

// Shaped like a real mirror: the shell says almost nothing, the bundle says it all.
const SHELL = '<!doctype html><html><head><meta property="og:image" content="/assets/client-logo.png"></head><body><div id="root"></div></body></html>';
const BUNDLE = 'e("header",{className:"fixed"},e("div",null,e("a",{href:"#top"},e("img",{src:"/assets/client-logo.png"}))),e("a",{href:"tel:4068557131"})),e("section",{id:"top"})';

test("the catalog reads the compiled bundle, not just the shell", () => {
  const shellOnly = buildElementCatalog({ "index.html": SHELL });
  const withBundle = buildElementCatalog({ "index.html": SHELL }, BUNDLE);
  // The hero and the header row exist only in the bundle. Without it the
  // planner is blind to them, which is precisely how it refused on the call.
  assert.ok(
    withBundle.length > shellOnly.length,
    "scanning the bundle must surface elements the shell cannot show",
  );
  const sels = withBundle.map((e) => e.selector).join("\n");
  assert.match(sels, /section#top/, "the hero must be offered");
  assert.match(sels, /client-logo/, "the logo must be offered");
  assert.match(sels, /tel:/, "phone links must be offered");
});

test("the logo's wrapper is offered without guessing its href", () => {
  // The planner invented `header a[href="/"]` for the logo link. On the live
  // Rimrock DOM that matches ZERO elements — the anchor is href="#top" — so
  // the edit applied cleanly, reported success and changed nothing visible.
  // A selector the planner cannot get wrong is the fix.
  const sels = buildElementCatalog({ "index.html": SHELL }, BUNDLE).map((e) => e.selector).join("\n");
  assert.match(sels, /a:has\(img\[src\*="client-logo"\]\)/, "offer the wrapper via :has, not via a guessed href");
  assert.doesNotMatch(sels, /href="\/"/, "never offer a guessed href");
});

test("no offered selector nests :has inside :has — that is invalid CSS", () => {
  // `header div:has(> a:has(img))` throws in querySelectorAll and would make
  // the whole style block inert. Verified in a real browser before this rule.
  for (const { selector } of buildElementCatalog({ "index.html": SHELL }, BUNDLE)) {
    for (const part of selector.split(",")) {
      const opens = (part.match(/:has\(/g) || []).length;
      assert.ok(opens <= 1, `nested :has() is invalid CSS: ${part.trim()}`);
    }
  }
});

test("a donor without a logo is never told it has one", () => {
  // Absence must stay absence — the catalog advertises only what it detected.
  const sels = buildElementCatalog({ "index.html": "<html><body>plain</body></html>" }, "no markup here").map((e) => e.selector).join("\n");
  assert.doesNotMatch(sels, /client-logo/);
  assert.doesNotMatch(sels, /section#top/);
});

test("the planner context tells the model these elements are runtime-only", () => {
  const ctx = buildPlannerContext({
    facts: { businessName: "Rimrock Plumbing" },
    rels: ["index.html"],
    anchors: [],
    elements: buildElementCatalog({ "index.html": SHELL }, BUNDLE),
  });
  assert.match(ctx, /PAGE ELEMENTS/);
  // Without this the model reads an empty index.html and concludes the page
  // has no logo, which is the refusal we are fixing.
  assert.match(ctx, /compiled app|runtime|RUNTIME/i);
  assert.match(ctx, /section#top/);
});
