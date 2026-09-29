"use strict";

/**
 * lib/mirror-engine/theme.js — LIGHT IS THE DEFAULT, and the light is THEIRS.
 *
 * OWNER, 2026-08-11, watching the emails land:
 *   "all the sites are still dark background, they are not on white, especially
 *    since eighty or ninety percent of the clients we are mirroring have white
 *    backgrounds... right now everything is just dark with the blurry animation
 *    moving through the background versus it being on smooth white."
 *
 * HE WAS RIGHT, AND THE NUMBER WAS RIGHT. Measured on 2026-08-11 by rendering
 * 45 prospects' own websites and 45 of our live mirrors of them
 * (scripts/measure-fleet-surfaces.js, artifacts/fleet-surfaces.json):
 *
 *     client sites, content surface LIGHT      40 / 42   (95.2%)
 *     client sites, content surface DARK        1 / 42
 *     our mirrors, first screenful DARK        45 / 45   (100%)
 *
 * So light is not a preference here, it is what the fleet actually looks like.
 *
 * WHERE THE DARK COMES FROM (traced on the live hvac-premier mirrors with
 * scripts/trace-dark-surfaces.js — it is NOT `--background`, which is already
 * `210 20% 99%` and renders body as rgb(252,252,253)):
 *
 *   · the hero, and three more full-bleed bands, are Tailwind ARBITRARY VALUES
 *     baked into the markup — `bg-[hsl(215_65%_8%)]`, `_9%`, `_7%`, `_12%`;
 *   · the CTA band and the footer are `bg-primary`, and `--primary` is
 *     `215 60% 16%` — a near-black navy;
 *   · the blurry motion is `.aurora` / `.aurora-soft` / `--gradient-mesh`,
 *     hardcoded to the DONOR's orange and blue, not the client's colour.
 *
 * Band-by-band, the live page is a light page wearing four dark slabs — and
 * the first 1100 pixels, which is the whole of the outreach email's thumbnail
 * and the whole of a visitor's first screenful, is 100% dark.
 *
 * THIS IS AN ENGINE FIX, NOT A DONOR FIX, and the trace is what proves it.
 * Every colour inside those dark slabs resolves from ONE token at varying
 * alpha: text at `hsl(var(--primary-foreground) / .85 | .75 | .6 | .55 | .45)`,
 * hairline borders at `/ .15 | .1`, glass fills at `/ .05 | .03`. They are
 * computed from the variable, not baked — verified in the donor stylesheet. So
 * repointing the slab surfaces and flipping the one ink token flips the whole
 * design coherently, without touching a single donor file.
 *
 * TRUTH LAW APPLIES TO COLOUR TOO. The accent is the client's own, measured
 * from their own logo (lib/logo-palette.js, ownership-bound and sha256-pinned
 * upstream in brand-assets.js). It is never darkened to make a button pass
 * contrast — the button's TEXT changes instead, which is what a designer does
 * and what keeps their orange orange. Only when nothing can be sampled safely
 * do we fall back to the researched per-vertical palettes in
 * docs/design-board/light-mode-palettes.md, and the report says which happened.
 */

// ---------------------------------------------------------------------------
// colour maths — pure, no IO, unit-testable
// ---------------------------------------------------------------------------

function normalizeHex(value) {
  const raw = String(value == null ? "" : value).trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#?([0-9a-f]{6})$/i.exec(raw);
  return long ? `#${long[1].toUpperCase()}` : "";
}

function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  const int = parseInt(h.slice(1), 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** WCAG 2.1 relative luminance. */
function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

/** WCAG contrast ratio, 1..21. */
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return 0;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex({ h, s, l }) {
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  return rgbToHex({ r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 });
}

/** "H S% L%" — the triplet form every shadcn donor stores in its variables. */
function hslTriplet(hex) {
  const hsl = hexToHsl(hex);
  return hsl ? `${hsl.h} ${hsl.s}% ${hsl.l}%` : "";
}

const withLightness = (hex, l) => {
  const hsl = hexToHsl(hex);
  return hsl ? hslToHex({ ...hsl, l }) : hex;
};

// ---------------------------------------------------------------------------
// contrast enforcement
// ---------------------------------------------------------------------------

/**
 * Walk a colour's LIGHTNESS until it clears `target` against `against`,
 * keeping its hue and saturation — so an ink derived from a client's teal stays
 * recognisably teal instead of collapsing to black.
 *
 * `direction` is "darker" for ink on a light surface, "lighter" for the
 * reverse. Returns the first lightness that passes, or the endpoint if even
 * pure black/white cannot (which cannot happen against a real surface, but is
 * handled rather than assumed).
 */
function enforceContrast(hex, against, target = 4.5, direction = "darker") {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  if (contrastRatio(hex, against) >= target) return hex;
  const step = direction === "darker" ? -2 : 2;
  let l = hsl.l;
  for (let i = 0; i < 50; i++) {
    l += step;
    if (l < 0 || l > 100) break;
    const candidate = hslToHex({ ...hsl, l });
    if (contrastRatio(candidate, against) >= target) return candidate;
  }
  return direction === "darker" ? "#000000" : "#FFFFFF";
}

/**
 * The text colour a coloured button must wear.
 *
 * The donors all hardcode `--accent-foreground: 0 0% 100%` — white. On a
 * client whose brand is a light gold or a bright amber that is 1.8:1 and
 * illegible. Rather than darken THEIR colour (which would stop it being their
 * colour), pick the ink: near-white or near-black, whichever the accent
 * actually carries, nudged until it clears 4.5:1.
 */
function readableInkOn(surface, { light = "#FFFFFF", dark = "#0B0B0C" } = {}) {
  const onLight = contrastRatio(light, surface);
  const onDark = contrastRatio(dark, surface);
  const pick = onLight >= onDark ? light : dark;
  if (contrastRatio(pick, surface) >= 4.5) return pick;
  return enforceContrast(pick, surface, 4.5, pick === light ? "lighter" : "darker");
}

// ---------------------------------------------------------------------------
// the researched fallback — docs/design-board/light-mode-palettes.md
// ---------------------------------------------------------------------------

/**
 * The ⭐ recommended palette per vertical, transcribed from
 * docs/design-board/light-mode-palettes.md (owner-commissioned research,
 * 2026-08-11). Every one of these clears 4.5:1 for body AND muted text, with
 * the ratios computed in that document rather than estimated.
 *
 * THIS IS A FALLBACK, NOT A DEFAULT. It is reached only when the client's own
 * logo yields no usable chromatic colour — a greyscale mark, an unmeasurable
 * raster, or a colour too near-neutral to build a palette from. When it is
 * used, `palette.source` says so, so a report never implies we sampled a brand
 * we did not.
 */
const VERTICAL_PALETTES = Object.freeze({
  hvac: { name: "Arctic Trust", bg: "#F7FAFC", surface: "#FFFFFF", text: "#14213D", muted: "#5C667A", accent: "#0B5CAB", hover: "#084A8A", border: "#DCE3EA" },
  plumbing: { name: "Clean Water Blue", bg: "#F7FAFD", surface: "#FFFFFF", text: "#16253A", muted: "#5F6C7C", accent: "#0C5EA8", hover: "#084A85", border: "#D9E4EF" },
  roofing: { name: "Slate Authority", bg: "#F7F8FA", surface: "#FFFFFF", text: "#202833", muted: "#69717E", accent: "#334155", hover: "#273444", border: "#DDE1E6" },
  electrical: { name: "Circuit Blue", bg: "#F8FAFC", surface: "#FFFFFF", text: "#172033", muted: "#626B7A", accent: "#2453A6", hover: "#1C4183", border: "#DDE3EA" },
  landscaping: { name: "Fresh Evergreen", bg: "#F7FAF6", surface: "#FFFFFF", text: "#1E2B22", muted: "#657168", accent: "#2E633C", hover: "#234D2E", border: "#DCE6DD" },
  concrete: { name: "Architectural Charcoal", bg: "#F7F8F9", surface: "#FFFFFF", text: "#23272D", muted: "#6A7078", accent: "#404A57", hover: "#313A45", border: "#DDE1E5" },
  salon: { name: "Modern Plum", bg: "#FCF8FB", surface: "#FFFFFF", text: "#2B2130", muted: "#756A79", accent: "#7B3F71", hover: "#613258", border: "#E8DDE6" },
  nails: { name: "Berry Clean", bg: "#FCF8FA", surface: "#FFFFFF", text: "#2F2028", muted: "#786A71", accent: "#8A365F", hover: "#6C2A4A", border: "#EADDE4" },
  medspa: { name: "Clinical Teal", bg: "#F6FBFA", surface: "#FFFFFF", text: "#1E2A2B", muted: "#657273", accent: "#23665F", hover: "#1B514B", border: "#D8E6E3" },
  tattoo: { name: "Oxblood Studio", bg: "#FBF8F7", surface: "#FFFFFF", text: "#2A2221", muted: "#706865", accent: "#743B32", hover: "#5B2E27", border: "#E6DEDB" },
});

// Donor/vertical names as they actually arrive, mapped to the palette keys.
const VERTICAL_ALIASES = Object.freeze({
  hvac: "hvac", "heating": "hvac", "air conditioning": "hvac", "heating and air": "hvac",
  plumbing: "plumbing", plumber: "plumbing", drain: "plumbing",
  roofing: "roofing", roofer: "roofing",
  electrical: "electrical", electrician: "electrical",
  landscaping: "landscaping", landscape: "landscaping", lawn: "landscaping",
  concrete: "concrete", masonry: "concrete", fencing: "concrete", fence: "concrete",
  salon: "salon", hair: "salon", barber: "salon",
  nails: "nails", nail: "nails",
  medspa: "medspa", "med spa": "medspa", spa: "medspa", aesthetics: "medspa",
  tattoo: "tattoo",
});

function fallbackPalette(vertical) {
  const key = String(vertical || "").toLowerCase().trim();
  const direct = VERTICAL_PALETTES[key];
  if (direct) return { ...direct, vertical: key };
  for (const [alias, target] of Object.entries(VERTICAL_ALIASES)) {
    if (key.includes(alias)) return { ...VERTICAL_PALETTES[target], vertical: target };
  }
  // No vertical match: the plainest high-contrast neutral in the research set.
  return { ...VERTICAL_PALETTES.concrete, vertical: "generic" };
}

// ---------------------------------------------------------------------------
// brand_identity — the extraction lane's direct verdict (lib/brand-extractor.js)
// ---------------------------------------------------------------------------

/**
 * BRAND_IDENTITY IS AN OVERRIDE, NOT A FALLBACK, and the direction matters.
 *
 * Everything upstream of this point answers "what colour is THIS client?" by
 * measuring their logo (lib/logo-palette.js) or by falling back to the
 * researched per-vertical palettes above. brand_identity is the extraction
 * lane answering the same question from the client's OWN website CSS, already
 * reduced to hexes and a self-assessed confidence. When it arrives with HIGH
 * or MEDIUM confidence it outranks the donor's default palette: the accent
 * flows into the donor's own custom properties (--accent, --accent-ink, …)
 * through the appended override sheet, so the donor's LAYOUT is untouched and
 * only the COLOURS change. No donor gold when the client is red.
 *
 * LOW IS REFUSED, NOT DOWNGRADED. A verdict the extractor itself does not
 * trust must not steer a page; refusing it here means the build takes the
 * neutral path (donor defaults, then logo measurement, then vertical
 * research) exactly as if brand_identity had never been supplied. The refusal
 * reason is returned, so the theme report always says which happened.
 */
const BRAND_IDENTITY_CONFIDENCES = new Set(["HIGH", "MEDIUM"]);

/**
 * Normalize and gate a raw `request.brand_identity`.
 *
 * Returns `{ applied:false, reason }` for anything that must not steer the
 * palette — absent, wrong-shaped, LOW confidence, or an unusable accent — and
 * `{ applied:true, confidence, accent, secondary, background, logoUrl,
 * fontFamily, extractionMethod }` for a verdict that will. Every colour is
 * hex-normalized (3-digit forms included); the logo must be https to be
 * hot-linkable; every refusal carries a machine-readable reason for the
 * report.
 */
function normalizeBrandIdentity(raw) {
  const bi = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!bi) return { applied: false, reason: "brand_identity_absent" };
  const confidence = String(bi.confidence || "").trim().toUpperCase();
  if (!BRAND_IDENTITY_CONFIDENCES.has(confidence)) {
    return {
      applied: false,
      reason: confidence ? `brand_identity_confidence_${(confidence || "missing").toLowerCase()}_refused` : "brand_identity_confidence_missing",
      confidence,
    };
  }
  const accent = normalizeHex(bi.accent_color);
  if (!accent) {
    return { applied: false, reason: "brand_identity_accent_color_unusable", confidence };
  }
  const logoUrl = typeof bi.logo_url === "string" && bi.logo_url.trim() ? bi.logo_url.trim() : "";
  return {
    applied: true,
    reason: "brand_identity_applied",
    confidence,
    accent,
    secondary: normalizeHex(bi.secondary_color),
    background: normalizeHex(bi.background),
    // Only an https URL can reach a generated <img src>; anything else is
    // dropped here rather than shipping a mixed-content header.
    logoUrl: /^https:\/\//i.test(logoUrl) ? logoUrl : "",
    fontFamily: typeof bi.font_family === "string" ? bi.font_family.trim() : "",
    extractionMethod: String(bi.extraction_method || "").trim(),
  };
}

// THE FONT ALLOWLIST. brand_identity.font_family is honoured only when the
// family can actually be DELIVERED: a web-safe face every OS ships, or a
// Google Font we can <link> first-party. Anything else is skipped and the
// donor keeps its typography — referencing a family nobody loads is how a
// page asks for "Rubik" and receives Times New Roman with confidence.
const WEB_SAFE_FAMILIES = new Set([
  "arial", "helvetica", "verdana", "tahoma", "trebuchet ms", "segoe ui",
  "system-ui", "times new roman", "georgia", "garamond", "courier new",
  "palatino", "palatino linotype", "book antiqua", "impact", "comic sans ms",
  "lucida sans unicode", "cambria", "calibri", "candara", "consolas",
]);

const GOOGLE_FAMILIES = new Set([
  "inter", "roboto", "open sans", "lato", "montserrat", "poppins", "oswald",
  "raleway", "nunito", "nunito sans", "work sans", "rubik", "outfit", "dm sans",
  "manrope", "mulish", "karla", "barlow", "public sans", "source sans 3",
  "source sans pro", "pt sans", "ubuntu", "fira sans", "jetbrains mono",
  "playfair display", "merriweather", "libre baskerville", "lora", "crimson text",
  "cormorant garamond", "eb garamond", "cinzel", "bebas neue", "anton",
  "archivo", "archivo black", "space grotesk", "sora", "urbanist", "figtree",
  "plus jakarta sans", "lexend", "quicksand", "comfortaa", "josefin sans",
  "exo 2", "titillium web", "cabin", "heebo", "asap", "catamaran",
]);

/**
 * The first family of a `font_family` value, unquoted and trimmed —
 * `"Playfair Display", serif` is a request to display in Playfair Display.
 */
