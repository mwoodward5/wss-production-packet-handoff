'use strict';

/*
REPO CONTRACT (embed exactly — every piece of this wave speaks this shape):
- Node 20+, CommonJS (`module.exports`), zero npm deps, node builtins only.
- ONE complete file in ONE code block, runnable as-is.
- Self-test: `node logo-ladder.cjs --test` prints one PASS/FAIL line per case, exits 0 all-pass / 1 any-fail. No flag = no output.
- Your module feeds a production brand-asset resolver. Exact export names are the contract.
*/

const MAX_CANDIDATES_TO_SCAN = 1024;
const IMAGE_SNIFFS = new Set(['png', 'jpeg']);
// FIRST-IMPRESSION ASPECT GUARD (2026-09-04 robustness lane). The mark slot
// this ladder feeds is the header's SQUARE plate (46x46 on the falcon family,
// the same square emblem shape on every donor). The measured defect: an
// 800x340 landscape banner (ratio 2.35) passed the dimension floor, won the
// `logo` rung, and rendered as overlapping garbage inside the square slot.
// The fleet's own header-mark law (lib/capture-brand.js WORDMARK_MIN_RATIO)
// already draws the line at 8:5 — wider than that is a lockup or a wordmark,
// not a mark. The ladder now applies the same line: a candidate wider than
// MARK_MAX_ASPECT is skipped for the square slot (it may still be the
// business's wordmark image elsewhere — this ladder only picks the MARK),
// and selection falls through to the next candidate, then the wordmark /
// monogram / donor_default rungs — the mark-fallback path — so the header
// never stretches a banner across it. (The slot CSS contains with
// object-fit, so nothing can stretch; the guard keeps an unreadable sliver
// from being picked as the identity in the first place.)
const MARK_MAX_ASPECT = 1.6;
const SIGNIFICANT_WORD_EXCLUSIONS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with'
]);

function safely(getter, fallback) {
  try {
    return getter();
  } catch {
    return fallback;
  }
}

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeOwnValue(object, key, fallback) {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function')) {
    return fallback;
  }

  return safely(() => object[key], fallback);
}

function safeInputValue(input, key, fallback) {
  return safely(() => {
    if (input === null || (typeof input !== 'object' && typeof input !== 'function')) {
      return fallback;
    }

    return input[key];
  }, fallback);
}

function isValidImageUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const urlText = value.trim();
  if (!urlText || urlText !== value || urlText.includes('[') || urlText.includes(']')) {
    return false;
  }

  return safely(() => {
    const parsed = new URL(urlText);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  }, false);
}

function isValidDimension(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 64;
}

function getSafeCandidates(input) {
  const candidates = safeInputValue(input, 'logoCandidates', null);

  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates;
}

function getSafeCandidateCount(candidates) {
  const length = safely(() => candidates.length, 0);

  if (
    typeof length !== 'number' ||
    !Number.isFinite(length) ||
    length <= 0
  ) {
    return 0;
  }

  return Math.min(Math.floor(length), MAX_CANDIDATES_TO_SCAN);
}

