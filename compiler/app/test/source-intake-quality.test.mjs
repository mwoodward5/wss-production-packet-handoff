import assert from "node:assert/strict";
import {
  collectSourceIntake,
  extractServices,
  extractServiceHeadings,
  extractSourcePhone,
  isLikelyLogoUrl,
  isTrustedLogoAsset,
  isUsableSourcePhotoUrl,
  normalizeSourcePhotoUrl,
  normalizeSourceEmail,
  normalizeSourceFonts,
  promoteIdentityMatchedSourceLogo,
  recoverAuthenticatedGhostLogo,
  sanitizeSourceAssets,
  socialBelongsToBusiness,
  sourceAssetIdentity,
} from "../lib/source-intake.mjs";
import { mergeV7Assets, sanitizeV7MediaCatalog } from "../lib/media-engine.mjs";
import { enforceBusinessTruth } from "../lib/business-truth.mjs";
import { bookingUrlFromCopy, cleanServices, factsFromDiscovery, hoursFromAssets, locationFromAddress } from "../lib/intake-genie.mjs";
import { deriveFacts, normalizeInput } from "../lib/intake-genie-core.mjs";
import { isBoundContainedSourceProof } from "../../factory/lib/media-intelligence.mjs";

const genericSharePhoto = "https://s.yimg.com/bj/portrait-excavator-job.jpg";
assert.equal(isLikelyLogoUrl(genericSharePhoto), false);
assert.equal(isTrustedLogoAsset({ kind: "logo", url: genericSharePhoto, origin: "source-intake", approved: true }), false);
assert.equal(isLikelyLogoUrl("https://cdn.example.com/assets/howie-brand-logo.png"), true);
assert.equal(isTrustedLogoAsset({ kind: "logo", url: genericSharePhoto, origin: "source-intake", approved: true, meta: { logo_evidence: "logo-markup" } }), true);

const thumb = "https://img1.wsimg.com/isteam/ip/acme/IMG_4840.jpg/:/rs=w:70,h:70,cg:true,m/cr=w:70,h:70";
const large = "https://img1.wsimg.com/isteam/ip/acme/IMG_4840.jpg/:/rs=w:1600,h:1000,cg:true,m/cr=w:1600,h:1000";
const duplicate = "https://img1.wsimg.com/isteam/ip/acme/IMG_4840.jpg/:/rs=w:1200,h:750";
const wixBlurred = "https://static.wixstatic.com/media/82bb0d30b19f4ae1b53a0d6b84c13065.jpg/v1/fill/w_180,h_120,al_c,q_80,usm_0.66_1.00_0.01,blur_3,enc_avif,quality_auto/82bb0d30b19f4ae1b53a0d6b84c13065.jpg";
const wixLarge = "https://static.wixstatic.com/media/82bb0d30b19f4ae1b53a0d6b84c13065.jpg/v1/fill/w_1800,h_1200,al_c,q_90,enc_avif,quality_auto/82bb0d30b19f4ae1b53a0d6b84c13065.jpg";
const wixOriginal = "https://static.wixstatic.com/media/82bb0d30b19f4ae1b53a0d6b84c13065.jpg";
const wixLogoDerivative = "https://static.wixstatic.com/media/first-rate-logo.png/v1/fill/w_220,h_90,al_c,q_80,blur_2,enc_avif,quality_auto/first-rate-logo.png";
const wixLogoOriginal = "https://static.wixstatic.com/media/first-rate-logo.png";
assert.equal(isUsableSourcePhotoUrl(thumb), false);
assert.equal(isUsableSourcePhotoUrl(large), true);
assert.equal(sourceAssetIdentity(large), sourceAssetIdentity(duplicate));
assert.equal(normalizeSourcePhotoUrl(wixBlurred), wixOriginal);
assert.equal(sourceAssetIdentity(wixBlurred), sourceAssetIdentity(wixLarge));
assert.equal(sourceAssetIdentity(wixLarge), sourceAssetIdentity(wixOriginal));
assert.equal(isUsableSourcePhotoUrl(wixBlurred), true);
const wixLogoAssets = sanitizeSourceAssets([
  {
    kind: "logo",
    url: wixLogoDerivative,
    approved: true,
    source: "business-site",
    origin: "business-evidence",
    meta: { logo_evidence: "logo-markup" },
    provenance: {
      source_url: "https://first-rate.example/",
      source_host: "first-rate.example",
      owner_key: "first-rate",
    },
  },
  { kind: "photo", url: wixLogoDerivative, approved: true, source: "business-site" },
]);
assert.equal(wixLogoAssets.length, 1);
assert.equal(wixLogoAssets[0].kind, "logo");
assert.equal(wixLogoAssets[0].url, wixLogoOriginal);
assert.equal(wixLogoAssets[0].provenance.source_url, "https://first-rate.example/");
assert.equal(sanitizeSourceAssets([{
  kind: "logo",
  url: `${wixLogoDerivative}?token=secret`,
  approved: true,
  meta: { logo_evidence: "logo-markup" },
}]).length, 0);
assert.equal(isUsableSourcePhotoUrl("https://img1.wsimg.com/isteam/stock/Y8ODPdQ.jpg"), false);
assert.equal(isUsableSourcePhotoUrl("https://loremflickr.com/600/400/landscaping,lawn,garden/?lock=123"), false);
assert.equal(isUsableSourcePhotoUrl("https://www.google.com/maps/vt?key=public-browser-key&token=123"), false);
assert.equal(isTrustedLogoAsset({ kind: "logo", url: "https://cdn.jobber.com/logos/logo_jobber_powered-by.svg", origin: "source-intake", approved: true, meta: { logo_evidence: "logo-markup" } }), false);
assert.equal(normalizeSourceEmail("%20RoofingFormulaNW@outlook.com"), "roofingformulanw@outlook.com");
assert.equal(normalizeSourceEmail("605@sentry-next.wixpress.com"), "");
assert.equal(normalizeSourceEmail("office@firstrateroofingservices.com"), "office@firstrateroofingservices.com");
assert.deepEqual(
  normalizeSourceFonts({ heading: "'Oswald', sans-serif", body: ["Merriweather", "serif"] }),
  ["Oswald", "Merriweather"],
);

