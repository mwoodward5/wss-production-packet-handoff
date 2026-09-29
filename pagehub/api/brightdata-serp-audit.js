module.exports.config = {
  maxDuration: 120
};

const { requireProviderRouteAuth } = require("./lib/provider-route-auth");

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
    const packet = body.packet || {};
    const data = { ...(packet.business || {}), ...(packet.brand || {}), ...(packet.requirements || {}) };
    const searchPlan = packet.compiled?.searchOptimizationPlan || buildSearchOptimizationPlan(packet, data);
    const apiKey = process.env.BRIGHTDATA_SERP_API_KEY || process.env.BRIGHTDATA_API_KEY || "";
    const zone = process.env.BRIGHTDATA_SERP_ZONE || "serp_api3";
    const endpoint = process.env.BRIGHTDATA_SERP_ENDPOINT || "https://api.brightdata.com/request";
    const dryRun = body.dryRun === true;
    const queryPlan = buildBrightDataQueryPlan(packet, data, searchPlan, {
      maxQueries: body.maxQueries,
      country: body.country,
      language: body.language,
      zone,
      endpoint
    });

    if (!apiKey || dryRun) {
      return res.status(200).json({
        ok: true,
        configured: Boolean(apiKey),
        audit: buildAuditShell(packet, searchPlan, queryPlan, {
          status: apiKey ? "dry_run" : "not_configured",
          note: apiKey
            ? "Dry run returned the Bright Data query plan without spending SERP requests."
            : "Bright Data is not configured. Add BRIGHTDATA_SERP_API_KEY in WSS to run live SERP audits.",
          zone,
          endpoint
        })
      });
    }

    const queries = [];
    for (const query of queryPlan.queries) {
      const startedAt = Date.now();
      try {
        // The SERP API intermittently answers HTTP 200 with an EMPTY body
        // (measured 2-of-3 on 2026-09-20); one bounded retry per query turns
        // that flake into a reliable audit without multiplying spend — the
        // empty responses are not billed.
        let response;
        let html = "";
        for (let attempt = 0; attempt < 3 && !html.trim(); attempt += 1) {
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              zone,
              url: query.googleUrl,
              format: "raw"
            })
          });
          html = await response.text();
        }
        // The live zone family returns Bright Data's parsed SERP JSON
        // (general/organic/snack_pack...); legacy unblocker zones return raw
        // Google HTML. Accept both: same audit shape either way.
        const parsed = looksLikeSerpJson(html)
          ? parseSerpJson(html, query)
          : parseGoogleSerpHtml(html, query);
        queries.push({
          ...query,
          status: response.ok ? "pass" : "review",
          httpStatus: response.status,
          elapsedMs: Date.now() - startedAt,
          resultCount: parsed.organicResults.length,
          organicResults: parsed.organicResults,
          questionIdeas: parsed.questionIdeas,
          titlePatterns: parsed.titlePatterns,
          bodySignals: parsed.bodySignals,
          error: response.ok ? "" : html.slice(0, 240)
        });
      } catch (error) {
        queries.push({
          ...query,
          status: "error",
          elapsedMs: Date.now() - startedAt,
          resultCount: 0,
          organicResults: [],
          questionIdeas: [],
          titlePatterns: [],
          bodySignals: [],
          error: error.message || "Bright Data request failed."
        });
      }
    }

    const audit = buildAuditFromResults(packet, searchPlan, queryPlan, queries, { zone, endpoint });
    return res.status(200).json({ ok: true, configured: true, audit });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Bright Data audit failed." });
  }
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const allowed = /^https:\/\/(pagehub-intake\.wss-ai\.com|pagehub-intake-lock-form\.vercel\.app|[\w-]+\.lovable\.app|[\w-]+\.lovableproject\.com)$/i.test(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin);
  res.setHeader("Access-Control-Allow-Origin", allowed ? origin : "https://pagehub-intake-lock-form.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

function buildBrightDataQueryPlan(packet, data, searchPlan, options = {}) {
  const maxQueries = Math.max(1, Math.min(Number(options.maxQueries) || 6, 10));
  const country = String(options.country || data.country || "us").toLowerCase();
  const language = String(options.language || data.language || "en").toLowerCase();
  const market = firstLine(data.serviceArea) || firstLine(data.address) || "local area";
  const targets = unique([
    searchPlan.primaryKeyword,
    ...(searchPlan.secondaryKeywords || []),
    ...splitLines(data.marketingPlan).filter(line => !/^[-#]/.test(line)).slice(0, 8)
  ]).filter(Boolean);
  const queries = targets.slice(0, maxQueries).map((keyword, index) => {
    const q = withMarket(keyword, market);
    return {
      id: `serp-${index + 1}`,
      keyword,
      query: q,
      intent: index === 0 ? "primary local authority" : inferIntent(keyword),
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent(q)}&num=10&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country)}&pws=0`,
      expectedUse: [
        "title and H1/H2 calibration",
        "service coverage and content gap scan",
        "FAQ and voice-search extraction",
        "schema/internal-link/CTA planning"
      ]
    };
  });
  return {
    version: "brightdata-serp-query-plan-v1",
    generatedAt: new Date().toISOString(),
    provider: "Bright Data Direct API",
    endpoint: options.endpoint || process.env.BRIGHTDATA_SERP_ENDPOINT || "https://api.brightdata.com/request",
    zone: options.zone || process.env.BRIGHTDATA_SERP_ZONE || "serp_api3",
    format: "raw",
    defaultCountry: country,
    defaultLanguage: language,
    maxQueries,
    costGuard: "Default cap is 6 live SERP requests per packet; hard cap is 10 unless code is changed.",
    queries
  };
}

function buildAuditShell(packet, searchPlan, queryPlan, config) {
  return {
    version: "brightdata-serp-audit-v1",
    status: config.status,
    generatedAt: new Date().toISOString(),
    businessName: packet.business?.businessName || packet.packetName || "",
    primaryKeyword: searchPlan.primaryKeyword || "",
    provider: "Bright Data Direct API",
    endpoint: config.endpoint,
    zone: config.zone,
    responseFormat: "raw",
    credentialPolicy: "Server-side only. Do not expose API keys, proxy passwords, or native proxy credentials in WSS prompts or public code.",
    note: config.note,
    queryPlan,
    queries: [],
    aggregate: emptyAggregate(searchPlan),
    firstPassRecommendations: firstPassRecommendations(searchPlan, emptyAggregate(searchPlan), [], queryPlan)
  };
}

function buildAuditFromResults(packet, searchPlan, queryPlan, queries, config) {
  const domains = countBy(queries.flatMap(query => query.organicResults.map(result => result.domain).filter(Boolean)));
  const titlePatterns = unique(queries.flatMap(query => query.titlePatterns || [])).slice(0, 30);
  const questionIdeas = unique([
    ...queries.flatMap(query => query.questionIdeas || []),
    ...(searchPlan.voiceSearch?.questions || [])
  ]).slice(0, 32);
  const bodySignals = countBy(queries.flatMap(query => query.bodySignals || []));
  const aggregate = {
    topCompetitorDomains: Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([domain, count]) => ({ domain, count })),
    titlePatterns,
    questionIdeas,
    contentGaps: contentGaps(searchPlan, titlePatterns, bodySignals),
    schemaPriorities: ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
    internalLinkPriorities: internalLinkPriorities(searchPlan),
    ctaPriorities: ["call", "estimate/contact form", "directions/map", "source-backed reviews", "service-area proof"]
  };
  return {
    version: "brightdata-serp-audit-v1",
    status: queries.some(query => query.status === "pass") ? "compiled" : "review",
    generatedAt: new Date().toISOString(),
    businessName: packet.business?.businessName || packet.packetName || "",
    primaryKeyword: searchPlan.primaryKeyword || "",
    provider: "Bright Data Direct API",
    endpoint: config.endpoint,
    zone: config.zone,
    responseFormat: "raw",
    credentialPolicy: "Server-side only. Do not expose API keys, proxy passwords, or native proxy credentials in WSS prompts or public code.",
    queryPlan,
    queries,
    aggregate,
    firstPassRecommendations: firstPassRecommendations(searchPlan, aggregate, queries, queryPlan)
  };
}

function looksLikeSerpJson(text) {
  const trimmed = String(text || "").trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    const probe = JSON.parse(trimmed);
    return probe && typeof probe === "object" && Array.isArray(probe.organic);
  } catch {
    return false;
  }
}

function parseSerpJson(text, query) {
  const data = JSON.parse(String(text || "{}"));
  const organic = Array.isArray(data.organic) ? data.organic : [];
  // SERP-API JSON rows carry `link` (a Google redirect) plus the truthful
  // `display_link`; prefer display_link for both URL and domain.
  const organicResults = organic.slice(0, 10).map((row, index) => {
    const display = String(row.display_link || row.link || row.url || "");
    const url = /^https?:\/\//.test(display) ? display : "";
    return {
      position: Number(row.pos) || index + 1,
      url,
      domain: domainOf(display || ""),
      title: decodeHtml(String(row.title || row.source || "")),
      description: decodeHtml(String(row.description || row.snippet || ""))
    };
  }).filter((row) => row.title || row.url);
  const titlePatterns = unique(organicResults.map((row) => row.title)).filter(Boolean).slice(0, 18);
  const related = Array.isArray(data.related_searches)
    ? data.related_searches.map((row) => String(row?.text || row?.query || row || "")).filter(Boolean)
    : [];
  const peopleAlsoAsk = Array.isArray(data.people_also_ask)
    ? data.people_also_ask.map((row) => String(row?.question || row?.text || "")).filter(Boolean)
    : [];
  const paas = Array.isArray(data.paa) ? data.paa.map((row) => String(row?.question || "")).filter(Boolean) : [];
  const questionIdeas = unique([...related, ...peopleAlsoAsk, ...paas]).slice(0, 18);
  const bodyText = organicResults.map((row) => `${row.title} ${row.description}`).join(" ").replace(/\s+/g, " ").trim();
  return {
    organicResults,
    titlePatterns,
    questionIdeas,
    bodySignals: bodySignalPhrases(bodyText)
  };
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function parseGoogleSerpHtml(html, query) {
  const clean = String(html || "");
  const organicResults = extractOrganicResults(clean).slice(0, 10);
  const bodyText = decodeHtml(clean
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  const titlePatterns = unique([
    ...organicResults.map(result => result.title),
    ...Array.from(clean.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)).map(match => stripTags(match[1]))
  ]).filter(Boolean).slice(0, 18);
  const questionIdeas = extractQuestions(bodyText, query.query).slice(0, 18);
  return {
    organicResults,
    titlePatterns,
    questionIdeas,
    bodySignals: bodySignalPhrases(bodyText)
  };
}

function extractOrganicResults(html) {
  const results = [];
  const patterns = [
    /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi,
    /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi
  ];
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) && results.length < 20) {
      const url = decodeURIComponent(match[1] || "").split("&")[0];
      if (!/^https?:\/\//i.test(url) || /google\./i.test(url)) continue;
      const title = stripTags(match[2]);
      if (!title || results.some(item => item.url === url)) continue;
      results.push({
        title,
        url,
        domain: domainFromUrl(url)
      });
    }
  });
  return results;
}

function extractQuestions(text, seed) {
  const questions = [];
  const query = String(seed || "").replace(/\s+/g, " ").trim();
  const regex = /([A-Z][^?.!]{18,140}\?)/g;
  let match;
  while ((match = regex.exec(text)) && questions.length < 40) {
    const question = match[1].replace(/\s+/g, " ").trim();
    if (!/^(People also ask|Related searches)$/i.test(question)) questions.push(question);
  }
  const generated = [
    `How do I choose ${query}?`,
    `Who offers ${query}?`,
    `What should I ask before hiring for ${query}?`,
    `How soon can I request ${query}?`
  ];
  return unique([...questions, ...generated]);
}

function bodySignalPhrases(text) {
  const haystack = String(text || "").toLowerCase();
  const signals = [
    "free estimate", "emergency", "same day", "licensed", "insured", "reviews", "financing",
    "near me", "service area", "warranty", "inspection", "repair", "installation", "maintenance",
    "gallery", "before and after", "local", "family owned", "commercial", "residential"
  ];
  return signals.filter(signal => haystack.includes(signal));
}

function contentGaps(searchPlan, titlePatterns, bodySignals) {
  const text = `${titlePatterns.join(" ")} ${Object.keys(bodySignals || {}).join(" ")}`.toLowerCase();
  const gaps = [];
  if (/inspection|inspect/.test(text)) gaps.push("Add a clear inspection/process section and FAQ coverage.");
  if (/repair|emergency|leak/.test(text)) gaps.push("Add urgent repair triage copy with phone CTA and source-supported response language.");
  if (/cost|price|estimate/.test(text)) gaps.push("Add estimate/cost-expectation copy without inventing prices.");
  if (/reviews|rating/.test(text)) gaps.push("Add source-supported review/proof module; do not invent AggregateRating.");
  if (/near me|local|service area/.test(text)) gaps.push("Add service-area entity coverage and internal links from services to local pages.");
  if (!gaps.length) gaps.push("Use SERP titles to tighten page titles, H1s, FAQs, and conversion CTAs.");
  return unique(gaps).slice(0, 10);
}

function internalLinkPriorities(searchPlan) {
  const pages = searchPlan.pageTargets || [];
  return pages.slice(0, 10).map(page => ({
    from: page.slug || "home",
    to: "contact",
    anchor: "request an estimate",
    reason: `Keep ${page.targetKeyword || page.page} connected to conversion.`
  }));
}

function firstPassRecommendations(searchPlan, aggregate = {}, queries = [], queryPlan = {}) {
  const titlePatterns = aggregate.titlePatterns || [];
  const liveQueryCount = (queries || []).length;
  const plannedQueryCount = (queryPlan?.queries || []).length;
  return {
    pageTitles: (searchPlan.pageTargets || []).slice(0, 10).map(page => ({
      page: page.page,
      slug: page.slug,
      titleTarget: `${page.targetKeyword || page.page} | ${searchPlan.businessName || "Local Service"}`.slice(0, 68),
      h1Target: page.targetKeyword || page.page
    })),
    h2Themes: unique([
      "Local proof and service area coverage",
      "Process and what to expect",
      "Source-supported trust/proof",
      "FAQ answers for voice and generative search",
      ...titlePatterns.slice(0, 6)
    ]).slice(0, 12),
    faqIdeas: unique([...(aggregate.questionIdeas || []), ...(searchPlan.voiceSearch?.questions || [])]).slice(0, 16),
    schema: ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
    qaGates: [
      "No competitor text copied.",
      "SERP findings are translated into original titles, H2s, FAQs, schema, internal links, and CTAs.",
      "Unsupported claims from competitor pages are not added.",
      "Primary and secondary targets map to crawlable pages."
    ],
    liveQueryCount,
    plannedQueryCount,
    queryCount: liveQueryCount || plannedQueryCount
  };
}

function buildSearchOptimizationPlan(packet, data) {
  const services = unique(splitLines(data.exactServices, data.mainServices)).slice(0, 18);
  const localModifiers = unique(splitLines(data.serviceArea, data.address).map(item => item.replace(/\b(united states|usa)\b/ig, "").trim()).filter(Boolean)).slice(0, 12);
  const market = localModifiers[0] || data.serviceArea || "local service area";
  const explicitTargets = unique(splitLines(data.primaryKeyword, data.seoTargets, data.searchTerms, data.marketingKeywords, data.marketingPlan));
  const primaryKeyword = explicitTargets[0] || withMarket(services[0] || data.businessName || "local service", market);
  const secondaryKeywords = unique([
    ...explicitTargets.slice(1),
    ...services.slice(0, 12).map(service => withMarket(service, market)),
    ...services.slice(0, 8)
  ]).filter(term => term.toLowerCase() !== String(primaryKeyword).toLowerCase()).slice(0, 24);
  return {
    primaryKeyword,
    secondaryKeywords,
    localModifiers,
    pageTargets: (packet.pagePlan || []).map((page, index) => ({
      page: page.title || (index === 0 ? "Home" : `Page ${index + 1}`),
      slug: page.slug || "",
      targetKeyword: index === 0 ? primaryKeyword : (secondaryKeywords[index - 1] || page.title || primaryKeyword)
    })),
    voiceSearch: {
      questions: [
        `Who offers ${primaryKeyword}?`,
        `What should I know before requesting ${primaryKeyword}?`,
        `How do I contact ${data.businessName || "this local business"}?`
      ]
    }
  };
}

function emptyAggregate(searchPlan) {
  return {
    topCompetitorDomains: [],
    titlePatterns: [],
    questionIdeas: searchPlan.voiceSearch?.questions || [],
    contentGaps: ["Run the live Bright Data audit or use this query plan before build."],
    schemaPriorities: ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
    internalLinkPriorities: internalLinkPriorities(searchPlan),
    ctaPriorities: ["call", "estimate/contact form", "directions/map", "source-backed reviews"]
  };
}

function withMarket(keyword, market) {
  const clean = String(keyword || "").replace(/\s+/g, " ").trim();
  const area = String(market || "").replace(/\s+/g, " ").trim();
  if (!clean || !area || area === "local area") return clean;
  const firstArea = area.split(/[,;|]/)[0].trim();
  if (!firstArea || new RegExp(`\\b${escapeRegExp(firstArea)}\\b`, "i").test(clean)) return clean;
  return `${clean} ${firstArea}`;
}

function inferIntent(keyword) {
  const value = String(keyword || "").toLowerCase();
  if (/near me|city|area|county|service area/.test(value)) return "local/service-area";
  if (/repair|emergency|leak|fix/.test(value)) return "urgent repair";
  if (/cost|price|financ|payment/.test(value)) return "commercial investigation";
  if (/review|best|top/.test(value)) return "trust comparison";
  return "service authority";
}

function firstLine(value) {
  return splitLines(value)[0] || "";
}

function splitLines(...values) {
  const lines = [];
  values.forEach(value => {
    String(value || "")
      .split(/\r?\n|;\s*|,\s*/)
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .forEach(line => {
        if (!lines.some(item => item.toLowerCase() === line.toLowerCase())) lines.push(line);
      });
  });
  return lines;
}

function unique(items = []) {
  const seen = new Set();
  return (items || []).flat(Infinity).map(item => String(item || "").trim()).filter(item => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(items = []) {
  return items.reduce((acc, item) => {
    const key = String(item || "").trim();
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
