"use strict";
// test/edit-lands-or-says-so.test.js
//
// THE FAILURE THESE PIN. Production job edit_1786235976776_etudr8: a customer
// asked, through the dashboard chat, to "make the main headline text bright
// orange". The job finished status=done, applied=true, selectors=["section#top"],
// and the panel told them "Done — it's live on your site now."
//
// The rendered page said otherwise:
//   section#top  color = rgb(255,102,0)            the CSS applied
//   h1           color = oklch(0.96 0.032 270.5)   UNCHANGED
//   h1 class     = "... text-bone ..."             a utility class wins
//
// Every gate passed honestly — the plan was valid, the selector was in the
// catalog, the bytes changed, the deploy went READY — because none of those
// facts is "the customer can see it". These tests hold two lines:
//
//   1. the planner is now able to NAME the headline, so it need not aim at the
//      section around it;
//   2. an edit that cannot be proved on the rendered page CANNOT report success,
//      no matter which door the customer came through.

const test = require("node:test");
const assert = require("node:assert/strict");

const V = require("../lib/edit-verify");
const P = require("../lib/site-change-plan");
const { executeEditJob } = require("../lib/edit-job-runner");

// ---------------------------------------------------------------------------
// Reading the plan's own claim back out of the CSS it wrote
// ---------------------------------------------------------------------------
test("declaredIntents: one intent per selector branch per declaration", () => {
  const intents = V.declaredIntents([
    { selector: "h1, h2", declarations: "color: #ff6600; font-weight: 800" },
  ]);
  assert.equal(intents.length, 4);
  assert.deepEqual(
    intents.map((i) => `${i.selector}|${i.property}|${i.value}`).sort(),
    ["h1|color|#ff6600", "h1|font-weight|800", "h2|color|#ff6600", "h2|font-weight|800"],
  );
});

test("declaredIntents: values carrying commas and parens survive intact", () => {
  const intents = V.declaredIntents([
    { selector: 'header img[src*="client-logo"]', declarations: "filter: drop-shadow(0 2px 4px rgba(0,0,0,.4)); height: 96px !important" },
  ]);
  assert.equal(intents.length, 2);
  assert.equal(intents[0].value, "drop-shadow(0 2px 4px rgba(0,0,0,.4))");
  assert.equal(intents[1].value, "96px");
  assert.equal(intents[1].important, true);
  // The selector carries a comma INSIDE brackets and must not be split on it.
  assert.equal(intents[0].selector, 'header img[src*="client-logo"]');
});

test("declaredIntents: inherited text properties are flagged, layout ones are not", () => {
  const flag = (decl) => V.declaredIntents([{ selector: "section#top", declarations: decl }])[0].inherited;
  assert.equal(flag("color: #ff6600"), true, "colour inherits — an ancestor rule can silently lose");
  assert.equal(flag("font-size: 40px"), true);
  assert.equal(flag("letter-spacing: 2px"), true);
  assert.equal(flag("background-color: #ff6600"), false, "background does not inherit; the container is the right target");
  assert.equal(flag("filter: saturate(1.4)"), false);
});

