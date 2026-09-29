"use strict";

/**
 * lib/mirror-engine/place-names.js — is this string the name of a place?
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * On 2026-08-11 a live HVAC mirror published this, to a real Louisiana company,
 * under an email that says "here is your new website":
 *
 *     Driving directions from nearby towns
 *       St. George, LA        2 mi
 *       9, LA                 4 mi
 *       4, LA                 7 mi
 *       13, LA                8 mi
 *       Denham Springs, LA    8 mi
 *       5, LA                 8 mi
 *
 * Four numbers, printed as the towns a business serves. Measured, reproduced
 * and traced — the mechanism is written down in nearby-cities.js where it was
 * introduced, and it is NOT the obvious one (no distance was read as a name and
 * no index leaked). It was a real Census record whose name genuinely is a
 * number.
 *
 * WHAT THIS MODULE IS FOR
 * ---------------------------------------------------------------------------
 * The specific bug has a specific fix at its source. This is the thing that
 * makes the CLASS of bug unpublishable: one predicate, asked in three places —
 * where towns are produced, where they are rendered, and at the gate that
 * decides whether a build may be shown to its owner. A future source of place
 * names (a new geocoder, an intake packet, an operator typing into a form)
 * inherits the answer without anybody remembering to ask.
 *
 * THE BAR IS DELIBERATELY LOW, AND IT IS ASYMMETRIC.
 * ---------------------------------------------------------------------------
 * This does not decide whether a town EXISTS — it cannot, and pretending to
 * would start rejecting real towns nobody on this team has heard of. It decides
 * one much narrower thing: could a human being possibly write this as the name
 * of somewhere they live?
 *
 * The two errors are not equal, so the rules are not symmetric:
 *   · dropping a real town costs one line in a coverage list nobody counts;
 *   · printing "13, LA" costs the owner their belief that we know what we are
 *     doing, and it is the first thing they see.
 * Every rule below therefore rejects only what is UNARGUABLE — a string with no
 * letters in it is not a town in any language, in any state, ever. Anything
 * merely unusual ("29 Palms", "Coeur d'Alene", "Truth or Consequences",
 * "Ninety Six") passes, because unusual is what real places are.
 */

/** USPS two-letter codes. A lone state code is a fragment, not a town. */
const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "PR", "VI", "GU", "AS", "MP",
]);

/** Full state names, by USPS code — the other half of the pair above. */
const STATE_NAMES = new Map([
  ["AL", "alabama"], ["AK", "alaska"], ["AZ", "arizona"], ["AR", "arkansas"],
  ["CA", "california"], ["CO", "colorado"], ["CT", "connecticut"], ["DE", "delaware"],
  ["DC", "district of columbia"], ["FL", "florida"], ["GA", "georgia"], ["HI", "hawaii"],
  ["ID", "idaho"], ["IL", "illinois"], ["IN", "indiana"], ["IA", "iowa"],
  ["KS", "kansas"], ["KY", "kentucky"], ["LA", "louisiana"], ["ME", "maine"],
  ["MD", "maryland"], ["MA", "massachusetts"], ["MI", "michigan"], ["MN", "minnesota"],
  ["MS", "mississippi"], ["MO", "missouri"], ["MT", "montana"], ["NE", "nebraska"],
  ["NV", "nevada"], ["NH", "new hampshire"], ["NJ", "new jersey"], ["NM", "new mexico"],
  ["NY", "new york"], ["NC", "north carolina"], ["ND", "north dakota"], ["OH", "ohio"],
  ["OK", "oklahoma"], ["OR", "oregon"], ["PA", "pennsylvania"], ["RI", "rhode island"],
  ["SC", "south carolina"], ["SD", "south dakota"], ["TN", "tennessee"], ["TX", "texas"],
  ["UT", "utah"], ["VT", "vermont"], ["VA", "virginia"], ["WA", "washington"],
  ["WV", "west virginia"], ["WI", "wisconsin"], ["WY", "wyoming"], ["PR", "puerto rico"],
  ["VI", "virgin islands"], ["GU", "guam"], ["AS", "american samoa"], ["MP", "northern mariana islands"],
]);

