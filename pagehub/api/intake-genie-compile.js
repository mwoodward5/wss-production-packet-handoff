"use strict";

module.exports.config = { maxDuration: 300 };

const { createHash, timingSafeEqual } = require("node:crypto");
const firecrawlIntake = require("./firecrawl-intake");
const buildPacketCompiler = require("./compile-build-packet");
const { intakeQuality } = firecrawlIntake;

const VERSION = "intake-genie-v2";
const PACKET_VERSION = "2.0";
const REQUIRED_FACTS = ["name", "city", "state", "category"];
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 64;
const PATH_SCOPED_EVIDENCE_HOSTS = Object.freeze([
  "wixsite.com", "square.site", "notion.site", "linktr.ee", "bio.site", "canva.site",
  "youtube.com", "tiktok.com",
]);
const LEGAL_NAME_SUFFIXES = new Set([
  "and", "co", "company", "corp", "corporation", "inc", "incorporated", "llc", "llp",
  "lp", "ltd", "limited", "pa", "pc", "plc", "pllc",
]);
const DOTTED_LEGAL_SUFFIXES = Object.freeze([
  ["p", "l", "l", "c"], ["l", "l", "c"], ["l", "l", "p"], ["i", "n", "c"],
  ["l", "t", "d"], ["c", "o"], ["l", "p"], ["p", "a"], ["p", "c"],
]);
const HVAC_NAME_TOKEN_ALIASES = Object.freeze({
  // `A/C` and `A.C.` are compacted to `ac` by canonicalBusinessTokens. Keep
  // this expansion category-gated because AC is also a valid set of initials.
  ac: Object.freeze(["air", "conditioning"]),
});
const PRODUCT_ONLY_CATEGORY_PATTERN = /\b(?:supplier|retailer|wholesaler|distributor|manufacturer|dealership|materials? store|equipment store)\b/;
const US_STATE_NAMES = Object.freeze({
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas",
  ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts",
  mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico",
  ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  dc: "district of columbia",
});
const CATEGORY_DEFAULT_SERVICES = Object.freeze({
  "attorney": ["Legal services", "Legal consultations", "Legal support"],
  "auto detailing": ["Auto detailing services", "Exterior detailing", "Interior detailing"],
  "barber": ["Barber services", "Haircut services", "Grooming consultations"],
  "cleaning": ["Cleaning services", "Routine cleaning", "Cleaning consultations"],
  "concrete": ["Concrete services", "Concrete installation", "Concrete repair"],
  "dental": ["Dental services", "Dental care", "Dental consultations"],
  "electrical": ["Electrical services", "Electrical repair", "Electrical installation"],
  "event vendor": ["Event vendor services", "Event consultations", "Event support"],
  "excavation": ["Excavation services", "Excavation planning", "Site excavation"],
  "fencing": ["Fencing services", "Fence installation", "Fence repair"],
  "flooring contractor": ["Flooring services", "Flooring installation", "Flooring repair"],
  "garage door": ["Garage door services", "Garage door repair", "Garage door installation"],
  "general contracting": ["General contracting services", "Construction planning", "Project coordination"],
  "hair salon": ["Hair salon services", "Hair services", "Hair consultations"],
  "hvac": ["HVAC services", "HVAC repair", "HVAC installation"],
  "landscaping": ["Landscaping services", "Landscape maintenance", "Landscape installation"],
  "massage": ["Massage services", "Massage sessions", "Massage consultations"],
  "masonry": ["Masonry services", "Masonry installation", "Masonry repair"],
  "med spa": ["Med spa services", "Aesthetic consultations", "Skin care services"],
  "nail studio": ["Nail studio services", "Nail care services", "Nail consultations"],
  "painting": ["Painting services", "Interior painting", "Exterior painting"],
  "pest control": ["Pest control services", "Pest inspections", "Pest treatment"],
  "photographer": ["Photography services", "Photo sessions", "Photography consultations"],
  "piercing": ["Piercing services", "Piercing consultations", "Piercing care guidance"],
  "plumbing": ["Plumbing services", "Plumbing repair", "Plumbing installation"],
  "pool service": ["Pool services", "Pool maintenance", "Pool repair"],
  "pressure washing service": ["Pressure washing services", "Exterior surface cleaning", "Pressure washing consultations"],
  "real estate agent": ["Real estate services", "Real estate consultations", "Property guidance"],
  "roofing": ["Roofing services", "Roof repair", "Roof installation"],
  "solar": ["Solar services", "Solar consultations", "Solar installation"],
  "tattoo studio": ["Tattoo studio services", "Tattoo consultations", "Tattoo design services"],
  "tree care": ["Tree care services", "Tree maintenance", "Tree care consultations"],
  "water damage restoration": ["Water damage restoration services", "Water damage cleanup", "Restoration consultations"],
  "wedding vendor": ["Wedding vendor services", "Wedding consultations", "Wedding support"],
});
const CATEGORY_ALIASES = Object.freeze([
  ["auto detailing", /\b(auto|car|mobile) detail|ceramic coat/],
  ["med spa", /\bmed(?:ical)? spa|aesthetic|injectable|botox/],
  ["tattoo studio", /\btattoo/], ["nail studio", /\bnail/], ["hair salon", /\b(?:beauty|hair) salon\b|^salon$|hairstyl/],
  ["garage door", /\bgarage door|overhead door/],
  ["pest control", /\bpest|extermin|termite/], ["pool service", /\bpool|hot tub/],
  ["tree care", /\btree|arborist|stump/],
  ["wedding vendor", /\b(?:wedding|bridal) (?:vendor|vendors|planner|planning|coordinator|coordination)\b/],
  ["event vendor", /\bevent (?:vendor|vendors|planner|planning|coordinator|coordination)\b/],
  ["real estate agent", /\brealtors?\b|\breal estate (?:agent|agents|agency|broker|brokers)\b|\brealty\b/],
  ["photographer", /\bphotograph/], ["attorney", /\battorney|lawyer|law firm|legal service/],
  ["electrical", /\belectric/], ["landscaping", /\blandscap|lawn|hardscap/],
  ["plumbing", /\bplumb|drain service/], ["roofing", /\broof/], ["hvac", /\bhvac|heating and air|air condition/],
  ["water damage restoration", /\bwater damage\b|\bflood restoration\b/],
  ["pressure washing service", /\b(?:pressure|power) wash/],
  ["flooring contractor", /\bflooring\b|\bfloor installer/],
  ["masonry", /\bmasonry\b|\bmason\b/],
  ["concrete", /\bconcrete/], ["fencing", /\bfenc/], ["painting", /\bpaint/],
  ["solar", /\bsolar|photovoltaic/], ["cleaning", /\bclean(?:ing|er|ers)?\b|janitorial|maid/],
  ["excavation", /\bexcavat|grading|trenching/], ["massage", /\bmassage|bodywork/],
  ["dental", /\bdental|dentist|orthodont/], ["barber", /\bbarber/], ["piercing", /\bpierc/],
  ["general contracting", /\bgeneral contract|\bconstruction|carpent|remodel|renovat/],
]);
const TRANSPORT_REQUEST_KEYS = new Set(["request_id", "mode", "dry_run", "build_preview"]);
const VOLATILE_HASH_KEYS = new Set([
  "createdAt",
  "compiledAt",
  "generatedAt",
  "finalizedAt",
  "updatedAt",
  "generated_at",
  "compiled_at",
  "created_at",
]);
const DIRECT_TEMPLATE_FAMILIES = Object.freeze({
  auto: "",
  "gold-premier-motion": "Multi-page premier",
  "single-cinematic-motion": "Single-page cinematic scroll",
  "single-gallery-first": "Single-page cinematic scroll",
  "single-quote-conversion": "Single-page cinematic scroll",
  "premier-map-service-area": "Multi-page premier",
  "premier-trust-credentials": "Multi-page premier",
});

// A heading that routes a visitor around a site is not a service the business
// sells.  This filter is deliberately whole-label/phrase based so it cannot
// erase real work such as "Community Fence Installation".  Rejected labels
// are treated as absence, not as an unverified claim: a separately supported
// category may still use the honest estimated category-default path.
const NON_SERVICE_HEADING = /^(?:home|about(?:\s+us)?|reviews?|testimonials?|faqs?|frequently\s+asked\s+questions|service\s+areas?|areas\s+we\s+serve|contact(?:\s+us)?|financing|blog|news|resources?|community\s+(?:links?|resources?)|(?:useful\s+)?links?(?:\s+for\s+(?:your\s+)?community)?|gallery|portfolio|our\s+work|photos?|videos?|book(?:\s+now)?|schedule(?:\s+now|\s+service)?|request\s+(?:a\s+)?(?:quote|estimate|service)|get\s+in\s+touch|privacy(?:\s+policy)?|terms|sitemap)$/i;

