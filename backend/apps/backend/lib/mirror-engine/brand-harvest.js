'use strict';

/**
 * brand-harvest.cjs
 *
 * Node 20+, CommonJS (`module.exports`), zero npm deps, node builtins only.
 * ONE complete file in ONE code block, runnable as-is.
 * Self-test: `node brand-harvest.cjs --test` prints one PASS/FAIL line per case,
 * exits 0 all-pass / 1 any-fail. No flag = no output.
 *
 * One pass over raw client HTML produces the brand truth consumed by downstream
 * donor hydration, theme tokens, and email rendering. Extraction is deliberately
 * conservative: absent evidence becomes null, never an invented fallback.
 */

function emptyBrand() {
  return {
    fonts: {
      display: null,
      body: null,
      googleHref: null,
      families: []
    },
    palette: {
      accent: null,
      background: null,
      text: null,
      heading: null,
      link: null,
      mode: 'light'
    },
    marks: {
      logo: null,
      favicon: null,
      ogImage: null
    },
    voice: {
      tagline: null,
      description: null
    },
    platform: null
  };
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function decodeHtmlEntities(value) {
  return safeString(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(safeString(value).replace(/\+/g, ' '));
  } catch {
    return safeString(value).replace(/\+/g, ' ');
  }
}

function parseAttributes(tag) {
  const attrs = Object.create(null);
  const input = safeString(tag);

  // WHY: Real client HTML mixes quoted, unquoted, reordered, and boolean
  // attributes. A tiny tolerant scanner is safer here than assuming serializer
  // formatting while still avoiding the complexity of pretending to be an HTML parser.
  const re = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = re.exec(input)) !== null) {
    const key = safeString(match[1]).toLowerCase();
    if (!key || key === 'meta' || key === 'link' || key === 'img') continue;

    const value =
      match[2] !== undefined ? match[2] :
      match[3] !== undefined ? match[3] :
      match[4] !== undefined ? match[4] :
      '';

    if (!(key in attrs)) attrs[key] = decodeHtmlEntities(value);
  }

  return attrs;
}

function getTags(html, tagName) {
  const result = [];
  const escaped = safeString(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}\\b[^>]*>`, 'gi');
  let match;

  while ((match = re.exec(html)) !== null) {
    result.push({
      raw: match[0],
      attrs: parseAttributes(match[0]),
      index: match.index
    });
  }

  return result;
}

function collectStyleText(html) {
  const parts = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let match;

  while ((match = re.exec(html)) !== null) {
    parts.push(match[1] || '');
  }

  return parts.join('\n');
}

function stripCssComments(css) {
  return safeString(css).replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseCssRules(css) {
  const rules = [];
  const clean = stripCssComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = re.exec(clean)) !== null) {
    const selector = safeString(match[1]).trim();
    const body = safeString(match[2]).trim();
    if (!selector || !body) continue;

    // Skip at-rules accidentally surfaced by the deliberately small parser.
    if (selector.startsWith('@')) continue;

    rules.push({ selector, body, index: match.index });
  }

  return rules;
}

function cssProperty(body, property) {
  const escaped = safeString(property).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(?:^|;)\\s*${escaped}\\s*:\\s*([^;!}]+)(?:\\s*!important)?`,
    'i'
  );
  const match = safeString(body).match(re);
  return match ? match[1].trim() : null;
}

function firstFontName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  const first = value.split(',')[0].trim();
  const unquoted = first.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();

  return unquoted || null;
}

function selectorContainsElement(selector, element) {
  const escaped = safeString(element).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // WHY: `.et_pb_text h1`, `h1,h2`, `.hero>h1:hover`, and plain `h1` all
  // represent real heading rules. Word-ish boundaries keep `h10` from matching.
  return new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}(?=$|[^a-zA-Z0-9_-])`, 'i')
    .test(safeString(selector));
}

function selectorHasBody(selector) {
  return selectorContainsElement(selector, 'body');
}

function selectorHasAnchor(selector) {
  return selectorContainsElement(selector, 'a');
}

function normalizeCssColor(value) {
  if (typeof value !== 'string') return null;

  let v = value.trim().toLowerCase();

  // Strip a trailing declaration artifact defensively.
  v = v.replace(/\s*!important\s*$/i, '').trim();

  const shortHex = v.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) return `#${shortHex[1].toLowerCase()}`;

  const longHex = v.match(/^#([0-9a-f]{6})$/i);
  if (longHex) return `#${longHex[1].toLowerCase()}`;

  const rgb = v.match(
    /^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i
  );

  if (rgb) {
    const r = Math.max(0, Math.min(255, Math.round(Number(rgb[1]))));
    const g = Math.max(0, Math.min(255, Math.round(Number(rgb[2]))));
    const b = Math.max(0, Math.min(255, Math.round(Number(rgb[3]))));

    if ([r, g, b].every(Number.isFinite)) {
      return `#${[r, g, b]
        .map(n => n.toString(16).padStart(2, '0'))
        .join('')}`;
    }
  }

  const named = {
    white: '#ffffff',
    black: '#000000'
  };

  return named[v] || null;
}

