// Source-first public intake. Adapted from the proven PageHub intake compiler:
// one prompt may contain a website, GBP/Maps, social, and asset-folder URLs.
// Firecrawl reads public sources server-side and returns a bounded evidence set.
import { importPublicDrive } from "./drive-intake.mjs";
import { parseGbpDeep } from "../../asset-pipeline/gbp-deep.mjs";

const FIRECRAWL = "https://api.firecrawl.dev/v2";
const PAGEHUB_COMPILER = process.env.PAGEHUB_INTAKE_URL || "https://pagehub-intake-lock-form.vercel.app/api/firecrawl-intake";
// A public preview needs the strongest pages, not an exhaustive crawl. Keeping
// this bounded also leaves enough of the serverless budget for visual QC.
const MAX_SOURCES = 5;
// Keep discovery broad enough for a human review packet while leaving the
// existing build-asset lane deliberately small. These entries are URL-only;
// no image bytes are fetched by this inventory pass.
const MAX_IMAGE_INVENTORY = 120;
const MAX_NAVIGATION_PAGES = 30;
// Full-site coverage (wave3, 2026-09-16): every same-domain content page the
// site map discovers is fetchable evidence — long-form articles, financing,
// rebates, coupons, FAQ and air-quality pages all qualify; there is no keyword
// whitelist. Env names match the PageHub api/firecrawl-intake.js lane so one
// env dial bounds both scrapers; the 40 default leaves headroom for supplied
// roots above the 30-page navigation inventory (MR A/C of Orlando measured
// 30 navigation_pages with only 3 actually read). A total byte budget
// (~48 MiB, the same ceiling as the backend local-source-intake lane) keeps a
// pathological site from stalling the pipeline.
const MAX_SCRAPE_URLS = Number(process.env.INTAKE_MAX_SCRAPE_URLS || 40);
const MAX_SCRAPE_BYTES = Number(process.env.INTAKE_MAX_SCRAPE_BYTES || 48 * 1024 * 1024);
const SCRAPE_CONCURRENCY = Number(process.env.INTAKE_SCRAPE_CONCURRENCY || 6);

export function urlsFromPrompt(value = "") {
  const matches = String(value).match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return unique(matches.map((url) => url.replace(/[.,;:!?]+$/, ""))).slice(0, MAX_SOURCES);
}

export function classifySourceUrl(value = "") {
  let host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch { return "website"; }
  if (/google\.|maps\.app\.goo\.gl/.test(host)) return "gbp";
  if (/facebook|instagram|tiktok|youtube|linkedin|nextdoor|yelp|x\.com|twitter/.test(host)) return "social";
  if (/drive\.google|dropbox|box\.com|sharepoint|onedrive/.test(host)) return "asset";
  return "website";
}

export function sourceFieldsFromPrompt(value = "") {
  const fields = {};
  for (const url of urlsFromPrompt(value)) {
    const kind = classifySourceUrl(url);
    const key = kind === "gbp" ? "gbp_url" : kind === "social" ? "social_url" : kind === "asset" ? "asset_url" : "website_url";
    if (!fields[key]) fields[key] = url;
  }
  return fields;
}

export async function collectSourceIntake(input, facts = {}) {
  const key = process.env.FIRECRAWL_API_KEY || "";
  const supplied = Object.values(input.sources || {}).filter(Boolean);
  const assetSources = supplied.filter((url) => classifySourceUrl(url) === "asset");
  const webSources = supplied.filter((url) => classifySourceUrl(url) !== "asset");
  const driveResults = (await Promise.all(assetSources.map(importPublicDrive))).filter(Boolean);
  // Photo-priority (Mark 2026-07-20): the business's OWN website photos are
  // primary. GBP is a bounded fallback only when the official site yields zero
  // approved photo/video evidence. That preserves a site's curated media when
  // it exists while avoiding an empty build for icon-only sites.
  const hasWebsite = webSources.some((url) => classifySourceUrl(url) === "website");
  const gbpSources = webSources.filter((url) => classifySourceUrl(url) === "gbp");
  const gbpResults = (!hasWebsite && key && gbpSources.length)
    ? (await Promise.all(gbpSources.map((u) => gbpDeepAssets(u, key, facts)))).filter(Boolean)
    : [];
  const supplementalResults = [...driveResults, ...gbpResults];
  if (!key) {
    const base = webSources.length ? await collectViaPageHub(webSources, facts) : emptyResult([], "No public web source was supplied and direct Firecrawl search is not configured.");
    return mergeSourceResults(base, supplementalResults);
  }

  const discovered = webSources.length || assetSources.length ? [] : await searchForBusiness(facts, key);
  const roots = unique([...webSources, ...discovered]).slice(0, MAX_SOURCES);
  if (!roots.length) return mergeSourceResults(emptyResult([], "No public web source URL could be resolved from the prompt."), supplementalResults);

  const expanded = [...roots];
  const rootIdentities = new Set(roots.map((url) => canonicalPageHref(url)).filter(Boolean));
  const mappedRoots = await Promise.all(
    roots.filter((item) => classifySourceUrl(item) === "website").map((url) => mapLikelyPages(url, key)),
  );
  for (const mapped of mappedRoots) {
    for (const child of mapped.selected) {
      if (expanded.length >= MAX_SCRAPE_URLS) break;
      // Without the keyword whitelist the site root also qualifies; a map link
      // back to "/" (or its trailing-slash twin) must not re-fetch a root page.
      if (rootIdentities.has(canonicalPageHref(child))) continue;
      if (!expanded.includes(child)) expanded.push(child);
    }
  }

  // Firecrawl requests are independent. Serial scraping could consume the
  // entire function duration before rendering began, so pages are fetched in
  // bounded concurrent batches; the byte budget stops the crawl once a huge
  // site's raw pages would starve the rest of the pipeline. Result order
  // follows the deterministic expanded order regardless of completion timing —
  // the packet feeds signed receipts, so ordering must be stable.
  const scraped = await scrapeSources(expanded.slice(0, MAX_SCRAPE_URLS), key);
  const pages = scraped.pages;
  const mappedNavigation = mappedRoots.flatMap((mapped) => mapped.navigation);
  const merged = mergePages(pages, roots, discovered, facts, mappedNavigation);
  if (scraped.note) merged.summary.notes = [...(merged.summary.notes || []), scraped.note].slice(0, 8);
  // NAP guard (E7.2): when the site came from open web search (not supplied by
  // the operator/GBP), require the page text to actually match the business —
  // name token AND/OR city/phone — before adopting its logo, photos, or copy.
  if (merged.summary.pages_read && (discovered.length || webSources.length)) {
    const hay = `${merged.found.copy || ""} ${merged.facts.name || ""}`.toLowerCase();
    const nameToken = String(facts.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3)[0] || "";
    const nameOk = nameToken && hay.includes(nameToken);
    const cityOk = facts.city && hay.includes(String(facts.city).toLowerCase());
    const phoneDigits = String(facts.phone || "").replace(/\D/g, "").slice(-7);
    const phoneOk = phoneDigits.length === 7 && hay.replace(/\D/g, "").includes(phoneDigits);
    if (!nameOk && !cityOk && !phoneOk) {
      return mergeSourceResults(emptyResult([], `${discovered.length ? "Web-searched" : "Listed"} site did not match ${facts.name || "the business"} (no name/city/phone agreement); its assets were not used.`), supplementalResults);
    }
  }
  if (!merged.summary.pages_read && roots.length) {
    const fallback = await collectViaPageHub(roots, facts);
    if (fallback.summary.pages_read || fallback.assets.length) return mergeSourceResults(fallback, supplementalResults);
  }
  // LOGO HUNT (Mark 2026-07-11): if their own site had no logo, go find one —
  // Google-search the business, probe candidate pages' og:image / logo imgs
  // (socials og:image is usually the real mark). Only then does the designed
  // brand pack take over.
  if (!merged.found.logo && key && facts.name) {
    try {
      const candidates = await searchForBusiness(facts, key);
      for (const cand of candidates.slice(0, 2)) {
        const page = await scrapeSource(cand, key);
        const og = page.metadata?.ogImage || page.metadata?.["og:image"] || "";
        // An ordinary social/share image is not a logo. Only admit og:image
        // when its URL itself carries explicit brand-mark evidence; markup
        // candidates still come from img/logo/brand/mark signals below.
        const logos = [
          ...(isLikelyLogoUrl(og) ? [og] : []),
          ...extractLogos(page),
        ].filter((u) => u && isPublicAsset(u) && !/=s\d{2,3}-c|rp-mo-br|\/stock\/|isteam\/stock|unsplash|pexels|shutterstock|placeholder/i.test(u));
        if (logos.length) {
          merged.found.logo = logos[0];
          merged.assets.unshift({
            kind: "logo",
            url: logos[0],
            label: "Logo (found via web search)",
            source: "web-search",
            origin: "source-intake",
            approved: true,
            meta: { logo_evidence: isLikelyLogoUrl(og) && logos[0] === og ? "og-logo-url" : "logo-markup" },
            provenance: assetProvenance(cand, merged.facts?.name),
          });
          merged.summary.logo_found = true;
          merged.summary.notes = [...(merged.summary.notes || []), `logo recovered via search: ${cand}`].slice(0, 8);
          break;
        }
      }
    } catch { /* designed brand mark remains the fallback */ }
  }
  let result = mergeSourceResults(merged, supplementalResults);
  const hasApprovedMedia = result.assets.some((asset) => (
    ["photo", "video"].includes(asset?.kind)
    && asset?.approved !== false
    && asset?.url
  ));
  if (hasWebsite && !hasApprovedMedia && gbpSources.length) {
    const verifiedGbpResults = (await Promise.all(
      gbpSources.map((url) => gbpDeepAssets(url, key, facts, { websiteFallback: true })),
    )).filter(Boolean);
    result = mergeSourceResults(result, verifiedGbpResults);
  }
  return result;
}

export function normalizeSourceColors(...values) {
  const colors = [];
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
      return;
    }
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi)) {
      const raw = match[0].slice(1);
      const normalized = `#${raw.length === 3 ? raw.split("").map((char) => char.repeat(2)).join("") : raw}`.toUpperCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      colors.push(normalized);
    }
  };
  values.forEach(visit);
  return colors;
}

