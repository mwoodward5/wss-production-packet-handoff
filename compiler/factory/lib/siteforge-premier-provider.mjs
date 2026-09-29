import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "../pipeline/05-build-v8.mjs";
import { runPreparedBuild } from "./build-runtime.mjs";
// Re-exported so runtime consumers (engine adapter staged capture stages)
// reach every V8 surface through this single provider module.
export { captureScreenshotsForViewport, finalizeScreenshotManifest } from "../pipeline/05-build-v8.mjs";

const PUBLIC_CONTAMINATION = /pagehub|ricardo|firecrawl|brightlocal|brightdata|leadminer|ghost agency|truth_packet|\bscrap(?:e|er|ing)\b|\bcrawler\b|\bvapi\b|\btwilio\b|\bwss\b/i;
const HTTP_URL = /^https?:\/\//i;
const HERO_FAMILIES = new Set([
  "cinematic-video-parallax",
  "split-editorial-index",
  "service-map-pins",
  "material-lab-swatch",
  "magazine-owner-letter",
  "atlas-grid-reveal",
]);
const LOGO_PROVENANCE_SOURCES = new Set([
  "owner-uploaded",
  "firecrawl-scrape",
  "gbp-scrape",
  "procedural-monogram",
  "fallback-textmark",
]);

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function sourceFact(value, extra = {}) {
  return { source: "build-request", value, ...extra };
}

function truthfulAddress(truth) {
  const street = String(truth.street_address || "").trim();
  if (!street) return null;
  const locality = [truth.city, [truth.state, truth.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (!locality || String(street).toLowerCase().includes(String(truth.city || "").toLowerCase())) return street;
  return `${street}, ${locality}`;
}

function normalizedHours(hours) {
  if (!Array.isArray(hours)) return { rows: [], specification: [] };
  const rows = [];
  const specification = [];
  for (const value of hours) {
    if (!value || !value.day) continue;
    const day = String(value.day).toLowerCase();
    if (value.closed === true) {
      rows.push({ day, hours: "Closed" });
      continue;
    }
    if (value.by_appointment === true) {
      rows.push({ day, hours: "By appointment" });
      continue;
    }
    if (!value.opens || !value.closes) continue;
    rows.push({ day, hours: `${value.opens}-${value.closes}` });
    specification.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `${day.charAt(0).toUpperCase()}${day.slice(1)}`,
      opens: value.opens,
      closes: value.closes,
    });
  }
  return { rows, specification };
}

function normalizeLogoProvenanceSource(value, { hasAsset = false } = {}) {
  if (!hasAsset) return "fallback-textmark";
  const source = String(value || "").trim().toLowerCase();
  if (LOGO_PROVENANCE_SOURCES.has(source)) return source;
  if (/\b(?:gbp|google(?: business)?(?: profile)?|places?)\b/.test(source)) return "gbp-scrape";
  if (/\b(?:firecrawl|scrap(?:e|ed|ing)|business[ -]?site|website|site)\b/.test(source)) return "firecrawl-scrape";
  if (/\b(?:procedural|monogram|generated[ -]?mark)\b/.test(source)) return "procedural-monogram";
  if (/\b(?:fallback|textmark|text[ -]?mark)\b/.test(source)) return "fallback-textmark";
  if (/\b(?:owner|upload(?:ed)?|client|intake|build[ -]?request)\b/.test(source)) return "owner-uploaded";
  return "owner-uploaded";
}

function logoInput(assets) {
  const logo = assets?.logo && typeof assets.logo === "object" ? assets.logo : {};
  const url = assets?.logo_url || logo.final_url || logo.chosen_url || logo.url || logo.raw_url || null;
  if (!url) return null;
  return compactObject({
    chosen_url: url,
    local_path: logo.local_path,
    origin: normalizeLogoProvenanceSource(logo.source, { hasAsset: true }),
    proposed: false,
    colors: Array.isArray(logo.colors) ? logo.colors : undefined,
  });
}

function mediaUrl(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const finals = value.final_urls;
  if (typeof finals === "string") return finals;
  if (Array.isArray(finals)) return finals[0] || null;
  return value.url || value.final_url || finals?.gallery || finals?.original || finals?.hero || value.source_url || null;
}

