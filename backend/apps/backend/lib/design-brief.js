"use strict";

const { boundedDetailText } = require("./detail-text");

// lib/design-brief.js — read the client's own site the way a designer would.
//
// OWNER, 2026-08-10: "screenshot theirs right off the gate, and then we know
// what their site should look like. Oh, they have a white background, they
// have a red accent colour, they're using this type of font, they have these
// images, they have these special graphics or offers on their page — and then
// we know what would be important to them to bring in."
//
// That is one paragraph describing two completely different kinds of knowing,
// and the whole design of this module is the line between them.
//
// ---------------------------------------------------------------------------
// MEASURE WHAT CAN BE MEASURED. SEE ONLY WHAT CANNOT.
// ---------------------------------------------------------------------------
// A vision model shown a solid #C53F34 swatch and asked to name it answered
// #C44B3B (Sonnet) and #D23B2A (Gemini) — measured, both providers, 2026-08-10.
// Both are plausible, both are wrong, and either one shipped as "their brand
// red" is a business's identity rendered in a colour they have never used.
// The same holds for image URLs, font names, and any number.
//
// So every FACT in this brief comes from the rendered DOM or from the
// screenshot's pixels:
//   · background and text colours          — computed styles + pixel histogram
//   · the real font families and weights   — computed styles, as RENDERED
//   · image URLs and their true dimensions — the DOM's own naturalWidth
//   · every candidate accent colour        — computed styles of action elements
//   · every crop rectangle                 — getBoundingClientRect
//
// and the vision pass is asked only for JUDGEMENT, which is the part a
// measurement genuinely cannot supply:
//   · which of the MEASURED colours is the one used for ACTION, as opposed to
//     a colour that merely appears a lot
//   · warm or cool, corporate or family-run
//   · which photographs are their crew / their van / their work, and which are
//     stock filler
//   · what is visually loudest on the page
//   · typography character in plain words
//
// The model never emits a hex, a URL, or a rectangle. It emits an INDEX into a
// measured list, and the value is looked up on this side. A hallucinated index
// is out of range and is refused; a hallucinated colour would have been
// indistinguishable from a real one.
//
// ---------------------------------------------------------------------------
// TRUTH LAW — and the one place it bites hardest
// ---------------------------------------------------------------------------
// The brief may only record what is VISIBLE. Anything unreadable is ABSENT,
// never guessed. There is no "probably".
//
// The sharpest edge is CLAIMS. "BBB A+ Accredited", "Master Plumber Lic.
// #44219", "25-Year Warranty", "Angi Super Service Award" — these are the loud
// graphics the owner wants carried over, and they are also exactly the things
// that must never be invented. This system has already shipped a manufacturer's
// badge as a client's own logo. A misread seal becomes a fabricated credential
// on a real business's website, which is a legal problem, not a design one.
//
// So loud elements split in two:
//   · DECORATIVE loudness (a promo banner, a big phone number, an owner photo,
//     a mascot, a truck) may be reported from the screenshot alone.
//   · A CLAIM (certification, licence, award, warranty, insurance, rating,
//     guarantee, accreditation, "family owned since 1974") is accepted ONLY
//     when the quoted text is also present in the measured DOM text. If vision
//     reads it off a JPEG and the DOM does not contain it, it is dropped into
//     brief.refusals with the reason — visible in the operator's output, absent
//     from the brief a builder consumes.
//
// ===========================================================================
// THE CONTRACT — what this emits and who reads which half
// ===========================================================================
//
// buildDesignBrief({ url }) resolves to a DESIGN BRIEF, version
// "design-brief-v1". The shape is stable; fields are added, never renamed or
// repurposed, and `version` changes if that promise is ever broken.
//
// Two mirrors of the same data:
//   brief.<field>              the plain value — a builder consumes this directly
//   brief.provenance.<field>   { source, confidence, note } for the same field
//
// `source` is one of FOUR values (a consumer must treat anything that is not
// "measured" as lower-trust, and must handle an unknown value as "seen"):
//   "measured"  read from the rendered DOM or the screenshot's pixels
//   "seen"      a vision judgement over the screenshot
//   "derived"   computed from a measured value by a documented rule
//   "absent"    NOT KNOWN. The value is null / "" / []. Never a guess.
//
// `confidence` is 0..1. Measured fields carry a confidence computed from
// coverage or ranking margin. Seen fields are clamped to SEEN_CONFIDENCE_CEILING
// so that nothing judged from a picture can ever read as certain.
//
// ---------------------------------------------------------------------------
// FIELDS
// ---------------------------------------------------------------------------
//   mode          "light" | "dark"      measured from surface luminance
//   surface       "#RRGGBB" | null      the page background a visitor sees
//   text          "#RRGGBB" | null      the body copy colour
//   muted         "#RRGGBB" | null      secondary text colour (absent if none)
//   border        "#RRGGBB" | null      the commonest hairline colour
//   accent        "#RRGGBB" | null      THE BRAND COLOUR, exactly as measured
//   accentText    "#RRGGBB" | null      accent when used AS TEXT on `surface`
//   accentHover   "#RRGGBB" | null      derived hover state of `accent`
//   fontDisplay   "Anton" | null        family actually rendering the headlines
//   fontBody      "Inter" | null        family actually rendering body copy
//   fontHref      url | ""              a stylesheet that really serves them
//   fontWeights   { display:[], body:[] }
//   typographyCharacter  "heavy industrial" | null      (seen)
//   temperature   "warm"|"cool"|"neutral"|null          (seen)
//   character     "family-run"|"corporate"|...|null     (seen)
//   heroImage     { url, width, height, alt, kind } | null
//   heroSlogan    { text, display, fontSize, index, source } | null
//                 THEIR OWN HERO SENTENCE, verbatim from the DOM ("BIG CITY
//                 SERVICE. SMALL TOWN VALUE"). `display` is the same words
//                 case-folded when the DOM shouts; `source` says whether
//                 vision confirmed the pick. This is the field the build
//                 lane's slogan rule reads — see deriveHeroSlogan.
//   identityImages[]  { url, width, height, alt, what, confidence }
//   loudElements[]    { kind, text, textVerified, isClaim, rect, crop, viewport, confidence }
//   carryOver[]       { what, why, anchor, confidence }
//   colorAdjustments[] { field, original, adjusted, target, ratioBefore, ratioAfter, against }
//   refusals[]        { field, reason, detail }   — everything DROPPED, and why
//   measurements      the raw measured evidence (candidate lists, histograms)
//
// ---------------------------------------------------------------------------
// COLOUR RULE (spec point 4) — a brand colour is NEVER silently changed
// ---------------------------------------------------------------------------
//   brief.accent      is the client's colour, untouched, whatever it measures.
//                     Fills, chrome and graphics use this. It is the value the
//                     palette work wants.
//   brief.accentText  is the same colour ONLY IF it clears TEXT_CONTRAST_TARGET
//                     (4.5:1) against brief.surface. If it does not, this is a
//                     compliant NEAR-NEIGHBOUR: the identical hue and
//                     saturation, walked in lightness until it passes — so a
//                     client's gold stays gold instead of collapsing to black.
//   brief.colorAdjustments records every such adjustment with the original hex,
//                     both contrast ratios and the target. An empty array means
//                     nothing was touched.
// A builder that paints accent-coloured TEXT and reads `accent` instead of
// `accentText` will ship illegible copy. That is the only trap in this shape,
// which is why it is stated here rather than in a comment further down.
//
// ---------------------------------------------------------------------------
// WHO READS WHAT
// ---------------------------------------------------------------------------
// THE PHOTO HARVESTER (being written in parallel; lib/mirror-engine/client-photos.js
// is its neighbour) should read ONLY:
//     brief.heroImage            — the client's own lead image, if there is one
//     brief.identityImages[]     — .url .width .height .alt .what
//     brief.measurements.images[] — the FULL candidate list, including the ones
//                                  vision called filler, each carrying
//                                  { url, kind, naturalWidth, naturalHeight,
//                                    renderedArea, inFirstViewport, alt,
//                                    sameOrigin, logoLike, thirdPartyMark,
//                                    photoFloor }
//     brief.measurements.logo    — the client's OWN mark: { url, alt, rect,
//                                  naturalWidth, naturalHeight, inHeader }, or
//                                  null. Third-party marks are excluded from
//                                  this choice, not merely outranked, and each
//                                  exclusion appears in brief.refusals.
// `sameOrigin` is a CONVENIENCE, not an ownership verdict — and it is emphatically
// not ownership of the MARK: HomeAdvisor's badges are served from
// whitebirdfence.com's own /wp-content/. `thirdPartyMark` is the flag that
// matters there, and images carrying it never clear `photoFloor`.
// The harvester still owns the ownership gate and must run it — this module
// does not fetch bytes, does not sniff types, and does not know about builder
// CDNs. Treat every URL here as a CANDIDATE, exactly as it treats the Genie's.
// Ordering in identityImages[] is meaningful: it is the order to fill photo
// slots, best first. Order in measurements.images[] is by rendered area.
//
// THE PALETTE WORK (lib/mirror-engine/theme.js, lib/owner-pride.js) should read:
//     brief.accent        -> theme.buildThemePair({ accent })   <- the brand colour
//     brief.surface, brief.text, brief.muted, brief.border       <- what they had
//     brief.mode          -> theme.decideMode's client-side input
//     brief.accentText    ONLY when painting accent-coloured text directly
//     brief.colorAdjustments  to report honestly that we adjusted anything
// theme.buildThemePair does its own contrast enforcement over the whole
// palette; do not pre-adjust `accent` before handing it over, or the
// enforcement runs twice and the client's colour drifts twice.
//
// THE EMAIL / OUTREACH SIDE should read:
//     brief.loudElements[] — what the business is shouting about is what the
//                            pitch should mention. `isClaim` entries are
//                            DOM-verified and safe to quote; the rest are
//                            descriptions of a graphic, not quotations.
//     brief.carryOver[]    — "the things a customer would miss if they were
//                            gone", i.e. the checklist for the mirror.
//
// NOBODY should read brief.measurements.* as if it were decided. Those are
// ranked candidates and raw histograms, kept so a human can audit a verdict.
//
// ---------------------------------------------------------------------------
// DEPENDENCIES
// ---------------------------------------------------------------------------
// Colour maths comes from lib/mirror-engine/theme.js, which exports it
// explicitly "for callers that must re-check". That reuse is deliberate and
// load-bearing: if this module enforced contrast with its own algorithm, the
// brief and the palette step would disagree about what "compliant" means and
// the client's colour would land in two different places. test/design-brief.test.js
// asserts those exports still exist, so a rename is caught by the suite.
//
// Chromium comes from lib/serverless-chromium (required lazily, so unit tests
// and serverless bundles that never capture do not pull playwright in).

const {
  normalizeHex,
  hexToHsl,
  hslToHex,
  relativeLuminance,
  contrastRatio,
  enforceContrast,
} = require("./mirror-engine/theme");

const BRIEF_VERSION = "design-brief-v1";

// WCAG AA for normal-size text. The floor, not an aspiration.
const TEXT_CONTRAST_TARGET = 4.5;

// Nothing judged from a picture may read as certain.
const SEEN_CONFIDENCE_CEILING = 0.85;

// Above this HSL saturation a colour is a BRAND colour, not secondary copy.
// See the muted decision in briefFromMeasurement for why this exists.
const MUTED_MAX_CHROMA = 30;

const DESKTOP = Object.freeze({ width: 1280, height: 800 });
const MOBILE = Object.freeze({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

// A full-page shot of a long marketing site is 12,000px tall; a vision model
// reads none of it well. Two desktop screens plus the mobile fold is where the
// loud things live, and it keeps the request small enough to be affordable.
const VISION_SCREENS = 2;

const MAX_ACCENT_CANDIDATES = 8;
const MAX_LOUD_CANDIDATES = 14;
const MAX_IMAGE_CANDIDATES = 24;
const MAX_LOUD_ELEMENTS = 6;
const MAX_IDENTITY_IMAGES = 12;

// ---------------------------------------------------------------------------
// THE THREE RECORDED FAULTS (8-site run, 2026-08-11) — fixed 2026-08-12
// ---------------------------------------------------------------------------
// (a) ACCENT INSTABILITY ON TWO-COLOUR BRANDS. Scores are built from rendered
//     AREA, and area jitters between renders (animation state, responsive
//     reflow, a carousel mid-slide). On a brand with two real action colours
//     the two scores sit close enough that the jitter chose the winner, so the
//     same site briefed red on one run and blue on the next. The sort is now
//     fully deterministic (explicit tie-breaker chain down to the hex string),
//     and a NEAR-TIE inside ACCENT_TIE_MARGIN is decided by discrete keys that
//     do not jitter — the ACTION colour first (a filled button IS the action
//     colour; an ink might be body text), then a colour used as both fill and
//     ink, then element count, then the hex itself. Same site, same accent,
//     every run.
// (b) NEAR-WHITE ACCENTS. A page whose loudest clickable colour is white
//     (ghost buttons on photography) used to report that white as "the brand
//     colour". chromaWeight outranks it when anything saturated exists; when
//     nothing does, the brief must ABSTAIN — a near-neutral is not a brand
//     colour, and a builder painting CTAs #F8F8F9 ships invisible buttons.
//     Below ACCENT_MIN_CHROMA the accent is refused, recorded, and absent.
// (c) CLIENT PHOTOS ON THIRD-PARTY CDNs. capture-brand's denylist knows hosts
//     (cdninstagram, fbcdn) and mark-ish basenames, which is right for MARKS —
//     and wrong for the client's own PHOTOGRAPHS served from their embedded
//     Instagram feed. A 1080px photograph of their crew is not Instagram's
//     trademark because Instagram's CDN served it. Photo-shaped images now face
//     only the NAME test (alt text calling it somebody's mark); mark-shaped
//     images (logo-like or small) still face the full URL denylist. Refuse
//     marks, keep photos.
const ACCENT_MIN_CHROMA = 12;   // HSL saturation floor, %; below this: abstain
const ACCENT_TIE_MARGIN = 0.15; // relative score gap treated as a tie

/** Why this hex may not be a brand accent, or "" when it may. */
function accentFloorReason(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return "unparseable colour";
  if (hsl.s < ACCENT_MIN_CHROMA) {
    return `saturation ${Math.round(hsl.s)}% is below the ${ACCENT_MIN_CHROMA}% accent floor — a near-neutral is not a brand colour`;
  }
  return "";
}

/**
 * Kinds of loud element that assert something about the business rather than
 * merely decorating it. These are accepted ONLY with DOM-verified text.
 * A misread badge here is a fabricated credential on a real business's site.
 */
const CLAIM_KINDS = Object.freeze(new Set([
  "certification", "certificate", "license", "licence", "accreditation",
  "award", "warranty", "guarantee", "insurance", "rating", "credential",
  "affiliation", "membership", "years_in_business", "badge", "seal",
]));

/** Words that make a loud element a claim regardless of what vision called it. */
const CLAIM_WORDS = /\b(certified|certificate|accredit\w*|licen[cs]\w*|insured|bonded|award(?:ed|s)?|warrant\w+|guarantee\w*|approved|authori[sz]ed dealer|BBB|A\+|EPA|NATE|OSHA|IICRC|master (?:plumber|electrician)|since \d{4}|\d+\s*(?:\+\s*)?years?\b|#?\d{4,}\s*(?:lic|license|licence))/i;

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

const clamp01 = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(1, Number(n))) : 0);
const round2 = (n) => Number(Number(n).toFixed(2));

/** Lowercased, punctuation-stripped, whitespace-collapsed — for claim matching. */
function normalizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** HSL saturation 0..100 of a hex, or 0 when unparseable. */
function chromaOf(hex) {
  const hsl = hexToHsl(hex);
  return hsl ? hsl.s : 0;
}

/** How near-neutral a colour is. Greys score ~0, saturated colours ~1. */
function chromaWeight(hex) {
  const s = chromaOf(hex);
  if (s >= 45) return 1;
  if (s >= 25) return 0.75;
  if (s >= 12) return 0.4;
  return 0.12; // a genuinely monochrome brand is real, just heavily outranked
}

/** Are two colours close enough that a visitor would call them the same? */
function nearlySame(a, b, tolerance = 0.06) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return false;
  const ha = hexToHsl(a);
  const hb = hexToHsl(b);
  if (!ha || !hb) return false;
  const hueGap = Math.min(Math.abs(ha.h - hb.h), 360 - Math.abs(ha.h - hb.h));
  return Math.abs(la - lb) <= tolerance && (ha.s < 10 || hb.s < 10 || hueGap <= 12);
}

