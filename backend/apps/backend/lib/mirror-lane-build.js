"use strict";

const { boundedDetailText } = require("./detail-text");
// lib/mirror-lane-build.js — THE MISSING LINK between a mined lead and a
// polished mirror-engine site.
//
// The dashboard pipeline (lib/full-run.js buildPreviewForProspect) dispatches to
// SiteForge and calls mirror() ZERO times — grep-proven. That is the whole reason
// a "Mine 100" click produces sites that read like a SaaS product: the button is
// wired to the SiteForge lane, while everything perfected in lib/mirror-engine/*
// — the clean donor library, the client's own photography, verified-fact content
// injection, phone-optional collapse — lives in a lane the button never reaches.
//
// (Note: lib/mirror-build.js is a DIFFERENT, older module — a crude string-swap
// over donor dist files, still used by the SiteForge lane. This is deliberately a
// separate file so wiring the good lane in cannot disturb the old one.)
//
// This packages the good lane as ONE call a pipeline stage can make:
//
//   prospect record -> verified facts (cross-checked, provenance per field)
//                   -> the client's OWN photos (ownership-gated, best 8)
//                   -> verified content (services / reviews / hours)
//                   -> a true-shape donor for their vertical (or REFUSE)
//                   -> mirror() -> { ok, preview_url, revealable, ... }
//
// TRUTH LAW is inherited from every stage: unverified => absent, never invented.
// No clean donor for the vertical => refuse, never trade-swap. No phone => a
// smaller site, never a fabricated number.

const { createHash } = require("node:crypto");
const { mirror } = require("./mirror-engine/engine");
const { verificationMode } = require("./light-verification");
const { injectDefaultSharedPublisher } = require("./shared-mirror-publisher");
const { brandTruthFromEvidence } = require("./prospects");
const { resolveVerifiedFacts, firstPartySite, stripTrailingLocality } = require("./mirror-engine/verified-facts");
const { harvestClientPhotos } = require("./mirror-engine/client-photos");
// SANITIZE BEFORE VALIDATE. The mirror-request schema types brand URIs as
// format "uri" + ^https://, and a photo list that carries a single space or
// control character inside an otherwise good URL 400s the WHOLE request at
// validation — a failure no retry can fix (six real plumbers died
// build_retry_exhausted that way on line_mtifkuok, 2026-08-31). Drop the
// un-URI-able, count them, build with what validates. See
// lib/mirror-engine/photo-uri-sanitize.js.
const { sanitizeHttpsUri, sanitizePhotoUris } = require("./mirror-engine/photo-uri-sanitize");
// The durable, provenanced photo layer: a bank the miner already filled, plus
// the refusals a URL-ownership gate structurally cannot make (a site builder's
// shared stock library, a stock asset id, a generated picture). See
// lib/client-photo-bank.js for the measured evidence behind each of them.
const photoBank = require("./client-photo-bank");
const { resolveBuildableDonor, firecrawlSearch, metroOfPlan } = require("./lead-miner");
const socialDiscovery = require("./mirror-engine/social-discovery");
const { approvedIndustry } = require("./copilot");
const { inferTrade, sportFencingGuardEnabled } = require("./trade-inference");
const { nearbyCities } = require("./mirror-engine/nearby-cities");
const { eligibleMarketCity } = require("./mirror-engine/place-names");
const { carriesTemplateToken } = require("./mirror-engine/tokens");
const { articleHeadlineReason } = require("./mirror-engine/service-names");
const { brandFromWebsite, ownsLogo } = require("./web-brand");
const { captureFonts } = require("./font-capture");
const { intakePacketFromCanonical, mergeIntoContent } = require("./intake-packet");
const { registrableDomain } = require("./proof-storage");
const {
  canonicalServices,
  categoryDefaultServices,
  evidenceUrlMatchesSource,
  PIPELINE_VERSION: GENIE_PIPELINE_VERSION,
  sourceBoundServiceEvidenceUrl,
  verifyContentCertification,
} = require("./intake-genie-client");
const { resolveRileyLine } = require("./riley-line");
const { resolveSignupConfig } = require("./mirror-engine/signup-floater");
const { isThirdPartyMark } = require("./capture-brand");
const { chooseBrandMark } = require("./mirror-engine/logo-ladder");
const { isUnrecognizedLogoAssetFailure, isDeadDomainLogoFailure } = require("./mirror-engine/brand-assets");
const { pageHubBuildSupplement } = require("./pagehub-build-packet");
const { verifiedTrustForPlace, isGoogleReviewerFace } = require("./verified-trust-lookup");
const {
  readFleetIdentities,
  recordFleetIdentity,
  claimSamenessRetry,
} = require("./mirror-fleet-identity");
const { prideFromExtraction } = require("./owner-pride");
const { clientSurfaceOf } = require("./client-surface");
const {
  isDurableHeroProducer,
  isLegacyComposeProducer,
} = require("./hero-video-policy");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("./mirror-engine-contract");
const { verifyEvidence } = require("./mirror-engine/evidence-signature");
const { slugPolicy, aliasHostFor } = require("./mirror-engine/deploy");

const MAX_PHOTOS = 20;      // brand.photos schema cap (mirror-request.schema.json maxItems:20); donors declare up to 9 gallery slots, so 8 could never fill the last one
// A donor declares up to 9 gallery slots (see MAX_PHOTOS). A harvest that came
// back with fewer than that leaves slots the donor fills with its own generic
// stock — which is the owner's #1 fidelity complaint. Below this floor the
// resolver lane spends a SECOND, image-only harvest on the photographs the
// design brief already measured on their page. See briefPhotoSecondPass.
const BRIEF_PHOTO_FLOOR = 9;
// A non-empty `html` makes harvestClientPhotos skip its homepage GET; with
// `crawl:false` the second pass therefore opens no PAGE at all — only the image
// URLs the brief handed it.
const BRIEF_PASS_NO_HTML = "<!--brief-second-pass: no page read-->";
const MAX_SERVICES = 12;
const MAX_FAQS = 20;    // content-inject renders at most 20; the schema caps there too
const MAX_REVIEWS = 5;   // five faces read as a wall of people; three reads as a sample

function engineDepsFor({ deps = {}, run } = {}) {
  const supplied = isObject(deps.mirrorEngineDeps) ? { ...deps.mirrorEngineDeps } : {};
  if (Object.prototype.hasOwnProperty.call(deps, "sharedPublisher")) {
    supplied.sharedPublisher = deps.sharedPublisher;
  }
  return injectDefaultSharedPublisher(supplied, { selectDefault: run === mirror });
}

function logoLadderFallbackEnabled(env = process.env) {
  return String(env.GHOST_AGENCY_LOGO_LADDER_FALLBACK ?? "1").trim() !== "0";
}

function validLogoSha(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || "").trim());
}

function sha256HexFromBase64(value) {
  const b64 = String(value || "").trim();
  if (!b64) return "";
  try {
    return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
  } catch {
    return "";
  }
}

function enrichTruthPacketLogo(packet = {}, { logoUrl = "", sourceUrl = "", logoSha256 = "", capturedAt = new Date().toISOString() } = {}) {
  if (!isLeadMinerPacket(packet)) return packet;
  const lead = isObject(packet.mirror_ready) ? packet.mirror_ready : null;
  if (!lead || !/^https:\/\//i.test(String(logoUrl || "")) || !/^https:\/\//i.test(String(sourceUrl || "")) || !validLogoSha(logoSha256)) {
    return packet;
  }
  const provenance = isObject(lead.provenance) ? { ...lead.provenance } : {};
  if (!validProvenance(lead, "/logo_url")) {
    provenance["/logo_url"] = {
      source: sourceUrl,
      source_kind: "website",
      captured_at: capturedAt,
    };
  }
  if (!validProvenance(lead, "/logo_source_url")) {
    provenance["/logo_source_url"] = {
      source: sourceUrl,
      source_kind: "website",
      captured_at: capturedAt,
    };
  }
  return {
    ...packet,
    mirror_ready: {
      ...lead,
      logo_url: logoUrl,
      logo_source_url: sourceUrl,
      logo_sha256: String(logoSha256).trim().toLowerCase(),
      provenance,
    },
  };
}

/**
 * Intake Genie media are candidates, not facts. The canonical packet already
 * travels on prospect.truth_packet, but the resolver lane historically looked
 * only at prospect.genie_assets — a field full-run never populated. Extract the
 * canonical image candidates here, then let harvestClientPhotos apply the same
 * ownership, byte, pixel, stock and dedupe gates as every other source.
 */
function intakeGeniePhotoCandidates(prospect = {}, pageHub = {}) {
  const packet = isObject(prospect.truth_packet) ? prospect.truth_packet : {};
  const canonical = isObject(packet.intakeGenie) ? packet.intakeGenie : {};
  const pools = [prospect.genie_assets, canonical.assets, packet.assets, pageHub.asset_candidates].filter(Array.isArray);
  const out = [];
  const seen = new Set();
  for (const asset of pools.flat()) {
    if (!isObject(asset)) continue;
    const kind = String(asset.kind || asset.type || "").trim();
    const url = String(asset.url || asset.src || "").trim();
    if (!url || !/^https?:\/\//i.test(url) || !/photo|image|gallery|hero/i.test(kind)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ ...asset, kind, url });
    if (out.length >= 24) break;
  }
  return out;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const CERTIFIED_GENIE_CONTENT_SOURCE = "intake_genie_certified_content";
const CERTIFIED_GENIE_CONTENT_MARKER = Symbol("certified-genie-content");
const GENIE_RECEIPT_CONTRACT_VERSION = "ghost-line-genie-receipt-v7";

function certificationProspect(prospect = {}, record = {}) {
  return {
    ...record,
    ...prospect,
    record,
    prospect_id: prospect.prospect_id || record.prospect_id,
  };
}

function categoryServiceLabel(category = "") {
  return String(category || "").split(/\s+/).filter(Boolean)
    .map((word) => /^(?:hvac|rv)$/i.test(word) ? word.toUpperCase() : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`)
    .concat("Services")
    .join(" ");
}

function positiveCategoryPhrase(value = "", phrase = "") {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = String(phrase || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized || !wanted) return false;
  const padded = ` ${normalized} `;
  const needle = ` ${wanted} `;
  let offset = 0;
  while ((offset = padded.indexOf(needle, offset)) >= 0) {
    const before = padded.slice(Math.max(0, offset - 70), offset).trim();
    const after = padded.slice(offset + needle.length - 1, offset + needle.length + 55).trim();
    const negatedBefore = /(?:^|\s)(?:no|not|never|without|cannot|don t|doesn t|didn t|won t)(?:\s+[a-z0-9]+){0,4}$/.test(before);
    const negatedAfter = /^(?:(?:is|are|was|were|be|being)\s+)?(?:not|never|unavailable|excluded)\b/.test(after);
    if (!negatedBefore && !negatedAfter) return true;
    offset += Math.max(1, needle.length - 1);
  }
  return false;
}

/**
 * A certified compiler can occasionally collapse a first-party service menu
 * into one long value. Never publish that blob and never loosen the global
 * service-name gate. When the signed value itself contains the exact umbrella
 * phrase for the independently proven LeadMiner trade, preserve that short
 * verbatim phrase instead. Tulip Plumbing is the measured case: both sources
 * say plumbing and the bound value literally contains "Plumbing Services".
 */
function certifiedServiceObservation(packet = {}, name = "", compileSources = {}) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  const sourceUrl = sourceBoundServiceEvidenceUrl(packet, name, compileSources);
  if (!/^https:\/\//i.test(sourceUrl)) return null;
  const rows = [packet.evidence, packet.service_evidence].filter(Array.isArray).flat();
  for (const row of rows) {
    if (String(row?.field || "").toLowerCase() !== "services") continue;
    if (String(row.value || "").trim().toLowerCase() !== wanted) continue;
    if (String(row.source_url || "") !== sourceUrl) continue;
    const excerpt = String(row.excerpt || "").trim();
    if (!excerpt || !excerpt.toLowerCase().includes(wanted)) continue;
    if (row.verified !== true || row.status !== "verified") continue;
    if (row.provenance !== "observed" || row.verification_status !== "source observation") continue;
    if (!Array.isArray(row.source_observations) || !row.source_observations.includes(sourceUrl)) continue;
    return { source_url: sourceUrl, excerpt };
  }
  return null;
}

function certifiedUmbrellaService(packet = {}, prospect = {}, values = []) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const truthPacket = isObject(prospect.truth_packet)
    ? prospect.truth_packet
    : (isObject(record.truth_packet) ? record.truth_packet : {});
  const lead = isObject(truthPacket.mirror_ready) ? truthPacket.mirror_ready : {};
  const packetFacts = isObject(packet.facts) ? packet.facts : {};
  const packetCategory = approvedIndustry(packetFacts.category || packet.scope?.category || "");
  const leadCategory = validProvenance(lead, "/industry")
    ? approvedIndustry(lead.industry)
    : "";
  if (!packetCategory || packetCategory !== leadCategory) return null;

  const phrase = `${packetCategory} services`;
  const label = categoryServiceLabel(packetCategory);
  if (articleHeadlineReason(label)) return null;
  for (const value of values) {
    // Deliberately bypass serviceName here: its 80-character ceiling is the
    // defect this narrow signed projection is repairing. Only the short exact
    // phrase is published; the raw value is used solely for phrase matching,
    // its existing source-evidence lookup, and an audit hash.
    const raw = String(isObject(value) ? (value.name || value.title || "") : value || "").trim();
    const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const observation = certifiedServiceObservation(packet, raw, record.genie_compile_sources);
    if (!raw || !observation || !positiveCategoryPhrase(normalized, phrase)) continue;
    return {
      service: { name: label },
      evidence: {
        name: label,
        source_url: observation.source_url,
        excerpt: observation.excerpt,
        evidence: observation.excerpt,
        excerpt_sha256: createHash("sha256").update(observation.excerpt).digest("hex"),
        source_value_sha256: createHash("sha256").update(raw).digest("hex"),
        verified: true,
        status: "verified",
        projection: "verbatim_category_service_phrase",
      },
    };
  }
  return null;
}

/**
 * Re-verify the durable Intake Genie content receipt at the last boundary
 * before Mirror sees it. The adapter may return bounded search intent plus
 * explicitly ownership-approved brand/media, but never prose, identity, NAP, rating,
 * review, vertical, render, proof, or delivery facts. The receipt's sole
 * fast-pass scope remains content completeness; all later gates still run.
 */
function certifiedGenieContentFromRecord(prospect = {}, options = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const packet = isObject(record.genie_canonical_packet) ? record.genie_canonical_packet : {};
  const receipt = isObject(record.genie_content_certification) ? record.genie_content_certification : {};
  const marker = isObject(record.genie_content_certification_contract)
    ? record.genie_content_certification_contract
    : {};
  const idempotencyKey = String(record.genie_compile_idempotency_key || "").trim();
  const expectedKeyHash = idempotencyKey
    ? createHash("sha256").update(idempotencyKey).digest("hex")
    : "";
  if (marker.version !== GENIE_RECEIPT_CONTRACT_VERSION
    || marker.pipeline_version !== GENIE_PIPELINE_VERSION
    || !idempotencyKey.endsWith(`:${GENIE_PIPELINE_VERSION}`)
    || marker.idempotency_key_sha256 !== expectedKeyHash) {
    return { ok: false, reason: "receipt_pipeline_contract_stale" };
  }
  const verified = verifyContentCertification(
    receipt,
    packet,
    certificationProspect(prospect, record),
    {
      signingKey: options.signingKey,
      nowMs: options.nowMs,
      requestSources: record.genie_compile_sources,
      idempotencyKey: record.genie_compile_idempotency_key,
    },
  );
  if (!verified.ok) return { ok: false, reason: verified.reason || "receipt_invalid" };

  const services = [];
  const evidence = [];
  const seen = new Set();
  const categoryDefaultOnly = receipt.evidence?.services_source === "category_default"
    && receipt.evidence?.estimated === true
    && receipt.evidence?.source_bound === false;
  const canonical = categoryDefaultOnly
    ? categoryDefaultServices(packet)
    : canonicalServices(packet);
  for (const value of canonical) {
    const name = serviceName(value);
    const key = String(name || "").toLowerCase();
    if (!name || articleHeadlineReason(name) || seen.has(key)) continue;
    if (categoryDefaultOnly) {
      seen.add(key);
      services.push({ name });
      evidence.push({
        name,
        source: "category_default",
        source_type: "category_default",
        services_source: "category_default",
        provenance: "estimated",
        verification_status: "estimated",
        estimated: true,
        verified: false,
        status: "estimated",
      });
    } else {
      const observation = certifiedServiceObservation(packet, name, record.genie_compile_sources);
      if (!observation) continue;
      seen.add(key);
      services.push({ name });
      evidence.push({
        name,
        source_url: observation.source_url,
        excerpt: observation.excerpt,
        evidence: observation.excerpt,
        excerpt_sha256: createHash("sha256").update(observation.excerpt).digest("hex"),
        verified: true,
        status: "verified",
      });
    }
    if (services.length >= MAX_SERVICES) break;
  }
  if (!services.length) {
    const umbrella = certifiedUmbrellaService(packet, prospect, canonical);
    if (umbrella) {
      services.push(umbrella.service);
      evidence.push(umbrella.evidence);
    }
  }
  if (!services.length) return { ok: false, reason: "certified_services_missing" };

  // The same receipt covers the complete immutable canonical packet, not only
  // its service list. Adapt its bounded search/brand/media in memory so the
  // production lane no longer depends on an ephemeral intake_packet_dir. The
  // adapter cannot authorize identity/NAP/trust facts and returns only fields
  // already represented by MirrorRequest; the renderer's byte, ownership and
  // DOM gates still run after this projection.
  const truthPacket = isObject(prospect.truth_packet)
    ? prospect.truth_packet
    : (isObject(record.truth_packet) ? record.truth_packet : {});
  const lead = isObject(truthPacket.mirror_ready) ? truthPacket.mirror_ready : {};
  const leadWebsite = String(lead.website_url || "").trim();
  const receiptDomain = String(receipt.identity?.canonical_domain || "").trim().toLowerCase();
  const compileSources = Object.values(isObject(record.genie_compile_sources) ? record.genie_compile_sources : {})
    .flat().map((value) => String(value || "").trim()).filter((value) => /^https?:\/\//i.test(value));
  const websiteSourceBound = compileSources.some((source) => evidenceUrlMatchesSource(leadWebsite, source));
  const verifiedWebsite = /^https:\/\//i.test(leadWebsite)
    && validProvenance(lead, "/website_url")
    && receiptDomain
    && registrableDomain(leadWebsite) === receiptDomain
    && websiteSourceBound
    ? leadWebsite
    : "";
  const canonicalPacket = intakePacketFromCanonical(packet, {
    website: verifiedWebsite,
    packetSha256: receipt.packet_sha256,
    // Estimated category defaults may supply honest labels, never compiler
    // descriptions that read like observed facts about this business.
    services: categoryDefaultOnly ? [] : services,
  });

  return {
    ok: true,
    [CERTIFIED_GENIE_CONTENT_MARKER]: true,
    verified: true,
    status: "verified",
    scope: "content_completeness_only",
    services,
    ...(canonicalPacket.ok ? { canonical_packet: canonicalPacket } : {}),
    provenance: {
      services: {
        source: categoryDefaultOnly ? "category_default" : CERTIFIED_GENIE_CONTENT_SOURCE,
        ...(categoryDefaultOnly
          ? {
              source_type: "category_default",
              services_source: "category_default",
              provenance: "estimated",
              verification_status: "estimated",
              estimated: true,
              verified: false,
              status: "estimated",
            }
          : { verified: true, status: "verified" }),
        scope: "content_completeness_only",
        receipt: {
          version: receipt.version,
          status: receipt.status,
          packet_sha256: receipt.packet_sha256,
          certified_at: receipt.certified_at,
          expires_at: receipt.expires_at,
        },
        evidence,
      },
    },
  };
}

function pageHubSourcePacket(supplement = {}) {
  if (!supplement.ok) return null;
  const snapshotSha256 = String(supplement.snapshot_sha256 || "").trim().toLowerCase();
  const packetId = String(supplement.packet_id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(snapshotSha256)
    || packetId !== `pagehub:${snapshotSha256.slice(0, 24)}`) return null;
  // Deliberately construct this object instead of spreading the sidecar. The
  // render request receives an identifier and digest, never the snapshot,
  // timestamps, supersession history, NAP, prose, credentials or secrets.
  return {
    contract: "pagehub-build-packet",
    packet_id: packetId,
    snapshot_sha256: snapshotSha256,
  };
}

function validProvenance(lead, pointer, requiredKind = "") {
  const evidence = lead?.provenance?.[pointer];
  if (!isObject(evidence)
    || !String(evidence.source || "").trim()
    || !String(evidence.source_kind || "").trim()
    || !Number.isFinite(Date.parse(String(evidence.captured_at || "")))) return false;
  return !requiredKind || evidence.source_kind === requiredKind;
}

function leafPointers(value, pointer = "", output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leafPointers(item, `${pointer}/${index}`, output));
  } else if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) => {
      const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
      leafPointers(item, `${pointer}/${escaped}`, output);
    });
  } else if (pointer) output.push(pointer);
  return output;
}

function nestedValueIsVerified(lead, value, pointer) {
  return leafPointers(value, pointer).every((leaf) => validProvenance(lead, leaf));
}

function isLeadMinerPacket(packet = {}) {
  return isObject(packet)
    && [packet.meta?.source, packet.source, packet.intakeGenie?.source]
      .some((value) => String(value || "").trim().toLowerCase() === "leadminer_mirror_ready");
}

/**
 * servicesForTradeEvidence(prospect) -> [{name}|string, …]
 *
 * Everywhere a prospect's own service list can be sitting by the time a build
 * asks what trade this business is in. They are not alternatives to be ranked —
 * they are all the SAME list arriving by different routes, so they are pooled
 * and the trade inference counts each term once (see scoreTrades). A prospect
 * with none of them falls back to the label, which is exactly the old
 * behaviour and is correct when there is no evidence to prefer.
 */
function servicesForTradeEvidence(prospect = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const lmr = isObject(record.leadminer_mirror_ready) ? record.leadminer_mirror_ready : {};
  const contract = (isObject(record.build_ready) && isObject(record.build_ready.mirror_request))
    ? record.build_ready.mirror_request : {};
  const pools = [
    prospect.primary_services,
    prospect.services,
    lmr.services,
    isObject(contract.content) ? contract.content.services : null,
    isObject(prospect.verified_content) ? prospect.verified_content.services : null,
    isObject(record.truth_packet) ? record.truth_packet.services : null,
  ];
  const out = [];
  for (const pool of pools) if (Array.isArray(pool)) out.push(...pool);
  return out;
}

function effectiveBuildIndustry(inference = {}, { requested = "", label = "" } = {}) {
  const inferred = approvedIndustry(inference.trade) || approvedIndustry(label);
  const preferred = approvedIndustry(requested);
  if (!preferred) return inferred;
  const proved = new Set([
    inference.trade,
    ...(Array.isArray(inference.secondary) ? inference.secondary : []),
  ].map(approvedIndustry).filter(Boolean));
  return proved.has(preferred) ? preferred : inferred;
}

function verifiedIdentity(packet, lead, field, identityKey, requiredKind = "") {
  const direct = String(lead?.[field] || "").trim();
  if (direct && validProvenance(lead, `/${field}`, requiredKind)) {
    return { value: direct, source: "mirror_ready", evidence: lead.provenance[`/${field}`] };
  }
  const item = packet?.identity?.[identityKey];
  if (isObject(item)
    && item.verified === true
    && String(item.status || "").toLowerCase() === "verified"
    && String(item.source || "").trim()
    && String(item.value || "").trim()) {
    return { value: String(item.value).trim(), source: "identity", evidence: item };
  }
  return null;
}

function servicesFromPacketEvidence(packet = {}) {
  // Intake Genie evidence is trusted only through its signed, re-verified
  // content receipt. Reading packet.intakeGenie here would let a forged,
  // expired, or mismatched receipt fall back into this unsigned evidence lane.
  const pools = [packet.service_evidence, packet.evidence];
  const services = [];
  const provenance = [];
  const seen = new Set();
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const row of pool) {
      if (!isObject(row)
        || String(row.field || "").toLowerCase() !== "services"
        || row.verified !== true
        || String(row.status || "").toLowerCase() !== "verified"
        || (!String(row.source || "").trim() && !String(row.source_url || "").trim())
        || row.generated === true) continue;
      const name = serviceName(row.value || row.name);
      if (!name || articleHeadlineReason(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const description = String(row.description || "").trim();
      const price = String(row.price || "").trim();
      services.push({ name, ...((description || price) ? { description: [description, price].filter(Boolean).join(" — ") } : {}) });
      provenance.push({
        name,
        source: String(row.source || row.source_url).trim(),
        source_url: String(row.source_url || row.source || "").trim(),
        verified: true,
      });
      if (services.length >= MAX_SERVICES) break;
    }
    if (services.length >= MAX_SERVICES) break;
  }
  return { services, provenance };
}

function leadMinerMirrorInput(packet = {}, opts = {}) {
  if (!isLeadMinerPacket(packet)) return null;
  const lead = isObject(packet.mirror_ready) ? packet.mirror_ready : null;
  const missing = [];
  if (!lead) return { ok: false, reason: "leadminer_truth_packet_incomplete", missing: ["mirror_ready"] };

  // `needs_fill` may rescue missing OPTIONAL build evidence. It is never a
  // waiver for identity: every fact below still comes from the packet's own
  // provenance or its explicit verified identity envelope.
  const needsFill = !!(opts.needsFill || packet.needs_fill === true || packet.meta?.needs_fill === true || lead.needs_fill === true);
  const nameProof = verifiedIdentity(packet, lead, "business_name", "name", "google_places_api");
  const placeProof = verifiedIdentity(packet, lead, "place_id", "place_id", "google_places_api");
  const categoryProof = verifiedIdentity(packet, lead, "industry", "category");
  const cityProof = lead.city && validProvenance(lead, "/city")
    ? { value: String(lead.city).trim(), source: "mirror_ready", evidence: lead.provenance["/city"] }
    : null;
  const stateProof = lead.state && validProvenance(lead, "/state")
    ? { value: String(lead.state).trim(), source: "mirror_ready", evidence: lead.provenance["/state"] }
    : null;
  const marketProof = lead.service_area && validProvenance(lead, "/service_area")
    ? { value: String(lead.service_area).trim(), source: "mirror_ready", evidence: lead.provenance["/service_area"] }
    : null;

  const directServiceProvenance = [];
  const directServices = (lead.services || []).flatMap((service, index) => {
    if (!isObject(service) || service.generated === true || !service.name || !validProvenance(lead, `/services/${index}/name`)) return [];
    const description = service.description && validProvenance(lead, `/services/${index}/description`)
      ? service.description
      : "";
    const price = service.price && validProvenance(lead, `/services/${index}/price`) ? service.price : "";
    const name = serviceName(service.name);
    if (!name || articleHeadlineReason(name)) return [];
    directServiceProvenance.push({
      name,
      source: lead.provenance[`/services/${index}/name`].source,
      pointer: `/mirror_ready/services/${index}/name`,
      verified: true,
    });
    return [{ name, ...((description || price) ? { description: [description, price].filter(Boolean).join(" — ") } : {}) }];
  }).slice(0, MAX_SERVICES);
  const evidenceServices = servicesFromPacketEvidence(packet);
  const certifiedContent = isObject(opts.certifiedContent)
    && opts.certifiedContent[CERTIFIED_GENIE_CONTENT_MARKER] === true
    && opts.certifiedContent.verified === true
    && opts.certifiedContent.status === "verified"
    && opts.certifiedContent.scope === "content_completeness_only"
    ? opts.certifiedContent
    : null;
  const certifiedServices = (Array.isArray(certifiedContent?.services) ? certifiedContent.services : [])
    .flatMap((service) => {
      const name = serviceName(isObject(service) ? service.name : service);
      return name && !articleHeadlineReason(name) ? [{ name }] : [];
    }).slice(0, MAX_SERVICES);
  const certifiedPacket = certifiedContent?.canonical_packet?.ok === true
    ? certifiedContent.canonical_packet
    : null;
  const certifiedBrand = isObject(certifiedPacket?.brand) ? certifiedPacket.brand : {};
  const supplementalServices = (Array.isArray(opts.supplementServices) ? opts.supplementServices : [])
    .flatMap((service) => {
      const name = serviceName(isObject(service) ? service.name : service);
      return name && !articleHeadlineReason(name) ? [{ name }] : [];
    }).slice(0, MAX_SERVICES);
  const usesCertified = !directServices.length && certifiedServices.length > 0;
  const services = directServices.length
    ? directServices
    : usesCertified
      ? certifiedServices
      : evidenceServices.services.length
        ? evidenceServices.services
        : supplementalServices;
  const serviceProvenance = directServices.length
    ? directServiceProvenance
    : usesCertified
      ? certifiedContent.provenance?.services?.evidence || []
      : evidenceServices.services.length
        ? evidenceServices.provenance
        : supplementalServices.map((service) => ({
          name: service.name,
          source: "pagehub_source_observation",
          verified: true,
        }));

  // THE LABEL IS A HINT; ONLY VERIFIED SERVICES/IDENTITY MAY OVERRULE IT.
  const inferred = inferTrade({
    label: categoryProof?.value || "",
    services,
    businessName: nameProof?.value || "",
    siteText: [lead.site_text, lead.harvested_site_text, packet.site_text, packet.harvested_site_text].filter(Boolean).join(" \n "),
    categories: [lead.primary_category, lead.categories, packet.categories],
    env: opts.env || process.env,
  });
  if (inferred.reason === "vertical_mismatch_sport_fencing") {
    return {
      ok: false,
      reason: "vertical_mismatch_sport_fencing",
      sport_signals: inferred.fencing?.sportSignals || [],
    };
  }
  if (inferred.reason === "fencing_contracting_uncorroborated") {
    return { ok: false, reason: "fencing_contracting_uncorroborated" };
  }
  const categoryIndustry = approvedIndustry(categoryProof?.value || "");
  const categoryFallback = categoryIndustry === "fencing" && sportFencingGuardEnabled(opts.env || process.env)
    ? ""
    : categoryIndustry;
  const industry = approvedIndustry(inferred.trade) || categoryFallback;

  // MULTI-TRADE BUILDS ON THE LEAD TRADE — doctrine change 2026-08-20. This
  // used to refuse ("a single-trade mirror would misrepresent them"), but the
  // premise is obsolete: authority pages render a page for EVERY verified
  // service regardless of trade, and the render gate exempts the client's own
  // name/services/reviews, so the secondary trade is told in the client's own
  // words instead of convicting the build. The donor supplies the lead trade's
  // shell; the client's verified list supplies the rest.
  // A missing logo is a POLISH downgrade, not missing build evidence. Older
  // LeadMiner packets were stamped build_ready:false solely because
  // missing_build_evidence contained "verified_logo"; treat that one legacy
  // reason as satisfied by the frozen logo ladder. Every other missing item
  // keeps the packet held exactly as before.
  const declaredMissingEvidence = Array.isArray(packet.meta?.missing_build_evidence)
    ? packet.meta.missing_build_evidence : null;
  const allowLogoFallback = logoLadderFallbackEnabled();
  const certifiedContentGap = (item) => new Set([
    "content", "service", "services", "verified service evidence",
  ]).has(String(item || "").trim().toLowerCase().replace(/[_-]+/g, " "));
  const blockingMissingEvidence = declaredMissingEvidence
    ? declaredMissingEvidence.filter((item) => (
      (!allowLogoFallback || !/^verified[_ -]?logo$/i.test(String(item || "").trim()))
      && (!certifiedServices.length || !certifiedContentGap(item))
    ))
    : null;
  const declaredGapsSatisfied = Boolean(
    declaredMissingEvidence
    && declaredMissingEvidence.length
    && blockingMissingEvidence.length === 0,
  );
  if (packet.meta?.build_ready !== true && !declaredGapsSatisfied) missing.push("build_ready");
  if (!blockingMissingEvidence || blockingMissingEvidence.length) missing.push("missing_build_evidence");
  const identityMissing = [];
  if (!nameProof) identityMissing.push("business_name");
  if (!placeProof) identityMissing.push("place_id");
  if (!industry) identityMissing.push("industry");
  if (!cityProof) identityMissing.push("city");
  if (!stateProof) identityMissing.push("state");
  missing.push(...identityMissing);
  // THE SAME LOGO, OVER TLS. Rocky's Plumbing carried its mark as
  // http://rockysplumbing.wpengine.com/…logo-2-white.png — the classic WP
  // pattern where the https page embeds assets from the host's plain-http
  // origin — and that one scheme character failed the ENTIRE build as a 400
  // invalid_request (/brand/logo must match ^https://), reported upstream as
  // "mirror produced no host-approved preview URL". Measured 2026-08-09: the
  // https form of the identical host+path serves the identical bytes (same
  // length, same Last-Modified). Upgrading the transport invents nothing — it
  // is the same resource or it is nothing: the engine's TLS-only fetch still
  // decides, and a host with no TLS still refuses the build, now with a brand
  // reason instead of a schema 400. A packet whose logo has no https form at
  // all is refused here, before any spend, like every other missing fact.
  const rawLeadLogoCandidate = String(lead.logo_url || "").trim();
  const certifiedLogoCandidate = String(certifiedBrand.logo || "").trim();
  // A receipt-verified canonical logo is still admitted only when the in-
  // memory adapter proved it is hosted by the packet's verified first-party
  // site. The engine fetches/sniffs/denylists it again below. A supplied
  // LeadMiner candidate always leads and still fails closed if its own
  // provenance is invalid; a canonical logo cannot launder it.
  const rawLogoCandidate = rawLeadLogoCandidate || certifiedLogoCandidate;
  const logoUrl = httpsAssetUrl(rawLogoCandidate);
  const logoIsThirdParty = Boolean(
    logoUrl && isThirdPartyMark(logoUrl.replace(/^https?:\/\//i, "")),
  );
  const verifiedLeadLogo = Boolean(rawLeadLogoCandidate && logoUrl && lead.logo_source_url
    && validProvenance(lead, "/logo_url")
    && validProvenance(lead, "/logo_source_url")
    && !logoIsThirdParty);
  const verifiedCertifiedLogo = Boolean(!rawLeadLogoCandidate && certifiedLogoCandidate && logoUrl && !logoIsThirdParty);
  const verifiedLogo = verifiedLeadLogo || verifiedCertifiedLogo;
  if (!verifiedLogo && !rawLogoCandidate && !allowLogoFallback) missing.push("logo");

  // SANITIZE BEFORE VALIDATE, both sources at once. The provenance gates stay
  // exactly as they were; the sanitizer only removes values that would 400 the
  // request (internal whitespace, data:/relative schemes, duplicates) and caps
  // the list at the schema maxItems after that. A packet whose photos are all
  // unusable still says "photos" is missing — the existing no-photos refusal —
  // never a schema 400 no retry can fix.
  const packetPhotos = sanitizePhotoUris([
    ...(lead.photos || []).filter((photo, index) => (
      isObject(photo)
      && /^https:\/\//i.test(String(photo.url || ""))
      && ["own_site", "gbp"].includes(photo.source)
      && validProvenance(lead, `/photos/${index}/url`)
      && validProvenance(lead, `/photos/${index}/source`)
    )).map((photo) => photo.url),
    ...(Array.isArray(certifiedBrand.photos) ? certifiedBrand.photos : []),
  ], { max: MAX_PHOTOS });
  let photos = packetPhotos.photos;
  if (!photos.length) missing.push("photos");

  if (!services.length) missing.push("services");

  if (identityMissing.length) {
    return {
      ok: false,
      reason: needsFill ? "leadminer_identity_unverified" : "leadminer_truth_packet_incomplete",
      missing: needsFill ? identityMissing : missing,
    };
  }
  // Absence falls down the ladder. A supplied candidate that cannot prove its
  // provenance does not: that remains a truth refusal, especially for a mark
  // belonging to a platform/manufacturer on the business's own site.
  if (rawLeadLogoCandidate && !verifiedLeadLogo) {
    return {
      ok: false,
      reason: logoIsThirdParty ? "logo_third_party_mark" : "leadminer_truth_packet_incomplete",
      missing: ["logo"],
      detail: logoIsThirdParty
        ? `${nameProof.value}'s logo candidate is a third-party mark — it cannot become their identity`
        : `${nameProof.value}'s supplied logo candidate has no verified provenance`,
    };
  }
  if (missing.length && !needsFill) return { ok: false, reason: "leadminer_truth_packet_incomplete", missing };

  const facts = {
    business_name: nameProof.value,
    industry,
    city: cityProof.value,
    state: String(stateProof.value).toUpperCase(),
    place_id: placeProof.value,
  };
  if (marketProof) {
    const market = eligibleMarketCity({
      assertedCity: marketProof.value,
      assertedState: lead.service_area_state,
      queryCity: opts.queryCity,
      queryState: opts.queryState,
      napCity: cityProof.value,
      napState: stateProof.value,
      businessName: nameProof.value,
    });
    if (market.eligible) facts.service_area = market.service_area;
  }
  if (lead.phone_e164 && validProvenance(lead, "/phone_e164")) facts.phone = lead.phone_e164;
  else if (lead.phone_national && validProvenance(lead, "/phone_national")) facts.phone = lead.phone_national;
  if (lead.email && validProvenance(lead, "/email") && validProvenance(lead, "/email_source_url")) facts.email = lead.email;
  if (lead.street && validProvenance(lead, "/street")) facts.address = lead.street;
  if (lead.zip && validProvenance(lead, "/zip")) facts.postal_code = lead.zip;
  // The mirror-request schema only admits an https:// current_website (the
  // engine embeds it in schema.org sameAs and links to it). A plain-http site
  // failed the WHOLE build as invalid_request — which is backwards: no TLS is
  // one of the defects we are pitching to fix, and M & M Heating (http://) was
  // exactly the lead this rejected. The http URL still lives on the prospect
  // row, where the proof-shot and the email's "your site today" read it; it is
  // only omitted from the build request, which loses nothing. Same schema law
  // for the URL's FORMAT: a site URL carrying a stray space or control
  // character 400s the request, so it is sanitized here like every other
  // traveling URI — dropped, never fatal.
  const packetWebsiteUrl = sanitizeHttpsUri(String(lead.website_url || ""));
  if (packetWebsiteUrl && validProvenance(lead, "/website_url")) {
    facts.current_website = packetWebsiteUrl;
  }
  if (Number.isFinite(lead.lat) && Number.isFinite(lead.lng)
    && validProvenance(lead, "/lat") && validProvenance(lead, "/lng")) {
    facts.latitude = lead.lat;
    facts.longitude = lead.lng;
  }
  if (Number.isFinite(lead.rating) && validProvenance(lead, "/rating", "google_places_api")) facts.rating = lead.rating;
  if (Number.isInteger(lead.review_count) && validProvenance(lead, "/review_count", "google_places_api")) facts.review_count = lead.review_count;
  if (lead.gbp_url && validProvenance(lead, "/gbp_url", "google_places_api")) {
    const profileUrl = sanitizeHttpsUri(String(lead.gbp_url));
    if (profileUrl) facts.profile_url = profileUrl;
  }

  const allReviews = (lead.reviews || []).flatMap((review, index) => {
    if (!isObject(review) || !review.text || !validProvenance(lead, `/reviews/${index}/text`, "google_places_api")) return [];
    return [{
      text: review.text,
      ...(review.author && validProvenance(lead, `/reviews/${index}/author`, "google_places_api") ? { author: review.author } : {}),
      ...(Number.isFinite(review.rating) && validProvenance(lead, `/reviews/${index}/rating`, "google_places_api") ? { rating: review.rating } : {}),
      // The reviewer's FACE. A wall of anonymous quotes reads as copywriting;
      // faces read as people. Google's own CDN is the only place these may be
      // served from, so the URL travels verbatim and is never re-hosted — see
      // the no-referrer policy at the render site.
      ...(isGoogleAvatar(review.author_photo_url)
        && validProvenance(lead, `/reviews/${index}/author_photo_url`, "google_places_api")
        ? { avatarUrl: review.author_photo_url } : {}),
      ...(review.published_at && validProvenance(lead, `/reviews/${index}/published_at`, "google_places_api")
        ? { publishedAt: review.published_at } : {}),
    }];
  });
  // The same selection rule the resolver path applies — see featuredReviews.
  // Both paths, or the two drift and one of them quotes a one-star complaint
  // back at the client on the site we are trying to sell them.
  const reviews = featuredReviews(allReviews).reviews.slice(0, MAX_REVIEWS);
  const hours = Array.isArray(lead.hours) && nestedValueIsVerified(lead, lead.hours, "/hours")
    ? lead.hours
    : [];
  const accent = lead.brand_colors?.accent || lead.brand_colors?.primary || "";
  const accentPointer = lead.brand_colors?.accent ? "/brand_colors/accent" : "/brand_colors/primary";
  const accentSource = lead.provenance?.[accentPointer]?.source;
  // Same transport rule as the logo: the measurement's page over TLS is the
  // same page. brand.accent_fallback_source is RequiredHttpsUri in the schema,
  // so a plain-http source would silently cost the packet its scraped colour.
  const accentFrom = httpsAssetUrl(accentSource || lead.logo_source_url || "");
  const primary = lead.brand_colors?.primary || "";
  const hasMeasuredAccent = accent && /^#[0-9a-f]{6}$/i.test(accent) && validProvenance(lead, accentPointer) && accentFrom;
  const brand = {
    // Receipt-covered canonical brand/media fill only gaps left by the
    // independently verified LeadMiner envelope. The canonical adapter has
    // already reduced these to valid MirrorBrand fields and first-party URLs;
    // every asset is fetched and verified again by the engine.
    ...certifiedBrand,
    ...(verifiedLogo ? { logo: logoUrl } : {}),
    ...(verifiedLogo && validLogoSha(lead.logo_sha256) ? { logo_sha256: String(lead.logo_sha256).trim().toLowerCase() } : {}),
    ...(photos.length ? { photos } : {}),
    // Their surface colour, held to the same evidence bar as the accent.
    ...(primary && /^#[0-9a-f]{6}$/i.test(primary) && validProvenance(lead, "/brand_colors/primary")
      ? { primary }
      : {}),
    // AS A FALLBACK, NEVER AS THE ACCENT. brand_colors is the miner's SITE
    // scrape (its provenance points at the client's page, source_kind
    // "site_scrape"), and `brand.accent` is the engine's caller-supplied
    // override: resolveBrandAssets takes it verbatim and NEVER MEASURES THE
    // LOGO. Texas Best Fence & Patio is the measured incident (2026-08-19):
    // their palette-PNG mark measures #00427d navy at 53% share with this
    // repo's own measureAccent, yet the packet's scraped CTA amber #E79431
    // rode this slot, measurement was skipped, and the live mirror shipped
    // --accent 33 79% 55% (that amber, exactly) with the logo's navy and red
    // reaching nothing. The schema says the accent slot is for a colour
    // "pre-measured from the prospect's own logo" — a site scrape is not
    // that. As accent_fallback it keeps the Just Air rescue (a JPEG/WebP
    // mark that measures null in serverless still gets the miner's colour)
    // while the logo's own bytes outrank it everywhere they can be read.
    ...(hasMeasuredAccent && verifiedLogo
      ? { accent_fallback: accent, accent_fallback_source: accentFrom }
      : {}),
    // With no logo, this is not a same-logo fallback: it is the colour the
    // verified first-party site wears. Name it accordingly so brand-assets can
    // use that measured palette beside the ladder mark.
    ...(hasMeasuredAccent && !verifiedLogo
      ? { site_accent: accent, site_accent_source: accentFrom }
      : {}),
    ...(!verifiedLogo && allowLogoFallback
      ? {
        mark: chooseBrandMark({
          logoCandidates: [],
          businessName: facts.business_name,
          accent: hasMeasuredAccent ? accent : "",
        }),
      }
      : {}),
  };

  const baseContent = {
    ...(services.length ? { services } : {}),
    ...(reviews.length ? { reviews } : {}),
    ...(hours.length ? { hours } : {}),
  };
  // OVER-CAP COMPRESSES, NEVER REFUSES (see lib/intake-packet mergeIntoContent).
  // An over-cap /content/about used to 400 the whole build at the engine's
  // validator (production: batch line_mtmat6q5_1250c77fbf); the note rides out
  // so the row records the portioning instead of a refusal.
  const contentNotes = [];
  const content = certifiedPacket
    ? mergeIntoContent(baseContent, certifiedPacket, { notes: contentNotes })
    : baseContent;
  const aboutCompressed = contentNotes.find((row) => row.note === "about_compressed_to_cap") || null;
  const contentProvenance = {};
  if (services.length) {
    contentProvenance.services = usesCertified
      ? certifiedContent.provenance.services
      : { source: "verified_packet", verified: true, status: "verified", evidence: serviceProvenance };
  }
  if (reviews.length) contentProvenance.reviews = { source: "verified_packet", pointer: "/mirror_ready/reviews" };
  if (hours.length) contentProvenance.hours = { source: "verified_packet", pointer: "/mirror_ready/hours" };
  if (certifiedPacket) {
    for (const field of ["about", "faqs", "keywords", "seo_description"]) {
      if (content[field] == null || (Array.isArray(content[field]) && !content[field].length)) continue;
      contentProvenance[field] = {
        source: CERTIFIED_GENIE_CONTENT_SOURCE,
        packet_sha256: certifiedContent.provenance?.services?.receipt?.packet_sha256 || "",
        receipt_verified: true,
        claims_verified: false,
        status: "receipt_verified_source_bound_projection",
      };
    }
  }
  return {
    ok: true,
    facts,
    brand,
    truth_packet: packet,
    // The client's own website is the only place their typeface is written
    // down. Captured at build time by the agency itself — no operator step, no
    // hand-picked font per client. Resolved by the caller (async) and merged
    // into brand.fonts before the request is sent.
    fontSource: facts.current_website || "",
    content,
    photos,
    // Counted note for the row: how many harvested photo values were dropped
    // as un-URI-able by the pre-validation sanitizer (see photo-uri-sanitize.js).
    ...(packetPhotos.droppedInvalid ? { brand_photos_dropped_invalid: packetPhotos.droppedInvalid } : {}),
    // The over-cap about note: the packet's rich about was portioned to the
    // schema cap instead of refusing the business (see mergeIntoContent).
    ...(aboutCompressed ? { about_compressed_to_cap: aboutCompressed } : {}),
    ...(Object.keys(contentProvenance).length ? { content_provenance: contentProvenance } : {}),
    ...(Object.keys(content).length ? {
      content_source: (usesCertified || certifiedPacket)
        ? CERTIFIED_GENIE_CONTENT_SOURCE
        : "verified_packet",
    } : {}),
    ...(needsFill ? { needs_fill: true, missing } : {}),
  };
}

/**
 * httpsAssetUrl — the same asset over TLS, or nothing.
 *
 * https:// passes through untouched; http:// is upgraded to https:// on the
 * SAME host and path — a transport change, not a different resource, and the
 * engine's TLS-only fetch still decides whether it really serves. Anything
 * else (data:, ftp:, a bare path) returns "" and the caller refuses.
 */
function httpsAssetUrl(raw) {
  const url = String(raw || "").trim();
  // Same transport upgrade as ever — http is the SAME asset over another
  // scheme, and the schema only admits https — then the full URI gate
  // (parse + no whitespace/control characters). Rocky's logo note above: the
  // prefix check alone once let a value through that the request schema then
  // 400'd; the sanitizer is the schema's own rule applied before the spend.
  const upgraded = /^http:\/\//i.test(url) ? `https://${url.slice(7)}` : url;
  return sanitizeHttpsUri(upgraded);
}

/**
 * A service name as a human wrote it, not as a scraper found it.
 * "- [24/7 Emergency Plumber](https://…)" -> "24/7 Emergency Plumber".
 * Anything still carrying markup, a URL or list punctuation is refused rather
 * than printed on the client's own website.
 */
function serviceName(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^[-*•]\s+/, "");
  const link = /^\[([^\]]+)\]\([^)]*\)$/.exec(s);
  if (link) s = link[1];
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#]/g, "").trim();
  // The SEO locality suffix a local site staples to its own nav labels
  // ("Water Heater Services in Portland OR"). Removal only, one shared rule —
  // see verified-facts.js stripTrailingLocality for why it exists and what it
  // refuses to touch. Without it here, the packet and contract paths would keep
  // printing the card shape the resolver path no longer does.
  s = stripTrailingLocality(s);
  if (!s || /https?:\/\/|[<>|]/.test(s) || s.length > 80) return "";
  // An unresolved template token from the PROSPECT'S own markup — "${child.title}",
  // "06 ${parent.title}" — is not the name of anything they sell. This guard
  // already refused `<`, `>` and `|`; the two sites that shipped it wrote their
  // menus with `${...}`, which none of those characters catch.
  if (carriesTemplateToken(s)) return "";
  return s;
}

