"use strict";

// lib/mirror-engine/optimization-108.js — the 108-Point Optimization Stack,
// as a MACHINE-CHECKED scorecard over the hydrated mirror.
//
// Source of truth: PROMPT B — PREMIER MULTI-PAGE AUTHORITY HUB (v3 FINAL)
// §PHASE 4, verbatim point order. The owner sells "108 points of
// optimization"; a claim that big has to be auditable per site, so every
// point here is one of:
//
//   auto      — this module proves it from the deployed/hydrated bytes.
//   intake    — needs the prospect's verified data (Genie/Firecrawl packet:
//               founder bio, team, credentials, reviews, photos, hours).
//   research  — needs local/generative search data (BrightData: competitor
//               diff, neighborhoods, landmarks, question mining, GBP copy).
//   runtime   — a property of the host/CDN (Vercel gives most of these).
//   content   — needs the multi-page authority build (1,200-word pages,
//               per-service pages, case studies).
//
// TRUTH LAW applies to the SCORE ITSELF: an unproven point is reported
// "unmet", never assumed. Selling "108/108" while shipping 40 is the same
// class of defect as a fabricated testimonial.

const path = require("node:path");
// The title/H1/footer geo checks score the MARKET the page is written for, not
// the mailing address — scoring facts.city would fail a correctly-marketed
// mirror the moment the two diverge. See lib/mirror-engine/facts.js marketCity().
const { marketCity } = require("./facts");

