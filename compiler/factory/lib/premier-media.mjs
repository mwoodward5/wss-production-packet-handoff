import {
  hasUsablePhotoDimensions,
  isBoundContainedSourceProof,
} from "./media-intelligence.mjs";

export const MAX_PREMIER_GALLERY_PHOTOS = 12;

const IMAGE_EXT = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(?:m4v|mov|mp4|og[gv]|webm)(?:[?#]|$)/i;
const VIDEO_MIME_BY_EXTENSION = new Map([
  ["m4v", "video/x-m4v"],
  ["mov", "video/quicktime"],
  ["mp4", "video/mp4"],
  ["ogg", "video/ogg"],
  ["ogv", "video/ogg"],
  ["webm", "video/webm"],
]);
const BROWSER_HERO_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/x-m4v",
]);
const SVG_EXT = /\.svg(?:[?#]|$)/i;
const LOGO_HINT = /(?:^|[\s/_-])(?:badge|brandmark|favicon|icon|logo|logomark|seal|wordmark)(?:[\s/_.-]|$)/i;
const PLACEHOLDER_HOST = /(?:dummyimage\.com|loremflickr\.com|picsum\.photos|placehold(?:\.co|er\.com)|via\.placeholder\.com)/i;
const STOCK_HOST = /(?:cdn\.pixabay\.com|images\.pexels\.com|images\.unsplash\.com)/i;
const NON_SOURCE_HINT = /(?:^|[\s/_-])(?:ai|ambiance|demo|generated|placeholder|sample|stock|synthetic|veo|web-search)(?:[\s/_.-]|$)/i;

export function selectPremierMedia(input, options = {}) {
  const assets = preparePremierMedia(input);
  const ambianceVideo = selectAmbianceVideo(input);
  const gallery = selectGalleryFromAssets(assets, options);
  const sourceVideos = assets
    .filter((asset) => asset.kind === "video" && asset.hero_eligible !== false);
  const sourceVideo = sourceVideos
    .filter(isBrowserPlayableVideo)
    .sort(compareMedia)[0] || null;
  const unsupportedSourceVideo = sourceVideos
    .filter((asset) => !isBrowserPlayableVideo(asset))
    .sort(compareMedia)[0] || null;
  const heroSafe = (asset) => !isHeroProductionUnsafe(asset, options);
  const containedSourcePhoto = gallery.find(isBoundContainedSourceProof) || null;
  const sourcePhoto = assets
    .filter((asset) => asset.kind === "photo" && asset.hero_eligible !== false && !isExplicitlySmall(asset, options.minHeroArea) && heroSafe(asset))
    .sort(compareMedia)[0] || gallery.find((asset) => asset.hero_eligible !== false && heroSafe(asset)) || null;
  const verifiedSourcePhoto = sourcePhoto
    && hasUsablePhotoDimensions(sourcePhoto.width, sourcePhoto.height)
    ? sourcePhoto
    : null;

  const hero = sourceVideo
    ? {
        ...sourceVideo,
        presentation: "source-video",
        truthful_source: true,
        motion_fallback: false,
      }
    : verifiedSourcePhoto
      ? {
          ...verifiedSourcePhoto,
          kind: "photo",
          presentation: "photo-cinematic-light",
          truthful_source: true,
          motion_fallback: true,
          motion_treatment: "cinematic-light-shader",
          reduced_motion_treatment: "static-photo",
        }
    : containedSourcePhoto
      ? null
    : ambianceVideo
      ? {
          ...ambianceVideo,
          presentation: "ai-ambiance-video",
          truthful_source: false,
          proof_eligible: false,
          motion_fallback: false,
        }
      : sourcePhoto
        ? {
            ...sourcePhoto,
            kind: "photo",
            presentation: "photo-cinematic-light",
            truthful_source: true,
            motion_fallback: true,
            motion_treatment: "cinematic-light-shader",
            reduced_motion_treatment: "static-photo",
          }
        : null;

  return {
    mode: sourceVideo ? "source-video" : verifiedSourcePhoto ? "photo-cinematic-light" : containedSourcePhoto ? "contained-source-proof" : ambianceVideo ? "ai-ambiance-video" : sourcePhoto ? "photo-cinematic-light" : "none",
    hero,
    sourceVideo,
    unsupportedSourceVideo,
    ambianceVideo,
    containedSourcePhoto,
    sourcePhoto,
    motionFallback: sourceVideo ? null : hero,
    gallery,
    galleryPhotos: gallery,
    hasSourceVideo: Boolean(sourceVideos.length),
    hasPlayableSourceVideo: Boolean(sourceVideo),
    hasAmbianceVideo: Boolean(ambianceVideo),
    maxGalleryPhotos: MAX_PREMIER_GALLERY_PHOTOS,
  };
}

export const buildPremierMedia = selectPremierMedia;

export function selectPremierGallery(input, options = {}) {
  return selectGalleryFromAssets(preparePremierMedia(input), options);
}

export function preparePremierMedia(input) {
  const prepared = collectMediaValues(input)
    .map(normalizeMediaAsset)
    .filter(Boolean)
    .sort(compareMedia);
  const seen = new Set();

  return prepared.filter((asset) => {
    const identity = canonicalMediaIdentity(asset.url);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function isTruthfulSourceAsset(value) {
  return Boolean(normalizeMediaAsset(value));
}

export function renderPremierHeroMedia(input, options = {}) {
  const selection = isPremierMediaSelection(input) ? input : selectPremierMedia(input, options);
  const hero = selection.hero;
  if (!hero) return renderSourcePhotoContactSheet(selection, options);

  const src = safeMediaUrl(hero.url);
  if (!src) return "";
  const businessName = cleanText(options.businessName || input?.business?.name || input?.biz?.name || "");
  const provenance = cleanText(hero.source || "source");

  if (selection.mode === "source-video" && hero.kind === "video") {
    const label = cleanText(hero.label) || `${businessName || "Business"} source video`;
    return renderVideoMedia({ hero, selection, src, label, provenance, className: "premier-media--source-video" });
  }

  if (selection.mode === "ai-ambiance-video" && hero.kind === "video") {
    const label = cleanText(hero.label) || `${businessName || "Business"} cinematic brand concept`;
    return renderVideoMedia({ hero, selection, src, label, provenance: "ai-ambiance", className: "premier-media--ai-ambiance-video", disclosure: true });
  }

  const alt = cleanText(hero.label) || `${businessName || "Business"} source photo`;
  return `<div class="premier-media premier-media--cinematic-light-photo" data-media-kind="photo" data-media-provenance="${escapeHtmlAttribute(provenance)}" data-motion-treatment="cinematic-light-shader" data-reduced-motion="static"><img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" loading="eager" decoding="async" fetchpriority="high"></div>`;
}

function renderSourcePhotoContactSheet(selection, options = {}) {
  const businessName = cleanText(options.businessName || "Business");
  const heroGallery = selection.mode === "contained-source-proof"
    ? (selection.gallery || []).filter(isBoundContainedSourceProof)
    : (selection.gallery || []);
  const photos = heroGallery
    .filter((asset) => asset?.kind === "photo")
    .map((asset) => ({ ...asset, safeUrl: safeMediaUrl(asset.url) }))
    .filter((asset) => asset.safeUrl)
    .slice(0, 3);
  if (!photos.length) return "";
  const contained = photos.every(isBoundContainedSourceProof);
  const provenance = cleanText(photos[0].source || "business-site");
  const figures = photos.map((asset, index) => {
    const alt = cleanText(asset.label) || `${businessName} source photo ${index + 1}`;
    const intrinsicSize = asset.width && asset.height
      ? ` width="${asset.width}" height="${asset.height}"`
      : "";
    const containedMotion = contained
      ? ' data-media-kind="photo" data-motion-treatment="cinematic-light-shader" data-reduced-motion="static"'
      : "";
    return `<figure class="premier-source-sheet__item premier-source-sheet__item--${index + 1}"${containedMotion}><img src="${escapeHtmlAttribute(asset.safeUrl)}" alt="${escapeHtmlAttribute(alt)}"${intrinsicSize} loading="eager" decoding="async"${index === 0 ? ' fetchpriority="high"' : ""}></figure>`;
  }).join("");
  const className = contained
    ? "premier-media premier-media--source-photo-contact-sheet premier-media--contained-source-proof"
    : "premier-media premier-media--source-photo-contact-sheet";
  const presentation = contained ? "contained-source-proof" : "inset-contact-sheet";
  return `<div class="${className}" data-media-kind="source-photo-contact-sheet" data-media-provenance="${escapeHtmlAttribute(provenance)}" data-media-presentation="${presentation}" data-source-photo-count="${photos.length}" data-reduced-motion="static">${figures}</div>`;
}

export function renderPremierGallery(input, options = {}) {
  const selection = isPremierMediaSelection(input) ? input : selectPremierMedia(input, options);
  const businessName = cleanText(options.businessName || input?.business?.name || input?.biz?.name || "Business");
  const figures = selection.gallery.slice(0, MAX_PREMIER_GALLERY_PHOTOS).map((asset, index) => {
    const src = safeMediaUrl(asset.url);
    if (!src) return "";
    const alt = cleanText(asset.label) || `${businessName} source photo ${index + 1}`;
    return `<figure class="premier-gallery__item"><img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" loading="lazy" decoding="async"></figure>`;
  }).filter(Boolean);
  return figures.length ? `<div class="premier-gallery" data-gallery-source="business" data-gallery-count="${figures.length}">${figures.join("")}</div>` : "";
}

export function safeMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || raw.includes("\\")) return "";
  if (raw.startsWith("//")) return safeMediaUrl(`https:${raw}`);

  if (/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  if (raw.startsWith("#") || raw.startsWith("?")) return "";
  return raw;
}

export function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function videoMimeType(value) {
  const asset = value && typeof value === "object" ? value : { url: value };
  const declared = cleanText(asset.mime || asset.mime_type || asset.content_type || asset.meta?.mime || "")
    .toLowerCase()
    .split(";", 1)[0];
  if (declared.startsWith("video/")) return declared;
  const url = String(asset.url || asset.src || asset.public_url || asset.original_url || asset.local_path || "");
  const extension = url.match(/\.([a-z\d]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return VIDEO_MIME_BY_EXTENSION.get(extension) || "";
}

export function isBrowserPlayableVideo(value) {
  return BROWSER_HERO_VIDEO_MIMES.has(videoMimeType(value));
}

function renderVideoMedia({ hero, selection, src, label, provenance, className, disclosure = false }) {
  const poster = selectVideoPoster(hero, selection);
  const posterAttribute = poster ? ` poster="${escapeHtmlAttribute(poster)}"` : "";
  const mime = videoMimeType({ ...hero, url: src });
  const typeAttribute = mime ? ` type="${escapeHtmlAttribute(mime)}"` : "";
  const fallback = poster
    ? `<img class="premier-video-fallback" data-reduced-motion-fallback src="${escapeHtmlAttribute(poster)}" alt="${escapeHtmlAttribute(label)}" loading="eager" decoding="async">`
    : `<span class="premier-video-fallback premier-video-fallback--neutral" data-reduced-motion-fallback role="img" aria-label="${escapeHtmlAttribute(label)}"></span>`;
  const proofAttribute = disclosure ? ' data-proof-eligible="false"' : "";
  const aiAttributes = disclosure
    ? ' data-ai-media="true" data-ai-label="AI-generated ambiance — not job proof" data-media-source="ai-ambiance" data-media-role="ambiance"'
    : "";
  const disclosureHtml = disclosure ? '<span class="media-disclosure">AI-generated ambiance · not job proof</span>' : "";
  return `<div class="premier-media ${className}" data-media-kind="video" data-media-provenance="${escapeHtmlAttribute(provenance)}" data-reduced-motion="poster-fallback"${proofAttribute}${aiAttributes}>${fallback}<video autoplay muted loop playsinline preload="metadata" aria-label="${escapeHtmlAttribute(label)}"${posterAttribute}><source src="${escapeHtmlAttribute(src)}"${typeAttribute}></video>${disclosureHtml}<style>.premier-media[data-reduced-motion="poster-fallback"]>[data-reduced-motion-fallback]{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#111}.premier-media[data-reduced-motion="poster-fallback"]>video{display:block}@media (prefers-reduced-motion: reduce){.premier-media[data-reduced-motion="poster-fallback"]>video{display:none!important}.premier-media[data-reduced-motion="poster-fallback"]>[data-reduced-motion-fallback]{display:block!important}}</style></div>`;
}

function selectVideoPoster(hero, selection) {
  const values = [
    hero.poster,
    hero.poster_url,
    hero.posterUrl,
    hero.thumbnail,
    hero.thumbnail_url,
    hero.thumbnailUrl,
    hero.meta?.poster,
    hero.metadata?.poster,
    ...selection.gallery
      .filter((asset) => !isBoundContainedSourceProof(asset))
      .map((asset) => asset?.url),
    ...(selection.sourcePhoto && !isBoundContainedSourceProof(selection.sourcePhoto)
      ? [selection.sourcePhoto.url]
      : []),
  ];
  for (const value of values) {
    const poster = safeMediaUrl(value);
    if (poster && IMAGE_EXT.test(poster)) return poster;
  }
  return "";
}

function collectMediaValues(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];

  const values = [];
  const append = (items, kind) => {
    if (!Array.isArray(items)) return;
    for (const item of items) values.push(typeof item === "string" && kind ? { kind, url: item } : item);
  };

  append(input.media?.catalog);
  append(input.sourceAssets);
  append(input.source_assets);
  append(input.assets);
  append(input.source?.assets);
  append(input.discovery?.assets);
  append(input.media?.photos, "photo");
  append(input.media?.videos, "video");
  append(input.photos, "photo");
  append(input.videos, "video");
  return values;
}

function selectAmbianceVideo(input) {
  return collectMediaValues(input)
    .map(normalizeAmbianceVideo)
    .filter(Boolean)
    .filter(isBrowserPlayableVideo)
    .sort(compareMedia)[0] || null;
}

function normalizeAmbianceVideo(value) {
  const raw = typeof value === "string" ? { url: value } : value;
  if (!raw || typeof raw !== "object" || raw.approved === false) return null;
  const url = safeMediaUrl(raw.url || raw.src || raw.public_url || raw.original_url);
  if (!url || PLACEHOLDER_HOST.test(url)) return null;
  const typeHint = `${raw.kind || ""} ${raw.type || ""} ${raw.mime || raw.mime_type || raw.content_type || ""}`.toLowerCase();
  if (!/video/.test(typeHint) && !VIDEO_EXT.test(url)) return null;
  const source = sourceLabel(raw.source || raw.origin || raw.provenance || raw.meta?.source || raw.metadata?.source);
  const role = cleanText(raw.role || raw.usage || "").toLowerCase();
  const generated = raw.generated === true || raw.ai_generated === true || NON_SOURCE_HINT.test(source) || /ambiance|brand-film|concept/.test(role);
  if (!generated || !/ai|ambiance|generated|synthetic|veo/.test(`${source} ${role}`)) return null;
  return {
    ...raw,
    kind: "video",
    url,
    source: "ai-ambiance",
    role: "ambiance",
    label: cleanText(raw.label || raw.alt || raw.title || "Cinematic brand concept"),
    width: dimension(raw.width ?? raw.meta?.width ?? raw.metadata?.width),
    height: dimension(raw.height ?? raw.meta?.height ?? raw.metadata?.height),
    area: 0,
    hero_eligible: true,
    proof_eligible: false,
    truthful_source: false,
  };
}

function normalizeMediaAsset(value) {
  const raw = typeof value === "string" ? { url: value } : value;
  if (!raw || typeof raw !== "object" || raw.approved === false || raw.truthful === false || raw.real === false) return null;
  if (raw.generated === true || raw.ai_generated === true || raw.meta?.fallback_to_ambiance === true) return null;

  const url = safeMediaUrl(raw.url || raw.src || raw.public_url || raw.original_url);
  if (!url || PLACEHOLDER_HOST.test(url) || STOCK_HOST.test(url) || SVG_EXT.test(url)) return null;

  const typeHint = `${raw.kind || ""} ${raw.type || ""} ${raw.mime || raw.mime_type || raw.content_type || ""}`.toLowerCase();
  const kind = /video/.test(typeHint) || VIDEO_EXT.test(url)
    ? "video"
    : /photo|image/.test(typeHint) || IMAGE_EXT.test(url) || !typeHint.trim()
      ? "photo"
      : null;
  if (!kind) return null;

  const label = cleanText(raw.label || raw.alt || raw.title || "");
  const role = cleanText(raw.role || raw.usage || "");
  const source = sourceLabel(raw.source || raw.origin || raw.provenance || raw.meta?.source || raw.metadata?.source);
  const hintText = `${url} ${label} ${role} ${source}`.toLowerCase();
  if (["logo", "trust_mark"].includes(raw.kind) || LOGO_HINT.test(hintText) || NON_SOURCE_HINT.test(source) || NON_SOURCE_HINT.test(role)) return null;

  const width = dimension(raw.width ?? raw.meta?.width ?? raw.metadata?.width ?? raw.dimensions?.width);
  const height = dimension(raw.height ?? raw.meta?.height ?? raw.metadata?.height ?? raw.dimensions?.height);
  const area = width && height ? width * height : 0;

  return {
    ...raw,
    kind,
    url,
    source,
    label: label || null,
    role: role || null,
    width,
    height,
    area,
    hero_eligible: raw.hero_eligible !== false && raw.heroEligible !== false,
    proof_eligible: raw.proof_eligible !== false && raw.proofEligible !== false,
    truthful_source: true,
  };
}

function selectGalleryFromAssets(assets, options) {
  const requested = Number.isFinite(Number(options.limit)) ? Math.floor(Number(options.limit)) : MAX_PREMIER_GALLERY_PHOTOS;
  const limit = Math.max(0, Math.min(MAX_PREMIER_GALLERY_PHOTOS, requested));
  return assets
    .filter((asset) => (
      asset.kind === "photo"
      && asset.proof_eligible !== false
      && (isBoundContainedSourceProof(asset) || !isExplicitlySmall(asset, options.minGalleryArea))
    ))
    .sort(compareMedia)
    .slice(0, limit);
}

function compareMedia(a, b) {
  return qualityTier(b) - qualityTier(a)
    || Number(b.area || 0) - Number(a.area || 0)
    || Math.max(b.width || 0, b.height || 0) - Math.max(a.width || 0, a.height || 0)
    || sourcePriority(b.source) - sourcePriority(a.source)
    || Number(b.relevance_score || b.relevanceScore || b.curation_priority || 0) - Number(a.relevance_score || a.relevanceScore || a.curation_priority || 0)
    || a.url.localeCompare(b.url);
}

function qualityTier(asset) {
  const area = Number(asset.area || 0);
  const shortEdge = Math.min(asset.width || 0, asset.height || 0);
  if (!area) return 1;
  if (area >= 2_000_000 && shortEdge >= 900) return 4;
  if (area >= 1_000_000 && shortEdge >= 640) return 3;
  if (area >= 480_000 && shortEdge >= 480) return 2;
  return 0;
}

// Production hero-geometry safety (frozen QC gate: qc-audit/qc.mjs, 2.2x max
// photo upscale at a 1440x960 viewport). A full-bleed flagship hero can render
// up to ~1440x1380 CSS px in serverless capture, and serverless font/layout
// drift means a photo that measures 2.18x locally can exceed 2.2x in
// production (job_1sG0DAWB2_GQ / job_cSbLJas6W3qx: 900x601 source, 2.183x
// local, blocked twice in production). Selection therefore requires a margin:
// a photo with VERIFIED dimensions must project to <= 2.0x against the worst
// case hero box before it can carry the hero. Unsafe photos keep their
// gallery/proof roles; the hero falls back to the next verified-safe photo or
// the truthful ambiance path. The QC threshold itself is untouched.
export const HERO_PRODUCTION_BOX = Object.freeze({ width: 1440, height: 1380 });
export const HERO_MAX_PRODUCTION_UPSCALE = 2.0;

function isHeroProductionUnsafe(asset, options = {}) {
  if (!asset || !asset.width || !asset.height) return false; // unknown dims: unchanged behavior
  const box = options.heroBox && options.heroBox.width > 0 && options.heroBox.height > 0
    ? options.heroBox
    : HERO_PRODUCTION_BOX;
  const limit = Number(options.maxHeroUpscale) > 0 ? Number(options.maxHeroUpscale) : HERO_MAX_PRODUCTION_UPSCALE;
  const projected = Math.max(box.width / Number(asset.width), box.height / Number(asset.height));
  return projected > limit;
}

function isExplicitlySmall(asset, configuredMinimum) {
  if (!asset.width || !asset.height) return false;
  const minimum = Number.isFinite(Number(configuredMinimum)) ? Math.max(0, Number(configuredMinimum)) : 300_000;
  return asset.area < minimum || Math.max(asset.width, asset.height) < 640 || Math.min(asset.width, asset.height) < 320;
}

function sourcePriority(value) {
  const source = String(value || "").toLowerCase();
  if (/owner|upload|client|intake/.test(source)) return 5;
  if (/gbp|google|business-profile/.test(source)) return 4;
  if (/business|official|site|website/.test(source)) return 3;
  return 2;
}

function canonicalMediaIdentity(value) {
  const safe = safeMediaUrl(value);
  if (!safe) return "";
  try {
    const parsed = new URL(safe, "https://siteforge.invalid/");
    parsed.hash = "";
    for (const key of ["auto", "crop", "dpr", "fit", "fm", "format", "h", "height", "q", "quality", "w", "width"]) parsed.searchParams.delete(key);
    const path = parsed.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z\d]+$)/i, "");
    return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}?${[...parsed.searchParams].sort().map(([key, val]) => `${key}=${val}`).join("&")}`;
  } catch {
    return safe.replace(/[?#].*$/, "").toLowerCase();
  }
}

function sourceLabel(value) {
  if (value && typeof value === "object") value = value.value || value.name || value.type;
  return cleanText(value || "source").toLowerCase();
}

function dimension(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function cleanText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function isPremierMediaSelection(value) {
  return Boolean(value && typeof value === "object" && ["source-video", "contained-source-proof", "ai-ambiance-video", "photo-cinematic-light", "none"].includes(value.mode) && Array.isArray(value.gallery));
}
