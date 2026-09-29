"use strict";

/**
 * test/services-are-services.test.js — the fleet audit of 2026-08-11, locked.
 *
 * 194 hosts were opened in headless Chromium. Of the 100 that were live, 18
 * published a navigation item, a call-to-action button or a membership club
 * inside a schema.org `Service` node, and — because content-inject's
 * seoDescription() leads with `services[0]` — 18 Google snippets opened with one:
 *
 *   "Photo Gallery in Portland, OR. Rated 4.9 from 608 Google reviews."
 *   "Support in Indianapolis, IN. Rated 4.9 from 1210 Google reviews."
 *   "COVID-19 PROTOCOL in Doraville, GA. Rated 4.9 from 162 Google reviews."
 *   "Schedule An in Las Vegas, NV. … Also appointment, air conditioning."
 *
 * Every label below was MEASURED in a live schema.org node, not imagined. Every
 * name in the keep list is a real service off the same fleet or a real service
 * in one of the eleven verticals this engine builds. The two lists together are
 * the contract: refusing the first costs nothing, refusing the second costs a
 * card the client actually sells.
 */

const test = require("node:test");
const assert = require("node:assert");

const { articleHeadlineReason, isSellableServiceName, filterServiceNames } = require("../lib/mirror-engine/service-names");
const {
  harvestPageServices, mergeServiceSources, serviceCandidateReason, servicesFromSchema, servicesFromHeadings,
} = require("../lib/mirror-engine/service-harvest");
const { seoTitle, seoDescription, canonicalPathFor, injectHead, withUsableServices } = require("../lib/mirror-engine/content-inject");
const { serviceFloorReport } = require("../lib/mirror-lane-build");

// --------------------------------------------------------------------------
// 1. THE PREDICATE
// --------------------------------------------------------------------------

// label -> the reason it must be refused. Naming the reason, not just asserting
// a boolean, is what keeps a future rule from refusing the right label for the
// wrong cause and then silently widening.
const MEASURED_ON_THE_FLEET = Object.freeze({
  "Photo Gallery": "navigation_label",
  Products: "navigation_label",
  Support: "navigation_label",
  Resources: "navigation_label",
  "Useful Links for Your Community": "navigation_label",
  "Community Resources": "navigation_label",
  "Useful Community Links": "navigation_label",
  "Community Links & Resources": "navigation_label",
  "Resources for Your Community": "navigation_label",
  Warranties: "navigation_label",
  "Special Offers": "navigation_label",
  "All services": "navigation_label",
  "All Services": "navigation_label",
  "Free Estimate": "navigation_label",
  "Service Estimate": "navigation_label",
  Appointment: "navigation_label",
  "COVID-19 PROTOCOL": "navigation_label",
  "Free Consultation →": "navigation_label",
  "Schedule consultation": "call_to_action",
  "Schedule a Free Consultation": "call_to_action",
  "Schedule An": "call_to_action",
  Commercial: "audience_segment",
  Residential: "audience_segment",
  "Comfort Club": "membership_program",
  "Filter Club": "membership_program",
  "Columbus's Best HVAC Service Club": "membership_program",
  "Link Policy": "policy_page",
  "6 Smart Fence Services For Better Security": "listicle_headline",
});

test("every label measured in a live schema.org Service node is refused, by name", () => {
  for (const [label, reason] of Object.entries(MEASURED_ON_THE_FLEET)) {
    assert.equal(articleHeadlineReason(label), reason, `expected ${reason} for ${JSON.stringify(label)}`);
    assert.equal(isSellableServiceName(label), false);
  }
});

