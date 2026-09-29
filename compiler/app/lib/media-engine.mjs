// SiteForge SaaS — V7 media engine (app side).
// Handles: multipart uploads (logo/photos) → project asset rows with
// provenance, AI logo candidate generation (proposed:true), and the GBP deep
// import (Firecrawl scrape → structured hours/reviews/photos/latlng).
// New file — extends the platform without touching shared engine stages.
import path from "node:path";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { insert, where, update, SITES_DIR } from "./store.mjs";
import { id, token, isUrl } from "./util.mjs";
import { generateLogoCandidates } from "../../asset-pipeline/logo-candidates.mjs";
import { parseGbpDeep, mergeGbpDeep } from "../../asset-pipeline/gbp-deep.mjs";
import { isUsableSourcePhotoUrl, sourceAssetIdentity } from "./source-intake.mjs";
import { imageDimensions } from "./image-metadata.mjs";

const MAX_UPLOAD = 8 * 1024 * 1024; // 8MB per file
export const MAX_PHOTOS_PER_UPLOAD = 6;
const TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg", "image/gif": ".gif" };

// ---------- multipart/form-data parsing (zero deps) ----------
export function readMultipart(req, limit = MAX_UPLOAD * (MAX_PHOTOS_PER_UPLOAD + 1) + 64 * 1024) {
  return new Promise((resolve, reject) => {
    const ct = req.headers["content-type"] || "";
    const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!ct.startsWith("multipart/form-data") || !m) return reject(err(400, "Expected multipart/form-data"));
    const boundary = `--${(m[1] || m[2]).trim()}`;
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(err(413, "Upload too large (8MB max)")); req.destroy(); } else chunks.push(c); });
    req.on("error", reject);
    req.on("end", () => {
      try { resolve(splitMultipart(Buffer.concat(chunks), boundary)); } catch (e) { reject(e); }
    });
  });
}
function splitMultipart(buf, boundary) {
  const parts = { fields: {}, files: [] };
  const bBound = Buffer.from(boundary);
  let start = buf.indexOf(bBound);
  while (start !== -1) {
    const next = buf.indexOf(bBound, start + bBound.length);
    if (next === -1) break;
    const seg = buf.subarray(start + bBound.length + 2, next - 2); // trim \r\n both ends
    const headEnd = seg.indexOf("\r\n\r\n");
    if (headEnd !== -1) {
      const head = seg.subarray(0, headEnd).toString("utf8");
      const body = seg.subarray(headEnd + 4);
      const name = head.match(/name="([^"]+)"/)?.[1];
      const filename = head.match(/filename="([^"]*)"/)?.[1];
      const type = head.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim();
      if (name && filename != null && filename !== "") parts.files.push({ field: name, filename, type, data: body });
      else if (name) parts.fields[name] = body.toString("utf8");
    }
    start = next;
  }
  return parts;
}
function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

function inspectImage(file, kind) {
  const dimensions = imageDimensions(file.data, file.type);
  const pixels = dimensions ? dimensions.width * dimensions.height : 0;
  const minPixels = kind === "logo" ? 2400 : 480000;
  const minWidth = kind === "logo" ? 120 : 800;
  const minHeight = kind === "logo" ? 40 : 480;
  const unknownButLarge = !dimensions && file.data.length >= 160 * 1024;
  const fallbackToAmbiance = kind === "photo" && !unknownButLarge && (!dimensions || pixels < minPixels || dimensions.width < minWidth || dimensions.height < minHeight || file.data.length < 36 * 1024);
  const qualityStatus = fallbackToAmbiance ? "ambiance_fallback" : dimensions || unknownButLarge ? "usable" : "needs_review";
  return {
    dimensions,
    quality_status: qualityStatus,
    fallback_to_ambiance: fallbackToAmbiance,
    treatment: kind === "photo" ? "family-duotone" : "brand-fit",
    note: fallbackToAmbiance ? "Photo is too small or uncertain for proof placement; the renderer will use labeled AI ambiance until a better photo is approved." : null,
  };
}

