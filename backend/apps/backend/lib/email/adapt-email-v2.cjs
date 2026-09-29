'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
// The ONE brand reader (lib/prospects.js verifiedBrandOf): shipped brand_truth
// first, then mirror_request.brand, then brand_evidence. This adapter used to
// read brand_evidence.accent directly, so when the contract's request block and
// evidence block disagreed the v2 email and the legacy composer wore different
// colours — the second divergence of the 2026-08-03 family.
const { verifiedBrandOf } = require('../prospects');

function toNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getVerifiedReviews(record) {
  // Each candidate carries its KNOWN provenance. mirror_request.content.reviews
  // is the Google Business Profile scrape by construction, so its source is
  // 'google' even when the individual rows omit an explicit source field —
  // provenance is established by the path, never fabricated per-row.
  const candidates = [
    { arr: record?.identity?.reviews, impliedSource: null },
    { arr: record?.build_ready?.reviews, impliedSource: null },
    { arr: record?.build_ready?.mirror_request?.content?.reviews, impliedSource: 'google' },
  ];

  const matched = candidates.find((c) => Array.isArray(c.arr));
  if (!matched) return [];
  const reviews = matched.arr;
  const impliedSource = matched.impliedSource;

  return reviews
    .map((review) => {
      if (!review || typeof review !== 'object') return null;

      const name = toNonEmptyString(review.name ?? review.author ?? review.reviewer);
      const source = toNonEmptyString(review.source) || impliedSource;

      if (!name || !source) return null;

      return {
        name,
        avatarUrl: toNonEmptyString(
          review.avatarUrl ?? review.avatar_url ?? review.profilePhotoUrl
        ),
        stars: toFiniteNumber(review.stars ?? review.rating),
        text: toNonEmptyString(review.text ?? review.review ?? review.comment),
        source,
      };
    })
    .filter(Boolean);
}

