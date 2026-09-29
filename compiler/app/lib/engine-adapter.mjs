// SiteForge SaaS — engine adapter. Bridges the SaaS app to the v5 forge
// pipeline (factory/pipeline/*) WITHOUT modifying shared engine files.
// Responsibilities: packet forging (via scripts/forge.mjs), staged generation
// with live SSE events, versioned output dirs, QC parsing (with an honest
// degraded mode when headless Chromium is unavailable), template try-ons.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { insert, update, get, find, siteDirFor, SITES_DIR, TRY_DIR, PUBLISHED_DIR, audit } from "./store.mjs";
import { id, token, nowIso, kebab, privatePreviewKey, readJsonFile, writeJsonFile, ensureDir } from "./util.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(APP_ROOT, "..");
export const PUBLIC_SURFACE_QC_CONTRACT = "public-surface-v2";

// Engine modules (in-process for SSE fidelity; read-only usage)
import { onEmit } from "../../factory/lib/emit.mjs";
import { discover } from "../../factory/pipeline/01-discover.mjs";
import {
  cleanupMirroredMedia,
  downloadVerifiedMirroredPhoto,
  fetchRemotePhoto,
  fetchRemoteVideo,
  scrape,
  verifyMirroredPhotoFile,
  verifyMirroredVideoFile,
} from "../../factory/pipeline/02-scrape.mjs";
import {
  hasUsablePhotoDimensions,
  perceptualHashesCollide,
} from "../../factory/lib/media-intelligence.mjs";
import { rescue } from "../../factory/pipeline/03-rescue.mjs";
import { design } from "../../factory/pipeline/04-design.mjs";
import { mergeV7Assets } from "./media-engine.mjs";
import { enforceBusinessTruth } from "./business-truth.mjs";
import { isTrustedLogoAsset, sanitizeSourceAssets } from "./source-intake.mjs";
import { runV7Checks } from "../../qc-audit/qc-v7-ext.mjs";
import { runVisualFidelityChecks } from "../../qc-audit/qc-visual-fidelity.mjs";
import { checkHeroLayers, runQualityAudit } from "../../qc-audit/qc.mjs";
import { mergeEnrichment } from "../../asset-pipeline/firecrawl-gbp-merge.mjs";
import { buildVeoPrompt } from "../../asset-pipeline/veo-prompt.mjs";
import { wireLeadCapture } from "./lead-capture.mjs";
import { schemaTypesFromGraph } from "../../factory/authority/schema-engine.mjs";
import { runBuild } from "../../factory/lib/build-runtime.mjs";
import { validateBuildComplete } from "../../factory/lib/build-response-validator.mjs";
import { createPremierProvider, runSiteforgePremierBuild, captureScreenshotsForViewport, finalizeScreenshotManifest } from "../../factory/lib/siteforge-premier-provider.mjs";
import { createBuildArtifactPublisher } from "./build-artifact-publisher.mjs";
import { createVerticalHistoryStore } from "./vertical-history-store.mjs";

export const HERO_FAMILIES = [
  { key: "cinematic-video-parallax", name: "Cinematic Parallax", blurb: "Full-bleed motion hero with an oversized editorial headline. Built for trades with dramatic before/after footage." },
  { key: "split-editorial-index", name: "Editorial Split", blurb: "Magazine two-column: photo essay left, indexed copy right. Reads like a feature piece about your business." },
  { key: "service-map-pins", name: "Service Atlas", blurb: "An interactive service-area map is the hero. Every pin is a neighborhood you own." },
  { key: "material-lab-swatch", name: "Material Lab", blurb: "Zoomable material and finish swatches up front. For businesses whose craft is tactile." },
  { key: "magazine-owner-letter", name: "Owner's Letter", blurb: "A signed letter from the owner as the opening move. Human, direct, disarming." },
  { key: "atlas-grid-reveal", name: "Atlas Grid", blurb: "A 12-cell grid of your real work that reveals on hover. Portfolio-forward." },
];
export const SECTION_TOGGLES = [
  { key: "before-after-slider", label: "Before / after proof" },
  { key: "service-map", label: "Service-area map" },
  { key: "material-swatch-lab", label: "Materials lab" },
  { key: "homeowner-configurator", label: "Quote configurator" },
  { key: "team-portrait", label: "Team / owner portrait" },
  { key: "journal-excerpt", label: "Journal excerpt" },
  { key: "process-timeline", label: "Process timeline" },
  { key: "project-storytelling", label: "Project stories" },
];
export const GOALS = ["calls", "quotes", "bookings", "ecommerce", "portfolio"];

const RELEASE_EVIDENCE_SCHEMA = "siteforge-release-evidence-v1";
const RELEASE_EVIDENCE_CHECKS = Object.freeze({
  map: "release-map-evidence",
  identity: "release-business-identity-match",
  family: "release-template-family-match",
});

function releaseIdentityKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") || "";
}

function releaseWebsiteHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function jsonLdBusinessIdentities(html = "") {
  const identities = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => String(type || "") === "LocalBusiness") && String(value.name || "").trim()) {
      const area = Array.isArray(value.areaServed) ? value.areaServed[0] : value.areaServed;
      const areaParts = String(area?.name || area || "").split(",").map((part) => part.trim()).filter(Boolean);
      const sameAs = (Array.isArray(value.sameAs) ? value.sameAs : [value.sameAs])
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      identities.push({
        business_name: String(value.name).trim(),
        city: String(value.address?.addressLocality || areaParts[0] || "").trim(),
        state: String(value.address?.addressRegion || areaParts[1] || "").trim(),
        source_website: sameAs[0] || "",
      });
    }
    Object.values(value).forEach(visit);
  };
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch {}
  }
  return identities;
}

function jsonLdBusinessNames(html = "") {
  return [...new Set(jsonLdBusinessIdentities(html).map((identity) => identity.business_name))];
}

function validReleasePng(file) {
  try {
    const bytes = readFileSync(file);
    return bytes.length > 64 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  } catch {
    return false;
  }
}

function releaseCheck(name, pass, detail, evidence, advisoryFailed = false) {
  return { name, pass: Boolean(pass), detail, evidence, ...(advisoryFailed ? { advisory_failed: true } : {}) };
}

// Release proof is derived only from rendered artifacts and the immutable
// request expectation. Identity evidence stays fail-closed: a missing or
// contradictory business identity is a hard QC failure. Map and template-
// family evidence are ADVISORY under the minimum-QC policy (owner directive,
// 2026-07-21): when they cannot be verified, the check is emitted as a waived
// advisory pass whose evidence envelope keeps the REAL unverified capture
// data plus waived: true — evidence is never fabricated to satisfy a gate.
export function buildReleaseEvidenceChecks(siteDir, expectation = {}, visualResults = []) {
  const html = existsSync(path.join(siteDir, "index.html"))
    ? readFileSync(path.join(siteDir, "index.html"), "utf8")
    : "";
  const publicPacket = readJsonFile(path.join(siteDir, "packet.json"), {});
  const manifest = readJsonFile(path.join(siteDir, "screenshots", "manifest.json"), null);
  const mapRuntime = readJsonFile(path.join(siteDir, "screenshots", "map-evidence.json"), null);
  const mapPath = path.join(siteDir, "screenshots", "desktop", "map.png");
  const mapBytes = validReleasePng(mapPath) ? readFileSync(mapPath) : null;
  const supportNames = ["visual-satellite-map-evidence", "visual-address-map-directions"];
  const supportingChecks = supportNames.map((name) => {
    const result = visualResults.find((item) => item.name === name);
    return result ? { name, pass: result.pass === true, detail: result.detail || "" } : { name, pass: false, detail: "QC check missing" };
  });
  const manifestMap = manifest?.map_evidence || null;
  const mapEvidence = {
    artifact: "screenshots/desktop/map.png",
    evidence_artifact: "screenshots/map-evidence.json",
    manifest_artifact: "screenshots/manifest.json",
    screenshot: mapBytes ? {
      size: mapBytes.length,
      sha256: createHash("sha256").update(mapBytes).digest("hex"),
    } : null,
    runtime: mapRuntime ? {
      provider: mapRuntime.provider || null,
      response_ok: mapRuntime.response_ok === true,
      capture_origin: mapRuntime.capture_origin || null,
      geometry_ok: mapRuntime.geometry_ok === true,
      pixels_ok: mapRuntime.pixels_ok === true,
      unique_colors: Number(mapRuntime.unique_colors || 0),
      variance: Number(mapRuntime.variance || 0),
      detail: mapRuntime.detail || "",
    } : null,
    manifest: manifest ? {
      schema: manifest.schema || null,
      index_sha256: manifest.index_sha256 || null,
      map_pass: manifestMap?.pass === true,
    } : null,
    supporting_checks: supportingChecks,
  };
  const mapPass = Boolean(
    mapBytes &&
    manifest?.schema === "siteforge-screenshot-manifest-v1" &&
    manifestMap?.pass === true &&
    manifestMap?.artifact === "screenshots/desktop/map.png" &&
    manifestMap?.response_ok === true &&
    manifestMap?.geometry_ok === true &&
    manifestMap?.pixels_ok === true &&
    mapRuntime?.pass === true &&
    mapRuntime?.artifact === "screenshots/desktop/map.png" &&
    mapRuntime?.response_ok === true &&
    mapRuntime?.geometry_ok === true &&
    mapRuntime?.pixels_ok === true &&
    Number(mapRuntime?.unique_colors || 0) >= 16 &&
    Number(mapRuntime?.variance || 0) >= 80 &&
    supportingChecks.every((check) => check.pass && !/not required/i.test(check.detail))
  );
  if (!mapPass) mapEvidence.waived = true;

  const expectedName = String(expectation.business_name || "").trim();
  const expectedCity = String(expectation.city || "").trim();
  const expectedState = String(expectation.state || "").trim();
  const expectedSourceWebsite = String(expectation.source_website || "").trim();
  const publicPacketName = String(publicPacket?.business?.name || "").trim();
  const publicPacketCity = String(publicPacket?.business?.city || "").trim();
  const publicPacketState = String(publicPacket?.business?.state || "").trim();
  const publicPacketSourceWebsite = String(publicPacket?.business?.current_website || "").trim();
  const schemaIdentities = jsonLdBusinessIdentities(html);
  const schemaNames = jsonLdBusinessNames(html);
  const actualName = schemaNames.length === 1 ? schemaNames[0] : "";
  const renderedIdentity = schemaIdentities.find((identity) =>
    releaseIdentityKey(identity.business_name) === releaseIdentityKey(actualName)) || {};
  const actualCity = String(renderedIdentity.city || "").trim();
  const actualState = String(renderedIdentity.state || "").trim();
  const actualSourceWebsite = String(renderedIdentity.source_website || "").trim();
  const expectedNameKey = releaseIdentityKey(expectedName);
  const publicPacketNameKey = releaseIdentityKey(publicPacketName);
  const actualNameKey = releaseIdentityKey(actualName);
  const exactFieldMatches = (expected, rendered, packetValue) => {
    const expectedKey = releaseIdentityKey(expected);
    return !expectedKey || (
      expectedKey === releaseIdentityKey(rendered) &&
      expectedKey === releaseIdentityKey(packetValue)
    );
  };
  const exactWebsiteMatches = (expected, rendered, packetValue) => {
    const expectedHost = releaseWebsiteHost(expected);
    return expectedHost === "" || Boolean(
      expectedHost &&
      expectedHost === releaseWebsiteHost(rendered) &&
      expectedHost === releaseWebsiteHost(packetValue)
    );
  };
  const identityPass = Boolean(
    expectedNameKey &&
    publicPacketNameKey &&
    actualNameKey &&
    schemaNames.length === 1 &&
    expectedNameKey === publicPacketNameKey &&
    expectedNameKey === actualNameKey &&
    exactFieldMatches(expectedCity, actualCity, publicPacketCity) &&
    exactFieldMatches(expectedState, actualState, publicPacketState) &&
    exactWebsiteMatches(expectedSourceWebsite, actualSourceWebsite, publicPacketSourceWebsite)
  );
  const identityEvidence = {
    expected: {
      business_name: expectedName || null,
      city: expectedCity || null,
      state: expectedState || null,
      source_website: expectedSourceWebsite || null,
      source: "stage_payload.release_expectation",
    },
    actual: {
      business_name: actualName || null,
      public_packet_business_name: publicPacketName || null,
      city: actualCity || null,
      public_packet_city: publicPacketCity || null,
      state: actualState || null,
      public_packet_state: publicPacketState || null,
      source_website: actualSourceWebsite || null,
      public_packet_source_website: publicPacketSourceWebsite || null,
      sources: [
        "rendered:index.html#json-ld:LocalBusiness",
        "rendered:packet.json#business",
      ],
      local_business_nodes: schemaNames.length,
    },
  };

  const expectedFamily = String(expectation.template_family || "").trim();
  const actualFamily = String(publicPacket?.hero_family || "").trim();
  const validFamilies = new Set(HERO_FAMILIES.map((item) => item.key));
  const autoSelectedFamily = expectedFamily === "auto";
  const knownActualFamily = validFamilies.has(actualFamily);
  const familyPass = Boolean(
    expectedFamily &&
    actualFamily &&
    knownActualFamily &&
    (
      autoSelectedFamily ||
      (validFamilies.has(expectedFamily) && expectedFamily === actualFamily)
    )
  );
  const familyEvidence = {
    expected: {
      family: expectedFamily || null,
      selection: autoSelectedFamily ? "auto" : "pinned",
      source: "stage_payload.release_expectation.template_family",
    },
    actual: {
      family: actualFamily || null,
      known_family: knownActualFamily,
      source: "rendered:packet.json#hero_family",
    },
  };
  if (!familyPass) familyEvidence.waived = true;

  return [
    releaseCheck(
      RELEASE_EVIDENCE_CHECKS.map,
      true,
      mapPass
        ? `verified map screenshot ${mapEvidence.screenshot.sha256}`
        : "advisory: map evidence unverified (waived) — map screenshot, runtime proof, manifest, or supporting map QC is missing or contradictory",
      mapEvidence,
      !mapPass,
    ),
    releaseCheck(
      RELEASE_EVIDENCE_CHECKS.identity,
      identityPass,
      identityPass
        ? `rendered business identity matched ${actualName}`
        : `expected=${expectedName || "missing"} (${expectedCity || "city unknown"}, ${expectedState || "state unknown"}, ${expectedSourceWebsite || "website unknown"}); packet=${publicPacketName || "missing"} (${publicPacketCity || "city missing"}, ${publicPacketState || "state missing"}, ${publicPacketSourceWebsite || "website missing"}); json_ld=${actualName || "missing"} (${actualCity || "city missing"}, ${actualState || "state missing"}, ${actualSourceWebsite || "website missing"})`,
      identityEvidence,
    ),
    releaseCheck(
      RELEASE_EVIDENCE_CHECKS.family,
      true,
      familyPass
        ? autoSelectedFamily
          ? `rendered valid auto-selected template family ${actualFamily}`
          : `rendered template family matched ${actualFamily}`
        : `advisory: template family unverified (waived); expected=${expectedFamily || "missing"}; rendered=${actualFamily || "missing"}`,
      familyEvidence,
      !familyPass,
    ),
  ];
}

export function releaseEvidenceFromQc(qc) {
  const checks = Object.fromEntries(
    Object.entries(RELEASE_EVIDENCE_CHECKS).map(([key, name]) => [key, qc?.results?.find((item) => item.name === name)]),
  );
  if (!Object.values(checks).every((check) => check?.pass === true && check.evidence)) return null;
  // A waived (advisory) section is published as verified: false with its real
  // unverified data; the evidence spread carries the waived: true marker.
  const verified = (check) => check.evidence?.waived !== true;
  return {
    schema: RELEASE_EVIDENCE_SCHEMA,
    map: { verified: verified(checks.map), qc_check: { name: checks.map.name, detail: checks.map.detail }, ...checks.map.evidence },
    identity: { verified: true, qc_check: { name: checks.identity.name, detail: checks.identity.detail }, ...checks.identity.evidence },
    template_family: { verified: verified(checks.family), qc_check: { name: checks.family.name, detail: checks.family.detail }, ...checks.family.evidence },
  };
}

export const SERVERLESS = process.env.SITEFORGE_SERVERLESS === "1" || Boolean(process.env.VERCEL);
export const PROJECT_PRECERTIFICATION_POLICY = "project-precertification";
const DISCOVERY_HYDRATION_BATCH_BYTES = 40 * 1024 * 1024;
const PREVIEW_MEDIA_DIRNAME = ".source-media-preview";
const PREVIEW_QC_COHORT_SCHEMA = "siteforge-preview-qc-cohort-v1";
const PREVIEW_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const PREVIEW_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const PREVIEW_IMAGE_MAX_DIMENSION = 12_000;
const PREVIEW_IMAGE_MAX_PIXELS = 50_000_000;
const TRUSTED_AMBIANCE_VIDEO_HOST = "lmniyuftrboqsgrwpwta.supabase.co";
const TRUSTED_AMBIANCE_VIDEO_PATH = "/storage/v1/object/public/wss-proof-assets/ambiance/";
const JOB_BLOB_ETAG = Symbol("siteforgeJobBlobEtag");
let sharedVerticalHistoryStore = null;

export async function hydrateDiscoveryMediaAssets(assets, options = {}) {
  const projectId = String(options.projectId || "").trim();
  const outDir = path.resolve(String(options.outDir || ""));
  if (!projectId || !options.outDir) throw new Error("Discovery media hydration requires projectId and outDir");
  const hydrated = (Array.isArray(assets) ? assets : []).map((asset) => ({
    ...asset,
    meta: asset?.meta ? { ...asset.meta } : {},
  }));
  const ownedPhotos = hydrated.filter((asset) =>
    asset?.kind === "photo"
    && asset.approved !== false
    && /^owned-(?:local|blob)$/.test(String(asset.meta?.mirror_status || "")));
  const missing = [];
  for (const asset of ownedPhotos) {
    const localPath = String(asset.meta?.local_path || asset.local_path || "");
    if (localPath && existsSync(localPath)) {
      await verifyMirroredPhotoFile(localPath, {
        ...(asset.meta || {}),
        width: asset.width,
        height: asset.height,
      });
      asset.local_path = localPath;
      asset.meta.local_path = localPath;
    } else {
      missing.push(asset);
    }
  }
  if (!missing.length) return { assets: hydrated, cleanupDir: null };

  const prefixes = [...new Set(missing.map((asset) => asset.meta?.mirror_blob_prefix).filter(Boolean))];
  if (
    prefixes.length !== 1
    || missing.some((asset) => !asset.meta?.mirror_blob_filename || !asset.meta?.mirror_blob_url)
  ) {
    throw new Error("Durable discovery media metadata is incomplete; generation stopped before remote fallback");
  }
  const expectedPrefix = `discovery/${projectId}/media`;
  if (prefixes[0] !== expectedPrefix) {
    throw new Error("Discovery media Blob prefix does not match the active project");
  }
  const cleanupDir = path.join(outDir, ".source-media-hydrated");
  const pendingCleanup = { cleanupDir };
  const byteBudget = { remaining: DISCOVERY_HYDRATION_BATCH_BYTES };
  try {
    for (const asset of missing) {
      const filename = String(asset.meta.mirror_blob_filename);
      if (path.basename(filename) !== filename) {
        throw new Error("Discovery media Blob filename is invalid");
      }
      if (asset.meta.mirror_blob_path !== `${expectedPrefix}/${filename}`) {
        throw new Error("Discovery media Blob path does not match its persisted filename");
      }
      const localPath = path.join(cleanupDir, filename);
      await downloadVerifiedMirroredPhoto(asset.meta.mirror_blob_url, localPath, {
        ...(asset.meta || {}),
        width: asset.width,
        height: asset.height,
      }, {
        byteBudget,
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl,
        requestImpl: options.requestImpl,
      });
      asset.local_path = localPath;
      asset.meta.local_path = localPath;
    }
  } catch (error) {
    cleanupHydratedDiscoveryMedia(pendingCleanup);
    throw error;
  }
  return { assets: hydrated, cleanupDir };
}

export function cleanupHydratedDiscoveryMedia(hydration) {
  const cleanupDir = hydration?.cleanupDir ? path.resolve(hydration.cleanupDir) : "";
  if (!cleanupDir || path.basename(cleanupDir) !== ".source-media-hydrated") return false;
  rmSync(cleanupDir, { recursive: true, force: true });
  hydration.cleanupDir = null;
  return true;
}

export function approvedPhotoCatalog(assets) {
  return (Array.isArray(assets) ? assets : [])
    .filter((asset) => asset?.kind === "photo" && asset.approved && !asset.meta?.fallback_to_ambiance)
    .map((photo) => ({
      kind: "photo",
      url: photo.url,
      source: photo.origin === "upload" ? "upload" : photo.source || "site",
      label: photo.label || null,
      local_path: photo.meta?.local_path || photo.local_path || null,
      treatment: photo.meta?.treatment || "family-duotone",
      width: photo.width || photo.meta?.width || photo.meta?.dimensions?.width || null,
      height: photo.height || photo.meta?.height || photo.meta?.dimensions?.height || null,
      hero_eligible: photo.hero_eligible !== false,
      proof_eligible: photo.proof_eligible !== false,
      meta: { ...(photo.meta || {}) },
    }));
}

function remoteHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(String(value || "")).protocol);
  } catch {
    return false;
  }
}

const PREVIEW_RASTER_FORMATS = Object.freeze({
  gif: { contentType: "image/gif", extension: ".gif" },
  jpeg: { contentType: "image/jpeg", extension: ".jpg" },
  png: { contentType: "image/png", extension: ".png" },
  webp: { contentType: "image/webp", extension: ".webp" },
});

function normalizedPreviewContentType(value) {
  const contentType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return contentType === "image/jpg" ? "image/jpeg" : contentType;
}

function previewMediaExtension(item, localPath = "") {
  const fromType = Object.values(PREVIEW_RASTER_FORMATS)
    .find((entry) => entry.contentType === normalizedPreviewContentType(
      item?.meta?.content_type || item?.meta?.mime || item?.content_type,
    ))?.extension;
  if (fromType) return fromType;
  const extension = path.extname(String(localPath || item?.url || "")).toLowerCase();
  return [".gif", ".jpg", ".jpeg", ".png", ".webp"].includes(extension) ? extension : "";
}

function previewDifferenceHash(pixels) {
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? "1" : "0";
    }
  }
  return Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16),
  ).join("");
}

