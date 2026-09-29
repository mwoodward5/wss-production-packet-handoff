"use strict";

/**
 * lib/logo-palette.js — the client's palette, read from their OWN LOGO.
 *
 * OWNER DIRECTIVE (standing, restated 2026-08-05 on the RiverCity mirror):
 * "the palette MUST come from the logo's colors" — and, bluntly, "the orange
 * should not be orange, it should be teal."
 *
 * He was right, and the proof was in the file: RiverCity's logo.svg contains
 * exactly two colours, #094463 (deep blue) and #1B7D9F (teal). The accent the
 * upstream harvester reported was #E67E22 — an orange that appears NOWHERE in
 * their logo; it was lifted from a call-to-action button on their page. A
 * colour that is merely *present* on a site is not the brand. The mark is.
 *
 * So: when a client ships a real logo, its colours outrank any scraped
 * palette. Neutrals (white/black/grey) are skipped — they are the paper the
 * mark is printed on, not the identity. The most saturated colour becomes the
 * ACCENT (what a customer recognises); the darkest chromatic colour becomes
 * the PRIMARY (the surface family).
 */

const NEUTRAL_CHROMA = 0.035;

function normalizeHex(value) {
  const raw = String(value || "").trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#?([0-9a-f]{6})$/i.exec(raw);
  return long ? `#${long[1].toUpperCase()}` : "";
}

/** sRGB hex -> OKLCH {l 0-1, c, h deg}. */
function oklchOf(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  const int = parseInt(h.slice(1), 16);
  const lin = [(int >> 16) & 255, (int >> 8) & 255, int & 255]
    .map((v) => v / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = lin;
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/**
 * Every colour literal an SVG declares, in document order.
 * Covers fill/stroke/stop-color attributes, style="" properties and <style>
 * blocks, plus the handful of named colours a hand-drawn mark actually uses.
 */
const NAMED = Object.freeze({
  black: "#000000", white: "#FFFFFF", red: "#FF0000", blue: "#0000FF",
  green: "#008000", navy: "#000080", teal: "#008080", gold: "#FFD700",
  orange: "#FFA500", gray: "#808080", grey: "#808080", silver: "#C0C0C0",
});

function svgColors(text) {
  const src = String(text || "");
  const out = [];
  for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) out.push(normalizeHex(m[0]));
  for (const m of src.matchAll(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
    const hex = "#" + [m[1], m[2], m[3]]
      .map((v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, "0")).join("");
    out.push(normalizeHex(hex));
  }
  for (const m of src.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*"?\s*([a-z]+)\b/gi)) {
    const named = NAMED[String(m[1]).toLowerCase()];
    if (named) out.push(named);
  }
  return out.filter(Boolean);
}

/**
 * paletteFromLogoSvg(svgText) -> { accent, primary, colors } | null
 *
 * accent  = the most saturated chromatic colour (what a customer recognises)
 * primary = the darkest chromatic colour (the surface family)
 * Neutrals are skipped. A logo with no chromatic colour returns null so the
 * caller falls back rather than shipping a grey "brand".
 */
function paletteFromLogoSvg(svgText) {
  const seen = new Map();
  for (const hex of svgColors(svgText)) {
    if (seen.has(hex)) continue;
    const ok = oklchOf(hex);
    if (ok) seen.set(hex, ok);
  }
  const chromatic = [...seen.entries()].filter(([, ok]) => ok.c >= NEUTRAL_CHROMA);
  if (!chromatic.length) return null;

  const accent = chromatic.slice().sort((a, b) => b[1].c - a[1].c)[0][0];
  const primary = chromatic.slice().sort((a, b) => a[1].l - b[1].l)[0][0];
  return { accent, primary, colors: [...seen.keys()] };
}

/**
 * paletteFromLogo({ bytes, contentType, url }) -> palette | null
 *
 * SVG is parsed directly — it declares its colours as text, which is exact.
 * Raster marks are left to the engine's existing pixel-ranking measureAccent;
 * this module never guesses at bytes it cannot read.
 */
function paletteFromLogo({ bytes, contentType = "", url = "" } = {}) {
  const isSvg = /svg/i.test(contentType) || /\.svg(\?|$)/i.test(String(url));
  if (!isSvg || !bytes) return null;
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  return paletteFromLogoSvg(text);
}

module.exports = { paletteFromLogo, paletteFromLogoSvg, svgColors, oklchOf, normalizeHex, NEUTRAL_CHROMA };
