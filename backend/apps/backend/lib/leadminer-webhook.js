"use strict";

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const { approvedIndustry } = require("./copilot");

const MAX_BATCH = 25;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const SCHEMA_VERSION = "1.0";
const EVENT_TYPE = "lead.enriched";

const HEADER_KEYS = Object.freeze({
  signature: "x-leadminer-signature",
  timestamp: "x-leadminer-timestamp",
  event: "x-leadminer-event",
  projectId: "x-leadminer-project",
  deliveryId: "x-leadminer-delivery",
  idempotencyKey: "x-leadminer-idempotency-key",
  schemaVersion: "x-leadminer-schema-version",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REAL_PLACE_ID = /^[A-Za-z0-9_-]{8,255}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const URL_PROTOCOLS = new Set(["http:", "https:"]);
const LEAD_FIELDS = new Set([
  "business_name", "place_id", "industry", "phone_national", "phone_e164",
  "email", "email_source_url", "email_domain_class", "website_url", "website_status",
  "website_grade", "opportunity_score", "street", "city", "state", "zip", "lat", "lng",
  "rating", "review_count", "gbp_url", "reviews", "hours", "logo_url", "logo_source_url",
  "logo_on_own_domain", "brand_colors", "photos", "services", "founding_year",
  "founding_year_evidence", "social", "credits_spent", "provenance",
]);
const REVIEW_FIELDS = new Set(["author", "rating", "text", "published_at", "author_photo_url"]);
const PHOTO_FIELDS = new Set(["url", "source"]);
const SERVICE_FIELDS = new Set(["name", "description", "price"]);
const SOCIAL_FIELDS = new Set(["platform", "url"]);
const BRAND_COLOR_FIELDS = new Set(["primary", "accent"]);

function contractError(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function headerValue(headers = {}, name) {
  const direct = headers[name];
  if (Array.isArray(direct)) return String(direct[0] || "").trim();
  if (direct !== undefined && direct !== null) return String(direct).trim();
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name);
  const value = found ? headers[found] : "";
  return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
}

function validateLeadMinerHeaders(headers = {}) {
  const normalized = {};
  for (const [key, name] of Object.entries(HEADER_KEYS)) {
    normalized[key] = headerValue(headers, name);
    if (!normalized[key]) {
      throw contractError(400, "leadminer_header_missing", `${name} is required`);
    }
  }
  if (!/^sha256=[a-f0-9]{64}$/i.test(normalized.signature)) {
    throw contractError(400, "leadminer_signature_format_invalid", "X-LeadMiner-Signature must be sha256=<64 hex characters>");
  }
  if (!/^\d{10,}$/.test(normalized.timestamp)) {
    throw contractError(400, "leadminer_timestamp_invalid", "X-LeadMiner-Timestamp must be Unix seconds");
  }
  if (normalized.event !== EVENT_TYPE) {
    throw contractError(400, "leadminer_event_invalid", `X-LeadMiner-Event must be ${EVENT_TYPE}`);
  }
  if (!UUID.test(normalized.projectId)) {
    throw contractError(400, "leadminer_project_invalid", "X-LeadMiner-Project must be a UUID");
  }
  if (!UUID.test(normalized.deliveryId)) {
    throw contractError(400, "leadminer_delivery_invalid", "X-LeadMiner-Delivery must be a UUID");
  }
  if (!/^mirror-ready:[a-f0-9]{64}$/i.test(normalized.idempotencyKey)) {
    throw contractError(400, "leadminer_idempotency_invalid", "X-LeadMiner-Idempotency-Key is invalid");
  }
  if (normalized.schemaVersion !== SCHEMA_VERSION) {
    throw contractError(400, "leadminer_schema_unsupported", `X-LeadMiner-Schema-Version must be ${SCHEMA_VERSION}`);
  }
  return normalized;
}

function verifyLeadMinerSignature({ rawBody, signature, timestamp, secret, nowMs = Date.now() }) {
  const configuredSecret = String(secret || "").trim();
  if (!configuredSecret) {
    return { verified: false, configured: false, reason: "GHOST_AGENCY_LEADMINER_WEBHOOK_SECRET not configured" };
  }
  if (!/^sha256=[a-f0-9]{64}$/i.test(String(signature || ""))) {
    return { verified: false, configured: true, reason: "LeadMiner signature format invalid" };
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    return { verified: false, configured: true, reason: "LeadMiner timestamp invalid" };
  }
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return { verified: false, configured: true, reason: "LeadMiner signature timestamp outside tolerance" };
  }
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : rawBody instanceof Uint8Array
      ? Buffer.from(rawBody)
      : null;
  if (!body) return { verified: false, configured: true, reason: "LeadMiner raw body bytes unavailable" };
  const expected = createHmac("sha256", configuredSecret)
    .update(`${timestamp}.`, "utf8")
    .update(body)
    .digest("hex");
  const actual = String(signature).slice("sha256=".length).toLowerCase();
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  const verified = expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  return { verified, configured: true, reason: verified ? undefined : "LeadMiner signature invalid" };
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmpty(value, max = 1000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isHttpUrl(value) {
  if (!nonEmpty(value, 4000)) return false;
  try { return URL_PROTOCOLS.has(new URL(value).protocol); }
  catch { return false; }
}

function containsNull(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsNull);
  if (isObject(value)) return Object.values(value).some(containsNull);
  return false;
}

function assertOnlyKeys(value, allowed, at) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) {
      throw contractError(400, "leadminer_field_unknown", `${at}.${key} is not part of the Mirror-Ready contract`);
    }
  }
}

