'use strict';

/**
 * scripts/check-contrast.js — the automated WCAG AA gate for fleet text.
 *
 *   node scripts/check-contrast.js        # exit 0 = every declared pair passes
 *   npm run check:contrast                # the same, wired in package.json
 *
 * WHY (Comet visual audit, 2026-09-02, owner-endorsed): light-mode body text
 * shipped at 2-3:1 on white across the construction/fence mirrors and dark
 * labels/tags were the weakest ink on the plumbing/HVAC ones. Two audits
 * contradicted each other about structured data, and contrast claims were
 * likewise unverified — so the floor's pairs are now COMPUTED on every run
 * instead of asserted in prose.
 *
 * WHAT IT CHECKS
 *
 *   1. THE POLISH FLOOR. lib/mirror-engine/fleet-polish.js exports
 *      contrastPairManifest(): every declared text/background pair of
 *      contrastFloorCss() with its WCAG bar (4.5 body / 3 large display).
 *      Each ratio is computed here with the same WCAG 2.1 maths theme.js
 *      uses, and each manifest ink is cross-checked against the EMITTED
 *      contrastFloorCss() string so the manifest and the stylesheet cannot
 *      drift apart silently.
 *
 *   2. TEMPLATE TOKENS. Every donors-clean donor stylesheet's mode scopes
 *      (:root, .dark, :root.dark, [data-wss-theme="light"|"dark"]) have
 *      their shadcn token PAIRS resolved — foreground/background,
 *      muted-foreground/background, card-foreground/card,
 *      popover-foreground/popover, accent-foreground/accent,
 *      primary-foreground/primary — through var() chains (depth-capped;
 *      color-mix is refused rather than guessed) and measured the same way.
 *      HSL triplets ("30 10% 8%"), #hex and oklch() all parse.
 *
 * A pair below its bar prints FAIL and the run exits 1, so CI (the `ci`
 * chain, right after the syntax check) catches a washed-out ink before it
 * ships. Dependency-free on purpose: same constraint as the polish layer.
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// colour maths — mirrors lib/mirror-engine/theme.js
// ---------------------------------------------------------------------------

function srgbChannelToLinear(v) {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  return (
    0.2126 * srgbChannelToLinear(rgb[0]) +
    0.7152 * srgbChannelToLinear(rgb[1]) +
    0.0722 * srgbChannelToLinear(rgb[2])
  );
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hslTripletToRgb(value) {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

function hexToRgb(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** oklch(L C h) with L in 0..1 or percent — the shadcn v4 donors' spelling. */
function oklchToRgb(value) {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)%?\s+([\d.]+)(?:deg)?\s*\)$/i.exec(value.trim());
  if (!m) return null;
  let L = Number(m[1]);
  if (m[2] === '%' || L > 1) L = L / 100;
  const C = Number(m[3]);
  const hDeg = (Number(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(hDeg);
  const b = C * Math.sin(hDeg);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const mm = m_ ** 3;
  const s = s_ ** 3;
  let r = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  let b2 = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const gamma = (v) => {
    v = Math.max(0, Math.min(1, v));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  };
  return [gamma(r), gamma(g), gamma(b2)].map((v) => Math.round(v * 255));
}

/** Expand a 3-digit hex to 6 so hexToRgb can read donor shorthand defaults. */
function normalizeHex6(value) {
  const v = String(value || '').trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return `#${m[1]}`;
  const s = /^#([0-9a-f]{3})$/i.exec(v);
  if (s) return `#${s[1].split('').map((c) => c + c).join('')}`;
  return v;
}

function parseColorValue(value, declarations, depth = 0) {
  if (depth > 4 || typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  // color-mix and friends are refused: a mis-guessed component would be a
  // fabricated pair, and the audit's job is to measure what is declared.
  if (/^(color-mix|rgb|hsl)\(/i.test(v) && !/^hsl\(/i.test(v)) return null;
  const direct = hexToRgb(v) || hslTripletToRgb(v) || oklchToRgb(v);
  if (direct) return direct;
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(v);
  if (ref) {
    const decl = declarations.find(([name]) => name === ref[1]);
    return decl ? parseColorValue(decl[1], declarations, depth + 1) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// scope extraction — :root / .dark / [data-wss-theme] blocks at any depth
// ---------------------------------------------------------------------------

const SCOPE_SELECTOR_RE = /(^|[\s,>+~])(:root(?![\w-])|\.dark(?![\w-])|\.light(?![\w-])|\[data-wss-theme=["']?(?:light|dark)["']?\])/;

/** Brace-match the body of the rule whose selector text ends at `openIndex`. */
function ruleBodyAt(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(openIndex + 1, i);
    }
  }
  return null;
}

function modeScopes(css) {
  const scopes = [];
  const re = /([^{}]{0,120}?)\{/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    const selectorText = match[1];
    if (!SCOPE_SELECTOR_RE.test(selectorText)) continue;
    // A scope block contains custom-property declarations; a rule that merely
    // USES var() with no declarations is not a token scope.
    const body = ruleBodyAt(css, re.lastIndex - 1);
    if (body === null) {
      re.lastIndex = match.index + selectorText.length;
      continue;
    }
    if (/--[a-z0-9-]+\s*:/i.test(body)) {
      scopes.push({ selector: selectorText.trim().slice(0, 60), body });
    }
  }
  return scopes;
}

function tokenDeclarations(body) {
  return [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)]
    .map((m) => [m[1], m[2].trim()]);
}

// The declared text/background pairs every mode scope is measured on. The
// second element is the surface the ink is declared to sit on.
const TOKEN_PAIRS = [
  ['foreground', 'background', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['primary-foreground', 'primary', 4.5],
];

function scopeMode(selectorText) {
  if (/\.dark|data-wss-theme=["']?dark/.test(selectorText)) return 'dark';
  if (/\.light|data-wss-theme=["']?light/.test(selectorText)) return 'light';
  return 'root (light default)';
}

// ---------------------------------------------------------------------------
// part 1 — the polish floor manifest
// ---------------------------------------------------------------------------

function checkPolishFloor(fleetPolish, failures) {
  const manifest = fleetPolish.contrastPairManifest();
  const css = fleetPolish.contrastFloorCss();
  const lines = [];

  lines.push(`polish floor: ${manifest.length} declared pairs (fleet-polish.js contrastPairManifest)`);
  for (const pair of manifest) {
    const fg = hexToRgb(pair.fg);
    const bg = hexToRgb(pair.bg);
    if (!fg || !bg) {
      failures.push(`manifest pair ${pair.mode}/${pair.role}: unparseable colour (${pair.fg} on ${pair.bg})`);
      lines.push(`  FAIL ${pair.mode.padEnd(5)} ${pair.role.padEnd(26)} unparseable colour`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const pass = ratio >= pair.minimum;
    if (!pass) {
      failures.push(
        `polish floor ${pair.mode}/${pair.role}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1, below AA ${pair.minimum}:1`
      );
    }
    lines.push(
      `  ${pass ? 'pass' : 'FAIL'} ${pair.mode.padEnd(5)} ${pair.role.padEnd(26)} ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1 (min ${pair.minimum})`
    );
    // Drift guard: the manifest ink must actually ship in the emitted CSS.
    if (!css.toLowerCase().includes(pair.fg.toLowerCase())) {
      failures.push(
        `manifest ink ${pair.fg} (${pair.mode}/${pair.role}) is missing from contrastFloorCss() output — the manifest and the stylesheet have drifted`
      );
      lines.push(`  FAIL ${pair.mode.padEnd(5)} ${pair.role.padEnd(26)} ink missing from emitted CSS`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// part 2a — the token values that actually SHIP (the engine theme pass)
// ---------------------------------------------------------------------------

/*
 * Every mirror's shadcn tokens are RE-DECLARED per mode by the theme pass
 * (lib/mirror-engine/theme.js themeCss) before a site serves, so a raw donor
 * stylesheet token is superseded, not shipped. What serves is a buildPalette
 * product: the client's own logo colour when one was sampled, else the
 * researched vertical palette — either way every readable role is walked to
 * its contrast target by finish(). This gate runs that exact derivation for
 * every vertical in both modes, plus a sweep of hard brand accents (the light
 * golds and bright ambers history showed shipping washed text), and fails if
 * any shipped palette has a contrast failure. A raw-token scan follows as a
 * report, for the record.
 */
function checkThemePalettes(theme, failures) {
  const lines = ['shipped token palettes: theme.js buildPalette products (every readable role at 4.5:1)'];
  const verticals = Object.keys(theme.VERTICAL_PALETTES);
  const hardAccents = [
    '', '#E8A530', '#F6CE55', '#D66B38', '#C1272D', '#0B5CAB',
    '#2E633C', '#7B3F71', '#23665F', '#404A57', '#B5A642', '#FF8C00',
  ];
  let checked = 0;
  for (const vertical of verticals) {
    for (const mode of ['light', 'dark']) {
      for (const accent of hardAccents) {
        let palette;
        try {
          palette = theme.buildPalette({ vertical, mode, accent: accent || undefined });
        } catch (error) {
          failures.push(`theme palette ${vertical}/${mode}${accent ? ' accent ' + accent : ''}: threw ${error.message}`);
          continue;
        }
        checked += 1;
        if (!palette.passes) {
          failures.push(
            `shipped theme palette ${vertical}/${mode}${accent ? ' accent ' + accent : ''} fails AA: ${palette.contrastFailures.join(', ')}`
          );
          lines.push(
            `  FAIL ${vertical.padEnd(12)} ${mode.padEnd(5)} ${accent || '(brand none)'} -> ${palette.contrastFailures.join(', ')}`
          );
        }
      }
    }
  }
  lines.push(`  measured ${checked} shipped palettes (${verticals.length} verticals x 2 modes x ${hardAccents.length} accents)`);
  return lines;
}

// ---------------------------------------------------------------------------
// part 2b — raw donors-clean tokens, for the record
// ---------------------------------------------------------------------------

function reportDonorTokens(donorsRoot, failures) {
  const lines = ['raw donor tokens (report only — the theme pass re-declares every one of these per mode at build):'];
  let scopesChecked = 0;
  let supersededFails = 0;

  let donors;
  try {
    donors = fs.readdirSync(donorsRoot).filter((d) =>
      fs.statSync(path.join(donorsRoot, d)).isDirectory()
    );
  } catch (error) {
    failures.push(`cannot read donors root ${donorsRoot}: ${error.message}`);
    return lines;
  }

  for (const donor of donors) {
    const assetsDir = path.join(donorsRoot, donor, 'assets');
    let styles;
    try {
      styles = fs.existsSync(assetsDir)
        ? fs.readdirSync(assetsDir).filter((f) => /\.css$/i.test(f))
        : [];
    } catch {
      continue;
    }
    for (const file of styles) {
      let css;
      try {
        css = fs.readFileSync(path.join(assetsDir, file), 'utf8');
      } catch {
        continue;
      }
      // Global declarations (last wins) back var() chains that cross scopes.
      const globalDecls = tokenDeclarations(css);
      for (const scope of modeScopes(css)) {
        const decls = [
          ...globalDecls,
          ...tokenDeclarations(scope.body),
        ];
        const token = (name) => {
          const local = [...tokenDeclarations(scope.body)].reverse().find(([n]) => n === name);
          if (local) return local[1];
          const global = [...globalDecls].reverse().find(([n]) => n === name);
          return global ? global[1] : null;
        };
        const mode = scopeMode(scope.selector);
        for (const [inkName, surfaceName, minimum] of TOKEN_PAIRS) {
          const inkValue = token(`--${inkName}`);
          const surfaceValue = token(`--${surfaceName}`);
          if (!inkValue || !surfaceValue) continue;
          const ink = parseColorValue(inkValue, decls);
          const surface = parseColorValue(surfaceValue, decls);
          if (!ink || !surface) continue; // unresolvable (color-mix, chain gap): not a declared measurable pair here
          scopesChecked += 1;
          const ratio = contrastRatio(ink, surface);
          if (ratio < minimum) {
            supersededFails += 1;
            lines.push(
              `  note ${donor.padEnd(26)} ${mode.padEnd(5)} --${inkName} on --${surfaceName} = ${ratio.toFixed(2)}:1 (superseded at build)`
            );
          }
        }
      }
    }
  }
  lines.push(
    `  scanned ${scopesChecked} resolvable scope pairs across ${donors.length} donors; ${supersededFails} raw pair(s) below AA, all re-declared per mode by themeCss before serving`
  );
  if (scopesChecked === 0) {
    failures.push('template token scan resolved zero scope pairs — the parser is not matching any donor stylesheet');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// part 3 — the hero-region pairs every shipped build paints (the Class B guard)
// ---------------------------------------------------------------------------

/*
 * FINAL QA CLASS B (2026-09-04): the light-theme "wash" — hero H1 white on
 * the themed near-white hero (1.12-1.61:1 measured), CTA pills and stat
 * numerals ghost-white (1.02-1.50:1) — shipped THROUGH a green token gate,
 * because the gate only measured the palette's declared roles, never the
 * pairs the hero region actually paints. This section measures those pairs:
 * for every donors-clean donor that ships the --wss-* token family, in BOTH
 * modes, resolve the themed inks against the surfaces the hero-region
 * elements really render on:
 *
 *   hero-ink-on-slab         --wss-text      vs --wss-slab       (hero words on the themed slab band)
 *   hero-ink-on-cards        --wss-text      vs --wss-surface-alt (hero words on cards/alt bands)
 *   cta-ink-on-accent        --wss-accent-ink vs --wss-accent    (primary CTA label on the accent fill)
 *   cta-ink-on-slab-variant  --wss-slab-ink  vs --wss-slab       (slab-block CTA treatment)
 *   stat-ink-on-cards        --wss-accent-text vs --wss-surface-alt (accent-as-text: stat numerals, hovers)
 *   stat-ink-on-paper        --wss-accent-text vs --wss-surface  (accent-as-text links on the paper)
 *
 * A regression anywhere in the ink machinery that lets a hero-region pair
 * below 4.5:1 ship now fails CI here, before a mirror ever renders.
 */
const HERO_REGION_MINIMUM = 4.5;

function heroRegionPairs(palette) {
  return [
    ['hero-ink-on-slab', palette.text, palette.slab],
    ['hero-ink-on-cards', palette.text, palette.surfaceAlt],
    ['cta-ink-on-accent', palette.accentInk, palette.accent],
    ['cta-ink-on-slab-variant', palette.slabInk, palette.slab],
    ['stat-ink-on-cards', palette.accentText, palette.surfaceAlt],
    ['stat-ink-on-paper', palette.accentText, palette.surface],
  ];
}

function checkHeroRegion(theme, donorsRoot, failures) {
  const lines = [`hero region (Class B guard): themed inks vs each hero surface, both modes, bar ${HERO_REGION_MINIMUM}:1`];
  let donors;
  try {
    donors = fs.readdirSync(donorsRoot).filter((d) =>
      fs.statSync(path.join(donorsRoot, d)).isDirectory()
    );
  } catch (error) {
    failures.push(`cannot read donors root ${donorsRoot}: ${error.message}`);
    return lines;
  }
  let checked = 0;
  for (const donor of donors) {
    const donorDir = path.join(donorsRoot, donor);
    let vertical = '';
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(donorDir, 'BOILERPLATE.json'), 'utf8'));
      vertical = String(manifest.vertical || '');
    } catch { /* vertical fallback inside buildPalette */ }
    const assetsDir = path.join(donorDir, 'assets');
    let donorCss = '';
    try {
      const styles = fs.existsSync(assetsDir)
        ? fs.readdirSync(assetsDir).filter((f) => /\.css$/i.test(f))
        : [];
      for (const f of styles) {
        const text = fs.readFileSync(path.join(assetsDir, f), 'utf8');
        if (/(^|[^a-z-])--wss-slab\s*:/i.test(text)) { donorCss = text; break; }
      }
    } catch { continue; }
    if (!donorCss) continue;
    const accent = (/(^|[^a-z-])--wss-accent\s*:\s*(#[0-9a-fA-F]{3,6})/i.exec(donorCss) || [])[2] || '';
    for (const mode of ['light', 'dark']) {
      let palette;
      try {
        palette = theme.buildPalette({ vertical, mode, accent: accent || undefined });
      } catch (error) {
        failures.push(`hero region ${donor}/${mode}: buildPalette threw ${error.message}`);
        continue;
      }
      for (const [role, fg, bg] of heroRegionPairs(palette)) {
        const ratio = contrastRatio(hexToRgb(normalizeHex6(fg)), hexToRgb(normalizeHex6(bg)));
        checked += 1;
        const pass = ratio >= HERO_REGION_MINIMUM;
        if (!pass) {
          failures.push(
            `hero region ${donor}/${mode} ${role}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1, below AA ${HERO_REGION_MINIMUM}:1`
          );
        }
        lines.push(
          `  ${pass ? 'pass' : 'FAIL'} ${donor.padEnd(30)} ${mode.padEnd(5)} ${role.padEnd(24)} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`
        );
      }
    }
    // THE DONOR ACCENT-ROLE SWAP must fire for the clean-convention donors —
    // the pass that remaps the donors' -ink (accent-as-text) and -text
    // (ink-on-accent) color spends to the proven values. Assert on the worst
    // offender the QA measured: the stat numerals and the primary button of
    // the fencing donor must be remapped in the emitted sheet.
    const inkDefault = (/(^|[^a-z-])--wss-accent-ink\s*:\s*(#[0-9a-fA-F]{3,6})/i.exec(donorCss) || [])[2] || '';
    const textDefault = (/(^|[^a-z-])--wss-accent-text\s*:\s*(#[0-9a-fA-F]{3,6})/i.exec(donorCss) || [])[2] || '';
    const cleanConvention = inkDefault && textDefault
      && relativeLuminance(hexToRgb(normalizeHex6(inkDefault))) <= 0.35
      && relativeLuminance(hexToRgb(normalizeHex6(textDefault))) >= 0.85;
    if (!cleanConvention || !accent) continue;
    const palette = theme.buildPalette({ vertical, mode: 'light', accent });
    const sheet = theme.themeCss({ palette, donorCss });
    const ruleFor = (selector) => {
      for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1].split(',').map((s) => s.trim());
        if (sels.includes(selector)) return m[2];
      }
      return null;
    };
    for (const [selector, expectedColor] of [
      ['.stat b', 'color:var(--wss-accent-text)'],
      ['.btn-primary', 'color:var(--wss-accent-ink)'],
    ]) {
      const body = ruleFor(selector);
      if (!body || !body.includes(expectedColor)) {
        failures.push(
          `hero region ${donor}: the accent-role swap did not remap ${selector} to ${expectedColor} in the emitted theme sheet`
        );
        lines.push(`  FAIL ${donor.padEnd(30)} swap   ${selector} -> ${expectedColor} (got: ${body || 'no rule'})`);
      } else {
        lines.push(`  pass ${donor.padEnd(30)} swap   ${selector} -> ${expectedColor}`);
      }
    }
  }
  lines.push(`  measured ${checked} hero-region pairs across ${donors.length} donors x 2 modes`);
  if (checked === 0) {
    failures.push('hero region scan resolved zero pairs — the parser is not matching any donor stylesheet');
  }
  return lines;
}

// ---------------------------------------------------------------------------

function main() {
  const fleetPolish = require('../lib/mirror-engine/fleet-polish');
  let theme;
  try {
    theme = require('../lib/mirror-engine/theme');
  } catch (error) {
    console.error(`check:contrast cannot load the theme pass: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const failures = [];

  const floorLines = checkPolishFloor(fleetPolish, failures);
  const donorsRoot = path.join(__dirname, '..', 'donors-clean');
  const paletteLines = checkThemePalettes(theme, failures);
  const tokenLines = reportDonorTokens(donorsRoot, failures);
  const heroLines = checkHeroRegion(theme, donorsRoot, failures);

  // DRIFT GUARD (Class B, 2026-09-04): the light-mode floor must never again
  // ship a bare white hero ink — the white guard over the themed near-white
  // hero surfaces measured 1.12-1.61:1 across the fencing and HVAC mirrors.
  const floorCss = fleetPolish.contrastFloorCss();
  const floorNoComments = floorCss.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/color:\s*#ffffff/i.test(floorNoComments)) {
    failures.push(
      'polish floor: a bare white ink ships in contrastFloorCss() — the light-theme wash guard is back'
    );
  }

  for (const line of [...floorLines, ...paletteLines, ...tokenLines, ...heroLines]) console.log(line);

  if (failures.length) {
    console.log(`\ncheck:contrast — ${failures.length} AA failure(s):`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\ncheck:contrast — every declared text/background pair clears its WCAG AA bar.');
  }
}

main();
