"use strict";

// lib/mirror-engine/facts.js — the semantic validation boundary.
//
// Runs AFTER schema validation and BEFORE any mutable operation. Everything
// here is a caller-input defect surfaced as 422 invalid_facts with a named
// reason — because a caller typo is a customer-visible defect indistinguishable
// from donor residue once it ships (−117.4260 for longitude puts Spokane in
// China; "(509) 842-6611 x102" hydrates a wrong live number).

const { sanitizeEmail } = require("../forge");
const { composeIdentityCopy } = require("./identity-copy");
const { streetAddressOnly } = require("./postal");
const { eligibleMarketCity } = require("./place-names");
const { applyImageAltPolicy } = require("./image-alt");

// Characters rejected in every substituted fact value. `String.replace`-class
// hazards ($&), markup injection (< > "), template-literal escape (` \) — a
// value carrying one of these can turn a minified bundle into a SyntaxError
// that white-screens while passing every text check. We substitute with
// split/join (no $-expansion), but the ban stays: defense in depth, and these
// characters are never legitimate in a business fact.
const FORBIDDEN_VALUE_CHARS = /[<>"`\\$]/;

// Straight apostrophe -> typographic U+2019 at the boundary. "Mike's" inside a
// '…' JS string literal in a minified bundle is a parse error; U+2019 is the
// correct glyph typographically AND can never terminate a quoted literal.
function normalizeApostrophes(value) {
  return String(value).replace(/'/g, "’");
}

/**
 * PHONE_DIGITS policy (review resolution — Grok's "substitute anyway" is
 * least safe): strip to digits, reject extensions at the boundary, drop a
 * leading 1 on 11-digit, require EXACTLY 10. "(509) 842-6611 x102" must be a
 * 422, not a silent last-10 slice to 8426611102 — a wrong live number.
 *
 * A BLANK phone is still `ok:false` HERE — this function answers "can these
 * characters become 10 NANP digits", and "" cannot. Whether a blank is a build
 * failure is validateFacts's question, and since 2026-08-01 the answer is no:
 * outreach is email-only, so a prospect with no published number is qualified
 * and simply renders no phone. See `phone_blank` handling in validateFacts.
 */
function derivePhoneDigits(phoneRaw) {
  const raw = String(phoneRaw || "").trim();
  if (!raw) return { ok: false, reason: "phone_blank" };
  if (/(?:^|[\s.,;()-])(?:x|ext\.?|extension)\s*\d+/i.test(raw) || /[#,;]\s*\d+\s*$/.test(raw)) {
    return { ok: false, reason: "phone_has_extension" };
  }
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return { ok: false, reason: `phone_not_10_digits_(${digits.length})` };
  if (/^[01]/.test(digits)) return { ok: false, reason: "phone_invalid_nanp_area_code" };
  return { ok: true, digits };
}

// Approximate lat/lng bounding boxes per state (generous margins — the check
// exists to catch sign flips and transposed coordinates, not to survey).
// A fact that fails a GENEROUS box is not a rounding issue; it is wrong.
const STATE_BBOX = {
  AL: [30.1, 35.1, -88.6, -84.8], AK: [51.0, 71.5, -179.9, -129.9],
  AZ: [31.2, 37.1, -114.9, -108.9], AR: [32.9, 36.6, -94.7, -89.6],
  CA: [32.4, 42.1, -124.5, -114.0], CO: [36.9, 41.1, -109.1, -102.0],
  CT: [40.9, 42.1, -73.8, -71.7], DE: [38.4, 39.9, -75.8, -74.9],
  FL: [24.4, 31.1, -87.7, -79.9], GA: [30.3, 35.1, -85.7, -80.7],
  HI: [18.8, 22.3, -160.3, -154.7], ID: [41.9, 49.1, -117.3, -110.9],
  IL: [36.9, 42.6, -91.6, -87.0], IN: [37.7, 41.8, -88.2, -84.7],
  IA: [40.3, 43.6, -96.7, -90.1], KS: [36.9, 40.1, -102.1, -94.5],
  KY: [36.4, 39.2, -89.6, -81.9], LA: [28.9, 33.1, -94.1, -88.7],
  ME: [42.9, 47.5, -71.1, -66.8], MD: [37.8, 39.8, -79.5, -74.9],
  MA: [41.2, 42.9, -73.6, -69.9], MI: [41.6, 48.3, -90.5, -82.3],
  MN: [43.4, 49.4, -97.3, -89.4], MS: [30.1, 35.1, -91.7, -88.0],
  MO: [35.9, 40.7, -95.8, -89.0], MT: [44.3, 49.1, -116.1, -104.0],
  NE: [39.9, 43.1, -104.1, -95.2], NV: [35.0, 42.1, -120.1, -113.9],
  NH: [42.6, 45.4, -72.6, -70.6], NJ: [38.8, 41.4, -75.6, -73.8],
  NM: [31.2, 37.1, -109.1, -102.9], NY: [40.4, 45.1, -79.8, -71.8],
  NC: [33.7, 36.6, -84.4, -75.4], ND: [45.9, 49.1, -104.1, -96.5],
  OH: [38.3, 42.0, -84.9, -80.5], OK: [33.5, 37.1, -103.1, -94.4],
  OR: [41.9, 46.3, -124.6, -116.4], PA: [39.6, 42.3, -80.6, -74.6],
  RI: [41.1, 42.1, -71.9, -71.1], SC: [32.0, 35.3, -83.4, -78.5],
  SD: [42.4, 45.9, -104.1, -96.4], TN: [34.9, 36.7, -90.4, -81.6],
  TX: [25.8, 36.6, -106.7, -93.5], UT: [36.9, 42.1, -114.1, -109.0],
  VT: [42.7, 45.1, -73.5, -71.4], VA: [36.5, 39.5, -83.7, -75.2],
  WA: [45.5, 49.1, -124.9, -116.9], WV: [37.1, 40.7, -82.7, -77.7],
  WI: [42.4, 47.1, -92.9, -86.7], WY: [40.9, 45.1, -111.1, -104.0],
  DC: [38.7, 39.0, -77.2, -76.9],
};

function latLngInState({ latitude, longitude, state }) {
  const box = STATE_BBOX[String(state || "").toUpperCase()];
  if (!box) return { known: false, ok: true }; // unknown region code: schema already gated the shape
  const [latMin, latMax, lngMin, lngMax] = box;
  const ok = latitude >= latMin && latitude <= latMax && longitude >= lngMin && longitude <= lngMax;
  return { known: true, ok };
}

// PHONE LEFT THIS LIST ON 2026-08-01 (owner directive). Outreach is email-only
// — we never call the prospect — so requiring their number rejected qualified
// leads for a fact the campaign does not use, and phone was the second-hardest
// filter after email. It is still VALIDATED when supplied (see below): optional
// means "may be absent", never "may be wrong".
const REQUIRED_FACT_FIELDS = ["business_name", "industry", "city", "state"];

// ---------------------------------------------------------------------------
// SCRAPER-ARTIFACT EMAILS (fleet audit, 2026-09-02).
//
// The landscaping and plumbing mirrors published
//   "Email frame-A013717F96D5CBAEFCD26EB58FD1540F@mhtml.blink."
// as the client's contact email — LIVE, in the FAQPage JSON-LD Google reads.
// "frame-<HEX>@mhtml.blink" is not an address a human wrote: it is the RFC-822
// message-id of a frame inside a Chromium "Save as MHTML" archive, captured by
// a scraper that walked the saved file looking for email-shaped strings. It
// passes every SHAPE test an address has, so the defense is a DENYLIST of the
// artifact's two stable traits: the mhtml.blink pseudo-domain, and the
// "frame-<hex>" local part those message-ids always carry.
//
// Three doors, one rule — the fact boundary refuses the address, and the
// render composers (content-inject.js, which requires these same helpers from
// here) strip the token out of any prose it rode in on. A real client email
// never becomes a scraper fragment on any surface.
// ---------------------------------------------------------------------------
const SCRAPER_EMAIL_HOST_RE = /(?:^|\.)mhtml\.blink$/i;
const SCRAPER_EMAIL_LOCAL_RE = /^frame-[0-9a-f]{6,}$/i;
// The prose form: an optional "Email"/"email at:" lead-in, the artifact token,
// and the sentence punctuation that trailed it.
const SCRAPER_EMAIL_TEXT_RE = /\b(?:e-?mail(?:\s+(?:us|at|me))?\s*:?\s*)?[a-z0-9._%+-]*frame-[0-9a-f]{6,}@mhtml\.blink\b\.?/gi;

function isScraperArtifactEmail(value) {
  const v = String(value == null ? "" : value).trim();
  if (!v) return false;
  const at = v.lastIndexOf("@");
  if (at < 1) return false;
  const local = v.slice(0, at);
  const host = v.slice(at + 1).replace(/>$/, "");
  return SCRAPER_EMAIL_HOST_RE.test(host) || (SCRAPER_EMAIL_LOCAL_RE.test(local) && /mhtml\.blink/i.test(host));
}

/** Remove scraper-artifact email tokens from prose; collapse the leftover gaps. */
function stripScraperEmailArtifacts(text) {
  let out = String(text == null ? "" : text).replace(SCRAPER_EMAIL_TEXT_RE, "");
  // The strip can leave "Call ." or doubled spaces behind; tidy without
  // touching any real word.
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([.,;!?])/g, "$1").replace(/\.\s*\./g, ".").trim();
  return out;
}

// ---------------------------------------------------------------------------
// PROJECT PHOTOS (feature 4 — the before/after gallery's facts boundary).
//
// facts.project_photos is an OPTIONAL array of { before_url, after_url,
// caption? }. "Optional means may be absent, never may be wrong" applies with
// full force: a pane pointing at a login page, a data: blob or a typo'd host
// would ship a broken promise on the client's own home page — the same
// customer-visible defect class as a wrong live phone number. So URLs are
// checked for PLAUSIBILITY (https, an image extension or a known media
// host) right here, where every other caller-input defect becomes a named
// 422 instead of a broken pane.
//
// Plausibility, not existence: the engine cannot (and must not) fetch each
// URL at build time. The check refuses what cannot be an https image
// address; what remains is the client's own assertion about their own work.
// ---------------------------------------------------------------------------
const PROJECT_PHOTO_MAX_ITEMS = 12; // mirror-request.schema.json maxItems, kept in step

// Image extensions accepted in the URL PATH (query strings are ignored —
// "?v=2" and signed-token tails are normal on real CDN images).
const PROJECT_PHOTO_EXT_RE = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;

// Known media hosts: hostnames (or host suffixes, dotted) that serve images
// without an extension in the path. Extension-less CDN URLs with query-string
// content negotiation are real; the suffix list is deliberately conservative
// — a host that is not on it and carries no image extension is refused, and
// that refusal is the point.
const PROJECT_PHOTO_MEDIA_HOSTS = [
  "images.unsplash.com",
  "i.imgur.com",
  "imgur.com",
  "res.cloudinary.com",
  "storage.googleapis.com",
  "storage.cloud.google.com",
  "firebasestorage.googleapis.com",
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
  "cdn.shopify.com",
  "images.squarespace-cdn.com",
  "images.ctfassets.net",
  "assets.website-files.com",
  "uploads-ssl.webflow.com",
  "i.ibb.co",
];
const PROJECT_PHOTO_MEDIA_SUFFIXES = [
  ".supabase.co", // supabase storage: https://<project>.supabase.co/storage/v1/object/public/...
  ".amazonaws.com", // S3 and CloudFront distributions
  ".blob.core.windows.net", // Azure blob storage
  ".azureedge.net",
  ".cdn.digitaloceanspaces.com",
  ".r2.cloudflarestorage.com",
  ".b-cdn.net",
];

// Whitespace/control characters anywhere in a URL never survive ajv's "uri"
// format either; enforced here so direct validateFacts callers get the same
// named refusal instead of a silent pass.
const URI_FORBIDDEN_CHARS_IN_URL = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * A plausible https image URL — or a named refusal. Returns
 * { ok:true, url } with the trimmed value, or { ok:false, reason }.
 */
function plausibleProjectPhotoUrl(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return { ok: false, reason: "project_photo_url_blank" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "project_photo_url_unparseable", value: raw };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "project_photo_url_not_https", value: raw };
  if (URI_FORBIDDEN_CHARS_IN_URL.test(raw)) return { ok: false, reason: "project_photo_url_has_whitespace_or_control_chars", value: raw };
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || /^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) {
    return { ok: false, reason: "project_photo_url_host_not_public", value: raw };
  }
  const onKnownHost = PROJECT_PHOTO_MEDIA_HOSTS.includes(host)
    || PROJECT_PHOTO_MEDIA_SUFFIXES.some((s) => host.endsWith(s));
  if (onKnownHost || PROJECT_PHOTO_EXT_RE.test(url.pathname)) return { ok: true, url: raw };
  return { ok: false, reason: "project_photo_url_not_plausibly_an_image", value: raw };
}