const officialRecoveredLogo = "https://www.brighthomelandscapes.com/wp-content/uploads/2024/01/bright-home-white.png";
const nonIdentityAsset = "https://www.brighthomelandscapes.com/wp-content/uploads/2024/01/low-res-discount-light-green.png";
const projectAsset = "https://www.brighthomelandscapes.com/wp-content/uploads/2024/01/bright-home-project-white.png";
const offOriginAsset = "https://cdn.example.net/bright-home-white.png";
const logoRecovery = {
  facts: { name: "Bright Home Landscapes", website: "https://www.brighthomelandscapes.com/?utm_source=googlemybusinesspage" },
  found: { logo: null, photos: [officialRecoveredLogo, nonIdentityAsset, projectAsset, offOriginAsset] },
  assets: [
    { kind: "photo", url: officialRecoveredLogo, source: "business-site", origin: "business-evidence", approved: true, meta: { dimensions: { width: 400, height: 245 }, width: 400, height: 245, treatment: "family-duotone", fallback_to_ambiance: true } },
    { kind: "photo", url: nonIdentityAsset, source: "business-site", origin: "business-evidence", approved: true, meta: { dimensions: { width: 400, height: 245 } } },
    { kind: "photo", url: projectAsset, source: "business-site", origin: "business-evidence", approved: true, meta: { dimensions: { width: 400, height: 245 } } },
    { kind: "photo", url: offOriginAsset, source: "business-site", origin: "business-evidence", approved: true, meta: { dimensions: { width: 400, height: 245 } } },
  ],
  summary: { logo_found: false, photos_found: 4, notes: [] },
};
promoteIdentityMatchedSourceLogo(logoRecovery);
const recoveredLogoAsset = logoRecovery.assets.find((asset) => asset.url === officialRecoveredLogo);
assert.equal(recoveredLogoAsset.kind, "logo");
assert.equal(recoveredLogoAsset.meta.logo_evidence, "identity-matched-business-site-mark");
assert.equal(recoveredLogoAsset.meta.treatment, "brand-fit");
assert.equal(recoveredLogoAsset.meta.fallback_to_ambiance, undefined);
assert.equal(isTrustedLogoAsset(recoveredLogoAsset), true);
assert.equal(logoRecovery.found.logo, officialRecoveredLogo);
assert.equal(logoRecovery.found.photos.includes(officialRecoveredLogo), false);
assert.equal(logoRecovery.summary.logo_found, true);
assert.equal(logoRecovery.summary.photos_found, 3);
assert.equal(logoRecovery.assets.filter((asset) => asset.url === officialRecoveredLogo).length, 1);
assert.equal(logoRecovery.assets.find((asset) => asset.url === nonIdentityAsset).kind, "photo");
assert.equal(logoRecovery.assets.find((asset) => asset.url === projectAsset).kind, "photo");
assert.equal(logoRecovery.assets.find((asset) => asset.url === offOriginAsset).kind, "photo");

const oversizedIdentityAsset = "https://www.brighthomelandscapes.com/wp-content/uploads/2024/01/bright-home-white.webp";
const oversizedLogoRecovery = {
  facts: logoRecovery.facts,
  found: { logo: null, photos: [oversizedIdentityAsset] },
  assets: [{ kind: "photo", url: oversizedIdentityAsset, source: "business-site", origin: "business-evidence", approved: true, meta: { dimensions: { width: 1600, height: 900 } } }],
  summary: { logo_found: false, photos_found: 1, notes: [] },
};
promoteIdentityMatchedSourceLogo(oversizedLogoRecovery);
assert.equal(oversizedLogoRecovery.assets[0].kind, "photo");
assert.equal(oversizedLogoRecovery.found.logo, null);

const bridgedGhostAssets = recoverAuthenticatedGhostLogo(
  [{ kind: "photo", url: "https://www.brighthomelandscapes.com/wp-content/uploads/2024/02/IMG_4711-scaled.jpg", source: "business-site", origin: "business-evidence", approved: true, width: 1200, height: 800 }],
  [
    { kind: "photo", url: officialRecoveredLogo, source: "business-site", origin: "business-evidence", approved: true, width: 400, height: 245, meta: { treatment: "family-duotone", fallback_to_ambiance: true } },
    ...logoRecovery.assets.filter((asset) => asset.url !== officialRecoveredLogo),
  ],
  logoRecovery.facts,
);
assert.equal(bridgedGhostAssets[0].kind, "logo");
assert.equal(bridgedGhostAssets[0].url, officialRecoveredLogo);
assert.equal(bridgedGhostAssets.filter((asset) => asset.url === officialRecoveredLogo).length, 1);
assert.equal(bridgedGhostAssets.some((asset) => asset.kind === "photo" && asset.url === officialRecoveredLogo), false);
assert.equal(bridgedGhostAssets.some((asset) => asset.kind === "photo" && asset.url.includes("IMG_4711")), true);
assert.equal(bridgedGhostAssets.length, 2);

const dimensionlessGhostAssets = recoverAuthenticatedGhostLogo(
  [],
  [{ kind: "photo", url: officialRecoveredLogo, source: "business-site", origin: "business-evidence", approved: true }],
  logoRecovery.facts,
);
assert.equal(dimensionlessGhostAssets[0].kind, "logo");
assert.equal(dimensionlessGhostAssets[0].url, officialRecoveredLogo);
assert.equal(dimensionlessGhostAssets[0].meta.logo_evidence, "identity-matched-business-site-mark");

