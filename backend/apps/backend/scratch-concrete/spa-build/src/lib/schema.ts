// Schema.org for the WSS donor port — CONTENT-FREE-SAFE and token-guarded.
//
// Rules this file obeys (they are load-bearing, not style):
//   1. Every OPTIONAL token lives inside a [[NEED:TOKEN]]…[[/NEED]] phrase
//      marker that takes the WHOLE property (comma included) when the fact is
//      blank — an ld+json "telephone": "" is a lie in structured data.
//   2. areaServed carries PLACES ({{CITY}}, {{STATE}}) — never the business
//      name. The engine's area fence refuses anything untraceable to this
//      client's own truth.
//   3. No donor claims survive: no priceRange, no GeoCircle radius, no
//      opening hours, no paymentAccepted, no slogan. The engine's shared
//      content injector adds the richer verified graph on real builds.
//
// These are RAW JSON strings (not JSON.stringify'd objects) precisely so the
// phrase markers can span whole properties.

/** LocalBusiness / GeneralContractor graph — every page ships it in <head>. */
export function localBusinessLd(): string {
  return `{"@context":"https://schema.org","@type":"GeneralContractor","name":"{{BUSINESS_NAME}}","image":"/favicon.png",
[[NEED:SITE_URL]]"url":"{{SITE_URL}}",[[/NEED]]
[[NEED:PHONE]]"telephone":"{{PHONE}}",[[/NEED]]
[[NEED:EMAIL]]"email":"{{EMAIL}}",[[/NEED]]
"address":{"@type":"PostalAddress","addressLocality":"{{ADDRESS_CITY}}","addressRegion":"{{STATE}}","addressCountry":"US"},
"areaServed":[{"@type":"City","name":"{{CITY}}"},{"@type":"State","name":"{{STATE}}"}],
[[NEED:PROFILE_URL]]"sameAs":["{{PROFILE_URL}}"],[[/NEED]]
[[NEED:GEO_LAT,GEO_LNG]]"geo":{"@type":"GeoCoordinates","latitude":"{{GEO_LAT}}","longitude":"{{GEO_LNG}}"},[[/NEED]]
"makesOffer":{"@type":"OfferCatalog","name":"Concrete and general contracting services"}}`;
}

/** FAQPage from the SAME neutral template FAQs the page renders (or live FAQs). */
export function faqLd(faqs: { q: string; a: string }[]): string {
  const items = faqs
    .map((f) => `{"@type":"Question","name":${JSON.stringify(f.q)},"acceptedAnswer":{"@type":"Answer","text":${JSON.stringify(f.a)}}}`)
    .join(",");
  return `{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[${items}]}`;
}

/** BreadcrumbList — item urls collapse whole-value when no site url exists. */
export function breadcrumbLd(items: { name: string; path: string }[]): string {
  const entries = items
    .map(
      (it, i) =>
        `{"@type":"ListItem","position":${i + 1},"name":${JSON.stringify(it.name)}[[NEED:SITE_URL]],"item":"{{SITE_URL}}${it.path}"[[/NEED]]}`,
    )
    .join(",");
  return `{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[${entries}]}`;
}

/** WebPage graph for inner routes. */
export function webPageLd(name: string, description: string, path: string): string {
  return `{"@context":"https://schema.org","@type":"WebPage","name":${JSON.stringify(name)},"description":${JSON.stringify(description)}[[NEED:SITE_URL]],"url":"{{SITE_URL}}${path}"[[/NEED]]}`;
}

/** The graph bundle a service page ships: LocalBusiness + Service + FAQ + Breadcrumb. */
export function servicePageLd(
  serviceName: string,
  description: string,
  path: string,
  faqs: { q: string; a: string }[],
  breadcrumbs: { name: string; path: string }[],
): string {
  return `{"@context":"https://schema.org","@graph":[
${localBusinessLd()},
{"@type":"Service","name":${JSON.stringify(serviceName)},"description":${JSON.stringify(description)}[[NEED:SITE_URL]],"url":"{{SITE_URL}}${path}"[[/NEED]],"areaServed":[{"@type":"City","name":"{{CITY}}"},{"@type":"State","name":"{{STATE}}"}],"provider":{"@type":"GeneralContractor","name":"{{BUSINESS_NAME}}"}},
${faqLd(faqs)},
${breadcrumbLd(breadcrumbs)}
]}`;
}

/** Head helper: emit a raw ld+json script tag descriptor. */
export function jsonLd(raw: string) {
  return { type: "application/ld+json", children: raw };
}
