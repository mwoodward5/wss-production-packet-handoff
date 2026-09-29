"use strict";

// test/section-reorder.test.js — MOVING A WHOLE SECTION, made real.
//
// The 2026-08-17 power wave: "move the reviews above the gallery" used to be
// either a bigger-build sentence or a style plan that changed nothing. It is
// now a deterministic verb — parsed from the caller's own words, applied as a
// byte move on sites whose sections are plain HTML (the engine's static
// donors), spoken honestly as the bigger build on compiled ones, replayed on
// rebuild, and verified on the rendered page by ORDER, not presence.
//
// This file pins every one of those claims at the layer each lives in:
//   parse       — the field-log sentences, and the sentences that must NOT parse
//   catalog     — headings are the handle; ambiguity is refused
//   apply       — the byte move, the marker, the already-in-place answer
//   capability  — the tier is honest at the sentence layer
//   replay      — the move survives a rebuild, exactly or reported
//   verify      — order is checked on the rendered page, not assumed

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const S = require("../lib/section-reorder");
const { replayEdits } = require("../lib/site-edit-replay");
const { validateReplayOp } = require("../lib/site-edit-log");
const { summarizeVerification } = require("../lib/edit-verify");
const caps = require("../lib/riley-capabilities");
const plan = require("../lib/site-change-plan");

// ---------------------------------------------------------------------------
// The page under test: the static-donor shape (sections as literal bytes),
// exactly the shape donors-clean/fencing-sterling and the new
// test/fixtures/mirror-donor-sections ship.
// ---------------------------------------------------------------------------
const STATIC_HTML = `<!doctype html>
<html><head><title>Flint Plumbing</title></head>
<body>
<header><img src="/assets/client-logo.png" alt="Flint"></header>
<main>
<section><h2>What we do</h2><p>Repairs and installs.</p></section>
<section><h2>Our work</h2><p>Photos of jobs.</p></section>
<section><h2>Reviews</h2><p>4.9 stars from 106 reviews.</p></section>
<section><h2>Contact</h2><p>Call (512) 971-2445.</p></section>
</main>
</body></html>`;

// The compiled-donor shape: an empty shell whose sections are created at
// runtime by the bundle. This is what donors-clean/plumbing-clean and every
// other compiled donor's index.html looks like around <body>.
const COMPILED_HTML = `<!doctype html>
<html><head><title>Flint Plumbing</title></head>
<body><div id="root"></div>
<script type="module" src="/assets/index-PIV5JO_1.js"></script>
</body></html>`;

// ===========================================================================
// 1. THE PARSE — the field-log sentences, and only those
// ===========================================================================
test("parse: the field-log reorder sentences resolve to the exact verb shape", () => {
  assert.deepEqual(
    S.parseSectionReorder("move the reviews above the gallery"),
    { verb: "reorder_section", section: "reviews", before: "gallery" },
  );
  assert.deepEqual(
    S.parseSectionReorder("move the reviews section above the gallery"),
    { verb: "reorder_section", section: "reviews", before: "gallery" },
  );
  assert.deepEqual(
    S.parseSectionReorder("put the gallery below the reviews"),
    { verb: "reorder_section", section: "gallery", after: "reviews" },
  );
  assert.deepEqual(
    S.parseSectionReorder("move the contact section to the top"),
    { verb: "reorder_section", section: "contact", edge: "top" },
  );
  assert.deepEqual(
    S.parseSectionReorder("put the faq at the bottom of the page"),
    { verb: "reorder_section", section: "faq", edge: "bottom" },
  );
  assert.deepEqual(
    S.parseSectionReorder("I want the reviews section above the gallery"),
    { verb: "reorder_section", section: "reviews", before: "gallery" },
  );
  assert.deepEqual(
    S.parseSectionReorder("move the testimonials above the services section"),
    { verb: "reorder_section", section: "testimonials", before: "services" },
  );
  assert.deepEqual(
    S.parseSectionReorder("switch the gallery to after the services"),
    { verb: "reorder_section", section: "gallery", after: "services" },
  );
  assert.deepEqual(
    S.parseSectionReorder("move the FAQ below the contact section"),
    { verb: "reorder_section", section: "faq", after: "contact" },
  );
});

