"use strict";

// Runtime-only hero replacement for an already-active immutable shared site.
// The loader and publisher are injected so this module never owns provider
// credentials. It replaces one renderer-proven file in a cloned release tree;
// the old release and manifest are never mutated.

const { createHash } = require("node:crypto");
const { canonicalFilePath } = require("./shared-site-release");

const SHARED_HERO_FLAG = "GHOST_AGENCY_SHARED_HERO_INJECTION";
const SHARED_EVIDENCE_SCHEMA = "shared-site-release-evidence-v1";
const SHARED_RELEASE_BUCKET = "wss-site-releases";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/i;

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new TypeError("shared_hero_file_bytes_invalid");
}

function sharedHeroInjectionEnabled(env = process.env) {
  return String(env && env[SHARED_HERO_FLAG] || "") !== "0";
}

function firstObject(values) {
  return values.map(objectOf).find(Boolean) || null;
}

function sharedEvidencePair(value, source) {
  const candidate = objectOf(value);
  if (!candidate) return null;
  const proofIdentity = firstObject([candidate.proofIdentity, candidate.proof_identity]);
  const releaseEvidence = firstObject([candidate.sharedReleaseEvidence, candidate.shared_release_evidence]);
  if (!proofIdentity && !releaseEvidence) return null;
  return { source, proofIdentity, releaseEvidence };
}

function exactSharedBinding(pair) {
  const proof = pair && objectOf(pair.proofIdentity) || {};
  const evidence = pair && objectOf(pair.releaseEvidence) || {};
  return JSON.stringify([
    String(proof.site_id || ""),
    String(proof.release_id || ""),
    String(proof.build_hash || "").toLowerCase(),
    String(evidence.site_id || ""),
    String(evidence.release_id || ""),
    String(evidence.build_hash || "").toLowerCase(),
    String(evidence.canonical_host || "").toLowerCase(),
    String(evidence.evidence_schema || ""),
    String(evidence.state || ""),
    String(evidence.deployment_env || ""),
    String(evidence.slug || "").toLowerCase(),
    String(evidence.manifest_path || ""),
    String(evidence.manifest_sha256 || "").toLowerCase(),
    Number(evidence.generation),
    Number(evidence.route_generation),
    String(evidence.hero_video_path || ""),
    String(evidence.hero_video_sha256 || "").toLowerCase(),
  ]);
}