function serviceSemanticReason(value) {
  const name = clean(value).replace(/[.:;]+$/, "").trim();
  if (name && NON_SERVICE_HEADING.test(name)) return "navigation_or_resource_heading";
  if (/©|all rights reserved|^tell us about\b|^one (?:trained|dedicated)\b|\b(?:advantage|questions?,? answered|advice for)\b|\bservices? in [A-Z][a-z]+\b|\b(?:care|landscaping) in [A-Z][a-z]+\b|\.[ ]+one company\b/i.test(name))
    return "editorial_or_promotion_heading";
  if (/^(?:we(?:['’]re| are| love| believe| provide| offer)\b|for (?:a|an|the)\b|the best\b)|\bcompany in (?:[A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/i.test(name))
    return "promotional_sentence_or_fragment";
  // Harvesters sometimes return article titles as services. These sentences
  // describe editorial content, not an offering, even when they occur on a
  // first-party page alongside the site's real service navigation.
  if (/^(?:\d+\s+(?:steps?|things?|tips?|ways?|reasons?|myths?|chores?|issues?|items?|essential|easy|simple|pro|best|top)\b|myth\s*#?\d+\b|(?:how|why|when|what)\b|reasons?\s+to\b|(?:mow|grow|water)\s+your\s+way\b)/i.test(name)
    || /\b(?:myths?\s+busted|myths?$|tips?\s+for|things?\s+you\s+must|will\s+impress\s+your\s+neighbors)\b/i.test(name))
    return "editorial_heading";
  return intakeQuality.serviceLabel(name) ? "" : "not_a_business_service_label";
}

function semanticServices(values) {
  return uniqueStrings(lines(values)).filter(value => !serviceSemanticReason(value)).slice(0, 24);
}

function serviceLandingObservation(observation, service, anchor = "") {
  try {
    const observedUrl = new URL(observation?.source || "");
    const path = observedUrl.pathname.replace(/\/+$/, "") || "/";
    const anchorUrl = anchor ? new URL(anchor) : null;
    const anchorPath = anchorUrl ? (anchorUrl.pathname.replace(/\/+$/, "") || "/") : "/";
    if (path === anchorPath) return true;
    const relativePath = anchorPath !== "/" && path.startsWith(anchorPath + "/")
      ? path.slice(anchorPath.length) : path;
    if (/^\/(?:blog|blogs|articles?|news|resources?|guides?|category|tag)(?:\/|$)/i.test(relativePath)) return false;
    if (anchorUrl && /(?:^|\.)(?:square\.site|wixsite\.com|youtube\.com)$/.test(anchorUrl.hostname)
      && path.startsWith(anchorPath + "/")) return true;
    if (path === "/" || /^\/(?:services?|our-services)(?:\/|$)/i.test(path)) return true;
    const leaf = path.split("/").filter(Boolean).at(-1);
    return leaf === String(service).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  } catch { return false; }
}

function createHandler(dependencies = {}) {
  const harvestSources = dependencies.harvestSources
    || ((options) => firecrawlIntake.harvestSources(options));
  const compilePacket = dependencies.compilePacket
    || buildPacketCompiler.compileAuthenticatedHarvestPacket;
  const withBrandFonts = dependencies.withBrandFonts
    || buildPacketCompiler.withBrandFonts;
  const now = dependencies.now || (() => new Date().toISOString());
  const resultCache = dependencies.resultCache || new Map();
  const nowMs = dependencies.nowMs || (() => Date.now());

  return async function intakeGenieCompileHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    const healthRequest = isHealthRequest(req);
    if (healthRequest && req.method === "GET") {
      return res.status(200).json({
        ok: true,
        version: VERSION,
        configured: Boolean(process.env.INTAKE_GENIE_TOKEN && process.env.FIRECRAWL_API_KEY),
      });
    }
    if (healthRequest) {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, version: VERSION, error: "Health check uses GET." });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, version: VERSION, error: "Use POST." });
    }

    const expectedToken = String(process.env.INTAKE_GENIE_TOKEN || "").trim();
    if (!expectedToken) {
      return res.status(503).json({ ok: false, version: VERSION, error: "Intake Genie token is not configured." });
    }
    if (!authorized(req.headers?.authorization, expectedToken)) {
      return res.status(401).json({ ok: false, version: VERSION, error: "Unauthorized." });
    }

    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } catch {
      return res.status(400).json({ ok: false, version: VERSION, error: "Request body must be valid JSON." });
    }
    const requestedTemplate = clean(body.selectedTemplateId || body.selected_template_id);
    if (requestedTemplate && !Object.hasOwn(DIRECT_TEMPLATE_FAMILIES, requestedTemplate)) {
      return res.status(400).json({ ok: false, version: VERSION, error: "Unknown template selection." });
    }

    const requestedUrls = sourceUrls(body);
    const manualFallback = !requestedUrls.length && clean(body.intake_mode).toLowerCase() === "manual_fallback";
    if (!requestedUrls.length && !manualFallback) {
      return res.status(200).json({
        ok: true,
        version: VERSION,
        status: "needs_input",
        scope: { supported: true, message: "A public website, GBP, or social source URL is required." },
        facts: hintFacts(body),
        evidence: [],
        assets: [],
        missing_facts: ["source_url"],
        question: "Add the prospect's public website, GBP, or social URL before compiling.",
      });
    }

    const payloadHash = semanticRequestHash(body);
    const idempotencyKey = clean(req.headers?.["idempotency-key"] || body.request_id) || payloadHash;
    const cacheKey = `${idempotencyKey}:${payloadHash}`;
    let handledPromise = null;
    try {
      // Cached in-flight work must cross the same typed error boundary as the
      // request that started it. Otherwise a concurrent all-page failure leaks
      // a rejected promise instead of the retryable source_harvest_failed JSON.
      const cached = cachedResult(resultCache, cacheKey, nowMs());
      if (cached) {
        handledPromise = cached;
        const result = await cached;
        return res.status(httpStatusForCompileResult(result)).json(result);
      }

      const compilePromise = (async () => {
        // A manual fallback is a deliberate no-provider lane. The candidate's
        // structured fields remain hints and the compiler may use an explicitly
        // estimated category scaffold, but no source observation is invented.
        const harvest = manualFallback
          ? { ok: true, sources: [], notes: [], extracted: {}, observations: [], evidence: [] }
          : await harvestSources({
            urls: requestedUrls,
            apiKey: process.env.FIRECRAWL_API_KEY,
            evidence: requestEvidence(body),
          });
        if (!manualFallback && harvest?.ok !== true) {
          const error = new Error(clean(harvest?.error) || "Firecrawl failed to harvest every attempted public source page.");
          error.code = clean(harvest?.code) || "source_harvest_failed";
          error.retryable = harvest?.retryable !== false;
          error.statusCode = Number(harvest?.statusCode) || 503;
          error.coverage = object(harvest?.coverage);
          throw error;
        }
        return compileCanonicalPacket(body, harvest, { compilePacket, withBrandFonts, now });
      })();
      handledPromise = compilePromise;
      rememberResult(resultCache, cacheKey, compilePromise, nowMs());

      const result = await compilePromise;
      rememberResult(resultCache, cacheKey, Promise.resolve(result), nowMs());
      return res.status(httpStatusForCompileResult(result)).json(result);
    } catch (error) {
      // Do not let a late waiter delete a newer retry that already replaced
      // the rejected promise under the same semantic key.
      if (resultCache.get(cacheKey)?.promise === handledPromise) resultCache.delete(cacheKey);
      const missingProviderConfig = /Firecrawl key is not configured/i.test(error.message || "");
      return res.status(missingProviderConfig ? 503 : (error.statusCode || 500)).json({
        ok: false,
        version: VERSION,
        error: error.message || "Intake Genie compile failed.",
        ...(error.code ? { code: error.code } : {}),
        ...(error.retryable === true ? { retryable: true } : {}),
        ...(error.coverage ? { source_coverage: normalizeHarvestCoverage(error.coverage) } : {}),
      });
    }
  };
}