function toProspectEmailData(record) {
  const beforeShotUrl = toNonEmptyString(
    record?.proof_shots?.old_captured_url ?? record?.proof_shots?.old_shot_url
  );
  // TODO: Looked for a dedicated dashboard screenshot URL; none is defined in the record shape.
  const dashboardShotUrl = null;

  const heroReel = record?.media_bank?.hero_reel;
  const heroUrl = toNonEmptyString(heroReel?.url);
  const isMp4 =
    heroUrl &&
    (
      /\.mp4(?:$|[?#])/i.test(heroUrl) ||
      toNonEmptyString(heroReel?.mime_type ?? heroReel?.mimeType) === 'video/mp4'
    );

  // TODO: Looked for real lead-volume and cost-per-lead metrics; none is defined in the record shape.
  const honestMath = {
    leadsPerMonth: null,
    costPerLead: null,
  };

  return {
    business: {
      name: toNonEmptyString(record?.identity?.name ?? record?.business_name),
      trade: toNonEmptyString(record?.industry),
      city: toNonEmptyString(record?.city),
      // Canonical precedence order lives in lib/prospects.js verifiedBrandOf —
      // never re-read brand_evidence.accent ahead of it here. The direct read
      // survives ONLY as the last resort for a contract that carries an accent
      // but no logo, which verifiedBrandOf's contract loop skips over.
      accentColor: toNonEmptyString(verifiedBrandOf({ record }).accent)
        ?? toNonEmptyString(record?.build_ready?.brand_evidence?.accent),
      logoUrl: toNonEmptyString(record?.build_ready?.brand_evidence?.logo_url),
    },
    beforeShotUrl,
    afterShotUrl: toNonEmptyString(
      record?.proof_shots?.new_captured_url ?? record?.proof_shots?.new_shot_url
    ),
    mirrorUrl: toNonEmptyString(record?.preview_url ?? record?.build_dispatch?.preview_url),
    dashboardShotUrl,
    reviews: getVerifiedReviews(record),
    commercialVideo: isMp4
      ? {
          posterUrl: toNonEmptyString(
            heroReel?.poster_url ?? heroReel?.posterUrl ?? record?.media_bank?.hero_reel_poster_url
          ),
          downloadUrl: heroUrl,
        }
      : null,
    assets: {
      heroReelUrl: toNonEmptyString(record?.media_bank?.hero_reel_url ?? heroUrl),
      logoUrl: toNonEmptyString(record?.build_ready?.brand_evidence?.logo_url),
      proofBuildHash: toNonEmptyString(record?.proof_shots?.build_hash),
      buildHash: toNonEmptyString(record?.build_ready?.proof?.build_hash),
    },
    honestMath,
    // TODO: Looked for a per-prospect unsubscribe URL; none is defined in the record shape.
    unsubscribeUrl: null,
    contactPhoneDisplay: toNonEmptyString(record?.identity?.phone ?? record?.phone),
  };
}

module.exports = { toProspectEmailData };

if (require.main === module) {
  const fixture = {
    city: 'Mission Viejo',
    phone: '(949) 555-0199',
    industry: 'Roofing',
    business_name: 'Fallback Roofing',
    identity: {
      name: 'Verified Roofing Co.',
      phone: '(949) 555-0123',
      reviews: [
        {
          name: 'Jane D.',
          avatarUrl: 'https://cdn.example.com/jane.jpg',
          stars: 5,
          text: 'Fast, professional work.',
          source: 'Google',
        },
        {
          name: '',
          stars: 5,
          text: 'No name means this cannot be used.',
          source: 'Google',
        },
        {
          name: 'Missing Source',
          stars: 4,
          text: 'No source means this cannot be used.',
        },
      ],
    },
    media_bank: {
      hero_reel_url: 'https://cdn.example.com/hero.mp4',
      hero_reel: {
        url: 'https://cdn.example.com/hero.mp4',
        posterUrl: 'https://cdn.example.com/hero-poster.jpg',
        generator: 'video-pipeline',
      },
    },
    build_ready: {
      brand_evidence: {
        accent: '#d44520',
        logo_url: 'https://cdn.example.com/logo.png',
      },
      proof: {
        build_hash: 'build-ready-hash',
      },
    },
    preview_url: 'https://preview.example.com/verified-roofing',
    proof_shots: {
      build_hash: 'proof-hash',
      old_captured_url: 'https://cdn.example.com/before.png',
      new_captured_url: 'https://cdn.example.com/after.png',
    },
  };

  test('maps verified brand, proof shots, and an MP4 hero reel', () => {
    const data = toProspectEmailData(fixture);

    assert.deepEqual(data.business, {
      name: 'Verified Roofing Co.',
      trade: 'Roofing',
      city: 'Mission Viejo',
      accentColor: '#d44520',
      logoUrl: 'https://cdn.example.com/logo.png',
    });
    assert.equal(data.beforeShotUrl, 'https://cdn.example.com/before.png');
    assert.equal(data.afterShotUrl, 'https://cdn.example.com/after.png');
    assert.equal(data.mirrorUrl, 'https://preview.example.com/verified-roofing');
    assert.deepEqual(data.commercialVideo, {
      posterUrl: 'https://cdn.example.com/hero-poster.jpg',
      downloadUrl: 'https://cdn.example.com/hero.mp4',
    });
  });

  test('keeps only reviews with both a real name and source', () => {
    const data = toProspectEmailData(fixture);

    assert.deepEqual(data.reviews, [
      {
        name: 'Jane D.',
        avatarUrl: 'https://cdn.example.com/jane.jpg',
        stars: 5,
        text: 'Fast, professional work.',
        source: 'Google',
      },
    ]);
  });

  test('rejects non-MP4 hero reels and preserves null-only unknown fields', () => {
    const data = toProspectEmailData({
      ...fixture,
      media_bank: {
        hero_reel: {
          url: 'https://cdn.example.com/hero.webm',
          poster_url: 'https://cdn.example.com/hero.jpg',
        },
      },
    });

    assert.equal(data.commercialVideo, null);
    assert.equal(data.dashboardShotUrl, null);
    assert.equal(data.unsubscribeUrl, null);
    assert.deepEqual(data.honestMath, {
      leadsPerMonth: null,
      costPerLead: null,
    });
  });

  test('falls back to top-level business and phone fields only when identity values are absent', () => {
    const data = toProspectEmailData({
      city: 'Irvine',
      industry: 'Plumbing',
      business_name: 'Irvine Plumbing',
      phone: '9495550100',
    });

    assert.equal(data.business.name, 'Irvine Plumbing');
    assert.equal(data.contactPhoneDisplay, '9495550100');
    assert.deepEqual(data.reviews, []);
    assert.equal(data.beforeShotUrl, null);
    assert.equal(data.afterShotUrl, null);
  });
}