const dimensionlessHeaderAsset = recoverAuthenticatedGhostLogo([], [
  { kind: "photo", url: "https://www.brighthomelandscapes.com/wp-content/uploads/2024/01/bright-home-header.png", source: "business-site", origin: "business-evidence", approved: true },
], logoRecovery.facts);
assert.equal(dimensionlessHeaderAsset.length, 0);

const offOriginGhostAssets = recoverAuthenticatedGhostLogo([], [
  { kind: "photo", url: offOriginAsset, source: "business-site", origin: "business-evidence", approved: true, width: 400, height: 245 },
], logoRecovery.facts);
assert.equal(offOriginGhostAssets.some((asset) => asset.kind === "logo"), false);
assert.equal(offOriginGhostAssets.length, 0);

const typedUpstreamLogo = recoverAuthenticatedGhostLogo([], [
  { kind: "logo", url: "https://evil.example/bright-home-white.png", source: "business-site", origin: "business-evidence", approved: true, width: 400, height: 245 },
], logoRecovery.facts);
assert.equal(typedUpstreamLogo.length, 0);

const authenticatedGhostUpload = recoverAuthenticatedGhostLogo([
  { kind: "logo", url: "https://evil.example/tekline-logo.png", source: "business-site", origin: "business-evidence", approved: true, meta: { logo_evidence: "logo-markup" } },
], [
  { kind: "logo", url: "https://uploads.wss-ai.com/customer/acme-logo.svg", source: "upload", origin: "upload", approved: true },
], { name: "Acme Lawn Services", website: "https://acmelawn.example" });
assert.equal(authenticatedGhostUpload.filter((asset) => asset.kind === "logo").length, 1);
assert.equal(authenticatedGhostUpload[0].url, "https://uploads.wss-ai.com/customer/acme-logo.svg");
assert.equal(authenticatedGhostUpload[0].provenance.authenticated_owner_upload, true);

const ghostOnlyGenericPhoto = recoverAuthenticatedGhostLogo([], [
  { kind: "photo", url: "https://www.brighthomelandscapes.com/wp-content/uploads/2024/02/IMG_5417-scaled.jpg", source: "business-site", origin: "business-evidence", approved: true, width: 1200, height: 800 },
], logoRecovery.facts);
assert.equal(ghostOnlyGenericPhoto.length, 0);

const freshCompiledLogo = "https://www.brighthomelandscapes.com/wp-content/uploads/2026/07/bright-home-logo.png";
const freshLogoWins = recoverAuthenticatedGhostLogo([
  { kind: "logo", url: freshCompiledLogo, source: "business-site", origin: "business-evidence", approved: true, width: 480, height: 240, meta: { logo_evidence: "logo-markup" } },
], [
  { kind: "photo", url: officialRecoveredLogo, source: "business-site", origin: "business-evidence", approved: true, width: 400, height: 245 },
], logoRecovery.facts);
assert.equal(freshLogoWins.filter((asset) => asset.kind === "logo").length, 2);
assert.equal(freshLogoWins[0].url, freshCompiledLogo);
assert.equal(freshLogoWins.some((asset) => asset.url === officialRecoveredLogo), true);

const publicSuffixContext = recoverAuthenticatedGhostLogo([], [
  { kind: "photo", url: "https://evil.com/bright-home-white.png", source: "business-site", origin: "business-evidence", approved: true, width: 400, height: 245 },
], { name: "Bright Home Landscapes", website: "https://com" });
assert.equal(publicSuffixContext.length, 0);

const countryPublicSuffixContext = recoverAuthenticatedGhostLogo([], [
  { kind: "photo", url: "https://evil.co.uk/bright-home-white.png", source: "business-site", origin: "business-evidence", approved: true, width: 400, height: 245 },
], { name: "Bright Home Landscapes", website: "https://co.uk" });
assert.equal(countryPublicSuffixContext.length, 0);

const publicAssets = sanitizeSourceAssets([
  { kind: "photo", url: "https://www.google.com/maps/vt?key=should-not-escape&token=123", source: "firecrawl", approved: true },
  { kind: "photo", url: "https://cdn.example.com/barriga-yard.webp", source: "firecrawl", origin: "source-intake", approved: true, provenance: { source_url: "https://barrigalandscaping.example/gallery", source_host: "barrigalandscaping.example", owner_key: "barriga" }, meta: { treatment: "family-duotone", local_path: "C:/private/file.webp" } },
]);
assert.equal(publicAssets.length, 1);
assert.equal(publicAssets[0].source, "business-site");
assert.equal(publicAssets[0].origin, "business-evidence");
assert.deepEqual(publicAssets[0].provenance, { source_url: "https://barrigalandscaping.example/gallery", source_host: "barrigalandscaping.example", owner_key: "barriga", source: "firecrawl", origin: "source-intake" });
assert.equal(JSON.stringify(publicAssets).includes("should-not-escape"), false);
assert.equal(JSON.stringify(publicAssets).includes("private/file"), false);
const ownerUpload = sanitizeSourceAssets([{
  kind: "logo",
  url: "https://uploads.wss-ai.com/customer/8f3c1a7e.svg",
  source: "upload",
  origin: "upload",
  approved: true,
}]);
assert.equal(ownerUpload[0].provenance.authenticated_owner_upload, true);
assert.equal(isTrustedLogoAsset(ownerUpload[0]), true);
const ownerUploadPacket = { enrichment_sources: {} };
mergeV7Assets(ownerUploadPacket, ownerUpload);
assert.equal(ownerUploadPacket.v7_logo.url, "https://uploads.wss-ai.com/customer/8f3c1a7e.svg");
assert.equal(ownerUploadPacket.v7_logo.origin, "upload");
assert.equal(socialBelongsToBusiness("https://instagram.com/barrigalandscaping", "Barriga Landscaping", "https://barrigalandscaping.example"), true);
assert.equal(socialBelongsToBusiness("https://x.com/serviceagentai", "Barriga Landscaping", "https://barrigalandscaping.example"), false);

