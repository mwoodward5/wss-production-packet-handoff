"use strict";

// lib/mirror-engine/local-seo.js — LOCAL SEO + TRUST BLOCK, SHARED BY ALL VERTICALS.
//
// One module, every vertical. Nothing here knows what a roof or a fence is: it
// takes the prospect's verified facts and emits structured data, a visible NAP,
// a non-blocking map and a compliant review CTA. A per-vertical copy of this
// would guarantee drift between the JSON-LD and the visible DOM, which is the
// exact mismatch Google penalises.
//
// THE ONE RULE: every field is hydrated from the prospect's own truth data or it
// does not render. There is no placeholder, no "call for details", no averaged
// rating, no guessed Place ID. A structured-data block asserting facts the
// business never published is worse than no structured data at all — it is a
// machine-readable lie, and it is the thing that gets a listing filtered.
//
// WHY A MAP FACADE AND NOT AN IFRAME. A Google Maps embed pulls ~900 KB and
// blocks the main thread during the exact window LCP is measured. The map is
// worth keeping for trust, so it renders as a static, styled facade that only
// becomes the real iframe on click. Zero third-party bytes until the visitor
// asks for them, and the "Open in Google Maps" link works whether or not they
// ever click. loading="lazy" is applied to the iframe we inject on click as a
// second belt.
//
// REVIEW CTA COMPLIANCE (Google's policy, not our preference):
//   · deep-link only — https://search.google.com/local/writereview?placeid=…
//   · NO pre-filled review text, NO pre-selected star rating
//   · NO incentive language, NO gating on "was your experience positive?"
//   · missing Place ID renders NOTHING. A broken or guessed review link is both
//     a policy problem and an embarrassment on a preview we are selling.

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const clean = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s && !/^(null|undefined|n\/a|none)$/i.test(s) ? s : "";
};

// Blank must be NULL, not zero. Number("") is 0, so an earlier version of this
// turned "no coordinates supplied" into geo {latitude:0, longitude:0} — Null
// Island, in the Gulf of Guinea — and shipped it as the prospect's verified
// location in their structured data. Absent input returns null and the caller
// omits the field entirely.
const num = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalise whatever the intake/enrichment layer produced into the exact field
 * set this module renders. Accepts several upstream spellings because facts
 * arrive from CallPrep, the Intake Genie and the miner with different casing.
 */
function normaliseFacts(facts = {}) {
  const f = facts || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = clean(f[k]);
      if (v) return v;
    }
    return "";
  };
  const rating = num(f.rating ?? f.google_rating ?? f.googleRating);
  const reviewCount = num(f.review_count ?? f.reviewCount ?? f.user_ratings_total);
  return {
    name: pick("business_name", "businessName", "name"),
    phone: pick("phone", "phone_number", "phoneNumber", "nationalPhoneNumber"),
    street: pick("address", "street", "street_address", "streetAddress", "address1"),
    city: pick("city", "locality"),
    state: pick("state", "region", "administrative_area"),
    postal: pick("postal", "postal_code", "postalCode", "zip"),
    country: pick("country") || "US",
    lat: num(f.geo_lat ?? f.lat ?? f.latitude),
    lng: num(f.geo_lng ?? f.lng ?? f.longitude),
    url: pick("site_url", "siteUrl", "preview_url", "website"),
    image: pick("logo_url", "logoUrl", "image", "hero_image"),
    placeId: pick("place_id", "placeId"),
    profileUrl: pick("profile_url", "profileUrl"),
    priceRange: pick("price_range", "priceRange"),
    // Only a real, published rating counts. A rating with no count behind it is
    // not evidence, so both must be present and sane or neither renders.
    rating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
    reviewCount: reviewCount !== null && reviewCount > 0 ? reviewCount : null,
    areaServed: Array.isArray(f.areas) ? f.areas.map(clean).filter(Boolean)
      : Array.isArray(f.area_served) ? f.area_served.map(clean).filter(Boolean) : [],
    hours: Array.isArray(f.hours) ? f.hours.filter(Boolean)
      : Array.isArray(f.opening_hours) ? f.opening_hours.filter(Boolean) : [],
  };
}

