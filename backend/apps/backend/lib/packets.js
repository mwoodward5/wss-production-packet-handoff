const { randomUUID } = require("node:crypto");
const { hashObject } = require("./http");
const { SYSTEMS, publicConfig } = require("./registry");
const { normalizeUsLocation, publicServiceNames } = require("./public-data");

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function slugify(value) {
  return cleanString(value, "local-growth-job")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeProspect(input = {}) {
  const prospect = input.prospect || input.lead || input.business || input;
  const businessName = cleanString(prospect.businessName || prospect.company || prospect.name);
  const industry = cleanString(prospect.industry || prospect.category || prospect.businessCategory);
  const location = normalizeUsLocation({
    city: prospect.city || prospect.market,
    state: prospect.state || prospect.region,
    address: prospect.address || prospect.formattedAddress,
  });
  const city = cleanString(location.city);
  const state = cleanString(location.state);
  const normalizedServices = publicServiceNames(normalizeList(prospect.services), industry);
  const services = normalizedServices.length ? normalizedServices : (industry ? [industry] : []);

  return {
    id: cleanString(prospect.id, `prospect_${slugify(businessName || "unknown")}_${Date.now()}`),
    businessName,
    industry,
    city,
    state,
    country: cleanString(prospect.country, "US"),
    ownerName: cleanString(prospect.ownerName || prospect.contactName, "Business owner"),
    ownerEmail: cleanString(prospect.ownerEmail || prospect.email),
    phone: cleanString(prospect.phone || prospect.phoneNumber),
    currentWebsite: cleanString(prospect.currentWebsite || prospect.website || prospect.url),
    services,
    source: cleanString(prospect.source, "woodward-local-growth-hub"),
    notes: cleanString(prospect.notes || prospect.context),
    consentToCall: Boolean(prospect.consentToCall || input.consentToCall),
    consentToText: Boolean(prospect.consentToText || input.consentToText),
    consentSource: cleanString(prospect.consentSource || input.consentSource),
    // Carried through to Stripe checkout metadata (lib/stripe.js) so a paid
    // domain purchase (lib/domains.js fulfillDomainForJob) has a real Vercel
    // project to attach to instead of silently no-oping. Nothing populates
    // these yet from the build pipelines themselves (see 2026-07-22 Stripe
    // customer-activation-chain audit) -- callers that already know the
    // prospect's deployed project name / requested domain (e.g. an admin
    // mint-checkout-links call, or a live prospect-row lookup) can supply
    // either casing and it will flow through.
    desiredDomain: cleanString(prospect.desiredDomain || prospect.desired_domain),
    previewProjectName: cleanString(prospect.previewProjectName || prospect.preview_project_name),
  };
}

function buildReportPacket(prospect) {
  return {
    id: `report_${hashObject(prospect)}`,
    businessName: prospect.businessName,
    market: `${prospect.city}, ${prospect.state}`,
    industry: prospect.industry,
    reportSystems: ["Rocket SERPs", "WSS Labs Visibility Report"],
    requestedSignals: [
      "organic rankings",
      "local-map footprint",
      "AI visibility readiness",
      "service-page gaps",
      "conversion trust gaps",
    ],
    deepLinks: {
      callprep: SYSTEMS.callprep.url,
      sampleReport: SYSTEMS.callprep.sampleReportUrl,
    },
  };
}

function buildSitePacket(prospect) {
  const slug = slugify(`${prospect.city}-${prospect.industry}-${prospect.businessName}`);
  return {
    id: `site_${hashObject({ slug, prospect })}`,
    slug,
    businessName: prospect.businessName,
    selectedTemplate: "Premium local-service trust site",
    primaryGoal: "Turn a report-card gap into a visible proof website and booked sales call.",
    pages: ["Home", "Services", "Service Areas", "Reviews", "Contact"],
    conversionFeatures: [
      "click-to-call CTA",
      "quote form",
      "local proof blocks",
      "service-area map section",
      "trust and guarantee strip",
    ],
    visualDirection:
      "Premium 2026 local-service site: crisp type, cinematic hero media, clear CTAs, proof-heavy modules, no generic flat cards.",
    buildSystems: ["WSS Labs", "DreamForge"],
    deepLinks: {
      woodwardLabs: SYSTEMS.woodwardLabs.url,
      dreamForge: SYSTEMS.dreamForge.url,
      publicDeck: SYSTEMS.deck.url,
    },
  };
}

function buildOutreachPacket(prospect, jobId) {
  return {
    id: `outreach_${hashObject({ jobId, prospect: prospect.id })}`,
    jobId,
    allowedChannels: {
      email: Boolean(prospect.ownerEmail),
      text: Boolean(prospect.phone && prospect.consentToText),
      call: Boolean(prospect.phone && prospect.consentToCall),
    },
    consentRequired: true,
    consentStatus: {
      call: prospect.consentToCall ? "allowed_by_request_payload" : "blocked_until_opt_in",
      text: prospect.consentToText ? "allowed_by_request_payload" : "blocked_until_opt_in",
    },
    missionControlUrl: SYSTEMS.missionControl.url,
    recommendedCopy:
      "Your local visibility report is ready, and we built a preview direction showing the fix. Reply YES if you want us to walk you through it.",
  };
}

function buildCheckoutPacket(prospect, jobId) {
  const config = publicConfig();
  return {
    id: `checkout_${hashObject({ jobId, prospect: prospect.id })}`,
    jobId,
    // ONE PRICE. This said $499/mo — a number no surface has quoted since the
    // Mission Control era, three times the price the email, the panel and Riley
    // now all state. The plan is $149/mo with the $500 setup fee waived.
    defaultOffer: "$149/mo done-for-you local website growth plan, $500 setup fee waived",
    checkoutMode: process.env.STRIPE_CHECKOUT_MODE || "subscription",
    priceIdConfigured: Boolean(
      process.env.STRIPE_LOCAL_GROWTH_PRICE_ID?.trim() ||
        process.env.STRIPE_WEBSITE_GROWTH_PRICE_ID?.trim() ||
        process.env.STRIPE_GHOST_AGENCY_PRICE_ID?.trim(),
    ),
    successUrl:
      process.env.STRIPE_LOCAL_GROWTH_SUCCESS_URL ||
      process.env.STRIPE_SUCCESS_URL ||
      `${config.publicAppUrl}/factory-os?checkout=success&job=${encodeURIComponent(jobId)}`,
    cancelUrl:
      process.env.STRIPE_LOCAL_GROWTH_CANCEL_URL ||
      process.env.STRIPE_CANCEL_URL ||
      `${config.publicAppUrl}/factory-os?checkout=cancelled&job=${encodeURIComponent(jobId)}`,
  };
}

function buildCanonicalJob(input = {}) {
  const prospect = normalizeProspect(input);
  const id = cleanString(input.jobId || input.id, `growth_${slugify(prospect.businessName)}_${randomUUID()}`);
  const createdAt = nowIso();
  const reportPacket = buildReportPacket(prospect);
  const sitePacket = buildSitePacket(prospect);
  const outreachPacket = buildOutreachPacket(prospect, id);
  const checkoutPacket = buildCheckoutPacket(prospect, id);

  return {
    ok: true,
    id,
    createdAt,
    owner: "Woodward Software",
    product: "Local Growth Website Plan",
    prospect,
    stages: [
      {
        key: "leadmine",
        system: "LeadMiner",
        status: "handoff_ready",
        url: SYSTEMS.leadminer.url,
        output: "scored prospect export or masked preview signal",
      },
      {
        key: "report",
        system: "Rocket SERPs + WSS Labs Visibility Report",
        status: "packet_ready",
        url: SYSTEMS.callprep.url,
        packetId: reportPacket.id,
      },
      {
        key: "site",
        system: "WSS Labs + DreamForge",
        status: "packet_ready",
        url: SYSTEMS.woodwardLabs.url,
        packetId: sitePacket.id,
      },
      {
        key: "outreach",
        system: "Mission Control + VAPI + Twilio",
        status: prospect.consentToCall || prospect.consentToText ? "consent_gate_open" : "blocked_until_opt_in",
        url: SYSTEMS.missionControl.url,
        packetId: outreachPacket.id,
      },
      {
        key: "checkout",
        system: "Stripe",
        status: checkoutPacket.priceIdConfigured ? "checkout_ready" : "dry_run_until_price_env",
        packetId: checkoutPacket.id,
      },
    ],
    packets: {
      report: reportPacket,
      site: sitePacket,
      outreach: outreachPacket,
      checkout: checkoutPacket,
    },
  };
}

function buildWoodwardLabsBuildTicketPayload(job) {
  const prospect = job.prospect;
  const now = nowIso();
  const servicesText = prospect.services.join(", ");
  const serviceAreas = [prospect.city, prospect.state].filter(Boolean).join(", ");
  return {
    lead: {
      id: job.id,
      customerName: prospect.ownerName,
      businessName: prospect.businessName,
      email: prospect.ownerEmail || "owner@example.com",
      phone: prospect.phone || "",
      businessCategory: prospect.industry,
      selectedTemplateId: "woodward-premium-local-growth",
      services: servicesText,
      serviceAreas,
      currentWebsite: prospect.currentWebsite,
      preferredStyle: job.packets.site.visualDirection,
      brandColors: "deep navy, electric cyan, violet accent, clean white space",
      logoUrl: "",
      notes: [prospect.notes, "Created by the Woodward local website growth engine."]
        .filter(Boolean)
        .join("\n"),
      selectedAddons: ["visibility report", "preview site", "AI follow-up system"],
      generatedBuildBrief: {
        customerName: prospect.ownerName,
        businessName: prospect.businessName,
        businessCategory: prospect.industry,
        selectedTemplate: job.packets.site.selectedTemplate,
        primaryGoal: job.packets.site.primaryGoal,
        services: prospect.services,
        serviceAreas: [serviceAreas],
        preferredStyle: job.packets.site.visualDirection,
        requiredPages: job.packets.site.pages,
        seoFeatures: job.packets.report.requestedSignals,
        conversionFeatures: job.packets.site.conversionFeatures,
        selectedAddons: ["report card", "preview site", "follow-up automation"],
        notes: prospect.notes || "Local website build packet generated by the Woodward growth engine.",
      },
      status: "new",
      createdAt: now,
    },
    messaging: {
      ownerEmail: process.env.GHOST_AGENCY_OWNER_EMAIL || "",
      ricardoEmail: "",
      resendFromEmail:
        process.env.LOCAL_GROWTH_RESEND_FROM ||
        process.env.GHOST_AGENCY_RESEND_FROM ||
        "Woodward Mission Control <onboarding@resend.dev>",
    },
  };
}

module.exports = {
  buildCanonicalJob,
  buildCheckoutPacket,
  buildOutreachPacket,
  buildReportPacket,
  buildRocketBuildTicketPayload: buildWoodwardLabsBuildTicketPayload,
  buildWoodwardLabsBuildTicketPayload,
  buildSitePacket,
  normalizeProspect,
  nowIso,
  slugify,
};
