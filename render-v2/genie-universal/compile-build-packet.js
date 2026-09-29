const { createHash } = require("node:crypto");
const { intakeQuality } = require("./firecrawl-intake");
const { archiveSourcePages } = require("./lib/source-page-archive");
const { buildSourceEditorialWorklist } = require("./lib/source-editorial-worklist");
const { requireProviderRouteAuth } = require("./lib/provider-route-auth");
const authenticatedHarvestPackets = new WeakSet();

// The URL-first server route calls this after its own harvest. The public
// compile endpoint only calls compilePacket, so request JSON cannot set trust.
function compileAuthenticatedHarvestPacket(packet) {
  authenticatedHarvestPackets.add(packet);
  try { return compilePacket(packet); }
  finally { authenticatedHarvestPackets.delete(packet); }
}

module.exports.config = {
  maxDuration: 120
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
    let packet = body.packet || {};
    if (!packet || typeof packet !== "object") {
      return res.status(400).json({ ok: false, error: "A packet object is required." });
    }

    // Older studio drafts retain URLs but discard raw observations. Deepen
    // those imports here; the UI keeps its existing endpoint/response shape.
    const urls = Array.isArray(packet.sources?.urls) ? packet.sources.urls : [];
    if (urls.length && !packet.sources?.observations?.length) {
      const harvest = await require('./firecrawl-intake').harvestSources({ urls });
      packet = { ...packet, sources: { ...packet.sources, urls: harvest.sources,
        observations: harvest.observations, coverage: harvest.coverage, extracted: harvest.extracted } };
    }
    const enriched = compilePacket(withBrandFonts(packet));
    return res.status(200).json({ ok: true, packet: enriched });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Compile failed." });
  }
};

