import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import { assessMinimumContent, sanitizeContactFacts, sourceSafeEmail } from "./intake-content-gate.mjs";
import {
  buildCanonicalPacket,
  cacheKeyFor,
  deriveFacts,
  detectScope,
  evidenceForFacts,
  missingFactResponse,
  normalizeInput,
  validateCanonicalPacket,
  VERSION,
} from "./intake-genie-core.mjs";
import { factsFromDiscovery } from "./intake-genie.mjs";
import { sanitizeSourceAssets } from "./source-intake.mjs";

export const FIRST_PARTY_NO_PAID_POLICY = "first_party_no_paid_v1";
export const FIRST_PARTY_NO_PAID_MODE = "first_party_no_paid";
// Kept only so callers receive an explicit refusal instead of silently falling
// through to the ordinary remote compiler. A single legacy flag does not
// activate the bounded mode.
export const LOCAL_FIRST_PARTY_NO_PAID_MODE = "local_first_party_no_paid";

const LOCAL_IDEMPOTENCY = new Map();
const SHA256 = /^[a-f0-9]{64}$/i;
export const SOURCE_PACKET_ENVELOPE_SCHEMA = "wss.local-source-packet-envelope.v1";
export const SOURCE_PACKET_SCHEMA = "wss.local-source-packet.v1";
export const MAX_SOURCE_PACKET_PAGES = 40;
export const MAX_SOURCE_PACKET_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_ENVELOPE_DECODED_BYTES = 24 * 1024 * 1024;
const FORBIDDEN_CLIENT_PATH_FIELDS = [
  "evidence_root",
  "packet_path",
  "snapshot_path",
  "source_path",
];

function clean(value, limit = 300) {
  return String(value || "").trim().slice(0, limit);
}

function blocked(code, error, status = "blocked", extra = {}) {
  return {
    ok: false,
    version: VERSION,
    status,
    code,
    error,
    execution_policy: noPaidPolicy(),
    ...extra,
  };
}

function noPaidPolicy(receiptHash = "") {
  return {
    mode: FIRST_PARTY_NO_PAID_POLICY,
    source_mode: FIRST_PARTY_NO_PAID_MODE,
    local_source_packet_only: true,
    paid_provider_requests_allowed: false,
    automatic_paid_fallback: false,
    remote_source_requests_allowed: false,
    remote_image_probes_allowed: false,
    preview_build_allowed: false,
    source_packet_receipt_hash: receiptHash,
  };
}

function executionMode(rawInput = {}) {
  return clean(
    rawInput.execution_mode
      || rawInput.requirements?.execution_mode
      || rawInput.build_requirements?.execution_mode,
    40,
  );
}

export function requestsLocalFirstPartyNoPaid(rawInput = {}) {
  return rawInput.mode === FIRST_PARTY_NO_PAID_POLICY
    && rawInput.sourceMode === FIRST_PARTY_NO_PAID_MODE
    && rawInput.noPaid === true
    && rawInput.discoveryAllowed === false
    && rawInput.remotePagehubAllowed === false
    && rawInput.build_preview === false;
}

export function hasNoPaidIntent(rawInput = {}) {
  return rawInput.mode === FIRST_PARTY_NO_PAID_POLICY
    || rawInput.sourceMode === FIRST_PARTY_NO_PAID_MODE
    || rawInput.noPaid === true
    || rawInput.discoveryAllowed === false
    || rawInput.remotePagehubAllowed === false
    || executionMode(rawInput) === LOCAL_FIRST_PARTY_NO_PAID_MODE;
}

function invalidTuple() {
  return blocked(
    "invalid_no_paid_policy_tuple",
    "No-paid compilation requires the exact tuple: mode=first_party_no_paid_v1, sourceMode=first_party_no_paid, noPaid=true, discoveryAllowed=false, remotePagehubAllowed=false, build_preview=false.",
    400,
  );
}

