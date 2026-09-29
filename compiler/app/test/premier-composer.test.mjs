import assert from "node:assert/strict";
import test from "node:test";

import planPremierComposition, {
  compositionFingerprint,
  normalizeVertical,
  PREMIER_COMPOSITION_AXES,
  PREMIER_COMPOSITION_SCHEMA,
} from "../../factory/lib/premier-composer.mjs";

test("premier composition is deterministic and returns independent data", () => {
  const input = { vertical: "landscaping", businessSeed: "Cedar and Stone" };
  const first = planPremierComposition(input);
  const second = planPremierComposition(input);

  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.layoutGravity, second.layoutGravity);
  assert.equal(first.schema, PREMIER_COMPOSITION_SCHEMA);
  assert.match(first.compositionFingerprint, /^pc1-[a-f0-9]{24}$/);

  first.layoutGravity.anchor = "mutated by caller";
  assert.notEqual(planPremierComposition(input).layoutGravity.anchor, "mutated by caller");
});

test("packet-shaped input and category synonyms normalize consistently", () => {
  const packetPlan = planPremierComposition({
    slug: "summit-roofing",
    business: { name: "Summit Roofing", category: "Residential Roofing Contractor" },
  });
  const directPlan = planPremierComposition("roofing", "summit-roofing");

  assert.equal(normalizeVertical("Residential Roofing Contractor"), "built-environment");
  assert.equal(normalizeVertical("SaaS workflow platform"), "software");
  assert.equal(packetPlan.vertical, "built-environment");
  assert.deepEqual(packetPlan, directPlan);
});

test("business seed selects multiple coherent archetypes within one vertical", () => {
  const plans = Array.from({ length: 40 }, (_, index) => planPremierComposition({
    vertical: "landscaping",
    businessSeed: `landscape-business-${index}`,
  }));
  const archetypeIds = new Set(plans.map((plan) => plan.archetype.id));
  const repeatedPlans = plans.map((_, index) => planPremierComposition({
    vertical: "landscaping",
    businessSeed: `landscape-business-${index}`,
  }));

  assert.deepEqual([...archetypeIds].sort(), [
    "cultivated-editorial",
    "local-signature",
    "maker-lookbook",
    "material-ledger",
    "survey-section",
    "terrain-atlas",
  ]);
  assert.equal(new Set(plans.map((plan) => plan.archetype.edition)).size, 3);
  assert.equal(new Set(plans.map((plan) => plan.compositionFingerprint)).size, plans.length);
  assert.deepEqual(repeatedPlans, plans);
});

test("explicit composition slots guarantee distinct first-batch archetypes", () => {
  const plans = Array.from({ length: 6 }, (_, composition_slot) => planPremierComposition({
    category: "landscaping",
    business: { name: `Landscape ${composition_slot}` },
    composition_slot,
  }));

  assert.deepEqual(plans.map((plan) => plan.compositionSlot), [0, 1, 2, 3, 4, 5]);
  assert.equal(new Set(plans.map((plan) => plan.archetype.id)).size, 6);
  assert.equal(new Set(plans.map((plan) => plan.compositionFingerprint)).size, 6);
});

test("explicit composition base resolves across vertical archetype pools", () => {
  const requested = planPremierComposition({
    category: "landscaping",
    businessSeed: "Composition Base Test",
    compositionBase: "signal-workbench",
  });
  const snakeCaseRequested = planPremierComposition({
    category: "landscaping",
    businessSeed: "Composition Base Test",
    composition_base: "  SIGNAL-WORKBENCH  ",
  });

  assert.equal(requested.vertical, "landscape");
  assert.equal(requested.compositionBase, "signal-workbench");
  assert.equal(requested.archetype.id, "signal-workbench");
  assert.equal(requested.layoutGravity.id, "workbench-asymmetric");
  assert.equal(requested.heroAnatomy.id, "input-decision-output");
  assert.deepEqual(snakeCaseRequested, requested);
  assert.throws(
    () => planPremierComposition({ category: "landscaping", compositionBase: "not-an-archetype" }),
    /Unknown composition base: not-an-archetype/,
  );
});

test("omitting composition base preserves the existing deterministic plan shape", () => {
  const plan = planPremierComposition({
    category: "landscaping",
    businessSeed: "No Explicit Base",
  });

  assert.equal(Object.hasOwn(plan, "compositionBase"), false);
});

test("six verticals produce materially different composition systems", () => {
  const plans = [
    ["landscaping", "Cedar Field Works"],
    ["roofing", "Summit Envelope"],
    ["dental clinic", "Harbor Dental"],
    ["restaurant", "Juniper Table"],
    ["SaaS", "Signal Desk"],
    ["automotive service", "Northline Auto"],
  ].map(([vertical, businessSeed]) => planPremierComposition({ vertical, businessSeed }));

  assert.equal(new Set(plans.map((plan) => plan.compositionFingerprint)).size, plans.length);
  assert.equal(new Set(plans.map((plan) => plan.archetype.id)).size, plans.length);
  assert.equal(new Set(plans.map((plan) => plan.archetype.surfaceFamily)).size, plans.length);

  for (let left = 0; left < plans.length; left += 1) {
    const serialized = JSON.stringify(plans[left]);
    assert.doesNotMatch(serialized, /wave|generic-card|card-grid/i);

    for (let right = left + 1; right < plans.length; right += 1) {
      const differingAxes = PREMIER_COMPOSITION_AXES.filter((axis) => {
        return plans[left][axis].id !== plans[right][axis].id;
      });
      assert.ok(
        differingAxes.length >= 8,
        `${plans[left].vertical} and ${plans[right].vertical} differ on only ${differingAxes.length} axes`,
      );
    }
  }
});

test("every requested axis is renderer-ready", () => {
  const plan = planPremierComposition({ vertical: "electrical", businessSeed: "Arc Electric" });

  for (const axis of PREMIER_COMPOSITION_AXES) {
    assert.equal(typeof plan[axis], "object", `${axis} should be an object`);
    assert.ok(plan[axis].id, `${axis} should expose a stable id`);
  }
  assert.equal(plan.sectionCadence.sequence.length, 8);
  assert.equal(plan.palette.background.startsWith("#"), true);
  assert.match(plan.typographyPair.recipe, /^master-glue-kitchen\/recipes\/typography\//);
  assert.match(plan.motionEffect.reducedMotion, /remove transforms/);
  assert.ok(plan.reviewTreatment.attribution.includes("source"));
});

test("composition fingerprint is canonical and ignores property order", () => {
  const plan = planPremierComposition({ vertical: "restaurant", businessSeed: "Juniper Table" });
  const reordered = Object.fromEntries(Object.entries(plan).reverse());

  assert.equal(compositionFingerprint(reordered), plan.compositionFingerprint);
  assert.throws(() => compositionFingerprint(null), /composition must be an object/);
});
