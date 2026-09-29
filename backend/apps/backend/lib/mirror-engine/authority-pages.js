"use strict";

// lib/mirror-engine/authority-pages.js — the multi-page authority layer
// (PROMPT B PHASE 2, engine-side).
//
// Vercel serves real files before the SPA catch-all, so the engine can ship
// genuine static pages beside the compiled donor: /about, /service-areas,
// /faq. Each gets a unique title + meta, BreadcrumbList + Article schema, a
// byline, a dated stamp, internal cross-links, an outbound authoritative
// citation and a structured table. Those are the nine `needs_content` points
// of the 108 stack — earned with real pages instead of asserted.
//
// TRUTH LAW on substance: a page is the prospect's VERIFIED content (their
// story, services, areas, published FAQs) plus clearly-framed GENERAL TRADE
// EDUCATION — knowledge true of the trade, never a claim about this business.
// Nothing is invented to pad length; thin verified material yields a shorter,
// honest page, and the scorer counts only what actually shipped.

const { CONTENT_CSS, normalizeHours, sanitizedFaqs } = require("./content-inject");
const { marketCity } = require("./facts");
const localSeo = require("./local-seo");

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
const jsonEsc = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Wave 4 — the multi-page set. Beyond about/service-areas/faq/team the engine
// now ships one page per VERIFIED service and one page per VERIFIED locality
// (the local-search plan's contentPlan bounds both). Slugs come from the
// service/city name, and these names are reserved so a service called "Team"
// can never shadow a real route — the static file would WIN over the SPA
// catch-all on Vercel, which is exactly how you break a donor's own route.
const RESERVED_PAGE_SLUGS = new Set([
  "index", "404", "about", "service-areas", "service-area", "faq", "faqs", "team",
  "services", "contact", "sitemap", "robots", "privacy", "terms", "login", "admin", "assets",
]);

function slugifyName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

// Category-true trade education. General knowledge only — nothing here
// asserts anything about any particular business.
const TRADE_EDU = {
  roofing: {
    aboutExtra: [
      "A roof is the one system that protects every other part of a building, which is why the way a contractor inspects matters more than the brochure. A thorough look covers flashing, penetrations, valleys and decking — not just the field of shingles — because that is where water actually finds its way in.",
      "Roof lifespan depends more on installation quality and attic ventilation than on the material alone. Poor ventilation cooks shingles from underneath, and incorrect nailing patterns void many manufacturer warranties. The useful questions to ask any roofer are about process and sequence, not only price.",
    ],
    faqExtra: [
      { q: "How often should a roof be inspected?", a: "Industry guidance generally suggests a professional look after any major storm and periodically as a roof ages, because small flashing and sealant failures are far cheaper to correct before water reaches the decking." },
      { q: "What are the warning signs a roof needs attention?", a: "Granules collecting in gutters, shingles that are curling, lifting or missing, daylight visible in the attic, and staining on interior ceilings after rain are all reasons to have a roof looked at." },
    ],
    citation: { href: "https://www.nachi.org/roof-inspection.htm", label: "InterNACHI roof inspection standards" },
    tableCaption: "Typical lifespan ranges by roofing material (industry averages; actual life depends on climate, ventilation and installation quality)",
    table: [
      ["Material", "Typical lifespan", "Notes"],
      ["Asphalt shingle", "15–30 years", "Most common; ventilation strongly affects service life"],
      ["Metal", "40–70 years", "Standing seam generally outlasts exposed-fastener panels"],
      ["Clay or concrete tile", "50–100 years", "Underlayment usually needs renewal sooner than the tile"],
      ["Slate", "75–150 years", "Weight requires adequate framing capacity"],
      ["Single-ply membrane (flat)", "20–30 years", "Seams and terminations are the usual failure points"],
    ],
  },
  plumbing: {
    aboutExtra: [
      "Most plumbing emergencies are the visible end of a slow problem: a supply line that has been weeping behind drywall, a water heater whose anode rod gave up years ago, or a drain line that has been narrowing with scale. The value of a good plumber is largely in catching the slow version before it becomes the loud one.",
      "Water pressure, pipe material and water chemistry interact more than most homeowners expect. Hard water shortens fixture life; pressure above roughly 80 psi stresses every joint in a house. Asking what a plumber measures — not just what they replace — is a fair way to judge one.",
    ],
    faqExtra: [
      { q: "How long does a water heater usually last?", a: "Conventional tank heaters commonly run 8–12 years, and tankless units longer, though both depend heavily on water hardness and whether the unit has been flushed and serviced." },
      { q: "What are the signs of a hidden leak?", a: "An unexplained rise in a water bill, a meter that moves with every fixture closed, warm spots on a floor, or a musty smell in a cabinet are all reasons to have lines checked." },
    ],
    citation: { href: "https://www.epa.gov/watersense/fix-leak-week", label: "US EPA WaterSense — household leaks" },
    tableCaption: "Common service intervals for household plumbing (general maintenance guidance, not a service promise)",
    table: [
      ["Component", "Typical service interval", "Why it matters"],
      ["Water heater flush", "Annually", "Sediment reduces efficiency and shortens tank life"],
      ["Anode rod check", "2–4 years", "A spent rod moves corrosion to the tank itself"],
      ["Supply hoses (washer)", "Replace every 5 years", "Burst hoses are a leading cause of water damage"],
      ["Main shutoff exercise", "Annually", "A seized valve turns a small leak into a large one"],
      ["Drain line inspection", "As symptoms appear", "Slow drains often precede a full blockage"],
    ],
  },
};
function tradeEdu(industry) {
  const key = String(industry || "").toLowerCase();
  for (const [k, v] of Object.entries(TRADE_EDU)) if (key.includes(k)) return v;
  return null;
}

