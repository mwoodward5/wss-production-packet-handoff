"use strict";

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const { hashObject } = require("./http");
const { firstValue, prospectId } = require("./prospects");
const { registrableDomain } = require("./proof-storage");
const { serviceCandidateReason } = require("./mirror-engine/service-harvest");

const VERSION = "intake-genie-v2";
const CONTENT_CERT_VERSION = "intake-genie-content-cert-v1";
// Upgrade known stale Line epochs at the HTTP seam so production cannot reuse
// a pre-v7 compiler result after the category/provenance contract changed.
const PIPELINE_VERSION = "line-genie-certified-v7";
const CERTIFIED_PRACTICE_PACKET_SCHEMA = "CertifiedPracticePacket/v1";
const CATEGORY_FAMILY_ALIASES = new Map(Object.entries({
  plumber: "plumbing", plumbers: "plumbing", "plumbing contractor": "plumbing",
  roofer: "roofing", roofers: "roofing", "roofing contractor": "roofing",
  dentist: "dental", dentists: "dental",
  electrician: "electrical", electricians: "electrical", "electrical contractor": "electrical",
  "heating and air": "hvac", "air conditioning": "hvac", "hvac contractor": "hvac",
  "air conditioning contractor": "hvac", "heating contractor": "hvac",
  lawyer: "attorney", "law firm": "attorney", "legal services": "attorney", "solo attorney": "attorney",
  landscaper: "landscaping", hardscaping: "landscaping",
  arborist: "tree service", arborists: "tree service", "tree removal": "tree service",
  remodeler: "home remodeling", "remodeling contractor": "home remodeling",
  "general contracting": "general contractor", construction: "general contractor", "construction company": "general contractor", carpentry: "general contractor",
  "medical spa": "med spa", medspa: "med spa",
  "tattoo artist": "tattoo", "tattoo artists": "tattoo", "tattoo shop": "tattoo", "tattoo studio": "tattoo",
  photography: "photographer", piercer: "piercing", "piercing studio": "piercing",
  "massage therapist": "massage", "hair salons": "hair salon", barbershop: "barber", "barber shop": "barber",
  "nail salon": "nail studio", "nail salons": "nail studio",
  realtor: "real estate agent", realtors: "real estate agent", realty: "real estate agent",
  "car detailing": "auto detailing", detailer: "auto detailing",
  "ceramic coatings": "ceramic coating", "water damage": "water damage restoration", restoration: "water damage restoration",
  "concrete contractor": "concrete", mason: "masonry", "fence contractor": "fencing",
  "garage doors": "garage door", exterminator: "pest control", "tree care": "tree service",
}));
const SOURCE_FIELDS = Object.freeze({
  website_url: ["current_website", "currentWebsite", "website", "website_url", "url"],
  // gbp_url is deliberately ABSENT here (owner directive 2026-09-01: "we dont
  // need to use the gmb url for packet creation"). A Google Maps place page is
  // not a compilable source — feeding it to the Genie produced the
  // intake_genie_compile_retryable churn. EXCEPT the website-less lane: when a
  // prospect has no website at all, the maps link remains its only source
  // (mark 2026-07-20 no-website lane). See sourceUrls() below.
  social_url: ["social_url", "socialUrl"],
  instagram_url: ["instagram_url", "instagramUrl"],
  facebook_url: ["facebook_url", "facebookUrl"],
  yelp_url: ["yelp_url", "yelpUrl"],
  asset_url: ["asset_url", "assetUrl", "drive_url", "photos_url"],
});
let lastStatus = {
  configured: false,
  reachable: null,
  contractVersion: VERSION,
  lastSuccessfulCall: "",
  lastCheckedAt: "",
  lastError: "",
  canonicalModeEnabled: true,
};

function clean(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function decodeHtmlText(value) {
  return String(value == null ? "" : value)
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x27;/gi, "'");
}

function decodedFirstValue(source, aliases) {
  const raw = firstValue(source, aliases);
  return raw ? decodeHtmlText(raw) : raw;
}

function effectivePipelineVersion(value) {
  const requested = clean(value, "");
  return (!requested
    || requested === "line-genie-certified-v5"
    || requested === "line-genie-certified-v6")
    ? PIPELINE_VERSION
    : requested;
}

function refusalProblems(packet = {}) {
  return Array.isArray(packet?.problems) ? packet.problems : [];
}

function refusalError(packet = {}, status = "") {
  const base = clean(packet?.error || packet?.message || packet?.code, "")
    || `intake_genie_http_${status}`;
  const problems = refusalProblems(packet);
  if (!problems.length) return base;
  // Keep the compiler's structured array separately, and also carry a bounded
  // rendering into `error` because the current line coordinator persists only
  // that field as its candidate-local refusal reason.
  return `${base}; problems=${JSON.stringify(problems).slice(0, 1200)}`;
}

function normalizedHost(value) {
  return registrableDomain(value);
}

function normalizedIdentity(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const BUSINESS_NAME_SUFFIXES = new Set([
  "and", "the", "co", "company", "corp", "corporation", "inc", "incorporated",
  "llc", "llp", "lp", "ltd", "limited", "pa", "pc", "plc", "pllc",
]);
const DOTTED_BUSINESS_SUFFIXES = Object.freeze([
  ["p", "l", "l", "c"], ["l", "l", "c"], ["l", "l", "p"], ["i", "n", "c"],
  ["l", "t", "d"], ["c", "o"], ["l", "p"], ["p", "a"], ["p", "c"],
]);
const US_STATE_NAMES = Object.freeze({
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas",
  ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts",
  mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico",
  ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  dc: "district of columbia",
});

function businessNameTokens(value) {
  return normalizedIdentity(value).split(" ")
    .filter((token) => token && !BUSINESS_NAME_SUFFIXES.has(token));
}

function normalizedBusinessTokens(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean);
}

function normalizedLocation(value) {
  return normalizedBusinessTokens(value).join(" ");
}

function normalizedState(value) {
  const tokens = normalizedBusinessTokens(value);
  const compact = tokens.length > 1 && tokens.every((token) => token.length === 1)
    ? tokens.join("")
    : tokens.join(" ");
  if (US_STATE_NAMES[compact]) return compact;
  return Object.entries(US_STATE_NAMES).find(([, name]) => name === compact)?.[0] || compact;
}

function endsWithTokens(tokens, suffix) {
  return suffix.length <= tokens.length
    && suffix.every((token, index) => token === tokens[tokens.length - suffix.length + index]);
}

function containsTokens(container, candidate) {
  if (!candidate.length || candidate.length > container.length) return false;
  for (let offset = 0; offset <= container.length - candidate.length; offset += 1) {
    if (candidate.every((token, index) => token === container[offset + index])) return true;
  }
  return false;
}

// Location-bridge tolerance: a miner-harvested pick commonly inserts the
// prospect's own city into an otherwise identical brand ("Elite AC & Plumbing"
// vs "Elite Austin AC & Plumbing"). While scanning the container tokens for
// the candidate sequence, only the prospect's own location tokens may be
// skipped — a different city or any non-location word still breaks
// contiguity. Bounded so a name can never bridge arbitrary content: at most
// two skipped location tokens per gap and three per match.
const LOCATION_BRIDGE_MAX_GAP_TOKENS = 2;
const LOCATION_BRIDGE_MAX_TOTAL_TOKENS = 3;

function locationBridgeTokens(locations = []) {
  const tokens = new Set();
  for (const row of (Array.isArray(locations) ? locations : [locations])) {
    for (const token of normalizedBusinessTokens(row?.city)) tokens.add(token);
    const stateKey = normalizedState(row?.state);
    if (stateKey) tokens.add(stateKey);
    const stateName = US_STATE_NAMES[stateKey];
    if (stateName) {
      for (const token of normalizedBusinessTokens(stateName)) tokens.add(token);
    }
  }
  return tokens;
}

function containsTokensWithLocationBridge(container, candidate, bridgeTokens) {
  if (!bridgeTokens || !bridgeTokens.size) return containsTokens(container, candidate);
  if (!candidate.length || candidate.length > container.length) return false;
  for (let offset = 0; offset + candidate.length <= container.length; offset += 1) {
    let index = offset;
    let matched = 0;
    let gapSkips = 0;
    let totalSkips = 0;
    while (index < container.length && matched < candidate.length) {
      if (container[index] === candidate[matched]) {
        matched += 1;
        index += 1;
        gapSkips = 0;
        continue;
      }
      if (matched > 0
        && bridgeTokens.has(container[index])
        && gapSkips < LOCATION_BRIDGE_MAX_GAP_TOKENS
        && totalSkips < LOCATION_BRIDGE_MAX_TOTAL_TOKENS) {
        gapSkips += 1;
        totalSkips += 1;
        index += 1;
        continue;
      }
      break;
    }
    if (matched === candidate.length) return true;
  }
  return false;
}

function locationTokenTails(locations = []) {
  const tails = [];
  for (const row of (Array.isArray(locations) ? locations : [locations])) {
    const city = normalizedBusinessTokens(row?.city);
    const rawState = normalizedBusinessTokens(row?.state);
    const stateKey = normalizedState(row?.state);
    const abbreviation = stateKey && US_STATE_NAMES[stateKey] ? [stateKey] : [];
    const fullState = stateKey && US_STATE_NAMES[stateKey]
      ? normalizedBusinessTokens(US_STATE_NAMES[stateKey])
      : rawState;
    if (city.length && rawState.length) tails.push([...city, ...rawState]);
    if (city.length && fullState.length) tails.push([...city, ...fullState]);
    if (city.length && abbreviation.length) tails.push([...city, ...abbreviation]);
    if (city.length) tails.push(city);
    if (rawState.length) tails.push(rawState);
    if (fullState.length) tails.push(fullState);
    if (abbreviation.length) tails.push(abbreviation);
  }
  return [...new Map(tails.filter((row) => row.length).map((row) => [row.join(" "), row])).values()]
    .sort((left, right) => right.length - left.length);
}

function normalizeBusinessName(value, locations = []) {
  let tokens = normalizedBusinessTokens(value);
  if (tokens[0] === "the") tokens = tokens.slice(1);
  const locationTails = locationTokenTails(locations);
  let changed = true;
  while (tokens.length && changed) {
    changed = false;
    const dottedSuffix = DOTTED_BUSINESS_SUFFIXES.find((suffix) => endsWithTokens(tokens, suffix));
    if (dottedSuffix) {
      tokens = tokens.slice(0, -dottedSuffix.length);
      changed = true;
    }
    while (tokens.length && BUSINESS_NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
      tokens.pop();
      changed = true;
    }
    const tail = locationTails.find((candidate) => endsWithTokens(tokens, candidate));
    if (tail) {
      tokens = tokens.slice(0, -tail.length);
      changed = true;
    }
  }
  return tokens.join(" ");
}