function initialsFromBusinessName(businessName) {
  const name = safeString(businessName);
  if (!name) {
    return '';
  }

  const words = safely(() => name.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || [], []);

  return words
    .filter((word) => !SIGNIFICANT_WORD_EXCLUSIONS.has(word.toLowerCase()))
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function selectMonogramName(input) {
  const value = safeInputValue(input, 'monogramName', '');
  return safeString(value);
}

function chooseBrandMark(input) {
  try {
    const candidates = getSafeCandidates(input);
    const candidateCount = getSafeCandidateCount(candidates);
    const businessName = safeString(safeInputValue(input, 'businessName', ''));
    const accent = safely(() => {
      const value = safeInputValue(input, 'accent', '');
      return typeof value === 'string' ? value : '';
    }, '');

    for (let index = 0; index < candidateCount; index += 1) {
      const candidate = safely(() => candidates[index], null);

      if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
        continue;
      }

      const url = safeOwnValue(candidate, 'url', '');
      const sniff = safeOwnValue(candidate, 'sniff', '');
      const width = safeOwnValue(candidate, 'width', 0);
      const height = safeOwnValue(candidate, 'height', 0);

      if (
        IMAGE_SNIFFS.has(sniff) &&
        isValidImageUrl(url) &&
        isValidDimension(width) &&
        isValidDimension(height)
      ) {
        // THE ASPECT GUARD: a landscape-banner image (800x340 into a 46x46
        // square slot) is not a mark, however valid its bytes. Skip it and
        // keep walking — later candidates, then the mark-fallback rungs.
        const aspect = width / height;
        if (Number.isFinite(aspect) && aspect > MARK_MAX_ASPECT) {
          continue;
        }

        return {
          rung: 'logo',
          value: {
            type: 'image',
            url,
            width,
            height
          },
          reason: `candidate ${index} sniffed ${sniff} ${width}x${height}`
        };
      }
    }

    if (businessName) {
      return {
        rung: 'wordmark',
        value: {
          type: 'wordmark',
          text: businessName,
          color: accent
        },
        reason: 'no usable image fell to wordmark'
      };
    }

    const monogramName = selectMonogramName(input);
    const initials = initialsFromBusinessName(monogramName);

    if (initials) {
      return {
        rung: 'monogram',
        value: {
          type: 'monogram',
          initials,
          color: accent,
          background: 'panel'
        },
        reason: 'no usable image or wordmark fell to monogram'
      };
    }

    return {
      rung: 'donor_default',
      value: {
        type: 'donor_default'
      },
      reason: 'no usable image, wordmark, or monogram fell to donor default'
    };
  } catch {
    return {
      rung: 'donor_default',
      value: {
        type: 'donor_default'
      },
      reason: 'malformed input fell to donor default'
    };
  }
}

function ladderPolicy() {
  return {
    refuses: false,
    maxRung: 'donor_default',
    description: 'This policy never refuses a build because every brand asset outcome falls back to a usable mark.'
  };
}

module.exports = {
  chooseBrandMark,
  ladderPolicy,
  MARK_MAX_ASPECT
};

