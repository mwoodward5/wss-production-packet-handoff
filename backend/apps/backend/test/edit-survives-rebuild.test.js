"use strict";

// test/edit-survives-rebuild.test.js — THE P0: a rebuild must not delete the
// customer's own changes.
//
// WHAT THIS IS A TEST OF. Two paths write a customer's site. The edit engine
// (lib/site-change-plan.js) patches the archived tree in
// wss-site-sources/<slug>/ and redeploys it. The Mirror Engine
// (lib/mirror-engine/engine.js) composes a fresh tree from donor + facts +
// content, deploys THAT, and archives it over the same prefix. Until the log
// existed the second path had never heard of the first, so every rebuild
// silently undid every edit — on the live site and in the archive at once.
//
// MEASURED ON PRODUCTION, 2026-08-11, before any of this code:
//   wss-test-rimrock-plumbing-billings — 10 edit jobs at status `done` on
//   08-07, including "add my google analytics, the id is G-4Q7RSTVWX2"
//   (installed on 4 pages) and a generated privacy page. Every archived file
//   carries updated_at 2026-08-07T23:53:19-20Z: one rebuild, one burst. Today
//   the live page contains no `wss-edit` marker, no G-4Q7RSTVWX2, and
//   /privacy answers 404.
//   wss-test-air-creation-…-baton — the owner's own call. Whole archive
//   stamped 2026-08-11T09:35:03-05Z, 2.3 seconds apart. No markers survive.
//
// The first test below fails against that engine and passes against this one.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-edits-"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { siteEditLog, buildLog } = require("../lib/site-edit-log");
const { replayEdits } = require("../lib/site-edit-replay");
const { normalizeLogoSizing, validateOverrideCss, composeOverrideCss } = require("../lib/site-change-plan");

const SLUG = "wss-test-edit-persistence-roofing";

// ---------------------------------------------------------------------------
// A rebuild with every network seam stubbed, so the only thing under test is
// what ends up in the deployed file tree.
// ---------------------------------------------------------------------------
function makeDeps({ editRows = [], selectFails = false, readArchived = null, replayEdits: replayOverride } = {}) {
  let captured = null;
  const fakeSelect = async () => (selectFails
    ? { ok: false, mode: "live_select_failed", status: 500, error: { code: "boom" }, data: [] }
    : { ok: true, mode: "live_select", data: editRows });

  return {
    files: () => captured,
    deps: {
      slugPolicy,
      // The REAL log assembly, over REAL edit-job row shapes. Only the
      // transport is faked, so a change to how rows are read is caught here.
      siteEditLog: (args) => siteEditLog({ ...args, select: fakeSelect }),
      ...(replayOverride ? { replayEdits: replayOverride } : {}),
      readArchivedFile: readArchived || (async () => null),
      withSpaRewrite: (files) => { captured = files; return files; },
      ensureProject: async () => "prj_stub",
      uploadFiles: async (files) => ({ manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 1, deduped: 0 }),
      createDeployment: async () => ({ id: "dpl_stub", url: "stub.vercel.app", readyState: "QUEUED" }),
      waitReady: async () => ({ readyState: "READY" }),
      byteDiff: async () => ({ clean: true, checked: 9, mismatches: [] }),
      deepLinkCheck: async () => ({ clean: true, failures: [] }),
      attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
      aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
      renderCheck: async () => ({ status: "passed", problems: [] }),
      renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
    },
  };
}

function buildRequest(overrides = {}) {
  return {
    slug: SLUG,
    donor: "mirror-donor",
    facts: {
      business_name: "Persistence Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
    },
    hero: { headline: "Roofs done once, done right" },
    ...overrides,
  };
}

/** An edit-job row exactly as lib/edit-job-runner.js writes one. */
function doneEditRow({ jobId, at, instruction, replay, extra = {} }) {
  return {
    job_id: jobId,
    site_slug: SLUG,
    instruction,
    status: "done",
    result: { applied: true, via: "plan", jobId, replay, changedFiles: ["index.html"], ...extra },
    created_at: at,
    updated_at: at,
  };
}

