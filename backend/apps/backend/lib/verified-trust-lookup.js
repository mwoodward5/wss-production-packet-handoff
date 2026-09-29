"use strict";

// lib/verified-trust-lookup.js — GOOGLE'S REVIEW CORPUS FOR A PLACE WE HAVE
// ALREADY IDENTIFIED, and for no other place.
//
// WHY THIS EXISTS
// A console-mined lead reaches the build with a Google-verified `place_id` on
// its contract (lib/lead-miner.js verifyNapForCandidate accepts a Places result
// ONLY when the result's websiteUri resolves to the same registrable domain as
// the candidate site — the strongest identity binding in the pipeline). What it
// does NOT carry, for every lead mined before 2026-08-06, is the review text
// and the opening hours that the SAME paid Places call already returned. The
// miner now writes them (see contentFromPlace there); this module is how a row
// mined before that fix can still be built truthfully, with no invented data.
//
// THE HAZARD THIS MODULE IS BUILT AROUND
// The CallPrep gateway's `lookup` action matches on TEXT. Measured live for
// Carter's My Plumber, 2026-08-06:
//
//   input "https://www.cartersmyplumber.com/"
//     -> ChIJN_XEPstda4gRTEmYvihwzmw  "Carter's My Plumber", GREENWOOD IN, 2810 reviews
//   input "Carter's My Plumber … Indianapolis IN"
//     -> ChIJARzyGsasFIgRtWJ3VGwsyWA  Indianapolis, 450 E 96th St, 1315 reviews
//
// Two different places, one brand, six locations in the metro (the gateway
// returned five alternatives). Both answers came back flagged
// `lowConfidence: true` — correctly, because from a text query alone the
// gateway genuinely cannot tell which Carter's you meant. Taking the first
// answer would have published ANOTHER BRANCH'S REVIEWS as this branch's, which
// is precisely the class of defect that put somebody else's trademark on a live
// mirror last week.
//
// THE RULE
// We hold something the gateway does not: the place_id Google itself returned
// when the miner matched this business by its own registrable domain. So the
// ambiguity is not resolved by preference, by confidence score, or by name
// similarity — it is resolved by an EXACT place_id match against that prior,
// independent observation. If the ids differ by one character, the answer is
// discarded and the mirror ships without a review section.
//
// `lowConfidence` is therefore NOT overridden here. It is answered: the gateway
// was unsure WHICH place, we already know which place, and the record it
// returned either is that place or is refused.
//
// Everything is fail-closed. No place_id => nothing. No gateway => nothing.
// Id mismatch => nothing. ABSENT is a smaller mirror; wrong is a mirror that
// puts a stranger's words in the client's mouth.

const REVIEW_CAP = 5;

