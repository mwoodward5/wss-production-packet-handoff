'use strict';

/**
 * miner-query-shapes.cjs
 *
 * Node 20+, CommonJS, zero dependencies.
 */

const FLAT_PLATFORMS = new Set([
  'wix',
  'weebly',
  'godaddy',
  'squarespace-free',
  'wordpress-free',
  'unknown-builder',
]);

function cleanPart(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalKey(value) {
  return value.normalize('NFC').toLocaleLowerCase('en-US');
}

function deepQueries(input) {
  const source = input && typeof input === 'object' ? input : {};
  const cleanTrade = cleanPart(source.trade);
  const cleanCity = cleanPart(source.city);
  const cleanState = cleanPart(source.state);

  if (!cleanTrade || !cleanCity || !cleanState) return [];

  const queries = [];
  const seen = new Set();

  function add(query) {
    const normalized = query.replace(/\s+/g, ' ').trim();

    if (!normalized || queries.length >= 24) return;

    const key = canonicalKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      queries.push(normalized.normalize('NFC'));
    }
  }

  add(`${cleanTrade} in ${cleanCity} ${cleanState}`);

  if (Array.isArray(source.neighborhoods)) {
    for (const neighborhood of source.neighborhoods) {
      const cleanNeighborhood = cleanPart(neighborhood);
      if (cleanNeighborhood) {
        add(
          `${cleanTrade} near ${cleanNeighborhood} ${cleanCity} ${cleanState}`
        );
      }
    }
  }

  if (Array.isArray(source.nearbyCities)) {
    for (const nearbyCity of source.nearbyCities) {
      const cleanNearbyCity = cleanPart(nearbyCity);
      if (cleanNearbyCity) {
        add(`${cleanTrade} serving ${cleanNearbyCity} ${cleanState}`);
      }
    }
  }

  add(`${cleanTrade} ${cleanCity} ${cleanState} small business`);

  return queries;
}

function pagesFor(query, deep) {
  void query;
  return deep === true ? [1, 2, 3, 4] : [1];
}

function extractUrlFromMarkdown(value) {
  const markdownLink = /^\s*\[[^\]]*\]\(([^\s)]+)\)\s*$/u.exec(value);
  return markdownLink ? markdownLink[1] : value.trim();
}

function isFacebookSite(url) {
  if (typeof url !== 'string' || !url.trim()) return false;

  try {
    const parsed = new URL(extractUrlFromMarkdown(url));
    const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');

    return (
      host === 'facebook.com' ||
      host === 'www.facebook.com' ||
      host === 'm.facebook.com'
    );
  } catch {
    return false;
  }
}

function isNonNegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function flatnessScore(input) {
  const source = input && typeof input === 'object' ? input : {};

  const platform =
    typeof source.platform === 'string'
      ? source.platform.trim().toLowerCase()
      : '';

  let score = 0;
  const signals = [];

  if (FLAT_PLATFORMS.has(platform)) {
    score += 35;
    signals.push(`Free or low-effort site platform detected: ${platform}`);
  }

  if (isNonNegativeFiniteNumber(source.htmlBytes)) {
    if (source.htmlBytes < 10000) {
      score += 30;
      signals.push('Very thin page HTML: under 10 KB');
    } else if (source.htmlBytes < 30000) {
      score += 20;
      signals.push('Thin page HTML: under 30 KB');
    }
  }

  if (
    isNonNegativeFiniteNumber(source.internalLinks) &&
    source.internalLinks < 12
  ) {
    score += 20;
    signals.push('Very few internal links: under 12');
  }

  if (source.hasSchema === false) {
    score += 10;
    signals.push('No structured data/schema detected');
  }

  if (source.hasServicePage === false) {
    score += 10;
    signals.push('No dedicated service page detected');
  }

  if (source.hasVideo === false) {
    score += 5;
    signals.push('No video content detected');
  }

  score = Math.max(0, Math.min(100, score));

  return {
    flat: score >= 50,
    score,
    signals,
  };
}

function nonNegativeFiniteOr(value, fallback) {
  return isNonNegativeFiniteNumber(value) ? value : fallback;
}

function safeLog10OneHundredPlus(value) {
  const reviews = nonNegativeFiniteOr(value, 0);

  if (reviews === 0) return 2;
  if (reviews < Number.MAX_VALUE - 100) return Math.log10(100 + reviews);

  return Math.log10(reviews);
}

