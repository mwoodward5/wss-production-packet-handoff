'use strict';

const crypto = require('node:crypto');

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;
const MIN_LOGO_SHARE = 0.12;
const DRIFT_DELTA_E = 10;
const WHITE = '#FFFFFF';
const NEAR_BLACK = '#111111';

function buildBrandTruth(inputs = {}) {
  const operator = normalizeHex(inputs.operator && inputs.operator.hex);
  const measured = normalizeHex(inputs.logoMeasured && inputs.logoMeasured.hex);
  const scraped = normalizeHex(inputs.siteScraped && inputs.siteScraped.hex);

  let accentHex = null;
  let source = 'none';
  let confidence = 0;
  let refusal = null;

  if (operator) {
    accentHex = operator;
    source = 'operator';
    confidence = 1;
  } else if (
    measured &&
    Number.isFinite(Number(inputs.logoMeasured && inputs.logoMeasured.share)) &&
    Number(inputs.logoMeasured.share) >= MIN_LOGO_SHARE
  ) {
    accentHex = measured;
    source = 'logo_measured';
    confidence = clamp(Number(inputs.logoMeasured.share), 0, 1);
  } else if (scraped) {
    accentHex = scraped;
    source = 'site_verified';
    confidence = confidenceFromSiteSource(inputs.siteScraped && inputs.siteScraped.from);
  } else {
    refusal = 'no_verified_brand_color';
  }

  const fontInput = inputs.fonts || {};
  const font = {
    display: normalizeFont(fontInput.display),
    body: normalizeFont(fontInput.body),
    source: normalizeFontSource(fontInput.source, fontInput),
  };

  const logo = normalizeLogo(inputs.logo);

  const truth = {
    accent: accentHex
      ? {
          hex: accentHex,
          source,
          confidence,
        }
      : null,
    ink: {
      onAccent: accentHex ? pickInkOnAccent(accentHex) : null,
    },
    font,
    logo,
  };

  if (refusal) {
    truth.refusal = refusal;
  }

  return deepFreeze(truth);
}

function validateAgainstShipped(brandTruth, shippedHexes) {
  if (!Array.isArray(shippedHexes)) {
    throw new TypeError('shippedHexes must be an array');
  }

  const truthHex =
    brandTruth &&
    brandTruth.accent &&
    typeof brandTruth.accent.hex === 'string'
      ? normalizeHex(brandTruth.accent.hex)
      : null;

  if (!truthHex) {
    return shippedHexes.map((shippedHex, index) => ({
      index,
      shippedHex,
      reason: 'no_verified_brand_color',
      drift: true,
    }));
  }

  return shippedHexes.reduce((mismatches, shippedHex, index) => {
    const normalized = normalizeHex(shippedHex);

    if (!normalized) {
      mismatches.push({
        index,
        shippedHex,
        reason: 'invalid_shipped_hex',
        drift: true,
      });
      return mismatches;
    }

    const deltaE = deltaE76(hexToLab(truthHex), hexToLab(normalized));

    if (deltaE > DRIFT_DELTA_E) {
      mismatches.push({
        index,
        shippedHex: normalized,
        truthHex,
        deltaE: round(deltaE, 3),
        threshold: DRIFT_DELTA_E,
        drift: true,
      });
    }

    return mismatches;
  }, []);
}