function normalizedHost(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function sourceObservationUrls(discovery = {}) {
  return [...new Set([
    ...(Array.isArray(discovery.sources) ? discovery.sources : []),
    discovery.facts?.website,
  ].map((value) => clean(value)).filter(Boolean))];
}

function validateOfficialSourceBinding(input, loaded) {
  const officialUrl = clean(input.sources?.website_url);
  const officialHost = normalizedHost(officialUrl);
  if (!officialUrl || !isHttps(officialUrl) || !officialHost) {
    return "An explicit official first-party HTTPS website is required.";
  }
  if (input.sources?.gbp_url || input.sources?.social_url || input.sources?.asset_url) {
    return "No-paid mode accepts only the official website source; GBP, social, and asset-folder fallbacks are refused.";
  }

  const observed = sourceObservationUrls(loaded.discovery);
  if (!observed.length) return "The verified local packet has no source-page observations.";
  if (observed.some((url) => !isHttps(url) || normalizedHost(url) !== officialHost)) {
    return "Every source-page observation must be HTTPS and bound to the official website host.";
  }

  const assets = Array.isArray(loaded.discovery?.assets) ? loaded.discovery.assets : [];
  for (const asset of assets) {
    const provenanceUrl = clean(asset?.provenance?.source_url || asset?.meta?.source_url);
    if (!provenanceUrl || !isHttps(provenanceUrl) || normalizedHost(provenanceUrl) !== officialHost) {
      return "Every admitted asset must carry same-host first-party source-page provenance.";
    }
  }
  return "";
}

function validateLoadedPacket(loaded) {
  if (!loaded
    || loaded.ok !== true
    || loaded.transport_verified !== true
    || loaded.snapshot_hashes_verified !== true
    || loaded.identity_verified !== true) {
    return "The source-packet envelope verifier did not prove transport, snapshot hashes, and identity binding.";
  }
  if (!SHA256.test(clean(loaded.receipt_hash, 80))) {
    return "The verified local source packet must carry a SHA256 receipt hash.";
  }
  if (!loaded.discovery || typeof loaded.discovery !== "object" || Array.isArray(loaded.discovery)) {
    return "The verified local source packet has no normalized discovery payload.";
  }
  if (Number(loaded.discovery.summary?.pages_read || 0) < 1) {
    return "The verified local source packet contains no readable first-party page.";
  }
  return "";
}

function verificationError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = 422;
  return error;
}

function requireObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw verificationError(code);
  return value;
}

function requireText(value, code, limit = 1000) {
  const result = String(value || "").trim();
  if (!result || result.length > limit) throw verificationError(code);
  return result;
}

function requireSha(value, code) {
  const result = String(value || "");
  if (!/^[a-f0-9]{64}$/.test(result)) throw verificationError(code);
  return result;
}

function normalizedIdentity(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function canonicalSourceUrl(value, expectedHost = "") {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw verificationError("source_snapshot_url_invalid");
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !host) {
    throw verificationError("source_snapshot_url_invalid");
  }
  if (expectedHost && host !== expectedHost) throw verificationError("source_snapshot_identity_mismatch");
  parsed.hash = "";
  return parsed.href;
}

/** Decode a standard, padded, canonical base64 value and enforce byte length. */
function canonicalBase64Shape(value) {
  const n = value.length;
  if (n === 0 || n % 4 !== 0) return false;
  let pad = 0;
  if (value.charCodeAt(n - 1) === 61) pad = 1;
  if (pad === 1 && value.charCodeAt(n - 2) === 61) pad = 2;
  else if (pad === 0 && value.charCodeAt(n - 2) === 61) return false;
  if (pad === 1 && value.charCodeAt(n - 2) === 61 && value.charCodeAt(n - 3) === 61) return false;
  for (let i = 0; i < n - pad; i++) {
    const c = value.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47)) return false;
  }
  return true;
}
export function decodeCanonicalBase64(value, byteLength, code = "source_envelope_base64_invalid") {
  if (typeof value !== "string" || !canonicalBase64Shape(value)) {
    throw verificationError(code);
  }
  const expectedLength = Number(byteLength);
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 1) throw verificationError(`${code}_length`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length !== expectedLength) {
    throw verificationError(`${code}_canonical_mismatch`);
  }
  return bytes;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function provenanceRow(packet, pageShas, key) {
  const row = requireObject(packet.provenance?.[key], "source_packet_provenance_missing");
  const sourceUrl = canonicalSourceUrl(row.sourceUrl, normalizedHost(packet.sourceWebsite));
  const sourceSha = requireSha(row.sourceSha256, "source_packet_provenance_hash_invalid");
  if (!pageShas.get(sourceSha)?.has(sourceUrl)) throw verificationError("source_packet_provenance_snapshot_mismatch");
  requireText(row.method, "source_packet_provenance_method_missing", 160);
  return row;
}