function parseHexRgb(hex) {
  const normalized = normalizeCssColor(hex);
  if (!normalized) return null;

  let digits = normalized.slice(1);
  if (digits.length === 3) {
    digits = digits.split('').map(ch => ch + ch).join('');
  }

  if (!/^[0-9a-f]{6}$/i.test(digits)) return null;

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16)
  };
}

function saturationPercent(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  const lightness = (max + min) / 2;
  const saturation =
    delta / (1 - Math.abs(2 * lightness - 1));

  return saturation * 100;
}

function relativeLuminance(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;

  function channel(n) {
    const c = n / 255;
    return c <= 0.04045
      ? c / 12.92
      : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  return (
    0.2126 * channel(rgb.r) +
    0.7152 * channel(rgb.g) +
    0.0722 * channel(rgb.b)
  );
}

function collectGoogleFontHrefs(html) {
  const hrefs = [];

  for (const tag of getTags(html, 'link')) {
    const href = safeString(tag.attrs.href);
    if (/fonts\.googleapis\.com\/css/i.test(href)) hrefs.push(href);
  }

  // WHY: Some mirrored/client source carries preload/script-generated font URLs
  // instead of conventional stylesheet links. The contract says every href,
  // so inspect all href attributes rather than only trusting <link rel=stylesheet>.
  const hrefRe = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;

  while ((match = hrefRe.exec(html)) !== null) {
    const href = decodeHtmlEntities(
      match[1] !== undefined ? match[1] :
      match[2] !== undefined ? match[2] :
      match[3] || ''
    );

    if (
      /fonts\.googleapis\.com\/css/i.test(href) &&
      !hrefs.includes(href)
    ) {
      hrefs.push(href);
    }
  }

  return hrefs;
}

function familiesFromGoogleHref(href) {
  const result = [];
  const seen = new Set();
  const rawHref = decodeHtmlEntities(safeString(href));

  let query = '';
  const qIndex = rawHref.indexOf('?');
  if (qIndex >= 0) query = rawHref.slice(qIndex + 1);

  // Decode enough to expose `%7C` separators while preserving repeated family=
  // parameters used by newer Google Fonts URLs.
  const decodedQuery = decodeUrlPart(query);

  const values = [];
  const re = /(?:^|[&?])family=([^&]*)/gi;
  let match;

  while ((match = re.exec(decodedQuery)) !== null) {
    values.push(match[1]);
  }

  // Old Google Fonts commonly uses one family= containing `A|B|C`.
  for (const value of values) {
    const decoded = decodeUrlPart(value);

    for (const rawFamily of decoded.split('|')) {
      // `Open Sans:400,700` and modern `Roboto:wght@400;700` both identify
      // the family by the portion before the variant axis/weight separator.
      const family = rawFamily
        .split(':')[0]
        .trim();

      if (!family) continue;

      const key = family.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(family);
      }
    }
  }

  return result;
}

function collectFamilies(hrefs) {
  const result = [];
  const seen = new Set();

  for (const href of hrefs) {
    for (const family of familiesFromGoogleHref(href)) {
      const key = family.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(family);
      }
    }
  }

  return result;
}

