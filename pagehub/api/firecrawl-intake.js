const dns = require("node:dns").promises;
const net = require("node:net");
const { requireProviderRouteAuth } = require("./lib/provider-route-auth");

const FIRECRAWL_ENDPOINTS = [
  "https://api.firecrawl.dev/v2/scrape",
  "https://api.firecrawl.dev/v1/scrape"
];
const FIRECRAWL_MAP_ENDPOINT = "https://api.firecrawl.dev/v2/map";
const intakeQuality = createIntakeQualityPolicy();
const MAX_INPUT_URLS = 5;
const MAX_PUBLIC_REDIRECTS = 3;
const MAX_SITEMAP_BYTES = 1024 * 1024;
const DNS_LOOKUP_TIMEOUT_MS = 2000;
// Full-site verbatim coverage: the owner's rule is "if they have 13 pages, we
// have 13 pages." The old 10-URL cap with a 4-page keyword filter scratched the
// surface. Env-overridable so a credit-tight day can dial it back without a
// code change.
const MAX_EXPANDED_URLS = Math.max(1, Math.min(200, Math.floor(Number(process.env.INTAKE_MAX_SCRAPE_URLS) || 40)));
const MAX_HARVEST_BYTES = 48 * 1024 * 1024;
const MAX_DISCOVERY_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_RESPONSE_BYTES = Math.floor((MAX_HARVEST_BYTES - MAX_DISCOVERY_BYTES) / MAX_EXPANDED_URLS);
const SCRAPE_CONCURRENCY = Math.max(6, Math.min(12, Math.floor(Number(process.env.INTAKE_SCRAPE_CONCURRENCY) || 6)));
const MAX_COVERAGE_TRUNCATED_URLS = 100;
const MAX_OBSERVATION_MARKDOWN_CHARS = 1024 * 1024;
const MAX_OBSERVATION_METADATA_CHARS = 2000;
const MAX_OBSERVATION_MEDIA_ITEMS = 24;
const MAX_OBSERVATION_MEDIA_TEXT_CHARS = 500;
const EXACT_PROFILE_EVIDENCE_HOSTS = Object.freeze([
  "facebook.com", "instagram.com", "linkedin.com", "yelp.com", "x.com", "twitter.com",
  "google.com", "maps.app.goo.gl", "share.google", "youtu.be",
]);
const PATH_SCOPED_EVIDENCE_HOSTS = Object.freeze([
  "wixsite.com", "square.site", "notion.site", "linktr.ee", "bio.site", "canva.site",
  "youtube.com", "tiktok.com",
]);
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/client-snapshot-craft\.lovable\.app$/i,
  /^https:\/\/pagehub-intake\.wss-ai\.com$/i,
  /^https:\/\/[\w-]+\.lovable\.app$/i,
  /^https:\/\/[\w-]+\.lovableproject\.com$/i,
  /^https:\/\/pagehub-intake-lock-form\.vercel\.app$/i,
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i
];

module.exports.config = {
  maxDuration: 60
};

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Use POST." });
  }

  if (!requireProviderRouteAuth(req, res)) return;

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    return res.status(200).json(await harvestSources({
      urls: body.urls || [],
      apiKey: process.env.FIRECRAWL_API_KEY
    }));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Unexpected Firecrawl prefill error.",
      ...(error.code ? { code: error.code } : {}),
      ...(error.retryable === true ? { retryable: true } : {}),
      ...(error.coverage ? { coverage: error.coverage } : {}),
    });
  }
};

async function harvestSources({ urls = [], apiKey = process.env.FIRECRAWL_API_KEY, evidence = [] } = {}) {
  if (!apiKey) {
    const error = new Error("Server Firecrawl key is not configured. Add FIRECRAWL_API_KEY in WSS for this project.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedUrls = (await normalizeUrls(urls)).slice(0, MAX_INPUT_URLS);
  if (!normalizedUrls.length) {
    const error = new Error("No valid public URLs were provided.");
    error.statusCode = 400;
    throw error;
  }

  const expansion = await expandSourceUrls(normalizedUrls, apiKey);
  let scrapeUrls = expansion.urls;
  const verifiedEvidence = verifiedEvidenceForSources(evidence, normalizedUrls);
  let scrapeResults = await scrapeWithConcurrency(scrapeUrls, apiKey, SCRAPE_CONCURRENCY);
  // One hop from every scraped page includes blog/hub article links without
  // keyword filtering. Only same-domain content URLs survive normalization.
  const hopUrls = [...new Set(scrapeResults.filter(r => r.success).flatMap(result => {
    const base = normalizedUrls.find(url => isPublicWebsiteCandidate(url) && samePublicSite(new URL(url).hostname, new URL(result.url).hostname));
    return base ? pageLinks(result, base) : [];
  }))].filter(url => !scrapeUrls.includes(url)).sort();
  const room = Math.max(0, MAX_EXPANDED_URLS - scrapeUrls.length);
  const addedUrls = hopUrls.slice(0, room);
  const omitted = [...new Set([...expansion.truncatedUrls, ...hopUrls.slice(room)])].filter(url => !addedUrls.includes(url)).sort();
  const unseenOmissions = Math.max(0, expansion.truncatedCount - expansion.truncatedUrls.length);
  expansion.truncatedUrls = omitted.slice(0, MAX_COVERAGE_TRUNCATED_URLS);
  expansion.truncatedCount = unseenOmissions + omitted.length;
  if (addedUrls.length) scrapeResults.push(...await scrapeWithConcurrency(addedUrls, apiKey, SCRAPE_CONCURRENCY));
  scrapeUrls = [...scrapeUrls, ...addedUrls].sort();
  scrapeResults.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  const successfulResults = scrapeResults.filter(result => result?.success === true);
  const failedResults = scrapeResults.filter(result => result?.success !== true);
  const coverage = sourceHarvestCoverage(scrapeUrls, successfulResults, failedResults, expansion);
  coverage.byte_budget = { limit: MAX_HARVEST_BYTES, discovery: expansion.discoveryBytes || 0,
    scrape: scrapeResults.reduce((sum, row) => sum + (row.response_bytes || 0), 0) };
  coverage.byte_budget.used = coverage.byte_budget.discovery + coverage.byte_budget.scrape;

  if (!successfulResults.length) throw sourceHarvestFailure(coverage);

  const successfulUrls = successfulResults.map(result => result.url);
  const extracted = mergeResults(successfulResults, successfulUrls);
  const notes = failedResults
    .map(result => `${result.url}: ${result.note || "Could not scrape this source."}`);
  const observations = successfulResults.map(result => ({
    source: result.url,
    status: "succeeded",
    extracted: cleanupExtracted(result.extracted || {}),
    note: "",
    private_source: boundedPrivatePageSource(result),
  }));

  return {
    ok: true,
    sources: successfulUrls,
    extracted,
    notes,
    observations,
    evidence: verifiedEvidence,
    coverage,
  };
}

// Owner-only Packet2 import: no map, sitemap, links, hop, or broad site crawl.
const MAX_EXACT_IMPORT_URLS = 8;
async function harvestExactSourceUrls({ urls = [], apiKey = process.env.FIRECRAWL_API_KEY } = {}) {
  if (!apiKey) throw new Error("Server Firecrawl key is not configured.");
  if (!Array.isArray(urls) || !urls.length || urls.length > MAX_EXACT_IMPORT_URLS
      || urls.some(url => typeof url !== "string" || !/^https:\/\//i.test(url))
      || new Set(urls).size !== urls.length)
    throw new Error("Exact import source URL budget or format invalid.");
  // Reuse the intake DNS/public-IP and redirect guards for every requested URL.
  const checked = await Promise.all(urls.map(async url => (await normalizeUrls([url]))[0]));
  if (checked.some((url, i) => !url || url !== urls[i]))
    throw new Error("Exact import URL failed public first-party normalization.");
  const results = await scrapeWithConcurrency(urls, apiKey, 3, { fresh: true });
  const good = results.filter(result => result?.success === true);
  const bad = results.filter(result => result?.success !== true);
  const coverage = sourceHarvestCoverage(urls, good, bad);
  coverage.byte_budget = { limit: MAX_EXACT_IMPORT_URLS * MAX_PAGE_RESPONSE_BYTES,
    discovery: 0, scrape: results.reduce((sum, row) => sum + (row?.response_bytes || 0), 0) };
  coverage.byte_budget.used = coverage.byte_budget.scrape;
  if (bad.length || good.length !== urls.length
      || good.some((row, index) => row.url !== urls[index]))
    throw sourceHarvestFailure(coverage);
  return { ok: true, sources: good.map(row => row.url),
    extracted: mergeResults(good, urls), observations: good.map(row => ({
      source: row.url, status: "succeeded", extracted: cleanupExtracted(row.extracted || {}),
      note: "", private_source: boundedPrivatePageSource(row),
    })), evidence: [], notes: [], coverage };
}

function sourceHarvestCoverage(attemptedUrls, successfulResults, failedResults, expansion = {}) {
  const truncatedCount = Math.max(0, Number(expansion.truncatedCount) || 0);
  const truncated = (Array.isArray(expansion.truncatedUrls) ? expansion.truncatedUrls : [])
    .slice(0, MAX_COVERAGE_TRUNCATED_URLS);
  return {
    schema: "SourceHarvestCoverage/v1",
    attempted: attemptedUrls.slice(),
    succeeded: successfulResults.map(result => result.url),
    failed: failedResults.map(result => ({
      source: result.url,
      code: "provider_scrape_failed",
      error: boundedText(result.note || "Could not scrape this source.", MAX_OBSERVATION_MEDIA_TEXT_CHARS),
    })),
    truncated,
    counts: {
      attempted: attemptedUrls.length,
      succeeded: successfulResults.length,
      failed: failedResults.length,
      truncated: truncatedCount,
      truncated_omitted: Math.max(0, truncatedCount - truncated.length),
    },
  };
}

function sourceHarvestFailure(coverage) {
  const error = new Error("Firecrawl failed to harvest every attempted public source page.");
  error.name = "SourceHarvestError";
  error.code = "source_harvest_failed";
  error.retryable = true;
  error.statusCode = 503;
  error.coverage = coverage;
  return error;
}

function verifiedEvidenceForSources(evidence = [], sourceUrls = []) {
  if (!Array.isArray(evidence) || !Array.isArray(sourceUrls) || !sourceUrls.length) return [];
  return evidence.slice(0, 100).filter(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || !evidenceIsVerified(row)) return false;
    const url = evidenceSourceUrl(row);
    return Boolean(url) && sourceUrls.some(source => evidenceUrlMatchesSource(url, source));
  });
}

function evidenceIsVerified(row = {}) {
  const verificationStatus = String(row.verification_status || "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return row.verified === true
    || ["verified", "source verified", "owner verified"].includes(verificationStatus);
}

function evidenceSourceUrl(row = {}) {
  const nested = row.source && typeof row.source === "object" && !Array.isArray(row.source) ? row.source : {};
  const raw = [row.source_url, nested.url, typeof row.source === "string" ? row.source : "", row.url]
    .map(value => String(value || "").trim())
    .find(Boolean);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return isSafePublicUrlSyntax(parsed) ? parsed.href : "";
  } catch {
    return "";
  }
}

function evidenceUrlMatchesSource(evidenceUrl, sourceUrl) {
  let evidence;
  let source;
  try {
    evidence = new URL(evidenceUrl);
    source = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (!samePublicSite(evidence.hostname, source.hostname)) return false;
  const host = normalizeHostname(source.hostname).replace(/^www\./, "");
  if (EXACT_PROFILE_EVIDENCE_HOSTS.some(shared => host === shared || host.endsWith(`.${shared}`))) {
    return normalizedEvidenceUrl(evidence) === normalizedEvidenceUrl(source);
  }
  if (PATH_SCOPED_EVIDENCE_HOSTS.some(shared => host === shared || host.endsWith(`.${shared}`))) {
    const evidenceTenant = firstPathSegment(evidence.pathname);
    const sourceTenant = firstPathSegment(source.pathname);
    return Boolean(evidenceTenant && sourceTenant && evidenceTenant === sourceTenant);
  }
  return isPublicWebsiteCandidate(source.href);
}

function normalizedEvidenceUrl(value) {
  const parsed = value instanceof URL ? new URL(value.href) : new URL(value);
  parsed.hash = "";
  parsed.hostname = normalizeHostname(parsed.hostname);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.searchParams.sort();
  return parsed.href;
}

function firstPathSegment(pathname = "") {
  return String(pathname || "").split("/").map(part => part.trim().toLowerCase()).filter(Boolean)[0] || "";
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigin = ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin))
    ? origin
    : "https://client-snapshot-craft.lovable.app";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
}