function validProvenance(value, requiredKind = "") {
  if (!isObject(value)
    || !nonEmpty(value.captured_at, 100)
    || !Number.isFinite(Date.parse(value.captured_at))
    || !nonEmpty(value.source, 4000)
    || !nonEmpty(value.source_kind, 100)) return false;
  return !requiredKind || value.source_kind === requiredKind;
}

function leadProvenance(lead, pointer) {
  const value = lead?.provenance?.[pointer];
  return validProvenance(value) ? value : null;
}

function escapeJsonPointerToken(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function collectLeafPointers(value, pointer = "", output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLeafPointers(item, `${pointer}/${index}`, output));
    return output;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!pointer && key === "provenance") continue;
      collectLeafPointers(item, `${pointer}/${escapeJsonPointerToken(key)}`, output);
    }
    return output;
  }
  if (pointer) output.push(pointer);
  return output;
}

function validateCompleteProvenance(lead, at) {
  for (const pointer of collectLeafPointers(lead)) {
    if (!leadProvenance(lead, pointer)) {
      throw contractError(
        400,
        "leadminer_field_provenance_missing",
        `${at}${pointer} requires valid provenance at ${pointer}`,
      );
    }
  }
}

function validateOptionalUrl(lead, key) {
  if (lead[key] !== undefined && !isHttpUrl(lead[key])) {
    throw contractError(400, "leadminer_lead_invalid", `${key} must be an HTTP(S) URL`);
  }
}