test("parse: generic reorders with no names do NOT parse — they stay the bigger build", () => {
  assert.equal(S.parseSectionReorder("reorder the sections"), null);
  assert.equal(S.parseSectionReorder("change the order of the sections"), null);
  assert.equal(S.parseSectionReorder("rearrange the sections on the page"), null);
  assert.equal(S.parseSectionReorder("switch the order around"), null);
});

test("parse: element moves are style edits and must fall through to the model", () => {
  // "move" is a style_override cue; without a section-shaped noun on either
  // side, parsing this as a reorder would refuse an edit the executor can do.
  assert.equal(S.parseSectionReorder("move the logo above the phone button"), null);
  assert.equal(S.parseSectionReorder("move the logo to the right"), null);
  assert.equal(S.parseSectionReorder("move the button up a bit"), null);
  assert.equal(S.parseSectionReorder("make the logo bigger"), null);
});

// ===========================================================================
// 2. THE CATALOG — headings are the handle
// ===========================================================================
test("catalog: sections are found by heading, in document order", () => {
  const cat = S.buildSectionCatalog(STATIC_HTML);
  assert.deepEqual(cat.map((s) => s.heading), ["What we do", "Our work", "Reviews", "Contact"]);
  for (const s of cat) {
    assert.ok(s.headingExact.startsWith("<h2>"), "the exact handle is the heading element run");
    assert.ok(s.end > s.start);
  }
});

test("catalog: nested sections do not leak their headings into the parent", () => {
  const cat = S.buildSectionCatalog(
    "<section><h2>Outer</h2><section><h3>Inner</h3><p>x</p></section><p>y</p></section>",
  );
  assert.equal(cat.length, 2);
  assert.equal(cat[0].heading, "Outer");
  assert.equal(cat[1].heading, "Inner");
});

test("match: a spoken name resolves generously — exact, token, synonym", () => {
  const cat = S.buildSectionCatalog(STATIC_HTML);
  assert.equal(S.matchSection("reviews", cat).section.heading, "Reviews");
  assert.equal(S.matchSection("the reviews", cat) ? S.matchSection("the reviews", cat).section.heading : null, "Reviews");
  // "photos" is caller language; "Our work" is the donor's word for it.
  assert.equal(S.matchSection("photos", cat).section.heading, "Our work");
  assert.equal(S.matchSection("our work", cat).section.heading, "Our work");
  // And a name with no relationship to any heading matches nothing.
  assert.equal(S.matchSection("kitchen", cat), null);
});

test("match: two sections fitting a name equally is a read-back, never a pick", () => {
  // "photos" sits in the same caller-vocabulary family as BOTH headings, so
  // the two score identically — the resolver must read both back, not choose.
  const cat = S.buildSectionCatalog(
    "<section><h2>Gallery</h2><p>a</p></section><section><h2>Our work</h2><p>b</p></section>",
  );
  const out = S.matchSection("photos", cat);
  assert.ok(!out.section, "a tie must not resolve");
  assert.equal(out.ambiguous.length, 2);
});

// ===========================================================================
// 3. THE APPLY — the byte move, on a static donor
// ===========================================================================
test("apply: 'move the reviews above the gallery' moves the section bytes", () => {
  const out = S.planSectionReorder(
    { "index.html": STATIC_HTML },
    S.parseSectionReorder("move the reviews above the gallery"),
    { jobId: "edit_reorder_1" },
  );
  assert.equal(out.file, "index.html");
  assert.equal(out.moved, "Reviews");
  assert.equal(out.reference, "Our work");
  assert.equal(out.position, "before");
  const html = out.html;
  // The moved section now precedes its landmark…
  assert.ok(
    html.indexOf("4.9 stars") < html.indexOf("Photos of jobs"),
    "Reviews must sit above Our work after the move",
  );
  // …the rest of the page is untouched in ORDER…
  assert.ok(html.indexOf("Repairs and installs.") < html.indexOf("4.9 stars"));
  assert.ok(html.indexOf("Photos of jobs.") < html.indexOf("Call (512) 971-2445."));
  // …every section survived, none duplicated…
  for (const needle of ["What we do", "Reviews", "Our work", "Contact"]) {
    assert.equal(html.split(needle).length - 1, 1, `${needle} must appear exactly once`);
  }
  // …and the move carries the standard edit marker.
  assert.ok(html.includes("<!-- wss-edit edit_reorder_1 -->"));
});

