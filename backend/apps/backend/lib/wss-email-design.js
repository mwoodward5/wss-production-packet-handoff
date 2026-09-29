"use strict";

// lib/wss-email-design.js — the ONE place the WSS email look is defined.
//
// WHY THIS FILE EXISTS
// The owner's verdict on the shipped proof email was that it "reads flat, like a
// PDF report, not a sleek product email". It did, and the reason was structural
// rather than a matter of taste: every renderer invented its own palette and its
// own type sizes inline, so nothing had a hierarchy. The Flint proof email ran
// on a cream/teal palette of its own invention (#f4f3ee / #86d0c4 / #12201c) and
// set almost all of its copy between 12.5px and 15px — six type roles, one size.
// The outreach shell did the same thing with a different set of numbers.
//
// So the palette here is NOT invented. It is read from
// packages/wss-brand-system, which is already a dependency of this app and is
// the cross-product design handoff (tokens.css, email-tokens.json,
// typography.json, assets). If the brand moves, these emails move with it.
//
// THREE RULES THIS MODULE ENFORCES, none of which are decoration:
//
//   1. GMAIL, NOT A BROWSER. Gmail's HTML sanitizer drops <style> blocks,
//      position, flexbox, and grid. The old templates leaned on
//      `position:absolute` to hang an icon beside a line of text — in Gmail that
//      declaration is deleted and the icon falls back into the text flow behind a
//      24px indent. Everything here is tables and inline styles, and an icon
//      beside text is a two-cell row, not a positioned span.
//
//   2. THE DESIGN LOCK IS PART OF THE PALETTE. The brand system ships
//      accentAlt #8B5CF6, and test/design-lock-contract.test.js forbids that hex
//      (with B65CFF and FF7B9C) in rendered email output. Rather than leave that
//      as a trap for the next person who reaches for the brand file, the
//      forbidden hexes are named here and `clientAccent()` refuses to emit one
//      even if a client's own measured logo colour happens to land on it.
//
//   3. A CLIENT COLOUR IS NOT AUTOMATICALLY A LEGIBLE COLOUR. The accent in an
//      outreach email is measured from the client's own logo bytes
//      (lib/mirror-engine/brand-assets.js measureAccent), which is what makes
//      each email feel built for them. But a measured colour is whatever the
//      logo happens to be: pale yellow as a button background under white text
//      is unreadable, and near-black as an eyebrow on a near-black panel is
//      invisible. `clientAccent()` therefore returns a FAMILY — the colour as
//      measured, plus the darkened/lightened variants that clear a WCAG contrast
//      threshold against the surface each one is actually used on. The hue is
//      always the client's; only the lightness is adjusted, and only as far as
//      legibility requires.

const brand = require("../../../packages/wss-brand-system");

/**
 * The OFFICIAL brand-kit mark (owner-supplied kit, 2026-08-02), rasterized from
 * assets/wss-mark.svg at 176px for retina 88px rendering, served first-party
 * from this backend's own public/ tree on ghost.wss-ai.com. The previous URL
 * was wss-ai.com's apple-touch-icon — a favicon standing in for a logo, and
 * the visible half of the owner's "lousy font, not our branding" verdict.
 */
const WSS_MARK_URL = "https://ghost.wss-ai.com/brand/wss-mark-176.png";

/**
 * Hanken Grotesk is the brand face. No mail client will load a webfont, so the
 * stack is the brand face first and the brand's own declared fallback after it —
 * the email degrades to the system UI face rather than to Times.
 */