// ---------- store an uploaded file (local dir + optional Vercel Blob) ----------
export async function storeUpload(project, file, kind) {
  const ext = TYPES[file.type] || path.extname(file.filename || "").toLowerCase() || ".bin";
  if (!Object.values(TYPES).includes(ext)) throw err(415, `Unsupported image type (${file.type || ext}). PNG, JPG, WebP, SVG, or GIF.`);
  if (file.data.length > MAX_UPLOAD) throw err(413, "Upload too large (8MB max)");
  const quality = inspectImage(file, kind);
  const name = `${kind}-${token(6).toLowerCase()}${ext}`;
  let url, localPath = null;
  const { blobPut, BLOB_ENABLED } = await import("./blob-store.mjs");
  if (BLOB_ENABLED()) {
    url = await blobPut(`uploads/${project.id}/${name}`, file.data, file.type || "application/octet-stream");
  } else {
    const dir = path.join(SITES_DIR, project.id, "uploads");
    mkdirSync(dir, { recursive: true });
    localPath = path.join(dir, name);
    writeFileSync(localPath, file.data);
    url = `/asset-file/${project.id}/${name}`;
  }
  const label = quality.fallback_to_ambiance
    ? `Uploaded photo (low quality; ambiance fallback) — ${file.filename}`
    : `${kind === "logo" ? "Your logo" : "Uploaded photo"} — ${file.filename}`;
  return insert("business_assets", {
    project_id: project.id, kind, url, label,
    meta: { local_path: localPath, bytes: file.data.length, filename: file.filename, mime: file.type, ...quality },
    source: "upload", origin: "upload", approved: !quality.fallback_to_ambiance, stale: false,
  });
}
export function uploadSummary(stored) {
  const lowQuality = stored.filter((a) => a.meta?.fallback_to_ambiance);
  return {
    ok: true,
    count: stored.length,
    low_quality: lowQuality.length,
    assets: stored.map((a) => ({ id: a.id, kind: a.kind, approved: a.approved, url: a.url, quality_status: a.meta?.quality_status || "unknown", fallback_to_ambiance: Boolean(a.meta?.fallback_to_ambiance) })),
  };
}
export function localAssetPath(projectId, name) {
  const clean = String(name).replace(/[^A-Za-z0-9_.-]/g, "");
  const fp = path.join(SITES_DIR, projectId, "uploads", clean);
  return existsSync(fp) ? fp : null;
}

// ---------- AI logo candidates (proposed:true provenance) ----------
export async function makeLogoCandidates(project, profile) {
  // clear previous unpicked candidates
  for (const a of where("business_assets", (a) => a.project_id === project.id && a.kind === "logo" && a.meta?.proposed && !a.stale)) {
    update("business_assets", a.id, { stale: true, approved: false });
  }
  const tradeKey = (profile.industry || "service").toLowerCase();
  const pal = { bg: "#F7F4EE", ink: "#1E1B16", accent: "#B4552D", accent2: "#41604F", mode: "light" };
  const candidates = await generateLogoCandidates({
    name: profile.business_name, tradeKey, pal, slug: project.slug, lovableKey: process.env.LOVABLE_API_KEY || null,
  });
  return candidates.map((c, i) => insert("business_assets", {
    project_id: project.id, kind: "logo", url: c.url, label: c.label,
    meta: c.meta, source: "ai", origin: "ai-candidate", approved: false, stale: false,
  }));
}

// ---------- GBP deep import ----------
export async function gbpDeepImport(project, profile) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw err(400, "FIRECRAWL_API_KEY not configured — GBP import needs it.");
  if (!profile.gbp_url || !isUrl(profile.gbp_url)) throw err(400, "Add a Google Business Profile / Maps URL first.");
  const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ url: profile.gbp_url, formats: ["markdown", "links"], onlyMainContent: false, waitFor: 3500 }),
  });
  if (!r.ok) throw err(502, `Firecrawl GBP scrape failed (${r.status})`);
  const data = await r.json();
  const deep = parseGbpDeep({ markdown: data.markdown || data.data?.markdown || "", links: data.links || data.data?.links || [], url: profile.gbp_url });

  // land as reviewable assets with gbp provenance
  for (const a of where("business_assets", (a) => a.project_id === project.id && a.origin === "gbp-deep")) update("business_assets", a.id, { stale: true, approved: false });
  const mk = (kind, url, label, meta = {}) => insert("business_assets", { project_id: project.id, kind, url, label, meta, source: "gbp", origin: "gbp-deep", approved: true, stale: false });
  if (deep.hours) mk("hours", null, deep.hours.map((h) => `${h.day.slice(0, 3)} ${h.hours}`).join(" · "), { hours: deep.hours, hours_spec: deep.hoursSpec });
  for (const rv of deep.reviews) mk("review", null, `“${rv.text.slice(0, 140)}${rv.text.length > 140 ? "…" : ""}” — ${rv.author}`, { review: rv });
  deep.photos.forEach((u, i) => mk("photo", u, `GBP photo ${i + 1}`));
  if (deep.address) mk("contact", null, deep.address, { type: "address" });
  if (deep.latlng) mk("map", null, `Pin: ${deep.latlng.lat.toFixed(5)}, ${deep.latlng.lng.toFixed(5)}`, { type: "latlng", latlng: deep.latlng });
  if (deep.rating) mk("citation", profile.gbp_url, `${deep.rating.value}★ · ${deep.rating.count} Google reviews`, { rating: deep.rating });

  update("site_projects", project.id, {
    gbp_import: {
      ran_at: new Date().toISOString(), hours: Boolean(deep.hours), reviews: deep.reviews.length,
      photos: deep.photos.length, address: deep.address, latlng: deep.latlng, rating: deep.rating,
    },
  });
  return deep;
}

