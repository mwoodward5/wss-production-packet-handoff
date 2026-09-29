"use strict";

// lib/intake-packet.js — the LAST PART of the Intake Compiler, rolled in.
//
// The Compiler emails a ~109-file packet per client: page copy as markdown,
// service pages, an SEO plan, a BrightData SERP audit, a voice-search plan,
// city lists, FAQ sets. The Mirror Engine has been building from 19 flat facts
// while all of that sat unread — the gap recorded in
// [[wss-intake-compiler-packet-anatomy]]. This reads a packet directory and
// hands the engine the parts it can legitimately use.
//
// ⚠ THE BOUNDARY, AND IT IS NOT NEGOTIABLE ⚠
// The Compiler may supply PROSE and KEYWORDS. It may never supply a FACT.
// [[wss-genie-fabricates-and-render-proof]] is the reason: it invents NAP and
// then self-stamps the invention "operator_verified 0.9". So this module
// REFUSES, by construction, to return a phone, address, email, rating, review
// count, licence or business identity — those come from Google Places through
// the verified-facts path and nowhere else. A packet that contains them is not
// an error; the fields are simply never read.
//
// What comes back is narrative and search intent: how the business describes
// its own work, the questions its customers ask, and the words they search.

const fs = require("node:fs");
const path = require("node:path");
const { observedBrand } = require("./pagehub-build-packet");
const { certifiedPracticeVisitorCopy } = require("./intake-genie-client");

const PATH_SCOPED_EVIDENCE_HOSTS = Object.freeze([
  "wixsite.com", "square.site", "notion.site", "linktr.ee", "bio.site", "canva.site",
  "youtube.com", "tiktok.com",
]);

// Front matter is metadata for the Compiler's own pipeline, not page copy.
function stripFrontMatter(text) {
  const s = String(text || "");
  return /^---\r?\n/.test(s) ? s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "") : s;
}

function readJson(dir, name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { return null; }
}
function readText(dir, ...rel) {
  try { return fs.readFileSync(path.join(dir, ...rel), "utf8"); } catch { return ""; }
}

const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function safeHttpUrl(value) {
  const raw = clean(value);
  if (!/^https?:\/\//i.test(raw)) return "";
  try { return new URL(raw).href; } catch { return ""; }
}

function sameSiteHost(left, right) {
  try {
    const leftUrl = new URL(safeHttpUrl(left));
    const rightUrl = new URL(safeHttpUrl(right));
    const a = leftUrl.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const b = rightUrl.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!a || !b || !(a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))) return false;
    const sharedHost = PATH_SCOPED_EVIDENCE_HOSTS.find((host) => a === host || a.endsWith(`.${host}`));
    if (!sharedHost) return true;
    if (sharedHost === "wixsite.com") {
      if (a !== b) return false;
      const leftTenant = tenantPathKey(sharedHost, leftUrl);
      const rightTenant = tenantPathKey(sharedHost, rightUrl);
      return Boolean(leftTenant && leftTenant === rightTenant);
    }
    // Exact tenant-specific subdomains are self-scoping at `/`; only a shared
    // apex such as linktr.ee needs its first path segment to identify a tenant.
    if (a !== sharedHost || b !== sharedHost) return a === b;
    const leftTenant = tenantPathKey(sharedHost, leftUrl);
    const rightTenant = tenantPathKey(sharedHost, rightUrl);
    return Boolean(leftTenant && leftTenant === rightTenant);
  } catch {
    return false;
  }
}