function canonicalBusinessTokens(value, locations = []) {
  const tokens = normalizeBusinessName(value, locations).split(" ").filter(Boolean);
  const canonical = [];
  let fragments = [];
  const flush = () => {
    if (!fragments.length) return;
    canonical.push(fragments.join(""));
    fragments = [];
  };
  for (const token of tokens) {
    // HVAC businesses commonly self-name with "AC" while their first-party
    // page spells out "Air Conditioning". Expand only that exact whole token;
    // unrelated trade descriptors still must satisfy the containment guard.
    if (token === "ac") {
      flush();
      canonical.push("air", "conditioning");
      continue;
    }
    if (token.length === 1) fragments.push(token);
    else {
      flush();
      canonical.push(token);
    }
  }
  flush();
  return canonical;
}

function locationContextsConflict(locations = []) {
  const rows = (Array.isArray(locations) ? locations : [locations]).filter(Boolean);
  const cities = new Set(rows.map((row) => normalizedLocation(row?.city)).filter(Boolean));
  const states = new Set(rows.map((row) => normalizedState(row?.state)).filter(Boolean));
  return cities.size > 1 || states.size > 1;
}

// The prospect's own city/state, reused by every name-compatibility call that
// must tolerate local-branding insertions ("Elite AC & Plumbing" vs the
// miner-harvested "Elite Austin AC & Plumbing").
function prospectLocations(prospect = {}) {
  return [{
    city: firstValue(prospect, ["city", "market"]),
    state: firstValue(prospect, ["state", "region"]),
  }];
}

function compatibleBusinessName(left, right, locations = []) {
  const normalizedLeft = normalizedIdentity(left);
  const normalizedRight = normalizedIdentity(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (locationContextsConflict(locations)) return false;
  const leftCanonical = canonicalBusinessTokens(left, locations);
  const rightCanonical = canonicalBusinessTokens(right, locations);
  if (!leftCanonical.length || !rightCanonical.length) return false;
  if (leftCanonical.join(" ") === rightCanonical.join(" ")) return true;
  // Admit only whole-token containment. This covers a durable brand plus a
  // descriptor ("Acme" vs "Acme Roofing") without admitting a shared prefix
  // between two different offers ("Acme Roofing" vs "Acme Plumbing"). The
  // prospect's own city/state tokens may bridge the sequence (see
  // containsTokensWithLocationBridge); any other inserted word still refuses.
  const bridgeTokens = locationBridgeTokens(locations);
  if (containsTokensWithLocationBridge(leftCanonical, rightCanonical, bridgeTokens)
    || containsTokensWithLocationBridge(rightCanonical, leftCanonical, bridgeTokens)) return true;
  if (leftCanonical.join("") === rightCanonical.join("")) return true;

  // Preserve the measured legacy alias that does not form a contiguous token
  // sequence ("... Solutions" vs "... & Air"). It remains source-bound below.
  const leftBusinessTokens = businessNameTokens(left);
  const rightBusinessTokens = businessNameTokens(right);
  const leftTokens = [...new Set(leftBusinessTokens)];
  const rightTokens = [...new Set(rightBusinessTokens)];
  if (leftTokens.length < 2 || rightTokens.length < 2 || leftTokens[0] !== rightTokens[0]) return false;
  if (leftBusinessTokens.join(" ") === rightBusinessTokens.join(" ")) return true;
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  // A first-party page may use the durable legal brand while GBP appends a
  // long service/locality descriptor. Four ordered brand tokens are narrow
  // enough to distinguish a real owner alias from a shared two-word prefix.
  if (shorter.length >= 4 && shorter.every((token, index) => token === longer[index])) return true;
  // Measured legal/GBP shape: "Complete Plumbing and Electric Solutions LLC"
  // vs "Complete Plumbing, Electric & Air". Admit only this narrow trailing
  // descriptor swap after three identical ordered brand tokens. Unordered 75%
  // overlap was too broad: changing Air to Gas still certified a different
  // source-bound name.
  let prefix = 0;
  while (prefix < leftTokens.length && prefix < rightTokens.length
    && leftTokens[prefix] === rightTokens[prefix]) prefix += 1;
  if (prefix >= 3 && leftTokens.length === prefix + 1 && rightTokens.length === prefix + 1) {
    return [leftTokens[prefix], rightTokens[prefix]].sort().join("|") === "air|solutions";
  }
  return false;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function packetSha256(packet = {}) {
  return createHash("sha256").update(canonicalJson(packet)).digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function categoryFamily(value) {
  const normalized = normalizedIdentity(value);
  return CATEGORY_FAMILY_ALIASES.get(normalized) || normalized;
}

function authorizedProspectCategory(prospect = {}) {
  const record = objectValue(prospect.record);
  const durable = durableTruthHints(prospect);
  const explicit = {
    ...canonicalOwnerCorrections(record.owner_corrections),
    ...canonicalOwnerCorrections(prospect.owner_corrections),
    ...canonicalOwnerCorrections(prospect.corrections),
  };
  const corrections = normalizeCorrections({
    ...durable.corrections,
    ...explicit,
  });
  return clean(corrections.category, "") || firstValue(prospect, [
    "industry", "category", "vertical", "trade", "primary_type",
  ]);
}

/**
 * Validate the only compiler prose contract Mirror may render.
 *
 * Legacy `content.content_files` and Packet2 builder instructions are not
 * aliases for this contract. Every public byte must live under visitor_copy,
 * be covered by its own lowercase SHA-256, and pass the compiler's public-copy
 * safety result. The enclosing receipt subsequently signs the whole packet.
 */
function certifiedPracticeVisitorCopy(packet = {}) {
  const content = packet?.content && typeof packet.content === "object" && !Array.isArray(packet.content)
    ? packet.content
    : {};
  const direct = content.content_contract && typeof content.content_contract === "object"
    && !Array.isArray(content.content_contract)
    ? content.content_contract
    : null;
  const packet2Candidate = packet?.packet2?.compiled?.contentContract;
  const packet2 = packet2Candidate && typeof packet2Candidate === "object" && !Array.isArray(packet2Candidate)
    ? packet2Candidate
    : null;
  if (direct && packet2 && canonicalJson(direct) !== canonicalJson(packet2)) {
    return { ok: false, reason: "certified_practice_contract_conflict", files: {} };
  }
  const contract = direct || packet2;
  if (!contract
    || contract.schema !== CERTIFIED_PRACTICE_PACKET_SCHEMA
    || contract.kind !== "certified_practice_packet"
    || contract.version !== 1
    || contract.builder_instructions?.public !== false) {
    return { ok: false, reason: "certified_practice_contract_invalid", files: {} };
  }
  const visitor = contract.visitor_copy;
  if (!visitor || typeof visitor !== "object" || Array.isArray(visitor)
    || visitor.kind !== "visitor_copy"
    || visitor.safety?.pass !== true
    || !Array.isArray(visitor.safety?.violations)
    || visitor.safety.violations.length !== 0) {
    return { ok: false, reason: "certified_practice_visitor_copy_unsafe", files: {} };
  }
  const files = visitor.files;
  const hashes = visitor.file_hashes;
  if (!files || typeof files !== "object" || Array.isArray(files)
    || !hashes || typeof hashes !== "object" || Array.isArray(hashes)) {
    return { ok: false, reason: "certified_practice_visitor_files_invalid", files: {} };
  }
  const filePaths = Object.keys(files).sort();
  const hashPaths = Object.keys(hashes).sort();
  if (!filePaths.length || canonicalJson(filePaths) !== canonicalJson(hashPaths)) {
    return { ok: false, reason: "certified_practice_visitor_hash_set_mismatch", files: {} };
  }
  for (const filePath of filePaths) {
    const body = files[filePath];
    const expected = hashes[filePath];
    const safePath = typeof filePath === "string"
      && !filePath.includes("\\")
      && !filePath.split("/").includes("..")
      && /^[a-z0-9][a-z0-9._/-]*$/i.test(filePath);
    if (!safePath || typeof body !== "string" || !/^[0-9a-f]{64}$/.test(String(expected || ""))) {
      return { ok: false, reason: "certified_practice_visitor_file_invalid", files: {} };
    }
    if (sha256(body) !== expected) {
      return { ok: false, reason: "certified_practice_visitor_hash_mismatch", files: {} };
    }
    // Visitor copy is Markdown/JSON, never an executable document. Keep a
    // final consumer-side stop even when an upstream safety scanner regresses.
    if (/(?:<\s*\/?\s*[a-z][^>]*>|(?:java|vb)script\s*:|data\s*:|!\[[^\]]*\]\([^)]*\)|[\u202a-\u202e\u2066-\u2069])/i.test(body)) {
      return { ok: false, reason: "certified_practice_visitor_markup_unsafe", files: {} };
    }
  }
  const contractFacts = contract.facts && typeof contract.facts === "object" && !Array.isArray(contract.facts)
    ? contract.facts
    : {};
  const category = clean(contractFacts.category, "");
  const vertical = clean(contractFacts.vertical, "");
  if (!category && !vertical) {
    return { ok: false, reason: "certified_practice_category_missing", files: {} };
  }
  if (category && vertical && categoryFamily(category) !== categoryFamily(vertical)) {
    return { ok: false, reason: "certified_practice_category_conflict", files: {} };
  }
  return {
    ok: true,
    contract,
    files: Object.fromEntries(filePaths.map((filePath) => [filePath, files[filePath]])),
    category: category || vertical,
    category_family: categoryFamily(category || vertical),
  };
}

function pageHubVisitorQualityProblem(packet = {}) {
  // A PageHub import carries the exact Packet2 snapshot. Its public copy must
  // have passed the aggregate and per-file checks before this bridge signs it.
  const compiled = packet?.packet2?.compiled;
  if (!compiled || !compiled.contentContract) return "";
  const quality = compiled.contentQuality;
  const directQuality = packet?.content?.content_quality;
  if (!quality || !directQuality || canonicalJson(quality) !== canonicalJson(directQuality)) {
    return "pagehub_content_quality_missing_or_conflicting";
  }
  const files = compiled.contentContract?.visitor_copy?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return "pagehub_visitor_quality_invalid";
  }
  const names = Object.keys(files);
  const visitor = quality.visitor;
  const rows = visitor?.files;
  if (quality.status !== "pass" || visitor?.totalFiles !== names.length
    || visitor?.passCount !== names.length
    || quality.totalFiles !== names.length || quality.passCount !== names.length
    || quality.reviewCount !== 0 || !Array.isArray(rows) || rows.length !== names.length) {
    return "pagehub_visitor_quality_not_passed";
  }
  const seen = new Set();
  for (const row of rows) {
    if (!row || !names.includes(row.sourcePath) || seen.has(row.sourcePath)
      || row.status !== "pass" || !Array.isArray(row.reasons) || row.reasons.length) {
      return "pagehub_visitor_quality_not_passed";
    }
    seen.add(row.sourcePath);
  }
  return "";
}

