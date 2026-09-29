import { escapeHtmlAttribute } from "./premier-media.mjs";

const GOOGLE_HOSTS = new Set(["google.com", "maps.google.com", "www.google.com"]);
const APPLE_HOSTS = new Set(["maps.apple.com"]);

export function buildPremierMap(input = {}, options = {}) {
  const location = locationFrom(input);
  if (!location.query) {
    return {
      schema: "siteforge-premier-map-v1",
      available: false,
      satellite: false,
      mapType: "satellite",
      precision: "unavailable",
      embedUrl: null,
      googleDirectionsUrl: null,
      appleDirectionsUrl: null,
      directions: null,
      lat: null,
      lng: null,
    };
  }

  const encodedQuery = encodeUrlComponent(location.query);
  const zoom = clampZoom(options.zoom, location.precision === "city" ? 12 : 18);
  // The public no-key embed is deliberately used even when a stale Vercel
  // environment key is present. It avoids key/referrer drift while preserving
  // the same satellite and directions experience.
  const embedUrl = `https://www.google.com/maps?q=${encodedQuery}&t=k&z=${zoom}&output=embed&maptype=satellite`;
  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodedQuery}`;
  const appleDirectionsUrl = `https://maps.apple.com/?daddr=${encodedQuery}&dirflg=d`;

  return {
    schema: "siteforge-premier-map-v1",
    available: true,
    satellite: true,
    provider: "google",
    mapType: "satellite",
    precision: location.precision,
    query: location.query,
    label: location.label,
    businessName: location.businessName,
    lat: location.coordinates?.lat ?? null,
    lng: location.coordinates?.lng ?? null,
    embedUrl,
    googleDirectionsUrl,
    appleDirectionsUrl,
    directions: googleDirectionsUrl,
    appleDirections: appleDirectionsUrl,
  };
}

export const buildPremierMapModel = buildPremierMap;

export function renderPremierMap(input = {}, options = {}) {
  const model = input?.schema === "siteforge-premier-map-v1" ? input : buildPremierMap(input, options);
  if (!model.available) {
    return '<div class="premier-map premier-map--unavailable" data-map-status="unavailable"><p>Location map unavailable.</p></div>';
  }

  const embedUrl = safeProviderUrl(model.embedUrl, GOOGLE_HOSTS);
  const googleDirectionsUrl = safeProviderUrl(model.googleDirectionsUrl || model.directions, GOOGLE_HOSTS);
  const appleDirectionsUrl = safeProviderUrl(model.appleDirectionsUrl || model.appleDirections, APPLE_HOSTS);
  if (!embedUrl || !googleDirectionsUrl || !appleDirectionsUrl) {
    return '<div class="premier-map premier-map--unavailable" data-map-status="unavailable"><p>Location map unavailable.</p></div>';
  }

  const titleBase = cleanText(model.businessName || model.label || "Business location");
  const label = cleanText(model.label || model.query || "Location");
  const coordinates = validCoordinates(model.lat, model.lng);
  const coordinateAttributes = coordinates
    ? ` data-lat="${escapeHtmlAttribute(coordinates.lat)}" data-lng="${escapeHtmlAttribute(coordinates.lng)}"`
    : "";
  return [
    `<div class="premier-map premier-map--satellite" data-google-map="satellite" data-map-precision="${escapeHtmlAttribute(model.precision || "location")}"${coordinateAttributes}>`,
    `<iframe title="${escapeHtmlAttribute(`${titleBase} satellite map`)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen src="${escapeHtmlAttribute(embedUrl)}"></iframe>`,
    `<div class="premier-map__directions"><span class="premier-map__address">${escapeHtmlAttribute(label)}</span>`,
    `<nav aria-label="Directions"><a href="${escapeHtmlAttribute(googleDirectionsUrl)}" target="_blank" rel="noopener noreferrer">Google Maps</a>`,
    `<a href="${escapeHtmlAttribute(appleDirectionsUrl)}" target="_blank" rel="noopener noreferrer">Apple Maps</a></nav></div></div>`,
  ].join("");
}

export function premierMapBlock(input = {}, options = {}) {
  const model = buildPremierMap(input, options);
  return { ...model, html: renderPremierMap(model) };
}

export const renderSatelliteMap = renderPremierMap;

function locationFrom(input) {
  const business = input.business || input.biz || {};
  const gbp = input.gbp || input.googleBusinessProfile || {};
  const address = firstLocationText(
    input.address,
    gbp.address,
    input.location?.address,
    business.address,
    input.enrichment_sources?.address?.value,
  );
  const city = firstLocationText(input.city, business.city, gbp.city, input.location?.city);
  const state = firstLocationText(input.state, business.state, gbp.state, input.location?.state);
  const businessName = cleanText(input.businessName || input.name || business.name || input.biz?.name || "");
  const enrichmentCoordinates = input.enrichment_sources?.latlng?.value;
  const coordinates = validCoordinates(
    input.lat ?? input.latitude ?? input.coordinates?.lat ?? input.location?.lat ?? gbp.latlng?.lat ?? gbp.coordinates?.lat ?? enrichmentCoordinates?.lat,
    input.lng ?? input.lon ?? input.longitude ?? input.coordinates?.lng ?? input.location?.lng ?? gbp.latlng?.lng ?? gbp.coordinates?.lng ?? enrichmentCoordinates?.lng,
  );

  if (coordinates) {
    const query = `${coordinates.lat},${coordinates.lng}`;
    return {
      query,
      label: address || [city, state].filter(Boolean).join(", ") || query,
      precision: "coordinates",
      businessName,
      coordinates,
    };
  }
  if (address) return { query: address, label: address, precision: "address", businessName, coordinates };
  const cityState = [city, state].filter(Boolean).join(", ");
  return { query: cityState, label: cityState, precision: cityState ? "city" : "unavailable", businessName };
}

function validCoordinates(latitude, longitude) {
  if (latitude == null || longitude == null || String(latitude).trim() === "" || String(longitude).trim() === "") return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function firstLocationText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && !/^(?:n\/?a|none|tbd|unknown|address unavailable)$/i.test(text) && !/^123 (?:main|sample) st/i.test(text)) return text;
  }
  return "";
}

function safeProviderUrl(value, allowedHosts) {
  try {
    const parsed = new URL(String(value || ""));
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !allowedHosts.has(host)) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function encodeUrlComponent(value) {
  return encodeURIComponent(cleanText(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function clampZoom(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(21, Math.round(number))) : fallback;
}

function cleanText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