const FONT_STACK = `'${brand.typography.ui}',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const FONT_MONO = `'${brand.typography.mono}','SFMono-Regular',Consolas,Menlo,monospace`;

/**
 * Hexes that may never appear in rendered email output. Two of them are the
 * retired product's purples and one is its pink; `8B5CF6` is also the brand
 * system's accentAlt, which is why this list lives next to the palette that
 * exposes it rather than only inside a test.
 */
const FORBIDDEN_HEX = Object.freeze(["8B5CF6", "B65CFF", "FF7B9C"]);

/**
 * The email surface, straight from packages/wss-brand-system/email-tokens.json,
 * plus the few structural tones an email needs that a token file does not carry
 * (a hairline, a card shelf, a dark panel). accentAlt is deliberately NOT
 * re-exported — see rule 2 above.
 */
const PALETTE = Object.freeze({
  page: brand.emailTokens.background,   // #F7F7FA
  panel: brand.emailTokens.panel,       // #FFFFFF
  ink: brand.emailTokens.ink,           // #16151B
  muted: brand.emailTokens.muted,       // #5F5E68
  accent: brand.emailTokens.accent,     // #4A6CF7
  success: brand.emailTokens.success,   // #0E6B52
  danger: brand.emailTokens.danger,     // #C94C4C
  // Structural tones. `line` is emailTokens.line resolved to an opaque hex,
  // because rgba() in a border shorthand is unreliable across mail clients.
  line: "#E4E3E9",
  shelf: "#D8D7E0",                     // the 3px bottom edge that gives a card depth
  subtle: "#F2F2F6",                    // an inset row inside a light card
  inkPanel: "#16151B",                  // dark card background
  inkPanelLine: "#2C2B34",
  inkPanelInk: "#F4F4F7",
  inkPanelMuted: "#A5A4B0",
});

// --------------------------------------------------------------------- colour

function normalizeHex(value) {
  const raw = String(value == null ? "" : value).trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(raw);
  return long ? `#${long[1].toUpperCase()}` : "";
}

function toRgb(hex) {
  const h = normalizeHex(hex) || "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function toHex([r, g, b]) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** WCAG relative luminance. */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hexes, 1 (identical) .. 21 (black/white). */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear mix of two colours. `amount` 0 -> all `from`, 1 -> all `to`. */
function mix(from, to, amount) {
  const a = toRgb(from);
  const b = toRgb(to);
  const t = Math.max(0, Math.min(1, amount));
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t));
}

/** Whichever of white / brand-ink is more readable on `background`. */
function readableOn(background) {
  return contrast(background, "#FFFFFF") >= contrast(background, PALETTE.ink) ? "#FFFFFF" : PALETTE.ink;
}

/**
 * Step `hex` toward `toward` until it clears `ratio` against `surface`, keeping
 * the hue and moving only the lightness. Returns the closest step that clears;
 * if nothing does (a mid-grey against a mid-grey), returns the final step, which
 * is the most legible option available rather than a colour from another brand.
 */
function shiftUntilReadable(hex, surface, toward, ratio) {
  let candidate = normalizeHex(hex) || PALETTE.accent;
  if (contrast(candidate, surface) >= ratio) return candidate;
  for (let step = 1; step <= 20; step++) {
    candidate = mix(normalizeHex(hex) || PALETTE.accent, toward, step / 20);
    if (contrast(candidate, surface) >= ratio) return candidate;
  }
  return candidate;
}

function isForbidden(hex) {
  const h = normalizeHex(hex);
  return Boolean(h) && FORBIDDEN_HEX.includes(h.slice(1));
}

/**
 * The accent family for one client.
 *
 * `measured` is the accent measured from THAT CLIENT'S OWN logo bytes. Absent,
 * unparseable, or design-lock-forbidden falls back to the WSS brand accent —
 * never to a random hue, and never to a colour that would fail the lock.
 *
 * Returned fields, each named for the surface it is legible on:
 *   base       the colour as measured — used only where contrast does not matter
 *              (a 3px rule, a chip fill behind dark text)
 *   onLight    text/eyebrow on the white panel   (>= 4.5:1 vs #FFFFFF)
 *   onDark     text/eyebrow on the ink panel     (>= 4.5:1 vs #16151B)
 *   buttonBg   a button fill that a label can sit on
 *   buttonFg   that label's colour, chosen for buttonBg
 *   tint       a very light wash of the client's hue, for card backgrounds
 *   tintLine   the border that goes with `tint`
 *   measured   true when this really is the client's colour, false on fallback
 */
function clientAccent(measured) {
  const normalized = normalizeHex(measured);
  const usable = normalized && !isForbidden(normalized) ? normalized : "";
  const base = usable || PALETTE.accent;
  const buttonBg = contrast(base, "#FFFFFF") >= 4.5 || contrast(base, PALETTE.ink) >= 7
    ? base
    : shiftUntilReadable(base, "#FFFFFF", PALETTE.ink, 4.5);
  return Object.freeze({
    base,
    onLight: shiftUntilReadable(base, "#FFFFFF", PALETTE.ink, 4.5),
    onDark: shiftUntilReadable(base, PALETTE.inkPanel, "#FFFFFF", 4.5),
    buttonBg,
    buttonFg: readableOn(buttonBg),
    // A WASH, NOT A FILL. At 92% the tint of a red logo read as a pink error
    // panel rather than a branded one, and this value has to be safe for EVERY
    // hue a logo can be, not just the blues it was first tried on. 96% keeps the
    // client's hue identifiable while staying a surface a black paragraph sits
    // on comfortably.
    tint: mix(base, "#FFFFFF", 0.96),
    tintLine: mix(base, "#FFFFFF", 0.8),
    measured: Boolean(usable),
  });
}