function optionalFact(packet, pageShas, field) {
  const value = String(packet.facts?.[field] || "").trim();
  if (!value) return "";
  provenanceRow(packet, pageShas, field);
  return value;
}

function completeSourceDescription(value, maxChars = 700) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  const prefix = text.slice(0, maxChars);
  let end = 0;
  for (const match of prefix.matchAll(/[.!?](?=\s|$)/g)) end = match.index + 1;
  // A prefix without a complete sentence is not safe visitor prose.
  return end >= 20 ? prefix.slice(0, end).trim() : "";
}

function verifiedDiscovery(packet, pageUrls, pageShas, snapshotTextByUrl) {
  const content = requireObject(packet.content, "source_packet_content_missing");
  if (!Array.isArray(content.services) || !content.services.length) {
    throw verificationError("source_packet_services_missing");
  }
  const serviceNames = new Set();
  const contentPages = Array.isArray(content.pages) ? content.pages : [];
  const pageTextByUrl = new Map(contentPages.flatMap((page) => {
    if (!page || typeof page !== "object" || typeof page.text !== "string") return [];
    const url = canonicalSourceUrl(page.url, normalizedHost(packet.sourceWebsite));
    return pageUrls.includes(url) ? [[url, { text: page.text, title: String(page.title || "") }]] : [];
  }));
  const serviceObservations = [];
  const services = content.services.map((entry) => {
    const row = requireObject(entry, "source_packet_service_invalid");
    const name = requireText(row.name, "source_packet_service_name_missing", 120);
    const identity = normalizedIdentity(name);
    if (serviceNames.has(identity)) throw verificationError("source_packet_service_duplicate");
    serviceNames.add(identity);
    const provenance = provenanceRow(packet, pageShas, `service:${name}`);
    const description = completeSourceDescription(row.description);
    const sourceUrl = canonicalSourceUrl(provenance.sourceUrl, normalizedHost(packet.sourceWebsite));
    const page = pageTextByUrl.get(sourceUrl) || { text: "", title: "" };
    const nameExcerpt = page.text.includes(name) ? name : page.title.includes(name) ? page.title : "";
    if (description.length >= 20 && nameExcerpt && page.text.includes(description)) {
      serviceObservations.push({ name, source_url: sourceUrl,
        name_excerpt: nameExcerpt, description, description_excerpt: description,
        excerpt: nameExcerpt, evidence: nameExcerpt });
    }
    return { name, description };
  });

  const areas = Array.isArray(content.areas) ? content.areas.map((value) => {
    const area = requireText(value, "source_packet_area_invalid", 120);
    provenanceRow(packet, pageShas, `area:${area.replace(/,\s*[A-Z]{2}$/i, "")}`);
    return area;
  }) : [];
  const faqs = Array.isArray(content.faqs) ? content.faqs.map((entry) => {
    const row = requireObject(entry, "source_packet_faq_invalid");
    const question = requireText(row.question, "source_packet_faq_question_missing", 500);
    const answer = requireText(row.answer, "source_packet_faq_answer_missing", 3000);
    provenanceRow(packet, pageShas, `faq:${question}`);
    return { question, answer };
  }) : [];
  const about = String(content.about || "").trim();
  if (about) provenanceRow(packet, pageShas, "about");

  // Only literal content in the hash-verified HTML snapshot enters depth
  // channels. The packet miner may paraphrase a FAQ answer; provenance alone
  // does not make that paraphrase safe visitor copy.
  const depthChannels = {};
  const reviews = (Array.isArray(content.reviews) ? content.reviews : []).flatMap((row) => {
    const quote = String(row?.text || "").trim();
    const author = String(row?.author || "").trim();
    if (!quote || !author || quote.length > 500 || author.length > 120) return [];
    const provenance = provenanceRow(packet, pageShas, `review:${author}`);
    const source_url = canonicalSourceUrl(provenance.sourceUrl, normalizedHost(packet.sourceWebsite));
    const html = snapshotTextByUrl.get(source_url) || "";
    return html.includes(quote) && html.includes(author)
      ? [{ quote, author, source_url, evidence: quote, quote_excerpt: quote, author_excerpt: author }] : [];
  }).slice(0, 12);
  if (reviews.length) depthChannels.reviews = reviews;
  const observedFaqs = faqs.flatMap(({ question, answer }) => {
    if (question.length > 500 || answer.length > 500) return [];
    const provenance = provenanceRow(packet, pageShas, `faq:${question}`);
    const source_url = canonicalSourceUrl(provenance.sourceUrl, normalizedHost(packet.sourceWebsite));
    const html = snapshotTextByUrl.get(source_url) || "";
    return html.includes(question) && html.includes(answer)
      ? [{ question, answer, source_url, evidence: question,
        question_excerpt: question, answer_excerpt: answer }] : [];
  }).slice(0, 12);
  if (observedFaqs.length) depthChannels.faqs = observedFaqs;
  const observedAreas = areas.flatMap((value) => {
    const provenance = provenanceRow(packet, pageShas, `area:${value.replace(/,\s*[A-Z]{2}$/i, "")}`);
    const source_url = canonicalSourceUrl(provenance.sourceUrl, normalizedHost(packet.sourceWebsite));
    return (snapshotTextByUrl.get(source_url) || "").includes(value)
      ? [{ value, source_url, evidence: value }] : [];
  }).slice(0, 12);
  if (observedAreas.length) depthChannels.areas = observedAreas;

  const facts = requireObject(packet.facts, "source_packet_facts_missing");
  const businessName = requireText(facts.business_name, "source_packet_business_missing", 160);
  const website = canonicalSourceUrl(
    requireText(facts.current_website, "source_packet_website_missing", 1000),
    normalizedHost(packet.sourceWebsite),
  );
  const industry = requireText(facts.industry, "source_packet_industry_missing", 160);
  const city = requireText(facts.city, "source_packet_city_missing", 120);
  const state = requireText(facts.state, "source_packet_state_missing", 20);
  const phone = optionalFact(packet, pageShas, "phone");
  const email = sourceSafeEmail(optionalFact(packet, pageShas, "email"));

  // Mined page text is page-sha-bound official-source evidence; without it a
  // site whose homepage yields no about/areas cannot prove its own identity.
  const pageTexts = contentPages.flatMap((page) => {
    if (!page || typeof page !== "object") return [];
    const title = typeof page.title === "string" ? page.title : "";
    const text = typeof page.text === "string" ? page.text : "";
    return [title, text].filter(Boolean).map((value) => value.slice(0, 4000));
  });
  const copy = [
    about,
    ...services.flatMap((service) => [service.name, service.description]).filter(Boolean),
    ...areas,
    ...faqs.flatMap((faq) => [faq.question, faq.answer]),
    ...pageTexts,
  ].filter(Boolean).join("\n\n").slice(0, 18_000);
  return {
    sources: pageUrls,
    searched: [],
    facts: {
      name: businessName,
      website,
      category: industry,
      city,
      state,
      phone,
      email,
      services: services.map((service) => service.name),
    },
    found: {
      copy,
      services: services.map((service) => service.name),
      service_observations: serviceObservations,
      depth_channels: depthChannels,
      areas,
      faqs,
      contact: { phone, email, address: "" },
      logo: null,
      photos: [],
      videos: [],
      trust_marks: [],
      colors: [],
      fonts: [],
      socials: [],
    },
    // URL-only image candidates are not byte-proven assets in this transport.
    assets: [],
    files: [],
    image_inventory: [],
    navigation_pages: [],
    provenance: packet.provenance,
    sourceClaimsIndependentlyVerified: false,
    customerPublishApproved: false,
    summary: {
      mode: "local-source-packet-envelope",
      pages_read: pageUrls.length,
      services_found: services.length,
      photos_found: 0,
      videos_found: 0,
      logo_found: false,
      remote_requests: 0,
    },
  };
}