const LOGO_CSS = 'header img[src*="client-logo"] { height: 96px !important; }';

const LOGO_EDIT = doneEditRow({
  jobId: "edit_test_logo_1",
  at: "2026-08-10T22:00:00.000Z",
  instruction: "make the logo bigger",
  replay: [{ op: "style_override", file: "index.html", css: LOGO_CSS, why: "customer asked for a bigger logo" }],
});

// ===========================================================================
// 1. THE P0 ITSELF
// ===========================================================================
test("edit -> rebuild -> the edit is still there", async () => {
  const h = makeDeps({ editRows: [LOGO_EDIT] });
  const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });

  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const deployed = h.files();
  assert.ok(deployed, "the build never reached the deploy stage");
  const html = deployed["index.html"].toString("utf8");

  // The customer's rule is ON the page the rebuild is about to publish, under
  // the ORIGINAL job id, so undo and the live-page probe still recognise it.
  assert.ok(html.includes('data-wss-edit="edit_test_logo_1"'), "the replayed <style> block is missing");
  assert.ok(html.includes("<!-- wss-edit edit_test_logo_1 -->"), "the replayed marker is missing");
  assert.ok(html.includes("height: 96px"), "the customer's declaration is missing");

  // And the manifest SAYS so, by name.
  assert.equal(res.body.checks.customer_edits.status, "passed");
  assert.equal(res.body.checks.customer_edits.applied, 1);
  assert.deepEqual(res.body.checks.customer_edits.unreplayable, []);
});

test("two edits to the same thing replay in the order the customer made them", async () => {
  const first = doneEditRow({
    jobId: "edit_a",
    at: "2026-08-10T10:00:00.000Z",
    instruction: "make the headline orange",
    replay: [{ op: "style_override", file: "index.html", css: "h1 { color: orange !important; }", why: "first" }],
  });
  const second = doneEditRow({
    jobId: "edit_b",
    at: "2026-08-10T11:00:00.000Z",
    instruction: "actually make it red",
    replay: [{ op: "style_override", file: "index.html", css: "h1 { color: red !important; }", why: "second" }],
  });
  // Rows deliberately handed over newest-first: the log sorts by its own
  // created_at, never by the order the store happened to answer in.
  const h = makeDeps({ editRows: [second, first] });
  const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200);
  const html = h.files()["index.html"].toString("utf8");
  assert.ok(html.indexOf("color: orange") < html.indexOf("color: red"), "the later edit must come last in <head>");
});

// ===========================================================================
// 1b. THE SECTION MOVE SURVIVES A REBUILD TOO (the 2026-08-17 power wave)
// ===========================================================================
// "Move the reviews above the gallery" is a real edit on a static donor: the
// sections are plain HTML bytes and the engine moves them. This test proves
// the move is still standing after the mirror engine composes a FRESH tree
// from the donor — same discipline as the P0 above, for the new verb. The
// donor is test/fixtures/mirror-donor-sections, whose index.html carries the
// sections literally (the fencing-sterling shape); every other donor in the
// library today is compiled and gets the honest bigger-build refusal instead.
test("edit -> rebuild -> the customer's section order is still there", async () => {
  // The engine composes this donor's sections in its own canonical order —
  // Reviews ABOVE Our work — so the customer's edit here is the flip: they
  // moved the GALLERY above the REVIEWS. The rebuilt page must keep the
  // customer's order, not the engine's.
  const reorder = doneEditRow({
    jobId: "edit_reorder_gallery",
    at: "2026-08-17T10:00:00.000Z",
    instruction: "move the gallery above the reviews",
    replay: [{
      op: "reorder_section",
      file: "index.html",
      headingExact: "<h2>Our work</h2>",
      heading: "Our work",
      position: "before",
      referenceExact: "<h2>Reviews</h2>",
      reference: "Reviews",
    }],
  });
  const h = makeDeps({ editRows: [reorder] });
  const res = await mirror(
    buildRequest({ donor: "mirror-donor-sections" }),
    { registry: createRegistry(), deps: h.deps },
  );
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const deployed = h.files();
  assert.ok(deployed, "the build never reached the deploy stage");
  const html = deployed["index.html"].toString("utf8");
  // (Located by heading element, not body copy — the Reviews body is
  // data-collapse-if-empty and legitimately collapses when no rating facts
  // were passed, which must not affect the move.)
  const reviewsAt = html.indexOf("<h2>Reviews</h2>");
  const workAt = html.indexOf("<h2>Our work</h2>");
  assert.ok(reviewsAt > -1 && workAt > -1, "both sections must be on the rebuilt page");
  assert.ok(workAt < reviewsAt, "the moved section must still be above its landmark after the rebuild");
  assert.ok(html.includes("<!-- wss-edit edit_reorder_gallery -->"), "the replayed move keeps its original job marker");
  assert.equal(res.body.checks.customer_edits.applied, 1);
  assert.deepEqual(res.body.checks.customer_edits.unreplayable, []);
});

