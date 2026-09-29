const IMAGE_EXT = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(?:m4v|mov|mp4|og[gv]|webm)(?:[?#]|$)/i;
const STOCK_HOST = /(?:images\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com)/i;
const PLACEHOLDER_HOST = /(?:loremflickr\.com|picsum\.photos|placehold(?:\.co|er\.com)|dummyimage\.com|via\.placeholder\.com)/i;
const AVATAR_OR_PLACEHOLDER_MEDIA = /(?:randomuser\.me|pravatar\.cc|(?:^|[./])gravatar\.com|secure\.gravatar\.com|ui-avatars\.com|robohash\.org|api\.dicebear\.com|stock[-_ /]?avatar|placeholder[-_ /]?avatar)/i;
const PLACEHOLDER_HINT = /(?:^|[/_. -])placeholder(?:[/_. -]|$)/i;
const LOGO_HINT = /(?:^|[\s/_-])(?:brandmark|favicon|icon|logo|logomark|wordmark)(?:[\s/_.-]|$)/i;
const HERO_HINT = /\b(?:banner|cover|featured|hero|masthead|project|portfolio|service|work)\b/i;
const PROOF_HINT = /\b(?:after|before|gallery|job|portfolio|project|showcase|work)\b/i;
const GENERIC_LABEL = /^(?:(?:source|website|business)\s+)?(?:image|media|photo)(?:\s+\d+)?$/i;

export const PROSPECT_PHOTO_MINIMUMS = Object.freeze({
  width: 640,
  height: 320,
  pixels: 300_000,
});

// A smaller, identity-verified business photo may still be useful as contained
// proof when it is never stretched into a hero or service-media crop. This is
// intentionally separate from the production photo floor above.
export const CONTAINED_SOURCE_PHOTO_MINIMUMS = Object.freeze({
  width: 320,
  height: 320,
  pixels: 120_000,
});

const TRADE_TERMS = {
  automotive: ["auto", "automotive", "car", "garage", "mechanic", "vehicle"],
  concrete: ["concrete", "driveway", "foundation", "masonry", "patio", "slab"],
  electrical: ["electric", "electrical", "lighting", "panel", "wiring"],
  excavation: ["dirt", "earth", "excavat", "grading", "loader", "sitework", "trench"],
  fencing: ["fence", "fencing", "gate", "railing", "vinyl", "wood"],
  hvac: ["air-condition", "furnace", "heating", "hvac", "vent"],
  landscaping: ["garden", "hardscape", "irrigation", "landscap", "lawn", "outdoor", "sprinkler", "turf", "yard"],
  paving: ["asphalt", "driveway", "paver", "paving", "road"],
  plumbing: ["drain", "faucet", "pipe", "plumb", "sewer", "water"],
  roofing: ["gutter", "roof", "shingle", "solar"],
};

export function prepareMediaCatalog(packet, { limit = 30 } = {}) {
  const rawCatalog = Array.isArray(packet?.media?.catalog) ? packet.media.catalog : [];
  const category = normalizeTrade(packet?.business?.category);
  const logoUrls = collectLogoUrls(packet);
  const prepared = [];

  for (const rawValue of rawCatalog) {
    const raw = typeof rawValue === "string" ? { url: rawValue } : (rawValue || {});
    const url = String(raw.url || raw.local_path || "").trim();
    const key = canonicalMediaIdentity(url);
    if (!url || !key || isBannedProspectMedia(raw)) continue;

    const label = String(raw.label || "").trim();
    const role = String(raw.role || "").trim();
    const sourceRaw = String(raw.source || "site").trim().toLowerCase();
    const source = normalizeMediaSource(sourceRaw, url);
    const hintText = `${decodeForHints(url)} ${label} ${role}`.toLowerCase();
    if (raw.kind === "logo" || logoUrls.has(key) || LOGO_HINT.test(hintText)) continue;

    const mime = String(raw.mime || raw.mime_type || raw.content_type || raw.meta?.mime || "").trim().toLowerCase();
    const kind = raw.kind === "video" || mime.startsWith("video/") || VIDEO_EXT.test(url) ? "video" : "photo";
    const width = finiteDimension(raw.width ?? raw.meta?.width ?? raw.meta?.dimensions?.width);
    const height = finiteDimension(raw.height ?? raw.meta?.height ?? raw.meta?.dimensions?.height);
    const area = width * height;
    const semanticScore = scoreSemantics(hintText, category);
    const explicitHero = raw.hero_eligible === true;
    const tooSmall = Boolean(width && height && (width < 640 || height < 320));
    const opaque = isOpaqueUrl(url);
    const generic = !label || GENERIC_LABEL.test(label);
    const trustedSource = source === "upload" || source === "gbp";
    const generalHero = HERO_HINT.test(hintText);
    const containedSourceProof = isBoundContainedSourceProof(raw)
      && hasUsableContainedSourceDimensions(width, height);
    if (
      kind === "photo"
      && source !== "stock-ambiance"
      && !hasUsablePhotoDimensions(width, height)
      && !containedSourceProof
    ) continue;

    let heroEligible = raw.hero_eligible !== false && !tooSmall;
    if (kind === "photo" && source === "site") {
      heroEligible = heroEligible && (explicitHero || semanticScore > 0 || generalHero || (area >= 900_000 && !opaque));
      if (opaque && generic && !explicitHero && semanticScore === 0 && !generalHero) heroEligible = false;
    }
    if (trustedSource || source === "stock-ambiance" || kind === "video") heroEligible = raw.hero_eligible !== false && !tooSmall;

    const proofEligible = raw.proof_eligible === true
      || (raw.proof_eligible !== false && source !== "stock-ambiance" && (trustedSource || PROOF_HINT.test(hintText)));
    if (!heroEligible && !proofEligible) continue;
    const sourceScore = source === "upload" ? 80 : source === "gbp" ? 70 : source === "site" ? 55 : source === "stock-ambiance" ? 20 : 35;
    const curatedPriority = Math.max(0, Math.min(10, Number(raw.curation_priority || 0)));
    const relevance_score = sourceScore + semanticScore * 12 + curatedPriority * 4 + (generalHero ? 8 : 0) + Math.min(10, Math.floor(area / 500_000));

    prepared.push({
      ...raw,
      kind,
      url,
      source,
      label: label || null,
      role: role || null,
      width,
      height,
      hero_eligible: heroEligible,
      proof_eligible: proofEligible,
      relevance_score,
      media_identity: key,
      perceptual_hash: cleanPerceptualHash(raw.perceptual_hash || raw.meta?.perceptual_hash),
    });
  }

  const seenUrls = new Set();
  const seenPerceptualHashes = [];
  return prepared
    .sort(compareMedia)
    .filter((asset) => {
      if (seenUrls.has(asset.media_identity)) return false;
      if (asset.perceptual_hash && seenPerceptualHashes.some((hash) => perceptualHashesCollide(hash, asset.perceptual_hash))) return false;
      seenUrls.add(asset.media_identity);
      if (asset.perceptual_hash) seenPerceptualHashes.push(asset.perceptual_hash);
      return true;
    })
    .slice(0, limit);
}

export function hasHeroMedia(catalog) {
  return Array.isArray(catalog) && catalog.some((item) => item?.hero_eligible !== false && ["photo", "video"].includes(item?.kind));
}

export function normalizeTrade(category = "") {
  const value = String(category).toLowerCase();
  for (const [trade, terms] of Object.entries(TRADE_TERMS)) {
    if (terms.some((term) => value.includes(term))) return trade;
  }
  return "default";
}

function collectLogoUrls(packet) {
  const values = [
    packet?.logo_source?.chosen_url,
    packet?.logo_source?.remastered_path,
    packet?.logo_source?.url,
    packet?.enrichment_sources?.logo?.value,
    ...(Array.isArray(packet?.source?.logoCandidates) ? packet.source.logoCandidates.map((item) => item?.url) : []),
  ];
  return new Set(values.map(canonicalMediaIdentity).filter(Boolean));
}

function scoreSemantics(text, trade) {
  const terms = TRADE_TERMS[trade] || [];
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function compareMedia(a, b) {
  return Number(b.hero_eligible) - Number(a.hero_eligible)
    || Number(b.kind === "video") - Number(a.kind === "video")
    || Number(b.relevance_score || 0) - Number(a.relevance_score || 0)
    || (b.width * b.height) - (a.width * a.height)
    || a.url.localeCompare(b.url);
}

export function canonicalMediaIdentity(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "https://siteforge.local");
    parsed.hash = "";
    parsed.pathname = parsed.pathname
      .replace(/\/:\/.*$/, "")
      .replace(/-\d{2,5}x\d{2,5}(?=\.[a-z\d]+$)/i, "")
      .replace(/\/{2,}/g, "/");
    for (const key of ["auto", "crop", "dpr", "fit", "fm", "format", "h", "height", "q", "quality", "w", "width"]) {
      parsed.searchParams.delete(key);
    }
    return `${parsed.hostname.toLowerCase()}${decodeForHints(parsed.pathname).toLowerCase()}?${[...parsed.searchParams].sort().map(([key, val]) => `${key}=${val}`).join("&")}`;
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\\/g, "/").toLowerCase();
  }
}