// Real services. Nothing in this file may refuse one of these — that is the
// asymmetry the module's own header commits to.
const REAL_SERVICES = Object.freeze([
  // plumbing
  "Water Heater Repair", "Drain Cleaning", "Sewer Line Replacement", "Hydro Jetting",
  "Slab Leak Detection", "Gas Line Services", "Repiping", "Sump Pumps", "Backflow Testing",
  "Tankless Water Heaters", "Commercial Plumbing", "24/7 Emergency Service",
  "St. Louis Drain Cleaning", "1 Day Bath Remodel", "Whole Home Repiping",
  "Tankless Water Heater Installation and Repair",
  // HVAC — the eight REAL services on Rose City's own live list
  "Furnaces", "Air Conditioners", "Heat Pumps", "Air Quality", "Thermostats",
  "Water Heaters", "Zoning", "Ductless",
  "AC Installation", "Furnace Repair", "Duct Cleaning", "Ductless Mini-Splits",
  // membership plans are NOT refused — see MEMBERSHIP_PROGRAM's own note
  "Family Maintenance Plan", "Chill Maintenance Plan",
  // the other verticals
  "Residential Roofing", "Storm Damage Repair", "Industrial Duct Cleaning",
  "Laser Hair Removal", "Balayage", "Custom Tattoo Design", "Cover-Ups",
  "Stamped Concrete", "New Construction", "Gutter Installation",
  // near misses, deliberately: each contains a refused WORD in a real name
  "Warranty Repairs", "Product Sourcing", "Gallery Wall Installation",
  "Accessibility Remodeling", "Emergency Service", "Contact-Free Estimates",
  "Add-On", "Tune-Up", "Walk-In Tubs", "Mini-Split Systems",
]);

test("not one real service name is refused", () => {
  for (const name of REAL_SERVICES) {
    assert.equal(articleHeadlineReason(name), "", `refused a real service: ${name}`);
  }
});

test("a measurement is not a service — the stat block cannot become a service card", () => {
  // wss-test-noble-plumbing-modesto shipped a schema.org Service node reading
  // "100%", lifted off their own "100% Satisfaction Guaranteed" stat block,
  // which sits in the same heading tags the services harvester reads. The
  // independent scanner blocked the host for it (service_not_a_service).
  // No word-count or question rule could see it: one token, no verb, no "?".
  for (const v of ["100%", "24/7", "5,000+", "$99", "1st", "4.9", "30 min", "2nd", "5k", "8-10"]) {
    assert.equal(articleHeadlineReason(v), "numeric_label", `${JSON.stringify(v)} slipped through`);
  }
  // A number is only junk when it is the WHOLE label. Anything carrying a real
  // word is askable-for and must survive — this half is the guard on the rule.
  for (const v of ["24/7 Emergency Service", "5 Star Drain Cleaning", "Trenchless 2.0", "1st Choice Plumbing", "100% Satisfaction Guarantee"]) {
    assert.notEqual(articleHeadlineReason(v), "numeric_label", `refused a real service: ${v}`);
  }
});

test("contact details are refused by reason while real numeric services survive", () => {
  const contacts = Object.freeze({
    "dispatch@example.com": "contact_email",
    "Email us at service@plumber.example": "contact_email",
    "Contact: office@plumber.example": "contact_email",
    "(505) 555-0123": "contact_phone",
    "+1 505.555.0123": "contact_phone",
    "Call us at 505-555-0123": "contact_phone",
    "Call us today at 505-555-0123": "contact_phone",
    "Phone: 555-0123 ext. 4": "contact_phone",
    "- [(505) 555-0123](tel:5055550123)": "contact_phone",
    "- [Email us](mailto:dispatch@example.com)": "contact_email",
  });
  const realServices = ["24/7 Emergency Plumbing", "5 Star Plumbing", "24000 BTU Installation"];

  for (const [label, reason] of Object.entries(contacts)) {
    assert.equal(articleHeadlineReason(label), reason, `expected ${reason} for ${JSON.stringify(label)}`);
    assert.equal(isSellableServiceName(label), false);
  }
  for (const label of realServices) {
    assert.equal(articleHeadlineReason(label), "", `refused a real numeric service: ${label}`);
    assert.equal(isSellableServiceName(label), true);
  }

  const out = filterServiceNames([...Object.keys(contacts), ...realServices]);
  assert.deepEqual(out.kept, realServices);
  assert.deepEqual(
    out.dropped.map(({ value, reason }) => [value, reason]),
    Object.entries(contacts).map(([value, reason]) => [value.replace(/^[-–—]\s*/, ""), reason]),
  );
});

test("a decorative arrow cannot smuggle a button past a whole-label rule", () => {
  // wss-test-larson-air-conditioning-scottsdale shipped "Free Consultation →".
  // One glyph defeated every anchored rule in the file.
  for (const v of ["Free Consultation →", "Free Consultation »", "Free Consultation >", "• Products"]) {
    assert.ok(articleHeadlineReason(v), `${JSON.stringify(v)} slipped through`);
  }
  // and the glyph strip must not eat a real name
  assert.equal(articleHeadlineReason("A/C Repair"), "");
});

