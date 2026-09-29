"use strict";

// lib/mirror-engine/verified-facts.js — THE CROSS-CHECK.
//
// WHY THIS EXISTS
// The Intake Genie returned facts.phone "16872518405" for Jacksonville Roofing
// USA and stamped it source_type "operator_verified", confidence 0.9. That
// string is the leading digits of the Facebook page id sitting in the same
// packet. The real number is (904) 516-4279. Nothing in the pipeline caught it,
// because the only thing asserting the number was correct was the same process
// that produced it.
//
// THE RULE THIS MODULE ENCODES
//   A source that attests to its own truthfulness is not evidence.
//   Evidence is an OBSERVATION, and an observation is only worth something when
//   the observer is not the thing being observed — or when a second, separate
//   observer saw the same thing.
//
// So every field this module returns carries:
//   · WHO observed it            (observer — the entity that actually saw it)
//   · HOW we got the observation (transport — the API/scrape we read it through)
//   · WHAT ELSE agreed           (corroboration level)
// and a field that two sources disagree about is NOT resolved by preference.
// It is returned as a CONFLICT and is ABSENT from `facts`. Absent is a smaller
// mirror. Wrong is a mirror that sends the client's customers to a stranger.
//
// ---------------------------------------------------------------------------
// OBSERVER vs TRANSPORT — the distinction that keeps this honest
//
// Reading Google Places through two different HTTP paths is NOT two independent
// observations. It is one observation (Google's) fetched twice. It still has
// real value: it is exactly the check that would have caught the Genie, because
// the Genie's number came from the Genie's own parser and no Google surface
// anywhere carries it. But it must not be REPORTED as independent corroboration,
// so agreement between two transports of the same observer is labelled
// `transport_corroborated`, never `independent_corroborated`.
//
// Independence is a property of the OBSERVER:
//   google_gbp      — Google's own record of the business. Google verifies
//                     listings (postcard/phone/video) and Google, not the
//                     business, owns the review corpus. Independent of the
//                     subject for NAP and the ONLY acceptable observer for
//                     review data.
//   business_self   — the prospect's own website. The subject. Authoritative
//                     about WHAT IT SELLS (nobody else knows the service list
//                     better) and about its own FAQ. NOT acceptable alone for
//                     NAP — not because businesses lie about their phone
//                     number, but because the EXTRACTOR can misread a page,
//                     which is precisely how the Genie produced a Facebook id
//                     and called it a phone.
//   operator        — a human at WSS who checked it. Independent, and the only
//                     source that can override a conflict, deliberately, by
//                     hand.
//   intake_genie    — BANNED. Not ranked, not weighted, not trusted-last.
//                     Rejected at ingest so it can never appear as the second
//                     source that makes something look corroborated.
// ---------------------------------------------------------------------------

const { fetchTrust } = require("./trust-brightdata");
const { decodeEntitiesOnce, decodeEntitiesDeep } = require("./html-entities");
const { carriesTemplateToken } = require("./tokens");
const { dropCountry } = require("./postal");
const { articleHeadlineReason } = require("./service-names");
const { harvestPageServices, mergeServiceSources } = require("./service-harvest");
// ONE definition of a reviewer's face, for the miner, the trust lookup and this
// resolver alike — see lib/verified-trust-lookup.js. A second copy here is how
// three shapers of the same corpus end up disagreeing about whether a photo is
// a photo.
const { isGoogleReviewerFace } = require("../verified-trust-lookup");

// ---------------------------------------------------------------------------
// Observers, transports, bans
// ---------------------------------------------------------------------------

const OBSERVER = Object.freeze({
  GOOGLE_GBP: "google_gbp",
  BUSINESS_SELF: "business_self",
  OPERATOR: "operator",
  INTAKE_GENIE: "intake_genie",
});

/** Observers that are not the subject of the observation. */
const INDEPENDENT_OBSERVERS = new Set([OBSERVER.GOOGLE_GBP, OBSERVER.OPERATOR]);

/**
 * Observers that may never contribute a value, corroborate one, or raise a
 * conflict. This is a ban, not a low weight: a banned source that could still
 * raise a conflict would be able to veto true facts, and a banned source that
 * could still supply a value would be back where we started.
 */
const BANNED_OBSERVERS = new Set([OBSERVER.INTAKE_GENIE]);

/** Belt to the observer ban: any source whose id or transport smells of the Genie. */
const BANNED_SOURCE_PATTERN = /genie/i;

// ---------------------------------------------------------------------------
// Field classes — what kind of claim each field is, and who is allowed to make it
// ---------------------------------------------------------------------------
//
// nap              contact identity. Wrong value = the client's customers call
//                  a stranger. Requires an observer independent of the subject.
//                  The site alone is not enough (extractor risk, above).
//
// third_party_trust rating / review_count / review text. The subject is
//                  STRUCTURALLY DISQUALIFIED: testimonials a business prints
//                  about itself are not verifiable, and a rating rides into
//                  JSON-LD aggregateRating as a machine-readable claim to
//                  Google with a manual action attached. Only observers that
//                  are not the subject are even READ for this class.
//
// operational      hours. Both Google and the business legitimately publish
//                  these and they legitimately differ (a GBP nobody updated vs
//                  a footer nobody updated). Neither wins. Disagreement =>
//                  absent, because posting the wrong hours costs a real call.
//
// self_published   services, faqs, service_area. The subject IS the authority:
//                  no third party knows the service list — or the MARKET it
//                  sells into — better than the business. Single source
//                  accepted, from the business's own site only.
//
//                  service_area is NOT the address. Flint Plumbing's NAP
//                  locality is Buda, TX (where the office sits); their own site
//                  is titled "Austin Plumbers" and says "Austin, Texas Plumber".
//                  Marketing a 40-year Austin plumber as "Plumbing in Buda, TX"
//                  shrank them to a suburb. The mailing address and the market
//                  are different fields with different sources, and conflating
//                  them is the defect this class exists to end.
//
// geo              coordinates / place id / maps url. Only Google has these.
//
// category         the vertical. Not rendered as copy — it selects the DONOR,
//                  which is where trade-swapping happens (an HVAC company
//                  shipping as a plumber). Google's assigned place type is the
//                  independent check on the caller's claim.
const FIELD_CLASS = Object.freeze({
  business_name: "nap",
  phone: "nap",
  address: "nap",
  city: "nap",
  state: "nap",
  postal_code: "nap",
  current_website: "nap",
  latitude: "geo",
  longitude: "geo",
  place_id: "geo",
  maps_url: "geo",
  rating: "third_party_trust",
  review_count: "third_party_trust",
  reviews: "third_party_trust",
  hours: "operational",
  services: "self_published",
  faqs: "self_published",
  service_area: "self_published",
  industry: "category",
});

/** Classes the subject may not testify about at all. */
const SUBJECT_DISQUALIFIED_CLASSES = new Set(["third_party_trust"]);

/** Classes where a single source is enough only if that source is independent. */
const REQUIRES_INDEPENDENT_SOURCE = new Set(["nap", "geo", "third_party_trust", "category"]);

// ---------------------------------------------------------------------------
// Normalizers / comparators. Two sources "agree" when their NORMALIZED values
// match — never when their raw strings do. "(904) 516-4279" and
// "+1 904-516-4279" are the same number; treating them as a conflict would
// withhold a true fact, which is its own kind of dishonesty.
// ---------------------------------------------------------------------------