function certificationKey(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "signingKey") && options.signingKey !== undefined) {
    return clean(options.signingKey, "");
  }
  return clean(
    process.env.INTAKE_GENIE_CERTIFICATION_KEY,
    "",
  );
}

function certificationPayload(receipt = {}) {
  return canonicalJson({
    version: receipt.version,
    status: receipt.status,
    scope: receipt.scope,
    issuer: receipt.issuer,
    packet_version: receipt.packet_version,
    packet_sha256: receipt.packet_sha256,
    packet_location: receipt.packet_location,
    prospect_id: receipt.prospect_id,
    identity: receipt.identity,
    evidence: receipt.evidence,
    request_id: receipt.request_id,
    job_id: receipt.job_id,
    idempotency_key_sha256: receipt.idempotency_key_sha256,
    source_set_sha256: receipt.source_set_sha256,
    fast_pass: receipt.fast_pass,
    preserved_gates: receipt.preserved_gates,
    certified_at: receipt.certified_at,
    expires_at: receipt.expires_at,
  });
}

function signCertification(receipt, key) {
  return createHmac("sha256", key).update(certificationPayload(receipt)).digest("hex");
}

function evidenceUrls(packet = {}) {
  const rows = [packet.evidence, packet.service_evidence].filter(Array.isArray).flat();
  return [...new Set(rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const nested = row.source && typeof row.source === "object" ? row.source : {};
    return [row.source_url, nested.url, typeof row.source === "string" ? row.source : "", row.url]
      .map((value) => String(value || "").trim())
      .filter((value) => /^https?:\/\//i.test(value));
  }))];
}

function canonicalServices(packet = {}) {
  const facts = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  const content = packet.content && typeof packet.content === "object" ? packet.content : {};
  const keys = ["services", "service_list", "primary_services", "primaryServices"];
  return [facts, packet, content].flatMap((container) => keys.map((key) => container[key]))
    .filter(Array.isArray)
    .flat()
    .map(serviceName)
    .filter(Boolean);
}

function categoryDefaultEstimate(packet = {}) {
  const facts = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  if (normalizedIdentity(facts.services_source) !== "category default") {
    return { ok: false, services: [] };
  }
  if (facts.services_default_disqualified === true) {
    return { ok: false, services: [] };
  }
  const content = packet.content && typeof packet.content === "object" ? packet.content : {};
  if (Array.isArray(content.services) && content.services.length > 0) {
    return { ok: false, services: [] };
  }
  const serviceRows = [packet.evidence, packet.service_evidence].filter(Array.isArray).flat()
    .filter((row) => row && typeof row === "object" && !Array.isArray(row)
      && ["service", "services"].includes(normalizedIdentity(row.field || row.type)));
  const isEstimate = (row) => normalizedIdentity(row.source_type) === "category default"
    && normalizedIdentity(row.provenance) === "estimated"
    && normalizedIdentity(row.verification_status) === "estimated"
    && row.verified !== true
    && normalizedIdentity(row.status) !== "verified"
    && evidenceUrls({ evidence: [row] }).length === 0;
  // Defaults may fill a genuine absence. They may never launder a present
  // wrong-domain, hint-only, or otherwise unverified service assertion.
  if (!serviceRows.length || serviceRows.some((row) => !isEstimate(row))) {
    return { ok: false, services: [] };
  }
  const rows = serviceRows.filter(isEstimate);
  const seen = new Set();
  const services = [];
  for (const row of rows) {
    const values = Array.isArray(row.value) ? row.value : [row.value];
    for (const value of values) {
      const name = serviceName(value);
      const key = normalizedIdentity(name);
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      services.push(name);
    }
  }
  const declared = Array.isArray(facts.services) ? facts.services.map(serviceName).filter(Boolean) : [];
  if (declared.length && declared.some((name) => !seen.has(normalizedIdentity(name)))) {
    return { ok: false, services: [] };
  }
  return { ok: services.length > 0, services };
}

function categoryDefaultServices(packet = {}) {
  return categoryDefaultEstimate(packet).services;
}

function publishableCanonicalServices(packet = {}) {
  const facts = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  if (normalizedIdentity(facts.services_source) === "category default") return [];
  return normalizedServiceNames(canonicalServices(packet));
}

function requestSourceSet(supplied = {}) {
  const values = supplied && typeof supplied === "object"
    ? Object.values(supplied).flat()
    : [];
  return [...new Set(values.map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => /^https?:\/\//i.test(value)))].sort();
}

function normalizedSourceUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return "";
  }
}

function sharedPlatformHost(host = "") {
  return /^(?:google|facebook|instagram|yelp)\.(?:com|co\.[a-z]{2})$/i.test(String(host || ""));
}

// These services host unrelated businesses beneath one registrable domain.
// A registrable-domain comparison alone would therefore bind alice.wixsite.com
// evidence to bob.wixsite.com. Keep this list limited to public multi-tenant
// site builders/hosts; ordinary custom domains retain the historical
// same-registrable-domain behavior below.
const SHARED_BUILDER_HOSTS = Object.freeze([
  "wixsite.com",
  "wixstudio.io",
  "godaddysites.com",
  "weebly.com",
  "wordpress.com",
  "webflow.io",
  "square.site",
  "squarespace.com",
  "myshopify.com",
  "carrd.co",
  "framer.app",
  "framer.website",
  "webnode.com",
  "webnode.page",
  "jimdosite.com",
  "jimdofree.com",
  "mystrikingly.com",
  "site123.me",
  "multiscreensite.com",
  "notion.site",
  "github.io",
  "canva.site",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "firebaseapp.com",
  "web.app",
  "linktr.ee",
  "bio.site",
]);

function sourceUrlIdentity(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return { hostname, pathname };
  } catch {
    return null;
  }
}

function sharedBuilderHost(hostname = "") {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return SHARED_BUILDER_HOSTS.find((root) => host === root || host.endsWith(`.${root}`)) || "";
}

function firstPathSegment(pathname = "") {
  return String(pathname || "").split("/").filter(Boolean)[0] || "";
}

function sharedBuilderTenantMatches(left, right) {
  const a = sourceUrlIdentity(left);
  const b = sourceUrlIdentity(right);
  if (!a || !b) return false;
  const aBuilder = sharedBuilderHost(a.hostname);
  const bBuilder = sharedBuilderHost(b.hostname);
  if (!aBuilder && !bBuilder) return null;
  if (!aBuilder || aBuilder !== bBuilder || a.hostname !== b.hostname) return false;

  // Most builders allocate one tenant-specific subdomain, so exact hostname is
  // the boundary and page paths may vary. Wix additionally allows several
  // sites under one account subdomain; apex-hosted builders identify tenants
  // by their first path segment. Missing path identity fails closed there.
  const pathScoped = aBuilder === "wixsite.com" || a.hostname === aBuilder;
  if (!pathScoped) return true;
  const aTenant = firstPathSegment(a.pathname);
  const bTenant = firstPathSegment(b.pathname);
  return Boolean(aTenant && bTenant && aTenant === bTenant);
}

function evidenceUrlMatchesSource(evidenceUrl, sourceUrl) {
  const evidenceHost = normalizedHost(evidenceUrl);
  const sourceHost = normalizedHost(sourceUrl);
  if (!evidenceHost || evidenceHost !== sourceHost) return false;
  if (sharedPlatformHost(evidenceHost)) {
    return normalizedSourceUrl(evidenceUrl) === normalizedSourceUrl(sourceUrl);
  }
  const sharedBuilderMatch = sharedBuilderTenantMatches(evidenceUrl, sourceUrl);
  if (sharedBuilderMatch !== null) return sharedBuilderMatch;
  return true;
}

function sourceSetMatchesProspect(sourceSet = [], prospect = {}) {
  const expected = Object.values(sourceUrls(prospect)).flat()
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => /^https?:\/\//i.test(value));
  if (!expected.length || !sourceSet.length) return false;
  return sourceSet.every((source) => {
    const sourceHost = normalizedHost(source);
    return expected.some((candidate) => {
      if (candidate === source) return true;
      const candidateHost = normalizedHost(candidate);
      if (!sourceHost || !candidateHost || sourceHost !== candidateHost
        || sharedPlatformHost(sourceHost)) return false;
      const sharedBuilderMatch = sharedBuilderTenantMatches(source, candidate);
      return sharedBuilderMatch === null ? true : sharedBuilderMatch;
    });
  });
}