// ===========================================================================
// 2. AN EDIT THAT NO LONGER FITS IS REPORTED, AND NOTHING IS PUBLISHED
// ===========================================================================
test("an edit whose anchor is gone stops the rebuild and names the casualty", async () => {
  const orphan = doneEditRow({
    jobId: "edit_orphan",
    at: "2026-08-10T12:00:00.000Z",
    instruction: "add a line about our emergency call outs",
    replay: [{
      op: "insert_html",
      file: "index.html",
      anchorExact: "<h2>A heading this donor does not have</h2>",
      anchorLabel: "A heading this donor does not have",
      position: "after",
      fragment: "<p>We answer the phone.</p>",
    }],
  });
  const h = makeDeps({ editRows: [orphan] });
  const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });

  assert.equal(res.status, 409);
  assert.equal(res.body.error, "customer_edits_would_be_lost");
  // An ARRAY, because lib/mirror-lane-build.js only forwards array details —
  // an object here reaches the operator's row as a bare error name.
  assert.ok(Array.isArray(res.body.detail), "detail must be an array or the lane drops it");
  assert.equal(res.body.detail.length, 1);
  assert.equal(res.body.detail[0].job_id, "edit_orphan");
  assert.equal(res.body.detail[0].reason, "anchor_not_found");
  assert.match(res.body.detail[0].instruction, /emergency call outs/);
  assert.match(res.body.detail[0].remedy, /MIRROR_ALLOW_EDIT_LOSS/);
  // NOTHING WAS PUBLISHED. The live site keeps the edit it already has.
  assert.equal(h.files(), null, "a build that would lose an edit must not deploy");
});

test("an operator can rebuild anyway, and the manifest records that they chose to", async () => {
  const orphan = doneEditRow({
    jobId: "edit_orphan_2",
    at: "2026-08-10T12:00:00.000Z",
    instruction: "add a line about our emergency call outs",
    replay: [{
      op: "insert_html",
      file: "index.html",
      anchorExact: "<h2>Also missing</h2>",
      position: "after",
      fragment: "<p>x</p>",
    }],
  });
  process.env.MIRROR_ALLOW_EDIT_LOSS = "1";
  try {
    const h = makeDeps({ editRows: [orphan] });
    const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });
    assert.equal(res.status, 200);
    assert.equal(res.body.checks.customer_edits.loss_allowed_by_operator, true);
    assert.equal(res.body.checks.customer_edits.unreplayable[0].reason, "anchor_not_found");
  } finally {
    delete process.env.MIRROR_ALLOW_EDIT_LOSS;
  }
});

// ===========================================================================
// 3. A FAILED READ IS NOT AN EMPTY LOG
// ===========================================================================
test("a rebuild refuses when it cannot read what the customer changed", async () => {
  const h = makeDeps({ selectFails: true });
  const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "site_edit_log_unreadable");
  assert.equal(h.files(), null);
});

