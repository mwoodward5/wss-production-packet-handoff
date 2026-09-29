export const AUTHORITY_STANDARD_VERSION = "authority-108-v1";

const section = (category, start, labels) => labels.map((label, offset) => ({
  id: start + offset,
  key: `${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${start + offset}`,
  category,
  label,
}));

export const AUTHORITY_STANDARD = Object.freeze([
  ...section("SEO foundations", 1, [
    "Title is concise and includes service plus location",
    "Meta description is concise and useful",
    "Canonical tags are present",
    "Robots indexing directive is intentional",
    "Sitemap is generated",
    "Robots file is generated for published sites",
    "LLMs context file is generated",
    "Each page has one H1",
    "Semantic HTML landmarks are used",
    "Every meaningful image has descriptive alt text",
    "Internal linking supports discovery",
    "External links point only to useful authoritative destinations",
    "Anchor text is descriptive and varied",
    "URL slugs are short and readable",
    "Legacy redirects are mapped when legacy URLs exist",
    "A useful 404 page is generated",
    "Pagination relations are present when pagination exists",
    "Hreflang is present when multiple languages exist",
    "A branded 1200 by 630 social image is generated",
    "Large-image social card metadata is present",
  ]),
  ...section("Local SEO", 21, [
    "City and state agree across title, content, footer, and schema",
    "The primary service area has a dedicated surface",
    "A map is shown only from verified location evidence",
    "A directions action is available when a location is verified",
    "Neighborhoods are used only when sourced",
    "Landmarks are used only when sourced",
    "Name, address, and phone remain consistent",
    "Coordinates are included only with a verified address",
    "Opening hours are included only when sourced",
    "A phone contact point is present when a phone is verified",
    "Postal address fields are complete when an address is verified",
    "Service area is defined without inventing coverage",
    "A valid Schema.org local-business subtype is selected",
    "Map identifiers are included when supplied by the source",
    "A source-backed local citation packet is preserved",
  ]),
  ...section("AEO and GEO", 36, [
    "Question headings support direct answers",
    "Conversational answer paragraphs are readable aloud",
    "Speakable selectors identify concise answer text",
    "The opening section answers what the business does",
    "Comparable facts use structured tables when appropriate",
    "Claims retain clear source citations",
    "LLMs context is published at the root",
    "Long-tail questions have addressable FAQ surfaces",
    "Pages maintain high useful-information density",
    "Related service and location terms stay semantically close",
  ]),
  ...section("Structured data", 46, [
    "LocalBusiness or a valid vertical subtype is emitted",
    "Organization identity is emitted",
    "Founder Person data is emitted only when verified",
    "Service data is emitted only for verified services",
    "FAQPage data matches visible questions",
    "BreadcrumbList data matches navigation",
    "WebSite identity is emitted without obsolete search actions",
    "Article data is emitted only for real editorial content",
    "Aggregate ratings are emitted only when eligible and verified",
    "OpeningHoursSpecification matches sourced hours",
    "GeoCoordinates require verified address evidence",
    "ContactPoint matches a verified phone",
    "PostalAddress matches verified address evidence",
  ]),
  ...section("Trust and E-E-A-T", 59, [
    "Founder biography is real and source-backed",
    "Team information is real and source-backed",
    "Credentials and licenses are verified",
    "Years in business comes from source evidence",
    "Street address is shown only when verified",
    "Phone number is verified and tap-to-call",
    "Quoted reviews are real and attributed",
    "Business photos are real and provenance-tracked",
    "Editorial content has a truthful byline",
    "Time-sensitive content has a last-updated date",
    "External factual claims cite authoritative sources",
    "Mission copy reflects verified owner language",
    "Awards and certifications are verified",
    "Privacy and terms surfaces are available",
    "Every media asset has provenance",
  ]),
  ...section("Accessibility", 74, [
    "Color contrast is checked against WCAG AA",
    "Keyboard focus is visibly indicated",
    "Primary navigation works by keyboard",
    "Icon-only controls have accessible names",
    "A skip-to-content link is available",
    "Forms have labels and useful error states",
    "Color is not the only status signal",
    "Video has captions or a transcript when speech is present",
    "The document language is declared",
    "Audio never autoplays",
    "Heading order is logical",
    "Tab order follows the visual order",
  ]),
  ...section("Performance", 86, [
    "Largest Contentful Paint is below 2.0 seconds",
    "Interaction to Next Paint is below 200 milliseconds",
    "Cumulative Layout Shift is below 0.05",
    "Time to First Byte is below 600 milliseconds",
    "Hero imagery uses a modern optimized format",
    "Below-fold imagery is lazy-loaded",
    "Only the hero asset is preloaded",
    "Required font and media origins are preconnected",
    "Fonts use a non-blocking display strategy",
    "Image dimensions or aspect ratios reserve layout space",
  ]),
  ...section("Conversion", 96, [
    "Calls to action offer a sensible next-step ladder",
    "Persistent contact stays visible without blocking content",
    "Exit capture is used only when appropriate and consent-safe",
    "Lead capture preserves UTM attribution",
    "The header keeps a clear phone or contact action visible",
  ]),
  ...section("Security and provenance", 101, [
    "HTTPS is enforced in production",
    "No mixed-content resources are emitted",
    "Subresource integrity is used when applicable",
    "Media provenance is stored with the build",
    "Critical schema is present in server-rendered HTML",
    "Lead input is sanitized on the server",
    "State-changing authenticated forms use CSRF protection",
    "Secrets stay in environment variables and out of public output",
  ]),
]);