async function inspectLocalPreviewRaster(filePath, item, { logo = false } = {}) {
  const stats = statSync(filePath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > PREVIEW_IMAGE_MAX_BYTES) {
    throw new Error("Owned preview image is outside the byte policy");
  }
  const bytes = readFileSync(filePath);
  if (bytes.length !== stats.size) {
    throw new Error("Owned preview image is outside the byte policy");
  }
  let metadata;
  let pixels;
  try {
    const inputOptions = {
      failOn: "error",
      limitInputPixels: PREVIEW_IMAGE_MAX_PIXELS,
      sequentialRead: true,
    };
    metadata = await sharp(bytes, inputOptions).metadata();
    pixels = await sharp(bytes, inputOptions)
      .rotate()
      .resize(9, 8, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
  } catch {
    throw new Error("Owned preview image failed full decode");
  }
  const format = PREVIEW_RASTER_FORMATS[metadata.format];
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const withinMaximums = Boolean(
    format
    && Number(metadata.pages || 1) === 1
    && width > 0
    && height > 0
    && width <= PREVIEW_IMAGE_MAX_DIMENSION
    && height <= PREVIEW_IMAGE_MAX_DIMENSION
    && width * height <= PREVIEW_IMAGE_MAX_PIXELS
    && pixels.length === 72,
  );
  const largeEnough = logo
    ? width >= 16 && height >= 16 && width * height >= 512
    : hasUsablePhotoDimensions(width, height);
  if (!withinMaximums || !largeEnough) throw new Error("Owned preview image violates decode or dimension policy");

  const extension = path.extname(filePath).toLowerCase();
  const equivalentExtension = metadata.format === "jpeg"
    ? [".jpg", ".jpeg"].includes(extension)
    : extension === format.extension;
  if (extension && !equivalentExtension) throw new Error("Owned preview image extension does not match decoded bytes");

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const perceptualHash = previewDifferenceHash(pixels);
  const declaredChecksum = String(item?.meta?.checksum_sha256 || "").trim().toLowerCase();
  const declaredContentType = normalizedPreviewContentType(
    item?.meta?.content_type || item?.meta?.mime || item?.content_type,
  );
  const declaredWidthValue = item?.width ?? item?.meta?.width ?? item?.meta?.dimensions?.width;
  const declaredHeightValue = item?.height ?? item?.meta?.height ?? item?.meta?.dimensions?.height;
  const declaredWidth = declaredWidthValue == null || declaredWidthValue === "" ? null : Number(declaredWidthValue);
  const declaredHeight = declaredHeightValue == null || declaredHeightValue === "" ? null : Number(declaredHeightValue);
  const declaredPerceptualHash = String(item?.perceptual_hash || item?.meta?.perceptual_hash || "").trim().toLowerCase();
  if (declaredChecksum && declaredChecksum !== checksum) throw new Error("Owned preview image checksum metadata is forged or stale");
  if (declaredContentType && declaredContentType !== format.contentType) throw new Error("Owned preview image MIME metadata is forged or stale");
  if (declaredWidth !== null && (!Number.isInteger(declaredWidth) || declaredWidth <= 0 || declaredWidth !== width)) {
    throw new Error("Owned preview image width metadata is forged or stale");
  }
  if (declaredHeight !== null && (!Number.isInteger(declaredHeight) || declaredHeight <= 0 || declaredHeight !== height)) {
    throw new Error("Owned preview image height metadata is forged or stale");
  }
  if (declaredPerceptualHash && declaredPerceptualHash !== perceptualHash) {
    throw new Error("Owned preview image perceptual hash metadata is forged or stale");
  }
  return {
    bytes,
    checksum,
    contentType: format.contentType,
    extension: format.extension,
    width,
    height,
    perceptualHash,
  };
}

function previewOwnedMediaPath(mediaDir, verified, prefix = "source") {
  const extension = verified.extension;
  if (!extension) throw new Error("Owned preview photo has no supported image type");
  return path.join(mediaDir, `${prefix}-${verified.checksum.slice(0, 20)}${extension}`);
}

function trustedLocalPreviewAsset(item) {
  const source = String(item?.source || item?.origin || "").toLowerCase();
  return /(?:^|[-_ ])(?:upload|owner|operator|provided)(?:$|[-_ ])/.test(source);
}

async function stageExistingPreviewPhoto(item, mediaDir, { logo = false } = {}) {
  const localPath = String(item?.local_path || item?.meta?.local_path || "");
  if (!localPath || !existsSync(localPath)) return null;
  const mirrorStatus = String(item?.meta?.mirror_status || "");
  let verified;
  if (/^owned-(?:local|blob)$/.test(mirrorStatus)) {
    await verifyMirroredPhotoFile(localPath, {
      ...(item.meta || {}),
      width: item.width,
      height: item.height,
    });
    verified = await inspectLocalPreviewRaster(localPath, item, { logo });
  } else if (logo || trustedLocalPreviewAsset(item)) {
    verified = await inspectLocalPreviewRaster(localPath, item, { logo });
  } else {
    return null;
  }
  mkdirSync(mediaDir, { recursive: true });
  const ownedPath = previewOwnedMediaPath(mediaDir, verified, logo ? "logo" : "source");
  writeFileSync(ownedPath, verified.bytes);
  return {
    ...item,
    url: ownedPath,
    local_path: ownedPath,
    width: verified.width,
    height: verified.height,
    meta: {
      ...(item.meta || {}),
      source_url: item.meta?.source_url || (remoteHttpUrl(item.url) ? item.url : null),
      local_path: ownedPath,
      dimensions: { width: verified.width, height: verified.height },
      checksum_sha256: verified.checksum,
      content_type: verified.contentType,
      mirror_status: "owned-local",
      perceptual_hash: verified.perceptualHash,
    },
  };
}

async function hydrateDurablePreviewPhoto(item, mediaDir, options, byteBudget) {
  if (String(item?.meta?.mirror_status || "") !== "owned-blob") return null;
  const filename = String(item?.meta?.mirror_blob_filename || "");
  const blobUrl = String(item?.meta?.mirror_blob_url || "");
  if (!filename || path.basename(filename) !== filename || !blobUrl) {
    throw new Error("Durable preview media metadata is incomplete");
  }
  const extension = previewMediaExtension(item, filename);
  if (!extension) throw new Error("Durable preview photo has no supported image type");
  const checksum = String(item?.meta?.checksum_sha256 || "").trim().toLowerCase();
  const ownedPath = path.join(mediaDir, `source-${checksum.slice(0, 20)}${extension}`);
  await downloadVerifiedMirroredPhoto(blobUrl, ownedPath, {
    ...(item.meta || {}),
    width: item.width,
    height: item.height,
  }, {
    byteBudget,
    fetchImpl: options.fetchImpl,
    lookupImpl: options.lookupImpl,
    requestImpl: options.requestImpl,
  });
  return {
    ...item,
    url: ownedPath,
    local_path: ownedPath,
    meta: {
      ...(item.meta || {}),
      source_url: item.meta?.source_url || item.url || null,
      local_path: ownedPath,
    },
  };
}

function isRemoteAmbiance(item) {
  const source = String(item?.source || "").toLowerCase();
  return source === "stock-ambiance" || source === "ai-ambiance" || source === "ai";
}

function trustedAmbianceVideoUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value || ""));
    const objectName = url.pathname.slice(TRUSTED_AMBIANCE_VIDEO_PATH.length);
    return url.protocol === "https:"
      && url.hostname === TRUSTED_AMBIANCE_VIDEO_HOST
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname.startsWith(TRUSTED_AMBIANCE_VIDEO_PATH)
      && /^[a-z0-9][a-z0-9/_-]*\.mp4$/i.test(objectName);
  } catch {
    return false;
  }
}

function trustedRemoteAmbianceVideo(item) {
  const source = String(item?.source || "").toLowerCase();
  return item?.kind === "video"
    && ["ai", "ai-ambiance"].includes(source)
    && String(item?.role || "").toLowerCase() === "ambiance"
    && item?.approved !== false
    && trustedAmbianceVideoUrl(item.url);
}

function ownedPreviewVideoAsset(item, verified, ownedPath, { ambiance = false } = {}) {
  const width = Number(item.width || item.meta?.width || item.meta?.dimensions?.width || 0);
  const height = Number(item.height || item.meta?.height || item.meta?.dimensions?.height || 0);
  const duration = Number(item.meta?.duration || 0);
  const generator = String(item.meta?.generator || "").trim().slice(0, 80);
  const source = ambiance
    ? "ai-ambiance"
    : String(item.source || "owned").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60) || "owned";
  const role = ambiance
    ? "ambiance"
    : String(item.role || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60) || null;
  return {
    kind: "video",
    url: ownedPath,
    local_path: ownedPath,
    mime: verified.contentType,
    mime_type: verified.contentType,
    content_type: verified.contentType,
    source,
    role,
    label: String(item.label || (ambiance ? "Cinematic brand concept" : "Business video")).trim().slice(0, 200),
    generated: ambiance || item.generated === true,
    ai_generated: ambiance || item.ai_generated === true,
    approved: item.approved !== false,
    hero_eligible: item.hero_eligible !== false,
    proof_eligible: ambiance ? false : item.proof_eligible !== false,
    truthful_source: ambiance ? false : item.truthful_source !== false,
    ...(Number.isFinite(width) && width > 0 ? { width } : {}),
    ...(Number.isFinite(height) && height > 0 ? { height } : {}),
    meta: {
      ...(generator ? { generator } : {}),
      ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
      local_path: ownedPath,
      checksum_sha256: verified.checksum,
      content_type: verified.contentType,
      byte_length: verified.byteLength,
      mirror_status: "owned-local",
    },
  };
}

function stageExistingPreviewVideo(item, mediaDir) {
  const localPath = String(item?.local_path || item?.meta?.local_path || "");
  if (
    !localPath
    || !existsSync(localPath)
    || !/^owned-(?:local|blob)$/.test(String(item?.meta?.mirror_status || ""))
  ) return null;
  const source = String(item?.source || "").toLowerCase();
  const ambiance = ["ai", "ai-ambiance"].includes(source);
  if (ambiance && String(item?.role || "").toLowerCase() !== "ambiance") return null;
  let verified;
  try {
    verified = verifyMirroredVideoFile(localPath, item.meta || {});
  } catch {
    return null;
  }
  mkdirSync(mediaDir, { recursive: true });
  const prefix = ambiance ? "ambiance" : "video";
  const ownedPath = path.join(mediaDir, `${prefix}-${verified.checksum.slice(0, 20)}${verified.extension}`);
  writeFileSync(ownedPath, verified.buffer);
  return ownedPreviewVideoAsset(item, verified, ownedPath, { ambiance });
}

async function stageTrustedAmbianceVideo(item, mediaDir, options, byteBudget) {
  if (!trustedRemoteAmbianceVideo(item)) return null;
  const downloaded = await fetchRemoteVideo(item.url, {
    maxBytes: PREVIEW_VIDEO_MAX_BYTES,
    byteBudget,
    allowUrl: trustedAmbianceVideoUrl,
    fetchImpl: options.fetchImpl,
    lookupImpl: options.lookupImpl,
    requestImpl: options.requestImpl,
  });
  if (!downloaded) return null;
  mkdirSync(mediaDir, { recursive: true });
  const ownedPath = path.join(
    mediaDir,
    `ambiance-${downloaded.checksum.slice(0, 20)}${downloaded.extension}`,
  );
  writeFileSync(ownedPath, downloaded.buffer);
  return ownedPreviewVideoAsset(item, downloaded, ownedPath, { ambiance: true });
}

function dedupeVerifiedPreviewMedia(items) {
  const checksums = new Set();
  const perceptualHashes = [];
  return items.filter((item) => {
    const checksum = String(item?.meta?.checksum_sha256 || "").trim().toLowerCase();
    if (checksum && checksums.has(checksum)) return false;
    if (checksum) checksums.add(checksum);
    if (item?.kind !== "photo") return true;
    const perceptualHash = String(item?.meta?.perceptual_hash || "").trim().toLowerCase();
    if (
      perceptualHash
      && perceptualHashes.some((prior) => perceptualHashesCollide(prior, perceptualHash))
    ) return false;
    if (perceptualHash) perceptualHashes.push(perceptualHash);
    return true;
  });
}

const FABRICATED_PREVIEW_LOGO_SOURCE = /(?:^|[\s/_-])(?:ai|generated|placeholder|proposed|sample|stock|synthetic)(?:$|[\s/_-])/i;

function isFabricatedPreviewLogo(value = {}) {
  if (value?.generated === true || value?.ai_generated === true) return true;
  return FABRICATED_PREVIEW_LOGO_SOURCE.test(
    [value?.origin, value?.source, value?.provenance, value?.role].filter(Boolean).join(" "),
  );
}

function previewLogoCandidate(packet) {
  const fact = packet?.enrichment_sources?.logo;
  const factValue = fact && typeof fact === "object" && "value" in fact ? fact.value : fact;
  const factAsset = factValue && typeof factValue === "object" ? factValue : null;
  const values = [packet?.v7_logo, packet?.logo_source, factAsset]
    .filter((value) => value && typeof value === "object");
  const raw = values.find((value) =>
    value.proposed !== true
    && String(value.proposed || "").toLowerCase() !== "true"
    && !isFabricatedPreviewLogo(value)
    && (value.local_path || value.transformed_asset_path || value.chosen_url || value.remastered_path || value.url));
  const url = String(
    raw?.chosen_url
    || raw?.remastered_path
    || raw?.url
    || (typeof factValue === "string" ? factValue : ""),
  );
  const localPath = String(raw?.local_path || raw?.transformed_asset_path || "");
  if (!raw && isFabricatedPreviewLogo({
    ...(factAsset || {}),
    source: fact?.source || factAsset?.source,
  })) return null;
  if (!raw && !url) return null;
  return {
    raw: raw || {},
    fact,
    item: {
      ...(raw || {}),
      kind: "logo",
      url,
      local_path: localPath || null,
      source: raw?.source || raw?.origin || fact?.source || "business-site",
      origin: raw?.origin || raw?.source || fact?.source || "business-site",
      role: raw?.role || factAsset?.role || "logo",
      meta: {
        ...(raw?.meta || {}),
        local_path: localPath || raw?.meta?.local_path || null,
        source_url: raw?.meta?.source_url || (remoteHttpUrl(url) ? url : null),
      },
    },
  };
}

function removeUnownedPreviewLogo(packet) {
  const isUnowned = (logo) => {
    if (!logo || logo.proposed === true || String(logo.proposed || "").toLowerCase() === "true") return false;
    const value = logo.chosen_url || logo.remastered_path || logo.url;
    const localPath = logo.local_path || logo.transformed_asset_path;
    return !localPath || !existsSync(localPath) || remoteHttpUrl(value);
  };
  if (isUnowned(packet.v7_logo)) delete packet.v7_logo;
  if (isUnowned(packet.logo_source)) delete packet.logo_source;
  const fact = packet.enrichment_sources?.logo;
  const value = fact && typeof fact === "object" && "value" in fact ? fact.value : fact;
  const url = typeof value === "string" ? value : value?.url;
  if (url && (remoteHttpUrl(url) || !existsSync(String(value?.local_path || "")))) {
    delete packet.enrichment_sources.logo;
  }
}

function removeRejectedPreviewLogo(packet) {
  delete packet.v7_logo;
  delete packet.logo_source;
  if (packet.enrichment_sources && typeof packet.enrichment_sources === "object") {
    delete packet.enrichment_sources.logo;
  }
}

function logoColorDistance(left, right) {
  return Math.sqrt(
    (left.r - right.r) ** 2
    + (left.g - right.g) ** 2
    + (left.b - right.b) ** 2,
  );
}

function logoColorHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function modalLogoPixel(pixels) {
  return [...pixels.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
}

function dominantNeutralLogoCanvas(data, info) {
  const border = Math.max(1, Math.floor(Math.min(info.width, info.height) * 0.06));
  const buckets = new Map();
  let borderWeight = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (
        x >= border
        && x < info.width - border
        && y >= border
        && y < info.height - border
      ) continue;
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3];
      if (alpha < 128) continue;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const weight = alpha / 255;
      const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
      const bucket = buckets.get(key) || { pixels: new Map(), weight: 0 };
      const pixel = (r << 16) | (g << 8) | b;
      bucket.pixels.set(pixel, (bucket.pixels.get(pixel) || 0) + weight);
      bucket.weight += weight;
      borderWeight += weight;
      buckets.set(key, bucket);
    }
  }
  if (!borderWeight || !buckets.size) return null;
  const dominant = [...buckets.values()]
    .sort((left, right) => right.weight - left.weight)[0];
  if (dominant.weight / borderWeight < 0.68) return null;
  const pixel = modalLogoPixel(dominant.pixels);
  if (pixel === null) return null;
  const color = {
    r: pixel >> 16,
    g: (pixel >> 8) & 255,
    b: pixel & 255,
  };
  const maximum = Math.max(color.r, color.g, color.b);
  const minimum = Math.min(color.r, color.g, color.b);
  return maximum - minimum <= 18 && minimum >= 208 ? color : null;
}

// Brand colors are sampled only from the fully decoded, output-owned logo.
// Quantized buckets collapse antialiasing noise, then retain an actual modal
// pixel rather than synthesizing an average. Transparent pixels and a dominant
// light-neutral canvas cannot create a fabricated palette; a genuine
// dark/monochrome mark yields one honest fallback color.
export async function extractLogoBrandColors(localPath) {
  try {
    const { data, info } = await sharp(localPath, {
      failOn: "error",
      limitInputPixels: PREVIEW_IMAGE_MAX_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        width: 128,
        height: 128,
        fit: "inside",
        withoutEnlargement: true,
        kernel: "nearest",
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || !data.length) return [];

    const neutralCanvas = dominantNeutralLogoCanvas(data, info);
    const buckets = new Map();
    let acceptedWeight = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const alpha = data[offset + 3];
      if (alpha < 128) continue;
      const minimum = Math.min(r, g, b);
      if (minimum >= 232) continue;
      if (neutralCanvas && logoColorDistance({ r, g, b }, neutralCanvas) <= 28) continue;
      const weight = alpha / 255;
      const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
      const bucket = buckets.get(key) || { pixels: new Map(), weight: 0 };
      const pixel = (r << 16) | (g << 8) | b;
      bucket.pixels.set(pixel, (bucket.pixels.get(pixel) || 0) + weight);
      bucket.weight += weight;
      acceptedWeight += weight;
      buckets.set(key, bucket);
    }
    if (!acceptedWeight) return [];

    const candidates = [...buckets.values()]
      .filter((bucket) => bucket.weight >= Math.max(1, acceptedWeight * 0.003))
      .map((bucket) => {
        const pixel = modalLogoPixel(bucket.pixels);
        const color = {
          r: pixel >> 16,
          g: (pixel >> 8) & 255,
          b: pixel & 255,
          weight: bucket.weight,
        };
        color.chroma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
        return color;
      })
      .sort((left, right) => right.weight - left.weight || right.chroma - left.chroma);
    if (!candidates.length) return [];

    const chromatic = candidates.filter((color) => color.chroma >= 24);
    const neutral = candidates.filter((color) => color.chroma < 24);
    const selected = [];
    const addSeparated = (color) => {
      if (selected.every((prior) => logoColorDistance(prior, color) >= 52)) selected.push(color);
    };
    for (const color of chromatic) {
      addSeparated(color);
      if (selected.length === 3) break;
    }
    if (!chromatic.length) {
      addSeparated(neutral[0]);
    } else if (selected.length < 3) {
      const darkNeutral = neutral.find((color) => Math.max(color.r, color.g, color.b) <= 190);
      if (darkNeutral) addSeparated(darkNeutral);
    }
    return selected.slice(0, 3).map(logoColorHex);
  } catch {
    return [];
  }
}

async function applyLogoBrandColors(packet, stagedLogo) {
  const existing = normalizedBrandColors(
    packet.brand?.colors,
    packet.source?.brandColors,
    packet.enrichment_sources?.colors?.value,
  );
  const logoColors = await extractLogoBrandColors(stagedLogo?.local_path);
  const sampledContentSha256 = String(stagedLogo?.meta?.checksum_sha256 || "").trim().toLowerCase();
  if (!logoColors.length || !/^[a-f0-9]{64}$/.test(sampledContentSha256)) return existing;
  const colors = normalizedBrandColors(logoColors, existing);
  packet.logo_source = {
    ...(packet.logo_source || {}),
    colors: logoColors,
    color_provenance: {
      verified: true,
      method: "staged-logo-pixel-extraction-v1",
      content_sha256: sampledContentSha256,
    },
  };
  if (packet.v7_logo && typeof packet.v7_logo === "object") {
    const {
      colors: _discardedColors,
      color_provenance: _discardedColorProvenance,
      ...v7Logo
    } = packet.v7_logo;
    packet.v7_logo = v7Logo;
  }
  packet.brand = { ...(packet.brand || {}), colors };
  return colors;
}

async function stagePreviewLogo(packet, mediaDir, options, byteBudget) {
  const candidate = previewLogoCandidate(packet);
  if (!candidate) return null;
  let staged;
  try {
    staged = await stageExistingPreviewPhoto(candidate.item, mediaDir, { logo: true });
  } catch {
    removeRejectedPreviewLogo(packet);
    return null;
  }
  if (!staged && remoteHttpUrl(candidate.item.url)) {
    const downloaded = await fetchRemotePhoto(candidate.item.url, {
      byteBudget,
      dimensionPolicy: "logo",
      fetchImpl: options.fetchImpl,
      lookupImpl: options.lookupImpl,
      requestImpl: options.requestImpl,
    });
    if (downloaded) {
      mkdirSync(mediaDir, { recursive: true });
      const provisionalPath = path.join(
        mediaDir,
        `logo-${downloaded.checksum.slice(0, 20)}${downloaded.extension}`,
      );
      writeFileSync(provisionalPath, downloaded.buffer);
      try {
        staged = await stageExistingPreviewPhoto({
          ...candidate.item,
          local_path: provisionalPath,
          meta: {
            ...(candidate.item.meta || {}),
            local_path: provisionalPath,
          },
        }, mediaDir, { logo: true });
      } catch {
        removeRejectedPreviewLogo(packet);
        return null;
      }
    }
  }
  if (!staged) {
    removeUnownedPreviewLogo(packet);
    return null;
  }
  const {
    colors: _unverifiedCandidateColors,
    color_provenance: _unverifiedColorProvenance,
    ...candidateRaw
  } = candidate.raw;
  const ownedLogo = {
    ...candidateRaw,
    url: staged.local_path,
    chosen_url: staged.local_path,
    local_path: staged.local_path,
    proposed: false,
    source: candidate.item.source,
    origin: candidate.item.origin,
    role: candidate.item.role,
    meta: { ...staged.meta },
  };
  packet.logo_source = { ...ownedLogo };
  packet.v7_logo = { ...ownedLogo };
  packet.enrichment_sources = {
    ...(packet.enrichment_sources || {}),
    logo: {
      ...(candidate.fact && typeof candidate.fact === "object" ? candidate.fact : {}),
      source: candidate.fact?.source || candidate.item.source,
      value: staged.local_path,
      local_path: staged.local_path,
      role: candidate.item.role,
    },
  };
  await applyLogoBrandColors(packet, staged);
  return ownedLogo;
}

// All preview routes use the same stage-2 boundary as batch verification.
// Verified discovery mirrors are copied into an output-owned temp directory;
// unknown remote prospect photos must pass bounded download, full decode,
// checksum, and perceptual-hash verification before rendering.
export async function hardenPreviewMedia(packet, options = {}) {
  if (!packet || typeof packet !== "object") throw new Error("Preview media boundary requires a packet");
  const outDir = path.resolve(String(options.outDir || ""));
  if (!options.outDir) throw new Error("Preview media boundary requires an output directory");
  const mediaDir = path.join(outDir, PREVIEW_MEDIA_DIRNAME);
  const byteBudget = { remaining: DISCOVERY_HYDRATION_BATCH_BYTES };
  const catalog = [];
  let deferredRemoteAmbiance = null;
  let remoteAmbianceAttemptReserved = false;
  try {
    await stagePreviewLogo(packet, mediaDir, options, byteBudget);
    for (const rawItem of Array.isArray(packet.media?.catalog) ? packet.media.catalog : []) {
      const item = { ...rawItem, meta: { ...(rawItem?.meta || {}) } };
      if (item.kind === "video") {
        if (!remoteHttpUrl(item.url)) {
          const stagedLocalVideo = stageExistingPreviewVideo(item, mediaDir);
          if (stagedLocalVideo) catalog.push(stagedLocalVideo);
          continue;
        }
        if (!remoteAmbianceAttemptReserved && trustedRemoteAmbianceVideo(item)) {
          remoteAmbianceAttemptReserved = true;
          deferredRemoteAmbiance = item;
        }
        continue;
      }
      if (item.kind !== "photo") {
        catalog.push(item);
        continue;
      }
      const staged = await stageExistingPreviewPhoto(item, mediaDir)
        || await hydrateDurablePreviewPhoto(item, mediaDir, options, byteBudget);
      if (staged) {
        catalog.push(staged);
        continue;
      }
      // A stale local-only path has no safe fallback. A retained remote source
      // URL is still passed through scrape() and must earn a fresh mirror.
      const sourceUrl = item.meta?.source_url || item.url;
      if (remoteHttpUrl(sourceUrl)) catalog.push({ ...item, url: sourceUrl, local_path: null });
    }
    packet.media = { ...(packet.media || {}), catalog };
    await scrape(packet, {
      mirrorRemote: true,
      mediaDir,
      maxBatchBytes: byteBudget.remaining,
      fetchImpl: options.fetchImpl,
      lookupImpl: options.lookupImpl,
      requestImpl: options.requestImpl,
    });
    // Real proof owns the 40 MiB scrape budget. The optional AI clip runs only
    // afterward with its own 25 MiB ceiling, for a hard combined maximum of 65 MiB.
    if (deferredRemoteAmbiance) {
      const stagedVideo = await stageTrustedAmbianceVideo(
        deferredRemoteAmbiance,
        mediaDir,
        options,
        { remaining: PREVIEW_VIDEO_MAX_BYTES },
      );
      if (stagedVideo) packet.media.catalog.push(stagedVideo);
    }
    packet.media.catalog = dedupeVerifiedPreviewMedia((packet.media?.catalog || []).flatMap((rawItem) => {
      const item = { ...rawItem, meta: { ...(rawItem?.meta || {}) } };
      const localPath = String(item.local_path || item.meta.local_path || "");
      if (localPath && existsSync(localPath)) {
        return [{
          ...item,
          url: localPath,
          local_path: localPath,
          meta: {
            ...item.meta,
            source_url: item.meta.source_url || (remoteHttpUrl(item.url) ? item.url : null),
            local_path: localPath,
          },
        }];
      }
      if (remoteHttpUrl(item.url) && (item.kind === "video" || !isRemoteAmbiance(item))) return [];
      return [item];
    }));
    return packet;
  } catch (error) {
    cleanupMirroredMedia({
      media: {
        mirror_dir: mediaDir,
        mirror_cleanup_required: true,
      },
    });
    throw error;
  }
}