function candidatePriorityLog(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const score = nonNegativeFiniteOr(source.flatness?.score, 0);
  const rating = nonNegativeFiniteOr(source.rating, 4.0);
  // THIN-TARGET UPSIDE (issue #689, owner doctrine 2026-09-04): the measured
  // integration-gap score — weak/no Google-review widget, maps embed, socials,
  // booking on the prospect's CURRENT site — joins the priority as a POSITIVE
  // term. Ordering only: this ranker drops nobody, and a candidate with no
  // measured gap (absent key, legacy rows) contributes exactly zero, so every
  // prior behaviour is unchanged when the field is missing.
  const integrationGap = nonNegativeFiniteOr(source.integrationGap, 0);

  // A measured integration gap can rescue a candidate from the unmeasured
  // flatness floor: flatness 0 with a real gap is a thin target, not noise.
  // The max(score, 1) keeps the flatness term at a neutral 0 there instead of
  // dragging the whole priority back to -Infinity (log10(0)).
  if ((score === 0 && integrationGap === 0) || rating === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return (
    Math.log10(Math.max(score, 1)) +
    safeLog10OneHundredPlus(source.reviewCount) +
    Math.log10(rating) +
    Math.log10(1 + Math.min(integrationGap, 100))
  );
}

function compareCandidates(a, b) {
  if (a.priorityLog > b.priorityLog) return -1;
  if (a.priorityLog < b.priorityLog) return 1;

  return a.index - b.index;
}

function rankCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      priorityLog: candidatePriorityLog(candidate),
    }))
    .sort(compareCandidates)
    .map(({ candidate }) => candidate);
}

module.exports = {
  deepQueries,
  pagesFor,
  isFacebookSite,
  flatnessScore,
  rankCandidates,
};