// ===========================================================================
// 4. UNDO IS PART OF THE LOG
// ===========================================================================
test("an edit the customer took back is not replayed", async () => {
  const undone = doneEditRow({
    jobId: "edit_undone",
    at: "2026-08-10T09:00:00.000Z",
    instruction: "make the headline purple",
    replay: [{ op: "style_override", file: "index.html", css: "h1 { color: purple !important; }", why: "x" }],
  });
  const undo = {
    job_id: "edit_the_undo",
    site_slug: SLUG,
    instruction: "put it back the way it was",
    status: "done",
    result: { applied: true, via: "undo", restoredFrom: "edit_undone", changedFiles: ["index.html"] },
    created_at: "2026-08-10T09:30:00.000Z",
    updated_at: "2026-08-10T09:30:00.000Z",
  };
  const h = makeDeps({ editRows: [undone, undo] });
  const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200);
  const html = h.files()["index.html"].toString("utf8");
  assert.ok(!html.includes("color: purple"), "an undone edit must never come back");
  assert.equal(res.body.checks.customer_edits.undone, 1);
});

// ===========================================================================
// 5. LEGACY EDITS ARE NAMED, NOT MISTAKEN FOR "NO EDITS"
// ===========================================================================
test("an edit made before the log existed is reported as unrecoverable", async () => {
  const legacy = {
    job_id: "edit_legacy",
    site_slug: SLUG,
    instruction: "add my google analytics, the id is G-4Q7RSTVWX2",
    status: "done",
    result: { applied: true, via: "plan", ops: [{ op: "tracking_tag" }], changedFiles: ["index.html", "about.html"] },
    created_at: "2026-08-07T13:58:28.000Z",
    updated_at: "2026-08-07T13:58:28.000Z",
  };
  const h = makeDeps({ editRows: [legacy] });
  const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });
  // Not blocking — there is nothing to preserve and blocking would freeze the
  // site for ever — but named, dated and quoted so nobody calls it clean.
  assert.equal(res.status, 200);
  const check = res.body.checks.customer_edits;
  assert.equal(check.status, "failed");
  assert.equal(check.legacy_unrecorded.length, 1);
  assert.equal(check.legacy_unrecorded[0].job_id, "edit_legacy");
  assert.match(check.legacy_unrecorded[0].instruction, /G-4Q7RSTVWX2/);
});

// ===========================================================================
// 6. A SITE WITH NO EDITS IS UNCHANGED BY ANY OF THIS
// ===========================================================================
test("a prospect mirror with no edit history builds exactly as before", async () => {
  const h = makeDeps({ editRows: [] });
  const res = await mirror(buildRequest(), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.customer_edits.status, "none");
  assert.equal(res.body.checks.customer_edits.applied, 0);
});

// ===========================================================================
// 7. THE LOG ITSELF
// ===========================================================================
test("buildLog orders by the row's own timestamp and revokes what an undo took back", () => {
  const { entries, legacy, revoked } = buildLog([
    { job_id: "b", status: "done", created_at: "2026-08-10T11:00:00Z", updated_at: "2026-08-10T11:00:00Z", instruction: "second", result: { replay: [{ op: "style_override", file: "index.html", css: "h1{color:red}" }] } },
    { job_id: "a", status: "done", created_at: "2026-08-10T10:00:00Z", updated_at: "2026-08-10T10:00:00Z", instruction: "first", result: { replay: [{ op: "style_override", file: "index.html", css: "h1{color:blue}" }] } },
    { job_id: "u", status: "done", created_at: "2026-08-10T12:00:00Z", updated_at: "2026-08-10T12:00:00Z", instruction: "undo", result: { via: "undo", restoredFrom: "b" } },
    { job_id: "f", status: "failed", created_at: "2026-08-10T13:00:00Z", updated_at: "2026-08-10T13:00:00Z", instruction: "broke", result: { error: "nope" } },
    { job_id: "l", status: "done", created_at: "2026-08-09T10:00:00Z", updated_at: "2026-08-09T10:00:00Z", instruction: "old", result: { changedFiles: ["index.html"] } },
  ]);
  assert.deepEqual(entries.map((e) => e.jobId), ["a", "b"]);
  assert.equal(entries.find((e) => e.jobId === "b").revoked, true);
  assert.equal(entries.find((e) => e.jobId === "a").revoked, false);
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].entriesRevoked, 1);
  assert.deepEqual(legacy.map((l) => l.jobId), ["l"]);
});