const catalog = sanitizeV7MediaCatalog([
  { kind: "photo", url: thumb, source: "site" },
  { kind: "photo", url: large, source: "site" },
  { kind: "photo", url: duplicate, source: "site" },
  { kind: "photo", url: "https://img1.wsimg.com/isteam/stock/Y8ODPdQ.jpg", source: "site" },
  { kind: "video", url: "https://cdn.example.com/howie-loop.mp4", source: "site" },
]);
assert.equal(catalog.filter((item) => item.kind === "photo").length, 1);
assert.equal(catalog.find((item) => item.kind === "photo").url, large);
assert.equal(catalog.filter((item) => item.kind === "video").length, 1);

const services = extractServices([
  "Services",
  "ServicesCommercialResidentialSyntheticTurf",
  "Street Address",
  "Excavation",
  "Underground Utilities",
  "Retaining Walls",
].join("\n"));
assert.deepEqual(services, ["Excavation", "Underground Utilities", "Retaining Walls"]);
assert.deepEqual(extractServices(
  "We are experienced landscapers that specialize in custom landscaping including; artificial turf, sod, retaining walls, hardscape, and low voltage lighting systems.",
), ["artificial turf", "sod", "retaining walls", "hardscape", "low-voltage lighting systems"]);
assert.deepEqual(cleanServices(extractServices(
  "We are experienced landscapers that specialize in custom landscaping including; artificial turf, sod, retaining walls, hardscape, and low voltage lighting systems.",
), "Uribes Landscaping"), ["artificial turf", "sod", "retaining walls", "hardscape", "low-voltage lighting systems"]);
assert.deepEqual(extractServices("Services include customer service, service areas, design inspiration, and marketing services."), []);
assert.deepEqual(extractServices("Services include artificial turf, customer service."), []);
assert.deepEqual(extractServices("Services include <strong>artificial turf</strong>, sod\u0007."), ["artificial turf", "sod"]);
assert.deepEqual(extractServices(["Marketing services", "Service area", "Customer service", "Design inspiration"].join("\n")), []);
const editorialResources = "Services include landscaping tips, roof installation guides, maintenance documentation, roofing resources, landscaping ideas, plumbing FAQ, repair articles, landscaping blog, HVAC news, and roofing checklists.";
assert.deepEqual(extractServices(editorialResources), []);
assert.deepEqual(cleanServices(extractServices(editorialResources), "Uribes Landscaping"), []);
assert.deepEqual(extractServices([
  "Landscaping Tips",
  "Roof Installation Guides",
  "Maintenance Documentation",
  "Roofing Resources",
  "Landscaping Ideas",
  "Plumbing FAQ",
  "Repair Articles",
  "Landscaping Blog",
  "HVAC News",
  "Roofing Checklists",
].join("\n")), []);
assert.deepEqual(extractServices([
  "Service Description",
  "Tree Removal",
  "Roof Replacement",
].join("\n")), ["Tree Removal", "Roof Replacement"]);
const hvacNavigationAndEditorial = [
  "The Locations We Service",
  "5-Star rated HVAC",
  "Common Problems Requiring AC Heat Pump Repair",
  "How Experts Handle AC Heat Pump Repair",
];
const realHvacServices = [
  "AC Heat Pump Repair",
  "Heat Pump Installation",
  "HVAC Repair & Maintenance",
  "Commercial HVAC Service",
  "24/7 HVAC Repair",
];
assert.deepEqual(extractServices([
  ...hvacNavigationAndEditorial,
  ...realHvacServices,
].join("\n")), realHvacServices);
assert.equal(
  extractSourcePhone("No phone number is listed. Wix asset: https://static.wixstatic.com/media/4423584134abcdef/logo.png"),
  "",
);
assert.equal(extractSourcePhone("Call Mahogany at (442) 358-4134."), "(442) 358-4134");
assert.deepEqual(extractServiceHeadings([
  {
    metadata: { title: "Service Description | Mahogany" },
    html: "<h1>Tree Removal</h1><h2>Roof Replacement</h2>",
    markdown: "# Service Description",
  },
], "Mahogany"), ["Tree Removal", "Roof Replacement"]);
assert.deepEqual(extractServiceHeadings([
  {
    metadata: { title: "5-Star rated HVAC | Acme HVAC" },
    html: `<h1>The Locations We Service</h1>${realHvacServices.map((value) => `<h2>${value}</h2>`).join("")}`,
    markdown: [
      "## Common Problems Requiring AC Heat Pump Repair",
      "## How Experts Handle AC Heat Pump Repair",
    ].join("\n"),
  },
], "Acme HVAC"), realHvacServices);
assert.deepEqual(locationFromAddress("49 Ridgewood Dr, San Rafael CA 94901"), { city: "San Rafael", state: "CA" });
assert.equal(locationFromAddress("Serving the entire Bay Area"), null);
assert.deepEqual(cleanServices([
  "UNDERGROUND UTILITY INSTALLATION",
  "UNDERGROUND UTILITY INSTALLATION-",
  "RETAINING WALLS AND CONCRETE",
  "Service Area",
], "Howie Excavating & Grading"), ["Underground Utility Installation", "Retaining Walls and Concrete"]);
assert.deepEqual(cleanServices([
  "Service Type\\",
  "service type/",
  "Service Type?!",
  "Drain Cleaning",
  "Full-Service Tree Care",
]), ["Drain Cleaning", "Full-Service Tree Care"]);
assert.equal(
  bookingUrlFromCopy("Book online: https://calendly.com/acme-service/estimate."),
  "https://calendly.com/acme-service/estimate",
);
assert.equal(hoursFromAssets([{ kind: "hours", label: "Mon-Fri 8am-5pm" }]), "Mon-Fri 8am-5pm");