// --------------------------------------------------------------------------
// 1b. THE 2026-09-01 COMET AUDIT (issue #563): the quote-form dropdown.
//
// Pure, Rumsey and Precision all published dropdown options that were not
// services: a marketing banner ("Expert Care from Local Plumbing & HVAC
// Pros"), a training heading ("Ongoing Training"), a customer callout
// ("Las Vegas Plumbing Customers!"), and a donor heading ("Our Commercial
// General Contracting") that reached the list one tokenized word at a time —
// "Our Commercial" / "General" / "Contracting…". Every fragment is refused
// with a reason; every compound a real fleet list carries keeps its words.
// --------------------------------------------------------------------------

test("the tokenized heading behind the Pure and Rumsey dropdowns is refused one fragment at a time", () => {
  const fragments = {
    "Expert Care from Local Plumbing & HVAC Pros": "quality_claim",
    "Ongoing Training": "quality_claim",
    "Our Commercial": "sentence_fragment",
    General: "sentence_fragment",
    "Contracting…": "sentence_fragment",
    Contracting: "sentence_fragment",
  };
  for (const [label, reason] of Object.entries(fragments)) {
    assert.equal(articleHeadlineReason(label), reason, `expected ${reason} for ${JSON.stringify(label)}`);
    assert.equal(isSellableServiceName(label), false);
  }
});

test("an exclamation mark anywhere in a label is marketing punctuation, never a service", () => {
  for (const label of ["Las Vegas Plumbing Customers!", "Half Off This Month!", "Your Local Pros!"]) {
    assert.equal(articleHeadlineReason(label), "quality_claim", `${JSON.stringify(label)} slipped through`);
  }
});

test("the heading-fragment rule keeps every compound the fleet really sells", () => {
  for (const name of ["General Contracting", "Contracting Services", "General Repair", "New Construction"]) {
    assert.equal(articleHeadlineReason(name), "", `refused a real service: ${name}`);
  }
});

// --------------------------------------------------------------------------
// 2. THE HARVEST — the client's own page, not the client's own menu bar
// --------------------------------------------------------------------------

const DECLARED = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HVACBusiness",
  name: "Rose City Heating & Air",
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    itemListElement: [
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Furnace Installation" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Heat Pump Repair" } },
      {
        "@type": "OfferCatalog",
        itemListElement: [{ "@type": "Offer", itemOffered: { "@type": "Service", name: "Ductless Mini-Splits" } }],
      },
    ],
  },
});

const PAGE = `<!doctype html><html><head>
<script type="application/ld+json">${DECLARED}</script>
</head><body>
<nav><a href="/photo-gallery">Photo Gallery</a><a href="/comfort-club">Comfort Club</a></nav>
<h1>Rose City Heating &amp; Air</h1>
<section id="services-grid">
  <h2>Our Services</h2>
  <div><h3>Air Conditioners</h3><p>Copy.</p></div>
  <div><h3>Thermostats</h3><p>Copy.</p></div>
  <div><h3>Water Heaters</h3><p>Copy.</p></div>
  <div><h3>Photo Gallery</h3><p>Not a service, and it is on the page.</p></div>
</section>
<section><h2>Why Choose Us</h2><h3>Family Owned Since 1974</h3></section>
</body></html>`;

test("the declared offer catalogue is read, however the CMS nested it", () => {
  const names = servicesFromSchema([JSON.parse(DECLARED)]);
  assert.deepEqual(names, ["Furnace Installation", "Heat Pump Repair", "Ductless Mini-Splits"]);
});

test("headings are taken from the services section and nowhere else", () => {
  const headings = servicesFromHeadings(PAGE);
  assert.ok(headings.includes("Air Conditioners"), "missed a real card heading");
  assert.ok(headings.includes("Thermostats"));
  assert.ok(!headings.includes("Rose City Heating & Air"), "h1 is the page title, not a service");
  assert.ok(!headings.includes("Our Services"), "the section's own title is not its first card");
});

test("a page with no services section yields no headings at all — never a guess", () => {
  assert.deepEqual(servicesFromHeadings("<html><body><h2>Welcome</h2><h3>Call Today</h3></body></html>"), []);
});

