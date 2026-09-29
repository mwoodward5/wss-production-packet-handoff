"use strict";

/**
 * lib/mirror-engine/area-fence.js — a donor may not name a town.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * wss-test-monolith-tattoo-co-nashville is a Nashville tattoo studio. On
 * 2026-08-11 its live structured data said, verbatim:
 *
 *   "areaServed": [
 *     {"@type":"City","name":"Nashville"},
 *     {"@type":"City","name":"Nashville"},
 *     {"@type":"City","name":"Downtown Nashville"},
 *     {"@type":"City","name":"South Congress"},
 *     {"@type":"City","name":"Cedar Park"},
 *     {"@type":"City","name":"Round Rock"},
 *     {"@type":"City","name":"Pflugerville"}
 *   ]
 *
 * South Congress, Cedar Park, Round Rock and Pflugerville are AUSTIN, TEXAS —
 * 850 miles away. They are literals baked into donors-clean/tattoo-aurelia's own
 * index.html: the sanitiser tokenised the donor's city to {{CITY}} and left the
 * four suburbs alone, so hydration rewrote the first three entries and the
 * donor's own market survived in the tail.
 *
 * WHY EVERY EXISTING GATE PASSED IT, AND WHY THAT WAS CORRECT
 * ---------------------------------------------------------------------------
 *   · token_scan          — no tokens left; they are literal words.
 *   · identity_scan       — the donor's identity atoms are its NAME, phone and
 *                           domain. donor_city is deliberately blank in that
 *                           manifest (declaring "Austin" would hard-fail any
 *                           legitimate Austin prospect on a substring scan).
 *   · place_names_plausible — "Round Rock" is a perfectly plausible town. It IS
 *                           a town. It is simply not this client's.
 *   · donor_leak_zero     — nothing here belongs to a named third party.
 *
 * Every one of them asks "is this string wrong?". None of them can, because the
 * string is right — about somebody else. The only question with an answer is
 * WHOSE TOWN IS THIS, and that is a question about provenance, not text.
 *
 * THE RULE
 * ---------------------------------------------------------------------------
 * A published service area must be traceable to THIS client's own truth:
 *
 *   · the NAP locality              (facts.city)
 *   · the market they assert        (facts.service_area, their own site's word)
 *   · areas they published          (content.areas — harvested from their site)
 *   · towns we MEASURED around them (content.nearby — lib/mirror-engine/
 *                                    nearby-cities, Census-resolved from their
 *                                    own verified coordinates, carrying real
 *                                    distances)
 *   · their state, by name or code  (a legitimate coarse areaServed)
 *
 * Anything else in an `areaServed` field is, by construction, a place THIS
 * BUILD never put there — which makes it the donor's. It is removed.
 *
 * WHY AN ALLOWLIST RATHER THAN A DISTANCE TEST. The owner's instruction is
 * "areas must be near the business's own coordinates", and the honest way to
 * enforce that here is to fence to the set we already measured against those
 * coordinates. A geocode-at-build-time test would need a network call per name,
 * would fail SOFT (leaking on any timeout), and could not judge a neighbourhood
 * like "South Congress" that no gazetteer returns as a city. The allowlist is
 * deterministic, offline, and fails CLOSED: an unrecognised name is dropped, not
 * kept. content.nearby is where the distance rule actually lives, and it is
 * enforced there too — see MAX_NEARBY_MILES.
 *
 * WHY IT SCRUBS RATHER THAN REFUSES. Exactly the favicon precedent: purge the
 * donor's value, write ours, then MEASURE the tree instead of trusting the
 * purge. A build is only failed when a removed name survives in text a visitor
 * can read, because that is a leak this pass could not reach.
 */