test("a half-recorded op is reported, never attempted with a missing argument", async () => {
  const broken = doneEditRow({
    jobId: "edit_broken",
    at: "2026-08-10T12:00:00.000Z",
    instruction: "do the thing",
    replay: [{ op: "style_override", file: "index.html" }], // no css
  });
  const log = await siteEditLog({
    siteSlug: SLUG,
    select: async () => ({ ok: true, mode: "live_select", data: [broken] }),
  });
  assert.equal(log.active.length, 0);
  assert.equal(log.entries[0].replayable, false);
  assert.equal(log.entries[0].reason, "style_override_missing_css");
});

// ===========================================================================
// 8. REPLAY MECHANICS, in isolation
// ===========================================================================
test("replay is idempotent — a block already on the page is not stacked twice", async () => {
  const entry = {
    seq: "j#0", jobId: "j", at: "2026-08-10T00:00:00Z", instruction: "x",
    op: { op: "style_override", file: "index.html", css: "h1 { color: red; }", why: "x" },
  };
  const files = { "index.html": Buffer.from("<html><head></head><body><h1>hi</h1></body></html>") };
  const once = await replayEdits({ files, entries: [entry] });
  const twice = await replayEdits({ files: once.files, entries: [entry] });
  const html = twice.files["index.html"].toString("utf8");
  assert.equal(html.split('data-wss-edit="j"').length - 1, 1);
  assert.equal(twice.applied[0].note, "already_present");
});

test("a bundle edit follows its literal into the rebuilt, re-hashed bundle", async () => {
  const files = {
    "index.html": Buffer.from("<html><head></head><body></body></html>"),
    // A DIFFERENT filename from the one the edit was made against — which is
    // the normal case, because every rebuild re-hashes the bundle.
    "assets/index-NEWHASH1.js": Buffer.from('const a={title:"Three lines of everyday work."};'),
  };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "j", at: "2026-08-10T00:00:00Z", instruction: "reword the heading",
      op: { op: "replace_copy", literal: "Three lines of everyday work.", replacement: "Three things we do every day." },
    }],
  });
  assert.equal(out.unreplayable.length, 0);
  assert.match(files["assets/index-NEWHASH1.js"].toString("utf8"), /Three things we do every day\./);
});

test("a created page comes back from the customer's own archive, linked and in the sitemap", async () => {
  const files = {
    "index.html": Buffer.from('<html><head><link rel="canonical" href="https://x.wss-ai.com/" /></head><body><footer></footer></body></html>'),
    "sitemap.xml": Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://x.wss-ai.com/</loc></url></urlset>'),
  };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "j", at: "2026-08-10T00:00:00Z", instruction: "add a privacy page",
      op: { op: "legal_page", file: "privacy.html", route: "/privacy", label: "Privacy" },
    }],
    readArchived: async (rel) => (rel === "privacy.html" ? Buffer.from("<html><body>privacy</body></html>") : null),
  });
  assert.equal(out.unreplayable.length, 0, JSON.stringify(out.unreplayable));
  assert.ok(files["privacy.html"], "the page bytes never came back");
  assert.match(files["index.html"].toString("utf8"), /href="\/privacy"/);
  assert.match(files["sitemap.xml"].toString("utf8"), /\/privacy/);
});