function withBrandFonts(packet) {
  const brand = packet.brand && typeof packet.brand === "object" ? packet.brand : {};
  const fonts = brand.fonts && typeof brand.fonts === "object" ? brand.fonts : {};
  return {
    ...packet,
    brand: {
      ...brand,
      fonts: {
        display: String(fonts.display || ""),
        body: String(fonts.body || ""),
        href: String(fonts.href || "")
      }
    }
  };
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const allowed = /^https:\/\/(pagehub-intake\.wss-ai\.com|pagehub-intake-lock-form\.vercel\.app|[\w-]+\.lovable\.app|[\w-]+\.lovableproject\.com)$/i.test(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin);
  res.setHeader("Access-Control-Allow-Origin", allowed ? origin : "https://pagehub-intake-lock-form.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

const MAP_SDK_MAP_ID = "afb5ab7fb2ea17cb79d4ad48";
const MAP_SDK_CONNECTOR_ENV = "VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY";
const MAP_SDK_CONNECTOR_NAME = "WSS Agency - Maps (Custom)";
const KNOWN_CITY_COORDS = {
  "Anchorage, AK": { lat: 61.2176, lng: -149.8997 },
  "Eagle River, AK": { lat: 61.3214, lng: -149.5678 },
  "Girdwood, AK": { lat: 60.9425, lng: -149.1664 },
  "Chugiak, AK": { lat: 61.3870, lng: -149.4818 },
  "Wasilla, AK": { lat: 61.5809, lng: -149.4415 },
  "Palmer, AK": { lat: 61.5994, lng: -149.1128 },
  "Clarksville, TN": { lat: 36.5298, lng: -87.3595 },
  "Nashville, TN": { lat: 36.1627, lng: -86.7816 },
  "Hendersonville, TN": { lat: 36.3048, lng: -86.6200 },
  "Gallatin, TN": { lat: 36.3884, lng: -86.4467 },
  "Springfield, TN": { lat: 36.5092, lng: -86.8850 },
  "Emory, TX": { lat: 32.8746, lng: -95.7655 },
  "Greenville, TX": { lat: 33.1384, lng: -96.1108 },
  "Sulphur Springs, TX": { lat: 33.1384, lng: -95.6011 },
  "Canton, TX": { lat: 32.5565, lng: -95.8633 },
  "Van, TX": { lat: 32.5243, lng: -95.6372 },
  "Mineola, TX": { lat: 32.6632, lng: -95.4883 },
  "Easley, SC": { lat: 34.8298, lng: -82.6015 },
  "Greenville, SC": { lat: 34.8526, lng: -82.3940 },
  "Pickens, SC": { lat: 34.8834, lng: -82.7074 },
  "Anderson, SC": { lat: 34.5034, lng: -82.6501 },
  "Spartanburg, SC": { lat: 34.9496, lng: -81.9320 }
};

function verifiedPacketProof(packet = {}) {
  const emptyTrust = { certifications: [], licenses: [], insurance: [], partnerships: [], awards: [],
    yearsInBusiness: "", notes: [], unsupportedClaimsPolicy: "Do not invent licenses, warranties, years in business, insurance, financing, or review counts." };
  const emptyReviews = { aggregate: {}, items: [], note: "No verified reviews were provided in the intake packet." };
  const observations = Array.isArray(packet.sources?.observations) ? packet.sources.observations : [];
  const evidence = Array.isArray(packet.sources?.proofEvidence) ? packet.sources.proofEvidence : [];
  const oldTrust = packet.compiled?.trust || {};
  const oldReviews = packet.compiled?.reviews || {};
  const claims = [...evidence,
    ...["certifications", "licenses", "insurance", "partnerships", "awards"].flatMap(field =>
      (Array.isArray(oldTrust[field]) ? oldTrust[field] : []).map(row =>
        row && typeof row === "object" && !Array.isArray(row) ? { ...row, kind: row.kind || field } : null).filter(Boolean)),
    ...(Array.isArray(oldReviews.items) ? oldReviews.items.map(row =>
      row && typeof row === "object" && !Array.isArray(row) ? { ...row, kind: "review" } : null).filter(Boolean) : [])];
  const trust = { ...emptyTrust }, reviews = { ...emptyReviews };
  const sourceLine = row => {
    const sourceUrl = intakeQuality.website(row?.sourceUrl || row?.source_url || "");
    if (!sourceUrl) return "";
    const observation = observations.find(obs => obs.status !== "failed" && obs.status !== "rejected"
      && intakeQuality.website(obs.source || obs.url) === sourceUrl && !intakeQuality.demoSource(sourceUrl));
    const raw = String(observation?.private_source?.markdown || "");
    if (!raw || raw.length > 1024 * 1024) return "";
    const claim = String(row.value || row.label || row.text || "").trim();
    if (!claim || claim.length > 500 || intakeQuality.placeholder.test(claim)) return "";
    return raw.split(/\r?\n/).find(line => line.length <= 500
      && !/\]\([^)]*[?&]service=|^\s*Selected\s*:|^\s*Add a short note/i.test(line)
      && line.toLowerCase().includes(claim.toLowerCase())) || "";
  };
  for (const row of claims) {
    if (!row || typeof row !== "object") continue;
    const kind = String(row.kind || row.type || "").toLowerCase();
    const line = sourceLine(row);
    if (!line) continue;
    const sourceUrl = intakeQuality.website(row.sourceUrl || row.source_url);
    const value = String(row.value || row.label || "").trim();
    if (kind === "review") {
      const reviewText = String(row.text || "").trim();
      const author = String(row.author || "").trim();
      if (reviewText.length < 12 || reviewText.length > 500 || !author || author.length > 80
        || !line.toLowerCase().includes(author.toLowerCase())) continue;
      if (!reviews.items.some(item => item.text === reviewText && item.sourceUrl === sourceUrl))
        reviews.items.push({ text: reviewText, author, sourceUrl });
    } else if (Object.hasOwn(trust, kind) && Array.isArray(trust[kind])) {
      if (value.length < 5 || value.length > 160 || /\b(?:request service|office:|testimonial|reviews?|\b24\/7\b)\b/i.test(value)) continue;
      if (kind === "certifications" && !/\bcertif(?:ied|ication|icate)\b/i.test(value)) continue;
      if (kind === "licenses" && !/\b(?:licen[cs]e|registration)\b/i.test(value)) continue;
      if (!trust[kind].some(item => item.value === value && item.sourceUrl === sourceUrl))
        trust[kind].push({ value, sourceUrl });
    }
  }
  const aggregate = oldReviews.aggregate || {};
  const line = sourceLine({ ...aggregate, value: aggregate.evidenceText });
  const rating = Number(aggregate.rating), count = Number(aggregate.count);
  if (line && Number.isFinite(rating) && rating >= 1 && rating <= 5
    && Number.isInteger(count) && count > 0
    && line.includes(String(rating)) && line.includes(String(count))
    && /\b(?:reviews?|ratings?)\b/i.test(line)) {
    reviews.aggregate = { rating, count, evidenceText: String(aggregate.evidenceText).trim(),
      sourceUrl: intakeQuality.website(aggregate.sourceUrl || aggregate.source_url) };
  }
  return { trust, reviews };
}

function unverifiedProofNote(value) {
  const note = String(value || "");
  return !/^\s*Do not\b/i.test(note)
    && /\b(?:licen[cs](?:e|ed|ing)?|certif(?:ied|ication|icate)|insured|bonded|rating|reviews?|testimonials?|awards?)\b/i.test(note);
}

function singlePageContract(packet = {}) {
  const id = String(packet.selectedTemplateId || packet.requirements?.selectedTemplateId || "").toLowerCase();
  if (id && id !== "auto") return /^single-/.test(id) || /single/i.test(packet.templateFamily || "");
  return /single|scroll|one[-\s]?page/i.test(String(packet.templateFamily || "") + " " +
    String(packet.requirements?.siteType || "") + " " + String(packet.selectedBuildLane || ""));
}

function safeLogoCandidate(value) {
  const raw = typeof value === "string" ? value : value?.url || value?.src || "";
  if (!raw || /[\s<>{}"'\\]/.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password
      || /[\s<>{}#]/.test(decodeURIComponent(url.pathname))
      || !/\.(?:svg|png|jpe?g|webp|avif)$/i.test(url.pathname)
      || /(?:api[_-]?key|access[_-]?token|secret|signature|sig)=/i.test(url.search)) return "";
    return url.href;
  } catch { return ""; }
}

function safeSelectedEditorial(value) {
  return String(value || "").split(/\r?\n/).map(line => line.trim())
    .filter(line => line && line.length <= 500
      && !/[{}[\]\\]/.test(line)
      && !/"[a-z][a-z_-]+"\s*:/i.test(line)
      && !/<(?:script|style)\b/i.test(line))
    .join("\n");
}

function prepareQualityPacket(input = {}) {
  const packet = { ...input, business: { ...(input.business || {}) }, brand: { ...(input.brand || {}) },
    requirements: { ...(input.requirements || {}) }, goldenArtifacts: { ...(input.goldenArtifacts || {}) },
    sources: { ...(input.sources || {}) }, review: { ...(input.review || {}) } };
  if (authenticatedHarvestPackets.has(input)) authenticatedHarvestPackets.add(packet);
  const previousIssues = input.review?.intakeQuality?.issues || [];
  // Re-evaluate selection findings against this compile; retain the old findings privately.
  const recomputedIssue = row => row.scope !== "private_source"
    && (row.rule === "invalid_hours" || row.rule === "unaccepted_service_labels"
      || (row.rule === "malformed_logo_withheld" && row.scope === "asset_selection"));
  const supersededIssues = previousIssues.filter(recomputedIssue);
  const issues = previousIssues.filter(row => !recomputedIssue(row)), rejected = [];
  for (const section of ["business", "brand", "requirements"]) {
    const checked = intakeQuality.facts(packet[section]);
    packet[section] = checked.data;
    issues.push(...checked.issues);
    rejected.push(...checked.rejected.map(row => ({ ...row, section })));
    for (const field of ["protectedArtifacts", "mustInclude", "reviewsProof"]) {
      const raw = String(packet[section][field] || "");
      if (!intakeQuality.placeholder.test(raw) && !/\/dt_testimonials\/(?:john-doe|jane-doe|demo|sample)\b/i.test(raw)) continue;
      packet[section][field] = "";
      issues.push({ field, rule: "template_claim_withheld", severity: "review" });
      rejected.push({ section, field, value: intakeQuality.privateValue(raw) });
    }
  }
  for (const [section, field] of [["business", "protectedArtifacts"], ["requirements", "mustInclude"]]) {
    const raw = packet[section][field];
    if (!raw) continue;
    const clean = safeSelectedEditorial(raw);
    if (clean === raw) continue;
    packet[section][field] = clean;
    issues.push({ field, rule: "machine_fragment_withheld", severity: "review", scope: "editorial_selection" });
    rejected.push({ section, field, value: intakeQuality.privateValue(raw) });
  }
  const rawNotes = intakeQuality.list(packet.goldenArtifacts.protectedNotes);
  packet.goldenArtifacts.protectedNotes = rawNotes.filter(note => {
    const unverifiedProof = unverifiedProofNote(note);
    const rejectedNote = unverifiedProof || intakeQuality.placeholder.test(note) || /\/dt_testimonials\/(?:john-doe|jane-doe|demo|sample)\b/i.test(note);
    if (rejectedNote) {
      issues.push({ field: "protectedNotes", rule: unverifiedProof ? "unverified_proof_note" : "template_claim_withheld",
        severity: "review", scope: unverifiedProof ? "proof_selection" : undefined });
      rejected.push({ section: "goldenArtifacts", field: "protectedNotes", value: intakeQuality.privateValue(note) });
    }
    return !rejectedNote;
  });
  const observations = Array.isArray(packet.sources.observations) ? packet.sources.observations : [];
  for (const observation of observations) {
    for (const issue of observation.private_source?.quality_review?.issues || []) {
      if (typeof issue?.rule !== "string") continue;
      issues.push({ field: String(issue.field || "source"), rule: issue.rule,
        severity: issue.severity === "block" ? "block" : "review", scope: "private_source",
        source: String(observation.source || "") });
    }
  }
  for (const [section, field] of [["brand", "logoLink"]]) {
    const raw = packet[section][field];
    if (raw && !safeLogoCandidate(raw)) {
      packet[section][field] = "";
      issues.push({ field, rule: "malformed_logo_withheld", severity: "review", scope: "asset_selection" });
      rejected.push({ section, field, value: intakeQuality.privateValue(raw) });
    }
  }
  if (Array.isArray(packet.assetQa?.logoCandidates)) {
    const retained = packet.assetQa.logoCandidates.filter(safeLogoCandidate);
    if (retained.length !== packet.assetQa.logoCandidates.length) {
      rejected.push({ section: "assetQa", field: "logoCandidates", rule: "malformed_logo_candidate",
        value: intakeQuality.privateValue(packet.assetQa.logoCandidates.filter(value => !safeLogoCandidate(value))) });
    }
    packet.assetQa = { ...packet.assetQa, logoCandidates: retained };
  }
  const rawServices = intakeQuality.list([packet.business.exactServices, packet.business.mainServices,
    packet.goldenArtifacts.exactServices]);
  const accepted = certifiedVisitorServices(packet);
  const dropped = rawServices.filter(name => !accepted.some(value => intakeQuality.key(value) === intakeQuality.key(name)));
  if (dropped.length) {
    issues.push({ field: "services", rule: "unaccepted_service_labels", severity: "review", scope: "service_selection" });
    rejected.push({ field: "services", value: intakeQuality.privateValue(dropped) });
  }
  packet.business.exactServices = accepted.join("\n");
  packet.business.mainServices = accepted.join("\n");
  packet.goldenArtifacts.exactServices = accepted;
  if (singlePageContract(packet)) packet.pagePlan = [{ title: "Home", slug: "", order: 1 }];
  else if (Array.isArray(packet.pagePlan)) packet.pagePlan = packet.pagePlan.filter(page => !intakeQuality.demoSource(page.slug || ""));
  packet.sources.private_quality_review = {
    publication_policy: "private_review_only",
    rejected,
    previous_rejected: (input.sources?.private_quality_review?.rejected || []).slice(0, 100),
    previous_issues: [...(input.sources?.private_quality_review?.previous_issues || []),
      ...supersededIssues].slice(-100),
  };
  // A saved compiled draft is not an authority for refreshed NAP or generated assets.
  if (input.compiled) {
    packet.compiled = { ...input.compiled };
    if (singlePageContract(packet)) {
      if (Array.isArray(packet.compiled.pages))
        packet.compiled.pages = packet.compiled.pages.filter(page => !page.slug && !page.route && !page.path);
    }
    if (packet.compiled.brand?.logoSource && !safeLogoCandidate(packet.compiled.brand.logoSource)) {
      packet.compiled.brand = { ...packet.compiled.brand, logoSource: "" };
      issues.push({ field: "logoSource", rule: "malformed_logo_withheld", severity: "review", scope: "asset_selection" });
    }
    delete packet.compiled.logoQa;
    if (packet.compiled.client && typeof packet.compiled.client === "object") {
      const checked = intakeQuality.facts(packet.compiled.client);
      packet.compiled.client = checked.data;
      issues.push(...checked.issues);
      rejected.push(...checked.rejected.map(row => ({ ...row, section: "compiled.client" })));
    }
  }
  packet.review.intakeQuality = { version: intakeQuality.version,
    issues: [...new Map(issues.map(row => [`${row.scope || "selected_fact"}:${row.source || ""}:${row.field}:${row.rule}`, row])).values()] };
  return packet;
}

function compilePacket(packet) {
  packet = prepareQualityPacket(packet);
  const data = { ...(packet.business || {}), ...(packet.brand || {}), ...(packet.requirements || {}) };
  const brandRoles = brandPaletteRoles(data, packet);
  const sourceArchive = archiveSourcePages(packet);
  const editorialWorklist = buildSourceEditorialWorklist(sourceArchive,
    packet.business?.domainUrl || packet.sources?.urls?.[0] || "");
  const serviceNames = exactServices(packet);
  const visitorServiceNames = certifiedVisitorServices(packet);
  const providers = Object.fromEntries(serviceNames.map(name => [name, sourceServiceProvider(packet, name)]));
  const ownServiceNames = visitorServiceNames.filter(name => providers[name] === visitorFact(data.businessName));
  const provisionalServices = authenticatedHarvestPackets.has(packet)
    ? visitorServiceNames.filter(name => !(packet.sources?.observations || []).some(observation =>
        intakeQuality.observedService(observation, name)))
    : [];
  const unboundServices = !(packet.sources?.observations || []).length
    && !normalizeSafetyText(packet.goldenArtifacts?.servicesSource || packet.business?.servicesSource || '')
    ? visitorServiceNames : [];
  const pagePlan = Array.isArray(packet.pagePlan) && packet.pagePlan.length
    ? packet.pagePlan.map(page => ({ ...page }))
    : [{ title: "Home", slug: "" }, { title: "Services", slug: "services" }, { title: "About", slug: "about" }, { title: "Contact", slug: "contact" }];
  // Harvested URLs are private research candidates. Only the operator's page
  // plan can create public routes; recapture and recompilation cannot add one.
  const visitorRoutes = unique(pagePlan.map(page => page.slug ? `/${String(page.slug).replace(/^\/+/, "")}` : "/"));
  const sourceRouteCandidates = sourceArchive.pages.map(source => ({
    route: source.route, sourceUrl: source.sourceUrl, file: source.file,
    publicationPolicy: sourceArchive.publicationPolicy,
    requiresSourceReview: true
  }));
  const services = serviceNames.map(name => ({
    slug: slugify(name),
    name,
    providerName: providers[name],
    h1: name,
    metaTitle: `${name} | ${providers[name] || data.businessName || "Local Service"}`,
    metaDescription: `${providers[name] || data.businessName || "This local business"} provides ${name.toLowerCase()} for ${data.serviceArea || "local customers"}.`,
    shortDesc: `${name} explained in plain language with verified intake facts and a clear contact path.`,
    longDescMd: serviceArticle(name, { ...data, businessName: providers[name] }, [name]),
    faqs: serviceFaqs(name, { ...data, businessName: providers[name] }),
    schemaType: "Service",
    priceRange: "Contact for estimate",
    durationEstimate: "Confirm during intake",
    internalLinkTargets: ["contact", "service-area"]
  }));
  const visitorServices = visitorServiceNames.map(name => ({
    slug: slugify(name),
    name,
    providerName: providers[name],
    longDescMd: serviceArticle(name, { ...data, businessName: providers[name] }, [name])
  }));

  const contentFiles = {
    "content/home.md": pageArticle("Home", data, ownServiceNames, pagePlan, 1400),
    "content/about.md": pageArticle("About", data, ownServiceNames, pagePlan, 1000),
    "content/process.md": pageArticle("Process", data, visitorServiceNames, pagePlan, 950),
    "content/service-areas.md": pageArticle("Service Areas", data, visitorServiceNames, pagePlan, 950),
    "content/contact.md": pageArticle("Contact", data, visitorServiceNames, pagePlan, 750),
    "content/faq.md": faqArticle(data, visitorServices.filter(service => providers[service.name] === visitorFact(data.businessName)))
  };

  visitorServices.forEach(service => {
    contentFiles[`content/services/${service.slug}.md`] = service.longDescMd;
  });

  visitorServices.filter(service => providers[service.name] === visitorFact(data.businessName)).slice(0, 6).forEach((service, index) => {
    contentFiles[`content/blog/${service.slug}-guide.md`] = blogArticle(service.name, data, ownServiceNames, index);
  });

  // Raw source archives are private references, NOT certified visitor copy.
  const visitorContentFiles = { ...contentFiles };
  Object.assign(contentFiles, sourceArchive.files);
  const quality = contentQualityReport(contentFiles, packet, data, new Set(sourceArchive.pages.map(page => page.file)));
  const sourcePaths = new Set(sourceArchive.pages.map(page => page.file));
  quality.sourcePages = sourceArchive.pages.length;
  quality.sourceWords = sourceArchive.pages.reduce((sum, page) => sum + page.words, 0);
  quality.sourceArchive.sourcePageCount = sourceArchive.pages.length;
  quality.sourceArchive.publicationPolicy = sourceArchive.publicationPolicy;
  contentFiles["content/content-quality-report.json"] = JSON.stringify(quality, null, 2);
  const routeContentMap = buildRouteContentMap(pagePlan, visitorServices, contentFiles);
  routeContentMap.forEach(row => {
    const source = sourceArchive.pages.find(page => page.route === row.route.replace(/\/$/, '') || (page.route === '/' && row.route === '/'));
    if (source) { row.sourceContentFiles = [source.file]; row.sourcePublicationPolicy = sourceArchive.publicationPolicy; row.requiresSourceReview = true; }
  });
  const logoQa = packet.compiled?.logoQa || buildLogoQa(packet, data);
  const galleryPlan = packet.compiled?.galleryPlan || buildGalleryPlan(packet, data);
  const socialPreviewPlan = packet.compiled?.socialPreviewPlan || buildSocialPreviewPlan(packet, data, logoQa, galleryPlan);
  const remix = packet.remix || packet.compiled?.remix || buildRemixFallback(packet, data);
  const basePremiumVisualStack = packet.compiled?.premiumVisualStack || buildPremiumVisualStack(packet, data, {
    remix,
    logoQa,
    galleryPlan,
    services,
    pagePlan
  });
  const premiumVisualStack = basePremiumVisualStack.creativeDirectorPreflight
    ? basePremiumVisualStack
    : {
      ...basePremiumVisualStack,
      creativeDirectorPreflight: buildCreativeDirectorPreflight({
        pages: pagePlan.map(page => page.title || page.name || page.slug || "Page").filter(Boolean),
        services: services.map(service => service.name || service.title || service.slug).filter(Boolean),
        hasVisualAssets: Boolean((galleryPlan.semanticSlots || []).length)
      })
    };
  const baseVisualSystemContract = packet.compiled?.visualSystemContract || buildVisualSystemContract(packet, data, {
    remix,
    logoQa,
    galleryPlan,
    services,
    pagePlan,
    premiumVisualStack
  });
  const visualSystemContract = baseVisualSystemContract.creativeDirectorPreflight
    ? {
      ...baseVisualSystemContract,
      premiumVisualStack: baseVisualSystemContract.premiumVisualStack?.creativeDirectorPreflight ? baseVisualSystemContract.premiumVisualStack : premiumVisualStack
    }
    : {
      ...baseVisualSystemContract,
      premiumVisualStack,
      creativeDirectorPreflight: premiumVisualStack.creativeDirectorPreflight
    };
  const searchOptimizationPlan = buildSearchOptimizationPlan(packet, data, ownServiceNames, pagePlan);
  const brightDataQueryPlan = buildBrightDataQueryPlan(packet, data, searchOptimizationPlan);
  const brightDataAudit = normalizeBrightDataAudit(packet.compiled?.brightDataAudit || packet.brightDataAudit, brightDataQueryPlan, searchOptimizationPlan, data);
  searchOptimizationPlan.brightData = {
    auditStatus: brightDataAudit.status,
    liveQueries: brightDataAudit.queries.length,
    plannedQueries: brightDataQueryPlan.queries.length,
    requiredFiles: ["BRIGHTDATA-SERP-AUDIT.md", "brightdata-serp-audit.json", "brightdata-query-plan.json"],
    costGuard: brightDataQueryPlan.costGuard
  };
  const localPresencePlan = buildLocalPresencePlan(packet, data, pagePlan, searchOptimizationPlan);
  const mapSdkContract = localPresencePlan.mapSdkContract || buildMapSdkContract(data, localPresencePlan.mapAndDirections, packet);
  const seoAssetLayer = buildSeoAssetLayer(data, services.filter(service => providers[service.name] === visitorFact(data.businessName)),
    pagePlan, visitorRoutes, mapSdkContract, searchOptimizationPlan);
  const templateVarietyContract = packet.compiled?.templateVarietyContract || buildTemplateVarietyContract(packet, data, {
    remix,
    visualSystemContract,
    logoQa,
    galleryPlan,
    services,
    pagePlan
  });
  const brandAssetGeneration = packet.compiled?.brandAssetGeneration || buildBrandAssetGenerationPlan(packet, data, logoQa, galleryPlan, templateVarietyContract);
  const securityHardening = packet.compiled?.securityHardening || buildSecurityHardeningPlan(packet, data);
  const postPublishValidation = packet.compiled?.postPublishValidation || buildPostPublishValidationPlan(packet, data, {
    routes: visitorRoutes,
    mapSdkContract,
    seoAssetLayer,
    templateVarietyContract
  });
  const contentContract = certifiedPracticeContentContract({
    packet,
    data,
    services: ownServiceNames,
    contentFiles: visitorContentFiles,
    logoQa,
    galleryPlan
  });

  const compiled = {
    ...(packet.compiled || {}),
    // Derived proof survives only when each claim matches its recorded source observation.
    trust: verifiedPacketProof(packet).trust,
    reviews: verifiedPacketProof(packet).reviews,
    brand: { ...(packet.compiled?.brand || {}), roles: brandRoles, gradientCss: brandGradientCss(brandRoles) },
    services,
    ...serviceSafeDerivedFields(packet, data, ownServiceNames),
    contentFiles,
    contentQuality: quality,
    sourceContent: { schema: "SourcePageArchive/v1", pages: sourceArchive.pages, excluded: sourceArchive.excluded,
      bytes: sourceArchive.bytes, publicationPolicy: sourceArchive.publicationPolicy,
      editorialWorklist },
    visitorPagePlan: pagePlan,
    sourceRouteCandidates,
    productionLocks: [
      ...(packet.compiled?.productionLocks || []),
      ...(sourceArchive.pages.length ? [{ key: "source-content-review", status: "review", detail: "Preserved public-source text is a private archive, not certified visitor copy; downstream review is required before publication." }] : []),
      ...(provisionalServices.length ? [{ key: "provisional-service-proof", status: "review", detail: "Confirm first-party extracted service labels against source page text before publication.", services: provisionalServices }] : []),
      ...(unboundServices.length ? [{ key: "unbound-service-proof", status: "review", detail: "Legacy service labels have no source observations; confirm before publication.", services: unboundServices }] : []),
    ],
    routeContentMap,
    contentContract,
    logoQa,
    galleryPlan,
    socialPreviewPlan,
    premiumVisualStack,
    visualSystemContract,
    searchOptimizationPlan,
    brightDataQueryPlan,
    brightDataAudit,
    localPresencePlan,
    mapSdkContract,
    seoAssetLayer,
    businessTs: buildBusinessTs(data, services.filter(service => providers[service.name] === visitorFact(data.businessName)), mapSdkContract),
    templateVarietyContract,
    postPublishValidation,
    brandAssetGeneration,
    securityHardening,
    seo: {
      ...(packet.compiled?.seo || {}),
      primaryKeyword: searchOptimizationPlan.primaryKeyword,
      secondaryKeywords: searchOptimizationPlan.secondaryKeywords,
      localModifiers: searchOptimizationPlan.localModifiers,
      canonicalPolicy: searchOptimizationPlan.technicalRequirements.canonicalPolicy,
      sitemapPolicy: searchOptimizationPlan.technicalRequirements.sitemapPolicy,
      schemaTypes: searchOptimizationPlan.technicalRequirements.schemaTypes
    },
    voiceSearch: buildVoiceSearchPlan(searchOptimizationPlan, pagePlan, ownServiceNames),
    citationsCsv: searchOptimizationCitationsCsv(searchOptimizationPlan),
    remix,
    compileJob: {
      status: "complete",
      mode: "backend-full-package-compiler",
      compiledAt: new Date().toISOString(),
      generatedContentFiles: Object.keys(contentFiles).length,
      generatedWords: quality.totalWords,
      note: "Backend compile generated source-bounded visitor copy. Sparse facts intentionally produce shorter pages instead of padded or invented prose."
    }
  };

  compiled.manifest = {
    ...(compiled.manifest || {}),
    contentCompiler: "backend-full-package-compiler",
    contentQualityFile: "content-content-quality-report.json",
    routes: visitorRoutes,
    remix,
    files: unique([
      ...((compiled.manifest && compiled.manifest.files) || []),
      "build-context.json",
      "WSS-BUILD-PLAN-PROMPT.md",
      "WSS-BUILD-PROMPT.md",
      "TEMPLATE-SANITATION-CONTRACT.md",
      "WSS-OPERATOR-RUNBOOK.md",
      "GEO-VOICE-LOCAL-SEARCH-PLAN.md",
      "search-optimization-plan.json",
      "BRIGHTDATA-SERP-AUDIT.md",
      "brightdata-serp-audit.json",
      "brightdata-query-plan.json",
      "LOCAL-PRESENCE-CONVERSION-PLAN.md",
      "local-presence-plan.json",
      "MAP-SDK-CONTRACT.md",
      "map-sdk-contract.json",
      "src-lib-business.ts",
      "answer-engine.json",
      "entity.json",
      "local-business.jsonld",
      "locations.geojson",
      "geo.kml",
      "sitemap-index.xml",
      "sitemap-services.xml",
      "sitemap-geo.xml",
      "sitemap-entity.xml",
      "offers.json",
      "products-feed.json",
      "TEMPLATE-VARIETY-CONTRACT.md",
      "template-variety-contract.json",
      "POST-PUBLISH-VALIDATION.md",
      "post-publish-validation.json",
      "BRAND-ASSET-GENERATION.md",
      "brand-asset-generation.json",
      "SECURITY-HARDENING.md",
      "security-hardening.json",
      "00-CREDIT-SAVER-PREFLIGHT.md",
      "PREMIUM-VISUAL-STACK.md",
      "premium-visual-stack.json",
      "VISUAL-SYSTEM-CONTRACT.md",
      "visual-system-contract.json",
      "content-route-map.json",
      "content-content-quality-report.json",
      ...Object.keys(contentFiles).map(flatPacketPath)
    ])
  };

  compiled.preflight = {
    ...(compiled.preflight || packet.readiness?.preflight || {}),
    contentGate: {
      longFormContentGenerated: true,
      articleSeedsGenerated: services.slice(0, 6).length > 0,
      serviceRouteContentMapped: routeContentMap.every(item => item.contentFiles.length > 0 || item.route === "/"),
      minimumHomeWords: quality.files.find(file => /content-home\.md$/.test(file.file))?.wordCount || 0,
      totalWords: quality.totalWords,
      totalFiles: quality.totalFiles,
      reviewCount: quality.reviewCount,
      expectedFileCount: quality.totalFiles,
      expectedWordCount: quality.totalWords,
      routeCount: routeContentMap.length,
      status: quality.status,
      validationVersion: intakeQuality.version,
      validationIssues: quality.inputIssues
    },
    searchGate: {
      planGenerated: true,
      brightDataPreferred: true,
      fallbackAllowed: true,
      primaryKeyword: searchOptimizationPlan.primaryKeyword,
      targetCount: searchOptimizationPlan.secondaryKeywords.length + 1,
      localModifierCount: searchOptimizationPlan.localModifiers.length,
      brightDataAuditStatus: brightDataAudit.status,
      brightDataLiveQueries: brightDataAudit.queries.length,
      brightDataPlannedQueries: brightDataQueryPlan.queries.length,
      status: searchOptimizationPlan.primaryKeyword ? "pass" : "review",
      note: brightDataAudit.status === "compiled"
        ? "Bright Data SERP audit is attached. The WSS builder should use it instead of running a second broad competitor crawl."
        : "Bright Data query plan is attached. Run the audit when configured; otherwise disclose Firecrawl/search fallback before build."
    },
    localPresenceGate: {
      planGenerated: true,
      socialLinks: localPresencePlan.socialLinks.length,
      internalLinks: localPresencePlan.internalLinkStrategy.requiredLinks.length,
      googleMapsUrl: localPresencePlan.mapAndDirections.googleMapsSearchUrl,
      googleDirectionsUrl: localPresencePlan.mapAndDirections.googleDirectionsUrl,
      appleMapsUrl: localPresencePlan.mapAndDirections.appleMapsUrl,
      mapsConnectorEnv: mapSdkContract.connector.env,
      mapId: mapSdkContract.mapId,
      mapSdkStatus: mapSdkContract.status,
      geoVerified: mapSdkContract.geo.verified,
      serviceRadiusMiles: mapSdkContract.serviceRadiusMiles,
      cityMarkerCount: Object.keys(mapSdkContract.cityCoordinatePlan.coords || {}).length,
      missingCityCoords: mapSdkContract.cityCoordinatePlan.missing || [],
      status: mapSdkContract.status === "block" ? "block" : mapSdkContract.status === "review" ? "review" : localPresencePlan.qaGates.length ? "pass" : "review"
    },
    visualGate: {
      status: visualSystemContract.status === "ready_for_original_premium_build" ? "pass" : "review",
      premiumVisualStackStatus: premiumVisualStack.status,
      creativeDirectorPreflightStatus: visualSystemContract.creativeDirectorPreflight?.status || premiumVisualStack.creativeDirectorPreflight?.status || "required_before_build",
      creativeDirectorRequirementCount: (visualSystemContract.creativeDirectorPreflight?.requiredOutputs || premiumVisualStack.creativeDirectorPreflight?.requiredOutputs || []).length,
      templateFingerprintRequired: true,
      preservePrimitiveCount: visualSystemContract.templateFingerprint.preservePrimitives.length,
      enrichmentMandateCount: visualSystemContract.enrichmentMandates.length,
      qaGateCount: visualSystemContract.qaGates.length,
      missing: visualSystemContract.missing,
      stopRule: "Before production build, read PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md and echo target stack, ingredient patterns, asset strategy, original hero, custom widget, proof strategy, creative director/design council preflight, footer polish, and visual QA gates."
    },
    seoAssetGate: {
      status: seoAssetLayer.status,
      assetFileCount: seoAssetLayer.files.length,
      jsonLdTypes: seoAssetLayer.schemaTypes,
      sitemapCount: seoAssetLayer.sitemaps.length,
      stopRule: "Stop if answer-engine.json, entity.json, local-business.jsonld, locations.geojson, geo.kml, sitemap files, offers.json, or products-feed.json are missing."
    },
    templateVarietyGate: {
      status: templateVarietyContract.status,
      selectedArchetype: templateVarietyContract.archetype.role,
      cinematicMustKeep: templateVarietyContract.archetype.cinematicMustKeep.length,
      requiredPacketInputs: templateVarietyContract.archetype.requiredPacketInputs.length,
      stopRule: "Stop if the plan strips the selected template shape, hero motion, gallery rhythm, widget shell, or map/form placement."
    },
    postPublishGate: {
      status: postPublishValidation.status,
      checkCount: postPublishValidation.checks.length,
      requiredUrlPolicy: postPublishValidation.urlPolicy,
      stopRule: "Do not send completion email until POST-PUBLISH-VALIDATION.md checks pass on the WSS URL."
    }
  };
  compiled.preflight.counts = {
    ...(compiled.preflight.counts || {}),
    routes: visitorRoutes.length,
    contentFiles: quality.totalFiles,
    contentWords: quality.totalWords,
    seoAssetFiles: seoAssetLayer.files.length,
    postPublishChecks: postPublishValidation.checks.length
  };
  compiled.preflight = finalizePreflight(compiled.preflight, packet, compiled);
  compiled.proofSummary = buildCompilerProofSummary(packet, compiled);
  const readinessStatus = compiled.preflight.status === "under_6_ready"
    ? "Ready"
    : compiled.preflight.status === "blocked"
      ? "Blocked"
      : "Needs review";

  return {
    ...packet,
    pagePlan,
    remix,
    compiled,
    readiness: {
      ...(packet.readiness || {}),
      status: readinessStatus,
      preflight: compiled.preflight
    }
  };
}

function finalizePreflight(preflight, packet = {}, compiled = {}) {
  const locks = [
    ...(Array.isArray(packet.productionLocks) ? packet.productionLocks : []),
    ...(Array.isArray(compiled.productionLocks) ? compiled.productionLocks : []),
    ...(Array.isArray(preflight.productionLocks) ? preflight.productionLocks : [])
  ];
  const uniqueLocks = [];
  const seenLocks = new Set();
  locks.forEach(lock => {
    const key = `${lock.key || lock.label || ""}|${lock.status || ""}|${lock.detail || ""}`;
    if (seenLocks.has(key)) return;
    seenLocks.add(key);
    uniqueLocks.push(lock);
  });

  const gateStatuses = [
    preflight.contentGate?.status,
    preflight.searchGate?.status,
    preflight.localPresenceGate?.status,
    preflight.visualGate?.status,
    preflight.seoAssetGate?.status,
    preflight.templateVarietyGate?.status,
    preflight.postPublishGate?.status
  ].filter(Boolean);
  const missingCritical = unique([
    ...(Array.isArray(preflight.missingCritical) ? preflight.missingCritical : []),
    ...(preflight.localPresenceGate?.status === "block" ? ["Map/local presence contract is blocked."] : []),
    ...(preflight.seoAssetGate?.status === "block" ? ["SEO asset layer is blocked."] : []),
    ...(preflight.postPublishGate?.status === "block" ? ["Post-publish validation plan is blocked."] : [])
  ]);
  const hardBlocked = missingCritical.length > 0
    || gateStatuses.includes("block")
    || uniqueLocks.some(lock => String(lock.status || "").toLowerCase() === "block");
  const reviewNeeded = gateStatuses.includes("review")
    || uniqueLocks.some(lock => String(lock.status || "").toLowerCase() === "review")
    || preflight.buildGate?.assetsStaged === false
    || preflight.buildGate?.faviconStaged === false;
  const contentReady = preflight.contentGate?.longFormContentGenerated === true
    && Number(preflight.contentGate?.totalWords || 0) >= 1200
    && Number(preflight.contentGate?.totalFiles || 0) > 0;
  const searchReady = preflight.searchGate?.planGenerated === true;
  const sectionsReady = preflight.buildGate?.sectionsStructured !== false;
  const status = hardBlocked
    ? "blocked"
    : contentReady && searchReady && sectionsReady && !reviewNeeded
      ? "under_6_ready"
      : "compiled_needs_review";

  return {
    ...preflight,
    status,
    targetCredits: preflight.targetCredits || "<=6 WSS first-pass after plan approval",
    rescueRisk: hardBlocked ? "High" : reviewNeeded ? "Medium" : "Low",
    missingCritical,
    productionLocks: uniqueLocks,
    finalizedAt: new Date().toISOString(),
    compileState: "compiled",
    operatorNote: status === "compiled_needs_review"
      ? "Compiler finished; review listed asset, visual, or production-lock items before spending builder credits."
      : status === "blocked"
        ? "Compiler finished but a production lock or critical gate blocks the build."
        : "Compiler finished and the packet is ready for the under-six-credit production lane."
  };
}

function pageArticle(pageTitle, data, services) {
  const ctx = contentContext(data, services);
  const page = String(pageTitle || "").trim().toLowerCase();
  const title = page === "home" ? (ctx.business || "Services") : (String(pageTitle || "Services").trim() || "Services");
  const parts = [`# ${title}`];

  if (page === "home") {
    parts.push(visitorOfferSentence(ctx));
    if (ctx.services.length) {
      parts.push("## Services", `${ctx.business ? `${ctx.business} offers` : "Available services include"} ${humanList(ctx.services)}${ctx.serviceArea ? ` in ${ctx.serviceArea}` : ""}.`);
    }
    if (ctx.hours) parts.push("## Hours", ctx.hours);
    parts.push("## Get in touch", visitorContactCopy(ctx));
  } else if (/about|story|company/.test(page)) {
    parts.push(visitorOfferSentence(ctx));
    parts.push("## Start a conversation", visitorContactCopy(ctx));
  } else if (/process|what to expect/.test(page)) {
    parts.push("Share the service you need, the location, and a short description of what is happening. Photos and timing details can make the first conversation more useful.");
    parts.push("## Request service", visitorContactCopy(ctx));
  } else if (/service areas?|locations?|areas served/.test(page)) {
    parts.push(ctx.serviceArea
      ? `${ctx.business || "The business"} serves ${ctx.serviceArea}. Contact the business to confirm availability for your address.`
      : "Contact the business to confirm service availability for your address.");
    parts.push("## Contact", visitorContactCopy(ctx));
  } else if (/contact|quote|estimate/.test(page)) {
    parts.push(visitorContactCopy(ctx));
    parts.push("Share the service you need, your location, and any timing or access details that may help.");
  } else {
    parts.push(visitorOfferSentence(ctx));
    parts.push("## Contact", visitorContactCopy(ctx));
  }

  return markdown(parts);
}

function serviceArticle(serviceName, data, services) {
  const ctx = contentContext(data, services);
  const name = visitorFact(serviceName);
  const business = ctx.business || "The business";
  const parts = [
    `# ${name}`,
    `${business} offers ${name}${ctx.serviceArea ? ` in ${ctx.serviceArea}` : ""}.`,
    "## Request service",
    visitorContactCopy(ctx),
    "When you get in touch, share the service location and a brief description of what you need. Add photos or access details when they are useful."
  ];
  const related = ctx.services.filter(service => service.toLowerCase() !== name.toLowerCase());
  if (related.length) parts.push("## Other services", `${business} also offers ${humanList(related)}.`);
  return markdown(parts);
}

function blogArticle(serviceName, data, services, index) {
  const ctx = contentContext(data, services);
  const name = visitorFact(serviceName);
  const titles = [
    `What to Share When Requesting ${name}`,
    `Questions to Ask About ${name}`,
    `Planning a ${name} Request`,
    `Getting Ready to Discuss ${name}`
  ];
  const parts = [
    `# ${titles[index % titles.length]}`,
    `If you are contacting ${ctx.business || "a local business"} about ${name}${ctx.serviceArea ? ` in ${ctx.serviceArea}` : ""}, a clear summary helps start the conversation.`,
    "## Useful details",
    "Include the location, what you have noticed, any timing needs, and photos when they add useful context.",
    "## Contact",
    visitorContactCopy(ctx)
  ];
  return markdown(parts);
}

function faqArticle(data, services) {
  const ctx = contentContext(data, services.map(service => service.name));
  const rows = [];
  if (ctx.services.length) {
    rows.push([`What services does ${ctx.business || "the business"} offer?`, `${ctx.business || "The business"} offers ${humanList(ctx.services)}.`]);
  }
  if (ctx.serviceArea) {
    rows.push(["What area is served?", `${ctx.business || "The business"} serves ${ctx.serviceArea}. Contact the business to confirm availability for your address.`]);
  }
  if (ctx.hours) rows.push(["What are the business hours?", ctx.hours]);
  rows.push(["How do I get in touch?", visitorContactCopy(ctx)]);
  return markdown([
    "# Frequently Asked Questions",
    ...rows.flatMap(([question, answer]) => [`## ${question}`, answer])
  ]);
}

function serviceFaqs(name, data) {
  const ctx = contentContext(data, [name]);
  const business = ctx.business || "The business";
  return [
    { q: `Does ${business} offer ${String(name).toLowerCase()}?`, a: `Yes. ${business} offers ${name}${ctx.serviceArea ? ` in ${ctx.serviceArea}` : ""}.` },
    { q: `How do I request ${String(name).toLowerCase()}?`, a: visitorContactCopy(ctx) }
  ];
}

function contentContext(data = {}, services = []) {
  // `compilePacket()` has already filtered the canonical service list for
  // must-avoid residue and non-service labels. Never re-open raw input here.
  const serviceNames = unique(splitLines(services))
    .map(visitorFact)
    .filter(Boolean)
    .slice(0, 18);
  return {
    business: visitorFact(data.businessName),
    serviceArea: visitorFact(data.serviceArea),
    phone: visitorFact(data.phone || data.smsNumber),
    email: intakeQuality.email(data.email),
    hours: visitorFact(data.hours),
    cta: visitorFact(data.mainCta),
    services: serviceNames
  };
}

function visitorOfferSentence(ctx) {
  const services = humanList(ctx.services);
  if (ctx.business && services && ctx.serviceArea) return `${ctx.business} offers ${services} in ${ctx.serviceArea}.`;
  if (ctx.business && services) return `${ctx.business} offers ${services}.`;
  if (services && ctx.serviceArea) return `Available services in ${ctx.serviceArea} include ${services}.`;
  if (services) return `Available services include ${services}.`;
  if (ctx.business && ctx.serviceArea) return `${ctx.business} serves ${ctx.serviceArea}.`;
  if (ctx.business) return `Contact ${ctx.business} to ask about available services.`;
  if (ctx.serviceArea) return `Contact the business to ask about service availability in ${ctx.serviceArea}.`;
  return "Use the contact form to ask about available services.";
}

function visitorContactCopy(ctx) {
  const options = [];
  if (ctx.phone) options.push(`Call ${ctx.phone}`);
  if (ctx.email) options.push(`Email ${ctx.email}`);
  if (ctx.cta) options.push(ctx.cta.replace(/[.!?]+$/, ""));
  if (!options.length) return "Use the contact form to describe what you need.";
  return `${options.join(". ")}.`;
}

function visitorFact(value) {
  if (Array.isArray(value)) return value.map(visitorFact).filter(Boolean).join("; ");
  if (value == null || typeof value === "object") return "";
  return String(value)
    .replace(/<(?:script|style|iframe)\b[^>]*>[\s\S]*?<\/(?:script|style|iframe)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/(?:javascript|vbscript|data)\s*:/gi, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/gi, "")
    .replace(/[`*_{}\[\]<>#|]/g, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .normalize("NFC")
    .trim();
}

function markdown(parts) {
  return parts.map(part => String(part || "").trim()).filter(Boolean).join("\n\n").normalize("NFC");
}

// Kept as a compatibility seam for older callers. Word-count padding is
// intentionally retired: sparse certified facts must produce short copy.
function ensureMinimumWords(markdown) {
  return String(markdown || "").trim();
}

function certifiedPracticeContentContract({ packet = {}, data = {}, services = [], contentFiles = {}, logoQa = {}, galleryPlan = {} } = {}) {
  const categoryLabel = visitorFact(data.category);
  const category = certifiedCategoryFamily(categoryLabel);
  const facts = compactObject({
    business_name: visitorFact(data.businessName),
    category,
    ...(categoryLabel && certifiedCategoryKey(categoryLabel) !== category
      ? { category_label: categoryLabel }
      : {}),
    service_area: visitorFact(data.serviceArea),
    phone: visitorFact(data.phone || data.smsNumber),
    email: intakeQuality.email(data.email),
    hours: visitorFact(data.hours),
    primary_cta: visitorFact(data.mainCta),
    services: unique(services.map(visitorFact).filter(Boolean))
  });
  const assets = {
    publication_policy: "candidate_only_until_downstream_ownership_verification",
    logo_candidates: unique([
      logoQa.primaryLogoSource,
      packet.brand?.logoLink,
      packet.compiled?.brand?.logoSource,
      ...((packet.assetQa?.logoCandidates || []))
    ]),
    media_candidates: unique((galleryPlan.semanticSlots || []).map(item => item?.source).filter(Boolean))
  };
  const files = Object.fromEntries(
    Object.entries(contentFiles)
      .filter(([path, content]) => /^content\//.test(path) && /\.md$/i.test(path) && typeof content === "string")
      .sort(([left], [right]) => left.localeCompare(right))
  );
  const fileHashes = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, sha256Utf8(content)])
  );
  const violations = visitorCopySafetyViolations(files, facts, packet);
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    facts,
    assets,
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      files,
      file_hashes: fileHashes,
      safety: {
        pass: violations.length === 0,
        violations
      }
    }
  };
}

// Cross-repo category identity. The visitor contract carries one stable family
// value even when a directory uses a longer display label such as "Roofing
// contractor". The raw label remains available for display/evidence only.
function certifiedCategoryFamily(value = "") {
  const key = certifiedCategoryKey(value);
  if (!key) return "";
  const families = [
    ["auto detailing", /\b(?:auto|car|mobile) detail|ceramic coat/],
    ["med spa", /\bmed(?:ical)? spa|aesthetic|injectable|botox/],
    ["water damage restoration", /\bwater damage\b|\bflood restoration\b/],
    ["pressure washing service", /\b(?:pressure|power) wash/],
    ["real estate agent", /\brealtors?\b|\breal estate (?:agent|agents|agency|broker|brokers)\b|\brealty\b/],
    ["general contractor", /\bgeneral contract|\bconstruction|carpent|remodel|renovat/],
    ["garage door", /\bgarage door|overhead door/],
    ["pest control", /\bpest|extermin|termite/],
    ["tree service", /\btree|arborist|stump/],
    ["hair salon", /\b(?:beauty|hair) salon\b|^salon$|hairstyl/],
    ["tattoo", /\btattoo/], ["nail studio", /\bnail/],
    ["attorney", /\battorney|lawyer|law firm|legal service/],
    ["electrical", /\belectric/], ["landscaping", /\blandscap|lawn|hardscap/],
    ["plumbing", /\bplumb|drain service/], ["roofing", /\broof/],
    ["hvac", /\bhvac|heating and air|air condition/],
    ["flooring contractor", /\bflooring\b|\bfloor installer/],
    ["masonry", /\bmasonry\b|\bmason\b/], ["concrete", /\bconcrete/],
    ["fencing", /\bfenc/], ["painting", /\bpaint/], ["solar", /\bsolar|photovoltaic/],
    ["cleaning", /\bclean(?:ing|er|ers)?\b|janitorial|maid/],
    ["excavation", /\bexcavat|grading|trenching/], ["massage", /\bmassage|bodywork/],
    ["dental", /\bdental|dentist|orthodont/], ["barber", /\bbarber/],
    ["piercing", /\bpierc/], ["photographer", /\bphotograph/],
    ["wedding vendor", /\b(?:wedding|bridal)\b/], ["event vendor", /\bevent\b/],
  ];
  return families.find(([, pattern]) => pattern.test(key))?.[0] || key;
}

function certifiedCategoryKey(value = "") {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => (
    Array.isArray(item) ? item.length > 0 : item !== "" && item != null
  )));
}

function sha256Utf8(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function visitorCopySafetyViolations(files = {}, facts = {}, packet = {}) {
  const factStrings = flattenFactStrings(facts).map(visitorFact).filter(Boolean);
  const rules = [
    {
      rule: "builder_instruction_language",
      pattern: /\b(?:site builder|builder instructions?|build step|production build|selected template|template(?:'s)? visual system|intake packet|packet marks?|compiled (?:data|form|packet)|protected service|finished site|page should|copy should|site should|content is generated)\b/i
    },
    {
      rule: "placeholder_language",
      pattern: /\b(?:this local business|verified phone number|verified email address|hours need review|the local service area|the local market|contact for estimate|confirm during intake)\b/i
    },
    {
      rule: "unsafe_markup",
      pattern: /<[^>]+>|(?:javascript|vbscript|data)\s*:|[\u202a-\u202e\u2066-\u2069]/i
    },
    {
      rule: "foreign_markdown_url",
      pattern: /!?\[[^\]]*\]\(https?:\/\//i
    },
    {
      rule: "fabricated_social_proof",
      pattern: /\b(?:rated\s+[1-5](?:\.\d+)?|[1-5](?:\.\d+)?\s*stars?|hundreds? of (?:reviews|customers)|thousands? of (?:reviews|customers)|trusted by\s+\d+)\b/i,
      factBound: true
    },
    {
      rule: "unsupported_high_risk_claim",
      pattern: /\b(?:guaranteed?|warrant(?:y|ies|ied)|licensed|insured|bonded|accredited|award[- ]winning|same[- ]day|24\/7|#1|free estimates?|financing|\d+(?:\.\d+)?%\s*apr|\d+\s+years? in business)\b/i,
      factBound: true
    }
  ];
  const violations = [];
  for (const [file, content] of Object.entries(files)) {
    for (const rule of intakeQuality.copyIssues(content, facts)) violations.push({ file, rule });
    for (const issue of packet.review?.intakeQuality?.issues || []) {
      if (issue.severity === "block" && issue.scope !== "private_source"
        && issue.scope !== "service_selection" && issue.scope !== "proof_selection"
        && !["unaccepted_service_labels", "unverified_proof_note"].includes(issue.rule)) {
        violations.push({ file, rule: issue.rule });
      }
    }
  }
  for (const [file, content] of Object.entries(files)) {
    const unsupportedText = removeSupportedFactSpans(content, factStrings);
    for (const rule of rules) {
      const scanned = rule.factBound ? unsupportedText : String(content || "");
      if (!rule.pattern.test(scanned)) continue;
      violations.push({ file, rule: rule.rule });
    }
  }
  const forbidden = literalMustAvoidPhrases(packet.requirements?.mustAvoid)
    .map(visitorFact)
    .map(normalizeSafetyText)
    .filter(value => value.length >= 3);
  for (const [file, content] of Object.entries(files)) {
    const normalized = normalizeSafetyText(content);
    if (forbidden.some(value => normalized.includes(value))) {
      violations.push({ file, rule: "must_avoid_residue" });
    }
  }
  return violations;
}

function removeSupportedFactSpans(content, facts = []) {
  let remaining = String(content || "");
  for (const fact of [...facts].sort((left, right) => right.length - left.length)) {
    if (fact.length < 2) continue;
    remaining = remaining.replace(new RegExp(escapeRegExp(fact), "gi"), " ");
  }
  return remaining;
}

function flattenFactStrings(value) {
  if (Array.isArray(value)) return value.flatMap(flattenFactStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenFactStrings);
  return value == null ? [] : [String(value)];
}

function normalizeSafetyText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
}

function contentQualityReport(files, packet = {}, data = {}, privatePaths = new Set()) {
  // Only compiler-owned archive paths are private. A caller-supplied flag must
  // never turn an ordinary visitor file into an exempt source attachment.
  const isPrivate = path => privatePaths.has(path) && /^content\/source(?:-pages)?\//.test(path);
  const publicFiles = Object.fromEntries(Object.entries(files).filter(([path]) => !isPrivate(path)));
  const facts = { business_name: visitorFact(data.businessName), category: visitorFact(data.category),
    service_area: visitorFact(data.serviceArea), phone: intakeQuality.phone(data.phone || data.smsNumber),
    email: intakeQuality.email(data.email), hours: visitorFact(data.hours),
    primary_cta: visitorFact(data.mainCta), services: certifiedVisitorServices(packet) };
  const violations = visitorCopySafetyViolations(publicFiles, facts, packet);
  const inputIssues = packet.review?.intakeQuality?.issues || [];
  const packetIssues = inputIssues.filter(row => row.scope !== "private_source"
    && (row.scope === "service_selection" || row.scope === "proof_selection"
      || ["unaccepted_service_labels", "unverified_proof_note"].includes(row.rule)));
  const selectedIssues = inputIssues.filter(row => row.scope !== "private_source" && !packetIssues.includes(row));
  const entries = Object.entries(files)
    .filter(([path]) => /^content\//.test(path) && /\.md$/i.test(path))
    .map(([path, content]) => {
      const reasons = isPrivate(path) ? ["private_source_archive"] : unique([
        ...violations.filter(row => row.file === path).map(row => row.rule),
        ...selectedIssues.map(row => row.rule),
      ]);
      return { file: flatPacketPath(path), sourcePath: path, wordCount: wordCount(content),
        targetWords: 0, status: reasons.length ? "review" : "pass", reasons,
        kind: isPrivate(path) ? "source_archive" : "generated_copy" };
    });
  const visitorFiles = entries.filter(row => row.kind === "generated_copy");
  const archiveFiles = entries.filter(row => row.kind === "source_archive");
  const totalWords = rows => rows.reduce((sum, row) => sum + row.wordCount, 0);
  const reviewCount = visitorFiles.filter(row => row.status !== "pass").length;
  const status = violations.length || selectedIssues.some(row => row.severity === "block")
    || packetIssues.some(row => row.severity === "block")
    ? "block" : reviewCount || packetIssues.length ? "review" : "pass";
  return { schema: "PublicCopyQuality/v3", generatedAt: new Date().toISOString(), validationVersion: intakeQuality.version,
    status, totalFiles: visitorFiles.length, totalWords: totalWords(visitorFiles),
    passCount: visitorFiles.length - reviewCount, reviewCount, inputIssues, files: entries,
    visitor: { totalFiles: visitorFiles.length, totalWords: totalWords(visitorFiles),
      passCount: visitorFiles.length - reviewCount, reviewCount, files: visitorFiles },
    sourceArchive: { totalFiles: archiveFiles.length, totalWords: totalWords(archiveFiles),
      files: archiveFiles, publicationPolicy: "private_review_only" },
    packetTotals: { totalFiles: entries.length, totalWords: totalWords(entries),
      markdownFiles: entries.length, markdownWords: totalWords(entries) } };
}

function buildRouteContentMap(pagePlan = [], services = [], contentFiles = {}) {
  const serviceFileBySlug = new Map(services.map(service => [
    slugify(service.slug || service.name || service.title),
    `content/services/${slugify(service.slug || service.name || service.title)}.md`
  ]));
  return (pagePlan || []).map((page, index) => {
    const title = page.title || page.name || (index === 0 ? "Home" : `Page ${index + 1}`);
    const slug = slugify(page.slug || title);
    const route = page.slug ? `/${String(page.slug).replace(/^\/+/, "")}` : "/";
    const mappedFiles = [];
    if (!page.slug || /^home$/i.test(title)) {
      mappedFiles.push("content/home.md");
    } else if (/contact|quote|estimate/i.test(title)) {
      mappedFiles.push("content/contact.md");
    } else if (/service\s*areas?|locations?|areas?\s*served/i.test(title)) {
      mappedFiles.push("content/service-areas.md");
    } else if (/about|company|story/i.test(title)) {
      mappedFiles.push("content/about.md");
    } else {
      const exact = serviceFileBySlug.get(slug);
      if (exact && contentFiles[exact]) mappedFiles.push(exact);
      services.forEach(service => {
        const serviceSlug = slugify(service.slug || service.name || service.title);
        const serviceFile = `content/services/${serviceSlug}.md`;
        if ((slug.includes(serviceSlug) || serviceSlug.includes(slug) || wordsOverlap(slug, serviceSlug)) && contentFiles[serviceFile]) {
          mappedFiles.push(serviceFile);
        }
        const blogFile = `content/blog/${serviceSlug}-guide.md`;
        if ((slug.includes(serviceSlug) || serviceSlug.includes(slug) || wordsOverlap(slug, serviceSlug)) && contentFiles[blogFile]) {
          mappedFiles.push(blogFile);
        }
      });
      const fallback = `content/services/${slug}.md`;
      if (!mappedFiles.length && contentFiles[fallback]) mappedFiles.push(fallback);
    }
    return {
      title,
      route,
      slug: page.slug || "",
      targetKeyword: page.targetKeyword || "",
      intent: page.intent || inferIntent(title),
      contentFiles: unique(mappedFiles),
      stopIfMissing: true
    };
  });
}

function wordsOverlap(a, b) {
  const left = new Set(String(a || "").split("-").filter(word => word.length > 3));
  return String(b || "").split("-").filter(word => word.length > 3).some(word => left.has(word));
}

function buildLogoQa(packet, data) {
  const logoCandidates = unique([
    packet.brand?.logoLink,
    packet.compiled?.brand?.logoSource,
    ...((packet.assetQa?.logoCandidates || []))
  ]);
  const primary = logoCandidates[0] || "";
  const format = (String(primary).match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1] || "").toLowerCase();
  const needsBackgroundCleanup = Boolean(primary) && (
    /jpe?g/i.test(format) ||
    /\b(card|business-card|flyer|screenshot|facebook|yelp|profile|post)\b/i.test(String(primary))
  );
  const issues = [];
  if (!primary) issues.push("No logo candidate is recorded.");
  if (needsBackgroundCleanup) issues.push("Logo needs transparent background cleanup before favicon, header, or social preview use.");
  if (primary && !/svg|png|webp/i.test(format)) issues.push("Logo format is not a clean SVG, PNG, or WebP candidate.");
  return {
    status: !primary ? "block" : needsBackgroundCleanup ? "review" : "pass",
    primaryLogoSource: primary,
    candidates: logoCandidates,
    format: format || "unknown",
    backgroundCleanupRequired: needsBackgroundCleanup,
    requiredOutputs: [
      { file: "logo-light.webp", purpose: "header/footer on dark or image-backed sections" },
      { file: "logo-dark.webp", purpose: "header/footer on light sections" },
      { file: "logo-transparent.webp", purpose: "transparent mark for cards, OG image, and overlays" }
    ],
    usageRules: [
      "Use the official logo source first.",
      "Remove white or screenshot backgrounds before placing the mark in the header.",
      `Default public site mode: ${/dark/i.test(data.visualTone || "") ? "review template/client dark-mode intent" : "light mode unless the template/client explicitly calls for dark"}.`
    ],
    issues
  };
}

function buildGalleryPlan(packet, data) {
  const imageCandidates = unique([
    packet.brand?.galleryLink,
    packet.brand?.assetFolder,
    ...((packet.assetQa?.imageCandidates || []))
  ]);
  const duplicateGroups = packet.assetQa?.duplicateGroups || [];
  const slots = ["hero-primary", "home-gallery-1", "home-gallery-2", "home-gallery-3", "service-card-1", "service-card-2", "service-card-3", "about-proof", "service-area-visual", "og-source"];
  const folderPattern = /drive\.google\.com\/drive\/folders|dropbox\.com|sharepoint\.com|onedrive\.live\.com/i;
  const semanticSlots = imageCandidates.map((path, index) => {
    const isFolder = folderPattern.test(String(path));
    const isSourcePack = /\.zip|source-uploads|source-pack|asset-pack/i.test(String(path));
    return {
      id: `image-${index + 1}`,
      source: path,
      sourceType: isFolder ? "external-folder" : isSourcePack ? "source-pack" : /^https?:\/\//i.test(String(path)) ? "external-url" : "staged-or-uploaded",
      semanticSlot: isFolder ? "asset-folder-reference" : slots[Math.min(index, slots.length - 1)],
      altText: `${data.businessName || "Client"} ${slots[Math.min(index, slots.length - 1)].replace(/-/g, " ")}`,
      usePriority: isFolder ? "fetch-first" : index === 0 ? "hero/social candidate" : "gallery/supporting visual"
    };
  });
  const stagedVisuals = semanticSlots.filter(item => item.sourceType !== "external-folder");
  const photosExpected = /^yes|partial$/i.test(data.clientPhotosReceived || "");
  const reviewItems = [];
  if (photosExpected && stagedVisuals.length < 6) reviewItems.push("Client photos are expected, but fewer than 6 usable staged/direct image candidates are available.");
  if (duplicateGroups.length) reviewItems.push(`${duplicateGroups.length} duplicate gallery group${duplicateGroups.length === 1 ? "" : "s"} must be pruned before build.`);
  const layoutRequirements = [
    "Gallery must fill the full content width at desktop/tablet/mobile; no narrow single-column gallery may leave a dead right column.",
    "If 10+ usable images exist, create an organized browsing system: featured lead image or project card, full-width responsive masonry/grid/rail, lightbox, captions, alt text, and no more than four useful filters/categories.",
    "Do not default to repeated tilted Polaroid cards, floating photo-card piles, or decorative image stacks. Choose the gallery treatment that fits the client: immersive work wall, masonry, editorial rail, 3D hover grid, carousel, before/after slider, inventory wall, or featured-plus-grid.",
    "Filter controls must render as a horizontal segmented control on desktop with clear active/inactive states; no vertical stretched capsule filters.",
    "Filtering must animate or transition cards in/out and preserve the featured/lightbox path without collapsing the grid."
  ];
  return {
    status: photosExpected && !stagedVisuals.length ? "block" : reviewItems.length ? "review" : "pass",
    minimumRecommendedImages: photosExpected ? 10 : 0,
    dedupedImageCount: stagedVisuals.length,
    semanticSlots,
    duplicateGroups,
    layoutRequirements,
    reviewItems,
    stopRules: [
      "Do not use old template images when client photos are expected.",
      "If a folder URL is present, fetch or attach the actual image files when possible; if unavailable, use honest procedural/diagram/service visuals and do not fabricate project proof.",
      "Keep only one copy of duplicate gallery images.",
      "Stop before publish if a gallery renders as one narrow column while more than 25% of the content row is empty.",
      "Stop before publish if desktop gallery filters stack vertically, stretch into tall pills, or hide obvious filter choices.",
      "Stop before publish if 10+ photos are rendered as a repetitive decorative prop instead of an organized visual browsing system."
    ]
  };
}

function buildSocialPreviewPlan(packet, data, logoQa, galleryPlan) {
  const logoSource = logoQa.primaryLogoSource || "";
  const heroSource = (galleryPlan.semanticSlots || []).find(item => /hero|poster|banner/i.test(String(item.source)))?.source
    || (galleryPlan.semanticSlots || []).find(item => item.sourceType !== "external-folder")?.source
    || "";
  const hero = packet.compiled?.hero || packet.assetQa?.heroContract || {};
  const reviewItems = [];
  if (!data.faviconRequired) reviewItems.push("Favicon/social preview decision is missing.");
  if (!logoSource) reviewItems.push("No logo source is available for favicon or social preview.");
  if (!heroSource && !hero.generationRequired) reviewItems.push("No hero/OG source image is staged.");
  return {
    status: reviewItems.length ? "review" : "pass",
    faviconRequired: data.faviconRequired || "",
    sourcePriority: [
      logoSource ? `Logo: ${logoSource}` : "Logo: needs review",
      heroSource ? `Hero/OG source: ${heroSource}` : hero.generationRequired ? "Hero/OG source: generated hero poster from hero.json" : "Hero/OG source: needs review"
    ],
    requiredOutputs: [
      { file: "favicon.png", size: "32x32 or ICO fallback", source: "clean logo mark" },
      { file: "apple-touch-icon.png", size: "180x180", source: "clean logo mark with safe padding" },
      { file: "og-default.jpg", size: "1200x630", source: heroSource || "hero-poster.webp or brand/logo lockup" },
      { file: "hero-poster.webp", size: "template-specific", source: heroSource || "generated only if allowed" }
    ],
    reviewItems
  };
}

function buildPremiumVisualStack(packet = {}, data = {}, context = {}) {
  const services = context.services || packet.compiled?.services || [];
  const pagePlan = context.pagePlan || packet.pagePlan || packet.compiled?.pages || [];
  const galleryPlan = context.galleryPlan || packet.compiled?.galleryPlan || packet.assetQa?.galleryPlan || {};
  const logoQa = context.logoQa || packet.compiled?.logoQa || {};
  const remix = context.remix || packet.remix || packet.compiled?.remix || {};
  const serviceNames = services.map(service => service.name || service.title || service.slug).filter(Boolean).slice(0, 10);
  const routeNames = pagePlan.map(page => page.title || page.name || page.slug || "Page").filter(Boolean).slice(0, 10);
  const hasHeroAsset = Boolean(packet.compiled?.hero?.source || packet.assetQa?.heroContract?.source || packet.brand?.heroSourceMode || data.heroSourceMode);
  const hasVisualAssets = Boolean((galleryPlan.semanticSlots || []).length || packet.assetQa?.imageCandidates?.length || packet.sources?.images?.length);
  const hasBrand = Boolean(logoQa.primaryLogoSource || packet.brand?.logoLink || packet.compiled?.brand?.logoSource || data.brandColors);
  const hasFactBase = Boolean(data.businessName || packet.business?.businessName || packet.client?.businessName || packet.compiled?.client?.businessName);
  const missing = [];
  if (!hasFactBase) missing.push("business identity and verified intake facts");
  const designFallbacks = [];
  if (!hasBrand) designFallbacks.push("derive a temporary premium type/mark and palette from the intake, then flag it as not an official logo");
  if (!hasHeroAsset) designFallbacks.push("create a procedural, typographic, canvas, SVG, or abstract cinematic hero; do not pretend it is client project photography");
  if (!hasVisualAssets) designFallbacks.push("use ingredients-kit layouts, 21st.dev-style component patterns, iconography, motion, maps, diagrams, interactive galleries, and conversion widgets instead of waiting on a gallery");
  const creativeDirectorPreflight = buildCreativeDirectorPreflight({
    pages: routeNames,
    services: serviceNames,
    hasVisualAssets
  });

  return {
    version: "premium-visual-stack-v4",
    status: missing.length ? "needs_fact_confirmation" : "ready_for_original_vercel_design",
    purpose: "Use the intake as the verified fact/content layer only. Visual execution must start from ingredients-kit/source patterns, 21st.dev-quality components, real media when available, and honest fallbacks instead of collapsing into a generic brochure build.",
    runtimeTargets: [
      "WSS/compiler original build as the default production lane",
      "React/Next.js/Vite builds that use packet facts, content, SEO, schema, maps, and forms as source of truth",
      "A real ingredients-kit recipe, source TSX family, or named 21st.dev-style component family must be selected before coding the first viewport",
      "WSS only as an optional legacy/reference assembler when explicitly selected"
    ],
    preferredStack: {
      framework: "Next.js App Router or Vite/React on WSS for new external builds; preserve an existing framework only when the operator explicitly chooses a remix.",
      language: "TypeScript where a source project supports it.",
      styling: "Tailwind CSS or existing source-template CSS with tokenized brand colors, glass/material surfaces, clear button states, light default, and dark mode only when intentional.",
      ui: ["source components from ingredients-kit/source when available", "shadcn/ui", "Radix primitives", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge"],
      motion: "Motion for React / Framer-style scroll reveals, stagger, hover lift, video/hero depth, and reduced-motion support.",
      theme: "next-themes for Next builds; equivalent class/data-theme handling when remixing."
    },
    designLanguage: [
      "Cinematic hero with real video/photo depth when available; when media is missing, use procedural/abstract/typographic depth and never claim generated visuals are real jobs.",
      "Premium agency spacing, typography hierarchy, high-contrast CTAs, glass/material surfaces, and no generic Bootstrap-like or plain Vite brochure sections.",
      "Hero/page design contract: the first viewport must be a bespoke composition with a named hero recipe, client-specific motif, visible offer/location/CTA/trust cue, and media/procedural depth. It must not be a centered headline followed by a row of cards.",
      "Banned first-viewport patterns unless the user explicitly approves a rough draft: Polaroid/photo-card piles, card-first hero decks, three-service-card hero layouts, testimonial cards as the main hero, blank gradient/text slabs, fake SaaS dashboards, and any hero where the business itself is not the first signal.",
      "Bento/grid sections only when they help scan services, proof, process, pricing, or trust.",
      "Glass morphism and translucent panels should feel intentional and expensive: layered opacity, readable contrast, clean borders, strong shadows, and smooth hover/active states.",
      "Every inner page needs a designed hero or visual header, not a plain text slab.",
      "Default public site mode is light unless the client explicitly requires dark; dark heroes should be clear, dimensional, and readable.",
      "Design must feel custom and expensive: animated hero systems, signature motifs, interactive galleries/widgets, editorial rhythm, and polished mobile behavior are expected.",
      "Reference-polish bar: the first viewport should have a premium hero, smooth buttons, clean typography, and an interactive conversion widget with the polish of the strongest WSS/PageHub examples, not a flat placeholder.",
      "The visual idea must carry through the full scroll: every post-hero band needs its own treatment, component rhythm, content depth, and footer polish instead of dropping into a flat scaffold after the hero."
    ],
    reusableSections: [
      { name: "PremiumNavbar", required: ["logo slot with cleaned light/dark asset", "primary nav", "phone/quote CTA", "mobile sheet menu"] },
      { name: "HeroSection", required: ["eyebrow only if source-backed", "H1", "subhead", "primary CTA", "secondary CTA", "trust strip", "cinematic media"] },
      { name: "InteractivePlannerWidget", required: ["service chips", "timeline/urgency choice", "location or property context", "live summary", "CTA handoff to form/API"] },
      { name: "InteractiveGalleryWidget", required: ["real/source assets when available", "semantic filters", "lightbox or motion reveal", "decorative fallback clearly separated from proof"] },
      { name: "TrustBar", required: ["reviews or verified proof", "service area", "fast response/service badge", "credential logos when source-backed"] },
      { name: "BentoFeatureGrid", required: ["4-8 service/proof cards", "icons", "short copy", "responsive rhythm"] },
      { name: "LocalSEOSection", required: ["city/service answer blocks", "nearby areas", "map/directions CTA", "schema-aligned copy"] },
      { name: "TestimonialSection", required: ["verified review cards", "rating display", "source labels"] },
      { name: "FAQSection", required: ["SEO-friendly questions", "plain-language answers", "FAQ schema-ready content"] },
      { name: "FinalCTA", required: ["strong close", "phone/quote/directions actions", "form or Resend route when applicable"] }
    ],
    assetContract: {
      hero: ["hero-poster.webp 1920x1080 or verified muted MP4 loop", "hero-mobile.webp", "OG crop source 1200x630"],
      brand: ["logo-light.webp", "logo-dark.webp", "logo-transparent.webp", "favicon-source >=512px", "apple-touch-icon.png"],
      gallery: ["deduped gallery-01..08 files", "service-card image slots", "about/proof image slots", "for 10+ images: category map, captions, alt text, featured images, lightbox/filter behavior, and duplicate-pruned ordering"],
      qualityRules: ["clean/matte logo backgrounds", "dedupe repeated photos", "avoid old-template assets", "keep assets at root or clearly named first-level files", "generated/procedural visuals may support atmosphere and UI, but cannot be labeled as client proof, reviews, credentials, crews, or completed projects"]
    },
    routeExpectations: {
      pages: routeNames,
      services: serviceNames,
      rule: "Each listed page or service should have compiled copy, a visual header/hero, internal links, metadata, and schema-aligned content."
    },
    motionAndInteractionRules: [
      "Use scroll reveal, staggered cards, soft hover lift, sticky/mobile CTAs, and tasteful video or parallax depth.",
      "Do not add heavy dependency churn, chaotic animation, layout shift, or motion that hides content.",
      "Buttons, chips, cards, galleries, and widgets must have polished hover/active/focus states; unfinished default controls fail the visual gate.",
      "Respect prefers-reduced-motion and keep Lighthouse-friendly performance."
    ],
    visualReferenceVocabulary: [
      "21st.dev-inspired Hero Animated, Scroll Morph Hero, Video Scroll Hero, Aurora Background, Interactive Bento Gallery, Testimonial Slider, Magic Text Reveal, CTA Card, Interactive Map",
      "ingredients-kit hero families, nav/button variants, widget registry patterns, and real source TSX should be treated as reusable implementation ingredients, not merely mood-board inspiration.",
      "Use these as vocabulary for component quality and motion, not as permission to add random libraries without approval."
    ],
    firstPlanEcho: [
      "Confirm this is a WSS/compiler original build unless the operator explicitly chose a legacy reference/remix.",
      "Name the exact ingredients-kit recipe, source TSX family, or 21st.dev-style layout family being used; if no source exists, explain the fallback.",
      "Name the logo strategy: official cleaned logo, improved extraction, or provisional designed identity system.",
      "Describe the original hero art direction and fallback rule.",
      "Describe the custom conversion widget and service interaction.",
      "Summarize the creative director/design council preflight: full-scroll visual arc, section treatments, ingredient choices, content-depth map, signature motif, motion grammar, footer polish, and no flat scaffold after the hero.",
      "Confirm forms, map, favicon, OG, sitemap, schema, and WSS-only publish QA gates."
    ],
    creativeDirectorPreflight,
    creditPolicy: "Do not let missing visual assets force a bland build. Use packet facts as truth, then make premium visual decisions with ingredients-kit/source patterns, 21st.dev/shadcn-style ingredients, procedural art, source-backed assets, and QA verification. A plain scaffold is a failed build unless the user explicitly asked for rough draft speed.",
    designFallbacks,
    missing
  };
}

function buildCreativeDirectorPreflight(context = {}) {
  const pages = Array.isArray(context.pages) ? context.pages.filter(Boolean).slice(0, 12) : [];
  const services = Array.isArray(context.services) ? context.services.filter(Boolean).slice(0, 12) : [];
  return {
    version: "creative-director-design-council-preflight-v1",
    status: "required_before_build",
    requiredBeforeBuild: true,
    purpose: "Force a full-site visual concept before build while keeping packet facts, source-backed proof, map policy, forms, schema, and claims as the non-negotiable truth layer.",
    requiredOutputs: [
      "full-scroll visual arc from hero through final CTA/footer",
      "page-by-page bespoke design council checklist: hero recipe, section rhythm, asset role, interaction, CTA path, SEO/schema block, QA risk, and mobile treatment for each route",
      "section-by-section treatment for every planned page band",
      "component/ingredient selection with named source, ingredients-kit, or 21st.dev-style patterns",
      "content-depth mapping that assigns compiled content, proof, FAQs, service copy, and local SEO blocks to designed sections",
      "signature motif that repeats across hero, cards, dividers, icons, map, forms, and footer",
      "motion grammar for reveals, transitions, hover states, galleries, widgets, and reduced-motion behavior",
      "footer polish: NAP, service links, map/directions, social/sameAs, form CTA, logo treatment, schema/canonical consistency",
      "explicit no-flat-scaffold-after-hero plan for all post-hero sections",
      "dead-space audit for every desktop/tablet/mobile section: no unused columns, full-width overlays, stranded headings, clipped cards, or blank slabs",
      "gallery rhythm plan: horizontal segmented filters, full-width responsive grid/masonry/carousel for 10+ images, animated filtering, dimensional/3D or tactile hover/swipe treatment, and intentional featured/lightbox behavior",
      "banned first-viewport scan: no Polaroid/photo-card piles, card-first hero decks, three-service-card hero layouts, testimonial cards as the main hero, blank gradient/text slabs, or fake SaaS dashboard hero unless specifically approved"
    ],
    firstPlanMustAnswer: [
      `Which pages/sections are being visually treated? ${pages.length ? pages.join(", ") : "Use page plan and content-route-map.json."}`,
      `Which service/content depth blocks receive designed treatment? ${services.length ? services.join(", ") : "Use services.json and content files."}`,
      "What is the signature motif, and how does it appear beyond the hero?",
      "What ingredient/component families are selected, and where are they used?",
      "What motion grammar is used, and how is reduced motion respected?",
      "How does the footer feel finished rather than leftover?",
      "How are gallery, map, FAQ/answer, forms, and footer tested before publish?"
    ],
    stopRules: [
      "Stop before build if the plan only describes a hero and leaves the rest of the page as generic stacked sections.",
      "Stop before build if section treatments do not map to the compiled content depth, page plan, services, proof, local SEO blocks, forms, and footer.",
      "Stop before build if visual ideas require fake project photos, fake reviews, fake credentials, unsupported guarantees, invented geo data, or old-client residue.",
      "Stop before build if the first viewport is card-first: card/photo/testimonial/service tile stacks dominate before the brand, offer, location, CTA, trust cue, and visual idea are clear.",
      "Stop before build if the gallery plan can leave a dead right column, vertical stretched filters, hidden image sets, or unanimated jumpy filtering.",
      "Stop before build if map/story/gallery/FAQ controls are decorative, dead, duplicated, or not wired to a real interaction.",
      "Do not override factual safeguards: verified packet facts, exact service names, form routing, map/GBP policy, schema/canonical data, and source-backed reviews/trust cues stay authoritative."
    ]
  };
}

function buildVisualSystemContract(packet = {}, data = {}, context = {}) {
  const remix = context.remix || packet.remix || packet.compiled?.remix || {};
  const template = remix.template || {};
  const hero = packet.compiled?.hero || packet.assetQa?.heroContract || {};
  const galleryPlan = context.galleryPlan || packet.compiled?.galleryPlan || packet.assetQa?.galleryPlan || {};
  const logoQa = context.logoQa || packet.compiled?.logoQa || {};
  const services = context.services || packet.compiled?.services || [];
  const pagePlan = context.pagePlan || packet.pagePlan || [];
  const serviceNames = services.map(service => service.name || service.title || service.slug).filter(Boolean);
  const premiumVisualStack = context.premiumVisualStack || packet.compiled?.premiumVisualStack || buildPremiumVisualStack(packet, data, { remix, logoQa, galleryPlan, services, pagePlan });
  const creativeDirectorPreflight = premiumVisualStack.creativeDirectorPreflight || buildCreativeDirectorPreflight({
    pages: pagePlan.map(page => page.title || page.name || page.slug || "Page").filter(Boolean),
    services: serviceNames,
    hasVisualAssets: Boolean((galleryPlan.semanticSlots || []).length)
  });
  const hasHeroMode = Boolean(hero.variant || data.heroSourceMode || hero.brief);
  const hasLogo = Boolean(logoQa.primaryLogoSource || packet.brand?.logoLink || packet.compiled?.brand?.logoSource);
  const hasFactBase = Boolean(data.businessName || packet.business?.businessName || packet.client?.businessName || packet.compiled?.client?.businessName);
  const photosExpected = /^yes|partial$/i.test(String(data.clientPhotosReceived || ""));
  const stagedImages = (galleryPlan.semanticSlots || []).filter(item => item.sourceType !== "external-folder");
  const missing = [];
  if (!hasFactBase) missing.push("verified business identity and source facts");
  const reviewItems = [];
  if (!hasHeroMode) reviewItems.push("No locked hero mode; builder must create a premium procedural, typographic, abstract, or source-backed hero treatment.");
  if (!hasLogo) reviewItems.push("No official logo source; builder may create a temporary typographic mark but must not call it the client logo.");
  if (photosExpected && stagedImages.length < 6) reviewItems.push("Client photos are expected but not staged; builder must not fabricate project proof.");

  const preservePrimitives = [
    "source-backed ingredients-kit animated hero / blueprint / scroll-morph / video-hero structure selected before coding",
    "21st.dev-style premium nav, modern mobile menu, and sticky CTA behavior",
    "interactive bento service grid, spotlight cards, and icon-led service scanning",
    "custom estimator, quote, booking, or diagnostic funnel instead of a plain form",
    "interactive gallery/lightbox/filter treatment when real assets exist; decorative visual system when they do not",
    "map/directions/service-area conversion rail using verified map policy",
    "testimonial/review components only when review quotes or ratings are source-backed",
    "procedural SVG/canvas/gradient/noise/topographic/blueprint systems for atmosphere",
    "motion grammar: scroll reveal, stagger, hover lift, count-up only when source-backed, and reduced-motion support"
  ];
  const enrichmentMandates = [
    "Start from a best-fit ingredients-kit recipe, source TSX family, or named 21st.dev-style component family; do not begin from a blank/plain scaffold unless explicitly approved.",
    "Invent an original visual direction from the ingredient patterns; do not preserve a prior client template just because it exists.",
    "Make the hero the highest-value surface: cinematic, readable, brand-specific, mobile-aware, and backed by real media/video when available or honest procedural/abstract art when not.",
    "Ban card-first first viewports: no Polaroid/photo-card piles, no three-service-card row as the hero, no testimonial-card hero, no generic dashboard card as local-service proof, and no flat page that becomes plain stacked cards after the hero.",
    "Transform the lead area into an industry-specific funnel with service choices, urgency/timeline, location, contact preference, and next-step CTA.",
    "Use gallery assets as proof only when real/source-backed; otherwise use diagrams, icons, maps, glass UI cards, and abstract/procedural visuals without fake project claims.",
    "Use local trust visually: map/directions, service-area chips, source-backed review/trust cues, schema-consistent sameAs/social links, and clean CTA routing.",
    "Build a complete premium brand system: light/dark mark handling, accessible contrast, balanced palette, polished spacing, and no one-note color wash.",
    "Complete the creative director/design council preflight before build: full-scroll visual arc, section-by-section treatments, ingredient choices, content-depth map, signature motif, motion grammar, footer polish, and no flat scaffold after the hero."
  ];
  const qaGates = [
    "First viewport is nonblank, cinematic, readable, and brand-specific on desktop and mobile.",
    "First viewport passes the anti-card-first scan: the business, offer, location, CTA, trust cue, and visual idea are primary; cards/photos support the hero instead of being the hero.",
    "Ingredient patterns are adapted into an original build, not copied as stale demo/client content.",
    "No old-client visual residue remains in images, logo, alt text, map, schema, OG image, favicon, or hidden constants.",
    "Hero, widget, gallery, map, forms, and sticky CTA all point to the same verified client facts.",
    "Generated/procedural/stock visuals are allowed for atmosphere, abstract art, icons, diagrams, and UI support unless explicitly forbidden; they must never be presented as real project photos, reviews, licenses, credentials, guarantees, crews, or before/after proof.",
    "Text does not overlap, clip, or crowd buttons/cards at mobile and desktop breakpoints.",
    "No plain scaffold passes QA: first viewport, post-hero sections, buttons, cards, galleries, widgets, and footer must show ingredient-kit/source-template polish before publish.",
    "Visual enrichment is done in the same build pass with browser screenshots or equivalent viewport QA."
  ];

  return {
    version: "visual-wow-contract-v2",
    status: missing.length ? "needs_fact_confirmation" : "ready_for_original_premium_build",
    mandate: "The intake is a fact and content source, not a design cage. Build an original, premium, WSS-ready site using the ingredients kit and packet truth; avoid fake claims and old-template residue.",
    creditPolicy: "Spend design effort on original premium execution. Do not spend time asking for a selected template or waiting for photos when honest procedural/abstract/interactive visuals can carry the build.",
    templateFingerprint: {
      required: false,
      templateName: template.remixTemplateName || template.localTemplateName || packet.selectedTemplateName || "",
      templateUrl: template.remixTemplateUrl || "",
      preservePrimitives,
      forbiddenDeletes: ["verified business facts", "protected service names", "form routing", "map/GBP policy", "schema/canonical data", "source-backed reviews/trust cues", "no-old-client-residue gate"]
    },
    heroEnrichment: {
      sourceMode: hero.variant || data.heroSourceMode || "Create an original premium hero using real media when available or honest procedural/abstract/typographic visuals when not.",
      requiredOutput: hero.requiredOutput || "Cinematic nonblank first viewport with brand, service area, primary CTA, secondary CTA, and readable mobile crop.",
      brief: hero.brief || `${data.businessName || "Client"} needs a premium, local, service-specific hero for ${data.serviceArea || "the service area"}.`,
      qualityBar: [
        "Use depth, contrast, motion, and signature visual language instead of a flat slab.",
        "Hero should feel custom, expensive, and clear while preserving readability.",
        "Cards, photo tiles, Polaroid treatments, and testimonial blocks may support the hero only after the primary hero composition is established; they cannot be the first-viewport concept.",
        "Primary CTA, secondary CTA, trust cue, and service-area cue must be visible without crowding.",
        "Mobile first viewport must still show brand, offer, and one clear action."
      ]
    },
    widgetEnrichment: {
      directive: "Create a custom industry funnel; never settle for a plain contact form unless the build scope explicitly demands it.",
      serviceOptions: serviceNames.slice(0, 8),
      requiredSignals: ["service needed", "urgency/timeline", "location/service area", "best contact method", "next step CTA"]
    },
    galleryEnrichment: {
      directive: "Use real client/Drive/source assets as proof when available. If not available, use diagrams, service cards, maps, and procedural visuals without fake project claims. For 10+ images, organize them into a full-width browsing system with featured images, captions, alt text, categories/filters, lightbox/detail behavior, and deduped ordering.",
      availableSlots: galleryPlan.semanticSlots || [],
      minimumWhenPhotosExpected: photosExpected ? 6 : 0,
      duplicatePolicy: "Deduplicate and keep the strongest crop for each visual role.",
      antiPatternPolicy: "Do not render 10+ images as a repetitive Polaroid/photo-card prop. If images are proof, make them browseable; if they are decorative, label them as decorative and keep them secondary."
    },
    brandEnrichment: {
      logoSource: logoQa.primaryLogoSource || packet.brand?.logoLink || "",
      palette: data.brandColors || packet.brand?.brandColors || "",
      tone: data.visualTone || packet.brand?.visualTone || "premium, polished, trustworthy",
      requiredBehavior: ["light/dark logo handling", "header contrast over hero", "button states", "favicon/OG polish"]
    },
    localTrustEnrichment: {
      serviceArea: data.serviceArea || packet.business?.serviceArea || "",
      pageCount: pagePlan.length,
      serviceCount: serviceNames.length,
      visualSignals: ["service-area chips", "directions/map CTA", "source-backed review/trust cues", "internal links to services/contact"]
    },
    creativeDirectorPreflight,
    premiumVisualStack,
    enrichmentMandates,
    firstResponseRequired: [
      "Name the exact ingredient/source-template/layout family you will adapt, including component placement.",
      "Describe the original hero treatment and honest media/procedural fallback.",
      "Describe the creative director/design council preflight: full-scroll visual arc, section-by-section treatments, ingredient choices, content-depth map, signature motif, motion grammar, footer polish, and no flat scaffold after the hero.",
      "Describe the custom widget or lead-funnel transformation.",
      "Describe the proof strategy and state whether gallery visuals are source-backed or decorative.",
      "List the visual QA gates you will satisfy before publish."
    ],
    stopRules: [
      "Stop before build if verified business identity, contact routing, or map/domain policy is missing.",
      "Stop before build if the plan uses fake project photos, fake reviews, fake credentials, unsupported guarantees, or old-client residue.",
      "Stop before build if the plan starts from a blank/plain scaffold without a selected ingredient/source-template family and no explicit rough-draft approval.",
      "Stop before build if the first viewport is card-first, Polaroid-first, photo-card-first, testimonial-card-first, or a centered hero plus three service cards.",
      "Do not stop merely because a template, hero image, logo, or gallery is missing; create an honest premium fallback and flag what remains unofficial.",
      "Stop before publish if the first viewport is blank, generic, old-client, unreadable, or missing CTAs."
    ],
    qaGates,
    reviewItems,
    missing
  };
}

function buildRemixFallback(packet, data) {
  const driveFolders = externalAssetFoldersFromPacket(packet).filter(url => /drive\.google/i.test(String(url)));
  const lane = /multi|premier|authority/i.test(`${packet.selectedBuildLane || ""} ${packet.templateFamily || ""} ${data.siteType || ""}`)
    ? "Premier multi-page remix"
    : "Single-page scroll remix";
  return {
    version: "remix-v1",
    status: "review",
    missing: [],
    lane,
    mode: data.lovableMode || "Plan first, then build",
    planModeRequired: true,
    promptRoute: /premier|multi/i.test(lane)
      ? "Prompt B plus Prompt D pattern: premier 5-8 page authority build, Plan mode first, then one production build pass."
      : "Prompt A plus Prompt C pattern: one-page cinematic scroll, compact source extraction, one production build pass.",
    sourcePointers: {
      gmailUrl: packet.sources?.gmailUrl || "",
      publicWebsiteUrl: packet.sources?.urls?.[0] || data.domainUrl || "",
      googleBusinessUrl: data.gbpLink || "",
      socialUrl: "",
      driveFolders,
      sourceUrls: packet.sources?.urls || []
    },
    template: {
      localTemplateId: packet.selectedTemplateId || "",
      localTemplateName: packet.selectedTemplateName || "",
      localTemplateFamily: packet.templateFamily || "",
      remixTemplateUrl: data.remixTemplateUrl || "",
      remixTemplateName: data.remixTemplateName || packet.selectedTemplateName || "",
      preserveTemplateStrengths: [
        "overall visual polish, responsive layout rhythm, cinematic motion quality, strong hero/gallery treatments, side-by-side section grammar, and working component structure",
        "custom widget/lead-funnel architecture, calculators/estimators/question funnels, count-ups, cursor-light/marquee/overlay utilities, animation primitives, and map/form wiring should be re-skinned for the new industry instead of deleted",
        "do not preserve the old client's copy, identity, NAP, imagery, schema, forms recipients, social preview, sitemap, metadata, domain strings, or hidden constants"
      ]
    },
    singlePassReskin: buildSinglePassReskinSpec(packet, data),
    packetDeltaFix: buildPacketDeltaFixSpec(packet, data),
    sanitationChecklist: [
      "Remove all previous client identity, metadata, schema, routes, assets, forms, social preview, canonical URLs, sitemap entries, and hidden constants.",
      "Regenerate public identity and SEO files from the current packet only.",
      "Sanitize content and data, not the reusable template fingerprint. Preserve and re-skin cinematic motion primitives, section structure, widget architecture, gallery behavior, count-ups, cursor/marquee/overlay effects, map/form wiring, and responsive layout rhythm."
    ],
    optimizationChecklist: [
      "Read GEO-VOICE-LOCAL-SEARCH-PLAN.md and search-optimization-plan.json before planning or building.",
      "Use attached BRIGHTDATA-SERP-AUDIT.md and brightdata-query-plan.json before running new search work; run Bright Data only when the audit is missing/not_configured and disclose fallback source if unavailable.",
      "Map primary, secondary, local, GEO, and voice-search targets to visible page content, FAQs, schema, internal links, and CTAs.",
      "Read LOCAL-PRESENCE-CONVERSION-PLAN.md and local-presence-plan.json before planning or building.",
      "Fingerprint the remix template before editing: document the reusable hero archetype, motion system, section order, side-by-side blocks, custom widget/lead-funnel, gallery treatment, counters, cursor/marquee/overlay effects, and map/form placements. Re-skin those primitives for the new client instead of replacing them with a generic from-scratch layout.",
      "If SINGLE-PASS-RESKIN-PACKET.md is complete, do not scrape, invent, or substitute generic stock imagery. Use the attached/uploaded asset pack and brand spec verbatim, then build the reskin in one deterministic pass.",
      "If the single-pass asset pack is incomplete, stop in Plan mode with the exact missing checklist before build credits are spent. Use Firecrawl/source scrape only as an explicit fallback for missing or contradictory facts, not as the default first pass.",
      "Build Apple Maps, Google Maps/directions, map embed policy, source-backed social links, finance/payment/gallery CTAs, internal links, schema, and light/dark header/logo behavior in the first production pass.",
      "Verify slugs, canonical URLs, sitemap hints, schema, OG image, favicon, form routing, exact services, mobile layout, and no old client residue.",
      "If Gmail, Drive, Maps, or Resend are not linked yet, trigger the connector picker in this exact order: Gmail -> Google Drive -> Maps -> Resend. Trigger Firecrawl only when the single-pass asset pack is incomplete, contradictory, or operator-approved for fallback/source verification."
    ],
    operatorNotes: data.remixOperatorNotes || "",
    assetAccessMode: driveFolders.length ? "Use connected Google Drive first." : "Use uploaded/direct assets and packet permissions."
  };
}

function buildSinglePassReskinSpec(packet, data = {}) {
  const business = packet.business || {};
  const brand = packet.brand || {};
  const requirements = packet.requirements || {};
  const sources = packet.sources || {};
  const uploadedFiles = sources.uploadedFiles || packet.assetQa?.uploadedAssetFiles || [];
  const imageCandidates = packet.assetQa?.imageCandidates || [];
  const photosCount = Math.max(uploadedFiles.filter(file => /\.(jpe?g|png|webp|avif)$/i.test(String(file.name || file))).length, imageCandidates.length);
  const paletteCount = Array.isArray(sources.palette) ? sources.palette.length : splitLines(brand.brandColors).filter(Boolean).length;
  const pageCount = Array.isArray(packet.pagePlan) ? packet.pagePlan.length : 0;
  const serviceCount = (packet.goldenArtifacts?.exactServices || []).length;
  const checks = [
    ["Logo SVG + PNG light/dark", Boolean(brand.logoLink || packet.compiled?.brand?.logoSource || packet.assetQa?.logoCandidates?.length)],
    ["Favicon source >=512px", Boolean(brand.faviconSource || brand.faviconLink || sources.faviconSource || packet.compiled?.socialPreviewPlan?.faviconRequired || packet.compiled?.logoQa?.requiredOutputs?.length)],
    ["6 brand hex values", paletteCount >= 6],
    ["Heading + body font names", Boolean(
      (brand.fonts?.display || brand.headingFont || brand.displayFont)
      && (brand.fonts?.body || brand.bodyFont)
    )],
    ["8-12 real photos named by use", photosCount >= 8],
    ["Hero image or hero loop video", Boolean(packet.compiled?.hero?.source || brand.heroSourceMode || packet.assetQa?.heroContract?.sourcePriority?.length)],
    ["Tagline + 2-sentence description", Boolean(business.tagline && business.description)],
    ["Per-page H1, intro, bullets, FAQs", pageCount > 0 && Boolean(packet.compiled?.contentQuality?.totalFiles || requirements.pagesNeeded)],
    ["Trust-signal numbers for CountUps", Boolean(requirements.trustSignals || business.reviewCount || business.rating || business.yearsInBusiness)],
    ["Final nav keep/add/delete list", Boolean(requirements.pagesNeeded || requirements.routeMap || pageCount)],
    ["Contact block", Boolean(business.phone && business.email && (business.address || business.serviceArea))],
    ["Service-area town list", Boolean(business.serviceArea || data.serviceArea)],
    ["Connectors needed", Boolean(requirements.connectorsNeeded || requirements.formsRouting || requirements.mapMode)],
    ["Production domain + schema.org type", Boolean((business.domainUrl || data.domainUrl) && (requirements.schemaType || business.schemaType))]
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return {
    version: "single-pass-reskin-v1",
    status: missing.length ? "needs_asset_pack" : "ready_for_one_pass_reskin",
    targetCredits: "1-2 when ready; do not build if needs_asset_pack.",
    directive: "Reskin remix, keep all motion, replace only brand/copy/imagery/routes.",
    doNotDelete: ["CursorLight", "Marquee", "CountUp", "SchematicOverlay", "TopBar", "Hero motion", "src/components/site/* primitives"],
    sourcePolicy: missing.length
      ? "Stop in Plan mode and request the missing asset-pack items before building. Use Firecrawl/source scrape only if the operator explicitly approves fallback discovery."
      : "Use the uploaded/attached asset pack and brand spec verbatim. Do not scrape, invent, or substitute generic stock imagery.",
    requiredChecklist: checks.map(([label, ok]) => ({ label, status: ok ? "present" : "missing" })),
    missing
  };
}

function buildPacketDeltaFixSpec(packet, data = {}) {
  const pagePlan = Array.isArray(packet.pagePlan) && packet.pagePlan.length
    ? packet.pagePlan
    : (Array.isArray(packet.compiled?.pages) ? packet.compiled.pages : []);
  const exactServices = packet.goldenArtifacts?.exactServices || (Array.isArray(packet.compiled?.services)
    ? packet.compiled.services.map(service => service.name || service.title || service.slug).filter(Boolean)
    : []);
  return {
    version: "packet-delta-fix-v1",
    mode: "post-build surgical correction",
    sourceOfTruth: [
      "compiled packet attachments are authoritative",
      "current public/client website is secondary only when the packet lacks a fact",
      "no new features, claims, pages, services, social profiles, GBP/Place ID, geo, review counts, licenses, warranties, financing, emergency promises, or schema outside the packet"
    ],
    creditGuard: [
      "do not replay the full build prompt",
      "do not run Bright Data or Firecrawl when packet audit/source artifacts already exist",
      "no new motion, video, asset generation, dependency installs, or redesign unless explicitly approved"
    ],
    targetFiles: [
      "snapshot.json",
      "manifest.json",
      "client.json",
      "brand.json",
      "search-optimization-plan.json",
      "local-presence-plan.json",
      "pages.json",
      "services.json",
      "forms.json",
      "seo.json",
      "golden-artifacts.json"
    ],
    packetTargets: {
      businessName: packet.business?.businessName || data.businessName || "",
      canonicalDomain: packet.business?.domainUrl || data.domainUrl || packet.requirements?.productionDomain || "",
      pagePlanCount: pagePlan.length,
      exactServices,
      primaryKeyword: packet.requirements?.primaryKeyword || data.primaryKeyword || packet.compiled?.searchOptimizationPlan?.primaryKeyword || "",
      formRouting: packet.requirements?.formsRouting || packet.compiled?.forms?.leadTo || packet.business?.email || ""
    },
    auditCategories: [
      "route/nav/sitemap/footer vs pages.json",
      "business constants vs client.json and brand.json",
      "services/service areas vs exactServices and packet service areas",
      "contact form, API, Resend routing, and hidden source fields vs forms.json",
      "CTA and map behavior vs local-presence-plan.json",
      "schema vs seo.json and local-presence-plan.json",
      "H1/title/meta vs search-optimization-plan pageTargets",
      "content honesty grep for unsupported claims",
      "robots, sitemap, social preview, favicon, manifest, and old-template residue",
      "header/logo light-dark contrast without changing approved motion"
    ],
    finalResidueProbe: "D-Lux|Pools|Septic|Citronelle|Mobile County|dluxpoolsseptic|lorem|placeholder|alex@woodward"
  };
}

function buildCompilerProofSummary(packet, compiled) {
  const preflight = compiled.preflight || packet.readiness?.preflight || {};
  const locks = packet.productionLocks || compiled.productionLocks || preflight.productionLocks || [];
  const lockBlocks = locks.filter(check => check.status === "block");
  const lockReviews = locks.filter(check => check.status === "review");
  const assetQa = packet.assetQa || {};
  const externalFolders = externalAssetFoldersFromPacket(packet);
  const searchPlan = compiled.searchOptimizationPlan || {};
  const mapSdkContract = compiled.mapSdkContract || compiled.localPresencePlan?.mapSdkContract || buildMapSdkContract({ ...(packet.business || {}), ...(packet.brand || {}), ...(packet.requirements || {}) }, undefined, packet);
  return {
    generatedAt: new Date().toISOString(),
    businessName: packet.business?.businessName || packet.packetName || "",
    status: preflight.status || "not_compiled",
    targetCredits: preflight.targetCredits || "<=6",
    rescueRisk: preflight.rescueRisk || "Unknown",
    selectedTemplate: packet.selectedTemplateName || compiled.manifest?.selectedTemplateName || "",
    selectedTemplateId: packet.selectedTemplateId || compiled.manifest?.selectedTemplateId || "",
    pageCount: Array.isArray(packet.pagePlan) ? packet.pagePlan.length : 0,
    routeCount: preflight.counts?.routes || compiled.manifest?.routes?.length || 0,
    contentFiles: compiled.contentQuality?.totalFiles || 0,
    contentWords: compiled.contentQuality?.totalWords || 0,
    assets: {
      logoCandidates: (assetQa.logoCandidates || []).length,
      imageCandidates: (assetQa.imageCandidates || []).length,
      uploadedFiles: (assetQa.uploadedAssetFiles || packet.sources?.uploadedFiles || []).length,
      externalAssetFolders: externalFolders.length,
      duplicateGroups: (assetQa.duplicateGroups || []).length
    },
    assetStatus: assetQa.status || "not_run",
    logoStatus: compiled.logoQa?.status || "not_run",
    galleryStatus: compiled.galleryPlan?.status || "not_run",
    socialPreviewStatus: compiled.socialPreviewPlan?.status || "not_run",
    searchOptimizationStatus: searchPlan.status || preflight.searchGate?.status || "not_run",
    brightDataPreferred: preflight.searchGate?.brightDataPreferred === true,
    brightDataAuditStatus: compiled.brightDataAudit?.status || preflight.searchGate?.brightDataAuditStatus || "planned",
    brightDataLiveQueries: compiled.brightDataAudit?.queries?.length || preflight.searchGate?.brightDataLiveQueries || 0,
    brightDataPlannedQueries: compiled.brightDataQueryPlan?.queries?.length || preflight.searchGate?.brightDataPlannedQueries || 0,
    primaryKeyword: searchPlan.primaryKeyword || preflight.searchGate?.primaryKeyword || "",
    searchTargetCount: preflight.searchGate?.targetCount || (searchPlan.secondaryKeywords || []).length + (searchPlan.primaryKeyword ? 1 : 0),
    mapsSdkStatus: mapSdkContract.status,
    mapsConnectorEnv: mapSdkContract.connector.env,
    mapId: mapSdkContract.mapId,
    geoVerified: mapSdkContract.geo.verified,
    serviceRadiusMiles: mapSdkContract.serviceRadiusMiles,
    cityMarkerCount: Object.keys(mapSdkContract.cityCoordinatePlan.coords || {}).length,
    missingCityCoords: mapSdkContract.cityCoordinatePlan.missing || [],
    localPresenceStatus: compiled.localPresencePlan?.status || preflight.localPresenceGate?.status || "not_run",
    localPresenceCtaCount: compiled.localPresencePlan?.ctaMigration?.requiredCtas?.length || 0,
    premiumVisualStackStatus: compiled.premiumVisualStack?.status || preflight.visualGate?.premiumVisualStackStatus || "not_run",
    visualSystemStatus: compiled.visualSystemContract?.status || preflight.visualGate?.status || "not_run",
    creativeDirectorPreflightStatus: compiled.visualSystemContract?.creativeDirectorPreflight?.status || preflight.visualGate?.creativeDirectorPreflightStatus || "required_before_build",
    visualEnrichmentMandates: compiled.visualSystemContract?.enrichmentMandates?.length || 0,
    visualQaGates: compiled.visualSystemContract?.qaGates?.length || 0,
    productionLockBlocks: lockBlocks.map(check => `${check.label || check.key}: ${check.detail || ""}`),
    productionLockReviews: lockReviews.map(check => `${check.label || check.key}: ${check.detail || ""}`),
    missingCritical: preflight.missingCritical || assetQa.missingCritical || [],
    underSixReady: preflight.status === "under_6_ready",
    hardStop: (preflight.missingCritical || []).length > 0 || lockBlocks.length > 0,
    nextAction: preflight.status === "under_6_ready"
      ? "Use the compiled packet as source copy and run one production build pass."
      : "Fix the listed blockers before spending builder credits."
  };
}

function normalizeSearchOptimizationPlan(existing, fallback = {}) {
  const source = existing && typeof existing === "object" ? existing : {};
  const plan = { ...fallback, ...source };
  plan.secondaryKeywords = Array.isArray(source.secondaryKeywords) ? source.secondaryKeywords : (fallback.secondaryKeywords || []);
  plan.localModifiers = Array.isArray(source.localModifiers) ? source.localModifiers : (fallback.localModifiers || []);
  plan.sourceStrategy = { ...(fallback.sourceStrategy || {}), ...(source.sourceStrategy || {}) };
  plan.localSearch = { ...(fallback.localSearch || {}), ...(source.localSearch || {}) };
  plan.technicalRequirements = { ...(fallback.technicalRequirements || {}), ...(source.technicalRequirements || {}) };
  plan.voiceSearch = { ...(fallback.voiceSearch || {}), ...(source.voiceSearch || {}) };
  plan.pageTargets = Array.isArray(source.pageTargets) ? source.pageTargets : (fallback.pageTargets || []);
  plan.qaGates = Array.isArray(source.qaGates) ? source.qaGates : (fallback.qaGates || []);
  plan.status = plan.status || fallback.status || (plan.primaryKeyword ? "compiled" : "review");
  return plan;
}

function buildBrightDataQueryPlan(packet, data, searchPlan) {
  const labels = certifiedVisitorServices(packet);
  const targets = intakeQuality.queryTargets(data, labels);
  return { version: "brightdata-serp-query-plan-v1", generatedAt: new Date().toISOString(),
    status: targets.length ? "planned" : "review", publicationPolicy: "research_only_not_business_facts",
    provider: "Bright Data Direct API", endpoint: "https://api.brightdata.com/request", zone: "serp_api3",
    format: "raw", defaultCountry: "us", defaultLanguage: "en", maxQueries: targets.length,
    costGuard: "At most 6 queries, each using one bounded market and an accepted service.",
    credentialPolicy: "Server-side only; no credentials belong in packet artifacts.",
    queries: targets.map((query, index) => ({ id: `serp-${index + 1}`, keyword: query, query,
      intent: "service and market research; not verification of a business claim",
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en&gl=us&pws=0`,
      expectedUse: ["research-only keyword and FAQ candidates; manual relevance review required"] })) };
}