const trim = (v) => String(v == null ? "" : v).trim();
const fold = (v) => trim(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A measured neighbouring town beyond this is not "near" in any sense a
 * customer means. nearby-cities probes at 8/14/21 km, so nothing legitimate
 * comes back past ~20 miles; the cap exists for a cached list from an older
 * probe, or a future source with a wider ring.
 */
const MAX_NEARBY_MILES = 45;

const US_STATE_NAME = Object.freeze({
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia",
  FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana",
  ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan",
  MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey",
  NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota",
  OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee",
  TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west virginia", WI: "wisconsin", WY: "wyoming", PR: "puerto rico",
});

/**
 * "Nashville, TN" and "Nashville" are the same claim. Reduce an areaServed
 * string to the place it names so the allowlist can be built from towns and
 * still recognise a town wearing its state.
 */
function townPart(value) {
  const raw = trim(value);
  const parts = raw.split(",");
  if (parts.length > 1 && /^\s*[A-Za-z]{2}\.?\s*$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join(",").trim();
  }
  return raw;
}

/**
 * Every name this client's own truth supports, folded for comparison.
 *
 * A neighbourhood inside an allowed town is allowed with it: the donor's
 * "Downtown {{CITY}}" hydrates to "Downtown Nashville", which is the client's
 * own city with a direction on the front and is not a leak. That is handled by
 * the PREFIX/SUFFIX admission in `isAllowed`, not by adding guesses here.
 */
function clientAreaAllowlist({ facts = {}, content = {} } = {}) {
  const allow = new Set();
  const add = (value) => {
    const town = fold(townPart(value));
    if (town) allow.add(town);
  };

  add(facts.city);
  add(facts.service_area);
  add(facts.county);
  for (const area of Array.isArray(content.areas) ? content.areas : []) add(area);
  for (const n of Array.isArray(content.nearby) ? content.nearby : []) {
    const miles = Number(n && n.miles);
    // The distance rule, where the distance actually exists. A cached or
    // future-sourced town beyond the ring is not admitted just for being in the
    // list — the whole point is that it is near.
    if (Number.isFinite(miles) && miles > MAX_NEARBY_MILES) continue;
    add(n && n.name);
  }

  const state = trim(facts.state).toUpperCase();
  if (state.length === 2 && US_STATE_NAME[state]) {
    allow.add(fold(state));
    allow.add(fold(US_STATE_NAME[state]));
  }
  return allow;
}

/**
 * A trailing administrative designator on a county-shaped name. `facts.county`
 * arrives as "Maricopa County"; the same county is written "Maricopa" wherever
 * a name, a handle or a chip has no room for the word "County". Both spellings
 * are the SAME verified place, so both belong in the client's place set.
 *
 * Only a trailing designator is stripped. The bare FIRST WORD of an ordinary
 * two-word town is deliberately NOT seeded: "Queen Creek" must never seed
 * "Queen", and "Paradise Valley" must never seed "Paradise" — those are
 * different places, and admitting them would turn this into the guesswork the
 * allowlist exists to avoid.
 */
const PLACE_DESIGNATOR =
  /\s+(?:county|parish|borough|township|municipality|census area)$/;

/**
 * clientPlaceAtoms({ facts, content }) — every PLACE the client's own verified
 * truth names, folded, for the identity scan (lib/mirror-engine/scan.js).
 *
 * WHY THIS EXISTS, separately from `clientAreaAllowlist`.
 * ---------------------------------------------------------------------------
 * The area fence asks "may this build PUBLISH this town?". The identity scan
 * asks the opposite question: "is this donor atom actually the CLIENT's own
 * town?". concrete-elconstruction is a Tempe, AZ donor, so its manifest
 * declares donor_city "Tempe", donor_county "Maricopa County" and a social atom
 * "Maricopa". A real Tempe prospect's own verified NAP hydrates those exact
 * words into the page, and the scan then reported
 *   {"bucket":"city","token":"Tempe"} / {"bucket":"socials","token":"Maricopa"}
 * — a 500 donor_identity_detected fired on the CLIENT's own truth. That killed
 * live builds.
 *
 * The two sets are kept apart on purpose: seeding "maricopa" into the
 * ALLOWLIST would let the area fence publish a bare "Maricopa" areaServed the
 * client never claimed. Here it only ever REMOVES a false accusation.
 */
function clientPlaceAtoms(input) {
  const atoms = new Set();
  for (const entry of clientAreaAllowlist(input)) {
    if (!entry) continue;
    atoms.add(entry);
    const bare = entry.replace(PLACE_DESIGNATOR, "").trim();
    if (bare && bare !== entry) atoms.add(bare);
  }
  return atoms;
}

/**
 * Does this donor atom name a place the CLIENT has independently verified?
 *
 * EXACT fold-match only — emphatically not the PREFIX/SUFFIX admission
 * `isAllowed` grants. Token overlap here would be a hole, not a convenience:
 * the donor social "g.page/el-construction-tempe" folds to
 * "g page el construction tempe" and CONTAINS the client's own town, yet it is
 * the donor's Google handle and a real leak that must keep failing the build.
 * Whole-value equality is the only test that separates "Tempe" from it.
 */
function isClientPlace(value, atoms) {
  if (!atoms || !atoms.size) return false;
  const folded = fold(townPart(value));
  return Boolean(folded) && atoms.has(folded);
}

/**
 * Is this published area name traceable to the client?
 *
 * Exact match, or the allowed town carrying a qualifier the donor's own
 * template wrote around it ("Downtown Nashville", "Greater Nashville",
 * "Nashville Metro"). A qualifier can only ADD words around a name we already
 * allow — it can never admit a different town.
 */
function isAllowed(name, allow) {
  const folded = fold(townPart(name));
  if (!folded) return false;
  if (allow.has(folded)) return true;
  for (const permitted of allow) {
    if (!permitted) continue;
    if (folded === permitted) return true;
    if (folded.startsWith(`${permitted} `) || folded.endsWith(` ${permitted}`)) return true;
  }
  return false;
}

/**
 * Rewrite one `areaServed` value in place, keeping only allowed entries.
 * Returns `{ value, removed[] }`; `value` is `undefined` when nothing survived,
 * which the caller deletes rather than publishing an empty claim.
 */
function fenceValue(value, allow, removed) {
  const judge = (entry) => {
    if (entry == null) return false;
    if (typeof entry === "string") {
      if (isAllowed(entry, allow)) return true;
      removed.push(trim(entry));
      return false;
    }
    if (typeof entry === "object") {
      // A Place/City node with no name asserts nothing; leave the shape alone.
      if (!trim(entry.name)) return true;
      if (isAllowed(entry.name, allow)) return true;
      removed.push(trim(entry.name));
      return false;
    }
    return true;
  };

  if (Array.isArray(value)) {
    const kept = value.filter(judge);
    return { value: kept.length ? kept : undefined, removed };
  }
  return { value: judge(value) ? value : undefined, removed };
}

/** Walk any JSON-LD shape, fencing every `areaServed` it carries. */
function fenceNode(node, allow, removed) {
  if (Array.isArray(node)) {
    for (const item of node) fenceNode(item, allow, removed);
    return node;
  }
  if (!node || typeof node !== "object") return node;
  for (const [key, value] of Object.entries(node)) {
    if (key === "areaServed") {
      const out = fenceValue(value, allow, removed);
      if (out.value === undefined) delete node.areaServed;
      else node.areaServed = out.value;
      continue;
    }
    fenceNode(value, allow, removed);
  }
  return node;
}

const LD_BLOCK = /(<script[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi;

function isHtml(rel) { return /\.html?$/i.test(rel); }

/** The visible text of a page, near enough for a residue check. */
function visibleText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * fenceAreasServed({ files, facts, content })
 *
 * Mutates `files` in place — the way the rest of engine.js treats the tree —
 * and returns `{ files, report }`.
 *
 * report.removed        every name taken out, with the page it came from
 * report.visible_residue names that are ALSO in text a visitor can read, which
 *                        this pass cannot reach and which must fail the build
 * report.clean          nothing left to remove and nothing visible
 */
function fenceAreasServed({ files = {}, facts = {}, content = {} } = {}) {
  const allow = clientAreaAllowlist({ facts, content });
  const removed = [];
  const unparseable = [];
  let blocks = 0;
  let rewritten = 0;

  for (const [rel, buf] of Object.entries(files)) {
    if (!isHtml(rel)) continue;
    const before = buf.toString("utf8");
    let changed = false;
    const after = before.replace(LD_BLOCK, (whole, open, body, close) => {
      blocks += 1;
      let doc;
      try {
        doc = JSON.parse(body);
      } catch {
        // Never guess at malformed JSON — record it and leave the bytes alone.
        unparseable.push({ page: rel, head: body.slice(0, 80) });
        return whole;
      }
      const taken = [];
      fenceNode(doc, allow, taken);
      if (!taken.length) return whole;
      for (const name of taken) removed.push({ page: rel, name });
      changed = true;
      // `<` escaped for the same reason content-inject escapes it: a name
      // containing "</script" would otherwise terminate the block early.
      return open + JSON.stringify(doc).replace(/</g, "\\u003c") + close;
    });
    if (changed) {
      files[rel] = Buffer.from(after, "utf8");
      rewritten += 1;
    }
  }

  // MEASURE THE TREE, DON'T TRUST THE SCRUB. A name removed from structured
  // data that is ALSO printed in the page's own copy is still on the customer's
  // website; the caller fails the build on it rather than reporting "clean".
  const names = [...new Set(removed.map((r) => r.name))].filter((n) => n.length >= 4);
  const visible = [];
  for (const [rel, buf] of Object.entries(files)) {
    if (!isHtml(rel)) continue;
    const text = visibleText(buf.toString("utf8"));
    for (const name of names) {
      if (text.includes(name)) visible.push({ page: rel, name });
    }
  }

  return {
    files,
    report: {
      allowlist: [...allow].slice(0, 24),
      allowlist_size: allow.size,
      ld_blocks: blocks,
      pages_rewritten: rewritten,
      removed: removed.slice(0, 24),
      removed_count: removed.length,
      unparseable_blocks: unparseable.slice(0, 4),
      visible_residue: visible.slice(0, 8),
      clean: visible.length === 0,
    },
  };
}

module.exports = {
  fenceAreasServed,
  clientAreaAllowlist,
  clientPlaceAtoms,
  isClientPlace,
  isAllowed,
  townPart,
  MAX_NEARBY_MILES,
};
