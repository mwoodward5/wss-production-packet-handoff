'use strict';

/*
 * facts-text-normalizer.cjs
 *
 * Node 20+, CommonJS, zero dependencies.
 */

const TYPOGRAPHIC_REPLACEMENTS = Object.freeze({
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2026': '...',
  '\u00A0': ' '
});

const TYPOGRAPHIC_PATTERN = /[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0]/g;

/**
 * Maps common typographic punctuation to ASCII, trims text, and collapses
 * consecutive ordinary spaces. Non-string input normalizes to an empty string.
 *
 * @param {unknown} input
 * @returns {string}
 */
function normalizeFactsText(input) {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(TYPOGRAPHIC_PATTERN, (character) => TYPOGRAPHIC_REPLACEMENTS[character])
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Identifies forbidden characters in text after normalization.
 *
 * Forbidden:
 * - C0 controls other than tab, LF, and CR
 * - C1 controls
 * - U+200B through U+200D
 * - U+FFFD
 * - Any unpaired UTF-16 surrogate code unit
 *
 * @param {unknown} input
 * @returns {{ ok: boolean, chars: string[] }}
 */
function forbiddenAfterNormalize(input) {
  const normalized = normalizeFactsText(input);
  const chars = [];
  const seen = new Set();

  function addForbidden(character) {
    if (!seen.has(character)) {
      seen.add(character);
      chars.push(character);
    }
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const codeUnit = normalized.charCodeAt(index);

    if (
      (codeUnit >= 0x0000 && codeUnit <= 0x001f &&
        codeUnit !== 0x0009 &&
        codeUnit !== 0x000a &&
        codeUnit !== 0x000d) ||
      (codeUnit >= 0x007f && codeUnit <= 0x009f) ||
      (codeUnit >= 0x200b && codeUnit <= 0x200d) ||
      codeUnit === 0xfffd
    ) {
      addForbidden(normalized[index]);
      continue;
    }

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = normalized.charCodeAt(index + 1);

      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        index += 1;
      } else {
        addForbidden(normalized[index]);
      }

      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      addForbidden(normalized[index]);
    }
  }

  return {
    ok: chars.length === 0,
    chars
  };
}

module.exports = {
  normalizeFactsText,
  forbiddenAfterNormalize
};

if (require.main === module && process.argv.includes('--test')) {
  const cases = [
    {
      name: 'production tagline curly quotes normalize and pass',
      input: '“No job too big or small, we do them all!”',
      expectedNormalized: '"No job too big or small, we do them all!"',
      expectedForbidden: { ok: true, chars: [] }
    },
    {
      name: 'curly apostrophe em-dash ellipsis normalize and pass',
      input: 'We don\u2019t cut corners \u2014 we caulk them\u2026',
      expectedNormalized: "We don't cut corners - we caulk them...",
      expectedForbidden: { ok: true, chars: [] }
    },
    {
      name: 'accents remain unchanged while en-dash normalizes',
      input: "Café Verde \u2013 Niño's Best",
      expectedNormalized: "Café Verde - Niño's Best",
      expectedForbidden: { ok: true, chars: [] }
    },
    {
      name: 'C0 control character fails',
      input: 'Bad\u0002text',
      expectedNormalized: 'Bad\u0002text',
      expectedForbidden: { ok: false, chars: ['\u0002'] }
    },
    {
      name: 'lone high surrogate fails',
      input: '\uD800',
      expectedNormalized: '\uD800',
      expectedForbidden: { ok: false, chars: ['\uD800'] }
    },
    {
      name: 'embedded lone high surrogate fails',
      input: 'abc\uD800def',
      expectedNormalized: 'abc\uD800def',
      expectedForbidden: { ok: false, chars: ['\uD800'] }
    },
    {
      name: 'lone low surrogate fails',
      input: '\uDC00',
      expectedNormalized: '\uDC00',
      expectedForbidden: { ok: false, chars: ['\uDC00'] }
    },
    {
      name: 'valid surrogate pair emoji passes',
      input: 'Fast repair 🔧 — mañana!',
      expectedNormalized: 'Fast repair 🔧 - mañana!',
      expectedForbidden: { ok: true, chars: [] }
    },
    {
      name: 'non-breaking spaces collapse and trim',
      input: '\u00A0Local\u00A0\u00A0service\u00A0',
      expectedNormalized: 'Local service',
      expectedForbidden: { ok: true, chars: [] }
    },
    {
      name: 'zero-width space fails',
      input: 'hello\u200Bworld',
      expectedNormalized: 'hello\u200Bworld',
      expectedForbidden: { ok: false, chars: ['\u200B'] }
    },
    {
      name: 'replacement character fails',
      input: 'broken\uFFFDtext',
      expectedNormalized: 'broken\uFFFDtext',
      expectedForbidden: { ok: false, chars: ['\uFFFD'] }
    },
    {
      name: 'non-string input becomes empty string',
      input: null,
      expectedNormalized: '',
      expectedForbidden: { ok: true, chars: [] }
    }
  ];

  let allPassed = true;

  for (const testCase of cases) {
    const normalized = normalizeFactsText(testCase.input);
    const forbidden = forbiddenAfterNormalize(testCase.input);
    const normalizedTwice = normalizeFactsText(normalized);

    const passed =
      normalized === testCase.expectedNormalized &&
      normalizedTwice === normalized &&
      forbidden.ok === testCase.expectedForbidden.ok &&
      JSON.stringify(forbidden.chars) ===
        JSON.stringify(testCase.expectedForbidden.chars);

    if (!passed) {
      allPassed = false;
    }

    console.log(`${passed ? 'PASS' : 'FAIL'}: ${testCase.name}`);
  }

  process.exitCode = allPassed ? 0 : 1;
}