/** schema.org LocalBusiness. Omits every key we cannot back with real data. */
function localBusinessJsonLd(facts = {}) {
  const f = normaliseFacts(facts);
  if (!f.name) return "";                       // no name, no entity, no markup

  const node = { "@context": "https://schema.org", "@type": "LocalBusiness", name: f.name };
  if (f.image) node.image = f.image;
  if (f.phone) node.telephone = f.phone;
  if (f.url) node.url = f.url;
  if (f.priceRange) node.priceRange = f.priceRange;

  if (f.street || f.city || f.state || f.postal) {
    node.address = { "@type": "PostalAddress" };
    if (f.street) node.address.streetAddress = f.street;
    if (f.city) node.address.addressLocality = f.city;
    if (f.state) node.address.addressRegion = f.state;
    if (f.postal) node.address.postalCode = f.postal;
    node.address.addressCountry = f.country;
  }
  if (f.lat !== null && f.lng !== null) {
    node.geo = { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lng };
  }
  if (f.areaServed.length) node.areaServed = f.areaServed;
  if (f.hours.length) node.openingHours = f.hours;
  if (f.profileUrl) node.sameAs = [f.profileUrl];

  // aggregateRating ONLY with a real rating AND a real count. This is the single
  // most-abused field in local SEO and the fastest way to earn a manual action.
  if (f.rating !== null && f.reviewCount !== null) {
    node.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: f.rating,
      reviewCount: f.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  return `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
}

/**
 * The visible NAP. Rendered from the SAME normalised facts as the JSON-LD so the
 * two cannot disagree — a structured-data/DOM mismatch is a ranking liability,
 * and it happens the moment these are built from two different objects.
 */
function napBlock(facts = {}, { accent = "#c05621" } = {}) {
  const f = normaliseFacts(facts);
  if (!f.name) return "";
  // Google's formattedAddress is the WHOLE address ("4200 S Hulen St #654, Fort
  // Worth, TX 76109, USA"), while city/state/postal also arrive as their own
  // fields. Appending both produced "…Fort Worth, TX 76109, USA, Fort Worth, TX"
  // on a real prospect — sloppy on a page we are selling. If the street value
  // already contains the locality, it IS the full address; render it alone and
  // drop the trailing country, which no local business needs on its own site.
  const streetHasLocality = f.street && f.city
    && f.street.toLowerCase().includes(f.city.toLowerCase());
  const addrLine = streetHasLocality
    ? f.street.replace(/,\s*(USA|United States)\s*$/i, "")
    : [f.street, [f.city, f.state].filter(Boolean).join(", "), f.postal]
      .filter(Boolean).join(" · ");
  const telHref = f.phone ? `tel:+1${f.phone.replace(/\D/g, "").replace(/^1/, "")}` : "";

  return `<address class="nap" itemscope itemtype="https://schema.org/LocalBusiness" style="font-style:normal;line-height:1.7">
  <span class="nap-name" itemprop="name" style="font-weight:700">${esc(f.name)}</span>
  ${addrLine ? `<span class="nap-address" itemprop="address" style="display:block">${esc(addrLine)}</span>` : ""}
  ${f.phone ? `<a class="nap-phone" itemprop="telephone" href="${esc(telHref)}" style="display:block;color:${esc(accent)};font-weight:600;text-decoration:none">${esc(f.phone)}</a>` : ""}
</address>`;
}

/**
 * Map facade. Static, styled, zero third-party bytes until clicked; the click
 * handler injects the iframe with loading="lazy". Degrades to a plain link with
 * JavaScript disabled, which is the honest fallback.
 */
function lazyMap(facts = {}, { accent = "#c05621" } = {}) {
  const f = normaliseFacts(facts);
  if (!f.name) return "";
  const query = encodeURIComponent(
    [f.name, f.street, [f.city, f.state].filter(Boolean).join(", ")].filter(Boolean).join(", "),
  );
  // Documented, key-free forms. query_place_id pins exactly when we have an id
  // and degrades to a name+address search when we do not — never a blank map.
  const openUrl = `https://www.google.com/maps/search/?api=1&query=${query}` +
    (f.placeId ? `&query_place_id=${encodeURIComponent(f.placeId)}` : "");
  const embedUrl = `https://maps.google.com/maps?q=${query}&output=embed`;
  const destination = encodeURIComponent(
    [f.street, [f.city, f.state].filter(Boolean).join(", ")].filter(Boolean).join(", ")
      || (f.lat !== null && f.lng !== null ? `${f.lat},${f.lng}` : f.name),
  );
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`
    + (f.placeId ? `&destination_place_id=${encodeURIComponent(f.placeId)}` : "")
    + "&travelmode=driving";
  const satelliteUrl = f.lat !== null && f.lng !== null
    ? `https://www.google.com/maps/@?api=1&map_action=map&center=${encodeURIComponent(`${f.lat},${f.lng}`)}&zoom=16&basemap=satellite`
    : "";

  return `<div class="map-facade" data-embed="${esc(embedUrl)}"${f.lat !== null && f.lng !== null ? ` data-lat="${esc(f.lat)}" data-lng="${esc(f.lng)}"` : ""} style="position:relative;border-radius:12px;overflow:hidden;background:#eef1f4;min-height:220px">
  <button type="button" class="map-facade-btn" aria-label="Load the interactive map for ${esc(f.name)}"
    style="position:absolute;inset:0;width:100%;height:100%;border:0;cursor:pointer;background:transparent;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px">
    <span style="font:700 15px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2933">📍 View ${esc(f.city || "the")} location on the map</span>
    <span style="font:400 12.5px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a6673">Tap to load Google Maps</span>
  </button>
  <noscript><a href="${esc(openUrl)}" rel="noopener">Open in Google Maps</a></noscript>
</div>
<div class="map-actions" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">
<a class="map-open" href="${esc(openUrl)}" target="_blank" rel="noopener"
   style="display:inline-block;color:${esc(accent)};font:600 13.5px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none">Open in Google Maps →</a>
<a class="map-directions" href="${esc(directionsUrl)}" target="_blank" rel="noopener"
   style="display:inline-block;color:${esc(accent)};font:600 13.5px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none">Directions from your location →</a>
${satelliteUrl ? `<a class="map-satellite" href="${esc(satelliteUrl)}" target="_blank" rel="noopener" style="display:inline-block;color:${esc(accent)};font:600 13.5px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none">Satellite view →</a>` : ""}
</div>
<script>(function(){var f=document.currentScript&&document.currentScript.previousElementSibling;var d=document.querySelectorAll(".map-facade");for(var i=0;i<d.length;i++){(function(el){var b=el.querySelector(".map-facade-btn");if(!b)return;b.addEventListener("click",function(){var f=document.createElement("iframe");f.src=el.getAttribute("data-embed");f.loading="lazy";f.referrerPolicy="no-referrer-when-downgrade";f.title="Map";f.style.cssText="width:100%;height:100%;position:absolute;inset:0;border:0";el.appendChild(f);b.remove();});})(d[i]);}})();</script>`;
}

/**
 * Google review CTA. Deep-link only. No pre-filled text, no star pre-selection,
 * no incentive, no gating. Missing Place ID renders NOTHING.
 */
function reviewCta(facts = {}, { accent = "#c05621", placement = "hero" } = {}) {
  const f = normaliseFacts(facts);
  if (!f.placeId) return "";                    // never guess, never link blind
  const href = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(f.placeId)}`;
  const trust = [];
  if (f.rating !== null) trust.push(`<span class="trust-rating" style="font-weight:800">${f.rating.toFixed(1)}★</span>`);
  if (f.reviewCount !== null) trust.push(`<span class="trust-count" style="color:#5a6673">${f.reviewCount} Google review${f.reviewCount === 1 ? "" : "s"}</span>`);

  return `<div class="review-cta review-cta--${esc(placement)}" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
  ${trust.length ? `<div class="trust-signals" style="font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;display:flex;gap:8px;align-items:center">${trust.join("")}</div>` : ""}
  <a class="review-cta-btn" href="${esc(href)}" target="_blank" rel="noopener"
     style="display:inline-block;background:${esc(accent)};color:#fff;font:700 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;padding:12px 18px;border-radius:8px;text-decoration:none">Leave us a Google review</a>
</div>`;
}

/** Everything, composed. Any part that lacks truth data contributes nothing. */
function localSeoBlock(facts = {}, opts = {}) {
  return [
    localBusinessJsonLd(facts),
    napBlock(facts, opts),
    lazyMap(facts, opts),
    reviewCta(facts, opts),
  ].filter(Boolean).join("\n");
}

module.exports = {
  normaliseFacts, localBusinessJsonLd, napBlock, lazyMap, reviewCta, localSeoBlock,
};