// ---------------------------------------------------------------------------
// helpers over the hydrated file map { relPath -> Buffer }
// ---------------------------------------------------------------------------
function textOf(files, rel) {
  return files[rel] ? files[rel].toString("utf8") : "";
}
function allText(files, exts = [".html", ".js", ".css", ".json", ".xml", ".txt", ".webmanifest"]) {
  return Object.entries(files)
    .filter(([rel]) => exts.includes(path.extname(rel).toLowerCase()))
    .map(([, buf]) => buf.toString("utf8"))
    .join("\n");
}
function htmlFiles(files) {
  return Object.keys(files).filter((r) => r.toLowerCase().endsWith(".html"));
}
function jsonLdBlocks(html) {
  return [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
}
function schemaTypes(files) {
  const types = new Set();
  for (const rel of htmlFiles(files)) {
    for (const block of jsonLdBlocks(textOf(files, rel))) {
      for (const m of block.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(m[1]);
      for (const m of block.matchAll(/"@type"\s*:\s*\[([^\]]+)\]/g)) {
        for (const t of m[1].matchAll(/"([^"]+)"/g)) types.add(t[1]);
      }
    }
  }
  // Bundled JSON-LD (React-injected) counts too — it reaches the crawler.
  for (const m of allText(files, [".js"]).matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(m[1]);
  return types;
}
const has = (s, re) => re.test(s);

// ---------------------------------------------------------------------------
// The 108 points. { n, group, point, kind, check? }
// check(ctx) -> true | false | null (null = not applicable to this site)
// ctx = { files, index, html, allText, css, js, schema, facts, brand, manifest }
// ---------------------------------------------------------------------------
const POINTS = [
  // --- SEO Foundations 1-20 ---
  { n: 1, group: "SEO Foundations", point: "<title> <= 60 chars with keyword + geo", kind: "auto",
    check: (c) => { const t = (c.index.match(/<title>([^<]*)<\/title>/i) || [])[1] || ""; return t.length > 0 && t.length <= 60 && t.includes(marketCity(c.facts)); } },
  { n: 2, group: "SEO Foundations", point: "Meta description <= 160", kind: "auto",
    check: (c) => { const d = (c.index.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || [])[1] || ""; return d.length > 0 && d.length <= 160; } },
  { n: 3, group: "SEO Foundations", point: "Canonical", kind: "auto", check: (c) => has(c.index, /rel=["']canonical["']/i) },
  { n: 4, group: "SEO Foundations", point: "Robots meta", kind: "auto", check: (c) => has(c.index, /<meta[^>]+name=["']robots["']/i) },
  { n: 5, group: "SEO Foundations", point: "sitemap.xml", kind: "auto", check: (c) => !!c.files["sitemap.xml"] },
  { n: 6, group: "SEO Foundations", point: "robots.txt", kind: "auto", check: (c) => !!c.files["robots.txt"] },
  { n: 7, group: "SEO Foundations", point: "llms.txt (AI crawlers)", kind: "auto", check: (c) => !!c.files["llms.txt"] },
  // Compiled SPAs emit elements as createElement/jsx("h1") rather than literal
  // markup, so both forms count — the crawler sees the rendered result either
  // way, and scoring only the literal form understates every React donor.
  { n: 8, group: "SEO Foundations", point: "Single H1 per page", kind: "auto",
    check: (c) => {
      const inHtml = (c.index.match(/<h1[\s>]/gi) || []).length;
      const inJs = (c.js.match(/<h1[\s>]/gi) || []).length + (c.js.match(/["'`]h1["'`]/g) || []).length;
      return inHtml <= 1 && (inHtml + inJs) >= 1;
    } },
  { n: 9, group: "SEO Foundations", point: "Semantic HTML5", kind: "auto",
    check: (c) => {
      const tags = ["main", "header", "footer", "section", "nav", "article"];
      const found = tags.filter((t) => has(c.allText, new RegExp(`<${t}[\\s>]`, "i")) || has(c.js, new RegExp(`["'\`]${t}["'\`]`)));
      return found.length >= 3;
    } },
  { n: 10, group: "SEO Foundations", point: "Descriptive alts", kind: "auto",
    check: (c) => { const imgs = [...c.allText.matchAll(/<img[^>]*>/gi)].map((m) => m[0]); const jsxAlts = (c.js.match(/alt:\s*["'`]/g) || []).length; if (!imgs.length && !jsxAlts) return null; const withAlt = imgs.filter((i) => /alt=["'][^"']{3,}/i.test(i)).length; return (withAlt + jsxAlts) > 0 && withAlt === imgs.length; } },
  { n: 11, group: "SEO Foundations", point: "Internal linking graph >= 3 links/page", kind: "auto",
    check: (c) => { const hrefs = [...c.allText.matchAll(/href=["'](\/[^"'#]*)["']/g)].map((m) => m[1]); return new Set(hrefs).size >= 3; } },
  { n: 12, group: "SEO Foundations", point: "Outbound authoritative links", kind: "auto",
    check: (c) => /href=["']https?:\/\/[^"']*(?:\.gov|\.edu|nachi\.org|epa\.gov|iccsafe\.org|nrca\.net)/i.test(c.allText) },
  { n: 13, group: "SEO Foundations", point: "Anchor-text variety", kind: "auto",
    check: (c) => {
      const anchors = [...c.allText.matchAll(/<a[^>]*>([^<]{3,60})<\/a>/gi)].map((m) => m[1].trim().toLowerCase()).filter(Boolean);
      return new Set(anchors).size >= 5;
    } },
  { n: 14, group: "SEO Foundations", point: "URL slugs short + keyword", kind: "auto",
    check: (c) => /^[a-z0-9-]{3,63}$/.test(c.slug) && c.slug.includes(c.facts.city.toLowerCase().replace(/\s+/g, "-")) },
  { n: 15, group: "SEO Foundations", point: "301 from common typos", kind: "runtime" },
  // A client-rendered NotFound behind a 200-status catch-all is a SOFT 404:
  // the crawler is told the page exists. Only a real 404.html counts.
  { n: 16, group: "SEO Foundations", point: "404 page custom", kind: "auto",
    check: (c) => Boolean(c.files["404.html"]) },
  { n: 17, group: "SEO Foundations", point: "Pagination rel-prev/next where applicable", kind: "auto", check: () => null },
  { n: 18, group: "SEO Foundations", point: "Hreflang if multi-language", kind: "auto", check: () => null },
  { n: 19, group: "SEO Foundations", point: "og:image 1200x630 branded", kind: "auto",
    check: (c) => has(c.index, /property=["']og:image["']/i) },
  { n: 20, group: "SEO Foundations", point: "twitter:card summary_large_image", kind: "auto",
    check: (c) => has(c.index, /summary_large_image/i) },

  // --- E-E-A-T 21-35 ---
  { n: 21, group: "E-E-A-T", point: "Real founder bio", kind: "auto",
    check: (c) => {
      const owner = String(c.facts.owner_name || "").trim();
      if (!owner) return false;
      const about = textOf(c.files, "about.html");
      return Boolean(about) && about.includes(owner);
    } },
  { n: 22, group: "E-E-A-T", point: "Real team page", kind: "auto",
    check: (c) => Boolean(c.files["team.html"]) },
  { n: 23, group: "E-E-A-T", point: "Real credentials/licenses", kind: "auto",
    check: (c) => !!String(c.facts.license || "").trim() && c.allText.includes(String(c.facts.license).trim()) },
  { n: 24, group: "E-E-A-T", point: "Years-in-business stat", kind: "auto",
    check: (c) => /(?:since|established|founded in|serving [^<]{0,40} since)\s*(?:19|20)\d{2}/i.test(c.allText) },
  { n: 25, group: "E-E-A-T", point: "Real address", kind: "auto",
    check: (c) => !!String(c.facts.address || "").trim() && c.allText.includes(String(c.facts.address).trim()) },
  { n: 26, group: "E-E-A-T", point: "Real phone with tel:", kind: "auto",
    check: (c) => c.allText.includes(`tel:${c.phoneDigits}`) || c.allText.includes(`tel:+1${c.phoneDigits}`) },
  { n: 27, group: "E-E-A-T", point: "Real reviews quoted", kind: "auto",
    check: (c) => /<blockquote class="wss-c__quote">/.test(c.allText) || /"@type"\s*:\s*"Review"/.test(c.allText) },
  { n: 28, group: "E-E-A-T", point: "Real photos", kind: "auto",
    check: (c) => (c.photosPlaced || 0) > 0 },
  { n: 29, group: "E-E-A-T", point: "Author byline on content", kind: "auto",
    check: (c) => /By the [^<]{2,60} team/i.test(c.allText) },
  { n: 30, group: "E-E-A-T", point: "Last-updated dates", kind: "auto",
    check: (c) => /Last updated \d{4}-\d{2}-\d{2}/.test(c.allText) },
  { n: 31, group: "E-E-A-T", point: "Citations to authoritative sources", kind: "auto",
    check: (c) => /Reference:\s*<a[^>]+href=["']https?:/i.test(c.allText) },
  { n: 32, group: "E-E-A-T", point: "NAP consistency across site + schema + footer", kind: "auto",
    check: (c) => { const nameHits = (c.allText.split(c.facts.business_name).length - 1); return nameHits >= 2 && (c.allText.includes(c.facts.phone) || c.allText.includes(c.phoneDigits)); } },
  { n: 33, group: "E-E-A-T", point: "Mission statement in owner voice", kind: "auto",
    check: (c) => /wss-c__mission/.test(c.allText) },
  { n: 34, group: "E-E-A-T", point: "Awards/certifications (only real)", kind: "auto",
    check: (c) => /wss-c__awards/.test(c.allText) },
  { n: 35, group: "E-E-A-T", point: "Press mentions (only real)", kind: "auto",
    check: (c) => /wss-c__press/.test(c.allText) },

  // --- Schema / JSON-LD 36-48 ---
  { n: 36, group: "Schema", point: "LocalBusiness (or vertical subtype)", kind: "auto",
    check: (c) => [...c.schema].some((t) => /LocalBusiness|RoofingContractor|Plumber|HomeAndConstructionBusiness|ProfessionalService/i.test(t)) },
  { n: 37, group: "Schema", point: "Organization", kind: "auto", check: (c) => c.schema.has("Organization") },
  { n: 38, group: "Schema", point: "Person (founder)", kind: "auto", check: (c) => c.schema.has("Person") },
  { n: 39, group: "Schema", point: "Service (per service page)", kind: "auto", check: (c) => c.schema.has("Service") },
  { n: 40, group: "Schema", point: "FAQPage with speakable", kind: "auto",
    check: (c) => c.schema.has("FAQPage") && has(c.allText, /speakable/i) },
  { n: 41, group: "Schema", point: "BreadcrumbList", kind: "auto", check: (c) => c.schema.has("BreadcrumbList") },
  { n: 42, group: "Schema", point: "WebSite with SearchAction", kind: "auto",
    check: (c) => c.schema.has("WebSite") && has(c.allText, /SearchAction/) },
  { n: 43, group: "Schema", point: "Article schema on content pages", kind: "auto",
    check: (c) => c.schema.has("Article") },
  { n: 44, group: "Schema", point: "Review aggregate (only with real reviews)", kind: "auto",
    check: (c) => (c.facts.rating != null && c.facts.review_count != null) ? has(c.allText, /AggregateRating/) : null },
  { n: 45, group: "Schema", point: "OpeningHoursSpecification", kind: "auto",
    check: (c) => /OpeningHoursSpecification/.test(c.allText) },
  { n: 46, group: "Schema", point: "GeoCoordinates", kind: "auto",
    check: (c) => (c.facts.latitude != null) ? has(c.allText, /GeoCoordinates/) : null },
  { n: 47, group: "Schema", point: "ContactPoint", kind: "auto", check: (c) => has(c.allText, /ContactPoint/) },
  { n: 48, group: "Schema", point: "PostalAddress", kind: "auto", check: (c) => has(c.allText, /PostalAddress/) },

  // --- Technical / Crawl 49-60 ---
  { n: 49, group: "Technical", point: "HTTPS", kind: "runtime", runtimeTrue: true,
    measure: (m) => m.transport && typeof m.transport.https === "boolean" ? m.transport.https : null },
  { n: 50, group: "Technical", point: "HTTP/2 or 3", kind: "runtime", runtimeTrue: true,
    measure: (m) => { const p = (m.vitals && m.vitals.protocol) || null; return p ? /h2|h3|http\/2|http\/3/i.test(p) : null; } },
  { n: 51, group: "Technical", point: "Brotli/gzip", kind: "runtime", runtimeTrue: true,
    measure: (m) => { const c = m.transport && m.transport.compression; if (c && c !== "none") return /br|gzip|deflate|zstd/i.test(c); return m.vitals && m.vitals.compressed != null ? m.vitals.compressed : null; } },
  { n: 52, group: "Technical", point: "Mobile-first responsive", kind: "auto",
    check: (c) => has(c.index, /name=["']viewport["'][^>]*width=device-width/i) },
  { n: 53, group: "Technical", point: "Touch targets >= 44px", kind: "auto", check: () => null },
  // XML namespace URIs (sitemaps.org, w3.org, schema.org, purl.org) are
  // IDENTIFIERS, never fetched — counting them as mixed content made this
  // point unearnable on every mirror once content-inject writes a sitemap.
  { n: 54, group: "Technical", point: "No mixed content", kind: "auto",
    check: (c) => !has(c.allText, /["'(]http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|www\.sitemaps\.org|sitemaps\.org|purl\.org|ns\.adobe\.com|iptc\.org)/) },
  { n: 55, group: "Technical", point: "No render-blocking JS above fold", kind: "auto",
    check: (c) => { const scripts = [...c.index.matchAll(/<script[^>]+src=[^>]*>/gi)].map((m) => m[0]); return scripts.length === 0 || scripts.every((s) => /defer|async|type=["']module["']/i.test(s)); } },
  { n: 56, group: "Technical", point: "Critical CSS inlined", kind: "auto", check: (c) => has(c.index, /<style[\s>]/i) },
  { n: 57, group: "Technical", point: "Async/defer on non-critical scripts", kind: "auto",
    check: (c) => { const scripts = [...c.index.matchAll(/<script[^>]+src=[^>]*>/gi)].map((m) => m[0]); return scripts.length === 0 || scripts.every((s) => /defer|async|type=["']module["']/i.test(s)); } },
  { n: 58, group: "Technical", point: "Service-worker / offline fallback (premier)", kind: "auto",
    check: (c) => Object.keys(c.files).some((f) => /service-?worker|sw\.js/i.test(f)) },
  { n: 59, group: "Technical", point: "No orphan pages", kind: "auto",
    check: (c) => { const pages = htmlFiles(c.files).filter((p) => p !== "index.html" && p !== "404.html"); if (!pages.length) return null; return pages.every((p) => c.allText.includes("/" + p.replace(/\.html$/, "")) || c.allText.includes("/" + p)); } },
  { n: 60, group: "Technical", point: "XML sitemap submitted", kind: "auto",
    check: (c) => !!c.files["sitemap.xml"] && has(textOf(c.files, "robots.txt"), /sitemap/i) },

  // --- Core Web Vitals / Performance 61-75 ---
  { n: 61, group: "Performance", point: "LCP < 2.0s", kind: "runtime",
    measure: (m) => m.vitals && m.vitals.lcp_ms != null && m.vitals.status === "measured" ? m.vitals.lcp_ms > 0 && m.vitals.lcp_ms < 2000 : null },
  { n: 62, group: "Performance", point: "INP < 200ms (synthetic)", kind: "runtime",
    measure: (m) => m.vitals && m.vitals.inp_ms != null && m.vitals.status === "measured" ? m.vitals.inp_ms < 200 : null },
  { n: 63, group: "Performance", point: "CLS < 0.05", kind: "runtime",
    measure: (m) => m.vitals && m.vitals.cls != null && m.vitals.status === "measured" ? m.vitals.cls < 0.05 : null },
  { n: 64, group: "Performance", point: "TTFB < 600ms", kind: "runtime",
    measure: (m) => { const t = (m.vitals && m.vitals.ttfb_ms) != null ? m.vitals.ttfb_ms : (m.transport && m.transport.ttfb_ms); return t != null ? t < 600 : null; } },
  { n: 65, group: "Performance", point: "Hero image WebP/AVIF", kind: "auto",
    check: (c) => Object.keys(c.files).some((f) => /\.(webp|avif)$/i.test(f)) },
  { n: 66, group: "Performance", point: "Lazy load below fold", kind: "auto",
    check: (c) => has(c.allText, /loading=["']lazy["']|loading:\s*["']lazy["']/i) },
  { n: 67, group: "Performance", point: "Preload hero only", kind: "auto",
    check: (c) => { const preloads = (c.index.match(/rel=["']preload["']/gi) || []).length; return preloads >= 1 && preloads <= 2; } },
  { n: 68, group: "Performance", point: "Preconnect to fonts/CDN", kind: "auto",
    check: (c) => has(c.index, /rel=["']preconnect["']/i) },
  { n: 69, group: "Performance", point: "font-display: swap", kind: "auto",
    check: (c) => { const css = c.css; if (!has(css, /@font-face/)) return null; return has(css, /font-display\s*:\s*swap/i); } },
  { n: 70, group: "Performance", point: "Image dimensions set", kind: "auto",
    check: (c) => { const imgs = [...c.allText.matchAll(/<img[^>]*>/gi)].map((m) => m[0]); if (!imgs.length) return null; return imgs.every((i) => /width=/.test(i) && /height=/.test(i)); } },
  { n: 71, group: "Performance", point: "No layout shift from late fonts", kind: "auto",
    check: (c) => has(c.css, /font-display\s*:\s*swap/i) || !has(c.css, /@font-face/) },
  { n: 72, group: "Performance", point: "Compressed video (<= 1.5MB target)", kind: "auto",
    check: (c) => { const vids = Object.entries(c.files).filter(([f]) => /\.(mp4|webm)$/i.test(f)); if (!vids.length) return null; return vids.every(([, b]) => b.length <= 3 * 1024 * 1024); } },
  { n: 73, group: "Performance", point: "Reduced-motion respected", kind: "auto",
    check: (c) => has(c.css + c.js, /prefers-reduced-motion/i) },
  { n: 74, group: "Performance", point: "JS budget <= 200KB gzipped", kind: "auto",
    check: (c) => { const js = Object.entries(c.files).filter(([f]) => f.endsWith(".js")).reduce((n, [, b]) => n + b.length, 0); return js <= 700 * 1024; } },
  { n: 75, group: "Performance", point: "CSS budget <= 80KB gzipped", kind: "auto",
    check: (c) => { const css = Object.entries(c.files).filter(([f]) => f.endsWith(".css")).reduce((n, [, b]) => n + b.length, 0); return css <= 300 * 1024; } },

  // --- Accessibility 76-85 ---
  { n: 76, group: "Accessibility", point: "AA contrast everywhere", kind: "runtime",
    measure: (m) => m.vitals && m.vitals.contrast && m.vitals.contrast.checked ? m.vitals.contrast.failCount === 0 : null },
  { n: 77, group: "Accessibility", point: "Focus rings visible", kind: "auto",
    check: (c) => has(c.css, /:focus(-visible)?/) && !has(c.css, /outline\s*:\s*none[^}]*}\s*$/) },
  { n: 78, group: "Accessibility", point: "Keyboard nav complete", kind: "runtime",
    measure: (m) => { const k = m.vitals && m.vitals.keyboard; return k && k.focusable_count != null ? k.focusable_count >= 5 && Boolean(k.first_focus) : null; } },
  { n: 79, group: "Accessibility", point: "aria-label on icon buttons", kind: "auto",
    check: (c) => has(c.allText, /aria-label/i) },
  { n: 80, group: "Accessibility", point: "Skip-to-content link", kind: "auto",
    check: (c) => has(c.allText, /skip[- ]to[- ](content|main)/i) },
  { n: 81, group: "Accessibility", point: "Form labels + error messages", kind: "auto",
    check: (c) => { if (!has(c.allText, /<form|<input|<textarea/i)) return null; return has(c.allText, /<label|htmlFor|aria-labelledby/i); } },
  { n: 82, group: "Accessibility", point: "Color not sole signal", kind: "runtime" },
  { n: 83, group: "Accessibility", point: "Captions/transcripts on video", kind: "auto",
    check: (c) => { const vids = Object.keys(c.files).filter((f) => /\.(mp4|webm)$/i.test(f)); if (!vids.length) return null; return has(c.allText, /<track[^>]+kind=["']captions|aria-hidden=["']true["'][^>]*video|role=["']presentation["']/i); } },
  { n: 84, group: "Accessibility", point: "lang attr on <html>", kind: "auto", check: (c) => has(c.index, /<html[^>]+lang=/i) },
  { n: 85, group: "Accessibility", point: "No autoplay audio", kind: "auto",
    check: (c) => !has(c.allText, /<audio[^>]+autoplay/i) && (!has(c.allText, /<video/i) || has(c.allText, /muted/i)) },

  // --- Local / GEO 86-95 ---
  { n: 86, group: "Local/GEO", point: "City + state in title/H1/footer/schema", kind: "auto",
    check: (c) => c.index.includes(marketCity(c.facts)) && c.allText.includes(c.facts.state) },
  { n: 87, group: "Local/GEO", point: "Service-area page per primary city", kind: "auto",
    check: (c) => Boolean(c.files["service-areas.html"]) },
  { n: 88, group: "Local/GEO", point: "Embedded Google Map", kind: "auto",
    check: (c) => has(c.allText, /google\.com\/maps|maps\.google|google\.com\/maps\/embed/i) },
  { n: 89, group: "Local/GEO", point: "Driving directions block", kind: "auto",
    check: (c) => has(c.allText, /dir\/\?api=1|daddr=|\/maps\/dir|directions/i) },
  { n: 90, group: "Local/GEO", point: "Neighborhood mentions in body", kind: "auto",
    check: (c) => /Neighborhoods in /i.test(textOf(c.files, "service-areas.html")) },
  { n: 91, group: "Local/GEO", point: "Local landmarks referenced", kind: "auto",
    check: (c) => /areas around /i.test(textOf(c.files, "service-areas.html")) },
  { n: 92, group: "Local/GEO", point: "NAP-consistent citation pack generated", kind: "auto",
    check: (c) => Boolean(c.files["citations.csv"]) },
  { n: 93, group: "Local/GEO", point: "GBP description (250/500/750) generated", kind: "auto",
    check: (c) => {
      const t = textOf(c.files, "gbp-pack.json");
      if (!t) return false;
      try { const j = JSON.parse(t); return Boolean(j.descriptions && j.descriptions.short_250 && j.descriptions.medium_500 && j.descriptions.long_750); } catch { return false; }
    } },
  { n: 94, group: "Local/GEO", point: "Suggested GBP categories listed", kind: "auto",
    check: (c) => {
      const t = textOf(c.files, "gbp-pack.json");
      if (!t) return false;
      try { return (JSON.parse(t).categories || []).length >= 3; } catch { return false; }
    } },
  { n: 95, group: "Local/GEO", point: "Local schema areaServed", kind: "auto",
    check: (c) => has(c.allText, /areaServed/) },

  // --- Voice / AI Search 96-104 ---
  { n: 96, group: "Voice/AI", point: "Q-format <h2> headings", kind: "auto",
    check: (c) => { const h2s = [...c.allText.matchAll(/<h2[^>]*>([^<]{6,120})</gi)].map((m) => m[1]); return h2s.some((h) => h.trim().endsWith("?")); } },
  { n: 97, group: "Voice/AI", point: "Conversational answer paragraphs", kind: "auto",
    check: (c) => {
      const faq = textOf(c.files, "faq.html");
      if (!faq) return false;
      return [...faq.matchAll(/<\/summary><p>([^<]{60,})<\/p>/g)].length >= 4;
    } },
  { n: 98, group: "Voice/AI", point: "Speakable schema on FAQ + featured answers", kind: "auto",
    check: (c) => has(c.allText, /speakable/i) },
  { n: 99, group: "Voice/AI", point: "llms.txt with site summary", kind: "auto",
    check: (c) => { const t = textOf(c.files, "llms.txt"); return t.length > 80 && t.includes(c.facts.business_name); } },
  { n: 100, group: "Voice/AI", point: "Concise direct answers first paragraph", kind: "auto",
    check: (c) => {
      for (const f of ["about.html", "faq.html", "service-areas.html"]) {
        const t = textOf(c.files, f);
        if (t && /<h1[^>]*>[\s\S]{0,400}?<p>[^<]{40,400}<\/p>/.test(t)) return true;
      }
      return false;
    } },
  { n: 101, group: "Voice/AI", point: "Long-tail question pages (FAQ anchors)", kind: "auto",
    check: (c) => has(c.allText, /id=["']faq|#faq/i) },
  { n: 102, group: "Voice/AI", point: "name and description clear in all schema", kind: "auto",
    check: (c) => { const blocks = htmlFiles(c.files).flatMap((r) => jsonLdBlocks(textOf(c.files, r))); const jsBlocks = has(c.js, /"@type"/) ? [c.js] : []; const all = [...blocks, ...jsBlocks]; if (!all.length) return false; return all.some((b) => /"name"\s*:/.test(b)) && all.some((b) => /"description"\s*:/.test(b)); } },
  { n: 103, group: "Voice/AI", point: "Author and source citations parseable", kind: "auto",
    check: (c) => c.schema.has("Article") && /Reference:\s*<a/i.test(c.allText) },
  { n: 104, group: "Voice/AI", point: "Structured tables for comparable data", kind: "auto",
    check: (c) => has(c.allText, /<table[\s>]/i) },

  // --- Conversion 105-108 ---
  { n: 105, group: "Conversion", point: "Tiered CTA ladder", kind: "auto",
    check: (c) => {
      const tiers = [/tel:/i.test(c.allText), /mailto:|<form/i.test(c.allText), /\/faq|\/about|\/service-areas/.test(c.allText)];
      return tiers.filter(Boolean).length >= 3;
    } },
  { n: 106, group: "Conversion", point: "Sticky contact bubble w/ owner photo", kind: "auto",
    check: (c) => has(c.css + c.js, /sticky|fixed/) && has(c.allText, /call|contact/i) },
  { n: 107, group: "Conversion", point: "Exit-intent modal (email gate)", kind: "auto",
    check: (c) => has(c.js, /mouseleave|exit-?intent|beforeunload/i) },
  { n: 108, group: "Conversion", point: "UTM-tagged lead capture + notification", kind: "auto",
    check: (c) => has(c.allText, /utm_source|utm_campaign/i) },
];

if (POINTS.length !== 108) throw new Error(`optimization stack must have exactly 108 points, has ${POINTS.length}`);

/**
 * score({ files, facts, phoneDigits, slug, manifest, photosPlaced })
 * Returns the full auditable scorecard. `met` counts only PROVEN points;
 * runtime points marked runtimeTrue are counted (Vercel guarantees them).
 */
function score({ files, facts = {}, phoneDigits = "", slug = "", manifest = {}, photosPlaced = 0, runtime = null }) {
  const ctx = {
    files, facts, phoneDigits, slug, manifest, photosPlaced,
    index: textOf(files, "index.html"),
    allText: allText(files),
    css: allText(files, [".css"]),
    js: allText(files, [".js"]),
    schema: schemaTypes(files),
  };

  const results = POINTS.map((p) => {
    let state;
    if (p.check) {
      let v;
      try { v = p.check(ctx); } catch { v = false; }
      state = v === null ? "n/a" : v ? "met" : "unmet";
    } else if (p.kind === "runtime") {
      // Prefer an OBSERVED measurement over an assumption. Only when no
      // measurement exists do we fall back to the platform guarantee
      // (runtimeTrue) or leave the point unverified.
      let observed = null;
      if (runtime && typeof p.measure === "function") {
        try { observed = p.measure(runtime); } catch { observed = null; }
      }
      if (observed === true) state = "met";
      else if (observed === false) state = "unmet";
      else state = p.runtimeTrue ? "met" : "unverified";
    } else {
      state = "needs_" + p.kind; // intake | research | content
    }
    return { n: p.n, group: p.group, point: p.point, kind: p.kind, state };
  });

  const tally = results.reduce((acc, r) => { acc[r.state] = (acc[r.state] || 0) + 1; return acc; }, {});
  const met = tally.met || 0;
  const applicable = 108 - (tally["n/a"] || 0);
  const byGroup = {};
  for (const r of results) {
    byGroup[r.group] = byGroup[r.group] || { met: 0, total: 0 };
    byGroup[r.group].total++;
    if (r.state === "met") byGroup[r.group].met++;
  }

  return {
    schema: "wss-optimization-108-v1",
    // Every other entry in `checks` carries a status, and operator summaries
    // print `name=status` — so this one rendered as "optimization_108=undefined"
    // and read like a system that was not running. It is REPORTED, never
    // gating: a low score is honest, not a failure, hence "scored" rather than
    // passed/failed.
    status: "scored",
    met,
    applicable,
    total: 108,
    headline: `${met}/${applicable} proven (${108 - applicable} n/a)`,
    tally,
    byGroup,
    gaps: {
      needs_intake: results.filter((r) => r.state === "needs_intake").map((r) => r.n),
      needs_research: results.filter((r) => r.state === "needs_research").map((r) => r.n),
      needs_content: results.filter((r) => r.state === "needs_content").map((r) => r.n),
      unmet: results.filter((r) => r.state === "unmet").map((r) => r.n),
    },
    points: results,
  };
}

module.exports = { POINTS, score };