/**
 * Google serves reviewer avatars from lh3/lh4/lh5.googleusercontent.com and
 * nowhere else. The packet's "social" list on this same prospect contained
 * https://x.com/logo.svg — a relative path glued onto a domain — which is what
 * unchecked harvest output looks like. A face is only a face if Google served it.
 */
/**
 * A REAL face, not Google's generated letter tile.
 *
 * Google serves two kinds of profile image from the same host, and the path
 * tells them apart:
 *   /a-/ALV-Uj…   the reviewer uploaded a photo
 *   /a/ACg8oc…    Google generated a coloured circle with their initial
 *
 * The monograms are what made the trust rail read as placeholders — a row of
 * "C" and "E" tiles next to two real faces looks like our images failed to
 * load, which is the opposite of the trust the rail exists to carry. So an
 * initial tile is treated as NO avatar: the reviewer's words and name still
 * ship, the fake-looking circle does not.
 */
// ONE rule, one file. The miner stores the URL and the builder decides whether
// to render it; when those two disagreed the contract claimed faces the page
// could never show. lib/verified-trust-lookup.js owns the definition.
const isGoogleAvatar = isGoogleReviewerFace;

/**
 * WHICH TRUE REVIEWS WE FEATURE — a SELECTION rule, never an editing one.
 *
 * Google's `places.reviews` returns its own "most relevant" five, and relevance
 * is not endorsement. Measured live on Carter's My Plumber, 2026-08-06, the
 * first review Google handed back was one star: "the technician never stayed
 * long enough to check his work for leaks … I would use someone else." That
 * quote is TRUE, and it went straight onto the top of the client's own new
 * website, above the phone number, in a mirror we were about to email them as
 * "here is your site".
 *
 * THE LINE THIS RULE DOES NOT CROSS. Every quote that ships is verbatim,
 * attributed, and unedited — nothing is rewritten, softened, merged or
 * invented, and a business with no qualifying review renders NO review section
 * rather than a padded one. What changes is only WHICH of the client's real
 * testimonials the page features, which is the same choice every business
 * makes on its own site.
 *
 * AND THE AGGREGATE IS NEVER FILTERED. The star rating and the full review
 * count still come from Google's whole corpus — Carter's page says 4.9 across
 * 1,315 reviews, complaint included — and the trust rail links to the Google
 * listing where every last review lives. So the page cannot imply that the
 * negative ones do not exist; it just does not quote them at the client.
 *
 * Anything unrated is KEPT: an absent rating is not evidence of a bad review,
 * and dropping it would silently shrink an honest corpus.
 */
const MIN_FEATURED_RATING = 4;

/**
 * ORDERING, owner's direction: "we obviously wanna show their best and newest
 * reviews on their site, especially the ones that have faces attached to them."
 *
 * Three keys, in his order of emphasis:
 *   1. a FACE first — a review with a real reviewer photo is the one that reads
 *      as a person rather than a text box, and it is the single biggest visual
 *      difference between our page and a template,
 *   2. then RECENT — a glowing review from four years ago is weaker proof than
 *      the same review from last month,
 *   3. then the HIGHEST rating.
 *
 * A face only counts when Google actually supplied a photo URL. Nothing is
 * generated, substituted, or back-filled from initials here — an absent face is
 * absent, and the renderer decides whether to fall back to a monogram.
 *
 * Undated reviews sort last among their rating rather than first: an unknown
 * date is not evidence of recency, and letting it win would quietly promote the
 * oldest corpus entries whenever Google omits a timestamp.
 */
// EVERY CALLER SHAPES A REVIEW BEFORE RANKING IT, so the ranker must read the
// SHAPED names first. It looked only for the RAW Google names
// (author_photo_url / published_at), and all three call sites hand it objects
// that have already been mapped to the MirrorContent shape
// (avatarUrl / publishedAt) — by leadMinerMirrorInput, by reviewsFromContract
// and by contentFromVerified. So `hasFace` was 0 and `when` was 0 on every
// review the system has ever ranked, and the owner's "faces first, then newest"
// order silently degraded to input order. The raw aliases are kept so an
// unshaped list still ranks correctly.
function reviewFeatureRank(review = {}) {
  const rating = Number(review.rating);
  const when = Date.parse(review.publishedAt || review.published_at || review.date || review.time || "");
  const photo = String(
    review.avatarUrl || review.author_photo_url || review.profile_photo_url || review.photo || "",
  ).trim();
  return {
    hasFace: /^https?:\/\//i.test(photo) ? 1 : 0,
    when: Number.isFinite(when) ? when : 0,
    rating: Number.isFinite(rating) ? rating : 0,
  };
}

function featuredReviews(reviews = []) {
  const list = Array.isArray(reviews) ? reviews : [];
  const kept = list.filter((review) => {
    const rating = Number(review && review.rating);
    const avatar = String(review && (review.avatarUrl || review.author_photo_url || review.profile_photo_url || review.photo) || "").trim();
    return !Number.isFinite(rating) || rating >= MIN_FEATURED_RATING;
  });
  // Stable sort on the three keys. Selection only — the aggregate rating and
  // count are computed elsewhere from Google's WHOLE corpus and are untouched.
  const ranked = kept
    .map((review, i) => ({ review, i, key: reviewFeatureRank(review) }))
    .sort((a, b) =>
      (b.key.hasFace - a.key.hasFace)
      || (b.key.when - a.key.when)
      || (b.key.rating - a.key.rating)
      || (a.i - b.i))
    .map((entry) => entry.review);
  return { reviews: ranked, withheld: list.length - kept.length };
}

/**
 * A REBUILD NEVER MOVES A MIRROR. The emailed link and the owner's open tab
 * both point at the host the FIRST build published, and that label came from
 * an older derivation ("Fence & Patio" once folded to fence-patio; slugFor
 * writes fence-and-patio today). Re-deriving on rebuild published all three
 * fleet rebuilds to twin hosts while the emailed originals kept serving stale
 * bytes (measured 2026-08-20: texas-best / allied / metro). The record's own
 * *.wss-ai.com host is the canonical label for as long as the record has one;
 * deploy-time slugPolicy still validates it like any other label.
 */
function establishedSlug(prospect) {
  const record = (prospect && prospect.record) || {};
  for (const url of [record.preview_url, prospect && prospect.preview_url]) {
    const m = String(url || "").match(/^https:\/\/([a-z0-9-]+)\.wss-ai\.com(\/|$)/i);
    if (m) return m[1].toLowerCase();
  }
  return "";
}

/**
 * THE COUTURE HERO RUNG — owner directive 2026-08-20: the shared donor
 * fallback clip "must not ship to everybody". A reel COMPOSED from the
 * client's own banked photographs (the local hero-compose runner, or the Ads
 * image-to-video lane seeded with their own site imagery) is the client's own
 * media in motion — the same truth class as a Ken Burns pass. It rides the
 * schema's brand.hero_video slot, which nothing on the line lanes fills
 * today; brand-assets still fetches, denylists and byte-sniffs the URL, and
 * the donor fallback only ever ships when no owned media exists. Provenance
 * is the earning condition: no recorded generator + composed_from, no ride.
 */
function heroReelBlock(record = {}) {
  const reel = record && record.media_bank && record.media_bank.hero_reel;
  if (!reel || typeof reel !== "object") return {};
  const url = String(reel.url || "");
  if (!/^https:\/\//i.test(url)) return {};
  const generator = String(reel.generator || "");
  // Durable generator labels alone are not evidence. In particular, Seedance
  // must carry the accepted provider checkpoint/job/attempt/output chain that
  // was persisted by the upload boundary. Old generated rows without it take
  // the honest static rung rather than being relabelled as client media.
  if (!isDurableHeroProducer(generator) && !isLegacyComposeProducer(generator)) return {};
  if (!Array.isArray(reel.composed_from) || !reel.composed_from.length) return {};
  if (isLegacyComposeProducer(generator)) {
    return { hero_video: { url, provenance: { kind: "client_derived_reel", generator } } };
  }
  const provenance = reel.provenance && typeof reel.provenance === "object" ? reel.provenance : null;
  if (!provenance || String(provenance.generator || "") !== generator) return {};
  if (generator === "openrouter_seedance") {
    if (provenance.kind !== "seedance_generated"
      || provenance.checkpoint_schema !== "wss.hero.seedance_provider_checkpoint.v1"
      || !String(provenance.provider_job_id || "")
      || !String(provenance.hero_job_id || "")
      || !String(provenance.attempt_id || "")
      || provenance.generation_receipt_schema !== "wss.hero.seedance_generation_receipt.v1"
      || !/^[a-f0-9]{64}$/i.test(String(provenance.generation_receipt_sha256 || ""))
      || !/^[a-f0-9]{64}$/i.test(String(provenance.output_sha256 || ""))) return {};
  } else if (provenance.kind !== "client_derived_reel" || !String(provenance.hero_job_id || "")) return {};
  return { hero_video: { url, provenance } };
}

function slugFor(businessName, city) {
  const base = [businessName, city].filter(Boolean).join(" ");
  // 42 + "wss-test-" (9) = 51-char label; with ".wss-ai.com" the full name
  // stays under the 64-char X.509 CN limit. Roy Briley's 57-char label made a
  // 68-char hostname no certificate could ever cover — the alias attached and
  // then refused TLS forever.
  return "wss-test-" + String(base).toLowerCase()
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42).replace(/-+$/, "");
}

/** Shape the resolver's content into the MirrorContent the schema accepts. */
function contentFromVerified(vc = {}) {
  const content = {};
  if (Array.isArray(vc.services) && vc.services.length) {
    content.services = vc.services
      // `generated:true` is provenance, not decoration. Preserve its meaning by
      // refusing the row instead of stripping the marker and laundering it into
      // the verified service list.
      .filter((x) => !(isObject(x) && x.generated === true))
      // Resolver output can still carry legacy Markdown nav labels such as
      // "- [(505) 555-0123](tel:5055550123)". Shape it through the same cleaner
      // as stored contracts before asking whether the label is a service. That
      // prevents contact links becoming authority pages while preserving real
      // numeric names such as "24/7 Emergency Plumbing".
      .map((x) => (typeof x === "string"
        ? { name: serviceName(x) }
        : { name: serviceName(x && x.name), description: x && x.description }))
      // Ask the article/navigation predicate as well, because the resolver's
      // lowest-ranked source is still the client's own menu bar.
      .filter((x) => x.name && !carriesTemplateToken(x.name) && !articleHeadlineReason(x.name))
      .slice(0, MAX_SERVICES);
  }
  if (Array.isArray(vc.reviews) && vc.reviews.length) {
    // THE FACE AND THE DATE COME WITH THE WORDS. This shaper rebuilt each
    // review from three fields and dropped `avatarUrl` and `publishedAt` on the
    // floor — so on the resolver path the trust rail could never show a
    // reviewer's photo and featuredReviews could never rank by recency, no
    // matter what Google returned. The resolver has already gated the avatar
    // through the one shared face rule (verified-facts shapeReviews →
    // isGoogleReviewerFace); nothing is added here that it did not supply.
    const shaped = vc.reviews
      .map((x) => ({
        text: x.text,
        ...(x.author ? { author: x.author } : {}),
        ...(Number.isFinite(x.rating) ? { rating: x.rating } : {}),
        ...(isGoogleAvatar(x.avatarUrl) ? { avatarUrl: String(x.avatarUrl) } : {}),
        ...(x.publishedAt ? { publishedAt: String(x.publishedAt) } : {}),
      }))
      .filter((x) => x.text && x.author);
    // Same selection rule as the other two paths — see featuredReviews.
    const kept = featuredReviews(shaped).reviews.slice(0, MAX_REVIEWS);
    if (kept.length) content.reviews = kept;
  }
  if (Array.isArray(vc.hours) && vc.hours.length) content.hours = vc.hours;
  // THE CLIENT'S OWN FAQ, which this function silently dropped.
  //
  // verified-facts.js resolves `faqs` from the schema.org FAQPage block on the
  // prospect's own site — questions and answers the business wrote itself, the
  // single highest-value content a local site can carry — and files them under
  // `content.faqs` exactly like services, reviews and hours. This shaper handled
  // the other three and had no `faqs` branch, so every one of them was thrown
  // away between the resolver and the request. Measured on the owner's Oregon
  // run, 2026-08-06: D&F Plumbing resolved EIGHT of their own FAQs, Principled
  // three, Rescue Rooter two; all three mirrors then rendered the engine's
  // generated fallback questions instead of the client's real ones.
  if (Array.isArray(vc.faqs) && vc.faqs.length) {
    const faqs = vc.faqs
      .map((f) => ({
        q: String((f && (f.q || f.question)) || "").trim(),
        a: String((f && (f.a || f.answer)) || "").trim(),
      }))
      .filter((f) => f.q && f.a)
      .slice(0, MAX_FAQS);
    if (faqs.length) content.faqs = faqs;
  }
  // Schema caps about at 4000 chars (mirror-request). A verbose business
  // must truncate, not 400 the whole build (production: Pascale Plumbing
  // & Heating, 2026-09-01, /content/about maxLength).
  if (vc.about) content.about = String(vc.about).slice(0, 4000);
  return content;
}

// ---------------------------------------------------------------------------
// THE MINED CONTRACT — facts that were verified once and must not be re-derived
// ---------------------------------------------------------------------------
//
// A console-mined lead ("build-ready-mine", lib/lead-miner.js mineBuildReady)
// stores a complete, provenanced MirrorRequest at
// record.build_ready.mirror_request. Every field in it was observed by Google
// and bound to this business by registrable-domain equality before a cent was
// spent, and each carries a provenance entry naming the observer and method.
//
// The resolver path below used to rebuild `facts` from scratch out of loose
// prospect columns, which silently dropped place_id, latitude, longitude,
// address, postal_code and county — the six fields that drive the Apple Maps
// and Google Maps links, the map embed, the geo/postal JSON-LD, and
// withNearbyTowns()'s entire ability to find the towns around the client.
// Measured on Carter's My Plumber: the contract held lat 39.9283287 /
// lng -86.1504301 and a verified place_id, and the built mirror showed one city,
// no Apple Maps link and a single JSON-LD type, because none of them survived
// the trip from the record to the request.
//
// These are not new claims. They are the claims we already made, carried
// intact.
const CONTRACT_STRING_FACTS = ["place_id", "address", "postal_code", "county", "profile_url", "service_area"];

/**
 * The owned social/trust profiles for this mirror.
 *
 * ORDER OF TRUST, and it is not negotiable:
 *   1. What the contract already proved (the miner discovered it during the
 *      mine, against the same rules, and recorded the provenance). Carried
 *      intact — a fact proved once is not re-proved.
 *   2. A fresh look at their own website, if we know it. The homepage links
 *      are ownership by self-assertion; one search then covers the accounts
 *      they never bothered to link.
 *
 * NOTHING ELSE ATTACHES. Every entry that leaves this function has either been
 * linked by the business itself or carries every distinctive token of its name
 * (lib/mirror-engine/social-discovery). We have already shipped another
 * company's mark as a client's identity once; a social chip is worse, because
 * it invites the visitor to walk out of the client's site and into a stranger's.
 *
 * Never throws, never blocks. Zero profiles is the ordinary outcome.
 */