function validateOneLead(lead, index) {
  const at = `leads[${index}]`;
  if (!isObject(lead) || containsNull(lead)) {
    throw contractError(400, "leadminer_sparse_payload_invalid", `${at} must be an object with unverified fields omitted, not null`);
  }
  assertOnlyKeys(lead, LEAD_FIELDS, at);
  if (!nonEmpty(lead.business_name, 240)) {
    throw contractError(400, "leadminer_business_name_invalid", `${at}.business_name is required`);
  }
  if (!nonEmpty(lead.place_id, 255) || !REAL_PLACE_ID.test(lead.place_id) || lead.place_id.toLowerCase().startsWith("fc_")) {
    throw contractError(400, "leadminer_place_id_invalid", `${at}.place_id must be a real Google Place ID`);
  }
  if (!isObject(lead.provenance)
    || !validProvenance(lead.provenance["/business_name"], "google_places_api")
    || !validProvenance(lead.provenance["/place_id"], "google_places_api")) {
    throw contractError(400, "leadminer_identity_provenance_invalid", `${at} requires Google Places provenance for business_name and place_id`);
  }
  if (lead.phone_e164 !== undefined && (!nonEmpty(lead.phone_e164, 32) || !E164.test(lead.phone_e164))) {
    throw contractError(400, "leadminer_phone_invalid", `${at}.phone_e164 is invalid`);
  }
  if (lead.phone_national !== undefined && !nonEmpty(lead.phone_national, 64)) {
    throw contractError(400, "leadminer_phone_invalid", `${at}.phone_national is invalid`);
  }
  if (lead.email !== undefined) {
    const hasDomainClass = lead.email_domain_class !== undefined;
    if (!nonEmpty(lead.email, 254) || !EMAIL.test(lead.email)
      || !isHttpUrl(lead.email_source_url)
      || !leadProvenance(lead, "/email")
      || !leadProvenance(lead, "/email_source_url")
      || (hasDomainClass && (
        !["own_domain", "free_provider"].includes(lead.email_domain_class)
        || !leadProvenance(lead, "/email_domain_class")
      ))) {
      throw contractError(400, "leadminer_email_invalid", `${at}.email requires a published source; a supplied domain class must be verified`);
    }
  } else if (lead.email_source_url !== undefined || lead.email_domain_class !== undefined) {
    throw contractError(400, "leadminer_email_invalid", `${at} cannot include email metadata without email`);
  }
  for (const key of ["website_url", "gbp_url", "logo_url", "logo_source_url"]) validateOptionalUrl(lead, key);
  if (lead.website_status !== undefined && !["none", "legacy_cms", "modern"].includes(lead.website_status)) {
    throw contractError(400, "leadminer_website_status_invalid", `${at}.website_status is invalid`);
  }
  if (lead.website_grade !== undefined && !["A+", "A", "B", "C", "D", "F"].includes(lead.website_grade)) {
    throw contractError(400, "leadminer_website_grade_invalid", `${at}.website_grade is invalid`);
  }
  if (lead.opportunity_score !== undefined && (!Number.isFinite(lead.opportunity_score) || lead.opportunity_score < 0 || lead.opportunity_score > 100)) {
    throw contractError(400, "leadminer_opportunity_invalid", `${at}.opportunity_score is invalid`);
  }
  if (lead.rating !== undefined && (!Number.isFinite(lead.rating) || lead.rating < 0 || lead.rating > 5)) {
    throw contractError(400, "leadminer_rating_invalid", `${at}.rating is invalid`);
  }
  if (lead.review_count !== undefined && (!Number.isInteger(lead.review_count) || lead.review_count < 0)) {
    throw contractError(400, "leadminer_review_count_invalid", `${at}.review_count is invalid`);
  }
  if (lead.lat !== undefined && (!Number.isFinite(lead.lat) || lead.lat < -90 || lead.lat > 90)) {
    throw contractError(400, "leadminer_coordinates_invalid", `${at}.lat is invalid`);
  }
  if (lead.lng !== undefined && (!Number.isFinite(lead.lng) || lead.lng < -180 || lead.lng > 180)) {
    throw contractError(400, "leadminer_coordinates_invalid", `${at}.lng is invalid`);
  }
  if ((lead.lat === undefined) !== (lead.lng === undefined)) {
    throw contractError(400, "leadminer_coordinates_invalid", `${at}.lat and lng must be supplied together`);
  }
  if (lead.logo_on_own_domain !== undefined && typeof lead.logo_on_own_domain !== "boolean") {
    throw contractError(400, "leadminer_logo_invalid", `${at}.logo_on_own_domain must be boolean`);
  }
  if (lead.brand_colors !== undefined) {
    assertOnlyKeys(lead.brand_colors, BRAND_COLOR_FIELDS, `${at}.brand_colors`);
    if (!isObject(lead.brand_colors)
      || Object.keys(lead.brand_colors).length === 0
      || (lead.brand_colors.primary !== undefined && !HEX.test(lead.brand_colors.primary))
      || (lead.brand_colors.accent !== undefined && !HEX.test(lead.brand_colors.accent))) {
      throw contractError(400, "leadminer_brand_colors_invalid", `${at}.brand_colors is invalid`);
    }
  }
  if (lead.reviews !== undefined) {
    if (!Array.isArray(lead.reviews) || lead.reviews.length > 5) {
      throw contractError(400, "leadminer_reviews_invalid", `${at}.reviews must contain at most 5 items`);
    }
    lead.reviews.forEach((review, reviewIndex) => {
      if (!isObject(review)) throw contractError(400, "leadminer_reviews_invalid", `${at}.reviews[${reviewIndex}] is invalid`);
      assertOnlyKeys(review, REVIEW_FIELDS, `${at}.reviews[${reviewIndex}]`);
      if (review.author !== undefined && !nonEmpty(review.author, 240)) throw contractError(400, "leadminer_reviews_invalid", `${at}.reviews[${reviewIndex}].author is invalid`);
      if (review.text !== undefined && !nonEmpty(review.text, 10_000)) throw contractError(400, "leadminer_reviews_invalid", `${at}.reviews[${reviewIndex}].text is invalid`);
      if (review.rating !== undefined && (!Number.isFinite(review.rating) || review.rating < 1 || review.rating > 5)) throw contractError(400, "leadminer_reviews_invalid", `${at}.reviews[${reviewIndex}].rating is invalid`);
      if (review.published_at !== undefined && (!nonEmpty(review.published_at, 100) || !Number.isFinite(Date.parse(review.published_at)))) throw contractError(400, "leadminer_reviews_invalid", `${at}.reviews[${reviewIndex}].published_at is invalid`);
      if (review.author_photo_url !== undefined && !isHttpUrl(review.author_photo_url)) throw contractError(400, "leadminer_reviews_invalid", `${at}.reviews[${reviewIndex}].author_photo_url is invalid`);
    });
  }
  if (lead.hours !== undefined && (!Array.isArray(lead.hours) || lead.hours.length > 14 || lead.hours.some((period) => !isObject(period)))) {
    throw contractError(400, "leadminer_hours_invalid", `${at}.hours must be Places opening-hour periods`);
  }
  if (lead.photos !== undefined) {
    if (!Array.isArray(lead.photos) || lead.photos.length > 8 || lead.photos.some((photo) => (
      !isObject(photo) || !isHttpUrl(photo.url) || !["own_site", "gbp"].includes(photo.source)
    ))) {
      throw contractError(400, "leadminer_photos_invalid", `${at}.photos must contain at most 8 verified photo URLs`);
    }
    lead.photos.forEach((photo, photoIndex) => assertOnlyKeys(photo, PHOTO_FIELDS, `${at}.photos[${photoIndex}]`));
  }
  if (lead.services !== undefined && (!Array.isArray(lead.services) || lead.services.some((service) => (
    !isObject(service) || !nonEmpty(service.name, 240)
  )))) {
    throw contractError(400, "leadminer_services_invalid", `${at}.services is invalid`);
  }
  (lead.services || []).forEach((service, serviceIndex) => {
    assertOnlyKeys(service, SERVICE_FIELDS, `${at}.services[${serviceIndex}]`);
    if (service.description !== undefined && !nonEmpty(service.description, 4000)) throw contractError(400, "leadminer_services_invalid", `${at}.services[${serviceIndex}].description is invalid`);
    if (service.price !== undefined && !nonEmpty(service.price, 240)) throw contractError(400, "leadminer_services_invalid", `${at}.services[${serviceIndex}].price is invalid`);
  });
  if (lead.social !== undefined && (!Array.isArray(lead.social) || lead.social.some((social) => (
    !isObject(social) || !nonEmpty(social.platform, 80) || !isHttpUrl(social.url)
  )))) {
    throw contractError(400, "leadminer_social_invalid", `${at}.social is invalid`);
  }
  (lead.social || []).forEach((social, socialIndex) => assertOnlyKeys(social, SOCIAL_FIELDS, `${at}.social[${socialIndex}]`));
  if (lead.founding_year !== undefined) {
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(lead.founding_year) || lead.founding_year < 1800 || lead.founding_year > currentYear
      || !nonEmpty(lead.founding_year_evidence, 1000)) {
      throw contractError(400, "leadminer_founding_year_invalid", `${at}.founding_year requires its matched evidence sentence`);
    }
  } else if (lead.founding_year_evidence !== undefined) {
    throw contractError(400, "leadminer_founding_year_invalid", `${at}.founding_year_evidence requires founding_year`);
  }
  if (lead.credits_spent !== undefined && (!Number.isFinite(lead.credits_spent) || lead.credits_spent < 0)) {
    throw contractError(400, "leadminer_credits_invalid", `${at}.credits_spent is invalid`);
  }
  validateCompleteProvenance(lead, at);
  for (const pointer of ["/rating", "/review_count", "/gbp_url"]) {
    if (leadProvenance(lead, pointer) && lead.provenance[pointer].source_kind !== "google_places_api") {
      throw contractError(400, "leadminer_places_provenance_invalid", `${at}${pointer} must come from Google Places`);
    }
  }
  for (const [pointer, evidence] of Object.entries(lead.provenance)) {
    if ((pointer.startsWith("/reviews/") || pointer.startsWith("/hours/"))
      && evidence.source_kind !== "google_places_api") {
      throw contractError(400, "leadminer_places_provenance_invalid", `${at}${pointer} must come from Google Places`);
    }
  }
  (lead.photos || []).forEach((photo, photoIndex) => {
    if (photo.source !== "gbp") return;
    for (const pointer of [`/photos/${photoIndex}/url`, `/photos/${photoIndex}/source`]) {
      if (lead.provenance[pointer]?.source_kind !== "google_places_api") {
        throw contractError(400, "leadminer_places_provenance_invalid", `${at}${pointer} must come from Google Places`);
      }
    }
  });
  return lead;
}