function compileCanonicalPacket(body, harvest, dependencies = {}) {
  const compilePacket = dependencies.compilePacket || buildPacketCompiler.compileAuthenticatedHarvestPacket;
  const withBrandFonts = dependencies.withBrandFonts || buildPacketCompiler.withBrandFonts;
  const now = dependencies.now || (() => new Date().toISOString());
  const extracted = object(harvest?.extracted);
  const sources = uniqueStrings(harvest?.sources || sourceUrls(body));
  const observations = normalizeObservations(harvest?.observations);
  const sourceCoverage = normalizeHarvestCoverage(harvest?.coverage, sources);
  const verifiedUrlEvidence = verifiedClaimEvidence(harvest?.evidence);
  const hints = requestHints(body);
  const corrections = object(body.corrections || body.conflict_resolution);
  const serviceState = serviceCertificationState(body, extracted, observations, verifiedUrlEvidence);
  const admittedVerifiedEvidence = serviceState.acceptedVerifiedEvidence || verifiedUrlEvidence;
  const values = factValues(body, extracted, hints, corrections, admittedVerifiedEvidence, serviceState);
  const selectedQuality = intakeQuality.facts({ ...values, businessName: values.name,
    gbpPlaceId: correctionValue(corrections.gbpPlaceId || corrections.place_id) || extracted.gbpPlaceId || extracted.placeId || "" });
  for (const field of ["email", "website", "phone", "address"]) values[field] = selectedQuality.data[field];
  values.name = selectedQuality.data.businessName;
  const warnings = [
    ...(!sources.length && clean(body.intake_mode).toLowerCase() === "manual_fallback"
      ? [{
        code: "manual_fallback_no_public_sources",
        field: "sources",
        values: [],
        message: "No public source URL was supplied. Candidate facts remain hints and service defaults remain explicitly estimated.",
      }]
      : []),
    ...serviceCertificationWarnings(serviceState),
  ];
  const problems = [
    ...selectedQuality.issues.map(issue => ({ code: "invalid_contact_or_identity_fact", field: issue.field,
      rule: issue.rule, message: "Malformed identity/contact value withheld; verify a replacement from an authoritative source." })),
    ...candidateCertificationProblems(hints, values),
    ...serviceCertificationProblems(values, serviceState),
  ];
  if (problems.length) {
    return {
      ok: false,
      version: VERSION,
      status: "refused",
      scope: {
        supported: true,
        message: "The compiled identity does not match the requested fresh candidate.",
      },
      request_id: clean(body.request_id),
      facts: values,
      private_review: { publication_policy: "private_review_only", rejected: selectedQuality.rejected, observations },
      evidence: admittedVerifiedEvidence.map(cloneJson),
      warnings,
      problems,
      missing_facts: [],
      question: "",
    };
  }
  const assets = observedAssets(extracted, sources, observations);
  const brand = brandContract(body, extracted, assets, observations, values.website);
  const selectedTemplateId = clean(body.selectedTemplateId || body.selected_template_id);
  const templateFamily = DIRECT_TEMPLATE_FAMILIES[selectedTemplateId] || "";
  const singlePage = /^single-/.test(selectedTemplateId);
  const selectedBuildLane = singlePage ? "Single-page scroll build" : "Premier multi-page authority hub";
  const pagePlan = singlePage ? [{ title: "Home", slug: "" }]
    : normalizePagePlan(body.pagePlan || body.page_plan);
  const exactServices = values.services;
  let buildServices = values.services_source === "category_default" ? [] : exactServices;
  const packetBase = {
    version: PACKET_VERSION,
    createdAt: now(),
    packetName: clean(body.packet_name || body.packetName) || `${values.name || "Prospect"} Intake Packet`,
    ...(selectedTemplateId && selectedTemplateId !== "auto" ? { selectedTemplateId, templateFamily } : {}),
    selectedBuildLane,
    pagePlan,
    assetQa: {
      status: "source_observations_require_downstream_provenance_check",
      logoCandidates: assets.filter(item => item.kind === "logo").map(item => item.url),
      imageCandidates: assets.filter(item => item.kind === "photo").map(item => item.url),
      duplicateGroups: [],
      ownershipVerified: false,
      truthLaw: "These are public-source URL observations only. The build lane must prove client ownership before use.",
    },
    productionLocks: [{
      key: "asset-provenance",
      status: "review",
      detail: "Observed logo and photo URLs require the downstream client-domain ownership gate before use.",
    }],
    sources: {
      urls: sources,
      notes: Array.isArray(harvest?.notes) ? harvest.notes : [],
      logos: assets.filter(item => item.kind === "logo"),
      images: assets.filter(item => item.kind === "photo"),
      social: values.socials,
      palette: brand.palette,
      extracted,
      observations,
      coverage: sourceCoverage,
      intakeRequest: cloneJson(body),
    },
    business: {
      businessName: values.name,
      contactName: clean(extracted.contactName),
      phone: values.phone,
      smsNumber: clean(extracted.smsNumber),
      email: values.email,
      gbpPlaceId: selectedQuality.data.gbpPlaceId,
      geoLat: values.latlng?.lat ?? "",
      geoLng: values.latlng?.lng ?? "",
      serviceRadiusMiles: clean(extracted.serviceRadiusMiles),
      domainUrl: values.website,
      address: values.address,
      city: values.city,
      state: values.state,
      category: values.category,
      serviceArea: values.service_areas.join("\n"),
      hours: values.hours,
      hoursSource: clean(extracted.hoursSource),
      listingConfidence: clean(extracted.listingConfidence),
      mainServices: buildServices.join("\n"),
      exactServices: buildServices.join("\n"),
      servicesSource: values.services_source,
      // The harvester's protectedArtifacts field can be an unstructured
      // concatenation of article headings, ratings, and proof claims. Keep it
      // in private source evidence; it is not an owner-selected public fact.
      protectedArtifacts: "",
      mainCta: clean(extracted.mainCta),
    },
    brand: {
      ...(brand.source_url ? { source_url: brand.source_url } : {}),
      logoLink: brand.logo,
      brandColors: brand.colors.join(", "),
      logoCandidates: brand.logo_candidates,
      brandPalette: brand.palette,
      galleryLink: clean(extracted.galleryLink),
      clientPhotosReceived: "",
      stockAllowed: clean(extracted.stockAllowed),
      aiAllowed: clean(extracted.aiAllowed),
      faviconRequired: "",
      visualTone: clean(extracted.visualTone),
      fonts: brand.fonts,
    },
    requirements: {
      siteType: singlePage ? "Single-page cinematic scroll" : "Local business authority site",
      ...(selectedTemplateId && selectedTemplateId !== "auto" ? { selectedTemplateId } : {}),
      buildLane: selectedBuildLane,
      selectedBuildLane,
      pagesNeeded: pagePlan.map(page => page.title).join("\n"),
      mustInclude: clean(extracted.mustInclude),
      mustAvoid: clean(extracted.mustAvoid),
      marketingPlan: clean(extracted.marketingPlan),
      mapMode: clean(extracted.mapMode),
    },
    goldenArtifacts: {
      exactServices: buildServices,
      servicesSource: values.services_source,
      protectedNotes: [],
      preservationRules: [
        "Do not collapse exact service names into broad categories.",
        "Do not overwrite protected facts with generic template wording.",
        "Observed assets must pass the downstream client-domain ownership gate before use.",
      ],
    },
    review: {
      packetOwner: "Ghost automatic intake lane",
      internalStatus: "Compiled - provenance review stays downstream",
      packetName: clean(body.packet_name || body.packetName) || `${values.name || "Prospect"} Intake Packet`,
      policy_version: "intake-request-service-fallback-v1",
      warnings: warnings.map(cloneJson),
    },
  };

  // Select the same visitor-safe, source-bound service set the Packet 2
  // compiler will use. Otherwise stale extracted labels trigger a review
  // after they have already been withheld from visitor copy.
  if (buildServices.length && typeof buildPacketCompiler.selectAuthenticatedVisitorServices === "function") {
    buildServices = buildPacketCompiler.selectAuthenticatedVisitorServices(packetBase);
    packetBase.business.mainServices = buildServices.join("\n");
    packetBase.business.exactServices = buildServices.join("\n");
    packetBase.goldenArtifacts.exactServices = buildServices;
  }
  const packet2 = compilePacket(withBrandFonts(packetBase));
  // The shared Packet 2 compiler normalizes font names and hrefs. Restore only
  // the first-party observation URL that was value-bound above.
  if (brand.fonts.source_url && packet2?.brand?.fonts) {
    packet2.brand.fonts.source_url = brand.fonts.source_url;
  }
  const packet2Hash = semanticPacketHash(packet2);
  const evidence = mergeFactEvidence(
    admittedVerifiedEvidence,
    factEvidence(values, extracted, hints, corrections, sources, observations),
  );
  const serviceEvidence = serviceEvidenceForFacts(values, extracted, sources, observations);
  const missingFacts = REQUIRED_FACTS.filter(field => !factPresent(values[field]));
  // Only publish search intent assembled from the selected candidate facts.
  // Packet 2's generated marketing plan remains available inside Packet 2,
  // but it is not promoted as provenance-bound optimization metadata.
  const targetQueries = provenanceBoundTargetQueries(values, corrections, observations);

  return {
    ok: true,
    version: VERSION,
    status: missingFacts.length ? "needs_input" : "compiled",
    scope: {
      supported: true,
      message: missingFacts.length
        ? `Source-backed identity is missing: ${missingFacts.join(", ")}.`
        : sources.length
          ? "Source URLs compiled into PageHub Packet 2."
          : "Manual fallback hints compiled into PageHub Packet 2 with explicit estimates.",
    },
    job_id: `pagehub:${packet2Hash.slice(0, 24)}`,
    request_id: clean(body.request_id),
    source_coverage: sourceCoverage,
    facts: values,
    evidence,
    service_evidence: serviceEvidence,
    assets,
    brand,
    content: {
      services: packet2.compiled?.services || [],
      content_contract: packet2.compiled?.contentContract || null,
      content_files: packet2.compiled?.contentFiles || {},
      content_quality: packet2.compiled?.contentQuality || {},
      route_content_map: packet2.compiled?.routeContentMap || [],
      page_plan: packet2.pagePlan || [],
    },
    trust: {
      // Scraped testimonials/counts are observations, not authenticated customer proof.
      review_count: null,
      rating: null,
      verification_status: "withheld_pending_review_provenance",
      reviews: [],
    },
    optimization: {
      target_queries: targetQueries,
      seo_gaps: missingFacts.map(field => `Confirm source-backed ${field}.`),
    },
    warnings,
    missing_facts: missingFacts,
    question: missingFacts.length ? `Confirm ${missingFacts.join(", ")} from a public source or owner correction.` : "",
    packet2,
    packet2_hash: packet2Hash,
    packet2_hash_algorithm: "sha256-semantic-json-v1",
  };
}

function factValues(body, extracted, hints, corrections, verifiedEvidence = [], serviceState = {}) {
  const requested = sourceUrls(body);
  const website = requestBusinessUrls(body)[0]
    || normalizeHttpUrl(extracted.domainUrl)
    || normalizeHttpUrl(body.website_url || body.current_website || body.website);
  const socials = uniqueStrings([
    ...(Array.isArray(extracted.socialLinks) ? extracted.socialLinks : []),
    ...requested.filter(isSocialUrl),
  ]);
  const sourceLatLng = normalizeLatLng(body.latlng)
    || normalizeLatLng({ lat: extracted.geoLat, lng: extracted.geoLng });
  const extractedServices = semanticServices([extracted.exactServices, extracted.mainServices]);
  const verifiedServices = Array.isArray(serviceState.verifiedServices)
    ? serviceState.verifiedServices
    : semanticServices(servicesFromVerifiedEvidence(verifiedEvidence));
  const acceptedServices = Array.isArray(serviceState.acceptedServices)
    ? serviceState.acceptedServices
    : (verifiedServices.length ? verifiedServices : extractedServices);
  const base = {
    name: clean(extracted.brandName || extracted.businessName) || clean(hints.name),
    city: clean(extracted.city) || clean(hints.city),
    state: clean(extracted.state) || clean(hints.state).toUpperCase().slice(0, 2),
    category: resolveCandidateCategory(
      clean(extracted.category || extracted.primaryCategory),
      clean(hints.category),
    ),
    phone: clean(extracted.finalPhone || extracted.phone),
    email: clean(extracted.email),
    address: clean(extracted.address),
    website,
    gbp_url: requested.find(isGoogleBusinessUrl) || clean(extracted.gbpLink),
    hours: clean(extracted.hours),
    booking_url: clean(extracted.bookingUrl || extracted.booking_url),
    services: acceptedServices,
    services_source: verifiedServices.length ? "verified_url" : acceptedServices.length ? "source_observation" : "",
    service_areas: uniqueStrings(lines(extracted.citiesServed, extracted.serviceArea)),
    socials,
    latlng: sourceLatLng,
  };

  Object.entries(corrections).forEach(([field, rawValue]) => {
    if (field === "services_source") return;
    if (!Object.prototype.hasOwnProperty.call(base, field)) return;
    const value = correctionValue(rawValue);
    if (field === "latlng") base[field] = normalizeLatLng(value);
    else if (["services", "service_areas", "socials"].includes(field)) {
      base[field] = field === "services" ? semanticServices(value) : uniqueStrings(lines(value));
      if (field === "services") base.services_source = "owner_correction";
    }
    else base[field] = clean(value);
  });

  if (serviceState.hasRejectedClaims === true) {
    base.services_default_disqualified = true;
  }
  const correctedCategory = clean(correctionValue(corrections.category));
  const categoryBasis = correctedCategory || clean(hints.category);
  const categoryDefaultEligible = Boolean(
    categoryBasis
    && categoryFamily(categoryBasis)
    && categoryFamily(categoryBasis) === categoryFamily(base.category)
  );
  // 2026-08-29 owner unblock: extracted noise that was DROPPED (not foreign)
  // must not block the honest category-default rung. Only claims that are
  // still asserted and failed (hints/rejected evidence/foreign-backed) block
  // defaults.
  const claimsStillAsserted = Boolean(serviceState.hasRejectedClaims);
  if (!base.services.length && claimsStillAsserted !== true && categoryDefaultEligible) {
    const defaults = categoryDefaultServices(base.category);
    if (defaults.length) {
      base.services = defaults;
      base.services_source = "category_default";
      base.estimated = true;
    }
  }
  return base;
}

