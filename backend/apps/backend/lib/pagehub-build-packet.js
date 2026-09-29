"use strict";

const { createHash } = require("node:crypto");

const SIDECAR_VERSION = "pagehub-build-packet-sidecar-v1";
const HASH_ALGORITHM = "sha256-canonical-json-v1";
const MAX_CANONICAL_DEPTH = 128;

function text(value) {
  return String(value == null ? "" : value).trim();
}

// JSON.stringify is insertion-order dependent. Packet retries can arrive with
// the same data in a different key order, so the immutable identity is made
// from a complete, key-sorted JSON representation instead.
function canonicalJson(value, depth = 0) {
  if (depth > MAX_CANONICAL_DEPTH) {
    const error = new Error("pagehub_packet_too_deep");
    error.code = "pagehub_packet_too_deep";
    throw error;
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      const error = new Error("pagehub_packet_not_json");
      error.code = "pagehub_packet_not_json";
      throw error;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => {
      if (typeof value[key] === "undefined" || typeof value[key] === "function" || typeof value[key] === "symbol") {
        const error = new Error("pagehub_packet_not_json");
        error.code = "pagehub_packet_not_json";
        throw error;
      }
      return `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`;
    }).join(",")}}`;
  }
  const error = new Error("pagehub_packet_not_json");
  error.code = "pagehub_packet_not_json";
  throw error;
}

function packetSha256(packet) {
  return createHash("sha256").update(canonicalJson(packet), "utf8").digest("hex");
}

function jsonClone(packet) {
  return JSON.parse(canonicalJson(packet));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function values(value) {
  if (Array.isArray(value)) return value;
  return value == null || value === "" ? [] : [value];
}

function normalizeKind(value, fallback = "photo") {
  const kind = text(value).toLowerCase();
  if (/logo|wordmark|brand[_ -]?mark|emblem/.test(kind)) return "logo";
  if (/video|clip|reel|motion/.test(kind)) return "video";
  if (/photo|image|hero|gallery/.test(kind)) return "photo";
  return fallback;
}

function candidateUrl(value) {
  if (typeof value === "string") return text(value);
  const row = object(value);
  return text(row.url || row.src || row.link || row.sourceUrl || row.source_url);
}

function defaultObservedOn(packet) {
  return text(
    packet?.facts?.website
    || packet?.packet2?.business?.domainUrl
    || packet?.business?.domainUrl
    || packet?.sources?.urls?.[0]
    || packet?.packet2?.sources?.urls?.[0],
  );
}

function observedAssetCandidates(packet) {
  const root = object(packet);
  const packet2 = object(root.packet2);
  const sourceGroups = [];
  const push = (entries, fallbackKind, sourcePath) => {
    for (const entry of values(entries)) sourceGroups.push({ entry, fallbackKind, sourcePath });
  };

  push(root.assets, "photo", "assets");
  push(root.sources?.logos, "logo", "sources.logos");
  push(root.sources?.images, "photo", "sources.images");
  push(packet2.sources?.logos, "logo", "packet2.sources.logos");
  push(packet2.sources?.images, "photo", "packet2.sources.images");
  push(root.brand?.logoLink, "logo", "brand.logoLink");
  push(root.brand?.logoCandidates, "logo", "brand.logoCandidates");
  push(root.brand?.photoCandidates, "photo", "brand.photoCandidates");
  push(packet2.brand?.logoLink, "logo", "packet2.brand.logoLink");
  push(packet2.brand?.logoCandidates, "logo", "packet2.brand.logoCandidates");
  push(packet2.assetQa?.logoCandidates, "logo", "packet2.assetQa.logoCandidates");
  push(packet2.assetQa?.imageCandidates, "photo", "packet2.assetQa.imageCandidates");
  push(packet2.compiled?.assetsManifest?.logoCandidates, "logo", "packet2.compiled.assetsManifest.logoCandidates");
  push(packet2.compiled?.assetsManifest?.imageCandidates, "photo", "packet2.compiled.assetsManifest.imageCandidates");

  const fallbackObservedOn = defaultObservedOn(root);
  const seen = new Set();
  return sourceGroups.flatMap(({ entry, fallbackKind, sourcePath }) => {
    const row = object(entry);
    const url = candidateUrl(entry);
    if (!/^https?:\/\//i.test(url)) return [];
    const kind = normalizeKind(row.kind || row.type || row.asset_type, fallbackKind);
    const key = `${kind}|${url}`.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      kind,
      url,
      observed_on: text(row.observed_on || row.found_on || row.source_page || row.sourcePage) || fallbackObservedOn,
      packet_path: sourcePath,
      source: "pagehub_packet_observation",
      verification_status: "unverified_observed_candidate",
      ownership_verified: false,
      approved: false,
    }];
  });
}

function makeSidecar(packet, receivedAt) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet) || Object.keys(packet).length === 0) {
    const error = new Error("pagehub_packet_required");
    error.code = "pagehub_packet_required";
    throw error;
  }
  const snapshot = jsonClone(packet);
  const snapshotSha256 = packetSha256(snapshot);
  return {
    contract_version: SIDECAR_VERSION,
    packet_id: `pagehub:${snapshotSha256.slice(0, 24)}`,
    snapshot_sha256: snapshotSha256,
    hash_algorithm: HASH_ALGORITHM,
    received_at: new Date(receivedAt).toISOString(),
    snapshot,
    asset_candidates: observedAssetCandidates(snapshot),
  };
}

function stagePageHubBuildPacket(record, packet, receivedAt = new Date()) {
  const currentRecord = object(record);
  const nextSidecar = makeSidecar(packet, receivedAt);
  const existing = object(currentRecord.pagehub_build_packet);
  const existingSha = text(existing.snapshot_sha256).toLowerCase();
  if (existingSha) {
    let actualExistingSha = "";
    try { actualExistingSha = packetSha256(existing.snapshot); } catch { /* handled below */ }
    if (actualExistingSha !== existingSha) {
      return {
        status: "conflict",
        error: "pagehub_build_packet_invalid_existing_sidecar",
        record: currentRecord,
        sidecar: existing,
        incoming_sha256: nextSidecar.snapshot_sha256,
      };
    }
    if (existingSha === nextSidecar.snapshot_sha256) {
      return { status: "noop", record: currentRecord, sidecar: existing };
    }
    nextSidecar.supersedes = {
      packet_id: text(existing.packet_id) || `pagehub:${existingSha.slice(0, 24)}`,
      snapshot_sha256: existingSha,
      received_at: text(existing.received_at) || null,
    };
    return {
      status: "staged",
      refreshed: true,
      record: { ...currentRecord, pagehub_build_packet: nextSidecar },
      sidecar: nextSidecar,
    };
  }
  if (Object.keys(existing).length) {
    return {
      status: "conflict",
      error: "pagehub_build_packet_invalid_existing_sidecar",
      record: currentRecord,
      sidecar: existing,
      incoming_sha256: nextSidecar.snapshot_sha256,
    };
  }
  return {
    status: "staged",
    record: { ...currentRecord, pagehub_build_packet: nextSidecar },
    sidecar: nextSidecar,
  };
}

function readPageHubBuildPacket(record) {
  const sidecar = object(object(record).pagehub_build_packet);
  if (!Object.keys(sidecar).length) return { ok: false, reason: "pagehub_build_packet_absent" };
  if (text(sidecar.contract_version) !== SIDECAR_VERSION
    || text(sidecar.hash_algorithm) !== HASH_ALGORITHM
    || !/^[0-9a-f]{64}$/i.test(text(sidecar.snapshot_sha256))) {
    return { ok: false, reason: "pagehub_build_packet_invalid_sidecar" };
  }
  let actual = "";
  try { actual = packetSha256(sidecar.snapshot); } catch { /* reported below */ }
  if (!actual || actual !== text(sidecar.snapshot_sha256).toLowerCase()) {
    return { ok: false, reason: "pagehub_build_packet_hash_mismatch" };
  }
  return { ok: true, sidecar, snapshot: sidecar.snapshot };
}

function safeUrl(value) {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return "";
  try { return new URL(raw).href; } catch { return ""; }
}

// Packet2 evidence is already expected to name the prospect's own host. Keep
// this boundary deliberately stricter than an eTLD+1 guess: exact hosts and
// parent/child subdomains pass; sibling businesses under an unfamiliar public
// suffix can never collapse to the suffix itself.
function sameSiteHost(left, right) {
  const host = (value) => {
    try { return new URL(safeUrl(value)).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
    catch { return ""; }
  };
  const a = host(left);
  const b = host(right);
  return Boolean(a && b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

function firstPartyPage(website, ...valuesToCheck) {
  const site = safeUrl(website);
  if (!site) return "";
  for (const value of valuesToCheck.flat(Infinity)) {
    const candidate = safeUrl(value);
    if (candidate && sameSiteHost(site, candidate)) return candidate;
  }
  return "";
}

function explicitSourcesBelongTo(website, ...sourceValues) {
  const site = safeUrl(website);
  if (!site) return false;
  const urls = sourceValues.flat(Infinity).flatMap((value) => {
    if (isObject(value)) {
      return values(value.url || value.href || value.source_url || value.observed_on || value.found_on)
        .map(safeUrl).filter(Boolean);
    }
    const url = safeUrl(value);
    return url ? [url] : [];
  });
  return urls.length > 0 && urls.every((url) => sameSiteHost(site, url));
}

function safeFontFamily(value) {
  const family = text(value).split(",")[0].trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2").trim();
  if (!family || family.length > 60 || /[\\"';{}<>\r\n]/.test(family)) return "";
  return family;
}

function hex6(value) {
  const raw = text(value);
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : "";
}

function isChromatic(hex) {
  const clean = hex6(hex);
  if (!clean) return false;
  const channels = [1, 3, 5].map((at) => Number.parseInt(clean.slice(at, at + 2), 16) / 255);
  const high = Math.max(...channels);
  const low = Math.min(...channels);
  if (high === low) return false;
  const lightness = (high + low) / 2;
  const saturation = (high - low) / (1 - Math.abs((2 * lightness) - 1));
  return Number.isFinite(saturation) && saturation >= 0.18;
}

function socialNetwork(value) {
  let host = "";
  try { host = new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
  const names = ["facebook", "instagram", "youtube", "linkedin", "tiktok", "twitter", "yelp", "bbb", "angi", "nextdoor", "houzz"];
  if (host === "x.com" || host.endsWith(".x.com")) return "twitter";
  return names.find((name) => host === `${name}.com` || host.endsWith(`.${name}.com`)) || "";
}

function evidenceSource(row, website) {
  const source = isObject(row.source) ? row.source.url || row.source.href : row.source;
  return firstPartyPage(website, source, row.source_url, row.observed_on, row.source_observations);
}

function evidenceBackedServices(snapshot, website) {
  const root = object(snapshot);
  const packet2 = object(root.packet2);
  const evidence = [root.evidence, root.service_evidence, packet2.evidence, packet2.service_evidence]
    .filter(Array.isArray).flat().filter(isObject);
  const proved = new Set();
  for (const row of evidence) {
    const field = text(row.field || row.type).toLowerCase();
    if (!/(^|[_ .-])services?($|[_ .-])/.test(field) || !evidenceSource(row, website)) continue;
    const confidence = Number(row.confidence);
    const observed = ["source_observation", "verified"].includes(text(row.verification_status || row.status).toLowerCase())
      || row.verified === true
      || (Number.isFinite(confidence) && confidence >= 0.8);
    if (!observed || row.generated === true) continue;
    for (const value of values(row.value)) {
      const label = text(isObject(value) ? value.name || value.title || value.label : value);
      if (label) proved.add(label.toLowerCase());
    }
  }

  const facts = object(root.facts);
  const content = object(root.content);
  const business = object(packet2.business);
  const compiled = object(packet2.compiled);
  const offered = [facts.services, content.services, business.exactServices, business.mainServices, compiled.services]
    .flatMap(values);
  const out = [];
  const seen = new Set();
  for (const value of offered) {
    const name = text(isObject(value) ? value.name || value.title || value.label : value);
    const key = name.toLowerCase();
    if (!name || !proved.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ name });
    if (out.length >= 12) break;
  }
  return out;
}

function evidenceBackedSocials(snapshot, website) {
  const root = object(snapshot);
  const packet2 = object(root.packet2);
  const evidence = [root.evidence, packet2.evidence].filter(Array.isArray).flat().filter(isObject);
  const candidates = [root.facts?.socials, root.sources?.social, packet2.sources?.social]
    .flatMap(values)
    .map((value) => safeUrl(isObject(value) ? value.url || value.href : value))
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const url of candidates) {
    const network = socialNetwork(url);
    if (!network || seen.has(url)) continue;
    const proof = evidence.find((row) => {
      if (!/(^|[_ .-])socials?($|[_ .-])/.test(text(row.field || row.type).toLowerCase())) return false;
      const rowValues = values(row.value).map(safeUrl);
      return rowValues.includes(url) && Boolean(evidenceSource(row, website));
    });
    if (!proof || proof.generated === true) continue;
    seen.add(url);
    out.push({ network, url, provenance: "own_site_link" });
    if (out.length >= 12) break;
  }
  return out;
}

function observedBrand(snapshot, website) {
  const root = object(snapshot);
  const packet2 = object(root.packet2);
  const rootBrand = object(root.brand);
  const packetBrand = object(packet2.brand);
  const sourcePage = firstPartyPage(
    website,
    root.sources?.urls,
    packet2.sources?.urls,
    root.facts?.website,
    packet2.business?.domainUrl,
  );
  if (!/^https:\/\//i.test(sourcePage)) return {};

  const envelopeBound = explicitSourcesBelongTo(
    website,
    rootBrand.source,
    rootBrand.source_url,
    rootBrand.observed_on,
    packetBrand.source,
    packetBrand.source_url,
    packetBrand.observed_on,
  );
  if (!envelopeBound) return {};

  const fontInput = { ...object(packetBrand.fonts), ...object(rootBrand.fonts) };
  const display = safeFontFamily(fontInput.display || fontInput.heading || fontInput.headingFont);
  const body = safeFontFamily(fontInput.body || fontInput.bodyFont);
  const href = /^https:\/\/fonts\.googleapis\.com\//i.test(text(fontInput.href)) ? text(fontInput.href) : "";
  const brand = {};
  const fontsBound = explicitSourcesBelongTo(
    website,
    fontInput.source,
    fontInput.source_url,
    fontInput.observed_on,
    fontInput.found_on,
  );
  if ((display || body) && href && fontsBound) {
    brand.fonts = {
      ...(display ? { display } : {}),
      ...(body ? { body } : {}),
      href,
      source: sourcePage,
      provider: "google",
    };
  }

  const paletteInput = [rootBrand.palette, rootBrand.brandPalette, packetBrand.palette, packetBrand.brandPalette, packet2.sources?.palette]
    .find(Array.isArray) || [];
  const colors = [];
  const seen = new Set();
  for (const value of [...paletteInput, ...values(rootBrand.colors), ...values(packetBrand.colors)]) {
    const row = isObject(value) ? value : { hex: value };
    if (!explicitSourcesBelongTo(website, row.source, row.source_url, row.observed_on, row.found_on)) continue;
    const hex = hex6(row.hex || row.color || row.value || value);
    if (!hex || seen.has(hex) || !isChromatic(hex)) continue;
    seen.add(hex);
    colors.push({ hex, role: text(row.role).slice(0, 40) });
  }
  const byRole = (pattern) => colors.find((row) => pattern.test(row.role));
  const accent = byRole(/accent|action|cta|button/i) || byRole(/primary|brand/i) || colors[0];
  const primary = byRole(/primary|surface|brand|secondary/i)
    || colors.find((row) => !accent || row.hex !== accent.hex)
    || accent;
  if (primary) brand.primary = primary.hex;
  if (accent) {
    brand.site_accent = accent.hex;
    brand.site_accent_source = sourcePage;
  }
  return brand;
}

/**
 * Read-only enrichment adapter for the build lane. It never returns Packet2
 * NAP, ratings, review counts, or descriptive prose. Every returned design
 * observation is bound to the already-verified LeadMiner website; every media
 * URL remains an unapproved candidate for the existing byte/ownership gate.
 */
function pageHubBuildSupplement(record, { website = "" } = {}) {
  const stored = readPageHubBuildPacket(record);
  if (!stored.ok) return { ok: false, reason: stored.reason, asset_candidates: [], services: [], socials: [], brand: {} };
  const site = safeUrl(website);
  if (!site) return { ok: false, reason: "verified_website_required", asset_candidates: [], services: [], socials: [], brand: {} };
  const assetCandidates = observedAssetCandidates(stored.snapshot).filter((asset) => (
    sameSiteHost(site, asset.url)
    || (safeUrl(asset.observed_on) && sameSiteHost(site, asset.observed_on))
  ));
  return {
    ok: true,
    packet_id: stored.sidecar.packet_id,
    snapshot_sha256: stored.sidecar.snapshot_sha256,
    asset_candidates: assetCandidates,
    logo_candidate: assetCandidates.find((asset) => asset.kind === "logo" && /^https:\/\//i.test(asset.url)) || null,
    services: evidenceBackedServices(stored.snapshot, site),
    socials: evidenceBackedSocials(stored.snapshot, site),
    brand: observedBrand(stored.snapshot, site),
  };
}

module.exports = {
  HASH_ALGORITHM,
  SIDECAR_VERSION,
  canonicalJson,
  makeSidecar,
  observedAssetCandidates,
  observedBrand,
  pageHubBuildSupplement,
  packetSha256,
  readPageHubBuildPacket,
  stagePageHubBuildPacket,
};