function pageShell({ title, description, canonical, bodyHtml, ld, accentVarsFrom = "/assets/", facts, siteUrl, cssHref, nav }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${esc(canonical)}" />
<meta name="twitter:card" content="summary_large_image" />
${cssHref ? `<link rel="stylesheet" href="${esc(cssHref)}" />` : ""}
<style>${CONTENT_CSS}
body{margin:0;background:#0d0d0c;color:#f2f2ee;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wss-p__bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,.12);max-width:1160px;margin:0 auto}
.wss-p__bar a{color:inherit;text-decoration:none;font-weight:600}
.wss-p__bar nav a{margin-left:1rem;font-weight:500;opacity:.8;font-size:.94rem}
.wss-p__crumbs{max-width:1160px;margin:0 auto;padding:1rem 1.25rem 0;font-size:.8rem;opacity:.6}
.wss-p__meta{max-width:1160px;margin:0 auto;padding:0 1.25rem;font-size:.8rem;opacity:.6}
.wss-p__cite{max-width:1160px;margin:0 auto;padding:0 1.25rem 3rem;font-size:.88rem}
.wss-p__cite a{color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))}
.wss-c__table{width:100%;border-collapse:collapse;font-size:.94rem;margin:1rem 0 0}
.wss-c__table caption{text-align:left;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;opacity:.6;padding-bottom:.6rem}
.wss-c__table th,.wss-c__table td{text-align:left;padding:.55rem .8rem;border-bottom:1px solid rgba(255,255,255,.12);vertical-align:top}
.wss-c__table thead th{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;opacity:.75}
a.wss-p__cta{display:inline-block;margin-top:1.4rem;background:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)));color:hsl(var(--accent-ink,0 0% 100%));padding:.8rem 1.4rem;border-radius:8px;font-weight:700;text-decoration:none}
</style>
<script>try{var m=/--accent:\\s*(\\d+)\\s+(\\d+)%\\s+(\\d+)%/.exec(document.styleSheets?"":"");}catch(e){}</script>
</head>
<body>
<a href="#main" style="position:absolute;left:-9999px;top:auto" onfocus="this.style.left='8px';this.style.top='8px';this.style.background='#fff';this.style.color='#000';this.style.padding='8px';this.style.zIndex=99">Skip to content</a>
<header class="wss-p__bar">
  <a href="/">${esc(facts.business_name)}</a>
  <nav>${(nav || [{ href: "/", label: "Home" }]).map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join("")}${facts.phone_digits ? `<a href="tel:${esc(facts.phone_digits)}">${esc(facts.phone || facts.phone_digits)}</a>` : ""}</nav>
</header>
<main id="main">
${bodyHtml}
</main>
<script type="application/ld+json">${jsonEsc(ld)}</script>
</body>
</html>
`;
}

function breadcrumbsLd(siteUrl, trail) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: siteUrl }]
      .concat(trail.map((t, i) => ({ "@type": "ListItem", position: i + 2, name: t.name, item: siteUrl.replace(/\/$/, "") + t.path }))),
  };
}

function breadcrumbLd(siteUrl, name, path) {
  return breadcrumbsLd(siteUrl, [{ name, path }]);
}

function articleLd({ siteUrl, headline, description, path, facts, dateISO }) {
  return {
    "@type": "Article",
    headline,
    description,
    mainEntityOfPage: siteUrl.replace(/\/$/, "") + path,
    author: { "@type": "Organization", name: facts.business_name },
    publisher: { "@type": "Organization", name: facts.business_name },
    datePublished: dateISO,
    dateModified: dateISO,
    isPartOf: { "@type": "WebSite", url: siteUrl, name: facts.business_name },
  };
}

function tableHtml(edu) {
  if (!edu || !edu.table) return "";
  const [head, ...rows] = edu.table;
  return `<table class="wss-c__table"><caption>${esc(edu.tableCaption)}</caption>
<thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/**
 * build({ facts, phoneDigits, slug, content, research, cssHref, dateISO,
 *         localPlan, maxServicePages, maxServiceAreaPages })
 * -> { files: { "about.html": Buffer, ... }, report }
 *
 * Returns {} when there is not enough verified material for a page to be
 * worth shipping — an empty authority page is worse than none.
 *
 * Wave 4: `localPlan` is the output of lib/local-search-plan.js
 * buildLocalSearchPlan(). Its contentPlan bounds the multi-page set — one
 * page per verified service (maxServicePages, plan default 4) and one page
 * per verified locality beyond the home market (maxServiceAreaPages).
 */
function build({
  facts = {}, phoneDigits = "", slug = "", content = {}, research = null, cssHref = "",
  dateISO = new Date().toISOString().slice(0, 10),
  localPlan = null, maxServicePages = 6, maxServiceAreaPages = 6,
} = {}) {
  const siteUrl = `https://${slug}.wss-ai.com/`;
  // MARKET, not mailing address. These pages are titled, headlined and indexed
  // for the market the business sells into (facts.service_area, asserted by
  // their own site); `napMarket` is the verified locality and is reserved for
  // the map/directions lookups below. See lib/mirror-engine/facts.js marketCity().
  const cityName = marketCity(facts);
  const napCityName = String(facts.city || "").trim();
  const market = [cityName, facts.state].filter(Boolean).join(", ");
  const napMarket = [napCityName, facts.state].filter(Boolean).join(", ");
  const edu = tradeEdu(facts.industry);
  const files = {};
  const report = { pages: [], words: 0, page_labels: {}, skipped_pages: [] };
  const f = { ...facts, phone_digits: phoneDigits };

  const aboutParas = String(content.about || "").split(/\n{2,}/).map(clean).filter(Boolean);
  const services = (content.services || []).map((s) => (typeof s === "string" ? { name: clean(s), description: "" } : { name: clean(s.name), description: clean(s.description) })).filter((s) => s.name);
  const areas = (content.areas || []).map(clean).filter(Boolean);
  // AUDIT 563 BUG D: the /faq page (and the FAQPage schema it ships) used to
  // read `content.faqs` through plain clean() — no cleaner, no cap — so the
  // same fragment-wall answer the injected block refuses rendered here in
  // full. sanitizedFaqs is the one door every render surface shares.
  const faqs = sanitizedFaqs(content.faqs);
  const mission = clean(content.mission || "");
  const foundedYear = Number.isInteger(content.founded_year) ? content.founded_year : null;
  const team = (content.team || []).map((t) => ({ name: clean(t.name), role: clean(t.role), bio: clean(t.bio) })).filter((t) => t.name).slice(0, 12);
  const awards = (content.awards || []).map(clean).filter(Boolean).slice(0, 10);
  const press = (content.press || []).map((x) => ({ label: clean(x.label), href: clean(x.href) })).filter((x) => x.label && x.href).slice(0, 6);
  const reviews = (content.reviews || []).map((r) => ({ author: clean(r.author), text: clean(r.text) })).filter((r) => r.text).slice(0, 3);
  const hoods = research && Array.isArray(research.neighborhoods) ? research.neighborhoods.slice(0, 8) : [];
  const marks = research && Array.isArray(research.landmarks) ? research.landmarks.slice(0, 5) : [];
  const cite = (research && research.authoritative && research.authoritative[0]) || (edu && edu.citation) || null;

  const citeHtml = cite
    ? `<p class="wss-p__cite">Reference: <a href="${esc(cite.href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(cite.label || cite.title || cite.href)}</a></p>`
    : "";
  // A byline is an authorship CLAIM. It may only be made on a page carrying the
  // business's own words; a page assembled from verified facts and general
  // trade guidance gets a date and no byline.
  const stamp = (authored) => `<p class="wss-p__meta">${authored ? `By the ${esc(facts.business_name)} team · ` : ""}Last updated ${esc(dateISO)}</p>`;
  const crumbs = (label) => `<p class="wss-p__crumbs"><a href="/" style="color:inherit">Home</a> › ${esc(label)}</p>`;

  // ---- WAVE 4 PAGE PLANS ---------------------------------------------------
  // Decided up front beside the core four, for the same reason: a link to a
  // page that did not ship resolves to the SPA catch-all, and that is the
  // orphan-link defect this module exists to prevent.
  const normName = (v) => slugifyName(v);
  // One page per verified service. Duplicate slugs collapse to the first
  // service that claimed them ("Roof Repair" vs "roof repair" is one page),
  // and a service whose slug would shadow a reserved route is skipped and
  // recorded, never silently renamed — the operator sees why the page is gone.
  const servicePlan = [];
  const takenSlugs = new Set(RESERVED_PAGE_SLUGS);
  for (const service of services) {
    if (servicePlan.length >= Math.max(0, maxServicePages)) break;
    const sslug = slugifyName(service.name);
    if (!sslug) continue;
    if (takenSlugs.has(sslug)) {
      report.skipped_pages.push({ page: `/${sslug}`, reason: "slug_reserved_or_duplicate" });
      continue;
    }
    takenSlugs.add(sslug);
    servicePlan.push({ service, slug: sslug });
  }
  // One page per VERIFIED locality from the local-search plan — bounded
  // locality chapters, exactly the plan's stated principle. The home market
  // city is skipped (that is what /service-areas already is), and a locality
  // the business does not claim in its own areas list never gets a chapter:
  // a map radius is not a service area, a claim is.
  const cityPlan = [];
  if (localPlan && localPlan.contentPlan && Array.isArray(localPlan.contentPlan.verifiedLocalities)) {
    for (const loc of localPlan.contentPlan.verifiedLocalities) {
      if (cityPlan.length >= Math.max(0, maxServiceAreaPages)) break;
      const name = clean(loc && (loc.name || loc.city));
      if (!name) continue;
      if (normName(name) === normName(cityName) || normName(name) === normName(napCityName)) continue;
      // A locality the business does not claim in its own areas list never
      // gets a chapter: a map radius is not a service area, a claim is.
      if (!areas.some((a) => normName(a) === normName(name))) continue;
      const cslug = slugifyName(name);
      if (!cslug || takenSlugs.has(`service-area/${cslug}`)) continue;
      takenSlugs.add(`service-area/${cslug}`);
      const miles = Number(loc.miles);
      cityPlan.push({ name, slug: cslug, ...(Number.isFinite(miles) && miles > 0 ? { miles: Math.round(miles) } : {}) });
    }
  }

  // Which authority pages will actually exist. Decided ONCE, up front, so the
  // nav bar and the in-body cross-links can never point at a page that did not
  // ship — /faq stopped shipping when the business has no FAQs of its own, and
  // a nav link to it would resolve to the SPA catch-all instead of a page.
  const has = {
    about: Boolean(aboutParas.length || (edu && edu.aboutExtra)),
    areas: Boolean(areas.length || hoods.length),
    faq: faqs.length > 0,
    team: team.length > 0,
    services: servicePlan.length > 0,
    cities: cityPlan.length > 0,
  };
  const navLinks = [
    { href: "/", label: "Home" },
    ...(has.about ? [{ href: "/about", label: "About" }] : []),
    ...(has.areas ? [{ href: "/service-areas", label: "Service areas" }] : []),
    ...(has.faq ? [{ href: "/faq", label: "FAQ" }] : []),
    ...(has.team ? [{ href: "/team", label: "Team" }] : []),
  ];
  const A = (href, text) => `<a href="${href}" style="color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))">${text}</a>`;
  /** Render a "see also" line from only the pages that shipped. */
  const alsoLine = (lead, entries) => {
    const live = entries.filter((e) => has[e.key]);
    return live.length ? `<p style="margin-top:1.6rem">${lead} ${live.map((e) => A(e.href, e.text)).join(" · ")}.</p>` : "";
  };
  // With a phone, the call is the primary action. Without one, the CTA does not
  // degrade to `tel:` with nothing after it — it becomes the lead form, which
  // is the only conversion path a phone-less business actually has. Never
  // "Call " with a hole where the number was.
  const cta = phoneDigits
    ? `<a class="wss-p__cta" href="tel:${esc(phoneDigits)}">Call ${esc(facts.phone || phoneDigits)}</a>`
    : `<a class="wss-p__cta" href="/contact">Request a quote</a>`;

  // ---- /about ----
  if (aboutParas.length || (edu && edu.aboutExtra)) {
    const title = `About ${facts.business_name} — ${facts.industry} in ${cityName}`.slice(0, 60);
    const description = `Who ${facts.business_name} is, how they work, and what to look for when hiring ${String(facts.industry).toLowerCase()} help in ${market}.`.slice(0, 160);
    const body = `${crumbs("About")}
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">About</p><div class="wss-c__rule"></div>
<h1>About ${esc(facts.business_name)}</h1>
${aboutParas.map((p) => `<p>${esc(p)}</p>`).join("\n")}
${aboutParas.length ? "" : `<p>${esc(facts.business_name)} provides ${esc(String(facts.industry).toLowerCase())} services in ${esc(market)}.</p>`}
<h2>How to judge ${esc(String(facts.industry).toLowerCase())} work</h2>
${(edu && edu.aboutExtra ? edu.aboutExtra : []).map((p) => `<p>${esc(p)}</p>`).join("\n")}
${tableHtml(edu)}
${mission ? `<h2>What they say they stand for</h2><blockquote class="wss-c__mission wss-c__quote" data-wss-verbatim="client-own-words"><p>${esc(mission)}</p>${facts.owner_name ? `<cite>${esc(facts.owner_name)}, ${esc(facts.business_name)}</cite>` : `<cite>${esc(facts.business_name)}</cite>`}</blockquote>` : ""}
${foundedYear ? `<p class="wss-c__founded">Serving ${esc(market)} since ${foundedYear}.</p>` : ""}
${awards.length ? `<h2>Recognition and credentials</h2><ul class="wss-c__awards wss-c__areas">${awards.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
${press.length ? `<h2>In the press</h2><ul class="wss-c__press">${press.map((x) => `<li><a href="${esc(x.href)}" target="_blank" rel="noopener noreferrer">${esc(x.label)}</a></li>`).join("")}</ul>` : ""}
${reviews.length ? `<h2>What customers say</h2>${reviews.map((r) => `<blockquote class="wss-c__quote" data-wss-verbatim="third-party-review"><p>${esc(r.text)}</p>${r.author ? `<cite>${esc(r.author)}</cite>` : ""}</blockquote>`).join("\n")}` : ""}
${team.length ? `<p style="margin-top:1.2rem"><a href="/team" style="color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))">Meet the team</a></p>` : ""}
${alsoLine("More detail:", [{ key: "areas", href: "/service-areas", text: "where they work" }, { key: "faq", href: "/faq", text: "questions they hear most" }])}
${cta}
</div></section>
${stamp(aboutParas.length > 0)}${citeHtml}`;
    const ld = { "@context": "https://schema.org", "@graph": [breadcrumbLd(siteUrl, "About", "/about"), articleLd({ siteUrl, headline: `About ${facts.business_name}`, description, path: "/about", facts, dateISO })] };
    files["about.html"] = Buffer.from(pageShell({ title, description, canonical: siteUrl + "about", bodyHtml: body, ld, facts: f, siteUrl, cssHref, nav: navLinks }), "utf8");
    report.pages.push("/about");
    report.page_labels["/about"] = "About";
  }

  // ---- /service-areas ----
  if (areas.length || hoods.length) {
    const title = `${facts.industry} service areas — ${cityName}, ${facts.state}`.slice(0, 60);
    const description = `Where ${facts.business_name} works: ${areas.slice(0, 6).join(", ") || market}.`.slice(0, 160);
    const hours = normalizeHours(content.hours);
    // THE LOCAL SEO BLOCK, WIRED (gap report #9): local-seo.js shipped a
    // LocalBusiness node, a visible NAP, an LCP-safe click-to-load map facade
    // and a policy-compliant review CTA — with zero production callers, while
    // this page embedded the map as a direct ~900KB iframe. The facade loads
    // zero third-party bytes until the visitor asks; every part renders only
    // from verified facts (no Place ID, no review CTA).
    const cityHref = (a) => {
      const city = cityPlan.find((c) => normName(c.name) === normName(a));
      return city ? `/service-area/${city.slug}` : null;
    };
    const seoBlock = localSeo.localSeoBlock({
      ...facts,
      phone: facts.phone || phoneDigits,
      areas,
      hours: content.hours,
    }, { accent: "hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))" });
    const body = `${crumbs("Service areas")}
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">Coverage</p><div class="wss-c__rule"></div>
<h1>${esc(facts.industry)} service areas around ${esc(cityName)}</h1>
<p>${esc(facts.business_name)} works across ${esc(market)} and the surrounding communities.</p>
${areas.length ? `<h2>Cities and communities served</h2><ul class="wss-c__areas">${areas.map((a) => {
  const href = cityHref(a);
  return href ? `<li><a href="${esc(href)}" style="color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))">${esc(a)}</a></li>` : `<li>${esc(a)}</li>`;
}).join("")}</ul>` : ""}
${hoods.length ? `<h2>Neighborhoods in ${esc(napCityName)}</h2><p>Requests commonly come from ${esc(hoods.slice(0, 8).join(", "))}${marks.length ? `, and the areas around ${esc(marks.slice(0, 3).join(", "))}` : ""}.</p>` : ""}
${hours.length ? `<h2>Hours</h2><table class="wss-c__hours"><tbody>${hours.map((h) => `<tr><th scope="row">${esc(h.day ? h.day[0].toUpperCase() + h.day.slice(1) : "Hours")}</th><td>${esc(h.text)}</td></tr>`).join("")}</tbody></table>` : ""}
${seoBlock}
${alsoLine("Also useful:", [{ key: "about", href: "/about", text: "about the company" }, { key: "faq", href: "/faq", text: "common questions" }])}
${cta}
</div></section>
${stamp(false)}${citeHtml}`;
    const ld = { "@context": "https://schema.org", "@graph": [breadcrumbLd(siteUrl, "Service areas", "/service-areas"), articleLd({ siteUrl, headline: `${facts.industry} service areas around ${cityName}`, description, path: "/service-areas", facts, dateISO })] };
    files["service-areas.html"] = Buffer.from(pageShell({ title, description, canonical: siteUrl + "service-areas", bodyHtml: body, ld, facts: f, siteUrl, cssHref, nav: navLinks }), "utf8");
    report.pages.push("/service-areas");
    report.page_labels["/service-areas"] = "Service areas";
  }

  // ---- /faq ----
  // TRUTH LAW: an FAQ page exists only when the business has FAQs of its own.
  // TRADE_EDU.faqExtra is general trade knowledge, and it used to be enough on
  // its own to publish a whole /faq page under a "By the <business> team"
  // byline and an FAQPage schema — i.e. two answers the business never gave,
  // attributed to it and fed to answer engines as its own. Sourced FAQs gate
  // the page; the general guidance may only ENRICH it, in its own labelled
  // block, and never enters FAQPage mainEntity.
  const faqExtra = faqs.length ? ((edu && edu.faqExtra) || []) : [];
  if (faqs.length) {
    const title = `${facts.industry} questions — ${cityName}, ${facts.state}`.slice(0, 60);
    const description = `Straight answers about ${String(facts.industry).toLowerCase()} work in ${market}, from ${facts.business_name}.`.slice(0, 160);
    const body = `${crumbs("FAQ")}
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">Answers</p><div class="wss-c__rule"></div>
<h1>${esc(facts.industry)} questions people ask in ${esc(cityName)}</h1>
<div class="wss-c__faq">
${faqs.map((q, i) => `<details id="q-${i + 1}"${i === 0 ? " open" : ""}><summary><h2 class="wss-c__q">${esc(q.q)}</h2></summary><p>${esc(q.a)}</p></details>`).join("\n")}
</div>
${faqExtra.length ? `<h2>General ${esc(String(facts.industry).toLowerCase())} guidance</h2>
<p class="wss-p__meta">Industry background, not answers from ${esc(facts.business_name)}.</p>
<div class="wss-c__faq">
${faqExtra.map((q, i) => `<details id="g-${i + 1}"><summary><h3>${esc(q.q)}</h3></summary><p>${esc(q.a)}</p></details>`).join("\n")}
</div>` : ""}
${research && research.questions && research.questions.length ? `<h2>Related searches in ${esc(cityName)}</h2>
<ul class="wss-c__areas">
${research.questions.slice(0, 6).map((q) => `<li>${esc(q)}</li>`).join("\n")}
</ul>` : ""}
${alsoLine("See also:", [{ key: "about", href: "/about", text: `about ${esc(facts.business_name)}` }, { key: "areas", href: "/service-areas", text: "service areas" }])}
${cta}
</div></section>
${stamp(true)}${citeHtml}`;
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        breadcrumbLd(siteUrl, "FAQ", "/faq"),
        articleLd({ siteUrl, headline: `${facts.industry} questions in ${cityName}`, description, path: "/faq", facts, dateISO }),
        // mainEntity carries the business's OWN answers only — general trade
        // guidance is not a claim this business made.
        { "@type": "FAQPage", speakable: { "@type": "SpeakableSpecification", cssSelector: [".wss-c__q", ".wss-c__faq p"] }, mainEntity: faqs.map((q) => ({ "@type": "Question", name: q.q, acceptedAnswer: { "@type": "Answer", text: q.a } })) },
      ],
    };
    files["faq.html"] = Buffer.from(pageShell({ title, description, canonical: siteUrl + "faq", bodyHtml: body, ld, facts: f, siteUrl, cssHref, nav: navLinks }), "utf8");
    report.pages.push("/faq");
    report.page_labels["/faq"] = "FAQ";
  }

  // ---- /team ---- only when the prospect publishes real people.
  if (team.length) {
    const title = `The team at ${facts.business_name}`.slice(0, 60);
    const description = `The people who do the work at ${facts.business_name} in ${market}.`.slice(0, 160);
    const body = `${crumbs("Team")}
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">People</p><div class="wss-c__rule"></div>
<h1>The team at ${esc(facts.business_name)}</h1>
<div class="wss-c__grid">
${team.map((t) => `<article class="wss-c__card"><h3>${esc(t.name)}</h3>${t.role ? `<p class="wss-c__eyebrow" style="margin:0 0 .4rem">${esc(t.role)}</p>` : ""}${t.bio ? `<p>${esc(t.bio)}</p>` : ""}</article>`).join("\n")}
</div>
${alsoLine("More:", [{ key: "about", href: "/about", text: "about the company" }, { key: "faq", href: "/faq", text: "common questions" }])}
${cta}
</div></section>
${stamp(true)}${citeHtml}`;
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        breadcrumbLd(siteUrl, "Team", "/team"),
        articleLd({ siteUrl, headline: `The team at ${facts.business_name}`, description, path: "/team", facts, dateISO }),
        ...team.map((t) => ({ "@type": "Person", name: t.name, jobTitle: t.role || undefined, worksFor: { "@type": "Organization", name: facts.business_name } })),
      ],
    };
    files["team.html"] = Buffer.from(pageShell({ title, description, canonical: siteUrl + "team", bodyHtml: body, ld, facts: f, siteUrl, cssHref, nav: navLinks }), "utf8");
    report.pages.push("/team");
    report.page_labels["/team"] = "Team";
  }

  // ---- /<service-slug> — one page per VERIFIED service (Wave 4) -----------
  // Gap #1 of the 108-point report: the Service schema nodes existed but no
  // service pages did. Each page is the prospect's own service list — their
  // name for the work, their description as the lede — plus the same market
  // facts the other pages carry. Nothing is padded: a service with no
  // description ships a shorter, honest page.
  for (const { service, slug: sslug } of servicePlan) {
    const title = `${service.name} in ${cityName} — ${facts.business_name}`.slice(0, 60);
    const description = clean(service.description || `${facts.business_name} offers ${service.name} in ${market}.`).slice(0, 160);
    const others = servicePlan.filter((x) => x.slug !== sslug).slice(0, 2);
    const lede = service.description
      ? `<blockquote class="wss-c__quote" data-wss-verbatim="client-own-words"><p>${esc(service.description)}</p></blockquote>`
      : `<p>${esc(facts.business_name)} lists ${esc(service.name)} among the services it offers${market ? ` in ${esc(market)}` : ""}.</p>`;
    const areasBlock = areas.length
      ? `<h2>Where ${esc(service.name)} is offered</h2><ul class="wss-c__areas">${areas.slice(0, 8).map((a) => {
        const city = cityPlan.find((c) => normName(c.name) === normName(a));
        return city
          ? `<li><a href="/service-area/${city.slug}" style="color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))">${esc(a)}</a></li>`
          : `<li>${esc(a)}</li>`;
      }).join("")}</ul>` : "";
    const related = others.length
      ? `<p style="margin-top:1.2rem">Related services: ${others.map((o) => A(`/${o.slug}`, esc(o.service.name))).join(" · ")}.</p>` : "";
    const body = `${crumbs(service.name)}
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">Service</p><div class="wss-c__rule"></div>
<h1>${esc(service.name)} in ${esc(cityName)}${facts.state ? `, ${esc(facts.state)}` : ""}</h1>
${lede}
${areasBlock}
${related}
${alsoLine("More about the company:", [
        { key: "about", href: "/about", text: `about ${esc(facts.business_name)}` },
        { key: "faq", href: "/faq", text: "questions they hear most" },
        { key: "areas", href: "/service-areas", text: "all service areas" },
      ])}
${cta}
</div></section>
${stamp(Boolean(service.description))}${citeHtml}`;
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        breadcrumbLd(siteUrl, service.name, `/${sslug}`),
        articleLd({ siteUrl, headline: `${service.name} in ${cityName}`, description, path: `/${sslug}`, facts, dateISO }),
        {
          "@type": "Service",
          name: service.name,
          serviceType: service.name,
          ...(service.description ? { description: service.description } : {}),
          provider: { "@type": "LocalBusiness", name: facts.business_name, ...(phoneDigits ? { telephone: phoneDigits } : {}) },
          ...(areas.length
            ? { areaServed: areas.slice(0, 10).map((a) => ({ "@type": "City", name: a })) }
            : (cityName ? { areaServed: { "@type": "City", name: cityName } } : {})),
          url: siteUrl.replace(/\/$/, "") + `/${sslug}`,
        },
      ],
    };
    files[`${sslug}.html`] = Buffer.from(pageShell({ title, description, canonical: siteUrl + sslug, bodyHtml: body, ld, facts: f, siteUrl, cssHref, nav: navLinks }), "utf8");
    report.pages.push(`/${sslug}`);
    report.page_labels[`/${sslug}`] = service.name;
  }

  // ---- /service-area/<city> — bounded locality chapters (Wave 4) ----------
  // One chapter per locality the plan VERIFIED and the business claims in its
  // own areas list. The map on each chapter is the local-seo facade: zero
  // third-party bytes until click, directions that work without any click.
  for (const city of cityPlan) {
    const title = `${facts.industry} in ${city.name}, ${facts.state} — ${facts.business_name}`.slice(0, 60);
    const description = clean(`${facts.industry} services ${facts.business_name} offers in ${city.name}${city.miles ? `, about ${city.miles} miles from ${cityName}` : ""}.`).slice(0, 160);
    const servicesBlock = servicePlan.length
      ? `<h2>Services listed for ${esc(city.name)}</h2><ul class="wss-c__areas">${servicePlan.map((sp) => `<li><a href="/${sp.slug}" style="color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))">${esc(sp.service.name)}</a></li>`).join("")}</ul>` : "";
    const seoBlock = localSeo.localSeoBlock({
      ...facts,
      phone: facts.phone || phoneDigits,
      areas,
      hours: content.hours,
    }, { accent: "hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)))" });
    const cityCrumbs = `<p class="wss-p__crumbs"><a href="/" style="color:inherit">Home</a> › <a href="/service-areas" style="color:inherit">Service areas</a> › ${esc(city.name)}</p>`;
    const body = `${cityCrumbs}
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">Service area</p><div class="wss-c__rule"></div>
<h1>${esc(facts.industry)} in ${esc(city.name)}${facts.state ? `, ${esc(facts.state)}` : ""}</h1>
<p>${esc(facts.business_name)} lists ${esc(city.name)} among the ${esc(String(facts.industry).toLowerCase())} service areas it serves${city.miles ? `, roughly ${city.miles} miles from ${esc(cityName)}` : ""}.</p>
${servicesBlock}
${seoBlock}
${alsoLine("More:", [
        { key: "areas", href: "/service-areas", text: "all service areas" },
        { key: "about", href: "/about", text: "about the company" },
        { key: "faq", href: "/faq", text: "common questions" },
      ])}
${cta}
</div></section>
${stamp(false)}${citeHtml}`;
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        breadcrumbsLd(siteUrl, [{ name: "Service areas", path: "/service-areas" }, { name: city.name, path: `/service-area/${city.slug}` }]),
        articleLd({ siteUrl, headline: `${facts.industry} in ${city.name}`, description, path: `/service-area/${city.slug}`, facts, dateISO }),
        ...servicePlan.map((sp) => ({
          "@type": "Service",
          name: sp.service.name,
          serviceType: sp.service.name,
          ...(sp.service.description ? { description: sp.service.description } : {}),
          provider: { "@type": "LocalBusiness", name: facts.business_name, ...(phoneDigits ? { telephone: phoneDigits } : {}) },
          areaServed: { "@type": "City", name: city.name },
          url: siteUrl.replace(/\/$/, "") + `/service-area/${city.slug}`,
        })),
      ],
    };
    files[`service-area/${city.slug}.html`] = Buffer.from(pageShell({ title, description, canonical: `${siteUrl}service-area/${city.slug}`, bodyHtml: body, ld, facts: f, siteUrl, cssHref, nav: navLinks }), "utf8");
    report.pages.push(`/service-area/${city.slug}`);
    report.page_labels[`/service-area/${city.slug}`] = city.name;
  }

  for (const buf of Object.values(files)) {
    report.words += (buf.toString("utf8").replace(/<[^>]+>/g, " ").match(/\b\w+\b/g) || []).length;
  }
  return { files, report };
}

/**
 * siteStrip(pageLabels) — the anti-orphan nav injected into the donor's own
 * index.html by the engine. Built from the SAME page set the build emitted, so
 * a link to a page that did not ship is structurally impossible: every page
 * the authority layer generates is reachable from the home page in one hop.
 */
function siteStrip(pageLabels = {}) {
  const entries = Object.entries(pageLabels)
    .filter(([p, label]) => p && p !== "/" && label)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return "";
  const link = (href, label) => `<a href="${esc(href)}" style="color:inherit;opacity:.85;text-decoration:none">${esc(label)}</a>`;
  return `<nav class="wss-site-strip" aria-label="Site pages" style="box-sizing:border-box;max-width:1160px;margin:0 auto;padding:1rem 1.25rem;display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;font-size:.9rem;line-height:1.6">${link("/", "Home")}${entries.map(([p, label]) => link(p, label)).join("")}</nav>`;
}

module.exports = { build, TRADE_EDU, tradeEdu, siteStrip, RESERVED_PAGE_SLUGS, slugifyName };