function packetSourceObservations(packet = {}) {
  const packet2 = objectValue(packet.packet2);
  const directSources = objectValue(packet.sources);
  const packet2Sources = objectValue(packet2.sources);
  return [directSources.observations, packet2Sources.observations]
    .filter(Array.isArray)
    .flat()
    .filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

function observationServiceNames(observation = {}) {
  const extracted = objectValue(observation.extracted);
  const values = [extracted.exactServices, extracted.mainServices]
    .flatMap((value) => Array.isArray(value) ? value : String(value || "").split(/\r?\n|\s*[;,]\s*/));
  return normalizedServiceNames(values);
}

function compilerObservationBacksService(packet = {}, row = {}, service = "", anchors = []) {
  if (normalizedIdentity(row.provenance) !== "observed"
    || normalizedIdentity(row.verification_status) !== "source observation") return false;
  const cited = (Array.isArray(row.source_observations) ? row.source_observations : [])
    .map((value) => clean(value, ""))
    .filter((value) => /^https?:\/\//i.test(value));
  if (!cited.length || cited.some((url) => !anchors.some((anchor) => evidenceUrlMatchesSource(url, anchor)))) {
    return false;
  }
  const wanted = normalizedIdentity(serviceName(service));
  if (!wanted) return false;
  return packetSourceObservations(packet).some((observation) => {
    const source = clean(observation.source || observation.url, "");
    return cited.some((url) => evidenceUrlMatchesSource(source, url))
      && observationServiceNames(observation).some((value) => normalizedIdentity(value) === wanted);
  });
}

function exactTruthPointerBacksService(row = {}, service = "", prospect = {}) {
  if (normalizedIdentity(row.provenance) !== "leadminer exact pointer") return false;
  const wanted = normalizedIdentity(serviceName(service));
  if (!wanted) return false;
  const rowUrl = evidenceUrls({ evidence: [row] })[0] || "";
  return durableTruthServiceEvidence(prospect).some((trusted) =>
    trusted.provenance_pointer === row.provenance_pointer
      && normalizedIdentity(trusted.value) === wanted
      && evidenceUrlMatchesSource(trusted.source_url, rowUrl)
      && trusted.source_kind === row.source_kind
      && trusted.captured_at === row.captured_at);
}

function provenServiceEvidenceRow(packet = {}, row = {}, service = "", anchors = [], prospect = {}, strictEvidence = false) {
  const urls = evidenceUrls({ evidence: [row] });
  if (!urls.length || !urls.every((url) => anchors.some((anchor) => evidenceUrlMatchesSource(url, anchor)))) {
    return false;
  }
  if (!strictEvidence) return true;
  return compilerObservationBacksService(packet, row, service, anchors)
    || exactTruthPointerBacksService(row, service, prospect);
}

function boundServiceEvidenceUrl(packet = {}, service = "", anchors = [], prospect = {}, strictEvidence = false) {
  const wanted = normalizedIdentity(service);
  if (!wanted) return "";
  const rows = [packet.evidence, packet.service_evidence].filter(Array.isArray).flat();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const field = normalizedIdentity(row.field || row.type);
    if (field !== "service" && field !== "services") continue;
    const values = (Array.isArray(row.value) ? row.value : [row.value])
      .map((value) => normalizedIdentity(serviceName(value)));
    if (!values.includes(wanted)) continue;
    const urls = evidenceUrls({ evidence: [row] });
    if (provenServiceEvidenceRow(packet, row, service, anchors, prospect, strictEvidence)) return urls[0];
  }
  return "";
}

function serviceEvidenceIsBound(packet = {}, service = "", anchors = [], prospect = {}, strictEvidence = false) {
  return Boolean(boundServiceEvidenceUrl(packet, service, anchors, prospect, strictEvidence));
}

function sourceBoundServiceEvidenceUrl(packet = {}, service = "", suppliedSources = {}, prospect = {}) {
  return boundServiceEvidenceUrl(packet, service, requestSourceSet(suppliedSources), prospect);
}

function businessNameEvidenceIsBound(packet = {}, packetName = "", prospectName = "", anchors = [], locations = []) {
  if (!compatibleBusinessName(packetName, prospectName, locations)) return false;
  if (normalizedIdentity(packetName) === normalizedIdentity(prospectName)) return true;
  const rows = [packet.evidence, packet.service_evidence].filter(Array.isArray).flat();
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const field = normalizedIdentity(row.field || row.type);
    if (field !== "name" && field !== "business name") return false;
    const values = (Array.isArray(row.value) ? row.value : [row.value])
      .map((value) => normalizedIdentity(value && typeof value === "object" ? (value.name || value.title || "") : value));
    if (!values.includes(normalizedIdentity(packetName))) return false;
    const urls = evidenceUrls({ evidence: [row] });
    return urls.length > 0 && urls.every((url) =>
      anchors.some((anchor) => evidenceUrlMatchesSource(url, anchor)));
  });
}