// MEASURED, on wss-test-rimrock-plumbing-billings 2026-08-11: the privacy edit
// linked the page from index.html AND about.html, the rebuild replayed only
// index.html, and About came back without the link. A rebuild that removes a
// link the customer's site had is the rebuild editing their site for them.
test("the page is relinked from every page the edit linked it from, not just the home page", async () => {
  const files = {
    "index.html": Buffer.from('<html><head><link rel="canonical" href="https://x.wss-ai.com/" /></head><body><footer></footer></body></html>'),
    "about.html": Buffer.from('<html><body><nav><a href="/">Home</a><a href="tel:+15551234567">Call</a></nav></body></html>'),
    "sitemap.xml": Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://x.wss-ai.com/</loc></url></urlset>'),
  };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "j", at: "2026-08-10T00:00:00Z", instruction: "add a privacy page",
      op: { op: "legal_page", file: "privacy.html", route: "/privacy", label: "Privacy", linkedFrom: ["index.html", "about.html"] },
    }],
    readArchived: async (rel) => (rel === "privacy.html" ? Buffer.from("<html><body>privacy</body></html>") : null),
  });
  assert.equal(out.unreplayable.length, 0, JSON.stringify(out.unreplayable));
  assert.match(files["index.html"].toString("utf8"), /href="\/privacy"/);
  assert.match(files["about.html"].toString("utf8"), /href="\/privacy"/, "About came back without the link");
  assert.deepEqual(out.applied[0].relinked, ["about.html"]);
  assert.ok(out.changedFiles.includes("about.html"));
});

test("a linked-from page the fresh build no longer has is skipped, never invented", async () => {
  const files = {
    "index.html": Buffer.from('<html><head><link rel="canonical" href="https://x.wss-ai.com/" /></head><body><footer></footer></body></html>'),
  };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "j", at: "2026-08-10T00:00:00Z", instruction: "add a privacy page",
      op: { op: "legal_page", file: "privacy.html", route: "/privacy", label: "Privacy", linkedFrom: ["index.html", "about.html"] },
    }],
    readArchived: async (rel) => (rel === "privacy.html" ? Buffer.from("<html><body>privacy</body></html>") : null),
  });
  assert.equal(out.unreplayable.length, 0, JSON.stringify(out.unreplayable));
  assert.equal(files["about.html"], undefined, "a page the build does not have must not be conjured");
  assert.deepEqual(out.applied[0].relinked, []);
});

test("a record with no linkedFrom keeps the old behaviour rather than guessing at pages", async () => {
  const files = {
    "index.html": Buffer.from('<html><head><link rel="canonical" href="https://x.wss-ai.com/" /></head><body><footer></footer></body></html>'),
    "about.html": Buffer.from('<html><body><nav><a href="/">Home</a></nav></body></html>'),
  };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "j", at: "2026-08-10T00:00:00Z", instruction: "add a privacy page",
      op: { op: "legal_page", file: "privacy.html", route: "/privacy", label: "Privacy" },
    }],
    readArchived: async (rel) => (rel === "privacy.html" ? Buffer.from("<html><body>privacy</body></html>") : null),
  });
  assert.equal(out.unreplayable.length, 0);
  assert.ok(!files["about.html"].toString("utf8").includes('href="/privacy"'));
  assert.deepEqual(out.applied[0].relinked, []);
});

test("a created page whose archived bytes are gone is reported, not invented", async () => {
  const files = { "index.html": Buffer.from("<html><head></head><body><footer></footer></body></html>") };
  const out = await replayEdits({
    files,
    entries: [{
      seq: "j#0", jobId: "j", at: "2026-08-10T00:00:00Z", instruction: "add a privacy page",
      op: { op: "legal_page", file: "privacy.html", route: "/privacy", label: "Privacy" },
    }],
    readArchived: async () => null,
  });
  assert.equal(out.applied.length, 0);
  assert.equal(out.unreplayable[0].reason, "archived_file_missing:privacy.html");
  assert.ok(!files["privacy.html"]);
});

// ===========================================================================
// 9. THE ASPECT-RATIO BUG FROM THE SAME CALLS
// ===========================================================================
// "the logo is now stretched and cut off and cropped" / "the box it's sitting
// in is now too small" — both from the live Air Creation call on 2026-08-10.
const LOGO_ELEMENTS = [
  { id: "e1", selector: 'header img[src*="client-logo"], header img[src*="brand-logo"]', note: "logo" },
  { id: "e2", selector: 'header a:has(img[src*="client-logo"]), header a:has(img[src*="brand-logo"])', note: "wrapper" },
  { id: "e3", selector: "header", note: "the fixed top bar" },
  { id: "e4", selector: "h1", note: "headline" },
];

