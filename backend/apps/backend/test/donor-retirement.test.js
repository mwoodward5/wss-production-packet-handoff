"use strict";

// test/donor-retirement.test.js — A RETIRED DONOR MUST BE UNSELECTABLE.
//
// tree-care-dark shipped three defects to a live URL while every gate stayed
// green:
//   1. the donor owner's first name in the hero ("Text Curt" — All-Around Tree
//      Care's Curt Lewis, still present in index.html and index-CvAaQhnG.js),
//   2. 196 failed requests over 23 distinct 404s — every path in its own
//      requiredAssets exists on disk only as a .PLACEHOLDER stub,
//   3. a tree-service client published as LandscapingBusiness.
//
// The directory is KEPT (it is the library's only tree donor and it is
// repairable); what changes is that the engine will not select it.
//
// The bug this file locks down is subtler than "retire it": the pre-existing
// retirement convention (a "__retired__<vertical>" prefix on BOILERPLATE.
// vertical, used by donors-clean/roofing-falcon-clean) only ever blocks the
// VERTICAL match. A request naming the donor outright walked straight past it
// — donors-clean/roofing-falcon-clean/BOILERPLATE.json calls that "the
// intended escape hatch". For a donor retired because it LEAKS, an escape
// hatch is the whole problem. So retirement is read at resolution and closes
// both doors.
//
// Everything below runs against the REAL donor bytes on disk, dry_run only:
// zero Vercel calls, zero deploy budget.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const BOILERPLATES = path.join(__dirname, "..", "boilerplates");
const DONORS_CLEAN = path.join(__dirname, "..", "donors-clean");

process.env.MIRROR_DONOR_ROOT = BOILERPLATES;
// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-retire-"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { resolveDonor, listDonors, donorRetirement } = require("../lib/mirror-engine/donor");
const { liveVerticals } = require("../lib/donor-verticals");

const RETIRED = "tree-care-dark";
const manifestOf = (root, name) =>
  JSON.parse(fs.readFileSync(path.join(root, name, "BOILERPLATE.json"), "utf8"));

/** A well-formed tree-service mirror request — valid in every respect except
 *  that the donor it needs is out of service. */
function treeRequest(overrides = {}) {
  return {
    // Slug must cohere with the business name (client-isolation gate), so the
    // refusal below is the DONOR gate firing, never a boundary rejection.
    slug: "wss-test-ridgeline-tree-care",
    facts: {
      business_name: "Ridgeline Tree Care",
      industry: "tree-service",
      city: "Clarksville",
      state: "TN",
      phone: "(931) 555-0173",
      ...(overrides.facts || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "facts")),
  };
}

// ---------------------------------------------------------------------------
// The refusal, end to end through the engine
// ---------------------------------------------------------------------------
test("a build request NAMING tree-care-dark is refused", async () => {
  const res = await mirror(treeRequest({ donor: RETIRED }), { dryRun: true, registry: createRegistry() });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "donor_retired", "an explicit donor name must not bypass retirement");
  const hit = res.body.detail.find((d) => d.value === RETIRED);
  assert.ok(hit, `detail must name the donor: ${JSON.stringify(res.body.detail)}`);
  assert.equal(hit.reason, "donor_retired");
  assert.ok(hit.why && hit.why.length > 10, "the refusal must carry a human reason, not just a code");
  assert.match(hit.since, /^\d{4}-\d{2}-\d{2}$/, "retirement is dated");
});

test("the vertical route to tree-care-dark is closed too, and says why", async () => {
  const res = await mirror(treeRequest(), { dryRun: true, registry: createRegistry() });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "donor_retired");
  assert.deepEqual(res.body.detail.map((d) => d.value), [RETIRED]);
  assert.equal(res.body.detail[0].vertical, "tree-service");
});

test("no mirror is produced by the refusal — no build_hash, no preview_url", async () => {
  const res = await mirror(treeRequest({ donor: RETIRED }), { dryRun: true, registry: createRegistry() });
  assert.equal(res.body.build_hash, undefined);
  assert.equal(res.body.preview_url, undefined);
  assert.notEqual(res.body.revealable, true);
});

