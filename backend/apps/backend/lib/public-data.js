"use strict";

const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

const STATE_NAMES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

const GENERIC_PLACE_TYPES = new Set([
  "establishment", "point_of_interest", "premise", "subpremise", "street_address", "route", "locality",
  "political", "country", "postal_code", "plus_code", "geocode", "store", "service",
]);

const PLACE_TYPE_LABELS = {
  landscaper: "Landscaping",
  landscape_designer: "Landscape design",
  lawn_care_service: "Lawn care",
  general_contractor: "General contracting",
  masonry_contractor: "Masonry",
  concrete_contractor: "Concrete",
  roofing_contractor: "Roofing",
  electrician: "Electrical services",
  plumber: "Plumbing",
  hvac_contractor: "Heating and cooling",
  painter: "Painting",
  fence_contractor: "Fencing",
  tree_service: "Tree care",
  swimming_pool_contractor: "Pool construction",
  swimming_pool_repair_service: "Pool repair",
  cleaning_service: "Cleaning",
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stateCode(value) {
  const raw = clean(value).replace(/[.,]+$/, "");
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATE_NAMES[raw.toLowerCase()] || "";
}

function splitCityState(value) {
  const raw = clean(value).replace(/,?\s*(?:USA|United States)$/i, "").trim();
  if (!raw) return { city: "", state: "" };
  const codeMatch = raw.match(/^(.*?)(?:,\s*|\s+)([A-Z]{2})$/i);
  if (codeMatch && STATE_CODES.has(codeMatch[2].toUpperCase())) {
    return { city: clean(codeMatch[1]).replace(/,$/, ""), state: codeMatch[2].toUpperCase() };
  }
  const lower = raw.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (lower.endsWith(`, ${name}`) || lower.endsWith(` ${name}`)) {
      return { city: clean(raw.slice(0, raw.length - name.length)).replace(/[ ,]+$/, ""), state: code };
    }
  }
  return { city: raw, state: "" };
}

function locationFromAddress(address) {
  const raw = clean(address).replace(/,?\s*(?:USA|United States)$/i, "");
  const parts = raw.split(",").map(clean).filter(Boolean);
  if (parts.length < 2) return { city: "", state: "" };
  const tail = parts[parts.length - 1].match(/^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i);
  if (!tail || !STATE_CODES.has(tail[1].toUpperCase())) return { city: "", state: "" };
  return { city: parts[parts.length - 2], state: tail[1].toUpperCase() };
}

// A SEARCH PHRASE IS NOT A CITY.
//
// The miner's location can arrive as the thing that was typed into a search box
// ("fence companies Tulsa", "plumbers near me Phoenix"), and normalizeUsLocation
// used to hand that straight through. Live proof: a built mirror read
// "Fencing & Gates in Fence Companies Tulsa, OK" — ten times on one page, on a
// site meant to be shown to that business.
//
// The trade words are stripped from the FRONT of the phrase, which is where a
// search query puts them, leaving the place name behind. Nothing is invented: if
// stripping leaves nothing usable the city comes back EMPTY, and every surface
// that prints a city already collapses when it is absent.
const SEARCH_PHRASE_PREFIX_RE = new RegExp(
  "^(?:"
  + "(?:best|top|local|affordable|cheap|near\\s*me|the|in|near|around)\\s+|"
  + "(?:fence|fencing|deck|decking|concrete|paving|masonry|roof|roofing|plumber|plumbers|plumbing|"
  + "hvac|heating|cooling|air\\s*conditioning|ac|electrician|electricians|electrical|landscaper|"
  + "landscapers|landscaping|lawn|tree|salon|salons|spa|spas|medspa|tattoo|barber|barbers|"
  + "contractor|contractors|builder|builders|remodeler|remodelers|company|companies|service|"
  + "services|repair|installation|shop|shops|studio|studios)\\s+"
  + ")+",
  "i",
);

function stripSearchPhrase(value) {
  const raw = clean(value);
  if (!raw) return "";
  // A TWO-WORD VALUE IS LEFT ALONE. Real places are named "Salon City", "Fence
  // Lake", "Spa Springs" — and stripping the first word there mangles a genuine
  // town. A search phrase that reached this field is longer than that ("fence
  // companies Tulsa", "best hvac companies Houston"), so the rule only applies
  // once there are enough words for the trade prefix to be separable noise.
  if (raw.split(/\s+/).length < 3) return raw;
  const stripped = clean(raw.replace(SEARCH_PHRASE_PREFIX_RE, ""));
  // Nothing survived, or what survived is a lone fragment: refuse rather than
  // print a guess. Absent beats wrong on a customer's own website.
  if (!stripped || stripped.length < 2) return "";
  return stripped;
}

function normalizeUsLocation({ city = "", state = "", address = "", location = "" } = {}) {
  const embedded = splitCityState(city || location);
  const fromAddress = locationFromAddress(address);
  const normalizedState = embedded.state || stateCode(state) || fromAddress.state;
  // The postal address is authoritative; the query string is the fallback, and
  // only after the search-phrase noise is taken off it.
  let normalizedCity = fromAddress.city || stripSearchPhrase(embedded.city);
  if (stateCode(normalizedCity)) normalizedCity = fromAddress.city || "";
  if (normalizedCity && normalizedState) {
    normalizedCity = normalizedCity
      .replace(new RegExp(`(?:,\\s*|\\s+)${normalizedState}$`, "i"), "")
      .replace(/[ ,]+$/, "")
      .trim();
  }
  return { city: normalizedCity, state: normalizedState };
}

function humanServiceName(value) {
  const raw = clean(value);
  if (!raw) return "";
  const token = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (GENERIC_PLACE_TYPES.has(token)) return "";
  if (PLACE_TYPE_LABELS[token]) return PLACE_TYPE_LABELS[token];
  if (raw.includes("_")) {
    return raw
      .split("_")
      .filter(Boolean)
      .map((part, index) => index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part)
      .join(" ");
  }
  return raw;
}

// Directory/profile page titles are not services. The search-stage harvest
// sometimes captures them verbatim ("Business | BBB Business Profile | Better
// Business Bureau"), and one such entry poisons the whole compiled services
// list — the intake compiler refuses it and the candidate dies. Drop the
// obvious directory-title shapes before normalization.
const DIRECTORY_TITLE_NOISE_RE = new RegExp(
  [
    "\\|",
    "bbb business profile",
    "better business bureau",
    "yelp",
    "yellow ?pages",
    "angi(?:\\.com)?",
    "homeadvisor",
    "thumbtack",
    "nextdoor",
    "mapquest",
    "birdeye",
    "chamberofcommerce",
    "facebook",
    "instagram",
    "linkedin",
  ].join("|"),
  "i",
);

function isDirectoryTitleNoise(value) {
  return DIRECTORY_TITLE_NOISE_RE.test(String(value || ""));
}

function publicServiceNames(values = [], fallback = "") {
  const input = (Array.isArray(values) ? values : [values]).filter(
    (value) => !isDirectoryTitleNoise(value),
  );
  const output = [];
  const seen = new Set();
  for (const value of [...input, fallback]) {
    const label = humanServiceName(value);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    output.push(label);
  }
  return output;
}

module.exports = {
  humanServiceName,
  normalizeUsLocation,
  publicServiceNames,
  stateCode,
};