// ---------------------------------------------------------------------------
// THE VERDICT — three endings, and only one may be spoken as "it's live"
// ---------------------------------------------------------------------------
test("a selector that matched nothing is NOT a success", () => {
  const verdict = V.summarizeVerification({
    ok: true,
    checks: [{ selector: 'header a[href="/"]', property: "margin-left", value: "auto", matched: 0, took: 0, verdict: "selector_matched_nothing" }],
    textChecks: [],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "not_landed");
  assert.equal(verdict.reason, "selector_matched_nothing");
});

test("THE MEASURED CASE: colour set on the hero, headline unchanged, is NOT a success", () => {
  // Exactly what the live page reported for job edit_1786235976776_etudr8.
  const verdict = V.summarizeVerification({
    ok: true,
    markerPresent: true,
    checks: [{
      selector: "section#top",
      property: "color",
      value: "#ff6600",
      inherited: true,
      matched: 1,
      leaves: 9,
      took: 0,
      want: "rgb(255, 102, 0)",
      got: "rgb(255, 102, 0)",
      verdict: "did_not_take",
      blockers: [{ el: "h1.font-display.font-black.text-bone", got: "oklch(0.96 0.032 270.5)", text: "Plumbing in Parkville." }],
    }],
    textChecks: [],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "not_landed");
  // The section's OWN colour did change — got === want — and that is precisely
  // the fact the old path mistook for success. The verdict must not.
  assert.equal(verdict.detail.got, verdict.detail.want);
  assert.match(verdict.detail.blockers[0].el, /text-bone/);
});

test("a change on the element itself, computing on the page, IS a success", () => {
  const verdict = V.summarizeVerification({
    ok: true,
    markerPresent: true,
    checks: [{ selector: "h1", property: "color", value: "#ff6600", inherited: true, matched: 1, leaves: 1, took: 1, want: "rgb(255, 102, 0)", got: "rgb(255, 102, 0)", verdict: "took", blockers: [] }],
    textChecks: [{ kind: "replace_copy", expected: "Done right.", found: true }],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, "landed");
});

test("a partly-applied inherited change is not reported as done", () => {
  const verdict = V.summarizeVerification({
    ok: true,
    markerPresent: true,
    checks: [{ selector: "section#top", property: "color", value: "#ff6600", inherited: true, matched: 1, leaves: 6, took: 2, verdict: "partly_took", blockers: [] }],
    textChecks: [],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "not_landed");
});

test("wording that never appears on the rendered page is unconfirmed, not claimed", () => {
  const verdict = V.summarizeVerification({
    ok: true,
    markerPresent: null,
    checks: [],
    textChecks: [{ kind: "replace_copy", expected: "Serving Parkville since forever", found: false }],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "unconfirmed");
});

test("an unreadable page is unconfirmed — never a success, never a false failure", () => {
  for (const measurement of [
    { ok: false, reason: "chromium_launch_failed: no binary" },
    { ok: false, reason: "http_404" },
    null,
  ]) {
    const verdict = V.summarizeVerification(measurement);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.status, "unconfirmed", "an eye we could not open is not evidence of a broken edit");
  }
});

test("old bytes at the edge are a retry, not a verdict about the edit", () => {
  const verdict = V.summarizeVerification({
    ok: true,
    markerPresent: false,
    checks: [{ selector: "h1", property: "color", value: "#ff6600", matched: 1, took: 0, verdict: "did_not_take", blockers: [] }],
    textChecks: [],
  });
  assert.equal(verdict.status, "unconfirmed");
  assert.notEqual(verdict.status, "not_landed", "a page still serving the previous deploy must not condemn the edit");
});

// ---------------------------------------------------------------------------
// THE DECISION RULE ITSELF, ON THE REAL HEADLINE'S SHAPE
// ---------------------------------------------------------------------------
// measureInPage runs inside chromium, so it is driven here against a DOM stub
// shaped like the live mirror's actual headline. That markup is the reason the
// rule is "most of the words it governs" rather than "all" or "any":
//
//   <h1>                                        <- the rule's target
//     <span class="block …">Plumbing in Parkville.</span>   inherits
//     <span class="shimmer-text">Done</span>                transparent by design
//     <span class="bg-gold">right.</span>                   dark-on-gold by design
//   </h1>
//
// h1{color:#ff6600} turns the headline orange and leaves two deliberately
// styled words alone. That is the change WORKING.
const ORANGE = "rgb(255, 102, 0)";
const BONE = "oklch(0.96 0.032 270.5)";

function el({ tag, cls = "", id = "", text = "", computed = {}, children = [] }) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: cls,
    id,
    children,
    _computed: { ...computed },
    _inline: null,
    getClientRects: () => [{}],
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute() { node._inline = null; },
  };
  node.style = {
    setProperty(prop, value) {
      // A browser silently drops a value it cannot parse; so does this.
      const ok = prop === "color" ? /^(#|rgb|oklch|transparent$)/.test(value) : String(value).trim() !== "";
      node._inline = ok ? { prop, value } : null;
    },
    getPropertyValue(prop) { return node._inline && node._inline.prop === prop ? node._inline.value : ""; },
  };
  node.childNodes = [...(text ? [{ nodeType: 3, textContent: text }] : []), ...children];
  Object.defineProperty(node, "textContent", {
    get: () => text + children.map((c) => c.textContent).join(""),
  });
  return node;
}

function runMeasure({ intents = [], texts = [], match, bodyText = "", title = "", html = "" }) {
  const computedOf = (node, prop) => {
    if (node._inline && node._inline.prop === prop) {
      const v = node._inline.value;
      return v === "#ff6600" ? ORANGE : v;
    }
    return node._computed[prop] || "";
  };
  const saved = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = {
    querySelectorAll: (sel) => match[sel] || [],
    title,
    body: { innerText: bodyText },
    documentElement: { outerHTML: html },
  };
  globalThis.getComputedStyle = (node) => ({ getPropertyValue: (prop) => computedOf(node, prop) });
  try {
    return V.measureInPage({
      intents, texts, marker: null, maxElements: 12, maxLeaves: 80, maxBlockers: 4, textInherited: [...V.TEXT_INHERITED],
    });
  } finally {
    globalThis.document = saved.document;
    globalThis.getComputedStyle = saved.getComputedStyle;
  }
}

const headline = (mainColour) => el({
  tag: "h1",
  cls: "font-display text-bone",
  computed: { color: mainColour },
  children: [
    el({ tag: "span", cls: "block", text: "Plumbing in Parkville.", computed: { color: mainColour } }),
    el({ tag: "span", cls: "shimmer-text", text: "Done", computed: { color: "rgba(0, 0, 0, 0)" } }),
    el({ tag: "span", cls: "bg-gold", text: "right.", computed: { color: "oklab(0.12 0 -0.03)" } }),
  ],
});

test("the rule lands the headline change even though two styled words keep their look", () => {
  const out = runMeasure({
    intents: V.declaredIntents([{ selector: "h1", declarations: "color: #ff6600" }]),
    match: { h1: [headline(ORANGE)] },
  });
  const check = out.checks[0];
  assert.equal(check.verdict, "took", "22 of 32 characters turned orange — that is the change working");
  assert.equal(check.leaves, 3);
  assert.equal(check.tookChars, "Plumbing in Parkville.".length);
  assert.equal(V.summarizeVerification({ ok: true, ...out }).ok, true);
  // The two it did not reach are still recorded, so an operator can see them.
  assert.equal(check.blockers.length, 2);
  assert.match(check.blockers[0].el, /shimmer/);
});

test("the same rule, with the headline text NOT turning orange, is caught", () => {
  const out = runMeasure({
    // The section took the colour; nothing a reader looks at did. This is the
    // production job, in miniature.
    intents: V.declaredIntents([{ selector: "section#top", declarations: "color: #ff6600" }]),
    match: { "section#top": [el({ tag: "section", id: "top", computed: { color: ORANGE }, children: [headline(BONE)] })] },
  });
  const check = out.checks[0];
  assert.equal(check.got, ORANGE, "the element the rule named really did change");
  assert.equal(check.tookChars, 0, "and not one character of text followed it");
  assert.equal(check.verdict, "did_not_take");
  assert.equal(V.summarizeVerification({ ok: true, ...out }).status, "not_landed");
});

test("a single unstyled word is not enough to wave a headline through", () => {
  // The 'any leaf took' rule would pass this: an eyebrow with no colour class of
  // its own inherits the new colour while the whole headline stays put.
  const hero = el({
    tag: "section",
    id: "top",
    computed: { color: ORANGE },
    children: [
      el({ tag: "span", cls: "eyebrow", text: "MO", computed: { color: ORANGE } }),
      headline(BONE),
    ],
  });
  const out = runMeasure({
    intents: V.declaredIntents([{ selector: "section#top", declarations: "color: #ff6600" }]),
    match: { "section#top": [hero] },
  });
  assert.equal(out.checks[0].took, 1, "exactly one run of text took it");
  assert.equal(out.checks[0].verdict, "partly_took", "2 characters out of 34 is not the change they asked for");
  assert.equal(V.summarizeVerification({ ok: true, ...out }).status, "not_landed");
});

test("a value the browser refuses is never measured as a match", () => {
  const out = runMeasure({
    intents: V.declaredIntents([{ selector: "h1", declarations: "color: bright-orange" }]),
    match: { h1: [headline(BONE)] },
  });
  // Without the accepted-check this reads the page's own colour back as `want`
  // and compares it against itself — a guaranteed false pass.
  assert.equal(out.checks[0].verdict, "invalid_value");
});

test("a non-inherited property is judged on the element, not on the words", () => {
  const out = runMeasure({
    intents: V.declaredIntents([{ selector: "section#top", declarations: "filter: saturate(1.6)" }]),
    match: { "section#top": [el({ tag: "section", id: "top", computed: { filter: "saturate(1.6)" }, children: [headline(BONE)] })] },
  });
  assert.equal(out.checks[0].verdict, "took", "a filter on the hero is a change to the hero and nothing else");
  assert.equal(out.checks[0].leaves, undefined);
});

test("new wording is looked for in what the page actually renders", () => {
  const out = runMeasure({
    texts: [{ kind: "replace_copy", expected: "Done right." }, { kind: "replace_copy", expected: "Never said this" }],
    match: {},
    bodyText: "PLUMBING IN PARKVILLE.  DONE  RIGHT.",
    title: "Poor John's Plumbing",
  });
  // Case and whitespace are the page's business (text-transform is CSS), so the
  // comparison is normalised rather than literal.
  assert.equal(out.textChecks[0].found, true);
  assert.equal(out.textChecks[1].found, false);
});

// ---------------------------------------------------------------------------
// THE SENTENCES
// ---------------------------------------------------------------------------
test("no verdict but 'landed' may ever say the change is live on the site", () => {
  const forbidden = /live on (your|the) site|it's live|give (your|the) page a refresh/i;
  for (const [status, reverted] of [["not_landed", true], ["not_landed", false], ["not_landed", null], ["unconfirmed", null]]) {
    const say = V.sayForVerdict({ status }, { reverted });
    assert.doesNotMatch(say, forbidden, `${status}/${reverted} must not claim the change is live: ${say}`);
    assert.ok(say.length > 40, "a failure still owes the customer a real sentence");
  }
});

test("'nothing on your site changed' is said only when the rollback is confirmed", () => {
  const claim = /nothing on your site has changed/i;
  assert.match(V.sayForVerdict({ status: "not_landed" }, { reverted: true }), claim);
  assert.doesNotMatch(V.sayForVerdict({ status: "not_landed" }, { reverted: false }), claim);
  assert.doesNotMatch(V.sayForVerdict({ status: "not_landed" }, { reverted: null }), claim);
  assert.doesNotMatch(V.sayForVerdict({ status: "unconfirmed" }, { reverted: null }), claim);
});

// ---------------------------------------------------------------------------
// THE PLANNER CAN NOW NAME THE HEADLINE
// ---------------------------------------------------------------------------
test("the element catalog offers the headline itself, not only the section around it", () => {
  // A compiled React bundle of the shape these mirrors ship.
  const bundle = 'u.jsx("h1",{className:"font-display font-black text-bone",children:t.headline})'
    + 'u.jsxs("h2",{className:"font-display"})u.jsx("p",{className:"mt-4"})'
    + 'u.jsx("img",{src:"/assets/client-logo.png"})id:"top"href:"tel:8164555420"';
  const elements = P.buildElementCatalog({ "index.html": "<html></html>" }, bundle);
  const selectors = elements.map((e) => e.selector);

  assert.ok(selectors.includes("h1"), "there must be a target for the MAIN HEADLINE");
  assert.ok(selectors.includes("h2"), "and for the section headings");
  assert.ok(selectors.includes("p"), "and for the body paragraphs");
  assert.ok(selectors.includes("section#top"), "the hero stays offered — backgrounds and filters belong on it");

  const headline = elements.find((e) => e.selector === "h1");
  assert.match(headline.note, /headline/i);
  // The note has to carry the reason, or the next planner makes the same call.
  assert.match(headline.note, /inherit/i);
  assert.ok(headline.evidence, "every offered element names the bytes that proved it exists");
});

test("a bare element selector for the headline is accepted by the CSS gate", () => {
  const elements = P.buildElementCatalog({}, 'u.jsx("h1",{})id:"top"');
  // This is the rule the fix depends on being writable at all.
  const checked = P.validateOverrideCss("h1 { color: #ff6600; }", { elements, assets: [] });
  assert.deepEqual(checked.selectors, ["h1"]);
  const intents = V.declaredIntents(checked.rules);
  assert.equal(intents[0].property, "color");
  assert.equal(intents[0].inherited, true);
});

test("the planner is told, in the contract, to put text properties on the text", () => {
  assert.match(P.PLAN_CONTRACT, /INHERITED/);
  assert.match(P.PLAN_CONTRACT, /h1/);
  // And that the page gets rendered afterwards, so aiming wrong now costs the
  // change rather than passing as success.
  assert.match(P.PLAN_CONTRACT, /RENDERED/);
});

// ---------------------------------------------------------------------------
// THE GUARANTEE: A NON-LANDING EDIT CANNOT REPORT SUCCESS
// ---------------------------------------------------------------------------
function jobStore({ jobId, siteSlug = "wss-test-site", instruction = "Make the main headline text bright orange." }) {
  const rows = [{ job_id: jobId, site_slug: siteSlug, instruction, status: "queued", result: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
  const events = [];
  return {
    rows,
    events,
    select: async () => ({ ok: true, data: [rows[0]] }),
    upsertRow: async (_table, row) => { rows[0] = { ...rows[0], ...row }; return { mode: "live_write" }; },
    recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
    resolveSiteEditTarget: async () => ({ projectName: "p", aliasHost: "h.wss-ai.com" }),
    notifyOwner: async () => null,
  };
}

test("GUARANTEE: an edit whose rule did not take reaches `failed`, not `done`", async () => {
  const store = jobStore({ jobId: "edit_not_landed" });
  const out = await executeEditJob("edit_not_landed", {
    ...store,
    runSiteChange: async () => ({
      applied: true,
      via: "plan",
      changedFiles: ["index.html"],
      reverted: true,
      say: V.sayForVerdict({ status: "not_landed" }, { reverted: true }),
      verified: { ok: false, status: "not_landed", reason: "did_not_take", detail: { selector: "section#top", property: "color" } },
    }),
  });

  assert.equal(out.status, "failed", "applied:true is not landed:true");
  assert.equal(out.notLanded, true);
  assert.equal(store.rows[0].status, "failed", "the stored row must not say done");
  assert.doesNotMatch(String(store.rows[0].result.say), /live on your site/i);
  assert.ok(store.events.some((e) => e.name === "ghost_agency_site_edit_not_landed"), "the ending is recorded under its own name");
});

test("GUARANTEE: an edit that could not be confirmed also fails closed", async () => {
  const store = jobStore({ jobId: "edit_unconfirmed" });
  const out = await executeEditJob("edit_unconfirmed", {
    ...store,
    runSiteChange: async () => ({
      applied: true,
      changedFiles: ["index.html"],
      reverted: null,
      say: V.sayForVerdict({ status: "unconfirmed" }, { reverted: null }),
      verified: { ok: false, status: "unconfirmed", reason: "chromium_launch_failed", detail: null },
    }),
  });
  assert.equal(out.status, "failed");
  assert.doesNotMatch(String(store.rows[0].result.say), /live on your site/i);
});

test("a verified edit still reaches `done` and still says so", async () => {
  const store = jobStore({ jobId: "edit_landed" });
  const out = await executeEditJob("edit_landed", {
    ...store,
    runSiteChange: async () => ({
      applied: true,
      changedFiles: ["index.html"],
      say: "Done — the headline is bright orange. It's live on your site now, and I can put it straight back if it isn't right.",
      verified: { ok: true, status: "landed", checks: [{ selector: "h1", verdict: "took" }] },
    }),
  });
  assert.equal(out.status, "done");
  assert.equal(store.rows[0].status, "done");
  assert.match(String(store.rows[0].result.say), /live on your site/i);
});

test("the customer's panel prints the failure sentence, not the generic one", () => {
  const { describeEditJob, FALLBACK } = require("../lib/customer-edits");
  const say = V.sayForVerdict({ status: "not_landed" }, { reverted: false });
  const shown = describeEditJob({
    job_id: "j", site_slug: "s", instruction: "Make the main headline text bright orange.",
    status: "failed", result: { not_landed: true, say },
  });
  assert.equal(shown.say, say);
  assert.notEqual(shown.say, FALLBACK.failed);
  // FALLBACK.failed asserts the site is untouched; a deployed-then-not-landed
  // job has no right to that claim, so it must never be the sentence shown.
  assert.doesNotMatch(shown.say, /nothing on your site changed/i);
});

test("a not-landed row with no sentence still refuses to claim the site is untouched", () => {
  const { describeEditJob } = require("../lib/customer-edits");
  const shown = describeEditJob({ job_id: "j", status: "failed", result: { not_landed: true } });
  assert.doesNotMatch(shown.say, /nothing on your site changed/i);
});

// ---------------------------------------------------------------------------
// RILEY SHARES THIS ENGINE, SO RILEY SHARES THE HOLE
// ---------------------------------------------------------------------------
test("Riley's tool answers a failed run as finished, never as 'still building'", () => {
  // Before the fast-ack, every terminal state except done/refused fell through
  // to a queued branch inside site-edit.js itself, so a job that had already
  // FAILED was spoken as "that's building now". The fast-ack moved every
  // terminal sentence to the status tool — so the guarantee is now TWO-sided:
  // the edit tool answers exactly one way (queued, honestly), and the status
  // tool reads the row's real state and never dresses a corpse as a build.
  const fs = require("node:fs");
  const path = require("node:path");
  // These branches live in the tool cores; the routes are transport shells
  // over them (see api/vapi-tools/riley.js).
  const edit = fs.readFileSync(path.join(__dirname, "..", "lib", "site-edit-core.js"), "utf8");
  const status = fs.readFileSync(path.join(__dirname, "..", "lib", "edit-status-core.js"), "utf8");

  // The edit tool has ONE answer for a confirmed request — the fast-ack — and
  // it claims nothing about an outcome it cannot know yet.
  assert.ok(edit.includes("status: \"queued\""), "the confirmed answer is queued, and only queued");
  assert.doesNotMatch(edit, /runNow/, "no inline run means no branch that can mislabel its ending");

  // The status tool carries an explicit failed sentence, chosen from the row's
  // own status — and a failed row can never fall into a still-running line.
  //
  // These read the BEHAVIOUR of that branch rather than one byte string. The
  // wording has already been rewritten once (the fast-ack pass re-spaced the
  // whole file and replaced "That one didn't go through" with the current
  // sentence) and a test pinned to the old prose fails on a rename while a real
  // regression — a failed row spoken as still building — would sail through.
  const failedAt = status.search(/job\.status\s*===\s*"failed"/);
  assert.ok(failedAt > 0, "the failed sentence must be keyed off the row's own failed status");

  // The sentence that branch speaks is the literal it returns.
  const failedSay = /return\s*"([^"]+)"/.exec(status.slice(failedAt));
  assert.ok(failedSay, "the failed branch must answer with a spoken sentence");
  const failedSentence = failedSay[1];

  // It says the run ENDED…
  assert.match(failedSentence, /didn't complete|didn't go through|did not complete|failed/i,
    "the failed sentence must say the change ended without landing");
  // …it never dresses a corpse as a build…
  assert.doesNotMatch(failedSentence, /still running|still building|building now|in progress|working on it|any (?:minute|moment) now/i,
    "a failed row must never be spoken as work still in flight");
  // …and it does not claim the change worked. (Only affirmative success
  // phrasing is barred here: the current sentence contains the words "it
  // worked" inside "I won't claim it worked", which is the opposite promise.)
  assert.doesNotMatch(failedSentence, /is live|all set|you'll see it|refresh the site/i,
    "a failed row must never be spoken as a success");
  assert.match(failedSentence, /recorded|won't claim/i,
    "the failed sentence says the failure is on the record, not hand-waved");

  // The still-running line lives in its own branch, reached only by rows the
  // failed check has already let past.
  const runningAt = status.indexOf("It's still running");
  assert.ok(runningAt > 0, "and the still-running line exists only for rows that are actually running");
  assert.ok(runningAt > failedAt, "the failed status is answered before anything can call the row a build");
  assert.notEqual(failedSentence, status.slice(runningAt, runningAt + failedSentence.length),
    "the failed and running answers must be different sentences");
});

test("'I've put your site back' is checked on the page like any other claim", () => {
  // The undo path deploys and reports, which is the same shape as the defect
  // this whole change is about. Every edit leaves <!-- wss-edit <jobId> --> in
  // the HTML, so the restore has a fact to check rather than a hope.
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "lib", "site-change-plan.js"), "utf8");
  const undo = src.slice(src.indexOf("async function applyUndo"));
  const body = undo.slice(0, undo.indexOf("\n}\n"));
  assert.match(body, /MARK_OPEN\(restored\.manifest\.job_id\)/, "the restore looks for the marker of the change it undid");
  assert.match(body, /still showing on the page/, "and says so plainly when the old version is still there");
  // The success sentence must be unreachable once the marker is still present.
  const goneFalse = body.indexOf("gone === false");
  const doneSay = body.indexOf("Done — I've put your site back");
  assert.ok(goneFalse > 0 && goneFalse < doneSay, "the failure sentence is chosen before the success one");
});

test("the voice status poll never claims the live site is fine when it has not looked", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "lib", "edit-status-core.js"), "utf8");
  assert.doesNotMatch(src, /nothing is broken on your live site/i);
});