function hintFacts(body) {
  const hints = requestHints(body);
  return {
    name: clean(hints.name),
    city: clean(hints.city),
    state: clean(hints.state).toUpperCase().slice(0, 2),
    category: clean(hints.category),
    website: clean(body.website_url || body.current_website || body.website),
    services: [],
    service_areas: [],
    socials: [],
    latlng: normalizeLatLng(body.latlng),
  };
}

function requestHints(body = {}) {
  const supplied = object(body.prospect_hints);
  return {
    ...supplied,
    // Ghost v7 sends the candidate trade at the top level. It remains a hint:
    // factEvidence labels it as such and no source-observation URL is attached.
    category: clean(supplied.category) || clean(body.category) || clean(body.vertical),
  };
}

function factEvidence(values, extracted, hints, corrections, sources, observations) {
  return Object.entries(values).flatMap(([field, value]) => {
    if (["services_source", "estimated", "services_default_disqualified"].includes(field) || !factPresent(value)) return [];
    if (field === "services" && values.services_source === "verified_url") return [];
    if (field === "services" && values.services_source === "category_default") {
      return value.map(service => ({
        field,
        value: service,
        source_type: "category_default",
        provenance: "estimated",
        verification_status: "estimated",
        estimated: true,
      }));
    }
    const corrected = Object.prototype.hasOwnProperty.call(corrections, field);
    const fromExtracted = extractedHasField(extracted, field)
      && (field !== "category"
        || extractedValuesForField(extracted, field).includes(normalizeComparable(value)));
    const supportingSources = (observations || [])
      .filter(observation => observationSupportsValue(observation, field, value)
        && (field !== "services" || sameSiteHttpUrl(values.website, observation.source)))
      .map(observation => observation.source);
    const observedSource = (field === "services" ? supportingSources[0] : observationSourceForField(field, value, observations))
      || (field === "website" ? normalizeHttpUrl(values.website) : "")
      || (fromExtracted ? sources.find(isBusinessWebsite) : "")
      || "unknown_public_source";
    if (field === "services" && !corrected) {
      const textSupported = (observations || []).some(observation =>
        sameSiteHttpUrl(values.website, observation.source)
        && intakeQuality.observedService(observation, value));
      return [{
        field,
        value,
        source: observedSource,
        source_url: /^https?:\/\//i.test(observedSource) ? observedSource : "",
        source_observations: uniqueStrings(supportingSources),
        confidence: textSupported ? 0.82 : 0.65,
        provenance: "observed",
        verification_status: textSupported ? "source_observation" : "needs_review",
      }];
    }
    return [{
      field,
      value,
      source: corrected ? "owner_correction" : fromExtracted ? observedSource : "ghost_prospect_hint",
      source_url: !corrected && fromExtracted && /^https?:\/\//i.test(observedSource) ? observedSource : "",
      source_observations: corrected ? [] : uniqueStrings(supportingSources),
      confidence: corrected ? 1 : fromExtracted ? 0.82 : 0.65,
      provenance: corrected ? "owner_supplied" : fromExtracted ? "observed" : "hint",
      verification_status: corrected ? "owner_supplied" : fromExtracted ? "source_observation" : "unverified_hint",
    }];
  });
}

function serviceCertificationState(body, extracted, observations, verifiedEvidence = []) {
  const businessKey = normalizeCategoryKey(extracted.brandName || extracted.businessName);
  const extractedServices = semanticServices([extracted.exactServices, extracted.mainServices])
    .filter(service => !businessKey || normalizeCategoryKey(service) !== businessKey);
  const candidateVerifiedEvidence = verifiedEvidence.filter(row => {
    if (!serviceClaimEvidence([row]).length) return true;
    return !independentlyWrongDomainEvidence(row, body, extracted, observations)
      && serviceEvidenceHasObservedClaim(row, body, observations);
  });
  const verifiedServices = semanticServices(servicesFromVerifiedEvidence(candidateVerifiedEvidence));
  const hintedServices = semanticServices(object(body.prospect_hints).services);
  const corrections = object(body.corrections || body.conflict_resolution);
  const correctedServices = semanticServices(correctionValue(corrections.services));
  const requestWebsites = requestBusinessUrls(body);
  const sourceBackedServices = extractedServices.filter(service =>
    observations.some(observation => requestWebsites.some(website => sameSiteHttpUrl(website, observation.source))
      && serviceLandingObservation(observation, service, requestWebsites[0])
      && observationSupportsValue(observation, "services", service)));
  const sourceBacked = new Set(sourceBackedServices.map(normalizeCategoryKey));
  const verifiedNames = new Set(verifiedServices.map(normalizeCategoryKey));
  const correctedNames = new Set(correctedServices.map(normalizeCategoryKey));
  // Scraper output and caller hints are candidates, not proof. Unsupported
  // values are removed with typed warnings so a known category can use its
  // explicitly estimated default scaffold.
  const allUnsupportedExtracted = extractedServices.filter(service => {
    const key = normalizeCategoryKey(service);
    return key && !sourceBacked.has(key) && !verifiedNames.has(key) && !correctedNames.has(key);
  });
  const serviceClaims = rows => serviceClaimEvidence(rows)
    .filter(row => evidenceValues(row).some(value => !serviceSemanticReason(value)));
  const requestedClaims = serviceClaims(requestEvidence(body));
  const acceptedClaims = serviceClaims(candidateVerifiedEvidence);
  const rejectedEvidence = requestedClaims.filter(row =>
    !acceptedClaims.some(accepted => sameServiceEvidenceClaim(row, accepted)));
  const rejectedWrongDomainEvidence = serviceClaims([...requestEvidence(body), ...verifiedEvidence])
    .filter(row => independentlyWrongDomainEvidence(row, body, extracted, observations));
  const droppedEvidence = rejectedEvidence.filter(row =>
    !rejectedWrongDomainEvidence.includes(row));
  const unsupportedHints = hintedServices.filter(service => {
    const key = normalizeCategoryKey(service);
    return key && !sourceBacked.has(key) && !verifiedNames.has(key) && !correctedNames.has(key);
  });
  const invalidClaimValues = uniqueStrings([
    ...rejectedWrongDomainEvidence.flatMap(evidenceValues),
  ]);
  const acceptedServices = verifiedServices.length ? verifiedServices : sourceBackedServices;
  return {
    extractedServices,
    verifiedServices,
    acceptedVerifiedEvidence: candidateVerifiedEvidence,
    acceptedServices,
    droppedExtractedServices: allUnsupportedExtracted,
    droppedHintServices: unsupportedHints,
    droppedEvidenceServices: uniqueStrings(droppedEvidence.flatMap(evidenceValues)),
    rejectedWrongDomainServices: uniqueStrings(rejectedWrongDomainEvidence.flatMap(evidenceValues)),
    hasPresentClaims: extractedServices.length > 0 || hintedServices.length > 0 || requestedClaims.length > 0,
    hasRejectedClaims: invalidClaimValues.length > 0,
    defaultDisqualified: invalidClaimValues.length > 0,
    invalidClaimValues,
  };
}

function serviceEvidenceHasObservedClaim(row = {}, body = {}, observations = []) {
  const claimedUrl = evidenceUrl(row);
  const values = evidenceValues(row);
  if (!claimedUrl || !values.length) return false;
  const requestedWebsites = requestBusinessUrls(body);
  const requestedSources = sourceUrls(body).map(normalizeHttpUrl).filter(Boolean);
  return values.every(value => observations.some(observation => {
    const observedUrl = normalizeHttpUrl(observation?.source);
    if (!observedUrl || !sameSiteHttpUrl(claimedUrl, observedUrl)) return false;
    const requestBound = requestedWebsites.length
      ? requestedWebsites.some(website => sameSiteHttpUrl(website, observedUrl))
      : requestedSources.some(source => sameSiteHttpUrl(source, observedUrl));
    return requestBound && serviceLandingObservation(observation, value, requestedWebsites[0] || requestedSources[0])
      && observationSupportsValue(observation, "services", value);
  }));
}

