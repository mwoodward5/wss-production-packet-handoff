'use strict';

/**
 * fleet-polish-pass.js
 *
 * Node 20+, CommonJS, zero npm dependencies.
 *
 * No CLI flag: no output.
 * --test: one PASS/FAIL line per test, exit 0/1.
 */

// The alt-text policy is shared with the facts boundary (lib/mirror-engine/
// image-alt.js) so an <img> polished here reads the SAME sentence the intake
// approved. Local module — the zero-npm-dependency doctrine is unchanged.
const { composeAlt, serviceHintFromSrc, humanizeName } = require('./image-alt');

// THE MOBILE RENDERING FLOOR (2026-09-02): the mobile-polish CSS module —
// contrast floor, typography scale, spacing rhythm, image quality, CTA
// visibility and the washed-out treatment at <=768px. Its own module because
// the mobile sheet is its own law (and its own test file); injected by
// polishSite as a second idempotent style block AFTER the fleet block so
// same-specificity ties resolve in the mobile floor's favour.
const mobilePolish = require('./mobile-polish');

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\u0000-\u001F\u007F]/g, '');
}

function normalizeUrlForComparison(value) {
  if (typeof value !== 'string') return '';
  const index = value.indexOf('?');
  return index === -1 ? value : value.slice(0, index);
}

function safeReplacementUrls(value, warnings) {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      warnings.push('replacementUrls must be an array');
    }
    return [];
  }

  const result = [];

  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'string') {
      warnings.push(`replacementUrls[${i}] must be a string`);
      continue;
    }

    result.push(value[i]);
  }

  return result;
}

/**
 * Replace duplicate <img src="..."> values after their first occurrence.
 *
 * Comparison ignores query strings. Replacement URLs are consumed in order,
 * but a candidate is used only if its normalized URL has not already appeared
 * in the document or already been selected as a replacement.
 *
 * @param {*} html
 * @param {*} options
 * @returns {{html: *, replaced: Array<{from:string,to:string}>, warnings:string[]}}
 */
function dedupeGallery(html, options = {}) {
  const warnings = [];
  const replaced = [];

  if (typeof html !== 'string') {
    warnings.push('html must be a string');
    return { html, replaced, warnings };
  }

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    warnings.push('options must be an object');
    options = {};
  }

  const replacementUrls = safeReplacementUrls(
    options.replacementUrls,
    warnings
  );

  /*
   * Match <img ... src = "..." ...>, supporting:
   *   src="x"
   *   src='x'
   *   SRC = "x"
   *
   * Intentionally requires a quoted src value so hostile/malformed markup is
   * not rewritten speculatively.
   *
   * Capture groups:
   * 1: everything through opening quote
   * 2: quote
   * 3: src value
   * 4: closing quote + remainder of tag
   */
  const imgSrcRegex =
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([\s\S]*?)(\2)([^>]*>)/gi;

  const occurrences = [];
  let match;

  while ((match = imgSrcRegex.exec(html)) !== null) {
    const rawUrl = match[3];
    occurrences.push({
      start: match.index,
      end: imgSrcRegex.lastIndex,
      full: match[0],
      prefix: match[1],
      quote: match[2],
      rawUrl,
      normalized: normalizeUrlForComparison(rawUrl),
      suffix: match[5]
    });

    if (match[0].length === 0) {
      imgSrcRegex.lastIndex += 1;
    }
  }

  if (occurrences.length < 2) {
    return { html, replaced, warnings };
  }

  const counts = new Map();
  const allOriginalNormalized = new Set();

  for (const occurrence of occurrences) {
    const key = occurrence.normalized;
    counts.set(key, (counts.get(key) || 0) + 1);
    allOriginalNormalized.add(key);
  }

  const seen = new Map();
  const usedNormalized = new Set(allOriginalNormalized);
  let replacementIndex = 0;
  let lastEnd = 0;
  let output = '';

  /*
   * One warning per duplicated normalized URL when at least one duplicate
   * cannot be repaired. This matches the contract's singular warning example
   * for a URL even if it appears three or more times.
   */
  const warnedNoReplacement = new Set();

  function nextUnusedReplacement() {
    while (replacementIndex < replacementUrls.length) {
      const candidate = replacementUrls[replacementIndex];
      replacementIndex += 1;

      const normalized = normalizeUrlForComparison(candidate);

      /*
       * Empty replacements are not useful, and replacements that normalize
       * to an already-present image would merely create another duplicate.
       */
      if (!normalized || usedNormalized.has(normalized)) continue;

      usedNormalized.add(normalized);
      return candidate;
    }

    return null;
  }

  for (const occurrence of occurrences) {
    output += html.slice(lastEnd, occurrence.start);

    const key = occurrence.normalized;
    const priorUses = seen.get(key) || 0;
    seen.set(key, priorUses + 1);

    const isDuplicate = (counts.get(key) || 0) >= 2 && priorUses >= 1;

    if (!isDuplicate) {
      output += occurrence.full;
      lastEnd = occurrence.end;
      continue;
    }

    const replacement = nextUnusedReplacement();

    if (replacement === null) {
      output += occurrence.full;

      if (!warnedNoReplacement.has(key)) {
        warnedNoReplacement.add(key);
        warnings.push(`no replacement available for ${occurrence.rawUrl}`);
      }

      lastEnd = occurrence.end;
      continue;
    }

    /*
     * Always emit a double-quoted src attribute and attribute-escape the
     * replacement. This prevents values such as:
     *
     *   "><script>alert(1)</script>
     *
     * from escaping the src attribute.
     */
    const newTag =
      occurrence.prefix +
      '"' +
      escapeHtmlAttribute(replacement) +
      '"' +
      occurrence.suffix;

    output += newTag;

    replaced.push({
      from: occurrence.rawUrl,
      to: replacement
    });

    lastEnd = occurrence.end;
  }

  output += html.slice(lastEnd);

  return {
    html: output,
    replaced,
    warnings
  };
}

const IMAGE_URL_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const JS_GALLERY_WORD_PATTERN =
  /(?:gallery|portfolio|projects?|recent\s+work|our\s+work|selected\s+work|field\s+work|lookbook|field\s+plates?)/i;
const JS_GALLERY_COPY_PATTERN =
  /(?:gallery|portfolio|recent\s+work|our\s+work|selected\s+work|field\s+work|lookbook|field\s+plates?)/i;
const JS_GALLERY_ID_PATTERN =
  /\bid\s*:\s*(["'`])(?:gallery|portfolio|projects?|work)\1/i;

function isImageUrl(value) {
  return typeof value === 'string' && IMAGE_URL_PATTERN.test(value);
}

/*
 * Read a static JavaScript string without evaluating the donor bundle. Dynamic
 * template literals are deliberately refused: rewriting an expression would
 * be speculation, while compiled donor asset paths are ordinary literals.
 */
function readJsString(source, start) {
  if (typeof source !== 'string') return null;

  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;

  let value = '';

  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === quote) {
      return { start, end: i + 1, value };
    }

    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      return null;
    }

    if (ch !== '\\') {
      value += ch;
      continue;
    }

    if (i + 1 >= source.length) return null;

    const escaped = source[i + 1];
    const simple = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      0: '\0'
    };

    if (Object.prototype.hasOwnProperty.call(simple, escaped)) {
      value += simple[escaped];
      i += 1;
      continue;
    }

    if (escaped === '\n') {
      i += 1;
      continue;
    }

    if (escaped === '\r') {
      if (source[i + 2] === '\n') i += 1;
      i += 1;
      continue;
    }

    if (escaped === 'x') {
      const hex = source.slice(i + 2, i + 4);
      if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 3;
      continue;
    }

    if (escaped === 'u') {
      const hex = source.slice(i + 2, i + 6);
      if (!/^[0-9a-f]{4}$/i.test(hex)) return null;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }

    /* Includes escaped quotes, slashes, backslashes and legacy JS escapes. */
    value += escaped;
    i += 1;
  }

  return null;
}

