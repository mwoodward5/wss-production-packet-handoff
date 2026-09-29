"use strict";

/**
 * lib/trustglow-configs.js — LeadMiner truth packet -> trust-glow-template's
 * two config files.
 *
 * WHY THIS EXISTS
 * The trust-glow template (the "McCabe/Wilbourn" build) is the best plumbing
 * donor we have: real Google reviewer FACES, near-me city pages, opening
 * hours, Apple/Google directions, a review-request composer, FAQ + Speakable
 * schema, llms.txt. Every one of those is fed by a field the LeadMiner packet
 * already carries — and the production donors render none of them.
 *
 * The template's own contract (MIRROR-PACK 00-README, rule 1) is that exactly
 * two files hold every client fact:
 *     src/client.config.ts   presentation truth
 *     src/trust.config.ts    factual truth
 * plus assets and five palette tokens. For Wilbourn those were written BY HAND.
 * This module writes them from the packet, which is what turns a one-off into
 * a lane.
 *
 * THE RULE THAT OUTRANKS COMPLETENESS (MIRROR-PACK rule 2, "deletion is a
 * feature"): a fact that is not in the packet is OMITTED, never invented and
 * never defaulted. Every widget downstream renders null on an absent key, so
 * a sparse packet yields a smaller honest site — not a padded one.
 */

const VERTICAL_PRESETS = Object.freeze({
  plumbing: { key: "plumbing", slug: "plumber", noun: "Plumber", schema: "Plumber", preset: "plumbingPreset" },
  roofing: { key: "roofing", slug: "roofer", noun: "Roofer", schema: "RoofingContractor", preset: "roofingPreset" },
  hvac: { key: "hvac", slug: "hvac-contractor", noun: "HVAC contractor", schema: "HVACBusiness", preset: "hvacPreset" },
  electrical: { key: "electrical", slug: "electrician", noun: "Electrician", schema: "Electrician", preset: "electricalPreset" },
  landscaping: { key: "landscaping", slug: "landscaper", noun: "Landscaper", schema: "LandscapingBusiness", preset: "landscapingPreset" },
  concrete: { key: "concrete", slug: "concrete-contractor", noun: "Concrete contractor", schema: "GeneralContractor", preset: "plumbingPreset" },
  fencing: { key: "fencing", slug: "fence-company", noun: "Fence company", schema: "HomeAndConstructionBusiness", preset: "plumbingPreset" },
});

function presetFor(industry) {
  const key = String(industry || "").toLowerCase().trim();
  return VERTICAL_PRESETS[key]
    || VERTICAL_PRESETS[key.replace(/s$/, "")]
    || { key: key || "local", slug: slugify(key || "local-business"), noun: titleCase(key || "Local business"), schema: "LocalBusiness", preset: "plumbingPreset" };
}