export async function withPreviewMediaCleanup(packet, work) {
  try {
    return await work();
  } finally {
    cleanupMirroredMedia(packet);
  }
}

function normalizedQcTrade(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.join("-") || "";
}

function cohortId(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean)?.slice(0, 160) || "";
}

// Shared batch/release ids survive unchanged. Ad-hoc previews receive a
// unique release id so historical output can never bootstrap Grade A.
export function assignPreviewQcCohort(packet, { source = null, previewKey = null } = {}) {
  const batchId = cohortId(
    packet?.batch_id,
    packet?.forge?.batch_id,
    source?.batch_id,
    source?.batchId,
    source?.input?.batch_id,
    source?.input?.batchId,
    source?.facts?.batch_id,
    source?.facts?.batchId,
  );
  const suppliedReleaseId = cohortId(
    packet?.release_id,
    packet?.forge?.release_id,
    source?.release_id,
    source?.releaseId,
    source?.input?.release_id,
    source?.input?.releaseId,
  );
  const kind = batchId ? "batch" : "release";
  const idValue = batchId || suppliedReleaseId || `preview-${cohortId(previewKey, packet?.slug, randomUUID())}`;
  const trade = normalizedQcTrade(
    packet?.canonical_truth?.primary_vertical
    || packet?.business?.category,
  );
  packet.qc_cohort = {
    schema: PREVIEW_QC_COHORT_SCHEMA,
    kind,
    id: idValue,
    trade,
  };
  if (kind === "batch") {
    packet.batch_id = idValue;
    delete packet.release_id;
    if (packet.forge && typeof packet.forge === "object") delete packet.forge.release_id;
  } else {
    packet.release_id = idValue;
    delete packet.batch_id;
    if (packet.forge && typeof packet.forge === "object") delete packet.forge.batch_id;
  }
  return packet.qc_cohort;
}

export function persistPreviewQcCohort(outDir, packet) {
  const packetPath = path.join(outDir, "packet.json");
  if (!existsSync(packetPath) || !packet?.qc_cohort) return false;
  const publicPacket = readJsonFile(packetPath, {});
  publicPacket.qc_cohort = { ...packet.qc_cohort };
  if (packet.qc_cohort.kind === "batch") {
    publicPacket.batch_id = packet.qc_cohort.id;
    delete publicPacket.release_id;
    if (publicPacket.forge && typeof publicPacket.forge === "object") delete publicPacket.forge.release_id;
  } else {
    publicPacket.release_id = packet.qc_cohort.id;
    delete publicPacket.batch_id;
    if (publicPacket.forge && typeof publicPacket.forge === "object") delete publicPacket.forge.batch_id;
  }
  writeJsonFile(packetPath, publicPacket);
  return true;
}

function runtimeVerticalHistoryStore() {
  if (!sharedVerticalHistoryStore) {
    const env = {
      ...process.env,
      SITEFORGE_VERTICAL_HISTORY_BACKEND: process.env.SITEFORGE_VERTICAL_HISTORY_BACKEND || (SERVERLESS ? "blob" : "filesystem"),
    };
    sharedVerticalHistoryStore = createVerticalHistoryStore({ env });
  }
  return sharedVerticalHistoryStore;
}

// ---------- capability probe ----------
let chromiumOk = null;
export function chromiumAvailable() {
  if (chromiumOk != null) return chromiumOk;
  const r = spawnSync(process.execPath, ["-e", "import('playwright').then(p=>p.chromium.launch().then(b=>b.close()).then(()=>process.exit(0),()=>process.exit(1)))"], { cwd: REPO_ROOT, timeout: 30000 });
  chromiumOk = r.status === 0;
  return chromiumOk;
}

// ---------- packet forging (single source of truth: scripts/forge.mjs) ----------
let tmpForgeRoot = null;
function forgeRoot() {
  // Serverless filesystems are read-only except /tmp; forge writes packets/
  // beside itself, so run it from a /tmp copy there.
  if (!SERVERLESS) return REPO_ROOT;
  if (tmpForgeRoot) return tmpForgeRoot;
  const os = { tmpdir: () => "/tmp" };
  tmpForgeRoot = path.join(os.tmpdir(), "sf-forge-root");
  mkdirSync(path.join(tmpForgeRoot, "scripts"), { recursive: true });
  cpSync(path.join(REPO_ROOT, "scripts", "forge.mjs"), path.join(tmpForgeRoot, "scripts", "forge.mjs"));
  cpSync(path.join(REPO_ROOT, "generator-queue-v5.schema.json"), path.join(tmpForgeRoot, "generator-queue-v5.schema.json"));
  return tmpForgeRoot;
}

export function forgePacket({ prompt = null, intake = null, slug = null, hero = null, demo = false }) {
  const ROOT = forgeRoot();
  const args = [path.join(ROOT, "scripts", "forge.mjs"), "--dry-run", "--json"];
  let tmp = null;
  if (intake) {
    tmp = path.join(process.env.SITEFORGE_DATA_DIR || path.join(APP_ROOT, "data"), "tmp", `intake-${token(6)}.json`);
    writeJsonFile(tmp, intake);
    args.push("--from-intake", tmp);
  } else if (prompt) {
    args.push("--prompt", prompt);
  } else throw new Error("forgePacket needs a prompt or an intake");
  if (slug) args.push("--slug", slug);
  if (hero) args.push("--hero", hero);
  if (demo) args.push("--demo");
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 30000 });
  if (tmp) try { rmSync(tmp); } catch {}
  const out = r.stdout || "";
  const jsonStart = out.indexOf("{");
  if (r.status !== 0 || jsonStart === -1) {
    const msg = (r.stderr || out || "forge failed").trim().replace(/^✖ forge failed:\s*/, "");
    const e = new Error(msg); e.status = 422; throw e;
  }
  return JSON.parse(out.slice(jsonStart));
}

// ---------- discovery packet files (brand/assets/services/trust/seo/build-packet) ----------
export function writeDiscoveryPackets(projectDir, packet, assets) {
  ensureDir(projectDir);
  const src = packet.enrichment_sources ?? {};
  const val = (k) => src[k]?.value ?? null;
  const assetColors = (assets || [])
    .filter((asset) => asset.kind === "color" && asset.approved !== false)
    .map((asset) => asset.meta?.value ?? asset.label);
  const colors = normalizedBrandColors(
    val("branding")?.colors,
    val("colors"),
    packet.source?.brandColors,
    packet.brand?.colors,
    assetColors,
  );
  const brand = {
    name: packet.business?.name ?? null,
    logo: assets.find((a) => a.kind === "logo" && a.approved)?.url ?? val("logo"),
    colors,
    fonts: val("branding")?.fonts ?? [],
    tone: packet.voice_persona?.tone ?? null,
    sources: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { source: v.source, confidence: v.confidence }])),
  };
  const assetsOut = {
    logo: brand.logo,
    photos: assets.filter((a) => a.kind === "photo" && a.approved && !a.meta?.fallback_to_ambiance).map((a) => ({ url: a.url, label: a.label, treatment: a.meta?.treatment || "family-duotone" })),
    videos: assets.filter((a) => a.kind === "video" && a.approved).map((a) => ({ url: a.url })),
    screenshots: assets.filter((a) => a.kind === "screenshot").map((a) => ({ url: a.url })),
  };
  const services = { services: packet.services ?? [], source: src.services?.source ?? "unknown", confidence: src.services?.confidence ?? null };
  const trust = {
    reviews: assets.filter((a) => a.kind === "review" && a.approved).map((a) => a.meta ?? { text: a.label }),
    years_in_biz: src.years?.value ?? null,
    citations: assets.filter((a) => a.kind === "citation").map((a) => a.url),
    policy: "No fabricated reviews. Only verifiable, sourced trust signals render.",
  };
  const seo = {
    current_site: packet.business?.current_website ?? null,
    gaps: packet.seo_gaps ?? ["schema", "og-image", "llms.txt", "sitemap"],
    target_schema: ["LocalBusiness", "Service", "FAQPage", "BreadcrumbList"],
    geo_aeo: { llms_txt: true, speakable: true, faq_blocks: true },
  };
  writeJsonFile(path.join(projectDir, "brand.json"), brand);
  writeJsonFile(path.join(projectDir, "assets.json"), assetsOut);
  writeJsonFile(path.join(projectDir, "services.json"), services);
  writeJsonFile(path.join(projectDir, "trust.json"), trust);
  writeJsonFile(path.join(projectDir, "seo.json"), seo);
  writeJsonFile(path.join(projectDir, "build-packet.json"), packet);
}

// ---------- jobs + SSE bus ----------
const jobBus = new Map(); // jobId -> { events: [], listeners: Set<fn>, done: bool }
let queue = Promise.resolve();
const STAGE_TIMEOUT_MS = Number(process.env.SITEFORGE_STAGE_TIMEOUT_MS || 45_000);
// Allow a bounded stage timer to persist its specific failure before the
// cross-instance watchdog converts an abandoned job to a generic timeout.
const JOB_STALE_MS = Number(process.env.SITEFORGE_JOB_STALE_MS || 195_000);
const STAGE_ADVANCE_LEASE_MS = Number(process.env.SITEFORGE_ADVANCE_LEASE_MS || 150_000);
// Durable heartbeat cadence while a stage body is actively working. Long
// stage bodies (blob download -> capture -> blob upload) previously wrote no
// durable timestamps between "start" and "done", so any concurrent
// getDurableJob() reader converted a healthy in-flight job to
// timed_out/job_stale_timeout once JOB_STALE_MS elapsed — even though the
// screenshots later landed in Blob.
const STAGE_HEARTBEAT_MS = Number(process.env.SITEFORGE_STAGE_HEARTBEAT_MS || 25_000);
const TERMINAL_JOB_STATES = new Set(["done", "ready", "blocked", "failed", "timed_out"]);

function jobLeasePart(value, fallback = "unowned") {
  return String(value || fallback).replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || fallback;
}

function jobHeartbeatPath(jobId, requestId = "") {
  return `jobs/${jobId}.heartbeat.${jobLeasePart(requestId)}.json`;
}

function jobHandoffPath(jobId, fromRequestId, fromAttempt, toRequestId, toAttempt) {
  return `jobs/${jobId}.handoff.${jobLeasePart(fromRequestId)}.${Number(fromAttempt || 0)}.${jobLeasePart(toRequestId)}.${Number(toAttempt || 0)}.json`;
}

function jobTerminalPath(jobId, requestId, attempt) {
  return `jobs/${jobId}.terminal.${jobLeasePart(requestId)}.${Number(attempt || 0)}.json`;
}

const STAGED_STAGE_SUCCESSOR = Object.freeze({
  render: "capture_desktop",
  capture_desktop: "capture_mobile",
  capture_mobile: "qc",
});

function validStageHandoffTransition(fromStage, toStage, fromAttempt, toAttempt, reason) {
  if (Number(toAttempt || 0) !== Number(fromAttempt || 0) + 1) return false;
  if (reason === "stage_timeout_retry") return fromStage === toStage;
  return reason === "stage_completed" && STAGED_STAGE_SUCCESSOR[fromStage] === toStage;
}

function ownsStageLease(job, stage, requestId, attempt) {
  if (
    !job
    || job.current_stage !== stage
    || Number(job.advance_attempts || 0) !== Number(attempt || 0)
  ) return false;
  if (job.status === "running") {
    return job.active_stage === stage && job.active_stage_request_id === requestId;
  }
  return job.status === "queued"
    && job.advance_request_id === requestId
    && (!job.advance_requested_stage || job.advance_requested_stage === stage);
}

// `last_heartbeat_at` is not meaningful on its own: a completed render can
// leave a recent timestamp behind while its capture successor is already
// running (or has died).  Only a heartbeat explicitly stamped by the current
// stage owner may extend that owner's recovery lease.  Older records without
// these stamps deliberately fall back to `stage_started_at`; that is safer
// than letting an unowned predecessor heartbeat strand a dead worker.
function stageLeaseLiveness(job, stage = job?.current_stage) {
  if (!job || job.status !== "running" || job.active_stage !== stage) {
    return Number.NaN;
  }
  const activeRequestId = job.active_stage_request_id || "";
  const activeAttempt = Number(job.advance_attempts || 0);
  const ownedHeartbeat = activeRequestId
    && job.last_heartbeat_stage === stage
    && job.last_heartbeat_request_id === activeRequestId
    && Number(job.last_heartbeat_attempt || 0) === activeAttempt;
  return latestTimestamp(
    ownedHeartbeat ? job.last_heartbeat_at : null,
    job.stage_started_at,
  );
}

async function persistStageHeartbeat(jobId, { stage = "", requestId = "", advanceAttempt = 0, blobSync = null } = {}) {
  const job = get("jobs", jobId);
  if (!job || TERMINAL_JOB_STATES.has(job.status)) return false;
  if (job.status !== "running") return false;
  const attempt = Number(advanceAttempt || job.advance_attempts || 0);
  if (
    requestId
    && (
      job.active_stage_request_id !== requestId
      || (stage && job.current_stage && job.current_stage !== stage)
      || attempt !== Number(job.advance_attempts || 0)
    )
  ) return false;
  const at = nowIso();
  update("jobs", jobId, {
    last_heartbeat_at: at,
    last_heartbeat_stage: stage || job.current_stage || null,
    last_heartbeat_request_id: requestId || job.active_stage_request_id || null,
    last_heartbeat_attempt: attempt,
    ...(blobSync ? { blob_sync: blobSync } : {}),
  });
  if (!SERVERLESS) return true;
  const { BLOB_ENABLED, blobPut } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return true;
  await blobPut(jobHeartbeatPath(jobId, requestId || job.active_stage_request_id), JSON.stringify({
    job_id: jobId,
    stage: stage || job.current_stage || "",
    request_id: requestId || job.active_stage_request_id || "",
    attempt,
    at,
    ...(blobSync ? { blob_sync: blobSync } : {}),
  }), "application/json");
  return true;
}

async function persistStageHandoff(jobId, {
  fromStage,
  toStage = fromStage,
  fromRequestId,
  fromAttempt,
  toRequestId,
  toAttempt,
  reason = "stage_timeout_retry",
  stageRetryCount = null,
}) {
  const job = get("jobs", jobId);
  if (
    !ownsStageLease(job, fromStage, fromRequestId, fromAttempt)
    || !validStageHandoffTransition(fromStage, toStage, fromAttempt, toAttempt, reason)
  ) return false;
  if (!SERVERLESS) return true;
  const { BLOB_ENABLED, blobPut } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return false;
  const handoff = {
    job_id: jobId,
    from_stage: fromStage,
    to_stage: toStage,
    from_request_id: fromRequestId,
    from_attempt: Number(fromAttempt || 0),
    to_request_id: toRequestId,
    to_attempt: Number(toAttempt || 0),
    reason,
    ...(reason === "stage_timeout_retry" && Number.isFinite(Number(stageRetryCount))
      ? { stage_retry_count: Math.max(1, Number(stageRetryCount)) }
      : {}),
    at: nowIso(),
  };
  await blobPut(jobHandoffPath(jobId, fromRequestId, fromAttempt, toRequestId, toAttempt), JSON.stringify(handoff), "application/json");
  console.log("[stage-handoff-write]", jobId, `stage=${fromStage}->${toStage}`, `from=${fromRequestId}`, `to=${toRequestId}`, `attempt=${fromAttempt}->${toAttempt}`);
  return true;
}

async function hasExactStageHandoff(job, fromStage, toStage, fromRequestId, fromAttempt, toRequestId, toAttempt, reason) {
  if (!SERVERLESS || !job?.id || !fromRequestId || !toRequestId) return false;
  if (!validStageHandoffTransition(fromStage, toStage, fromAttempt, toAttempt, reason)) return false;
  const { BLOB_ENABLED, blobGet } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return false;
  const response = await blobGet(jobHandoffPath(job.id, fromRequestId, fromAttempt, toRequestId, toAttempt)).catch(() => null);
  const handoff = response?.ok ? await response.json().catch(() => null) : null;
  const handoffFromStage = handoff?.from_stage || handoff?.stage;
  const handoffToStage = handoff?.to_stage || handoff?.stage;
  const exact = handoff?.job_id === job.id
    && handoffFromStage === fromStage
    && handoffToStage === toStage
    && handoff?.from_request_id === fromRequestId
    && Number(handoff?.from_attempt || 0) === Number(fromAttempt || 0)
    && handoff?.to_request_id === toRequestId
    && Number(handoff?.to_attempt || 0) === Number(toAttempt || 0)
    && handoff?.reason === reason
    && recentIso(handoff?.at, STAGE_ADVANCE_LEASE_MS);
  if (exact) console.log("[stage-handoff-accept]", job.id, `stage=${fromStage}->${toStage}`, `from=${fromRequestId}`, `to=${toRequestId}`, `attempt=${fromAttempt}->${toAttempt}`);
  return exact;
}