function leadFontFamily(value) {
  const first = String(value || "").split(",")[0].trim().replace(/^["']+|["']+$/g, "").trim();
  return first;
}

/**
 * brandIdentityFont(family) — the display-font verdict.
 *
 * Returns `{ family, provider }` when the family is deliverable (provider
 * "google" means the caller should also inject the fonts.googleapis.com
 * stylesheet link; "web-safe" needs no link), or null when it is not — in
 * which case the donor's typography stands and nothing is downloaded.
 */
function brandIdentityFont(family) {
  const name = leadFontFamily(family);
  if (!name || name.length > 60) return null;
  const key = name.toLowerCase();
  if (WEB_SAFE_FAMILIES.has(key)) return { family: name, provider: "web-safe" };
  if (GOOGLE_FAMILIES.has(key)) return { family: name, provider: "google" };
  return null;
}

/** The first-party Google Fonts stylesheet for a known family. */
function googleFontsHref(family) {
  const name = leadFontFamily(family);
  if (!name) return "";
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
}

// ---------------------------------------------------------------------------
// site_palette — the WHOLE-WEBSITE palette (lib/mirror-engine/site-palette.js)
// ---------------------------------------------------------------------------

/**
 * Normalize and gate a raw `request.site_palette`.
 *
 * THE OWNER'S DIRECTIVE (2026-09-03): "we want to take THEIR SITE colors not
 * just their LOGO colors." The logo stays an input — accent corroboration —
 * but the page surfaces, the ink and the dark-band rhythm come from the
 * prospect's own homepage, measured by the site-palette harvester off the
 * HTML stage 2 already fetched. This gate mirrors normalizeBrandIdentity:
 * `{ applied:false, reason }` for anything that must not steer the palette
 * (absent, wrong-shaped, no usable colour at all), and a normalized verdict
 * otherwise. A refusal here is not a build refusal — it is absence, and the
 * palette falls through the logo → donor → vertical chain exactly as before
 * (thin-flow law: the site palette adds a source, never a gate).
 */
function normalizeSitePalette(raw) {
  const sp = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!sp) return { applied: false, reason: "site_palette_absent" };
  const surface = normalizeHex(sp.surface || "");
  const ink = normalizeHex(sp.ink || "");
  const link = normalizeHex(sp.link || "");
  const accent = normalizeHex(sp.accent || "");
  if (!surface && !ink && !accent) {
    return { applied: false, reason: "site_palette_no_usable_color" };
  }
  const darkSectionCount = Number(sp.dark_section_count ?? sp.darkSectionCount);
  return {
    applied: true,
    reason: "site_palette_applied",
    surface: surface || null,
    ink: ink || null,
    link: link || null,
    accent: accent || null,
    mode: sp.mode === "dark" ? "dark" : "light",
    // Both spellings accepted: the request schema's snake_case and the
    // harvester's own camelCase, so normalize(extractSitePalette(...)) is as
    // valid as normalize(request.site_palette).
    hasDarkSlabs: sp.has_dark_slabs === true || sp.hasDarkSlabs === true
      || (Number.isFinite(darkSectionCount) && darkSectionCount > 0),
    darkSectionCount: Number.isFinite(darkSectionCount) ? Math.max(0, Math.trunc(darkSectionCount)) : 0,
    lightSectionCount: Math.max(0, Math.trunc(Number(sp.light_section_count ?? sp.lightSectionCount) || 0)),
    extractionMethod: String(sp.extraction_method ?? sp.extractionMethod ?? "").trim(),
  };
}

/**
 * The header-logo constraint sheet for a brand_identity logo_url.
 *
 * The donor's header renders `{{LOGO_URL}}` inside a small round avatar slot
 * (`h-12 w-12 rounded-full object-cover` on fencing) — built for a square
 * badge, and a wide wordmark cropped into it ships as letter-salad (the exact
 * failure logoFitCss already cures for fetched bytes). A hot-linked
 * brand_identity mark gets the same cure, keyed on its host so no other image
 * is touched, and carries an explicit MOBILE step — the constraint must hold
 * on every breakpoint, including the 375px header where a 13rem wordmark is
 * half the screen. Alt text comes from the hydrated business name, which the
 * donors already place on the logo img.
 */
function brandIdentityLogoCss(url) {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return "";
  }
  if (!host) return "";
  // Hosts cannot carry quotes, so the attribute selector is injection-safe.
  const sel = `img[src*="${host}"]`;
  return [
    `/* wss-brand-identity-logo: the extraction lane's mark, contained on every breakpoint. */`,
    `${sel}{width:auto!important;height:auto!important;max-width:min(13rem,45vw)!important;max-height:3.25rem!important;object-fit:contain!important;border-radius:0!important}`,
    `@media (max-width:640px){${sel}{max-width:min(10rem,55vw)!important;max-height:2.5rem!important}}`,
  ].join("");
}

// ---------------------------------------------------------------------------
// the decision: light or dark
// ---------------------------------------------------------------------------

/**
 * LIGHT UNLESS THE CLIENT'S OWN SITE IS GENUINELY DARK.
 *
 * `measurement` is the shape scripts/measure-fleet-surfaces.js writes for the
 * client's own current_website: { mode, brightShare, darkShare, basis }. It is
 * measured from the PAPER band — the content sections below the fold — never
 * from the hero, because almost every marketing site on earth has a dark
 * photographic hero and judging by the hero calls 20 of 42 light sites dark.
 * That mistake is documented in the measurement script; do not re-make it here.
 *
 * Absent or unusable measurement => light. That is not a guess dressed as a
 * decision: light is what 95.2% of the measured fleet is, so it is the honest
 * prior, and `why` records that we defaulted rather than measured.
 *
 * THE EXCEPTION IS DONOR-NATIVE CANVASES, AND EACH NAME HERE IS EARNED.
 * plumbing-clean (2026-08-13) and fencing-sterling (2026-09-01) ship COMPILED
 * DARK designs — fencing's own tokens are `--background: 30 10% 8%` with a
 * gold `text-gradient` hero ink that only reads on dark. Light-by-default
 * flipped the FIRST-EVER factory fencing mirror to a light canvas the owner
 * graded "looks better dark" with a washed-out hero. "Keep each donor's
 * default" means the default the DONOR was designed in, and a client whose
 * own site measurably IS strongly light still wins (the escape hatch below is
 * unchanged, for every donor on this list).
 */
const CINEMATIC_DARK_DONORS = new Set(["plumbing-clean", "fencing-sterling"]);

function decideMode(measurement, options = {}) {
  // BRAND_IDENTITY BACKGROUNDS DECIDE FIRST, when they decide at all. The
  // extraction lane's `background` is a direct reading of the canvas the
  // client's brand lives on — stronger evidence than either the donor's
  // cinematic-dark default or the fleet prior. Light shifts the theme to
  // light (the fencing-sterling case: a light-background client is not asked
  // to wear a compiled-dark donor); dark keeps dark. Unparseable input falls
  // through to the evidence chain below untouched.
  const biBg = normalizeHex(options.brandIdentityBackground || "");
  if (biBg) {
    const lum = relativeLuminance(biBg);
    if (lum >= 0.4) return { mode: "light", why: `brand_identity_background_light(lum=${lum.toFixed(2)})`, measured: false };
    return { mode: "dark", why: `brand_identity_background_dark(lum=${lum.toFixed(2)})`, measured: false };
  }
  // THE SITE PALETTE'S CANVAS decides on exactly the same terms — it is the
  // same reading from the same page, carried by the site-palette lane when
  // the confidence-gated brand_identity verdict did not ship a background.
  // The owner's whole-site directive: a genuinely dark-navy original keeps a
  // dark mirror, a warm-cream original keeps light; the logo no longer
  // decides the canvas on its own.
  const spBg = normalizeHex(options.sitePaletteBackground || "");
  if (spBg) {
    const lum = relativeLuminance(spBg);
    if (lum >= 0.4) return { mode: "light", why: `site_palette_canvas_light(lum=${lum.toFixed(2)})`, measured: false };
    return { mode: "dark", why: `site_palette_canvas_dark(lum=${lum.toFixed(2)})`, measured: false };
  }
  const m = measurement && typeof measurement === "object" ? measurement : null;
  const donor = String(options.donor || "").toLowerCase();
  const vertical = String(options.vertical || "").toLowerCase();
  const preferCinematicDark = CINEMATIC_DARK_DONORS.has(donor) || vertical === "plumbing" && options.preferCinematicDark === true;
  if (preferCinematicDark) {
    if (!m || !m.mode || m.basis === "hero-only") return { mode: "dark", why: "cinematic_donor_default_dark_without_strong_surface_evidence", measured: false };
    const bright = Number(m.brightShare); const dark = Number(m.darkShare);
    const stronglyLight = m.mode === "light" && Number.isFinite(bright) && bright >= 0.72 && (!Number.isFinite(dark) || dark <= 0.18) && m.basis === "paper";
    if (!stronglyLight) return { mode: "dark", why: "cinematic_donor_dark_preserved_weak_or_mixed_measurement", measured: true };
    return { mode: "light", why: `client_site_strongly_measured_light(bright=${bright}, dark=${dark})`, measured: true };
  }
  if (!m || !m.mode) return { mode: "light", why: "no_measurement_default_light", measured: false };
  if (m.basis === "hero-only") return { mode: "light", why: "hero_only_measurement_is_not_evidence_of_a_dark_page", measured: false };
  if (m.mode === "dark") return { mode: "dark", why: `client_site_measured_dark(bright=${m.brightShare}, dark=${m.darkShare})`, measured: true };
  return { mode: "light", why: `client_site_measured_${m.mode}`, measured: true };
}

// ---------------------------------------------------------------------------
// the palette
// ---------------------------------------------------------------------------

const NEUTRAL_SATURATION = 8; // below this a "brand colour" is a grey

/**
 * buildPalette — the client's own colours, in the roles a page needs.
 *
 * accent  : THEIRS, untouched. The colour a customer recognises.
 * surface : near-white, carrying a whisper of their hue (4% saturation) so the
 *           page feels like theirs rather than like a default template. Never
 *           below 97% lightness — "smooth white" is the brief.
 * text    : their hue at low lightness, then pushed until it clears 7:1. Body
 *           copy gets a deliberately harder target than the 4.5:1 minimum,
 *           because 4.5 is the floor for *large* comfort and this is body copy.
 * muted   : the same hue, pushed to clear exactly 4.5:1 — secondary text is
 *           allowed to be quieter, never illegible.
 * border  : their hue, very light. Contrast is not required of a hairline.
 *
 * GRADIENT AND METALLIC BRANDS (the owner's "Platinum Plumbing" case): a mark
 * whose identity is a metallic sweep is passed through as `accentGradient` and
 * painted as a real gradient on the surfaces that can carry one, instead of
 * being flattened to the single swatch its midpoint happens to land on. The
 * flat `accent` is still computed alongside it, because borders, focus rings
 * and small text cannot use a gradient and must not be left unpainted.
 */