function normalizeBrightDataAudit(audit, queryPlan, searchPlan, data = {}) {
  const source = audit && typeof audit === "object" ? audit : {};
  const queries = Array.isArray(source.queries) ? source.queries : [];
  const aggregate = source.aggregate && typeof source.aggregate === "object" ? source.aggregate : {};
  return {
    version: "brightdata-serp-audit-v1",
    status: source.status || (queries.length ? "compiled" : "planned"),
    generatedAt: source.generatedAt || new Date().toISOString(),
    businessName: source.businessName || data.businessName || "",
    primaryKeyword: source.primaryKeyword || searchPlan.primaryKeyword || "",
    provider: "Bright Data Direct API",
    endpoint: "https://api.brightdata.com/request",
    zone: source.zone || queryPlan.zone || "serp_api3",
    responseFormat: "raw",
    credentialPolicy: "Server-side only. Do not expose API keys or proxy credentials in prompts, public code, packet files, or screenshots.",
    note: source.note || (queries.length ? "Live Bright Data audit attached." : "Query plan attached; live audit has not run yet."),
    publicationPolicy: "research_only_not_business_facts",
    research: { relevance: "unverified", competitorDomainObservations: source.research?.competitorDomainObservations || aggregate.topCompetitorDomains || [], recommendationObservations: source.research?.recommendationObservations || source.firstPassRecommendations || null },
    queryPlan,
    queries,
    aggregate: {
      topCompetitorDomains: [], // Research observations are not verified competitors.
      titlePatterns: aggregate.titlePatterns || [],
      questionIdeas: aggregate.questionIdeas || searchPlan.voiceSearch?.questions || [],
      contentGaps: aggregate.contentGaps || ["Run live audit or use query plan plus source facts before build."],
      schemaPriorities: aggregate.schemaPriorities || ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
      internalLinkPriorities: aggregate.internalLinkPriorities || [],
      ctaPriorities: aggregate.ctaPriorities || ["call", "estimate/contact form", "directions/map", "source-backed reviews"]
    },
    firstPassRecommendations: {
      pageTitles: (searchPlan.pageTargets || []).map(page => ({ page: page.page, slug: page.slug, titleTarget: page.targetKeyword, h1Target: page.targetKeyword })),
      h2Themes: ["Local proof", "Process", "FAQ answers", "Service-area coverage"],
      faqIdeas: searchPlan.voiceSearch?.questions || [],
      schema: ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
      qaGates: ["No competitor text copied.", "SERP observations require relevance/provenance review; they cannot add business facts."]
    }
  };
}