/** "light" | "dark" from a surface colour. Measured, not opinion. */
function modeOfSurface(hex) {
  const lum = relativeLuminance(hex);
  if (lum == null) return "light";
  return lum < 0.32 ? "dark" : "light";
}

/**
 * The hover state of a brand colour: the SAME hue and saturation, moved a
 * documented 8 lightness points away from the surface. Derived, and labelled
 * derived — a real hover colour would have to be measured from a :hover state
 * we cannot trigger reliably on an unknown page.
 */
function hoverOf(accent, surface) {
  const hsl = hexToHsl(accent);
  if (!hsl) return "";
  const surfaceLum = relativeLuminance(surface);
  const lighten = surfaceLum != null && surfaceLum < 0.35;
  const l = Math.max(0, Math.min(100, hsl.l + (lighten ? 8 : -8)));
  return hslToHex({ ...hsl, l });
}

/**
 * Spec point 4, entire. Returns the brand colour untouched plus a text-safe
 * neighbour, and says so out loud when they differ.
 */
function resolveAccentColours(accent, surface) {
  const brand = normalizeHex(accent);
  const bg = normalizeHex(surface);
  if (!brand) return { accent: null, accentText: null, accentHover: null, adjustment: null };
  if (!bg) {
    return { accent: brand, accentText: brand, accentHover: hoverOf(brand, "#FFFFFF") || null, adjustment: null };
  }

  const ratioBefore = contrastRatio(brand, bg);
  const hover = hoverOf(brand, bg) || null;
  if (ratioBefore >= TEXT_CONTRAST_TARGET) {
    return { accent: brand, accentText: brand, accentHover: hover, adjustment: null };
  }

  const direction = relativeLuminance(bg) > 0.4 ? "darker" : "lighter";
  const adjusted = normalizeHex(enforceContrast(brand, bg, TEXT_CONTRAST_TARGET, direction));
  const ratioAfter = contrastRatio(adjusted, bg);
  return {
    accent: brand,
    accentText: adjusted || brand,
    accentHover: hover,
    adjustment: {
      field: "accentText",
      original: brand,
      adjusted: adjusted || brand,
      target: TEXT_CONTRAST_TARGET,
      ratioBefore: round2(ratioBefore),
      ratioAfter: round2(ratioAfter),
      against: bg,
      note: "brand colour preserved in brief.accent; only text use was moved",
    },
  };
}

// ---------------------------------------------------------------------------
// the in-page measurement — this function is serialised into Chromium
// ---------------------------------------------------------------------------

/* eslint-disable no-undef */
/**
 * Runs inside the page. Returns only JSON-serialisable data. The page must be
 * scrolled to the top when this runs, so viewport rects + scroll offsets give
 * true document coordinates.
 *
 * Nothing here decides anything. It counts.
 */