export function normalizeSourceFonts(...values) {
  const fonts = [];
  const seen = new Set();
  const generic = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-(?:serif|sans-serif|monospace)|inherit|initial|unset)$/i;
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        if (/font|family|heading|display|body|primary|secondary/i.test(key)) visit(nested);
      }
      return;
    }
    if (typeof value !== "string") return;
    const text = value.replace(/^\s*font-family\s*:\s*/i, "");
    for (const part of text.split(",")) {
      const font = part.replace(/["']/g, "").trim().replace(/\s+/g, " ");
      if (!font || font.length > 80 || generic.test(font) || /^(?:https?:|var\(|#|\d)/i.test(font)) continue;
      const key = font.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fonts.push(font);
      if (fonts.length >= 6) return;
    }
  };
  values.forEach(visit);
  return fonts.slice(0, 6);
}

const NON_BUSINESS_EMAIL_DOMAIN = /(?:^|\.)(?:sentry(?:[-_][a-z0-9-]+)?|wixpress|wix|schema|example|gstatic|cloudflare|google)\./i;

export function normalizeSourceEmail(value = "") {
  let email = String(value || "").replace(/^mailto:/i, "").trim();
  email = email.replace(/^(?:%(?:09|0a|0b|0c|0d|20|a0))+/i, "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return "";
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (NON_BUSINESS_EMAIL_DOMAIN.test(`${domain}.`) || /\.(?:png|jpe?g|gif|webp|svg|css|js)$/i.test(email)) return "";
  return email;
}

function firstSourceEmail(value = "") {
  for (const match of String(value || "").matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = normalizeSourceEmail(match[0]);
    if (email) return email;
  }
  return "";
}

export function mergeSourceResults(base, additions = []) {
  if (!additions.length) return base;
  const valid = additions.filter(Boolean);
  const copy = [base.found?.copy, ...valid.map((item) => item.found?.copy)].filter(Boolean).join("\n\n").slice(0, 18_000);
  const assets = excludeLogoIdentitiesFromPhotos([
    ...(base.assets || []),
    ...valid.flatMap((item) => item.assets || []),
  ]).slice(0, 30);
  const logoIdentities = new Set(assets
    .filter((asset) => asset?.kind === "logo")
    .map((asset) => sourceAssetIdentity(asset.url))
    .filter(Boolean));
  const photos = dedupeSourcePhotos([
    ...(base.found?.photos || []),
    ...valid.flatMap((item) => item.found?.photos || []),
  ]).filter((url) => !logoIdentities.has(sourceAssetIdentity(url)));
  const files = valid.flatMap((item) => item.files || []).slice(0, 7);
  const imageInventory = dedupeImageInventory([
    ...(base.image_inventory || []),
    ...valid.flatMap((item) => item.image_inventory || []),
  ]);
  const navigationPages = dedupeNavigationPages([
    ...(base.navigation_pages || []),
    ...valid.flatMap((item) => item.navigation_pages || []),
  ]);
  return {
    ...base,
    sources: unique([...(base.sources || []), ...valid.flatMap((item) => item.sources || [])]),
    found: {
      ...(base.found || {}),
      depth_channels: mergeDepthChannels([base.found?.depth_channels, ...valid.map((item) => item.found?.depth_channels)]),
      service_observations: mergeServiceObservations([base.found?.service_observations, ...valid.map((item) => item.found?.service_observations)]),
      copy,
      photos,
      trust_marks: dedupeTrustMarks([...(base.found?.trust_marks || []), ...valid.flatMap((item) => item.found?.trust_marks || [])]),
      colors: normalizeSourceColors(base.found?.colors, ...valid.map((item) => item.found?.colors)),
      fonts: normalizeSourceFonts(base.found?.fonts, ...valid.map((item) => item.found?.fonts)),
    },
    assets,
    files,
    image_inventory: imageInventory,
    navigation_pages: navigationPages,
    summary: {
      ...(base.summary || {}),
      mode: [base.summary?.mode, ...valid.map((item) => item.summary?.mode)].filter(Boolean).join("+") || "source-intake",
      pages_read: Number(base.summary?.pages_read || 0) + valid.reduce((sum, item) => sum + Number(item.summary?.pages_read || 0), 0),
      photos_found: photos.length,
      trust_marks_found: Number(base.summary?.trust_marks_found || 0) + valid.reduce((sum, item) => sum + Number(item.summary?.trust_marks_found || 0), 0),
      logo_found: Boolean(base.summary?.logo_found || valid.some((item) => item.summary?.logo_found)),
      errors: [...(base.summary?.errors || []), ...valid.flatMap((item) => item.summary?.errors || [])].slice(0, 4),
      notes: [...(base.summary?.notes || []), ...valid.flatMap((item) => item.summary?.notes || [])].slice(0, 8),
    },
  };
}

function mergeDepthChannels(channels) {
  const result = {};
  for (const name of ["reviews", "hours", "faqs", "areas"]) {
    const seen = new Set();
    const entries = channels.flatMap((item) => item?.[name] || []).filter((entry) => {
      if (!entry?.source_url || !entry?.evidence) return false;
      const key = `${entry.source_url}|${entry.evidence}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
    if (entries.length) result[name] = entries;
  }
  return result;
}

function mergeServiceObservations(groups) {
  const seen = new Set();
  return groups.flatMap((group) => Array.isArray(group) ? group : []).filter((item) => {
    if (!item?.name || !item?.source_url || !item?.excerpt || item.excerpt !== item.evidence) return false;
    const key = `${item.name}|${item.source_url}|${item.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
}

// Bind a service label to its observed page line. For HTML-only fallbacks,
// directDepthText extracts visible text from the same page before matching.
export function extractSourceServiceObservations(pages = []) {
  const observations = [];
  for (const page of pages) {
    const source_url = String(page?.url || "");
    if (!/^https?:\/\//i.test(source_url)) continue;
    // Editorial pages describe advice, not the business's offered work.
    if (/(?:^|\/)(?:blog|articles?|news|tips?|guides?|resources?)(?:\/|$)|\b(?:\d+-pro-|\d+-steps?-to-|tips?-for-|how-to-)|-(?:tips?|ideas?|guide|checklist)(?:\/|$)/i.test(new URL(source_url).pathname)) continue;
    const observedText = page?.markdown || directDepthText(page?.html || "");
    const lines = String(observedText).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const heading = lines[i].trim();
      if (!heading || heading.length > 500) continue;
      const markdownHeading = /^#{1,4}\s+/.test(heading);
      const isolatedHeading = !markdownHeading && i > 0 && !lines[i - 1].trim()
        && i + 1 < lines.length && !lines[i + 1].trim() && heading.length <= 100;
      if (!markdownHeading && !isolatedHeading) continue;
      for (const name of extractServices(heading)) {
        let description = "";
        // Find the first real prose within this heading's section. Images and
        // buttons can precede it; a new heading or content list closes scope.
        for (let j = i + 1; j < Math.min(lines.length, i + 13); j += 1) {
          const prose = lines[j].trim();
          if (!prose) continue;
          if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/.test(prose)) {
            if (/^!\[[^\]]*\]\([^)]*\)$/.test(prose)) continue;
            break;
          }
          if (/^!\[[^\]]*\]\([^)]*\)$|^\[[^\]]*\]\([^)]*\)$|^https?:\/\/|^(?:read more|learn more|contact us|get (?:a )?quote|book now)$/i.test(prose)) continue;
          if (prose.length >= 20 && prose.length <= 500) description = prose;
          break;
        }
        const excerpt = description ? `${heading}\n${description}` : heading;
        observations.push({ name, source_url, description, evidence: excerpt, excerpt });
      }
    }
  }
  return mergeServiceObservations([observations]);
}

function rankedServiceNames(observations = []) {
  return unique(observations.filter((row) => row.description).sort((a, b) => {
    const aPath = new URL(a.source_url).pathname.replace(/\/+$/, "");
    const bPath = new URL(b.source_url).pathname.replace(/\/+$/, "");
    return Number(Boolean(bPath)) - Number(Boolean(aPath));
  }).map((row) => row.name));
}

// Only text explicitly present on a source page can enter these channels.
// Each entry carries its exact source excerpt so certification can bind bytes.
export function extractSourceDepthChannels(pages = []) {
  const channels = [];
  for (const page of pages) {
    const url = String(page?.url || "");
    if (!/^https?:\/\//i.test(url)) continue;
    const lines = String(page.markdown || directDepthText(page.html || "")).split(/\r?\n/).map((line) => line.trim());
    let section = "";
    let pendingQuestion = "";
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const heading = line.match(/^#{1,4}\s+(.+)$/);
      if (heading) {
        section = heading[1].toLowerCase();
        pendingQuestion = "";
        continue;
      }
      if (!line || line.length > 500) continue;
      const evidence = line;
      if (/\b(?:business|opening|office|store) hours\b|^hours$|^when we're open$/i.test(section)
        && /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|daily|weekdays)\b/i.test(line)
        && /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|closed|24\s*hours)\b/i.test(line)) {
        channels.push({ channel: "hours", value: line, source_url: url, evidence });
      }
      if (/\b(?:faq|frequently asked questions|questions and answers)\b/i.test(section)) {
        const question = line.match(/^(?:\*\*|Q:\s*)?(.+\?)(?:\*\*)?$/i);
        if (question) pendingQuestion = question[1].replace(/\*\*/g, "");
        else if (pendingQuestion && line.length >= 15 && !/^[-*]\s/.test(line)) {
          channels.push({ channel: "faqs", question: pendingQuestion, answer: line, source_url: url, evidence: `${pendingQuestion}\n${line}` });
          pendingQuestion = "";
        }
      }
      if (/\b(?:service areas?|areas? served|communities served|where we work|locations served)\b/i.test(section)
        && /^[-*]\s+[^:]+$/.test(line) && line.length <= 100) {
        const value = line.replace(/^[-*]\s+/, "");
        channels.push({ channel: "areas", value, source_url: url, evidence });
      }
      if (/\b(?:testimonials?|customer reviews?)\b/i.test(section)
        && /^>\s*\S/.test(line) && line.length >= 35) {
        const author = lines[i + 1]?.match(/^(?:[-—]\s*|\*\*[-—]?\s*)([^*]{3,80})(?:\*\*)?$/)?.[1]?.trim();
        if (author) channels.push({ channel: "reviews", quote: line.replace(/^>\s*/, ""), author, source_url: url, evidence: `${line}\n${lines[i + 1]}` });
      }
    }
  }
  return mergeDepthChannels([{ reviews: channels.filter((e) => e.channel === "reviews"), hours: channels.filter((e) => e.channel === "hours"), faqs: channels.filter((e) => e.channel === "faqs"), areas: channels.filter((e) => e.channel === "areas") }]);
}