function normalizeLocalPresencePlan(existing, fallback = {}) {
  const source = existing && typeof existing === "object" ? existing : {};
  const plan = { ...fallback, ...source };
  plan.mapAndDirections = { ...(fallback.mapAndDirections || {}), ...(source.mapAndDirections || {}) };
  plan.socialLinks = Array.isArray(source.socialLinks) ? source.socialLinks : (fallback.socialLinks || []);
  plan.ctaMigration = { ...(fallback.ctaMigration || {}), ...(source.ctaMigration || {}) };
  plan.ctaMigration.requiredCtas = Array.isArray(source.ctaMigration?.requiredCtas)
    ? source.ctaMigration.requiredCtas
    : (fallback.ctaMigration?.requiredCtas || []);
  plan.internalLinkStrategy = { ...(fallback.internalLinkStrategy || {}), ...(source.internalLinkStrategy || {}) };
  plan.internalLinkStrategy.requiredLinks = Array.isArray(source.internalLinkStrategy?.requiredLinks)
    ? source.internalLinkStrategy.requiredLinks
    : (fallback.internalLinkStrategy?.requiredLinks || []);
  plan.themeContract = { ...(fallback.themeContract || {}), ...(source.themeContract || {}) };
  plan.schemaRequirements = { ...(fallback.schemaRequirements || {}), ...(source.schemaRequirements || {}) };
  plan.qaGates = Array.isArray(source.qaGates) ? source.qaGates : (fallback.qaGates || []);
  plan.status = plan.status || fallback.status || "compiled";
  return plan;
}