async function normalizeUrls(urls) {
  const candidates = [...new Set((Array.isArray(urls) ? urls : [urls]).map(raw => String(raw || "").trim()).filter(Boolean))]
    .map(raw => {
      if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
      return raw;
    })
    .slice(0, MAX_INPUT_URLS);
  const checked = await Promise.all(candidates.map(async raw => {
    try {
      const parsed = new URL(raw);
      return await isSafePublicHttpUrl(parsed) ? parsed.href : "";
    } catch {
      return "";
    }
  }));
  return checked.filter(Boolean);
}

function contentPageUrl(raw, baseUrl) {
  try {
    const base = new URL(baseUrl);
    const url = new URL(decodeHtmlEntities(String(raw || '').trim()), base);
    if (!isSafePublicUrlSyntax(url) || !samePublicSite(url.hostname, base.hostname) || url.port !== base.port) return '';
    if (/\.(?:jpe?g|png|gif|webp|avif|svg|pdf|zip|gz|rar|7z|mp4|webm|mov|mp3|wav|css|m?js|map|ico|xml|json|woff2?|ttf|eot|rss|atom)$/i.test(url.pathname)) return '';
    // www and apex are the SAME submitted site; do not discard its own nav.
    url.protocol = base.protocol;
    url.host = base.host;
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
}

function decodeHtmlEntities(text) {
  return String(text).replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, token => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[token.toLowerCase()]) return named[token.toLowerCase()];
    const n = /^&#x/i.test(token) ? parseInt(token.slice(3), 16) : parseInt(token.slice(2), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}

function pageLinks(page = {}, baseUrl) {
  const links = normalizeLinkList(page.links || []);
  const html = String(page.html || page.rawHtml || '').replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) links.push(m[1] || m[2] || m[3] || '');
  for (const m of String(page.markdown || '').matchAll(/(?<!!)\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) links.push(m[1]);
  return [...new Set(links.map(link => contentPageUrl(link, baseUrl)).filter(Boolean))].sort();
}

async function expandSourceUrls(urls, apiKey) {
  const budget = { used: 0, limit: MAX_DISCOVERY_BYTES };
  const websiteUrls = urls.filter(isPublicWebsiteCandidate);
  const discoveries = await Promise.all(websiteUrls.map(async url => {
    const base = new URL(url);
    const homepage = base.origin + '/';
    const [sitemap, mapped, navigation] = await Promise.all([
      sitemapPages(url, budget), mapLikelyPages(url, apiKey, budget),
      (async () => {
        try {
          const response = await fetchPublicWithTimeout(homepage, {}, 15000, base.hostname);
          if (!response.ok) { await response.body?.cancel().catch(() => {}); return []; }
          const html = await readResponseTextLimited(response, MAX_SITEMAP_BYTES, 15000, budget);
          return pageLinks({ html }, url);
        } catch { return []; }
      })(),
    ]);
    return [homepage, ...sitemap, ...mapped, ...navigation];
  }));
  const seeds = [...new Set(urls.map(url => isPublicWebsiteCandidate(url) ? contentPageUrl(url, url) : url).filter(Boolean))].sort();
  const expanded = [...new Set([...seeds, ...discoveries.flat()])].sort();
  // Keep explicit source inputs, then choose lexically; assembly is always sorted.
  const selected = [...new Set([...seeds, ...expanded])].slice(0, MAX_EXPANDED_URLS).sort();
  const truncatedUrls = expanded.filter(url => !selected.includes(url));
  return { urls: selected, truncatedUrls: truncatedUrls.slice(0, MAX_COVERAGE_TRUNCATED_URLS), truncatedCount: truncatedUrls.length, discoveryBytes: budget.used };
}

async function sitemapPages(url, budget) {
  const base = new URL(url);
  const candidates = [];
  const seen = new Set();
  const queue = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'].map(p => new URL(p, base).href);
  // The index may contain several post/page sitemaps. Fetch indexes, never
  // scrape them as pages, and never follow an external/private redirect.
  while (queue.length && seen.size < 16) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    try {
      const response = await fetchPublicWithTimeout(next, {}, 8000, base.hostname);
      if (!response.ok) { await response.body?.cancel().catch(() => {}); continue; }
      const xml = await readResponseTextLimited(response, MAX_SITEMAP_BYTES, 8000, budget);
      if (/<(?:[\w-]+:)?sitemapindex\b/i.test(xml.slice(0, 2000))) {
        queue.push(...locUrls(xml).filter(l => { try { const u = new URL(l); return isSafePublicUrlSyntax(u) && samePublicSite(u.hostname, base.hostname) && u.port === base.port; } catch { return false; } }).sort());
      } else if (/<(?:[\w-]+:)?urlset\b/i.test(xml.slice(0, 2000))) candidates.push(...locUrls(xml));
    } catch { /* nav + provider map remain independent fallbacks */ }
  }
  return [...new Set(candidates.map(l => contentPageUrl(l, url)).filter(Boolean))].sort();
}

function locUrls(xml) {
  return [...String(xml).matchAll(/<(?:[\w-]+:)?loc>\s*(?:<!\[CDATA\[)?([^<]+?)(?:\]\]>)?\s*<\/(?:[\w-]+:)?loc>/gi)].map(m => decodeHtmlEntities(m[1]));
}

async function mapLikelyPages(url, apiKey, budget) {
  try {
    const response = await fetchWithTimeout(FIRECRAWL_MAP_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ url, limit: Math.max(60, MAX_EXPANDED_URLS), includeSubdomains: false }),
    }, 15000);
    const data = JSON.parse(await readResponseTextLimited(response, MAX_SITEMAP_BYTES, 15000, budget));
    if (!response.ok || data.success === false) return [];
    const links = data.links || data.data?.links || data.data || [];
    return [...new Set((Array.isArray(links) ? links : []).map(item => contentPageUrl(typeof item === 'string' ? item : item.url || item.href || '', url)).filter(Boolean))].sort();
  } catch { return []; }
}

async function scrapeWithConcurrency(urls, apiKey, concurrency, options = {}) {
  // Bounded pool: one hung scrape must not dominate the whole harvest, and the
  // vendor is never hit with an unbounded fan-out. Results keep source order.
  const results = new Array(urls.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= urls.length) return;
      results[index] = await scrapeOne(urls[index], apiKey, options);
    }
  }
  const workers = Math.max(1, Math.min(Number(concurrency) || 6, urls.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

async function scrapeOne(url, apiKey, options = {}) {
  const budget = { used: 0, limit: MAX_PAGE_RESPONSE_BYTES };
  const prompt = [
    "Extract public business intake details for a website build.",
    "Use only information visible in the scraped source. Do not guess.",
    "Return concise values that can prefill a form.",
    "If a value is not present, leave it empty.",
    "Preserve exact service names, requested product/service line items, credentials, exclusions, and custom client wording instead of summarizing them into broad categories.",
    "Return exactServices as newline-separated service labels when specific services are visible.",
    "Return protectedArtifacts as newline-separated custom facts that must survive the build packet unchanged.",
    "Prioritize the business logo from the upper-left header or navigation area when visible.",
    "Prioritize hours from Google Business Profile when a Google source is provided; otherwise use website hours.",
    "For Google listings, include the Place ID, CID, or profile identifier only when it is visible or present in the URL/source.",
    "For yes/no fields, answer Yes or No only when supported by the page."
  ].join(" ");

  const schema = {
    type: "object",
    properties: {
      brandName: { type: "string" },
      finalPhone: { type: "string" },
      smsNumber: { type: "string" },
      email: { type: "string" },
      hours: { type: "string" },
      hoursSource: { type: "string", enum: ["Google Business Profile", "Client website", "Client provided", "Not found yet", ""] },
      gbpPlaceId: { type: "string" },
      listingConfidence: { type: "string", enum: ["Exact business match", "Likely match - needs human review", "Website only - listing not confirmed", "Missing or conflicting", ""] },
      address: { type: "string" },
      serviceArea: { type: "string" },
      citiesServed: { type: "string" },
      publicAddressRule: { type: "string", enum: ["Shown", "Hidden", "Service-area only", ""] },
      gbpLink: { type: "string" },
      mapMode: { type: "string", enum: ["Office", "Service area", "Radius", "No map", ""] },
      directionsNeeded: { type: "string", enum: ["Yes", "No", ""] },
      mainServices: { type: "string" },
      exactServices: { type: "string" },
      protectedArtifacts: { type: "string" },
      mustInclude: { type: "string" },
      licensedWording: { type: "string" },
      mainCta: { type: "string" },
      reviewsBadgesNeeded: { type: "string", enum: ["Yes", "No", ""] },
      sourceTruth: { type: "string" },
      logoReceived: { type: "string", enum: ["Yes", "No", ""] },
      logoLink: { type: "string" },
      faviconRequired: { type: "string", enum: ["Yes", "No", ""] },
      brandColors: { type: "string" },
      clientPhotosReceived: { type: "string", enum: ["Yes", "No", ""] },
      galleryLink: { type: "string" },
      stockAllowed: { type: "string", enum: ["Yes", "No", ""] },
      aiAllowed: { type: "string", enum: ["Yes", "No", ""] },
      radiusNotes: { type: "string" },
      metaPixel: { type: "string" },
      socialLinks: { type: "array", items: { type: "string" } },
      logoCandidates: { type: "array", items: { type: "string" } },
      brandPalette: {
        type: "array",
        items: {
          type: "object",
          properties: {
            hex: { type: "string" },
            role: { type: "string" },
            source: { type: "string" }
          }
        }
      },
      imageCandidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            alt: { type: "string" },
            role: { type: "string" }
          }
        }
      },
      businessSummary: { type: "string" }
    }
  };

  const richPayload = {
    url,
    formats: [
      "markdown",
      "links",
      "images",
      "branding",
      "rawHtml",
      {
        type: "json",
        prompt,
        schema
      }
    ],
    onlyMainContent: false,
    waitFor: 500,
    timeout: 45000,
    ...(options.fresh ? { maxAge: 0, storeInCache: false } : {}),
  };
  const basicPayload = {
    ...richPayload,
    formats: ["markdown", "links", { type: "json", prompt, schema }]
  };

  let lastError = "";
  for (const endpoint of (options.fresh ? [FIRECRAWL_ENDPOINTS[0]] : FIRECRAWL_ENDPOINTS)) {
    for (const payload of [richPayload, basicPayload]) try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      }, 45000);
      const data = JSON.parse(await readResponseTextLimited(response, MAX_PAGE_RESPONSE_BYTES, 45000, budget));
      if (!response.ok || data.success === false) {
        lastError = data.error || data.message || `HTTP ${response.status}`;
        continue;
      }

      const page = data.data || data;
      const extracted = page.json || page.extract || page.llm_extraction || {};
      const markdown = page.markdown || page.content || "";
      const html = page.rawHtml || page.html || "";
      const metadata = page.metadata || {};
      const links = page.links || [];
      const images = page.images || [];
      const branding = page.branding || {};
      const providerSource = providerPageUrlForRequest(url, page);
      if (!providerSource.ok) {
        return {
          url,
          success: false,
          note: providerSource.error,
          response_bytes: budget.used,
        };
      }
      const fallback = fallbackExtract(providerSource.url, markdown, metadata, html, links, images, branding);
      const reviewed = reviewHarvestExtraction(providerSource.url, fallback, extracted, markdown);

      return {
        url: isPublicWebsiteCandidate(url) ? contentPageUrl(providerSource.url, url) : providerSource.url,
        requestedUrl: url,
        response_bytes: budget.used,
        html,
        links,
        success: true,
        extracted: reviewed.extracted,
        private_quality_review: reviewed.privateReview,
        markdown,
        metadata,
        images,
        branding,
      };
    } catch (error) {
      lastError = error.message;
    }
  }

  return {
    url,
    success: false,
    response_bytes: budget.used,
    note: lastError || "Could not scrape this source."
  };
}

