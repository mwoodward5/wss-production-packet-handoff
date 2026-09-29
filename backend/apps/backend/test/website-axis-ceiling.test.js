"use strict";

// The grade gates, pinned OFF.
//
// WHY THIS FILE EXISTS, and why it now asserts the opposite of what it did this
// morning. Until 2026-08-05 the website axis shared the composite axis's
// hardcoded C+ ceiling, and that one rule was the largest killer in the funnel:
// a 40-metro plumbing run refused lead after lead with "website already grades
// B- — better than C+, so a mirror is a lateral move", one metro going 37
// candidates -> 11 survivors with 26 dying on this rule alone. It was raised to
// B+, and the very next run was still held up by it.
//
// The owner's call, verbatim: "just drop the grading if it's a hold up like
// this — maybe try to remove it or up it." The counter-argument (a mirror of an
// already-good site is a lateral move and a weaker pitch) was put to him and he
// reaffirmed. Both grade ceilings are now OFF by default.
//
// So this file pins the NEW contract:
//
//   · every measured grade is admitted, A+ included, on BOTH axes
//   · both grades are still MEASURED and still reported — the proof email is a
//     before/after and the "before" number has to exist
//   · either ceiling can be reinstated from an env var with no deploy
//   · the things that were never grades still refuse: an UNMEASURED axis is
//     fail-closed, and the structural modernPremium veto stays on by default
//
// These are business-preference assertions. Nothing here touches the brand,
// NAP, identity or render gates, which protect the customer rather than the
// funnel and are not the owner's to trade away for volume.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MAX_WEBSITE_GRADE,
  DEFAULT_MAX_COMPOSITE_GRADE,
  WEBSITE_CEILING_ENV,
  COMPOSITE_CEILING_ENV,
  MODERN_PREMIUM_ENV,
  MAX_BUILDABLE_GRADE,
  GRADE_ORDER,
  maxBuildableWebsiteGrade,
  maxBuildableCompositeGrade,
  modernPremiumVetoActive,
  ceilingIsOff,
  gradeSlug,
  qualifyWebsiteAxis,
  qualifyCompositeAxis,
  qualifyForBuild,
} = require("../lib/build-qualification");

// Mid-band scores for each letter, from callprep-enrich gradeForScore(). Putting
// the whole axis weight on websitePerformance makes websiteAxisScore() return
// exactly the grade under test, so these cases read as the grades they name.
const SCORE = Object.freeze({ "A+": 98, A: 95, "A-": 91, "B+": 88, B: 85, "B-": 81, "C+": 78, C: 75, D: 65, F: 30 });

const axisAt = (grade, env = {}) => qualifyWebsiteAxis({
  probe: { analyzed: true, exists: true },
  categories: { websitePerformance: { score: SCORE[grade] } },
  env,
});

test("both grade ceilings default to off", () => {
  assert.equal(DEFAULT_MAX_WEBSITE_GRADE, "off");
  assert.equal(DEFAULT_MAX_COMPOSITE_GRADE, "off");
  assert.equal(maxBuildableWebsiteGrade({}), "off");
  assert.equal(maxBuildableCompositeGrade({}), "off");
  assert.ok(ceilingIsOff("off"));
  assert.ok(!ceilingIsOff("C+"));
});

test("no measured grade is refused on either axis — that is the whole change", () => {
  for (const grade of ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"]) {
    assert.equal(axisAt(grade).ok, true, `${grade} must be admitted with the gate off`);
    assert.equal(qualifyCompositeAxis({ score: SCORE[grade], grade }, {}).ok, true,
      `composite ${grade} must be admitted with the gate off`);
  }
});

test("the grade is still measured and still spoken, so the before/after survives", () => {
  // Dropping the GATE is not dropping the MEASUREMENT. If this regresses, the
  // proof email loses the "before" half of its only argument.
  const verdict = axisAt("A");
  assert.equal(verdict.ok, true);
  assert.equal(verdict.website.grade, "A");
  assert.equal(verdict.website.score, 95);
  // And the sentence says the gate is off rather than implying A was under a
  // bar — a funnel that misreports why a lead passed is a funnel nobody can audit.
  assert.match(verdict.reasons[0], /grades A \(95\)/);
  assert.match(verdict.reasons[0], /gate is off/);
});