function buildSearchOptimizationPlan(packet, data, serviceNames, pagePlan) {
  const explicitTargets = intakeQuality.queryTargets(data, serviceNames);
  const services = unique(serviceNames).slice(0, 18);
  const localModifiers = intakeQuality.markets(data);
  const market = localModifiers[0] || "";
  const primaryKeyword = explicitTargets[0] || "";
  const secondaryKeywords = unique([
    ...explicitTargets.slice(1),
    ...services.slice(0, 12).map(service => keywordWithMarket(service, market)),
    ...services.slice(0, 8)
  ]).filter(term => term.toLowerCase() !== primaryKeyword.toLowerCase()).slice(0, 24);
  const voiceQuestions = unique([
    `Who offers ${primaryKeyword}?`,
    `What should I know before requesting ${primaryKeyword}?`,
    `How do I contact ${data.businessName || "this local business"}?`,
    ...services.slice(0, 8).flatMap(service => [
      `Do you offer ${service.toLowerCase()}?`,
      `How do I request ${service.toLowerCase()} in ${market}?`
    ])
  ]).slice(0, 28);
  return {
    version: "search-intelligence-v1",
    status: primaryKeyword ? "compiled" : "review",
    generatedAt: new Date().toISOString(),
    primaryKeyword,
    secondaryKeywords,
    localModifiers,
    sourceStrategy: {
      requiredFirstPass: "Use attached BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, and brightdata-query-plan.json first. Run more Bright Data or competitor searches only when those artifacts are missing, blocked, or not_configured.",
      fallback: "If Bright Data is unavailable, use Firecrawl/search plus official source URLs and disclose the fallback before build.",
      doNotCopyCompetitors: true,
      useFor: [
        "page titles and H1/H2 map",
        "service coverage gaps",
        "FAQ and voice-search questions",
        "schema and internal-link priorities",
        "local entity signals",
        "conversion CTA placement"
      ]
    },
    pageTargets: pagePlan.map((page, index) => ({
      page: page.title || (index === 0 ? "Home" : `Page ${index + 1}`),
      slug: page.slug || "",
      targetKeyword: index === 0 ? primaryKeyword : (secondaryKeywords[index - 1] || keywordWithMarket(page.title || primaryKeyword, market)),
      intent: index === 0 ? "local authority and conversion" : inferIntent(page.title || ""),
      schemaHints: index === 0 ? ["LocalBusiness", "WebSite", "Organization", "FAQPage"] : ["Service", "FAQPage", "BreadcrumbList"],
      internalLinks: ["home", "contact", ...services.slice(0, 4).map(slugify)]
    })),
    voiceSearch: {
      questions: voiceQuestions,
      answerStyle: "short conversational answers backed by visible page copy and FAQ schema",
      mustCover: ["who", "what", "where", "how to request", "service area", "contact fallback"]
    },
    localSearch: {
      napConsistency: "Business name, phone, email, address/public address rule, service area, map mode, and GBP/Place ID must match visible copy and schema.",
      gbpPolicy: "Use Place ID, map embed, reviews, and geo coordinates only when verified.",
      areaServed: localModifiers,
      citationTargets: ["Google Business Profile", "Bing Places", "Apple Business Connect", "Yelp", "Facebook", "BBB or industry citations when verified"]
    },
    technicalRequirements: {
      canonicalPolicy: "Final domain drives canonicals, OG URLs, schema @id/url values, and sitemap URLs. Temporary preview domains must not become final canonicals unless explicitly approved.",
      sitemapPolicy: "Every public route needs a sitemap entry and a crawlable title/meta/canonical.",
      robotsPolicy: "Robots must expose the sitemap and avoid blocking public pages.",
      schemaTypes: ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
      metadata: ["title", "meta description", "canonical", "Open Graph", "Twitter card", "favicon", "apple-touch-icon", "image alt text"]
    },
    qaGates: [
      "Bright Data or fallback audit source acknowledged before build.",
      "Primary and secondary targets mapped to pages.",
      "Voice-search questions covered in visible FAQ/content.",
      "LocalBusiness/Service/FAQ schema aligns with visible content.",
      "Canonical, sitemap, robots, OG, favicon, and form routing are complete.",
      "No old-template/client residue remains."
    ]
  };
}