// ---------------------------------------------------------------------------
// The gate is targeted: nothing else in the library moved
// ---------------------------------------------------------------------------
test("live donors in the same root still resolve, by name and by vertical", () => {
  const byName = resolveDonor({ donor: "plumbing-pressure-lens" }, BOILERPLATES);
  assert.equal(byName.ok, true, JSON.stringify(byName.detail));
  const byVertical = resolveDonor({ industry: "plumbing" }, BOILERPLATES);
  assert.equal(byVertical.ok, true);
  assert.equal(byVertical.name, "plumbing-pressure-lens");
  const roofing = resolveDonor({ donor: "roofing-riseabove" }, BOILERPLATES);
  assert.equal(roofing.ok, true);
});

test("retired_for_outreach is NOT retirement — those donors still build", () => {
  // donors-clean/plumbing-clean and plumbing-premier carry
  // retired_for_outreach:true meaning "stop mining this category". Reading that
  // flag as engine retirement would silently un-build three working donors.
  assert.equal(donorRetirement({ retired_for_outreach: true }), null);
  // 2026-08-04 owner instruction un-retired plumbing-clean and
  // roofing-falcon-clean; plumbing-premier keeps the flag (its /services and
  // /about routes 404 — donor defect) and stays the live fixture for it.
  const m = manifestOf(DONORS_CLEAN, "plumbing-premier");
  assert.equal(m.retired_for_outreach, true, "plumbing-premier fixture changed");
  for (const name of ["plumbing-clean", "plumbing-premier", "roofing-falcon-clean"]) {
    assert.equal(resolveDonor({ donor: name }, DONORS_CLEAN).ok, true, `${name} must still resolve`);
  }
});

test("an unknown vertical is still a plain not-found, not a retirement", () => {
  const res = resolveDonor({ industry: "sailmaking" }, BOILERPLATES);
  assert.equal(res.ok, false);
  assert.equal(res.error, "donor_not_found");
  assert.equal(res.detail[0].reason, "no_donor_for_vertical");
});

// ---------------------------------------------------------------------------
// The record on disk: retired, not deleted
// ---------------------------------------------------------------------------
test("the donor directory survives — retirement is not deletion", () => {
  assert.ok(fs.existsSync(path.join(BOILERPLATES, RETIRED, "index.html")),
    "the dist is repairable and must be kept");
  assert.ok(listDonors(BOILERPLATES).some((d) => d.name === RETIRED),
    "it stays visible in the library listing, flagged rather than hidden");
});

test("the manifest states what is broken, so un-retiring is a decision not an accident", () => {
  const m = manifestOf(BOILERPLATES, RETIRED);
  const r = donorRetirement(m);
  assert.ok(r, "BOILERPLATE.retired missing — the donor would go straight back into service");
  assert.equal(r.repairable, true);
  const blob = JSON.stringify(m.retired).toLowerCase();
  for (const defect of ["person-name", "404", "schema"]) {
    assert.ok(blob.includes(defect), `retirement record does not mention ${defect}`);
  }
  assert.ok(Array.isArray(m.retired.unretire_requires) && m.retired.unretire_requires.length >= 3,
    "the exit criteria must be written down before anyone tries to reverse this");
});

test("retirement shorthand is accepted, and absence means in service", () => {
  assert.deepEqual(donorRetirement({ retired: true }), { reason: "retired", since: "", repairable: true });
  assert.equal(donorRetirement({}), null);
  assert.equal(donorRetirement(null), null);
  assert.equal(donorRetirement({ retired: false }), null);
});

// ---------------------------------------------------------------------------
// Alias table consistency
// ---------------------------------------------------------------------------
test("a retired donor's vertical is not 'live', so it can be re-aliased later", () => {
  const live = liveVerticals(BOILERPLATES);
  assert.ok(!live.has("tree-service"),
    "while the only tree donor is retired, tree-service must be free to alias elsewhere");
  assert.ok(live.has("plumbing"));
});