test("apply: below, top and bottom forms all move real bytes", () => {
  const below = S.planSectionReorder({ "index.html": STATIC_HTML }, { verb: "reorder_section", section: "our work", after: "reviews" }, { jobId: "j1" });
  assert.ok(below.html.indexOf("Photos of jobs.") > below.html.indexOf("4.9 stars"), "Our work must sit below Reviews after the move");

  const top = S.planSectionReorder({ "index.html": STATIC_HTML }, { verb: "reorder_section", section: "contact", edge: "top" }, { jobId: "j2" });
  const catTop = S.buildSectionCatalog(top.html);
  assert.equal(catTop[0].heading, "Contact");

  const bottom = S.planSectionReorder({ "index.html": STATIC_HTML }, { verb: "reorder_section", section: "reviews", edge: "bottom" }, { jobId: "j3" });
  const catBottom = S.buildSectionCatalog(bottom.html);
  assert.equal(catBottom[catBottom.length - 1].heading, "Reviews");
});

test("apply: a section already in place is a spoken fact, not a silent no-op", () => {
  // Our work is already directly above Reviews on this page.
  assert.throws(
    () => S.planSectionReorder({ "index.html": STATIC_HTML }, { verb: "reorder_section", section: "our work", before: "reviews" }, { jobId: "j" }),
    (error) => {
      assert.equal(error.planRefusal, true);
      assert.equal(error.alreadyInPlace, true);
      assert.match(error.say, /already above/);
      assert.match(error.say, /nothing for me to change/i);
      return true;
    },
  );
});

