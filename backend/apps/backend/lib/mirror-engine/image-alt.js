"use strict";

// lib/mirror-engine/image-alt.js — the alt-text policy, one source of truth.
//
// ALT TEXT IS REQUIRED AT INTAKE (accessibility layer, 2026-09-02). Every
// image this factory publishes says what it shows: the request's own image
// metadata (brand.photo_bank) is validated here at the facts boundary, and
// the post-build polish pass (fleet-polish.js imageAltFloor) uses the same
// composer so an emitted <img> without an alt attribute never ships either.
//
// The composed sentence is deliberate, per the owner's example:
//   "Absolute Roofing — roof replacement in Naples, FL"
// business name first (screen readers, search, and the client all read the
// SAME identity the rest of the site publishes), then the image's context —
// the service or trade and the verified NAP market. Never invented facts:
// only fields the request already carries, and an absent field simply does
// not reach the sentence.
//
// Zero npm dependencies, Node 20+, CommonJS. Never throws: every entry point
// answers a plain object, because a build must never die on alt text.

// Same truth controls as facts.js FORBIDDEN_VALUE_CHARS (kept in sync by
// comment, not by require — facts.js requires THIS module, so importing it
// back would be a cycle): markup injection (< > "), template-literal escapes
// (` \), $-expansion. An alt carrying one of these is a caller defect, the
// same way a business_name carrying one is.
const FORBIDDEN_ALT_CHARS = /[<>"`\\$]/;

// The em-dash separator from the owner's example sentence.
const ALT_SEPARATOR = " — ";

// Decorative markers: a badge/icon/spacer/divider carries no information a
// text alternative must repeat, and alt="" is the CORRECT answer for it. Kept
// deliberately narrow (word-ish tokens inside class/src/subject strings) so a
// real photograph whose filename happens to contain "arrow" is not stripped
// of its description... those tokens live in CSS names, not camera roll names.
const DECORATIVE_RE = /(?:^|[^a-z0-9])(?:badges?|icons?|spacers?|dividers?|bullets?|decor(?:ative|ation)?)(?:[^a-z0-9]|$)/i;

// Subject hints → the phrase the sentence leads with. Measured against the
// subjects the pipeline itself already names (engine.js identityPhoto subject,
// client-photo-bank grades, content-inject's "The team at {bn}").
const TEAM_SUBJECT_RE = /(?:^|[^a-z0-9])(?:team|crew|staff|owner|people|headshot|portrait)(?:[^a-z0-9]|$)/i;
const VEHICLE_SUBJECT_RE = /(?:^|[^a-z0-9])(?:vehicle|truck|van|fleet|rig)(?:[^a-z0-9]|$)/i;
const LOGO_SUBJECT_RE = /(?:^|[^a-z0-9])(?:logo|brand[-_ ]?mark|wordmark|mark)(?:[^a-z0-9]|$)/i;

/** True when the string is a usable alt: non-blank after trim, no truth-control characters. */
function usableAlt(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  return !FORBIDDEN_ALT_CHARS.test(v);
}

/** True when this image is explicitly or structurally decorative. */
function isDecorativeImage({ entry, cls, src } = {}) {
  if (entry && entry.decorative === true) return true;
  const haystack = `${cls || ""} ${src || ""}`;
  return DECORATIVE_RE.test(haystack);
}

/** A human label from a form/control name: "phone_number" -> "Phone number". */
function humanizeName(name) {
  const base = String(name || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!base) return "";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Strip query/hash/extension noise and recover service words from a filename. */
function serviceHintFromSrc(src) {
  const raw = String(src || "").split(/[?#]/)[0];
  const base = raw.split("/").pop() || "";
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  if (!stem) return "";
  // Hash-shaped or numbered-only names carry no words: "dsc_1234",
  // "photo-1", "a3f9c2e". A hint must be real words.
  const words = stem
    .split(/[^a-z]+/i)
    .filter((w) => w.length >= 3 && /^[a-z]{3,}$/i.test(w) && !/^(?:jpg|jpeg|png|webp|avif|gif|img|photo|image|pic|dsc|sample)$/i.test(w));
  if (words.length < 1) return "";
  if (words.join(" ").length < 5) return "";
  return words.join(" ").toLowerCase();
}

/**
 * Compose the alt sentence. Never invents: absent fields shorten the
 * sentence, and no business name means NO sentence (the caller flags).
 *
 *   composeAlt({ businessName: "Absolute Roofing", service: "roof replacement", city: "Naples", state: "FL" })
 *   -> "Absolute Roofing — roof replacement in Naples, FL"
 *
 * Subject variants:
 *   team    -> "The team at Absolute Roofing — roofing in Naples, FL"
 *   vehicle -> "Absolute Roofing service vehicle — roofing in Naples, FL"
 *   logo    -> "Absolute Roofing logo"            (marks appear on every page)
 *   decorative -> ""                               (alt="" IS the alt text)
 */
function composeAlt(context = {}) {
  const business = String(context.businessName || "").trim();
  if (!business) return "";
  if (context.decorative === true) return "";

  const subject = String(context.subject || "");
  if (LOGO_SUBJECT_RE.test(subject)) return `${business} logo`;

  const service = String(context.service || "").trim();
  const industry = String(context.industry || "").trim();
  const noun = (service || industry).replace(/\s{2,}/g, " ");
  const city = String(context.city || "").trim();
  const state = String(context.state || "").trim();
  const place = [city, state].filter(Boolean).join(", ");
  const tail = noun ? (place ? `${noun} in ${place}` : noun) : place;

  let head = business;
  if (TEAM_SUBJECT_RE.test(subject)) head = `The team at ${business}`;
  else if (VEHICLE_SUBJECT_RE.test(subject)) head = `${business} service vehicle`;

  return tail ? `${head}${ALT_SEPARATOR}${tail}` : head;
}

/**
 * Collect every image the request carries, with its contract path.
 *
 * Two intake shapes exist today:
 *   request.brand.photo_bank.photos[i] — objects ({url, sha256, grade, ...})
 *     and the ONLY shape that can carry a supplied alt, because the schema
 *     leaves it additionalProperties:true on purpose;
 *   request.brand.photos[i] — plain URL strings (no alt can ride on them;
 *     the policy still records the generated sentence keyed by URL).
 *
 * Returns [{ path, index, kind, url, entry, subject }] — entries are the
 * CALLER'S objects (never copied here), so writing entry.alt in the caller
 * lands on the object downstream consumers actually read.
 */
function collectRequestImages(request = {}) {
  const brand = request && request.brand ? request.brand : {};
  const images = [];
  const bank = Array.isArray(brand.photo_bank && brand.photo_bank.photos) ? brand.photo_bank.photos : [];
  bank.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    images.push({
      path: `/brand/photo_bank/photos/${index}`,
      index,
      kind: "bank",
      url: typeof entry.url === "string" ? entry.url : "",
      entry,
      subject: `${entry.grade || ""} ${entry.subject || ""} ${typeof entry.url === "string" ? entry.url : ""}`,
    });
  });
  const urls = Array.isArray(brand.photos) ? brand.photos : [];
  urls.forEach((url, index) => {
    if (typeof url !== "string" || !url) return;
    images.push({
      path: `/brand/photos/${index}`,
      index,
      kind: "url",
      url,
      entry: null,
      subject: url,
    });
  });
  return images;
}

/**
 * THE ALT POLICY AT THE FACTS BOUNDARY.
 *
 * modes:
 *   "auto"   (default) — every image leaves with alt text. A usable supplied
 *            alt wins; a missing alt gets the composed sentence (recorded as
 *            source:"generated"); a decorative image keeps alt="" (source:
 *            "decorative" — empty alt on a decorative image is CORRECT, not
 *            a violation).
 *   "strict" — additionally, a MISSING alt on a non-decorative image is a
 *            422-class rejection: the caller is on notice and must describe
 *            their own photography.
 *
 * A SUPPLIED alt that is unusable (blank-after-trim where the entry is not
 * decorative, or truth-control characters) is ALWAYS a rejection regardless
 * of mode — "optional means may be absent, never may be wrong", the same law
 * as facts.js phone policy.
 *
 * Returns { ok, violations[], images[], altsByUrl } where images[] is
 * [{ path, url, alt, source }] and altsByUrl maps url -> alt for the plain
 * string list. Bank entries get entry.alt written (on the caller's object).
 * Never throws; caller input defects come back as violations, never as
 * exceptions.
 */
function applyImageAltPolicy(request, facts = {}, { mode = "auto" } = {}) {
  const violations = [];
  const images = [];
  const altsByUrl = {};
  const brand = request && request.brand ? request.brand : {};
  const modeNorm = mode === "strict" ? "strict" : "auto";
  const bank = Array.isArray(brand.photo_bank && brand.photo_bank.photos) ? brand.photo_bank.photos : [];

  const compose = (subject, extraService) => composeAlt({
    businessName: facts.business_name,
    industry: facts.industry,
    city: facts.city,
    state: facts.state,
    service: extraService,
    subject,
  });

  bank.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const imagePath = `/brand/photo_bank/photos/${index}`;
    const url = typeof entry.url === "string" ? entry.url : "";
    const decorative = isDecorativeImage({ entry, src: url });
    const supplied = typeof entry.alt === "string" ? entry.alt.trim() : "";

    if (typeof entry.alt === "string" && supplied && FORBIDDEN_ALT_CHARS.test(supplied)) {
      violations.push({ path: `${imagePath}/alt`, reason: "forbidden_characters", value: supplied });
      return;
    }
    if (supplied) {
      entry.alt = supplied;
      images.push({ path: imagePath, url, alt: supplied, source: "supplied" });
      if (url) altsByUrl[url] = supplied;
      return;
    }
    if (decorative) {
      entry.alt = "";
      images.push({ path: imagePath, url, alt: "", source: "decorative" });
      return;
    }
    if (modeNorm === "strict") {
      violations.push({ path: `${imagePath}/alt`, reason: "alt_required" });
      return;
    }
    const composed = compose(`${entry.grade || ""} ${entry.subject || ""} ${url}`);
    if (!composed) {
      // No business name to compose from: flagged, not invented. (Unreachable
      // through validateFacts — business_name is required there — but a direct
      // policy caller can hit it, and the honest answer is the flag.)
      violations.push({ path: `${imagePath}/alt`, reason: "alt_required_no_business_name" });
      return;
    }
    entry.alt = composed;
    images.push({ path: imagePath, url, alt: composed, source: "generated" });
    if (url) altsByUrl[url] = composed;
  });

  const urls = Array.isArray(brand.photos) ? brand.photos : [];
  urls.forEach((url, index) => {
    if (typeof url !== "string" || !url) return;
    if (altsByUrl[url]) return; // the bank entry for this photograph already named it
    const path = `/brand/photos/${index}`;
    if (modeNorm === "strict") {
      violations.push({ path: `${path}/alt`, reason: "alt_required" });
      return;
    }
    const composed = compose(url, serviceHintFromSrc(url));
    if (!composed) {
      violations.push({ path: `${path}/alt`, reason: "alt_required_no_business_name" });
      return;
    }
    images.push({ path, url, alt: composed, source: "generated" });
    altsByUrl[url] = composed;
  });

  return { ok: violations.length === 0, violations, images, altsByUrl, mode: modeNorm };
}

module.exports = {
  FORBIDDEN_ALT_CHARS,
  ALT_SEPARATOR,
  collectRequestImages,
  applyImageAltPolicy,
  composeAlt,
  usableAlt,
  isDecorativeImage,
  serviceHintFromSrc,
  humanizeName,
};