async function resolveSocials({ facts = {}, vf = {}, contract = {}, opts = {} } = {}) {
  const stored = [vf.socials, contract.socials].find((v) => Array.isArray(v) && v.length);
  if (stored) {
    const carried = stored
      .filter((s) => isObject(s) && s.network && /^https:\/\//i.test(String(s.url || "")))
      .map((s) => ({
        network: String(s.network), url: String(s.url),
        ...(s.label ? { label: String(s.label) } : {}),
        ...(s.handle ? { handle: String(s.handle) } : {}),
        ...(s.provenance ? { provenance: String(s.provenance) } : {}),
      }));
    if (carried.length) return { socials: carried, source: "contract" };
  }

  const site = String(facts.current_website || "").trim();
  const name = String(facts.business_name || "").trim();
  if (opts.socialDiscovery === false || !site || !name) return { socials: [], source: "not_attempted" };

  const key = String(process.env.FIRECRAWL_API_KEY || "").trim();
  const searchOn = key && String(process.env.GHOST_AGENCY_SOCIAL_SEARCH ?? "true").toLowerCase() !== "false";
  try {
    let html = "";
    try {
      const res = await fetch(site, { redirect: "follow", headers: { "user-agent": SOCIAL_UA }, signal: AbortSignal.timeout(12000) });
      if (res.ok) html = await res.text();
    } catch { /* an unreachable site yields no links, and that is all it means */ }

    const found = await socialDiscovery.discoverSocials({
      businessName: name,
      siteUrl: site,
      html,
      maxSearches: searchOn ? 1 : 0,
      search: searchOn ? ({ query, limit }) => firecrawlSearch({ query, limit, apiKey: key }) : null,
    });
    return {
      socials: found.profiles.map((p) => ({ network: p.network, url: p.url, label: p.label, handle: p.handle, provenance: p.provenance })),
      source: "discovered",
      refused: found.refused,
      searchCalls: found.searchCalls,
    };
  } catch (e) {
    return { socials: [], source: "soft_failed", detail: boundedDetailText((e && e.message) || e, 160) };
  }
}

const SOCIAL_UA = "Mozilla/5.0 (compatible; WSSMirrorBot/1.0; +https://wss-ai.com)";
const CONTRACT_NUMBER_FACTS = ["latitude", "longitude"];

/**
 * THE MINED CONTRACT, WHEREVER THE CALLER LEFT IT.
 *
 * `record.build_ready.mirror_request` is the one place the miner writes the
 * contract. Two callers reach this builder and only one of them flattens that
 * block onto the prospect:
 *
 *   · line-adapters.prospectFromContract sets `verified_facts` /
 *     `verified_content` from it — the console/line path, which works.
 *   · full-run.prospectBuildInput does NOT. Its whitelist carries `record` and
 *     nothing else from the contract, so the dashboard/autopilot path arrived
 *     here with verified_facts undefined, verified_content undefined, and no
 *     rating or review_count either.
 *
 * WHAT THAT COST, measured 2026-08-07 on the live fleet. With no contract the
 * facts have no `place_id`; with no place_id the trust lookup is skipped as
 * `no_verified_place_id_to_pin_to`; and one skipped lookup is the whole trust
 * surface at once — no reviews, no hours, no Google profile link. With no
 * coordinates withNearbyTowns silently returns unchanged content, so the
 * service-area list goes too, and with no `rating`/`review_count` the star rail
 * cannot render. Three live mirrors shipped in exactly that state — Carter's My
 * Plumber (a record holding 4.9 and 1,315 reviews), Rescue Rooter and Plumbing
 * Care — every one of them serving `rating:null, reviews:[], hours:null,
 * areas:[]` while carrying the resolver's services and FAQ, which is the
 * signature this reads as.
 *
 * So the contract is read from the RECORD when the caller did not flatten it.
 * The record travels on both paths (full-run.js passes `record:
 * buildProspect.record`; prospectFromContract spreads the whole row), which
 * makes this the one place both callers can agree.
 *
 * A flattened block still WINS when present: a caller that resolved it
 * deliberately is fresher than stored JSON, and this is a fallback, never an
 * override. Nothing new is claimed — these are the same Google-observed,
 * provenanced facts the miner already wrote, carried the last inch.
 */
function storedContract(prospect = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const buildReady = isObject(record.build_ready) ? record.build_ready : {};
  const request = isObject(buildReady.mirror_request) ? buildReady.mirror_request : {};
  return request;
}

/** The city the miner searched, carried only as a constraint on assertions. */
function miningMarketOf(prospect = {}) {
  const directCity = String(prospect.query_city || prospect.queryCity || prospect.mining_city || "").trim();
  const directState = String(prospect.query_state || prospect.queryState || prospect.mining_state || "").trim().toUpperCase();
  if (directCity) return { city: directCity, state: directState };

  const record = isObject(prospect.record) ? prospect.record : {};
  const buildReady = isObject(record.build_ready) ? record.build_ready : {};
  const fence = [buildReady.metro_fence, record.metro_fence].find(isObject) || {};
  const queried = String(fence.queried || "").trim();
  if (queried) {
    const parsed = metroOfPlan(queried);
    if (parsed.city) return parsed;
  }

  const queryText = String(
    record.text_query
      || buildReady.discovery?.query
      || prospect.text_query
      || "",
  ).trim();
  const location = (/\b(?:in|near)\s+(.+)$/i.exec(queryText) || [])[1] || "";
  if (location) {
    const parsed = metroOfPlan(location);
    if (parsed.city) return parsed;
  }

  // Legacy rows used this column for the searched market as well as the
  // asserted market. It remains a constraint only; eligibleMarketCity still
  // requires a separately supplied service-area candidate before publishing it.
  const legacyCity = String(prospect.marketing_city || "").trim();
  return legacyCity
    ? { city: legacyCity, state: String(prospect.marketing_city_state || "").trim().toUpperCase() }
    : { city: "", state: "" };
}

function contractFactsOf(prospect = {}) {
  const facts = prospect.verified_facts;
  if (isObject(facts)) return facts;
  const stored = storedContract(prospect).facts;
  return isObject(stored) ? stored : {};
}

/**
 * Reviews from a stored contract, held to the same bar as the packet path:
 * text is mandatory, a face is only a face if Google served it (initial-tile
 * monograms are treated as no avatar — see isGoogleAvatar), and anything
 * unattributed simply loses the attribution rather than gaining a placeholder.
 */
function reviewsFromContract(list = []) {
  return (Array.isArray(list) ? list : []).flatMap((review) => {
    if (!isObject(review)) return [];
    const text = String(review.text || "").trim();
    if (!text) return [];
    const rating = Number(review.rating);
    const avatar = review.avatarUrl || review.author_photo_url;
    const publishedAt = String(review.publishedAt || review.published_at || "").trim();
    return [{
      text,
      ...(review.author ? { author: String(review.author).trim() } : {}),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(isGoogleAvatar(avatar) ? { avatarUrl: String(avatar) } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    }];
  }).slice(0, MAX_REVIEWS);
}

/** The contract's own content block, shaped for MirrorContent. */
function contentFromContract(prospect = {}) {
  // Same rule as contractFactsOf, and for the same reason: whichever caller we
  // came through, the miner's own reviews and hours live at
  // record.build_ready.mirror_request.content and must not depend on the caller
  // having copied them onto the prospect. See storedContract.
  const raw = isObject(prospect.verified_content)
    ? prospect.verified_content
    : (isObject(storedContract(prospect).content) ? storedContract(prospect).content : {});
  const content = {};
  const services = (Array.isArray(raw.services) ? raw.services : [])
    .filter((x) => !(isObject(x) && x.generated === true))
    .map((x) => (typeof x === "string" ? { name: serviceName(x) } : { name: serviceName(x && x.name), ...(x && x.description ? { description: String(x.description) } : {}) }))
    // A STORED CONTRACT IS NOT EXEMPT. serviceName() cleans markup and locality
    // suffixes; it has never asked whether the string names a thing the business
    // sells. Contracts written before 2026-08-11 hold whatever the harvest of
    // the day accepted, and an old row must not be able to reintroduce a label
    // the live harvest now refuses.
    .filter((x) => x.name && !articleHeadlineReason(x.name))
    .slice(0, MAX_SERVICES);
  if (services.length) content.services = services;
  const reviews = featuredReviews(reviewsFromContract(raw.reviews)).reviews;
  if (reviews.length) content.reviews = reviews;
  if (Array.isArray(raw.hours) && raw.hours.length) content.hours = raw.hours.slice(0, 14);
  if (Array.isArray(raw.faqs) && raw.faqs.length) {
    const faqs = raw.faqs
      .map((f) => ({ q: String((f && (f.q || f.question)) || "").trim(), a: String((f && (f.a || f.answer)) || "").trim() }))
      .filter((f) => f.q && f.a).slice(0, MAX_FAQS);
    if (faqs.length) content.faqs = faqs;
  }
  return content;
}

/**
 * restoreReviewFaces(reviews, contractReviews) -> reviews
 *
 * Put back the reviewer photo the section merge discarded. See the call site
 * for the incident. The identity test is deliberately brutal: same author,
 * same review text, exactly one candidate. Anything less and the review keeps
 * no face, which is the honest outcome — the words and the name still ship.
 */
function restoreReviewFaces(reviews, contractReviews) {
  const list = Array.isArray(reviews) ? reviews : null;
  const donors = Array.isArray(contractReviews) ? contractReviews : [];
  if (!list || !list.length || !donors.length) return reviews;
  const key = (r) => `${String((r && r.author) || "").trim().toLowerCase()}::${String((r && r.text) || "").replace(/\s+/g, " ").trim().toLowerCase()}`;

  const byKey = new Map();
  for (const d of donors) {
    if (!isObject(d) || !isGoogleAvatar(d.avatarUrl)) continue;
    const k = key(d);
    if (!k.replace(/[^a-z0-9]+/g, "")) continue;
    // A key seen twice is ambiguous; mark it dead rather than guess.
    byKey.set(k, byKey.has(k) ? null : String(d.avatarUrl));
  }
  if (!byKey.size) return reviews;

  return list.map((r) => {
    if (!isObject(r) || r.avatarUrl) return r;
    const hit = byKey.get(key(r));
    return hit ? { ...r, avatarUrl: hit } : r;
  });
}

/**
 * FIRST NON-EMPTY WINS, section by section.
 *
 * The resolver's fresh observation leads; the contract fills what the resolver
 * could not reach today. Sections are never blended — five review quotes half
 * from one observation and half from another is a corpus nobody observed.
 */
function mergeContentSources(...sources) {
  const out = {};
  for (const source of sources) {
    if (!isObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      const empty = value == null
        || (Array.isArray(value) && !value.length)
        || (typeof value === "string" && !value.trim());
      if (empty || out[key] !== undefined) continue;
      out[key] = value;
    }
  }
  return out;
}

function firstHttpUrl(values = []) {
  for (const value of values) {
    const url = String(value || "").trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function needsFillWebsite(prospect = {}, packet = {}) {
  const lead = isObject(packet.mirror_ready) ? packet.mirror_ready : {};
  const contract = storedContract(prospect);
  return firstHttpUrl([
    lead.website_url,
    contract.facts?.current_website,
    prospect.current_website,
    prospect.website,
    prospect.site,
    prospect.record?.current_website,
    prospect.record?.website,
    prospect.record?.leadminer_mirror_ready?.website_url,
  ]);
}

function contractBrandFor(prospect = {}) {
  const raw = storedContract(prospect).brand;
  if (!isObject(raw)) return {};
  const logo = httpsAssetUrl(raw.logo);
  const logoAllowed = Boolean(logo && !isThirdPartyMark(logo.replace(/^https?:\/\//i, "")));
  const out = logoAllowed ? { logo } : {};
  if (logoAllowed && /^[0-9a-f]{64}$/i.test(String(raw.logo_sha256 || ""))) out.logo_sha256 = String(raw.logo_sha256).toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(String(raw.primary || ""))) out.primary = raw.primary;
  for (const [colorKey, sourceKey] of [
    ["accent", "accent_source"],
    ["accent_fallback", "accent_fallback_source"],
    ["site_accent", "site_accent_source"],
  ]) {
    const source = httpsAssetUrl(raw[sourceKey]);
    if (/^#[0-9a-f]{6}$/i.test(String(raw[colorKey] || "")) && source) {
      out[colorKey] = raw[colorKey];
      out[sourceKey] = source;
    }
  }
  // A STORED colour never rides the override slot. `brand.accent` short-
  // circuits resolveBrandAssets' own measurement of the logo bytes, and a
  // contract's accent is whatever the miner recorded — for LeadMiner packets a
  // SITE scrape, not a logo measurement (the Texas Best amber, see
  // leadMinerMirrorInput). Demoted to accent_fallback it can still rescue a
  // mark this runtime cannot decode (the Just Air JPEG case) while the logo's
  // own measured colour outranks it, which is the owner's palette-from-the-logo
  // rule. A fallback the contract already carries is the same class of evidence
  // recorded under its correct name, so it is kept over the demoted accent.
  if (out.accent) {
    if (!out.accent_fallback) {
      out.accent_fallback = out.accent;
      out.accent_fallback_source = out.accent_source;
    }
    delete out.accent;
    delete out.accent_source;
  }
  return out;
}

function siteAccentEvidence(...blocks) {
  for (const raw of blocks) {
    if (!isObject(raw)) continue;
    const color = String(raw.site_accent || "").trim();
    const source = httpsAssetUrl(raw.site_accent_source);
    if (/^#[0-9a-f]{6}$/i.test(color) && source) {
      return { site_accent: color.toUpperCase(), site_accent_source: source };
    }
  }
  return {};
}

function nonEmptyContentValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" ? Boolean(value.trim()) : value != null;
}

/**
 * Fill a thin packet from evidence that already exists: its verified evidence
 * envelope, a stored MirrorRequest contract, or one structural read of the
 * business's own site. No catalogue, model prose, donor copy or palette default
 * is admitted. A missing service list is therefore a typed refusal; a missing
 * mark falls through the frozen logo ladder.
 */
async function rescueNeedsFill({
  input,
  prospect = {},
  packet = {},
  resolveFacts = resolveVerifiedFacts,
  firstParty = firstPartySite,
  resolveBrand = brandFromWebsite,
  fetchImpl,
} = {}) {
  if (!input || !input.ok || !input.needs_fill) return { ok: true, input, provider_calls: { first_party_site: 0, brand_site: 0 } };

  const website = needsFillWebsite(prospect, packet);
  let truthPacket = isLeadMinerPacket(input.truth_packet)
    ? input.truth_packet
    : isLeadMinerPacket(packet) ? packet : null;
  const contractContent = contentFromContract(prospect);
  const storedBrand = contractBrandFor(prospect);
  const storedLogoCandidate = String(storedContract(prospect).brand?.logo || "").trim();
  let siteResolution = null;
  let siteBrand = null;
  const packetHasServices = Array.isArray(input.content?.services) && input.content.services.length > 0;
  const contractHasServices = Array.isArray(contractContent.services) && contractContent.services.length > 0;
  const needSiteContent = Boolean(website && !packetHasServices && !contractHasServices);
  const needSiteBrand = Boolean(website && !input.brand?.logo && !storedBrand.logo);

  const [factsResult, brandResult] = await Promise.all([
    needSiteContent
      ? resolveFacts({
        prospect: {
          business_name: input.facts.business_name,
          industry: input.facts.industry,
          city: input.facts.city,
          state: input.facts.state,
          place_id: input.facts.place_id,
          current_website: website,
          record: prospect.record || null,
        },
        sources: [firstParty],
        deps: { fetchImpl },
      }).catch(() => null)
      : Promise.resolve(null),
    needSiteBrand
      ? resolveBrand(website, { businessName: input.facts.business_name }).catch(() => null)
      : Promise.resolve(null),
  ]);
  siteResolution = factsResult;
  siteBrand = brandResult;

  const firstPartyContent = contentFromVerified(siteResolution?.content || {});
  const candidates = [
    { name: "verified_packet", content: input.content || {}, provenance: input.content_provenance || {} },
    { name: "stored_contract", content: contractContent, pointer: "record.build_ready.mirror_request.content" },
    { name: "first_party_site", content: firstPartyContent, provenance: siteResolution?.provenance || {} },
  ];
  const content = {};
  const contentProvenance = {};
  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(candidate.content || {})) {
      if (content[key] !== undefined || !nonEmptyContentValue(value)) continue;
      content[key] = value;
      const evidence = candidate.provenance?.[key];
      contentProvenance[key] = evidence && evidence.source === candidate.name
        ? evidence
        : {
          source: candidate.name,
          ...(evidence ? { evidence } : {}),
          ...(candidate.pointer ? { pointer: `${candidate.pointer}.${key}` } : {}),
        };
    }
  }

  let brand = { ...(input.brand || {}) };
  let brandProvenance = input.brand?.logo
    ? { source: "verified_packet", pointer: "/mirror_ready/logo_url" }
    : null;
  // Stored palette evidence is useful even when the stored contract has no
  // logo. Packet evidence remains fresher and therefore wins field-by-field.
  const storedBrandWithoutLogo = { ...storedBrand };
  delete storedBrandWithoutLogo.logo;
  delete storedBrandWithoutLogo.logo_sha256;
  brand = { ...storedBrandWithoutLogo, ...brand };
  if (!brand.logo && storedBrand.logo) {
    brand = { ...brand, ...storedBrand };
    delete brand.mark;
    brandProvenance = { source: "stored_contract", pointer: "record.build_ready.mirror_request.brand.logo" };
  }
  if (!brand.logo && storedLogoCandidate && !storedBrand.logo) {
    const upgraded = httpsAssetUrl(storedLogoCandidate);
    const thirdParty = Boolean(upgraded && isThirdPartyMark(upgraded.replace(/^https?:\/\//i, "")));
    return {
      ok: false,
      reason: thirdParty ? "logo_third_party_mark" : "logo_provenance_failed",
      detail: thirdParty
        ? `${input.facts.business_name}'s stored logo candidate is a third-party mark — it cannot become their identity`
        : `${input.facts.business_name}'s stored logo candidate failed provenance validation`,
      provider_calls: { first_party_site: needSiteContent ? 1 : 0, brand_site: needSiteBrand ? 1 : 0 },
    };
  }
  if (!brand.logo && siteBrand?.hardProvenanceFailure) {
    const failure = siteBrand.hardProvenanceFailure;
    return {
      ok: false,
      reason: failure.reason === "logo_third_party_mark" ? "logo_third_party_mark" : "logo_provenance_failed",
      detail: `${input.facts.business_name}'s first-party logo candidate failed redirect provenance validation`,
      provider_calls: { first_party_site: needSiteContent ? 1 : 0, brand_site: needSiteBrand ? 1 : 0 },
    };
  }
  if (!brand.logo && siteBrand?.logo?.url) {
    const logo = httpsAssetUrl(siteBrand.logo.url);
    const thirdParty = Boolean(logo && isThirdPartyMark(logo.replace(/^https?:\/\//i, "")));
    if (!logo || thirdParty) {
      return {
        ok: false,
        reason: thirdParty ? "logo_third_party_mark" : "logo_provenance_failed",
        detail: thirdParty
          ? `${input.facts.business_name}'s first-party site exposed a third-party mark — it cannot become their identity`
          : `${input.facts.business_name}'s first-party logo candidate failed provenance validation`,
        provider_calls: { first_party_site: needSiteContent ? 1 : 0, brand_site: needSiteBrand ? 1 : 0 },
      };
    }
    brand.logo = logo;
    const logoSha256 = validLogoSha(siteBrand.logo?.sha256)
      ? String(siteBrand.logo.sha256).trim().toLowerCase()
      : sha256HexFromBase64(siteBrand.logo?.b64);
    if (logoSha256) brand.logo_sha256 = logoSha256;
    delete brand.mark;
    brandProvenance = {
      source: "first_party_site",
      source_url: siteBrand.sourceUrl || website,
      logo_pick: siteBrand.logoPick || null,
    };
    if (truthPacket && logoSha256 && /^https:\/\//i.test(String(siteBrand.sourceUrl || website || ""))) {
      truthPacket = enrichTruthPacketLogo(truthPacket, {
        logoUrl: logo,
        sourceUrl: siteBrand.sourceUrl || website,
        logoSha256,
      });
    }
  }

  if (!brand.logo) {
    if (!logoLadderFallbackEnabled()) {
      return {
        ok: false,
        reason: "no_verified_logo",
        detail: `${input.facts.business_name} has no verified logo in its packet, stored contract, or first-party site`,
        provider_calls: { first_party_site: needSiteContent ? 1 : 0, brand_site: needSiteBrand ? 1 : 0 },
      };
    }
    const mark = chooseBrandMark({
      logoCandidates: [],
      businessName: input.facts.business_name,
      accent: brand.site_accent || brand.accent || brand.accent_fallback || brand.primary || "",
    });
    brand.mark = mark;
    brandProvenance = { source: "logo_ladder", rung: mark.rung, reason: mark.reason };
  }
  if (!Array.isArray(content.services) || !content.services.length) {
    return {
      ok: false,
      reason: "no_verified_content",
      detail: `${input.facts.business_name} has no verified service list in its packet, stored contract, or first-party site`,
      provider_calls: { first_party_site: needSiteContent ? 1 : 0, brand_site: needSiteBrand ? 1 : 0 },
    };
  }

  const serviceSource = String(contentProvenance.services?.source || "").trim() || "verified";
  return {
    ok: true,
    input: {
      ...input,
      brand,
      content,
      truth_packet: truthPacket || input.truth_packet || packet,
      content_source: serviceSource,
      content_provenance: contentProvenance,
      brand_provenance: brandProvenance,
      fontSource: input.fontSource || (website && (needSiteContent || needSiteBrand) ? website : ""),
    },
    provider_calls: {
      first_party_site: needSiteContent ? Math.max(1, Number(siteResolution?.cost?.requests) || 0) : 0,
      brand_site: needSiteBrand ? 1 : 0,
    },
  };
}

/**
 * WHAT THE FACT RESOLVER ACTUALLY DID — written down, always.
 *
 * This replaces a bare `catch` whose whole body was the comment "resolver
 * down". That comment was wrong
 * about its own failure mode and the wrongness cost a day: for Carter's My
 * Plumber the resolver did not throw and was not down. It returned
 * successfully, with twelve real services scraped from the client's own site,
 * and `ok: false` — because `ok` means "meets the MirrorRequest MINIMUM
 * (name/industry/city/state/phone)", not "found nothing". The caller's
 * `if (v && v.ok !== false)` then threw the entire result away, services and
 * all, and no line of any build report ever mentioned that a resolver ran.
 *
 * So two things are recorded here, separately, because they are different
 * questions an operator has to be able to answer:
 *   · which FIELDS resolved (the resolver's actual product), and
 *   · which SOURCES failed and why (`http_403:API_KEY_HTTP_REFERRER_BLOCKED`,
 *     `serp_unavailable`, `gateway reported lowConfidence` — every one of which
 *     was invisible until now).
 * `ok:false` is reported as `partial`, never as a failure, because a partial
 * result is evidence and evidence is never discarded.
 */
function factResolutionReport(value, error) {
  if (error) {
    return {
      status: "threw",
      reason: boundedDetailText((error && error.message) || error, 200),
      resolved_facts: [],
      resolved_content: [],
      sources: [],
      withheld: [],
    };
  }
  if (!value) return { status: "no_result", resolved_facts: [], resolved_content: [], sources: [], withheld: [] };
  const facts = isObject(value.facts) ? value.facts : {};
  const content = isObject(value.content) ? value.content : {};
  return {
    status: value.ok === false ? "partial" : "resolved",
    resolved_facts: Object.keys(facts),
    resolved_content: Object.keys(content).filter((key) => {
      const v = content[key];
      return Array.isArray(v) ? v.length > 0 : Boolean(v);
    }),
    coverage: value.coverage || null,
    // The named reason each observer produced nothing, kept verbatim.
    sources: (Array.isArray(value.sources) ? value.sources : []).map((source) => ({
      id: source.id,
      status: source.status,
      ...(source.error ? { error: source.error } : {}),
      ...(source.note ? { note: source.note } : {}),
      fields: source.fields || [],
    })),
    withheld: (Array.isArray(value.withheld) ? value.withheld : []).map((w) => `${w.field}:${w.reason}`),
    // The fields sources actively DISAGREED about, kept separate from the ones
    // nobody observed. Silence and contradiction are different answers and the
    // fallback below treats them differently — see withheldAddress().
    conflicts: (Array.isArray(value.conflicts) ? value.conflicts : []).map((c) => c.field).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// A CONTESTED ADDRESS IS NOT PUBLISHED. NOT EITHER SPELLING. NEITHER CITY.
// ---------------------------------------------------------------------------
//
// The verified-facts resolver already gets this right and always did. Run
// against the real Air Creation record on 2026-08-11 it returned, unprompted:
//
//   field "address"      resolution "absent"
//     google_gbp     "11616 Cedar Park Ave, Baton Rouge, LA 70809, USA"
//     their own site  streetAddress "St Ferdinand St", postalCode 70802
//   field "postal_code"  resolution "absent"   (70809 vs 70802)
//
// Two sources, two different streets, two different ZIPs. The resolver refused
// to pick one, which is the correct and careful answer.
//
// And the mirror published "11616 Cedar Park Ave, Baton Rouge, LA 70809, USA"
// anyway — byte-identical to the stored contract, trailing "USA" and all, which
// is the fingerprint proving it never came through the resolver at all. The
// fallback did it:
//
//     const value = String(vf[key] || contract[key] || "").trim();
//
// `vf.address` was correctly undefined, so `||` reached straight past the
// verdict to the raw Google value the miner had frozen months earlier and
// printed that. The conflict was detected, recorded, and then overruled by an
// operator precedence rule. Same for the ZIP.
//
// THE DISTINCTION THAT MAKES THIS SAFE. `withheld` and `conflicts` are not the
// same thing and only one of them may veto the fallback:
//   · WITHHELD means nobody observed the field. The contract is then the best
//     evidence we have and carrying it forward is the entire reason
//     CONTRACT_STRING_FACTS exists — that behaviour is untouched.
//   · CONFLICT means two sources looked and disagreed. There is no evidence to
//     carry, only a coin to flip, and the contract is simply one of the two
//     faces of the coin.
//
// WHY THE CITY DRAGS THE STREET DOWN WITH IT. A street address is only an
// address inside a city; "11616 Cedar Park Ave" in the wrong town is a set of
// directions to somebody else's front door. So a contested city withholds the
// street too — while the city ITSELF keeps its normal fallback, because the
// market copy needs a place name and "HVAC in Baton Rouge" is true whichever
// street is right. The map and the NAP row degrade to city/state on their own:
// both are built with `[facts.address, napMarket].filter(Boolean)`.
//
// Omitting an address costs a line of the contact block. Publishing the wrong
// one sends a customer to the wrong building and tells Google we do not know
// where our own client is.
const ADDRESS_FIELDS = ["address", "postal_code"];

function withheldAddress(conflicts = []) {
  const contested = new Set((Array.isArray(conflicts) ? conflicts : []).filter(Boolean));
  if (contested.has("address")) return { withhold: true, reason: "sources_disagree_on_street" };
  if (contested.has("city")) return { withhold: true, reason: "sources_disagree_on_city" };
  if (contested.has("state")) return { withhold: true, reason: "sources_disagree_on_state" };
  if (contested.has("postal_code")) return { withhold: true, reason: "sources_disagree_on_postal_code" };
  return { withhold: false, reason: "" };
}

/**
 * HOTLINK-UNTIL-PAY (docs/standards/hotlink-until-pay.md): the lane carries a
 * media_mode through to the engine's brand block when the caller states one —
 * "origin" for an unpaid prospect's preview (their verified URLs, zero of
 * their bytes housed), "housed" for the post-payment re-mirror the checkout
 * webhook fires. Unstated means the engine's own default (housed), so every
 * existing caller's builds are byte-for-byte unchanged.
 */
function laneMediaMode(opts = {}) {
  const mode = String((opts && opts.mediaMode) || "").trim().toLowerCase();
  return mode === "origin" || mode === "housed" ? { media_mode: mode } : {};
}

/**
 * buildMirrorForProspect(prospect, opts) resolves the full lane and returns a
 * result shaped for a pipeline stage. `opts.deps` injects resolvers for tests;
 * production uses the real ones. Every external call fails soft: a dead website
 * still builds (fewer photos), an unreachable resolver falls back to the
 * prospect's own fields — it never invents.
 */
/**
 * THE TOWNS AROUND THEM — the near-me surface.
 *
 * Every local business's most valuable SEO asset is the ring of towns it sits
 * inside: the person searching "ac repair near me" is usually in the next town
 * over. The donors ship a coverage block for exactly this and it rendered empty
 * on every mirror, because nothing populated it and no donor ever could — the
 * answer is different for every client.
 *
 * MEASURED, never listed. lib/mirror-engine/nearby-cities probes a ring around
 * the client's VERIFIED coordinates and asks the US Census which real place
 * contains each point. Fail-soft to nothing: a template that shipped ten
 * invented neighbouring towns is precisely what this pipeline exists to refuse.
 *
 * Both build paths — the LeadMiner packet and the resolver — run through here,
 * so the behaviour cannot drift between them.
 */
async function withNearbyTowns(content = {}, facts = {}, prospect = {}) {
  if (Array.isArray(content.nearby) && content.nearby.length) return content;
  const record = (prospect && prospect.record) || {};
  const cached = Array.isArray(record.nearby_cities)
    ? record.nearby_cities
    : (Array.isArray(prospect.nearby_cities) ? prospect.nearby_cities : null);
  if (cached && cached.length) return { ...content, nearby: cached.slice(0, 6) };

  const lat = Number(facts.latitude);
  const lng = Number(facts.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return content;
  try {
    const towns = await nearbyCities({ lat, lng, excludeCity: facts.city, count: 6 });
    return towns.length ? { ...content, nearby: towns } : content;
  } catch {
    return content;
  }
}

// ---------------------------------------------------------------------------
// THE CONTENT FLOOR — the one thing that separates a mirror from a template
// ---------------------------------------------------------------------------
//
// THE DEFECT. In the owner's Oregon run, D&F Plumbing, Jam Plumbing and Rescue
// Rooter deployed with `checks.content.status === "none"`: zero injected
// sections, a 5,533-character home page against ~8,100 for the leads that got
// content. A donor template wearing the client's logo. Every gate was green,
// because none of them was asking this question — `revealable` is computed from
// hydration_parse / token_scan / identity_scan / brand / asset_diff / deep_link
// / alias_target / render / routes / route_render, and a truthful empty page
// passes all ten. So it shipped quietly, under an email that says "here is your
// new website".
//
// WHY IT BLOCKS, when signup_panel deliberately does not.
//
// The argument against blocking is real and I want it written down rather than
// waved away. `revealable` means TRUTH AND IDENTITY: it answers "is this
// honestly this client's site". A thin page is not a lie about the client —
// nothing on it is false — so a quality gate hung off `revealable` overloads a
// word that operators already read as "did we misrepresent someone", and the
// refusal string `mirror_build_not_revealable` becomes ambiguous. That ambiguity
// has already cost a day once (see the signup_panel note below). Worse, a
// quality gate wired to external providers can strand EVERY build at once the
// day one of them is down, which is precisely why the sign-up panel is loud and
// non-blocking.
//
// It still blocks, for three reasons that do not apply to the panel:
//
//   1. THE PANEL'S ABSENCE COSTS US A SALE; THIS ONE COSTS US THE PROSPECT.
//      A mirror with no sign-up floater is still a good website that we forgot
//      to put a price on, and we can send the same client a better one next
//      week. A mirror with no content is the pitch itself failing in front of
//      the only person we are pitching. There is no second first impression.
//
//   2. IT CANNOT BE STRANDED BY ONE PROVIDER. The floor is met by ANY ONE of
//      six substance channels, and they do not share a dependency: services and
//      FAQs come from a free HTTP GET of the client's own site, reviews and
//      hours from Google through the pinned gateway, areas and about from the
//      stored contract or an intake packet. For this check to fail everywhere
//      at once, the client's website AND Google AND our own stored contracts
//      would all have to be silent — at which point we have a logo and nothing
//      else, and refusing to send is the correct answer, not a false alarm.
//
//   3. IT IS MEASURED OFF THE EMITTED BYTES, not asserted. `sections` is counted
//      by content-inject from the HTML it actually produced. There is no
//      judgement call to get wrong, and no "QC PASS" standing in for a render.
//
// So: a NAMED check, `content_floor`, reported in `checks` alongside the
// engine's own so the existing refusal path prints `content_floor=failed`
// without a line of change anywhere else — and `revealable` is cleared. The
// distinction that keeps `revealable` honest is preserved in the REASON, which
// says content_floor and never implies we got the client wrong.
//
// The floor is deliberately LOW. One channel clears it. A business with a
// genuinely thin public footprint still gets its smaller, truthful site — that
// is the truth law working, and this check must never become a reason to invent
// a section to clear it.
//
// THE GENERATED-FAQ LOOPHOLE, closed on purpose. content-inject falls back to
// `verifiedFaqs()` when the client supplies none, so a request carrying nothing
// but `nearby` still emits a FAQ section and a trust rail — two sections, off
// zero client content. Counting bytes alone would call that a pass. So the floor
// requires BOTH: at least one substance channel supplied by this lane, AND at
// least one section in the emitted HTML. `nearby` is excluded from the substance
// list for the same reason: driving directions from the next town over are true
// and worth having, but they are not what the client is buying.
const SUBSTANCE_CHANNELS = Object.freeze(["services", "reviews", "hours", "faqs", "areas", "about"]);

/**
 * THE FLOOR'S OWN SENTENCE — what the operator's row should have said on
 * 2026-08-31, when American Rooter Plumbing and Micro Plumbing Inc. (both
 * Omaha NE, both fresh-mined, both certified by the Intake Genie compile at
 * pick) died as a bare `content_floor=failed` after full 240s builds.
 *
 * That string is assembled one layer up (lib/full-run) from
 * `${name}=${check.status}` — a LABEL. The verdict, the per-channel counts,
 * and the one fact that would have explained the whole death (whether the
 * certified compile's substance reached the request, and if not, the exact
 * receipt-verification reason it was dropped for) were all sitting on this
 * check and none of them printed. The next occurrence must be diagnosable
 * from the row alone.
 *
 * `diag` is optional and purely informational: { photos, nap, needs_fill,
 * certified_compile }. None of it can CHANGE the verdict — the bar stays
 * exactly where it is, and an unverified receipt still contributes nothing
 * (the signature IS the anti-fabrication guarantee; the owner's rule is
 * never to build from nothing, and equally never to trust an unsigned
 * "something").
 */
function contentFloorDiagnostic(counts = {}, diag = {}, native = "") {
  const parts = [SUBSTANCE_CHANNELS.map((key) => `${key}:${counts[key] ?? 0}`).join(",")];
  // The donor-native sentence rides SECOND, ahead of photos/NAP/compile, so a
  // capped row can never cut the one part that names the failing link.
  if (native) parts.push(native);
  if (Number.isInteger(diag.photos)) parts.push(`photos:${diag.photos}`);
  if (diag.nap) parts.push(`nap:${diag.nap}`);
  if (diag.needs_fill === true) parts.push("needs_fill:yes");
  const cc = diag.certified_compile;
  if (cc && typeof cc === "object") {
    if (cc.status === "verified") {
      parts.push(`compiled:verified(services:${cc.services ?? 0},about:${cc.about ? "yes" : "no"},faqs:${cc.faqs ?? 0})`);
    } else {
      parts.push(`compiled:${cc.status}${cc.reason ? `(${cc.reason})` : ""}`);
    }
  }
  return parts.join(" | ").slice(0, 300);
}

function contentFloorReport(content = {}, body = {}, diag = {}, { verification = "full" } = {}) {
  const supplied = SUBSTANCE_CHANNELS.filter((key) => {
    const value = content && content[key];
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "string" ? Boolean(value.trim()) : false;
  });
  const counts = Object.fromEntries(
    SUBSTANCE_CHANNELS.map((key) => [key, Array.isArray(content[key]) ? content[key].length : (content[key] ? 1 : 0)]),
  );
  const base = {
    channels: supplied,
    counts,
    nearby: (content.nearby || []).length,
    ...(diag.certified_compile ? { certified_compile: diag.certified_compile } : {}),
  };

  if (!supplied.length) {
    return {
      ...base,
      // The self-describing sentence rides on EVERY verdict, pass or fail, so a
      // green build can be audited for near-misses with the same one read.
      diagnostic: contentFloorDiagnostic(counts, diag),
      status: "failed",
      verdict: "no_verified_content",
      sections: 0,
      reason: "no verified content of the client's own resolved from any source — this would ship as the donor template wearing their logo",
    };
  }

  const contentCheck = (body && body.checks && body.checks.content) || null;
  if (!contentCheck) {
    return {
      ...base,
      diagnostic: contentFloorDiagnostic(counts, diag),
      status: "failed",
      verdict: "not_injected",
      sections: 0,
      reason: `content resolved (${supplied.join(", ")}) but the engine never ran content injection`,
    };
  }
  const sections = Number(contentCheck.sections) || 0;
  // Some clean donors render the verified content inside their own components
  // from the emitted window.__WSS_CONTENT__ island. For those donors, zero
  // appended `section.wss-c` nodes is deliberate: adding another section would
  // duplicate the services/FAQ/coverage already present in the design. Count
  // that path only when every piece of evidence agrees — the route render
  // passed, the island was written, the audited donor manifest declares content
  // consumption, names a supplied channel, and its exact visible target changed
  // against an empty-channel baseline while rendering this build's phrase.
  const donorRenders = new Set(
    (Array.isArray(contentCheck.donor_renders) ? contentCheck.donor_renders : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const nativeAliases = {
    services: ["services"],
    reviews: ["reviews"],
    hours: ["hours"],
    faqs: ["faq", "faqs"],
    areas: ["area", "areas", "coverage"],
    about: ["about"],
  };
  const renderedHome = (((body || {}).checks || {}).route_render?.pages || [])
    .find((page) => page && page.path === "/");
  const routeRenderCheck = ((body || {}).checks || {}).route_render || null;
  const nativePreconditions = [];
  if (routeRenderCheck?.status !== "passed") {
    nativePreconditions.push(`route_render:${(routeRenderCheck && routeRenderCheck.status) || "missing"}`);
  }
  if (contentCheck.data_island !== true) nativePreconditions.push("data_island:no");
  if (contentCheck.donor_consumes_content !== true) nativePreconditions.push("donor_consumes:no");
  const nativeRouteReady = nativePreconditions.length === 0;
  const claimedNativeChannels = supplied.filter((channel) =>
    (nativeAliases[channel] || [channel]).some((alias) => donorRenders.has(alias)));
  const nativeChannels = nativeRouteReady
    ? claimedNativeChannels.filter((channel) => (
      renderedHome?.content_channels?.[channel]?.target_checked === true
        && renderedHome?.content_channels?.[channel]?.baseline_checked === true
        && renderedHome?.content_channels?.[channel]?.target_changed === true
        && Number(renderedHome?.content_channels?.[channel]?.rendered) > 0
    ))
    : [];
  // LIGHT VERIFICATION (GHOST_AGENCY_LIGHT_VERIFICATION, owner directive
  // 2026-09-01): the per-channel pixel proof — target checked, baseline
  // re-rendered empty, target text changed — is the expensive browser half of
  // this floor. Light mode does not fake it and does not demand it: a channel
  // the donor manifest CLAIMS is accepted as claimed, and the pass says so
  // (`native_proof: "skipped_light_verification"`). The channel accounting
  // above is untouched — a row with NO supplied substance channel still
  // refuses, exactly as before. "0" restores the full proof verbatim.
  const nativeProofSkipped = verification === "light" && claimedNativeChannels.length > 0;
  const nativeChannelsUnproven = nativeProofSkipped
    ? []
    : claimedNativeChannels
      .filter((channel) => !nativeChannels.includes(channel));
  // A donor that claims a channel suppresses that shared appended section.
  // Other appended sections therefore cannot cover for any broken native
  // bridge: every supplied, donor-owned channel must independently change its
  // audited target against an empty-channel baseline.
  if (nativeChannelsUnproven.length) {
    // HAYS ROOFING, 2026-08-31: five supplied channels, seven photos, NAP, a
    // verified Genie compile — killed by a one-line manifest gap. The donor
    // declared `renders: ["services","faq"]` but `content_render_targets`
    // named only `services`, so the FAQ channel had NO selector to prove and
    // `target_checked` was false by construction. The bar is right (a claimed
    // channel must be proven visible); the sentence was not — the row said
    // none of this. Every unproven channel now names the exact broken link:
    //   no_target_declared — the donor manifest claims the channel but names
    //     no content_render_target for it (fix the manifest, not the build)
    //   target_not_found  — a declared selector matched nothing visible (the
    //     donor changed under a stale selector; fix the manifest)
    //   baseline_not_run / target_unchanged / rendered_none — the audit ran
    //     and the bridge genuinely did not prove the content visible
    const why = {};
    for (const channel of nativeChannelsUnproven) {
      const report = renderedHome?.content_channels?.[channel];
      why[channel] = !report || typeof report !== "object" ? "no_audit"
        : report.target_checked === true
          ? report.baseline_checked !== true ? "baseline_not_run"
            : report.target_changed !== true ? "target_unchanged"
              : Number(report.rendered) > 0 ? "unproven" : "rendered_none"
          : Number(report.targets_expected) > 0 ? "target_not_found" : "no_target_declared";
    }
    const nativeSentence = `native_unproven:${nativeChannelsUnproven.map((channel) => `${channel}(${why[channel]})`).join("+")}`
      + (nativePreconditions.length ? `@${nativePreconditions.join(",")}` : "");
    return {
      ...base,
      diagnostic: contentFloorDiagnostic(counts, diag, nativeSentence),
      status: "failed",
      verdict: "lost",
      sections,
      native_channels_unproven: nativeChannelsUnproven,
      native_channels_why: why,
      ...(nativePreconditions.length ? { native_preconditions: nativePreconditions } : {}),
      reason: nativePreconditions.length
        ? `verified ${nativeChannelsUnproven.join(", ")} content was reserved for donor-native rendering, but the native proof never ran (${nativePreconditions.join(", ")})`
        : `verified ${nativeChannelsUnproven.join(", ")} content was reserved for donor-native rendering, but its audited home-page target did not prove it visible (${nativeChannelsUnproven.map((channel) => `${channel}: ${why[channel]}`).join("; ")})`,
    };
  }
  if (claimedNativeChannels.length) {
    return {
      ...base,
      diagnostic: contentFloorDiagnostic(counts, diag,
        nativeProofSkipped
          ? `native:${claimedNativeChannels.join("+")}@light_unverified`
          : `native:${nativeChannels.join("+")}`),
      status: "passed",
      verdict: "met",
      sections,
      render_mode: "donor_native",
      native_channels: nativeProofSkipped ? claimedNativeChannels : nativeChannels,
      ...(nativeProofSkipped ? { native_proof: "skipped_light_verification" } : {}),
      reason: "",
    };
  }
  if (contentCheck.status === "none" || sections < 1) {
    return {
      ...base,
      diagnostic: contentFloorDiagnostic(counts, diag),
      status: "failed",
      verdict: "lost",
      sections,
      reason: `content resolved (${supplied.join(", ")}) but the emitted HTML carries no injected section`,
    };
  }
  return { ...base, diagnostic: contentFloorDiagnostic(counts, diag), status: "passed", verdict: "met", sections, reason: "" };
}

/**
 * Assemble the floor's diagnostic context at the two build-path call sites.
 *
 * THE ONE QUESTION THIS ANSWERS on a dead row: did the Intake Genie compile's
 * certified substance reach the request, and if not, why? `certifiedGenieContent`
 * is the dispatch-time re-verification (certifiedGenieContentFromRecord); its
 * `.ok` decides whether the canonical packet's about/faqs/services were merged
 * into request.content at all — and its `.reason` used to be dropped on the
 * floor right where it was computed, so a receipt that failed re-verification
 * for a strict identity check (city, name, domain, expiry, key…) silently
 * erased every trace that a compile had ever run.
 */
function contentFloorDiagnostics({ facts = {}, photos = null, needsFill = false, certifiedGenieContent = null, record = {} } = {}) {
  const napBits = [
    ...(facts && facts.phone ? ["phone"] : []),
    ...(facts && facts.address ? ["address"] : []),
  ];
  const hasCanonicalPacket = isObject(record) && isObject(record.genie_canonical_packet);
  let certifiedCompile = null;
  if (hasCanonicalPacket) {
    certifiedCompile = certifiedGenieContent && certifiedGenieContent.ok === true
      ? {
        status: "verified",
        services: (Array.isArray(certifiedGenieContent.services) ? certifiedGenieContent.services : []).length,
        about: Boolean(typeof certifiedGenieContent.canonical_packet?.about === "string"
          && certifiedGenieContent.canonical_packet.about.trim()),
        faqs: (Array.isArray(certifiedGenieContent.canonical_packet?.faqs)
          ? certifiedGenieContent.canonical_packet.faqs : []).length,
      }
      : {
        status: "unverified",
        reason: String((certifiedGenieContent && certifiedGenieContent.reason) || "receipt_invalid").slice(0, 120),
      };
  }
  return {
    ...(Number.isInteger(photos) ? { photos } : {}),
    ...(napBits.length ? { nap: napBits.join("+") } : {}),
    ...(needsFill === true ? { needs_fill: true } : {}),
    ...(certifiedCompile ? { certified_compile: certifiedCompile } : {}),
  };
}

/**
 * THE SERVICE FLOOR — the owner's rule, in his own words: "If a business ends up
 * with too few real services to publish, that is a REFUSAL (build held, honest
 * reason), not a page with menu items on it."
 *
 * WHAT IT IS FOR, AND WHY IT IS SEPARATE FROM THE CONTENT FLOOR.
 *
 * The content floor above asks "did we resolve ANY of the client's own content",
 * and one channel clears it — so a mirror with seven Google reviews and zero
 * services passes it, correctly. This asks a narrower question the content floor
 * cannot: is the SERVICES SECTION, the part of the page that says what this
 * business does, actually made of services?
 *
 * That question had no gate at all until now, and the fleet audit of 2026-08-11
 * measured the consequence: 18 of 100 live mirrors published a navigation item,
 * a button or a membership club inside a schema.org `Service` node. Because
 * content-inject's seoDescription() leads with `services[0]`, eighteen Google
 * snippets opened with one — "Photo Gallery in Portland, OR. Rated 4.9 from 608
 * Google reviews." The prospect's first impression of the site we built them was
 * a search result claiming they sell a photo gallery.
 *
 * service-names.js now refuses those labels wherever they appear, which means
 * the failure mode has MOVED rather than gone: a mirror whose entire service
 * list was menu items now has a very short one, or none, and would ship with a
 * one-card grid and the donor's generic paragraph as its meta description. That
 * is what this check refuses.
 *
 * IT BLOCKS, for the same three reasons the content floor does — the pitch fails
 * in front of the only person being pitched; it cannot be stranded by an outage,
 * because the list comes from the client's own site and their own stored
 * contract; and it is counted off the list that is about to be published, not
 * asserted. And like the content floor it reports as a NAMED check with its own
 * reason, so `revealable` never has to mean "the service list was thin".
 *
 * THE FLOOR IS ONE (owner directive 2026-08-13: build with what's real, don't
 * refuse a live business over a thin service list). It is env-tunable without a
 * code change (MIRROR_SERVICE_FLOOR): 0 turns the gate off entirely, 2 or 3
 * restore the stricter "a grid needs N cards to look finished" posture. At the
 * default of 1 the ONLY thing still held is a list where every harvested label
 * is navigation junk — a button, a headline, a membership program — which would
 * otherwise ship "Home / Contact / Get a Quote" as the client's service list.
 * A business that genuinely sells one or two things now BUILDS; the held row
 * still names exactly what was dropped and why.
 */
const SERVICE_FLOOR_DEFAULT = 1;

function serviceFloor() {
  const raw = Number(process.env.MIRROR_SERVICE_FLOOR);
  return Number.isInteger(raw) && raw >= 0 ? raw : SERVICE_FLOOR_DEFAULT;
}

const serviceLabels = (list) => (Array.isArray(list) ? list : [])
  .map((s) => (typeof s === "string" ? s : (s && (s.name || s.title)) || ""))
  .map((s) => String(s).replace(/\s+/g, " ").trim())
  .filter(Boolean);

/**
 * `rawLabels` is what the SOURCES supplied, before contentFromVerified and
 * contentFromContract dropped the unpublishable ones. Without it this check
 * could only ever say "no service list resolved" about a business whose site
 * offered four labels and had all four refused — true in the letter and a lie
 * in the substance, and naming what was dropped is the whole point.
 */
function serviceFloorReport(content = {}, rawLabels) {
  const floor = serviceFloor();
  const publishableList = serviceLabels(content.services);
  const names = Array.isArray(rawLabels) && rawLabels.length ? serviceLabels(rawLabels) : publishableList;
  const refused = names
    .map((name) => ({ name, reason: articleHeadlineReason(name) }))
    .filter((x) => x.reason);
  const publishable = publishableList.filter((name) => !articleHeadlineReason(name));
  const base = {
    floor,
    supplied: names.length,
    publishable: publishable.length,
    // Named, never merely counted. A shortened list that cannot say what it lost
    // is how this defect survived three separate fixes.
    refused: refused.slice(0, 12),
    names: publishable.slice(0, 12),
  };
  if (floor === 0) return { ...base, status: "passed", verdict: "floor_disabled", reason: "" };
  if (publishable.length >= floor) return { ...base, status: "passed", verdict: "met", reason: "" };
  if (!names.length) {
    return {
      ...base,
      status: "failed",
      verdict: "no_services_resolved",
      reason: "no service list resolved from the client's own site, their declared offer catalogue or their stored contract — the services section would be absent and the meta description would stay the donor's generic paragraph",
    };
  }
  if (!publishable.length) {
    return {
      ...base,
      status: "failed",
      verdict: "all_refused",
      reason: `every one of the ${names.length} harvested service labels is a navigation item, a button or a headline (${refused.slice(0, 4).map((r) => `${r.name}=${r.reason}`).join(", ")}) — this would have shipped as the client's service list`,
    };
  }
  return {
    ...base,
    status: "failed",
    verdict: "below_floor",
    reason: `only ${publishable.length} of ${names.length} harvested labels are real services (need ${floor}); refused ${refused.slice(0, 4).map((r) => `${r.name}=${r.reason}`).join(", ")}`,
  };
}

/**
 * THE PANEL'S OWN LINE IN THE BUILD REPORT — so it can never go missing quietly
 * again.
 *
 * Two facts, deliberately kept apart:
 *   · CONFIGURED — what resolveSignupConfig decided we were entitled to show.
 *   · PRESENT    — what content-inject actually wrote into the emitted HTML,
 *                  counted off the bytes it produced.
 * A config that says "ok" is not proof the panel shipped, and today's Blogger
 * badge (10/10 gates green over somebody else's trademark) is the standing
 * reminder of why those are two different questions. So `status` names the
 * exact stage that failed rather than collapsing to a boolean:
 *   present | unconfigured | not_injected | lost
 *
 * IT DOES NOT BLOCK `revealable`, ON PURPOSE. The gates in computeRevealable
 * are TRUTH and IDENTITY gates — brand, identity_scan, nap, render. A missing
 * sign-up panel is a commercial defect, not a truth defect: nothing about the
 * client is misstated by its absence, and the site is still honestly theirs.
 * Blocking on it would also mean one unset environment variable strands EVERY
 * build in the system, reported to the operator as "mirror_build_not_revealable"
 * — the exact lie-by-omission that already cost a day. Loud and non-blocking is
 * the correct trade here; `checks.content.signup_panel` and this field both
 * carry the reason in words an operator can act on.
 */
function signupPanelReport(panel = {}, body = {}) {
  const diagnostics = panel.diagnostics || {};
  const base = {
    configured: Boolean(panel.ok && panel.signup),
    client_id: diagnostics.client_id || "",
    riley_display: diagnostics.riley_display || "",
    riley_source: diagnostics.riley_source || "",
    checkout_configured: Boolean(diagnostics.checkout_configured),
    warnings: Array.isArray(panel.warnings) ? panel.warnings : [],
  };
  if (!base.configured) {
    return { ...base, status: "unconfigured", present: false, reason: panel.reason || "signup_panel_unconfigured" };
  }

  const contentCheck = (body && body.checks && body.checks.content) || null;
  // The engine only runs content injection when the request carries content,
  // and the panel rides in on that same pass. A configured panel with no
  // content check is a panel that was never given the chance to render.
  if (!contentCheck) {
    return {
      ...base,
      status: "not_injected",
      present: false,
      reason: "signup_panel_configured_but_content_injection_never_ran",
    };
  }
  const rendered = contentCheck.signup_panel || null;
  if (!rendered || !rendered.present) {
    return {
      ...base,
      status: "lost",
      present: false,
      reason: (rendered && rendered.reason) || "signup_panel_configured_but_absent_from_emitted_html",
    };
  }
  return {
    ...base,
    status: "present",
    present: true,
    reason: "",
    pages: rendered.pages || 0,
    bytes: rendered.bytes || 0,
  };
}

/**
 * The pride list caps, mirrored from mirror-request.schema.json
 * (/content/pride/sections/* maxItems). Raised from 6/6/4/4 to 24/24/12/12 by
 * the owner's directive — "If they have more content than we can handle, we
 * still dump it in" — so the schema, this truncation safety net, the
 * brief-loud producer caps below (withBriefTrust) and the badge bridge
 * (withBriefBadges) all agree on one number. Single source of truth for the
 * producer side; change the schema and this together.
 */
const PRIDE_LIST_CAPS = { credentials: 24, differentiators: 24, promotions: 12, plans: 12 };

/**
 * THEIR OWN WORDS, WHEN THEY ARE PROVEN.
 *
 * The pride block (lib/owner-pride.js) reduces a stored owner-behind
 * extraction to only the entries a site may honestly render: status FOUND,
 * confidence above low, at least one evidence quote carrying a source URL —
 * and then VERBATIM, never our paraphrase.
 *
 * FOR MONTHS THIS RETURNED ONLY THE TAGLINE. The module was built to carry
 * their motto, their maintenance plans with real prices, their manufacturer
 * relationship and licence number, their promotions and their published
 * service-area footprint — the exact list the owner-behind audit found missing
 * from two rebuilds — and the renderer for it was never written, so everything
 * but the tagline was computed and thrown away on every build.
 *
 * Most cold prospects have no extraction stored, so this returns null and the
 * page simply has no pride block. That is honest; an invented one is not.
 */
function prideBlockFor(prospect = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const extraction = record.owner_behind || prospect.owner_behind;
  if (!extraction) return null;
  try {
    const pride = prideFromExtraction(extraction, {
      clientDomain: String(prospect.site || prospect.current_website || "").replace(/^https?:\/\//i, "").split("/")[0],
    });
    if (!pride || !pride.sections) return null;
    // THE UNVERIFIED-CLAIMS LIST OUTRANKS US. The miner records the claims a
    // client's own site makes that we could NOT verify, and render-gate fails
    // any build that publishes one. A pride entry that collides with that list
    // is dropped here rather than argued about downstream: the gate stays
    // authoritative and the build stays shippable.
    const banned = (Array.isArray(record.unverified_claims) ? record.unverified_claims : [])
      .map((c) => String(c || "").toLowerCase().replace(/\s+/g, " ").trim())
      .filter((c) => c.length >= 3);
    if (banned.length) {
      const collides = (s) => {
        const v = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
        return !!v && banned.some((b) => v.includes(b));
      };
      const S = pride.sections;
      for (const key of ["tagline", "heritage", "ownership", "financing"]) {
        if (S[key] && collides(S[key].value)) delete S[key];
      }
      if (S.credentials) S.credentials = S.credentials.filter((c) => !collides(c.label));
      if (S.differentiators) S.differentiators = S.differentiators.filter((d) => !collides(d.text));
      if (S.promotions) S.promotions = S.promotions.filter((p) => !collides(p.text));
      if (S.plans) S.plans = S.plans.filter((p) => !collides(p.name));
      if (!Object.keys(S).length) return null;
    }
    // The mirror-request schema caps the pride lists (credentials 24,
    // differentiators 24, promotions 12, plans 12 — raised from 6/6/4/4 by the
    // owner's "we still dump it in" directive: rich verified content is KEPT,
    // not cut). A business with a twenty-fifth award must truncate, not 400 the
    // whole build (production: Roof It Right, 2026-09-01 — invalid_request
    // /content/pride/sections/credentials killed a full 185s build over one
    // extra badge). UNCONDITIONAL: the original fix ran this only inside the
    // banned-claims branch, so a clean extraction with a 7th badge still 400'd —
    // the safety net now truncates every pride block, not just the colliding ones.
    const S = pride.sections;
    for (const [prideKey, prideCap] of Object.entries(PRIDE_LIST_CAPS)) {
      if (Array.isArray(S[prideKey]) && S[prideKey].length > prideCap) S[prideKey] = S[prideKey].slice(0, prideCap);
    }
    for (const key of ["credentials", "differentiators", "promotions", "plans"]) {
      if (S[key] && !S[key].length) delete S[key];
    }
    return Object.keys(pride.sections).length ? pride : null;
  } catch {
    return null;
  }
}

/**
 * Their motto alone, for the hero. The engine now reads `content.pride`
 * directly, so this stays as the explicit `hero.tagline` door the request
 * schema has always documented — same value, same evidence bar.
 */
function provenTagline(prospect = {}) {
  const pride = prideBlockFor(prospect);
  const tagline = pride && pride.sections && pride.sections.tagline;
  return tagline && tagline.value ? String(tagline.value).trim() : "";
}

/**
 * Attach the pride block to a content object, or return it untouched.
 *
 * BOTH BUILD PATHS CALL THIS, for the same reason both now ask
 * resolveSignupConfig for a panel and verifiedBrandOf for a logo: two paths
 * that assemble the same request by hand is how a feature ends up live on one
 * lane and missing on the other, silently, for weeks.
 */
function withPride(content, prospect) {
  const pride = prideBlockFor(prospect);
  if (!pride) return content || {};
  return { ...(content || {}), pride };
}

/**
 * THE MEASURED COLOUR OF THEIR OWN SITE, on both lanes.
 *
 * The engine has read `request.client_surface` since the theme layer shipped
 * and neither lane ever sent one, so `decideMode` always took
 * `no_measurement_default_light` and theme.js's dark branch could not be
 * reached by any real business. Light stays the default — 95.2% of the measured
 * fleet is light and that is what the owner asked for — but a client whose own
 * site MEASURED dark now gets a dark mirror instead of a white one.
 *
 * Spread as `...clientSurfaceFor(prospect)` so "never measured" contributes no
 * key at all: the request schema is additionalProperties:false and an explicit
 * `client_surface: null` is a 400, not a default.
 */
function clientSurfaceFor(prospect) {
  const { surface } = clientSurfaceOf(prospect);
  return surface ? { client_surface: surface } : {};
}

// ---------------------------------------------------------------------------
// THE DESIGNER'S BRIEF — look at their site the way a designer would, FIRST.
// ---------------------------------------------------------------------------
//
// OWNER, 2026-08-12, over a screenshot of Farr Better Plumbing: their hero
// reads "BIG CITY SERVICE. SMALL TOWN VALUE" — legible in our own email's
// before-thumbnail — while the mirror we built opened "Farr Better Plumbing.
// Plumbing in Springfield, MO." His words: "our designer who's supposed to
// make our hero look and feel the same but a hundred times more razzle dazzle
// is not doing its job." lib/design-brief.js had run on 8 real sites and was
// wired into NOTHING; this is the wiring.
//
// WHAT THE BRIEF IS ALLOWED TO FEED THE REQUEST, and the evidence bar each
// value clears before it may:
//   · hero.tagline        their hero slogan, the DOM's own text verbatim
//                         (case-folded only when the DOM shouts). This is the
//                         SLOGAN RULE: a textVerified slogan becomes the h1's
//                         first line, above the name+city+rating fallback.
//   · client_surface      the measured light/dark of their own page — the
//                         field the theme engine has read since it shipped and
//                         nothing on either lane ever wrote.
//   · brand.accent_fallback  their measured ACTION colour. The logo still
//                         outranks the page (owner's rule, learned when a
//                         scraped CTA button shipped as a brand colour): this
//                         only speaks when the logo's own bytes cannot.
//   · brand.fonts         the families their site RENDERS, with a stylesheet
//                         VERIFIED to serve them (design-brief attachFontHref).
//   · content.pride       their loud, DOM-verified trust signals — the BBB
//                         line, the licence, the promo banner — mapped into
//                         the pride sections the page already renders next to
//                         the trust rail. Only textVerified entries; a claim
//                         vision read off a JPEG never reaches a page.
//
// FAIL-SOFT, ALWAYS: no website, a dead render, a missing vision key — each
// costs the brief, never the build, and the report says which happened.
//
// UNIT TESTS NEVER LAUNCH CHROMIUM. Under the node test runner
// (NODE_TEST_CONTEXT) the step is skipped unless the test opts in with
// `designBrief: true` and stubs `deps.buildDesignBrief` — the same contract
// resolveSocials honours for the same reason. MIRROR_DESIGN_BRIEF=0 is the
// operator kill-switch.
async function designBriefFor({ prospect = {}, facts = {}, opts = {}, briefImpl = null }) {
  if (opts.designBrief === false) return { status: "disabled", reason: "caller_disabled" };
  if (String(process.env.MIRROR_DESIGN_BRIEF || "").trim() === "0") return { status: "disabled", reason: "env_disabled" };
  if (process.env.NODE_TEST_CONTEXT && opts.designBrief !== true) return { status: "disabled", reason: "test_context" };
  const site = String(facts.current_website || prospect.site || prospect.current_website || "").trim();
  if (!/^https?:\/\//i.test(site)) return { status: "no_website" };
  let run = briefImpl;
  if (!run) {
    try { run = require("./design-brief").buildDesignBrief; } catch (e) {
      return { status: "unavailable", reason: boundedDetailText((e && e.message) || e, 160) };
    }
  }
  try {
    const out = await run(site, { crops: false, businessName: facts.business_name || "", timeoutMs: 35000 });
    if (!out || !out.ok) return { status: "capture_failed", reason: (out && out.reason) || "no_result" };
    return { status: "ok", brief: out.brief };
  } catch (e) {
    return { status: "threw", reason: boundedDetailText((e && e.message) || e, 200) };
  }
}

/** The brief's slogan for hero.tagline, or "". Verbatim DOM text, case-folded
 *  only when the DOM shouts — never our words. */
function briefSlogan(brief) {
  const s = brief && brief.heroSlogan && brief.heroSlogan.display;
  return s ? String(s).trim() : "";
}

/**
 * The brief's surface measurement as a schema-valid client_surface, or {}.
 * Held to the same bars lib/client-surface.js holds the fleet measurer to:
 * enough text that we saw a real page (≥200 chars), and DARK additionally
 * requires a real pixel majority — a short page whose dark hero dominates the
 * histogram is not a dark website.
 */
function briefClientSurface(brief) {
  if (!brief || !brief.surface || !(brief.mode === "light" || brief.mode === "dark")) return {};
  const mm = brief.measurements || {};
  if (!(Number(mm.visibleTextChars) >= 200)) return {};
  if (brief.mode === "dark" && !(Number(mm.pixelShare) >= 0.5)) return {};
  // The bright share travels with a light reading for the same reason darkShare
  // travels with a dark one: theme.js's cinematic-donor escape reads
  // brightShare/darkShare, and a light reading without them is indistinguishable
  // from a guess (fencing-sterling stayed dark for every light client).
  const bright = Number(mm.brightShare);
  return {
    client_surface: {
      mode: brief.mode,
      basis: "paper",
      surface: String(brief.surface).toLowerCase(),
      measured_at: brief.capturedAt || new Date().toISOString(),
      ...(Number.isFinite(bright) && bright >= 0 && bright <= 1 && brief.mode === "light" ? { brightShare: bright } : {}),
      ...(Number.isFinite(Number(mm.pixelShare)) && brief.mode === "dark" ? { darkShare: Number(mm.pixelShare) } : {}),
    },
  };
}

/** Their measured action colour, as the accent the LOGO measurement may fall
 *  back to — never an override. `{}` when the brief abstained or is unsure. */
function briefAccentFallback(brief) {
  if (!brief || !brief.accent || !/^#[0-9A-Fa-f]{6}$/.test(String(brief.accent))) return {};
  const conf = Number(brief.provenance && brief.provenance.accent && brief.provenance.accent.confidence) || 0;
  if (conf < 0.6) return {};
  const src = httpsAssetUrl(brief.finalUrl || brief.url || "");
  if (!src) return {};
  return { accent_fallback: String(brief.accent).toUpperCase(), accent_fallback_source: src };
}

/**
 * THE COLOUR THEIR SITE ACTUALLY WEARS, as a first-class challenger.
 *
 * briefAccentFallback above only speaks when the logo's bytes cannot — the
 * owner's original "logo outranks the page" rule. Family Heating showed the
 * rule's blind side: a blue-dominant site, a logo containing red, and the
 * mirror opened pinkish-red because the logo's dominant colour won unopposed.
 * The owner: "he is clearly more of a blue and off blue."
 *
 * WHAT "WEARS" MEANS, measured on familyhvac.net 2026-08-12: their painted
 * chrome is 77% white, 13% #005DAC blue, 8% #009EE2 blue and 2% #ED282F red —
 * while their ACTION colour (the buttons) is that same red. Judged by buttons
 * alone the site "agrees" with the logo and the mirror stays pinkish-red;
 * judged by what a visitor actually sees, the site is dressed in blue. So the
 * site-wear colour is the LARGEST SATURATED PAINTED CHROME AREA (the brief's
 * measured backgrounds histogram — headers, bands, footers), and the action
 * colour is only the fallback for a site whose chrome is all neutral.
 *
 * It travels as brand.site_accent whenever the measurement clears the bars
 * below, and the engine weighs it against whatever colour the logo yields
 * (brand-assets.js): same hue family, the logo keeps the accent (it is the
 * sharper measurement of the same colour); different families, the site wins
 * primary and the logo colour steps down to the secondary paint role. Which
 * side won and why is recorded in checks.brand.accent_decision, and mirrored
 * into checks.design_brief by designBriefReport.
 */
const SITE_WEAR_MIN_SHARE = 0.04; // a band, not a button: >=4% of painted area
const SITE_WEAR_MIN_SAT = 25;     // a neutral is not a colour the site wears
const SITE_WEAR_LIGHTNESS = [12, 80]; // near-black/near-white chrome abstains

function briefSiteAccent(brief) {
  if (!brief) return {};
  const src = httpsAssetUrl(brief.finalUrl || brief.url || "");
  if (!src) return {};
  let hexToHsl = null;
  try { ({ hexToHsl } = require("./capture-brand")); } catch { hexToHsl = null; }
  const candidates = (brief.measurements && brief.measurements.surfaceCandidates) || [];
  if (hexToHsl) {
    for (const c of candidates) {
      if (!c || !/^#[0-9A-Fa-f]{6}$/.test(String(c.hex || "")) || !(Number(c.share) >= SITE_WEAR_MIN_SHARE)) continue;
      const hsl = hexToHsl(c.hex);
      if (!hsl || hsl.s < SITE_WEAR_MIN_SAT) continue;
      if (hsl.l < SITE_WEAR_LIGHTNESS[0] || hsl.l > SITE_WEAR_LIGHTNESS[1]) continue;
      return { site_accent: String(c.hex).toUpperCase(), site_accent_source: src };
    }
  }
  // No saturated chrome: the action colour is what the site wears, same
  // evidence bar as the fallback.
  const fb = briefAccentFallback(brief);
  if (!fb.accent_fallback) return {};
  return { site_accent: fb.accent_fallback, site_accent_source: fb.accent_fallback_source };
}

/**
 * The RANKED photo bank for brand.photo_bank, with the design brief's identity
 * verdicts mapped onto the rows the hero wash will read:
 *   · current_hero      the row whose URL is the brief's measured heroImage —
 *                       the picture their own site leads with today
 *   · identity_critical the recurring human portrait the brief promoted
 *                       (owner/team/crew, prominent on their own site)
 * Flags can only land on rows already in the bank, and the bank only ever
 * holds photographs that passed the ownership gate (their site or their GBP)
 * — so a stock image or another business's person structurally cannot be
 * flagged. Returns { photo_bank } or {} when there is no fresh bank.
 *
 * `ensureUrls` (the photos array about to travel as brand.photos) is extended
 * in place, front-first, so a flagged photograph is always among the fetched
 * bytes: a bank row the engine has no bytes for cannot become the wash.
 */
function briefFlaggedBank(bank, brief, ensureUrls, max = MAX_PHOTOS) {
  if (!bank || !Array.isArray(bank.photos) || !bank.photos.length) return {};
  const heroUrl = brief && brief.heroImage ? String(brief.heroImage.url || "") : "";
  const critical = new Set(
    (brief && Array.isArray(brief.identityImages) ? brief.identityImages : [])
      .filter((e) => e && e.identityCritical)
      .map((e) => String(e.url || ""))
      .filter(Boolean),
  );
  const rows = bank.photos.map((p) => ({
    url: String(p.url || ""),
    ...(p.sha256 ? { sha256: p.sha256 } : {}),
    ...(p.grade ? { grade: p.grade } : {}),
    stock_caption_suspect: !!p.stock_caption_suspect,
    ...(Number(p.width) ? { width: Number(p.width) } : {}),
    ...(Number(p.height) ? { height: Number(p.height) } : {}),
    // The harvest source travels with the row (client-photo-bank stamps
    // "own_site" | "gbp" from its ownership gate) so pickHeroPhoto can prefer
    // the client's own site's photography for the hero. Only the two values
    // the gate actually writes pass; anything else stays off the row rather
    // than becoming invented provenance.
    ...(p.source === "own_site" || p.source === "gbp" ? { source: p.source } : {}),
    ...(heroUrl && p.url === heroUrl ? { current_hero: true } : {}),
    ...(critical.has(String(p.url || "")) ? { identity_critical: true } : {}),
  })).filter((r) => /^https:\/\//i.test(r.url));
  if (!rows.length) return {};
  // A flagged photograph must be fetchable: put it at the FRONT of the photos
  // list (dropping the tail past `max`), or it is a flag on bytes that never
  // arrive.
  if (Array.isArray(ensureUrls)) {
    const flagged = rows.filter((r) => r.current_hero || r.identity_critical).map((r) => r.url);
    for (const url of flagged.reverse()) {
      const at = ensureUrls.indexOf(url);
      if (at >= 0) ensureUrls.splice(at, 1);
      ensureUrls.unshift(url);
    }
    if (ensureUrls.length > max) ensureUrls.length = max;
  }
  return { photo_bank: { photos: rows.slice(0, 64) } };
}

/**
 * THE PHOTOGRAPHS THE BRIEF ALREADY PROVED, as plain URLs.
 *
 * The design brief renders their site in Chromium and MEASURES its images, then
 * refuses the ones that are not photographs of this business: logoLike,
 * thirdPartyMark, and anything under the photo floor (320x200) are all dropped
 * before brief.heroImage / brief.identityImages are written (design-brief.js
 * heroImage/identityImages refusals). So these are the client's OWN pictures,
 * already judged — but until now the resolver lane threw every one of them away,
 * because the harvest ran BEFORE the brief and briefFlaggedBank can only flag
 * rows that a bank already holds. On a thin harvest that meant metrofence.net's
 * ten real fence-install photographs sat un-shipped while the page wore the
 * donor's /images/service-wood.jpg.
 *
 * These URLs are CANDIDATES, not photos: they are handed to harvestClientPhotos
 * as extraUrls so the ownership gate, the stock library refusals, the magic-byte
 * sniff, the pixel floor and the https rule all still run on every one. Nothing
 * here bypasses a gate; it only stops the lane from discarding evidence.
 */
function briefMeasuredPhotoUrls(brief) {
  if (!brief) return [];
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const url = String(u || "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  if (brief.heroImage) push(brief.heroImage.url);
  // Ordering in identityImages[] is the brief's own fill order (identity-critical
  // first), so it is preserved exactly.
  if (Array.isArray(brief.identityImages)) for (const e of brief.identityImages) push(e && e.url);
  return out;
}

/** The families their site renders, only when a stylesheet PROVABLY serves
 *  them (the brief verified the href against Google Fonts). `{}` otherwise. */
function briefFonts(brief) {
  if (!brief || !brief.fontHref || !/^https:\/\/fonts\.googleapis\.com\//.test(brief.fontHref)) return {};
  if (!brief.fontDisplay && !brief.fontBody) return {};
  return {
    fonts: {
      ...(brief.fontDisplay ? { display: String(brief.fontDisplay).slice(0, 60) } : {}),
      ...(brief.fontBody ? { body: String(brief.fontBody).slice(0, 60) } : {}),
      href: brief.fontHref,
      ...(brief.finalUrl ? { source: String(brief.finalUrl).slice(0, 300) } : {}),
      provider: "google",
    },
  };
}

/**
 * TRUST DENSITY — the owner's words: "if we don't have all the trust signals
 * as dense and laid out as they do on their current site" we lose.
 *
 * The brief's loudElements are what their own page shouts. The DOM-verified
 * ones are carried into the pride sections the renderer already places with
 * the trust rail: claims (BBB, licence, warranty, "since 1974") become
 * credential chips, a verified emergency line becomes a differentiator, a
 * verified promo becomes a promotion. Everything is their own sentence with a
 * proof pointer at their own URL; anything vision read off a JPEG
 * (textVerified:false) stops here, and anything colliding with the miner's
 * unverified_claims list is dropped for the same reason prideBlockFor drops
 * its own — the render gate's ban list outranks us all.
 */
function withBriefTrust(content, brief, { record = {}, applied = null } = {}) {
  const base = content || {};
  const loud = brief && Array.isArray(brief.loudElements) ? brief.loudElements : [];
  const verified = loud.filter((el) => el && el.textVerified && el.text);
  if (!verified.length) return base;

  const banned = (Array.isArray(record.unverified_claims) ? record.unverified_claims : [])
    .map((c) => String(c || "").toLowerCase().replace(/\s+/g, " ").trim())
    .filter((c) => c.length >= 3);
  const collides = (s) => {
    const v = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    return !!v && banned.some((b) => v.includes(b));
  };
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const pride = base.pride && isObject(base.pride) ? { ...base.pride, sections: { ...(base.pride.sections || {}) } } : { schema: "design-brief-loud-v1", sections: {} };
  const S = pride.sections;
  const seen = new Set([
    ...(Array.isArray(S.credentials) ? S.credentials.map((c) => norm(c && c.label)) : []),
    ...(Array.isArray(S.differentiators) ? S.differentiators.map((d) => norm(d && d.text)) : []),
    ...(Array.isArray(S.promotions) ? S.promotions.map((p) => norm(p && p.text)) : []),
    norm(S.tagline && S.tagline.value),
    norm(brief.heroSlogan && brief.heroSlogan.text),
  ].filter(Boolean));

  const proofFor = (text) => ({
    source: String(brief.finalUrl || brief.url || "").slice(0, 500),
    quote: String(text).slice(0, 200),
  });
  const counts = { credentials: 0, differentiators: 0, promotions: 0, financing: 0 };

  let offerWords = null;
  try { offerWords = require("./design-brief").OFFER_WORDS; } catch { offerWords = /\b(fees?|billed|pricing|discount)\b|\$\s?\d/i; }

  const pushCredential = (text) => {
    if (text.length < 2) return false;
    S.credentials = Array.isArray(S.credentials) ? S.credentials : [];
    if (S.credentials.length >= PRIDE_LIST_CAPS.credentials) return false;
    S.credentials.push({ label: text.slice(0, 120), proof: proofFor(text) });
    counts.credentials += 1;
    return true;
  };
  const pushPromotion = (text) => {
    if (text.length < 2 || text.length > 160) return false;
    S.promotions = Array.isArray(S.promotions) ? S.promotions : [];
    if (S.promotions.length >= PRIDE_LIST_CAPS.promotions) return false;
    S.promotions.push({ text, proof: proofFor(text) });
    counts.promotions += 1;
    return true;
  };
  const pushDifferentiator = (text) => {
    if (text.length < 2 || text.length > 200) return false;
    S.differentiators = Array.isArray(S.differentiators) ? S.differentiators : [];
    if (S.differentiators.length >= PRIDE_LIST_CAPS.differentiators) return false;
    S.differentiators.push({ text, proof: proofFor(text) });
    counts.differentiators += 1;
    return true;
  };

  for (const el of verified) {
    const text = String(el.text).replace(/\s+/g, " ").trim();
    const key = norm(text);
    if (!key || seen.has(key) || collides(text)) continue;
    const kind = String(el.kind || "other");
    let placed = false;
    if (kind === "rating") {
      // The trust rail owns the aggregate, straight from Google's corpus. A
      // second star figure quoted off their old page ("4.8 RATING" beside the
      // rail's live 4.9) reads as a bug and can silently go stale.
      continue;
    } else if (el.isClaim) {
      placed = pushCredential(text);
    } else if (kind === "promo" || kind === "discount") {
      placed = pushPromotion(text);
    } else if (kind === "slogan" || kind === "tagline") {
      // The chosen motto is already the h1 (and `seen` holds it). A SECOND
      // slogan-tagged line that talks money — Farr's rotating "NO SERVICE
      // FEES. BILLED HOURLY." — is an offer, and offers are promotions.
      if (offerWords.test(text)) placed = pushPromotion(text);
    } else if (kind === "financing") {
      if (!S.financing && text.length >= 2 && text.length <= 160) {
        S.financing = { value: text, proof: proofFor(text) };
        counts.financing += 1;
        placed = true;
      }
    } else if (kind === "emergency_line" || (kind === "hours" && text.length <= 40)) {
      // "24/7/365" and an emergency banner are availability differentiators;
      // the hours TABLE below still renders the verified schedule itself.
      placed = pushDifferentiator(text);
    } else if (kind === "other" && /\b(est\.?|established|since)\s+\d{4}\b/i.test(text) && text.length <= 60) {
      // Their own heritage line ("EST. 2000"), verbatim, as a standing chip.
      placed = pushCredential(text);
    } else {
      continue;
    }
    if (placed) seen.add(key);
  }

  if (applied) {
    applied.credentials = counts.credentials;
    applied.promotions = counts.promotions;
    applied.differentiators = counts.differentiators;
    applied.financing = counts.financing > 0;
  }
  if (!counts.credentials && !counts.promotions && !counts.differentiators && !counts.financing) return base;
  return { ...base, pride };
}

// ---------------------------------------------------------------------------
// BADGE CAPTURE — the client's own approval stamps, off their own page
// ---------------------------------------------------------------------------
//
// texasbestfence.com carries a carousel of award/certification artwork (AFA
// Pro Award, BBB A+, Best of Denton County…) and our mirror dropped every one
// of them: the brief MEASURES all page images (rankImageCandidates) and the
// engine RENDERS credential badge images (prideBadgeImage → the badge strip),
// but nothing ever classified badge artwork into pride. This is that bridge.
//
// What earns selection — all four, never fewer:
//   1. CLIENT-HOSTED: sameOrigin (their registrable domain) and https. The
//      engine's prideBadgeImage gate re-checks this downstream; a badge CDN
//      or manufacturer host never enters. Showing a BBB mark the client
//      displays on their OWN page is presenting the client's claim; hosting
//      is the boundary, exactly as it is for photos.
//   2. BADGE-SHAPED: small-to-medium, roughly square-to-wide — a hero photo
//      or gallery shot never qualifies, whatever its filename says.
//   3. BADGE-MEANING: the URL or alt SAYS award/certification. Shape alone
//      earns nothing — an icon named "arrow.png" stays out.
//   4. NOT THE LOGO: the brief's chosen logo URL is identity, not a badge.
//
// The label is the client's own alt text, verbatim (or empty — never derived
// from a filename). Rides as pride credentials entries with `image`, which is
// the schema channel the badge strip consumes.
const BADGE_MEANING = /\b(award|badge|winner|best[-_ ]?of|top[-_ ]?rated|certif\w*|accredit\w*|bbb|a\+|angi\b|angie'?s|home[-_ ]?advisor|expertise|nextdoor|fave|thumbtack|houzz|guild|association|member|chamber|screened|elite|preferred|five[-_ ]?star|5[-_ ]?star|seal|trusted|licen[sc]ed|insured|bonded|veteran)\b/i;
// Raised 8 -> 24 with the credentials schema cap: badges ARE credentials, and
// the badge carousel (the shelf) renders as many marks as the client's own
// page proves. Eight was another silent cut of verified content.
const MAX_BADGE_IMAGES = 24;

function briefBadgeImages(brief) {
  const images = (brief && brief.measurements && Array.isArray(brief.measurements.images))
    ? brief.measurements.images : [];
  const logoUrl = String((brief && brief.logo && (brief.logo.url || brief.logo)) || "");
  const out = [];
  const seen = new Set();
  for (const img of images) {
    if (!img || img.kind !== "img") continue;
    const url = String(img.url || "");
    if (!/^https:\/\//i.test(url) || img.sameOrigin !== true) continue;
    if (logoUrl && url === logoUrl) continue;
    if (seen.has(url)) continue;
    const w = Number(img.naturalWidth || img.renderedWidth || 0);
    const h = Number(img.naturalHeight || img.renderedHeight || 0);
    if (!(w >= 40 && h >= 40 && w <= 800 && h <= 800)) continue;
    const aspect = w / Math.max(1, h);
    if (aspect < 0.33 || aspect > 3) continue;
    if (Number(img.renderedArea || 0) > 90000) continue;
    const alt = String(img.alt || "").replace(/\s+/g, " ").trim();
    let basename = "";
    try { basename = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { basename = ""; }
    if (!BADGE_MEANING.test(alt) && !BADGE_MEANING.test(basename)) continue;
    seen.add(url);
    out.push({ url, alt: alt.slice(0, 80) });
    if (out.length >= MAX_BADGE_IMAGES) break;
  }
  return out;
}

function withBriefBadges(content, brief, { applied = null } = {}) {
  const base = content || {};
  const badges = briefBadgeImages(brief);
  if (!badges.length) return base;
  const pride = base.pride && isObject(base.pride)
    ? { ...base.pride, sections: { ...(base.pride.sections || {}) } }
    : { schema: "design-brief-loud-v1", sections: {} };
  const S = pride.sections;
  S.credentials = Array.isArray(S.credentials) ? [...S.credentials] : [];
  const have = new Set(S.credentials.map((c) => String(c && c.image || "")));
  let added = 0;
  for (const b of badges) {
    // This bridge runs AFTER prideBlockFor's truncation, so it must respect
    // the cap itself: pushing past PRIDE_LIST_CAPS.credentials would hand the
    // engine an over-cap request and 400 the whole build — the exact failure
    // the truncation safety net exists to make impossible.
    if (S.credentials.length >= PRIDE_LIST_CAPS.credentials) break;
    if (have.has(b.url)) continue;
    S.credentials.push({
      // The schema requires a label of >= 2 characters, and a badge image with
      // no alt text has none to give (measured live 2026-08-20: an empty label
      // 400'd the whole build). "Recognition" is a neutral placeholder for the
      // strip's caption — never a claim, and the image itself is the content.
      label: b.alt.length >= 2 ? b.alt : "Recognition",
      image: b.url,
      proof: { source: String(brief.finalUrl || brief.url || "").slice(0, 500), quote: (b.alt || b.url).slice(0, 200) },
    });
    added += 1;
  }
  if (applied) applied.badge_images = added;
  if (!added) return base;
  return { ...base, pride };
}

// ---------------------------------------------------------------------------
// BRIGHTDATA LOCAL RESEARCH — real searcher language, never invented claims
// ---------------------------------------------------------------------------
//
// The owner walked the discovery/SERP zone extracting keyword demand ("toilet
// repair modesto") and lib/mirror-engine/local-research.js has read that zone
// since the 108-point work — and, grep-proven, NOTHING ever called it. Wired
// here: the observed strings ride in on content.research (neighborhoods,
// landmarks, the questions people actually ask — rendered by the authority
// pages), and the related searches that are FACTUAL for this business — they
// name the city, the trade or a verified service — ride in on
// content.keywords, which by schema contract can only choose which VERIFIED
// service leads the description. Nothing here can put a new claim on a page.
async function withLocalResearch(content, facts, opts = {}, researchImpl = null) {
  const base = content || {};
  if (base.research || opts.research === false) return base;
  if (String(process.env.MIRROR_LOCAL_RESEARCH || "").trim() === "0") return base;
  if (process.env.NODE_TEST_CONTEXT && opts.research !== true) return base;
  if (!facts.city || !facts.industry) return base;
  let run = researchImpl;
  if (!run) {
    // The real layer needs the BrightData key; without one there is nothing to
    // observe and the mirror simply lacks these points. An injected impl is a
    // test's business, not the key's.
    if (!String(process.env.BRIGHTDATA_API_KEY || "").trim()) return base;
    try { run = require("./mirror-engine/local-research").research; } catch { return base; }
  }
  try {
    const r = await run(
      {
        business_name: facts.business_name || "",
        industry: facts.industry,
        city: facts.city,
        state: facts.state || "",
        license: facts.license || "",
        phone: facts.phone || "",
        address: facts.address || "",
        current_website: facts.current_website || "",
      },
      { services: base.services || [], opts: { attempts: 2, waitMs: 4000 } },
    );
    if (!r) return base;
    const research = {};
    if (Array.isArray(r.neighborhoods) && r.neighborhoods.length) research.neighborhoods = r.neighborhoods.slice(0, 10);
    if (Array.isArray(r.landmarks) && r.landmarks.length) research.landmarks = r.landmarks.slice(0, 8);
    if (Array.isArray(r.questions) && r.questions.length) research.questions = r.questions.slice(0, 12);
    if (Array.isArray(r.related) && r.related.length) research.related = r.related.slice(0, 12);
    if (Array.isArray(r.authoritative) && r.authoritative.length) {
      research.authoritative = r.authoritative
        .filter((a) => a && /^https:\/\//i.test(String(a.href || "")))
        .map((a) => ({ href: a.href, ...(a.title ? { title: String(a.title).slice(0, 120) } : {}) }))
        .slice(0, 3);
      if (!research.authoritative.length) delete research.authoritative;
    }
    // The GBP copy pack quotes the phone; a phone-less business would read
    // "Call ." — omit the pack rather than publish a broken sentence.
    if (r.gbp && facts.phone) research.gbp = r.gbp;
    if (typeof r.citations_csv === "string" && r.citations_csv.length && r.citations_csv.length <= 20000) research.citations_csv = r.citations_csv;
    if (Array.isArray(r.sources) && r.sources.length) research.sources = r.sources.slice(0, 12);
    const keywords = factualKeywords(r, facts, base.services || []);
    if (!Object.keys(research).length && !keywords.length) return base;
    return {
      ...base,
      ...(Object.keys(research).length ? { research } : {}),
      ...(keywords.length && !base.keywords ? { keywords } : {}),
    };
  } catch {
    return base;
  }
}

/**
 * The observed search terms that are FACTUAL for this business: they mention
 * its city plus its trade or one of its verified services. "toilet repair
 * modesto" qualifies for a Modesto plumber; "plumber near me coupon" does not
 * name the place and a term about a service they do not offer never enters.
 */
function factualKeywords(r, facts, services = []) {
  const city = String(facts.city || "").toLowerCase().trim();
  const trade = String(facts.industry || "").toLowerCase().trim();
  const svcTokens = new Set(
    serviceLabels(services)
      .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/))
      .filter((w) => w.length >= 4),
  );
  const out = [];
  for (const term of Array.isArray(r && r.related) ? r.related : []) {
    const t = String(term || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!t || t.length > 80 || out.includes(t)) continue;
    const mentionsCity = city && t.includes(city);
    const mentionsTrade = trade && t.includes(trade);
    const mentionsService = [...svcTokens].some((w) => t.includes(w));
    if (mentionsCity && (mentionsTrade || mentionsService)) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/** The brief's line in the build report — what it saw and what was APPLIED.
 *  `body` is the engine's response, read for the accent decision so the brief's
 *  own report says which colour won — the site's chrome or the logo — and why. */
function designBriefReport(briefOut, applied, body = null) {
  const base = { status: briefOut.status, ...(briefOut.reason ? { reason: briefOut.reason } : {}) };
  const decision = body && body.checks && body.checks.brand && body.checks.brand.accent_decision
    ? { accent_decision: body.checks.brand.accent_decision }
    : {};
  if (briefOut.status !== "ok") return { ...base, ...decision };
  const b = briefOut.brief;
  return {
    ...base,
    accent: b.accent || null,
    ...decision,
    surface: b.surface || null,
    mode: b.mode || null,
    fonts: [b.fontDisplay, b.fontBody].filter(Boolean).join(" / ") || null,
    slogan: b.heroSlogan ? b.heroSlogan.display : null,
    slogan_source: b.heroSlogan ? b.heroSlogan.source : null,
    loud_verified: (b.loudElements || []).filter((l) => l.textVerified).length,
    carry_over: (b.carryOver || []).map((c) => c.what).slice(0, 10),
    identity_critical: (b.identityImages || []).filter((i) => i.identityCritical).map((i) => `${i.what}: ${i.criticalWhy}`).slice(0, 4),
    refusals: (b.refusals || []).length,
    vision: b.vision && b.vision.ok ? `${b.vision.provider}/${b.vision.model}` : ((b.vision && b.vision.reason) || "skipped"),
    duration_ms: b.durationMs || null,
    applied,
  };
}

/**
 * Run the engine with the fleet attached, and register what was published.
 *
 * The engine's own registry only knows the mirrors this PROCESS built, and the
 * 80 that shared a headline were built across many lambdas. Reading the durable
 * fleet is what lets the sameness check answer "is this the same as one we sent
 * last week?" — and only a build that PASSED that check is written back, so a
 * duplicate can never become the reference.
 */
async function mirrorWithFleet({
  run,
  engineDeps = {},
  readFleet,
  recordFleet,
  request,
  prospectId = "",
  dryRun,
  lane = "live",
  donor,
  operationKey,
  signal,
  deadlineAt,
  samenessRetry = null,
}) {
  let fleet;
  // Every sandbox build is owner-only Practice proof. Legacy rows that cannot
  // be enriched with a prospect fingerprint still retain their durable
  // slug/H1/title and remain in the sameness comparison. Skip only that
  // unrelated enrichment work for Practice; live prospect work stays closed.
  const practiceFleet = lane === "sandbox";
  try {
    fleet = await readFleet({
      exceptSlug: request.slug,
      exceptProspectId: prospectId,
      businessName: request.facts?.business_name,
      city: request.facts?.city,
      writeBackfill: !dryRun && !practiceFleet,
    });
  } catch (e) {
    return fleetReadSystemHold(boundedDetailText(e?.message || e || "fleet_read_threw"));
  }
  // Owner-only Practice builds may compare against the complete legacy
  // headline/title inventory even when old publication rows cannot be enriched
  // with a prospect id. Those unresolved enrichments do not remove an
  // identity from `fleet.identities`; they only prevent fingerprint-based
  // self-exclusion. Practice builds use fresh slugs, so blocking them on legacy
  // publications without canonical prospect records turns a safe sameness
  // check into a global outage.
  const fleetShapeProblem = fleetReadShapeProblem(fleet, {
    allowLegacyBackfillIncomplete: practiceFleet,
  });
  if (fleetShapeProblem) {
    return fleetReadSystemHold(
      fleet?.ok === false && fleet?.reason
        ? boundedDetailText(fleet.reason)
        : fleetShapeProblem,
    );
  }
  const res = await run(request, {
    dryRun: !!dryRun,
    operationKey,
    signal,
    deadlineAt,
    internalSamenessRetry: samenessRetry,
    deps: { ...engineDeps, fleetIdentities: async () => fleet.identities },
  });
  const body = (res && res.body) || {};
  const same = (body.checks && body.checks.sameness) || null;
  const deadline = Number(deadlineAt);
  const cancelled = signal?.aborted === true
    || (Number.isFinite(deadline) && deadline > 0 && Date.now() >= deadline);
  if (!dryRun && body.ok && same && same.status === "passed") {
    const fleetIdentity = {
      slug: request.slug,
      h1: same.rendered_h1 || same.headline || "",
      title: same.served_title || "",
      prospect_id: prospectId,
      business_name: request.facts?.business_name || "",
      city: request.facts?.city || "",
      donor: donor || request.donor || "",
      build_hash: body.build_hash || "",
      attempt: samenessRetry?.attempt || 1,
      retryOf: samenessRetry?.retryOf || "",
      retryReason: samenessRetry?.retryReason || "",
    };
    const publicationProblem = fleetPublicationShapeProblem(body, request.slug);
    if (publicationProblem) {
      return fleetRecordSystemHold(
        mirrorReleaseUnconfirmedCause(publicationProblem, body),
        { body, fleetIdentity },
        { code: "mirror_release_unconfirmed", action: "verify_public_release" },
      );
    }
    // The renderer may finish publishing exactly as the worker budget expires.
    // At that point the release already exists, so returning its revealable
    // success would lose the durable fleet identity and retrying the build would
    // risk a second deploy. Preserve the exact signed release and hand the
    // operator one record-only reconciliation action instead.
    if (cancelled) {
      const cancellationReason = signal?.aborted === true
        ? "fleet_identity_write_aborted_after_deploy"
        : "fleet_identity_write_deadline_elapsed_after_deploy";
      return fleetRecordSystemHold(cancellationReason, { body, fleetIdentity });
    }
    let recorded;
    try {
      recorded = await recordFleet(fleetIdentity);
    } catch (error) {
      return fleetRecordSystemHold(error?.message || error, { body, fleetIdentity });
    }
    const recordProblem = fleetRecordShapeProblem(recorded);
    if (recordProblem) {
      // The store's raw answer rides on the hold so the row names the exact
      // write failure (mode, error code) instead of a collapsed placeholder.
      let rawTail = "";
      try { rawTail = recorded ? ` | raw=${JSON.stringify(recorded).slice(0, 200)}` : ""; } catch (_) { rawTail = ""; }
      return fleetRecordSystemHold(
        `${recorded?.ok === false && recorded?.reason ? boundedDetailText(recorded.reason) : recordProblem}${rawTail}`,
        { body, fleetIdentity },
      );
    }
  }
  return res;
}

/**
 * A sameness comparison is only meaningful when the durable fleet read is
 * complete. An empty identity array is a valid first-fleet result; a failed or
 * partial read is not permission to build against an invented empty fleet.
 */
function fleetReadShapeProblem(fleet, { allowLegacyBackfillIncomplete = false } = {}) {
  if (!fleet || typeof fleet !== "object" || Array.isArray(fleet)) return "fleet_read_malformed";
  if (fleet.ok !== true) return "fleet_read_not_ok";
  if (!Array.isArray(fleet.identities)) return "fleet_identities_missing";
  if (fleet.backfill != null) {
    if (!fleet.backfill || typeof fleet.backfill !== "object" || Array.isArray(fleet.backfill)) {
      return "fleet_backfill_malformed";
    }
    // A legacy prospect lookup enriches an already-valid slug/H1/title
    // identity with a newer prospect_id/fingerprint.  It is useful for
    // self-exclusion, but it is not the fleet read itself: unresolved legacy
    // rows remain in `identities` and therefore still take part in sameness.
    // Treating an old row that no longer has a prospect record as a global
    // outage prevents every later build while adding no duplicate protection.
    // A lookup outage, on the other hand, is still a real provider failure and
    // remains fail-closed.
    if (!allowLegacyBackfillIncomplete && String(fleet.backfill.reason || "").trim()) {
      return "fleet_backfill_unavailable";
    }
  }
  for (const identity of fleet.identities) {
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
      return "fleet_identity_malformed";
    }
    if (
      typeof identity.slug !== "string"
      || typeof identity.h1 !== "string"
      || typeof identity.title !== "string"
    ) return "fleet_identity_malformed";
    const slug = identity.slug.trim();
    const h1 = identity.h1.trim();
    const title = identity.title.trim();
    if (!slug || (!h1 && !title)) return "fleet_identity_incomplete";
  }
  return "";
}

function fleetReadSystemHold(detail = "") {
  const code = "mirror_fleet_read_unavailable";
  const safeDetail = boundedDetailText(detail || code).trim().slice(0, 160) || code;
  const systemHold = {
    schema: "wss.mirror.system_hold.v1",
    type: "system",
    code,
    retryable: true,
    scope: "mirror_build",
  };
  return {
    status: 503,
    retryable: true,
    disposition: "system_hold",
    lead_rejection: false,
    system_hold: systemHold,
    body: {
      ok: false,
      error: code,
      reason: code,
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      system_hold: systemHold,
      detail: [{ reason: safeDetail }],
    },
  };
}

function fleetRecordShapeProblem(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return "fleet_identity_write_malformed";
  }
  // A resolved store call is not proof of a durable write. Production only
  // earns a fleet identity from the store's explicit live-write receipt; in
  // particular {ok:true, mode:"dry_run"} must remain a reconciliation hold.
  if (result.ok === true && result.mode === "live_write") return "";
  if (String(result.mode || "") && result.mode !== "live_write") {
    const mode = String(result.mode).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80);
    return `fleet_identity_write_mode_${mode || "invalid"}`;
  }
  return result.ok === false ? "fleet_identity_write_not_ok" : "fleet_identity_write_unconfirmed";
}

function exactPublishedPreview(value, slug) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch (_) {
    return "";
  }
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  // Reuse the deploy boundary instead of inventing a stricter second policy:
  // real established slugs are legal only when the same explicit owner flag
  // that authorizes their deploy/alias is active.
  if (slugPolicy(normalizedSlug).ok !== true) return "";
  const expectedHost = aliasHostFor(normalizedSlug);
  if (parsed.protocol !== "https:"
    || parsed.hostname.toLowerCase() !== expectedHost
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "/" && parsed.pathname !== "")) return "";
  return `${parsed.origin}/`;
}

/**
 * Only a publicly attached, revealable, HMAC-bound Mirror release may become a
 * durable fleet reference. A private deploy or a failed alias is real provider
 * work, but it is not the public website later builds must compare against.
 */
function fleetPublicationShapeProblem(body, slug) {
  if (body?.revealable !== true) return "release_not_revealable";
  if (body?.checks?.alias_target?.status !== "passed") return "alias_target_unconfirmed";
  const previewUrl = exactPublishedPreview(body?.preview_url, slug);
  if (!previewUrl) return "preview_identity_invalid";
  if (body?.renderer !== MIRROR_ENGINE_RENDERER
    || body?.qc_contract !== MIRROR_ENGINE_QC_CONTRACT
    || body?.evidence_schema !== MIRROR_ENGINE_EVIDENCE_SCHEMA) {
    return "release_contract_invalid";
  }
  const buildHash = String(body?.build_hash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(buildHash)) return "release_build_hash_invalid";
  if (!verifyEvidence(body)) return "release_evidence_signature_invalid";

  const proof = body?.proofIdentity;
  const shared = body?.sharedReleaseEvidence;
  const sharedDeclared = proof != null || shared != null || body?.shared_publish === true;
  if (sharedDeclared) {
    if (!proof || typeof proof !== "object" || Array.isArray(proof)
      || !String(proof.site_id || "").trim()
      || !String(proof.release_id || "").trim()
      || String(proof.build_hash || "").trim().toLowerCase() !== buildHash) {
      return "shared_proof_identity_invalid";
    }
    if (!shared || typeof shared !== "object" || Array.isArray(shared)
      || shared.evidence_schema !== "shared-site-release-evidence-v1"
      || String(shared.site_id || "").trim() !== String(proof.site_id).trim()
      || String(shared.release_id || "").trim() !== String(proof.release_id).trim()
      || String(shared.build_hash || "").trim().toLowerCase() !== buildHash
      || String(shared.canonical_host || "").trim().toLowerCase() !== new URL(previewUrl).hostname
      || String(body?.deploy_id || "").trim() !== String(proof.release_id).trim()) {
      return "shared_release_identity_invalid";
    }
    return "";
  }

  if (!String(body?.deploy_id || "").trim()) return "release_deployment_identity_missing";
  try {
    const deployUrl = new URL(String(body?.deploy_url || ""));
    if (deployUrl.protocol !== "https:" || deployUrl.username || deployUrl.password) {
      return "release_deployment_url_invalid";
    }
  } catch (_) {
    return "release_deployment_url_invalid";
  }
  return "";
}

/**
 * A mirror_release_unconfirmed hold must name WHERE confirmation failed, not
 * just that it failed. The cause carries the canonical host and the engine's
 * alias_target status so the operator can re-verify the exact release URL —
 * production showed bare holds ("mirror_release_unconfirmed") rendering as
 * "[object Object]" with no host to check.
 */
function mirrorReleaseUnconfirmedCause(publicationProblem, body) {
  let host = "";
  try {
    host = new URL(String(body?.preview_url || "")).hostname || "";
  } catch (_) {
    host = "";
  }
  const aliasStatus = boundedString(body?.checks?.alias_target?.status) || "absent";
  return [
    boundedString(publicationProblem) || "release_not_confirmed",
    `host=${host || "unknown"}`,
    `alias_target=${aliasStatus}`,
  ].join("; ");
}

function boundedString(value) {
  return boundedDetailText(value).trim().slice(0, 120);
}

function boundedReconciliationValue(value, length) {
  return boundedDetailText(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, length);
}

function fleetRecordSystemHold(
  detail = "",
  { body = {}, fleetIdentity = {} } = {},
  { code = "mirror_fleet_record_unavailable", action = "record_fleet_identity" } = {},
) {
  const safeDetail = boundedReconciliationValue(detail || code, 160) || code;
  const proof = body?.proofIdentity && typeof body.proofIdentity === "object"
    && !Array.isArray(body.proofIdentity)
    ? {
      site_id: boundedReconciliationValue(body.proofIdentity.site_id, 80),
      release_id: boundedReconciliationValue(body.proofIdentity.release_id, 80),
      build_hash: boundedReconciliationValue(body.proofIdentity.build_hash, 64),
    }
    : null;
  const release = {
    build_hash: boundedReconciliationValue(body?.build_hash, 64),
    preview_url: boundedReconciliationValue(body?.preview_url, 500),
    deploy_id: boundedReconciliationValue(body?.deploy_id, 160),
    deploy_url: boundedReconciliationValue(body?.deploy_url, 500),
    evidence_sha: boundedReconciliationValue(body?.evidence_sha, 64),
    ...(proof ? { proof_identity: proof } : {}),
  };
  const identity = {
    slug: boundedReconciliationValue(fleetIdentity.slug, 120),
    h1: boundedReconciliationValue(fleetIdentity.h1, 300),
    title: boundedReconciliationValue(fleetIdentity.title, 300),
    prospect_id: boundedReconciliationValue(fleetIdentity.prospect_id, 160),
    donor: boundedReconciliationValue(fleetIdentity.donor, 160),
    build_hash: boundedReconciliationValue(fleetIdentity.build_hash, 64),
    attempt: Number(fleetIdentity.attempt) === 2 ? 2 : 1,
    ...(fleetIdentity.retryOf
      ? { retry_of: boundedReconciliationValue(fleetIdentity.retryOf, 240) }
      : {}),
    ...(fleetIdentity.retryReason
      ? { retry_reason: boundedReconciliationValue(fleetIdentity.retryReason, 80) }
      : {}),
  };
  const reconciliation = {
    schema: "wss.mirror.fleet_reconciliation.v1",
    action,
    redeploy_allowed: false,
    release,
    fleet_identity: identity,
  };
  const systemHold = {
    schema: "wss.mirror.system_hold.v1",
    type: "system",
    code,
    retryable: true,
    scope: "mirror_reconciliation",
    manual_reconciliation_required: true,
    reconciliation,
  };
  const failedBody = {
    ok: false,
    revealable: false,
    error: code,
    reason: code,
    retryable: true,
    disposition: "system_hold",
    lead_rejection: false,
    provider_attempted: true,
    manual_reconciliation_required: true,
    system_hold: systemHold,
    reconciliation,
    detail: [{ reason: safeDetail }],
    // Exact renderer evidence stays nested and immutable for an operator who
    // must reconcile the already-published release. It is never promoted to a
    // revealable/sendable result while the fleet write is unconfirmed.
    deployed_release_evidence: body,
    build_hash: body?.build_hash || "",
    preview_url: body?.preview_url || "",
    renderer: body?.renderer,
    qc_contract: body?.qc_contract,
    evidence_schema: body?.evidence_schema,
    evidence_sha: body?.evidence_sha,
    proofIdentity: body?.proofIdentity,
    sharedReleaseEvidence: body?.sharedReleaseEvidence,
  };
  return {
    status: 503,
    retryable: true,
    disposition: "system_hold",
    lead_rejection: false,
    provider_attempted: true,
    manual_reconciliation_required: true,
    system_hold: systemHold,
    reconciliation,
    release_evidence: body,
    body: failedBody,
  };
}

/**
 * A URL with valid ownership/provenance can still resolve to an HTML error
 * page or other non-image bytes.  That leaves us with no verified logo, which
 * is a logo-ladder downgrade under the current law.  Retry only that exact
 * resolver outcome.  Foreign marks, redirects to foreign marks, fetch errors,
 * pinned-hash mismatches and rendered-logo failures remain hard refusals.
 *
 * The request is updated before the retry so the signed build evidence records
 * the exact rung/value/reason that was actually rendered.
 */
async function mirrorWithInvalidLogoFallback(args) {
  const first = await mirrorWithFleet(args);
  if (
    !logoLadderFallbackEnabled()
    || !args.request?.brand?.logo
    || !(isUnrecognizedLogoAssetFailure(first) || isDeadDomainLogoFailure(first))
  ) return first;

  const { logo: _invalidLogo, logo_sha256: _invalidLogoSha, ...brand } = args.request.brand;
  brand.mark = chooseBrandMark({
    logoCandidates: [],
    businessName: args.request.facts?.business_name,
    accent: brand.site_accent || brand.accent || brand.accent_fallback || brand.primary || "",
  });
  args.request.brand = brand;
  return mirrorWithFleet(args);
}

function samenessProblems(result) {
  const problems = result?.body?.checks?.sameness?.problems;
  return Array.isArray(problems) ? problems.map((problem) => String(problem || "")).filter(Boolean) : [];
}

function collisionOnlySamenessFailure(result) {
  const problems = samenessProblems(result);
  return problems.length > 0
    && problems.every((problem) => /^duplicate_(?:h1|title)_with_[^:]+:/.test(problem));
}

function samenessFailureDetail(result) {
  const rawProblems = result?.body?.checks?.sameness?.problems;
  const problems = Array.isArray(rawProblems)
    ? rawProblems.map((problem) => boundedDetailText(problem || "")).filter(Boolean)
    : [];
  return problems.length ? { gate: "sameness", problems } : null;
}

/**
 * One immutable LOGICAL differentiated retry, owned by a deterministic unique
 * event row before the second provider/build call. A crash or concurrent
 * conflict resumes that same claim/operation key: it can repeat identical
 * provider work, but it cannot mint a third identity attempt. This also makes
 * a late legacy attempt-1 alias self-heal, because every collision worker ends
 * by publishing the same attempt-2 bytes.
 */
async function mirrorWithSamenessRetry(args) {
  const first = await mirrorWithInvalidLogoFallback(args);
  if (args.dryRun || args.samenessRetry?.attempt === 2 || !collisionOnlySamenessFailure(first)) return first;

  const retryOf = String(args.operationKey || first?.body?.build_hash || "").trim();
  if (!retryOf) return first;
  const claim = await args.claimRetry({
    retryOf,
    slug: args.request?.slug,
    prospect_id: args.prospectId,
  });
  if (!claim?.ok || claim.claimed !== true) return first;

  return mirrorWithInvalidLogoFallback({
    ...args,
    operationKey: claim.operationKey,
    samenessRetry: {
      attempt: 2,
      retryOf: claim.retryOf,
      retryReason: "sameness_collision",
      claimId: claim.id,
    },
  });
}

/** The engine's two 409 slug_conflict shapes: the in-memory registry claim
 *  ({slug, bound_to}) and the durable-stamp one (adds durable:true). Direct
 *  body objects (no HTTP wrapper) are supported like every other classifier
 *  here. */
function isSlugConflictResult(result) {
  if (!result || typeof result !== "object") return false;
  const body = result.body && typeof result.body === "object" ? result.body : result;
  if (!body || body.error !== "slug_conflict") return false;
  return Number(result.status) === 409 || (result.status == null && body.ok === false);
}

/**
 * DETERMINISTIC SLUG DEDUPE for a 409 slug_conflict. slugFor folds business
 * name + city into one label, so a recycled prospect (the same "Air Pro Inc."
 * re-mined with a new prospect id, measured 2026-08-31 on
 * wss-test-air-pro-albuquerque) or any punctuation variant of the same name
 * collides with the site that already owns the label and the row died there.
 * The fix is not a random suffix: appending a short digest of THIS prospect's
 * id keeps the choice deterministic, so a rebuild re-derives the same
 * deduped label and "a rebuild never moves a mirror" still holds. Two
 * attempts, each still ending in a 409 kept as the failure it is.
 */
function dedupedSlugFor(baseSlug, prospectId, attempt = 1) {
  const { createHash } = require("node:crypto");
  const id = String(prospectId || "").trim();
  const suffix = createHash("sha256").update(attempt === 1 ? id : `${id}|${attempt}`).digest("hex").slice(0, 6);
  // Keep the whole label inside slugFor's cert headroom: "wss-test-" (9) +
  // 42 body chars (see slugFor). The suffix costs 7 more, so trim the base.
  const base = String(baseSlug || "").slice(0, 51 - suffix.length - 1).replace(/-+$/, "");
  return `${base}-${suffix}`;
}

async function mirrorWithSlugConflictRetry(args) {
  const first = await mirrorWithSamenessRetry(args);
  const prospectId = String(args.prospectId || "").trim();
  if (!isSlugConflictResult(first) || !prospectId || !args.request?.slug) return first;

  // Both attempts derive from the ORIGINAL label (never a suffix of a
  // suffix), so every rebuild walks the identical base -> deduped path.
  const baseSlug = args.request.slug;
  let latest = first;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const request = { ...args.request, slug: dedupedSlugFor(baseSlug, prospectId, attempt) };
    latest = await mirrorWithSamenessRetry({ ...args, request });
    if (!isSlugConflictResult(latest)) break;
  }
  return latest;
}

async function buildMirrorForProspect(prospect = {}, opts = {}) {
  const deps = opts.deps || {};
  // GHOST_AGENCY_LIGHT_VERIFICATION — resolved once per build and carried to
  // the content floor and onto the result, so the row always says whether this
  // site shipped under light or full verification. "0" = full, exactly the old
  // law.
  const verification = verificationMode(opts.env || process.env);
  const _resolveFacts = deps.resolveVerifiedFacts || resolveVerifiedFacts;
  const _harvest = deps.harvestClientPhotos || harvestClientPhotos;
  const _resolveDonor = deps.resolveBuildableDonor || resolveBuildableDonor;
  const _mirror = deps.mirror || mirror;
  const _mirrorEngineDeps = engineDepsFor({ deps, run: _mirror });
  const _captureFonts = deps.captureFonts || captureFonts;
  // The brand-harvest fallback for fonts. Injectable like every network path;
  // the default fetches the page once and reads it with the harvester.
  const _harvestFontsFallback = deps.harvestFontsFallback || (async (url) => {
    const { harvestBrand } = require("./mirror-engine/brand-harvest");
    const res = await fetch(String(url), {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; WSSMirrorBuild/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, source: "brand_harvest" };
    const html = await res.text();
    const brand = harvestBrand(html, {});
    const display = (brand.fonts && brand.fonts.display) || "";
    const body = (brand.fonts && brand.fonts.body) || "";
    const href = (brand.fonts && brand.fonts.googleHref) || "";
    if (!display && !body) return { ok: false, source: "brand_harvest" };
    return {
      ok: true,
      source: "brand_harvest",
      ...(display ? { display } : {}),
      ...(body ? { body } : {}),
      // resolveBrandAssets only carries an href that already points at
      // fonts.googleapis.com — keep that contract here.
      ...(/^https:\/\/fonts\.googleapis\.com\//i.test(href) ? { href } : {}),
    };
  });
  const _resolveRiley = deps.resolveRileyLine || resolveRileyLine;
  // Social discovery is a NETWORK CALL and therefore an injected dependency
  // like every other one on this list. It was not, briefly, and the lane's
  // own "these tests run with no network" contract caught it immediately:
  // an injected-deps unit test reached out to a real prospect's homepage and
  // to Firecrawl. A resolver that can touch the wire must be replaceable.
  const _resolveSocials = deps.resolveSocials || resolveSocials;
  // THE FLEET, so a mirror can be refused for reading like one we already
  // published. Both halves are injectable for the same reason as everything
  // above: they touch the store, and these tests run with no network.
  const _readFleet = deps.readFleetIdentities || readFleetIdentities;
  const _recordFleet = deps.recordFleetIdentity || recordFleetIdentity;
  const _claimSamenessRetry = deps.claimSamenessRetry || claimSamenessRetry;
  const _firstPartySite = deps.firstPartySite || firstPartySite;
  const _brandFromWebsite = deps.brandFromWebsite || brandFromWebsite;

  // NEEDS_FILL — the caller (line-adapters/mirrorProspect) flags a thin-but-real
  // packet for AI-fill, or the packet carries its own flag. leadMinerMirrorInput
  // then fills structural gaps instead of refusing.
  const needsFill = !!(prospect.needs_fill || (isObject(prospect.truth_packet) && prospect.truth_packet.needs_fill)
    || (isObject(prospect.record) && prospect.record.needs_fill));
  // Packet2 is an enrichment sidecar, never the identity packet. Read it from
  // the durable record and bind every usable observation to the website that
  // LeadMiner/the stored contract already supplied. The adapter deliberately
  // returns no NAP, rating, review count, or generated prose.
  // A frozen LeadMiner packet already proves its website in the signed
  // provenance envelope, so its source-bound supplement can be read now without
  // opening a provider. Resolver-lane websites are only candidates at this
  // point; keep Packet2 completely empty until resolveVerifiedFacts has chosen
  // the independently observed site below.
  const frozenLeadMinerPacket = isLeadMinerPacket(prospect.truth_packet);
  // The v7 receipt is its own immutable content authority. Identity still
  // comes from the frozen LeadMiner packet or the strict build-ready resolver
  // contract, but valid visitor copy must not disappear merely because a fresh
  // row has no legacy truth_packet_source marker.
  const certifiedGenieContent = certifiedGenieContentFromRecord(prospect, {
    signingKey: opts.certificationKey,
    nowMs: opts.nowMs,
  });
  const certifiedIndustry = approvedIndustry(
    certifiedGenieContent?.canonical_packet?.category || "",
  );
  let pageHub = frozenLeadMinerPacket
    ? pageHubBuildSupplement(prospect.record || {}, {
      website: needsFillWebsite(prospect, prospect.truth_packet || {}),
    })
    : { ok: false, reason: "verified_website_pending", asset_candidates: [], services: [], socials: [], brand: {}, logo_candidate: null };
  const miningMarket = miningMarketOf(prospect);
  let leadMinerInput = leadMinerMirrorInput(prospect.truth_packet, {
    needsFill,
    queryCity: miningMarket.city,
    queryState: miningMarket.state,
    certifiedContent: certifiedGenieContent.ok ? certifiedGenieContent : null,
    supplementServices: pageHub.services,
  });
  if (leadMinerInput && !leadMinerInput.ok) return leadMinerInput;
  const businessName = leadMinerInput?.facts.business_name || prospect.business_name || prospect.name || "";
  if (!businessName) return { ok: false, reason: "no_business_name" };

  // THE LABEL IS A HINT; THE SERVICES ARE THE EVIDENCE — ON THIS LANE TOO.
  //
  // leadMinerMirrorInput has inferred the trade from services since the M & M
  // packet-lane fix, but THIS branch — the resolver lane, taken by every
  // rebuild and by any caller with no truth packet — still trusted whatever
  // string the caller handed it. record.industry for M & M Heating & Cooling,
  // LLC is the literal word "plumbing"; all ten of their services are air
  // conditioners, furnaces, boilers and mini-splits. Measured 2026-08-11: a
  // rebuild through this lane published them, live, as
  // "M & M Heating & Cooling, LLC — Plumbing in Stratford, CT" on the plumbing
  // donor. The two lanes now ask the same question of the same evidence, so
  // they cannot answer differently for the same business.
  const tradeEvidence = inferTrade({
    label: certifiedIndustry || leadMinerInput?.facts.industry || prospect.industry || prospect.vertical || "",
    services: servicesForTradeEvidence(prospect),
    businessName,
    siteText: [
      prospect.site_text,
      prospect.harvested_site_text,
      prospect.website_text,
      prospect.record?.site_text,
      prospect.record?.harvested_site_text,
    ].filter(Boolean).join(" \n "),
    categories: [
      prospect.primary_category,
      prospect.categories,
      prospect.record?.primary_category,
      prospect.record?.categories,
    ],
    env: opts.env || process.env,
  });
  if (tradeEvidence.reason === "vertical_mismatch_sport_fencing") {
    return {
      ok: false,
      reason: "vertical_mismatch_sport_fencing",
      industry: "fencing",
      sport_signals: tradeEvidence.fencing?.sportSignals || [],
    };
  }
  if (tradeEvidence.reason === "fencing_contracting_uncorroborated") {
    return { ok: false, reason: "fencing_contracting_uncorroborated", industry: "fencing" };
  }
  // MULTI-TRADE BUILDS ON THE LEAD TRADE — the same doctrine change as the
  // packet lane (2026-08-20). The lead trade picks the donor shell; the
  // client's verified services carry the secondary trade onto the page and
  // into its own authority pages, and the render gate exempts the client's
  // own name/services/reviews so their second trade cannot convict the build.
  const labelledIndustry = String(
    certifiedIndustry || leadMinerInput?.facts.industry || prospect.industry || prospect.vertical || "",
  ).toLowerCase().trim();
  const fallbackLabel = labelledIndustry === "fencing" && sportFencingGuardEnabled(opts.env || process.env)
    ? ""
    : labelledIndustry;
  const industry = String(effectiveBuildIndustry(tradeEvidence, {
    requested: certifiedIndustry || prospect.industry || prospect.vertical || "",
    label: fallbackLabel,
  }) || "").toLowerCase().trim();
  if (!industry) return { ok: false, reason: "no_industry" };

  // 1. TRUE-SHAPE DONOR OR REFUSE — the no-trade-swap gate.
  const donorPick = _resolveDonor(industry, opts.allowRoot);
  if (!donorPick || !donorPick.ok) {
    return { ok: false, reason: donorPick ? donorPick.reason : "no_donor", industry };
  }

  let needsFillProviderCalls = { first_party_site: 0, brand_site: 0 };
  if (leadMinerInput?.needs_fill) {
    const rescued = await rescueNeedsFill({
      input: leadMinerInput,
      prospect,
      packet: prospect.truth_packet,
      resolveFacts: _resolveFacts,
      firstParty: _firstPartySite,
      resolveBrand: _brandFromWebsite,
      fetchImpl: deps.fetchImpl,
    });
    needsFillProviderCalls = rescued.provider_calls || needsFillProviderCalls;
    if (!rescued.ok) return rescued;
    leadMinerInput = rescued.input;
  }

  // 1b. THEIR OWN MARK, OR THE FROZEN LOGO LADDER.
  //
  // Owner decree 2026-08-20: true logo absence is a polish downgrade, never a
  // dead build. A supplied foreign/provenance-failing candidate still refuses
  // below; only the genuine "there is no candidate" case reaches the ladder.
  // SANITIZE BEFORE VALIDATE: a stored logo string with a stray space or
  // control character would 400 the request at /brand/logo. Un-URI-able means
  // unusable here, exactly as it reads — "" sends the ladder to the next rung
  // (or the documented no_verified_logo refusal), never a schema 400.
  let logo = leadMinerInput
    ? ""
    : sanitizeHttpsUri(String(prospect.logo || prospect.logo_url || (prospect.brand && prospect.brand.logo) || ""));
  let recordedSiteAccent = siteAccentEvidence(
    prospect,
    prospect.brand,
    prospect.record,
    prospect.record?.brand,
    storedContract(prospect).brand,
    pageHub.brand,
  );
  const allowLogoFallback = logoLadderFallbackEnabled();
  let resolverMark = !leadMinerInput && !logo && allowLogoFallback
    ? chooseBrandMark({
      logoCandidates: [],
      businessName,
      accent: recordedSiteAccent.site_accent || prospect.logo_accent || prospect.brand?.accent || "",
    })
    : null;
  // https ONLY, because the mirror-request schema and the SSRF-guarded fetch
  // both refuse anything else. An http-only mark reached the engine as a blunt
  // 400 invalid_request with no clue which field caused it, which is the worst
  // possible way to learn something visible on the record.
  if (!leadMinerInput && logo && !/^https:\/\//i.test(String(logo))) {
    return {
      ok: false,
      reason: "logo_not_https",
      detail: `${businessName}'s logo is served over plain http (${String(logo).slice(0, 120)}) — the engine will not fetch a brand asset without TLS`,
      industry,
    };
  }
  // SOMEBODY ELSE'S TRADEMARK IS NOT THEIR LOGO.
  //
  // Being on the client's own domain is not proof of ownership. Every
  // contractor's /images folder holds the marks of the brands they install and
  // the platforms they signed up to, and those files are named "<brand>-logo.png"
  // — so sameOwner passes and the filename says "logo". Measured live on our own
  // host, 2026-08-06, both refused by nothing:
  //   · all-home-plumbing-co-chattanooga served Google's Blogger badge
  //     (blogger_logo.png) as the client's mark, in schema.org Organization.logo
  //   · simmons-plumbing-and-mechanical served Mastercool, Inc.'s registered
  //     trademark, and the site's whole palette was measured from it
  // resolveBrandAssets already refuses these as brand_asset_rejected, so this is
  // not a new policy — it is the same answer, before a deploy is spent, in a
  // sentence an operator can act on. The denylist itself lives in
  // capture-brand.js so the miner and the engine can never disagree about it.
  if (!leadMinerInput && isThirdPartyMark(String(logo).replace(/^https?:\/\//i, ""))) {
    return {
      ok: false,
      reason: "logo_third_party_mark",
      detail: `${businessName}'s only logo candidate is a third-party mark (${String(logo).slice(0, 120)}) — that is someone else's trademark, not their identity, and we do not publish it as theirs`,
      industry,
    };
  }
  if (!leadMinerInput && logo) {
    // A syntactically valid HTTPS URL is not ownership evidence. Bind direct-
    // resolver logos to the same first-party site/approved builder-CDN rule the
    // miner already uses. True absence never reaches this branch and therefore
    // still falls through the frozen logo ladder above.
    const logoOwnerSite = needsFillWebsite(prospect, prospect.truth_packet || {});
    if (!logoOwnerSite || !ownsLogo(logoOwnerSite, logo, businessName)) {
      return {
        ok: false,
        reason: "logo_provenance_failed",
        detail: `${businessName}'s supplied logo candidate has no first-party ownership evidence (${String(logo).slice(0, 120)})`,
        industry,
      };
    }
  }

  if (leadMinerInput) {
    // An owned profile observed as a literal link on the verified first-party
    // site is already proved by self-assertion. Packet2 social URLs without
    // that exact source binding never leave pageHubBuildSupplement.
    if (pageHub.socials.length && !Array.isArray(leadMinerInput.facts.socials)) {
      leadMinerInput = {
        ...leadMinerInput,
        facts: { ...leadMinerInput.facts, socials: pageHub.socials },
      };
    }

    // THEIR TYPEFACE, captured by the agency at build time from their own site.
    // Fail-soft on purpose: an unreachable site costs the font, never the
    // build, and the donor's own typography is a considered design to fall back
    // to rather than a wrong one.
    const stagedFonts = isObject(leadMinerInput.brand?.fonts)
      ? { ok: true, ...leadMinerInput.brand.fonts }
      : (isObject(pageHub.brand?.fonts)
        ? { ok: true, ...pageHub.brand.fonts }
        : null);
    let fonts = stagedFonts || (leadMinerInput.fontSource
      ? await _captureFonts(leadMinerInput.fontSource).catch(() => ({ ok: false }))
      : { ok: false });

    // SECOND CHANCE, SAME PAGE: _captureFonts walks stylesheet links and can
    // miss fonts declared inline (Divi-era sites inline their @import and
    // font-family rules in <style> head blocks). The brand harvester reads the
    // whole page source in one pass — fonts, palette, marks — and is the
    // fallback that returned Rubik/Open Sans on a real Divi client after
    // captureFonts answered { ok: false }. Same fetch budget, never a second
    // network call when the first capture already answered.
    if (!(fonts && fonts.ok) && leadMinerInput.fontSource) {
      fonts = await _harvestFontsFallback(leadMinerInput.fontSource).catch(() => ({ ok: false }));
    }

    // THEIR OWN WEBSITE, ON THIS PATH TOO — BUT FOR FREE.
    //
    // A LeadMiner packet carries only GOOGLE BUSINESS media, so a packet build
    // could not see a single photograph on the client's own site. M & M Heating
    // is the worked example: the packet holds four GBP photos and their website
    // holds seven more, including the only picture anywhere of their two
    // branded vans outside their own building.
    //
    // THE PACKET PATH SPENDS NOTHING, and that is a contract, not an accident
    // (leadminer-mirror-ready-webhook.test.js pins provider_calls at zero and
    // fails the build if any resolver or harvester runs here). So this reads
    // the BANKED harvest off the record — bytes already fetched, written down
    // once, with a sha per photograph — and never opens a socket. A prospect
    // with no bank yet keeps exactly the behaviour it had.
    //
    // Additive only: the packet's own Google-observed photos keep the front of
    // the array, and banked site photography extends the gallery behind them.
    let packetPhotos = leadMinerInput.photos;
    const packetBank = photoBank.bankFromRecord(prospect.record || {});
    if (packetPhotos.length < MAX_PHOTOS && photoBank.bankIsFresh(packetBank)) {
      for (const url of photoBank.bankToRequestPhotos(packetBank, MAX_PHOTOS)) {
        if (packetPhotos.length >= MAX_PHOTOS) break;
        if (/^https:\/\//i.test(url) && !packetPhotos.includes(url)) packetPhotos = [...packetPhotos, url];
      }
    }

    const slug = opts.slug || establishedSlug(prospect) || slugFor(leadMinerInput.facts.business_name, leadMinerInput.facts.city);
    // THE LEFT-SIDE SIGN-UP PANEL — resolved by the ONE reader both build paths
    // share (lib/mirror-engine/signup-floater resolveSignupConfig), never
    // assembled here. See the note on the resolver path below for what the
    // hand-assembled version cost.
    const signupPanel = resolveSignupConfig({
      prospect,
      facts: { ...leadMinerInput.facts, industry },
      slug,
      resolveRileyLine: _resolveRiley,
    });

    // THE DESIGNER'S BRIEF, on this lane too — see designBriefFor. The packet
    // already reads their site for fonts; the brief reads it the way a
    // designer would, and only its VERIFIED observations reach the request.
    const briefOut = await designBriefFor({ prospect, facts: leadMinerInput.facts, opts, briefImpl: deps.buildDesignBrief });
    const brief = briefOut.status === "ok" ? briefOut.brief : null;
    const briefApplied = { tagline: false, client_surface: false, accent_fallback: false, site_accent: false, fonts: false, credentials: 0, promotions: 0, differentiators: 0, financing: false };

    // THE SLOGAN RULE. Their hero's own sentence leads the h1; the extraction's
    // proven motto is the fallback door it always was. Never a line we wrote.
    const packetSlogan = briefSlogan(brief);
    const packetTagline = packetSlogan || provenTagline(prospect);
    if (packetSlogan) briefApplied.tagline = true;

    // Their site's own measured light/dark: the fleet measurement leads, the
    // brief fills when nothing ever measured this prospect.
    let packetSurface = clientSurfaceFor(prospect);
    if (!packetSurface.client_surface) {
      const fromBrief = briefClientSurface(brief);
      if (fromBrief.client_surface) { packetSurface = fromBrief; briefApplied.client_surface = true; }
    }

    // Their action colour as the accent the LOGO measurement may fall back to.
    // The packet's own measured colours still lead; the logo still outranks
    // every scrape one layer down.
    let packetAccentFallback = {};
    if (!leadMinerInput.brand.accent && !leadMinerInput.brand.accent_fallback) {
      const fb = briefAccentFallback(brief);
      if (fb.accent_fallback) { packetAccentFallback = fb; briefApplied.accent_fallback = true; }
    }

    // The colour their SITE wears, always supplied when the brief is confident
    // — the engine weighs it against the logo's colour and records the verdict
    // (checks.brand.accent_decision). See briefSiteAccent.
    const packetSiteAccent = briefSiteAccent(brief);
    if (packetSiteAccent.site_accent) briefApplied.site_accent = true;

    // The ranked bank rows travel WITH the plain photo URLs, wearing the
    // brief's identity verdicts, so the hero wash can prefer their CURRENT
    // hero image and their owner/crew portrait over "first usable photo".
    // briefFlaggedBank also front-loads any flagged URL into packetPhotos so
    // its bytes are actually fetched. Copied first: the miner's own array must
    // not be reordered under it.
    packetPhotos = [...packetPhotos];
    const packetBankBlock = photoBank.bankIsFresh(packetBank)
      ? briefFlaggedBank(packetBank, brief, packetPhotos, MAX_PHOTOS)
      : {};

    // Their typeface: the direct capture leads; the brief's RENDERED families
    // (with a stylesheet verified to serve them) fill when the capture failed.
    let packetBriefFonts = {};
    if (!(fonts && fonts.ok)) {
      const bf = briefFonts(brief);
      if (bf.fonts) { packetBriefFonts = bf; briefApplied.fonts = true; }
    }

    // A needs_fill rescue is evidence-only. Do not put compiler prose, derived
    // nearby towns, pride inference or research copy back into the exact path
    // whose packet was held for missing proof. Strict build-ready packets keep
    // their existing enrichment path; thin packets publish only the rescued
    // verified sections above.
    const packetContentFinal = leadMinerInput.needs_fill
      ? leadMinerInput.content
      : await withLocalResearch(
        withBriefBadges(
          withBriefTrust(
            withPride(
              await withNearbyTowns(leadMinerInput.content, leadMinerInput.facts, prospect),
              prospect,
            ),
            brief,
            { record: prospect.record || {}, applied: briefApplied },
          ),
          brief,
          { applied: briefApplied },
        ),
        leadMinerInput.facts,
        opts,
        deps.localResearch,
      );

    const request = {
      slug,
      donor: donorPick.donor,
      facts: { ...leadMinerInput.facts, industry },
      brand: {
        // Source-bound Packet2 design observations fill holes only. The
        // verified LeadMiner brand, runtime brief and logo-byte decision all
        // follow and therefore outrank them.
        ...pageHub.brand,
        ...leadMinerInput.brand,
        ...packetAccentFallback,
        ...packetSiteAccent,
        ...packetBankBlock,
        ...heroReelBlock(prospect.record || {}),
        ...(packetPhotos.length ? { photos: packetPhotos } : {}),
        ...laneMediaMode(opts),
        ...(fonts && fonts.ok
          ? {
            fonts: {
              ...(fonts.display ? { display: fonts.display } : {}),
              ...(fonts.body ? { body: fonts.body } : {}),
              ...(fonts.href ? { href: fonts.href } : {}),
              ...(fonts.source ? { source: fonts.source } : {}),
              provider: fonts.provider || "declared",
            },
          }
          : packetBriefFonts),
        ...(pageHubSourcePacket(pageHub) ? { source_packet: pageHubSourcePacket(pageHub) } : {}),
      },
      // THE INTAKE COMPILER'S HALF. When a packet exists for this client, its
      // PROSE and SEARCH INTENT fill the gaps the 19 flat facts never
      // contained — paragraphs, answers, the words customers actually type.
      // It can never introduce a fact: lib/intake-packet refuses to return
      // phone, address, rating or identity by construction, and merges only
      // into fields that are still empty.
      content: packetContentFinal,
      ...(signupPanel.signup ? { signup: signupPanel.signup } : {}),
      // Their site's own measured light/dark reading — see clientSurfaceFor.
      ...packetSurface,
      // Their slogan (the brief's, verbatim) or their proven motto. Blank means
      // the headline is composed from their name — never a slogan we wrote.
      ...(packetTagline ? { hero: { tagline: packetTagline } } : {}),
    };
    const res = await mirrorWithSlugConflictRetry({
      run: _mirror, engineDeps: _mirrorEngineDeps, readFleet: _readFleet, recordFleet: _recordFleet,
      claimRetry: _claimSamenessRetry,
      request, dryRun: opts.dryRun, lane: opts.lane, donor: donorPick.donor,
      prospectId: prospect.prospect_id || prospect.id || "",
      operationKey: opts.operationKey, signal: opts.signal, deadlineAt: opts.deadlineAt,
    });
    const body = res.body || {};
    const nativeReleaseEvidence = res.release_evidence || body.deployed_release_evidence || body;
    const failedSamenessProblems = body.checks?.sameness?.status === "failed"
      ? samenessProblems(res)
      : [];
    const failureDetail = failedSamenessProblems.length ? samenessFailureDetail(res) : null;
    // THE CONTENT FLOOR, on both build paths — see contentFloorReport. The
    // packet path already refuses its own empty service list upstream, so this
    // should never fire here; it is present because the two paths drifting is
    // how the sign-up panel went missing from every mirror in the first place.
    // The diagnostic context carries the dispatch-time Genie receipt verdict:
    // on this path the compiled substance reaches the floor ONLY through the
    // re-verified canonical merge, and a receipt that fails re-verification
    // drops about/faqs/services silently — the row must say that happened.
    const contentFloor = contentFloorReport(request.content, body, contentFloorDiagnostics({
      facts: request.facts,
      photos: packetPhotos.length,
      needsFill: !!leadMinerInput.needs_fill,
      certifiedGenieContent,
      record: prospect.record || {},
    }), { verification });
    const serviceFloorCheck = serviceFloorReport(request.content);
    return {
      ok: !!body.ok && failedSamenessProblems.length === 0,
      revealable: !!body.revealable && contentFloor.status === "passed" && serviceFloorCheck.status === "passed",
      preview_url: body.preview_url || "",
      // LIGHT vs FULL — stamped on the build result so rows, telemetry and any
      // later audit can tell a light-verified site from a fully-verified one.
      verification,
      // THE ENGINE'S OWN IDENTITY FOR THIS BUILD. It has always been on the
      // manifest and has never left this function, so everything downstream —
      // the render gate, the proof shots, the email — had no way to ask "is
      // what I stored a picture of the site that is live right now?" and had to
      // re-shoot from scratch on every single send.
      build_hash: body.build_hash || "",
      ...(body.renderer ? { renderer: body.renderer } : {}),
      ...(body.qc_contract ? { qc_contract: body.qc_contract } : {}),
      ...(body.evidence_schema ? { evidence_schema: body.evidence_schema } : {}),
      ...(body.evidence_sha ? { evidence_sha: body.evidence_sha } : {}),
      ...(body.donor_content_hash ? { donor_content_hash: body.donor_content_hash } : {}),
      ...(body.logo_sha ? { logo_sha: body.logo_sha } : {}),
      ...(body.deploy_id ? { deploy_id: body.deploy_id } : {}),
      ...(body.deploy_url ? { deploy_url: body.deploy_url } : {}),
      ...(body.proofIdentity ? { proofIdentity: body.proofIdentity } : {}),
      ...(body.sharedReleaseEvidence ? { sharedReleaseEvidence: body.sharedReleaseEvidence } : {}),
      // The renderer-signed native manifest, intact. Downstream send gates
      // recompute evidence_sha from this exact object; scalar copies alone
      // cannot prove that the checks belong to this deployed build.
      release_evidence: nativeReleaseEvidence,
      // THE DECIDED ACCENT, DISTILLED. The colour the engine's arbitration
      // actually shipped (checks.brand.accent_hex / accent_decision), carried
      // beside the raw manifest so the persistence layers — full-run's
      // mergedRecord, line-adapters' mirrorRecordPatch — can stamp
      // record.brand_truth without re-opening the engine's checks. Absent when
      // the build recorded no shipped hex; never invented.
      ...((() => { const t = brandTruthFromEvidence(nativeReleaseEvidence); return t ? { brand_truth: t } : {}; })()),
      slug: request.slug,
      donor: donorPick.donor,
      vertical: donorPick.vertical,
      facts: { ...leadMinerInput.facts, industry },
      truth_packet: leadMinerInput.truth_packet || prospect.truth_packet || null,
      photoCount: packetPhotos.length,
      // A signed packet build may arrive with a bank that was harvested and
      // persisted before this zero-provider-call stage. The request already
      // consumes those ranked URLs above; carry the exact same fresh evidence
      // to the Line so its hero worker can persist/verify it instead of
      // treating a banked prospect as if it had no owned photography.
      ...(photoBank.bankIsFresh(packetBank) ? { owned_photo_bank: packetBank } : {}),
      // The over-cap about note from leadMinerMirrorInput's certified merge:
      // the packet's rich about was portioned to the schema cap instead of
      // refusing the business (see mergeIntoContent in lib/intake-packet).
      ...(leadMinerInput.about_compressed_to_cap
        ? { about_compressed_to_cap: leadMinerInput.about_compressed_to_cap }
        : {}),
      contentCoverage: {
        services: (request.content.services || []).length,
        reviews: (request.content.reviews || []).length,
        hours: (request.content.hours || []).length,
      },
      status: res.status,
      ...(body.retryable === true || res.retryable === true ? { retryable: true } : {}),
      ...(body.provider_attempted === true || res.provider_attempted === true ? { provider_attempted: true } : {}),
      ...(body.manual_reconciliation_required === true || res.manual_reconciliation_required === true
        ? { manual_reconciliation_required: true }
        : {}),
      ...(body.disposition === "system_hold" || res.disposition === "system_hold"
        ? { disposition: "system_hold", lead_rejection: false }
        : {}),
      ...((body.system_hold || res.system_hold) ? { system_hold: body.system_hold || res.system_hold } : {}),
      ...((body.reconciliation || res.reconciliation)
        ? { reconciliation: body.reconciliation || res.reconciliation }
        : {}),
      checks: { ...(body.checks || {}), content_floor: contentFloor, service_floor: serviceFloorCheck, design_brief: designBriefReport(briefOut, briefApplied, body) },
      content_floor: contentFloor,
      service_floor: serviceFloorCheck,
      design_brief: designBriefReport(briefOut, briefApplied, body),
      signup_panel: signupPanelReport(signupPanel, body),
      error: body.error || null,
      // THE ENGINE'S FIELD-LEVEL CAUSE, carried out. A 400 invalid_request
      // arrives with detail like {path:"/brand/logo", message:"must match
      // pattern ^https://"} — the exact sentence that names the defect — and
      // this return used to drop it, so the operator's row could only ever say
      // "invalid_request" (or worse). See lib/line-adapters describeRefusal.
      detail: failureDetail || (Array.isArray(body.detail) && body.detail.length ? body.detail : null),
      reason: failedSamenessProblems.length
        ? "not_revealable"
        : body.ok ? floorReason(contentFloor, serviceFloorCheck) : (body.error || "build_failed"),
      source: "leadminer_mirror_ready",
      // AI-fill provenance, carried out so the email composer and any audit can
      // tell a filled build apart from a fully-verified one. "verified" when the
      // whole build came from the client's own proven content.
      content_source: leadMinerInput.content_source || "verified",
      content_provenance: leadMinerInput.content_provenance || {},
      brand_provenance: leadMinerInput.brand_provenance || null,
      needs_fill: !!leadMinerInput.needs_fill,
      provider_calls: {
        google: 0,
        firecrawl: 0,
        intake_genie: 0,
        ...(leadMinerInput.needs_fill ? needsFillProviderCalls : {}),
      },
    };
  }

  // 2. VERIFIED FACTS with provenance; falls back to the mined contract, then
  //    to the prospect's own fields.
  const contract = contractFactsOf(prospect);
  let verified = { facts: {}, content: {}, coverage: {} };
  let factResolution;
  try {
    const v = await _resolveFacts({
      prospect: {
        prospect_id: prospect.prospect_id, business_name: businessName, industry,
        city: prospect.postal_city || prospect.city || prospect.marketing_city,
        state: prospect.postal_state || prospect.state || prospect.marketing_city_state,
        query_city: miningMarket.city,
        query_state: miningMarket.state,
        current_website: prospect.site || prospect.current_website,
        email: prospect.email, place_id: prospect.place_id || contract.place_id,
        // THE ROW ITSELF, so the resolver's own cachedProspectRow source has
        // something to read. It reported `not_supplied` on every mined build we
        // have ever run, because this call hand-built a prospect object and
        // never passed one. Advisory only by that source's design — it can
        // never resolve a fact — but a source that is structurally unable to
        // observe is a source nobody can fix.
        record: prospect.record || null,
      },
    });
    factResolution = factResolutionReport(v);
    // KEEP WHAT RESOLVED. `ok:false` means the resolver did not reach the
    // MirrorRequest minimum on its own — it does not mean the fields it DID
    // resolve are unverified. Every value inside `facts`/`content` cleared the
    // same evidence bar either way, and each is strictly better sourced than
    // the loose prospect column it would otherwise be replaced by. Discarding
    // them is how Carter's lost twelve services it had already been given.
    if (v) verified = { facts: v.facts || {}, content: v.content || {}, coverage: v.coverage || {} };
  } catch (e) {
    factResolution = factResolutionReport(null, e);
  }
  const vf = verified.facts || {};

  const facts = {
    business_name: vf.business_name || contract.business_name || businessName,
    industry,
    city: vf.city || contract.city || prospect.postal_city || prospect.city || prospect.marketing_city,
    state: vf.state || contract.state || prospect.postal_state || prospect.state || prospect.marketing_city_state,
  };
  // THE MARKETING CITY OUTRANKS THE POSTAL ONE — deliberately. Farr Better
  // Plumbing's NAP city is Republic, MO; they self-publish "Springfield", and
  // "Plumbing in Springfield, MO" is the truer headline for a Springfield-area
  // plumber. That behaviour is correct and is left alone.
  //
  // BUT A STATE IS NOT A CITY. The same field, taken from the same kind of
  // first-party evidence, gave The Chill Brothers (Spring, TX) the marketing
  // city "Texas" — their own schema.org areaServed — and the lane published
  // "HVAC Contractor in Texas, TX" in the title and "HVAC in Texas, TX" in the
  // h1. A statewide service claim is true and useful; it is simply not the
  // answer to "which town?", and rendering it in the town slot produces a
  // stutter no local business would write, on the first line a prospect reads.
  // Fall back to the postal city, which is what the slot was always asking for.
  // NOT written onto `facts`: that object IS the mirror request's facts block
  // and the schema admits no unknown key, so a diagnostic field here would fail
  // the whole build as invalid_request — the exact trap the http-photo note
  // below records. The refusal is reported, not smuggled into the payload.
  let marketCity = vf.service_area || contract.service_area || prospect.marketing_city;
  // A STORED SERVICE AREA IS NOT ALWAYS A STRING. Older rows carry the miner's
  // area LIST (record.service_area = ["Fort Worth", "Arlington", ...]) and the
  // schema types facts.service_area as string, so the whole build died as
  // invalid_request "/facts/service_area must be string" — measured 2026-08-12
  // on Davis Roofing Solutions and Landscape Connection, both healthy leads.
  // The slot asks "which town?"; a list's first town is that answer. Anything
  // else non-string is dropped, which falls back to the postal city — absent
  // still beats invented, and a 400 was never the right answer to good data.
  if (Array.isArray(marketCity)) {
    marketCity = marketCity.map((v) => String(v == null ? "" : v).trim()).find(Boolean) || "";
  } else if (marketCity != null && typeof marketCity !== "string") {
    marketCity = "";
  }
  let refusedMarketCity = "";
  let refusedMarketReason = "";
  if (marketCity) {
    const market = eligibleMarketCity({
      assertedCity: marketCity,
      assertedState: prospect.marketing_city_state,
      queryCity: miningMarket.city,
      queryState: miningMarket.state,
      napCity: facts.city,
      napState: facts.state,
      businessName: facts.business_name,
    });
    if (market.eligible) {
      facts.service_area = market.service_area;
    } else {
      refusedMarketCity = String(marketCity);
      refusedMarketReason = market.reason;
    }
  }
  // THE GEO AND PLACE FACTS THE CONTRACT ALREADY PROVED. Carried, never
  // re-derived — see the note on CONTRACT_STRING_FACTS. A fresh observation
  // still outranks the stored one; absent still beats invented.
  // A CONTESTED ADDRESS IS NOT PUBLISHED — not the resolver's copy, and not the
  // contract's. See withheldAddress() for the measured case this closes.
  const addressVerdict = withheldAddress(factResolution && factResolution.conflicts);
  for (const key of CONTRACT_STRING_FACTS) {
    if (key === "service_area") continue;
    if (addressVerdict.withhold && ADDRESS_FIELDS.includes(key)) continue;
    const value = String(vf[key] || contract[key] || "").trim();
    if (value) facts[key] = value;
  }
  for (const key of CONTRACT_NUMBER_FACTS) {
    const value = Number(vf[key] ?? contract[key]);
    if (Number.isFinite(value)) facts[key] = value;
  }
  // https ONLY, same rule as the packet path above — and for the same reason.
  // The mirror-request schema admits no other scheme (the engine puts this in
  // schema.org sameAs), so a plain-http site fails the WHOLE build as
  // invalid_request. That is backwards: no TLS is one of the defects we exist
  // to fix. This guard was applied to the packet fact-builder and MISSED here,
  // so every non-packet lead with an http-only site died at 400 — M & M Heating
  // among them. The http URL stays on the prospect row, where the before-shot
  // and the email's "your site today" still read it.
  const finalVerifiedWebsite = firstHttpUrl([vf.current_website, contract.current_website]);
  const website = finalVerifiedWebsite || prospect.site || prospect.current_website;
  // Same schema law for the URL's FORMAT as for its scheme: a site URL with a
  // stray space or control character would 400 the request at
  // /facts/current_website, so it is sanitized like every other traveling URI.
  // `website` itself stays raw — the harvest and the design brief read it fine.
  const factsWebsiteUrl = sanitizeHttpsUri(String(website || ""));
  if (factsWebsiteUrl) facts.current_website = factsWebsiteUrl;

  // NOW Packet2 may speak on the resolver lane. Bind it only to a website that
  // the independent resolver or the stored verified contract supplied — never
  // to the loose caller field used merely to help the resolver find the row.
  // This ordering prevents a stale/malicious current_website from laundering a
  // different company's logo, palette, fonts, services, socials or photos into
  // a request whose final facts point at the real business.
  const pageHubVerifiedWebsite = finalVerifiedWebsite;
  pageHub = pageHubBuildSupplement(prospect.record || {}, { website: pageHubVerifiedWebsite });
  recordedSiteAccent = siteAccentEvidence(
    prospect,
    prospect.brand,
    prospect.record,
    prospect.record?.brand,
    storedContract(prospect).brand,
    pageHub.brand,
  );

  if (!logo && pageHub.logo_candidate?.url) {
    const stagedLogo = pageHub.logo_candidate.url;
    if (isThirdPartyMark(String(stagedLogo).replace(/^https?:\/\//i, ""))) {
      return {
        ok: false,
        reason: "logo_third_party_mark",
        detail: `${businessName}'s only logo candidate is a third-party mark (${String(stagedLogo).slice(0, 120)}) — that is someone else's trademark, not their identity, and we do not publish it as theirs`,
        industry,
      };
    }
    if (!pageHubVerifiedWebsite || !ownsLogo(pageHubVerifiedWebsite, stagedLogo, businessName)) {
      return {
        ok: false,
        reason: "logo_provenance_failed",
        detail: `${businessName}'s supplied logo candidate has no first-party ownership evidence (${String(stagedLogo).slice(0, 120)})`,
        industry,
      };
    }
    logo = sanitizeHttpsUri(String(stagedLogo || ""));
  }
  if (!logo && !allowLogoFallback) {
    return {
      ok: false,
      reason: "no_verified_logo",
      detail: `${businessName} has no verified logo`,
      industry,
    };
  }
  resolverMark = !logo && allowLogoFallback
    ? chooseBrandMark({
      logoCandidates: [],
      businessName,
      accent: recordedSiteAccent.site_accent || prospect.logo_accent || prospect.brand?.accent || "",
    })
    : null;
  const email = vf.email || prospect.email;
  if (email) facts.email = email;
  // The resolver's phone first; the mined contract's Google-observed NAP phone
  // as fallback. The contract value is provenanced (google_places, frozen), not
  // a guess — and without it the donor's call CTAs collapse and the render
  // gate fails the mirror on nap_match. Live-verified: the built page shipped
  // with no tel: link at all.
  if (vf.phone) facts.phone = vf.phone;
  else if (prospect.phone) facts.phone = prospect.phone;
  else if (contract.phone) facts.phone = contract.phone;
  // Rating and review_count are written as a PAIR or not at all — a star with
  // no count, or a count with no star, is a trust claim nobody can check.
  const rating = Number(vf.rating ?? prospect.rating ?? contract.rating);
  const reviewCount = Number(vf.review_count ?? prospect.review_count ?? contract.review_count);
  // WHICH OBSERVATION THIS IS, recorded as it is chosen.
  //
  // The render gate re-checks the published AggregateRating against the FROZEN
  // mined contract, while the page publishes whatever this line resolved. When
  // the resolver returns a fresher Google reading the two disagree by exactly
  // the reviews the business earned in between, and the gate refuses a mirror
  // for being MORE accurate than its own reference. Measured 2026-08-08:
  // Maston's Plumbing & Drain published 4.9/679 against a stored 678 (still 678
  // in the store today); Paschal 2128 against 2127. Both refusals came after a
  // deploy and a chromium render. The failure is one-directional — the frozen
  // number is always the older, lower one — so it recurs on exactly the
  // high-review-velocity businesses most worth pitching.
  //
  // Only a LIVE observation may stand in for the contract downstream. A value
  // that came off the prospect column or the contract itself is not fresher
  // than the contract and is labelled so it cannot pretend to be.
  let aggregateOrigin = Number(vf.rating) > 0 && Number(vf.review_count) > 0
    ? "verified_facts_resolver"
    : (Number(prospect.rating) > 0 ? "prospect_record" : "mined_contract");
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(reviewCount) && reviewCount > 0) {
    facts.rating = rating; facts.review_count = Math.trunc(reviewCount);
  }

  // 3. THE CLIENT'S OWN PHOTOGRAPHY — priority-first, ownership-gated, capped.
  //
  // THE ORDER THAT ARRIVES HERE IS LOAD-BEARING. The donor decides how many of
  // these are ever seen — plumbing-clean declares TWO photo_slots — and the
  // engine fills those slots in array order. So this list is not "the photos we
  // found", it is "the photos in the order we want them shown", already ranked
  // by the harvester. Re-sorting or shuffling it here silently changes what the
  // client sees on their own homepage.
  //
  // THEIR GOOGLE BUSINESS MEDIA is the owner's second named source and is
  // passed through whenever the mined record already carries resolved media
  // URLs. It is the only source that can work for a business whose website is a
  // single JS-rendered page with no <img> in the served HTML (Poor John's
  // Plumbing, live, shipped donor-only for exactly this reason). Resource names
  // of the form "places/…/photos/…" are NOT urls and are skipped: resolving them
  // costs a Places media call the miner is the right place to make, and inventing
  // one here would put an unverified URL into the ownership gate.
  //
  // THE BANK COMES FIRST. If the miner already harvested this client's
  // photographs, they are on the record with a sha, dimensions and the page
  // each was found on, and re-crawling their website would cost ten seconds to
  // arrive at the same list — or, if their site is down today, at a shorter
  // one. See lib/client-photo-bank.js.
  let photos = [];
  let banked = photoBank.bankFromRecord(prospect.record || {});
  if (photoBank.bankIsFresh(banked)) {
    photos = photoBank.bankToRequestPhotos(banked, MAX_PHOTOS);
  }
  if (!photos.length && website) {
    try {
      // THEIR GOOGLE BUSINESS MEDIA, READ FROM WHERE IT ACTUALLY IS.
      //
      // This line used to read `prospect.record.photos` — a field NOTHING
      // writes (measured 2026-08-11: 0 of 1333 rows) — and then required each
      // entry to be a string. The resolved Google URLs are real and they are on
      // the record: M & M Heating carries four at
      // record.leadminer_mirror_ready.photos[].url, as OBJECTS. Both halves of
      // that had to be wrong at once for the owner's second named source to
      // reach zero builds, and both were.
      const gbpEvidence = photoBank.gbpMediaFromRecord(prospect.record || {});
      const gbpPhotos = gbpEvidence.map((row) => row.url);
      const h = await _harvest({ website, gbpPhotos, genieAssets: intakeGeniePhotoCandidates(prospect, pageHub) });
      // https ONLY — the same rule the packet path applies, and the same rule
      // the schema and the SSRF-guarded fetch apply one layer down. It was
      // MISSING here, so All Home Plumbing Co. (Chattanooga), whose site is
      // http-only, harvested seven of its own real photos and then failed the
      // WHOLE build as invalid_request on /brand/photos/0..6 — a company with a
      // verified logo, killed by its own pictures. An http photo is dropped, not
      // fatal: the donor's generic imagery is the documented safe fallback, and
      // guardedFetch would have refused these bytes anyway.
      if (h && h.ok) {
        photos = h.photos
          // NOT THEIRS TO GIVE, even from their own server. The ownership gate
          // one layer down proves the BYTES are served from the client's space;
          // it cannot see that /md/dmtmpl/people_pool_party-1920w.jpg is the
          // site builder's shared stock library, that RS3204056 is a stock id
          // (that one shows another contractor's service sticker), or that
          // Gemini_Generated_Image_* was never a photograph of anyone's work.
          // All three were live candidates on one real prospect. See
          // lib/client-photo-bank.js notTheirPicture for the evidence.
          .filter((p) => !photoBank.notTheirPicture(p))
          .map((p) => p.url)
          .filter((url) => /^https:\/\//i.test(String(url || "")))
          .slice(0, MAX_PHOTOS);

        // BANK THE HARVEST WE JUST RAN, so the design brief's identity verdicts
        // have somewhere to land and the engine's hero wash stops shipping
        // starved.
        //
        // Until here this branch kept only the URL strings for brand.photos and
        // threw away the ranked bank ROWS — the grade the hero slot needs and
        // the sha the engine joins bytes on. Nothing writes a bank onto a mined
        // record either (client-photo-bank.js header: 0 of 1333 rows), so
        // `banked` above was null, resolverBankBlock below computed to `{}`, and
        // `brand.photo_bank` never travelled. Downstream, pickHeroPhoto had
        // nothing to pick and the engine reported hero_wash "no_photo_bank" on
        // EVERY page hero (home, services, service-area, about, contact) — the
        // barren cream heroes the render audit found. bankFromHarvest turns the
        // bytes already in hand into the durable bank those consumers read,
        // through the same ownership/grade/rank primitives as the crawling path
        // and with no extra network. Only when the record carried no fresh bank
        // of its own — a real one still wins.
        if (h.ok && Array.isArray(h.photos) && h.photos.length && !photoBank.bankIsFresh(banked)) {
          banked = photoBank.bankFromHarvest(h.photos, {
            website,
            placeId: facts.place_id,
            gbpEvidence,
          });
        }
      }
    } catch { /* no photos: a smaller gallery, never stock */ }
  }

  // 4. VERIFIED CONTENT — services / reviews / hours the resolver corroborated,
  //    then the same sections off the mined contract, then Google's review
  //    corpus for the exact place_id this lead was identified by, and finally
  //    the real towns around them (see withNearbyTowns).
  //
  //    THE ORDER IS THE EVIDENCE ORDER, and each source only fills what the one
  //    before it could not reach. Nothing is blended and nothing is invented: a
  //    section with no source is a section the page does not render.
  const resolverContent = contentFromVerified(verified.content || {});
  const contractContent = contentFromContract(prospect);
  // WHAT THE SOURCES OFFERED, BEFORE THE TWO SHAPERS ABOVE DROPPED THE
  // UNPUBLISHABLE ONES. Read only by serviceFloorReport, which has to be able
  // to say "four labels were harvested and all four were menu items" rather
  // than "no services resolved". Never used to build anything.
  const rawServiceLabels = [
    ...serviceLabels((verified.content || {}).services),
    ...serviceLabels((isObject(prospect.verified_content) ? prospect.verified_content : {}).services),
    ...serviceLabels((storedContract(prospect).content || {}).services),
    ...serviceLabels(pageHub.services),
  ];

  // GOOGLE'S REVIEWS FOR A PLACE WE ALREADY IDENTIFIED. Every lead mined
  // through the console before 2026-08-06 stored a contract with no content
  // block at all, because mineBuildReady bought places.reviews and
  // places.regularOpeningHours on its paid call and then wrote neither (the
  // miner now writes both — see contentFromPlace there). Rather than strand
  // every one of those rows with a review-less mirror, the corpus is fetched
  // back — PINNED to the contract's place_id, and refused outright on any
  // mismatch. See lib/verified-trust-lookup.js for why an unpinned lookup
  // returned a different Carter's branch's 2,810 reviews.
  //
  // REVIEWS *OR* HOURS, because ONE CALL RETURNS BOTH. The gate used to read
  // reviews only, so a lead that resolved reviews but lost its hours never made
  // the call and shipped with no hours table — even though the answer was
  // sitting in a response we simply did not ask for. Jam Plumbing (Portland),
  // 2026-08-06: three real reviews on the page, seven real rows of Google
  // opening hours nowhere on it. Widening the gate cannot cost an extra request
  // in the common case (a lead with both already resolved still skips), and in
  // the case it does fire it is the same single request that was always going
  // to be needed for the missing half.
  let trustLookup = { status: "not_attempted" };
  const haveReviews = Boolean(resolverContent.reviews?.length || contractContent.reviews?.length);
  const haveHours = Boolean(resolverContent.hours?.length || contractContent.hours?.length);
  // THE STAR RAIL IS THE THIRD THING THIS ONE REQUEST RETURNS, and it was the
  // only one the gate never asked about. Carter's My Plumber is the measured
  // case: its contract carries hours and a place_id but no aggregate at all,
  // and its record's 4.9 / 1,315 never reached the request, so the page said
  // nothing about a corpus of 1,315 reviews. Widening the gate here cannot cost
  // an extra call in the common case — a lead that already holds all three
  // still skips — and where it does fire it is the same single request that was
  // going to be needed anyway.
  const haveAggregate = Number(facts.rating) > 0 && Number(facts.review_count) > 0;
  const needsTrust = !haveReviews || !haveHours || !haveAggregate;
  if (needsTrust && facts.place_id && opts.trustLookup !== false) {
    const _trust = deps.verifiedTrustForPlace || verifiedTrustForPlace;
    try {
      const t = await _trust(facts);
      trustLookup = {
        status: t.ok ? "pinned" : "refused",
        reason: t.reason || "",
        wanted: [!haveReviews ? "reviews" : "", !haveHours ? "hours" : "", !haveAggregate ? "rating" : ""].filter(Boolean),
        diagnostics: t.diagnostics || null,
      };
      if (t.ok) {
        const featured = featuredReviews(reviewsFromContract(t.reviews));
        trustLookup.reviews_withheld_below_min_rating = featured.withheld;
        const reviews = featured.reviews;
        if (reviews.length) contractContent.reviews = contractContent.reviews || reviews;
        if (Array.isArray(t.hours) && t.hours.length && !contractContent.hours) contractContent.hours = t.hours;
        if (t.profile_url && !facts.profile_url) facts.profile_url = t.profile_url;
        // Google's own aggregate FOR THE PINNED PLACE. Written as a pair, only
        // when we had none, and only off a response that cleared the place_id
        // pin — so the star on the page and the quotes under it are the same
        // branch's, by construction, and never a sibling's larger number.
        if (!haveAggregate && Number(t.rating) > 0 && Number(t.review_count) > 0) {
          facts.rating = Number(t.rating);
          facts.review_count = Math.trunc(Number(t.review_count));
          trustLookup.aggregate_from_pinned_place = { rating: facts.rating, review_count: facts.review_count };
          // A live Google read against the pinned place_id — the same class of
          // evidence as the resolver's, and fresher than the frozen contract.
          aggregateOrigin = "pinned_place_lookup";
        }
      }
    } catch (e) {
      trustLookup = { status: "threw", reason: boundedDetailText((e && e.message) || e, 200) };
    }
  } else if (!needsTrust) {
    trustLookup = { status: "not_needed", reason: "reviews and hours already verified upstream" };
  } else if (!facts.place_id) {
    trustLookup = { status: "skipped", reason: "no_verified_place_id_to_pin_to" };
  }

  // SERVICES ARE THE ONE SECTION WHERE THE CONTRACT OUTRANKS THE RESOLVER.
  //
  // mergeContentSources is first-non-empty and the resolver leads, which is
  // right for reviews and hours: a fresh observation beats a frozen one. For
  // services it inverted the quality order and the fleet paid for it. The
  // resolver's service list is built from the client's NAVIGATION — anchor text
  // on links to their own pages — while the contract's is built from their own
  // declared schema.org offer catalogue and the headings inside their own
  // services section (see lead-miner mineBuildReady and service-harvest.js).
  // Resolver-first therefore meant "the menu bar beats the page", by design, on
  // every build-ready lead, which is how "Photo Gallery", "Comfort Club" and
  // "Products" became three of Rose City's twelve schema.org Services.
  //
  // NOT A BLEND. The whole list still comes from exactly one observation; only
  // which observation leads changes, and only for this key. When the contract
  // has no services the resolver supplies all of them, unchanged.
  const pageHubContent = pageHub.services.length ? { services: pageHub.services } : {};
  const merged = mergeContentSources(resolverContent, contractContent, pageHubContent);
  if (contractContent.services && contractContent.services.length) {
    merged.services = contractContent.services;
  }
  // THE FACES THE MERGE WAS THROWING AWAY.
  //
  // First-non-empty is right for reviews as a CORPUS — five quotes half from
  // one observation and half from another is a corpus nobody observed. But the
  // resolver's review set frequently carries no `avatarUrl` while the stored
  // contract's carries several, and losing the whole key meant losing every
  // face on the page. Measured 2026-08-11: eight of eight live mirrors whose
  // contracts hold real Google-served reviewer photos rendered ZERO faces, and
  // a fresh Cardinal Plumbing build reproduced it exactly — contract 4 avatars
  // in, request `faces: 0` out.
  //
  // This is not a blend. Nothing is merged across observations: a face is only
  // restored onto a review whose AUTHOR AND TEXT are identical to the one the
  // contract observed, which makes it the same Google review record seen twice
  // and the avatar a field that was dropped, not a photo that was matched. An
  // ambiguous match (two reviews with the same author and text) restores
  // nothing — someone else's face under someone's words is the worst defect
  // this page could carry.
  // Assigned only when there is a list to assign — writing `reviews: undefined`
  // onto the request makes Ajv see the key as PRESENT and 400s the build.
  const withFaces = restoreReviewFaces(merged.reviews, contractContent.reviews);
  if (Array.isArray(withFaces)) merged.reviews = withFaces;
  // OVER-CAP COMPRESSES, NEVER REFUSES: the receipt-bound canonical merge is
  // the door the production refusal walked through (an over-cap
  // /content/about 400'd the whole engine request). The note rides the build
  // result instead of the business dying for having a rich homepage.
  const receiptNotes = [];
  const receiptBoundContent = certifiedGenieContent.ok
    && certifiedGenieContent.canonical_packet?.ok === true
    ? mergeIntoContent(merged, certifiedGenieContent.canonical_packet, { notes: receiptNotes })
    : merged;
  const aboutCompressed = receiptNotes.find((row) => row.note === "about_compressed_to_cap") || null;
  const content = await withNearbyTowns(receiptBoundContent, facts, prospect);

  // 5. BRAND — the client's own logo (resolved and gated at step 1b, so it is
  //    always present here); accent measured from its bytes downstream, which
  //    is the provenance the owner's palette-from-the-logo rule wants and the
  //    reason the miner's colour is still not passed as `accent`.
  //
  //    BUT MEASUREMENT CAN FAIL FOR A REASON THAT HAS NOTHING TO DO WITH THE
  //    LOGO. measureAccent decodes PNG in pure JS and shells out to ffmpeg for
  //    every other format, and ffmpeg is not in the serverless runtime. Just
  //    Air LLC's mark is a JPEG: it measured null, brand came back
  //    logo="client" / accent="donor-default", and the engine refused the whole
  //    mirror as `unbranded` — while mirror_request.brand.accent = "#0c449a",
  //    measured by the miner from that very file and ownership-gated by
  //    ownsLogo, the third-party denylist and a magic-byte sniff, sat unread on
  //    the record. So it travels as accent_FALLBACK: brand-assets can only use
  //    it after its own measurement has come back empty. Nothing that measures
  //    today changes, and with no fallback the accent is still null, never a
  //    donor hue.
  const accentFallback = (/^#[0-9a-f]{6}$/i.test(String(prospect.logo_accent || "").trim())
    && /^https:\/\//i.test(String(prospect.logo_accent_source || "")))
    ? { accent_fallback: String(prospect.logo_accent).trim(), accent_fallback_source: String(prospect.logo_accent_source) }
    : {};
  const slug = opts.slug || establishedSlug(prospect) || slugFor(facts.business_name, facts.city);

  // 4b. THE PROFILES THEY DID NOT KNOW WERE THEIRS.
  //
  //     The owner's thesis for the whole product: "we have gathered their
  //     assets that they didn't even know they were on and put them all on
  //     their site for them to see clearly... that's gonna blow their mind."
  //
  //     A stored contract may already carry them (the miner discovers them
  //     during the mine, off the homepage GET it was making anyway). Anything
  //     stored is carried intact — it was proved once and does not need
  //     re-proving. When nothing is stored and we know their website, we look:
  //     one homepage GET for the links they published themselves, plus at most
  //     one search for the profiles they never linked.
  //
  //     EVERY FAILURE MODE HERE IS SILENCE. Unreachable site, no key, no
  //     matches, a thrown provider — all of them mean "no social bar", never
  //     "no mirror". This is optional richness and the owner was explicit that
  //     optional richness must not break a build: "If we meet eighty percent
  //     of the criteria... that shouldn't break the site from sending or being
  //     mirrored."
  const socialContract = (!Array.isArray(contract.socials) || !contract.socials.length) && pageHub.socials.length
    ? { ...contract, socials: pageHub.socials }
    : contract;
  const socialOut = await _resolveSocials({ facts, vf, contract: socialContract, opts });
  if (socialOut.socials.length) facts.socials = socialOut.socials;

  // THE DESIGNER'S BRIEF — their own site, read before we build. Runs here,
  // after the facts are assembled, so the slogan heuristic knows the business
  // name it must never mistake for a motto. See designBriefFor for the whole
  // contract; every application below is fail-soft and reported.
  const briefOut = await designBriefFor({ prospect, facts, opts, briefImpl: deps.buildDesignBrief });
  const brief = briefOut.status === "ok" ? briefOut.brief : null;
  const briefApplied = { tagline: false, client_surface: false, accent_fallback: false, site_accent: false, fonts: false, photos: 0, credentials: 0, promotions: 0, differentiators: 0, financing: false };

  // THE SLOGAN RULE: Farr Better builds with "Big City Service. Small Town
  // Value." on top — their hero's own sentence first, the extraction's proven
  // motto as the fallback, the business name only when neither exists.
  const resolverSlogan = briefSlogan(brief);
  const resolverTagline = resolverSlogan || provenTagline(prospect);
  if (resolverSlogan) briefApplied.tagline = true;

  // Their site's measured light/dark: stored fleet measurement leads, the
  // brief fills when this prospect was never measured.
  let resolverSurface = clientSurfaceFor(prospect);
  if (!resolverSurface.client_surface) {
    const fromBrief = briefClientSurface(brief);
    if (fromBrief.client_surface) { resolverSurface = fromBrief; briefApplied.client_surface = true; }
  }

  // Their measured ACTION colour, as the fallback the logo measurement is
  // allowed to use — the logo still outranks the page (owner's rule).
  let resolverAccentFallback = accentFallback;
  if (!resolverAccentFallback.accent_fallback) {
    const fb = briefAccentFallback(brief);
    if (fb.accent_fallback) { resolverAccentFallback = fb; briefApplied.accent_fallback = true; }
  }

  // The colour their SITE wears, always supplied when the brief is confident —
  // the engine weighs it against the logo's colour and records the verdict in
  // checks.brand.accent_decision (Family Heating: blue site, red-bearing logo,
  // the site now wins). See briefSiteAccent.
  let resolverSiteAccent = recordedSiteAccent;
  if (!resolverSiteAccent.site_accent) {
    resolverSiteAccent = briefSiteAccent(brief);
    if (resolverSiteAccent.site_accent) briefApplied.site_accent = true;
  }

  // 4c. THEIR REAL PHOTOGRAPHS, SECOND PASS — the discard this lane used to make.
  //
  //     THE BUG, in order: the harvest above runs BEFORE the brief exists, and
  //     briefFlaggedBank can only decorate rows a bank ALREADY holds — so on a
  //     thin harvest (JS-rendered gallery, lazy-loaded <img>, photos only on
  //     interior pages) it returns {} and every picture the brief measured in a
  //     real browser is thrown away. The page then falls back to the donor's
  //     generic imagery. metrofence.net is the worked example: ~10 real
  //     fence-install photographs on their own pages (WRC-6x6-post-crossbuck-130,
  //     IMG_0468, Montage-3R-Majestic-151 …) and a mirror wearing
  //     /images/service-wood.jpg.
  //
  //     SECOND PASS, NOT A REORDER. Running the brief before the harvest would
  //     move a Chromium render in front of the fact assembly it depends on; this
  //     instead spends one image-only harvest AFTER the brief, on exactly the
  //     URLs the brief already proved and the first pass does not already hold.
  //     It opens no page (BRIEF_PASS_NO_HTML + crawl:false) and it asks for
  //     nothing when there is nothing new to ask for.
  //
  //     EVERY GATE STILL RUNS. The URLs go through the SAME harvestClientPhotos
  //     the first pass used, so ownership (registrable(host) === their domain, or
  //     Google's GBP media host), the stock-library refusals, the icon hints, the
  //     magic-byte sniff, the pixel floor, the byte/variant dedupe and the https
  //     rule all apply — and photoBank.notTheirPicture filters the survivors
  //     exactly as at the first pass. A photograph that cannot prove it is theirs
  //     is dropped here too.
  //
  //     FAIL-SOFT: anything thrown leaves `photos` precisely as it was.
  if (brief && website && photos.length < BRIEF_PHOTO_FLOOR) {
    const briefUrls = briefMeasuredPhotoUrls(brief).filter((u) => !photos.includes(u));
    if (briefUrls.length) {
      try {
        const h2 = await _harvest({
          website,
          extraUrls: briefUrls,
          html: BRIEF_PASS_NO_HTML,
          crawl: false,
        });
        if (h2 && h2.ok && Array.isArray(h2.photos) && h2.photos.length) {
          const added = h2.photos
            .filter((p) => !photoBank.notTheirPicture(p))
            .map((p) => String((p && p.url) || ""))
            .filter((url) => /^https:\/\//i.test(url) && !photos.includes(url));
          if (added.length) {
            // Additive and behind the existing ranking, the same contract the
            // packet path uses when banked site photography extends a gallery.
            photos = [...photos, ...added].slice(0, MAX_PHOTOS);
            briefApplied.photos = added.length;
          }
          // No bank on the record and none from the first pass: these bytes are
          // the only bank this build will have, and the hero wash needs one.
          if (!photoBank.bankIsFresh(banked)) {
            banked = photoBank.bankFromHarvest(h2.photos, { website, placeId: facts.place_id });
          }
        }
      } catch { /* their pictures are richness, never the build */ }
    }
  }

  // THE BANK TRAVELS TOO. photo_bank.photos[].url is RequiredHttpsUri in the
  // schema exactly like the plain brand.photos list, so one row carrying a
  // space or a non-https URL 400s the request at /brand/photo_bank/photos/N/url
  // even after the plain list is clean. Drop the un-URI-able rows before the
  // brief reads the bank — counted separately, because these are the same
  // photographs the plain-list sanitizer drops downstream and one number must
  // not count a picture twice.
  let bankRowsDroppedInvalid = 0;
  if (photoBank.bankIsFresh(banked) && Array.isArray(banked.photos)) {
    const bankedRows = [];
    for (const row of banked.photos) {
      const rowUrl = sanitizeHttpsUri(String((row && row.url) || ""));
      if (!rowUrl) {
        bankRowsDroppedInvalid += 1;
        continue;
      }
      bankedRows.push({ ...row, url: rowUrl });
    }
    banked = { ...banked, photos: bankedRows };
  }

  // The ranked bank rows, wearing the brief's identity verdicts (current hero
  // image, identity-critical portrait), so the hero wash prefers the picture
  // their own site leads with. Mutates `photos` front-first so flagged URLs
  // are among the fetched bytes.
  const resolverBankBlock = photoBank.bankIsFresh(banked)
    ? briefFlaggedBank(banked, brief, photos, MAX_PHOTOS)
    : {};

  // Their typeface. This lane never captured one before the brief existed —
  // captureFonts ran ONLY on the packet path — so every resolver-lane mirror
  // whose brief did not render (no brief, brief disabled, capture failed, or a
  // site that declares its faces without a verified Google stylesheet) shipped
  // in the DONOR's type. The brief's families are RENDERED ones with a verified
  // stylesheet, which is the exact bar brand.fonts documents, so the brief still
  // leads; captureFonts — reading the very same site, the way the packet path
  // already reads it — now fills behind it. Donor type stays the last resort,
  // and a GUESSED font is never any resort: captureFonts returns ok:false unless
  // it can both NAME a family and produce a Google href that serves it.
  //
  // FAIL-SOFT, exactly as on the packet path: an unreachable site costs the
  // font, never the build. UNIT TESTS NEVER OPEN A SOCKET — under the node
  // runner this only runs when a test injected its own captureFonts, the same
  // contract designBriefFor and resolveSocials honour.
  let resolverFonts = briefFonts(brief);
  if (resolverFonts.fonts) briefApplied.fonts = true;
  else if (isObject(pageHub.brand?.fonts)) resolverFonts = { fonts: pageHub.brand.fonts };
  else if (
    facts.current_website
    && (!process.env.NODE_TEST_CONTEXT || typeof deps.captureFonts === "function")
  ) {
    let captured = { ok: false };
    try { captured = (await _captureFonts(facts.current_website)) || { ok: false }; }
    catch { captured = { ok: false }; }
    // The href must be the one the schema admits (^https://fonts.googleapis.com/).
    // A family we cannot actually serve is a browser falling back to a system
    // face at best, and a 400 that kills the WHOLE build at worst — the exact
    // failure class the http-photo comment above documents.
    if (
      captured.ok
      && (captured.display || captured.body)
      && /^https:\/\/fonts\.googleapis\.com\//.test(String(captured.href || ""))
    ) {
      resolverFonts = {
        fonts: {
          ...(captured.display ? { display: String(captured.display).slice(0, 60) } : {}),
          ...(captured.body ? { body: String(captured.body).slice(0, 60) } : {}),
          href: captured.href,
          ...(captured.source ? { source: String(captured.source).slice(0, 300) } : {}),
          provider: captured.provider || "declared",
        },
      };
      // briefApplied.fonts stays FALSE on purpose: the brief did not supply
      // these, and a report that says it did would be the wrong sentence in the
      // next audit.
    }
  }

  // THE LEFT-SIDE SIGN-UP PANEL — the SAME reader the packet path above uses.
  //
  // This path had no `signup` key at all, and an absent config is silently
  // "no panel wanted" one layer down (content-inject: `signup ?
  // buildSignupFloater(signup) : ""`). Every prospect without a LeadMiner truth
  // packet — which is every seeded and every mined one — therefore shipped a
  // mirror with no Client ID, no Riley CTA and no price, and no check anywhere
  // said so. Verified on the served bytes of all four live plumbing mirrors,
  // 2026-08-06: no "wss-floater", no "Client ID", no Riley line.
  //
  // The two paths cannot drift again because neither builds the object: both
  // ask resolveSignupConfig, exactly as both now ask verifiedBrandOf for a logo.
  const signupPanel = resolveSignupConfig({
    prospect,
    facts,
    slug,
    resolveRileyLine: _resolveRiley,
  });

  // Same door as the packet path: their proven pride points ride in on content,
  // then the brief's DOM-verified trust signals (see withBriefTrust), then the
  // BrightData research layer's observed local language (see withLocalResearch).
  const contentWithPride = withBriefBadges(
    withBriefTrust(
      withPride(content, prospect),
      brief,
      { record: prospect.record || {}, applied: briefApplied },
    ),
    brief,
    { applied: briefApplied },
  );
  const contentFinal = await withLocalResearch(contentWithPride, facts, opts, deps.localResearch);

  // SANITIZE BEFORE VALIDATE — the last gate before the request exists. Every
  // photo list above (fresh bank, harvest, brief top-up) prefixed ^https://
  // only, and one URL with a space or control character anywhere inside it
  // 400'd the WHOLE request at /brand/photos/N "must match format uri" — a
  // failure no retry can fix. TDT Plumbing, Abacus, Apollo Home, Archie's,
  // Fancher and Cloverdale died build_retry_exhausted exactly that way
  // (line_mtifkuok, 2026-08-31). Drop the un-URI-able, count them, cap at the
  // schema maxItems, and let a list that ends empty take the existing
  // no-photos path: the donor's declared slots stay unfilled. Never a refusal.
  const sanitizedPhotos = sanitizePhotoUris(photos, { max: MAX_PHOTOS });
  const brandPhotosDroppedInvalid = sanitizedPhotos.droppedInvalid;
  photos = sanitizedPhotos.photos;

  const request = {
    slug,
    donor: donorPick.donor,
    facts,
    brand: {
      // Packet2's source-bound palette is fallback design evidence. Every
      // verified runtime/contract block below it wins on key collisions.
      ...pageHub.brand,
      ...(logo ? { logo } : {}),
      ...(resolverMark ? { mark: resolverMark } : {}),
      ...resolverAccentFallback,
      ...resolverSiteAccent,
      ...resolverBankBlock,
      ...heroReelBlock(prospect.record || {}),
      ...(photos.length ? { photos } : {}),
      ...resolverFonts,
      ...laneMediaMode(opts),
      ...(pageHubSourcePacket(pageHub) ? { source_packet: pageHubSourcePacket(pageHub) } : {}),
    },
    ...(Object.keys(contentFinal).length ? { content: contentFinal } : {}),
    ...(signupPanel.signup ? { signup: signupPanel.signup } : {}),
    // Same door as the packet path: their site's own measured surface.
    ...resolverSurface,
    // Same door as the packet path: their slogan or their proven tagline.
    ...(resolverTagline ? { hero: { tagline: resolverTagline } } : {}),
  };

  const res = await mirrorWithSlugConflictRetry({
    run: _mirror, engineDeps: _mirrorEngineDeps, readFleet: _readFleet, recordFleet: _recordFleet,
    claimRetry: _claimSamenessRetry,
    request, dryRun: opts.dryRun, lane: opts.lane, donor: donorPick.donor,
    prospectId: prospect.prospect_id || prospect.id || "",
    operationKey: opts.operationKey, signal: opts.signal, deadlineAt: opts.deadlineAt,
  });
  const body = res.body || {};
  const nativeReleaseEvidence = res.release_evidence || body.deployed_release_evidence || body;
  const failedSamenessProblems = body.checks?.sameness?.status === "failed"
    ? samenessProblems(res)
    : [];
  const failureDetail = failedSamenessProblems.length ? samenessFailureDetail(res) : null;
  // THE CONTENT FLOOR — the check that stops a donor template wearing a logo
  // from going out under an email that promises a website. See
  // contentFloorReport for why this one blocks and signup_panel does not.
  // Same diagnostic context as the packet path: a stored Genie compile whose
  // receipt fails re-verification here still deserves its failure reason on
  // the row, because that is the difference between "this business had
  // nothing" and "we could not prove what it had".
  const contentFloor = contentFloorReport(content, body, contentFloorDiagnostics({
    facts,
    photos: photos.length,
    needsFill,
    certifiedGenieContent,
    record: prospect.record || {},
  }), { verification });
  // THE SERVICE FLOOR — "not a page with menu items on it". See
  // serviceFloorReport; this is the path every build-ready lead takes.
  const serviceFloorCheck = serviceFloorReport(content, rawServiceLabels);
  return {
    ok: !!body.ok && failedSamenessProblems.length === 0,
    revealable: !!body.revealable && contentFloor.status === "passed" && serviceFloorCheck.status === "passed",
    preview_url: body.preview_url || "",
    // LIGHT vs FULL — same stamp as the packet path, for the same reason.
    verification,
    // See the packet path above: the engine's build identity, carried out so a
    // stored screenshot can say which build it is a picture of.
    build_hash: body.build_hash || "",
    ...(body.renderer ? { renderer: body.renderer } : {}),
    ...(body.qc_contract ? { qc_contract: body.qc_contract } : {}),
    ...(body.evidence_schema ? { evidence_schema: body.evidence_schema } : {}),
    ...(body.evidence_sha ? { evidence_sha: body.evidence_sha } : {}),
    ...(body.donor_content_hash ? { donor_content_hash: body.donor_content_hash } : {}),
    ...(body.logo_sha ? { logo_sha: body.logo_sha } : {}),
    ...(body.deploy_id ? { deploy_id: body.deploy_id } : {}),
    ...(body.deploy_url ? { deploy_url: body.deploy_url } : {}),
    ...(body.proofIdentity ? { proofIdentity: body.proofIdentity } : {}),
    ...(body.sharedReleaseEvidence ? { sharedReleaseEvidence: body.sharedReleaseEvidence } : {}),
    release_evidence: nativeReleaseEvidence,
    // Same as the packet path above: the shipped accent distilled for the
    // record writers, so record.brand_truth needs no reader of checks.brand.
    ...((() => { const t = brandTruthFromEvidence(nativeReleaseEvidence); return t ? { brand_truth: t } : {}; })()),
    slug: request.slug,
    donor: donorPick.donor,
    vertical: donorPick.vertical,
    facts,
    // THE AGGREGATE THIS BUILD ACTUALLY PUBLISHED, and where it came from, so
    // the render gate can check the page against the reading the page was made
    // from rather than against a staler copy of the same Google fact.
    published_aggregate: Number(facts.rating) > 0 && Number(facts.review_count) > 0
      ? { rating: facts.rating, review_count: facts.review_count, origin: aggregateOrigin }
      : null,
    photoCount: photos.length,
    // THE GALLERY THAT DIDN'T TRAVEL. Nonzero means photos were dropped by the
    // pre-validation URI sanitizer (whitespace, data:/relative schemes,
    // duplicates), so the shipped gallery is smaller than the harvest found.
    // Row telemetry beside photoCount; see lib/mirror-engine/photo-uri-sanitize.js.
    ...(brandPhotosDroppedInvalid ? { brand_photos_dropped_invalid: brandPhotosDroppedInvalid } : {}),
    // Same sanitizer, bank channel: ranked rows dropped before the hero wash
    // could read them. Separate number so no photograph is counted twice.
    ...(bankRowsDroppedInvalid ? { photo_bank_rows_dropped_invalid: bankRowsDroppedInvalid } : {}),
    // The over-cap about note: the canonical packet's rich about was portioned
    // to the schema cap instead of refusing the business (see mergeIntoContent).
    ...(aboutCompressed ? { about_compressed_to_cap: aboutCompressed } : {}),
    // This bank was created by the same ownership-gated harvest whose URLs
    // the successful build just used. Carry it to full-run so first builds can
    // persist it and start the remaster -> Animate Image worker. Without this
    // handoff only prospects that arrived with an older bank could ever earn a
    // client-owned hero reel.
    ...(photoBank.bankIsFresh(banked) ? { owned_photo_bank: banked } : {}),
    // A refusal nobody can see is indistinguishable from a bug. If the client's
    // own marketing city was dropped for naming their whole state, the operator
    // reads it here next to the city that was used instead.
    ...(refusedMarketCity
      ? { marketing_city_refused: { value: refusedMarketCity, reason: refusedMarketReason, used: facts.city } }
      : {}),
    contentCoverage: {
      services: (content.services || []).length,
      reviews: (content.reviews || []).length,
      faces: (content.reviews || []).filter((r) => r.avatarUrl).length,
      hours: (content.hours || []).length,
      faqs: (content.faqs || []).length,
      nearby: (content.nearby || []).length,
      // Owned profiles are content coverage like everything else on this list:
      // measured and reported, never required.
      socials: (facts.socials || []).length,
    },
    // Where the profiles came from, and what was declined. An operator looking
    // at a mirror with no social bar must be able to tell "we looked and found
    // nothing" apart from "we never looked".
    social_discovery: {
      source: socialOut.source,
      attached: (facts.socials || []).map((s) => `${s.network}:${s.provenance || "unknown"}`),
      refused: (socialOut.refused || []).length,
      ...(socialOut.detail ? { detail: socialOut.detail } : {}),
    },
    status: res.status,
    ...(body.retryable === true || res.retryable === true ? { retryable: true } : {}),
    ...(body.provider_attempted === true || res.provider_attempted === true ? { provider_attempted: true } : {}),
    ...(body.manual_reconciliation_required === true || res.manual_reconciliation_required === true
      ? { manual_reconciliation_required: true }
      : {}),
    ...(body.disposition === "system_hold" || res.disposition === "system_hold"
      ? { disposition: "system_hold", lead_rejection: false }
      : {}),
    ...((body.system_hold || res.system_hold) ? { system_hold: body.system_hold || res.system_hold } : {}),
    ...((body.reconciliation || res.reconciliation)
      ? { reconciliation: body.reconciliation || res.reconciliation }
      : {}),
    // The lane's own named check travels WITH the engine's, so full-run's
    // existing refusal report ("the named gates that did not pass") prints
    // `content_floor=failed` without a line of change anywhere else.
    checks: { ...(body.checks || {}), content_floor: contentFloor, service_floor: serviceFloorCheck, design_brief: designBriefReport(briefOut, briefApplied, body) },
    content_floor: contentFloor,
    service_floor: serviceFloorCheck,
    // What the designer saw on their site and what this build APPLIED of it —
    // the slogan, the surface, the accent decision (site chrome vs logo), the
    // typeface, the trust chips. "disabled"/"no_website"/"capture_failed" are
    // honest outcomes.
    design_brief: designBriefReport(briefOut, briefApplied, body),
    signup_panel: signupPanelReport(signupPanel, body),
    // THE RESOLVER'S OWN LINE IN THE BUILD REPORT. A build that ships without
    // reviews must be able to say WHICH observer failed and why, in words,
    // without anyone re-running it by hand. See factResolutionReport.
    fact_resolution: factResolution,
    // WHY THIS MIRROR HAS NO STREET ADDRESS, in words, on the build row. A
    // silently absent address looks like a bug to the next operator who reads
    // this and would get "fixed" straight back into the defect.
    ...(addressVerdict.withhold ? { address_withheld: addressVerdict.reason } : {}),
    trust_lookup: trustLookup,
    error: body.error || null,
    // Same as the packet path above: the engine's own field-level cause rides
    // out instead of being flattened into a bare error code.
    detail: failureDetail || (Array.isArray(body.detail) && body.detail.length ? body.detail : null),
    // WHICHEVER GATE EXPLAINS THE OTHER GOES FIRST.
    //
    // When labels were harvested and refused, the service floor is the CAUSE and
    // the content floor is the symptom: "four labels were harvested and all four
    // were menu items" explains "no verified content", and the reverse does not.
    // An operator reading `content_floor:no_verified_content` about a business
    // whose website listed four things would go looking for a scrape failure
    // that never happened.
    reason: failedSamenessProblems.length
      ? "not_revealable"
      : body.ok ? floorReason(contentFloor, serviceFloorCheck) : (body.error || "build_failed"),
  };
}

function floorReason(contentFloor, serviceFloorCheck) {
  const serviceFailed = serviceFloorCheck.status !== "passed";
  const dropped = serviceFloorCheck.supplied > serviceFloorCheck.publishable;
  if (serviceFailed && dropped) return `service_floor:${serviceFloorCheck.verdict}`;
  if (contentFloor.status !== "passed") return `content_floor:${contentFloor.verdict}`;
  if (serviceFailed) return `service_floor:${serviceFloorCheck.verdict}`;
  return null;
}

module.exports = {
  buildMirrorForProspect,
  certifiedGenieContentFromRecord,
  // exported for tests: the admission marker a certified content envelope must
  // carry before leadMinerMirrorInput reads its canonical_packet
  CERTIFIED_GENIE_CONTENT_MARKER,
  certifiedUmbrellaService,
  certifiedServiceObservation,
  positiveCategoryPhrase,
  contentFloorReport,
  contentFloorDiagnostics,
  contentFloorDiagnostic,
  fleetRecordSystemHold,
  effectiveBuildIndustry,
  serviceFloorReport,
  // the designer's brief wiring, exported for tests
  designBriefFor,
  briefSlogan,
  briefClientSurface,
  briefAccentFallback,
  briefSiteAccent,
  briefFlaggedBank,
  briefMeasuredPhotoUrls,
  briefFonts,
  withBriefTrust,
  withBriefBadges,
  prideBlockFor,
  PRIDE_LIST_CAPS,
  heroReelBlock,
  briefBadgeImages,
  withLocalResearch,
  factualKeywords,
  designBriefReport,
  contentFromVerified,
  contentFromContract,
  factResolutionReport,
  featuredReviews,
  withheldAddress,
  httpsAssetUrl,
  isLeadMinerPacket,
  leadMinerMirrorInput,
  rescueNeedsFill,
  mergeContentSources,
  restoreReviewFaces,
  serviceName,
  slugFor,
  samenessProblems,
  samenessFailureDetail,
  collisionOnlySamenessFailure,
  mirrorWithSamenessRetry,
  // lane-B observability: mirror_release_unconfirmed cause composition
  mirrorReleaseUnconfirmedCause,
  mirrorWithSlugConflictRetry,
  isSlugConflictResult,
  dedupedSlugFor,
  SUBSTANCE_CHANNELS,
};