function normalizedWords(value) {
  return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsPhrase(value, phrase) {
  const haystack = ` ${normalizedWords(value)} `;
  const needle = normalizedWords(phrase);
  return Boolean(needle && haystack.includes(` ${needle} `));
}

function tenantPathKey(sharedHost, url) {
  const segments = String(url?.pathname || "").split("/").map((part) => part.trim()).filter(Boolean);
  if (!segments.length) return "";
  const prefix = segments[0].toLowerCase();
  const routePrefixes = sharedHost === "square.site"
    ? new Set(["book"])
    : sharedHost === "youtube.com"
      ? new Set(["channel", "user", "c", "shorts", "live"])
      : new Set();
  if (!routePrefixes.has(prefix)) return prefix;
  return segments[1] ? `${prefix}/${segments[1]}` : "";
}

function values(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function evidenceSourceUrl(row = {}) {
  const nested = object(row.source);
  return safeHttpUrl(row.source_url || nested.url || (typeof row.source === "string" ? row.source : ""));
}

function evidenceMatchesFieldValue(row, field, value) {
  if (normalizedWords(row?.field || row?.type) !== normalizedWords(field)) return false;
  return values(row?.value ?? row?.actual ?? row?.name)
    .some((candidate) => normalizedWords(candidate) === normalizedWords(value));
}

function verifiedObservedLocation(root, website, field) {
  const value = clean(root.facts?.[field]);
  if (!value) return "";
  const packet2 = object(root.packet2);
  const rows = [root.evidence, packet2.evidence].filter(Array.isArray).flat().filter((row) => object(row) === row);
  const matched = rows.some((row) => {
    if (row.generated === true || !evidenceMatchesFieldValue(row, field, value)) return false;
    const provenance = normalizedWords(row.provenance || row.source_type);
    const status = normalizedWords(row.verification_status || row.status);
    if (provenance === "owner supplied" && status === "owner supplied") return true;
    const sourceUrl = evidenceSourceUrl(row);
    return Boolean(sourceUrl && sameSiteHost(website, sourceUrl))
      && (provenance === "observed" || row.verified === true)
      && /^(?:source observation|observed|verified|approved)$/.test(status);
  });
  return matched ? value : "";
}

function hex6(value) {
  const match = clean(value).match(/^#?([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (!match) return "";
  const body = match[1].length === 3
    ? match[1].split("").map((char) => char + char).join("")
    : match[1];
  return `#${body.toUpperCase()}`;
}

function observationRows(root, website) {
  const packet2 = object(root.packet2);
  return [root.observations, packet2.sources?.observations]
    .filter(Array.isArray).flat().map((row) => ({
      source: safeHttpUrl(row?.source || row?.url),
      extracted: object(row?.extracted),
    })).filter((row) => row.source && sameSiteHost(website, row.source));
}

function observationForSource(observations, ...sources) {
  const allowed = new Set(sources.map(safeHttpUrl).filter(Boolean));
  return observations.find((row) => allowed.has(row.source));
}

function observedPaletteHexes(extracted = {}) {
  const candidates = [extracted.brandPalette, extracted.palette, extracted.brandColors, extracted.colors]
    .flatMap(values);
  const out = new Set();
  for (const candidate of candidates) {
    const raw = candidate && typeof candidate === "object"
      ? candidate.hex || candidate.color || candidate.value
      : candidate;
    const direct = hex6(raw);
    if (direct) out.add(direct);
    for (const match of String(raw || "").match(/#[0-9a-f]{3,8}\b/gi) || []) {
      const parsed = hex6(match);
      if (parsed) out.add(parsed);
    }
  }
  return out;
}

function valueBoundBrandSnapshot(root, website) {
  const packet2 = object(root.packet2);
  const rootBrand = object(root.brand);
  const packetBrand = object(packet2.brand);
  const observations = observationRows(root, website);
  const envelope = observationForSource(
    observations,
    rootBrand.source,
    rootBrand.source_url,
    rootBrand.observed_on,
    packetBrand.source,
    packetBrand.source_url,
    packetBrand.observed_on,
  );
  if (!envelope) return { ...root, brand: {}, packet2: { ...packet2, brand: {} } };

  const palette = [rootBrand.palette, rootBrand.brandPalette, packetBrand.palette, packetBrand.brandPalette]
    .filter(Array.isArray).flat().filter((value) => {
      const row = object(value);
      const source = observationForSource(observations, row.source, row.source_url, row.observed_on, row.found_on);
      const hex = hex6(row.hex || row.color || row.value);
      return Boolean(source && hex && observedPaletteHexes(source.extracted).has(hex));
    });
  const fontInput = { ...object(packetBrand.fonts), ...object(rootBrand.fonts) };
  const fontObservation = observationForSource(
    observations,
    fontInput.source,
    fontInput.source_url,
    fontInput.observed_on,
    fontInput.found_on,
  );
  const observedFonts = fontObservation ? {
    display: clean(fontObservation.extracted.typographyDisplay || fontObservation.extracted.displayFont),
    body: clean(fontObservation.extracted.typographyBody || fontObservation.extracted.bodyFont),
    href: safeHttpUrl(fontObservation.extracted.googleFontsUrl || fontObservation.extracted.fontsHref),
  } : {};
  const wantedFonts = {
    display: clean(fontInput.display || fontInput.heading || fontInput.headingFont),
    body: clean(fontInput.body || fontInput.bodyFont),
    href: safeHttpUrl(fontInput.href),
  };
  const fontsBound = Boolean(fontObservation && wantedFonts.href
    && (!wantedFonts.display || normalizedWords(wantedFonts.display) === normalizedWords(observedFonts.display))
    && (!wantedFonts.body || normalizedWords(wantedFonts.body) === normalizedWords(observedFonts.body))
    && wantedFonts.href === observedFonts.href);
  const brand = {
    source_url: envelope.source,
    palette,
    ...(fontsBound ? { fonts: { ...wantedFonts, source_url: fontObservation.source } } : {}),
  };
  return { ...root, brand, packet2: { ...packet2, brand: {} } };
}

function canonicalPlan(packet = {}) {
  const root = object(packet);
  const content = object(root.content);
  const packet2 = object(root.packet2);
  const compiled = object(packet2.compiled);
  const pages = [content.page_plan, content.pagePlan, packet2.pagePlan, root.pagePlan]
    .find(Array.isArray) || [];
  const routes = [content.route_content_map, content.routeContentMap, compiled.routeContentMap]
    .find(Array.isArray) || [];
  const requirements = { ...object(packet2.requirements), ...object(root.requirements) };
  return {
    pages: pages.slice(0, 40),
    routes: routes.slice(0, 80),
    requirements,
    summary: clean([
      ...pages.map((page) => object(page).title || object(page).name || object(page).slug),
      requirements.pagesNeeded,
      ...(Array.isArray(requirements.requiredSections) ? requirements.requiredSections : []),
    ].filter(Boolean).join("\n")),
  };
}

function canonicalBrandAndMedia(packet = {}, website = "") {
  const root = object(packet);
  // `website` is supplied only after the caller binds a provenanced LeadMiner
  // field to the signed receipt domain. Never fall back to packet-authored
  // facts here: a place-id-only receipt must not authorize an arbitrary site.
  const site = safeHttpUrl(website);
  if (!site) return {};
  const assets = [];
  const seen = new Set();
  const packet2 = object(root.packet2);
  const candidates = [root.assets, packet2.sources?.logos, packet2.sources?.images]
    .filter(Array.isArray).flat();
  for (const value of candidates) {
    const row = object(value);
    const url = safeHttpUrl(row.url || row.src || row.link);
    const rawKind = clean(row.kind || row.type).toLowerCase();
    const kind = /logo|wordmark|emblem/.test(rawKind) ? "logo"
      : /video|clip|reel|motion/.test(rawKind) ? "video"
        : /photo|image|hero|gallery/.test(rawKind) ? "photo" : "";
    const observedOn = safeHttpUrl(row.observed_on || row.found_on || row.source_page);
    const explicitlyOwned = row.approved === true
      && row.ownership_verified === true
      && (row.verified === true || /^(?:verified|approved)$/.test(clean(row.verification_status || row.status).toLowerCase()));
    const key = `${kind}|${url}`.toLowerCase();
    // Unlike the candidate path, a direct MirrorBrand has no observed_on
    // field. Require both the bytes and the page that exposed them to be on
    // the independently verified first-party host, then let the engine fetch,
    // sniff and denylist the bytes again.
    if (!/^https:\/\//i.test(url) || !explicitlyOwned || !["logo", "photo", "video"].includes(kind) || !sameSiteHost(site, url)
      || !observedOn || !sameSiteHost(site, observedOn) || seen.has(key)) continue;
    seen.add(key);
    assets.push({ kind, url });
  }
  const logo = assets.find((asset) => asset.kind === "logo")?.url || "";
  const photos = assets.filter((asset) => asset.kind === "photo").map((asset) => asset.url).slice(0, 20);
  const video = assets.find((asset) => asset.kind === "video")?.url || "";
  return {
    ...observedBrand(valueBoundBrandSnapshot(root, site), site),
    ...(logo ? { logo } : {}),
    ...(photos.length ? { photos } : {}),
    ...(video ? { hero_video: { url: video } } : {}),
  };
}

function faqPairsFromMarkdown(markdown = "") {
  const lines = stripFrontMatter(markdown).split(/\r?\n/);
  const faqs = [];
  let question = "";
  let answer = [];
  const flush = () => {
    const q = clean(question);
    const a = clean(answer.join(" ").replace(/\*\*/g, ""));
    if (q && a && /\?$/.test(q)) faqs.push({ q, a });
    question = "";
    answer = [];
  };
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      question = clean(heading[1].replace(/\*\*/g, ""));
    } else if (question && line.trim() && !/^[-*>|]/.test(line.trim())) {
      answer.push(line.trim());
    }
  }
  flush();
  return faqs.slice(0, 20);
}

// Builder/directive markdown is the Compiler talking to a site builder. Even a
// file that slipped through the certified contract must never be reinterpreted
// as visitor copy, so every projection below applies this consumer-side stop.
const BUILDER_DIRECTIVE_PATH = /(?:^|\/)(?:00-[^/]*|[^/]*vercel[^/]*|[^/]*prompt[^/]*|[^/]*runbook[^/]*|[^/]*contract[^/]*)\.md$/i;

function builderDirectiveMarkdown(filePath) {
  return BUILDER_DIRECTIVE_PATH.test(String(filePath || ""));
}

// The only non-markdown certified files that may be read as search copy. They
// are data the SERP work produced; directive/builder markdown never qualifies.
const CERTIFIED_SEARCH_COPY_FILES = new Set([
  "seo.json",
  "search-optimization-plan.json",
  "brightdata-serp-audit.json",
  "voice-search.json",
]);

function certifiedSearchJson(files) {
  const out = {};
  for (const name of CERTIFIED_SEARCH_COPY_FILES) {
    const body = files[name] ?? files[`content/${name}`];
    if (typeof body !== "string") continue;
    try { out[name] = JSON.parse(body); } catch { /* not search data after all */ }
  }
  return out;
}

function keywordTerms(list) {
  return (Array.isArray(list) ? list : []).map((entry) => clean(
    typeof entry === "string" ? entry : (entry && (entry.keyword || entry.query || entry.term)),
  ))
    // MirrorContent.keywords items are maxLength 80; bound the terms BEFORE
    // the shared ≤24 cap so an over-long string never consumes a slot.
    .filter((term) => term && term.length <= 80);
}

// Final schema bound on the assembled list (defense in depth).
function schemaBoundedKeywords(keywords) {
  return keywords.filter((term) => term.length <= 80).slice(0, 24);
}

/**
 * Search intent from the receipt-covered canonical packet.
 *
 * Keywords and SEO copy are the two things the Compiler is allowed to supply
 * besides prose. The sources mirror the disk packet exactly: a signed packet's
 * seo.json / search-optimization-plan.json / brightdata-serp-audit.json /
 * voice-search.json are serialisations of packet.optimization,
 * packet2.compiled.searchOptimizationPlan, .brightDataQueryPlan/.brightDataAudit
 * and .voiceSearch, and the whole packet is covered by the receipt digest, so
 * those structured fields are the same data with the filesystem removed.
 *
 * Provenance-bound optimization.target_queries lead; the generated search plan
 * and Bright Data queries follow; a certified visitor-copy JSON file (should
 * the compiler ever admit one) is read last. Nothing here invents a term, and
 * generated marketing prose (e.g. compiled.seo.description) is deliberately
 * NOT reinterpreted — only explicit search-copy fields cross.
 */
function canonicalSearchIntent(packet = {}, files = {}) {
  const root = object(packet);
  const packet2 = object(root.packet2);
  const compiled = object(packet2.compiled);
  const searchPlan = object(compiled.searchOptimizationPlan);
  const compiledSeo = object(compiled.seo);
  const optimization = object(root.optimization);
  const voiceSearch = object(compiled.voiceSearch);

  const certified = certifiedSearchJson(files);
  const seoFile = object(certified["seo.json"]);
  const serpFile = certified["brightdata-serp-audit.json"] || certified["search-optimization-plan.json"] || null;
  const voiceFile = object(certified["voice-search.json"]);

  const seoLike = {
    keywords: [
      ...keywordTerms(optimization.target_queries),
      ...keywordTerms(compiledSeo.primaryKeyword ? [compiledSeo.primaryKeyword] : []),
      ...keywordTerms(compiledSeo.secondaryKeywords),
      ...keywordTerms(searchPlan.primaryKeyword ? [searchPlan.primaryKeyword] : []),
      ...keywordTerms(searchPlan.secondaryKeywords),
      ...keywordTerms(seoFile.keywords),
    ],
  };
  const serpLike = {
    queries: [
      ...keywordTerms(object(compiled.brightDataQueryPlan).queries),
      ...keywordTerms(object(compiled.brightDataAudit).queries),
      ...(serpFile ? keywordTerms(serpFile.keywords || serpFile.queries || serpFile.target_keywords || serpFile.primary_keywords) : []),
    ],
  };
  const voiceLike = {
    primaryService: clean(voiceSearch.primaryService) || clean(voiceFile.primaryService),
    city: clean(voiceSearch.city) || clean(voiceFile.city),
  };
  const keywords = schemaBoundedKeywords(keywordsFrom(seoLike, serpLike, voiceLike));

  // SEO title/description only from explicit search-copy fields: the seo.json
  // keys (siteTitle/siteDescription) and the packet's own declared
  // optimization.meta_description/seo_description. Generated plan prose such as
  // compiled.seo.description stays out — that is marketing copy, not search data.
  const description = [
    clean(seoFile.siteDescription),
    clean(optimization.meta_description),
    clean(optimization.seo_description),
    clean(compiledSeo.siteDescription),
    clean(searchPlan.siteDescription),
  ].find(Boolean) || "";
  const seo = {
    title: [
      clean(seoFile.siteTitle),
      clean(compiledSeo.siteTitle),
      clean(searchPlan.siteTitle),
    ].find(Boolean) || "",
    // MirrorContent.seo_description is maxLength 200; cut at a word boundary
    // so a long honest sentence cannot 400 the build at the schema.
    ...(description ? { description: wordBoundedCut(description, 200) } : { description: "" }),
  };
  return { keywords, seo };
}

function wordBoundedCut(value, maxLength) {
  const text = clean(value);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const boundary = cut.lastIndexOf(" ");
  return (boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.-]+$/, "");
}

// MirrorRequest.content.about is maxLength 4000 (mirror-request.schema.json).
// An over-cap about used to 400 the WHOLE packet at the engine's validator —
// the production refusal on batch line_mtmat6q5_1250c77fbf (a roofing
// candidate: "invalid_request (status 400) — /content/about: must NOT have
// more than 4000 characters") refused an entire business for the sin of a
// rich homepage. Owner doctrine (thin-in rich-out): rich source copy is an
// ASSET — the cap PORTIONS it, it never refuses the business.
const ABOUT_MAX_LENGTH = 4000;

/**
 * sentenceBoundedCut(value, maxLength) — the truth-preserving portioner.
 *
 * The text is the business's own prose; compressing it never rewords it. Cut
 * at the last sentence end that fits under the cap so every surviving
 * sentence is whole. When no sentence boundary lands in the useful range
 * (one unending run of prose), keep whole words on the same 0.6 floor
 * wordBoundedCut uses. Never fabricates, never refuses.
 */
function sentenceBoundedCut(value, maxLength) {
  const text = String(value == null ? "" : value);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  // A sentence end (".", "!" or "?", with any closing quotes) followed by
  // whitespace or the end of the window.
  const endings = [...cut.matchAll(/[.!?]["')\]]*(?=\s|$)/g)];
  const last = endings.length ? endings[endings.length - 1] : null;
  if (last && last.index + last[0].length >= Math.floor(maxLength * 0.6)) {
    return cut.slice(0, last.index + last[0].length);
  }
  const boundary = cut.lastIndexOf(" ");
  return (boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut).replace(/\s+$/, "");
}

const MAX_PROJECTED_PAGES = 12;
const HOME_ABOUT_FAQ = new Set(["home", "about", "faq", "faqs"]);

function visitorCopyProjection(packet = {}) {
  const verified = certifiedPracticeVisitorCopy(packet);
  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason,
      about: "",
      faqs: [],
      serviceCopy: {},
      pageCopy: {},
      keywords: [],
      seo: { title: "", description: "" },
    };
  }
  const files = verified.files;
  const firstFile = (...candidates) => candidates.map((name) => files[name]).find((value) => typeof value === "string") || "";
  // These are observations, not generated copy. Admit a channel only when its
  // receipt-hashed file exactly describes the source-bound discovery rows.
  const discovered = object(packet.discovery);
  const depth = object(object(discovered.found).depth_channels);
  const observedPages = new Set(Array.isArray(discovered.sources) ? discovered.sources : []);
  const depthRows = (channel, filePath, render) => {
    const entries = depth[channel];
    if (!Array.isArray(entries) || !entries.length || entries.length > 12) return [];
    const rows = [];
    for (const entry of entries) {
      const source = String(entry?.source_url || "");
      const excerpt = String(entry?.evidence || "");
      const values = channel === "reviews" ? [entry?.quote, entry?.author] : [entry?.value];
      if (!/^https?:\/\//i.test(source) || !observedPages.has(source) || !excerpt.trim()
        || values.some((value) => typeof value !== "string" || !value.trim()
          || value.length > 500 || !excerpt.includes(value))) return [];
      rows.push(entry);
    }
    if (files[filePath] !== render(rows)) return [];
    return rows;
  };
  const reviewRows = depthRows("reviews", "content/reviews.md", (rows) => [
    "# Reviews", "", ...rows.flatMap(({ quote, author }) => [`> ${quote}`, `— ${author}`, ""]),
  ].join("\n"));
  const hourRows = depthRows("hours", "content/hours.md", (rows) => [
    "# Hours", "", ...rows.map(({ value }) => `- ${value}`), "",
  ].join("\n"));
  const areaRows = depthRows("areas", "content/service-areas.md", (rows) => [
    "# Service Areas", "", ...rows.map(({ value }) => `- ${value}`), "",
  ].join("\n"));
  const home = proseFrom(firstFile("content/home.md", "home.md"));
  const aboutPage = proseFrom(firstFile("content/about.md", "about.md"));
  const about = (home.length ? home : aboutPage).slice(0, 4).join("\n\n");
  const faqMarkdown = firstFile("content/faq.md", "content/faqs.md", "faq.md", "faqs.md");
  const faqs = faqPairsFromMarkdown(faqMarkdown);
  const serviceCopy = {};
  const extraPages = [];
  for (const [filePath, markdown] of Object.entries(files)) {
    if (builderDirectiveMarkdown(filePath)) continue;
    const serviceMatch = filePath.match(/^(?:content\/)?services\/([^/]+)\.md$/i);
    if (serviceMatch) {
      const prose = proseFrom(markdown);
      if (prose.length) serviceCopy[serviceMatch[1].toLowerCase()] = prose[0];
      continue;
    }
    const pageMatch = filePath.match(/^content\/([a-z0-9][a-z0-9._/-]*)\.md$/i);
    if (!pageMatch) continue;
    const slug = pageMatch[1].toLowerCase();
    if (HOME_ABOUT_FAQ.has(slug)) continue;
    extraPages.push({ slug, filePath });
  }
  // Top-level content pages first, then nested ones (e.g. content/blog/*), so
  // the page cap keeps Process/Contact/Service-Areas ahead of guide posts.
  const pageCopy = {};
  const topLevel = extraPages.filter((page) => !page.slug.includes("/"));
  const nested = extraPages.filter((page) => page.slug.includes("/"));
  for (const page of [...topLevel, ...nested].slice(0, MAX_PROJECTED_PAGES)) {
    const prose = proseFrom(files[page.filePath] || "");
    if (prose.length) pageCopy[page.slug] = prose.join("\n\n");
  }
  const search = canonicalSearchIntent(packet, files);
  return {
    ok: Boolean(about || faqs.length || reviewRows.length || hourRows.length || areaRows.length || Object.keys(serviceCopy).length
      || Object.keys(pageCopy).length || search.keywords.length),
    reason: "",
    category: verified.category,
    category_family: verified.category_family,
    about,
    faqs,
    reviews: reviewRows.map(({ quote, author }) => ({ text: quote, author })),
    hours: hourRows.map(({ value }) => value),
    areas: areaRows.map(({ value }) => value),
    serviceCopy,
    pageCopy,
    keywords: search.keywords,
    seo: search.seo,
  };
}

/**
 * Adapt the already receipt-verified canonical packet without a filesystem
 * dependency. This function does not verify signatures; its caller must do so
 * first. Only the safety-passed, file-hashed CertifiedPracticePacket visitor_copy
 * may supply prose; search intent comes from the packet's own structured search
 * fields (see canonicalSearchIntent). Legacy content_files and builder
 * instructions remain excluded.
 */
function intakePacketFromCanonical(packet = {}, { website = "", packetSha256 = "", services = [] } = {}) {
  const root = object(packet);
  const plan = canonicalPlan(root);
  const visitorCopy = visitorCopyProjection(root);
  const brand = canonicalBrandAndMedia(root, website);
  const allowedServiceSlugs = new Set(services.map((service) => clean(
    typeof service === "string" ? service : service?.name,
  ).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean));
  const serviceCopy = Object.fromEntries(Object.entries(visitorCopy.serviceCopy || {})
    .filter(([slug]) => allowedServiceSlugs.has(slug)));
  const ok = Boolean(visitorCopy.ok || Object.keys(brand).length);
  return {
    ok,
    reason: ok ? "" : (visitorCopy.reason || "canonical_packet_had_nothing_renderable"),
    source: packetSha256 ? `intake-genie:${packetSha256}` : "intake-genie:receipt-verified",
    category: visitorCopy.category_family || visitorCopy.category,
    about: visitorCopy.about,
    faqs: visitorCopy.faqs,
    reviews: visitorCopy.reviews || [],
    hours: visitorCopy.hours || [],
    areas: visitorCopy.areas || [],
    serviceCopy,
    // Certified extra content pages (Process, Contact, Service Areas, guides).
    // Carried on the canonical packet for provenance and future consumers; NOT
    // forced into MirrorRequest — MirrorContent has no extra-page slot and the
    // engine renders pages from the donor template, so mergeIntoContent leaves
    // this map where it is rather than 400 the build at the schema.
    pageCopy: visitorCopy.pageCopy || {},
    keywords: visitorCopy.keywords,
    seo: visitorCopy.seo,
    brand,
    plan: {
      page_count: plan.pages.length,
      route_count: plan.routes.length,
      requirements_present: Object.keys(plan.requirements).length > 0,
    },
  };
}

/**
 * Prose paragraphs from a Compiler markdown page.
 *
 * Headings, bullet lists and the "**Primary action:**" directives are the
 * Compiler talking to a builder, not sentences a customer should read. Only
 * real paragraphs survive.
 */
function proseFrom(markdown) {
  const body = stripFrontMatter(markdown);
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block
      && !block.startsWith("#")
      && !/^[-*>|]/.test(block)
      && !/^\*\*[A-Z][^*]*:\*\*/.test(block)
      && block.split(/\s+/).length >= 8)
    .map((block) => clean(block.replace(/\*\*/g, "")))
    .filter(Boolean);
}

/**
 * Keywords the SERP work actually produced. Empty is the common case on older
 * packets and must read as "no research", never as a reason to invent terms.
 */
function keywordsFrom(seo, serp, voice) {
  const out = [];
  for (const k of (seo && Array.isArray(seo.keywords) ? seo.keywords : [])) {
    const t = clean(k);
    if (t) out.push(t);
  }
  // BrightData audits vary in shape across packet generations; take the obvious
  // keyword-bearing fields and ignore anything we do not recognise.
  const serpLists = [serp && serp.keywords, serp && serp.queries, serp && serp.target_keywords, serp && serp.primary_keywords];
  for (const list of serpLists) {
    for (const entry of (Array.isArray(list) ? list : [])) {
      const t = clean(typeof entry === "string" ? entry : (entry && (entry.keyword || entry.query || entry.term)));
      if (t) out.push(t);
    }
  }
  const primary = clean(voice && voice.primaryService);
  const city = clean(voice && voice.city);
  if (primary && city) out.push(`${primary} ${city}`);
  return [...new Set(out.map((k) => k.toLowerCase()))].slice(0, 24);
}

/**
 * readIntakePacket(dir) -> { ok, source, about, faqs, serviceCopy, seo, keywords, reason }
 *
 * Every field is PROSE or SEARCH INTENT. Nothing here is a fact about the
 * business that any gate would have to verify.
 */
function readIntakePacket(dir) {
  const root = String(dir || "").trim();
  if (!root || !fs.existsSync(root)) return { ok: false, reason: "packet_not_found" };

  const seo = readJson(root, "seo.json") || {};
  const serp = readJson(root, "brightdata-serp-audit.json") || readJson(root, "search-optimization-plan.json") || {};
  const voice = readJson(root, "voice-search.json") || {};
  const faqsRaw = readJson(root, "faqs.json");

  // Page copy. home.md is the narrative; the service pages carry the detail.
  const homeProse = proseFrom(readText(root, "content", "home.md"));
  const about = homeProse.slice(0, 4).join("\n\n");

  const serviceCopy = {};
  const svcDir = path.join(root, "content", "services");
  try {
    for (const file of fs.readdirSync(svcDir)) {
      if (!/\.md$/i.test(file)) continue;
      const prose = proseFrom(readText(svcDir, file));
      if (prose.length) serviceCopy[file.replace(/\.md$/i, "")] = prose[0];
    }
  } catch { /* a packet without service pages simply contributes none */ }

  const faqs = (Array.isArray(faqsRaw) ? faqsRaw : [])
    .map((f) => ({ q: clean(f && (f.q || f.question)), a: clean(f && (f.a || f.answer)) }))
    .filter((f) => f.q && f.a)
    .slice(0, 20);

  const keywords = keywordsFrom(seo, serp, voice);

  // The Compiler's own title/description are COPY, and are only usable when
  // they are about this business rather than a builder instruction.
  const seoOut = {
    title: clean(seo.siteTitle),
    description: clean(seo.siteDescription),
  };

  const ok = Boolean(about || faqs.length || keywords.length || Object.keys(serviceCopy).length || seoOut.description);
  return {
    ok,
    reason: ok ? "" : "packet_had_nothing_usable",
    source: root,
    about,
    faqs,
    serviceCopy,
    seo: seoOut,
    keywords,
  };
}

/**
 * mergeIntoContent(content, packet) — prose fills GAPS, never overwrites.
 *
 * Verified content always wins: a service name from Google Places outranks the
 * Compiler's version of the same string. The packet's job is to supply what the
 * 19 flat facts never contained — the paragraphs, the answers, the search
 * language — not to restate what is already proven.
 */
function mergeIntoContent(content = {}, packet = {}, { notes = [] } = {}) {
  if (!packet || packet.ok !== true) return content;
  const out = { ...content };

  if (!clean(out.about) && packet.about) {
    const about = String(packet.about);
    if (about.length <= ABOUT_MAX_LENGTH) {
      out.about = about;
    } else {
      // OVER-CAP COMPRESSES, NEVER REFUSES. The business's own words,
      // portioned at the last sentence boundary that fits — never reworded,
      // never dropped on the floor as a 400. The note travels to the build
      // result so the funnel can see the portioning happened
      // (about_compressed_to_cap, with the original length).
      out.about = sentenceBoundedCut(about, ABOUT_MAX_LENGTH);
      if (Array.isArray(notes)) {
        notes.push({
          note: "about_compressed_to_cap",
          original_length: about.length,
          kept_length: out.about.length,
          cap: ABOUT_MAX_LENGTH,
        });
      }
    }
  }
  if (!(out.faqs || []).length && (packet.faqs || []).length) out.faqs = packet.faqs;
  if (!(out.reviews || []).length && (packet.reviews || []).length) out.reviews = packet.reviews.slice(0, 10);
  if (!(out.hours || []).length && (packet.hours || []).length) out.hours = packet.hours.slice(0, 14);
  if (!(out.areas || []).length && (packet.areas || []).length) out.areas = packet.areas.slice(0, 18);

  // Service DESCRIPTIONS only. The names stay exactly as verified.
  if (Array.isArray(out.services) && packet.serviceCopy) {
    out.services = out.services.map((s) => {
      if (!s || typeof s !== "object" || clean(s.description)) return s;
      const key = clean(s.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const copy = packet.serviceCopy[key];
      return copy ? { ...s, description: copy } : s;
    });
  }

  if ((packet.keywords || []).length) out.keywords = packet.keywords;
  if (packet.seo && packet.seo.description && !clean(out.seo_description)) {
    out.seo_description = packet.seo.description;
  }
  return out;
}

module.exports = {
  ABOUT_MAX_LENGTH,
  intakePacketFromCanonical,
  visitorCopyProjection,
  keywordsFrom,
  mergeIntoContent,
  proseFrom,
  readIntakePacket,
  sentenceBoundedCut,
  stripFrontMatter,
};
