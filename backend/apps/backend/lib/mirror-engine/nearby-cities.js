"use strict";

/**
 * lib/mirror-engine/nearby-cities.js — the real towns around a business.
 *
 * WHY THIS EXISTS
 * Every mirror is a local business's website, and the single highest-value SEO
 * surface a local business has is the set of towns around it: the people
 * searching "ac repair near me" are in the next town over. The donors ship a
 * coverage block for exactly this, and it rendered empty on every mirror
 * because nothing ever populated it.
 *
 * WHY IT IS NOT JUST A LIST OF NAMES
 * The template this pattern came from shipped ten invented neighbouring towns,
 * and that is the fabrication this pipeline exists to refuse. A town is only
 * usable if something outside our own guesswork says it is there. So the towns
 * are MEASURED: a ring of points is sampled around the business's verified
 * coordinates and each point is resolved to the place that actually contains
 * it, by the US Census Bureau's own geocoder.
 *
 * WHY THE CENSUS
 *   · no API key and no signup — nothing to provision per client, nothing to
 *     leak, and it cannot be switched off by a billing change,
 *   · authoritative — it is the government's own boundary data, not a scrape,
 *   · US-only, which is the entire customer base,
 *   · it returns each place's CENTROID, so the distance we print is a real
 *     distance between two real points rather than the radius we happened to
 *     probe at.
 *
 * Google's Geocoding API would also answer this, and was tried first: the key
 * this system already carries returns REQUEST_DENIED because only the Places
 * API is enabled on the project. The Census needs no such permission.
 *
 * FAIL-SOFT, ALWAYS. Any failure yields an EMPTY list, never a guess. A mirror
 * without nearby towns is a mirror with one less section; a mirror with invented
 * ones is a lie on a customer's website.
 */

const { isPlausiblePlaceName } = require("./place-names");

const EARTH_RADIUS_KM = 6371;

/** Bearings and radii to probe. Eight compass points at three distances gives
 *  24 samples — enough to find the ring of towns around a business without
 *  turning one build into a crawl. */
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const RADII_KM = [8, 14, 21];

/** Census layers, in the order we prefer them. In New England the towns people
 *  actually search ("Stratford", "Fairfield") are County Subdivisions, not
 *  Incorporated Places, and a CDP is a statistical area that often carries a
 *  name no customer would recognise ("Daniels Farm CDP") — so it is last. */
const LAYERS = ["Incorporated Places", "County Subdivisions", "Census Designated Places"];
const LAYER_QUERY = "Incorporated+Places,County+Subdivisions,Census+Designated+Places";

const FIPS_TO_USPS = Object.freeze({
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", 10: "DE",
  11: "DC", 12: "FL", 13: "GA", 15: "HI", 16: "ID", 17: "IL", 18: "IN", 19: "IA", 20: "KS",
  21: "KY", 22: "LA", 23: "ME", 24: "MD", 25: "MA", 26: "MI", 27: "MN", 28: "MS", 29: "MO",
  30: "MT", 31: "NE", 32: "NV", 33: "NH", 34: "NJ", 35: "NM", 36: "NY", 37: "NC", 38: "ND",
  39: "OH", 40: "OK", 41: "OR", 42: "PA", 44: "RI", 45: "SC", 46: "SD", 47: "TN", 48: "TX",
  49: "UT", 50: "VT", 51: "VA", 53: "WA", 54: "WV", 55: "WI", 56: "WY", 72: "PR",
});

