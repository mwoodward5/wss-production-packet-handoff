#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const TAILWIND = Object.freeze({
  slate: { 500: '#64748B', 600: '#475569', 700: '#334155' },
  gray: { 500: '#6B7280', 600: '#4B5563', 700: '#374151' },
  zinc: { 500: '#71717A', 600: '#52525B', 700: '#3F3F46' },
  neutral: { 500: '#737373', 600: '#525252', 700: '#404040' },
  stone: { 500: '#78716C', 600: '#57534E', 700: '#44403C' },
  red: { 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C' },
  orange: { 500: '#F97316', 600: '#EA580C', 700: '#C2410C' },
  amber: { 500: '#F59E0B', 600: '#D97706', 700: '#B45309' },
  yellow: { 500: '#EAB308', 600: '#CA8A04', 700: '#A16207' },
  lime: { 500: '#84CC16', 600: '#65A30D', 700: '#4D7C0F' },
  green: { 500: '#22C55E', 600: '#16A34A', 700: '#15803D' },
  emerald: { 500: '#10B981', 600: '#059669', 700: '#047857' },
  teal: { 500: '#14B8A6', 600: '#0D9488', 700: '#0F766E' },
  cyan: { 500: '#06B6D4', 600: '#0891B2', 700: '#0E7490' },
  sky: { 500: '#0EA5E9', 600: '#0284C7', 700: '#0369A1' },
  blue: { 500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8' },
  indigo: { 500: '#6366F1', 600: '#4F46E5', 700: '#4338CA' },
  violet: { 500: '#8B5CF6', 600: '#7C3AED', 700: '#6D28D9' },
  purple: { 500: '#A855F7', 600: '#9333EA', 700: '#7E22CE' },
  fuchsia: { 500: '#D946EF', 600: '#C026D3', 700: '#A21CAF' },
  pink: { 500: '#EC4899', 600: '#DB2777', 700: '#BE185D' },
  rose: { 500: '#F43F5E', 600: '#E11D48', 700: '#BE123C' }
});

const SHADCN = Object.freeze({
  'zinc-primary': '#18181B',
  'slate-primary': '#0F172A',
  'neutral-primary': '#171717',
  'stone-primary': '#1C1917',
  'default-primary': '#18181B',
  'blue-primary': '#2563EB'
});

const BOOTSTRAP = Object.freeze({
  primary: '#0D6EFD',
  secondary: '#6C757D',
  success: '#198754',
  danger: '#DC3545',
  warning: '#FFC107',
  info: '#0DCAF0',
  dark: '#212529'
});

const MUI = Object.freeze({
  'primary-main': '#1976D2',
  'primary-dark': '#1565C0',
  'secondary-main': '#9C27B0',
  'secondary-dark': '#7B1FA2',
  'error-main': '#D32F2F',
  'warning-main': '#ED6C02',
  'info-main': '#0288D1',
  'success-main': '#2E7D32'
});

const SUSPICIOUS_DISTANCE = 5;
const LOGO_DIVERGENCE_DISTANCE = 25;

const STOCK_PALETTES = Object.freeze(
  [
    ...Object.entries(TAILWIND).flatMap(([hue, shades]) =>
      Object.entries(shades).map(([shade, hex]) => ({
        palette: 'tailwind',
        name: `${hue}-${shade}`,
        hex
      }))
    ),
    ...Object.entries(SHADCN).map(([name, hex]) => ({
      palette: 'shadcn',
      name,
      hex
    })),
    ...Object.entries(BOOTSTRAP).map(([name, hex]) => ({
      palette: 'bootstrap',
      name,
      hex
    })),
    ...Object.entries(MUI).map(([name, hex]) => ({
      palette: 'mui',
      name,
      hex
    }))
  ].map(Object.freeze)
);