/**
 * isStatewideClaim(name, stateCode) — is this "city" actually the whole state
 * the business already sits in?
 *
 * WHY THIS IS SAFE WHERE THE GENERAL RULE IS NOT. The note above is explicit
 * that refusing a town merely because it shares a state's name is UNWRITABLE:
 * Nevada MO, Delaware OH, California PA, Indiana PA and Houston MO are real
 * incorporated towns, and eating them would be real damage. This predicate does
 * not do that. It fires ONLY when the name is the full name — or the USPS code
 * — of the SAME state the business is in, which is not a town at all but a
 * statewide claim. Nevada, MO stays a town; "Nevada" for a business in NV does
 * not.
 *
 * MEASURED, 2026-08-11: The Chill Brothers (Spring, TX) self-publish
 * schema.org areaServed "Texas". The lane took it as the marketing city, which
 * drives the title and the hero headline, and shipped
 *
 *     "The Chill Brothers | HVAC Contractor in Texas, TX | AC & Heating"
 *     "The Chill Brothers. HVAC in Texas, TX."
 *
 * The provenance was honest — they really did publish it — but a state name in
 * the city slot renders as a stutter no local business would ever write, on the
 * single line a prospect reads first.
 */
function isStatewideClaim(name, stateCode) {
  const n = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const code = String(stateCode || "").trim().toUpperCase();
  if (!n || !code || !STATE_NAMES.has(code)) return false;
  return n === STATE_NAMES.get(code) || n === code.toLowerCase();
}

/**
 * Administrative areas that can truthfully appear in schema.org `areaServed`
 * but can never truthfully fill a CITY token. Kept deliberately shape-based:
 * "Texas" is refused for a Texas NAP, while Texas, MD remains a possible town.
 */
const COUNTRY_CLAIMS = new Set([
  "america", "north america", "u s", "u s a", "us", "usa", "united states", "united states america",
  "united states of america",
]);
const ADMIN_AREA_CLAIM = /\b(?:county|parish|borough|census area|planning region|region|metro(?:politan)? area|market area|service area|district|province|territory)\s*$/i;
const REGIONAL_CLAIM = /^(?:greater|central|northern|southern|eastern|western|north|south|east|west)\s+.+\b(?:area|region|metro|metropolitan area|county|parish|state)$/i;