function safeJsString(value) {
  return JSON.stringify(String(value))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function skipJsSpace(source, start) {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

/*
 * Find the end of an array literal while ignoring strings and comments. This
 * is intentionally a small structural reader, not a JavaScript evaluator.
 */
function matchingArrayEnd(source, openIndex) {
  let depth = 0;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      for (; i < source.length; i += 1) {
        if (source[i] === '\\') {
          i += 1;
          continue;
        }
        if (source[i] === quote) break;
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i + 2);
      if (newline === -1) return -1;
      i = newline;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }

    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function staticImageBindings(source) {
  const bindings = new Map();
  const ambiguous = new Set();
  const assignment = /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*=\s*/g;
  let match;

  while ((match = assignment.exec(source)) !== null) {
    const valueStart = skipJsSpace(source, assignment.lastIndex);
    const literal = readJsString(source, valueStart);

    if (!literal || !isImageUrl(literal.value)) continue;

    const name = match[1];
    if (bindings.has(name) && bindings.get(name) !== literal.value) {
      ambiguous.add(name);
      bindings.delete(name);
    } else if (!ambiguous.has(name)) {
      bindings.set(name, literal.value);
    }

    assignment.lastIndex = literal.end;
  }

  return bindings;
}

function escapedRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function galleryArrayRanges(source) {
  const ranges = [];
  const assignment = /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*=\s*\[/g;
  let match;

  while ((match = assignment.exec(source)) !== null) {
    const open = assignment.lastIndex - 1;
    const end = matchingArrayEnd(source, open);
    if (end === -1) continue;

    const before = source.slice(Math.max(0, match.index - 512), open);
    const after = source.slice(end, Math.min(source.length, end + 32768));
    const named = JS_GALLERY_WORD_PATTERN.test(match[1]);
    const semanticId = JS_GALLERY_ID_PATTERN.test(before + after);
    /* Copy inside an image card can say "project" or "portfolio" without
     * making the array a gallery. Require semantics around the data contract. */
    const semanticCopy = JS_GALLERY_COPY_PATTERN.test(before + after);
    const reusedAfter = new RegExp(
      `(?:^|[^\\w$])${escapedRegex(match[1])}(?:[^\\w$]|$)`
    ).test(after);

    if (named || (reusedAfter && (semanticId || semanticCopy))) {
      ranges.push({ start: open, end });
    }

    assignment.lastIndex = end;
  }

  /* Nested data contracts such as `site={ gallery:[...] }` have no array
   * assignment name of their own, but the semantic property is explicit. */
  const property = /\b(?:gallery|portfolio|projects?|lookbook)\s*:\s*\[/gi;
  while ((match = property.exec(source)) !== null) {
    const open = property.lastIndex - 1;
    const end = matchingArrayEnd(source, open);
    if (end === -1) continue;
    if (!ranges.some((range) => range.start === open && range.end === end)) {
      ranges.push({ start: open, end });
    }
    property.lastIndex = end;
  }

  /* Prefer the most specific nested gallery contract over a containing array. */
  return ranges.filter((range, index) =>
    !ranges.some((other, otherIndex) =>
      otherIndex !== index &&
      other.start >= range.start &&
      other.end <= range.end &&
      (other.start > range.start || other.end < range.end)
    )
  );
}

function bareImageReferences(source, range, bindings) {
  const references = [];
  let index = range.start + 1;
  const close = range.end - 1;
  let expectValue = true;

  while (index < close) {
    index = skipJsSpace(source, index);
    if (index >= close) break;

    if (!expectValue) {
      if (source[index] !== ',') return [];
      expectValue = true;
      index += 1;
      continue;
    }

    const literal = readJsString(source, index);
    if (literal) {
      if (!isImageUrl(literal.value)) return [];
      references.push({
        start: literal.start,
        end: literal.end,
        value: literal.value
      });
      index = literal.end;
      expectValue = false;
      continue;
    }

    const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
    if (!identifier || !bindings.has(identifier[0])) return [];
    references.push({
      start: index,
      end: index + identifier[0].length,
      value: bindings.get(identifier[0])
    });
    index += identifier[0].length;
    expectValue = false;
  }

  return references.length >= 2 ? references : [];
}

function propertyMediaReferences(source, range, bindings) {
  const references = [];
  const body = source.slice(range.start, range.end);
  const property = /(?:^|[,{])\s*(?:src|image|img)\s*:\s*/g;
  let match;

  while ((match = property.exec(body)) !== null) {
    const valueStart = skipJsSpace(
      source,
      range.start + property.lastIndex
    );
    const literal = readJsString(source, valueStart);

    if (literal) {
      if (isImageUrl(literal.value)) {
        references.push({
          start: literal.start,
          end: literal.end,
          value: literal.value
        });
      }
      property.lastIndex = Math.max(
        property.lastIndex,
        literal.end - range.start
      );
      continue;
    }

    const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(valueStart));
    if (!identifier || !bindings.has(identifier[0])) continue;

    references.push({
      start: valueStart,
      end: valueStart + identifier[0].length,
      value: bindings.get(identifier[0])
    });
  }

  return references;
}

function mediaReferences(source, range, bindings) {
  const references = propertyMediaReferences(source, range, bindings);
  return references.length >= 2
    ? references
    : bareImageReferences(source, range, bindings);
}

function allStaticImageValues(source, bindings) {
  const values = new Set(bindings.values());

  for (let i = 0; i < source.length; i += 1) {
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== '`') continue;

    const literal = readJsString(source, i);
    if (literal) {
      if (isImageUrl(literal.value)) values.add(literal.value);
      i = literal.end - 1;
      continue;
    }

    /* Dynamic template or malformed string: skip it without interpreting it. */
    i += 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '\\') {
        i += 1;
        continue;
      }
      if (source[i] === quote) break;
    }
  }

  return values;
}

/**
 * Replace repeated image values inside gallery-like JavaScript data arrays.
 *
 * Scope is deliberately narrow: a candidate must be an assigned array with at
 * least two `src:`/`image:` fields and nearby gallery/portfolio/project
 * semantics. Static aliases are resolved, but expressions and dynamic template
 * strings are untouched. Only the duplicate value token changes; all code,
 * captions and nonduplicate assets remain byte-for-byte identical.
 */
function dedupeJavaScriptGallery(source, options = {}) {
  const warnings = [];
  const replaced = [];

  if (typeof source !== 'string') {
    warnings.push('javascript must be a string');
    return { javascript: source, replaced, warnings };
  }

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    warnings.push('options must be an object');
    options = {};
  }

  const replacementUrls = safeReplacementUrls(
    options.replacementUrls,
    warnings
  );
  const bindings = staticImageBindings(source);
  const ranges = galleryArrayRanges(source);
  const bundleImages = allStaticImageValues(source, bindings);
  const allPropertyReferences = propertyMediaReferences(
    source,
    { start: 0, end: source.length },
    bindings
  );
  const outsideCounts = new Map();

  for (const reference of allPropertyReferences) {
    const insideGallery = ranges.some((range) =>
      reference.start >= range.start && reference.end <= range.end
    );
    if (insideGallery) continue;
    const key = normalizeUrlForComparison(reference.value);
    outsideCounts.set(key, (outsideCounts.get(key) || 0) + 1);
  }
  const edits = [];

  for (const range of ranges) {
    const references = mediaReferences(source, range, bindings);
    if (references.length < 2) continue;

    const counts = new Map();
    const seen = new Map();
    const warned = new Set();
    const used = new Set();

    for (const reference of references) {
      const key = normalizeUrlForComparison(reference.value);
      counts.set(key, (counts.get(key) || 0) + 1);
      used.add(key);
    }

    /* Do not introduce an URL already used elsewhere in this bundle. */
    for (const value of bundleImages) {
      used.add(normalizeUrlForComparison(value));
    }

    let replacementIndex = 0;
    function nextReplacement() {
      while (replacementIndex < replacementUrls.length) {
        const candidate = replacementUrls[replacementIndex];
        replacementIndex += 1;
        const key = normalizeUrlForComparison(candidate);
        if (!key || used.has(key)) continue;
        used.add(key);
        return candidate;
      }
      return null;
    }

    for (const reference of references) {
      const key = normalizeUrlForComparison(reference.value);
      const prior = seen.get(key) || 0;
      seen.set(key, prior + 1);

      const repeatsInside = (counts.get(key) || 0) >= 2 && prior >= 1;
      const repeatsOutside = (outsideCounts.get(key) || 0) >= 1;
      if (!repeatsInside && !repeatsOutside) continue;

      const replacement = nextReplacement();
      if (replacement === null) {
        if (!warned.has(key)) {
          warned.add(key);
          warnings.push(`no replacement available for ${reference.value}`);
        }
        continue;
      }

      edits.push({
        start: reference.start,
        end: reference.end,
        text: safeJsString(replacement)
      });
      replaced.push({ from: reference.value, to: replacement });
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let javascript = source;
  let lastStart = source.length;

  for (const edit of edits) {
    /* Overlapping candidate arrays must never apply the same edit twice. */
    if (edit.end > lastStart) continue;
    javascript =
      javascript.slice(0, edit.start) +
      edit.text +
      javascript.slice(edit.end);
    lastStart = edit.start;
  }

  return { javascript, replaced, warnings };
}

function isFirstPartyJavaScriptKey(key) {
  if (typeof key !== 'string' || !/\.js(?:\.raw)?$/i.test(key)) return false;
  if (/(?:^|[\\/])(?:node_modules|third[-_]?party|vendor)(?:[\\/]|$)/i.test(key)) return false;
  if (/(?:^|[\\/])[^\\/]*vendor[^\\/]*\.js(?:\.raw)?$/i.test(key)) return false;
  if (/\.min\.js$/i.test(key)) return false;
  return true;
}

function tapFloorCss() {
  return [
    '@media (max-width: 768px) {',
    '  a, button, [role="button"], summary, input[type="submit"], input[type="button"] {',
    '    min-height: 44px;',
    '    min-width: 44px;',
    '    display: inline-flex;',
    '    align-items: center;',
    '    justify-content: center;',
    '  }',
    // AUDIT A2 (S2): a FLOOR, never a CEILING. This sheet is unlayered and
    // the clean donors author in @layer, so the 44px min-width above did not
    // just floor small controls — it REPLACED the header brand anchor's own
    // min-width (min(220px, 100%) on the clean families), and flex then
    // crushed the wordmark to its first letters with the city wrapping
    // mid-word ("Mu\nlfreesboro", every family, every site). Identity
    // anchors keep whatever min-width their own stylesheet gives them; the
    // 44px floor still governs every control that is not an identity mark.
    '  :is(a, button):is([class*="brand" i], [class*="logo" i], [class*="wordmark" i]) {',
    '    min-width: revert-layer;',
    '  }',
    '}'
  ].join('\n');
}

/*
 * THE CONTRAST PAIR MANIFEST — the declared text/background pairs the contrast
 * floor ships, with the WCAG bar each must clear. `scripts/check-contrast.js`
 * (npm run check:contrast) computes every ratio with the same WCAG 2.1 maths
 * theme.js uses and fails the run below the bar, and the test suite cross-
 * checks that every manifest ink actually appears in the emitted CSS, so the
 * manifest and the stylesheet can never drift apart silently.
 *
 * Surfaces are the worst plausible fleet canvases per mode: #101216 is a
 * near-black dark canvas and #262a33 a raised dark card; #ffffff is the light
 * paper and #f3f2ef the pale slab the theme pass paints in light mode. Every
 * ink below was measured against BOTH of its mode's surfaces before being
 * chosen — see the ratios in test/fleet-visual-token-fixes.test.js.
 */
function contrastPairManifest() {
  return [
    { mode: 'dark', role: 'body', fg: '#e8e8ea', bg: '#101216', minimum: 4.5 },
    { mode: 'dark', role: 'body-on-card', fg: '#e8e8ea', bg: '#262a33', minimum: 4.5 },
    { mode: 'dark', role: 'link', fg: '#9db4ff', bg: '#101216', minimum: 4.5 },
    { mode: 'dark', role: 'link-on-card', fg: '#9db4ff', bg: '#262a33', minimum: 4.5 },
    { mode: 'dark', role: 'secondary-label', fg: '#c9cdd7', bg: '#101216', minimum: 4.5 },
    { mode: 'dark', role: 'secondary-label-on-card', fg: '#c9cdd7', bg: '#262a33', minimum: 4.5 },
    { mode: 'dark', role: 'placeholder', fg: '#b0b0b8', bg: '#101216', minimum: 4.5 },
    { mode: 'light', role: 'body', fg: '#242933', bg: '#ffffff', minimum: 4.5 },
    { mode: 'light', role: 'body-on-slab', fg: '#242933', bg: '#f3f2ef', minimum: 4.5 },
    { mode: 'light', role: 'link', fg: '#1a4fc4', bg: '#ffffff', minimum: 4.5 },
    { mode: 'light', role: 'link-on-slab', fg: '#1a4fc4', bg: '#f3f2ef', minimum: 4.5 },
    { mode: 'light', role: 'secondary-label', fg: '#4d5460', bg: '#ffffff', minimum: 4.5 },
    { mode: 'light', role: 'secondary-label-on-slab', fg: '#4d5460', bg: '#f3f2ef', minimum: 4.5 },
    { mode: 'light', role: 'placeholder', fg: '#565d6a', bg: '#ffffff', minimum: 4.5 },
    {
      /* The hero-ink guard ships the palette's own text ink (var(--wss-text))
       * over the themed pale hero surfaces; the fallback literal is what an
       * unthemed build gets. Measured against the pale slab, not white — the
       * hero bands tint darker than the paper. The old white-on-#808080
       * display pair here described a veil that no longer paints in light
       * mode and a guard ink that no longer ships. */
      mode: 'light',
      role: 'hero-display-ink',
      fg: '#242933',
      bg: '#f3f2ef',
      minimum: 4.5
    }
  ];
}

/*
 * Label/tag/eyebrow shape — the small utility text the audits measured as the
 * weakest ink on the page ("dark-mode label/tag contrast weak", Rooter Right
 * and United Contractors; the same shapes wash out in light mode). Class
 * hooks stay substring-loose so the compiled Tailwind donors, the handcrafted
 * clean-room donors and the engine's own injected sections all match.
 */
const WSS_LABEL_INK_SELECTOR = [
  'small', 'dt', 'dd', 'summary', 'cite', 'time', 'address',
  '[class*="tag" i]', '[class*="badge" i]', '[class*="chip" i]',
  '[class*="label" i]', '[class*="eyebrow" i]', '[class*="kicker" i]',
  '[class*="caption" i]', '[class*="subtext" i]'
].join(', ');

function contrastFloorCss() {
  return [
    '/* The site theme toggle is authoritative.  An OS-level media query here',
    ' * used !important and made an explicitly Light site unreadable on a dark',
    ' * operating system.  Keep the contrast floor, but bind it only to the',
    ' * explicit WSS dark state. */',
    '[data-wss-theme="dark"], :root.dark {',
    '  body, p, li, a, span, h1, h2, h3, h4, h5, h6, label, td, th, figcaption, blockquote {',
    '    color: #e8e8ea !important;',
    '  }',
    '  a {',
    '    color: #9db4ff !important;',
    '  }',
    '  /* AUDIT (Comet, 2026-09-02) — dark labels/tags/secondary text. These',
    '     shapes were the weakest ink on Rooter Right and United Contractors:',
    '     dimmed utility text that never met the element list above, so the',
    '     donor\'s 45%-alpha grey shipped. One proven secondary ink, still',
    '     quieter than the body floor, now clears AA against the dark canvas',
    '     AND the raised dark card. */',
    `  ${WSS_LABEL_INK_SELECTOR} {`,
    '    color: #c9cdd7 !important;',
    '  }',
    '  *::placeholder {',
    '    color: #b0b0b8 !important;',
    '  }',
    '}',
    '/* AUDIT (Comet, 2026-09-02) — the washed-out light-mode floor. The dark',
    ' * state had a proven ink and light mode had NOTHING: muted donor greys',
    ' * shipped at 2-3:1 on white across Southwest Builders, Good Life, True',
    ' * Fence and North MS Fence. Same floor, other side: one solid body ink,',
    ' * one link ink, one secondary/label ink, each measured against the white',
    ' * paper and the pale slab before shipping.',
    ' *',
    ' * DELIBERATELY WITHOUT !important. The dark floor must win everything',
    ' * because a dark canvas is uniform; light mode shares its page with',
    ' * dark-styled hero bands, and the hero ink passes (lib/hero-wash.js',
    ' * heroTextCss, heroContrastFloorCss below) force their PROVEN hero inks',
    ' * with !important — an !important here would repaint those words dark',
    ' * over a dark scrim. This floor only has to beat the donor\'s own washed',
    ' * utilities (single-class specificity), which the :root:not() scope',
    ' * clears by three class-widths. */',
    ':root:not([data-wss-theme="dark"]):not(.dark), [data-wss-theme="light"] {',
    '  body, p, li, a, span, h1, h2, h3, h4, h5, h6, label, td, th, figcaption, blockquote {',
    '    color: #242933;',
    '  }',
    '  a {',
    '    color: #1a4fc4;',
    '  }',
    `  ${WSS_LABEL_INK_SELECTOR} {`,
    '    color: #4d5460;',
    '  }',
    '  *::placeholder {',
    '    color: #565d6a;',
    '  }',
    '}',
    '/* The hero-ink guard, same audit. Heroes without a wash or a floor keep',
    ' * the theme\'s proven ink: this restores it AFTER the light floor above',
    ' * (higher specificity, later in the block). The ink is --wss-text — the',
    ' * palette\'s own body ink, walked to 7:1 against the light surfaces at',
    ' * build time — because in LIGHT mode the themed hero surfaces ARE pale',
    ' * (the theme repoints every slab band and glass card to a pale tint, and',
    ' * the polish veil below no longer paints in light mode). The old bare',
    ' * #ffffff here was the light-theme "wash": white display ink over the',
    ' * theme\'s near-white hero, measured 1.12-1.61:1 on the fencing and HVAC',
    ' * mirrors (Class B, 2026-09-04). It carries no !important, so wherever a',
    ' * hero ink pass IS active (lib/hero-wash.js heroTextCss,',
    ' * heroContrastFloorCss), that pass\'s proven pair still wins. */',
    ':root:not([data-wss-theme="dark"]):not(.dark) :is(.hero, .hero-section, [data-hero]) :is(h1, h2, h3, h4, h5, h6, p, a, span, li, small, strong, em, figcaption, blockquote, label) {',
    '  color: var(--wss-text, #242933);',
    '}'
  ].join('\n');
}

/**
 * THE ACCESSIBILITY FLOOR (2026-09-02 a11y layer). Conditionally graceful by
 * construction: every rule only ADDS a baseline the donor's own CSS can
 * out-rank (specificity/order), never repaints the design.
 *
 *   :focus-visible — a keyboard-only focus ring. Pointer clicks on browsers
 *     that implement :focus-visible correctly never see it; a keyboard Tab
 *     always does. currentColor keeps the ring legible on ANY canvas, light
 *     or dark, without knowing the theme.
 *   .wss-skip-link — the skip-to-content target (markup injected by
 *     ensureSkipLink below) stays off-canvas until focused.
 *   prefers-reduced-motion — vestibular safety: visitors who asked the OS
 *     for less motion get near-instant transitions and no looping
 *     animations. Mirrors the wssHeroIn stand-down that already ships.
 */
function a11yFloorCss() {
  return [
    '/* --- wss a11y floor: keyboard focus ring, skip link, reduced motion. */',
    ':focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }',
    '.wss-skip-link {',
    '  position: absolute; left: -9999px; top: 0; z-index: 10000;',
    '  background: #ffffff; color: #111827; padding: 0.6rem 1rem;',
    '  border-radius: 0 0 0.375rem 0; font-size: 0.875rem; text-decoration: underline;',
    '}',
    '.wss-skip-link:focus, .wss-skip-link:focus-visible { left: 0; top: 0; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  *, *::before, *::after {',
    '    animation-duration: 0.01ms !important;',
    '    animation-iteration-count: 1 !important;',
    '    transition-duration: 0.01ms !important;',
    '    scroll-behavior: auto !important;',
    '  }',
    '}'
  ].join('\n');
}

function fleetPolishCss() {
  return [
    '/* Shared geometry and readability floor for every mirrored donor. */',
    ':root { --header-h: 72px; }',
    '[id] { scroll-margin-top: calc(var(--header-h) + 16px); }',
    '/* AUDIT 563 #1 — header right-cluster collision. On the donors where the',
    '   phone CTA and the theme toggle share the header\'s right cluster they',
    '   collide. The cluster gets flex + gap, the toggle is ordered last, the',
    '   phone number never wraps, and below 1024px the inline nav steps aside',
    '   for the donor\'s own burger menu. Generic donor selectors only: a site',
    '   whose header matches none of these patterns ships byte-identical. */',
    'header :is(.header-actions, .header__actions, .nav-actions, .nav__actions, .right-cluster) {',
    '  display: flex; align-items: center; gap: 0.75rem;',
    '}',
    'header :is(a[href^="tel:"], .phone, .phone-cta) { white-space: nowrap; }',
    'header :is([data-wss-theme-toggle], [data-theme-toggle], .theme-toggle) { order: 99; flex: none; }',
    '/* AUDIT E4 (2026-09-04, Class E) — the brand-name law: the name renders',
    '   WHOLE, or degrades to a clean ellipsis — never a mid-word hard clip.',
    '   Donors clip .brand-name with overflow:hidden and no ellipsis, or crush',
    '   it to a couple of letters when the header row overflows; both read as',
    '   a broken brand. min-width:0 lets the flex item shrink below its content',
    '   box, and the ellipsis pair guarantees whatever clip survives is a clean',
    '   one. The identity-anchor min-width exemption in tapFloorCss below keeps',
    '   the 44px floor from re-crushing the anchor this rule lives in. */',
    ':is(.brand-name, [class*="brand-name" i]) {',
    '  min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
    '}',
    '/* THE WORDMARK TREATMENT (AUDIT E3). The deterministic brand mark is the',
    '   business NAME set typographically — never a generic drawn triangle.',
    '   brandWordmarkFloor() swaps guaranteed-404 client-logo references for a',
    '   .wss-wordmark span; this rule gives that span the masthead treatment',
    '   the logo slot had: display-size, single line, clean ellipsis. */',
    '.wss-wordmark {',
    '  display: inline-flex; align-items: center; min-width: 0; max-width: 100%;',
    '  font-weight: 800; font-size: 1.0625rem; line-height: 1.15; letter-spacing: -0.01em;',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '}',
    ':is(main, header, section) h1 { font-size: clamp(2.25rem, 6vw, 5.5rem); line-height: 1.02; overflow-wrap: break-word; max-width: 20ch; }',
    ':is(.wss-signup-floater, [data-wss-floater], .signup-floater) { z-index: 40; max-width: min(240px, 60vw); }',
    ':is(.hero, .hero-section, [data-hero]) { position: relative; isolation: isolate; }',
    // THE GENERIC HERO VEIL IS DARK-MODE ONLY now. In light mode the theme
    // pass owns the hero surfaces — every slab band and glass card is
    // repointed to a pale tint of the client's colour, and the hero ink is
    // the palette's proven dark --wss-text. A black gradient over that pair
    // produced the light-theme "wash" twice over: it greyed the pale hero
    // (the "overlaid so heavy they look faded" defect) while the old white
    // hero-ink guard sat on top of it at 1.1-1.6:1 (Class B, 2026-09-04).
    // Dark mode keeps the veil: the dark floor's ink is proven against a
    // darkened canvas and the cinematic donors expect it.
    '[data-wss-theme="dark"] :is(.hero, .hero-section, [data-hero])::before,',
    ':root.dark :is(.hero, .hero-section, [data-hero])::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.6)); }',
    // THE RAISE NOW CLEARS THE DONOR'S OWN DECORATIVE LAYERS. z-index: 1
    // above out-ranked the clean donors' LAYERED content wrappers
    // (fencing-sterling raises .hero-inner to calc(var(--z-scrim) + 1) = 21)
    // while its own .hero-scrim kept z-index 20 via the revert-layer
    // exception below — so the donor's translucent pale scrim painted ON TOP
    // of the words and washed every hero element to 1.1-1.5:1 even when the
    // computed ink pair was correct (the exact Class B render). 30 clears
    // every known donor scrim/stack (<= 21) and stays under the sticky
    // header (60), floaters (70) and drawers (80).
    ':is(.hero, .hero-section, [data-hero]) > * { position: relative; z-index: 30; }',
    // AUDIT A2 (S1): the raise-above-the-veil reset above is unlayered, and
    // the clean donors author their stylesheets in @layer — any unlayered
    // rule outranks every layered one — so it also demoted the donors' own
    // LAYERED `.hero-media { position:absolute; inset:0 }` and
    // `.hero-scrim { position:absolute }` to in-flow relative boxes. The
    // hero video then left the background layer, entered the flow at the
    // 16:9 aspect this block pins, and pushed the entire hero copy column a
    // full viewport below the fold (A2: H1 at y=1071, hero section
    // innerText ""). Background layers keep the positioning their own sheet
    // gives them; only content children are raised above the veil.
    ':is(.hero, .hero-section, [data-hero]) > :is(.hero-media, .hero-scrim, [class*="hero-media" i], [class*="hero-scrim" i], [data-hero-media], video[data-hero-video]) { position: revert-layer; z-index: revert-layer; }',
    // THE PRIMARY-CTA INK follows the theme's proven pair when a palette
    // shipped (the hard-coded #111827 measured 1.36:1 on a dark brand
    // accent — near-black on dark red). --wss-accent-ink is the ink
    // buildPalette computed to pass ON the accent fill; unthemed builds
    // keep the old navy as the fallback. Specificity is unchanged, so the
    // CTA variant treatments (slab-block et al., higher-specificity
    // !important) still win where they ship.
    ':is(.btn-primary, [data-cta="primary"]) { color: var(--wss-accent-ink, #111827) !important; }',
    '/* AUDIT 563 #8 — hero blur/blank flash. Command-template donors gate the',
    '   headline behind JS (opacity:0 — often with a blur/transform — until a',
    '   hydration class lands), so a slow bundle shows a blank hero. The words',
    '   are forced visible with or without JavaScript. wssHeroIn is an OPT-IN',
    '   0.5s fade ([data-wss-hero-in]) that starts from a VISIBLE-SAFE state —',
    '   opacity 0.4, never 0 — so it can only polish an already-readable hero,',
    '   and it stands down entirely for reduced-motion visitors. */',
    ':is(.hero, .hero-section, [data-hero]) :is(h1, [data-animate]) { opacity: 1 !important; filter: none !important; transform: none !important; }',
    '[data-animate] h1 { opacity: 1 !important; filter: none !important; transform: none !important; }',
    'html.no-js :is(.hero, .hero-section, [data-hero]) :is(h1, [data-animate]) { opacity: 1 !important; filter: none !important; transform: none !important; }',
    '@keyframes wssHeroIn { from { opacity: 0.4; transform: translateY(8px); } to { opacity: 1; transform: none; } }',
    '[data-wss-hero-in] :is(h1, [data-animate]) { animation: wssHeroIn 0.5s ease-out both; }',
    '@media (prefers-reduced-motion: reduce) { [data-wss-hero-in] :is(h1, [data-animate]) { animation: none; } }',
    '/* AUDIT 563 #5 — testimonial card overflow. Donor testimonial grids/rows',
    '   clip their cards on narrow viewports. A testimonial-named container',
    '   becomes a snap track and its DIRECT cards become snap slides sized to',
    '   the viewport. The engine\'s own .wss-rv__track is already a snap track',
    '   with its own card basis (min(360px, 86%)) and is explicitly excluded,',
    '   so the treatment is never double-applied over it. */',
    ':is(section, div, ul, ol):is([class*="testimonial"], [id*="testimonial"], [data-testimonials], [aria-label*="testimonial" i]):not(.wss-rv__track) {',
    '  display: flex; align-items: stretch; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: thin;',
    '}',
    ':is(section, div, ul, ol):is([class*="testimonial"], [id*="testimonial"], [data-testimonials], [aria-label*="testimonial" i]):not(.wss-rv__track) > :is(figure, blockquote, article, li, [class*="testimonial"]) {',
    '  flex: 0 0 min(340px, 85%); scroll-snap-align: start;',
    '}',
    ':is(.masthead, header) :is(.coordinates, .coordinate, .decor-text, [data-decor]) { display: none; }',
    '/* AUDIT (Comet, 2026-09-02) — sibling service-card font drift. The fence-',
    '   family donors (True Fence, North MS Fence) compiled card titles at',
    '   three different utility sizes inside ONE grid (text-sm, text-lg and',
    '   text-2xl siblings), and per-instance inline styles drift the same way.',
    '   The polish layer owns the shared scale: two named classes the engine',
    '   and injected sections can use directly, plus a normalization rule that',
    '   collapses every card-shaped child of a MULTI-COLUMN grid onto that',
    '   scale — important, so it also beats inline font-size overrides, which',
    '   is the one thing utility classes cannot do. Single-column layouts',
    '   cannot show sibling drift and are left alone. */',
    ':root { --wss-card-title-size: 1.125rem; --wss-card-body-size: 1rem; }',
    '.wss-card-title { font-size: var(--wss-card-title-size); line-height: 1.35; font-weight: 600; }',
    '.wss-card-body { font-size: var(--wss-card-body-size); line-height: 1.6; }',
    ':is([class*="grid-cols-"], .cards, .card-grid) > :is(article, figure, li, [class*="card" i], [class*="rounded"]) :is(h3, h4) {',
    '  font-size: var(--wss-card-title-size) !important; line-height: 1.35 !important;',
    '}',
    ':is([class*="grid-cols-"], .cards, .card-grid) > :is(article, figure, li, [class*="card" i], [class*="rounded"]) p {',
    '  font-size: var(--wss-card-body-size) !important; line-height: 1.6 !important;',
    '}',
    '/* AUDIT (Comet, 2026-09-02) — hero background media overflowing its box',
    '   (Rooter Right, United Contractors). The engine\'s universal hero-media',
    '   marker is the runtime-armed video[data-hero-video]; the donor figure',
    '   shapes name themselves hero-media. Containment: the container clips,',
    '   the media fills and covers, and the box gets an aspect-ratio to fall',
    '   back on whenever its height is auto — so an unarmed or intrinsic-sized',
    '   medium can never push the layout or bleed over the next section. */',
    ':is(.hero, .hero-section, [data-hero], .hero-media, [class*="hero-media" i], [data-hero-media]) {',
    '  overflow: hidden;',
    '}',
    'video[data-hero-video],',
    ':is(.hero, .hero-section, [data-hero], .hero-media, [class*="hero-media" i], [data-hero-media]) :is(img, video) {',
    '  width: 100%; height: 100%; max-width: 100%; object-fit: cover; object-position: center;',
    '}',
    ':is(.hero-media, [class*="hero-media" i], [data-hero-media], :is(.hero, .hero-section, [data-hero]) > figure) {',
    '  aspect-ratio: 16 / 9;',
    '}',
    '/* AUDIT (Comet, 2026-09-02) — construction-vertical left-skew at 1440px',
    '   (Southwest Builders, Good Life share the construction template): the',
    '   hero/section content column hard-lefts against dead whitespace. The',
    '   fleet flagship composes text-left with a data panel right; until a',
    '   mirror has a right-hand panel to balance it, the column centers within',
    '   a capped measure instead. Scoped to the content wrappers INSIDE a',
    '   full-bleed band, so section backgrounds stay edge-to-edge and donors',
    '   already on a centered max-width container (80rem) are byte-neutral. */',
    '@media (min-width: 1024px) {',
    '  :is(main, [role="main"], body) > :is(section, div, article) > :is(section, div, article) {',
    '    max-width: 80rem;',
    '    margin-inline: auto;',
    '  }',
    '}',
    '@media (max-width: 1023px) { header :is(nav, .nav, .navigation) { display: none; } }',
    '@media (max-width: 768px) {',
    '  :is(.wss-signup-floater, [data-wss-floater], .signup-floater) { left: 1rem; right: auto; bottom: 5rem; }',
    '  :is(.btn-primary, [data-cta="primary"], .cta, .cta-button) { width: 100%; justify-content: center; }',
    '  :is(.grid, .cards, .card-grid) { grid-template-columns: 1fr; }',
    '  section { padding-block: clamp(2.5rem, 10vw, 4rem); }',
    '  /* AUDIT E2 (2026-09-04, Class E) — the mobile header row never overflows',
    '     the viewport. Measured on every family at 390px: brand anchor (min',
    '     220px) + burger (44px) + call CTA (147-200px) in a ~310px container',
    '     with flex-wrap:nowrap put the call CTA 80-134px off the right edge.',
    '     The row wraps so the CTA drops to its own line whole, and the CTA',
    '     itself can never exceed the row (max-width:100% + min-width:0, so',
    '     the ellipsis-capable control shrinks instead of clipping). Scroll-safe',
    '     too: nothing overflows, so no horizontal scroll container is created. */',
    '  header :is(.shell, .header-inner, .header-wrap, .header-row, .header-container,',
    '    .nav-inner, .nav-wrap, .nav-container, .container, .wrapper, .wrap) {',
    '    flex-wrap: wrap; row-gap: 0.5rem;',
    '  }',
    '  header :is(a[href^="tel:"], .header-cta, [class*="header-cta" i], .phone-cta, .call-cta) {',
    '    min-width: 0; max-width: 100%;',
    '  }',
    '  /* AUDIT (Comet, 2026-09-02) — mobile card-stack spacing. One scale for',
    '     every vertical at the 390px audit width: the stacked card grids all',
    '     breathe at the same two tokens instead of each donor\'s compiled',
    '     gap (0.25rem … 4rem). Declared on :root inside the query so the',
    '     tokens are the single place a spacing change is made. */',
    '  :root { --wss-stack-gap: 1rem; --wss-card-pad: 1.25rem; }',
    '  :is([class*="grid-cols-"], .cards, .card-grid) { gap: var(--wss-stack-gap) !important; }',
    '  :is([class*="grid-cols-"], .cards, .card-grid) > :is(article, figure, li, [class*="card" i], [class*="rounded"]) { padding: var(--wss-card-pad); }',
    '}'
  ].join('\n');
}

function polishStyleBlock() {
  return [
    '<style id="wss-fleet-polish">',
    tapFloorCss(),
    contrastFloorCss(),
    a11yFloorCss(),
    fleetPolishCss(),
    '</style>'
  ].join('\n');
}

/**
 * THE LOGO PLATE LAW (owner verdict, 2026-09-01, first factory mirrors).
 *
 * "Plumbing sites (dark-mode donor start) — the client logo/top area looks
 * jacked up." The dark canvas fights the client's logo: most small-business
 * marks are light-background PNGs with no transparency guarantee, and the
 * donors render them bare (`img.wss-logo` on plumbing; a round object-cover
 * slot on fencing). On a dark slab a white-box PNG reads as a torn sticker.
 *
 * The plate: when the build's default canvas is DARK and the client's logo is
 * a RASTER (svg marks carry currentColor and their own transparency and never
 * need it), the logo image gets a subtle light pill — rounded, small padding,
 * hairline border — appended to the shipped stylesheet by the engine. The
 * rules are scoped to the EXPLICIT dark state (`[data-wss-theme="dark"]` and
 * the `:root.dark` class twin), so:
 *
 *   - a light-default donor never paints a plate (its rules never match);
 *   - a visitor who toggles a dark-default site to light loses the plate the
 *     moment light mode takes over — the plate exists exactly while the dark
 *     canvas does.
 *
 * object-fit:contain plus width/height:auto keep a wordmark whole inside the
 * pill; the fencing donor's round object-cover slot is overridden for rasters
 * because a plate around a center-cropped logo is a frame around a salad.
 */
function logoPlateCss({ includeHeader = false } = {}) {
  const selectors = [
    '[data-wss-theme="dark"] img[src*="client-logo"]',
    ':root.dark img[src*="client-logo"]'
  ];
  if (includeHeader) selectors.push('header img[src*="client-logo"]');
  return [
    '/* --- wss logo plate: a raster client mark on a dark canvas gets a light',
    '   pill so ANY logo reads clean on dark. Scoped to the explicit dark',
    '   state, so light-theme donors and light toggles are untouched. */',
    `${selectors.join(',\n')} {`,
    '  background: #f6f4ef !important;',
    '  padding: 0.3rem 0.6rem !important;',
    '  border: 1px solid rgba(255, 255, 255, 0.28) !important;',
    '  border-radius: 0.55rem !important;',
    '  box-sizing: border-box !important;',
    '  object-fit: contain !important;',
    '  width: auto !important;',
    '  height: auto !important;',
    '  max-width: min(13rem, 45vw) !important;',
    '  max-height: 3.25rem !important;',
    '}'
  ].join('\n');
}

function lightLogoFallbackCss({ includeHeader = false } = {}) {
  const selectors = [
    '[data-wss-theme="dark"] img[src*="client-logo.svg"]',
    ':root.dark img[src*="client-logo.svg"]'
  ];
  if (includeHeader) selectors.push('header img[src*="client-logo.svg"]');
  return [
    '/* --- wss light-logo fallback: vector marks get a light variant on dark',
    '   headers when no raster plate is painted. */',
    `${selectors.join(',\n')} {`,
    '  filter: brightness(0) invert(1) !important;',
    '}'
  ].join('\n');
}

/**
 * THE HERO CONTRAST FLOOR (owner verdict, 2026-09-01, first factory mirrors).
 *
 * "Fencing site starts LIGHT but looks better dark; hero text is washed out
 * (opacity too low)." Two measured facts behind that sentence:
 *
 *   1. The fencing hero's own scrim is a vertical `from-background/90
 *      via-background/40 to-background` — the CENTRE band, exactly where the
 *      headline sits, carries only 40% canvas over a bright golden-hour
 *      photograph, and the sub-line is a muted ink on top of that.
 *   2. The hero ink pass (lib/hero-wash.js heroTextCss) only ships for donors
 *      with a `hero_wash` manifest entry; fencing-sterling and plumbing-clean
 *      own their heroes and had NO floor of any kind.
 *
 * This block is the floor for photographic heroes the engine does not wash.
 * Donors opt in per manifest with `hero_floor: { selector }` — plumbing-clean
 * deliberately does not (its six-layer cinematic stack owns the pixels and the
 * owner approved the look); fencing-sterling does. The scrim alpha is not a
 * taste call: the engine computes it with hero-wash's `scrimAlphaFor` for the
 * DIMMEST ink that will sit on the veil, so the worst possible photograph
 * (pure white, pure black) still leaves that ink at >= 4.5:1. The veil is
 * banded — full proven alpha through the text band (25%-75%), 55% of it above
 * and below — so the photograph still reads where no words sit.
 *
 * Inks: the sub-line is forced to a solid proven ink with opacity 1 in both
 * modes (dimmed/tinted utility text is the "washed out" the owner measured);
 * the headline keeps its own colour but never its transparency (opacity 1);
 * and in LIGHT mode a gradient-filled headline (`.text-gradient`:
 * background-clip:text with a transparent fill) is darkened with a filter —
 * the donor's gold gradient was designed for dark and is illegible on a light
 * veil, and a filter darkens the painted gradient without repainting it.
 */
function heroContrastFloorCss({
  selector = '',
  darkScrim = 'rgba(11, 18, 32, 0.85)',
  lightScrim = 'rgba(247, 244, 238, 0.85)',
  darkSubInk = '#e8edf2'
} = {}) {
  if (typeof selector !== 'string' || !selector.trim()) return '';
  const sel = selector.trim();

  const band = (rgba, edgeAlphaScale) => {
    // Same colour, two alphas: full through the text band, scaled above/below.
    const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(String(rgba).trim());
    if (!m) return rgba;
    const [, r, g, b, a] = m;
    const edge = Math.max(0, Math.min(1, Number(a) * edgeAlphaScale)).toFixed(4);
    return [
      `linear-gradient(to bottom,`,
      ` rgba(${r}, ${g}, ${b}, ${edge}) 0%,`,
      ` rgba(${r}, ${g}, ${b}, ${m[4]}) 25%,`,
      ` rgba(${r}, ${g}, ${b}, ${m[4]}) 75%,`,
      ` rgba(${r}, ${g}, ${b}, ${edge}) 100%)`
    ].join('');
  };

  return [
    '/* --- wss hero contrast floor: photographic hero, proven ink. The veil',
    '   alpha was computed for the dimmest hero ink against the worst possible',
    '   photograph (see lib/hero-wash.js scrimAlphaFor); the headline keeps its',
    '   own colour but never its transparency, and the sub-line is solid. */',
    `[data-wss-theme="dark"] :is(${sel})::after,`,
    `:root.dark :is(${sel})::after {`,
    '  content: "";',
    '  position: absolute;',
    '  inset: 0;',
    '  z-index: 5;',
    '  pointer-events: none;',
    `  background: ${band(darkScrim, 0.55)};`,
    '}',
    `[data-wss-theme="dark"] :is(${sel}) h1,`,
    `:root.dark :is(${sel}) h1 {`,
    '  opacity: 1 !important;',
    '}',
    `[data-wss-theme="dark"] :is(${sel}) h1 + p,`,
    `:root.dark :is(${sel}) h1 + p {`,
    `  color: ${darkSubInk} !important;`,
    `  -webkit-text-fill-color: ${darkSubInk} !important;`,
    '  opacity: 1 !important;',
    '}',
    `:root:not([data-wss-theme="dark"]):not(.dark) :is(${sel})::after,`,
    `[data-wss-theme="light"] :is(${sel})::after {`,
    '  content: "";',
    '  position: absolute;',
    '  inset: 0;',
    '  z-index: 5;',
    '  pointer-events: none;',
    `  background: ${band(lightScrim, 0.55)};`,
    '}',
    `:root:not([data-wss-theme="dark"]):not(.dark) :is(${sel}) h1 + p,`,
    `[data-wss-theme="light"] :is(${sel}) h1 + p {`,
    '  color: var(--wss-text) !important;',
    '  -webkit-text-fill-color: var(--wss-text) !important;',
    '  opacity: 1 !important;',
    '}',
    '/* A gradient-filled headline was designed for the dark canvas; on a light',
    '   veil its gold is illegible. Darken the painted gradient, never repaint',
    '   it — the accent stays the donor\'s design, the legibility becomes ours. */',
    `:root:not([data-wss-theme="dark"]):not(.dark) :is(${sel}) .text-gradient,`,
    `[data-wss-theme="light"] :is(${sel}) .text-gradient {`,
    '  filter: brightness(0.62) saturate(1.12);',
    '}',
    '/* Hero band layers stack under the words: the donor\'s content wrappers',
    '   carry z-10+, the veil sits at z-5, above the photograph and below every',
    '   word. No donor rule is edited; delete this block to revert. */'
  ].join('\n');
}

function hasPolishStyle(html) {
  if (typeof html !== 'string') return false;

  /*
   * Require an actual tag-shaped id attribute instead of a loose substring,
   * avoiding false positives in normal text.
   */
  return /<style\b[^>]*\bid\s*=\s*(["'])wss-fleet-polish\1[^>]*>/i.test(html);
}

function injectPolishStyle(html) {
  if (typeof html !== 'string') {
    return {
      html,
      applied: false,
      warning: 'main html must be a string'
    };
  }

  if (hasPolishStyle(html)) {
    return {
      html,
      applied: false,
      warning: null
    };
  }

  const closeHead = /<\/head\s*>/i.exec(html);

  if (!closeHead) {
    return {
      html,
      applied: false,
      warning: 'cannot inject fleet polish CSS: main html has no </head>'
    };
  }

  const block = polishStyleBlock();
  const before = html.slice(0, closeHead.index);
  const after = html.slice(closeHead.index);

  const separator =
    before.length > 0 && !/\n$/.test(before)
      ? '\n'
      : '';

  return {
    html: before + separator + block + '\n' + after,
    applied: true,
    warning: null
  };
}

/**
 * THE ONE-H1 FLOOR (2026-09-02 fleet audit, defect 5). The HVAC/United-
 * Contractors class of Vite-family donors renders their hero inside a client
 * bundle, so the SERVED index.html carries the hero headline in no heading
 * element at all — zero <h1>, only the h2s the injected content sections
 * brought. Crawlers and screen readers met a homepage with no top-level
 * heading. When a document ships no h1, the first <h2> is promoted to <h1>
 * (attributes preserved, so donor CSS keeps styling it). Idempotent: a second
 * pass sees the h1 and changes nothing. Documents that already carry an h1 —
 * donor-authored or SSR-hero — are left byte-identical.
 */
function ensureSingleH1(html) {
  if (typeof html !== 'string') {
    return { html, applied: false, warning: 'html must be a string' };
  }
  if (/<h1[\s>]/i.test(html)) {
    return { html, applied: false, warning: null };
  }
  const first = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/i.exec(html);
  if (!first) {
    return { html, applied: false, warning: 'no h1 and no h2 to promote' };
  }
  const promoted =
    html.slice(0, first.index)
    + '<h1' + first[1] + '>' + first[2] + '</h1>'
    + html.slice(first.index + first[0].length);
  return { html: promoted, applied: true, warning: null };
}

/* ------------------------------------------------------------------------- *
 * THE A11Y MARKUP FLOOR (2026-09-02 accessibility layer)
 *
 * Post-build passes over the FINAL emitted HTML — donors, injected content
 * islands and every other component are already in the bytes when these run,
 * so no per-component edit can be forgotten. Each pass is IDEMPOTENT (a
 * second run changes nothing), only ever ADDS the missing attribute/node,
 * and fails soft: a page without the anchor the pass needs ships unchanged
 * with a warning, never a broken build.
 * ------------------------------------------------------------------------- */

/**
 * THE PAGE'S LANGUAGE. WCAG 3.1.1: a screen reader cannot pick a voice
 * without it. Adds lang="en" only when the <html> tag carries no usable
 * lang; a donor that declares its own language is authoritative and is left
 * exactly as shipped. No <html> tag at all -> skipped with a warning.
 */
function ensureLangAttribute(html) {
  if (typeof html !== 'string') {
    return { html, applied: false, warning: 'html must be a string' };
  }
  const openTag = /<html\b([^>]*)>/i.exec(html);
  if (!openTag) {
    return { html, applied: false, warning: 'no <html> tag to carry lang' };
  }
  const lang = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(openTag[1]);
  if (lang && (lang[1] || lang[2] || lang[3] || '').trim()) {
    return { html, applied: false, warning: null };
  }
  const fixed = html.slice(0, openTag.index)
    + '<html lang="en"'
    + openTag[1] + '>'
    + html.slice(openTag.index + openTag[0].length);
  return { html: fixed, applied: true, warning: null };
}

/**
 * THE SKIP LINK. A keyboard user on a 60-link donor masthead tabled through
 * every one of them before reaching the page — one link, first in the body,
 * jumps straight to the content. Injected only when a real target exists:
 * the first <main> element (an existing id on it is kept and used; one is
 * added when absent). No <main> means NO skip link rather than a link to a
 * nonexistent anchor — a skip link that 404s the tab order is worse than
 * none. Already present -> idempotent skip.
 */
function ensureSkipLink(html) {
  if (typeof html !== 'string') {
    return { html, applied: false, warning: 'html must be a string' };
  }
  if (/class\s*=\s*["'][^"']*wss-skip-link/i.test(html)) {
    return { html, applied: false, warning: null };
  }
  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  if (!bodyOpen) {
    return { html, applied: false, warning: 'no <body> tag to anchor skip link' };
  }
  const mainOpen = /<main\b([^>]*)>/i.exec(html);
  if (!mainOpen) {
    return { html, applied: false, warning: null };
  }
  const mainAttrs = mainOpen[1];
  const existingId = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(mainAttrs);
  let targetId;
  let nextHtml = html;
  if (existingId && (existingId[1] || existingId[2]).trim()) {
    targetId = existingId[1] || existingId[2];
  } else {
    targetId = 'wss-main';
    nextHtml = html.slice(0, mainOpen.index)
      + `<main id="wss-main"${mainAttrs}>`
      + html.slice(mainOpen.index + mainOpen[0].length);
  }
  const skipLink = `<a class="wss-skip-link" href="#${targetId}">Skip to main content</a>`;
  const withLink = nextHtml.slice(0, bodyOpen.index)
    + bodyOpen[0] + '\n' + skipLink
    + nextHtml.slice(bodyOpen.index + bodyOpen[0].length);
  return { html: withLink, applied: true, warning: null };
}

/**
 * Derive the business name for alt composition from the page itself, so the
 * polish pass needs no caller context (and accepts options.site first). The
 * title/head names are the identity the page already publishes; the first
 * <h1> is the honest fallback. Returns '' when nothing readable exists —
 * and then the alt floor flags rather than invents.
 */
function deriveBusinessName(html, siteContext) {
  const fromSite = siteContext && String(siteContext.businessName || '').trim();
  if (fromSite) return fromSite;
  if (typeof html !== 'string') return '';
  const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i.exec(html);
  if (og && og[1].trim()) return og[1].trim();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) {
    const decoded = title[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .trim();
    const head = decoded.split('|')[0].split('—')[0].split('–')[0].trim();
    if (head) return head;
  }
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) {
    const text = h1[1].replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

/**
 * THE ALT FLOOR. Every <img> that EMITS without an alt attribute ships that
 * way only because the donor template never had one — so the pass decides
 * per image: decorative markers (badge/icon/spacer/divider class or src) get
 * alt="" (the CORRECT answer for decoration); every other image gets the
 * composed sentence (business name + image context — filename words serve as
 * the service hint, src/class tokens as the subject hint) via the SAME
 * composeAlt the facts boundary uses. Images that already carry alt —
 * INCLUDING alt="" the donor authored — are never touched.
 */
function imageAltFloor(html, siteContext) {
  if (typeof html !== 'string') {
    return { html, added: 0, decorative: 0, warning: 'html must be a string' };
  }
  const businessName = deriveBusinessName(html, siteContext);
  let added = 0;
  let decorativeCount = 0;
  const out = html.replace(/<img\b([^>]*)>/gi, (tag, attrs) => {
    if (/\balt\s*=/i.test(attrs)) return tag;
    const cls = (/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || []);
    const clsValue = cls[1] || cls[2] || '';
    const src = (/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || []);
    const srcValue = src[1] || src[2] || '';
    const hint = `${clsValue} ${srcValue}`;
    let alt = '';
    if (/wss-p__badge|wss-p__logo|badge|icon|spacer|divider|decor/i.test(hint)) {
      // badge-shaped: the adjacent text already names it (the pride strip
      // renders its label as TEXT beside the mark).
      decorativeCount += 1;
    } else {
      alt = composeAlt({
        businessName,
        industry: siteContext && siteContext.industry,
        city: siteContext && siteContext.city,
        state: siteContext && siteContext.state,
        service: serviceHintFromSrc(srcValue),
        subject: hint,
      });
    }
    added += 1;
    return `<img alt="${escapeHtmlAttribute(alt)}"${attrs}>`;
  });
  return { html: out, added, decorative: decorativeCount, warning: businessName ? null : 'no business name found for alt composition' };
}

/**
 * THE EMPTY-LINK NAME FLOOR. An <a> with no accessible name (no text, no
 * aria-label, no titled image inside) is a walled-off destination for a
 * screen-reader user. The mechanical, truthful repair is the link's OWN
 * destination: tel: numbers, mailto: addresses and http(s) hosts name
 * themselves from the href — words the page already ships, never invented
 * copy. Links that already have a name are never touched.
 */
function linkNameFloor(html) {
  if (typeof html !== 'string') {
    return { html, added: 0, warning: 'html must be a string' };
  }
  let added = 0;
  const out = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (tag, attrs, inner) => {
    if (/\b(?:aria-label|aria-labelledby)\s*=/i.test(attrs)) return tag;
    if (/\btitle\s*=\s*(?:"[^"]*"|'[^']*')/i.test(attrs)) return tag;
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (text) return tag;
    // An image inside the link may name it — only when that image itself
    // carries a non-empty alt.
    for (const img of inner.matchAll(/<img\b([^>]*)>/gi)) {
      const alt = (/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(img[1]) || []);
      if ((alt[1] || alt[2] || '').trim()) return tag;
    }
    const href = (/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || []);
    const hrefValue = href[1] || href[2] || '';
    if (!hrefValue || hrefValue.startsWith('#')) return tag;
    let name = '';
    const tel = /^tel:(.+)$/i.exec(hrefValue);
    const mail = /^mailto:(.+)$/i.exec(hrefValue);
    const web = /^https?:\/\/([^/\s?#]+)/i.exec(hrefValue);
    if (tel) name = `Call ${tel[1].trim()}`;
    else if (mail) name = `Email ${mail[1].trim()}`;
    else if (web) name = web[1].replace(/^www\./i, '');
    if (!name) return tag;
    added += 1;
    return `<a aria-label="${escapeHtmlAttribute(name)}"${attrs}>${inner}</a>`;
  });
  return { html: out, added, warning: null };
}

/**
 * THE FORM-CONTROL LABEL FLOOR. A quote request input a screen reader reads
 * as "edit text" is a lead lost. Adds aria-label ONLY to controls with no
 * label a reader could already use: no <label for>, no aria-label(lledby),
 * no title, not wrapped in a <label> (checked within the tag's immediate
 * preceding context), and never hidden/submit-class controls. The label is
 * derived from the control's own name attribute, then its type — words the
 * page itself declares, never invented copy.
 */
function formLabelFloor(html) {
  if (typeof html !== 'string') {
    return { html, added: 0, warning: 'html must be a string' };
  }
  const labelFors = new Set();
  for (const m of html.matchAll(/<label\b[^>]*\bfor\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const v = m[1] || m[2];
    if (v) labelFors.add(v);
  }
  const TYPE_LABELS = {
    email: 'Email address', tel: 'Phone number', search: 'Search',
    url: 'Website', zip: 'ZIP code', number: 'Number', name: 'Your name',
    date: 'Date', time: 'Time', password: 'Password',
  };
  const UNLABELED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'radio', 'checkbox']);
  let added = 0;
  const out = html.replace(/<(input|select|textarea)\b([^>]*)>/gi, (tag, control, attrs) => {
    const type = (/\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || [])[1] || (control.toLowerCase() === 'input' ? 'text' : '');
    const typeNorm = String(type).toLowerCase();
    if (control.toLowerCase() === 'input' && UNLABELED_TYPES.has(typeNorm)) return tag;
    if (/\b(?:aria-label|aria-labelledby)\s*=/i.test(attrs)) return tag;
    if (/\btitle\s*=\s*(?:"[^"]*"|'[^']*')/i.test(attrs)) return tag;
    const id = (/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || []);
    if (id && (id[1] || id[2]) && labelFors.has(id[1] || id[2])) return tag;
    const name = (/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || []);
    const nameValue = name[1] || name[2] || '';
    const derived = humanizeName(nameValue) || TYPE_LABELS[typeNorm] || humanizeName(typeNorm);
    if (!derived) return tag;
    added += 1;
    return `<${control} aria-label="${escapeHtmlAttribute(derived)}"${attrs}>`;
  });
  return { html: out, added, warning: null };
}

/**
 * THE BRAND THEME-COLOR LAW (2026-09-02 mobile brand cascade).
 *
 * `<meta name="theme-color">` paints the MOBILE BROWSER CHROME — the URL bar
 * and task-switcher tint on Android/Chrome and Safari. Donors ship their OWN
 * brand colour in that meta (fencing gold-adjacent `#e0a63c` family,
 * concrete `#EB0001`, plumbing-premier `#18467f` navy…), and every other brand
 * surface flows from the client's palette while the browser chrome stays the
 * DONOR's colour on the client's phone. The meta cannot hold `var()` — it is
 * read by the browser before CSS exists — so it must be rewritten as a literal.
 *
 * The theme sheet (theme.themeCss) already appended the final palette to the
 * donor stylesheet as `--wss-surface:<hex>` (and `--wss-accent:<hex>`); this
 * pass reads the FINAL surface back out of the built CSS — no palette needs to
 * be plumbed through — and stamps it into every theme-color meta. Fail-soft:
 * no surface found (donor never themed) leaves every meta untouched.
 */
function brandSurfaceHexFromCss(cssTexts) {
  let hex = null;
  if (!Array.isArray(cssTexts)) return null;
  for (const text of cssTexts) {
    if (typeof text !== 'string') continue;
    // The FIRST declaration is the DEFAULT-mode surface: the theme sheet
    // writes the default scope first and the toggle counterpart second, and
    // the mobile chrome should carry the surface the site OPENS with.
    const m = /--wss-surface:\s*(#[0-9a-fA-F]{3,8})\s*[;}]/.exec(text);
    if (m && !hex) hex = m[1];
  }
  return hex;
}

function applyBrandThemeColorMeta(html, surfaceHex) {
  if (typeof html !== 'string' || typeof surfaceHex !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(surfaceHex)) {
    return { html, changed: 0, warning: 'surface hex required for theme-color rewrite' };
  }
  let changed = 0;
  const isThemeColorMeta = (tag) => /<meta\b[^>]*>/i.test(tag)
    && /\bname\s*=\s*(?:"theme-color"|'theme-color'|theme-color)/i.test(tag);

  // Every <meta ...> whose attribute bag names theme-color, whatever the
  // attribute order; only its content attribute is rewritten.
  const out = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!isThemeColorMeta(tag)) return tag;
    const rewritten = tag.replace(
      /(\bcontent\s*=\s*)(?:"([^"]*)"|'([^']*)')/i,
      (whole, head, dq, sq) => {
        const current = dq !== undefined ? dq : sq;
        if (current && current.toLowerCase() === surfaceHex.toLowerCase()) return whole;
        changed += 1;
        return `${head}"${surfaceHex}"`;
      }
    );
    return rewritten === tag && !/\bcontent\s*=/i.test(tag) ? tag : rewritten;
  });
  return { html: out, changed, warning: null };
}

/**
 * THE BRAND WORDMARK FLOOR (2026-09-04 fleet audit, Class E).
 *
 * Measured on every family: the header logo slot ships
 * `<img src="/assets/client-logo.png" onerror="this.src='assets/client-logo-fallback.svg'">`
 * — and when the build has no real client logo the src is a guaranteed 404
 * whose error handler swaps in a GENERIC DRAWN TRIANGLE. A fake geometric mark
 * where the client's name belongs is worse than no mark: the name rendered
 * typographically IS the honest brand treatment.
 *
 * Two mechanical repairs, both build-time and idempotent:
 *
 *   1. An <img> whose src points at a root-relative client-logo asset the
 *      files map does NOT contain (the guaranteed-404 reference) is replaced
 *      wholesale by a `.wss-wordmark` span carrying the business name — the
 *      alt sentence the image would have shown, promoted to real text.
 *      External http(s) logo URLs (brand_identity's verified hotlinks) are
 *      NOT replaced — only their triangle fallback is disarmed.
 *   2. Every onerror handler that would swap to `client-logo-fallback.svg` /
 *      `mark-fallback.svg` (the generic triangle) is stripped: a failed brand
 *      image degrades to its alt text, never to a fake logo.
 *
 * Fail-soft: a page with no logo slot ships byte-identical.
 */
function brandWordmarkFloor(html, options = {}) {
  if (typeof html !== 'string') {
    return { html, wordmarksSwapped: 0, logoFallbacksStripped: 0, warning: 'html must be a string' };
  }
  const available = new Set(
    (Array.isArray(options.availableAssets) ? options.availableAssets : [])
      .map((key) => String(key).replace(/^\.?\//, '').toLowerCase())
  );
  let wordmarksSwapped = 0;
  let logoFallbacksStripped = 0;

  const triangleFallback = /client-logo-fallback\.svg|mark-fallback\.svg/i;
  const localClientLogo = /^(?:\.?\/)?assets\/client-logo\.(?:png|jpe?g|webp|gif|svg|avif)(?:[?#].*)?$/i;

  const out = html.replace(/<img\b([^>]*)>/gi, (tag, attrs) => {
    const srcAttr = (/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || []);
    const src = srcAttr[1] || srcAttr[2] || '';
    const relSrc = src.replace(/^https?:\/\/[^/?#]+/i, '').replace(/^\.\//, '').replace(/^\//, '').toLowerCase();

    if (localClientLogo.test(relSrc) && !available.has(relSrc.replace(/[?#].*$/, ''))) {
      // The guaranteed-404 client-logo reference: replace the whole tag with
      // the typographic wordmark. Name = the alt sentence (minus the " logo"
      // suffix the donor slots append), else the page's own identity.
      const altAttr = (/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) || []);
      const name = (altAttr[1] || altAttr[2] || '').replace(/\s+logo$/i, '').trim()
        || String((options.businessName || '')).trim();
      wordmarksSwapped += 1;
      return `<span class="wss-wordmark">${escapeHtmlAttribute(name)}</span>`;
    }

    if (triangleFallback.test(attrs)) {
      logoFallbacksStripped += 1;
      return tag.replace(/\s*onerror\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    }

    return tag;
  });

  return { html: out, wordmarksSwapped, logoFallbacksStripped, warning: null };
}

/**
 * Apply post-build fleet polish transformations.
 *
 * @param {*} files
 * @param {*} options
 * @returns {{
 *   files: *,
 *   applied: {deduped:number,tapCss:boolean,contrastCss:boolean,a11yCss:boolean,h1Promoted:number,langFixed:number,skipLinks:number,altsAdded:number,labelsAdded:number},
 *   warnings:string[]
 * }}
 */
function polishSite(files, options = {}) {
  const warnings = [];
  const applied = {
    deduped: 0,
    tapCss: false,
    contrastCss: false,
    a11yCss: false,
    mobileCss: false,
    h1Promoted: 0,
    langFixed: 0,
    skipLinks: 0,
    altsAdded: 0,
    linksNamed: 0,
    labelsAdded: 0,
    themeColorMeta: 0,
    wordmarksSwapped: 0,
    logoFallbacksStripped: 0
  };

  /*
   * Unknown root shape must fail soft and remain unchanged.
   */
  if (
    files === null ||
    typeof files !== 'object' ||
    Array.isArray(files)
  ) {
    warnings.push('files must be a flat object map');
    return {
      files,
      applied,
      warnings
    };
  }

  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    warnings.push('options must be an object');
    options = {};
  }

  let replacementUrls = [];

  if (options.replacementUrls === undefined) {
    replacementUrls = [];
  } else if (Array.isArray(options.replacementUrls)) {
    replacementUrls = options.replacementUrls;
  } else {
    warnings.push('replacementUrls must be an array');
  }

  /*
   * Preserve all own enumerable keys and values. Object.assign avoids
   * mutating the caller's map while maintaining the flat-map contract.
   */
  let output;

  try {
    output = Object.assign({}, files);
  } catch (error) {
    warnings.push(
      `could not copy files map: ${
        error && error.message ? error.message : 'unknown error'
      }`
    );

    return {
      files,
      applied,
      warnings
    };
  }

  let keys;

  try {
    keys = Object.keys(files);
  } catch (error) {
    warnings.push(
      `could not enumerate files: ${
        error && error.message ? error.message : 'unknown error'
      }`
    );

    return {
      files,
      applied,
      warnings
    };
  }

  const htmlKeys = keys.filter(
    (key) => typeof key === 'string' && /\.html$/i.test(key)
  );
  const javascriptKeys = keys.filter(isFirstPartyJavaScriptKey);

  /*
   * Dedupe every HTML file independently. Client replacement URLs are a
   * reusable ordered pool per document, as each page has its own duplicate
   * image set.
   */
  for (const key of htmlKeys) {
    let content;

    try {
      content = files[key];
    } catch (error) {
      warnings.push(`could not read ${key}`);
      continue;
    }

    if (typeof content !== 'string') {
      warnings.push(`${key}: html content must be a string`);
      continue;
    }

    try {
      const result = dedupeGallery(content, { replacementUrls });
      output[key] = result.html;
      applied.deduped += result.replaced.length;

      for (const warning of result.warnings) {
        warnings.push(`${key}: ${warning}`);
      }
    } catch (error) {
      /*
       * Defensive boundary: exported helpers themselves are written not to
       * throw, but polishSite still isolates every file in case of unusual
       * host objects/proxies.
       */
      warnings.push(
        `${key}: dedupe skipped: ${
          error && error.message ? error.message : 'unknown error'
        }`
      );
    }
  }

  /*
   * Vite/React donors keep gallery arrays in their first-party bundles, so
   * their rendered <img> tags never exist in index.html. Process only bundles
   * that pass the narrow first-party path gate; the helper itself additionally
   * requires a gallery-shaped data array before changing a byte.
   */
  for (const key of javascriptKeys) {
    let content;

    try {
      content = files[key];
    } catch (error) {
      warnings.push(`could not read ${key}`);
      continue;
    }

    if (typeof content !== 'string') {
      warnings.push(`${key}: javascript content must be a string`);
      continue;
    }

    try {
      const result = dedupeJavaScriptGallery(content, { replacementUrls });
      output[key] = result.javascript;
      applied.deduped += result.replaced.length;

      for (const warning of result.warnings) {
        warnings.push(`${key}: ${warning}`);
      }
    } catch (error) {
      warnings.push(
        `${key}: javascript dedupe skipped: ${
          error && error.message ? error.message : 'unknown error'
        }`
      );
    }
  }

  /*
   * THE BRAND THEME-COLOR LAW (see applyBrandThemeColorMeta). The mobile
   * browser chrome is a brand surface like any other: the final palette's
   * surface hex (appended by the theme sheet as --wss-surface) replaces the
   * donor's own theme-color meta on every document. Runs BEFORE the polish
   * style injection so the meta is final in the same pass.
   */
  const cssKeys = keys.filter(
    (key) => typeof files[key] === 'string' && /\.css$/i.test(key)
  );
  const brandSurfaceHex = brandSurfaceHexFromCss(
    cssKeys.map((key) => files[key])
  );

  if (brandSurfaceHex) {
    for (const key of htmlKeys) {
      if (typeof output[key] !== 'string') continue;
      try {
        const recolor = applyBrandThemeColorMeta(output[key], brandSurfaceHex);
        if (recolor.changed) {
          output[key] = recolor.html;
          applied.themeColorMeta += recolor.changed;
        }
      } catch (error) {
        warnings.push(
          `${key}: theme-color rewrite skipped: ${
            error && error.message ? error.message : 'unknown error'
          }`
        );
      }
    }
  }

  /*
   * THE POLISH BLOCK SHIPS ON EVERY PAGE (2026-09-02 fleet audit, defect 1).
   * It used to be injected into ONE "main" document (index.html, else the
   * first *.html in insertion order) — so interior pages (/faq, /services,
   * /plumbing, /fence-guides…) served with NO polish block at all and their
   * mobile tap targets, dark-mode text floor and testimonial tracks went
   * unpolished. Every HTML file gets the same idempotent block now; a page
   * that already carries it (or has no </head>) is skipped with a warning,
   * exactly as the single-page pass behaved.
   */
  if (!htmlKeys.length) {
    warnings.push('no html file available for fleet polish CSS injection');
    return {
      files: output,
      applied,
      warnings
    };
  }

  for (const key of htmlKeys) {
    if (typeof output[key] !== 'string') {
      warnings.push(
        `${key}: cannot inject fleet polish CSS into non-string content`
      );
      continue;
    }

    try {
      if (hasPolishStyle(output[key])) {
        /*
         * The desired rules are considered present because this module's
         * canonical style block is identified by this id. This also makes the
         * result's applied state meaningful on an idempotent second pass.
         */
        applied.tapCss = true;
        applied.contrastCss = true;
        applied.a11yCss = true;
        continue;
      }

      const injection = injectPolishStyle(output[key]);

      if (injection.applied) {
        output[key] = injection.html;
        applied.tapCss = true;
        applied.contrastCss = true;
        applied.a11yCss = true;
      } else if (injection.warning) {
        warnings.push(`${key}: ${injection.warning}`);
      }
    } catch (error) {
      warnings.push(
        `${key}: CSS injection skipped: ${
          error && error.message ? error.message : 'unknown error'
        }`
      );
    }
  }

  /*
   * THE MOBILE POLISH BLOCK SHIPS ON EVERY PAGE (2026-09-02, owner: "our
   * mobile view looks like shit and is cut out"). Same per-document law as
   * the fleet block above: idempotent by id (wss-mobile-polish), skipped
   * with a warning when a document has no </head>. Injected AFTER the fleet
   * block so the mobile floor's overrides (the 48px section clamp, the
   * >=24px card titles, the image/CTA floors) win same-specificity ties.
   */
  for (const key of htmlKeys) {
    if (typeof output[key] !== 'string') continue;

    try {
      if (mobilePolish.hasMobileStyle(output[key])) {
        applied.mobileCss = true;
        continue;
      }

      const injection = mobilePolish.injectMobileStyle(output[key]);

      if (injection.applied) {
        output[key] = injection.html;
        applied.mobileCss = true;
      } else if (injection.warning) {
        warnings.push(`${key}: ${injection.warning}`);
      }
    } catch (error) {
      warnings.push(
        `${key}: mobile CSS injection skipped: ${
          error && error.message ? error.message : 'unknown error'
        }`
      );
    }
  }

  /*
   * THE ONE-H1 FLOOR, per document (see ensureSingleH1). Runs after the CSS
   * injection so a promoted heading is judged against the final document —
   * and before the return so every caller's files map is already conformant.
   */
  for (const key of htmlKeys) {
    if (typeof output[key] !== 'string') continue;

    try {
      const promoted = ensureSingleH1(output[key]);
      if (promoted.applied) {
        output[key] = promoted.html;
        applied.h1Promoted += 1;
      } else if (promoted.warning) {
        warnings.push(`${key}: ${promoted.warning}`);
      }
    } catch (error) {
      warnings.push(
        `${key}: h1 promotion skipped: ${
          error && error.message ? error.message : 'unknown error'
        }`
      );
    }
  }

  /*
   * THE BRAND WORDMARK FLOOR, per document (see brandWordmarkFloor). Runs on
   * the final emitted bytes with the full files map in hand, so a client-logo
   * reference can be judged against the assets the build ACTUALLY ships.
   * Runs BEFORE the a11y floor so images this pass removes are never labeled
   * as if they would render.
   */
  const siteContext = options && typeof options.site === 'object' && !Array.isArray(options.site)
    ? options.site
    : null;
  const availableAssets = keys.filter((key) => typeof key === 'string');

  for (const key of htmlKeys) {
    if (typeof output[key] !== 'string') continue;

    try {
      const wordmark = brandWordmarkFloor(output[key], {
        availableAssets,
        businessName: deriveBusinessName(output[key], siteContext),
      });
      output[key] = wordmark.html;
      applied.wordmarksSwapped += wordmark.wordmarksSwapped;
      applied.logoFallbacksStripped += wordmark.logoFallbacksStripped;
      if (wordmark.warning) warnings.push(`${key}: brand wordmark: ${wordmark.warning}`);
    } catch (error) {
      warnings.push(
        `${key}: brand wordmark skipped: ${
          error && error.message ? error.message : 'unknown error'
        }`
      );
    }
  }

  /*
   * THE A11Y MARKUP FLOOR, per document (2026-09-02 accessibility layer).
   * Language attribute, skip link, image alt text, form-control labels —
   * see the pass helpers above. Each pass is idempotent and fail-soft; the
   * site context (business name/trade/market) sharpens the composed alt
   * sentences but is OPTIONAL: the page's own title/head is the fallback
   * identity. Runs last so it judges (and labels) the final markup.
   */
  for (const key of htmlKeys) {
    if (typeof output[key] !== 'string') continue;

    const a11yPasses = [
      ['lang', () => ensureLangAttribute(output[key]), (r) => { applied.langFixed += r.applied ? 1 : 0; }],
      ['skip link', () => ensureSkipLink(output[key]), (r) => { applied.skipLinks += r.applied ? 1 : 0; }],
      ['image alt', () => imageAltFloor(output[key], siteContext), (r) => { applied.altsAdded += r.added || 0; }],
      ['link names', () => linkNameFloor(output[key]), (r) => { applied.linksNamed += r.added || 0; }],
      ['form labels', () => formLabelFloor(output[key]), (r) => { applied.labelsAdded += r.added || 0; }],
    ];

    for (const [label, run, account] of a11yPasses) {
      try {
        const result = run();
        output[key] = result.html;
        account(result);
        if (result.warning) warnings.push(`${key}: a11y ${label}: ${result.warning}`);
      } catch (error) {
        warnings.push(
          `${key}: a11y ${label} skipped: ${
            error && error.message ? error.message : 'unknown error'
          }`
        );
      }
    }
  }

  return {
    files: output,
    applied,
    warnings
  };
}

module.exports = {
  dedupeGallery,
  dedupeJavaScriptGallery,
  tapFloorCss,
  contrastFloorCss,
  contrastPairManifest,
  a11yFloorCss,
  fleetPolishCss,
  logoPlateCss,
  lightLogoFallbackCss,
  heroContrastFloorCss,
  mobileContrastPairManifest: mobilePolish.mobileContrastPairManifest,
  mobilePolishCss: mobilePolish.mobilePolishCss,
  hasMobileStyle: mobilePolish.hasMobileStyle,
  injectMobileStyle: mobilePolish.injectMobileStyle,
  ensureSingleH1,
  ensureLangAttribute,
  ensureSkipLink,
  imageAltFloor,
  linkNameFloor,
  deriveBusinessName,
  formLabelFloor,
  brandSurfaceHexFromCss,
  applyBrandThemeColorMeta,
  brandWordmarkFloor,
  polishSite
};

/* ------------------------------------------------------------------------- *
 * Self-test
 * ------------------------------------------------------------------------- */

if (require.main === module && process.argv.includes('--test')) {
  const assert = require('node:assert/strict');

  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let offset = 0;

    while (true) {
      const index = haystack.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  }

  test(
    'dedupeGallery replaces second and third duplicate in replacement order',
    () => {
      const html = [
        '<div>',
        '<img src="https://example.com/a.jpg?size=1">',
        '<img src="https://example.com/a.jpg?size=2">',
        '<img src="https://example.com/a.jpg?size=3">',
        '</div>'
      ].join('');

      const result = dedupeGallery(html, {
        replacementUrls: [
          'https://client.test/one.jpg',
          'https://client.test/two.jpg'
        ]
      });

      assert.equal(result.replaced.length, 2);
      assert.equal(
        result.replaced[0].from,
        'https://example.com/a.jpg?size=2'
      );
      assert.equal(
        result.replaced[0].to,
        'https://client.test/one.jpg'
      );
      assert.equal(
        result.replaced[1].from,
        'https://example.com/a.jpg?size=3'
      );
      assert.equal(
        result.replaced[1].to,
        'https://client.test/two.jpg'
      );

      assert.match(
        result.html,
        /src="https:\/\/example\.com\/a\.jpg\?size=1"/
      );
      assert.match(
        result.html,
        /src="https:\/\/client\.test\/one\.jpg"/
      );
      assert.match(
        result.html,
        /src="https:\/\/client\.test\/two\.jpg"/
      );
      assert.equal(result.warnings.length, 0);
    }
  );

  test(
    'dedupeGallery with no replacement URLs preserves duplicate and gives one warning',
    () => {
      const html =
        '<img src="a.jpg"><img src="a.jpg"><img src="a.jpg">';

      const result = dedupeGallery(html, {
        replacementUrls: []
      });

      assert.equal(result.html, html);
      assert.equal(result.replaced.length, 0);
      assert.equal(result.warnings.length, 1);
      assert.equal(
        result.warnings[0],
        'no replacement available for a.jpg'
      );
    }
  );

  test(
    'dedupeGallery normalizes query strings but never rewrites first use',
    () => {
      const html =
        '<img src="/photo.jpg?width=100">' +
        '<img src="/photo.jpg?width=200">';

      const result = dedupeGallery(html, {
        replacementUrls: ['/fresh.jpg']
      });

      assert.match(result.html, /src="\/photo\.jpg\?width=100"/);
      assert.doesNotMatch(result.html, /width=200/);
      assert.match(result.html, /src="\/fresh\.jpg"/);
      assert.equal(result.replaced.length, 1);
    }
  );

  test(
    'dedupeGallery leaves non-duplicated images untouched',
    () => {
      const html =
        '<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg">';

      const result = dedupeGallery(html, {
        replacementUrls: ['/x.jpg', '/y.jpg']
      });

      assert.equal(result.html, html);
      assert.deepEqual(result.replaced, []);
      assert.deepEqual(result.warnings, []);
    }
  );

  test(
    'dedupeGallery skips replacement URLs already present in the document',
    () => {
      const html =
        '<img src="/a.jpg">' +
        '<img src="/a.jpg">' +
        '<img src="/already.jpg">';

      const result = dedupeGallery(html, {
        replacementUrls: ['/already.jpg?new=1', '/fresh.jpg']
      });

      assert.equal(result.replaced.length, 1);
      assert.equal(result.replaced[0].to, '/fresh.jpg');
      assert.match(result.html, /src="\/fresh\.jpg"/);
    }
  );

  test(
    'polishSite is idempotent',
    () => {
      const input = {
        'index.html':
          '<html><head><title>X</title></head><body>' +
          '<img src="/a.jpg"><img src="/a.jpg">' +
          '</body></html>',
        'assets/site.css': 'body { margin: 0; }'
      };

      const options = {
        replacementUrls: ['/replacement.jpg']
      };

      const first = polishSite(input, options);
      const second = polishSite(first.files, options);

      assert.deepEqual(second.files, first.files);
      assert.equal(second.applied.deduped, 0);
      assert.equal(second.applied.tapCss, true);
      assert.equal(second.applied.contrastCss, true);
    }
  );

  test(
    'polishSite injects exactly one style block before closing head',
    () => {
      const result = polishSite({
        'index.html':
          '<html><head><title>Hello</title></head><body></body></html>'
      });

      const html = result.files['index.html'];

      assert.equal(countOccurrences(html, 'id="wss-fleet-polish"'), 1);

      const styleIndex = html.indexOf('id="wss-fleet-polish"');
      const closeHeadIndex = html.toLowerCase().indexOf('</head>');

      assert.ok(styleIndex >= 0);
      assert.ok(closeHeadIndex > styleIndex);
      assert.equal(result.applied.tapCss, true);
      assert.equal(result.applied.contrastCss, true);
    }
  );

  test(
    'tap CSS rules exist only inside max-width 768px media query',
    () => {
      const css = tapFloorCss();

      assert.match(css, /@media\s*\(max-width:\s*768px\)\s*\{/);
      assert.match(css, /min-height:\s*44px;/);
      assert.match(css, /min-width:\s*44px;/);
      assert.match(css, /display:\s*inline-flex;/);
      assert.match(css, /align-items:\s*center;/);
      assert.match(css, /justify-content:\s*center;/);

      const mediaStart = css.indexOf('@media');
      const selectorStart = css.indexOf(
        'a, button, [role="button"], summary'
      );
      const minHeight = css.indexOf('min-height: 44px;');

      assert.equal(mediaStart, 0);
      assert.ok(selectorStart > mediaStart);
      assert.ok(minHeight > selectorStart);

      /*
       * Balanced braces and media opening at byte zero establish that the
       * selector/rules are enclosed by, rather than preceding, the media
       * block.
       */
      let depth = 0;
      let closedAt = -1;

      for (let i = 0; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        if (css[i] === '}') {
          depth -= 1;
          if (depth === 0) closedAt = i;
          assert.ok(depth >= 0);
        }
      }

      assert.equal(depth, 0);
      assert.equal(closedAt, css.length - 1);
    }
  );

  test(
    'contrast CSS follows the explicit site dark mode, never the operating system',
    () => {
      const css = contrastFloorCss();

      assert.match(
        css,
        /\[data-wss-theme="dark"\],\s*:root\.dark\s*\{/
      );
      assert.doesNotMatch(css, /prefers-color-scheme/i);
      assert.match(css, /color:\s*#e8e8ea\s*!important;/);
      assert.match(css, /a\s*\{\s*color:\s*#9db4ff\s*!important;/s);
      assert.match(
        css,
        /\*::placeholder\s*\{\s*color:\s*#b0b0b8\s*!important;/s
      );
      assert.match(css, /figcaption/);
      assert.match(css, /blockquote/);
    }
  );

  test(
    'contrast floor ships a light-mode branch with proven inks and no !important',
    () => {
      const css = contrastFloorCss();

      // The light scope mirrors heroContrastFloorCss's light-state scoping:
      // the not-dark default form and the explicit light attribute twin.
      assert.match(
        css,
        /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\),\s*\[data-wss-theme="light"\]\s*\{/
      );
      assert.doesNotMatch(css, /prefers-color-scheme/i);
      // Proven inks (ratios in contrastPairManifest and the check script).
      assert.match(css, /color:\s*#242933;/);
      assert.match(css, /color:\s*#1a4fc4;/);
      assert.match(css, /color:\s*#4d5460;/);
      assert.match(css, /color:\s*#565d6a;/);
      // The light branch must never fight the hero ink passes: no !important
      // in it (comments stripped first — they document why).
      const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const lightStart = cssNoComments.indexOf(
        ':root:not([data-wss-theme="dark"]):not(.dark), [data-wss-theme="light"]'
      );
      assert.ok(lightStart > 0, 'light branch present in the emitted CSS');
      const lightBranch = cssNoComments.slice(lightStart);
      assert.equal(lightBranch.includes('!important'), false,
        'the light-mode floor ships without !important so hero ink passes win');
    }
  );

  test(
    'dark labels/tags/secondary text get a proven ink, and the light floor has a hero guard',
    () => {
      const css = contrastFloorCss();

      assert.match(css, /color:\s*#c9cdd7\s*!important;/);
      assert.match(css, /\[class\*="tag" i\]/);
      assert.match(css, /\[class\*="eyebrow" i\]/);
      // Hero guard: restores the THEMED light ink after the light floor,
      // scoped to the hero containers, without !important. The old bare
      // #ffffff here was the light-theme wash (white hero words on the
      // theme's near-white hero surfaces, measured 1.12-1.61:1 — Class B,
      // 2026-09-04); the guard ink is now the palette's own --wss-text with
      // the unthemed navy as fallback.
      const guard = /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\) :is\(\.hero, \.hero-section, \[data-hero\]\) :is\(h1, h2, h3, h4, h5, h6, p, a, span, li, small, strong, em, figcaption, blockquote, label\) \{\s*\n\s*color: var\(--wss-text, #242933\);/;
      assert.match(css, guard);
      // No bare white hero ink may ship in the light floor again.
      assert.doesNotMatch(css, /color:\s*#ffffff;/);
      // The guard must come AFTER the light floor so the cascade favors it.
      assert.ok(css.indexOf('var(--wss-text, #242933);') > css.indexOf('color: #242933;'));
    }
  );

  test(
    'the contrast pair manifest covers both modes and its inks ship in the CSS',
    () => {
      const manifest = contrastPairManifest();
      const css = contrastFloorCss();

      assert.ok(manifest.length >= 12);
      for (const pair of manifest) {
        assert.ok(pair.minimum === 4.5 || pair.minimum === 3,
          `pair ${pair.role} declares an AA bar`);
        assert.match(css, new RegExp(pair.fg.replace('#', '#').replace(/([.()[\]])/g, '\\$1')),
          `manifest ink ${pair.fg} (${pair.role}) must ship in the floor CSS`);
      }
      for (const mode of ['dark', 'light']) {
        assert.ok(manifest.some((p) => p.mode === mode), `${mode} pairs declared`);
      }
    }
  );

  test(
    'fleet polish CSS pins the shared card scale, hero media containment, layout balance and mobile stack tokens',
    () => {
      const css = fleetPolishCss();

      // Shared card type scale + normalization inside multi-column grids.
      assert.match(css, /--wss-card-title-size: 1\.125rem; --wss-card-body-size: 1rem;/);
      assert.match(css, /\.wss-card-title \{ font-size: var\(--wss-card-title-size\); line-height: 1\.35; font-weight: 600; \}/);
      assert.match(css, /\.wss-card-body \{ font-size: var\(--wss-card-body-size\); line-height: 1\.6; \}/);
      assert.match(
        css,
        /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) > :is\(article, figure, li, \[class\*="card" i\], \[class\*="rounded"\]\) :is\(h3, h4\) \{\s*\n\s*font-size: var\(--wss-card-title-size\) !important; line-height: 1\.35 !important;/
      );
      assert.match(
        css,
        /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) > :is\(article, figure, li, \[class\*="card" i\], \[class\*="rounded"\]\) p \{\s*\n\s*font-size: var\(--wss-card-body-size\) !important; line-height: 1\.6 !important;/
      );

      // Hero media containment: clip, cover, aspect-ratio box.
      assert.match(
        css,
        /:is\(\.hero, \.hero-section, \[data-hero\], \.hero-media, \[class\*="hero-media" i\], \[data-hero-media\]\) \{\s*\n\s*overflow: hidden;/
      );
      assert.match(css, /video\[data-hero-video\],/);
      assert.match(css, /object-fit: cover; object-position: center;/);
      assert.match(css, /aspect-ratio: 16 \/ 9;/);

      // Construction-vertical balance: capped, centered content wrapper.
      assert.match(
        css,
        /@media \(min-width: 1024px\) \{\s*\n\s*:is\(main, \[role="main"\], body\) > :is\(section, div, article\) > :is\(section, div, article\) \{\s*\n\s*max-width: 80rem;\s*\n\s*margin-inline: auto;/
      );

      // Mobile card-stack spacing tokens, one scale inside the 768px block.
      assert.match(css, /--wss-stack-gap: 1rem; --wss-card-pad: 1\.25rem;/);
      assert.match(
        css,
        /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) \{ gap: var\(--wss-stack-gap\) !important; \}/
      );
    }
  );

  test(
    'hostile input fails soft and markup replacement cannot inject script tag',
    () => {
      assert.doesNotThrow(() => polishSite(null));

      const nullResult = polishSite(null);
      assert.equal(nullResult.files, null);
      assert.ok(nullResult.warnings.length >= 1);

      const files = {
        'index.html':
          '<html><head></head><body>' +
          '<img src="/same.jpg">' +
          '<img src="/same.jpg">' +
          '</body></html>',
        'bad.html': 123
      };

      const result = polishSite(files, {
        replacementUrls: ['"><script>alert(1)</script>']
      });

      assert.ok(result.warnings.length >= 1);
      assert.equal(result.files['bad.html'], 123);

      const html = result.files['index.html'];

      assert.equal(
        html.includes('<script>alert(1)</script>'),
        false
      );
      assert.equal(
        html.includes('"><script>'),
        false
      );
      assert.match(html, /&quot;&gt;&lt;script&gt;/);
    }
  );

  test(
    'dedupeGallery hostile non-string html never throws',
    () => {
      const cases = [null, undefined, 123, true, {}, [], Symbol('x')];

      for (const hostile of cases) {
        assert.doesNotThrow(() => dedupeGallery(hostile));
        const result = dedupeGallery(hostile);
        assert.equal(result.html, hostile);
        assert.equal(result.replaced.length, 0);
        assert.ok(result.warnings.length >= 1);
      }
    }
  );

  test(
    'multiple html files all dedupe and every page receives the style block',
    () => {
      const files = {
        'about.html':
          '<html><head></head><body>' +
          '<img src="/about.jpg"><img src="/about.jpg">' +
          '</body></html>',
        'index.html':
          '<html><head></head><body>' +
          '<img src="/home.jpg"><img src="/home.jpg">' +
          '</body></html>',
        'contact.html':
          '<html><head></head><body>' +
          '<img src="/contact.jpg"><img src="/contact.jpg">' +
          '</body></html>',
        'assets/app.css': '.x{}'
      };

      const result = polishSite(files, {
        replacementUrls: ['/client.jpg']
      });

      assert.equal(result.applied.deduped, 3);
      // 2026-09-02 fleet audit defect 1: the polish block used to ship on the
      // main document only, leaving interior pages unpolished. Every page
      // carries the block now.
      assert.match(
        result.files['index.html'],
        /id="wss-fleet-polish"/
      );
      assert.match(
        result.files['about.html'],
        /id="wss-fleet-polish"/
      );
      assert.match(
        result.files['contact.html'],
        /id="wss-fleet-polish"/
      );

      assert.match(
        result.files['about.html'],
        /src="\/client\.jpg"/
      );
      assert.match(
        result.files['index.html'],
        /src="\/client\.jpg"/
      );
      assert.match(
        result.files['contact.html'],
        /src="\/client\.jpg"/
      );

      assert.equal(result.files['assets/app.css'], '.x{}');
    }
  );

  test(
    'every html file receives the style block when index.html is absent',
    () => {
      const files = {
        'about.html':
          '<html><head></head><body></body></html>',
        'contact.html':
          '<html><head></head><body></body></html>'
      };

      const result = polishSite(files);

      assert.match(
        result.files['about.html'],
        /id="wss-fleet-polish"/
      );
      assert.match(
        result.files['contact.html'],
        /id="wss-fleet-polish"/
      );
    }
  );

  test(
    'missing closing head skips CSS injection and records warning',
    () => {
      const html = '<html><head><title>X</title><body>Hello</body></html>';

      const result = polishSite({
        'index.html': html
      });

      // CSS injection stands down without a </head>, but the a11y floor is
      // independent of it: the lang attribute needs only the <html> tag
      // (2026-09-02 accessibility layer).
      assert.equal(
        result.files['index.html'],
        '<html lang="en"><head><title>X</title><body>Hello</body></html>'
      );
      assert.equal(result.applied.tapCss, false);
      assert.equal(result.applied.contrastCss, false);
      assert.equal(result.applied.langFixed, 1);
      assert.ok(
        result.warnings.some((warning) =>
          warning.includes('no </head>')
        )
      );
    }
  );

  test(
    'existing polish id prevents duplicate style injection',
    () => {
      const html =
        '<html><head>' +
        '<style id="wss-fleet-polish">existing</style>' +
        '</head><body></body></html>';

      const result = polishSite({
        'index.html': html
      });

      // No second fleet style block — but the MOBILE block still injects
      // (its own id, its own idempotence), and the a11y markup floor still
      // runs: the lang attribute is still missing from this fixture.
      assert.equal(
        result.files['index.html'],
        '<html lang="en"><head>' +
        '<style id="wss-fleet-polish">existing</style>' +
        '\n<style id="wss-mobile-polish">\n' + mobilePolish.mobilePolishCss() + '\n</style>' +
        '\n</head><body></body></html>'
      );
      assert.equal(
        countOccurrences(
          result.files['index.html'],
          'id="wss-fleet-polish"'
        ),
        1
      );
      assert.equal(countOccurrences(
        result.files['index.html'],
        'id="wss-mobile-polish"'
      ), 1);
      assert.equal(result.applied.tapCss, true);
      assert.equal(result.applied.contrastCss, true);
      assert.equal(result.applied.mobileCss, true);
      assert.equal(result.applied.langFixed, 1);
    }
  );

  test(
    'polishSite keeps every original file key and does not mutate input map',
    () => {
      const input = {
        'index.html':
          '<html><head></head><body>' +
          '<img src="/x.jpg"><img src="/x.jpg">' +
          '</body></html>',
        'assets/a.css': 'a{}',
        'asset.bin': 42
      };

      const originalIndex = input['index.html'];
      const result = polishSite(input, {
        replacementUrls: ['/new.jpg']
      });

      assert.deepEqual(
        Object.keys(result.files),
        Object.keys(input)
      );

      assert.equal(input['index.html'], originalIndex);
      assert.equal(result.files['assets/a.css'], 'a{}');
      assert.equal(result.files['asset.bin'], 42);
    }
  );

  test(
    'single-quoted img src is deduplicated safely',
    () => {
      const html =
        "<img src='/x.jpg'><img class='y' src='/x.jpg'>";

      const result = dedupeGallery(html, {
        replacementUrls: ['/fresh.jpg']
      });

      assert.equal(result.replaced.length, 1);
      assert.match(result.html, /src='\/x\.jpg'/);
      assert.match(result.html, /src="\/fresh\.jpg"/);
    }
  );

  test(
    'brandWordmarkFloor swaps an unshipped client-logo reference for the wordmark and strips triangle fallbacks',
    () => {
      // The Class E shape: a client-logo src the build does not ship, whose
      // onerror would land on the generic drawn triangle.
      const html =
        '<html><head><title>Reliable Plumbing</title></head><body>' +
        '<header><span class="logo-plate">' +
        '<img src="/assets/client-logo.png" alt="Reliable Plumbing logo" onerror="this.src=\'assets/client-logo-fallback.svg\'">' +
        '</span></header>' +
        '<img src="/assets/brand-logo.svg" alt="Reliable Plumbing" onerror="this.src=\'assets/mark-fallback.svg\'">' +
        '<img src="https://brand.test/verified-mark.png" alt="mark" onerror="this.src=\'assets/client-logo-fallback.svg\'">' +
        '</body></html>';

      const result = brandWordmarkFloor(html, {
        availableAssets: ['index.html', 'assets/brand-logo.svg'],
        businessName: 'Reliable Plumbing',
      });

      // (1) the unshipped client-logo img became the typographic wordmark.
      assert.equal(result.wordmarksSwapped, 1);
      assert.match(result.html, /<span class="wss-wordmark">Reliable Plumbing<\/span>/);
      assert.doesNotMatch(result.html, /src="\/assets\/client-logo\.png"/);

      // (2) every generic-triangle onerror handler is stripped — including
      //     the ones on shipped-wordmark and external-URL images. (The
      //     replaced client-logo tag's handler disappears with the tag.)
      assert.equal(result.logoFallbacksStripped, 2);
      assert.doesNotMatch(result.html, /onerror=/);
      assert.match(result.html, /<img src="\/assets\/brand-logo\.svg" alt="Reliable Plumbing">/);
      assert.match(result.html, /<img src="https:\/\/brand\.test\/verified-mark\.png" alt="mark">/);

      // Idempotent: a second pass changes nothing.
      const second = brandWordmarkFloor(result.html, {
        availableAssets: ['index.html', 'assets/brand-logo.svg'],
        businessName: 'Reliable Plumbing',
      });
      assert.equal(second.wordmarksSwapped, 0);
      assert.equal(second.logoFallbacksStripped, 0);
      assert.equal(second.html, result.html);
    }
  );

  test(
    'brandWordmarkFloor leaves a shipped client-logo and logo-less pages byte-identical',
    () => {
      const shipped =
        '<img src="/assets/client-logo.png" alt="Acme logo" onerror="this.src=\'assets/client-logo-fallback.svg\'">';
      const withAsset = brandWordmarkFloor(shipped, {
        availableAssets: ['assets/client-logo.png'],
      });
      // The asset IS shipped: the reference stays, only the triangle
      // fallback is disarmed.
      assert.equal(withAsset.wordmarksSwapped, 0);
      assert.equal(withAsset.logoFallbacksStripped, 1);
      assert.match(withAsset.html, /src="\/assets\/client-logo\.png"/);
      assert.doesNotMatch(withAsset.html, /onerror=/);

      const plain = '<html><head></head><body><p>no logo slot</p></body></html>';
      const untouched = brandWordmarkFloor(plain, { availableAssets: ['index.html'] });
      assert.equal(untouched.html, plain);
      assert.equal(untouched.wordmarksSwapped, 0);
      assert.equal(untouched.logoFallbacksStripped, 0);
    }
  );

  test(
    'fleet polish CSS carries the header wrap floor, the brand-name ellipsis law and the wordmark treatment',
    () => {
      const css = fleetPolishCss();

      // E2: the mobile header row wraps instead of pushing the call CTA off
      // the right edge.
      assert.match(css, /header :is\(\.shell, \.header-inner, \.header-wrap, \.header-row, \.header-container,/,
        'the mobile header wrap floor is gone — the call CTA will overflow 390px again (Class E)');
      assert.match(css, /flex-wrap: wrap; row-gap: 0\.5rem;/);
      assert.match(
        css,
        /header :is\(a\[href\^="tel:"\], \.header-cta, \[class\*="header-cta" i\], \.phone-cta, \.call-cta\) \{\s*\n\s*min-width: 0; max-width: 100%;/
      );

      // E4: brand names render whole or ellipsis, never a mid-word clip.
      assert.match(
        css,
        /:is\(\.brand-name, \[class\*="brand-name" i\]\) \{\s*\n\s*min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/
      );

      // E3: the wordmark treatment the brand floor swaps in.
      assert.match(css, /\.wss-wordmark \{/);
    }
  );

  test(
    'polishSite runs the brand wordmark floor on every page',
    () => {
      const files = {
        'index.html':
          '<html><head><title>Acme Plumbing</title></head><body>' +
          '<img src="/assets/client-logo.png" alt="Acme Plumbing logo" onerror="this.src=\'assets/client-logo-fallback.svg\'">' +
          '</body></html>',
        'about.html':
          '<html><head><title>About</title></head><body>' +
          '<img src="/assets/client-logo.png" alt="Acme Plumbing logo" onerror="this.src=\'assets/mark-fallback.svg\'">' +
          '</body></html>'
      };

      const result = polishSite(files);
      assert.equal(result.applied.wordmarksSwapped, 2);
      assert.equal(result.applied.logoFallbacksStripped, 0);
      assert.match(result.files['index.html'], /class="wss-wordmark">Acme Plumbing</);
      assert.match(result.files['about.html'], /class="wss-wordmark">Acme Plumbing</);
    }
  );

  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      const message =
        error && error.message
          ? error.message.replace(/\s+/g, ' ').trim()
          : String(error);
      console.log(`FAIL ${name}: ${message}`);
    }
  }

  process.exitCode = failed === 0 ? 0 : 1;
}
