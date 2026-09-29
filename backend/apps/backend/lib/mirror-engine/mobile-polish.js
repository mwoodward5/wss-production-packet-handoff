'use strict';

/**
 * mobile-polish.js — THE MOBILE RENDERING FLOOR (owner: "our mobile view
 * looks like shit and is cut out", 2026-09-02).
 *
 * Node 20+, CommonJS, zero npm dependencies. This is the mobile-polish CSS
 * module of the fleet polish layer: like every sheet in this engine it is
 * emitted as a string (so the test suite and contrast gates can cross-check
 * the exact bytes that ship) and injected as one idempotent <style> block.
 *
 * THE DEFECT CLASS, at 390px on the live fleet:
 *
 *   1. DARK BACKGROUNDS THAT SWALLOW TEXT — the cinematic-dark donors
 *      (#636 diagnostic) stack semi-transparent washes over near-black
 *      canvases; their muted grey utility ink sits far below AA on the murk.
 *   2. WASHED-OUT CONTENT — low-opacity text, mix-blend-mode display ink
 *      and backdrop-blur "glass" cards that never survive a small screen.
 *   3. POOR READABILITY VS THE CLIENT'S ORIGINAL SITE — sub-16px body copy,
 *      cramped sections, distorted images, CTAs that are 30px slivers.
 *
 * Everything here is CSS-only (media queries + token overrides injected at
 * build time by the polish layer) — no donor JavaScript runtime changes.
 *
 * THE MODE LAW (leverages #636/#639 brand identity): theme.js `decideMode`
 * already flips a cinematic-dark donor to light when the extraction lane's
 * `brand_identity.background` reads light — the CLIENT's original canvas
 * wins. This sheet never re-decides mode: every colour rule is bound to the
 * SAME explicit state scopes theme.js emits ([data-wss-theme="dark"] +
 * :root.dark, and the :not() light twins). When the flip happens, the dark
 * branch stops matching and the light branch ships — never grey-on-dark,
 * never white-on-white.
 *
 * EMISSION NOTE: the sheet is FLAT — no native CSS nesting — because these
 * floors must hold on the older mobile WebViews the donors still compile
 * for. The scopeEach helper prefixes EVERY selector of a comma list with
 * EVERY mode scope, which is what the desktop floor's nested braces did
 * implicitly.
 */

// ---------------------------------------------------------------------------
// scoping helpers
// ---------------------------------------------------------------------------

/**
 * Split a selector list on TOP-LEVEL commas only — commas inside :is()/not()
 * arguments are functional, not separators.
 */
function splitTopLevelSelectors(list) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(list)) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * Prefix every selector in a comma list with every scope, cartesian-joined.
 * `scopeEach(['A', 'B'], 'p, a')` -> 'A p, A a, B p, B a'. Functional commas
 * (inside :is() etc.) are never split.
 */
function scopeEach(scopes, selectorList) {
  const selectors = splitTopLevelSelectors(selectorList);
  const scopeList = (Array.isArray(scopes) ? scopes : [scopes])
    .flatMap((scope) => splitTopLevelSelectors(scope));
  const out = [];
  for (const scope of scopeList) {
    for (const selector of selectors) {
      out.push(`${scope} ${selector}`);
    }
  }
  return out.join(',\n  ');
}

/* Mode scopes — the attribute AND the class twin, exactly as theme.js
 * modeScopePrefixes and the desktop contrastFloorCss emit them. */
const WSS_DARK_SCOPES = ['[data-wss-theme="dark"]', ':root.dark'];
const WSS_LIGHT_SCOPES = [
  ':root:not([data-wss-theme="dark"]):not(.dark)',
  '[data-wss-theme="light"]'
];

// ---------------------------------------------------------------------------
// selector vocabulary
// ---------------------------------------------------------------------------

/* The hero containers the fleet polish layer owns (fleetPolishCss paints a
 * dark veil ::before on all of them, heroContrastFloorCss bands proven
 * scrims onto opted-in ones). */