test("either ceiling can be reinstated from the environment, with no deploy", () => {
  const oldWebsite = { [WEBSITE_CEILING_ENV]: "C+" };
  for (const grade of ["A", "A-", "B+", "B", "B-"]) {
    assert.equal(axisAt(grade, oldWebsite).ok, false, `${grade} was refused under the old rule`);
  }
  for (const grade of ["C+", "C", "D"]) {
    assert.equal(axisAt(grade, oldWebsite).ok, true, `${grade} was admitted under the old rule`);
  }
  // Case-insensitive, and the composite axis has its own independent switch.
  assert.equal(maxBuildableWebsiteGrade({ [WEBSITE_CEILING_ENV]: "b+" }), "B+");
  assert.equal(qualifyCompositeAxis({ score: 85, grade: "B" }, { [COMPOSITE_CEILING_ENV]: "C+" }).ok, false);
  assert.equal(qualifyCompositeAxis({ score: 85, grade: "B" }, {}).ok, true);
});

test("an unrecognised value falls back to the default instead of being guessed at", () => {
  for (const bad of ["   ", "excellent", "very bad", "B++"]) {
    assert.equal(maxBuildableWebsiteGrade({ [WEBSITE_CEILING_ENV]: bad }), "off");
    assert.equal(maxBuildableCompositeGrade({ [COMPOSITE_CEILING_ENV]: bad }), "off");
  }
  // Every spelling of "off" an operator might reach for.
  for (const off of ["off", "none", "any", "no", "false", "0", "disabled", "OFF"]) {
    assert.equal(maxBuildableWebsiteGrade({ [WEBSITE_CEILING_ENV]: off }), "off");
  }
});