test("the harvest publishes the client's own words and refuses the menu items on the same page", () => {
  const out = harvestPageServices({ html: PAGE, ldNodes: [JSON.parse(DECLARED)] });
  const names = out.services.map((s) => s.name);
  assert.deepEqual(names.slice(0, 3), ["Furnace Installation", "Heat Pump Repair", "Ductless Mini-Splits"],
    "the declared catalogue leads the cards");
  assert.ok(names.includes("Air Conditioners"));
  assert.ok(!names.includes("Photo Gallery"), "a menu item printed inside the services grid is still a menu item");
  assert.ok(out.dropped.some((d) => d.value === "Photo Gallery" && d.reason === "navigation_label"),
    "a shortened list must name its casualties");
  // "Why Choose Us" sits outside the region AND is an advice headline. Either
  // rule alone is enough; both must hold.
  assert.ok(!names.includes("Why Choose Us"));
});

test("navigation is the LAST-ranked source and can never displace the page's own words", () => {
  const out = mergeServiceSources([
    { source: "nav_anchor", names: ["Furnaces", "Air Conditioners"] },
    { source: "page_heading", names: ["Thermostats"] },
    { source: "schema_offer", names: ["Furnace Installation"] },
  ]);
  assert.deepEqual(out.services.map((s) => s.source), ["schema_offer", "page_heading", "nav_anchor", "nav_anchor"]);
  assert.equal(out.services[0].name, "Furnace Installation");
});

test("a duplicate keeps the strongest source it was ever seen under", () => {
  const out = mergeServiceSources([
    { source: "nav_anchor", names: ["Heat Pumps"] },
    { source: "schema_offer", names: ["heat pumps"] },
  ]);
  assert.equal(out.services.length, 1);
  assert.equal(out.services[0].source, "schema_offer");
});

test("the caller's normalizer runs before the gate, so the SEO suffix cannot survive as a duplicate", () => {
  const { stripTrailingLocality } = require("../lib/mirror-engine/verified-facts");
  const out = mergeServiceSources(
    [{ source: "nav_anchor", names: ["Drain Cleaning", "Drain Cleaning in Portland, OR"] }],
    { normalize: stripTrailingLocality },
  );
  assert.deepEqual(out.services.map((s) => s.name), ["Drain Cleaning"]);
});

test("a candidate that is markup, a URL or a novel is refused with a named reason", () => {
  assert.equal(serviceCandidateReason("ok"), "too_short");
  assert.equal(serviceCandidateReason("${child.title}"), "template_token");
  assert.equal(serviceCandidateReason("A B C D E F G H I"), "too_many_words");
  assert.equal(serviceCandidateReason("Drain Cleaning"), "");
});

// --------------------------------------------------------------------------
// 3. THE DOOR — six renderers read one list, so the list is cleaned once
// --------------------------------------------------------------------------

test("withUsableServices strips a menu item before any surface can read it", () => {
  const out = withUsableServices({
    services: [{ name: "Photo Gallery" }, { name: "Comfort Club" }, { name: "Furnaces" }],
  });
  assert.deepEqual(out.services.map((s) => s.name), ["Furnaces"]);
});

test("community resource headings cannot reach the content island, schema, FAQ, meta, or routes", () => {
  const out = withUsableServices({
    services: [{ name: "Useful Links for Your Community" }, { name: "Fence Installation" }],
  });
  assert.deepEqual(out.services.map((service) => service.name), ["Fence Installation"]);
  assert.equal(articleHeadlineReason("Useful Links for Your Community"), "navigation_label");
});

test("utility-heading variants stay out while an actual service survives", () => {
  const out = withUsableServices({
    services: [
      { name: "Useful Community Links" },
      { name: "Community Links & Resources" },
      { name: "Resources for Your Community" },
      { name: "Fence Installation" },
    ],
  });
  assert.deepEqual(out.services.map((service) => service.name), ["Fence Installation"]);
});

test("decorated navigation and resource section headings are never certified as services", () => {
  const headings = [
    "Local Resources for Our Community",
    "About Our Company",
    "Customer Reviews",
    "Frequently Asked Questions",
    "Our Service Areas",
    "Contact Information",
    "Flexible Financing Options",
    "Latest Blog Posts",
    "Community Resource Center",
  ];
  for (const heading of headings) {
    assert.equal(articleHeadlineReason(heading), "navigation_label", `${heading} slipped through`);
  }
  assert.deepEqual(
    filterServiceNames([...headings, "Fence Installation"]).kept,
    ["Fence Installation"],
  );
});