function independentlyWrongDomainEvidence(row = {}, body = {}, extracted = {}, observations = []) {
  const claimedUrl = evidenceUrl(row);
  if (!claimedUrl) return false;
  const websites = requestBusinessUrls(body);
  if (websites.length) {
    if (websites.some(website => sameSiteHttpUrl(website, claimedUrl))) return false;
    const auxiliaryCandidateSources = sourceUrls(body)
      .map(normalizeHttpUrl)
      .filter(source => source && (isSocialUrl(source) || isGoogleBusinessUrl(source)));
    const requestedAuxiliary = auxiliaryCandidateSources.some(source => sameRequestedEvidenceSource(source, claimedUrl));
    if (!requestedAuxiliary) return true;
    return !auxiliaryEvidenceIdentityBound(claimedUrl, body, extracted, observations);
  }
  const requested = sourceUrls(body).map(normalizeHttpUrl).filter(Boolean);
  const requestedSource = requested.some(source => sameRequestedEvidenceSource(source, claimedUrl));
  if (!requestedSource) return requested.length > 0;
  return !auxiliaryEvidenceIdentityBound(claimedUrl, body, extracted, observations);
}

function sameRequestedEvidenceSource(left, right) {
  const normalize = value => {
    const url = normalizeHttpUrl(value);
    if (!url) return "";
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      return parsed.href;
    } catch {
      return "";
    }
  };
  const leftUrl = normalize(left);
  return Boolean(leftUrl) && leftUrl === normalize(right);
}

function auxiliaryEvidenceIdentityBound(claimedUrl, body = {}, extracted = {}, observations = []) {
  const hints = requestHints(body);
  const expectedName = clean(hints.name) || clean(extracted.brandName || extracted.businessName);
  if (!expectedName) return false;
  const observation = observations.find(row => sameRequestedEvidenceSource(row?.source, claimedUrl));
  const observed = object(observation?.extracted);
  const observedName = clean(observed.brandName || observed.businessName);
  return Boolean(observedName) && businessNamesMatch(expectedName, observedName, [hints, extracted, observed]);
}

function serviceCertificationWarnings(serviceState = {}) {
  const rows = [
    ["service_extraction_dropped", serviceState.droppedExtractedServices,
      "Unsupported extracted service labels were dropped because no accepted source observation backed them."],
    ["service_hint_dropped", serviceState.droppedHintServices,
      "Unsupported service hints were dropped because hints are not observed truth."],
    ["service_evidence_dropped", serviceState.droppedEvidenceServices,
      "Unaccepted service evidence was dropped because it was not independently verified."],
  ];
  return rows.flatMap(([code, values, message]) => Array.isArray(values) && values.length
    ? [{ code, field: "services", values: uniqueStrings(values), message }]
    : []);
}

function serviceClaimEvidence(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const field = normalizeCategoryKey(row?.field || row?.type);
    return (field === "service" || field === "services") && evidenceValues(row).length > 0;
  });
}

function sameServiceEvidenceClaim(left = {}, right = {}) {
  if (normalizeHttpUrl(evidenceUrl(left)) !== normalizeHttpUrl(evidenceUrl(right))) return false;
  const leftValues = evidenceValues(left).map(normalizeCategoryKey).sort();
  const rightValues = evidenceValues(right).map(normalizeCategoryKey).sort();
  return leftValues.length === rightValues.length
    && leftValues.every((value, index) => value === rightValues[index]);
}

function serviceCertificationProblems(values = {}, serviceState = {}) {
  if (["name", "city", "state"].some(field => !factPresent(values[field]))) return [];
  if (serviceState.defaultDisqualified === true) {
    const present = serviceState.invalidClaimValues || [];
    return [{
      code: "present_service_evidence_invalid",
      field: "services",
      actual: present,
      compared: { present_claims: present, verified_claims: serviceState.verifiedServices || [] },
      message: "A service claim cites an independently wrong-domain source, so category defaults cannot replace it.",
    }];
  }
  const problems = [];
  if (!Array.isArray(values.services) || values.services.length === 0) {
    problems.push({
      code: "services_missing",
      field: "services",
      actual: [],
      message: "No accepted source service or eligible category-default service is available.",
    });
    const category = clean(values.category);
    if (!category) {
      problems.push({
        code: "category_unknown",
        field: "category",
        actual: "",
        message: "A known category is required before estimated service defaults can be used.",
      });
    }
    if ((!category || !categoryDefaultServices(category).length)
      && !problems.some(problem => problem.code === "category_default_unavailable")) {
      problems.push({
        code: "category_default_unavailable",
        field: "services",
        actual: category,
        message: "No supported category-default service list is available.",
      });
    }
  }
  return problems;
}

function requestEvidence(body = {}) {
  return [body.evidence, body.service_evidence]
    .filter(Array.isArray)
    .flat()
    .filter(row => row && typeof row === "object" && !Array.isArray(row));
}

function serviceEvidenceForFacts(values, extracted, sources, observations) {
  if (values.services_source !== "source_observation" || !Array.isArray(values.services)) return [];
  const fallback = sources.find(isBusinessWebsite) || "unknown_public_source";
  return values.services.map(service => {
    const supportingSources = (observations || [])
      .filter(observation => sameSiteHttpUrl(values.website, observation.source)
        && observationSupportsValue(observation, "services", service))
      .map(observation => observation.source);
    const source = supportingSources[0] || fallback;
    const textSupported = (observations || []).some(observation =>
      sameSiteHttpUrl(values.website, observation.source)
      && intakeQuality.observedService(observation, service));
    return {
      field: "services",
      value: service,
      source,
      source_url: /^https?:\/\//i.test(source) ? source : "",
      source_observations: uniqueStrings(supportingSources),
      confidence: textSupported ? 0.82 : 0.65,
      provenance: "observed",
      verification_status: textSupported ? "source_observation" : "needs_review",
    };
  });
}

function categoryDefaultServices(category = "") {
  const family = categoryFamily(category);
  return family ? [...CATEGORY_DEFAULT_SERVICES[family]] : [];
}

function resolveCandidateCategory(extractedCategory = "", prospectCategory = "") {
  const extracted = clean(extractedCategory);
  const prospect = clean(prospectCategory);
  if (!extracted) return prospect;
  if (!prospect) return extracted;
  const extractedFamily = categoryFamily(extracted);
  const prospectFamily = categoryFamily(prospect);
  // When both labels describe the same supported family, publish the caller-
  // authorized category. The scraper's longer directory label stays under
  // sources.extracted/evidence, where it cannot create a second category key.
  if (prospectFamily && extractedFamily === prospectFamily) return prospect;
  // A known LeadMiner vertical is stronger than a generic scraper label such
  // as "Contractor". Preserve the raw label under sources.extracted, but do
  // not let it erase the known category that drives an honest default menu.
  if (prospectFamily && !extractedFamily) return prospect;
  return extracted;
}

function categoryFamily(category = "") {
  const normalized = normalizeCategoryKey(category);
  if (PRODUCT_ONLY_CATEGORY_PATTERN.test(normalized)) return "";
  if (CATEGORY_DEFAULT_SERVICES[normalized]) return normalized;
  return CATEGORY_ALIASES.find(([, pattern]) => pattern.test(normalized))?.[0] || "";
}

function categoriesMatch(left, right) {
  const leftFamily = categoryFamily(left);
  const rightFamily = categoryFamily(right);
  if (leftFamily || rightFamily) return Boolean(leftFamily && rightFamily && leftFamily === rightFamily);
  const leftTokens = normalizeCategoryKey(left).split(" ").filter(Boolean);
  const rightTokens = normalizeCategoryKey(right).split(" ").filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return false;
  return containsTokens(leftTokens, rightTokens) || containsTokens(rightTokens, leftTokens);
}

