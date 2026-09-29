// Goldilocks intake layer — keep the signal, cut the junk.
//
// The forge does not need thousands of scraped rows to build a great, credible
// site. It needs a small set of TRUE, high-signal facts. This module distills
// raw discovery into a compact BusinessTruthPacket and surfaces the handful of
// "opportunities" that actually move rankings and conversions (led by NAP
// consistency, which is a real local-SEO trust signal). Pure functions only —
// no network, no keys — so it always runs and degrades gracefully.

export const GOLDILOCKS = {
  maxPhotos: 8,      // real work photos beat a wall of thumbnails
  maxServices: 8,
  maxReviewThemes: 5,
  maxReviewQuotes: 3,
  maxSocials: 6,
  maxColors: 5,
  maxOpportunities: 6,
  maxNearMePages: 4, // hard cap so we never spin up thin "authority junk" pages
};

const JUNK_PATTERNS = [
  /logo/i, /favicon/i, /sprite/i, /icon(s)?[-_./]/i, /placeholder/i, /avatar/i,
  /badge/i, /pixel/i, /1x1/i, /spacer/i, /blank\./i, /loading/i, /thumb(nail)?/i,
  /\.svg(\?|$)/i, /^data:/i, /gravatar/i, /googletagmanager|doubleclick|facebook\.com\/tr/i,
];
const CONTENT_HINTS = /gallery|project|portfolio|work|photo|image|upload|masonry|landscape|patio|build|before|after|hero|jobsite|install/i;

function digits(s) { return String(s || "").replace(/\D/g, ""); }
function last10(s) { const d = digits(s); return d.length >= 10 ? d.slice(-10) : d; }
function norm(u) { return String(u || "").split("?")[0].replace(/\/$/, "").toLowerCase(); }