// Retry ordinals cannot live only in the mutable coordination record. Public
// Blob CDN lag can return an older body while a signed worker still carries
// the current lease ETag; writing that stale body back would roll the counter
// backward. Same-stage handoffs are immutable, so their distinct source
// attempts are the durable lower bound even for legacy markers that predate
// `stage_retry_count`.
export async function durableStageRetryCount(jobId, stage, fallback = 0) {
  let count = Math.max(0, Number(fallback || 0));
  if (!SERVERLESS || !jobId || !stage) return count;
  const { BLOB_ENABLED, blobGet, blobList } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return count;
  const prefix = `jobs/${jobId}.handoff.`;
  const candidates = await blobList(prefix).catch(() => []);
  const retryAttempts = new Set();
  for (const candidate of candidates) {
    const pathname = String(candidate?.pathname || "").replace(/^\/?sf\//, "");
    if (!pathname.startsWith(prefix) || !pathname.endsWith(".json")) continue;
    const response = await blobGet(pathname).catch(() => null);
    const handoff = response?.ok ? await response.json().catch(() => null) : null;
    if (
      handoff?.job_id !== jobId
      || handoff?.from_stage !== stage
      || handoff?.to_stage !== stage
      || handoff?.reason !== "stage_timeout_retry"
      || !validStageHandoffTransition(
        handoff.from_stage,
        handoff.to_stage,
        handoff.from_attempt,
        handoff.to_attempt,
        handoff.reason,
      )
    ) continue;
    retryAttempts.add(Number(handoff.from_attempt));
    const ordinal = Number(handoff.stage_retry_count || 0);
    if (Number.isFinite(ordinal)) count = Math.max(count, ordinal);
  }
  return Math.max(count, retryAttempts.size);
}

// A completed stage writes its immutable handoff before the mutable job body.
// If the function dies between those writes, recovery has no target request id
// to feed hasExactStageHandoff(). Discover only the one legal successor owned
// by the stale main record; the sidecar remains a fence, never a broad stage
// inference.
async function findOrphanedStageCompletion(job) {
  const fromStage = job?.current_stage || "";
  const toStage = STAGED_STAGE_SUCCESSOR[fromStage];
  const fromRequestId = job?.active_stage_request_id || job?.advance_request_id || "";
  const fromAttempt = Number(job?.advance_attempts || 0);
  if (!SERVERLESS || !job?.id || !toStage || !fromRequestId || !fromAttempt) return null;
  const { BLOB_ENABLED, blobGet, blobList } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return null;
  const prefix = `jobs/${job.id}.handoff.${jobLeasePart(fromRequestId)}.${fromAttempt}.`;
  const candidates = await blobList(prefix).catch(() => []);
  for (const candidate of candidates) {
    const pathname = String(candidate?.pathname || "").replace(/^\/?sf\//, "");
    if (!pathname.startsWith(prefix) || !pathname.endsWith(".json")) continue;
    const response = await blobGet(pathname).catch(() => null);
    const handoff = response?.ok ? await response.json().catch(() => null) : null;
    const exact = handoff?.job_id === job.id
      && handoff?.from_stage === fromStage
      && handoff?.to_stage === toStage
      && handoff?.from_request_id === fromRequestId
      && Number(handoff?.from_attempt || 0) === fromAttempt
      && handoff?.to_request_id
      && Number(handoff?.to_attempt || 0) === fromAttempt + 1
      && handoff?.reason === "stage_completed"
      && recentIso(handoff?.at, STAGE_ADVANCE_LEASE_MS);
    if (exact) {
      console.log("[stage-handoff-orphan-recover]", job.id, `stage=${fromStage}->${toStage}`, `from=${fromRequestId}`, `to=${handoff.to_request_id}`, `attempt=${fromAttempt}->${handoff.to_attempt}`);
      return handoff;
    }
  }
  return null;
}

async function persistStageTerminal(jobId, { stage, requestId, advanceAttempt, terminal }) {
  const job = get("jobs", jobId);
  if (
    !ownsStageLease(job, stage, requestId, advanceAttempt)
    || !TERMINAL_JOB_STATES.has(terminal?.status)
  ) return false;
  if (!SERVERLESS) return true;
  const { BLOB_ENABLED, blobPut } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return false;
  const at = nowIso();
  const payload = {
    job_id: jobId,
    stage,
    request_id: requestId,
    attempt: Number(advanceAttempt || 0),
    at,
    terminal: {
      status: terminal.status,
      current_stage: "job",
      current_phase: terminal.current_phase || (terminal.status === "done" ? "done" : "failed"),
      finished_at: terminal.finished_at || at,
      result: terminal.result ?? null,
      error: terminal.error ?? null,
      error_code: terminal.error_code ?? null,
      retryable: Boolean(terminal.retryable),
      next_stage: null,
      active_stage: null,
      active_stage_request_id: null,
    },
  };
  await blobPut(jobTerminalPath(jobId, requestId, advanceAttempt), JSON.stringify(payload), "application/json");
  console.log(
    "[stage-terminal-write]",
    jobId,
    `stage=${stage}`,
    `req_id=${requestId}`,
    `attempt=${advanceAttempt}`,
    `status=${terminal.status}`,
    `code=${terminal.error_code || ""}`,
    `reason=${String(terminal.error || "").slice(0, 500)}`,
  );
  return true;
}

export function startStageHeartbeat(jobId, options = {}) {
  let inFlight = false;
  let stopped = false;
  const beat = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      await persistStageHeartbeat(jobId, options);
    } catch {
      // A heartbeat write failure must never fail the stage itself.
    } finally {
      inFlight = false;
    }
  };
  const ready = beat();
  const timer = setInterval(beat, STAGE_HEARTBEAT_MS);
  if (typeof timer.unref === "function") timer.unref();
  return {
    ready,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export class JobStageTimeoutError extends Error {
  constructor(stage, timeoutMs) {
    super(`${stage} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    this.name = "JobStageTimeoutError";
    this.code = "stage_timeout";
    this.stage = stage;
    this.retryable = true;
  }
}

export async function withJobStage(jobId, stage, work, timeoutMs = STAGE_TIMEOUT_MS, persistState = persistJobState) {
  emitJob(jobId, { stage, phase: "start", payload: {}, ts: Date.now() });
  await persistState(jobId);
  const controller = new AbortController();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new JobStageTimeoutError(stage, timeoutMs);
          reject(error);
          controller.abort(error);
        }, timeoutMs);
      }),
    ]);
    emitJob(jobId, { stage, phase: "done", payload: {}, ts: Date.now() });
    await persistState(jobId);
    return result;
  } catch (error) {
    emitJob(jobId, { stage, phase: "failed", payload: { code: error.code || "stage_failed", message: error.message }, ts: Date.now() });
    await persistState(jobId);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function jobEvents(jobId) { return jobBus.get(jobId) ?? null; }
function upsertLocalJob(job) {
  if (!job?.id) return null;
  return get("jobs", job.id) ? update("jobs", job.id, job) : insert("jobs", job);
}
function latestTimestamp(...values) {
  const timestamps = values.map((value) => Date.parse(value || "")).filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : NaN;
}
function strongBlobEtag(value = "") {
  return String(value || "").trim().replace(/^W\/(?=")/i, "");
}
const CAS_BLOB_READ_ATTEMPTS = 3;
const CAS_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const casReadOperations = { snapshots_created: 0, snapshots_cleaned: 0, snapshot_cleanup_failed: 0, snapshot_read_failed: 0, retries: 0 };
function casReadLog(event, fields = {}) {
  // Intentionally only operational metadata: never log URLs, tokens, or body.
  console.info("[siteforge-cas-read]", JSON.stringify({ event, ...fields }));
}
function casReadBackoff(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
}
function blobControlHeaders(tokenValue, attempt = 0) {
  const storeId = String(tokenValue || "").split("_")[3] || "";
  return {
    authorization: `Bearer ${tokenValue}`,
    "x-api-version": "12",
    "x-api-blob-request-id": `${storeId}:${Date.now()}:${randomUUID()}`,
    "x-api-blob-request-attempt": String(attempt),
    "x-vercel-blob-store-id": storeId,
  };
}
async function readFreshBlobForConditionalWrite(pathname) {
  const tokenValue = process.env.BLOB_READ_WRITE_TOKEN || "";
  if (!tokenValue) return null;
  const fullPathname = `sf/${String(pathname || "").replace(/^\/+/, "")}`;
  const api = process.env.VERCEL_BLOB_API_URL || "https://vercel.com/api/blob";

  for (let attempt = 0; attempt < CAS_BLOB_READ_ATTEMPTS; attempt += 1) {
    const headUrl = new URL(api);
    headUrl.searchParams.set("url", fullPathname);
    const metadataResponse = await fetch(headUrl, {
      headers: blobControlHeaders(tokenValue, attempt),
      cache: "no-store",
    }).catch(() => null);
    if (metadataResponse?.status === 404) return null;
    if (!metadataResponse?.ok) {
      if (!metadataResponse || CAS_RETRYABLE_STATUS.has(metadataResponse.status)) {
        casReadOperations.retries += 1;
        if (attempt + 1 < CAS_BLOB_READ_ATTEMPTS) await casReadBackoff(attempt);
      }
      continue;
    }
    const metadata = await metadataResponse.json().catch(() => null);
    const sourceUrl = String(metadata?.url || "");
    const sourceEtag = strongBlobEtag(metadata?.etag);
    if (!sourceUrl || !sourceEtag) continue;

    // Private Blob has a supported origin bypass. Public Blob does not: its
    // mutable URL can retain a month-long CDN entry even with random query
    // parameters, so public coordination records use the atomic snapshot path
    // below instead.
    if (sourceUrl.includes(".private.blob.vercel-storage.com/")) {
      const originUrl = new URL(sourceUrl);
      originUrl.searchParams.set("cache", "0");
      const originResponse = await fetch(originUrl, {
        headers: { authorization: `Bearer ${tokenValue}` },
        cache: "no-store",
      }).catch(() => null);
      if (!originResponse?.ok || strongBlobEtag(originResponse.headers.get("etag")) !== sourceEtag) continue;
      return originResponse;
    }
    if (!sourceUrl.includes(".public.blob.vercel-storage.com/")) continue;

    // Vercel's copy ifMatch applies to the source. Copying the current source
    // to a never-before-used pathname therefore gives us an atomic snapshot;
    // that new pathname is read-after-write consistent and cannot hit the
    // stale mutable-object CDN entry. A 412 means HEAD raced a newer writer,
    // so retry from HEAD instead of weakening the ownership fence.
    const snapshotPathname = `${fullPathname.replace(/\.json$/i, "")}.cas-read.${randomUUID()}.json`;
    const copyUrl = new URL(api);
    copyUrl.searchParams.set("pathname", snapshotPathname);
    copyUrl.searchParams.set("fromUrl", sourceUrl);
    const copyResponse = await fetch(copyUrl, {
      method: "PUT",
      headers: {
        ...blobControlHeaders(tokenValue, attempt),
        "x-vercel-blob-access": "public",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "0",
        "x-if-match": sourceEtag,
      },
    }).catch(() => null);
    if (copyResponse?.status === 412) continue;
    if (!copyResponse?.ok) {
      if (!copyResponse || CAS_RETRYABLE_STATUS.has(copyResponse.status)) {
        casReadOperations.retries += 1;
        if (attempt + 1 < CAS_BLOB_READ_ATTEMPTS) await casReadBackoff(attempt);
      }
      continue;
    }
    const copied = await copyResponse.json().catch(() => null);
    const snapshotUrl = String(copied?.url || "");
    if (!snapshotUrl) continue;
    casReadOperations.snapshots_created += 1;
    let result = null;
    let cleanupFailed = false;
    try {
      const snapshotResponse = await fetch(snapshotUrl, { cache: "no-store" }).catch(() => null);
      if (!snapshotResponse?.ok) {
        casReadOperations.snapshot_read_failed += 1;
        if (!snapshotResponse || CAS_RETRYABLE_STATUS.has(snapshotResponse.status)) casReadOperations.retries += 1;
      } else {
        const body = await snapshotResponse.text().catch(() => null);
        if (body === null) {
          casReadOperations.snapshot_read_failed += 1;
        } else {
          const headers = new Headers(snapshotResponse.headers);
          headers.set("etag", sourceEtag);
          headers.delete("content-length");
          result = new Response(body, { status: 200, headers });
        }
      }
    } finally {
      const { blobDeleteUrls } = await import("./blob-store.mjs");
      const cleanup = await blobDeleteUrls([snapshotUrl]);
      if (cleanup?.ok) {
        casReadOperations.snapshots_cleaned += 1;
      } else {
        casReadOperations.snapshot_cleanup_failed += 1;
        cleanupFailed = true;
        casReadLog("snapshot_cleanup_failed", { attempts: Number(cleanup?.attempts || 0), status: Number(cleanup?.status || 0), totals: casReadOperations });
        // Returning a body after unverified cleanup would accept a leaked
        // coordination artifact. Fail closed; the caller stops this pass.
        result = null;
      }
    }
    if (result) return result;
    // One failed bounded cleanup is enough: creating another immutable
    // snapshot would knowingly multiply orphans during the same outage.
    if (cleanupFailed) return null;
    if (attempt + 1 < CAS_BLOB_READ_ATTEMPTS) await casReadBackoff(attempt);
  }
  casReadLog("fresh_read_exhausted", { totals: casReadOperations });
  return null;
}
export async function persistJobState(jobId) {
  const job = get("jobs", jobId);
  if (!job || !SERVERLESS) return job;
  const { BLOB_ENABLED, blobPut } = await import("./blob-store.mjs");
  if (BLOB_ENABLED()) await blobPut(`jobs/${jobId}.json`, JSON.stringify(job), "application/json");
  return job;
}
async function persistJobStateIfMatch(jobId, ifMatch) {
  const job = get("jobs", jobId);
  if (!job || !SERVERLESS) return { ok: true, job, etag: ifMatch || "" };
  const { BLOB_ENABLED, blobPutIfMatch } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return { ok: true, job, etag: ifMatch || "" };
  return blobPutIfMatch(`jobs/${jobId}.json`, JSON.stringify(job), "application/json", ifMatch);
}
export async function getDurableJob(jobId, { forConditionalWrite = false } = {}) {
  const local = get("jobs", jobId);
  if (!SERVERLESS) return local;
  const { BLOB_ENABLED, blobGet, blobPut } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return local;
  const response = forConditionalWrite
    ? await readFreshBlobForConditionalWrite(`jobs/${jobId}.json`).catch(() => null)
    : await blobGet(`jobs/${jobId}.json`).catch(() => null);
  // A CAS caller must never fall back to local or public-CDN state when the
  // origin-consistent read cannot be proven. Failing closed leaves the current
  // durable owner intact and lets the next recovery pass retry safely.
  if (forConditionalWrite && !response?.ok) return null;
  const jobRaw = response?.ok ? await response.text().catch(() => "") : "";
  if (forConditionalWrite && !jobRaw) return null;
  const jobEtag = strongBlobEtag(response?.headers?.get?.("etag"))
    || (jobRaw ? `"fallback-${createHash("sha256").update(jobRaw).digest("hex")}"` : "");
  let job = local;
  if (jobRaw) {
    try {
      job = JSON.parse(jobRaw);
    } catch {
      if (forConditionalWrite) return null;
    }
  }
  if (forConditionalWrite && (!job || typeof job !== "object" || Array.isArray(job))) return null;
  const localAttempt = Number(local?.advance_attempts || 0);
  const remoteAttempt = Number(job?.advance_attempts || 0);
  const remoteQueuedSameLocalOwner = local?.status === "running"
    && job?.status === "queued"
    && local.current_stage === job.current_stage
    // A local worker from the predecessor stage must never win over its
    // durable successor just because the handoff has updated current_stage.
    && local.active_stage === job.current_stage
    && local.active_stage_request_id
    && local.active_stage_request_id === job.advance_request_id
    && localAttempt === remoteAttempt;
  if (!forConditionalWrite && local && job && (localAttempt > remoteAttempt || remoteQueuedSameLocalOwner)) {
    job = {
      ...job,
      ...local,
      stage_payload: job.stage_payload || local.stage_payload,
      ghost_context: job.ghost_context || local.ghost_context,
    };
  }
  // A completed worker can retain its active request ID briefly while the
  // durable handoff has already queued its successor.  On a queued job, the
  // successor lease is authoritative; reading the predecessor heartbeat here
  // would make every status poll revive the old worker and strand the next
  // (often QC) stage indefinitely.
  const activeRequestId = job?.status === "queued"
    ? (job?.advance_request_id || job?.active_stage_request_id || "")
    : (job?.active_stage_request_id || job?.advance_request_id || "");
  const activeAttempt = Number(job?.advance_attempts || 0);
  const [heartbeatResponse, terminalResponse] = activeRequestId
    ? await Promise.all([
      blobGet(jobHeartbeatPath(jobId, activeRequestId)).catch(() => null),
      blobGet(jobTerminalPath(jobId, activeRequestId, activeAttempt)).catch(() => null),
    ])
    : [null, null];
  const stageHeartbeat = heartbeatResponse?.ok ? await heartbeatResponse.json().catch(() => null) : null;
  const stageTerminal = terminalResponse?.ok ? await terminalResponse.json().catch(() => null) : null;
  const stageHeartbeatAt = Date.parse(stageHeartbeat?.at || "");
  const jobHeartbeatAt = Date.parse(job?.last_heartbeat_at || "");
  const heartbeatOwnsLease = stageHeartbeat?.request_id === activeRequestId
    && Number(stageHeartbeat?.attempt || 0) === Number(job?.advance_attempts || 0);
  if (
    job
    && Number.isFinite(stageHeartbeatAt)
    && (!stageHeartbeat.stage || stageHeartbeat.stage === job.current_stage)
    && heartbeatOwnsLease
    && (!Number.isFinite(jobHeartbeatAt) || stageHeartbeatAt >= jobHeartbeatAt)
  ) {
    job = {
      ...job,
      status: "running",
      active_stage: stageHeartbeat.stage || job.current_stage || null,
      active_stage_request_id: activeRequestId || null,
      stage_started_at: job.stage_started_at || stageHeartbeat.at,
      last_heartbeat_at: stageHeartbeat.at,
      last_heartbeat_stage: stageHeartbeat.stage || job.current_stage || null,
      last_heartbeat_request_id: activeRequestId || null,
      last_heartbeat_attempt: activeAttempt,
      ...(stageHeartbeat.blob_sync
        ? { blob_sync: { ...(job.blob_sync || {}), ...stageHeartbeat.blob_sync } }
        : {}),
    };
    console.log("[job-heartbeat-merge]", jobId, `stage=${job.current_stage || ""}`, `req_id=${stageHeartbeat.request_id || ""}`, `at=${stageHeartbeat.at}`);
  }
  const terminalState = stageTerminal?.terminal;
  const terminalOwnsLease = job
    && stageTerminal?.job_id === job.id
    && stageTerminal?.stage === job.current_stage
    && stageTerminal?.request_id === activeRequestId
    && Number(stageTerminal?.attempt || 0) === activeAttempt
    && TERMINAL_JOB_STATES.has(terminalState?.status);
  if (terminalOwnsLease) {
    job = {
      ...job,
      status: terminalState.status,
      current_stage: "job",
      current_phase: terminalState.current_phase || (terminalState.status === "done" ? "done" : "failed"),
      finished_at: terminalState.finished_at || stageTerminal.at,
      result: terminalState.result ?? null,
      error: terminalState.error ?? null,
      error_code: terminalState.error_code ?? null,
      retryable: Boolean(terminalState.retryable),
      next_stage: null,
      active_stage: null,
      active_stage_request_id: null,
      updated_at: stageTerminal.at || terminalState.finished_at || job.updated_at,
    };
    console.log("[job-terminal-merge]", jobId, `stage=${stageTerminal.stage}`, `req_id=${activeRequestId}`, `attempt=${activeAttempt}`, `status=${terminalState.status}`);
  }
  if (job) {
    upsertLocalJob(job);
    if (jobEtag) Object.defineProperty(job, JOB_BLOB_ETAG, { value: jobEtag, configurable: true });
  }
  const heartbeat = latestTimestamp(job?.last_heartbeat_at, job?.last_event_at, job?.updated_at, job?.stage_started_at, job?.advance_requested_at, job?.started_at, job?.created_at);
  if (job && !TERMINAL_JOB_STATES.has(job.status) && Number.isFinite(heartbeat) && Date.now() - heartbeat > JOB_STALE_MS) {
    // Staged jobs have a reclaimable lease. Never terminalize them in a read:
    // the polling/dispatch path must be allowed to queue the same stage on a
    // new worker after a function is killed between heartbeat writes.
    if (job.staged) return job;
    job = {
      ...job,
      status: "timed_out",
      current_phase: "failed",
      error_code: "job_stale_timeout",
      error: `The ${job.current_stage || "generation"} stage stopped before reporting a final result. Nothing was published.`,
      retryable: true,
      finished_at: nowIso(),
      updated_at: nowIso(),
    };
    upsertLocalJob(job);
    await blobPut(`jobs/${jobId}.json`, JSON.stringify(job), "application/json");
  }
  return job;
}
function emitJob(jobId, event) {
  const bus = jobBus.get(jobId);
  const current = get("jobs", jobId);
  const events = bus ? bus.events : [...(current?.events || [])];
  events.push(event);
  update("jobs", jobId, {
    current_stage: event.stage,
    current_phase: event.phase,
    last_event_at: nowIso(),
    events: events.slice(-60),
  });
  if (bus) {
    bus.events = events;
    for (const fn of bus.listeners) { try { fn(event); } catch {} }
  }
}
export function subscribe(jobId, fn) {
  const bus = jobBus.get(jobId);
  if (!bus) return () => {};
  for (const e of bus.events) fn(e);
  bus.listeners.add(fn);
  return () => bus.listeners.delete(fn);
}

async function execute(jobId, work) {
  const bus = jobBus.get(jobId);
  update("jobs", jobId, { status: "running", started_at: nowIso(), current_stage: "queued", current_phase: "done" });
  await persistJobState(jobId);
  onEmit((e) => emitJob(jobId, e)); // concurrency is 1, safe to rebind
  try {
    const result = await work();
    update("jobs", jobId, { status: "done", finished_at: nowIso(), result, events: bus?.events.slice(-60) ?? [] });
    emitJob(jobId, { stage: "job", phase: "done", payload: result, ts: Date.now() });
    await persistJobState(jobId);
    return result;
  } catch (err) {
    const terminalStatus = err.code === "stage_timeout" ? "timed_out" : ["visual_capture_failed", "visual_qc_incomplete"].includes(err.code) ? "blocked" : "failed";
    update("jobs", jobId, { status: terminalStatus, finished_at: nowIso(), error: err.message, error_code: err.code || "generation_failed", retryable: err.retryable !== false, events: bus?.events.slice(-60) ?? [] });
    emitJob(jobId, { stage: "job", phase: "failed", payload: { code: err.code || "generation_failed", message: err.message, retryable: err.retryable !== false }, ts: Date.now() });
    await persistJobState(jobId);
    return null;
  } finally {
    onEmit(null);
    if (bus) bus.done = true;
    const cleanup = () => jobBus.delete(jobId);
    if (!SERVERLESS) setTimeout(cleanup, 10 * 60_000);
  }
}
function enqueue(jobId, work) {
  if (SERVERLESS) return execute(jobId, work); // synchronous per-request execution
  queue = queue.then(() => execute(jobId, work));
  return queue;
}
export function createJob(type, meta = {}, requestedJobId = null) {
  const explicitJobId = typeof requestedJobId === "string" ? requestedJobId.trim() : "";
  if (explicitJobId && !/^job_[A-Za-z0-9_-]{8,196}$/.test(explicitJobId)) {
    const error = new Error("Invalid caller-provided SiteForge job ID");
    error.code = "invalid_job_id";
    error.status = 400;
    throw error;
  }
  const jobId = explicitJobId || id("job");
  if (get("jobs", jobId)) {
    const error = new Error("SiteForge job ID already exists");
    error.code = "job_id_conflict";
    error.status = 409;
    throw error;
  }
  const job = insert("jobs", { correlation_id: jobId, type, status: "queued", current_stage: "queued", current_phase: "waiting", retryable: true, ...meta, id: jobId });
  jobBus.set(job.id, { events: [], listeners: new Set(), done: false });
  return job;
}

function createOrAdoptTryOnJob(meta, {
  jobId = null,
  correlationId = null,
  adoptExistingJob = false,
} = {}) {
  const existing = jobId ? get("jobs", jobId) : null;
  if (!existing) return createJob("try", meta, jobId);
  if (!adoptExistingJob
    || existing.type !== "try"
    || existing.status !== "queued"
    || (correlationId && existing.correlation_id !== correlationId)) {
    const error = new Error("SiteForge job ID already exists");
    error.code = "job_id_conflict";
    error.status = 409;
    throw error;
  }
  const job = update("jobs", existing.id, meta);
  if (!jobBus.has(job.id)) jobBus.set(job.id, { events: [], listeners: new Set(), done: false });
  return job;
}

// ---------- QC ----------
// Minimum-QC policy (owner directive, 2026-07-21): cosmetic visual checks no
// longer block publication. A failed advisory check is recorded honestly —
// pass: true, advisory_failed: true, and its real failure detail prefixed
// "advisory:" — so every scorecard still tells the truth without holding an
// otherwise sellable site. The honesty floor below STAYS blocking: the page
// must render, the hero contract must hold, no internal terms may leak to the
// public surface, AI imagery must be labeled honestly, stock media may never
// pose as customer proof, the site must belong to the RIGHT business, and a
// bare media plane is not a sellable site.
const BLOCKING_QC_FLOOR = new Set([
  "screenshots",
  "hero-layer-count",
  "visual-public-surface-scrub",
  "ai-imagery-labeled",
  "visual-no-fake-proof",
  "release-business-identity-match",
  "media-plane-not-empty",
  "visual-conversion-rail",
  "visual-hero-geometry",
  "visual-composition-fingerprint-batch",
  "visual-rendered-uniqueness-batch",
  "visual-hero-anatomy-batch",
  "visual-hero-architecture-batch",
  "visual-layout-gravity-batch",
  "visual-media-behavior-batch",
  "visual-logo-identity-batch",
  "visual-rendered-media-manifests",
  "visual-service-media-honesty",
  "visual-provenance-restraint",
  "visual-copy-mechanics",
  "visual-gallery-grid-integrity",
  // Error sentinel: the visual QC layer itself failed to run, which means the
  // floor checks above were never evaluated. That is never an advisory state.
  "visual-fidelity",
]);
export const ADVISORY_QC_CHECKS = new Set([
  "release-map-evidence",
  "visual-satellite-map-evidence",
  "visual-address-map-directions",
  "visual-no-fake-ring-map",
  "visual-cinematic-motion",
  "visual-video-playback-contract",
  "visual-hero-anatomy",
  "visual-kitchen-contract",
  "visual-recipe-manifest",
  "visual-assets-manifest",
  "visual-premium-media",
  "visual-source-carry-through",
  "visual-rendered-media",
  "release-template-family-match",
]);
function isAdvisoryQcCheck(name = "") {
  if (BLOCKING_QC_FLOOR.has(name)) return false;
  // Every cosmetic visual-* check is advisory; the floor set above is the
  // explicit, exhaustive list of visual checks that still block.
  return ADVISORY_QC_CHECKS.has(name) || String(name).startsWith("visual-");
}
function applyAdvisoryQcPolicy(results) {
  return results.map((result) => {
    if (result?.pass === true || !isAdvisoryQcCheck(result?.name)) return result;
    return { ...result, pass: true, advisory_failed: true, detail: `advisory: ${result.detail || "check did not verify"}` };
  });
}

export function buildAuthoritativeQcVerdict(primaryResults = [], extensionResults = [], { degraded = false } = {}) {
  const primary = Array.isArray(primaryResults) ? primaryResults : [];
  const extensions = Array.isArray(extensionResults) ? extensionResults : [];
  const seenNames = new Set(primary.map((result) => result?.name).filter(Boolean));
  const missingExtensions = [];
  for (const result of extensions) {
    const name = result?.name;
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    missingExtensions.push(result);
  }
  const merged = applyAdvisoryQcPolicy([...primary, ...missingExtensions]);
  return gradeResults(merged, merged.every((result) => result?.pass === true), degraded);
}

async function runQc(siteDir, batchDir = null, releaseExpectation = null) {
  try {
    const visual = safeVisualChecks(siteDir, batchDir);
    const { results } = await runQualityAudit(siteDir, batchDir, { visualResults: visual });
    const v7 = safeV7Checks(siteDir);
    const release = releaseExpectation ? buildReleaseEvidenceChecks(siteDir, releaseExpectation, visual) : [];
    const extensions = [...v7, ...visual, ...release];
    return buildAuthoritativeQcVerdict(results, extensions);
  } catch (_) {
    // Headless browser unavailable -> honest degraded QC (never silently pass).
    const lite = qcLite(siteDir);
    if (!releaseExpectation) return lite;
    const visual = lite.results.filter((item) => item.name.startsWith("visual-"));
    const release = buildReleaseEvidenceChecks(siteDir, releaseExpectation, visual);
    return buildAuthoritativeQcVerdict(lite.results, release, { degraded: true });
  }
}
function safeV7Checks(siteDir) {
  try { return runV7Checks(siteDir); } catch (e) { return [{ name: "v7-ext", pass: false, detail: `v7 checks errored: ${e.message}` }]; }
}
function safeVisualChecks(siteDir, batchDir = null) {
  try {
    return runVisualFidelityChecks(siteDir, batchDir ? { batchDir, filterCohort: true } : {});
  } catch (e) {
    return [{ name: "visual-fidelity", pass: false, detail: `visual checks errored: ${e.message}` }];
  }
}
function gradeResults(results, exitZero, degraded) {
  const evaluated = results.filter((x) => !x.deferred);
  const failed = evaluated.filter((x) => !x.pass);
  let grade = exitZero && failed.length === 0 ? "A" : failed.length <= 2 ? "B" : failed.length <= 4 ? "C" : "D";
  if (degraded && grade === "A") grade = "B";
  const score = Math.round(((evaluated.length - failed.length) / Math.max(1, evaluated.length)) * 100);
  // Advisory misses never gate, but they stay on the record next to failed.
  const advisory = evaluated.filter((x) => x.advisory_failed === true).map((x) => ({ name: x.name, detail: x.detail }));
  return { grade, score, results, failed: failed.map((f) => ({ name: f.name, detail: f.detail })), advisory, degraded };
}

// Public output needs complete evidence. A deferred browser check is an
// honest diagnostic state, never a publishable visual pass.
export function isPublishableQc(qc, options = {}) {
  if (!qc || qc.degraded || !Array.isArray(qc.results)) return false;
  const screenshots = qc.results.find((result) => result.name === "screenshots");
  const hero = qc.results.find((result) => result.name === "hero-layer-count");
  const visualEvidenceReady = Boolean(
    screenshots?.pass === true && screenshots.deferred !== true &&
    hero?.pass === true && hero.deferred !== true
  );
  if (!visualEvidenceReady) return false;
  if (qc.grade === "A") {
    return qc.results.every((result) => result.pass === true && result.deferred !== true);
  }
  if (options.policy !== PROJECT_PRECERTIFICATION_POLICY || qc.grade !== "B") return false;
  const readiness = qc.results.find((result) => result.name === "grade-a-readiness");
  if (!readiness || readiness.pass !== false || readiness.deferred === true) return false;
  return qc.results.every((result) =>
    result.name === "grade-a-readiness"
      ? result.pass === false && result.deferred !== true
      : result.pass === true && result.deferred !== true);
}

export function publicPreviewQcSummary(qc) {
  const strict = isPublishableQc(qc);
  const policyPublishable = isPublishableQc(qc, { policy: PROJECT_PRECERTIFICATION_POLICY });
  const precertified = policyPublishable && !strict;
  return {
    grade: qc?.grade || null,
    score: qc?.score ?? null,
    degraded: qc?.degraded === true,
    visual: strict || policyPublishable,
    contract: PUBLIC_SURFACE_QC_CONTRACT,
    precertified,
    precertification_policy: precertified ? PROJECT_PRECERTIFICATION_POLICY : null,
  };
}

function schemaTypesFromHtml(html = "") {
  const types = [];
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { types.push(...schemaTypesFromGraph(JSON.parse(match[1]))); } catch {}
  }
  return [...new Set(types)];
}
function qcLite(siteDir) {
  const html = readFileSync(path.join(siteDir, "index.html"), "utf8");
  const ban = readJsonFile(path.join(REPO_ROOT, "copy-voice", "ban-list.json"), []);
  const results = [];
  results.push(checkHeroLayers(new JSDOM(html).window.document));
  const hits = ban.filter((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(html));
  results.push({ name: "copy-ban-list", pass: hits.length === 0, detail: hits.length ? `hits: ${hits.join(", ")}` : "clean" });
  const schemaTypes = schemaTypesFromHtml(html);
  const needLd = ["LocalBusiness", "Service", "FAQPage", "BreadcrumbList"].filter((k) => !schemaTypes.includes(k));
  results.push({ name: "json-ld", pass: needLd.length === 0, detail: needLd.length ? `missing: ${needLd.join(", ")}` : "all present" });
  results.push({ name: "reduced-motion", pass: /prefers-reduced-motion/i.test(html), detail: /prefers-reduced-motion/i.test(html) ? "present" : "missing" });
  results.push({ name: "enrichment-completeness", pass: existsSync(path.join(siteDir, "packet.json")), detail: "packet.json present" });
  results.push({ name: "overflow-320", pass: false, deferred: true, detail: "deferred — headless Chromium unavailable in this environment" });
  results.push({ name: "screenshots", pass: false, deferred: true, detail: "deferred — headless Chromium unavailable in this environment" });
  for (const r of safeV7Checks(siteDir)) results.push(r); // dependency-free, runs everywhere
  for (const r of safeVisualChecks(siteDir)) results.push(r);
  return gradeResults(results, false, true);
}

// ---------- generation ----------
export function startContractBuild(request, options = {}) {
  const run = () => runContractBuild(request, options);
  const pending = queue.then(run, run);
  queue = pending.catch(() => null);
  return pending;
}

async function runContractBuild(request, options) {
  const artifactPublisher = options.artifactPublisher ?? createBuildArtifactPublisher({ env: options.env });
  artifactPublisher.assertAvailable?.();
  const ownsOutDir = !options.outDir;
  const outDir = options.outDir || mkdtempSync(path.join(tmpdir(), "siteforge-contract-"));
  const verticalHistoryStore = options.verticalHistoryStore ?? createVerticalHistoryStore({ env: options.env });
  let published = null;
  let idCalls = 0;
  const runtimeIdFactory = () => {
    idCalls += 1;
    if (idCalls === 1 && options.buildId) return options.buildId;
    if (typeof options.idFactory === "function") return options.idFactory(idCalls);
    return idCalls === 2 ? `prosp_${randomUUID()}` : `build_${randomUUID()}`;
  };
  const visualQc = options.visualQc ?? (({ outDir: directory }) => {
    const checks = runVisualFidelityChecks(directory);
    return checks.length > 0 && checks.every((check) => check.pass === true && check.deferred !== true);
  });
  const provider = createPremierProvider({
    outDir,
    capture: options.capture !== false,
    visualQc,
    previewUrl: async ({ build_id }) => {
      published = await artifactPublisher.publishBundle({ buildId: build_id, outDir });
      return published.preview_url;
    },
    reportUrl: async () => {
      if (!published) throw new Error("Artifact bundle was not published");
      return published.report_url;
    },
  });

  try {
    onEmit(() => {});
    const result = await runBuild(request, {
      providers: {
        store: verticalHistoryStore,
        idFactory: runtimeIdFactory,
        runPremier: provider,
      },
      ...(options.now ? { now: options.now } : {}),
    });
    if (!published || result.build_id !== published.build_id) throw new Error("Published artifact identity mismatch");
    result.preview_url = published.preview_url;
    result.report_url = published.report_url;
    result.outputs = exactPublishedOutputs(result.outputs, published.files);
    result.qc_passed = result.qc_passed === true
      && result.visual_qc_passed === true
      && isHttpArtifactUrl(result.preview_url)
      && isHttpArtifactUrl(result.report_url);
    validateBuildComplete(result);
    return result;
  } finally {
    onEmit(null);
    if (ownsOutDir) rmSync(outDir, { recursive: true, force: true });
  }
}

function exactPublishedOutputs(current, files) {
  const output = { ...(current || {}) };
  const mappings = {
    html_url: "index.html",
    css_url: "site.css",
    og_image_url: "og-1200x630.png",
    manifest_url: "site.webmanifest",
    sitemap_url: "sitemap.xml",
    robots_url: "robots.txt",
    llms_txt_url: "llms.txt",
    screenshot_desktop_url: "screenshots/desktop/full.png",
    screenshot_mobile_url: "screenshots/mobile/full.png",
  };
  for (const [field, relative] of Object.entries(mappings)) {
    if (files[relative]) output[field] = files[relative];
    else delete output[field];
  }
  output.html_url = files["index.html"];
  const favicons = Object.entries(files).filter(([relative]) => /(?:^|\/)(?:favicon|apple-touch-icon)[^/]*$/i.test(relative)).map(([, url]) => url);
  if (favicons.length) output.favicon_urls = favicons;
  else delete output.favicon_urls;
  return output;
}

function isHttpArtifactUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

export function startGeneration({ user, project, profile, assets, options }) {
  const version = get("site_projects", project.id)?.next_version ?? 1;
  update("site_projects", project.id, { next_version: version + 1, status: "generating" });

  const gen = insert("site_generations", {
    project_id: project.id, user_id: user.id, version,
    build_type: options.build_type || "single_page_cinematic",
    hero_family: options.hero_family || null,
    prompt: options.prompt || "", status: "running",
    sections_disabled: options.sections_disabled || [],
    demo: !options.paid_publish,
  });
  const job = createJob("generate", { user_id: user.id, project_id: project.id, generation_id: gen.id });

  const done = enqueue(job.id, async () => {
    const baseSlug = project.slug || kebab(profile.business_name);
    const slug = `${baseSlug}-v${version}`;
    const normalizedLocation = normalizeBusinessLocation({
      city: profile.city,
      state: profile.state,
      address: profile.address,
    });
    const intake = {
      businessName: profile.business_name,
      industry: profile.industry,
      city: normalizedLocation.city,
      state: normalizedLocation.state,
      address: profile.address || undefined,
      latlng: normalizedSourceLatLng(profile.latlng) || undefined,
      google_place_id: profile.google_place_id || profile.place_id || undefined,
      phone: profile.phone || undefined, ownerEmail: user.email,
      currentWebsite: profile.website || undefined,
      services: (profile.services || []).join(", ") || undefined,
    };
    let packet = forgePacket({ intake, slug, hero: options.hero_family, demo: !options.paid_publish });
    if (options.prompt) packet.prompt = options.prompt;
    packet.build_type = options.build_type === "premier_multi_page" ? "multi-page" : "landing";
    packet.toggles = { ...packet.toggles, map: options.sections_disabled?.includes("service-map") ? false : true, ai_chat: Boolean(options.ai_chat), video_prompt: Boolean(options.video_prompt) };
    packet.sections_disabled = options.sections_disabled || [];
    if (profile.gbp_url) { packet.business.gbp_url = profile.gbp_url; packet.toggles.gbp = true; }
    const outDir = siteDirFor(project.id, version);
    mkdirSync(outDir, { recursive: true });
    const hydration = await hydrateDiscoveryMediaAssets(assets, {
      projectId: project.id,
      outDir,
    });
    const buildAssets = hydration.assets;
    try {

      // merge approved user assets with full provenance
      const approvedLogo = buildAssets.find((a) => a.kind === "logo" && a.approved);
      if (approvedLogo) {
        packet.enrichment_sources.logo = { source: "user", confidence: 1, value: approvedLogo.url };
      }
      const photos = approvedPhotoCatalog(buildAssets);
      if (photos.length) packet.media = { catalog: photos };
      const reviews = buildAssets.filter((a) => a.kind === "review" && a.approved);
      if (reviews.length) packet.enrichment_sources.reviews = { source: reviews[0].source || "import", confidence: 0.9, value: reviews.map((r) => r.label).join(" | ") };
      // V7 media engine: uploads, GBP deep import (hours/reviews/latlng/rating), logo choice
      mergeV7Assets(packet, buildAssets);
      applyDiscoveryBrandColors(packet, {
        brand: readJsonFile(path.join(SITES_DIR, project.id, "discovery", "brand.json"), null),
        assets: buildAssets,
      });

      const firecrawlKey = process.env.FIRECRAWL_API_KEY;
      if (packet.business.current_website && firecrawlKey && options.rediscover) {
        await discover(packet, { firecrawlKey, gbpEnabled: !!packet.toggles.gbp, serpEnabled: false });
        await scrape(packet, {
          firecrawlKey,
          mediaDir: path.join(outDir, ".source-media-rediscover"),
        });
      }
      await rescue(packet, { lovableKey: process.env.LOVABLE_API_KEY, outDir });
      mergeEnrichment(packet);
      design(packet);
      if (options.hero_family) packet.hero_family = options.hero_family; // user pin wins over rotation
      if (options.sections_disabled?.length) {
        packet.section_plan = packet.section_plan.filter((s) => !options.sections_disabled.includes(s));
      }
      if (packet.toggles.video_prompt) packet.veo_prompt = buildVeoPrompt(packet);

      await runSiteforgePremierBuild(packet, {
        outDir,
        store: runtimeVerticalHistoryStore(),
        heroFamily: options.hero_family || null,
        sectionsDisabled: options.sections_disabled || [],
      });
    } finally {
      cleanupHydratedDiscoveryMedia(hydration);
      cleanupMirroredMedia(packet);
    }

    wireLeadCapture(outDir, { project: get("site_projects", project.id) || project, publicUrl: process.env.SITEFORGE_PUBLIC_URL });
    const qc = await runQc(outDir, TRY_DIR);

    insert("site_qc_reports", {
      generation_id: gen.id, project_id: project.id, grade: qc.grade, score: qc.score,
      results: qc.results, degraded: Boolean(qc.degraded),
    });
    update("site_generations", gen.id, { status: "done", qc_grade: qc.grade, site_dir: outDir, hero_family: packet.hero_family, finished_at: nowIso() });
    const qcPassed = isPublishableQc(qc, { policy: PROJECT_PRECERTIFICATION_POLICY });
    update("site_projects", project.id, { status: qcPassed ? "preview_ready" : "draft", last_grade: qc.grade, hero_family: packet.hero_family });
    writeDiscoveryPackets(path.join(SITES_DIR, project.id, "discovery"), packet, assets);
    if (SERVERLESS) {
      const { blobUploadDir, BLOB_ENABLED } = await import("./blob-store.mjs");
      if (BLOB_ENABLED()) { await blobUploadDir(outDir, `sites/${project.id}/v${version}`); update("site_generations", gen.id, { blob_prefix: `sites/${project.id}/v${version}` }); }
    }
    audit(user.id, "generation.done", gen.id, { grade: qc.grade, version });
    return { generation_id: gen.id, version, grade: qc.grade, qc_passed: qcPassed, preview: `/preview/${project.id}/${version}/` };
  });
  return { job, gen, done };
}

// ---------- template try-on (public, rate-limited upstream) ----------
function applyLaunchData(packet, source) {
  const launchPhone = String(process.env.SITEFORGE_AGENT_PHONE || source?.launch?.agent_phone || "").trim();
  const launchUrl = String(source?.launch?.purchase_url || "").trim();
  const launchExpiresAt = String(
    source?.launch?.expires_at ||
    source?.launch?.expiresAt ||
    source?.preview_expires_at ||
    source?.previewExpiresAt ||
    "",
  ).trim();
  if (launchUrl || launchPhone || launchExpiresAt) {
    packet.launch = {
      ...(packet.launch || {}),
      purchase_url: launchUrl,
      agent_phone: launchPhone,
      ...(launchExpiresAt ? { expires_at: launchExpiresAt } : {}),
    };
  }
  if (launchExpiresAt) packet.preview_expires_at = launchExpiresAt;
}

function normalizedSourceLatLng(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Reject serialized object members by grammar, not by a finite JSON-LD key
// list. The JSON-looking value guard preserves ordinary labels such as
// "Name: Brand Strategy" while catching both escaped and plain fragments.
const STRUCTURED_SOURCE_FRAGMENT = /^(?:(?:\\+)?["']\s*)?[@\p{L}_$][\p{L}\p{N}_$@.-]*\s*(?:(?:\\+)?["']\s*:|:\s*(?=(?:(?:\\+)?["']|\{|\[|true\b|false\b|null\b|-?\d))|\.{3})/iu;
const STRUCTURED_SOURCE_BLOB = /^(?:\{\s*(?:(?:\\+)?["'][@\p{L}_$][\p{L}\p{N}_$@.-]*(?:\\+)?["']\s*:|\})|\[\s*(?:\{|\[|(?:\\+)?["']|-?\d|true\b|false\b|null\b|\]))/iu;

function isStructuredSourceFragment(value) {
  return STRUCTURED_SOURCE_FRAGMENT.test(value) || STRUCTURED_SOURCE_BLOB.test(value);
}

function stripSerializedSourceTail(value) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\u0000/g, "").trim();
  // Only a backslash-escaped serialization tail is removed. Standalone
  // quotes, brackets, commas, and braces may be legitimate source truth.
  return clean.replace(/\s*\\+(?:["'])?(?:\s*[,}\]])?\s*$/u, "").trim();
}

function stripMarkdownAddressTail(value) {
  const clean = String(value || "").trim();
  const wholeLink = clean.match(/^\[([^\]\r\n]+)\]\(\s*https?:\/\/[^\r\n]*\)?\s*$/iu);
  if (wholeLink) return wholeLink[1].trim();
  return clean
    .replace(/\s+\[[^\]\r\n]*\]\(\s*https?:\/\/[^\r\n]*\)?\s*$/iu, "")
    .replace(/\]\(\s*https?:\/\/[^\r\n]*\)?\s*$/iu, "")
    .trim();
}

function stripPipeAddressTail(value) {
  return String(value || "")
    // Scraped contact bars can flatten address | phone | domain into one
    // identity value. Pipes are not postal-address characters, including
    // Markdown-escaped pipes, so keep only the sourced address segment.
    .replace(/\s*(?:\\+\s*)?\|[\s\S]*$/u, "")
    .trim();
}

function sanitizedSourceAddress(value) {
  const clean = stripPipeAddressTail(
    stripMarkdownAddressTail(stripSerializedSourceTail(value)),
  );
  return clean && !isStructuredSourceFragment(clean) ? clean : "";
}

function sanitizedSourceServices(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set();
  return values.flatMap((item) => {
    if (typeof item !== "string" || isStructuredSourceFragment(item.trim())) return [];
    const clean = stripSerializedSourceTail(item)
      // Intake sources sometimes concatenate locality and service tokens.
      // Restore the word boundary without inventing or dropping source truth.
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, "$1 $2")
      .replace(/\s+/gu, " ")
      .trim();
    if (!clean || isStructuredSourceFragment(clean)) return [];
    const key = clean.toLocaleLowerCase("en-US");
    if (seen.has(key)) return [];
    seen.add(key);
    return [clean];
  });
}

export function sanitizeLiveSourceTruth({ facts = {}, intake = {} } = {}) {
  const sourceFacts = facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {};
  const sourceIntake = intake && typeof intake === "object" && !Array.isArray(intake) ? intake : {};
  const factAddress = sanitizedSourceAddress(sourceFacts.address);
  const intakeAddress = sanitizedSourceAddress(sourceIntake.address);
  const address = factAddress || intakeAddress;
  const factsHaveServices = Object.prototype.hasOwnProperty.call(sourceFacts, "services");
  const intakeHasServices = Object.prototype.hasOwnProperty.call(sourceIntake, "services");
  const factServices = sanitizedSourceServices(sourceFacts.services);
  const intakeServices = sanitizedSourceServices(sourceIntake.services);
  const services = factServices.length ? factServices : intakeServices;
  const cleanFacts = { ...sourceFacts, address };
  const cleanIntake = { ...sourceIntake, address: address || undefined };
  if (factsHaveServices || intakeHasServices) {
    cleanFacts.services = services;
    cleanIntake.services = services.length ? services : undefined;
  }
  return { facts: cleanFacts, intake: cleanIntake, address, services };
}

const US_STATE_CODES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));

function normalizedStateCode(value) {
  const state = String(value || "").trim().toUpperCase();
  return US_STATE_CODES.has(state) ? state : "";
}

function cleanLocationCity(value, state = "") {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  const unique = parts.filter((part, index) =>
    parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index);
  const city = unique.filter((part) => normalizedStateCode(part) !== state).join(", ").replace(/\s+/g, " ").trim();
  if (!city || /^[A-Z]{2}$/i.test(city) || city.toUpperCase() === state) return "";
  return city;
}

function locationFromStreetAddress(value) {
  const address = String(value || "").trim();
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const state = normalizedStateCode(parts[index].match(/\b([A-Z]{2})\b/i)?.[1]);
    const city = cleanLocationCity(parts[index - 1], state);
    if (state && city) return { city, state };
  }
  const compact = address.match(/\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Highway|Ct|Court)\.?\s+([A-Za-z][A-Za-z .'-]{2,40}?)\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
  const state = normalizedStateCode(compact?.[2]);
  return { city: cleanLocationCity(compact?.[1], state), state };
}

export function normalizeBusinessLocation({ city = "", state = "", address = "" } = {}) {
  const fromAddress = locationFromStreetAddress(address);
  const stateCode = normalizedStateCode(state) || fromAddress.state;
  const cityName = cleanLocationCity(city, stateCode) || (fromAddress.state === stateCode ? fromAddress.city : "");
  return { city: cityName, state: stateCode };
}

function normalizedBrandColors(...groups) {
  const values = groups.flatMap((group) => Array.isArray(group) ? group : []);
  return [...new Set(values
    .map((color) => typeof color === "string" ? color.trim() : String(color?.hex || color?.value || "").trim())
    .filter((color) => /^#[\da-f]{6}$/i.test(color))
    .map((color) => color.toUpperCase()))].slice(0, 8);
}

function normalizedBrandFonts(...groups) {
  const values = groups.flatMap((group) => Array.isArray(group) ? group : []);
  const seen = new Set();
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const font = value.trim().replace(/\s+/g, " ");
    if (!font || font.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N} .&+'-]*$/u.test(font)) return [];
    const key = font.toLocaleLowerCase("en-US");
    if (seen.has(key)) return [];
    seen.add(key);
    return [font];
  }).slice(0, 8);
}

export function applyDiscoveryBrandFonts(packet, source = {}) {
  const fonts = normalizedBrandFonts(
    source.fonts,
    source.brand?.fonts,
    source.branding?.fonts,
    source.discovery?.branding?.fonts,
    source.discovery?.found?.fonts,
    source.discovery?.packet?.enrichment_sources?.branding?.value?.fonts,
    source.facts?.branding?.fonts,
    source.facts?.fonts,
    source.compiled?.fonts,
    source.compiled?.branding?.fonts,
  );
  if (!fonts.length) return [];
  packet.brand = { ...(packet.brand || {}), fonts };
  const existingBranding = packet.enrichment_sources?.branding?.value;
  packet.enrichment_sources = {
    ...(packet.enrichment_sources || {}),
    branding: {
      source: "source-intake",
      confidence: 0.9,
      value: {
        ...(existingBranding && typeof existingBranding === "object" ? existingBranding : {}),
        fonts,
      },
    },
  };
  return fonts;
}

export function applyDiscoveryBrandColors(packet, source = {}) {
  const assetColors = (source.assets || [])
    .filter((asset) => asset?.kind === "color" && asset.approved !== false)
    .map((asset) => asset.meta?.value ?? asset.label);
  const colors = normalizedBrandColors(
    source.brand?.colors,
    source.branding?.colors,
    source.discovery?.brand?.colors,
    source.discovery?.branding?.colors,
    source.discovery?.found?.colors,
    source.discovery?.packet?.enrichment_sources?.branding?.value?.colors,
    source.discovery?.packet?.enrichment_sources?.colors?.value,
    source.facts?.branding?.colors,
    source.facts?.colors,
    source.compiled?.brand?.colors,
    source.compiled?.branding?.colors,
    source.compiled?.facts?.branding?.colors,
    assetColors,
  );
  if (!colors.length) return [];
  packet.brand = { ...(packet.brand || {}), colors };
  packet.source = { ...(packet.source || {}), brandColors: colors };
  packet.enrichment_sources = {
    ...(packet.enrichment_sources || {}),
    colors: { source: "discovery", confidence: 0.95, value: colors },
  };
  return colors;
}

export function mergeRenderedGhostTruthPacket(compiled = {}, publicPacket = {}) {
  const base = compiled && typeof compiled === "object" && !Array.isArray(compiled) ? compiled : {};
  const rendered = publicPacket && typeof publicPacket === "object" && !Array.isArray(publicPacket) ? publicPacket : {};
  const heroMedia = rendered.media?.hero && typeof rendered.media.hero === "object"
    ? structuredClone(rendered.media.hero)
    : { selected: null, eligible: [], selection_scope: "renderer-finalists" };
  const renderedLogo = rendered.logo_source && typeof rendered.logo_source === "object"
    ? structuredClone(rendered.logo_source)
    : null;
  const renderedCatalog = Array.isArray(rendered.media?.catalog)
    ? structuredClone(rendered.media.catalog)
    : [];
  const assetIdentityManifest = rendered.asset_identity_manifest
    && typeof rendered.asset_identity_manifest === "object"
    && !Array.isArray(rendered.asset_identity_manifest)
    ? structuredClone(rendered.asset_identity_manifest)
    : null;
  const renderedColors = normalizedBrandColors(
    rendered.enrichment_sources?.colors?.value,
    rendered.enrichment_sources?.branding?.value?.colors,
    rendered.visual_system?.resolved?.brand_colors,
  );
  return {
    ...base,
    rendered_truth: {
      schema: rendered.schema || null,
      renderer: rendered.renderer || null,
      business: rendered.business && typeof rendered.business === "object"
        ? structuredClone(rendered.business)
        : null,
      branding: {
        colors: renderedColors,
      },
      hero_family: rendered.hero_family || null,
      generation_fingerprint: rendered.generation_fingerprint || null,
    },
    rendered_assets: {
      logo_source: renderedLogo,
      catalog: renderedCatalog,
      asset_identity_manifest: assetIdentityManifest,
    },
    hero_media: {
      selected: heroMedia.selected && typeof heroMedia.selected === "object"
        ? heroMedia.selected
        : null,
      eligible: Array.isArray(heroMedia.eligible) ? heroMedia.eligible : [],
      selection_scope: heroMedia.selection_scope === "renderer-finalists"
        ? heroMedia.selection_scope
        : "renderer-finalists",
    },
  };
}

function attachRenderedTruthToGhostJob(jobId, publicPacket) {
  const job = get("jobs", jobId);
  const context = job?.ghost_context;
  if (!context || typeof context !== "object") return null;
  const compiled = mergeRenderedGhostTruthPacket(context.compiled, publicPacket);
  update("jobs", jobId, {
    ghost_context: {
      ...context,
      compiled,
    },
  });
  return compiled;
}

function validHeroFamily(value) {
  return HERO_FAMILIES.some((item) => item.key === value) ? value : null;
}

export function explicitTemplateFamily({ family = null, template = null, source = null } = {}) {
  const candidate = validHeroFamily(template?.hero_family || family);
  if (!candidate) return null;
  if (template?.id || template?.slug) return candidate;
  return source ? null : candidate;
}

export function rendererTrustMarks(sourceAssets = []) {
  return sanitizeSourceAssets((Array.isArray(sourceAssets) ? sourceAssets : []).filter((asset) => asset?.kind === "trust_mark"));
}

export function mergeRendererTrustMarks(existingAssets = [], sourceAssets = []) {
  const preserved = (Array.isArray(existingAssets) ? existingAssets : [])
    .filter((asset) => asset && asset.kind !== "trust_mark");
  const trustMarks = rendererTrustMarks([
    ...(Array.isArray(existingAssets) ? existingAssets : []),
    ...(Array.isArray(sourceAssets) ? sourceAssets : []),
  ]);
  return [...preserved, ...trustMarks];
}

async function prepareTryOnPacket({ family, name, city, state, category, template = null, source = null, compositionSlot = null, previewKey }) {
  const slug = `try-${previewKey}`;
  const sanitizedSource = sanitizeLiveSourceTruth({ facts: source?.facts, intake: source?.intake });
  const rawSourceFacts = sanitizedSource.facts;
  const address = sanitizedSource.address;
  const location = normalizeBusinessLocation({
    city: rawSourceFacts.city || source?.intake?.city || city,
    state: rawSourceFacts.state || source?.intake?.state || state,
    address,
  });
  if (!location.city || !location.state) {
    const error = new Error("A valid city and two-letter state are required; malformed location hints could not be recovered from the supplied address.");
    error.status = 422;
    throw error;
  }
  const sourceFacts = { ...rawSourceFacts, city: location.city, state: location.state, address };
  const pinnedFamily = explicitTemplateFamily({ family, template, source });
  const templateCue = template ? ` Use the ${template.name} source pattern only as a family/style direction (${template.hero_family}); do not copy raw HTML, private project text, screenshots, or unverified claims.` : "";
  const prompt = `Site for ${name} in ${location.city}, ${location.state}. A ${category} business. Warm, plainspoken, professional.${templateCue}`;
  const intake = source?.intake ? {
    ...sanitizedSource.intake,
    city: location.city,
    state: location.state,
    address: address || undefined,
  } : null;
  const packet = intake
    ? forgePacket({ intake, slug, hero: pinnedFamily, demo: true })
    : forgePacket({ prompt, slug, hero: pinnedFamily, demo: true });
  const sourceAssets = [...(source?.assets || source?.discovery?.assets || [])];
  if (source?.files?.length) {
    const { storeUpload, MAX_PHOTOS_PER_UPLOAD } = await import("./media-engine.mjs");
    const uploadProject = { id: `try-${previewKey}` };
    for (const file of source.files.slice(0, MAX_PHOTOS_PER_UPLOAD + 1)) {
      sourceAssets.push(await storeUpload(uploadProject, file, file.field === "logo" ? "logo" : "photo"));
    }
  }
  const sourceLatLng = normalizedSourceLatLng(sourceFacts.latlng);
  const sourcePlaceId = String(sourceFacts.place_id || sourceFacts.placeId || sourceFacts.google_place_id || "").trim();
  packet.business.current_website = sourceFacts.website || source?.input?.sources?.website_url || packet.business.current_website || null;
  packet.business.gbp_url = source?.input?.sources?.gbp_url || source?.discovery?.facts?.gbp_url || null;
  packet.business.city = location.city;
  packet.business.state = location.state;
  if (address) packet.business.address = address;
  if (sourceLatLng) packet.business.latlng = sourceLatLng;
  if (sourcePlaceId) packet.business.place_id = sourcePlaceId;
  if (sourceFacts.phone) packet.business.phone = sourceFacts.phone;
  if (sourceFacts.services?.length) packet.services = sourceFacts.services.slice(0, 10);
  packet.enrichment_sources = packet.enrichment_sources || {};
  if (sourceFacts.phone) packet.enrichment_sources.phone = { source: "source-intake", confidence: 0.9, value: sourceFacts.phone };
  if (sourceFacts.email) packet.enrichment_sources.email = { source: "source-intake", confidence: 0.9, value: sourceFacts.email };
  if (sourceFacts.address) packet.enrichment_sources.address = { source: "source-intake", confidence: 0.85, value: sourceFacts.address };
  if (sourceLatLng) packet.enrichment_sources.latlng = { source: "source-intake", confidence: 0.9, value: sourceLatLng };
  if (sourcePlaceId) {
    packet.enrichment_sources.map_id = { source: "source-intake", confidence: 0.9, value: sourcePlaceId };
    packet.gbp = { ...(packet.gbp || {}), pid: sourcePlaceId };
  }
  if (sourceFacts.copy) packet.enrichment_sources.copy = { source: "source-intake", confidence: 0.8, value: sourceFacts.copy };
  if (sourceFacts.founded) packet.enrichment_sources.years = { source: "site", confidence: 0.8, value: Math.max(1, new Date().getFullYear() - Number(sourceFacts.founded)), founded: Number(sourceFacts.founded) };
  if (Array.isArray(sourceFacts.testimonials) && sourceFacts.testimonials.length && !packet.enrichment_sources.reviews_attributed) {
    packet.enrichment_sources.reviews_attributed = {
      source: "site", confidence: 0.8,
      value: sourceFacts.testimonials.slice(0, 4).map((t) => ({ author: t.author, text: t.text, rating: null, source: "site" })),
    };
  }
  const sourceLogo = sourceAssets.find((asset) => asset.kind === "logo" && isTrustedLogoAsset(asset));
  if (sourceLogo) {
    packet.enrichment_sources.logo = { source: sourceLogo.source || "site", confidence: 0.9, value: sourceLogo.url };
    packet.v7_logo = { url: sourceLogo.url, origin: sourceLogo.origin || "source-intake", proposed: false, local_path: sourceLogo.meta?.local_path || null };
  }
  const sourceMedia = sourceAssets.filter((asset) => ["photo", "video"].includes(asset.kind) && asset.approved !== false && asset.url && !asset.meta?.fallback_to_ambiance);
  if (sourceMedia.length) packet.media = { catalog: sourceMedia.map((asset) => ({
    kind: asset.kind,
    url: asset.url,
    source: asset.origin === "upload" ? "upload" : asset.source || "site",
    role: asset.role || null,
    label: asset.label || null,
    local_path: asset.meta?.local_path || null,
    mime: asset.mime || asset.mime_type || asset.content_type || asset.meta?.mime || asset.meta?.content_type || null,
    generated: asset.generated === true,
    ai_generated: asset.ai_generated === true,
    approved: asset.approved !== false,
    treatment: asset.meta?.treatment || "family-duotone",
    width: asset.width || asset.meta?.width || asset.meta?.dimensions?.width || null,
    height: asset.height || asset.meta?.height || asset.meta?.dimensions?.height || null,
    hero_eligible: asset.hero_eligible !== false,
    proof_eligible: asset.proof_eligible !== false,
    truthful_source: asset.truthful_source !== false,
    meta: { ...(asset.meta || {}) },
  })) };
  // Trust marks are neither the customer's primary logo nor job media. Keep a
  // narrow sanitized copy on the renderer packet so the trust rail can verify
  // page/owner provenance without widening the existing media or logo lanes.
  const mergedAssets = mergeRendererTrustMarks(packet.assets, sourceAssets);
  if (mergedAssets.length) packet.assets = mergedAssets;
  mergeV7Assets(packet, sourceAssets);
  applyDiscoveryBrandColors(packet, { ...source, facts: sourceFacts, assets: sourceAssets });
  applyDiscoveryBrandFonts(packet, { ...source, facts: sourceFacts });
  packet.source_evidence = source?.evidence || [];
  applyLaunchData(packet, source);
  const canonicalPacket = enforceBusinessTruth(packet, { sourceFacts, sourceAssets });
  packet.business = canonicalPacket.business;
  packet.services = canonicalPacket.services;
  packet.media = canonicalPacket.media;
  packet.logo_source = canonicalPacket.logo_source;
  packet.canonical_truth = canonicalPacket.canonical_truth;
  packet.composition_slot = compositionSlot;
  packet.section_plan = null;
  assignPreviewQcCohort(packet, { source, previewKey });
  return { packet, sourceFacts, sourceAssets, pinnedFamily };
}

export function startTryOn({
  family,
  name,
  city,
  state,
  category,
  template = null,
  source = null,
  compositionSlot = null,
  jobId = null,
  correlationId = null,
  ghostContext = null,
  adoptExistingJob = false,
}) {
  const previewKey = privatePreviewKey(name);
  const job = createOrAdoptTryOnJob({
    family,
    name,
    template_id: template?.id || null,
    ...(correlationId ? { correlation_id: correlationId } : {}),
    ...(ghostContext ? { ghost_context: ghostContext } : {}),
  }, { jobId, correlationId, adoptExistingJob });
  const done = enqueue(job.id, async () => {
    const { packet, pinnedFamily } = await prepareTryOnPacket({
      family,
      name,
      city,
      state,
      category,
      template,
      source,
      compositionSlot,
      previewKey,
    });
    const releaseExpectation = {
      business_name: packet.business.name,
      city: packet.business.city || null,
      state: packet.business.state || null,
      source_website: packet.business.current_website || null,
      template_family: pinnedFamily || "auto",
    };
    const outDir = path.join(TRY_DIR, previewKey);
    mkdirSync(outDir, { recursive: true });
    await withJobStage(job.id, "rescue", () => rescue(packet, { lovableKey: null, outDir }));
    mergeEnrichment(packet);
    let captureError = null;
    let runtime = null;
    await withPreviewMediaCleanup(packet, async () => {
      await withJobStage(job.id, "scrape", () => hardenPreviewMedia(packet, { outDir }));
      await withJobStage(job.id, "design", () => design(packet));
      if (pinnedFamily) packet.hero_family = pinnedFamily;
      try {
        runtime = await withJobStage(job.id, "build", () => runSiteforgePremierBuild(packet, {
          outDir,
          store: runtimeVerticalHistoryStore(),
          heroFamily: pinnedFamily,
        }), 150_000);
      } catch (err) {
        if (!existsSync(path.join(outDir, "index.html"))) throw err;
        captureError = err.message;
      }
      persistPreviewQcCohort(outDir, packet);
    });
    if (runtime?.generation_fingerprint) packet.generation_fingerprint = runtime.generation_fingerprint;
    const publicPacket = readJsonFile(path.join(outDir, "packet.json"), {});
    const terminalTruth = attachRenderedTruthToGhostJob(job.id, publicPacket);
    const qc = await withJobStage(job.id, "qc", () => runQc(outDir, TRY_DIR, releaseExpectation), 130_000);
    if (!isPublishableQc(qc, { policy: PROJECT_PRECERTIFICATION_POLICY })) {
      const captureEvent = jobEvents(job.id)?.events?.findLast?.((event) => event.stage === "build" && event.phase === "capture-skipped");
      captureError ||= captureEvent?.payload?.reason || null;
      if (process.env.SITEFORGE_RETAIN_FAILED_BUILDS !== "1") rmSync(outDir, { recursive: true, force: true });
      const error = new Error(captureError
        ? `Visual capture failed: ${captureError}. Nothing was published.`
        : `Quality gate held preview: ${qc.failed.map((item) => item.name).join(", ") || qc.grade}. Nothing was published.`);
      error.code = captureError ? "visual_capture_failed" : "visual_qc_incomplete";
      error.retryable = true;
      throw error;
    }
    // demo guard: noindex + banner marker
    const idx = path.join(outDir, "index.html");
    let html = readFileSync(idx, "utf8");
    if (!/name="robots"/.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="robots" content="noindex, nofollow" />`);
    writeFileSync(idx, html);
    if (SERVERLESS) {
      const { blobUploadDir, BLOB_ENABLED } = await import("./blob-store.mjs");
      if (BLOB_ENABLED()) await blobUploadDir(outDir, `try/${previewKey}`);
    }
    return {
      token: previewKey,
      preview: `/try/${previewKey}/`,
      family: packet.hero_family,
      template_id: template?.id || null,
      generation_fingerprint: packet.generation_fingerprint || null,
      authority_standard: packet.authority_standard || null,
      hero_media: terminalTruth?.hero_media || null,
      release_evidence: releaseEvidenceFromQc(qc),
      qc: publicPreviewQcSummary(qc),
    };
  });
  return { job, token: previewKey, done };
}

export async function startTryOnStaged({
  family,
  name,
  city,
  state,
  category,
  template = null,
  source = null,
  compositionSlot = null,
  jobId = null,
  correlationId = null,
  ghostContext = null,
  adoptExistingJob = false,
}) {
  const previewKey = privatePreviewKey(name);
  const { packet, pinnedFamily } = await prepareTryOnPacket({ family, name, city, state, category, template, source, compositionSlot, previewKey });
  const job = createOrAdoptTryOnJob({
    family: pinnedFamily,
    requested_family: family || null,
    name,
    template_id: template?.id || null,
    staged: true,
    next_stage: "render",
    advance_token: token(18),
    stage_payload: {
      token: previewKey,
      family: pinnedFamily,
      template_id: template?.id || null,
      release_expectation: {
        business_name: packet.business.name,
        city: packet.business.city || null,
        state: packet.business.state || null,
        source_website: packet.business.current_website || null,
        template_family: pinnedFamily || "auto",
      },
      packet,
    },
    ...(correlationId ? { correlation_id: correlationId } : {}),
    ...(ghostContext ? { ghost_context: ghostContext } : {}),
  }, { jobId, correlationId, adoptExistingJob });
  await persistJobState(job.id);
  return { job, token: previewKey, done: Promise.resolve(null), staged: true };
}

const ADVANCE_DELIVERY_ATTEMPTS = Math.max(1, Number(process.env.SITEFORGE_ADVANCE_DELIVERY_ATTEMPTS || 3));
const ADVANCE_DELIVERY_RETRY_MS = Math.max(0, Number(process.env.SITEFORGE_ADVANCE_DELIVERY_RETRY_MS || 250));

async function deferUnacceptedStageDelivery(jobId, {
  stage = "",
  requestId = "",
  advanceAttempt = 0,
  deliveryState = null,
} = {}) {
  const job = await getDurableJob(jobId, { forConditionalWrite: true }).catch(() => null);
  if (
    !job
    || job.status !== "queued"
    || job.current_stage !== stage
    || job.advance_requested_stage !== stage
    || job.advance_request_id !== requestId
    || Number(job.advance_attempts || 0) !== Number(advanceAttempt || 0)
  ) return false;
  const expectedEtag = job[JOB_BLOB_ETAG] || "";
  upsertLocalJob(job);
  update("jobs", jobId, {
    // Make the exact queued owner immediately reclaimable by the next status
    // poll. The immutable handoff remains authoritative; a newer claimant
    // wins the CAS below and cannot be overwritten by this failed delivery.
    advance_requested_at: new Date(Date.now() - STAGE_ADVANCE_LEASE_MS - 1_000).toISOString(),
    last_stage_delivery_deferred: {
      stage,
      status: deliveryState?.lastStatus ?? null,
      loop_detected: Boolean(deliveryState?.loopDetected),
      at: nowIso(),
    },
  });
  const persisted = await persistJobStateIfMatch(jobId, expectedEtag);
  if (persisted.ok) {
    console.warn(
      "[stage-delivery-reclaimable]",
      jobId,
      `stage=${stage}`,
      `req_id=${requestId}`,
      `attempt=${advanceAttempt}`,
      `status=${deliveryState?.lastStatus ?? "network"}`,
    );
  }
  return Boolean(persisted.ok);
}

export async function postDurableJobAdvance(
  jobId,
  baseUrl,
  stage,
  requestId,
  advanceToken,
  advanceAttempt = 0,
  reclaimFromRequestId = "",
  leaseEtag = "",
  awaitDelivery = false,
  deliveryState = null,
) {
  const origin = String(baseUrl || process.env.SITEFORGE_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!origin || !/^https?:\/\//i.test(origin)) return false;
  const observedDeliveryState = deliveryState || {};
  const deliver = async () => {
    const attempts = awaitDelivery ? ADVANCE_DELIVERY_ATTEMPTS : 1;
    for (let deliveryAttempt = 1; deliveryAttempt <= attempts; deliveryAttempt += 1) {
      try {
        const response = await fetch(`${origin}/api/jobs/${encodeURIComponent(jobId)}/advance`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-siteforge-job-token": advanceToken || "",
          },
          body: JSON.stringify({
            stage,
            request_id: requestId,
            advance_attempt: Number(advanceAttempt || 0),
            reclaim_from_request_id: reclaimFromRequestId || "",
            lease_etag: strongBlobEtag(leaseEtag),
          }),
        });
        observedDeliveryState.lastStatus = response.status;
        // /advance executes the claimed stage before responding. A strict QC
        // verdict intentionally returns 422 with terminal=true; that still
        // proves the signed worker accepted and durably finished the handoff.
        const responseBody = await response.clone().json().catch(() => null);
        if (response.ok || responseBody?.terminal === true || responseBody?.already_running === true) return true;
        // Vercel rejects deep same-function request chains with 508 before the
        // successor worker can run. The queued job and immutable handoff are
        // already durable, so let a later top-level status dispatch reclaim it
        // instead of retrying the same rejected nested hop.
        if (response.status === 508) {
          observedDeliveryState.loopDetected = true;
          console.warn(
            "[stage-delivery-deferred]",
            jobId,
            `stage=${stage}`,
            `req_id=${requestId}`,
            "status=508",
          );
          return false;
        }
        console.warn(
          "[stage-delivery-rejected]",
          jobId,
          `stage=${stage}`,
          `req_id=${requestId}`,
          `status=${response.status}`,
          `delivery_attempt=${deliveryAttempt}/${attempts}`,
        );
      } catch (error) {
        console.warn(
          "[stage-delivery-failed]",
          jobId,
          `stage=${stage}`,
          `req_id=${requestId}`,
          `delivery_attempt=${deliveryAttempt}/${attempts}`,
          `error=${String(error?.message || error).slice(0, 240)}`,
        );
      }
      if (deliveryAttempt < attempts && ADVANCE_DELIVERY_RETRY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, ADVANCE_DELIVERY_RETRY_MS * deliveryAttempt));
      }
    }
    return false;
  };
  const run = deliver();
  // Serverless stage handoffs use waitUntil so the current /advance request
  // can return as soon as its own durable handoff is queued. Awaiting the
  // successor's response would keep every predecessor request open across the
  // whole render -> capture -> QC chain and eventually hit Vercel's function
  // timeout. Non-serverless callers still receive the delivery promise.
  if (!awaitDelivery && SERVERLESS && typeof globalThis.__siteforgeWaitUntil === "function") {
    const backgroundDelivery = run.then(async (delivered) => {
      if (!delivered) {
        await deferUnacceptedStageDelivery(jobId, {
          stage,
          requestId,
          advanceAttempt,
          deliveryState: observedDeliveryState,
        });
      }
      return delivered;
    }).catch((error) => {
      // waitUntil promises must always settle cleanly. The signed delivery
      // already has a durable queued owner, so status polling can reclaim it.
      console.warn(
        "[stage-delivery-background-failed]",
        jobId,
        `stage=${stage}`,
        `req_id=${requestId}`,
        `error=${String(error?.message || error).slice(0, 240)}`,
      );
      return false;
    });
    try {
      globalThis.__siteforgeWaitUntil(backgroundDelivery);
      return true;
    } catch (error) {
      // A broken runtime adapter must not orphan the already-started fetch or
      // create an unhandled promise. Fall back to the bounded delivery result.
      console.warn(
        "[stage-delivery-waituntil-failed]",
        jobId,
        `stage=${stage}`,
        `req_id=${requestId}`,
        `error=${String(error?.message || error).slice(0, 240)}`,
      );
      return backgroundDelivery;
    }
  }
  return run;
}