function buildLocalPresencePlan(packet, data, pagePlan, searchPlan) {
  const socialLinks = collectSocialLinks(packet, data);
  const mapAndDirections = buildMapAndDirections(data);
  const requiredCtas = buildRequiredCtas(data, mapAndDirections, socialLinks);
  const internalLinks = buildLocalInternalLinks(pagePlan, searchPlan);
  const hasFinanceLanguage = /financ|payment|snap|affirm|klarna|afterpay|zero\s*down|100[-\s]?day|lease|billing/i.test([
    data.mainServices,
    data.exactServices,
    data.mustInclude,
    data.meetingNotes,
    data.protectedArtifacts
  ].filter(Boolean).join(" "));
  return {
    version: "local-presence-conversion-v1",
    status: "compiled",
    generatedAt: new Date().toISOString(),
    businessIdentity: {
      name: data.businessName || "",
      phone: data.phone || "",
      smsNumber: data.smsNumber || "",
      email: data.email || "",
      address: data.address || "",
      serviceArea: data.serviceArea || "",
      hours: data.hours || "",
      hoursSource: data.hoursSource || "",
      mapMode: data.mapMode || "Needs review",
      gbpLink: data.gbpLink || "",
      gbpPlaceId: data.gbpPlaceId || "",
      publicAddressPolicy: mapAndDirections.publicAddressPolicy
    },
    mapAndDirections,
    mapSdkContract: buildMapSdkContract(data, mapAndDirections, packet),
    socialLinks,
    ctaMigration: {
      requiredCtas,
      financeAndPaymentPolicy: hasFinanceLanguage
        ? "Finance/payment CTAs may be included only from source-supported text or URLs. Do not invent APR, approval, warranty, price, or financing claims."
        : "Do not add financing/payment CTAs unless source evidence appears in Gmail, Drive, GBP, or the public website.",
      galleryAndInventoryPolicy: "Use source-supported gallery, current inventory, product, or photo URLs when available. Client/Drive/GBP assets win before stock or generated imagery.",
      reviewPolicy: data.gbpPlaceId ? "Use Google review CTA from Place ID where appropriate." : "Use review CTAs only from verified public source URLs."
    },
    internalLinkStrategy: {
      requiredLinks: internalLinks,
      rule: "Every page should link to contact/conversion, relevant service pages, service area/local proof, reviews/trust, gallery/assets when present, and directions/map CTAs when location policy allows."
    },
    themeContract: {
      topHeader: "Header/utility CTAs must remain readable in both light and dark first-viewport treatments.",
      logoVariants: ["logo-light.webp for dark/image-backed sections", "logo-dark.webp for light sections", "favicon/apple-touch-icon from clean mark"],
      contrast: "Test logo, nav, call, directions, and lead buttons on mobile/desktop light and dark backgrounds.",
      stickyBehavior: "If the template uses a sticky top bar, keep call/text/directions CTAs accessible without covering content."
    },
    schemaRequirements: {
      localBusiness: ["name", "url", "telephone", "sameAs", "areaServed", "hasMap when verified", "openingHoursSpecification when hours source is verified"],
      addressPolicy: mapAndDirections.schemaAddressPolicy,
      geoPolicy: "Use geo coordinates only when a verified GBP/map source provides them. Do not invent latitude/longitude.",
      paymentAccepted: hasFinanceLanguage ? "Mention payment/financing only where source-supported; never invent terms." : "Omit paymentAccepted unless source-supported.",
      sameAs: socialLinks.map(item => item.url)
    },
    qaGates: [
      "Firecrawl/source scrape confirms logo, real imagery, source routes, social links, map/address evidence, and service coverage before generic assets are used.",
      "Google Maps search/directions links use this client only, not the old template client.",
      `Google Maps SDK uses ${MAP_SDK_CONNECTOR_ENV}, mapId ${MAP_SDK_MAP_ID}, AdvancedMarkerElement, PinView, service-area circle, and city markers where coordinates are available.`,
      "Apple Maps link/pin is present when address or service-area query is available.",
      "Map embed respects public address/service-area policy.",
      "LocalBusiness JSON-LD matches visible NAP, GBP/Place ID, sameAs links, and map policy.",
      "Social media links, finance/payment CTAs, gallery/inventory CTAs, reviews, call/text, and directions are migrated in the first build pass when source-supported.",
      "Internal links connect home, services, service area, reviews/proof, gallery/assets, contact, and conversion CTAs.",
      "Light/dark header, logo variants, hero contrast, and top CTAs are verified on mobile and desktop."
    ]
  };
}

function buildVoiceSearchPlan(searchPlan, pagePlan, serviceNames) {
  const output = {};
  (pagePlan || []).forEach(page => {
    const route = page.slug || "home";
    output[route] = [
      `What should I know about ${String(page.title || "this service").toLowerCase()}?`,
      `How do I contact the business for ${String(page.title || "this service").toLowerCase()}?`
    ];
  });
  (serviceNames || []).slice(0, 16).forEach(service => {
    output[`services/${slugify(service)}`] = [
      `Do you offer ${String(service).toLowerCase()}?`,
      `How do I request ${String(service).toLowerCase()}?`
    ];
  });
  output.searchPlan = searchPlan.voiceSearch || {};
  return output;
}

function searchOptimizationCitationsCsv(searchPlan) {
  const rows = [["type", "value", "note"]];
  rows.push(["primary_keyword", searchPlan.primaryKeyword || "", "main rank target"]);
  (searchPlan.secondaryKeywords || []).forEach(term => rows.push(["secondary_keyword", term, "supporting target"]));
  (searchPlan.localModifiers || []).forEach(area => rows.push(["local_modifier", area, "local search area/entity"]));
  (searchPlan.localSearch?.citationTargets || []).forEach(target => rows.push(["citation_target", target, "verify before publishing claims"]));
  return rows.map(row => row.map(cell => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function parseCoordinate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function parseGeoFromData(data = {}) {
  const directLat = parseCoordinate(data.geoLat);
  const directLng = parseCoordinate(data.geoLng);
  if (validLatLng(directLat, directLng)) {
    return { lat: directLat, lng: directLng, source: "intake verified geo fields", verified: true, schemaAllowed: true };
  }
  const text = [data.gbpLink, data.googleMapsUrl, data.websiteUrl, data.meetingNotes, data.remixOperatorNotes, data.address]
    .filter(Boolean)
    .join(" ");
  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /\b(?:lat|latitude)\s*[:=]\s*(-?\d{1,2}(?:\.\d+)?)[,\s;]+(?:lng|lon|longitude)\s*[:=]\s*(-?\d{1,3}(?:\.\d+)?)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const lat = parseCoordinate(match[1]);
    const lng = parseCoordinate(match[2]);
    if (validLatLng(lat, lng)) {
      return { lat, lng, source: "source map URL or pasted GBP coordinates", verified: true, schemaAllowed: true };
    }
  }
  return { lat: null, lng: null, source: "", verified: false, schemaAllowed: false };
}

function parseServiceRadiusMiles(data = {}) {
  const direct = parseCoordinate(data.serviceRadiusMiles);
  if (direct && direct > 0) return { miles: direct, source: "intake field", needsReview: false };
  const text = [data.serviceArea, data.meetingNotes, data.marketingPlan, data.mustInclude].filter(Boolean).join(" ");
  const match = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i) || text.match(/\bradius\s*(?:of|:)?\s*(\d{1,3}(?:\.\d+)?)/i);
  const miles = match ? parseCoordinate(match[1]) : null;
  if (miles && miles > 0) return { miles, source: "source text", needsReview: false };
  return { miles: 25, source: "default display radius - review before production", needsReview: true };
}

function stateHintFromData(data = {}) {
  const text = [data.address, data.serviceArea, data.domainUrl].filter(Boolean).join(" ");
  const match = text.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b[a-z]/g, chr => chr.toUpperCase()).replace(/\b(Tn|Tx|Ak|Sc)\b/g, word => word.toUpperCase());
}

function serviceAreaNames(data = {}) {
  return unique(splitLines(data.serviceArea, data.serviceAreaTowns)
    .map(item => item.replace(/\b(and|within|serving|area|areas|near|around)\b/ig, " ").replace(/\s+/g, " ").trim())
    .filter(item => item && item.length <= 70 && !/^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/i.test(item))
  ).slice(0, 18);
}

function lookupCityCoord(area, stateHint = "") {
  const clean = titleCase(String(area || "")
    .replace(/\b(county|parish|municipality|metro|area|region|valley)\b/ig, "")
    .replace(/\s+/g, " ")
    .trim());
  const directKeys = unique([area, clean, stateHint ? `${clean}, ${stateHint}` : "", String(area || "").replace(/\s+/g, " ").trim()]);
  for (const key of directKeys) {
    if (KNOWN_CITY_COORDS[key]) return { name: clean || area, ...KNOWN_CITY_COORDS[key], source: "known coordinate dictionary", approximate: true };
  }
  return null;
}

function buildCityCoordinatePlan(data = {}) {
  const stateHint = stateHintFromData(data);
  const areas = serviceAreaNames(data);
  const coords = {};
  const missing = [];
  areas.forEach(area => {
    const match = lookupCityCoord(area, stateHint);
    const name = match?.name || titleCase(area);
    if (match && validLatLng(match.lat, match.lng)) coords[name] = { lat: match.lat, lng: match.lng };
    else if (!/\b(county|counties|service area|metro|region)\b/i.test(area)) missing.push(name);
  });
  return {
    source: "serviceArea",
    stateHint,
    displayOnly: true,
    policy: "City markers are approximate display aids for the map UI. Do not use approximate city coordinates as schema geo coordinates.",
    coords,
    missing,
    generationRule: "If a city is missing, use a connected Maps/Places source in Plan mode to fill CITY_COORDS, or ask the operator before building."
  };
}

function normalizeHex(value) {
  const raw = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split("").map(ch => ch + ch).join("").toUpperCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
  return "";
}

function hexToRgb(hex) {
  const raw = normalizeHex(hex).slice(1);
  return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16) };
}

function colorProfile(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  let hue = 0;
  if (spread) {
    if (max === r) hue = ((g - b) / spread) % 6;
    else if (max === g) hue = (b - r) / spread + 2;
    else hue = (r - g) / spread + 4;
  }
  return {
    chromatic: spread >= 24 && spread / Math.max(max, 1) >= 0.18,
    hue: (hue * 60 + 360) % 360
  };
}

function isChromaticHex(hex) {
  return colorProfile(hex).chromatic;
}