// Curate photos: drop junk, dedupe, rank real content images, cap.
export function curatePhotos(urls = [], max = GOLDILOCKS.maxPhotos) {
  const seen = new Set();
  const scored = [];
  for (const raw of urls) {
    if (!raw || typeof raw !== "string") continue;
    if (JUNK_PATTERNS.some((re) => re.test(raw))) continue;
    const key = norm(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    let score = 0;
    if (CONTENT_HINTS.test(raw)) score += 3;
    if (/\.(jpe?g|webp|png)(\?|$)/i.test(raw)) score += 1;
    if (/\d{3,4}x\d{3,4}/.test(raw)) score += 1;   // sized asset, likely real
    if (/-\d{2,4}x\d{2,4}\./.test(raw)) score -= 1; // WP small-crop variant
    scored.push({ url: raw, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.url);
}

// NAP consistency — the money signal. Compare the business's own site against
// its GBP / provided profile. A phone or address mismatch splits Google trust
// across citations and costs map-pack rank + calls.
export function napConsistency({ site = {}, gbp = {}, profile = {} } = {}) {
  const out = { checks: [], mismatches: [], consistent: true };
  const cmp = (label, a, b, normFn) => {
    if (!a || !b) return;
    const av = normFn(a), bv = normFn(b);
    const match = av === bv;
    out.checks.push({ field: label, match, site: a, other: b });
    if (!match) { out.consistent = false; out.mismatches.push({ field: label, site: a, other: b }); }
  };
  const otherPhone = gbp.phone || profile.phone;
  const otherAddr = gbp.address || profile.address;
  const otherName = gbp.name || profile.business_name;
  cmp("phone", site.phone, otherPhone, last10);
  cmp("address", site.address, otherAddr, (s) => digits(s).slice(0, 6)); // street-number + zip-ish
  cmp("name", site.name, otherName, (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, ""));
  return out;
}

// Reviews -> themes (+ a few short quotes). Never dump every review.
export function reviewThemes(reviews = []) {
  const texts = reviews.map((r) => (typeof r === "string" ? r : r?.text || "")).filter(Boolean);
  const stop = new Set("the a an and or but for with was were is are our your you they we he she it to of in on at from this that very had have has our their them then just so as be been great good".split(" "));
  const freq = {};
  for (const t of texts) {
    for (const w of t.toLowerCase().match(/[a-z]{4,}/g) || []) {
      if (stop.has(w)) continue; freq[w] = (freq[w] || 0) + 1;
    }
  }
  const themes = Object.entries(freq).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
    .slice(0, GOLDILOCKS.maxReviewThemes).map(([w, n]) => ({ theme: w, mentions: n }));
  const quotes = texts.filter((t) => t.length > 30 && t.length < 180).slice(0, GOLDILOCKS.maxReviewQuotes);
  return { count: texts.length, themes, quotes };
}

// The handful of opportunities that actually matter. Bounded + severity-ranked.
export function buildOpportunities({ nap = {}, found = {}, copyLen = 0 } = {}) {
  const ops = [];
  for (const m of nap.mismatches || []) {
    ops.push({ type: "nap_mismatch", severity: "high",
      headline: `Your ${m.field} doesn't match between your website and Google`,
      detail: `Site shows "${m.site}", Google/profile shows "${m.other}". Inconsistent ${m.field} splits your local-search trust and costs map-pack rankings and calls.` });
  }
  const gaps = found.seo_gaps || [];
  if (gaps.includes("no structured data detected")) ops.push({ type: "no_schema", severity: "med", headline: "Search engines can't read your business as structured data", detail: "No schema/JSON-LD found — you're invisible to rich results and AI answer engines." });
  if (gaps.includes("no FAQ surface for AI answer engines")) ops.push({ type: "no_faq", severity: "med", headline: "You don't show up when people ask AI a question", detail: "No FAQ content — ChatGPT/AI search have nothing to quote about you." });
  if (gaps.includes("no visible review proof")) ops.push({ type: "no_reviews", severity: "med", headline: "Your reviews aren't doing any selling", detail: "No review proof on the page — visitors don't see social proof at the decision moment." });
  if (copyLen && copyLen < 1500) ops.push({ type: "thin_copy", severity: "low", headline: "Thin page content", detail: "Very little copy for Google to rank — not enough to compete for your service terms." });
  if ((found.photos || []).length < 3) ops.push({ type: "few_photos", severity: "low", headline: "Not enough proof of your work", detail: "Few real project photos — buyers want to see finished jobs before they call." });
  return ops.slice(0, GOLDILOCKS.maxOpportunities);
}

// Assemble the compact, high-signal packet the forge + email actually consume.
export function buildBusinessTruthPacket({ profile = {}, found = {}, gbp = {} } = {}) {
  const site = { name: profile.business_name, phone: found?.contact?.phone, address: found?.contact?.address };
  const nap = napConsistency({ site, gbp, profile });
  const photos = curatePhotos(found.photos || []);
  const themes = reviewThemes(gbp.reviews || found.reviews || []);
  const copyLen = (found.copy || "").length;
  const conf = (v, c) => (v ? { value: v, confidence: c } : null);
  return {
    identity: {
      name: conf(profile.business_name, 0.95),
      phone: conf(site.phone || gbp.phone || profile.phone, site.phone ? 0.9 : 0.6),
      address: conf(site.address || gbp.address || profile.address, 0.7),
      city: conf(profile.city, 0.95), state: conf(profile.state, 0.95),
      category: conf(profile.industry, 0.9),
    },
    napConsistency: nap,
    logo: found.logo || null,
    colors: (found.colors || []).slice(0, GOLDILOCKS.maxColors),
    photos,                                   // curated, capped
    services: (found.services || []).slice(0, GOLDILOCKS.maxServices),
    reviewThemes: themes,
    socials: (found.socials || []).slice(0, GOLDILOCKS.maxSocials),
    opportunities: buildOpportunities({ nap, found, copyLen }),
    counts: { photos: photos.length, services: (found.services || []).length, reviews: themes.count },
  };
}