function assetMedia(assets = {}) {
  const values = [];
  for (const value of assets.photo_urls || []) values.push(typeof value === "string" ? { url: value } : value);
  if (Array.isArray(assets.photos)) values.push(...assets.photos);
  if (Array.isArray(assets.photos?.per_photo)) values.push(...assets.photos.per_photo);
  if (Array.isArray(assets.photos?.gallery_photo_urls)) values.push(...assets.photos.gallery_photo_urls.map((url) => ({ url })));

  const catalog = values.map((value) => compactObject({
    kind: "photo",
    url: mediaUrl(value),
    source: typeof value?.source === "string" ? value.source : "build-request",
    label: value?.alt || value?.label || undefined,
    width: value?.width || value?.dims?.w || value?.dims?.width || undefined,
    height: value?.height || value?.dims?.h || value?.dims?.height || undefined,
    truthful: value?.truthful !== false,
    verified: value?.verified === true,
    proof_eligible: value?.proof_eligible !== false,
  })).filter((item) => item.url);

  if (assets.hero_video_url) {
    catalog.unshift({
      kind: "video",
      url: assets.hero_video_url,
      source: "build-request",
      truthful: true,
      proof_eligible: true,
    });
  }
  return catalog.slice(0, 25);
}

function verifiedReviews(assets = {}) {
  if (!Array.isArray(assets.reviews)) return [];
  return assets.reviews
    .filter((review) => review && review.verified === true && review.text)
    .map((review) => compactObject({
      source: review.source,
      author: review.author,
      rating: review.rating,
      text: review.text,
      review_time_iso: review.review_time_iso,
      verified: true,
    }));
}

export function buildPremierPacket({ truthPacket, assets = {}, mode = "single-page-cinematic", buildId, prospectId, demo = true } = {}) {
  const truth = truthPacket;
  if (!truth?.business_name || !truth?.city || !truth?.state || !truth?.vertical) {
    throw new TypeError("buildPremierPacket requires normalized business_name, city, state, and vertical");
  }

  const address = truthfulAddress(truth);
  const hours = normalizedHours(truth.hours);
  const reviews = verifiedReviews(assets);
  const verifiedCredentials = (truth.license_credentials || []).filter((credential) => credential?.verified === true);
  const enrichment_sources = {};
  if (truth.phone_e164) enrichment_sources.phone = sourceFact(truth.phone_e164);
  if (truth.email) enrichment_sources.email = sourceFact(truth.email);
  if (truth.website_url) enrichment_sources.website = sourceFact(truth.website_url);
  if (address) enrichment_sources.address = sourceFact(address);
  if (truth.services?.length) enrichment_sources.services = sourceFact([...truth.services]);
  if (truth.service_area_cities?.length) enrichment_sources.service_areas = sourceFact([...truth.service_area_cities]);
  if (verifiedCredentials.length) enrichment_sources.credentials = sourceFact(verifiedCredentials.map((credential) => ({ ...credential })));
  if (hours.rows.length) enrichment_sources.hours = sourceFact(hours.rows, { hours_spec: hours.specification });
  if (reviews.length) enrichment_sources.reviews_attributed = sourceFact(reviews);
  if (truth.google_place_id) enrichment_sources.map_id = sourceFact(truth.google_place_id);

  return compactObject({
    slug: truth.slug,
    build_id: buildId,
    prospect_id: prospectId,
    forge: { demo: demo !== false },
    build_type: mode === "premier-multi-page" ? "premier_multi_page" : "single_page_cinematic",
    business: compactObject({
      name: truth.business_name,
      legal_name: truth.legal_name,
      category: truth.vertical,
      city: truth.city,
      state: truth.state,
      postal_code: truth.postal_code,
      address,
      phone: truth.phone_e164,
      current_website: truth.website_url,
      one_line_description: truth.one_line_description,
      established_year: truth.established_year,
    }),
    services: Array.isArray(truth.services) ? [...truth.services] : [],
    service_area_cities: Array.isArray(truth.service_area_cities) ? [...truth.service_area_cities] : [],
    license_credentials: (truth.license_credentials || []).map((credential) => ({ ...credential })),
    logo_source: logoInput(assets),
    media: { catalog: assetMedia(assets) },
    enrichment_sources,
    gbp: truth.google_place_id ? { pid: truth.google_place_id } : undefined,
  });
}

function readJson(outDir, file) {
  return JSON.parse(readFileSync(path.join(outDir, file), "utf8"));
}

function artifactUrl(base, file = "") {
  const root = new URL(String(base || ""));
  root.search = "";
  root.hash = "";
  if (!root.pathname.endsWith("/")) root.pathname = `${root.pathname}/`;
  return new URL(file, root).href;
}

async function configuredValue(value, context) {
  return typeof value === "function" ? value(context) : value;
}