function runTests() {
  const tests = [
    {
      name: 'deepQueries creates plain-first, varied, deduped deep shapes',
      run() {
        const queries = deepQueries({
          trade: 'plumbing',
          city: 'Louisville',
          state: 'KY',
          nearbyCities: ['Shively', 'Jeffersontown'],
          neighborhoods: ['Highlands', 'Cherokee'],
        });

        const expected = [
          'plumbing in Louisville KY',
          'plumbing near Highlands Louisville KY',
          'plumbing near Cherokee Louisville KY',
          'plumbing serving Shively KY',
          'plumbing serving Jeffersontown KY',
          'plumbing Louisville KY small business',
        ];

        return (
          queries[0] === 'plumbing in Louisville KY' &&
          queries.length <= 24 &&
          new Set(queries.map(canonicalKey)).size === queries.length &&
          expected.every((query) => queries.includes(query))
        );
      },
    },
    {
      name: 'deepQueries never throws for null input',
      run() {
        const queries = deepQueries(null);
        return Array.isArray(queries) && queries.length === 0;
      },
    },
    {
      name: 'deepQueries dedupes canonically equivalent Unicode query terms',
      run() {
        const queries = deepQueries({
          trade: 'plumbing',
          city: 'Québec',
          state: 'QC',
          nearbyCities: ['Café', 'Cafe\u0301'],
          neighborhoods: [],
        });

        const servingQueries = queries.filter((query) =>
          query.startsWith('plumbing serving ')
        );

        return (
          queries[0] === 'plumbing in Québec QC' &&
          servingQueries.length === 1 &&
          servingQueries[0] === 'plumbing serving Café QC'
        );
      },
    },
    {
      name: 'pagesFor returns one page unless deep',
      run() {
        return (
          JSON.stringify(pagesFor('plumbing Louisville KY', false)) === '[1]' &&
          JSON.stringify(pagesFor('plumbing Louisville KY', true)) === '[1,2,3,4]'
        );
      },
    },
    {
      name: 'isFacebookSite recognizes standard Facebook URLs',
      run() {
        return (
          isFacebookSite('https://www.facebook.com/profile.php?id=6158462987') ===
            true &&
          isFacebookSite('https://m.facebook.com/some-business/') === true &&
          isFacebookSite('https://prisconcrete.com/') === false &&
          isFacebookSite('') === false
        );
      },
    },
    {
      name: 'isFacebookSite recognizes Markdown-wrapped Facebook URLs',
      run() {
        return (
          isFacebookSite(
            '[https://www.facebook.com/profile.php?id=6158462987](https://www.facebook.com/profile.php?id=6158462987)'
          ) === true &&
          isFacebookSite(
            '[https://m.facebook.com/some-business/](https://m.facebook.com/some-business/)'
          ) === true
        );
      },
    },
    {
      name: 'flatnessScore flags thin Wix site',
      run() {
        const result = flatnessScore({
          platform: 'wix',
          htmlBytes: 5000,
          internalLinks: 3,
          hasSchema: false,
        });

        return result.flat === true && result.score >= 85 && result.signals.length >= 4;
      },
    },
    {
      name: 'flatnessScore keeps substantial custom WordPress site non-flat',
      run() {
        const result = flatnessScore({
          platform: 'wordpress',
          htmlBytes: 300000,
          internalLinks: 65,
          hasSchema: true,
          hasServicePage: true,
          hasVideo: true,
        });

        return result.flat === false && result.score <= 10;
      },
    },
    {
      name: 'flatnessScore never throws for null input',
      run() {
        const result = flatnessScore(null);
        return (
          result.flat === false &&
          result.score === 0 &&
          Array.isArray(result.signals) &&
          result.signals.length === 0
        );
      },
    },
    {
      name: 'flatnessScore ignores impossible negative measurements',
      run() {
        const result = flatnessScore({
          platform: 'custom',
          htmlBytes: -1,
          internalLinks: -1,
          hasSchema: true,
          hasServicePage: true,
          hasVideo: true,
        });

        return result.flat === false && result.score === 0 && result.signals.length === 0;
      },
    },
    {
      name: 'rankCandidates prioritizes Wix-flat prospect and drops nobody',
      run() {
        const candidates = [
          {
            prospectId: 'classy',
            rating: 4.9,
            reviewCount: 400,
            flatness: { score: 0 },
            hasWebsite: true,
          },
          {
            prospectId: 'wix-flat',
            rating: 4.9,
            reviewCount: 300,
            flatness: { score: 95 },
            hasWebsite: true,
          },
          {
            prospectId: 'missing-flatness',
            rating: 4.5,
            reviewCount: 100,
            hasWebsite: false,
          },
        ];

        const ranked = rankCandidates(candidates);

        return (
          ranked.length === candidates.length &&
          ranked[0].prospectId === 'wix-flat' &&
          ranked.some((candidate) => candidate.prospectId === 'classy') &&
          ranked.some((candidate) => candidate.prospectId === 'missing-flatness')
        );
      },
    },
    {
      name: 'rankCandidates safely handles enormous finite numeric inputs',
      run() {
        const candidates = [
          {
            prospectId: 'a',
            flatness: { score: 1e308 },
            reviewCount: 1e308,
            rating: 1e308,
          },
          {
            prospectId: 'b',
            flatness: { score: 1e308 },
            reviewCount: 1e308,
            rating: 1e308,
          },
        ];

        const ranked = rankCandidates(candidates);

        return (
          ranked.length === 2 &&
          ranked[0].prospectId === 'a' &&
          ranked[1].prospectId === 'b'
        );
      },
    },
    {
      name: 'rankCandidates prefers measured integration-gap upside and drops nobody (issue #689)',
      run() {
        const candidates = [
          {
            // The LOA-Roofing class: polished (no flatness signals), full
            // integrations, strong demand — the WRONG target class now.
            prospectId: 'polished',
            rating: 4.9,
            reviewCount: 400,
            flatness: { score: 0 },
            integrationGap: 0,
          },
          {
            // The thin target: same demand, no measured flatness signals, but
            // a real integration gap — it must rank ABOVE the polished site.
            prospectId: 'thin-gap',
            rating: 4.9,
            reviewCount: 400,
            flatness: { score: 0 },
            integrationGap: 85,
          },
          {
            // Legacy rows carry no gap field at all: behaviour unchanged.
            prospectId: 'legacy',
            rating: 4.7,
            reviewCount: 200,
            flatness: { score: 60 },
          },
        ];

        const ranked = rankCandidates(candidates);

        return (
          ranked.length === candidates.length &&
          ranked[0].prospectId === 'thin-gap' &&
          ranked.indexOf(
            candidates.find((c) => c.prospectId === 'thin-gap'),
          ) < ranked.indexOf(
            candidates.find((c) => c.prospectId === 'polished'),
          )
        );
      },
    },
  ];

  let failed = false;

  for (const test of tests) {
    try {
      const passed = test.run() === true;
      console.log(`${passed ? 'PASS' : 'FAIL'}: ${test.name}`);
      if (!passed) failed = true;
    } catch (error) {
      console.log(`FAIL: ${test.name} (${error.message})`);
      failed = true;
    }
  }

  process.exitCode = failed ? 1 : 0;
}

if (require.main === module && process.argv.includes('--test')) {
  runTests();
}