function directDepthText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, "")
    .replace(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi, (_, value) => `\n## ${value}\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, value) => `\n> ${value}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, value) => `\n- ${value}\n`)
    .replace(/<\/(?:p|div|dd|dt)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|#0?38);/gi, "&").replace(/&(?:quot|#0?34);/gi, '"')
    .replace(/&(?:nbsp|#160);/gi, " ").replace(/&(?:mdash|#8212);/gi, "—")
    .replace(/\r/g, "")
    .split("\n").map((line) => line.replace(/[\t ]+/g, " ").trim()).join("\n");
}

async function collectViaPageHub(urls, expectedFacts = {}) {
  // The standalone compiler is an accelerator, not a single point of failure.
  // Always read the public business site directly as well so a compiler outage
  // cannot silently turn a real company into an empty template build.
  const directPages = await directWebsitePages(urls);
  let data = {};
  let compilerWarning = "";
  try {
    const { response, body: compilerData } = await fetchJsonWithTimeout(PAGEHUB_COMPILER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: unique(urls).slice(0, 5) }),
    }, 58000);
    data = compilerData;
    if (!response.ok || data.ok === false) {
      compilerWarning = data.error || `Intake compiler returned HTTP ${response.status}.`;
      data = {};
    }
  } catch (error) {
    compilerWarning = `Intake compiler fallback failed: ${error.message || error}`;
  }

  try {
    if (!directPages.length && !Object.keys(data).length) return emptyResult(urls, compilerWarning || "The public business site could not be read.");
    const extracted = data.extracted || {};
    const directTrustMarks = dedupeTrustMarks(directPages.flatMap(extractTrustMarks));
    const directImageEvidence = officialDirectImageEvidence(directPages);
    const isDirectImage = (value) => {
      const raw = typeof value === "string" ? value : value?.url || value?.src || "";
      const url = absolute(raw, extracted.domainUrl || urls[0] || undefined);
      return Boolean(url && directImageEvidence.has(sourceAssetIdentity(url)));
    };
    const looseTrustMarks = dedupeTrustMarks([
      ...(extracted.logoCandidates || []),
      ...(extracted.imageCandidates || []),
    ].map((item) => pageHubTrustMarkCandidate(
      item,
      extracted.domainUrl || urls[0] || "",
      directImageEvidence,
    )).filter(Boolean));
    const trustMarks = dedupeTrustMarks([...directTrustMarks, ...looseTrustMarks]).slice(0, 8);
    const trustMarkIds = new Set(trustMarks.map((item) => sourceAssetIdentity(item.url)));
    const compilerLogos = [extracted.logoLink, ...(extracted.logoCandidates || [])]
      .filter(isDirectImage)
      .map((item) => pageHubLogoCandidate(
        item,
        extracted.domainUrl || urls[0] || "",
        directImageEvidence,
      ))
      .filter(Boolean);
    const logos = unique([
      ...compilerLogos,
      ...directPages.flatMap(extractLogos),
    ]
      .filter((url) => isPublicAsset(url) && !trustMarkIds.has(sourceAssetIdentity(url)))).slice(0, 6);
    const logoIds = new Set(logos.map(sourceAssetIdentity).filter(Boolean));
    const photos = dedupeSourcePhotos([
      ...(extracted.imageCandidates || [])
        .filter(isDirectImage)
        .map((item) => pageHubImageCandidate(
          item,
          extracted.domainUrl || urls[0] || "",
          directImageEvidence,
        ))
        .filter(Boolean),
      ...directPages.flatMap(extractPhotos),
    ])
      .filter((url) => (
        !trustMarkIds.has(sourceAssetIdentity(url))
        && !logoIds.has(sourceAssetIdentity(url))
      ))
      .slice(0, 24);
    const videos = unique(directPages.flatMap(extractVideos)).filter(isPublicAsset).slice(0, 4);
    const socials = unique(extracted.socialLinks || []).filter(isPublicAsset).slice(0, 8);
    const copy = fullCopy(extracted, directPages);
    // PageHub sometimes concatenates the whole nav into one string — recover
    // real service names from page-body lines instead of trusting it blindly.
    const rawServices = String(extracted.exactServices || extracted.mainServices || "")
      .split(/\n|;|,/)
      .map(sanitizeServiceText)
      .filter((item) => item && item.length <= 52 && !isServiceJunk(item));
    const serviceObservations = extractSourceServiceObservations(directPages);
    const services = unique([...rankedServiceNames(serviceObservations), ...rawServices, ...extractServices(copy)]).slice(0, 12);
    const colors = normalizeSourceColors(
      extracted.colors,
      extracted.brandColors,
      extracted.branding,
      ...directPages.map((page) => page.branding?.colors),
    );
    const fonts = normalizeSourceFonts(
      extracted.fonts,
      extracted.brandFonts,
      extracted.branding,
      ...directPages.map((page) => page.branding?.fonts),
    );
    const email = normalizeSourceEmail(extracted.email) || firstSourceEmail(copy);
    const sources = unique([...(data.sources || []), ...urls, ...directPages.map((page) => page.url)]);
    const website = extracted.domainUrl || sources.find((url) => classifySourceUrl(url) === "website") || "";
    const gbp = extracted.gbpLink || sources.find((url) => classifySourceUrl(url) === "gbp") || "";
    const businessName = String(extracted.brandName || expectedFacts.name || "").trim();
    const sourceFor = (assetUrl) => sourcePageForAsset(assetUrl, directPages, website);
    const assets = [
      ...logos.map((url, index) => ({ kind: "logo", url, label: `Logo candidate ${index + 1}`, source: "pagehub-firecrawl", origin: "source-intake", approved: index === 0, meta: { logo_evidence: "compiler-or-markup" }, provenance: assetProvenance(sourceFor(url), businessName) })),
      ...trustMarks.map((item) => ({ kind: "trust_mark", url: item.url, label: item.label, source: "pagehub-firecrawl", origin: "source-intake", approved: true, hero_eligible: false, proof_eligible: false, meta: { trust_mark_evidence: item.evidence }, provenance: assetProvenance(sourceFor(item.url), businessName) })),
      ...photos.map((url, index) => ({ kind: "photo", url, label: `Source photo ${index + 1}`, source: "pagehub-firecrawl", origin: "source-intake", approved: true, meta: { treatment: "family-duotone" }, provenance: assetProvenance(sourceFor(url), businessName) })),
      ...videos.map((url, index) => ({ kind: "video", url, label: `Source video ${index + 1}`, source: "website", origin: "source-intake", approved: true, provenance: assetProvenance(sourceFor(url), businessName) })),
    ];
    const imageInventory = firstPartyImageInventory(directPages, website);
    const navigationPages = navigationPageInventory(directPages, website);
    return {
      sources,
      searched: [],
      facts: { name: businessName, phone: extracted.finalPhone || "", email, address: extracted.address || "", website, gbp_url: gbp, services, socials },
      found: { logo: logos[0] || null, photos, videos, trust_marks: trustMarks, colors, fonts, services, service_observations: serviceObservations, contact: { phone: extracted.finalPhone || "", email, address: extracted.address || "" }, socials, copy, depth_channels: extractSourceDepthChannels(directPages) },
      assets,
      image_inventory: imageInventory,
      navigation_pages: navigationPages,
      summary: {
        mode: Object.keys(data).length ? "compiler-plus-direct-source" : "direct-source-intake",
        pages_read: directPages.length,
        photos_found: photos.length,
        trust_marks_found: trustMarks.length,
        videos_found: videos.length,
        services_found: services.length,
        logo_found: Boolean(logos.length),
        searched: 0,
        notes: [...(data.notes || []), ...(compilerWarning ? [compilerWarning] : [])].slice(0, 8),
      },
    };
  } catch (error) {
    return emptyResult(urls, `Direct source intake failed: ${error.message || error}`);
  }
}

// G2 (E8): the PageHub summary is a paragraph; testimonials/years/licenses live
// in the page bodies. Derive full copy from the direct fetches when short.
function fullCopy(extracted = {}, pages = []) {
  const summary = extracted.businessSummary || extracted.protectedArtifacts || "";
  if (summary.length > 1200) return summary;
  const text = pages.map((page) => String(page.html || "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
    .replace(/<(?:p|div|h[1-6]|li|br|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|#0?38);/g, "&").replace(/&(?:quot|#0?34);/g, '"')
    .replace(/&(?:#8220|#8221|ldquo|rdquo);/g, '"').replace(/&(?:#8216|#8217|lsquo|rsquo|#0?39);/g, "'")
    .replace(/&(?:nbsp|#160);/g, " ").replace(/&(?:mdash|#8212);/g, "—").replace(/&(?:ndash|#8211);/g, "–")
    .split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length > 2).join("\n"))
    .join("\n");
  return [summary, text].filter(Boolean).join("\n\n").slice(0, 18000);
}

async function directWebsitePages(urls) {
  const roots = unique(urls).filter((url) => classifySourceUrl(url) === "website").slice(0, 2);
  const pages = [];
  for (const url of roots) {
    const firstPage = await directPage(url);
    if (!firstPage) continue;
    pages.push(firstPage);
    const baseHost = new URL(url).hostname;
    const children = normalizeLinks(firstPage.links).filter((link) => {
      try { const parsed = new URL(link, url); return parsed.hostname === baseHost && /gallery|project|portfolio|service|about/i.test(parsed.pathname); } catch { return false; }
    }).slice(0, 3);
    for (const child of children) {
      const page = await directPage(absolute(child, url));
      if (page) pages.push(page);
    }
  }
  return pages;
}

async function directPage(url) {
  try {
    const { response, body } = await fetchTextWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteForgeSourceIntake/2.0)" }, redirect: "follow" }, 16000);
    if (!response.ok) return null;
    const html = body.slice(0, 2_500_000);
    const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((match) => absolute(match[1], url)).filter(Boolean);
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
    return { url: response.url || url, markdown: "", links, images: [], branding: {}, html, metadata: { title }, note: "direct public fallback" };
  } catch {
    return null;
  }
}

async function searchForBusiness(facts, key) {
  const query = [facts.name, facts.category, facts.city, facts.state].filter(Boolean).join(" ");
  if (!facts.name || !facts.city || !query) return [];
  try {
    const { response, body: data } = await fetchJsonWithTimeout(`${FIRECRAWL}/search`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ query, limit: 6, sources: ["web"] }),
    }, 18000);
    if (!response.ok || data.success === false) return [];
    const rows = data.data?.web || data.data || [];
    const urls = (Array.isArray(rows) ? rows : []).map((row) => typeof row === "string" ? row : row.url || row.href || "").filter(Boolean);
    const preferred = urls.filter((url) => !/angi|thumbtack|homeadvisor|bbb|yellowpages|mapquest|wikipedia|facebook|instagram|yelp|nextdoor|linkedin|porch\.com|houzz/i.test(url));
    const nameToken = String(facts.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
    const exact = preferred.filter((url) => nameToken.length > 5 && url.toLowerCase().replace(/[^a-z0-9]/g, "").includes(nameToken));
    return unique(exact.length ? exact : preferred.length ? preferred : urls).slice(0, 2);
  } catch {
    return [];
  }
}

async function mapLikelyPages(url, key) {
  try {
    const { response, body: data } = await fetchJsonWithTimeout(`${FIRECRAWL}/map`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ url, limit: 30 }),
    }, 16000);
    if (!response.ok || data.success === false) return { selected: [], navigation: [] };
    const links = data.links || data.data?.links || data.data || [];
    const navigation = sameHostNavigationLinks(
      (Array.isArray(links) ? links : []).map((item) => typeof item === "string" ? item : item.url || item.href || ""),
      url,
    );
    // Every same-domain content page qualifies — external domains, tel:/mailto:
    // and asset/utility extensions were already excluded by
    // sameHostNavigationLinks — so long-form pages (blog/news/articles,
    // financing, rebates, coupons, faq, air-quality) all make the crawl set;
    // there is no keyword whitelist. URLs are sorted so the crawl set is a pure
    // function of the discovered link set: identical discovery yields
    // identical packet bytes and signed receipts regardless of the map
    // response order.
    const selected = navigation
      .map((item) => item.url)
      .sort(compareUrlText)
      .slice(0, MAX_SCRAPE_URLS);
    return { selected, navigation: [...navigation].sort((left, right) => compareUrlText(left.url, right.url)) };
  } catch {
    return { selected: [], navigation: [] };
  }
}

async function scrapeSource(url, key) {
  const payloads = [
    { url, formats: ["markdown", "links", "images", "branding", "rawHtml"], onlyMainContent: false, waitFor: 1400, timeout: 40000 },
    { url, formats: ["markdown", "links"], onlyMainContent: false, waitFor: 1000, timeout: 30000 },
  ];
  let note = "";
  for (const payload of payloads) {
    try {
      const { response, body: data } = await fetchJsonWithTimeout(`${FIRECRAWL}/scrape`, { method: "POST", headers: headers(key), body: JSON.stringify(payload) }, 45000);
      if (!response.ok || data.success === false) { note = data.error || data.message || `HTTP ${response.status}`; continue; }
      const page = data.data || data;
      return { url, markdown: page.markdown || "", links: page.links || [], images: page.images || [], branding: page.branding || {}, html: page.rawHtml || page.html || "", metadata: page.metadata || {}, note: "" };
    } catch (error) { note = error.message || String(error); }
  }
  return { url, markdown: "", links: [], images: [], branding: {}, html: "", metadata: {}, note };
}

// Bounded-concurrency crawl of the ordered URL set. Pages are fetched in
// batches of SCRAPE_CONCURRENCY so a 30+ page site cannot fire every request
// at once; every finished batch is byte-accounted and the crawl stops once
// MAX_SCRAPE_BYTES is spent (already-fetched pages are all kept as evidence —
// the budget gates between batches, never discards paid-for results).
// Returned order follows the input order, never fetch completion order.
async function scrapeSources(urls, key) {
  const queue = [...urls];
  const pages = [];
  let bytesUsed = 0;
  let budgetExhausted = false;
  while (queue.length && !budgetExhausted) {
    const batch = queue.splice(0, Math.max(1, SCRAPE_CONCURRENCY));
    const results = await Promise.all(batch.map((url) => scrapeSource(url, key)));
    for (const page of results) {
      pages.push(page);
      bytesUsed += scrapedPageSize(page);
    }
    if (bytesUsed >= MAX_SCRAPE_BYTES) budgetExhausted = true;
  }
  const note = budgetExhausted
    ? `scrape byte budget reached (${(bytesUsed / 1048576).toFixed(1)} MiB across ${pages.length} pages); ${queue.length} page(s) skipped`
    : "";
  return { pages, note };
}

function scrapedPageSize(page = {}) {
  return Buffer.byteLength(String(page.html || ""), "utf8") + Buffer.byteLength(String(page.markdown || ""), "utf8");
}