function requireHttpUrl(value, label) {
  const url = String(value || "");
  if (!HTTP_URL.test(url)) throw new Error(`Premier provider requires an http(s) ${label}`);
  try {
    const parsed = new URL(url);
    if (!HTTP_URL.test(parsed.href)) throw new Error("invalid protocol");
    return parsed.href;
  } catch {
    throw new Error(`Premier provider requires a valid http(s) ${label}`);
  }
}

function logoProvenance(assets, renderedAssets) {
  const logo = assets?.logo && typeof assets.logo === "object" ? assets.logo : {};
  const renderedLogo = renderedAssets.items.find((item) => item.kind === "logo") || null;
  const performedStages = (logo.stages || []).filter((stage) => stage?.performed === true).map((stage) => stage.stage).filter(Boolean);
  const finalUrl = renderedLogo?.url || assets?.logo_url || logo.final_url || null;
  const extension = String(finalUrl || "").match(/\.([a-z\d]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return compactObject({
    source: normalizeLogoProvenanceSource(logo.source || renderedLogo?.source, { hasAsset: Boolean(finalUrl) }),
    verified: Boolean(finalUrl && logo.verified === true),
    stages_applied: performedStages,
    final_format: finalUrl ? (logo.final_format || (extension === "svg" ? "svg" : extension === "png" ? "png" : undefined)) : "textmark-html",
    final_url: finalUrl,
    delta_e_to_brand: Number.isFinite(Number(logo.delta_e_to_brand)) ? Number(logo.delta_e_to_brand) : undefined,
  });
}

function mediaProvenance(assets, renderedAssets, scorecard) {
  const sourceCatalog = assetMedia(assets);
  const renderedPhotos = renderedAssets.items.filter((item) => item.kind === "photo" && item.source !== "stock-ambiance");
  const verifiedCount = Number.isInteger(assets?.photos?.photos_verified_count)
    ? assets.photos.photos_verified_count
    : sourceCatalog.filter((item) => item.kind === "photo" && item.verified === true).length;
  const heroSource = scorecard.media?.hero_source || "scene";
  const heroType = heroSource === "video" ? "video" : heroSource === "photo" || heroSource === "provided-source" ? "cinematic-still" : "procedural-scene";
  return {
    photos_verified_count: verifiedCount,
    photos_ai_atmosphere_count: renderedAssets.items.filter((item) => item.source === "ai").length,
    photos_dropped_low_quality: Number.isInteger(assets?.photos?.photos_dropped_low_quality) ? assets.photos.photos_dropped_low_quality : 0,
    hero_media_type: heroType,
    hero_media_source: heroSource,
    gallery_photo_urls: renderedPhotos.map((item) => item.url).filter(Boolean).slice(0, 12),
  };
}

function optimizationManifest(authority) {
  const publicState = (status) => ({
    needs_owner_input: "needs-owner-input",
    runtime_verification: "runtime-verification",
    not_applicable: "not-applicable",
  })[status] || status;
  return {
    version: authority.standard,
    checks: authority.checks.map(({ status, ...check }) => ({ ...check, state: publicState(status) })),
  };
}

function qcSummary({ authority, html, publicText, scorecard, batchHamming }) {
  const heroLayers = new Set([...html.matchAll(/data-hero-layer="([^"]+)"/g)].map((match) => match[1])).size;
  const reducedMotion = scorecard.checks.find((check) => check.id === "reduced-motion")?.pass === true;
  const contamination = PUBLIC_CONTAMINATION.test(publicText) ? "blocked" : "clean";
  return {
    authority_score: authority.passed,
    authority_total: authority.total,
    hero_layers: heroLayers,
    batch_hamming_min: batchHamming,
    reduced_motion_pass: reducedMotion,
    contamination_check: contamination,
  };
}

function constrainedPremierInputs(premierInputs, { heroFamily, sectionsDisabled } = {}) {
  const disabled = new Set((sectionsDisabled || []).map((value) => String(value)));
  if (!heroFamily && disabled.size === 0) return premierInputs;
  const next = JSON.parse(JSON.stringify(premierInputs));
  if (heroFamily) {
    if (!HERO_FAMILIES.has(heroFamily)) throw new TypeError(`Unknown Premier hero family: ${heroFamily}`);
    next.archetype.hero_family = heroFamily;
  }
  if (disabled.size) {
    next.cadence.section_order = next.cadence.section_order.filter((section) => {
      if (disabled.has(section)) return false;
      return !(section === "atlas-service-map" && disabled.has("service-map"));
    });
  }
  return next;
}

async function renderPremier(context, options = {}) {
  if (!context?.premierInputs || !context?.truthPacket) throw new TypeError("runPremier requires premierInputs and truthPacket");
  const resolvedOptions = { ...(context.providerOptions || {}), ...options };
  const outDirValue = await configuredValue(resolvedOptions.outDir, context);
  const outDir = outDirValue || mkdtempSync(path.join(tmpdir(), "siteforge-premier-"));
  const packet = context.packet || buildPremierPacket({
    truthPacket: context.truthPacket,
    assets: context.assets || {},
    mode: context.mode,
    buildId: context.build_id,
    prospectId: context.prospect_id,
    demo: resolvedOptions.demo,
  });
  const premierInputs = constrainedPremierInputs(context.premierInputs, resolvedOptions);

  await build(packet, {
    outDir,
    capture: resolvedOptions.capture !== false,
    premierInputs,
  });
  return { outDir, packet, options: resolvedOptions, premierInputs };
}

export async function runPremier(context, options = {}) {
  const rendered = await renderPremier(context, options);
  const { outDir, packet } = rendered;
  options = rendered.options;

  const authority = readJson(outDir, "optimization-manifest.json");
  const scorecard = readJson(outDir, "scorecard.json");
  const renderedAssets = readJson(outDir, "assets.json");
  const html = readFileSync(path.join(outDir, "index.html"), "utf8");
  const publicText = ["packet.json", "sitemap.xml", "llms.txt"]
    .map((file) => readFileSync(path.join(outDir, file), "utf8"))
    .concat(html)
    .join("\n");
  const previewConfigured = await configuredValue(options.previewUrl, { ...context, outDir, packet });
  const artifactBaseConfigured = await configuredValue(options.artifactBaseUrl, { ...context, outDir, packet });
  const preview_url = requireHttpUrl(previewConfigured || artifactBaseConfigured, "preview URL");
  const reportConfigured = await configuredValue(options.reportUrl, { ...context, outDir, packet });
  const report_url = requireHttpUrl(reportConfigured || artifactUrl(preview_url, "optimization-manifest.json"), "report URL");
  const summary = qcSummary({
    authority,
    html,
    publicText,
    scorecard,
    batchHamming: context.batch_hamming_min,
  });
  const visualResult = typeof options.visualQc === "function"
    ? await options.visualQc({ context, outDir, packet, scorecard, authority })
    : false;
  const visual_qc_passed = visualResult === true || visualResult?.passed === true;
  const qc_passed = authority.failed === 0
    && authority.needs_owner_input === 0
    && authority.runtime_verification === 0
    && summary.contamination_check === "clean";

  const outputs = {
    html_url: preview_url,
    sitemap_url: artifactUrl(preview_url, "sitemap.xml"),
    llms_txt_url: artifactUrl(preview_url, "llms.txt"),
  };

  return {
    build_id: context.build_id,
    prospect_id: context.prospect_id,
    preview_url,
    preview_url_owner_only: options.previewUrlOwnerOnly !== false,
    report_url,
    ...(options.reportToken ? { report_token: options.reportToken } : {}),
    qc_passed,
    visual_qc_passed,
    qc_summary: summary,
    logo_provenance: logoProvenance(context.assets || {}, renderedAssets),
    media_provenance: mediaProvenance(context.assets || {}, renderedAssets, scorecard),
    optimization_manifest: optimizationManifest(authority),
    outputs,
    ...(options.checkout ? { checkout: { ...options.checkout } } : {}),
  };
}

export async function runPreparedPremier(context, options = {}) {
  const rendered = await renderPremier(context, options);
  return {
    build_id: context.build_id,
    prospect_id: context.prospect_id,
    packet: rendered.packet,
    outDir: rendered.outDir,
    premierInputs: rendered.premierInputs,
  };
}

export function createPremierProvider(options = {}) {
  return (context) => runPremier(context, options);
}

export function createPremierProviders(options = {}) {
  return { runPremier: createPremierProvider(options) };
}

export function createPreparedPremierProvider(options = {}) {
  return (context) => runPreparedPremier(context, options);
}

export async function runSiteforgePremierBuild(packet, options = {}) {
  const provider = createPreparedPremierProvider({
    ...(options.providerOptions || {}),
    outDir: options.outDir,
    capture: options.capture !== false,
    heroFamily: options.heroFamily || null,
    sectionsDisabled: options.sectionsDisabled || [],
  });
  return runPreparedBuild(packet, {
    providers: {
      store: options.store,
      idFactory: options.idFactory,
      runPremier: provider,
    },
    minHamming: options.minHamming,
    maxRetries: options.maxRetries,
    resonance: options.resonance || null,
    directives: options.directives || {},
    assets: options.assets || {},
    mode: options.mode || packet.build_type,
  });
}

export const createSiteforgePremierProvider = createPremierProvider;
export default createPremierProvider;
