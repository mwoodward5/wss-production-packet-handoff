"use strict";

/**
 * test/donor-exclusions.test.js — the owner-barred "bad apples" list.
 *
 * Owner directive (2026-08-31): nationwide all-trades campaigns run on ~10-12
 * donor templates, and two are suspected of triggering deep template-specific
 * failures — tattoo-aurelia (the ONLY tattoo donor) and medspa-luma (the ONLY
 * med spa donor). Both are OFF for fresh line campaigns:
 *
 *   1. They never get SELECTED (miner outreach roster, all-trades rotation).
 *   2. A pick in their vertical is REFUSED AT ADMISSION — before any Intake
 *      Genie compile spend — with the terminal cause
 *      donor_unavailable_for_vertical, riding the same quarantine metadata
 *      path as pick_name_implausible.
 *   3. GHOST_AGENCY_DONOR_EXCLUSIONS can re-include them ("none") or replace
 *      the list — the escape hatch for an owner-named diagnostic run.
 *
 * The engine itself (lib/mirror-engine/donor.js resolveDonor) is untouched on
 * purpose: an existing tattoo/med-spa customer keeps rebuilding, same law as
 * retired_for_outreach — closed to new campaigns, still buildable.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DONOR_EXCLUSION_CAUSE,
  DEFAULT_DONOR_EXCLUSIONS,
  donorExclusions,
  isDonorExcluded,
} = require("../lib/donor-exclusions");
const { resolveBuildableDonor, outreachDonors, buildableVerticals } = require("../lib/lead-miner");
const { buildableVerticals: consoleVerticals } = require("../lib/buildable-verticals");
const { openVerticalNames } = require("../lib/line-quota");
const { pickProspects } = require("../lib/line-adapters");

const EXCLUDED_VERTICALS = [
  { vertical: "tattoo", donor: "tattoo-aurelia" },
  { vertical: "med spa", donor: "medspa-luma" },
];

function withEnv(value, fn) {
  const prior = process.env.GHOST_AGENCY_DONOR_EXCLUSIONS;
  if (value === undefined) delete process.env.GHOST_AGENCY_DONOR_EXCLUSIONS;
  else process.env.GHOST_AGENCY_DONOR_EXCLUSIONS = value;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.GHOST_AGENCY_DONOR_EXCLUSIONS;
    else process.env.GHOST_AGENCY_DONOR_EXCLUSIONS = prior;
  }
}

// ---------------------------------------------------------------------------
// 1. THE LIST
// ---------------------------------------------------------------------------

test("the default exclusion list names exactly the two suspected bad apples", () => {
  assert.ok(Object.isFrozen(DEFAULT_DONOR_EXCLUSIONS), "the default list must be frozen");
  assert.deepEqual([...DEFAULT_DONOR_EXCLUSIONS], ["tattoo-aurelia", "medspa-luma"]);
  assert.equal(DONOR_EXCLUSION_CAUSE, "donor_unavailable_for_vertical");

  const set = donorExclusions();
  assert.ok(set instanceof Set);
  assert.equal(isDonorExcluded("tattoo-aurelia"), true);
  assert.equal(isDonorExcluded("medspa-luma"), true);
  assert.equal(isDonorExcluded("plumbing-clean"), false);
  assert.equal(isDonorExcluded("TATTOO-Aurelia"), true, "matching is case-insensitive");
  assert.equal(isDonorExcluded(""), false);
});

test("GHOST_AGENCY_DONOR_EXCLUSIONS replaces the default list; 'none' re-includes every donor", () => {
  assert.deepEqual([...withEnv("none", () => donorExclusions())], []);
  assert.deepEqual([...withEnv("", () => donorExclusions())].sort(), ["medspa-luma", "tattoo-aurelia"]);
  assert.deepEqual([...withEnv("medspa-luma", () => donorExclusions())], ["medspa-luma"]);
  assert.deepEqual([...withEnv("tattoo-aurelia, roofing-falcon-clean", () => donorExclusions())].sort(),
    ["roofing-falcon-clean", "tattoo-aurelia"]);
  assert.deepEqual([...withEnv("tattoo-aurelia;medspa-luma plumbing-clean", () => donorExclusions())].sort(),
    ["medspa-luma", "plumbing-clean", "tattoo-aurelia"]);
  assert.equal(withEnv("none", () => isDonorExcluded("tattoo-aurelia")), false);
});

// ---------------------------------------------------------------------------
// 2. SELECTION — the excluded donors are never named for a line campaign
// ---------------------------------------------------------------------------

test("the miner's outreach roster and buildable verticals drop both excluded donors", () => {
  const roster = outreachDonors().map((d) => d.donor);
  assert.equal(roster.includes("tattoo-aurelia"), false, "tattoo-aurelia is still on the outreach roster");
  assert.equal(roster.includes("medspa-luma"), false, "medspa-luma is still on the outreach roster");
  assert.equal(roster.includes("plumbing-clean"), true, "the exclusion is not a roster wipeout");

  const industries = buildableVerticals().map((v) => v.industry);
  assert.equal(industries.includes("tattoo"), false);
  assert.equal(industries.includes("med spa"), false);
  assert.equal(industries.includes("plumbing"), true);
});

test("the console vertical list flags the excluded donors without hiding the verticals", () => {
  const byVertical = new Map(consoleVerticals().map((row) => [row.vertical, row]));
  for (const { vertical, donor } of EXCLUDED_VERTICALS) {
    const row = byVertical.get(vertical);
    assert.ok(row, `${vertical} vanished from the console list — an exclusion is a flag, not a deletion`);
    assert.equal(row.donor, donor);
    assert.equal(row.donorExcluded, true);
  }
  assert.equal(byVertical.get("plumbing").donorExcluded, false);
  assert.equal(byVertical.get("plumbing").donor, "plumbing-clean");
});

test("the nationwide all-trades rotation never spends a source slot on an excluded vertical", () => {
  const open = openVerticalNames();
  assert.equal(open.includes("tattoo"), false);
  assert.equal(open.includes("med spa"), false);
  for (const vertical of ["plumbing", "hvac", "fencing", "concrete", "electrical", "general contractor", "landscaping", "roofing", "salon"]) {
    assert.equal(open.includes(vertical), true, `${vertical} went dark`);
  }
  // The rotation is a policy view, not a second list: an explicit re-include
  // restores the vertical without touching ALL_TRADES_VERTICAL_ORDER.
  const reopened = withEnv("none", () => openVerticalNames());
  assert.equal(reopened.includes("tattoo"), true);
  assert.equal(reopened.includes("med spa"), true);
});

// ---------------------------------------------------------------------------
// 3. ADMISSION — a pick in an excluded vertical refuses with the NAMED cause
// ---------------------------------------------------------------------------

test("tattoo and med spa refuse donor selection with donor_unavailable_for_vertical", () => {
  for (const { vertical, donor } of EXCLUDED_VERTICALS) {
    const out = resolveBuildableDonor(vertical);
    assert.equal(out.ok, false, vertical);
    assert.equal(out.reason, DONOR_EXCLUSION_CAUSE, `${vertical} must name the exclusion cause: ${JSON.stringify(out)}`);
    assert.deepEqual(out.excludedDonors, [donor], `${vertical} must name the excluded donor`);
  }
});

test("a plumbing pick still selects the plumbing donor", () => {
  const out = resolveBuildableDonor("plumbing");
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.donor, "plumbing-clean");
  assert.equal(out.vertical, "plumbing");
  // The plumber alias rides the same donor.
  const alias = resolveBuildableDonor("plumber");
  assert.equal(alias.ok, true, JSON.stringify(alias));
  assert.equal(alias.donor, "plumbing-clean");
});

test("env override re-includes the excluded verticals end to end", () => {
  withEnv("none", () => {
    for (const { vertical, donor } of EXCLUDED_VERTICALS) {
      const out = resolveBuildableDonor(vertical);
      assert.equal(out.ok, true, `${vertical}: ${JSON.stringify(out)}`);
      assert.equal(out.donor, donor);
    }
    assert.equal(resolveBuildableDonor("plumbing").donor, "plumbing-clean");
  });
});

// ---------------------------------------------------------------------------
// 4. LINE ADMISSION — the pick itself is refused before any compile spend
// ---------------------------------------------------------------------------

function heldPacketRow(id, name, industry) {
  const record = {
    prospect_id: id,
    business_name: name,
    city: "Tulsa",
    state: "OK",
    industry,
    email: `${id}@example.test`,
    status: "held",
    build_ready: false,
    handoff_state: "held_incomplete",
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: {
      meta: { source: "leadminer_mirror_ready" },
      industry,
      services: [],
      mirror_ready: {
        business_name: name,
        city: "Tulsa",
        state: "OK",
        industry,
        services: [],
      },
    },
  };
  return {
    prospect_id: id,
    business_name: name,
    city: "Tulsa",
    state: "OK",
    industry,
    email: `${id}@example.test`,
    status: "held",
    record,
    updated_at: "2026-08-31T00:00:01.000Z",
  };
}

function realDonorDeps(rows, overrides = {}) {
  // resolveBuildableDonor is deliberately NOT injected: the refusal under test
  // is the real exclusion, not a fixture.
  return {
    async select() { return { ok: true, data: rows }; },
    async mineLeads() { throw new Error("exact selection must never mine"); },
    async conditionalUpdate() { return { ok: true, updated: true, rows: [] }; },
    clock: () => Date.parse("2026-08-31T12:00:00.000Z"),
    ...overrides,
  };
}

test("an exact-ID tattoo pick is refused at admission with the exclusion cause", async () => {
  const row = heldPacketRow("aurelia-pick", "Golden Needle Tattoo Studio", "tattoo");
  await assert.rejects(
    () => pickProspects({ count: 1, prospectIds: [row.prospect_id] }, realDonorDeps([row])),
    (error) => error?.code === "explicit_prospect_ids_ineligible"
      && error.reasons.includes(DONOR_EXCLUSION_CAUSE),
  );
});

test("an exact-ID med spa pick is refused at admission with the exclusion cause", async () => {
  const row = heldPacketRow("luma-pick", "Serene Beauty Med Spa", "med spa");
  await assert.rejects(
    () => pickProspects({ count: 1, prospectIds: [row.prospect_id] }, realDonorDeps([row])),
    (error) => error?.code === "explicit_prospect_ids_ineligible"
      && error.reasons.includes(DONOR_EXCLUSION_CAUSE),
  );
});

test("an exact-ID plumbing pick still admits against the real plumbing donor", async () => {
  const row = heldPacketRow("plumb-pick", "Backlund Plumbing LLC", "plumbing");
  const picked = await pickProspects({ count: 1, lane: "sandbox", prospectIds: [row.prospect_id] }, realDonorDeps([row]));
  assert.deepEqual(picked.map((candidate) => candidate.prospectId), [row.prospect_id]);
  assert.equal(picked[0].vertical, "plumbing");
});

test("an env re-include lets the same tattoo pick admit again", async () => {
  const prior = process.env.GHOST_AGENCY_DONOR_EXCLUSIONS;
  process.env.GHOST_AGENCY_DONOR_EXCLUSIONS = "none";
  try {
    const row = heldPacketRow("aurelia-back", "Golden Needle Tattoo Studio", "tattoo");
    const picked = await pickProspects({ count: 1, lane: "sandbox", prospectIds: [row.prospect_id] }, realDonorDeps([row]));
    assert.deepEqual(picked.map((candidate) => candidate.prospectId), [row.prospect_id]);
    assert.equal(picked[0].vertical, "tattoo");
  } finally {
    if (prior === undefined) delete process.env.GHOST_AGENCY_DONOR_EXCLUSIONS;
    else process.env.GHOST_AGENCY_DONOR_EXCLUSIONS = prior;
  }
});