function serviceName(value) {
  let raw = String(value && typeof value === "object"
    ? (value.name || value.title || "")
    : value || "").trim();
  raw = raw.replace(/^\s*(?:[-*+•]\s+|#{1,6}\s*)/, "");
  const linked = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
  if (linked) {
    if (!/^https?:\/\//i.test(linked[2].trim())) return "";
    raw = linked[1];
  }
  raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const semanticReason = serviceCandidateReason(raw);
  // Preserve the separately gated collapsed-menu compatibility path: those
  // rows are intentionally long and must reach its exact phrase proof. All
  // other known navigation, CTA, editorial, and non-service labels stop here.
  if (!raw || /https?:\/\/|[<>|]/i.test(raw)
    || (semanticReason && semanticReason !== "too_long" && semanticReason !== "too_many_words")) return "";
  return raw;
}

function durableServiceName(value, website = "") {
  const raw = String(value && typeof value === "object"
    ? (value.name || value.title || "")
    : value || "").trim();
  for (const match of raw.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (!firstPartySourceUrl(match[1], website)) return "";
  }
  const name = serviceName(value);
  return name && !serviceCandidateReason(name) ? name : "";
}

/**
 * Keep only services the compiler bound to one of this prospect's immutable
 * request sources. Intake may return a useful source-backed list plus a broad
 * category expansion; the expansion must not poison the whole packet, but it
 * also must never be certified, persisted, or rendered as a real service.
 *
 * The compiler packet is treated as immutable. A fully bound packet is
 * returned by identity; a mixed packet is shallow-cloned only along the
 * service paths consumed by canonicalServices().
 */
function retainSourceBoundServices(packet = {}, suppliedSources = {}, options = {}) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return packet;
  const factsBefore = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  const contentBefore = packet.content && typeof packet.content === "object" ? packet.content : {};
  const serviceKeys = ["services", "service_list", "primary_services", "primaryServices"];
  const hasPresentNonDefaultClaim = [packet, contentBefore].some((container) =>
    serviceKeys.some((key) => Array.isArray(container?.[key]) && container[key].length > 0))
    || [packet.evidence, packet.service_evidence].filter(Array.isArray).flat().some((row) => {
      const field = normalizedIdentity(row?.field || row?.type);
      if (field !== "service" && field !== "services") return false;
      return normalizedIdentity(row.source_type) !== "category default"
        || normalizedIdentity(row.provenance) !== "estimated"
        || normalizedIdentity(row.verification_status) !== "estimated"
        || row.verified === true
        || normalizedIdentity(row.status) === "verified"
        || evidenceUrls({ evidence: [row] }).length > 0;
    });
  const anchors = requestSourceSet(suppliedSources);
  const prospect = objectValue(options.prospect);
  const strictEvidence = options.strictEvidence === true;
  const keys = serviceKeys;
  const retainArrays = (container) => {
    if (!container || typeof container !== "object" || Array.isArray(container)) {
      return { value: container, changed: false };
    }
    let value = container;
    let changed = false;
    for (const key of keys) {
      if (!Array.isArray(container[key])) continue;
      if (container[key].length === 0) {
        if (!changed) value = { ...container };
        changed = true;
        delete value[key];
        continue;
      }
      const services = container[key].filter((row) =>
        serviceEvidenceIsBound(packet, serviceName(row), anchors, prospect, strictEvidence));
      if (services.length === container[key].length) continue;
      if (!changed) value = { ...container };
      changed = true;
      if (services.length) value[key] = services;
      else delete value[key];
    }
    return { value, changed };
  };

  const root = retainArrays(packet);
  let next = root.value;
  const facts = retainArrays(packet.facts);
  if (facts.changed) next = { ...next, facts: facts.value };
  const content = retainArrays(packet.content);
  if (content.changed) next = { ...next, content: content.value };

  // A dropped service must not be able to re-enter through a downstream
  // evidence-first reader. Keep non-service evidence untouched, but retain an
  // offered-service row only when both its source and its surviving values are
  // bound to the immutable request source set.
  const retainedNames = new Set(canonicalServices(next).map(normalizedIdentity).filter(Boolean));
  const retainEvidence = (rows) => {
    if (!Array.isArray(rows)) return { value: rows, changed: false };
    const value = [];
    let changed = false;
    for (const row of rows) {
      const field = normalizedIdentity(row?.field || row?.type);
      if (field !== "service" && field !== "services") {
        value.push(row);
        continue;
      }
      const urls = evidenceUrls({ evidence: [row] });
      const categoryDefaultEstimate = row?.source_type === "category_default"
        && row?.provenance === "estimated"
        && row?.verification_status === "estimated"
        && urls.length === 0;
      if (categoryDefaultEstimate) {
        // This row is disclosure, not proof. Preserve the compiler's explicit
        // estimate so activation can show where the proposed menu came from;
        // canonicalServices() below still loses the unverified values, and the
        // URL-bound certification gate therefore remains fail-closed.
        value.push(row);
        continue;
      }
      const originalValues = Array.isArray(row?.value) ? row.value : [row?.value];
      const keptValues = originalValues.filter((entry) => {
        const name = serviceName(entry);
        return retainedNames.has(normalizedIdentity(name))
          && provenServiceEvidenceRow(packet, row, name, anchors, prospect, strictEvidence);
      });
      if (!keptValues.length) {
        changed = true;
        continue;
      }
      if (keptValues.length !== originalValues.length) {
        value.push({ ...row, value: Array.isArray(row.value) ? keptValues : keptValues[0] });
        changed = true;
      } else {
        value.push(row);
      }
    }
    return { value: changed ? value : rows, changed };
  };

  const evidence = retainEvidence(next.evidence);
  if (evidence.changed) next = { ...next, evidence: evidence.value };
  const serviceEvidence = retainEvidence(next.service_evidence);
  if (serviceEvidence.changed) next = { ...next, service_evidence: serviceEvidence.value };
  if (hasPresentNonDefaultClaim
    && normalizedIdentity(factsBefore.services_source) === "category default") {
    next = {
      ...next,
      facts: {
        ...(next.facts && typeof next.facts === "object" ? next.facts : {}),
        // Durable refusal marker: once a present claim was rejected, later
        // filtering cannot make the packet look like a clean missing-services
        // case that category defaults are allowed to fill.
        services_default_disqualified: true,
      },
    };
  }
  return next;
}

/**
 * Certify only the Compiler's CONTENT contribution.
 *
 * This receipt is deliberately not a build approval. It never waives identity,
 * vertical, provenance, duplicate, render, proof-shot, or delivery checks. The
 * prospect binding prevents a packet compiled for one business being attached
 * to another row, while the packet digest makes the exact compiler output
 * addressable and re-verifiable at admission time. When the bridge removes an
 * unbound service claim, the digest covers that admitted source-backed
 * projection rather than the raw provider response.
 */
function createContentCertification(packet = {}, prospect = {}, options = {}) {
  const id = prospectId(prospect);
  const website = currentWebsite(prospect);
  const websiteHost = normalizedHost(website);
  const placeId = firstValue(prospect, ["place_id", "placeId"]);
  const facts = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  const services = canonicalServices(packet);
  const estimatedServices = categoryDefaultEstimate(packet);
  const sourceSet = requestSourceSet(options.requestSources);
  const evidenceBound = evidenceUrls(packet).some((url) =>
    sourceSet.some((source) => evidenceUrlMatchesSource(url, source)));
  const allServicesBound = services.length > 0
    && services.every((service) => serviceEvidenceIsBound(packet, service, sourceSet));
  const serviceContractSatisfied = allServicesBound || estimatedServices.ok;
  const prospectName = firstValue(prospect, ["business_name", "businessName", "name", "company"]);
  const locations = [
    { city: firstValue(prospect, ["city", "market"]), state: firstValue(prospect, ["state", "region"]) },
    { city: facts.city, state: facts.state },
  ];
  const nameBound = businessNameEvidenceIsBound(packet, facts.name, prospectName, sourceSet, locations);
  const packetCity = normalizedLocation(facts.city);
  const prospectCity = normalizedLocation(firstValue(prospect, ["city", "market"]));
  const packetState = normalizedState(facts.state);
  const prospectState = normalizedState(firstValue(prospect, ["state", "region"]));
  const locationBound = Boolean(packetCity && prospectCity && packetCity === prospectCity
    && packetState && prospectState && packetState === prospectState);
  const visitorCopy = certifiedPracticeVisitorCopy(packet);
  const authorizedCategory = categoryFamily(authorizedProspectCategory(prospect));
  const packetCategoryFamilies = [facts.category, facts.vertical, packet.scope?.category, packet.scope?.vertical]
    .map(categoryFamily).filter(Boolean);
  const reasons = [];
  const key = certificationKey(options);
  const packetLocation = clean(options.packetLocation, "prospect_record:genie_canonical_packet");
  const requestId = clean(options.requestId || packet.request_id || packet.job_id, "");
  const jobId = clean(options.jobId || packet.job_id, "");
  const idempotencyKey = clean(options.idempotencyKey || packet.idempotency_key || requestId, "");
  const certifiedAt = clean(options.certifiedAt, new Date().toISOString());
  const certifiedAtMs = Date.parse(certifiedAt);
  const ttlMs = Math.min(Math.max(Number(options.ttlMs) || 30 * 24 * 60 * 60 * 1000, 60_000), 90 * 24 * 60 * 60 * 1000);
  if (!id) reasons.push("prospect_id_missing");
  if (!websiteHost && !placeId) reasons.push("independent_identity_anchor_missing");
  if (!nameBound) reasons.push("business_name_mismatch");
  if (!locationBound) reasons.push("business_location_mismatch");
  if (!visitorCopy.ok) reasons.push(visitorCopy.reason);
  const pageHubQualityProblem = pageHubVisitorQualityProblem(packet);
  if (pageHubQualityProblem) reasons.push(pageHubQualityProblem);
  if (!authorizedCategory) reasons.push("authorized_category_missing");
  else if (visitorCopy.ok && visitorCopy.category_family !== authorizedCategory) {
    reasons.push("authorized_category_mismatch");
  }
  if (visitorCopy.ok && packetCategoryFamilies.some((value) => value !== visitorCopy.category_family)) {
    reasons.push("compiler_packet_category_mismatch");
  }
  if (!evidenceBound) reasons.push("source_bound_evidence_missing");
  if (!serviceContractSatisfied) reasons.push("verified_service_evidence_missing");
  if (!services.length && !estimatedServices.ok) reasons.push("services_missing");
  if (!key) reasons.push("certification_key_missing");
  if (packetLocation !== "prospect_record:genie_canonical_packet") reasons.push("durable_packet_location_required");
  if (!requestId) reasons.push("compile_request_id_missing");
  if (!clean(packet.request_id, "")) reasons.push("compiler_response_request_id_missing");
  else if (clean(packet.request_id) !== requestId) reasons.push("compile_request_id_mismatch");
  if (!jobId) reasons.push("compile_job_id_missing");
  if (!idempotencyKey) reasons.push("compile_idempotency_key_missing");
  if (!sourceSet.length) reasons.push("source_set_missing");
  else if (!sourceSetMatchesProspect(sourceSet, prospect)) reasons.push("source_set_prospect_mismatch");
  if (!Number.isFinite(certifiedAtMs)) reasons.push("certified_at_invalid");
  if (packet.ok === false || String(packet.version || "") !== VERSION
    || !new Set(["complete", "ready", "compiled"]).has(String(packet.status || "").toLowerCase())
    || packet.scope?.supported !== true) reasons.push("compiler_packet_not_buildable");
  if (reasons.length) return { ok: false, reasons };

  const receipt = {
    version: CONTENT_CERT_VERSION,
    status: "certified",
    scope: "content_completeness_only",
    issuer: "wss-intake-genie-bridge",
    packet_version: clean(packet.version, VERSION),
    packet_sha256: packetSha256(packet),
    packet_location: packetLocation,
    prospect_id: id,
    identity: {
      business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"]),
      canonical_domain: websiteHost,
      place_id: placeId,
      city: firstValue(prospect, ["city", "market"]),
      state: firstValue(prospect, ["state", "region"]),
      category: authorizedCategory,
    },
    evidence: {
      source_bound: allServicesBound,
      service_count: allServicesBound ? services.length : estimatedServices.services.length,
      ...(estimatedServices.ok ? { services_source: "category_default", estimated: true } : {}),
    },
    request_id: requestId,
    job_id: jobId,
    idempotency_key_sha256: sha256(idempotencyKey),
    source_set_sha256: sha256(sourceSet.join("\n")),
    fast_pass: ["content_completeness"],
    preserved_gates: [
      "identity", "vertical", "provenance", "duplicate", "render",
      "proof_shots", "delivery_identity",
    ],
    certified_at: certifiedAt,
    expires_at: new Date(certifiedAtMs + ttlMs).toISOString(),
  };
  receipt.signature = signCertification(receipt, key);
  return { ok: true, receipt };
}

function verifyContentCertification(receipt = {}, packet = {}, prospect = {}, options = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { ok: false, reason: "receipt_missing" };
  if (receipt.version !== CONTENT_CERT_VERSION || receipt.status !== "certified"
    || receipt.scope !== "content_completeness_only" || receipt.issuer !== "wss-intake-genie-bridge") {
    return { ok: false, reason: "receipt_contract_invalid" };
  }
  const key = certificationKey(options);
  if (!key) return { ok: false, reason: "receipt_key_missing" };
  if (receipt.packet_location !== "prospect_record:genie_canonical_packet") {
    return { ok: false, reason: "receipt_packet_not_durable" };
  }
  const expiresAt = Date.parse(String(receipt.expires_at || ""));
  const certifiedAt = Date.parse(String(receipt.certified_at || ""));
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  if (!Number.isFinite(certifiedAt) || certifiedAt > nowMs + 60_000) return { ok: false, reason: "receipt_time_invalid" };
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return { ok: false, reason: "receipt_expired" };
  const expectedSignature = signCertification(receipt, key);
  const suppliedSignature = String(receipt.signature || "");
  if (!/^[0-9a-f]{64}$/.test(suppliedSignature)
    || !timingSafeEqual(Buffer.from(suppliedSignature, "hex"), Buffer.from(expectedSignature, "hex"))) {
    return { ok: false, reason: "receipt_signature_invalid" };
  }
  if (!/^[0-9a-f]{64}$/.test(String(receipt.packet_sha256 || ""))
    || receipt.packet_sha256 !== packetSha256(packet)) return { ok: false, reason: "receipt_packet_mismatch" };
  const sourceSet = requestSourceSet(options.requestSources);
  if (!sourceSet.length || receipt.source_set_sha256 !== sha256(sourceSet.join("\n"))) {
    return { ok: false, reason: "receipt_source_set_mismatch" };
  }
  if (!sourceSetMatchesProspect(sourceSet, prospect)) return { ok: false, reason: "receipt_source_prospect_mismatch" };
  if (!receipt.request_id || !receipt.job_id || !/^[0-9a-f]{64}$/.test(String(receipt.idempotency_key_sha256 || ""))) {
    return { ok: false, reason: "receipt_compile_identity_missing" };
  }
  const expectedIdempotencyKey = clean(options.idempotencyKey, "");
  if (!expectedIdempotencyKey) return { ok: false, reason: "receipt_idempotency_expected_missing" };
  if (receipt.idempotency_key_sha256 !== sha256(expectedIdempotencyKey)) {
    return { ok: false, reason: "receipt_idempotency_mismatch" };
  }
  if (String(receipt.job_id) !== String(packet.job_id || "")) return { ok: false, reason: "receipt_job_mismatch" };
  if (!String(packet.request_id || "").trim()) return { ok: false, reason: "receipt_packet_request_missing" };
  if (String(receipt.request_id) !== String(packet.request_id)) {
    return { ok: false, reason: "receipt_request_mismatch" };
  }
  const currentId = prospectId(prospect);
  if (!currentId || receipt.prospect_id !== currentId) return { ok: false, reason: "receipt_prospect_mismatch" };
  const websiteHost = normalizedHost(currentWebsite(prospect));
  if (String(receipt.identity?.canonical_domain || "") !== websiteHost) return { ok: false, reason: "receipt_domain_mismatch" };
  const placeId = firstValue(prospect, ["place_id", "placeId"]);
  if (String(receipt.identity?.place_id || "") !== String(placeId || "")) return { ok: false, reason: "receipt_place_mismatch" };
  if (normalizedIdentity(receipt.identity?.business_name) !== normalizedIdentity(firstValue(prospect, ["business_name", "businessName", "name", "company"]))) {
    return { ok: false, reason: "receipt_name_mismatch" };
  }
  if (normalizedIdentity(receipt.identity?.city) !== normalizedIdentity(firstValue(prospect, ["city", "market"]))) {
    return { ok: false, reason: "receipt_city_mismatch" };
  }
  if (normalizedIdentity(receipt.identity?.state) !== normalizedIdentity(firstValue(prospect, ["state", "region"]))) {
    return { ok: false, reason: "receipt_state_mismatch" };
  }
  const authorizedCategory = categoryFamily(authorizedProspectCategory(prospect));
  if (!authorizedCategory || String(receipt.identity?.category || "") !== authorizedCategory) {
    return { ok: false, reason: "receipt_category_mismatch" };
  }
  if (!Array.isArray(receipt.fast_pass) || receipt.fast_pass.length !== 1 || receipt.fast_pass[0] !== "content_completeness") {
    return { ok: false, reason: "receipt_scope_invalid" };
  }
  const requiredGates = ["identity", "vertical", "provenance", "duplicate", "render", "proof_shots", "delivery_identity"];
  if (!Array.isArray(receipt.preserved_gates)
    || requiredGates.some((gate) => !receipt.preserved_gates.includes(gate))) {
    return { ok: false, reason: "receipt_preserved_gates_invalid" };
  }
  const facts = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  if (packet.ok === false || String(packet.version || "") !== VERSION
    || !new Set(["complete", "ready", "compiled"]).has(String(packet.status || "").toLowerCase())
    || packet.scope?.supported !== true) return { ok: false, reason: "receipt_packet_not_buildable" };
  const visitorCopy = certifiedPracticeVisitorCopy(packet);
  if (!visitorCopy.ok) return { ok: false, reason: visitorCopy.reason };
  if (visitorCopy.category_family !== authorizedCategory) {
    return { ok: false, reason: "receipt_packet_category_mismatch" };
  }
  const packetCategoryFamilies = [facts.category, facts.vertical, packet.scope?.category, packet.scope?.vertical]
    .map(categoryFamily).filter(Boolean);
  if (packetCategoryFamilies.some((value) => value !== visitorCopy.category_family)) {
    return { ok: false, reason: "receipt_packet_category_mismatch" };
  }
  const locations = [
    { city: receipt.identity?.city, state: receipt.identity?.state },
    { city: facts.city, state: facts.state },
  ];
  if (!businessNameEvidenceIsBound(packet, facts.name, receipt.identity?.business_name, sourceSet, locations)
    || normalizedLocation(facts.city) !== normalizedLocation(receipt.identity?.city)
    || normalizedState(facts.state) !== normalizedState(receipt.identity?.state)) {
    return { ok: false, reason: "receipt_packet_identity_mismatch" };
  }
  const services = canonicalServices(packet);
  const allServicesBound = services.length > 0
    && services.every((service) => serviceEvidenceIsBound(packet, service, sourceSet));
  const estimatedServices = categoryDefaultEstimate(packet);
  if (!allServicesBound && !estimatedServices.ok) {
    return { ok: false, reason: "receipt_service_evidence_invalid" };
  }
  const expectedServiceCount = allServicesBound ? services.length : estimatedServices.services.length;
  if (Number(receipt.evidence?.service_count) !== expectedServiceCount
    || receipt.evidence?.source_bound !== allServicesBound
    || (estimatedServices.ok && (receipt.evidence?.services_source !== "category_default"
      || receipt.evidence?.estimated !== true))) {
    return { ok: false, reason: "receipt_service_contract_invalid" };
  }
  return { ok: true, receipt };
}

// Canonical: INTAKE_GENIE_BASE_URL / INTAKE_GENIE_TOKEN.
// GHOST_AGENCY_INTAKE_GENIE_* are compatibility-only aliases (golden-proof
// tooling used them); canonical names take precedence when both are present.
function baseUrl() {
  return clean(
    process.env.INTAKE_GENIE_BASE_URL
    || process.env.GHOST_AGENCY_INTAKE_GENIE_URL
    || process.env.SITEFORGE_INTAKE_GENIE_BASE_URL
    || process.env.SITEFORGE_APP_URL,
    "",
  ).replace(/\/+$/, "").replace(/\/api\/intake-genie\/compile$/i, "");
}

function packet2ImportBaseUrl() {
  return clean(process.env.PACKET2_IMPORT_BASE_URL, "")
    .replace(/\/+$/, "")
    .replace(/\/api\/intake-genie-import-packet2$/i, "");
}

function token() {
  return clean(
    process.env.INTAKE_GENIE_TOKEN
    || process.env.GHOST_AGENCY_INTAKE_GENIE_TOKEN
    || process.env.SITEFORGE_INTAKE_GENIE_TOKEN
    || process.env.GHOST_AGENCY_SITEFORGE_BUILD_TOKEN,
    "",
  );
}

function configured() {
  return Boolean(baseUrl() && token());
}

function currentWebsite(prospect = {}) {
  const direct = firstValue(prospect, SOURCE_FIELDS.website_url);
  if (direct) return direct;
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const buildReady = record.build_ready && typeof record.build_ready === "object" ? record.build_ready : {};
  return clean(
    firstValue(record, SOURCE_FIELDS.website_url)
    || record.mirror_request?.facts?.current_website
    || record.mirror_request?.facts?.website
    || buildReady.mirror_request?.facts?.current_website
    || buildReady.mirror_request?.facts?.website
    || record.discovery?.url
    || buildReady.discovery?.url,
    "",
  );
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validDurableProvenance(value) {
  const row = objectValue(value);
  return Boolean(clean(row.source, "")
    && clean(row.source_kind, "")
    && Number.isFinite(Date.parse(clean(row.captured_at, ""))));
}

function firstPartySourceUrl(value, website) {
  const source = clean(value, "");
  if (!/^https?:\/\//i.test(source)) return "";
  return website && evidenceUrlMatchesSource(source, website) ? source : "";
}

function canonicalGooglePlacesProof(value, canonicalPlaceId) {
  const expected = clean(canonicalPlaceId, "");
  if (!expected) return false;
  try {
    const source = new URL(clean(value, ""));
    const match = source.protocol === "https:"
      && source.hostname.toLowerCase() === "places.googleapis.com"
      && source.pathname.match(/^\/v1\/places\/([^/]+)\/?$/);
    return Boolean(match && decodeURIComponent(match[1]) === expected);
  } catch {
    return false;
  }
}

function boundIdentityProvenance(value, {
  website = "",
  canonicalPlaceId = "",
  expectedDerivedValue = "",
} = {}) {
  if (!validDurableProvenance(value)) return false;
  const proof = objectValue(value);
  if (proof.source_kind === "google_places_api") {
    return canonicalGooglePlacesProof(proof.source, canonicalPlaceId);
  }
  if (proof.source_kind === "leadminer_derived") {
    if (canonicalPlaceId && proof.source === `leadminer:enrichment:${canonicalPlaceId}`) return true;
    const trade = clean(proof.source, "").match(/^leadminer:project-trade:(.+)$/)?.[1] || "";
    const normalizedTrade = normalizedIdentity(trade);
    const normalizedExpected = normalizedIdentity(expectedDerivedValue);
    return Boolean(normalizedTrade && normalizedExpected && normalizedTrade === normalizedExpected);
  }
  return Boolean(firstPartySourceUrl(proof.source, website));
}

function normalizedServiceNames(rows = []) {
  const seen = new Set();
  const services = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = typeof row === "string"
      ? row
      : (row && typeof row === "object" && !Array.isArray(row)
        ? (typeof row.name === "string" ? row.name : (typeof row.title === "string" ? row.title : ""))
        : "");
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    services.push(normalized);
  }
  return services;
}

function durableTruthServiceEvidence(prospect = {}) {
  const record = objectValue(prospect.record);
  const packet = objectValue(record.truth_packet);
  const lead = objectValue(packet.mirror_ready);
  if (clean(record.truth_packet_source, "") !== "leadminer_mirror_ready"
    || !Object.keys(lead).length) return [];

  const website = currentWebsite(prospect);
  const canonicalPlaceId = firstValue(prospect, ["canonical_place_id", "canonicalPlaceId"]);
  const prospectName = firstValue(prospect, ["business_name", "businessName", "name", "company"]);
  const verifiedName = clean(lead.business_name, "");
  const identityBound = Boolean(verifiedName
    && boundIdentityProvenance(lead.provenance?.["/business_name"], { website, canonicalPlaceId })
    && (!prospectName || compatibleBusinessName(verifiedName, prospectName, prospectLocations(prospect))));
  if (!identityBound) return [];

  const seen = new Set();
  const rows = [];
  for (const [index, service] of (Array.isArray(lead.services) ? lead.services : []).entries()) {
    if (service && typeof service === "object" && service.generated === true) continue;
    const pointer = `/services/${index}/name`;
    const proof = lead.provenance?.[pointer];
    const sourceUrl = validDurableProvenance(proof)
      ? firstPartySourceUrl(proof.source, website)
      : "";
    const name = durableServiceName(service, website);
    const key = normalizedIdentity(name);
    if (!name || !key || seen.has(key) || !sourceUrl) continue;
    seen.add(key);
    rows.push({
      field: "services",
      value: name,
      source: sourceUrl,
      source_url: sourceUrl,
      verified: true,
      status: "verified",
      verification_status: "source_verified",
      provenance: "leadminer_exact_pointer",
      provenance_pointer: pointer,
      source_kind: clean(proof.source_kind, ""),
      captured_at: clean(proof.captured_at, ""),
    });
  }
  return rows;
}

/**
 * Promote only durable, per-field evidence already attached to this prospect.
 * This is deliberately narrower than reading truth_packet wholesale: prior
 * compiler observations, generated prose and foreign-domain URLs never become
 * authoritative inputs to a later compile.
 */
function durableTruthHints(prospect = {}) {
  const record = objectValue(prospect.record);
  const packet = objectValue(record.truth_packet);
  const lead = objectValue(packet.mirror_ready);
  if (clean(record.truth_packet_source, "") !== "leadminer_mirror_ready"
    || !Object.keys(lead).length) {
    return { corrections: {}, services: [], sourceUrls: [] };
  }

  const website = currentWebsite(prospect);
  const canonicalPlaceId = firstValue(prospect, ["canonical_place_id", "canonicalPlaceId"]);
  const prospectName = firstValue(prospect, ["business_name", "businessName", "name", "company"]);
  const corrections = {};
  const services = [];
  const sourceUrls = [];
  const addSource = (value) => {
    const url = firstPartySourceUrl(value, website);
    if (url) sourceUrls.push(url);
  };

  const nameProof = lead.provenance?.["/business_name"];
  const verifiedName = clean(lead.business_name, "");
  const identityBound = Boolean(verifiedName
    && boundIdentityProvenance(nameProof, { website, canonicalPlaceId })
    && (!prospectName || compatibleBusinessName(verifiedName, prospectName, prospectLocations(prospect))));
  if (!identityBound) return { corrections: {}, services: [], sourceUrls: [] };
  corrections.name = verifiedName;
  addSource(nameProof.source);

  const categoryProof = lead.provenance?.["/industry"];
  const verifiedCategory = clean(lead.industry, "");
  if (verifiedCategory
    && boundIdentityProvenance(categoryProof, {
      website,
      canonicalPlaceId,
      expectedDerivedValue: verifiedCategory,
    })) {
    corrections.category = verifiedCategory;
    addSource(categoryProof.source);
  }

  for (const row of durableTruthServiceEvidence(prospect)) {
    services.push(row.value);
    sourceUrls.push(row.source_url);
  }

  const normalizedServices = normalizedServiceNames(services);
  if (normalizedServices.length) corrections.services = normalizedServices;
  return {
    corrections,
    services: normalizedServices,
    sourceUrls: [...new Set(sourceUrls)],
  };
}

function sourceUrls(prospect = {}) {
  const sources = {};
  for (const [field, aliases] of Object.entries(SOURCE_FIELDS)) {
    const value = firstValue(prospect, aliases);
    if (value) sources[field] = value;
  }
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const buildReady = record.build_ready && typeof record.build_ready === "object" ? record.build_ready : {};
  const durable = durableTruthHints(prospect);
  const website = currentWebsite(prospect);
  if (!sources.website_url && website) sources.website_url = website;
  // Owner directive 2026-09-01: the GMB url never rides along as a compile
  // source when a real website exists. It is the last-resort source ONLY for
  // the website-less lane, where it is the sole identity anchor.
  if (!sources.website_url) {
    const nestedGbpUrl = clean(
      record.mirror_request?.facts?.profile_url
      || buildReady.mirror_request?.facts?.profile_url
      || record.leadminer_mirror_ready?.gbp_url,
      "",
    );
    if (nestedGbpUrl) sources.gbp_url = nestedGbpUrl;
  }
  const attached = [
    record.social_evidence?.attached,
    buildReady.social_evidence?.attached,
    record.mirror_request?.facts?.socials,
    buildReady.mirror_request?.facts?.socials,
  ].filter(Array.isArray).flat();
  const socialUrls = attached.map((value) => clean(
    typeof value === "string" ? value : (value?.url || value?.href),
    "",
  )).filter(Boolean);
  for (const url of socialUrls) {
    const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
    if (!sources.facebook_url && /(^|\.)facebook\.com$/.test(host)) sources.facebook_url = url;
    else if (!sources.instagram_url && /(^|\.)instagram\.com$/.test(host)) sources.instagram_url = url;
    else if (!sources.social_url) sources.social_url = url;
  }
  const extra = [
    ...durable.sourceUrls,
    ...(Array.isArray(prospect.source_urls) ? prospect.source_urls : []),
    ...(Array.isArray(record.source_urls) ? record.source_urls : []),
    ...socialUrls,
  ];
  const named = new Set(Object.entries(sources)
    .filter(([field]) => field !== "additional_urls")
    .map(([, value]) => clean(value, ""))
    .filter(Boolean));
  sources.additional_urls = [...new Set(extra.map((value) => clean(value, "")).filter((value) => value && !named.has(value)))].slice(0, 12);
  // FRESHLY MINED CANDIDATES (search-harvested, no owner-qualified packet):
  // every non-own-site source yields observations the compiler cannot
  // source-back, and one unsupported service claim disqualifies the whole
  // compile (present_service_evidence_invalid). Compile them against their
  // own website only — the compiler harvests backed services from the real
  // site. Owner-qualified (leadminer_mirror_ready) and build-ready packets
  // keep their full, provenance-bound source sets.
  const record0 = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const buildReady0 = record0.build_ready && typeof record0.build_ready === "object" ? record0.build_ready : {};
  // Owner-qualified means the owner-held LeadMiner truth packet ONLY. Fresh
  // mined rows DO carry build_ready.mirror_request (the miner persists it at
  // pick time with harvested heading-junk services) — treating those as
  // qualified sent junk hint-services and full directory sources, and the
  // compile died. Fresh rows compile website-only with no service hints.
  const ownerQualified = clean(record0.truth_packet_source, "") === "leadminer_mirror_ready";
  if (!ownerQualified) {
    const only = {};
    for (const key of ["website_url"]) {
      if (sources[key]) only[key] = sources[key];
    }
    // No discoverable own website: compile with NO scraped sources at all.
    // With zero sources there are zero present service claims, so the
    // compiler takes its honest manual-fallback path (category defaults
    // marked as estimates) instead of refusing unsupported extractions.
    if (!only.website_url) return {};
    return only;
  }
  return sources;
}

function normalizeCorrections(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([field, row]) => field && row != null && (typeof row !== "string" || row.trim()))
    .slice(0, 40));
}

function canonicalOwnerCorrections(value) {
  const corrections = normalizeCorrections(value);
  const canonical = { ...corrections };
  if (!Object.prototype.hasOwnProperty.call(canonical, "name")
    && Object.prototype.hasOwnProperty.call(canonical, "business_name")) {
    canonical.name = canonical.business_name;
  }
  if (!Object.prototype.hasOwnProperty.call(canonical, "category")
    && Object.prototype.hasOwnProperty.call(canonical, "industry")) {
    canonical.category = canonical.industry;
  }
  delete canonical.business_name;
  delete canonical.industry;
  return canonical;
}

function immutableServiceHints(prospect = {}) {
  const rows = prospect?.record?.build_ready?.mirror_request?.content?.services;
  const durable = durableTruthHints(prospect);
  return normalizedServiceNames([
    ...(Array.isArray(rows) ? rows : []),
    ...durable.services,
  ]);
}

function discoveredFacts(packet = {}) {
  const facts = packet.facts || {};
  const evidence = Array.isArray(packet.evidence) ? packet.evidence : [];
  const corrections = normalizeCorrections(packet.corrections || packet.owner_corrections);
  const rows = Object.entries(facts).map(([field, value]) => {
    const sources = evidence.filter((row) => row?.field === field).map((row) => ({
      source: clean(row.source || row.url || row.origin, "unknown"),
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
      value: row.value == null ? value : row.value,
    }));
    const distinct = new Set(sources.map((row) => JSON.stringify(row.value)).filter(Boolean));
    return {
      field,
      value: Object.prototype.hasOwnProperty.call(corrections, field) ? corrections[field] : value,
      discovered_value: value,
      corrected: Object.prototype.hasOwnProperty.call(corrections, field),
      sources,
      conflict: distinct.size > 1,
    };
  });
  return {
    facts: rows,
    conflicts: rows.filter((row) => row.conflict),
    missing: Array.isArray(packet.missing_facts)
      ? packet.missing_facts
      : (packet.missing_fact ? [packet.missing_fact] : []),
    manualFallbackAllowed: true,
    truthLaw: "Missing facts remain missing until a source or the owner supplies them.",
  };
}

function prospectRequest(prospect = {}, options = {}) {
  const id = prospectId(prospect);
  const sources = sourceUrls(prospect);
  const record = objectValue(prospect.record);
  const durable = durableTruthHints(prospect);
  const explicitCorrections = {
    ...canonicalOwnerCorrections(record.owner_corrections),
    ...canonicalOwnerCorrections(prospect.owner_corrections),
    ...canonicalOwnerCorrections(prospect.corrections),
  };
  const corrections = normalizeCorrections({
    ...durable.corrections,
    ...explicitCorrections,
  });
  const correctedServices = normalizedServiceNames(corrections.services);
  const serviceHints = Object.prototype.hasOwnProperty.call(corrections, "services")
    ? correctedServices
    : immutableServiceHints(prospect);
  const correctedName = clean(corrections.name, "");
  const correctedCategory = clean(corrections.category, "");
  const category = correctedCategory || firstValue(prospect, [
    "industry", "category", "vertical", "trade", "primary_type",
  ]);
  return {
    request_id: `ghost:${id}:${options.pipelineVersion || "canonical-v1"}`,
    mode: "full",
    ...sources,
    sources,
    corrections,
    conflict_resolution: corrections,
    description: [
      firstValue(prospect, ["description", "prompt", "notes", "instructions"]),
      correctedName,
      category,
      [firstValue(prospect, ["city", "market"]), firstValue(prospect, ["state", "region"])].filter(Boolean).join(", "),
    ].filter(Boolean).join(" — "),
    latlng: prospect.latlng || ((Number.isFinite(Number(prospect.latitude)) && Number.isFinite(Number(prospect.longitude)))
      ? { lat: Number(prospect.latitude), lng: Number(prospect.longitude) }
      : null),
    // Locality and the caller-authorized trade help the compiler target the
    // right public copy. A raw row name is deliberately absent: only an owner-
    // corrected or source-corroborated name may become a compiler hint.
    prospect_hints: {
      ...(correctedName ? { name: decodeHtmlText(correctedName) } : {}),
      city: decodedFirstValue(prospect, ["city", "market"]),
      state: decodedFirstValue(prospect, ["state", "region"]),
      category,
      ...(serviceHints.length ? { services: serviceHints } : {}),
    },
    // Current compiler accepts `category`; the coordinated v7 contract also
    // names the same caller-owned hint `vertical`. Send both without inventing
    // a value so either compiler generation receives the prospect's trade.
    category,
    vertical: category,
    build_preview: options.buildPreview !== false,
    dry_run: options.dryRun !== false,
    intake_mode: Object.values(sources).some((value) => Array.isArray(value) ? value.length : Boolean(value))
      ? "url_first"
      : "manual_fallback",
    truth_law: "source_or_owner_only",
  };
}

function answerCrewProfileFromCanonical(packet = {}) {
  const facts = packet.facts || {};
  const assets = Array.isArray(packet.assets) ? packet.assets : [];
  // Category defaults are an honest intake estimate for review/certification,
  // never an assertion that AnswerCrew may repeat to a caller as offered work.
  const services = publishableCanonicalServices(packet).slice(0, 12);
  const hoursAsset = assets.find((asset) => asset?.kind === "hours");
  const hours = typeof facts.hours === "string"
    ? facts.hours
    : Array.isArray(facts.hours)
      ? facts.hours.map((row) => typeof row === "string" ? row : `${row?.day || ""} ${row?.hours || ""}`.trim()).filter(Boolean).join("; ")
      : String(hoursAsset?.label || "").trim();
  const bookingUrl = clean(facts.booking_url || "", "");
  return {
    business_name: clean(facts.name, ""),
    city: clean(facts.city, ""),
    state: clean(facts.state, "").toUpperCase().slice(0, 2),
    trade: clean(facts.category, ""),
    phone: clean(facts.phone, ""),
    email: clean(facts.email, ""),
    address: clean(facts.address, ""),
    website: clean(facts.website, ""),
    hours: clean(hours, ""),
    booking_url: bookingUrl,
    services,
    socials: (Array.isArray(facts.socials) ? facts.socials : []).map((value) => clean(value, "")).filter(Boolean).slice(0, 8),
    logo_url: clean(assets.find((asset) => asset?.kind === "logo" && asset?.url)?.url, ""),
    photos: assets.filter((asset) => asset?.kind === "photo" && asset?.url).map((asset) => clean(asset.url, "")).filter(Boolean).slice(0, 8),
    evidence_count: Array.isArray(packet.evidence) ? packet.evidence.length : 0,
  };
}

// Caller abort window for a single compile POST. Default 180s (the clamp
// max); hard-clamped to [5s, 180s] so it can never exceed the 300s budgets
// of the Genie service or the ghost line-batch function it is called from.
// Raised from 150s on 2026-09-02: the deployed Genie harvest expands to 12
// source URLs and scrapes them through a pool of 6 at up to 60s per URL of
// endpoint fallback, so harvest-heavy compiles legitimately land in the
// 150-180s band (batch line_mtkw4rlq_c830312fdd tagged all 10 prospects
// intake_genie_timeout at the old 150s default).
function intakeCallTimeoutMs(env = process.env) {
  const parsed = parseInt(env.INTAKE_GENIE_TIMEOUT_MS || "", 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 180000, 5000), 180000);
}

