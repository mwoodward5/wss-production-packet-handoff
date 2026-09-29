// test/renderer-registry.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderForProspect,
  listKinds,
} = require('../lib/email/renderer-registry.cjs');

const record = {
  identity: {
    name: 'Test Trade Co.',
  },
  city: 'Test City',
  industry: 'plumbing',
  client_id: 'client-test-001',
};

function assertHtmlOrCleanError(result, kind) {
  assert.equal(result.kind, kind);

  if (Object.prototype.hasOwnProperty.call(result, 'error')) {
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
    assert.deepEqual(
      Object.keys(result).sort(),
      ['error', 'kind']
    );
    return;
  }

  assert.equal(typeof result.html, 'string');
  assert.ok(result.html.length > 0);
}

test('listKinds returns all supported renderer kinds', () => {
  assert.deepEqual(listKinds(), [
    'onboarding',
    'monthly',
    'followup',
  ]);

  const first = listKinds();
  first.push('mutated');

  assert.deepEqual(listKinds(), [
    'onboarding',
    'monthly',
    'followup',
  ]);
});

test('onboarding returns html or a clean error object', () => {
  const result = renderForProspect('onboarding', record, {
    step: 1,
  });

  assertHtmlOrCleanError(result, 'onboarding');
});

test('monthly returns html or a clean error object', () => {
  const result = renderForProspect('monthly', record, {
    statsRow: {},
  });

  assertHtmlOrCleanError(result, 'monthly');
});

test('followup returns html or a clean error object', () => {
  const result = renderForProspect('followup', record, {
    sentLog: [],
    now: new Date('2026-08-20T12:00:00.000Z'),
  });

  assertHtmlOrCleanError(result, 'followup');
});

test('unknown kind returns a clean error object', () => {
  const result = renderForProspect('not-a-kind', record);

  assert.deepEqual(Object.keys(result).sort(), [
    'error',
    'kind',
  ]);
  assert.equal(result.kind, 'not-a-kind');
  assert.equal(typeof result.error, 'string');
  assert.match(result.error, /unknown renderer kind/i);
});

test('onboarding html contains the injected unsubscribe link', () => {
  const result = renderForProspect('onboarding', record, {
    step: 1,
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(result, 'error'),
    false,
    result.error
  );

  assert.equal(typeof result.html, 'string');
  assert.ok(
    result.html.includes(
      'https://wss-ai.com/u/client-test-001'
    ),
    'expected onboarding html to contain injected unsubscribeUrl'
  );
});