/**
 * Pure compiler-side verification of the proposed transport envelope. HTML is
 * decoded as fatal UTF-8 and hashed, but never parsed or treated as new facts.
 */
export async function verifySourcePacketEnvelope({ envelope, rawInput = {}, input = {} } = {}) {
  const sourceEnvelope = requireObject(envelope, "source_packet_envelope_required");
  if (sourceEnvelope.schema !== SOURCE_PACKET_ENVELOPE_SCHEMA) {
    throw verificationError("source_packet_envelope_schema_invalid");
  }
  const packetTransport = requireObject(sourceEnvelope.packet, "source_packet_transport_missing");
  if (packetTransport.encoding !== "base64") throw verificationError("source_packet_encoding_invalid");
  if (Number(packetTransport.byteLength) > MAX_SOURCE_PACKET_BYTES) throw verificationError("source_packet_too_large");
  const packetBytes = decodeCanonicalBase64(
    packetTransport.bytes,
    packetTransport.byteLength,
    "source_packet_base64_invalid",
  );
  const packetSha = requireSha(packetTransport.sha256, "source_packet_hash_invalid");
  if (sha256Bytes(packetBytes) !== packetSha) throw verificationError("source_packet_hash_mismatch");
  let packetText;
  try {
    packetText = new TextDecoder("utf-8", { fatal: true }).decode(packetBytes);
  } catch {
    throw verificationError("source_packet_utf8_invalid");
  }
  let packet;
  try {
    packet = JSON.parse(packetText);
  } catch {
    throw verificationError("source_packet_json_invalid");
  }
  requireObject(packet, "source_packet_json_invalid");
  if (packet.schema !== SOURCE_PACKET_SCHEMA) throw verificationError("source_packet_schema_invalid");
  requireObject(packet.facts, "source_packet_facts_missing");
  requireObject(packet.content, "source_packet_content_missing");
  requireObject(packet.provenance, "source_packet_provenance_missing");
  if (!Array.isArray(packet.missing) || !Array.isArray(packet.refused)) {
    throw verificationError("source_packet_audit_fields_missing");
  }
  if (packet.sourceClaimsIndependentlyVerified !== false || packet.customerPublishApproved !== false) {
    throw verificationError("source_packet_truth_flags_invalid");
  }
  const capturedAt = requireText(packet.capturedAt, "source_packet_captured_at_missing", 80);
  if (!Number.isFinite(Date.parse(capturedAt))) throw verificationError("source_packet_captured_at_invalid");
  const prospectId = requireText(rawInput.prospectId, "source_packet_prospect_required", 300);
  if (requireText(packet.prospectId, "source_packet_prospect_missing", 300) !== prospectId) {
    throw verificationError("source_packet_prospect_mismatch");
  }
  const officialWebsite = input.sources?.website_url || rawInput.website_url || rawInput.sources?.website_url;
  const officialHost = normalizedHost(officialWebsite);
  const sourceWebsite = canonicalSourceUrl(packet.sourceWebsite, officialHost);
  canonicalSourceUrl(officialWebsite, officialHost);
  const packetBusiness = requireText(packet.businessName, "source_packet_business_missing", 160);
  const factBusiness = requireText(packet.facts?.business_name, "source_packet_fact_business_missing", 160);
  if (normalizedIdentity(packetBusiness) !== normalizedIdentity(factBusiness)) {
    throw verificationError("source_packet_business_mismatch");
  }
  const hintedName = rawInput.prospect_hints?.name;
  if (hintedName && normalizedIdentity(hintedName) !== normalizedIdentity(packetBusiness)) {
    throw verificationError("source_packet_business_mismatch");
  }
  if (normalizedHost(packet.facts?.current_website) !== officialHost
    || normalizedHost(sourceWebsite) !== officialHost) {
    throw verificationError("source_packet_identity_mismatch");
  }

  const pages = packet.pages;
  const snapshots = sourceEnvelope.snapshots;
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_SOURCE_PACKET_PAGES) {
    throw verificationError("source_snapshot_evidence_required");
  }
  if (!Array.isArray(snapshots) || snapshots.length !== pages.length) {
    throw verificationError("source_snapshot_set_mismatch");
  }
  const pageKeys = new Set();
  const pageUrlsSeen = new Set();
  const pageShas = new Map();
  const pageUrls = pages.map((page) => {
    requireObject(page, "source_snapshot_record_invalid");
    const url = canonicalSourceUrl(page.url, officialHost);
    const sha = requireSha(page.sha256, "source_snapshot_record_invalid");
    const key = `${url}\n${sha}`;
    if (pageKeys.has(key) || pageUrlsSeen.has(url)) throw verificationError("source_snapshot_record_duplicate");
    pageKeys.add(key);
    pageUrlsSeen.add(url);
    if (!pageShas.has(sha)) pageShas.set(sha, new Set());
    pageShas.get(sha).add(url);
    return url;
  });

  let totalBytes = packetBytes.length;
  const snapshotKeys = new Set();
  const snapshotUrlsSeen = new Set();
  const snapshotTextByUrl = new Map();
  for (const snapshot of snapshots) {
    requireObject(snapshot, "source_snapshot_transport_invalid");
    if (snapshot.encoding !== "base64") throw verificationError("source_snapshot_encoding_invalid");
    const url = canonicalSourceUrl(snapshot.url, officialHost);
    const sha = requireSha(snapshot.sha256, "source_snapshot_hash_invalid");
    const key = `${url}\n${sha}`;
    if (snapshotKeys.has(key) || snapshotUrlsSeen.has(url)) throw verificationError("source_snapshot_transport_duplicate");
    snapshotKeys.add(key);
    snapshotUrlsSeen.add(url);
    if (!pageKeys.has(key)) throw verificationError("source_snapshot_set_mismatch");
    if (Number(snapshot.byteLength) > MAX_SOURCE_SNAPSHOT_BYTES) throw verificationError("source_snapshot_too_large");
    const bytes = decodeCanonicalBase64(
      snapshot.bytes,
      snapshot.byteLength,
      "source_snapshot_base64_invalid",
    );
    if (bytes.length < 100) throw verificationError("source_snapshot_html_too_small");
    totalBytes += bytes.length;
    if (totalBytes > MAX_SOURCE_ENVELOPE_DECODED_BYTES) throw verificationError("source_envelope_too_large");
    if (sha256Bytes(bytes) !== sha) throw verificationError("source_snapshot_hash_mismatch");
    try {
      // Validation only: never parse or extract from transported HTML here.
      snapshotTextByUrl.set(url, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw verificationError("source_snapshot_utf8_invalid");
    }
  }
  if (snapshotKeys.size !== pageKeys.size || [...pageKeys].some((key) => !snapshotKeys.has(key))) {
    throw verificationError("source_snapshot_set_mismatch");
  }

  const expectedCity = String(rawInput.prospect_hints?.city || "").trim();
  const expectedState = String(rawInput.prospect_hints?.state || "").trim();
  const expectedIndustry = String(rawInput.prospect_hints?.category || rawInput.category || rawInput.vertical || "").trim();
  if (!expectedCity || normalizedIdentity(packet.facts?.city) !== normalizedIdentity(expectedCity)) {
    throw verificationError("source_packet_city_mismatch");
  }
  if (!expectedState || normalizedIdentity(packet.facts?.state) !== normalizedIdentity(expectedState)) {
    throw verificationError("source_packet_state_mismatch");
  }
  if (!expectedIndustry || normalizedIdentity(packet.facts?.industry) !== normalizedIdentity(expectedIndustry)) {
    throw verificationError("source_packet_industry_mismatch");
  }

  return {
    ok: true,
    transport_verified: true,
    snapshot_hashes_verified: true,
    identity_verified: true,
    receipt_hash: packetSha,
    packet,
    discovery: verifiedDiscovery(packet, pageUrls, pageShas, snapshotTextByUrl),
  };
}