/**
 * Validate + normalize facts.project_photos IN PLACE on the candidate facts
 * object. Junk shapes and implausible URLs push named entries onto `detail`
 * (invalid_facts); an empty or whitespace-only array is deleted so the field
 * reads as the honest absence it is. Self-contained: touches nothing else in
 * facts.
 */
function validateProjectPhotos(facts, detail) {
  if (facts.project_photos == null) return;
  const raw = facts.project_photos;
  if (!Array.isArray(raw)) {
    detail.push({ path: "/facts/project_photos", reason: "project_photos_not_an_array" });
    delete facts.project_photos;
    return;
  }
  const clean = [];
  raw.forEach((item, i) => {
    const path = `/facts/project_photos/${i}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      detail.push({ path, reason: "project_photo_not_an_object" });
      return;
    }
    const before = plausibleProjectPhotoUrl(item.before_url);
    if (!before.ok) {
      detail.push({ path: `${path}/before_url`, reason: before.reason, ...(before.value ? { value: before.value } : {}) });
    }
    const after = plausibleProjectPhotoUrl(item.after_url);
    if (!after.ok) {
      detail.push({ path: `${path}/after_url`, reason: after.reason, ...(after.value ? { value: after.value } : {}) });
    }
    let caption = "";
    if (item.caption != null && String(item.caption).trim() !== "") {
      if (typeof item.caption !== "string") {
        detail.push({ path: `${path}/caption`, reason: "project_photo_caption_not_a_string" });
      } else {
        const { normalizeFactsText } = require("./facts-unicode");
        caption = normalizeApostrophes(normalizeFactsText(item.caption.trim()));
        if (FORBIDDEN_VALUE_CHARS.test(caption)) {
          detail.push({ path: `${path}/caption`, reason: "forbidden_characters", value: caption });
          caption = "";
        }
      }
    }
    if (before.ok && after.ok) {
      clean.push({ before_url: before.url, after_url: after.url, ...(caption ? { caption } : {}) });
    }
  });
  if (clean.length) facts.project_photos = clean;
  else delete facts.project_photos;
}

/**
 * Validate + normalize a schema-valid MirrorRequest's facts.
 * Returns { ok:true, facts, phoneDigits, imageAlts, altsByUrl } with a NEW
 * normalized facts object, or { ok:false, error, detail[] } where error is
 * the contract error code. Never replaces the caller's facts object (request
 * is normalized in place on hero and image alt metadata, the same way the
 * hero block has always been); never infers a fact value.
 */
function validateFacts(request) {
  const detail = [];
  const src = request.facts || {};
  const facts = { ...src };

  // Trim required strings; blank-after-trim is missing_required_facts.
  for (const f of REQUIRED_FACT_FIELDS) {
    const v = String(facts[f] ?? "").trim();
    if (!v) detail.push({ path: `/facts/${f}`, reason: "blank_after_trim" });
    facts[f] = v;
  }
  if (detail.length) return { ok: false, error: "missing_required_facts", detail };

  // Trim optional strings in place (absent stays absent — never invented).
  for (const [k, v] of Object.entries(facts)) {
    if (typeof v === "string") facts[k] = v.trim();
  }

  // Forbidden characters in every string fact the hydrator will substitute.
  // Typographic punctuation is NORMALIZED FIRST, not rejected: a real client
  // tagline ("No job too big or small, we do them all!") died here once on a
  // curly quote — the exact customer this factory exists for. Truth controls
  // (<>"`\$) still refuse after normalization.
  const { normalizeFactsText } = require("./facts-unicode");
  for (const [k, v] of Object.entries(facts)) {
    if (typeof v === "string") {
      facts[k] = normalizeFactsText(v);
      if (FORBIDDEN_VALUE_CHARS.test(facts[k])) {
        detail.push({ path: `/facts/${k}`, reason: "forbidden_characters", value: facts[k] });
      }
    }
  }
  const hero = request.hero || {};
  for (const [k, v] of Object.entries(hero)) {
    if (typeof v === "string") {
      hero[k] = normalizeFactsText(v);
      if (FORBIDDEN_VALUE_CHARS.test(hero[k])) {
        detail.push({ path: `/hero/${k}`, reason: "forbidden_characters", value: hero[k] });
      }
    }
  }
  if (detail.length) return { ok: false, error: "invalid_facts", detail };

  // Phone policy — extension-safe, exactly 10, but only when there IS one.
  // TRUTH LAW cuts both ways here: an absent number renders no number (the
  // donors collapse every call CTA), and a PRESENT number that cannot reduce
  // to 10 clean NANP digits is still a 422 — never rounded off, never sliced.
  const phoneRaw = String(facts.phone ?? "").trim();
  facts.phone = phoneRaw;
  let phoneDigits = "";
  if (phoneRaw) {
    const phone = derivePhoneDigits(phoneRaw);
    if (!phone.ok) {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/phone", reason: phone.reason }] };
    }
    phoneDigits = phone.digits;
  }

  // lat/lng travel together (schema dependentRequired backstop) + state bbox.
  const hasLat = facts.latitude != null;
  const hasLng = facts.longitude != null;
  if (hasLat !== hasLng) {
    return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/latitude", reason: "latitude_and_longitude_required_together" }] };
  }
  if (hasLat) {
    const geo = latLngInState(facts);
    if (!geo.ok) {
      return {
        ok: false, error: "invalid_facts",
        detail: [{ path: "/facts/latitude", reason: `coordinates_outside_state_${facts.state}`, value: `${facts.latitude},${facts.longitude}` }],
      };
    }
  }

  // Email: sanitize (the %20roofingformulanw@outlook.com class); a supplied
  // address that sanitizes to nothing is a caller defect, not a silent blank.
  // EXCEPT the scraper-artifact class (frame-…@mhtml.blink): that is not a
  // caller defect but a harvesting byproduct, so the field is stripped to its
  // honest absence and the build proceeds — a build that 422s on a saved-page
  // message-id would be held hostage by a scraper's sloppiness.
  if (facts.email) {
    if (isScraperArtifactEmail(facts.email)) {
      delete facts.email;
    } else {
      const clean = sanitizeEmail(facts.email);
      if (!clean) {
        return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/email", reason: "email_unusable_after_sanitize", value: facts.email }] };
      }
      facts.email = clean;
    }
  }

  // PROJECT PHOTOS (feature 4): optional before/after pairs for the project
  // gallery. Validated at this boundary — https image plausibility, complete
  // pairs, caption hygiene — so the gallery renders only what a caller could
  // honestly supply, and junk becomes a named 422 instead of a broken pane.
  // THE PHONE POSTURE, not a silent slice: a supplied-but-refused entry fails
  // the request the same way a bad phone number does — the caller fixes the
  // data, the engine never ships a gallery it had to guess at.
  validateProjectPhotos(facts, detail);
  if (detail.length) return { ok: false, error: "invalid_facts", detail };

  // THE STREET LINE IS THE STREET — the one boundary every build crosses.
  //
  // wss-test-meyer-heating-and-air-st-louis published
  // "11134 Lindbergh Business Ct Ste D, St. Louis, MO 63123, USA" as its
  // schema.org streetAddress, beside its own addressLocality "St. Louis",
  // addressRegion "MO" and postalCode "63123" — every component twice, plus a
  // country tail nobody writes on their own website. That value never passed
  // through verified-facts.displayAddress because the resolver had no address
  // and lib/mirror-lane-build.js fell through to the mined contract's raw
  // Google formattedAddress. A second fix inside the resolver would not have
  // reached it, so the rule lives here instead: whatever assembled these facts,
  // this runs. See lib/mirror-engine/postal.js — removal only, and only of
  // components this same facts object is already publishing in their own fields.
  if (typeof facts.address === "string" && facts.address) {
    facts.address = streetAddressOnly(facts.address, {
      city: facts.city,
      state: facts.state,
      postal: facts.postal_code,
    });
  }

  // A SERVICE STRING IS NOT A TOWN — asked here for the same reason.
  //
  // marketCity() below prefers service_area over the NAP city on every
  // marketing surface, so a bad value there IS the headline the owner reads.
  // Three live rows carry one frozen on the prospect record: "Plumbing Repairs
  // Tulsa", "Fence Company Westfield", "Galli Plumbing Services service area".
  // verified-facts.js salvages these at CAPTURE, and a stored value never
  // passes that resolver again — Cooper Perry's rebuilt page still published
  // "Plumbing in Plumbing Repairs Tulsa" as its title. Removal only: the town
  // inside the phrase survives ("Plumbers Spokane" -> Spokane, which is the
  // Flint Plumbing case working properly), and a phrase with no town in it
  // makes no assertion at all, so the field is DELETED and marketCity falls
  // back to the verified NAP city.
  if (typeof facts.service_area === "string" && facts.service_area) {
    const market = eligibleMarketCity({
      assertedCity: facts.service_area,
      napCity: facts.city,
      napState: facts.state,
      businessName: facts.business_name,
      retainEquivalentAssertion: true,
    });
    if (market.eligible) facts.service_area = market.service_area;
    else delete facts.service_area;
  }

  // THE PUBLIC DISPLAY NAME IS THE BUSINESS NAME — nothing welded to it.
  //
  // Two live leaks (2026-09-02 fleet audit) shipped upstream-composed display
  // names on every surface at once — title, h1, meta, JSON-LD, the content
  // island:
  //   · "Brilliant Borders | Landscaping Services in Des Moines Built to
  //     Last" — a slug-derived pipe tail rode along in business_name, so the
  //     marketing fragment appeared wherever the bare name was expected;
  //   · "True Fence Florida (North Port (primary))" — an internal multi-
  //     location label reached the public name.
  // Cleaned here, at the facts boundary, so every downstream consumer (token
  // values, schema, meta, island, authority pages) reads the same clean name —
  // fixing it only in buildTokenValues would leave the schema and the island
  // polluted. Removal only, and only of these two label shapes: a pipe tail
  // and trailing parentheticals that carry an internal-location marker. Client
  // isolation still agrees ("True Fence Florida" is a subset of the stamped
  // longer name), and slug coherence is unaffected.
  if (typeof facts.business_name === "string" && facts.business_name) {
    facts.business_name = cleanBusinessDisplayName(facts.business_name);
  }

  // OPTIONAL TRUST + FINANCING FIELDS (features: trust badges, financing).
  // "Optional means may be absent, never wrong" — the same rule phone has
  // lived under since 2026-08-01. Absent stays absent; a present value with
  // the wrong shape is a 422, never a silent coercion, because every one of
  // these prints on a customer-facing trust surface.
  if (facts.license_number != null) {
    if (typeof facts.license_number !== "string") {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/license_number", reason: "license_number_not_string" }] };
    }
    facts.license_number = normalizeFactsText(facts.license_number.trim());
    if (FORBIDDEN_VALUE_CHARS.test(facts.license_number)) {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/license_number", reason: "forbidden_characters", value: facts.license_number }] };
    }
    if (!facts.license_number) delete facts.license_number;
  }
  if (facts.insured != null) {
    if (typeof facts.insured !== "boolean") {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/insured", reason: "insured_not_boolean" }] };
    }
    // `false` is the default the renderer already applies — store the honest
    // absence instead of a row of no-ops.
    if (facts.insured === false) delete facts.insured;
  }
  if (facts.associations != null) {
    if (!Array.isArray(facts.associations)) {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/associations", reason: "associations_not_array" }] };
    }
    if (facts.associations.length > 12) {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/associations", reason: "associations_too_many", value: facts.associations.length }] };
    }
    const associations = [];
    for (let i = 0; i < facts.associations.length; i += 1) {
      const entry = facts.associations[i];
      if (typeof entry !== "string") {
        return { ok: false, error: "invalid_facts", detail: [{ path: `/facts/associations/${i}`, reason: "association_not_string" }] };
      }
      const name = normalizeFactsText(entry.trim());
      if (!name) continue; // a blank row is an honest nothing, not a defect
      if (FORBIDDEN_VALUE_CHARS.test(name)) {
        return { ok: false, error: "invalid_facts", detail: [{ path: `/facts/associations/${i}`, reason: "forbidden_characters", value: name }] };
      }
      associations.push(name);
    }
    if (associations.length) facts.associations = associations;
    else delete facts.associations;
  }
  if (facts.financing != null) {
    if (typeof facts.financing !== "object" || Array.isArray(facts.financing)) {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/financing", reason: "financing_not_object" }] };
    }
    const financing = { ...facts.financing };
    const KNOWN_FINANCING_KEYS = ["enabled", "partner", "apply_url", "payment_methods"];
    for (const key of Object.keys(financing)) {
      if (!KNOWN_FINANCING_KEYS.includes(key)) {
        return { ok: false, error: "invalid_facts", detail: [{ path: `/facts/financing/${key}`, reason: "financing_unknown_field" }] };
      }
    }
    if (financing.enabled != null && typeof financing.enabled !== "boolean") {
      return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/financing/enabled", reason: "financing_enabled_not_boolean" }] };
    }
    if (financing.partner != null) {
      if (typeof financing.partner !== "string") {
        return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/financing/partner", reason: "financing_partner_not_string" }] };
      }
      financing.partner = normalizeFactsText(financing.partner.trim());
      if (FORBIDDEN_VALUE_CHARS.test(financing.partner)) {
        return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/financing/partner", reason: "forbidden_characters", value: financing.partner }] };
      }
      if (!financing.partner) delete financing.partner;
    }
    if (financing.apply_url != null) {
      if (typeof financing.apply_url !== "string" || !/^https:\/\/\S+$/i.test(financing.apply_url.trim())) {
        return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/financing/apply_url", reason: "financing_apply_url_not_https" }] };
      }
      financing.apply_url = financing.apply_url.trim();
    }
    if (financing.payment_methods != null) {
      if (!Array.isArray(financing.payment_methods)) {
        return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/financing/payment_methods", reason: "payment_methods_not_array" }] };
      }
      if (financing.payment_methods.length > 8) {
        return { ok: false, error: "invalid_facts", detail: [{ path: "/facts/financing/payment_methods", reason: "payment_methods_too_many", value: financing.payment_methods.length }] };
      }
      const methods = [];
      for (let i = 0; i < financing.payment_methods.length; i += 1) {
        const entry = financing.payment_methods[i];
        if (typeof entry !== "string") {
          return { ok: false, error: "invalid_facts", detail: [{ path: `/facts/financing/payment_methods/${i}`, reason: "payment_method_not_string" }] };
        }
        const method = normalizeFactsText(entry.trim());
        if (!method) continue;
        if (FORBIDDEN_VALUE_CHARS.test(method)) {
          return { ok: false, error: "invalid_facts", detail: [{ path: `/facts/financing/payment_methods/${i}`, reason: "forbidden_characters", value: method }] };
        }
        methods.push(method);
      }
      if (methods.length) financing.payment_methods = methods;
      else delete financing.payment_methods;
    }
    if (Object.keys(financing).length) facts.financing = financing;
    else delete facts.financing;
  }

  // Apostrophe boundary normalization on every human-visible string fact.
  for (const k of ["business_name", "city", "service_area", "address", "county", "owner_name", "license", "license_number"]) {
    if (typeof facts[k] === "string") facts[k] = normalizeApostrophes(facts[k]);
  }

  // ALT TEXT IS REQUIRED AT INTAKE (accessibility layer, 2026-09-02).
  //
  // Every image the request carries leaves this boundary WITH alt text — a
  // usable supplied alt wins, a missing one gets the composed sentence from
  // the business name + its context ("Absolute Roofing — roof replacement in
  // Naples, FL", see lib/mirror-engine/image-alt.js), and a decorative image
  // keeps alt="" because that IS the correct alt text. A SUPPLIED alt that is
  // unusable (truth-control characters) is a 422 here exactly like any other
  // fact: optional means may be absent, never may be wrong. A caller that
  // sends brand.alt_policy.mode "strict" is on notice and a MISSING alt is a
  // 422 too. The composed alts travel out on imageAlts (per-image records and
  // a url -> alt map) so the post-build polish pass and any other consumer
  // read the SAME sentence this boundary approved.
  const altMode = request.brand && request.brand.alt_policy && request.brand.alt_policy.mode === "strict"
    ? "strict"
    : "auto";
  const altPolicy = applyImageAltPolicy(request, facts, { mode: altMode });
  if (!altPolicy.ok) {
    return { ok: false, error: "invalid_facts", detail: altPolicy.violations };
  }

  return { ok: true, facts, phoneDigits, imageAlts: altPolicy.images, altsByUrl: altPolicy.altsByUrl };
}

/**
 * The display name a stranger should read: the bare business name.
 *
 * Strips exactly two upstream-composed label shapes, both measured live:
 *   1. PIPE MARKETING TAILS — "Brilliant Borders | Landscaping Services in
 *      Des Moines Built to Last" -> "Brilliant Borders". Everything from the
 *      first "|" onward is a composed fragment, never part of a legal name.
 *   2. INTERNAL LOCATION LABELS — "True Fence Florida (North Port
 *      (primary))" -> "True Fence Florida". Trailing balanced parentheticals
 *      that carry an internal marker (primary/hq/headquarters/branch/
 *      location/office) are routing metadata, not branding. A parenthetical
 *      without such a marker ("Acme (Texas)") is left alone.
 * A pipe at position zero (or no pipe, no label) returns the trimmed input.
 */
function cleanBusinessDisplayName(value) {
  let name = String(value || "").trim();
  if (!name) return "";
  const pipe = name.indexOf("|");
  if (pipe > 0) name = name.slice(0, pipe);
  name = name.trim();
  // Strip trailing balanced "(...)" groups that carry an internal marker.
  // The paren scan walks BACKWARD from the final character counting depth, so
  // the nested "(North Port (primary))" shape finds its OUTERMOST open paren
  // and the whole label goes in one strip.
  for (let guard = 0; guard < 6; guard += 1) {
    const current = name.trim();
    if (!current.endsWith(")")) break;
    let depth = 0;
    let open = -1;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const ch = current[i];
      if (ch === ")") depth += 1;
      else if (ch === "(") {
        depth -= 1;
        if (depth === 0) { open = i; break; }
      }
    }
    if (open === -1) break;
    const inner = current.slice(open + 1, current.length - 1).trim();
    if (!/(?:^|[^a-z])(?:primary|hq|headquarters|branch|location|office)(?:[^a-z]|$)/i.test(inner)) break;
    name = current.slice(0, open);
  }
  return name.replace(/[\u2013\u2014-]\s*$/, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * THE MARKETING CITY — the one place the market/address split is decided.
 *
 * `facts.city` is the NAP locality: where the business is registered, what a
 * mailing label says, what schema.org PostalAddress.addressLocality must carry.
 * `facts.service_area` is the market the business's OWN first-party site
 * asserts it sells into (verified-facts.js serviceAreaAssertion — the business
 * speaking about itself, which is legitimate for a service area and never for a
 * review). Every marketing surface — <title>, og:title, the hero headline,
 * "Serving …" — is about the MARKET.
 *
 * Flint Plumbing is the incident: NAP locality Buda, TX; their own site is
 * titled "Austin Plumbers" and reads "Austin, Texas Plumber". We shipped
 * "Flint Plumbing LLC | Plumbing in Buda, TX" and shrank a 40-year Austin
 * plumber to a suburb.
 *
 * Absent assertion => NAP city. Never invented.
 */
function marketCity(facts = {}) {
  return eligibleMarketCity({
    assertedCity: facts.service_area,
    napCity: facts.city,
    napState: facts.state,
    businessName: facts.business_name,
  }).city;
}

/** The NAP locality. Explicit, so an address site can never reach for CITY. */
function addressCity(facts = {}) {
  return String(facts.city || "").trim();
}

/**
 * The hero headline for this business.
 *
 * This used to be "{Trade} in {City}." and nothing else, which is how fifteen
 * plumbers in shared cities shipped a byte-identical h1 — and how every HVAC
 * mirror fell back to the donor's own hardcoded sentence, because a headline
 * with no client atom in it gave the donor nothing to prefer. Composition now
 * lives in lib/mirror-engine/identity-copy.js, where it names the business (or
 * their proven motto) first and the trade and verified NAP city second.
 *
 * The hero city is the prospect's own locality. A metro/service-area assertion
 * remains valid for service-area copy, but never replaces the hero locale.
 */
function defaultHeroHeadline(facts, options = {}) {
  return composeIdentityCopy({ facts, marketCity: addressCity(facts), ...options }).headline;
}

/** The full identity copy block (lines, title, description) for these facts. */
function identityCopyFor(facts, options = {}) {
  return composeIdentityCopy({ facts, marketCity: addressCity(facts), ...options });
}

module.exports = {
  FORBIDDEN_VALUE_CHARS,
  normalizeApostrophes,
  cleanBusinessDisplayName,
  derivePhoneDigits,
  latLngInState,
  validateFacts,
  defaultHeroHeadline,
  identityCopyFor,
  marketCity,
  addressCity,
  isScraperArtifactEmail,
  stripScraperEmailArtifacts,
  STATE_BBOX,
  PROJECT_PHOTO_MAX_ITEMS,
  plausibleProjectPhotoUrl,
  validateProjectPhotos,
};