test("apply: an unknown section reads the page's real sections back", () => {
  // "kitchen" has no relationship to any heading on this page. ("testimonials"
  // deliberately does NOT appear here — it sits in the same caller vocabulary
  // as Reviews and correctly resolves to it.)
  assert.throws(
    () => S.planSectionReorder({ "index.html": STATIC_HTML }, { verb: "reorder_section", section: "kitchen", before: "gallery" }, { jobId: "j" }),
    (error) => {
      assert.equal(error.planRefusal, true);
      assert.match(error.say, /can'?t find a section called "kitchen"/i);
      // The offer is the page's ACTUAL headings, in plain words.
      assert.match(error.say, /What we do/);
      assert.match(error.say, /Reviews/);
      assert.match(error.say, /Contact/);
      // And it never asks the caller to do the engineering.
      assert.doesNotMatch(error.say, /selector|file|element id/i);
      return true;
    },
  );
});

test("apply: a COMPILED donor gets the bigger-build sentence — the honest split", () => {
  assert.throws(
    () => S.planSectionReorder(
      { "index.html": COMPILED_HTML },
      { verb: "reorder_section", section: "reviews", before: "gallery" },
      { jobId: "j", biggerBuildSay: caps.BIGGER_BUILD_SENTENCE },
    ),
    (error) => {
      assert.equal(error.planRefusal, true);
      assert.equal(error.say, caps.BIGGER_BUILD_SENTENCE, "the compiled-donor refusal is the tier's own sentence");
      return true;
    },
  );
});

// ===========================================================================
// 4. THE CAPABILITY TIER — honest at the sentence layer
// ===========================================================================
test("capability: a named section move classifies as a SUPPORTED edit", () => {
  const hit = caps.classifyRequest("move the reviews above the gallery");
  assert.equal(hit.supported, true);
  assert.equal(hit.op, "reorder_section");
  assert.equal(hit.tier, "structural");

  const described = caps.describeCapability("move the reviews above the gallery");
  assert.equal(described.supported, true);
  // say is null when supported: the confirm-and-apply path owns every
  // sentence from there, and the executor speaks the honest outcome for THIS
  // donor (moved, or the bigger-build referral).
  assert.equal(described.say, null);
});

test("capability: a generic reorder still gets the bigger-build sentence — now with the door back in", () => {
  const described = caps.describeCapability("reorder the sections");
  assert.equal(described.supported, false);
  assert.equal(described.tier, "structural");
  assert.equal(described.say, caps.BIGGER_BUILD_SENTENCE);
  // The sentence invites naming the section — the path back to supported.
  assert.match(described.say, /name one section and where you want it/i);
});

test("capability: the verb list and the spoken sentence both carry the new power", () => {
  assert.ok(caps.EXECUTOR_VERBS.some((v) => v.op === "reorder_section"));
  assert.match(caps.CAPABILITY_SENTENCE, /move a whole section/i);
  // The structural family is tiered, not scanned: no cue can fire it, only
  // the shared parser can. Bigger-build families (the hero video swap) are
  // tiered the same way, and both exclusions are derived from the verbs.
  assert.ok(!caps.FAMILY_ORDER.includes("structural"));
  assert.deepEqual(
    caps.QUICK_FAMILIES,
    caps.FAMILIES.filter((f) => f !== "structural" && !caps.BIGGER_BUILD_FAMILIES.includes(f)),
  );
  // And the executor really has the branch — the verb list never lies.
  const source = fs.readFileSync(path.join(__dirname, "../lib/site-change-plan.js"), "utf8");
  assert.match(source, /kind === "reorder_section"/, "the apply loop must implement every verb the list names");
});

test("capability: style requests are untouched by the reorder tier", () => {
  for (const sentence of ["make the logo bigger", "change the headline to say Hello", "add my GTM-NQV5LX64"]) {
    const hit = caps.classifyRequest(sentence);
    assert.equal(hit.supported, true, sentence);
    assert.notEqual(hit.op, "reorder_section", sentence);
    assert.equal(hit.tier, "quick", sentence);
  }
});

// ===========================================================================
// 5. THE PIPELINE — the verb rides the existing edit pipeline
// ===========================================================================
test("pipeline: the synthesized op is replayable exactly as the apply loop records it", () => {
  // The op shape the apply branch writes must pass the log's validation —
  // this is the contract between the executor and the rebuild.
  const replayOp = {
    op: "reorder_section",
    file: "index.html",
    headingExact: "<h2>Reviews</h2>",
    heading: "Reviews",
    position: "before",
    referenceExact: "<h2>Our work</h2>",
    reference: "Our work",
  };
  assert.deepEqual(validateReplayOp(replayOp), { ok: true, reason: "" });
  // A half-recorded op is reported, never attempted.
  assert.equal(validateReplayOp({ op: "reorder_section", file: "index.html", headingExact: "<h2>Reviews</h2>", position: "before" }).ok, false);
  assert.match(validateReplayOp({ op: "reorder_section", file: "index.html", headingExact: "<h2>Reviews</h2>", position: "before" }).reason, /missing_reference/);
  assert.equal(validateReplayOp({ op: "reorder_section", file: "index.html", position: "top" }).reason, "reorder_section_missing_heading");
});

test("pipeline: a fresh rebuild replays the move — the reorder survives, exactly", async () => {
  // A freshly composed tree: same sections, DIFFERENT bytes around them (the
  // content stage rewrote the paragraphs). The customer's order comes back.
  const fresh = `<!doctype html>
<html><head><title>Flint Plumbing</title></head>
<body>
<main>
<section><h2>What we do</h2><p>Repairs, installs and inspections.</p></section>
<section><h2>Our work</h2><p>Photos of recent jobs.</p></section>
<section><h2>Reviews</h2><p>4.9 stars from 106 reviews.</p></section>
<section><h2>Contact</h2><p>Call us any weekday.</p></section>
</main>
</body></html>`;
  const files = { "index.html": Buffer.from(fresh) };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "edit_reorder_1", at: "2026-08-17T00:00:00Z",
      instruction: "move the reviews above the gallery",
      op: {
        op: "reorder_section", file: "index.html",
        headingExact: "<h2>Reviews</h2>", heading: "Reviews",
        position: "before", referenceExact: "<h2>Our work</h2>", reference: "Our work",
      },
    }],
  });
  assert.equal(out.unreplayable.length, 0, JSON.stringify(out.unreplayable));
  const html = files["index.html"].toString("utf8");
  assert.ok(
    html.indexOf("4.9 stars") < html.indexOf("Photos of recent jobs"),
    "the customer's order must survive the rebuild",
  );
  // Idempotent: a second pass over the same tree changes nothing.
  const again = await replayEdits({ files, entries: out.applied.length ? [{
    seq: "j#0", jobId: "edit_reorder_1", at: "2026-08-17T00:00:00Z", instruction: "x",
    op: { op: "reorder_section", file: "index.html", headingExact: "<h2>Reviews</h2>", position: "before", referenceExact: "<h2>Our work</h2>" },
  }] : [] });
  assert.equal(again.applied[0] && again.applied[0].note, "already_present");
});

