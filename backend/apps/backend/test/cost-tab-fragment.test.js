// test/cost-tab-fragment.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const makeCostTab = require('../lib/console/cost-tab-fragment.cjs');
const registerCostTab = require('../lib/console/register-cost-tab.cjs');

const SECTION = `
<section id="cost-tab">
  <h2>Costs</h2>
</section>
`;

function stripScriptTags(value) {
  return String(value)
    .replace(/^\s*<script>\s*/i, '')
    .replace(/\s*<\/script>\s*$/i, '');
}

test('constructed HTML contains the cost-tab section id', () => {
  const fragment = makeCostTab(SECTION);

  assert.equal(typeof fragment.costTabHtml, 'function');
  assert.equal(typeof fragment.costMeterBootScript, 'function');
  assert.match(fragment.costTabHtml(), /id=["']cost-tab["']/);
});

test('boot script parses via new Function', () => {
  const { costMeterBootScript } = makeCostTab(SECTION);

  const script = costMeterBootScript(
    '/api/admin/cost-rates.json',
    '/api/admin/cost-events'
  );

  assert.doesNotThrow(() => {
    new Function(stripScriptTags(script));
  });
});

test('boot script contains no external hosts', () => {
  const { costMeterBootScript } = makeCostTab(SECTION);

  const script = costMeterBootScript(
    '/api/admin/cost-rates.json',
    '/api/admin/cost-events'
  );

  assert.doesNotMatch(script, /https?:\/\//i);
  assert.doesNotMatch(script, /\/\/[^\s"'<>]+\.[a-z]{2,}/i);
});

test('boot script wires rates, events, auth, create, exposure, and refresh', () => {
  const { costMeterBootScript } = makeCostTab(SECTION);

  const script = costMeterBootScript(
    '/rates.json',
    '/api/cost-events'
  );

  assert.match(script, /fetch\(ratesJsonUrl/);
  assert.match(script, /function fetchEvents\(sinceISO\)/);
  assert.match(script, /window\.getAuthToken/);
  assert.match(script, /getElementById\(['"]token['"]\)/);
  assert.match(script, /Authorization = 'Bearer ' \+ token/);
  assert.match(script, /costMeterApi\.create\(/);
  assert.match(script, /fetchEvents: fetchEvents/);
  assert.match(script, /rates: rates/);
  assert.match(script, /window\.WSSCostMeter = meter/);
  assert.match(script, /meter\.refresh\(\)/);
});

test('registerCostTab script parses and includes defensive fallback', () => {
  const script = registerCostTab(
    '#console-nav',
    '#console-panels',
    SECTION
  );

  assert.doesNotThrow(() => {
    new Function(stripScriptTags(script));
  });

  assert.match(script, /textContent = 'Costs'/);
  assert.match(script, /setAttribute\('data-view', 'costs'\)/);
  assert.match(script, /registerIntegrated/);
  assert.match(script, /registerStandalone/);
  assert.match(script, /textContent = 'Show Costs'/);
  assert.match(script, /appendChild\(section\)/);
});