function measureInPage(config) {
  const cfg = config || {};
  const MAX_ELEMENTS = cfg.maxElements || 8000;
  const MAX_TEXT_CHARS = cfg.maxTextChars || 30000;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || 0;
  const docHeight = Math.max(
    document.documentElement ? document.documentElement.scrollHeight : 0,
    document.body ? document.body.scrollHeight : 0,
    vh,
  );

  function parseColor(css) {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(String(css || ""));
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (!(a > 0)) return null;
    const h = (v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, "0");
    return { hex: ("#" + h(m[1]) + h(m[2]) + h(m[3])).toUpperCase(), alpha: a };
  }

  function firstFamily(css) {
    const raw = String(css || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (!raw) return "";
    const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|inherit|initial|unset)$/i;
    return generic.test(raw) ? "" : raw;
  }

  // Direct text nodes only. Correct for the per-CHARACTER statistics — colour
  // and font are counted per element, and walking an ancestor's descendants
  // would count the same characters once per level of nesting.
  function ownText(el) {
    let out = "";
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i += 1) {
      if (kids[i].nodeType === 3) out += kids[i].nodeValue;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  // Everything a reader sees in this element, children included. Required
  // wherever the string is QUOTED rather than counted.
  //
  // Measured 2026-08-11. rockys.plumbing's hero is
  //   <h1>THE <strong>PLUMBER</strong> CHICKAMAUGA DESERVES</h1>
  // and ownText returns "The Chickamauga Deserves" — the headline with a word
  // removed and the remaining words reading as a different sentence.
  // columbusfence.com's phone is split the same way and ownText returned
  // "(662) 328-620", a real business's number missing its last digit.
  //
  // Both then passed the DOM-verification gate, because the gate compares the
  // model's quote against the same truncated text this function produced — so
  // they arrived carrying textVerified:true, which the contract tells
  // consumers is the signal that a string is safe to quote.
  // WHY innerText AND NOT textContent.
  //
  // textContent concatenates every descendant text node with NOTHING between
  // them, so two block children fuse into one word at the seam. Universal
  // Plumbing (Augusta GA) has an <h1> "QUICK RESPONSE, FLAT RATES" with a
  // "NOW HIRING" BUTTON beneath it inside the same hero block; this function
  // returned "Quick Response, Flat RatesNow Hiring." and that string shipped
  // as the h1 of their live mirror — measured 2026-08-12, the largest line on
  // the page. Velocity Flow shipped "Jacksonville HVAC Service.Fast Comfort,
  // Done Right." the same way.
  //
  // innerText is defined as the text AS RENDERED: it inserts the line breaks
  // the layout actually produces, so the seam becomes a space and a button on
  // its own line stops being welded to the heading above it. That is also what
  // this brief already claims to hand out — "the page's own DOM text verbatim"
  // — so textContent was never the faithful reading, only the cheap one.
  //
  // textContent stays as the fallback for nodes innerText cannot serve
  // (detached or never-rendered elements return "" from innerText).
  function fullText(el) {
    const rendered = String((el && el.innerText) || "").replace(/\s+/g, " ").trim();
    if (rendered) return rendered;
    return String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  }

  // The smallest element that holds the WHOLE line.
  //
  // WYSIWYG builders split a text node wherever the owner once put the caret,
  // and the leftover lands on the PARENT. columbusfence.com serves its phone as
  //   <font class="lh-1"><font>(662) 328-620</font>3</font>
  // The inner font is a loud candidate (48px, thirteen characters of own text);
  // the outer one is not, because its own text is the single character "3".
  // So the tallest type on the page reported a real business's phone number
  // with the last digit missing, and marked it DOM-verified.
  //
  // Climbing while the parent renders at the same size and contributes only a
  // few more characters recovers the whole line without ever walking up into a
  // section wrapper — a container adds far more than a stray digit.
  function quotableText(el, fontSize) {
    let node = el;
    let best = fullText(el);
    for (let hops = 0; hops < 3; hops += 1) {
      const parent = node.parentElement;
      if (!parent) break;
      let parentSize = 0;
      try { parentSize = parseFloat(getComputedStyle(parent).fontSize) || 0; } catch (e) { break; }
      if (Math.abs(parentSize - fontSize) > 0.5) break;
      const ptext = fullText(parent);
      if (!ptext.includes(best) || ptext.length > best.length + 12) break;
      best = ptext;
      node = parent;
    }
    return best;
  }

  function bump(map, key, amount) {
    if (!key) return;
    map[key] = (map[key] || 0) + amount;
  }

  const backgrounds = {};      // hex -> visible area
  const textColors = {};       // hex -> characters
  const borderColors = {};     // hex -> occurrences
  const fontStats = {};        // family -> { chars, maxSize, area, weights{} }
  const actionFills = {};      // hex -> { area, count, labels[] }
  const actionInks = {};       // hex -> { chars, count, labels[] }
  const chromaAreas = {};      // hex -> area, for "merely appears a lot"
  const loudCandidates = [];
  const images = [];
  const seenImageUrls = {};
  const visibleText = [];
  const logoCandidates = [];
  let textCharTotal = 0;

  const ACTION_SELECTOR = 'a[href], button, [role="button"], input[type="submit"], input[type="button"], [class*="btn" i], [class*="cta" i], [class*="button" i]';
  const LOUD_SELECTOR = '[class*="badge" i], [class*="banner" i], [class*="promo" i], [class*="offer" i], [class*="financ" i], [class*="emergency" i], [class*="award" i], [class*="cert" i], [class*="warrant" i], [class*="ribbon" i], [class*="alert" i], [class*="sticky" i]';

  const all = document.querySelectorAll("*");
  const limit = Math.min(all.length, MAX_ELEMENTS);

  for (let i = 0; i < limit; i += 1) {
    const el = all[i];
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "head" || tag === "meta" || tag === "link") continue;

    let rect;
    try { rect = el.getBoundingClientRect(); } catch (e) { continue; }
    if (!rect || rect.width < 1 || rect.height < 1) continue;

    let cs;
    try { cs = window.getComputedStyle(el); } catch (e) { continue; }
    if (!cs || cs.visibility === "hidden" || cs.display === "none") continue;
    const opacity = Number(cs.opacity);
    if (Number.isFinite(opacity) && opacity < 0.08) continue;

    const docX = rect.left + scrollX;
    const docY = rect.top + scrollY;
    if (docY > docHeight + vh) continue;

    const area = Math.max(0, Math.min(rect.width, vw * 1.5)) * Math.max(0, rect.height);
    const inFirstViewport = docY < vh && docY + rect.height > 0;

    // --- background -------------------------------------------------------
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg.alpha >= 0.9) {
      bump(backgrounds, bg.hex, area);
      bump(chromaAreas, bg.hex, area);
    }

    // --- borders ----------------------------------------------------------
    const bw = Math.max(
      parseFloat(cs.borderTopWidth) || 0, parseFloat(cs.borderBottomWidth) || 0,
      parseFloat(cs.borderLeftWidth) || 0, parseFloat(cs.borderRightWidth) || 0,
    );
    if (bw > 0 && bw <= 4) {
      const bc = parseColor(cs.borderTopColor) || parseColor(cs.borderBottomColor);
      if (bc && bc.alpha >= 0.5) bump(borderColors, bc.hex, 1);
    }

    // --- text -------------------------------------------------------------
    const own = ownText(el);
    const fontSize = parseFloat(cs.fontSize) || 0;
    const weight = parseInt(cs.fontWeight, 10) || (/bold/i.test(cs.fontWeight) ? 700 : 400);
    const ink = parseColor(cs.color);

    if (own) {
      if (ink && ink.alpha >= 0.5) bump(textColors, ink.hex, own.length);
      const family = firstFamily(cs.fontFamily);
      if (family) {
        const f = fontStats[family] || (fontStats[family] = { chars: 0, maxSize: 0, area: 0, weights: {} });
        f.chars += own.length;
        f.area += area;
        if (fontSize > f.maxSize) f.maxSize = fontSize;
        f.weights[String(weight)] = (f.weights[String(weight)] || 0) + own.length;
      }
      if (textCharTotal < MAX_TEXT_CHARS) {
        visibleText.push(own.slice(0, 400));
        textCharTotal += own.length;
        // The whole string too, when children hold part of it. Without this the
        // claim gate can only ever verify the fragment, so a correctly-quoted
        // headline would be refused as unverifiable while its mangled twin
        // passed.
        const whole = quotableText(el, fontSize);
        if (whole !== own && whole.length <= 400) visibleText.push(whole);
      }
    }

    // --- action colours (the accent SHORTLIST) ----------------------------
    let isAction = false;
    try { isAction = el.matches(ACTION_SELECTOR); } catch (e) { isAction = false; }
    if (isAction) {
      const label = (own || String(el.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 60);
      if (bg && bg.alpha >= 0.5) {
        const f = actionFills[bg.hex] || (actionFills[bg.hex] = { area: 0, count: 0, labels: [] });
        f.area += area;
        f.count += 1;
        if (label && f.labels.length < 4 && f.labels.indexOf(label) === -1) f.labels.push(label);
      }
      if (ink && ink.alpha >= 0.5 && label) {
        const f = actionInks[ink.hex] || (actionInks[ink.hex] = { chars: 0, count: 0, labels: [] });
        f.chars += label.length;
        f.count += 1;
        if (f.labels.length < 4 && f.labels.indexOf(label) === -1) f.labels.push(label);
      }
    }

    // --- loud candidates --------------------------------------------------
    let classLoud = false;
    try { classLoud = el.matches(LOUD_SELECTOR); } catch (e) { classLoud = false; }
    const pinned = cs.position === "fixed" || cs.position === "sticky";
    const bigType = fontSize >= 20 && own.length >= 3;
    const colouredBlock = !!(bg && bg.alpha >= 0.7 && area >= vw * vh * 0.015 && own.length >= 3);
    if (own && (bigType || classLoud || (pinned && own.length >= 3) || colouredBlock)) {
      loudCandidates.push({
        // Not `own`: this string gets QUOTED. See fullText and quotableText.
        text: quotableText(el, fontSize).slice(0, 180),
        tag,
        className: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").slice(0, 120),
        fontSize,
        weight,
        color: ink ? ink.hex : "",
        background: bg && bg.alpha >= 0.5 ? bg.hex : "",
        pinned,
        classLoud,
        inFirstViewport,
        rect: { x: Math.round(docX), y: Math.round(docY), width: Math.round(rect.width), height: Math.round(rect.height) },
        area: Math.round(area),
      });
    }

    // --- background images ------------------------------------------------
    const bgImage = cs.backgroundImage;
    if (bgImage && bgImage !== "none" && area >= 40000) {
      const m = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(bgImage);
      if (m && m[1] && !/^data:/i.test(m[1])) {
        let abs = m[1];
        try { abs = new URL(m[1], document.baseURI).toString(); } catch (e) { /* keep raw */ }
        if (!seenImageUrls[abs]) {
          seenImageUrls[abs] = true;
          images.push({
            url: abs, kind: "background", alt: "",
            naturalWidth: 0, naturalHeight: 0,
            renderedWidth: Math.round(rect.width), renderedHeight: Math.round(rect.height),
            renderedArea: Math.round(area), x: Math.round(docX), y: Math.round(docY),
            inFirstViewport, logoLike: false,
          });
        }
      }
    }
  }

  // --- <img> ---------------------------------------------------------------
  const imgs = document.images || [];
  for (let i = 0; i < imgs.length; i += 1) {
    const img = imgs[i];
    let rect;
    try { rect = img.getBoundingClientRect(); } catch (e) { continue; }
    if (!rect || rect.width < 8 || rect.height < 8) continue;
    let cs;
    try { cs = window.getComputedStyle(img); } catch (e) { cs = null; }
    if (cs && (cs.visibility === "hidden" || cs.display === "none")) continue;

    const url = img.currentSrc || img.src || "";
    if (!url || /^data:/i.test(url)) continue;
    const alt = String(img.alt || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const cls = String(img.className || "");
    const inHeader = !!(img.closest && img.closest("header, nav, [class*='header' i], [class*='nav' i]"));
    // WHAT MAKES AN IMAGE "LOGO-LIKE" — measured on familyhvac.net 2026-08-12.
    // Their owner portrait's SEO alt reads "...technician in blue shirt with
    // Family Heating & Air Conditioning logo, smiling..." and their team photo
    // says "...posing in front of their branded service van..." — the words
    // "logo" and "brand" in a SENTENCE DESCRIBING a photograph, and the flag
    // classified all three of their identity photos as logos, which refused
    // the owner's own face from identityImages downstream. So:
    //   · the FILE'S OWN NAME saying logo/brand/wordmark makes it a mark
    //     (logo@2x.png is a logo whatever size it renders);
    //   · alt/class mentions make it a mark ONLY when the image is mark-SIZED
    //     — a photograph-sized image whose caption mentions a logo is a
    //     photograph OF things that carry logos, which describes every crew
    //     photo ever taken. (The third-party gate is separate and untouched:
    //     alt naming someone ELSE'S mark still refuses the image wherever it
    //     is consumed.)
    const basename = (url.split("/").pop() || "").split("?")[0];
    const markSized = rect.width < 320 || rect.height < 200;
    const logoLike = /logo|brand|wordmark|\bmark\b/i.test(basename) ||
      (markSized && /logo|brand|wordmark|mark\b/i.test(alt + " " + cls)) ||
      (inHeader && rect.width <= 360 && rect.height <= 160);
    const docX = rect.left + scrollX;
    const docY = rect.top + scrollY;

    // EVERY logo-like image, not the first one. Choosing here would mean
    // choosing by document order, and document order is how a HomeAdvisor
    // badge or a manufacturer's mark becomes "the client's logo". The choice
    // is made in Node, where the third-party denylist lives.
    if (logoLike) {
      logoCandidates.push({
        url, alt, className: String(img.className || "").slice(0, 120), inHeader,
        order: logoCandidates.length,
        naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0,
        rect: { x: Math.round(docX), y: Math.round(docY), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    }

    if (seenImageUrls[url]) continue;
    seenImageUrls[url] = true;
    images.push({
      url, kind: "img", alt,
      naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0,
      renderedWidth: Math.round(rect.width), renderedHeight: Math.round(rect.height),
      renderedArea: Math.round(rect.width * rect.height),
      x: Math.round(docX), y: Math.round(docY),
      inFirstViewport: docY < vh && docY + rect.height > 0,
      logoLike,
    });
  }

  // --- <video> posters ------------------------------------------------------
  const videos = document.querySelectorAll("video");
  for (let i = 0; i < videos.length; i += 1) {
    const v = videos[i];
    let rect;
    try { rect = v.getBoundingClientRect(); } catch (e) { continue; }
    if (!rect || rect.width < 40 || rect.height < 40) continue;
    const src = v.currentSrc || v.src || (v.querySelector("source") ? v.querySelector("source").src : "");
    const poster = v.poster || "";
    const docY = rect.top + scrollY;
    [{ u: poster, k: "video-poster" }, { u: src, k: "video" }].forEach((entry) => {
      if (!entry.u || /^data:/i.test(entry.u) || seenImageUrls[entry.u]) return;
      seenImageUrls[entry.u] = true;
      images.push({
        url: entry.u, kind: entry.k, alt: "",
        naturalWidth: v.videoWidth || 0, naturalHeight: v.videoHeight || 0,
        renderedWidth: Math.round(rect.width), renderedHeight: Math.round(rect.height),
        renderedArea: Math.round(rect.width * rect.height),
        x: Math.round(rect.left + scrollX), y: Math.round(docY),
        inFirstViewport: docY < vh && docY + rect.height > 0,
        logoLike: false,
      });
    });
  }

  // --- effective page background (walk body -> html) -----------------------
  let bodySurface = "";
  let node = document.body;
  while (node) {
    const c = parseColor(window.getComputedStyle(node).backgroundColor);
    if (c && c.alpha >= 0.9) { bodySurface = c.hex; break; }
    node = node.parentElement;
  }

  // --- the theme's own declared brand tokens --------------------------------
  //
  // Measured on hurricanefenceinc.com (2026-09 diagnostic): every button on the
  // page renders white or outline, so the action-fill shortlist came back
  // empty — while the theme declares its brand outright in a plain <style>
  // block: `:root { --main: #091e3a; --accent: #e31e24; }`. Most WordPress
  // themes (block-theme global styles, Elementor, Bricks) do exactly this. A
  // brief that only measures FILLS is blind to the one colour the theme was
  // built around, so we read the declared custom properties off the document
  // element too. Values are returned AS DECLARED (custom properties are not
  // computed colours); parsing and ranking happen on the Node side.
  const ROOT_TOKEN_NAMES = ["--accent", "--primary", "--main", "--brand", "--color-accent", "--color-primary"];
  const rootTokens = {};
  try {
    const rootStyle = window.getComputedStyle(document.documentElement);
    for (const name of ROOT_TOKEN_NAMES) {
      const raw = String(rootStyle.getPropertyValue(name) || "").trim();
      // A var() reference or an empty slot is no evidence; a colour literal is.
      if (raw && !/^var\(/i.test(raw)) rootTokens[name] = raw.slice(0, 40);
    }
  } catch (e) { /* declared tokens are enrichment, never a gate */ }

  return {
    viewport: { width: vw, height: vh },
    docHeight: Math.round(docHeight),
    title: String(document.title || "").slice(0, 200),
    lang: String((document.documentElement && document.documentElement.lang) || "").slice(0, 12),
    bodySurface,
    rootTokens,
    backgrounds, textColors, borderColors, chromaAreas,
    fontStats, actionFills, actionInks,
    loudCandidates, images, logoCandidates,
    visibleText,
    elementCount: limit,
    truncatedElements: all.length > limit,
  };
}
/* eslint-enable no-undef */

// ---------------------------------------------------------------------------
// ranking the measured evidence (pure — the unit-testable half)
// ---------------------------------------------------------------------------

/**
 * The accent SHORTLIST. Every entry is a colour genuinely present on an action
 * element; nothing here is invented. Ranking exists so that (a) a no-vision run
 * still has a defensible answer and (b) vision picks from a small honest list.
 *
 * Fills outrank inks because a filled button IS the action colour, whereas a
 * link's text colour is often just the body colour. Near-neutrals and
 * colours indistinguishable from the surface are heavily penalised, which is
 * exactly the "merely appears a lot" case the owner described.
 */
function rankAccentCandidates(measured, surface) {
  const out = [];
  const fills = measured.actionFills || {};
  const inks = measured.actionInks || {};

  for (const hex of Object.keys(fills)) {
    const f = fills[hex];
    const base = Math.sqrt(Math.max(1, f.area)) * (1 + Math.log2(1 + f.count));
    const penalty = surface && nearlySame(hex, surface) ? 0.1 : 1;
    out.push({
      hex, role: "fill", count: f.count, area: Math.round(f.area),
      labels: f.labels || [], score: base * chromaWeight(hex) * penalty,
    });
  }
  for (const hex of Object.keys(inks)) {
    const f = inks[hex];
    const base = Math.max(1, f.chars) * (1 + Math.log2(1 + f.count)) * 0.5;
    const penalty = surface && nearlySame(hex, surface) ? 0.1 : 1;
    const existing = out.find((c) => c.hex === hex && c.role === "fill");
    if (existing) { existing.alsoInk = true; existing.score += base * chromaWeight(hex) * penalty * 0.3; continue; }
    out.push({
      hex, role: "ink", count: f.count, chars: f.chars,
      labels: f.labels || [], score: base * chromaWeight(hex) * penalty,
    });
  }

  // FAULT (a): the winner must be the same on every run of the same site.
  // Score first, then a fully deterministic chain — no two candidates can ever
  // compare equal, so the sort cannot depend on input order.
  const roleRank = (c) => (c.role === "fill" ? 0 : 1);
  out.sort((a, b) =>
    (b.score - a.score)
    || (roleRank(a) - roleRank(b))
    || ((b.count || 0) - (a.count || 0))
    || String(a.hex).localeCompare(String(b.hex)));

  // A NEAR-TIE is not allowed to be decided by score at all: area jitters
  // between renders, and on a two-colour brand that jitter WAS the decision.
  // Inside the margin the discrete keys decide — prefer the ACTION colour
  // (fill over ink), then a colour doing both jobs, then count, then hex.
  if (out.length >= 2) {
    const [first, second] = out;
    const nearTie = first.score > 0 && (first.score - second.score) / first.score <= ACCENT_TIE_MARGIN;
    if (nearTie) {
      const decide =
        (roleRank(first) - roleRank(second))                          // fill wins
        || ((second.alsoInk ? 1 : 0) - (first.alsoInk ? 1 : 0))       // both-jobs wins
        || ((second.count || 0) - (first.count || 0))                 // more elements wins
        || String(first.hex).localeCompare(String(second.hex));       // stable last word
      if (decide > 0) {
        out[0] = second;
        out[1] = first;
      }
      out[0].decidedBy = `near_tie(${ACCENT_TIE_MARGIN * 100}%):${
        roleRank(out[0]) < roleRank(out[1]) ? "prefer_action_fill"
          : out[0].alsoInk && !out[1].alsoInk ? "fill_and_ink"
          : (out[0].count || 0) > (out[1].count || 0) ? "element_count"
          : "hex_order"}`;
    }
  }
  return out.slice(0, MAX_ACCENT_CANDIDATES).map((c, i) => ({ ...c, index: i, score: round2(c.score) }));
}

// ---------------------------------------------------------------------------
// :root brand tokens — the colour the THEME declares, not just the colours its
// buttons happen to wear
// ---------------------------------------------------------------------------

/** The custom properties read off :root, in the order they may claim the accent. */
const ROOT_ACCENT_TOKENS = Object.freeze([
  "--accent", "--primary", "--main", "--brand", "--color-accent", "--color-primary",
]);

/**
 * Parse a CSS colour AS DECLARED in a custom property: #RGB, #RRGGBB,
 * rgb()/rgba(). Custom properties are tokens, not computed colours, so a
 * theme that declares `--accent: #e31e24` reports exactly that string. Returns
 * uppercase #RRGGBB, or "" for anything else (a var() chain, a gradient, empty).
 */
function parseDeclaredColor(raw) {
  const s = String(raw || "").trim();
  let m = /^#([0-9a-fA-F]{6})\b/.exec(s);
  if (m) return `#${m[1].toUpperCase()}`;
  m = /^#([0-9a-fA-F]{3})\b/.exec(s);
  if (m) return `#${m[1].split("").map((c) => c + c).join("").toUpperCase()}`;
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, "0");
    return ("#" + h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
  }
  return "";
}

/**
 * The :root custom-property candidates, highest priority first. A theme that
 * DECLARES its accent (`:root { --accent: #e31e24 }`) is stating its brand
 * outright, so a saturated declared token enters the shortlist ABOVE any single
 * rendered fill — but it is still measured evidence, still saturation-floored,
 * and still penalised when it merely equals the page surface. A near-neutral
 * token (Hurricane Fence's meta theme-color is white; some themes declare
 * --accent: #333) abstains exactly like a near-neutral button would.
 */
function rootTokenCandidates(rootTokens, surface) {
  const out = [];
  for (const [i, name] of ROOT_ACCENT_TOKENS.entries()) {
    const raw = rootTokens && rootTokens[name];
    if (!raw) continue;
    const hex = parseDeclaredColor(raw);
    if (!hex) continue;
    // The priority ladder, geometrically steep ON PURPOSE. A theme's
    // declaration order is deterministic evidence — unlike rendered area, it
    // cannot jitter — so the gap between ranks is real signal, not noise to be
    // tie-broken: `--accent` is the slot a theme names when it MEANS it, and
    // every later name is a weaker claim. A flat ladder here would put a
    // theme's `--accent` and `--main` in a permanent near-tie (hurricanefenceinc
    // .com declares both), and the margin-derived confidence would fall below
    // the 0.6 bar every accent_fallback consumer applies — the declared colour
    // would be measured and then refused at the door. 520 still sits above any
    // single rendered fill (sqrt of a 160,000px² hero-scale fill is 400), so
    // the declared accent is HIGH-priority without being unbeatable by a page
    // that genuinely paints its accent everywhere at hero scale.
    const base = 520 * Math.pow(0.58, i);
    const penalty = surface && nearlySame(hex, surface) ? 0.1 : 1;
    out.push({
      hex,
      role: "root_token",
      token: name,
      count: 1,
      area: 0,
      labels: [`:${name} declared in :root`],
      score: base * chromaWeight(hex) * penalty,
    });
  }
  return out;
}

/** One deterministic merge of measured action candidates and declared :root
 *  tokens, under the same comparator rankAccentCandidates sorts by. Both lists
 *  keep every field they came in with; only order and `index` are set here. */
function mergeAccentCandidates(candidates, extras, { limit = MAX_ACCENT_CANDIDATES } = {}) {
  const roleRank = (c) => (c.role === "fill" ? 0 : c.role === "root_token" ? 1 : 2);
  const merged = [...(candidates || []), ...(extras || [])].sort((a, b) =>
    (b.score - a.score)
    || (roleRank(a) - roleRank(b))
    || ((b.count || 0) - (a.count || 0))
    || String(a.hex).localeCompare(String(b.hex)));
  return merged.slice(0, limit).map((c, i) => ({ ...c, index: i, score: round2(c.score) }));
}

/**
 * How much of the measured page background is bright vs dark, by area.
 *
 * The same thresholds scripts/measure-fleet-surfaces.js applies to screenshot
 * pixels (luminance >= 0.5 bright, <= 0.12 dark), applied here to the measured
 * AREA of real painted sections — so a client whose sections are mostly white
 * carries a high brightShare even when their hero is a dark photograph. This is
 * what lets the cinematic-donor escape (theme.js decideMode) fire for a
 * measured-light client: without these numbers the escape can never see
 * "strongly light" and fencing-sterling would render dark for every client,
 * forever.
 */
function surfaceShares(backgrounds) {
  const entries = Object.entries(backgrounds || {});
  const total = entries.reduce((sum, [, v]) => sum + Number(v || 0), 0);
  if (!total) return { brightShare: null, darkShare: null };
  let bright = 0;
  let dark = 0;
  for (const [hex, v] of entries) {
    const lum = relativeLuminance(hex);
    if (lum == null) continue;
    const area = Number(v || 0);
    if (lum >= 0.5) bright += area;
    else if (lum <= 0.12) dark += area;
  }
  return { brightShare: round2(bright / total), darkShare: round2(dark / total) };
}

/**
 * The loudest things on the page, by measured type size, area and position.
 *
 * Candidates now carry each element's WHOLE text, so a headline and the
 * <strong> inside it both arrive, the child's text being a substring of the
 * parent's. Reporting both would spend two of six loud slots on one headline
 * and hand the outreach copy a bare fragment ("Plumber") as if it were a
 * separate thing the page shouts. The longest form of a string wins; the
 * fragments inside it drop.
 */
function rankLoudCandidates(measured) {
  const seen = new Set();
  const scored = [];
  const all = (measured.loudCandidates || []).map((c) => ({ c, norm: normalizeForMatch(c.text) }));
  // Longest first, so the parent is always seen before the child it contains.
  const byLength = [...all].sort((a, b) => b.norm.length - a.norm.length);
  const kept = [];
  const containedInAKeptCandidate = (norm) => kept.some((k) => k.length > norm.length && k.includes(norm));
  const ordered = [];
  for (const item of byLength) {
    if (!item.norm || containedInAKeptCandidate(item.norm)) continue;
    kept.push(item.norm);
    ordered.push(item.c);
  }
  // Back to document order, which the scoring below expects to be meaningless
  // but which keeps the measured list readable next to the page.
  const survivors = (measured.loudCandidates || []).filter((c) => ordered.includes(c));
  for (const c of survivors) {
    const key = normalizeForMatch(c.text).slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const typeWeight = Math.max(1, c.fontSize) * (c.weight >= 600 ? 1.35 : 1);
    const areaWeight = Math.sqrt(Math.max(1, c.area));
    const colourWeight = c.background ? 1 + chromaWeight(c.background) : 1;
    const positionWeight = (c.inFirstViewport ? 1.5 : 1) * (c.pinned ? 1.4 : 1) * (c.classLoud ? 1.3 : 1);
    scored.push({ ...c, score: typeWeight * areaWeight * colourWeight * positionWeight });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_LOUD_CANDIDATES).map((c, i) => ({ ...c, index: i, score: round2(c.score) }));
}

// ---------------------------------------------------------------------------
// THE HERO SLOGAN — their own first sentence, read off their own page
// ---------------------------------------------------------------------------
//
// THE INCIDENT (owner's screenshot, 2026-08-12): Farr Better Plumbing's hero
// reads "BIG CITY SERVICE. SMALL TOWN VALUE" — legible even in our own email's
// before-thumbnail — and the mirror we built them opened "Farr Better
// Plumbing. Plumbing in Springfield, MO. Done right." Their slogan was ON the
// page we rendered and the build ignored it.
//
// This is measured, not judged: the slogan is the largest sentence-like type
// above the fold that is not the business's name, not a phone number, and not
// a button label. Every candidate here came out of the DOM via quotableText,
// so the string is the page's own text, verbatim — which is exactly the
// evidence bar hero.tagline documents. Vision may CONFIRM which loud block is
// the slogan (kind "slogan"), and a confirmed pick outranks the heuristic;
// both only ever emit a measured candidate's own text.

const SLOGAN_MIN_FONT = 24;  // hero-scale type; nav links and chips sit below this
const MAX_SLOGAN_CHARS = 90; // aligned with identity-copy's MAX_TAGLINE
const CTA_VERBS = /^(get|call|contact|schedule|book|request|learn|read|click|tap|view|see|start|order|shop|buy|email|text)\b/i;

// A sentence about money is an OFFER, not a motto. Measured on
// farrbetterplumbing.com, 2026-08-12: the hero is a carousel of three 50px
// slides — "NO DRIVE TIME FEE IN SERVICE AREA.", "BIG CITY SERVICE. SMALL
// TOWN VALUES." and "NO SERVICE FEES. BILLED HOURLY." — and whichever slide
// the capture landed on became "the" hero text. The motto is the one that
// does not talk price; the offers still carry over as promotions. Within the
// largest type band the non-offer sentence wins, which also makes the pick
// carousel-position-independent.
const OFFER_WORDS = /\b(fees?|billed|billing|priced?|prices|pricing|percent off|% ?off|discounts?|coupons?|financ\w+|per (?:hour|month|visit|system)|free (?:estimates?|quotes?|inspections?))\b|\$\s?\d/i;

/**
 * SCREAMING CAPS are a CSS choice, not a sentence. A slogan with no lowercase
 * letters is folded to title case for DISPLAY — the verbatim string is kept
 * beside it — so "BIG CITY SERVICE. SMALL TOWN VALUE" can be printed as
 * "Big City Service. Small Town Value" without our h1 shouting in a donor
 * that does not uppercase. Words are never added, removed or reordered.
 */
const SHOUT_ACRONYMS = new Set(["AC", "HVAC", "LLC", "INC", "USA", "US", "BBB", "EPA", "TV", "RV", "AV", "DIY", "II", "III"]);
function foldShoutCase(text) {
  const s = String(text || "").trim();
  if (!s || /[a-z]/.test(s)) return s;
  return s.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => (
    SHOUT_ACRONYMS.has(w.toUpperCase())
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ));
}

/**
 * deriveHeroSlogan(loudCandidates, { businessName, title }) -> {
 *   text, display, fontSize, index, source: "measured"
 * } | null
 *
 * Pure and deterministic: largest qualifying type wins, ties break on area,
 * then on position (higher on the page), then on index.
 */
function deriveHeroSlogan(loudCandidates = [], { businessName = "", title = "" } = {}) {
  const nameNorm = normalizeForMatch(businessName);
  const titleNorm = normalizeForMatch(String(title).split(/[|–—-]/)[0]);
  const qualifying = [];
  for (const c of Array.isArray(loudCandidates) ? loudCandidates : []) {
    if (!c || !c.inFirstViewport || !(c.fontSize >= SLOGAN_MIN_FONT)) continue;
    const text = String(c.text || "").replace(/\s+/g, " ").trim();
    if (text.length < 6 || text.length > MAX_SLOGAN_CHARS) continue;
    if (!/[a-z]{3}/i.test(text)) continue;
    const words = text.split(/\s+/);
    if (words.length < 2) continue;
    // Machinery, contact data and buttons are not slogans.
    if (/\$\{|\{\{|<%|<[a-z/]/i.test(text)) continue;
    if (/https?:\/\/|@[a-z0-9-]+\.[a-z]{2,}/i.test(text)) continue;
    if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]?\d{4}/.test(text)) continue;
    if (words.length <= 4 && CTA_VERBS.test(text)) continue;
    // The name is line A's fallback, not a slogan; a headline that merely
    // wraps the name ("Farr Better Plumbing LLC") is the name too.
    const norm = normalizeForMatch(text);
    if (!norm) continue;
    if (nameNorm && (norm === nameNorm || nameNorm.includes(norm) || norm.includes(nameNorm))) continue;
    if (titleNorm && norm === titleNorm) continue;
    qualifying.push({ c, text });
  }
  if (!qualifying.length) return null;
  // The TOP TYPE BAND first (a carousel's slides share a size), then within it
  // the motto outranks the offer, then area, position, index — deterministic.
  const maxFont = Math.max(...qualifying.map((q) => q.c.fontSize));
  const band = qualifying.filter((q) => q.c.fontSize >= maxFont - 2);
  band.sort((a, b) =>
    ((OFFER_WORDS.test(a.text) ? 1 : 0) - (OFFER_WORDS.test(b.text) ? 1 : 0))
    || (b.c.fontSize - a.c.fontSize)
    || ((b.c.area || 0) - (a.c.area || 0))
    || (((a.c.rect && a.c.rect.y) || 0) - ((b.c.rect && b.c.rect.y) || 0))
    || ((a.c.index || 0) - (b.c.index || 0)));
  const best = band[0];
  return {
    text: best.text,
    display: foldShoutCase(best.text),
    fontSize: Math.round(best.c.fontSize),
    index: Number.isInteger(best.c.index) ? best.c.index : null,
    source: "measured",
  };
}

/**
 * Image candidates, best first. A "photo floor" keeps icons and spacers out of
 * the identity list without discarding them from the record.
 */
function rankImageCandidates(measured, pageUrl) {
  let host = "";
  try { host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { host = ""; }
  const registrable = (h) => String(h || "").toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");

  const out = (measured.images || []).map((img) => {
    let sameOrigin = false;
    let imageHost = "";
    try {
      imageHost = new URL(img.url).hostname.toLowerCase();
      sameOrigin = !!host && registrable(imageHost) === registrable(host);
    } catch { /* an unparseable URL is simply not same-origin */ }
    const bigEnough = (img.naturalWidth >= 320 && img.naturalHeight >= 200) ||
      (img.kind !== "img" && img.renderedWidth >= 320 && img.renderedHeight >= 200);
    // A third-party mark hosted ON the client's own domain is still not theirs
    // to give — sameOrigin is not ownership of the MARK. This is why the flag
    // travels with the candidate rather than being left to the consumer.
    //
    // FAULT (c): the test is about what the image IS, not where it is served
    // from. A MARK-shaped image (logo-like, or too small to be a photograph)
    // faces the full denylist — host and basename both, which is what catches a
    // HomeAdvisor badge in /wp-content/. A PHOTO-shaped image faces only the
    // NAME test: alt text calling it somebody else's mark still refuses it,
    // but the client's own 1080px crew photo served from cdninstagram is the
    // client's PHOTOGRAPH, not Instagram's trademark. Refuse marks, keep
    // photos — ownership of the BYTES is still the harvester's gate to run.
    const photoShaped = bigEnough && !img.logoLike;
    const thirdPartyMark = photoShaped
      ? thirdPartyGuard().namesThirdPartyMark(String(img.alt || ""))
      : looksThirdParty(img.url, img.alt);
    return {
      ...img,
      host: imageHost,
      sameOrigin,
      thirdPartyMark,
      photoFloor: bigEnough && !img.logoLike && !thirdPartyMark,
      score: Math.sqrt(Math.max(1, img.renderedArea)) * (img.inFirstViewport ? 1.4 : 1) *
        (img.logoLike ? 0.2 : 1) * (thirdPartyMark ? 0.1 : 1),
    };
  });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_IMAGE_CANDIDATES).map((img, i) => ({ ...img, index: i, score: round2(img.score) }));
}

/**
 * The third-party-mark denylist, borrowed from lib/capture-brand.js rather than
 * re-invented — it has been taught by real incidents (Mastercool's badge,
 * Google Blogger's mark, smithandsonstx.com's `alt="Google Reviews logo"`) and
 * a second copy of it would drift out of date the first time one is added.
 */
let thirdPartyGuardCache = null;
function thirdPartyGuard() {
  if (thirdPartyGuardCache) return thirdPartyGuardCache;
  try {
    const { isThirdPartyMark, namesThirdPartyMark } = require("./capture-brand");
    thirdPartyGuardCache = { isThirdPartyMark, namesThirdPartyMark, available: true };
  } catch {
    thirdPartyGuardCache = { isThirdPartyMark: () => false, namesThirdPartyMark: () => false, available: false };
  }
  return thirdPartyGuardCache;
}

/** Is this image somebody else's mark? URL first, then the words around it. */
function looksThirdParty(url, alt = "", className = "") {
  const g = thirdPartyGuard();
  if (g.isThirdPartyMark(String(url || ""))) return true;
  return g.namesThirdPartyMark(`${alt} ${className}`);
}

/**
 * chooseLogo(candidates) -> { logo, refused[] }
 *
 * THE INCIDENT THIS EXISTS FOR: live mirrors have served a manufacturer's badge
 * and Google Blogger's mark as the client's own identity, with every gate
 * green. On whitebirdfence.com the header carries BOTH the client's Logo.png
 * and a HomeAdvisor badge, and both are logo-shaped; taking the first in
 * document order is a coin flip that has already been lost once.
 *
 * So a third-party mark is EXCLUDED, never merely outranked, and what is left
 * is ranked on evidence: in the header, named "logo", earlier, larger.
 */
function chooseLogo(candidates = []) {
  const refused = [];
  const refusedUrls = new Set();
  const eligible = [];
  for (const c of candidates) {
    if (looksThirdParty(c.url, c.alt, c.className)) {
      // The same badge often sits in both the header and the footer. One mark,
      // one refusal — a repeated line reads like two separate problems.
      if (!refusedUrls.has(c.url)) {
        refusedUrls.add(c.url);
        refused.push({ url: c.url, alt: c.alt, reason: "third_party_mark" });
      }
      continue;
    }
    eligible.push(c);
  }
  if (!eligible.length) return { logo: null, refused };

  const score = (c) =>
    (c.inHeader ? 1000 : 0) +
    (/logo|wordmark/i.test(`${c.url} ${c.alt} ${c.className}`) ? 500 : 0) +
    Math.max(0, 200 - c.order * 20) +
    Math.min(200, Math.sqrt(Math.max(1, (c.naturalWidth || 0) * (c.naturalHeight || 0))));

  const best = [...eligible].sort((a, b) => score(b) - score(a))[0];
  return {
    logo: {
      url: best.url,
      alt: best.alt,
      naturalWidth: best.naturalWidth,
      naturalHeight: best.naturalHeight,
      rect: best.rect,
      inHeader: !!best.inHeader,
      candidates: eligible.length,
    },
    refused,
  };
}

/** hex -> total, sorted desc, as [{hex, value, share}]. */
function rankTally(tally, minShare = 0) {
  const entries = Object.entries(tally || {});
  const total = entries.reduce((sum, [, v]) => sum + Number(v || 0), 0);
  if (!total) return [];
  return entries
    .map(([hex, value]) => ({ hex, value: Math.round(Number(value)), share: round2(Number(value) / total) }))
    .filter((e) => e.share >= minShare)
    .sort((a, b) => b.value - a.value);
}

/**
 * Fonts, as RENDERED. The display face is whatever draws the biggest type; the
 * body face is whatever draws the most characters. Where one family does both
 * jobs, it is reported for both, because that is the truth about the page.
 */
function chooseFonts(fontStats) {
  const families = Object.entries(fontStats || {}).map(([family, s]) => ({
    family,
    chars: s.chars || 0,
    maxSize: s.maxSize || 0,
    area: s.area || 0,
    weights: Object.keys(s.weights || {}).map(Number).sort((a, b) => a - b),
  }));
  if (!families.length) return { display: null, body: null, families: [], displayWeights: [], bodyWeights: [] };

  const byChars = [...families].sort((a, b) => b.chars - a.chars);
  const bySize = [...families].sort((a, b) => (b.maxSize - a.maxSize) || (b.area - a.area));
  const body = byChars[0];
  const display = bySize[0];
  return {
    display: display.family,
    body: body.family,
    displayWeights: display.weights,
    bodyWeights: body.weights,
    families: families.sort((a, b) => b.chars - a.chars),
  };
}

/**
 * The page surface a visitor actually sees.
 *
 * The computed body background is exact but can be a lie of scope — plenty of
 * sites leave body white and paint every section black. The pixel histogram of
 * the screenshot cannot lie about that, because it is literally what was drawn.
 * When they disagree, the pixels win and the disagreement is recorded.
 */
function decideSurface({ bodySurface, backgrounds, pixelSurface, pixelShare = 0 }) {
  const computedTop = rankTally(backgrounds)[0];
  const computed = normalizeHex(bodySurface) || (computedTop ? normalizeHex(computedTop.hex) : "");
  const pixels = normalizeHex(pixelSurface);

  // A photo-heavy page has no majority colour: whitebirdfence.com's winning
  // bucket is 24% of pixels, because the photographs shatter into hundreds of
  // buckets and the one flat navy wins on a plurality. That is still the right
  // ANSWER, but it is not a 0.97 answer, and a brief that reports it as one is
  // lying about how sure it is. Confidence therefore tracks the real margin.
  const share = Number(pixelShare) || 0;
  const evidenceWeight = 0.5 + 0.5 * Math.min(1, share / 0.5);

  if (pixels && computed && !nearlySame(pixels, computed, 0.1)) {
    return {
      hex: pixels,
      confidence: 0.8 * evidenceWeight,
      note: `pixel histogram ${pixels} (${Math.round(share * 100)}% of pixels) outranks computed body background ${computed}`,
    };
  }
  if (pixels) {
    return {
      hex: pixels,
      confidence: (computed ? 0.97 : 0.9) * evidenceWeight,
      note: `${computed ? "pixels and computed styles agree" : "from pixel histogram"} (${Math.round(share * 100)}% of pixels)`,
    };
  }
  if (computed) return { hex: computed, confidence: 0.75, note: "computed styles only (no pixel histogram)" };
  return { hex: "", confidence: 0, note: "no measurable page background" };
}

// ---------------------------------------------------------------------------
// pixel histogram
// ---------------------------------------------------------------------------

/**
 * The commonest colour in a PNG screenshot, quantised to a 16-level cube so
 * that a gradient or a JPEG-ish sheen does not shatter the tally. Returns the
 * exact hex of the most common quantised bucket's centroid-nearest sample.
 */
function dominantPixelColor(pngBuffer, { step = 4 } = {}) {
  let decoded;
  try {
    const { decodePngToRgba } = require("./png-decode");
    decoded = decodePngToRgba(pngBuffer);
  } catch {
    return null;
  }
  if (!decoded || !decoded.data || !decoded.width || !decoded.height) return null;

  const { data, width, height } = decoded;
  const buckets = new Map();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 200) continue;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      let b = buckets.get(key);
      if (!b) { b = { n: 0, r: 0, g: 0, bl: 0 }; buckets.set(key, b); }
      b.n += 1; b.r += data[i]; b.g += data[i + 1]; b.bl += data[i + 2];
    }
  }
  let best = null;
  let total = 0;
  for (const b of buckets.values()) {
    total += b.n;
    if (!best || b.n > best.n) best = b;
  }
  if (!best || !total) return null;
  const hex = normalizeHex(
    "#" + [best.r / best.n, best.g / best.n, best.bl / best.n]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""),
  );
  return hex ? { hex, share: round2(best.n / total) } : null;
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/**
 * Fonts and lazy images must have SETTLED before anything is measured — a
 * measurement taken mid-load reports the fallback serif and half the pictures.
 * Scrolling the whole page is what actually trips IntersectionObserver-based
 * lazy loaders; document.fonts.ready is what stops us reading Times New Roman
 * and calling it their typeface.
 */
async function settlePage(page, { settleMs = 900, scrollSteps = 12 } = {}) {
  await page.evaluate(async (steps) => {
    const h = window.innerHeight;
    for (let i = 1; i <= steps; i += 1) {
      window.scrollTo(0, h * i);
      await new Promise((r) => setTimeout(r, 90));
      if (window.scrollY + h >= document.documentElement.scrollHeight - 4) break;
    }
    window.scrollTo(0, 0);
  }, scrollSteps).catch(() => {});

  await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()))
    .catch(() => {});

  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []).slice(0, 120);
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => {
      const done = () => r();
      i.addEventListener("load", done, { once: true });
      i.addEventListener("error", done, { once: true });
      setTimeout(done, 3000);
    }))));
  }).catch(() => {});

  await page.waitForTimeout(settleMs);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