test("section-heading guard does not over-exclude legitimate services", () => {
  const services = [
    "Community Solar Installation",
    "Contact-Free Estimates",
    "Service Area Drainage",
    "Financing Consultation",
    "Resource Conservation Landscaping",
    "Review and Repair Service",
  ];
  for (const service of services) {
    assert.equal(articleHeadlineReason(service), "", `refused a real service: ${service}`);
  }
});

test("the meta description can no longer open with a navigation item", () => {
  // The exact sentence measured on wss-test-rose-city-heating-and-air-portland.
  // Portland is explicit service-area evidence here; the NAP city alone is no
  // longer promoted into "in Portland" copy.
  const facts = { business_name: "Rose City Heating & Air", city: "Portland", service_area: "Portland", state: "OR", rating: 4.9, review_count: 608 };
  const before = seoDescription({ facts, services: [{ name: "Photo Gallery" }, { name: "Comfort Club" }] });
  assert.match(before, /^Photo Gallery in Portland, OR\./, "the defect, reproduced from the source it came from");

  const cleaned = withUsableServices({ services: [{ name: "Photo Gallery" }, { name: "Comfort Club" }, { name: "Furnaces" }] });
  const after = seoDescription({ facts, services: cleaned.services });
  assert.match(after, /^Furnaces in Portland, OR\./);
  assert.doesNotMatch(after, /Photo Gallery|Comfort Club/i);
});

// --------------------------------------------------------------------------
// 4. THE FLOOR — held, with a reason, not published thin
// --------------------------------------------------------------------------

test("the floor of one builds with what's real; only a wholly-junk list is held", () => {
  const three = ["Furnaces", "Heat Pumps", "Thermostats"].map((name) => ({ name }));
  assert.equal(serviceFloorReport({ services: three }).status, "passed");
  assert.equal(serviceFloorReport({ services: three.slice(0, 2) }).status, "passed", "two real services now build");
  assert.equal(serviceFloorReport({ services: three.slice(0, 1) }).status, "passed", "one real service now builds");
  // a list where every label is navigation junk still holds — it would ship
  // "Photo Gallery / Comfort Club" as the client's service list.
  assert.equal(serviceFloorReport({ services: [] }, ["Photo Gallery", "Comfort Club"]).verdict, "all_refused");
});

test("the floor reports what the SOURCES offered, not what survived the door", () => {
  // contentFromVerified strips the menu items upstream, so `content.services`
  // arrives empty. Without the raw labels this check could only say "no services
  // resolved" about a business whose site listed four things.
  const raw = ["Photo Gallery", "Comfort Club", "Filter Club", "Products"];
  const out = serviceFloorReport({ services: [] }, raw);
  assert.equal(out.verdict, "all_refused");
  assert.equal(out.supplied, 4);
  assert.equal(out.publishable, 0);
  assert.match(out.reason, /Photo Gallery=navigation_label/);
});

// --------------------------------------------------------------------------
// 5. THE RAW HEAD — what a link preview reads, and 33 hosts got wrong
// --------------------------------------------------------------------------

const HVAC_FACTS = Object.freeze({
  business_name: "Rose City Heating & Air", industry: "HVAC", city: "Portland", state: "OR",
});
const OTHER_FACTS = Object.freeze({
  business_name: "Harris Air West", industry: "HVAC", city: "Sacramento", state: "CA",
});

// The donor head exactly as it ships: token-free by design, with the generic
// title all 33 hosts published.
const DONOR_HEAD = `<!doctype html><html><head>
<title>HVAC Contractor | AC &amp; Heating Services</title>
<meta name="description" content="Heating and air conditioning services for homes and businesses.">
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
</head><body><div id="root"></div></body></html>`;

const headOf = (facts, rel = "index.html") => injectHead(DONOR_HEAD, {
  facts, logoUrl: "/logo.png", siteUrl: "https://wss-test-x.wss-ai.com/", heroAsset: "", fonts: null, content: {}, rel,
});

test("the raw title names the business and its market, not the trade in general", () => {
  const html = headOf(HVAC_FACTS);
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)[1];
  assert.match(title, /Rose City Heating &amp; Air/);
  assert.match(title, /Portland, OR/);
  assert.doesNotMatch(title, /^HVAC Contractor \| AC/);
  assert.ok(title.length <= 62, `title is ${title.length} chars; search truncates around 60`);
});