const MAX_ADVANCE_ATTEMPTS = Number(process.env.SITEFORGE_MAX_ADVANCE_ATTEMPTS || 15);
const CAPTURE_STAGE_MAX_RETRIES = Number(process.env.SITEFORGE_CAPTURE_STAGE_MAX_RETRIES || 2);
const CAPTURE_STAGES = new Set(["capture_desktop", "capture_mobile"]);

function isCaptureStage(stage) {
  return CAPTURE_STAGES.has(stage);
}

async function persistCaptureRetryExhausted(jobId, {
  job,
  stage,
  retryCount,
  expectedEtag,
  requestId = "",
  advanceAttempt = 0,
}) {
  if (!job || !isCaptureStage(stage)) return false;
  upsertLocalJob(job);
  const finishedAt = nowIso();
  const terminal = {
    status: "failed",
    current_phase: "failed",
    finished_at: finishedAt,
    error: `The ${stage} stage exhausted its ${CAPTURE_STAGE_MAX_RETRIES} durable capture retries. Nothing was published.`,
    error_code: "capture_retry_exhausted",
    retryable: false,
  };
  const ownerRequestId = requestId
    || (job.status === "running" ? job.active_stage_request_id : job.advance_request_id)
    || "";
  const ownerAttempt = Number(advanceAttempt || job.advance_attempts || 0);
  if (ownsStageLease(get("jobs", jobId), stage, ownerRequestId, ownerAttempt)) {
    await persistStageTerminal(jobId, {
      stage,
      requestId: ownerRequestId,
      advanceAttempt: ownerAttempt,
      terminal,
    }).catch(() => false);
  }
  update("jobs", jobId, {
    ...terminal,
    current_stage: "job",
    next_stage: null,
    stage_retry_counts: {
      ...(job.stage_retry_counts || {}),
      [stage]: Math.max(Number(job.stage_retry_counts?.[stage] || 0), Number(retryCount || 0)),
    },
    ...clearStageLease(),
  });
  const persisted = await persistJobStateIfMatch(jobId, expectedEtag);
  return Boolean(persisted.ok);
}