if (require.main === module && process.argv.includes('--test')) {
  const tests = [
    {
      name: 'png 400x400 candidate selects logo',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [
            {
              url: 'https://example.com/logo.png',
              mime: 'image/png',
              sniff: 'png',
              width: 400,
              height: 400
            }
          ],
          businessName: 'Example Co.',
          accent: '#0a5'
        });

        return (
          result.rung === 'logo' &&
          result.value.type === 'image' &&
          result.value.url === 'https://example.com/logo.png' &&
          result.value.width === 400 &&
          result.value.height === 400
        );
      }
    },
    {
      name: 'mildly wide 300x230 mark still selects logo (below the 8:5 line)',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [
            { url: 'https://example.com/mark.png', sniff: 'png', width: 300, height: 230 }
          ],
          businessName: 'Example Co.',
          accent: '#0a5'
        });

        return result.rung === 'logo' && result.value.width === 300 && result.value.height === 230;
      }
    },
    {
      name: 'ASPECT GUARD: an 800x340 landscape banner never wins the square mark slot',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [
            {
              url: 'https://example.com/banner.png',
              mime: 'image/png',
              sniff: 'png',
              width: 800,
              height: 340
            }
          ],
          businessName: 'Example Co.',
          accent: '#0a5'
        });

        return result.rung === 'wordmark' && result.value.type === 'wordmark';
      }
    },
    {
      name: 'ASPECT GUARD: a square candidate after a banner is still picked',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [
            { url: 'https://example.com/banner.png', sniff: 'png', width: 800, height: 340 },
            { url: 'https://example.com/mark.png', sniff: 'png', width: 240, height: 240 }
          ],
          businessName: 'Example Co.',
          accent: '#0a5'
        });

        return result.rung === 'logo' && result.value.url === 'https://example.com/mark.png';
      }
    },
    {
      name: 'svg-only candidates fall to wordmark',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [
            {
              url: 'https://example.com/placeholder.svg',
              mime: 'image/svg+xml',
              sniff: 'svg',
              width: 400,
              height: 120
            }
          ],
          businessName: 'Acme Services',
          accent: '#123456'
        });

        return result.rung === 'wordmark' && result.value.text === 'Acme Services';
      }
    },
    {
      name: 'small png falls to wordmark',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [
            {
              url: 'https://example.com/tiny.png',
              mime: 'image/png',
              sniff: 'png',
              width: 32,
              height: 32
            }
          ],
          businessName: 'JB Plumbing Inc.',
          accent: '#0a5'
        });

        return (
          result.rung === 'wordmark' &&
          result.value.text === 'JB Plumbing Inc.' &&
          result.value.color === '#0a5'
        );
      }
    },
    {
      name: 'no candidates and name selects wordmark over monogram',
      run() {
        const result = chooseBrandMark({
          businessName: 'Traeger Landscaping, LLC',
          accent: '#1b6'
        });

        return result.rung === 'wordmark' && result.value.text === 'Traeger Landscaping, LLC';
      }
    },
    {
      name: 'empty everything selects donor default',
      run() {
        const result = chooseBrandMark({});

        return result.rung === 'donor_default' && result.value.type === 'donor_default';
      }
    },
    {
      name: 'ladder policy never refuses',
      run() {
        return ladderPolicy().refuses === false;
      }
    },
    {
      name: 'missing image URL falls to wordmark',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [{ sniff: 'png', width: 128, height: 128 }],
          businessName: 'Acme'
        });

        return result.rung === 'wordmark' && result.value.text === 'Acme';
      }
    },
    {
      name: 'markdown-corrupted URL falls to wordmark',
      run() {
        const result = chooseBrandMark({
          logoCandidates: [{
            url: '[https://example.com/logo.png](https://example.com/logo.png)',
            sniff: 'png',
            width: 128,
            height: 128
          }],
          businessName: 'Acme'
        });

        return result.rung === 'wordmark' && result.value.text === 'Acme';
      }
    },
    {
      name: 'monogram rung works from monogramName when wordmark name is absent',
      run() {
        const result = chooseBrandMark({
          businessName: '',
          monogramName: 'JB Plumbing',
          accent: '#0a5'
        });

        return (
          result.rung === 'monogram' &&
          result.value.type === 'monogram' &&
          result.value.initials === 'JP' &&
          result.value.color === '#0a5' &&
          result.value.background === 'panel'
        );
      }
    },
    {
      name: 'business name still outranks monogram',
      run() {
        const result = chooseBrandMark({
          businessName: 'JB Plumbing',
          monogramName: 'Different Brand',
          accent: '#0a5'
        });

        return result.rung === 'wordmark' && result.value.text === 'JB Plumbing';
      }
    },
    {
      name: 'throwing logoCandidates getter falls to donor default',
      run() {
        const hostileInput = Object.create(null, {
          logoCandidates: {
            get() {
              throw new Error('boom');
            }
          }
        });

        const result = chooseBrandMark(hostileInput);
        return result.rung === 'donor_default' && result.value.type === 'donor_default';
      }
    },
    {
      name: 'throwing candidate sniff getter falls to wordmark',
      run() {
        const hostileCandidate = Object.create(null, {
          sniff: {
            get() {
              throw new Error('boom');
            }
          }
        });

        const result = chooseBrandMark({
          logoCandidates: [hostileCandidate],
          businessName: 'Acme'
        });

        return result.rung === 'wordmark' && result.value.text === 'Acme';
      }
    },
    {
      name: 'proxy candidate array falls to wordmark',
      run() {
        const hostileCandidates = new Proxy([], {
          get() {
            throw new Error('boom');
          }
        });

        const result = chooseBrandMark({
          logoCandidates: hostileCandidates,
          businessName: 'Acme'
        });

        return result.rung === 'wordmark' && result.value.text === 'Acme';
      }
    },
    {
      name: 'huge sparse candidate array is bounded and falls to wordmark',
      run() {
        const candidates = [];
        candidates.length = 4294967295;

        const startedAt = Date.now();
        const result = chooseBrandMark({
          logoCandidates: candidates,
          businessName: 'Acme'
        });
        const elapsedMs = Date.now() - startedAt;

        return (
          result.rung === 'wordmark' &&
          result.value.text === 'Acme' &&
          elapsedMs < 1000
        );
      }
    }
  ];

  let failures = 0;

  for (const test of tests) {
    let passed = false;

    try {
      passed = test.run() === true;
    } catch {
      passed = false;
    }

    console.log(`${passed ? 'PASS' : 'FAIL'}: ${test.name}`);

    if (!passed) {
      failures += 1;
    }
  }

  process.exitCode = failures === 0 ? 0 : 1;
}