/**
 * captureDesignEvidence — render, settle, measure, screenshot.
 *
 * Returns everything a brief is built from, and NOTHING that required an
 * opinion. Exposed separately so a caller can re-derive a brief from stored
 * evidence without paying for another render.
 *
 * `browser` is injectable: the render gate usually already has one open.
 * Only a browser this function opened is closed by this function.
 *
 * CALLING THIS DIRECTLY? YOU MUST `await evidence._closePage()`.
 * The page is deliberately left open so buildDesignBrief can clip crops after
 * vision has chosen what to clip. If you skip the close and this function
 * opened the browser, lib/serverless-chromium's permit is held until its
 * 240s watchdog fires — and that permit is the ONE browser the render gates
 * share, so every later row queues behind you. buildDesignBrief does this in a
 * `finally`; a direct caller must do the same.
 */
async function captureDesignEvidence(url, options = {}) {
  const {
    browser: injectedBrowser = null,
    timeoutMs = 45000,
    visionScreens = VISION_SCREENS,
    mobile = true,
    settleMs = 900,
  } = options;

  const site = String(url || "").trim();
  if (!/^https?:\/\//i.test(site)) {
    return { ok: false, reason: "no_website", url: site };
  }

  let browser = injectedBrowser;
  let owned = false;
  if (!browser) {
    const { launchChromium } = require("./serverless-chromium");
    browser = await launchChromium();
    owned = true;
  }

  const started = Date.now();
  const shots = [];
  let page = null;
  let mobilePage = null;

  try {
    page = await browser.newPage({ viewport: { width: DESKTOP.width, height: DESKTOP.height } });
    await page.goto(site, { waitUntil: "networkidle", timeout: timeoutMs }).catch(async () => {
      // One slow third-party beacon must not cost us the whole capture.
      await page.goto(site, { waitUntil: "load", timeout: timeoutMs });
    });
    await settlePage(page, { settleMs });

    const measured = await page.evaluate(measureInPage, {});
    const finalUrl = page.url();

    // A full-page PNG: ground truth for the pixel histogram, and the artifact a
    // human opens when they want to argue with a verdict.
    const fullPng = await page.screenshot({ fullPage: true, type: "png" }).catch(() => null);

    // Screens for the vision pass. Two desktop screens is where the loud things
    // live; a whole 12,000px page read at once is read badly.
    for (let i = 0; i < Math.max(1, visionScreens); i += 1) {
      const y = i * DESKTOP.height;
      if (i > 0 && y >= measured.docHeight) break;
      await page.evaluate((top) => window.scrollTo(0, top), y).catch(() => {});
      await page.waitForTimeout(280);
      const buffer = await page.screenshot({ type: "jpeg", quality: 72 }).catch(() => null);
      if (buffer) shots.push({ id: `desktop-${i}`, viewport: "desktop", scrollY: y, mediaType: "image/jpeg", buffer });
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    let mobileMeasured = null;
    if (mobile) {
      mobilePage = await browser.newPage({ viewport: { width: MOBILE.width, height: MOBILE.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await mobilePage.goto(site, { waitUntil: "networkidle", timeout: timeoutMs }).catch(async () => {
        await mobilePage.goto(site, { waitUntil: "load", timeout: timeoutMs }).catch(() => {});
      });
      await settlePage(mobilePage, { settleMs: Math.min(settleMs, 700), scrollSteps: 8 });
      mobileMeasured = await mobilePage.evaluate(measureInPage, {}).catch(() => null);
      const buffer = await mobilePage.screenshot({ type: "jpeg", quality: 72 }).catch(() => null);
      if (buffer) shots.push({ id: "mobile-0", viewport: "mobile", scrollY: 0, mediaType: "image/jpeg", buffer });
    }

    const pixel = fullPng ? dominantPixelColor(fullPng) : null;

    return {
      ok: true,
      version: BRIEF_VERSION,
      url: site,
      finalUrl,
      capturedAt: new Date().toISOString(),
      captureMs: Date.now() - started,
      measured,
      mobileMeasured,
      pixelSurface: pixel ? pixel.hex : "",
      pixelShare: pixel ? pixel.share : 0,
      shots,
      fullPng,
      // Kept open so buildDesignBrief can clip crops after vision picks.
      _page: page,
      _closePage: async () => {
        await page.close().catch(() => {});
        if (mobilePage) await mobilePage.close().catch(() => {});
        if (owned) await browser.close().catch(() => {});
      },
    };
  } catch (error) {
    if (page) await page.close().catch(() => {});
    if (mobilePage) await mobilePage.close().catch(() => {});
    if (owned) await browser.close().catch(() => {});
    return { ok: false, reason: `capture_failed: ${boundedDetailText((error && error.message) || error, 200)}`, url: site };
  }
}

// ---------------------------------------------------------------------------
// the measured brief — everything true before a model has seen anything
// ---------------------------------------------------------------------------

/**
 * briefFromMeasurement(evidence) -> brief
 *
 * PURE. This is the whole brief minus judgement, and it is a complete, usable
 * brief on its own: a run with no vision key produces this, correctly labelled,
 * rather than failing. Vision only ever refines it.
 */
function briefFromMeasurement(evidence, opts = {}) {
  const m = (evidence && evidence.measured) || {};
  const provenance = {};
  const refusals = [];

  const setP = (field, source, confidence, note) => {
    provenance[field] = { source, confidence: round2(clamp01(confidence)), note: note || "" };
  };
  const absent = (field, reason) => {
    provenance[field] = { source: "absent", confidence: 0, note: reason };
  };

  // --- surface / mode -----------------------------------------------------
  const surfaceDecision = decideSurface({
    bodySurface: m.bodySurface,
    backgrounds: m.backgrounds,
    pixelSurface: evidence.pixelSurface,
    pixelShare: evidence.pixelShare,
  });
  const surface = surfaceDecision.hex || null;
  if (surface) setP("surface", "measured", surfaceDecision.confidence, surfaceDecision.note);
  else absent("surface", "no measurable page background");

  // Light/dark AREA shares of the painted sections — the numbers the cinematic
  // escape hatch reads. Computed even when the surface verdict itself is thin,
  // because they are evidence about the page's rhythm, not about one colour.
  const shares = surfaceShares(m.backgrounds);

  // --- text / muted -------------------------------------------------------
  const inks = rankTally(m.textColors).map((e) => ({ ...e, hex: normalizeHex(e.hex) })).filter((e) => e.hex);
  const text = inks.length ? inks[0].hex : null;
  if (text) setP("text", "measured", Math.min(0.98, 0.6 + inks[0].share), `${Math.round(inks[0].share * 100)}% of measured characters`);
  else absent("text", "no measurable body text colour");

  // --- mode, corroborated by the ink ---------------------------------------
  // The surface hex decides light or dark, but the BODY TEXT is a second,
  // independent witness: a page whose copy is #F1F1F1 is a dark page, whatever
  // one background colour says. When the two agree, the call is solid. When
  // they cannot both be true — light ink on a light surface — the honest
  // answer is a much lower confidence and a note saying why, not a coin flip.
  const mode = surface ? modeOfSurface(surface) : "light";
  if (surface) {
    const pairContrast = text ? contrastRatio(text, surface) : null;
    const corroborated = pairContrast == null ? null : pairContrast >= 3;
    setP(
      "mode",
      "measured",
      surfaceDecision.confidence * (corroborated === false ? 0.5 : 1),
      corroborated === false
        ? `surface luminance ${round2(relativeLuminance(surface))} says ${mode}, but body text ${text} sits at only ${round2(pairContrast)}:1 against it — the two disagree`
        : `surface luminance ${round2(relativeLuminance(surface))}${corroborated ? `, corroborated by body text at ${round2(pairContrast)}:1` : ""}`,
    );
  } else absent("mode", "no surface to measure; consumers should treat as unknown, not light");

  let muted = null;
  if (text && surface) {
    const surfaceLum = relativeLuminance(surface);
    const textLum = relativeLuminance(text);
    // MUTED IS DESATURATED, BY DEFINITION. dripfixplumbingde.com measures its
    // brand blue #38B6FF at 7% of characters, sitting neatly between the ink
    // and the paper — so a purely positional test picks it, and the builder is
    // handed a vivid accent labelled "secondary copy". Secondary text is grey,
    // or a grey with a tint in it; a saturated colour that reads as secondary
    // is the ACCENT being used as text, which brief.accent already carries.
    //
    // AND IT MUST BE LEGIBLE ON THE SURFACE. The same site's near-white
    // #F8F8F9 is desaturated and does sit between the ink and the paper, but it
    // is 1.03:1 against the page — it is the copy inside their dark sections,
    // not muted body text. Handing it over as `muted` would put invisible text
    // on a white page. A candidate that cannot be read on the surface is not a
    // text colour FOR that surface, so it is refused and the palette derives
    // one that provably works.
    const between = inks.slice(1).find((e) => {
      if (e.share < 0.03) return false;
      if (chromaOf(e.hex) > MUTED_MAX_CHROMA) return false;
      if (contrastRatio(e.hex, surface) < TEXT_CONTRAST_TARGET) return false;
      const lum = relativeLuminance(e.hex);
      if (lum == null) return false;
      const lo = Math.min(surfaceLum, textLum);
      const hi = Math.max(surfaceLum, textLum);
      return lum > lo && lum < hi && !nearlySame(e.hex, text, 0.04);
    });
    if (between) {
      muted = between.hex;
      setP(
        "muted",
        "measured",
        Math.min(0.9, 0.5 + between.share * 2),
        `${Math.round(between.share * 100)}% of characters, between text and surface, ${chromaOf(between.hex)}% saturation, ${round2(contrastRatio(between.hex, surface))}:1 on it`,
      );
    }
  }
  if (!muted) absent("muted", "no desaturated secondary text colour measured; let the palette derive one");

  // --- border -------------------------------------------------------------
  const borders = rankTally(m.borderColors).map((e) => ({ ...e, hex: normalizeHex(e.hex) })).filter((e) => e.hex);
  const border = borders.length ? borders[0].hex : null;
  // Eight bordered elements is a real measurement and a thin one. Confidence
  // tracks BOTH the share and the raw count, so "the border colour" from a
  // page that barely has borders reads as the guess-adjacent thing it is.
  if (border) {
    setP(
      "border",
      "measured",
      Math.min(0.85, 0.35 + borders[0].share * 0.4 + Math.min(borders[0].value, 30) / 100),
      `${borders[0].value} bordered elements, ${Math.round(borders[0].share * 100)}% of them`,
    );
  } else absent("border", "no hairline colour measured");

  // --- fonts --------------------------------------------------------------
  const fonts = chooseFonts(m.fontStats);
  if (fonts.display) setP("fontDisplay", "measured", 0.92, `largest rendered type: ${Math.round((m.fontStats[fonts.display] || {}).maxSize || 0)}px`);
  else absent("fontDisplay", "no non-generic family rendered any heading");
  if (fonts.body) setP("fontBody", "measured", 0.92, `${(m.fontStats[fonts.body] || {}).chars || 0} characters`);
  else absent("fontBody", "no non-generic family rendered body copy");

  // --- accent shortlist ---------------------------------------------------
  // Measured action colours first, then the theme's own declared :root tokens
  // (Break 3, hurricanefenceinc.com: white/outline buttons measured nothing,
  // while the theme declared `--accent: #e31e24` in plain sight).
  const accentCandidates = mergeAccentCandidates(
    rankAccentCandidates(m, surface),
    rootTokenCandidates(m.rootTokens, surface),
  );
  const loudCandidates = rankLoudCandidates(m);
  const imageCandidates = rankImageCandidates(m, evidence.finalUrl || evidence.url);

  const { logo, refused: logoRefusals } = chooseLogo(m.logoCandidates || []);
  for (const r of logoRefusals) {
    refusals.push({ field: "logo", reason: r.reason, detail: `${r.url}${r.alt ? ` (alt="${r.alt}")` : ""}` });
  }

  let accentPick = null;
  if (accentCandidates.length) {
    const top = accentCandidates[0];
    // FAULT (b): a near-neutral that wins the ranking is an ABSTENTION, not an
    // answer. The page's loudest clickable colour being white means the page
    // has no measurable brand accent — and saying so lets the palette fall
    // back to the client's LOGO colour instead of shipping invisible buttons.
    const floor = accentFloorReason(top.hex);
    if (floor) {
      refusals.push({ field: "accent", reason: "below_saturation_floor", detail: `${top.hex}: ${floor}` });
      absent("accent", `top action colour ${top.hex} abstained: ${floor}`);
    } else {
      accentPick = top;
      const runnerUp = accentCandidates[1];
      const margin = runnerUp && runnerUp.score > 0 ? Math.min(1, (accentPick.score - runnerUp.score) / accentPick.score) : 1;
      setP(
        "accent",
        "measured",
        0.5 + 0.35 * margin,
        accentPick.role === "root_token"
          ? `the theme's own declared brand colour (${accentPick.token} in :root)${runnerUp ? `, ranked above the top measured action colour ${runnerUp.hex}` : ""} — not yet confirmed by vision`
          : `top-ranked action colour (${accentPick.role}, ${accentPick.count} elements)${accentPick.decidedBy ? `, ${accentPick.decidedBy}` : ""} — not yet confirmed by vision`,
      );
    }
  } else {
    absent("accent", "no action element carried a measurable colour");
  }

  const colours = resolveAccentColours(accentPick ? accentPick.hex : "", surface || "");
  const colorAdjustments = colours.adjustment ? [colours.adjustment] : [];
  if (colours.accentText) {
    setP(
      "accentText",
      colours.adjustment ? "derived" : "measured",
      colours.adjustment ? 0.9 : (provenance.accent ? provenance.accent.confidence : 0.5),
      colours.adjustment
        ? `brand ${colours.adjustment.original} measured ${colours.adjustment.ratioBefore}:1 on surface; moved to ${colours.adjustment.adjusted} at ${colours.adjustment.ratioAfter}:1`
        : `clears ${TEXT_CONTRAST_TARGET}:1 on surface unchanged`,
    );
  } else absent("accentText", "no accent to make text-safe");

  if (colours.accentHover) setP("accentHover", "derived", 0.8, "accent hue and saturation, lightness moved 8 points away from the surface");
  else absent("accentHover", "no accent to derive a hover state from");

  // --- images (measured half: hero is the biggest thing above the fold) ----
  // An <img> above the fold outranks a CSS background of any size: the
  // background is the decor a hero sits ON, the <img> is the picture it
  // SHOWS. Measured on familyhvac.net: the largest above-fold candidate is
  // bluebkg.png, a 1280x1224 backdrop texture, while the owner's portrait is
  // the 623x670 <img> beside the headline — and "their lead image" must mean
  // the portrait, or the wash inherits wallpaper.
  const heroCandidate = imageCandidates.find((i) => i.inFirstViewport && i.photoFloor && i.kind === "img")
    || imageCandidates.find((i) => i.inFirstViewport && i.photoFloor)
    || imageCandidates.find((i) => i.photoFloor) || null;
  const heroImage = heroCandidate ? {
    url: heroCandidate.url,
    width: heroCandidate.naturalWidth || heroCandidate.renderedWidth,
    height: heroCandidate.naturalHeight || heroCandidate.renderedHeight,
    alt: heroCandidate.alt,
    kind: heroCandidate.kind,
  } : null;
  if (heroImage) setP("heroImage", "measured", heroCandidate.inFirstViewport ? 0.85 : 0.6, `largest ${heroCandidate.kind} ${heroCandidate.inFirstViewport ? "above the fold" : "on the page"}`);
  else absent("heroImage", "no image met the photo floor (320x200, not logo-like)");

  absent("identityImages", "not judged — vision pass did not run");
  absent("loudElements", "not judged — vision pass did not run");
  absent("carryOver", "not judged — vision pass did not run");
  absent("typographyCharacter", "not judged — vision pass did not run");
  absent("temperature", "not judged — vision pass did not run");
  absent("character", "not judged — vision pass did not run");

  // --- the hero slogan (measured; vision may later confirm a different block)
  const heroSlogan = deriveHeroSlogan(loudCandidates, {
    businessName: opts.businessName || "",
    title: m.title || "",
  });
  if (heroSlogan) {
    setP(
      "heroSlogan",
      "measured",
      0.7,
      `largest sentence-like type above the fold (${heroSlogan.fontSize}px), the page's own DOM text verbatim`,
    );
  } else {
    absent("heroSlogan", "no sentence-like hero text above the fold that is not the name, a phone or a button");
  }

  return {
    version: BRIEF_VERSION,
    url: evidence.url || "",
    finalUrl: evidence.finalUrl || evidence.url || "",
    capturedAt: evidence.capturedAt || new Date().toISOString(),
    title: m.title || "",

    mode,
    surface,
    text,
    muted,
    border,
    accent: colours.accent,
    accentText: colours.accentText,
    accentHover: colours.accentHover,

    fontDisplay: fonts.display,
    fontBody: fonts.body,
    fontHref: "",
    fontWeights: { display: fonts.displayWeights || [], body: fonts.bodyWeights || [] },

    typographyCharacter: null,
    temperature: null,
    character: null,

    heroImage,
    heroSlogan,
    identityImages: [],
    loudElements: [],
    carryOver: [],

    colorAdjustments,
    refusals,
    provenance,

    measurements: {
      surfaceCandidates: rankTally(m.backgrounds, 0.01).slice(0, 8),
      textCandidates: inks.slice(0, 6),
      borderCandidates: borders.slice(0, 5),
      accentCandidates,
      rootTokens: m.rootTokens || {},
      brightShare: shares.brightShare,
      darkShare: shares.darkShare,
      loudCandidates,
      images: imageCandidates,
      fonts: fonts.families,
      logo,
      logoCandidates: (m.logoCandidates || []).length,
      pixelSurface: evidence.pixelSurface || "",
      pixelShare: evidence.pixelShare || 0,
      docHeight: m.docHeight || 0,
      elementCount: m.elementCount || 0,
      truncatedElements: !!m.truncatedElements,
      visibleTextChars: (m.visibleText || []).join(" ").length,
      // The MOBILE capture's image URLs, kept so the identity pass can tell a
      // picture the site shows on BOTH viewports (their hero portrait on
      // desktop AND phone) from one that only decorates the wide layout.
      // Measured, never judged: it is the mobile DOM's own list.
      mobileImageUrls: ((evidence.mobileMeasured && evidence.mobileMeasured.images) || [])
        .map((i) => String(i.url || "")).filter(Boolean).slice(0, 64),
    },
  };
}

// ---------------------------------------------------------------------------
// the vision pass — judgement only, indexes only
// ---------------------------------------------------------------------------

/**
 * The prompt. Every list is MEASURED and INDEXED; the model's only power over a
 * value is to choose which measured one is right. It is told, in terms, that it
 * may not emit a colour or a URL — and the parser enforces that regardless of
 * whether it complied.
 */
function buildVisionPrompt(brief) {
  const mm = brief.measurements;
  const accents = mm.accentCandidates.map((c) =>
    `  [${c.index}] ${c.hex} — used as ${c.role} on ${c.count} element(s)${c.labels.length ? `, e.g. "${c.labels.join('", "')}"` : ""}`).join("\n") || "  (none measured)";
  const louds = mm.loudCandidates.map((c) =>
    `  [${c.index}] "${c.text.slice(0, 100)}" — ${Math.round(c.fontSize)}px${c.weight >= 600 ? " bold" : ""}${c.background ? ` on ${c.background}` : ""}${c.pinned ? ", pinned" : ""}${c.inFirstViewport ? ", above the fold" : ""}`).join("\n") || "  (none measured)";
  const imgs = mm.images.map((c) =>
    `  [${c.index}] ${c.kind} ${c.naturalWidth || c.renderedWidth}x${c.naturalHeight || c.renderedHeight}${c.inFirstViewport ? " above-fold" : ""}${c.logoLike ? " LOGO-LIKE" : ""}${c.alt ? ` alt="${c.alt.slice(0, 60)}"` : ""}`).join("\n") || "  (none measured)";

  return `You are looking at screenshots of a small business's own website. A designer is about to rebuild it and needs to know what matters about how it looks.

ALREADY MEASURED FROM THE PAGE — do not restate, do not correct, do not invent alternatives:
  page background ${brief.surface || "unknown"} (${brief.mode})
  body text ${brief.text || "unknown"}
  display face "${brief.fontDisplay || "unknown"}", body face "${brief.fontBody || "unknown"}"

COLOURS USED ON CLICKABLE THINGS (measured):
${accents}

LOUDEST TEXT BLOCKS (measured):
${louds}

IMAGES ON THE PAGE (measured):
${imgs}

YOUR JOB is judgement, not measurement. Rules, and they are absolute:
1. NEVER write a hex code, a URL, a pixel size or a font name. Refer to everything by its [index].
2. Report ONLY what is legible in the screenshots. If you cannot read it, leave it out. An empty answer is correct; a guess is not.
3. Do not infer a certification, award, licence, warranty, insurance, rating or years-in-business from a badge shape, a logo, or a colour. If the words are not readable, that item does not exist.
4. Quote text EXACTLY as it appears. Do not tidy it, expand abbreviations or fix its capitalisation.

Answer with ONE JSON object and nothing else:
{
  "temperature": "warm" | "cool" | "neutral",
  "character": "corporate" | "family-run" | "premium" | "utilitarian" | "clinical" | "playful" | "traditional",
  "character_words": "<up to 12 plain words on how the page FEELS>",
  "accent": { "candidate_index": <int or null>, "why": "<why this is the ACTION colour rather than one that merely appears a lot>" },
  "typography_character": "heavy industrial" | "clean modern" | "friendly rounded" | "traditional serif" | "condensed sans" | "elegant script" | "technical mono",
  "loud_elements": [
    { "candidate_index": <int or null>, "kind": "<promo|financing|emergency_line|phone|hours|owner_photo|mascot|truck|certification|award|warranty|rating|guarantee|discount|cta|slogan|other>",
      "text": "<exactly as printed, or \\"\\" if it is a picture with no words>",
      "text_source": "dom" | "image",
      "band": "top" | "upper" | "middle" | "lower" | "bottom",
      "confidence": 0.0-1.0 }
  ],
  "hero_image_index": <int or null>,
  "identity_images": [ { "index": <int>, "what": "crew|van|premises|finished_work|owner|storefront|team|equipment", "confidence": 0.0-1.0 } ],
  "filler_images": [ <int> ],
  "carry_over": [ { "what": "<the thing>", "why": "<what a customer would miss if it were gone>", "anchor_kind": "loud"|"image"|"none", "anchor_index": <int or null>, "confidence": 0.0-1.0 } ]
}

"identity_images" means photographs of THIS business — their crew, their vehicle, their premises, work they finished. "filler_images" means stock photography, illustrations, icons and anything that could belong to any company in the trade.
"slogan" means the hero's own tagline or motto — the sentence the page leads with. It is never the business's name, never a phone number and never a button label. Report it with the candidate_index of the measured text block that carries it.
Set "candidate_index" only when a loud element matches a measured text block. If it is a graphic with no matching measured text, use null and say text_source "image".`;
}

/** Pull the first balanced JSON object out of a model's reply. */
function extractJsonObject(text) {
  const raw = String(text || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "");
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Per-million-token USD prices, keyed by a substring of the model id.
 *
 * Only used to turn MEASURED token counts into a spend figure an operator can
 * budget against — the token counts themselves always come from the provider's
 * own usage block, never from an estimate. An unknown model yields
 * `costUsd: null` rather than a made-up number, on the same principle as the
 * rest of this file: absent is a legitimate answer, invented is not.
 */
const MODEL_PRICES = [
  { match: /claude-(sonnet-4|3-5-sonnet|sonnet-4\.5|sonnet-4-5)/i, inPerM: 3, outPerM: 15 },
  { match: /claude-(opus-4|opus-4\.1|opus-4-1)/i, inPerM: 15, outPerM: 75 },
  { match: /claude-(haiku-4|3-5-haiku|haiku-4-5|haiku-4\.5)/i, inPerM: 1, outPerM: 5 },
  { match: /gemini-[23]\.\d-flash/i, inPerM: 0.3, outPerM: 2.5 },
];

function priceVision(model, inputTokens, outputTokens) {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const row = MODEL_PRICES.find((p) => p.match.test(String(model || "")));
  if (!row) return null;
  return Math.round(((inputTokens / 1e6) * row.inPerM + (outputTokens / 1e6) * row.outPerM) * 1e6) / 1e6;
}

/** Normalise the two providers' differently-named usage blocks into one shape. */
function readUsage(model, raw) {
  const u = raw || {};
  const inputTokens = Number(u.input_tokens ?? u.prompt_tokens);
  const outputTokens = Number(u.output_tokens ?? u.completion_tokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
    costUsd: priceVision(model, inputTokens, outputTokens),
  };
}

/**
 * One vision call, over whichever provider actually answers.
 *
 * Measured 2026-08-10: the breadcrumb ANTHROPIC_API_KEY returns 401 for every
 * model, and OpenRouter answers with images on the first try. Production's
 * Anthropic key does work, so both are tried, in that order, and an auth
 * failure falls through instead of failing the run.
 */
async function callVisionModel({ prompt, shots, fetchImpl = fetch, timeoutMs = 90000, model = "" } = {}) {
  const images = (shots || []).filter((s) => s && s.buffer);
  if (!images.length) return { ok: false, reason: "no_screenshots" };

  const anthropicKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  const openrouterKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  const attempts = [];
  // Wall-clock for the model call ALONE. The interesting operational number is
  // how much of a brief's runtime is the network round-trip versus Chromium —
  // they scale differently and are paid for differently.
  const callStarted = Date.now();

  const withTimeout = async (fn) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fn(controller.signal); } finally { clearTimeout(timer); }
  };

  if (anthropicKey) {
    const m = model || process.env.DESIGN_BRIEF_MODEL || "claude-sonnet-4-5";
    try {
      const res = await withTimeout((signal) => fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: m,
          max_tokens: 2500,
          messages: [{
            role: "user",
            content: [
              ...images.map((s) => ({
                type: "image",
                source: { type: "base64", media_type: s.mediaType || "image/jpeg", data: Buffer.from(s.buffer).toString("base64") },
              })),
              { type: "text", text: prompt },
            ],
          }],
        }),
      }));
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = (json.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("\n");
        const parsed = extractJsonObject(text);
        if (parsed) return { ok: true, provider: "anthropic", model: m, parsed, raw: text, usage: readUsage(m, json.usage), ms: Date.now() - callStarted };
        attempts.push(`anthropic:${m}:unparseable`);
      } else {
        attempts.push(`anthropic:${m}:${res.status}:${String(json?.error?.type || "").slice(0, 40)}`);
      }
    } catch (e) {
      attempts.push(`anthropic:${m}:${boundedDetailText((e && e.message) || e, 60)}`);
    }
  }

  if (openrouterKey) {
    const m = model || process.env.DESIGN_BRIEF_MODEL_OPENROUTER || "anthropic/claude-sonnet-4.5";
    try {
      const res = await withTimeout((signal) => fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${openrouterKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: m,
          max_tokens: 2500,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...images.map((s) => ({
                type: "image_url",
                image_url: { url: `data:${s.mediaType || "image/jpeg"};base64,${Buffer.from(s.buffer).toString("base64")}` },
              })),
            ],
          }],
        }),
      }));
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = String(json?.choices?.[0]?.message?.content || "");
        const parsed = extractJsonObject(text);
        if (parsed) return { ok: true, provider: "openrouter", model: m, parsed, raw: text, usage: readUsage(m, json.usage), ms: Date.now() - callStarted };
        attempts.push(`openrouter:${m}:unparseable`);
      } else {
        attempts.push(`openrouter:${m}:${res.status}:${String(json?.error?.message || "").slice(0, 60)}`);
      }
    } catch (e) {
      attempts.push(`openrouter:${m}:${boundedDetailText((e && e.message) || e, 60)}`);
    }
  }

  if (!anthropicKey && !openrouterKey) return { ok: false, reason: "no_vision_key" };
  return { ok: false, reason: `vision_unavailable: ${attempts.join(" || ")}` };
}