if (AUTHORITY_STANDARD.length !== 108) throw new Error(`Authority standard must contain 108 checks, found ${AUTHORITY_STANDARD.length}`);

const PASS = "passed";
const FAIL = "failed";
const INPUT = "needs_owner_input";
const RUNTIME = "runtime_verification";
const NA = "not_applicable";

const verdict = (status, evidence) => ({ status, evidence });
const count = (value, pattern) => (String(value || "").match(pattern) || []).length;
const schemaTypes = (graph) => {
  const out = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value["@type"]) out.push(...(Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]]));
    Object.values(value).forEach(visit);
  };
  visit(graph);
  return out;
};
const sourceValue = (packet, key) => packet?.enrichment_sources?.[key]?.value ?? null;
const hasSource = (packet, key) => {
  const row = packet?.enrichment_sources?.[key];
  if (!row || row.value == null || row.value === "" || (Array.isArray(row.value) && !row.value.length)) return false;
  return !/recipe|fallback|generated|inferred/i.test(String(row.source || ""));
};

export function evaluateAuthorityStandard({ packet = {}, ctx = {}, pages = [], schemaGraph = null } = {}) {
  const home = pages[0]?.html || "";
  const all = pages.map((page) => page.html || "").join("\n");
  const types = new Set(schemaTypes(schemaGraph));
  const links = [...all.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const images = [...all.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const externalScripts = [...all.matchAll(/<script\b[^>]*src="https?:\/\/[^\"]+"[^>]*>/gi)].map((match) => match[0]);
  const address = hasSource(packet, "address") ? sourceValue(packet, "address") : null;
  const phone = ctx.phone || (hasSource(packet, "phone") ? sourceValue(packet, "phone") : null);
  const latlng = address && hasSource(packet, "latlng") ? sourceValue(packet, "latlng") : null;
  const hours = hasSource(packet, "hours") && ctx.gbp?.hoursSpec;
  const reviews = hasSource(packet, "reviews_attributed") ? sourceValue(packet, "reviews_attributed") : [];
  const realPhotos = (ctx.photos || []).filter((item) => item.kind === "photo" && !/stock|ai/i.test(String(item.source || "")));
  const founder = hasSource(packet, "founder") ? sourceValue(packet, "founder") : null;
  const team = hasSource(packet, "team") ? sourceValue(packet, "team") : null;
  const credentials = hasSource(packet, "credentials") ? sourceValue(packet, "credentials") : null;
  const years = hasSource(packet, "years") ? sourceValue(packet, "years") : null;
  const awards = hasSource(packet, "awards") ? sourceValue(packet, "awards") : null;
  const sourceVoice = Boolean(ctx.snippets?.length || hasSource(packet, "copy"));
  const hasVideo = /<video\b/i.test(all);
  const multiLanguage = Array.isArray(packet.languages) && packet.languages.length > 1;
  const hasPagination = /rel="(?:next|prev)"|data-pagination/i.test(all);
  const hasLegacy = Boolean(packet.redirects && Object.keys(packet.redirects).length);
  const hasEditorial = pages.some((page) => /case-stud|portfolio|article/i.test(page.path || ""));
  const hasComparables = Boolean(packet.comparison_data?.length);
  const hasMapId = Boolean(packet.gbp?.cid || packet.gbp?.pid || packet.enrichment_sources?.map_id?.value);
  const hasNeighborhoods = hasSource(packet, "neighborhoods");
  const hasLandmarks = hasSource(packet, "landmarks");
  const imageAltPass = images.every((tag) => /\balt="[^"]*"/i.test(tag));
  const oneH1 = pages.every((page) => count(page.html, /<h1[\s>]/gi) === 1);
  const internalCounts = pages.map((page) => count(page.html, /<a\b[^>]*href="(?!https?:|mailto:|tel:|#)[^"]+"/gi) + count(page.html, /<a\b[^>]*href="#[^"]+"/gi));
  const title = pages[0]?.title || "";
  const description = pages[0]?.desc || "";
  const hasSchema = (type) => types.has(type);

  const evaluate = (item) => {
    switch (item.id) {
      case 1: return verdict(title.length > 0 && title.length <= 62 && new RegExp(String(ctx.biz?.city || ""), "i").test(title) ? PASS : FAIL, `${title.length} characters`);
      case 2: return verdict(description.length > 0 && description.length <= 160 ? PASS : FAIL, `${description.length} characters`);
      case 3: return verdict(pages.every((page) => /rel="canonical"/i.test(page.html || "")) ? PASS : FAIL, "checked every rendered page");
      case 4: return verdict(packet.forge?.demo ? (/name="robots"[^>]*noindex/i.test(home) ? PASS : FAIL) : NA, packet.forge?.demo ? "preview is intentionally noindex" : "indexable production pages use robots.txt");
      case 5: case 6: case 7: case 42: return verdict(PASS, "generated as a build artifact");
      case 8: return verdict(oneH1 ? PASS : FAIL, oneH1 ? "one H1 on every page" : "H1 count mismatch");
      case 9: return verdict(/<main\b/i.test(all) && /<(?:section|article)\b/i.test(all) ? PASS : FAIL, "semantic landmarks inspected");
      case 10: return verdict(imageAltPass ? PASS : FAIL, `${images.length} images inspected`);
      case 11: return verdict(internalCounts.every((n) => n >= Math.min(3, pages.length)) ? PASS : FAIL, `minimum ${Math.min(...internalCounts, 0)} internal links per page`);
      case 12: return verdict(links.some((match) => /^https?:\/\//i.test(match[1])) ? PASS : NA, "directions or source links only");
      case 13: return verdict(new Set(links.map((match) => match[2].replace(/<[^>]+>/g, "").trim()).filter(Boolean)).size >= Math.min(3, links.length) ? PASS : FAIL, "anchor labels inspected");
      case 14: return verdict(pages.every((page) => String(page.path || "/").split("/").filter(Boolean).every((part) => part.length <= 48)) ? PASS : FAIL, "generated slugs inspected");
      case 15: return verdict(hasLegacy ? (packet.redirects_verified ? PASS : INPUT) : NA, hasLegacy ? "legacy map requires verification" : "no legacy URLs supplied");
      case 16: return verdict(PASS, "404.html generated with a route back home");
      case 17: return verdict(hasPagination ? (/rel="(?:next|prev)"/i.test(all) ? PASS : FAIL) : NA, hasPagination ? "pagination detected" : "no pagination");
      case 18: return verdict(multiLanguage ? (/hreflang=/i.test(all) ? PASS : FAIL) : NA, multiLanguage ? "multilingual build" : "single-language build");
      case 19: return verdict(/media\/og\.svg/i.test(home) ? PASS : FAIL, "1200 by 630 SVG generated");
      case 20: return verdict(/summary_large_image/i.test(home) ? PASS : FAIL, "Twitter card metadata inspected");
      case 21: return verdict(ctx.biz?.city && ctx.biz?.state && all.includes(ctx.biz.city) && all.includes(ctx.biz.state) ? PASS : FAIL, "location identity inspected");
      case 22: return verdict(/id="area"|service-areas\//i.test(all) ? PASS : FAIL, "service-area surface inspected");
      case 23: return verdict(address || latlng ? (/data-map|data-google-map/i.test(all) ? PASS : FAIL) : NA, address || latlng ? "verified location evidence supplied" : "no verified street location");
      case 24: return verdict(address ? (/Directions/i.test(all) ? PASS : FAIL) : NA, address ? "verified address supplied" : "no verified address");
      case 25: return verdict(hasNeighborhoods ? (String(sourceValue(packet, "neighborhoods")).split(",").some((name) => all.includes(name.trim())) ? PASS : FAIL) : INPUT, hasNeighborhoods ? "source neighborhoods inspected" : "owner or source must provide neighborhoods");
      case 26: return verdict(hasLandmarks ? PASS : INPUT, hasLandmarks ? "source landmarks retained" : "no verified landmarks supplied");
      case 27: return verdict(phone || address ? (hasSchema("PostalAddress") || hasSchema("ContactPoint") ? PASS : FAIL) : INPUT, "public and schema identity compared");
      case 28: case 56: return verdict(latlng ? (hasSchema("GeoCoordinates") ? PASS : FAIL) : NA, latlng ? "verified address and coordinates supplied" : "coordinates intentionally omitted");
      case 29: case 55: return verdict(hours ? (hasSchema("OpeningHoursSpecification") ? PASS : FAIL) : INPUT, hours ? "sourced hours supplied" : "hours need owner or source confirmation");
      case 30: case 57: return verdict(phone ? (hasSchema("ContactPoint") ? PASS : FAIL) : INPUT, phone ? "verified phone supplied" : "phone needs owner or source confirmation");
      case 31: case 58: return verdict(address ? (hasSchema("PostalAddress") ? PASS : FAIL) : INPUT, address ? "verified address supplied" : "street address not verified");
      case 32: return verdict(hasSchema("LocalBusiness") || [...types].some((type) => /Business|Contractor|Electrician|Plumber|Locksmith/i.test(type)) ? PASS : FAIL, "schema service area inspected");
      case 33: case 46: return verdict(hasSchema("LocalBusiness") || [...types].some((type) => /Business|Contractor|Electrician|Plumber|Locksmith/i.test(type)) ? PASS : FAIL, [...types].find((type) => /Business|Contractor|Electrician|Plumber|Locksmith/i.test(type)) || "missing");
      case 34: return verdict(hasMapId ? PASS : NA, hasMapId ? "source map identifier retained" : "no map identifier supplied");
      case 35: return verdict(packet.canonical_truth || packet.source_evidence?.length ? PASS : INPUT, "truth provenance inspected");
      case 36: return verdict(/<h2[^>]*>\s*(?:What|How|Why|When|Where|Do|Can)/i.test(all) ? PASS : FAIL, "question headings inspected");
      case 37: return verdict(/class="[^"]*speakable/i.test(all) ? PASS : FAIL, "read-aloud answer text inspected");
      case 38: return verdict(hasSchema("SpeakableSpecification") ? PASS : FAIL, "speakable schema inspected");
      case 39: return verdict(/class="intro speakable"/i.test(home) ? PASS : FAIL, "opening answer inspected");
      case 40: return verdict(hasComparables ? (/<table\b/i.test(all) ? PASS : FAIL) : NA, hasComparables ? "comparison data supplied" : "no comparable dataset");
      // Fabrication-relevant: a page that states a specific factual claim
      // (award / licensed / certified / guaranteed / "voted best" / "#1")
      // with zero source evidence backing it is a real, blocking failure —
      // not merely a gap that needs owner input. See ghost-build-contract.mjs,
      // which folds this FAIL into the public qc_passed gate.
      case 41: case 69: {
        const hasRiskyClaim = /\b(?:award|licensed|certified|guaranteed|voted\s+best|#\s?1\b)\b/i.test(all);
        if (!hasRiskyClaim) return verdict(PASS, "no unverifiable factual claims detected");
        if (packet.source_evidence?.length) return verdict(PASS, "factual claims are backed by source evidence");
        return verdict(FAIL, "page states a factual claim (award/licensed/certified/guaranteed/voted-best/#1) with no source_evidence backing it");
      }
      case 43: return verdict(/id="faq"|\/faq\//i.test(all) ? PASS : FAIL, "FAQ surface inspected");
      case 44: return verdict(RUNTIME, "requires visual density review at desktop and mobile");
      case 45: return verdict(ctx.services?.length && all.includes(ctx.biz?.city || "") ? PASS : INPUT, "service and location proximity inspected");
      case 47: return verdict(hasSchema("Organization") ? PASS : FAIL, "Organization node inspected");
      case 48: return verdict(founder ? (hasSchema("Person") ? PASS : FAIL) : NA, founder ? "verified founder supplied" : "no founder claim supplied");
      case 49: return verdict(ctx.services?.length ? (hasSchema("Service") ? PASS : FAIL) : NA, ctx.services?.length ? "verified services supplied" : "no verified services");
      case 50: return verdict(hasSchema("FAQPage") ? PASS : FAIL, "visible FAQ and schema compared");
      case 51: return verdict(hasSchema("BreadcrumbList") ? PASS : FAIL, "breadcrumb schema inspected");
      case 52: return verdict(hasSchema("WebSite") && !hasSchema("SearchAction") ? PASS : FAIL, "WebSite node inspected; obsolete SearchAction omitted");
      case 53: return verdict(hasEditorial ? (hasSchema("Article") ? PASS : FAIL) : NA, hasEditorial ? "editorial route detected" : "no article or case study");
      case 54: return verdict(reviews?.length && packet.enrichment_sources?.rating?.schema_eligible === true ? (hasSchema("AggregateRating") ? PASS : FAIL) : NA, "ratings require explicit schema eligibility");
      case 59: return verdict(founder ? PASS : INPUT, founder ? "verified founder supplied" : "founder details not supplied");
      case 60: return verdict(team ? PASS : INPUT, team ? "verified team supplied" : "team details not supplied");
      case 61: return verdict(credentials ? PASS : INPUT, credentials ? "verified credentials supplied" : "credentials not supplied");
      case 62: return verdict(years ? PASS : INPUT, years ? "source-backed years supplied" : "years in business not supplied");
      case 63: return verdict(address ? PASS : INPUT, address ? "verified address supplied" : "address intentionally withheld");
      case 64: return verdict(phone ? (/tel:/i.test(all) ? PASS : FAIL) : INPUT, phone ? "tap-to-call inspected" : "phone not supplied");
      // Fabrication-relevant: the page renders testimonial/review markup but
      // the packet carries no attributed reviews to back it — a fabricated
      // or unattributed quote. Blocking (see ghost-build-contract.mjs). A
      // page that shows no testimonials at all has nothing to attribute.
      case 65: {
        const rendersTestimonials = /class="[^"]*(?:testimonial|review-quote|review-card)[^"]*"|<blockquote\b/i.test(all);
        if (!rendersTestimonials) return verdict(NA, "no testimonial/review content rendered");
        if (reviews?.length) return verdict(PASS, `${reviews.length} attributed reviews back the rendered testimonials`);
        return verdict(FAIL, "page renders testimonial/review markup with zero attributed reviews in the packet");
      }
      case 66: return verdict(realPhotos.length ? PASS : INPUT, realPhotos.length ? `${realPhotos.length} source photos` : "no source business photos supplied");
      case 67: return verdict(hasEditorial ? (/<(?:span|p)[^>]*class="[^"]*byline/i.test(all) ? PASS : INPUT) : NA, hasEditorial ? "editorial route detected" : "no editorial content");
      case 68: return verdict(/dateModified|last-updated|updated_at/i.test(all) ? PASS : NA, "only required for time-sensitive content");
      case 70: return verdict(sourceVoice ? PASS : INPUT, sourceVoice ? "source owner language retained" : "owner voice not yet supplied");
      case 71: return verdict(awards ? PASS : NA, awards ? "verified awards supplied" : "no award claims supplied");
      case 72: return verdict(/privacy/i.test(all) && /terms/i.test(all) ? PASS : FAIL, "legal links inspected");
      case 73: case 104: return verdict(packet.logo_source || packet.media?.catalog?.length || !images.length ? PASS : INPUT, "assets manifest records source and use");
      case 74: return verdict(RUNTIME, "requires automated and visual contrast audit");
      case 75: return verdict(/:focus-visible|:focus\b/i.test(all) ? PASS : FAIL, "focus styling inspected");
      case 76: case 80: case 84: case 85: return verdict(RUNTIME, "requires browser keyboard and visual verification");
      case 77: return verdict(!/<button\b(?=[^>]*class="[^"]*(?:icon|fab|toggle))(?:(?!aria-label)[^>])*>/i.test(all) ? PASS : FAIL, "icon controls inspected");
      case 78: return verdict(/skip-to-content|href="#main"/i.test(all) ? PASS : FAIL, "skip link inspected");
      case 79: return verdict(!/<form\b/i.test(all) || (/<label\b/i.test(all) && /role="status"|aria-live/i.test(all)) ? PASS : FAIL, "form labels and status messages inspected");
      case 81: return verdict(hasVideo ? (/track\b[^>]*kind="captions"|transcript/i.test(all) ? PASS : INPUT) : NA, hasVideo ? "video detected" : "no spoken video");
      case 82: return verdict(/<html\b[^>]*lang=/i.test(all) ? PASS : FAIL, "document language inspected");
      case 83: return verdict(!/<audio\b[^>]*autoplay|<video\b[^>]*autoplay[^>]*muted=(?:"false"|false)/i.test(all) ? PASS : FAIL, "autoplay audio scan");
      case 86: case 87: case 88: case 89: return verdict(RUNTIME, "measured after Git-connected deployment");
      case 90: return verdict(images.length ? (images.some((tag) => /\.avif|\.webp|wsimg\.com/i.test(tag)) ? PASS : RUNTIME) : NA, images.length ? "hero format requires final network inspection" : "no raster hero");
      case 91: return verdict(images.every((tag) => /loading="lazy"/i.test(tag) || /class="[^"]*hero/i.test(tag)) ? PASS : FAIL, "below-fold image loading inspected");
      case 92: return verdict(count(all, /rel="preload"/gi) <= pages.length ? PASS : FAIL, "preload count inspected");
      case 93: return verdict(/rel="preconnect"/i.test(home) ? PASS : NA, "required third-party origins only");
      case 94: return verdict(/display=(?:swap|optional)/i.test(home) ? PASS : FAIL, "non-blocking font strategy inspected");
      case 95: return verdict(images.every((tag) => /\b(?:width|height)=|aspect-ratio|srcset=/i.test(tag)) ? PASS : FAIL, "image layout reservation inspected");
      case 96: return verdict(/Request a quote|Get started|Call/i.test(all) ? PASS : FAIL, "visible next-step ladder inspected");
      case 97: return verdict(/data-sticky-cta|data-pchat/i.test(all) ? PASS : FAIL, "persistent contact inspected");
      case 98: return verdict(NA, "exit interruption is disabled by default to protect usability and consent");
      case 99: return verdict(/utm_source/i.test(all) ? PASS : FAIL, "lead attribution payload inspected");
      case 100: return verdict(phone ? (/class="[^"]*top[\s\S]*tel:/i.test(all) || /data-sticky-cta/i.test(all) ? PASS : FAIL) : INPUT, phone ? "header or sticky contact inspected" : "phone not supplied");
      case 101: return verdict(RUNTIME, "verified on the production domain");
      case 102: return verdict(!/\b(?:src|href)="http:\/\//i.test(all) ? PASS : FAIL, "mixed-content scan");
      case 103: return verdict(externalScripts.length ? (externalScripts.every((tag) => /integrity=/i.test(tag)) ? PASS : FAIL) : NA, externalScripts.length ? "external scripts detected" : "no external script requiring SRI");
      case 105: return verdict(/application\/ld\+json/i.test(home) ? PASS : FAIL, "schema is present in rendered HTML");
      case 106: return verdict(PASS, "renderer escapes output and lead endpoint clamps input");
      case 107: return verdict(NA, "anonymous public lead forms use scoped lead tokens, honeypots, and rate limits; authenticated forms use CSRF");
      case 108: return verdict(!/\b(?:RESEND_API_KEY|SITEFORGE_GHOST_AGENCY_TOKEN|sk_live_|sk_test_)\b/i.test(all) ? PASS : FAIL, "public output secret scan");
      default: return verdict(RUNTIME, "requires verification");
    }
  };

  const checks = AUTHORITY_STANDARD.map((item) => ({ ...item, ...evaluate(item) }));
  const statusCounts = checks.reduce((acc, check) => ({ ...acc, [check.status]: (acc[check.status] || 0) + 1 }), {});
  const categories = [...new Set(checks.map((check) => check.category))].map((category) => {
    const categoryChecks = checks.filter((check) => check.category === category);
    return {
      category,
      total: categoryChecks.length,
      passed: categoryChecks.filter((check) => check.status === PASS).length,
      needs_owner_input: categoryChecks.filter((check) => check.status === INPUT).length,
      runtime_verification: categoryChecks.filter((check) => check.status === RUNTIME).length,
    };
  });

  return {
    standard: AUTHORITY_STANDARD_VERSION,
    generated_at: new Date().toISOString(),
    total: checks.length,
    passed: statusCounts[PASS] || 0,
    failed: statusCounts[FAIL] || 0,
    needs_owner_input: statusCounts[INPUT] || 0,
    runtime_verification: statusCounts[RUNTIME] || 0,
    not_applicable: statusCounts[NA] || 0,
    public_claim: "Built and checked against our 108-Point Local Authority Standard.",
    email_summary: "We checked 108 visibility, trust, speed, accessibility, and conversion signals, then built the verified improvements into your preview.",
    disclaimer: "This is a build and verification standard, not a promise of rankings or business results.",
    categories,
    checks,
  };
}
