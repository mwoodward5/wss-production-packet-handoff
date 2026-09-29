// B8 local-only proof harness.
// Usage: node scripts/b8-verify-sameness.mjs
//
// The harness deliberately has no output-path or deploy options. Every derived
// packet, mirrored source image, rendered preview, screenshot, and proof report
// is written beneath a fresh operating-system temp directory.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryStore } from "../factory/lib/vertical-history.mjs";
import { onEmit } from "../factory/lib/emit.mjs";
import { runSiteforgePremierBuild } from "../factory/lib/siteforge-premier-provider.mjs";
import {
  assignPreviewQcCohort,
  hardenPreviewMedia,
  persistPreviewQcCohort,
} from "../app/lib/engine-adapter.mjs";
import { scrape } from "../factory/pipeline/02-scrape.mjs";
import { rescue } from "../factory/pipeline/03-rescue.mjs";
import { design } from "../factory/pipeline/04-design.mjs";
import {
  auditBatchDistinctness,
  checkBrandPaletteUse,
  checkGeoIntegrity,
  checkGradeAReadiness,
  checkMediaDepth,
  runQualityAudit,
} from "../qc-audit/qc.mjs";
import { runVisualFidelityChecks } from "../qc-audit/qc-visual-fidelity.mjs";

const BATCH_ID = "b8-same-trade-landscaping-v1";
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const MIN_REAL_PHOTOS = 6;
const REQUIRED_VISUAL_CHECKS = Object.freeze([
  "visual-public-surface-scrub",
  "visual-no-fake-proof",
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
]);
const HARD_VISUAL_GATE_NAMES = Object.freeze([
  "visual-conversion-rail",
  "visual-hero-anatomy-batch",
  "visual-hero-architecture-batch",
]);
const PHOTO_EXTENSIONS = /\.(?:gif|jpe?g|png|webp)$/i;
const CENSUS_GEOCODER_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";
const COORDINATE_TOLERANCE = 1e-8;
const EXPECTED_SCREENSHOTS = Object.freeze([
  "screenshots/desktop/hero.png",
  "screenshots/desktop/mid.png",
  "screenshots/desktop/footer.png",
  "screenshots/desktop/full.png",
  "screenshots/mobile/hero.png",
  "screenshots/mobile/mid.png",
  "screenshots/mobile/footer.png",
  "screenshots/mobile/full.png",
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const LANDSCAPE_CONNECTION_PHOTOS = Object.freeze([
  "https://www.landscapedesignfresno.com/wp-content/uploads/2019/10/custom-7.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2019/10/custom-6.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2019/10/custom-10.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/04/residential-CLOVIS-3b.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/04/artificial-turf-header-FRESNO-4.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2020/04/Slider1-1.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/03/img_5273-MADERA.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/03/CLOVIS-7.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/04/artificial-turf-SANGER-2.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/04/artificial-turf-MADERA-4.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/04/residential-heather-jones-FRESNO.jpg",
  "https://www.landscapedesignfresno.com/wp-content/uploads/2025/04/residential-CLOVIS-9.jpg",
]);

const SIGNATURE_LANDSCAPE_PHOTOS = Object.freeze([
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-1.jpg",
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-2.jpg",
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-3.jpg",
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-4.jpg",
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-5.jpg",
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-6.jpg",
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-8.jpg",
  "https://27986b7e.delivery.rocketcdn.me/wp-content/uploads/2024/01/Mission-Viejo-Signature-Landscape-Gallery-9.jpg",
]);

const RICHARD_DIAZ_PHOTOS = Object.freeze([
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/custom-landscape-design-67f02b67e57ac.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s1.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s2-67f0258ed6d4d.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s3-67f0256fedb4a.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s4-67f0258c58c74.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s5-67f0258902f73.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s6.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s7.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s8-67f025764d091-scaled.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s9-67f02588351c9.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s10-67f0257f38e7b.webp",
  "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s11-67f02573dbae4.webp",
]);

const PROSPECTS = Object.freeze([
  {
    packetFile: "wss-ca-landscape-landscape-connection-inc.json",
    slug: "b8-landscape-connection-inc",
    name: "Landscape Connection, Inc.",
    category: "landscaping",
    city: "Clovis",
    state: "CA",
    address: "8889 N Thompson Ave, Clovis, CA 93619",
    lat: 36.864767416983,
    lng: -119.620746682928,
    brand: {
      primary: "#008000",
      secondary: "#935734",
      accent: "#87be49",
    },
    photoHosts: ["www.landscapedesignfresno.com"],
    photos: LANDSCAPE_CONNECTION_PHOTOS,
  },
  {
    packetFile: "wss-ca-landscape-signature-landscape.json",
    slug: "b8-signature-landscape",
    name: "Signature Landscape",
    category: "landscaping",
    city: "Mission Viejo",
    state: "CA",
    address: "25862 Jamon Ln, Mission Viejo, CA 92691",
    lat: 33.586520990725,
    lng: -117.665384967618,
    brand: {
      primary: "#5e5e5e",
      secondary: "#0074db",
      accent: "#002768",
    },
    photoHosts: ["27986b7e.delivery.rocketcdn.me"],
    photos: SIGNATURE_LANDSCAPE_PHOTOS,
  },
  {
    packetFile: "wss-ca-landscape-richard-diaz-landscape.json",
    slug: "b8-richard-diaz-landscape",
    name: "Richard Diaz Landscape",
    category: "landscaping",
    city: "Orange",
    state: "CA",
    address: "633 N Heatherstone Dr, Orange, CA 92869",
    lat: 33.797488131242,
    lng: -117.810364459325,
    brand: {
      primary: "#f6821f",
      secondary: "#fbad41",
      accent: "#efe2cf",
    },
    photoHosts: ["richarddiazlandscaping.com"],
    photos: RICHARD_DIAZ_PHOTOS,
  },
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function assertTempOnly(outputRoot) {
  const tempRoot = path.resolve(tmpdir());
  invariant(isPathInside(tempRoot, outputRoot), `proof output escaped OS temp: ${outputRoot}`);
  invariant(!isPathInside(REPO_ROOT, outputRoot), `proof output entered repository: ${outputRoot}`);
}

function safeWriteJson(outputRoot, target, value) {
  invariant(isPathInside(outputRoot, target), `refusing write outside proof root: ${target}`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value, null, 2));
}

function readJson(target) {
  return JSON.parse(readFileSync(target, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(target) {
  return sha256(readFileSync(target));
}

function normalizedAddress(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function verifyCensusLocation(packet, spec) {
  const address = String(packet.business?.address || "").trim();
  invariant(address, `${spec.slug}: packet address is missing before Census verification`);
  const requestUrl = new URL(CENSUS_GEOCODER_ENDPOINT);
  requestUrl.searchParams.set("address", address);
  requestUrl.searchParams.set("benchmark", CENSUS_BENCHMARK);
  requestUrl.searchParams.set("format", "json");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("US Census Geocoder request timed out")),
    20_000,
  );
  let payload;
  try {
    const response = await fetch(requestUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    invariant(response.ok, `${spec.slug}: Census Geocoder returned HTTP ${response.status}`);
    payload = await response.json();
  } catch (error) {
    throw new Error(`${spec.slug}: Census Geocoder verification failed: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }

  const inputAddress = payload?.result?.input?.address?.address;
  const benchmark = payload?.result?.input?.benchmark?.benchmarkName;
  const matches = Array.isArray(payload?.result?.addressMatches)
    ? payload.result.addressMatches
    : [];
  const addressKey = normalizedAddress(address);
  const exactMatches = matches.filter(
    (match) => normalizedAddress(match?.matchedAddress) === addressKey,
  );
  invariant(
    normalizedAddress(inputAddress) === addressKey,
    `${spec.slug}: Census echoed a different input address`,
  );
  invariant(
    benchmark === CENSUS_BENCHMARK,
    `${spec.slug}: Census used unexpected benchmark ${benchmark || "missing"}`,
  );
  invariant(matches.length === 1, `${spec.slug}: Census returned ${matches.length} address matches`);
  invariant(
    exactMatches.length === 1,
    `${spec.slug}: Census did not return exactly one normalized exact address match`,
  );

  const match = exactMatches[0];
  const lng = Number(match?.coordinates?.x);
  const lat = Number(match?.coordinates?.y);
  invariant(Number.isFinite(lat) && Number.isFinite(lng), `${spec.slug}: Census coordinates are invalid`);
  invariant(
    Math.abs(lat - spec.lat) <= COORDINATE_TOLERANCE
      && Math.abs(lng - spec.lng) <= COORDINATE_TOLERANCE,
    `${spec.slug}: injected coordinates do not match live Census x/y`,
  );

  const verifiedAt = new Date().toISOString();
  packet.enrichment_sources.latlng = {
    source: "US Census Geocoder live exact address match",
    source_url: requestUrl.href,
    benchmark,
    confidence: 1,
    verified_at: verifiedAt,
    matched_address: match.matchedAddress,
    value: { lat, lng },
  };
  return {
    endpoint: CENSUS_GEOCODER_ENDPOINT,
    benchmark,
    input_address: address,
    matched_address: match.matchedAddress,
    coordinates: { lat, lng },
    injected_coordinates: { lat: spec.lat, lng: spec.lng },
    tolerance_degrees: COORDINATE_TOLERANCE,
    verified_at: verifiedAt,
  };
}

function validatePhotoSources(spec) {
  invariant(spec.photos.length >= MIN_REAL_PHOTOS, `${spec.slug}: fewer than ${MIN_REAL_PHOTOS} source photo URLs`);
  invariant(new Set(spec.photos).size === spec.photos.length, `${spec.slug}: duplicate source photo URL`);
  for (const source of spec.photos) {
    const url = new URL(source);
    invariant(url.protocol === "https:", `${spec.slug}: non-HTTPS photo URL`);
    invariant(spec.photoHosts.includes(url.hostname.toLowerCase()), `${spec.slug}: non-first-party photo host ${url.hostname}`);
  }
}

function normalizeSourceHours(fact) {
  if (!Array.isArray(fact?.value)) return fact;
  const value = fact.value.map((item) => {
    if (item && typeof item === "object" && item.day && item.hours) return item;
    const [day, ...hours] = String(item || "").split(":");
    return {
      day: day.trim(),
      hours: hours.join(":").trim(),
    };
  }).filter((item) => item.day && item.hours);
  return value.length ? { ...fact, value } : null;
}

function loadDerivedPacket(spec) {
  validatePhotoSources(spec);
  const sourcePath = path.join(REPO_ROOT, "packets", spec.packetFile);
  const packet = readJson(sourcePath);
  invariant(packet.business?.name === spec.name, `${spec.slug}: source packet business mismatch`);
  invariant(/landscap/i.test(packet.business?.category || ""), `${spec.slug}: source packet is not landscaping`);

  packet.slug = spec.slug;
  packet.batch_id = BATCH_ID;
  packet.build_type = "single-page-cinematic";
  packet.forge = {
    ...(packet.forge || {}),
    demo: true,
    batch_id: BATCH_ID,
  };
  packet.toggles = {
    ...(packet.toggles || {}),
    firecrawl: false,
    gbp: false,
    local_serp: false,
    video_prompt: false,
    map: true,
  };
  packet.business = {
    ...packet.business,
    name: spec.name,
    category: spec.category,
    city: spec.city,
    state: spec.state,
    address: spec.address,
    latlng: {
      lat: spec.lat,
      lng: spec.lng,
    },
  };
  packet.enrichment_sources = {
    ...(packet.enrichment_sources || {}),
    address: {
      source: "source-packet",
      confidence: 0.99,
      value: spec.address,
    },
    colors: {
      source: "business-site",
      confidence: 0.99,
      value: {
        ...spec.brand,
      },
    },
  };
  delete packet.enrichment_sources.latlng;
  const normalizedHours = normalizeSourceHours(packet.enrichment_sources.hours);
  if (normalizedHours) packet.enrichment_sources.hours = normalizedHours;
  else delete packet.enrichment_sources.hours;

  const branding = packet.enrichment_sources.branding || {};
  packet.enrichment_sources.branding = {
    ...branding,
    source: "business-site",
    confidence: 0.99,
    value: {
      ...(branding.value || {}),
      colors: {
        ...spec.brand,
      },
      images: Object.fromEntries(
        spec.photos.map((url, index) => [
          `proof_${String(index + 1).padStart(2, "0")}`,
          {
            url,
            source: "business-site",
            role: `portfolio-${index + 1}`,
          },
        ]),
      ),
    },
  };
  packet.media = {
    ...(packet.media || {}),
    catalog: [],
  };
  return packet;
}

function verifiedMirroredPhotos(packet, mirrorDir) {
  const photos = [];
  for (const item of packet.media?.catalog || []) {
    if (item.kind !== "photo" || item.proof_eligible === false || !item.local_path) continue;
    const localPath = path.resolve(item.local_path);
    invariant(isPathInside(mirrorDir, localPath), `${packet.slug}: mirrored photo escaped its temp directory`);
    invariant(existsSync(localPath), `${packet.slug}: mirrored photo is missing`);
    const dimensions = item.meta?.dimensions || {};
    const width = Number(item.width || dimensions.width || 0);
    const height = Number(item.height || dimensions.height || 0);
    invariant(width >= 640 && height >= 320 && width * height >= 300_000, `${packet.slug}: undersized mirrored photo`);
    const checksum = String(item.meta?.checksum_sha256 || "");
    invariant(/^[a-f0-9]{64}$/i.test(checksum), `${packet.slug}: mirrored photo has no SHA-256`);
    invariant(sha256File(localPath) === checksum, `${packet.slug}: mirrored photo checksum mismatch`);
    photos.push({
      localPath,
      checksum,
      width,
      height,
      perceptualHash: item.meta?.perceptual_hash || null,
    });
  }
  const uniqueChecksums = new Set(photos.map((photo) => photo.checksum));
  invariant(uniqueChecksums.size === photos.length, `${packet.slug}: duplicate mirrored photo bytes survived ingestion`);
  invariant(photos.length >= MIN_REAL_PHOTOS, `${packet.slug}: only ${photos.length} eligible mirrored photos`);
  return photos;
}

function assertCrossSitePhotoUniqueness(builds) {
  const uses = new Map();
  for (const build of builds) {
    for (const photo of build.photos) {
      if (!uses.has(photo.checksum)) uses.set(photo.checksum, []);
      uses.get(photo.checksum).push(build.slug);
    }
  }
  const collisions = [...uses.entries()].filter(([, slugs]) => new Set(slugs).size > 1);
  invariant(collisions.length === 0, `cross-site source image collision: ${collisions.map(([hash, slugs]) => `${hash.slice(0, 12)}:${slugs.join(",")}`).join(";")}`);
}

function normalizedArtifactPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function assertPng(target, label) {
  invariant(existsSync(target), `${label}: PNG is missing`);
  const bytes = readFileSync(target);
  invariant(bytes.length >= 1024, `${label}: PNG is smaller than 1024 bytes`);
  invariant(
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    `${label}: file does not have a PNG signature`,
  );
  return bytes;
}

function validateMapEvidence(slug, evidence, label) {
  invariant(evidence?.pass === true, `${slug}: ${label} did not pass`);
  invariant(evidence.response_ok === true, `${slug}: ${label} has no successful provider response`);
  invariant(evidence.geometry_ok === true, `${slug}: ${label} geometry did not pass`);
  invariant(evidence.pixels_ok === true, `${slug}: ${label} pixel evidence did not pass`);
  invariant(
    evidence.artifact === "screenshots/desktop/map.png",
    `${slug}: ${label} points to an unexpected artifact`,
  );
  invariant(Number(evidence.unique_colors || 0) >= 16, `${slug}: ${label} has too few colors`);
  invariant(Number(evidence.variance || 0) >= 80, `${slug}: ${label} has insufficient variance`);
}

function validateScreenshotEvidence({ slug, siteDir, runtimeEvents }) {
  const starts = runtimeEvents.filter(
    (event) => event?.stage === "build" && event?.phase === "start",
  );
  const dones = runtimeEvents.filter(
    (event) => event?.stage === "build" && event?.phase === "done",
  );
  const captureErrors = runtimeEvents.filter(
    (event) => event?.stage === "build" && event?.phase === "capture-skipped",
  );
  invariant(starts.length === 1, `${slug}: expected one build.start event, got ${starts.length}`);
  invariant(starts[0]?.payload?.slug === slug, `${slug}: build.start belongs to another site`);
  invariant(dones.length === 1, `${slug}: expected one build.done event, got ${dones.length}`);
  invariant(captureErrors.length === 0, `${slug}: renderer swallowed a screenshot capture error`);

  const runtimeFiles = Array.isArray(dones[0]?.payload?.screenshots)
    ? dones[0].payload.screenshots.map(normalizedArtifactPath)
    : [];
  invariant(
    runtimeFiles.length === EXPECTED_SCREENSHOTS.length,
    `${slug}: runtime returned ${runtimeFiles.length} screenshot paths`,
  );
  invariant(
    new Set(runtimeFiles).size === EXPECTED_SCREENSHOTS.length,
    `${slug}: runtime screenshot list contains duplicates`,
  );
  for (const expected of EXPECTED_SCREENSHOTS) {
    invariant(runtimeFiles.includes(expected), `${slug}: runtime omitted ${expected}`);
  }

  const manifestPath = path.join(siteDir, "screenshots", "manifest.json");
  invariant(existsSync(manifestPath), `${slug}: screenshot manifest is missing`);
  const manifest = readJson(manifestPath);
  invariant(
    manifest.schema === "siteforge-screenshot-manifest-v1",
    `${slug}: screenshot manifest schema is invalid`,
  );
  invariant(manifest.renderer === "05-build-v8", `${slug}: screenshot manifest renderer is invalid`);
  invariant(
    manifest.index_sha256 === sha256File(path.join(siteDir, "index.html")),
    `${slug}: screenshot manifest index hash is stale`,
  );
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  invariant(
    manifestFiles.length === EXPECTED_SCREENSHOTS.length,
    `${slug}: screenshot manifest contains ${manifestFiles.length} files`,
  );
  const byPath = new Map();
  for (const entry of manifestFiles) {
    const relative = normalizedArtifactPath(entry?.path);
    invariant(!byPath.has(relative), `${slug}: duplicate manifest entry ${relative}`);
    byPath.set(relative, entry);
  }

  const verifiedFiles = [];
  for (const relative of EXPECTED_SCREENSHOTS) {
    const entry = byPath.get(relative);
    invariant(entry, `${slug}: screenshot manifest omitted ${relative}`);
    const target = path.resolve(siteDir, ...relative.split("/"));
    invariant(isPathInside(siteDir, target), `${slug}: screenshot path escaped its site directory`);
    const bytes = assertPng(target, `${slug}:${relative}`);
    const checksum = sha256(bytes);
    invariant(Number(entry.size) === bytes.length, `${slug}: manifest size mismatch for ${relative}`);
    invariant(entry.sha256 === checksum, `${slug}: manifest SHA mismatch for ${relative}`);
    verifiedFiles.push({ path: relative, size: bytes.length, sha256: checksum });
  }

  const mapEvidencePath = path.join(siteDir, "screenshots", "map-evidence.json");
  invariant(existsSync(mapEvidencePath), `${slug}: map evidence is missing`);
  const mapEvidence = readJson(mapEvidencePath);
  validateMapEvidence(slug, mapEvidence, "map evidence file");
  validateMapEvidence(slug, manifest.map_evidence, "manifest map evidence");
  invariant(
    manifest.map_evidence.provider === mapEvidence.provider,
    `${slug}: manifest and map evidence providers disagree`,
  );
  const mapBytes = assertPng(
    path.join(siteDir, "screenshots", "desktop", "map.png"),
    `${slug}:screenshots/desktop/map.png`,
  );
  return {
    runtime_files: [...runtimeFiles],
    manifest_files: verifiedFiles,
    manifest_index_sha256: manifest.index_sha256,
    map_evidence: {
      pass: true,
      provider: mapEvidence.provider || null,
      artifact: mapEvidence.artifact,
      size: mapBytes.length,
      sha256: sha256(mapBytes),
      unique_colors: Number(mapEvidence.unique_colors),
      variance: Number(mapEvidence.variance),
    },
  };
}

function validateRenderedFirstPartyPhotos(siteDir, mirroredPhotos, slug) {
  const packet = readJson(path.join(siteDir, "packet.json"));
  const html = readFileSync(path.join(siteDir, "index.html"), "utf8");
  const catalog = Array.isArray(packet.media?.catalog) ? packet.media.catalog : [];
  const photoRecords = catalog.filter((item) => item?.kind === "photo");
  invariant(photoRecords.length >= MIN_REAL_PHOTOS, `${slug}: final packet has too few photo records`);
  const mirroredChecksums = new Set(mirroredPhotos.map((photo) => photo.checksum));
  const linked = [];
  for (const item of photoRecords) {
    invariant(item.source === "business-site", `${slug}: non-first-party photo entered final packet`);
    invariant(item.proof_eligible === true, `${slug}: final photo is not proof eligible`);
    const relative = normalizedArtifactPath(item.url);
    invariant(
      /^media\/[^/?#]+$/i.test(relative),
      `${slug}: rendered photo is not an owned local media path: ${relative}`,
    );
    const target = path.resolve(siteDir, ...relative.split("/"));
    invariant(isPathInside(path.join(siteDir, "media"), target), `${slug}: media path escaped output`);
    invariant(existsSync(target) && statSync(target).isFile(), `${slug}: rendered media file is missing`);
    const checksum = sha256File(target);
    invariant(
      mirroredChecksums.has(checksum),
      `${slug}: rendered media bytes do not link to a verified mirrored input`,
    );
    if (html.includes(relative)) linked.push({ path: relative, sha256: checksum });
  }
  const unique = new Map(linked.map((item) => [item.sha256, item]));
  invariant(
    unique.size >= MIN_REAL_PHOTOS,
    `${slug}: only ${unique.size} unique mirrored photos are referenced by rendered HTML`,
  );
  return {
    count: unique.size,
    files: [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)),
    checksums: [...unique.keys()].sort(),
  };
}

function assertCrossSiteRenderedPhotoUniqueness(builds) {
  const uses = new Map();
  for (const build of builds) {
    for (const checksum of build.renderedPhotos.checksums) {
      if (!uses.has(checksum)) uses.set(checksum, []);
      uses.get(checksum).push(build.slug);
    }
  }
  const collisions = [...uses.entries()].filter(([, slugs]) => new Set(slugs).size > 1);
  invariant(
    collisions.length === 0,
    `cross-site rendered image collision: ${collisions.map(([hash, slugs]) => `${hash.slice(0, 12)}:${slugs.join(",")}`).join(";")}`,
  );
}

function compactCheck(result) {
  return {
    pass: result.pass === true,
    detail: result.detail,
  };
}

function collectHardVisualFailures(slug, visualResults) {
  const visualByName = new Map(
    visualResults.map((result) => [String(result?.name || ""), result]),
  );
  return HARD_VISUAL_GATE_NAMES
    .map((name) => visualByName.get(name) || {
      name,
      pass: false,
      detail: "required visual result missing",
    })
    .filter((result) => result.pass !== true)
    .map((result) => ({
      site: slug,
      name: result.name,
      detail: result.detail || "visual gate failed",
    }));
}

function createHardVisualGateError(slug, failures) {
  const error = new Error(
    `${slug}: B8 visual fidelity failed: ${failures
      .map((failure) => `${failure.name}: ${failure.detail}`)
      .join("; ")}`,
  );
  error.summaryFailures = failures;
  return error;
}

function outputImageHashes(siteDir) {
  const mediaDir = path.join(siteDir, "media");
  if (!existsSync(mediaDir)) return [];
  return readdirSync(mediaDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && PHOTO_EXTENSIONS.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      file: entry.name,
      sha256: sha256File(path.join(mediaDir, entry.name)),
    }));
}

async function buildProof(outputRoot, emittedEvents) {
  const sitesRoot = path.join(outputRoot, "sites");
  const mirrorsRoot = path.join(outputRoot, "mirrors");
  const inputsRoot = path.join(outputRoot, "inputs");
  for (const target of [sitesRoot, mirrorsRoot, inputsRoot]) {
    invariant(isPathInside(outputRoot, target), `temp target escaped proof root: ${target}`);
    mkdirSync(target, { recursive: true });
  }

  const store = createMemoryStore();
  const builds = [];
  for (const [batchIndex, spec] of PROSPECTS.entries()) {
    const packet = loadDerivedPacket(spec);
    assignPreviewQcCohort(packet, { previewKey: spec.slug });
    const census = await verifyCensusLocation(packet, spec);
    const inputPath = path.join(inputsRoot, `${spec.slug}.json`);
    safeWriteJson(outputRoot, inputPath, packet);

    const siteDir = path.join(sitesRoot, spec.slug);
    mkdirSync(siteDir, { recursive: true });
    await rescue(packet, {
      lovableKey: null,
      outDir: siteDir,
    });
    const mirrorDir = path.join(mirrorsRoot, spec.slug);
    await scrape(packet, {
      mirrorRemote: true,
      mediaDir: mirrorDir,
    });
    const photos = verifiedMirroredPhotos(packet, mirrorDir);
    await hardenPreviewMedia(packet, { outDir: siteDir });
    const stagedLogo = [
      packet.logo_source?.chosen_url,
      packet.logo_source?.local_path,
      packet.logo_source?.remastered_path,
      packet.logo_source?.url,
    ].find((value) => typeof value === "string" && value && !/^https?:/i.test(value));
    invariant(
      stagedLogo && existsSync(path.resolve(siteDir, stagedLogo)),
      `${spec.slug}: source logo was not staged into the owned preview`,
    );
    design(packet, {
      batchIndex,
    });
    invariant(Array.isArray(packet.section_plan) && packet.section_plan.length >= 4, `${spec.slug}: section planner did not produce a usable plan`);

    const eventStart = emittedEvents.length;
    const runtime = await runSiteforgePremierBuild(packet, {
      outDir: siteDir,
      store,
      capture: true,
    });
    const runtimeEvents = emittedEvents.slice(eventStart);
    invariant(runtime?.outDir === siteDir, `${spec.slug}: renderer returned an unexpected output directory`);
    invariant(/^[a-f0-9]{64}$/i.test(runtime.generation_fingerprint || ""), `${spec.slug}: invalid generation fingerprint`);
    invariant(
      persistPreviewQcCohort(siteDir, packet),
      `${spec.slug}: rendered public packet did not preserve its QC cohort`,
    );
    const screenshotEvidence = validateScreenshotEvidence({
      slug: spec.slug,
      siteDir,
      runtimeEvents,
    });
    const renderedPhotos = validateRenderedFirstPartyPhotos(siteDir, photos, spec.slug);
    builds.push({
      slug: spec.slug,
      siteDir,
      photos,
      runtime,
      census,
      screenshotEvidence,
      renderedPhotos,
    });
  }

  assertCrossSitePhotoUniqueness(builds);
  assertCrossSiteRenderedPhotoUniqueness(builds);
  const batchAudit = await auditBatchDistinctness(sitesRoot);
  invariant(batchAudit.site_count === PROSPECTS.length, `batch audit found ${batchAudit.site_count} sites`);
  invariant(batchAudit.signatures.length === PROSPECTS.length, "batch audit did not emit all design signatures");
  const failedBatchChecks = batchAudit.results.filter((result) => !result.pass);
  invariant(failedBatchChecks.length === 0, `batch distinctness failed: ${failedBatchChecks.map((result) => result.name).join(",")}`);
  invariant(batchAudit.distinct === true, "batch distinctness did not certify the three previews");

  const siteSummaries = [];
  for (const build of builds) {
    const brand = checkBrandPaletteUse(build.siteDir);
    const geo = checkGeoIntegrity(build.siteDir);
    const media = checkMediaDepth(build.siteDir);
    const fidelityResults = runVisualFidelityChecks(build.siteDir, { batchDir: sitesRoot });
    const hardVisualFailures = collectHardVisualFailures(build.slug, fidelityResults);
    if (hardVisualFailures.length > 0) {
      throw createHardVisualGateError(build.slug, hardVisualFailures);
    }
    const primaryQc = await runQualityAudit(build.siteDir, sitesRoot, {
      visualResults: fidelityResults,
    });
    invariant(
      primaryQc.failed.length === 0,
      `${build.slug}: production QC failed: ${primaryQc.failed.map((result) => `${result.name}: ${result.detail}`).join("; ")}`,
    );
    const visualResults = [
      ...fidelityResults,
      ...primaryQc.results.filter((result) => String(result?.name || "").startsWith("visual-")),
    ];
    const visualByName = new Map(visualResults.map((result) => [result.name, result]));
    const requiredVisual = REQUIRED_VISUAL_CHECKS.map((name) => (
      visualByName.get(name) || { name, pass: false, detail: "required visual result missing" }
    ));
    const gradeA = primaryQc.results.find((result) => result.name === "grade-a-readiness")
      || checkGradeAReadiness({
        batchAudit,
        brandUse: brand,
        geoIntegrity: geo,
        visualResults,
      });
    for (const result of [brand, geo, media, ...requiredVisual, gradeA]) {
      invariant(result.pass === true, `${build.slug}: ${result.name} failed: ${result.detail}`);
    }

    const mapEvidencePath = path.join(build.siteDir, "screenshots", "map-evidence.json");
    invariant(existsSync(mapEvidencePath), `${build.slug}: map evidence is missing`);
    const mapEvidence = readJson(mapEvidencePath);
    invariant(mapEvidence.pass === true, `${build.slug}: real map evidence failed: ${mapEvidence.detail || "unknown"}`);
    const signature = batchAudit.signatures.find((item) => item.slug === build.slug);
    invariant(signature, `${build.slug}: design signature is missing`);

    siteSummaries.push({
      slug: build.slug,
      mirrored_photo_count: build.photos.length,
      mirrored_photo_sha256: build.photos.map((photo) => photo.checksum),
      output_image_sha256: outputImageHashes(build.siteDir),
      generation_fingerprint: build.runtime.generation_fingerprint,
      batch_hamming_min: build.runtime.batch_hamming_min,
      compose_typography_pair: build.runtime.compose_plan?.typography_pair || null,
      census_geocoder: build.census,
      screenshot_evidence: build.screenshotEvidence,
      rendered_first_party_photos: {
        count: build.renderedPhotos.count,
        files: build.renderedPhotos.files,
        checksums: build.renderedPhotos.checksums,
      },
      map_evidence: {
        pass: mapEvidence.pass,
        provider: mapEvidence.provider || null,
        detail: mapEvidence.detail || null,
      },
      checks: {
        media_depth: compactCheck(media),
        brand_palette_use: compactCheck(brand),
        map_geo_integrity: compactCheck(geo),
        visual_conversion_rail: compactCheck(visualByName.get("visual-conversion-rail")),
        visual_hero_geometry: compactCheck(visualByName.get("visual-hero-geometry")),
        visual_hero_anatomy_batch: compactCheck(visualByName.get("visual-hero-anatomy-batch")),
        visual_hero_architecture_batch: compactCheck(visualByName.get("visual-hero-architecture-batch")),
        visual_layout_gravity_batch: compactCheck(visualByName.get("visual-layout-gravity-batch")),
        visual_media_behavior_batch: compactCheck(visualByName.get("visual-media-behavior-batch")),
        visual_logo_identity_batch: compactCheck(visualByName.get("visual-logo-identity-batch")),
        visual_rendered_media_manifests: compactCheck(visualByName.get("visual-rendered-media-manifests")),
        visual_service_media_honesty: compactCheck(visualByName.get("visual-service-media-honesty")),
        visual_provenance_restraint: compactCheck(visualByName.get("visual-provenance-restraint")),
        visual_copy_mechanics: compactCheck(visualByName.get("visual-copy-mechanics")),
        visual_gallery_grid_integrity: compactCheck(visualByName.get("visual-gallery-grid-integrity")),
        grade_a_readiness: compactCheck(gradeA),
        screenshot_evidence: {
          pass: build.screenshotEvidence.manifest_files.length === EXPECTED_SCREENSHOTS.length,
          detail: `${build.screenshotEvidence.manifest_files.length} screenshot PNGs verified against runtime and manifest`,
        },
        rendered_media_linkage: {
          pass: build.renderedPhotos.count >= MIN_REAL_PHOTOS,
          detail: `${build.renderedPhotos.count} unique rendered first-party photos linked by SHA-256`,
        },
      },
      signature,
    });
  }

  return {
    status: "pass",
    batch_id: BATCH_ID,
    output_root: outputRoot,
    site_count: siteSummaries.length,
    signatures: batchAudit.signatures,
    checks: {
      batch: Object.fromEntries(
        batchAudit.results.map((result) => [
          result.name,
          compactCheck(result),
        ]),
      ),
      sites: Object.fromEntries(
        siteSummaries.map((site) => [
          site.slug,
          site.checks,
        ]),
      ),
    },
    sites: siteSummaries,
  };
}

async function main() {
  invariant(process.argv.length === 2, "this harness accepts no arguments and always writes to OS temp");
  const outputRoot = mkdtempSync(path.join(tmpdir(), "siteforge-b8-sameness-"));
  assertTempOnly(outputRoot);
  const emittedEvents = [];
  onEmit((event) => emittedEvents.push(event));

  try {
    const summary = await buildProof(outputRoot, emittedEvents);
    safeWriteJson(outputRoot, path.join(outputRoot, "b8-summary.json"), summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    const failures = Array.isArray(error?.summaryFailures)
      ? error.summaryFailures
      : [{
          site: null,
          name: "proof-error",
          detail: String(error?.message || error),
        }];
    const failure = {
      status: "fail",
      batch_id: BATCH_ID,
      output_root: outputRoot,
      error: String(error?.message || error),
      failures,
    };
    safeWriteJson(outputRoot, path.join(outputRoot, "b8-summary.json"), failure);
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  } finally {
    onEmit(null);
  }
}

await main();