function providerPageUrlForRequest(requestedUrl, page = {}) {
  const metadata = page?.metadata && typeof page.metadata === "object" && !Array.isArray(page.metadata)
    ? page.metadata
    : {};
  const reported = [...new Set([
    page.finalURL,
    page.finalUrl,
    page.sourceURL,
    page.sourceUrl,
    page.url,
    metadata.finalURL,
    metadata.finalUrl,
    metadata.sourceURL,
    metadata.sourceUrl,
    metadata.url,
  ].map(value => String(value || "").trim()).filter(Boolean))];

  if (!reported.length) return { ok: true, url: requestedUrl };
  const normalized = [];
  for (const raw of reported) {
    let candidate;
    try {
      candidate = new URL(raw, requestedUrl);
    } catch {
      return { ok: false, error: "Provider returned an invalid final source URL." };
    }
    if (!isSafePublicUrlSyntax(candidate) || !evidenceUrlMatchesSource(candidate.href, requestedUrl)) {
      // (2026-09-23) NAME THE FACT: the bare message left the offending URL
      // invisible (airmastersjax.com harvest failed with a clean canonical).
      console.warn(JSON.stringify({ event: "source_identity_mismatch", requestedUrl, reportedRaw: raw, resolved: candidate.href }));
      return {
        ok: false,
        error: "Provider scrape resolved outside the submitted source identity.",
      };
    }
    normalized.push(candidate.href);
  }
  return { ok: true, url: normalized[0] || requestedUrl };
}

function boundedPrivatePageSource(result = {}) {
  const markdown = String(result.markdown || "");
  return {
    publication_policy: "private_review_only",
    quality_review: result.private_quality_review || null,
    markdown: markdown.slice(0, MAX_OBSERVATION_MARKDOWN_CHARS),
    markdown_chars: markdown.length,
    markdown_truncated: markdown.length > MAX_OBSERVATION_MARKDOWN_CHARS,
    metadata: boundedPageMetadata(result.metadata),
    media: {
      images: boundedMediaItems(result.images, result.url),
      branding: boundedBranding(result.branding, result.url),
    },
  };
}

function boundedPageMetadata(value) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  ["title", "description", "ogTitle", "ogDescription", "language", "sourceURL"].forEach(key => {
    const text = boundedText(row[key], MAX_OBSERVATION_METADATA_CHARS);
    if (text) output[key] = text;
  });
  ["statusCode", "contentLength"].forEach(key => {
    const number = Number(row[key]);
    if (Number.isFinite(number)) output[key] = number;
  });
  return output;
}

function boundedMediaItems(value, baseUrl) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_OBSERVATION_MEDIA_ITEMS).map(item => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item : { url: item };
    const url = absolutize(row.url || row.src || row.href || row.link || "", baseUrl);
    if (!url) return null;
    const output = { url };
    ["alt", "title", "role", "type"].forEach(key => {
      const text = boundedText(row[key], MAX_OBSERVATION_MEDIA_TEXT_CHARS);
      if (text) output[key] = text;
    });
    ["width", "height"].forEach(key => {
      const number = Number(row[key]);
      if (Number.isFinite(number) && number >= 0) output[key] = number;
    });
    return output;
  }).filter(Boolean);
}

function boundedBranding(value, baseUrl) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  const logo = absolutize(row.logo || row.logoUrl || "", baseUrl);
  if (logo) output.logo = logo;
  const colors = row.colors && typeof row.colors === "object" && !Array.isArray(row.colors) ? row.colors : {};
  const boundedColors = Object.entries(colors).slice(0, 16).reduce((acc, [key, value]) => {
    const color = boundedText(value, 64);
    if (color) acc[boundedText(key, 64)] = color;
    return acc;
  }, {});
  if (Object.keys(boundedColors).length) output.colors = boundedColors;
  return output;
}