test("pipeline: a rebuild that no longer carries the heading reports the loss, never guesses", async () => {
  const files = { "index.html": Buffer.from("<main><section><h2>Different</h2><p>x</p></section></main>") };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "j", at: "2026-08-17T00:00:00Z", instruction: "move the reviews",
      op: { op: "reorder_section", file: "index.html", headingExact: "<h2>Reviews</h2>", position: "before", referenceExact: "<h2>Our work</h2>" },
    }],
  });
  assert.equal(out.applied.length, 0);
  assert.ok(out.unreplayable.length, "a heading the rebuild no longer has is a report, not a silent drop");
  assert.match(out.unreplayable[0].reason, /heading occurs 0 times|not inside a section/);
});

// ===========================================================================
// 6. THE VERDICT — order is checked, not assumed
// ===========================================================================
test("verify: both headings readable and in the right order is the only 'landed'", () => {
  const verdict = summarizeVerification({
    ok: true,
    checks: [],
    textChecks: [],
    orderChecks: [{ before: "Reviews", after: "Our work", verdict: "ordered" }],
    markerPresent: true,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, "landed");
});

test("verify: both headings readable and STILL in the old order is a proven miss — rolled back", () => {
  const verdict = summarizeVerification({
    ok: true,
    checks: [],
    textChecks: [],
    orderChecks: [{ before: "Reviews", after: "Our work", verdict: "wrong_order" }],
    markerPresent: true,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "not_landed");
  assert.equal(verdict.reason, "section_order_wrong_on_the_page");
});

test("verify: a heading that cannot be read proves nothing either way — unconfirmed", () => {
  const verdict = summarizeVerification({
    ok: true,
    checks: [],
    textChecks: [],
    orderChecks: [{ before: "Reviews", after: "Our work", verdict: "heading_not_found" }],
    markerPresent: true,
  });
  assert.equal(verdict.status, "unconfirmed");
  assert.equal(verdict.reason, "could_not_read_back_section_order");
});

// ===========================================================================
// 7. THE REAL DONORS — which donors can have this
// ===========================================================================
test("donors: the static donor in the library executes the move; the compiled one cannot", () => {
  const donorRoot = path.join(__dirname, "../donors-clean");
  const statics = [];
  const compiled = [];
  for (const name of fs.readdirSync(donorRoot)) {
    const html = fs.readFileSync(path.join(donorRoot, name, "index.html"), "utf8");
    (S.buildSectionCatalog(html).length ? statics : compiled).push(name);
  }
  // fencing-sterling is the static shape this wave executes.
  assert.ok(statics.includes("fencing-sterling"), `statics today: ${statics.join(", ")}`);
  // Every other donor in the library today is compiled and gets the honest
  // bigger-build sentence at apply time.
  assert.ok(compiled.includes("plumbing-clean"), `compiled today: ${compiled.join(", ")}`);
  for (const name of compiled) {
    const html = fs.readFileSync(path.join(donorRoot, name, "index.html"), "utf8");
    assert.throws(
      () => S.planSectionReorder({ "index.html": html }, { verb: "reorder_section", section: "reviews", before: "gallery" }, { jobId: "j" }),
      (error) => error.planRefusal === true,
      `${name} must refuse honestly, not crash`,
    );
  }
});

test("the executor exports the verb through its own door", () => {
  assert.equal(typeof plan.parseSectionReorder, "function");
  assert.equal(typeof plan.planSectionReorder, "function");
  assert.equal(typeof plan.applySectionReorder, "function");
  assert.equal(typeof plan.buildSectionCatalog, "function");
});

test("the lane is deterministic: a parsed reorder never reaches the planner model", () => {
  // The undo precedent: an instruction-level lane short-circuits the model
  // call entirely. Pinned in source because it is the difference between a
  // real verb and a prompt hoping the model emits one.
  const source = fs.readFileSync(path.join(__dirname, "../lib/site-change-plan.js"), "utf8");
  assert.match(source, /const reorderParsed = parseSectionReorder\(instruction\);/);
  assert.match(source, /if \(reorderParsed\) \{[\s\S]{0,400}ops: \[\{ op: "reorder_section"/);
  // And the executor refuses compiled donors with the tier's own sentence.
  assert.match(source, /biggerBuildSay: BIGGER_BUILD_SENTENCE/);
});