const operatorInput = normalizeInput({
  description: "Barriga Landscaping in Sacramento, California. Verified services: lawn care, sprinkler checks, and cleanup visits.",
});
const operatorFacts = deriveFacts(operatorInput).facts;
assert.equal(factsFromDiscovery(operatorInput, operatorFacts, {
  facts: { name: "Barriga Landscaping: Lawn Care & Lawn Maintenance" },
  found: {},
}).name, "Barriga Landscaping");

// URL-only Okie repro: the owned page says "Contact US" after a postal
// address. US is a country/button token, while OK is the observed state.
const okieInput = normalizeInput({ website_url: "https://okieconcrete.com/" });
const okieBase = deriveFacts(okieInput).facts;
const okieDiscovery = {
  facts: { name: "Okie Concrete", website: "https://okieconcrete.com/" },
  sources: ["https://okieconcrete.com/", "https://okieconcrete.com/contact"],
  found: { copy: "156th St, Oklahoma City, OK 73170\nContact US" },
};
const okieMerged = factsFromDiscovery(okieInput, okieBase, okieDiscovery);
assert.deepEqual({ city: okieMerged.city, state: okieMerged.state, source: okieMerged.location_source },
  { city: "Oklahoma City", state: "OK", source: "website-address" });
assert.equal(deriveFacts(normalizeInput({ description: "Contact US" })).facts.state, "");
assert.equal(factsFromDiscovery(okieInput, okieBase, {
  ...okieDiscovery, found: { copy: "Contact US" },
}).state, "");
assert.equal(factsFromDiscovery(okieInput, okieBase, {
  ...okieDiscovery, sources: ["https://other.example/contact"],
}).state, "");
assert.equal(factsFromDiscovery(okieInput, okieBase, {
  ...okieDiscovery, found: { copy: "Oklahoma City, OK 73170\nOklahoma City, TX 75001\nContact US" },
}).state, "");