test("qualifyForBuild admits an excellent site on both axes, and says so honestly", () => {
  const verdict = qualifyForBuild({
    categories: { websitePerformance: { score: SCORE.A } },
    overallScore: 95,
    overallGrade: "A",
    probe: { analyzed: true, exists: true },
    env: {},
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.website_ceiling, "off");
  assert.equal(verdict.ceiling, "off");
  assert.match(verdict.reasons.join(" "), /website A \(gate off\), Signal A \(gate off\)/);
});

test("the miner's counter key still names the rule that fired", () => {
  // lib/lead-miner.js stage 3 builds its rejection bucket from this slug. With
  // the gate off the bucket should never be reached at all, but if a ceiling is
  // reinstated it must name the ceiling that actually refused the lead.
  assert.equal(gradeSlug("B+"), "B_plus");
  assert.equal(gradeSlug("C+"), "C_plus");
  assert.equal(gradeSlug("B-"), "B_minus");
  assert.equal(`website_axis_above_${gradeSlug("C+")}`, "website_axis_above_C_plus");
});

// --- what the owner did NOT ask to remove -----------------------------------

test("the modernPremium veto still refuses an excellent site, at any ceiling", () => {
  // Not a grade — a structural read from site-weakness.js: modern framework,
  // responsive, real depth, schema. It runs before any grade comparison, so
  // even a wide-open ceiling and an F-grade axis cannot force this build.
  const verdict = qualifyWebsiteAxis({
    probe: { analyzed: true, exists: true, modernPremium: true },
    categories: { websitePerformance: { score: SCORE.F } },
    env: {},
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /modern, responsive, well-built site/);
  // It is separately switchable, because the owner may want it gone too.
  assert.equal(modernPremiumVetoActive({}), true);
  assert.equal(modernPremiumVetoActive({ [MODERN_PREMIUM_ENV]: "off" }), false);
  const dropped = qualifyWebsiteAxis({
    probe: { analyzed: true, exists: true, modernPremium: true },
    categories: { websitePerformance: { score: SCORE.F } },
    env: { [MODERN_PREMIUM_ENV]: "off" },
  });
  assert.equal(dropped.ok, true);
});

test("an unmeasured axis blocks only where a ceiling is actually enforced", () => {
  // SHARPENED 2026-08-06 from "unmeasured is always fail-closed".
  //
  // That coarser rule was right while a ceiling was being enforced: you cannot
  // show a grade sits under a bar you were unable to compute. With no bar there
  // is nothing to prove, and refusing anyway is the gate the owner removed
  // still firing under a different name — which is worse than firing openly.
  //
  // What actually protects the build spend is upstream and untouched: stage 2
  // refuses a site we could not fetch, stage 6 refuses NAP we could not verify
  // against Google, and the brand gate refuses a logo we could not resolve. A
  // missing SCORE is a scoring gap, not blindness about the lead.
  const off = qualifyWebsiteAxis({ probe: { analyzed: true, exists: true }, categories: {}, env: {} });
  assert.equal(off.ok, true);
  assert.equal(off.unmeasured, true, "it is still recorded as unmeasured — we do not pretend we scored them");
  assert.match(off.reasons[0], /unmeasured/);
  assert.equal(off.ceiling, "off");

  const build = qualifyForBuild({ categories: {}, overallScore: null, probe: { analyzed: true, exists: true }, env: {} });
  assert.equal(build.ok, true);
  assert.equal(build.unmeasured, true);
  assert.match(build.reasons.join(" "), /unmeasured/);

  // ...but reinstate a ceiling and unmeasured is fail-closed again, on both axes.
  const on = { [WEBSITE_CEILING_ENV]: "C+", [COMPOSITE_CEILING_ENV]: "C+" };
  assert.equal(qualifyWebsiteAxis({ probe: { analyzed: true, exists: true }, categories: {}, env: on }).ok, false);
  assert.equal(qualifyCompositeAxis(null, on).ok, false);
  const blocked = qualifyForBuild({ categories: {}, overallScore: null, probe: { analyzed: true, exists: true }, env: on });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reasons.join(" "), /cannot prove it sits under the C\+ ceiling/);
});

test("an unscored business is unmeasured, never grade F", () => {
  // Number(null) is 0 and Number.isFinite(0) is true, so the old guard turned
  // "we never measured this business" into score 0, grade F. Under the C+
  // ceiling an F sailed through, so it never surfaced as a bug — it surfaced as
  // a FACT, because the proof email prints the "before" grade. Telling a
  // prospect they grade F when we never scored them is a fabricated claim about
  // their business, which is the one thing this system may not do.
  for (const missing of [null, undefined, ""]) {
    const v = qualifyForBuild({
      categories: { websitePerformance: { score: 75 } },
      overallScore: missing,
      probe: { analyzed: true, exists: true },
      env: {},
    });
    assert.equal(v.composite, null, `overallScore ${JSON.stringify(missing)} must not become a grade`);
  }
  // A genuine zero is a measurement and must survive as one.
  const real = qualifyForBuild({
    categories: { websitePerformance: { score: 75 } },
    overallScore: 0,
    probe: { analyzed: true, exists: true },
    env: {},
  });
  assert.deepEqual(real.composite, { score: 0, grade: "F" });
});

test("a prospect with no website at all is still the strongest lead in the pool", () => {
  const verdict = qualifyWebsiteAxis({ probe: { analyzed: true, exists: false }, categories: null, env: {} });
  assert.equal(verdict.ok, true);
  assert.match(verdict.reasons[0], /no website/);
});

test("the restore point is still a real grade on the one shared curve", () => {
  // GRADE_ORDER is the only definition of grade order in the codebase. The
  // documented restore value must live on it, or reinstating a ceiling would
  // silently refuse everything via gradeRank() === -1.
  assert.ok(GRADE_ORDER.includes(MAX_BUILDABLE_GRADE));
  assert.equal(maxBuildableWebsiteGrade({ [WEBSITE_CEILING_ENV]: MAX_BUILDABLE_GRADE }), "C+");
});
