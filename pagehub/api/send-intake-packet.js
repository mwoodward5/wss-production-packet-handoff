const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/client-snapshot-craft\.lovable\.app$/i,
  /^https:\/\/pagehub-intake\.wss-ai\.com$/i,
  /^https:\/\/[\w-]+\.lovable\.app$/i,
  /^https:\/\/[\w-]+\.lovableproject\.com$/i,
  /^https:\/\/pagehub-intake-lock-form\.vercel\.app$/i,
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i
];

const { requireProviderRouteAuth } = require("./lib/provider-route-auth");

module.exports.config = {
  maxDuration: 30
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
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || "";
    const adminRecipient = process.env.PAGEHUB_ADMIN_EMAIL || process.env.WSS_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "woodwardsoftware@gmail.com";
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const packet = body.packet || {};
    const to = String(adminRecipient).trim();
    const subject = String(body.subject || `${packet.packetName || "Client Intake Packet"} - Client Intake Packet`).trim();
    const text = String(body.body || emailText(packet)).trim();

    if (!apiKey) {
      return res.status(400).json({ ok: false, error: "Resend is not configured. Add RESEND_API_KEY in WSS." });
    }

    if (!from) {
      return res.status(400).json({ ok: false, error: "Resend sender is not configured. Add RESEND_FROM_EMAIL in WSS." });
    }

    if (!isEmail(to)) {
      return res.status(400).json({ ok: false, error: "Admin recipient email is not configured. Add PAGEHUB_ADMIN_EMAIL in WSS or use woodwardsoftware@gmail.com." });
    }

    const attachments = buildAttachments(packet, Array.isArray(body.uploadPayloads) ? body.uploadPayloads : []);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html: emailHtml(packet, text),
        attachments
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: result.message || result.error || `Resend returned ${response.status}.` });
    }

    return res.status(200).json({ ok: true, id: result.id || "" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unexpected Resend error." });
  }
};

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

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
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

function buildAttachments(packet, uploadPayloads = []) {
  const base = slugify(packet.packetName || packet.business?.businessName || "client-intake");
  const files = packetFiles(packet, base, uploadPayloads);

  const attachments = Object.entries(files).map(([filename, content]) => {
    const text = String(content ?? "");
    return {
      filename: flatPacketPath(filename, base),
      content: Buffer.from(text.length ? text : " ", "utf8").toString("base64"),
      contentType: inferContentType(filename)
    };
  });
  uploadPayloads.forEach(upload => {
    if (!upload?.filename || !upload?.content) return;
    attachments.push({
      filename: flatPacketPath(String(upload.filename).replace(/^\/+/, ""), base),
      content: String(upload.content),
      contentType: upload.contentType || inferContentType(upload.filename)
    });
  });
  return attachments;
}

function packetFiles(packet, base, uploadPayloads = []) {
  packet = safeProofPacketForExport(packet);
  const compiled = packet.compiled || {};
  const attachmentData = attachmentDataForPacket(packet);
  const counts = publicCopyCounts(packet);
  const rawProofSummary = usefulObject(compiled.proofSummary)
    ? compiled.proofSummary
    : proofSummaryFallback(packet, attachmentData);
  const proofSummary = { ...rawProofSummary,
    contentFiles: counts.visitorFiles, contentWords: counts.visitorWords,
    sourceArchiveFiles: counts.archiveFiles, sourceArchiveWords: counts.archiveWords };
  const rawTemplateReport = usefulObject(compiled.templateReport)
    ? compiled.templateReport
    : templateBuildPackReportFallback(packet, attachmentData, proofSummary);
  const templateReport = { ...rawTemplateReport,
    counts: { ...(rawTemplateReport.counts || {}),
      contentFiles: counts.visitorFiles, contentWords: counts.visitorWords,
      sourceArchiveFiles: counts.archiveFiles, sourceArchiveWords: counts.archiveWords } };
  const assetQaReport = usefulObject(packet.assetQa)
    ? packet.assetQa
    : assetQaReportFallback(packet, attachmentData, uploadPayloads);
  const files = {
    [`${base}/00-READ-ME-FIRST.md`]: readMeFirstMarkdown(packet),
    [`${base}/00-CREDIT-SAVER-PREFLIGHT.md`]: buildCreditSaverPreflightMarkdown(packet),
    [`${base}/00-WSS-MASTERPIECE-RULE.md`]: vercelMasterpieceRuleMarkdown(packet),
    [`${base}/00-SINGLE-PASS-RESKIN-PACKET.md`]: buildSinglePassReskinPacketMarkdown(packet),
    [`${base}/01-WSS-BUILD-COMMAND-CENTER.md`]: buildWSSBuildCommandCenterMarkdown(packet),
    [`${base}/02-TEMPLATE-SANITATION-CONTRACT.md`]: buildTemplateSanitationMarkdown(packet),
    [`${base}/WSS-BUILD-PLAN-PROMPT.md`]: buildRemixPlanPromptMarkdown(packet),
    [`${base}/WSS-BUILD-PROMPT.md`]: buildRemixBuildPromptMarkdown(packet),
    [`${base}/05-PACKET-DELTA-FIX-PROMPT.md`]: buildPacketDeltaFixPromptMarkdown(packet),
    [`${base}/WSS-OPERATOR-RUNBOOK.md`]: buildRemixRunbookMarkdown(packet),
    [`${base}/support-compiler-proof-summary.md`]: compilerProofSummaryMarkdown(packet),
    [`${base}/support-proof-gate-checklist.md`]: proofGateMarkdown(packet),
    [`${base}/build-context.json`]: json(packet.remix || compiled.remix || remixContractForPacket(packet)),
    [`${base}/proof-compiler-summary.json`]: json(proofSummary),
    [`${base}/asset-fetch-manifest.json`]: json(assetFetchManifest(packet, uploadPayloads)),
    [`${base}/GEO-VOICE-LOCAL-SEARCH-PLAN.md`]: searchOptimizationMarkdown(packet),
    [`${base}/search-optimization-plan.json`]: json(searchOptimizationPlanForPacket(packet)),
    [`${base}/BRIGHTDATA-SERP-AUDIT.md`]: brightDataAuditMarkdown(packet),
    [`${base}/brightdata-serp-audit.json`]: json(brightDataAuditForPacket(packet)),
    [`${base}/brightdata-query-plan.json`]: json(brightDataQueryPlanForPacket(packet)),
    [`${base}/VISUAL-SYSTEM-CONTRACT.md`]: visualSystemContractMarkdown(packet),
    [`${base}/visual-system-contract.json`]: json(visualSystemContractForPacket(packet)),
    [`${base}/PREMIUM-VISUAL-STACK.md`]: premiumVisualStackMarkdown(packet),
    [`${base}/premium-visual-stack.json`]: json(premiumVisualStackForPacket(packet)),
    [`${base}/LOCAL-PRESENCE-CONVERSION-PLAN.md`]: localPresenceMarkdown(packet),
    [`${base}/local-presence-plan.json`]: json(localPresencePlanForPacket(packet)),
    [`${base}/MAP-SDK-CONTRACT.md`]: mapSdkMarkdown(packet),
    [`${base}/map-sdk-contract.json`]: json(mapSdkContractForPacket(packet)),
    [`${base}/src-lib-business.ts`]: businessTsForPacket(packet),
    [`${base}/TEMPLATE-VARIETY-CONTRACT.md`]: templateVarietyMarkdown(packet),
    [`${base}/template-variety-contract.json`]: json(templateVarietyContractForPacket(packet)),
    [`${base}/POST-PUBLISH-VALIDATION.md`]: postPublishValidationMarkdown(packet),
    [`${base}/post-publish-validation.json`]: json(postPublishValidationForPacket(packet)),
    [`${base}/BRAND-ASSET-GENERATION.md`]: brandAssetGenerationMarkdown(packet),
    [`${base}/brand-asset-generation.json`]: json(brandAssetGenerationForPacket(packet)),
    [`${base}/SECURITY-HARDENING.md`]: securityHardeningMarkdown(packet),
    [`${base}/security-hardening.json`]: json(securityHardeningForPacket(packet)),
    [`${base}/answer-engine.json`]: json(seoAssetLayerForPacket(packet).answerEngine || {}),
    [`${base}/entity.json`]: json(seoAssetLayerForPacket(packet).entity || {}),
    [`${base}/local-business.jsonld`]: json(seoAssetLayerForPacket(packet).localBusiness || {}),
    [`${base}/locations.geojson`]: json(seoAssetLayerForPacket(packet).locationsGeojson || { type: "FeatureCollection", features: [] }),
    [`${base}/geo.kml`]: seoAssetLayerForPacket(packet).geoKml || "",
    [`${base}/sitemap-index.xml`]: seoAssetLayerForPacket(packet).sitemapsByName?.["sitemap-index.xml"] || "",
    [`${base}/sitemap-services.xml`]: seoAssetLayerForPacket(packet).sitemapsByName?.["sitemap-services.xml"] || "",
    [`${base}/sitemap-geo.xml`]: seoAssetLayerForPacket(packet).sitemapsByName?.["sitemap-geo.xml"] || "",
    [`${base}/sitemap-entity.xml`]: seoAssetLayerForPacket(packet).sitemapsByName?.["sitemap-entity.xml"] || "",
    [`${base}/offers.json`]: json(seoAssetLayerForPacket(packet).offers || []),
    [`${base}/products-feed.json`]: json(seoAssetLayerForPacket(packet).productsFeed || []),
    [`${base}/well-known-pagehub.json`]: json(seoAssetLayerForPacket(packet).wellKnownPagehub || {}),
    [`${base}/content-route-map.json`]: json(contentRouteMapForPacket(packet)),
    [`${base}/manifest.json`]: json(attachmentData.manifest),
    [`${base}/client.json`]: json(attachmentData.client),
    [`${base}/brand.json`]: json(attachmentData.brand),
    [`${base}/seo.json`]: json(attachmentData.seo),
    [`${base}/social.json`]: json(attachmentData.social),
    [`${base}/trust.json`]: json(attachmentData.trust),
    [`${base}/forms.json`]: json(attachmentData.forms),
    [`${base}/hero.json`]: json(attachmentData.hero),
    [`${base}/widget.json`]: json(attachmentData.widget),
    [`${base}/services.json`]: json(attachmentData.services),
    [`${base}/cities.json`]: json(attachmentData.cities),
    [`${base}/faqs.json`]: json(attachmentData.faqs),
    [`${base}/reviews.json`]: json(attachmentData.reviews),
    [`${base}/pages.json`]: json(attachmentData.pages),
    [`${base}/internal-links.json`]: json(attachmentData.internalLinks),
    [`${base}/voice-search.json`]: json(attachmentData.voiceSearch),
    [`${base}/sitemap-hints.json`]: json(attachmentData.sitemapHints),
    [`${base}/citations-targets.csv`]: compiled.citationsCsv || manifestCsv(packet),
    [`${base}/assets-manifest.json`]: json(attachmentData.assetsManifest),
    [`${base}/logo-qa.json`]: json(compiled.logoQa || packet.assetQa?.logoQa || {}),
    [`${base}/gallery-plan.json`]: json(compiled.galleryPlan || packet.assetQa?.galleryPlan || {}),
    [`${base}/social-preview-plan.json`]: json(compiled.socialPreviewPlan || packet.assetQa?.socialPreviewPlan || {}),
    [`${base}/llms.txt`]: attachmentData.llmsTxt,
    [`${base}/golden-artifacts.json`]: json(attachmentData.goldenArtifacts),
    [`${base}/services-protected.json`]: json(attachmentData.servicesProtected),
    [`${base}/proof/preflight-report.json`]: json(compiled.preflight || packet.readiness?.preflight || {}),
    [`${base}/proof/template-build-pack-report.json`]: json(templateReport),
    [`${base}/proof/production-lock-report.json`]: json(packet.productionLocks || compiled.productionLocks || []),
    [`${base}/artifacts/asset-qa-report.json`]: json(assetQaReport),
    [`${base}/artifacts/asset-qa-summary.md`]: assetQaSummaryMarkdown(packet),
    [`${base}/artifacts/hero-contract.md`]: heroContractMarkdown(packet),
    [`${base}/artifacts/production-lock-summary.md`]: productionLockMarkdown(packet),
    [`${base}/assets/ASSET-SOURCES.md`]: assetSourcesMarkdown(packet),
    [`${base}/assets/CLIENT-ASSET-README.md`]: assetPayloadReadme(packet, uploadPayloads),
    [`${base}/qa-checklist.md`]: qaChecklist(packet),
    [`${base}/handoff.md`]: packetMarkdown(packet),
    [`${base}/snapshot.json`]: json(packet)
  };
  const driveFolders = packetExternalAssetFolders(packet).filter(url => /drive\.google/i.test(url));
  if (driveFolders.length) {
    files[`${base}/GOOGLE-DRIVE-ASSET-FOLDER.md`] = googleDriveAssetFolderMarkdown(packet, driveFolders);
  }
  Object.entries(compiled.contentFiles || {}).forEach(([path, content]) => {
    files[`${base}/${path}`] = content;
  });
  return files;
}

function attachmentDataForPacket(packet = {}) {
  const compiled = packet.compiled || {};
  const business = packet.business || {};
  const brand = packet.brand || {};
  const requirements = packet.requirements || {};
  const pages = usefulArray(compiled.pages)
    ? compiled.pages
    : usefulArray(packet.pagePlan)
      ? packet.pagePlan
      : splitAttachmentList(requirements.pagesNeeded).map((title, index) => ({ title, slug: index === 0 || /^home$/i.test(title) ? "" : slugify(title) }));
  const services = usefulArray(compiled.services) ? compiled.services : servicesFallback(packet);
  const serviceNames = services.map(service => service.name || service.title || service.slug).filter(Boolean);
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const sameAs = collectSameAs(packet, { ...business, socialUrl: requirements.socialUrl || business.socialUrl });
  const fallbackSeo = {
    siteName: business.businessName || packet.packetName || "",
    baseUrl: business.canonicalDomain || business.domainUrl || "",
    primaryKeyword: searchPlan.primaryKeyword || requirements.primaryKeyword || "",
    secondaryKeywords: searchPlan.secondaryKeywords || [],
    localModifiers: searchPlan.localModifiers || [],
    canonicalPolicy: searchPlan.technicalRequirements?.canonicalPolicy || "",
    schemaTypes: searchPlan.technicalRequirements?.schemaTypes || ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"]
  };
  const fallbackManifest = {
    ...(compiled.manifest || {}),
    contentCompiler: compiled.manifest?.contentCompiler || compiled.compileJob?.mode || "backend-full-package-compiler",
    packetStatus: packet.readiness?.preflight?.status || compiled.preflight?.status || "compiled_needs_review",
    compileState: compiled.preflight?.compileState || compiled.compileJob?.status || "compiled",
    files: unique([
      ...((compiled.manifest && compiled.manifest.files) || []),
      "client.json",
      "brand.json",
      "seo.json",
      "forms.json",
      "hero.json",
      "services.json",
      "pages.json",
      "content-content-quality-report.json",
      "PREMIUM-VISUAL-STACK.md",
      "premium-visual-stack.json",
      "VISUAL-SYSTEM-CONTRACT.md",
      "visual-system-contract.json",
      "MAP-SDK-CONTRACT.md",
      "POST-PUBLISH-VALIDATION.md"
    ])
  };

  return {
    manifest: usefulObject(compiled.manifest) ? fallbackManifest : fallbackManifest,
    client: usefulObject(compiled.client) ? compiled.client : business,
    brand: attachmentBrandForPacket(packet),
    seo: usefulObject(compiled.seo) ? { ...fallbackSeo, ...compiled.seo } : fallbackSeo,
    social: usefulObject(compiled.social) ? compiled.social : Object.fromEntries(sameAs.map(url => [socialKey(url), url])),
    trust: trustFallback(packet),
    forms: usefulObject(compiled.forms) ? compiled.forms : formsFallback(packet, serviceNames),
    hero: usefulObject(compiled.hero) ? compiled.hero : heroFallback(packet),
    widget: usefulObject(compiled.widget) ? compiled.widget : widgetFallback(packet, serviceNames),
    services,
    cities: usefulArray(compiled.cities) ? compiled.cities : serviceAreaNamesForPacket(business).map(name => ({ name, slug: slugify(name), state: "", copyParagraph: `${business.businessName || "This business"} serves ${name}.` })),
    faqs: usefulArray(compiled.faqs) ? compiled.faqs : faqsFallback(packet, serviceNames),
    reviews: verifiedPacketProof(packet).reviews,
    pages,
    internalLinks: usefulArray(compiled.internalLinks) ? compiled.internalLinks : internalLinksFallback(pages, services),
    voiceSearch: usefulObject(compiled.voiceSearch) ? compiled.voiceSearch : voiceSearchFallback(pages, serviceNames),
    sitemapHints: usefulObject(compiled.sitemapHints) ? compiled.sitemapHints : Object.fromEntries(pages.map((page, index) => [`/${page.slug || ""}`.replace(/\/$/, "") || "/", { priority: index === 0 ? 1 : 0.7, changefreq: "monthly" }])),
    assetsManifest: usefulObject(compiled.assetsManifest) ? compiled.assetsManifest : assetsManifestFallback(packet),
    llmsTxt: String(compiled.llmsTxt || "").trim() || llmsFallback(packet, serviceNames),
    goldenArtifacts: usefulObject(packet.goldenArtifacts) ? packet.goldenArtifacts : { exactServices: serviceNames, protectedNotes: splitAttachmentList(requirements.mustInclude, requirements.mustAvoid), preservationRules: ["Preserve exact service names and source-backed business facts."] },
    servicesProtected: (usefulArray(packet.goldenArtifacts?.exactServices) ? packet.goldenArtifacts.exactServices : serviceNames).map(name => ({ name, preserveVerbatim: true }))
  };
}

function attachmentBrandForPacket(packet = {}) {
  const packetBrand = packet.brand && typeof packet.brand === "object" ? packet.brand : {};
  const compiledBrand = packet.compiled?.brand && typeof packet.compiled.brand === "object" ? packet.compiled.brand : {};
  return {
    ...packetBrand,
    ...compiledBrand,
    fonts: brandFontsForPacket(packet)
  };
}

function brandFontsForPacket(packet = {}) {
  const packetBrand = packet.brand && typeof packet.brand === "object" ? packet.brand : {};
  const compiledBrand = packet.compiled?.brand && typeof packet.compiled.brand === "object" ? packet.compiled.brand : {};
  const packetFonts = packetBrand.fonts && typeof packetBrand.fonts === "object" ? packetBrand.fonts : {};
  const compiledFonts = compiledBrand.fonts && typeof compiledBrand.fonts === "object" ? compiledBrand.fonts : {};
  return {
    display: String(firstPresent(
      compiledFonts.display,
      packetFonts.display,
      compiledBrand.displayFont,
      compiledBrand.headingFont,
      packetBrand.displayFont,
      packetBrand.headingFont
    )),
    body: String(firstPresent(
      compiledFonts.body,
      packetFonts.body,
      compiledBrand.bodyFont,
      packetBrand.bodyFont
    )),
    href: String(firstPresent(
      compiledFonts.href,
      packetFonts.href,
      compiledBrand.googleFontsUrl,
      compiledBrand.fontHref,
      packetBrand.googleFontsUrl,
      packetBrand.fontHref
    ))
  };
}

function firstPresent(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function servicesFallback(packet = {}) {
  const business = packet.business || {};
  const requirements = packet.requirements || {};
  const names = unique(splitAttachmentList(
    packet.goldenArtifacts?.exactServices,
    requirements.exactServices,
    business.exactServices,
    requirements.mainServices,
    business.mainServices
  )).slice(0, 30);
  return names.map(name => ({
    slug: slugify(name),
    name,
    h1: name,
    metaTitle: `${name} | ${business.businessName || "Local Service"}`,
    metaDescription: `${business.businessName || "This business"} provides ${name.toLowerCase()} for ${business.serviceArea || "local customers"}.`,
    shortDesc: `${name} with source-backed copy, form option preservation, and service-area context.`,
    longDescMd: `# ${name}\n\n${business.businessName || "The business"} provides ${name} for ${business.serviceArea || "its service area"}. Preserve this exact service name in visible copy, the service list, lead form options, internal links, and schema. Customers should be told what details to send, including location, timing, photos when useful, and the best call-back method.`,
    faqs: [
      { q: `Do you offer ${name}?`, a: `${business.businessName || "The business"} lists ${name} as a source-backed service. Use the contact form or call ${business.phone || "the business"} to request details.` }
    ],
    schemaType: "Service",
    internalLinkTargets: ["contact", "service-areas"]
  }));
}

function formsFallback(packet = {}, serviceNames = []) {
  const business = packet.business || {};
  const requirements = packet.requirements || {};
  return {
    leadTo: business.email || "",
    leadBcc: "woodwardsoftware@gmail.com",
    autoReplyFromName: business.businessName || "Client Site",
    submitLabel: business.mainCta || requirements.mainCta || "Request estimate",
    successMessage: "Thanks. Your request was received and the team will follow up soon.",
    resendRequired: true,
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "phone", label: "Phone", type: "tel", required: true },
      { name: "email", label: "Email", type: "email", required: false },
      { name: "service", label: "Service needed", type: "select", options: serviceNames, required: true },
      { name: "location", label: "Property location / city", type: "text", required: true },
      { name: "timing", label: "Preferred timing", type: "text", required: false },
      { name: "message", label: "Project notes", type: "textarea", required: true }
    ],
    routingNote: requirements.formsRouting || "Route through the server-side Resend lead endpoint."
  };
}

function heroFallback(packet = {}) {
  const business = packet.business || {};
  const brand = packet.brand || {};
  return {
    variant: "cinematic-motion-reskin",
    eyebrow: business.serviceArea || "",
    headline: business.positioning || `${business.businessName || "Local Service"} You Can Trust`,
    subhead: `${business.businessName || "This business"} serves ${business.serviceArea || "local customers"} with ${business.mainCta || "clear next steps"}.`,
    primaryCta: business.mainCta || "Request estimate",
    secondaryCta: business.phone ? `Call ${business.phone}` : "Contact us",
    imageSlot: "hero-primary",
    assetPolicy: brand.heroSourceMode || "Use uploaded/client/source imagery first; do not publish a blank slab or old-template visual residue.",
    motionRule: "Preserve the selected template cinematic hero motion while replacing identity, colors, image subject, and copy."
  };
}

function widgetFallback(packet = {}, serviceNames = []) {
  const business = packet.business || {};
  return {
    kind: "quote",
    submitLabel: business.mainCta || "Request estimate",
    successMessage: "Request received.",
    fields: ["name", "phone", "service", "location", "timing", "message"],
    serviceOptions: serviceNames
  };
}

function safeProofPacketForExport(packet = {}) {
  const protectedNotes = Array.isArray(packet.goldenArtifacts?.protectedNotes)
    ? packet.goldenArtifacts.protectedNotes.filter(note => !/\b(?:licen[cs](?:e|ed|ing)?|certif(?:ied|ication|icate)|insured|bonded|rating|reviews?|testimonials?|awards?)\b/i.test(String(note)))
    : [];
  return { ...packet, goldenArtifacts: { ...(packet.goldenArtifacts || {}), protectedNotes },
    compiled: { ...(packet.compiled || {}), trust: verifiedPacketProof(packet).trust,
      reviews: verifiedPacketProof(packet).reviews } };
}

function verifiedPacketProof(packet = {}) {
  return require("./compile-build-packet").verifiedPacketProof(packet);
}

function trustFallback(packet = {}) {
  return verifiedPacketProof(packet).trust;
}

function faqsFallback(packet = {}, serviceNames = []) {
  const business = packet.business || {};
  return [
    { q: `What services does ${business.businessName || "the business"} offer?`, a: serviceNames.length ? `${business.businessName || "The business"} offers ${serviceNames.join(", ")}.` : "Use the protected service list from the packet.", page: "home" },
    { q: `What area does ${business.businessName || "the business"} serve?`, a: business.serviceArea || "See the service-area section in the packet.", page: "service-areas" },
    { q: "How do I request service?", a: `Use the form, call ${business.phone || "the business"}, or send details about location, timing, and service needed.`, page: "contact" }
  ];
}

function internalLinksFallback(pages = [], services = []) {
  const pageRoutes = pages.map(page => `/${page.slug || ""}`.replace(/\/$/, "") || "/");
  const serviceRoutes = services.slice(0, 8).map(service => `/services/${service.slug || slugify(service.name)}`);
  return unique([...pageRoutes, ...serviceRoutes]).flatMap(route => [
    { from: route, to: "/contact", anchor: "request an estimate", purpose: "conversion" },
    { from: route, to: "/", anchor: "home", purpose: "brand authority" }
  ]);
}

function voiceSearchFallback(pages = [], serviceNames = []) {
  const entries = {};
  pages.forEach(page => {
    const key = page.slug || "home";
    entries[key] = [`What should I know about ${page.title || "this service"}?`, "How do I request an estimate?"];
  });
  serviceNames.slice(0, 8).forEach(name => {
    entries[`service:${slugify(name)}`] = [`Do you offer ${name}?`, `How do I request ${name}?`];
  });
  return entries;
}

function assetsManifestFallback(packet = {}) {
  const uploaded = packet.sources?.uploadedFiles || [];
  const logos = packet.sources?.logos || packet.assetQa?.logoCandidates || [];
  const images = packet.sources?.images || packet.assetQa?.imageCandidates || [];
  return {
    status: uploaded.length || logos.length || images.length ? "compiled_from_sources" : "needs_assets_or_connector",
    files: uploaded.map(file => ({ slot: file.role || "evidence", file: file.exportPath || file.name, alt: file.name || "Client asset" })),
    logoCandidates: logos,
    imageCandidates: images,
    rule: "Use source-backed uploaded/Gmail/Drive/website assets first. If missing, stop before replacing with generic stock unless explicitly allowed."
  };
}