function buildPalette({
  accent = "",
  primary = "",
  gradient = null,
  vertical = "",
  mode = "light",
  brandIdentity = null,
  donorAccent = "",
  sitePalette = null,
} = {}) {
  const fallback = fallbackPalette(vertical);
  // BRAND_IDENTITY OVERRIDES THE INPUTS, at the front door. When the
  // extraction lane's verdict is applied its accent becomes THE accent and its
  // secondary colour becomes the primary/surface role — the same doors
  // brand.accent and brand.primary use, so every derived role downstream
  // (accentInk, accentSoft, slab, borders, gradients) follows without a
  // second code path. Its confidence was already gated by
  // normalizeBrandIdentity; LOW never reaches this parameter.
  const bi = brandIdentity && brandIdentity.applied ? brandIdentity : null;
  if (bi && bi.accent) accent = bi.accent;
  if (bi && bi.secondary) primary = bi.secondary;
  const clientAccent = normalizeHex(accent);
  const clientPrimary = normalizeHex(primary);

  // THE SITE PALETTE — the whole-website reading (owner directive
  // 2026-09-03: "we want to take THEIR SITE colors not just their LOGO
  // colors"). Where the site and the logo disagree, the SITE wins the
  // surfaces and the ink; the logo may still win the ACCENT when the site's
  // own accent is absent or too weak to steer with. brand_identity keeps the
  // front door (it is the same page read by the confidence-gated extraction
  // lane), and everything below it is the owner's stated chain:
  // site palette → logo colour → donor token → vertical research.
  const sp = sitePalette && sitePalette.applied ? sitePalette : null;
  const siteAccentHex = sp && sp.accent ? normalizeHex(sp.accent) : "";
  const siteAccentHsl = siteAccentHex ? hexToHsl(siteAccentHex) : null;
  const siteAccentUsable = !!(siteAccentHsl && siteAccentHsl.s >= NEUTRAL_SATURATION);
  const siteSurfaceHsl = sp && sp.surface ? hexToHsl(sp.surface) : null;
  const siteInkHsl = sp && sp.ink ? hexToHsl(sp.ink) : null;
  const siteSurfaceUsable = !!(siteSurfaceHsl && siteSurfaceHsl.s >= NEUTRAL_SATURATION);
  const siteInkUsable = !!(siteInkHsl && siteInkHsl.s >= NEUTRAL_SATURATION);

  const accentHsl = clientAccent ? hexToHsl(clientAccent) : null;
  // A brand_identity accent is TRUSTED AT ITS FACE even below the neutral
  // floor: the extractor asserted it is the brand colour, and refusing a
  // HIGH-confidence muted charcoal would repaint the page from research the
  // client's own site just contradicted. The saturation floor keeps guarding
  // only the logo-sampled path, where a grey is far likelier to be a mask
  // than a mark.
  //
  // THE DONOR'S OWN TOKEN IS THE SECOND FALLBACK, ahead of vertical research
  // (owner verdict, 2026-09-02 smoke: a roofing client with no harvested
  // palette shipped generic-blue accents over dead-white surfaces while the
  // donor family's own stylesheet carried a warm brick --wss-accent all
  // along). A client with no measurable colour is themed with the accent of
  // the family whose design the page wears — coherent, warm, and never a
  // blue that belongs to no customer. Same neutral floor as the logo path:
  // a donor whose token is near-grey (electrical-livewire's #111) is refused
  // here exactly as a masked logo would be.
  const donorHex = normalizeHex(donorAccent);
  const donorHsl = donorHex ? hexToHsl(donorHex) : null;
  const logoUsable = !!(accentHsl && accentHsl.s >= NEUTRAL_SATURATION);
  const donorUsable = !!(donorHsl && donorHsl.s >= NEUTRAL_SATURATION);
  const usable = (bi && clientAccent) || siteAccentUsable || logoUsable || donorUsable;

  const siteDrove = !!(sp && (siteSurfaceUsable || siteInkUsable || siteAccentUsable));
  const source = bi && clientAccent ? "brand_identity_extraction"
    : siteDrove ? "site"
    : logoUsable ? "client_logo"
    : donorUsable ? "donor_token" : "vertical_research_fallback";
  const base = (bi && clientAccent)
    ? clientAccent
    : siteAccentUsable ? siteAccentHex
      : logoUsable ? clientAccent
      : donorUsable ? donorHex
      : fallback.accent;
  const baseHsl = hexToHsl(base);

  // The hue the whole page is tinted with. THE SITE'S OWN SURFACE SPEAKS
  // FIRST — a cream site is tinted cream, a navy site navy, whatever their
  // logo happens to measure — then the site's ink (a white paper under navy
  // type still leans navy), then their second logo colour, then the accent.
  const surfaceHueSource = siteSurfaceUsable ? sp.surface
    : siteInkUsable ? sp.ink
    : clientPrimary && hexToHsl(clientPrimary)
      && hexToHsl(clientPrimary).s >= NEUTRAL_SATURATION ? clientPrimary : base;
  const tintHue = hexToHsl(surfaceHueSource).h;

  if (mode === "dark") {
    // A GENUINELY DARK CLIENT KEEPS DARK — but it is still built from their
    // colours, and it is still checked. A dark theme that fails contrast is
    // just a different way to be unreadable.
    const surface = hslToHex({ h: tintHue, s: 24, l: 8 });
    const surfaceAlt = hslToHex({ h: tintHue, s: 22, l: 12 });
    const text = enforceContrast(hslToHex({ h: tintHue, s: 12, l: 96 }), surface, 7, "lighter");
    const muted = enforceContrast(hslToHex({ h: tintHue, s: 14, l: 72 }), surface, 4.5, "lighter");
    const border = hslToHex({ h: tintHue, s: 18, l: 22 });
    return finish({
      mode, source, surface, surfaceAlt, text, muted, border,
      accent: base, accentHover: withLightness(base, Math.max(8, baseHsl.l - 8)),
      slab: surfaceAlt, tintHue, gradient, fallbackName: usable ? null : fallback.name,
      secondary: bi && bi.secondary ? bi.secondary : null,
      site: sitePaletteOf(sp, {
        surfacesFromSite: siteSurfaceUsable || siteInkUsable,
        accentFromSite: !bi && siteAccentUsable,
        accentFromLogo: !bi && !siteAccentUsable && logoUsable,
      }),
    });
  }

  // LIGHT — the default, and the case that matters for 95% of the fleet.
  // WARM NEUTRAL SURFACES (owner verdict, 2026-09-02 smoke): the light theme
  // is a CREAM family, not dead white. The paper stays a near-white tint of
  // the client's own hue; the alt surface (cards, popovers — everything the
  // donors spend `--wss-surface-alt` / `--card` on) is a warm cream of the
  // same hue rather than #FFFFFF, which is what rendered as flat dead gray
  // on the first factory smoke. Inks are re-derived and re-measured against
  // the DARKER of the two surfaces below, so the cream never costs a ratio.
  //
  // THE SITE'S OWN TINT STRENGTH BUDGETS THE WHISPER (whole-site directive):
  // a faint cream leans faintly, a definite cream leans definitely — the
  // saturation adapts to what their page actually paints, inside the brief's
  // fixed band (30..38 surface, 26..34 alt) so a saturated site can never
  // push the paper past near-white territory and "smooth white" holds.
  const surfaceSat = siteSurfaceUsable ? Math.max(30, Math.min(38, siteSurfaceHsl.s)) : 30;
  const surfaceAltSat = siteSurfaceUsable ? Math.max(26, Math.min(34, Math.round(siteSurfaceHsl.s * 0.85))) : 26;
  const surface = hslToHex({ h: tintHue, s: surfaceSat, l: 99 });
  const surfaceAlt = hslToHex({ h: tintHue, s: surfaceAltSat, l: 95 });
  const inkSurface = relativeLuminance(surfaceAlt) < relativeLuminance(surface) ? surfaceAlt : surface;
  const text = enforceContrast(hslToHex({ h: tintHue, s: 30, l: 15 }), inkSurface, 7, "darker");
  const muted = enforceContrast(hslToHex({ h: tintHue, s: 14, l: 45 }), inkSurface, 4.5, "darker");
  const border = hslToHex({ h: tintHue, s: 22, l: 89 });

  // THE SLAB. The donor's full-bleed feature bands were near-black; in light
  // mode they become the palest tint of the client's own hue, so the page still
  // has rhythm and separation without a wall of black. This is the single value
  // that turns "everything is dark" into "smooth white".
  //
  // UNLESS THE CLIENT'S OWN SITE PAINTS DARK BANDS — then flattening their
  // rhythm to a pale tint is reinventing their look, which is the exact
  // failure the whole-site directive exists to cure. A measured dark-section
  // presence leans the slab DARK in the site's own hue (the paper stays the
  // light brief; only the bands carry the original's weight), and finish()
  // derives the slab inks against what the slab actually is.
  const slab = sp && sp.hasDarkSlabs
    ? hslToHex({ h: tintHue, s: 26, l: 14 })
    : hslToHex({ h: tintHue, s: 34, l: 96 });

  return finish({
    mode, source, surface, surfaceAlt, text, muted, border,
    accent: base, accentHover: withLightness(base, Math.max(10, baseHsl.l - 10)),
    slab, tintHue, gradient, fallbackName: usable ? null : fallback.name,
    secondary: bi && bi.secondary ? bi.secondary : null,
    site: sitePaletteOf(sp, {
      surfacesFromSite: siteSurfaceUsable || siteInkUsable,
      accentFromSite: !bi && siteAccentUsable,
      accentFromLogo: !bi && !siteAccentUsable && logoUsable,
    }),
  });
}

/** The site-palette audit trail carried onto the finished palette: what was
 *  extracted, and which role it actually won. Null when no site palette was
 *  applied, so pre-site-palette palettes report nothing new. */
function sitePaletteOf(sp, { surfacesFromSite, accentFromSite, accentFromLogo }) {
  if (!sp) return null;
  return {
    surface: sp.surface || null,
    ink: sp.ink || null,
    accent: sp.accent || null,
    mode: sp.mode,
    has_dark_slabs: sp.hasDarkSlabs,
    dark_section_count: sp.darkSectionCount,
    surfaces_from_site: surfacesFromSite || false,
    accent_from_site: accentFromSite || false,
    accent_from_logo: accentFromLogo || false,
  };
}

/**
 * Fill the derived roles and MEASURE the result. Every ratio a human will read
 * text at is computed here and returned, so a caller can gate on it and a
 * report can print it. A palette that ships without these numbers is a claim,
 * not a measurement.
 */
function finish(p) {
  // THE SLAB'S INK DIRECTION FOLLOWS THE SLAB ITSELF, not the page mode. The
  // modes agree with their slabs in every pre-site-palette palette (dark mode
  // raises a dark panel, light mode washes a pale one), so this changes
  // nothing there — but a light-mode palette whose client's own site paints
  // dark bands carries a DARK slab, and deriving its ink "darker" would walk
  // toward the panel and fail where the palette can pass. Direction by
  // measured luminance keeps the same 7:1/4.5:1 gates enforced either way.
  const slabIsDark = relativeLuminance(p.slab) <= 0.35;
  const slabInk = enforceContrast(
    slabIsDark ? hslToHex({ h: p.tintHue, s: 12, l: 96 }) : hslToHex({ h: p.tintHue, s: 32, l: 16 }),
    p.slab,
    7,
    slabIsDark ? "lighter" : "darker",
  );
  const slabMuted = enforceContrast(
    hslToHex({ h: p.tintHue, s: 16, l: slabIsDark ? 72 : 42 }),
    p.slab,
    4.5,
    slabIsDark ? "lighter" : "darker",
  );
  const accentInk = readableInkOn(p.accent);
  // THE SECONDARY TOKENS, when a brand_identity secondary colour exists. The
  // fill keeps the client's true colour; the ink on it is whatever actually
  // reads — the same fill/ink split every other brand colour gets.
  const secondaryInk = p.secondary ? readableInkOn(p.secondary) : null;
  // The accent as TEXT on the page surface — a link, an eyebrow, a stat. A
  // brand colour that is beautiful as a button fill is frequently illegible as
  // 16px text, so this is a separate role rather than the same value used
  // twice.
  //
  // THE DIRECTION FOLLOWS THE SURFACE, and getting that wrong is what the test
  // caught: darkening is only a fix on a LIGHT surface. On the dark theme it
  // drove the accent toward the background instead of away from it, and six of
  // the eight sample brands shipped link text at 1.1:1 — invisible.
  //
  // PROVEN AGAINST THE ALT SURFACE, not just the page surface (Class B,
  // 2026-09-04): the clean donors spend the accent-as-text role on CARDS too
  // (stat numerals, nav hovers, ratings — all on --wss-surface-alt / --card).
  // The alt surface is the WORST case for this role in BOTH modes — in light
  // mode it is a step darker than the paper (harder for a darkened ink), in
  // dark mode a step lighter than the canvas (harder for a lightened ink) —
  // so one proof covers both surfaces. The gate measures each explicitly.
  const away = p.mode === "dark" ? "lighter" : "darker";
  const accentText = enforceContrast(p.accent, p.surfaceAlt, 4.5, away);
  // The slab follows its own surface, which in LIGHT mode is a pale tint and in
  // DARK mode is a raised panel — in both cases the accent must move away from
  // the slab, not toward it.
  // The slab follows its own surface, which in LIGHT mode is a pale tint and in
  // DARK mode is a raised panel — in both cases the accent must move away from
  // the slab, not toward it.
  const accentOnSlab = enforceContrast(p.accent, p.slab, 4.5, relativeLuminance(p.slab) > 0.4 ? "darker" : "lighter");

  // THE DONOR'S "SOFT" ACCENT — a light tint of the brand colour, and the last
  // thing on the page still failing after the slabs were flipped.
  //
  // hvac-premier declares `--accent-soft: 26 100% 62%` and spends it on every
  // 10px eyebrow (`.section-eyebrow-light`, `.text-accent-soft`) and inside the
  // gradient of `.text-gradient-warm`. At 62% lightness that is beautiful on a
  // near-black slab and measured 1.77:1 on the new pale one — in 10px type,
  // which is the worst place to lose contrast.
  //
  // It has to clear BOTH surfaces, because the same class appears on the page
  // paper and on the slabs, so it is enforced against each in turn.
  //
  // AND WITH HEADROOM — 5.5, not 4.5. Enforced at exactly 4.5 it still measured
  // 3.96:1 on the live page, because some of these eyebrows sit on a
  // translucent glass card composited over a photograph, which is a lighter
  // effective background than either flat surface we can compute here. A role
  // that lands on backgrounds we cannot enumerate needs margin, not a value
  // that is exactly at the limit for the two we can.
  //
  // TWO VALUES, TWO SURFACES (the whole-site directive). One colour cannot
  // clear 5.5:1 against BOTH a near-white paper and a dark slab — the
  // luminance bands do not overlap — so a palette whose slab genuinely is
  // dark on a light page (the site-palette lane's dark-band rhythm) splits
  // the role: the paper value (`accentSoftPaper`) serves the page, the slab
  // value (`accentSoftOnSlab`) is scoped onto the bands' custom properties by
  // themeCss. For EVERY other palette the SHIPPED token remains the exact
  // slab-chained value the pre-site-palette engine computed — byte-identical
  // sheets for unchanged inputs, verified by diffing the two implementations
  // across the accent/mode/vertical matrix.
  const SOFT_TARGET = 5.5;
  const accentSoftPaper = enforceContrast(p.accent, p.surface, SOFT_TARGET, away);
  const accentSoftOnSlab = enforceContrast(
    accentSoftPaper,
    p.slab, SOFT_TARGET, slabIsDark ? "lighter" : "darker",
  );
  const splitSoftAccent = p.mode === "light" && slabIsDark;
  const accentSoft = splitSoftAccent ? accentSoftPaper : accentSoftOnSlab;

  const contrast = {
    text_on_surface: Number(contrastRatio(p.text, p.surface).toFixed(2)),
    muted_on_surface: Number(contrastRatio(p.muted, p.surface).toFixed(2)),
    slab_ink_on_slab: Number(contrastRatio(slabInk, p.slab).toFixed(2)),
    slab_muted_on_slab: Number(contrastRatio(slabMuted, p.slab).toFixed(2)),
    accent_ink_on_accent: Number(contrastRatio(accentInk, p.accent).toFixed(2)),
    accent_text_on_surface: Number(contrastRatio(accentText, p.surface).toFixed(2)),
    // The accent-as-text role also lands on the CARDS (stat numerals, nav
    // hovers) — measured on the darker alt surface so the gate sees the pair
    // the donor actually paints, not just the paper pair.
    accent_text_on_surface_alt: Number(contrastRatio(accentText, p.surfaceAlt).toFixed(2)),
    accent_on_slab: Number(contrastRatio(accentOnSlab, p.slab).toFixed(2)),
    accent_soft_on_surface: Number(contrastRatio(accentSoft, p.surface).toFixed(2)),
    accent_soft_on_slab: Number(contrastRatio(accentSoftOnSlab, p.slab).toFixed(2)),
  };
  const failures = Object.entries(contrast).filter(([, v]) => v < 4.5).map(([k]) => k);

  return {
    ...p, slabInk, slabMuted, accentInk, accentText, accentOnSlab, accentSoft, accentSoftOnSlab, secondaryInk,
    contrast, contrastFailures: failures, passes: failures.length === 0,
  };
}

/**
 * BOTH THEMES, BUILT INDEPENDENTLY AND LINKED.
 *
 * The toggle needs somewhere to go, and the owner was explicit that the light
 * mode must not be "just the dark one with the colours inverted". So each mode
 * is built by its own path through buildPalette — its own surface lightnesses,
 * its own inks derived against those surfaces, its own measured ratios — and
 * this only pairs them up. `mode` names which one is the default.
 */
function buildThemePair(options = {}) {
  const mode = options.mode === "dark" ? "dark" : "light";
  const main = buildPalette({ ...options, mode });
  const counterpart = buildPalette({ ...options, mode: mode === "dark" ? "light" : "dark" });
  main.counterpart = counterpart;
  return main;
}

// ---------------------------------------------------------------------------
// the stylesheet
// ---------------------------------------------------------------------------

const THEME_ATTR = "data-wss-theme";

/**
 * MODE SCOPE PREFIXES — the attribute AND the class, together.
 *
 * THE TWO-WORLDS BUG (measured by the 2026-08-20 WCAG audit on 8 live sites):
 * this engine scoped every mode-specific rule by [data-wss-theme] and its boot/
 * toggle scripts set only that attribute — but the shadcn donors key their OWN
 * dark styles on the `.dark` CLASS. Two theming worlds, each blind to the
 * other: toggling our attribute never activated the donor's `.dark` rules
 * (footers rendered rgb(24,24,27) text on a near-black donor band = invisible
 * in dark mode), and donor markup carrying `.dark` never matched our
 * attribute-scoped overrides (Glo Med Spa showed the inverse — light-gray on
 * light-gray after toggling dark).
 *
 * The fix has two halves and this helper is one of them:
 *   1. the boot and toggle scripts now ALSO do
 *      classList.toggle("dark", mode === "dark") on the root, so donor `.dark`
 *      rules follow the same switch ours do;
 *   2. every mode-scoped rule the theme emits gains a CLASS TWIN — dark scopes
 *      are an ARRAY of prefixes ([attr="dark"] plus :root.dark) flat-mapped
 *      over their selectors, and light scopes carry :not(.dark) so they can
 *      never bleed into a dark page whichever mechanism made it dark.
 *
 * The default mode keeps the `:root:not(...)` form for the same reason it
 * always had it: correct with JavaScript and correct without it.
 */