function brandPaletteRoles(data = {}, packet = {}) {
  const byHex = new Map();
  for (const item of Array.isArray(packet.sources?.palette) ? packet.sources.palette : []) {
    const hex = normalizeHex(typeof item === "string" ? item : item?.hex || item?.color || item?.value);
    if (hex && !byHex.has(hex)) {
      byHex.set(hex, typeof item === "object" && item
        ? { ...item, hex, source: item.source || "imported palette" }
        : { hex, source: "imported palette" });
    }
  }
  const selected = (String(data.brandColors || "").match(/#?[0-9a-f]{6}\b|#?[0-9a-f]{3}\b/gi) || [])
    .map(normalizeHex).filter(Boolean);
  for (const hex of selected) {
    if (!byHex.has(hex)) byHex.set(hex, { hex, source: "brandColors" });
  }
  const palette = [...byHex.values()];
  const chromatic = palette.filter(item => isChromaticHex(item.hex));
  const seen = new Set();
  const ordered = [
    ...selected.map(hex => byHex.get(hex)).filter(item => item && isChromaticHex(item.hex)),
    ...chromatic.filter(item => /logo/i.test(item.source || "")),
    ...chromatic
  ].filter(item => {
    if (seen.has(item.hex)) return false;
    seen.add(item.hex);
    return true;
  });
  return {
    primary: ordered[0] || null,
    secondary: ordered.slice(1),
    neutrals: palette.filter(item => !isChromaticHex(item.hex))
  };
}

function brandGradientCss(roles) {
  if (!roles.primary) return "";
  const primary = roles.primary.hex;
  const hue = colorProfile(primary).hue;
  const sameHue = roles.secondary.find(item => {
    const distance = Math.abs(colorProfile(item.hex).hue - hue);
    return Math.min(distance, 360 - distance) <= 24;
  });
  const { r, g, b } = hexToRgb(primary);
  const shade = "#" + [r, g, b]
    .map(channel => Math.round(channel * 0.72).toString(16).padStart(2, "0"))
    .join("").toUpperCase();
  return `linear-gradient(135deg, ${primary}, ${sameHue?.hex || shade})`;
}

function mapTokensFromRoles(roles, data = {}) {
  const brightness = hex => {
    const { r, g, b } = hexToRgb(hex);
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  };
  const secondary = [...roles.secondary].sort((a, b) => brightness(a.hex) - brightness(b.hex));
  const neutrals = [...roles.neutrals].sort((a, b) => brightness(b.hex) - brightness(a.hex));
  const primary = roles.primary?.hex || "";
  const darkPrimary = primary
    ? "#" + Object.values(hexToRgb(primary))
      .map(channel => Math.round(channel * 0.55).toString(16).padStart(2, "0"))
      .join("").toUpperCase()
    : "";
  return {
    night: normalizeHex(data.brandNight) || secondary[0]?.hex || darkPrimary || neutrals.find(item => brightness(item.hex) <= 80)?.hex || "#161E5D",
    slate: normalizeHex(data.brandSlate) || secondary[1]?.hex || secondary[0]?.hex || primary || "#505686",
    steel: normalizeHex(data.brandSteel) || secondary[2]?.hex || secondary[1]?.hex || secondary[0]?.hex || primary || "#7A85B8",
    bone: normalizeHex(data.brandBone) || neutrals.find(item => brightness(item.hex) >= 180)?.hex || "#FFFFFF",
    ember: normalizeHex(data.brandEmber) || primary || "#166CC8"
  };
}

function mapBrandTokens(data = {}, packet = {}) {
  return mapTokensFromRoles(brandPaletteRoles(data, packet), data);
}

function buildMapSdkContract(data = {}, mapAndDirections = buildMapAndDirections(data), packet = {}) {
  const mapMode = String(data.mapMode || "Service area").trim();
  const geo = parseGeoFromData(data);
  const radius = parseServiceRadiusMiles(data);
  const cityPlan = buildCityCoordinatePlan(data);
  const brand = mapBrandTokens(data, packet);
  const disabled = /^none$/i.test(mapMode);
  const officeOnly = /office section/i.test(mapMode);
  const interactiveMapExpected = !disabled && !officeOnly;
  const blockers = [];
  const reviewItems = [];
  if (!data.mapMode) reviewItems.push("Map mode was not chosen; compiler selected service-area fallback for admin review.");
  if (interactiveMapExpected && !geo.verified) reviewItems.push("Verified geo coordinates are missing; fill latitude/longitude from GBP/map data or let the connected Maps source confirm them before build.");
  if (interactiveMapExpected && radius.needsReview && /service area/i.test(mapMode)) reviewItems.push("Service radius was not found; default display radius is 25 miles and needs review.");
  if (cityPlan.missing.length) reviewItems.push(`${cityPlan.missing.length} service-area city marker coordinate${cityPlan.missing.length === 1 ? "" : "s"} need lookup: ${cityPlan.missing.slice(0, 6).join(", ")}`);
  const status = disabled || officeOnly ? "pass" : blockers.length ? "block" : reviewItems.length ? "review" : "pass";
  return {
    version: "maps-sdk-contract-v1",
    status,
    connector: { name: MAP_SDK_CONNECTOR_NAME, env: MAP_SDK_CONNECTOR_ENV, rule: "Link the custom Google Maps connector, not the managed connector, before publishing." },
    mapId: MAP_SDK_MAP_ID,
    sourceOfTruth: "src/lib/business.ts BUSINESS const plus local-presence-plan.json",
    brand,
    mapMode: mapMode || "Needs review",
    disabled,
    googleMapsSearchUrl: mapAndDirections.googleMapsSearchUrl,
    googleDirectionsUrl: mapAndDirections.googleDirectionsUrl,
    appleMapsUrl: mapAndDirections.appleMapsUrl,
    appleDirectionsUrl: mapAndDirections.appleDirectionsUrl,
    geo,
    serviceRadiusMiles: radius.miles,
    serviceRadiusSource: radius.source,
    cityCoordinatePlan: cityPlan,
    mapOptions: { zoom: 8, gestureHandling: "cooperative", mapId: MAP_SDK_MAP_ID },
    implementation: {
      loaderEnv: MAP_SDK_CONNECTOR_ENV,
      markerImport: "const { AdvancedMarkerElement, PinView } = await google.maps.importLibrary('marker');",
      mainMarker: { type: "AdvancedMarkerElement", position: geo.verified ? { lat: geo.lat, lng: geo.lng } : "BUSINESS.geo", pinView: { background: brand.ember, borderColor: brand.night, glyphColor: "#FFFFFF", scale: 1.3 } },
      serviceAreaCircle: { center: geo.verified ? { lat: geo.lat, lng: geo.lng } : "BUSINESS.geo", radiusMeters: Math.round(radius.miles * 1609.34), fillColor: brand.ember, fillOpacity: 0.06, strokeColor: brand.ember, strokeOpacity: 0.35, strokeWeight: 2 },
      cityMarkers: { coordsObjectName: "CITY_COORDS", coords: cityPlan.coords, pinView: { background: brand.slate, borderColor: brand.night, glyphColor: "#FFFFFF", scale: 0.75 }, infoWindowAction: "Get Estimate in {city} button scrolls to the contact form and focuses the name input." },
      infoWindow: { main: ["Business name bold", "address or service-area rule", "phone tel: link", "Google Directions button", "Apple Directions button"], city: ["city heading", "service-area copy", "estimate CTA"] }
    },
    qaGates: [
      `Uses ${MAP_SDK_CONNECTOR_ENV} and ${MAP_SDK_MAP_ID}.`,
      "Imports AdvancedMarkerElement and PinView from google.maps.importLibrary('marker').",
      "Main marker, service-area circle, and city markers render without old-template coordinates.",
      "Map links include Google Directions and Apple Directions.",
      "LocalBusiness schema uses exact geo only when geo.verified is true.",
      "If geo is missing, build must stop or ask for map confirmation instead of shipping a broken map."
    ],
    blockers,
    reviewItems
  };
}

function parseAddressParts(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const match = text.match(/^(.*?),?\s*([A-Za-z .'-]+),?\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s*(\d{5}(?:-\d{4})?)?$/i);
  if (!match) return { street: text, city: "", state: stateHintFromData({ address: text }), zip: "" };
  return { street: match[1].trim(), city: titleCase(match[2].trim()), state: match[3].toUpperCase(), zip: match[4] || "" };
}

function buildBusinessTs(data = {}, services = [], mapSdkContract = buildMapSdkContract(data)) {
  const address = parseAddressParts(data.address || "");
  const domain = data.domainUrl || data.website || "";
  const business = {
    name: data.businessName || "",
    shortName: data.businessName ? data.businessName.replace(/\b(LLC|Inc\.?|Company|Co\.?)\b/ig, "").replace(/\s+/g, " ").trim() : "",
    tagline: data.mainCta || data.visualTone || "",
    phone: data.phone || "",
    phoneTel: String(data.phone || data.smsNumber || "").replace(/[^\d+]/g, ""),
    email: data.email || "",
    street: address.street || data.address || "",
    city: address.city || "",
    state: address.state || mapSdkContract.cityCoordinatePlan?.stateHint || "",
    zip: address.zip || "",
    region: data.serviceArea || "",
    geo: mapSdkContract.geo.verified ? { lat: mapSdkContract.geo.lat, lng: mapSdkContract.geo.lng } : null,
    geoVerified: mapSdkContract.geo.verified,
    serviceRadiusMiles: mapSdkContract.serviceRadiusMiles,
    domain,
    canonical: domain,
    hours: data.hours || "",
    serviceAreas: serviceAreaNames(data),
    services: (services || []).map(service => ({
      slug: service.slug || slugify(service.name || service.title),
      name: service.name || service.title || service.slug || "",
      shortDescription: service.shortDesc || service.shortDescription || `${service.name || service.title || "Service"} for ${data.serviceArea || "the local area"}`
    })),
    brand: mapSdkContract.brand || mapBrandTokens(data),
    map: {
      connectorEnv: MAP_SDK_CONNECTOR_ENV,
      connectorName: MAP_SDK_CONNECTOR_NAME,
      mapId: MAP_SDK_MAP_ID,
      mode: mapSdkContract.mapMode,
      googleMapsSearchUrl: mapSdkContract.googleMapsSearchUrl || "",
      googleDirectionsUrl: mapSdkContract.googleDirectionsUrl || ""
    }
  };
  return [
    "export const BUSINESS = " + JSON.stringify(business, null, 2) + " as const;",
    "",
    "export const CITY_COORDS = " + JSON.stringify(mapSdkContract.cityCoordinatePlan?.coords || {}, null, 2) + " as const;",
    "",
    "export type BusinessConfig = typeof BUSINESS;"
  ].join("\n");
}

function buildSeoAssetLayer(data = {}, services = [], pagePlan = [], routes = [], mapSdkContract = buildMapSdkContract(data), searchPlan = {}) {
  const baseUrl = normalizeSiteUrl(data.domainUrl || data.website || data.websiteUrl || "");
  const siteName = data.businessName || "Client website";
  const routeList = unique([...(routes || []), ...pagePlan.map(page => page.slug ? `/${page.slug}` : "/")]).map(route => route || "/");
  const pages = routeList.map(route => ({
    route,
    url: absoluteSiteUrl(baseUrl, route),
    priority: route === "/" ? 1 : route.startsWith("/services/") ? 0.82 : 0.72,
    changefreq: "monthly"
  }));
  const sameAs = collectSameAs(data);
  const address = parseAddressParts(data.address || "");
  const serviceNames = unique(services.map(service => service.name || service.title || service.slug).filter(Boolean));
  const localBusiness = stripEmpty({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": baseUrl ? `${baseUrl.replace(/\/$/, "")}/#localbusiness` : "#localbusiness",
    name: siteName,
    url: baseUrl || undefined,
    telephone: data.phone || undefined,
    email: data.email || undefined,
    image: "assets/og-default.jpg",
    logo: "assets/logo-transparent.webp",
    priceRange: "$$",
    address: data.address ? stripEmpty({
      "@type": "PostalAddress",
      streetAddress: address.street || data.address || undefined,
      addressLocality: address.city || undefined,
      addressRegion: address.state || mapSdkContract.cityCoordinatePlan?.stateHint || undefined,
      postalCode: address.zip || undefined,
      addressCountry: "US"
    }) : undefined,
    geo: mapSdkContract.geo?.verified ? {
      "@type": "GeoCoordinates",
      latitude: mapSdkContract.geo.lat,
      longitude: mapSdkContract.geo.lng
    } : undefined,
    areaServed: serviceAreaNames(data).map(name => ({ "@type": "Place", name })),
    hasMap: mapSdkContract.googleMapsSearchUrl || undefined,
    openingHours: data.hours || undefined,
    sameAs,
    makesOffer: services.slice(0, 16).map(service => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: service.name || service.title || service.slug,
        url: absoluteSiteUrl(baseUrl, `/services/${service.slug || slugify(service.name || service.title)}`)
      }
    }))
  });
  const entity = {
    version: "pagehub-entity-v1",
    name: siteName,
    canonical: baseUrl,
    phone: data.phone || "",
    email: data.email || "",
    address: data.address || "",
    serviceArea: data.serviceArea || "",
    hours: data.hours || "",
    hoursSource: data.hoursSource || "",
    placeId: data.gbpPlaceId || "",
    sameAs,
    primaryKeyword: searchPlan.primaryKeyword || "",
    services: serviceNames,
    map: {
      mode: mapSdkContract.mapMode,
      geoVerified: mapSdkContract.geo?.verified === true,
      lat: mapSdkContract.geo?.lat ?? null,
      lng: mapSdkContract.geo?.lng ?? null,
      serviceRadiusMiles: mapSdkContract.serviceRadiusMiles,
      mapId: mapSdkContract.mapId,
      connectorEnv: mapSdkContract.connector?.env || MAP_SDK_CONNECTOR_ENV
    }
  };
  const answerEngine = {
    version: "answer-engine-v1",
    businessSummary: `${siteName} serves ${data.serviceArea || "its local area"} with ${serviceNames.join(", ") || data.mainServices || "verified local services"}.`,
    directAnswers: [
      { question: `What does ${siteName} do?`, answer: serviceNames.length ? `${siteName} provides ${serviceNames.join(", ")}.` : data.mainServices || "Needs review." },
      { question: `Where does ${siteName} serve?`, answer: data.serviceArea || "Needs review." },
      { question: `How do I contact ${siteName}?`, answer: [data.phone, data.email, data.mainCta].filter(Boolean).join(" | ") || "Use the website contact form." },
      { question: `What are ${siteName}'s hours?`, answer: data.hours || "Hours need review.", source: data.hoursSource || "Needs review" }
    ],
    voiceSearchQuestions: searchPlan.voiceSearch || {},
    citationTargets: ["Google Business Profile", "Apple Business Connect", "Bing Places", "Facebook", "Yelp", "BBB when verified"]
  };
  const features = geoFeatures(data, mapSdkContract, baseUrl);
  const locationsGeojson = { type: "FeatureCollection", features };
  const sitemapsByName = sitemapXmlByName(baseUrl, pages);
  const offers = services.map(service => ({
    slug: service.slug || slugify(service.name || service.title),
    name: service.name || service.title || service.slug,
    priceRange: service.priceRange || "Contact for estimate",
    url: absoluteSiteUrl(baseUrl, `/services/${service.slug || slugify(service.name || service.title)}`),
    areaServed: data.serviceArea || ""
  }));
  return {
    version: "seo-asset-layer-v1",
    status: baseUrl && localBusiness.name ? "pass" : "review",
    generatedAt: new Date().toISOString(),
    files: ["answer-engine.json", "entity.json", "local-business.jsonld", "locations.geojson", "geo.kml", "sitemap-index.xml", "sitemap-services.xml", "sitemap-geo.xml", "sitemap-entity.xml", "offers.json", "products-feed.json", "well-known-pagehub.json"],
    schemaTypes: ["LocalBusiness", "Organization", "Service", "FAQPage", "WebSite", "BreadcrumbList"],
    sitemaps: Object.keys(sitemapsByName),
    baseUrl,
    answerEngine,
    entity,
    localBusiness,
    locationsGeojson,
    geoKml: kmlForFeatures(siteName, features),
    offers,
    productsFeed: offers.map(offer => ({ id: offer.slug, title: offer.name, description: `${siteName} service page.`, link: offer.url, image_link: "assets/og-default.jpg", availability: "in stock", price: "0 USD", custom_label_0: "lead generation service" })),
    wellKnownPagehub: { version: "pagehub-build-packet-v1", siteName, canonical: baseUrl, source: "Woodward/PageHub intake compiler", requiredPublicChecks: ["no builder badge", "public WSS/WSS URL", "favicon", "OG image", "Resend form", "Google Maps inlay"] },
    sitemapsByName,
    stopRules: ["Do not ask the builder to invent schema, entity facts, sitemaps, local geo files, offers, or product/service feed rows.", "If geo is not verified, do not write exact schema geo; keep map UI in service-area fallback mode."]
  };
}

function buildTemplateVarietyContract(packet = {}, data = {}, context = {}) {
  const selectedId = packet.selectedTemplateId || packet.compiled?.manifest?.selectedTemplateId || context.remix?.template?.selectedTemplateId || "auto";
  const archetypes = {
    auto: ["Rotation selector", "Pick the least recently used high-fit template shape after source facts and assets are compiled."],
    "gold-premier-motion": ["Premium local authority", "Multi-page cinematic hero, trust blocks, service authority pages, map/form conversion rail."],
    "single-cinematic-motion": ["One-page wow scroll", "Strong first viewport, animated media depth, compressed services/proof/map/form in one polished scroll."],
    "single-gallery-first": ["Photo proof showcase", "Image-led one-page layout where real work photos drive trust, proof, service cards, and social preview."],
    "single-quote-conversion": ["Lead-first quote funnel", "Fast conversion scroll with sticky call/text, custom quote widget, concise proof, and service-area reinforcement."],
    "premier-map-service-area": ["Service-area authority hub", "Map-first authority site with city/county markers, local internal links, and dedicated area content."],
    "premier-trust-credentials": ["Credential and proof authority", "Trust-heavy premier site with logos/badges, training/certification proof, reviews, gallery, and service content."]
  };
  const [role, visualShape] = archetypes[selectedId] || archetypes.auto;
  const imageCount = (packet.assetQa?.imageCandidates || []).length;
  const photosExpected = /^yes|partial$/i.test(String(data.clientPhotosReceived || ""));
  const missing = [];
  if (selectedId === "auto") missing.push("final template shape should be confirmed or auto-rotated before handoff");
  if (!data.heroSourceMode && !packet.compiled?.hero?.brief) missing.push("cinematic hero source mode/brief");
  if (photosExpected && imageCount < 6) missing.push("6+ staged images or accessible Drive folder");
  return {
    version: "template-variety-contract-v1",
    status: missing.length ? "review" : "pass",
    selectedTemplateId: selectedId,
    selectedTemplateName: packet.selectedTemplateName || packet.compiled?.manifest?.selectedTemplateName || "",
    family: packet.selectedBuildLane || packet.compiled?.manifest?.templateFamily || "",
    archetype: {
      role,
      visualShape,
      cinematicMustKeep: ["hero composition and motion primitives", "section rhythm and scroll reveal behavior", "widget/lead-funnel shell", "gallery/proof treatment", "map/form placement", "mobile sticky CTA behavior"],
      requiredPacketInputs: ["complete client facts", "content route map", "SEO/entity files", "asset QA", "hero contract", "forms/Resend contract", "map SDK contract"]
    },
    rotationPolicy: "Use varied shapes across client builds. Do not default every client to the same premier shell when the intake fits a one-page, gallery-first, quote-funnel, service-area, or credential/proof archetype.",
    visualQualityRules: ["Default public site mode should be light unless explicitly required dark.", "Hero should be about 10% lighter/clearer than the dark master while preserving contrast.", "Use real client assets first.", "Logo backgrounds must be cleaned or matted.", "Credential/trust logos should appear beside source-supported proof text.", "Do not let any auto-selected shape collapse into a Polaroid/photo-card/card-first first viewport.", "For 10+ images, gallery proof must be browsable, categorized, deduped, captioned, and full-width."],
    firstResponseRequired: ["Echo selected archetype and cinematic primitives.", "List exact packet files used for content, SEO, maps, assets, and forms.", "State the banned first-viewport patterns avoided and the gallery organization rule used.", "Confirm no old-client residue and no builder badge/preview URL will remain."],
    missing
  };
}

function buildBrandAssetGenerationPlan(packet = {}, data = {}, logoQa = {}, galleryPlan = {}, templateContract = {}) {
  return {
    version: "brand-asset-generation-v1",
    status: logoQa.status === "block" ? "review" : "pass",
    sourcePriority: ["official logo upload/source URL", "Google Business/Profile logo when verified", "website header logo when higher quality", "client Drive assets", "generated fallback only when explicitly allowed"],
    requiredOutputs: ["logo-light.webp", "logo-dark.webp", "logo-transparent.webp", "favicon.ico", "favicon.png", "apple-touch-icon.png", "og-default.jpg", "hero-poster.webp", "hero-mobile.webp"],
    logoCleanupRules: ["Remove screenshot, white-box, or ugly background when possible.", "If transparent extraction is risky, place logo on an intentional matte or glass tile.", "Create separate light/dark variants and test header contrast.", "Keep safe padding for favicon and Apple touch icon."],
    heroRules: ["Cinematic first viewport using template motion.", "Hero should be 10% lighter/clearer than the dark master.", "Use uploaded/Drive/source photo first; use generated hero only when allowed and documented.", "Never ship a blank slab, old-client hero, flat generic stock crop, Polaroid/photo-card pile, three-card service row, testimonial-card hero, or card-first first viewport."],
    galleryRules: galleryPlan.stopRules || [],
    credentialLogoRules: ["Use recognizable logos/icons beside source-supported credentials or manufacturer training.", "Do not invent credentials or use logos for unsupported claims."],
    templateArchetype: templateContract.archetype?.role || "",
    reviewItems: [...(logoQa.issues || []), ...(galleryPlan.reviewItems || [])]
  };
}

function buildSecurityHardeningPlan(packet = {}, data = {}) {
  return {
    version: "security-hardening-v1",
    status: "pass",
    publicExportPolicy: "Public/operator dashboard users can compile and Send To Admin only. Raw ZIP/export files stay admin-only.",
    secretsPolicy: ["Resend API key stays server-side.", "Google Places key stays server-side.", `${MAP_SDK_CONNECTOR_ENV} is the only browser Maps key expected in the published site.`, "Do not expose raw Gmail/Drive tokens or admin destinations in public UI."],
    formPolicy: ["Validate lead payloads server-side.", "Include honeypot and sane length limits.", "Route lead notifications through the shared WSS Resend connector.", "Show clear success/error states and keep a mailto fallback."],
    residuePolicy: ["Remove old template business names, phones, addresses, images, schema, OG metadata, map coordinates, and hidden constants.", "Remove/hide builder badges before client completion.", "No client-facing unpublished builder preview URLs in completion email."],
    adminDestination: data.recipientEmail || packet.review?.recipientEmail || "woodwardsoftware@gmail.com"
  };
}

function buildPostPublishValidationPlan(packet = {}, data = {}, context = {}) {
  const routes = unique(context.routes || ["/"]);
  return {
    version: "post-publish-validation-v1",
    status: "ready",
    urlPolicy: "Completion emails must use public WSS/WSS URLs only. Do not include unpublished builder preview URLs.",
    requiredBeforeClientEmail: true,
    checks: [
      { id: "wss-domain", label: "Published URL is a .wss-ai.com domain", required: true },
      { id: "no-builder-preview-url", label: "No client-facing unpublished builder preview URL in site copy, metadata, sitemap, or email", required: true },
      { id: "badge-hidden", label: "Builder badge is removed or hidden", required: true },
      { id: "favicon-og", label: "Favicon, Apple touch icon, OG image, Twitter card, canonical, and title/description are client-specific", required: true },
      { id: "forms-resend", label: "Contact/quote form submits through shared Resend route with success/error states", required: true },
      { id: "map-inlay", label: `Google Maps inlay uses ${MAP_SDK_CONNECTOR_ENV}, mapId ${MAP_SDK_MAP_ID}, AdvancedMarkerElement, service-area circle, and city markers/fallback`, required: true },
      { id: "seo-assets", label: "answer-engine.json, entity.json, local-business.jsonld, locations.geojson, geo.kml, and sitemaps are present", required: true },
      { id: "route-smoke", label: `All route targets load: ${routes.slice(0, 12).join(", ")}`, required: true }
    ],
    smokeTests: ["Desktop first viewport screenshot", "Mobile first viewport screenshot", "Anti-card-first first viewport scan", "10+ image gallery organization scan when applicable", "Click call/text/primary CTA", "Submit test form payload through Resend route", "Open map and directions links", "Fetch favicon/OG/canonical", "Fetch sitemap-index.xml and local-business.jsonld", "Search page source for old-template residue"]
  };
}

function collectSameAs(data = {}) {
  return unique(splitLines(data.socialUrl, data.gbpLink, data.facebook, data.instagram, data.yelp, data.bbb, data.linkedin, data.youtube)
    .filter(url => /^https?:\/\//i.test(String(url))));
}

function normalizeSiteUrl(value) {
  return intakeQuality.website(value).replace(/\/$/, "");
}

function absoluteSiteUrl(baseUrl, route = "/") {
  const base = normalizeSiteUrl(baseUrl);
  const cleanRoute = `/${String(route || "/").replace(/^\/+/, "")}`.replace(/\/$/, "") || "/";
  return base ? `${base}${cleanRoute === "/" ? "/" : cleanRoute}` : cleanRoute;
}

function geoFeatures(data, mapSdkContract, baseUrl) {
  const features = [];
  if (mapSdkContract.geo?.verified) {
    features.push({ type: "Feature", properties: { name: data.businessName || "Business", kind: "business", url: baseUrl || "" }, geometry: { type: "Point", coordinates: [mapSdkContract.geo.lng, mapSdkContract.geo.lat] } });
  }
  Object.entries(mapSdkContract.cityCoordinatePlan?.coords || {}).forEach(([name, coords]) => {
    features.push({ type: "Feature", properties: { name, kind: "service-area-city", approximate: true }, geometry: { type: "Point", coordinates: [coords.lng, coords.lat] } });
  });
  return features;
}

function kmlForFeatures(siteName, features = []) {
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', "<Document>", `<name>${escapeXml(siteName || "Client locations")}</name>`, ...features.map(feature => {
    const [lng, lat] = feature.geometry?.coordinates || [];
    return `<Placemark><name>${escapeXml(feature.properties?.name || "Location")}</name><description>${escapeXml(feature.properties?.kind || "")}</description><Point><coordinates>${lng || 0},${lat || 0},0</coordinates></Point></Placemark>`;
  }), "</Document>", "</kml>"].join("\n");
}

function sitemapXmlByName(baseUrl, pages = []) {
  const urlset = items => ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...items.map(item => `<url><loc>${escapeXml(item.url || absoluteSiteUrl(baseUrl, item.route))}</loc><changefreq>${escapeXml(item.changefreq || "monthly")}</changefreq><priority>${Number(item.priority || 0.7).toFixed(1)}</priority></url>`), "</urlset>"].join("\n");
  const services = pages.filter(item => /^\/services\//i.test(item.route));
  const geo = pages.filter(item => /area|location|service-area/i.test(item.route));
  const entity = pages.filter(item => item.route === "/" || /about|contact|review|faq/i.test(item.route));
  return {
    "sitemap-index.xml": ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...["sitemap-services.xml", "sitemap-geo.xml", "sitemap-entity.xml"].map(name => `<sitemap><loc>${escapeXml(absoluteSiteUrl(baseUrl, `/${name}`))}</loc></sitemap>`), "</sitemapindex>"].join("\n"),
    "sitemap-services.xml": urlset(services.length ? services : pages),
    "sitemap-geo.xml": urlset(geo.length ? geo : pages),
    "sitemap-entity.xml": urlset(entity.length ? entity : pages)
  };
}