// ---------------------------------------------------------------------------
// merging judgement into the measured brief — where the truth law is enforced
// ---------------------------------------------------------------------------

/**
 * applyVision(brief, seen, { visibleText }) -> brief
 *
 * PURE, and deliberately paranoid. Everything the model said is checked against
 * the measured evidence before it is allowed into the brief:
 *   · an index out of range is dropped, not clamped
 *   · a colour or URL it typed is ignored; only the indexed measured value is used
 *   · a CLAIM must have its exact words in the measured DOM text or it is refused
 *   · every confidence is clamped, then capped at SEEN_CONFIDENCE_CEILING
 * Everything dropped lands in brief.refusals with a reason, so an operator can
 * see what the model tried to say.
 */
function applyVision(baseBrief, seen, { visibleText = [] } = {}) {
  const brief = { ...baseBrief };
  const mm = brief.measurements;
  const refusals = [...(brief.refusals || [])];
  const provenance = { ...brief.provenance };
  const haystack = " " + normalizeForMatch(visibleText.join(" ")) + " ";

  const setP = (field, source, confidence, note) => {
    provenance[field] = { source, confidence: round2(Math.min(SEEN_CONFIDENCE_CEILING, clamp01(confidence))), note: note || "" };
  };
  const refuse = (field, reason, detail) => {
    refusals.push({ field, reason, detail: boundedDetailText(detail || "", 200) });
  };

  if (!seen || typeof seen !== "object") {
    refuse("vision", "no_vision_result", "brief is the measured half only");
    brief.refusals = refusals;
    return brief;
  }

  const ENUM = {
    temperature: ["warm", "cool", "neutral"],
    character: ["corporate", "family-run", "premium", "utilitarian", "clinical", "playful", "traditional"],
    typography_character: ["heavy industrial", "clean modern", "friendly rounded", "traditional serif", "condensed sans", "elegant script", "technical mono"],
  };
  const pickEnum = (field, value) => {
    const v = String(value || "").trim().toLowerCase();
    return ENUM[field].includes(v) ? v : "";
  };

  // --- feel ---------------------------------------------------------------
  const temperature = pickEnum("temperature", seen.temperature);
  if (temperature) { brief.temperature = temperature; setP("temperature", "seen", 0.7, "vision judgement over the screenshots"); }
  else if (seen.temperature) refuse("temperature", "not_in_vocabulary", seen.temperature);

  const character = pickEnum("character", seen.character);
  if (character) {
    brief.character = character;
    const words = String(seen.character_words || "").replace(/\s+/g, " ").trim().slice(0, 90);
    brief.characterWords = words || "";
    setP("character", "seen", 0.65, words);
  } else if (seen.character) refuse("character", "not_in_vocabulary", seen.character);

  const typography = pickEnum("typography_character", seen.typography_character);
  if (typography) { brief.typographyCharacter = typography; setP("typographyCharacter", "seen", 0.7, `describes the measured face "${brief.fontDisplay || "unknown"}"`); }
  else if (seen.typography_character) refuse("typographyCharacter", "not_in_vocabulary", seen.typography_character);

  // --- accent: an INDEX into measured colours, never a hex ----------------
  const accentPick = seen.accent && Number.isInteger(seen.accent.candidate_index) ? seen.accent.candidate_index : null;
  if (accentPick != null) {
    const candidate = mm.accentCandidates.find((c) => c.index === accentPick);
    const candidateFloor = candidate ? accentFloorReason(candidate.hex) : "";
    if (!candidate) {
      refuse("accent", "candidate_index_out_of_range", `vision asked for [${accentPick}] of ${mm.accentCandidates.length}`);
    } else if (candidateFloor) {
      // FAULT (b) applies to judgement too: vision may say which measured
      // colour is the action colour, but it cannot promote a near-neutral into
      // a brand accent. The floor is one rule, enforced on both paths.
      refuse("accent", "below_saturation_floor", `[${accentPick}] ${candidate.hex}: ${candidateFloor}`);
    } else {
      const colours = resolveAccentColours(candidate.hex, brief.surface || "");
      brief.accent = colours.accent;
      brief.accentText = colours.accentText;
      brief.accentHover = colours.accentHover;
      brief.colorAdjustments = colours.adjustment ? [colours.adjustment] : [];
      const why = String((seen.accent && seen.accent.why) || "").replace(/\s+/g, " ").trim().slice(0, 140);
      setP("accent", "measured", 0.9, `measured hex, chosen from ${mm.accentCandidates.length} measured candidates by vision${why ? `: ${why}` : ""}`);
      if (colours.accentText) {
        setP(
          "accentText",
          colours.adjustment ? "derived" : "measured",
          colours.adjustment ? 0.9 : 0.88,
          colours.adjustment
            ? `brand ${colours.adjustment.original} measured ${colours.adjustment.ratioBefore}:1 on surface; moved to ${colours.adjustment.adjusted} at ${colours.adjustment.ratioAfter}:1`
            : `clears ${TEXT_CONTRAST_TARGET}:1 on surface unchanged`,
        );
      }
      if (colours.accentHover) setP("accentHover", "derived", 0.8, "accent hue and saturation, lightness moved 8 points away from the surface");
    }
  }
  // Note: an absent accent pick leaves the MEASURED top-ranked accent in place.
  // That is deliberate — the measured brief is already a valid answer.

  // --- loud elements ------------------------------------------------------
  const loud = [];
  for (const item of Array.isArray(seen.loud_elements) ? seen.loud_elements.slice(0, MAX_LOUD_ELEMENTS * 3) : []) {
    if (!item || typeof item !== "object") continue;
    const kind = String(item.kind || "other").trim().toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 32) || "other";
    const quoted = String(item.text || "").replace(/\s+/g, " ").trim().slice(0, 180);
    const idx = Number.isInteger(item.candidate_index) ? item.candidate_index : null;
    const candidate = idx == null ? null : mm.loudCandidates.find((c) => c.index === idx);

    if (idx != null && !candidate) {
      refuse("loudElements", "candidate_index_out_of_range", `[${idx}] of ${mm.loudCandidates.length}: "${quoted}"`);
      continue;
    }

    // The text is VERIFIED when the measured DOM contains it. Anything read off
    // a JPEG is not verified, and that distinction decides what may be claimed.
    const needle = normalizeForMatch(quoted);
    const textVerified = !!candidate || (needle.length >= 4 && haystack.includes(" " + needle + " ")) ||
      (needle.length >= 8 && haystack.includes(needle));
    const isClaim = CLAIM_KINDS.has(kind) || CLAIM_WORDS.test(quoted);

    if (isClaim && !textVerified) {
      // THE line. A credential nobody can find in the page's own text does not
      // go on a real business's website because a model thought it saw a seal.
      refuse("loudElements", "unverifiable_claim", `${kind}: "${quoted}" — not present in the measured page text`);
      continue;
    }
    if (!quoted && !candidate) {
      refuse("loudElements", "no_text_and_no_measured_anchor", kind);
      continue;
    }

    const band = String(item.band || "").trim().toLowerCase();
    const rect = candidate ? candidate.rect : null;
    loud.push({
      kind,
      text: candidate ? candidate.text : quoted,
      textVerified,
      isClaim,
      rect,
      crop: rect
        ? { shot: "full-page", x: rect.x, y: rect.y, width: rect.width, height: rect.height, source: "measured" }
        : { shot: "full-page", band: ["top", "upper", "middle", "lower", "bottom"].includes(band) ? band : "unknown", source: "seen" },
      viewport: "desktop",
      // Ceiling FIRST, then the unverified discount — so text read off a JPEG
      // is always strictly less trusted than text the DOM confirms, however
      // certain the model claimed to be.
      confidence: round2(
        Math.min(SEEN_CONFIDENCE_CEILING, clamp01(item.confidence != null ? item.confidence : 0.6)) *
        (textVerified ? 1 : 0.7),
      ),
    });
    if (loud.length >= MAX_LOUD_ELEMENTS) break;
  }
  brief.loudElements = loud;
  if (loud.length) setP("loudElements", "seen", 0.75, `${loud.filter((l) => l.textVerified).length}/${loud.length} DOM-verified`);
  else provenance.loudElements = { source: "absent", confidence: 0, note: "nothing loud survived verification" };

  // --- the hero slogan, when vision confirmed one -------------------------
  // Judgement chooses WHICH measured block is the slogan; the string itself is
  // always the DOM's own (candidate-anchored, so textVerified by construction).
  // The measured heuristic already picked the largest sentence; a confirmed
  // pick replaces it, and an unanchored or unverified "slogan" cannot.
  // Vision may tag SEVERAL blocks "slogan" (Farr's carousel: the motto and a
  // pricing line both) — and, measured across two runs of the SAME page, it
  // tagged "BIG CITY SERVICE. SMALL TOWN VALUES." slogan on one run and promo
  // on the next. The promo/slogan boundary is therefore not vision's to draw:
  // OFFER_WORDS is the deterministic arbiter. A money-talking "slogan" is
  // accepted only when the measured heuristic found no motto at all — their
  // hero really is an offer then, and it is still their own sentence.
  const sloganTagged = loud.filter((l) => (l.kind === "slogan" || l.kind === "tagline") && l.textVerified && l.rect);
  const nonOfferSlogan = sloganTagged.find((l) => !OFFER_WORDS.test(String(l.text || "")));
  const sloganSeen = nonOfferSlogan || (!brief.heroSlogan ? sloganTagged[0] : null);
  if (sloganSeen) {
    const text = String(sloganSeen.text || "").replace(/\s+/g, " ").trim();
    if (text.length >= 6 && text.length <= MAX_SLOGAN_CHARS) {
      brief.heroSlogan = {
        text,
        display: foldShoutCase(text),
        fontSize: brief.heroSlogan && brief.heroSlogan.text === text ? brief.heroSlogan.fontSize : null,
        index: null,
        source: "measured+seen",
      };
      setP("heroSlogan", "measured", 0.85, "vision confirmed which loud block is the slogan; the text is the DOM's own");
    }
  } else if (brief.heroSlogan) {
    // Judgement refines the heuristic in BOTH directions — but only where
    // judgement is actually stable. A phone line, an emergency banner, an
    // hours chip, a rating figure or a button label is a SEMANTIC call vision
    // gets right, and the largest hero text being one of those means the page
    // has no motto. The promo/slogan boundary is NOT on this list on purpose:
    // vision drew it differently on two runs of the same page, and
    // OFFER_WORDS already arbitrates money-talk deterministically. "other"
    // does not demote either; it means vision had no name for it.
    const RECLASSIFY_KINDS = new Set(["phone", "emergency_line", "hours", "rating", "cta"]);
    const sloganNorm = normalizeForMatch(brief.heroSlogan.text);
    const reclassified = loud.find((l) =>
      l.textVerified
      && normalizeForMatch(l.text) === sloganNorm
      && RECLASSIFY_KINDS.has(l.kind));
    if (reclassified) {
      refuse("heroSlogan", "vision_reclassified", `"${brief.heroSlogan.text}" judged ${reclassified.kind}, not a slogan`);
      brief.heroSlogan = null;
      provenance.heroSlogan = { source: "absent", confidence: 0, note: `the largest hero text was judged ${reclassified.kind}, not a motto` };
    }
  }

  // --- images -------------------------------------------------------------
  const heroIdx = Number.isInteger(seen.hero_image_index) ? seen.hero_image_index : null;
  if (heroIdx != null) {
    const hero = mm.images.find((c) => c.index === heroIdx);
    if (!hero) refuse("heroImage", "index_out_of_range", `[${heroIdx}] of ${mm.images.length}`);
    else if (hero.logoLike) refuse("heroImage", "logo_is_not_a_hero", hero.url);
    else if (hero.thirdPartyMark) refuse("heroImage", "third_party_mark", hero.url);
    else {
      brief.heroImage = {
        url: hero.url,
        width: hero.naturalWidth || hero.renderedWidth,
        height: hero.naturalHeight || hero.renderedHeight,
        alt: hero.alt,
        kind: hero.kind,
      };
      setP("heroImage", "measured", 0.85, "measured URL and dimensions; vision chose which measured image leads the page");
    }
  }

  const identity = [];
  for (const item of Array.isArray(seen.identity_images) ? seen.identity_images.slice(0, MAX_IDENTITY_IMAGES * 2) : []) {
    if (!item || !Number.isInteger(item.index)) continue;
    const img = mm.images.find((c) => c.index === item.index);
    if (!img) { refuse("identityImages", "index_out_of_range", `[${item.index}] of ${mm.images.length}`); continue; }
    if (img.logoLike) { refuse("identityImages", "logo_is_not_a_photograph", img.url); continue; }
    if (img.thirdPartyMark) { refuse("identityImages", "third_party_mark", img.url); continue; }
    if (!img.photoFloor) { refuse("identityImages", "below_photo_floor", `${img.url} (${img.naturalWidth || img.renderedWidth}x${img.naturalHeight || img.renderedHeight})`); continue; }
    if (identity.some((e) => e.url === img.url)) continue;
    identity.push({
      url: img.url,
      width: img.naturalWidth || img.renderedWidth,
      height: img.naturalHeight || img.renderedHeight,
      alt: img.alt,
      kind: img.kind,
      sameOrigin: img.sameOrigin,
      inFirstViewport: !!img.inFirstViewport,
      what: String(item.what || "").trim().toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 24) || "unspecified",
      confidence: round2(Math.min(SEEN_CONFIDENCE_CEILING, clamp01(item.confidence != null ? item.confidence : 0.6))),
    });
    if (identity.length >= MAX_IDENTITY_IMAGES) break;
  }

  // THE OWNER-PHOTO HOT POINT (owner, 2026-08-12, Family Heating): the owner
  // appears in his own hero on desktop AND mobile, and the mirror dropped him.
  // A PERSON FEATURING PROMINENTLY ON THEIR OWN SITE IS IDENTITY, not
  // decoration — the one picture a returning customer recognises instantly.
  //
  // So a human-subject identity image (vision's what: owner/team/crew) is
  // promoted to IDENTITY-CRITICAL when the site itself treats it prominently:
  //   · it IS the page's hero image, or
  //   · it is above the fold on desktop, or
  //   · it recurs on the mobile layout (measured: the mobile DOM lists the
  //     same URL — a picture kept on a 390px screen is a picture they insist on).
  // Promotion means FIRST in identityImages — ordering is this contract's fill
  // order — with identityCritical:true and the evidence in criticalWhy.
  // Everything here is a re-ranking of already-gated entries: logoLike,
  // thirdPartyMark and photoFloor refusals have already run, so nothing stock
  // and nobody else's person can be promoted. The consumer's hard gate stays
  // the photo bank's ownership check (their site or GBP), unchanged.
  {
    const HUMAN_WHAT = new Set(["owner", "team", "crew"]);
    const mobileUrls = new Set(mm.mobileImageUrls || []);
    const heroUrl = brief.heroImage ? String(brief.heroImage.url || "") : "";
    for (const e of identity) {
      if (!HUMAN_WHAT.has(e.what)) continue;
      const why = [];
      if (heroUrl && e.url === heroUrl) why.push("is their current hero image");
      if (e.inFirstViewport) why.push("above the fold on their desktop layout");
      if (mobileUrls.has(e.url)) why.push("recurs on their mobile layout");
      if (why.length) {
        e.identityCritical = true;
        e.criticalWhy = why.join("; ");
      }
    }
    const critical = identity.filter((e) => e.identityCritical);
    // Stable promotion: critical portraits first, everything else keeps its
    // relative order behind them. Ordering IS this contract's fill order.
    brief.identityImages = critical.length
      ? [...critical, ...identity.filter((e) => !e.identityCritical)]
      : identity;
    if (critical.length) {
      setP(
        "identityImages",
        "seen",
        0.8,
        `${identity.length} judged theirs; ${critical.length} human portrait(s) ranked IDENTITY-CRITICAL (${critical.map((c) => `${c.what}: ${c.criticalWhy}`).join(" | ").slice(0, 160)})`,
      );
    } else if (identity.length) {
      setP("identityImages", "seen", 0.75, `${identity.length} of ${mm.images.length} measured images judged to be this business's own; URLs and sizes are measured`);
    } else {
      provenance.identityImages = { source: "absent", confidence: 0, note: "no image was judged to show this business itself" };
    }
  }

  const filler = (Array.isArray(seen.filler_images) ? seen.filler_images : [])
    .filter((i) => Number.isInteger(i))
    .map((i) => mm.images.find((c) => c.index === i))
    .filter(Boolean)
    .map((img) => img.url);
  brief.fillerImages = filler;

  // --- carry-over ---------------------------------------------------------
  const carry = [];
  for (const item of Array.isArray(seen.carry_over) ? seen.carry_over.slice(0, 16) : []) {
    if (!item || typeof item !== "object") continue;
    const what = String(item.what || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!what) continue;
    const why = String(item.why || "").replace(/\s+/g, " ").trim().slice(0, 180);
    const anchorKind = ["loud", "image"].includes(String(item.anchor_kind || "").toLowerCase()) ? String(item.anchor_kind).toLowerCase() : "none";
    let anchor = null;
    if (anchorKind === "loud" && Number.isInteger(item.anchor_index)) {
      const c = mm.loudCandidates.find((x) => x.index === item.anchor_index);
      if (c) anchor = { kind: "loud", text: c.text, rect: c.rect };
    } else if (anchorKind === "image" && Number.isInteger(item.anchor_index)) {
      const c = mm.images.find((x) => x.index === item.anchor_index);
      if (c) anchor = { kind: "image", url: c.url };
    }
    if (CLAIM_WORDS.test(what) && !haystack.includes(normalizeForMatch(what))) {
      refuse("carryOver", "unverifiable_claim", what);
      continue;
    }
    carry.push({
      what, why, anchor,
      anchored: !!anchor,
      confidence: round2(Math.min(anchor ? SEEN_CONFIDENCE_CEILING : 0.5, clamp01(item.confidence != null ? item.confidence : 0.5))),
    });
    if (carry.length >= 10) break;
  }
  // Their own person on their own site leads the mirror's checklist. Anchored
  // to the measured image, deduplicated against anything vision already said
  // about the same URL, and placed FIRST — identity outranks decoration.
  {
    const lead = (brief.identityImages || []).find((e) => e.identityCritical);
    if (lead && !carry.some((c) => c.anchor && c.anchor.kind === "image" && c.anchor.url === lead.url)) {
      carry.unshift({
        what: `their own ${lead.what} photo`,
        why: `a person features prominently on their own site (${lead.criticalWhy}) — the face is the identity a customer recognises`,
        anchor: { kind: "image", url: lead.url },
        anchored: true,
        confidence: lead.confidence,
      });
      if (carry.length > 10) carry.length = 10;
    }
  }
  brief.carryOver = carry;
  if (carry.length) setP("carryOver", "seen", 0.6, `${carry.filter((c) => c.anchored).length}/${carry.length} anchored to a measured element`);
  else provenance.carryOver = { source: "absent", confidence: 0, note: "vision named nothing worth carrying over" };

  brief.refusals = refusals;
  brief.provenance = provenance;
  return brief;
}