function clientPathField(rawInput = {}) {
  return FORBIDDEN_CLIENT_PATH_FIELDS.find((field) => clean(rawInput[field])) || "";
}

function missingFactsResult(input, facts, missing, scope, receiptHash) {
  const common = {
    scope: { supported: true, category: scope.category, message: "" },
    facts,
    evidence: evidenceForFacts(input, facts),
    cache: { hits: 0, misses: 0, key: cacheKeyFor(input), bypassed: true },
    execution_policy: noPaidPolicy(receiptHash),
  };
  if (missing.length === 1) {
    return {
      ok: true,
      version: VERSION,
      status: "needs_input",
      ...missingFactResponse(missing),
      ...common,
    };
  }
  return blocked(
    "first_party_facts_incomplete",
    "More source-bound business facts are needed before a packet can be compiled.",
    "blocked",
    { ...common, missing_facts: missing },
  );
}

/**
 * Compile exclusively from a packet returned by the trusted source-packet
 * envelope verifier. This function contains no discovery, fetch, image-probe, preview,
 * provider, or cache-write path.
 *
 * The verifier is an integration boundary. It must hash the exact transported
 * packet bytes and snapshot bytes, apply the canonical source identity rules,
 * reject path-based evidence, and return:
 *   { ok:true, transport_verified:true, snapshot_hashes_verified:true,
 *     identity_verified:true, receipt_hash:<sha256>, discovery:<normalized> }
 */
