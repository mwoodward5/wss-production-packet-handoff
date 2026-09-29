'use strict';

function toMonthlyReportData(record, statsRow) {
  const r = record && typeof record === 'object' ? record : {};
  const s = statsRow && typeof statsRow === 'object' ? statsRow : {};
  const identity = r.identity && typeof r.identity === 'object' ? r.identity : {};

  const stats = {};
  for (const key of [
    'siteVisits',
    'leads',
    'rileyCalls',
    'reviewsNew',
    'editsMade',
  ]) {
    if (Object.prototype.hasOwnProperty.call(s, key)) {
      stats[key] = s[key];
    }
  }

  const sourceLeads = Array.isArray(s.leads) ? s.leads : [];

  return {
    business: {
      name: identity.name ?? null,
      trade: r.industry ?? null, // TODO: looked for verified trade under record.identity; identity has no trade/industry field in the supplied shape.
      city: r.city ?? null, // TODO: looked for verified city under record.identity; identity has no city field in the supplied shape.
      accentColor: r.brand_evidence?.accent ?? null, // TODO: looked for accent under record.identity; supplied identity shape has no accent field.
      logoUrl: r.brand_evidence?.logo_url ?? null, // TODO: looked for logo under record.identity; supplied identity shape has no logo field.
    },
    month: Object.prototype.hasOwnProperty.call(s, 'month') ? s.month : null,
    stats,
    leads: sourceLeads.map((lead) => ({
      name: lead?.name ?? null,
      phone: lead?.phone ?? null,
      source: lead?.source ?? null,
    })),
    dashboardUrl: Object.prototype.hasOwnProperty.call(s, 'dashboardUrl')
      ? s.dashboardUrl
      : null,
    unsubscribeUrl: r.client_id ?? null,
  };
}

module.exports = { toMonthlyReportData };

if (require.main === module && process.argv.includes('--test')) {
  const test = require('node:test');
  const assert = require('node:assert/strict');

  const fixture = {
    client_id: 'client_123',
    city: 'Tulsa',
    industry: 'plumbing',
    identity: {
      name: 'Fixture Plumbing',
      phone: '9185550100',
      domain: 'fixture.example',
      address: '123 Main St',
      placeId: 'place_123',
    },
    brand_evidence: {
      accent: '#1a73e8',
      logo_url: 'https://fixture.example/logo.png',
    },
  };

  test('adapts brand, month, URLs, and supplied stats', () => {
    const result = toMonthlyReportData(fixture, {
      month: '2026-08',
      siteVisits: 42,
      leads: 3,
      rileyCalls: 2,
      reviewsNew: 1,
      editsMade: 4,
      dashboardUrl: 'https://app.example/dashboard',
    });

    assert.deepEqual(result.business, {
      name: 'Fixture Plumbing',
      trade: 'plumbing',
      city: 'Tulsa',
      accentColor: '#1a73e8',
      logoUrl: 'https://fixture.example/logo.png',
    });
    assert.equal(result.month, '2026-08');
    assert.deepEqual(result.stats, {
      siteVisits: 42,
      leads: 3,
      rileyCalls: 2,
      reviewsNew: 1,
      editsMade: 4,
    });
    assert.equal(result.dashboardUrl, 'https://app.example/dashboard');
    assert.equal(result.unsubscribeUrl, 'client_123');
  });

  test('omits missing analytics stat keys rather than inventing zeroes', () => {
    const result = toMonthlyReportData(fixture, {
      month: '2026-08',
      leads: 0,
      editsMade: 2,
    });

    assert.deepEqual(result.stats, {
      leads: 0,
      editsMade: 2,
    });
    assert.equal(Object.hasOwn(result.stats, 'siteVisits'), false);
    assert.equal(Object.hasOwn(result.stats, 'rileyCalls'), false);
    assert.equal(Object.hasOwn(result.stats, 'reviewsNew'), false);
  });

  test('passes through lead fields without fabricating missing values', () => {
    const result = toMonthlyReportData(fixture, {
      leads: [
        { name: 'Jane', phone: '5551112222', source: 'website' },
        { name: 'Sam' },
      ],
    });

    assert.deepEqual(result.leads, [
      { name: 'Jane', phone: '5551112222', source: 'website' },
      { name: 'Sam', phone: null, source: null },
    ]);

    assert.deepEqual(result.stats, {
      leads: [
        { name: 'Jane', phone: '5551112222', source: 'website' },
        { name: 'Sam' },
      ],
    });
  });

  test('returns null for unavailable scalar fields', () => {
    const result = toMonthlyReportData({}, {});

    assert.deepEqual(result, {
      business: {
        name: null,
        trade: null,
        city: null,
        accentColor: null,
        logoUrl: null,
      },
      month: null,
      stats: {},
      leads: [],
      dashboardUrl: null,
      unsubscribeUrl: null,
    });
  });
}