const WSS_HERO_CONTAINERS =
  '.hero, .hero-section, [data-hero], .hero-media, [class*="hero-media" i], [data-hero-media]';

/* Label/tag/eyebrow shape — same substring-loose hook list the desktop
 * contrast floor uses (compiled Tailwind donors, handcrafted clean-room
 * donors and engine-injected sections all match). */
const WSS_MOBILE_LABEL_INK_SELECTOR = [
  'small', 'dt', 'dd', 'summary', 'cite', 'time', 'address',
  '[class*="tag" i]', '[class*="badge" i]', '[class*="chip" i]',
  '[class*="label" i]', '[class*="eyebrow" i]', '[class*="kicker" i]',
  '[class*="caption" i]', '[class*="subtext" i]'
].join(', ');

/* Text elements the colour/opacity/blend floors bind to. */
const WSS_MOBILE_TEXT_SET = [
  'body', 'p', 'li', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'label', 'td', 'th', 'figcaption', 'blockquote', 'dt', 'dd',
  'strong', 'em', 'b', 'i', 'small', 'summary', 'cite', 'time',
  'address'
].join(', ');

/* Body-copy elements: the 16px floor set (inputs too — iOS zooms focus to
 * any focusable carrying less than 16px). */
const WSS_MOBILE_BODY_COPY_SET = [
  'p', 'li', 'td', 'dd', 'blockquote', 'label',
  'input', 'textarea', 'select'
].join(', ');

/* Utility/inline text: the universal 14px floor set (nothing below 14px
 * anywhere). max(14px, 1em) is a true FLOOR — it never shrinks type a donor
 * made larger, because 1em resolves against the PARENT's size. */
const WSS_MOBILE_UTILITY_TEXT_SET = [
  'small', 'span', 'a', 'strong', 'em', 'b', 'i', 'u', 'div',
  'button', 'summary', 'time', 'address', 'cite', 'figcaption', 'option'
].join(', ');

/* CTA shape — a/button/submit-class controls named by class or data
 * attribute. Containers are deliberately NOT matched. */
const WSS_MOBILE_CTA_SELECTOR = (suffix) => [
  `a${suffix}`, `button${suffix}`, `[role="button"]${suffix}`,
  `input[type="submit"]${suffix}`, `input[type="button"]${suffix}`
].join(', ');
const WSS_MOBILE_CTA_SHAPES =
  ':is([class*="btn" i], [class*="button" i], [class*="cta" i], [data-cta])';
const WSS_MOBILE_PRIMARY_SHAPES =
  ':is([class*="primary" i], [data-cta="primary"])';

/* Card/wash surfaces that get SOLID high-contrast backgrounds at mobile.
 * Deliberately EXCLUDES hero overlay/scrim/veil shapes — the hero passes
 * (fleetPolishCss veil, heroContrastFloorCss banded scrims) own those
 * pixels; this floor owns the content cards. */
const WSS_MOBILE_WASH_CARD_SELECTOR = [
  'section', 'div', 'article', 'aside', 'li', 'footer'
].map((container) =>
  `${container}:is([class*="card" i], [class*="tile" i], [class*="panel" i], [class*="glass" i], [class*="frost" i], [class*="blur" i])`
).join(', ');

/* Content images forced to clean full-width boxes at mobile. Logo/icon/
 * badge/avatar/decorative shapes are excluded (a forced full-width icon is
 * its own defect); the hero re-assertion below restores the cover-
 * containment the fleet layer already ships. */
const WSS_MOBILE_CONTENT_IMG =
  ':is(main, [role="main"]) img:not([src*="logo" i]):not([class*="logo" i])'
  + ':not([class*="icon" i]):not([class*="badge" i]):not([class*="avatar" i])'
  + ':not([class*="emoji" i]):not([alt=""])'
  + ':not([width="16"]):not([width="24"]):not([width="32"]):not([width="48"])';

// ---------------------------------------------------------------------------
// the mobile contrast pair manifest
// ---------------------------------------------------------------------------