// Locale-independent URL ordering: same discovered set => same packet bytes.
function compareUrlText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalPageHref(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

// Source real public photos from the identity-matched Google Business Profile —
// stateless reuse of the studio gbpDeepImport parse, zero DB writes. Website
// photos always take priority; for a site-bearing business this runs only after
// the official site yielded zero approved photo/video evidence. Photos are
// curated (capped), never a bulk dump of random GBP customer uploads.
// Ask Google for a larger derivative while treating the response dimensions as
// unknown until the downloaded bytes are decoded. The origin may still return
// the smaller uploaded image.
function gbpHeroPhotoUrl(rawUrl) {
  const url = String(rawUrl || "");
  if (!/googleusercontent|ggpht|gstatic/i.test(url)) return url;
  const base = url.replace(/=[^=/?]*$/, "");
  return `${base}=w1600-h1200`;
}

function gbpIdentityEvidence(markdown = "", facts = {}) {
  const hay = String(markdown || "").toLowerCase();
  const hayTokens = new Set(tokenize(hay));
  const expectedNameTokens = identityTokens(facts.name);
  const matchedNameTokens = expectedNameTokens.filter((token) => hayTokens.has(token));
  const requiredNameMatches = Math.min(2, expectedNameTokens.length);
  const nameOk = requiredNameMatches > 0 && matchedNameTokens.length >= requiredNameMatches;
  const expectedPhone = String(facts.phone || "").replace(/\D/g, "").slice(-7);
  const phoneCandidates = hay
    .match(/(?:\+?\d[\d(). -]{5,}\d)/g)
    ?.map((value) => value.replace(/\D/g, ""))
    .filter((value) => value.length >= 7) || [];
  const phoneOk = expectedPhone.length === 7
    && phoneCandidates.some((candidate) => candidate.endsWith(expectedPhone));
  const expectedCityTokens = tokenize(facts.city).filter((token) => token.length >= 3);
  const cityOk = expectedCityTokens.length > 0
    && expectedCityTokens.every((token) => hayTokens.has(token));
  if (!nameOk || (!phoneOk && !cityOk)) return null;
  return [
    `name:${matchedNameTokens.slice(0, requiredNameMatches).join("+")}`,
    phoneOk ? "phone:last7" : `city:${expectedCityTokens.join("+")}`,
  ];
}

async function gbpDeepAssets(url, key, facts = {}, { websiteFallback = false } = {}) {
  try {
    const { response, body: data } = await fetchJsonWithTimeout(`${FIRECRAWL}/scrape`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: false, waitFor: 3500, timeout: 40000 }),
    }, 45000);
    if (!response.ok || data.success === false) return null;
    const page = data.data || data;
    const identityEvidence = gbpIdentityEvidence(page.markdown || "", facts);
    if (!identityEvidence) return null;
    const deep = parseGbpDeep({ markdown: page.markdown || "", links: page.links || [], url });
    const photos = (deep.photos || []).map(gbpHeroPhotoUrl).slice(0, 12);
    if (!photos.length) return null;
    // A Google size directive is only a request; the origin may return a
    // smaller upload. Do not pre-stamp dimensions or hero/proof eligibility.
    // The normal image-metadata probe must measure the returned bytes and
    // demote a small image rather than letting source intake bypass visual QC.
    return {
      sources: [url],
      searched: [],
      facts: {},
      found: { logo: null, photos, videos: [], services: [], contact: {}, socials: [], copy: "" },
      assets: photos.map((u, i) => ({
        kind: "photo", url: u, label: `Business profile photo ${i + 1}`,
        source: "gbp", origin: "gbp-deep", approved: true,
        meta: {
          source_size: "gbp-requested-large",
          identity_evidence: identityEvidence,
        },
        provenance: assetProvenance(url, facts.name),
      })),
      summary: {
        mode: "gbp-deep",
        pages_read: 1,
        photos_found: photos.length,
        videos_found: 0,
        services_found: 0,
        logo_found: false,
        notes: [
          `GBP public business-profile photos: ${photos.length}`,
          ...(websiteFallback ? ["Official website had no approved photo/video; used identity-matched GBP fallback."] : []),
        ],
      },
    };
  } catch { return null; }
}