// ---------------------------------------------------------------------------
// crops — the rectangle is measured, so the picture of it is too
// ---------------------------------------------------------------------------

/**
 * Clip each loud element out of the live page. Scrolling first and clipping in
 * VIEWPORT coordinates avoids relying on full-page clip semantics, which differ
 * between Chromium builds.
 */
/**
 * A picture of each loud element, clipped at its MEASURED rectangle.
 *
 * DOCUMENT COORDINATES, NOT VIEWPORT COORDINATES. This used to scroll the live
 * page to each element and clip the viewport, and on a real page that quietly
 * produced pictures of the wrong thing: measured on mmheatingandcooling.com,
 * 2026-08-11, the crop for the hero headline showed the Trane badge and the
 * Wells Fargo banner instead — the sticky header re-covered the target after
 * the scroll, and a rotating hero reflowed underneath it. The rect was right;
 * the picture was not.
 *
 * That is the worst failure this file can have. The crop exists so an operator
 * can check the brief against the page instead of taking its word — a crop that
 * shows a DIFFERENT element than the one it is labelled with actively
 * misleads, and it is the third-party badge sitting in that wrong crop that
 * makes it dangerous.
 *
 * `clip` with `fullPage` is resolved by Chromium against the whole scrollable
 * page, which is the same coordinate space `getBoundingClientRect` + scrollY
 * was measured in, so there is no scroll to race. It also makes the recorded
 * `crop.shot: "full-page"` true, which it previously was not.
 */