/**
 * THE MOBILE CONTRAST PAIR MANIFEST — the declared text/background pairs the
 * mobile floor ships at ≤768px, with the WCAG bar each must clear. The test
 * suite computes every ratio with theme.js's own WCAG 2.1 maths and
 * cross-checks that every manifest ink actually appears in the emitted CSS,
 * so the manifest and the stylesheet can never drift apart silently.
 *
 * Surfaces are the worst plausible mobile canvases per mode: #101216 is a
 * near-black dark canvas, #262a33 a raised dark card and #1d222b the SOLID
 * surface this floor paints onto glass/wash cards in dark mode; #ffffff is
 * the light paper and #f3f2ef the pale slab the theme pass paints in light
 * mode. Every ink was measured against BOTH of its mode's surfaces (ratios
 * in test/mobile-polish.test.js) before being chosen. Mobile inks sit one
 * step brighter/darker than the desktop floor's — small screens, often
 * outdoors, often at reduced brightness, get the larger reserve.
 */
function mobileContrastPairManifest() {
  return [
    { mode: 'dark', role: 'body', fg: '#f2f3f6', bg: '#101216', minimum: 4.5 },
    { mode: 'dark', role: 'body-on-card', fg: '#f2f3f6', bg: '#262a33', minimum: 4.5 },
    { mode: 'dark', role: 'body-on-solid-mobile-card', fg: '#f2f3f6', bg: '#1d222b', minimum: 4.5 },
    { mode: 'dark', role: 'link', fg: '#a9beff', bg: '#101216', minimum: 4.5 },
    { mode: 'dark', role: 'link-on-card', fg: '#a9beff', bg: '#262a33', minimum: 4.5 },
    { mode: 'dark', role: 'secondary-label', fg: '#d7dce6', bg: '#101216', minimum: 4.5 },
    { mode: 'dark', role: 'secondary-label-on-card', fg: '#d7dce6', bg: '#262a33', minimum: 4.5 },
    { mode: 'dark', role: 'placeholder', fg: '#b8bcc6', bg: '#101216', minimum: 4.5 },
    { mode: 'light', role: 'body', fg: '#1f242e', bg: '#ffffff', minimum: 4.5 },
    { mode: 'light', role: 'body-on-slab', fg: '#1f242e', bg: '#f3f2ef', minimum: 4.5 },
    { mode: 'light', role: 'link', fg: '#1747b5', bg: '#ffffff', minimum: 4.5 },
    { mode: 'light', role: 'link-on-slab', fg: '#1747b5', bg: '#f3f2ef', minimum: 4.5 },
    { mode: 'light', role: 'secondary-label', fg: '#454c59', bg: '#ffffff', minimum: 4.5 },
    { mode: 'light', role: 'secondary-label-on-slab', fg: '#454c59', bg: '#f3f2ef', minimum: 4.5 },
    { mode: 'light', role: 'placeholder', fg: '#4f5663', bg: '#ffffff', minimum: 4.5 }
  ];
}

// ---------------------------------------------------------------------------
// the sheet
// ---------------------------------------------------------------------------

/**
 * THE MOBILE SHEET. Everything ships inside ONE @media (max-width: 768px)
 * block — the 390px audit width and every phone width below it. Section
 * order matters inside the block (later rules win same-specificity ties):
 * hardening, typography, CTA geometry, images (generic then hero
 * re-assertion), spacing, then the state-scoped contrast/wash floors with
 * the light-mode hero guard last.
 */