test("pinning both axes on the logo is corrected to one — the mark keeps its shape", () => {
  const out = normalizeLogoSizing(
    'header img[src*="client-logo"] { width: 200px; height: 80px; }',
    LOGO_ELEMENTS,
  );
  assert.match(out.css, /width:\s*auto/);
  assert.match(out.css, /height:\s*80px/);
  assert.ok(out.notes.includes("width_set_to_auto_so_the_logo_keeps_its_shape"));
});

test("a resized logo is never cropped and never wider than its container", () => {
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: 96px !important; }', LOGO_ELEMENTS);
  assert.match(out.css, /object-fit:\s*contain/);
  assert.match(out.css, /max-width:\s*100%/);
});

test("a taller logo takes its box with it — the header and the wrapper grow too", () => {
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: 96px !important; }', LOGO_ELEMENTS);
  // 96 + 24 of breathing room, resolved here rather than shipped as calc(),
  // because the post-deploy check compares against a computed value.
  assert.match(out.css, /header \{[^}]*min-height:\s*120px/);
  assert.match(out.css, /overflow:\s*visible/);
  assert.match(out.css, /a:has\([^)]*\)[^{]*\{[^}]*align-items:\s*center/);
  assert.ok(out.notes.some((n) => n.startsWith("header_min_height_120px")));
});

test("everything the companions add is a selector this site's catalog offered", () => {
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: 96px !important; }', LOGO_ELEMENTS);
  // The same gate a planner's own CSS passes. If a companion ever names an
  // element the catalog does not have, this throws.
  const checked = validateOverrideCss(out.css, { elements: LOGO_ELEMENTS, assets: [] });
  assert.ok(checked.rules.length >= 3);
});

test("a plan that already decided about the header is not overruled", () => {
  const out = normalizeLogoSizing(
    'header img[src*="client-logo"] { height: 96px; }\nheader { min-height: 200px; }',
    LOGO_ELEMENTS,
  );
  assert.equal(out.css.match(/header \{/g).length, 1, "no second header rule may be added");
  assert.match(out.css, /min-height:\s*200px/);
});

test("nothing that is not the logo is touched", () => {
  const css = "h1 { color: #ff6600 !important; }";
  const out = normalizeLogoSizing(css, LOGO_ELEMENTS);
  assert.equal(out.notes.length, 0);
  assert.match(out.css, /^h1 \{ color: #ff6600 !important; \}$/);
});

test("transform: scale on the logo is still refused outright", () => {
  assert.throws(
    () => validateOverrideCss('header img[src*="client-logo"] { transform: scale(2.5); }', { elements: LOGO_ELEMENTS, assets: [] }),
    /transform\/scale on the logo/,
  );
});

test("the planner's redundant-selector shorthand still resizes by height", () => {
  const css = composeOverrideCss(
    { op: "style_override", target: "e1", declarations: 'header img[src*="client-logo"] { height: 120px; width: 300px; }' },
    LOGO_ELEMENTS,
  );
  const out = normalizeLogoSizing(css, LOGO_ELEMENTS);
  assert.match(out.css, /width:\s*auto/);
  assert.match(out.css, /header \{[^}]*min-height:\s*144px/);
});

// ===========================================================================
// 9b. THE CLAMP THAT ATE THE RESIZE — Air Creation, five calls, one logo
// ===========================================================================
// Field reports, 2026-08-17: "stretched, cut off, still not fitting correctly",
// "logo reverting". The donors ship the mark as `h-auto max-h-20` — an 80px
// max-height utility. A `height: 96px` edit wins the height declaration and
// then computes to min(96, 80) = 80px anyway: the caller sees no growth, the
// rendered check reads 80 against a declared 96, the edit is rolled back, and
// the logo "goes back". One template clamp, three field sentences.

test("the donor's 80px height ceiling cannot silently eat a 96px resize", () => {
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: 96px !important; }', LOGO_ELEMENTS);
  assert.match(out.css, /max-height:\s*none/);
  assert.ok(out.notes.includes("max_height_lifted_so_the_template_clamp_cannot_eat_the_resize"));
  // The math, in the open: with the clamp lifted the used height is the
  // declared height. Simulate the cascade the rendered check walks.
  const decls = Object.fromEntries(
    out.css.match(/header img\[[^}]*\{([^}]*)\}/)[1].split(";").map((d) => d.trim()).filter(Boolean)
      .map((d) => [d.split(":")[0].trim(), d.split(":")[1].replace(/!important/, "").trim()]),
  );
  const used = Math.min(Number.parseFloat(decls.height), decls["max-height"] === "none" ? Infinity : Number.parseFloat(decls["max-height"]));
  assert.equal(used, 96, "the declared height must be the height that renders");
});

test("a planner that sets max-height ITSELF is never overruled", () => {
  // Deliberate shrink: the ceiling is the request, not an obstacle to it.
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: auto; max-height: 40px; }', LOGO_ELEMENTS);
  assert.doesNotMatch(out.css, /max-height:\s*none/);
  assert.ok(!out.notes.includes("max_height_lifted_so_the_template_clamp_cannot_eat_the_resize"));
});