function packet2ImportResponseProblem(packet = {}, submitted = {}) {
  const receipt = packet?.transport_receipt;
  if (!receipt || receipt.snapshot_sha256 !== submitted?.snapshot_sha256) {
    return "packet2_import_snapshot_receipt_mismatch";
  }
  if (!clean(packet?.packet2_hash, "") || receipt.packet2_hash !== packet.packet2_hash) {
    return "packet2_import_hash_receipt_mismatch";
  }
  if (packet?.source_match?.version !== "server-exact-source-match-v1") {
    return "packet2_import_source_match_invalid";
  }
  const services = Array.isArray(packet?.facts?.services) ? packet.facts.services : [];
  const evidence = Array.isArray(packet?.service_evidence) ? packet.service_evidence : [];
  if (!services.length || services.some((service) => !evidence.some((row) => (
    row?.value === service
    && row?.verification_status === "source_observation"
    && row?.provenance === "observed"
    && /^https?:\/\//i.test(clean(row?.source_url, ""))
    && Array.isArray(row?.source_observations)
    && row.source_observations.some((url) => /^https?:\/\//i.test(clean(url, "")))
  )))) {
    return "packet2_import_service_evidence_invalid";
  }
  return "";
}

async function callIntakeGenie(prospect = {}, options = {}) {
  const packet2Import = options.packet2Import;
  const importingPacket2 = packet2Import !== undefined;
  // The operator's direct PageHub template choice must never rewrite an
  // imported, already-compiled Packet2 snapshot.
  const directTemplateId = importingPacket2 ? "" : clean(process.env.INTAKE_GENIE_TEMPLATE_ID, "");
  if (directTemplateId && directTemplateId !== "single-cinematic-motion") {
    return { ok: false, status: "not_configured", error: "INTAKE_GENIE_TEMPLATE_ID is not supported." };
  }
  if (importingPacket2) {
    if (!packet2ImportBaseUrl() || !token()) {
      lastStatus = { ...lastStatus, configured: false, reachable: null, lastCheckedAt: new Date().toISOString(), lastError: "PACKET2_IMPORT_BASE_URL and INTAKE_GENIE_TOKEN are required for Packet2 import." };
      return { ok: false, status: "not_configured", error: lastStatus.lastError };
    }
  } else if (!configured()) {
    lastStatus = { ...lastStatus, configured: false, reachable: null, lastCheckedAt: new Date().toISOString(), lastError: "INTAKE_GENIE_BASE_URL and INTAKE_GENIE_TOKEN are required." };
    return { ok: false, status: "not_configured", error: lastStatus.lastError };
  }
  const pipelineVersion = effectivePipelineVersion(options.pipelineVersion);
  const payload = prospectRequest(prospect, {
    ...options,
    pipelineVersion,
  });
  if (directTemplateId) {
    payload.selectedTemplateId = directTemplateId;
    // Both the compiler request and its HTTP idempotency cache need a new
    // namespace so a prior multi-page result cannot answer this request.
    payload.request_id = `ghost:${prospectId(prospect)}:template:${directTemplateId}:${pipelineVersion}`;
  }
  const endpoint = importingPacket2 ? "intake-genie-import-packet2" : "intake-genie/compile";
  const requestBody = importingPacket2
    ? {
        snapshot_base64: packet2Import?.snapshot_base64,
        snapshot_sha256: packet2Import?.snapshot_sha256,
        request: payload,
        prospect_id: prospectId(prospect),
      }
    : payload;
  const idem = directTemplateId
    ? payload.request_id
    : options.idempotencyKey || payload.request_id || `ghost:${hashObject(payload)}`;
  const controller = new AbortController();
  const callerSignal = options?.signal;
  const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
  let removeCallerAbortForwarder = null;
  if (callerSignal?.aborted) forwardCallerAbort();
  else if (callerSignal?.addEventListener) {
    callerSignal.addEventListener("abort", forwardCallerAbort, { once: true });
    removeCallerAbortForwarder = () => callerSignal.removeEventListener("abort", forwardCallerAbort);
  }
  // The Genie service legally runs to 300s (its own maxDuration) and
  // harvest-heavy compiles legitimately exceed one minute. The old ≤60s clamp
  // aborted slow-but-healthy compiles and tagged them retryable, spinning the
  // ×30 recompile loop that starved the line on 2026-08-26/27.
  const timeoutMs = intakeCallTimeoutMs(process.env);
  const timeout = setTimeout(
    () => controller.abort(new Error("intake_genie_timeout")),
    timeoutMs,
  );
  try {
    const targetBaseUrl = importingPacket2 ? packet2ImportBaseUrl() : baseUrl();
    const response = await fetch(`${targetBaseUrl}/api/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
        "Idempotency-Key": idem,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 1000) };
    }
    if (!response.ok || json.ok === false) {
      const problems = refusalProblems(json);
      lastStatus = { ...lastStatus, configured: true, reachable: response.ok, lastCheckedAt: new Date().toISOString(), lastError: refusalError(json, response.status) };
      return {
        ok: false,
        status: response.status,
        error: lastStatus.lastError,
        ...(problems.length ? { problems } : {}),
        request: payload,
        packet: json,
      };
    }
    if (importingPacket2) {
      const importProblem = packet2ImportResponseProblem(json, packet2Import);
      if (importProblem) {
        lastStatus = { ...lastStatus, configured: true, reachable: true, lastCheckedAt: new Date().toISOString(), lastError: importProblem };
        return { ok: false, status: "invalid_import_response", error: importProblem, request: payload, packet: json };
      }
    }
    lastStatus = { configured: true, reachable: true, contractVersion: json.version || VERSION, lastSuccessfulCall: new Date().toISOString(), lastCheckedAt: new Date().toISOString(), lastError: "", canonicalModeEnabled: true };
    return { ok: true, request: payload, packet: json, idempotencyKey: idem };
  } catch (error) {
    lastStatus = { ...lastStatus, configured: true, reachable: false, lastCheckedAt: new Date().toISOString(), lastError: error.message || String(error) };
    return { ok: false, status: "failed", error: lastStatus.lastError, request: payload };
  } finally {
    clearTimeout(timeout);
    if (removeCallerAbortForwarder) removeCallerAbortForwarder();
  }
}

async function probeIntakeGenie() {
  if (!baseUrl()) {
    lastStatus = {
      ...lastStatus,
      configured: false,
      reachable: null,
      lastCheckedAt: new Date().toISOString(),
      lastError: "INTAKE_GENIE_BASE_URL is required.",
    };
    return status();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${baseUrl()}/healthz`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    lastStatus = {
      ...lastStatus,
      configured: configured(),
      reachable: response.ok,
      lastCheckedAt: new Date().toISOString(),
      lastError: response.ok ? "" : `intake_genie_health_http_${response.status}`,
    };
  } catch (error) {
    lastStatus = {
      ...lastStatus,
      configured: configured(),
      reachable: false,
      lastCheckedAt: new Date().toISOString(),
      lastError: error.name === "AbortError" ? "intake_genie_health_timeout" : error.message || String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
  return status();
}

function truthPacketFromCanonical(packet = {}) {
  const facts = packet.facts || {};
  const targetQueries = packet.optimization?.target_queries || [];
  // The service's category-default menu deliberately does not populate
  // packet.content.services. Mirror receives the same non-claiming projection.
  const services = publishableCanonicalServices(packet);
  const categoryDefaultOnly = normalizedIdentity(facts.services_source) === "category default";
  return {
    meta: {
      version: packet.version || VERSION,
      source: "intake_genie",
      generated_at: new Date().toISOString(),
      bounded: true,
      job_id: packet.job_id || "",
    },
    identity: {
      name: { value: facts.name || "", confidence: confidenceFor(packet, "name") },
      city: { value: facts.city || "", confidence: confidenceFor(packet, "city") },
      state: { value: facts.state || "", confidence: confidenceFor(packet, "state") },
      category: { value: facts.category || "", confidence: confidenceFor(packet, "category") },
      phone: { value: facts.phone || "", confidence: confidenceFor(packet, "phone") },
      address: { value: facts.address || "", confidence: confidenceFor(packet, "address") },
    },
    latlng: facts.latlng || null,
    services,
    photos: (packet.assets || []).filter((item) => item.kind === "photo").map((item) => item.url),
    reviewThemes: { count: packet.trust?.review_count || 0, themes: [], quotes: (packet.trust?.reviews || []).map((r) => r.text || r.quote || r).filter(Boolean).slice(0, 3) },
    localSearchPlan: {
      status: targetQueries.length ? "intake_genie_candidate" : "candidate_only",
      targetTerms: targetQueries.slice(0, 6),
      contentPlan: {
        servicePages: categoryDefaultOnly ? 0 : Math.min(services.length || 4, 4),
        serviceAreaPages: Math.min((facts.service_areas || facts.localities || []).length || 0, 12),
        verifiedLocalities: (facts.service_areas || facts.localities || []).slice(0, 12),
      },
      citations: packet.evidence || [],
      location: {
        city: facts.city || "",
        state: facts.state || "",
        coordinatesVerified: Boolean(facts.latlng),
      },
    },
    opportunities: (packet.optimization?.seo_gaps || []).slice(0, 6).map((gap) => ({ type: "intake_genie_gap", severity: "med", headline: String(gap), detail: "Source-labeled Intake Genie optimization gap." })),
    intakeGenie: packet,
  };
}

function confidenceFor(packet, field) {
  const row = (packet.evidence || []).find((item) => item.field === field);
  return row ? row.confidence : 0.5;
}

function status() {
  return {
    ...lastStatus,
    configured: configured(),
    baseUrl: baseUrl() ? `${baseUrl().replace(/^https?:\/\//, "").split("/")[0]}` : "",
  };
}

module.exports = {
  CERTIFIED_PRACTICE_PACKET_SCHEMA,
  CONTENT_CERT_VERSION,
  PIPELINE_VERSION,
  VERSION,
  callIntakeGenie,
  answerCrewProfileFromCanonical,
  categoryDefaultServices,
  canonicalServices,
  certifiedPracticeVisitorCopy,
  createContentCertification,
  configured,
  durableTruthServiceEvidence,
  discoveredFacts,
  evidenceUrlMatchesSource,
  intakeCallTimeoutMs,
  probeIntakeGenie,
  prospectRequest,
  retainSourceBoundServices,
  sourceBoundServiceEvidenceUrl,
  sourceUrls,
  status,
  truthPacketFromCanonical,
  verifyContentCertification,
};