function mobilePolishCss() {
  return [
    '/* --- wss mobile polish floor (<=768px). Owner defect: "our mobile view',
    '   looks like shit and is cut out" — dark cinematic donors swallowing',
    '   text (#636), washed-out low-opacity content, sub-16px body copy,',
    '   distorted images, 30px CTAs. CSS-only; bound to the explicit theme',
    '   state so a #639 brand_identity light flip re-dresses it for free. */',
    '@media (max-width: 768px) {',

    '  /* 0. NO HORIZONTAL SCROLL. overflow-x: clip is preferred (it does not',
    '   * create a scroll container, so sticky headers keep sticking); the',
    '   * hidden fallback covers engines without clip. Long words break',
    '   * instead of pushing the page wide. */',
    '  html, body { max-width: 100%; overflow-x: hidden; }',
    '  @supports (overflow-x: clip) { html, body { overflow-x: clip; } }',
    `  ${WSS_MOBILE_TEXT_SET}, a, div { overflow-wrap: break-word; }`,
    '  img, video { max-width: 100%; }',

    '  /* 1. MOBILE TYPOGRAPHY SCALE. Body copy >= 16px, headings >= 24px at',
    '   * 390px via the clamp minima, utility text floored at 14px with a true',
    '   * floor (max(14px, 1em)) that never shrinks larger donor type, phone',
    '   * numbers 18px bold. The card-scoped twin beats the fleet layer\'s',
    '   * 1.125rem desktop card-title pin inside this query. */',
    '  body { font-size: max(16px, 1em); line-height: 1.6; }',
    `  ${WSS_MOBILE_BODY_COPY_SET} { font-size: max(16px, 1em) !important; }`,
    '  h1 { font-size: clamp(2rem, 9vw, 3.25rem) !important; line-height: 1.05 !important; }',
    '  h2 { font-size: clamp(1.75rem, 7.5vw, 2.5rem) !important; line-height: 1.12 !important; }',
    '  h3, h4, h5, h6 { font-size: clamp(1.5rem, 6vw, 2rem) !important; line-height: 1.2 !important; }',
    '  :is([class*="grid-cols-"], .cards, .card-grid) :is(h3, h4, .wss-card-title) {',
    '    font-size: clamp(1.5rem, 6vw, 2rem) !important; line-height: 1.2 !important;',
    '  }',
    '  .wss-card-body { font-size: 1rem !important; line-height: 1.6 !important; }',
    `  ${WSS_MOBILE_UTILITY_TEXT_SET} { font-size: max(14px, 1em) !important; }`,
    '  a[href^="tel:"], .phone, .phone-cta, [class*="phone" i] {',
    '    font-size: max(18px, 1em) !important; font-weight: 700 !important;',
    '  }',

    '  /* 2. MOBILE CTA VISIBILITY. Every CTA shape is full-width, >= 48px',
    '   * tall, centred, 16px semibold. The header carve-out comes AFTER so',
    '   * the masthead keeps its compact buttons. Primary CTAs resolve their',
    '   * ink pair from the theme palette tokens (--wss-accent carries the',
    '   * CLIENT\'S colour since #639; --wss-accent-ink is the ink the palette',
    '   * computed to pass against it) with AA fallbacks for unthemed donors. */',
    `  ${WSS_MOBILE_CTA_SELECTOR(WSS_MOBILE_CTA_SHAPES)} {`,
    '    display: inline-flex; width: 100%; min-height: 48px; box-sizing: border-box;',
    '    align-items: center; justify-content: center; text-align: center;',
    '    padding-block: 0.75rem; font-size: max(16px, 1em) !important; font-weight: 600;',
    '  }',
    '  header :is(a, button):is([class*="btn" i], [class*="button" i], [class*="cta" i]) {',
    '    width: auto; min-width: 48px; padding-inline: 0.9rem;',
    '  }',
    `  ${scopeEach([...WSS_DARK_SCOPES, ...WSS_LIGHT_SCOPES], WSS_MOBILE_CTA_SELECTOR(WSS_MOBILE_PRIMARY_SHAPES))} {`,
    // THE ACCENT FALLBACK IS THE DONOR'S WARM BRICK, never a blue literal
    // (2026-09-03 micro-fix): the engine's accent bootstrap guarantees the
    // token is defined on every build, so this fallback only fires on a page
    // no theme pass reached — and then it must read as the same warm accent
    // family the islands use (hsl(8 61% 40%) = #A43828), not Tailwind blue.
    '    background-color: var(--wss-accent, #a43828) !important;',
    '    color: var(--wss-accent-ink, #ffffff) !important;',
    '    border-color: transparent;',
    '  }',

    '  /* 3. MOBILE IMAGE QUALITY. Content images fill their column with the',
    '   * intrinsic ratio preserved (no distortion, no tiny-in-huge-container);',
    '   * logo/icon/badge/avatar shapes are excluded above. The hero',
    '   * re-assertion comes AFTER the generic rule so hero media keeps the',
    '   * fleet layer\'s cover-containment (height: 100% inside the clipped,',
    '   * aspect-ratio box). */',
    `  ${WSS_MOBILE_CONTENT_IMG} {`,
    '    width: 100% !important; height: auto !important; max-width: 100%;',
    '    object-fit: cover; object-position: center;',
    '  }',
    `  video[data-hero-video], ${scopeEach(WSS_HERO_CONTAINERS, ':is(img, video)')} {`,
    '    width: 100% !important; height: 100% !important; max-width: 100%;',
    '    object-fit: cover !important; object-position: center;',
    '  }',

    '  /* 4. MOBILE SPACING RHYTHM. Sections breathe at >= 48px vertical',
    '   * (beats the fleet layer\'s 40px clamp minimum inside this query),',
    '   * stacked card grids keep the >= 16px gap token, and nothing touches',
    '   * the screen edges (>= 20px side padding; border-box so the padding',
    '   * can never itself overflow the viewport). */',
    '  :is(section, [role="region"]) {',
    '    padding-block: clamp(3rem, 12vw, 4.5rem) !important;',
    '    padding-inline: max(20px, 5vw) !important; box-sizing: border-box;',
    '  }',
    '  :is(main, [role="main"], body > header, body > footer) {',
    '    padding-inline: max(20px, 5vw) !important; box-sizing: border-box;',
    '  }',
    '  :is([class*="grid-cols-"], .cards, .card-grid) {',
    '    gap: max(1rem, var(--wss-stack-gap, 1rem)) !important;',
    '  }',

    '  /* 5. THE WASHED-OUT FIX, shared by both modes. Donors ship display',
    '   * text at opacity .5-.8, blend-mode "difference" ink and backdrop-blur',
    '   * glass cards — none survive a phone. Text is forced to full opacity',
    '   * and normal blending (a hidden ANCESTOR still hides its children:',
    '   * opacity multiplies down the tree, so closed mobile menus stay',
    '   * closed), gradient-clip text falls back to its solid colour, and',
    '   * glass/wash cards lose their blur. -webkit-text-fill-color:',
    '   * currentColor tracks whatever ink the state floors below (or a hero',
    '   * ink pass) resolved, so the fill can never disagree with the painted',
    '   * colour again. */',
    `  ${WSS_MOBILE_TEXT_SET} {`,
    '    opacity: 1 !important;',
    '    mix-blend-mode: normal !important;',
    '    -webkit-text-fill-color: currentColor !important;',
    '  }',
    '  :is([class*="glass" i], [class*="frost" i], [class*="blur" i]),',
    `  ${WSS_MOBILE_WASH_CARD_SELECTOR} {`,
    '    backdrop-filter: none !important; -webkit-backdrop-filter: none !important;',
    '  }',

    '  /* 6. THE MOBILE CONTRAST FLOOR — DARK STATE. The cinematic-dark',
    '   * donors\' worst offenders: grey utility ink on near-black murk. One',
    '   * proven body ink, one link ink, one secondary ink, one placeholder',
    '   * ink (ratios in mobileContrastPairManifest + the test suite), plus',
    '   * SOLID card surfaces (#1d222b — every ink above clears AA against it',
    '   * too). !important is deliberate and matches the desktop dark floor:',
    '   * a dark canvas is uniform, so the floor must win everything. */',
    `  ${scopeEach(WSS_DARK_SCOPES, WSS_MOBILE_TEXT_SET)} { color: #f2f3f6 !important; }`,
    `  ${scopeEach(WSS_DARK_SCOPES, 'a')} { color: #a9beff !important; }`,
    `  ${scopeEach(WSS_DARK_SCOPES, WSS_MOBILE_LABEL_INK_SELECTOR)} { color: #d7dce6 !important; }`,
    `  ${scopeEach(WSS_DARK_SCOPES, '*::placeholder')} { color: #b8bcc6 !important; }`,
    `  ${scopeEach(WSS_DARK_SCOPES, WSS_MOBILE_WASH_CARD_SELECTOR)} {`,
    '    background-color: #1d222b !important; background-image: none !important;',
    '  }',

    '  /* 7. THE MOBILE CONTRAST FLOOR — LIGHT STATE (and the #639 flip). When',
    '   * brand_identity.background says the CLIENT\'s original site is light,',
    '   * theme.js decideMode flips even a cinematic-dark donor to light and',
    '   * these are the rules that take over at mobile. DELIBERATELY WITHOUT',
    '   * !important on colour — the same doctrine as the desktop light floor:',
    '   * light mode shares its page with dark-styled hero bands and the hero',
    '   * ink passes\' proven pairs must win. The glass/wash card solid surface',
    '   * is geometry, not colour, and keeps its !important. */',
    `  ${scopeEach(WSS_LIGHT_SCOPES, WSS_MOBILE_TEXT_SET)} { color: #1f242e; }`,
    `  ${scopeEach(WSS_LIGHT_SCOPES, 'a')} { color: #1747b5; }`,
    `  ${scopeEach(WSS_LIGHT_SCOPES, WSS_MOBILE_LABEL_INK_SELECTOR)} { color: #454c59; }`,
    `  ${scopeEach(WSS_LIGHT_SCOPES, '*::placeholder')} { color: #4f5663; }`,
    `  ${scopeEach(WSS_LIGHT_SCOPES, WSS_MOBILE_WASH_CARD_SELECTOR)} { background-color: #ffffff !important; }`,

    '  /* The mobile hero guard, mirroring the desktop one and scoped to the',
    '   * generic fleet veil: heroes without a wash pass keep white display',
    '   * ink over the dark ::before veil the fleet layer paints at every',
    '   * width. Later in the block than the light floor, so the cascade',
    '   * favours it at equal (no-!)important weight. */',
    `  ${scopeEach(WSS_LIGHT_SCOPES, `:is(.hero, .hero-section, [data-hero]) :is(${WSS_MOBILE_TEXT_SET}, a, div)`)} {`,
    '    color: #ffffff;',
    '  }',
    '}'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// injection
// ---------------------------------------------------------------------------

function hasMobileStyle(html) {
  if (typeof html !== 'string') return false;
  return /<style\b[^>]*\bid\s*=\s*(["'])wss-mobile-polish\1[^>]*>/i.test(html);
}

/**
 * Inject the mobile polish sheet before the closing head. Idempotent: a
 * document that already carries the wss-mobile-polish block is unchanged.
 * Running after injectPolishStyle lands this block LATER in the head than
 * the fleet block, so same-specificity ties (the 40px->48px section clamp,
 * the card-title size pin) resolve in the mobile floor's favour.
 */
function injectMobileStyle(html) {
  if (typeof html !== 'string') {
    return { html, applied: false, warning: 'main html must be a string' };
  }

  if (hasMobileStyle(html)) {
    return { html, applied: false, warning: null };
  }

  const closeHead = /<\/head\s*>/i.exec(html);
  if (!closeHead) {
    return {
      html,
      applied: false,
      warning: 'cannot inject mobile polish CSS: main html has no </head>'
    };
  }

  const block = [
    '<style id="wss-mobile-polish">',
    mobilePolishCss(),
    '</style>'
  ].join('\n');

  const before = html.slice(0, closeHead.index);
  const after = html.slice(closeHead.index);
  const separator = before.length > 0 && !/\n$/.test(before) ? '\n' : '';

  return {
    html: before + separator + block + '\n' + after,
    applied: true,
    warning: null
  };
}

module.exports = {
  mobileContrastPairManifest,
  mobilePolishCss,
  hasMobileStyle,
  injectMobileStyle
};