const marketToken = (value) => String(value == null ? "" : value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function administrativeMarketReason(value, stateCode) {
  const raw = trim(value);
  const key = marketToken(raw);
  if (!raw) return "empty";
  if (COUNTRY_CLAIMS.has(key)) return "country_claim_is_not_a_city";
  if (isStatewideClaim(raw, stateCode)) return "statewide_claim_is_not_a_city";
  if (ADMIN_AREA_CLAIM.test(raw) || REGIONAL_CLAIM.test(raw)) return "administrative_area_is_not_a_city";
  return "";
}

/**
 * Decide the one city permitted on marketing surfaces.
 *
 * - `napCity` is the independently verified postal locality and is always the
 *   fallback.
 * - `assertedCity` is the business's first-party service-area assertion.
 * - `queryCity`, when supplied, is the market the miner actually searched.
 *
 * A divergent assertion is usable only when it is a real city-shaped value,
 * its state is coherent, and it matches the mining city when that city is
 * known. The function never promotes the query into a fact; it only uses the
 * query to check an assertion the business already made.
 */
function eligibleMarketCity(input = {}) {
  const assertedRaw = trim(input.assertedCity ?? input.serviceArea ?? input.marketCity ?? input.candidate);
  const napRaw = trim(input.napCity ?? input.city ?? input.fallbackCity);
  const queryRaw = trim(input.queryCity ?? input.miningCity ?? input.queriedCity);
  const napState = trim(input.napState ?? input.state).toUpperCase();
  const queryState = trim(input.queryState ?? input.miningState).toUpperCase();
  const businessName = trim(input.businessName);
  const assertedStates = [
    ...(Array.isArray(input.assertedStates) ? input.assertedStates : []),
    input.assertedState,
    input.marketState,
  ].map((value) => trim(value).toUpperCase()).filter(Boolean);

  const napCity = salvagePlaceName(napRaw, { businessName: "" });
  const fallback = administrativeMarketReason(napCity, napState) ? "" : napCity;
  const refused = (reason, asserted = assertedRaw) => ({
    ok: Boolean(fallback),
    eligible: false,
    city: fallback,
    marketCity: fallback,
    service_area: "",
    fallback_city: fallback,
    asserted: trim(asserted),
    reason,
  });

  if (!assertedRaw) return refused("no_asserted_market_city", "");
  if (!fallback) return refused("no_verified_nap_city_to_diverge_from");

  const asserted = salvagePlaceName(assertedRaw, { businessName });
  if (!asserted) return refused(implausibleReason(assertedRaw) || "asserted_market_is_not_a_city");
  const adminReason = administrativeMarketReason(asserted, napState);
  if (adminReason) return refused(adminReason, asserted);

  const assertedStateOk = !assertedStates.length
    || assertedStates.includes(napState)
    || (queryState && assertedStates.includes(queryState));
  if (!assertedStateOk) return refused("asserted_state_disagrees_with_verified_state", asserted);

  if (marketToken(asserted) === marketToken(fallback)) {
    if (input.retainEquivalentAssertion === true) {
      return {
        ok: true,
        eligible: true,
        city: fallback,
        marketCity: fallback,
        service_area: fallback,
        fallback_city: fallback,
        asserted,
        reason: "assertion_normalized_to_nap_city",
      };
    }
    return refused("same_as_nap_city", asserted);
  }

  if (queryRaw) {
    const query = salvagePlaceName(queryRaw, { businessName: "" });
    if (!query || administrativeMarketReason(query, queryState || napState)) {
      return refused("mining_query_city_is_not_eligible", asserted);
    }
    if (marketToken(asserted) !== marketToken(query)) {
      return refused("asserted_market_disagrees_with_mining_query", asserted);
    }
  }

  return {
    ok: true,
    eligible: true,
    city: asserted,
    marketCity: asserted,
    service_area: asserted,
    fallback_city: fallback,
    asserted,
    reason: queryRaw ? "asserted_market_matches_mining_query" : "self_published_market_city",
  };
}

/**
 * Strings that are the ABSENCE of a name wearing a name's clothes. Matched
 * whole, case-insensitively, so a real town is never caught by a substring:
 * "Nowhere" is a real place in Oklahoma, "None" is not a place anywhere.
 */
const PLACEHOLDER_NAMES = new Set([
  "city", "cities", "town", "towns", "village", "state", "county", "parish",
  "area", "areas", "region", "location", "locations", "address",
  "city name", "cityname", "your city", "our city", "city here", "enter city",
  "name", "place", "placeholder", "example", "sample", "test", "tbd", "todo",
  "n/a", "na", "none", "null", "nil", "undefined", "nan", "unknown", "unnamed",
  "not defined", "not found", "no data", "lorem", "lorem ipsum", "xxx", "tba",
]);

/**
 * Template syntax, in every flavour this codebase has ever shipped. A mirror
 * that renders its own tokens has already failed token_scan; this is here so
 * that a token which reached a place-name FIELD is refused even in the one
 * render path where the scan cannot see it.
 */
const TEMPLATE_CHARS = /[{}<>[\]|\\^~`]|%%|\$\{|\$[A-Z_]{2,}/;

/**
 * THE SECOND SWEEP, 2026-08-11: THE SAME DEFECT WEARING WORDS.
 * ---------------------------------------------------------------------------
 * The numeric rule above cleared "9, LA". Sweeping the fleet again found five
 * more live mirrors naming things that have letters in them, pass every rule
 * above, and are still not towns:
 *
 *   city-air-experts (Charlotte)  "12, Paw Creek"  "3, Steele Creek"  "11, Long Creek"
 *   eyman-plumbing   (La Vista)   "Richland VIII"  "Gilmore II"  "Platford-Springfield I"
 *   titanium-hvac    (Omaha)      "Papillion Second II"
 *   holt-plumbing    (Nashville)  "Nashville-Davidson metropolitan government"
 *   maxwells-plumbing(Evans)      "Augusta-Richmond County consolidated government"
 *
 * Probed live at each client's own coordinates, the Census answers, verbatim:
 *
 *   NAME "Township 11, Long Creek"                    BASENAME "11, Long Creek"     LSADC 45
 *   NAME "Richland VIII precinct"                     BASENAME "Richland VIII"      LSADC 29
 *   NAME "Papillion Second II precinct"               BASENAME "Papillion Second II" LSADC 29
 *   NAME "Nashville-Davidson metropolitan government (balance)"                     LSADC 00
 *   NAME "Augusta-Richmond County consolidated government (balance)"                LSADC 00
 *
 * Voting precincts, numbered civil townships and merged city-county
 * CORPORATIONS. Nobody has ever told a neighbour they live in Richland VIII.
 *
 * WHERE THE REFUSAL BELONGS, AND WHY IT IS SPLIT.
 * ---------------------------------------------------------------------------
 * The Census carries the CLASS in a field — LSADC — and lib/mirror-engine/
 * nearby-cities refuses on that, because a code is evidence and a name is a
 * guess. But the render and the gate never see the Census record: they see a
 * string. So the rules below are the name-shape fallback, and each one is
 * written so that it CANNOT eat a legitimate town:
 *
 *   · no US place name ends in the word "government";
 *   · no US place name begins with a bare integer and a comma;
 *   · no US place name ends in a standalone Roman numeral;
 *   · no US place name is an administrative label followed by a number.
 *
 * WHAT IS DELIBERATELY *NOT* HERE. The sweep also found "Chicago, NE" and
 * "Jefferson, NE" on the Omaha mirror. It is tempting to refuse a town whose
 * name is a US state or a far-off major city. That rule is UNWRITABLE at this
 * seam and would do real damage: Nevada MO, Delaware OH, California PA,
 * Wyoming MI, Indiana PA, Manhattan KS, Cleveland TN, Miami OK, Denver PA,
 * Memphis TX and Houston MO are all real, incorporated, and exactly the kind of
 * neighbouring town this rail exists to name. Chicago and Jefferson in Nebraska
 * are refused where the evidence is — they are LSADC 29 voting precincts, and
 * nearby-cities reads that code.
 */

/**
 * A merged city-county is a CORPORATION with a legal name, not a place with a
 * name. Anchored to the end, so "Government Camp, OR" — a real Oregon town —
 * is untouched, and so is anything that merely contains the word.
 */
const GOVERNMENT_ENTITY = /\bgovernment\s*(?:\(balance\))?$/i;

/**
 * "12, Paw Creek". The Census writes NC's civil townships "Township 12, Paw
 * Creek" and hands back the BASENAME with the descriptor already removed, which
 * leaves the number leading a real place name. The COMMA is the whole
 * discriminator and it is why this cannot eat "29 Palms" or "100 Mile House":
 * a town name may start with a number, but never with a number and a comma.
 */
const NUMBER_COMMA_PREFIX = /^\d+\s*,/;

/**
 * "Richland VIII", "Gilmore II", "Platford-Springfield I", "Papillion Second
 * II" — Nebraska's precincts, numbered in Roman.
 *
 * Strict Roman only (so "MIL" and "CIVIC" are not numerals), UPPERCASE only (so
 * "Coeur d'Alene" and any lower-case word are untouched), and only as a
 * standalone final token. The one collision worth naming is with USPS state
 * codes that are also valid numerals — DC, MD, MI, VI — so a trailing state
 * code is exempted below and "Washington DC" survives.
 */
const ROMAN_TAIL = /(?:^|\s)(M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))$/;

/**
 * "District 9", "Ward 3", "Beat 5", "Precinct 2", "Township 11, Long Creek" —
 * how a county divides itself for voting and policing, arriving with its label
 * still attached. This lived in nearby-cities, where only the Census could be
 * refused by it; it belongs here, where the render and the gate can ask too.
 *
 * The NUMBER is required, which is what keeps every real town safe: Ward AR,
 * Ward CO and Ward SC are towns; "Ward 3" is a ballot.
 */
const NUMBERED_ADMIN_NAME = /^(?:district|ward|beat|precinct|division|subdivision|township|zone|tract|voting district|election district|militia district|magisterial district)\s+\d+[a-z]?(?:\s*,.*)?$/i;

const trim = (v) => String(v == null ? "" : v).trim();

/**
 * The reason a string is not a usable place name, or "" when it is one.
 *
 * Returning the REASON rather than a boolean is the whole point: when a town is
 * dropped, the operator log, the gate's evidence and the test failure all say
 * WHY, and nobody has to re-derive it from a silent absence. That is the
 * difference between this and the filters that let "9, LA" through.
 */
function implausibleReason(value) {
  const raw = trim(value);
  if (!raw) return "empty";

  // A name nobody could read is not a name. 64 is far past the longest US place
  // name ("Winchester-on-the-Severn" is 24) and well short of a sentence, which
  // is what a mis-parsed paragraph arrives as.
  if (raw.length > 64) return "too_long";

  if (TEMPLATE_CHARS.test(raw)) return "template_token";

  // A URL is a link that lost its label, not somewhere to drive to.
  if (/^https?:/i.test(raw) || raw.includes("://") || /^www\./i.test(raw)) return "url";

  // THE RULE THAT WOULD HAVE CAUGHT THIS ONE. "9", "13", "70809", "2-A", "1/2"
  // — a place name has letters in it. Unicode-aware, so accented and
  // non-Latin names are judged by having letters rather than by being ASCII.
  const letters = raw.match(/\p{L}/gu) || [];
  if (!letters.length) return "no_letters";

  // One stray letter among digits is a map key or a lot number ("9A", "2B"),
  // not a town. Real one-letter-word places ("Y, AK") still carry that letter
  // inside a longer string with no digits, which the digit test below admits.
  if (letters.length < 2 && /\d/.test(raw)) return "no_letters";

  const folded = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_NAMES.has(folded)) return "placeholder";

  // A lone state code is the tail of a "City, ST" pair that lost its city.
  // Two letters and nothing else — "LA", "L.A." — so that real three-letter
  // towns ("Ada", "Ely", "Ojo") and every "La Porte"/"Mo Springs" are untouched.
  const bare = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (bare.length === 2 && STATE_CODES.has(bare) && raw.length <= 4) return "state_code_only";

  // ---- THE SECOND SWEEP: things with letters that are still not towns -------
  if (GOVERNMENT_ENTITY.test(raw)) return "government_entity";
  if (NUMBER_COMMA_PREFIX.test(raw)) return "numbered_division";
  if (NUMBERED_ADMIN_NAME.test(raw)) return "numbered_division";

  const roman = ROMAN_TAIL.exec(raw);
  // A trailing state code that happens to be a valid numeral (DC, MD, MI, VI)
  // is a state code. Judged on the ORIGINAL casing, so only the Census's own
  // upper-case numerals are read as numerals.
  if (roman && roman[1] && !STATE_CODES.has(roman[1])) return "roman_numeral_division";

  return "";
}

/** Could a human write this as the name of somewhere they live? */
function isPlausiblePlaceName(value) {
  return implausibleReason(value) === "";
}

/* -------------------------------------------------------------------------
 * SALVAGING A TOWN FROM A HEADLINE — "a service string is not a town".
 *
 * marketCity() prefers the asserted service area over the NAP city on every
 * marketing surface, so whatever is stored there IS what the owner reads on
 * their own mirror. Measured on the live fleet 2026-08-11, three rows carry a
 * market that is not a place:
 *
 *   cooper-perry-plumbing-tulsa   "Plumbing Repairs Tulsa"
 *   draper-fence-and-rail-co      "Fence Company Westfield"
 *   galli-plumbing-services-tulsa "Galli Plumbing Services service area"
 *
 * Cooper Perry's mirror published "Plumbing in Plumbing Repairs Tulsa" as its
 * <title> and its H1.
 *
 * verified-facts.js already salvages this AT THE POINT OF CAPTURE. That was not
 * enough, for exactly the reason the address fix was not enough: these values
 * are FROZEN on the prospect record and handed to the build without ever
 * passing the resolver again. So the rule lives here, where the render and the
 * gate can ask it too, and facts.js asks it at the one boundary every build
 * crosses.
 *
 * REMOVAL ONLY, and it can never invent a town. Strip the business's own name,
 * strip a leading sentence or trade word, strip a trailing "service area". If
 * what remains still reads as a place, that is the market the publisher meant
 * ("Plumbers Spokane" -> Spokane, which is the ORIGINAL Flint Plumbing case
 * working properly). If nothing remains, there is no assertion at all and the
 * caller correctly falls back to the verified NAP city.
 * ---------------------------------------------------------------------- */

/**
 * Sentence lead-ins that get swept in because they are capitalised: "Serving
 * Santa Fe" would otherwise yield the city "Serving Santa Fe". Closed list.
 * "The" is deliberately absent — The Woodlands, TX is a real city.
 */
const PLACE_LEADIN_RE = /^(?:proudly|serving|serves|servicing|located|based|near|from|across|around|throughout|greater|welcome|visit|call|contact|your|our|in|at)\s+/i;

/**
 * The trade is not part of the town's name. Leading only, so it can never reach
 * into the middle of a real name, and removal only, so it can never introduce a
 * word no source wrote. Bare "electric" is deliberately absent — Electric City,
 * WA is a real town — for the same reason "The" is absent above.
 */
const PLACE_TRADE_WORD = "plumbers?|plumbing|hvac|heating|cooling|air ?conditioning|furnace|boiler|"
  + "roofers?|roofing|electricians?|electrical|drains?|sewer|rooter|septic|"
  + "fences?|fencing|landscapers?|landscaping|lawn|tree|concrete|paving|"
  + "painters?|painting|tattoos?|salons?|nails?|spa|medspa|detailing|"
  + "repairs?|services?|solutions?|contractors?|company|emergency|affordable|cheap|best|top|local|"
  + "cleaning|installations?|replacements?|maintenance|remodel(?:ing)?|"
  + "24 ?-? ?7|residential|commercial";
const PLACE_TRADE_LEADIN_RE = new RegExp(`^(?:${PLACE_TRADE_WORD})\\s+`, "i");
const PLACE_TRADE_ONLY_RE = new RegExp(`^(?:${PLACE_TRADE_WORD})$`, "i");

/** "Galli Plumbing Services service area" — the tail that names no place. */
const SERVICE_AREA_TAIL_RE = /\s*\b(?:service\s*areas?|areas?\s*served|coverage\s*areas?)\b\s*$/i;

/**
 * THE BUSINESS'S OWN TRADE SUFFIX, WELDED ONTO THE CITY.
 * ---------------------------------------------------------------------------
 * MEASURED 2026-08-12: Logic Heating & Air (Tulsa, OK) carries a frozen
 * service_area of "Air Tulsa" — the trade suffix of its own name pushed in
 * front of the town. The lane published "HVAC in Air Tulsa, OK" on the h1, the
 * title, the sub-nav ("SERVING AIR TULSA") and the logo lock-up on every page.
 *
 * The existing lead-in strip does not catch it: PLACE_TRADE_WORD carries
 * "air ?conditioning", never bare "air", and the whole-string business check
 * cannot fire while a real town ("Tulsa") still trails the trade word.
 *
 * These are the bare trade nouns that appear as the TAIL of a company name and
 * leak forward. The strip below is gated on the word ALSO being a word of the
 * business's own name, so a town whose name merely starts with one of these
 * (there is no "Air, TX"; but the gate makes even that safe) is never touched,
 * and — unlike a blanket lead-in — a directional a business shares with a real
 * suburb ("North Star HVAC" serving "North Dallas") keeps its "North", because
 * "north" is not in this set.
 */
const TRADE_NOUN_TAIL = new Set([
  "air", "heating", "cooling", "heat", "hvac", "plumbing", "plumbers", "plumber",
  "roofing", "roofers", "roofer", "electric", "electrical", "mechanical",
  "refrigeration", "comfort", "climate", "conditioning", "furnace", "drains",
  "drain", "sewer", "fencing", "landscaping", "concrete", "paving", "painting",
]);

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip the sentence and trade words in front of a captured place name.
 * Stripping to nothing is a real answer, not a failure: "Plumbing Repairs, OK"
 * names a service, and the caller drops the assertion.
 */
function stripPlaceLeadIn(name) {
  let out = String(name == null ? "" : name).trim();
  for (let i = 0; i < 5; i++) {
    let next = out.replace(PLACE_LEADIN_RE, "");
    if (next === out) next = out.replace(PLACE_TRADE_LEADIN_RE, "").trim();
    if (next === out) break;
    out = next;
  }
  if (PLACE_TRADE_ONLY_RE.test(out.trim())) return "";
  return out.trim();
}

/**
 * The town inside a stored market string, or "" when it names none.
 *
 * `businessName` is removed first because a business's own name in its own
 * service-area field carries no locality — and because the fleet's worst case
 * is exactly that ("Galli Plumbing Services service area").
 */
function salvagePlaceName(value, { businessName = "" } = {}) {
  let out = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!out) return "";
  const name = String(businessName || "").trim();
  if (name) out = out.replace(new RegExp(escapeRe(name), "gi"), " ").replace(/\s+/g, " ").trim();
  out = out.replace(SERVICE_AREA_TAIL_RE, "").trim();
  out = stripPlaceLeadIn(out);
  out = out.replace(SERVICE_AREA_TAIL_RE, "").trim();
  if (!out) return "";

  // A LEADING TRADE NOUN FROM THE BUSINESS'S OWN NAME IS NOT PART OF THE TOWN.
  // "Air Tulsa" (Logic Heating & Air) -> "Tulsa". Gated on BOTH the word being
  // in the business name AND being a bare trade noun, and only while a further
  // word remains, so the town itself is never stripped and a directional a
  // business shares with a suburb ("North Dallas") is untouched. See
  // TRADE_NOUN_TAIL for the measured case.
  if (name) {
    const nameWords = new Set(name.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean));
    let words = out.split(/\s+/).filter(Boolean);
    while (words.length > 1) {
      const w = words[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (w && nameWords.has(w) && TRADE_NOUN_TAIL.has(w)) words = words.slice(1);
      else break;
    }
    out = words.join(" ").trim();
    if (!out) return "";
  }

  // NOTHING BUT THE BUSINESS'S OWN NAME IS NOT A PLACE.
  //
  // The exact-string removal above misses whenever the stored name is written
  // differently from the way it appears here — "Galli Plumbing Services service
  // area" against the stored business name "Galli Plumbing Services - Tulsa"
  // leaves "Galli", which reads like a town and is not one. So the survivors
  // are compared WORD BY WORD against the business name: if the phrase says
  // nothing the name did not already say, it asserts no market.
  //
  // When a business really is named after its own town ("Tulsa Plumbing Co"
  // asserting "Tulsa") this drops the assertion and marketCity falls back to
  // the verified NAP city — which is that same town. Same answer, one fewer
  // guess.
  if (name) {
    const nameWords = new Set(name.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean));
    const left = out.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
    if (left.length && left.every((w) => nameWords.has(w))) return "";
  }

  return isPlausiblePlaceName(out) ? out : "";
}

/**
 * Filter a list of place-name strings, or of `{name, ...}` records, down to the
 * ones that may be published — and say what was dropped.
 *
 * Returns `{ kept, dropped }` where `dropped` carries `{ value, reason }`, so a
 * caller can log the refusal instead of silently shortening a list. Callers
 * that only want the survivors read `.kept`.
 */
function filterPlaceNames(list, { key = "name" } = {}) {
  const kept = [];
  const dropped = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const value = entry && typeof entry === "object" ? entry[key] : entry;
    const reason = implausibleReason(value);
    if (reason) dropped.push({ value: trim(value), reason });
    else kept.push(entry);
  }
  return { kept, dropped };
}

module.exports = {
  isPlausiblePlaceName,
  implausibleReason,
  filterPlaceNames,
  salvagePlaceName,
  stripPlaceLeadIn,
  isStatewideClaim,
  administrativeMarketReason,
  eligibleMarketCity,
  STATE_CODES,
  STATE_NAMES,
  PLACEHOLDER_NAMES,
  GOVERNMENT_ENTITY,
  NUMBERED_ADMIN_NAME,
  PLACE_TRADE_WORD,
};
