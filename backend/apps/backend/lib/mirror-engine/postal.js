"use strict";

/**
 * lib/mirror-engine/postal.js — a street address is the STREET.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * On 2026-08-11 wss-test-meyer-heating-and-air-st-louis published this, twice
 * in its structured data and twice in its rendered prose:
 *
 *   "streetAddress": "11134 Lindbergh Business Ct Ste D, St. Louis, MO 63123, USA"
 *   "…the surrounding area, from 11134 Lindbergh Business Ct Ste D, St. Louis,
 *    MO 63123, USA"
 *
 * beside its own `addressLocality: "St. Louis"`, `addressRegion: "MO"` and
 * `postalCode: "63123"`. The city, the state and the ZIP are each printed
 * twice, and the country tail is Google's, not the company's — nobody writes
 * "USA" at the end of their own address on their own website.
 *
 * THE MECHANISM, AND WHY THE EXISTING FIX DID NOT REACH IT
 * ---------------------------------------------------------------------------
 * verified-facts.js already had `displayAddress()`, which strips exactly this
 * country tail — and it is applied ONLY to a value the RESOLVER agreed on
 * (resolveField -> displayAddress). lib/mirror-lane-build.js then picks the
 * address like this:
 *
 *     const value = String(vf[key] || contract[key] || "").trim();
 *
 * When the resolver has no address — no first-party schema.org PostalAddress,
 * one source only, or a withheld conflict — the value falls through to
 * `contract.address`, which is Google Places' `formattedAddress` verbatim. That
 * path has never passed through a normalizer, which is what "the address
 * bypassed the resolver verdict" means. Fixing displayAddress again would not
 * have touched it.
 *
 * SO THE RULE MOVES TO A BOUNDARY EVERY BUILD CROSSES.
 * ---------------------------------------------------------------------------
 * This module owns the question "what belongs in the street line", and it is
 * asked in lib/mirror-engine/facts.js validateFacts() — the semantic validation
 * boundary that runs on EVERY mirror() call, whatever assembled the facts, and
 * before anything mutable happens. verified-facts.displayAddress delegates here
 * too, so the resolver and the publisher can never disagree about the answer.
 *
 * REMOVAL ONLY. Nothing here may introduce a character no source wrote. Every
 * component it drops is one the caller is separately carrying in its own field
 * (city -> addressLocality, state -> addressRegion, postal -> postalCode), so
 * the operation is lossless: the address a letter could reach is unchanged.
 * When a component cannot be matched with confidence it is LEFT ALONE — a
 * slightly redundant address is a cosmetic defect, a truncated one is a wrong
 * address.
 */

const trim = (v) => String(v == null ? "" : v).trim();

/**
 * The country component, as every US geocoder writes it. Anchored to the END,
 * so a real street called "United States Avenue" is untouched.
 */
const COUNTRY_TAIL = /,\s*(?:usa|u\.?s\.?a\.?|us|u\.?s\.?|united\s+states(?:\s+of\s+america)?)\.?\s*$/i;

/** "63123" or "63123-4021". */
const ZIP_TAIL = /,?\s*\b\d{5}(?:-\d{4})?\s*$/;

/** Two-letter USPS code at the end, with or without a preceding comma. */
const STATE_TAIL = /,?\s+([A-Za-z]{2})\.?\s*$/;

/** Compare place names the way a human reads them: case and punctuation blind. */
const foldPlace = (v) => trim(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Drop the country component. Always safe, needs no other field to be supplied,
 * and is the whole of the ", USA" fingerprint.
 */
function dropCountry(address) {
  return trim(address).replace(COUNTRY_TAIL, "").replace(/[\s,]+$/, "").trim();
}

/**
 * streetAddressOnly(address, { city, state, postal })
 *
 * Reduce a formatted address to the part that belongs in `streetAddress`, using
 * ONLY the components the caller is already publishing in their own fields.
 *
 * Peels from the END, one component at a time, and stops at the first thing it
 * cannot confidently identify:
 *
 *   "11134 Lindbergh Business Ct Ste D, St. Louis, MO 63123, USA"
 *      -> drop ", USA"        (country, unconditional)
 *      -> drop " 63123"       (matches the supplied postalCode)
 *      -> drop ", MO"         (matches the supplied addressRegion)
 *      -> drop ", St. Louis"  (matches the supplied addressLocality)
 *      == "11134 Lindbergh Business Ct Ste D"
 *
 * Each peel is conditional on an EXACT match against a supplied field, so an
 * address whose city is written differently from the locality field keeps every
 * word. A result that would be empty, or too short to be a street, is refused
 * and the country-stripped original is returned instead.
 */
function streetAddressOnly(address, { city = "", state = "", postal = "" } = {}) {
  const original = trim(address);
  if (!original) return "";

  let out = dropCountry(original);

  // ZIP — only when it is the ZIP this build is publishing.
  const zip = trim(postal);
  if (zip) {
    const m = ZIP_TAIL.exec(out);
    if (m && trim(m[0]).replace(/^,\s*/, "") === zip) {
      out = out.slice(0, m.index).replace(/[\s,]+$/, "").trim();
    }
  }

  // STATE — only the two-letter code this build is publishing.
  const st = trim(state).toUpperCase();
  if (st.length === 2) {
    const m = STATE_TAIL.exec(out);
    if (m && m[1].toUpperCase() === st) {
      out = out.slice(0, m.index).replace(/[\s,]+$/, "").trim();
    }
  }

  // LOCALITY — only when the trailing comma-separated part IS the locality.
  const town = trim(city);
  if (town) {
    const comma = out.lastIndexOf(",");
    if (comma > 0 && foldPlace(out.slice(comma + 1)) === foldPlace(town)) {
      out = out.slice(0, comma).replace(/[\s,]+$/, "").trim();
    }
  }

  // A STREET LINE STILL HAS TO LOOK LIKE ONE. Length alone is not the test:
  // "Tulsa, OK 74107, USA" peels every component and leaves the bare word
  // "Tulsa", which is five characters and not an address. A street line carries
  // a number (11134, 4809 S 31st) or a thoroughfare word (Main Street). When
  // neither survives the peel went too far, and the safe answer is the address
  // minus its country — redundant, but never wrong.
  return looksLikeStreetLine(out) ? out : dropCountry(original);
}

/** A number or a thoroughfare word — the two things every US street line has. */
const THOROUGHFARE = /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|pl|place|ter|terrace|cir|circle|trail|trl|loop|run|row|walk|pike|plaza|square|sq|suite|ste|unit|apt|floor|fl|box)\b/i;

function looksLikeStreetLine(value) {
  const v = trim(value);
  if (v.length < 4) return false;
  return /\d/.test(v) || THOROUGHFARE.test(v);
}

/**
 * Does this string still carry a country component? The publish-side question,
 * asked by tests and by the scanner rather than by the writer.
 */
function carriesCountryTail(address) {
  return COUNTRY_TAIL.test(trim(address));
}

module.exports = {
  streetAddressOnly, dropCountry, carriesCountryTail, looksLikeStreetLine, COUNTRY_TAIL,
};