test("two different businesses no longer share one byte-identical card", () => {
  const a = /<title>([\s\S]*?)<\/title>/i.exec(headOf(HVAC_FACTS))[1];
  const b = /<title>([\s\S]*?)<\/title>/i.exec(headOf(OTHER_FACTS))[1];
  assert.notEqual(a, b, "33 hosts shipped the same string; that is the defect");
  for (const key of ["og:title", "twitter:title"]) {
    const re = new RegExp(`${key}["'][^>]*content=["']([^"']*)`, "i");
    assert.match(headOf(HVAC_FACTS), re);
    assert.notEqual(re.exec(headOf(HVAC_FACTS))[1], re.exec(headOf(OTHER_FACTS))[1]);
  }
});

test("canonical is this page's URL, never the home page's, and never on the 404", () => {
  assert.equal(canonicalPathFor("index.html"), "/");
  assert.equal(canonicalPathFor("about.html"), "/about");
  assert.equal(canonicalPathFor("service-areas.html"), "/service-areas");
  assert.equal(canonicalPathFor("404.html"), "", "an error page must not claim to be canonical content");

  const home = headOf(HVAC_FACTS, "index.html");
  const about = headOf(HVAC_FACTS, "about.html");
  assert.match(home, /<link rel="canonical" href="https:\/\/wss-test-x\.wss-ai\.com\/"/);
  assert.match(about, /<link rel="canonical" href="https:\/\/wss-test-x\.wss-ai\.com\/about"/);
  // and the sub-page says which page it is
  assert.match(/<title>([\s\S]*?)<\/title>/i.exec(about)[1], /^About —/);
});

test("og:url and og:site_name are emitted, because here the business IS known", () => {
  const html = headOf(HVAC_FACTS);
  assert.match(html, /property="og:url" content="https:\/\/wss-test-x\.wss-ai\.com\/"/);
  assert.match(html, /property="og:site_name" content="Rose City Heating &amp; Air"/);
});

test("a donor that already tokenised its own head is not overwritten", () => {
  // hvac-premier now ships <title>{{BUSINESS_NAME}} | HVAC Contractor in
  // {{CITY}}, {{STATE}} …</title>, which hydrate resolves before this runs. The
  // donor author's phrasing is better than this pass's floor and must survive.
  const hydrated = DONOR_HEAD.replace(
    /<title>[\s\S]*?<\/title>/,
    "<title>Rose City Heating &amp; Air | HVAC Contractor in Portland, OR | AC &amp; Heating</title>",
  );
  const out = injectHead(hydrated, {
    facts: HVAC_FACTS, logoUrl: "/logo.png", siteUrl: "https://wss-test-x.wss-ai.com/", content: {}, rel: "index.html",
  });
  assert.match(out, /<title>Rose City Heating &amp; Air \| HVAC Contractor in Portland, OR \| AC &amp; Heating<\/title>/);
});

test("a social card image that is not on the client's own host is replaced, not republished", () => {
  const leaky = DONOR_HEAD.replace(
    "<meta property=\"og:type\" content=\"website\" />",
    "<meta property=\"og:type\" content=\"website\" /><meta property=\"og:image\" content=\"https://falcon-roof-craft.example/team.jpg\" />",
  );
  const out = injectHead(leaky, {
    facts: HVAC_FACTS, logoUrl: "/logo.png", siteUrl: "https://wss-test-x.wss-ai.com/", content: {}, rel: "index.html",
  });
  assert.doesNotMatch(out, /falcon-roof-craft/, "another company's photo cannot be this client's share card");
  assert.match(out, /property="og:image" content="https:\/\/wss-test-x\.wss-ai\.com\/logo\.png"/);
});

test("seoTitle degrades clause by clause and never emits a hole", () => {
  assert.equal(seoTitle({ facts: {} }), "", "no name, no title — absent beats invented");
  assert.equal(
    seoTitle({ facts: { business_name: "A Very Long Heating And Air Conditioning Company Of Oregon", industry: "HVAC", city: "Portland", state: "OR" } }),
    "A Very Long Heating And Air Conditioning Company Of Oregon",
    "the tail clauses drop; the name is never cut mid-word",
  );
});