export async function compileLocalFirstPartyNoPaid(rawInput = {}, options = {}) {
  if (!requestsLocalFirstPartyNoPaid(rawInput)) {
    return invalidTuple();
  }
  if (rawInput.dry_run === false || rawInput.dryRun === false) {
    return blocked(
      "no_paid_source_only_operation",
      "No-paid mode requires build_preview=false and may only perform a dry-run packet compile.",
      422,
    );
  }
  if (Array.isArray(rawInput._files) && rawInput._files.length) {
    return blocked(
      "unverified_file_input_refused",
      "No-paid mode accepts evidence only through the verified local source packet.",
      422,
    );
  }
  const suppliedPath = clientPathField(rawInput);
  if (suppliedPath) {
    return blocked(
      "client_path_refused",
      `${suppliedPath} is server-derived and must not be supplied by the caller.`,
      400,
    );
  }
  if (!rawInput.sourcePacketEnvelope || typeof rawInput.sourcePacketEnvelope !== "object" || Array.isArray(rawInput.sourcePacketEnvelope)) {
    return blocked(
      "source_packet_envelope_required",
      "The no-paid request contains no transported local source-packet envelope; remote fallback is refused.",
      422,
    );
  }
  if (typeof options.verifySourcePacketEnvelope !== "function") {
    return blocked(
      "source_packet_envelope_verifier_unavailable",
      "The compiler source-packet envelope verifier is not installed; remote fallback is refused.",
      503,
    );
  }

  let input;
  try {
    input = normalizeInput(rawInput, { allowPrivate: false });
  } catch (error) {
    return blocked("invalid_no_paid_input", error.message || String(error), Number(error.status) || 400);
  }

  let loaded;
  try {
    loaded = await options.verifySourcePacketEnvelope({
      envelope: rawInput.sourcePacketEnvelope,
      rawInput,
      input,
    });
  } catch (error) {
    return blocked(
      "local_source_packet_rejected",
      error.message || "The canonical local source packet could not be verified.",
      422,
    );
  }
  const packetError = validateLoadedPacket(loaded);
  if (packetError) return blocked("local_source_packet_rejected", packetError, 422);
  const bindingError = validateOfficialSourceBinding(input, loaded);
  if (bindingError) return blocked("first_party_binding_rejected", bindingError, 422);

  let { facts, missing, scope } = deriveFacts(input);
  if (!scope.supported) {
    return {
      ok: true,
      version: VERSION,
      status: "out_of_scope",
      scope,
      facts,
      evidence: evidenceForFacts(input, facts),
      cache: { hits: 0, misses: 0, key: cacheKeyFor(input), bypassed: true },
      warnings: ["out_of_scope", FIRST_PARTY_NO_PAID_POLICY],
      execution_policy: noPaidPolicy(loaded.receipt_hash),
    };
  }

  const discovery = loaded.discovery;
  facts = factsFromDiscovery(input, facts, discovery);
  missing = [];
  if (!facts.name) missing.push("name");
  if (!facts.city || !facts.state) missing.push("location");
  if (!facts.category) missing.push("trade");
  scope = detectScope({ ...input, prospect_hints: { ...input.prospect_hints, category: facts.category } });
  // Genuine identity conflict (owner law 2026-09-19): refuse for human
  // confirmation rather than silently building either company's site.
  if (facts.name_conflict) {
    return blocked("first_party_identity_conflict", "The business name supplied conflicts with the business's own website identity. Confirm which is correct.", 422, {
      scope,
      facts,
      name_conflict: facts.name_conflict,
    });
  }
  if (missing.length) return missingFactsResult(input, facts, missing, scope, loaded.receipt_hash);
  if (!scope.supported) {
    return blocked("first_party_scope_unsupported", scope.message || "The source business is out of scope.", 422, {
      scope,
      facts,
    });
  }

  const minimumContent = assessMinimumContent({ input, facts, discovery });
  if (!minimumContent.ok) {
    return blocked(minimumContent.code || "first_party_content_incomplete", minimumContent.reason, 422, {
      scope: { supported: true, category: scope.category, message: "" },
      facts,
      evidence: evidenceForFacts(input, facts),
      cache: { hits: 0, misses: 0, key: cacheKeyFor(input), bypassed: true },
    });
  }
  facts = sanitizeContactFacts(facts, minimumContent.source_contact);
  if (facts.services_source !== "extracted" || !Array.isArray(facts.services) || !facts.services.length) {
    return blocked(
      "source_bound_services_required",
      "No-paid mode refuses category-default services; the verified first-party packet must prove at least one service.",
      422,
      { facts },
    );
  }

  const evidence = evidenceForFacts(input, facts, minimumContent.source_contact);
  const assets = sanitizeSourceAssets(discovery.assets || []);
  const packet = buildCanonicalPacket({
    input,
    facts,
    discovery,
    evidence,
    assets,
    preview: {},
    cache: { hits: 0, misses: 0, key: cacheKeyFor(input), bypassed: true },
    warnings: [FIRST_PARTY_NO_PAID_POLICY, "remote_fallback_refused", "cache_bypassed"],
  });
  if (packet.facts?.services_source !== "source_bound") {
    return blocked(
      "source_bound_services_required",
      "Canonical packet construction could not bind its services to first-party source observations.",
      422,
      { packet },
    );
  }
  const validation = validateCanonicalPacket(packet);
  if (!validation.ok) {
    return blocked(
      "canonical_packet_validation_failed",
      `Canonical packet validation failed: ${validation.errors.join(", ")}`,
      422,
      { packet },
    );
  }
  return {
    ...packet,
    execution_policy: noPaidPolicy(loaded.receipt_hash),
  };
}