const originalFetch = globalThis.fetch;
const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
let activeScrapes = 0;
let maxActiveScrapes = 0;
let scrapeCalls = 0;
try {
  process.env.FIRECRAWL_API_KEY = "test-key";
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/map")) {
      return new Response(JSON.stringify({ links: [
        "https://acme.example/about",
        "https://acme.example/services",
        "https://acme.example/gallery",
        "https://acme.example/contact",
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("/scrape")) {
      scrapeCalls += 1;
      activeScrapes += 1;
      maxActiveScrapes = Math.max(maxActiveScrapes, activeScrapes);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeScrapes -= 1;
      return new Response(JSON.stringify({ success: true, data: {
        markdown: "Acme Landscaping serves Irvine with verified landscape maintenance.",
        links: [],
        images: ["https://cdn.acme.example/job-1.webp"],
        branding: {
          logo: "https://cdn.acme.example/acme-logo.png",
          colors: { primary: "#4169e1", accent: "#e09154" },
          fonts: { heading: "Oswald", body: "Merriweather" },
        },
        rawHtml: "",
        metadata: { title: "Acme Landscaping" },
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const timedIntake = await collectSourceIntake({ sources: { website_url: "https://acme.example" } }, {
    name: "Acme Landscaping",
    city: "Irvine",
    state: "CA",
    category: "landscaping",
  });
  assert.equal(timedIntake.summary.pages_read, 5);
  assert.equal(scrapeCalls, 5);
  assert.ok(maxActiveScrapes >= 2, "source pages must be scraped concurrently");
  assert.deepEqual(timedIntake.found.colors, ["#4169E1", "#E09154"]);
  assert.deepEqual(timedIntake.found.fonts, ["Oswald", "Merriweather"]);
} finally {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
}

try {
  delete process.env.FIRECRAWL_API_KEY;
  const websiteUrl = "https://scheme-less.example/";
  const wixLogoDerivativeLive = "https://static.wixstatic.com/media/f183e0_cc897ca5007548218f198a256a1d3e57~mv2.png/v1/crop/x_0,y_771,w_804,h_282/fill/w_143,h_50,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/logo.png";
  const wixLogoSquareLive = "https://static.wixstatic.com/media/f183e0_cc897ca5007548218f198a256a1d3e57~mv2.png/v1/crop/x_0,y_0,w_804,h_774/fill/w_85,h_82,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/logo.png";
  const wixLogoOriginalLive = "https://static.wixstatic.com/media/f183e0_cc897ca5007548218f198a256a1d3e57~mv2.png";
  const googleLogo = "https://static.wixstatic.com/media/google_logo.png/v1/fill/w_96,h_96,al_c,q_80/google_logo.png";
  const facebookLogo = "https://static.wixstatic.com/media/Facebook_f_logo.png/v1/fill/w_96,h_96,al_c,q_80/Facebook_f_logo.png";
  const secondaryMark = "https://static.wixstatic.com/media/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png";
  const secondaryCrops = [
    `${secondaryMark}/v1/crop/x_0,y_0,w_1060,h_1006/fill/w_93,h_88,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png`,
    `${secondaryMark}/v1/crop/x_1069,y_0,w_1060,h_1006/fill/w_93,h_88,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png`,
    `${secondaryMark}/v1/crop/x_2111,y_0,w_889,h_1006/fill/w_78,h_88,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png`,
  ];
  const projectPhotos = Array.from({ length: 16 }, (_, index) => `${websiteUrl}assets/finished-roof-${String(index + 1).padStart(2, "0")}.webp`);
  globalThis.fetch = async (url) => {
    if (String(url).includes("pagehub-intake-lock-form")) {
      return new Response(JSON.stringify({
        ok: true,
        extracted: {
          brandName: "Scheme Less Roofing",
          domainUrl: "scheme-less.example",
          exactServices: [
            ...hvacNavigationAndEditorial,
            "Roof Repair",
            "Roof Installation",
          ].join("\n"),
          logoLink: wixLogoDerivativeLive,
          logoCandidates: [
            { url: wixLogoDerivativeLive, alt: "Scheme Less Roofing logo" },
            { url: googleLogo, alt: "Google logo", width: 96, height: 96 },
            { url: facebookLogo, alt: "Facebook f logo", width: 96, height: 96 },
            secondaryMark,
          ],
          imageCandidates: [
            { url: wixLogoDerivativeLive, alt: "Scheme Less Roofing logo" },
            { url: googleLogo, alt: "Google logo", width: 96, height: 96 },
            { url: facebookLogo, alt: "Facebook f logo", width: 96, height: 96 },
            secondaryMark,
            ...projectPhotos.map((url) => ({ url, alt: "Finished roof project" })),
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url) === websiteUrl) {
      return new Response(`<!doctype html><title>Scheme Less Roofing</title>
        <header>
          <a href="${websiteUrl}"><img width="85" height="82" src="${wixLogoSquareLive}" alt="logo.png"></a>
          <a href="${websiteUrl}"><img width="143" height="50" src="${wixLogoDerivativeLive}" alt="logo.png"></a>
        </header>
        <main>
          <div title="Screenshot_20240912_234046_Chrome_edited.png">
            <img width="93" height="88" src="${secondaryCrops[0]}" alt="Logo">
            <img width="93" height="88" src="${secondaryCrops[1]}" alt="Logo">
            <img width="78" height="88" src="${secondaryCrops[2]}" alt="Logo">
          </div>
          ${projectPhotos.map((photo) => `<img src="${photo}" alt="Finished roof project">`).join("\n")}
        </main>
        <footer>
          <img class="google-logo" width="96" height="96" src="${googleLogo}" alt="Google logo">
          <img class="facebook-logo" width="96" height="96" src="${facebookLogo}" alt="Facebook f logo">
        </footer>
        <p>Scheme Less Roofing provides roof repair in Spokane.</p>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const schemeLessIntake = await collectSourceIntake({
    sources: { website_url: websiteUrl },
  }, {
    name: "Scheme Less Roofing",
    city: "Spokane",
    state: "WA",
    category: "roofing",
  });
  const selectedLogo = schemeLessIntake.assets.find((asset) => asset.kind === "logo" && asset.approved);
  assert.equal(selectedLogo?.url, wixLogoOriginalLive);
  assert.equal(schemeLessIntake.found.logo, wixLogoOriginalLive);
  assert.deepEqual(
    schemeLessIntake.assets.filter((asset) => asset.kind === "logo").map((asset) => asset.url),
    [wixLogoOriginalLive],
  );
  assert.deepEqual(schemeLessIntake.found.photos, projectPhotos);
  assert.equal(schemeLessIntake.found.photos.length, 16);
  assert.ok(schemeLessIntake.found.services.includes("Roof Repair"));
  assert.ok(schemeLessIntake.found.services.includes("Roof Installation"));
  assert.equal(
    schemeLessIntake.found.services.some((service) => hvacNavigationAndEditorial.includes(service)),
    false,
  );
  assert.equal(
    schemeLessIntake.assets.some((asset) => [googleLogo, facebookLogo, secondaryMark]
      .some((junk) => sourceAssetIdentity(asset.url) === sourceAssetIdentity(junk))),
    false,
  );
  assert.equal(
    schemeLessIntake.assets.filter((asset) => sourceAssetIdentity(asset.url) === sourceAssetIdentity(wixLogoOriginalLive)).length,
    1,
  );
  assert.equal(
    schemeLessIntake.found.photos.some((url) => sourceAssetIdentity(url) === sourceAssetIdentity(wixLogoOriginalLive)),
    false,
  );
  const logoIds = new Set(schemeLessIntake.assets
    .filter((asset) => asset.kind === "logo")
    .map((asset) => sourceAssetIdentity(asset.url)));
  assert.equal(
    schemeLessIntake.assets.some((asset) => asset.kind === "photo" && logoIds.has(sourceAssetIdentity(asset.url))),
    false,
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
}

try {
  delete process.env.FIRECRAWL_API_KEY;
  const websiteUrl = "https://direct-first-rate.example/";
  const squarePrimary = "https://static.wixstatic.com/media/f183e0_cc897ca5007548218f198a256a1d3e57~mv2.png";
  const squarePrimaryCrop = `${squarePrimary}/v1/crop/x_0,y_0,w_804,h_774/fill/w_85,h_82,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/logo.png`;
  const primaryWordmarkCrop = `${squarePrimary}/v1/crop/x_0,y_771,w_804,h_282/fill/w_143,h_50,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/logo.png`;
  const secondaryMark = "https://static.wixstatic.com/media/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png";
  const secondaryCrops = [
    `${secondaryMark}/v1/crop/x_0,y_0,w_1060,h_1006/fill/w_93,h_88,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png`,
    `${secondaryMark}/v1/crop/x_1069,y_0,w_1060,h_1006/fill/w_93,h_88,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png`,
    `${secondaryMark}/v1/crop/x_2111,y_0,w_889,h_1006/fill/w_78,h_88,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/80ec36_8368a9f38df34e1fabae32deeebfc91c~mv2.png`,
  ];
  const projectPhotos = Array.from({ length: 16 }, (_, index) => `${websiteUrl}assets/project-roof-${String(index + 1).padStart(2, "0")}.webp`);
  globalThis.fetch = async (url) => {
    if (String(url).includes("pagehub-intake-lock-form")) {
      return new Response(JSON.stringify({ ok: false, error: "compiler unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url) === websiteUrl) {
      return new Response(`<!doctype html><title>First Rate Roofing</title>
        <header class="site-header">
          <a href="${websiteUrl}"><img width="85" height="82" src="${squarePrimaryCrop}" alt="logo.png"></a>
          <a href="${websiteUrl}"><img width="143" height="50" src="${primaryWordmarkCrop}" alt="logo.png"></a>
        </header>
        <main>
          <div title="Screenshot_20240912_234046_Chrome_edited.png">
            <img width="93" height="88" src="${secondaryCrops[0]}" alt="Logo">
            <img width="93" height="88" src="${secondaryCrops[1]}" alt="Logo">
            <img width="78" height="88" src="${secondaryCrops[2]}" alt="Logo">
          </div>
          ${projectPhotos.map((photo) => `<img src="${photo}" alt="Completed roof project">`).join("\n")}
        </main>
        <p>First Rate Roofing provides roof repair in Spokane.</p>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const directSquareIntake = await collectSourceIntake({
    sources: { website_url: websiteUrl },
  }, {
    name: "First Rate Roofing",
    city: "Spokane",
    state: "WA",
    category: "roofing",
  });
  assert.equal(directSquareIntake.summary.mode, "direct-source-intake");
  assert.equal(directSquareIntake.found.logo, squarePrimary);
  assert.deepEqual(
    directSquareIntake.assets.filter((asset) => asset.kind === "logo").map((asset) => asset.url),
    [squarePrimary],
  );
  assert.deepEqual(directSquareIntake.found.photos, projectPhotos);
  assert.equal(directSquareIntake.found.photos.length, 16);
  assert.equal(
    directSquareIntake.assets.some((asset) => asset.kind === "photo" && sourceAssetIdentity(asset.url) === sourceAssetIdentity(squarePrimary)),
    false,
  );
  assert.equal(
    directSquareIntake.assets.some((asset) => sourceAssetIdentity(asset.url) === sourceAssetIdentity(secondaryMark)),
    false,
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
}

try {
  delete process.env.FIRECRAWL_API_KEY;
  globalThis.fetch = async (url) => {
    if (String(url).includes("pagehub-intake-lock-form")) {
      return new Response(JSON.stringify({ ok: false, error: "compiler unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url) === "https://acmelawn.example/") {
      return new Response(`<!doctype html><title>Acme Lawn Services</title>
        <img class="brand-logo" src="/media/acme-logo.png" alt="Acme Lawn Services logo">
        <img src="/media/acme-yard.webp" alt="Lawn project">
        <img src="/media/pixel.gif"
          srcset="https://static.wixstatic.com/media/high-quality-project.jpg/v1/fill/w_1600,h_1067,al_c,q_90,enc_avif,quality_auto/high-quality-project.jpg 1600w, https://static.wixstatic.com/media/low-quality-project.jpg/v1/fill/w_320,h_213,al_c,q_80,blur_3,enc_avif,quality_auto/low-quality-project.jpg 320w"
          alt="Completed roof">
        <p>Acme Lawn Services provides lawn maintenance and irrigation repair in Irvine.</p>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const directFallback = await collectSourceIntake({
    sources: { website_url: "https://acmelawn.example/" },
  }, {
    name: "Acme Lawn Services",
    city: "Irvine",
    state: "CA",
    category: "landscaping",
  });
  const directLogo = directFallback.assets.find((asset) => asset.kind === "logo");
  assert.equal(directFallback.summary.mode, "direct-source-intake");
  assert.equal(directFallback.facts.name, "Acme Lawn Services");
  assert.equal(directFallback.found.photos.includes("https://static.wixstatic.com/media/high-quality-project.jpg"), true);
  assert.equal(directFallback.found.photos.includes("https://static.wixstatic.com/media/low-quality-project.jpg"), false);
  assert.equal(directLogo.provenance.owner_key, "acme");
  assert.equal(directLogo.provenance.source_host, "acmelawn.example");
  const guarded = enforceBusinessTruth({
    business: { name: directFallback.facts.name, category: "landscaping", city: "Irvine", state: "CA" },
    services: ["Lawn maintenance"],
    v7_logo: { url: directLogo.url, origin: directLogo.origin },
  }, { sourceAssets: directFallback.assets });
  assert.equal(guarded.logo_source.url, directLogo.url);
} finally {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
}

async function runVerifiedGbpFallbackCase({ sitePhoto = false, gbpIdentityMatches = true, gbpMarkdown = "" } = {}) {
  const websiteUrl = "https://practical-plumbing.example/";
  const gbpUrl = "https://www.google.com/maps/place/?q=place_id:verified-practical";
  const logoUrl = `${websiteUrl}images/logo.png`;
  const sitePhotoUrl = `${websiteUrl}images/completed-water-heater.webp`;
  const gbpPhotoUrl = "https://lh3.googleusercontent.com/p/verified-practical-photo=w1200";
  let gbpScrapes = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : {};
    if (target.endsWith("/map")) {
      return new Response(JSON.stringify({ success: true, links: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/scrape") && body.url === websiteUrl) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          markdown: "# Practical Plumbing\nKilleen plumbing and water heater service.\n(254) 768-9043",
          links: [],
          images: [
            { url: logoUrl, alt: "Practical Plumbing logo", context: "header brand logo" },
            ...(sitePhoto ? [{ url: sitePhotoUrl, alt: "Completed water heater installation", context: "project gallery" }] : []),
          ],
          branding: { logo: logoUrl },
          rawHtml: "",
          metadata: { title: "Practical Plumbing" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.endsWith("/scrape") && body.url === gbpUrl) {
      gbpScrapes += 1;
      return new Response(JSON.stringify({
        success: true,
        data: {
          markdown: gbpMarkdown || (gbpIdentityMatches
            ? "# Practical Plumbing\n1002 E Elms Rd Ste 103, Killeen, TX 76542\n[Call](tel:+12547689043)"
            : "# Wrong Company\nAustin, TX\n[Call](tel:+15125550199)"),
          links: [gbpPhotoUrl],
          images: [],
          branding: {},
          rawHtml: "",
          metadata: { title: gbpIdentityMatches ? "Practical Plumbing" : "Wrong Company" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${target} ${body.url || ""}`);
  };
  const result = await collectSourceIntake({
    sources: { website_url: websiteUrl, gbp_url: gbpUrl },
  }, {
    name: "Practical Plumbing",
    city: "Killeen",
    state: "TX",
    phone: "(254) 768-9043",
    category: "plumbing",
  });
  return { result, gbpScrapes, gbpPhotoUrl, sitePhotoUrl, gbpUrl };
}

try {
  process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
  const recovered = await runVerifiedGbpFallbackCase();
  const recoveredPhoto = recovered.result.assets.find((asset) => asset.kind === "photo");
  assert.equal(recovered.gbpScrapes, 2);
  assert.equal(recoveredPhoto?.url, "https://lh3.googleusercontent.com/p/verified-practical-photo=w1600-h1200");
  assert.equal(recoveredPhoto?.origin, "gbp-deep");
  assert.deepEqual(recoveredPhoto?.meta?.identity_evidence, ["name:practical", "phone:last7"]);
  assert.equal(recoveredPhoto?.meta?.width, undefined);
  assert.equal(recoveredPhoto?.meta?.dimensions, undefined);
  assert.equal(recoveredPhoto?.hero_eligible, undefined);
  assert.equal(recoveredPhoto?.proof_eligible, undefined);
  assert.equal(recoveredPhoto?.provenance?.source_url, recovered.gbpUrl);
  assert.equal(recovered.result.summary.notes.includes("Official website had no approved photo/video; used identity-matched GBP fallback."), true);

  const measuredContained = {
    ...recoveredPhoto,
    width: 450,
    height: 600,
    hero_eligible: false,
    proof_eligible: true,
    meta: {
      ...recoveredPhoto.meta,
      width: 450,
      height: 600,
      dimensions: { width: 450, height: 600 },
      contained_source: true,
      display_policy: "contained-source-proof",
    },
  };
  const sanitizedOnce = sanitizeSourceAssets([measuredContained])[0];
  const sanitizedTwice = sanitizeSourceAssets([sanitizedOnce])[0];
  assert.equal(sanitizedTwice.source, "business-profile");
  assert.equal(sanitizedTwice.hero_eligible, false);
  assert.equal(sanitizedTwice.proof_eligible, true);
  assert.equal(sanitizedTwice.meta.contained_source, true);
  assert.equal(sanitizedTwice.meta.display_policy, "contained-source-proof");
  assert.deepEqual(sanitizedTwice.meta.identity_evidence, ["name:practical", "phone:last7"]);
  assert.equal(sanitizedTwice.meta.source_provenance.source_host, "google.com");
  assert.equal(isBoundContainedSourceProof(sanitizedTwice), true);
  assert.equal(isBoundContainedSourceProof({
    ...sanitizedTwice,
    meta: { ...sanitizedTwice.meta, identity_evidence: ["name:practical", "name:plumbing"] },
  }), false);
  assert.equal(isBoundContainedSourceProof({
    ...sanitizedTwice,
    provenance: { ...sanitizedTwice.provenance, source_host: "example.com" },
    meta: { ...sanitizedTwice.meta, source_provenance: { ...sanitizedTwice.meta.source_provenance, source_host: "example.com" } },
  }), false);
  assert.equal(isBoundContainedSourceProof({
    ...sanitizedTwice,
    provenance: { ...sanitizedTwice.provenance, owner_key: "" },
    meta: { ...sanitizedTwice.meta, source_provenance: { ...sanitizedTwice.meta.source_provenance, owner_key: "" } },
  }), false);
  assert.equal(isBoundContainedSourceProof({
    ...sanitizedTwice,
    provenance: { ...sanitizedTwice.provenance, owner_key: "unrelated-business" },
    meta: { ...sanitizedTwice.meta, source_provenance: { ...sanitizedTwice.meta.source_provenance, owner_key: "unrelated-business" } },
  }), false);
  assert.equal(isBoundContainedSourceProof({
    ...sanitizedTwice,
    provenance: { ...sanitizedTwice.provenance, source_host: "lh3.googleusercontent.com" },
    meta: { ...sanitizedTwice.meta, source_provenance: { ...sanitizedTwice.meta.source_provenance, source_host: "lh3.googleusercontent.com" } },
  }), false);
  const mismatchedOwnerSanitized = sanitizeSourceAssets([{
    ...measuredContained,
    provenance: { ...measuredContained.provenance, owner_key: "unrelated-business" },
  }])[0];
  assert.equal(mismatchedOwnerSanitized.meta?.contained_source, undefined);
  assert.equal(mismatchedOwnerSanitized.meta?.display_policy, undefined);
  assert.equal(mismatchedOwnerSanitized.proof_eligible, undefined);

  const curatedSite = await runVerifiedGbpFallbackCase({ sitePhoto: true });
  assert.equal(curatedSite.gbpScrapes, 1);
  assert.deepEqual(curatedSite.result.found.photos, [curatedSite.sitePhotoUrl]);
  assert.equal(curatedSite.result.assets.some((asset) => asset.origin === "gbp-deep"), false);

  const mismatch = await runVerifiedGbpFallbackCase({ gbpIdentityMatches: false });
  assert.equal(mismatch.gbpScrapes, 2);
  assert.equal(mismatch.result.assets.some((asset) => asset.origin === "gbp-deep"), false);
  assert.equal(mismatch.result.found.photos.length, 0);

  const substringCollision = await runVerifiedGbpFallbackCase({
    gbpMarkdown: "# Impractical Plumbing\n1002 E Elms Rd, Killeenwood, TX\n[Call](tel:+15125550199)",
  });
  assert.equal(substringCollision.result.assets.some((asset) => asset.origin === "gbp-deep"), false);
  assert.equal(substringCollision.result.found.photos.length, 0);
} finally {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
}

console.log("Source intake quality tests: passed");
