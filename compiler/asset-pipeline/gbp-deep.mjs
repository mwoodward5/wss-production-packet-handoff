// V7 GBP deep import — structured extraction from a Firecrawl scrape of a
// public Google Business Profile / Maps URL. Everything extracted is SOURCED:
// hours, attributed review snippets, photo URLs, exact address + lat/lng.
// Nothing here is ever invented; a field that can't be found stays null.
//
// Input: { markdown, links[], url } (Firecrawl scrape output + the GBP url).
// Output: { hours, hoursSpec, reviews, photos, address, latlng, rating, reviewCount }

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SCHEMA = { Monday: "Mo", Tuesday: "Tu", Wednesday: "We", Thursday: "Th", Friday: "Fr", Saturday: "Sa", Sunday: "Su" };

export function parseGbpDeep({ markdown = "", links = [], url = "" } = {}) {
  const md = String(markdown || "");
  const out = {
    hours: parseHours(md),
    reviews: parseReviews(md),
    photos: parsePhotos(md, links),
    address: parseAddress(md),
    latlng: parseLatLng(url, md, links),
    rating: parseRating(md),
  };
  out.hoursSpec = out.hours ? toOpeningHoursSpec(out.hours) : null;
  return out;
}

// ---------------- hours ----------------
// Matches blocks like "Monday 9 AM–5 PM" / "Monday: 9:00 AM - 5:00 PM" / "Sunday Closed"
function parseHours(md) {
  const out = [];
  for (const day of DAYS) {
    const re = new RegExp(`${day}\\s*[:·|]?\\s*(Closed|Open 24 hours|\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM|am|pm)?\\s*[–—-]\\s*\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM|am|pm))`, "i");
    const m = md.match(re);
    if (m) out.push({ day, hours: normalizeHours(m[1]) });
  }
  return out.length >= 3 ? out : null; // need a real hours table, not a stray match
}
function normalizeHours(s) {
  return s.replace(/\s*[–—-]\s*/, "–").replace(/\s+/g, " ").trim();
}
function toOpeningHoursSpec(hours) {
  const spec = [];
  for (const { day, hours: h } of hours) {
    if (/closed/i.test(h)) continue;
    if (/24 hours/i.test(h)) { spec.push({ "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${day}`, opens: "00:00", closes: "23:59" }); continue; }
    const m = h.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?–(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!m) continue;
    spec.push({
      "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${day}`,
      opens: to24(m[1], m[2], m[3] || m[6]), closes: to24(m[4], m[5], m[6]),
    });
  }
  return spec.length ? spec : null;
}
function to24(h, mm, ap) {
  let n = parseInt(h, 10);
  if (ap && /pm/i.test(ap) && n < 12) n += 12;
  if (ap && /am/i.test(ap) && n === 12) n = 0;
  return `${String(n).padStart(2, "0")}:${mm || "00"}`;
}

// ---------------- reviews (attributed, never invented) ----------------
// GBP markdown patterns: a name line near a star rating and quote text.
function parseReviews(md) {
  const out = [];
  // Pattern 1: "★★★★★" or "5 stars" blocks followed by text, preceded by a name
  const NOT_NAMES = /^(reviews?|hours|photos?|about|google|services?|overview|sort|write|updates?|posts?|questions?)$/i;
  const starBlocks = [...md.matchAll(/(?:^|\n)([A-Z][a-z]+ [A-Z][a-z.'-]+)\s*\n(?:[^\n]*\n)?[^\n]*(★{3,5}|[45](?:\.\d)? star)[^\n]*\n+["“]?([^\n"”]{40,400})["”]?/g)];
  for (const m of starBlocks) {
    if (NOT_NAMES.test(m[1].trim())) continue;
    out.push({ author: m[1].trim(), rating: (m[2].match(/★/g) || []).length || parseFloat(m[2]) || 5, text: m[3].trim(), source: "gbp" });
  }
  // Pattern 2: quoted review with attribution dash: “...” — Name
  const quoted = [...md.matchAll(/["“]([^"”]{40,400})["”]\s*[—–-]\s*([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/g)];
  for (const m of quoted) out.push({ author: m[2].trim(), rating: null, text: m[1].trim(), source: "gbp" });
  // Pattern 3: bare ★★★★★ + following paragraph (author unknown → attribute as "Google review")
  if (!out.length) {
    const bare = [...md.matchAll(/★{4,5}[^\n]*\n+([^\n]{40,300})/g)];
    for (const m of bare) out.push({ author: "Google review", rating: 5, text: m[1].trim(), source: "gbp" });
  }
  // dedupe by text prefix
  const seen = new Set();
  return out.filter((r) => {
    const k = r.text.slice(0, 60).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return !/^(google|reviews?|write a review|sort by)/i.test(r.text);
  }).slice(0, 8);
}
function parseRating(md) {
  const m = md.match(/(\d\.\d)\s*(?:★|stars?|\/\s*5)[\s\S]{0,60}?(\d{1,4}(?:,\d{3})?)\)?\s*(?:Google )?reviews/i) || md.match(/(\d\.\d)[\s★]*\((\d{1,4}(?:,\d{3})?)\)/);
  if (!m) return null;
  return { value: parseFloat(m[1]), count: parseInt(m[2].replace(/,/g, ""), 10), source: "gbp" };
}

// ---------------- photos ----------------
function parsePhotos(md, links) {
  const urls = new Set();
  const all = [...(md.match(/https?:\/\/[^\s)"'\]]+/g) || []), ...links.map((l) => (typeof l === "string" ? l : l?.url)).filter(Boolean)];
  for (const u of all) {
    if (/googleusercontent\.com|ggpht\.com|streetviewpixels/i.test(u) && !/streetviewpixels/i.test(u)) {
      // normalize size suffix to a renderable width (=w1200)
      const clean = u.replace(/=w\d+-h\d+[^\s]*/, "=w1200").replace(/[).,]+$/, "");
      if (!/maps\/vt|staticmap|\/p\/AF1Qip[^=]*=s\d\d(?:\D|$)/.test(clean)) urls.add(clean);
    }
  }
  return [...urls].slice(0, 12);
}

// ---------------- address + lat/lng ----------------
function parseAddress(md) {
  const m = md.match(/(\d{1,6}\s+[A-Z][A-Za-z0-9 .'-]+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Hwy|Ct|Pkwy|Cir|Pl|Ter)\.?,?\s+[A-Z][A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/);
  return m ? m[1].trim() : null;
}
export function parseLatLng(url = "", md = "", links = []) {
  const hay = [url, md, ...links.map((l) => (typeof l === "string" ? l : l?.url || ""))].join("\n");
  // Maps URL pattern @lat,lng,zoom
  let m = hay.match(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  // !3d<lat>!4d<lng> data param (place pins — prefer this when present)
  const m2 = hay.match(/!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/);
  if (m2) m = m2;
  // ?q=lat,lng / ll=lat,lng
  if (!m) m = hay.match(/[?&](?:q|ll|center|daddr)=(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, source: "gbp" };
}

// Merge deep-GBP results into packet.enrichment_sources with provenance.
export function mergeGbpDeep(packet, deep) {
  if (!deep) return packet;
  const src = packet.enrichment_sources ?? (packet.enrichment_sources = {});
  const put = (k, value, extra = {}) => { if (value != null && (!Array.isArray(value) || value.length)) src[k] = { source: "gbp", confidence: 0.95, value, ...extra }; };
  put("hours", deep.hours, { hours_spec: deep.hoursSpec });
  put("reviews_attributed", deep.reviews);
  put("gbp_photos", deep.photos);
  put("address", deep.address);
  put("latlng", deep.latlng ? { lat: deep.latlng.lat, lng: deep.latlng.lng } : null);
  put("rating", deep.rating);
  if (deep.photos?.length) {
    packet.media = packet.media ?? {};
    const cat = packet.media.catalog ?? (packet.media.catalog = []);
    const have = new Set(cat.map((m) => m.url));
    for (const u of deep.photos) if (!have.has(u)) cat.push({ kind: "photo", url: u, source: "gbp" });
  }
  return packet;
}