/** A point `km` away from (lat,lng) along a compass bearing. */
function offset(lat, lng, km, bearingDeg) {
  const b = (bearingDeg * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const dr = km / EARTH_RADIUS_KM;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI };
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/**
 * "Milford city (balance)" -> "Milford"; "Stratford town" -> "Stratford";
 * "Kansas City city" -> "Kansas City".
 *
 * THE CASE IS THE WHOLE TRICK. This strip used to be case-INSENSITIVE, and the
 * Census's own clean BASENAME "Kansas City" ends in the word "City" — so the
 * regex ate it and a Kansas City plumber's site advertised the nearby towns of
 * "KANSAS, MO" and "NORTH KANSAS, MO". (It cost us twice: the truncated name no
 * longer matched the business's own city either, so the exclusion below missed
 * and the business was listed as a town near itself.)
 *
 * The Census writes the legal descriptor in LOWER CASE and the place's own name
 * in Title Case — "Kansas City city", "Canton charter township", "Stratford
 * town". Matching the descriptor case-SENSITIVELY removes exactly the Census's
 * suffix and never touches a capital-C "City" that belongs to the name.
 */
const DESCRIPTOR_SUFFIX = /\s+(?:charter\s+|metropolitan\s+|urban\s+)?(?:city|town|village|borough|township|municipality|district|plantation|reservation)$/;

/**
 * The legal descriptor a CONSOLIDATED city-county wears.
 *
 * Found by sweeping all 80 live mirrors on 2026-08-11, after the numeric-town
 * fix above: two real businesses were naming a corporation instead of a town.
 *
 *   holt-plumbing-company-nashville  ->  "Nashville-Davidson metropolitan government, TN"
 *   maxwells-plumbing-and-drain-evans -> "Augusta-Richmond County consolidated government, GA"
 *
 * This is the SAME class as "9, LA" and it is invisible to the plausibility
 * predicate — deliberately, because the string has letters and the place is
 * real. What is wrong is only the trailing legal words, which are the same kind
 * of Census descriptor as "city" and "township" and are stripped the same way.
 * Anchored to the end and matched against the Census's lower-case convention,
 * so it can never reach inside a name like "Government Camp, OR".
 */
const CONSOLIDATED_GOVERNMENT_SUFFIX = /\s+(?:metropolitan|consolidated|unified|metro)\s+government$/;

/**
 * A merged city-county's legal name carries the county it swallowed:
 *
 *   "Nashville-Davidson metropolitan government (balance)"
 *   "Augusta-Richmond County consolidated government (balance)"
 *   "Louisville/Jefferson County metro government (balance)"
 *
 * Stripping only the trailing legal words leaves "Nashville-Davidson" and
 * "Augusta-Richmond County", which is still the corporation's name and not the
 * city anybody names. The city is the part before the join, every time — the
 * merger is written CITY-COUNTY or CITY/COUNTY by construction, which is why
 * this can be taken rather than guessed.
 *
 * It fires ONLY on a record already identified as a consolidated government, so
 * "Winston-Salem" and "Wilkes-Barre" — ordinary hyphenated towns — never reach
 * it. If the split leaves nothing readable the record is refused instead.
 */
function consolidatedCityName(name) {
  const first = String(name || "").split(/[-/]/)[0].trim();
  return first;
}

function cleanPlaceName(raw, basename) {
  // BASENAME is usually already clean, but not always — the Census "balance of
  // city" records carry the suffix in both fields, which is how "Milford city
  // (balance)" reached a rendered page. Strip either source the same way.
  const source = String(basename || "").trim() || String(raw || "");
  const debalanced = source.replace(/\s*\(balance\)\s*$/i, "");
  if (CONSOLIDATED_GOVERNMENT_SUFFIX.test(debalanced)) {
    return consolidatedCityName(debalanced.replace(CONSOLIDATED_GOVERNMENT_SUFFIX, ""));
  }
  return debalanced
    .replace(DESCRIPTOR_SUFFIX, "")
    // CDP/CCD are the two descriptors the Census writes in CAPITALS.
    .replace(/\s+(?:CDP|CCD)$/, "")
    .trim();
}

/**
 * The Census's legal descriptor for a record — the part of NAME that BASENAME
 * does not contain. "Kansas City city" -> "city"; "Canton charter township" ->
 * "charter township"; "Beaverton-Hillsboro CCD" -> "ccd"; "District 9" ->
 * "district"; "Ward 3" -> "ward".
 *
 * We read it rather than the LSADC number because it is self-describing: the
 * next person to touch this file can see what was refused and why.
 *
 * IT READS BOTH ENDS, AND THAT IS THE WHOLE OF THE "9, LA" BUG.
 * ---------------------------------------------------------------------------
 * This function used to read the SUFFIX only — `name.startsWith(base)`, tail
 * after the base. Every refusal rule below it (STATISTICAL_ONLY, the township
 * rule) hangs off its answer, so all of them silently no-opped on any record
 * where the Census writes the descriptor FIRST.
 *
 * Louisiana does. Probed live around the client's own verified coordinates
 * (30.3889, -91.0529) on 2026-08-11, the County Subdivisions layer answers:
 *
 *     NAME "District 9"   BASENAME "9"    descriptor ""  -> kept, named "9"
 *     NAME "District 4"   BASENAME "4"    descriptor ""  -> kept, named "4"
 *     NAME "District 13"  BASENAME "13"   descriptor ""  -> kept, named "13"
 *
 * "District 9" does not START with "9", so the old check returned "" — an empty
 * descriptor is in no refusal set, so the record sailed through — and
 * cleanPlaceName() then PREFERRED the BASENAME, which is the bare number. That
 * is how four integers were published as the towns a Baton Rouge HVAC company
 * serves. No distance was read as a name; no index leaked. The Census record
 * genuinely is called "9", and nothing here was looking.
 *
 * Mississippi ("Beat 3"), Georgia ("Militia District 1465") and Kentucky
 * ("Magisterial District 2") are the same shape and were the same defect.
 */
function placeDescriptor(hit) {
  const name = String((hit && hit.NAME) || "").trim();
  const base = String((hit && hit.BASENAME) || "").trim().replace(/\s*\(balance\)\s*$/i, "");
  if (!base) return "";
  const clean = name.replace(/\s*\(balance\)\s*$/i, "").trim();
  const lower = clean.toLowerCase();
  const baseLower = base.toLowerCase();
  if (lower === baseLower) return "";
  if (lower.startsWith(baseLower)) return clean.slice(base.length).trim().toLowerCase();
  if (lower.endsWith(baseLower)) return clean.slice(0, clean.length - base.length).trim().toLowerCase();
  return "";
}

/**
 * A CCD (Census County Division) is a grid the Census DRAWS across counties
 * that have no real subdivisions. Its name is a cartographer's label, not a
 * town: probing around Portland offered "Beaverton-Hillsboro, OR" and
 * "Northwest Clackamas, OR" as neighbouring towns. Nobody has ever said they
 * live in either. Same for unorganized territory.
 */
const STATISTICAL_ONLY = new Set([
  "ccd", "unorganized territory", "unorganized region",
  // ADMINISTRATIVE DIVISIONS, written by the Census with the descriptor FIRST.
  // "District 9", "Ward 3", "Beat 5", "Precinct 2", "Militia District 1465" —
  // these are how a parish or county divides itself up for voting and policing.
  // Their "name" is an integer. Nobody has ever told a neighbour they live in
  // District 9, and no customer searching "ac repair near me" is in one.
  //
  // They are refused as a CLASS rather than as a shape, so the refusal survives
  // a state that numbers them differently, and so the log says what was skipped
  // instead of leaving a hole. The bare-number guard below is the belt to this
  // brace: this list can never be complete, and it does not have to be.
  "district", "ward", "beat", "precinct", "election district", "voting district",
  "election precinct", "assembly district", "magisterial district",
  "militia district", "police jury district", "supervisor district",
  "commissioner district", "justice precinct", "county district",
]);

/**
 * THE CLASS, READ FROM THE FIELD THAT CARRIES IT.
 * ---------------------------------------------------------------------------
 * LSADC is the Census's own Legal/Statistical Area Description code. It is the
 * evidence the descriptor text is only a rendering of, and it is the ONLY thing
 * that can refuse "Chicago, NE" and "Jefferson, NE" — two Nebraska voting
 * precincts named after a city and a president — without a name rule that would
 * also refuse Manhattan KS, Cleveland TN, Miami OK and Denver PA.
 *
 * Every code below was read off a live probe at a defective mirror's own
 * coordinates on 2026-08-11, not from a specification:
 *
 *   00  consolidated / metropolitan government (balance)   Nashville, Augusta
 *   22  CCD, a grid the Census draws                       Augusta CCD, Evans CCD
 *   28  numbered district                                  "District 9"  (TN, LA)
 *   29  precinct                                           "Richland VIII precinct" (NE)
 *   45  numbered civil township                            "Township 11, Long Creek" (NC)
 *
 * 00 is the one that is NOT simply skipped: a merged city-county is a real
 * place under a corporate name, so cleanPlaceName() recovers the city from it
 * (Nashville-Davidson -> Nashville) and the result is judged like any other
 * name. The rest have no city inside them to recover.
 */
const CORPORATE_OR_STATISTICAL_LSADC = new Set(["22", "28", "29", "45"]);

/**
 * The same administrative label, arriving with no BASENAME to measure it
 * against — so placeDescriptor has nothing to subtract and answers "". The
 * label is then the whole name, and "District 9, LA" is no more a town than
 * "9, LA" was. Refused on its shape, since there is nothing else to read.
 *
 * The shape rules now live in lib/mirror-engine/place-names, so the render and
 * the gate refuse the same strings this source does — see the second-sweep
 * block there. isPlausiblePlaceName() below asks all of them.
 */

/**
 * Where a TOWNSHIP is a place people put in their address.
 *
 * In these states a township is a general-purpose municipal government and its
 * name is how residents name their home — "Cherry Hill, NJ", "Canton, MI",
 * "Upper Darby, PA". Everywhere else a township is a six-mile survey square
 * whose name is a county-map artifact, and printing it as a nearby town is the
 * "Delaware, KS" defect: probes around Kansas City resolved to "Delaware
 * township" and Indianapolis to "Sugar Creek township" and "Guilford township".
 *
 * The Census's own FUNCSTAT flag cannot make this call — it marks the survey
 * township "McCamish township, KS" ACTIVE, exactly like Cherry Hill — so the
 * distinction has to be stated here.
 */
const TOWNSHIP_MUNICIPALITY_STATES = new Set(["MI", "MN", "NJ", "PA", "WI"]);

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * nearbyCities({ lat, lng, excludeCity, count }) ->
 *   [{ name, state, miles, km, lat, lng, source }]
 *
 * Sorted nearest-first, the business's own town excluded, deduped by name.
 */
async function nearbyCities({
  lat,
  lng,
  excludeCity = "",
  count = 5,
  fetchImpl = global.fetch,
  timeoutMs = 12000,
} = {}) {
  const oLat = Number(lat);
  const oLng = Number(lng);
  if (!Number.isFinite(oLat) || !Number.isFinite(oLng)) return [];
  if (typeof fetchImpl !== "function") return [];

  const probes = [];
  for (const km of RADII_KM) for (const b of BEARINGS) probes.push(offset(oLat, oLng, km, b));

  async function resolve(point) {
    const url = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
      + `?x=${point.lng.toFixed(6)}&y=${point.lat.toFixed(6)}`
      + `&benchmark=Public_AR_Current&vintage=Current_Current&layers=${LAYER_QUERY}&format=json`;
    let json;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res || res.ok !== true) return null;
      json = await res.json();
    } catch {
      return null;
    }
    const geos = (json && json.result && json.result.geographies) || {};
    for (const layer of LAYERS) {
      const hit = (geos[layer] || [])[0];
      if (!hit || !hit.NAME) continue;
      // The Census answers "not defined" for water and unorganised territory.
      if (/not\s+defined/i.test(hit.NAME)) continue;

      // OMIT RATHER THAN PRINT SOMETHING WRONG. Everything below is a record
      // the Census can resolve but a customer would not recognise as a town.
      // Falling through to the next layer (or to no answer at all) costs one
      // entry in a coverage list; printing it costs the owner the call.
      const descriptor = placeDescriptor(hit);
      if (STATISTICAL_ONLY.has(descriptor)) continue;
      // THE CLASS BEFORE THE NAME. A code cannot be talked out of by a name
      // that reads well, which is the entire reason "Chicago, NE" survived
      // every text rule this file has.
      const lsadc = String(hit.LSADC == null ? "" : hit.LSADC).trim();
      if (CORPORATE_OR_STATISTICAL_LSADC.has(lsadc)) continue;
      const state = FIPS_TO_USPS[String(hit.STATE)] || "";
      if (!state) continue; // "Springfield, " is not a town anybody can drive to.
      if (/township$/.test(descriptor) && !TOWNSHIP_MUNICIPALITY_STATES.has(state)) continue;

      // THE LAST WORD, AND IT IS UNCONDITIONAL.
      //
      // Everything above refuses a record for what it IS — a survey township, a
      // cartographer's grid, a voting district. This refuses a record for what
      // it would PRINT, and it needs to know nothing about the Census to do it:
      // a place name with no letters in it is not a place name, in any state,
      // under any layer, from any future source of towns.
      //
      // It is deliberately redundant with the descriptor list above. That list
      // is a set of names somebody had to think of; this is the rule that holds
      // when they did not — which is the exact way "9, LA" reached a customer's
      // website with every gate green.
      const name = cleanPlaceName(hit.NAME, hit.BASENAME);
      if (!isPlausiblePlaceName(name)) continue;
      const cLat = Number(hit.CENTLAT);
      const cLng = Number(hit.CENTLON);
      return {
        name,
        state,
        lat: Number.isFinite(cLat) ? cLat : point.lat,
        lng: Number.isFinite(cLng) ? cLng : point.lng,
      };
    }
    return null;
  }

  const resolved = await Promise.all(probes.map(resolve));

  const skip = norm(excludeCity);
  const byName = new Map();
  for (const place of resolved) {
    if (!place) continue;
    const key = norm(place.name);
    if (!key || key === skip) continue;
    // Distance to the town's own centre, not to the point we happened to probe.
    const km = haversineKm(oLat, oLng, place.lat, place.lng);
    const existing = byName.get(key);
    if (!existing || km < existing.km) {
      byName.set(key, { ...place, km, miles: Math.max(1, Math.round(km * 0.621371)), source: "us_census_geocoder" });
    }
  }

  return [...byName.values()]
    .sort((a, b) => a.km - b.km)
    .slice(0, Math.max(0, count))
    .map((c) => ({ ...c, km: Math.round(c.km * 10) / 10 }));
}

module.exports = { nearbyCities, offset, haversineKm, cleanPlaceName, placeDescriptor };