function boundedText(value, maxChars) {
  return String(value == null ? "" : value).trim().slice(0, maxChars);
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function fetchPublicWithTimeout(url, options, timeoutMs, expectedHostname = "") {
  const deadline = Date.now() + timeoutMs;
  let current = new URL(url);

  for (let redirectCount = 0; redirectCount <= MAX_PUBLIC_REDIRECTS; redirectCount += 1) {
    if (!await isSafePublicHttpUrl(current)) {
      throw new Error("Public source URL resolved to a local, private, or reserved address.");
    }
    if (expectedHostname && !samePublicSite(current.hostname, expectedHostname)) {
      throw new Error("Sitemap redirect left the submitted website host.");
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Public source request timed out.");
    const response = await fetchWithTimeout(current.href, { ...options, redirect: "manual" }, remainingMs);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount === MAX_PUBLIC_REDIRECTS) throw new Error("Public source redirected too many times.");
    current = new URL(location, current);
  }

  throw new Error("Public source redirect validation failed.");
}

async function readResponseTextLimited(response, maxBytes, timeoutMs, budget) {
  maxBytes = Math.max(0, Math.min(maxBytes, budget ? budget.limit - budget.used : maxBytes));
  if (!maxBytes) { await response.body?.cancel().catch(() => {}); throw new Error('Source byte budget exhausted.'); }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) { await response.body?.cancel().catch(() => {}); throw new Error('Source response is larger than the allowed limit.'); }
  const deadline = Date.now() + timeoutMs;
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await withDeadline(response.text(), deadline, "Sitemap response timed out.");
    if (budget) budget.used = Math.min(budget.limit, budget.used + Buffer.byteLength(text, "utf8"));
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Sitemap response is larger than the allowed limit.");
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await withDeadline(reader.read(), deadline, "Sitemap response timed out.");
      if (done) break;
      total += value.byteLength;
      if (budget) {
        const remaining = budget.limit - budget.used;
        budget.used = Math.min(budget.limit, budget.used + value.byteLength);
        if (value.byteLength > remaining) { await reader.cancel().catch(() => {}); throw new Error('Source byte budget exhausted.'); }
      }
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("Sitemap response is larger than the allowed limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function withDeadline(promise, deadline, timeoutMessage) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error(timeoutMessage);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(timeoutMessage)), remainingMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isSafePublicUrlSyntax(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return false;
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  return net.isIP(hostname) ? isPublicIpAddress(hostname) : true;
}

async function isSafePublicHttpUrl(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (!isSafePublicUrlSyntax(parsed)) return false;
  const hostname = normalizeHostname(parsed.hostname);
  if (net.isIP(hostname)) return isPublicIpAddress(hostname);

  // IANA-reserved example names are used by the isolated regression harness;
  // they cannot resolve on the public DNS root in production.
  if (/(^|\.)(?:example|test|invalid)$/.test(hostname)) return true;
  try {
    const addresses = await lookupAddressesWithTimeout(hostname);
    return Array.isArray(addresses)
      && addresses.length > 0
      && addresses.every(entry => isPublicIpAddress(entry.address));
  } catch {
    return false;
  }
}

async function lookupAddressesWithTimeout(hostname) {
  let timer;
  try {
    return await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise(resolve => { timer = setTimeout(() => resolve([]), DNS_LOOKUP_TIMEOUT_MS); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function samePublicSite(left, right) {
  const normalize = value => normalizeHostname(value).replace(/^www\./, "");
  return normalize(left) === normalize(right);
}

function isPublicIpAddress(address) {
  const value = normalizeHostname(address).split("%")[0];
  const mapped = mappedIpv4Address(value);
  if (mapped) return isPublicIpv4(mapped);
  const family = net.isIP(value);
  if (family === 4) return isPublicIpv4(value);
  if (family !== 6) return false;

  const compact = value.toLowerCase();
  return compact !== "::"
    && compact !== "::1"
    && !/^::/.test(compact)
    && !/^f[cd]/.test(compact)
    && !/^fe[89a-f]/.test(compact)
    && !/^ff/.test(compact)
    && !/^64:ff9b:1(?::|$)/.test(compact)
    && !/^100:(?:0*:){0,3}/.test(compact)
    && !/^2001:db8(?::|$)/.test(compact)
    && !/^2002(?::|$)/.test(compact);
}

function mappedIpv4Address(address) {
  const dotted = String(address || "").match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];
  const hex = String(address || "").match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return "";
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPublicIpv4(address) {
  const parts = String(address || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224);
}

function fallbackExtract(url, markdown, metadata, html = "", links = [], images = [], branding = {}) {
  const text = `${metadata.title || ""}\n${metadata.description || ""}\n${metadata.ogTitle || ""}\n${metadata.ogDescription || ""}\n${markdown || ""}\n${html || ""}`;
  // rawHtml is still used unchanged for brand/media extraction below. Service
  // discovery gets a visible-content-only view so embedded code cannot become
  // a service claim.
  const serviceText = stripServiceNonContentMarkup(text);
  const phone = firstMatch(text, /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  const email = intakeQuality.emailFromText(serviceText);
  const title = metadata.ogTitle || metadata.title || "";
  const description = metadata.ogDescription || metadata.description || "";
  const origin = isPublicWebsiteCandidate(url) ? safeOrigin(url) : "";
  const logoCandidates = extractLogoCandidates(url, html, metadata, images, branding);
  const imageCandidates = extractImageCandidates(url, images, html);
  const brandPalette = extractBrandPalette(html, metadata, branding);
  const gbpPlaceId = extractGoogleBusinessId(url, text);
  const hours = extractHours(serviceText);
  const exactServices = extractExactServices(serviceText);
  const protectedArtifacts = extractProtectedArtifacts(serviceText, exactServices);

  return cleanupExtracted({
    brandName: cleanTitle(title),
    finalPhone: phone,
    email,
    hours,
    hoursSource: hours ? (/google|maps\.app\.goo\.gl/i.test(url) ? "Google Business Profile" : "Client website") : "",
    gbpPlaceId,
    listingConfidence: /google|maps\.app\.goo\.gl/i.test(url) ? (gbpPlaceId ? "Exact business match" : "Likely match - needs human review") : "",
    sourceTruth: origin,
    domainUrl: origin,
    logoReceived: logoCandidates.length ? "Yes" : "",
    logoLink: logoCandidates[0] || "",
    faviconRequired: logoCandidates.length ? "Yes" : "",
    logoCandidates,
    brandPalette,
    brandColors: brandPalette.map(item => item.hex).join(", "),
    imageCandidates,
    galleryLink: imageCandidates.length ? origin : "",
    mainServices: exactServices.join("; "),
    exactServices: exactServices.join("\n"),
    protectedArtifacts: protectedArtifacts.join("\n"),
    businessSummary: description,
    socialLinks: extractSocialLinks(`${text}\n${normalizeLinkList(links).join("\n")}`)
  });
}

function reviewHarvestExtraction(url, fallback = {}, raw = {}, markdown = "") {
  const checked = intakeQuality.facts(raw);
  const extracted = mergeExtractedWithFallback(fallback, checked.data);
  const candidates = intakeQuality.services([extracted.exactServices, extracted.mainServices]);
  const observation = { source: url, extracted, private_source: { markdown } };
  const accepted = candidates.filter(name => intakeQuality.sourceServiceCandidate(observation, name));
  const rawLabels = intakeQuality.list([raw.exactServices, raw.mainServices]);
  const dropped = rawLabels.filter(name => !accepted.some(value => intakeQuality.key(value) === intakeQuality.key(name)));
  const demo = intakeQuality.demoSource(url);
  const issues = [...checked.issues,
    ...(dropped.length ? [{ field: "services", rule: "service_labels_withheld", severity: "review" }] : []),
    ...(demo ? [{ field: "reviews", rule: "template_demo_source", severity: "review" }] : [])];
  extracted.exactServices = accepted.join("\n");
  extracted.mainServices = accepted.join("\n");
  const rawFields = ["brandName", "businessName", "email", "domainUrl", "gbpPlaceId", "placeId", "address",
    "mainServices", "exactServices", "reviewsBadgesNeeded", "reviews", "rating", "reviewCount"];
  return {
    extracted: demo ? {} : cleanupExtracted(extracted),
    privateReview: {
      publication_policy: "private_review_only", issues,
      raw_fields: Object.fromEntries(rawFields.filter(field => raw[field] != null)
        .map(field => [field, intakeQuality.privateValue(raw[field])])),
      rejected: checked.rejected,
    },
  };
}

function mergeExtractedWithFallback(fallback, extracted) {
  const base = cleanupExtracted(fallback || {});
  const structured = cleanupExtracted(extracted || {});
  const merged = { ...base };
  const arrayKeys = new Set(["socialLinks", "logoCandidates", "imageCandidates", "brandPalette"]);

  Object.entries(structured).forEach(([key, value]) => {
    if (arrayKeys.has(key)) {
      if (key === "brandPalette") {
        merged[key] = dedupePalette([...(base[key] || []), ...(Array.isArray(value) ? value : [value])]);
      } else {
        merged[key] = mergeArrayValues(base[key] || [], value);
      }
      return;
    }
    // cleanupExtracted removes empty strings and arrays, so only meaningful
    // structured values can replace fallback evidence here.
    merged[key] = value;
  });

  const logoUrls = [
    ...(merged.logoCandidates || []),
    base.logoLink,
    structured.logoLink
  ].filter(Boolean);
  const rankedLogos = rankLogoCandidateUrls(logoUrls);
  if (rankedLogos.length) {
    merged.logoCandidates = rankedLogos;
    merged.logoLink = rankedLogos[0];
    merged.logoReceived = "Yes";
  }
  const structuredTextPalette = (String(structured.brandColors || "").match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi) || [])
    .map(value => ({ hex: normalizeHexColor(value), role: "Brand color", source: "Firecrawl structured extraction" }))
    .filter(item => item.hex);
  if (structuredTextPalette.length) {
    merged.brandPalette = dedupePalette([...(merged.brandPalette || []), ...structuredTextPalette]);
  }
  if (merged.brandPalette?.length) {
    merged.brandColors = merged.brandPalette.map(item => item.hex || item.color || "").filter(Boolean).join(", ");
  }

  return cleanupExtracted(merged);
}

function mergeResults(results, sourceUrls) {
  const merged = {};
  const arrayKeys = new Set(["socialLinks", "logoCandidates", "imageCandidates", "brandPalette"]);

  results.forEach(result => {
    if (intakeQuality.demoSource(result.url)) return;
    const item = cleanupExtracted(result.extracted || {});
    Object.entries(item).forEach(([key, value]) => {
      if (!value) return;
      if (arrayKeys.has(key)) {
        merged[key] = key === "brandPalette"
          ? dedupePalette([...(merged[key] || []), ...(Array.isArray(value) ? value : [value])])
          : mergeArrayValues(merged[key] || [], value);
      } else if (!merged[key]) {
        merged[key] = value;
      } else if (["mainServices", "exactServices", "protectedArtifacts", "mustInclude", "citiesServed", "serviceArea"].includes(key) && !String(merged[key]).includes(value)) {
        merged[key] = `${merged[key]}; ${value}`;
      }
    });
  });

  const websiteUrl = sourceUrls.find(isPublicWebsiteCandidate);
  const gbpUrl = sourceUrls.find(url => /maps\.app\.goo\.gl|share\.google|google\./i.test(url));
  if (websiteUrl && !merged.domainUrl) merged.domainUrl = safeOrigin(websiteUrl);
  if (websiteUrl && !merged.sourceTruth) merged.sourceTruth = safeOrigin(websiteUrl);
  if (gbpUrl) merged.gbpLink = gbpUrl;
  if (gbpUrl && !merged.gbpPlaceId) merged.gbpPlaceId = extractGoogleBusinessId(gbpUrl, "");
  if (gbpUrl && !merged.listingConfidence) merged.listingConfidence = merged.gbpPlaceId ? "Exact business match" : "Likely match - needs human review";
  if (merged.hours && !merged.hoursSource) merged.hoursSource = gbpUrl ? "Google Business Profile" : "Client website";
  if (merged.address && !merged.publicAddressRule) merged.publicAddressRule = "Shown";
  if (merged.address && !merged.mapMode) merged.mapMode = "Office";
  if (merged.logoCandidates && merged.logoCandidates.length && !merged.logoLink) merged.logoLink = merged.logoCandidates[0];
  if (merged.logoLink && !merged.logoReceived) merged.logoReceived = "Yes";
  if (merged.logoReceived === "Yes" && !merged.faviconRequired) merged.faviconRequired = "Yes";
  if (merged.brandPalette && merged.brandPalette.length && !merged.brandColors) {
    merged.brandColors = merged.brandPalette.map(item => item.hex || item.color || "").filter(Boolean).join(", ");
  }
  if (merged.socialLinks && merged.socialLinks.length && !merged.mustInclude) {
    merged.mustInclude = `Social profiles found: ${merged.socialLinks.join(", ")}`;
  }
  const exactServices = intakeQuality.services([merged.exactServices, merged.mainServices]);
  merged.exactServices = exactServices.join("\n");
  merged.mainServices = exactServices.join("\n");
  const protectedArtifacts = extractProtectedArtifacts([
    merged.protectedArtifacts,
    merged.exactServices,
    merged.mustInclude,
    merged.licensedWording
  ].filter(Boolean).join("\n"), exactServices);
  if (protectedArtifacts.length) {
    merged.protectedArtifacts = mergeLineText(merged.protectedArtifacts, protectedArtifacts.join("\n"));
  }

  return cleanupExtracted(merged);
}

function cleanupExtracted(obj) {
  obj = intakeQuality.facts(obj || {}).data;
  const cleaned = {};
  Object.entries(obj || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === "mainServices" || key === "exactServices") {
      const serviceText = sanitizeServiceText(value);
      if (serviceText) cleaned[key] = serviceText;
      return;
    }
    if (Array.isArray(value)) {
      const arr = value.map(item => {
        if (key === "brandPalette") {
          const hex = normalizeHexColor(item && typeof item === "object" ? item.hex || item.color || item.value : item);
          if (!hex) return null;
          return {
            hex,
            role: String(item?.role || "").replace(/\s+/g, " ").trim(),
            source: String(item?.source || "").replace(/\s+/g, " ").trim()
          };
        }
        if (item && typeof item === "object") {
          const url = String(item.url || item.src || item.link || "").trim();
          if (!url) return null;
          return {
            url,
            alt: String(item.alt || item.title || item.note || "").replace(/\s+/g, " ").trim(),
            role: String(item.role || "").replace(/\s+/g, " ").trim()
          };
        }
        return String(item || "").trim();
      }).filter(Boolean);
      if (arr.length) cleaned[key] = key === "brandPalette" ? dedupePalette(arr) : [...new Set(arr)];
      return;
    }
    const text = String(value).replace(/\s+/g, " ").trim();
    if (text && text.toLowerCase() !== "not provided" && text.toLowerCase() !== "unknown") cleaned[key] = text;
  });
  return cleaned;
}

function mergeArrayValues(existing, incoming) {
  const combined = [...(Array.isArray(existing) ? existing : [existing]), ...(Array.isArray(incoming) ? incoming : [incoming])].filter(Boolean);
  const seen = new Set();
  return combined.filter(item => {
    const key = typeof item === "object" ? item.url : item;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeLinkList(links) {
  return (Array.isArray(links) ? links : [])
    .map(item => typeof item === "string" ? item : item.url || item.href || item.link || "")
    .filter(Boolean);
}

function absolutize(url, baseUrl) {
  try {
    const parsed = new URL(String(url || "").trim(), baseUrl);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function extractLogoCandidates(baseUrl, html, metadata, images, branding) {
  const ranked = new Map();
  let insertionOrder = 0;
  const push = (value, baseScore = 0, context = "") => {
    if (Array.isArray(value)) {
      value.forEach(item => push(item, baseScore, context));
      return;
    }
    if (value && typeof value === "object") {
      push(value.url || value.src || value.href || value.value || "", baseScore, `${context} ${value.alt || value.title || value.role || ""}`);
      return;
    }
    const url = absolutize(value, baseUrl);
    if (!url || isFalsePositiveLogoUrl(url)) return;
    const score = baseScore + logoUrlScore(url, context);
    const prior = ranked.get(url);
    if (!prior || score > prior.score) ranked.set(url, { url, score, order: prior?.order ?? insertionOrder++ });
  };

  collectBrandingLogos(branding).forEach(item => push(item.value, 145, item.context));
  push(metadata?.logo || metadata?.logoUrl, 120, "metadata logo");
  if (/logo|brand|wordmark/i.test(`${metadata?.ogImage || ""} ${metadata?.ogImageAlt || metadata?.ogImageDescription || ""}`)) {
    push(metadata.ogImage, 45, "Open Graph image labelled as logo");
  }

  const source = String(html || "");
  const headerRegions = source.match(/<(?:header|nav)\b[^>]*>[\s\S]*?<\/(?:header|nav)>/gi) || [];
  headerRegions.forEach(region => {
    String(region).replace(/<img\b[^>]*>/gi, tag => {
      addLogoTagCandidates(tag, 145, "header upper-left navigation", push);
      return tag;
    });
    String(region).replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, picture => {
      addPictureLogoCandidates(picture, 140, "header picture logo", push);
      return picture;
    });
    String(region).replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, value) => {
      if (/logo|brand|wordmark/i.test(`${value} ${region.slice(0, 300)}`)) push(value, 125, "header background logo");
      return match;
    });
  });

  source.replace(/<img\b[^>]*>/gi, tag => {
    if (/logo|brand|wordmark|brandmark/i.test(tag)) addLogoTagCandidates(tag, 90, tag, push);
    return tag;
  });
  source.replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, picture => {
    if (/logo|brand|wordmark|brandmark/i.test(picture)) addPictureLogoCandidates(picture, 95, picture, push);
    return picture;
  });

  (Array.isArray(images) ? images : []).forEach(item => {
    const src = typeof item === "string" ? item : item?.url || item?.src || item?.link || "";
    const label = typeof item === "string" ? item : `${src} ${item?.alt || ""} ${item?.title || ""} ${item?.role || ""}`;
    if (/logo|brand|wordmark|brandmark/i.test(label)) push(src, 85, label);
  });

  return [...ranked.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(item => item.url)
    .slice(0, 8);
}

function collectBrandingLogos(branding, path = "branding", depth = 0, output = []) {
  if (!branding || depth > 4) return output;
  if (Array.isArray(branding)) {
    branding.forEach((item, index) => collectBrandingLogos(item, `${path}[${index}]`, depth + 1, output));
    return output;
  }
  if (typeof branding !== "object") return output;
  Object.entries(branding).forEach(([key, value]) => {
    const nextPath = `${path}.${key}`;
    if (/logo|wordmark|brandmark/i.test(key)) {
      if (typeof value === "string") output.push({ value, context: nextPath });
      else if (Array.isArray(value)) value.forEach(item => output.push({ value: item, context: nextPath }));
      else if (value && typeof value === "object") output.push({ value, context: nextPath });
    }
    if (value && typeof value === "object") collectBrandingLogos(value, nextPath, depth + 1, output);
  });
  return output;
}

function addLogoTagCandidates(tag, baseScore, context, push) {
  const label = `${context} ${htmlAttribute(tag, "alt")} ${htmlAttribute(tag, "title")} ${htmlAttribute(tag, "id")} ${htmlAttribute(tag, "class")}`;
  const width = Number.parseInt(htmlAttribute(tag, "width"), 10);
  const sizeScore = Number.isFinite(width) ? (width >= 300 ? 18 : width > 0 && width < 120 ? -12 : 0) : 0;
  ["data-lazy-src", "data-src", "data-original", "src"].forEach(attribute => {
    const value = htmlAttribute(tag, attribute);
    if (value && !/^data:/i.test(value)) push(value, baseScore + sizeScore, label);
  });
  ["data-lazy-srcset", "data-srcset", "srcset"].forEach(attribute => {
    srcsetUrls(htmlAttribute(tag, attribute)).forEach((value, index) => push(value, baseScore + sizeScore + Math.max(0, 8 - index), label));
  });
}

function addPictureLogoCandidates(picture, baseScore, context, push) {
  String(picture || "").replace(/<source\b[^>]*>/gi, tag => {
    ["data-lazy-srcset", "data-srcset", "srcset"].forEach(attribute => {
      srcsetUrls(htmlAttribute(tag, attribute)).forEach((value, index) => push(value, baseScore + Math.max(0, 8 - index), context));
    });
    return tag;
  });
  String(picture || "").replace(/<img\b[^>]*>/gi, tag => {
    addLogoTagCandidates(tag, baseScore, context, push);
    return tag;
  });
}

function srcsetUrls(srcset) {
  return String(srcset || "")
    .split(",")
    .map(item => {
      const parts = item.trim().split(/\s+/);
      const descriptor = parts[1] || "0";
      return { url: parts[0] || "", size: Number.parseFloat(descriptor) || 0 };
    })
    .filter(item => item.url && !/^data:/i.test(item.url))
    .sort((a, b) => b.size - a.size)
    .map(item => item.url);
}

function rankLogoCandidateUrls(values) {
  const seen = new Map();
  (Array.isArray(values) ? values : [values]).forEach((value, order) => {
    const url = String(value?.url || value || "").trim();
    if (!url || isFalsePositiveLogoUrl(url)) return;
    const score = logoUrlScore(url, "") + Math.max(0, 12 - order);
    const prior = seen.get(url);
    if (!prior || score > prior.score) seen.set(url, { url, score, order: prior?.order ?? order });
  });
  return [...seen.values()].sort((a, b) => b.score - a.score || a.order - b.order).map(item => item.url).slice(0, 8);
}

function logoUrlScore(url, context = "") {
  const evidence = `${url} ${context}`.toLowerCase();
  let score = 0;
  if (/logo|wordmark|brandmark/.test(evidence)) score += 35;
  if (/high[-_ ]?res|hi[-_ ]?res|full[-_ ]?size|original/.test(evidence)) score += 32;
  if (/header|upper-left|navigation|navbar/.test(evidence)) score += 24;
  if (/\.(?:jpe?g|png)(?:$|[?#])/.test(String(url).toLowerCase())) score += 22;
  else if (/\.webp(?:$|[?#])/.test(String(url).toLowerCase())) score += 18;
  else if (/\.svg(?:$|[?#])/.test(String(url).toLowerCase())) score += 4;
  return score;
}

function isFalsePositiveLogoUrl(url) {
  const value = String(url || "").toLowerCase();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return true;
  }
  return !value
    || /^data:|^blob:/.test(value)
    || parsed.pathname === "/"
    || /(?:favicon|apple-touch-icon|mask-icon|browserconfig|mstile|tracking[-_.]?pixel|spacer\.gif|sprite)/.test(value);
}

function htmlAttribute(tag, name) {
  const pattern = new RegExp(`(?:^|\\s)${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  return String(tag || "").match(pattern)?.[2]?.trim() || "";
}

function extractImageCandidates(baseUrl, images, html) {
  const raw = [];
  const push = (src, alt = "") => {
    const url = absolutize(src, baseUrl);
    if (!url) return;
    if (/favicon|icon|logo|sprite|tracking|pixel|avatar|svg/i.test(url)) return;
    raw.push({ url, alt, role: /hero|banner|header/i.test(`${url} ${alt}`) ? "Hero" : "Gallery" });
  };
  (Array.isArray(images) ? images : []).forEach(item => {
    if (typeof item === "string") push(item);
    else push(item.url || item.src || item.link || "", item.alt || item.title || "");
  });
  String(html || "").replace(/<img[^>]+>/gi, tag => {
    const src = firstMatch(tag, /src=["']([^"']+)["']/i).replace(/^src=["']|["']$/g, "");
    const alt = firstMatch(tag, /alt=["']([^"']*)["']/i).replace(/^alt=["']|["']$/g, "");
    push(src, alt);
    return tag;
  });
  return mergeArrayValues([], raw).slice(0, 18);
}

function extractBrandPalette(html, metadata = {}, branding = {}) {
  const colors = new Map();
  let insertionOrder = 0;
  const push = (value, role = "Site color", source = "website", score = 0) => {
    if (isTransparentColor(value)) return;
    const hex = normalizeHexColor(value);
    if (!hex) return;
    const prior = colors.get(hex);
    if (prior) {
      prior.count += 1;
      if (score > prior.score) {
        prior.score = score;
        prior.role = String(role || "Site color");
        prior.source = String(source || "website");
      }
      return;
    }
    colors.set(hex, {
      hex,
      role: String(role || "Site color"),
      source: String(source || "website"),
      score,
      count: 1,
      order: insertionOrder++
    });
  };

  collectBrandingColors(branding).forEach(item => push(item.value, item.role, "Firecrawl branding", 260));
  push(metadata?.themeColor || metadata?.["theme-color"], "Browser theme", "metadata", 240);
  push(metadata?.msapplicationTileColor, "Tile color", "metadata", 220);

  const inlineCss = [
    String(html || "").match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)?.join("\n") || "",
    String(html || "").match(/style=["'][^"']+["']/gi)?.join("\n") || ""
  ].filter(Boolean).join("\n");

  const scanCss = (css, source, baseScore) => {
    // WordPress ships a generic rainbow preset in every install. It is not the
    // client's theme and must not outrank colors the site actually applies.
    String(css || "").replace(/(--[\w-]*(?:brand|primary|secondary|accent|theme|color)[\w-]*)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]+\))/gi, (match, name, value) => {
      if (!/^--wp-/i.test(name)) push(value, humanizeColorRole(name), source, baseScore + 55);
      return match;
    });
    String(css || "").replace(/(?:^|[;{])\s*(color|background(?:-color)?|border(?:-[\w-]+)?-color|fill|stroke)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]+\))(\s*!important)?/gi, (match, property, value, important) => {
      const roleBoost = /background|fill/i.test(property) ? 12 : 0;
      push(value, humanizeColorRole(property), source, baseScore + 20 + roleBoost + (important ? 25 : 0));
      return match;
    });
    String(css || "").replace(/([^{}]{1,420})\{([^{}]{1,1600})\}/g, (match, selector, declarations) => {
      if (!/(?:^|[.#_-])(?:header|nav|menu|button|btn|cta|hero|footer|logo|section)(?:$|[.#_:\s-])/i.test(selector)) return match;
      String(declarations).replace(/(?:color|background(?:-color)?|border(?:-[\w-]+)?-color|fill|stroke)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]+\))/gi, (declaration, value) => {
        push(value, /button|btn|cta/i.test(selector) ? "Call-to-action" : "Brand surface", source, baseScore + 65);
        return declaration;
      });
      return match;
    });
    String(css || "").replace(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi, (value, offset, fullText) => {
      const nearby = fullText.slice(Math.max(0, offset - 360), Math.min(fullText.length, offset + 120));
      if (/(?:header|nav|menu|button|btn|cta|hero|footer|logo|section)/i.test(nearby)) {
        const customModule = /(?:button|btn|cta|section|hero|header|footer|menu)[\w-]*[_-]\d+/i.test(nearby);
        push(value, /button|btn|cta/i.test(nearby) ? "Call-to-action" : "Brand surface", source, customModule ? 180 : baseScore + 80);
      }
      return value;
    });
  };
  scanCss(inlineCss, "page CSS", 30);

  String(html || "").replace(/(?:^|[,{;\s"'])(?:accent|primary|secondary|brand|theme)[_-]?color["']?\s*[:=]\s*["']?(#[0-9a-f]{3,8}\b|rgba?\([^)]+\))/gi, (match, value) => {
    push(value, "Theme accent", "page configuration", 105);
    return match;
  });

  // Some builders emit colors inside generated shorthand rules. Use raw tokens
  // only as a last resort so a real site never returns an empty palette.
  if (colors.size < 3) {
    String(inlineCss).replace(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi, match => {
      push(match, "Site color", "page CSS", 10);
      return match;
    });
  }

  return [...colors.values()]
    .sort((a, b) => {
      const aNeutral = ["#FFFFFF", "#000000"].includes(a.hex) ? 1 : 0;
      const bNeutral = ["#FFFFFF", "#000000"].includes(b.hex) ? 1 : 0;
      return aNeutral - bNeutral
        || (b.score + Math.min(b.count, 12) * 3) - (a.score + Math.min(a.count, 12) * 3)
        || a.order - b.order;
    })
    .slice(0, 8)
    .map(({ hex, role, source }) => ({ hex, role, source }));
}

function collectBrandingColors(branding, path = "branding", depth = 0, output = []) {
  if (branding === undefined || branding === null || depth > 5) return output;
  if (typeof branding === "string") {
    if (/color|palette|primary|secondary|accent|background|foreground|text|theme/i.test(path)) {
      const matches = branding.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi) || [];
      matches.forEach(value => output.push({ value, role: humanizeColorRole(path.split(".").pop()) }));
    }
    return output;
  }
  if (Array.isArray(branding)) {
    branding.forEach((item, index) => collectBrandingColors(item, `${path}[${index}]`, depth + 1, output));
    return output;
  }
  if (typeof branding !== "object") return output;

  const directValue = branding.hex || branding.color || branding.value;
  if (directValue && /color|palette|primary|secondary|accent|background|foreground|text|theme/i.test(path)) {
    output.push({
      value: directValue,
      role: String(branding.role || branding.name || humanizeColorRole(path.split(".").pop()))
    });
  }
  Object.entries(branding).forEach(([key, value]) => {
    collectBrandingColors(value, `${path}.${key}`, depth + 1, output);
  });
  return output;
}

function humanizeColorRole(value) {
  const text = String(value || "")
    .replace(/^--/, "")
    .replace(/\[\d+\]/g, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .trim();
  return text || "Site color";
}

function isTransparentColor(value) {
  const match = String(value || "").match(/rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(0(?:\.0+)?)\s*\)/i);
  return Boolean(match) || /^transparent$/i.test(String(value || "").trim());
}

function dedupePalette(colors) {
  const seen = new Set();
  return colors.filter(item => {
    const hex = normalizeHexColor(item.hex || item.color || item.value);
    if (!hex || seen.has(hex)) return false;
    seen.add(hex);
    item.hex = hex;
    return true;
  });
}

function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  const hex = raw.match(/#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i);
  if (hex) {
    let body = hex[1];
    if (body.length === 8) body = body.slice(0, 6);
    if (body.length === 3) body = body.split("").map(ch => ch + ch).join("");
    return `#${body.toUpperCase()}`;
  }
  const rgb = raw.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const nums = rgb[1].split(/[,\s/]+/).map(part => Number.parseFloat(part)).filter(num => Number.isFinite(num)).slice(0, 3);
    if (nums.length === 3) {
      return `#${nums.map(num => Math.max(0, Math.min(255, Math.round(num))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    }
  }
  return "";
}

function extractGoogleBusinessId(url, text) {
  const combined = `${url || ""}\n${text || ""}`.replace(/&amp;/gi, "&");
  const matches = combined.matchAll(/(?:\b|[?&])(?:place_id|placeid|query_place_id)=([^&\s<>"']+)/gi);
  for (const match of matches) {
    try {
      const id = intakeQuality.placeId(decodeURIComponent(match[1]));
      if (id) return id;
    } catch { /* Malformed percent encoding is evidence for review, not an ID. */ }
  }
  // Numeric CIDs and 0x data IDs are not Place IDs. Do not relabel them.
  return "";
}

// Shared by the authenticated automatic compiler. Keeping this as the same
// implementation used by the public prefill endpoint prevents the two paths
// from drifting or spending a second provider call on equivalent work.
module.exports.harvestSources = harvestSources;
module.exports.harvestExactSourceUrls = harvestExactSourceUrls;
module.exports.verifiedEvidenceForSources = verifiedEvidenceForSources;

function extractHours(text) {
  const source = stripServiceNonContentMarkup(String(text || "")).replace(/\r/g, "");
  const rows = source.split("\n").map(line => line.replace(/^#{1,6}\s+/, "").replace(/^\s*[-*]\s+/, "").trim());
  const accepted = rows.map(line => intakeQuality.hours(line.replace(/^(?:business |opening )?hours\s*:\s*/i, ""))).filter(Boolean);
  return [...new Set(accepted)].slice(0, 7).join("; ");
}

function extractExactServices(text) {
  const source = stripServiceNonContentMarkup(String(text || "")).replace(/\r/g, "\n");
  const candidates = [];
  const push = value => {
    const raw = String(value || "");
    if (isServiceCodeContaminated(raw)) return;
    const clean = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/^[\s"'-]*(?:[-*•●]|\d+[.)])\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.。]+$/, "");
    if (!clean || clean.length < 4 || clean.length > 96) return;
    if (isServiceCodeContaminated(clean) || !intakeQuality.serviceLabel(clean)) return;
    if (/^(services?|home|about|contact|gallery|faq|learn more|read more)$/i.test(clean)) return;
    // Navigation/resource headings are not service claims.  Keep this narrow
    // and whole-label based so a real service containing one of these words
    // remains eligible for downstream evidence verification.
    if (/^(?:reviews?|testimonials?|faqs?|service\s+areas?|areas\s+we\s+serve|financing|blog|news|resources?|community\s+(?:links?|resources?)|(?:useful\s+)?links?(?:\s+for\s+(?:your\s+)?community)?|portfolio|our\s+work|photos?|videos?|book(?:\s+now)?|schedule(?:\s+now|\s+service)?|request\s+(?:a\s+)?(?:quote|estimate|service)|get\s+in\s+touch|privacy(?:\s+policy)?|terms|sitemap)$/i.test(clean)) return;
    if (/service area|phone button|must include|east texas|serving area/i.test(clean)) return;
    if ((clean.match(/,/g) || []).length >= 2) return;
    if (!/\b(service|services|repair|maintenance|inspection|installation|replacement|winterization|orientation|walk[- ]?through|diagnostic|diagnostics|cleanup|removal|trimming|concrete|grading|paving|excavation|foundation|driveway|patio|slab|sidewalk|walkway|curb|gutter|poured|pouring|flatwork|demolition|hardscaping|masonry|brick|block|stonework|stucco|retaining wall|deck|fence|fencing|gate|roofing|roof|shingle|siding|framing|drywall|insulation|painting|landscaping|lawn|irrigation|tree|arbor|hedge|mulch|sod|seeding|aeration|renovation|remodel|restoration|construction|build|building|welding|fabrication|electrical|wiring|plumbing|excavating|septic|well|pump|leveling|compaction|resurfacing|sealcoating|striping|asphalt|milling)\b/i.test(clean)) return;
    if (!candidates.some(item => item.toLowerCase() === clean.toLowerCase())) candidates.push(clean);
  };

  const sourceLines = source
    .split(/\n|<br\b[^>]*>|<\/(?:li|p|h[1-6]|div|section|article|main|ul|ol|nav|header|footer|td|th|tr|dt|dd)\s*>/i)
    .map(line => line.trim())
    .filter(Boolean);
  const inferenceFragments = [];
  sourceLines.forEach(rawLine => {
    const line = rawLine.replace(/<[^>]+>/g, " ").trim();
    if (!isServiceCodeContaminated(rawLine) && !isServiceCodeContaminated(line)) inferenceFragments.push(line);
    if (line.length <= 120) push(rawLine);
    rawLine.split(/\s+[|·]\s+|;\s*/).forEach(part => {
      const cleanPart = part.replace(/<[^>]+>/g, " ").trim();
      push(part);
      if (!isServiceCodeContaminated(part) && !isServiceCodeContaminated(cleanPart)) inferenceFragments.push(cleanPart);
    });
  });

  // Keyword co-occurrence is not evidence of an additional business service.
  return intakeQuality.services(candidates);
}

function stripServiceNonContentMarkup(value) {
  const source = decodeServiceEntities(value)
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<!--[\s\S]*$/g, "\n")
    .replace(/```[\w-]*\s*[\s\S]*?```/g, "\n")
    .replace(/```[\w-]*\s*[\s\S]*$/g, "\n");
  const blockedTag = /<\s*(\/?)\s*(style|script|noscript|svg|template)\b[^>]*>/gi;
  let text = "";
  let cursor = 0;
  const blockedStack = [];
  let match;
  while ((match = blockedTag.exec(source)) !== null) {
    if (blockedStack.length === 0) text += source.slice(cursor, match.index);
    const closing = Boolean(match[1]);
    const tag = String(match[2] || "").toLowerCase();
    const current = blockedStack.at(-1);
    const rawTextContainer = ["style", "script", "noscript"].includes(current);
    if (rawTextContainer && !(closing && tag === current)) {
      cursor = blockedTag.lastIndex;
      continue;
    }
    const selfClosing = tag === "svg" && /\/\s*>$/.test(match[0]);
    if (closing) {
      if (blockedStack.at(-1) === tag) blockedStack.pop();
      if (blockedStack.length === 0) text += "\n";
    } else if (!selfClosing) {
      if (blockedStack.length === 0) text += "\n";
      blockedStack.push(tag);
    } else if (blockedStack.length === 0) {
      text += "\n";
    }
    cursor = blockedTag.lastIndex;
  }
  if (blockedStack.length === 0) text += source.slice(cursor);
  return text;
}

function decodeServiceEntities(value) {
  const named = {
    amp: "&", apos: "'", colon: ":", equals: "=", gt: ">", lbrace: "{",
    lt: "<", num: "#", period: ".", quot: '"', rbrace: "}", semi: ";", sol: "/"
  };
  return String(value || "").replace(/&#(\d+);|&#x([0-9a-f]+);|&([a-z]+);/gi, (entity, decimal, hex, name) => {
    if (decimal || hex) {
      const codePoint = Number.parseInt(decimal || hex, decimal ? 10 : 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return Object.prototype.hasOwnProperty.call(named, String(name || "").toLowerCase())
      ? named[String(name).toLowerCase()]
      : entity;
  });
}

function sanitizeServiceText(value) {
  const values = Array.isArray(value) ? value : [value];
  const lines = [];
  values.forEach(item => {
    if (item !== null && typeof item === "object") return;
    stripServiceNonContentMarkup(item)
      .replace(/\r\n?/g, "\n")
      .split(/\n|<br\b[^>]*>|<\/(?:li|p|h[1-6]|div|section|article|main|ul|ol|nav|header|footer|td|th|tr|dt|dd)\s*>|;\s*/i)
      .forEach(candidate => {
        const raw = String(candidate || "").trim();
        if (!raw || isServiceCodeContaminated(raw)) return;
        const clean = raw
          .replace(/<[^>]+>/g, " ")
          .replace(/^[\s"'-]*(?:[-*•●]|\d+[.)])\s*/, "")
          .replace(/[\t\f\v ]+/g, " ")
          .trim()
          .replace(/[.。]+$/, "");
        if (!clean || clean.length > 160 || isServiceCodeContaminated(clean)) return;
        if (!lines.some(line => line.toLowerCase() === clean.toLowerCase())) lines.push(clean);
      });
  });
  return intakeQuality.services(lines).join("\n");
}

function isServiceCodeContaminated(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/[{}]|\/\*|\*\//.test(text)) return true;
  if (/<\/?(?:style|script|noscript|svg|template)\b/i.test(text)) return true;
  if (/(?:^|[\s;])@[-a-z]+\b/i.test(text)) return true;
  if (/(?:^|[\s,>+~])(?:[.#][a-z_-][\w-]*|:[a-z_-][\w-]*|\[[^\]\r\n]+\])/i.test(text)) return true;
  if (/(?:^|[\s,>+~])[-a-z][\w-]*(?:[.#][a-z_-][\w-]*|:{1,2}[a-z_-][\w-]*)/.test(text)) return true;
  if (/(?:^|[\s,>+~])[a-z][\w-]*:{1,2}[a-z_-][\w-]*/i.test(text)) return true;
  if (/(?:^|[\s,>+~])(?:[a-z][\w-]*-[\w-]+|[a-z]{2,}[\w-]*)[.#][a-z_-][\w-]*/i.test(text)) return true;
  const cssComponentWord = /^(?:service|services|card|grid|wrapper|container|item|list|row|col|column|button|btn|link|nav|navbar|header|footer|modal|form|input|icon|image|img|content|title|text|hero|cta|menu)$/;
  const hyphenatedToken = /^\s*[a-z][\w-]*(?:-[a-z0-9]+)+\s*$/.test(text);
  if (hyphenatedToken && text.toLowerCase().split("-").some(word => cssComponentWord.test(word))) return true;
  if (/^\s*[a-z][\w-]*(?:\s*,\s*[a-z][\w-]*)+\s*$/.test(text)) {
    const selectorParts = text.toLowerCase().split(",").map(part => part.trim());
    if (selectorParts.some(part => part.includes("-")
      && part.split("-").some(word => cssComponentWord.test(word)))) return true;
  }
  if (/^\s*(?:html|body|main|section|article|header|footer|nav|div|span|ul|ol|li|a|button|form|input|img|h[1-6]|p)\s+[a-z][\w-]*(?:-[a-z0-9]+)+/i.test(text)) return true;
  if (/&\s*:{1,2}[a-z_-][\w-]*/i.test(text)) return true;
  if (/(?:^|[\s;'"])-?[a-z][\w-]*:\s*[a-z_-][\w-]*/.test(text)) return true;
  if (/^\s*(?:html|body|main|section|article|header|footer|nav|div|span|ul|ol|li|a|button|form|input|img|h[1-6]|p)(?:[.#:\[]|\s*[>+~]|\s+[.#\[]|\s*,)/i.test(text)) return true;
  if (/^\s*--[a-z0-9_-]+\b|(?:^|[\s;])--[a-z0-9_-]+\s*:/i.test(text)) return true;
  if (/(?:^|[;\s])-(?:webkit|moz|ms|o)-[a-z0-9-]+\s*:/i.test(text)) return true;
  if (/(?:^|[;'"=\s])(?:align-(?:content|items|self)|animation(?:-[a-z-]+)?|appearance|aspect-ratio|background(?:-[a-z-]+)?|border(?:-[a-z-]+)?|bottom|box-shadow|box-sizing|caption-side|clear|clip(?:-path)?|color|columns?|content|cursor|display|fill(?:-[a-z-]+)?|filter|float|flex(?:-[a-z-]+)?|font(?:-[a-z-]+)?|gap|grid(?:-[a-z-]+)?|height|inset|justify-(?:content|items|self)|left|letter-spacing|line-height|list-style(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|max-height|max-width|min-height|min-width|object-fit|opacity|order|outline(?:-[a-z-]+)?|overflow(?:-[xy])?|padding(?:-[a-z-]+)?|place-(?:content|items|self)|pointer-events|position|resize|right|stroke(?:-[a-z-]+)?|table-layout|text-(?:align|decoration|transform)|top|transform(?:-[a-z-]+)?|transition(?:-[a-z-]+)?|visibility|white-space|width|word-(?:break|spacing)|writing-mode|z-index)\s*:/i.test(text)) return true;
  if (/(?:^|[;'"=\s])[-a-z][\w-]*\s*:\s*(?:#[0-9a-f]{3,8}\b|-?\d*\.?\d+(?:px|r?em|%|vh|vw|vmin|vmax|s|ms|deg)\b|(?:none|block|grid|flex|inline(?:-block|-flex)?|absolute|relative|fixed|sticky|hidden|visible|auto|inherit|initial|unset|solid|dashed|center|cover|contain|left|right|both)\b|[-a-z]+\()/i.test(text)) return true;
  if (/(?:^|[;\s])[a-z][\w-]*\s*:\s*-?\d*\.?\d+\b/.test(text)) return true;
  if (/^\s*(?:display|position)\s+(?:block|grid|flex|inline(?:-block|-flex)?|none|absolute|relative|fixed|sticky)\b/i.test(text)) return true;
  if (/!important|\b(?:var|calc|url|rgba?|hsla?|linear-gradient|radial-gradient)\s*\(|(?:https?:\/\/|data:[a-z]+\/[a-z0-9.+-]+[;,]|base64\b)|\.(?:css|js)(?:\b|[?#])/i.test(text)) return true;
  if (/\b(?:style|on[a-z]+)\s*=|javascript:/i.test(text)) return true;
  if (/^\s*`[\s\S]*`\s*$|(?:^|[\s;])await\s+[$a-z_][\w$]*|\b[$a-z_][\w$]*\s*\[\s*["'`]|(?:^|[\s=(,:;])\/[a-z][^/\r\n]*\/[dgimsuvy]+\b|\?[^:\r\n]*:/i.test(text)) return true;
  if (/(?:^|\s)\/\/|^\s*["'][^"']+["']\s*:|(?:^|[,{;\s])[$a-z_][\w$]*\s*:\s*["'`\[{]|(?:^|[;\s])(?:return|throw|import|export)\b/i.test(text)) return true;
  if (/(?:=>|===|!==|\+\+|&&|\|\||\b(?:if|for|while|switch|catch)\s*\(|\bnew\s+[$a-z_][\w$]*\s*\(|^\s*[$a-z_][\w$]*\s*\([^)]*\)\s*;?\s*$|\b(?:document|window|console|localStorage|sessionStorage)\s*\.|\.[a-z_$][\w$]*\s*\(|\b(?:querySelector(?:All)?|addEventListener|setTimeout|setInterval)\s*\(|\bfunction\b\s*[\w$]*\s*\(|\b(?:const|let|var)\s+[$a-z_][\w$]*\s*=|(?:^|[;\s])[$a-z_][\w$]*(?:\.[a-z_$][\w$]*)*\s*(?:=|\+=|-=|\*=|\/=))/i.test(text)) return true;
  return false;
}

function inferRvServices(text) {
  const source = String(text || "");
  if (!/\b(RV|R\.V\.|recreational vehicle|camper|travel trailer|motorhome)\b/i.test(source)) return [];
  const services = [];
  const add = label => {
    if (!services.includes(label)) services.push(label);
  };
  if (/\b(air conditioner|air conditioning|a\/c|ac unit|hvac)\b/i.test(source)) add("RV Air Conditioner Service");
  if (/\bfurnace\b/i.test(source)) add("RV Furnace Service");
  if (/\bwater heater\b/i.test(source)) add("RV Water Heater Service");
  if (/\b(absorption refrigerator|12v\s*dc|12\s*v(?:olt)?|rv refrigerator|refrigerator)\b/i.test(source)) add("RV Refrigerator Service (Absorption or 12V DC only)");
  if (/\belectrical\b/i.test(source)) add("RV Electrical Service");
  if (/\b(water service|water system|fresh water|water leak|plumbing)\b/i.test(source)) add("RV Water Service");
  return services;
}

function extractProtectedArtifacts(text, exactServices = []) {
  const source = String(text || "").replace(/\r/g, "\n");
  const artifacts = [...(Array.isArray(exactServices) ? exactServices : [])];
  const push = value => {
    const clean = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "");
    if (!clean || clean.length < 8 || clean.length > 160) return;
    if (!artifacts.some(item => item.toLowerCase() === clean.toLowerCase())) artifacts.push(clean);
  };
  source.split(/\n|<br\s*\/?>|<\/li>|<\/p>/i).forEach(line => {
    if (/\b(certified|licensed|insured|partner|warranty|do not|does not|no residential|not handle|avoid|exclude|requested|specifically requested)\b/i.test(line)) {
      push(line);
    }
  });
  return artifacts.slice(0, 60);
}

function mergeLineText(...values) {
  const lines = [];
  values.forEach(value => {
    String(value || "")
      .split(/\r?\n|;\s*/)
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .forEach(line => {
        if (!lines.some(item => item.toLowerCase() === line.toLowerCase())) lines.push(line);
      });
  });
  return lines.join("\n");
}

function firstMatch(text, regex) {
  const match = String(text || "").match(regex);
  return match ? (match[1] || match[0]).trim() : "";
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/\s+[|-]\s+.*$/, "")
    .replace(/\bHome\b/gi, "")
    .trim();
}

function safeOrigin(url) {
  try {
    return new URL(url).origin.replace(/^https?:\/\//, "");
  } catch {
    return "";
  }
}

// (2026-09-23) The old substring denylist matched "x.com" INSIDE hostnames —
// every domain merely ending in "x.com" (airmastersjax.com, phoenix.com…)
// was treated as a Twitter link and refused harvest ("resolved outside the
// submitted source identity"). Domain-boundary matching instead: a host is a
// denied platform only when it IS the platform's domain or a subdomain of it.
const DENIED_PLATFORM_DOMAINS = Object.freeze([
  "facebook.com", "instagram.com", "yelp.com", "linkedin.com", "x.com", "twitter.com",
  "youtube.com", "tiktok.com", "nextdoor.com", "bbb.org", "google.com",
  "maps.app.goo.gl", "typeform.com", "forms.gle", "jotform.com",
]);

function isPublicWebsiteCandidate(url) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(String(url || "")) ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (DENIED_PLATFORM_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function extractSocialLinks(text) {
  const matches = String(text || "").match(/https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|youtube|x|twitter)\.com\/[^\s)]+/gi);
  return matches ? [...new Set(matches)] : [];
}

module.exports.deepHarvest = { contentPageUrl, pageLinks, locUrls, expandSourceUrls, readResponseTextLimited, limits: { maxUrls: MAX_EXPANDED_URLS, concurrency: SCRAPE_CONCURRENCY, totalBytes: MAX_HARVEST_BYTES, pageBytes: MAX_PAGE_RESPONSE_BYTES } };

// Pure content/syntax guards, not DNS, ownership, or Google verification.
// Browser/server copies are checked for exact parity by the offline regression.
function createIntakeQualityPolicy() {
  const version = "intake-quality-v1";
  const placeholder = /\b(?:lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing|your\s+(?:company|business|testimonial|review|address|email)\s+(?:name|here)|(?:sample|demo)\s+testimonial|insert\s+(?:text|address|email)\s+here)\b/i;
  const text = v => typeof v === "string" ? v.trim() : "";
  const key = v => text(v).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const list = v => (Array.isArray(v) ? v.flatMap(list) : text(v).split(/\r?\n|;|\s+\|\s+/)).filter(Boolean);
  const unique = values => [...new Map(values.map(v => [key(v), v])).values()];
  function domainHost(value) {
    const h = text(value).toLowerCase();
    return h.length <= 253 && h.includes(".") && !/^\d+(?:\.\d+){3}$/.test(h)
      && !/(?:^|\.)(?:localhost|local|internal|invalid)$/.test(h)
      && !/^(?:www\.)?(?:example\.(?:com|net|org)|yourdomain\.com)$/.test(h)
      && h.split(".").every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p))
      && /^[a-z][a-z0-9-]{1,62}$/i.test(h.split(".").at(-1));
  }
  function website(value) {
    const raw = text(value);
    if (!raw || /[\s\\<>"'{}\u0000-\u001f\u007f]/.test(raw)) return "";
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password && domainHost(u.hostname) ? u.href : "";
    } catch { return ""; }
  }
  function email(value) {
    const raw = text(value), parts = raw.split("@");
    if (!raw || raw.length > 254 || parts.length !== 2 || /[\s<>"\\\u0000-\u001f\u007f]/.test(raw)) return "";
    const [local, host] = parts;
    if (!local || local.length > 64 || /^\.|\.$|\.\./.test(local)
      || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) || !domainHost(host)
      || /\.(?:webp|avif|png|jpe?g|gif|svg|ico|bmp|tiff?|css|js|woff2?|ttf|map)$/i.test(host)) return "";
    return `${local}@${host.toLowerCase()}`;
  }
  function emailFromText(value) {
    const s = text(value).replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/<img\b[^>]*>/gi, " ");
    return (s.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(email).find(Boolean) || "";
  }
  function placeId(value) {
    const raw = text(value);
    // Full opaque token only; no salvage of prefixes from escaped query/JSON tails.
    // 2048 is a local resource bound, not a claimed Google maximum.
    return raw.length <= 2048 && /^(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{10,}$/i.test(raw) ? raw : "";
  }
  function hours(value) {
    const raw = text(value);
    if (!raw || raw.length > 1200 || placeholder.test(raw)
      || /[<>{}\[\]`\\=]|=>|https?:\/\/|\b(?:getUTC\w*|function|return|const|var|let)\b|\.\w+\s*\(/i.test(raw)) return "";
    const day = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|daily|every day|weekdays|weekends)\b/i;
    const time = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?\b/i;
    const rows = raw.split(/\r?\n|;/).map(row => row.trim()).filter(Boolean);
    if (!rows.length || rows.some(row => row.length > 200 || (!day.test(row)
      && !/^(?:hours\s*:\s*)?(?:open\s+)?(?:24\s*\/\s*7|24\s*hours(?:\s+(?:daily|a day))?|by appointment(?: only)?|appointment only|call for (?:hours|availability))[.!]?$/i.test(row)))) return "";
    if (!rows.every(row => time.test(row) || /\bclosed\b|24\s*\/\s*7|24\s*hours|\bby appointment\b|\bappointment only\b|\bcall for (?:hours|availability)\b/i.test(row))) return "";
    return raw;
  }
  function phone(value) {
    const raw = text(value);
    if (!/^[+\d(][\d\s().-]*(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?$/i.test(raw)) return "";
    const digits = raw.replace(/(?:ext\.?|x|#).*$/i, "").replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 ? raw : "";
  }
  function demoSource(value) {
    let path = text(value);
    try { path = decodeURIComponent(new URL(path, "https://audit.invalid").pathname); } catch { return true; }
    return /\/(?:dt_testimonials|testimonials?|reviews?)\/(?:john[-_ ]?doe|jane[-_ ]?doe|sample(?:[-_][^/]*)?|demo(?:[-_][^/]*)?|test(?:[-_][^/]*)?)(?:\/|$)/i.test(path);
  }
  function serviceLabel(value) {
    const raw = text(value);
    if (!raw || placeholder.test(raw) || /[<>{}=]|https?:\/\/|@|\.(?:webp|png|jpe?g|css|js)\b/i.test(raw)) return "";
    const name = raw.replace(/^(?:#{1,6}\s+|[-*\u2022\u25cf]\s+|\d+[.)]\s+)/, "").replace(/\s+/g, " ").replace(/[.:;]+$/, "").trim();
    if (name.length < 3 || name.length > 96 || name.split(/\s+/).length > 12 || (name.match(/,/g) || []).length >= 2) return "";
    if (/[▾▴▼▲⌄⌃›»]|\?$/.test(name) || /^why choose\b/i.test(name)
      || /\b(?:since|est\.?|established)\s+(?:18|19|20)\d{2}\b/i.test(name)) return "";
    // These are source navigation, staff roles and media titles, not offerings.
    if (/^(?:(?:senior|assistant|general|regional|office|maintenance|operations|project)\s+)*(?:director|manager|supervisor|president|founder|ceo|cfo|crew leader)\b/i.test(name)) return "";
    if (/^(?:meet (?:the|our) team|our team|giving back|careers?|join (?:the|our) team|what makes .{1,80} different)$/i.test(name)) return "";
    if (/\b(?:hubspot|youtube|vimeo)\s+video\b|\bservices? overview\b.*\bfull version\b/i.test(name)) return "";
    if (/^(?:our (?:team|company|crew|staff) (?:will|can)|overwhelmed by|are you |we (?:offer|provide|can|will))\b/i.test(name)) return "";
    if (/^[\p{L} .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/u.test(name)) return "";
    if (/^(?:coils|refrigerant issues|complete comfort systems|installations?|upgrades?|electrical|plumbing|heating|cooling)$/i.test(name)) return "";
    if (/^(?:selected\s*:|add a short note\b|start with the service\b|common service requests\b|one seamless way\b|(?:plumbing|electrical)\s+handled by\b|residential and commercial service throughout\b)/i.test(name)) return "";
    if (/\boffice\s*:|\b(?:optionalwhat is happening|company website)\b/i.test(name) || /\bcontractors?\s+(?:heating|cooling|electrical|plumbing)\b/i.test(name)) return "";
    if (/^(?:(?:our|all|main)\s+)?(?:services?|maintenance|repair|installation|replacement|products?|product categories|categories|commercial|residential|home|about(?: us)?|contact(?: us)?|reviews?|testimonials?|faqs?|frequently asked questions|service areas?|areas we serve|financing(?: available| options?)?|payment plans?|apply for financing|free estimates?|special offers?|coupons?|blog|news|resources?|community (?:links?|resources?)|(?:useful )?links?(?: for (?:your )?community)?|gallery|portfolio|our work|photos?|videos?|book(?: now)?|schedule(?: now| service)?|request (?:a )?(?:quote|estimate|service)|get in touch|privacy(?: policy)?|terms|sitemap)$/i.test(name)) return "";
    if (/^(?:(?:central|ductless|residential|commercial|gas|electric|smart|programmable|hybrid|memory foam|queen|king)\s+)*(?:air conditioners?|heat pumps?|furnaces?|thermostats?|air handlers?|equipment|parts|accessories|mattresses|furniture|sofas|sectionals|adjustable bases)$/i.test(name)) return "";
    return name;
  }
  const services = value => unique(list(value).map(serviceLabel).filter(Boolean)).slice(0, 24);
  function sameSource(anchor, candidate) {
    const left = website(anchor);
    const right = website(candidate);
    if (!left || !right || demoSource(candidate)) return false;
    try {
      const leftHost = new URL(left).hostname.toLowerCase().replace(/^www\./, "");
      const rightHost = new URL(right).hostname.toLowerCase().replace(/^www\./, "");
      const hostsMatch = leftHost === rightHost
        || leftHost.endsWith(`.${rightHost}`)
        || rightHost.endsWith(`.${leftHost}`);
      if (!hostsMatch) return false;
      const sharedHost = ["wixsite.com","square.site","notion.site","linktr.ee","bio.site","canva.site","youtube.com","tiktok.com"].find(host => leftHost === host || leftHost.endsWith(`.${host}`));
      if (!sharedHost) return true;
      if (sharedHost === "wixsite.com") {
        if (leftHost !== rightHost) return false;
        const leftTenant = tenantPathKey(sharedHost, new URL(left));
        const rightTenant = tenantPathKey(sharedHost, new URL(right));
        return Boolean(leftTenant && leftTenant === rightTenant);
      }
      // A tenant-specific subdomain is already an exact tenant boundary, even
      // when its canonical URL is `/`. Shared apex hosts still need a path key.
      if (leftHost !== sharedHost || rightHost !== sharedHost) return leftHost === rightHost;
      const leftTenant = tenantPathKey(sharedHost, new URL(left));
      const rightTenant = tenantPathKey(sharedHost, new URL(right));
      return Boolean(leftTenant && rightTenant && leftTenant === rightTenant);
    } catch {
      return false;
    }
  }
  function tenantPathKey(sharedHost, url) {
    const segments = String(url?.pathname || "").split("/").map(part => part.trim()).filter(Boolean);
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
  function observedService(observation, value) {
    if (!observation || observation.success === false || /^(?:failed|rejected)$/i.test(observation.status || "") || demoSource(observation.source || observation.url || "")) return false;
    const observed = services([observation.extracted?.exactServices, observation.extracted?.mainServices]);
    if (!observed.some(item => key(item) === key(value))) return false;
    const raw = text(observation.private_source?.markdown);
    if (!raw) return false; // A structured extraction cannot prove its own service claim.
    const visible = raw.replace(/<(?:script|style|template)\b[^>]*>[\s\S]*?<\/(?:script|style|template)>/gi, " ")
      .replace(/<(?:script|style|template)\b[^>]*>[\s\S]*$/gi, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/<[^>]*>/g, " ");
    let inProjectGallery = false;
    let inRequestForm = false;
    return visible.split(/\r?\n/).some(line => {
      const heading = line.replace(/^#{1,6}\s*/, "").trim();
      if (/^#{1,2}\s+/.test(line)) inRequestForm = /^request service$/i.test(heading);
      if (/^(?:real project work|(?:our )?(?:real |completed )?projects?|project gallery)$/i.test(heading)) inProjectGallery = true;
      if (/^genuine customer feedback$/i.test(heading)) inProjectGallery = false;
      return !inProjectGallery && !inRequestForm && !/\]\([^)]*[?&]service=|^\s*selected\s*:/i.test(line) && !placeholder.test(line)
        && !/\b(?:do(?:es)? not|don.t|no longer|not offer|not provide|not available|exclude[ds]?)\b/i.test(line)
        && (` ${key(line)} `).includes(` ${key(value)} `);
    });
  }
  // A structured extraction is a candidate, not independent proof.
  // Require matching visible first-party text for a public service claim.
  // Harvested labels are source candidates; publication still needs observedService.
  function sourceServiceCandidate(observation, value) {
    if (!serviceLabel(value) || !observation || observation.success === false
      || ["failed", "rejected"].includes(String(observation.status || "").toLowerCase())
      || demoSource(observation.source || observation.url || "")) return false;
    return services([observation.extracted?.exactServices, observation.extracted?.mainServices])
      .some(label => key(label) === key(value));
  }

  function sourceObservationService(observation, value) {
    if (!serviceLabel(value) || !observation || observation.success === false
      || /^(?:failed|rejected)$/i.test(observation.status || '')
      || demoSource(observation.source || observation.url || '')) return false;
    const labels = services([observation.extracted?.exactServices, observation.extracted?.mainServices]);
    if (!labels.some(label => key(label) === key(value))) return false;
    const raw = text(observation.private_source?.markdown);
    if (!raw || !(` ${key(raw)} `).includes(` ${key(value)} `)) return false;
    if (!observedService(observation, value)) return false;
    return raw.split(/\r?\n/).some(line => {
      const prose = line.replace(/\[[^\]]*\]\([^)]*\)/g, " ").replace(/^#{1,6}\s*/, " ").trim();
      return (` ${key(prose)} `).includes(` ${key(value)} `)
        && !/\b(?:do(?:es)? not|don.t|no longer|not offer|not provide|not available|exclude[ds]?)\b/i.test(prose)
        && /\b(?:install|build|repair|replace|maintain|provide|offer|perform|deliver|speciali[sz]e in|handle|serve|design|construct|clean|paint|restore|service)s?\b/i.test(prose);
    });
  }
  function privateValue(value) {
    const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
    if (/(?:bearer\s+\S+|(?:api[_-]?key|token|secret|password)["']?\s*[=:]|https?:\/\/[^/\s]+@|\bAIza[\w-]{20,}|\bsk-[\w-]{12,})/i.test(raw)) return "[credential-shaped value withheld]";
    return raw.slice(0, 12000);
  }
  function facts(input = {}) {
    const data = { ...input }, issues = [], rejected = [];
    const checks = { email, contactEmail: email, domainUrl: website, websiteUrl: website, website,
      gbpPlaceId: placeId, googlePlaceId: placeId, placeId, place_id: placeId,
      phone, finalPhone: phone, smsNumber: phone, hours };
    for (const [field, check] of Object.entries(checks)) {
      if (input[field] == null || input[field] === "") continue;
      const clean = check(input[field]); data[field] = clean;
      if (field === "hours" && !clean) data.hoursSource = "";
      if (!clean) { issues.push({ field, rule: `invalid_${field}`, severity: "block" }); rejected.push({ field, value: privateValue(input[field]) }); }
    }
    for (const field of ["businessName", "brandName", "address"]) {
      const value = text(input[field]);
      if (value && (placeholder.test(value) || /^(?:your (?:business|company)(?: name)?|company name|shown|hidden|unknown|not provided|website)$/i.test(value)
        || (field === "address" && /@|https?:\/\/|\.(?:webp|png|jpe?g)\b/i.test(value)))) {
        data[field] = ""; issues.push({ field, rule: `invalid_${field}`, severity: "block" });
        rejected.push({ field, value: privateValue(value) });
      }
    }
    return { data, issues, rejected };
  }
  function copyIssues(value, expected = {}) {
    const raw = text(value), issues = [];
    if (placeholder.test(raw) || /\b(?:your company|your business|address here|email here)\b/i.test(raw)) issues.push("placeholder_text");
    for (const candidate of raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []) {
      if (!email(candidate)) { issues.push("invalid_contact_email_in_copy"); break; }
      if (email(expected.email) && email(candidate).toLowerCase() !== email(expected.email).toLowerCase()) issues.push("unbound_contact_email_in_copy");
    }
    for (const candidate of raw.match(/https?:\/\/[^\s<>"')\]]+/gi) || []) {
      if (!website(candidate.replace(/[.,;]+$/, ""))) { issues.push("invalid_domain_in_copy"); break; }
    }
    for (const match of raw.matchAll(/\b(?:gbpPlaceId|place[_ -]?id|query_place_id|destination_place_id|placeid)\s*[:=]\s*([^&\s<>"')]+)/gi)) {
      try { if (!placeId(decodeURIComponent(match[1]))) issues.push("invalid_place_id_in_copy"); }
      catch { issues.push("invalid_place_id_in_copy"); }
    }
    for (const match of raw.matchAll(/\b(?:phone|call|text|telephone)\s*:?\s*((?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4})/gi)) {
      const selected = phone(expected.phone || expected.smsNumber);
      const normalize = number => number.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (selected && normalize(match[1]) !== normalize(selected)) issues.push("unbound_phone_in_copy");
    }
    return [...new Set(issues)];
  }
  function markets(data = {}) {
    const explicit = [text(data.city), text(data.state)].filter(Boolean).join(", ");
    const raw = explicit || text(data.serviceArea);
    const parts = [];
    for (const region of raw.split(/\r?\n|;|\s*\|\s*|\s+and\s+/i)) {
      const tokens = region.split(",").map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < tokens.length; i += 1) {
        if (/^[A-Z]{2}(?: \d{5})?$/.test(tokens[i + 1] || "")) parts.push(`${tokens[i]}, ${tokens[++i]}`);
        else if (!/^[A-Z]{2}$/.test(tokens[i])) parts.push(tokens[i]);
      }
    }
    return unique(parts.filter(s => s.length <= 80 && s.split(/\s+/).length <= 8 && !placeholder.test(s) && /^[\p{L}][\p{L} .'-]*(?:, [A-Z]{2}(?: \d{5})?)?$/u.test(s) && !/\b(?:serving|surrounding|nearby|local area)\b/i.test(s))).slice(0, 12);
  }
  function queryTargets(data = {}, labels = []) {
    const market = markets(data)[0] || "";
    if (!market) return [];
    return services(labels).slice(0, 6).map(label => key(label).includes(key(market)) ? label : `${label} ${market}`);
  }
  return Object.freeze({ version, placeholder, key, list, services, serviceLabel, website, email, emailFromText, placeId, phone, hours, demoSource, sameSource, observedService, sourceServiceCandidate, sourceObservationService, privateValue, facts, copyIssues, markets, queryTargets });
}
module.exports.intakeQuality = intakeQuality;