function validateLeadBatch(payload) {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > MAX_BATCH) {
    throw contractError(400, "leadminer_batch_invalid", `LeadMiner payload must be an array containing 1-${MAX_BATCH} leads`);
  }
  const seen = new Set();
  return payload.map((lead, index) => {
    const valid = validateOneLead(lead, index);
    if (seen.has(valid.place_id)) {
      throw contractError(400, "leadminer_batch_duplicate_place_id", `Duplicate place_id in payload: ${valid.place_id}`);
    }
    seen.add(valid.place_id);
    return valid;
  });
}

function verifiedSource(lead, pointer, fallback = "") {
  return leadProvenance(lead, pointer)?.source || fallback;
}

function inferredIndustry(lead) {
  const explicitValue = String(lead.industry || lead.category || lead.trade || "").trim();
  const explicit = approvedIndustry(explicitValue);
  if (explicit && (leadProvenance(lead, "/industry") || leadProvenance(lead, "/category") || leadProvenance(lead, "/trade"))) {
    return {
      value: explicitValue,
      normalized: explicit,
      pointer: lead.industry ? "/industry" : lead.category ? "/category" : "/trade",
    };
  }
  for (let index = 0; index < (lead.services || []).length; index += 1) {
    const candidate = approvedIndustry(lead.services[index]?.name || "");
    if (candidate && leadProvenance(lead, `/services/${index}/name`)) {
      return { value: candidate, normalized: candidate, pointer: `/services/${index}/name` };
    }
  }
  return { value: "", normalized: "", pointer: "" };
}