function modeScopePrefixes(mode, defaultMode = "light") {
  if (mode === "dark") {
    return defaultMode === "dark"
      ? [`:root:not([${THEME_ATTR}="light"]) `, `:root.dark `]
      : [`[${THEME_ATTR}="dark"] `, `:root.dark `];
  }
  return defaultMode === "light"
    ? [`:root:not([${THEME_ATTR}="dark"]):not(.dark) `]
    : [`[${THEME_ATTR}="light"]:not(.dark) `];
}

/** Flat-map a scope-prefix array over a selector list: one comma list that
 *  covers both the attribute world and the class world. */
function scopeSelectors(prefixes, selectors) {
  return prefixes.flatMap((p) => selectors.map((s) => `${p}${s}`)).join(",");
}

/**
 * The hero-scrim base when no dark counterpart palette exists (buildPalette
 * called directly, no pair): the given colour walked 85% toward the #0b1220
 * anchor — the same maths as the engine's cinematic scrim — so white hero ink
 * is guaranteed a dark surface. Garbage input collapses to the anchor itself.
 */
function heroScrimFallback(hex) {
  const c = hexToRgb(hex);
  if (!c) return "#0B1220";
  const t = 0.85;
  const anchor = { r: 11, g: 18, b: 32 };
  return rgbToHex({
    r: c.r * (1 - t) + anchor.r * t,
    g: c.g * (1 - t) + anchor.g * t,
    b: c.b * (1 - t) + anchor.b * t,
  });
}

/**
 * Every dark full-bleed surface a donor paints, found in its OWN stylesheet.
 *
 * Two shapes, both proven present on hvac-premier:
 *   1. Tailwind arbitrary values — `.bg-\[hsl\(215_65\%_8\%\)\]{background-color:hsl(215 65% 8% ...)}`
 *      The class name is baked into the compiled markup and cannot be changed
 *      without rebuilding the donor. The RULE, however, is ours to override.
 *   2. Semantic utilities over a dark token — `.bg-primary` where `--primary`
 *      is `215 60% 16%`.
 *
 * Returned as selectors so the override sheet can repoint exactly these and
 * nothing else. `text-primary` is deliberately NOT included: the same token
 * paints headings on light sections, and flipping it would erase them.
 */
/**
 * THE SHARED CHAIN RESOLVER — one classifier engine for all four token passes.
 *
 * THE VERBATIM PLUMBING PORT MOVED THE COLOUR BEHIND AN INDIRECTION:
 * `--slurry-src: oklch(12% .015 60)` is the bare literal and
 * `--slurry: var(--slurry-src)` is the name every utility spends (plus an
 * @supports re-declaration as `color-mix(in oklab, var(--slurry-src) 38%,
 * var(--neutral-ink))`). darkCustomProperties learned to resolve that chain —
 * and its three siblings (darkTextUtilities, lightTextUtilities,
 * lightSurfaceSelectors) did NOT, which is the exact asymmetry the 2026-08-20
 * live rebuild rendered: `.bg-slurry`/`.bg-bone` repointed per mode while
 * `.text-slurry` — the page-wrapper ink every injected section inherits —
 * stayed the donor's near-black in dark mode. The whole content column,
 * review-carousel footer included, measured ~1.1:1 on the repointed dark
 * paper. One resolver now serves all four passes:
 *
 *   · a literal classifies by the caller's own predicate (each pass keeps its
 *     own thresholds — a slab's "dark" is not an ink's "dark");
 *   · a bare `var(--other)` resolves through the donor's own declarations,
 *     chains too, depth-capped at 4;
 *   · a two-colour `color-mix()` classifies only when BOTH components do —
 *     a mix of two darks is dark, a mix with anything unknown is unknown;
 *   · a name counts when ANY of its declared values does (the fallback
 *     declaration classifies even when an @supports block re-declares it);
 *   · `owned` names are DEAD ENDS along the chain, not just at the surface.
 *     Tailwind v4 aliases (`--color-background: var(--background)`) would
 *     otherwise re-classify through the very tokens the theme re-declares —
 *     the .bg-border-flattening hazard, one indirection deeper.
 */
function chainedColorTest(css, literalTest, { owned = new Set() } = {}) {
  const decls = [...String(css || "").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)]
    .map((m) => [m[1], m[2].trim()]);
  const test = (value, depth = 0) => {
    if (depth > 4) return false; // a cycle or a pathological chain, not a colour
    const v = String(value || "").trim();
    if (literalTest(v)) return true;
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(v);
    if (ref) {
      if (owned.has(ref[1])) return false;
      return decls.some(([n, val]) => n === ref[1] && test(val, depth + 1));
    }
    const mix = /^color-mix\(\s*in\s+[a-z0-9-]+\s*,\s*(.+?)(?:\s+[\d.]+%)?\s*,\s*(.+?)(?:\s+[\d.]+%)?\s*\)$/i.exec(v);
    if (mix) return test(mix[1], depth + 1) && test(mix[2], depth + 1);
    return false;
  };
  return { decls, test };
}

/**
 * Every selector in a stylesheet whose rule body matches `bodyRe` — COMMA
 * GROUPS INCLUDED. Tailwind v4 writes the flat fallback for an alpha family as
 * ONE grouped rule: `.bg-primary,.bg-primary\/10{background-color:var(--primary)}`.
 * The old per-pass regexes captured only the selector token that touches the
 * brace, so `.bg-primary` itself was silently never harvested — measured on
 * concrete-elconstruction, whose footer band was never repointed while its
 * /10 glass twin was. Rules are walked whole and their selector lists split,
 * so every member of a group is seen.
 */