function sharedHeroEvidenceFromRow(row = {}) {
  const record = objectOf(row.record) || {};
  const dispatch = objectOf(record.build_dispatch) || objectOf(row.buildDispatch) || objectOf(row.build_dispatch) || {};
  const pairs = [
    sharedEvidencePair(dispatch.releaseEvidence || dispatch.release_evidence, "record.build_dispatch.release_evidence"),
    sharedEvidencePair(record.releaseEvidence || record.release_evidence, "record.release_evidence"),
    sharedEvidencePair(record.mirrorReleaseEvidence || record.mirror_release_evidence, "record.mirror_release_evidence"),
    sharedEvidencePair(row.releaseEvidence || row.release_evidence, "row.release_evidence"),
    sharedEvidencePair(dispatch, "record.build_dispatch"),
    sharedEvidencePair(record, "record"),
    sharedEvidencePair(row, "row"),
  ].filter(Boolean);
  if (!pairs.length) return { selected: false };
  if (pairs.some((pair) => !pair.proofIdentity || !pair.releaseEvidence)) {
    return { selected: true, ok: false, reason: "shared_hero_evidence_incomplete" };
  }
  const binding = exactSharedBinding(pairs[0]);
  if (pairs.some((pair) => exactSharedBinding(pair) !== binding)) {
    return { selected: true, ok: false, reason: "shared_hero_evidence_conflict" };
  }
  const { proofIdentity, releaseEvidence } = pairs[0];

  const siteId = String(proofIdentity.site_id || "").trim();
  const releaseId = String(proofIdentity.release_id || "").trim();
  const buildHash = String(proofIdentity.build_hash || "").trim().toLowerCase();
  const canonicalHost = String(releaseEvidence.canonical_host || "").trim().toLowerCase();
  const hostSlug = canonicalHost.endsWith(".wss-ai.com")
    ? canonicalHost.slice(0, -".wss-ai.com".length)
    : "";
  const claimedSlug = String(releaseEvidence.slug || row.slug || record.slug || "").trim().toLowerCase();
  const slug = claimedSlug || hostSlug;
  const manifestPath = String(releaseEvidence.manifest_path || "").trim();
  const manifestSha256 = String(releaseEvidence.manifest_sha256 || "").trim().toLowerCase();
  const heroVideoPath = canonicalFilePath(releaseEvidence.hero_video_path);
  const heroVideoSha256 = String(releaseEvidence.hero_video_sha256 || "").trim().toLowerCase();
  const generation = Number(releaseEvidence.generation);
  const routeGeneration = Number(releaseEvidence.route_generation);
  const environment = String(releaseEvidence.deployment_env || "").trim();
  const expectedManifestPath = `sites/${siteId}/releases/${releaseId}/manifest.json`;
  if (!UUID_RE.test(siteId) || !UUID_RE.test(releaseId) || !SHA_RE.test(buildHash)
    || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    || !hostSlug || slug !== hostSlug || canonicalHost !== `${slug}.wss-ai.com`
    || releaseEvidence.evidence_schema !== SHARED_EVIDENCE_SCHEMA
    || releaseEvidence.state !== "active"
    || releaseEvidence.site_id !== siteId
    || releaseEvidence.release_id !== releaseId
    || String(releaseEvidence.build_hash || "").toLowerCase() !== buildHash
    || manifestPath !== expectedManifestPath
    || !SHA_RE.test(manifestSha256)
    || !heroVideoPath || heroVideoPath !== releaseEvidence.hero_video_path
    || !/\.mp4$/i.test(heroVideoPath) || !SHA_RE.test(heroVideoSha256)
    || !Number.isSafeInteger(generation) || generation < 1
    || !Number.isSafeInteger(routeGeneration) || routeGeneration !== generation
    || !environment) {
    return { selected: true, ok: false, reason: "shared_hero_evidence_invalid" };
  }
  return {
    selected: true,
    ok: true,
    identity: { site_id: siteId, release_id: releaseId, build_hash: buildHash },
    evidence: { ...releaseEvidence },
    slug,
    canonicalHost,
    manifestPath,
    manifestSha256,
    heroVideoPath,
    heroVideoSha256,
    generation,
    environment,
    evidenceSources: pairs.map((pair) => pair.source),
  };
}

function validateApprovedAsset(asset) {
  const value = objectOf(asset);
  const bytes = value && value.bytes;
  let body;
  try { body = asBuffer(bytes); } catch { return { ok: false, reason: "shared_hero_asset_bytes_invalid" }; }
  const digest = String(value.sha256 || "").trim().toLowerCase();
  const sourceSha = String(value.source_sha256 || value.sourceSha256 || "").trim().toLowerCase();
  const url = String(value.url || "").trim();
  if (!value || value.verified !== true || value.approved !== true
    || !String(value.approved_by || value.approvedBy || "").trim()
    || !String(value.approved_at || value.approvedAt || "").trim()
    || !SHA_RE.test(digest) || sha256(body) !== digest
    || !SHA_RE.test(sourceSha)
    || !/^https:\/\//i.test(url) || !/\.mp4(?:[?#]|$)/i.test(url)
    || value.retention?.class !== "approved_durable" || value.retention?.expires_at !== null) {
    return { ok: false, reason: "shared_hero_asset_not_approved" };
  }
  return { ok: true, bytes: body, sha256: digest, sourceSha256: sourceSha, url };
}

function derivedBuildHash(files) {
  const rows = Object.keys(files).sort().map((rel) => {
    const body = asBuffer(files[rel]);
    return [rel, sha256(body), body.length];
  });
  return sha256(Buffer.from(JSON.stringify(rows), "utf8"));
}

function exactPreviewUrl(value, host) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password
      || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return "";
    return `${url.origin}/`;
  } catch { return ""; }
}