function normalizeHex(value) {
  if (typeof value !== 'string') return null;

  const match = value.trim().match(HEX_RE);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function normalizeFont(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeFontSource(source, fontInput) {
  if (typeof source === 'string' && source.trim()) {
    return source.trim();
  }

  return fontInput.display || fontInput.body ? 'provided' : 'none';
}

function normalizeLogo(logo) {
  if (!logo || typeof logo !== 'object') {
    return { url: null };
  }

  const url = typeof logo.url === 'string' && logo.url.trim() ? logo.url.trim() : null;
  const sha256 =
    typeof logo.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(logo.sha256.trim())
      ? logo.sha256.trim().toLowerCase()
      : null;

  return sha256 ? { url, sha256 } : { url };
}

function confidenceFromSiteSource(from) {
  if (typeof from !== 'string') return 0.75;

  const normalized = from.trim().toLowerCase();

  if (normalized === 'stylesheet' || normalized === 'design_tokens') return 0.9;
  if (normalized === 'computed_style' || normalized === 'site_css') return 0.85;
  if (normalized === 'homepage' || normalized === 'site') return 0.75;

  return 0.7;
}

function pickInkOnAccent(hex) {
  const whiteContrast = contrastRatio(hex, WHITE);
  const blackContrast = contrastRatio(hex, NEAR_BLACK);

  if (whiteContrast >= 4.5 && whiteContrast >= blackContrast) {
    return WHITE;
  }

  if (blackContrast >= 4.5) {
    return NEAR_BLACK;
  }

  return whiteContrast >= blackContrast ? WHITE : NEAR_BLACK;
}

function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    throw new TypeError(`Invalid hex color: ${String(hex)}`);
  }

  const value = normalized.slice(1);

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function hexToLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function rgbToXyz(r, g, b) {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value > 0.04045
      ? Math.pow((value + 0.055) / 1.055, 2.4)
      : value / 12.92;
  });

  return [
    (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047,
    (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 1,
    (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883,
  ];
}

function xyzToLab(x, y, z) {
  const transform = (value) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;

  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deltaE76(labA, labB) {
  return Math.sqrt(
    Math.pow(labA.l - labB.l, 2) +
      Math.pow(labA.a - labB.a, 2) +
      Math.pow(labA.b - labB.b, 2),
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }

  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
  buildBrandTruth,
  validateAgainstShipped,
};

/* node:test coverage: run with `node --test brand-truth.cjs` */
if (require.main === module || process.argv.includes('--test')) {
  const test = require('node:test');
  const assert = require('node:assert/strict');

  test('operator color wins over every other candidate', () => {
    const truth = buildBrandTruth({
      operator: { hex: '#ff0000' },
      logoMeasured: { hex: '#00ff00', share: 0.9 },
      siteScraped: { hex: '#0000ff', from: 'stylesheet' },
    });

    assert.deepEqual(truth.accent, {
      hex: '#FF0000',
      source: 'operator',
      confidence: 1,
    });
  });

  test('qualified logo measurement wins over site-verified color', () => {
    const truth = buildBrandTruth({
      logoMeasured: { hex: '#c8102e', share: 0.12 },
      siteScraped: { hex: '#0057b8', from: 'stylesheet' },
    });

    assert.deepEqual(truth.accent, {
      hex: '#C8102E',
      source: 'logo_measured',
      confidence: 0.12,
    });
  });

  test('logo measurement under minimum share does not qualify', () => {
    const truth = buildBrandTruth({
      logoMeasured: { hex: '#c8102e', share: 0.119 },
      siteScraped: { hex: '#0057b8', from: 'homepage' },
    });

    assert.deepEqual(truth.accent, {
      hex: '#0057B8',
      source: 'site_verified',
      confidence: 0.75,
    });
  });

  test('site-verified color is selected when higher-precedence inputs are absent', () => {
    const truth = buildBrandTruth({
      siteScraped: { hex: ' #1d4ed8 ', from: 'design_tokens' },
    });

    assert.deepEqual(truth.accent, {
      hex: '#1D4ED8',
      source: 'site_verified',
      confidence: 0.9,
    });
  });

  test('invalid color values are ignored', () => {
    const truth = buildBrandTruth({
      operator: { hex: 'red' },
      logoMeasured: { hex: '#12', share: 0.8 },
      siteScraped: { hex: '#2563eb', from: 'site_css' },
    });

    assert.equal(truth.accent.hex, '#2563EB');
    assert.equal(truth.accent.source, 'site_verified');
  });

  test('fails closed when no verified brand color qualifies', () => {
    const truth = buildBrandTruth({
      logoMeasured: { hex: '#AA0000', share: 0.01 },
    });

    assert.equal(truth.accent, null);
    assert.equal(truth.ink.onAccent, null);
    assert.equal(truth.refusal, 'no_verified_brand_color');
  });

  test('chooses white ink on dark accents', () => {
    const truth = buildBrandTruth({ operator: { hex: '#003366' } });

    assert.equal(truth.ink.onAccent, '#FFFFFF');
    assert.ok(contrastRatio(truth.accent.hex, truth.ink.onAccent) >= 4.5);
  });

  test('chooses near-black ink on light accents', () => {
    const truth = buildBrandTruth({ operator: { hex: '#FFD700' } });

    assert.equal(truth.ink.onAccent, '#111111');
    assert.ok(contrastRatio(truth.accent.hex, truth.ink.onAccent) >= 4.5);
  });

  test('returned brand truth is deeply frozen', () => {
    const truth = buildBrandTruth({
      operator: { hex: '#C8102E' },
      fonts: { display: 'Inter', body: 'Arial', source: 'operator' },
      logo: { url: 'https://example.test/logo.svg' },
    });

    assert.ok(Object.isFrozen(truth));
    assert.ok(Object.isFrozen(truth.accent));
    assert.ok(Object.isFrozen(truth.font));
    assert.ok(Object.isFrozen(truth.logo));
    assert.throws(() => {
      truth.accent.hex = '#000000';
    }, TypeError);
  });

  test('does not flag identical or perceptually close shipped colors', () => {
    const truth = buildBrandTruth({ operator: { hex: '#C8102E' } });
    const mismatches = validateAgainstShipped(truth, ['#C8102E', '#C8112F']);

    assert.deepEqual(mismatches, []);
  });

  test('flags shipped colors whose deltaE exceeds the drift threshold', () => {
    const truth = buildBrandTruth({ operator: { hex: '#C8102E' } });
    const mismatches = validateAgainstShipped(truth, ['#C8102E', '#0057B8']);

    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0].shippedHex, '#0057B8');
    assert.equal(mismatches[0].truthHex, '#C8102E');
    assert.ok(mismatches[0].deltaE > 10);
    assert.equal(mismatches[0].drift, true);
  });

  test('fails closed during validation when truth has no verified accent', () => {
    const truth = buildBrandTruth({});
    const mismatches = validateAgainstShipped(truth, ['#FF6600']);

    assert.deepEqual(mismatches, [
      {
        index: 0,
        shippedHex: '#FF6600',
        reason: 'no_verified_brand_color',
        drift: true,
      },
    ]);
  });

  test('flags invalid shipped colors as drift', () => {
    const truth = buildBrandTruth({ operator: { hex: '#C8102E' } });
    const mismatches = validateAgainstShipped(truth, ['not-a-color']);

    assert.deepEqual(mismatches, [
      {
        index: 0,
        shippedHex: 'not-a-color',
        reason: 'invalid_shipped_hex',
        drift: true,
      },
    ]);
  });

  test('preserves a valid logo sha256 and drops an invalid one', () => {
    const validHash = sha256('logo-bytes');
    const withHash = buildBrandTruth({
      logo: { url: 'https://example.test/logo.svg', sha256: validHash },
    });
    const withoutHash = buildBrandTruth({
      logo: { url: 'https://example.test/logo.svg', sha256: 'invalid' },
    });

    assert.deepEqual(withHash.logo, {
      url: 'https://example.test/logo.svg',
      sha256: validHash,
    });
    assert.deepEqual(withoutHash.logo, {
      url: 'https://example.test/logo.svg',
    });
  });
}