function normalizeCategoryKey(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function candidateCertificationProblems(hints = {}, values = {}) {
  const expected = clean(hints.name);
  const actual = clean(values.name);
  const problems = [];
  const expectedLocation = { city: clean(hints.city), state: clean(hints.state).toUpperCase() };
  const actualLocation = { city: clean(values.city), state: clean(values.state).toUpperCase() };
  const cityMismatch = expectedLocation.city && actualLocation.city
    && normalizeCategoryKey(expectedLocation.city) !== normalizeCategoryKey(actualLocation.city);
  const stateMismatch = expectedLocation.state && actualLocation.state
    && normalizeStateKey(expectedLocation.state) !== normalizeStateKey(actualLocation.state);
  if (cityMismatch || stateMismatch) {
    const compared = { candidate: expectedLocation, compiled: actualLocation };
    problems.push({
      code: "business_location_mismatch",
      field: "location",
      expected: expectedLocation,
      actual: actualLocation,
      compared,
      compared_values: compared,
      message: "Requested candidate location does not match the compiled business location.",
    });
  }
  const expectedCategory = clean(hints.category);
  const actualCategory = clean(values.category);
  if (expectedCategory && actualCategory && !categoriesMatch(expectedCategory, actualCategory)) {
    const compared = { candidate: expectedCategory, compiled: actualCategory };
    problems.push({
      code: "business_category_mismatch",
      field: "category",
      expected: expectedCategory,
      actual: actualCategory,
      compared,
      compared_values: compared,
      normalized: {
        candidate: categoryFamily(expectedCategory) || normalizeCategoryKey(expectedCategory),
        compiled: categoryFamily(actualCategory) || normalizeCategoryKey(actualCategory),
      },
      message: `Requested candidate category "${expectedCategory}" does not match compiled business category "${actualCategory}".`,
    });
  }
  const nameLocations = problems.length ? [] : [hints, values];
  if (expected && actual && !businessNamesMatch(expected, actual, nameLocations)) {
    const compared = { candidate: expected, compiled: actual };
    problems.unshift({
      code: "business_name_mismatch",
      field: "name",
      expected,
      actual,
      compared,
      compared_values: compared,
      normalized: {
        candidate: normalizeBusinessName(expected, nameLocations),
        compiled: normalizeBusinessName(actual, nameLocations),
      },
      message: `Requested candidate name "${expected}" does not match compiled business name "${actual}".`,
    });
  }
  return problems;
}

function businessNamesMatch(left, right, locations = []) {
  if (locationContextsConflict(locations)) return false;
  const leftBaseTokens = baseBusinessTokens(left, locations);
  const rightBaseTokens = baseBusinessTokens(right, locations);
  if (!leftBaseTokens.length || !rightBaseTokens.length) return false;
  // Alias expansion must never manufacture the only overlap between two
  // otherwise unrelated names. This preserves the certification hard floor.
  if (!leftBaseTokens.some(token => rightBaseTokens.includes(token))) return false;
  const leftTokens = canonicalBusinessTokens(left, locations, leftBaseTokens);
  const rightTokens = canonicalBusinessTokens(right, locations, rightBaseTokens);
  if (leftTokens.join(" ") === rightTokens.join(" ")) return true;
  // Containment stays whole-token and order-preserving; the match context's
  // own city/state tokens may bridge the sequence (see
  // containsTokensWithLocationBridge) but no other inserted word ever does.
  const bridgeTokens = locationBridgeTokens(locations);
  if (containsTokensWithLocationBridge(leftTokens, rightTokens, bridgeTokens)
    || containsTokensWithLocationBridge(rightTokens, leftTokens, bridgeTokens)) return true;
  const leftCompact = leftTokens.join("");
  const rightCompact = rightTokens.join("");
  return Boolean(leftCompact && rightCompact && leftCompact === rightCompact);
}

function locationContextsConflict(locations = []) {
  const rows = (Array.isArray(locations) ? locations : [locations]).filter(Boolean);
  const cities = new Set(rows.map(row => normalizeCategoryKey(row?.city)).filter(Boolean));
  const states = new Set(rows.map(row => normalizeStateKey(row?.state)).filter(Boolean));
  return cities.size > 1 || states.size > 1;
}

function normalizeStateKey(value) {
  const normalized = normalizeCategoryKey(value);
  if (US_STATE_NAMES[normalized]) return normalized;
  const tokens = normalized.split(" ").filter(Boolean);
  const compactAbbreviation = tokens.length > 1 && tokens.every(token => token.length === 1)
    ? tokens.join("")
    : "";
  if (compactAbbreviation && US_STATE_NAMES[compactAbbreviation]) return compactAbbreviation;
  return Object.entries(US_STATE_NAMES).find(([, name]) => name === normalized)?.[0] || normalized;
}

function normalizeBusinessName(value, locations = []) {
  let tokens = normalizedTokens(value);
  if (tokens[0] === "the") tokens = tokens.slice(1);
  const locationTails = locationTokenTails(locations);
  let changed = true;
  while (tokens.length && changed) {
    changed = false;
    const dottedSuffix = DOTTED_LEGAL_SUFFIXES.find(suffix => endsWithTokens(tokens, suffix));
    if (dottedSuffix) {
      tokens = tokens.slice(0, -dottedSuffix.length);
      changed = true;
    }
    while (tokens.length && LEGAL_NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
      tokens.pop();
      changed = true;
    }
    const tail = locationTails.find(candidate => candidate.length && endsWithTokens(tokens, candidate));
    if (tail) {
      tokens = tokens.slice(0, -tail.length);
      changed = true;
    }
  }
  return tokens.join(" ");
}

function normalizedTokens(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean);
}

function locationTokenTails(locations = []) {
  const rows = Array.isArray(locations) ? locations : [locations];
  const tails = [];
  rows.forEach(row => {
    const city = normalizedTokens(row?.city);
    const state = normalizedTokens(row?.state);
    const stateEntry = Object.entries(US_STATE_NAMES)
      .find(([, name]) => normalizedTokens(name).join(" ") === state.join(" "));
    const abbreviation = state.length === 1 && Object.prototype.hasOwnProperty.call(US_STATE_NAMES, state[0])
      ? state
      : stateEntry ? [stateEntry[0]] : [];
    const fullState = state.length === 1 && US_STATE_NAMES[state[0]] ? normalizedTokens(US_STATE_NAMES[state[0]]) : state;
    if (city.length && state.length) tails.push([...city, ...state]);
    if (city.length && fullState.length) tails.push([...city, ...fullState]);
    if (city.length && abbreviation.length) tails.push([...city, ...abbreviation]);
    if (city.length) tails.push(city);
    if (state.length) tails.push(state);
    if (fullState.length) tails.push(fullState);
    if (abbreviation.length) tails.push(abbreviation);
  });
  return [...new Map(tails.filter(row => row.length).map(row => [row.join(" "), row])).values()]
    .sort((left, right) => right.length - left.length);
}

function endsWithTokens(tokens, suffix) {
  return suffix.length <= tokens.length
    && suffix.every((token, index) => token === tokens[tokens.length - suffix.length + index]);
}

function containsTokens(container, candidate) {
  if (!candidate.length || candidate.length > container.length) return false;
  for (let offset = 0; offset <= container.length - candidate.length; offset += 1) {
    if (candidate.every((token, index) => token === container[offset + index])) return true;
  }
  return false;
}

// Location-bridge tolerance: miner-harvested picks commonly insert the
// prospect's own city into an otherwise identical brand ("Elite AC & Plumbing"
// vs "Elite Austin AC & Plumbing"). While scanning the container tokens for
// the candidate sequence, only the match context's own location tokens may be
// skipped — a different city or any non-location word still breaks
// contiguity. Bounded so a name can never bridge arbitrary content: at most
// two skipped location tokens per gap and three per match.
const LOCATION_BRIDGE_MAX_GAP_TOKENS = 2;
const LOCATION_BRIDGE_MAX_TOTAL_TOKENS = 3;

function locationBridgeTokens(locations = []) {
  const tokens = new Set();
  (Array.isArray(locations) ? locations : [locations]).forEach(row => {
    normalizedTokens(row?.city).forEach(token => tokens.add(token));
    normalizedTokens(row?.state).forEach(token => tokens.add(token));
    const stateKey = normalizeStateKey(row?.state);
    if (stateKey) tokens.add(stateKey);
    if (stateKey && US_STATE_NAMES[stateKey]) {
      normalizedTokens(US_STATE_NAMES[stateKey]).forEach(token => tokens.add(token));
    }
  });
  return tokens;
}

function containsTokensWithLocationBridge(container, candidate, bridgeTokens) {
  if (!bridgeTokens || !bridgeTokens.size) return containsTokens(container, candidate);
  if (!candidate.length || candidate.length > container.length) return false;
  for (let offset = 0; offset + candidate.length <= container.length; offset += 1) {
    let index = offset;
    let matched = 0;
    let gapSkips = 0;
    let totalSkips = 0;
    while (index < container.length && matched < candidate.length) {
      if (container[index] === candidate[matched]) {
        matched += 1;
        index += 1;
        gapSkips = 0;
        continue;
      }
      if (matched > 0
        && bridgeTokens.has(container[index])
        && gapSkips < LOCATION_BRIDGE_MAX_GAP_TOKENS
        && totalSkips < LOCATION_BRIDGE_MAX_TOTAL_TOKENS) {
        gapSkips += 1;
        totalSkips += 1;
        index += 1;
        continue;
      }
      break;
    }
    if (matched === candidate.length) return true;
  }
  return false;
}

function baseBusinessTokens(value, locations = []) {
  const tokens = normalizeBusinessName(value, locations).split(" ").filter(Boolean);
  const canonical = [];
  let fragments = [];
  const flush = () => {
    if (!fragments.length) return;
    canonical.push(fragments.join(""));
    fragments = [];
  };
  for (const token of tokens) {
    if (token.length === 1) fragments.push(token);
    else {
      flush();
      canonical.push(token);
    }
  }
  flush();
  return canonical;
}

function canonicalBusinessTokens(value, locations = [], baseTokens = null) {
  const canonical = baseTokens || baseBusinessTokens(value, locations);
  if (!allowsHvacNameAliases(locations)) return canonical;
  return canonical.flatMap(token => HVAC_NAME_TOKEN_ALIASES[token] || [token]);
}

function allowsHvacNameAliases(contexts = []) {
  const rows = (Array.isArray(contexts) ? contexts : [contexts]).filter(Boolean);
  const categories = rows.map(row => clean(row?.category)).filter(Boolean);
  return categories.length > 0 && categories.every(isHvacNameAliasCategory);
}

function isHvacNameAliasCategory(category = "") {
  if (categoryFamily(category) === "hvac") return true;
  // These are narrow, standard trade labels used by business directories.
  // This only enables name aliases; it does not change category certification.
  return /^(?:heating|cooling|heating (?:and )?cooling)(?: contractor| services?)?$/.test(normalizeCategoryKey(category));
}

function verifiedClaimEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row && typeof row === "object" && !Array.isArray(row)
    && Boolean(evidenceUrl(row))
    && (row.verified === true
      || ["verified", "source verified", "owner verified"].includes(normalizeCategoryKey(row.verification_status))));
}

function evidenceUrl(row = {}) {
  const nested = object(row.source);
  return [row.source_url, nested.url, typeof row.source === "string" ? row.source : "", row.url]
    .map(normalizeHttpUrl).find(Boolean) || "";
}

function evidenceValues(row = {}) {
  const values = Array.isArray(row.value) ? row.value : [row.value ?? row.name];
  return values.map(item => clean(item && typeof item === "object" ? item.name || item.title : item)).filter(Boolean);
}

function servicesFromVerifiedEvidence(rows = []) {
  return uniqueStrings(rows.flatMap(row => {
    const field = normalizeCategoryKey(row.field || row.type);
    return field === "service" || field === "services" ? evidenceValues(row) : [];
  }));
}

function mergeFactEvidence(verifiedRows = [], generatedRows = []) {
  const preserved = verifiedRows.map(cloneJson);
  const remaining = generatedRows.filter(row => !verifiedRows.some(verified => evidenceCovers(verified, row)));
  return [...preserved, ...remaining];
}

function evidenceCovers(existing = {}, generated = {}) {
  if (normalizeCategoryKey(existing.field || existing.type) !== normalizeCategoryKey(generated.field || generated.type)) return false;
  const existingValues = new Set(evidenceValues(existing).map(normalizeCategoryKey));
  return evidenceValues(generated).every(value => existingValues.has(normalizeCategoryKey(value)));
}