function extractFonts(html, cssRules) {
  const hrefs = collectGoogleFontHrefs(html);
  const families = collectFamilies(hrefs);

  let body = null;
  let display = null;

  for (const rule of cssRules) {
    if (!body && selectorHasBody(rule.selector)) {
      const font = cssProperty(rule.body, 'font-family');
      if (font) body = firstFontName(font);
    }

    // WHY: Divi and other builders commonly put the real heading typography
    // on `.module h1` rather than a naked `h1`. Any selector containing the h1
    // element is therefore evidence, but it only wins when it actually declares
    // font-family.
    if (!display && selectorContainsElement(rule.selector, 'h1')) {
      const font = cssProperty(rule.body, 'font-family');
      if (font) display = firstFontName(font);
    }

    if (body && display) break;
  }

  if (!display && !body && families.length) {
    display = families[families.length - 1] || null;
    body = families[0] || null;
  } else {
    if (!display && families.length) display = families[families.length - 1] || null;
    if (!body && families.length) body = families[0] || null;
  }

  return {
    display,
    body,
    googleHref: hrefs[0] || null,
    families
  };
}

function firstRuleProperty(rules, selectorPredicate, property) {
  for (const rule of rules) {
    if (!selectorPredicate(rule.selector)) continue;
    const value = cssProperty(rule.body, property);
    if (value) return normalizeCssColor(value) || value.trim();
  }
  return null;
}

function collectAccentHexes(html, styleCss) {
  const counts = new Map();
  const firstSeen = new Map();
  let sequence = 0;

  function addFromText(text) {
    const re = /#[0-9a-fA-F]{6}\b/g;
    let match;

    while ((match = re.exec(safeString(text))) !== null) {
      const hex = match[0].toLowerCase();
      if (saturationPercent(hex) < 25) continue;

      counts.set(hex, (counts.get(hex) || 0) + 1);
      if (!firstSeen.has(hex)) firstSeen.set(hex, sequence++);
    }
  }

  addFromText(styleCss);

  const styleAttrRe =
    /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  let match;
  while ((match = styleAttrRe.exec(html)) !== null) {
    addFromText(
      match[1] !== undefined ? match[1] :
      match[2] !== undefined ? match[2] :
      match[3] || ''
    );
  }

  let winner = null;
  let winnerCount = -1;
  let winnerSeen = Infinity;

  for (const [hex, count] of counts) {
    const seen = firstSeen.get(hex);

    if (
      count > winnerCount ||
      (count === winnerCount && seen < winnerSeen)
    ) {
      winner = hex;
      winnerCount = count;
      winnerSeen = seen;
    }
  }

  return winner;
}

function extractPalette(html, styleCss, rules, opts) {
  const background = firstRuleProperty(
    rules,
    selectorHasBody,
    'background-color'
  );

  const text = firstRuleProperty(
    rules,
    selectorHasBody,
    'color'
  );

  const heading = firstRuleProperty(
    rules,
    selector => selectorContainsElement(selector, 'h1'),
    'color'
  );

  const link = firstRuleProperty(
    rules,
    selectorHasAnchor,
    'color'
  );

  const suppliedAccent =
    opts &&
    typeof opts.logoAccent === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(opts.logoAccent.trim())
      ? opts.logoAccent.trim().toLowerCase()
      : null;

  const accent = suppliedAccent || collectAccentHexes(html, styleCss);

  const luminance = relativeLuminance(background);
  const mode =
    luminance !== null && luminance < 0.5
      ? 'dark'
      : 'light';

  return {
    accent,
    background,
    text,
    heading,
    link,
    mode
  };
}

function extractMarks(html) {
  let logo = null;

  for (const tag of getTags(html, 'img')) {
    const src = safeString(tag.attrs.src);
    const cls = safeString(tag.attrs.class);
    const alt = safeString(tag.attrs.alt);

    if (/logo/i.test(`${src} ${cls} ${alt}`) && src) {
      logo = src;
      break;
    }
  }

  let favicon = null;

  for (const tag of getTags(html, 'link')) {
    const rel = safeString(tag.attrs.rel);
    const href = safeString(tag.attrs.href);

    if (
      href &&
      rel.split(/\s+/).some(token => /^icon$/i.test(token))
    ) {
      favicon = href; // LAST rel~="icon" wins — later declarations override earlier, like browsers
    }
  }

  let ogImage = null;

  for (const tag of getTags(html, 'meta')) {
    if (
      safeString(tag.attrs.property).toLowerCase() === 'og:image' &&
      safeString(tag.attrs.content)
    ) {
      ogImage = tag.attrs.content;
      break;
    }
  }

  return {
    logo: logo || null,
    favicon: favicon || null,
    ogImage: ogImage || null
  };
}