export function hasUsablePhotoDimensions(widthValue, heightValue) {
  const width = finiteDimension(widthValue);
  const height = finiteDimension(heightValue);
  return width >= PROSPECT_PHOTO_MINIMUMS.width
    && height >= PROSPECT_PHOTO_MINIMUMS.height
    && width * height >= PROSPECT_PHOTO_MINIMUMS.pixels;
}

export function hasUsableContainedSourceDimensions(widthValue, heightValue) {
  const width = finiteDimension(widthValue);
  const height = finiteDimension(heightValue);
  return width >= CONTAINED_SOURCE_PHOTO_MINIMUMS.width
    && height >= CONTAINED_SOURCE_PHOTO_MINIMUMS.height
    && width * height >= CONTAINED_SOURCE_PHOTO_MINIMUMS.pixels;
}

export function isBoundContainedSourceProof(asset = {}) {
  const identityEvidence = Array.isArray(asset?.meta?.identity_evidence)
    ? asset.meta.identity_evidence.map((value) => String(value || "").trim().toLowerCase())
    : [];
  const nameEvidence = identityEvidence.find((value) => /^name:[a-z0-9]{3,}(?:\+[a-z0-9]{3,}){0,3}$/.test(value)) || "";
  const hasNameEvidence = Boolean(nameEvidence);
  const hasContactOrCityEvidence = identityEvidence.some((value) => (
    value === "phone:last7"
    || /^city:[a-z0-9]{3,}(?:\+[a-z0-9]{3,}){0,2}$/.test(value)
  ));
  const source = `${asset?.source || ""} ${asset?.origin || ""}`.toLowerCase();
  const provenance = asset?.provenance || asset?.meta?.source_provenance || {};
  const ownerKey = String(provenance.owner_key || "").trim();
  const ownerTokens = new Set(ownerKey.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const nameTokens = nameEvidence.replace(/^name:/, "").split("+").filter(Boolean);
  const nameBoundToOwner = nameTokens.length > 0 && nameTokens.every((token) => ownerTokens.has(token));
  let provenanceHost = String(provenance.source_host || "").trim().toLowerCase().replace(/^www\./, "");
  if (!provenanceHost) {
    try { provenanceHost = new URL(String(provenance.source_url || "")).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { provenanceHost = ""; }
  }
  const googleBusinessHost = provenanceHost === "google.com"
    || provenanceHost.endsWith(".google.com")
    || provenanceHost === "maps.app.goo.gl";
  return asset?.kind === "photo"
    && asset?.hero_eligible === false
    && asset?.proof_eligible === true
    && asset?.meta?.contained_source === true
    && asset?.meta?.display_policy === "contained-source-proof"
    && hasNameEvidence
    && nameBoundToOwner
    && hasContactOrCityEvidence
    && /\bgbp(?:-deep)?\b|\bbusiness-profile\b/.test(source)
    && googleBusinessHost
    && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(ownerKey);
}

export function isBannedProspectMedia(value) {
  const raw = value && typeof value === "object" ? value : { url: value };
  const evidence = [
    raw.url,
    raw.src,
    raw.local_path,
    raw.label,
    raw.role,
    raw.source,
    raw.origin,
  ].filter(Boolean).join(" ");
  return PLACEHOLDER_HOST.test(evidence) || AVATAR_OR_PLACEHOLDER_MEDIA.test(evidence) || PLACEHOLDER_HINT.test(evidence);
}

export function perceptualHashesCollide(leftValue, rightValue, maximumDistance = 5) {
  const left = cleanPerceptualHash(leftValue);
  const right = cleanPerceptualHash(rightValue);
  if (!left || !right) return false;
  if (left === right) return true;
  if (!/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) return false;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let xor = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (xor) {
      distance += xor & 1;
      if (distance > maximumDistance) return false;
      xor >>= 1;
    }
  }
  return distance <= maximumDistance;
}

function decodeForHints(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function finiteDimension(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cleanPerceptualHash(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMediaSource(source, url) {
  if (source === "stock-ambiance" || STOCK_HOST.test(url)) return "stock-ambiance";
  if (/upload|owner|manual|intake/.test(source)) return "upload";
  if (/\bgbp\b|google|business-profile/.test(source)) return "gbp";
  if (/site|web|crawl|discover/.test(source)) return "site";
  return source || "site";
}

function isOpaqueUrl(value) {
  try {
    const parsed = new URL(value, "https://siteforge.local");
    const path = parsed.pathname.toLowerCase();
    return !IMAGE_EXT.test(path) && !VIDEO_EXT.test(path) && !/[?&](?:fm|format|url)=/i.test(parsed.search);
  } catch {
    return !IMAGE_EXT.test(value) && !VIDEO_EXT.test(value);
  }
}
