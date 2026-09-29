import assert from 'node:assert/strict';
import test from 'node:test';

import { planSnowflake } from './snowflake-picker.mjs';
import { CROSSWALK, visualAxisSignature } from './snowflake-to-premier.mjs';

const EXPECTED_BASES = Object.freeze({
  'cinematic-console': 'signal-workbench',
  'atlas-authority': 'terrain-atlas',
  'materials-lab': 'material-ledger',
  'editorial-portfolio': 'casebook-editorial',
  'owner-letter': 'founder-broadsheet',
  'cinemagraph-immersive': 'story-assembly',
  'luxury-cinematic': 'product-cinema',
  'cream-paper': 'clinical-gallery',
  'dark-editorial': 'assurance-ledger',
  'blueprint-schematic': 'survey-section',
  'split-cinematic': 'guided-care-path',
  'magazine-owner': 'house-journal',
  'bento-configurator': 'calibrated-service',
});

test('every hero archetype maps to a coherent Premier composition base', () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(CROSSWALK.archetype)
        .map(([archetype, mapped]) => [archetype, mapped.composition_base])
    ),
    EXPECTED_BASES
  );
  assert.equal(new Set(Object.values(EXPECTED_BASES)).size, 13);
});

test('visual-axis signatures derive rendered axes from durable raw plans', () => {
  assert.deepEqual(
    visualAxisSignature({
      archetype: 'dark-editorial',
      media_treatment: 'split-tone',
      typography_pair: 'Newsreader + Space Grotesk',
      section_cadence_signature: 'proof-first',
    }),
    {
      archetype: 'dark-editorial',
      composition_base: 'assurance-ledger',
      hero_family: 'atlas-grid-reveal',
      media_treatment: 'split-tone',
      typography_pair: 'Newsreader + Space Grotesk',
      section_cadence_signature: 'proof-first',
    }
  );
});

test('same-trade planning prefers unused critical visual axes deterministically', () => {
  const history = [];
  const firstEight = [];
  for (let index = 0; index < 8; index += 1) {
    const input = {
      slug: `roofing-critical-axis-${index}`,
      vertical: 'roofing',
      retryCounter: 0,
    };
    const forward = planSnowflake(
      { input, recentPlansSameVertical: history },
      { minHamming: 0, maxRetries: 0 }
    );
    const reversed = planSnowflake(
      { input, recentPlansSameVertical: [...history].reverse() },
      { minHamming: 0, maxRetries: 0 }
    );
    assert.deepEqual(reversed.plan, forward.plan);
    firstEight.push(visualAxisSignature(forward.plan));
    history.push(forward.plan);
  }

  for (const axis of [
    'archetype',
    'composition_base',
    'media_treatment',
    'typography_pair',
    'section_cadence_signature',
  ]) {
    assert.equal(new Set(firstEight.map((signature) => signature[axis])).size, 8, axis);
  }
  assert.equal(
    new Set(firstEight.slice(0, 5).map((signature) => signature.hero_family)).size,
    5,
    'hero_family'
  );
});

test('critical-axis pools fall back deterministically after exhaustion', () => {
  const history = [];
  for (let index = 0; index < 20; index += 1) {
    const input = {
      slug: `landscape-exhaustion-${index}`,
      vertical: 'landscape.hardscape',
      retryCounter: 0,
    };
    const result = planSnowflake(
      { input, recentPlansSameVertical: history },
      { minHamming: 0, maxRetries: 0 }
    );
    assert.ok(result.plan.typography_pair);
    history.push(result.plan);
  }
  const input = {
    slug: 'landscape-exhaustion-final',
    vertical: 'landscape.hardscape',
    retryCounter: 0,
  };
  const forward = planSnowflake(
    { input, recentPlansSameVertical: history },
    { minHamming: 0, maxRetries: 0 }
  );
  const reversed = planSnowflake(
    { input, recentPlansSameVertical: [...history].reverse() },
    { minHamming: 0, maxRetries: 0 }
  );
  assert.deepEqual(reversed.plan, forward.plan);
});