function observationSupportsValue(observation, field, selected) {
  if (field === "services" && !(Array.isArray(selected) ? selected : [selected])
    .some(value => intakeQuality.sourceServiceCandidate(observation, value))) return false;
  if (intakeQuality.demoSource(observation?.source || "")) return false;
  if (!extractedHasField(observation?.extracted, field)) return false;
  const observed = extractedValuesForField(observation.extracted, field);
  const wanted = (Array.isArray(selected) ? selected : [selected]).map(normalizeComparable).filter(Boolean);
  if (!wanted.length) return false;
  if (field === "services") return wanted.some(value => observed.includes(value));
  return wanted.every(value => observed.includes(value));
}

function extractedValuesForField(extracted = {}, field) {
  const map = {
    name: [extracted.brandName, extracted.businessName],
    city: [extracted.city], state: [extracted.state], category: [extracted.category, extracted.primaryCategory],
    phone: [extracted.finalPhone, extracted.phone], email: [extracted.email], address: [extracted.address],
    website: [extracted.domainUrl], gbp_url: [extracted.gbpLink], hours: [extracted.hours],
    booking_url: [extracted.bookingUrl, extracted.booking_url],
    services: lines(extracted.exactServices, extracted.mainServices),
    service_areas: lines(extracted.citiesServed, extracted.serviceArea), socials: extracted.socialLinks || [],
    latlng: [{ lat: extracted.geoLat, lng: extracted.geoLng }],
  };
  return (map[field] || []).flat().map(normalizeComparable).filter(Boolean);
}

