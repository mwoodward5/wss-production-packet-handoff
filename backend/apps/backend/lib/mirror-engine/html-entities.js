"use strict";
/**
 * HTML ENTITY DECODER — the scrape boundary's one and only decode.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Flint Plumbing shipped three service cards reading
 *
 *     "Hydrostatic Tests &#038; Tunneling Repair"
 *
 * with the entity VISIBLE as literal text. Nothing was double-encoded by us.
 * The chain was:
 *
 *   1. flintplumb.com is WordPress. WordPress writes a bare ampersand in
 *      post/nav titles as the NUMERIC reference `&#038;`, not `&amp;`.
 *   2. The scraper's ad-hoc label cleaner knew exactly two entities —
 *        .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&")
 *      — and no numeric ones. `&#038;` matched neither, so the seven raw
 *      characters `& # 0 3 8 ;` were STORED as part of the service name.
 *   3. The renderer then did its job correctly: esc() escaped the stored `&`
 *      to `&amp;`, emitting `&amp;#038;` into the HTML.
 *   4. The browser decoded that once and painted `&#038;`.
 *
 * So the defect was never at the render side — escaping there is what keeps
 * the mirror safe. The defect was a scrape that stopped decoding halfway.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * Decode ONCE, at the boundary where scraped bytes become stored facts.
 * Storage holds real characters; the renderer escapes them. Exactly one
 * decode and exactly one escape, and the two cancel.
 *
 * ONE PASS IS LOAD-BEARING, NOT AN OPTIMIZATION. String.replace with a
 * global regex scans left to right and never re-reads what it just wrote, so:
 *
 *     "&#038;"                -> "&"                  (the Flint case)
 *     "&amp;#038;"            -> "&#038;"             (stays inert text)
 *     "&amp;lt;script&amp;gt;"-> "&lt;script&gt;"     (stays inert text)
 *     "&lt;script&gt;"        -> "<script>"           (real chars, then esc()'d)
 *
 * A LOOPED "decode until stable" would turn the third line into a live
 * <script> tag that the author never wrote. That is the XSS path, and it is
 * why this module has no loop. An unknown entity is left verbatim: we do not
 * guess at text the business did not write.
 *
 * Carries no client data; reusable across every client.
 */

/**
 * Named references. Case-sensitive per the HTML spec (`&Eacute;` is É, not é),
 * with the legacy all-caps forms that real pages emit listed explicitly.
 * Unlisted names decode to nothing — the source text survives untouched.
 */
const NAMED = Object.freeze({
  // structural
  amp: "&", AMP: "&",
  lt: "<", LT: "<",
  gt: ">", GT: ">",
  quot: '"', QUOT: '"',
  apos: "'",
  // spaces
  nbsp: " ", NBSP: " ",
  ensp: " ", emsp: " ", thinsp: " ", hairsp: " ",
  zwnj: "‌", zwj: "‍", shy: "­",
  // punctuation a trades site actually uses
  ndash: "–", mdash: "—", horbar: "―",
  lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„",
  hellip: "…", bull: "•", middot: "·", dagger: "†",
  prime: "′", Prime: "″",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  // symbols
  copy: "©", COPY: "©",
  reg: "®", REG: "®",
  trade: "™",
  deg: "°", plusmn: "±", times: "×", divide: "÷",
  minus: "−", frac12: "½", frac14: "¼", frac34: "¾",
  sup2: "²", sup3: "³", micro: "µ", para: "¶", sect: "§",
  // currency
  cent: "¢", pound: "£", yen: "¥", euro: "€", curren: "¤",
  // accented Latin that shows up in owner and street names
  aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À",
  acirc: "â", Acirc: "Â", auml: "ä", Auml: "Ä",
  aring: "å", Aring: "Å", atilde: "ã", Atilde: "Ã",
  aelig: "æ", AElig: "Æ", ccedil: "ç", Ccedil: "Ç",
  eacute: "é", Eacute: "É", egrave: "è", Egrave: "È",
  ecirc: "ê", Ecirc: "Ê", euml: "ë", Euml: "Ë",
  iacute: "í", Iacute: "Í", igrave: "ì", Igrave: "Ì",
  icirc: "î", Icirc: "Î", iuml: "ï", Iuml: "Ï",
  ntilde: "ñ", Ntilde: "Ñ",
  oacute: "ó", Oacute: "Ó", ograve: "ò", Ograve: "Ò",
  ocirc: "ô", Ocirc: "Ô", ouml: "ö", Ouml: "Ö",
  otilde: "õ", Otilde: "Õ", oslash: "ø", Oslash: "Ø",
  uacute: "ú", Uacute: "Ú", ugrave: "ù", Ugrave: "Ù",
  ucirc: "û", Ucirc: "Û", uuml: "ü", Uuml: "Ü",
  yacute: "ý", Yacute: "Ý", yuml: "ÿ", szlig: "ß",
  // arrows occasionally used as bullets
  rarr: "→", larr: "←", harr: "↔",
});