test("a rem-sized logo still opens its header — the box hears about it too", () => {
  // `height: 6rem` used to be invisible to the px-only companion, so a planner
  // that spoke rem shipped a bigger mark into a box that never learned.
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: 6rem; }', LOGO_ELEMENTS);
  assert.match(out.css, /header \{[^}]*min-height:\s*120px/); // 6rem = 96px, + 24 room
  assert.ok(out.notes.some((n) => n.startsWith("header_min_height_120px")));
});

test("everything the clamp-lift adds still passes the catalog gate", () => {
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: 96px; width: 220px; }', LOGO_ELEMENTS);
  const checked = validateOverrideCss(out.css, { elements: LOGO_ELEMENTS, assets: [] });
  assert.ok(checked.rules.length >= 3);
});

// A REAL RASTER, built here rather than shipped as a binary: a valid PNG
// header declaring the mark's true shape. The fixtures directory carries only
// a 30-byte fake ("fake-donor-logo-bytes"), so the fixture logo for geometry
// work is constructed with the exact bytes imageSize() reads — signature, IHDR,
// declared 400×100. A wide mark is the case that stretches: pinning both axes
// to a square-ish box is how "bigger" turned into "warped".
const { imageSize } = require("../lib/site-change-plan");

function fixtureLogo(width, height) {
  const b = Buffer.alloc(24);
  b.write("\x89PNG\r\n\x1a\n", 0, "binary");            // signature
  b.writeUInt32BE(13, 8);                                 // IHDR length
  b.write("IHDR", 12, "binary");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test("a fixture logo keeps its declared shape through a resize: one axis pinned, ratio intact", () => {
  const logo = fixtureLogo(400, 100); // a wide mark, as trade logos usually are
  const size = imageSize(logo, "/assets/client-logo.png");
  assert.deepEqual({ w: size.w, h: size.h }, { w: 400, h: 100 });

  // "Make the logo twice as big" arrives as a height rule with both axes
  // pinned by an over-eager planner. After shaping, exactly ONE axis is set
  // and the rendered box follows the file's own ratio: 96px tall → 384px wide,
  // not the 220px a stretched rule would have forced onto it.
  const out = normalizeLogoSizing('header img[src*="client-logo"] { height: 96px; width: 220px; }', LOGO_ELEMENTS);
  const decls = Object.fromEntries(
    out.css.match(/header img\[[^}]*\{([^}]*)\}/)[1].split(";").map((d) => d.trim()).filter(Boolean)
      .map((d) => [d.split(":")[0].trim(), d.split(":")[1].replace(/!important/, "").trim()]),
  );
  assert.equal(decls.width, "auto", "both axes pinned is the definition of a stretched raster");
  assert.equal(decls.height, "96px");
  assert.equal(decls["object-fit"], "contain");
  // The geometry the browser will actually lay out, from the file's own ratio.
  const renderedWidth = Math.round((size.w / size.h) * Number.parseFloat(decls.height));
  assert.equal(renderedWidth, 384);
  assert.notEqual(renderedWidth, 220, "the mark must not be forced into the planner's box");
});