function stripEmpty(value) {
  if (Array.isArray(value)) return value.map(stripEmpty).filter(item => item !== undefined && item !== "" && !(Array.isArray(item) && !item.length));
  if (!value || typeof value !== "object") return value || undefined;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripEmpty(item)]).filter(([, item]) => item !== undefined && item !== "" && !(Array.isArray(item) && !item.length) && !(item && typeof item === "object" && !Array.isArray(item) && !Object.keys(item).length)));
}

function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildMapAndDirections(data) {
  const name = data.businessName || "Local business";
  const address = String(data.address || "").trim();
  const serviceArea = String(data.serviceArea || "").trim();
  const placeId = intakeQuality.placeId(data.gbpPlaceId || data.googlePlaceId || data.placeId);
  const hasAddressPin = /address|pin|office|showroom|store|visit/i.test(data.mapMode || "") && address;
  const query = [name, hasAddressPin ? address : serviceArea].filter(Boolean).join(" ");
  const destination = hasAddressPin ? address : query;
  const encodedQuery = encodeURIComponent(query || name);
  const encodedDestination = encodeURIComponent(destination || query || name);
  const googleMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ""}`;
  const googleDirectionsUrl = data.googleDirectionsUrl || data.directionsUrl || `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ""}`;
  const appleMapsUrl = `https://maps.apple.com/?q=${encodedQuery}`;
  const appleDirectionsUrl = data.appleDirectionsUrl || `https://maps.apple.com/?daddr=${encodedDestination}`;
  return {
    publicAddressPolicy: hasAddressPin
      ? "Show verified address pin and directions CTA."
      : /service area/i.test(data.mapMode || "") || serviceArea
        ? "Use service-area/local coverage block; do not expose an exact address pin unless verified."
        : "Location needs review before map embed.",
    googleBusinessUrl: data.gbpLink || "",
    googlePlaceId: placeId,
    googleMapsSearchUrl,
    googleDirectionsUrl,
    googleReviewUrl: placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : (data.gbpLink || ""),
    appleMapsUrl,
    appleDirectionsUrl,
    geo: parseGeoFromData(data),
    serviceRadiusMiles: parseServiceRadiusMiles(data).miles,
    mapEmbedPolicy: hasAddressPin || placeId
      ? "Embed/use verified Google Business or Maps place only. Never leave an old template embed."
      : "Prefer service-area map/list block over exact map embed until a verified public address or Place ID is provided.",
    schemaAddressPolicy: hasAddressPin
      ? "Use PostalAddress only from verified address."
      : "For service-area businesses, avoid publishing a precise PostalAddress unless the packet explicitly approves it."
  };
}

function collectSocialLinks(packet, data) {
  const urls = unique([
    data.socialUrl,
    ...(packet.sources?.urls || []),
    ...(packet.sources?.social || [])
  ]).filter(url => /^https?:\/\//i.test(String(url)) && /facebook|instagram|tiktok|youtube|linkedin|x\.com|twitter|yelp|bbb|nextdoor|linktr\.ee|maps\.apple|google\.com\/maps/i.test(String(url)));
  return urls.map(url => ({
    platform: socialPlatform(url),
    url,
    use: /google\.com\/maps|maps\.app\.goo\.gl/i.test(url) ? "map/source evidence" : "sameAs/social CTA"
  }));
}

function socialPlatform(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("facebook")) return "Facebook";
  if (value.includes("instagram")) return "Instagram";
  if (value.includes("tiktok")) return "TikTok";
  if (value.includes("youtube")) return "YouTube";
  if (value.includes("linkedin")) return "LinkedIn";
  if (value.includes("nextdoor")) return "Nextdoor";
  if (value.includes("yelp")) return "Yelp";
  if (value.includes("bbb")) return "BBB";
  if (value.includes("linktr.ee")) return "Linktree";
  if (value.includes("maps.apple")) return "Apple Maps";
  if (value.includes("google.com/maps")) return "Google Maps";
  if (value.includes("x.com") || value.includes("twitter")) return "X/Twitter";
  return "Source link";
}

function buildRequiredCtas(data, mapAndDirections, socialLinks) {
  const ctas = [];
  if (data.phone) ctas.push({ type: "call", label: "Call Now", url: `tel:${String(data.phone).replace(/[^\d+]/g, "")}`, required: true });
  if (data.smsNumber || data.phone) ctas.push({ type: "text", label: "Text Us", url: `sms:${String(data.smsNumber || data.phone).replace(/[^\d+]/g, "")}`, required: false });
  if (data.email) ctas.push({ type: "email", label: "Email", url: `mailto:${data.email}`, required: false });
  if (mapAndDirections.googleDirectionsUrl) ctas.push({ type: "google-directions", label: "Directions", url: mapAndDirections.googleDirectionsUrl, required: true });
  if (mapAndDirections.appleMapsUrl) ctas.push({ type: "apple-maps", label: "Open In Apple Maps", url: mapAndDirections.appleDirectionsUrl || mapAndDirections.appleMapsUrl, required: true });
  if (mapAndDirections.googleReviewUrl) ctas.push({ type: "google-review", label: "Review Us On Google", url: mapAndDirections.googleReviewUrl, required: false });
  if (data.galleryLink) ctas.push({ type: "gallery", label: "View Gallery", url: data.galleryLink, required: false });
  socialLinks.forEach(link => ctas.push({ type: `social-${slugify(link.platform)}`, label: link.platform, url: link.url, required: false }));
  return ctas;
}

function buildLocalInternalLinks(pagePlan, searchPlan) {
  const pages = (pagePlan || []).map(page => ({ title: page.title || "Page", slug: page.slug || "" }));
  const links = [];
  pages.forEach(page => {
    const from = page.slug ? `/${page.slug}` : "/";
    links.push({ from, to: "/contact", anchor: "contact / lead form", purpose: "conversion" });
    links.push({ from, to: "/", anchor: "home", purpose: "brand/local authority" });
  });
  (searchPlan.pageTargets || []).forEach(target => {
    if (!target.slug) return;
    links.push({ from: "/", to: `/${target.slug}`, anchor: target.targetKeyword || target.page, purpose: target.intent || "search target" });
  });
  return unique(links.map(link => JSON.stringify(link))).map(item => JSON.parse(item)).slice(0, 40);
}

function keywordWithMarket(service, market) {
  const cleanService = String(service || "local service").replace(/\s+/g, " ").trim();
  const cleanMarket = String(market || "").replace(/\s+/g, " ").trim();
  if (!cleanMarket || new RegExp(`\\b${escapeRegExp(cleanMarket)}\\b`, "i").test(cleanService)) return cleanService;
  return `${cleanService} ${cleanMarket}`.trim();
}

function inferIntent(title) {
  if (/contact|quote|estimate/i.test(title)) return "conversion";
  if (/service area|location|near/i.test(title)) return "local discovery";
  if (/review|why|about|proof/i.test(title)) return "trust proof";
  return "service authority";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function externalAssetFoldersFromPacket(packet) {
  const data = { ...(packet.business || {}), ...(packet.brand || {}) };
  return unique([
    ...(packet.assetQa?.externalAssetFolders || []),
    ...(packet.compiled?.assetsManifest?.externalAssetFolders || []),
    packet.sources?.googleDriveUrl,
    ...(packet.remix?.sourcePointers?.driveFolders || []),
    ...(packet.compiled?.remix?.sourcePointers?.driveFolders || []),
    data.assetFolder,
    data.galleryLink,
    data.logoLink
  ]).filter(item => /drive\.google\.com\/drive\/folders|dropbox\.com|sharepoint\.com|onedrive\.live\.com/i.test(String(item)));
}

function serviceSafeDerivedFields(packet = {}, data = {}, ownServiceNames = []) {
  const old = packet.compiled || {};
  const hasWithheld = (packet.review?.intakeQuality?.issues || []).some(row =>
    row.rule === "unaccepted_service_labels" && row.scope === "service_selection");
  const fields = value => value && typeof value === "object" ? { ...value,
    fields: Array.isArray(value.fields) ? value.fields.map(row =>
      row?.name === "service" ? { ...row, options: certifiedVisitorServices(packet) } : row) : value.fields } : value;
  const pages = Array.isArray(old.pages) ? old.pages.map(page => ({ ...page,
    sections: Array.isArray(page.sections) ? page.sections.map(section =>
      Array.isArray(section.exactServices) ? { ...section, exactServices: ownServiceNames } : section) : page.sections })) : old.pages;
  const faqs = hasWithheld ? [
    { q: `What services does ${data.businessName || "the business"} offer?`,
      a: ownServiceNames.length ? `${data.businessName} offers ${humanList(ownServiceNames)}.` : "Confirm available services before publication." },
    { q: "How do customers request help?", a: visitorContactCopy(contentContext(data, ownServiceNames)) }
  ] : old.faqs;
  return { forms: fields(old.forms), widget: fields(old.widget), pages, faqs,
    hero: hasWithheld && old.hero && typeof old.hero === "object"
      ? { ...old.hero, subhead: ownServiceNames.join(", ") } : old.hero };
}

function sourceServiceProvider(packet = {}, name = "") {
  const business = visitorFact(packet.business?.businessName);
  const anchor = packet.business?.domainUrl || packet.business?.websiteUrl;
  const observations = (packet.sources?.observations || []).filter(row =>
    intakeQuality.sameSource(anchor, row.source || row.url));
  // A shared first-party site can describe a separate provider. Attribute an
  // observed service only to the named company on the service's own page.
  for (const row of observations) {
    if (!intakeQuality.observedService(row, name)) continue;
    for (const line of String(row.private_source?.markdown || "").split(/\r?\n/)) {
      const match = line.replace(/[*_]/g, " ").match(
        /\b([A-Za-z][A-Za-z &/-]{1,45}?)\s+services?\s+by\s+([A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){1,5})/);
      const family = intakeQuality.key(match?.[1] || "").split(" ").at(-1);
      if (family && intakeQuality.key(name).split(" ").includes(family)) {
        const provider = visitorFact(match[2]);
        if (provider && provider !== business) return provider;
      }
    }
  }
  if (!/\bplumbing\b/i.test(name)) return business;
  const affiliate = observations.some(row =>
    /affiliated company[\s\S]{0,100}handles plumbing|affiliated companies[\s\S]{0,100}separate service providers/i
      .test(String(row.private_source?.markdown || "")));
  if (!affiliate) return business;
  const evidence = observations.find(row => intakeQuality.observedService(row, name)
    && /\*\*([^*]{3,80})\*\* handles your plumbing request, estimate, and service\./i
      .test(String(row.private_source?.markdown || "")));
  return evidence?.private_source?.markdown.match(
    /\*\*([^*]{3,80})\*\* handles your plumbing request, estimate, and service\./i)?.[1] || "";
}

function exactServices(packet) {
  // Routes, marketing plans and page titles never certify business services.
  return certifiedVisitorServices(packet);
}

function certifiedVisitorServices(packet = {}) {
  const source = normalizeSafetyText(packet.goldenArtifacts?.servicesSource || packet.business?.servicesSource || "");
  if (/(?:category default|estimated)/.test(source)) return [];
  const observations = Array.isArray(packet.sources?.observations) ? packet.sources.observations : [];
  const anchor = intakeQuality.website(packet.business?.domainUrl || packet.business?.websiteUrl)
    || (packet.sources?.urls || []).map(intakeQuality.website).find(Boolean) || "";
  const observedCandidates = observations.filter(row => intakeQuality.sameSource(anchor, row.source || row.url))
    .flatMap(row => intakeQuality.services([row.extracted?.exactServices, row.extracted?.mainServices])
      .filter(name => intakeQuality.observedService(row, name)));
  const selectedCandidates = intakeQuality.services([
    packet.goldenArtifacts?.exactServices, packet.business?.exactServices,
    /(?:source|verified|owner|correction)/.test(source) ? packet.business?.mainServices : "",
  ]);
  const candidates = (selectedCandidates.length ? selectedCandidates : intakeQuality.services(observedCandidates))
    .map(visitorFact).filter(isVisitorServiceName);
  const forbidden = literalMustAvoidPhrases(packet.requirements?.mustAvoid).map(visitorFact).map(normalizeSafetyText).filter(v => v.length >= 3);
  return candidates.filter(name => {
    const normalized = normalizeSafetyText(name);
    const businessName = normalizeSafetyText(packet.business?.businessName);
    if (businessName && normalized.includes(businessName)) return false;
    if (forbidden.some(value => normalized.includes(value))) return false;
    // Affiliate services remain source evidence; they are not this company's
    // offerings, schema, service options, or importer facts.
    const provider = sourceServiceProvider(packet, name);
    if (!provider || provider !== visitorFact(packet.business?.businessName)) return false;
    // Preserve the existing authenticated owner-correction contract. A free-form
    // 'verified' label by itself is not proof; harvested services need observations.
    return source === "owner correction" || (!source && observations.length === 0) || observations.some(observation =>
      intakeQuality.sameSource(anchor, observation.source || observation.url)
      && (intakeQuality.observedService(observation, name)
        || (authenticatedHarvestPackets.has(packet) && !String(observation.private_source?.markdown || "").trim()
          && intakeQuality.sourceServiceCandidate(observation, name))));
  }).slice(0, 24);
}

function isVisitorServiceName(value) {
  const name = String(value || "").trim();
  if (!intakeQuality.serviceLabel(name) || /[\u00b7\u2022]/u.test(name)) return false;
  return !/^(?:financing(?: available| options?)?|payment plans?|apply for financing|free estimates?|special offers?|coupons?)$/i.test(name);
}

function isServicePage(page = {}) {
  const text = `${page.title || ""} ${page.name || ""} ${page.slug || ""} ${page.intent || ""}`.toLowerCase();
  if (!text.trim()) return false;
  if (/\b(home|about|contact|faq|reviews?|testimonials?|gallery|service areas?|areas served|locations?|process|blog)\b/.test(text)) return false;
  return /\b(service|repair|inspection|install|installation|maintenance|replacement|roof|roofing|material|commercial|residential|emergency|leak|snow|metal|shingle|septic|pool|mattress|furniture|sofa|bed|tree|removal|trim|plumb|hvac|electric)\b/.test(text)
    || /\bservice authority|urgent repair|materials authority|installation and maintenance\b/.test(text);
}

function literalMustAvoidPhrases(value) {
  return (Array.isArray(value) ? value.flat(Infinity) : [value])
    .flatMap(item => String(item || "").split(/\r?\n|;/))
    .map(item => item.trim())
    .filter(item => item && !/^do\s+not\b/i.test(item));
}

function splitLines(...values) {
  const rows = [];
  values.flat(Infinity).forEach(value => {
    if (!value) return;
    String(value).split(/\n|,|;|\|/).map(item => item.trim()).filter(Boolean).forEach(item => rows.push(item));
  });
  return rows;
}

function humanList(items) {
  const list = unique(items).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function unique(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = String(item || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wordCount(value) {
  return (String(value || "").match(/\b[\w'’-]+\b/g) || []).length;
}

function flatPacketPath(path) {
  return String(path || "")
    .replace(/^[./\\]+/, "")
    .replace(/[\\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "packet-file.txt";
}

function slugify(value) {
  return String(value || "service")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "service";
}

// Reused by the authenticated automatic intake route so Packet 2 is compiled
// by one implementation. The existing HTTP handler remains unchanged.
module.exports.compilePacket = compilePacket;
module.exports.verifiedPacketProof = verifiedPacketProof;
module.exports.compileAuthenticatedHarvestPacket = compileAuthenticatedHarvestPacket;
module.exports.withBrandFonts = withBrandFonts;