function selectorsSpending(css, bodyRe) {
  const out = [];
  for (const m of String(css || "").matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!bodyRe.test(m[2])) continue;
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      // The same shape the old harvesters accepted: one utility class, no
      // descendant combinators — anything more structural is not a utility.
      if (/^\.[a-zA-Z0-9\\/._-]+$/.test(s) && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

const escVar = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every selector whose rule spends `var(name)` as its COLOR — hand-authored
 * donor rules included, so multi-declaration bodies count (`.stat b { display:
 * block; …; color: var(--wss-accent-ink); line-height: 1 }`).
 *
 * selectorsSpending answers the Tailwind question ("which single-declaration
 * utility background/color does this token feed?"); donor component rules
 * declare a dozen properties at once and were invisible to it. COMMA GROUPS
 * are split the same way, and two shapes are refused as non-selectors: the
 * at-rule header fragment a flat brace-scan can pick up around @media
 * (`max-width: 640px)` — a global rule built from it would repaint the ink
 * fleet-wide) and anything containing a declaration semicolon.
 */
function colorSpenders(css, varName) {
  const out = [];
  // /m so a color that LEADS its rule body (after the selector's newline)
  // matches ^ just like one that follows a semicolon. Comments are stripped
  // first — a donor comment hugging a selector ("THE .text-gradient LAW:
  // …") would otherwise ride along in the captured selector text, and its
  // prose semicolons would get the whole rule refused.
  const text = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const bodyRe = new RegExp(`(?:^|;)\\s*color\\s*:\\s*var\\(${escVar(varName)}\\)\\s*(?:;|$)`, "im");
  for (const m of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!bodyRe.test(m[2])) continue;
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      if (!s || s.includes(";")) continue;
      // A ")" is only legitimate in a selector that LEADS with a pseudo
      // (:is(...), :has(...)); a media-query header fragment ends in one.
      if (s.includes(")") && !s.startsWith(":")) continue;
      if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}

/**
 * Custom properties whose declared VALUE is a dark colour.
 *
 * Handles the three forms donors actually ship: shadcn's bare `H S% L%`
 * triplet, `oklch(12% .077 238)` (and its `oklch(.12 …)` decimal spelling), and
 * a plain hex — plus var() chains and two-colour color-mix() through the
 * shared resolver above. Anything unparseable is skipped rather than guessed
 * at — a mis-classified token would repaint a surface nobody asked us to touch.
 */
function darkCustomProperties(css, { maxHslLightness = 22, maxOklchLightness = 0.35 } = {}) {
  const literalIsDark = (value) => {
    // oklab too: its first channel is the same 0..1 lightness, and the
    // plumbing donor's saturation dial mixes toward `--neutral-ink:
    // oklab(12% 0 5.96e-8)` — an unparseable component fails the whole mix.
    const oklch = /^okl(?:ch|ab)\(\s*([\d.]+)(%?)/i.exec(value);
    if (oklch) {
      const raw = Number(oklch[1]);
      const l = oklch[2] === "%" ? raw / 100 : raw;
      return l <= maxOklchLightness;
    }
    const triplet = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
    if (triplet) return Number(triplet[3]) <= maxHslLightness;
    // A LEADING # IS REQUIRED HERE, unlike everywhere else in this file.
    // normalizeHex also accepts the 3-digit shorthand without one, and CSS
    // variables are full of bare numbers: `--font-weight-light: 300` parsed as
    // #330000 and five font-weight tokens were classified as dark surfaces.
    // Harmless on this donor — there is no `.bg-font-weight-light` — but it is
    // a loaded gun aimed at whichever donor names a token three digits long.
    if (!value.startsWith("#")) return false;
    const hex = normalizeHex(value);
    return !!hex && relativeLuminance(hex) <= 0.05;
  };

  const { decls, test } = chainedColorTest(css, literalIsDark);
  const found = new Set();
  for (const [name, value] of decls) {
    // Never treat a foreground/text/ink-on-X role as a surface.
    if (/foreground|-fg$|-text$|-ink-on/i.test(name)) continue;
    if (test(value)) found.add(name);
  }
  return found;
}

function darkSurfaceSelectors(css, { maxLightness = 22 } = {}) {
  const text = String(css || "");
  const out = {
    arbitrary: [], tokens: [], primaryLightness: null,
    bgUtilities: [], gradientFrom: [], gradientTo: [], gradientVia: [], darkVars: [],
  };

  // THE ALPHA VARIANTS ARE PART OF THE SAME FAMILY, and missing them is what
  // the first render caught. Four glass cards float over the hero at
  // `bg-[hsl(215_65%_8%/0.6)]`, `/0.7`, `/0.78`, `/0.88` — the same near-black
  // as the hero, wearing an opacity. Repointing only the opaque form flipped
  // the page to light and left those cards dark, while their text followed
  // --primary-foreground to a dark ink: "AC & heat" and "Homes & …" rendered
  // black on black. So the alpha is captured and carried into the override
  // rather than the rule being skipped.
  // NOTE THE ALPHA'S DECIMAL POINT IS ITSELF ESCAPED. Tailwind writes the class
  // `bg-[hsl(215_65%_8%/0.6)]` into the stylesheet as
  // `.bg-\[hsl\(215_65\%_8\%\/0\.6\)\]` — the dot in "0.6" arrives as `0\.6`.
  // A `[\d.]+` alpha group therefore matches nothing, the whole optional group
  // is skipped, and the rule silently reads as fully opaque. That cost a render
  // cycle: the four glass cards stayed dark while their text went dark with the
  // rest of the page.
  for (const m of text.matchAll(/\.bg-\\\[hsl\\\(([\d.]+)_([\d.]+)\\%_([\d.]+)\\%(?:\\\/([\d\\.]+))?\\\)\\\]/g)) {
    const l = Number(m[3]);
    if (!(l <= maxLightness)) continue;
    // Re-escape to the exact selector the stylesheet uses, so the override has
    // identical specificity and simply wins on source order.
    out.arbitrary.push({
      selector: m[0],
      h: Number(m[1]),
      s: Number(m[2]),
      l,
      alpha: m[4] === undefined ? 1 : Number(String(m[4]).replace(/\\/g, "")),
    });
  }

  // DONORS DO NOT ALL SPELL "DARK" THE SAME WAY, and assuming they do is how
  // the first version of this pass changed nothing at all on the plumbing lane.
  //
  // hvac-premier bakes literals into arbitrary values. plumbing-clean instead
  // declares a NAMED colour — `--slurry: oklch(12% 0.077 238.5)` — and spends it
  // through `.bg-slurry`, `.from-slurry`, `.to-slurry`, `.via-slurry`. Measured
  // on wss-test-rivercity-plumbing: before and after were byte-for-byte the
  // same page, 62% light either way, because zero slabs were detected.
  //
  // So: find every custom property whose VALUE is a dark colour, then find the
  // utility classes that spend it as a background or a gradient stop. Only the
  // utilities are repointed — never the property itself, because the same token
  // is also legitimately used as TEXT on light sections, and flipping it there
  // would erase the type.
  const darkVars = darkCustomProperties(text);
  out.darkVars = [...darkVars];
  for (const name of darkVars) {
    const esc = escVar(name);
    // Comma groups included — see selectorsSpending. Tailwind v4 writes
    // `.bg-primary,.bg-primary\/10{background-color:var(--primary)}` and the
    // one-selector regex this used to be harvested only the alpha twin.
    for (const sel of selectorsSpending(text, new RegExp(`^background-color:var\\(${esc}\\)$`))) {
      if (!out.bgUtilities.includes(sel)) out.bgUtilities.push(sel);
    }
    for (const [prop, bucket] of [
      ["--tw-gradient-from", "gradientFrom"],
      ["--tw-gradient-to", "gradientTo"],
      ["--tw-gradient-via", "gradientVia"],
    ]) {
      for (const sel of selectorsSpending(text, new RegExp(`(?:^|;)${prop}:var\\(${esc}\\)`))) {
        if (!out[bucket].includes(sel)) out[bucket].push(sel);
      }
    }
  }

  const primary = /--primary:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(text);
  if (primary) {
    out.primaryLightness = Number(primary[3]);
    if (Number(primary[3]) <= maxLightness) out.tokens.push("primary");
  }
  const ink = /--ink:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(text);
  if (ink && Number(ink[3]) <= maxLightness) out.tokens.push("ink");
  return out;
}

/** sRGB alpha composite of `fg` over `bg` — what the eye actually receives. */function blend(fg, bg, alpha) {
  const f = hexToRgb(fg), b = hexToRgb(bg);
  if (!f || !b) return fg;
  const a = Math.max(0, Math.min(1, alpha));
  return rgbToHex({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
  });
}

/**
 * THE DONOR'S FADED TEXT RAMP, and why flipping one token is not enough.
 *
 * hvac-premier writes its secondary copy as `.text-primary-foreground\/45`,
 * compiling to `color:hsl(var(--primary-foreground) / .45)`. On the donor's
 * near-black slab that is a soft white — elegant, and perfectly legible.
 * Repoint the slab to a pale tint and flip the ink to near-black and the same
 * rule becomes black at 45% over near-white, which is a light grey.
 *
 * MEASURED on the live mirror after the first version of this pass: the hero
 * eyebrow "Volume 01 · Comfort, Engineered" rendered at 2.02:1 — a fail, in
 * 10px type. And no choice of ink can rescue it: even pure black at 40% alpha
 * over a 96%-lightness slab tops out near 2.7:1. The ALPHA is the problem, so
 * the alpha is what has to go.
 *
 * This finds those rules so themeCss can replace the faded ones with a solid,
 * contrast-checked muted ink, and leave the ones that still pass alone.
 */
function alphaInkSelectors(css, { variable = "--primary-foreground" } = {}) {
  const out = [];
  const re = new RegExp(
    `(\\.[a-zA-Z0-9\\\\/._-]+)\\{color:hsl\\(var\\(${variable}\\)\\s*/\\s*([.0-9]+)\\)\\}`,
    "g",
  );
  for (const m of String(css || "").matchAll(re)) {
    out.push({ selector: m[1], alpha: Number(m[2]) });
  }
  return out;
}

/**
 * TEXT UTILITIES BUILT FROM A LIGHT COLOUR — the ink that belongs to a slab.
 *
 * WHY THIS IS SOUND, and not a guess. hvac-premier names its slab ink
 * `--primary-foreground`, so flipping that one token moved everything. The
 * plumbing donor names its `--bone` and there is no declared pairing anywhere
 * that says "bone goes on slurry". Rendering it proved the cost: the page went
 * light and every headline stayed pale blue on near-white — a whole hero
 * legible only if you already knew what it said.
 *
 * But the pairing does not need to be declared, because it is implied by
 * contrast. A near-white text colour is ILLEGIBLE on the donor's own light page
 * background, so the donor cannot be using it there; wherever `.text-bone`
 * appears, it is over something dark. Flip those surfaces to light and that ink
 * must become dark, without needing to know which element is which.
 *
 * This holds only in LIGHT mode and only for genuinely light inks, so the
 * threshold is deliberately high — a mid-tone is ambiguous and is left alone.
 */
function lightTextUtilities(css, { minLuminance = 0.55, owned = new Set() } = {}) {
  const text = String(css || "");
  const literalIsLight = (value) => {
    // oklab too: its first channel is the same 0..1 lightness, and the
    // plumbing donor's saturation dial mixes toward `--neutral-ink:
    // oklab(12% 0 5.96e-8)` — an unparseable component fails the whole mix.
    const oklch = /^okl(?:ch|ab)\(\s*([\d.]+)(%?)/i.exec(value);
    if (oklch) {
      const raw = Number(oklch[1]);
      const l = oklch[2] === "%" ? raw / 100 : raw;
      return l >= 0.88;
    }
    const triplet = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
    if (triplet) return Number(triplet[3]) >= 90;
    if (!value.startsWith("#")) return false;
    const hex = normalizeHex(value);
    return !!hex && relativeLuminance(hex) >= minLuminance;
  };
  // Chains resolve; `owned` chains are dead ends (see chainedColorTest). A
  // token themeCss re-declares is already correct per mode — repainting the
  // utilities that spend it through a v4 alias would double-govern one ink.
  const { decls, test } = chainedColorTest(text, literalIsLight, { owned });
  const light = new Set();
  for (const [name, value] of decls) {
    if (owned.has(name)) continue;
    if (test(value)) light.add(name);
  }
  const selectors = [];
  for (const name of light) {
    for (const sel of selectorsSpending(text, new RegExp(`^color:var\\(${escVar(name)}\\)`))) {
      if (!selectors.includes(sel)) selectors.push(sel);
    }
  }
  return { vars: [...light], selectors };
}

/**
 * THE MIRROR IMAGE: the donor's PAPER, for a client whose site is dark.
 *
 * darkSurfaceSelectors finds the donor's dark slabs so a LIGHT mirror can turn
 * them pale. Nothing did the converse, and the first client ever to reach the
 * dark branch showed the cost. Gunther Plumbing's own site measures dark, so
 * their mirror booted dark — and rendered as a dark hero sitting on top of nine
 * screenfuls of pale pink paper, because plumbing-clean paints its content
 * sections `.bg-bone` and `--bone` is `oklch(96% …)`. Measured on the live page
 * in 400px bands: 24 of 36 bands still light with the page in dark mode.
 *
 * So: the same trick, pointed the other way. Find custom properties whose value
 * is a LIGHT colour, find the utilities that spend them as a background, and
 * hand those to `--wss-surface`, which is already per-theme.
 *
 * THE ALPHA LADDER IS RETURNED, NOT DROPPED — and the caller must preserve each
 * step's opacity. The first version excluded `.bg-bone\/85` on the theory that
 * a translucent paper is a design element that reads correctly either way. The
 * side-by-side said otherwise: Gunther's sticky header is
 * `bg-bone\/85 backdrop-blur-md`, so on their otherwise-dark mirror the header
 * was a bright dusty-rose band — the loudest object on the page, in a colour
 * their brand does not contain, sitting directly beside their own logo. Their
 * real header is white. Flattening it to an opaque colour is equally wrong: it
 * would kill the blur the design is built on. So the ladder is carried and each
 * step is rebuilt at its own opacity, exactly as the dark slabs already are.
 *
 * `color:` utilities are not touched here. The ink that sits ON this paper is
 * handled by darkTextUtilities below, and only where it is dark enough that it
 * could only ever have been ink on something pale.
 *
 * The caller scopes every rule built from this to the DARK theme only, so a
 * light mirror — 95% of the fleet, and the thing that currently works — is
 * byte-for-byte unaffected by any of it.
 */
function lightSurfaceSelectors(css, {
  minOklchLightness = 0.88, minHslLightness = 90, minLuminance = 0.72, owned = new Set(),
} = {}) {
  const text = String(css || "");
  const literalIsLight = (value) => {
    // oklab too: its first channel is the same 0..1 lightness, and the
    // plumbing donor's saturation dial mixes toward `--neutral-ink:
    // oklab(12% 0 5.96e-8)` — an unparseable component fails the whole mix.
    const oklch = /^okl(?:ch|ab)\(\s*([\d.]+)(%?)/i.exec(value);
    if (oklch) {
      const raw = Number(oklch[1]);
      const l = oklch[2] === "%" ? raw / 100 : raw;
      return l >= minOklchLightness;
    }
    const triplet = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
    if (triplet) return Number(triplet[3]) >= minHslLightness;
    // The leading # is required for the same reason it is required over there:
    // `--font-weight-light: 300` is not the colour #330000.
    if (!value.startsWith("#")) return false;
    const hex = normalizeHex(value);
    return !!hex && relativeLuminance(hex) >= minLuminance;
  };
  // Chains resolve (the plumbing indirection — see chainedColorTest) and
  // `owned` names are dead ends along the way, not just at the surface.
  const { decls, test } = chainedColorTest(text, literalIsLight, { owned });

  const light = new Set();
  for (const [name, value] of decls) {
    // A foreground role is ink, not paper — the same exclusion darkCustom-
    // Properties makes, for the same reason.
    if (/foreground|-fg$|-text$|-ink-on/i.test(name)) continue;
    // A TOKEN THE THEME ALREADY RE-DECLARES NEEDS NOTHING FROM THIS PASS, and
    // acting on it anyway is destructive. themeCss rewrites the whole shadcn
    // set — `--background`, `--card`, `--border`, `--primary` … — per theme, so
    // `.bg-card` is already correct in dark mode. Without this exclusion the
    // pass also claimed `.bg-border` on the concrete and tattoo donors, which
    // would have flattened every hairline into a full-width slab of page
    // colour, and claimed `.text-primary-foreground`, which is the ink ON the
    // accent button and would have gone dark-on-dark.
    if (owned.has(name)) continue;
    if (test(value)) light.add(name);
  }

  const bgUtilities = [];
  for (const name of light) {
    for (const sel of selectorsSpending(text, new RegExp(`^background-color:var\\(${escVar(name)}\\)$`))) {
      if (!bgUtilities.includes(sel)) bgUtilities.push(sel);
    }
  }
  return { vars: [...light], bgUtilities };
}

/**
 * The ink that belongs on that paper — the exact converse of lightTextUtilities.
 *
 * `.text-slurry` is near-black, so it can only ever have been set over a pale
 * surface; the donor cannot be using it on its own dark slabs. Once those pale
 * surfaces become dark for a dark-mode client, this ink has to come with them
 * or the copy disappears — which is the identical failure lightTextUtilities
 * was written to fix, seen from the other side.
 *
 * THE FADED STEPS COME TOO, and leaving them behind was a regression I shipped
 * and then saw. With the header repointed to the dark surface and only the
 * solid `.text-slurry` following it, Gunther's nav — WORK CRAFT TOOLS AREA
 * QUOTE, all `text-slurry\/70` — went near-black on near-black. The ladder is a
 * type hierarchy and has to stay one, so each step is returned and the caller
 * rebuilds it at its own opacity over the new ink, exactly as the paper is.
 */
function darkTextUtilities(css, { maxLuminance = 0.08, owned = new Set() } = {}) {
  const text = String(css || "");
  const literalIsDark = (value) => {
    // oklab too: its first channel is the same 0..1 lightness, and the
    // plumbing donor's saturation dial mixes toward `--neutral-ink:
    // oklab(12% 0 5.96e-8)` — an unparseable component fails the whole mix.
    const oklch = /^okl(?:ch|ab)\(\s*([\d.]+)(%?)/i.exec(value);
    if (oklch) {
      const raw = Number(oklch[1]);
      const l = oklch[2] === "%" ? raw / 100 : raw;
      return l <= 0.3;
    }
    const triplet = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
    if (triplet) return Number(triplet[3]) <= 18;
    if (!value.startsWith("#")) return false;
    const hex = normalizeHex(value);
    return !!hex && relativeLuminance(hex) <= maxLuminance;
  };
  // CHAINS RESOLVE HERE TOO — the missing half of the plumbing fix. The donor
  // spends `.text-slurry{color:var(--slurry)}` where `--slurry` is
  // `var(--slurry-src)`; classifying literals only left this ink behind while
  // lightSurfaceSelectors moved its paper, and the whole content column
  // (review-carousel footer included) rendered near-black on near-black in
  // dark mode on the 2026-08-20 live rebuild.
  const { decls, test } = chainedColorTest(text, literalIsDark, { owned });
  const dark = new Set();
  for (const [name, value] of decls) {
    if (owned.has(name)) continue;   // see lightSurfaceSelectors — same reason
    if (test(value)) dark.add(name);
  }
  const selectors = [];
  for (const name of dark) {
    for (const sel of selectorsSpending(text, new RegExp(`^color:var\\(${escVar(name)}\\)$`))) {
      if (!selectors.includes(sel)) selectors.push(sel);
    }
  }
  return { vars: [...dark], selectors };
}

/** Does this donor paint an animated blurred wash we need to recolour? */
function auroraSelectors(css) {
  const found = [];
  for (const m of String(css || "").matchAll(/\.((?:aurora|glow|mesh)[a-z-]*)\s*\{/gi)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * GRADIENT-CLIPPED TEXT WITH THE COLOUR HARDCODED, whatever the class is called.
 *
 * The warm pass below retargets the LITERAL class `.text-gradient-warm` — which
 * is this repo's own donor convention. fencing-sterling (2026-09 diagnostic)
 * spells its hero ink `.text-gradient` and hardcodes the gold outright:
 * `linear-gradient(135deg,#e8a530,#f6ce55,#e8a530)` — the pass never matched
 * the name, and the hero kept glowing donor-gold over a client-red page.
 *
 * So find the CLASS-AGNOSTIC truth: any selector whose rule clips text
 * (`background-clip:text` in either spelling) and paints a gradient with a
 * colour literal in it (hex or rgb — a var() or wss reference is already
 * repointable and not our business here). The override rule rewrites only the
 * background-image longhand, mode-aware, exactly as the warm pass does.
 */
function textGradientSelectors(css) {
  const out = [];
  for (const m of String(css || "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    if (!/(?:-webkit-)?background-clip\s*:\s*text/i.test(body)) continue;
    let hardcoded = false;
    for (const b of body.matchAll(/(?:^|;)\s*(?:background-image|background)\s*:\s*([^;]+)/gi)) {
      const value = b[1];
      if (!/gradient\(/i.test(value)) continue;
      if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(value) && !/var\(--wss/i.test(value)) hardcoded = true;
    }
    if (!hardcoded) continue;
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

/**
 * SELECTION COLOURS PAINTED IN A LITERAL. The same donor ships
 * `::selection{background:#e8a5304d;color:#efece7}` — highlight a paragraph,
 * get donor gold. Any ::selection / ::-moz-selection rule carrying a hard-coded
 * colour is repainted from the client's own accent (soft wash) and text; rules
 * that already spend variables are left to the token pass.
 */
function selectionSelectors(css) {
  const out = [];
  for (const m of String(css || "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/::(?:-webkit-|-moz-)?selection/i.test(m[1])) continue;
    if (!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(m[2])) continue;
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

/**
 * themeCss — the override stylesheet, appended AFTER the donor's own.
 *
 * Appended rather than rewritten in place, deliberately: the donor's rules stay
 * byte-identical, so a mistake here is a cosmetic regression that a later build
 * undoes, not a corrupted bundle. Source order gives our rules the win at equal
 * specificity.
 *
 * Both themes are written out in full. The light one is NOT the dark one with
 * its colours inverted — the surfaces are built from near-white tints and the
 * inks are re-derived and re-measured against them, which is why
 * `palette.contrast` carries a different set of numbers for each mode.
 */
function themeCss({ palette, donorCss = "", defaultMode = "light" } = {}) {
  const dark = darkSurfaceSelectors(donorCss);
  const auroras = auroraSelectors(donorCss);
  const p = palette;

  // THE TOKEN'S VALUE FORMAT IS PER-TOKEN, DECIDED BY HOW THIS DONOR SPENDS IT.
  //
  // Two worlds again, one indirection lower (2026-08-20 live rebuild, concrete
  // donor, measured): a shadcn donor wraps — `.bg-primary{background-color:
  // hsl(var(--primary))}` — so its tokens must be BARE TRIPLETS; a Tailwind v4
  // donor consumes the same names DIRECTLY — `.bg-primary{background-color:
  // var(--primary)}`, or through a `--color-primary: var(--primary)` alias —
  // and a bare triplet there is an INVALID colour: the declaration collapses,
  // backgrounds go transparent and inks fall back. The concrete footer
  // rendered its white `--primary-foreground` ink on the BODY (1.02:1 light)
  // because its `.bg-primary` band painted nothing at all, and its dark-mode
  // ink fell back to rgb(24,24,27) on rgb(25,16,16) — the audit's exact
  // numbers, in both modes. So each token ships in the spelling its own donor
  // can drink: wrapped anywhere -> triplet; never wrapped -> real hex. Every
  // rule the theme writes itself uses the --wss-* hexes and does not care.
  const wrapsToken = (name) => new RegExp(`hsl\\(\\s*var\\(--${name}\\s*[)/]`).test(donorCss);
  const tokenColor = (name, hex) => (wrapsToken(name) ? hslTriplet(hex) : hex);

  // The hvac-premier band pair — see the vars() entry below.
  const donorBandTokens = /(^|[^a-z-])--wss-band-(ink|accent)\s*:/i.test(donorCss);

  const vars = (t) => [
    `--wss-surface:${t.surface}`,
    `--wss-surface-alt:${t.surfaceAlt}`,
    `--wss-text:${t.text}`,
    `--wss-muted:${t.muted}`,
    `--wss-border:${t.border}`,
    `--wss-slab:${t.slab}`,
    `--wss-slab-ink:${t.slabInk}`,
    `--wss-slab-muted:${t.slabMuted}`,
    `--wss-accent:${t.accent}`,
    // THE SAME ACCENT AS A BARE HSL TRIPLET, unconditionally. The engine's
    // injected islands (content-inject, project-gallery, authority pages,
    // seasonal) compose their accents as `hsl(var(--wss-a))` and read
    // `--wss-a:var(--wss-accent-hsl,var(--accent,…))` — a chain that needs a
    // guaranteed TRIPLET somewhere above it. `--accent` above is spelled per
    // the donor's own convention (hex for the hand-authored families, triplet
    // for shadcn), so it cannot be that guarantee; this token is. Without it
    // a hex `--accent` made every `hsl(var(--wss-a))` declaration invalid-at-
    // parse and the islands rendered accentless gray (2026-09-02 smoke).
    `--wss-accent-hsl:${hslTriplet(t.accent)}`,
    `--wss-accent-hover:${t.accentHover}`,
    `--wss-accent-ink:${t.accentInk}`,
    `--wss-accent-text:${t.accentText}`,
    `--wss-accent-on-slab:${t.accentOnSlab}`,
    `--wss-accent-soft:${t.accentSoft}`,
    // The donor's own soft-accent slot, so `.section-eyebrow-light` and every
    // `text-accent-soft` follow without needing a rule of their own.
    `--accent-soft:${tokenColor("accent-soft", t.accentSoft)}`,
    // The donor's own token names, so every existing rule follows without
    // knowing we exist — triplet or hex per the donor's own spelling above.
    `--background:${tokenColor("background", t.surface)}`,
    `--foreground:${tokenColor("foreground", t.text)}`,
    `--card:${tokenColor("card", t.surfaceAlt)}`,
    `--card-foreground:${tokenColor("card-foreground", t.text)}`,
    `--popover:${tokenColor("popover", t.surfaceAlt)}`,
    `--popover-foreground:${tokenColor("popover-foreground", t.text)}`,
    `--muted-foreground:${tokenColor("muted-foreground", t.muted)}`,
    `--border:${tokenColor("border", t.border)}`,
    `--input:${tokenColor("input", t.border)}`,
    // `--primary` BECOMES THE STRONG INK, not a surface.
    //
    // It is safe to redefine because `.bg-primary` is overridden below to point
    // at `--wss-slab`, so nothing paints a surface from it any more. Leaving it
    // as the donor's dark navy was a real defect, caught by rendering the dark
    // theme: the header wordmark, the active nav item and the phone number are
    // all `text-primary`, and on the dark surface they were dark-on-dark.
    `--primary:${tokenColor("primary", t.text)}`,
    `--accent:${tokenColor("accent", t.accent)}`,
    `--accent-foreground:${tokenColor("accent-foreground", t.accentInk)}`,
    `--ring:${tokenColor("ring", t.accent)}`,
    // THE SECONDARY TOKENS, from a brand_identity secondary_colour. Emitted
    // ONLY when that colour exists — a palette built without one writes the
    // same sheet it always did, byte for byte. Adding them to this block also
    // adds them to `owned` below, so the donor-classifier passes can never
    // repaint the very tokens this sheet just decided.
    ...(t.secondary ? [
      `--secondary:${tokenColor("secondary", t.secondary)}`,
      `--secondary-foreground:${tokenColor("secondary-foreground", t.secondaryInk || readableInkOn(t.secondary))}`,
    ] : []),
    // THE INK ON EVERY SLAB. This one line is what flips the four dark bands
    // coherently: the donor writes all of its slab text, hairlines and glass
    // fills as `hsl(var(--primary-foreground) / α)`, so every alpha variant
    // follows this value instead of needing its own override.
    `--primary-foreground:${tokenColor("primary-foreground", t.slabInk)}`,
    // THE SIDEBAR FAMILY. fencing-sterling ships a shadcn sidebar block whose
    // `--sidebar-primary` and `--sidebar-ring` were `38 80% 55%` — the donor's
    // gold, sitting untouched under every rule that spends them, because this
    // table repointed `--ring` and `--accent` but never the `--sidebar-*`
    // names. Every token the donor actually declared is repointed now, in the
    // role it plays: primary/ring are accent slots, background/foreground are
    // surface slots, accent/accent-foreground are the hover-band pair.
    `--sidebar-background:${tokenColor("sidebar-background", t.surface)}`,
    `--sidebar-foreground:${tokenColor("sidebar-foreground", t.text)}`,
    `--sidebar-primary:${tokenColor("sidebar-primary", t.accent)}`,
    `--sidebar-primary-foreground:${tokenColor("sidebar-primary-foreground", t.accentInk)}`,
    `--sidebar-accent:${tokenColor("sidebar-accent", t.slab)}`,
    `--sidebar-accent-foreground:${tokenColor("sidebar-accent-foreground", t.slabInk)}`,
    `--sidebar-border:${tokenColor("sidebar-border", t.border)}`,
    `--sidebar-ring:${tokenColor("sidebar-ring", t.accent)}`,
    // THE DONOR-FAMILY BAND TOKENS (hvac-premier's on-slab hero). The donor
    // paints its hero band ink and the band's accent phrase from
    // --wss-band-ink / --wss-band-accent — names tuned to ITS OWN dark band.
    // The slab pass repointed the BAND but never knew these names, so in
    // light mode the band went pale while its inks stayed donor-light: the
    // accent phrase in the hero H1 rendered #e09257 on near-white (1.9:1,
    // armock/earth-power, final QA Class B 2026-09-04). When the donor
    // declares them, re-point each to the role it plays: the band ink is the
    // slab ink (proven 7:1 against the slab), the band accent is the accent
    // proven ON the slab. Emitted only when declared, so donors without the
    // names ship the sheet they always did; declaring them here also marks
    // them owned, so the classifier passes can never repaint them back.
    ...(donorBandTokens ? [
      `--wss-band-ink:${tokenColor("wss-band-ink", t.slabInk)}`,
      `--wss-band-accent:${tokenColor("wss-band-accent", t.accentOnSlab)}`,
    ] : []),
  ].join(";");

  // Opaque slabs and translucent glass are the same surface at different
  // opacities, so they are grouped by alpha and each group keeps its own.
  const opaque = dark.arbitrary.filter((a) => a.alpha >= 0.999).map((a) => a.selector);
  const glassByAlpha = new Map();
  for (const a of dark.arbitrary.filter((x) => x.alpha < 0.999)) {
    if (!glassByAlpha.has(a.alpha)) glassByAlpha.set(a.alpha, []);
    glassByAlpha.get(a.alpha).push(a.selector);
  }

  const slabRules = [
    ...opaque,
    ...(dark.tokens.includes("primary") ? [".bg-primary"] : []),
    ...(dark.tokens.includes("ink") ? [".bg-ink"] : []),
    // Named dark colours spent as FLAT backgrounds only (`.bg-slurry`).
    ...dark.bgUtilities.filter((s) => !/\\\/\d+$/.test(s)),
  ];

  // THE ALPHA LADDER OF A NAMED DARK COLOUR — `.bg-slurry\/15` … `\/90`.
  //
  // Tailwind v4 emits each of these TWICE: a flat `background-color:var(--slurry)`
  // fallback and, right after it, the real
  // `color-mix(in oklab,var(--slurry) 15%,transparent)`. An override appended at
  // the end of the file beats both, so writing a flat colour here would collapse
  // a 15% scrim over a photograph into a solid panel. The alpha is read back out
  // of the selector and preserved.
  const namedGlass = new Map();
  for (const sel of dark.bgUtilities) {
    const m = /\\\/(\d+)$/.exec(sel);
    if (!m) continue;
    const pct = Number(m[1]);
    if (!namedGlass.has(pct)) namedGlass.set(pct, []);
    namedGlass.get(pct).push(sel);
  }

  const lines = [];
  lines.push("/* WSS mirror theme — light by default, built from the client's own colours. */");
  // The default-mode variables. When the default is DARK the class twin joins
  // the selector so a donor script (or ours) toggling only `.dark` still lands
  // on the dark values — see modeScopePrefixes for the two-worlds incident.
  lines.push(`${defaultMode === "dark" ? `:root,[${THEME_ATTR}="dark"],:root.dark` : `:root,[${THEME_ATTR}="${defaultMode}"]`}{${vars(palette)};color-scheme:${palette.mode === "dark" ? "dark" : "light"}}`);

  // The counterpart theme, so the toggle has somewhere to go. The dark
  // counterpart carries the `:root.dark` twin; the light counterpart carries
  // `:not(.dark)` so it can never fight a page that is dark by class.
  const other = palette.counterpart;
  if (other) {
    const counterpartScope = other.mode === "dark"
      ? `[${THEME_ATTR}="dark"],:root.dark`
      : `[${THEME_ATTR}="light"]:not(.dark)`;
    lines.push(`${counterpartScope}{${vars(other)};color-scheme:${other.mode === "dark" ? "dark" : "light"}}`);
  }

  lines.push(`html,body{background-color:var(--wss-surface);color:var(--wss-text)}`);

  if (slabRules.length) {
    // The four dark bands and the footer, repointed at one variable.
    lines.push(`${slabRules.join(",")}{background-color:var(--wss-slab)!important;color:var(--wss-slab-ink)}`);
    lines.push(`${slabRules.map((s) => `${s} *`).join(",")}{border-color:color-mix(in srgb,var(--wss-slab-ink) 18%,transparent)}`);

    // A LIGHT PALETTE WITH A DARK SLAB (the site-palette lane's dark-band
    // rhythm) re-scopes the soft accent ONTO the band: the paper's
    // accent-soft and the slab's are different values by physics (see
    // finish), and the donor spends one token on both surfaces. Custom
    // properties cascade, so declaring them on the slab element hands every
    // descendant — an eyebrow, a `.text-accent-soft` — the value proven
    // against the surface it actually sits on. Scoped to the LIGHT theme so
    // the dark counterpart keeps its own (already slab-chained) value, and
    // emitted ONLY for the dark-slab case, so every palette whose slab
    // matches its paper family ships the exact bytes it always did.
    if (palette.mode === "light" && relativeLuminance(palette.slab) <= 0.35) {
      const lightScopes = modeScopePrefixes("light", defaultMode);
      lines.push(
        `${scopeSelectors(lightScopes, slabRules)}{--wss-accent-soft:${palette.accentSoftOnSlab};--accent-soft:${tokenColor("accent-soft", palette.accentSoftOnSlab)}}`,
      );
    }
  }

  // The glass cards, each keeping the opacity the design gave it. They sit over
  // a photograph, so they must stay translucent — but they must be a
  // translucent LIGHT now, not a translucent near-black with dark text on it.
  for (const [alpha, sels] of [...glassByAlpha.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(
      `${sels.join(",")}{background-color:color-mix(in srgb,var(--wss-slab) ${Math.round(alpha * 100)}%,transparent)!important;`
      + `color:var(--wss-slab-ink)}`,
    );
  }

  for (const [pct, sels] of [...namedGlass.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`${sels.join(",")}{background-color:color-mix(in oklab,var(--wss-slab) ${pct}%,transparent)}`);
  }

  // The exclusion set is DERIVED from the declaration block above rather than
  // listed by hand, so the two can never drift: any token themeCss learns to
  // own is automatically off-limits to the classifier passes from the same
  // commit — including one indirection away, through a v4 `--color-*` alias
  // (chainedColorTest treats owned names as chain dead ends).
  const owned = new Set([...vars(p).matchAll(/(^|;)(--[a-z0-9-]+):/g)].map((m) => m[2]));

  // THE SLAB'S INK, for donors that do not call it `--primary-foreground`.
  // Light-mode only: in the dark theme these utilities are already correct.
  {
    const lightInk = lightTextUtilities(donorCss, { owned });
    if (lightInk.selectors.length) {
      const scopes = modeScopePrefixes("light", defaultMode);
      lines.push(
        `${scopeSelectors(scopes, lightInk.selectors)}{color:var(--wss-slab-ink)}`,
      );
    }
  }

  // THE DONOR'S PAPER, FOR A DARK CLIENT — see lightSurfaceSelectors.
  //
  // SCOPED TO DARK, ON PURPOSE. Every rule in this block is prefixed with the
  // dark scope, so a light mirror's stylesheet is unchanged by it and the 95%
  // of the fleet that works today cannot be regressed by a pass that exists for
  // the 5% that does not.
  {
    const paper = lightSurfaceSelectors(donorCss, { owned });
    const paperInk = darkTextUtilities(donorCss, { owned });
    // An ARRAY of prefixes — the attribute scope and its `.dark` class twin —
    // flat-mapped over every selector below (the two-worlds fix).
    const darkScopes = modeScopePrefixes("dark", defaultMode);

    // Flat paper, and then the alpha ladder step by step — the same shape as
    // the dark slabs above, and for the same reason. `bg-bone\/85` is Gunther's
    // sticky header, sitting on `backdrop-blur-md`; a flat colour would kill
    // the blur and dropping the rule left a dusty-rose band across the top of
    // an otherwise dark page, right beside their own logo.
    const flatPaper = paper.bgUtilities.filter((s) => !/\\\/\d+$/.test(s));
    if (flatPaper.length) {
      lines.push(
        `${scopeSelectors(darkScopes, flatPaper)}{background-color:var(--wss-surface)}`,
      );
    }
    const paperGlass = new Map();
    for (const sel of paper.bgUtilities) {
      const m = /\\\/(\d+)$/.exec(sel);
      if (!m) continue;
      const pct = Number(m[1]);
      if (!paperGlass.has(pct)) paperGlass.set(pct, []);
      paperGlass.get(pct).push(sel);
    }
    for (const [pct, sels] of [...paperGlass.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(
        `${scopeSelectors(darkScopes, sels)}`
        + `{background-color:color-mix(in oklab,var(--wss-surface) ${pct}%,transparent)}`,
      );
    }
    const flatInk = paperInk.selectors.filter((s) => !/\\\/\d+$/.test(s));
    if (flatInk.length) {
      lines.push(`${scopeSelectors(darkScopes, flatInk)}{color:var(--wss-text)}`);
    }
    const inkLadder = new Map();
    for (const sel of paperInk.selectors) {
      const m = /\\\/(\d+)$/.exec(sel);
      if (!m) continue;
      // A step faded past legibility on the new surface is lifted to the muted
      // ink, which WAS contrast-checked when the palette was built. Below about
      // 55% alpha nothing clears 4.5:1 — the same floor alphaInkSelectors uses
      // for the slab ramp, applied here to the page ramp.
      const pct = Math.max(Number(m[1]), 55);
      if (!inkLadder.has(pct)) inkLadder.set(pct, []);
      inkLadder.get(pct).push(sel);
    }
    for (const [pct, sels] of [...inkLadder.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(
        `${scopeSelectors(darkScopes, sels)}`
        + `{color:color-mix(in oklab,var(--wss-text) ${pct}%,transparent)}`,
      );
    }
  }

  // GRADIENT STOPS built from a named dark colour. `.from-slurry` sets
  // `--tw-gradient-from`, and repointing that one variable moves every gradient
  // the class participates in without touching the gradient's direction, its
  // positions, or the light stops it is paired with.
  for (const [sels, prop] of [
    [dark.gradientFrom, "--tw-gradient-from"],
    [dark.gradientTo, "--tw-gradient-to"],
    [dark.gradientVia, "--tw-gradient-via"],
  ]) {
    if (!sels.length) continue;
    lines.push(`${[...new Set(sels)].join(",")}{${prop}:var(--wss-slab)}`);
  }

  // THE FADED TEXT RAMP. Every rule in the donor's `text-primary-foreground/N`
  // ladder is checked by COMPOSITING it over the new slab and measuring the
  // result. The ones that still clear 4.5:1 keep their alpha, so the design's
  // hierarchy survives; the ones that cannot — and below roughly 55% alpha on a
  // pale surface, none can — are replaced by a solid muted ink that was
  // contrast-checked when the palette was built.
  const faded = [];
  for (const rule of alphaInkSelectors(donorCss)) {
    for (const t of [palette, palette.counterpart].filter(Boolean)) {
      const effective = blend(t.slabInk, t.slab, rule.alpha);
      if (contrastRatio(effective, t.slab) >= 4.5) continue;
      faded.push({ ...rule, mode: t.mode });
    }
  }
  for (const mode of ["light", "dark"]) {
    const sels = [...new Set(faded.filter((f) => f.mode === mode).map((f) => f.selector))];
    if (!sels.length) continue;
    // The default mode is scoped `:root:not([theme=other])` rather than plain
    // `:root`, for two reasons at once: `:root` alone would keep applying after
    // the toggle switched themes, and a bare attribute selector would apply
    // nothing at all if the boot script never ran. This form is correct with
    // JavaScript and correct without it — and it now carries the `.dark` class
    // twin (dark) / `:not(.dark)` guard (light) so the donor's class world and
    // our attribute world can never disagree about which ramp applies.
    lines.push(`${scopeSelectors(modeScopePrefixes(mode, defaultMode), sels)}{color:var(--wss-slab-muted)}`);
  }

  // The dark gradients the donor uses for hero washes and CTA bands.
  //
  // THE HERO GRADIENT IS DARK IN BOTH MODES, ON PURPOSE (WCAG audit
  // 2026-08-20: hero h1 white rgb(255,255,255) on rgb(253,252,252) = 1.02:1 in
  // LIGHT mode on ~6 live sites). The donors designed --gradient-hero as a
  // near-black wash under WHITE display text, and the engine's hero ink pass
  // (lib/hero-wash heroTextCss) forces that white with !important — so when
  // this variable was built from var(--wss-slab), whose LIGHT value is a pale
  // l=96 tint, the light theme painted a near-white wash under forced-white
  // words: an invisible headline shipped by two rules that were each correct
  // alone. The scrim base is therefore the DARK theme's slab whichever mode is
  // default — the light theme keeps its pale slabs everywhere else, and the
  // hero stays the cinematic dark surface its ink was proven against.
  {
    const darkTheme = palette.mode === "dark" ? palette : palette.counterpart;
    const heroScrim = (darkTheme && darkTheme.slab) || heroScrimFallback(palette.slab);
    lines.push(
      `:root{--wss-hero-scrim:${heroScrim};`
      + `--gradient-hero:linear-gradient(115deg,color-mix(in srgb,var(--wss-hero-scrim) 92%,transparent) 0%,`
      + `color-mix(in srgb,var(--wss-hero-scrim) 78%,transparent) 45%,`
      + `color-mix(in srgb,var(--wss-accent) 22%,transparent) 100%);`
      + `--gradient-primary:linear-gradient(135deg,var(--wss-slab) 0%,color-mix(in srgb,var(--wss-slab) 84%,var(--wss-accent)) 100%);`
      + `--gradient-accent:linear-gradient(135deg,var(--wss-accent) 0%,var(--wss-accent-hover) 100%);`
      + `--gradient-subtle:linear-gradient(180deg,var(--wss-surface) 0%,var(--wss-slab) 100%)}`,
    );
  }

  // THE BLURRY MOTION, IN THEIR COLOUR.
  //
  // The donor's `.aurora` is three hardcoded radial gradients in ITS orange and
  // ITS blue. Owner: "the blurry background motion should be in THEIR accent
  // colour, not ours." The alpha is capped hard in light mode — a wash strong
  // enough to be pretty is strong enough to drag body-text contrast under 4.5,
  // and the wash is decoration while the text is the product.
  if (auroras.length) {
    const alphaStrong = palette.mode === "dark" ? 38 : 20;
    const alphaSoft = palette.mode === "dark" ? 26 : 12;
    lines.push(
      `${auroras.map((c) => `.${c}`).join(",")}{`
      + `background-image:`
      + `radial-gradient(40% 30% at 20% 30%,color-mix(in srgb,var(--wss-accent) ${alphaStrong}%,transparent),transparent 60%),`
      + `radial-gradient(35% 25% at 80% 20%,color-mix(in srgb,var(--wss-accent-hover) ${alphaSoft}%,transparent),transparent 60%),`
      + `radial-gradient(45% 35% at 60% 80%,color-mix(in srgb,var(--wss-accent) ${alphaSoft}%,transparent),transparent 60%)`
      + `!important}`,
    );
  }
  // --gradient-mesh is the same wash expressed as a variable on hvac-premier.
  lines.push(
    `:root{--gradient-mesh:`
    + `radial-gradient(at 18% 18%,color-mix(in srgb,var(--wss-accent) ${palette.mode === "dark" ? 26 : 14}%,transparent) 0px,transparent 45%),`
    + `radial-gradient(at 82% 12%,color-mix(in srgb,var(--wss-accent-hover) ${palette.mode === "dark" ? 20 : 10}%,transparent) 0px,transparent 50%),`
    + `radial-gradient(at 65% 88%,color-mix(in srgb,var(--wss-accent) ${palette.mode === "dark" ? 20 : 10}%,transparent) 0px,transparent 45%)}`,
  );

  // THE BRAND COLOUR USED AS TEXT.
  //
  // `--accent` stays the client's true colour, because that is what fills their
  // buttons and what a customer recognises — TRUTH LAW applies to colour. But
  // `.text-accent` spends that same value on 10px eyebrows, and a mid-dark red
  // on a dark surface measured 3.72:1 in the dark theme. So the FILL keeps the
  // real colour and the TEXT role gets the contrast-enforced one. That is what
  // a designer does, and it is the same split already made for accent-soft.
  lines.push(`.text-accent{color:var(--wss-accent-soft)!important}`);

  // THE DONOR ACCENT-ROLE TOKENS, RESOLVED PER USE — the two-worlds
  // collision behind the Class B ghost stat cards (2026-09-04, fencing and
  // HVAC light mirrors, measured 1.02-1.11:1).
  //
  // The clean donors declare the accent pair with the OPPOSITE meaning of
  // the engine's tokens:
  //   --wss-accent-ink  = the ACCENT USED AS INK on the light surfaces
  //                       (stat numerals `.stat b`, nav hovers, ratings —
  //                       donor defaults are DARK: fencing #1d5138,
  //                       concrete #2a527f, hvac #98552b);
  //   --wss-accent-text = the INK ON THE ACCENT FILL (button labels —
  //                       donor defaults are WHITE).
  // buildPalette means the reverse (`-ink` = ink proven ON the accent,
  // `-text` = accent proven AS text on the paper), so repainting the tokens
  // verbatim shipped white stat numerals on near-white cards and
  // same-on-same button labels. The TOKENS stay exactly as buildPalette
  // computed them — the engine's own islands and the mobile CTA rule
  // consume the engine meanings — and the DONOR'S plain `color:` spends are
  // remapped rule-by-rule to the value proven for the role the donor's own
  // defaults prove the name plays. Detection is from declared defaults, not
  // a name guess: the swap fires only when the donor's own sheet declares
  // `-ink` dark and `-text` light. A donor that ships no such defaults (or
  // spells its tokens differently) gets a byte-identical sheet.
  {
    const rootDefault = (name) => {
      const re = new RegExp(`:root[^{}]*\\{[^{}]*${escVar(name)}\\s*:\\s*([^;}]+)`, "i");
      const m = re.exec(String(donorCss));
      return m ? normalizeHex(m[1]) : "";
    };
    const inkDefault = rootDefault("--wss-accent-ink");
    const textDefault = rootDefault("--wss-accent-text");
    const donorInksAccentAsText = !!inkDefault && !!textDefault
      && relativeLuminance(inkDefault) <= 0.35
      && relativeLuminance(textDefault) >= 0.85;
    if (donorInksAccentAsText) {
      // colorSpenders, not selectorsSpending: the clean donors spend these
      // names inside multi-declaration component rules, which the
      // single-declaration utility pass cannot see.
      const accentAsInkSpenders = colorSpenders(donorCss, "--wss-accent-ink");
      const inkOnAccentSpenders = colorSpenders(donorCss, "--wss-accent-text");
      if (accentAsInkSpenders.length) {
        // The donor paints TEXT with its accent-ink name: it wants the
        // accent-as-text value the palette walked to clear 4.5 on the paper
        // AND the cards.
        lines.push(`${accentAsInkSpenders.join(",")}{color:var(--wss-accent-text)}`);
      }
      if (inkOnAccentSpenders.length) {
        // The donor paints BUTTON LABELS with its accent-text name over the
        // accent fill: it wants the ink proven ON the accent.
        lines.push(`${inkOnAccentSpenders.join(",")}{color:var(--wss-accent-ink)}`);
      }
    }
    // THE ACCENT ITSELF, SPENT AS TEXT. `color: var(--wss-accent)` is always
    // the accent-as-text role — display phrases (hvac-premier's hero
    // `.accent-line`, final QA Class B: the raw brand blue at 4.27:1 on the
    // light hero), accent-colored links, eyebrows. The FILL role is
    // `background`/`border-color` and is untouched. Remapped to the
    // accent-text ink the palette walked to clear 4.5 on the paper AND the
    // cards. This half needs no convention detection: spending the accent
    // as its own text ink is same-on-same in every design language.
    const accentColorSpenders = colorSpenders(donorCss, "--wss-accent");
    if (accentColorSpenders.length) {
      lines.push(`${accentColorSpenders.join(",")}{color:var(--wss-accent-text)}`);
    }
  }

  // THE SAME SPLIT FOR A DONOR-PRIVATE ALIAS OF THE ACCENT. plumbing-clean
  // names its accent `--gold: hsl(var(--accent))` and spends it as footer
  // TEXT (`.text-gold`, the italic "Plumbing" in the brand lockup) — measured
  // 2.59:1 on the pale light-mode slab in the 2026-08-20 residual probe. The
  // FILL uses of the alias keep the true colour exactly as `.bg-accent` does;
  // only the TEXT role follows the contrast-enforced soft accent, which was
  // proven at 5.5:1 against both the surface and the slab when the palette
  // was built.
  {
    const accentAliasSels = [];
    for (const m of String(donorCss).matchAll(/(--[a-z0-9-]+)\s*:\s*(?:hsl\(\s*var\(--accent\)\s*\)|var\(--accent\))\s*[;}]/gi)) {
      for (const sel of selectorsSpending(donorCss, new RegExp(`^color:var\\(${escVar(m[1])}\\)`))) {
        if (!accentAliasSels.includes(sel)) accentAliasSels.push(sel);
      }
    }
    if (accentAliasSels.length) {
      lines.push(`${accentAliasSels.join(",")}{color:var(--wss-accent-soft)!important}`);
    }
  }

  // GRADIENT-CLIPPED DISPLAY TEXT.
  //
  // `.text-gradient-warm` sets `color:transparent` and paints the glyphs with
  // `linear-gradient(135deg,#fbfaf8,…,hsl(var(--accent-soft)))` — a HARDCODED
  // near-white fading into the accent, which is exactly right over a near-black
  // slab and invisible over a pale one. Retargeting both ends at mode-aware
  // variables keeps the donor's effect and makes it legible in either theme:
  // in dark mode slab-ink is near-white, in light mode it is near-black.
  //
  // `background-image`, NOT the `background` shorthand — and every declaration
  // carries !important. The first version used `background:…!important`, and
  // the shorthand resets EVERY background-* longhand, so `background-clip` went
  // back to `border-box` at !important weight and beat the `background-clip:text`
  // written two declarations later in the same rule. The glyphs stopped being a
  // mask and the gradient painted the whole box: the hero rendered a solid red
  // rectangle where "4.9 stars across 449 reviews." should have been.
  lines.push(
    `.text-gradient-warm{background-image:linear-gradient(135deg,var(--wss-slab-ink),`
    + `color-mix(in srgb,var(--wss-accent-soft) 60%,var(--wss-slab-ink)),`
    + `var(--wss-accent-soft))!important;-webkit-background-clip:text!important;`
    + `background-clip:text!important;color:transparent!important}`,
  );

  // THE DONOR'S OTHER GRADIENT TEXT, BY ITS ACTUAL NAME. fencing-sterling
  // spells its hero ink `.text-gradient` (no `-warm`) and hardcodes the gold
  // gradient — the literal-class pass above never matched it, and the hero
  // kept glowing donor-gold over a page rebuilt in the client's colours. The
  // class-agnostic pass finds gradient-clipped text painted from literals and
  // retargets it mode-aware, exactly as `-warm` is handled.
  {
    const gradientText = textGradientSelectors(donorCss)
      .filter((s) => s !== ".text-gradient-warm");
    if (gradientText.length) {
      lines.push(
        `${gradientText.join(",")}{background-image:linear-gradient(135deg,var(--wss-slab-ink),`
        + `color-mix(in srgb,var(--wss-accent-soft) 60%,var(--wss-slab-ink)),`
        + `var(--wss-accent-soft))!important;-webkit-background-clip:text!important;`
        + `background-clip:text!important;color:transparent!important}`,
      );
    }
  }

  // SELECTION PAINTED IN A LITERAL — `::selection{background:#e8a5304d}` is
  // donor gold on every highlighted paragraph. Repainted from the client's own
  // accent; the translucent wash mirrors the donor's own 30%-ish alpha.
  {
    const selections = selectionSelectors(donorCss);
    if (selections.length) {
      lines.push(
        `${selections.join(",")}{background-color:color-mix(in srgb,var(--wss-accent) 30%,transparent);`
        + `color:var(--wss-text)}`,
      );
    }
  }

  // A METALLIC OR GRADIENT MARK, KEPT AS A GRADIENT.
  //
  // Owner's case: "Platinum Plumbing" — a brushed-metal wordmark over white.
  // Averaging that to one swatch throws away the thing that makes it theirs, so
  // when the sampler reports a gradient we paint the real sweep on the surfaces
  // that can carry one and leave the flat accent for hairlines and small text,
  // which cannot.
  if (palette.gradient && palette.gradient.stops && palette.gradient.stops.length >= 2) {
    const stops = palette.gradient.stops.map((s, i, a) => `${s} ${Math.round((i / (a.length - 1)) * 100)}%`).join(",");
    lines.push(`:root{--wss-accent-gradient:linear-gradient(${palette.gradient.angle || 135}deg,${stops})}`);
    lines.push(`.bg-gradient-accent,.bg-accent{background-image:var(--wss-accent-gradient)!important}`);
  }

  // THE TOGGLE STAYS OFF THE HEADER AT EVERY VIEWPORT (audit A2, S5 — the
  // mobile rule already banished it below the fold for the same reason).
  // Pinned at top:14/right:14 it sat directly on the donor header's phone
  // CTA — donor header geometry varies across the library and the toggle
  // cannot know it, so it printed over the number on family after family.
  // It now joins the bottom-right fixed column, above the chat launcher AND
  // above the launcher's "AI Chat" tooltip (#wss-chat-cta, bottom:66px with a
  // measured 65px max height at 1280px — the Class E audit caught the toggle
  // at 86px printing straight through that tooltip on every family), and
  // rides the launcher's measured --wss-chat-clear lift (published on the
  // document root by the chat widget) so the column never folds back on
  // itself. 16 (root offset) + 66 (tooltip offset) + 66 (tooltip max height)
  // + 8 (gap) = 156px.
  lines.push(`.wss-theme-toggle{position:fixed;top:auto;right:max(16px,env(safe-area-inset-right));`
    + `bottom:calc(156px + var(--wss-chat-clear,0px) + var(--wss-chat-keyboard,0px) + env(safe-area-inset-bottom));`
    + `z-index:2147483000;display:inline-flex;align-items:center;gap:6px;`
    + `padding:7px 10px;border-radius:999px;border:1px solid var(--wss-border);background:var(--wss-surface-alt);`
    + `color:var(--wss-text);font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer;`
    + `box-shadow:0 2px 10px rgba(0,0,0,.10)}`);
  lines.push(`.wss-theme-toggle:hover{border-color:var(--wss-accent)}`);
  lines.push(`.wss-theme-toggle svg{width:14px;height:14px;display:block}`);
  // ONE SURFACE AT A TIME: when the chat panel opens it becomes the corner's
  // single fixed surface (the panel spans the full tooltip/toggle column), so
  // the toggle stands down instead of printing through it. :has() is a
  // progressive enhancement — where it is unsupported the toggle stays, exactly
  // as before this rule existed.
  lines.push(`body:has(#wss-chat-root[data-open="true"]) .wss-theme-toggle{display:none}`);
  lines.push(`@media print{.wss-theme-toggle{display:none}}`);

  // MOBILE TAP TARGETS (2026-08-20 audit: 40-53 links per site under 44px,
  // almost all footer/nav). A minimum hit height on the two regions that
  // carry link lists; inline-flex keeps them inline, so the visual design is
  // untouched beyond the touch area.
  lines.push(
    `@media (max-width:640px){nav a,nav button,footer a,footer button{`
    + `min-height:44px;display:inline-flex;align-items:center}}`,
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// the toggle
// ---------------------------------------------------------------------------

/**
 * The boot script. Goes in <head>, BEFORE the stylesheet paints, so a returning
 * visitor who chose dark never sees a white flash first.
 *
 * THE VISITOR'S STORED CHOICE WINS. Nothing else does — and the version of this
 * function that also consulted prefers-color-scheme is why.
 *
 * It read:
 *
 *     m = s || (d==="dark" && matchMedia("(prefers-color-scheme: light)").matches
 *              ? "light" : d)
 *
 * meaning a site we had MEASURED dark would hand itself back to light for any
 * visitor whose OS reported light. That reads as "yield to an explicit light
 * preference", but there is no such thing to yield to: `no-preference` was
 * dropped from the media-queries spec, so a browser that has never been told
 * anything answers `light`. Headless Chromium answers `light`. Windows and
 * macOS default to light. So the branch fired for very nearly everyone.
 *
 * Measured 2026-08-11 on the first client ever to reach it — Gunther Plumbing,
 * whose own site measures dark from the paper basis. The build was correct at
 * every layer: client_surface stored dark, decideMode returned dark, the served
 * HTML carried `d="dark"`. The rendered page was light. Three correct layers
 * and a white page, which is exactly the kind of failure a passing gate cannot
 * see and only a render can.
 *
 * `s || d` is also the symmetric rule, and symmetry is the point: a LIGHT site
 * already stayed light for a visitor whose OS was dark, deliberately, because
 * light is what that client's brand actually is. A DARK site now stays dark for
 * the same reason. We ship what we measured of their brand, and one click
 * changes it for anyone who wants something else.
 */
// ---------------------------------------------------------------------------
// typography scales — the third diversification axis
// ---------------------------------------------------------------------------
// Owner directive (2026-09-02 video report): mirrors built from the same
// donor share "typography scale" — every site wore the donor's exact heading
// rhythm because the engine only ever re-skinned colours. Three named scales
// now ship beside the palette; lib/mirror-engine/component-variants.js picks
// one per prospect (donor typography cues pin, the per-prospect seed chooses
// otherwise, the similarity budget guarantees two same-donor sites do not
// share one). The CSS keys on the scoping attribute the engine stamps on
// <html data-wss-type-scale="...">, so it composes with the donor's own
// families (sizes/spacing/leading only — never a font swap) and with both
// theme modes (no colours are touched here).
//
// "normal" is deliberately INERT: it is the donor's own scale, byte for byte,
// and one of the three legitimate selections — a scale that fights every
// donor would be a downgrade, not diversification.

const TYPOGRAPHY_SCALES = Object.freeze([
  Object.freeze({
    id: "condensed-tall",
    label: "Condensed / tall",
    description: "Larger, tighter headings: negative tracking, near-solid leading",
    h1: "clamp(2.75rem, 7vw, 4.75rem)",
    h2: "clamp(1.9rem, 4vw, 2.9rem)",
    h3: "clamp(1.35rem, 2.6vw, 1.85rem)",
    tracking: "-0.025em",
    leading: "0.98",
  }),
  Object.freeze({
    id: "normal",
    label: "Normal",
    description: "The donor's own heading scale, untouched (inert by design)",
  }),
  Object.freeze({
    id: "wide-short",
    label: "Wide / short",
    description: "Smaller, airier headings: open tracking, relaxed leading",
    h1: "clamp(2.1rem, 5vw, 3.4rem)",
    h2: "clamp(1.55rem, 3.2vw, 2.2rem)",
    h3: "clamp(1.15rem, 2.2vw, 1.5rem)",
    tracking: "0.012em",
    leading: "1.14",
  }),
]);

const TYPOGRAPHY_SCALE_IDS = Object.freeze(TYPOGRAPHY_SCALES.map((s) => s.id));

/**
 * typographyScaleCss(scaleId) -> string
 *
 * The heading-scale sheet for one scale. "" for "normal" (and for anything
 * unknown — an unrecognized id keeps the donor's scale rather than guessing).
 * !important is the same discipline as the theme sheet: donor rules keep
 * everything this sheet does not name.
 */
function typographyScaleCss(scaleId) {
  const scale = TYPOGRAPHY_SCALES.find((s) => s.id === String(scaleId || "").toLowerCase().trim());
  if (!scale || !scale.h1) return "";
  const scope = `html[data-wss-type-scale="${scale.id}"]`;
  return [
    `/* wss typography scale: ${scale.id} — ${scale.label} */`,
    `${scope}{--wss-h1-size:${scale.h1};--wss-h2-size:${scale.h2};--wss-h3-size:${scale.h3}}`,
    `${scope} h1{font-size:var(--wss-h1-size)!important;letter-spacing:${scale.tracking}!important;line-height:${scale.leading}!important}`,
    `${scope} h2{font-size:var(--wss-h2-size)!important;letter-spacing:calc(${scale.tracking} / 2)!important;line-height:calc(${scale.leading} + 0.08)!important}`,
    `${scope} h3{font-size:var(--wss-h3-size)!important;line-height:calc(${scale.leading} + 0.14)!important}`,
  ].join("\n") + "\n";
}

// THE CLASS RIDES WITH THE ATTRIBUTE, ALWAYS (the two-worlds fix, half 1 —
// see modeScopePrefixes). The shadcn donors key their dark styles on the
// `.dark` class; setting only our attribute left every donor dark rule
// stranded, and the 2026-08-20 audit measured the wreckage on live footers in
// both directions. One tiny helper, used by boot and by the toggle, so the two
// switches can never be flipped separately again.
function themeBootScript(defaultMode = "light") {
  return `<script>(function(){var r=document.documentElement;try{var K="wss-theme",d=${JSON.stringify(defaultMode)},s=localStorage.getItem(K);`
    + `if(s!=="light"&&s!=="dark"){s=null}`
    + `var m=s||d;r.setAttribute("${THEME_ATTR}",m);r.classList.toggle("dark",m==="dark")}`
    + `catch(e){r.setAttribute("${THEME_ATTR}",${JSON.stringify(defaultMode)});r.classList.toggle("dark",${JSON.stringify(defaultMode)}==="dark")}})();</script>`;
}

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

/**
 * The control itself. Injected before </body> — OUTSIDE the React root, for the
 * same reason the signup floater is: a compiled SPA owns everything inside
 * #root and will discard anything it did not render there.
 */
function themeToggleHtml(defaultMode = "light") {
  const initial = String(defaultMode).toLowerCase() === "dark" ? "dark" : "light";
  const lightHidden = initial === "dark" ? " hidden" : "";
  const darkHidden = initial === "dark" ? "" : " hidden";
  const label = initial === "dark" ? "Dark" : "Light";
  return `<button type="button" class="wss-theme-toggle" data-wss-theme-toggle aria-label="Switch between light and dark">`
    + `<span data-wss-icon-light${lightHidden}>${SUN}</span><span data-wss-icon-dark${darkHidden}>${MOON}</span>`
    + `<span data-wss-theme-label>${label}</span></button>`
    + `<script>(function(){var K="wss-theme",b=document.querySelector("[data-wss-theme-toggle]");if(!b)return;`
    + `var L=b.querySelector("[data-wss-icon-light]"),D=b.querySelector("[data-wss-icon-dark]"),T=b.querySelector("[data-wss-theme-label]");`
    + `function paint(){var m=document.documentElement.getAttribute("${THEME_ATTR}")==="dark"?"dark":"light";`
    // The class twin is re-synced on every paint — at boot AND after every
    // click — so the donor's `.dark`-keyed rules always agree with ours.
    + `document.documentElement.classList.toggle("dark",m==="dark");`
    + `L.hidden=m==="dark";D.hidden=m!=="dark";T.textContent=m==="dark"?"Dark":"Light";`
    + `b.setAttribute("aria-pressed",String(m==="dark"))}`
    + `b.addEventListener("click",function(){var m=document.documentElement.getAttribute("${THEME_ATTR}")==="dark"?"light":"dark";`
    + `document.documentElement.setAttribute("${THEME_ATTR}",m);document.documentElement.classList.toggle("dark",m==="dark");`
    + `try{localStorage.setItem(K,m)}catch(e){}paint()});paint()})();</script>`;
}

/**
 * accentBootstrapCss({ palette }) -> string
 *
 * THE ACCENT FLOOR — the unconditional half of the accent law (2026-09-03
 * micro-fix). The full themeCss sheet is deliberately conditional: a palette
 * that cannot clear contrast is refused and the sheet is not shipped. But the
 * engine's polish layers (mobile CTA visibility, the injected islands) consume
 * `--wss-accent` / `--wss-accent-hsl` on EVERY build, and a page that defines
 * neither token lets those consumers fall to hardcoded blues — exactly the
 * mixed-accent blemish the owner banned. This floor defines the accent pair
 * (hex AND triplet, plus the ink the pair needs) from the palette's own
 * accent — which buildPalette ALWAYS produces, whatever its source: the
 * client's colour, the donor family's token, or the vertical research. It
 * carries no body/surface rules, so refusing the full palette for contrast
 * still refuses unreadable text; it only guarantees that "what is the accent"
 * always has an answer in the site's own colour chain.
 *
 * Scoped exactly like themeCss's mode twins (the two-worlds fix): the main
 * palette on :root plus its attribute scope, the counterpart on its own
 * scope, so a light toggle never reads the dark accent.
 */
function accentBootstrapCss({ palette } = {}) {
  if (!palette || !palette.accent) return "";
  const triplet = hslTriplet(palette.accent);
  if (!triplet) return "";
  const vars = (t) => [
    `--wss-accent:${t.accent}`,
    `--wss-accent-hsl:${hslTriplet(t.accent)}`,
    `--wss-accent-ink:${t.accentInk || readableInkOn(t.accent)}`,
    `--wss-accent-hover:${t.accentHover || withLightness(t.accent, Math.max(10, hexToHsl(t.accent).l - 10))}`,
  ].join(";");
  const lines = [
    `/* wss accent bootstrap: the accent pair is defined on every build, even when the full theme sheet is refused. */`,
    `${modeScopePrefixes(palette.mode, palette.mode).join(",")}{${vars(palette)}}`,
  ];
  const other = palette.counterpart;
  if (other && other.accent && hslTriplet(other.accent)) {
    const scope = other.mode === "dark"
      ? `[${THEME_ATTR}="dark"],:root.dark`
      : `[${THEME_ATTR}="light"]:not(.dark)`;
    lines.push(`${scope}{${vars(other)}}`);
  }
  return lines.join("\n");
}

module.exports = {
  // decision
  decideMode,
  // brand_identity (the extraction lane's direct verdict)
  normalizeBrandIdentity, brandIdentityFont, brandIdentityLogoCss,
  // site_palette (the whole-website palette lane)
  normalizeSitePalette,
  googleFontsHref, leadFontFamily, WEB_SAFE_FAMILIES, GOOGLE_FAMILIES,
  // palette
  buildPalette, buildThemePair, fallbackPalette, VERTICAL_PALETTES,
  // css + markup
  themeCss, accentBootstrapCss, themeBootScript, themeToggleHtml, THEME_ATTR,
  // typography scales (the template-diversification heading axis)
  TYPOGRAPHY_SCALES, TYPOGRAPHY_SCALE_IDS, typographyScaleCss,
  modeScopePrefixes, scopeSelectors, heroScrimFallback,
  chainedColorTest, selectorsSpending, colorSpenders,
  darkSurfaceSelectors, lightSurfaceSelectors, darkTextUtilities,
  auroraSelectors, alphaInkSelectors, blend,
  darkCustomProperties, lightTextUtilities,
  textGradientSelectors, selectionSelectors,
  // colour maths (exported for tests and for callers that must re-check)
  normalizeHex, hexToHsl, hslToHex, hslTriplet, relativeLuminance, contrastRatio,
  enforceContrast, readableInkOn,
};