function normalizeHex(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Expected a hex color string.');
  }

  const value = input.trim();

  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .slice(1)
      .split('')
      .map((channel) => channel + channel)
      .join('')
      .toUpperCase()}`;
  }

  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return value.toUpperCase();
  }

  throw new TypeError(`Invalid hex color: ${input}`);
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex);

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

function rgbToLab(r, g, b) {
  const linearize = (channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };

  const red = linearize(r);
  const green = linearize(g);
  const blue = linearize(b);

  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;

  const pivot = (value) =>
    value > 0.008856
      ? Math.cbrt(value)
      : (7.787 * value) + (16 / 116);

  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function hexToLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

function deltaEApprox(labA, labB) {
  return Math.hypot(
    labA.l - labB.l,
    labA.a - labB.a,
    labA.b - labB.b
  );
}

function colorDistance(hexA, hexB) {
  return deltaEApprox(hexToLab(hexA), hexToLab(hexB));
}

function isExactHexMatch(hexA, hexB) {
  return normalizeHex(hexA) === normalizeHex(hexB);
}

function findStockMatches(shippedHex, threshold = SUSPICIOUS_DISTANCE) {
  const shipped = normalizeHex(shippedHex);
  const shippedLab = hexToLab(shipped);

  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    throw new TypeError('threshold must be a finite non-negative number.');
  }

  return STOCK_PALETTES
    .map(({ palette, name, hex }) => ({
      palette,
      name,
      hex,
      distance: Number(deltaEApprox(shippedLab, hexToLab(hex)).toFixed(3))
    }))
    .filter((match) => match.distance < threshold)
    .sort((a, b) => a.distance - b.distance);
}

function checkAccent(shippedHex, context = {}) {
  const shipped = normalizeHex(shippedHex);
  const matches = findStockMatches(shipped);
  const exactMatch = STOCK_PALETTES.some(({ hex }) => isExactHexMatch(shipped, hex));
  const nearStock = matches.length > 0;

  let logoDistance = null;

  if (context != null) {
    if (typeof context !== 'object' || Array.isArray(context)) {
      throw new TypeError('context must be an object when provided.');
    }

    if (context.clientLogoAccent != null) {
      logoDistance = colorDistance(shipped, context.clientLogoAccent);
    }
  }

  let verdict = 'ok';

  if (exactMatch) {
    verdict = 'framework_default';
  } else if (nearStock) {
    verdict = 'suspicious';
  }

  /*
   * This condition intentionally does not downgrade exact framework matches:
   * an exact stock/default accent is framework_default regardless of logo color.
   * For a merely near-stock color, a divergent client logo confirms suspicion.
   */
  if (
    !exactMatch &&
    nearStock &&
    logoDistance != null &&
    logoDistance > LOGO_DIVERGENCE_DISTANCE
  ) {
    verdict = 'suspicious';
  }

  return { verdict, matches };
}

module.exports = {
  TAILWIND,
  SHADCN,
  BOOTSTRAP,
  MUI,
  SUSPICIOUS_DISTANCE,
  LOGO_DIVERGENCE_DISTANCE,
  STOCK_PALETTES,
  normalizeHex,
  hexToRgb,
  rgbToLab,
  hexToLab,
  deltaEApprox,
  colorDistance,
  isExactHexMatch,
  findStockMatches,
  checkAccent
};

if (require.main === module && process.argv.includes('--test')) {
  test('detects Tailwind orange-600 exactly', () => {
    const result = checkAccent('#EA580C');

    assert.equal(result.verdict, 'framework_default');
    assert.deepEqual(result.matches[0], {
      palette: 'tailwind',
      name: 'orange-600',
      hex: '#EA580C',
      distance: 0
    });
  });

  test('detects Tailwind red-600 exactly', () => {
    const result = checkAccent('#dc2626');

    assert.equal(result.verdict, 'framework_default');
    assert.equal(result.matches[0].name, 'red-600');
  });

  test('detects Bootstrap primary exactly', () => {
    const result = checkAccent('#0d6efd');

    assert.equal(result.verdict, 'framework_default');
    assert.ok(result.matches.some((match) =>
      match.palette === 'bootstrap' && match.name === 'primary'
    ));
  });

  test('detects MUI primary exactly', () => {
    const result = checkAccent('#1976d2');

    assert.equal(result.verdict, 'framework_default');
    assert.ok(result.matches.some((match) =>
      match.palette === 'mui' && match.name === 'primary-main'
    ));
  });

  test('detects shadcn zinc default exactly', () => {
    const result = checkAccent('#18181b');

    assert.equal(result.verdict, 'framework_default');
    assert.ok(result.matches.some((match) =>
      match.palette === 'shadcn' && match.name === 'zinc-primary'
    ));
  });

  test('marks a near stock color suspicious', () => {
    const result = checkAccent('#EA590C');

    assert.equal(result.verdict, 'suspicious');
    assert.equal(result.matches[0].name, 'orange-600');
    assert.ok(result.matches[0].distance > 0);
    assert.ok(result.matches[0].distance < SUSPICIOUS_DISTANCE);
  });

  test('marks a distinct custom color ok', () => {
    const result = checkAccent('#123456');

    assert.equal(result.verdict, 'ok');
    assert.deepEqual(result.matches, []);
  });

  test('detects the tattoo-shop incident against the logo accent', () => {
    const result = checkAccent('#EA580C', {
      clientLogoAccent: '#ED1C24'
    });

    assert.equal(result.verdict, 'framework_default');
    assert.equal(result.matches[0].name, 'orange-600');
    assert.equal(result.matches[0].distance, 0);
    assert.notEqual(normalizeHex('#EA580C'), normalizeHex('#ED1C24'));
  });

  test('supports three-digit hex input', () => {
    /*
     * The prior expectation was wrong. #f43 expands to #FF4433, not #F43F5E,
     * and its CIE76 Lab distance from Tailwind red-500 exceeds the mandated
     * suspicious cutoff of < 5. Therefore it correctly returns ok.
     */
    const result = checkAccent('#f43');
    const red500Distance = colorDistance('#FF4433', TAILWIND.red[500]);

    assert.equal(normalizeHex('#f43'), '#FF4433');
    assert.ok(red500Distance >= SUSPICIOUS_DISTANCE);
    assert.equal(result.verdict, 'ok');
    assert.deepEqual(result.matches, []);
  });

  test('rejects malformed hex values', () => {
    assert.throws(() => checkAccent('EA580C'), /Invalid hex color/);
    assert.throws(() => checkAccent('#GG0000'), /Invalid hex color/);
    assert.throws(() => checkAccent('#1234'), /Invalid hex color/);
  });
} else if (require.main === module) {
  const [, , shippedHex, clientLogoAccent] = process.argv;

  if (!shippedHex) {
    process.stderr.write(
      'Usage: node brand-default-detector.cjs <shippedHex> [clientLogoAccent]\n'
    );
    process.exitCode = 1;
  } else {
    try {
      const context = clientLogoAccent ? { clientLogoAccent } : {};
      process.stdout.write(`${JSON.stringify(checkAccent(shippedHex, context), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}