const s = (v) => (v == null ? "" : String(v)).trim();
const digits = (v) => s(v).replace(/\D/g, "");
const alnum = (v) => s(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** Last 10 NANP digits. Extensions/country codes are formatting, not identity. */
function normPhone(v) {
  const d = digits(v);
  return d.length >= 10 ? d.slice(-10) : "";
}

/**
 * Registrable-ish host, for the "is this still the same website" binding.
 * Deliberately the same one-liner as lib/verified-trust-lookup.js
 * registrableish() — the two modules apply the same pin and must not be able to
 * disagree about what counts as the same site.
 */
function hostOf(url) {
  try { return new URL(s(url)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/** Company suffixes are formatting noise: "Lyons Roofing" == "Lyons Roofing Inc". */
function normName(v) {
  return alnum(v).replace(/\b(inc|llc|l l c|ltd|co|company|corp|the)\b/g, "").replace(/\s+/g, " ").trim();
}

/**
 * A city observation often arrives with the state glued on, because a business
 * types its own addressLocality as "Lynnwood, WA" while Places reports the
 * locality alone. Those are the SAME observation written two ways, and treating
 * them as a conflict withheld a city that three sources agreed on — which then
 * failed the build for missing_required:["city"].
 *
 * This strips a trailing country and a trailing two-letter state token, and
 * nothing else. It can only ever REMOVE a component both sides already carry
 * elsewhere; it never introduces a locality no source observed. A genuinely
 * different city still disagrees, which is the case that must keep failing.
 */
function normCity(v) {
  const t = s(v)
    .replace(/,?\s*(usa|u\.s\.a\.|united states)\s*$/i, "")
    // Requires a separator before the state token, so a one-word city is never
    // truncated: "Lynnwood" has nothing to strip, "Lynnwood, WA 98036" does.
    .replace(/[,\s]+[A-Za-z]{2}\.?\s*(?:\d{5}(?:-\d{4})?)?\s*$/, "");
  return alnum(t);
}

/**
 * US state names -> code. A fixed reference table, in the same spirit as
 * facts.js STATE_BBOX: it recognises a spelling, it never supplies a value.
 * Used ONLY to decide whether the token a site printed after a comma is a
 * state — which is what makes "Austin, Texas" a place assertion and
 * "Family Owned, Licensed" not one.
 */
const US_STATE_CODE = Object.freeze({
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
});
const US_STATE_CODES = new Set(Object.values(US_STATE_CODE));

const STREET_SUFFIX = {
  street: "st", str: "st", st: "st",
  avenue: "ave", ave: "ave", av: "ave",
  boulevard: "blvd", blvd: "blvd",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  highway: "hwy", hwy: "hwy",
  parkway: "pkwy", pkwy: "pkwy",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  suite: "ste", ste: "ste",
  building: "bldg", bldg: "bldg",
  north: "n", south: "s", east: "e", west: "w",
};

function normStreet(v) {
  return alnum(v).split(" ").map((w) => STREET_SUFFIX[w] || w).filter(Boolean).join(" ");
}

/**
 * Parse either a formatted address string or a schema.org PostalAddress-ish
 * object into components. Trailing country is dropped (one source says "USA",
 * another says nothing, and that is not a disagreement about where they are).
 */
function parseAddress(value) {
  if (value && typeof value === "object") {
    return {
      street: s(value.streetAddress || value.street || value.address1),
      city: s(value.addressLocality || value.city || value.locality),
      state: s(value.addressRegion || value.state || value.region).toUpperCase().slice(0, 2),
      postal: digits(value.postalCode || value.postal || value.zip).slice(0, 5),
    };
  }
  const raw = s(value);
  if (!raw) return { street: "", city: "", state: "", postal: "" };
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean)
    .filter((p) => !/^(usa|us|united states)$/i.test(p));
  const tail = parts.length > 1 ? parts[parts.length - 1] : "";
  const m = /([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(tail) || /([A-Za-z]{2})$/.exec(tail);
  return {
    street: parts[0] || "",
    city: parts.length > 2 ? parts[parts.length - 2] : "",
    state: m ? String(m[1]).toUpperCase() : "",
    postal: m && m[2] ? m[2] : "",
  };
}

/**
 * Address agreement is COMPONENT-WISE OVER THE INTERSECTION. One source
 * omitting the ZIP is silence, not disagreement — demanding a full match would
 * manufacture conflicts and withhold true addresses. A component present on
 * BOTH sides and different is a real disagreement.
 */
function addressAgrees(a, b) {
  const x = parseAddress(a);
  const y = parseAddress(b);
  let compared = 0;
  const pairs = [
    [normStreet(x.street), normStreet(y.street)],
    [alnum(x.city), alnum(y.city)],
    [x.state, y.state],
    [x.postal, y.postal],
  ];
  for (const [p, q] of pairs) {
    if (!p || !q) continue;
    compared += 1;
    if (p !== q) return false;
  }
  return compared > 0;
}

const DAY_KEY = {
  mon: "mon", monday: "mon", tue: "tue", tues: "tue", tuesday: "tue",
  wed: "wed", weds: "wed", wednesday: "wed", thu: "thu", thur: "thu", thurs: "thu", thursday: "thu",
  fri: "fri", friday: "fri", sat: "sat", saturday: "sat", sun: "sun", sunday: "sun",
};

function to24h(hh, mm, ampm) {
  let h = Number(hh);
  if (/pm/i.test(ampm || "") && h < 12) h += 12;
  if (/am/i.test(ampm || "") && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(mm || "00").padStart(2, "0")}`;
}

/**
 * Canonicalize hours from either Google's weekdayDescriptions
 * ("Monday: 8:00 AM – 5:00 PM" / "Open 24 hours" / "Closed") or schema.org
 * openingHours ("Mon 08:00-17:00") into { mon: "08:00-17:00" | "24h" | "closed" }.
 * A line we cannot parse is DROPPED, never guessed — an unparsed line must not
 * become a fake "closed".
 */
function normHours(value) {
  const out = {};
  const lines = Array.isArray(value)
    ? value
    : (value && typeof value === "object")
      ? Object.entries(value).map(([k, v]) => `${k}: ${typeof v === "string" ? v : ""}`)
      : [];
  for (const line of lines) {
    const text = s(typeof line === "string" ? line : (line && (line.day || line.name)) ? `${line.day || line.name}: ${line.open || ""}-${line.close || ""}` : "");
    if (!text) continue;
    const dm = /^\s*([A-Za-z]+)\s*[:\s]/.exec(text);
    if (!dm) continue;
    const day = DAY_KEY[dm[1].toLowerCase()];
    if (!day) continue;
    const rest = text.slice(dm[0].length).trim();
    if (/closed/i.test(rest)) { out[day] = "closed"; continue; }
    if (/24\s*hours|open\s*24/i.test(rest)) { out[day] = "24h"; continue; }
    const rm = /(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?/.exec(rest);
    if (!rm) continue;
    out[day] = `${to24h(rm[1], rm[2], rm[3])}-${to24h(rm[4], rm[5], rm[6])}`;
  }
  return out;
}

/** Hours agree over the days BOTH sources describe. Silence is not disagreement. */
function hoursAgree(a, b) {
  const x = normHours(a);
  const y = normHours(b);
  let compared = 0;
  for (const day of Object.keys(x)) {
    if (!(day in y)) continue;
    compared += 1;
    if (x[day] !== y[day]) return false;
  }
  return compared > 0;
}

/**
 * Review counts DRIFT. Two true observations taken minutes apart can differ by
 * one or two, and calling that a conflict would permanently withhold the single
 * strongest conversion element on the page. So: agreement inside a small band,
 * and when they differ inside the band we take the LOWER number. Understating a
 * review count is conservative; overstating one is a claim we cannot support.
 * Outside the band it is a real disagreement and the field goes absent.
 */
function reviewCountBand(a, b) {
  return Math.max(2, Math.round(Math.max(a, b) * 0.02));
}

function agrees(field, a, b) {
  switch (field) {
    case "phone": return normPhone(a) === normPhone(b) && normPhone(a) !== "";
    case "business_name": return normName(a) === normName(b) && normName(a) !== "";
    case "address": return addressAgrees(a, b);
    case "city": return normCity(a) === normCity(b) && normCity(a) !== "";
    case "current_website": {
      const host = (v) => { try { return new URL(s(v)).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return alnum(v); } };
      return host(a) === host(b) && host(a) !== "";
    }
    case "hours": return hoursAgree(a, b);
    case "rating": return Math.abs(Number(a) - Number(b)) <= 0.05;
    case "review_count": {
      const x = Number(a); const y = Number(b);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      return Math.abs(x - y) <= reviewCountBand(x, y);
    }
    case "latitude": case "longitude": return Math.abs(Number(a) - Number(b)) <= 0.001;
    default: return alnum(a) === alnum(b) && alnum(a) !== "";
  }
}

/** Which of two agreeing values to keep. Only ever the more conservative one. */
function pickAgreed(field, a, b) {
  if (field === "review_count") return Math.min(Number(a), Number(b));
  if (field === "rating") return Math.min(Number(a), Number(b));
  // City is the one text field where SHORTER is more correct: the two agreeing
  // renderings are "Lynnwood" and "Lynnwood, WA", and the site must print the
  // locality, not the locality with a state stapled to it.
  if (field === "city") return s(a).length <= s(b).length ? a : b;
  // For text fields, keep the longer/more complete rendering (a fuller address
  // beats a truncated one). Both are the same value by definition here.
  return s(b).length > s(a).length ? b : a;
}

// ---------------------------------------------------------------------------
// PRESENTATION NORMALIZERS.
//
// These change how an AGREED value is written down, never which value it is.
// "+1 904-516-4279" -> "(904) 516-4279" is the same ten digits; dropping a
// trailing "USA" from an address drops a component neither source disputes.
// Both are lossless and deterministic. Nothing here may ever introduce a digit,
// a word or a component that no source observed.
// ---------------------------------------------------------------------------

/** NANP display form from the agreed ten digits. Non-NANP input is untouched. */
function displayPhone(v) {
  const d = normPhone(v);
  if (d.length !== 10) return s(v);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Drop a trailing country component. Never touches the street/suite lines.
 *
 * The rule itself now lives in lib/mirror-engine/postal.js, because the
 * resolver is not the only path an address takes to a page: when this resolver
 * has no address, lib/mirror-lane-build.js falls through to the mined
 * contract's raw Google formattedAddress, and that value reached
 * wss-test-meyer-heating-and-air-st-louis's structured data complete with
 * ", USA". Delegating means the resolver and the publish-side boundary
 * (facts.js validateFacts) cannot answer this question differently.
 */
function displayAddress(v) {
  if (v && typeof v === "object") {
    const p = parseAddress(v);
    return [p.street, p.city, [p.state, p.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }
  return dropCountry(s(v));
}

/**
 * Shape review objects for MirrorContent
 * (`{text, author?, rating?, avatarUrl?, publishedAt?}`,
 * additionalProperties:false, maxItems 5). Our adapters carry raw field names;
 * anything the schema does not declare is dropped here, because passing an
 * extra key hard-400s the whole build — which is how content silently became
 * "none" before.
 *
 * Author names are kept: they are the real Google reviewers, publicly
 * attributed by Google, and displaying a review without attribution is both
 * weaker proof and against Google's own display terms.
 *
 * THE FACE AND THE DATE TRAVEL WITH THE WORDS, and this shaper used to strip
 * both. It also capped at THREE while the schema, verified-trust-lookup.js and
 * mirror-lane-build.js all cap at five — so the moment the place-id pin made
 * this the winning review source, a lead went from five quotes with faces to
 * three without. Same corpus, three shapers, three answers.
 *
 * A face is only a face if GOOGLE SERVED IT, and Google's generated initial
 * tiles do not count. That rule lives in exactly one file
 * (lib/verified-trust-lookup.js isGoogleReviewerFace) so the miner, the trust
 * lookup and this resolver can never disagree about what a face is. NOTHING
 * here substitutes, generates or back-fills a face: an absent photo is an
 * absent photo, and the renderer decides whether that becomes a monogram.
 */
function shapeReviews(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => {
      const out = { text: s(r && r.text) };
      const author = s(r && r.author);
      if (author) out.author = author;
      const rating = Number(r && r.rating);
      if (Number.isFinite(rating) && rating > 0 && rating <= 5) out.rating = rating;
      const avatar = s(r && (r.author_photo_url || r.avatarUrl));
      if (isGoogleReviewerFace(avatar)) out.avatarUrl = avatar;
      const publishedAt = s(r && (r.published_at || r.publishedAt));
      if (publishedAt) out.publishedAt = publishedAt;
      return out;
    })
    .filter((r) => r.text)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Vertical / trade-swap guard.
//
// Google's assigned primary place type is an INDEPENDENT statement about what
// trade this business is in. It is the only thing standing between "HVAC
// company" and a plumbing donor. Mapping is explicit — an unmapped type
// resolves to null, which reports "unknown", never "close enough".
// ---------------------------------------------------------------------------
const PLACE_TYPE_VERTICAL = Object.freeze({
  roofing_contractor: "roofing",
  plumber: "plumbing",
  hvac_contractor: "hvac",
  electrician: "electrical",
  general_contractor: "general_contracting",
  painter: "painting",
  landscaper: "landscaping",
  fence_contractor: "fencing",
  moving_company: "moving",
  locksmith: "locksmith",
  pest_control_service: "pest_control",
  car_repair: "auto_repair",
  car_wash: "auto_detailing",
  tree_service: "tree_care",
  flooring_contractor: "flooring",
  masonry_contractor: "masonry",
});

/** Free-text industry -> the same canonical vertical space. Unmapped => null. */
const INDUSTRY_VERTICAL = Object.freeze({
  roofing: "roofing", roofer: "roofing", "roofing contractor": "roofing",
  plumbing: "plumbing", plumber: "plumbing",
  hvac: "hvac", "heating and air": "hvac", "air conditioning": "hvac",
  electrical: "electrical", electrician: "electrical",
  fencing: "fencing", fence: "fencing",
  landscaping: "landscaping", landscaper: "landscaping",
  "tree care": "tree_care", "tree service": "tree_care", arborist: "tree_care",
  concrete: "concrete", masonry: "masonry", painting: "painting",
  flooring: "flooring", "pest control": "pest_control",
});

function verticalOfIndustry(industry) {
  const key = s(industry).toLowerCase();
  return INDUSTRY_VERTICAL[key] || INDUSTRY_VERTICAL[key.replace(/\s+contractor$/, "")] || null;
}

function verticalOfPlaceTypes(types) {
  for (const t of Array.isArray(types) ? types : []) {
    const v = PLACE_TYPE_VERTICAL[s(t).toLowerCase()];
    if (v) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SOURCE ADAPTERS
//
// Every adapter returns the same envelope:
//   { id, observer, transport, status, requests, observations, note?, error? }
// `observations` is a flat map of FIELD -> raw value. An adapter never decides
// whether a value is trustworthy; it only reports what it saw and who saw it.
// ---------------------------------------------------------------------------

function envInt(name, dflt) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * SOURCE 1 — Google Places, read server-side through the CallPrep api-gateway
 * `lookup` action (the same call the Signal report app makes for every scan).
 *
 * Why not our own key: GOOGLE_PLACES_API_KEY and GOOGLE_MAPS_API_KEY in the
 * breadcrumb env are HTTP-REFERRER-RESTRICTED browser keys — Places (New)
 * answers a server-side request with 403 API_KEY_HTTP_REFERRER_BLOCKED — and
 * GOOGLE_API_KEY's project does not have the Places API enabled. Verified
 * 2026-07-31 against places.googleapis.com/v1/places:searchText. The gateway
 * holds a server key, so this is the working transport today. `placesDirect`
 * below is kept live so the day the key restriction is fixed we gain a genuine
 * second transport instead of quietly staying on one.
 *
 * Cost: 1 gateway request == 1 Google Places SearchText call on CallPrep's key.
 *
 * THE PIN — why `lowConfidence` is ANSWERED here rather than obeyed.
 *
 * The gateway matches on TEXT and reports how sure it is. For a multi-branch
 * brand it genuinely cannot be sure, so it flags `lowConfidence: true` and this
 * adapter used to return `match_unconfirmed` — no name, no phone, no rating, no
 * reviews, no hours, no coordinates. Measured live 2026-08-06 on the owner's
 * Oregon run: D&F Plumbing (2,186 reviews) and Carter's My Plumber both came
 * back flagged, and both times the place the gateway returned was EXACTLY the
 * place_id Google had already given the miner. A correct answer was thrown away
 * because its deliverer was modest about it.
 *
 * When the caller supplies a place_id we hold something the gateway does not:
 * the id Google itself returned when the miner matched this business by its own
 * registrable domain (lead-miner.js verifyNapForCandidate — the strongest
 * identity binding in the pipeline). So the ambiguity is not resolved by
 * preference or by a confidence threshold; it is resolved by EXACT id equality
 * against that prior, independent observation. This is the same rule, and
 * deliberately the same wording, as lib/verified-trust-lookup.js — the two must
 * never be able to disagree about which place a lead is.
 *
 * The pin cuts BOTH ways, and the second direction is the important one: with
 * no pin, a HIGH-confidence match was accepted with no identity check at all.
 * Rescue Rooter (Portland) resolves by text to ChIJk0fCew52lVQREePFYwU2S5Y —
 * the Clackamas branch, twelve miles away. Nothing here refused it before; the
 * only reason its phone and reviews did not ship as this client's was that the
 * gateway happened to admit it was unsure. A mismatch is now a hard refusal.
 *
 * With no place_id supplied, behaviour is exactly as before.
 */
async function placesViaCallPrep(ctx) {
  const id = "places_gbp_via_callprep_gateway";
  const base = { id, observer: OBSERVER.GOOGLE_GBP, transport: "places_api/callprep_gateway", requests: 0, observations: {} };
  const key = s(process.env.CALLPREP_SUPABASE_ANON_KEY);
  const rawUrl = s(process.env.CALLPREP_SUPABASE_URL);
  if (!key || !rawUrl) return { ...base, status: "not_configured", note: "CALLPREP_SUPABASE_URL / CALLPREP_SUPABASE_ANON_KEY unset" };

  let endpoint;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" || u.username || u.password) throw new Error("invalid");
    endpoint = `${u.origin}${u.pathname.replace(/\/+$/, "")}/functions/v1/api-gateway`;
  } catch {
    return { ...base, status: "not_configured", note: "CALLPREP_SUPABASE_URL is not a usable https origin" };
  }

  // The gateway's lookup matches best on a website URL, then on
  // "Name City ST". A bare phone number only matches an EXACT GBP phone, so it
  // is never used as the key here.
  const input = s(ctx.website) || [s(ctx.business_name), s(ctx.city), s(ctx.state)].filter(Boolean).join(" ");
  if (!input) return { ...base, status: "insufficient_input", note: "need a website or name+city+state" };

  const url = `${endpoint}?${new URLSearchParams({ action: "lookup", input })}`;
  let json = null;
  try {
    base.requests = 1;
    const res = await (ctx.fetchImpl || fetch)(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(envInt("VERIFIED_FACTS_TIMEOUT_MS", 70000)),
    });
    json = await res.json().catch(() => null);
    if (!res.ok || !json) return { ...base, status: "provider_error", error: `http_${res.status}` };
    if (json.error) return { ...base, status: "provider_declined", error: s(json.error) };
  } catch (e) {
    return { ...base, status: "unavailable", error: s(e && e.name) || "fetch_failed" };
  }

  // ---- IDENTITY, before a single field is read ----------------------------
  const pin = s(ctx.place_id);
  const returnedId = s(json.placeId);
  let pinned = false;
  if (pin) {
    // A MISMATCH IS A STRANGER. Not a weaker match, not a fallback — a
    // different business, whose phone number and reviews may not appear on our
    // client's website at any confidence level.
    if (returnedId && returnedId !== pin) {
      return {
        ...base,
        status: "place_id_mismatch",
        note: "gateway resolved a different place than the one this lead is pinned to",
        pinned_place_id: pin,
        returned_place_id: returnedId,
        candidate: { name: json.name, address: json.address, confidence: json.confidenceScore },
      };
    }
    // No id at all is not a match either: there is nothing to check against,
    // so the pin cannot do its job and we are back to trusting text.
    if (!returnedId) {
      return {
        ...base,
        status: "match_unconfirmed",
        note: "gateway returned no place id to check the pin against",
        pinned_place_id: pin,
        candidate: { name: json.name, address: json.address, confidence: json.confidenceScore },
      };
    }
    // SECOND BINDING, identical to verified-trust-lookup.js: the place we
    // pinned must still point at the site we mined. A place_id is stable, but a
    // listing re-pointed at another domain since the mine is a listing we no
    // longer recognise. Only fires when BOTH hosts are known.
    const minedHost = hostOf(ctx.website);
    const returnedHost = hostOf(json.website);
    if (minedHost && returnedHost && minedHost !== returnedHost) {
      return {
        ...base,
        status: "website_host_mismatch",
        note: "the pinned place now points at a different website than the one this lead was mined from",
        pinned_place_id: pin,
        mined_host: minedHost,
        returned_host: returnedHost,
      };
    }
    pinned = true;
  } else if (json.lowConfidence === true) {
    // NO PIN, AND THE GATEWAY IS UNSURE. We have observed SOMEBODY — possibly
    // the competitor two miles away — so we report nothing rather than a
    // stranger's phone number. Unchanged behaviour for callers with no place_id.
    return {
      ...base,
      status: "match_unconfirmed",
      note: "gateway reported lowConfidence for this lookup and no place_id was supplied to pin against",
      candidate: { name: json.name, address: json.address, confidence: json.confidenceScore },
    };
  }

  const obs = {};
  if (json.name) obs.business_name = json.name;
  if (json.phone) obs.phone = json.phone;
  if (json.address) obs.address = json.address;
  if (json.city) obs.city = json.city;
  if (json.website) obs.current_website = String(json.website).replace(/[?&]utm_campaign=gmb$/i, "");
  if (Number.isFinite(Number(json.lat))) obs.latitude = Number(json.lat);
  if (Number.isFinite(Number(json.lng))) obs.longitude = Number(json.lng);
  if (json.placeId) obs.place_id = json.placeId;
  if (json.mapsUrl) obs.maps_url = json.mapsUrl;
  if (Number(json.rating) > 0) obs.rating = Number(json.rating);
  if (Number(json.reviewCount) > 0) obs.review_count = Number(json.reviewCount);
  if (Array.isArray(json.hoursText) && json.hoursText.length) obs.hours = json.hoursText;
  const parsed = parseAddress(json.address);
  if (parsed.state) obs.state = parsed.state;
  if (parsed.postal) obs.postal_code = parsed.postal;

  // Review TEXT. Google's own corpus, authored by customers, attributed. This is
  // the one review source that is not the business talking about itself.
  const reviews = (Array.isArray(json.reviews) ? json.reviews : [])
    .map((r) => ({
      text: s(r && r.text),
      author: s(r && r.authorName),
      rating: Number(r && r.rating),
      // The gateway's lookup does not carry a profile photo today, so a face is
      // simply ABSENT here — never substituted, never generated. The field is
      // read anyway so that the day the gateway forwards one, it arrives.
      author_photo_url: s(r && (r.authorPhotoUrl || r.profilePhotoUrl || r.author_photo_url)),
      // Google returns `time` as unix seconds on this transport. Recency is
      // half of how a review earns its place on the page (see featuredReviews),
      // so it travels as an ISO string rather than being dropped.
      published_at: Number.isFinite(Number(r && r.time)) && Number(r.time) > 0
        ? new Date(Number(r.time) * 1000).toISOString()
        : "",
    }))
    .filter((r) => r.text);
  if (reviews.length) obs.reviews = reviews;

  return {
    ...base,
    status: "ok",
    observations: obs,
    place_types: Array.isArray(json.types) ? json.types : [],
    match: {
      confidence: json.confidenceScore,
      margin: json.confidenceMargin,
      alternatives: (json.alternatives || []).length,
      // Recorded so an audit can see WHAT admitted this record: the pin, or the
      // gateway's own confidence. When both are present and disagree, the pin
      // is what did the work — say so rather than leaving it to be re-derived.
      pinned: pinned,
      ...(pinned ? { pinned_place_id: pin, gateway_low_confidence: json.lowConfidence === true } : {}),
    },
  };
}

/**
 * SOURCE 2 — Google Places (New) called directly with our own key.
 * Currently 403s (see placesViaCallPrep). Kept live and REPORTED, because a
 * source that is silently skipped is a source nobody ever fixes.
 * Cost: 1 Places SearchText request when the key works; a 403 is not billed.
 */
async function placesDirect(ctx) {
  const id = "places_gbp_direct";
  const base = { id, observer: OBSERVER.GOOGLE_GBP, transport: "places_api/own_key", requests: 0, observations: {} };
  const key = s(process.env.GOOGLE_PLACES_API_KEY);
  if (!key) return { ...base, status: "not_configured", note: "GOOGLE_PLACES_API_KEY unset" };
  const textQuery = [s(ctx.business_name), s(ctx.city), s(ctx.state)].filter(Boolean).join(" ");
  if (!textQuery) return { ...base, status: "insufficient_input" };
  try {
    base.requests = 1;
    const res = await (ctx.fetchImpl || fetch)("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id", "places.displayName", "places.formattedAddress", "places.location",
          "places.nationalPhoneNumber", "places.websiteUri", "places.rating", "places.userRatingCount",
          "places.reviews", "places.regularOpeningHours", "places.addressComponents",
          "places.primaryType", "places.types", "places.googleMapsUri", "places.businessStatus",
        ].join(","),
      },
      body: JSON.stringify({ textQuery, pageSize: s(ctx.place_id) ? 10 : 1 }),
      signal: AbortSignal.timeout(envInt("VERIFIED_FACTS_TIMEOUT_MS", 30000)),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const reason = json && json.error && json.error.details && json.error.details[0] && json.error.details[0].reason;
      return { ...base, status: "unavailable", error: `http_${res.status}${reason ? `:${reason}` : ""}` };
    }
    // THE SAME PIN as placesViaCallPrep. A text query returns Google's best
    // guess, and for a multi-branch brand its best guess is a coin flip; when we
    // hold the id Google itself gave the miner, the result either IS that place
    // or it is a stranger. Searching a page of results rather than one lets the
    // pin land on the right branch instead of refusing the whole lookup because
    // Google ranked a sibling first.
    const pin = s(ctx.place_id);
    const found = (json && Array.isArray(json.places) ? json.places : []);
    const p = pin ? found.find((x) => s(x && x.id) === pin) || null : (found[0] || null);
    if (!p) {
      if (pin && found.length) {
        return {
          ...base,
          status: "place_id_mismatch",
          note: "no result in this page of matches carries the id this lead is pinned to",
          pinned_place_id: pin,
          returned_place_id: s(found[0] && found[0].id),
        };
      }
      return { ...base, status: "no_match" };
    }
    const obs = {};
    if (p.displayName && p.displayName.text) obs.business_name = p.displayName.text;
    if (p.nationalPhoneNumber) obs.phone = p.nationalPhoneNumber;
    if (p.formattedAddress) obs.address = p.formattedAddress;
    if (p.websiteUri) obs.current_website = p.websiteUri;
    if (p.location) { obs.latitude = Number(p.location.latitude); obs.longitude = Number(p.location.longitude); }
    if (p.id) obs.place_id = p.id;
    if (p.googleMapsUri) obs.maps_url = p.googleMapsUri;
    if (Number(p.rating) > 0) obs.rating = Number(p.rating);
    if (Number(p.userRatingCount) > 0) obs.review_count = Number(p.userRatingCount);
    if (p.regularOpeningHours && Array.isArray(p.regularOpeningHours.weekdayDescriptions)) obs.hours = p.regularOpeningHours.weekdayDescriptions;
    const reviews = (Array.isArray(p.reviews) ? p.reviews : [])
      .map((r) => ({
        text: s(r && r.text && r.text.text),
        author: s(r && r.authorAttribution && r.authorAttribution.displayName),
        rating: Number(r && r.rating),
        // THE REVIEWER'S FACE. Places (New) serves it as
        // authorAttribution.photoUri, and this adapter read the display name
        // beside it and walked past the photo. It is the only transport in the
        // system that carries one, so faces on a mirror are gated entirely on
        // this line plus a working key — today the key answers
        // API_KEY_SERVICE_BLOCKED and the field is therefore honestly absent.
        // Nothing here invents a face when Google supplies none.
        author_photo_url: s(r && r.authorAttribution && r.authorAttribution.photoUri),
        // ISO-8601 on this transport.
        published_at: s(r && r.publishTime),
      }))
      .filter((r) => r.text);
    if (reviews.length) obs.reviews = reviews;
    return { ...base, status: "ok", observations: obs, place_types: [p.primaryType, ...(p.types || [])].filter(Boolean) };
  } catch (e) {
    return { ...base, status: "unavailable", error: s(e && e.name) || "fetch_failed" };
  }
}

/**
 * SOURCE 3 — Google's knowledge panel, read through BrightData SERP.
 * Same OBSERVER as Places (it is Google's record either way), different
 * transport. Attestation (name + city/phone agreement) already lives in
 * trust-brightdata.js and is not duplicated here.
 * Cost: 1-3 BrightData SERP requests (retries on BrightData's "recently failed"
 * body), billed ~$1.50/CPM.
 */
async function knowledgePanel(ctx) {
  const id = "google_knowledge_panel_via_brightdata";
  const base = { id, observer: OBSERVER.GOOGLE_GBP, transport: "serp/brightdata", requests: 0, observations: {} };
  if (!s(process.env.BRIGHTDATA_API_KEY)) return { ...base, status: "not_configured", note: "BRIGHTDATA_API_KEY unset" };
  let t;
  try {
    base.requests = 1;
    t = await (ctx.fetchTrustImpl || fetchTrust)({
      business_name: ctx.business_name, city: ctx.city, state: ctx.state, phone: ctx.phone,
    }, ctx.trustOptions || {});
  } catch (e) {
    return { ...base, status: "unavailable", error: s(e && e.message).slice(0, 120) };
  }
  if (!t || !t.ok) return { ...base, status: "unattested", error: (t && t.reason) || "no_result", panel: t && t.panel };
  const obs = { rating: t.rating, review_count: t.review_count };
  if (t.panel && t.panel.name) obs.business_name = t.panel.name;
  if (t.panel && t.panel.phone) obs.phone = t.panel.phone;
  if (t.panel && t.panel.address) obs.address = t.panel.address;
  return { ...base, status: "ok", observations: obs, attested_by: t.attested_by, observed_at: t.observed_at };
}

// --- first-party site -------------------------------------------------------

function jsonLdBlocks(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* an unparsable block is silence, not a fact */ }
  }
  const flat = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    flat.push(node);
    if (Array.isArray(node["@graph"])) node["@graph"].forEach(walk);
  };
  out.forEach(walk);
  return flat;
}

function typeOf(node) {
  const t = node && node["@type"];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x) => String(x).toLowerCase());
}

const NON_SERVICE_PATH = /^\/?(about|contact|blog|news|gallery|testimonial|review|faq|frequently|privacy|terms|sitemap|careers?|jobs|financing|category|tag|author|wp-|feed|search|cart|account|locations?|service-areas?|areas?-we-serve)/i;

/**
 * The same blocklist, applied to a path segment ANYWHERE in the URL.
 *
 * NON_SERVICE_PATH is anchored at the start, which is correct for a site whose
 * pages sit at the root and useless for one whose pages all hang off a branch
 * prefix. Rescue Rooter's site is
 * https://www.ars.com/rescue-rooter-jack-howk-portland/…, so `/…/reviews`,
 * `/…/coupons`, `/…/service-areas` and `/…/about-us` all sailed past the
 * anchored test — and the mirror rendered "Reviews", "Coupons", "About Us" and
 * "Book Appointment" as SERVICE CARDS on the client's own new website.
 * Measured on the served page, 2026-08-06.
 *
 * Matched as WHOLE SEGMENTS, not prefixes, so a real service page is never
 * caught by a substring: "/reviews" is refused, "/sewer-line-service" is not.
 * The marketing and booking words are the ones two real prospect sites actually
 * used; they are pages about buying, not things the business does.
 *
 * `locations` is deliberately ABSENT from this list while staying in the
 * anchored one above. A site rooted at /locations is a directory; a site with
 * /locations/portland/drain-cleaning is publishing a real service under a city
 * hub, and refusing those would strip the service list off exactly the kind of
 * multi-city contractor that has the most of them — and then fail them at the
 * content floor for having none. The anchored rule keeps today's behaviour;
 * this one only adds the nested cases that are unambiguously not services.
 */
const NON_SERVICE_SEGMENT = /^(about|about-us|contact|contact-us|blog|news|press|media|media-kit|gallery|photos|testimonials?|reviews?|faqs?|privacy|terms|licenses?|licensing|sitemap|careers?|jobs|financing|search|cart|account|service-areas?|areas-we-serve|coupons?|specials?|offers?|promotions?|deals?|rebates?|rebate-center|book|book-now|book-appointment|schedule|schedule-service|appointments?|request-service|estimates?|free-estimate|quotes?|get-a-quote|pricing|payment|login|my-account)$/i;

/**
 * A CITY LANDING PAGE, RECOGNISED BY ITS ZIP CODE.
 *
 * MEASURED 2026-08-11 on the rebuilt Rose City mirror, which published four
 * schema.org Service nodes reading "Clackamas", "Beaverton", "Hillsboro" and
 * "Tualatin" — the suburbs of Portland. Their own site lists them under an
 * <h4>Service Areas</h4> heading as ordinary links:
 *
 *   <a href="clackamas-or-97015-air-conditioning-services.php">Clackamas</a>
 *
 * Every existing defence missed it, and each for a good reason. The path
 * blocklist looks for a segment spelled `service-areas`, and this path has no
 * segments at all — it is one flat `.php` filename that ENDS in
 * "air-conditioning-services", so it reads as the most service-like URL on the
 * site. The label predicate sees "Clackamas": a capitalised noun phrase, no
 * verb, no question mark, no nav word. Nothing about the STRING says town, and
 * nothing about the LABEL ever will — "Ductless" and "Clackamas" are the same
 * shape.
 *
 * What gives it away is the ZIP CODE. A `{state}-{zipcode}` pair inside a URL
 * is how a CMS names a per-city landing page and is not how anyone names a
 * service page: a business selling ductless mini-splits does not file them
 * under 97015. Two letters and five digits, adjacent, anywhere in the path.
 *
 * Deliberately NOT a bare five-digit test — "50-100-amp-panel-upgrades" and
 * "24000-btu-installation" are real service slugs and carry no state letters.
 */
const CITY_LANDING_PATH = /(?:^|[-/])[a-z]{2}-\d{5}(?:[-/]|$)/i;

function isNonServicePath(pathname) {
  if (NON_SERVICE_PATH.test(pathname)) return true;
  if (CITY_LANDING_PATH.test(String(pathname))) return true;
  return String(pathname).split("/").filter(Boolean).some((seg) => NON_SERVICE_SEGMENT.test(seg));
}

/**
 * THE CORPORATE FOOTER, recognised by its LABEL rather than its path.
 *
 * A path blocklist cannot catch these: a franchise portal routes
 * "Do Not Sell My Personal Information" through whatever slug its CMS
 * generated, and every entry blocked by path simply promotes the next footer
 * link into the twelve-card cap. Measured on the live Rescue Rooter mirror,
 * where the client's service list ended "Supplier Support | Glossary |
 * Accessibility | Do Not Sell My Personal Information".
 *
 * WHOLE-LABEL matches only, and every one of them is a legal, corporate or
 * navigational page that no business anywhere sells. A service named
 * "Accessibility Remodeling" or "Emergency Service" is untouched.
 */
const NON_SERVICE_LABEL = /^(accessibility(?: statement)?|do not sell(?: or share)?(?: my)?(?: personal)?(?: information| info)?|privacy(?: policy| notice)?|terms(?: of (?:use|service))?|cookie(?: policy| preferences| settings)?|legal|disclaimer|sitemap|site map|glossary|faq|faqs|blog|news|newsroom|press(?: room| releases?)?|media kit|investors?(?: relations)?|supplier support|suppliers?|vendors?|franchise(?: opportunities| with us)?|careers?|employment|licenses?|licensing|our team|leadership|locations?|store locator|log ?in|sign ?in|sign ?up|my account|customer portal|pay(?: my)? bill|make a payment|gift cards?|rebate center|rebates?|coupons?|specials?|financing|apply now|shop|store)$/i;

/**
 * "Portland plumber" is a link back to the hub page, not a thing the business
 * does. Rendered as service card 07 on the live Rescue Rooter mirror.
 *
 * A label that is nothing but the client's own market plus the bare name of
 * their trade carries no information a visitor to their site does not already
 * have from the heading above it — every other card on the page is inside that
 * city and inside that trade. Refused only when NOTHING ELSE is left: "Portland
 * Emergency Plumbing" keeps "Emergency" and survives.
 */
const GENERIC_TRADE_WORD = new Set([
  "plumber", "plumbers", "plumbing", "roofer", "roofers", "roofing", "hvac",
  "electrician", "electricians", "electrical", "landscaper", "landscapers",
  "landscaping", "contractor", "contractors", "painter", "painters", "painting",
  "locksmith", "locksmiths", "arborist", "arborists", "masonry", "mason",
  "flooring", "fencing", "fence", "concrete", "service", "services", "company",
  "co", "inc", "llc", "and", "the", "in", "of", "your", "our", "near", "me",
]);

function isHubLabel(label, city, state) {
  const words = alnum(label).split(" ").filter(Boolean);
  if (!words.length) return false;
  const cityWords = new Set(alnum(city).split(" ").filter(Boolean));
  const stateWord = alnum(state);
  const remaining = words.filter((w) => (
    !cityWords.has(w) && w !== stateWord && !GENERIC_TRADE_WORD.has(w)
  ));
  return remaining.length === 0;
}

/**
 * A SERVICE NAME, not a search-engine headline.
 *
 * Local sites write their navigation for Google, so the same service appears
 * twice — once as a label and once with a locality stapled on. Jam Plumbing's
 * own nav, rendered on the live mirror 2026-08-06, produced twelve cards that
 * were really seven services:
 *
 *   01 Repiping                 …  08 Whole Home Repiping Services in Portland OR
 *   07 Commercial Plumbing Services  10 Commercial Plumbing Services in Portland OR
 *
 * Two costs, both real. The page reads like a template that lost its dedupe;
 * and a card title ending in the bare state code "OR" trips the render gate's
 * `line_ends_with_connector` rule, which fails route_render, which makes the
 * WHOLE mirror unrevealable. Jam shipped as nothing at all because of it.
 *
 * REMOVAL ONLY, and only of a trailing locality the page states in its own
 * heading anyway ("Services in Portland, OR"). It can never introduce a word no
 * source wrote — the same discipline as normCity() dropping a trailing state and
 * stripPlaceLeadIn() dropping "Serving ". The state must be a REAL US state
 * code, so "Emergency Service in a Hurry" keeps every word, and a name that
 * would be left too short to mean anything is returned untouched.
 *
 * Deduplication then happens for free on the caller's existing lowercased key:
 * "Commercial Plumbing Services in Portland OR" becomes a label the list
 * already holds, and the duplicate card disappears.
 */
const TRAILING_LOCALITY_RE = /\s+(?:in|near|serving|for)\s+[A-Z][A-Za-z'’.-]*(?:[ -][A-Z][A-Za-z'’.-]*){0,2},?\s+([A-Za-z]{2})\.?$/;

function stripTrailingLocality(name) {
  const raw = s(name);
  const m = TRAILING_LOCALITY_RE.exec(raw);
  if (!m) return raw;
  if (!US_STATE_CODES.has(m[1].toUpperCase())) return raw;
  const trimmed = raw.slice(0, m.index).trim().replace(/[,\-–—|·]+$/, "").trim();
  return trimmed.length >= 3 ? trimmed : raw;
}

/** "TX" / "tx." / "Texas" / "New Mexico" -> "TX". Anything else -> "". */
function stateCodeOf(token) {
  const t = s(token).replace(/\.+$/, "");
  if (/^[A-Za-z]{2}$/.test(t) && US_STATE_CODES.has(t.toUpperCase())) return t.toUpperCase();
  return US_STATE_CODE[t.toLowerCase()] || "";
}

/**
 * "<Place>, <State>" — a place name immediately followed by a US state, written
 * by the site itself. The trailing state is the whole point: it is what makes
 * the leading words a PLACE ASSERTION rather than two capitalised words that
 * happen to sit either side of a comma. `stateCodeOf` rejects everything that is
 * not a real state, so "Local Family Owned, Licensed" yields nothing.
 *
 * THE ABBREVIATION FIX, 2026-08-12. Each place word may carry ONE trailing
 * period, because the abbreviation IS part of the name: "St. Louis", "St. Paul",
 * "Ft. Worth", "Mt. Pleasant", and real multi-word cases like "Lake St. Louis".
 * Without the `\.?` the class stopped at "St" (the period is not a letter), the
 * `,\s*<state>` after it failed, and the match slid to the next word — so a live
 * HVAC mirror shipped "Indoor Comfort Team. HVAC in Louis, MO", St. Louis with
 * its Saint amputated. The period is a Saint/Fort/Mount marker here, never a
 * sentence end: a word can only chain to the next via `[ -][A-Z]`, so "Great
 * service. Boston, MA" still matches only "Boston, MA". The numbered/precinct
 * refusals are untouched — they run downstream in place-names.js on whatever is
 * captured, and this class still requires a leading LETTER, so "9, LA" and
 * "District 9, TX" are not captured here and are refused there as before.
 */
const PLACE_STATE_RE = /\b([A-Z][a-zA-Z'’-]+\.?(?:[ -][A-Z][a-zA-Z'’-]+\.?){0,2}),\s*([A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*)?)/g;

/**
 * THE TRADE IS NOT PART OF THE TOWN'S NAME.
 *
 * Measured on the rebuilt plumbing fleet — these are their real <title> tags,
 * and the captured "city" is what reached the rendered H1:
 *
 *   "Plumbing Repairs Tulsa, OK"  -> city "Plumbing Repairs Tulsa"
 *   "Plumbers Spokane, WA"        -> city "Plumbers Spokane"
 *   "Plumbers Omaha, NE"          -> city "Plumbers Omaha"
 *   "HVAC Akron, OH"              -> city "HVAC Akron"
 *
 * Cooper Perry's mirror shipped the headline "Plumbing in Plumbing Repairs
 * Tulsa. Done right." — on the hero, the header chip, "BASED IN" and the
 * <title>. The trailing state made it a place assertion, which is right; the
 * trade noun in front of the town is what nobody stripped.
 *
 * THE RULE MOVED, AND THE CAPTURE IS NO LONGER THE ONLY PLACE THAT ASKS IT.
 *
 * Salvaging at capture was not enough. Three live mirrors carry a market frozen
 * on the prospect record — "Plumbing Repairs Tulsa", "Fence Company Westfield",
 * "Galli Plumbing Services service area" — and a stored value never passes this
 * resolver again, so Cooper Perry's rebuilt page still published "Plumbing in
 * Plumbing Repairs Tulsa" as its title. Same shape as the address defect, same
 * answer: the rule lives in lib/mirror-engine/place-names.js, where the render
 * and the gate can ask it too, and facts.js validateFacts asks it at the one
 * boundary every build crosses. stripPlaceLeadIn keeps its name and its exact
 * behaviour here, so the capture path is unchanged.
 */
const { stripPlaceLeadIn, eligibleMarketCity } = require("./place-names");

function placeAssertionsIn(text) {
  const out = [];
  for (const m of s(text).matchAll(PLACE_STATE_RE)) {
    // The trailing token is greedy by design ("New Mexico" is two words), so
    // try the two-word reading first and fall back to the one-word reading.
    // Without this, "Austin, Texas Plumber" reads its state as "Texas Plumber"
    // and the whole assertion is silently thrown away.
    const tail = m[2].trim();
    const state = stateCodeOf(tail) || stateCodeOf(tail.split(/\s+/)[0]);
    if (!state) continue;
    const city = stripPlaceLeadIn(m[1].replace(/\s+/g, " ").trim());
    if (city.length < 3 || city.length > 40) continue;
    if (city.split(" ").length > 3) continue; // not a city name any more
    out.push({ city, state });
  }
  return out;
}

/**
 * THE SERVICE-AREA ASSERTION — the market the business says it sells into.
 *
 * WHY THIS IS NOT THE ADDRESS, AND WHY THE SUBJECT IS ALLOWED TO SAY IT
 * Google's `locality` is where the business is REGISTERED. It is the right
 * answer for a mailing label and the wrong answer for a headline. Flint
 * Plumbing's registered locality is Buda, TX; their own site is titled "Austin
 * Plumbers" and their own machine-readable site description reads "Austin,
 * Texas Plumber, Plumbing, Emergency Plumber". Titling their mirror "Plumbing in
 * Buda, TX" shrank a 40-year Austin plumber to a suburb.
 *
 * Only the business knows which market it sells into, so — exactly as with its
 * service list and its FAQ — the subject IS the authority here. That is a
 * different claim from a review, which is why this is `self_published` and the
 * third_party_trust ban is untouched.
 *
 * STRUCTURAL, IN PRIORITY ORDER, AND IT NEVER GUESSES:
 *   1. schema.org `areaServed` on the business/organization node — the site's
 *      own machine-readable declaration. Nothing beats it.
 *   2..n the site's own SELF-DESCRIPTION metadata (title, meta description,
 *      og:*, JSON-LD descriptions, <h1>), scanned for a "<Place>, <State>"
 *      assertion. A bare capitalised word is never taken as a city: without a
 *      gazetteer that would be invention, and "absent" is the correct answer.
 *
 * A surface that asserts TWO different markets is AMBIGUOUS and is skipped — we
 * do not pick a winner. If no surface yields exactly one, the result is "", the
 * caller falls back to the NAP city, and the mirror ships exactly as it does
 * today.
 */
// ---------------------------------------------------------------------------
// A SERVICE AREA IS A PLACE, NOT A HEADLINE
// ---------------------------------------------------------------------------
// marketCity() prefers this assertion over the NAP city on every marketing
// surface — <title>, og:title, the hero H1, "Serving …". So whatever comes back
// here IS the locality the prospect reads on their own mirror, and a phrase
// that is not a place name becomes a sentence no one would write. Measured on
// the rebuilt fleet, from the rendered H1:
//
//   Cooper Perry Plumbing    "Plumbing in Plumbing Repairs Tulsa. Done right."
//   Bulldog Rooter           service_area "Plumbers Spokane"
//   Plumbing Today HVAC      service_area "Plumbers Omaha"
//   Jennings Heating         service_area "HVAC Akron"
//   Galli Plumbing Services  service_area "Galli Plumbing Services service area"
//
// All five came through branch 1: schema.org areaServed.name was accepted
// verbatim on nothing but a "looks like letters" test. An SEO heading is
// exactly what a contractor puts in that field, so the test has to ask whether
// the string NAMES A PLACE, not whether it is spelled with letters.
//
// The publisher is still the authority on their market — so this SALVAGES
// rather than refuses. "Plumbers Spokane" is a real assertion about Spokane;
// strip the trade noun and the place survives. That is also the ORIGINAL Flint
// Plumbing case working properly: their site says "Austin Plumbers", and the
// point of this function is that they are an Austin plumber, not a Buda one.
// Only when nothing but trade words remains ("… service area") is there no
// assertion, and the caller correctly falls back to the NAP city.
const TRADE_WORDS = new RegExp(
  "\\b(plumb(?:ers?|ing)?|hvac|heating|cooling|air ?conditioning|ac|furnace|boiler|"
  + "roof(?:ers?|ing)?|electric(?:al|ians?)?|drain|sewer|rooter|septic|"
  // Longest alternative first: "services?" would otherwise win against
  // "service area" and leave a stray "area" behind to be read as a city.
  + "service ?areas?|areas? served|services?|repairs?|solutions?|contractors?|company|co|inc|llc|ltd|"
  + "best|top|cheap|affordable|emergency|24 ?-? ?7|local|near ?me|serving|areas?)\\b",
  "gi",
);

/**
 * Reduce a declared areaServed string to the place it names, or "" if it names
 * none. Never invents a place that was not in the string.
 */
function placeNameFrom(raw, businessName = "") {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // The business's own name in its own areaServed carries no locality.
  const bn = String(businessName || "").trim();
  if (bn) t = t.replace(new RegExp(bn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  t = t.replace(TRADE_WORDS, " ").replace(/[|/,—–-]+/g, " ").replace(/\s+/g, " ").trim();
  // What survives must read like a place: 1-4 words, letters only.
  if (!t) return "";
  if (!/^[A-Za-z][A-Za-z'’ .-]{1,39}$/.test(t)) return "";
  if (t.split(" ").filter(Boolean).length > 4) return "";
  return t;
}

function serviceAreaAssertion({ html = "", ldNodes = [], businessName = "" } = {}) {
  const attr = (re) => { const m = re.exec(html); return m ? decodeEntitiesOnce(m[1]) : ""; };
  const metaContent = (name) => attr(
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
  ) || attr(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`, "i"));

  // 1. Explicit areaServed. A declaration, not an inference.
  for (const node of ldNodes) {
    const types = typeOf(node);
    if (!types.some((t) => /localbusiness|organization|contractor|homeandconstructionbusiness|professionalservice/.test(t))) continue;
    const raw = node.areaServed;
    if (!raw) continue;
    const names = (Array.isArray(raw) ? raw : [raw])
      .map((a) => (a && typeof a === "object" ? s(a.name) : s(a)))
      .map((n) => decodeEntitiesOnce(n).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!names.length) continue;
    // Take the FIRST declared area: schema.org orders areaServed by the
    // publisher's own priority, and it is their declaration to order.
    const first = names[0];
    const withState = placeAssertionsIn(first)[0];
    if (withState) return { city: withState.city, state: withState.state, surface: "schema_area_served" };
    // A bare declared area is taken only for the PLACE it names — see the note
    // above this function. "Plumbers Spokane" -> Spokane; "… service area" -> none.
    const place = placeNameFrom(first, businessName);
    if (place) return { city: place, state: "", surface: "schema_area_served" };
  }

  // 2. Self-description metadata, highest-signal first.
  const ldText = (pred) => ldNodes.filter(pred).flatMap((n) => [s(n.description), s(n.name)]).filter(Boolean);
  const surfaces = [
    ["title", [decodeEntitiesOnce((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "")]],
    ["meta_description", [metaContent("description")]],
    ["og_title", [metaContent("og:title")]],
    ["og_description", [metaContent("og:description")]],
    ["schema_description", ldText((n) => /website|webpage|organization|localbusiness/.test(typeOf(n).join(" ")))],
    ["h1", [...html.matchAll(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/gi)].map((m) => decodeEntitiesOnce(m[1].replace(/<[^>]+>/g, " ")))],
  ];
  for (const [surface, texts] of surfaces) {
    const found = new Map();
    for (const t of texts) {
      for (const hit of placeAssertionsIn(t)) {
        const key = `${alnum(hit.city)}|${hit.state}`;
        if (!found.has(key)) found.set(key, hit);
      }
    }
    if (found.size !== 1) continue; // 0 = nothing said, >1 = ambiguous. Neither is a fact.
    const [hit] = found.values();
    return { ...hit, surface };
  }
  return null;
}

/**
 * SOURCE 4 — the prospect's own website.
 *
 * Extraction is STRUCTURAL ONLY. Nothing here reads prose and decides what it
 * means, because that is the exact operation that turned a Facebook page id
 * into a phone number:
 *   · phone   <- schema.org telephone, or a tel: href (a machine-readable
 *                declaration by the site itself, not a number found in text)
 *   · address <- schema.org PostalAddress
 *   · hours   <- schema.org openingHours
 *   · faqs    <- schema.org FAQPage question/answer pairs
 *   · services<- the site's OWN internal navigation: anchor text on links to
 *                distinct pages on its own host, minus a blocklist of pages
 *                that are structurally not services. The business wrote both
 *                the label and the page.
 *   · service_area <- schema.org areaServed, else a "<Place>, <State>"
 *                assertion in the site's own self-description metadata. See
 *                serviceAreaAssertion() — the MARKET, never the mailing address.
 * Review text and star ratings found on the site are DELIBERATELY NOT READ.
 * Cost: 1 HTTP GET (free).
 */
async function firstPartySite(ctx) {
  const id = "first_party_site";
  const base = { id, observer: OBSERVER.BUSINESS_SELF, transport: "direct_fetch", requests: 0, observations: {} };
  const url = s(ctx.website);
  if (!url) return { ...base, status: "no_website" };
  let html = "";
  let origin = "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ...base, status: "no_website" };
    origin = u.origin;
    base.requests = 1;
    const res = await (ctx.fetchImpl || fetch)(u.toString(), {
      headers: { "User-Agent": s(process.env.VERIFIED_FACTS_UA) || "Mozilla/5.0 (compatible; WSS-MirrorEngine/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(envInt("VERIFIED_FACTS_SITE_TIMEOUT_MS", 25000)),
    });
    if (!res.ok) return { ...base, status: "unavailable", error: `http_${res.status}` };
    html = await res.text();
    // THE ORIGIN THE BYTES CAME FROM, not the origin we asked for. Dr. Jose
    // Barrera's site 301s www→apex and writes every internal link absolute to
    // the apex; comparing against the request-URL origin refused all 181 of
    // them as "cross-origin" and the mega-menu of procedures resolved to zero
    // (measured 2026-08-20). res.url is the fetch spec's final URL after
    // redirects; an unparseable value keeps the request origin.
    try { origin = new URL(res.url || u.toString()).origin; } catch { /* keep the request origin */ }
  } catch (e) {
    return { ...base, status: "unavailable", error: s(e && e.name) || "fetch_failed" };
  }

  const nodes = jsonLdBlocks(html);
  const obs = {};

  for (const node of nodes) {
    const types = typeOf(node);
    const isBiz = types.some((t) => /localbusiness|organization|contractor|roofingcontractor|homeandconstructionbusiness|professionalservice/.test(t));
    if (isBiz) {
      // JSON-LD is JSON, but the STRINGS inside it are HTML-escaped by every
      // CMS that writes it: "Smith &amp; Sons Plumbing", "&#038;", "&#039;".
      // Each value is decoded exactly once, here, on the way into `obs` — never
      // again downstream. Decoding a value twice is how "&amp;#038;" (inert
      // text the author wrote) would become a live "&", so there is no second
      // pass anywhere on this path.
      const tel = node.telephone;
      const phone = Array.isArray(tel) ? tel[0] : tel;
      if (phone && !obs.phone) obs.phone = decodeEntitiesOnce(s(phone));
      if (node.name && !obs.business_name) obs.business_name = decodeEntitiesOnce(s(node.name));
      if (node.address && !obs.address) {
        const addr = decodeEntitiesDeep(node.address);
        obs.address = addr;
        const p = parseAddress(addr);
        if (p.city) obs.city = p.city;
        if (p.state) obs.state = p.state;
        if (p.postal) obs.postal_code = p.postal;
      }
      if (node.openingHours && !obs.hours) obs.hours = decodeEntitiesDeep(Array.isArray(node.openingHours) ? node.openingHours : [node.openingHours]);
      if (node.url && !obs.current_website) obs.current_website = decodeEntitiesOnce(s(node.url));
    }
    if (types.includes("faqpage") && Array.isArray(node.mainEntity)) {
      const faqs = node.mainEntity
        .map((q) => ({
          q: decodeEntitiesOnce(s(q && q.name)).replace(/\s+/g, " ").trim(),
          // Answers carry inline <a> markup. Stripping tags to a space leaves
          // "roof repairs , complete" — which the rendered /faq page showed as
          // an orphan comma and route_render correctly failed the build for.
          // Re-tightening space-before-punctuation removes characters the
          // business never wrote; it never adds or reorders a word.
          //
          // Tags are stripped BEFORE entities are decoded, deliberately. The
          // other order would turn an author's literal "&lt;strong&gt;" — text
          // they meant a reader to SEE — into a tag and then delete it.
          a: decodeEntitiesOnce(
            s(q && q.acceptedAnswer && q.acceptedAnswer.text).replace(/<[^>]+>/g, " "),
          )
            .replace(/\s+/g, " ")
            .replace(/\s+([,.;:!?%)])/g, "$1")
            .replace(/(\(|\$)\s+/g, "$1")
            .trim(),
        }))
        .filter((f) => f.q && f.a);
      if (faqs.length && !obs.faqs) obs.faqs = faqs.slice(0, 20);
    }
  }

  // tel: hrefs — the site's own machine-readable dial target.
  if (!obs.phone) {
    const tels = [...new Set([...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => normPhone(m[1])).filter(Boolean))];
    if (tels.length === 1) obs.phone = tels[0];
    else if (tels.length > 1) base.note = `site declares ${tels.length} distinct tel: numbers; none used`;
  }

  // Services from the site's own navigation — the LAST-RANKED source, not the
  // only one. See the content harvest below and service-harvest.js for why.
  const seen = new Map();
  // The inner bound is on RAW MARKUP, not on the label: a modern builder menu
  // wraps every label in spans plus an inline SVG chevron, and Marcos
  // Medical's 146-of-172 anchors exceeded 120 chars of markup — the whole
  // treatment menu was invisible and one lone service resolved (measured
  // 2026-08-20). The visible label is still stripped and gated to 3..60
  // characters below; 600 is about markup room, never longer labels.
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
    let path;
    try {
      const u = new URL(m[1], origin);
      if (u.origin !== origin) continue;
      path = u.pathname.replace(/\/+$/, "") || "/";
    } catch { continue; }
    if (path === "/" || isNonServicePath(path)) continue;
    // Entities are decoded ONCE here, before any length/blocklist/dedupe test
    // looks at the label, so every downstream rule reasons about the characters
    // a reader would see. The old two-entity cleaner (&nbsp; and &amp; only)
    // is what let WordPress's numeric `&#038;` reach a rendered service card
    // as literal text — see lib/mirror-engine/html-entities.js.
    // The SEO locality suffix comes off before the dedupe key is taken, which
    // is what collapses "Commercial Plumbing Services in Portland OR" onto the
    // "Commercial Plumbing Services" the list already holds.
    const label = stripTrailingLocality(
      decodeEntitiesOnce(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    );
    if (!label || label.length < 3 || label.length > 60) continue;
    // THE ANCHOR TEXT OF A MENU THAT NEVER RENDERED. Cooper Perry (Tulsa) and
    // Goodson (Boise) both serve `<a>${child.title}</a>` in their own live HTML,
    // and both mirrors published it as a service. Refused here, at the harvest,
    // so it is not merely hidden at the render — a service list that silently
    // holds a token is a list the next surface will print.
    if (carriesTemplateToken(label)) continue;
    if (/^(read more|learn more|click here|more|home|next|previous|\d+)$/i.test(label)) continue;
    if (NON_SERVICE_LABEL.test(label)) continue;
    // A BLOG POST IS NOT A SERVICE, AND ITS URL DOES NOT SAY SO.
    //
    // isNonServicePath() refuses `/blog/…`, and both Holt Plumbing (Nashville)
    // and Cooper Perry (Tulsa) publish their posts at the ROOT —
    // holtplumbing.com/why-discolored-water-could-mean-you-need-water-heater-repair
    // — so there is no segment to match and both mirrors shipped their blog as
    // the client's schema.org Service list. A path blocklist can only refuse a
    // URL somebody thought to name; the LABEL says what it is. See
    // lib/mirror-engine/service-names.js.
    if (articleHeadlineReason(label)) continue;
    // A label that is only the business's own name, or only its market and its
    // trade, is a link back to the hub page rather than a service. Rescue
    // Rooter's nav produced "Portland plumber" as a service card for exactly
    // this reason. See isHubLabel.
    if (normName(label) === normName(ctx.business_name) && normName(label)) continue;
    if (isHubLabel(label, ctx.city, ctx.state)) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name: label, path });
  }
  // WHAT THE PAGE SAYS THEY SELL OUTRANKS WHAT THE MENU BAR SAYS.
  //
  // Everything above reads NAVIGATION — anchor text on links to other pages.
  // That is a list of places to click, and the fleet audit of 2026-08-11
  // measured the cost of treating it as the only source: 18 of 100 live mirrors
  // published a menu item, a button or a membership club as a schema.org
  // Service, and eighteen Google snippets opened with one ("Photo Gallery in
  // Portland, OR…"), because seoDescription leads with services[0].
  //
  // service-names.js now refuses those labels. But refusing junk only SHORTENS a
  // list — it cannot supply the real services the junk displaced. So two
  // first-party sources are read off the SAME bytes, at no extra cost, and both
  // outrank the nav: the site's declared schema.org OfferCatalog, then the
  // headings inside its own services section. The nav becomes the fallback it
  // should always have been.
  const harvest = harvestPageServices({
    html,
    ldNodes: nodes,
    normalize: stripTrailingLocality,
    max: 12,
  });
  const merged = mergeServiceSources(
    [
      { source: "schema_offer", names: harvest.services.filter((x) => x.source === "schema_offer").map((x) => x.name) },
      { source: "page_heading", names: harvest.services.filter((x) => x.source === "page_heading").map((x) => x.name) },
      // THE CATALOGUE DIRECTORY OUTRANKS THE HEADER MENU. The 12-cap used to
      // keep the FIRST twelve in document order, so an About-menu ("In The
      // Media", "Patient Portal") outranked the thirty procedures under
      // /cosmetic/ that followed it. Siblings share their first path segment;
      // more siblings = more catalogue-like. Labels are unchanged — only which
      // twelve survive the cap. Ties keep document order.
      {
        source: "nav_anchor",
        names: (() => {
          const dirOf = (p) => String(p || "").split("/").filter(Boolean)[0] || "";
          const family = new Map();
          for (const v of seen.values()) family.set(dirOf(v.path), (family.get(dirOf(v.path)) || 0) + 1);
          return [...seen.values()]
            .map((v, i) => ({ ...v, i, kin: family.get(dirOf(v.path)) || 0 }))
            .sort((a, b) => (b.kin - a.kin) || (a.i - b.i))
            .map((v) => v.name);
        })(),
      },
    ],
    { normalize: stripTrailingLocality, max: 12 },
  );
  const services = merged.services.map((v) => ({ name: v.name }));
  if (services.length) obs.services = services;
  // The provenance an operator needs to answer "where did card 01 come from?"
  // without re-running the scrape. Carried beside the observation, never inside
  // it, so it can never be mistaken for a fact about the business.
  base.service_sources = merged.counts;
  if (merged.dropped.length) base.services_refused = merged.dropped.slice(0, 20);

  // The market the business says it sells into. Carried alongside the
  // observation (like place_types) so the resolver can check the asserted state
  // against the resolved NAP state without a second field class.
  const market = serviceAreaAssertion({ html, ldNodes: nodes, businessName: s(ctx.business_name) });
  if (market) {
    obs.service_area = market.city;
    base.service_area_state = market.state;
    base.service_area_surface = market.surface;
  }

  return { ...base, status: "ok", observations: obs, html_bytes: html.length };
}

/**
 * SOURCE 5 — a prospect row we already hold (LeadMiner / Ghost store).
 *
 * ADVISORY ONLY. A stored row is a CACHE of an earlier observation, usually
 * Google's. A cache cannot corroborate the thing it was copied from — that is
 * circular — and it must not be able to CONFLICT with a fresh observation
 * either, or every stale row in the database would veto a true fact. So its
 * values are reported for the operator's eyes and are never resolved into
 * `facts`. Read-only; this module never writes to any prospect record.
 */
function cachedProspectRow(ctx) {
  const id = "prospect_row_cache";
  const base = { id, observer: OBSERVER.GOOGLE_GBP, transport: "leadminer_cache", cached: true, requests: 0, observations: {} };
  const row = ctx.record && typeof ctx.record === "object" ? ctx.record : null;
  if (!row) return { ...base, status: "not_supplied" };
  const obs = {};
  const map = {
    business_name: ["business_name", "businessName", "name"],
    phone: ["phone", "phoneNumber", "nationalPhoneNumber"],
    address: ["address", "formattedAddress"],
    city: ["city"], state: ["state"],
    current_website: ["current_website", "website", "websiteUri"],
    rating: ["rating"], review_count: ["review_count", "userRatingCount", "reviewCount"],
    place_id: ["place_id", "placeId"],
  };
  for (const [field, keys] of Object.entries(map)) {
    for (const k of keys) {
      if (row[k] != null && row[k] !== "") { obs[field] = row[k]; break; }
    }
  }
  return { ...base, status: Object.keys(obs).length ? "ok" : "empty", observations: obs };
}

const DEFAULT_SOURCES = [placesViaCallPrep, knowledgePanel, firstPartySite, placesDirect, cachedProspectRow];

// ---------------------------------------------------------------------------
// RESOLUTION
// ---------------------------------------------------------------------------

/**
 * AN OBSERVATION WE CANNOT READ IS SILENCE, NOT A COMPETING CLAIM.
 *
 * normHours() deliberately DROPS any line it cannot parse rather than guessing
 * at it — an unparsed line must never become a fake "closed". But a source whose
 * every line is dropped was then still treated as an OBSERVER OF HOURS with an
 * empty value, and `hoursAgree` compared zero days and returned false. The
 * result was a manufactured conflict that deleted the other source's perfectly
 * good hours.
 *
 * Measured on Jam Plumbing (Portland), 2026-08-06: Google published seven real
 * rows, their own site declared the single schema.org string
 * "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday 00:00-23:59" — one
 * comma-joined token normHours cannot read — and the mirror shipped with NO
 * hours table at all. The site did not contradict Google. It said nothing this
 * module can understand, which is a different thing.
 *
 * Scoped to `hours` on purpose. It is the one field whose normalizer is
 * documented to discard what it cannot read, so "normalized to empty" provably
 * means "no claim was extracted" rather than "the claim is unusual". Every other
 * field keeps today's behaviour exactly.
 */
const UNREADABLE = Object.freeze({
  hours: (v) => Object.keys(normHours(v)).length === 0,
});

/** Ban check. Applied before a source's observations are looked at even once. */
function sourceIsBanned(rec) {
  return BANNED_OBSERVERS.has(rec.observer)
    || BANNED_SOURCE_PATTERN.test(s(rec.id))
    || BANNED_SOURCE_PATTERN.test(s(rec.transport))
    || BANNED_SOURCE_PATTERN.test(s(rec.observer));
}

/**
 * Resolve ONE field across the source records that observed it.
 * Returns { status: "resolved"|"conflict"|"withheld", ... }.
 */
function resolveField(field, records) {
  const klass = FIELD_CLASS[field] || "nap";
  const usable = [];
  const excluded = [];

  for (const rec of records) {
    if (rec.status !== "ok") continue;
    if (!(field in rec.observations)) continue;
    const value = rec.observations[field];
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
    if (sourceIsBanned(rec)) { excluded.push({ source: rec.id, reason: "source_banned" }); continue; }
    // The subject may not testify about third-party trust, at all, ever.
    if (SUBJECT_DISQUALIFIED_CLASSES.has(klass) && !INDEPENDENT_OBSERVERS.has(rec.observer)) {
      excluded.push({ source: rec.id, reason: "subject_disqualified_for_class" });
      continue;
    }
    if (rec.cached) { excluded.push({ source: rec.id, reason: "cache_is_not_an_observation" }); continue; }
    // Nothing legible was extracted, so this source made no claim about the
    // field. See UNREADABLE — silence must not out-vote a source that spoke.
    if (UNREADABLE[field] && UNREADABLE[field](value)) {
      excluded.push({ source: rec.id, reason: "observation_unreadable" });
      continue;
    }
    usable.push({ rec, value });
  }

  if (!usable.length) {
    return { status: "withheld", field, class: klass, reason: "no_observation", excluded };
  }

  // Pairwise agreement against the first usable observation.
  const [head, ...rest] = usable;
  let value = head.value;
  const agreeing = [head];
  const disagreeing = [];
  for (const cand of rest) {
    if (agrees(field, value, cand.value)) {
      value = pickAgreed(field, value, cand.value);
      agreeing.push(cand);
    } else {
      disagreeing.push(cand);
    }
  }

  // CONFLICT. No winner is picked — not by source order, not by "confidence",
  // not by recency. The field is absent and the disagreement is reported.
  if (disagreeing.length) {
    return {
      status: "conflict",
      field,
      class: klass,
      observations: [...agreeing, ...disagreeing].map((u) => ({
        source: u.rec.id, observer: u.rec.observer, transport: u.rec.transport, value: u.value,
      })),
      resolution: "absent",
      excluded,
    };
  }

  const observers = new Set(agreeing.map((u) => u.rec.observer));
  const independent = agreeing.some((u) => INDEPENDENT_OBSERVERS.has(u.rec.observer));

  // Single-source policy. An independent observer standing alone is acceptable
  // (it is not the subject). The subject standing alone is acceptable only for
  // what the subject is the authority on — its own service list and its own FAQ.
  if (!independent && REQUIRES_INDEPENDENT_SOURCE.has(klass)) {
    return {
      status: "withheld",
      field,
      class: klass,
      reason: "single_source_not_independent",
      observed_by: agreeing.map((u) => u.rec.id),
      excluded,
    };
  }

  const corroboration = agreeing.length === 1
    ? (independent ? "single_independent" : "single_self_published")
    : (observers.size > 1 ? "independent_corroborated" : "transport_corroborated");

  return {
    status: "resolved",
    field,
    class: klass,
    value,
    corroboration,
    sources: agreeing.map((u) => ({ source: u.rec.id, observer: u.rec.observer, transport: u.rec.transport })),
    excluded,
  };
}

const RESOLVE_FIELDS = Object.keys(FIELD_CLASS).filter((f) => f !== "industry");

/**
 * resolveVerifiedFacts({ prospect }) ->
 *   { ok, facts, content, provenance, conflicts, withheld, sources, coverage, vertical }
 *
 * `prospect` is whatever the caller already knows — at minimum a business name
 * plus city/state, or a website. Nothing here is required to be true: every
 * value the caller supplies is treated as a QUERY KEY, never as a fact. Only
 * observations resolve into `facts`.
 *
 * `facts` is shaped for a MirrorRequest (lib/mirror-engine/facts.js) and
 * `content` for MirrorContent, so a caller can hand them straight to mirror().
 */
async function resolveVerifiedFacts({ prospect = {}, sources = DEFAULT_SOURCES, deps = {} } = {}) {
  const ctx = {
    business_name: s(prospect.business_name || prospect.businessName || prospect.name),
    city: s(prospect.city),
    state: s(prospect.state).toUpperCase(),
    // The searched market is a constraint, never a fact. It may confirm a
    // first-party service-area assertion; it can never create one.
    query_city: s(prospect.query_city || prospect.queryCity || prospect.mining_city || prospect.miningCity),
    query_state: s(prospect.query_state || prospect.queryState || prospect.mining_state || prospect.miningState).toUpperCase(),
    phone: s(prospect.phone),
    website: s(prospect.website || prospect.current_website || prospect.url),
    // THE PIN, carried into the adapters. Callers have been supplying this for
    // months (mirror-lane-build passes `place_id: prospect.place_id ||
    // contract.place_id`) and NOTHING read it, so every Google lookup fell back
    // to a text match it could not confirm. It is a QUERY KEY and an IDENTITY
    // CHECK, never an answer: no adapter may resolve `place_id` FROM it, only
    // refuse or confirm a record against it.
    place_id: s(prospect.place_id),
    industry: s(prospect.industry || prospect.category),
    record: prospect.record || null,
    fetchImpl: deps.fetchImpl,
    fetchTrustImpl: deps.fetchTrustImpl,
    trustOptions: deps.trustOptions,
  };

  const records = [];
  for (const adapter of sources) {
    let rec;
    try {
      rec = await adapter(ctx);
    } catch (e) {
      rec = { id: s(adapter.name) || "unknown_source", observer: "unknown", status: "threw", error: s(e && e.message).slice(0, 160), requests: 0, observations: {} };
    }
    rec.observations = rec.observations || {};
    // A banned source is neutralised HERE, before resolution, and is reported so
    // the ban is visible rather than silent.
    if (sourceIsBanned(rec)) {
      records.push({ ...rec, status: "banned", banned_reason: "observer_or_id_is_the_genie", observations: {} });
      continue;
    }
    records.push(rec);
  }

  const provenance = {};
  const conflicts = [];
  const withheld = [];
  const facts = {};
  const content = {};

  for (const field of RESOLVE_FIELDS) {
    const out = resolveField(field, records);
    if (out.status === "resolved") {
      let value = out.value;
      if (field === "phone") value = displayPhone(value);
      else if (field === "address") value = displayAddress(value);
      else if (field === "reviews") value = shapeReviews(value);
      provenance[field] = {
        value,
        class: out.class,
        corroboration: out.corroboration,
        sources: out.sources,
      };
      if (field === "reviews" || field === "hours" || field === "services" || field === "faqs") content[field] = value;
      else facts[field] = value;
    } else if (out.status === "conflict") {
      conflicts.push(out);
    } else {
      withheld.push({ field: out.field, class: out.class, reason: out.reason, ...(out.observed_by ? { observed_by: out.observed_by } : {}) });
    }
  }

  // SERVICE-AREA COHERENCE. The market a business claims is only usable when it
  // is coherent with the location we verified independently, and only when it
  // actually SAYS something the NAP city does not already say:
  //   · asserted state must equal the resolved state — "Austin, TX" for a
  //     Washington business is a page the extractor misread, not a market;
  //   · asserted market equal to the NAP city is not a divergence, so it is
  //     dropped and CITY keeps its single, unambiguous source.
  // Failing either way is silent and safe: the caller falls back to the NAP city
  // and the mirror ships exactly as it did before this field existed.
  if (facts.service_area) {
    const assertedStates = records
      .filter((r) => r.status === "ok" && s(r.service_area_state))
      .map((r) => s(r.service_area_state).toUpperCase());
    const market = eligibleMarketCity({
      assertedCity: facts.service_area,
      assertedStates,
      queryCity: ctx.query_city,
      queryState: ctx.query_state,
      napCity: facts.city,
      napState: facts.state,
      businessName: facts.business_name,
    });
    if (!market.eligible) {
      withheld.push({
        field: "service_area",
        class: "self_published",
        reason: market.reason,
        asserted: facts.service_area,
        used: market.city,
      });
      delete facts.service_area;
      delete provenance.service_area;
    } else if (market.service_area !== facts.service_area) {
      facts.service_area = market.service_area;
      provenance.service_area.value = market.service_area;
    }
  }

  // VERTICAL / TRADE-SWAP GUARD. Google's assigned place type is an independent
  // statement about the trade. A caller-claimed industry that maps to a
  // DIFFERENT vertical is a conflict, and the resolved industry goes absent —
  // an HVAC company must never ship as a plumber, so a donor is never chosen
  // from an unresolved trade.
  const placeTypes = records.filter((r) => r.status === "ok" && Array.isArray(r.place_types)).flatMap((r) => r.place_types);
  const observedVertical = verticalOfPlaceTypes(placeTypes);
  const claimedVertical = verticalOfIndustry(ctx.industry);
  let vertical = null;
  if (observedVertical && claimedVertical && observedVertical !== claimedVertical) {
    conflicts.push({
      status: "conflict",
      field: "industry",
      class: "category",
      observations: [
        { source: "google_place_types", observer: OBSERVER.GOOGLE_GBP, value: observedVertical },
        { source: "caller_claim", observer: "caller", value: claimedVertical },
      ],
      resolution: "absent",
      note: "trade-swap guard: donor selection is blocked until the trade is agreed",
    });
  } else {
    vertical = observedVertical || claimedVertical || null;
    if (observedVertical) {
      facts.industry = observedVertical.replace(/_/g, " ");
      provenance.industry = {
        value: facts.industry,
        class: "category",
        corroboration: claimedVertical ? "independent_corroborated" : "single_independent",
        sources: [{ source: "google_place_types", observer: OBSERVER.GOOGLE_GBP, transport: "places_api" }],
      };
    } else if (claimedVertical) {
      // Caller's claim with no independent check. Recorded, but named for what
      // it is — the trade-swap guard did NOT run.
      facts.industry = ctx.industry;
      provenance.industry = {
        value: ctx.industry,
        class: "category",
        corroboration: "caller_claim_unverified",
        sources: [{ source: "caller_claim", observer: "caller", transport: "input" }],
      };
      withheld.push({ field: "industry_verification", class: "category", reason: "no_independent_place_type_observed" });
    }
  }

  // The MirrorRequest minimum. Absent any of these, a build must not start.
  const required = ["business_name", "industry", "city", "state", "phone"];
  const missing = required.filter((f) => !s(facts[f]));
  const ok = missing.length === 0;

  const requests = records.reduce((n, r) => n + (r.requests || 0), 0);

  return {
    ok,
    missing_required: missing,
    facts,
    content,
    provenance,
    conflicts,
    withheld,
    vertical,
    sources: records.map((r) => ({
      id: r.id,
      observer: r.observer,
      transport: r.transport,
      status: r.status,
      requests: r.requests || 0,
      ...(r.cached ? { cached: true } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(r.note ? { note: r.note } : {}),
      ...(r.banned_reason ? { banned_reason: r.banned_reason } : {}),
      fields: Object.keys(r.observations || {}),
    })),
    cost: { requests },
    coverage: {
      resolved: Object.keys(provenance).length,
      conflicts: conflicts.length,
      withheld: withheld.length,
      independent_corroborated: Object.values(provenance).filter((p) => p.corroboration === "independent_corroborated").length,
      transport_corroborated: Object.values(provenance).filter((p) => p.corroboration === "transport_corroborated").length,
      single_independent: Object.values(provenance).filter((p) => p.corroboration === "single_independent").length,
      single_self_published: Object.values(provenance).filter((p) => p.corroboration === "single_self_published").length,
    },
  };
}

/**
 * Keys MirrorFacts declares. The schema is additionalProperties:false, so an
 * extra key (we resolve `maps_url`, which MirrorFacts has no home for) is a
 * hard 400 for the whole build — the same class of failure that made every
 * mirror ship content:"none". The projection is explicit for that reason.
 */
const MIRROR_FACT_KEYS = Object.freeze([
  "business_name", "industry", "city", "state", "phone", "email", "address",
  "county", "postal_code", "latitude", "longitude", "place_id", "rating",
  "review_count", "license", "profile_url", "owner_name", "current_website",
  "service_area",
]);

/** Keys MirrorContent declares, of the ones this module resolves. */
const MIRROR_CONTENT_KEYS = Object.freeze(["services", "faqs", "reviews", "areas", "hours", "about"]);

/**
 * toMirrorRequest(resolution, { slug, donor, brand, hero, truthSource }) ->
 *   { ok, request } | { ok:false, error, detail }
 *
 * Projects a resolution into a schema-valid MirrorRequest. Only RESOLVED fields
 * appear: a conflicted or withheld field is simply not in the request, so the
 * donor's own placeholder collapses and the mirror ships smaller rather than
 * wrong.
 *
 * `truthSource` is an ABSOLUTE PATH (or paths) to a persisted evidence file —
 * normally the JSON of this very resolution, provenance and conflicts included.
 * client-isolation.js GATE 4C stats it and refuses the build if it is not on
 * disk, which is why an observer NAME is not accepted here: a string like
 * "google_gbp" would be an assertion about evidence, and this module exists
 * precisely because assertions about evidence are not evidence. Write the file,
 * pass the path, and the provenance is auditable after the fact.
 */
function toMirrorRequest(resolution, { slug, donor, brand, hero, truthSource } = {}) {
  if (!resolution || !resolution.ok) {
    return { ok: false, error: "facts_unverified", detail: (resolution && resolution.missing_required) || ["no_resolution"] };
  }
  const facts = {};
  for (const k of MIRROR_FACT_KEYS) {
    const v = resolution.facts[k];
    if (v == null || v === "") continue;
    facts[k] = v;
  }
  // rating/review_count live in MirrorFacts, and local-seo.js will only emit
  // aggregateRating when BOTH are present. One without the other is not
  // evidence, so an odd pair is dropped rather than half-rendered.
  if (facts.rating == null || facts.review_count == null) {
    delete facts.rating;
    delete facts.review_count;
  }

  const content = {};
  for (const k of MIRROR_CONTENT_KEYS) {
    const v = resolution.content[k];
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    content[k] = v;
  }
  const ts = (Array.isArray(truthSource) ? truthSource : [truthSource]).map(s).filter(Boolean).slice(0, 12);
  if (ts.length) content.truth_source = ts;

  const request = { slug: s(slug), facts };
  if (donor) request.donor = donor;
  if (brand && Object.keys(brand).length) request.brand = brand;
  if (hero && Object.keys(hero).length) request.hero = hero;
  // `truth_source` alone is bookkeeping, not content: attaching a content
  // object that holds nothing else would make engine.js run its whole content
  // stage over an empty payload and report sections:0 as if content had been
  // supplied. Only attach when there is something to render.
  const renderable = Object.keys(content).filter((k) => k !== "truth_source");
  if (renderable.length) request.content = content;
  return { ok: true, request };
}

/**
 * persistEvidence({ resolution, slug, root }) -> { ok, path, stamp } | { ok:false, ... }
 *
 * Writes the resolution — facts, provenance, conflicts, withheld, the source
 * roster — into the client's own namespaced artifact dir, and stamps that
 * namespace from the RESOLVED identity (verified name / domain / phone), not
 * from anything the caller asserted.
 *
 * This is what makes GATE 4C mean something here. The gate refuses to start a
 * build unless the claimed truth source exists on disk, lives inside this
 * client's registered root, carries this client's domain and phone, and has no
 * other business dominating it. A provenance record written by this module
 * satisfies all four BY BEING TRUE, and a later reader can open the file and
 * see exactly which observer supplied each field.
 *
 * Refuses to write when the identity is not resolved: an unstamped client can
 * never be verified, and stamping one from unverified input is the original
 * incident.
 */
function persistEvidence({ resolution, slug, root, fs: fsImpl, clientIsolation } = {}) {
  const fs = fsImpl || require("node:fs");
  const path = require("node:path");
  const iso = clientIsolation || require("./client-isolation");
  if (!resolution || !resolution.ok) {
    return { ok: false, error: "facts_unverified", detail: (resolution && resolution.missing_required) || ["no_resolution"] };
  }
  const domain = s(resolution.facts.current_website);
  const phone = s(resolution.facts.phone);
  const name = s(resolution.facts.business_name);
  if (!domain || !phone || !name) {
    return { ok: false, error: "cannot_stamp_unverified_identity", detail: { has_domain: !!domain, has_phone: !!phone, has_name: !!name } };
  }
  let stamp;
  try {
    stamp = iso.ensureClientNamespace({
      root, slug, businessName: name, domain, phone,
      postal: s(resolution.facts.postal_code),
      city: s(resolution.facts.city),
      state: s(resolution.facts.state),
    });
  } catch (e) {
    return { ok: false, error: "client_isolation_violation", detail: (e && e.failures) || [{ reason: s(e && e.message) }] };
  }
  const file = path.join(iso.clientDir(slug, root), "verified-facts.json");
  fs.writeFileSync(file, JSON.stringify({
    schema: "mirror-engine-verified-facts-v1",
    slug,
    resolved_at: new Date().toISOString(),
    facts: resolution.facts,
    content: resolution.content,
    provenance: resolution.provenance,
    conflicts: resolution.conflicts,
    withheld: resolution.withheld,
    sources: resolution.sources,
    coverage: resolution.coverage,
    cost: resolution.cost,
  }, null, 2));
  return { ok: true, path: file, stamp: { slug: stamp.slug, businessName: stamp.businessName, domain: stamp.domain, phoneDigits: stamp.phoneDigits } };
}

/**
 * Shape a resolution into the `verifiedNap` / `verifiedReviews` parameters that
 * from-genie.js requires. The `source` string names the OBSERVERS that actually
 * saw each value, and by construction can never contain "genie" — from-genie.js
 * rejects any source matching /genie/i, which is exactly the laundering attempt
 * this pair of modules exists to prevent.
 */
function toGenieBridge(resolution) {
  const nap = {};
  const napFields = ["phone", "address", "email", "current_website"];
  const observers = new Set();
  for (const f of napFields) {
    const p = resolution.provenance[f];
    if (!p) continue;
    nap[f === "current_website" ? "website" : f] = p.value;
    for (const src of p.sources) observers.add(src.observer);
  }
  const verifiedNap = nap.phone ? { ...nap, source: [...observers].join("+") || "unknown" } : null;

  const rating = resolution.provenance.rating;
  const count = resolution.provenance.review_count;
  const trustObservers = new Set([...(rating ? rating.sources : []), ...(count ? count.sources : [])].map((x) => x.observer));
  const verifiedReviews = rating && count
    ? { rating: rating.value, review_count: count.value, source: [...trustObservers].join("+") || "unknown" }
    : null;

  return { verifiedNap, verifiedReviews };
}

module.exports = {
  resolveVerifiedFacts,
  toMirrorRequest,
  persistEvidence,
  toGenieBridge,
  resolveField,
  MIRROR_FACT_KEYS,
  MIRROR_CONTENT_KEYS,
  displayPhone,
  displayAddress,
  shapeReviews,
  // adapters — exported so a caller can run a subset and a test can substitute
  placesViaCallPrep,
  placesDirect,
  knowledgePanel,
  firstPartySite,
  cachedProspectRow,
  serviceAreaAssertion,
  placeAssertionsIn,
  stateCodeOf,
  // ONE definition of "this label is a service name" — mirror-lane-build's own
  // serviceName() reads these so the packet path and the resolver path cannot
  // print different cards off the same words.
  stripTrailingLocality,
  isNonServicePath,
  isHubLabel,
  DEFAULT_SOURCES,
  // policy surface — exported so the rules are testable rather than implied
  OBSERVER,
  INDEPENDENT_OBSERVERS,
  BANNED_OBSERVERS,
  FIELD_CLASS,
  sourceIsBanned,
  normPhone,
  normName,
  normHours,
  parseAddress,
  addressAgrees,
  hoursAgree,
  agrees,
  verticalOfIndustry,
  verticalOfPlaceTypes,
};