/**
 * HTML5's numeric-reference remap. Legacy CMS output means `&#146;` when it
 * says `&#146;` — a Windows-1252 right single quote — not the C1 control at
 * U+0092. Decoding it literally puts an invisible control character inside a
 * service name; a control character in a service name is a defect that no gate
 * can see and every screen reader can.
 */
const WIN1252 = Object.freeze({
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ",
  0x9e: "ž", 0x9f: "Ÿ",
});

/**
 * Semicolon REQUIRED. Browsers also decode the bare legacy forms (`&amp`,
 * `&nbsp`), but so would a URL query string — "?a=1&copy=2" would silently
 * become "?a=1©=2". Real WordPress/Wix/Squarespace output always terminates
 * the reference, so requiring the semicolon costs nothing and removes an
 * entire class of false decode.
 */
const ENTITY_RE = /&(#\d{1,8}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/** Map a numeric code point to the character HTML says it means, or null. */
function charFromCodePoint(cp) {
  if (!Number.isInteger(cp) || cp < 0) return null;
  if (cp === 0) return "�";
  if (cp > 0x10ffff) return null;                       // not a code point
  if (cp >= 0xd800 && cp <= 0xdfff) return "�";    // lone surrogate
  if (Object.prototype.hasOwnProperty.call(WIN1252, cp)) return WIN1252[cp];
  // Control characters are not text. Tab/LF/FF/CR survive; the rest are dropped
  // rather than smuggled into a stored fact.
  if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0c && cp !== 0x0d) return "";
  if (cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return null;
  }
}

/**
 * Decode HTML character references in `input` EXACTLY ONCE.
 * Unknown or malformed references are returned verbatim.
 * @param {*} input
 * @returns {string}
 */
function decodeEntitiesOnce(input) {
  if (input == null) return "";
  const str = typeof input === "string" ? input : String(input);
  if (str.indexOf("&") === -1) return str;
  return str.replace(ENTITY_RE, (match, body) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body[1] === "x" || body[1] === "X";
      const cp = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      const ch = charFromCodePoint(cp);
      return ch === null ? match : ch;
    }
    const named = NAMED[body];
    // hasOwnProperty guard: "constructor", "toString" and friends are valid
    // entity-shaped names and must not resolve to Object.prototype members.
    return Object.prototype.hasOwnProperty.call(NAMED, body) && typeof named === "string" ? named : match;
  });
}

/**
 * Decode every string inside a scraped structure, once, returning a copy.
 * Object KEYS are left alone — a key is a field name we chose, not scraped copy.
 *
 * The guard tracks ANCESTORS only, not everything visited: a JSON-LD graph
 * routinely reaches the same node down two different branches, and a
 * visited-set would return that node undecoded the second time — a silent
 * half-decode, which is the exact bug this module exists to kill. Ancestors
 * still stop a true cycle, and depth is bounded besides.
 */
function decodeEntitiesDeep(value, depth = 0, ancestors = new Set()) {
  if (depth > 12) return value;
  if (typeof value === "string") return decodeEntitiesOnce(value);
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) return value;
  ancestors.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.map((v) => decodeEntitiesDeep(v, depth + 1, ancestors));
  } else {
    out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeEntitiesDeep(v, depth + 1, ancestors);
  }
  ancestors.delete(value);
  return out;
}

/**
 * Does `text` still contain a literal character reference a reader would SEE?
 * Used as a render-time tripwire: after decode-at-scrape and escape-at-render,
 * a visible `&#038;` or `&amp;` in the rendered innerText means some path
 * skipped the boundary, and the build must fail rather than ship it.
 * @returns {string[]} up to 8 distinct offending literals, in page order.
 */
function residualEntities(text) {
  const found = [];
  const seen = new Set();
  for (const m of String(text || "").matchAll(ENTITY_RE)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    found.push(m[0]);
    if (found.length >= 8) break;
  }
  return found;
}

module.exports = { decodeEntitiesOnce, decodeEntitiesDeep, residualEntities, ENTITY_RE, NAMED };