// ---------------------------------------------------------------------------
// The live reader itself, without a browser
// ---------------------------------------------------------------------------
test("verifyEditLive reports honestly when chromium will not start", async () => {
  const out = await V.verifyEditLive({
    origin: "https://example.wss-ai.com",
    intents: [{ selector: "h1", property: "color", value: "#ff6600" }],
    launch: async () => { throw new Error("Executable doesn't exist"); },
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /chromium_launch_failed/);
  assert.equal(V.summarizeVerification(out).status, "unconfirmed");
});

test("verifyEditLive retries a page that is still serving the old bytes, then gives up honestly", async () => {
  let loads = 0;
  const browser = {
    newPage: async () => ({
      goto: async () => { loads += 1; return { status: () => 200 }; },
      waitForFunction: async () => true,
      evaluate: async () => ({ checks: [], textChecks: [], markerPresent: false, bodyChars: 900 }),
    }),
    close: async () => {},
  };
  const out = await V.verifyEditLive({
    origin: "https://example.wss-ai.com",
    intents: [{ selector: "h1", property: "color", value: "#ff6600" }],
    marker: "<!-- wss-edit j1 -->",
    attempts: 3,
    launch: async () => browser,
    sleep: async () => {},
  });
  assert.equal(loads, 3, "a stale edge is looked at again rather than blamed");
  assert.equal(V.summarizeVerification(out).status, "unconfirmed");
});

test("verifyEditLive stops as soon as the change is measured on the page", async () => {
  let loads = 0;
  const browser = {
    newPage: async () => ({
      goto: async () => { loads += 1; return { status: () => 200 }; },
      waitForFunction: async () => true,
      evaluate: async () => ({
        checks: [{ selector: "h1", property: "color", value: "#ff6600", matched: 1, took: 1, verdict: "took", blockers: [] }],
        textChecks: [],
        markerPresent: true,
        bodyChars: 900,
      }),
    }),
    close: async () => {},
  };
  const out = await V.verifyEditLive({
    origin: "https://example.wss-ai.com",
    intents: [{ selector: "h1", property: "color", value: "#ff6600" }],
    marker: "<!-- wss-edit j1 -->",
    launch: async () => browser,
    sleep: async () => {},
  });
  assert.equal(loads, 1);
  assert.equal(V.summarizeVerification(out).ok, true);
});

test("with nothing to check, the reader does not open a browser at all", async () => {
  let launched = false;
  const out = await V.verifyEditLive({
    origin: "https://example.wss-ai.com",
    intents: [],
    texts: [],
    launch: async () => { launched = true; return null; },
  });
  assert.equal(launched, false);
  assert.equal(out.ok, true);
  assert.equal(out.skipped, "nothing_to_verify");
});