// ----------------------------------------------------------------- typography

/**
 * The type scale. SIX ROLES WITH SIX DISTINCT SIZES — that is the whole fix for
 * "reads flat". The old templates ran display copy at 26px and then set
 * everything else between 12.5px and 15px, so a headline, a section title, a
 * body paragraph and a footnote all landed in the same visual band and the eye
 * had nothing to climb. 30 / 21 / 16.5 / 15 / 13 / 11 is a real ladder.
 *
 * Sizes are fixed px, not the brand file's clamp() values: Gmail does not
 * support clamp(), and a dropped font-size falls back to 16px medium, which
 * would flatten the hierarchy in exactly the place it matters most.
 */
const TYPE = Object.freeze({
  display: `font-family:${FONT_STACK};font-size:30px;line-height:1.18;font-weight:800;letter-spacing:-.02em;color:${PALETTE.ink}`,
  title: `font-family:${FONT_STACK};font-size:21px;line-height:1.26;font-weight:800;letter-spacing:-.01em;color:${PALETTE.ink}`,
  subtitle: `font-family:${FONT_STACK};font-size:16px;line-height:1.35;font-weight:800;color:${PALETTE.ink}`,
  lead: `font-family:${FONT_STACK};font-size:16.5px;line-height:1.6;font-weight:400;color:${PALETTE.ink}`,
  body: `font-family:${FONT_STACK};font-size:15px;line-height:1.65;font-weight:400;color:${PALETTE.muted}`,
  small: `font-family:${FONT_STACK};font-size:13px;line-height:1.55;font-weight:400;color:${PALETTE.muted}`,
  caption: `font-family:${FONT_STACK};font-size:12px;line-height:1.5;font-weight:400;color:${PALETTE.muted}`,
  eyebrow: `font-family:${FONT_STACK};font-size:11px;line-height:1.4;font-weight:800;letter-spacing:.14em;text-transform:uppercase`,
  mono: `font-family:${FONT_MONO};font-size:11.5px;line-height:1.7`,
});

// ------------------------------------------------------------------- surfaces

/**
 * Depth without box-shadow. Gmail strips box-shadow, so a "raised" card here is
 * a hairline box whose bottom edge is 3px of a darker tone — the shelf reads as
 * a shadow in every client, including the ones that would have dropped a real
 * one, and it costs nothing when images are off.
 */
function cardStyle({ background = PALETTE.panel, line = PALETTE.line, shelf = PALETTE.shelf, radius = 14 } = {}) {
  return `background:${background};border:1px solid ${line};border-bottom:3px solid ${shelf};border-radius:${radius}px`;
}

/** An eyebrow line: the small letterspaced label that titles a section. */
function eyebrow(text, color) {
  return `<p style="margin:0 0 10px;${TYPE.eyebrow};color:${color}">${text}</p>`;
}

/**
 * An icon beside a line of text, as a two-cell table row.
 *
 * NOT a positioned span. `position:absolute` — what both templates used for
 * every one of these rows — is on Gmail's drop list, so in the client that
 * actually matters the glyph fell into the text flow while the 24px indent it
 * was supposed to clear stayed behind.
 */
function iconRow({ icon, html, color = PALETTE.muted, size = "15px", pad = "5px 0" }) {
  return `<tr>
        <td width="26" valign="top" style="padding:${pad};font-family:${FONT_STACK};font-size:${size};line-height:1.5;width:26px">${icon}</td>
        <td valign="top" style="padding:${pad};font-family:${FONT_STACK};font-size:13.5px;line-height:1.5;color:${color}">${html}</td>
      </tr>`;
}

module.exports = {
  FONT_MONO,
  FONT_STACK,
  FORBIDDEN_HEX,
  PALETTE,
  TYPE,
  WSS_MARK_URL,
  cardStyle,
  clientAccent,
  contrast,
  eyebrow,
  iconRow,
  luminance,
  mix,
  normalizeHex,
  readableOn,
};
