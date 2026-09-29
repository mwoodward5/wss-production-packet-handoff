'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const burns = require('../fixtures/burns-record.json');
const { rendererFor, catalog, SPA } = require('../integration/renderer-selector.cjs');

test('proven original Greenfront remains selected, not a generic catalog shell', () => {
  assert.deepEqual(rendererFor({ industry: 'landscaping' }),
    { renderer: 'spa-v2', category: 'landscaping' });
  assert.equal(SPA.landscaping, 'landscaping');
});
test('catalog entries do not imply completed source adaptations', () => {
  assert.equal(catalog.count, 34);
  assert.equal(catalog.donors.length, catalog.count);
  assert.ok(catalog.donors.every(row => row.implementation_status === 'WSS_ADAPTED'));
  assert.equal(catalog.runtime_ready_count, 0);
  assert.ok(catalog.donors.every(row => row.runtime_eligible === false));
});
test('unadapted trades are not silently opted into generic SPA output', () => {
  for (const industry of ['roofing', 'electrician', 'plumber', 'dental']) {
    assert.equal(rendererFor({ industry }).renderer, 'legacy-html', industry);
  }
});
test('actual Line vertical shape preserves the proven donor', () => {
  assert.deepEqual(rendererFor({ vertical: 'landscaping' }),
    { renderer: 'spa-v2', category: 'landscaping' });
});
test('landscaping alias resolves without altering the signed input', () => {
  const input = Object.freeze({ industry: 'landscaper' });
  assert.equal(rendererFor(input).category, 'landscaping');
  assert.equal(input.industry, 'landscaper');
});
test('sandbox landscaping selects an adapted donor only for a compatible certified record', () => {
  const previousSends = process.env.GHOST_AGENCY_LINE_LIVE_SENDS;
  const previousSandbox = process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
  try {
    process.env.GHOST_AGENCY_LINE_LIVE_SENDS = '0';
    process.env.GHOST_AGENCY_SANDBOX_AUTOSEND = 'true';
    assert.equal(rendererFor(burns).donorKey, '04-landscape-connection-inc');
    assert.deepEqual(rendererFor({ industry: 'landscaping' }),
      { renderer: 'spa-v2', category: 'landscaping' });
    const unbound = { record: { ...burns.record, genie_canonical_packet: {
      ...burns.record.genie_canonical_packet, facts: {
        ...burns.record.genie_canonical_packet.facts, services_source: 'unverified',
      },
    } } };
    assert.deepEqual(rendererFor(unbound), { renderer: 'spa-v2', category: 'landscaping' });
  } finally {
    if (previousSends === undefined) delete process.env.GHOST_AGENCY_LINE_LIVE_SENDS;
    else process.env.GHOST_AGENCY_LINE_LIVE_SENDS = previousSends;
    if (previousSandbox === undefined) delete process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
    else process.env.GHOST_AGENCY_SANDBOX_AUTOSEND = previousSandbox;
  }
});