function createDefaultSharedSiteReleaseLoader({ env = process.env, fetchImpl = global.fetch } = {}) {
  return Object.freeze({
    async load({ proofIdentity, releaseEvidence, signal } = {}) {
      const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
      const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
      if (!/^https:\/\//i.test(base) || !key || typeof fetchImpl !== "function") {
        return { ok: false, reason: "shared_hero_storage_not_configured" };
      }
      const manifestPath = String(releaseEvidence?.manifest_path || "");
      const expectedPrefix = `sites/${proofIdentity?.site_id}/releases/${proofIdentity?.release_id}/`;
      const expectedFilePrefix = `${expectedPrefix}files/`;
      if (manifestPath !== `${expectedPrefix}manifest.json`) {
        return { ok: false, reason: "shared_hero_manifest_path_mismatch" };
      }
      const read = async (objectPath) => {
        if (!String(objectPath).startsWith(expectedPrefix)) throw new Error("shared_hero_object_path_mismatch");
        const target = `${base}/storage/v1/object/${SHARED_RELEASE_BUCKET}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
        const response = await fetchImpl(target, {
          method: "GET",
          headers: { apikey: key, authorization: `Bearer ${key}` },
          signal,
        });
        if (!response || !response.ok) throw new Error("shared_hero_object_read_refused");
        return Buffer.from(await response.arrayBuffer());
      };
      try {
        const manifestBytes = await read(manifestPath);
        if (sha256(manifestBytes) !== String(releaseEvidence.manifest_sha256 || "").toLowerCase()) {
          return { ok: false, reason: "shared_hero_manifest_sha_mismatch" };
        }
        const manifest = JSON.parse(manifestBytes.toString("utf8"));
        if (!manifest || manifest.site_id !== proofIdentity.site_id
          || manifest.release_id !== proofIdentity.release_id
          || manifest.build_hash !== proofIdentity.build_hash
          || manifest.canonical_host !== releaseEvidence.canonical_host
          || Number(manifest.route_generation) !== Number(releaseEvidence.route_generation)
          || !objectOf(manifest.files) || !objectOf(manifest.routes)) {
          return { ok: false, reason: "shared_hero_manifest_identity_mismatch" };
        }
        const entries = Object.entries(manifest.files);
        const loaded = await Promise.all(entries.map(async ([rel, meta]) => {
          const canonical = canonicalFilePath(rel);
          const row = objectOf(meta);
          if (!canonical || canonical !== rel || !row || !SHA_RE.test(String(row.sha256 || ""))
            || !Number.isSafeInteger(Number(row.bytes)) || Number(row.bytes) < 0
            || String(row.key || "") !== `${expectedFilePrefix}${rel}`) {
            throw new Error("shared_hero_manifest_file_invalid");
          }
          const body = await read(row.key);
          if (body.length !== Number(row.bytes) || sha256(body) !== String(row.sha256).toLowerCase()) {
            throw new Error("shared_hero_release_file_mismatch");
          }
          return [rel, body];
        }));
        return {
          ok: true,
          proofIdentity: { ...proofIdentity },
          releaseEvidence: { ...releaseEvidence },
          files: Object.fromEntries(loaded),
          routeMap: { ...manifest.routes },
        };
      } catch (error) {
        return { ok: false, reason: String(error?.message || "shared_hero_release_load_failed") };
      }
    },
  });
}

function createDefaultSharedHeroRuntime({ env = process.env, fetchImpl = global.fetch } = {}) {
  try {
    const publisherModule = require("./shared-site-publisher");
    if (typeof publisherModule.createDefaultSharedSitePublisher !== "function") return null;
    return {
      publisher: publisherModule.createDefaultSharedSitePublisher({ env, fetchImpl }),
      loader: createDefaultSharedSiteReleaseLoader({ env, fetchImpl }),
    };
  } catch {
    return null;
  }
}

async function injectSharedSiteHero(input = {}, deps = {}) {
  const selection = sharedHeroEvidenceFromRow(input.row);
  if (!selection.selected) return { ok: false, selected: false, reason: "shared_hero_not_selected" };
  if (!selection.ok) return { ...selection, fallback: false };
  const asset = validateApprovedAsset(input.asset);
  if (!asset.ok) return { ok: false, selected: true, fallback: false, reason: asset.reason };
  if (!deps.loader || typeof deps.loader.load !== "function"
    || !deps.publisher || typeof deps.publisher.publish !== "function"
    || deps.publisher.supportsExpectedGenerationCas !== true) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_adapter_missing" };
  }

  let loaded;
  try {
    loaded = await deps.loader.load({
      proofIdentity: selection.identity,
      releaseEvidence: selection.evidence,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
    });
  } catch (error) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_release_load_failed", detail: String(error?.message || error) };
  }
  const loadedIdentity = objectOf(loaded?.proofIdentity) || {};
  const filesInput = objectOf(loaded?.files);
  const routeMapInput = objectOf(loaded?.routeMap);
  if (loaded?.ok !== true || !filesInput || !routeMapInput
    || loadedIdentity.site_id !== selection.identity.site_id
    || loadedIdentity.release_id !== selection.identity.release_id
    || loadedIdentity.build_hash !== selection.identity.build_hash) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_loaded_release_mismatch" };
  }

  const files = Object.create(null);
  try {
    for (const [rawPath, bytes] of Object.entries(filesInput)) {
      const rel = canonicalFilePath(rawPath);
      if (!rel || rel !== rawPath) throw new Error("invalid_release_file_path");
      files[rel] = asBuffer(bytes);
    }
  } catch (error) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_loaded_files_invalid", detail: String(error?.message || error) };
  }
  if (!files[selection.heroVideoPath]
    || sha256(files[selection.heroVideoPath]) !== selection.heroVideoSha256) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_slot_bytes_mismatch" };
  }
  const routes = { ...routeMapInput };
  const videoRoute = `/${selection.heroVideoPath}`;
  if (routes[videoRoute] !== selection.heroVideoPath) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_slot_route_mismatch" };
  }
  files[selection.heroVideoPath] = Buffer.from(asset.bytes);
  const nextBuildHash = derivedBuildHash(files);
  if (nextBuildHash === selection.identity.build_hash) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_build_hash_unchanged" };
  }

  let published;
  try {
    published = await deps.publisher.publish({
      slug: selection.slug,
      host: selection.canonicalHost,
      files,
      routeMap: routes,
      buildHash: nextBuildHash,
      operationKey: String(input.operationKey || "").trim(),
      parentReleaseId: selection.identity.release_id,
      expectedGeneration: selection.generation,
      heroVideoPath: selection.heroVideoPath,
      heroVideoSha256: asset.sha256,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
    });
  } catch (error) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_publish_failed", detail: String(error?.message || error) };
  }
  const proof = objectOf(published?.proofIdentity) || {};
  const evidence = objectOf(published?.releaseEvidence || published?.release_evidence) || {};
  const previewUrl = exactPreviewUrl(published?.previewUrl || published?.preview_url, selection.canonicalHost);
  if (published?.ok !== true || published?.fallback === true || !previewUrl
    || proof.site_id !== selection.identity.site_id
    || !UUID_RE.test(String(proof.release_id || ""))
    || proof.release_id === selection.identity.release_id
    || proof.build_hash !== nextBuildHash
    || evidence.site_id !== proof.site_id || evidence.release_id !== proof.release_id
    || evidence.build_hash !== nextBuildHash || evidence.canonical_host !== selection.canonicalHost
    || evidence.state !== "active" || Number(evidence.generation) !== selection.generation + 1
    || evidence.hero_video_path !== selection.heroVideoPath
    || String(evidence.hero_video_sha256 || "").toLowerCase() !== asset.sha256) {
    return { ok: false, selected: true, fallback: false, reason: "shared_hero_publish_receipt_mismatch" };
  }

  return {
    ok: true,
    selected: true,
    fallback: false,
    previewUrl,
    proofIdentity: { site_id: proof.site_id, release_id: proof.release_id, build_hash: proof.build_hash },
    releaseEvidence: { ...evidence },
    previousProofIdentity: { ...selection.identity },
    heroVideoPath: selection.heroVideoPath,
    heroVideoSha256: asset.sha256,
  };
}

module.exports = {
  SHARED_HERO_FLAG,
  SHARED_EVIDENCE_SCHEMA,
  sharedHeroInjectionEnabled,
  sharedHeroEvidenceFromRow,
  validateApprovedAsset,
  derivedBuildHash,
  createDefaultSharedSiteReleaseLoader,
  createDefaultSharedHeroRuntime,
  injectSharedSiteHero,
};