function mergePages(pages, roots, searched, expectedFacts = {}, mappedNavigation = []) {
  const allText = pages.map((page) => `${page.metadata?.title || ""}\n${page.metadata?.description || ""}\n${page.markdown || ""}`).join("\n");
  const serviceText = pages.map((page) => `${page.metadata?.description || ""}\n${page.markdown || ""}`).join("\n");
  const website = roots.find((url) => classifySourceUrl(url) === "website") || pages.find((page) => classifySourceUrl(page.url) === "website")?.url || "";
  const gbp = roots.find((url) => classifySourceUrl(url) === "gbp") || "";
  // The official source's own title outranks a caller-inferred expected name:
  // callers without an owner-corrected name often carry only the trade word
  // ("plumbing") inferred from their description, which would otherwise poison
  // every downstream identity/brand check with a name the source never claims.
  const brandName = cleanTitle(pages.map((page) => page.metadata?.ogTitle || page.metadata?.title || "").find(Boolean) || "")
    || String(expectedFacts.name || "").trim();
  const suppliedSocials = roots.filter((url) => classifySourceUrl(url) === "social");
  const discoveredSocials = pages.flatMap((page) => normalizeLinks(page.links))
    .filter((url) => classifySourceUrl(url) === "social")
    .filter((url) => socialBelongsToBusiness(url, brandName, website));
  const socials = unique([...suppliedSocials, ...discoveredSocials]).slice(0, 8);
  const trustMarks = dedupeTrustMarks(pages.flatMap(extractTrustMarks)).slice(0, 8);
  const trustMarkIds = new Set(trustMarks.map((item) => sourceAssetIdentity(item.url)));
  const logos = unique(pages.flatMap(extractLogos)).filter((url) => !trustMarkIds.has(sourceAssetIdentity(url))).slice(0, 6);
  const logoIds = new Set(logos.map(sourceAssetIdentity));
  const photos = dedupeSourcePhotos(pages.flatMap(extractPhotos))
    .filter((url) => !logoIds.has(sourceAssetIdentity(url)) && !trustMarkIds.has(sourceAssetIdentity(url)))
    .slice(0, 24);
  const videos = unique(pages.flatMap(extractVideos)).slice(0, 4);
  const websiteHost = publicHost(website);
  const colors = normalizeSourceColors(...pages
    .filter((page) => (
      websiteHost
      && classifySourceUrl(page.url) === "website"
      && publicHost(page.url) === websiteHost
    ))
    .map((page) => page.branding?.colors));
  const fonts = normalizeSourceFonts(...pages
    .filter((page) => (
      websiteHost
      && classifySourceUrl(page.url) === "website"
      && publicHost(page.url) === websiteHost
    ))
    .map((page) => page.branding?.fonts));
  const serviceObservations = extractSourceServiceObservations(pages);
  const services = unique([
    ...rankedServiceNames(serviceObservations),
    ...extractServices(serviceText),
    ...extractServiceHeadings(pages, brandName),
  ]).slice(0, 10);
  const contact = {
    phone: extractSourcePhone(allText),
    email: firstSourceEmail(allText),
    address: first(allText, /\d{2,5}\s+[A-Z][A-Za-z0-9 .'-]+(?:St|Street|Ave|Avenue|Blvd|Road|Rd|Dr|Drive|Ln|Lane|Way|Hwy|Court|Ct)\.?[^\n]{0,50}/i),
  };
  const sourceFor = (assetUrl) => sourcePageForAsset(assetUrl, pages, website);
  const assets = [
    ...logos.map((url, index) => ({ kind: "logo", url, label: `Logo candidate ${index + 1}`, source: "business-site", origin: "business-evidence", approved: index === 0, meta: { logo_evidence: "logo-markup" }, provenance: assetProvenance(sourceFor(url), brandName) })),
    ...trustMarks.map((item) => ({ kind: "trust_mark", url: item.url, label: item.label, source: "business-site", origin: "business-evidence", approved: true, hero_eligible: false, proof_eligible: false, meta: { trust_mark_evidence: item.evidence }, provenance: assetProvenance(sourceFor(item.url), brandName) })),
    ...photos.map((url, index) => ({ kind: "photo", url, label: `Source photo ${index + 1}`, source: "business-site", origin: "business-evidence", approved: true, meta: { treatment: "family-duotone" }, provenance: assetProvenance(sourceFor(url), brandName) })),
    ...videos.map((url, index) => ({ kind: "video", url, label: `Source video ${index + 1}`, source: "business-site", origin: "business-evidence", approved: true, provenance: assetProvenance(sourceFor(url), brandName) })),
  ];
  const imageInventory = firstPartyImageInventory(pages, website);
  const navigationPages = dedupeNavigationPages([
    ...mappedNavigation,
    ...navigationPageInventory(pages, website),
  ]);
  return {
    sources: unique(pages.map((page) => page.url)),
    searched,
    facts: { name: brandName, website, gbp_url: gbp, services, socials, ...contact },
    found: { logo: logos[0] || null, photos, videos, trust_marks: trustMarks, colors, fonts, services, service_observations: serviceObservations, contact, socials, copy: allText.slice(0, 12000), depth_channels: extractSourceDepthChannels(pages) },
    assets,
    image_inventory: imageInventory,
    navigation_pages: navigationPages,
    summary: { mode: "firecrawl-source-intake", pages_read: pages.filter((page) => page.markdown || page.html).length, photos_found: photos.length, trust_marks_found: trustMarks.length, videos_found: videos.length, services_found: services.length, logo_found: Boolean(logos.length), searched: searched.length, notes: pages.filter((page) => page.note).map((page) => `${page.url}: ${page.note}`).slice(0, 4) },
  };
}

const LOGO_JUNK = /google|gstatic|maps\.|mapsstatic|ggpht|googleusercontent|facebook|fbcdn|instagram|cdninstagram|yelp|foursquare|badge|award|bbb|angi|placeholder|jobber|serviceagent|powered[-_ ]?by|website[-_ ]?builder/i;
const RAW_ICON_JUNK = /\b(?:app[-_ ]?store|favicon|facebook[-_ ]?f|google[-_ ]?logo|social[-_ ]?(?:icon|logo)|tracking[-_ ]?pixel)\b/i;
const SOURCE_MEDIA_JUNK = /loremflickr|picsum|placehold|dummyimage|\/maps\/vt\b|maps\.googleapis|streetview|logo_jobber|powered[-_ ]?by|serviceagent/i;
const TRUST_MARK_HINT = /\b(?:accredit(?:ed|ation)?|association|authorized|award|badge|certif(?:ied|ication)?|dealer|manufacturer|member(?:ship)?|partner|preferred|seal)\b/i;
const TRUST_MARK_UNSAFE = /google|gstatic|maps\.|mapsstatic|ggpht|googleusercontent|facebook|fbcdn|instagram|cdninstagram|yelp|foursquare|placeholder|jobber|serviceagent|powered[-_ ]?by|website[-_ ]?builder/i;
const SENSITIVE_QUERY = /^(?:key|token|signature|sig|access[_-]?token|api[_-]?key|apikey|auth|credential|x-goog-|x-amz-)/i;
const LOGO_IDENTITY_STOP = new Set([
  "a", "an", "and", "co", "company", "corp", "corporation", "group", "inc", "llc", "ltd", "of", "service", "services", "solutions", "team", "the",
  "construction", "contracting", "contractor", "contractors", "electric", "electrical", "fence", "fencing", "landscape", "landscapes", "landscaping",
  "lawn", "plumbing", "pool", "pools", "roof", "roofing",
]);
const LOGO_FILENAME_DECORATORS = new Set([
  "black", "brand", "color", "colour", "compact", "copy", "crop", "cropped", "dark", "desktop", "final", "footer", "full", "header", "horizontal",
  "inverse", "light", "logo", "logotype", "mark", "mobile", "nav", "navbar", "primary", "retina", "secondary", "stacked", "transparent", "vertical",
  "white", "wordmark",
]);
export function isLikelyLogoUrl(value = "") {
  if (!isPublicAsset(value) || LOGO_JUNK.test(value)) return false;
  try {
    const url = new URL(value);
    return /(?:^|[\/_\-.])(?:logo|brand(?:mark)?|wordmark|logotype)(?:[\/_\-.]|$)/i.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

export function isTrustedLogoAsset(asset = {}) {
  if (!asset?.url || asset.approved === false) return false;
  if (!isSafeSourceAssetUrl(asset.url) || LOGO_JUNK.test(asset.url)) return false;
  if (asset.provenance?.authenticated_owner_upload === true) return true;
  if (["upload", "ai-candidate"].includes(asset.origin)) return true;
  if (asset.meta?.logo_evidence) return true;
  return isLikelyLogoUrl(asset.url);
}

export function promoteIdentityMatchedSourceLogo(discovery = {}, context = {}) {
  const assets = Array.isArray(discovery?.assets) ? discovery.assets : [];
  if (!assets.length || assets.some((asset) => asset?.kind === "logo" && isTrustedLogoAsset(asset))) return discovery;
  const name = String(context.name || discovery?.facts?.name || "").trim();
  const website = String(context.website || discovery?.facts?.website || "").trim();
  const nameTokens = identityTokens(name);
  const websiteHost = publicHost(website);
  if (!nameTokens.length || !websiteHost) return discovery;
  const websiteHostText = websiteHost.replace(/[^a-z0-9]/g, "");
  if (websiteHost.split(".").filter(Boolean).length < 2 || !nameTokens.some((token) => websiteHostText.includes(token))) {
    return discovery;
  }

  const candidate = assets.find((asset) => isIdentityMatchedOfficialLogo(asset, nameTokens, websiteHost));
  if (!candidate) return discovery;

  const meta = { ...(candidate.meta || {}) };
  delete meta.fallback_to_ambiance;
  delete meta.quality_status;
  delete meta.treatment;
  candidate.kind = "logo";
  candidate.label = "Logo (identity-matched official site mark)";
  candidate.approved = true;
  candidate.meta = { ...meta, logo_evidence: "identity-matched-business-site-mark", treatment: "brand-fit" };
  delete candidate.hero_eligible;
  delete candidate.proof_eligible;

  const identity = sourceAssetIdentity(candidate.url);
  const found = discovery.found || {};
  const photos = Array.isArray(found.photos)
    ? found.photos.filter((url) => sourceAssetIdentity(url) !== identity)
    : [];
  const notes = unique([
    ...(discovery.summary?.notes || []),
    `logo recovered from identity-matched official-site asset: ${candidate.url}`,
  ]).slice(0, 8);
  discovery.found = { ...found, logo: candidate.url, photos };
  discovery.summary = {
    ...(discovery.summary || {}),
    logo_found: true,
    photos_found: assets.filter((asset) => asset?.kind === "photo").length,
    notes,
  };
  return discovery;
}

export function recoverAuthenticatedGhostLogo(compiledValues = [], ghostValues = [], context = {}) {
  const compiled = sanitizeSourceAssets(compiledValues);
  const ghostAssets = sanitizeSourceAssets(ghostValues);
  const authenticatedOwnerLogo = ghostAssets.find((asset) => (
    asset.kind === "logo"
    && asset.approved !== false
    && asset.provenance?.authenticated_owner_upload === true
  ));
  if (authenticatedOwnerLogo) {
    return sanitizeSourceAssets([
      authenticatedOwnerLogo,
      ...compiled.filter((asset) => asset.kind !== "logo"),
    ]);
  }
  const ghostDiscovery = {
    facts: {
      name: String(context.name || "").trim(),
      website: String(context.website || "").trim(),
    },
    found: {
      logo: null,
      photos: ghostAssets
        .filter((asset) => asset.kind === "photo")
        .map((asset) => asset.url),
    },
    assets: ghostAssets.filter((asset) => asset.kind === "photo"),
    summary: { logo_found: false, photos_found: 0, notes: [] },
  };
  promoteIdentityMatchedSourceLogo(ghostDiscovery, context);
  const recovered = sanitizeSourceAssets(ghostDiscovery.assets).find((asset) => (
    asset.kind === "logo"
    && asset.meta?.logo_evidence === "identity-matched-business-site-mark"
  ));
  if (!recovered) return compiled;
  const recoveredId = sourceAssetIdentity(recovered.url);
  const withoutRecovered = compiled.filter((asset) => sourceAssetIdentity(asset.url) !== recoveredId);
  const firstLogo = withoutRecovered.findIndex((asset) => asset.kind === "logo");
  return sanitizeSourceAssets(firstLogo === -1
    ? [recovered, ...withoutRecovered]
    : [
        ...withoutRecovered.slice(0, firstLogo + 1),
        recovered,
        ...withoutRecovered.slice(firstLogo + 1),
      ]);
}

function isIdentityMatchedOfficialLogo(asset, nameTokens, websiteHost) {
  if (!isIdentityMatchedOfficialLogoCandidate(asset, nameTokens, websiteHost)) return false;
  const width = Number(asset.width || asset.meta?.width || asset.meta?.dimensions?.width || 0);
  const height = Number(asset.height || asset.meta?.height || asset.meta?.dimensions?.height || 0);
  if (!width && !height) return hasStrongLogoFilenameEvidence(asset.url);
  if (width < 120 || height < 40 || width > 1600 || height > 1200 || width * height > 1_000_000) return false;
  const ratio = width / height;
  return ratio >= 1.25 && ratio <= 8;
}

function isIdentityMatchedOfficialLogoCandidate(asset, nameTokens, websiteHost) {
  if (asset?.kind !== "photo" || asset.approved === false || !isSafeSourceAssetUrl(asset.url) || LOGO_JUNK.test(asset.url)) return false;
  if (!/(?:business|site|web|crawl|pagehub|source-intake)/i.test(`${asset.source || ""} ${asset.origin || ""}`)) return false;
  const assetHost = publicHost(asset.url);
  if (!sameOfficialHost(assetHost, websiteHost)) return false;
  let pathname = "";
  try { pathname = decodeURIComponent(new URL(asset.url).pathname); } catch { return false; }
  if (!/\.(?:png|webp)$/i.test(pathname)) return false;

  const filename = pathname.split("/").filter(Boolean).at(-1)?.replace(/\.[^.]+$/, "") || "";
  const filenameTokens = tokenize(filename);
  const matched = nameTokens.filter((token) => filenameTokens.includes(token));
  const requiredMatches = Math.min(2, nameTokens.length);
  if (matched.length < requiredMatches) return false;
  const hostText = websiteHost.replace(/[^a-z0-9]/g, "");
  if (nameTokens.length === 1 && (nameTokens[0].length < 5 || !hostText.includes(nameTokens[0]))) return false;

  const identitySet = new Set(nameTokens);
  const unexplained = filenameTokens.filter((token) => (
    !identitySet.has(token)
    && !LOGO_IDENTITY_STOP.has(token)
    && !LOGO_FILENAME_DECORATORS.has(token)
    && !/^(?:v?\d+|x\d+|\d+x?)$/i.test(token)
  ));
  if (unexplained.length) return false;
  return true;
}

function hasStrongLogoFilenameEvidence(value = "") {
  let filename = "";
  try {
    filename = decodeURIComponent(new URL(value).pathname).split("/").filter(Boolean).at(-1)?.replace(/\.[^.]+$/, "") || "";
  } catch {
    return false;
  }
  const tokens = tokenize(filename);
  return tokens.some((token) => [
    "brand", "brandmark", "inverse", "logo", "logotype",
    "mark", "transparent", "white", "wordmark",
  ].includes(token));
}

function identityTokens(value = "") {
  const tokens = tokenize(value).filter((token) => token.length >= 3 && !LOGO_IDENTITY_STOP.has(token));
  return unique(tokens).slice(0, 4);
}

function tokenize(value = "") {
  return String(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function publicHost(value = "") {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function ownerKey(value = "") {
  const stop = /^(?:a|an|and|co|company|corp|corporation|group|inc|llc|ltd|of|service|services|team|the|construction|contracting|contractor|contractors|electric|electrical|fence|fencing|landscape|landscapes|landscaping|lawn|plumbing|pool|pools|roof|roofing)$/i;
  return unique(tokenize(value).filter((token) => token.length >= 3 && !stop.test(token))).slice(0, 4).join("-");
}

function assetProvenance(sourceUrl = "", businessName = "") {
  const url = isPublicAsset(sourceUrl) ? String(sourceUrl) : "";
  return { source_url: url, source_host: publicHost(url), owner_key: ownerKey(businessName) };
}

function trustMarkSignalText(value = "") {
  const text = String(value || "");
  try {
    return decodeURIComponent(text).replace(/[^a-z0-9]+/gi, " ").trim();
  } catch {
    return text.replace(/[^a-z0-9]+/gi, " ").trim();
  }
}

function isTrustMarkSignal(...values) {
  return TRUST_MARK_HINT.test(values.map(trustMarkSignalText).join(" "));
}

function trustMarkLabel(value = "", url = "") {
  const clean = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|#0?38);/gi, "&")
    .replace(/&(?:quot|#0?34);/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (clean) return clean.slice(0, 120);
  try {
    return decodeURIComponent(new URL(url).pathname)
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Source-backed trust mark";
  } catch {
    return "Source-backed trust mark";
  }
}

function looseTrustMarkCandidate(value, base = "") {
  const raw = typeof value === "string" ? { url: value } : value;
  if (!raw || typeof raw !== "object") return null;
  const url = absolute(raw.url || raw.src || "", base || undefined);
  const label = raw.alt || raw.title || raw.label || "";
  if (!url || !isSafeSourceAssetUrl(url) || TRUST_MARK_UNSAFE.test(url) || !isTrustMarkSignal(url, label, raw.role, raw.kind)) return null;
  return { url, label: trustMarkLabel(label, url), evidence: "explicit-site-trust-mark" };
}

const TRUST_ROLE_CONTEXT = /\b(?:accredit(?:ed|ation)?|affiliation|association|authorized|award|badge|certif(?:ied|ication)?|dealer|manufacturer|member(?:ship)?|partner|preferred|proof[-_ ]?mark|seal|trust[-_ ]?(?:mark|rail))s?\b/i;
const PRIMARY_BRAND_CONTEXT = /\b(?:(?:brand|branding|company|header|main|nav|navbar|primary|site)[-_ ]*(?:logo|mark|wordmark)|(?:logo|mark|wordmark)[-_ ]*(?:brand|company|header|main|nav|navbar|primary|site))\b/i;
const GENERIC_LOGO_CONTEXT = /\b(?:brand(?:ing)?|logo|logotype|wordmark)\b/i;
const PROJECT_MEDIA_CONTEXT = /\b(?:before[-_ ]?after|completed[-_ ]?(?:job|project|work)|gallery|install(?:ation|ed|ing)?|job[-_ ]?(?:photo|site)|portfolio|project|service|work)(?:s|es)?\b|\bphotos?\b/i;

function imageRoleContext(tag = "") {
  return [
    attr(tag, "class"),
    attr(tag, "id"),
    attr(tag, "role"),
    attr(tag, "data-kind"),
    attr(tag, "data-role"),
    attr(tag, "itemprop"),
  ].filter(Boolean).join(" ");
}

function containerRoleContext(stack = []) {
  return stack.slice(-4).map((entry) => [
    entry.name,
    attr(entry.tag, "class"),
    attr(entry.tag, "id"),
    attr(entry.tag, "role"),
    attr(entry.tag, "aria-label"),
    attr(entry.tag, "data-kind"),
    attr(entry.tag, "data-role"),
  ].filter(Boolean).join(" ")).join(" ");
}

function htmlImageEvidence(page = {}) {
  const evidence = [];
  const stack = [];
  const html = String(page.html || "");
  const brandingLogoIds = new Set([
    page.branding?.logo,
    page.branding?.logoUrl,
    page.metadata?.logo,
  ].map((value) => sourceAssetIdentity(absolute(value, page.url))).filter(Boolean));
  const tagPattern = /<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    const name = match[1].toLowerCase();
    if (tag.startsWith("</")) {
      const index = stack.map((entry) => entry.name).lastIndexOf(name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    if (name === "img") {
      const url = absolute(
        attr(tag, "src") || attr(tag, "data-src") || bestSrcsetCandidate(attr(tag, "srcset") || attr(tag, "data-srcset")),
        page.url,
      );
      if (!url) continue;
      evidence.push({
        url,
        label: attr(tag, "alt") || attr(tag, "title") || attr(tag, "aria-label"),
        roleContext: imageRoleContext(tag),
        containerContext: containerRoleContext(stack),
        width: attr(tag, "width"),
        height: attr(tag, "height"),
        rawTag: tag,
        brandingLogo: brandingLogoIds.has(sourceAssetIdentity(url)),
        pageUrl: page.url,
      });
      continue;
    }
    if (!/^(?:area|base|br|col|embed|hr|input|link|meta|param|source|track|wbr)$/i.test(name) && !tag.endsWith("/>")) {
      stack.push({ name, tag });
    }
  }
  return evidence;
}

function normalizedImageEvidence(page = {}) {
  const brandingLogoIds = new Set([
    page.branding?.logo,
    page.branding?.logoUrl,
    page.metadata?.logo,
  ].map((value) => sourceAssetIdentity(absolute(value, page.url))).filter(Boolean));
  return normalizeImages(page.images).flatMap((item) => {
    const url = absolute(bestSrcsetCandidate(item.srcset) || item.url, page.url);
    if (!url) return [];
    return [{
      url,
      label: item.alt,
      roleContext: item.context,
      containerContext: "",
      width: item.width,
      height: item.height,
      brandingLogo: brandingLogoIds.has(sourceAssetIdentity(url)),
      pageUrl: page.url,
    }];
  });
}

function isExplicitTrustEvidence(item = {}) {
  const roleContext = `${item.roleContext || ""} ${item.containerContext || ""}`.trim();
  const allContext = `${item.url || ""} ${item.label || ""} ${roleContext}`;
  if (!TRUST_ROLE_CONTEXT.test(roleContext)) return false;
  if (
    item.brandingLogo
    || PRIMARY_BRAND_CONTEXT.test(item.roleContext || "")
    || PRIMARY_BRAND_CONTEXT.test(item.containerContext || "")
  ) return false;
  if (GENERIC_LOGO_CONTEXT.test(item.roleContext || "") && !TRUST_ROLE_CONTEXT.test(item.containerContext || "")) return false;
  if (PROJECT_MEDIA_CONTEXT.test(allContext)) return false;
  return isTrustMarkSignal(allContext);
}

function officialDirectImageEvidence(pages = []) {
  const out = new Map();
  for (const page of pages) {
    for (const item of [...htmlImageEvidence(page), ...normalizedImageEvidence(page)]) {
      const identity = sourceAssetIdentity(item.url);
      if (!identity) continue;
      const values = out.get(identity) || [];
      values.push(item);
      out.set(identity, values);
    }
  }
  return out;
}

function pageHubTrustMarkCandidate(value, base = "", directEvidence = new Map()) {
  const raw = typeof value === "string" ? { url: value } : value;
  if (!raw || typeof raw !== "object") return null;
  const url = absolute(raw.url || raw.src || "", base || undefined);
  if (!url || !isSafeSourceAssetUrl(url) || TRUST_MARK_UNSAFE.test(url)) return null;
  const officialMatches = directEvidence.get(sourceAssetIdentity(url)) || [];
  if (!officialMatches.length) return null;
  const official = officialMatches.find((item) => isExplicitTrustEvidence(item));
  if (!official) return null;
  const label = official.label || raw.alt || raw.title || raw.label || "";
  return {
    url: official.url,
    label: trustMarkLabel(label, official.url),
    evidence: "explicit-site-trust-mark",
  };
}

function pageHubLogoCandidate(value, base = "", directEvidence = new Map()) {
  const raw = typeof value === "string" ? { url: value } : value;
  const rawUrl = raw?.url || raw?.src || "";
  const url = absolute(rawUrl, base || undefined);
  if (!url || !isSafeSourceAssetUrl(url) || isHardRawLogoOrIconJunk(raw)) return "";
  const officialMatches = directEvidence.get(sourceAssetIdentity(url)) || [];
  if (!officialMatches.length) return "";
  if (officialMatches.every((item) => isRawLogoOrIconJunk(item))) return "";
  return normalizeSafeSourceImageUrl(url);
}

function pageHubImageCandidate(value, base = "", directEvidence = new Map()) {
  const raw = typeof value === "string" ? { url: value } : value;
  const rawUrl = raw?.url || raw?.src || "";
  const url = absolute(rawUrl, base || undefined);
  if (!url || !isSafeSourceAssetUrl(url) || isHardRawLogoOrIconJunk(raw)) return "";
  const officialMatches = directEvidence.get(sourceAssetIdentity(url)) || [];
  if (!officialMatches.length || officialMatches.every((item) => isRawLogoOrIconJunk(item))) return "";
  return normalizeSafeSourceImageUrl(url);
}

function extractTrustMarks(page) {
  const out = [];
  const push = (item) => {
    const url = absolute(item?.url, page.url);
    if (!url || !isSafeSourceAssetUrl(url) || TRUST_MARK_UNSAFE.test(url) || !isExplicitTrustEvidence({ ...item, url })) return;
    const identity = sourceAssetIdentity(url);
    if (!identity || out.some((item) => sourceAssetIdentity(item.url) === identity)) return;
    out.push({ url, label: trustMarkLabel(item.label, url), evidence: "explicit-site-trust-mark" });
  };
  [...htmlImageEvidence(page), ...normalizedImageEvidence(page)].forEach(push);
  return out;
}

function sourcePageForAsset(assetUrl, pages = [], fallback = "") {
  const identity = sourceAssetIdentity(assetUrl);
  return pages.find((page) => [
    ...extractLogos(page),
    ...extractTrustMarks(page).map((item) => item.url),
    ...extractPhotos(page),
    ...extractVideos(page),
  ].some((url) => sourceAssetIdentity(url) === identity))?.url || fallback;
}

function sameOfficialHost(left = "", right = "") {
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)));
}

function extractLogos(page) {
  const out = [];
  const trustMarkIds = new Set(extractTrustMarks(page).map((item) => sourceAssetIdentity(item.url)));
  const push = (value, evidence = "") => {
    if (isRawLogoOrIconJunk(value, evidence)) return;
    const url = normalizeSafeSourceImageUrl(value, page.url);
    if (url && !LOGO_JUNK.test(url) && !trustMarkIds.has(sourceAssetIdentity(url)) && !out.includes(url)) out.push(url);
  };
  push(page.branding?.logo || page.branding?.logoUrl || page.metadata?.logo, "official branding primary");
  [...htmlImageEvidence(page), ...normalizedImageEvidence(page)].forEach((item) => {
    if (/logo|brand|mark/i.test(rawCandidateEvidence(item))) push(item.url, item);
  });
  return out.filter(isPublicAsset);
}

function extractPhotos(page) {
  const out = [];
  const trustMarkIds = new Set(extractTrustMarks(page).map((item) => sourceAssetIdentity(item.url)));
  const push = (value, evidence = "") => {
    if (isRawLogoOrIconJunk(value, evidence)) return;
    const url = normalizeSourcePhotoUrl(value, page.url);
    if (!url || trustMarkIds.has(sourceAssetIdentity(url)) || !isUsableSourcePhotoUrl(url) || /favicon|icon|logo|sprite|tracking|pixel|avatar|emoji|\.svg(?:\?|$)|googleusercontent\.com\/a[-\/]|=s\d{2,3}-c(?:-rp)?\b|rp-mo-br/i.test(url)) return;
    out.push(url);
  };
  normalizeImages(page.images).forEach((item) => {
    const evidence = `${item.alt} ${item.context}`;
    push(bestSrcsetCandidate(item.srcset), evidence);
    push(item.url, evidence);
  });
  String(page.html || "").replace(/<img[^>]+>/gi, (tag) => {
    push(bestSrcsetCandidate(attr(tag, "srcset") || attr(tag, "data-srcset")), tag);
    push(attr(tag, "src") || attr(tag, "data-src"), tag);
    return tag;
  });
  return dedupeSourcePhotos(out);
}

function extractVideos(page) {
  const values = [];
  String(page.html || "").replace(/<(?:video|source)[^>]+>/gi, (tag) => { const src = attr(tag, "src"); if (src) values.push(absolute(src, page.url)); return tag; });
  normalizeLinks(page.links).filter((url) => /\.(?:mp4|webm|mov)(?:\?|$)/i.test(url)).forEach((url) => values.push(url));
  return unique(values.filter(isPublicAsset));
}

const FORM_JUNK = /^(street ?address|address|city|state|zip ?code|postal code|first name|last name|full name|your name|name|email( address)?|phone( number)?|message|subject|company|comment|services we offer|what is|how (much|do|can)|why |contact( us)?|get (a )?quote|request|submit|send|search|menu|home|about( us)?|read more|learn more|click here|sign (in|up)|log ?in|our services|services)\b/i;
const SERVICE_TERM = /repair|install|service|maintenance|clean|design|removal|inspection|replacement|grading|excavat|trench|utilit|landscap|roof|pool|plumb|electric|paint|fenc|concrete|hvac|solar|tree|masonry|paver|patio|pergola|fireplace|fire pit|retaining|block wall|foundation|outdoor kitchen|bbq|water feature|hardscape|drainage|turf|irrigation|demolition|driveway|walkway|stucco|stonework|\bsod\b|lighting/i;
const SERVICE_LIST_JUNK = /\bservice\s+description\b|\b(?:customer|client|member)\s+(?:care|service|support)\b|\bservice\s+areas?\b|\b(?:marketing|advertising|branding|seo|social media|content (?:creation|marketing)|copywriting)\b|\b(?:web(?:site)?|graphic|logo|print)\s+design\b|\bdesign\s+(?:ideas?|inspiration|trends?)\b|\b(?:mood boards?|color palettes?|style guides?)\b|\b(?:tips?|guides?|documentation|resources?|ideas?|faqs?|articles?|blogs?|news|checklists?)\b/i;
const NON_SERVICE_HEADING = /^(?:(?:the\s+)?locations?\s+(?:we\s+)?(?:serve|service)\b|(?:\d+(?:\.\d+)?|five)[ -]?star(?:\s+rated)?\b|common\s+problems?\b|how\b)/i;
const SERVICE_LABEL_CHARSET = /^[\p{L}\p{N}][\p{L}\p{N}\s&'’()+./-]*$/u;

// Heading-only refusals are shared with discovery-to-facts admission. Keep
// service actions intact: a concrete plant is a location, plant repair is work.
const SERVICE_SECTION_HEADING = /^(?:(?:(?:our|the)\s+)?(?:services?\s+(?:include|including|offered|overview)|locations?|plants?|(?:plant|office|branch)\s+locations?)|(?:working|work)\s+with\s+us|(?:dispatch|corporate|main|sales)\s+office)$/i;
const SERVICE_LOCATION_HEADING = /^(?:[\p{L}\p{N}&'’.-]+\s+){0,6}(?:plants?|locations?)$/iu;
const SERVICE_ACTION_LABEL = /\b(?:care|clean(?:ing)?|design|install(?:ation|ing)?|maintenance|repair|replacement|removal|inspection|delivery|lighting|relocation|management)\b/i;
export function isServiceSectionHeading(value = "") {
  const label = sanitizeServiceText(value).replace(/^[#>*•\s"'“”]+|[\s"'“”.:;!?]+$/g, "");
  return SERVICE_SECTION_HEADING.test(label)
    || (SERVICE_LOCATION_HEADING.test(label) && !SERVICE_ACTION_LABEL.test(label));
}

function isServiceJunk(value = "") {
  return FORM_JUNK.test(value) || SERVICE_LIST_JUNK.test(value) || NON_SERVICE_HEADING.test(value) || isServiceSectionHeading(value);
}

function sanitizeServiceText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:amp|#0?38);/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function explicitServiceList(line = "") {
  const match = sanitizeServiceText(line).match(/(?:\bservices?\s*(?:include|including|:)|\b(?:we\s+)?(?:offer|provide)\s*[:;]|\bspeciali[sz](?:e|es|ed|ing)\s+in\b[^.\n]{0,120}?\bincluding)\s*[:;,-]?\s*(.+)$/i);
  if (!match) return [];
  const items = match[1]
    .split(/[,;]+/)
    .map((item) => sanitizeServiceText(item)
      .replace(/^\s*(?:and|or)\s+/i, "")
      .replace(/[.:]+$/, "")
      .replace(/\blow[ -]+voltage\b/i, "low-voltage")
      .trim())
    .filter(Boolean);
  if (items.length < 2) return [];
  const accepted = items.filter((item) => (
    item.length >= 3
    && item.length <= 52
    && item.split(/\s+/).length <= 8
    && !isServiceJunk(item)
    && !/https?:\/\/|\]\(|www\./i.test(item)
    && SERVICE_LABEL_CHARSET.test(item)
    && SERVICE_TERM.test(item)
  ));
  return accepted.length >= 2 ? accepted : [];
}

export function extractServices(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const clean = sanitizeServiceText(line).replace(/^#{1,5}\s*|^[-*•]\s*/, "").replace(/[*_`]/g, "").trim();
    const listed = explicitServiceList(clean);
    if (listed.length) {
      out.push(...listed);
      continue;
    }
    if (clean.length < 4 || clean.length > 52) continue;
    if (isServiceJunk(clean)) continue;
    if (/https?:\/\/|\]\(|www\./i.test(clean) || clean.split(/\s+/).some((word) => word.length > 18)) continue;
    if (/street ?address|zip ?code|postal code|first name|last name|\bemail\b|phone number|services we offer|what is /i.test(clean)) continue;
    const label = clean.replace(/[.:]$/, "");
    if (!SERVICE_LABEL_CHARSET.test(label)) continue;
    if (SERVICE_TERM.test(label)) out.push(label);
  }
  return unique(out).slice(0, 10);
}

const SOURCE_PHONE = /(?<![A-Za-z0-9])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![A-Za-z0-9])/g;
const EXPLICIT_NO_PHONE = /\b(?:no|without|doesn['’]?t\s+have|does\s+not\s+have|do\s+not\s+have|not\s+have)\s+(?:a\s+)?(?:phone|telephone|tel)\b|\b(?:phone|telephone|tel)\s*(?:number)?\s*[:\-]?\s*(?:none|n\/a|unavailable|not\s+available|not\s+provided)\b/i;

function stripSourceUrlArtifacts(value = "") {
  return String(value)
    .replace(/https?:\/\/[^\s<>'"\])]+/gi, " ")
    .replace(/(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\/[^\s<>'"\])]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSourcePhone(text = "") {
  const source = stripSourceUrlArtifacts(text);
  if (!source || EXPLICIT_NO_PHONE.test(source)) return "";
  return source.match(SOURCE_PHONE)?.[0]?.trim() || "";
}

function serviceHeadingValue(value = "") {
  const parts = sanitizeServiceText(value)
    .replace(/^#{1,6}\s*/, "")
    .replace(/\s*(?:\||[–—])\s*/g, "\n")
    .split("\n")
    .map((item) => item.replace(/[.:]+$/, "").trim())
    .filter((item) => item.length >= 4 && item.length <= 52);
  return parts.filter((item) => (
    !isServiceJunk(item)
    && !/https?:\/\/|www\.|[<>]/i.test(item)
    && SERVICE_LABEL_CHARSET.test(item)
    && SERVICE_TERM.test(item)
  ));
}

function normalizeHeadingIdentity(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function extractServiceHeadings(pages = [], businessName = "") {
  const values = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    String(page?.html || "").replace(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi, (_, value) => {
      values.push(value);
      return value;
    });
    for (const match of String(page?.markdown || "").matchAll(/^#{1,6}\s+(.+)$/gm)) values.push(match[1]);
  }
  const business = normalizeHeadingIdentity(businessName);
  return unique(values.flatMap(serviceHeadingValue).filter((value) => normalizeHeadingIdentity(value) !== business)).slice(0, 10);
}

function normalizeImages(items) {
  return (Array.isArray(items) ? items : []).map((item) => typeof item === "string"
    ? { url: item, alt: "", srcset: "", context: "" }
    : {
      url: item.url || item.src || "",
      alt: item.alt || item.title || "",
      srcset: item.srcset || item.srcSet || "",
      context: [item.role, item.kind, item.className, item.class, item.id, item.context].filter(Boolean).join(" "),
      width: item.width || "",
      height: item.height || "",
    }).filter((item) => item.url || item.srcset);
}
function normalizeLinks(items) { return (Array.isArray(items) ? items : []).map((item) => typeof item === "string" ? item : item.url || item.href || "").filter(Boolean); }

function sameHostNavigationLinks(values = [], website = "") {
  const host = publicHost(website);
  if (!host) return [];
  return dedupeNavigationPages(values.map((value) => {
    const url = absolute(value, website);
    if (!url || publicHost(url) !== host) return null;
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol) || /\.(?:avif|gif|jpe?g|png|svg|webp|css|js|json|xml|pdf|zip|mp4|webm)$/i.test(parsed.pathname)) return null;
      parsed.hash = "";
      return {
        url: parsed.href,
        path: parsed.pathname || "/",
        source_host: host,
      };
    } catch { return null; }
  }).filter(Boolean));
}

function navigationPageInventory(pages = [], website = "") {
  const officialPages = pages.filter((page) => publicHost(page.url) === publicHost(website));
  return dedupeNavigationPages(officialPages.flatMap((page) => [
    { url: page.url, path: (() => { try { return new URL(page.url).pathname || "/"; } catch { return "/"; } })(), source_host: publicHost(website) },
    ...sameHostNavigationLinks(normalizeLinks(page.links), website),
  ]));
}

function dedupeNavigationPages(values = []) {
  const out = [];
  const seen = new Set();
  for (const item of values) {
    if (!item?.url || !isPublicAsset(item.url)) continue;
    let key;
    try {
      const parsed = new URL(item.url);
      parsed.hash = "";
      key = parsed.href;
    } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, path: String(item.path || "/").slice(0, 500), source_host: publicHost(key) });
    if (out.length >= MAX_NAVIGATION_PAGES) break;
  }
  return out;
}

function pageImageCandidates(page = {}) {
  const base = page.url;
  const candidates = normalizeImages(page.images).flatMap((item) => [
    { url: item.url, alt: item.alt },
    { url: bestSrcsetCandidate(item.srcset), alt: item.alt },
  ]);
  const html = String(page.html || "");
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    candidates.push({ url: attr(tag, "src") || attr(tag, "data-src"), alt: attr(tag, "alt") });
    candidates.push({ url: bestSrcsetCandidate(attr(tag, "srcset") || attr(tag, "data-srcset")), alt: attr(tag, "alt") });
  }
  candidates.push({ url: page.metadata?.ogImage || page.metadata?.["og:image"] || "", alt: "Open Graph image" });
  return candidates.map((item) => ({ ...item, url: normalizeSafeSourceImageUrl(item.url, base) })).filter((item) => item.url);
}

function firstPartyImageInventory(pages = [], website = "") {
  const host = publicHost(website);
  const officialPages = pages.filter((page) => host && publicHost(page.url) === host);
  return dedupeImageInventory(officialPages.flatMap((page) => pageImageCandidates(page).map((item) => ({
    url: item.url,
    alt: String(item.alt || "").trim().slice(0, 240),
    source_page: page.url,
    source_host: host,
  }))));
}

function dedupeImageInventory(values = []) {
  const out = [];
  const seen = new Set();
  for (const item of values) {
    if (!item?.url || !isSafeSourceAssetUrl(item.url)) continue;
    const key = sourceAssetIdentity(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      url: normalizeSourcePhotoUrl(item.url),
      alt: String(item.alt || "").slice(0, 240),
      source_page: isPublicAsset(item.source_page) ? item.source_page : "",
      source_host: publicHost(item.source_page) || String(item.source_host || "").slice(0, 253),
    });
    if (out.length >= MAX_IMAGE_INVENTORY) break;
  }
  return out;
}
function absolute(value, base) {
  const input = String(value || "").trim();
  if (!input) return "";
  // An already-absolute asset is valid on its own. Do not let a malformed
  // compiler base (PageHub can return "example.com" without a scheme) poison it.
  try { return new URL(input).href; } catch { /* resolve relative input below */ }
  let normalizedBase = String(base || "").trim();
  if (normalizedBase && !/^[a-z][a-z0-9+.-]*:/i.test(normalizedBase)) {
    normalizedBase = `https://${normalizedBase.replace(/^\/+/, "")}`;
  }
  try { return new URL(input, normalizedBase || undefined).href; } catch { return ""; }
}
function attr(tag, name) { return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] || ""; }
function first(text, re) { return String(text).match(re)?.[0]?.trim() || ""; }
function cleanTitle(value) { return String(value).replace(/\s*[|–—-]\s*(home|official site|homepage).*$/i, "").trim().slice(0, 120); }
function isPublicAsset(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !/localhost|127\.0\.0\.1/.test(url.hostname); } catch { return false; } }
export function normalizeSourcePhotoUrl(value = "", base = "") {
  const absoluteUrl = absolute(value, base || undefined);
  if (!absoluteUrl) return "";
  try {
    const url = new URL(absoluteUrl);
    if (url.hostname.toLowerCase() !== "static.wixstatic.com") return url.href;
    const match = url.pathname.match(/^\/media\/([^/]+)(?:\/v1\/.*)?$/i);
    if (!match) return url.href;
    // Wix puts responsive crop, resize, quality, AVIF, and blur directives
    // after the immutable media id. The short /media/<id.ext> URL is the
    // original source asset and avoids probing a 25–180 px LQIP derivative.
    url.pathname = `/media/${match[1]}`;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeSafeSourceImageUrl(value = "", base = "") {
  const raw = absolute(value, base || undefined);
  if (!raw || !isSafeSourceAssetUrl(raw)) return "";
  const normalized = normalizeSourcePhotoUrl(raw);
  return isSafeSourceAssetUrl(normalized) ? normalized : "";
}

function rawCandidateEvidence(value, evidence = "") {
  const one = (candidate) => {
    if (!candidate) return "";
    if (typeof candidate !== "object") return String(candidate);
    return [
      candidate.url,
      candidate.src,
      candidate.alt,
      candidate.title,
      candidate.label,
      candidate.role,
      candidate.kind,
      candidate.className,
      candidate.class,
      candidate.id,
      candidate.roleContext,
      candidate.containerContext,
      candidate.rawTag,
      candidate.width,
      candidate.height,
    ].filter(Boolean).join(" ");
  };
  return `${one(value)} ${one(evidence)}`.trim();
}

function renderedImageDimensions(value, evidence = "") {
  for (const candidate of [value, evidence]) {
    if (!candidate || typeof candidate !== "object") continue;
    const width = Number(candidate.width || 0);
    const height = Number(candidate.height || 0);
    if (width > 0 && height > 0) return { width, height };
  }
  const text = rawCandidateEvidence(value, evidence);
  const widthAttr = Number(text.match(/\bwidth\s*=\s*["']?(\d{1,4})(?:\D|$)/i)?.[1] || 0);
  const heightAttr = Number(text.match(/\bheight\s*=\s*["']?(\d{1,4})(?:\D|$)/i)?.[1] || 0);
  if (widthAttr > 0 && heightAttr > 0) return { width: widthAttr, height: heightAttr };
  // Wix URLs contain both source crop dimensions and rendered fill dimensions.
  // Only /fill/w_,h_ describes what the visitor actually sees; /crop/...w_,h_
  // describes the large source slice and must not override a 93 px badge.
  const fill = text.match(/\/fill\/([^/?\s"'<>]+)/i)?.[1] || "";
  const fillWidth = Number(fill.match(/(?:^|,)w_(\d{1,4})(?:,|$)/i)?.[1] || 0);
  const fillHeight = Number(fill.match(/(?:^|,)h_(\d{1,4})(?:,|$)/i)?.[1] || 0);
  if (fillWidth > 0 && fillHeight > 0) return { width: fillWidth, height: fillHeight };
  const width = Number(text.match(/\b(?:w|width)\s*[:=]\s*["']?(\d{1,4})(?:\D|$)/i)?.[1] || 0);
  const height = Number(text.match(/\b(?:h|height)\s*[:=]\s*["']?(\d{1,4})(?:\D|$)/i)?.[1] || 0);
  return { width, height };
}

function smallSquareIconEvidence(value = "", evidence = "") {
  const { width, height } = renderedImageDimensions(value, evidence);
  if (!width || !height || Math.max(width, height) > 128) return false;
  const ratio = width / height;
  return ratio >= 0.72 && ratio <= 1.38;
}

function isRawLogoOrIconJunk(value, evidence = "") {
  const text = rawCandidateEvidence(value, evidence);
  if (isHardRawLogoOrIconJunk(value, evidence)) return true;
  return smallSquareIconEvidence(value, evidence) && !isExplicitPrimaryLogoEvidence(value, evidence);
}

function isHardRawLogoOrIconJunk(value, evidence = "") {
  const text = rawCandidateEvidence(value, evidence);
  return LOGO_JUNK.test(text) || RAW_ICON_JUNK.test(text);
}

function isExplicitPrimaryLogoEvidence(value, evidence = "") {
  if (value?.brandingLogo === true || evidence?.brandingLogo === true) return true;
  const text = rawCandidateEvidence(value, evidence);
  const structured = value && typeof value === "object"
    ? value
    : evidence && typeof evidence === "object"
      ? evidence
      : null;
  const roleText = structured
    ? `${structured.roleContext || ""} ${structured.rawTag || ""}`
    : String(evidence || "");
  const containerText = structured
    ? String(structured.containerContext || "")
    : String(evidence || "");
  const primaryRole = /\b(?:(?:brand|primary|site)[-_ ]*(?:logo|mark)|(?:logo|mark)[-_ ]*(?:brand|primary|site))\b/i.test(roleText);
  const primaryPosition = /\b(?:header|masthead|nav|navbar)\b/i.test(containerText);
  return primaryRole && primaryPosition && !LOGO_JUNK.test(text) && !RAW_ICON_JUNK.test(text);
}

function bestSrcsetCandidate(value = "") {
  const srcset = String(value || "").trim();
  if (!srcset) return "";
  const candidates = [];
  const withDescriptor = /(?:^|,\s*)((?:[^\s]|\s(?!\d+(?:\.\d+)?[wx](?:\s*,|\s*$)))+?)\s+(\d+(?:\.\d+)?)(w|x)(?=\s*(?:,|$))/gi;
  let match;
  while ((match = withDescriptor.exec(srcset))) {
    candidates.push({ url: match[1].trim(), value: Number(match[2]), unit: match[3].toLowerCase() });
  }
  if (candidates.length) {
    const widthCandidates = candidates.filter((candidate) => candidate.unit === "w");
    const ranked = widthCandidates.length ? widthCandidates : candidates;
    return ranked.sort((left, right) => right.value - left.value)[0]?.url || "";
  }
  return srcset.split(/,\s+/).map((item) => item.trim().split(/\s+/)[0]).filter(Boolean).at(-1) || "";
}

export function sourceAssetIdentity(value = "") {
  try {
    const url = new URL(normalizeSourcePhotoUrl(value) || value);
    url.hash = "";
    // GoDaddy and similar CDNs append resize/crop transforms after /:/. The
    // underlying file is the same proof image and must count once.
    url.pathname = url.pathname.replace(/\/:\/.*$/, "").replace(/\/{2,}/g, "/");
    for (const key of ["w", "h", "width", "height", "fit", "crop", "q", "quality", "auto", "dpr"]) url.searchParams.delete(key);
    return `${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname).toLowerCase()}?${[...url.searchParams].sort().map(([k, v]) => `${k}=${v}`).join("&")}`;
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

export function isUsableSourcePhotoUrl(value = "") {
  const raw = absolute(value);
  if (!isSafeSourceAssetUrl(raw)) return false;
  const normalized = normalizeSourcePhotoUrl(value);
  if (!isSafeSourceAssetUrl(normalized)) return false;
  const text = decodeURIComponent(normalized);
  if (/isteam\/stock|\/stock\/|unsplash|pexels|shutterstock|placeholder|dummyimage|thumbnail|\bthumb\b/i.test(text) || SOURCE_MEDIA_JUNK.test(text)) return false;
  const widths = [...text.matchAll(/(?:^|[^a-z])(?:w|width)[:=](\d{1,4})(?:\D|$)/gi)].map((m) => Number(m[1]));
  if (widths.some((width) => width > 0 && width < 240)) return false;
  return true;
}

function dedupeSourcePhotos(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!isUsableSourcePhotoUrl(value)) continue;
    const key = sourceAssetIdentity(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function dedupeTrustMarks(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const mark = typeof value === "string"
      ? looseTrustMarkCandidate(value)
      : value;
    if (!mark?.url || !isSafeSourceAssetUrl(mark.url) || TRUST_MARK_UNSAFE.test(mark.url)) continue;
    const key = sourceAssetIdentity(mark.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      url: mark.url,
      label: trustMarkLabel(mark.label, mark.url),
      evidence: String(mark.evidence || "explicit-site-trust-mark").slice(0, 80),
    });
  }
  return out;
}

function dedupeAssets(values = []) {
  const seen = new Set();
  return values.filter((asset) => {
    if (!asset?.url) return true;
    if (!isSafeSourceAssetUrl(asset.url)) return false;
    if (asset.kind === "photo" && !isUsableSourcePhotoUrl(asset.url)) return false;
    if (asset.kind === "logo" && LOGO_JUNK.test(asset.url)) return false;
    if (asset.kind === "trust_mark" && TRUST_MARK_UNSAFE.test(asset.url)) return false;
    const key = `${asset.kind || "asset"}:${sourceAssetIdentity(asset.url)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function excludeLogoIdentitiesFromPhotos(values = []) {
  const assets = dedupeAssets(values);
  const logoIdentities = new Set(assets
    .filter((asset) => asset?.kind === "logo")
    .map((asset) => sourceAssetIdentity(asset.url))
    .filter(Boolean));
  if (!logoIdentities.size) return assets;
  return assets.filter((asset) => (
    asset?.kind !== "photo"
    || !logoIdentities.has(sourceAssetIdentity(asset.url))
  ));
}

export function sanitizeSourceAssets(values = []) {
  return excludeLogoIdentitiesFromPhotos(values).map((asset) => {
    const meta = {};
    for (const key of ["logo_evidence", "trust_mark_evidence", "treatment", "quality_status", "fallback_to_ambiance", "width", "height", "source_width", "source_height"]) {
      if (asset?.meta?.[key] !== undefined) meta[key] = asset.meta[key];
    }
    const width = Number(asset?.width || asset?.meta?.width || asset?.meta?.dimensions?.width || 0);
    const height = Number(asset?.height || asset?.meta?.height || asset?.meta?.dimensions?.height || 0);
    const profileSource = `${asset?.source || ""} ${asset?.origin || ""}`.toLowerCase();
    const identityEvidence = asset?.kind === "photo" && /\b(?:gbp(?:-deep)?|business-profile)\b/.test(profileSource)
      ? sanitizeIdentityEvidence(asset?.meta?.identity_evidence)
      : [];
    const hasBoundIdentityEvidence = identityEvidence.some((value) => value.startsWith("name:"))
      && identityEvidence.some((value) => value === "phone:last7" || value.startsWith("city:"));
    if (hasBoundIdentityEvidence) meta.identity_evidence = identityEvidence;
    const sourceUrl = String(asset?.provenance?.source_url || asset?.source_url || "");
    const provenance = {
      source_url: isPublicAsset(sourceUrl) ? sourceUrl : "",
      source_host: publicHost(sourceUrl),
      owner_key: String(asset?.provenance?.owner_key || asset?.owner_key || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80),
      source: String(asset?.provenance?.source || asset?.source || "").slice(0, 80),
      origin: String(asset?.provenance?.origin || asset?.origin || "").slice(0, 80),
    };
    const googleBusinessProvenance = provenance.source_host === "google.com"
      || provenance.source_host.endsWith(".google.com")
      || provenance.source_host === "maps.app.goo.gl";
    const ownerTokens = new Set(provenance.owner_key.split(/[^a-z0-9]+/).filter(Boolean));
    const nameEvidence = identityEvidence.find((value) => value.startsWith("name:")) || "";
    const nameTokens = nameEvidence.replace(/^name:/, "").split("+").filter(Boolean);
    const nameBoundToOwner = nameTokens.length > 0 && nameTokens.every((token) => ownerTokens.has(token));
    const boundProfileSource = hasBoundIdentityEvidence
      && googleBusinessProvenance
      && nameBoundToOwner
      && Boolean(provenance.owner_key);
    if (boundProfileSource) {
      meta.source_provenance = {
        source_url: provenance.source_url,
        source_host: provenance.source_host,
        owner_key: provenance.owner_key,
      };
    }
    const containedSource = boundProfileSource
      && asset?.meta?.contained_source === true
      && asset?.meta?.display_policy === "contained-source-proof"
      && width >= 320
      && height >= 320
      && width * height >= 120_000;
    if (containedSource) {
      meta.contained_source = true;
      meta.display_policy = "contained-source-proof";
    }
    const authenticatedOwnerUpload = asset?.provenance?.authenticated_owner_upload === true
      || asset?.authenticated_owner_upload === true
      || (/^upload$/i.test(provenance.source) && /^upload$/i.test(provenance.origin));
    if (authenticatedOwnerUpload) provenance.authenticated_owner_upload = true;
    if (width > 0 && height > 0) meta.dimensions = { width, height };
    return {
      kind: String(asset?.kind || "asset").slice(0, 24),
      url: ["logo", "photo"].includes(asset?.kind)
        ? normalizeSafeSourceImageUrl(asset?.url)
        : String(asset?.url || ""),
      label: String(asset?.label || "Business asset").slice(0, 120),
      source: publicSourceLabel(asset?.source),
      origin: publicOriginLabel(asset?.origin),
      approved: asset?.approved !== false,
      ...(width > 0 && height > 0 ? { width, height } : {}),
      ...(asset?.hero_eligible === false ? { hero_eligible: false } : {}),
      ...(asset?.proof_eligible === false
        ? { proof_eligible: false }
        : containedSource && asset?.proof_eligible === true
          ? { proof_eligible: true }
          : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
      ...((provenance.source_url && provenance.source_host && provenance.owner_key) || authenticatedOwnerUpload ? { provenance } : {}),
    };
  }).slice(0, 30);
}

function sanitizeIdentityEvidence(values = []) {
  if (!Array.isArray(values)) return [];
  const allowed = /^(?:name:[a-z0-9]{3,}(?:\+[a-z0-9]{3,}){0,3}|phone:last7|city:[a-z0-9]{3,}(?:\+[a-z0-9]{3,}){0,2})$/;
  return unique(values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => allowed.test(value)))
    .slice(0, 4);
}

function isSafeSourceAssetUrl(value = "") {
  if (!isPublicAsset(value)) return false;
  try {
    const url = new URL(value);
    if (/\/(?:undefined|null)(?:[/?#]|$)/i.test(url.pathname)) return false;
    if (SOURCE_MEDIA_JUNK.test(`${url.hostname}${url.pathname}`)) return false;
    return ![...url.searchParams.keys()].some((key) => SENSITIVE_QUERY.test(key));
  } catch {
    return false;
  }
}

function publicSourceLabel(value = "") {
  const text = String(value || "").toLowerCase();
  if (["business-evidence", "business-profile", "business-site", "owner-supplied", "social-profile"].includes(text)) return text;
  if (/upload|operator|drive|dropbox/.test(text)) return "owner-supplied";
  if (/gbp|google/.test(text)) return "business-profile";
  if (/social/.test(text)) return "social-profile";
  if (/site|web|crawl|pagehub|discover/.test(text)) return "business-site";
  return "business-evidence";
}

function publicOriginLabel(value = "") {
  const text = String(value || "").toLowerCase();
  if (/upload|operator/.test(text)) return "owner-supplied";
  if (/ai-candidate/.test(text)) return "generated-candidate";
  return "business-evidence";
}

export function socialBelongsToBusiness(value = "", businessName = "", website = "") {
  let compact = "";
  try { compact = decodeURIComponent(new URL(value).pathname).toLowerCase().replace(/[^a-z0-9]/g, ""); } catch { return false; }
  const domainToken = (() => { try { return new URL(website).hostname.replace(/^www\./, "").split(".")[0]; } catch { return ""; } })();
  const ignored = /^(?:the|and|inc|llc|company|services?|landscaping|roofing|plumbing|fencing|official)$/i;
  const tokens = `${businessName} ${domainToken}`.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !ignored.test(token));
  return tokens.some((token) => compact.includes(token));
}
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function headers(key) { return { "Content-Type": "application/json", Authorization: `Bearer ${key}` }; }
async function fetchAndReadWithTimeout(url, options, ms, readBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { response, body: await readBody(response) };
  } finally {
    clearTimeout(timer);
  }
}
export function fetchJsonWithTimeout(url, options, ms) {
  return fetchAndReadWithTimeout(url, options, ms, async (response) => {
    try {
      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return {};
    }
  });
}
export function fetchTextWithTimeout(url, options, ms) {
  return fetchAndReadWithTimeout(url, options, ms, (response) => response.text());
}
function emptyResult(sources, warning) { return { sources, searched: [], facts: {}, found: { logo: null, photos: [], videos: [], trust_marks: [], colors: [], fonts: [], services: [], contact: {}, socials: [], copy: "" }, assets: [], image_inventory: [], navigation_pages: [], summary: { mode: "none", pages_read: 0, photos_found: 0, trust_marks_found: 0, videos_found: 0, services_found: 0, logo_found: false, notes: [warning] } }; }