function normalizeComparable(value) {
  if (value && typeof value === "object") return stableStringify(value);
  if (/^https?:\/\//i.test(clean(value))) return normalizeHttpUrl(value).toLowerCase();
  return normalizeCategoryKey(value);
}

function extractedHasField(extracted, field) {
  const map = {
    name: ["brandName", "businessName"],
    city: ["city"],
    state: ["state"],
    category: ["category", "primaryCategory"],
    phone: ["finalPhone", "phone"],
    email: ["email"],
    address: ["address"],
    website: ["domainUrl"],
    gbp_url: ["gbpLink"],
    hours: ["hours"],
    booking_url: ["bookingUrl", "booking_url"],
    services: ["exactServices", "mainServices"],
    service_areas: ["citiesServed", "serviceArea"],
    socials: ["socialLinks"],
    latlng: ["geoLat", "geoLng"],
  };
  return (map[field] || []).some(key => factPresent(extracted[key]));
}

function normalizeObservations(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(row => row?.success !== false && clean(row?.status).toLowerCase() !== "failed")
    .map(row => ({
      source: normalizeHttpUrl(row?.source || row?.url),
      status: "succeeded",
      extracted: object(row?.extracted),
      note: clean(row?.note),
      ...(row?.private_source ? { private_source: normalizePrivatePageSource(row.private_source) } : {}),
    })).filter(row => row.source);
}

function normalizeHarvestCoverage(value, fallbackSucceeded = []) {
  const row = object(value);
  const attempted = normalizeCoverageUrls(row.attempted);
  const succeeded = normalizeCoverageUrls(row.succeeded?.length ? row.succeeded : fallbackSucceeded);
  const failed = (Array.isArray(row.failed) ? row.failed : []).slice(0, 100).map(item => ({
    source: normalizeHttpUrl(item?.source || item?.url),
    code: clean(item?.code).slice(0, 80) || "provider_scrape_failed",
    error: clean(item?.error || item?.message).slice(0, 500),
  })).filter(item => item.source);
  const truncated = normalizeCoverageUrls(row.truncated).slice(0, 100);
  const counts = object(row.counts);
  const count = (key, fallback) => {
    const number = Number(counts[key]);
    return Number.isInteger(number) && number >= fallback ? number : fallback;
  };
  return {
    schema: "SourceHarvestCoverage/v1",
    attempted,
    succeeded,
    failed,
    truncated,
    ...(row.byte_budget ? { byte_budget: cloneJson(row.byte_budget) } : {}),
    counts: {
      attempted: count("attempted", attempted.length),
      succeeded: count("succeeded", succeeded.length),
      failed: count("failed", failed.length),
      truncated: count("truncated", truncated.length),
      truncated_omitted: count("truncated_omitted", 0),
    },
  };
}

function normalizeCoverageUrls(value) {
  return uniqueStrings(Array.isArray(value) ? value.map(item => normalizeHttpUrl(item?.url || item?.source || item)) : [])
    .slice(0, 100);
}

function normalizePrivatePageSource(value) {
  const row = object(value);
  const markdown = String(row.markdown || "").slice(0, 1024 * 1024);
  const reportedChars = Number(row.markdown_chars);
  const metadata = object(row.metadata);
  const media = object(row.media);
  return {
    publication_policy: "private_review_only",
    quality_review: row.quality_review && typeof row.quality_review === "object" ? {
      publication_policy: "private_review_only",
      issues: (Array.isArray(row.quality_review.issues) ? row.quality_review.issues : []).slice(0, 100)
        .map(issue => ({ field: clean(issue.field).slice(0, 80), rule: clean(issue.rule).slice(0, 100),
          severity: issue.severity === "block" ? "block" : "review" })),
      raw_fields: Object.fromEntries(Object.entries(object(row.quality_review.raw_fields)).slice(0, 20)
        .map(([field, value]) => [field, intakeQuality.privateValue(value)])),
    } : null,
    markdown,
    markdown_chars: Number.isInteger(reportedChars) && reportedChars >= markdown.length ? reportedChars : markdown.length,
    markdown_truncated: row.markdown_truncated === true || reportedChars > markdown.length,
    metadata: ["title", "description", "ogTitle", "ogDescription", "language", "sourceURL"].reduce((output, key) => {
      const text = clean(metadata[key]).slice(0, 2000);
      if (text) output[key] = text;
      return output;
    }, {}),
    media: {
      images: normalizePrivateMediaItems(media.images),
      branding: normalizePrivateBranding(media.branding),
    },
  };
}

function normalizePrivateMediaItems(value) {
  return (Array.isArray(value) ? value : []).slice(0, 24).map(item => {
    const row = object(item);
    const url = normalizeHttpUrl(row.url || row.src);
    if (!url) return null;
    const output = { url };
    ["alt", "title", "role", "type"].forEach(key => {
      const text = clean(row[key]).slice(0, 500);
      if (text) output[key] = text;
    });
    ["width", "height"].forEach(key => {
      const number = Number(row[key]);
      if (Number.isFinite(number) && number >= 0) output[key] = number;
    });
    return output;
  }).filter(Boolean);
}

function normalizePrivateBranding(value) {
  const row = object(value);
  const output = {};
  const logo = normalizeHttpUrl(row.logo);
  if (logo) output.logo = logo;
  const colors = object(row.colors);
  const normalizedColors = Object.entries(colors).slice(0, 16).reduce((acc, [key, value]) => {
    const name = clean(key).slice(0, 64);
    const color = clean(value).slice(0, 64);
    if (name && color) acc[name] = color;
    return acc;
  }, {});
  if (Object.keys(normalizedColors).length) output.colors = normalizedColors;
  return output;
}

function observationSourceForField(field, value, observations) {
  const row = (observations || []).find(observation => {
    if (observationSupportsValue(observation, field, value)) return true;
    return field === "website" && normalizeHttpUrl(observation.source) === normalizeHttpUrl(value);
  });
  return row?.source || "";
}

function observationSourceForAsset(url, kind, observations) {
  for (const observation of observations || []) {
    const extracted = observation.extracted || {};
    const candidates = kind === "logo"
      ? [extracted.logoLink, ...(Array.isArray(extracted.logoCandidates) ? extracted.logoCandidates : [])]
      : (Array.isArray(extracted.imageCandidates) ? extracted.imageCandidates : []);
    if (candidates.some(candidate => normalizeHttpUrl(candidateUrl(candidate)) === normalizeHttpUrl(url))) {
      return observation.source;
    }
  }
  return "";
}

function candidateUrl(candidate) {
  return clean(candidate && typeof candidate === "object" ? candidate.url || candidate.src || candidate.link : candidate);
}

function observedAssets(extracted, sources, observations) {
  const logos = normalizeAssetCandidates([
    extracted.logoLink,
    ...(Array.isArray(extracted.logoCandidates) ? extracted.logoCandidates : []),
  ], "logo", observations);
  const photos = normalizeAssetCandidates([
    ...(Array.isArray(extracted.imageCandidates) ? extracted.imageCandidates : []),
  ], "photo", observations);
  const seen = new Set();
  return [...logos, ...photos].filter(item => {
    const key = `${item.kind}|${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeAssetCandidates(candidates, kind, observations) {
  return candidates.map(candidate => {
    const row = candidate && typeof candidate === "object" ? candidate : { url: candidate };
    const url = clean(row.url || row.src || row.link);
    if (!/^https?:\/\//i.test(url)) return null;
    return {
      kind,
      url,
      label: clean(row.alt || row.title || row.label),
      role: clean(row.role),
      source: "public_source_observation",
      observed_on: observationSourceForAsset(url, kind, observations),
      verification_status: "unverified_url_observation",
      ownership_verified: false,
    };
  }).filter(Boolean);
}

function brandContract(body, extracted, assets, observations, website) {
  const bodyBrand = object(body.brand);
  const bodyFonts = object(bodyBrand.fonts || body.fonts);
  const palette = normalizePalette(extracted.brandPalette || bodyBrand.palette || bodyBrand.brandPalette)
    .map(row => {
      const sourceUrl = observationSourceForPalette(row.hex, observations, website);
      return sourceUrl ? { ...row, source_url: sourceUrl } : row;
    });
  const colorStrings = uniqueStrings([
    ...palette.map(item => item.hex),
    ...colorValues(extracted.brandColors, bodyBrand.brandColors),
  ]);
  const fonts = {
    display: clean(bodyFonts.display || extracted.typographyDisplay || extracted.displayFont),
    body: clean(bodyFonts.body || extracted.typographyBody || extracted.bodyFont),
    href: clean(bodyFonts.href || extracted.googleFontsUrl || extracted.fontsHref),
  };
  const fontSourceUrl = observationSourceForFonts(fonts, observations, website);
  if (fontSourceUrl) fonts.source_url = fontSourceUrl;
  const sourceUrl = uniqueStrings([
    ...palette.map(item => item.source_url),
    fontSourceUrl,
    ...assets.filter(item => item.kind === "logo").map(item => item.observed_on),
  ]).find(candidate => sameSiteHttpUrl(website, candidate)) || "";
  return {
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    logo: assets.find(item => item.kind === "logo")?.url || "",
    logo_candidates: assets.filter(item => item.kind === "logo").map(item => item.url),
    photo_candidates: assets.filter(item => item.kind === "photo").map(item => item.url),
    palette,
    colors: colorStrings,
    fonts,
  };
}

function observationSourceForPalette(hex, observations, website) {
  for (const observation of observations || []) {
    if (!sameSiteHttpUrl(website, observation.source)) continue;
    const extracted = object(observation.extracted);
    const observedPalette = normalizePalette(extracted.brandPalette || extracted.palette || extracted.brandColors);
    const observedColors = uniqueStrings([
      ...observedPalette.map(row => row.hex),
      ...colorValues(extracted.brandColors),
    ]);
    if (observedColors.includes(hex)) return observation.source;
  }
  return "";
}

function observationSourceForFonts(fonts, observations, website) {
  const wanted = Object.entries(fonts).filter(([, value]) => clean(value));
  if (!wanted.length) return "";
  for (const observation of observations || []) {
    if (!sameSiteHttpUrl(website, observation.source)) continue;
    const extracted = object(observation.extracted);
    const observed = {
      display: clean(extracted.typographyDisplay || extracted.displayFont),
      body: clean(extracted.typographyBody || extracted.bodyFont),
      href: clean(extracted.googleFontsUrl || extracted.fontsHref),
    };
    if (wanted.every(([field, value]) => normalizeComparable(observed[field]) === normalizeComparable(value))) {
      return observation.source;
    }
  }
  return "";
}

function provenanceBoundTargetQueries(values, corrections, observations) {
  const city = clean(values?.city);
  if (!city || values?.services_source === "category_default") return [];
  const cityObservation = observationSourceForField("city", city, observations);
  const cityBound = Object.prototype.hasOwnProperty.call(corrections, "city")
    || sameSiteHttpUrl(values.website, cityObservation);
  if (!cityBound) return [];
  const rawState = clean(values?.state);
  const stateObservation = observationSourceForField("state", rawState, observations);
  const stateBound = rawState && (Object.prototype.hasOwnProperty.call(corrections, "state")
    || sameSiteHttpUrl(values.website, stateObservation));
  const state = stateBound ? normalizeStateKey(rawState).toUpperCase() : "";
  const location = [city, state].filter(Boolean).join(" ");
  return uniqueStrings((values?.services || []).map(service => `${clean(service)} ${location}`)).slice(0, 12);
}

function normalizePalette(value) {
  const rows = Array.isArray(value) ? value : lines(value);
  const seen = new Set();
  return rows.map(item => {
    const row = item && typeof item === "object" ? item : { hex: item };
    const hex = normalizeHex(row.hex || row.color || row.value);
    if (!hex || seen.has(hex)) return null;
    seen.add(hex);
    return {
      hex,
      role: clean(row.role),
      source: clean(row.source) || "public_source_observation",
    };
  }).filter(Boolean);
}

function normalizePagePlan(value) {
  if (Array.isArray(value) && value.length) {
    return value.slice(0, 30).map(page => ({
      title: clean(page?.title || page?.name) || "Page",
      slug: clean(page?.slug),
      targetKeyword: clean(page?.targetKeyword || page?.target_keyword),
      intent: clean(page?.intent),
    }));
  }
  return [
    { title: "Home", slug: "" },
    { title: "Services", slug: "services" },
    { title: "About", slug: "about" },
    { title: "Contact", slug: "contact" },
  ];
}

function sourceUrls(body) {
  const nested = object(body.sources);
  const values = [
    body.website_url, body.current_website, body.website, nested.website_url,
    body.gbp_url, nested.gbp_url,
    body.facebook_url, nested.facebook_url,
    body.instagram_url, nested.instagram_url,
    body.social_url, nested.social_url,
    body.yelp_url, nested.yelp_url,
    body.asset_url, nested.asset_url,
    body.additional_urls, nested.additional_urls,
  ];
  // The shared Firecrawl normalizer safely adds https:// and rejects invalid,
  // private, or reserved targets. Keep bare domains here for Ghost prospects
  // whose provider records do not include a scheme.
  return uniqueStrings(values.flatMap(value => Array.isArray(value) ? value : [value]));
}

function requestBusinessUrls(body) {
  const nested = object(body.sources);
  return uniqueStrings([
    body.website_url,
    body.current_website,
    body.website,
    nested.website_url,
  ].map(normalizeHttpUrl).filter(Boolean));
}

function isHealthRequest(req) {
  if (String(req.query?.healthz || "") === "1") return true;
  const url = String(req.url || "");
  return /^\/healthz(?:[/?#]|$)/i.test(url) || /[?&]healthz=1(?:&|$)/i.test(url);
}

function cachedResult(cache, key, timestamp) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= timestamp) {
    cache.delete(key);
    return null;
  }
  return entry.promise;
}

function rememberResult(cache, key, promise, timestamp) {
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= timestamp) cache.delete(cachedKey);
  }
  while (cache.size >= IDEMPOTENCY_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { promise, expiresAt: timestamp + IDEMPOTENCY_TTL_MS });
}

function authorized(header, expectedToken) {
  const supplied = clean(header).replace(/^Bearer\s+/i, "");
  if (!supplied || !expectedToken) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expectedToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

function semanticPacketHash(packet) {
  return createHash("sha256").update(stableStringify(packet)).digest("hex");
}

function semanticRequestHash(request) {
  return createHash("sha256").update(stableStringify({ intakeRequest: request })).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function stableValue(value, key = "") {
  if (VOLATILE_HASH_KEYS.has(key)) return undefined;
  if (Array.isArray(value)) return value.map(item => stableValue(item)).filter(item => item !== undefined);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((output, childKey) => {
      if (key === "intakeRequest" && TRANSPORT_REQUEST_KEYS.has(childKey)) return output;
      const child = stableValue(value[childKey], childKey);
      if (child !== undefined) output[childKey] = child;
      return output;
    }, {});
  }
  if (typeof value === "string") {
    return value
      .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<timestamp>")
      .replace(/(datePublished:\s*["'])\d{4}-\d{2}-\d{2}(["'])/g, "$1<date>$2");
  }
  return value;
}

function lines(...values) {
  return values.flatMap(value => {
    if (Array.isArray(value)) return value.flatMap(item => lines(item));
    if (value == null) return [];
    return String(value).split(/\r?\n|\s*;\s*/).map(clean).filter(Boolean);
  });
}

function uniqueStrings(values) {
  const seen = new Set();
  return (values || []).map(clean).filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeLatLng(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function normalizeHex(value) {
  const match = clean(value).match(/^#?([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (!match) return "";
  const body = match[1].length === 3 ? match[1].split("").map(char => char + char).join("") : match[1];
  return `#${body.toUpperCase()}`;
}

function colorValues(...values) {
  return values.flatMap(value => String(value || "").match(/#[0-9a-f]{3,8}\b/gi) || [])
    .map(normalizeHex)
    .filter(Boolean);
}

function correctionValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "value")) return value.value;
  return value;
}

function isBusinessWebsite(value) {
  const url = normalizeHttpUrl(value);
  return Boolean(url) && !isSocialUrl(url) && !isGoogleBusinessUrl(url)
    && !/drive\.google\.com|dropbox\.com|sharepoint\.com|onedrive\.live\.com/i.test(url);
}

function isGoogleBusinessUrl(value) {
  return /(?:google\.[^/]+\/(?:maps|search)|maps\.app\.goo\.gl|share\.google)/i.test(clean(value));
}

function isSocialUrl(value) {
  return /(?:facebook|instagram|linkedin|youtube|youtu\.be|tiktok|x\.com|twitter|yelp)\.com/i.test(clean(value));
}

function sameSiteHttpUrl(website, candidate) {
  const left = normalizeHttpUrl(website);
  const right = normalizeHttpUrl(candidate);
  if (!left || !right) return false;
  try {
    const leftHost = new URL(left).hostname.toLowerCase().replace(/^www\./, "");
    const rightHost = new URL(right).hostname.toLowerCase().replace(/^www\./, "");
    const hostsMatch = leftHost === rightHost
      || leftHost.endsWith(`.${rightHost}`)
      || rightHost.endsWith(`.${leftHost}`);
    if (!hostsMatch) return false;
    const sharedHost = PATH_SCOPED_EVIDENCE_HOSTS.find(host => leftHost === host || leftHost.endsWith(`.${host}`));
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

function normalizeHttpUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function factPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return clean(value) !== "";
}

function finiteNumber(value, fallback) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function clean(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function httpStatusForCompileResult(result = {}) {
  return result?.status === "refused" ? 422 : 200;
}

const handler = createHandler();
handler.config = { maxDuration: 300 };
handler.VERSION = VERSION;
handler.CATEGORY_DEFAULT_SERVICES = CATEGORY_DEFAULT_SERVICES;
handler.businessNamesMatch = businessNamesMatch;
handler.categoryDefaultServices = categoryDefaultServices;
handler.compileCanonicalPacket = compileCanonicalPacket;
handler.createHandler = createHandler;
handler.normalizeBusinessName = normalizeBusinessName;
handler.semanticPacketHash = semanticPacketHash;
handler.sourceUrls = sourceUrls;

module.exports = handler;
module.exports.config = handler.config;