// A source archive travels with the packet for private research. It is not
// finished page copy, even when an older compiler included it in totalWords.
function publicCopyCounts(packet = {}) {
  const quality = packet.compiled?.contentQuality || {};
  const entries = Array.isArray(quality.files) && quality.files.length ? quality.files
    : Object.entries(packet.compiled?.contentFiles || {})
      .filter(([path]) => /^content\//i.test(path) && /\.md$/i.test(path))
      .map(([path, body]) => ({ sourcePath: path,
        kind: /^content\/source\//i.test(path) ? "source_archive" : "generated_copy",
        wordCount: (String(body || "").match(/\b[\w'’-]+\b/g) || []).length,
        status: "review" }));
  const visitorRows = entries.filter(row => row.kind === "generated_copy" ||
    (!row.kind && !/^content\/source\//i.test(row.sourcePath || "")));
  const archiveRows = entries.filter(row => row.kind === "source_archive" ||
    (!row.kind && /^content\/source\//i.test(row.sourcePath || "")));
  const sumWords = rows => rows.reduce((sum, row) => sum + (Number(row.wordCount) || 0), 0);
  const visitorFiles = Number(quality.visitor?.totalFiles ?? (entries.length ? visitorRows.length : quality.totalFiles || 0));
  const visitorWords = Number(quality.visitor?.totalWords ?? (entries.length ? sumWords(visitorRows) : quality.totalWords || 0));
  const archiveFiles = Number(quality.sourceArchive?.totalFiles ?? archiveRows.length);
  const archiveWords = Number(quality.sourceArchive?.totalWords ?? sumWords(archiveRows));
  return { visitorFiles, visitorWords, archiveFiles, archiveWords,
    visitorRows, archiveRows,
    reviewCount: Number(quality.visitor?.reviewCount ?? (entries.length
      ? visitorRows.filter(row => row.status !== "pass").length : quality.reviewCount || 0)),
    passCount: Number(quality.visitor?.passCount ?? (entries.length
      ? visitorRows.filter(row => row.status === "pass").length : quality.passCount || 0)) };
}

function proofSummaryFallback(packet = {}, attachmentData = attachmentDataForPacket(packet)) {
  const content = publicCopyCounts(packet);
  const preflight = packet.compiled?.preflight || packet.readiness?.preflight || {};
  const assetQa = packet.assetQa || {};
  const assetsManifest = attachmentData.assetsManifest || assetsManifestFallback(packet);
  return {
    version: "proof-summary-fallback-v1",
    generatedAt: packet.createdAt || new Date().toISOString(),
    status: preflight.status || packet.readiness?.status || "compiled_needs_review",
    rescueRisk: preflight.rescueRisk || "medium",
    targetCredits: "<=6 after coherent Plan approval",
    selectedTemplate: packet.selectedTemplateName || packet.selectedTemplateId || packet.templateFamily || "Needs review",
    contentFiles: content.visitorFiles,
    contentWords: content.visitorWords,
    sourceArchiveFiles: content.archiveFiles,
    sourceArchiveWords: content.archiveWords,
    assets: {
      logoCandidates: (assetQa.logoCandidates || assetsManifest.logoCandidates || []).length,
      imageCandidates: (assetQa.imageCandidates || assetsManifest.imageCandidates || []).length,
      uploadedFiles: (assetQa.uploadedAssetFiles || packet.sources?.uploadedFiles || []).length,
      externalAssetFolders: packetExternalAssetFolders(packet).length,
      duplicateGroups: (assetQa.duplicateGroups || assetsManifest.duplicateGroups || []).length
    },
    hardStop: Boolean((preflight.missingCritical || []).length || (preflight.buildGate && Object.values(preflight.buildGate).some(value => value === false))),
    nextAction: "Use the compiled packet attachments as source of truth. Stop before builder credits if asset files or source folders are missing."
  };
}

function templateBuildPackReportFallback(packet = {}, attachmentData = attachmentDataForPacket(packet), proofSummary = proofSummaryFallback(packet, attachmentData)) {
  const copyCounts = publicCopyCounts(packet);
  const productionLocks = packet.productionLocks || packet.compiled?.productionLocks || packet.readiness?.preflight?.productionLocks || [];
  return {
    version: "template-build-pack-report-fallback-v1",
    generatedAt: packet.createdAt || new Date().toISOString(),
    businessName: packet.business?.businessName || packet.packetName || "",
    selectedTemplateId: packet.selectedTemplateId || "",
    selectedTemplateName: packet.selectedTemplateName || "",
    templateFamily: packet.templateFamily || "",
    creditTarget: proofSummary.targetCredits || "<=6",
    status: proofSummary.status || "compiled_needs_review",
    routePlan: attachmentData.pages || [],
    counts: {
      pages: usefulArray(attachmentData.pages) ? attachmentData.pages.length : 0,
      services: usefulArray(attachmentData.services) ? attachmentData.services.length : 0,
      faqs: usefulArray(attachmentData.faqs) ? attachmentData.faqs.length : 0,
      contentFiles: copyCounts.visitorFiles,
      contentWords: copyCounts.visitorWords,
      sourceArchiveFiles: copyCounts.archiveFiles,
      sourceArchiveWords: copyCounts.archiveWords,
      internalLinks: usefulArray(attachmentData.internalLinks) ? attachmentData.internalLinks.length : 0,
      voiceSearchRoutes: usefulObject(attachmentData.voiceSearch) ? Object.keys(attachmentData.voiceSearch).length : 0,
      productionLocks: productionLocks.length
    },
    requiredFirstPassFiles: [
      "00-WSS-MASTERPIECE-RULE.md",
      "01-WSS-BUILD-COMMAND-CENTER.md",
      "WSS-BUILD-PROMPT.md",
      "PREMIUM-VISUAL-STACK.md",
      "VISUAL-SYSTEM-CONTRACT.md",
      "content-route-map.json",
      "client.json",
      "brand.json",
      "services.json",
      "forms.json",
      "hero.json",
      "assets-manifest.json",
      "snapshot.json"
    ],
    stopRules: [
      "Do not preserve old-template business identity, assets, schema, sitemap, form recipients, or metadata.",
      "Do not replace missing client assets with generic stock unless the packet explicitly allows it.",
      "Use generated visitor-copy files as the first draft. Source-archive files are private research only; never publish them raw."
    ],
    productionLocks
  };
}

function assetQaReportFallback(packet = {}, attachmentData = attachmentDataForPacket(packet), uploadPayloads = []) {
  const assetsManifest = attachmentData.assetsManifest || assetsManifestFallback(packet);
  const uploaded = packet.sources?.uploadedFiles || [];
  const externalFolders = packetExternalAssetFolders(packet);
  const logoCandidates = unique([...(assetsManifest.logoCandidates || []), packet.brand?.logoLink]).filter(Boolean);
  const imageCandidates = unique([...(assetsManifest.imageCandidates || []), ...uploaded.map(file => file.exportPath || file.name || "")]).filter(Boolean);
  const missingCritical = [
    logoCandidates.length ? "" : "Official logo asset/source is missing.",
    imageCandidates.length || externalFolders.length ? "" : "Hero/gallery assets or a source folder are missing.",
    packet.brand?.brandColors || attachmentData.brand?.primary || attachmentData.brand?.primaryHex ? "" : "Brand colors need confirmation.",
    attachmentData.hero?.source || imageCandidates.length || externalFolders.length ? "" : "Hero source media needs staging or generation approval."
  ].filter(Boolean);
  return {
    version: "asset-qa-fallback-v1",
    generatedAt: packet.createdAt || new Date().toISOString(),
    status: missingCritical.length ? "review" : "pass",
    readyForBuilder: missingCritical.length === 0,
    logoCandidates,
    imageCandidates,
    uploadedAssetFiles: uploaded.map(file => ({
      name: file.name || "",
      role: file.role || "evidence",
      type: file.type || "",
      sizeBytes: file.size || 0,
      payloadAttached: uploadPayloads.some(upload => upload.filename === (file.exportPath || file.name))
    })),
    externalAssetFolders: externalFolders,
    duplicateGroups: assetsManifest.duplicateGroups || [],
    missingCritical,
    issues: missingCritical,
    recommendations: [
      "Keep actual logo, hero, favicon, OG, and gallery files at the packet root or attach a clearly named asset ZIP.",
      "If a Google Drive folder is listed, use the connected Drive account before spending builder credits.",
      "Matte or clean logo backgrounds before placing them in light/dark headers."
    ]
  };
}

function llmsFallback(packet = {}, serviceNames = []) {
  const business = packet.business || {};
  return `${business.businessName || packet.packetName || "This business"} serves ${business.serviceArea || "its local market"} with ${serviceNames.slice(0, 8).join(", ") || "the services listed in the intake packet"}. Use the packet facts as the source of truth for NAP, services, map policy, form routing, schema, sitemap, social preview, and content. Do not preserve old-template identity or unsupported claims.`;
}

function splitAttachmentList(...values) {
  return values
    .flat(Infinity)
    .flatMap(value => String(value || "").split(/\r?\n|;|,/))
    .map(value => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function usefulArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function usefulObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function socialKey(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("facebook")) return "facebook";
  if (value.includes("instagram")) return "instagram";
  if (value.includes("youtube")) return "youtube";
  if (value.includes("linkedin")) return "linkedin";
  if (value.includes("tiktok")) return "tiktok";
  if (value.includes("yelp")) return "yelp";
  if (value.includes("bbb")) return "bbb";
  if (value.includes("maps.apple")) return "appleMaps";
  if (value.includes("google.com/maps")) return "googleMaps";
  if (value.includes("x.com") || value.includes("twitter")) return "x";
  return slugify(value.replace(/^https?:\/\//, "").split(/[/?#]/)[0] || "social");
}

function flatPacketPath(path, base = "") {
  let value = String(path || "")
    .replace(/^[./\\]+/, "")
    .replace(/[\\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const cleanBase = String(base || "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleanBase && value.toLowerCase().startsWith(`${cleanBase.toLowerCase()}-`)) {
    value = value.slice(cleanBase.length + 1);
  }
  return value || "packet-file.txt";
}

function inferContentType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown; charset=utf-8";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (name.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (name.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function contentRouteMapForPacket(packet = {}) {
  const compiled = packet.compiled || {};
  if (Array.isArray(compiled.routeContentMap) && compiled.routeContentMap.length) return compiled.routeContentMap;
  const pages = Array.isArray(compiled.pages) && compiled.pages.length ? compiled.pages : (packet.pagePlan || []);
  const contentFiles = compiled.contentFiles || {};
  const serviceEntries = Object.keys(contentFiles)
    .filter(path => /^content\/services\/.+\.md$/i.test(path))
    .map(path => ({ path, slug: slugify(path.replace(/^content\/services\//i, "").replace(/\.md$/i, "")) }));
  return (pages || []).map((page, index) => {
    const title = page.title || page.name || (index === 0 ? "Home" : `Page ${index + 1}`);
    const slug = slugify(page.slug || title);
    const route = page.slug ? `/${String(page.slug).replace(/^\/+/, "")}` : "/";
    const mapped = [];
    if (!page.slug || /^home$/i.test(title)) mapped.push("content/home.md");
    else if (/contact|quote|estimate/i.test(title)) mapped.push("content/contact.md");
    else if (/service\s*areas?|locations?|areas?\s*served/i.test(title)) mapped.push("content/service-areas.md");
    else if (/about|company|story/i.test(title)) mapped.push("content/about.md");
    else {
      serviceEntries.forEach(entry => {
        if (slug.includes(entry.slug) || entry.slug.includes(slug) || wordsOverlap(slug, entry.slug)) mapped.push(entry.path);
      });
      const direct = `content/services/${slug}.md`;
      if (!mapped.length && contentFiles[direct]) mapped.push(direct);
    }
    return {
      title,
      route,
      slug: page.slug || "",
      targetKeyword: page.targetKeyword || "",
      intent: page.intent || "",
      contentFiles: unique(mapped),
      stopIfMissing: true
    };
  });
}

function premiumVisualStackForPacket(packet = {}) {
  if (packet.compiled?.premiumVisualStack) {
    const stack = packet.compiled.premiumVisualStack;
    if (stack.creativeDirectorPreflight) return stack;
    return {
      ...stack,
      creativeDirectorPreflight: buildCreativeDirectorPreflight({
        pages: (packet.pagePlan || packet.compiled?.pages || []).map(page => page.title || page.name || page.slug || "Page").filter(Boolean),
        services: (packet.compiled?.services || []).map(service => service.name || service.title || service.slug).filter(Boolean)
      })
    };
  }
  const business = packet.business || {};
  const brand = packet.brand || {};
  const requirements = packet.requirements || {};
  const data = { ...business, ...brand, ...requirements };
  const services = Array.isArray(packet.compiled?.services) ? packet.compiled.services : [];
  const pagePlan = Array.isArray(packet.compiled?.pages) ? packet.compiled.pages : (packet.pagePlan || []);
  const galleryPlan = packet.compiled?.galleryPlan || packet.assetQa?.galleryPlan || {};
  const logoQa = packet.compiled?.logoQa || packet.assetQa?.logoQa || {};
  const serviceNames = services.map(service => service.name || service.title || service.slug).filter(Boolean).slice(0, 10);
  const routeNames = pagePlan.map(page => page.title || page.name || page.slug || "Page").filter(Boolean).slice(0, 10);
  const hasHeroAsset = Boolean(packet.compiled?.hero?.source || packet.assetQa?.heroContract?.source || brand.heroSourceMode || data.heroSourceMode);
  const hasVisualAssets = Boolean((galleryPlan.semanticSlots || []).length || packet.assetQa?.imageCandidates?.length || packet.sources?.images?.length || packetExternalAssetFolders(packet).length);
  const hasBrand = Boolean(logoQa.primaryLogoSource || brand.logoLink || packet.compiled?.brand?.logoSource || data.brandColors);
  const hasFactBase = Boolean(business.businessName || packet.client?.businessName || packet.compiled?.client?.businessName);
  const missing = [];
  if (!hasFactBase) missing.push("business identity and verified intake facts");
  const designFallbacks = [];
  if (!hasBrand) designFallbacks.push("derive a temporary premium type/mark and palette from the intake, then flag it as not an official logo");
  if (!hasHeroAsset) designFallbacks.push("create a procedural, typographic, canvas, SVG, or abstract cinematic hero; do not pretend it is client project photography");
  if (!hasVisualAssets) designFallbacks.push("use ingredients-kit layouts, 21st.dev-style component patterns, iconography, motion, maps, diagrams, and conversion widgets instead of waiting on a gallery");
  const creativeDirectorPreflight = buildCreativeDirectorPreflight({
    pages: routeNames,
    services: serviceNames,
    hasVisualAssets
  });

  return {
    version: "premium-visual-stack-v2",
    status: missing.length ? "needs_fact_confirmation" : "ready_for_premium_cinematic_design",
    purpose: "Use the intake as the verified fact/content layer only. Visual execution must be premium, cinematic, component-rich, and WSS-ready using real media, ingredients-kit/source patterns, 21st.dev-quality components, and honest fallbacks instead of collapsing into a generic brochure build.",
    runtimeTargets: ["WSS/compiler original build as the default", "Next.js App Router or Vite/React on WSS", "React builds that use packet facts, content, SEO, schema, maps, and forms as source of truth", "A real ingredients-kit recipe, source TSX family, or named 21st.dev-style component family should be selected before coding the first viewport", "WSS only as legacy/reference assembly when explicitly selected by the operator"],
    preferredStack: {
      framework: "Next.js App Router or Vite/React on WSS for new external builds; preserve an existing framework only when the operator explicitly chooses a legacy reference/remix.",
      language: "TypeScript where a source project supports it.",
      styling: "Tailwind CSS or existing source-template CSS with tokenized brand colors, glass/material surfaces, clear button states, light default, and dark mode only when intentional.",
      ui: ["source components from ingredients-kit/source when available", "21st.dev-style component patterns", "shadcn/ui", "Radix primitives", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge"],
      motion: "Motion for React / Framer-style scroll reveals, stagger, hover lift, video/hero depth, and reduced-motion support.",
      theme: "next-themes for Next builds; equivalent class/data-theme handling when remixing."
    },
    designLanguage: [
      "Cinematic hero with real video/photo depth when available; when media is missing, use procedural/abstract/typographic depth and never claim generated visuals are real jobs.",
      "Premium agency spacing, typography hierarchy, high-contrast CTAs, glass/material surfaces, and no generic Bootstrap-like or plain Vite brochure sections.",
      "Bento/grid sections only when they help scan services, proof, process, pricing, or trust.",
      "Glass morphism and translucent panels are allowed for hero/trust/map overlays when contrast stays accessible and the surface feels intentional.",
      "Every inner page needs a designed hero or visual header, not a plain text slab.",
      "Default public site mode is light unless the client/template explicitly requires dark; dark heroes should be clear, dimensional, and readable.",
      "Design must feel custom and expensive: animated hero systems, signature motifs, interactive galleries/widgets, editorial rhythm, and polished mobile behavior are expected.",
      "The visual idea must carry through the full scroll: every post-hero band needs its own treatment, component rhythm, content depth, and footer polish instead of dropping into a flat scaffold after the hero."
    ],
    reusableSections: [
      { name: "PremiumNavbar", required: ["logo slot with cleaned light/dark asset", "primary nav", "phone/quote CTA", "mobile sheet menu"] },
      { name: "HeroSection", required: ["H1", "subhead", "primary CTA", "secondary CTA", "trust strip", "cinematic media"] },
      { name: "InteractivePlannerWidget", required: ["service chips", "timeline/urgency choice", "location or property context", "live summary", "CTA handoff to form/API"] },
      { name: "InteractiveGalleryWidget", required: ["real/source assets when available", "semantic filters", "lightbox or motion reveal", "decorative fallback clearly separated from proof"] },
      { name: "TrustBar", required: ["reviews or verified proof", "service area", "fast response/service badge", "credential logos when source-backed"] },
      { name: "BentoFeatureGrid", required: ["4-8 service/proof cards", "icons", "short copy", "responsive rhythm"] },
      { name: "LocalSEOSection", required: ["city/service answer blocks", "nearby areas", "map/directions CTA", "schema-aligned copy"] },
      { name: "TestimonialSection", required: ["verified review cards", "rating display", "source labels"] },
      { name: "FAQSection", required: ["SEO-friendly questions", "plain-language answers", "FAQ schema-ready content"] },
      { name: "FinalCTA", required: ["strong close", "phone/quote/directions actions", "form or Resend route when applicable"] },
      { name: "PremiumFooter", required: ["logo/identity lockup", "NAP/contact actions", "service/local links", "map/directions/social/sameAs", "form CTA", "legal/schema/canonical consistency", "mobile spacing with no orphan chip stacks"] }
    ],
    assetContract: {
      hero: ["hero-poster.webp 1920x1080 or verified muted MP4 loop", "hero-mobile.webp", "OG crop source 1200x630"],
      brand: ["logo-light.webp", "logo-dark.webp", "logo-transparent.webp", "favicon-source >=512px", "apple-touch-icon.png"],
      gallery: ["deduped gallery-01..08 files", "service-card image slots", "about/proof image slots", "For 10+ usable images, require featured lead, full-width masonry/grid/carousel/lightbox, max four useful filters, captions/alt text, lazy loading, duplicate-pruned order, and no dead side column."],
      qualityRules: ["clean/matte logo backgrounds", "dedupe repeated photos", "avoid old-template assets", "keep assets at root or clearly named first-level files", "generated/procedural/stock visuals may support atmosphere and UI, but cannot be labeled as client proof, reviews, credentials, crews, or completed projects"]
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
      "21st.dev-inspired Hero Animated, Scroll Morph Hero, PrismaHero, Video Scroll Hero, Aurora Background, LiquidAurora, Interactive Bento Gallery, Gallery Animation, Testimonial Slider, Magic Text Reveal, CTA Card, Interactive Map, Floating Nav, Modern Mobile Menu",
      "ingredients-kit hero families, nav/button variants, widget registry patterns, and real source TSX should be treated as reusable implementation ingredients, not merely mood-board inspiration.",
      "Use these as vocabulary for component quality and motion, not as permission to add random libraries without approval."
    ],
    firstPlanEcho: [
      "Confirm this is a WSS/compiler original build unless the operator explicitly chose a legacy remix/reference.",
      "Name the exact ingredients-kit recipe, source TSX family, or 21st.dev-style layout family being used; if no source exists, explain the premium fallback.",
      "Name the logo strategy: official cleaned logo, improved asset extraction, or provisional designed identity system.",
      "Name the hero media source, real-video/photo path if available, and honest procedural/abstract fallback rule.",
      "List the exact component sections, gallery/widget interactions, and motion grammar to create or preserve.",
      "Summarize the creative director/design council preflight: full-scroll visual arc, section treatments, ingredient choices, content-depth map, signature motif, motion grammar, footer polish, and no flat scaffold after the hero.",
      "Confirm the asset contract is satisfied or list design fallbacks before build credits.",
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
      "section-by-section treatment for every planned page band",
      "component/ingredient selection with named source, ingredients-kit, or 21st.dev-style patterns",
      "content-depth mapping that assigns compiled content, proof, FAQs, service copy, and local SEO blocks to designed sections",
      "signature motif that repeats across hero, cards, dividers, icons, map, forms, and footer",
      "motion grammar for reveals, transitions, hover states, galleries, widgets, and reduced-motion behavior",
      "footer polish: NAP, service links, map/directions, social/sameAs, form CTA, logo treatment, schema/canonical consistency",
      "explicit no-flat-scaffold-after-hero plan for all post-hero sections"
    ],
    firstPlanMustAnswer: [
      `Which pages/sections are being visually treated? ${pages.length ? pages.join(", ") : "Use page plan and content-route-map.json."}`,
      `Which service/content depth blocks receive designed treatment? ${services.length ? services.join(", ") : "Use services.json and content files."}`,
      "What is the signature motif, and how does it appear beyond the hero?",
      "What ingredient/component families are selected, and where are they used?",
      "What motion grammar is used, and how is reduced motion respected?",
      "How does the footer feel finished rather than leftover?"
    ],
    stopRules: [
      "Stop before build if the plan only describes a hero and leaves the rest of the page as generic stacked sections.",
      "Stop before build if section treatments do not map to the compiled content depth, page plan, services, proof, local SEO blocks, forms, and footer.",
      "Stop before build if visual ideas require fake project photos, fake reviews, fake credentials, unsupported guarantees, invented geo data, or old-client residue.",
      "Do not override factual safeguards: verified packet facts, exact service names, form routing, map/GBP policy, schema/canonical data, and source-backed reviews/trust cues stay authoritative."
    ]
  };
}

function visualSystemContractForPacket(packet = {}) {
  if (packet.compiled?.visualSystemContract) {
    return {
      ...packet.compiled.visualSystemContract,
      creativeDirectorPreflight: packet.compiled.visualSystemContract.creativeDirectorPreflight || packet.compiled.visualSystemContract.premiumVisualStack?.creativeDirectorPreflight || premiumVisualStackForPacket(packet).creativeDirectorPreflight || buildCreativeDirectorPreflight(),
      premiumVisualStack: packet.compiled.visualSystemContract.premiumVisualStack || premiumVisualStackForPacket(packet)
    };
  }
  const business = packet.business || {};
  const brand = packet.brand || {};
  const requirements = packet.requirements || {};
  const data = { ...business, ...brand, ...requirements };
  const remix = remixContractForPacket(packet);
  const hero = packet.compiled?.hero || packet.assetQa?.heroContract || {};
  const galleryPlan = packet.compiled?.galleryPlan || packet.assetQa?.galleryPlan || {};
  const logoQa = packet.compiled?.logoQa || packet.assetQa?.logoQa || {};
  const services = Array.isArray(packet.compiled?.services) ? packet.compiled.services : [];
  const serviceNames = services.map(service => service.name || service.title || service.slug).filter(Boolean);
  const hasHeroMode = Boolean(hero.variant || brand.heroSourceMode || hero.brief);
  const hasLogo = Boolean(logoQa.primaryLogoSource || brand.logoLink || packet.compiled?.brand?.logoSource);
  const hasFactBase = Boolean(business.businessName || packet.client?.businessName || packet.compiled?.client?.businessName);
  const photosExpected = /^yes|partial$/i.test(String(brand.clientPhotosReceived || ""));
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
    "Make the hero the highest-value surface: cinematic, readable, brand-specific, mobile-aware, and backed by real media/video when available or honest procedural/abstract art when not.",
    "Transform the lead area into an industry-specific funnel with service choices, urgency/timeline, location, contact preference, and next-step CTA.",
    "Use gallery assets as proof only when real/source-backed; otherwise use diagrams, icons, maps, UI cards, glass panels, and abstract/procedural visuals without fake project claims.",
    "Use local trust visually: map/directions, service-area chips, source-backed review/trust cues, schema-consistent sameAs/social links, and clean CTA routing.",
    "Build a complete premium brand system: cleaned official logo or provisional designed identity, light/dark mark handling, accessible contrast, balanced palette, polished spacing, motion polish, and no one-note color wash.",
    "Complete the creative director/design council preflight before build: full-scroll visual arc, section-by-section treatments, ingredient choices, content-depth map, signature motif, motion grammar, footer polish, and no flat scaffold after the hero."
  ];
  const premiumVisualStack = premiumVisualStackForPacket(packet);
  const creativeDirectorPreflight = premiumVisualStack.creativeDirectorPreflight || buildCreativeDirectorPreflight({
    pages: (packet.pagePlan || []).map(page => page.title || page.name || page.slug || "Page").filter(Boolean),
    services: serviceNames,
    hasVisualAssets: Boolean((galleryPlan.semanticSlots || []).length)
  });
  return {
    version: "visual-wow-contract-v2",
    status: missing.length ? "needs_fact_confirmation" : "ready_for_premium_cinematic_build",
    mandate: "The intake is a fact and content source, not a design cage. Build a premium, cinematic WSS-ready site using packet truth, ingredients-kit/source patterns, 21st.dev-quality ingredients, real media when available, and honest visual fallbacks; avoid fake claims and old-template residue.",
    creditPolicy: "Spend design effort on premium execution. Do not spend time asking for a selected template or waiting for photos when honest procedural/abstract/interactive visuals and a provisional identity system can carry the build.",
    templateFingerprint: {
      required: false,
      templateName: remix.template?.remixTemplateName || remix.template?.localTemplateName || packet.selectedTemplateName || "",
      templateUrl: remix.template?.remixTemplateUrl || "",
      preservePrimitives,
      forbiddenDeletes: ["verified business facts", "protected service names", "form routing", "map/GBP policy", "schema/canonical data", "source-backed reviews/trust cues", "no-old-client-residue gate"]
    },
    heroEnrichment: {
      sourceMode: hero.variant || brand.heroSourceMode || "Create an original premium hero using real media/video when available or honest procedural/abstract/typographic visuals when not.",
      requiredOutput: hero.requiredOutput || "Cinematic nonblank first viewport with brand, service area, primary CTA, secondary CTA, and readable mobile crop.",
      brief: hero.brief || `${business.businessName || "Client"} needs a premium, local, service-specific hero for ${business.serviceArea || "the service area"}.`,
      qualityBar: [
        "Use depth, contrast, motion, and signature visual language instead of a flat slab.",
        "Hero should feel custom, expensive, and clear while preserving readability.",
        "Primary CTA, secondary CTA, trust cue, and service-area cue must be visible without crowding.",
        "Mobile first viewport must still show brand, offer, and one clear action."
      ]
    },
    widgetEnrichment: {
      directive: "Re-skin the existing widget into a custom industry funnel; never replace it with a plain contact form unless approved.",
      serviceOptions: serviceNames.slice(0, 8),
      requiredSignals: ["service needed", "urgency/timeline", "location/service area", "best contact method", "next step CTA"]
    },
    galleryEnrichment: {
      directive: "Use real client/Drive/source assets as proof when available. If not available, use diagrams, service cards, maps, glass UI panels, and procedural visuals without fake project claims.",
      availableSlots: galleryPlan.semanticSlots || [],
      minimumWhenPhotosExpected: photosExpected ? 6 : 0,
      duplicatePolicy: "Deduplicate and keep the strongest crop for each visual role."
    },
    brandEnrichment: {
      logoSource: logoQa.primaryLogoSource || brand.logoLink || packet.compiled?.brand?.logoSource || "",
      palette: data.brandColors || "",
      tone: brand.visualTone || "premium, polished, trustworthy",
      requiredBehavior: ["light/dark logo handling", "header contrast over hero", "button states", "favicon/OG polish"]
    },
    localTrustEnrichment: {
      serviceArea: business.serviceArea || "",
      pageCount: (packet.pagePlan || []).length,
      serviceCount: serviceNames.length,
      visualSignals: ["service-area chips", "directions/map CTA", "source-backed review/trust cues", "internal links to services/contact"]
    },
    creativeDirectorPreflight,
    premiumVisualStack,
    enrichmentMandates,
    firstResponseRequired: [
      "Name the exact ingredient/source-template/layout family you will adapt, including component placement.",
      "Describe the original hero treatment and honest real-media/procedural fallback.",
      "Describe the creative director/design council preflight: full-scroll visual arc, section-by-section treatments, ingredient choices, content-depth map, signature motif, motion grammar, footer polish, and no flat scaffold after the hero.",
      "Describe the custom widget or lead-funnel transformation.",
      "Describe the gallery/proof treatment and state whether gallery visuals are source-backed or decorative.",
      "List the visual QA gates you will satisfy before publish."
    ],
    stopRules: [
      "Stop before build if verified business identity, contact routing, or map/domain policy is missing.",
      "Stop before build if the plan uses fake project photos, fake reviews, fake credentials, unsupported guarantees, or old-client residue.",
      "Stop before build if the plan starts from a blank/plain scaffold without a selected ingredient/source-template family and no explicit rough-draft approval.",
      "Stop before build if the first viewport is card-first, Polaroid/photo-card-first, testimonial-card-first, a three-service-card hero, or a centered headline plus card deck unless rough-draft speed is explicitly approved.",
      "Do not stop merely because a template, hero image, logo, or gallery is missing; create an honest premium fallback and flag what remains unofficial.",
      "Stop before publish if the first viewport is blank, generic, old-client, unreadable, or missing CTAs."
    ],
    qaGates: [
      "First viewport is nonblank, cinematic, readable, and brand-specific on desktop and mobile.",
      "Ingredient patterns are adapted into an original build, not copied as stale demo/client content.",
      "No old-client visual residue remains in images, logo, alt text, map, schema, OG image, favicon, or hidden constants.",
      "Hero, widget, gallery, map, forms, and sticky CTA all point to the same verified client facts.",
      "Generated/procedural/stock visuals are allowed for atmosphere, abstract art, icons, diagrams, and UI support unless explicitly forbidden; they must never be presented as real project photos, reviews, licenses, credentials, guarantees, crews, or before/after proof.",
      "Text does not overlap, clip, or crowd buttons/cards at mobile and desktop breakpoints.",
      "Glass surfaces use real alpha, blur, border, shadow, depth, and readable contrast; opaque fake glass fails QA.",
      "10+ image galleries use an organized full-width system with filters/carousel/lightbox/masonry or tasteful dimensional interaction, not a narrow/dead-column layout.",
      "Footer polish matches the rest of the site: logo/identity, NAP, service/local links, map/directions/social/sameAs, form CTA, legal/schema/canonical consistency, and clean mobile spacing.",
      "If no official logo exists, the provisional identity is clearly labeled internally and treated consistently across favicon, OG, header, footer, and UI details.",
      "No plain scaffold passes QA: first viewport, post-hero sections, buttons, cards, galleries, widgets, and footer must show ingredient/source-template polish before publish.",
      "Visual enrichment is done in the same build pass without a second broad design prompt."
    ],
    reviewItems,
    missing
  };
}

function buildCreditSaverPreflightMarkdown(packet = {}) {
  const business = packet.business || {};
  const compiled = packet.compiled || {};
  const content = compiled.contentQuality || {};
  const copyCounts = publicCopyCounts(packet);
  const routeMap = contentRouteMapForPacket(packet);
  const visual = visualSystemContractForPacket(packet);
  const creative = visual.creativeDirectorPreflight || visual.premiumVisualStack?.creativeDirectorPreflight || buildCreativeDirectorPreflight();
  const missingRoutes = routeMap.filter(item => item.stopIfMissing && item.route !== "/" && !item.contentFiles.length);
  const serviceFiles = (content.files || []).filter(file => /content-services-/i.test(file.file));
  const blogFiles = (content.files || []).filter(file => /content-blog-/i.test(file.file));
  const proof = compiled.proofSummary || {};
  return [
    `# Credit Saver Preflight - ${business.businessName || packet.packetName || "Client"}`,
    "",
    "This file exists to prevent a May Roofing-style credit blowout.",
    "",
    "## Hard Rule",
    "- Do not build until you can read this file, 00-WSS-MASTERPIECE-RULE.md, PREMIUM-VISUAL-STACK.md, VISUAL-SYSTEM-CONTRACT.md, content-content-quality-report.json, content-route-map.json, 01-WSS-BUILD-COMMAND-CENTER.md, WSS-BUILD-PLAN-PROMPT.md, and WSS-BUILD-PROMPT.md.",
    "- In the first builder reply, echo visitor-copy files and words separately from the private source archive, plus service article count, blog article count, and route-content map.",
    "- Also echo PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md: target stack, reusable sections, asset contract, preserved primitives, hero upgrade, widget upgrade, gallery/proof upgrade, and visual QA gates.",
    "- Also echo the creative director/design council preflight before build: full-scroll visual arc, section-by-section treatment, component/ingredient selection, content-depth mapping, signature motif, motion grammar, footer polish, and no flat scaffold after the hero.",
    "- If the counts do not match, stop. You are reading the wrong/partial packet or Gmail/Drive access is incomplete.",
    "- Do not spend build credits discovering content, services, routes, SEO targets, maps, or source assets that already exist in the packet.",
    "",
    "## Expected Packet Counts",
    `- Business: ${business.businessName || "Needs review"}`,
    `- Target first-pass credits: ${proof.targetCredits || "<=6 after coherent Plan approval"}`,
    `- Visitor copy files expected: ${copyCounts.visitorFiles}`,
    `- Visitor copy words expected: ${copyCounts.visitorWords}`,
    `- Private source archive: ${copyCounts.archiveFiles} files, ${copyCounts.archiveWords} words; research only, never publish raw.`,
    `- Service article files expected: ${serviceFiles.length}`,
    `- Blog/support article files expected: ${blogFiles.length}`,
    `- Visitor copy review count: ${copyCounts.reviewCount}`,
    `- Visual contract status: ${visual.status}`,
    `- Visual enrichment mandates: ${visual.enrichmentMandates.length}`,
    `- Creative director preflight: ${creative.status}; ${(creative.requiredOutputs || []).length} required outputs`,
    "",
    "## Route To Content Map",
    ...(routeMap.length ? routeMap.map(item => `- ${item.route}: ${item.contentFiles.length ? item.contentFiles.join("; ") : "MISSING - stop before build"}`) : ["- MISSING - stop before build"]),
    "",
    "## Highest-Priority Content Files",
    ...copyCounts.visitorRows.slice(0, 40).map(file => `- ${file.file}: ${file.wordCount} words; source ${file.sourcePath}`),
    "",
    "## Stop Conditions",
    ...(missingRoutes.length ? missingRoutes.map(item => `- Missing content mapping for ${item.route} (${item.title}).`) : ["- No missing route-content mappings detected."]),
    "- Stop if services.json is empty but content/services/*.md exists; use the service markdown files and content-route-map.json as source copy.",
    "- Stop if you only see six generic files for a premier build that should include service/blog article files.",
    "- Stop if connector access has not been linked for Gmail, Google Drive, Maps, or Resend when the prompt asks for it.",
    "- Stop if the plan proposes a plain scaffold instead of a WSS bespoke design system with a named ingredient/component strategy.",
    "- Stop if the plan has a polished hero but leaves post-hero sections, content depth, motion, and footer as a flat scaffold.",
    "- Stop if PREMIUM-VISUAL-STACK.md or VISUAL-SYSTEM-CONTRACT.md is not read or the plan fails to create a premium hero, motion, widget, gallery system, page visual headers, and reusable sections.",
    "",
    "## Build Instruction",
    "After the operator approves the plan, perform one deterministic WSS production pass using the packet content and route map. Do not ask the builder to invent or re-research authority content that is already in the packet."
  ].join("\n");
}

function wordsOverlap(a, b) {
  const left = new Set(String(a || "").split("-").filter(word => word.length > 3));
  return String(b || "").split("-").filter(word => word.length > 3).some(word => left.has(word));
}

function vercelMasterpieceRuleMarkdown(packet = {}) {
  const business = packet.business || {};
  const brand = packet.brand || {};
  const visual = visualSystemContractForPacket(packet);
  const premium = visual.premiumVisualStack || premiumVisualStackForPacket(packet);
  return [
    `# WSS Masterpiece Rule - ${business.businessName || packet.packetName || "Client"}`,
    "",
    "This is a WSS-first build packet. WSS is not the default builder, planner, or approval lane.",
    "",
    "## Builder Psychology",
    "- The intake is the verified source of truth for facts, content, assets, NAP, SEO, schema, map policy, services, reviews, forms, and claims.",
    "- The intake is not a design cage. Use the facts as fuel for a bespoke, expensive, full-site visual concept.",
    "- Build on WSS with the repo/compiler stack unless the operator explicitly selects a legacy reference/remix.",
    "- Use the ingredients kit, source components, 21st.dev/shadcn-quality patterns, real assets, procedural visuals, and motion systems as implementation material, not as mood-board decoration.",
    "- Do not ship a premium hero followed by flat cards, opaque fake glass, generic forms, poor typography, weak buttons, Polaroid defaults, dead whitespace, or an unfinished footer.",
    "",
    "## Logo And Identity Gate",
    `- Official logo/source: ${brand.logoLink || packet.compiled?.brand?.logoSource || "not confirmed"}`,
    "- First choice: use the best official client logo, cleaned for transparent, light, dark, favicon, and OG contexts.",
    "- If the logo is low-quality or missing, design a polished provisional identity system from the business name, industry, service area, and brand colors; label it provisional until approved.",
    "- The logo/mark must drive the visual system: palette, typography, icon style, motif, buttons, map pins, gallery frames, footer, favicon, and social preview.",
    "- PageHub/compass-rose thinking may guide internal direction and navigation motifs, but do not expose an unapproved PageHub mark as the client logo.",
    "",
    "## Design Council Gate",
    "- Before coding, produce a full-scroll concept: hero, proof, services, gallery, planner/widget, map/local trust, content depth, FAQ, contact, footer, mobile states, and motion grammar.",
    "- Choose one hero archetype and one site-wide motif. Every section should feel intentionally designed, not assembled from unrelated blocks.",
    "- Every glass surface must actually be glass: alpha background, blur, border, light/shadow, readable contrast, and depth behind it.",
    "- Every button/chip/card must have custom sizing, hover/active/focus states, and clean typography at desktop and mobile widths.",
    "- More than 10 images requires an organized gallery system: filters, carousel/lightbox/masonry/3D interaction where appropriate, lazy loading, and no left-column void.",
    "- If Gemini/AI video or cinematic media is requested but not present, create a clear video-slot/fallback plan and use source-safe procedural motion until the video asset is available.",
    "",
    "## Required First Build Outputs",
    "- WSS-ready source implementation with real route/content files consumed.",
    "- Schema, metadata, OG, favicon, sitemap hints, local search/voice answer content, map/directions policy, and form routing wired from the packet.",
    "- Desktop and mobile visual QA across first viewport, gallery, map, planner/form, content-heavy sections, and footer.",
    "- Public WSS URL when publish is requested; no unpublished builder preview URL in client-facing closeout.",
    "",
    "## Current Visual Contract",
    `- Visual status: ${visual.status || "review"}`,
    `- Premium stack: ${premium.status || "review"}`,
    `- Enrichment mandates: ${(visual.enrichmentMandates || []).length}`,
    `- QA gates: ${(visual.qaGates || []).length}`,
    "",
    "Hard rule: a plain scaffold is a failed build unless the operator explicitly requested a rough draft."
  ].join("\n");
}

function readMeFirstMarkdown(packet) {
  const gate = packet.compiled?.preflight?.buildGate || packet.readiness?.preflight?.buildGate || {};
  const proof = packet.compiled?.proofSummary || {};
  const content = packet.compiled?.contentQuality || {};
  const copyCounts = publicCopyCounts(packet);
  const visual = visualSystemContractForPacket(packet);
  const creative = visual.creativeDirectorPreflight || visual.premiumVisualStack?.creativeDirectorPreflight || buildCreativeDirectorPreflight();
  return [
    `# ${packet.business?.businessName || packet.packetName || "Client"} Build Packet`,
    "",
    "This packet is delivered as first-level attachments. Do not rely on nested folders.",
    "",
    "WSS command path:",
    "- Read 00-CREDIT-SAVER-PREFLIGHT.md first. Echo its expected counts before planning. If the counts do not match, stop.",
    "- Read 00-WSS-MASTERPIECE-RULE.md next. It is the WSS-first design autonomy rule.",
    "- Read PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md before planning. Echo target stack, reusable sections, asset contract, preserved primitives, enrichment mandates, and visual QA gates.",
    "- Read the creative director/design council preflight before planning. Echo the full-scroll visual arc, section treatments, ingredients, content-depth map, signature motif, motion grammar, footer polish, and no-flat-scaffold-after-hero plan.",
    "- Start with 01-WSS-BUILD-COMMAND-CENTER.md. It is the only top-level operator prompt.",
    "- Use 02-TEMPLATE-SANITATION-CONTRACT.md as the old-client reset checklist.",
    "- Use WSS-BUILD-PLAN-PROMPT.md only as the Plan-mode aid.",
    "- Use WSS-BUILD-PROMPT.md only after the plan is approved.",
    "- Read GEO-VOICE-LOCAL-SEARCH-PLAN.md, BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, brightdata-query-plan.json, and LOCAL-PRESENCE-CONVERSION-PLAN.md before build credits.",
    "- Treat support/proof/QA/handoff files as evidence only. They are not alternate build prompts.",
    "",
    "Compiler proof:",
    `- Credit gate: ${proof.status || packet.readiness?.preflight?.status || "not compiled"}`,
    `- Visitor page copy: ${copyCounts.visitorFiles} files, ${copyCounts.visitorWords} words`,
    `- Private source archive: ${copyCounts.archiveFiles} files, ${copyCounts.archiveWords} words; research only, not publishable copy`,
    `- Route/content map: ${(packet.compiled?.routeContentMap || []).length || "See content-route-map.json"} routes mapped`,
    `- Visual contract: ${visual.status}; ${visual.enrichmentMandates.length} enrichment mandates; ${visual.qaGates.length} QA gates`,
    `- Creative director preflight: ${creative.status}; ${(creative.requiredOutputs || []).length} required outputs`,
    `- Premium visual stack: ${(visual.premiumVisualStack || premiumVisualStackForPacket(packet)).status}`,
    `- Assets: ${proof.assets?.logoCandidates || 0} logo candidates, ${proof.assets?.imageCandidates || 0} image candidates, ${proof.assets?.externalAssetFolders || 0} external folders`,
    "",
    "Before running build credits, verify:",
    `- Assets staged: ${gate.assetsStaged === true ? "yes" : "NO - stop"}`,
    `- Hero variant committed: ${gate.heroVariantCommitted === true ? "yes" : "NO - stop"}`,
    `- Sender contract present: ${gate.senderVerified === true ? "yes" : "NO - stop"}`,
    `- Favicon/social preview source staged: ${gate.faviconStaged === true ? "yes" : "NO - stop"}`,
    `- Sections structured: ${gate.sectionsStructured === true ? "yes" : "NO - stop"}`,
    "- Search intelligence: read GEO-VOICE-LOCAL-SEARCH-PLAN.md and the attached Bright Data audit/query-plan artifacts first. Do not run extra competitor crawls unless BRIGHTDATA-SERP-AUDIT.md or brightdata-serp-audit.json is missing, blocked, or status not_configured.",
    "- Local presence: include map/directions CTAs, Apple Maps, Google Maps, source-backed social links, internal links, finance/payment/gallery CTAs, and light/dark header/logo behavior in the first build pass.",
    "",
    "Wrong-packet stop rule:",
    "- If the packet appears to contain only generic content files but content-route-map.json or content/services/*.md exists, stop and read the content files again.",
    "- If 00-CREDIT-SAVER-PREFLIGHT.md says a larger file count than you can see, stop and ask for Gmail/Drive access before build credits.",
    "",
    "If any gate says stop, return a packet-completeness error before spending production build credits."
  ].join("\n");
}

function compilerProofSummaryMarkdown(packet) {
  const proof = packet.compiled?.proofSummary || {};
  const content = packet.compiled?.contentQuality || {};
  const copyCounts = publicCopyCounts(packet);
  const locks = packet.productionLocks || packet.compiled?.productionLocks || packet.readiness?.preflight?.productionLocks || [];
  const visual = visualSystemContractForPacket(packet);
  return [
    "# Compiler Proof Summary",
    "",
    `Business: ${packet.business?.businessName || packet.packetName || "Client"}`,
    `Generated: ${proof.generatedAt || packet.createdAt || new Date().toISOString()}`,
    `Credit gate: ${proof.status || packet.readiness?.preflight?.status || "not compiled"}`,
    `Rescue risk: ${proof.rescueRisk || packet.readiness?.preflight?.rescueRisk || "Unknown"}`,
    `Target credits: ${proof.targetCredits || "<=6"}`,
    `Template: ${proof.selectedTemplate || packet.selectedTemplateName || "Needs review"}`,
    "",
    "## Content Proof",
    `- Visitor copy files: ${copyCounts.visitorFiles}`,
    `- Visitor copy words: ${copyCounts.visitorWords}`,
    `- Private source archive: ${copyCounts.archiveFiles} files, ${copyCounts.archiveWords} words; research only`,
    `- Visitor copy review-count files: ${copyCounts.reviewCount}`,
    "",
    "## Asset Proof",
    `- Logo candidates: ${proof.assets?.logoCandidates || packet.assetQa?.logoCandidates?.length || 0}`,
    `- Image candidates: ${proof.assets?.imageCandidates || packet.assetQa?.imageCandidates?.length || 0}`,
    `- Uploaded files: ${proof.assets?.uploadedFiles || packet.assetQa?.uploadedAssetFiles?.length || packet.sources?.uploadedFiles?.length || 0}`,
    `- External asset folders: ${proof.assets?.externalAssetFolders || packetExternalAssetFolders(packet).length}`,
    `- Duplicate groups: ${proof.assets?.duplicateGroups || packet.assetQa?.duplicateGroups?.length || 0}`,
    "",
    "## Production Locks",
    ...(locks.length ? locks.map(check => `- ${check.label || check.key}: ${String(check.status || "review").toUpperCase()} - ${check.detail || ""}${check.status === "pass" ? "" : ` Fix: ${check.fix || ""}`}`) : ["- Not compiled"]),
    "",
    "## Search Intelligence",
    ...searchOptimizationSummaryLines(packet),
    "",
    "## Local Presence And Conversion",
    ...localPresenceSummaryLines(packet),
    "",
    "## Visual System",
    `- Status: ${visual.status}`,
    `- Enrichment mandates: ${visual.enrichmentMandates.length}`,
    `- QA gates: ${visual.qaGates.length}`,
    "",
    "## Hard Stop",
    proof.hardStop ? "Fix blockers before spending builder credits." : "No hard-stop blockers were compiled.",
    "",
    "Next action:",
    proof.nextAction || "Use this proof summary before deciding whether to build."
  ].join("\n");
}

function proofGateMarkdown(packet) {
  const gate = packet.compiled?.preflight?.buildGate || packet.readiness?.preflight?.buildGate || {};
  const contentGate = packet.compiled?.preflight?.contentGate || packet.readiness?.preflight?.contentGate || {};
  const locks = packet.productionLocks || packet.compiled?.productionLocks || packet.readiness?.preflight?.productionLocks || [];
  return [
    "# WSS Proof Gate",
    "",
    ...Object.entries(gate).map(([key, value]) => `- ${key}: ${value === true ? "PASS" : "BLOCK"}`),
    ...Object.entries(contentGate).filter(([key]) => key !== "status").map(([key, value]) => {
      const passed = key === "reviewCount"
        ? Number(value || 0) === 0
        : value === true || (typeof value === "number" && value > 0);
      return `- contentGate.${key}: ${passed ? "PASS" : "BLOCK"} (${value})`;
    }),
    "",
    "Production locks:",
    ...locks.map(check => `- ${check.label || check.key}: ${String(check.status || "review").toUpperCase()} - ${check.detail || ""}${check.status === "pass" ? "" : ` Fix: ${check.fix || ""}`}`),
    "",
    "Rules:",
    "- If a Google Drive folder is URL-only, use connected Drive access first; stop only if Drive is inaccessible and no local ZIP/files are staged.",
    "- Use attached Bright Data audit/query-plan artifacts first; run Bright Data or other competitor searches only when those artifacts are missing, blocked, or not_configured, then say so before building.",
    "- Confirm the compiled search plan maps primary, secondary, local, GEO, and voice-search targets to visible pages and schema.",
    "- Confirm LOCAL-PRESENCE-CONVERSION-PLAN.md maps Apple Maps, Google Maps, directions, social links, finance/payment/gallery CTAs, internal links, schema, and theme behavior into the first build pass.",
    "- Confirm PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md define the target component stack, reusable sections, asset contract, remix hero, motion primitives, widget/lead funnel, gallery/proof treatment, brand contrast, local trust, and mobile visual QA.",
    "- Stop if exact services or page sections are missing.",
    "- Stop if favicon, OG image, or form sender contract is missing."
  ].join("\n");
}

function assetFetchManifest(packet, uploadPayloads = []) {
  const externalFolders = packetExternalAssetFolders(packet);
  return {
    packet: packet.packetName || "",
    businessName: packet.business?.businessName || "",
    generatedAt: packet.createdAt || new Date().toISOString(),
    requiredConnectorHint: externalFolders.some(url => /drive\.google/i.test(url)) ? "google_drive" : "",
    externalAssetFolders: externalFolders,
    driveFolders: externalFolders.filter(url => /drive\.google/i.test(url)),
    mustFetchAssets: Boolean(externalFolders.length),
    stopRule: "If a Google Drive folder is listed, use connected Google Drive access before replacing imagery. If Drive access is blocked and no local image/logo/ZIP payloads are attached, stop before spending build credits.",
    uploadedFiles: (packet.sources?.uploadedFiles || []).map(file => ({
      name: file.name,
      role: file.role,
      type: file.type,
      sizeBytes: file.size || 0,
      packetFile: flatPacketPath(file.exportPath || file.name || ""),
      payloadStatus: uploadPayloads.some(upload => upload.filename === (file.exportPath || file.name)) ? "attached" : "missing_payload"
    }))
  };
}

function packetExternalAssetFolders(packet = {}) {
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

function googleDriveAssetFolderMarkdown(packet, driveFolders = packetExternalAssetFolders(packet).filter(url => /drive\.google/i.test(url))) {
  return [
    "# Google Drive Asset Folder",
    "",
    "This packet references Google Drive as an asset source. In the WSS build lane, use connected Google Drive access to read it; otherwise attach a ZIP/export before replacing imagery.",
    "",
    "## Folder URLs",
    ...driveFolders.map(url => `- ${url}`),
    "",
    "## Required Action",
    "- Fetch with the connected Google Drive account or attach the actual logo, favicon, hero, OG, and gallery image files before spending builder credits.",
    "- Keep fetched files at the first level of the packet or in clearly named root-level asset files.",
    "- If Drive access is blocked, stop and ask admin for a ZIP export instead of building with placeholders."
  ].join("\n");
}

function json(value) {
  return JSON.stringify(value || {}, null, 2);
}

function unique(items = []) {
  const seen = new Set();
  return (items || []).flat(Infinity).filter(item => {
    const key = String(item || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assetQaSummaryMarkdown(packet) {
  const qa = packet.assetQa || {};
  return [
    "# Asset QA Summary",
    "",
    `Status: ${qa.status || "not run"}`,
    `Ready for builder: ${qa.readyForBuilder ? "Yes" : "No"}`,
    "",
    "## Missing Critical",
    ...((qa.missingCritical || []).length ? qa.missingCritical.map(item => `- ${item}`) : ["- None"]),
    "",
    "## Issues",
    ...((qa.issues || []).length ? qa.issues.map(item => `- ${item}`) : ["- None"])
  ].join("\n");
}

function assetSourcesMarkdown(packet) {
  const qa = packet.assetQa || {};
  return [
    "# Asset Sources",
    "",
    "## Logos",
    ...((qa.logoCandidates || []).length ? qa.logoCandidates.map(item => `- ${item}`) : ["- Missing or needs review"]),
    "",
    "## Images",
    ...((qa.imageCandidates || []).length ? qa.imageCandidates.map(item => `- ${item}`) : ["- Missing or needs review"]),
    "",
    "## Uploaded Evidence",
    ...((packet.sources?.uploadedFiles || []).length ? packet.sources.uploadedFiles.map(file => `- ${file.name} (${file.role}, ${file.type}, ${file.size} bytes)`) : ["- None"])
  ].join("\n");
}

function visualSystemContractMarkdown(packet) {
  const contract = visualSystemContractForPacket(packet);
  const stack = contract.premiumVisualStack || premiumVisualStackForPacket(packet);
  const creative = contract.creativeDirectorPreflight || stack.creativeDirectorPreflight || buildCreativeDirectorPreflight();
  return [
    `# Visual System Contract - ${packet.business?.businessName || packet.packetName || "Client"}`,
    "",
    "This file is the visual quality gate and wow-factor brief. The WSS build must create a reusable cinematic system, then carry that system through the full site in the same controlled build pass.",
    "",
    "## Status",
    `- Contract status: ${contract.status}`,
    `- Credit policy: ${contract.creditPolicy}`,
    "",
    "## First Response Required",
    ...contract.firstResponseRequired.map(item => `- ${item}`),
    "",
    "## Creative Director / Design Council Preflight",
    `- Status: ${creative.status}`,
    `- Purpose: ${creative.purpose}`,
    ...((creative.requiredOutputs || []).map(item => `- Required: ${item}`)),
    ...((creative.firstPlanMustAnswer || []).map(item => `- First plan answer: ${item}`)),
    "",
    "## Preserve These Template Primitives",
    ...contract.templateFingerprint.preservePrimitives.map(item => `- ${item}`),
    "",
    "## Forbidden Deletes",
    ...contract.templateFingerprint.forbiddenDeletes.map(item => `- ${item}`),
    "",
    "## Hero Enrichment",
    `- Source mode: ${contract.heroEnrichment.sourceMode}`,
    `- Required output: ${contract.heroEnrichment.requiredOutput}`,
    `- Brief: ${contract.heroEnrichment.brief}`,
    ...contract.heroEnrichment.qualityBar.map(item => `- ${item}`),
    "",
    "## Widget Enrichment",
    `- ${contract.widgetEnrichment.directive}`,
    ...contract.widgetEnrichment.requiredSignals.map(item => `- Capture ${item}`),
    "",
    "## Gallery And Proof Enrichment",
    `- ${contract.galleryEnrichment.directive}`,
    `- Minimum when photos expected: ${contract.galleryEnrichment.minimumWhenPhotosExpected}`,
    `- ${contract.galleryEnrichment.duplicatePolicy}`,
    "",
        "## Brand And Local Trust Enrichment",
        ...contract.brandEnrichment.requiredBehavior.map(item => `- ${item}`),
        ...contract.localTrustEnrichment.visualSignals.map(item => `- ${item}`),
        "",
        "## Premium Visual Stack",
        `- Stack status: ${stack.status}`,
        `- Credit policy: ${stack.creditPolicy}`,
        "- Read PREMIUM-VISUAL-STACK.md before planning component sections, hero treatment, page shells, or animations.",
        ...stack.designLanguage.slice(0, 6).map(item => `- ${item}`),
        "",
        "## Enrichment Mandates",
    ...contract.enrichmentMandates.map(item => `- ${item}`),
    "",
    "## Stop Rules",
    ...contract.stopRules.map(item => `- ${item}`),
    "",
    "## Visual QA Gates",
    ...contract.qaGates.map(item => `- ${item}`),
    "",
    "## Missing Items",
    ...(contract.missing.length ? contract.missing.map(item => `- ${item}`) : ["- None"])
      ].join("\n");
    }

function premiumVisualStackMarkdown(packet) {
  const stack = premiumVisualStackForPacket(packet);
  const creative = stack.creativeDirectorPreflight || buildCreativeDirectorPreflight();
  return [
    `# Premium Visual Stack - ${packet.business?.businessName || packet.packetName || "Client"}`,
    "",
    "This file tells the builder what high-end visual system to use before it spends credits. It is not a generic inspiration note.",
    "",
    "## Status",
    `- Stack status: ${stack.status}`,
    `- Credit policy: ${stack.creditPolicy}`,
    "",
    "## Runtime Targets",
    ...stack.runtimeTargets.map(item => `- ${item}`),
    "",
    "## Preferred Stack",
    `- Framework: ${stack.preferredStack.framework}`,
    `- Language: ${stack.preferredStack.language}`,
    `- Styling: ${stack.preferredStack.styling}`,
    `- UI: ${stack.preferredStack.ui.join(", ")}`,
    `- Motion: ${stack.preferredStack.motion}`,
    `- Theme: ${stack.preferredStack.theme}`,
    "",
    "## Design Language",
    ...stack.designLanguage.map(item => `- ${item}`),
    "",
    "## Creative Director / Design Council Preflight",
    `- Status: ${creative.status}`,
    `- Purpose: ${creative.purpose}`,
    ...((creative.requiredOutputs || []).map(item => `- ${item}`)),
    ...((creative.stopRules || []).map(item => `- Stop rule: ${item}`)),
    "",
    "## Reusable Sections",
    ...stack.reusableSections.map(section => `- ${section.name}: ${section.required.join("; ")}`),
    "",
    "## Asset Contract",
    "- Hero: " + stack.assetContract.hero.join("; "),
    "- Brand: " + stack.assetContract.brand.join("; "),
    "- Gallery: " + stack.assetContract.gallery.join("; "),
    ...stack.assetContract.qualityRules.map(item => `- ${item}`),
    "",
    "## Route Expectations",
    `- Pages: ${stack.routeExpectations.pages.length ? stack.routeExpectations.pages.join(", ") : "Needs route plan"}`,
    `- Services: ${stack.routeExpectations.services.length ? stack.routeExpectations.services.join(", ") : "Needs service list"}`,
    `- Rule: ${stack.routeExpectations.rule}`,
    "",
    "## Motion And Interaction Rules",
    ...stack.motionAndInteractionRules.map(item => `- ${item}`),
    "",
    "## Visual Reference Vocabulary",
    ...stack.visualReferenceVocabulary.map(item => `- ${item}`),
    "",
    "## First Plan Must Echo",
    ...stack.firstPlanEcho.map(item => `- ${item}`),
    "",
    "## Missing Items",
    ...(stack.missing.length ? stack.missing.map(item => `- ${item}`) : ["- None"])
  ].join("\n");
}

function heroContractMarkdown(packet) {
  const hero = packet.compiled?.hero || packet.assetQa?.heroContract || {};
  return [
    "# Hero Contract",
    "",
    `Mode: ${hero.variant || packet.brand?.heroSourceMode || "Needs review"}`,
    `Generation required: ${hero.generationRequired ? "Yes" : "No"}`,
    `Generated imagery allowed: ${hero.generatedImageryAllowed || packet.brand?.aiAllowed || "Needs review"}`,
    `Required output: ${hero.requiredOutput || "Needs review"}`,
    "",
    "## Operator Summary",
    hero.operatorSummary || "Needs review",
    "",
    "## Hero Brief",
    hero.brief || "Needs review",
    "",
    "## Blockers",
    ...((hero.blockers || []).length ? hero.blockers.map(item => `- ${item}`) : ["- None"]),
    "",
    "## Hard Rule",
    "- Do not publish a blank color slab. Use the attached hero/gallery/source-pack assets first and preserve the selected template motion treatment."
  ].join("\n");
}

function productionLockMarkdown(packet) {
  const locks = packet.productionLocks || packet.compiled?.productionLocks || packet.readiness?.preflight?.productionLocks || [];
  return [
    "# Production Lock Summary",
    "",
    `Readiness: ${packet.readiness?.score || 0}/100 - ${packet.readiness?.status || "Needs review"}`,
    `Credit gate: ${packet.readiness?.preflight?.status || "not compiled"}`,
    "",
    ...locks.map(check => `- ${check.label || check.key}: ${String(check.status || "review").toUpperCase()} - ${check.detail || ""}${check.status === "pass" ? "" : ` Fix: ${check.fix || ""}`}`)
  ].join("\n");
}

function assetPayloadReadme(packet, uploadPayloads = []) {
  const payloadNames = new Set(uploadPayloads.map(item => item.filename));
  const uploadedFiles = packet.sources?.uploadedFiles || [];
  return [
    "# Client Asset Payloads",
    "",
    "These are the actual client upload paths expected by the build packet. If a source ZIP is present, unpack it before choosing hero, gallery, logo, favicon, and OG assets.",
    "",
    ...(uploadedFiles.length ? uploadedFiles.map(file => {
      const path = file.exportPath || file.name || "unknown";
      const attached = payloadNames.has(path);
      return `- ${file.name || path} -> ${path} (${file.role || "evidence"}, ${file.type || "unknown"}, ${file.size || 0} bytes) - ${attached ? "attached to this email" : "not attached to this email; use admin ZIP/download lane"}`;
    }) : ["- No uploaded binary assets were attached in this browser session."]),
    "",
    "Rules:",
    "- Do not replace client-supplied images with stock or generated imagery unless the intake explicitly allows it.",
    "- If any uploaded asset is not attached, stop and reattach files before spending builder credits."
  ].join("\n");
}

function packetContentQualitySummary(packet = {}) {
  const counts = publicCopyCounts(packet);
  const totalFiles = counts.visitorFiles;
  const totalWords = counts.visitorWords;
  const passCount = counts.passCount;
  const reviewCount = counts.reviewCount;
  return { totalFiles, totalWords, passCount, reviewCount };
}

function compiledPackageScore(packet = {}) {
  const content = packetContentQualitySummary(packet);
  const compileComplete = packet.compiled?.compileJob?.status === "complete";
  if (compileComplete && content.totalFiles >= 6 && content.totalWords >= 3500 && content.passCount >= content.totalFiles) return 100;
  const checks = [
    content.totalFiles >= 6,
    content.totalWords >= 3500,
    Boolean(packet.compiled?.manifest || packet.compiled?.client),
    Boolean(packet.compiled?.brand || packet.compiled?.logoQa),
    Boolean(packet.compiled?.hero || packet.assetQa?.heroContract),
    Boolean(packet.compiled?.forms || packet.review?.recipientEmail),
    Boolean(packet.compiled?.seo || packet.compiled?.searchOptimizationPlan),
    Boolean(packet.compiled?.mapSdkContract || packet.compiled?.localPresencePlan),
    Boolean(packet.compiled?.visualSystemContract || packet.compiled?.templateVarietyContract),
    Boolean(packet.compiled?.routeContentMap?.length || packet.pagePlan?.length)
  ];
  return Math.max(0, Math.round((checks.filter(Boolean).length / checks.length) * 100));
}

function humanProofBuildScore(packet = {}) {
  const compiledScore = compiledPackageScore(packet);
  const reviewItems = packet.readiness?.blockers || [];
  const hardStops = packet.readiness?.preflight?.status === "blocked"
    || (packet.productionLocks || []).some(check => String(check.status || "").toLowerCase() === "block");
  if (hardStops) return Math.min(compiledScore, 74);
  if (compiledScore >= 100 && !reviewItems.length) return 100;
  const requirementGaps = reviewItems.filter(item => /pages needed|must include|requirements/i.test(String(item)));
  let score = compiledScore - Math.min(16, reviewItems.length * 4);
  if (requirementGaps.length) score = Math.min(score, 92);
  return Math.max(0, Math.round(score));
}

function vercelDirectiveLines(packet = {}) {
  const content = packetContentQualitySummary(packet);
  const archive = publicCopyCounts(packet);
  const routeCount = packet.compiled?.routeContentMap?.length || packet.pagePlan?.length || packet.compiled?.pages?.length || 0;
  const rawScore = packet.readiness?.score || 0;
  const compiledScore = compiledPackageScore(packet);
  const buildReadyScore = humanProofBuildScore(packet);
  const reviewItems = packet.readiness?.blockers || [];
  const requirementGaps = reviewItems.filter(item => /pages needed|must include|requirements/i.test(String(item)));
  const brandVisualScore = (packet.compiled?.brand || packet.sources?.palette?.length || packet.assetQa?.logoCandidates?.length) ? 100 : 80;
  const mediaScore = (packet.assetQa?.imageCandidates?.length || packet.sources?.images?.length || packetExternalAssetFolders(packet).length) ? 95 : (packet.compiled?.hero?.generatedImageryAllowed ? 88 : 76);
  const contentStructureScore = content.totalFiles >= 6 && routeCount ? 95 : 82;
  const seoLocalScore = (packet.compiled?.seo || packet.compiled?.mapSdkContract || packet.compiled?.searchOptimizationPlan) ? 100 : 84;
  const requirementsScore = requirementGaps.length ? 80 : 100;
  return [
    "WSS BUILD DIRECTIVES - START HERE",
    "",
    "This is not a thin intake note. Treat the attached/root packet files as the source of truth for the WSS build.",
    "",
    "1. Open the approved WSS project/repo for this client.",
    "2. Upload or attach every file from this email/packet at the root level. Do not pick only the screenshot or handoff.",
    "3. First read, in this order: 00-READ-ME-FIRST.md, 00-CREDIT-SAVER-PREFLIGHT.md, 00-WSS-MASTERPIECE-RULE.md, 01-WSS-BUILD-COMMAND-CENTER.md, PREMIUM-VISUAL-STACK.md, VISUAL-SYSTEM-CONTRACT.md, WSS-BUILD-PLAN-PROMPT.md, WSS-BUILD-PROMPT.md, MAP-SDK-CONTRACT.md, content-route-map.json, and content-content-quality-report.json.",
    "4. Start with WSS-BUILD-PLAN-PROMPT.md. The plan must echo the attached file counts, route/content map, hero/media contract, forms routing, map contract, logo/identity gate, full-site design council, and post-publish QA gates.",
    "5. After the plan is coherent, build from WSS-BUILD-PROMPT.md. Use generated visitor-copy Markdown as the first draft. Files under content/source/ are private research, not publishable copy. Expand only with supported facts and review the final wording.",
    "6. Do not run broad discovery, rewrite services, invent routes, invent claims, preserve old-template content, or fabricate proof. Generated/procedural/stock visuals may support atmosphere, diagrams, icons, glass UI, galleries, and motion unless the ticket explicitly forbids them; never present them as real client work, reviews, credentials, crews, or before/after proof.",
    "7. Stop before spending production credits if any of these are missing: WSS-BUILD-PROMPT.md, PREMIUM-VISUAL-STACK.md, VISUAL-SYSTEM-CONTRACT.md, content-content-quality-report.json, content-route-map.json, client.json, brand.json, hero.json, forms.json, map-sdk-contract.json, assets-manifest.json, or the content-*.md files.",
    "8. Final QA before completion email: WSS URL only, no badge, no old-template residue, client favicon/OG/social preview, working Resend form, Google map/service-area behavior, light default where required, hero not blank and roughly 10% lighter/clearer, gallery uses real client/source assets first.",
    "",
    "READINESS SEPARATION",
    `- Raw intake completeness: ${rawScore}/100 - ${packet.readiness?.status || "Needs review"} before compiler fill-in.`,
    `- Compiled content/asset coverage: ${compiledScore}/100 - ${compiledScore >= 100 ? "Generator coverage complete" : "Generator coverage needs review"}.`,
    `- Human-proof build readiness: ${buildReadyScore}/100 - ${buildReadyScore >= 100 ? "No human decisions left" : buildReadyScore >= 90 ? "Buildable after short Plan-mode confirmation" : "Needs packet review before build"}.`,
    `- Compiler filled delta: +${Math.max(0, buildReadyScore - rawScore)} points through generated content, contracts, SEO, maps, forms, and QA artifacts.`,
    `- Visitor page copy: ${content.totalFiles} files, ${content.totalWords} words, ${content.passCount} passing, ${content.reviewCount} review.`,
    `- Private source archive: ${archive.archiveFiles} files, ${archive.archiveWords} words for research only; never publish raw or count as finished page copy.`,
    `- Route/content map: ${routeCount} route${routeCount === 1 ? "" : "s"}.`,
    `- Six-credit gate: ${packet.readiness?.preflight?.status || packet.compiled?.proofSummary?.status || "not compiled"} - ${packet.readiness?.preflight?.rescueRisk || packet.compiled?.proofSummary?.rescueRisk || "Unknown"} rescue risk.`,
    `- Selected template: ${packet.selectedTemplateName || packet.compiled?.templateReport?.selectedTemplateName || "Needs review"}.`,
    "- Perfect 100 definition: all pages, must-have sections, hero/media choices, assets, map behavior, form routing, and post-publish QA gates are explicit enough that the builder does not need to ask or invent.",
    "- If human-proof build readiness is below 100, resolve the listed review flags in Plan mode before running Build mode.",
    "",
    "BUILD COVERAGE SNAPSHOT",
    `- Brand visuals: ${brandVisualScore}/100 - brand colors, logo candidates/QA, and visual contracts.`,
    `- Images and media: ${mediaScore}/100 - asset manifest, gallery plan, Drive/upload sources, and hero contract.`,
    `- Page/content structure: ${contentStructureScore}/100 - pages, routes, internal links, and generated markdown copy.`,
    `- SEO, schema, maps, and local presence: ${seoLocalScore}/100 - SEO JSON, schema, sitemap, GEO/voice/local plans, and Maps SDK contract.`,
    `- Requirements completeness: ${requirementsScore}/100 - ${requirementGaps.length ? "pages/must-have items still need confirmation" : "no outstanding page/must-have review flags"}.`,
    `- Overall build-ready score: ${buildReadyScore}/100.`,
    "",
    "REVIEW FLAGS CARRIED FROM RAW INTAKE",
    ...(reviewItems.length ? reviewItems.map(item => `- ${item}`) : ["- None"]),
    "",
    "Important: review flags are not build directions by themselves. Use the compiled prompts, JSON contracts, and content files above as the actual production instructions."
  ];
}

function emailText(packet) {
  return [
    "Hi,",
    "",
    `The client intake packet is ready for ${packet.business?.businessName || "the client"}.`,
    "",
    ...vercelDirectiveLines(packet),
    "",
    "ADMIN SUMMARY",
    `Hours source: ${packet.business?.hoursSource || "Needs review"}`,
    `Google Business / Place ID: ${packet.business?.gbpPlaceId || "Needs review"}`,
    `Template: ${packet.selectedTemplateName || "Needs review"}`,
    "",
    "Compiled includes custom information, image assets, brand assets, logo/icon assets, slugs, SEO content, internal linking, schema hints, sitemap hints, form routing, map data, social preview, and the 110-point readiness checklist.",
    "",
    "Thanks,",
    "Woodward Software Systems"
  ].join("\n");
}

function emailHtml(packet, text) {
  const palette = packet.sources?.palette || [];
  const swatches = palette.length
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">${palette.map(item => `<div style="border:1px solid #dce3ef;border-radius:8px;overflow:hidden;min-width:120px"><div style="height:34px;background:${escapeHtml(item.hex)}"></div><div style="padding:8px;font:12px Arial;color:#475569"><strong style="display:block;color:#10213f">${escapeHtml(item.hex)}</strong>${escapeHtml(item.rgb || "")}<br>${escapeHtml(item.cmyk || "")}</div></div>`).join("")}</div>`
    : "";
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#10213f;background:#f6f8fc;margin:0;padding:24px">
    <main style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #dce3ef;border-radius:10px;padding:22px">
      <h1 style="margin:0 0 8px;font-size:24px">${escapeHtml(packet.packetName || "Client Intake Packet")}</h1>
      <p style="margin:0 0 16px;color:#475569">WSS run sheet plus root-level build packet attached. Start with the directives below before opening any individual asset.</p>
      <pre style="white-space:pre-wrap;font:14px/1.5 Arial,sans-serif;background:#f8fbff;border:1px solid #dce3ef;border-radius:8px;padding:14px">${escapeHtml(text)}</pre>
      ${swatches}
    </main>
  </body></html>`;
}

function packetMarkdown(packet) {
  return [
    `# ${packet.packetName || "Client Intake Packet"}`,
    "",
    `Created: ${packet.createdAt || new Date().toISOString()}`,
    `Readiness: ${packet.readiness?.score || 0}/100 - ${packet.readiness?.status || "Needs review"}`,
    "",
    "## Review Items",
    ...((packet.readiness?.blockers || []).length ? packet.readiness.blockers.map(item => `- ${item}`) : ["- None"]),
    "",
    "## Business Details",
    ...objectLines(packet.business || {}),
    "",
    "## Brand Assets",
    ...objectLines(packet.brand || {}),
    "",
    "## Visual Brand Check",
    ...((packet.sources?.logos || []).length ? packet.sources.logos.slice(0, 5).map(url => `- Logo candidate: ${typeof url === "string" ? url : url.url}`) : ["- Logo candidate: needs review"]),
    ...((packet.sources?.palette || []).length ? packet.sources.palette.map(item => `- ${item.hex}: ${item.rgb || ""}; ${item.cmyk || ""}`) : ["- Color swatches: needs review"]),
    "",
    "## Build Requirements",
    ...objectLines(packet.requirements || {}),
    "",
    "## Sources",
    ...((packet.sources?.urls || []).length ? packet.sources.urls.map(url => `- ${url}`) : ["- No imported source URL"]),
    "",
    "## Meeting Notes",
    packet.sources?.meetingNotes || "- No meeting notes pasted into the form.",
    "",
    "## Final Notes",
    packet.review?.finalNotes || ""
  ].join("\n");
}

function remixPromptRoute(lane) {
  if (/visual|qa|fix/i.test(lane)) return "Follow-up fix lane: use Visual edits for visible copy/layout/image/color/spacing; use Build mode only for source, forms, routing, schema, pages, or data changes.";
  if (/premier|multi/i.test(lane)) return "Prompt B plus Prompt D pattern: premier 5-8 page authority build, Plan mode first, then one production build pass.";
  return "Prompt A plus Prompt C pattern: one-page cinematic scroll, compact source extraction, one production build pass.";
}

function buildSinglePassReskinSpec(packet = {}) {
  const business = packet.business || {};
  const brand = packet.brand || {};
  const brandFonts = brandFontsForPacket(packet);
  const requirements = packet.requirements || {};
  const sources = packet.sources || {};
  const uploadedFiles = sources.uploadedFiles || packet.assetQa?.uploadedAssetFiles || [];
  const imageCandidates = packet.assetQa?.imageCandidates || [];
  const photoUploads = uploadedFiles.filter(file => /\.(jpe?g|png|webp|avif)$/i.test(String(file.name || file.filename || file)));
  const photosCount = Math.max(photoUploads.length, imageCandidates.length);
  const paletteCount = Array.isArray(sources.palette) ? sources.palette.length : splitLinesLocal(brand.brandColors).filter(Boolean).length;
  const pageCount = Array.isArray(packet.pagePlan) ? packet.pagePlan.length : 0;
  const checks = [
    ["Logo SVG + PNG light/dark", Boolean(brand.logoLink || packet.compiled?.brand?.logoSource || packet.assetQa?.logoCandidates?.length)],
    ["Favicon source >=512px", Boolean(brand.faviconSource || brand.faviconLink || sources.faviconSource || packet.compiled?.socialPreviewPlan?.faviconRequired || packet.compiled?.logoQa?.requiredOutputs?.length)],
    ["6 brand hex values", paletteCount >= 6],
    ["Heading + body font names", Boolean(brandFonts.display && brandFonts.body)],
    ["8-12 real photos named by use", photosCount >= 8],
    ["Hero image or hero loop video", Boolean(packet.compiled?.hero?.source || brand.heroSourceMode || packet.assetQa?.heroContract?.sourcePriority?.length)],
    ["Tagline + 2-sentence description", Boolean(business.tagline && business.description)],
    ["Per-page H1, intro, bullets, FAQs", pageCount > 0 && Boolean(packet.compiled?.contentQuality?.totalFiles || requirements.pagesNeeded)],
    ["Trust-signal numbers for CountUps", Boolean(requirements.trustSignals || business.reviewCount || business.rating || business.yearsInBusiness)],
    ["Final nav keep/add/delete list", Boolean(requirements.pagesNeeded || requirements.routeMap || pageCount)],
    ["Contact block", Boolean(business.phone && business.email && (business.address || business.serviceArea))],
    ["Service-area town list", Boolean(business.serviceArea || requirements.serviceAreaTowns)],
    ["Connectors needed", Boolean(requirements.connectorsNeeded || requirements.formsRouting || requirements.mapMode)],
    ["Production domain + schema.org type", Boolean((business.domainUrl || requirements.productionDomain) && (requirements.schemaType || business.schemaType))]
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

function buildSinglePassReskinPacketMarkdown(packet = {}) {
  const spec = buildSinglePassReskinSpec(packet);
  const business = packet.business || {};
  const brand = packet.brand || {};
  const brandFonts = brandFontsForPacket(packet);
  const requirements = packet.requirements || {};
  const services = packet.goldenArtifacts?.exactServices || [];
  const photoCount = Math.max((packet.sources?.uploadedFiles || []).length, (packet.assetQa?.imageCandidates || []).length);
  return [
    `# Single-Pass Reskin Packet - ${business.businessName || packet.packetName || "Client"}`,
    "",
    `Status: ${spec.status}`,
    `Target credits: ${spec.targetCredits}`,
    "",
    "## One-Prompt Template",
    `Reskin this remix for ${business.businessName || "<COMPANY LEGAL NAME>"} (${business.dba || business.businessName || "<doing-business-as>"}), a ${business.industry || requirements.industry || "<industry / trade>"} based in ${business.cityState || business.address || "<city, state>"} serving ${business.serviceArea || "<service area + radius>"}. Keep 100% of the remix's motion system, layout, components, animations, hero treatment, top utility bar, marquee, cursor-light, count-ups, scroll reveals, sticky CTA, and section rhythm - change only brand identity, copy, imagery, routes, and palette. Do NOT delete CursorLight, Marquee, CountUp, SchematicOverlay, TopBar, Hero motion, or any src/components/site/* primitive. Use the asset pack and brand spec below verbatim - do not scrape, do not invent, do not substitute generic stock imagery.`,
    "",
    "## Source Policy",
    spec.sourcePolicy,
    "",
    "## Brand",
    `- Logo: ${brand.logoLink || packet.compiled?.brand?.logoSource || "MISSING - SVG preferred plus PNG @2x light/dark"}`,
    `- Favicon/apple-touch source: ${packet.compiled?.socialPreviewPlan?.faviconSource || "MISSING - >=512px square"}`,
    `- Brand palette: ${(packet.sources?.palette || []).map(item => `${item.hex} ${item.rgb || ""}`).join("; ") || brand.brandColors || "MISSING - exact hex primary, secondary, accent, neutral dark, neutral light, background"}`,
    `- Typography: ${brandFonts.display && brandFonts.body ? `${brandFonts.display} display; ${brandFonts.body} body${brandFonts.href ? `; ${brandFonts.href}` : ""}` : "MISSING - display font, body font, weights, Google Fonts URL/files"}`,
    `- OG/share image: ${packet.compiled?.socialPreviewPlan?.ogSource || "MISSING - 1200x630 or hero photo crop source"}`,
    "",
    "## Imagery",
    `- Real project/photo count detected: ${photoCount}`,
    `- Hero treatment: ${packet.compiled?.hero?.variant || brand.heroSourceMode || "MISSING - horizontal hero image >=1920w or <=4MB muted h264 loop"}`,
    "- Required naming: hero.jpg, gallery-01..08.jpg, service-[service].jpg, logo-light, logo-dark, favicon-source.",
    "",
    "## Copy",
    `- Tagline: ${business.tagline || "MISSING - <=80 chars"}`,
    `- Description: ${business.description || "MISSING - two sentence company description"}`,
    `- Services/pages: ${services.length ? services.join("; ") : requirements.pagesNeeded || "MISSING - per-page H1, intro, bullets, FAQ pairs"}`,
    `- About/trust: ${requirements.trustSignals || "MISSING - founder/story, years, licenses, certifications, rating, review count, jobs completed"}`,
    `- Contact: ${[business.address, business.phone, business.email, business.hours].filter(Boolean).join(" | ") || "MISSING - address, phone, email, hours"}`,
    `- Service areas: ${business.serviceArea || requirements.serviceAreaTowns || "MISSING - flat town list"}`,
    "",
    "## Information Architecture",
    `- Final nav: ${requirements.pagesNeeded || (packet.pagePlan || []).map(page => page.title).join(" | ") || "MISSING - Home | Service A | Service B | About | Contact"}`,
    `- Route map keep/add/delete: ${requirements.routeMap || "MISSING - 1:1 remix route -> new route slug map plus delete list"}`,
    `- Remove from remix: ${requirements.mustAvoid || "MISSING - old pages, sections, or components to remove"}`,
    "",
    "## Integrations",
    `- Connectors: ${requirements.connectorsNeeded || "MISSING - Resend, Google Maps, etc."}`,
    `- Google Maps embed: ${requirements.mapMode || business.address || "MISSING - exact address string plus lat/lng if available"}`,
    `- Form recipient: ${requirements.formsRouting || business.email || "MISSING - recipient email"}`,
    "",
    "## Domain And SEO",
    `- Production domain: ${business.domainUrl || requirements.productionDomain || "MISSING - canonical/sitemap/schema domain"}`,
    `- Schema.org type: ${requirements.schemaType || business.schemaType || "MISSING - LocalBusiness subtype"}`,
    `- Primary target: ${requirements.primaryKeyword || business.primaryKeyword || packet.compiled?.searchOptimizationPlan?.primaryKeyword || "Needs review"}`,
    "",
    "## Checklist",
    ...spec.requiredChecklist.map(item => `- [${item.status === "present" ? "x" : " "}] ${item.label}`),
    "",
    "## Missing Before 1-2 Credit Build",
    ...(spec.missing.length ? spec.missing.map(item => `- ${item}`) : ["- None. Ready for deterministic single-pass reskin."])
  ].join("\n");
}

function buildPacketDeltaFixSpec(packet = {}) {
  const pagePlan = Array.isArray(packet.pagePlan) && packet.pagePlan.length
    ? packet.pagePlan
    : (Array.isArray(packet.compiled?.pages) ? packet.compiled.pages : []);
  const exactServices = packet.goldenArtifacts?.exactServices || (Array.isArray(packet.compiled?.services)
    ? packet.compiled.services.map(service => service.name || service.title || service.slug).filter(Boolean)
    : []);
  return {
    version: "packet-delta-fix-v1",
    mode: "post-build surgical correction",
    sourceOfTruth: "compiled packet attachments are authoritative; public/client site is secondary only when the packet lacks a fact",
    creditGuard: "do not replay the full build prompt, do not rerun Bright Data/Firecrawl when packet artifacts exist, and do not add new motion/video/assets/dependencies unless approved",
    pagePlanCount: pagePlan.length,
    exactServices,
    auditCategories: [
      "routes/nav/sitemap/footer",
      "business constants",
      "services and service areas",
      "contact form/routing",
      "CTAs and maps",
      "schema",
      "H1/title/meta",
      "content honesty",
      "social preview/favicon/manifest",
      "old-template residue"
    ],
    finalResidueProbe: "D-Lux|Pools|Septic|Citronelle|Mobile County|dluxpoolsseptic|lorem|placeholder|alex@woodward"
  };
}

function buildPacketDeltaFixPromptMarkdown(packet = {}) {
  const business = packet.business || {};
  const requirements = packet.requirements || {};
  const compiled = packet.compiled || {};
  const pagePlan = Array.isArray(packet.pagePlan) && packet.pagePlan.length
    ? packet.pagePlan
    : (Array.isArray(compiled.pages) ? compiled.pages : []);
  const exactServices = packet.goldenArtifacts?.exactServices || (Array.isArray(compiled.services) ? compiled.services.map(service => service.name || service.title || service.slug).filter(Boolean) : []);
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const localPlan = localPresencePlanForPacket(packet);
  const formTarget = requirements.formsRouting || compiled.forms?.leadTo || business.email || "Needs review";
  const directions = localPlan.mapAndDirections || {};
  const requiredCtas = localPlan.ctaMigration?.requiredCtas || [];
  const schemaTypes = compiled.seo?.schemaTypes || requirements.schemaTypes || "LocalBusiness, Organization, WebSite, Service, FAQPage, BreadcrumbList";
  return [
    `# Packet Authority Delta Fix Prompt - ${business.businessName || packet.packetName || "Client"}`,
    "",
    "Use this only after a remix/reskin has landed and the operator has approved a correction plan. This is a surgical packet-vs-site pass, not a new build and not a redesign.",
    "",
    "## Source Of Truth",
    "- Treat the intake compilation packet as authoritative: snapshot.json, manifest.json, client.json, brand.json, search-optimization-plan.json, local-presence-plan.json, pages.json, services.json, forms.json, seo.json, and golden-artifacts.json.",
    "- Treat the current public/client website as secondary source material only when the packet explicitly lacks a fact.",
    "- Do not add new features, services, claims, pages, copy, photos, social profiles, GBP details, Place IDs, geo coordinates, review counts, licenses, warranties, financing, emergency promises, or schema fields outside the packet.",
    "- Do not run Bright Data, Firecrawl, broad search, asset generation, video generation, or new dependency installs when the packet already contains the needed audit/source artifacts.",
    "",
    "## Approved Change Budget",
    "- Expected footprint: small text, JSX, route, schema, sitemap, form, CTA, and JSON/data edits in the known repo.",
    "- No new motion/video work unless the operator explicitly asks for it.",
    "- No full prompt replay. Compare the live implementation to the packet and change only mismatches.",
    "",
    "## Packet Targets",
    `- Business: ${business.businessName || "Needs review"}`,
    `- Canonical domain: ${business.domainUrl || requirements.productionDomain || compiled.seo?.baseUrl || "Needs review"}`,
    `- Page plan: ${pagePlan.length ? pagePlan.map(page => `${page.title || page.name || "Page"} (${page.slug || page.path || "/"})`).join("; ") : requirements.pagesNeeded || "Needs review"}`,
    `- Exact services: ${exactServices.length ? exactServices.join("; ") : "Needs review"}`,
    `- Primary search target: ${searchPlan.primaryKeyword || requirements.primaryKeyword || "Needs review"}`,
    `- Form routing: ${formTarget}`,
    `- Google directions: ${directions.googleDirectionsUrl || "Needs review"}`,
    `- Apple Maps directions: ${directions.appleMapsUrl || "Needs review"}`,
    `- Required CTAs: ${requiredCtas.length ? requiredCtas.map(cta => cta.label || cta.type || cta.url).join("; ") : "Use local-presence-plan.json"}`,
    `- Schema types: ${Array.isArray(schemaTypes) ? schemaTypes.join("; ") : schemaTypes}`,
    "",
    "## Delta Audit Checklist",
    "1. Route/nav/sitemap/footer: match pages.json. Add packet pages that are missing. Remove invented routes/services from nav, footer, sitemap, business constants, schema, and internal links. Extra utility pages may stay only when harmless and de-emphasized outside the primary nav.",
    "2. Business constants: client.json and brand.json win. Remove or mark unconfirmed any invented hours, postal code, geo, founded date, years, reviews, licenses, warranties, insurance, financing, emergency language, commercial claims, or service areas not in the packet.",
    "3. Services and service areas: exactServices and packet service areas win. Do not preserve template services just because routes/components exist.",
    "4. Contact and lead funnel: formsRouting wins. Verify to/from/BCC behavior, Resend fallback notes, service dropdown values, property location fields, timing, message/photo notes, hidden source page, success state, and fallback mailto.",
    "5. CTAs and maps: implement only packet-required CTAs such as Call, Text, Email, Google Directions, Apple Maps, review, finance/payment/gallery/current inventory when source-backed. Verify map embed policy and remove old-template map strings.",
    "6. Schema: schema must match seo.json and local-presence-plan.json. Use source-backed sameAs only. Omit priceRange, openingHours, geo, Place ID, or review AggregateRating unless the packet confirms them.",
    "7. H1/title/meta: each route must naturally include its assigned search-optimization-plan.json page target. Edit only where missing, duplicated, or shoehorned.",
    "8. Content honesty grep: remove or soften unsupported claims matching licensed|insured|bonded|warranty|guarantee|financing|APR|24/7|emergency|reviews|stars|years experience|commercial.",
    "9. Robots/sitemap/social preview/favicon/manifest: match packet domain, route plan, May/client identity, and no preview or old-template residue.",
    "10. Header/logo contrast: verify light/dark header/logo behavior and CTA contrast without changing the approved motion system.",
    "",
    "## Execution Order",
    "1. Fix business constants and exact service/service-area data first.",
    "2. Add missing packet routes and remove invented routes/services.",
    "3. Fix nav, footer, sitemap, internal links, canonical URLs, and schema.",
    "4. Fix contact route/API/form fields/routing and CTA/map behavior.",
    "5. Sweep H1/title/meta against pageTargets.",
    "6. Run honesty and residue grep, then make only source-backed corrections.",
    "",
    "## Final Grep Gate",
    "- Old template/client terms from the sanitation contract must return 0 hits in visible copy, metadata, schema, sitemap, forms, and constants.",
    "- Default residue probes when a prior template is unknown: D-Lux|Pools|Septic|Citronelle|Mobile County|dluxpoolsseptic|lorem|placeholder|alex@woodward.",
    "- Do not publish until no packet contradiction remains and no old-template business identity remains."
  ].join("\n");
}

function remixContractForPacket(packet = {}) {
  const existing = packet.remix || packet.compiled?.remix;
  if (existing) return existing;
  const requirements = packet.requirements || {};
  const sources = packet.sources || {};
  const driveFolders = unique([
    sources.googleDriveUrl,
    ...packetExternalAssetFolders(packet)
  ]).filter(url => /drive\.google/i.test(String(url)));
  const lane = /multi|premier|authority/i.test(`${packet.selectedBuildLane || ""} ${packet.templateFamily || ""} ${requirements.siteType || ""}`)
    ? "Premier multi-page remix"
    : "Single-page scroll remix";
  return {
    version: "remix-v1",
    status: "review",
    missing: [],
    lane,
    mode: requirements.lovableMode || "Plan first, then build",
    planModeRequired: true,
    promptRoute: remixPromptRoute(lane),
    sourcePointers: {
      gmailUrl: sources.gmailUrl || "",
      publicWebsiteUrl: (sources.urls || [])[0] || packet.business?.domainUrl || "",
      googleBusinessUrl: packet.business?.gbpLink || "",
      socialUrl: (sources.urls || []).find(url => /linktr\.ee|facebook|instagram|tiktok|youtube|x\.com|twitter|yelp/i.test(String(url))) || "",
      driveFolders,
      sourceUrls: sources.urls || []
    },
    template: {
      localTemplateId: packet.selectedTemplateId || "",
      localTemplateName: packet.selectedTemplateName || "",
      localTemplateFamily: packet.templateFamily || "",
      remixTemplateUrl: requirements.remixTemplateUrl || "",
      remixTemplateName: requirements.remixTemplateName || packet.selectedTemplateName || "",
      preserveTemplateStrengths: [
        "overall visual polish, responsive layout rhythm, cinematic motion quality, strong hero/gallery treatments, side-by-side section grammar, and working component structure",
        "lead/widget architecture, calculators/estimators/question funnels, count-ups, cursor-light/marquee/overlay utilities, animation primitives, and map/form wiring should be re-skinned for the new industry instead of deleted",
        "do not preserve the old client's copy, identity, NAP, imagery, schema, forms recipients, social preview, sitemap, metadata, domain strings, or hidden constants"
      ]
    },
    singlePassReskin: buildSinglePassReskinSpec(packet),
    packetDeltaFix: buildPacketDeltaFixSpec(packet),
    sanitationChecklist: [
      "Remove all previous client copy, names, NAP, logos, images, metadata, schema, forms, maps, reviews, slugs, sitemap, canonical URLs, social preview, favicon, and hidden constants.",
      "Regenerate all public identity and SEO files from this packet.",
      "Sanitize content and data, not the reusable template fingerprint. Preserve and re-skin cinematic motion primitives, section structure, widget architecture, gallery behavior, count-ups, cursor/marquee/overlay effects, map/form wiring, and responsive layout rhythm."
    ],
    optimizationChecklist: [
      "Read GEO-VOICE-LOCAL-SEARCH-PLAN.md, search-optimization-plan.json, LOCAL-PRESENCE-CONVERSION-PLAN.md, and local-presence-plan.json before planning or building.",
      "Fingerprint the remix template before editing: document the reusable hero archetype, motion system, section order, side-by-side blocks, widget/lead funnel, gallery treatment, counters, cursor/marquee/overlay effects, and map/form placements. Re-skin those primitives for the new client instead of replacing them with a generic from-scratch layout.",
      "If 00-SINGLE-PASS-RESKIN-PACKET.md is complete, do not scrape, invent, or substitute generic stock imagery. Use the attached/uploaded asset pack and brand spec verbatim, then build the reskin in one deterministic pass.",
      "If the single-pass asset pack is incomplete, stop in Plan mode with the exact missing checklist before build credits are spent. Use Firecrawl/source scrape only as an explicit fallback for missing or contradictory facts, not as the default first pass.",
      "Build Apple Maps, Google Maps/directions, map embed policy, source-backed social links, finance/payment/gallery CTAs, internal links, schema, and light/dark header/logo behavior in the first production pass.",
      "Use clean slugs, canonical URLs, sitemap hints, schema, OG image, favicon, form routing, exact service names, and mobile QA.",
      "Run a source-to-site migration sweep: inspect the current website, location pages, Google Business source, Linktree/social URLs, and Drive assets; migrate every source-supported social link, finance/take-home CTA, hours/location fact, review proof, and gallery/product asset without inventing terms.",
      "Use attached Bright Data SERP audit/query-plan artifacts first; run another SERP/competitor crawl only when those artifacts are missing, blocked, or not_configured.",
      "Keep Bright Data credentials server-side only. Never paste API keys, proxy credentials, or native proxy strings into prompts, public code, packet files, or screenshots.",
      "Use the 110-point readiness checklist as a launch gate, but let source facts plus SERP/competitor evidence drive the actual optimization strategy.",
      "If Gmail, Drive, Maps, or Resend are not linked yet, trigger the connector picker in this exact order: Gmail -> Google Drive -> Maps -> Resend. Trigger Firecrawl only when the single-pass asset pack is incomplete, contradictory, or operator-approved for fallback/source verification."
    ],
    operatorNotes: requirements.remixOperatorNotes || "",
    assetAccessMode: driveFolders.length ? "Use connected Google Drive first." : "Use uploaded/direct assets and packet permissions."
  };
}

function buildRemixPlanPromptMarkdown(packet) {
  const remix = remixContractForPacket(packet);
  const singlePass = remix.singlePassReskin || buildSinglePassReskinSpec(packet);
  const business = packet.business || {};
  const requirements = packet.requirements || {};
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const localPlan = localPresencePlanForPacket(packet);
  const content = packet.compiled?.contentQuality || {};
  const routeMap = contentRouteMapForPacket(packet);
  const visual = visualSystemContractForPacket(packet);
  const creative = visual.creativeDirectorPreflight || visual.premiumVisualStack?.creativeDirectorPreflight || buildCreativeDirectorPreflight();
  return [
    `# WSS Original Build Plan Prompt - ${business.businessName || packet.packetName || "Client"}`,
    "",
    "Use this as the concise prebuild plan. Build an original WSS/compiler site unless the operator explicitly selects a legacy remix/reference template.",
    "",
    "## Credit Saver Preflight",
    "- Read 00-CREDIT-SAVER-PREFLIGHT.md, content-content-quality-report.json, and content-route-map.json before any plan work.",
    `- Expected visitor copy proof: ${publicCopyCounts(packet).visitorFiles} files, ${publicCopyCounts(packet).visitorWords} words. Private source archive: ${publicCopyCounts(packet).archiveFiles} files, ${publicCopyCounts(packet).archiveWords} words for research only.`,
    `- Expected route/content mappings: ${routeMap.length}.`,
    "- If your visible packet count differs from those numbers, stop and ask for Gmail/Drive attachment access. Do not build from a smaller/partial packet.",
    "",
    "## Visual System Preflight",
    "- Read PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md before proposing the plan.",
    `- Visual contract status: ${visual.status}.`,
    `- Preserve primitives: ${visual.templateFingerprint.preservePrimitives.slice(0, 8).join("; ")}.`,
    "- Your plan must describe the target stack/component approach, improved hero treatment, custom widget transformation, gallery/proof treatment, motion polish, brand contrast, and mobile visual QA.",
    "- Your plan must also pass the creative director/design council preflight: full-scroll visual arc, section-by-section treatment, component/ingredient selection, content-depth mapping, signature motif, motion grammar, footer polish, and no flat scaffold after the hero.",
    ...((creative.stopRules || []).slice(0, 2).map(item => `- ${item}`)),
    "- If your plan replaces the bespoke visual system with a generic layout, flat cards, fake glass, weak buttons, or dead whitespace, stop before build credits.",
    "",
    "## Source URLs",
    `- Woodward Gmail intake URL: ${remix.sourcePointers.gmailUrl || "Not provided - use packet notes/source files"}`,
    `- Google Drive asset folder(s): ${remix.sourcePointers.driveFolders.length ? remix.sourcePointers.driveFolders.join("; ") : "None provided"}`,
    `- Public website/source URL: ${remix.sourcePointers.publicWebsiteUrl || business.domainUrl || "Not provided"}`,
    `- Google Business/source map: ${remix.sourcePointers.googleBusinessUrl || business.gbpPlaceId || "Needs review"}`,
    `- Reference/template URL: ${remix.template.remixTemplateUrl || "Optional; use ingredients/source/reference only when provided"}`,
    "",
    "## Planning Job",
    `- Lane: ${remix.lane}`,
    `- Mode: ${remix.mode}`,
    `- Routing pattern: ${remix.promptRoute}`,
    `- Business: ${business.businessName || "Needs review"}`,
    `- Service area: ${business.serviceArea || "Needs review"}`,
    `- Required pages/sections: ${requirements.pagesNeeded || (packet.pagePlan || []).map(page => page.title).join(", ") || "Needs review"}`,
    `- Generated marketing plan: ${requirements.marketingPlan || "Use source facts plus SERP/competitor evidence to create the plan before building."}`,
    `- Search plan file: GEO-VOICE-LOCAL-SEARCH-PLAN.md`,
    `- Primary search target: ${searchPlan.primaryKeyword || "Needs review"}`,
    `- Local presence file: LOCAL-PRESENCE-CONVERSION-PLAN.md`,
    `- Required conversion/social/map CTA count: ${(localPlan.ctaMigration?.requiredCtas || []).length}`,
    "",
    "## Bright Data / Search Audit Requirement",
    "- Use attached BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, and brightdata-query-plan.json before planning or building.",
    "- Do not run another broad competitor crawl unless the Bright Data artifacts are missing, blocked, or status not_configured.",
    "- If Bright Data artifacts are unavailable, state that in the plan and use Firecrawl/search plus official source URLs as the fallback.",
    "- Keep Bright Data credentials server-side only. Never paste API keys, proxy credentials, or native proxy strings into prompts, public code, packet files, or screenshots.",
    "- Use Bright Data findings to refine page titles, H1/H2s, service coverage, FAQs, schema, internal links, local entity signals, and CTAs.",
    "- Do not copy competitor text and do not invent unsupported claims.",
    "",
    "## Plan Requirements",
    "- Read the Gmail thread, Google Drive folder, Maps source, and Resend routing plan through connected accounts when available. Read Firecrawl/source scrape results only when the single-pass asset pack is incomplete, contradictory, or approved for fallback verification.",
    "- If connector access needs linking, trigger Gmail -> Google Drive -> Maps -> Resend first. Trigger Firecrawl only when 00-SINGLE-PASS-RESKIN-PACKET.md is incomplete, contradictory, or the operator approves fallback/source verification. After each picker event, verify read success on the supplied source URLs before continuing.",
    "- Fingerprint any reference/template before editing: list old business identity, metadata, routes, schema, forms, images, map data, and any hidden constants that must be removed.",
    "- Also fingerprint reusable strengths before editing: hero archetype, motion system, side-by-side section grammar, widget/lead funnel, gallery treatment, counters, cursor/marquee/overlay effects, and map/form placements to adapt into an original WSS build.",
    "- Convert that fingerprint into a visual upgrade plan using PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md: preserve the reusable primitives, then improve hero impact, page visual headers, widget specificity, gallery proof, microinteractions, local trust, and mobile polish.",
    "- Produce a replacement map from this packet for identity, pages, services, images, forms, SEO, social preview, schema, sitemap hints, and canonical URLs.",
    "- Produce a local presence/conversion map: Apple Maps, Google Maps, directions, map embed policy, GBP/Place ID, social sameAs links, finance/payment/gallery CTAs, internal links, light/dark header/logo variants, and schema fields.",
    "- Read MAP-SDK-CONTRACT.md, map-sdk-contract.json, and src-lib-business.ts before planning the map. Use the custom Maps connector, not the managed connector.",
    "- Identify any blocker that requires Ricardo/client input before build credits are spent.",
    "- Do not ask for broad choices if the packet already gives the answer. Make a seasoned production decision and proceed after the plan is coherent.",
    "",
    "## Sanitization Rules",
    ...remix.sanitationChecklist.map(item => `- ${item}`),
    "",
    "## Optimization Gates",
    ...remix.optimizationChecklist.map(item => `- ${item}`),
    ...searchOptimizationSummaryLines(packet),
    "",
    "## Operator Notes",
    remix.operatorNotes || "- None"
  ].join("\n");
}

function buildRemixBuildPromptMarkdown(packet) {
  const remix = remixContractForPacket(packet);
  const singlePass = remix.singlePassReskin || buildSinglePassReskinSpec(packet);
  const business = packet.business || {};
  const brand = packet.brand || {};
  const requirements = packet.requirements || {};
  const hero = packet.compiled?.hero || packet.assetQa?.heroContract || {};
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const localPlan = localPresencePlanForPacket(packet);
  const mapContract = mapSdkContractForPacket(packet);
  const content = packet.compiled?.contentQuality || {};
  const routeMap = contentRouteMapForPacket(packet);
  const visual = visualSystemContractForPacket(packet);
  const creative = visual.creativeDirectorPreflight || visual.premiumVisualStack?.creativeDirectorPreflight || buildCreativeDirectorPreflight();
  return [
    `# WSS Original Build Prompt - ${business.businessName || packet.packetName || "Client"}`,
    "",
    "Proceed with the approved plan and complete this WSS/compiler build in one careful production pass. Use the connected Gmail and Google Drive access when the URLs below are present.",
    "",
    "## Credit Saver Build Gate",
    "- Before editing, confirm 00-CREDIT-SAVER-PREFLIGHT.md, content-content-quality-report.json, and content-route-map.json are readable.",
    `- Required visitor copy proof: ${publicCopyCounts(packet).visitorFiles} files and ${publicCopyCounts(packet).visitorWords} words. Private source archive: ${publicCopyCounts(packet).archiveFiles} files, ${publicCopyCounts(packet).archiveWords} words for research only.`,
    `- Required mapped routes: ${routeMap.length}.`,
    "- If those counts do not match, stop. Do not spend build credits on a partial packet.",
    "",
    "## Visual Build Gate",
    "- Before editing, confirm PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md are readable.",
    `- Visual contract status: ${visual.status}.`,
    `- Required visual QA gates: ${visual.qaGates.length}.`,
    `- Creative director/design council preflight: ${creative.status}; ${(creative.requiredOutputs || []).length} required outputs.`,
    "- Apply the premium component stack across the full site: hero, page visual headers, widget, gallery/proof, motion polish, brand contrast, local trust, content depth, and footer in this same build pass.",
    "- Before editing, restate the full-scroll visual arc, section-by-section treatment, component/ingredient choices, content-depth mapping, signature motif, motion grammar, footer polish, and no-flat-scaffold-after-hero plan.",
    "- Stop if the approved plan would ship a blank/generic first viewport, weak buttons, opaque fake glass, default cards, a dead gallery, or an unfinished footer.",
    "",
    "## Connector Instructions",
    `- Gmail: ${remix.sourcePointers.gmailUrl || "No Gmail URL supplied; use packet notes/source files."}`,
    `- Google Drive: ${remix.sourcePointers.driveFolders.length ? remix.sourcePointers.driveFolders.join("; ") : "No Drive folder supplied; use attached/direct assets."}`,
    `- Single-pass status: ${singlePass.status}. ${singlePass.sourcePolicy}`,
    "- Firecrawl: use only for source verification or explicit fallback discovery when the single-pass asset pack is incomplete, contradictory, or operator-approved for missing facts. Do not use Firecrawl to replace a complete attached asset pack.",
    `- Maps: link and verify the custom Maps connector before map embeds or directions are considered complete. Use ${MAP_SDK_CONNECTOR_ENV}, mapId ${MAP_SDK_MAP_ID}, and MAP-SDK-CONTRACT.md.`,
    "- Resend: link and verify the selected Resend connector before lead routing is considered complete.",
    "- If a needed connector is available but not linked to this project, trigger Gmail -> Google Drive -> Maps -> Resend first. Trigger Firecrawl only when the single-pass asset pack is incomplete, contradictory, or operator-approved for fallback/source verification. Ask the operator to approve the existing Woodward connection and continue only after read/send capability is verified.",
    `- Asset rule: ${remix.assetAccessMode}`,
    "",
    "## Hard Reset The Template",
    ...remix.sanitationChecklist.map(item => `- ${item}`),
    "",
    "## Build Target",
    `- Lane: ${remix.lane}`,
    `- Reference/template family: ${remix.template.remixTemplateName || remix.template.localTemplateName || "Optional WSS/ingredients/source reference"}`,
    `- Reference/template URL: ${remix.template.remixTemplateUrl || "Not required for WSS original build"}`,
    `- Business name: ${business.businessName || ""}`,
    `- Phone: ${business.phone || ""}`,
    `- SMS: ${business.smsNumber || ""}`,
    `- Email: ${business.email || ""}`,
    `- Service area: ${business.serviceArea || ""}`,
    `- Map SDK status: ${mapContract.status}; geo verified: ${mapContract.geo?.verified ? "yes" : "no"}; service radius: ${mapContract.serviceRadiusMiles || "Needs review"} miles`,
    `- Hours: ${business.hours || "Needs review"}`,
    `- Main CTA: ${business.mainCta || ""}`,
    "",
    "## Protected Services And Facts",
    ...((packet.goldenArtifacts?.exactServices || []).length ? packet.goldenArtifacts.exactServices.map(item => `- Visible exact service: ${item}`) : ["- Exact services need review"]),
    ...((packet.goldenArtifacts?.protectedNotes || []).length ? packet.goldenArtifacts.protectedNotes.map(item => `- Protected fact: ${item}`) : []),
    "",
    "## Pages, SEO, And Forms",
    `- Page plan: ${(packet.pagePlan || []).map(page => `${page.title} (${page.slug || "home"})`).join("; ") || requirements.pagesNeeded || "Needs review"}`,
    `- Marketing plan: ${requirements.marketingPlan || "Use the packet source facts and SERP/competitor evidence as the marketing plan."}`,
    `- Primary search target: ${searchPlan.primaryKeyword || "Needs review"}`,
    `- Secondary/local/GEO targets: ${(searchPlan.secondaryKeywords || []).slice(0, 12).join("; ") || "Use search-optimization-plan.json"}`,
    `- Must include: ${requirements.mustInclude || ""}`,
    `- Must avoid: ${requirements.mustAvoid || ""}`,
    `- Forms and routing: ${requirements.formsRouting || packet.compiled?.forms?.leadTo || "Needs review"}`,
    `- Map behavior: ${requirements.mapMode || business.mapMode || "Needs review"}`,
    `- Google directions URL: ${localPlan.mapAndDirections?.googleDirectionsUrl || "Needs review"}`,
    `- Apple Maps URL: ${localPlan.mapAndDirections?.appleMapsUrl || "Needs review"}`,
    `- Social/sameAs links: ${(localPlan.socialLinks || []).map(item => `${item.platform}: ${item.url}`).join("; ") || "Use LOCAL-PRESENCE-CONVERSION-PLAN.md"}`,
    "- Create/refresh title tags, meta descriptions, canonical URLs, sitemap hints, LocalBusiness/Organization/Service/FAQ schema, OG image, favicon, apple-touch-icon, alt text, and internal links.",
    "- Implement the compiled GEO/voice/local search plan: visible answer blocks, FAQ schema, service schema, local entity coverage, internal links, and conversion CTAs must match GEO-VOICE-LOCAL-SEARCH-PLAN.md.",
    "- Implement LOCAL-PRESENCE-CONVERSION-PLAN.md in this same first build pass: maps/directions, social links, finance/payment/gallery CTAs, review CTA, sameAs schema, LocalBusiness hasMap/address policy, and internal link strategy.",
    "",
    "## Visual And Asset Direction",
    `- Logo source: ${brand.logoLink || packet.compiled?.brand?.logoSource || "Needs review"}`,
    `- Brand colors: ${(packet.sources?.palette || []).length ? packet.sources.palette.map(item => `${item.hex} ${item.rgb || ""}`).join("; ") : brand.brandColors || "Needs review"}`,
    `- Visual tone: ${brand.visualTone || "Premium and polished"}`,
    `- Stock photos allowed: ${brand.stockAllowed || "Needs review"}`,
    `- Generated imagery allowed: ${brand.aiAllowed || "Needs review"}`,
    `- Hero mode: ${hero.variant || brand.heroSourceMode || "Needs review"}`,
    `- Hero brief: ${hero.brief || "Use the packet facts, brand colors, real assets, and selected template motion. Do not publish a blank first viewport."}`,
    ...visual.enrichmentMandates.map(item => `- Visual enrichment: ${item}`),
    ...((creative.requiredOutputs || []).map(item => `- Creative director requirement: ${item}`)),
    "- If logo, hero, gallery, social, services, widget, city, FAQ, review, or internal-link JSON files are empty stubs, first use 00-SINGLE-PASS-RESKIN-PACKET.md and attached assets. Only use Firecrawl/source scrape as explicit fallback when that packet lists the required item as missing.",
    "- Create or adapt a custom widget/lead-funnel shell for this client's industry. Do not replace it with a generic contact form unless the approved plan explicitly says the widget is not applicable.",
    "",
    "## Final QA Before Publish",
    ...remix.optimizationChecklist.map(item => `- ${item}`),
    ...localPresenceSummaryLines(packet),
    "- Verify desktop and mobile first viewport, galleries, forms, map/location behavior, no placeholders, no old client residue, and no client-facing unpublished builder preview URLs."
  ].join("\n");
}

function buildTemplateSanitationMarkdown(packet) {
  const remix = remixContractForPacket(packet);
  return [
    "# Template Sanitation Contract",
    "",
    "Before building the new client site, erase the prior customer from the remix template.",
    "",
    "## Remove Completely",
    ...remix.sanitationChecklist.map(item => `- ${item}`),
    "",
    "## Search Targets",
    "- Old business names, domains, phone numbers, emails, addresses, map embeds, review URLs, form recipients, image filenames, alt text, JSON-LD, Open Graph tags, title/meta descriptions, route labels, sitemap entries, canonical URLs, tracking IDs, and hard-coded constants.",
    "",
    "## Replace With",
    `- Business: ${packet.business?.businessName || "packet business name"}`,
    `- Domain/base URL: ${packet.business?.domainUrl || packet.compiled?.seo?.baseUrl || "new client domain when assigned"}`,
    `- Lead routing: ${packet.requirements?.formsRouting || packet.compiled?.forms?.leadTo || "packet form routing"}`,
    `- Assets: ${remix.sourcePointers.driveFolders.length ? "Google Drive connector assets first" : "packet/uploaded/direct assets first"}`,
    "",
    "## Pass Condition",
    "- A text/project search finds no previous client residue and every public SEO/social/form/schema asset points to the new client only."
  ].join("\n");
}

function buildRemixRunbookMarkdown(packet) {
  const remix = remixContractForPacket(packet);
  return [
    "# WSS Operator Runbook",
    "",
    "1. Create or open the WSS project/repo for this client.",
    "2. Read `00-WSS-MASTERPIECE-RULE.md` and `01-WSS-BUILD-COMMAND-CENTER.md` first.",
    "3. Read the source truth, content, assets, SEO, map, schema, and form files before coding.",
    "4. Use Gmail, Google Drive, Maps, Resend, and scrape/source artifacts as evidence connectors, not as replacement design brains.",
    "5. Build the full-site concept in the WSS codebase. WSS is legacy/reference-only unless the operator explicitly says otherwise.",
    "6. Use `WSS-BUILD-PROMPT.md` only after the plan is coherent.",
    "7. If a build already landed and needs correction, use `05-PACKET-DELTA-FIX-PROMPT.md` for a surgical packet-vs-site pass instead of replaying the full build.",
    "8. Publish only after the reset contract, optimization gates, desktop/mobile QA, form routing, map/schema/social-preview, and asset checks pass.",
    "",
    `Lane: ${remix.lane}`,
    `Mode: ${remix.mode}`,
    `Plan mode required: ${remix.planModeRequired ? "yes" : "no"}`
  ].join("\n");
}

function buildWSSBuildCommandCenterMarkdown(packet) {
  return buildWSSCommandCenterMarkdown(packet);
}

function buildWSSCommandCenterMarkdown(packet) {
  const remix = remixContractForPacket(packet);
  const singlePass = remix.singlePassReskin || buildSinglePassReskinSpec(packet);
  const business = packet.business || {};
  const requirements = packet.requirements || {};
  const content = packet.compiled?.contentQuality || {};
  const routeMap = contentRouteMapForPacket(packet);
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const localPlan = localPresencePlanForPacket(packet);
  const mapContract = mapSdkContractForPacket(packet);
  const visual = visualSystemContractForPacket(packet);
  const creative = visual.creativeDirectorPreflight || visual.premiumVisualStack?.creativeDirectorPreflight || buildCreativeDirectorPreflight();
  return [
    `# WSS Build Command Center - ${business.businessName || packet.packetName || "Client"}`,
    "",
    "This is the single source-of-truth operator prompt for a WSS/compiler build. Do not treat proof, runbook, handoff, or QA files as alternate build prompts.",
    "",
    "## Instruction Priority",
    "1. Credit saver gate: `00-CREDIT-SAVER-PREFLIGHT.md`. Echo its expected counts before planning; stop if counts do not match.",
    "2. WSS masterpiece rule: `00-WSS-MASTERPIECE-RULE.md`.",
    "3. Credit-saving source/asset contract: `00-SINGLE-PASS-RESKIN-PACKET.md`.",
    "4. This file: `01-WSS-BUILD-COMMAND-CENTER.md`.",
    "5. Template/source reset: `02-TEMPLATE-SANITATION-CONTRACT.md`.",
    "6. Premium visual stack: `PREMIUM-VISUAL-STACK.md` and `premium-visual-stack.json`.",
    "7. Visual enrichment gate: `VISUAL-SYSTEM-CONTRACT.md` and `visual-system-contract.json`.",
    "8. Planning aid: `WSS-BUILD-PLAN-PROMPT.md`.",
    "9. Build aid after plan approval: `WSS-BUILD-PROMPT.md`.",
    "10. Post-build correction aid: `05-PACKET-DELTA-FIX-PROMPT.md`.",
    "11. Search plan: `GEO-VOICE-LOCAL-SEARCH-PLAN.md` and `search-optimization-plan.json`.",
    "12. Bright Data artifacts: `BRIGHTDATA-SERP-AUDIT.md`, `brightdata-serp-audit.json`, and `brightdata-query-plan.json`.",
    "13. Local presence/conversion plan: `LOCAL-PRESENCE-CONVERSION-PLAN.md` and `local-presence-plan.json`.",
    "14. Map implementation contract: `MAP-SDK-CONTRACT.md`, `map-sdk-contract.json`, and `src-lib-business.ts`.",
    "15. Route/content map: `content-route-map.json` and `content-content-quality-report.json`.",
    "16. Structured data/content files such as `snapshot.json`, `pages.json`, `services.json`, `seo.json`, `assets-manifest.json`, and `content-*.md`.",
    "17. Proof/support files only verify readiness and QA; they must not override the client facts above.",
    "",
    "## Job",
    `Create a concise prebuild plan first, then build in WSS. Single-pass status is ${singlePass.status}. If 00-SINGLE-PASS-RESKIN-PACKET.md is complete, use the attached asset pack verbatim and do not scrape, invent, or substitute stock imagery. Read Gmail, Google Drive, Maps, and Resend routing when available; use Firecrawl only for verification/fallback when the packet is incomplete or contradictory. Do not modify files until the plan is coherent.`,
    "If a version of the site already landed and the operator approved a correction plan, use `05-PACKET-DELTA-FIX-PROMPT.md` as the working prompt. Make only packet-vs-site deltas and do not replay the full build prompt.",
    "",
    "## Client Target",
    `- Business: ${business.businessName || "Needs review"}`,
    `- Service area: ${business.serviceArea || "Needs review"}`,
    `- Primary target: ${requirements.primaryKeyword || business.primaryKeyword || "Use packet SEO target"}`,
    `- Compiled primary search target: ${searchPlan.primaryKeyword || "Needs review"}`,
    `- Lane: ${remix.lane}`,
    `- Prompt route: ${remix.promptRoute}`,
    `- Gmail intake URL: ${remix.sourcePointers.gmailUrl || "Use the email this packet was attached to."}`,
    `- Google Drive folders: ${remix.sourcePointers.driveFolders.length ? remix.sourcePointers.driveFolders.join("; ") : "None supplied; use packet and direct assets."}`,
    `- Marketing plan: ${requirements.marketingPlan || "Create from source facts, public SERP evidence, and the packet checklist before building."}`,
    `- Google directions URL: ${localPlan.mapAndDirections?.googleDirectionsUrl || "Needs review"}`,
    `- Apple Maps URL: ${localPlan.mapAndDirections?.appleMapsUrl || "Needs review"}`,
    `- Maps SDK: ${mapContract.status} using ${MAP_SDK_CONNECTOR_ENV} and mapId ${MAP_SDK_MAP_ID}`,
    "",
    "## Search Intelligence Requirement",
    "- Read GEO-VOICE-LOCAL-SEARCH-PLAN.md before planning.",
    "- Use attached BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, and brightdata-query-plan.json before asking for any new search run.",
    "- Do not run another broad competitor crawl unless the Bright Data artifacts are missing, blocked, or status not_configured.",
    "- If Bright Data artifacts are unavailable, say so and use Firecrawl/search plus official source URLs as the fallback.",
    "- Keep Bright Data credentials server-side only. Never paste API keys, proxy credentials, or native proxy strings into prompts, public code, packet files, or screenshots.",
    "- Translate audit findings into page titles, H1/H2 map, service coverage, FAQs, schema, internal links, local entity signals, voice-search answers, and CTAs.",
    "- Do not copy competitor text or invent unsupported claims.",
    "",
    "## Local Presence, Social, And Conversion Requirement",
    "- Read LOCAL-PRESENCE-CONVERSION-PLAN.md before planning.",
    "- Read MAP-SDK-CONTRACT.md, map-sdk-contract.json, and src-lib-business.ts before planning the map.",
    "- Build source-backed social links, sameAs schema, Google Maps, Apple Maps, directions CTAs, GBP/Place ID, map embed policy, review CTA, finance/payment/gallery/current-inventory CTAs, and internal links in the first production pass.",
    `- Use the custom Maps connector with ${MAP_SDK_CONNECTOR_ENV}, set mapId ${MAP_SDK_MAP_ID}, and implement AdvancedMarkerElement + PinView, service-area circle, and CITY_COORDS city markers from src-lib-business.ts.`,
    "- If BUSINESS.geo is null or geoVerified is false for an interactive map, stop and ask for verified GBP/map coordinates instead of publishing a broken map.",
    "- Preserve the public address/service-area rule exactly; do not expose a fake exact pin or old template map.",
    "- Add light/dark header/logo behavior at the top: logo variants, readable utility CTAs, hero/header contrast, sticky header safety, and mobile nav readability.",
    "- Finance/payment claims and CTAs must be source-supported. Do not invent APR, approvals, prices, or guarantees.",
    "",
    "## First Response Required From Builder",
    "- Confirm which packet files and connected sources you can read.",
    `- Echo this exact visitor copy proof: ${publicCopyCounts(packet).visitorFiles} files, ${publicCopyCounts(packet).visitorWords} words, ${(content.files || []).filter(file => file.kind !== "source_archive" && /content-services-/i.test(file.file)).length} service articles, ${(content.files || []).filter(file => file.kind !== "source_archive" && /content-blog-/i.test(file.file)).length} blog/support articles. Private archive: ${publicCopyCounts(packet).archiveFiles} files, ${publicCopyCounts(packet).archiveWords} words for research only.`,
    "- Confirm content-route-map.json is readable and list the mapped content files for each route. If any non-home route has no mapped content file, stop before build credits.",
    `- Confirm PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md status: ${(visual.premiumVisualStack || premiumVisualStackForPacket(packet)).status} / ${visual.status}. Echo target stack, reusable sections, asset contract, preserved primitives, hero upgrade, widget upgrade, gallery/proof upgrade, creative director/design council preflight, and visual QA gates.`,
    `- Confirm creative director/design council preflight status: ${creative.status}. Echo full-scroll visual arc, section treatments, ingredient choices, content-depth map, signature motif, motion grammar, footer polish, and no flat scaffold after the hero.`,
    `- Confirm 00-SINGLE-PASS-RESKIN-PACKET.md status: ${singlePass.status}. If it is needs_asset_pack, list only the missing items and stop before build credits are spent.`,
    "- If connector access needs linking, trigger Gmail -> Google Drive -> Maps -> Resend first. Trigger Firecrawl only when 00-SINGLE-PASS-RESKIN-PACKET.md is incomplete, contradictory, or the operator approves fallback/source verification. After each picker event, verify read success on the supplied source URLs before continuing.",
    "- Confirm the attached Bright Data audit/query-plan status and summarize it; only request another crawl if artifacts are missing, blocked, or not_configured.",
    "- Confirm LOCAL-PRESENCE-CONVERSION-PLAN.md and MAP-SDK-CONTRACT.md, then list the map/social/CTA/internal-link/theme items you will implement in the first build pass.",
    "- List every old-template identity item to remove: old names, NAP, domains, URLs, metadata, schema, images, alt text, form routing, maps, sitemap, social preview, favicon, and hidden constants.",
    "- Propose the multi-page/premier structure, internal linking, schema, sitemap, forms, gallery plan, and mobile QA plan.",
    "- Call out blockers only if Gmail/Drive/assets cannot be read or required business facts conflict.",
    "",
    "## Build Rules After Approval",
    "- Sanitize the old template completely before replacing content.",
    "- Use real client, Google Business, public-source, Gmail, Drive, and packet assets first.",
    "- Use generated visitor copy as the first draft and private source archives only for fact-checked expansion; do not replace copy with generic template filler.",
    "- Use PREMIUM-VISUAL-STACK.md and VISUAL-SYSTEM-CONTRACT.md to preserve the remix's cinematic primitives and make the hero, page visual headers, widget, gallery/proof, motion polish, brand system, and local trust better than the source template.",
    "- Carry the approved visual concept through every post-hero section and footer; do not ship a premium hero followed by a flat scaffold.",
    "- Keep visual effects high-end and useful, not chaotic.",
    "- Complete all map/social/CTA/internal-link/theme items during this first build pass so no second prompt is needed for basic local presence.",
    "- Publish only after no old-customer residue, placeholders, broken images, stale metadata, or wrong NAP remain.",
    "",
    "## Packet Evidence Summary",
    `- Visitor copy files: ${publicCopyCounts(packet).visitorFiles}`,
    `- Visitor copy words: ${publicCopyCounts(packet).visitorWords}`,
    `- Private source archive: ${publicCopyCounts(packet).archiveFiles} files, ${publicCopyCounts(packet).archiveWords} words; research only`,
    `- Route/content mappings: ${routeMap.length}`,
    ...routeMap.slice(0, 12).map(item => `- ${item.route}: ${item.contentFiles.length ? item.contentFiles.join("; ") : "MISSING - stop"}`),
    `- Search target count: ${(searchPlan.secondaryKeywords || []).length + (searchPlan.primaryKeyword ? 1 : 0)}`,
    `- Local/social/CTA count: ${(localPlan.ctaMigration?.requiredCtas || []).length}`,
    `- Visual contract: ${visual.status}; ${visual.enrichmentMandates.length} enrichment mandates; ${visual.qaGates.length} QA gates`,
    `- Creative director preflight: ${creative.status}; ${(creative.requiredOutputs || []).length} required outputs`,
    `- Page plan: ${(packet.pagePlan || []).map(page => `${page.title} (${page.slug || "home"})`).join("; ") || requirements.pagesNeeded || "Needs review"}`,
    `- Asset mode: ${remix.assetAccessMode}`,
    "",
    "If any packet file conflicts, follow this command center first and use the newest structured JSON/source data for facts."
  ].join("\n");
}

function buildPromptMarkdown(packet) {
  const business = packet.business || {};
  const brand = packet.brand || {};
  const requirements = packet.requirements || {};
  const sources = packet.sources || {};
  const remix = remixContractForPacket(packet);
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const localPlan = localPresencePlanForPacket(packet);
  return [
    `# Website Build Prompt - ${business.businessName || packet.packetName || "Client"}`,
    "",
    "Use the verified intake details below to build the website in one careful pass. Do not invent business facts. If a detail is missing or marked for review, leave a clear review note instead of guessing.",
    "",
    "## WSS Build Workflow",
    `- Lane: ${remix.lane}`,
    `- Mode: ${remix.mode}`,
    `- Prompt route: ${remix.promptRoute}`,
    `- Woodward Gmail URL: ${remix.sourcePointers.gmailUrl || "Not provided"}`,
    `- Google Drive asset folder(s): ${remix.sourcePointers.driveFolders.length ? remix.sourcePointers.driveFolders.join("; ") : "Not provided"}`,
    `- Reference/template URL: ${remix.template.remixTemplateUrl || "Optional; WSS original build does not require one"}`,
    "- First remove any previous/client-reference residue, then rebuild from this packet.",
    "- Use connected Gmail and Google Drive when those URLs are present. Stop and ask for access if the builder cannot read them.",
    "- Use `01-WSS-BUILD-COMMAND-CENTER.md` as the only top-level operator prompt. Treat proof/support files as evidence, not competing build instructions.",
    "",
    "## Business",
    `- Name: ${business.businessName || ""}`,
    `- Phone: ${business.phone || ""}`,
    `- SMS: ${business.smsNumber || ""}`,
    `- Email: ${business.email || ""}`,
    `- Website: ${business.domainUrl || ""}`,
    `- Google Business / Place ID: ${business.gbpPlaceId || "Needs review"}`,
    `- Address / public location rule: ${business.address || ""}`,
    `- Service area: ${business.serviceArea || ""}`,
    `- Hours: ${business.hours || "Needs review"}`,
    `- Hours source: ${business.hoursSource || "Needs review"}`,
    `- Business listing confidence: ${business.listingConfidence || "Needs review"}`,
    "",
    "## Services And Customer Action",
    `- Core services: ${business.mainServices || ""}`,
    `- Primary call to action: ${business.mainCta || ""}`,
    "",
    "## Visual Brand Direction",
    `- Logo source: ${brand.logoLink || "Use the upper-left website logo if verified, otherwise flag for review."}`,
    `- Favicon needed: ${brand.faviconRequired || ""}`,
    `- Brand colors: ${(sources.palette || []).length ? sources.palette.map(item => `${item.hex} (${item.rgb || ""}; ${item.cmyk || ""})`).join("; ") : brand.brandColors || "Needs review"}`,
    `- Visual tone: ${brand.visualTone || ""}`,
    `- Photos received: ${brand.clientPhotosReceived || ""}`,
    `- Stock photos allowed: ${brand.stockAllowed || ""}`,
    `- Generated imagery allowed: ${brand.aiAllowed || ""}`,
    `- Gallery or photo folder: ${brand.galleryLink || ""}`,
    "",
    "## Required Website Content",
    `- Site type: ${requirements.siteType || ""}`,
    `- Required pages or sections: ${requirements.pagesNeeded || ""}`,
    `- Visitor copy files generated: ${publicCopyCounts(packet).visitorFiles}`,
    `- Visitor copy words generated: ${publicCopyCounts(packet).visitorWords}`,
    `- Private source archive: ${publicCopyCounts(packet).archiveFiles} files, ${publicCopyCounts(packet).archiveWords} words; use as research, never publish raw`,
    "- Use generated visitor-copy files as the first draft. Source archives under content/source/ are private research; never publish them raw.",
    "- Expand from verified source facts where useful for an authority site, then review claims, repetition, fit, grammar, and client voice.",
    `- Must include: ${requirements.mustInclude || ""}`,
    `- Must avoid: ${requirements.mustAvoid || ""}`,
    `- Forms and routing: ${requirements.formsRouting || ""}`,
    `- Reviews, proof, and badges: ${requirements.reviewsProof || ""}`,
    `- Map behavior: ${requirements.mapMode || ""}`,
    `- Tracking and pixels: ${requirements.tracking || ""}`,
    `- Launch/domain/compliance notes: ${requirements.launchNotes || ""}`,
    "",
    "## Search, GEO, Voice, And Local Optimization",
    `- Primary search target: ${searchPlan.primaryKeyword || "Needs review"}`,
    `- Secondary search targets: ${(searchPlan.secondaryKeywords || []).slice(0, 18).join("; ") || "See search-optimization-plan.json"}`,
    `- Local modifiers: ${(searchPlan.localModifiers || []).join("; ") || "Needs review"}`,
    "- Read GEO-VOICE-LOCAL-SEARCH-PLAN.md before planning or building.",
    "- Use attached BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, and brightdata-query-plan.json before asking for any new search run.",
    "- Do not run another broad competitor crawl unless the Bright Data artifacts are missing, blocked, or status not_configured.",
    "- Keep Bright Data credentials server-side only. Never paste API keys, proxy credentials, or native proxy strings into prompts, public code, packet files, or screenshots.",
    "- Build visible answer blocks, FAQ schema, service schema, internal links, local entity coverage, sitemap/canonical/robots readiness, and conversion CTAs from the compiled search plan.",
    "",
    "## Local Presence, Social, Maps, CTAs, And Theme",
    `- Google Maps/search URL: ${localPlan.mapAndDirections?.googleMapsSearchUrl || "Needs review"}`,
    `- Google directions URL: ${localPlan.mapAndDirections?.googleDirectionsUrl || "Needs review"}`,
    `- Apple Maps URL: ${localPlan.mapAndDirections?.appleMapsUrl || "Needs review"}`,
    `- Public address/map policy: ${localPlan.mapAndDirections?.publicAddressPolicy || "Needs review"}`,
    `- Source-backed social links: ${(localPlan.socialLinks || []).map(item => `${item.platform}: ${item.url}`).join("; ") || "None verified"}`,
    "- Implement source-supported call/text/email, Google directions, Apple Maps, review, social, finance/payment, gallery/current-inventory, and lead-form CTAs in the first pass.",
    "- Implement LocalBusiness sameAs, hasMap, opening-hours, areaServed, address/service-area, and geo policies from local-presence-plan.json.",
    "- Implement top light/dark header/logo behavior and verify utility CTAs remain readable on mobile and desktop.",
    "",
    "## Source Evidence",
    ...((sources.urls || []).length ? sources.urls.map(url => `- ${url}`) : ["- No source URLs captured"]),
    "",
    "## Meeting Notes And Human Context",
    sources.meetingNotes || "No meeting notes were pasted into the form.",
    "",
    "## Review Items Before Final Publish",
    ...((packet.readiness?.blockers || []).length ? packet.readiness.blockers.map(item => `- ${item}`) : ["- None"])
  ].join("\n");
}

function searchOptimizationPlanForPacket(packet = {}) {
  if (packet.compiled?.searchOptimizationPlan) return packet.compiled.searchOptimizationPlan;
  const business = packet.business || {};
  const requirements = packet.requirements || {};
  const services = unique([
    ...(packet.goldenArtifacts?.exactServices || []),
    ...splitLinesLocal(business.exactServices, business.mainServices)
  ]).slice(0, 18);
  const localModifiers = unique(splitLinesLocal(business.serviceArea, business.address)
    .map(item => item.replace(/\b(united states|usa)\b/ig, "").trim())
    .filter(Boolean))
    .slice(0, 12);
  const market = localModifiers[0] || business.serviceArea || "local service area";
  const explicitTargets = unique(splitLinesLocal(requirements.primaryKeyword, requirements.seoTargets, requirements.searchTerms, requirements.marketingPlan));
  const primaryKeyword = explicitTargets[0] || keywordWithMarket(services[0] || business.businessName || "local service", market);
  const secondaryKeywords = unique([
    ...explicitTargets.slice(1),
    ...services.slice(0, 12).map(service => keywordWithMarket(service, market)),
    ...services.slice(0, 8)
  ]).filter(term => term.toLowerCase() !== String(primaryKeyword).toLowerCase()).slice(0, 24);
  const pagePlan = packet.pagePlan || [];
  return {
    version: "search-intelligence-v1",
    status: primaryKeyword ? "compiled-fallback" : "review",
    generatedAt: packet.createdAt || new Date().toISOString(),
    primaryKeyword,
    secondaryKeywords,
    localModifiers,
    sourceStrategy: {
      requiredFirstPass: "Use attached BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, and brightdata-query-plan.json first. Run more Bright Data or competitor searches only when those artifacts are missing, blocked, or not_configured.",
      fallback: "If Bright Data artifacts are missing, blocked, or not_configured, use Firecrawl/search plus official source URLs and disclose the fallback before build.",
      doNotCopyCompetitors: true
    },
    pageTargets: pagePlan.map((page, index) => ({
      page: page.title || (index === 0 ? "Home" : `Page ${index + 1}`),
      slug: page.slug || "",
      targetKeyword: index === 0 ? primaryKeyword : (secondaryKeywords[index - 1] || keywordWithMarket(page.title || primaryKeyword, market)),
      intent: inferSearchIntent(page.title || ""),
      schemaHints: index === 0 ? ["LocalBusiness", "WebSite", "Organization", "FAQPage"] : ["Service", "FAQPage", "BreadcrumbList"]
    })),
    voiceSearch: {
      questions: unique([
        `Who offers ${primaryKeyword}?`,
        `What should I know before requesting ${primaryKeyword}?`,
        `How do I contact ${business.businessName || "this local business"}?`,
        ...services.slice(0, 8).flatMap(service => [
          `Do you offer ${String(service).toLowerCase()}?`,
          `How do I request ${String(service).toLowerCase()} in ${market}?`
        ])
      ]).slice(0, 28),
      answerStyle: "short conversational answers backed by visible page copy and FAQ schema"
    },
    localSearch: {
      napConsistency: "Business name, phone, email, address/public address rule, service area, map mode, and GBP/Place ID must match visible copy and schema.",
      gbpPolicy: "Use Place ID, map embed, reviews, and geo coordinates only when verified.",
      areaServed: localModifiers
    },
    technicalRequirements: {
      canonicalPolicy: "Final domain drives canonicals, OG URLs, schema @id/url values, and sitemap URLs.",
      sitemapPolicy: "Every public route needs a sitemap entry and crawlable title/meta/canonical.",
      schemaTypes: ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"]
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

function searchOptimizationMarkdown(packet = {}) {
  const plan = searchOptimizationPlanForPacket(packet);
  const audit = brightDataAuditForPacket(packet);
  return [
    `# GEO, Voice, Local Search, And SEO Plan - ${packet.business?.businessName || packet.packetName || "Client"}`,
    "",
    "This file is a required planning artifact. The WSS builder must read it before building.",
    "",
    "## Audit Source Rule",
    "- Preferred: Use attached BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, and brightdata-query-plan.json first.",
    "- Fallback: If Bright Data artifacts are missing, blocked, or not_configured, use Firecrawl/search plus official source URLs and disclose fallback before build.",
    `- Bright Data artifact: ${audit.status || "planned"}; read BRIGHTDATA-SERP-AUDIT.md, brightdata-serp-audit.json, and brightdata-query-plan.json before planning.`,
    `- Planned SERP query count: ${(audit.queryPlan?.queries || []).length}; live result count: ${(audit.queries || []).length}`,
    "- Do not copy competitor text.",
    "- Do not invent unsupported claims.",
    "",
    "## Search Targets",
    `- Primary: ${plan.primaryKeyword || "Needs review"}`,
    ...((plan.secondaryKeywords || []).length ? plan.secondaryKeywords.map(term => `- Secondary: ${term}`) : ["- Secondary: needs review"]),
    "",
    "## Local Modifiers",
    ...((plan.localModifiers || []).length ? plan.localModifiers.map(area => `- ${area}`) : ["- Needs review"]),
    "",
    "## Page Target Map",
    ...((plan.pageTargets || []).length ? plan.pageTargets.map(page => `- ${page.page} (${page.slug || "home"}): ${page.targetKeyword || "Needs review"}; intent: ${page.intent || "service authority"}; schema: ${(page.schemaHints || []).join(", ")}`) : ["- Needs review"]),
    "",
    "## Voice And Generative Search",
    "- Build answer-friendly sections that can be quoted by generative search and voice search.",
    "- Keep answers short, factual, and backed by visible page copy.",
    ...((plan.voiceSearch?.questions || []).length ? plan.voiceSearch.questions.map(question => `- ${question}`) : ["- Add who/what/where/how-to-request questions."]),
    "",
    "## Local Search Requirements",
    `- NAP consistency: ${plan.localSearch?.napConsistency || "Required"}`,
    `- GBP policy: ${plan.localSearch?.gbpPolicy || "Verify before using map/reviews/geo coordinates."}`,
    "",
    "## Technical Requirements",
    `- Canonicals: ${plan.technicalRequirements?.canonicalPolicy || "Final domain controls canonical URLs."}`,
    `- Sitemap: ${plan.technicalRequirements?.sitemapPolicy || "Every route needs a sitemap entry."}`,
    `- Schema types: ${(plan.technicalRequirements?.schemaTypes || []).join(", ") || "LocalBusiness, Service, FAQPage"}`,
    "",
    "## QA Gates",
    ...((plan.qaGates || []).map(gate => `- ${gate}`))
  ].join("\n");
}

function searchOptimizationSummaryLines(packet = {}) {
  const plan = searchOptimizationPlanForPacket(packet);
  const audit = brightDataAuditForPacket(packet);
  return [
    `- Search plan status: ${plan.status || "compiled"}`,
    `- Primary target: ${plan.primaryKeyword || "Needs review"}`,
    `- Secondary target count: ${(plan.secondaryKeywords || []).length}`,
    `- Local modifier count: ${(plan.localModifiers || []).length}`,
    `- Bright Data audit status: ${audit.status || "planned"}; live queries: ${(audit.queries || []).length}; planned queries: ${(audit.queryPlan?.queries || []).length}`,
    "- Bright Data preferred: yes; use attached audit/query plan before asking WSS to run more competitor searches.",
    "- Required file: GEO-VOICE-LOCAL-SEARCH-PLAN.md"
  ];
}

function brightDataQueryPlanForPacket(packet = {}) {
  if (packet.compiled?.brightDataQueryPlan) return packet.compiled.brightDataQueryPlan;
  if (packet.brightDataQueryPlan) return packet.brightDataQueryPlan;
  const business = packet.business || {};
  const requirements = packet.requirements || {};
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const market = splitLinesLocal(business.serviceArea, business.address)[0] || "local area";
  const targets = unique([
    searchPlan.primaryKeyword,
    ...(searchPlan.secondaryKeywords || []),
    ...splitLinesLocal(requirements.marketingPlan).filter(line => !/^[-#]/.test(line)).slice(0, 8)
  ]).filter(Boolean).slice(0, 6);
  const fallbackTargets = targets.length ? targets : [searchPlan.primaryKeyword || business.businessName || packet.packetName || "local service"];
  return {
    version: "brightdata-serp-query-plan-v1",
    generatedAt: packet.createdAt || new Date().toISOString(),
    provider: "Bright Data Direct API",
    endpoint: process.env.BRIGHTDATA_SERP_ENDPOINT || "https://api.brightdata.com/request",
    zone: process.env.BRIGHTDATA_SERP_ZONE || "serp_api3",
    format: "raw",
    defaultCountry: "us",
    defaultLanguage: "en",
    maxQueries: fallbackTargets.length,
    costGuard: "Default cap is 6 live SERP requests per packet. Hard cap is 10 in the audit endpoint.",
    credentialPolicy: "Server-side only. Never paste Bright Data API keys, proxy usernames, proxy passwords, or native proxy strings into prompts.",
    queries: fallbackTargets.map((keyword, index) => {
      const query = keywordWithMarket(keyword, market);
      return {
        id: `serp-${index + 1}`,
        keyword,
        query,
        intent: index === 0 ? "primary local authority" : inferSearchIntent(keyword),
        googleUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en&gl=us&pws=0`,
        expectedUse: [
          "page titles and H1/H2 calibration",
          "service coverage gaps",
          "FAQ and voice-search extraction",
          "schema/internal-link/CTA planning"
        ]
      };
    })
  };
}

function brightDataAuditForPacket(packet = {}) {
  if (packet.compiled?.brightDataAudit) return packet.compiled.brightDataAudit;
  if (packet.brightDataAudit) return packet.brightDataAudit;
  const business = packet.business || {};
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const queryPlan = brightDataQueryPlanForPacket(packet);
  return normalizeBrightDataAuditForPacket(null, queryPlan, searchPlan, business);
}

function normalizeBrightDataAuditForPacket(audit, queryPlan, searchPlan, data = {}) {
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
    endpoint: source.endpoint || process.env.BRIGHTDATA_SERP_ENDPOINT || "https://api.brightdata.com/request",
    zone: source.zone || queryPlan.zone || "serp_api3",
    responseFormat: source.responseFormat || queryPlan.format || "raw",
    credentialPolicy: source.credentialPolicy || "Server-side only. Do not expose API keys or proxy credentials in prompts, public code, packet files, or screenshots.",
    note: source.note || (queries.length ? "Live Bright Data audit attached." : "Query plan attached; live audit has not run yet."),
    queryPlan: source.queryPlan || queryPlan,
    queries,
    aggregate: {
      topCompetitorDomains: aggregate.topCompetitorDomains || [],
      titlePatterns: aggregate.titlePatterns || [],
      questionIdeas: aggregate.questionIdeas || searchPlan.voiceSearch?.questions || [],
      contentGaps: aggregate.contentGaps || ["Use the attached query plan or run live audit only when Bright Data is configured before build."],
      schemaPriorities: aggregate.schemaPriorities || ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
      internalLinkPriorities: aggregate.internalLinkPriorities || [],
      ctaPriorities: aggregate.ctaPriorities || ["call", "estimate/contact form", "directions/map", "source-backed reviews"]
    },
    firstPassRecommendations: source.firstPassRecommendations || {
      pageTitles: (searchPlan.pageTargets || []).map(page => ({ page: page.page, slug: page.slug, titleTarget: page.targetKeyword, h1Target: page.targetKeyword })),
      h2Themes: ["Local proof", "Process", "FAQ answers", "Service-area coverage"],
      faqIdeas: searchPlan.voiceSearch?.questions || [],
      schema: ["LocalBusiness", "Organization", "WebSite", "Service", "FAQPage", "BreadcrumbList"],
      qaGates: ["No competitor text copied.", "SERP findings converted into original content and schema."]
    }
  };
}

function brightDataAuditMarkdown(packet = {}) {
  const audit = brightDataAuditForPacket(packet);
  const aggregate = audit.aggregate || {};
  const queries = audit.queries || [];
  const queryPlan = audit.queryPlan || {};
  return [
    `# Bright Data SERP Optimization Audit - ${audit.businessName || packet.business?.businessName || packet.packetName || "Client"}`,
    "",
    "This file is a first-pass build artifact. The WSS builder must use it before running another broad competitor crawl.",
    "",
    "## Credential Safety",
    "- Bright Data credentials stay server-side in WSS environment variables.",
    "- Do not paste API keys, proxy usernames, proxy passwords, or native proxy strings into prompts, public code, packet files, or screenshots.",
    "",
    "## Direct API Contract",
    `- Endpoint: ${audit.endpoint || "https://api.brightdata.com/request"}`,
    `- Zone: ${audit.zone || queryPlan.zone || "serp_api3"}`,
    `- Format: ${audit.responseFormat || queryPlan.format || "raw"}`,
    `- Status: ${audit.status || "planned"}`,
    `- Cost guard: ${queryPlan.costGuard || "Cap live SERP requests before build."}`,
    "",
    "## Query Plan",
    ...((queryPlan.queries || []).map(item => `- ${item.id || ""} ${item.query || item.keyword}: ${item.googleUrl || ""}`)),
    "",
    "## Live Query Summary",
    ...(queries.length ? queries.map(item => `- ${item.query}: ${item.resultCount || 0} results, status ${item.status || "review"}`) : ["- No live Bright Data query results attached yet. Use brightdata-query-plan.json or run the audit only when configured before build."]),
    "",
    "## Competitor Domains",
    ...((aggregate.topCompetitorDomains || []).length ? aggregate.topCompetitorDomains.map(item => `- ${item.domain}: ${item.count}`) : ["- No competitor domains extracted yet."]),
    "",
    "## Title / SERP Patterns",
    ...((aggregate.titlePatterns || []).slice(0, 20).map(item => `- ${item}`)),
    "",
    "## FAQ / Voice Questions",
    ...((aggregate.questionIdeas || []).slice(0, 24).map(item => `- ${item}`)),
    "",
    "## Content Gaps",
    ...((aggregate.contentGaps || []).map(item => `- ${item}`)),
    "",
    "## First-Pass Build Requirements",
    "- Convert this audit into original page titles, H1/H2s, FAQs, service sections, schema, internal links, local entity proof, and conversion CTAs.",
    "- Do not copy competitor text.",
    "- Do not import unsupported claims, review counts, prices, licenses, warranties, emergency promises, or financing terms."
  ].join("\n");
}

function parseCoordinate(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function parseGeoFromBusiness(business = {}, packet = {}) {
  const directLat = parseCoordinate(business.geoLat || business.lat);
  const directLng = parseCoordinate(business.geoLng || business.lng);
  if (validLatLng(directLat, directLng)) return { lat: directLat, lng: directLng, source: "intake verified geo fields", verified: true, schemaAllowed: true };
  if (business.geo && validLatLng(Number(business.geo.lat), Number(business.geo.lng))) return { lat: Number(business.geo.lat), lng: Number(business.geo.lng), source: "compiled client geo", verified: true, schemaAllowed: true };
  const text = [business.gbpLink, business.googleMapsUrl, packet.sources?.meetingNotes, packet.requirements?.remixOperatorNotes, business.address].filter(Boolean).join(" ");
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
    if (validLatLng(lat, lng)) return { lat, lng, source: "source map URL or pasted GBP coordinates", verified: true, schemaAllowed: true };
  }
  return { lat: null, lng: null, source: "", verified: false, schemaAllowed: false };
}

function parseServiceRadiusMiles(business = {}, packet = {}) {
  const direct = parseCoordinate(business.serviceRadiusMiles);
  if (direct && direct > 0) return { miles: direct, source: "intake field", needsReview: false };
  const text = [business.serviceArea, packet.sources?.meetingNotes, packet.requirements?.marketingPlan, packet.requirements?.mustInclude].filter(Boolean).join(" ");
  const match = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i) || text.match(/\bradius\s*(?:of|:)?\s*(\d{1,3}(?:\.\d+)?)/i);
  const miles = match ? parseCoordinate(match[1]) : null;
  if (miles && miles > 0) return { miles, source: "source text", needsReview: false };
  return { miles: 25, source: "default display radius - review before production", needsReview: true };
}

function stateHintFromBusiness(business = {}) {
  const text = [business.address, business.serviceArea, business.domainUrl].filter(Boolean).join(" ");
  const match = text.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b[a-z]/g, chr => chr.toUpperCase()).replace(/\b(Tn|Tx|Ak|Sc)\b/g, word => word.toUpperCase());
}

function serviceAreaNamesForPacket(business = {}) {
  return unique(splitLinesLocal(business.serviceArea, business.serviceAreaTowns)
    .map(item => item.replace(/\b(and|within|serving|area|areas|near|around)\b/ig, " ").replace(/\s+/g, " ").trim())
    .filter(item => item && item.length <= 70 && !/^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/i.test(item))
  ).slice(0, 18);
}

function lookupCityCoord(area, stateHint = "") {
  const clean = titleCase(String(area || "").replace(/\b(county|parish|municipality|metro|area|region|valley)\b/ig, "").replace(/\s+/g, " ").trim());
  const directKeys = unique([area, clean, stateHint ? `${clean}, ${stateHint}` : "", String(area || "").replace(/\s+/g, " ").trim()]);
  for (const key of directKeys) {
    if (KNOWN_CITY_COORDS[key]) return { name: clean || area, ...KNOWN_CITY_COORDS[key], source: "known coordinate dictionary", approximate: true };
  }
  return null;
}

function buildCityCoordinatePlanForPacket(business = {}) {
  const stateHint = stateHintFromBusiness(business);
  const areas = serviceAreaNamesForPacket(business);
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

function mapBrandTokensForPacket(packet = {}) {
  const colors = splitLinesLocal(packet.brand?.brandColors, packet.compiled?.brand?.brandColors).map(normalizeHex).filter(Boolean);
  return { night: colors[0] || "#161E5D", slate: colors[1] || "#505686", steel: colors[2] || "#7A85B8", bone: "#FFFFFF", ember: colors[0] || "#166CC8" };
}

function mapSdkContractForPacket(packet = {}) {
  if (packet.compiled?.mapSdkContract) return packet.compiled.mapSdkContract;
  if (packet.compiled?.localPresencePlan?.mapSdkContract) return packet.compiled.localPresencePlan.mapSdkContract;
  const business = { ...(packet.business || {}), ...(packet.requirements || {}) };
  const mapAndDirections = buildMapAndDirectionsForPacket(business);
  const geo = parseGeoFromBusiness(business, packet);
  const radius = parseServiceRadiusMiles(business, packet);
  const cityPlan = buildCityCoordinatePlanForPacket(business);
  const brand = mapBrandTokensForPacket(packet);
  const mapMode = String(business.mapMode || packet.requirements?.mapMode || "Service area").trim();
  const disabled = /^none$/i.test(mapMode);
  const officeOnly = /office section/i.test(mapMode);
  const interactiveMapExpected = !disabled && !officeOnly;
  const blockers = [];
  const reviewItems = [];
  if (!business.mapMode && !packet.requirements?.mapMode) reviewItems.push("Map mode was not chosen; compiler selected service-area fallback for admin review.");
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
      cityMarkers: { coordsObjectName: "CITY_COORDS", coords: cityPlan.coords, pinView: { background: brand.slate, borderColor: brand.night, glyphColor: "#FFFFFF", scale: 0.75 }, infoWindowAction: "Get Estimate in {city} button scrolls to the contact form and focuses the name input." }
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
  if (!match) return { street: text, city: "", state: stateHintFromBusiness({ address: text }), zip: "" };
  return { street: match[1].trim(), city: titleCase(match[2].trim()), state: match[3].toUpperCase(), zip: match[4] || "" };
}

function businessTsForPacket(packet = {}) {
  if (packet.compiled?.businessTs) return packet.compiled.businessTs;
  const businessData = { ...(packet.business || {}), ...(packet.requirements || {}) };
  const contract = mapSdkContractForPacket(packet);
  const address = parseAddressParts(businessData.address || "");
  const services = Array.isArray(packet.compiled?.services) ? packet.compiled.services : [];
  const business = {
    name: businessData.businessName || "",
    shortName: businessData.businessName ? businessData.businessName.replace(/\b(LLC|Inc\.?|Company|Co\.?)\b/ig, "").replace(/\s+/g, " ").trim() : "",
    tagline: businessData.mainCta || packet.brand?.visualTone || "",
    phone: businessData.phone || "",
    phoneTel: String(businessData.phone || businessData.smsNumber || "").replace(/[^\d+]/g, ""),
    email: businessData.email || "",
    street: address.street || businessData.address || "",
    city: address.city || "",
    state: address.state || contract.cityCoordinatePlan?.stateHint || "",
    zip: address.zip || "",
    region: businessData.serviceArea || "",
    geo: contract.geo.verified ? { lat: contract.geo.lat, lng: contract.geo.lng } : null,
    geoVerified: contract.geo.verified,
    serviceRadiusMiles: contract.serviceRadiusMiles,
    domain: businessData.domainUrl || businessData.website || "",
    canonical: businessData.domainUrl || businessData.website || "",
    hours: businessData.hours || "",
    serviceAreas: serviceAreaNamesForPacket(businessData),
    services: services.map(service => ({ slug: service.slug || slugify(service.name || service.title), name: service.name || service.title || service.slug || "", shortDescription: service.shortDesc || service.shortDescription || "" })),
    brand: mapBrandTokensForPacket(packet),
    map: { connectorEnv: MAP_SDK_CONNECTOR_ENV, connectorName: MAP_SDK_CONNECTOR_NAME, mapId: MAP_SDK_MAP_ID, mode: contract.mapMode, googleMapsSearchUrl: contract.googleMapsSearchUrl || "", googleDirectionsUrl: contract.googleDirectionsUrl || "" }
  };
  return [
    "export const BUSINESS = " + JSON.stringify(business, null, 2) + " as const;",
    "",
    "export const CITY_COORDS = " + JSON.stringify(contract.cityCoordinatePlan?.coords || {}, null, 2) + " as const;",
    "",
    "export type BusinessConfig = typeof BUSINESS;"
  ].join("\n");
}

function mapSdkMarkdown(packet = {}) {
  const contract = mapSdkContractForPacket(packet);
  const cityCoords = contract.cityCoordinatePlan?.coords || {};
  return [
    `# Maps SDK Contract - ${packet.business?.businessName || packet.packetName || "Client"}`,
    "",
    "This file is required before building the contact/service-area map. It prevents broken embedded maps, stale old-template coordinates, and second-pass map repairs.",
    "",
    "## Connector",
    `- Connector: ${contract.connector?.name || MAP_SDK_CONNECTOR_NAME}`,
    `- Browser key env: ${contract.connector?.env || MAP_SDK_CONNECTOR_ENV}`,
    `- Map ID: ${contract.mapId || MAP_SDK_MAP_ID}`,
    "- Rule: link the custom Google Maps connector, not the managed connector.",
    "",
    "## Business Geo",
    `- Status: ${contract.status}`,
    `- Geo verified: ${contract.geo?.verified ? "yes" : "no"}`,
    `- Geo source: ${contract.geo?.source || "Needs review"}`,
    `- Latitude: ${contract.geo?.lat ?? "Needs review"}`,
    `- Longitude: ${contract.geo?.lng ?? "Needs review"}`,
    `- Service radius miles: ${contract.serviceRadiusMiles} (${contract.serviceRadiusSource})`,
    "",
    "## Implementation Requirements",
    "- Load Google Maps with `import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`.",
    `- Set Map constructor \`mapId\` to \`${contract.mapId || MAP_SDK_MAP_ID}\`.`,
    "- Import marker library with `google.maps.importLibrary('marker')`.",
    "- Use `AdvancedMarkerElement` with `PinView` for the main marker.",
    "- Use a `google.maps.Circle` centered on `BUSINESS.geo` for service area radius.",
    "- Use `CITY_COORDS` for smaller service-area city markers.",
    "- Do not write invented exact geo into LocalBusiness schema. Only use schema geo when `geoVerified` is true.",
    "",
    "## CITY_COORDS",
    ...(Object.keys(cityCoords).length ? Object.entries(cityCoords).map(([name, coords]) => `- ${name}: ${coords.lat}, ${coords.lng}`) : ["- No city coordinates compiled."]),
    "",
    "## Missing City Coordinates",
    ...((contract.cityCoordinatePlan?.missing || []).length ? contract.cityCoordinatePlan.missing.map(item => `- ${item}`) : ["- None"]),
    "",
    "## Blockers",
    ...((contract.blockers || []).length ? contract.blockers.map(item => `- ${item}`) : ["- None"]),
    "",
    "## Review Items",
    ...((contract.reviewItems || []).length ? contract.reviewItems.map(item => `- ${item}`) : ["- None"]),
    "",
    "## QA Gates",
    ...(contract.qaGates || []).map(item => `- ${item}`)
  ].join("\n");
}

function seoAssetLayerForPacket(packet = {}) {
  if (packet.compiled?.seoAssetLayer) return packet.compiled.seoAssetLayer;
  const business = { ...(packet.business || {}), ...(packet.requirements || {}) };
  const services = Array.isArray(packet.compiled?.services) ? packet.compiled.services : [];
  const mapContract = mapSdkContractForPacket(packet);
  const baseUrl = normalizeSiteUrl(business.domainUrl || business.website || business.websiteUrl || "");
  const siteName = business.businessName || packet.packetName || "Client website";
  const routes = unique([...(packet.compiled?.manifest?.routes || []), "/", ...(packet.pagePlan || []).map(page => page.slug ? `/${page.slug}` : "/"), ...services.map(service => `/services/${service.slug || slugify(service.name || service.title)}`)]);
  const pages = routes.map(route => ({ route, url: absoluteSiteUrl(baseUrl, route), priority: route === "/" ? 1 : 0.7, changefreq: "monthly" }));
  const sameAs = collectSameAs(packet, business);
  const address = parseAddressParts(business.address || "");
  const localBusiness = stripEmpty({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": baseUrl ? `${baseUrl.replace(/\/$/, "")}/#localbusiness` : "#localbusiness",
    name: siteName,
    url: baseUrl || undefined,
    telephone: business.phone || undefined,
    email: business.email || undefined,
    image: "assets/og-default.jpg",
    logo: "assets/logo-transparent.webp",
    address: business.address ? stripEmpty({
      "@type": "PostalAddress",
      streetAddress: address.street || business.address || undefined,
      addressLocality: address.city || undefined,
      addressRegion: address.state || mapContract.cityCoordinatePlan?.stateHint || undefined,
      postalCode: address.zip || undefined,
      addressCountry: "US"
    }) : undefined,
    geo: mapContract.geo?.verified ? { "@type": "GeoCoordinates", latitude: mapContract.geo.lat, longitude: mapContract.geo.lng } : undefined,
    areaServed: serviceAreaNamesForPacket(business).map(name => ({ "@type": "Place", name })),
    hasMap: mapContract.googleMapsSearchUrl || undefined,
    openingHours: business.hours || undefined,
    sameAs
  });
  const features = geoFeatures(business, mapContract, baseUrl);
  const sitemapsByName = sitemapXmlByName(baseUrl, pages);
  const offers = services.map(service => ({
    slug: service.slug || slugify(service.name || service.title),
    name: service.name || service.title || service.slug,
    priceRange: service.priceRange || "Contact for estimate",
    url: absoluteSiteUrl(baseUrl, `/services/${service.slug || slugify(service.name || service.title)}`),
    areaServed: business.serviceArea || ""
  }));
  return {
    version: "seo-asset-layer-v1",
    status: baseUrl && localBusiness.name ? "pass" : "review",
    files: ["answer-engine.json", "entity.json", "local-business.jsonld", "locations.geojson", "geo.kml", "sitemap-index.xml", "sitemap-services.xml", "sitemap-geo.xml", "sitemap-entity.xml", "offers.json", "products-feed.json", "well-known-pagehub.json"],
    schemaTypes: ["LocalBusiness", "Organization", "Service", "FAQPage", "WebSite", "BreadcrumbList"],
    sitemaps: Object.keys(sitemapsByName),
    answerEngine: {
      version: "answer-engine-v1",
      businessSummary: `${siteName} serves ${business.serviceArea || "its local area"} with ${(services.map(service => service.name).filter(Boolean).join(", ") || business.mainServices || "verified local services")}.`,
      directAnswers: [
        { question: `What does ${siteName} do?`, answer: business.mainServices || "Needs review." },
        { question: `Where does ${siteName} serve?`, answer: business.serviceArea || "Needs review." },
        { question: `How do I contact ${siteName}?`, answer: [business.phone, business.email, business.mainCta].filter(Boolean).join(" | ") || "Use the website contact form." }
      ]
    },
    entity: {
      version: "pagehub-entity-v1",
      name: siteName,
      canonical: baseUrl,
      phone: business.phone || "",
      email: business.email || "",
      address: business.address || "",
      serviceArea: business.serviceArea || "",
      hours: business.hours || "",
      hoursSource: business.hoursSource || "",
      placeId: business.gbpPlaceId || "",
      sameAs,
      services: services.map(service => service.name || service.title || service.slug).filter(Boolean),
      map: { mode: mapContract.mapMode, geoVerified: mapContract.geo?.verified === true, lat: mapContract.geo?.lat ?? null, lng: mapContract.geo?.lng ?? null, serviceRadiusMiles: mapContract.serviceRadiusMiles, mapId: mapContract.mapId, connectorEnv: mapContract.connector?.env || MAP_SDK_CONNECTOR_ENV }
    },
    localBusiness,
    locationsGeojson: { type: "FeatureCollection", features },
    geoKml: kmlForFeatures(siteName, features),
    offers,
    productsFeed: offers.map(offer => ({ id: offer.slug, title: offer.name, description: `${siteName} service page.`, link: offer.url, image_link: "assets/og-default.jpg", availability: "in stock", price: "0 USD", custom_label_0: "lead generation service" })),
    wellKnownPagehub: { version: "pagehub-build-packet-v1", siteName, canonical: baseUrl, source: "Woodward/PageHub intake compiler", requiredPublicChecks: ["no builder badge", "public WSS/WSS URL", "favicon", "OG image", "Resend form", "Google Maps inlay"] },
    sitemapsByName
  };
}

function templateVarietyContractForPacket(packet = {}) {
  if (packet.compiled?.templateVarietyContract) return packet.compiled.templateVarietyContract;
  const selectedId = packet.selectedTemplateId || packet.compiled?.manifest?.selectedTemplateId || "auto";
  const roles = {
    auto: ["Rotation selector", "Pick the least recently used high-fit template shape after source facts and assets are compiled."],
    "gold-premier-motion": ["Premium local authority", "Multi-page cinematic hero, trust blocks, service authority pages, map/form conversion rail."],
    "single-cinematic-motion": ["One-page wow scroll", "Strong first viewport, animated media depth, compressed services/proof/map/form in one polished scroll."],
    "single-gallery-first": ["Photo proof showcase", "Image-led one-page layout where real work photos drive trust, proof, service cards, and social preview."],
    "single-quote-conversion": ["Lead-first quote funnel", "Fast conversion scroll with sticky call/text, custom quote widget, concise proof, and service-area reinforcement."],
    "premier-map-service-area": ["Service-area authority hub", "Map-first authority site with city/county markers, local internal links, and dedicated area content."],
    "premier-trust-credentials": ["Credential and proof authority", "Trust-heavy premier site with logos/badges, training/certification proof, reviews, gallery, and service content."]
  };
  const [role, visualShape] = roles[selectedId] || roles.auto;
  return {
    version: "template-variety-contract-v1",
    status: selectedId === "auto" ? "review" : "pass",
    selectedTemplateId: selectedId,
    selectedTemplateName: packet.selectedTemplateName || packet.compiled?.manifest?.selectedTemplateName || "",
    family: packet.selectedBuildLane || packet.compiled?.manifest?.templateFamily || "",
    archetype: {
      role,
      visualShape,
      cinematicMustKeep: ["hero composition and motion primitives", "section rhythm and scroll reveal behavior", "widget/lead-funnel shell", "gallery/proof treatment", "map/form placement", "mobile sticky CTA behavior"],
      requiredPacketInputs: ["complete client facts", "content route map", "SEO/entity files", "asset QA", "hero contract", "forms/Resend contract", "map SDK contract"]
    },
    rotationPolicy: "Use varied shapes across client builds. Do not default every client to the same premier shell.",
    visualQualityRules: ["Default public site mode should be light unless explicitly required dark.", "Hero should be about 10% lighter/clearer than the dark master while preserving contrast.", "Use real client assets first.", "Logo backgrounds must be cleaned or matted.", "Credential/trust logos should appear beside source-supported proof text."],
    missing: selectedId === "auto" ? ["final template shape should be confirmed or auto-rotated before handoff"] : []
  };
}

function templateVarietyMarkdown(packet = {}) {
  const contract = templateVarietyContractForPacket(packet);
  return [
    `# Template Variety Contract - ${packet.business?.businessName || packet.packetName || "Client"}`,
    "",
    `Status: ${contract.status}`,
    `Selected template: ${contract.selectedTemplateName || "Auto"} (${contract.family || "Auto"})`,
    `Archetype: ${contract.archetype?.role || "Rotation selector"}`,
    "",
    "## Visual Shape",
    contract.archetype?.visualShape || "Use best-fit template shape.",
    "",
    "## Cinematic Must Keep",
    ...((contract.archetype?.cinematicMustKeep || []).map(item => `- ${item}`)),
    "",
    "## Required Packet Inputs",
    ...((contract.archetype?.requiredPacketInputs || []).map(item => `- ${item}`)),
    "",
    "## Visual Quality Rules",
    ...((contract.visualQualityRules || []).map(item => `- ${item}`)),
    "",
    "## Missing / Review",
    ...((contract.missing || []).length ? contract.missing.map(item => `- ${item}`) : ["- None"])
  ].join("\n");
}

function brandAssetGenerationForPacket(packet = {}) {
  return packet.compiled?.brandAssetGeneration || {
    version: "brand-asset-generation-v1",
    status: "review",
    requiredOutputs: ["logo-light.webp", "logo-dark.webp", "logo-transparent.webp", "favicon.ico", "favicon.png", "apple-touch-icon.png", "og-default.jpg", "hero-poster.webp", "hero-mobile.webp"],
    logoCleanupRules: ["Remove screenshot, white-box, or ugly background when possible.", "If transparent extraction is risky, place logo on an intentional matte or glass tile.", "Create separate light/dark variants and test header contrast."],
    heroRules: ["Cinematic first viewport using template motion.", "Hero should be 10% lighter/clearer than the dark master.", "Use uploaded/Drive/source photo first; use generated hero only when allowed and documented."],
    credentialLogoRules: ["Use recognizable logos/icons beside source-supported credentials.", "Do not invent credentials or use logos for unsupported claims."],
    reviewItems: []
  };
}

function brandAssetGenerationMarkdown(packet = {}) {
  const plan = brandAssetGenerationForPacket(packet);
  return [`# Brand Asset Generation - ${packet.business?.businessName || packet.packetName || "Client"}`, "", `Status: ${plan.status}`, "", "## Required Outputs", ...(plan.requiredOutputs || []).map(item => `- ${item}`), "", "## Logo Cleanup Rules", ...(plan.logoCleanupRules || []).map(item => `- ${item}`), "", "## Hero Rules", ...(plan.heroRules || []).map(item => `- ${item}`), "", "## Credential Logo Rules", ...(plan.credentialLogoRules || []).map(item => `- ${item}`)].join("\n");
}

function securityHardeningForPacket(packet = {}) {
  return packet.compiled?.securityHardening || {
    version: "security-hardening-v1",
    status: "pass",
    publicExportPolicy: "Public/operator dashboard users can compile and Send To Admin only. Raw ZIP/export files stay admin-only.",
    secretsPolicy: ["Resend API key stays server-side.", "Google Places key stays server-side.", `${MAP_SDK_CONNECTOR_ENV} is the only browser Maps key expected in the published site.`, "Do not expose raw Gmail/Drive tokens or admin destinations in public UI."],
    formPolicy: ["Validate lead payloads server-side.", "Include honeypot and sane length limits.", "Route lead notifications through the shared WSS Resend connector."],
    residuePolicy: ["Remove old template business names, phones, addresses, images, schema, OG metadata, map coordinates, and hidden constants.", "Remove/hide builder badges before client completion.", "No client-facing unpublished builder preview URLs in completion email."]
  };
}

function securityHardeningMarkdown(packet = {}) {
  const plan = securityHardeningForPacket(packet);
  return [`# Security And Export Hardening - ${packet.business?.businessName || packet.packetName || "Client"}`, "", `Status: ${plan.status}`, `Public export policy: ${plan.publicExportPolicy}`, "", "## Secrets Policy", ...(plan.secretsPolicy || []).map(item => `- ${item}`), "", "## Form Policy", ...(plan.formPolicy || []).map(item => `- ${item}`), "", "## Residue Policy", ...(plan.residuePolicy || []).map(item => `- ${item}`)].join("\n");
}

function postPublishValidationForPacket(packet = {}) {
  return packet.compiled?.postPublishValidation || {
    version: "post-publish-validation-v1",
    status: "ready",
    urlPolicy: "Completion emails must use public WSS/WSS URLs only. Do not include unpublished builder preview URLs.",
    requiredBeforeClientEmail: true,
    checks: [
      { id: "wss-domain", label: "Published URL is a .wss-ai.com domain", required: true },
      { id: "badge-hidden", label: "Builder badge is removed or hidden", required: true },
      { id: "favicon-og", label: "Favicon, Apple touch icon, OG image, Twitter card, canonical, and title/description are client-specific", required: true },
      { id: "forms-resend", label: "Contact/quote form submits through shared Resend route with success/error states", required: true },
      { id: "map-inlay", label: `Google Maps inlay uses ${MAP_SDK_CONNECTOR_ENV}, mapId ${MAP_SDK_MAP_ID}, AdvancedMarkerElement, service-area circle, and city markers/fallback`, required: true },
      { id: "seo-assets", label: "answer-engine.json, entity.json, local-business.jsonld, locations.geojson, geo.kml, and sitemaps are present", required: true }
    ],
    smokeTests: ["Desktop first viewport screenshot", "Mobile first viewport screenshot", "Click call/text/primary CTA", "Submit test form payload through Resend route", "Open map and directions links", "Fetch favicon/OG/canonical", "Fetch sitemap-index.xml and local-business.jsonld", "Search page source for old-template residue"]
  };
}

function postPublishValidationMarkdown(packet = {}) {
  const plan = postPublishValidationForPacket(packet);
  return [`# Post-Publish Validation - ${packet.business?.businessName || packet.packetName || "Client"}`, "", `Status: ${plan.status}`, `URL policy: ${plan.urlPolicy}`, `Required before client email: ${plan.requiredBeforeClientEmail ? "yes" : "no"}`, "", "## Checks", ...(plan.checks || []).map(item => `- [ ] ${item.label}${item.required ? " (required)" : ""}`), "", "## Smoke Tests", ...(plan.smokeTests || []).map(item => `- ${item}`)].join("\n");
}

function collectSameAs(packet = {}, business = {}) {
  return unique(splitLinesLocal(business.socialUrl, business.gbpLink, packet.sources?.social, packet.sources?.urls)
    .filter(url => /^https?:\/\//i.test(String(url)) && /facebook|instagram|tiktok|youtube|linkedin|x\.com|twitter|yelp|bbb|nextdoor|google\.com\/maps|maps\.apple/i.test(String(url))));
}

function normalizeSiteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
}

function absoluteSiteUrl(baseUrl, route = "/") {
  const base = normalizeSiteUrl(baseUrl);
  const cleanRoute = `/${String(route || "/").replace(/^\/+/, "")}`.replace(/\/$/, "") || "/";
  return base ? `${base}${cleanRoute === "/" ? "/" : cleanRoute}` : cleanRoute;
}

function geoFeatures(business, mapContract, baseUrl) {
  const features = [];
  if (mapContract.geo?.verified) {
    features.push({ type: "Feature", properties: { name: business.businessName || "Business", kind: "business", url: baseUrl || "" }, geometry: { type: "Point", coordinates: [mapContract.geo.lng, mapContract.geo.lat] } });
  }
  Object.entries(mapContract.cityCoordinatePlan?.coords || {}).forEach(([name, coords]) => {
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

function localPresencePlanForPacket(packet = {}) {
  if (packet.compiled?.localPresencePlan) return packet.compiled.localPresencePlan;
  const business = packet.business || {};
  const searchPlan = searchOptimizationPlanForPacket(packet);
  const socialLinks = collectSocialLinksForPacket(packet);
  const mapAndDirections = buildMapAndDirectionsForPacket(business);
  const requiredCtas = buildRequiredCtasForPacket(packet, mapAndDirections, socialLinks);
  const pagePlan = packet.pagePlan || [];
  return {
    version: "local-presence-conversion-v1",
    status: "compiled-fallback",
    generatedAt: packet.createdAt || new Date().toISOString(),
    businessIdentity: {
      name: business.businessName || "",
      phone: business.phone || "",
      smsNumber: business.smsNumber || "",
      email: business.email || "",
      address: business.address || "",
      serviceArea: business.serviceArea || "",
      hours: business.hours || "",
      hoursSource: business.hoursSource || "",
      mapMode: business.mapMode || packet.requirements?.mapMode || "Needs review",
      gbpLink: business.gbpLink || "",
      gbpPlaceId: business.gbpPlaceId || "",
      publicAddressPolicy: mapAndDirections.publicAddressPolicy
    },
    mapAndDirections,
    mapSdkContract: mapSdkContractForPacket(packet),
    socialLinks,
    ctaMigration: {
      requiredCtas,
      financeAndPaymentPolicy: /financ|payment|snap|affirm|klarna|afterpay|zero\s*down|100[-\s]?day|lease|billing/i.test([
        business.mainServices,
        business.exactServices,
        packet.requirements?.mustInclude,
        packet.requirements?.marketingPlan,
        packet.sources?.meetingNotes
      ].filter(Boolean).join(" "))
        ? "Finance/payment CTAs may be included only from source-supported text or URLs. Do not invent APR, approval, warranty, price, or financing claims."
        : "Do not add financing/payment CTAs unless source evidence appears in Gmail, Drive, GBP, or the public website.",
      galleryAndInventoryPolicy: "Use source-supported gallery, current inventory, product, or photo URLs when available. Client/Drive/GBP assets win before stock or generated imagery.",
      reviewPolicy: business.gbpPlaceId ? "Use Google review CTA from Place ID where appropriate." : "Use review CTAs only from verified public source URLs."
    },
    internalLinkStrategy: {
      requiredLinks: buildLocalInternalLinksForPacket(pagePlan, searchPlan),
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
      sameAs: socialLinks.map(item => item.url)
    },
    qaGates: [
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

function localPresenceMarkdown(packet = {}) {
  const plan = localPresencePlanForPacket(packet);
  const mapContract = mapSdkContractForPacket(packet);
  return [
    `# Local Presence, Conversion, Maps, Social, And Theme Plan - ${packet.business?.businessName || packet.packetName || "Client"}`,
    "",
    "This file is required before WSS plans or builds. It exists to avoid a second prompt for maps, social links, CTAs, internal links, and header/theme polish.",
    "",
    "## Map And Directions",
    `- Public address policy: ${plan.mapAndDirections?.publicAddressPolicy || "Needs review"}`,
    `- Google Maps/search: ${plan.mapAndDirections?.googleMapsSearchUrl || "Needs review"}`,
    `- Google directions: ${plan.mapAndDirections?.googleDirectionsUrl || "Needs review"}`,
    `- Apple Maps: ${plan.mapAndDirections?.appleMapsUrl || "Needs review"}`,
    `- Apple directions: ${plan.mapAndDirections?.appleDirectionsUrl || "Needs review"}`,
    `- Google review URL: ${plan.mapAndDirections?.googleReviewUrl || "Needs review"}`,
    `- Map embed policy: ${plan.mapAndDirections?.mapEmbedPolicy || "Needs review"}`,
    "",
    "## Maps SDK Contract",
    `- Required file: MAP-SDK-CONTRACT.md`,
    `- Connector env: ${mapContract.connector?.env || MAP_SDK_CONNECTOR_ENV}`,
    `- Map ID: ${mapContract.mapId || MAP_SDK_MAP_ID}`,
    `- SDK status: ${mapContract.status}`,
    `- Geo verified: ${mapContract.geo?.verified ? "yes" : "no"}`,
    `- Service radius: ${mapContract.serviceRadiusMiles || "Needs review"} miles`,
    `- City markers compiled: ${Object.keys(mapContract.cityCoordinatePlan?.coords || {}).length}`,
    `- Missing city coords: ${(mapContract.cityCoordinatePlan?.missing || []).join(", ") || "None"}`,
    "",
    "## Source-Backed Social / sameAs",
    ...((plan.socialLinks || []).length ? plan.socialLinks.map(item => `- ${item.platform}: ${item.url}`) : ["- No verified social links in packet; inspect Gmail/GBP/website before adding sameAs."]),
    "",
    "## Required CTA Migration",
    ...((plan.ctaMigration?.requiredCtas || []).length ? plan.ctaMigration.requiredCtas.map(item => `- ${item.type}: ${item.label} -> ${item.url}`) : ["- Needs review"]),
    `- Finance/payment policy: ${plan.ctaMigration?.financeAndPaymentPolicy || "Source-supported only."}`,
    `- Gallery/inventory policy: ${plan.ctaMigration?.galleryAndInventoryPolicy || "Source-supported only."}`,
    "",
    "## Internal Link Strategy",
    ...((plan.internalLinkStrategy?.requiredLinks || []).slice(0, 30).map(item => `- ${item.from} -> ${item.to}: ${item.anchor} (${item.purpose})`)),
    "",
    "## Light/Dark Theme Contract",
    `- Top header: ${plan.themeContract?.topHeader || "Required"}`,
    `- Logo variants: ${(plan.themeContract?.logoVariants || []).join("; ")}`,
    `- Contrast: ${plan.themeContract?.contrast || "Required"}`,
    `- Sticky/header behavior: ${plan.themeContract?.stickyBehavior || "Required"}`,
    "",
    "## Schema Requirements",
    `- LocalBusiness fields: ${(plan.schemaRequirements?.localBusiness || []).join(", ")}`,
    `- Address policy: ${plan.schemaRequirements?.addressPolicy || "Needs review"}`,
    `- Geo policy: ${plan.schemaRequirements?.geoPolicy || "Do not invent coordinates."}`,
    "",
    "## QA Gates",
    ...((plan.qaGates || []).map(gate => `- ${gate}`))
  ].join("\n");
}

function localPresenceSummaryLines(packet = {}) {
  const plan = localPresencePlanForPacket(packet);
  const mapContract = mapSdkContractForPacket(packet);
  return [
    `- Local presence status: ${plan.status || "compiled"}`,
    `- Google directions: ${plan.mapAndDirections?.googleDirectionsUrl || "Needs review"}`,
    `- Apple Maps: ${plan.mapAndDirections?.appleMapsUrl || "Needs review"}`,
    `- Maps SDK: ${mapContract.status || "Needs review"} using ${mapContract.connector?.env || MAP_SDK_CONNECTOR_ENV} and mapId ${mapContract.mapId || MAP_SDK_MAP_ID}`,
    `- Social links: ${(plan.socialLinks || []).length}`,
    `- Required CTAs: ${(plan.ctaMigration?.requiredCtas || []).length}`,
    "- Required file: LOCAL-PRESENCE-CONVERSION-PLAN.md"
  ];
}

function buildMapAndDirectionsForPacket(business = {}) {
  const name = business.businessName || "Local business";
  const address = String(business.address || "").trim();
  const serviceArea = String(business.serviceArea || "").trim();
  const placeId = String(business.gbpPlaceId || business.googlePlaceId || business.placeId || "").trim();
  const mapMode = String(business.mapMode || "").trim();
  const hasAddressPin = /address|pin|office|showroom|store|visit/i.test(mapMode) && address;
  const query = [name, hasAddressPin ? address : serviceArea].filter(Boolean).join(" ");
  const destination = hasAddressPin ? address : query;
  const encodedQuery = encodeURIComponent(query || name);
  const encodedDestination = encodeURIComponent(destination || query || name);
  const googleMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ""}`;
  const googleDirectionsUrl = business.googleDirectionsUrl || business.directionsUrl || `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ""}`;
  const appleMapsUrl = `https://maps.apple.com/?q=${encodedQuery}`;
  const appleDirectionsUrl = business.appleDirectionsUrl || `https://maps.apple.com/?daddr=${encodedDestination}`;
  return {
    publicAddressPolicy: hasAddressPin
      ? "Show verified address pin and directions CTA."
      : serviceArea
        ? "Use service-area/local coverage block; do not expose an exact address pin unless verified."
        : "Location needs review before map embed.",
    googleBusinessUrl: business.gbpLink || "",
    googlePlaceId: placeId,
    googleMapsSearchUrl,
    googleDirectionsUrl,
    googleReviewUrl: placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : (business.gbpLink || ""),
    appleMapsUrl,
    appleDirectionsUrl,
    geo: parseGeoFromBusiness(business),
    serviceRadiusMiles: parseServiceRadiusMiles(business).miles,
    mapEmbedPolicy: hasAddressPin || placeId
      ? "Embed/use verified Google Business or Maps place only. Never leave an old template embed."
      : "Prefer service-area map/list block over exact map embed until a verified public address or Place ID is provided.",
    schemaAddressPolicy: hasAddressPin
      ? "Use PostalAddress only from verified address."
      : "For service-area businesses, avoid publishing a precise PostalAddress unless the packet explicitly approves it."
  };
}

function collectSocialLinksForPacket(packet = {}) {
  const urls = unique([
    packet.business?.socialUrl,
    packet.requirements?.socialUrl,
    ...(packet.sources?.urls || []),
    ...(packet.sources?.social || [])
  ]).filter(url => /^https?:\/\//i.test(String(url)) && /facebook|instagram|tiktok|youtube|linkedin|x\.com|twitter|yelp|bbb|nextdoor|linktr\.ee|maps\.apple|google\.com\/maps/i.test(String(url)));
  return urls.map(url => ({ platform: socialPlatform(url), url, use: /google\.com\/maps|maps\.app\.goo\.gl/i.test(url) ? "map/source evidence" : "sameAs/social CTA" }));
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

function buildRequiredCtasForPacket(packet, mapAndDirections, socialLinks) {
  const business = packet.business || {};
  const brand = packet.brand || {};
  const ctas = [];
  if (business.phone) ctas.push({ type: "call", label: "Call Now", url: `tel:${String(business.phone).replace(/[^\d+]/g, "")}`, required: true });
  if (business.smsNumber || business.phone) ctas.push({ type: "text", label: "Text Us", url: `sms:${String(business.smsNumber || business.phone).replace(/[^\d+]/g, "")}`, required: false });
  if (business.email) ctas.push({ type: "email", label: "Email", url: `mailto:${business.email}`, required: false });
  if (mapAndDirections.googleDirectionsUrl) ctas.push({ type: "google-directions", label: "Directions", url: mapAndDirections.googleDirectionsUrl, required: true });
  if (mapAndDirections.appleMapsUrl) ctas.push({ type: "apple-maps", label: "Open In Apple Maps", url: mapAndDirections.appleDirectionsUrl || mapAndDirections.appleMapsUrl, required: true });
  if (mapAndDirections.googleReviewUrl) ctas.push({ type: "google-review", label: "Review Us On Google", url: mapAndDirections.googleReviewUrl, required: false });
  if (brand.galleryLink) ctas.push({ type: "gallery", label: "View Gallery", url: brand.galleryLink, required: false });
  socialLinks.forEach(link => ctas.push({ type: `social-${slugify(link.platform)}`, label: link.platform, url: link.url, required: false }));
  return ctas;
}

function buildLocalInternalLinksForPacket(pagePlan = [], searchPlan = {}) {
  const pages = pagePlan.map(page => ({ title: page.title || "Page", slug: page.slug || "" }));
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

function splitLinesLocal(...values) {
  const rows = [];
  values.flat(Infinity).forEach(value => {
    if (!value) return;
    String(value).split(/\n|,|;|\|/).map(item => item.trim()).filter(Boolean).forEach(item => rows.push(item));
  });
  return rows;
}

function keywordWithMarket(service, market) {
  const cleanService = String(service || "local service").replace(/\s+/g, " ").trim();
  const cleanMarket = String(market || "").replace(/\s+/g, " ").trim();
  if (!cleanMarket || new RegExp(`\\b${escapeRegExp(cleanMarket)}\\b`, "i").test(cleanService)) return cleanService;
  return `${cleanService} ${cleanMarket}`.trim();
}

function inferSearchIntent(title) {
  if (/contact|quote|estimate/i.test(title)) return "conversion";
  if (/service area|location|near/i.test(title)) return "local discovery";
  if (/review|why|about|proof/i.test(title)) return "trust proof";
  return "service authority";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function manifestCsv(packet) {
  const rows = [["type", "value", "note"]];
  (packet.sources?.urls || []).forEach(url => rows.push(["source", url, "public source"]));
  (packet.sources?.logos || []).forEach(url => rows.push(["logo", typeof url === "string" ? url : url.url, "candidate"]));
  (packet.sources?.images || []).forEach(item => rows.push(["image", typeof item === "string" ? item : item.url, typeof item === "string" ? "" : item.alt || item.role || "candidate"]));
  (packet.sources?.palette || []).forEach(item => rows.push(["color", item.hex, `${item.rgb || ""}; ${item.cmyk || ""}`]));
  return rows.map(row => row.map(cell => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function qaChecklist(packet) {
  return [
    "# QA Checklist",
    "",
    "- Confirm business name, phone, email, and service area.",
    "- Confirm hours of operation and where those hours came from.",
    "- Confirm Google Business Profile ID or Place ID when a Google listing is provided.",
    "- Confirm logo, favicon, and visible brand color swatches.",
    "- Confirm photo permission and image source rules.",
    "- Confirm forms route to the correct recipient.",
    "- Confirm map mode and public address rule.",
    "- Confirm required pages and service sections.",
    "- Confirm GEO-VOICE-LOCAL-SEARCH-PLAN.md was read before building.",
    "- Confirm attached Bright Data audit/query-plan artifacts were used first, or Firecrawl/search fallback was disclosed.",
    "- Confirm primary, secondary, local, GEO, and voice-search targets are mapped to visible pages, FAQ/schema, internal links, and CTAs.",
    "- Confirm LOCAL-PRESENCE-CONVERSION-PLAN.md was read before building.",
    "- Confirm Google Maps, Google directions, Apple Maps, map embed policy, GBP/Place ID, and review CTA match this client only.",
    "- Confirm social links, sameAs schema, finance/payment/gallery/current-inventory CTAs, call/text/email, and internal links are implemented in the first pass when source-supported.",
    "- Confirm light/dark header, logo variants, hero contrast, sticky/utility CTAs, and mobile nav readability.",
    "- Confirm tracking, launch, compliance, and domain notes.",
    "- Confirm no unsupported claims are present.",
    "",
    `Readiness score at export: ${packet.readiness?.score || 0}/100`,
    "",
    "Review items:",
    ...((packet.readiness?.blockers || []).length ? packet.readiness.blockers.map(item => `- ${item}`) : ["- None"])
  ].join("\n");
}

function objectLines(obj) {
  return Object.entries(obj || {}).map(([key, value]) => `- ${labelFor(key)}: ${value || ""}`);
}

function labelFor(field) {
  return String(field || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, chr => chr.toUpperCase());
}

function slugify(value) {
  return String(value || "client-intake")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "client-intake";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