function buildTruthPacket(lead, options = {}) {
  const capturedAt = options.capturedAt || new Date().toISOString();
  const industry = inferredIndustry(lead);
  const assets = [];
  if (lead.logo_url && lead.logo_source_url
    && leadProvenance(lead, "/logo_url") && leadProvenance(lead, "/logo_source_url")) {
    assets.push({
      kind: "logo",
      url: lead.logo_url,
      source: "website",
      source_url: lead.logo_source_url,
      verified: true,
      status: "verified",
    });
  }
  for (let index = 0; index < (lead.photos || []).length; index += 1) {
    const photo = lead.photos[index];
    const evidence = leadProvenance(lead, `/photos/${index}/url`);
    if (!evidence) continue;
    assets.push({
      kind: "photo",
      url: photo.url,
      source: photo.source === "gbp" ? "gbp" : "website",
      source_url: evidence.source,
      verified: true,
      status: "verified",
    });
  }
  const serviceEvidence = [];
  for (let index = 0; index < (lead.services || []).length; index += 1) {
    const service = lead.services[index];
    const evidence = leadProvenance(lead, `/services/${index}/name`);
    if (!evidence) continue;
    serviceEvidence.push({
      field: "services",
      value: service.name,
      ...(service.description ? { description: service.description } : {}),
      ...(service.price ? { price: service.price } : {}),
      source: evidence.source,
      source_url: evidence.source,
      verified: true,
      status: "verified",
      confidence: 1,
    });
  }
  const missing = [];
  if (!industry.value) missing.push("verified_industry");
  if (!lead.city || !leadProvenance(lead, "/city")) missing.push("verified_city");
  if (!lead.state || !leadProvenance(lead, "/state")) missing.push("verified_state");
  if (!assets.some((asset) => asset.kind === "logo")) missing.push("verified_logo");
  if (!assets.some((asset) => asset.kind === "photo" || asset.kind === "video")) missing.push("verified_photo_or_video");
  if (!serviceEvidence.length) missing.push("verified_service_evidence");
  const identitySource = lead.provenance["/business_name"].source;
  const placeSource = lead.provenance["/place_id"].source;
  const packet = {
    meta: {
      source: "leadminer_mirror_ready",
      schema_version: options.schemaVersion || SCHEMA_VERSION,
      captured_at: capturedAt,
      project_id: options.projectId || "",
      provider_calls: 0,
      send_actions: 0,
      publish_actions: 0,
      build_ready: missing.length === 0,
      missing_build_evidence: missing,
    },
    source: "leadminer_mirror_ready",
    identity: {
      name: { value: lead.business_name, verified: true, status: "verified", confidence: 1, source: identitySource },
      place_id: { value: lead.place_id, verified: true, status: "verified", confidence: 1, source: placeSource },
      ...(industry.value ? {
        category: {
          value: industry.value,
          verified: true,
          status: "verified",
          confidence: 1,
          source: verifiedSource(lead, industry.pointer),
        },
      } : {}),
    },
    assets,
    source_assets: assets,
    service_evidence: serviceEvidence,
    evidence: serviceEvidence,
    intakeGenie: {
      source: "leadminer_mirror_ready",
      assets,
      evidence: serviceEvidence,
      service_evidence: serviceEvidence,
      facts: {
        business_name: lead.business_name,
        place_id: lead.place_id,
        ...(industry.value ? { industry: industry.value } : {}),
        ...(lead.phone_national ? { phone_national: lead.phone_national } : {}),
        ...(lead.phone_e164 ? { phone_e164: lead.phone_e164 } : {}),
        ...(lead.email ? { email: lead.email, email_source_url: lead.email_source_url } : {}),
        ...(lead.website_url ? { website_url: lead.website_url } : {}),
        ...(lead.reviews ? { reviews: lead.reviews } : {}),
        ...(lead.hours ? { hours: lead.hours } : {}),
        ...(lead.brand_colors ? { brand_colors: lead.brand_colors } : {}),
        ...(lead.social ? { social: lead.social } : {}),
      },
    },
    mirror_ready: lead,
  };
  return packet;
}

