module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb"
    }
  }
};

const { requireProviderRouteAuth } = require("./lib/provider-route-auth");

const PLACES_API_ORIGIN = "https://places.googleapis.com";
const SEARCH_TEXT_FIELD_MASK = "places.id";
const PLACE_DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "location",
  "regularOpeningHours",
  "types",
  "rating",
  "userRatingCount",
  "businessStatus",
  "addressComponents"
].join(",");

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!requireProviderRouteAuth(req, res)) return;

  const keys = [...new Set([
    process.env.GOOGLE_PLACES_API_KEY,
    process.env.GOOGLE_MAPS_API_KEY,
    process.env.MAPS_API_KEY
  ].map(value => String(value || "").trim()).filter(Boolean))];
  const body = req.body || {};
  const query = String(body.query || "").trim();
  const placeIdFromBody = String(body.placeId || "").trim();
  const placeIdFromUrl = extractPlaceId(String(body.gbpLink || ""));
  const placeId = placeIdFromBody || placeIdFromUrl;

  if (!keys.length) {
    return res.status(200).json({
      ok: true,
      status: "not_configured",
      error: "GOOGLE_PLACES_API_KEY is not configured. Add it to WSS to enable automatic GBP enrichment.",
      fields: {
        gbpLink: body.gbpLink || "",
        websiteUrl: body.websiteUrl || ""
      }
    });
  }

  if (!query && !placeId) {
    return res.status(400).json({ ok: false, error: "Provide query or placeId." });
  }

  let lastError;
  for (const key of keys) {
    try {
      const resolvedPlaceId = placeId || await findPlaceId(query, key);
      if (!resolvedPlaceId) {
        return res.status(200).json({ ok: true, status: "not_found", fields: {}, raw: { candidates: [] } });
      }
      const details = await placeDetails(resolvedPlaceId, key);
      const fields = mapDetails(details, resolvedPlaceId, body.serviceRadiusMiles);
      return res.status(200).json({ ok: true, status: "mapped", fields, raw: safeDetails(details) });
    } catch (error) {
      lastError = error;
      if (!/REQUEST_DENIED|PERMISSION_DENIED|API_KEY_INVALID|referer restrictions|API key|key not valid/i.test(String(error?.message || ""))) break;
    }
  }
  const fallback = await geocodeAddressFallback(body, placeId).catch(() => null);
  if (fallback) {
    return res.status(200).json({
      ok: true,
      status: "mapped_fallback",
      warning: "Google Places rejected the configured server key. Coordinates were mapped from the public street address with OpenStreetMap and require human review.",
      fields: fallback,
      raw: { provider: "OpenStreetMap Nominatim", googleError: lastError?.message || "" }
    });
  }
  return res.status(502).json({ ok: false, error: lastError?.message || "Google Places lookup failed." });
};

async function geocodeAddressFallback(body, placeId) {
  const address = String(body.address || "").trim();
  if (!address) return null;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", address.slice(0, 300));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "WoodwardPageHubIntake/1.0 (https://wss-ai.com)"
      }
    });
    const results = await response.json().catch(() => []);
    const match = Array.isArray(results) ? results[0] : null;
    const lat = Number(match?.lat);
    const lng = Number(match?.lon);
    if (!response.ok || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const explicitRadius = positiveNumber(body.serviceRadiusMiles);
    const sourceAddress = String(match.display_name || address).trim();
    const city = match.address?.city || match.address?.town || match.address?.village || match.address?.municipality || "";
    const state = match.address?.state || "";
    return Object.fromEntries(Object.entries({
      businessName: body.businessName || "",
      websiteUrl: body.websiteUrl || "",
      gbpLink: body.gbpLink || "",
      gbpPlaceId: placeId || "",
      address: sourceAddress,
      serviceArea: body.serviceArea || [city, state].filter(Boolean).join(", "),
      geoLat: String(lat),
      geoLng: String(lng),
      geoSource: "OpenStreetMap exact-address fallback; review before production",
      serviceRadiusMiles: explicitRadius || 25,
      serviceRadiusSource: explicitRadius
        ? "Intake-provided value; Google Places does not verify service radius"
        : "25-mile display default from source-backed coordinates; human review required",
      serviceRadiusNeedsReview: !explicitRadius,
      listingConfidence: "Likely match - needs human review"
    }).filter(([, value]) => value !== ""));
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return /(^https:\/\/pagehub-intake-lock-form\.vercel\.app$)|(^https:\/\/pagehub-intake\.wss-ai\.com$)|(^https:\/\/[a-z0-9-]+\.lovable\.app$)|(^https?:\/\/localhost(?::\d+)?$)|(^https?:\/\/127\.0\.0\.1(?::\d+)?$)/i.test(origin);
}