export async function dispatchDurableJobAdvance(jobId, baseUrl, { awaitDelivery = false } = {}) {
  // Most Ghost polls only observe a healthy lease. Keep that hot path on the
  // ordinary read and pay for an origin-consistent snapshot only when this
  // invocation could actually mutate the coordination record.
  const observedJob = await getDurableJob(jobId);
  if (!observedJob?.staged || TERMINAL_JOB_STATES.has(observedJob.status)) return false;
  if (observedJob.status === "running") {
    const observedLiveness = stageLeaseLiveness(observedJob, observedJob.current_stage);
    if (Number.isFinite(observedLiveness) && Date.now() - observedLiveness < STAGE_ADVANCE_LEASE_MS) return false;
  }
  const observedStage = observedJob.next_stage || observedJob.current_stage || "render";
  const observedRequestedAt = Date.parse(observedJob.advance_requested_at || "");
  if (
    observedJob.advance_requested_stage === observedStage
    && Number.isFinite(observedRequestedAt)
    && Date.now() - observedRequestedAt < STAGE_ADVANCE_LEASE_MS
  ) return false;

  const job = await getDurableJob(jobId, { forConditionalWrite: true });
  if (!job?.staged || TERMINAL_JOB_STATES.has(job.status)) return false;
  const expectedEtag = job[JOB_BLOB_ETAG] || "";
  if (job.status === "running") {
    // A live worker holds the lease via its durable heartbeat. Only requeue a
    // running stage when the worker has stopped beating (crash, OOM, kill).
    const liveness = stageLeaseLiveness(job, job.current_stage);
    if (Number.isFinite(liveness) && Date.now() - liveness < STAGE_ADVANCE_LEASE_MS) return false;
  }
  // A stale predecessor can be left behind after its immutable completion
  // handoff landed but before the main record advanced. The handoff's mobile
  // owner is the only safe reclaim source; enqueue a fresh attempt so neither
  // the old desktop worker nor the orphaned mobile request can claim again.
  const orphanedCompletion = job.status === "running"
    ? await findOrphanedStageCompletion(job)
    : null;
  const recoveredStage = orphanedCompletion?.to_stage || "";
  const recoveredAttempt = Number(orphanedCompletion?.to_attempt || 0);
  const nextAttemptBase = Math.max(Number(job.advance_attempts || 0), recoveredAttempt);
  if (nextAttemptBase >= MAX_ADVANCE_ATTEMPTS) {
    update("jobs", jobId, {
      status: "failed",
      current_phase: "failed",
      error_code: "advance_retry_exhausted",
      error: "The staged build kept retrying without reaching a durable result. Nothing was published.",
      retryable: true,
      finished_at: nowIso(),
      next_stage: null,
      ...clearStageLease(),
    });
    const persisted = await persistJobStateIfMatch(jobId, expectedEtag);
    if (!persisted.ok) return false;
    return false;
  }
  const origin = String(baseUrl || process.env.SITEFORGE_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!origin || !/^https?:\/\//i.test(origin)) return false;
  const stage = recoveredStage || job.next_stage || job.current_stage || "render";
  const requestedAt = Date.parse(job.advance_requested_at || "");
  if (
    job.advance_requested_stage === stage &&
    Number.isFinite(requestedAt) &&
    Date.now() - requestedAt < STAGE_ADVANCE_LEASE_MS
  ) return false;
  const captureRetryCount = isCaptureStage(stage)
    ? await durableStageRetryCount(job.id, stage, job.stage_retry_counts?.[stage])
    : 0;
  // A queued request has not necessarily executed (Vercel can reject a nested
  // delivery with 508), so its current retry ordinal remains runnable. A dead
  // running worker consumed that ordinal; at the cap it must stop rather than
  // minting another owner. Counts above the cap are always corrupt/exhausted.
  const captureRetriesExhausted = isCaptureStage(stage)
    && (
      captureRetryCount > CAPTURE_STAGE_MAX_RETRIES
      || (job.status === "running" && !orphanedCompletion && captureRetryCount >= CAPTURE_STAGE_MAX_RETRIES)
    );
  if (captureRetriesExhausted) {
    await persistCaptureRetryExhausted(jobId, {
      job,
      stage,
      retryCount: captureRetryCount,
      expectedEtag,
    });
    return false;
  }
  const requestId = token(10);
  // A queued successor owns the durable advance lease even when an inherited
  // record still carries its predecessor's active-stage fields. Running jobs
  // continue to prefer the active worker lease.
  const reclaimFromRequestId = orphanedCompletion?.to_request_id || (job.status === "queued"
    ? (job.advance_request_id || job.active_stage_request_id || "")
    : (job.active_stage_request_id || job.advance_request_id || ""));
  upsertLocalJob(job);
  const advanceAttempt = nextAttemptBase + 1;
  let nextCaptureRetryCount = captureRetryCount;
  if (isCaptureStage(stage) && job.status === "running" && !orphanedCompletion) {
    nextCaptureRetryCount += 1;
    const handoffWritten = await persistStageHandoff(jobId, {
      fromStage: stage,
      toStage: stage,
      fromRequestId: job.active_stage_request_id || job.advance_request_id || "",
      fromAttempt: Number(job.advance_attempts || 0),
      toRequestId: requestId,
      toAttempt: advanceAttempt,
      reason: "stage_timeout_retry",
      stageRetryCount: nextCaptureRetryCount,
    }).catch(() => false);
    if (!handoffWritten) return false;
  }
  update("jobs", jobId, {
    status: "queued",
    current_stage: stage,
    current_phase: "waiting",
    next_stage: stage,
    ...clearStageLease(),
    advance_requested_at: nowIso(),
    advance_requested_stage: stage,
    advance_request_id: requestId,
    advance_attempts: advanceAttempt,
    retryable: true,
    ...(isCaptureStage(stage)
      ? {
        stage_retry_counts: {
          ...(job.stage_retry_counts || {}),
          [stage]: nextCaptureRetryCount,
        },
      }
      : {}),
  });
  const persisted = await persistJobStateIfMatch(jobId, expectedEtag);
  if (!persisted.ok) return false;
  return postDurableJobAdvance(
    jobId,
    origin,
    stage,
    requestId,
    job.advance_token || "",
    advanceAttempt,
    reclaimFromRequestId,
    persisted.etag || "",
    awaitDelivery,
  );
}

function recentIso(iso, windowMs) {
  const ts = Date.parse(iso || "");
  return Number.isFinite(ts) && Date.now() - ts < windowMs;
}
function staleStageResult(job, stage, reason) {
  return { ok: true, stale: true, reason, status: job?.status || "unknown", stage };
}
function clearStageLease() {
  return {
    advance_requested_at: null,
    advance_requested_stage: null,
    advance_request_id: null,
    stage_started_at: null,
    active_stage: null,
    active_stage_request_id: null,
    last_heartbeat_at: null,
    last_heartbeat_stage: null,
    last_heartbeat_request_id: null,
    last_heartbeat_attempt: null,
  };
}
function visualCaptureError(message) {
  const error = new Error(message);
  error.code = "visual_capture_failed";
  error.retryable = true;
  return error;
}

export function inlineTerminalQcHandoffPlan({
  serverless = SERVERLESS,
  jobId = "",
  stage = "",
  nextStage = "",
  current = null,
  job = null,
  baseUrl = "",
  nextRequestId = "",
  nextAdvanceAttempt = 0,
  requestId = "",
  expectedJobEtag = "",
} = {}) {
  if (!serverless || stage !== "capture_mobile" || nextStage !== "qc") return null;
  return {
    jobId,
    options: {
      suppliedToken: current?.advance_token || job?.advance_token || "",
      baseUrl,
      requestedStage: nextStage,
      requestId: nextRequestId,
      advanceAttempt: nextAdvanceAttempt,
      reclaimFromRequestId: requestId,
      leaseEtag: expectedJobEtag,
    },
  };
}

export async function executeInlineTerminalQcHandoff(plan, runStage = runDurableTryStage) {
  if (!plan) return null;
  return runStage(plan.jobId, plan.options);
}

function assertScreenshotArtifactsReady(outDir) {
  const required = [
    "screenshots/desktop/hero.png", "screenshots/desktop/mid.png", "screenshots/desktop/footer.png", "screenshots/desktop/full.png",
    "screenshots/mobile/hero.png", "screenshots/mobile/mid.png", "screenshots/mobile/footer.png", "screenshots/mobile/full.png",
  ];
  const missing = [];
  const truncated = [];
  for (const rel of required) {
    const fp = path.join(outDir, rel);
    if (!existsSync(fp)) missing.push(rel);
    else if (readFileSync(fp).length < 1024) truncated.push(rel);
  }
  const manifestPath = path.join(outDir, "screenshots", "manifest.json");
  if (!existsSync(manifestPath)) missing.push("screenshots/manifest.json");
  else {
    const manifest = readJsonFile(manifestPath, null);
    const manifested = new Set((manifest?.files || []).map((entry) => String(entry.path || "").replace(/\\/g, "/")));
    const absent = required.filter((rel) => !manifested.has(rel));
    if (manifest?.schema !== "siteforge-screenshot-manifest-v1") missing.push("screenshots/manifest.json:schema");
    if (absent.length) missing.push(...absent.map((rel) => `manifest:${rel}`));
  }
  if (missing.length || truncated.length) {
    const detail = [missing.length ? `missing ${missing.join(", ")}` : "", truncated.length ? `truncated ${truncated.join(", ")}` : ""].filter(Boolean).join("; ");
    throw visualCaptureError(`Visual capture artifacts are not durable yet: ${detail}. Nothing was published.`);
  }
}

export async function runDurableTryStage(jobId, {
  suppliedToken = "",
  baseUrl = "",
  requestedStage = "",
  requestId = "",
  advanceAttempt = 0,
  reclaimFromRequestId = "",
  leaseEtag = "",
} = {}) {
  const suppliedLeaseEtag = strongBlobEtag(leaseEtag);
  // Signed capture workers are mutators. Read their body from an
  // origin-consistent snapshot whenever the dispatcher supplied the exact
  // lease ETag; a public-CDN body paired with that newer ETag can otherwise
  // pass CAS while rolling durable counters backward.
  let job = await getDurableJob(jobId, {
    forConditionalWrite: Boolean(suppliedLeaseEtag && isCaptureStage(requestedStage)),
  });
  if (!job) {
    const error = new Error("job not found");
    error.status = 404;
    throw error;
  }
  if (!job.staged) {
    const error = new Error("job is not staged");
    error.status = 400;
    throw error;
  }
  if (!suppliedToken || !job.advance_token || suppliedToken !== job.advance_token) {
    const error = new Error("unauthorized job advance");
    error.status = 401;
    throw error;
  }
  if (TERMINAL_JOB_STATES.has(job.status)) return { ok: true, terminal: true, status: job.status };
  // The dispatcher sends the ETag returned by the exact queued CAS write.
  // Prefer it over the public Blob response header, which can briefly lag the
  // just-persisted body behind a CDN weak validator. CAS still rejects delayed
  // or duplicated workers after any newer owner changes the record.
  let expectedJobEtag = suppliedLeaseEtag || job[JOB_BLOB_ETAG] || "";

  const suppliedAdvanceAttempt = Math.max(0, Number(advanceAttempt || 0));
  const authoritativeAdvanceAttempt = Math.max(0, Number(job.advance_attempts || 0));
  const authoritativeStage = job.next_stage || "render";
  // A just-finished stage writes an immutable handoff marker before it
  // persists its successor job record.  A cold function can occasionally
  // read the predecessor record during that very small window.  Treat the
  // exact signed handoff as authoritative for either a running predecessor
  // or that queued predecessor; otherwise the successor is incorrectly
  // rejected as a stage mismatch and the Ghost poll loop never advances.
  const predecessorRequestId = job.status === "running"
    ? job.active_stage_request_id
    : job.advance_request_id;
  const crossStagePredecessorMatches = requestedStage
    && requestedStage !== authoritativeStage
    && job.current_stage === authoritativeStage
    && (job.status === "running" || job.status === "queued")
    && (job.status !== "running" || job.active_stage === authoritativeStage)
    && requestId
    && requestId !== predecessorRequestId
    && reclaimFromRequestId === predecessorRequestId
    && suppliedAdvanceAttempt === authoritativeAdvanceAttempt + 1
    && suppliedAdvanceAttempt <= MAX_ADVANCE_ATTEMPTS;
  const explicitStageCompletion = crossStagePredecessorMatches
    ? await hasExactStageHandoff(
      job,
      authoritativeStage,
      requestedStage,
      predecessorRequestId,
      authoritativeAdvanceAttempt,
      requestId,
      suppliedAdvanceAttempt,
      "stage_completed",
    )
    : false;
  if (requestedStage && requestedStage !== authoritativeStage && !explicitStageCompletion) {
    return staleStageResult(job, authoritativeStage, "stage_mismatch");
  }
  const stage = explicitStageCompletion ? requestedStage : authoritativeStage;
  const liveness = stageLeaseLiveness(job, stage);
  const exactNextAttempt = requestId
    && reclaimFromRequestId
    && suppliedAdvanceAttempt === authoritativeAdvanceAttempt + 1
    && suppliedAdvanceAttempt <= MAX_ADVANCE_ATTEMPTS;
  const staleRunningStage = job.status === "running"
    && job.current_stage === stage
    && (!Number.isFinite(liveness) || Date.now() - liveness >= STAGE_ADVANCE_LEASE_MS);
  const runningPredecessorMatches = job.status === "running"
    && job.current_stage === stage
    && requestId !== job.active_stage_request_id
    && reclaimFromRequestId === job.active_stage_request_id
    && exactNextAttempt;
  const explicitStageHandoff = runningPredecessorMatches
    ? await hasExactStageHandoff(
      job,
      stage,
      stage,
      job.active_stage_request_id,
      authoritativeAdvanceAttempt,
      requestId,
      suppliedAdvanceAttempt,
      "stage_timeout_retry",
    )
    : false;
  const reclaimFromNewerAttempt = explicitStageCompletion
    || (runningPredecessorMatches && (staleRunningStage || explicitStageHandoff));
  const queuedRequestedAt = Date.parse(job.advance_requested_at || "");
  const reclaimQueuedPredecessor = job.status === "queued"
    && job.current_stage === stage
    && requestId !== job.advance_request_id
    && reclaimFromRequestId === job.advance_request_id
    && exactNextAttempt
    && Number.isFinite(queuedRequestedAt)
    && Date.now() - queuedRequestedAt >= STAGE_ADVANCE_LEASE_MS;
  if (job.advance_request_id && requestId && job.advance_request_id !== requestId && !reclaimFromNewerAttempt && !reclaimQueuedPredecessor) {
    return staleStageResult(job, stage, "advance_request_superseded");
  }
  if (!requestId && job.advance_request_id) return staleStageResult(job, stage, "missing_advance_request_id");
  if (job.status !== "running" && authoritativeAdvanceAttempt && suppliedAdvanceAttempt !== authoritativeAdvanceAttempt && !reclaimQueuedPredecessor && !explicitStageCompletion) {
    return staleStageResult(job, stage, "advance_attempt_superseded");
  }
  if (job.status === "running") {
    if (job.current_stage === stage && Number.isFinite(liveness) && Date.now() - liveness < STAGE_ADVANCE_LEASE_MS && !reclaimFromNewerAttempt) {
      return { ok: true, already_running: true, status: "running", stage };
    }
    // A retry may read the pre-requeue Blob record for a few seconds after the
    // dispatcher wrote its new request id. A dead stage is safe to reclaim
    // here because the machine token and requested stage were already checked.
    if (!reclaimFromNewerAttempt) return staleStageResult(job, stage, "stage_already_running");
  }
  const stageRetryCount = isCaptureStage(stage)
    ? await durableStageRetryCount(jobId, stage, job.stage_retry_counts?.[stage])
    : Number(job.stage_retry_counts?.[stage] || 0);
  if (isCaptureStage(stage) && stageRetryCount > CAPTURE_STAGE_MAX_RETRIES) {
    const stopped = await persistCaptureRetryExhausted(jobId, {
      job,
      stage,
      retryCount: stageRetryCount,
      expectedEtag: expectedJobEtag,
    });
    return stopped
      ? { ok: false, terminal: true, status: "failed", error: "capture retry exhausted" }
      : staleStageResult(job, stage, "job_state_conflict");
  }
  const payload = job.stage_payload || {};
  const previewToken = payload.token;
  const outDir = path.join(TRY_DIR, previewToken || job.id);
  const blobPrefix = `try/${previewToken}`;
  const persistOwnedState = async () => {
    const persisted = await persistJobStateIfMatch(jobId, expectedJobEtag);
    if (persisted.ok && persisted.etag) expectedJobEtag = persisted.etag;
    return persisted.ok;
  };
  const persistOwnedStateOrThrow = async () => {
    if (await persistOwnedState()) return;
    const error = new Error("The staged job ownership changed before its state could be saved.");
    error.code = "job_state_conflict";
    error.retryable = true;
    throw error;
  };
  const finishStage = async (nextStage) => {
    const current = get("jobs", jobId) || job;
    const nextRequestId = token(10);
    const nextAdvanceAttempt = Number(current.advance_attempts || 0) + 1;
    const handoffWritten = await persistStageHandoff(jobId, {
      fromStage: stage,
      toStage: nextStage,
      fromRequestId: requestId,
      fromAttempt: Number(current.advance_attempts || 0),
      toRequestId: nextRequestId,
      toAttempt: nextAdvanceAttempt,
      reason: "stage_completed",
    }).catch((handoffError) => {
      console.warn("[stage-handoff-write-failed]", jobId, handoffError?.message || handoffError);
      return false;
    });
    if (!handoffWritten) return staleStageResult(current, stage, "stage_handoff_not_owned");
    update("jobs", jobId, {
      status: "queued",
      current_stage: nextStage,
      current_phase: "waiting",
      next_stage: nextStage,
      retryable: true,
      stage_started_at: null,
      active_stage: null,
      active_stage_request_id: null,
      advance_requested_at: nowIso(),
      advance_requested_stage: nextStage,
      advance_request_id: nextRequestId,
      advance_attempts: nextAdvanceAttempt,
    });
    if (!await persistOwnedState()) return staleStageResult(current, stage, "job_state_conflict");
    const inlineQcHandoff = inlineTerminalQcHandoffPlan({
      jobId,
      stage,
      nextStage,
      current,
      job,
      baseUrl,
      nextRequestId,
      nextAdvanceAttempt,
      requestId,
      expectedJobEtag,
    });
    if (inlineQcHandoff) {
      // Vercel returns 508 INFINITE_LOOP_DETECTED on the fourth nested
      // same-function HTTP invocation (render -> desktop -> mobile -> QC).
      // The queued CAS and immutable handoff are already durable, so enter
      // only the terminal QC stage in-process through the exact same signed
      // token/request/attempt/ETag validator. This removes the recursive HTTP
      // hop without bypassing ownership checks or broadening inline chaining.
      heartbeat?.stop();
      heartbeat = null;
      console.log(
        "[stage-inline-terminal-handoff]",
        jobId,
        `stage=${stage}->${nextStage}`,
        `from=${requestId}`,
        `to=${nextRequestId}`,
        `attempt=${Number(current.advance_attempts || 0)}->${nextAdvanceAttempt}`,
      );
      return executeInlineTerminalQcHandoff(inlineQcHandoff);
    }
    const deliveryState = {};
    const delivered = await postDurableJobAdvance(
      jobId,
      baseUrl,
      nextStage,
      nextRequestId,
      job.advance_token || "",
      nextAdvanceAttempt,
      requestId,
      expectedJobEtag,
      // The immutable handoff and queued CAS are already durable. On Vercel,
      // waitUntil keeps this one signed delivery alive after the current stage
      // responds; awaiting the successor would recursively hold the entire
      // pipeline open until the 300-second function limit.
      false,
      deliveryState,
    );
    if (!delivered && deliveryState.loopDetected) {
      const deferredAt = new Date(Date.now() - STAGE_ADVANCE_LEASE_MS - 1_000).toISOString();
      update("jobs", jobId, {
        advance_requested_at: deferredAt,
        last_stage_delivery_deferred: {
          stage: nextStage,
          status: deliveryState.lastStatus,
          at: nowIso(),
        },
      });
      if (!await persistOwnedState()) {
        const latestDeliveryState = await getDurableJob(jobId);
        return staleStageResult(latestDeliveryState || current, nextStage, "stage_delivery_outcome_changed");
      }
      return {
        ok: true,
        status: "queued",
        stage,
        next_stage: nextStage,
        deferred: true,
        reason: "stage_handoff_deferred",
      };
    }
    if (!delivered) {
      const deliveryTerminal = {
        status: "failed",
        current_phase: "failed",
        finished_at: nowIso(),
        error: `The ${nextStage} stage handoff was not accepted after ${ADVANCE_DELIVERY_ATTEMPTS} delivery attempts. Nothing was published.`,
        error_code: "stage_handoff_delivery_failed",
        retryable: true,
      };
      update("jobs", jobId, { ...deliveryTerminal, current_stage: "job", next_stage: null, ...clearStageLease() });
      emitJob(jobId, { stage: "job", phase: "failed", payload: { code: deliveryTerminal.error_code, message: deliveryTerminal.error, retryable: true }, ts: Date.now() });
      // CAS the visible failure against the queued handoff record. If the
      // request actually reached a worker but its response was lost, that
      // worker's newer claim wins and we must not overwrite its real verdict.
      if (!await persistOwnedState()) {
        const latestDeliveryState = await getDurableJob(jobId);
        return staleStageResult(latestDeliveryState || current, nextStage, "stage_delivery_outcome_changed");
      }
      return { ok: false, terminal: true, status: "failed", stage, next_stage: nextStage, error: deliveryTerminal.error };
    }
    return { ok: true, stage, next_stage: nextStage };
  };

  onEmit((e) => emitJob(jobId, e));
  let heartbeat = null;
  const timedBlobSync = async (direction, work) => {
    const startedAt = Date.now();
    try {
      return await work();
    } catch (error) {
      const wrapped = new Error(`Blob ${direction} failed: ${String(error.message || error).split("\n")[0].slice(0, 250)}`);
      wrapped.name = "BlobSyncError";
      wrapped.code = "blob_sync_failed";
      wrapped.provider_code = error.code || null;
      wrapped.retryable = true;
      wrapped.cause = error;
      throw wrapped;
    } finally {
      const current = get("jobs", jobId);
      const blobSync = { ...(current?.blob_sync || {}), [`${stage}_${direction}_ms`]: Date.now() - startedAt };
      await persistStageHeartbeat(jobId, { stage, requestId, advanceAttempt: Math.max(authoritativeAdvanceAttempt, suppliedAdvanceAttempt), blobSync }).catch(() => {});
    }
  };
  try {
    console.log("[stage-claim]", jobId, `stage=${stage}`, `req_id=${requestId || ""}`, `attempt=${suppliedAdvanceAttempt}`, `reclaimed=${reclaimFromNewerAttempt || reclaimQueuedPredecessor}`, `previous_req=${job.active_stage_request_id || job.advance_request_id || ""}`);
    update("jobs", jobId, {
      status: "running",
      current_stage: stage,
      current_phase: "start",
      retryable: true,
      ...clearStageLease(),
      stage_started_at: nowIso(),
      last_heartbeat_at: nowIso(),
      last_heartbeat_stage: stage,
      last_heartbeat_request_id: requestId || null,
      last_heartbeat_attempt: Math.max(authoritativeAdvanceAttempt, suppliedAdvanceAttempt),
      active_stage: stage,
      active_stage_request_id: requestId || null,
      advance_attempts: Math.max(authoritativeAdvanceAttempt, suppliedAdvanceAttempt),
      ...(isCaptureStage(stage)
        ? {
          stage_retry_counts: {
            ...(job.stage_retry_counts || {}),
            [stage]: stageRetryCount,
          },
        }
        : {}),
    });
    if (!await persistOwnedState()) return staleStageResult(job, stage, "job_state_conflict");
    heartbeat = startStageHeartbeat(jobId, { stage, requestId, advanceAttempt: Math.max(authoritativeAdvanceAttempt, suppliedAdvanceAttempt) });
    await heartbeat.ready;
    if (stage === "render") {
      const packet = payload.packet;
      if (!packet) throw new Error("staged packet missing");
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      await withJobStage(jobId, "render", async () => {
        await rescue(packet, { lovableKey: null, outDir });
        mergeEnrichment(packet);
        await hardenPreviewMedia(packet, { outDir });
        try {
          design(packet);
          if (payload.family && payload.family !== "auto") packet.hero_family = payload.family;
          // Premier runtime: snowflake slot picker + vertical-history
          // anti-repetition + generation fingerprint (wow-catalog wiring).
          const runtime = await runSiteforgePremierBuild(packet, {
            outDir,
            capture: false,
            store: runtimeVerticalHistoryStore(),
            heroFamily: payload.family && payload.family !== "auto" ? payload.family : null,
          });
          if (runtime?.generation_fingerprint) packet.generation_fingerprint = runtime.generation_fingerprint;
          persistPreviewQcCohort(outDir, packet);
        } finally {
          cleanupMirroredMedia(packet);
        }
      }, 110_000, persistOwnedStateOrThrow);
      attachRenderedTruthToGhostJob(jobId, readJsonFile(path.join(outDir, "packet.json"), {}));
      update("jobs", jobId, { stage_payload: { ...payload, packet } });
      const { blobUploadDir, BLOB_ENABLED } = await import("./blob-store.mjs");
      if (BLOB_ENABLED()) await timedBlobSync("upload", () => blobUploadDir(outDir, blobPrefix));
      return finishStage("capture_desktop");
    }
    const { blobDownloadDir, blobUploadDir, BLOB_ENABLED } = await import("./blob-store.mjs");
    if (BLOB_ENABLED()) await timedBlobSync("download", () => blobDownloadDir(blobPrefix, outDir));
    if (stage === "capture_desktop" || stage === "capture_mobile" || stage === "qc") {
      // Pay the cold Chromium pack download outside the bounded stage timer;
      // the durable heartbeat keeps the job alive while it runs. QC launches
      // Chromium for strict hero geometry, so it needs the same cold-start
      // boundary as the two screenshot stages.
      const { prewarmChromium } = await import("../../factory/lib/chromium-runtime.mjs");
      await prewarmChromium().catch(() => {});
    }
    if (stage === "capture_desktop") {
      // 260s budget, not the previous 200s: the Vercel function itself has a
      // 300s maxDuration (vercel.json), so this internal watchdog needs real
      // headroom under that hard ceiling. At 200s, a capture that was merely
      // slow (not stuck) could still be running when the watchdog fired,
      // aborting mid-operation and racing browser.close() against an
      // in-flight Playwright call on the same page.
      await withJobStage(
        jobId,
        "capture_desktop",
        (signal) => captureScreenshotsForViewport(outDir, "desktop", { signal }),
        260_000,
        persistOwnedStateOrThrow,
      );
      if (BLOB_ENABLED()) await timedBlobSync("upload", () => blobUploadDir(outDir, blobPrefix));
      return finishStage("capture_mobile");
    }
    if (stage === "capture_mobile") {
      await withJobStage(jobId, "capture_mobile", async (signal) => {
        await captureScreenshotsForViewport(outDir, "mobile", { signal });
        finalizeScreenshotManifest(outDir);
      }, 260_000, persistOwnedStateOrThrow);
      if (BLOB_ENABLED()) await timedBlobSync("upload", () => blobUploadDir(outDir, blobPrefix));
      return finishStage("qc");
    }
    if (stage === "qc") {
      assertScreenshotArtifactsReady(outDir);
      const qc = await withJobStage(jobId, "qc", () => runQc(outDir, TRY_DIR, payload.release_expectation), 130_000, persistOwnedStateOrThrow);
      if (!isPublishableQc(qc, { policy: PROJECT_PRECERTIFICATION_POLICY })) {
      // Keep the public response terse, but preserve the concrete geometry
      // evidence in the controlled terminal record/log.  A bare check name
      // makes a renderer failure impossible to repair without guessing.
      const failedSummary = qc.failed
        .slice(0, 3)
        .map((item) => `${item.name}${item.detail ? ` (${String(item.detail).slice(0, 320)})` : ""}`)
        .join(", ") || qc.grade;
      const error = new Error(`Quality gate held preview: ${failedSummary}. Nothing was published.`);
        error.code = "visual_qc_incomplete";
        error.retryable = true;
        throw error;
      }
      const idx = path.join(outDir, "index.html");
      let html = readFileSync(idx, "utf8");
      if (!/name="robots"/.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="robots" content="noindex, nofollow" />`);
      writeFileSync(idx, html);
      if (BLOB_ENABLED()) await timedBlobSync("upload", () => blobUploadDir(outDir, blobPrefix));
      const packet = readJsonFile(path.join(outDir, "packet.json"), {});
      const terminalTruth = attachRenderedTruthToGhostJob(jobId, packet);
      // Durable first-party screenshot URLs so downstream consumers (Ghost
      // outreach thumbnails) never depend on third-party thumbnailers.
      const { blobPublicUrl } = await import("./blob-store.mjs");
      const screenshots = BLOB_ENABLED() && blobPublicUrl(`${blobPrefix}/screenshots/desktop/hero.png`)
        ? {
          desktop_hero: blobPublicUrl(`${blobPrefix}/screenshots/desktop/hero.png`),
          desktop_full: blobPublicUrl(`${blobPrefix}/screenshots/desktop/full.png`),
          mobile_hero: blobPublicUrl(`${blobPrefix}/screenshots/mobile/hero.png`),
          manifest: blobPublicUrl(`${blobPrefix}/screenshots/manifest.json`),
        }
        : null;
      const result = {
        token: previewToken,
        preview: `/try/${previewToken}/`,
        family: packet.hero_family || payload.family,
        template_id: payload.template_id || null,
        generation_fingerprint: packet.generation_fingerprint || null,
        authority_standard: packet.authority_standard || null,
        hero_media: terminalTruth?.hero_media || null,
        screenshots,
        release_evidence: releaseEvidenceFromQc(qc),
        qc: publicPreviewQcSummary(qc),
      };
      const doneTerminal = {
        status: "done",
        current_phase: "done",
        finished_at: nowIso(),
        result,
        retryable: false,
      };
      const terminalWritten = await persistStageTerminal(jobId, {
        stage,
        requestId,
        advanceAttempt: Number((get("jobs", jobId) || job).advance_attempts || 0),
        terminal: doneTerminal,
      }).catch((terminalError) => {
        console.warn("[stage-terminal-write-failed]", jobId, terminalError?.message || terminalError);
        return false;
      });
      if (!terminalWritten) return staleStageResult(get("jobs", jobId) || job, stage, "stage_terminal_not_owned");
      update("jobs", jobId, { ...doneTerminal, current_stage: "job", next_stage: null, ...clearStageLease() });
      emitJob(jobId, { stage: "job", phase: "done", payload: result, ts: Date.now() });
      if (!await persistOwnedState()) return staleStageResult(get("jobs", jobId) || job, stage, "job_state_conflict");
      // T15 (voice-site-edit-loop, ghost repo): mirror this build's outDir
      // into ghost's wss-site-sources/<prospect_id>/ bucket so the prospect
      // becomes voice-editable. Only for jobs dispatched by ghost-agency
      // (ghost_context carries the prospect it built for) — never for
      // SiteForge's own public /try users. Runs strictly AFTER the terminal
      // "done" state above is durably committed, so a slow, misconfigured,
      // or failing archive can never affect the build result itself.
      const ghostProspectId = String(job?.ghost_context?.prospect?.prospect_id || "").trim();
      if (ghostProspectId) {
        try {
          const { archiveSiteSourceToGhost } = await import("./ghost-source-archive.mjs");
          const archive = await archiveSiteSourceToGhost({ siteSlug: ghostProspectId, dir: outDir });
          if (!archive.skipped && !archive.ok) {
            console.warn("[ghost-source-archive]", jobId, ghostProspectId, JSON.stringify(archive.errors || []).slice(0, 500));
          }
        } catch (archiveError) {
          console.warn("[ghost-source-archive-failed]", jobId, ghostProspectId, archiveError?.message || archiveError);
        }
      }
      return { ok: true, terminal: true, status: "done", result };
    }
    throw new Error(`Unknown staged job stage: ${stage}`);
  } catch (err) {
    const deterministicVerdict = err.code === "visual_qc_incomplete";
    const transientStageFailure = err.code === "stage_timeout"
      || err.code === "visual_capture_failed"
      || err.code === "capture_lazy_media_incomplete"
      || err.code === "blob_sync_failed";
    const requireOriginState = Boolean(transientStageFailure && suppliedLeaseEtag);
    const latest = await getDurableJob(jobId, { forConditionalWrite: requireOriginState });
    if (requireOriginState && !latest) {
      return staleStageResult(job, stage, "job_state_conflict");
    }
    if (requireOriginState && latest?.[JOB_BLOB_ETAG]) expectedJobEtag = latest[JOB_BLOB_ETAG];
    if (latest && TERMINAL_JOB_STATES.has(latest.status) && latest.finished_at) {
      return { ok: latest.status === "done", terminal: true, status: latest.status, result: latest.result || null, error: latest.error || null };
    }
    if (err.code === "job_state_conflict") return staleStageResult(latest || job, stage, "job_state_conflict");
    // Deterministic gate verdicts (QC held the preview, capture artifacts
    // invalid) must always reach the durable record — deferring to a newer
    // claim here previously meant every run's identical verdict was ignored
    // and the job only died later by watchdog stale-timeout.
    if (!deterministicVerdict && latest?.active_stage_request_id && requestId && latest.active_stage_request_id !== requestId) {
      return staleStageResult(latest, stage, "stale_failure_ignored");
    }
    // Stage timeouts and capture failures are transient (cold instance, CPU
    // starvation, slow media): requeue the same stage — the retry usually
    // lands on a warm instance — until the shared advance-attempts cap
    // converts persistent failures to terminal. QC verdicts stay terminal.
    if (transientStageFailure && !deterministicVerdict) {
      const currentJob = latest || get("jobs", jobId) || job;
      const attempts = Number(currentJob.advance_attempts || 0);
      const stageRetryCounts = { ...(currentJob.stage_retry_counts || {}) };
      const stageRetryCount = isCaptureStage(stage)
        ? await durableStageRetryCount(jobId, stage, stageRetryCounts[stage])
        : Number(stageRetryCounts[stage] || 0);
      const stageRetryLimit = isCaptureStage(stage)
        ? CAPTURE_STAGE_MAX_RETRIES
        : MAX_ADVANCE_ATTEMPTS;
      if (attempts < MAX_ADVANCE_ATTEMPTS && stageRetryCount < stageRetryLimit) {
        const retryError = {
          stage,
          code: err.code || "generation_failed",
          message: String(err.message || err).split("\n")[0].slice(0, 300),
          at: nowIso(),
        };
        console.warn("[stage-retry]", jobId, `stage=${stage}`, `code=${retryError.code}`, `error=${retryError.message}`);
        const retryRequestId = token(10);
        const retryAdvanceAttempt = attempts + 1;
        const nextStageRetryCount = stageRetryCount + 1;
        const handoffWritten = await persistStageHandoff(jobId, {
          fromStage: stage,
          toStage: stage,
          fromRequestId: requestId || latest?.active_stage_request_id || "",
          fromAttempt: attempts,
          toRequestId: retryRequestId,
          toAttempt: retryAdvanceAttempt,
          stageRetryCount: nextStageRetryCount,
        }).catch((handoffError) => {
          console.warn("[stage-handoff-write-failed]", jobId, handoffError?.message || handoffError);
          return false;
        });
        if (!handoffWritten) return staleStageResult(latest || job, stage, "stage_handoff_not_owned");
        update("jobs", jobId, {
          status: "queued",
          current_stage: stage,
          current_phase: "waiting",
          next_stage: stage,
          retryable: true,
          ...clearStageLease(),
          advance_requested_at: nowIso(),
          advance_requested_stage: stage,
          advance_request_id: retryRequestId,
          advance_attempts: retryAdvanceAttempt,
          last_stage_timeout: { stage, at: nowIso() },
          last_stage_error: retryError,
          stage_retry_counts: { ...stageRetryCounts, [stage]: nextStageRetryCount },
        });
        if (!await persistOwnedState()) return staleStageResult(latest || job, stage, "job_state_conflict");
        const retryDeliveryState = {};
        await postDurableJobAdvance(
          jobId,
          baseUrl,
          stage,
          retryRequestId,
          job.advance_token || "",
          retryAdvanceAttempt,
          requestId || latest?.active_stage_request_id || "",
          expectedJobEtag,
          // A retry is already fenced by its immutable same-stage handoff and
          // queued CAS. Let waitUntil own the one signed successor delivery so
          // a stage that just consumed most of the function budget can return
          // before the retry worker itself finishes.
          false,
          retryDeliveryState,
        );
        if (retryDeliveryState.loopDetected) {
          update("jobs", jobId, {
            advance_requested_at: new Date(Date.now() - STAGE_ADVANCE_LEASE_MS - 1_000).toISOString(),
            last_stage_delivery_deferred: {
              stage,
              status: retryDeliveryState.lastStatus,
              at: nowIso(),
            },
          });
          if (!await persistOwnedState()) {
            const latestRetryState = await getDurableJob(jobId);
            return staleStageResult(latestRetryState || latest || job, stage, "stage_delivery_outcome_changed");
          }
        }
        return { ok: true, retrying: true, status: "queued", stage, reason: "stage_timeout_retry" };
      }
      if (isCaptureStage(stage) && stageRetryCount >= stageRetryLimit) {
        const lastError = {
          stage,
          code: err.code || "generation_failed",
          message: String(err.message || err).split("\n")[0].slice(0, 300),
          at: nowIso(),
        };
        update("jobs", jobId, {
          last_stage_error: lastError,
          stage_retry_counts: { ...stageRetryCounts, [stage]: stageRetryCount },
        });
        const exhausted = new Error(`The ${stage} stage exhausted its ${stageRetryLimit} durable capture retries. Nothing was published.`);
        exhausted.code = "capture_retry_exhausted";
        exhausted.retryable = false;
        err = exhausted;
      }
    }
    const terminalStatus = err.code === "stage_timeout" ? "timed_out" : deterministicVerdict ? "blocked" : "failed";
    const failedTerminal = {
      status: terminalStatus,
      current_phase: "failed",
      finished_at: nowIso(),
      error: err.message,
      error_code: err.code || "generation_failed",
      retryable: err.retryable !== false,
    };
    const terminalWritten = await persistStageTerminal(jobId, {
      stage,
      requestId,
      advanceAttempt: Number((get("jobs", jobId) || job).advance_attempts || 0),
      terminal: failedTerminal,
    }).catch((terminalError) => {
      console.warn("[stage-terminal-write-failed]", jobId, terminalError?.message || terminalError);
      return false;
    });
    if (!terminalWritten) return staleStageResult(latest || job, stage, "stage_terminal_not_owned");
    update("jobs", jobId, { ...failedTerminal, current_stage: "job", next_stage: null, ...clearStageLease() });
    emitJob(jobId, { stage: "job", phase: "failed", payload: { code: err.code || "generation_failed", message: err.message, retryable: err.retryable !== false }, ts: Date.now() });
    if (!await persistOwnedState()) return staleStageResult(latest || job, stage, "job_state_conflict");
    return { ok: false, terminal: true, status: terminalStatus, error: err.message };
  } finally {
    heartbeat?.stop();
    onEmit(null);
  }
}

// ---------- prompt-to-website (public front door) ----------
const FAMILY_HINTS = [
  [/pool|spa|hot tub/, "service-map-pins"],
  [/roof|hvac|plumb|electric|landscap|lawn|construct|contractor|clean|pest|garage|fence|concrete|paint/, "service-map-pins"],
  [/law|attorney|legal|account|consult|financ|insur|real estate|realtor|mortgage/, "split-editorial-index"],
  [/restaurant|cafe|coffee|bar|food|bak|salon|barber|spa|nail|fitness|gym|yoga|dental|dentist|med|clinic|chiro/, "magazine-owner-letter"],
  [/photo|design|studio|art|portfolio|media|film|video|music|brand/, "cinematic-video-parallax"],
];
export function stripUnsupportedReviewClaims(text, { verified = false } = {}) {
  const value = String(text || "");
  if (verified) return value;
  return value
    .replace(/(?:^|\s)(?:we are|we're|rated|with)?\s*(?:a\s*)?\d(?:\.\d)?[- ]star(?: rated)?[^.!?]*(?:google\s+)?reviews?[^.!?]*[.!?]?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function extractFacts(text) {
  const t = String(text || "").trim();
  let state = null, city = null, name = null, category = null;
  const states = t.match(/\b([A-Z]{2})\b/g);
  if (states) state = states[states.length - 1];
  let cm = t.match(/\bin\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s*,?\s*[A-Z]{2}\b/);
  if (!cm) cm = t.match(/([A-Za-z][A-Za-z .'-]{1,40}?)\s*,\s*[A-Z]{2}\b/);
  if (cm) city = cm[1].trim();
  name = t.split(/[,\-\u2014|]|\bin\b/)[0].trim().replace(/^(the|a|an)\s+/i, "");
  if (name.length > 60) name = name.slice(0, 60);
  const cats = [
    ["pool|spa|hot tub", "pool service"],
    ["roof", "roofing"],
    ["plumb", "plumbing"],
    ["hvac|heating|air condition", "HVAC"],
    ["electric", "electrical"],
    ["landscap|lawn|garden", "landscaping"],
    ["clean|maid|janitor", "cleaning"],
    ["dent", "dental"],
    ["law|attorney|legal", "legal services"],
    ["salon|hair|barber|nail", "salon"],
    ["restaurant|cafe|coffee|bakery|food", "restaurant"],
    ["fitness|gym|yoga|pilates", "fitness"],
    ["photo", "photography"],
    ["real estate|realtor", "real estate"],
    ["pest", "pest control"],
    ["auto|mechanic|car repair", "auto repair"],
  ];
  const low = t.toLowerCase();
  for (const [k, v] of cats) if (new RegExp(k).test(low)) { category = v; break; }
  return { name, city, state, category: category || "local service" };
}
function pickFamily(text) {
  const t = String(text || "").toLowerCase();
  for (const [re, fam] of FAMILY_HINTS) if (re.test(t)) return fam;
  return "split-editorial-index";
}
// Forge a public preview from a free-text description (and optional website URL).
// No structured form required — this is the prompt-to-website path.
export function startForgeFromText({ text, website = null, family = null }) {
  const clean = stripUnsupportedReviewClaims(text);
  if (clean.length < 3 && !website) { const e = new Error("Tell us a little about your business."); e.status = 400; throw e; }
  const pinnedFamily = validHeroFamily(family);
  const fam = pinnedFamily || pickFamily(clean);
  const previewKey = privatePreviewKey(clean || "site");
  const slug = `try-${previewKey}`;
  const job = createJob("try", { family: fam, prompt: clean.slice(0, 80) });
  const done = enqueue(job.id, async () => {
    const f = extractFacts(clean);
    const loc = [f.city, f.state].filter(Boolean).join(", ");
    const who = f.name || "the business";
    // Reformat into the forge's expected "Site for X in City, ST" shape (so it can read
    // name + location), and KEEP the owner's own words so the forge reads the trade itself.
    const prompt = `Site for ${who}${loc ? ` in ${loc}` : ""}. ${clean}. Warm, plainspoken, professional.${website ? ` Their current website is ${website}.` : ""}`;
    const packet = forgePacket({ prompt, slug, hero: pinnedFamily, demo: true });
    packet.section_plan = null;
    assignPreviewQcCohort(packet, { previewKey });
    const outDir = path.join(TRY_DIR, previewKey);
    mkdirSync(outDir, { recursive: true });
    await rescue(packet, { lovableKey: null, outDir });
    mergeEnrichment(packet);
    await hardenPreviewMedia(packet, { outDir });
    try {
      design(packet);
      if (pinnedFamily) packet.hero_family = pinnedFamily;
      await runSiteforgePremierBuild(packet, { outDir, store: runtimeVerticalHistoryStore(), heroFamily: pinnedFamily });
      persistPreviewQcCohort(outDir, packet);
    } finally {
      cleanupMirroredMedia(packet);
    }
    const qc = await runQc(outDir, TRY_DIR);
    if (!isPublishableQc(qc, { policy: PROJECT_PRECERTIFICATION_POLICY })) {
      rmSync(outDir, { recursive: true, force: true });
      throw new Error(`Quality gate held preview: ${qc.failed.map((item) => item.name).join(", ") || qc.grade}`);
    }
    const idx = path.join(outDir, "index.html");
    let html = readFileSync(idx, "utf8");
    if (!/name="robots"/.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="robots" content="noindex, nofollow" />`);
    writeFileSync(idx, html);
    if (SERVERLESS) {
      const { blobUploadDir, BLOB_ENABLED } = await import("./blob-store.mjs");
      if (BLOB_ENABLED()) await blobUploadDir(outDir, `try/${previewKey}`);
    }
    return {
      token: previewKey,
      preview: `/try/${previewKey}/`,
      family: packet.hero_family,
      qc: publicPreviewQcSummary(qc),
    };
  });
  return { job, token: previewKey, done };
}

// ---------- publish ----------
export async function publishLocally(project, generation) {
  const dest = path.join(PUBLISHED_DIR, project.slug);
  rmSync(dest, { recursive: true, force: true });
  cpSync(generation.site_dir, dest, { recursive: true });
  if (SERVERLESS) {
    const { blobUploadDir, BLOB_ENABLED } = await import("./blob-store.mjs");
    if (BLOB_ENABLED()) await blobUploadDir(dest, `published/${project.slug}`);
  }
  return { url: `/sites/${project.slug}/`, dir: dest };
}

const VERCEL_API = "https://api.vercel.com";
const VERCEL_DEPLOYMENT_TIMEOUT_MS = 3 * 60 * 1000;
const VERCEL_POLL_INTERVAL_MS = 2 * 1000;

function releaseError(message) {
  return new Error(`Customer Vercel publish blocked: ${message}`);
}

function configuredDuration(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseJson(response) {
  try { return await response.json(); } catch { return {}; }
}

function deploymentUrl(deployment) {
  if (!deployment?.url || typeof deployment.url !== "string") {
    throw releaseError("Vercel did not return a public deployment URL.");
  }
  return `https://${deployment.url.replace(/^https:\/\//, "").replace(/\/$/, "")}`;
}

export async function pollVercelDeployment({ deploymentId, teamId, token, fetchImpl = fetch, timeoutMs = VERCEL_DEPLOYMENT_TIMEOUT_MS, intervalMs = VERCEL_POLL_INTERVAL_MS, sleepImpl = sleep }) {
  const deadline = Date.now() + timeoutMs;
  let lastState = "UNKNOWN";
  while (true) {
    const response = await fetchImpl(`${VERCEL_API}/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(teamId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const deployment = await responseJson(response);
    if (!response.ok) throw releaseError(deployment.error?.message || `Vercel deployment polling returned HTTP ${response.status}.`);

    lastState = String(deployment.readyState || deployment.state || "UNKNOWN").toUpperCase();
    if (lastState === "READY") return deployment;
    if (["ERROR", "CANCELED", "FAILED"].includes(lastState)) {
      throw releaseError(`Vercel deployment ${deploymentId} ended in ${lastState}.`);
    }
    if (Date.now() >= deadline) {
      throw releaseError(`Vercel deployment ${deploymentId} timed out while ${lastState}.`);
    }
    await sleepImpl(intervalMs);
  }
}

export async function verifyPublicPublishArtifacts({ url, fetchImpl = fetch, timeoutMs = VERCEL_DEPLOYMENT_TIMEOUT_MS, intervalMs = VERCEL_POLL_INTERVAL_MS, sleepImpl = sleep }) {
  const artifacts = [new URL("/", url).href, new URL("qc-report.html", `${url}/`).href];
  const deadline = Date.now() + timeoutMs;
  let failedArtifact = artifacts[0];
  let failedStatus = "unreachable";
  while (true) {
    let allReachable = true;
    for (const artifact of artifacts) {
      try {
        const response = await fetchImpl(artifact, { redirect: "follow" });
        if (!response.ok) {
          allReachable = false;
          failedArtifact = artifact;
          failedStatus = `HTTP ${response.status}`;
          break;
        }
      } catch (error) {
        allReachable = false;
        failedArtifact = artifact;
        failedStatus = error.message || "network error";
        break;
      }
    }
    if (allReachable) return { preview_url: artifacts[0], report_url: artifacts[1] };
    if (Date.now() >= deadline) {
      throw releaseError(`public artifact is not reachable (${failedStatus}): ${failedArtifact}`);
    }
    await sleepImpl(intervalMs);
  }
}

export async function publishToVercel(project, generation) {
  // VERCEL_* names are reserved on Vercel itself; SITEFORGE_VERCEL_* works everywhere.
  const vtoken = process.env.SITEFORGE_VERCEL_TOKEN || process.env.VERCEL_TOKEN;
  const teamId = process.env.SITEFORGE_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID;
  if (!vtoken || !teamId) throw releaseError("VERCEL_TOKEN / VERCEL_TEAM_ID is not configured.");
  const dir = generation.site_dir;
  const { readdirSync, statSync } = await import("node:fs");
  if (!existsSync(path.join(dir, "index.html"))) throw releaseError("site preview artifact index.html is missing.");
  if (!existsSync(path.join(dir, "qc-report.html"))) throw releaseError("site report artifact qc-report.html is missing.");
  const files = [];
  const walk = (d, base = "") => {
    for (const name of readdirSync(d)) {
      if (name === "packet.json" || name === "qc-report.json" || name === "veo_prompt.json") continue;
      const fp = path.join(d, name);
      const rel = base ? `${base}/${name}` : name;
      const st = statSync(fp);
      if (st.isDirectory()) walk(fp, rel);
      else if (st.isFile()) files.push({ file: rel, data: readFileSync(fp), size: st.size });
    }
  };
  walk(dir);
  const manifest = [];
  for (const file of files) {
    const sha = createHash("sha1").update(file.data).digest("hex");
    const upload = await fetch(`${VERCEL_API}/v2/files?teamId=${encodeURIComponent(teamId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vtoken}`,
        "x-vercel-digest": sha,
        "Content-Length": String(file.size),
        "Content-Type": "application/octet-stream",
      },
      body: file.data,
    });
    if (!upload.ok && upload.status !== 409) {
      const detail = await responseJson(upload);
      throw releaseError(`asset upload failed for ${file.file}: ${detail.error?.message || `HTTP ${upload.status}`}.`);
    }
    manifest.push({ file: file.file, sha, size: file.size });
  }
  const r = await fetch(`${VERCEL_API}/v13/deployments?teamId=${encodeURIComponent(teamId)}`, {
    method: "POST", headers: { Authorization: `Bearer ${vtoken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `siteforge-${project.slug}`.slice(0, 52), files: manifest, projectSettings: { framework: null }, target: "production" }),
  });
  const data = await responseJson(r);
  if (!r.ok) throw releaseError(data.error?.message || `Vercel deployment creation returned HTTP ${r.status}.`);
  if (!data.id) throw releaseError("Vercel did not return a deployment id.");
  const readyDeployment = await pollVercelDeployment({
    deploymentId: data.id,
    teamId,
    token: vtoken,
    timeoutMs: configuredDuration("SITEFORGE_VERCEL_DEPLOYMENT_TIMEOUT_MS", VERCEL_DEPLOYMENT_TIMEOUT_MS),
    intervalMs: configuredDuration("SITEFORGE_VERCEL_POLL_INTERVAL_MS", VERCEL_POLL_INTERVAL_MS),
  });
  const url = deploymentUrl({ ...data, ...readyDeployment });
  const artifacts = await verifyPublicPublishArtifacts({
    url,
    timeoutMs: configuredDuration("SITEFORGE_VERCEL_ARTIFACT_TIMEOUT_MS", VERCEL_DEPLOYMENT_TIMEOUT_MS),
    intervalMs: configuredDuration("SITEFORGE_VERCEL_POLL_INTERVAL_MS", VERCEL_POLL_INTERVAL_MS),
  });
  await fetch(`${VERCEL_API}/v9/projects/${`siteforge-${project.slug}`.slice(0, 52)}?teamId=${encodeURIComponent(teamId)}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${vtoken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ssoProtection: null }),
  }).catch(() => {});
  return { skipped: false, url, deployment_id: data.id, preview_url: artifacts.preview_url, report_url: artifacts.report_url };
}