function deterministicProspectId(placeId) {
  return `place_${createHash("sha256").update(String(placeId)).digest("hex").slice(0, 32)}`;
}

function leadToProspect(lead, context = {}) {
  const truthPacket = buildTruthPacket(lead, {
    capturedAt: context.capturedAt,
    projectId: context.projectId,
    schemaVersion: context.schemaVersion,
  });
  const prospectId = context.existingProspectId || deterministicProspectId(lead.place_id);
  const services = (lead.services || []).map((service) => service.name).filter(Boolean);
  const address = [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  const buildReady = truthPacket.meta.build_ready === true;
  const missing = truthPacket.meta.missing_build_evidence;
  const industry = approvedIndustry(truthPacket.identity?.category?.value || "");
  const state = buildReady ? "ready_for_build" : "held_incomplete";
  const priorRecord = isObject(context.existingRecord) ? context.existingRecord : {};
  const workflowStatus = nonEmpty(context.existingStatus, 100) ? context.existingStatus : "held";
  const holdReasons = [
    ...new Set([
      ...(Array.isArray(priorRecord.outreach_hold_reasons) ? priorRecord.outreach_hold_reasons : []),
      "email_confidence_below_threshold",
      "leadminer_mirror_ready_human_review",
    ]),
  ];
  const canonicalTruthPacket = truthPacket;
  // The packet and its source are one canonical claim. Replacing stale truth
  // while retaining its old label makes the Line skip the fresh packet because
  // packet selection keys off truth_packet_source.
  const canonicalTruthSource = String(canonicalTruthPacket.meta?.source || "").trim()
    || "leadminer_mirror_ready";
  const record = {
    ...priorRecord,
    business_name: priorRecord.business_name || lead.business_name,
    place_id: lead.place_id,
    ...(priorRecord.email ? {} : lead.email ? { email: lead.email } : {}),
    ...(priorRecord.phone ? {} : lead.phone_e164 || lead.phone_national ? { phone: lead.phone_e164 || lead.phone_national } : {}),
    ...(priorRecord.current_website ? {} : lead.website_url ? { current_website: lead.website_url } : {}),
    ...(priorRecord.industry ? {} : industry ? { industry } : {}),
    ...(priorRecord.city ? {} : lead.city ? { city: lead.city } : {}),
    ...(priorRecord.state ? {} : lead.state ? { state: lead.state } : {}),
    ...(priorRecord.postal_code ? {} : lead.zip ? { postal_code: lead.zip } : {}),
    leadminer_mirror_ready: lead,
    leadminer_truth_packet: truthPacket,
    prospect_id: prospectId,
    source: priorRecord.source || "leadminer_mirror_ready",
    status: workflowStatus,
    handoff_state: state,
    automation_hold: true,
    outreach_hold: true,
    outreach_review_hold: true,
    outreach_hold_reasons: holdReasons,
    contact_enrichment: {
      ...(isObject(priorRecord.contact_enrichment) ? priorRecord.contact_enrichment : {}),
      source: priorRecord.contact_enrichment?.source || "leadminer_mirror_ready",
      outreach: {
        ...(isObject(priorRecord.contact_enrichment?.outreach) ? priorRecord.contact_enrichment.outreach : {}),
        review_hold: true,
        hold_reasons: holdReasons,
        sendable_email: null,
      },
    },
    publish_hold: true,
    build_ready: buildReady,
    missing_build_evidence: missing,
    blocked_reason: buildReady ? undefined : `mirror_ready_incomplete:${missing.join(",")}`,
    truth_packet: canonicalTruthPacket,
    truth_packet_source: canonicalTruthSource,
    leadminer_project_id: context.projectId || "",
    leadminer_delivery_id: context.deliveryId || "",
    leadminer_idempotency_key: context.idempotencyKey || "",
    received_at: context.capturedAt || new Date().toISOString(),
  };
  return {
    prospect_id: prospectId,
    status: workflowStatus,
    business_name: lead.business_name,
    ...(lead.email ? { email: lead.email } : {}),
    ...(lead.phone_e164 || lead.phone_national ? { phone: lead.phone_e164 || lead.phone_national } : {}),
    ...(lead.website_url ? { current_website: lead.website_url } : {}),
    ...(industry ? { industry } : {}),
    ...(lead.city ? { city: lead.city } : {}),
    ...(lead.state ? { state: lead.state } : {}),
    primary_services: services,
    ...(Number.isFinite(lead.opportunity_score) ? { leadminer_score: lead.opportunity_score } : {}),
    source: "leadminer_mirror_ready",
    canonical_place_id: lead.place_id,
    canonical_prospect_id: prospectId,
    identity_version: "prospect-identity-v1",
    record: {
      ...record,
      address: address || undefined,
    },
    updated_at: context.capturedAt || new Date().toISOString(),
    truth_packet: truthPacket,
    truth_packet_source: "leadminer_mirror_ready",
    blocked_reason: buildReady ? undefined : `mirror_ready_incomplete:${missing.join(",")}`,
    handoff: { state, buildReady, missing, truthPacket },
  };
}

async function readExactRawBody(req, maxBytes = MAX_BODY_BYTES) {
  if (typeof req?.on === "function") {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
          reject(contractError(400, "leadminer_raw_body_unavailable", "LeadMiner body must arrive as raw bytes"));
          req.destroy?.();
          return;
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
          reject(contractError(413, "leadminer_payload_too_large", "LeadMiner payload is too large"));
          req.destroy?.();
          return;
        }
        chunks.push(buffer);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
  if (Buffer.isBuffer(req?.body)) {
    if (req.body.length > maxBytes) throw contractError(413, "leadminer_payload_too_large", "LeadMiner payload is too large");
    return req.body;
  }
  if (req?.body instanceof Uint8Array) {
    const raw = Buffer.from(req.body);
    if (raw.length > maxBytes) throw contractError(413, "leadminer_payload_too_large", "LeadMiner payload is too large");
    return raw;
  }
  throw contractError(400, "leadminer_raw_body_unavailable", "LeadMiner body must arrive as raw bytes");
}

function deliveryJobId(idempotencyKey) {
  return `leadminer_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
}

function bodySha256(rawBody) {
  return createHash("sha256").update(rawBody).digest("hex");
}

module.exports = {
  EVENT_TYPE,
  HEADER_KEYS,
  MAX_BATCH,
  MAX_BODY_BYTES,
  SCHEMA_VERSION,
  SIGNATURE_TOLERANCE_SECONDS,
  bodySha256,
  buildTruthPacket,
  contractError,
  deliveryJobId,
  deterministicProspectId,
  leadToProspect,
  readExactRawBody,
  validateLeadBatch,
  validateLeadMinerHeaders,
  verifyLeadMinerSignature,
};