function firstSentence(value) {
  const text = safeString(value).trim();
  if (!text) return null;

  const period = text.indexOf('.');
  if (period === -1) return text;

  return text.slice(0, period + 1).trim() || null;
}

function extractVoice(html) {
  let description = null;

  for (const tag of getTags(html, 'meta')) {
    if (
      safeString(tag.attrs.name).toLowerCase() === 'description' &&
      safeString(tag.attrs.content).trim()
    ) {
      description = tag.attrs.content.trim();
      break;
    }
  }

  return {
    tagline: firstSentence(description),
    description
  };
}

function extractPlatform(html) {
  const lower = safeString(html).toLowerCase();

  let generator = null;

  for (const tag of getTags(html, 'meta')) {
    if (
      safeString(tag.attrs.name).toLowerCase() === 'generator' &&
      safeString(tag.attrs.content)
    ) {
      generator = tag.attrs.content.toLowerCase();
      break;
    }
  }

  const evidence = `${generator || ''}\n${lower}`;

  // Specific builders are checked before generic WordPress because Divi and
  // Elementor sites naturally contain WordPress signatures as well.
  const signatures = [
    ['divi', /\bdivi\b|et_pb_|et-divi/i],
    ['elementor', /\belementor\b|elementor-/i],
    ['wix', /\bwix\b|wixstatic\.com|wixsite\.com/i],
    ['squarespace', /\bsquarespace\b|static1\.squarespace\.com/i],
    ['weebly', /\bweebly\b|editmysite\.com/i],
    ['webflow', /\bwebflow\b|webflow\.io|data-wf-/i],
    ['godaddy', /\bgodaddy\b|secureservercdn\.net|websitebuilder\.godaddy/i],
    ['shopify', /\bshopify\b|cdn\.shopify\.com|shopify-section/i],
    ['wordpress', /\bwordpress\b|wp-content\/|wp-includes\//i]
  ];

  for (const [name, re] of signatures) {
    if (re.test(evidence)) return name;
  }

  return null;
}

function harvestBrand(html, opts = {}) {
  const result = emptyBrand();

  try {
    const source = safeString(html);
    const styleCss = collectStyleText(source);
    const rules = parseCssRules(styleCss);

    result.fonts = extractFonts(source, rules);
    result.palette = extractPalette(source, styleCss, rules, opts);
    result.marks = extractMarks(source);
    result.voice = extractVoice(source);
    result.platform = extractPlatform(source);

    return result;
  } catch {
    // HEAD-of-lane truth extraction cannot take the production pipeline down.
    // Partial guesses are worse than explicit absence, so catastrophic parsing
    // failure returns the exact empty truth shape.
    return emptyBrand();
  }
}

module.exports = {
  harvestBrand
};

/* -------------------------------------------------------------------------- */
/* Self-test                                                                   */
/* -------------------------------------------------------------------------- */

if (require.main === module && process.argv.includes('--test')) {
  const assert = require('node:assert/strict');

  const cases = [
    {
      name: 'real Divi production fonts and palette',
      run() {
        const html = `
<!doctype html>
<html>
<head>
  <link rel="stylesheet"
    href="https://fonts.googleapis.com/css?family=Open%20Sans%3A300%2C400%2C600%2C700%7CRubik%3A300%2C400%2C500%2C700%7CArimo%3A400%2C700">
  <style>
    body{font-family:Open Sans,Arial,sans-serif;color:#666;background-color:#fff;}
    h1,h2,h3,h4,h5,h6{color:#333;font-weight:500;}
    h1{font-size:30px}
    .et_pb_text h1{font-family:'Rubik',Helvetica,Arial,sans-serif;}
  </style>
</head>
<body></body>
</html>`;

        const brand = harvestBrand(html);

        assert.equal(brand.fonts.body, 'Open Sans');
        assert.equal(brand.fonts.display, 'Rubik');
        assert.deepEqual(
          brand.fonts.families,
          ['Open Sans', 'Rubik', 'Arimo']
        );
        assert.equal(brand.palette.background, '#fff');
        assert.equal(brand.palette.text, '#666');
        assert.equal(brand.palette.heading, '#333');
        assert.equal(brand.palette.mode, 'light');
      }
    },

    {
      name: 'logo accent wins',
      run() {
        const brand = harvestBrand(
          '<style>.x{color:#0099ff}</style>',
          { logoAccent: '#fb0505' }
        );

        assert.equal(brand.palette.accent, '#fb0505');
      }
    },

    {
      name: 'no fonts returns null font fields',
      run() {
        const brand = harvestBrand('<html><body>Hello</body></html>');

        assert.equal(brand.fonts.display, null);
        assert.equal(brand.fonts.body, null);
        assert.equal(brand.fonts.googleHref, null);
        assert.deepEqual(brand.fonts.families, []);
      }
    },

    {
      name: 'dark body background selects dark mode',
      run() {
        const brand = harvestBrand(
          '<style>body{background-color:#171717;color:#eee}</style>'
        );

        assert.equal(brand.palette.background, '#171717');
        assert.equal(brand.palette.mode, 'dark');
      }
    },

    {
      name: 'logo image detected',
      run() {
        const brand = harvestBrand(
          '<img class="header-logo" src="https://x.com/logo.png">'
        );

        assert.ok(brand.marks.logo);
        assert.match(brand.marks.logo, /logo\.png/);
      }
    },

    {
      name: 'Divi generator detected',
      run() {
        const brand = harvestBrand(
          '<meta name="generator" content="Divi v.4.27.4"/>'
        );

        assert.equal(brand.platform, 'divi');
      }
    },

    {
      name: 'garbage and empty inputs never throw',
      run() {
        for (const html of ['', null, undefined, 42, {}, '<%%% garbage']) {
          const brand = harvestBrand(html);

          assert.deepEqual(brand, {
            fonts: {
              display: null,
              body: null,
              googleHref: null,
              families: []
            },
            palette: {
              accent: null,
              background: null,
              text: null,
              heading: null,
              link: null,
              mode: 'light'
            },
            marks: {
              logo: null,
              favicon: null,
              ogImage: null
            },
            voice: {
              tagline: null,
              description: null
            },
            platform: null
          });
        }
      }
    },

    {
      name: 'Google Fonts fallback uses first body and last display',
      run() {
        const brand = harvestBrand(`
          <link
            href="https://fonts.googleapis.com/css?family=Open%20Sans%3A400%7CRubik%3A700"
            rel="stylesheet">
        `);

        assert.equal(brand.fonts.body, 'Open Sans');
        assert.equal(brand.fonts.display, 'Rubik');
        assert.deepEqual(brand.fonts.families, ['Open Sans', 'Rubik']);
      }
    },

    {
      name: 'frequent saturated six-digit hex becomes accent',
      run() {
        const brand = harvestBrand(`
          <style>
            .one{color:#fb0505}
            .two{border-color:#fb0505}
            .gray{color:#777777}
            .blue{color:#0066cc}
          </style>
          <div style="background:#fb0505"></div>
        `);

        assert.equal(brand.palette.accent, '#fb0505');
      }
    },

    {
      name: 'marks and voice metadata harvested',
      run() {
        const brand = harvestBrand(`
          <meta name="description"
                content="Trusted plumbing for Orange County. Family owned since 1985">
          <meta property="og:image" content="https://x.com/share.jpg">
          <link rel="shortcut icon" href="/ignored.ico">
          <link rel="icon" href="/favicon.png">
        `);

        assert.equal(
          brand.voice.tagline,
          'Trusted plumbing for Orange County.'
        );
        assert.equal(
          brand.voice.description,
          'Trusted plumbing for Orange County. Family owned since 1985'
        );
        assert.equal(brand.marks.ogImage, 'https://x.com/share.jpg');
        assert.equal(brand.marks.favicon, '/favicon.png');
      }
    },

    {
      name: 'exports exactly harvestBrand',
      run() {
        assert.deepEqual(Object.keys(module.exports), ['harvestBrand']);
      }
    }
  ];

  let failed = 0;

  for (const testCase of cases) {
    try {
      testCase.run();
      console.log(`PASS: ${testCase.name}`);
    } catch (error) {
      failed += 1;
      console.log(
        `FAIL: ${testCase.name} - ${
          error && error.message ? error.message : String(error)
        }`
      );
    }
  }

  process.exitCode = failed === 0 ? 0 : 1;
}