function requestFingerprint(body = {}) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * Candidate adapter for the existing Intake Genie module. Default requests are
 * delegated byte-for-byte to the current compiler. Only the explicit execution
 * mode above enters the local packet compiler.
 */
export function createNoPaidCompilerOverlay(upstream, dependencies = {}) {
  if (!upstream || typeof upstream.compileFromInput !== "function" || typeof upstream.compileMachineRequest !== "function") {
    throw new TypeError("The existing Intake Genie compiler module is required.");
  }
  const envelopeVerifier = dependencies.verifySourcePacketEnvelope || verifySourcePacketEnvelope;
  return {
    ...upstream,
    async compileFromInput(rawInput = {}, options = {}) {
      if (!hasNoPaidIntent(rawInput)) return upstream.compileFromInput(rawInput, options);
      if (!requestsLocalFirstPartyNoPaid(rawInput)) return invalidTuple();
      return compileLocalFirstPartyNoPaid(rawInput, {
        ...options,
        verifySourcePacketEnvelope: options.verifySourcePacketEnvelope || envelopeVerifier,
      });
    },
    async compileMachineRequest(req, body = {}) {
      if (!hasNoPaidIntent(body)) return upstream.compileMachineRequest(req, body);
      if (!requestsLocalFirstPartyNoPaid(body)) return invalidTuple();
      const idem = clean(req?.headers?.["idempotency-key"] || body.request_id, 300);
      if (!idem) return blocked("idempotency_key_required", "Idempotency-Key is required.", 400);
      const fingerprint = requestFingerprint(body);
      const prior = LOCAL_IDEMPOTENCY.get(idem);
      if (prior && prior.fingerprint !== fingerprint) {
        return blocked("idempotency_conflict", "Idempotency-Key was already used for a different request.", 409);
      }
      if (prior) return prior.result;
      const result = await compileLocalFirstPartyNoPaid(body, { verifySourcePacketEnvelope: envelopeVerifier });
      LOCAL_IDEMPOTENCY.set(idem, { fingerprint, result });
      return result;
    },
  };
}
