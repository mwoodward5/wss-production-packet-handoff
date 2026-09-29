'use strict';

function toFollowupInputs(record, sentLog) {
  const events = Array.isArray(sentLog) ? sentLog : [];

  const sends = events
    .filter((e) => e && e.type === 'send' && e.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const latestStamp = (type) => {
    const stamps = events
      .filter((e) => e && e.type === type && e.created_at)
      .map((e) => e.created_at)
      .sort((a, b) => new Date(a) - new Date(b));
    return stamps.length ? stamps[stamps.length - 1] : null;
  };

  const sentSteps = sends
    .map((e) => Number(e.step))
    .filter((step) => Number.isInteger(step) && step >= 1);

  const firstSentAt = sends.length ? sends[0].created_at : null;
  const lastStep = sentSteps.length ? Math.max(...sentSteps) : 0;

  const business = {
    name: record?.identity?.name ?? record?.business_name ?? null,
    trade: record?.industry ?? null,
    city: record?.city ?? null,
    accentColor: record?.brand_evidence?.accent ?? null,
    logoUrl: record?.brand_evidence?.logo_url ?? null,
  };

  const screenshotUrl =
    record?.proof_shots?.new_mobile_captured_url ??
    record?.proof_shots?.new_captured_url ??
    null;

  const commercialVideo =
    record?.media_bank?.hero_reel?.url ??
    record?.media_bank?.hero_reel_url ??
    null;

  return {
    sentRecord: {
      firstSentAt,
      lastStep,
      repliedAt: latestStamp('reply'),
      bouncedAt: latestStamp('bounce'),
      unsubscribedAt: latestStamp('unsubscribe'),
    },
    data: {
      business,
      mirrorUrl:
        record?.preview_url ??
        record?.build_dispatch?.preview_url ??
        record?.build_dispatch?.urls?.preview_url ??
        null,
      screenshotUrl,
      commercialVideo,
    },
  };
}

module.exports = { toFollowupInputs };

if (require.main === module && process.argv.includes('--test')) {
  const test = require('node:test');
  const assert = require('node:assert/strict');

  const fixture = {
    city: 'Tulsa',
    industry: 'plumbing',
    business_name: 'Fallback Plumbing',
    preview_url: 'https://preview.example.test',
    identity: {
      name: 'Acme Plumbing',
    },
    brand_evidence: {
      accent: '#1a73e8',
      logo_url: 'https://cdn.example.test/logo.png',
    },
    media_bank: {
      hero_reel: {
        url: 'https://cdn.example.test/hero.mp4',
      },
    },
    proof_shots: {
      new_captured_url: 'https://cdn.example.test/desktop.png',
      new_mobile_captured_url: 'https://cdn.example.test/mobile.png',
    },
  };

  test('reduces sends and terminal contact events', () => {
    const result = toFollowupInputs(fixture, [
      { type: 'send', step: 2, created_at: '2026-08-04T10:00:00.000Z' },
      { type: 'send', step: 1, created_at: '2026-08-01T10:00:00.000Z' },
      { type: 'reply', created_at: '2026-08-05T12:00:00.000Z' },
      { type: 'bounce', created_at: '2026-08-06T12:00:00.000Z' },
      { type: 'unsubscribe', created_at: '2026-08-07T12:00:00.000Z' },
    ]);

    assert.deepEqual(result.sentRecord, {
      firstSentAt: '2026-08-01T10:00:00.000Z',
      lastStep: 2,
      repliedAt: '2026-08-05T12:00:00.000Z',
      bouncedAt: '2026-08-06T12:00:00.000Z',
      unsubscribedAt: '2026-08-07T12:00:00.000Z',
    });
  });

  test('maps followup data from the prospect record', () => {
    const result = toFollowupInputs(fixture, []);

    assert.deepEqual(result.data, {
      business: {
        name: 'Acme Plumbing',
        trade: 'plumbing',
        city: 'Tulsa',
        accentColor: '#1a73e8',
        logoUrl: 'https://cdn.example.test/logo.png',
      },
      mirrorUrl: 'https://preview.example.test',
      screenshotUrl: 'https://cdn.example.test/mobile.png',
      commercialVideo: 'https://cdn.example.test/hero.mp4',
    });
  });

  test('returns nulls rather than fabricating absent values', () => {
    const result = toFollowupInputs({}, null);

    assert.deepEqual(result, {
      sentRecord: {
        firstSentAt: null,
        lastStep: 0,
        repliedAt: null,
        bouncedAt: null,
        unsubscribedAt: null,
      },
      data: {
        business: {
          name: null,
          trade: null,
          city: null,
          accentColor: null,
          logoUrl: null,
        },
        mirrorUrl: null,
        screenshotUrl: null,
        commercialVideo: null,
      },
    });
  });

  test('uses latest reply/bounce/unsubscribe stamp and earliest send', () => {
    const result = toFollowupInputs(fixture, [
      { type: 'reply', created_at: '2026-08-03T00:00:00.000Z' },
      { type: 'reply', created_at: '2026-08-08T00:00:00.000Z' },
      { type: 'send', step: 3, created_at: '2026-08-07T00:00:00.000Z' },
      { type: 'send', step: 1, created_at: '2026-08-01T00:00:00.000Z' },
    ]);

    assert.equal(result.sentRecord.firstSentAt, '2026-08-01T00:00:00.000Z');
    assert.equal(result.sentRecord.lastStep, 3);
    assert.equal(result.sentRecord.repliedAt, '2026-08-08T00:00:00.000Z');
  });
}
