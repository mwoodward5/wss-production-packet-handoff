'use strict';

function toOnboardingData(record, step) {
  void step;

  const identity = record?.identity || {};

  return {
    business: {
      name: identity.name ?? null,
      trade: record?.industry ?? null,
      city: record?.city ?? null,
      accentColor: record?.build_ready?.brand_evidence?.accent ?? null,
      logoUrl: record?.build_ready?.brand_evidence?.logo_url ?? null
    },
    mirrorUrl: record?.preview_url ?? null,
    contactPhoneDisplay: identity.phone ?? record?.phone ?? null,
    unsubscribeUrl: record?.client_id
      ? `https://wss-ai.com/u/${record.client_id}`
      : null,
    dashboardUrl: record?.report_url ?? null,
    // TODO: customerName looked for an explicit customer/contact-person field; none exists in record shape.
    customerName: null
  };
}

module.exports = { toOnboardingData };

if (require.main === module && process.argv.includes('--test')) {
  const test = require('node:test');
  const assert = require('node:assert/strict');

  const fixture = {
    city: 'Mission Viejo',
    phone: '+1 949 555 0199',
    industry: 'Roofing Contractor',
    client_id: 'client_123',
    preview_url: 'https://preview.wss-ai.com/acme-roofing',
    report_url: 'https://wss-ai.com/dashboard/client_123',
    identity: {
      name: 'Acme Roofing',
      phone: '(949) 555-0199'
    },
    build_ready: {
      brand_evidence: {
        accent: '#D94841',
        logo_url: 'https://cdn.wss-ai.com/acme-roofing/logo.png'
      }
    }
  };

  test('maps verified identity and brand fields', () => {
    assert.deepEqual(toOnboardingData(fixture, 'welcome'), {
      business: {
        name: 'Acme Roofing',
        trade: 'Roofing Contractor',
        city: 'Mission Viejo',
        accentColor: '#D94841',
        logoUrl: 'https://cdn.wss-ai.com/acme-roofing/logo.png'
      },
      mirrorUrl: 'https://preview.wss-ai.com/acme-roofing',
      contactPhoneDisplay: '(949) 555-0199',
      unsubscribeUrl: 'https://wss-ai.com/u/client_123',
      dashboardUrl: 'https://wss-ai.com/dashboard/client_123',
      customerName: null
    });
  });

  test('falls back to top-level phone when identity phone is absent', () => {
    const record = {
      ...fixture,
      identity: { name: 'Acme Roofing' }
    };

    assert.equal(toOnboardingData(record, 'welcome').contactPhoneDisplay, '+1 949 555 0199');
  });

  test('returns null rather than fabricating missing optional values', () => {
    const data = toOnboardingData(
      {
        identity: { name: 'No Brand LLC' },
        industry: 'Plumbing'
      },
      'welcome'
    );

    assert.deepEqual(data, {
      business: {
        name: 'No Brand LLC',
        trade: 'Plumbing',
        city: null,
        accentColor: null,
        logoUrl: null
      },
      mirrorUrl: null,
      contactPhoneDisplay: null,
      unsubscribeUrl: null,
      dashboardUrl: null,
      customerName: null
    });
  });

  test('does not mutate the input record', () => {
    const record = structuredClone(fixture);
    const before = structuredClone(record);

    toOnboardingData(record, 'follow-up');

    assert.deepEqual(record, before);
  });
}