// ---------- merge V7 assets into a forge packet (called by engine-adapter) ----------
export function mergeV7Assets(packet, assets) {
  // hours / reviews / latlng / rating from gbp-deep asset rows
  const hoursAsset = assets.find((a) => a.kind === "hours" && a.approved && a.meta?.hours);
  if (hoursAsset) packet.enrichment_sources.hours = { source: "gbp", confidence: 0.95, value: hoursAsset.meta.hours, hours_spec: hoursAsset.meta.hours_spec };
  const reviewMeta = assets.filter((a) => a.kind === "review" && a.approved && a.meta?.review).map((a) => a.meta.review);
  if (reviewMeta.length) packet.enrichment_sources.reviews_attributed = { source: "gbp", confidence: 0.95, value: reviewMeta };
  const pin = assets.find((a) => a.kind === "map" && a.approved && a.meta?.latlng);
  if (pin) packet.enrichment_sources.latlng = { source: "gbp", confidence: 0.95, value: pin.meta.latlng };
  const addr = assets.find((a) => a.kind === "contact" && a.approved && a.meta?.type === "address");
  if (addr) packet.enrichment_sources.address = { source: "gbp", confidence: 0.9, value: addr.label };
  const rating = assets.find((a) => a.kind === "citation" && a.approved && a.meta?.rating);
  if (rating) packet.enrichment_sources.rating = { source: "gbp", confidence: 0.95, value: rating.meta.rating };

  // media catalog: uploads + gbp + site photos, with provenance + local paths
  const photos = assets.filter((a) => a.kind === "photo" && a.approved && !a.meta?.fallback_to_ambiance);
  const videos = assets.filter((a) => a.kind === "video" && a.approved && a.url);
  if (photos.length || videos.length) {
    packet.media = packet.media ?? {};
    const catalog = photos.map((p) => ({
      kind: "photo", url: p.url, source: p.origin === "upload" ? "upload" : p.origin === "gbp-deep" ? "gbp" : "site",
      label: p.label, local_path: p.meta?.local_path || null, treatment: p.meta?.treatment || "family-duotone",
      width: p.width || p.meta?.width || p.meta?.dimensions?.width || null,
      height: p.height || p.meta?.height || p.meta?.dimensions?.height || null,
      hero_eligible: p.hero_eligible !== false,
      proof_eligible: p.proof_eligible !== false,
    })).concat(videos.map((video) => ({
      kind: "video", url: video.url, source: video.origin === "upload" ? "upload" : video.source || "site",
      label: video.label, local_path: video.meta?.local_path || null,
    })));
    packet.media.catalog = sanitizeV7MediaCatalog([...(packet.media.catalog || []), ...catalog]);
  }
  // chosen logo: uploaded > approved AI candidate (proposed provenance kept)
  const upLogo = assets.find((a) => (
    a.kind === "logo"
    && a.approved
    && (a.origin === "upload" || a.provenance?.authenticated_owner_upload === true)
  ));
  const aiLogo = assets.find((a) => a.kind === "logo" && a.approved && a.origin === "ai-candidate");
  if (upLogo) {
    packet.enrichment_sources.logo = { source: "user", confidence: 1, value: upLogo.url };
    // rescue()/mergeEnrichment() rebuild logo fields downstream; v7_logo survives
    // untouched and the v7 build applies it over logo_source at render time.
    packet.v7_logo = { url: upLogo.url, origin: "upload", proposed: false, local_path: upLogo.meta?.local_path || null };
  } else if (aiLogo) {
    packet.enrichment_sources.logo = { source: "ai", confidence: 0.7, value: aiLogo.url, note: "proposed mark — operator approved candidate" };
    packet.v7_logo = { url: aiLogo.url, origin: "proposed", proposed: true };
  }
  return packet;
}

// Keep the proof plane honest and useful: one logical source image appears
// once, transformed thumbnails never outrank their full-size counterpart, and
// generic stock harvested from a client page cannot masquerade as job proof.
export function sanitizeV7MediaCatalog(items = []) {
  const chosen = new Map();
  for (const item of items) {
    if (!item?.url || !["photo", "video"].includes(item.kind)) continue;
    const source = String(item.source || "site").toLowerCase();
    const localOrUploaded = source === "upload" || Boolean(item.local_path) || !/^https?:\/\//i.test(item.url);
    if (item.kind === "photo" && source !== "stock-ambiance" && !localOrUploaded && !isUsableSourcePhotoUrl(item.url)) continue;
    const key = `${item.kind}:${sourceAssetIdentity(item.url)}`;
    const prior = chosen.get(key);
    if (!prior || mediaQualityScore(item) > mediaQualityScore(prior)) chosen.set(key, item);
  }
  return [...chosen.values()];
}

function mediaQualityScore(item = {}) {
  const dimensions = Number(item.width || item.meta?.dimensions?.width || 0) * Number(item.height || item.meta?.dimensions?.height || 0);
  const transformedWidth = [...String(item.url || "").matchAll(/(?:^|[^a-z])(?:w|width)[:=](\d{1,4})(?:\D|$)/gi)]
    .map((match) => Number(match[1]))
    .sort((a, b) => b - a)[0] || 0;
  return dimensions || transformedWidth || (item.local_path ? 10_000 : 1);
}

export { parseGbpDeep, mergeGbpDeep };