async function captureLoudCrops(page, loudElements, { padding = 12, max = MAX_LOUD_ELEMENTS } = {}) {
  const out = [];
  const pageWidth = (page.viewportSize() || { width: DESKTOP.width }).width;
  for (const el of (loudElements || []).slice(0, max)) {
    if (!el.rect) { out.push(null); continue; }
    try {
      const x = Math.max(0, el.rect.x - padding);
      const y = Math.max(0, el.rect.y - padding);
      const width = Math.min(pageWidth - x, el.rect.width + padding * 2);
      const height = el.rect.height + padding * 2;
      if (width < 4 || height < 4) { out.push(null); continue; }
      out.push(await page.screenshot({ type: "png", fullPage: true, clip: { x, y, width, height } }));
    } catch {
      // A rect past the bottom of the rendered page cannot be clipped. Absent
      // is the honest answer; a fallback screenshot of somewhere else is not.
      out.push(null);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// a stylesheet that serves the fonts we actually MEASURED
// ---------------------------------------------------------------------------

/**
 * Does this Google Fonts URL really serve these families?
 *
 * Google's css2 endpoint answers 400 for a family it has never heard of, and
 * names every family it does serve inside the CSS it returns. So this is a
 * measurement, not an assumption — which matters, because an href that does
 * not serve the face silently falls back to a system font and the mirror ships
 * in Arial while the brief says Montserrat.
 */
async function verifyFontHref(href, families, fetchImpl = fetch) {
  if (!href || !families.length) return false;
  try {
    const res = await fetchImpl(href, {
      headers: {
        // Without a modern UA Google serves the legacy TTF sheet. Either sheet
        // proves the family exists; this just keeps the response small.
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res || !res.ok) return false;
    const css = await res.text();
    return families.every((f) => css.toLowerCase().includes(String(f).toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * attachFontHref — the RENDERED families win, always.
 *
 * Measured on whitebirdfence.com: the page LINKS Open Sans and RENDERS
 * Montserrat and Raleway. Handing a builder the Open Sans link because the
 * markup declared it would ship a site in a typeface the client does not use,
 * while the brief truthfully named the two they do — the worst of both. So the
 * declared href is used only when it serves what we measured; otherwise one is
 * built for the measured families and VERIFIED before it is offered, and if it
 * cannot be verified the field is absent rather than wrong.
 */
async function attachFontHref(briefIn, evidence, fetchImpl = fetch) {
  const brief = briefIn;
  const rendered = [brief.fontDisplay, brief.fontBody].filter(Boolean);
  const setAbsent = (note) => { brief.provenance.fontHref = { source: "absent", confidence: 0, note }; return brief; };

  if (!rendered.length) return setAbsent("no family was measured, so there is nothing to serve");

  let captured = null;
  try {
    const { captureFonts } = require("./font-capture");
    captured = await captureFonts(evidence.finalUrl || evidence.url, { fetchImpl });
  } catch (e) {
    captured = { ok: false, reason: `font lookup failed: ${boundedDetailText((e && e.message) || e, 80)}` };
  }

  const declared = captured && captured.ok
    ? [captured.display, captured.body].filter(Boolean)
    : [];
  const declaredLower = declared.map((s) => s.toLowerCase());
  const serves = declaredLower.length && rendered.every((r) => declaredLower.includes(r.toLowerCase()));

  if (captured && captured.ok && captured.href && serves) {
    brief.fontHref = captured.href;
    brief.provenance.fontHref = {
      source: "measured",
      confidence: 0.9,
      note: `the site's own stylesheet (${captured.provider}) serves the families it renders`,
    };
    return brief;
  }

  if (declared.length) {
    brief.refusals.push({
      field: "fontHref",
      reason: "declared_and_rendered_disagree",
      detail: `renders ${rendered.join("/")} but links ${declared.join("/")} — the declared stylesheet was NOT used`,
    });
  }

  try {
    const { googleHrefFor } = require("./font-capture");
    const candidate = googleHrefFor({ display: brief.fontDisplay, body: brief.fontBody });
    if (candidate && await verifyFontHref(candidate, rendered, fetchImpl)) {
      brief.fontHref = candidate;
      brief.provenance.fontHref = {
        source: "measured",
        confidence: 0.85,
        note: `built for the families actually rendered (${rendered.join(", ")}) and verified against Google Fonts`,
      };
      return brief;
    }

    // The check above is all-or-nothing across BOTH faces, so a single
    // un-serveable body face used to suppress a perfectly serveable display
    // face — and the headline typeface is the part a person actually notices.
    // Retry for the display face on its own.
    //
    // Dropping fontBody is LOAD-BEARING, not tidiness. briefFonts() in
    // mirror-lane-build pairs whichever families the brief names with this one
    // href, so a body family left standing next to a display-only href asks
    // the browser for a face the stylesheet never loads — body copy then
    // reverts to the browser default, which is worse than the donor's own body
    // face. Naming only what the href provably serves leaves body type to the
    // donor, which is the honest fallback.
    const bodyOnly = brief.fontBody && brief.fontBody !== brief.fontDisplay;
    if (brief.fontDisplay && bodyOnly) {
      const displayOnly = googleHrefFor({ display: brief.fontDisplay });
      if (displayOnly && await verifyFontHref(displayOnly, [brief.fontDisplay], fetchImpl)) {
        const droppedBody = brief.fontBody;
        brief.fontHref = displayOnly;
        brief.fontBody = null;
        brief.refusals.push({
          field: "fontBody",
          reason: "body_face_not_servable",
          detail: `renders ${droppedBody} but no verified source serves it — body type is left to the donor so the display face ${brief.fontDisplay} could still be served`,
        });
        brief.provenance.fontBody = {
          source: "absent",
          confidence: 0,
          note: `${droppedBody} was rendered but could not be verifiably served, so it is not named`,
        };
        brief.provenance.fontHref = {
          source: "measured",
          confidence: 0.8,
          note: `built for the rendered display face (${brief.fontDisplay}) alone and verified against Google Fonts; ${droppedBody} could not be served, so body type is left to the donor`,
        };
        return brief;
      }
    }
  } catch { /* fall through to absent */ }

  return setAbsent(
    declared.length
      ? `the site links ${declared.join("/")} but renders ${rendered.join("/")}, and no verified source was found for those`
      : (captured && captured.reason) || `no verifiable source found for ${rendered.join("/")}`,
  );
}

// ---------------------------------------------------------------------------
// the orchestrator
// ---------------------------------------------------------------------------

/**
 * buildDesignBrief(url, options) -> { ok, brief, evidence }
 *
 * options:
 *   browser      an already-open Chromium (not closed by this function)
 *   vision       false to skip the model entirely (measured brief only)
 *   crops        false to skip clipping loud elements
 *   fetchImpl    injectable fetch, for the vision call
 *   fonts        false to skip the servable-stylesheet lookup
 *   model        override the vision model
 *
 * Never throws for an unreachable site: it returns ok:false with a reason,
 * because a pipeline stage that throws takes the whole row with it.
 */
async function buildDesignBrief(url, options = {}) {
  const {
    vision = true,
    crops = true,
    fonts = true,
    fetchImpl = fetch,
    model = "",
    businessName = "",
    ...captureOptions
  } = options;

  const started = Date.now();
  const evidence = await captureDesignEvidence(url, { ...captureOptions, browser: options.browser });
  if (!evidence.ok) return { ok: false, reason: evidence.reason, url: String(url || "") };

  try {
    let brief = briefFromMeasurement(evidence, { businessName });

    // A servable stylesheet for the families we measured. Optional, non-fatal:
    // a font we cannot serve is still a font we can name honestly.
    if (fonts) {
      brief = await attachFontHref(brief, evidence, fetchImpl);
    } else {
      brief.provenance.fontHref = { source: "absent", confidence: 0, note: "font lookup disabled" };
    }

    let visionMeta = { attempted: false };
    if (vision) {
      const prompt = buildVisionPrompt(brief);
      const result = await callVisionModel({ prompt, shots: evidence.shots, fetchImpl, model });
      visionMeta = {
        attempted: true,
        ok: !!result.ok,
        provider: result.provider || "",
        model: result.model || "",
        reason: result.reason || "",
        // Measured from the provider's own usage block. Null when the provider
        // did not report it, or when the model is not in MODEL_PRICES — an
        // operator budgeting a 767-prospect sweep needs the real number or an
        // honest blank, not a plausible-looking guess.
        usage: result.usage || null,
        ms: result.ms || null,
      };
      if (result.ok) {
        brief = applyVision(brief, result.parsed, { visibleText: (evidence.measured && evidence.measured.visibleText) || [] });
      } else {
        brief.refusals.push({ field: "vision", reason: "vision_pass_unavailable", detail: result.reason || "" });
      }
    }
    brief.vision = visionMeta;
    brief.durationMs = Date.now() - started;

    if (crops && evidence._page && brief.loudElements.length) {
      const buffers = await captureLoudCrops(evidence._page, brief.loudElements);
      brief.loudElements = brief.loudElements.map((el, i) => (buffers[i] ? { ...el, cropImage: buffers[i] } : el));
    }

    return { ok: true, brief, evidence };
  } finally {
    if (evidence._closePage) await evidence._closePage();
  }
}

module.exports = {
  BRIEF_VERSION,
  TEXT_CONTRAST_TARGET,
  SEEN_CONFIDENCE_CEILING,
  CLAIM_KINDS,
  CLAIM_WORDS,

  // cost accounting
  MODEL_PRICES,
  priceVision,
  readUsage,

  // the pipeline
  buildDesignBrief,
  captureDesignEvidence,
  briefFromMeasurement,
  applyVision,
  captureLoudCrops,
  callVisionModel,
  buildVisionPrompt,
  attachFontHref,
  verifyFontHref,

  // the three recorded faults, and the slogan the wiring reads
  ACCENT_MIN_CHROMA,
  accentFloorReason,
  deriveHeroSlogan,
  foldShoutCase,
  OFFER_WORDS,

  // pure helpers, exported for tests and for callers that must re-check
  measureInPage,
  resolveAccentColours,
  rankAccentCandidates,
  rootTokenCandidates,
  mergeAccentCandidates,
  parseDeclaredColor,
  surfaceShares,
  ROOT_ACCENT_TOKENS,
  rankLoudCandidates,
  rankImageCandidates,
  rankTally,
  chooseFonts,
  chooseLogo,
  looksThirdParty,
  decideSurface,
  dominantPixelColor,
  modeOfSurface,
  hoverOf,
  nearlySame,
  chromaWeight,
  normalizeForMatch,
  extractJsonObject,
  settlePage,
};