function s(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * A REAL reviewer face — THE ONE RULE, shared by everything that touches one.
 *
 * Google serves two kinds of profile image from the same host, and only the
 * path tells them apart:
 *   /a-/ALV-Uj…   the reviewer uploaded a photo
 *   /a/ACg8oc…    Google generated a coloured circle with their initial
 *
 * A row of "C" and "E" monogram tiles beside two real faces reads as broken
 * images, which is the opposite of the trust the rail exists to carry — so an
 * initial tile counts as NO avatar. The reviewer's words and name still ship.
 *
 * This lives here, with no dependencies, because the MINER (which stores the
 * URL on the contract) and the BUILDER (which decides whether to render it)
 * must never be able to disagree about what a face is — the same reason the
 * third-party-mark denylist lives in one file. lead-miner.js requires this
 * module directly; mirror-lane-build.js's isGoogleAvatar() delegates to it.
 */
function isGoogleReviewerFace(url) {
  try {
    const u = new URL(s(url));
    if (u.protocol !== "https:") return false;
    if (!/(^|\.)googleusercontent\.com$/i.test(u.hostname)) return false;
    return !/^\/a\/(?:ACg8oc|AAcHTt|default-user)/i.test(u.pathname);
  } catch { return false; }
}

function googleAvatar(url) {
  return isGoogleReviewerFace(url) ? s(url) : "";
}

function registrableish(url) {
  try {
    return new URL(s(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

/**
 * "Monday: Open 24 hours" -> { day: "monday", text: "Open 24 hours" }.
 *
 * Google returns weekday descriptions as one flat string per day. Handed
 * through unsplit, content-inject's normalizeHours() files them all under a
 * blank day, and the rendered hours table loses the day column entirely — the
 * one thing a person reading opening hours is looking for.
 */
function hoursFromWeekdayDescriptions(list = []) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const line = s(raw);
    if (!line) continue;
    const m = /^([A-Za-z]+)\s*:\s*(.+)$/.exec(line);
    if (m) out.push({ day: m[1].toLowerCase(), text: s(m[2]) });
    else out.push({ day: "", text: line });
  }
  return out.slice(0, 14);
}

/**
 * Reviews in the shape MirrorContent accepts. `author_photo_url` is only
 * present on the Places API transport (authorAttribution.photoUri); the
 * gateway's lookup does not carry it, so a face is simply absent rather than
 * substituted with a monogram or a stock portrait.
 */
function shapeReviews(list = []) {
  return (Array.isArray(list) ? list : []).flatMap((r) => {
    const text = s(r && (r.text && typeof r.text === "object" ? r.text.text : r.text));
    if (!text) return [];
    const author = s(r && (r.authorName || r.author
      || (r.authorAttribution && r.authorAttribution.displayName)));
    const rating = Number(r && r.rating);
    const avatar = googleAvatar(r && (r.author_photo_url || r.avatarUrl
      || (r.authorAttribution && r.authorAttribution.photoUri)));
    // Google returns `time` as unix seconds on the gateway transport and
    // `publishTime` as ISO-8601 on the Places API transport.
    const publishedAt = s(r && r.publishTime) || (Number.isFinite(Number(r && r.time)) && Number(r.time) > 0
      ? new Date(Number(r.time) * 1000).toISOString()
      : "");
    return [{
      text,
      ...(author ? { author } : {}),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(avatar ? { avatarUrl: avatar } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    }];
  }).slice(0, REVIEW_CAP);
}

function gatewayEndpoint(rawUrl) {
  try {
    const u = new URL(s(rawUrl));
    if (u.protocol !== "https:" || u.username || u.password) return "";
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}/functions/v1/api-gateway`;
  } catch { return ""; }
}

/**
 * verifiedTrustForPlace({ place_id, business_name, city, state, current_website })
 *   -> { ok, reviews, hours, profile_url, diagnostics }
 *
 * `place_id` is REQUIRED and is the pin. Every other field is only a query key
 * used to make the gateway's text match land on that place; none of them is
 * ever trusted as an answer.
 */
async function verifiedTrustForPlace(facts = {}, opts = {}) {
  const placeId = s(facts.place_id);
  const diagnostics = { transport: "places_api/callprep_gateway", pinned_place_id: placeId, queries: [] };
  if (!placeId) {
    return { ok: false, reason: "no_verified_place_id_to_pin_to", reviews: [], hours: [], diagnostics };
  }

  const key = s(opts.anonKey || process.env.CALLPREP_SUPABASE_ANON_KEY);
  const endpoint = gatewayEndpoint(opts.gatewayUrl || process.env.CALLPREP_SUPABASE_URL);
  if (!key || !endpoint) {
    return { ok: false, reason: "callprep_gateway_not_configured", reviews: [], hours: [], diagnostics };
  }

  // THE QUERY KEYS, most specific first. None of these is ever trusted as an
  // ANSWER — the pin below is the only thing that admits a record. They exist
  // only to make the gateway's text match land on the place we already hold,
  // because a lookup that lands on a sibling branch is refused and the client
  // ships with no reviews at all.
  //
  // NAME + STREET ADDRESS leads. The address is a Google-observed fact already
  // bound to this place_id on the mined contract, and it is the only key that
  // distinguishes two branches of one brand in one metro. Measured against the
  // live gateway on all 54 stored contracts that carry both a place_id and a
  // street address, 2026-08-07:
  //
  //   name + street address   54/54 landed the pinned place
  //   name + city + state     53/54
  //
  // The one difference is the case this ordering exists for. Rescue Rooter
  // (Portland, ChIJmWujeb0LlVQRDGybIRPPzPE) resolves by name+city to the
  // CLACKAMAS branch twelve miles away — 3,914 reviews against this branch's
  // 151 — so the pin refused it and the mirror shipped bare. With the street
  // address it lands the client's own branch, five reviews and seven hours,
  // and the pin passes on its own terms.
  //
  // This is a better QUESTION, never a weaker answer: exact place_id equality
  // still adjudicates every response, and a business whose address we do not
  // hold falls through to exactly the keys used before.
  //
  // The website URL stays LAST. It is a worse key than it looks: a multi-branch
  // business points every branch at one domain, so the site is the one thing
  // that cannot tell them apart (it returned the Greenwood branch for an
  // Indianapolis lead, and ARS's Houston head office for Rescue Rooter). It is
  // kept because a single-location business with an awkward name is the
  // opposite case.
  const name = s(facts.business_name);
  const address = s(facts.address);
  const seen = new Set();
  const queries = [
    name && address ? `${name} ${address}` : "",
    [name, s(facts.city), s(facts.state)].filter(Boolean).join(" "),
    s(facts.current_website),
  ].filter((query) => query && !seen.has(query) && seen.add(query));

  const fetchImpl = opts.fetchImpl || fetch;
  for (const input of queries) {
    let json = null;
    try {
      const res = await fetchImpl(`${endpoint}?${new URLSearchParams({ action: "lookup", input })}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(Number(opts.timeoutMs) || 70000),
      });
      json = await res.json().catch(() => null);
      if (!res.ok || !json || json.error) {
        diagnostics.queries.push({ input, status: `http_${res.status}`, error: s(json && json.error).slice(0, 120) });
        continue;
      }
    } catch (e) {
      diagnostics.queries.push({ input, status: "unavailable", error: s(e && e.name) });
      continue;
    }

    const returnedId = s(json.placeId);
    // THE PIN. Exact string equality with the id Google gave the miner when it
    // matched this business by its own domain. Nothing else admits the corpus.
    if (returnedId !== placeId) {
      diagnostics.queries.push({
        input,
        status: "place_id_mismatch",
        returned_place_id: returnedId,
        returned_name: s(json.name).slice(0, 80),
        returned_address: s(json.address).slice(0, 120),
        low_confidence: json.lowConfidence === true,
      });
      continue;
    }

    // SECOND BINDING. The place we pinned must still point at the site we mined.
    // A place_id is stable, but a listing that has been re-pointed at another
    // domain since the mine is a listing we no longer recognise.
    const minedHost = registrableish(facts.current_website);
    const returnedHost = registrableish(json.website);
    if (minedHost && returnedHost && minedHost !== returnedHost) {
      diagnostics.queries.push({ input, status: "website_host_mismatch", mined: minedHost, returned: returnedHost });
      continue;
    }

    const reviews = shapeReviews(json.reviews);
    const hours = hoursFromWeekdayDescriptions(json.hoursText);
    // THE AGGREGATE FOR THE PINNED PLACE — the star and the count, which the
    // page shows as one rail and which are only meaningful together.
    //
    // These were already read here and written to the diagnostics and then
    // thrown away, so a lead whose contract predates the miner writing an
    // aggregate had a 4.9 and 1,315 sitting in a response we had already paid
    // for and rendered neither. They are returned as a PAIR or not at all: a
    // star with no count, or a count with no star, is a trust claim nobody can
    // check. They are safe to return for the same single reason the reviews
    // are — this response cleared the place_id pin, so the figure belongs to
    // this branch and to no sibling.
    const observedRating = Number(json.rating);
    const observedCount = Number(json.reviewCount);
    const aggregate = observedRating > 0 && observedCount > 0
      ? { rating: observedRating, review_count: Math.trunc(observedCount) }
      : {};
    diagnostics.queries.push({
      input,
      status: "pinned_match",
      returned_name: s(json.name).slice(0, 80),
      returned_address: s(json.address).slice(0, 120),
      // Recorded, not enforced: a live rating drifts, and a build that refused
      // every lead whose review count had moved since the mine would refuse
      // every healthy business. The place_id is what proves identity.
      observed_rating: Number(json.rating) || null,
      observed_review_count: Number(json.reviewCount) || null,
      // The gateway itself could not tell which branch this was. We could,
      // which is the whole point — recorded so the audit trail shows the pin
      // did the work rather than a confidence threshold.
      gateway_low_confidence: json.lowConfidence === true,
      reviews: reviews.length,
      faces: reviews.filter((r) => r.avatarUrl).length,
      hours: hours.length,
    });
    return {
      ok: true,
      reviews,
      hours,
      ...aggregate,
      profile_url: /^https:\/\//i.test(s(json.mapsUrl)) ? s(json.mapsUrl) : "",
      diagnostics,
    };
  }

  return { ok: false, reason: "no_pinned_match_for_place_id", reviews: [], hours: [], diagnostics };
}

module.exports = {
  verifiedTrustForPlace,
  hoursFromWeekdayDescriptions,
  isGoogleReviewerFace,
  shapeReviews,
};
