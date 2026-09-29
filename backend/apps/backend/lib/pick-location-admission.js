"use strict";

const { normalizeUsLocation, stateCode } = require("./public-data");

const PICK_LOCATION_MISSING = "pick_location_missing";

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function locationKey(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeLocation(base = {}, next = {}) {
  if (base.conflict || next.conflict) return { ...base, conflict: true };
  let city = clean(base.city);
  let state = stateCode(base.state);
  const nextCity = clean(next.city);
  const nextState = stateCode(next.state);
  if (city && nextCity && locationKey(city) !== locationKey(nextCity)) {
    return { city, state, conflict: true };
  }
  if (state && nextState && state !== nextState) {
    return { city, state, conflict: true };
  }
  city = city || nextCity;
  state = state || nextState;
  return { city, state, conflict: false };
}

function componentText(component = {}, preferShort = false) {
  const candidates = preferShort
    ? [component.shortText, component.short_name, component.longText, component.long_name]
    : [component.longText, component.long_name, component.shortText, component.short_name];
  return candidates.map(clean).find(Boolean) || "";
}

function locationFromAddressComponents(source = {}) {
  const components = Array.isArray(source.addressComponents)
    ? source.addressComponents
    : (Array.isArray(source.address_components) ? source.address_components : []);
  if (!components.length) return { city: "", state: "", conflict: false };
  const hasType = (component, type) => Array.isArray(component?.types)
    && component.types.map((value) => String(value || "").toLowerCase()).includes(type);
  const cityComponent = components.find((component) => hasType(component, "locality"));
  const stateComponent = components.find((component) => hasType(component, "administrative_area_level_1"));
  return {
    city: cityComponent ? componentText(cityComponent) : "",
    state: stateComponent ? stateCode(componentText(stateComponent, true)) : "",
    conflict: false,
  };
}

function directLocation(source = {}) {
  if (!objectOf(source)) return { city: "", state: "", conflict: false };
  const cityText = source.city || source.postal_city || source.locality || "";
  const suppliedState = stateCode(source.state || source.region || source.address_state || "");
  const parsedCity = normalizeUsLocation({ location: cityText });
  if (parsedCity.state && suppliedState && parsedCity.state !== suppliedState) {
    return { city: parsedCity.city, state: parsedCity.state, conflict: true };
  }
  let found = {
    city: parsedCity.city,
    state: parsedCity.state || suppliedState,
    conflict: false,
  };

  const addressObject = objectOf(source.address);
  const addressText = typeof source.address === "string"
    ? source.address
    : (source.formatted_address || source.formattedAddress || addressObject?.formatted_address || addressObject?.formattedAddress || "");
  found = mergeLocation(found, normalizeUsLocation({ address: addressText }));
  found = mergeLocation(found, locationFromAddressComponents(source));
  if (addressObject) found = mergeLocation(found, locationFromAddressComponents(addressObject));
  return found;
}

function strictCityStateText(value, { allowServicePrefix = false } = {}) {
  let raw = clean(value);
  if (!raw) return { city: "", state: "", conflict: false };
  if (allowServicePrefix) {
    raw = raw.replace(/^(?:service\s*area|serving|serves|based\s+in|located\s+in)\s*[:\-]?\s*/i, "");
    raw = raw.replace(/\s+(?:and\s+)?(?:nearby|surrounding)\s+(?:areas?|communities)\.?$/i, "").trim();
  }
  if (!raw || /[;|/&]/.test(raw) || /\band\b/i.test(raw)) {
    return { city: "", state: "", conflict: false };
  }
  if ((raw.match(/,/g) || []).length > 1) return { city: "", state: "", conflict: false };

  const words = raw.replace(/[.]+$/, "").split(/\s+/).filter(Boolean);
  let state = "";
  let stateWords = 0;
  for (let size = 1; size <= Math.min(3, words.length - 1); size += 1) {
    const candidate = words.slice(-size).join(" ").replace(/^,|,$/g, "");
    const code = stateCode(candidate);
    if (!code) continue;
    state = code;
    stateWords = size;
    break;
  }
  if (!state) return { city: "", state: "", conflict: false };
  const city = clean(words.slice(0, -stateWords).join(" ").replace(/[ ,]+$/, ""));
  if (!city || city.length > 80 || !/[A-Za-z]/.test(city)) {
    return { city: "", state: "", conflict: false };
  }
  if (/\b(?:metro|metropolitan|area|region|county|counties|statewide|nationwide)\b/i.test(city)) {
    return { city: "", state: "", conflict: false };
  }
  return { city, state, conflict: false };
}

function packetEvidenceSources(row = {}) {
  const record = objectOf(row.record) || {};
  const truth = objectOf(record.truth_packet) || {};
  const lead = objectOf(truth.mirror_ready) || {};
  const ready = objectOf(record.build_ready) || {};
  const observedReady = objectOf(objectOf(record.last_mine_observation)?.build_ready) || {};
  const readyFacts = objectOf(objectOf(ready.mirror_request)?.facts);
  const observedFacts = objectOf(objectOf(observedReady.mirror_request)?.facts);
  const sources = [row, readyFacts, observedFacts, lead, truth, record].filter(Boolean);
  const nestedKeys = [
    "nap",
    "business_location", "businessLocation",
    "google_location", "googleLocation",
    "domain_location", "domainLocation",
    "domain_geo", "domainGeo",
    "domain_evidence", "domainEvidence",
  ];
  for (const source of sources.slice()) {
    const location = objectOf(source.location);
    if (location) sources.push(location);
    for (const key of nestedKeys) {
      const nested = objectOf(source[key]);
      if (nested) sources.push(nested);
    }
  }
  return [...new Set(sources)];
}

function evidenceLocations(row = {}) {
  const locations = [];
  for (const source of packetEvidenceSources(row)) {
    const direct = directLocation(source);
    if (direct.city || direct.state || direct.conflict) locations.push(direct);

    const serviceArea = source.service_area || source.serviceArea || "";
    const fromServiceArea = strictCityStateText(serviceArea, { allowServicePrefix: true });
    if (fromServiceArea.city && fromServiceArea.state) locations.push(fromServiceArea);

    for (const key of ["domain_location", "domainLocation", "domain_geo", "domainGeo"]) {
      if (typeof source[key] !== "string") continue;
      const fromDomainSignal = strictCityStateText(source[key]);
      if (fromDomainSignal.city && fromDomainSignal.state) locations.push(fromDomainSignal);
    }
  }
  return locations;
}

/**
 * Fill a missing pick locality only from location evidence the pick already
 * carries. This is an admission projection, not a rewrite of the packet's
 * verified NAP facts: the returned row is shallow-patched, while record and
 * truth_packet stay untouched. Conflicting or incomplete evidence refuses the
 * pick instead of choosing a winner. A complete pick is returned byte-for-byte
 * as the same object so existing-location behavior cannot change here.
 */
function pickLocationAdmission(row = {}) {
  const rawCity = clean(row.city);
  const rawState = clean(row.state);
  if (rawCity && rawState) {
    return { ok: true, row, city: row.city, state: row.state, filled: false };
  }

  let admitted = directLocation({ city: row.city, state: row.state });
  for (const observed of evidenceLocations(row)) {
    admitted = mergeLocation(admitted, observed);
    if (admitted.conflict) {
      return { ok: false, row, reason: PICK_LOCATION_MISSING };
    }
  }
  if (!admitted.city || !admitted.state) {
    return { ok: false, row, reason: PICK_LOCATION_MISSING };
  }
  return {
    ok: true,
    row: { ...row, city: admitted.city, state: admitted.state },
    city: admitted.city,
    state: admitted.state,
    filled: true,
  };
}

module.exports = {
  PICK_LOCATION_MISSING,
  pickLocationAdmission,
};