function slugify(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function titleCase(value) {
  return String(value || "").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** A TS string literal that cannot break out of its quotes. */
function ts(value) {
  return JSON.stringify(String(value == null ? "" : value));
}

/** sRGB hex -> oklch(L% C H) string, the format the template's :root expects. */
function hexToOklchCss(hex, { lightness = null, chroma = null } = {}) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const lin = [(int >> 16) & 255, (int >> 8) & 255, int & 255]
    .map((v) => v / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = lin;
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  const outL = lightness == null ? L : lightness;
  const outC = chroma == null ? C : chroma;
  return `oklch(${(outL).toFixed(3)} ${outC.toFixed(3)} ${H.toFixed(1)})`;
}

/**
 * The five palette tokens, derived from the client's own two brand colours.
 * Lightness is fixed by the template's design (dark ground, near-white text);
 * only HUE is the client's, so contrast survives while the family is theirs.
 */
function paletteFrom({ primary, accent }) {
  const p = primary || accent;
  const a = accent || primary;
  if (!p || !a) return null;
  return {
    background: hexToOklchCss(p, { lightness: 0.253, chroma: 0.045 }),
    cream: hexToOklchCss(a, { lightness: 0.949, chroma: 0.017 }),
    petrolDeep: hexToOklchCss(p, { lightness: 0.205, chroma: 0.042 }),
    coral: hexToOklchCss(a, { lightness: 0.702, chroma: 0.163 }),
    mint: hexToOklchCss(p, { lightness: 0.858, chroma: 0.121 }),
  };
}

/** Places periods -> the template's { day, open, close } rows. Absent day = closed. */
const DAYS = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

function hhmm(part) {
  if (!part || typeof part !== "object") return "";
  const h = Number(part.hour), m = Number(part.minute || 0);
  if (!Number.isFinite(h)) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Places `regularOpeningHours.periods[]` -> the template's weekly rows.
 *
 * The packet ships Places' RAW shape ({open:{day,hour,minute}, close:{...}}),
 * not a pre-flattened one — reading only `h.day/h.open` silently produced
 * zero rows and the hours block vanished from a site whose packet had them.
 * A day absent from periods is CLOSED and stays absent (never 00:00-00:00);
 * a period with an open and no close is a 24h day.
 */
function hoursFrom(lead) {
  const rows = Array.isArray(lead.hours) ? lead.hours : [];
  const out = [];
  for (const period of rows) {
    if (!period || typeof period !== "object") continue;
    // Already flattened by an upstream caller.
    if (period.day && (period.open || period.opens)) {
      const open = period.open || period.opens;
      const close = period.close || period.closes;
      if (typeof open === "string" && typeof close === "string") {
        out.push({ day: titleCase(period.day), open, close });
        continue;
      }
    }
    const openPart = period.open;
    if (!openPart || typeof openPart !== "object") continue;
    const dayIndex = Number(openPart.day);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) continue;
    const open = hhmm(openPart);
    const close = hhmm(period.close);
    if (!open) continue;
    // Open with no close = 24 hours; overnight close lands on the next day.
    out.push({ day: DAYS[dayIndex], open, close: close || "23:59" });
  }
  return out;
}

/**
 * buildTrustGlowConfigs(packetLead, { slug, canonicalUrl })
 *   -> { clientConfig, trustConfig, palette, assets, coverage }
 *
 * `assets` lists the remote files the caller must re-host (rule 6: re-host
 * every image EXCEPT reviewer avatars, which must stay on Google's CDN).
 */
function buildTrustGlowConfigs(lead = {}, { slug = "", canonicalUrl = "" } = {}) {
  const preset = presetFor(lead.industry);
  const city = lead.city || "";
  const state = lead.state || "";
  const business = lead.business_name || "";
  const siteKey = slug || slugify(`${business} ${city}`);
  const canonical = canonicalUrl || `https://${siteKey}.wss-ai.com`;

  const reviews = (Array.isArray(lead.reviews) ? lead.reviews : []).slice(0, 5)
    .map((r, i) => ({
      id: `r${i + 1}`,
      author: r.author || "",
      // RULE 5: verbatim, no proxy, no resize. ReviewerFace sends
      // referrerPolicy="no-referrer", which is what makes Google serve it.
      avatarUrl: r.author_photo_url || "",
      rating: r.rating,
      platform: "Google",
      date: (r.published_at || "").slice(0, 10),
      body: r.text || "",
    }))
    .filter((r) => r.author && r.body);

  const services = (Array.isArray(lead.services) ? lead.services : []).slice(0, 12)
    .map((s, i) => ({
      id: `sv${i + 1}`,
      name: s.name || "",
      description: s.description || "",
      // RULE: a price only when the source literally printed one.
      ...(s.price_from != null ? { priceFrom: s.price_from } : {}),
    }))
    .filter((s) => s.name);

  const areas = Array.isArray(lead.service_areas) && lead.service_areas.length
    ? lead.service_areas.slice(0, 14)
    : (city ? [city] : []);

  const photos = (Array.isArray(lead.photos) ? lead.photos : []).slice(0, 8)
    .map((p) => (typeof p === "string" ? { url: p, source: "own_site" } : p))
    .filter((p) => p && p.url);

  const ratings = lead.rating != null && lead.review_count != null
    ? [{
      platform: "Google",
      ratingValue: lead.rating,
      reviewCount: lead.review_count,
      bestRating: 5,
      ...(lead.gbp_url ? { profileUrl: lead.gbp_url } : {}),
    }]
    : [];

  const palette = paletteFrom({ primary: lead.brand_colors?.primary, accent: lead.brand_colors?.accent });

  const clientConfig = {
    siteKey,
    canonicalUrl: canonical,
    vertical: { key: preset.key, nearMeSlug: preset.slug, nearMeNoun: preset.noun, aliases: [] },
    brand: {
      wordmark: business,
      ...(city && state ? { wordmarkSub: `${city}, ${state}` } : {}),
      ...(lead.logo_url ? { logoSrc: "/brand/logo.png", logoAlt: business } : {}),
      logoScale: 2,
      palette,
    },
    hero: {
      mode: "kenburns",
      stillDurationSec: 7,
      kicker: lead.founding_year ? `Serving ${city} since ${lead.founding_year}` : (city ? `Serving ${city}` : ""),
      headline: `${preset.noun === "Plumber" ? "Plumbing" : preset.noun} in`,
      headlineAccent: city ? `${city}.` : "",
    },
    ...(lead.place_id ? { maps: { placeId: lead.place_id, zoom: 12 } } : { maps: {} }),
    provenance: {
      donorUrl: "https://trust-glow-template.lovable.app",
      ...(lead.website_url ? { clientSiteUrl: lead.website_url } : {}),
      scrapedAt: new Date().toISOString().slice(0, 10),
    },
  };

  const trustConfig = {
    business: {
      name: business,
      schemaType: preset.schema,
      ...(lead.industry ? { category: titleCase(lead.industry) } : {}),
      ...(lead.website_url ? { url: lead.website_url } : {}),
      ...(lead.founding_year ? { foundingYear: String(lead.founding_year) } : {}),
    },
    contact: {
      ...(lead.phone_e164 ? { phone: lead.phone_e164 } : {}),
      ...(lead.phone_national ? { phoneDisplay: lead.phone_national } : {}),
      ...(lead.email ? { email: lead.email } : {}),
    },
    location: {
      primary: {
        id: "hq",
        label: business,
        ...(lead.street ? { street: lead.street } : {}),
        city, region: state,
        ...(lead.zip ? { postal: lead.zip } : {}),
        country: "US",
        ...(lead.lat != null && lead.lng != null ? { geo: { lat: lead.lat, lng: lead.lng } } : {}),
        ...(lead.gbp_url ? { mapUrl: lead.gbp_url } : {}),
      },
      serviceAreas: areas,
    },
    ...(hoursFrom(lead).length ? { hours: { weekly: hoursFrom(lead) } } : {}),
    proof: {
      ...(ratings.length ? { ratings } : {}),
      ...(reviews.length ? { reviews } : {}),
      ...(photos.length ? {
        gallery: photos.map((p, i) => ({
          id: `p${i + 1}`, src: `/gallery/photo-${i + 1}.jpg`, alt: `${business} work photo ${i + 1}`,
        })),
      } : {}),
    },
    ...(services.length ? { services } : {}),
    ...(Array.isArray(lead.social) && lead.social.length
      ? { social: { accounts: lead.social.filter((a) => a && a.platform && a.url) } }
      : {}),
  };

  return {
    clientConfig,
    trustConfig,
    palette,
    // Everything the caller must download + re-host. Reviewer avatars are
    // deliberately excluded: Google's CDN is their only legal source.
    assets: {
      ...(lead.logo_url ? { "public/brand/logo.png": lead.logo_url } : {}),
      ...Object.fromEntries(photos.map((p, i) => [`public/gallery/photo-${i + 1}.jpg`, p.url])),
    },
    coverage: {
      reviews: reviews.length,
      reviewer_faces: reviews.filter((r) => r.avatarUrl).length,
      services: services.length,
      areas: areas.length,
      photos: photos.length,
      hours: hoursFrom(lead).length,
      palette: Boolean(palette),
    },
  };
}

/** Render clientConfig as the template's src/client.config.ts body. */
function renderClientConfigTs(clientConfig) {
  return `// GENERATED by lib/trustglow-configs.js from a LeadMiner truth packet.\n`
    + `// Absent facts are omitted, never invented — every widget renders null.\n`
    + `import type { ClientConfig } from "./client.config.types";\n\n`
    + `export const clientConfig: ClientConfig = ${JSON.stringify(clientConfig, null, 2)};\n`;
}

/** Render trustConfig as the template's src/trust.config.ts body. */
function renderTrustConfigTs(trustConfig, presetName = "plumbingPreset") {
  return `// GENERATED by lib/trustglow-configs.js from a LeadMiner truth packet.\n`
    + `import { defineTrustConfig, blankTrustConfig } from "@/trust-widgets/trust.config";\n`
    + `import { applyVertical, ${presetName} } from "@/trust-widgets/verticals";\n\n`
    + `const base = defineTrustConfig({\n  ...blankTrustConfig,\n  ...${JSON.stringify(trustConfig, null, 2)},\n});\n\n`
    + `export const trustConfig = applyVertical(base, ${presetName});\n`;
}

module.exports = {
  VERTICAL_PRESETS,
  presetFor,
  paletteFrom,
  hexToOklchCss,
  buildTrustGlowConfigs,
  renderClientConfigTs,
  renderTrustConfigTs,
};