function extractPlaceId(url) {
  const text = String(url || "");
  const match = text.match(/[?&](?:query_place_id|destination_place_id|place_id)=([^&]+)/i)
    || text.match(/\bplace_id[:=]\s*([A-Za-z0-9_-]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

async function findPlaceId(query, key) {
  const url = new URL("/v1/places:searchText", PLACES_API_ORIGIN);
  const json = await fetchJson(url, {
    method: "POST",
    headers: placesHeaders(key, SEARCH_TEXT_FIELD_MASK, true),
    body: JSON.stringify({
      textQuery: query,
      languageCode: "en",
      regionCode: "US",
      pageSize: 1,
      includePureServiceAreaBusinesses: true
    })
  });
  return String(json.places?.[0]?.id || "").trim();
}

async function placeDetails(placeId, key) {
  const normalizedPlaceId = String(placeId || "").replace(/^places\//i, "").trim();
  const url = new URL(`/v1/places/${encodeURIComponent(normalizedPlaceId)}`, PLACES_API_ORIGIN);
  const place = await fetchJson(url, {
    method: "GET",
    headers: placesHeaders(key, PLACE_DETAILS_FIELD_MASK)
  });
  return normalizeNewPlace(place);
}

function placesHeaders(key, fieldMask, includeContentType = false) {
  return {
    ...(includeContentType ? { "Content-Type": "application/json" } : {}),
    "X-Goog-Api-Key": key,
    "X-Goog-FieldMask": fieldMask
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = json.error?.status || json.status || `HTTP_${response.status}`;
      const message = json.error?.message || json.error_message || "no details";
      throw new Error(`Google Places ${status}: ${message}`);
    }
    return json;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Google Places lookup timed out after 12 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeNewPlace(place = {}) {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  return {
    name: place.displayName?.text || "",
    formatted_address: place.formattedAddress || "",
    formatted_phone_number: place.nationalPhoneNumber || "",
    international_phone_number: place.internationalPhoneNumber || "",
    website: place.websiteUri || "",
    url: place.googleMapsUri || "",
    geometry: {
      location: hasLocation ? { lat: latitude, lng: longitude } : {}
    },
    opening_hours: {
      weekday_text: Array.isArray(place.regularOpeningHours?.weekdayDescriptions)
        ? place.regularOpeningHours.weekdayDescriptions
        : []
    },
    types: Array.isArray(place.types) ? place.types : [],
    rating: Number.isFinite(place.rating) ? place.rating : null,
    user_ratings_total: Number.isFinite(place.userRatingCount) ? place.userRatingCount : null,
    business_status: place.businessStatus || "",
    address_components: (Array.isArray(place.addressComponents) ? place.addressComponents : []).map(component => ({
      long_name: component.longText || component.shortText || "",
      short_name: component.shortText || component.longText || "",
      types: Array.isArray(component.types) ? component.types : []
    }))
  };
}

function mapDetails(details, placeId, requestedServiceRadiusMiles) {
  const location = details.geometry?.location || {};
  const hasVerifiedLocation = Number.isFinite(location.lat) && Number.isFinite(location.lng);
  const explicitServiceRadius = positiveNumber(requestedServiceRadiusMiles);
  const serviceRadiusMiles = explicitServiceRadius || (hasVerifiedLocation ? 25 : "");
  const serviceRadiusSource = explicitServiceRadius
    ? "Intake-provided value; Google Places does not verify service radius"
    : hasVerifiedLocation
      ? "25-mile display default from verified Google coordinates; human review required"
      : "";
  const addressParts = parseAddressComponents(details.address_components || []);
  const hours = Array.isArray(details.opening_hours?.weekday_text)
    ? details.opening_hours.weekday_text.join("\n")
    : "";
  const fields = {
    businessName: details.name || "",
    phone: details.formatted_phone_number || details.international_phone_number || "",
    domainUrl: details.website || "",
    websiteUrl: details.website || "",
    gbpLink: details.url || "",
    gbpPlaceId: placeId || "",
    address: details.formatted_address || "",
    geoLat: hasVerifiedLocation ? String(location.lat) : "",
    geoLng: hasVerifiedLocation ? String(location.lng) : "",
    serviceRadiusMiles,
    serviceRadiusSource,
    serviceRadiusNeedsReview: explicitServiceRadius ? false : Boolean(serviceRadiusMiles),
    hours,
    hoursSource: hours ? "Google Business Profile" : "",
    listingConfidence: details.business_status === "OPERATIONAL" ? "Exact business match" : "Likely match - needs human review",
    reviewsProof: details.rating && details.user_ratings_total
      ? `Google rating ${details.rating} from ${details.user_ratings_total} public reviews. Verify before displaying exact review count.`
      : "",
    serviceArea: [addressParts.city, addressParts.state].filter(Boolean).join(", ")
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""));
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseAddressComponents(components) {
  const get = type => components.find(component => component.types?.includes(type))?.short_name || "";
  return {
    city: get("locality") || get("postal_town") || get("administrative_area_level_3"),
    state: get("administrative_area_level_1"),
    country: get("country"),
    zip: get("postal_code")
  };
}

function safeDetails(details) {
  return {
    name: details.name || "",
    formatted_address: details.formatted_address || "",
    website: details.website || "",
    url: details.url || "",
    geometry: details.geometry || null,
    rating: details.rating || null,
    user_ratings_total: details.user_ratings_total || null,
    business_status: details.business_status || ""
  };
}
